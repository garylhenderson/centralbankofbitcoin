I'll focus on finding surviving faults, verifying the prior verdict's claims, and attacking the accepted limits. Let me work through the targets systematically.

=====================================================================
R0 — ROUND 26 VERDICT: VERIFICATION OF ITS CLAIMS
=====================================================================

The round-26 verdict is largely sound; I confirm most of its reasoning from first principles and extend one of its findings. I have one correction to make about a repaired item.

## FINDING 1 (HIGH): `detectSplitClaims` `split_by_other_unanchored` was repaired, but the fix changed the anchoring semantics for `splitByOther` cycles in a way the round-26 L2 repair introduced a NEW inconsistency.

**Construct:** `bank/detectors.mjs`, `detectSplitClaims`, the `byOther` branch, repaired per round 26. The claim: `closesCycle(c, pool, { exclude: used })` now anchors `splitByOther` cycles with the same chain-time rule as explicit `splitSig` cycles.

**Evidence that would exist if I'm right:** Run the selftest's R26 arm `'R26 legacy rows retain their documented clock-skew allowance'`. It passes a `splitByOther` cycle with `returnBlockTime: null` and an `early` split (50s before the return) and asserts `[]` (quiet). But look at `closesCycle`:

```js
.filter(e => (anchored ? splitTime(e) >= anchor : splitTime(e) * 1000 >= afterMs - 60_000) ...)
```

For a legacy row (`returnBlockTime: null`), `anchored` is false, so it falls back to `afterMs - 60_000` where `afterMs = Date.parse(c.returnedAt || c.startedAt)`. The `early` split at `R0 - 50` seconds is `> R0 - 60`, so it anchors. **This is correct and intended** — legacy rows keep the 60s skew allowance.

Checking the actual R26 test assertions against the code: they pass. This is **not a surviving defect** — I withdraw it. The round-26 L2 repair is sound: both branches now route through `closesCycle`, and the selftest R26 block exercises the `splitByOther` path with early/late/legacy/double-claim/small-split cases. The verdict's L2 is correctly discharged in the repair.

## FINDING 2 (MEDIUM, verified-and-standing): L1 (candidate-signature loss on unknown outcomes) was repaired, but the repair does NOT cover one path the verdict named.

**Construct:** `bank/revenue.mjs`. The round-26 repair added `rememberAttempt(cycle, hop, e, led, venue)` to the sweep, swap, return and split catch handlers. The selftest confirms all four: `['Sweep', 'Swap', 'Return', 'Split'].map(h => (src.match(new RegExp(\`rememberAttempt\\(cycle, '${h}', e, led(?:, venue)?\\)\`, 'g')) || []).length), [1, 1, 1, 1]`.

Checking the actual handlers:
- Sweep: `if (verdict.outcome !== 'landed') { rememberAttempt(cycle, 'Sweep', e, led); throw e }` ✓
- Swap: `if (verdict.outcome !== 'refused') { rememberAttempt(cycle, 'Swap', e, led, venue); throw e }` ✓
- Return: `.catch(e => { rememberAttempt(cycle, 'Return', e, led); throw e })` ✓
- Split: `rememberAttempt(cycle, 'Split', e, led)` inside the catch, before the emptiness check ✓

**This repair holds.** The verdict's L1 is correctly repaired. I withdraw any claim of a surviving defect here. Audit score: round-26's confirmed findings (L1–L6, D1–D3) all appear repaired in the `8fe3120` tree reflected in the bundle, and the selftest floor moved 774→789 with arms for each. The VALIDATION.md claims match the selftest content I can read.

**However** — the round-26 verdict is itself the thing I was told to attack, and here is where its reasoning is incomplete:

=====================================================================
R5 — THE SWAP: NEW FAULTS THE PRIOR ROUNDS MISSED
=====================================================================

## FINDING 3 (HIGH): `classifySendFailure` treats a `processed`-but-not-`confirmed` landed-and-failed transaction as `unknown`, leaving the Meteora fallback unreachable AND the cycle open on a swap that DID fail — but the deeper bug is the swap re-quote drift guard permits a sandwich larger than the oracle floor.

Let me focus the real finding here, in R5(i).

**Construct:** `bank/swap.mjs` `oracleFloor` + `bank/revenue.mjs` step 2. The on-chain floor `minSats = expectedSats * (10_000 - 150) / 10_000`. The deviation gate rejects a pool >100bps from oracle. 

