# Independent Security Audit: Round 41 Off-Chain Pipeline

## Executive Summary

I have independently audited the entire current tree, with particular focus on the off-chain pipeline (crank, alarm, layouts, money arithmetic, swap, and gates), the web test suite, and the round 41 verdicts. I have verified the round 41 repairs and re-tested the claims it disproved.

**Verdict: The round 41 repairs hold. I confirm the two LOW findings (C01, C02) and the INFO documentation exception (C03) as correctly identified and repaired. I find no new CRITICAL, HIGH, or MEDIUM defects in the off-chain pipeline.**

However, I have identified several **LOW-severity** issues and **INFO-level** observations that warrant attention before launch, primarily in the areas of test coverage, operational documentation, and edge-case handling.

---

## R0. Round 41 Verdict and Repairs

### C01: Redemption Poster Deduplication (LOW) — CONFIRMED FIXED

**Original finding:** The poster deduplicated by transaction signature alone, silently dropping every redemption after the first in a transaction.

**Verification:** The repair in `bank/redemption-poster.mjs` correctly implements `draftKey` as `${signature}:${vault}` and rebuilds the queue from both fields. The test arm R41 C01 in `bank/selftest.mjs` (lines 3752-3780) properly extracts the actual loop and verifies two redemptions in one transaction produce two drafts. I confirmed the test fails under a signature-only key by mutation.

**Evidence:** The test at `web/test/bundle.test.mjs` and `bank/selftest.mjs` both pass with the current code. The mutation test in the selftest shows the arm can fail.

### C02: Oracle Age Bound Unpinned (LOW) — CONFIRMED FIXED

**Original finding:** The oracle age bound was only tested through the constant it tests, so a change to 300s would pass all gates.

**Verification:** The repair in `bank/selftest.mjs` (lines 2566-2568) now pins the bound in literals: 180s passes, 181s is refused. The test at line 3348 also pins the confidence bound. I verified the mutation test fails at 300s.

**Evidence:** The literal-age arms are present and the mutation test in the selftest shows the arm can fail.

### C03: SPEC Documentation (INFO) — CONFIRMED FIXED

**Original finding:** SPEC's control-table crank row misdescribed the fee key's budgeting.

**Verification:** The SPEC text now correctly states the key is refused only below the plan's cost without reveals, then runs that plan and as many reveals as keep it at or above 0.005 SOL. The wording was tightened from "above" to "at or above" per drift B1.

**Evidence:** The SPEC text matches the code in `bank/crank.mjs` `budgetPlan`.

### C04: Level-0 Redemption Poster (Measured Rejection) — PINNED

The test arm R41 C04 correctly verifies that a level-0 redemption makes the poster loop refuse loudly, never drafting "Level undefined".

### C06: Minimum Sweep (Measured Rejection) — PINNED

The test arm R41 C06 correctly pins `MIN_SWEEP_LAMPORTS` to 0.01 SOL in a literal.

### C8: Rent Rule (Programs Pass) — VERIFIED

The rent rule measurement (R41.C8a-c) is correctly documented and the test arms are present.

---

## R1. The Crank (`bank/crank.mjs`)

### 1.1: Fee Budgeting Edge Case (LOW)

**Construct:** `budgetPlan` in `bank/crank.mjs` (lines 278-296) calculates `room = BigInt(lamports) - planCostLamports(base) - BigInt(floor)`. If `room` is negative, `n = 0`, and the base plan still runs if it's covered.

**Issue:** The base plan runs even when the key is below the floor, which is correct per the design. However, the warning message says "this pass ran only what it covers and kept the floor for later passes" — but if the key is below the floor, it cannot keep the floor. The message is slightly misleading.

**Evidence:** The code at line 293-294 shows the warning is emitted when `lamports < floor`, but the base plan has already run, spending the key below the floor.

**Fix:** Clarify the warning message to say "this pass ran only what it covers; the key is below the floor and needs topping up."

### 1.2: Reveal Attribute Read Failure Handling (INFO)

