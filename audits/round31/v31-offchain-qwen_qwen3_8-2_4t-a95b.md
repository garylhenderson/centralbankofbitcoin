# Round 31 Independent Audit — Off-Chain Pipeline, Sweep Helper, and Program Agreement

**Audited tree:** HEAD `425111d` (round 31 preflight). All files read whole. No prior verdict treated as authority; every claim below is independently derived from source.

---

## R0 — Round 30 Verdict Verification

I verified each of round 30's six confirmed repairs against the current source:

| Round 30 ID | Repair | Verified? |
|---|---|---|
| M1 (scan backlog) | `sigwalk.mjs` `startBefore` param; alarm `backlogs[id]` state; drain proof requiring cursor as next sig | **Yes** — `signaturesSince` accepts `startBefore`; alarm sets `backlogs[id] = { head, before }` on gap; drain proof at lines ~620–640 checks `below?.[0]?.signature === cursors[id]`; poster mirrors with `st.backlog` |
| L1 (truncation grief) | `log_coverage_gap` pages only when OURS ran; stranger shape → `log_truncated_foreign` INFO | **Yes** — `OURS` set includes all five programs; `ran` computed from `normaliseTx` (top-level + inner); INFO kind in `ALARM_KINDS` |
| L2 (budgetPlan floor) | Reveals budgeted only from above floor; base plan runs when covered | **Yes** — `room = lamports - baseCost - floor`; `keep = min(reveal.length, room/perReveal)`; base checked with `floor: 0n` |
| L3 (dust) | `MIN_SWEEP_LAMPORTS = 10_000_000n`; `sweepAmount` returns 0 below it | **Yes** — revenue.mjs calls `SW.sweepAmount` and returns early on 0 |
| D1 (rehearsal tags) | RECOVERED/FAILED/DID NOT RUN/RECONCILE FAILED carry REHEARSAL | **Yes** — `planAlarmNotices` uses `rehearsal` param; alarm failure paths interpolate `PRODUCTION ? '' : ' (REHEARSAL)'` |
| D2 (frozen zero stray) | SPEC item 44 says "a frozen stray account holding a balance" | **Yes** — text corrected |

Round 30's disposition of 26 other claim groups is consistent with what I read. No round-30 repair is missing or regressed.

---

## R1 — The Crank (`bank/crank.mjs`)

**No new defect found.** Verified:

- Reveal FIFO from `revealed_total`, stops at first not-ready record.
- `capturedThisPass` correctly included in reveal readiness.
- Pre-joins sent before distribute; pre-expires before distribute; post-expires after (harmless if distribute failed — `expire_boosts` skips non-due boosts on-chain).
- `budgetPlan` floor reserve correct: base plan runs when covered; reveals only from above floor; warning when below floor.
- `planCostLamports` correctly counts claim batches (`p.claims.length` = number of batches), join batches (`ceil(preJoins.length, CLAIM_BATCH)`), and expire batches.
- `judgeDistributeRefusal` correctly distinguishes benign (epoch moved) from fault.
- `mintFailureCode` tracks invoke stack, attributes errors to MINT only, resets on MINT success.
- Fee payer: refused below `max(need, floor)`; above ceiling runs and warns once/day; `budgetPlan` degrades gracefully.
- All instructions are permissionless MINT calls; no value movement outside program-pinned destinations.

---

## R2 — The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

### FINDING R31-1 — HIGH

**File & function:** `bank/txread.mjs` `validateParsedTransaction`; consumed by `bank/alarm.mjs` main walk loop.

**Construct:** `validateParsedTransaction` throws `"unreadable parsed transaction: v1 lookup-table key"` when a version-1 transaction contains any account key with `source: 'lookupTable'`. In the alarm's walk loop, `readParsedTransaction` is called without a try/catch:

```javascript
const tx = await readParsedTransaction(conn, s.signature, { truncatedLogs: 'flag' })
if (!tx) { unread++; ...; continue }
```

A throw (as opposed to a null return) propagates out of the `for` loop, out of `main()`, into the `withLock` catch handler. The alarm writes `RUN_FAILED`, notifies, and exits. The cursor does not advance. On the next cron pass (30 minutes later), the alarm hits the same transaction, throws again, and the cycle repeats indefinitely.

