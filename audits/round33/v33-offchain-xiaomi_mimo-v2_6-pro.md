# Independent Security Audit — Off-Chain Pipeline (v6)

**Audited tree:** the full current tree as bundled, including `bank/crank.mjs`, `bank/detectors.mjs`, `bank/alarm.mjs`, `bank/layout.mjs`, `bank/accrual.mjs`, `bank/swap.mjs`, `bank/revenue.mjs`, `bank/selftest.mjs`, `bank/lock.mjs`, `bank/spl.mjs`, `bank/anchor.mjs`, `bank/sigwalk.mjs`, `bank/txread.mjs`, `bank/redemption-poster.mjs`, `scripts/run-tests.sh`, `scripts/cron-install.sh`, `scripts/build-mainnet.sh`, `scripts/check-launch-params.mjs`, `scripts/rehearsal-tree.sh`, `scripts/audit-coverage.sh`, `scripts/token-programs.sh`, `sim/swap-fork.mjs`, `sim/swap-fork.sh`, `tests/expiry-budget.mjs`, `tests/fixtures/mainnet-v1.json`, `launch/mainnet-init.json`, `launch/create-cbob-token.mjs`, `launch/cbob-token.mainnet.json`, MINT `lib.rs`, sweep `lib.rs`, SPEC, DESIGN-v6, HOLDER-GUIDE, round-32 verdict and validation, RT3.

No live alarm, crank, revenue job, notification, crontab operation, deployment, lock or mainnet transaction was run. Selftest and pure-function claims are verified by reading source and tracing arithmetic.

---

## R0. Round 32's verdict and repairs

**Round 32's six confirmed findings (4 LOW, 2 INFO) all have visible repairs in this tree.** I verified each at its site:

| ID | Repair | Present? |
|---|---|---|
| L1 | `detectSweepState` (detectors.mjs) reads `last_sweep_at` from account state | Yes — but see Finding 1 below |
| L2 | `tx_unreadable` catch in alarm.mjs (per-transaction and per-listing) | Yes — cursor holds, pass continues, all four programs visited |
| L3 | `detectLogGaps` never drops unreviewed gaps; reviewed prefix trimmed; >2,000 escalates | Yes — `keep = [...reviewed, ...unreviewed]` with `unreviewed` never sliced |
| L4 | Coverage gate label matches credited focus; FOCUS-split by shape, fail-closed | Yes — `first_line_quorate` uses `'PROGRAMS'`/`'OFF-CHAIN'` per focus |
| D1 | Expiry-budget count pattern added to RX map | Yes |
| D2 | Gap review instruction says "LAST signature listed" | Yes |

Selftest floor 907, `DET_FLOOR=907`, SPEC's stated counts all match. The suite floor `MIN_ASSERTIONS=861` matches SPEC. All floors use equality (`-eq`), not `>=`.

**Residual from L1's repair:** Finding 1 below.

---

## R1. The crank (`bank/crank.mjs`)

**No defect found that would make the crank send value anywhere the program does not pin.** Every instruction it builds is a permissionless MINT instruction (`reschedule_reveal`, `capture_entropy`, `reveal_level`, `retire_burned`, `claim`, `expire_boosts`, `split_revenue`, `distribute`, `activate`). The selftest verifies the instruction name list and that no token/SOL transfer or non-MINT program is constructed.

I traced the ordering (reschedule → capture → reveal → retire → pre-joins → pre-expires → split → distribute → post-expires → activate → claims) against MINT's gates (`JoinWaitingFirst`, `BoostsExpireFirst`, `MonthNotElapsed`). The plan computes `avail` using `pool.amount + splitToPool`, assuming the split succeeds before the distribution. If the split fails benignly (`NothingToSplit` from a race), the distribution uses the actual pool balance and may find `NothingToDistribute`; `judgeDistributeRefusal` checks whether the epoch moved and correctly classifies this.

The `budgetPlan` function keeps the fee floor in reserve when budgeting reveals (round 30 L2 repair). I verified: `room = lamports - planCostLamports(base) - floor`, and reveals are drawn only from `room`. A key at the floor runs captures and zero reveals. A key below the floor runs the base plan with a warning. Both are tested both ways.

Reveal order: the plan walks from `revealed_total` forward and stops at the first not-ready vault. The send loop breaks on any failure or benign skip. Correct.

