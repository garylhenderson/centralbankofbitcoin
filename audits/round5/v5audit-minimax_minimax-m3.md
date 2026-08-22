# FINDINGS

## HIGH

**H-1: `set_round` has no parameter sanity checks; unlimited free minting is one vote away.**
The only validation is `closes_at > opens_at`. A ratified vote can set `price_lamports = 0`, `cap = 0`, and `closes_at = i64::MAX` simultaneously. `cap == 0` is the unlimited sentinel (`cfg.cap == 0 || cfg.minted_this_round < cfg.cap`). `price_lamports == 0` skips the transfer entirely. `closes_at = i64::MAX` never closes. Combined: unlimited free vaults, forever. The 3-wallet 48% governor majority can do this in one ratified vote. The 85/15 split is meaningless at price 0, and the ~2,100 lifetime supply is not enforced anywhere — `minted_total` is incremented but never compared to a cap. Every existing vault is diluted to zero.

Fix: in `set_round`, require `price_lamports >= MIN_PRICE`, `cap > 0 && cap <= MAX_CAP`, and `closes_at - opens_at <= MAX_ROUND_DURATION`. In `mint_vault`, require `cfg.minted_total < LIFETIME_CAP` (e.g., 2100).

**H-2: Admin can redirect the treasury via `update_wiring(treasury = Some(X))`.**
The 85% mint revenue flows to `cfg.treasury`. Admin can change it to any account at any time, instantly, with no timelock and no governance vote. The 15% Bank cut is unaffected; the 85% that should reach vault holders is lost. This is the single largest fund-flow control in the system and it sits behind one admin signature.

Fix: remove `treasury` from `update_wiring`, or gate it behind a governance vote / timelock.

**H-3: Admin can change `governance` via `update_wiring(governance = Some(X))`.**
Combined with H-1, admin sets governance to themselves, then calls `set_round` directly to mint unlimited free vaults — no vote needed. Even without H-1, admin can install a governance program that rubber-stamps anything.

Fix: same as H-2.

**H-4: Charter provenance is never stamped.**
The MINT program creates the Attributes plugin with an empty list (`data.extend_from_slice(&0u32.to_le_bytes())` for the attribute_list length). The business model requires a Notice serial and Governor standing to be stamped at mint, and states this is the *only* surviving record after the Proof-of-Burn token and Notice are destroyed. The code has no parameter for it and no path to set it later — the Attributes plugin's authority is the seal PDA, and SEAL only writes `{"redemption":"opened"}` in `close_redemption`. Charter status is permanently lost.

Fix: add a `provenance: Vec<(String,String)>` parameter to `mint_vault` and serialize it into the Attributes plugin at creation.

## MEDIUM

**M-5: Payment before CPI in `mint_vault`.**
The `system_instruction::transfer` runs before the SEAL-config check, the owner-brick check, and the Core CreateV2 CPI. If any later step fails, the lamports are already in the treasury and not refunded. A user can pay full price and receive nothing.

Fix: simulate the Core CPI first (or build the CreateV2 instruction, validate it without invoking, then transfer, then invoke).

**M-6: SEAL config byte layout is fragile and unchecked.**
MINT and BURN read raw bytes at fixed offsets: `disc[0..8] admin[8..40] collection[40..72] bank[72..104]`. The Anchor 8-byte discriminator is not verified. There is no version field. The only length check is `d.len() >= 104`. If SEAL is upgraded to insert or reorder a field, MINT and BURN silently read garbage — a collection/bank mismatch would either brick minting (fail-closed, acceptable) or, worse, pass validation against wrong fields. `SEAL_PROGRAM_ID` is a compile-time constant; a SEAL redeploy at a new address correctly fails-closed via PDA derivation, but an in-place upgrade does not.

Fix: add a `version: u8` field to SEAL's Config, verify the Anchor discriminator explicitly, and prefer `Account::try_deserialize` over raw byte slicing.

