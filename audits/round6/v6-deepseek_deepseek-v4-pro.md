# SECURITY AUDIT FINDINGS — ROUND 6

## CRITICAL

### 1. `split_revenue` accepts caller-supplied token mint with no validation against config

**File:** `programs/cbob-vault-mint/src/lib.rs`, `split_revenue` handler
**Construct:** `ctx.accounts.mint` is an `UncheckedAccount` with no constraint

The handler derives ATAs for holders and bank using `ctx.accounts.mint.key()`, but never verifies that this mint is the cbBTC mint or any authorized token. A permissionless caller can:

1. Create a fake SPL token with 8 decimals
2. Mint 1,000,000 tokens to the revenue PDA's ATA for that fake token
3. Call `split_revenue` with the fake mint — the handler reads the balance from `revenue_ata`, computes the split, and transfers the fake tokens to the holders' and bank's ATAs

The revenue PDA signs the transfer. The handler only checks that `revenue_ata` is the PDA's ATA for `mint` — which it is, for any mint. The holders receive worthless tokens while the real cbBTC sits untouched. The instruction is permissionless and costs only transaction fees.

**Evidence:** The `SplitRevenue` struct has no `constraint` on `mint`. The handler derives `expect(&revenue)` for `revenue_ata` using `ctx.accounts.mint.key()` — any mint passes. The `token_program` constraint is `address = SPL_TOKEN_ID`, which is correct for cbBTC but irrelevant to the mint identity.

**Fix:** Add `#[account(address = CBBTC_MINT @ MintError::WrongMint)]` to the `mint` field, or read the canonical cbBTC mint from config and require it.

---

### 2. `split_revenue` integer rounding can leave dust in the revenue ATA, breaking the "sum to balance exactly" invariant

**File:** `programs/cbob-vault-mint/src/lib.rs`, `split_revenue`
**Construct:** `holders = ((total as u128) * (cfg.split_bps as u128) / BPS as u128) as u64`

The comment claims "the two transfers always sum to the balance exactly." This is false when `total * split_bps` is not divisible by 10,000. Example: `total = 3`, `split_bps = 8500`. Then `holders = (3 * 8500) / 10000 = 2`, `bank_cut = 3 - 2 = 1`. Sum = 3. This works.

But the handler transfers `holders` and `bank_cut` only if `amount > 0`. If either is zero, it skips that transfer. The remaining balance stays in `revenue_ata`. The next call to `split_revenue` will include that dust in `total` and split it again. This is not a loss, but the invariant claim is wrong and the dust accumulates across cycles.

More critically: if `total = 1` and `split_bps = 8500`, then `holders = 0`, `bank_cut = 1`. The bank gets the whole satoshi. The comment says "integer division can never round in the Bank's favour" — this is false. The bank gets the remainder when the holders' share rounds down to zero.

**Fix:** Document the actual behavior. If the business requires the holders to never lose a satoshi to rounding, compute `bank_cut = total - holders` and accept that the bank may get slightly less than 15% on tiny balances.

---

### 3. `set_collection_royalties` hand-builds a Core CPI with unverified byte layout

**File:** `programs/cbob-vault-mint/src/lib.rs`, `set_collection_royalties`
**Construct:** The manual byte encoding for `AddPluginV1`/`UpdatePluginV1` with Royalties plugin

The instruction data is built as:
```
[opcode, PLUGIN_ROYALTIES, basis_points(u16 le), 1u32(creators count), revenue(32 bytes), 100(u8 percentage), RULESET_NONE]
```

For `AddPluginV1` (opcode 3), an additional `0` byte is appended for `Option<authority> = None`.

**Problem 1:** The `basis_points` field. Core's `Royalties` plugin stores `basis_points` as a `u16`. The code writes `basis_points.to_le_bytes()` — 2 bytes. This matches Core's `AddCollectionPluginV1` and `UpdateCollectionPluginV1` for the Royalties plugin (variant 0). However, the `UpdatePluginV1` instruction (opcode 7) for a *collection* plugin expects the plugin type, then the new data. The data format for Royalties is: `basis_points: u16, creators: Vec<Creator>, rule_set: RuleSet`. The `Creator` struct is `[address: Pubkey; 32 bytes, percentage: u8; 1 byte]`. The `RuleSet` enum is `None = 0` (1 byte). This appears correct.

