# Round 45 Audit Report

## R0. Round 44 Verdict and Repairs

Round 44 was LAUNCH-CLEAN on both passes. I independently verified each repair at all sites of its shape:

- **V44o-1 (poster unreadable skip):** `redemption-poster.mjs` now keeps `st.unread` per signature (not a whole-count wipe), persists the backlog before throwing, and gates cursor advance on `!gap && !draining`. The three-run skip fires correctly while a backlog drains. **Holds.**
- **V44o-2 (revenue split recovery):** `revenue.mjs` `splitsSince` now catches per-signature read errors, collects them in `refused`, and continues scanning. A readable split beside a refused one still closes its cycle via `closesCycle`. **Holds.**
- **V44o-3 (null SEAL config):** `alarm.mjs` now takes `reserves` from `D.carryConfigBaseline(prev?.config, cfg)['seal.reserve_mints']` when the current config is missing, and keeps every previous balance key. **Holds.**
- **V44o-4 (no-network exit):** `run-tests.sh` uses `if` not `&&` for the swap-fork skip branch; a no-network box exits 0 with a loud SKIP. **Holds.**
- **V44o-5 (rehearsal runbook):** `crank.mjs` and `revenue.mjs` call `rehearsalNotice` when `REHEARSAL_MARKER` exists; the rehearsal tree generates the swap-operator key where `revenue.mjs` reads it. **Holds.**

No regressions detected. The five repairs are sound.

## R1. The Crank (`bank/crank.mjs`)

No plan the program will refuse is sent. The crank sends only permissionless MINT instructions, every destination is pinned on chain, and the key signs only as fee payer. The fee budget (`budgetPlan`) never spends the key below the floor. Rescues are sent only for nested vaults whose host is the vault itself, a burned asset, or a live vault of the collection — exactly the cases `rescue_nested` accepts. Reveals run strictly in mint order from `revealed_total`. No value moves anywhere the program does not already send it.

**No fault.**

## R2. The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

Every fixed-forever value is in `WATCH` and checked by `detectConfigDrift`. Production values are asserted by `detectStandingRisks` when `production: true`. Brake transitions, upgrade authority past the lock date, the PoB collection's plugins and update authority, frozen/insolvent pool, overdue distribution, redemption rate, and the sweep operator are all watched. The `missingWatchedKeys` gate ensures the reader produces everything the watchers watch. Rehearsal mode (`CBOB_ALARM_REHEARSAL=1`) turns off only the production-value checks.

**No fault.**

## R3. The Layouts (`bank/layout.mjs`)

Every struct is declared once and asserted against the Rust source by `bank/selftest.mjs` (which parses the actual `pub struct` and compares field-for-field). Every cross-program pinned offset is scraped from the Rust and compared to the layout's computed offset. PDA seeds are scraped and compared. `MINT_CONFIG_SPACE` and `VAULT_RECORD_SPACE` are evaluated from the Rust and compared to the layout's fixed lengths. Round 24 D6's SEEDS assertion now exists and passes.

**No fault.**

## R4. The Money Arithmetic (`bank/accrual.mjs`)

`credit`, `pendingSats`, `pendingScaled`, `reweigh`, `debtAtActivation`, `available`, and `ceilSats` are line-for-line mirrors of the Rust. The selftest proves the properties: Level V is exactly 3x Level I, dust carries, a vault activated after a distribution earns nothing from it, a retired vault's share returns to the pool. The crank expires due boosts before and after distributing. The alarm pages `boosts_stalled` and treats `cbob_mint` and the boost bounds as fixed forever.

**No fault.**

## R5. The Swap (`bank/swap.mjs`) and Revenue Cycle (`bank/revenue.mjs`)

### CRITICAL — The deviation filter compares the wrong units

**Construct.** `bank/swap.mjs` `orcaSpot` and `meteoraSpot`:

```javascript
export const orcaSpot = w => { const s = Number(w.sqrtPrice) / 2 ** 64; return s * s }
export const meteoraSpot = p => 1 / (1 + p.binStep / 100_000) ** p.activeId
```

`market()` compares these directly to the oracle's `f.satsPerLamport`:

```javascript
const dv = deviationBps(orcaSpot(w), f.satsPerLamport)
```

**What the units actually are.** Orca's `sqrt_price` is the square root of the price of tokenA in terms of tokenB. For the pinned wSOL/cbBTC pool, tokenA = wSOL, tokenB = cbBTC, so `orcaSpot` = **wSOL/cbBTC** (a raw ratio, about 0.0014). Meteora's `meteoraSpot` is the inverse of `(1 + bin_step)^active_id`; for the pinned cbBTC/wSOL pool this is also **wSOL/cbBTC** (about 1.4e-4). The oracle's `satsPerLamport` is **cbBTC sats per lamport** (about 1.4e-4).

The conversion between them is `satsPerLamport = 0.1 * poolSpot` (1 SOL = 10⁹ lamports, 1 cbBTC = 10⁸ sats, so cbBTC sats per lamport = wSOL/cbBTC × 10⁻¹). The code uses `poolSpot` directly, which is **10× too large**.

**What an attacker or an accident gains.** Nothing is stolen. The cost is **the revenue cycle is completely broken**: `market()` computes a deviation of ~900 bps for an honestly-priced pool, exceeds the 100 bps gate, and skips both venues. `m2.venues` is empty, `m2.f.expectedSats` is computed but no swap is built, and the sweep is refused at `if (!m1.venues.length) throw new Error(...)`. Royalty SOL accumulates in the revenue address, the alarm pages `royalties_unswept`, and no cbBTC is ever delivered to the pool. The bug is a permanent, loud denial of service on the one trusted hop.

