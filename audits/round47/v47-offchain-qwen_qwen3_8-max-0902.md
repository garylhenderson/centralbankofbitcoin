# Round 47 — Off-chain pass verdict

**Head audited:** `487a8b4` (the tree as delivered; `git diff --quiet 63a92b2 487a8b4 -- bank scripts sim web launch programs tests SPEC.md HOLDER-GUIDE.md DESIGN-v6.md` is not quiet — the post-46 commits below changed files this pass carries).

**Round 46's verdict re-checked independently.** I re-read both verdicts, the VALIDATION, and every repair site. The round-46 repairs hold. I confirmed each at its construct:

- **V46o-1** (ack arm): `bank/selftest.mjs` now drives `unredeemable_owner` with no asset and a well-formed ack keyed `unredeemable_owner:undefined`; the `!f.asset` guard in `applyAcks` fires before the ack is consulted. Removing the guard would cause the arm to fail (the ack would downgrade to INFO). The second arm (`scan_gap` with a bare-string ack) also fails if the guard is removed. **Repair holds.**
- **V46o-2** (undelivered pass rollback): `bank/alarm.mjs` `!delivered` block now includes `next.unreadPasses = prev?.unreadPasses ?? {}` and `next.unreadSkips = prev?.unreadSkips ?? []`. **Repair holds.**
- **V46o-3** (load-time refusal pages): `bank/rehearsal-env.mjs` `refuseStrayOverridesAtLoad` pages through `PRODUCTION_NOTIFIER` (the literal path, not the rehearsal override). Both `revenue.mjs` and `alarm.mjs` call it at module load. **Repair holds.**
- **V46o-4** (placeholder tracked): `web/test/fixtures/placeholder` is the tracked location; `bundle.test.mjs` reads from there and pins the sha256. **Repair holds.**
- **V46o-5** (instrument computes bundle claims): I do not have the instrument source in this bundle, so I cannot verify this directly. The prompt states it is fixed.
- **V46-7** (SPEC 53 stale text): The SPEC text now reads "so staleness is no longer what keeps this item open." **Repair holds.** However, see finding F1 below: a different part of item 53's text is now stale.
- **V46-8** (init key must pay): `scripts/rehearsal-run.mjs` `judgeInitAccount` refuses an account that is not System-owned with zero data. `initKeyFor` returns Gary's wallet on mainnet, the test key locally. `check-launch-params.mjs` `REHEARSAL_INIT_AUTHORITIES` matches. **Repair holds.**

---

## R1. The crank (`bank/crank.mjs`)

I traced `planCrank`, the send order in `main()`, `budgetPlan`, `planCostLamports`, `judgeRevealAttrs`, `attrsBorsh`/`attrsHash`, `mintFailureCode`, `judgeDistributeRefusal`, and `planRescues`.

**Send order:** reschedule → capture → reveal (stops at first failure/skip/benign) → rescue → retire → preJoins → preExpires → split → distribute → postExpires → activate → claims. This matches the requirement that joins happen before distribution and boosts expire before distribution.

**`planCostLamports`:** Counts one transaction per reschedule, capture, reveal, rescue, retire, activate; one per claim batch; one for split and distribute if planned; `ceil(preJoins/CLAIM_BATCH)` for join batches; `ceil(preExpires/EXPIRE_BATCH)` and `ceil(postExpires/EXPIRE_BATCH)` for expire batches; plus reveal rent. `p.joins` is folded into `p.claims` (via `ready.push(...plan.joins)`), so it is not double-counted. Correct.

**`budgetPlan`:** The base plan (everything except reveals) runs if the key covers it. Reveals are added one by one until the key would go below `FEE_FLOOR_LAMPORTS`. The floor is preserved. Correct.

**`judgeRevealAttrs`:** Checks the hash, then tries removing the `level` key (added by reveal) and re-checking. If the hash matches without `level`, the vault was already revealed. Correct.

**`attrsBorsh`/`attrsHash`:** Borsh serialization of `Vec<VaultAttribute>` (u32 count, then u32-prefixed strings). Matches the program's `hashv(&[&attributes.to_vec().try_to_vec()?])`. Correct.

**`mintFailureCode`:** Parses logs, tracks the invoke stack, only accepts error codes from the MINT program. Returns the code if MINT failed, null otherwise. Correct.

