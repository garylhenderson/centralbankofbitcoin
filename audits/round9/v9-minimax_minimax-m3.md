# ROUND 9 FINDINGS

## FINDINGS

### MEDIUM — `set_collection_royalties` encoding may be missing a `Data` variant byte

**Construct**: `programs/cbob-vault-mint/src/lib.rs`, `set_collection_royalties`, hand-built Core CPI data vec.

**The bytes produced** (for `add=true`, one creator):
```
[IX=3, PLUGIN_ROYALTIES=0, basis_points(2), creators_len(4), creator(33), rule_set(1), init_auth=0(1)]
```

**What modern Metaplex Core expects** (borsh):
```
[3, 0, 0, basis_points(2), creators_len(4), creator(33), rule_set(1), 0]
```
The extra `0` is the `AddCollectionPluginV1Args::Data` enum tag that was introduced when the args were wrapped in an enum. An older Core (pre-wrap) accepted the data directly and the code is correct for that version.

**What I cannot prove from the materials in front of me**: which Core version the pinned sha256 `f03e7537…` corresponds to, and whether the bytes the code emits are the bytes that pinned Core decodes. The in-program comment claims the format was "read off instructions built by the official SDK", and a comment in MINT says `set_collection_royalties` "now does" run against real Core. The selftest does not include an assertion I can see for this path.

**Concrete risk if the encoding is wrong for the pinned Core**: every call to `set_collection_royalties` reverts on-chain, the collection's Royalties plugin is never installed, and secondary-market royalties do not flow to the revenue PDA. The sale still works, mints still work, the split still works — but a permanent revenue line is silently dead from day one. Not a customer-funds loss; a project revenue loss that is hard to notice because nothing else changes.

**Fix**: add an explicit selftest that calls `set_collection_royalties` against the pinned-Core validator with both `add=true` and `add=false`, reads the collection account back, and asserts the Royalties plugin decodes with the expected `basis_points` and the revenue PDA as the sole creator. The current suite proves the program loads; it does not prove Core accepted the bytes and stored what the program thinks it stored.

---

### LOW — `burn_vault` does not re-verify delegate/close-authority on non-canonical PDA-owned token accounts

**Construct**: `programs/cbob-vault-burn/src/lib.rs`, second `for` loop in `burn_vault` (the non-reserve completeness loop).

The reserve loop checks `d[72..76]` (delegate), `d[121..129]` (delegated_amount), `d[129..133]` (close_authority). The non-reserve loop only checks `d.len() == 165` and `amount == 0`. A non-canonical token account owned by the asset-signer PDA, holding zero of an unknown mint, with a live delegate and a non-zero `close_authority`, passes the emptiness proof.

**Why this is LOW, not CRITICAL**: after a successful `Core::BurnV1`, the asset account is destroyed, the asset-signer PDA can no longer be reached through any instruction, and the Token program will not honour a delegate whose authority PDA is unreachable. A delegate on a zero-balance account is harmless once the asset is gone. The real risk is a future Core change that preserves the PDA, or a non-burn path (a future instruction that drains without burning) — neither exists today.

**Fix**: add the same three checks (`d[72..76]`, `d[121..129]`, `d[129..133]`) to the non-reserve loop. Cost is six comparisons, removes the class.

---

### LOW — `distribute.mjs` resumes a plan against a stale `available` without re-reading it

**Construct**: `bank/distribute.mjs`, plan-resume branch. The stored `plan.per` is reused, but the chain's `available` (the distributor's cbBTC balance) is not re-checked. If the distributor ATA was drained between plan and resume (compromised key, manual transfer, fat finger), every transfer on resume fails as `insufficient funds`, the day is left unfinished, and the next morning's run starts a fresh plan against a still-low balance.

**Why this is LOW**: the distributor key is held by the same operator that holds the swap key, and the off-chain pipeline is the only place that touches it. The threat is operational, not adversarial. The script does alarm (exit 1, SMS) on a day with `failed.length > 0`, and the alarm detector catches an unfinished day.

**Fix**: on resume, re-read `available` once. If it has fallen below `plan.total`, either re-plan (with the same `activated` set) or stop and alarm. Equality is preserved; the failure mode becomes a loud refusal rather than a day's silent stall.

