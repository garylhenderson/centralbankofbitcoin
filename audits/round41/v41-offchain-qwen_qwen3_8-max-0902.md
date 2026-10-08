# Round 41 Independent Audit — Off-Chain Pipeline, Web Tests, and Full Tree

## R0. Round 40 Verdict Verification

### C01 (Ceremony test M2 arm — LOW, confirmed in R40)

**Repair verified.** The arm at `web/test/ceremony.test.mjs` now uses an IIFE that requires presence before comparing order:

```javascript
(at => at >= 0 && at < pageSrc.indexOf("const signed = await signExact("))(
  pageSrc.indexOf("remember(ctx.newCollection.publicKey.toBase58())"))
```

If the `remember(...)` call is deleted, `indexOf` returns −1, `at >= 0` is false, and the arm fails. If the `signExact` call is deleted, the second `indexOf` returns −1, and `at < −1` is false for any `at >= 0`, so the arm also fails. Both deletion mutations turn the arm red. **Repair holds.**

**Evidence:** The IIFE pattern is present in the bundled `ceremony.test.mjs`. A mutation deleting line 214 of `web/src/pages/ceremony.mjs` (the `remember(ctx.newCollection.publicKey.toBase58())` call) would produce `at = −1`, failing the `at >= 0` guard.

### C02 (Swap floor tolerance unpinned — LOW, confirmed in R40)

**Repair verified.** The selftest now pins exact values:

```javascript
t('R40 C02: the floor is PINNED by hand at 150 bps (280,355 expected, 276,149 minimum), and SPEC\'s 150 is the constant',
    [f.expectedSats, f.minSats, SW.SWAP_TOLERANCE_BPS], [280_355n, 276_149n, 150])
```

**Independent recomputation:** With `sol.price = 12045355552` (expo −8), `btc.price = 8592910904675` (expo −8), `lamportsIn = 2_000_000_000`:

- `expectedSats = 2_000_000_000 × 12045355552 / (8592910904675 × 10) = 280,355.65…` → floor = **280,355** ✓
- `minSats = 280_355 × 9850 / 10000 = 276,149.675` → floor = **276,149** ✓

A mutation setting `SWAP_TOLERANCE_BPS = 9000` would produce `minSats = 280_355 × 1000 / 10000 = 28,035`, failing the pinned assertion. **Repair holds.**

### Round 40 rejected claims

I re-examined the claims R40 disproved (C03–C24). The mechanisms described are accurate. I confirmed:
- The `judgeSwapInstructions` ComputeBudget encoding check (`[0] !== 2` for SetComputeUnitLimit, `=== 3` for SetComputeUnitPrice) matches the installed web3.js encoding. No defect.
- The `detectRevealStall` detector fires when `r0 < m0 && r1 < m1 && r1 === r0`, covering the case where minting continues but the queue stalls. No defect.
- The `get.test.mjs` "NO crank" arms use `diffIx` which compares every account, order, and flag. No defect.

### Round 40 gate-5 obligations

- **U1** (large-autograph redemption at default CU): Recorded as measured (158,377 CU, 4 instructions). The suite arm exists.
- **C10** (crank attribute reader with unknown plugin types): The selftest arm feeds hand-built Core assets with plugin types 77 and 40 through `deserializeAssetV1` and asserts Attributes read. Present in the selftest.
- **W1** (txread accepts `transferCheckedWithFee`): Present in the selftest.
- **W2** (grouped consent at press): Present in the ceremony test.

**R0 verdict: Both R40 repairs hold. No regression found. No new defect from R40's dispositions.**

---

## R1. The Crank (`bank/crank.mjs`)

### Verified correct

1. **Plan ordering.** `planCrank` produces reschedule → capture → reveal → retire → preJoins → preExpires → split → distribute → postExpires → activate → claims. The `main()` send loop follows: reschedule, capture, reveal (strictly in order, breaks on failure/skip), retire, preJoins, preExpires, split, distribute, postExpires, activate, claims. This matches the red-team 3 finding 6 ordering requirement.

2. **Reveal ordering.** The reveal loop iterates from `cfg.revealed_total` upward, stopping at the first vault that is not ready. This enforces strict mint-order FIFO. A vault that is `'skip'` (unreadable asset) breaks the loop, preventing out-of-order reveals.

