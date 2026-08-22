## FINDINGS

### 1. MEDIUM — `split_revenue` does not constrain the mint parameter
`programs/cbob-vault-mint/src/lib.rs` `split_revenue` accepts an arbitrary `mint: UncheckedAccount` from the caller. The handler derives ATAs from the config's `treasury` and `bank_treasury` against the passed mint, verifies the destination accounts match, then reads the balance and splits. Nothing checks the mint against the reserve set or any allowlist. An attacker can call `split_revenue` with a worthless airdropped token held at the revenue PDA, forcing creation of ATAs at the holders' and bank's addresses and transferring dust. The 85/15 rule is enforced, but against the wrong token. The comment ("Works for ANY token, so a future income source denominated in something else needs no new code") names the design intent but not the consequence: any airdrop is splittable. Cost to attacker: rent for two ATAs and a transaction fee. Fix: pass the mint through the SEAL config's reserve set (or add a small `allowed_mints` field to MINT's config) and reject unknown mints.

### 2. LOW — `create_proposal` permits `opens_at` in the past
`programs/cbob-vault-gov/src/lib.rs` `create_proposal` checks `closes_at > opens_at` and `closes_at - opens_at <= MAX_ROUND_SECS`, but does not check `opens_at >= now`. `execute_proposal` checks only `closes_at > now`. A hostile majority can ratify a proposal with `opens_at = 0` (1970) and `closes_at = now + 1 day`, passing both checks, and the round opens the instant execution lands. MINT's `set_round` accepts any `opens_at`, so this is not a new MINT-level capability, but it lets governance skip the `opens_at` they published. Voters can see `opens_at` on-chain before voting, so the disclosure is not hidden — but the round they thought opened "next week" opens "now". Fix: add `require!(opens_at >= now, GovError::BadWindow)` in `create_proposal` (or document the asymmetry explicitly).

### 3. MEDIUM — alarm reads configs by raw offset and does not fail on layout change
`bank/alarm.mjs` `readConfigs()` reads MINT, SEAL, BURN, and GOV configs by hard-coded byte offsets (e.g., `mint.minted_total` at offset 205, `mint.split_bps` at 253, `mint.max_sweep_lamports` at 297). The version byte is read and included in the drift snapshot, but the function does not abort or refuse to report when the version differs from the compiled-in expected value. If any program is upgraded and inserts a field before a watched offset, every subsequent field is misread silently. The `detectConfigDrift` will fire on the version change, but the alarm has already produced a report full of garbage fields. The on-chain programs pin each other's configs by discriminator AND version and refuse on mismatch; the alarm should do the same. Fix: read the version, compare to the alarm's compiled-in expected version per program, and if they differ, emit a single CRITICAL ("alarm cannot read this program's config — refuse to interpret fields") and skip the rest of the pass.

### 4. LOW — `sweep_sol_for_swap` does not verify the operator is a system-owned account
The transfer destination is `ctx.accounts.swap_operator.key()`. The operator is a `Signer` and matches the pinned config key. But the handler does not verify `acc.owner == &system_program` or that the account is writable. A swap operator whose account is owned by a non-system program (e.g., a token account) would either fail the transfer (caught, not a funds loss) or, if writable, receive SOL that it cannot use. Not exploitable in practice (the operator is loaded from a local keypair), but a defense-in-depth check would catch a future wiring mistake.

### 5. LOW — `set_collection_royalties` does not assert the plugin does not already exist when `add=false`
`programs/cbob-vault-mint/src/lib.rs` `set_collection_royalties` takes `add: bool` from the caller. If `add=false` (UpdatePluginV1) and the Royalties plugin is not yet installed, the CPI fails. The handler does not pre-check, so a caller who picks the wrong opcode gets a revert. This is a UX issue, not a funds issue — but a one-byte discriminator check on the collection account before building the CPI would save a transaction fee and give a clearer error.

## THINGS I TRIED TO BREAK AND COULD NOT

- **Vote twice on the same proposal**: blocked by the vote-record PDA at `["vote", proposal, ASSET]` (`init` constraint).
- **Vote with a burned vault**: `read_core_asset` rejects a Core asset whose first byte is not `KEY_ASSET_V1` or whose data is empty.
- **Vote with a non-collection vault**: `require_keys_eq!(collection, config.collection, ForeignVault)`.
- **Vote by a delegate**: the owner must be a `Signer`; a delegate is not the owner.
- **Execute a proposal twice**: `executed` flag plus the monotonic `last_executed_id` check.
- **Execute a proposal after the window**: `now <= voting_ends_at + EXECUTION_WINDOW_SECS`.
- **Execute a proposal with an already-over round**: `closes_at > now`.
- **Set a round with `cap = 0`**: `cap > 0` in `set_round` and `create_proposal`.
- **Set a round with window > 1 year**: `checked_sub` bound in both programs, asserted by the suite.
- **Mint past the lifetime cap**: `minted_total < max_supply` in `mint_vault`.
- **Mint past the round cap**: `minted_this_round < cap`.
- **Mint at a higher price than agreed**: `price_lamports <= max_price_lamports`.
- **Mint during pause**: `!paused`.
- **Burn a non-empty vault**: reserve-ATA balance check, PDA-lamport check, nested-asset check, Token-2022 length check.
- **Burn a non-collection vault**: collection check.
- **Sweep without the operator signature**: `swap_operator: Signer` plus `require_keys_eq!` against config.
- **Sweep above the cap**: `amount <= max_sweep_lamports`.
- **Sweep too soon**: `now >= last_sweep_at + cooldown` with `checked_add`.
- **Sweep below the reserve**: `bal >= keep + amount` with `checked_add`.
- **Split to wrong destinations**: ATAs derived from config and matched against passed accounts.
- **Open without a close**: instruction introspection in `open_for_redemption`.
- **Close without an open**: instruction introspection in `close_redemption`.
- **Re-seal with a delegate**: `inspect_reserves` refuses delegate/close-authority bytes.
- **Rotate governance instantly**: timelock + armed-then-applied.
- **Rotate admin instantly**: timelock + armed-then-applied; cancel requires current admin.
- **Execute a superseded proposal**: `p.id > last_executed_id`.
- **Pre-fund the next Proposal PDA to block creation**: measured in round 6; 2,000,000 lamports does not block `init` on a 0-data account. Permanent test in place.
- **Pre-fund a VoteRecord PDA to block voting**: same mechanism — `init` on a 0-data pre-funded account still works. Not separately tested in the suite but the proposal test demonstrates the behaviour.
- **Open a vault with `asset_signer` as owner**: blocked — the owner must be a `Signer`, and a PDA cannot be a `Signer`.
- **Mint with `max_supply` silently raised**: `max_supply` ratchets down only in `update_wiring`.

## THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

**Constrain the mint in `split_revenue`.** Today, any airdropped token at the revenue PDA is splittable by any caller. The fix is a one-line check against an allowlist (the reserve set, or a new `allowed_mints` field in MINT's config). Without it, a grief actor can repeatedly force ATA creation at the holders' and bank's addresses and transfer worthless tokens into them, which clutters the distribution pipeline and could mask a real balance in the same ATA on a future inspection. It is not a direct loss of customer funds, but it is the one place where a caller-controlled field is read without verification in an instruction that moves tokens.