## CRITICAL: Unit mismatch in deviation filter makes both DEX pools permanently unusable

**Exact construct:** `bank/swap.mjs` — `orcaSpot`, `meteoraSpot`, and their use in `market()` via `deviationBps`.

**The defect.** `orcaSpot` returns `(sqrt_price / 2^64)^2`, which for the pinned SOL/cbBTC pool is **cbBTC per wSOL** (≈ 0.001396 when SOL ≈ $120, BTC ≈ $85,929). `meteoraSpot` returns `1 / (1 + bin_step/10_000)^active_id`, which for the pinned cbBTC/wSOL pool is also **cbBTC per SOL**. `oracleFloor` returns `satsPerLamport` in **sats per lamport** (≈ 0.0001396). `deviationBps(pool, oracle)` is called with `pool` in cbBTC/wSOL and `oracle` in sats/lamport — a factor of 10 mismatch (1e8 sats/cBTC ÷ 1e9 lamports/wSOL = 0.1).

Consequence: `deviationBps(0.001396, 0.0001396)` = 90,000 bps. The 100-bps gate in `market()` is exceeded by two orders of magnitude, so **both Orca and Meteora are always skipped**, `m1.venues` is empty, and `bank/revenue.mjs` throws *"neither pinned pool prices within the oracle bound"* on every cycle. No SOL→cbBTC swap ever runs.

**Evidence if true.** In `bank/selftest.mjs` (round-25 L6 arm) add:
```javascript
const sol = { price: 12045355552n, conf: 1571698n, expo: -8, publishTime: 1800000000 }
const btc = { price: 8592910904675n, conf: 1886936280n, expo: -8, publishTime: 1800000000 }
const f = SW.oracleFloor({ lamportsIn: 1_000_000_000n, sol, btc, nowSec: 1800000500 })
const w = { sqrtPrice: BigInt(Math.round(Math.sqrt(Number(f.satsPerLamport) * 10) * 2**64)) }
const poolBtcPerSol = SW.orcaSpot(w)           // ≈ f.satsPerLamport * 10
const dv = SW.deviationBps(poolBtcPerSol, f.satsPerLamport)
// dv ≈ 90000, not 0
```
A fork run (`sim/swap-fork.sh`) with the current code would print `orca pool 90000.0 bps from the oracle` and the `SW.0` assertion would fail. The reported fork numbers (Orca 1,400,902 sats vs oracle 1,405,348) are consistent with a pool that is ~30 bps off *after* the unit conversion is applied correctly — i.e. the fork test was run on a tree where the bug was absent or the pool state was cloned from a moment where the raw sqrt_price coincidentally matched the mis-scaled oracle value.

**Fix.** Convert the spot prices to sats per lamport before comparing:
```javascript
export const orcaSpot = w => { const s = Number(w.sqrtPrice) / 2 ** 64; return s * s * 0.1 }
export const meteoraSpot = p => 1 / (1 + p.binStep / 10_000) ** p.activeId * 0.1
```
or equivalently multiply inside `market()`. The `* 0.1` is `1e8 sats/cBTC ÷ 1e9 lamports/wSOL`. Re-run `sim/swap-fork.sh`; both venues should report < 100 bps.

---

## HIGH: `retire` arithmetic can under-flow `total_active_weight` when a boosted vault is retired

**Exact construct:** `programs/cbob-vault-mint/src/lib.rs` — `retire()`, `weight_of()`, and the global `total_active_weight` maintenance.

**The defect.** `weight_of` returns `LEVEL_WEIGHTS[level-1] + boost_weight`. In `retire`, for an active vault it does:
```rust
let w = weight_of(r)?;
...
c.total_active_weight = c.total_active_weight.checked_sub(w)?;
```
and separately un-schedules the boost (subtracting 1 from `boosts_active` and `boost_weight_total`). But `total_active_weight` is only ever *increased* by `weight_of` at join (`join` adds `LEVEL_WEIGHTS[level-1]`, **not** the boost) and by `reweigh` (which moves the difference between old and new weight). When a boosted vault is retired, `total_active_weight` is decremented by `level_weight + boost`, yet it was only ever incremented by `level_weight` at join and by the *net* change at reweigh. The boost portion of the subtraction has no matching addition, so `total_active_weight` can go negative (wrapping in release, aborting in debug) or, more quietly, become permanently too low, inflating every future share.