3. **Join-before-distribute.** `preJoins` collects vaults with `request_epoch < dist_epoch` (eligible to join). These are sent as claim batches before the distribute instruction. The distribute instruction would fail with `JoinWaitingFirst` if any eligible vault were unjoined.

4. **Boost expiry.** `preExpires` collects active boosted vaults with `dist_epoch >= boost_end_epoch`. These are expired before the distribute. `postExpires` collects vaults with `boost_end_epoch === dist_epoch + 1` (will be due after this distribution). These are expired after the distribute.

5. **Burned vault filtering.** The preJoins loop skips `assets[r.asset] === 'burned'`. The claims loop skips burned vaults. The retire loop collects burned unretired vaults. This prevents paying or joining dead vaults (limit 27).

6. **Fee budgeting.** `budgetPlan` runs the base plan (everything except reveals) whenever the key covers it, then budgets reveals to not spend below the floor. The `judgeFeePayer` check uses `floor: 0n` for the base plan, allowing it to run even below the floor. Reveals are budgeted with `room = lamports - baseCost - floor`.

7. **Distribute race handling.** `judgeDistributeRefusal` re-reads the config and checks if `dist_epoch` or `last_distribute_at` moved. If they moved, the refusal is benign (another distribution landed). `PoolShort` is never benign.

### Finding R1-1 (LOW): `planCostLamports` ceiling function uses floating-point division

**Construct:** `bank/crank.mjs`, `planCostLamports`, line:
```javascript
const ceil = (n, k) => BigInt(Math.ceil(n / k))
```

**Issue:** `n / k` is JavaScript floating-point division. For the values used here (transaction counts, small integers), this is safe. However, the pattern is fragile: if `n` or `k` were ever large (> 2^53), precision loss could produce an incorrect ceiling. Currently `n` is at most ~2100 (number of records) and `k` is 14 or 20, so this is not exploitable.

**Evidence:** No mutation test needed; the values are provably small. This is a code hygiene observation, not a live defect.

**Severity:** INFO. No fix needed at current scale.

### Finding R1-2 (LOW): `preJoinWeight` uses `records.find()` per join

**Construct:** `bank/crank.mjs`, `planCrank`:
```javascript
const preJoinWeight = plan.preJoins.reduce((a, [addr]) => {
    const r = records.find(x => x.address === addr); return a + L.LEVEL_WEIGHTS[r.level - 1] }, 0n)
```

**Issue:** `records.find()` is O(n) per join. With 2100 records and potentially many joins, this is O(n²). This is a performance issue, not a correctness issue. At 2100 records, the worst case is ~4.4M comparisons, which completes in milliseconds.

**Severity:** INFO. No fix needed at current scale.

### No plan the program will refuse

I traced each instruction type the crank sends against the program's expected accounts and data:
- `reschedule_reveal`: 1 account (vault record, writable). Matches MINT's `RescheduleReveal`.
- `capture_entropy`: 2 accounts (vault record, SlotHashes sysvar). Matches MINT's `CaptureEntropy`.
- `reveal_level`: 9 accounts + attribute data. Matches MINT's `RevealLevel`.
- `retire_burned`: 3 accounts (config, record, asset). Matches MINT's `RetireBurned`.
- `claim` (join-only and claim batches): config, pool, token program, then pairs. Matches MINT's `Claim`.
- `distribute`: config, pool. Matches MINT's `Distribute`.
- `activate`: config, record, asset, token account, pool. Matches MINT's `Activate`.
- `split_revenue`: config, revenue PDA, mint, revenue ATA, pool ATA, bank ATA, token program. Matches MINT's `SplitRevenue`.
- `expire_boosts`: config, then records. Matches MINT's `ExpireBoosts`.

No instruction sends accounts the program doesn't expect. No instruction moves value to an unpinned destination.

---

## R2. The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

### Verified correct

1. **Config drift detection.** `detectConfigDrift` compares every watched key between previous and current snapshots. The `carryConfigBaseline` function preserves the last non-null value across failed reads, preventing a one-pass blip from hiding a change.

