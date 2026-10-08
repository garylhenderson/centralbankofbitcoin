

# Round 37 Independent Audit — Off-Chain Pipeline and Sweep Helper

## R0. ROUND 36 VERDICT VERIFICATION

I independently verified all five confirmed LOW findings from round 36 and their repairs. All repairs hold.

**L1 (SPEC C5 text):** The old text claimed the sweep helper "can move the token out but cannot close the account." The helper unconditionally invokes `CloseAccount` after every transfer (`programs/cbob-vault-sweep/src/lib.rs` lines 62-70), so a kept-close-authority account reverts the entire call. The current SPEC text correctly states: "The sweep helper cannot handle it at all, because it always closes what it sweeps and the close reverts the whole call (round 36 L1)." **Repair verified.**

**L2 (rescue destination text):** The old round-29 D2 passage described the rejected design (to the host's owner while the host lives). The current text reads: "`rescue_nested` now extracts it, always to the CBOBTC Squads (whether the host lives, is burned, or is the vault itself; review 35 M1)." Limit 44's heading now reads "Undeclared airdrops are DESTROYED on redemption; a nested vault is not (round 36 L2: it is rescued, item 58)." **Repair verified.**

**L3 (unredeemable_owner text):** The old text said "sealed for good." The current `detectNestedVaults` off-curve branch reads: "or it sits in a foreign Core asset's wallet (that asset's owner can execute its own wallet and move the vault out by executing through it; if that asset is burned, anyone can rescue_nested it to the CBOBTC Squads)." The "sealed for good" phrase is gone. **Repair verified.**

**L4 (ACKABLE_KINDS):** `ACKABLE_KINDS` is now `new Set(['unredeemable_owner'])`. The selftest arm at line ~1161 verifies that `nested_vault` and `vault_owns_itself` acks are refused at CRITICAL. **Repair verified.**

**L5 (index lag timing):** The SPEC now states: "the alarm runs every 30 minutes and only its NEXT pass can report the recovery, which is after the alert router's 25-minute grace (round 36 L5). So any lag seen by a pass pages once, however short, and is followed by an ALL CLEAR when the next pass reads a complete index." **Repair verified.**

**Gate 5 obligations:** The suite floor moved from 889 to 895 (+6 on-chain arms: R36.C5, R36.G2a, R36.G2b, and three others). The selftest floor moved from 917 to 920 (+3: C06, L3, L4). Both floors equal their counts in `run-tests.sh` and `selftest.mjs`. **All Gate 5 obligations met.**

**Round 36 rejected claims:** I re-checked C06 (sweep signer), C07 (HOST_FLOOR), C08 (frozen pool tick), C09 (dry-run ledger write), C10 (poster level-0 crash). All remain correctly disposed. C06 is now pinned by a selftest arm that compiles `revenue.mjs`'s own sweep transaction and asserts the operator is fee payer and signer. C07 is pinned by the HOST_FLOOR=6 equality (five written tests plus Anchor's generated `test_id`).

**No regression found in any repair.**

---

## R1. THE CRANK (`bank/crank.mjs`)

I examined the planner, the budget, the error classification, the reveal attribute hash check, the distribution race judgment, and the I/O section.

**No defect found.** Specific verifications:

- The reveal loop iterates strictly from `revealed_total` in mint order and stops at the first unready record. A capture planned this pass counts as ready via `capturedThisPass`. Correct.
- `budgetPlan` keeps the floor in reserve and budgets reveals after the base plan. The base plan cost excludes reveals, and each reveal costs `SIG_FEE_LAMPORTS + REVEAL_RENT_LAMPORTS`. The arithmetic is correct and the floor is never breached.
- `judgeDistributeRefusal` correctly distinguishes race codes (benign if epoch or `last_distribute_at` moved) from `PoolShort` (always fail). `MonthNotElapsed` is in `BENIGN`, which is correct since it means another distribution already ran.
- `mintFailureCode` uses a stack to attribute Anchor errors to MINT only, preventing foreign program errors from being misclassified. The 5-second timeout on `getLogs` prevents hangs.
- The pre-join, pre-expire, and post-expire logic correctly accounts for weight changes before and after the distribution. The `retiringOwed` computation frees a retiring vault's share before planning the distribution.
- The claim batching correctly handles joined-now vaults (debt at join accumulator), pre-expired vaults (owed at expiry plus level-weight share of this distribution), and normal vaults (full pendingSats).
- The order of operations (reschedule, capture, reveal, retire, pre-join, expire-before, split, distribute, expire-after, activate, claim) matches the SPEC and the program's requirements.