**The `lastFailure` variable is module-scoped and only set on non-benign failures.** When the distribute's `send` returns `'fail'`, `lastFailure` has just been set by that same `send` call (line: `lastFailure = code || ''`). `judgeDistributeRefusal` therefore always sees the distribute's own error code. No cross-contamination.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

The alarm reads configs through `readPinned` (owner, discriminator, version before offsets). The `missingWatchedKeys` gate ensures every watched key is produced. Third-party program keys (Orca, Meteora, Pyth receiver, Pyth push) are read in the same loop as Core and our four.

The `detectSweepState` repair (round 32 L1) provides a flood-immune backstop for operator-key sweeps. I verified the matching window `[st - 120, st + min(3600, cooldown/2)]` and confirmed that for any realistic cooldown (≥ 6 hours, since `tighten_sweep` can only increase it), a thief's sweep is never matched to an honest cycle. However, the function compares clock domains — see Finding 1.

I verified the `carryConfigBaseline` / `detectConfigDrift` interaction: `_missing` flags are stored from `cur` but not carried from `prev`, and L11's skip for "program appearing" is correctly gated on `prev[missingFlagOf(k)] === true`. A one-pass read failure carries the old value, and a change across the blip is compared.

`detectCrankSilent` uses `wallSec` consistently. `detectDistributionOverdue` uses `nowSec` (chain) against `last_distribute_at` (chain). `detectRedemptionRate` uses chain time against chain-stamped ring entries. These are correct.

`detectPoolHealth` reads the pool and `owed_scaled` together (`readPool` does a single `getMultipleAccountsInfo` for both), avoiding the read-skew issue.

---

## R3. The layouts (`bank/layout.mjs`)

I recomputed `MintConfig`'s fixed length from the field list: 997 bytes of fields + 8-byte discriminator = 1005. The selftest asserts `MINT_CONFIG_SPACE - CONFIG_PADDING === 1005` and `fixedLength('MintConfig') === 1005`. These match.

`VaultRecord`'s fixed length: 8 + 1 + 32 + 8 + 8 + 1 + 1 + 1 + 32 + 32 + 1 + 1 + 1 + 2 + 32 + 16 + 1 + 8 + 1 + 8 + 16 = 211. The selftest asserts 211. Matches.

The `offsets()` function computes from the discriminator. `readField` handles each type. `u128` decode/encode are correct (low 64 at `o`, high 64 at `o+8`).

The SEEDS assertion (round 24 D6 repair): the selftest scrapes each `pub const *_SEED` from the Rust and compares against `layout.mjs`'s `SEEDS`. All 11 match. A mistyped seed or unmapped key is caught.

Cross-program offsets: the selftest scrapes every `OFF_*` constant from BURN, GOV and MINT and compares against `layout.mjs`'s computed offsets. The "unchecked" gate ensures none is scraped and ignored. All 32+ constants match.

---

## R4. The money arithmetic (`bank/accrual.mjs`)

I traced `pendingScaled` against MINT's `owed_of`: `(weight_of(r) * acc + carry - debt)`. The JS uses `(weightOf(level) + BigInt(boost)) * BigInt(acc) + BigInt(carry) - BigInt(debt)`, matching.

`reweigh` matches MINT's `reweigh`: owed moves to carry, debt restarts at the new weight times acc.

`credit` matches MINT's `credit`: `delta = avail * ACC_SCALE / w; acc += delta; owed += delta * w`.

For the crank's `owed` computation of pre-joined vaults: `debt = weight * cfg.acc_scaled` (the old accumulator, set at join time before the distribution), and `acc` is post-distribution. The owed is `weight * delta`. Correct.

For pre-expired vaults: `atExpiry = pendingScaled(...)` at the old accumulator, then `owed = (atExpiry + level_weight * delta) / ACC_SCALE`. This matches MINT's `expire_boost` + `reweigh(0)` + subsequent `credit`.

The selftest's 39 allocation assertions cover weights, ratios, dust, timing, the pool, frozen/retired vaults, and the boost carry. All correct.

**The crank expires every DUE boost before distributing** (`plan.preExpires` where `dist_epoch >= boost_end_epoch`) **and every boost its own distribution makes due right after** (`plan.postExpires` where `boost_end_epoch == dist_epoch + 1`). Verified against `advance_epoch`'s increment.

---

## R5. The swap (`bank/swap.mjs`) and revenue cycle (`bank/revenue.mjs`)

### (a) Oracle math