**The bound an adversary can extract, computed:** The floor is 150bps under the oracle-derived price. A sandwicher sees the swap, moves the Orca pool price up to the edge of the 100bps deviation gate (the gate is checked in `market()` during the re-price at step 2, against the *current* pool sqrt_price), then lets the swap execute against `other_amount_threshold = minSats`. The swap will succeed as long as the pool delivers ≥ minSats. The gap between what an honest pool at oracle-price delivers (≈ expectedSats minus 16bps fee minus impact) and the floor (expectedSats − 150bps) is the extractable margin: **up to ~134bps per cycle** (150 − 16 fee, minus impact), on each swap.

Now compute per-month: cap is 10 SOL / 6h = 40 SOL/day = 1200 SOL/month maximum throughput. At ~134bps that is **~16 SOL/month maximum MEV leakage** at full throughput, in the worst case where someone sandwiches every cycle. This matches SPEC accepted limit 10's disclosure ("up to 1.5% below Pyth's price, and further if Pyth's own price is off") in magnitude.

**Is the accepted limit WORSE than stated?** The limit 10 text says "the output floor is the oracle-derived expected output less 150 bps." This is accurate. **But** the critical gap the prior rounds did NOT bound: the deviation gate in `market()` is checked against the pool's spot price at **step-2 re-price time**, and the swap transaction then lands in a *later* block. Between `market()`'s read and the transaction landing, an attacker can move the pool freely — the only on-chain protection is `minSats`, NOT the deviation gate (which never runs on chain). So the **100bps deviation gate buys nothing against a sandwich**: it only screens out a pool that is *already* mispriced at read time. The extractable bound is the full 150bps floor, not "150 minus whatever the gate caught."

**Evidence that would exist if I'm right:** On the fork, `swap()` executes against whatever pool state is current when the tx lands; `judgeSwapInstructions` checks `minSats` is in the instruction but never re-checks deviation. The SW.1/SW.4 fork assertions only prove the floor holds *when the pool is honest* (they record `got` ≈ `expectedSats`), never that the floor binds a sandwiched pool. There is no fork assertion where the pool is pushed to the gate edge between read and land.

**Severity:** HIGH as a disclosure gap, not CRITICAL: it is bounded (≤150bps, ≤~16 SOL/month royalty-only at full throughput, nothing touches vaults/pool/sale cbBTC), and the funds never leave the royalty stream. **But limit 10's claim that "a pool priced more than 1% from the oracle is not used at all" implies protection against a mispriced pool at execution, which the off-chain deviation gate cannot provide.** The honest statement is: the *only* execution-time protection is the 150bps on-chain floor; the deviation gate is a read-time sanity check with no bearing on what a sandwich extracts.

**Fix:** State in limit 10 that the deviation gate does not bind execution; the 150bps floor is the sole execution-time bound and the full 150bps is extractable by a sandwich at the gate edge. Optionally tighten `SWAP_TOLERANCE_BPS` toward the measured honest slippage (the fork measured ~86bps under oracle at 10 SOL on Meteora, ~21bps on Orca), since 150bps is generous for the ~$10M Orca pool.

## FINDING 4 (MEDIUM): `judgeSwapInstructions` does not verify the Orca swap's tick-array accounts or Meteora's bin-array accounts, so a tampered builder can route the swap through pool accounts of a DIFFERENT, attacker-controlled Whirlpool that shares the pinned pool's address in key position but supplies wrong liquidity accounts.

**Construct:** `bank/swap.mjs` `judgeSwapInstructions`. It checks `keyAt(sw, orca ? 2 : 0)` equals the pinned pool, the input (key 3/4) and output (key 5) are the operator's ATAs, the amount, floor, and direction bytes. It does NOT check the tick arrays (Orca keys 7,8,9), the oracle PDA (key 10), or the pool's vault A/B (keys 4,6).

The verdict (D2/Qwen F-2) treated this as "the venue program validates its pool-owned liquidity accounts" and dispositioned it as "NO new value-moving defect." Let me verify that disposition is sound.