---

## R2. THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

I examined every detector function, the config drift watch, the standing risks, the transaction walk, the sweep state detection, the log gap management, and the notification planning.

**No defect found.** Specific verifications:

- `detectApprovals` correctly falls back to `ataOwner` when `info.owner` is missing from the parse.
- `detectBurns` correctly distinguishes bare Core burns from program burns using the parent-index mapping. A Core BurnV1 that is an inner instruction of `burn_vault` for the same asset is correctly skipped.
- `detectVaultSetChange` correctly handles mass disappearances (reporting as one index finding, not N burns) and sets `trustCurrent: false` to prevent the false reading from becoming the baseline.
- `detectConfigDrift` correctly skips keys whose program was absent in the previous snapshot (L11) and third-party keys entering the watch for the first time (I2).
- `detectSweepState` correctly uses a symmetric window (`|t - start| <= cooldown/2`) to handle clock skew, and only counts uncertain sends as landed when the direct status lookup confirms them.
- `detectLogGaps` correctly maintains the unreviewed list, never evicts unreviewed gaps, and escalates to CRITICAL above 2000.
- `planAlarmNotices` correctly classifies one-shot vs level kinds, sends URGENT for one-shots with the pass time, defangs level text for the router's recovery pattern, and sends RECOVERY for cleared level kinds.
- The transaction walk correctly handles backlogs, unreadable transactions, and cursor resolution. The `tx_unreadable` reporting allows the pass to continue while holding the cursor.

---

## R3. THE LAYOUTS (`bank/layout.mjs`)

I verified the field lists against the Rust structs, the offset computations, the encode/decode round-trips, and the cross-program offset assertions.

**No defect found.** Specific verifications:

- The `MintConfig` field list (62 fields) matches the Rust struct exactly, including the stage 3c and boost fields.
- The `VaultRecord` field list (21 fields) matches the Rust struct exactly.
- The `u128` read/write correctly handles two 64-bit halves.
- The `Vec<Pubkey>` read correctly bounds the length at 64 and checks for truncation.
- The `collectionPluginsHash` correctly skips the base fields (key, update_authority, name, uri, num_minted, current_size) and hashes only the plugin region.
- The SEEDS assertion (D6) correctly scrapes each seed from the program source and compares it to the layout.

---

## R4. THE MONEY ARITHMETIC (`bank/accrual.mjs`)

I verified every function against the MINT program's Rust implementation.

**No defect found.** Specific verifications:

- `credit` matches MINT's `credit`: `delta = avail * ACC_SCALE / w`, `acc += delta`, `owed += delta * w`.
- `pendingScaled` matches MINT's `owed_of`: `(weight + boost) * acc + carry - debt`.
- `reweigh` matches MINT's `reweigh`: `carry = owed`, `debt = (weight + boost) * acc`.
- `ceilSats` matches MINT's `ceil_sats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE`.
- `available` correctly computes `poolBalance - ceilSats(owedScaled)`, floored at 0.
- The selftest's 39 assertions cover weights, dust, timing, the pool, frozen/retired vaults, and the boost carry.

---

## R5. THE SWAP (`bank/swap.mjs`) AND REVENUE CYCLE (`bank/revenue.mjs`)

I examined the oracle math, Pyth verification, pool readers, deviation filter, minimum out, the judge, account derivations, wSOL handling, failure/retry, and the revenue cycle.

**No defect found.** Specific verifications:

**(a) Oracle math:** The formula `sats = lamports * sol.price * 10^(sol.expo - btc.expo) / (btc.price * 10)` is correctly implemented with BigInt arithmetic. The `satsPerLamport` floating-point value is used only for the deviation check (1% threshold), where the ~2^-52 relative error is negligible. The floor is `expectedSats * (10000 - 150) / 10000`, rounded down.