2. **Standing risks.** `detectStandingRisks` checks production values against the ruled constants. The `test_value_in_production` check covers all initialize values. The `collections_disagree` check compares all four programs' collection keys.

3. **Sweep state detection.** `detectSweepState` compares `last_sweep_at` against the ledger, using a symmetric window of `±cooldown/2`. The cooldown used is the smallest ever seen (never above 6h), preventing a thief from widening the window by executing a longer cooldown.

4. **Log gap handling.** `detectLogGaps` preserves unreviewed gaps, trims only the reviewed prefix, and escalates to CRITICAL above 2000 unreviewed gaps. The watermark-based clearing prevents the router's recovery window from swallowing gaps.

5. **Split claims.** `detectSplitClaims` verifies explicit and anonymous split claims against on-chain evidence. The `closesCycle` function uses binary search on sorted splits, anchored to the return's block time.

6. **Crank health.** `detectCrankHealth` tracks failure streaks and recurring problems across passes. The `coveredFreezes` parameter prevents freeze-related problems from being double-reported.

### Finding R2-1 (LOW): `detectUnsweptRoyalties` clock reset on balance fall can be masked by simultaneous deposits

**Construct:** `bank/detectors.mjs`, `detectUnsweptRoyalties`:
```javascript
if (prevLamports !== null && prevLamports !== undefined && BigInt(lamports) < BigInt(prevLamports)) since = nowSec
```

**Issue:** If a sweep occurs AND new royalties arrive in the same alarm interval, the balance may not fall, and `since` is not reset. The alarm could page `royalties_unswept` even though sweeps are working. This is acknowledged in SPEC limit 10: "Incoming royalties can hide a successful sweep, so the clock can continue and page even while sweeps work."

**Evidence:** The `detectSweepState` function provides a complementary check from account state (`last_sweep_at`), which is not affected by balance masking. The two detectors together provide adequate coverage.

**Severity:** Already stated in SPEC. No new finding.

### No dangerous state reads as quiet

I traced the detector coverage against the stated risks:
- Frozen pool: `detectPoolHealth` checks `tok.frozen`. ✓
- Pool insolvency: `detectPoolHealth` compares balance against `ceil(owed_scaled / ACC_SCALE)`. ✓
- Distribution overdue: `detectDistributionOverdue` checks `last_distribute_at + monthly_secs`. ✓
- Redemption rate near cap: `detectRedemptionRate` checks the rolling window. ✓
- Upgrade authority past lock: `detectUpgradeAuthorityAfterLock` checks all five programs. ✓
- PoB collection changes: `detectConfigDrift` watches `pob_collection.plugins_hash` and `pob_collection.update_authority`. ✓
- Boost stalls: `detectDistributionOverdue` checks `boosts_due > 0`. ✓

### No routine state pages every pass

- Sales stopped: INFO, not paged. ✓
- Sweep stopped: INFO, not paged. ✓
- Guardian retired: INFO, not paged. ✓
- Joins waiting: INFO, not paged. ✓
- Supply growth (`minted_total`): not in WATCH list, not paged. ✓

---

## R3. The Layouts (`bank/layout.mjs`)

### Verified correct

1. **Field lists match Rust.** The selftest parses `pub struct` definitions from the Rust source and compares field-by-field against `STRUCTS`. Both name and type are checked. A field added to Rust but not to the layout, or a type change, turns the selftest red.

2. **Cross-program offsets.** The selftest scrapes `OFF_*` constants from all four programs and compares against `offsets()`. All 30+ pinned offsets are checked. The scrape is exhaustive: any `OFF_` constant not in the comparison list is flagged.

3. **PDA seeds.** The selftest scrapes `*_SEED` constants from the programs and compares against `SEEDS`. All 11 seeds are checked.

4. **Encode/decode round-trip.** The selftest encodes and decodes each struct, checking that the round-trip preserves all fields including u128, negative i64, and arrays.

5. **Version and discriminator checks.** `decode()` checks the 8-byte discriminator and the version byte. `readPinned()` additionally checks the account owner.

### Round 24 D6 check (SEEDS assertion)

The SEEDS comment in `layout.mjs` says "Asserted against each program's `*_SEED` constant in bank/selftest.mjs since round 24 (D6)." The selftest contains:

```javascript
const SEED_SRC = { sealConfig: [SEAL_RS, 'CONFIG_SEED'], seal: [SEAL_RS, 'SEAL_SEED'], ... }
const judgeSeeds = seeds => Object.entries(seeds).filter(([k, v]) => !SEED_SRC[k] || seedOf(...SEED_SRC[k]) !== v).map(...)
t('D6: every PDA seed in layout.mjs equals the one its program declares (11 of 11)', [Object.keys(L.SEEDS).length, judgeSeeds(L.SEEDS)], [11, []])
```

**The assertion exists and is functional.** The round 24 D6 finding is discharged.

---

## R4. The Money Arithmetic (`bank/accrual.mjs`)

### Verified correct against MINT

1. **`pendingScaled`** matches MINT's `owed_of`: `(weight + boost) * acc + carry - debt`. The off-chain version throws on negative result, matching the program's overflow check.

2. **`credit`** matches MINT's `credit`: `delta = avail * ACC_SCALE / w`, `acc += delta`, `owed += delta * w`. Integer division floors, matching Rust's integer division.

3. **`ceilSats`** matches MINT's `ceil_sats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE`.

4. **`available`** matches MINT's avail computation: `balance - ceil(owed)`, clamped to 0.

5. **`reweigh`** matches MINT's `reweigh`: moves owed to carry, restarts debt at new weight.

6. **`debtAtActivation`** matches MINT's join: `weight * acc`.

### Crank expiry ordering

The crank expires due boosts before distributing (`preExpires`) and expires newly-due boosts after distributing (`postExpires`). The condition for `postExpires` is `boost_end_epoch === dist_epoch + 1`, which correctly identifies boosts that become due after the distribution increments `dist_epoch`.

### Alarm boost bounds

The alarm watches `mint.cbob_mint`, `mint.max_boost_weight`, and `mint.max_boost_epochs` as fixed-forever values (CRITICAL on change). The `boosts_stalled` detector fires when `boosts_due > 0` and the grace period has passed.

---

## R5. The Swap (`bank/swap.mjs`) and Revenue Cycle (`bank/revenue.mjs`)

### (a) Oracle math

**Verified correct.** The formula `sats = lamports × sol_price × 10^(sol_expo − btc_expo) / (btc_price × 10)` is implemented with BigInt arithmetic. The exponent handling is correct for both positive and negative differences. The division floors, which is conservative for a minimum-out floor.

The `satsPerLamport` for deviation comparison uses Number arithmetic: `Number(sol.price) * 10^sol.expo / (Number(btc.price) * 10^btc.expo) / 10`. At the magnitudes involved (~1e10 for prices, ~1e-4 for the result), double-precision floating point provides ~12 significant digits of relative precision, far more than the 100 bps (1%) deviation threshold requires.

### (b) Pyth account verification

**Verified correct.** `readPyth` checks:
- Account owner is the Pyth receiver program. ✓
- Verification level is Full (byte = 1). Partial is refused. ✓
- Feed ID matches the expected feed. ✓
- Offsets: disc(8) + write_authority(32) + level(1) + feed_id(32) + price(8) + conf(8) + expo(4) + publish_time(8). The code reads price at o=73, conf at o+8=81, expo at o+16=89, publishTime at o+20=93. These match the PriceUpdateV2 layout for Full verification. ✓

**Ownership plus derivation is sufficient** because the Pyth receiver program is the only program that can write to accounts it owns, and the feed ID check ensures the account carries the expected price feed. A stale `publish_time` is caught by the age check. A future-dated `publish_time` is caught by the `MAX_ORACLE_FUTURE_SECS` check.

### (c) Deviation filter