**Evidence if true.** Suite test: mint a Level I vault (weight 2), activate it (total_active_weight = 2), boost it +2 (reweigh: total_active_weight becomes 4), then redeem it. Read `total_active_weight` after retirement. Expected 0; actual will be `0 - 2 =` underflow (or `0` if the boost was never added to the global). The host-unit test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` asserts `c.total_active_weight == live.iter().map(|r| weight_of(r).unwrap()).sum()` after every step — if that assertion holds, the bug is in the off-chain mirror, not the program. If it fails, the program is wrong.

**Fix.** In `retire`, subtract only the level weight from `total_active_weight` and handle the boost via `unschedule_boost` (which already adjusts `boost_weight_total`). Or, make `join` add `weight_of(r)` and have `reweigh` continue to move the net change. The accumulator test `the_boost_schedule_...` will pin the correct invariant.

---

## MEDIUM: `judgeSwapInstructions` does not check the operator's cbBTC ATA is the swap's *output* account

**Exact construct:** `bank/swap.mjs` — `judgeSwapInstructions`, key index 5 check.

**The defect.** The judge verifies `keyAt(sw, 5)?.equals(ownCbbtc)` for both venues. For Orca, key 5 is the user's token output account (cbBTC). For Meteora, key 5 is also the user's token output (cbBTC). This is correct. However, the judge does **not** verify that the swap's *input* account (Orca key 3, Meteora key 4) is the operator's wSOL ATA **and that it is the same account that was created and wrapped**. A tampered builder could wrap SOL into ATA "X", then build a swap that sells from ATA "Y" (also owned by the operator, but funded by a previous cycle's leftover). The judge would pass because it only checks `transfers[0].keys[1]?.pubkey.equals(ownWsol)` for the *wrap* instruction, not that the swap consumes the same account.

Consequence: a stolen or coerced operator key could be made to swap funds from an account the operator didn't intend, or to double-count a cycle by swapping the same input twice (the second swap would fail on-chain only if the wSOL was already consumed, but a builder that routes the output to a different cbBTC account could exfiltrate).

**Evidence if true.** Build a transaction that wraps 2 SOL into `ownWsol`, then swaps from a *different* wSOL ATA (also owned by the operator, pre-funded with 2 SOL) while keeping the judge's `lamportsIn` and `minSats` consistent with the wrap. The judge returns `[]`. On-chain the swap succeeds, moving the pre-funded SOL, while the newly wrapped SOL stays in `ownWsol` and is returned to the operator at the end — a second sweep the next hour would try to swap again.

**Fix.** In `judgeSwapInstructions`, add:
```javascript
if (!keyAt(sw, orca ? 3 : 4)?.equals(ownWsol)) problems.push('the swap\'s input account is not the wSOL account that was just wrapped')
```
This ties the swap to the wrap instruction's destination.

---

## MEDIUM: Revenue cycle records `returnedSats` as the *delta* but `sweptAtaTotal` as the *full balance*, creating a ledger mismatch on the first cycle

**Exact construct:** `bank/revenue.mjs` — the return step.

**The defect.** After the swap, the code reads the operator's cbBTC ATA balance (`after`), computes `delta = after - opBefore`, and sends the **entire** `after` back to the revenue address. It records `cycle.returnedSats = String(delta)` but `cycle.sweptAtaTotal = String(got)` (the full balance). On the first cycle for a fresh operator key, `opBefore = 0`, so `delta == got` and the mismatch is hidden. On any later cycle, or if the operator ATA already held cbBTC, `returnedSats` under-reports what actually arrived at the revenue address. The alarm's `detectUnreconciledRevenue` compares `returnedSats` against `quotedSats`; a legitimate return that is larger than the quote (because it includes leftovers) is treated as a short return only if `returnedSats < quotedSats * 0.98`, so the immediate symptom is muted. But the ledger's `sweptAtaTotal` anchor (used by `detectSplitClaims` and `closesCycle`) is then inconsistent with `returnedSats`, and a hand-recovery that trusts `returnedSats` will record the wrong split amount.

**Evidence if true.** Run two live revenue cycles back-to-back with the same operator key. After the second cycle, `cycle.returnedSats` will be less than the actual cbBTC that arrived at the revenue address by exactly the operator's ATA balance after the first cycle. The `closesCycle` predicate uses `returnedSats` as the anchor, so a split that lands between the two amounts may not be attributed.

**Fix.** Record `returnedSats` as the full amount sent back (`got`), not the delta. The delta is only needed to enforce the floor (`delta < guaranteed` throws), so keep a separate `operatorDelta` field for that check and anchor the ledger on the full return.

---

## LOW: `detectCrankHealth` problem-key normalisation strips numbers, collapsing distinct problems

**Exact construct:** `bank/detectors.mjs` — `problemKey` and `detectCrankHealth`.

**The defect.** `problemKey = p => String(p).replace(/\b\d+\b/g, '#')`. This turns *"vault A is owed 9 sats but its recorded cbBTC account X is absent"* and *"vault B is owed 12 sats but its recorded cbBTC account Y is absent"* into the same key. A streak of 150 distinct vault-specific problems is collapsed into a single counter, so `crank_problem` pages once with `n = 150` instead of 150 separate findings, and a human reading the page sees only one representative line. The round-28 L2 finding (truncation to 50 problems) was discharged by keeping all 150, but the collapse is still a monitoring gap.

**Evidence if true.** Plan a pass with 150 active vaults whose recorded cbBTC accounts are all absent. The heartbeat carries 150 distinct problem strings. `detectCrankHealth` produces one `crank_problem` finding with `n = 150` and a single `text` line. The alarm page says *"for 150 live full passes in the row the crank has reported: vault A..."* — only one vault is named.

**Fix.** Key on the vault asset and the reason, not the full string. E.g. `problemKey = p => { const m = /vault (\S+): (.*)/.exec(p); return m ? `${m[1]}:${m[2].replace(/\d+/g,'#')}` : p }`.

---

## LOW: Rehearsal tree substitutes `launch/` paths but `launch/create-cbob-token.mjs` still references production R2 keys

**Exact construct:** `scripts/rehearsal-tree.sh` — the Python proof and the substitution map.

**The defect.** The script now includes `launch` in the patched file list (round-28 L3 was discharged), but `launch/create-cbob-token.mjs` reads `/opt/gary-club/.env.local` for R2 credentials and writes the token record to `launch/cbob-token.<cluster>.json`. A rehearsal that runs `--execute --cluster mainnet` (a typo for `local`) would attempt to write to the production R2 bucket using production credentials, and would rewrite `launch/cbob-token.mainnet.json` with a record whose `verified` is `false` but whose `tx` is the rehearsal signature. The script does not guard against `--cluster mainnet`.

**Evidence if true.** In a rehearsal tree, run `node launch/create-cbob-token.mjs --cluster mainnet --execute`. It will attempt to upload to `https://cdn.gary.club/...` and overwrite the production record. The `REHEARSAL-RECORD.txt` marker does not prevent this because the check is only in `scripts/cron-install.sh`.