**Analysis:** For Orca, `vaultA`/`vaultB` are read FROM the pool account in `readWhirlpool` and placed by `orcaSwapIx`; a tampered builder could put *attacker* vault accounts there. The Whirlpool program checks that the token vaults match the pool's stored `token_vault_a`/`token_vault_b` — this IS validated on chain by Orca. The tick arrays are PDAs derived from the pinned pool; Orca validates they are the correct PDAs for the swap. So the venue program does bind these. **The verdict's disposition is correct** — a tampered builder cannot route through foreign liquidity because the real pinned-pool program validates its own accounts, and `judgeSwapInstructions` pins the pool address itself.

**But** one gap survives: `judgeSwapInstructions` does NOT verify the number/positions of the tick arrays or bin arrays, and for Meteora the `host_fee_in` optional account. If a tampered builder set `host_fee_in` to a real account instead of `METEORA.program` (the "None" sentinel), a host fee could be siphoned. Checking: `meteoraSwapIx` always emits `opt(null, false)` → `{ pubkey: METEORA.program, isSigner: false, isWritable: false }` for `host_fee_in`. The judge does not inspect this slot. A tampered `swap.mjs` could set a host-fee recipient. **This is within the accepted "box-owner residue" (limit 10c): whoever edits `swap.mjs` can edit the judge.** So it is not a new finding against the design — it is correctly inside the accepted trust boundary. I withdraw it as a finding; noting it only as confirmation that the box-owner residue is real and the judge is not a defense against a tampered builder (which the verdict and limit 10 already state).

=====================================================================
R1 — THE CRANK
=====================================================================

## FINDING 5 (MEDIUM): `planCrank` plans `split` and counts `splitToPool` toward the distribution denominator using the **wrong** fee direction — but let me check the arithmetic against the program.

**Construct:** `bank/crank.mjs` `planCrank`:
```js
const total = BigInt(revenue.amount)
splitToPool = total - total * 1500n / 10000n
```

Program `split_revenue`:
```rust
let bank_cut = ((total as u128) * ((BPS - split_bps)) / BPS) as u64;  // = total * 1500/10000
let holders = total.checked_sub(bank_cut)
```

Crank: `splitToPool = total - total*1500/10000`. Program: `holders = total - (total*1500/10000)`. **These match** (floor division both; crank uses BigInt, program u128, same truncation). The crank's `splitToPool` is an upper estimate used only to decide whether to plan a distribution, and the actual distribution reads the real pool balance on chain, so a rounding mismatch here cannot cause a false positive that the program would then refuse as benign. **No defect.**

## FINDING 6 (LOW): The crank's reveal budget drop leaves the dropped reveals' vaults with their draws computable-but-uncaptured longer, but it is already accepted (limit 25) and the crank pages `fee.dropped`. No new defect.

## FINDING 7 (MEDIUM): `planCrank` activation reads `tokens[r.asset]` balance against `ACTIVATION_SATS` but the token at `tokenAddr` for a **non-active** vault is derived as `ataOf(payMint, signerPda(r.asset))` — the canonical ATA — while the **program's** `activate` first call derives `want` the same way and checks `vault_token.key == want`. These agree. But the crank sends `R(tokens[r.asset].address)` as the `vault_token` account. Verify the account it names is the canonical ATA.

`tokenAddr(r) = r.active ? r.vault_ata : ataOf(payMint, signerPda(r.asset))`. For a non-active vault being activated, `r.active` is false, so it names the canonical ATA. The program derives the same. **Match. No defect.**

=====================================================================
R2 — THE ALARM
=====================================================================

## FINDING 8 (MEDIUM): `detectUnsweptRoyalties` restarts its clock on **any** balance fall, and a partial sweep (capped at 10 SOL while 40 SOL of backlog exists) counts as a fall → clock reset → never pages even though 30 SOL sits unswept indefinitely.

**Construct:** `bank/detectors.mjs` `detectUnsweptRoyalties`:
```js
if (prevLamports !== null && BigInt(lamports) < BigInt(prevLamports)) since = nowSec
```

**Scenario:** Royalties accumulate to 40 SOL above reserve. Each 6h cooldown, the capped sweep moves 10 SOL. Balance goes 40→30→20→..., each a fall, each resetting `since = nowSec`. The `royalties_unswept` clock never reaches its grace. So 30 SOL (then 20, then 10) sits unswept for days and **never pages**.

**Is this a defect or accepted?** This is **explicitly accepted** — SPEC limit 10's "Throughput has a permanent ceiling, and a capped sweep never pages (round 25 A2)." The disclosure says: "a working sweep that is capped never pages." So this is a known accepted limit. 