**(b) Pyth verification:** `readPyth` checks owner (receiver program), verification level (Full only, tag=1), feed ID, and reads price/conf/expo/publishTime at the correct offsets. The layout is: 8 disc + 32 write_authority + 1 verification_level + 32 feed_id + 8 price + 8 conf + 4 expo + 8 publish_time. The age is judged against the chain Clock, with a 30-second future tolerance.

**(c) Deviation filter:** `orcaSpot` correctly computes `(sqrtPrice / 2^64)^2`. `meteoraSpot` correctly computes `1 / (1 + binStep/10000)^activeId`. The 100 bps threshold is applied symmetrically.

**(d) Minimum out:** The same `minSats` from `oracleFloor` is used for both the deviation filter and the on-chain floor. For Orca, it's `other_amount_threshold` at data offset 16. For Meteora, it's `min_amount_out` at data offset 16. Both are u64 little-endian.

**(e) Judge:** `judgeSwapInstructions` requires the exact 7-instruction sequence, checks all programs, signers, amounts, the floor, the direction (Orca exact-input a_to_b), the output account, the ATA creations, the wrap, the SyncNative, and the close. It refuses priority fees, foreign programs, second signers, and non-SyncNative/CloseAccount token instructions. The round-25 L1 arms verify all eight tampers on both venues.

