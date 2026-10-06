# INDEPENDENT AUDIT — ROUND 29, OFF-CHAIN PIPELINE

Audited tree: HEAD `de3d56f` (repair commit), working tree clean. All files read whole. No live jobs, no notifications, no transactions sent. All claims below are source-level; where I assert a runtime behavior I name the evidence that would confirm or refute it.

---

## R0. ROUND 28 VERDICT AND REPAIRS

**Verdict disposition: the five code repairs are present and structurally correct. I verified each independently.**

**M1 (log truncation):** `bank/txread.mjs` now contains `need(!meta.logMessages.includes('Log truncated'), 'logs truncated by runtime')`. The array-element equality check is correct: a program logging `"Program log: Log truncated"` does NOT match because the runtime marker is a standalone array element. The selftest arm `R28 M1: user log text cannot impersonate the runtime marker` confirms this. **Repair holds.**

**L1 (clock separation):** `bank/alarm.mjs` now reads `wallSec = Math.floor(Date.now() / 1000)` and `nowSec = clockUnixTimestamp(...)` from the Clock sysvar, and refuses the pass if the sysvar is unreadable. Chain-deadline detectors (`detectDistributionOverdue`, `detectUpgradeAuthorityAfterLock`, `detectMissingComponents`) receive `nowSec`; local-duration detectors (`detectCrankSilent`, watchdog gap) receive `wallSec`. The `cycleStartMs` translation `nowMs - (chainNowMs - at)` correctly converts chain block times into the wall-clock domain for age comparisons. The R28 selftest arms exercise ±7h skew. **Repair holds.**

**L2 (heartbeat truncation):** `bank/crank.mjs` writes `plan.problems` without any `.slice()` or length cap. The R28 selftest arm drives 150 rotating problems through three heartbeats and confirms all 150 reach `crank_problem`. **Repair holds.**

**L3 (rehearsal launch/):** `scripts/rehearsal-tree.sh` python block now includes `'launch'` in the `git ls-files` path list. The R28 selftest arm confirms that removing `'launch'` from the substitution scope defeats the isolation check. **Repair holds.**

**L4 (retained redemption evidence):** `bank/alarm.mjs` now persists `next.seenRedemptions = D.rememberRedemptions(prev?.seenRedemptions || [], findings)` and passes it to `correlateBurns`. The `rememberRedemptions` function correctly filters to `burn_via_program` findings with both `asset` and `signature` strings. The R28 selftest arm confirms that evidence from pass N correlates a DAS burn in pass N+1. **Repair holds.**

**D1/D2 (INFO documentation):** These are documentation corrections. D1 (SPEC opening says "not yet a multi-model round") — I confirm the stale sentence is still present in the bundled SPEC.md. D2 (HOLDER-GUIDE timing) — the opening says "a few seconds" while the reveal lane runs every minute. Both remain uncorrected in the bundled text. These are INFO and do not affect code correctness.

**No regressions introduced by the repairs.** The clock separation does not break any existing detector; the heartbeat change does not break the alarm's `readCrankBeat`; the rehearsal change does not break the reverse-proof.

---

## R1. THE CRANK (`bank/crank.mjs`)

**No CRITICAL or HIGH findings.**

The plan/send order is correct: reschedule → capture → reveal (FIFO, stops at first failure) → retire → preJoins → preExpires → split → distribute → postExpires → activate → claims. The round-28 RT3 finding 6 repair (activate after distribute) is in place.

The `judgeDistributeRefusal` correctly distinguishes race conditions (epoch moved → benign) from plan errors (epoch unmoved → fail). `PoolShort` is always a fail. The `BENIGN` regex covers all expected race codes.

The `budgetPlan` correctly drops reveals from the end (preserving FIFO order) and pages the dropped count. The `planCostLamports` correctly counts each reschedule/capture/reveal/retire/activate as one transaction, claims as batches, and joins/expires as batches.

**One observation (not a finding):** The reveal loop breaks on the first unreadable asset (`how === 'skip'`). This is necessary for FIFO correctness but means a single transient RPC failure on one asset blocks all subsequent reveals until the next pass (1 minute). This is by design and documented.

---

## R2. THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

**No CRITICAL or HIGH findings.**

The `WATCHED_KEYS` / `missingWatchedKeys` mechanism correctly ensures every watched key is produced by `readConfigs`. The `carryConfigBaseline` correctly carries forward the last non-null value across failed reads. The `detectConfigDrift` correctly skips keys whose program was absent in the previous snapshot (L11 repair) and third-party keys entering the watch for the first time (I2 repair).

The `detectUnsweptRoyalties` correctly extends the grace period when `cooldownSecs` is provided: `graceSecs = max(24h, cooldown + 1h + 1h)`. The balance-fall clock restart is correct (only a sweep can move SOL out of the revenue PDA).

