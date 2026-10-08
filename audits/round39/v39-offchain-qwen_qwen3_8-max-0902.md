# Round 39 Independent Audit — Off-Chain Pipeline, Sweep Helper, and Web Tests

## R0. Round 38 Verdict Verification

**C01 (frozen-pool joins not sent):** I independently verified the repair. The `planCrank` frozen-pool path now populates `plan.claims` from `plan.joins` when `poolOk && pool.frozen && plan.joins.length` (crank.mjs, the `else if` after the main claims block). I traced the MINT `claim` instruction: the `r.pending` branch calls `join()` which only mutates config counters and the vault record — it never touches the pool token account. The `monthly_inline` prelude returns `Ok(())` early when the pool is frozen (the `TOKEN_STATE_FROZEN` check), so it does not block. The join-only claim batches will land against a frozen pool. **Repair holds.**

I also verified the selftest arm: the R37 C02 arm asserts `p.joins.length === 1` and the R38 C01 arm asserts `p.claims.length === 1` and `p.claims[0]` contains the vault. The arm would be red at the pre-repair code where `claims` was `[]` under a frozen pool. **Arm is non-vacuous.**

**C02 (detectSweepState JSDoc):** The comment now reads "within half a cooldown" and "There is no baseline-only first pass: a missing `judgedThrough` is 0 (review 32), so the first pass judges too." Both match the code (`half = Math.floor(Number(cooldownSecs) / 2)`, `from = Number(judgedThrough ?? 0)`). **Repair holds.**

**C03/C04 (documentation-exception items):** C03's SPEC text now says "at the read the swap is built from; the earlier read only decides whether to sweep." This matches the code: `m1.venues` gates the sweep decision, `m2.venues` gates the swap loop. C04's limit 7 now names the daily `--reconcile` and its silent stall. Both are text-only. **Verified as stated.**

**Rejected claims re-check:** I re-examined C07 (stranger pre-creates operator wSOL ATA with hostile close authority). The ATA address is a PDA of the Associated Token program; only that program can create an account there via `invoke_signed`, and it initializes with `owner = wallet` and no close authority. Setting a close authority requires the owner's signature. **Rejection stands.**

I re-examined C16 (v1 transaction with lookup table holding a cursor). The `txread.mjs` validator rejects v1 transactions with `lookupTable`-sourced keys (`need(m.accountKeys.every(k => k.source !== 'lookupTable'), 'v1 lookup-table key')`). Solana v1 does not support address lookup tables. **Rejection stands.**

---

## R1. The Crank (`bank/crank.mjs`)

**No new findings.** I traced the following paths and found them correct:

- **Weight calculation:** `w = total_active_weight + preJoinWeight - retiringWeight - expiringWeight`. I verified no double-counting: `retiringWeight` includes full weight (base + boost) of retiring vaults; `expiringWeight` excludes retiring vaults via `retiring.has(r.address)`; `preJoinWeight` adds base weight of joining vaults. The order of operations in `main()` (retire → join → expire → distribute) produces the same final weight regardless of intermediate order.

- **Post-distribution accumulator for claims:** `acc += avail * ACC_SCALE / w` matches MINT's `credit()`. For preJoined vaults, debt is `weight * pre_dist_acc`, so owed is `weight * (post - pre) / ACC_SCALE`, correctly computed via `pendingSats({ level, debt: LEVEL_WEIGHTS[r.level-1] * cfg.acc_scaled }, acc)`.

- **preExpired vault claims:** The formula `(atExpiry + LEVEL_WEIGHTS[r.level-1] * (acc - cfg.acc_scaled)) / ACC_SCALE` correctly computes owed-at-expiry plus level-weight share of the new distribution, matching MINT's `reweigh` → `expire_boost` → `credit` sequence.

- **budgetPlan:** The base plan cost excludes reveals; reveals are budgeted from remaining balance minus floor. The `planCostLamports` correctly counts all transaction types including batched joins/expires.

- **judgeDistributeRefusal:** `PoolShort` always fails. Race codes (`NothingToDistribute`, `BoostsExpireFirst`, `JoinWaitingFirst`) are benign only if epoch or `last_distribute_at` moved. This is correct: if someone else distributed, they also handled the joins/expiries.

