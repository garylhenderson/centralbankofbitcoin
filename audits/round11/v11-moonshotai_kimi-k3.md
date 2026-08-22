# ROUND 11 AUDIT — FINDINGS FIRST

## 1. HIGH — `bank/lock.mjs`: the stale-lock break is *scheduled* by the cron, is non-atomic, and `releaseLock` deletes the replacement runner's lock. The double-pay this module exists to prevent is still reachable.

Three defects compose into one path:

**(a) The 20-hour stale timeout is shorter than the cadence it protects against.** `distribute.mjs` runs daily at 09:07 with `staleMs: 20h`. A run that is *still legitimately paying* at hour 20 (2,100 sequential confirmed transfers; ~34s/transfer sustained under congestion is extreme but not impossible — and `sendAndConfirmTransaction` retries can eat minutes per transfer during an outage) meets the *next day's cron* holding a lock that is now stale. The cron runner breaks it and starts paying **concurrently**.

**(b) The break is not atomic.** `acquireLock`: both runners read `EEXIST`, both compute `age > staleMs`, both `fs.writeFileSync(file, payload)` (no `'wx'`), both return `{ok:true}`. Two runners that arrive at a stale lock within the same scheduling quantum both proceed.

**(c) `releaseLock` unlinks unconditionally.** Runner A (slow, legitimate) finishes at hour 21 and its `finally { releaseLock(file) }` deletes **runner B's** lock. Runner C now acquires cleanly while B is mid-payout.

The consequence is exactly what the file's header claims to prevent: runner B loads the ledger once; runner A writes intent rows *after* B's load; B's in-memory `done` has no row, so B pays every vault A has not yet reached — and A pays them too. Per-vault intent rows do **not** save this, because the second runner's ledger snapshot predates them.

**Fix:** break by `unlinkSync` + `writeFileSync(..., {flag:'wx'})` and return `ok:false` if the wx-create loses the race; make `releaseLock` read the payload and unlink only if `pid` matches; and make `staleMs` for distribute *longer* than the inter-cron interval is not the answer — the answer is (a)+(c), so a broken lock can never produce two live runners.

**Evidence standard check:** this contradicts no passing test — the selftest proves stale-breaking *works*, never that two breakers can't both win, and never that release is ownership-checked.

## 2. MEDIUM — `missingWatchedKeys` does not cover the four `*.collection` keys that `detectStandingRisks` reads. The round-10 "class-closing assertion" does not close the class.

`detectStandingRisks` reads `seal.collection`, `mint.collection`, `burn.collection`, `gov.collection` for `collections_disagree` — a CRITICAL check. `WATCHED_KEYS` contains none of them (WATCH has no collection entries; the extras list has none; `collection.hash` is a different key and is skipped by the `prog === 'collection'` branch anyway). Today `readConfigs` produces all four, so the check runs. But the round-10 claim — "It now asserts against everything the standing checks read" — is false: a future edit that drops one collection read leaves `colls` comparing three values, `distinct.size === 1`, quiet. That is precisely the `mint.pending_bank` shape from round 9 (watched by a detector, produced by nobody, reads as calm), re-opened in the mechanism built to close it mechanically.

**Fix:** add the four keys to `WATCHED_KEYS`. One line each; the assertion then does what the comment says.

## 3. MEDIUM — `splitByOther` cycles skip every chain-anchored check on the return side.

First, what holds: the empty-ATA proof is sound against a key-only attacker. Only `split_revenue` can move tokens out of the revenue ATA (the PDA signs nowhere else), its destinations are derived from config and pinned, both transfers succeed or the transaction reverts, and `NothingToSplit` requires `total == 0`. A stranger cannot manufacture the emptiness and cannot split to their own address. I could not break that.

What does not hold: `detectSplitClaims` does `if (c.splitByOther) continue`, so a cycle closed this way is *never* matched against `seenSplits` — yet a genuine front-run split is a MINT transaction and **would** be in `seenSplits`. The return side of such a cycle then rests entirely on the ledger (`returnedSats`, `quotedSats` — both written by the process that holds the operator key). Before this repair, closing a cycle required a `splitSig` the chain scan could falsify (`split_not_on_chain`); after it, `splitByOther: true` closes a cycle with no chain anchor at all. The exploit requires ledger write access (the box, which also holds the distributor key — so the marginal exposure is honestly small), but this pipeline's stated reason for existing is that the ledger is the audited key's own testimony, and this is a hole in exactly that wall.

**Fix:** for `splitByOther` cycles inside the horizon, require at least one split signature in `seenSplits` not claimed by another cycle before treating the cycle as closed. No event parsing needed.

## 4. LOW — `resolvedBy` does not extend to the `refused` branch; `paymentState` doesn't know it either. Second site, same class, same round.

Round 10 added `resolvedBy` so an ambiguous transfer can be answered. But in `detectDistribution`, `const refused = rows.filter(([, r]) => r.rejected)` ignores `resolvedBy` — a permanently-frozen destination ATA (cbBTC has a live freeze authority; the code says so) nags HIGH forever with no resolution path, the exact defect the same commit fixed for ambiguous rows. And `paymentState` in `distribute.mjs` returns `'unpaid'` for a rejected row regardless of `resolvedBy`, so the job keeps retrying a transfer a human has already resolved on chain. **Fix:** `r.rejected && !r.resolvedBy`, and teach `paymentState` the field.