---

## WHAT I TRIED AND COULD NOT BREAK

**GOV program, fresh in this audit.**
- A vault votes once per proposal: `VoteRecord` PDA seeded by `[VOTE_SEED, proposal, asset]` makes a second `init` revert. Verified by reading `cast_vote` and the accounts struct.
- A delegate cannot vote: `read_core_asset` reads `data[1..33]` as the owner; the Core owner field is what the SPL delegate does not touch. Verified.
- A burned vault cannot vote: `data[0] == KEY_ASSET_V1` fails on a destroyed Core account. Verified.
- A vault minted after a proposal opened can vote, but the divisor is `max(snapshot, live)` (round-8 fix), so a new mint raises the bar faster than it raises the vote count. Verified the math against the comment.
- `quorum_bps`/`threshold_bps` are now snapshotted into the Proposal at creation; `execute_proposal` reads no config value for the tally. Verified by grepping `execute_proposal` for any read of `config.quorum_bps` / `config.threshold_bps` — none exists.
- Execution is monotonic: `require!(p.id > config.last_executed_id)` plus `p.executed = true` before the CPI. Verified.
- `quorum_supply` is snapshotted at `create_proposal` from `read_mint_config`, which is pinned by address + owner + discriminator + version. Verified.
- The CPI to MINT's `set_round` passes exactly the two accounts `SetRound` requires (`config` writable, `governance` signer-as-PDA), with the discriminator + 4 LE fields in the order MINT's borsh expects. Verified by hand against the MINT signature.
- `IX_SET_ROUND` is annotated as "COMPUTED, not guessed — the first draft of this constant was wrong". The eight bytes `[44, 204, 0, 190, 137, 127, 106, 78]` are what `sha256("global:set_round")[..8]` produces. I cannot re-run the hash here, but the selftest exercises `execute_proposal` end-to-end against the pinned validator, so a wrong discriminator would have failed the suite.
- `MIN_QUORUM_BPS = 500` and `MAX_THRESHOLD_BPS = 7_500` bound the levers in both `initialize` and `update_gov_config`. Verified.
- Round-8 fix for `last_executed_id` offset (94, not 93) is in place in the alarm's `readConfigs`. Verified against `GovConfig` layout.
- Round-7 fix for `min_voting_secs` (config value, floor 60) is paired with the alarm's `weak_voting_period` detector at 3 days. Verified both ends.

**MINT revenue path.**
- `split_revenue` derives `revenue`/`treasury`/`bank_treasury` ATAs from config and requires the caller's accounts to match exactly. A hostile caller cannot redirect. Verified.
- `split_bps = 8500` produces `bank_cut = total * 1500 / 10000`; holders take the remainder. The two transfers sum to `total` exactly because `holders = total - bank_cut`. Verified the arithmetic and the comment.
- `sweep_sol_for_swap` is operator-signed, capped by `max_sweep_lamports`, cooled by `sweep_cooldown_secs`, reserves `sol_reserve_lamports` (zero or ≥ rent-exemption), and pins the destination in config. The round-6 grief handle (zero-lamport sweep consuming the cooldown) is closed by the operator-signer requirement plus `amount > 0`. Verified.
- The swap transaction is checked for exactly one signer and no `BPFLoaderUpgradeable` / `MINT_PROGRAM` in the static keys, and the `addressTableLookups` count is capped. Known-bounded, acknowledged-not-proof in the code's own comment.
- `revenue.mjs` writes the cycle intent BEFORE the send, distinguishes REJECTED from UNCONFIRMED, and refuses to start a new cycle while one is open. Verified.
- The pre-sweep and post-sweep quotes both check `priceImpactPct` is present and within `MAX_PRICE_IMPACT_PCT`, and the post-sweep output is floored against the pre-sweep output at `MAX_REQUOTE_DRIFT_BPS`. Verified.
- The recorded return is the operator ATA **delta** (`after - opBefore`), not the whole balance, so pre-existing cbBTC on the operator does not reconcile a short swap. Verified.
- `OPERATOR_FLOOR = 0.02 SOL` is checked before the sweep. Verified.

