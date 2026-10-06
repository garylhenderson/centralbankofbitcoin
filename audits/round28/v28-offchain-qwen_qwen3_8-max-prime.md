# Round 28 Independent Security Audit — CBOB Vault System v6

## R0: Round 27 Verdict Verification

I independently verified all four LOW findings from Round 27 against the current code. All four repairs are present and correctly wired:

**L1 (component_missing):** `detectMissingComponents` exists in `bank/detectors.mjs` and is called in `bank/alarm.mjs` main() via `findings.push(...D.detectMissingComponents(cfg, lockGate))`. The function correctly gates on `production`, `lockDeadlineSec > 0`, and `nowSec >= lockDeadlineSec`. **Repair holds.**

**L2 (freeze crank_problem):** `detectCrankHealth` accepts `coveredFreezes` and prunes covered freeze messages. `bank/alarm.mjs` passes `coveredFreezes: { pool: findings.some(f => f.kind === 'pool_frozen'), revenue: rev.findings.some(f => f.kind === 'revenue_account_frozen') }`. The `covered` predicate matches the exact planner strings. **Repair holds.**

**L3 (benign race logs):** `mintFailureCode` in `bank/crank.mjs` now attempts `error.getLogs(conn)` with a bounded timeout when `error.logs` is absent. The stack-based attribution correctly requires the error to originate from MINT's invoke frame. **Repair holds.**

**L4 (rehearsal lock checks):** Both `detectUpgradeAuthorityAfterLock` and `detectMissingComponents` return `[]` when `production` is false. `alarmProduction` returns false only when `CBOB_ALARM_REHEARSAL === '1'` exactly. **Repair holds.**

**D1–D4 (INFO):** Documentation corrections verified present. D4's `detectUnsweptRoyalties` text now says "no observed net balance decrease" and mentions masking by incoming royalties. **Corrections present.**

---

## R1: THE CRANK (`bank/crank.mjs`)

**No new findings.** I verified:

- `planCrank` correctly computes post-join/retire/expire weight: `w = total_active_weight + preJoinWeight - retiringWeight - expiringWeight`. Retiring vaults are excluded from `preExpires` via the `retiring` set. No double-counting path exists.
- The reveal loop strictly follows mint order from `revealed_total` and stops at the first unready vault. Captures planned this pass count as ready via `capturedThisPass`.
- `budgetPlan` correctly drops reveals (most expensive) first, preserving mint order. The cost model (`planCostLamports`) accounts for per-transaction fees plus per-reveal attribute rent.
- `judgeDistributeRefusal` correctly treats `PoolShort` as always a fault, and only treats `NothingToDistribute`/`BoostsExpireFirst`/`JoinWaitingFirst` as benign when the epoch or timestamp moved.
- The `BENIGN` regex correctly includes race codes (`AlreadyCaptured`, `AlreadyRevealed`, etc.) and excludes plan-fault codes (`BoostsExpireFirst`, `JoinWaitingFirst`).
- `mintFailureCode` correctly attributes errors to MINT via the invoke stack, preventing foreign programs from injecting benign error codes.
- The crank sends only permissionless MINT instructions; no value-moving transfers exist outside the program's own logic.

---

## R2: THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

**No new findings.** I verified:

- `detectConfigDrift` correctly skips first-observation keys (where `prev[k]` is null/undefined AND the missing flag was true), preventing false drift on initial deployment. The `carryConfigBaseline` function preserves the last non-null value across failed reads.
- `detectStandingRisks` correctly pins all production values (governance numbers, sweep bounds, boost ceilings, charter length, PoB collection). The `charter_secs` is computed as `charter_closes_at - charter_opens_at`.
- `detectDistributionOverdue` correctly handles the launch tick case (w === 0, pending_this_epoch > 0), joins_stalled, and boosts_stalled.
- `detectPoolHealth` correctly computes `owedCeil = (owed + ACC_SCALE - 1) / ACC_SCALE` and flags insolvency when `amount < owedCeil`.
- `redemptionCapacity` correctly implements the rolling-window ring arithmetic with the 64-entry cap.
- `detectUnledgeredSweeps` reads the amount from the instruction data (bytes 8–15 after the 8-byte discriminator), not from the ledger, preventing amount understatement.
- `detectSplitClaims` correctly uses chain-derived sweeps to extend the verification horizon beyond the 200-row window, preventing padding attacks.
- `applyFrozenTransitions` correctly pages a freeze once (urgent) and holds it at INFO while it stands.
- `planAlarmNotices` correctly defangs level-finding text to prevent router misclassification, while leaving urgent (one-shot) text undefanged.
- The `ALARM_KINDS` table classifies every emitted kind. Unlisted kinds default to 'once' (the loud direction).