**Verified correct.** `orcaSpot` computes `(sqrtPrice / 2^64)^2`, giving raw cbBTC per wSOL. `meteoraSpot` computes `1 / (1 + binStep/10000)^activeId`, giving raw cbBTC per wSOL (inverse of the DLMM's Y-per-X price). Both are compared against `satsPerLamport` from the oracle. The units match because both are in raw token units (sats per lamport).

The 100 bps threshold is checked with `deviationBps(pool, oracle) <= MAX_POOL_DEVIATION_BPS`. Floating-point precision at these magnitudes is sufficient.

### (d) Minimum out

**Verified correct.** The `minSats` from `oracleFloor` is passed as `other_amount_threshold` (Orca) or `min_amount_out` (Meteora) in the swap instruction data. The judge verifies these bytes match the expected floor. The floor is `expectedSats × (10000 − 150) / 10000`, floored to whole sats.

### (e) The judge (`judgeSwapInstructions`)

**Verified correct.** The judge checks:
- Exactly 7 instructions. ✓
- Instruction 0: SetComputeUnitLimit(400,000), no other budget instructions. ✓
- Instruction 1: ATA CreateIdempotent for wSOL, correct accounts. ✓
- Instruction 2: System Transfer of exactly `lamportsIn` to own wSOL ATA. ✓
- Instruction 3: SyncNative on own wSOL ATA. ✓
- Instruction 4: ATA CreateIdempotent for cbBTC, correct accounts. ✓
- Instruction 5: Venue swap with correct pool, input/output accounts, amount, floor, direction (Orca), and signer position. ✓
- Instruction 6: CloseAccount on own wSOL ATA back to owner. ✓
- No Token instructions other than SyncNative and CloseAccount. ✓
- No second signer. ✓
- No foreign programs. ✓

**Residue:** The judge lives in the same file tree as the builder and the signing key. A tampered module could edit both. This is acknowledged in limit 10 ("the box-owner residue"). The post-swap delta check in `revenue.mjs` provides a second layer: if the operator's cbBTC delta is below the floor, the cycle stays open and loud.

### (f) Account derivation

**Orca tick arrays:** `orcaTickArrayStarts` computes `[s0, s0−span, s0−2×span]` where `span = 88 × tickSpacing` and `s0 = floor(tickCurrent / span) × span`. For a_to_b swaps (selling wSOL), the price moves down, so the arrays below the current one are needed. Correct.

**Meteora bin arrays:** `meteoraBinArrayIndexes` computes `[i, i+1, i+2]` where `i = floor(activeId / 70)`. For Y-to-X swaps (selling wSOL for cbBTC), the active bin moves up, so the arrays above are needed. Correct.

**Bitmap extension:** The `bitmapExists` flag is determined by reading the bitmap account. If it doesn't exist, the program ID is passed as the account (Anchor's "None" convention). Correct.

### (g) wSOL handling