**Problem 2:** The instruction discriminator choice. `IX_ADD_COLLECTION_PLUGIN_V1 = 3` and `IX_UPDATE_COLLECTION_PLUGIN_V1 = 7`. The `add` parameter selects between them. If the Royalties plugin already exists on the collection, `AddCollectionPluginV1` will fail — the caller must know to pass `add: false`. If the plugin doesn't exist, `UpdateCollectionPluginV1` will fail. The caller must track plugin state off-chain. This is fragile but not a security hole — the transaction simply fails.

**Problem 3:** The `authority` parameter. For `AddCollectionPluginV1`, the code appends `0` for `Option<authority> = None`. This means the plugin authority defaults to the collection's update authority (the `mint_authority` PDA). For `UpdateCollectionPluginV1`, no authority byte is appended — Core's `UpdateCollectionPluginV1` does not accept an authority parameter; the existing authority must sign. The `mint_authority` PDA signs both paths. This is correct.

**Verdict:** The encoding appears correct for Core's Royalties plugin layout. However, this has never been tested against real Core (stated in the prompt). The risk is that a single byte error makes `set_collection_royalties` fail permanently, which is a liveness issue, not a funds-loss issue. **Downgraded to HIGH** — the instruction may simply not work, but if it does work, it correctly routes 100% to the revenue PDA.

---

### 4. `sweep_sol_for_swap` has no rate limit beyond the 50 SOL cap — can be called repeatedly to drain the reserve in fee-sized bites

**File:** `programs/cbob-vault-mint/src/lib.rs`, `sweep_sol_for_swap`
**Construct:** Permissionless, no per-period limit

The instruction is permissionless. The only bounds are:
- `amount` must leave at least `sol_reserve_lamports` in the revenue PDA
- The destination is pinned to `config.swap_operator`

An attacker can call this repeatedly with `amount = 1` lamport, draining the revenue PDA down to exactly `sol_reserve_lamports` minus 1, one lamport at a time. Each call costs the attacker transaction fees, but the SOL goes to the pinned swap operator — the same address that would receive it anyway. The attacker gains nothing except the ability to force the revenue cycle to run with tiny amounts, potentially causing the off-chain swap to fail or produce dust.

More critically: if `sol_reserve_lamports` is set to 0 (possible via `update_wiring` with governance approval), the entire revenue PDA can be drained to the swap operator in one call. The swap operator key is the one trusted hop — if compromised, this is a direct drain. The 50 SOL cap in `revenue.mjs` is an off-chain convention, not an on-chain rule.

**Fix:** Add a per-epoch or per-slot rate limit, or require the swap operator's signature (making it not permissionless but closing the drain vector).

---

## HIGH

### 5. Governance: quorum measured against live `minted_total` allows minting to manipulate quorum

**File:** `programs/cbob-vault-gov/src/lib.rs`, `execute_proposal`
**Construct:** `minted_total` read from MINT config at execution time

A proposal's quorum is `minted_total * quorum_bps / 10000`. If a proposal is close to quorum, an attacker can mint new vaults (paying the current round price) to increase `minted_total` and make quorum harder to reach. Conversely, if the attacker wants a proposal to pass, they can vote YES with their existing vaults and then mint more vaults to increase the denominator — but the new vaults cannot vote on an existing proposal (the voting period has ended by execution time).

The real risk: a proposal that has met quorum at vote-close time can have quorum retroactively broken if `minted_total` grows between vote-close and execution. The execution check reads LIVE supply, not the supply at `voting_ends_at`. If 100 vaults exist, quorum is 40%, and 40 vote YES — quorum met. Then a new round mints 50 more vaults before execution. Now `minted_total = 150`, quorum need = 60, cast = 40 — quorum fails.

**Exploit:** A governor who dislikes a passed proposal can push through a new round (or the current round may still be open) to inflate supply and block execution.