---

## R3: THE LAYOUTS (`bank/layout.mjs`)

**No new findings.** I verified:

- Every struct field list matches the Rust source (asserted by selftest via `parseRustStruct`).
- All cross-program pinned offsets (GOV reading MINT's `minted_total`, `bare_burns_retired`, etc.) match the computed offsets.
- The SEEDS assertion (Round 24 D6 fix) is present: each seed is scraped from the program source and compared.
- `collectionPluginsHash` correctly skips the base fields (key, update_authority, name, uri, num_minted, current_size) and hashes only the plugin region.
- `readPinned` correctly checks owner, discriminator, and version before decoding.
- The `Vec<Pubkey>` reader bounds the length at 64 to prevent absurd allocations.

---

## R4: THE MONEY ARITHMETIC (`bank/accrual.mjs`)

**No new findings.** I verified:

- `credit` matches the Rust: `delta = avail * ACC_SCALE / w`, `acc += delta`, `owed += delta * w`.
- `pendingScaled` matches `owed_of`: `(weight + boost) * acc + carry - debt`.
- `reweigh` correctly moves the owed share to `carry` and restarts `debt` at the new weight.
- `ceilSats` correctly computes `(scaled + ACC_SCALE - 1) / ACC_SCALE`.
- `available` correctly computes `poolBalance - ceilSats(owedScaled)`, clamped to 0.
- The selftest verifies: Level V = 3× Level I, dust carries, no over-payment, frozen vaults stay owed, retired vaults return their share.

---

## R5: THE SWAP AND REVENUE CYCLE

### (a) Oracle math
**No new findings.** The BigInt floor computation is correct:
- `sats = lamports × sol_price × 10^(sol_expo − btc_expo − 1) / btc_price`
- The exponent handling correctly handles both positive and negative `e = sol.expo - btc.expo`.
- `minSats = expectedSats × (10000 − 150) / 10000`, rounded down (BigInt division truncates).
- The `satsPerLamport` float is used only for the deviation check, not for the on-chain floor.

### (b) Pyth account verification
**No new findings.** `readPyth` correctly:
- Checks ownership by the Pyth receiver program.
- Rejects Partial verification (level !== 1).
- Verifies the feed ID matches.
- Reads price (i64), conf (u64), expo (i32), publishTime (i64) at correct offsets for Full verification.
- The PDA derivation uses `[Buffer.alloc(2), feed_id]` under the push oracle program (shard 0).

### (c) Deviation filter
**No new findings.** `orcaSpot` computes `(sqrtPrice / 2^64)^2` in raw units. `meteoraSpot` computes `1 / (1 + binStep/10000)^activeId`. Both are compared against `satsPerLamport` with a 100 bps threshold. The float precision is adequate for this read-time filter.

### (d) Minimum out
**No new findings.** Both venues receive `minSats` as the on-chain floor. Orca's `other_amount_threshold` and Meteora's `min_amount_out` are both u64 sats. The floor is the same value used in the deviation filter's oracle computation.

### (e) The judge
**No new findings.** `judgeSwapInstructions` requires the exact 7-instruction sequence, checks:
- ComputeBudget SetComputeUnitLimit(400,000) with no priority fee
- Both ATA creations for the operator's own wallet and correct mints
- System transfer of exactly `lamportsIn` to the operator's own wSOL ATA
- SyncNative on that account
- The venue swap with correct amount, floor, direction (Orca: exact-input, a_to_b, min sqrt price), and account positions
- Token CloseAccount of wSOL back to the operator
- No extraneous Token instructions (only SyncNative and CloseAccount allowed)
- No second signer

### (f) Account derivation
**No new findings.** Orca tick arrays: `[current, current−span, current−2×span]` for a_to_b. Meteora bin arrays: `[current, current+1, current+2]` for Y→X. Both match the direction of price movement for selling SOL.

### (g) wSOL handling
**No new findings.** The swap wraps exactly `lamportsIn`, syncs, swaps, and closes. Pre-existing wSOL balance is returned to the operator via the close. The revenue delta computation (`after − opBefore`) correctly excludes pre-existing balance.

### (h) Failure and retry
**No new findings.** `classifySendFailure` correctly distinguishes refused (preflight error, on-chain failure, expired-and-absent), landed (confirmed/finalized success), and unknown. Meteora fallback only occurs on refusal, never on unknown. The open-cycle guard prevents double-swap.

### (i) Adversarial extraction bounds
The 100 bps deviation gate and 150 bps output floor bound the per-cycle extraction. A sandwich attack is bounded by the on-chain floor. A manipulated pool must stay within 100 bps of the oracle to be used. The 10 SOL cap limits per-cycle exposure. These are documented in accepted limit 10.

---

## R6: THE GATES

**No new findings.** I verified:

- `bank/selftest.mjs` FLOOR = 860, matching `run-tests.sh` DET_FLOOR = 860. The floor uses equality, not lower bound.
- `scripts/run-tests.sh` MIN_ASSERTIONS = 848, with equality check.
- `sim/swap-fork.sh` SWAP_FLOOR = 16, with equality check.
- All floors in SPEC.md are checked against every occurrence (the `matchAll` approach).
- The SEEDS assertion (Round 24 D6) is present and functional.
- The signer-set pinning correctly identifies exactly two signers (crank and swap operator).
- The control table's mechanical truth check (ON-CHAIN/AUTOMATIC/PROCEDURE) is present and bidirectional.
- `scripts/build-mainnet.sh` builds all five programs, proves the sweep helper's byte identity across mainnet/localnet/target-deploy, and behaviorally verifies INIT_AUTHORITY via deploy-and-ask.
- `scripts/cron-install.sh` correctly preserves only tagged, uncommented `--live` lines, and refuses rehearsal trees.

---

## ACCEPTED LIMITS — Four Questions

### 1. Is any limit WORSE than stated?

**No.** I verified the key limits against the code:

- **Limit 10 (swap operator):** The on-chain cap (`max_sweep_lamports`), cooldown (`sweep_cooldown_secs`), and reserve (`sol_reserve_lamports`) are all enforced in `sweep_sol_for_swap`. The guardian's `emergency_stop_sweep` is immediate and one-way. The stated bound (cap × windows until guardian stops) is accurate.

- **Limit 28 (cbBTC freeze):** The code correctly handles frozen pool (forfeit on redemption, no credit from frozen pool in `monthly_inline`), frozen vault account (deferred claim), and frozen revenue account (reported, not split). The stated consequences match the code.

- **Limit 32 (redemption rate limit):** The ring-based rolling window in BURN correctly implements `ceil(2.1% × live)` with a floor of 1 and a 64-entry cap. The stated behavior matches.

- **Limit 46 (PoB hot wallet):** The alarm watches the collection account's plugins and update authority. The stated blind spot (per-asset plugins, sampling interval) is accurate.

### 2. Is anything listed as a limit not actually a limit?

**No.** All accepted limits correspond to real code behavior or documented design decisions.

### 3. Is any DISCHARGED item not actually discharged?

**No.** I spot-checked the discharged items:
- Item 51 ($CBOB boost): The boost mechanism is fully implemented in MINT (`boost_vault`, `expire_boosts`, `set_boost_terms`) with the carry, reweigh, and `BoostsExpireFirst` gate. Suite section BO and selftest arms verify it.
- Item 54 (compute units): The measurements are recorded and the suite arms (10.1–10.4) pin them.
- Items 1a–24 (Bank/deck/distributor): The files are deleted, the imports are gone, and the selftest verifies no retired key paths are read.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**No.** Items 22, 38, 50, 52, and 53 are all explicitly marked as OPEN AND BLOCKING in the SPEC and are not treated as accepted anywhere in the code or documentation.

---

## NEW FINDINGS

### Finding 1: `txread.mjs` depends on web3.js internal `_rpcRequest` API

**Severity: LOW**

**Construct:** `bank/txread.mjs`, `readParsedTransaction` function.

**What happens:** The function accesses `conn._rpcRequest`, which is an internal (underscore-prefixed) method of the web3.js `Connection` class. This method is not part of the public API and could change or be removed in any SDK update without notice. If the SDK is updated (e.g., via `npm update` or a dependency resolution change), this method could disappear or change its signature, causing all transaction reads (alarm walk, revenue split recovery, redemption poster) to fail.

**Evidence:** The code explicitly checks `typeof conn?._rpcRequest !== 'function'` and throws, which is a good guard. However, the guard only catches the case where the method is entirely absent. A signature change (e.g., different argument format) would cause a runtime error or incorrect behavior.

**Mitigation already present:** The code validates the response thoroughly via `validateParsedTransaction`, which would catch malformed responses. The selftest exercises this with a stubbed `_rpcRequest`. The Round 27 validation records confirm the reader works with the installed SDK version (1.98.4).

**Fix:** Pin the web3.js version in `package.json` (if not already pinned) and add a selftest arm that verifies `_rpcRequest` exists and has the expected calling convention on the installed SDK. This is an operational hardening, not a code change.

### Finding 2: v1 transactions with lookup-table-loaded accounts are rejected by `txread.mjs`

**Severity: INFO**

**Construct:** `bank/txread.mjs`, `validateParsedTransaction`, the v1 branch.

**What happens:** The validation requires `m.accountKeys.every(k => k.source !== 'lookupTable')` for v1 transactions. This means any v1 transaction that uses address lookup tables to load additional accounts will be rejected as unreadable. If a future CBOB-related transaction (e.g., a redemption by a third-party client) uses v1 with lookup tables, the alarm walk would fail to process it, holding the cursor.

**Evidence:** The selftest includes a mutation test `'v1 lookup table key'` that verifies this rejection. The fixture `tests/fixtures/mainnet-v1.json` has all keys with `source: 'transaction'`, so it passes.

**Mitigation:** The code currently only creates legacy transactions. The rejection is fail-closed (holds the cursor, doesn't advance past the unreadable transaction). This is documented in the code and in the SPEC's transaction-format boundary section.

**Fix:** None needed before launch. If v1 with lookup tables becomes common in the ecosystem, the reader would need to resolve lookup-table keys. This is a future compatibility concern, not a current defect.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **Complete the mainnet dress rehearsal (item 22) with full revenue cycle coverage.** The local validator suite proves arithmetic and logic, but cannot prove the crank's I/O against a live cluster with 2,100 vaults, the revenue cycle's interaction with real Orca/Meteora pools, or the alarm's DAS reads. The rehearsal must include: one full revenue cycle through each pool, one forced post-sweep failure walked through hand recovery, and the crank's live passes with simulated RPC errors.

2. **Build the redeem page (item 50) before any holder can redeem.** Without it, items 9 and 44 (undeclared airdrops and nested vaults destroyed on redemption) have no preventive control. The page must run `judgeRedemptionCoverage` before the holder signs and sweep through the helper at execution time.

3. **Verify all `initialize` values (item 38) from `launch/mainnet-init.json` using `scripts/check-launch-params.mjs` immediately before the signing ceremony.** The two OPEN values (charter opening date and lock deadline) must be filled and marked RULED before deployment. The checker validates the JSON, not the signed transaction, so the builder must construct the `initialize` transactions from that file.

4. **Create the three cbBTC accounts (item 52) and fund the revenue address above rent exemption before the first paid mint.** The pool's ATA, the revenue address's own ATA, and the CBOBTC Squads' ATA must all exist. Road step 10 does this idempotently.

5. **Remove the upgrade authority from all five programs only after items 22, 38, 50, and 52 are complete.** The sweep helper must be deployed, verified byte-identical, and locked with the other four. The alarm must be running in production mode and reporting clean before the lock.

6. **Establish an out-of-band monitoring channel for the alarm itself.** The alarm, the revenue ledger, and the crontab all belong to one user on one box. A compromise of that box silences all detection. The deadman's switch cron is a partial answer, but an independent watcher on a separate box that checks the alarm's state file freshness and the on-chain config values would add a layer that the box-owner cannot silence.

7. **Pre-fund the swap operator wallet with at least 0.02 SOL above the `OPERATOR_FLOOR` and document the top-up procedure.** Nothing refills it automatically, and a cycle that fails for lack of fees leaves an open cycle that blocks all subsequent sweeps until hand-resolved.