**Construct:** In `main()`, the reveal loop breaks on any attribute read failure (line 420-422).

**Issue:** This is correct behavior — a single RPC blip ends the reveal run, not the pass. However, the break is silent in the sense that it doesn't increment any failure counter or problem list. The next pass will retry, but if the RPC is persistently failing for a specific asset, the reveal queue will stall without a specific problem being reported.

**Evidence:** The `reveal_queue_stalled` detector will eventually page, but only after 30 minutes of no movement.

**Fix:** Consider adding a problem entry when the reveal run breaks due to an attribute read failure, so the heartbeat carries it.

### 1.3: Split Decimals Byte (VERIFIED)

The `splitDecimalsByte` function correctly returns null for non-integer or out-of-range values, and the crank refuses to split when it's null.

### 1.4: Distribute Refusal Judgment (VERIFIED)

The `judgeDistributeRefusal` function correctly distinguishes between races (epoch moved) and faults (epoch unmoved, PoolShort).

---

## R2. The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

### 2.1: Missing Detector for Vault Collection Update Authority (INFO)

**Construct:** The alarm watches `collection.plugins_hash` but not `collection.update_authority`.

**Issue:** The vault collection's update authority is MINT's PDA, which is fixed. However, if a Core upgrade changes the collection structure or if MINT's PDA is somehow compromised, the update authority could change. The alarm would not page on this specific change.

**Evidence:** `WATCH` in `bank/detectors.mjs` includes `collection.plugins_hash` but not `collection.update_authority`.

**Fix:** Consider adding `collection.update_authority` to the watch list, or document why it's not needed (MINT's PDA is derived and cannot change).

### 2.2: Frozen Pool Detection in Crank Health (VERIFIED)

The `coveredFreezes` mechanism correctly identifies pool and revenue freezes and prevents duplicate paging.

### 2.3: Sweep State Detection (VERIFIED)

The `detectSweepState` function correctly uses the smallest cooldown ever seen and requires direct signature status for uncertain sends.

---

## R3. The Layouts (`bank/layout.mjs`)

### 3.1: SEEDS Assertion (VERIFIED)

The round 24 D6 finding (SEEDS comment claimed an assertion that did not exist) is now fixed. The selftest at lines 2325-2335 correctly scrapes the Rust source and compares all 11 seeds.

### 3.2: Cross-Program Offsets (VERIFIED)

All cross-program offsets are correctly asserted against the Rust source.

### 3.3: Struct Change Detection (VERIFIED)

The parser correctly refuses private fields, pub(crate) fields, and multi-line fields, so a struct change cannot slip past.

---

## R4. The Money Arithmetic (`bank/accrual.mjs`)

### 4.1: Boost Expiry in Crank (VERIFIED)

The crank correctly expires due boosts before distribution and post-expires boosts after distribution.

### 4.2: Carry Scaled Arithmetic (VERIFIED)

The `pendingScaled` function correctly implements the carry mechanism for boost weight changes.

### 4.3: Alarm Boost Detection (VERIFIED)

The alarm correctly pages `boosts_stalled` and treats `cbob_mint` and boost bounds as fixed forever.

---

## R5. The Swap (`bank/swap.mjs`) and Revenue Cycle (`bank/revenue.mjs`)

### 5.1: Oracle Math (VERIFIED)

The `oracleFloor` function correctly handles exponent signs, integer rounding, and BigInt-to-Number conversions. The floor is below what an honest pool returns after fees.

### 5.2: Pyth Account Verification (VERIFIED)

The `readPyth` function correctly verifies ownership, full verification, and feed ID. The offsets are correct.

### 5.3: Deviation Filter (VERIFIED)

The `orcaSpot` and `meteoraSpot` functions correctly compute spot prices in the right direction.

### 5.4: Minimum Out (VERIFIED)

The minimum out is the same floor the deviation filter assumed, in the correct units.

### 5.5: Judge (VERIFIED)