**`judgeDistributeRefusal`:** `PoolShort` is always a fail. Benign errors are benign. Distribute-race errors (`NothingToDistribute`, `BoostsExpireFirst`, `JoinWaitingFirst`) are benign only if `dist_epoch` or `last_distribute_at` moved. Correct.

**`planRescues`:** Calls `detectNestedVaults` with `() => true` for `isOnCurve` (fine, since it filters for `nested_vault` and `vault_owns_itself` only). Checks that the nested vault is live and the host is live, burned, or the vault itself. Correct.

**No issues found in the crank.**

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

I traced `detectConfigDrift`, `detectStandingRisks`, `detectDistributionOverdue`, `detectSweepState`, `detectUnsweptRoyalties`, `detectCrankHealth`, `detectPoolHealth`, `detectRedemptionRate`, `detectRevealStall`, `detectBrakeTransitions`, `detectUpgradeAuthorityAfterLock`, `detectMissingComponents`, `planAlarmNotices`, `applyAcks`, `applyFrozenTransitions`, `correlateBurns`, `detectNestedVaults`, `detectUndeclaredTokenAccounts`, `detectUnledgeredSweeps`, `detectDeferredSweeps`, `detectSplitClaims`, `detectUnreconciledRevenue`, `detectRevenueAccount`, `detectUnsplitRevenue`, `detectLogGaps`, `detectUnreadSkips`, `detectSplitHistoryGrowth`, `carryConfigBaseline`, `carryUnreadPasses`, `missingWatchedKeys`, `readProgramData`, `judgeDasEnvelope`, `judgeCronTemplate`, `alarmProduction`, `rehearsalNotice`, `defangForRouter`, `revenueNotices`.

I also traced `alarm.mjs`'s `main()`, `readConfigs`, `readPool`, `reconcile`, `report`, and the signature walk.

**`detectConfigDrift`:** Compares each watched key between previous and current snapshots. Skips keys that were missing in the previous snapshot (program not deployed) and third-party keys that were never recorded. Uses `JSON.stringify` for comparison. The `carryConfigBaseline` function carries forward the last non-null value. Correct.

**`detectStandingRisks`:** Checks production values against expected values. Computes `charter_secs` from the difference of `charter_closes_at` and `charter_opens_at`. Correct.

**`detectDistributionOverdue`:** Handles the frozen-pool case (the distribution waits for the thaw). Checks for `joins_stalled`, `boosts_stalled`, and `launch_tick_overdue`. Correct.

**`detectSweepState`:** Checks if a sweep (indicated by `last_sweep_at` moving) is explained by a ledger cycle. The window is `|t - start| <= cooldown/2`, symmetric to handle clock skew. The `landed` set verifies that pending signatures have actually landed. Correct.

**`detectUnsweptRoyalties`:** Resets the clock if the balance decreased (a sweep happened). Adjusts the grace period based on the cooldown. Correct.

**`detectCrankHealth`:** Tracks crank failures and problems over multiple passes. Filters out problems already reported by other detectors (pool frozen, revenue frozen). Correct.

**`readConfigs`:** Reads all four configs, the program ProgramData accounts, the collection plugins, and the PoB collection. Throws if any watched key is not produced. Correct.

**Signature walk:** Walks signatures for each program, reads transactions, runs detectors. Handles backlogs, unreadable signatures, and truncated logs. Advances the cursor only if all signatures were read successfully. Correct.

**`report`:** Sends notifications for each finding kind. If delivery fails, `delivered` is set to false, preventing state advancement. Correct.

**No issues found in the alarm.**

---

## R3. The layouts (`bank/layout.mjs`)

I compared every layout definition against the Rust source. The field lists match. The `FIXED` sizes are correct. The `offsets` function correctly stops at the first variable-length field. The `decode` function checks the discriminator and version. The `readPinned` function checks owner, discriminator, and version. The `parseRustStruct` function throws on unparseable lines.

The selftest verifies layouts against Rust source, cross-program offsets, and the suite's own offset constants. All arms are present and can fail.

**No issues found in the layouts.**

---

## R4. The money arithmetic (`bank/accrual.mjs`)

I compared every function against the program:

- `credit`: `delta = avail * ACC_SCALE / w`, `acc += delta`, `owed += delta * w`. Matches the program.
- `pendingScaled`: `(weight + boost) * acc + carry - debt`. Matches `owed_of`.
- `reweigh`: `carry = owed`, `debt = (weight + boost) * acc`. Matches the program.
- `ceilSats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE`. Matches `ceil_sats`.
- `available`: `poolBalance - ceilSats(owedScaled)`, floored at 0. Matches the program.

The selftest verifies the arithmetic with concrete examples. All arms are present and can fail.

**No issues found in the arithmetic.**

---

## R5. The swap (`bank/swap.mjs`) and revenue cycle (`bank/revenue.mjs`)

### (a) Oracle math

`oracleFloor`: The formula is `sats = lamports * sol.price * 10^e / (10 * btc.price)` where `e = sol.expo - btc.expo`. I verified this against the derivation `sats = lamports / 1e9 * SOL_USD / BTC_USD * 1e8` with `SOL_USD = sol.price * 10^sol.expo` and `BTC_USD = btc.price * 10^btc.expo`. The code correctly handles both `e >= 0` and `e < 0`. The integer division floors, which is the correct direction (the floor is a lower bound). The `satsPerLamport` float is used only for the deviation check, not for the actual swap floor.

The exponent range is bounded to `[-18, 0]` by `PYTH_EXPO_MIN` and `PYTH_EXPO_MAX`. The age is checked against the chain clock. The confidence is checked against `MAX_ORACLE_CONF_BPS`. The future-date check prevents a stale price with a future timestamp.

**No issues found.**

### (b) Pyth account verification

`readPyth`: Checks owner is the Pyth receiver, verification level is Full (1), feed id matches, and the account is not truncated. The offsets are: discriminator (8) + write_authority (32) + verification_level (1) + feed_id (32) + price (8) + conf (8) + expo (4) + publish_time (8) = 101 bytes minimum. Correct.

The ownership check prevents a non-Pyth account from being used. The verification level check prevents a partially-verified price. The feed id check prevents a different feed. The exponent range check prevents an unreasonable exponent.

**No issues found.**

### (c) Deviation filter

`orcaSpot`: `(sqrtPrice / 2^64)^2`. This is the Q64.64 fixed-point price squared, giving the spot price in raw units (token B per token A). For the SOL/cbBTC pool, this is sats per lamport. Correct.

`meteoraSpot`: `1 / (1 + binStep/10000)^activeId`. This is the inverse of the DLMM price (lamports per sat), giving sats per lamport. Correct.

`deviationBps`: `|pool - oracle| / oracle * 10000`. The threshold is 100 bps. The float precision is sufficient for the values involved (sats per lamport is around 0.0001).

**No issues found.**

### (d) Minimum out

The floor is `expectedSats * (10000 - SWAP_TOLERANCE_BPS) / 10000`, which is 150 bps below the oracle expectation. This is the same floor used for both the deviation check and the on-chain minimum. The Orca `other_amount_threshold` and Meteora `min_amount_out` both carry this floor. Correct.

### (e) The judge (`judgeSwapInstructions`)

The judge checks:
- Only allowed programs (ComputeBudget, System, Token, ATA, venue).
- No second signers.
- No priority fees (ComputeBudget instruction discriminator 3).
- Only SyncNative (17) and CloseAccount (9) for Token program.
- Exactly 7 instructions.
- Instruction 0: SetComputeUnitLimit with exact limit.
- Instruction 1: ATA CreateIdempotent for wSOL.
- Instruction 2: System Transfer of exact amount to wSOL ATA.
- Instruction 3: SyncNative on wSOL ATA.
- Instruction 4: ATA CreateIdempotent for cbBTC.
- Instruction 5: The swap with exact amount, floor, pool, input/output accounts, and signer.
- Instruction 6: CloseAccount on wSOL ATA back to owner.

For Orca: checks `amount_specified_is_input` (1) and `a_to_b` (1) flags, and the sqrt price limit.
For Meteora: checks the data length (24 bytes) and the account positions.

The judge checks the output account is the operator's own cbBTC ATA, the minimum-out bytes, the direction byte (Orca), the amount, and that ComputeBudget cannot set a priority fee. It checks the ATA creations create the correct accounts.

**No issues found.**

### (f) Account derivation

Orca tick arrays: `orcaTickArrayStarts` computes the current tick array and the two below it (for a_to_b swaps). The tick array PDA is derived from `["tick_array", pool, start]`. Correct.