**M-7: `redemption: opened` stamp is a false-positive signal.**
The stamp is set on every `close_redemption` regardless of whether value was taken. An owner can open, sweep nothing, and close — the vault is pristine but carries the stamp. A buyer who checks only the stamp will avoid perfectly good vaults. Conversely, the stamp does not encode *how much* was taken, so a drained vault and an inspected-but-untouched vault look identical.

Fix: record the pre-open balance and only set the stamp (or set a different attribute) when the post-close balance is lower.

**M-8: Nested-vault and non-ATA completeness in `burn_vault` is caller-supplied.**
The nested-vault loop and the non-ATA token-account loop both iterate `ctx.remaining_accounts`. An account that exists but is not passed in is invisible. This is the same gap as the non-ATA enumeration gap and is explicitly the Bank's job — but the code does not enforce that the Bank has actually checked. The `declared: u8` parameter only enforces a count match, not completeness.

Fix: document the Bank duty in the instruction doc-comment, or require the Bank to sign a hash of the full PDA-owned account set.

## LOW

**L-9: `mint_vault` owner can be any non-asset-signer account, including other PDAs.**
The only owner check is `owner != asset_signer`. An owner that is a PDA which can never invoke Execute (e.g., a PDA with no signing path in any program) bricks the vault permanently. The UI blocks the asset-signer case but not other PDAs.

Fix: require `owner` to be a `Signer`, or add an explicit allowlist / deny-list of PDA owners.

**L-10: No Anchor discriminator check on the SEAL config read by MINT and BURN.**
The 8-byte discriminator is skipped. Only the key and owner are verified. Not exploitable today (only SEAL can write to the PDA), but a discriminator check is one line and removes a class of future bugs.

---

## WHAT I TRIED AND COULD NOT BREAK

- **2-of-2 bypass.** Every unseal/burn path requires both owner and Bank signatures. No instruction lets a third party move value.
- **Delegate surviving re-seal.** `inspect_reserves` checks `d[72..76]`, `d[121..129]`, `d[129..133]` and refuses on any non-zero delegate, delegated_amount, or close authority.
- **Token-2022 hidden balances.** `d.len() == TOKEN_ACCOUNT_LEN` refuses any account with extensions.
- **1-lamport ATA griefing.** Accounts whose owner is neither SPL Token program are skipped, not treated as malformed.
- **Collection rotation.** SEAL and BURN `update_config` deliberately omit `collection`. MINT's `update_wiring` can change it, but the SEAL config check then fails-closed.
- **Reserve mint dropping.** Both SEAL and BURN require the new list to contain every old mint.
- **Open/close pairing.** `open_for_redemption` requires a following `close_redemption` for the same asset and owner; `close_redemption` requires a preceding `open_for_redemption`. Solana transaction atomicity means partial failure reverts the unseal.
- **Owner = asset-signer bricking.** Explicitly refused in `mint_vault`.
- **Burn with non-zero PDA lamports.** `require!(asset_signer.lamports() == 0)` refuses.
- **SEAL config PDA spoofing.** MINT and BURN derive the PDA from `["config"]` under `SEAL_PROGRAM_ID` and verify the account owner. A fake account at the same key with wrong owner is rejected.
- **Stale hardcoded seal PDA in MINT.** Now derived at runtime via `find_program_address(["seal"], SEAL_PROGRAM_ID)`.
- **Initialize front-running.** `INIT_AUTHORITY` is a compile-time constant checked in `initialize`.

---

## THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

**Add parameter sanity checks to `set_round` and enforce the lifetime supply cap in `mint_vault`.** Without these, one ratified governor vote (3 wallets, 48% of charter vaults) sets `price=0, cap=0, closes_at=i64::MAX` and mints unlimited free vaults forever. The 85/15 revenue split becomes zero, the ~2,100 supply cap is unenforceable, and every existing vault is economically diluted to nothing. This is the only finding that turns the economic model into a one-vote kill switch; everything else is bounded by admin-multisig or Bank-co-sign assumptions that are at least nominally enforced.