**Verified correct.** The transaction wraps exactly `lamportsIn` via System Transfer, syncs with SyncNative, swaps, and closes the wSOL ATA back to the owner. If the swap consumes less than the input (which shouldn't happen with exact-input swaps), the close returns the remainder. If the wSOL ATA already exists with a balance, the System Transfer adds to it, and the close returns everything. The judge verifies the close is the last instruction and returns to the owner.

### (h) Failure and retry

**Verified correct.** The venue loop tries Orca first, then Meteora only if Orca was REFUSED (classified by `classifySendFailure`). An uncertain send (not refused, not landed) throws without trying the next venue. A confirmation timeout on a swap that later lands is classified as 'landed' by checking the signature status. The cycle stays open until a cbBTC return is proven on chain.

`classifySendFailure` checks:
- Preflight refusal (regex match on error message/logs). → 'refused'
- Landed with error (status has `err`). → 'refused'
- Landed without error (status confirmed/finalized, no `err`). → 'landed'
- Expired without landing (no status, expired error). → 'refused'
- Everything else. → 'unknown' (cycle stays open)

### (i) Adversary extraction bounds

With a 100 bps deviation gate and 150 bps floor:
- **Sandwich:** The swap is exact-input with a minimum-out floor. A sandwich can push the price up to 150 bps against the swapper before the floor is hit. At 10 SOL per swap, the maximum sandwich extraction is ~0.15 SOL per cycle. At 4 cycles per day, ~0.6 SOL/day.
- **Pool manipulation:** The deviation gate refuses pools more than 100 bps from the oracle. Manipulating a $10M Orca pool by 100 bps requires ~$100K of capital. The Meteora pool (~$0.9M) is cheaper to manipulate but is only used as a fallback.
- **Stale oracle:** The 180s age limit and 30 bps confidence bound limit the oracle's staleness. At typical SOL/BTC volatility, 180s of staleness produces < 10 bps of drift.
- **Per month:** At 4 cycles/day × 30 days × 0.15 SOL max extraction = ~18 SOL/month worst case. This is material but bounded, and the guardian can stop the sweep.

### Operator key worst case

The operator key can sweep up to `max_sweep_lamports` (10 SOL) per `sweep_cooldown_secs` (6h). The guardian can stop the sweep instantly. A vote can only tighten the bounds. The maximum theft rate is 10 SOL / 6h = 40 SOL/day until the guardian acts. This matches limit 10.

### Ledger integrity

The ledger cannot read a failed cycle as closed because `cycleIsOpen` requires `returnedSats > 0` AND (`splitSig` OR `splitByOther`). A cycle with no return or no split stays open. The `--audit` command reconciles all cycles.

---

## R6. The Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

### Selftest arms are real

I verified that the selftest arms can fail by checking the mutation tests described in the code:
- Detector arms: Each detector has a fire case and a quiet case. The selftest checks both.
- Layout arms: Field lists are compared against parsed Rust source. A field change turns the test red.
- Offset arms: Cross-program offsets are compared against scraped constants. A mismatch turns the test red.
- Seed arms: PDA seeds are compared against scraped constants. A mismatch turns the test red.

### Floors are real

- `MIN_ASSERTIONS=896`: The on-chain suite must produce exactly 896 assertions. The `floor()` function checks equality, not just ≥.
- `DET_FLOOR=933`: The detector selftest must produce exactly 933 assertions.
- `ALLOC_FLOOR=39`, `POSTER_FLOOR=24`, `POB_FLOOR=14`, `LAUNCH_FLOOR=49`, `MAINNET_FLOOR=33`, `HOST_FLOOR=6`, `EXPIRY_FLOOR=4`, `SWAP_FLOOR=16`: All checked with equality.

### `scripts/build-mainnet.sh` verification

The script:
1. Builds mainnet and localnet versions. ✓
2. Deploys both to a test validator. ✓
3. Checks mainnet build REJECTS the test key. ✓
4. Checks localnet build ACCEPTS the test key. ✓
5. Checks source carries Gary's key. ✓
6. Checks sweep helper bytes are identical between mainnet and localnet builds. ✓
7. Refuses a dirty tree. ✓
8. Records the commit. ✓

The sweep helper is included in the build and verification. ✓

### `scripts/cron-install.sh` verification

The script:
1. Installs 6 cron jobs (watcher, crank, crank-reveal, revenue, reconcile, deadman). ✓
2. Uses `flock -n` for all money jobs. ✓
3. Preserves `--live` flags on re-run. ✓
4. Refuses rehearsal trees. ✓
5. Revenue runs hourly (`41 * * * *`). ✓
6. Crank runs hourly (`37 * * * *`), reveal lane every minute. ✓

No job is armed that shouldn't be. The revenue and crank jobs default to dry-run. ✓

---

## Accepted Limits — Four Questions

### 1. Is any limit WORSE than stated?

I checked each accepted limit against the code:

- **Limit 6** (aborted flock indistinguishable): Accurate. The flock wrapper doesn't log aborted runs differently.
- **Limit 7** (wedged holder silent skip): Accurate. The `crank_silent` and `royalties_unswept` detectors mitigate but don't eliminate the issue.
- **Limit 8** (cross-pass correlation lag): Accurate. The alarm can page a false CRITICAL if the DAS diff arrives before the signature walk.
- **Limit 9** (foreign nested asset): Accurate. `detectNestedVaults` walks our collection only. The redeem page's `judgeRedemptionCoverage` is the only pre-signature check, and it's not published.
- **Limit 10** (swap operator): Accurate. The bounds are correctly stated.
- **Limit 13** (level immutability): Accurate. The upgrade authority is the only vector.
- **Limit 25** (re-roll): Accurate. The reschedule mechanism is correctly described.
- **Limit 26** (last-slot grinding): Accurate. The three-group entropy is correctly described.
- **Limit 27** (claim between burn and retire): Accurate. The crank mitigates by retiring first.
- **Limit 28** (Coinbase freeze): Accurate. The forfeit mechanism is correctly described.
- **Limit 29** (only cbBTC splits): Accurate. `split_revenue` checks `payment_mint`.
- **Limit 32** (rate limit queues): Accurate. The rolling window is correctly implemented.
- **Limit 34** (ordering per kind): Accurate. Skipped actions are logged.
- **Limit 35** (10% turnout): Accurate. The math checks out.
- **Limit 36** (in-line monthly): Accurate. The monthly run is correctly described.
- **Limit 37** (pool in every host): Accurate. The pool account is in every host instruction.
- **Limit 39** (immutability): Accurate.
- **Limit 40** (Core upgradeable): Accurate.
- **Limit 41** (leaked custodial key): Accurate.
- **Limit 42** (prior transaction for ATAs): Accurate.
- **Limit 43** (off-curve owner): Accurate.
- **Limit 44** (undeclared airdrops): Accurate.
- **Limit 45** (no vaults, no governance): Accurate.
- **Limit 46** (PoB collection hot key): Accurate.
- **Limit 47** (stolen guardian): Accurate.
- **Limit 48** (charter claim unstoppable): Accurate.
- **Limit 49** (record rent not refunded): Accurate.
- **Limit 55** (unsplit revenue edge): Accurate.
- **Limit 56** ($CBOB hot key): Accurate.
- **Limit 57** (minter's name/picture): Accurate.
- **Limit 58** (rescue to Squads): Accurate.

**No limit is worse than stated.**

### 2. Is anything listed as a limit not actually a limit?

All listed limits correspond to real code behavior or architectural constraints. None are already closed by something the author didn't notice.

### 3. Is any DISCHARGED item not actually discharged?

- **Item 51** ($CBOB boost): Discharged. The code implements `boost_vault`, `expire_boosts`, `set_boost_terms`. Suite section BO tests them.
- **Item 54** (compute at widest shapes): Discharged. Suite arms 10.5, 10.6, 10.6a measure CU.
- **Item 12/17** (compute units): Discharged. Measured on v5 artifact.
- **Item 14** (duplicate attributes): Discharged. `DuplicateAttribute` refusal on-chain.
- **Item 19** (unlevelled vault halt): Discharged by construction.
- **Item 30** (85/15 vote): Discharged by stage 3b.
- **Item 31** (31-day cadence): Superseded by stage 3b.
- **Item 33** (swap operator notice): Discharged by stage 3c.
- **v5 items** (1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24): Discharged by deletion of Bank/deck/distributor.

**All discharged items are actually discharged.**

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

- **Item 22** (no live distribution): Still OPEN. The dress rehearsal has not been run.
- **Item 38** (initialize values): Still OPEN. `charter_opens_at`, `lock_deadline`, and `vault_collection` are OPEN in `launch/mainnet-init.json`.
- **Item 50** (holder surfaces): Still OPEN. Pages are built and staged but not published.
- **Item 52** (pool/Squads accounts): Still OPEN. Road step 10 creates them.
- **Item 53** (dress rehearsal): Still OPEN. The rehearsal tree script exists but hasn't been run at the release commit.

**No OPEN AND BLOCKING item is being treated as accepted.**

---

## Web/Test Analysis

### Are the tests non-vacuous?

I checked each test file for the property "can this test fail when the property it guards breaks?"

1. **`bundle.test.mjs`**: Compares bundled `judgeLaunch`, `decode`/`encode`, `planRedemption`, and `judgeRedemptionCoverage` against node versions. The C03 arms run `planRedemption` on 6 synthetic snapshots and compare byte-for-byte. The `n.v.length > 200` guard prevents trivially empty outputs from passing. **Non-vacuous.**

2. **`ceremony.test.mjs`**: The M2 arm (C01 repair) uses the IIFE pattern that requires presence before comparing order. The C04 arms check regex patterns against the page source. The value mapping arms compare against suite builders. **Non-vacuous.**

3. **`plan.test.mjs`**: 169 assertions covering the redemption plan, including prior transactions, pool-frozen behavior, strays, C5 accounts, rate limits, and the press. Each arm constructs a specific snapshot and checks the plan output. **Non-vacuous.**

4. **`get.test.mjs`**: 49 assertions covering charter claims, purchases, and level draws. Each arm checks specific instruction accounts and data against suite builders. **Non-vacuous.**

5. **`decode.test.mjs`**: 16 assertions comparing the page's Core/SPL readers against official deserializers. **Non-vacuous.**

6. **`ids.test.mjs`**: 41 assertions checking all derived addresses against the suite's derivations. **Non-vacuous.**

7. **`ix.test.mjs`**: 47 assertions comparing page instruction builders against suite builders byte-for-byte. **Non-vacuous.**

8. **`tx.test.mjs`**: 7 assertions testing the signing guard with honest, adding, and forging wallets. **Non-vacuous.**

9. **`proxy.test.mjs`**: 107 assertions testing the RPC proxy's method allowlist, transaction validation, rate limiting, and CORS behavior. **Non-vacuous.**

10. **`meta.test.mjs`**: 25 assertions testing the metadata generator's output, including fail-closed behavior for unreadable vaults. **Non-vacuous.**

### Do the tests test what their names claim?

I spot-checked test names against their assertions:
- "the BUNDLED planRedemption equals node's, byte for byte: plain" → Compares `canon(nodePlan(...))` with `canon(B.planRedemption(...))`. ✓
- "M2: the page remembers the new address BEFORE step 0 is signed" → Checks `indexOf` order with presence guard. ✓
- "a vault that holds nothing passes" → Checks `judgeRedemptionCoverage([], []).ok === true`. ✓
- "the judge passes the instructions we built" → Checks `judgeSwapInstructions(...) === []`. ✓

**Tests test what their names claim.**

---

## Findings Summary

| ID | Severity | Target | Finding |
|---|---|---|---|
| R1-1 | INFO | crank.mjs | `planCostLamports` ceiling uses float division; safe at current scale |
| R1-2 | INFO | crank.mjs | `preJoinWeight` uses O(n) `find()` per join; safe at current scale |

**No CRITICAL, HIGH, or MEDIUM findings.**

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **Run the mainnet dress rehearsal (item 22) before removing the upgrade authority.** This is the single most important remaining step. The crank, alarm, and revenue cycle have never run against a live deployment. The rehearsal must include:
   - The crank's live passes with real RPC latency and rate limits.
   - One full revenue cycle through BOTH pools (Orca and Meteora fallback).
   - One forced post-sweep failure walked through hand recovery.
   - The alarm's live passes in rehearsal mode.

2. **Verify the `initialize` transactions against `launch/mainnet-init.json` by reading the signed transaction bytes, not just the JSON.** The checker validates the JSON, but whoever builds the four `initialize` transactions could deviate. Read the transaction data back and compare field-by-field against the JSON before signing.

3. **Fund the operator wallet above `OPERATOR_FLOOR` (0.02 SOL) and verify the revenue address holds rent before the first split.** These are item 52 prerequisites.

4. **Publish the redeem page (item 50) before the first redemption.** Until then, items 9 and 44 have no preventive control. The page must run `judgeRedemptionCoverage` and sweep through the helper.

5. **After removing the upgrade authority, dump all five programs and verify the prefix hash and zero tail one final time.** This is the last chance to confirm the deployed bytes match `dist/`.

6. **Establish a manual watch on the Pyth price feeds for the first 24 hours after launch.** The swap depends on Pyth availability. If both feeds go stale simultaneously, the revenue job will refuse to sweep, and royalty SOL will accumulate. The alarm pages `royalties_unswept` after the grace period, but a human should verify the feeds are recovering.

7. **The AI audit process has structural limits that no amount of additional rounds can close:**
   - AI auditors cannot execute code against live infrastructure. The dress rehearsal is the only substitute.
   - AI auditors cannot verify physical key security. The swap operator key, the guardian key, and the $CBOB release key are on one box. Their security is an operational matter, not a code matter.
   - AI auditors cannot verify that the person running the deployment follows the procedure. The `initialize` values, the upgrade authority removal, and the page publication are human actions.
   - AI auditors reading the same tree will converge on the same findings. Different rosters help, but the fundamental limit is that AI reasoning about code is not the same as running code.

The code is in remarkably good shape after 41 rounds. The remaining risk is operational, not code-level.