- **mintFailureCode:** The invoke-stack parser correctly attributes error codes to MINT only, resets on MINT success, and returns null on stack imbalance. The 5-second timeout on `getLogs` prevents hangs.

**One observation (not a finding):** The crank sends each reschedule, capture, retire, and activate as individual transactions. At 2,100 vaults with many pending operations, this could be slow. But this is a throughput concern, not a correctness issue, and the crank is designed to be resumable across passes.

---

## R2. The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

**No new findings.** I verified:

- **detectSweepState:** The half-cooldown window, grace period, and `landed` set for uncertain sends are correctly implemented. The `judgedThrough ?? 0` baseline means the first pass judges immediately, matching the corrected comment.

- **detectUnsweptRoyalties:** The grace period `max(24h, cooldown + 1h + 1h)` correctly adapts to voted cooldown changes. The balance-fall reset correctly identifies sweeps.

- **detectRevenueAccount:** The split-time tracking correctly updates `since` to the latest split. The frozen-account check fires at any balance.

- **closesCycle:** The binary search over sorted splits, the anchored/unanchored distinction, and the exclusion set are correctly implemented. The `sortedSplits` WeakMap cache is keyed by array identity with length check, which is safe for the usage pattern (arrays are not mutated in place).

- **readProgramData:** The ELF-at-45 invariant is correctly implemented with the Option-tag check at byte 12. The malformed-tag case (neither 0 nor 1) correctly returns a problem rather than claiming immutability.

- **detectLogGaps:** The watermark-based review system, the 2000-gap escalation, and the no-eviction rule for unreviewed gaps are correctly implemented.

---

## R3. The Layouts (`bank/layout.mjs`)

**No new findings.** I verified:

- All struct field lists match the Rust source (the selftest's `parseRustStruct` comparison).
- All cross-program offsets (GOV reading MINT, BURN reading MINT and SEAL, MINT reading SEAL) are asserted in the selftest.
- The SEEDS are asserted against the Rust `pub const` declarations (the D6 repair from round 24).
- The `collectionPluginsHash` correctly skips the base fields (key, update_authority, name, uri, num_minted, current_size) and hashes only the plugin region.

---

## R4. The Money Arithmetic (`bank/accrual.mjs`)

**No new findings.** I verified:

- `credit()`: `delta = avail * ACC_SCALE / w`, `owed += delta * w`. Matches MINT.
- `pendingScaled()`: `(weight + boost) * acc + carry - debt`. Matches MINT's `owed_of`.
- `reweigh()`: Moves owed to carry, resets debt at new weight. Matches MINT.
- `ceilSats()`: `(scaled + ACC_SCALE - 1) / ACC_SCALE`. Matches MINT.
- `available()`: `balance - ceilSats(owed)`, clamped to 0. Matches MINT's `distribute` avail computation.

The selftest's 39 assertions cover the key properties: level ratios, dust carrying, timing, pool solvency, frozen/retired vaults, and boost mechanics.

---

## R5. The Swap (`bank/swap.mjs`, `bank/revenue.mjs`)

**No new findings.** I verified:

**(a) Oracle math:** The `oracleFloor` computation `lamports * sol.price * 10^e / (btc.price * 10)` correctly computes sats, where `e = sol.expo - btc.expo`. With both expos at -8, this simplifies to `lamports * sol.price / (btc.price * 10)`, which equals `lamports / 10^9 * SOL_USD / BTC_USD * 10^8`. The `satsPerLamport` for deviation checking uses the same formula in floating point. Precision is sufficient for the 100 bps deviation check.

**(b) Pyth verification:** The `readPyth` offsets are correct for the PriceUpdateV2 layout: discriminator (8) + write_authority (32) + verification_level (1) + feed_id (32) + price (8) + conf (8) + expo (4) + publish_time (8). The Full verification level (1) has no extra byte, so offsets are correct. The ownership check against `PYTH.receiver` and the feed-id check are present.

**(c) Deviation filter:** `deviationBps = |pool - oracle| / oracle * 10000`. The Orca spot price `(sqrtPrice / 2^64)^2` gives raw cbBTC per raw wSOL, which is sats per lamport. The Meteora spot price `1 / (1 + binStep/10000)^activeId` gives sats per lamport (inverse of lamports per sat). Both are correct.

**(d) Minimum out:** The `minSats = expectedSats * (10000 - 150) / 10000` is used as both the deviation-check reference and the on-chain floor. The same `guaranteed = m2.f.minSats` is passed to the swap instruction and checked by the judge. Consistent.

**(e) The judge:** I verified the 7-instruction sequence check, the per-instruction validation, and the key-position checks for both venues. The judge checks: compute budget (no priority fee), ATA creations (correct owner/mint), System transfer (exact amount to own wSOL), SyncNative, swap (correct pool, input/output accounts, amount, floor, direction for Orca), and wSOL close. The unpinned Meteora keys (bitmap, reserves, mints, oracle, host_fee_in, event authority, bin arrays) are validated by the Meteora program itself during execution; the host_fee_in only affects protocol fee routing, not user output. This was already dispositioned in R38 C12.

**(f) Account derivation:** Orca tick arrays use `["tick_array", pool, start_string]` seeds, matching the Orca IDL. Meteora bin arrays use `["bin_array", pool, index_i64]` seeds. The `Math.floor` for negative tick/bin indices is correct.

**(g) wSOL handling:** The swap wraps exactly `lamportsIn`, syncs, swaps, and closes. If the operator's wSOL ATA already exists with a balance, the `createAtaIdempotent` is a no-op and the transfer adds to it. The close at the end returns all remaining lamports. A pre-existing balance would be returned to the operator, not lost.

**(h) Failure and retry:** The `classifySendFailure` function correctly distinguishes preflight refusals, on-chain failures, expired blockhashes, and unknown states. The venue loop only tries Meteora if Orca was REFUSED (not unknown). An unknown state stops the cycle open and loud. The ledger is not marked closed until a cbBTC return is confirmed.

**(i) Extractable value:** The 150 bps floor and 100 bps deviation gate bound the extractable value per cycle. At 10 SOL per cycle and ~$120/SOL, 150 bps is ~$18 per cycle. At 4 cycles/day, ~$72/day. This is stated in SPEC and the holder guide.

---

## R6. The Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

**No new findings.** I verified:

- The selftest's 926 assertions cover all detectors in both directions.
- The `run-tests.sh` floors match the actual assertion counts (895 on-chain, 926 detector, 39 allocation, 24 poster, 14 PoB, 49 launch, 33 mainnet, 4 expiry, 16 swap-fork, 6 host).
- The `build-mainnet.sh` correctly builds all five programs, asks each for its key, and verifies the sweep helper's byte identity.
- The `cron-install.sh` correctly wraps all money jobs in `flock -n`, preserves tagged `--live` lines, and refuses rehearsal trees.
- The `audit-coverage.sh` correctly checks both path coverage and content-hash coverage against completed quorate rounds.

---

## Accepted Limits — Four Questions

**1. Is any limit WORSE than stated?**

I examined limits 10, 25, 26, 27, 28, 32, 40, 41, 44, 46, 47, 55, 56, 58. I found no limit that is worse than stated. Specifically:

- Limit 10's "per-sweep cap x cooldown windows" correctly describes the rate-limited exposure. The `sweepAmount` function takes `min(amount, maxPerCycle, chainCap)`, so the on-chain cap binds.
- Limit 32's ring-bounded cap correctly describes the 64-slot ring limiting the cap at high supply.
- Limit 47's "half of ALL live vaults" correctly describes the `KeyChangeNeedsHalf` check against the snapshot at proposal creation.

**2. Is anything listed as a limit not actually a limit?**

No. Each accepted limit describes a real constraint that exists in the code.

**3. Is any DISCHARGED item not actually discharged?**

I checked items 12/17 (compute units), 14 (duplicate attributes), 19 (unlevelled vault halt), 30 (85/15 vote), 31 (31-day branch), 33 (7-day operator), 51 ($CBOB boost), 54 (compute at widest shapes). All appear correctly discharged. The compute measurements are in the suite, the duplicate-attribute refusal is on-chain, the boost mechanism is built and tested.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

No. Items 22, 38, 50, 52, 53 are all listed as OPEN AND BLOCKING. The `launch/mainnet-init.json` still has `charter_opens_at`, `lock_deadline`, and `vault_collection` as OPEN. The holder guide is marked DRAFT. No evidence of quiet acceptance.

---

## Web/Test Files

I examined `bundle.test.mjs`, `ceremony.test.mjs`, `decode.test.mjs`, `e2e-localnet.mjs`, `get.test.mjs`, `ids.test.mjs`, `ix.test.mjs`, `meta.test.mjs`, `plan.test.mjs`, `proxy.test.mjs`, `tx.test.mjs`, and `run-all.mjs`.

**The tests are non-vacuous.** Each test file has assertions that can fail:

- `bundle.test.mjs`: Compares browser-bundled `judgeLaunch` against node `judgeLaunch`, checks the bundle for node-module imports, verifies static HTML properties. The browser/node comparison would fail if the bundle broke the function.
- `plan.test.mjs`: Tests `planRedemption` with synthetic snapshots, checking refusals, acks, prior transactions, and the sweep helper integration. The R38 V38-2 test verifies that late arrivals don't block the opening.
- `ceremony.test.mjs`: Tests the launch ceremony steps, including collection creation, program initialization, and the decoy-collection handling.
- `proxy.test.mjs`: Tests the RPC proxy's method allowlist, filtered `getProgramAccounts`, and transaction validation.
- `e2e-localnet.mjs`: End-to-end test on a local validator, covering the full lifecycle from collection creation through redemption.

I found no test that asserts a tautology or cannot fail.

**One observation on `bundle.test.mjs`:** The regex for detecting node-module imports (`/from\s*["'](node:)?(crypto|fs|url)["']|require\(["'](crypto|fs|url)["']\)/`) would not catch a dynamic `import("crypto")`. However, esbuild with `platform: 'browser'` resolves imports at build time, so dynamic imports of node modules would be caught at build time, not at the regex check. This is not a vacuous test.

---

## Findings Summary

**No new CRITICAL, HIGH, or MEDIUM findings.**

The R38 repairs (C01, C02) hold under independent verification. The documentation-exception items (C03, C04) are correctly stated as text. The rejected claims (C05–C24) remain correctly rejected.

The code is in very good shape after 38 rounds of iterative improvement. The major risk areas (pool accounting, swap floor, crank ordering, alarm coverage) have been thoroughly verified by both the suite and the selftest.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **Run the dress rehearsal (item 22) with adversarial conditions.** The rehearsal should include: a frozen pool during a distribution cycle, a stranger depositing dust into a vault mid-redemption, a Pyth price going stale during a swap, and a crank crash mid-pass. These are the scenarios the local validator cannot produce but mainnet will.

2. **Verify the `initialize` transactions byte-for-byte against `launch/mainnet-init.json`.** The checker validates the JSON, not the signed transaction (R24 A6). Whoever builds the four `initialize` transactions must produce them from the checked file, and the transaction bytes should be independently verified before signing.

3. **Test the hand-recovery path for the revenue cycle with a real open cycle.** Item 22.4 requires a forced post-sweep failure walked through hand recovery. This should be done with a real cycle, not a simulation, because the recovery involves reading the ledger, checking the chain, and manually recording the return.

4. **Verify the operator key's isolation.** The operator wallet must hold nothing but the cycle's funds and fee float (limit 10, D2). This is an operational instruction, not a code guarantee. Before launch, verify the operator key's balance and confirm no other assets are held.

5. **Establish a manual verification procedure for the Pyth price accounts.** The `readPyth` function trusts the Pyth receiver program's account layout. If Pyth upgrades the receiver, the layout could change. Before launch, manually verify the PriceUpdateV2 layout against Pyth's current documentation, and establish a procedure for re-verification after any Pyth upgrade.

6. **Run the full `run-tests.sh` at the release commit, not just the components.** The rehearsal-tree proof (item 53) must be re-run at the release commit. The current proof is at `d57ee3a` and is stale (R24 D4).

7. **Verify the sweep helper's deployed bytes against the tested bytes one final time.** The `build-mainnet.sh` proves byte identity between `dist/` and `target/deploy/`, but the actual deployment should be dumped and compared against `dist/` after the upgrade from the placeholder (step 9).