**BURN.**
- The reserve list is read from SEAL's config at burn time, not from a BURN-local copy. The two cannot diverge. Verified.
- The non-reserve loop catches a Token-2022 account by length (`d.len() == 165`) and refuses to reason about extensions. Verified.
- The `minted_total` / lifetime cap is enforced in MINT's `mint_vault`, and the per-round cap is enforced in the same instruction. A ratified proposal cannot install `cap = 0` (round-6 fix) or `closes_at = i64::MAX` (round-6 fix, measured by the overflow test in the suite).

**SEAL.**
- The five-round-survivor held. `open_for_redemption` requires a matching `close_redemption` later in the same transaction (discriminator + asset + owner index 2). `close_redemption` requires a matching `open_for_redemption` earlier (discriminator + asset). The pair is bound.
- `inspect_reserves` refuses any reserve ATA with a delegate, delegated amount, or close authority. Token-2022 lengths are refused. Verified.
- `mark_opened` PRESERVES other attributes; only `redemption` is rewritten. Verified by reading the filter `filter(|(k, _)| k != ATTR_REDEMPTION)`.

**Off-chain pipeline, first audit.**
- `withLock` from `bank/lock.mjs` is used by `alarm.mjs`, `revenue.mjs`, and `distribute.mjs` on distinct lock files, with stale-break timeouts. Two passes cannot race; a crashed lock self-heals after `staleMs`.
- `readLedger`/`writeLedger` use a `.has-run` marker so deleting a money ledger after first use is a refusal, not a fresh start. Verified the `MARKER` argument in every loader.
- The alarm advances cursors only over a window read end-to-end, pages to the sentinel, and reports a `scan_gap` rather than truncating silently. The state file is written AFTER the alert is sent, so a CRITICAL whose email failed is re-reported next pass. Verified the order: `report()` before `writeState()`, and on `!delivered` the previous cursors/balances/activation are restored.
- The daily distribution's "one plan per UTC day" is a read-then-write of `st.days[day].plan` inside the lock; two cron-vs-manual runs cannot both create a plan because the second sees the first's plan and reuses it. The mid-run burn check skips a vault whose Core data no longer reads as `KEY_ASSET_V1`. The intent row is written before each transfer, so a confirmation-timeout-on-landed-tx is reported as `ambiguous` rather than silently re-sent.
- `detectIndexShortfall` throws on a non-array input, so the round-7 dead-call-site bug is now a loud refusal. The alarm passes arrays (the result of `listVaults`); the round-7 selftest asserts the throw.
- The Core byte-identity gate is the pinned sha256 `f03e7537…`, verified by the run-tests.sh hard gate, not by a self-comparison.

**Operations.**
- `run-tests.sh` waits for the ports, kills by the truncated `comm` (`solana-test-val`), asserts Core is on the validator, compares against the pinned sha256, and asserts the suite produced `N/N ≥ 160` assertions with no override. `CBOB_TEST_FILE` is refused. Verified.
- `build-mainnet.sh` deploys all four programs in BOTH builds, asks each one whether it trusts the test key, and requires "REJECTS" from mainnet and "ACCEPTS" from localnet for all four. The banner says only what was measured. Verified.
- `cron-install.sh` runs as `ubuntu` (refuses `sudo`), de-dupes by the explicit `$TAG` (the round-6 substring bug cannot recur), preserves an operator's `--live` on the revenue line, and points the deadman at `$CBOB_ALARM_STATE` (the same env var the alarm honours). Verified.

---

## THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

**Add an end-to-end selftest for `set_collection_royalties` against the pinned-Core validator** — both `add=true` and `add=false`, asserting that the collection account, read back through the same Core instruction the marketplace would use, decodes the Royalties plugin with the expected `basis_points` and the revenue PDA as the sole creator at 100%. The current suite proves the program loads, dispatches, and signs; it does not prove Core accepted the hand-built bytes and stored what MINT thinks it stored. If the encoding is off by one byte for the pinned Core version, every primary mint works, every redemption works, every distribution works, and a permanent revenue line is silently dead from day one. A two-case test closes it for the cost of one assertion file.