**What an attacker gains:** A stranger sends a single v1 transaction with a lookup table that names any of the four watched programs (SEAL, MINT, BURN, GOV) as a read-only account — the program need not execute. Cost: one transaction fee (~5,000 lamports). Effect: the alarm is permanently stuck until the transaction is pruned from the RPC provider's history or the cursor is manually advanced. All detection stops: config drift, program byte changes, brake pulls, sweep reconciliation, nested vaults, balance drops, distribution overdue, the 2.1% cap watch, and every other detector.

This is the same DoS class as round 29's M1 (log truncation), which was fixed by opting in to flagged truncation and continuing the walk. The v1 lookup-table case was not given the same treatment.

**Evidence that would exist if this is correct:**
1. On a local validator, send a v1 transaction with a lookup table that lists MINT's program ID as a read-only account (no instruction executes MINT). Confirm it appears in `getSignaturesForAddress(MINT)`.
2. Run the alarm walk against that validator. Observe the throw and the cursor not advancing.
3. Confirm `RUN_FAILED` is written and the alarm exits non-zero.
4. Confirm the next pass hits the same transaction and throws again.

**Fix:** In `validateParsedTransaction`, instead of throwing for v1 lookup-table keys, return a flagged result (analogous to `logsTruncated: true`) or return null so the alarm treats it as `tx_unreadable` and continues. Alternatively, wrap the `readParsedTransaction` call in the alarm walk in a try/catch that increments `unread` and continues. Add selftest arms in both directions: a v1-with-LUT transaction is handled without crashing the walk, and a legacy/v0 transaction still validates normally.

---

All other alarm detectors verified correct:

- `detectDistributionOverdue`: joins_stalled, boosts_stalled, launch_tick_overdue, distribution_overdue all fire on correct conditions.
- `detectUnsweptRoyalties`: grace follows on-chain cooldown; clock resets on balance fall; sweep brake silences.
- `detectPoolHealth`: frozen, insolvent, unreadable all detected.
- `detectRedemptionRate`: ring arithmetic matches BURN; idle window not paged.
- `detectConfigDrift`: carried baseline handles transient read failures; L11 skip for absent programs correct.
- `detectCrankHealth`: covered freezes pruned; streak logic correct.
- `applyFrozenTransitions`: new freeze urgent, standing freeze INFO.
- `planAlarmNotices`: one stream per kind, one-shots urgent, recoveries on clear, 60K truncation.
- `cycleIsOpen`: single predicate, `sendRejected` closes, `String(0n)` truthiness handled.
- `closesCycle`: anchored on return block time, amount check, exclude set.
- `detectSplitClaims`: `splitByOther` anchored to unique unclaimed splits; reused sigs caught; horizon follows chain sweeps.

---

## R3 — The Layouts (`bank/layout.mjs`)

**No defect found.** Verified:

- All five structs (SealConfig, MintConfig, VaultRecord, BurnConfig, GovConfig) have field lists that the selftest asserts against the Rust source via `parseRustStruct`.
- Cross-program offsets (GOV reading MINT, BURN reading SEAL, etc.) are scraped from the Rust and compared to computed offsets.
- Layout versions pinned; decode refuses version mismatch.
- SEEDS asserted against Rust constants (round 24 D6 repair present).
- `collectionPluginsHash` hashes only the plugin region, skipping mutable `num_minted`/`current_size`.
- `readPinned` checks owner, discriminator, and version before decoding.

---

## R4 — The Money Arithmetic (`bank/accrual.mjs`)

**No divergence found.** Verified line-by-line against MINT's `credit`, `owed_of`, `reweigh`, `ceil_sats`, `join`:

- `pendingScaled`: `(weight + boost) * acc + carry - debt` — matches `owed_of`.
- `credit`: `delta = avail * SCALE / w; acc += delta; owed += delta * w` — matches.
- `reweigh`: moves owed to carry, resets debt at new weight — matches.
- `ceilSats`: `(scaled + SCALE - 1) / SCALE` — matches.
- `available`: `balance - ceil(owed)` — matches.
- `debtAtActivation`: `weight * acc` — matches `join`.
- Boost carry and expiry arithmetic consistent with `expire_boost` and `unschedule_boost`.

The crank's `planCrank` uses `pendingSats` and `pendingScaled` correctly for claim planning, including the expired-boost special case (pays at level weight after expiry).

---

## R5 — The Swap (`bank/swap.mjs`, `bank/revenue.mjs`)

### (a) Oracle math

**Correct.** `oracleFloor` computes `sats = lamports * sol.price * 10^(sol.expo - btc.expo) / (btc.price * 10)` using BigInt throughout. The exponent handling is correct for both positive and negative `e`. The floor is `expectedSats * (10000 - 150) / 10000`, rounded down. `satsPerLamport` is a float64 approximation used only for the deviation ratio, where absolute precision doesn't matter.

