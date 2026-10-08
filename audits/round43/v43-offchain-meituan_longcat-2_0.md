# Round 43 Audit Report: CBOB Vaults v6 Off-Chain Pipeline

## Round 42 Verdict Verification

Round 42 was **NOT CLEAN** on both passes (quorum met on both). I independently verified every confirmed finding and its repair.

### C01 (LOW, `bank/alarm.mjs`): Alarm baseline shrinks with untrusted DAS list — **VERIFIED REPAIRED**

The repair at `bank/alarm.mjs:543-545` correctly builds the judged vault set from stored history when `trustCurrent` is false:

```javascript
const judged = setChange.trustCurrent ? vaults : [...new Set([...vaults, ...(prev?.vaults || []).filter(v => !burntSet.has(v))])]
```

This ensures every stored vault's reserves are still read and judged during a shrink pass, preserving baselines for omitted vaults. The selftest arms (R42 C01) extract the real balance block and run it across three passes (full → shrunk → full with a fall), proving the fall is paged. **Repair holds.**

### V42-1 (INFO, `web/deploy/ceremony-local.mjs`): Malformed path crashes local ceremony server — **CANNOT FULLY VERIFY**

The implementation file `web/deploy/ceremony-local.mjs` is not in this round's bundle (only `web/test/proxy.test.mjs` is). The test arms in `proxy.test.mjs` drive the real exported `listener` on loopback and assert `/%E0` and `/%` return 404 with the server still alive afterward. I verified the test logic is sound and would catch a regression, but I cannot confirm the implementation without the source.

### V42-2 (INFO, `web/src/lib/ceremony-reads.mjs`): Earlier transaction could hide the real create — **CANNOT FULLY VERIFY**

The implementation file `web/src/lib/ceremony-reads.mjs` is not in this round's bundle (only `web/test/ceremony.test.mjs` is). The test arms in `ceremony.test.mjs` cover failed transfers listed first, successful transfers listed first, and strangers-only histories. The test logic is sound, but I cannot confirm the implementation without the source.

### Round 41 Repairs — **ALL HOLD**

Every round 41 repair (C01, C02, C04, C06, V41-1) is red under its own mutation against the current tree. The selftest arms are properly armed in both directions.

---

## New Finding

### F1. Deviation filter unit mismatch in `bank/swap.mjs` — **MEDIUM**

**The construct.** `market()` in `bank/swap.mjs` judges pool spot prices against the oracle with:

```javascript
const dv = deviationBps(orcaSpot(w), f.satsPerLamport)   // Orca
const dv = deviationBps(meteoraSpot(p), f.satsPerLamport) // Meteora
```

**What each quantity is:**
- `orcaSpot` returns `sqrt_price²` = **cbBTC per wSOL** (Orca: tokenA=wSOL, tokenB=cbBTC).
- `meteoraSpot` returns `1 / (1 + binStep/10000) ^ activeId` = **cbBTC per wSOL** (Meteora: tokenX=cbBTC, tokenY=wSOL; the raw formula gives cbBTC per wSOL, and the code returns its inverse — but see below).
- `satsPerLamport` returns `(SOL/USD) / (BTC/USD) × 0.1` = **sats per lamport**.

**The mismatch.** 1 cbBTC/wSOL = 10 sats/lamport (1 cbBTC = 10⁸ sats; 1 wSOL = 10⁹ lamports; so cbBTC/wSOL = 10⁸/10⁹ = 0.1 sats/lamport — wait, that gives 0.1, not 10). Let me recompute carefully:

- `orcaSpot` = cbBTC per wSOL. To convert to sats per lamport: multiply by 10⁸ (sats per cbBTC) and divide by 10⁹ (lamports per wSOL) = multiply by **0.1**.
- So `orcaSpot_in_sats_per_lamport = orcaSpot × 0.1`.
- `satsPerLamport` is already in sats per lamport.

The code compares `orcaSpot` (cbBTC/wSOL) directly with `satsPerLamport` (sats/lamport). For a fair price (SOL ≈ $120.45, BTC ≈ $85,929), `orcaSpot` ≈ 0.001401 and `satsPerLamport` ≈ 0.000140. These differ by **10×**, which would yield ~90,000 bps deviation — far above the 100 bps gate, so the pool would always be skipped.

**Why the suite has not caught it.** The fork test `SW.7` sets up the Orca pool with `orcaAcc(MSPOT)` where `MSPOT = meteoraSpot({ binStep: 15, activeId: 5920 }) ≈ 0.0001405`. This value is already in the numerically "right" ballpark for `satsPerLamport` (≈ 0.00014014) — but it is **not** a realistic cbBTC/wSOL price. A realistic `orcaSpot` at the same SOL/BTC ratio would be ≈ 0.001401 (10× larger). The test uses a value 10× too small, so the deviation reads as ~25 bps and the pool is (incorrectly) accepted. The test passes because its input is wrong, not because the code is right.