## 5. LOW — `distribute.mjs --selftest` has no assertion floor. Second site of the round-10 floor.

`selftest.mjs` got `FLOOR = 135`. The distribute selftest — run in the same step of `run-tests.sh` — still ends with `process.exit(R.every(Boolean) ? 0 : 1)` over 15 assertions with no floor. Delete half the assertions and it exits 0. **Fix:** `FLOOR = 15`.

## 6. LOW — the newest rotation's negative paths are unasserted in the suite.

`apply_pending_governance` early is asserted (7.2c), `apply_pending_admin` early (7.2o), SEAL apply early (6.33c) — but nothing applies `apply_pending_operator` *before* the deadline, and `cancel_pending_operator` and `cancel_pending_bank` are never called, while `cancel_pending_governance` (7.2d), `cancel_pending_admin` (7.2p) and SEAL's cancel (6.33d) all are. The code reads correctly (`require!(now >= c.pending_operator_at, …)`); by the suite's own standing rule — a gate that has only ever said OK is untested — these four assertions are missing from the least-audited rotation.

## 7. LOW — grace is measured from cycle *start*, not from the return.

In `detectUnreconciledRevenue`, `age = nowMs - Date.parse(c.startedAt)` gates both `unreconciled_swap` and `cycle_unsplit`. A cycle whose sweep is 90 minutes old but whose return landed 60 seconds ago (slow Jupiter, manual intervention) fires `cycle_unsplit` HIGH while `revenue.mjs` is literally mid-step-4, and a swap that takes over an hour fires `unreconciled_swap` CRITICAL while legitimately in flight. Transient and self-resolving, but two false alarms teach scrolling. **Fix:** stamp `returnedAt` and grace `cycle_unsplit` from it.

## 8. LOW — `probe-mainnet-facts.mjs` duplicates `signaturesSince` instead of importing it.

Its own comment says "If they drift, this proves nothing" — and then there are two copies. The probe asserts the *copy* against mainnet; the alarm uses the *original*. Extract the helper into a module both import, or the probe's four assertions decay into proving a function nothing calls.

---

## WHAT I TRIED AND COULD NOT BREAK

- **The splitByOther empty-ATA proof against a key-only attacker.** Destinations are derived from config inside the handler; the revenue PDA signs only via `split_revenue`; both transfers are atomic; `NothingToSplit` requires zero balance. A stranger front-running the split pays the pinned addresses by the enforced ratio. The only soft spot is the missing chain anchor (Finding 3), not the proof.
- **Pause + notice as the operator-compromise emergency story.** `set_paused` stops `sweep_sol_for_swap` in the same transaction; the rotation then waits out `governance_timelock_secs` in public with `mint.pending_operator` CRITICAL on every pass; `apply_pending_operator` is permissionless and unwedgeable; `revenue.mjs` pins the local keyfile to `config.swap_operator` so a landed rotation fails the cron loudly rather than silently. The cost (minting also stops during the notice) is real but stated.
- **The delivery-failure carry for deferred sweeps.** Re-carried entries that were resolved this pass are re-judged next pass and dropped silently (row exists → `continue`); entries reported this pass are re-reported. No finding is consumed and none is duplicated.
- **The dry-run marker.** Alarm stamps `EVER` only when `!DRY`; `revenue.mjs` returns before `save(led)` when `!LIVE`; `distribute.mjs` gates every `save(st)` on `!DRY`. No path stamps a marker without doing the work.
- **Split-signature reuse across the whole ledger.** `claimed` is built before the horizon filter; `splitByOther` cycles are skipped before the reuse check, so two `'split-by-another-caller'` placeholders cannot false-positive. One split closes exactly one cycle.
- **BURN's non-reserve loop parity** (delegate, delegated_amount, close_authority, extension length, amount) — now matches the reserve loop check for check.
- **The royalty CPI.** The suite adds the plugin, fetches the collection back, and asserts 500 then 750 with the revenue PDA as sole creator against the pinned mainnet Core bytes. The round-9 "missing variant byte" claim stays refuted.
- **All offset maps.** SEAL (dynamic post-Vec pending offsets), MINT (through `pending_operator_at` at 481), BURN (through 178), GOV (through `pending_admin_at` at 134) — cross-checked against the struct declarations, the `space =` expressions, the alarm's `readConfigs`, and the suite's raw reads. All agree.
- **The pre-funded proposal PDA** (7.12d) and the quorum floor/ceiling arithmetic — tested in both directions, correctly.

## THE SINGLE THING

Fix `bank/lock.mjs` before this holds real money: make the stale break atomic (unlink + wx-create, loser yields) and make `releaseLock` ownership-checked. Every other finding is a watcher going quiet; this one is the mechanism whose entire purpose is preventing customers from being paid twice, and its failure is *scheduled* — the first payout run that ever exceeds 20 hours meets the next day's cron holding a lock the cron is entitled to break.