The `applyFrozenTransitions` correctly pages a freeze once (URGENT) and holds it at INFO while it stands. The `coveredFreezes` pruning in `detectCrankHealth` correctly handles the pool-freeze and revenue-freeze cases. The combined-blocker case (pool frozen + Squads frozen) is intentionally NOT pruned because the Squads freeze has no separate transition detector — this is correct behavior, confirmed by the R27 selftest arm.

**One observation:** `seenSplits` and `seenSweeps` grow without bound across alarm passes. They are deduplicated but never pruned. Over years of operation this could become a storage concern. Not a correctness issue; the `verifyLastN` window in `detectSplitClaims` bounds the verification work.

---

## R3. THE LAYOUTS (`bank/layout.mjs`)

**No findings.**

All five struct definitions match the Rust field-for-field (verified by the selftest's `parseRustStruct` arms). All cross-program offsets match (the selftest's L2 arm scrapes every `OFF_` constant from all four programs and compares). The SEEDS are validated against the Rust constants (D6 arm). The layout versions match (L6 arm). The BOOST_RING size matches (L6 arm). The account space constants match (L13c arm).

The `decode` function correctly refuses wrong discriminators, wrong versions, truncated accounts, and invalid bool bytes. The `readPinned` function correctly checks owner, discriminator, and version before decoding.

---

## R4. THE MONEY ARITHMETIC (`bank/accrual.mjs`)

**No findings.**

`credit`, `pendingScaled`, `ceilSats`, `reweigh`, and `debtAtActivation` all match the Rust implementations exactly. The selftest's 39 allocation assertions cover the key properties: Level V = 3× Level I, dust carries, no overpayment, activation timing, boost carry/expiry.

The crank's owed calculations for pre-expired boosts and pre-joined vaults correctly mirror the program's behavior. The `preJoinWeight` uses level weight only (matching `join`), while `retiringWeight` uses full weight including boost (matching `retire`).

---

## R5. THE SWAP AND REVENUE CYCLE

**(a) Oracle math:** Correct. The exponent handling `e = sol.expo - btc.expo` with the num/den adjustment is verified. The integer division truncates in the vault's favor (fewer sats expected → lower floor → more conservative). The `satsPerLamport` float conversion is safe for current price magnitudes (both prices < 2^53).

**(b) Pyth verification:** The ownership check + derived PDA is sufficient. The account is a PDA of the push oracle program, owned by the receiver program. Only the receiver can write to it, and it verifies Wormhole guardian signatures before writing. An attacker would need to compromise the receiver's upgrade authority (watched by alarm) or the Wormhole guardians. The `readPyth` layout offsets are correct for the Full verification case.

**(c) Deviation filter:** `orcaSpot` = (sqrtPrice/2^64)^2 in raw units. `meteoraSpot` = 1/(1+binStep/10000)^activeId. Both are the correct spot price in sats per lamport for their respective pool orientations. The 100 bps threshold with `<=` inclusion is correct. Float rounding at the boundary is negligible (< 0.0001 bps).

**(d) Minimum out:** Both venues receive `minSats` from the same `oracleFloor` computation. Orca's `other_amount_threshold` at data offset 16, Meteora's `min_amount_out` at data offset 16. Both are u64 little-endian. The floor is 150 bps below the oracle expectation, rounded down. Correct.

**(e) The judge:** Complete for the stated threat model. It checks: exact 7-instruction sequence, no priority fee, correct ATA creations (owner, mint, payer), exact wrap amount, SyncNative, venue swap with correct amount/floor/direction/key positions, single CloseAccount back to owner. The round-25 L1 arms test 8 tampers on both venues. The judge cannot catch a tampered module in the same file tree (documented, accepted limit 10(3)).

**(f) Account derivation:** Orca tick arrays: current, then two below (a_to_b decreases price). Correct for negative ticks (floor division handles it). Meteora bin arrays: current, then two above (Y→X increases active bin). Correct for negative ids. The bitmap extension is passed as program ID when absent (Anchor None convention). Correct.

