# Independent Security Audit — Off-Chain Pipeline (v6, round 43)

## Methodology note

I read every bundled file whole, recomputed the critical arithmetic independently (Pyth layout and exponent handling, Orca tick-array starts, Meteora bin-array indexes and spot formulas, the payout accumulator, the sweep-window symmetry, the redemption ring), traced the crank's plan→send order against MINT's refusal sequence, and followed every money-moving path in `bank/revenue.mjs` from sweep through split. Where a claim rested on a measured suite arm, I read the arm to confirm it exercises the code under test rather than a copy. I state for each finding the evidence that would exist on chain or in a test run if the claim were true.

**Summary: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 2 LOW, 3 INFO.** The code is unusually well-defended. The LOWs are a misleading operator message and an unbounded intermediate in a tolerance filter. The INFOs are robustness notes. None touches holder money, a holder's crack, or a program. Under the 2026-10-08 launch gate, this round would be **LAUNCH-CLEAN**.

---

## R0. Round 42's verdict and repairs

**C01 (alarm reserve baseline after a shrink pass) — repair HOLDS.** I verified the fix at `alarm.mjs` (the `judged` expansion):

```
const judged = setChange.trustCurrent ? vaults : [...new Set([...vaults, ...(prev?.vaults || []).filter(v => !burntSet.has(v))])]
```

When `trustCurrent` is false, every stored vault (minus positively burnt ones) is read and judged. The two R42 C01 arms in `selftest.mjs` extract the entire balance block and run it as written across three passes (full → shrink → full-with-fall) and a fall-in-omitted-vault-during-the-shrink control. Both fail with the old `for (const v of vaults)` restored, per VALIDATION.

**Gate-5 obligations from round 42:** C08 (fee labels derived from `crank.mjs`'s template, read at `selftest.mjs` 2166), C09 (`OPERATOR_FLOOR` read from source, pinned at 20,000,000n), C06 (Pyth `expo` bounded at −18..0 in `readPyth` and `oracleFloor`, both-ways arms), C10 (`run-tests.sh` refuses when `git diff $REL -- programs Cargo.toml Cargo.lock` is non-empty), C26 (`WEB_FLOOR=682` in `run-tests.sh`, `E2E_FLOOR=132` in `e2e-localnet.sh`) — each present and each has a both-ways arm.

**No regression found** at any site of C01's shape: the undelivered-page rollback (`next.balances = prev?.balances ?? balances`) correctly preserves the old baseline; `next.vaults` uses the same trusted/untrusted ternary.

**Round 41's five repairs (C01, C02, C04, C06, V41-1) each still have a red-under-mutation arm**, and the R42 A1–A3 dust arms (`isSystemDust`, `readTokenAccount`'s dust line) are present in both `bank/anchor.mjs` and `bank/spl.mjs`.

---

## R1. The crank (`bank/crank.mjs`)

**Send order** is retire → join → expire-before → split → distribute → expire-after → activate → claim (pinned by the R39 C01 extraction arm). This matches MINT's refusal sequence (`BoostsExpireFirst` before `JoinWaitingFirst` before `MonthNotElapsed` before crediting).

**Plan-against-future-state arithmetic** is correct in all three dimensions I checked:

- `retiringWeight` includes the retiring vault's full weight (level + boost). `expiringWeight` includes only the boost weight of non-retiring expiring vaults. `retiring.has(r.address)` excludes retiring vaults from `preExpires`, preventing double-counting.
- `retiringOwed` uses `pendingScaled` with the boost and carry, matching MINT's `retire` (which subtracts `owed_of` from `owed_scaled`).
- The joined-now owed (`debt = level_weight × pre_acc`, evaluated at post-acc) gives exactly `level_weight × delta` — the vault's share of this distribution and nothing earlier. The pre-expired owed (`atExpiry + level_weight × delta`) is algebraically identical to what MINT's `expire_boost → reweigh(0)` + `claim` pays after the post-distribution accumulator advances.

