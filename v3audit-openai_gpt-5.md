Findings (v3)

1) CRITICAL — burn_empty_vault can still destroy vaults that hold reserve tokens moved to a non-ATA
Exact construct: burn_empty_vault only proves emptiness for:
- the two deterministic ATAs per reserve mint (Token + Token-2022) via inspect_reserves, and
- any token accounts the caller chooses to include in remaining_accounts.

It cannot prove completeness. A non-ATA token account owned by the vault PDA is undetected if omitted.

Concrete exploit
- Owner + Bank co-sign a tx:
  1) open_for_redemption (thaws)
  2) via Core ExecuteV1, create a non-ATA token account T for the reserve mint with owner = asset_signer (no PDA signature needed to InitializeAccount with an arbitrary owner), and Transfer all cbBTC from the ATA to T.
  3) close_redemption (passes: ATAs are PDA-owned, undelegated, and “empty” is not required on close)
- Later, Owner + Bank call burn_empty_vault, declaring only the ATAs (empty) in remaining_accounts and setting declared accordingly.
- inspect_reserves(require_empty = true) accepts the empty ATAs; the loop over remaining_accounts sees nothing else; PDA lamports == 0 is satisfied; Core BurnV1 succeeds.
- Result: The non-ATA T still holds the customer’s cbBTC, but the PDA can never sign again. Funds are permanently lost.

Fix
- Short-term: Do not burn on-chain at all. Remove burn_empty_vault or make it an admin-only/manual operation with no safety claims. Your own spec admits this cannot be proven on-chain.
- If you must keep it: Require an off-chain indexer to enumerate all token accounts owned by the PDA for each reserve mint, and feed that complete list into the instruction; then on-chain, additionally REJECT if any token account owned by the PDA with mint ∈ reserve_mints is omitted. This still can’t be enforced trustlessly on-chain today, so prefer removal.

Severity: CRITICAL (permanent loss)

2) HIGH — Thaw-window durable authorities survive reseal via non-ATA accounts (bypass of your v3 fix)
Exact construct: close_redemption’s new checks only inspect the ATAs; they do not examine non-ATA token accounts.

Concrete exploit
- In the same thawed tx (owner+bank signed):
  1) Create non-ATA T (owner = asset_signer), move cbBTC from ATA → T, Approve delegate D for u64::MAX on T (or SetAuthority of T to attacker).
  2) close_redemption passes (ATAs undelegated, owner correct; you don’t check T).
- After reseal, delegate D drains T without Bank, without Execute, while the vault is sealed.

Fix
- Eliminate the blanket “thaw window”. Replace open_for_redemption/close_redemption with a single redeem instruction that:
  - unfreezes,
  - performs program-constructed, whitelisted spl_token::transfer_checked CPIs from the reserve ATAs only to declared destinations,
  - immediately re-seals and stamps Attributes,
  - all inside one instruction, so the vault is never left generally thawed and the owner cannot run arbitrary inner CPIs.
- If you keep the open/close split, this remains unfixable on-chain because you cannot enumerate or police non-ATAs or inner CPIs.

Severity: HIGH (defeats the “neither can move contents alone” guarantee after reseal)

3) MEDIUM — close_redemption/burn_empty_vault require both Token and Token-2022 ATAs to be passed, even if they don’t exist
Exact construct: inspect_reserves does:
- let (expected, _) = find_program_address([pda, token_program, mint], ATA_PROGRAM_ID)
- then requires a remaining account with key == expected (ReserveNotDeclared) before it even checks owner.
On a classic SPL mint, the Token-2022 ATA typically does not exist and cannot be passed (accounts that don’t exist cannot be included). This blocks redemption until the user first creates empty ATAs for both token programs.

Impact: Operational DoS and surprising coupling; not a theft, but easy to trip.

Fix: Treat “reserve ATA missing” as “not a token account” and skip (your own comment implies this), i.e., do not require presence; only if present-and-owned-by-Token parse and enforce owner/delegate/close_authority/len.

Severity: MEDIUM

4) LOW — Hardcoded Core wire format/plugin indices are brittle
Exact construct: You hardcode opcode bytes and plugin discriminants (e.g., IX_UPDATE_PLUGIN_V1 = 6, PLUGIN_PERMANENT_FREEZE_EXECUTE = 17, PLUGIN_ATTRIBUTES = 6) and construct Instruction.data by hand.

Risk: A Metaplex Core upgrade reorders variants; your CPIs silently retarget or break.

Fix: Use Core’s SDK builders, or add CI tests that decode live mainnet instructions and assert indices. Severity: LOW

5) LOW — Anyone can DoS burns by sending 1 lamport to the PDA
Exact construct: burn_empty_vault requires asset_signer.lamports() == 0. Any stranger can airdrop 1 lamport to the PDA and permanently prevent on-chain burn.

Fix: Accept and document, or remove lamports==0 as a gate (it doesn’t prove emptiness anyway). Severity: LOW

What I could not break
- No path to leave a vault thawed at end of a transaction: the open guard requires a later top-level close for the same asset and owner, and Solana transactions are atomic.
- No thaw without a genuine top-level close in the same tx: instructions-sysvar scan filters by program_id, discriminator, account[0]=asset, account[2]=owner; CPIs/ALTs/duplication don’t help.
- Owner-alone and bank-alone unsealing both rejected; config/seal/mpl_core/instructions substitution held due to seeds/address checks.
- Mint gating/provenance: mint_vault plus collection update-authority = seal PDA prevents off-program minting; initialize bound to INIT_AUTHORITY; reserve_mints non-empty cap enforced.

v1/v2 fix status (short)
- C1 “close burns on lamports==0”: fixed on close, but the fund-loss moved to burn_empty_vault (Finding 1).
- C3 “delegates survive reseal”: partially fixed for ATAs only; bypass persists via non-ATAs (Finding 2).
- C4 “brick via deposits”: iterative redeem prevents permanent brick; grief remains but acceptable.
- C6/C7/C9/C10: addressed as claimed.

Missing validation review
- Unchecked accounts are validated where needed: vault_asset via read_core_asset(owner+collection), collection cross-checked, asset_signer via seeds with MPL_CORE_ID program, seal via seeds, mpl_core/instructions via address constraints. Payer as generic Signer is OK.

The single thing to fix before holding real money
Remove the blanket thaw window and on-chain burn. Replace with a single redeem instruction that:
- unfreezes,
- performs only program-constructed SPL transfers from the reserve ATAs to declared destinations,
- re-seals and stamps,
- and never exposes an open Execute window to arbitrary CPIs.
Until then, burn_empty_vault enables permanent loss via non-ATAs, and close_redemption permits durable authorities on non-ATAs that can drain a sealed vault later.