**Fix.** Add a guard at the top of `create-cbob-token.mjs`: `if (process.env.CBOB_ALARM_REHEARSAL === '1' || fs.existsSync(path.join(__dirname, '..', 'REHEARSAL-RECORD.txt'))) { die('this is a rehearsal tree; mainnet operations are disabled') }` when `--cluster mainnet`.

---

## INFO: SPEC and HOLDER-GUIDE timing claims are stale

**Exact construct:** `SPEC.md` opening paragraph and `HOLDER-GUIDE.md` "Your level is drawn after you get your vault".

**The defect.** SPEC still says *"v6 has had not yet a multi-model round"* (round-28 D1). HOLDER-GUIDE says *"the draw job checks every minute"* but the opening promises *"a level a few seconds after receipt"* (round-28 D2). Both are stale.

**Fix.** Update SPEC to reflect rounds 22–28. Qualify HOLDER-GUIDE to *"within a minute, and usually faster; busy queues can take longer"*.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

AI audit structurally cannot do three things that matter here:

1. **Execute the off-chain money path against a live cluster.** The crank, the revenue cycle, and the alarm have never run against mainnet (item 22). The 855-assertion suite proves the programs on a local validator; it does not prove that `bank/crank.mjs` can page through 2,100 vaults within the RPC rate limit, that `bank/revenue.mjs` can build a transaction that lands in a congested block, or that the alarm's signature walk keeps up with mainnet traffic. The dress rehearsal (road step 8) is the only thing that can catch this, and it is not built.

2. **Verify the deployed bytes match the source.** `scripts/build-mainnet.sh` proves the source carries Gary's key and that the localnet build accepts a test key, but it cannot prove the compiled constant *is* that key without deploying and asking the program. The bridge is reproducibility: an independent party must rebuild from the frozen commit and confirm the sha256. That party does not exist.

3. **Bound the economic risk of the trusted hop.** The swap operator key can take up to 10 SOL every 6 hours (limit 10). AI can read the cap; it cannot tell you whether 10 SOL is the right number, whether the operator wallet should be a multisig, or whether the Pyth deviation filter is tight enough to prevent a sandwich from extracting value. These are business decisions that need a human who understands the market.

**Concrete recommendation before launch:**

- Run the dress rehearsal (road step 8) with real SOL on mainnet, at throwaway program IDs, and have Gary watch the transactions in a block explorer. Specifically: one full revenue cycle through Orca, one forced into Meteora, one forced post-sweep failure recovered by hand.
- Have a second engineer, who did not write the code, rebuild the five programs from the frozen commit and compare sha256 with what `build-mainnet.sh` produced. If they differ, do not deploy.
- Set up the operator key as a Squads multisig (2-of-3) before the first sweep, and lower the cap to 1 SOL until the pipeline has run for a week without an alarm.