**(g) wSOL handling:** Wrap exactly `lamportsIn`, SyncNative, swap, CloseAccount. If the wSOL ATA already exists with a balance, the System transfer adds to it and SyncNative updates the balance. The swap consumes `lamportsIn` worth. The CloseAccount returns any remainder. If the swap consumes less than input (shouldn't happen with exact-input), the remainder is returned by the close. Correct.

**(h) Failure and retry:** Orca first, Meteora only on refusal. `classifySendFailure` correctly distinguishes refused (nothing moved), landed (record it), and unknown (stop, keep cycle open). An uncertain send never triggers a fallback venue. The ledger stays open until a cbBTC return is proven. Correct.

**(i) Extraction bounds:** With 100 bps deviation gate and 150 bps floor, the maximum per-cycle extraction via a sandwich is bounded by the 150 bps floor slippage plus the pool fee (0.16% for Orca). At the ruled 10 SOL cap (~$1,200 at current prices), this is ~$20 per cycle, ~$80/day at 4 cycles. Not material. A manipulated Meteora pool (10× thinner) could deviate up to the 100 bps gate before being skipped. The oracle floor still bounds the output. Not material at cycle size.

**One LOW finding:**

**R5-LOW: `splitsSince` in `bank/revenue.mjs` does not catch errors from `readParsedTransaction`.** After the round 28 M1 repair, `readParsedTransaction` throws for transactions with truncated logs or other malformed metadata. If such a transaction exists in the revenue ATA's signature history, `splitsSince` will throw, propagating up through the recovery block and causing the revenue cycle to exit with an error. The next cron run retries and fails again, creating a persistent failure loop until a human investigates. The failure IS reported (via `publishRevenueNotices`), so it's not silent, but it blocks the open-cycle recovery indefinitely.

*Evidence if true:* A revenue cycle with an open cycle whose recovery calls `splitsSince`, where the revenue ATA's history contains a transaction with `Log truncated` in its logs. The revenue log would show repeated `CBOB REVENUE CYCLE FAILED (recovery)` errors.

*Fix:* Wrap the `readParsedTransaction` call in `splitsSince` with a try/catch that skips unreadable transactions (or collects them as a separate warning), rather than letting the error propagate. The recovery should be resilient to individual unreadable transactions in the history.

---

## R6. THE GATES

**No findings of arms that cannot fail.**

The `floor()` function in `run-tests.sh` requires EQUALITY (`-eq`), not just a lower bound. Deleting assertions drops the count below the floor; adding assertions raises it above. Both fail. The `MIN_ASSERTIONS=855` for the on-chain suite, `DET_FLOOR=888` for detectors, `ALLOC_FLOOR=39`, `POSTER_FLOOR=22`, `MAINNET_FLOOR=33`, `LAUNCH_FLOOR=47`, `POB_FLOOR=14`, `HOST_FLOOR=6`, `EXPIRY_FLOOR=4`, `SWAP_FLOOR=16` are all equality-checked.

The `bank/selftest.mjs` `FLOOR=888` is equality-checked against `R.length`. The selftest reads source files from the repo root (patched in rehearsal), so the source-pattern arms test the actual deployed code.

The `scripts/build-mainnet.sh` correctly verifies all five programs: four by behavioral test (mainnet rejects test key, localnet accepts), sweep helper by byte-identity across three artifacts. The dirty-tree refusal and commit recording are in place.

The `scripts/cron-install.sh` correctly refuses rehearsal trees, preserves only tagged uncommented `--live` lines, and installs exactly six jobs. The `flock -n` wrapping is asserted by `judgeCronTemplate`.

**One LOW finding:**

**R6-LOW: `scripts/check-launch-params.mjs` does not verify `cbob_release_wallet` is on-curve.** The checker validates `cbob_release_wallet` as a valid public key (`isKey`) and pins it to `CBOB_RELEASE_WALLET`, but does not include it in the `onCurve` check list (which covers `init_authority`, `guardian`, `swap_operator`). If the release wallet were off-curve (a PDA), nobody could sign for it to release $CBOB, permanently locking the entire supply.

*Mitigation:* The value is pinned to a known on-curve address, and the actual signing uses the key file (`bank/keys/cbob-release.json`), not the JSON address. A misconfiguration here would require editing both the JSON and the constant, which resets the freeze counter.

*Evidence if true:* `launch/mainnet-init.json` with `cbob_release_wallet` set to an off-curve address; `check-launch-params.mjs` would pass.

*Fix:* Add `'cbob_release_wallet'` to the `onCurve` check list in `judgeLaunch`.

---

## ACCEPTED LIMITS — THE FOUR QUESTIONS

**1. Is any limit WORSE than stated?**

No. I checked limits 10, 25, 26, 27, 28, 32, 40, 41, 46, 47, 55, 56 against the code. Each is accurately stated. Limit 10's "cap × cooldown windows" bound is enforced on-chain by `sweep_sol_for_swap` (cap check, cooldown check, operator signature, guardian stop). Limit 32's rolling window is correctly implemented with the 64-slot ring. Limit 40's three Core-upgrade consequences are accurately described.

**2. Is anything listed as a limit not actually a limit?**

No. All ACCEPTED items describe real residual costs. The DISCHARGED items (51, 54, 12/17, 14, 19, 30, 31, 33) are genuinely closed by construction or by measurement.

**3. Is any DISCHARGED item not actually discharged?**

No. Item 51 ($CBOB boost) is built and tested (suite BO arms, crank expiry, alarm `boosts_stalled`). Item 54 (compute) is measured. Items 12/17 (CU) are measured. Item 14 (duplicate attributes) is refused on-chain. Item 19 (unlevelled halt) is closed by construction. Items 30, 31, 33 are superseded by stage 3b/3c.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

No. Items 22, 38, 50, 52, 53 are all genuinely open. The charter dates (`charter_opens_at`, `lock_deadline`) are still null in `launch/mainnet-init.json`. The holder surfaces are not built. The dress rehearsal has not run. The pool/Squads/revenue ATAs have not been created on mainnet. The rehearsal proof is stale (must be re-run at release commit).

---

## ADDITIONAL OBSERVATIONS

**On the `expiry-budget` test scope:** The test correctly states it uses "synthetic valid-layout/PDA genesis accounts" and "does not claim twenty complete mint/boost lifecycles were replayed." It measures the CU cost of the `expire_boosts` instruction itself (103,976 CU at default budget), which is the relevant measurement for the crank's batch sizing. The scope is honest and appropriate.

**On the v1 transaction reader:** `bank/txread.mjs` correctly handles legacy, v0, and v1 parsed transactions. The v1 validation requires `transactionConfig` and rejects lookup-table-sourced keys (matching the current Solana v1 spec which uses inline addresses). The fixture `tests/fixtures/mainnet-v1.json` is a real captured transaction. The reader's fail-closed behavior (throwing on malformed data) is correct for the alarm's use case.

**On the token program pins:** `scripts/token-programs.sh` pins mainnet Classic Token, Token2022, and ATA program bytes. The round 28 validation found that bundled Token2022 and ATA differed from mainnet; the pins now match. These are snapshot pins (they describe a captured mainnet version), not protection against future upgrades. This is correctly documented.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

**What AI audit structurally cannot do, and what this project must do before launch:**

1. **Execute the dress rehearsal against a live cluster.** The crank's behavior under real RPC latency, rate limits, and 2,100 vaults has never been tested. The revenue cycle has never run a full sweep→swap→return→split on any cluster. No amount of local-validator testing substitutes for this. The named pass/fail items in accepted limit 22 must each be executed and recorded with transaction signatures.

2. **Run the swap fork at the release commit.** The `sim/swap-fork.sh` proof is of a specific commit. It must be re-run after the final code freeze to prove the exact bytes that ship can swap through both real pools.

3. **Verify the `initialize` transactions against `launch/mainnet-init.json` by reading the signed transaction bytes, not just the JSON.** The checker validates the JSON (accepted limit 38, round 24 A6). Whoever builds the four `initialize` transactions could deviate from the JSON. The signed transactions should be dumped and their arguments compared to the JSON before broadcasting.

4. **Fund the operator wallet and verify it holds only the fee float.** The operator wallet must hold nothing but the cycle's funds and ~0.02 SOL float (accepted limit 10, D2). Nothing on-chain enforces this. A human must verify the balance before arming the revenue cron.

5. **Create the three cbBTC accounts and fund the revenue address above rent exemption (road step 10).** Until this is done, every `split_revenue` and every paid `mint_vault` will fail. This is a one-time setup step that cannot be automated by the audit.

6. **Remove the upgrade authority from all five programs ONLY after steps 1–5 pass.** The ordering is the entire safety argument. Once the authority is removed, every surviving bug is permanent (accepted limit 39). The ship gate's two-clean-round requirement exists because AI audit rounds do not converge monotonically; each round finds things the last round's repairs introduced.

7. **Establish an off-box witness for the revenue ledger and alarm state.** The detection half does not survive a compromise of the box (accepted limit 10(3)). The revenue ledger, crontab, and alarm all belong to one user. An off-box copy of the ledger (even a periodic hash committed to a separate chain or a Squads multisig) would provide a tamper-evidence layer that the current architecture lacks.

8. **Hold the Giraffish Moments update authority cold or in a multisig through the 7-day charter window.** Accepted limit 46 states the full consequence: that key can end the project before it starts or capture all of governance. The ruling keeps it hot, but the operational risk is concentrated in a single hot wallet during the most critical 7 days. Any additional custody protection during that window reduces the risk without changing the design.

9. **Verify the PoB set against mainnet at the charter opening.** The 240 Proof of Burn addresses are pinned by `pob_root`, but the collection's update authority could mint lookalikes or modify individual assets. The `scripts/probe-mainnet-facts.mjs` re-derives the root from mainnet raw account data each run. This should be run immediately before the charter window opens to confirm the set has not changed.

10. **Accept that the audit process itself is the bottleneck.** Twenty-eight rounds have not produced two consecutive clean rounds. The freeze counter is at 0/2. Each round's repairs introduce new code that the next round must audit. The process will converge only when the repair rate drops below the finding rate. The project should plan for additional rounds and not treat the current state as "almost done." The immutability of the programs means the cost of a premature launch is permanent.