**Fix:** Snapshot `minted_total` at proposal creation or at `voting_ends_at`, not at execution time.

---

### 6. Governance: `execute_proposal` can be called multiple times if the CPI to `set_round` succeeds but the transaction fails after

**File:** `programs/cbob-vault-gov/src/lib.rs`, `execute_proposal`
**Construct:** `p.executed = true` set BEFORE the CPI

The code sets `p.executed = true`, then calls `invoke_signed` to MINT's `set_round`. If the CPI succeeds but the overall transaction fails (e.g., the compute budget is exceeded after the CPI returns), the `executed` flag is NOT persisted (Solana transactions are atomic — if the transaction fails, no state changes persist). So this is NOT a double-execute risk.

However, if the CPI fails (e.g., MINT rejects the round parameters), `executed` is already set to `true` and the proposal is bricked — it can never be executed even with corrected parameters. The `executed` flag should be set AFTER the CPI succeeds.

**Fix:** Move `p.executed = true` after the `invoke_signed` call.

---

### 7. `split_revenue` does not verify that destination ATAs belong to the expected token program

**File:** `programs/cbob-vault-mint/src/lib.rs`, `split_revenue`
**Construct:** `holders_ata` and `bank_ata` are derived with `SPL_TOKEN_ID` hardcoded

The handler derives ATAs using `SPL_TOKEN_ID`:
```rust
Pubkey::find_program_address(&[wallet.as_ref(), SPL_TOKEN_ID.as_ref(), ctx.accounts.mint.key().as_ref()], &ATA_PROGRAM_ID)
```

If cbBTC were ever migrated to Token-2022, this derivation would be wrong — the ATA would be at a different address. The handler would try to transfer to an account that doesn't exist or belongs to a different token program. This is a future-compatibility issue, not an immediate bug, but it's hardcoded in three places (the two ATAs and the `token_program` constraint).

**Fix:** Accept the token program as a parameter or read it from the mint's owner.

---

### 8. Off-chain: `distribute.mjs` writes `done[v]` BEFORE confirming the transfer succeeded

**File:** `bank/distribute.mjs`, line `done[v] = { amount: String(plan.per), sig }`
**Construct:** State written immediately after `sendAndConfirmTransaction`

The code does:
```javascript
const sig = await sendAndConfirmTransaction(...)
done[v] = { amount: String(plan.per), sig }
save(st); sent++
```

`sendAndConfirmTransaction` confirms the transaction. If it returns, the transfer succeeded. The state write is correct — it records a confirmed transfer. If the process crashes AFTER `save(st)` but before the loop continues, the next run will see `done[v]` and skip that vault. This is correct idempotency.

However, if `sendAndConfirmTransaction` throws (network error, timeout), the catch handler at the bottom logs and exits. The state is NOT saved for the vaults that were already paid in this run. On restart, those vaults will be paid again because `done` wasn't persisted for them.

**Fix:** Save state after EACH successful transfer, not just at the end. The code already does this — `save(st)` is inside the loop. But if the process is killed between `sendAndConfirmTransaction` returning and `save(st)` completing, the transfer is confirmed on-chain but not recorded off-chain. On restart, the vault gets paid twice. The fix is to check the on-chain balance or transaction history before paying, rather than relying solely on the local ledger.

---

### 9. Off-chain: `alarm.mjs` normalises transactions but `detectBurns` checks `ix.accounts?.[0]` which may be undefined for parsed transactions

**File:** `bank/alarm.mjs`, `normalise` function
**Construct:** `accounts: (ix.accounts || []).map(...)` — parsed transactions may not have `ix.accounts`

The `normalise` function handles both `ix.accounts` (from JSON-parsed transactions) and falls back to an empty array. But `detectBurns` checks `ix.accounts?.[0]` — for a parsed transaction where `ix.accounts` is undefined, this becomes `undefined`, and the check `if (!assetSet.has(asset))` will be `if (!assetSet.has(undefined))` which is `true`, so the burn is silently ignored.