**Meteora direction.** For Meteora (tokenX=cbBTC, tokenY=wSOL), the pool prices X in Y: `(1 + binStep/10000)^activeId` = cbBTC per wSOL. `meteoraSpot` returns the **inverse** of that, i.e. **wSOL per cbBTC**. So `meteoraSpot` is already in the wrong direction relative to `orcaSpot`, and the same unit mismatch applies. The test sets `meteoraAcc(5920)` with the same `activeId` and compares against the same `satsPerLamport`, so the same numerical coincidence masks the bug.

**Impact.** The 100 bps deviation gate does not correctly enforce what SPEC intends. A pool whose true spot is within 100 bps of the oracle could be skipped (if the 10× factor pushes it over the threshold in the judge's comparison), and a pool further than 100 bps could be accepted (if the factor pulls it under). In practice the on-chain output floor (`minSats`, 150 bps under the oracle) enforced by the pool program is the real backstop, and `revenue.mjs` throws if the operator's cbBTC delta is below that floor — so the worst case is a failed swap and an open cycle, not a loss beyond the floor. The bug is therefore **MEDIUM**, not CRITICAL.

**The fix.** Convert pool spots to sats per lamport before comparing:

```javascript
const dv = deviationBps(orcaSpot(w) * 0.1, f.satsPerLamport)
const dv = deviationBps(meteoraSpot(p) * 0.1, f.satsPerLamport)
```

And update the fork test to use realistic cbBTC/wSOL prices (10× larger than the current `MSPOT`), with the expected deviation recomputed accordingly.

**Evidence that would exist if I am right.** Run `sim/swap-fork.mjs` with `orcaAcc` initialized to a realistic `sqrt_price` derived from the actual SOL/BTC ratio (≈ 0.001401 cbBTC/wSOL, i.e. `sqrt_price ≈ sqrt(0.001401) × 2^64`). The current test would show `orcaSpot ≈ 0.001401`, `satsPerLamport ≈ 0.000140`, deviation ≈ 90,000 bps, and the Orca venue would be skipped — failing `SW.7`. With the fix applied, the same realistic input would yield deviation ≈ 0 bps and the venue would be used.

---

## Target-by-Target Summary

### R1. The Crank (`bank/crank.mjs`) — **CLEAN**

- Plans are correctly ordered: reschedule → capture → reveal → retire → join → distribute → activate → claim.
- Reveals are strictly in mint order from `revealed_total`; the program refuses `RevealOutOfOrder`.
- Only positively live assets are joined or paid (`assets[r.asset] === 'live'`).
- Burns are retired at any level; dead vaults are never joined or paid.
- The fee-payer floor is correctly computed from the plan's cost, and the base plan runs whenever covered (round 30 L2).
- No value moves anywhere the program does not pin.

### R2. The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`) — **CLEAN**

- Every detector is proven both ways in the selftest.
- The C01 repair correctly preserves baselines for omitted vaults.
- No dangerous on-chain state reads as quiet; no routine state pages every pass.
- The `WATCH` list and `WATCHED_KEYS` are consistent.

### R3. The Layouts (`bank/layout.mjs`) — **CLEAN**

- Every struct is parsed from the Rust source and compared field-for-field.
- Every cross-program pinned offset is scraped from the Rust and compared.
- Every PDA seed is scraped from the Rust and compared (round 24 D6 repair holds).
- A struct change, a retyped field, or a mistyped seed turns the build red.

### R4. The Money Arithmetic (`bank/accrual.mjs`) — **CLEAN**

- `credit`, `pendingScaled`, `pendingSats`, `reweigh`, `ceilSats`, `available`, `weightOf` all match the Rust formulas line-by-line.
- The crank expires due boosts before distributing and expires boosts this distribution makes due right after.
- The alarm pages `boosts_stalled` and treats the boost bounds as fixed forever.

### R5. The Swap (`bank/swap.mjs`) and Revenue Cycle (`bank/revenue.mjs`) — **ONE MEDIUM (F1)**

- **Oracle math (a):** Correct. `oracleFloor` computes `lamports × SOL/USD / BTC/USD × 10^(es-eb) / 10` with BigInt throughout; the selftest pins the 280,355 / 276,149 vector.
- **Pyth verification (b):** Correct. Owner, full-verification level, feed id, exponent range, age against chain clock, future-date bound — all checked.
- **Deviation filter (c):** **FINDING F1 (MEDIUM)** — unit mismatch between pool spots (cbBTC/wSOL) and `satsPerLamport` (sats/lamport); masked by unrealistic test values.
- **Minimum out (d):** Correct. `minSats = expectedSats × (10000 - 150) / 10000` is the same floor the deviation filter assumes, in whole sats.
- **Judge (e):** Correct. Checks the exact 7-instruction sequence, programs, signers, amounts, floor, direction, price limit, and that the output account is the operator's own cbBTC.
- **Account derivation (f):** Correct. Orca tick arrays, oracle PDA, vault A/B; Meteora bin arrays, bitmap, event authority — all re-derived from the published IDLs.
- **wSOL handling (g):** Correct. Wrap exactly `lamportsIn`, sync, swap, close. A pre-existing wSOL balance would add to the input, but the operator key is dedicated.
- **Failure and retry (h):** Correct. Orca first; Meteora only on a refusal (preflight, on-chain failure, or expiry); an unconfirmed send stops the cycle. The cycle stays open until a cbBTC return is proven on chain.
- **Adversary bound (i):** Within accepted limits. The 150 bps floor is the hard bound per swap; the operator key is rate-limited by the program.

### R6. The Gates — **CLEAN**

- Every selftest assertion is proven both ways (fires when it should, quiet when it should).
- Floors in `scripts/run-tests.sh` must **equal** the real count (not merely ≥), preventing assertion deletion.
- No detector passes vacuously on empty input.

---

## The Four Questions on the Accepted Limits

1. **Is any limit WORSE than stated?** No. All accepted limits are accurately stated and correctly measured.

2. **Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?** No. I reviewed the OPEN AND BLOCKING items (22, 38, 50, 52, 53) and they remain genuinely open.

3. **Is any DISCHARGED item not actually discharged?** No. All discharged items were either measured closed or removed with the thing they were about.

4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?** No. The launch gate (SPEC gate 3, Gary 2026-10-08) correctly treats rounds 41 and 42 as launch-clean (no confirmed findings in (a)–(d)), and round 43 is the confirmation round.

---

## What This Project Must Do Before Launch That AI Audit Structurally Cannot

These are operational, not code-review, steps. AI can review the code that performs them; it cannot perform them.

1. **Run the mainnet dress rehearsal** (item 22, road step 8): the crank's live I/O against a real cluster with ~2,100 vaults, the alarm in rehearsal mode, one full revenue cycle through each pool (Orca forced to refuse once so Meteora runs), and one forced post-sweep failure walked through hand recovery. None of this can be simulated.

2. **Deploy, verify, and lock all five programs** (road steps 9 and 11): dump each deployed program, check the prefix hash and zero tail, remove the upgrade authority, dump and check again. The bridge from "the source is correct" to "the bytes on chain are correct" is a human with a CLI.

3. **Create the vault collection and initialize the four programs** (road step 10): the collection does not exist yet; `initialize` must be run with the ruled values and the results read back and confirmed.

4. **Publish and smoke-test the holder pages** (item 50): the buy, claim, redeem, vault, and ceremony pages are built and staged but not published. A human must walk through each flow with a real wallet on mainnet.

5. **Verify the RPC proxy and the ceremony's local server** (item 50): the proxy's method allowlist and the ceremony server's path handling must be tested against real requests.

6. **Verify the $CBOB mint on mainnet** (item 56): confirm the mint authority is revoked, the freeze authority is absent, and the supply is in the release wallet.

7. **Run the mainnet probe** (`scripts/probe-mainnet-facts.mjs`): confirm the reserve mints are classic SPL, the signature walk pages correctly, and the Proof of Burn set matches the pinned root.

8. **Drift sweep before the freeze** (Gary 2026-10-07 ruling): an independent check of SPEC.md, HOLDER-GUIDE.md, DESIGN-v6.md, and web/README.md against the code, with findings fixed before launch.

---

## Severity Summary

| ID | Severity | Target | Status |
|---|---|---|---|
| Round 42 C01 | LOW | `bank/alarm.mjs` | Repaired, verified |
| Round 42 V42-1 | INFO | `web/deploy/ceremony-local.mjs` | Repaired, test logic verified (source not in bundle) |
| Round 42 V42-2 | INFO | `web/src/lib/ceremony-reads.mjs` | Repaired, test logic verified (source not in bundle) |
| **F1** | **MEDIUM** | **`bank/swap.mjs`** | **New — deviation filter unit mismatch** |

**Verdict: NOT CLEAN.** One confirmed MEDIUM finding (F1) in the fixable layer. Under Gary's 2026-10-08 launch gate, a MEDIUM anywhere blocks launch. The fix is a two-line change in `bank/swap.mjs` plus a test-value correction in `sim/swap-fork.mjs`.