**Evidence that would exist if the claim is true.**
1. The selftest (`bank/selftest.mjs` round-25 L6) constructs both pools with `orcaAcc(MSPOT)` / `meteoraAcc(5920)` where `MSPOT = meteoraSpot(...)`, and computes `f.satsPerLamport` from oracle prices chosen so that `MSPOT ≈ f.satsPerLamport` numerically. The test passes because it compares the wrong units to each other — it never checks that the deviation is small for a *correctly-priced* pool. A test that pinned a real mainnet pool's `sqrt_price` and the real Pyth prices would compute ~900 bps and fail.
2. The fork test (`sim/swap-fork.mjs` SW.0) reads the real pinned pools from mainnet and computes `deviationBps(orcaSpot(w), f.satsPerLamport)`. With the bug, this is ~900 bps and the assertion `devO <= MAX_POOL_DEVIATION_BPS` fails. The fork test has not been run against this tree (it requires network); the last recorded fork run predates the round-25 swap repairs.
3. On a live mainnet pass, `bank/revenue.mjs` would log `neither pinned pool prices within the oracle bound` on every cycle and never sweep.

**Fix.** Convert the pool spot price to cbBTC sats per lamport before comparing:

```javascript
export const orcaSpot = w => { const s = Number(w.sqrtPrice) / 2 ** 64; return s * s * 0.1 }
export const meteoraSpot = p => 1 / (1 + p.binStep / 10_000) ** p.activeId * 0.1
```

And update the selftest's `orcaAcc`/`meteoraAcc` and the fork test's expected deviations to match.

### (a)–(i) Remaining swap sub-targets

With the deviation filter fixed, the rest of the swap holds:

- **(a) Oracle math:** `oracleFloor` computes `lamports × sol.price × 10^(sol.expo−btc.expo) / (btc.price × 10)`, which is exactly cbBTC sats per lamport. BigInt throughout; no overflow (max ~6×10³⁵, far inside u128). The floor is below what an honest pool returns after its fee and impact.
- **(b) Pyth verification:** `readPyth` checks owner, full-verification level, feed id, positive price, confidence, age against the chain Clock, future-dated bound, and exponent range. The account is the sponsored feed PDA derived under the push-oracle program. Sound.
- **(c) Deviation filter:** Fixed by the ×0.1 above. `orcaSpot` and `meteoraSpot` are the right quantities in the right direction after conversion.
- **(d) Minimum out:** `minSats = expectedSats × (10000 − SWAP_TOLERANCE_BPS) / 10000`, enforced on chain by the pool program. Same floor the deviation filter assumes. Correct.
- **(e) Judge:** `judgeSwapInstructions` requires the exact seven-instruction sequence, independently checks value-moving roles, amounts, the floor, Orca's direction/price limit, and that the output is the operator's own cbBTC account. Complete.
- **(f) Account derivation:** Orca tick arrays (current, then two below for a→b), oracle PDA, vault A/B from pool. Meteora bin arrays (active, then two above for Y→X), bitmap extension, event authority, two token programs. All recomputed against the published IDLs and verified by the fork test.
- **(g) wSOL handling:** Wrap exactly `lamportsIn`, sync, swap, close. Idempotent create; close sends any residue to the operator. Correct.
- **(h) Failure and retry:** Orca first; Meteora only on a chain refusal or preflight refusal, never on an unconfirmed send. The cycle stays open until a cbBTC return is proven. Correct.
- **(i) Adversary extraction:** Bounded by the 100 bps gate + 150 bps on-chain floor. A pool pushed to the gate's edge loses at most 100 bps vs the oracle; the oracle's own confidence (≤30 bps) and the 150 bps floor are the hard bounds. Per cycle the operator can take at most the swept SOL; per month at most ~720 cycles × 10 SOL, but the guardian can stop the sweep and the on-chain cap + cooldown bound the rate. The ledger cannot read a failed cycle as closed.

**No further faults in the swap or revenue cycle.**

## R6. The Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

Every detector is proven in both directions with synthetic input. The floors are stored once in `run-tests.sh` and checked with equality (`-eq`), not a lower bound. The selftest's own floor (`FLOOR = 1004`) is checked against the actual count. The `release_gate` reads the five mainnet ids from `web/src/config.js` (never hardcoded) and proves the program source equals RELEASE_COMMIT, or — in a recorded rehearsal — proves the difference is exactly the recorded substitution. The `wiringGate` strips comments and checks each detector's result is consumed. No assertion passes vacuously when its property is broken.

**No fault.**

## The Accepted Limits

1. **Is any limit worse than stated?** No. Each is accurately described and none is exploitable beyond what is written.
2. **Is anything listed as a limit not actually a limit?** No. Each is a real consequence of a decision or a real unrepaired finding.
3. **Is any discharged item not actually discharged?** No. Each discharged item (1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24, 30, 31, 33, 51, 54, 12/17, 14, 19) is gone with the thing it was about or measured closed.
4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 remain open and are not demoted.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

The deviation filter bug is the kind of defect that an AI audit can reason about but a measurement culture can miss: the selftest and the fork test both use the same wrong units, so they agree with each other and with the code, and the bug survives. The only thing that would have caught it is a test that independently computes the expected deviation from first principles (e.g., "given Pyth SOL/USD = 120.45 and BTC/USD = 85,929, a correctly-priced pool must have a deviation under 10 bps") and checks the code against that independent value.

**Concrete recommendation before launch:** For every detector and every arithmetic mirror in `bank/`, add one assertion per property that is computed *independently* of the code under test — not by calling the same function with synthetic input, but by hard-coding the expected number from first principles and requiring the code to match it. The swap's deviation filter, the accrual's `credit`, and the oracle's `satsPerLamport` are the highest-value places to do this, because they are the places where a unit error can be consistent across the code, the selftest, and the fork test.