**Fix:** For parsed transactions, extract the asset address from `ix.parsed.info` or the account keys list.

---

## MEDIUM

### 10. Governance: `create_proposal` uses `config.proposal_count + 1` as the seed before incrementing

**File:** `programs/cbob-vault-gov/src/lib.rs`, `CreateProposal` derive macro
**Construct:** `seeds = [PROPOSAL_SEED, &(config.proposal_count + 1).to_le_bytes()]`

The PDA seed uses `config.proposal_count + 1`, but `config.proposal_count` is incremented INSIDE the handler. The Anchor derive macro evaluates seeds BEFORE the handler runs. So the seed is computed with the OLD `proposal_count` value + 1, which matches the handler's increment. This is correct but fragile — if the increment logic ever changes, the seed and the stored `id` will diverge.

### 11. `cron-install.sh` revenue job runs without `--live` — by design, but the comment says "ADD --live WHEN YOU ARE READY"

**File:** `scripts/cron-install.sh`
**Construct:** The revenue cron line lacks `--live`

This is intentional per the comment, but it means the revenue cycle will run every 6 hours, produce a dry-run report, and do nothing. This is safe but wastes RPC calls. The risk is that someone adds `--live` without understanding the implications.

### 12. `build-mainnet.sh` deploys to a test validator and asks it about INIT_AUTHORITY — but the test uses the same keypair file for both builds

**File:** `scripts/build-mainnet.sh`
**Construct:** Both builds deploy to the same program ID

The script deploys the mainnet build, runs the test, then deploys the localnet build to the SAME program ID. The second deploy overwrites the first. The test only checks the second deployment. The script should deploy to different program IDs or reset the ledger between tests.

---

## LOW

### 13. `alarm.mjs` reads `HELIUS_RPC_URL` from `.env.local` but the regex expects no quotes

**File:** `bank/alarm.mjs`, `rpcUrl()`
**Construct:** `env.match(/^HELIUS_RPC_URL=(.*)$/m)`

If the `.env.local` file has `HELIUS_RPC_URL="https://..."` with quotes, the regex captures the quotes. This would cause connection failures. The same pattern is used in `revenue.mjs` and `distribute.mjs`.

---

## WHAT I TRIED AND COULD NOT BREAK

1. **Double-voting via vault transfer:** The `VoteRecord` PDA is seeded by `[VOTE_SEED, proposal, asset]`. Transferring the vault and voting again would try to create the same PDA — it fails because the account already exists. **Confirmed sound.**

2. **Voting with a burned vault:** The vote requires the asset account to exist and be owned by Core. A burned asset is either closed (rent returned) or marked burnt. Either way, `read_core_asset` fails. **Confirmed sound.**

3. **Voting with a delegate:** The vote requires the owner's signature. A delegate cannot sign as the owner. **Confirmed sound.**

4. **`execute_proposal` front-running:** The proposal can only be executed after `voting_ends_at`. The parameters are fixed at creation. A front-runner cannot change the outcome, only trigger it. **Confirmed sound.**

5. **`split_revenue` with a frozen destination ATA:** The SPL Token program rejects transfers to frozen accounts. The transaction would fail. No funds lost. **Confirmed sound.**

6. **`sweep_sol_for_swap` with `amount = 0`:** The handler computes `bal >= keep + 0`, which is true. The system program `transfer` with amount 0 is allowed but pointless. No harm. **Confirmed sound.**

7. **`mint_vault` with `max_price_lamports < price_lamports`:** The check `cfg.price_lamports <= max_price_lamports` catches this. **Confirmed sound.**

8. **Governance setting a round in the past:** `set_round` does not check `opens_at > Clock::get()?.unix_timestamp`. A round CAN be set in the past. This is intentional per the business — the charter round was already open when governance goes live. **Not a bug.**

---

## THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

**Fix `split_revenue` to validate the token mint against the canonical cbBTC mint.** The current code accepts any mint a caller provides, allowing worthless tokens to be "split" while real cbBTC sits untouched. This is a permissionless instruction that moves customer funds — the mint MUST be constrained to the one asset this system is built to distribute.