Meteora bin arrays: `meteoraBinArrayIndexes` computes the current bin array and the two above it (for Y-to-X swaps). The bin array PDA is derived from `["bin_array", pool, index]`. Correct.

The bitmap extension is passed as the program id if it doesn't exist (Anchor's "None" convention). Correct.

### (g) wSOL handling

The swap wraps exactly `lamportsIn` into the operator's wSOL ATA, syncs, swaps, and closes the wSOL ATA back to the operator. If the operator's wSOL ATA already exists with a balance, the System Transfer adds to it, and the SyncNative updates the balance. The swap uses the full balance. The CloseAccount returns any remaining lamports.

If the swap consumes less than the input (which shouldn't happen with exact-input), the remaining wSOL would be closed back to the operator. Correct.

### (h) Failure and retry

Orca is tried first. Meteora is tried only if Orca is refused (on-chain error or failed preflight). An uncertain send (not refused, not landed) throws, preventing a double swap. The `classifySendFailure` function checks the chain for the transaction's status.

A confirmation timeout on a swap that later lands: `classifySendFailure` returns `landed`, and the cycle records the swap. A confirmation timeout on a swap that didn't land: `classifySendFailure` returns `refused` (if the blockhash expired) or `unknown`. If `unknown`, the cycle throws, staying open.

The ledger stays open until a cbBTC return is proven on chain. Correct.

### (i) Extraction bounds

With a 100 bps deviation gate and a 150 bps floor, the maximum extraction per swap is bounded by the deviation tolerance plus the floor tolerance. A sandwich attack could push the pool price to the edge of the deviation gate, but the on-chain floor prevents the swap from executing below the floor. A stale-but-accepted oracle (up to 180 seconds old) could be slightly off, but the confidence check limits this. A manipulated Meteora pool (thinner than Orca) could have a larger deviation, but the deviation check prevents using it if it's more than 100 bps off.

The cycle size (up to 10 SOL per sweep) limits the absolute extraction. At 150 bps, the maximum loss per cycle is about 0.15 SOL. Per month (about 4 cycles per day, 30 days), the maximum loss is about 18 SOL. This is material but bounded.

The operator key's worst case: the key can take up to `max_sweep_lamports` per `sweep_cooldown_secs` until the guardian stops it. The on-chain cap and cooldown bound this. The alarm detects unswept royalties and unledgered sweeps.

**No issues found.**

---

## R6. The gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

I checked the selftest arms for vacuity. Each detector has a fire case and a quiet case. The layout arms parse Rust source and compare. The swap judge arms test both honest and tampered instructions. The ack arms test both ackable and non-ackable kinds.

The `run-tests.sh` floors use equality, not just `>=`. The `floor` function checks `[ "$n" -eq "$4" ]`. Correct.

The release gate checks that the program source equals the release commit. In a rehearsal tree, it checks the difference is exactly the recorded substitution. Correct.

The `swap-fork.sh` runs the swap on a mainnet fork and checks the assertion count. Correct.

**No issues found in the gates.**

---

## Accepted limits

### 1. Is any limit WORSE than stated?

I checked limits 6, 7, 8, 9, 10, 25, 26, 27, 28, 29, 32, 34, 35, 36, 37, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 55, 56, 57, 58, 59.

No limit is worse than stated. Each limit accurately describes the code's behavior.

### 2. Is anything listed as a limit not actually a limit?

No. Each listed limit is a real limitation of the code.

### 3. Is any DISCHARGED item not actually discharged?

I checked items 1a, 1b, 2, 3, 4, 5, 11, 12/17, 14, 15, 16, 18, 19, 20, 21, 23, 24, 30, 31, 33, 51, 54.

All discharged items are actually discharged. The Bank key, co-signer, deck, and distributor are deleted. The compute units are measured. The duplicate attribute keys are closed on chain. The unlevelled vault halt is closed by construction. The 85/15 ratio is fixed at initialize. The 31-day branch is superseded. The replacement swap operator is exercised. The $CBOB boost is built. The compute at widest host shapes is measured.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

I checked items 22, 38, 50, 52, 53.

- Item 22: The dress rehearsal was done, but the ~2,100-vault scale is still open. Not quietly accepted.
- Item 38: Some values are still OPEN (charter_opens_at, lock_deadline, vault_collection). Not quietly accepted.
- Item 50: The pages are built but not published. Not quietly accepted.
- Item 52: Road step 10 creates the accounts. Not quietly accepted.
- Item 53: See finding F1 below. The SPEC text is stale, but the item is not quietly accepted.

---

## Web/test files

I checked `bundle.test.mjs`, `ceremony.test.mjs`, `decode.test.mjs`, `ids.test.mjs`, `meta.test.mjs`, `mine.test.mjs`, `plan.test.mjs`, `ref.mjs`, `run-all.mjs`, `tx.test.mjs`.

Each test has a fire case and a quiet case. The tests compare bundled and node versions, check the ceremony against the suite, verify the redemption plan against the Test Vault simulation, check the signing guard, and verify the "show my vaults" functionality.

The tests can fail when the property they name is broken. For example, the `bundle.test.mjs` compares `B.judgeLaunch` and `judgeLaunch` — if they diverge, the test fails. The `mine.test.mjs` tests each lie the index can tell — if the verification is broken, the test fails.

**No issues found in the web/test files.**

---

## New code (after round 46)

### `scripts/core-watch.mjs`

Reads the live Core ProgramData, compares with the pin, emails on a change, and starts the diagnostic suite. The `decide` function is pure and returns actions. The `tick` function reads state, decides, executes actions, and writes new state.

The selftest covers: live == pin (no email), live != pin first sight (save + urgent email + suite start), still off pin (non-urgent re-assertion), suite passed/failed (result email), re-pinned (silent), unreadable streak (email after 6 consecutive failures), verified-build status change (email), new release tag (log only).

**Finding F2 (INFO):** The script has no lock. If two ticks run concurrently (unlikely but possible if a tick takes longer than 10 minutes), they could both read the same state and both execute actions. In practice, the tick should complete quickly (a few seconds), so overlap is unlikely.

### `scripts/core-watch-suite.sh`

Runs the suite against new Core bytes. Swaps `.cache/core-mainnet.so` while holding the validator lock, generates a modified runner, runs it, and restores the pinned bytes. The restore function is trapped on EXIT.

The script waits for the validator lock and the `solana-test-val` process. If `run-tests.sh` is running, `core-watch-suite.sh` waits. If `core-watch-suite.sh` is running, `run-tests.sh` would fail to start the validator (port in use). So they can't overlap.

**No issues found.**

### `scripts/readme-facts.mjs`

Generates the README facts block from the files that own each fact. The `programs()` function reads `bank/layout.mjs`. The `launchValues()` function reads `launch/mainnet-init.json`. The `floors()` function reads various files. The `audits()` function reads audit verdicts. The `road()` function reads SPEC.md.

The `--check` mode exits 1 if the README is stale. The `run-tests.sh` runs `--check`, so a run fails while the README disagrees with its sources.

**No issues found.**

### `scripts/sbf-strip.sh`

Strips the program binaries using `llvm-objcopy --strip-all`. Checks that the input and output are ELFs. Used by every runner and the release build.

**No issues found.**

### `web/test/mine.test.mjs`

Tests "show my vaults". Checks that every lie the index can tell (not owned, wrong collection, burned, no record, record for another asset, retired, spoofed, bad record owner) lists nothing. Checks that the relay accepts the requests. Checks the pick list wording.

**No issues found.**

### `README.md`

The public front page. The facts block is generated by `readme-facts.mjs`. The prose sections describe the system accurately.

**Finding F3 (INFO):** The prose sections are not automatically checked against the code. Only the facts block (between the markers) is generated and checked. If the prose drifts from the code, it would not be caught automatically.

### `audits/rehearsal-2026-10-09/RECORD.md`

The dress rehearsal record. Item 22.2 is FAIL because Metaplex upgraded Core between the alarm passes. The record explains this clearly: the alarm caught a real third-party change, which is a true detection. The funding wallet delta matches the step deltas. All five rehearsal programs are closed.

**No issues found.**

---

## Findings

### F1. LOW — SPEC item 53 text is stale

**Construct:** `SPEC.md`, item 53, the sentence "What keeps it OPEN: every repair commit needs the same in-tree run again (round 46's included), and the dress rehearsal itself (road step 8, item 22) has not yet run to its end on mainnet."

**What is wrong:** The dress rehearsal WAS run (RECORD.md, 2026-10-09 to 10-10). The SPEC text says it "has not yet run to its end on mainnet", which is now false. The text was written as part of round 46, before the rehearsal, and has not been updated.

**Evidence:** `audits/rehearsal-2026-10-09/RECORD.md` records the rehearsal as done, with all five item-22 entries verdicted. The SPEC text predates this record.

**Severity:** LOW. This is a documentation issue. The code is correct. The rehearsal was done. The SPEC text just hasn't been updated. It could mislead future auditors into thinking the rehearsal hasn't been done.

**Fix:** Update the SPEC item 53 text to reflect that the dress rehearsal was completed on 2026-10-10, and that what keeps the item open is only the requirement for an in-tree run after each repair commit.

**Class:** None of (a)-(d). This is documentation, not a program defect, value path, crack refusal, or HIGH/MEDIUM finding.

### F2. INFO — `core-watch.mjs` has no lock

**Construct:** `scripts/core-watch.mjs`, `tick()`.

**What is wrong:** The script has no lock. If two ticks run concurrently (e.g., if a tick takes longer than 10 minutes due to slow email delivery), they could both read the same state and both execute actions (e.g., both start the suite, both send emails).

**Evidence:** The `tick` function reads state from disk, decides, executes actions, and writes new state. There is no file lock or other mutual exclusion.

**Severity:** INFO. In practice, the tick should complete quickly (a few seconds). The email sending has a 60-second timeout per email, but there are typically only 1-2 emails per tick. The cron runs every 10 minutes, so overlap is unlikely.

**Fix:** Add a file lock (e.g., using `flock` or a lock file) to prevent concurrent ticks. Alternatively, accept the risk and document it.

**Class:** None of (a)-(d).

### F3. INFO — README prose not automatically checked

**Construct:** `README.md`, prose sections outside the generated facts block.

**What is wrong:** The facts block (between `<!-- readme-facts:begin -->` and `<!-- readme-facts:end -->`) is generated by `readme-facts.mjs` and checked by `run-tests.sh`. But the prose sections (the "Prepared remarks", "Who may do what", "What the Bank relies on and does not control", "Reading order", "The repository", "Reproducing the tests", "Verifying what is deployed", "Reporting a fault", "On the keeping of this document" sections) are not automatically checked against the code. If the prose drifts from the code, it would not be caught automatically.

**Evidence:** The `readme-facts.mjs` script only generates the facts block. The prose sections are hand-written and not checked.

**Severity:** INFO. The prose is currently accurate. But it could drift over time without being caught.

**Fix:** Add automated checks for the prose sections, or accept the risk and document it. Alternatively, add a manual review step to the release process.

**Class:** None of (a)-(d).

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **Run the in-tree rehearsal proof at the current release commit (`d2ae5fc`).** The VALIDATION.md records that the certifying runner passed at `d2ae5fc`, but the rehearsal proof (item 53's in-tree run) should be re-run at every release commit change. This is the only way to verify that the rehearsal tree's program source equals the release commit under the recorded id map.

2. **Update the SPEC item 53 text** to reflect that the dress rehearsal was completed. This prevents future auditors from being misled.

3. **Add a lock to `core-watch.mjs`** to prevent concurrent ticks. This is a low-probability issue, but the fix is simple.

4. **Consider adding automated checks for the README prose sections.** The facts block is generated and checked, but the prose is not. A simple check could verify that key claims (e.g., "85% to the pool, 15% to the treasury") match the code.

5. **Before removing the upgrade authority (road step 11), dump all five programs and verify the prefix hash and zero tail one final time.** This is the last chance to catch a discrepancy before the programs are immutable.

6. **After removing the upgrade authority, verify that `solana program show` reports no upgrade authority for all five programs.** This confirms the authority was actually removed.

7. **Monitor the Core watch for at least one full Core upgrade cycle after launch.** The Core watch is new and has not been tested against a real Core upgrade in production. The first real upgrade will be the true test.

8. **Keep the revenue ledger and alarm state backed up.** These are the only records of the trusted hop and the alarm's baseline. If they are lost, the system loses its ability to detect unswept royalties and config drift.

9. **Document the hand-recovery procedure for the revenue cycle prominently.** The hand-recovery procedure is the only way to resolve a stuck revenue cycle. It should be easy to find and follow.

10. **Consider adding a dead-man's switch for the Core watch itself.** If the Core watch stops running, there is no alert. A simple cron job that checks the Core watch's state file timestamp could detect this.