### (b) Pyth verification

**Correct.** `readPyth` checks: owner is the receiver program, verification level is 1 (Full), feed ID matches. The layout offsets (8 disc + 32 authority + 1 level + 32 feed + 8 price + 8 conf + 4 expo + 8 time) are consistent with the Pyth `PriceUpdateV2` schema. Ownership by the receiver program plus the derived PDA address is sufficient: only the receiver program can write to accounts it owns, and the sponsored feed PDA is derived under the push-oracle program. A stale `publishTime` is caught by the 180s age check against the chain Clock. A future-dated price is caught by the 30s future check.

### (c) Deviation filter

**Correct.** `orcaSpot` computes `(sqrtPrice / 2^64)^2` in raw units (sats per lamport for wSOL/cbBTC). `meteoraSpot` computes `1 / (1 + binStep/10000)^activeId` (inverse of lamports-per-sat, giving sats-per-lamport). Both are compared to `satsPerLamport` via `deviationBps`. The 100 bps threshold is symmetric. Float64 precision is sufficient for a ratio check at these magnitudes.

### (d) Minimum out

**Correct.** Both venues receive `minSats` from `oracleFloor`. Orca's `other_amount_threshold` and Meteora's `min_amount_out` are both u64 at data offset 16. The judge verifies this value matches the `minSats` it was told.

### (e) The judge

**Complete for the threat model.** `judgeSwapInstructions` verifies:
- Exactly 7 instructions, exact sequence.
- Instruction 0: SetComputeUnitLimit(400,000), no keys, no priority fee.
- Instructions 1, 4: ATA CreateIdempotent for operator's own wSOL and cbBTC.
- Instruction 2: System transfer of exactly `lamportsIn` to operator's wSOL ATA.
- Instruction 3: SyncNative of operator's wSOL ATA.
- Instruction 5: venue swap with correct pool, input/output accounts, amount, floor, direction (Orca), price limit.
- Instruction 6: CloseAccount of wSOL back to operator.
- No second signer, no foreign programs, no Token instructions other than SyncNative and CloseAccount.

The judge cannot catch a tampered module in the same tree (accepted limit 10(3)). The post-swap delta check in revenue.mjs catches builder defects that misroute output.

### (f) Account derivation

**Correct.** Orca tick arrays: `[s0, s0-span, s0-2*span]` for a_to_b (price decreases). Meteora bin arrays: `[i, i+1, i+2]` for Y→X (active bin moves up). Oracle PDA, vault A/B from pool account. Meteora bitmap passed as program ID when absent (Anchor None convention). Host fee as None. Event authority and two token programs included.

### (g) wSOL handling