**Budget logic** (`budgetPlan`): reveals never spend the key below `FEE_FLOOR_LAMPORTS`; the base plan runs whenever the key covers it (floor 0). Verified: `room = lamports − base_cost − floor`, `n = floor(room / per_reveal)`, so after `n` reveals the remaining is ≥ floor by construction (BigInt division truncates downward).

**Race handling**: `BENIGN` covers all nine codes that mean "already done" or "not yet". `judgeDistributeRefusal` correctly distinguishes a stranger's distribution (epoch moved) from a wrong plan (epoch unmoved), and `PoolShort` is never benign. `mintFailureCode` attributes Anchor errors to MINT by invoke-stack depth, refusing a nested CPI's same-named code (R27 L3 arms).

**No defect found** in the crank.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

I checked every detector named in the brief's R2 list for a dangerous state that reads as quiet and a routine state that pages every pass.

**Fixed-forever values** are all in `WATCH` at CRITICAL (split, destinations, supply, census, PoB root, charter window, monthly period, notice, three tighten bounds, `$CBOB` mint, boost ceilings, governance numbers). `detectConfigDrift` fires on any change; `detectStandingRisks` fires on any wrong production value.

**Pending guardian / swap operator**: `guardian_armed` and `swap_operator_armed` are level CRITICAL.

**PoB collection plugins / update authority**: `pob_collection.plugins_hash` and `pob_collection.update_authority` are CRITICAL drift.

**Redemption window near full**: `redemptions_near_cap` fires at ≤ 20% remaining, never on an idle window (A3 arm).

**Frozen / insolvent pool**: `pool_frozen` (urgent) and `pool_insolvent` (CRITICAL).

**Distribution overdue**: `distribution_overdue` (CRITICAL), `joins_stalled`, `boosts_stalled`, `launch_tick_overdue`.

**Upgrade authority past lock date for all five programs**: `detectUpgradeAuthorityAfterLock` iterates `['seal','mint','burn','gov','sweep']`. `prog.sweep.hash` is watched at CRITICAL.

**Sweep judged from account state** (`detectSweepState`): symmetric window `|t − start| ≤ cooldown/2`, smallest-ever cooldown (never above 21600), uncertain sends confirmed only by a direct `getSignatureStatuses` lookup. I verified the window math: with `cooldownSeen = 21600`, the half-window is 10800 s, which tolerates ordinary box/chain clock skew (seconds) while a thief's sweep cannot sit inside an honest cycle's window (it must wait a full cooldown after the honest one).