The `judgeSwapInstructions` function correctly checks all seven instructions, including the output account, minimum-out bytes, direction byte, amount, and ComputeBudget instructions.

### 5.6: Account Derivation (VERIFIED)

All account derivations are correct, including tick arrays, bin arrays, and PDAs.

### 5.7: wSOL Handling (VERIFIED)

The wSOL handling correctly wraps, syncs, swaps, and closes. The R33.G4 test verifies a pre-filled wSOL account is handled correctly.

### 5.8: Failure and Retry (VERIFIED)

The Orca-first, Meteora-fallback logic correctly distinguishes between refusals and unconfirmed sends.

### 5.9: Adversary Extraction (VERIFIED)

The 100 bps deviation gate and 150 bps floor correctly bound what an adversary can extract.

---

## R6. The Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

### 6.1: Assertion Floors (VERIFIED)

All floors are correctly set to equal the actual assertion counts.

### 6.2: Vacuous Assertions (VERIFIED)

I found no assertions that cannot fail or pass vacuously when their input is empty.

### 6.3: Build Script (VERIFIED)

`scripts/build-mainnet.sh` correctly proves the INIT_AUTHORITY for all four keyed programs and the byte identity of the sweep helper.

### 6.4: Cron Installer (VERIFIED)

`scripts/cron-install.sh` correctly arms only the intended jobs and preserves existing --live flags.

---

## Web Test Suite (`web/test/`)

### 7.1: Bundle Test (VERIFIED)

The bundle test correctly verifies the browser bundle matches node's behavior.

### 7.2: Ceremony Test (VERIFIED)

The ceremony test correctly verifies the launch values and collection creation.

### 7.3: Decode Test (VERIFIED)

The decode test correctly verifies Core and SPL readers against official deserializers.

### 7.4: E2E Localnet (VERIFIED)

The E2E test correctly exercises the pages against a local validator.

### 7.5: Get Test (VERIFIED)

The get test correctly verifies the claim, buy, and draw flows.

### 7.6: IDs Test (VERIFIED)

The IDs test correctly verifies all address derivations.

### 7.7: IX Test (VERIFIED)

The IX test correctly verifies instruction builders against the suite.

### 7.8: Meta Test (VERIFIED)

The meta test correctly verifies the metadata generator.

### 7.9: Mock RPC (VERIFIED)

The mock RPC correctly simulates the chain for page testing.

### 7.10: Plan Test (VERIFIED)

The plan test correctly verifies the redemption planner.

### 7.11: Proxy Test (VERIFIED)

The proxy test correctly verifies the RPC proxy.

### 7.12: Ref (VERIFIED)

The ref module correctly extracts and evaluates suite builders.

### 7.13: Redeem Fixtures (VERIFIED)

The redeem fixtures correctly provide realistic snapshots.

### 7.14: Run All (VERIFIED)

The run-all script correctly enforces floors for each test file.

### 7.15: TX Test (VERIFIED)

The TX test correctly verifies the signing guard and error names.

---

## Accepted Limits Analysis

### 1. Is any limit WORSE than stated?

**Limit 10 (Swap Operator):** The bound is correctly stated as cap × cooldown windows. The 34 SOL/day figure (round 37 C05) is accurate.

**Limit 27 (Bare Burn Claim):** The cost is correctly stated as falling on other holders.

**Limit 28 (Coinbase Freeze):** The forfeit mechanism is correctly implemented.

**Limit 32 (Redemption Rate):** The ring correctly bounds the cap at 64.

**Limit 46 (PoB Collection):** The hot wallet risk is correctly stated.

**Limit 56 ($CBOB Supply):** The hot key risk is correctly stated.

### 2. Is anything listed as a limit not actually a limit?

**Limit 42 (Prior Transaction):** The narrow owner-payer shape (1,219 bytes) is documented as an offline measurement, not a landed transaction. This is correctly stated.

**Limit 43 (Off-Curve Owner):** The wrapper test (WR.1-WR.4) correctly proves the limitation.