`oracleFloor` computes `sats = lamportsIn * sol.price * 10^e / (btc.price * 10)` where `e = sol.expo - btc.expo`. I re-derived this from first principles: `sats = lamports / 1e9 * (sol_usd) / (btc_usd) * 1e8 = lamports * sol.price * 10^sol.expo / (btc.price * 10^btc.expo) / 10`. The code matches. For both feeds at expo −8, `e = 0` and the formula is `lamportsIn * sol.price / (btc.price * 10)`. Correct.

`minSats = expectedSats * (10000 - 150) / 10000`. Integer division floors. Correct direction (the floor is below the expectation).

`satsPerLamport` uses `Number` conversion. For current prices (~12e9 and ~8.6e12), both are within `Number.MAX_SAFE_INTEGER` (~9e15). No precision loss.

`orcaSpot` uses `Number(w.sqrtPrice) / 2^64` squared. For the SOL/cbBTC pair, `sqrtPrice ≈ 5.8e16`, above 2^53. Precision loss is ~1 ULP (~13), relative error ~2e-16. Negligible against a 100 bps gate.

`meteoraSpot` uses `1 / (1 + binStep/10000)^activeId`. Floating-point exponentiation is accurate to ~15 digits for the current range. Negligible.

Overflow: all critical arithmetic uses BigInt. The `satsPerLamport` float is only used for the deviation comparison (not for the on-chain floor). No overflow path found.

### (b) Pyth verification

`readPyth` checks: owner is the receiver program, `verification_level === 1` (Full), feed_id matches the expected hex, and the account is long enough. The offsets (disc 8, write_authority 32, verification_level 1, feed_id 32, price i64, conf u64, expo i32, publish_time i64) match the `PriceUpdateV2` Borsh layout.

Ownership + derived address is sufficient: the account is a PDA of the push-oracle program seeded with the feed_id. Only the push-oracle program can write to it, and it verifies the Wormhole VAA (signed by Pyth's guardian set) first. Replay of an old VAA would set an old `publish_time`, refused by the 180-second age check. A chosen price requires forging a guardian signature.

The age is measured against the chain Clock sysvar (checked for owner = `Sysvar111...`). The `MAX_ORACLE_FUTURE_SECS = 30` check refuses future-dated prices. Both are correct.

### (c) Deviation filter

`orcaSpot` is `(sqrtPrice / 2^64)^2` in raw units = cbBTC sats per wSOL lamport (B per A). `meteoraSpot` is `1 / (1 + binStep/10000)^activeId` = sats per lamport (inverse of the Y-per-X price). Both are in the same units as `satsPerLamport`. The deviation check `deviationBps(pool, oracle) = |pool - oracle| / oracle * 10000` is symmetric. At 99 bps the venue is used; at 101 bps it is skipped. The selftest proves both directions through `market()`.

Floating-point cannot pass a pool it should refuse: the deviation is computed from `satsPerLamport` (float) and `orcaSpot`/`meteoraSpot` (float). The precision loss (~1e-16 relative) is far below the 100 bps gate. A boundary case at exactly 100.0000000000001 bps might round to 100.0 and pass, but this is within the noise of the oracle itself.

### (d) Minimum out

The floor (`minSats`) is the oracle's expected output less 150 bps. It is passed as `other_amount_threshold` (Orca) or `min_amount_out` (Meteora). Both are in cbBTC sats (the output token's base units). The judge verifies the bytes at offset 16 match `minSats`. The same floor value is used for both the deviation filter's reference and the on-chain threshold (the filter uses `satsPerLamport`, the threshold uses `oracleFloor`'s `minSats`, both derived from the same oracle read). Consistent.

### (e) The judge (`judgeSwapInstructions`)

The judge requires the EXACT seven-instruction sequence. It checks: allowed programs only; one signer (the owner); no priority fee; Token instructions limited to SyncNative and CloseAccount; exactly 7 instructions; instruction 0 is `SetComputeUnitLimit(400000)` with no keys; instructions 1 and 4 are `CreateIdempotent` for the operator's own wSOL/cbBTC ATAs with the correct 6-key layout; instruction 2 is a System transfer of exactly `lamportsIn` to the operator's wSOL ATA; instruction 3 is `SyncNative` of that ATA; instruction 5 is the venue swap with the correct data length (42 or 24), amount at offset 8, threshold at offset 16, and for Orca the sqrt-price limit and both direction/amount flags pinned; the swap's input (key 3 or 4), output (key 5), pool (key 2 or 0), and signer (key 1 or 10) are pinned; instruction 6 is `CloseAccount` of the wSOL ATA to the operator.