**No dangerous on-chain state reads as quiet.** The one candidate I constructed — a balance oscillating around the 1-SOL `royalties_unswept` floor, resetting the clock each dip — cannot occur while the revenue job is dead (the revenue PDA's balance can only fall via `sweep_sol_for_swap`). If the job is alive and sweeping, the detector staying quiet is correct.

**No routine state pages every pass.** The only standing CRITICALs are genuine (a stuck log gap, a shrunk index, a config drift).

**No defect found** in the alarm.

---

## R3. The layouts (`bank/layout.mjs`)

The selftest parses each Rust `pub struct` and requires field-for-field equality (names AND types, with a refusal to parse private/multi-line fields). Every cross-program `OFF_*` constant in GOV, BURN and MINT is scraped and compared against `L.offsets()`; the L2 arm requires that every scraped constant is in the comparison list (none ignored). The SEEDS comment's claim is now real: D6 scrapes all eleven `*_SEED` constants from their programs and compares (round 24). Layout versions and `BOOST_RING` are scraped and compared (L6). The suite's own `OFF_*` copies in `tests/3prog.test.ts` are compared (round 23 L6).

**A struct change cannot slip past**: adding a field, changing a type, or bumping a version each turns the build red (both-ways arms: `grown`, `retyped`, `judgeVersions` mutation).

**No defect found** in the layouts.

---

## R4. The money arithmetic (`bank/accrual.mjs` vs `programs/cbob-vault-mint/src/lib.rs`)

I compared `credit`, `claim` (owed_of), `retire`, `ceil_sats`, `join`, and `owed_of` with `boost_weight` and `carry_scaled` line-by-line against the Rust.

| JS (`accrual.mjs`) | Rust (MINT) | Match |
|---|---|---|
| `credit`: `delta = avail × 1e12 / w`; `acc += delta`; `owed += delta × w` | `credit`: identical, with `checked_*` | ✓ |
| `pendingScaled`: `(w+boost)×acc + carry − debt` | `owed_of`: identical | ✓ |
| `reweigh`: `carry = owed`; `debt = (w+boost)×acc` | `reweigh`: identical | ✓ |
| `ceilSats`: `(scaled + 1e12 − 1) / 1e12` | `ceil_sats`: identical | ✓ |
| `available`: `balance − ceilSats(owed)`, floored at 0 | `distribute`: `balance − owed` with `PoolShort` refusal | ✓ (alarm reports the shortfall; program refuses) |

**Boost expiry before and after distribution**: the crank expires `preExpires` before `distribute` and `postExpires` after (only when `plan.distribute`). I verified that a post-expiring vault's owed (computed pre-expiry at post-acc) is algebraically identical to what MINT pays after `expire_boost` runs inside `claim` (the `touched` path).

**Alarm**: `boosts_stalled` fires (HIGH) when due boosts remain after a grace period. `mint.cbob_mint`, `mint.max_boost_weight`, and `mint.max_boost_epochs` are in `WATCH` at CRITICAL.

**No divergence found.**

---

## R5. The swap (`bank/swap.mjs`, `bank/revenue.mjs`)

### (a) Oracle math

**Exponent handling** is correct for every sign. I verified by substitution: with `expo_s = −6, expo_b = −8` (e = +2), the code gives `lamports × sol.price × 100 / (btc.price × 10)`, which equals the direct formula `lamports/1e9 × SOL_USD / BTC_USD × 1e8`. With e = −2, the code divides `den` by 100, also correct.

**Rounding**: `expectedSats = num / den` (BigInt, truncates down). `minSats = expectedSats × 9850 / 10000` (truncates down). So `minSats ≤ 0.985 × true_expected`. The floor is at most 1.5% below the oracle's true expectation. Pinned vector: 280,355 / 276,149 (hand-computed and matched).

**`satsPerLamport` BigInt→Number overflow**: `sol.price` and `btc.price` are `readBigInt64LE` (max 2⁶³−1 ≈ 9.2e18). `Number(2⁶³−1)` loses ~0.1% precision (2⁵³ vs 2⁶³), but cannot overflow to `Infinity` (max double ≈ 1.8e308). The precision loss is 10× smaller than the 100-bps deviation filter and does not affect `minSats` (which is pure BigInt). **Not a defect**, but the intermediate should ideally be BigInt throughout.

**`PYTH_EXPO_MIN/MAX` bounds** (−18..0) prevent extreme exponents from producing astronomic intermediates. Both `readPyth` and `oracleFloor` enforce them.

### (b) Pyth account verification

**Offsets recomputed**: disc(8) + write_authority(32) = 40. `level` at 40 (1 byte). For `Full` (tag 1), `PriceFeedMessage` starts at 41: feed_id(32) at 41, price(i64) at 73, conf(u64) at 81, expo(i32) at 89, publish_time(i64) at 93. Minimum length 101. The code's length check `< 8+32+1+32+8+8+4+8 = 101` is correct.

**Ownership + derived address**: the account is `pythAccount(feedHex)` (PDA of `[shard(2 zero bytes), feed_id]` under the push oracle), owned by the receiver, fully verified (tag 1), carrying the expected feed_id. An attacker cannot write a chosen price or an old `publish_time` into that account without the push oracle's signing key (trust (d), accepted limit 10).

**Clock**: judged against the chain's Clock sysvar (`clockUnixTimestamp`, byte 32). An unreadable Clock refuses the cycle. A `publishTime` more than 30 s ahead is refused. Both arms present (SW.7a, SW.7b).

### (c) Deviation filter

`orcaSpot = (sqrtPrice / 2⁶⁴)²` in raw units (sats per lamport for the wSOL/cbBTC pair). `meteoraSpot = 1 / (1 + binStep/10000)^activeId` (inverse of lamports-per-sat). Both give sats per lamport, matching `satsPerLamport`. The 100-bps symmetric filter is correct.

**Floating point cannot pass a pool it should refuse**: `deviationBps(101, 100) = 100`, `deviationBps(102, 100) = 200`. The boundary is inclusive (`<= MAX_POOL_DEVIATION_BPS`). Both-side arms present (L6, through `market()`).

### (d) Minimum out

The floor (`minSats`) is the same value used in the deviation filter's oracle expectation. For Orca it rides in `other_amount_threshold` (offset 16 of the swap data); for Meteora in `min_amount_out` (offset 16). Both are in the units each program expects (cbBTC sats). The judge pins both to `minSats` exactly.

### (e) The judge (`judgeSwapInstructions`)

I checked every dimension the brief asks about:

| Check | Present | Verified |
|---|---|---|
| Output account = operator's own cbBTC ATA | ✓ (key 5 both venues) | Round-25 L1 tamper arm |
| Min-out bytes = `minSats` | ✓ (offset 16) | SW.6c arm (zeroed floor) |
| Direction byte (Orca a_to_b=1, exact input=1) | ✓ (bytes 40, 41) | Tamper arm |
| Amount = `lamportsIn` | ✓ (offset 8) | Tamper arm |
| ComputeBudget: no priority fee, limit = 400,000 | ✓ (instruction 0 must be exactly `SetComputeUnitLimit(400k)`; `d[0]===3` refused anywhere) | Tamper arm |
| ATA creations for operator's own wallet+mint | ✓ (instructions 1 and 4, full key check) | Tamper arm |
| Exactly 7 instructions, 1 swap, 1 System transfer, 1 close | ✓ | Multiple arms |

**What the judge does not check** (tick arrays, oracle PDA, Meteora event authority): these are derived from pinned pool state. A wrong derivation makes the swap fail on chain (wasted fee), never misroute value. The pool itself is pinned in the judge. **The judge is complete for value-moving parameters.**

### (f) Account derivation

**Orca**: tick arrays at `[s0, s0−span, s0−2×span]` where `span = 88 × tickSpacing`. For a_to_b (selling A, price down), this is current-then-descending. Verified: `orcaTickArrayStarts(−88733, 16) = [−90112, −91520, −92928]` (hand-computed). Boundary case (tick exactly on an array start) is correct (floor gives the same array). Seed: `['tick_array', pool, String(start)]`. Oracle PDA: `['oracle', pool]`. Vault A/B read from the pool account.

**Meteora**: bin arrays at `[i, i+1, i+2]` where `i = floor(activeId / 70)`. For Y→X (buying X, price up), this is current-then-ascending. `MAX_BIN_PER_ARRAY = 70` matches Meteora's constant. Negative IDs floor correctly (`binArrayIndex(−1) = −1`). Seeds: `['bin_array', pool, i64(index)]`, `['bitmap', pool]`, `['oracle', pool]`, `['__event_authority']`. `host_fee_in` is `METEORA.program` (Anchor `None`). Event authority and self-program present. Two token programs (both classic SPL).

**At a tick-array boundary**: the current tick is at the start of array `s0`; a_to_b moves down into `s0−span`. All three arrays are provided. **At an uninitialised array**: Orca refuses the swap (pool program error), which is a `refused` outcome → Meteora fallback or loud stop.

### (g) wSOL handling

Wrap exactly `lamportsIn` → `syncNative` → swap → `closeAccount` to owner. If the ATA pre-exists with a balance, the extra lamports are returned on close. If frozen, `syncNative` fails and the whole transaction reverts. A delegate cannot interfere (all instructions are in one atomic transaction; the owner signs close). If the swap consumes less than the input (Orca's price limit hit), the remainder is closed back as SOL — recorded as a discrepancy between `sweptLamports` and actual swapped amount, but the `delta ≥ guaranteed` check ensures the cbBTC output meets the floor.

### (h) Failure and retry

Orca first; Meteora only on `outcome === 'refused'` (preflight failure, landed-and-failed, or expired-and-absent). An `unknown` outcome stops the loop and throws — no second venue, no double swap. `classifySendFailure` queries the chain (`getSignatureStatuses` with `searchTransactionHistory`). A confirmation timeout on a swap that later lands is caught by the status lookup (`landed` outcome, recorded and broken out of). **No double count**: `rememberAttempt` stores `pendingSwapSig` (evidence, not confirmation); `cycleIsOpen` stays true until `returnedSats > 0` AND a split. The open-cycle guard prevents a second cycle.

### (i) Adversary extraction

- **Pool at edge of gate (100 bps)**: extraction = 1% of swap amount per cycle. At the ruled cadence (10 SOL / 6 h ≈ 40 SOL/day ≈ $4,000/day at $100/SOL), that is ~$40/day. Manipulation cost for a $10M Orca pool: ~$100K of capital per push. Net extraction is negligible.
- **Stale-but-accepted oracle (≤ 180 s)**: the pool agrees with the stale oracle (deviation filter), but the true market may differ by the 3-minute drift. SOL/BTC moves 1% in 3 minutes rarely. Extraction ≈ 1% of swap, same bound. The 30-bps confidence bound and 150-bps floor give a total tolerance of 150 bps below the oracle's expectation.
- **Manipulated Meteora pool (~10× thinner)**: pushing 1% costs ~$9K. Extraction per cycle $10. Only reachable if Orca is made to refuse first (which costs ~$100K). Not material.
- **Sandwich**: Solana has no public mempool; a validator in the leader slot can see the transaction. Extraction bounded by 150 bps of the swap amount. At 10 SOL/cycle, ~$15/cycle. Not material.

**Operator key worst case** (limit 10, re-bounded): the key trusts two pool programs and Pyth (not an HTTP reply). It can keep ≤ 10 SOL per 6-h cooldown until the guardian stops the sweep (instant, one-way). With the guardian key also compromised: indefinite, bounded only by royalty income (~34 SOL/day max throughput). The post-swap `delta < guaranteed` check catches a builder defect AFTER signing; the cycle stays open and loud.

**Ledger cannot read a failed cycle as closed**: `cycleIsOpen` requires `returnedSats > 0` AND (`splitSig` or `splitByOther`). A failed swap leaves `returnedSats = 0` (open). A failed return leaves `returnedSats = 0` (open). A failed split leaves no `splitSig` (open). `detectSplitClaims` verifies any `splitByOther` against a real on-chain split (chain-time anchored, amount covering the return, not claimed by another cycle).

---

## R6. The gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

**Floors must EQUAL counts**: `MIN_ASSERTIONS=909`, `DET_FLOOR=945`, `ALLOC_FLOOR=39`, `POSTER_FLOOR=24`, `POB_FLOOR=14`, `LAUNCH_FLOOR=49`, `HOST_FLOOR=6`, `MAINNET_FLOOR=33`, `WEB_FLOOR=682`, `EXPIRY_FLOOR=4`, `SWAP_FLOOR=16`, `SIM_FLOOR=71`, `E2E_FLOOR=132`. Each uses `-eq`, not `-ge` (round 19 fix). Deleting work turns the build red.

**`build-mainnet.sh` proves what it says for all five programs**: the sweep helper's mainnet bytes are compared against `target/deploy/cbob_vault_sweep.so` (the build the suite deployed) AND the localnet rebuild. The four keyed programs are behaviorally tested (mainnet rejects the test key, localnet accepts). The source is checked for `INIT_AUTHORITY = Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb` in all four.

**`cron-install.sh` arms nothing it should not**: the `ours()` function matches only tagged, uncommented lines at end-of-line anchor. Commented-out, prose, other-project, and reveal-lane lines do not arm `--live` (round-19 and round-24 L12 arms). The preserve logic is extracted and run as real shell in the selftest.

**Round-24 "repair is armed in both directions" claim**: I checked the specific arms the round-24 section names (H1 router labels, L4a posture, L5 carry baseline, L7 judgeReserveRead, L8 three-reserve correlation, L9 index race, L10a-d ledger anchors, L11 closesCycle, I3 forfeit, I5 freeze transitions, D5 rehearsal seam). Each has a positive and a negative arm. The R34 L1 performance arm now measures CPU time (15 s bound) — a return to the old 34 s algorithm still fails it.

**One arm I judge weak**: `t('H1: ...and a level notice never inherits ALERT_URGENT from the environment', /delete env\.ALERT_URGENT/.test(almSrc), true)` — presence-only. If the `delete` line is moved after the `execFileSync` call, the arm still passes. But the round-42 verdict already dispositioned this class (C27, "presence-bound arms that fail on the natural breakage are round 40 C03 / round 41 C11's class"). Not re-filed.

---

## The four questions about the accepted limits

### 1. Is any limit WORSE than stated?

**No.** I specifically re-measured the three most attackable:

- **Limit 10 (swap operator)**: the bound is cap × cooldown windows, correctly stated. The post-round-25 judge catches all eight measured tampers. The remaining residue (box-owner trust, third-party upgrade keys, one RPC endpoint) is stated in full.
- **Limit 32 (redemption rate limit)**: the ring bounds the cap at 64 (stricter above 3,047 live). The "2× burst" from stage 3b is gone (RL.2–RL.7 arms).
- **Limit 46 (PoB hot key)**: the full consequence (end the project, capture governance) is stated since round 24 and in the holder guide. The positive bound (cannot transfer or burn an individual PoB) is stated. The sampling blind spot (add-remove between passes) is stated.

### 2. Is anything listed as a limit not actually a limit?

**No.** Every ACCEPTED item has a real, unrepaired cost.

### 3. Is any DISCHARGED item not actually discharged?

**No.** Items 14, 19, 30, 31, 33, 51, 54 and the v5 family (1a–5, 11, 15, 16, 18, 20, 21, 23, 24) each name what closed them and carry a suite arm.

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

**No.** Items 22, 38, 50, 52 and 53 remain OPEN. `launch/mainnet-init.json` still has three values `"status": "OPEN"` (charter date, lock deadline, vault collection). The launch selftest (49/49) includes the refusal. Item 22's dress-rehearsal named items (including the full revenue cycle through both pools and the forced post-sweep failure) are listed but not run.

---

## `web/test/` — can each test fail when its property is broken?

I checked each file for vacuous arms (an assertion that passes regardless of the property):

| File | Vacuous arms found? | Notes |
|---|---|---|
| `bundle.test.mjs` | No | C03 compares bundled vs node `planRedemption` byte-for-byte with `n.v.length > 200` (non-empty guard). |
| `ceremony.test.mjs` | No | The "TODAY refuses" arm is guarded by the positive "filled values pass" arm. Decoy tests check `ignored.length` and addresses. |
| `plan.test.mjs` | No | Each H1 vector checks `opens(p)` AND `p.ack.some(a => a.text.includes(addr))`. The em-dash check (`all.ack.every(...)`) would be vacuous on an empty list, but the preceding "every vector named" arm ensures non-emptiness. |
| `get.test.mjs` | No | Positive arm ("claim: ready, picks the one PoB") guards against a plan that always refuses. |
| `proxy.test.mjs` | No | The allowlist comparison (`[...ALLOWED].sort()` vs `[...called].sort()`) fails on any mismatch. |
| `meta.test.mjs` | No | Fail-closed arms check byte-for-byte file preservation. |
| `decode.test.mjs` | No | Compared against official mpl-core and spl-token deserializers. |
| `ix.test.mjs` | No | `diffIx` has a CONTROL arm (cleared flag, changed byte, different account each caught). |
| `ids.test.mjs` | No | Compared against the suite's own derivations and spl-token. |
| `tx.test.mjs` | No | `signExact` arms cover add-instruction and forged-signature. |

**No vacuous test found.** The round-37 "ack arms that could not" pattern is not present in this tree's web tests.

---

## Findings

### LOW-1: `satsPerLamport` intermediate loses precision for large Pyth prices

**Construct**: `bank/swap.mjs`, `oracleFloor`, the `satsPerLamport` field:
```
satsPerLamport: Number(sol.price) * 10 ** sol.expo / (Number(btc.price) * 10 ** btc.expo) / 10
```
`Number(BigInt)` is exact only up to 2⁵³ ≈ 9e15. `readBigInt64LE` can return up to 2⁶³−1 ≈ 9.2e18, losing ~0.1% precision.

**What an attacker or accident gains**: nothing of value. The field feeds only the 100-bps deviation filter (`deviationBps(orcaSpot, satsPerLamport)`). A 0.1% precision loss is 10× smaller than the filter band and can at worst include or exclude a pool within 0.1% of the boundary. The floor (`minSats`) is pure BigInt and unaffected.

**Evidence if true**: `Number(9223372036854775807n) !== 9223372036854775807` (lossy in any Node REPL). With current live prices (1.2e10 and 8.6e12), both are under 2⁵³ and exact.

**Fix**: compute `satsPerLamport` as a `Number` from BigInt-division of scaled integers (e.g., `Number(num) / Number(den)` where `num` and `den` are the already-scaled BigInts from `expectedSats`), or accept the precision loss with a comment. This is a robustness note, not a security defect.

### LOW-2: The below-floor warning says "kept the floor" when the base plan may have spent below it

**Construct**: `bank/crank.mjs`, `budgetPlan`, the `low` message:
```
"this pass ran only what it covers and kept the floor for later passes. Top it up."
```
The base plan runs whenever the key covers it (floor 0). After the base plan, the key may hold less than `FEE_FLOOR_LAMPORTS`. The floor is kept only against reveals, not against the base plan.

**What an operator gains**: a misleading impression that the floor is preserved. The instruction ("Top it up") is correct. The page (`fee_floor`, once a day) is correct.

**Evidence if true**: `budgetPlan(plan, FEE_FLOOR_LAMPORTS − 1n)` returns `ok: true` with captures running; `planCostLamports(plan.plan)` can exceed `lamports − FEE_FLOOR_LAMPORTS`.

**Fix**: reword to "ran the base plan and no reveals; the key is below the floor after it." Note: round 42's C21 already dispositioned this as "mechanism accurate, not a defect"; I re-raise it only because the SPEC text (corrected in round 41 C03) now says "as many reveals as keep the key at or above 0.005 SOL" while the operator message still implies the floor is universally kept.

### INFO-1: `revenue.mjs` hardcodes `decimals = 8` in the split instruction

`bank/revenue.mjs` sends `Buffer.from([8])` for `split_revenue`'s decimals, while `bank/crank.mjs` reads the actual value from the mint account (`splitDecimalsByte(...data[44])`). cbBTC has 8 decimals (verified by `probe-mainnet-facts.mjs`), so this is correct today. If the payment mint were ever different (it cannot be — fixed at `initialize`), the split would fail at the Token program's decimals check. Low risk; align with the crank's read for consistency.

### INFO-2: `readySlot` can cause premature captures when slots are skipped

`bank/crank.mjs`, `readySlot(revealSlot)` computes the earliest slot where hash C could exist (assuming no skips). With skips, hash C is later. The crank sends the capture and gets `RevealTooEarly` (BENIGN, wasted fee ~5,000 lamports). The next pass (1 minute, ~150 slots later) retries. The capture window is 300 slots, so there are ~2 chances. If both fail, the vault is rescheduled (loud, paged). Cost: occasional wasted fees. Not a correctness issue.

### INFO-3: The R27 L3 arm for `mintFailureCode` retrieves logs via `error.getLogs` with a 5-second timeout

If the RPC is slow (> 5 s), `mintFailureCode` returns `null`, and a race code (`AlreadyCaptured`, etc.) is not recognized. The send is treated as a failure, pushed to `failures`, and paged via `crank_failing` after 3 consecutive passes. The next pass retries and the work is already done (BENIGN). Cost: a false `crank_failing` page. The timeout is a deliberate trade-off (a hung `getLogs` would stall the whole pass).

---

## Given that no human firm will ever see this and the programs will be immutable, what should this project do before launch that AI audit structurally cannot?

1. **Run the mainnet dress rehearsal (item 22) at the release commit, not at `d57ee3a`.** Every named item must complete with recorded transaction signatures: (a) the crank's live passes at ~2,100 vaults, (b) the alarm's live passes in `CBOB_ALARM_REHEARSAL=1`, (c) one full live revenue cycle through EACH pool (Orca forced to refuse once so Meteora runs), (d) one forced post-sweep failure walked through the hand recovery, (e) one DAS read of a collection holding a burned Core asset. No AI round can do this. The revenue cycle has NEVER run end-to-end against a live chain.

2. **Build on a second machine from the release commit and compare `dist/SHA256SUMS`.** `build-mainnet.sh` explicitly says the compiled `INIT_AUTHORITY` constant is not proven — only reproducibility bridges the gap. An AI cannot rebuild from source on an independent toolchain.

3. **Have a human read each of the four/five `initialize` transactions line-by-line against `launch/mainnet-init.json` before signing.** The checker validates the JSON, not the signed bytes (round 24 A6). A human must confirm the Borsh encoding of every field, especially `level_caps`, `pob_root`, and the two dates. Every `initialize` value is permanent.

4. **Run an alert drill**: deliberately trigger one finding of each class (a `config_drift`, a `brake_pulled`, a `log_coverage_gap`, a `crank_silent`) and confirm the email reaches Gary and the stream opens/closes correctly in the router. The router arms in the selftest exercise `stream_key` and `classify` but never deliver a real alert.

5. **Verify key custody physically**: `bank/keys/swap-operator.json`, `bank/keys/cbob-release.json`, `bank/keys/deploy-authority.json` (mode 600, on the box, in the nightly encrypted offsite backup). Confirm the backup restores correctly (a restore drill). An AI cannot verify physical access control.

6. **Do one real-wallet redemption through the published redeem page** with a funded vault holding all three reserves and one stray token. This exercises the human path (the tick-boxes, the standing consent, the prior transaction, the press) that no offline test can certify end-to-end. The mock RPC and e2e-localnet tests are close, but the wallet's signing UX is untested.

7. **Settle item 22.5** (one DAS read of a burned Core asset) before the freeze, knowing that a "no" answer requires a `bank/` edit.

8. **Run the suite and `web/test/run-all.mjs` on the deploy machine at the release commit** and archive the logs. The canonical run logs (`.cache/r42-suite.log`) predate the commit time of `f350e1d`; they are relied on as the run of that tree. A fresh run at the final commit removes that reliance.