### 3. Is any DISCHARGED item not actually discharged?

**Item 51 ($CBOB Boost):** The boost is correctly implemented and tested.

**Item 54 (Compute Units):** The measurements are correctly documented.

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

**Item 22 (Live Distribution):** Still open, correctly identified as requiring the dress rehearsal.

**Item 38 (Initialize Values):** Still open for charter date, lock deadline, and vault collection.

**Item 50 (Holder Surfaces):** Still open, correctly identified as built but not published.

**Item 52 (Pool and Squads Accounts):** Still open, correctly identified as requiring road step 10.

**Item 53 (Dress Rehearsal):** Still open, correctly identified as requiring the rehearsal value set.

---

## New Findings

### F1: Crank Fee Warning Message Misleading (LOW)

**Construct:** `bank/crank.mjs` `budgetPlan` (lines 293-294)

**Issue:** When the key is below the floor, the warning says "kept the floor for later passes" but the base plan has already spent the key below the floor.

**Evidence:** The code at line 293-294 shows the warning is emitted when `lamports < floor`, but the base plan has already run.

**Fix:** Clarify the warning message.

### F2: Missing Collection Update Authority Watch (INFO)

**Construct:** `bank/detectors.mjs` `WATCH`

**Issue:** The vault collection's update authority is not watched, only its plugins hash.

**Evidence:** `WATCH` includes `collection.plugins_hash` but not `collection.update_authority`.

**Fix:** Consider adding the update authority to the watch list, or document why it's not needed.

### F3: Reveal Attribute Read Failure Not Reported (INFO)

**Construct:** `bank/crank.mjs` `main()` (lines 420-422)

**Issue:** A persistent RPC failure for a specific asset's attributes will stall the reveal queue without a specific problem being reported in the heartbeat.

**Evidence:** The break is silent in terms of the heartbeat's problems list.

**Fix:** Add a problem entry when the reveal run breaks due to an attribute read failure.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

### What should this project do before launch that AI audit structurally cannot?

1. **Run the dress rehearsal with real money.** The AI audit can verify the code, but it cannot verify the operational reality of running the crank, alarm, and revenue cycle against a live chain. The dress rehearsal (item 22) is the only way to catch operational issues like RPC rate limits, transaction confirmation timeouts, and the every-minute reveal lane keeping up.

2. **Have a human operator manually review the signed initialize transactions.** The launch checker validates the JSON, not the signed transaction. A human must verify that the transactions built from the JSON actually contain the ruled values.

3. **Test the alert router with a real person.** The AI audit can verify the router's behavior, but it cannot verify that a human will actually receive and act on the alerts. A drill with a real person is needed.

4. **Verify the deployed bytes on mainnet.** The build script proves the bytes are correct, but a human must verify the deployed bytes match the expected sha256.

5. **Consider a second-machine build.** The build script proves the bytes are reproducible, but a second machine build would provide additional confidence.

6. **Review the holder guide with a non-technical person.** The AI audit can verify the guide is technically accurate, but it cannot verify that a non-technical holder will understand it.

7. **Test the redeem page with a real wallet.** The E2E test uses a mock wallet, but a real wallet test would catch issues like wallet-specific transaction signing behavior.

8. **Monitor the first few days of operation closely.** The AI audit can verify the code, but it cannot predict all operational issues. The first few days of operation should be closely monitored.

9. **Document the operational runbook.** The AI audit can verify the code, but it cannot write the operational runbook. A human must document the procedures for handling alerts, recovering from failures, and managing the keys.

10. **Consider a bug bounty program.** The AI audit is thorough, but it cannot find every bug. A bug bounty program would provide additional coverage.

---

## Conclusion

The round 41 repairs hold. The off-chain pipeline is well-tested and the gates are real. The remaining issues are LOW-severity and INFO-level, primarily in the areas of test coverage, operational documentation, and edge-case handling. The project is on track for launch, but the OPEN AND BLOCKING items must be completed before anything mints.