**Correct.** Wrap exactly `lamportsIn` via System transfer + SyncNative. Close wSOL ATA at the end. If the ATA already exists with a balance, the System transfer adds to it and SyncNative updates the amount. The swap consumes `lamportsIn` from the wSOL balance. The close returns any remaining lamports (rent + dust) to the operator. If the swap consumes less than input (shouldn't happen with exact-in), the remainder is closed back.

### (h) Failure and retry

**Correct.** Orca first; Meteora only if Orca's program refuses (on-chain error or failed preflight). An unconfirmed send (not refused, not landed) throws and does not try the next venue. `classifySendFailure` checks the chain for the signature's status. The ledger stays open until a cbBTC return is proven. `pendingSwapSig` records uncertain candidates for hand recovery.

### (i) Adversarial extraction bounds

Within the 100 bps deviation gate and 150 bps floor: a sandwich can extract up to the 150 bps floor (the minimum output). Pushing the pool to the 100 bps edge costs more than the extraction for the ~$10M Orca pool. The Meteora pool (~$0.9M) is thinner but the 150 bps floor still bounds the output. Per cycle (10 SOL max), the maximum extraction is ~150 bps of the swap amount, which at current prices is a few hundred dollars. Per month (~40 SOL/day × 30 = 1200 SOL), bounded by the number of cycles. This is within the accepted limit 10 disclosure.

---

## R6 — The Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

**No vacuous arms found.** Verified:

- Selftest floor is 898 with equality check (`R.length !== FLOOR` exits 1).
- All detector arms have both fire and quiet cases.
- `run-tests.sh` floors all use equality (`-eq`), not lower bounds.
- `swap-fork.sh` floor is 16 with equality.
- `audit-coverage.sh` checks current content blob against completed round bundles; `--prepared` mode for preflight.
- `build-mainnet.sh` proves INIT_AUTHORITY behaviorally (mainnet rejects test key, localnet accepts); sweep helper byte-identity across three builds.
- `cron-install.sh` preserves `--live` only on tagged, uncommented lines; refuses rehearsal trees; `flock -n` on every money job.

The round-24 D6 SEEDS assertion exists and is functional (selftest scrapes Rust constants and compares).

---

## Accepted Limits — Four Questions

### 1. Is any limit WORSE than stated?

**No.** Each accepted limit was re-read against the current code:

- **Limit 10** (swap operator trust): The swap is now built in-tree against pinned pools with a Pyth floor. The operator key still signs the sweep, but the swap construction is deterministic and judged. The stated bound (cap × cooldown windows until guardian stops) is accurate. The additional trust in pool programs and Pyth is disclosed.
- **Limit 25** (re-roll): The crank's reveal lane runs every minute; capture rides on four host instructions. The stated residual (one re-roll per full window of total silence) is accurate.
- **Limit 26** (leader grinding): Three-hash scheme with two-group stride. The stated residual (C's leader chooses among many draws) is accurate. The round-24 A1 quantification (best-of-4 via skipping alone) is consistent with the code.
- **Limit 27** (claim between burn and retire): The crank retires burned vaults first every pass. The stated residual (a claim between passes pays into a dead account) is accurate.
- **Limit 28** (Coinbase freeze): Stage 3c's frozen-pool forfeiture is implemented. The stated consequences are accurate.
- **Limit 32** (rate limit): Ring of 64, cap = ceil(2.1% × live), floor 1. The stated bound (ring caps at 64, stricter above 3,047) is accurate.
- **Limit 39** (immutability): Accurate.
- **Limit 40** (Core upgradeable): Three concrete consequences named. The round-28 Autograph heap boundary is measured and disclosed. Accurate.
- **Limit 41** (leaked custodial key): Transfers not limited. Accurate.
- **Limit 44** (undeclared airdrops): Sweep helper rescues classic SPL; Token-2022 and nested Core assets not covered. Frozen stray with balance reverts; frozen zero-balance is closed (round 30 D2 correction). Accurate.
- **Limit 46** (PoB hot wallet): The 7-day charter window exposure (end project or capture governance) is accurately stated. The alarm watches the collection but not individual assets (disclosed). The per-asset blind spot is disclosed.
- **Limit 47** (stolen guardian): The "for good while fewer than half vote" consequence is accurate. The round-24 A4 correction (turnout below 50% makes the stop permanent) is stated.
- **Limit 55** (unsplit revenue join): The crank splits every pass, bounding the balance at stake. The 100 $GARY minimum cost at the monthly boundary is accurate.
- **Limit 56** ($CBOB hot key): The custody is pinned in `launch/mainnet-init.json` and checked. Accurate.

### 2. Is anything listed as a limit not actually a limit?

**No.** All accepted limits describe real, verified residuals. None has been silently closed by a repair without updating the list.

### 3. Is any DISCHARGED item not actually discharged?

**No.** Each discharged item was verified:
- Item 51 ($CBOB boost): Built in MINT and GOV; suite section BO; crank expiry; alarm `boosts_stalled`. Discharged.
- Item 54 (compute): Measured figures in suite arms 10.5, 10.6, 10.6a. Discharged.
- Items 12/17 (CU): Measured on v5 artifact; regression ceiling in suite. Discharged.
- Item 14 (duplicate attrs): `DuplicateAttribute` refusal on chain. Discharged.
- Item 19 (unlevelled halt): `activate` refuses `NotRevealed`; no state where activated but unlevelled. Discharged.
- Items 30, 31, 33: Superseded by stage 3b/3c. Discharged.
- v5 items (1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24): Gone with the Bank/deck/distributor. Discharged.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**No.** All five open items (22, 38, 50, 52, 53) are genuinely unresolved:
- Item 22: No live distribution has been run. The dress rehearsal has not happened.
- Item 38: `charter_opens_at` and `lock_deadline` are null in `launch/mainnet-init.json`.
- Item 50: No deposit-address page, no redeem page, no poster sender.
- Item 52: Pool and Squads accounts not yet created (road step 10).
- Item 53: Rehearsal proof at `d57ee3a` is stale; needs re-run at release commit.

---

## Additional Observations (not filed as findings)

1. **The alarm's `unread` counter blocks all cursor advancement.** If any single transaction in a walk batch is persistently unreadable (RPC returns null indefinitely), the cursor never advances and the walk re-reads from the same point every pass. The `tx_unreadable` finding is reported, so a human would notice. This is the safe direction (no skipping) but could cause operational friction. Not a security defect.

2. **The poster's drain proof lacks `Array.isArray(below)` check** that the alarm has. If `getSignaturesForAddress` returns a non-array, the poster's proof check could behave unexpectedly. The poster is hand-run, so this is operational, not a security issue.

3. **`splitsSince` is bounded to 10 pages (10,000 signatures).** If more than 10,000 splits occur in the recovery window, older ones are missed. The comment acknowledges this: "an unread older split only leaves a cycle open, the loud direction." Acceptable.

4. **The `detectCrankHealth` covered-freeze strings are exact matches.** If the crank's problem messages change, the coverage would silently stop applying and `crank_problem` would page on freeze-related problems. This is a maintenance risk, not a security defect. The selftest arms cover the current strings.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Before launch, this project should do the following things that AI audit structurally cannot:

1. **Run the full mainnet dress rehearsal (item 22) with adversarial conditions.** This means: deploy to throwaway IDs, run the crank and alarm live for at least 72 hours, inject transient RPC failures at vault 1,900 of 2,100, run one full revenue cycle through each pool, force a post-sweep failure and walk the hand recovery, and verify the alarm pages correctly in rehearsal mode. No AI can substitute for observing real RPC behavior under load, real Helius rate limits, real DAS pagination, and real cron timing on the production box.

2. **Perform a witnessed `initialize` ceremony with the four programs and the sweep helper.** The `initialize` values are permanent. A human should verify each value against `launch/mainnet-init.json` on a screen, confirm the transaction on a hardware wallet or Phantom, and record the signature. The `check-launch-params.mjs` gate is necessary but not sufficient — it validates the JSON, not the signed transaction (accepted limit 38, round 24 A6).

3. **Remove the upgrade authority in a witnessed, recorded step.** All five programs (SEAL, MINT, BURN, GOV, sweep helper) must have their upgrade authority set to `--final` in a single session, with the sha256 of each deployed program recorded before and after. The alarm's `program_not_locked` detector will confirm, but the act itself requires a human key.

4. **Build and deploy the holder surfaces (item 50) before the holder guide is published.** The redeem page must run `judgeRedemptionCoverage`, offer to trigger a payout, sweep through the helper at execution time, and create missing ATAs in a prior transaction. The deposit-address page must show the asset-signer PDA. Without these, items 9 and 44 have no preventive control.

5. **Fund the revenue address above rent exemption and create the three cbBTC accounts (item 52) before the first paid mint.** This is a one-time operational step that no audit can perform.

6. **Establish a second, independent alarm witness on a separate box with a separate RPC provider.** The current alarm, ledger, crontab, and signing keys all live under one user on one box (accepted limit 10(3)). A compromise of that box silences all detection. A read-only witness on a different box, reading the same on-chain state through a different RPC, would detect config drift, program byte changes, and brake pulls independently. This is an operational decision, not a code change.

7. **Conduct a timed hand-recovery drill for the revenue cycle.** Before launch, the operator should practice: sweep lands, swap fails, alarm pages CRITICAL, next run refuses at the open-cycle guard, recover by hand using `--audit`, verify the ledger is clean. This builds muscle memory for the one procedure that cannot be automated.

8. **Set the charter opening date and lock deadline (item 38).** These are the two remaining OPEN values. Until they are set, `check-launch-params.mjs` refuses to pass, and the alarm's `lock_deadline_unset` would page in production. Gary must provide the date; the lock deadline must be at least 24 hours before it.

9. **Re-run the rehearsal proof at the release commit (item 53).** The current proof is at `d57ee3a`. The `scripts/rehearsal-tree.sh` must be re-run at whatever commit is deployed, and the full `run-tests.sh` must pass inside the rehearsal tree at throwaway IDs. This is a mechanical step but it must happen at the right commit.

10. **Verify the PoB set one final time against mainnet immediately before `initialize`.** The 240 addresses in `scripts/pob-set.json` are committed as a Merkle root. If any of those assets has been burned or transferred since the last probe, the root would still be valid but the claim would fail. A final `probe-mainnet-facts.mjs` run at the deploy moment confirms all 240 are live.