**(f) Account derivation:** Orca tick arrays use `["tick_array", pool, start_string]` with starts at `[s0, s0-span, s0-2*span]` for a_to_b. Meteora bin arrays use `["bin_array", pool, i64_le(index)]` with indexes `[i, i+1, i+2]` for Y-to-X. The bitmap extension is passed as the program ID when absent (Anchor's None convention).

**(g) wSOL handling:** The swap wraps exactly `lamportsIn`, syncs, swaps, and closes back to the operator. The close sends remaining lamports (rent + any unswapped wSOL) back to the operator.

**(h) Failure/retry:** `classifySendFailure` correctly distinguishes refused (preflight, on-chain error, expired-unlanded), landed, and unknown. Meteora is tried only if Orca was refused, never on unknown. The cycle stays open on unknown.

**(i) Extraction bounds:** The 150 bps floor and 100 bps deviation gate bound extraction. A sandwich within the deviation gate can extract at most the price impact of the swap plus the 150 bps tolerance. At 10 SOL per cycle, this is bounded and disclosed.

**Revenue cycle:** The cooldown is judged on the chain Clock. The recovery section correctly handles returned-but-unsplit cycles using `closesCycle` with chain-time anchoring. The sweep, swap, return, and split are correctly sequenced. The `splitByOther` fallback correctly checks for a provably empty revenue ATA.

---

## R6. THE GATES (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

I examined the assertion floors, the both-ways testing, the coverage gate, and the build script.

**No defect found.** Specific verifications:

- The selftest FLOOR=920 equals the assertion count. The `run-tests.sh` floors (MIN_ASSERTIONS=895, DET_FLOOR=920, ALLOC_FLOOR=39, POSTER_FLOOR=24, MAINNET_FLOOR=33, LAUNCH_FLOOR=49, POB_FLOOR=14, EXPIRY_FLOOR=4) all use equality checks, not lower bounds.
- The `floor()` function in `run-tests.sh` enforces `[ "$n" -eq "$4" ]`, not just `-ge`.
- The coverage gate (`audit-coverage.sh`) checks current content against completed, quorate rounds, not just paths. The `--prepared` mode is separate from the freeze mode.
- The `build-mainnet.sh` builds all five programs, verifies the sweep helper is byte-identical between mainnet and localnet builds, and checks the source carries the correct INIT_AUTHORITY.
- The swap fork (`sim/swap-fork.sh`) has SWAP_FLOOR=16 and enforces equality.
- The expiry budget test (`tests/expiry-budget.mjs`) has EXPIRY_FLOOR=4 and uses synthetic genesis state.

---

## ACCEPTED LIMITS QUESTIONS

**1. Is any limit WORSE than stated?**

No. I verified the key limits against the code:
- Limit 10 (swap operator): The per-sweep cap and cooldown are enforced on-chain. The judge, floor, and deviation gate are correctly implemented. The stated bounds hold.
- Limit 25 (re-roll): The reschedule mechanism is correctly implemented. The stated residual holds.
- Limit 26 (last-slot grinding): The three-group entropy is correctly implemented. The stated residual holds.
- Limit 28 (cbBTC freeze): The frozen-pool forfeit is correctly implemented. The stated consequence holds.
- Limit 32 (redemption cap): The rolling window is correctly implemented. The stated bounds hold.
- Limit 40 (Core upgradeability): The three consequences are correctly stated.
- Limit 41 (custodial key): The cap bounds redemptions, not transfers. Correctly stated.
- Limit 46 (PoB hot wallet): The charter-window exposure is correctly stated.
- Limit 58 (rescue): The Squads-only destination and the return-by-hand are correctly stated.

**2. Is anything listed as a limit not actually a limit?**

No. All stated limits correspond to real code behavior.

**3. Is any DISCHARGED item not actually discharged?**

No. The discharged items (51, 54, 12/17, 14, 19, 30, 31, 33, and the v5 items) are correctly discharged by measurement or by removal of the relevant code.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

No. Items 22, 38, 50, 52, and 53 remain correctly OPEN. The launch values in `launch/mainnet-init.json` still have `charter_opens_at`, `lock_deadline`, and `vault_collection` as OPEN. The holder surfaces are built but not published. The dress rehearsal has not been run.

---

## FINDINGS

**No CRITICAL, HIGH, or MEDIUM findings.**

After independent verification of all five programs' source (MINT in full, BURN/GOV/SEAL by reference and cross-program offsets), the complete off-chain pipeline (`crank.mjs`, `detectors.mjs`, `alarm.mjs`, `layout.mjs`, `accrual.mjs`, `swap.mjs`, `revenue.mjs`, `spl.mjs`, `anchor.mjs`, `lock.mjs`, `sigwalk.mjs`, `txread.mjs`), the sweep helper, all gates and scripts, the SPEC, DESIGN, HOLDER-GUIDE, and the round 36 verdicts:

**I found no surviving defect that moves value, misstates a holder's rights, or contradicts a measured run.**

The round 36 repairs are all correctly implemented. The Gate 5 obligations are all met. The assertion floors equal their counts. The both-ways testing covers every detector. The cross-program offsets, account sizes, and discriminators are all verified.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

The AI audit process has converged on this tree. Two consecutive clean rounds with different rosters (the gate's requirement) are the remaining structural check. Beyond that, the following are things AI audit structurally cannot do, and which should be done before launch:

1. **Run the mainnet dress rehearsal (item 22) with real SOL on throwaway program IDs.** This is the single most important remaining step. The crank, alarm, and revenue cycle have never run against a live cluster with real RPC latency, real rate limits, and real transaction landing behavior. The rehearsal must include all five named items: live crank passes, live alarm passes in rehearsal mode, one full revenue cycle through each pool, one forced post-sweep failure walked through hand recovery, and one DAS read of a burned Core asset.

2. **Have a human read the four `initialize` transactions byte-by-byte against `launch/mainnet-init.json` before signing.** The checker validates the JSON, not the signed transaction. A human should verify that the transaction builder reads from the checked file and that the parameters in the transaction match.

3. **Have a human verify the five program deployments on mainnet after step 9.** Dump each program, check the prefix hash against `dist/`, verify the zero tail, and confirm the upgrade authority is the expected key. Then, after step 11, verify the authority is removed.

4. **Fund the operator wallet and the revenue address before the first cycle.** The operator needs at least 0.02 SOL for fees. The revenue address needs rent exemption. These are operational steps no code can do.

5. **Publish the holder pages (item 50) before the holder guide.** The redeem page's `judgeRedemptionCoverage` is the only pre-signature check for undeclared holdings. Until it's published, items 9 and 44 have no preventive control.

6. **Establish a human review process for the Squads' rescued-vault returns.** The rescue sends vaults to the CBOBTC Squads, and a person must return each one to its sender. This is a custody process, not a code path.

7. **Run the swap fork one final time at the release commit.** The fork test clones real pool state from mainnet. Pool state changes over time. The final run should be as close to launch as possible.

8. **Verify the Pyth feed IDs against Pyth's catalogue one final time.** The feed IDs are hardcoded. If Pyth changes their feed IDs, the oracle floor would read the wrong price.