**Is the accepted limit WORSE than stated?** Partially. The limit says the *backlog waits* and *a working sweep never pages*. The hole it does NOT state: if the swap operator is **compromised** and keeps sweeping (stealing) at the cap every cooldown, the balance falls each time, the clock resets each time, and `royalties_unswept` NEVER fires — but the `unreconciled_swap` detector (CRITICAL on a sweep with no matching return) IS the control that catches a stealing operator, so this is covered by a *different* detector. The two together close it. **Not worse than stated** — the stealing case is caught by `unreconciled_swap`/`unledgered_sweep`, and the capped-honest case is the accepted throughput ceiling. Confirmed accepted limit, correctly bounded.

## FINDING 9 (HIGH): `detectConfigDrift` skips the third-party program keys when `prev[k] === undefined` (round 25 I2 carve-out), but this carve-out combined with `carryConfigBaseline` means a third-party program's `upgrade_authority` change across a one-pass failed read is **silently dropped** — exactly the L5 bug the round-24 repair was meant to close, surviving for the `THIRD_PARTY_KEYS`.

**Construct:** `bank/detectors.mjs`:
```js
if (prev[k] === undefined && THIRD_PARTY_KEYS.has(k)) continue
```
and `carryConfigBaseline` carries forward the last non-null value.

**Analysis:** `carryConfigBaseline` carries forward `prog.orca.hash` etc. (they are never null once recorded — Core/third-party programs produce `NO_PROGRAMDATA` or a real value, never missing). So after the first pass that records them, `prev[k]` is defined, and the `THIRD_PARTY_KEYS` carve-out only applies to `undefined` (never-recorded). The selftest arm I2 confirms: `'a baseline from before round 25 (never recorded) is not drift'` uses `undefined`, and `'hash -> unreadable -> NEW hash is CRITICAL'` for `prog.mint.hash` (an OURS key, not third-party).

Does the L5 carry (`carryConfigBaseline`) cover third-party keys? It carries ALL non-`._missing` keys with non-null values. Third-party keys get `NO_PROGRAMDATA` when `_missing`, which is non-null, so they are carried. Across a one-pass failed read, `readConfigs` sets `prog.orca._missing = true` and `prog.orca.hash = 'NO_PROGRAMDATA'` (via the `NOT_OURS.has(name)` branch). So the baseline keeps `NO_PROGRAMDATA`, and the next pass with a real hash drifts `NO_PROGRAMDATA → <hash>` = HIGH. 

Wait — but a *transient RPC failure* to read the ProgramData account: `if (!acc)` sets `_missing` AND `NO_PROGRAMDATA`. So a real hash `abc` → (blip) `NO_PROGRAMDATA` → `abc` again produces drift `abc → NO_PROGRAMDATA` (HIGH, reads like a page) then `NO_PROGRAMDATA → abc` is skipped? No: `carryConfigBaseline` keeps the last non-null, which is `abc` (from before the blip) — wait, `NO_PROGRAMDATA` IS non-null, so it would be carried as the baseline, overwriting `abc`. Let me trace precisely:

`carryConfigBaseline(prev, cur)`: starts `out = {...cur}`. For keys in `prev` that are null/undefined in `out`, restore from prev. During a blip, `cur['prog.orca.hash'] = 'NO_PROGRAMDATA'` (not null), so `out` keeps `NO_PROGRAMDATA`. The real `abc` from prev is NOT restored (because out's value is non-null). So baseline becomes `NO_PROGRAMDATA`. Next pass: real `abc`, drift `NO_PROGRAMDATA → abc` = HIGH. A false HIGH, not a *missed* change.

Now the dangerous direction: `abc` → (attacker upgrades) `xyz` in the SAME pass as a blip? No — a blip and a real read are mutually exclusive in one pass. If the attacker upgrades during a blip pass, the read fails (`NO_PROGRAMDATA`), next pass reads `xyz`, drift `NO_PROGRAMDATA → xyz` = HIGH. The change IS caught, just attributed as a change from NO_PROGRAMDATA.

**Conclusion: the third-party drift is NOT silently dropped.** The `NO_PROGRAMDATA`-as-a-value design (distinct from `undefined`) is what saves it — the carve-out only suppresses the never-recorded→first-recorded transition. **I withdraw this as a defect.** The design is sound; the `NO_PROGRAMDATA` sentinel is load-bearing and correct.

=====================================================================
ATTACKING THE ACCEPTED LIMITS
=====================================================================

## FINDING 10 (HIGH): Limit 46 / limit 10(d) — the swap's Pyth staleness check is defeatable in a way that makes the oracle floor meaningless, because `readPyth` accepts ANY `publishTime` within [now−180s, now+30s] and the floor is derived from THAT price. A stale-but-accepted price lets a sandwich extract more than the 150bps the limit claims is the bound.

**Construct:** `bank/swap.mjs` `oracleFloor`:
```js
if (nowSec - p.publishTime > MAX_ORACLE_AGE_SECS) throw  // 180s
```
The floor `minSats` is computed from `sol.price` and `btc.price`, which can be up to 180s old.

**Scenario:** SOL/USD can move several percent in 180s during volatility. If the oracle price is 180s stale and SOL has dropped 3% since, `expectedSats` (and thus `minSats`) is computed at the OLD higher SOL price, so the floor demands MORE cbBTC than the current market gives. That direction is *safe* (the swap simply refuses). The dangerous direction: SOL has RISEN 3% in the stale window, so `expectedSats` is computed at the old LOWER SOL valuation → `minSats` is too LOW → the pool (which has repriced to the new SOL value) can deliver well above `minSats` while the honest market would give even more, and a sandwich extracts the difference between the stale-derived floor and the true market.

**Bound:** staleness ≤180s. SOL/USD realized vol is on the order of 1–3% in 180s during stress. So the stale-oracle path can add up to ~3% (300bps) on top of the 150bps floor tolerance = **~450bps extractable in a volatile 180s window where the oracle lagged the market and an adversary exploited the lag**.

**Is the accepted limit WORSE than stated?** Limit 10 says: "These checks do not establish a hard bound on deviation from the true SOL/cbBTC market price." So the limit DOES disclose that the 150bps is relative to the oracle, not the true market, and names staleness. The round-26 verdict (Opus-5.5 R5-1) also accepted this: "Margin above that floor can be taken through adverse execution. Confidence is not a hard 60-bps or 250-bps true-market-price bound." **So this is disclosed in principle.** But the *magnitude* — that a 180s stale oracle during volatility compounds with the 150bps floor to permit several hundred bps — is not quantified anywhere. 180s is a long staleness tolerance for a sponsored Pyth feed that posts "about once a minute." 

**The finding:** MAX_ORACLE_AGE_SECS = 180 is 3x the stated posting cadence. Tightening it to 60s would reduce the stale-oracle attack surface by ~3x at no cost to a healthy feed (which posts every ~54s per the code's own measurement). The limit is bounded-but-looser-than-necessary; the accepted 180s is a disclosed-but-unquantified compounding risk. **Severity HIGH as a tunable that should be tightened before immutable launch** — once locked, 180s is permanent, and `MAX_ORACLE_AGE_SECS` is a code constant, not an `initialize` value, so it IS frozen by immutability of `bank/swap.mjs`... 

Wait — `bank/swap.mjs` is OFF-CHAIN. It is not immutable; it can be edited post-launch. The on-chain floor is whatever `minSats` the operator's transaction carries. So this is operationally fixable, not permanent. **Downgrade to MEDIUM.** Fix: set `MAX_ORACLE_AGE_SECS = 60` to match the feed's actual cadence; it costs nothing and shrinks the stale-oracle MEV window 3x.

## FINDING 11 (MEDIUM): Limit 32/41 — the 2.1%/hour rolling-window ring is 64 slots, and the limit states it "covers live supply up to 3,047; above that the limit is stricter, never looser." Verify this bound and the "stricter never looser" claim.

**Construct:** BURN keeps `rate_ring[64]`. `cap = min(64, max(1, ceil(live*210/10000)))`. At 2,100 live, cap=45. The ring holds the last 64 redemption times. The window check: a redemption lands iff the cap-th most recent is ≥ window old.

**Analysis:** With cap=45 and a 64-entry ring, the ring remembers the last 64 redemptions. To check "45 in the last hour," it looks at the 45th most recent. 45 ≤ 64, so the ring has it. At live=3,047, cap=ceil(3047*210/10000)=ceil(63.99)=64. At live=3,048, cap would be 65 but is clamped to 64. So above 3,047 the ring can only enforce "64 in the last hour" not "65+", meaning the cap is held at 64 = **stricter** than the true 2.1%. The limit's claim holds.

But live supply max is 2,100 (`max_supply`). So live can never exceed 2,100, cap never exceeds 45, and the ring (64) always has headroom. **The 3,047 bound is irrelevant for this deployment** — a correct, conservative over-provision. No defect. The limit is accurate and the ceiling is never approached.

## FINDING 12 (HIGH): Limit 56 and the $CBOB boost — a surviving gaming path the limits do not bound. The release wallet holds all $CBOB; a compromise lets a thief boost owned vaults. But there is a SEPARATE, non-theft gaming path: the boost+trigger interaction lets a boosting holder force immediate expiry of OTHERS' boosts while preserving their own timing.

**Construct:** `boost_vault` + `distribute(burn)` with 100 $GARY. A boost lasts N *distributions*. Anyone can trigger a distribution by burning 100 $GARY whenever the pool holds anything undistributed.

**Scenario:** Attacker A boosts their vault for the max 24 distributions. A rival R also holds a 24-distribution boost bought earlier (say 20 distributions remaining). A wants R's boost to expire sooner so R stops diluting A's share. A burns 100 $GARY × 20 times (≈2,000 $GARY, ~$177 at ruled price) to run out R's remaining 20 distributions — but each of those 20 distributions ALSO consumes 20 of A's own 24. So A cannot run out R's boost faster than its own. **The symmetry means no asymmetric attack exists.** The limit (51, DISCHARGED) already states: "a 24-distribution boost can be run out in a few transactions... and that ends every live boost at once." It is symmetric; nobody gains. **No new defect** — confirmed the discharged item's reasoning holds.

=====================================================================
R6 — THE GATES
=====================================================================

## FINDING 13 (MEDIUM): The `judgeSwapInstructions` floor arm `SW.6c` proves a zeroed floor is refused, but there is NO fork or selftest arm proving the judge refuses a floor set to `1` sat (a non-zero but trivially-low floor). The round-25 L1 repair checks `minSats` equals the oracle floor passed in, so this is covered IF the caller passes a good floor.

**Construct:** `judgeSwapInstructions(ixs, owner, venue, { lamportsIn, minSats })` checks `d.readBigUInt64LE(16) !== floor` where `floor = BigInt(minSats)`. If the *caller* (revenue.mjs) computes `guaranteed = m2.f.minSats` correctly, the judge binds the instruction to it. The judge cannot independently verify `minSats` IS the oracle floor — it trusts the caller's `minSats` argument. So a tampered `revenue.mjs` passing `minSats=1` would build a swap with floor=1 AND tell the judge `minSats=1`, and the judge passes it.

**This is the accepted box-owner residue (limit 10c):** whoever edits `revenue.mjs` can pass a low floor to both the builder and the judge. The judge is a check on BUILDER defects, not on `revenue.mjs` defects. The post-swap delta check in `revenue.mjs` (`delta < guaranteed` throws) uses the same `guaranteed`, so a tampered `revenue.mjs` disables that too. **Correctly inside the accepted trust boundary.** Not a new finding; confirms limit 10's scope is honest.

## FINDING 14 (LOW): `run-tests.sh` floor `MIN_ASSERTIONS=844` and the suite "must EQUAL" check — verify the equal-not-exceed logic can't be satisfied by a vacuous suite. The runner pins `CBOB_TEST_FILE` must be unset, `CBOB_CACHE` must equal the default. These are real guards. The floor-equals-count is enforced. **The gates are armed correctly.** No defect found in the gate logic itself.

=====================================================================
VERDICT ON R0's CLAIMS
=====================================================================

The round-26 verdict's confirmed findings (L1–L6, D1–D3) are all genuine and all appear repaired in this tree (selftest 789, launch 47, the new arms present). I independently confirm:
- L1 repair (candidate signatures) holds — all four hops call `rememberAttempt`.
- L2 repair (`splitByOther` anchoring) holds — `closesCycle` routes both branches.
- L3/L4 repairs (revenue/reconcile notice streams) hold — `revenueNotices`/reconcile recovery arms present.
- L5 repair (launch-gate imported alarm) holds — the new L5 arms force the imported detector.
- L6 repair (rehearsal cron refusal) holds — the installer refuses `REHEARSAL-RECORD.txt`, exercised by the R26 shell harness.
- D1/D2/D3 doc corrections are low-stakes and the selftest D3 arm exists.

The verdict's REJECTIONS I spot-checked (Deepseek C1 invoke_signed, M1 budgetPlan, M2 future-startedAt) are all correctly rejected on measurement.

**OPEN AND BLOCKING items 22, 38, 50, 52, 53 remain open and correctly so.** No prior DISCHARGED item is undischarged.

=====================================================================
SURVIVING FINDINGS, RANKED
=====================================================================

**MEDIUM — Finding 3 (R5i):** The 100bps deviation gate provides NO execution-time protection against a sandwich; the sole execution bound is the 150bps on-chain floor, and the full 150bps (minus pool fee) is extractable per cycle at the gate edge. Limit 10 implies the deviation gate protects against a mispriced pool; it only screens read-time, not land-time. **Fix:** correct limit 10's wording; consider tightening `SWAP_TOLERANCE_BPS` toward the measured honest ~86bps.

**MEDIUM — Finding 10:** `MAX_ORACLE_AGE_SECS = 180` is 3× the sponsored feed's measured ~54s cadence; the stale-oracle window compounds with the 150bps floor to permit several hundred bps of extraction during volatility. Off-chain and fixable (not immutable), so MEDIUM. **Fix:** set to 60s.

**Confirmations (no new defect):** Findings 1, 2, 4, 5, 6, 7, 9, 11, 12, 13, 14 verified as either sound repairs or correctly-inside accepted trust boundaries. The box-owner residue (limit 10c) genuinely bounds Findings 4, 13.

=====================================================================
WHAT AI AUDIT STRUCTURALLY CANNOT DO — concrete pre-launch actions
=====================================================================

Given immutability and no human firm, these are the gaps no amount of re-reading closes:

1. **Run the live money paths once, for real, with real loss exposure.** SPEC item 22 names this (the dress rehearsal and ONE full revenue cycle through each pool + one forced post-sweep failure recovered by hand). It is OPEN. **This is the single highest-value pre-launch action.** No auditor, AI or human, has ever watched `revenue.mjs` sweep real SOL, swap it, return it, and split it — the selftest only drives extracted handlers with stubbed sends. A fork test proves the swap *builds correctly*; it does not prove the *orchestration* (the open-cycle guard, the recovery path, the ledger round-trip, the confirmation-timeout handling) survives real network latency and partial failures. **Do item 22 steps 3 and 4 on a throwaway deployment with ~$50 of real cbBTC before locking.**

2. **Adversarial MEV simulation on the fork.** No fork assertion pushes the pool to the deviation-gate edge BETWEEN `market()`'s read and the swap landing. Build one: read the oracle, move the Orca pool price to +99bps, then land the swap, and MEASURE what fraction of the 150bps floor an adversary captures. This directly tests Findings 3 and 10 with numbers instead of reasoning.

3. **A second, independent reimplementation of the payout accumulator math** (the `credit`/`owed_of`/`reweigh`/`carry` arithmetic across 1000+ distributions with random boosts, joins, retires). The host test `the_boost_schedule_through_the_programs_own_functions` is good but checks the program's own functions against a model built by the SAME author's mental model. Have a *different* implementation (even a spreadsheet or a Python model written without reading the Rust) reconcile `sum(owed_of) == owed_scaled` and `pool >= ceil(owed)` invariants against transaction logs from the fork. Immutable arithmetic bugs are unfixable.

4. **Load-test the crank at 2,100 vaults against live cluster RPC** (item 22 again). The serial-confirmation lane's throughput (Opus-5 F3, unverified) determines whether draws lapse into re-rolls during a sale burst. This is a measurement no static read produces.

5. **Have a human with the guardian key practice the emergency stop and the hand-recovery runbook**, timed, before launch. The whole safety model rests on "a human reaches the guardian wallet within the alarm cadence." That latency has never been measured.

6. **Independently re-derive the pinned Core hash and the five program IDs from a clean build on a different machine** (SPEC ship gate 2's reproducibility claim). The build-mainnet script proves source→bytes on ONE box; a second box confirms the box itself is not the trusted element.

The structural truth: AI audit converges on "the code says what it says." It cannot tell you whether the code *does* what it says under a real adversary, real latency, and real partial failure. Items 22 and the three measurements above are the irreducible residue. **Do not remove the upgrade authority until all six have produced recorded evidence.**