**What the judge does NOT check for Meteora** (Finding 2): position 9 (`host_fee_in`). See below.

The selftest proves each of the eight round-25 tampers is refused on both venues, and that the round-24 judge passed all eight (so each arm can fail).

### (f) Account derivation

**Orca tick arrays:** `orcaTickArrayStarts(tickCurrent, tickSpacing)` returns `[s0, s0-span, s0-2*span]` where `span = 88 * tickSpacing` and `s0 = floor(tickCurrent / span) * span`. For an a_to_b swap (selling A), the tick moves down, so the current array and two below are needed. Verified against the selftest (`-88733` with spacing 16 gives `[-90112, -91520, -92928]`). The PDA seed is `['tick_array', pool, String(start)]`, matching Orca's published derivation.

At a tick-array boundary (`tickCurrent = -90112`), `s0 = -90112` (the array's own start). Correct.

An uninitialised tick array would cause Orca's swap to fail (refused at preflight or on-chain). No money moves.

**Meteora bin arrays:** `meteoraBinArrayIndexes(activeId)` returns `[i, i+1, i+2]` where `i = floor(activeId / 70)`. For a Y-to-X swap, the active bin moves up, so the current array and two above. Verified (`activeId=5920` gives `[84, 85, 86]`; `activeId=-1` gives `[-1, 0, 1]`). The PDA seed is `['bin_array', pool, i64_le_bytes]`, matching Meteora's IDL.

The bitmap extension is passed as the program id when absent (Anchor's None convention). `host_fee_in` is always None. Event authority and two token programs are pinned.

### (g) wSOL handling

The builder wraps exactly `lamportsIn` via a System transfer to the operator's wSOL ATA, calls `SyncNative`, swaps, then closes the ATA back to the operator. If the ATA already exists, `CreateIdempotent` is a no-op. If it's frozen, the swap fails (SyncNative or the swap's transfer would refuse). If it has a delegate, `CloseAccount` succeeds (SPL CloseAccount does not check delegates), and the delegate is revoked. If the swap consumes less than the input, the close returns the remaining wSOL lamports to the operator. The fork test verifies nothing stays wrapped.

### (h) Failure and retry

Orca is tried first; Meteora only on a REFUSED Orca (preflight error or on-chain failure confirmed via `classifySendFailure`). An UNCONFIRMED send stores `pendingSwapSig` and throws (never tries the second venue). `classifySendFailure` asks the chain via `getSignatureStatuses` with `searchTransactionHistory: true`: landed-and-failed is refused, landed-and-succeeded is recorded, expired-and-absent is refused, everything else is unknown (cycle stays open). The selftest proves each classification.

A confirmation timeout on a swap that later lands: `classifySendFailure` would return `landed` (the chain says it succeeded). The cycle records the signature and continues. No double swap. If the status lookup fails, the outcome is `unknown` and the cycle stays open (loud).

The ledger stays open until a cbBTC return is proven: `cycleIsOpen` requires `returnedSats > 0` AND (`splitSig` or `splitByOther`). The post-swap delta check (`delta < guaranteed` throws) catches a builder misroute. The `--audit` and the alarm's `unreconciled_swap` catch a missing return.

### (i) Adversary extraction within tolerance

With a 100 bps deviation gate and a 150 bps floor:
- A sandwich attacker who pushes the pool to the edge of the gate (100 bps from oracle) can extract at most 100 bps of the swap size before the venue is skipped.
- The 150 bps floor means the executed price can be at most 150 bps below the oracle. Combined with the 100 bps gate, the worst-case extraction is 150 bps of the swap size (the floor allows it; the gate prevents worse).
- At the ruled 10 SOL cap, 150 bps = 0.015 SOL per cycle. At 4 cycles/day (6h cooldown), that's 0.06 SOL/day = ~$9/day at $150/SOL. Not material for royalty flows.
- On Meteora (10x thinner), price impact is larger, but the 150 bps floor still bounds the loss. The venue is only used when Orca refuses.
- A stale-but-accepted oracle (up to 180 s) could have a price up to 180 s old. In 180 s, SOL might move 10-20 bps in normal conditions. Combined with the 150 bps floor, the total worst-case extraction is ~170 bps. Still bounded.

The operator key's worst case: 10 SOL per 6-hour cooldown until the guardian stops it. The `sweep_unledgered_state` check (round 32 L1) detects from account state within 30 minutes. The `unledgered_sweep` scan-based check detects from the transaction walk (delayable by flooding, but backed by the state check). The `unreconciled_swap` ledger check detects a missing return within an hour. Multiple independent detections.

---

## R6. The gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

The selftest has 907 assertions, all behind an equality floor. The `t()` function compares `got` to `want` via `JSON.stringify` with BigInt handling. I verified several key arms can fail:

- The round-25 judge arms: each of the eight tampers is applied to a clone of the honest build and verified refused. The round-24 judge is shown passing all eight (proving the arms can fail).
- The `readySlot` assertions use hand-worked values (`readySlot(1000) = 1016`, `readySlot(1004) = 1020`), not self-referential.
- The `attrsHash` assertion uses a pinned SHA-256 vector, not a recomputation of its own expression.
- The layout assertions compare JS to scraped Rust (both `parseRustStruct` and `OFF_*` constants).
- The wiring gate (`V6_WIRED`) is derived from `Object.keys(D).filter(/^detect/)` and verified with comment-stripping and result-consumption checks. Deleting any one detector call from `alarm.mjs` turns it red.

**One gap found in the stated-count check** (Finding 3).

`run-tests.sh` floors use equality (`-eq`). `MIN_ASSERTIONS=861` matches SPEC. `DET_FLOOR=907` matches `selftest.mjs`'s `FLOOR = 907`. `ALLOC_FLOOR=39`, `POSTER_FLOOR=23`, `MAINNET_FLOOR=33`, `LAUNCH_FLOOR=47`, `POB_FLOOR=14`, `HOST_FLOOR=6`, `EXPIRY_FLOOR=4`, `SWAP_FLOOR=16`. All match SPEC's stated counts.

`sim/swap-fork.sh` has `SWAP_FLOOR=16` and checks equality. The fork clones real mainnet pool state and runs real swaps through both programs. The 5%-above-oracle floor is refused by each program with nothing moved.

`scripts/build-mainnet.sh` deploys both builds and asks each whether it trusts the test key (mainnet rejects, localnet accepts). It honestly states it cannot prove the compiled constant IS Gary's key (only that it rejects the test key). The sweep helper is compared byte-identical between mainnet and localnet builds AND against `target/deploy`. The banner prints exactly what was proven and what was not.

`scripts/cron-install.sh` arms no money by default (both `revenue.mjs` and `crank.mjs` are opt-in `--live`). The preserve block reads only tagged, uncommented lines. The posture print is computed from the written crontab. The selftest runs the actual preserve logic with synthetic inputs.

---

## Accepted limits: the four questions

### 1. Is any limit WORSE than stated?

**No.** I checked the ones most likely to understate:

- **Limit 32 (redemption rate):** The ring of 64 bounds the cap at 64. At 2,100 live, cap = 45 < 64. The `live` count includes unretired bare burns (stated). Not worse.
- **Limit 10 (swap operator):** The worst case is cap × cooldown windows. The `sweep_unledgered_state` check detects within 30 minutes from account state. The scan-based `unledgered_sweep` is delayable but backed by the state check. The masking case (thief's sweep followed by an honest one while the alarm is down) is explicitly stated. Not worse.
- **Limit 46 (PoB hot key):** The sampling limitation (transient hook invisible to the 30-minute alarm) is stated. The "end the project" and "capture governance" outcomes are stated. The alarm's "ANY plugin change" claim is qualified by the sampling note. Not worse.
- **Limit 25 (re-roll):** A minter can let a draw lapse only if nobody captures for the whole ~300-slot window. The crank runs every minute and captures on host instructions. A reschedule is logged and alarmed (except under log truncation, which is paged). Not worse.
- **Limit 55 (unsplit revenue):** The crank splits hourly. During a crank stall, the balance grows. `revenue_unsplit` pages after 6 hours. Not worse.

### 2. Is anything listed as a limit not actually a limit?

**No.** Limit 27 (claim between bare burn and retirement) is still open: the program does not check asset liveness, and a third-party `claim` can still pay into a dead account. The crank's protection only covers its own claims. Limit 44 (undeclared airdrops destroyed) is still open: no preventive control exists until the redeem page is built.

### 3. Is any DISCHARGED item not actually discharged?

**No.** Items 51 (boost), 54 (compute), 12/17 (compute units), 14 (duplicate keys), 19 (unlevelled halt), 30 (split as vote), 31 (cadence), 33 (operator notice) are all discharged with visible evidence in the code and tests.

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

**No.** Items 22 (live distribution), 38 (initialize values), 50 (holder surfaces), 52 (pool accounts), 53 (dress rehearsal) are all clearly blocking. The SPEC says "nobody may write 'accepted' against" them. The holder guide is marked DRAFT and explicitly says it may not be published before item 50 ships.

---

## Findings

### Finding 1 — LOW

**Construct:** `bank/detectors.mjs`, `detectSweepState` (round 32 L1 repair).

**Defect:** The matching window compares a wall-clock timestamp with a chain-clock timestamp without domain translation:

```javascript
const st = Date.parse(c.startedAt) / 1000          // WALL clock (revenue.mjs's new Date())
return Number.isFinite(st) && t >= st - 120 && t <= st + after   // t is CHAIN clock (last_sweep_at)
```

`t` is `mint.last_sweep_at`, written by MINT via `Clock::get()?.unix_timestamp()` (chain time). `st` is `Date.parse(c.startedAt) / 1000`, written by `revenue.mjs` via `new Date().toISOString()` (wall time). The 120-second window absorbs modest skew but not systematic divergence.

**What an accident gains:** If the box's wall clock drifts more than 120 seconds ahead of the chain clock (NTP misconfiguration, VM time issues), every honest sweep generates a false `sweep_unledgered_state` CRITICAL. At the ruled 6-hour cooldown, that is a false CRITICAL every 6 hours. The operator may learn to ignore the pages, and a real thief's sweep (same page, same label) would be buried among them.

**Direction is safe:** A thief's sweep is never matched to an honest cycle regardless of clock skew, because the cooldown (≥ 6 h) always places it outside the window `[st - 120, st + 3600]`. I verified this algebraically for both skew directions. The false-positive-only direction means detection is never weakened, only noisy.

**Evidence if true:** Under controlled clock skew (set the box clock 5 minutes ahead), run the alarm against a chain where an honest sweep just landed. The `sweep_unledgered_state` finding would appear despite the ledger recording the cycle. The selftest would NOT catch this: its synthetic timestamps use the same numeric domain for both `startedAt` and `lastSweepAt`.

**Fix:** Use `cycleStartMs(c, sweeps, nowMs, chainNowMs)` to translate `startedAt` into the chain clock's domain (the same fix round 28 applied to `detectUnreconciledRevenue` and `detectSplitClaims`). Pass `chainNow = nowSec * 1000` from `alarm.mjs`. Alternatively, widen the lower bound to 600 seconds and document the residual.

---

### Finding 2 — INFO

**Construct:** `bank/swap.mjs`, `judgeSwapInstructions`, the Meteora swap's key list.

**Defect:** The judge pins the pool (position 0), input (position 4), output (position 5), and signer (position 10) for the Meteora swap, but does NOT verify position 9 (`host_fee_in`) is the "None" placeholder (the Meteora program id). The builder sets it correctly via `opt(null, false)`, but the judge would not catch a builder defect that changed it to a real account.

**What an accident gains:** If `host_fee_in` were set to a real token account, Meteora might route a host fee (a fraction of the swap fee) to that account. For the pinned pool (host fee percentage likely 0), the impact is zero. If the pool had a non-zero host fee, the extraction would be bounded by that percentage (typically 10% of the ~0.5% swap fee = ~5 bps of the trade). The `min_sats` floor would still bound total loss at 150 bps.

**Evidence if true:** A tampered `meteoraSwapIx` that sets `host_fee_in` to a stranger's token account would pass `judgeSwapInstructions` unchanged.

**Fix:** Add `if (!keyAt(sw, 9)?.equals(METEORA.program)) problems.push('host_fee_in is not None')` to the Meteora branch.

---

### Finding 3 — INFO

**Construct:** `bank/selftest.mjs`, the stated-count check (`RX` map and `everywhere` function).

**Defect:** The regex for `'launch'` is `/(\d+) launch assertions\b/g`. SPEC's "Running the tests" block states "47 launch and 33 live-mainnet assertions" — the phrase "launch assertions" is not consecutive in that text (it is "launch **and 33 live-mainnet** assertions"). The regex does not match this occurrence. SPEC's separate sentence "its selftest, 47 launch assertions behind a floor" does match. So `statedIn(spec, 'launch')` returns `[47]` from the second occurrence, and the check passes, but the "Running the tests" block's "47 launch" is unchecked. SPEC's claim that "bank/selftest.mjs checks EVERY occurrence here" overstates the regex coverage for this one phrasing.

**What an accident gains:** A stale "47 launch" in the "Running the tests" block (e.g., changed to "48" after adding a test) would go unnoticed by the selftest. The `run-tests.sh` floor (`LAUNCH_FLOOR=47`) would still enforce the real count, so the system is safe. Only the documentation would drift.

**Evidence if true:** Change "47 launch" to "48 launch" in SPEC's "Running the tests" block only (leave "47 launch assertions" elsewhere). The selftest would pass. The regex `statedIn(spec, 'launch')` would still return `[47]`.

**Fix:** Either change the regex to `/(\d+) launch\b/g` (which would match both phrasings), or change SPEC's "Running the tests" block to say "47 launch assertions" as a phrase.

---

## Anything else

No CRITICAL or HIGH findings survived measurement. I traced the crank's plan/send ordering against MINT's gates, the accrual arithmetic against the Rust, the swap's oracle math and judge against the published interfaces, the alarm's drift/correlation/gap logic against its own claims, and the layouts against the Rust structs. The round-32 repairs are present and functional, with one residual clock-domain issue (Finding 1).

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Run the mainnet dress rehearsal (item 22) at the terminal, by hand, with signatures recorded.** AI cannot execute the crank against a live cluster with 2,100 vaults, cannot observe real RPC latency and error rates, and cannot walk the hand-recovery runbook with real money at stake. The five named items (crank passes, alarm passes, one full revenue cycle through each pool, one forced post-sweep failure recovered by hand, one DAS read of a burned collection) must each be performed and their transaction signatures written down.

2. **Build and test the holder surfaces (item 50) with real wallets.** The redeem page, the deposit-address page, and the redemption poster are promised to holders but do not exist. AI cannot sign a Phantom transaction or verify that a page renders correctly. The page must run `judgeRedemptionCoverage` before the holder signs, sweep through the helper, and handle the legacy packet. Test with a real wallet on devnet first.

3. **Witness the `initialize` ceremony.** Four transactions signed by Gary's wallet, values read from `launch/mainnet-init.json`, read back from chain immediately after. Two people present. Every account address, every parameter, every event logged. AI cannot verify that the signed transaction matches the JSON — only the human builder can.

4. **Move the $CBOB release wallet key off the box** (or into a Squads/multisig). The SPEC says "moving it to Gary's own wallet or a Squads, and deleting the box key, would close it and is Gary's call." This is a custody decision that AI cannot make or verify. The backups also contain the key; they must be scrubbed or encrypted.

5. **Hold the Giraffish Moments collection key in cold storage during the 7-day charter window.** The SPEC says "holding it cold or in a multisig through the window would close it." This is an operational decision. AI cannot move a key to cold storage or verify it is there.

6. **Conduct an operational security review of the box.** Who has shell access? What is in the nightly R2 backups? Are the keys (crank, swap operator, $CBOB release) encrypted at rest? Is the alert router's SMS/e-mail path secure? AI cannot inspect the host.

7. **Perform an independent, human-verified rebuild.** Clone the repo at the release commit on a different machine, rebuild all five programs, and compare sha256 against `dist/SHA256SUMS`. This proves reproducibility (the bridge the build script names). AI cannot operate a second machine.

8. **Set up an off-box monitor.** A simple script on a different host that every 30 minutes reads: (a) the five programs' upgrade authorities are `IMMUTABLE`, (b) `mint.split_bps === 8500`, (c) `mint.collection` matches the expected value, (d) the PoB collection's plugins hash is unchanged. This is the only detection that survives a compromise of the primary box (accepted limit 10's "detection half does not survive a compromise of THIS BOX").

9. **Test the alert delivery path end-to-end.** Send a real test alert through `notify-gary-sms.sh` and verify Gary receives it on his phone/e-mail. Test the router's stream isolation (one kind's open stream does not suppress another). AI cannot pick up a phone.

10. **Freeze and verify the dependency tree.** `node_modules` is shared (symlinked from `/opt/gary-club`). Pin every dependency (web3.js, spl-token, mpl-core) and verify the lockfile. A supply-chain compromise in a dependency would not be caught by any test in this suite. Run `npm audit` and review the results by hand.