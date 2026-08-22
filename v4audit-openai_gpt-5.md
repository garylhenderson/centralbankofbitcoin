FINDINGS

1) CRITICAL — Mint hardcodes the wrong “seal” authority
- Where: MINT program, constant SEAL_PDA = 4UyYD… and CreateV2 builder in mint_vault sets plugin authority to that constant.
- Impact: If the SEAL program’s PDA is not exactly that hardcoded pubkey (e.g., different program ID on mainnet, redeploy, or you rotate to a new SEAL program), every newly minted vault will embed the wrong authority address for PermanentFreezeExecute and Attributes. SEAL.open_for_redemption/close_redemption will sign with its true PDA (derived from [“seal”] and the SEAL program id), and Core will reject UpdatePluginV1 because the signer doesn’t match the authority encoded into the plugin. Result: vaults cannot be thawed or resealed; redemptions are bricked and funds cannot be moved by either party.
- Concrete exploit: Deploy SEAL at 9YKV… (current) and mint with the compiled MINT that still has SEAL_PDA hardcoded to 4UyY…. Buyer pays and receives a “sealed” vault. When they attempt redemption, close_redemption’s UpdatePluginV1 fails (wrong authority), so the transaction cannot reseal/mark and will fail; if open_for_redemption is earlier in the tx, it also rolls back, trapping funds in a permanently sealed vault.
- Fix: In MINT, derive the plugin authority dynamically as Pubkey::find_program_address([b"seal"], SEAL_PROGRAM_ID). Either:
  - hardcode SEAL program id and derive at runtime, or
  - store the SEAL program id in MINT’s config via initialize/update_wiring and derive from it, or
  - pass the SEAL PDA as an account, assert it matches find_program_address([b"seal"], seal_program_id), and use that pubkey in CreateV2 bytes.
  Remove the SEAL_PDA constant.

2) HIGH — Cross-program config divergence can brick minting/redemption/burning
- Where: All three programs keep independent configs (collection, bank, reserve mints); no cross-checks are enforced.
- Impact: If the configs drift (e.g., MINT.collection updated but SEAL/BURN not, or banks differ), then:
  - MINT: new assets mint into collection C2;
  - SEAL: open/close requires asset.collection == SEAL.config.collection (still C1) and will reject C2 assets as ForeignVault;
  - BURN: same check fails on C2 assets.
  Funds can be sold into a collection that SEAL/BURN will never service; users will be unable to redeem or burn.
- Concrete exploit: Admin calls MINT.update_wiring to flip collection/bank, mints continue; SEAL/BURN left unchanged. All redemptions and burns for new mints fail with ForeignVault/NotTheBank. This can be accidental (misconfig) or malicious (continue selling but block withdrawals).
- Fix: Enforce wiring invariants on-chain:
  - In MINT.mint_vault, require callers also pass SEAL.config (and optionally BURN.config) and assert:
    - SEAL.config.collection == MINT.config.collection
    - SEAL.config.bank == MINT.config.bank
    - reserve_mints sets are identical (if relevant to your policy)
  - In SEAL.open_for_redemption/close_redemption and BURN.burn_vault, optionally require passing MINT.config and re-assert equality.
  Better: centralize config in one program (e.g., SEAL) and have others read it, or anchor all three configs to the same seeds and authority to guarantee alignment.

3) MEDIUM — Close/burn reserve checks silently accept “non-token” accounts at the reserve ATA addresses
- Where: SEAL.inspect_reserves and BURN.burn_vault loops.
- What: For each reserve mint and token program, code finds the expected ATA address and requires that account be present in remaining_accounts. If present but owner != SPL_TOKEN_ID and != SPL_TOKEN_2022_ID (e.g., a closed-and-recreated System account), the code continues without failing.
- Impact: Your “CAN prove” line claims “every reserve mint’s ATA is declared … and empty.” As written:
  - If the reserve ATA was previously closed (possible during a thaw window with Execute) the account no longer exists; the instruction will fail at ReserveNotDeclared (good).
  - But if an operator chain created some non-token account with that key (after a token close, an account with owner System and 0 data can continue to exist if it still has lamports), the check treats it as “not a token account” and skips it. That weakens the stated proof: you have not actually proven the reserve ATA is empty; you’ve proven only that the expected pubkey was present.
- Concrete exploit: During a thaw window, user closes the reserve ATA (amount 0, owner signer via Execute). After close, some lamports could remain or be transferred to that pubkey, making it a System-owned lamports-only account. At burn time, caller includes that account; the burn’s reserve ATA checks will skip it and not verify emptiness, leaving detection to the optional “scan all remaining accounts” branch, which the caller controls and can omit. The Bank must catch this off-chain; on-chain proof does not hold as documented.
- Fix: Tighten the reserve proof:
  - Require that the declared account at the expected ATA pubkey be owned by SPL Token (or Token-2022) and have base length 165, otherwise fail (do not continue).
  - This enforces that the reserve ATA actually exists as a token account when you claim to be checking it.

4) MEDIUM — mint_vault relies on hand-built CreateV2 wire format with no structural verification
- Where: MINT.mint_vault constructs the CreateV2 data vec, setting plugin variants (17, 6), authority variant 3, counts, and trailing bytes manually.
- Impact: Any mis-encoding (off-by-one in counts, incorrect authority array packing, wrong “permanent” flags) produces assets whose plugins are wrong (e.g., Attributes missing, incorrect freeze authority), causing redemptions to fail or, worse, assets minted unfrozen.
- Concrete exploit: If the “frozen” byte were misplaced or the authority segment off by one, Core would accept creation but with PermanentFreezeExecute not set to frozen, enabling Execute immediately without Bank involvement. The Bank’s cosign on mint_vault does not prevent the owner from immediately using Execute in a separate tx.
- Fix: Stop hand-encoding. Call the official Metaplex Core CPI to CreateV2 with the typed structs, or at minimum validate post-creation:
  - Read the freshly minted AssetV1 and its plugin list and assert:
    - PermanentFreezeExecute present, frozen == true, authority == seal_pda
    - Attributes present, authority == seal_pda, attribute list empty
  Abort if any mismatch.

5) LOW — Dead code and minor inconsistencies
- SEAL: private burn_vault function not used; remove to avoid confusion.
- Duplicated MPL_CORE_ID metas in CPI account lists: harmless but brittle; prefer mirroring SDK account order.

COULDN’T BREAK
- The thaw-without-close invariant holds: if the later close fails, the tx aborts and the prior unseal rolls back atomically.
- Owner/Bank 2-of-2 on open, close, and burn is enforced on-chain (owner signature via Core for Execute; bank checked explicitly).
- Token-2022 hidden balances are refused (len != 165).
- Round arithmetic and cap in MINT appear correct; payments are atomic with creation.

THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY
- Remove the hardcoded SEAL_PDA from MINT and derive/use the actual SEAL ["seal"] PDA when minting plugins. A mismatch bricks redemptions for all newly minted vaults. This is the one change that prevents catastrophic, irreversible lockups.