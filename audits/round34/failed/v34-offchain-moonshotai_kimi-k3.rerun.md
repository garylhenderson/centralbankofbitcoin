[reasoning only]
Let me start by understanding the task. This is round 34 of an AI audit of a Solana vault system. The previous round (33) verdict is bundled and found NOT CLEAN with specific findings (L1, D1, D2, D3) that were repaired in commit 82bb3ef. My job:

1. R0: Verify round 33's verdict and its repairs hold
2. R1: The crank
3. R2: The alarm
4. R3: The layouts
5. R4: Money arithmetic
6. R5: The swap and revenue cycle
7. R6: The gates

Let me work through the files carefully.

First, round 33's findings and repairs:
- L1 (LOW): `detectSweepState` compared box wall clock with chain clock. Repair: window is symmetric at half a cooldown; uncertain sends confirmed by direct status lookup.
- D1 (INFO): comment overstated; a pending candidate explains only when confirmed landed.
- D2 (INFO): `mint.last_sweep_at` added to WATCHED_KEYS.
- D3 (INFO): launch count reader matches "47 launch".

Let me verify these repairs in the current tree.

Looking at `detectSweepState` in detectors.mjs:

```js
export function detectSweepState({ judgedThrough, lastSweepAt, ledger, nowSec, cooldownSecs = 21600, graceSecs = 900, landed = new Set() }) {
  const t = Number(lastSweepAt ?? 0)
  const from = Number(judgedThrough ?? 0)
  if (!(t > from)) return { findings: [], judged: from }
  if (Number(nowSec) - t < graceSecs) return { findings: [], judged: from }
  const half = Math.floor(Number(cooldownSecs) / 2)
  const explained = (ledger?.cycles || []).some(c => {
    if (!(c.sweepSig || (c.pendingSweepSig && landed.has(c.pendingSweepSig)))) return false
    const st = Date.parse(c.startedAt) / 1000
    return Number.isFinite(st) && Math.abs(t - st) <= half
  })
  ...
```

The window is `|t - st| <= half`. The comment says a thief's sweep must wait a full cooldown after the honest one. Let me think about this carefully.

The scenario: honest cycle starts at box time `st` (wall clock), sweep lands at chain time `t`. The honest cycle's sweep lands shortly after start, so `t ≈ st` (within seconds to a minute). A thief's next legal sweep is at `t + cooldown` (chain time). The window around the honest cycle is `[st - half, st + half]`. Since `cooldown = 2*half`, the thief's sweep at `t + cooldown ≈ st + 2*half` is outside the window. Good.

But wait — what about a thief's sweep BEFORE the honest one? The thief sweeps at chain time `t'`, then the honest cycle sweeps at `t' + cooldown`. The honest cycle's row has `startedAt ≈ t' + cooldown` (box time). The thief's sweep at `t'` is judged: is there a cycle with `|t' - st| <= half`? `st ≈ t' + cooldown = t' + 2*half`, so `|t' - st| ≈ 2*half > half`. Not explained. Good.

But what about the honest cycle's OWN sweep being explained by a LATER cycle's start? Hmm, the detector judges `last_sweep_at` = t, the latest sweep. If the honest cycle's sweep is at t, and there's a LATER cycle... no wait, later cycles start after the cooldown.

Actually, there's a subtlety: the detector only sees the LATEST `last_sweep_at`. If two sweeps happen between alarm passes (a cooldown apart — but cooldown is 6h and alarm runs every 30 min, so two sweeps between passes requires the alarm to be down for 6+ hours), the earlier one is masked. That's the stated limit ("Only the LATEST last_sweep_at is visible... left to the transaction walk").

Now, the repair says the window is symmetric to tolerate clock skew. The concern in round 33 L1 was: box clock 130+ s ahead of chain pages a false CRITICAL on an honest sweep. With the symmetric window, `|t - st| <= half` where half = 10800 s (3 hours) at the ruled 6h cooldown. So skew up to 3 hours is tolerated. That's the repair.

But wait — does the symmetric window let a thief's sweep be explained by an honest cycle? The thief's sweep at `t_thief` and the honest cycle's start `st_honest`. For the thief's sweep to be explained: `|t_thief - st_honest| <= half`. The honest cycle's sweep lands at `t_honest ≈ st_honest`. The thief's sweep must satisfy the on-chain cooldown: `t_thief >= t_prev_honest + cooldown` where `t_prev_honest` is the PREVIOUS honest sweep. Hmm, but the detector judges the LATEST sweep. Let me think about the actual attack:

1. Honest sweep at chain time T0 (cycle started at box time ≈ T0).
2. Thief sweeps at T0 + cooldown (the earliest legal).
3. Alarm pass sees `last_sweep_at = T0 + cooldown`. Is there a cycle with `|T0 + cooldown - st| <= half`? The honest cycle has st ≈ T0, so `|T0 + cooldown - T0| = cooldown = 2*half > half`. Not explained. Pages CRITICAL. Good.

But what if the thief sweeps and THEN an honest cycle runs?
1. Thief sweeps at T0.
2. Honest cycle runs at T0 + cooldown (its start ≈ T0 + cooldown box time).
3. If the alarm sees `last_sweep_at = T0` (thief's) BEFORE the honest one: is there a cycle with `|T0 - st| <= half`? The honest cycle hasn't run yet or its start is T0 + cooldown. `|T0 - (T0 + cooldown)| = cooldown > half`. Not explained. Pages. Good.
4. If the alarm sees `last_sweep_at = T0 + cooldown` (honest's, the latest): explained by the honest cycle. The thief's sweep at T0 is masked — but that's the stated limit (only latest visible).

Hmm, but wait: what if the thief's sweep is the LATEST and there's an honest cycle whose start is within half a cooldown BEFORE the thief's sweep? That requires the honest cycle's sweep to have landed at `st_honest ≈ t_thief - half` at the earliest... no wait. Let me redo.

For the thief's sweep at `t_thief` (the latest `last_sweep_at`) to be explained, there must be a ledger cycle with `|t_thief - st| <= half`, i.e., a cycle that started within `[t_thief - half, t_thief + half]`.

Case A: a cycle that started BEFORE the thief's sweep, within half a cooldown: `st ∈ [t_thief - half, t_thief)`. That cycle's own sweep (if it landed) is at ≈ st. The thief's sweep at t_thief must satisfy the on-chain cooldown relative to that honest sweep: `t_thief >= st + cooldown = st + 2*half`. But `st >= t_thief - half` means `st + 2*half >= t_thief + half > t_thief`. Contradiction. So the thief's sweep cannot be on-chain-legal if an honest landed sweep started within the prior half cooldown. 

But what if the honest cycle's sweep did NOT land (uncertain send)? Then the thief's sweep doesn't have to wait for it on-chain (the honest one never landed, so `last_sweep_at` on chain wasn't updated by it). The row with `pendingSweepSig` explains the thief's sweep only if `landed.has(pendingSweepSig)` — i.e., the direct lookup shows it landed. If it never landed, it doesn't explain. Good — that's the D1 repair.

Case B: a cycle that started AFTER the thief's sweep, within half a cooldown: `st ∈ (t_thief, t_thief + half]`. That cycle's sweep lands at ≈ st > t_thief, so the thief's sweep is not the latest... but the detector only judges the latest `last_sweep_at`. If the honest cycle's sweep landed at st, then `last_sweep_at = st`, not t_thief. So the detector judges st, which is explained by the honest cycle. The thief's earlier sweep is masked (stated limit).

Hmm wait, but there's a timing subtlety: the honest cycle's sweep lands at chain time t_h, and the row's startedAt is box time st. Box-clock skew: if the box is 1 hour ahead, st = t_h + 3600. The detector judges `last_sweep_at = t_h` (chain). `|t_h - st| = 3600 <= half (10800)`. Explained. Good — skew tolerated.

But what about a thief exploiting skew? The thief can't control the box clock. The window is symmetric to tolerate skew; the cost is that a thief's sweep within half a cooldown of an honest cycle's START could be explained. When can that happen? The thief's sweep at t_thief, honest cycle starts at st ∈ [t_thief - half, t_thief + half]. If the honest cycle's sweep LANDED, then on-chain `last_sweep_at` after both is the later one. If the honest sweep landed at t_h ≈ st (no skew), and t_thief < t_h, then last_sweep_at = t_h, judged and explained by the honest cycle (|t_h - st| ≈ 0). The thief's sweep is masked — stated limit (only latest visible; left to the walk).

OK so the repair seems sound. Let me check the alarm's wiring of `landed`:

```js
const pendingSigs = (led?.cycles || []).filter(c => c.pendingSweepSig && !c.sweepSig).map(c => c.pendingSweepSig).slice(-50)
const landedSigs = new Set()
if (pendingSigs.length) {
  try {
    const st = await conn.getSignatureStatuses(pendingSigs, { searchTransactionHistory: true })
    st.value.forEach((v, i) => { if (v && !v.err && (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized')) landedSigs.add(pendingSigs[i]) })
  } catch { /* unknown: nothing confirmed, the loud direction */ }
}
```

OK. And `cooldownSeen`:

```js
const cooldownSeen = Math.min(...[prev?.sweepCooldownSeen, cfg['mint.sweep_cooldown_secs']].map(Number).filter(n => Number.isFinite(n) && n > 0), 21600)
```

Wait — `Math.min(...array, 21600)`. The spread of the filtered array plus 21600. So cooldownSeen = min(previous seen, current, 21600). The comment says "never above the ruled 6 h". Hmm, but the ruled cooldown is 21600 (6h) per launch/mainnet-init.json. And a vote can only LENGTHEN it. So the smallest ever seen is the right bound. But wait — is it true that a vote can only lengthen? Let me check MINT's tighten_sweep:

```rust
if let Some(x) = sweep_cooldown_secs {
    require!(x >= MIN_SWEEP_COOLDOWN_SECS && x <= c.cooldown_ceiling_secs, MintError::TightenOutOfBounds);
    c.sweep_cooldown_secs = c.sweep_cooldown_secs.max(x);
}
```

Yes, `.max(x)` — only lengthens. And GOV refuses a shorter one at creation (per the comment). So the cooldown only grows. The smallest ever seen is a lower bound on the current one... wait, no: the smallest ever seen is <= the current one (since it only grows). Judging with the smallest ever seen makes the window NARROWER (half of a smaller cooldown), which is the loud direction (a thief's sweep less likely to be explained). Good.

But hold on: `Math.min(..., 21600)` caps it at 21600. The ruled value IS 21600. So at launch, cooldownSeen = 21600. If a vote lengthens to 86400, cooldownSeen stays 21600 (smallest ever seen). Good.

Hmm, wait: there's an initialization subtlety. `prev?.sweepCooldownSeen` starts undefined. `Math.min(...[undefined, 21600].map(Number).filter(...), 21600)` = min(21600, 21600) = 21600. OK.

Now let me look for issues in the current tree more systematically. Let me go target by target.

**R1: The crank.**

Let me look at `planCrank` carefully.

The reveal loop:
```js
for (let i = BigInt(cfg.revealed_total); ; i++) {
  const r = byIndex.get(i)
  if (!r || r.level !== 0) break
  if (!(r.entropy_set || capturedThisPass.has(r.address))) break
  plan.reveal.push(r.address)
}
```

Reveals in mint order from revealed_total. OK.

Wait — there's a subtle issue. `byIndex` maps mint_index to record. If two records have the same mint_index (shouldn't happen on-chain), fine. 

The capture loop:
```js
for (const r of records) {
  if (r.level !== 0 || r.entropy_set) continue
  const rs = BigInt(r.reveal_slot)
  if (BigInt(slot) > rs + BigInt(L.REVEAL_WINDOW_SLOTS)) plan.reschedule.push(r.address)
  else if (slot > readySlot(r.reveal_slot)) { plan.capture.push(r.address); capturedThisPass.add(r.address) }
}
```

Hmm: `slot > readySlot(r.reveal_slot)`. readySlot(1000) = 1016 per the selftest. Let me verify: readySlot walks `a = (floor(a/4) + 2) * 4` twice. Start a=1000: (1000/4 + 2)*4 = (250+2)*4 = 1008. Then (1008/4+2)*4 = (252+2)*4 = 1016. So readySlot(1000) = 1016. The selftest asserts readySlot(1000) === 1016 and the comment says "two 4-slot leader groups past the last hash". 

Wait, but the actual MINT `try_capture` computes: A = first produced slot >= reveal_slot; then want = (slot/4 + 2)*4 for B; then same for C. So the slots needed are A (>= reveal_slot), B (>= (A/4+2)*4), C (>= (B/4+2)*4). The crank's readySlot approximates assuming A = reveal_slot (no skips). With skips, A > reveal_slot, so B and C are later, and readySlot underestimates. The comment says "Skipped slots only push it later, and a NotYet answer is harmless." OK, so capture might be planned slightly early and get RevealTooEarly (benign). Fine.

But there's an asymmetry: `slot > readySlot(...)` uses `slot` (a Number from `await conn.getSlot`) compared against readySlot(r.reveal_slot) where reveal_slot is BigInt → Number conversion. `readySlot(r.reveal_slot)` — reveal_slot is a BigInt from the decoded record. `Number(revealSlot)` inside readySlot. OK.

Hmm, `slot > readySlot(r.reveal_slot)` — slot is a JS number from getSlot. Fine.

Now the reveal ordering with the fast lane: the reveal lane runs every minute with `--reveal-only`, fetching only records with level == 0 (via memcmp filter). OK.

Let me look at the join/distribute logic for a subtle bug.

```js
const destOf = r => r.pending ? r.vault_ata : tokens[r.asset]?.address
```

For preJoins: `plan.preJoins.push([r.address, r.vault_ata])` — uses r.vault_ata directly. OK.

For joins after distribution:
```js
if (plan.distribute) {
  for (const r of records) {
    if (r.retired || r.active || !r.pending || assets[r.asset] !== 'live') continue
    if (BigInt(r.request_epoch) !== BigInt(cfg.dist_epoch)) continue
    const dest = destOf(r)
    if (dest) plan.joins.push([r.address, dest])
  }
}
```

These are vaults that requested in the CURRENT epoch (request_epoch === dist_epoch), which become eligible after this pass's distribution advances the epoch. OK.

But wait — the preJoins are vaults with `request_epoch < dist_epoch` (eligible from an earlier epoch). The joins are vaults with `request_epoch === dist_epoch` made eligible by THIS pass's distribution. And the distribution is only planned if `joinable` (no unreadable eligible vaults). OK.

Now the claims:

```js
if (poolOk && !pool.frozen) {
  const ready = []
  const preJoined = new Set(plan.preJoins.map(([a]) => a))
  ...
  for (const r of records) {
    const joinedNow = preJoined.has(r.address)
    if ((!r.active && !joinedNow) || r.retired) continue
    ...
  }
  ready.push(...plan.joins)
  for (let i = 0; i < ready.length; i += batch) plan.claims.push(ready.slice(i, i + batch))
}
```

Hmm — `ready.push(...plan.joins)` — the joins (vaults made eligible by this pass's distribution) are added to the claim batches. But wait: a vault that JOINS in a claim batch enters at the accumulator as it stands and is owed nothing. So including them in a claim batch is a no-op payment but performs the join. That's the point — joins happen inside claim batches. OK.

But there's a subtlety: the preJoins are sent as their OWN claim batches BEFORE the distribution (the "join batch" loop in main). And then they're ALSO included in the claims (joinedNow). Let me check: in main(), the preJoins are sent first:

```js
for (let i = 0; i < plan.preJoins.length; i += L.CLAIM_BATCH) { ... join batch ... }
```

Then distribute, then claims. The preJoined vaults are in `ready` via the main records loop (joinedNow = true), so they're delivered their share in the claims after the distribution. And the joins (this-pass eligible) are appended to ready. So a claim batch contains: active vaults owed + preJoined vaults (owed their share of this distribution) + joins (owed nothing, just joining). 

Wait, but there's an ordering issue WITHIN a claim batch. A claim batch is a single `claim` instruction with pairs. The program processes pairs in order. For a preJoined vault: it was joined in the earlier "join batch" transaction (before distribution), so by claim time it's active with debt = weight * acc_before_distribution. After the distribution, acc increased, so it's owed its share. Good.

For a join vault (this-pass eligible): it's still pending at claim time (the distribution ran, advancing the epoch, so dist_epoch > request_epoch now). The claim's join branch joins it at the current acc, owed nothing. Good.

Hmm, but here's a question: the preJoins are sent as separate join-batch transactions BEFORE the distribute. But the program's `claim` with a pending vault joins it only if `dist_epoch > request_epoch`. For preJoins (request_epoch < dist_epoch at plan time), that's satisfied. Good.

But WAIT. There's a potential double-join: a preJoined vault is in BOTH the preJoins join-batch AND the claims (as joinedNow, delivering its share). When the claim batch runs, the vault is already active (joined in the join batch), so the claim's `if r.pending` branch is skipped (it's active now), and it goes to the active branch and gets paid. Good, no issue.

Now, what about the owed computation for a joinedNow vault:

```js
if (joinedNow) owed = pendingSats({ level: r.level, debt: L.LEVEL_WEIGHTS[r.level - 1] * BigInt(cfg.acc_scaled) }, acc)
```

debt = weight * acc_scaled (the OLD acc, before this pass's distribution). acc = the post-distribution accumulator. So owed = weight * (acc_new - acc_old) / SCALE = its share of this distribution. Correct — a vault joining at acc_old earns from the next distribution, which is this one. 

Hmm wait, actually let me re-check the program semantics. When a vault joins (in the join batch, before the distribution), `join` sets `debt_scaled = w * acc` where acc is the accumulator AT JOIN TIME = acc_old (the distribution hasn't run yet in that transaction... wait, no).

Order of transactions in main():
1. reschedule, capture, reveal
2. retire
3. preJoins (join batches)
4. preExpires (expire boosts)
5. split
6. distribute
7. postExpires
8. activate
9. claims

So the join batch runs BEFORE distribute. At join time, acc = acc_old. join sets debt = w * acc_old. Then distribute advances acc to acc_new = acc_old + avail*SCALE/w_total. Then the claim pays the joined vault: owed = w * acc_new - debt = w * (acc_new - acc_old) = its share of this distribution. 

But wait — does the program's distribute count the newly-joined vault's weight? The distribution's `w` = total_active_weight at distribute time, which INCLUDES the newly joined vaults (they were joined in the join batch before distribute). So the distribution credits them. And the crank's plan: `const w = BigInt(cfg.total_active_weight) + preJoinWeight - retiringWeight - expiringWeight`. Yes, includes preJoinWeight. Good.

Hmm, but hold on: does the program REFUSE the distribution if a vault eligible to join is waiting (JoinWaitingFirst)? Yes. So the crank MUST join all eligible vaults before distributing. The crank sends preJoins for all eligible (request_epoch < dist_epoch) live vaults. If one is unreadable ('other'), `unreadableEligible++` and `joinable = false`, so no distribution is planned. Good.

But what if a preJoin batch FAILS (a real failure, not benign)? Then the distribution will be refused JoinWaitingFirst. The crank's `send` for the distribute: `judgeDistributeRefusal(lastFailure, cfg, fresh)` — JoinWaitingFirst with epoch unmoved → 'fail'. So it pages. Good, that's the intended behavior (the plan was wrong because the join failed).

Now let me look at the expiry logic.

```js
for (const r of records) {
  if (r.retired || !r.active || boostOf(r) === 0n || retiring.has(r.address)) continue
  if (BigInt(cfg.dist_epoch) >= BigInt(r.boost_end_epoch)) plan.preExpires.push(r.address)
}
```

A boost is due when `dist_epoch >= boost_end_epoch`. The program's `expire_boost` requires `c.dist_epoch >= r.boost_end_epoch`. So preExpires are boosts due NOW (before this pass's distribution). Good.

```js
if (plan.distribute) {
  for (const r of records) {
    if (r.retired || !r.active || boostOf(r) === 0n || retiring.has(r.address) || plan.preExpires.includes(r.address)) continue
    if (BigInt(r.boost_end_epoch) === BigInt(cfg.dist_epoch) + 1n) plan.postExpires.push(r.address)
  }
}
```

postExpires: boosts with `boost_end_epoch === dist_epoch + 1`, i.e., made due by this pass's distribution (which advances dist_epoch to dist_epoch+1). Good.

But wait — the program's gate is `boosts_due == 0` for distribute. `boosts_due` is a config counter. The crank computes due boosts from RECORDS (boost_end_epoch <= dist_epoch). Does the config's `boosts_due` counter match the records? It should if the program is correct. But the crank plans preExpires from records, and if the config's boosts_due is higher than what the records show (e.g., a record was retired, which calls unschedule_boost, decrementing boosts_due)... retire handles it. OK.

Hmm, actually there's a subtle issue: the crank's preExpires is computed from records with `boost_weight > 0` and `dist_epoch >= boost_end_epoch`. But the config's `boosts_due` is what's checked on-chain. If they disagree (a bug), the crank might not expire enough. But that's a program bug scenario. The alarm watches `boosts_stalled` from the config's boosts_due. OK.

Now, the expire batch: `L.EXPIRE_BATCH = 20`, and MINT's MAX_EXPIRE_BATCH is 30. The selftest asserts EXPIRE_BATCH <= MAX_EXPIRE_BATCH. The expiry-budget test proves 20 fit under the default CU. OK.

Let me look at the reveal rent budgeting.

`REVEAL_RENT_LAMPORTS = 16n * 6_960n` = 111,360 lamports. The comment says "up to 16 bytes at 6,960 lamports/byte". Hmm, 6,960 lamports/byte is the rent rate on the test validator (890,880 / 128 ≈ 6,960). On mainnet it's lower (650,240 / 128 ≈ 5,080). So the crank over-budgets, which is safe. OK.

`planCostLamports`: counts transactions. Let me check the batch ceilings: `ceil(p.preJoins.length, L.CLAIM_BATCH)` — preJoins are sent in batches of CLAIM_BATCH. `ceil(p.preExpires.length, L.EXPIRE_BATCH)` etc. And `p.claims.length` is already batches. And `p.reveal.length` individual. OK.

Wait, there's a subtle issue in planCostLamports: `p.claims.length` counts claim batches, but the joins are folded INTO the claims (ready.push(...plan.joins)). So claims.length includes the join deliveries. And preJoins are separate. OK, matches main()'s sends: preJoins batches + claims batches. Good.

Now `budgetPlan`:

```js
export function budgetPlan(plan, lamports, { ceiling = FEE_CEILING_LAMPORTS, floor = FEE_FLOOR_LAMPORTS } = {}) {
  const base = { ...plan, reveal: [] }
  const baseJ = judgeFeePayer(lamports, { ceiling, floor: 0n, need: planCostLamports(base) })
  if (!baseJ.ok) return { ok: false, ... }
  const room = BigInt(lamports) - planCostLamports(base) - BigInt(floor)
  const n = room > 0n ? Number(room / (SIG_FEE_LAMPORTS + REVEAL_RENT_LAMPORTS)) : 0
  const keep = Math.max(0, Math.min(plan.reveal.length, n))
  ...
}
```

So the base plan (everything but reveals) must be covered; reveals are budgeted by the room above the floor. OK.

Hmm, `judgeFeePayer(lamports, { ceiling, floor: 0n, need: planCostLamports(base) })` — floor 0, so min = max(need, 0) = need. If lamports < need, not ok. If lamports > ceiling, warn. OK.

Now let me look at the reveal send loop in main() for ordering issues:

```js
for (const a of plan.reveal) {
  const r = byAddr.get(a)
  let list = []
  const how = revealAttrSource(assets[r.asset])
  if (how === 'skip') { ...; break }
  if (how === 'read') {
    try { list = await mintedAttributes(conn, P(r.asset)) }
    catch (e) { ...; break }
    const j = judgeRevealAttrs(list, r.attrs_hash)
    if (j === 'revealed') { ...; break }
    if (j === 'mismatch') { failures.push(...); break }
  }
  const ok = await send(`reveal #${r.mint_index} ${r.asset}`, [...])
  if (ok === 'fail') { failures.push(...); break }
  if (ok === 'benign') break
}
```

Reveals strictly in order, stop at first failure/skip. OK.

Hmm — one issue: `judgeRevealAttrs` returns 'revealed' if the list carries `level` and without it hashes to the stored hash. But what if the asset was revealed by traffic with a DIFFERENT level than the draw would give? No — the level is computed by the program from the stored entropy; the reveal writes it. The attributes hash check ensures the minted attributes match. If revealed elsewhere, the record's level is set, and the next pass won't plan it (r.level !== 0). OK.

Now, the crank's `mintedAttributes` uses `deserializeAssetV1` from mpl-core. If Core adds an unknown plugin type, the deserializer might throw (round 33 C22 noted this as accepted limit 40 boundary). The catch breaks the reveal run. OK, loud.

Let me now check the alarm more carefully.

**R2: The alarm.**

Let me look at the scan loop and cursor advancement.

```js
const sigs = walked.sigs.slice(0, PER_PROGRAM_READS), gap = walked.gap || walked.sigs.length > PER_PROGRAM_READS
```

Wait — `walked.sigs.length > PER_PROGRAM_READS`: walked.sigs is the raw walk result (up to maxPages * 1000 = 20,000). If it exceeds PER_PROGRAM_READS (2000), gap is true even if the walk itself didn't gap. Then `sigs` is the first 2000. The backlog records `before: sigs[sigs.length - 1].signature` (the 2000th). OK.

Hmm, but `walkSigs` is called with `Math.min(20, Math.ceil(PER_PROGRAM_READS / 1000))` pages. For PER_PROGRAM_READS=2000, that's 2 pages = 2000 signatures max. So walked.sigs.length <= 2000, and `walked.sigs.length > PER_PROGRAM_READS` is never true (2000 > 2000 false). So gap comes only from walked.gap (the walk hit 2 pages without reaching the cursor). OK.

Wait, `Math.ceil(2000/1000) = 2`, `Math.min(20, 2) = 2`. So maxPages=2, limit=1000. The walk reads up to 2000. If there are more than 2000 new transactions, the second page is full (1000) and the walk returns gap:true. Then sigs = all 2000. backlog.before = sigs[1999]. Next pass resumes from there. OK.

Now the cursor advancement:

```js
if (!unread) {
  if (gap) backlogs[id] = { head: backlog?.head ?? sigs[0].signature, before: sigs[sigs.length - 1].signature }
  else if (sigs.length) { cursors[id] = backlog?.head ?? sigs[0].signature; delete backlogs[id] }
  else if (backlog) { ... }
}
```

If gap: record backlog (head = newest of the backlog, before = oldest read this pass). Cursor stays. If no gap and sigs: cursor = backlog head (if draining) or newest sig; delete backlog. If no sigs and backlog: prove drain.

Hmm, wait: when draining, `walkSigs(conn, prog, cursors[id], ..., backlog?.before)`. The walk goes from backlog.before backwards (older) toward the cursor (until). So it reads OLDER transactions. When it finally reaches the cursor (no gap, meaning the walk reached `until`), sigs is the final batch. Then `cursors[id] = backlog?.head ?? sigs[0].signature` — the backlog head is the newest signature of the whole backlog. So the cursor jumps to the head. Good.

But subtle: when draining and the walk returns sigs (not empty) with no gap, that means it reached the cursor. `cursors[id] = backlog?.head ?? ...`. backlog.head is set. Good.

When the resumed walk comes back EMPTY (sigs.length === 0) with a backlog: the proof check. `below = getSignaturesForAddress(prog, { before: backlog.before, limit: 1 })`. If cursors[id] exists, proven = below[0].signature === cursors[id]. So the signature right below (older than) backlog.before must be the cursor. That means the backlog has drained to the cursor. Then cursor = backlog.head. OK.

Hmm, but there's a subtle issue: `getSignaturesForAddress(prog, { before: backlog.before, limit: 1 })` returns the signature immediately OLDER than backlog.before. If that's the cursor, the backlog is drained. But what if backlog.before IS the cursor's next... actually this seems right.

Now, one concern: the `until` parameter in the walk. `signaturesSince(conn, prog, cursors[id], ...)`. The `until` is the cursor — the walk stops AT the cursor (exclusive). So the walk reads transactions NEWER than... wait, no. Let me re-read sigwalk:

```js
export async function signaturesSince(conn, address, until, maxPages = 20, limit = 1000, startBefore = undefined) {
  const out = []
  let before = startBefore
  for (let p = 0; p < maxPages; p++) {
    const batch = await conn.getSignaturesForAddress(address,
      { limit, ...(before ? { before } : {}), ...(until ? { until } : {}) }, 'confirmed')
    out.push(...batch)
    if (batch.length < limit) return { sigs: out, gap: false, pages: p + 1 }
    before = batch[batch.length - 1].signature
  }
  return { sigs: out, gap: true, pages: maxPages }
}
```

So it pages backwards (newest first) from `before` (or the latest) until `until` (the cursor, exclusive) or a short page. If it fills maxPages without a short page, gap. OK.

The RPC's `until`: "start searching backwards from the provided signature... until this signature is reached". Actually, `until` means the search stops when it reaches that signature (it's excluded). And `before` means start before this signature. So the walk reads signatures in (until, before] roughly, newest first. OK.

Now, a concern: when there's no cursor (first pass) and no backlog, the walk reads the newest 2000 and stops (gap if more). cursors[id] = sigs[0].signature (newest). So the first pass only reads the newest 2000 and sets the cursor there — older history is never read. That's a known boundary (the alarm watches from when it starts). OK, stated.

Let me look at the detectors for the money path.

`detectUnledgeredSweeps`: reads sweep instructions, matches against ledger by signature. The amount is read from the instruction data (bytes 8..16, little-endian u64). Let me verify: `for (let i = 7; i >= 0; i--) onchain = (onchain << 8n) | BigInt(d[8 + i])`. So d[8..16] little-endian. The sweep instruction data is `disc(8) + u64 amount`. Yes. OK.

`revenueOutflow`: sums transfers whose source is the revenue ATA. OK.

Now the split detection in the alarm:

```js
if (ixs.some(ix => ix.program === MINT.toBase58() && ix.dataBytes
    && IX_SPLIT.every((b, i) => ix.dataBytes[i] === b)
    && ix.accounts?.[2] === payment.toBase58())) {
  seenSplits.push({ sig: s.signature, blockTime: s.blockTime ?? null,
    total: String(D.revenueOutflow(ixs, REVENUE_ATA.toBase58())) })
}
```

It checks the split instruction names the payment mint at accounts[2]. SplitRevenue accounts: config(0), revenue(1), mint(2), revenue_ata(3), holders_ata(4), bank_ata(5), token_program(6). So accounts[2] is the mint. OK. And the total is the outflow from the revenue ATA. OK.

Hmm, but `ixs.some(...)` — this checks top-level AND inner instructions (normaliseTx flattens). A split is a top-level instruction. Could a split appear as an inner instruction? Only via CPI, which nobody does. OK.

Now let me look at a potential issue: the `detectSplitClaims` and the `closesCycle` anchor.

`closesCycle(c, splits, { exclude, upTo })`: finds the first split at or after the return (anchored on returnBlockTime if present, else returnedAt - 60s) with total >= returnedSats. OK.

Round 33's repair to `detectSweepState` — let me look for a subtle issue with the `landed` set and the grace.

Actually, let me look at the alarm's `detectSweepState` call:

```js
const sweepState = D.detectSweepState({ judgedThrough: prev?.sweepJudgedThrough, lastSweepAt: cfg['mint.last_sweep_at'], ledger: led, nowSec, cooldownSecs: cooldownSeen, landed: landedSigs })
```

`nowSec` is the chain clock. `lastSweepAt` is chain. `startedAt` is box. The window `|t - st| <= half` mixes chain (t) and box (st). With skew up to half (3h at 6h cooldown), tolerated. OK, that's the repair.

But wait — the grace: `if (Number(nowSec) - t < graceSecs) return ...`. nowSec is chain, t is chain. Good, same domain.

Hmm, but there's a subtle issue: `judgedThrough` starts undefined → `from = 0`. First pass: if last_sweep_at > 0 and nowSec - t >= grace, it judges. The comment says "the first pass only takes the baseline" — but the code judges if t > 0 and past grace. Wait:

```js
const from = Number(judgedThrough ?? 0)
if (!(t > from)) return { findings: [], judged: from }
if (Number(nowSec) - t < graceSecs) return { findings: [], judged: from }
```

So on the first pass (from=0), if there's a sweep at t (past grace), it judges it. The comment in the code says "The first pass only takes the baseline" — but that's only true if t == 0 (never swept). If a sweep exists before the alarm first runs, it's judged (and if no ledger cycle explains it, pages). Hmm, is that right? The review-32 comment says "a missing baseline is 0, so the first pass JUDGES the latest sweep". So the behavior changed: first pass judges. The selftest arm: `first(cyc({sweepSig:'s'}))` = 0 (explained), `first(null)` = 1 (no ledger → pages). OK, so first pass with a sweep and no ledger pages CRITICAL. That's the intended behavior (a sweep with no ledger row is suspicious). But at LAUNCH, before any sweep, last_sweep_at = 0, so from stays 0. Fine.

Now, is there a false-positive risk at launch? The first revenue cycle's sweep: revenue.mjs writes a cycle row with startedAt (box time) and sweepSig. The alarm reads it. `|t - st| <= half` — t is chain time of the sweep, st is box time of cycle start. The sweep lands seconds after the cycle starts. So |t - st| is small. Explained. Good.

But what if the box clock is significantly off from the chain? E.g., box 1 hour ahead. Then st = t + 3600. |t - st| = 3600 <= 10800. Explained. Good. Box 4 hours ahead: st = t + 14400 > 10800. Not explained → false CRITICAL. But 4-hour clock skew is a broken box. The round-33 repair tolerates up to half the cooldown (3h). Acceptable.

Now let me look at the swap more carefully — that's R5, the meat.

**R5: The swap.**

`oracleFloor`:
```js
const e = sol.expo - btc.expo
let num = BigInt(lamportsIn) * sol.price, den = btc.price * 10n
if (e >= 0) num *= 10n ** BigInt(e); else den *= 10n ** BigInt(-e)
const expectedSats = num / den
const minSats = expectedSats * BigInt(10_000 - SWAP_TOLERANCE_BPS) / 10_000n
```

sats = lamports * sol_price * 10^sol_expo / (btc_price * 10^btc_expo) * 1e8 / 1e9
     = lamports * sol_price * 10^(sol_expo - btc_expo) / (btc_price * 10)

Let me verify: SOL/USD = sol.price * 10^sol.expo. BTC/USD = btc.price * 10^btc.expo. lamports / 1e9 SOL * SOL/USD = USD. USD / BTC/USD = BTC. BTC * 1e8 = sats. So sats = lamports * sol.price * 10^sol.expo / (1e9) / (btc.price * 10^btc.expo) * 1e8 = lamports * sol.price * 10^(sol.expo - btc.expo) / (btc.price * 10). Yes, the formula is right. Both expos are -8, so e = 0, num = lamports * sol.price, den = btc.price * 10. OK.

Rounding: integer division floors. expectedSats is floored. minSats = expectedSats * 9850 / 10000, floored again. So minSats is below the true expectation. Good (floor direction).

`satsPerLamport: Number(sol.price) * 10 ** sol.expo / (Number(btc.price) * 10 ** btc.expo) / 10`. This is a float, used only for the deviation filter (comparing pool spot to oracle). Float precision ~1e-16 relative, fine against a 100 bps gate. OK.

Now `readPyth`:
```js
let o = 8 + 32
const level = d[o]
if (level !== 1) throw ...
o += 1
const feed = d.subarray(o, o + 32).toString('hex'); o += 32
const price = d.readBigInt64LE(o), conf = d.readBigUInt64LE(o + 8), expo = d.readInt32LE(o + 16)
const publishTime = Number(d.readBigInt64LE(o + 20))
```

PriceUpdateV2 layout: 8-byte discriminator, write_authority (32), verification_level (enum: Partial = tag 0 + u8, Full = tag 1). So at offset 40: the tag. Full = 1. Then the PriceFeedMessage: feed_id (32), price (i64), conf (u64), exponent (i32), publish_time (i64). 

Wait — the comment says "verification_level (Partial = tag + u8, Full = tag)". So Partial is 2 bytes (tag 0 + num proofs u8), Full is 1 byte (tag 1). The code reads `level = d[o]` at o=40, checks == 1 (Full), then o += 1 → 41. Then feed at 41..73. price at 73. conf at 81. expo at 89. publish_time at 93. 

The selftest's pythAcc fixture: `d[40] = 1; Buffer.from(feed, 'hex').copy(d, 41); d.writeBigInt64LE(price, 73); d.writeBigUInt64LE(conf, 81); d.writeInt32LE(-8, 89); d.writeBigInt64LE(BigInt(publishTime), 93)`. Consistent. And the fork test reads the real Pyth accounts and it works (16 assertions pass). So the offsets are proven against the real account. OK.

But the question R5(b) asks: "Is ownership plus a derived address sufficient, or can anyone write a fully-verified update with an old publish_time or a chosen price into that account?"

The account is derived as the sponsored feed PDA (shard 0, under the push-oracle program). It's OWNED by the receiver program. Only the Pyth programs can write it (the push oracle writes updates via the receiver). The derivation pins the feed id (the seed includes the feed id). So the account at that PDA can only carry that feed's updates. The verification level Full means Wormhole-verified. The publish_time is checked for staleness (180s) and future (30s) against the chain clock. So a stale price is refused. A chosen price would require breaking Pyth's Wormhole verification. That's the trusted-third-party boundary (stated). OK.

Now, is there a subtle issue: the account is derived with `Buffer.alloc(2)` as the shard (2 zero bytes) and the feed id. Let me check: `PublicKey.findProgramAddressSync([Buffer.alloc(2), Buffer.from(feedHex, 'hex')], PYTH.push)`. The sponsored feed PDA is derived under the PUSH oracle program (pythWSnsw...), with seeds [shard (2 bytes), feed_id (32)]. Shard 0 = two zero bytes. The comment says "sponsored feed PDA, shard 0, under the push-oracle program". And the account is owned by the RECEIVER program (rec5EKM...). So the PDA is derived under push, but owned by receiver. That's the Pyth sponsored-feed arrangement: the push oracle program creates the account (so it's a PDA of push), but ownership is transferred to the receiver. The fork test reads the real accounts and they pass readPyth (owner == receiver). OK, proven.

Now the deviation filter:

`orcaSpot = (sqrtPrice / 2^64)^2`. The Whirlpool's sqrt_price is Q64.64 of the price of token B in token A (raw units). Wait — Orca's sqrt_price is the square root of the price of token B per token A, in raw units, Q64.64. Token A is wSOL (9 decimals), token B is cbBTC (8 decimals). So price = (sqrt_price/2^64)^2 = raw B per raw A = sats per lamport. Yes, orcaSpot gives sats per lamport. And satsPerLamport from the oracle is the same quantity. So the deviation is computed on the same quantity. OK.

`meteoraSpot = 1 / (1 + binStep/10000)^activeId`. The DLMM prices X in Y: price = (1 + bin_step/10000)^active_id = Y per X (raw). X is cbBTC (8 dec), Y is wSOL (9 dec). So price = lamports per sat. The inverse is sats per lamport. meteoraSpot = 1/price = sats per lamport. Same quantity as the oracle. OK.

The deviation filter: `deviationBps(pool, oracle) = |pool - oracle| / oracle * 10000`. Both floats. Fine.

Now the minimum out:

Orca: `other_amount_threshold` = minSats (the floor). For an exact-input a_to_b swap, other_amount_threshold is the minimum amount of token B out. The instruction data: disc(8) + amount u64 (8) + other_amount_threshold u64 (8) + sqrt_price_limit u128 (16) + exact_in bool (1) + a_to_b bool (1) = 42 bytes. The builder: `Buffer.concat([disc('swap'), u64(lamportsIn), u64(minSats), u128(ORCA_MIN_SQRT_PRICE), Buffer.from([1, 1])])`. So amount = lamportsIn, threshold = minSats, sqrt_price_limit = MIN (4295048016), exact_input = 1, a_to_b = 1. OK.

Wait — is ORCA_MIN_SQRT_PRICE correct? 4295048016 is the known MIN_SQRT_PRICE for Orca Whirlpools. For an a_to_b swap (price decreasing), the limit is the minimum sqrt price, so setting it to the absolute minimum allows the swap to go as far down as needed. The floor is enforced by other_amount_threshold. OK.

Meteora: `min_amount_out` = minSats. Data: disc(8) + amount_in u64 (8) + min_amount_out u64 (8) = 24 bytes. OK.

Now the judge. Let me look at `judgeSwapInstructions` very carefully, since R5(e) asks specific questions.

The seven instructions:
0. ComputeBudget setComputeUnitLimit(400000)
1. ATA CreateIdempotent for wSOL
2. System transfer owner → ownerWsol of lamportsIn
3. SyncNative(ownerWsol)
4. ATA CreateIdempotent for cbBTC
5. swap
6. CloseAccount(ownerWsol → owner, owner)

The judge checks:
- All programs in allowed set (ComputeBudget, System, Token, ATA, venue).
- No second signer.
- No priority fee (ComputeBudget data[0] === 3 refused).
- Token instructions only SyncNative (17) and CloseAccount (9).
- Exactly 7 instructions.
- Exactly 1 swap, 1 System transfer.
- Instruction 0 is SetComputeUnitLimit(400000) with no keys.
- Instructions 1 and 4 create the operator's own ATAs (payer owner, account ata(mint, owner), owner, mint, system, token).
- Instruction 2 is a System transfer from owner to ownWsol of exactly lamportsIn.
- Instruction 3 is SyncNative of ownWsol.
- Instruction 5 is the venue swap with amount lamportsIn, threshold minSats, Orca direction/price pinned, pool pinned, input ownWsol (key 3 Orca / key 4 Meteora), output ownCbbtc (key 5), signed by owner in authority slot (key 1 Orca / key 10 Meteora).
- Instruction 6 is CloseAccount(ownWsol → owner, owner), exactly one close.

R5(e) asks: does it check the swap's OUTPUT account is the operator's own cbBTC account? Yes: `if (!keyAt(sw, 5)?.equals(ownCbbtc))`. The swap's minimum-out bytes? Yes: `d.readBigUInt64LE(16) !== floor`. The direction byte? For Orca: `d[40] !== 1 || d[41] !== 1` (exact_input, a_to_b). The amount? Yes. ComputeBudget fee drain? Yes: refuses setComputeUnitPrice. The two ATA creations create the accounts they claim? Yes: ataOk checks payer=owner, account=ata(mint, owner), owner=owner, mint.

What could a tampered builder still route past it? The judge requires the EXACT 7-instruction sequence. A tampered builder that produces a different sequence is refused. But the judge is in the same tree (accepted limit 10(c)). 

Hmm, wait. Let me look for a subtle issue. The judge checks `ixs.length !== 7`. And it destructures `const [cu, cw, wrap, sync, cc, sw, close] = ixs`. If ixs has 7 elements but in a different order, the positional checks catch it. OK.

One thing: the judge checks the swap's OUTPUT is ownCbbtc at key 5 for BOTH venues (`keyAt(sw, 5)`). For Orca, key 5 is ownerCbbtc (token_owner_account_b). For Meteora, key 5 is user_token_out (ownerCbbtc). Let me verify the Meteora key order:

```js
keys: [
  { pubkey: METEORA.pool, ... },        // 0 lb_pair
  opt(mPda('bitmap', ...), ...),         // 1 bin_array_bitmap_extension
  { pubkey: p.reserveX, ... },           // 2 reserve_x
  { pubkey: p.reserveY, ... },           // 3 reserve_y
  { pubkey: ownerWsol, ... },            // 4 user_token_in
  { pubkey: ownerCbbtc, ... },           // 5 user_token_out
  { pubkey: p.mintX, ... },              // 6 token_x_mint
  { pubkey: p.mintY, ... },              // 7 token_y_mint
  { pubkey: mPda('oracle', ...), ... },  // 8 oracle
  opt(null, false),                      // 9 host_fee_in (None)
  { pubkey: owner, isSigner: true, ... },// 10 user
  { pubkey: TOKEN, ... },                // 11 token_x_program
  { pubkey: TOKEN, ... },                // 12 token_y_program
  { pubkey: mPda('__event_authority'), ... }, // 13 event_authority
  { pubkey: METEORA.program, ... },      // 14 program
  ...bin arrays                          // 15,16,17 remaining
]
```

So Meteora key 4 is user_token_in (wSOL), key 5 is user_token_out (cbBTC). The judge: `keyAt(sw, orca ? 3 : 4)` for input (Orca key 3 = ownerWsol, Meteora key 4 = ownerWsol). `keyAt(sw, 5)` for output. Signer at `orca ? 1 : 10`. OK.

Now, the Meteora swap direction: selling wSOL (Y) for cbBTC (X) is Y→X. The DLMM `swap` instruction takes user_token_in and user_token_out; the direction is determined by which is X and which is Y. Since user_token_in = wSOL = Y and user_token_out = cbBTC = X, it's a Y→X swap. The program infers swap_for_y = false (swapping Y for X). OK. The judge checks input is wSOL and output is cbBTC, which pins the direction. Good.

Now, R5(f): account derivation.

Orca tick arrays: `orcaTickArrayStarts(tickCurrent, tickSpacing)` returns [s0, s0 - span, s0 - 2*span] where span = 88 * tickSpacing, s0 = floor(tickCurrent/span)*span. For an a_to_b swap (price down, tick down), the arrays crossed are the current and the ones below. OK.

The tick array PDA: `findProgramAddressSync([Buffer.from('tick_array'), ORCA.pool.toBuffer(), Buffer.from(String(start))], ORCA.program)`. The seed is the start tick as a DECIMAL STRING (Orca's convention: `start_tick.to_string()`). OK.

The oracle PDA: `[Buffer.from('oracle'), ORCA.pool.toBuffer()]` under ORCA.program. OK.

Meteora bin arrays: `meteoraBinArrayIndexes(activeId)` = [i, i+1, i+2] where i = floor(activeId/70). For a Y→X swap (buying X, active bin moves UP), the arrays are the current and the two above. OK.

The bin array PDA: `[Buffer.from('bin_array'), METEORA.pool.toBuffer(), i64 LE of index]` under METEORA.program. `meteoraBinArray(i)` writes BigInt(i) as 8-byte LE. OK.

The bitmap extension: `mPda('bitmap', METEORA.pool)` — seeds ['bitmap', pool]. Passed as the program id if not present (Anchor None). OK.

The event authority: `mPda('__event_authority')` — seed ['__event_authority'] under METEORA.program. OK.

What happens at a tick-array boundary or an uninitialised array? The fork test clones the real arrays and swaps succeed. If a swap crosses into an uninitialised array, the program refuses (loud, cycle stays open). The deviation filter and floor bound the price movement, so a swap near the boundary... hmm. Actually, the swap might legitimately need an array that's not initialised if the price moves far. But the floor (150 bps) bounds how far the price can move before the swap refuses. If the swap would cross into an uninitialised array, the program errors (refused), the cycle stays open, Meteora is tried (if Orca refused). OK, loud not silent.

Now R5(g): wSOL handling.

The swap wraps exactly lamportsIn, syncs, swaps, closes. If the operator's wSOL ATA already exists with a balance: CreateIdempotent is a no-op (account exists), the wrap adds lamportsIn, sync updates, swap consumes lamportsIn (exact input), close returns the remaining (pre-existing balance + rent) to the operator. So a pre-existing balance is returned, not lost. Round 31 measured this (C01 refuted: a stranger-funded wSOL ATA with 1 unit lets the cycle land and returns the dust). And round 33's gate-5 added R33.G4: a stranger's pre-filled wSOL account closes under the swap's own instructions, returning the stranger's lamports to the operator. OK.

If the wSOL ATA is frozen: SyncNative or the swap's transfer would fail → the swap refuses → cycle stays open. Loud. If it has a delegate: the delegate could front-run... hmm. Actually, if someone holds a delegate on the operator's wSOL ATA, they could transfer the wSOL out before the swap. But the operator's ATA is derived from the operator key; a delegate requires the operator to have approved someone. The operator key only runs revenue.mjs, which never approves. So no delegate. But a stranger can't set a delegate on the operator's account (needs the owner's signature). OK.

What is left behind if the swap consumes less than the input? The swap is exact-input (Orca exact_input=1, Meteora amount_in), so it consumes exactly lamportsIn. Nothing left but the pre-existing balance and rent, which close returns. OK.

R5(h): failure and retry.

Orca first; Meteora only if Orca was REFUSED (on-chain error or failed preflight), never on an unconfirmed send. `classifySendFailure`: preflight refusal → refused; landed+err → refused; expired+no status → refused; landed+success → landed; else unknown. On 'unknown', the cycle stops open (never tries another venue). On 'refused', tries next venue. On 'landed', records and breaks.

Can a confirmation timeout on a swap that later lands lead to a second swap? On timeout (unknown), the code throws, cycle stays open, no second swap. The open-cycle guard prevents a new cycle. Hand recovery required. OK.

Does every path leave the ledger open until a cbBTC return is proven? The cycle is closed only when returnedSats > 0 AND (splitSig or splitByOther). The return is recorded only after the swap lands and the delta >= floor. OK.

Hmm, wait. Let me look at the return step:

```js
const after = requireTokenAmount(await conn.getAccountInfo(opAta, 'confirmed'), ...)
const delta = after > opBefore ? after - opBefore : 0n
if (delta < guaranteed) throw ...
const got = after
cycle.returnSig = await sendAndConfirmTransaction(... createAssociatedTokenAccountIdempotent(revAta) + transferChecked(opAta → revAta, got, 8) ...)
cycle.returnedSats = String(delta)
```

So the return transfers the WHOLE balance (got = after), but records only the delta. The delta check ensures the swap produced >= floor. OK.

But there's a subtle issue: `opBefore` is measured BEFORE the sweep (in the prepare stage). Between then and the return, the operator's cbBTC ATA could receive cbBTC from another source (a stranger sends cbBTC to the operator's ATA). Then delta = after - opBefore includes the stranger's cbBTC, inflating it. But that only makes the delta LARGER, so the floor check passes more easily — a stranger could mask a short swap by sending cbBTC to the operator's ATA. Hmm. But why would a stranger do that? To make a failing cycle look successful? The operator key holder could do it to mask keeping some of the SOL... but the operator key holder would have to buy cbBTC to cover the shortfall, which costs them. Not an extraction. The alarm's `short_swap_return` holds the return to the quote (2% tolerance). OK, bounded.

Actually wait, there's a more subtle issue. The `opBefore` is read in the prepare stage, and the ATA is created if absent. Then the sweep happens, then the swap. If the swap lands but the delta read is stale (a stale balance read after a landed swap — round 33 C16 noted this), the delta might under-read, the cycle throws, stays open, pages. Loud. OK.

R5(i): what an adversary can extract within the tolerance.

100 bps deviation gate, 150 bps floor. A sandwich: the swap enforces minSats on chain, so a sandwich can take at most (oracle_expected - minSats) = 150 bps of the expected output, plus the pool fee and impact already accounted. Actually, the floor is 150 bps under the oracle's expected output. The pool's actual output at the oracle price would be expected minus fee (16 bps Orca) minus impact. So the adversary's room is roughly 150 bps - fee - impact of moving the price against the swap. Per cycle (10 SOL cap), 150 bps of ~$1,200 (10 SOL at $120) = ~$18. Per month (4 sweeps/day * 30 = 120 sweeps), ~$2,160. But the deviation filter skips a pool more than 100 bps from the oracle, so the adversary must keep the pool within 100 bps at the read, then move it. The floor still binds at execution. So the extraction is bounded by the 150 bps floor. The cycle size (10 SOL) makes this small. The holder guide discloses "up to 1.5% below Pyth's price". OK, bounded and disclosed.

Now the operator key's worst case: it trusts the two pool programs and the oracle (not an HTTP reply). The judge is the last line before signing. The post-swap delta check catches a misroute after signing. The ledger stays open until a return is proven. OK.

Let me now look at the revenue cycle's open-cycle guard and recovery more carefully.

```js
const open = (led.cycles || []).filter(cycleIsOpen)
if (open.length) throw ...
```

So a new cycle refuses while one is open. Good.

The recovery: for returnedUnsplit cycles, it tries to close them via closesCycle (chain evidence) or the provably-empty proof. Then the open guard. OK.

Hmm, wait. Let me look at the sweep's catch:

```js
} catch (e) {
  const verdict = await SW.classifySendFailure(e, statusOf(conn))
  if (verdict.outcome === 'refused') {
    cycle.sendRejected = true
    if (verdict.sig) cycle.refusedSig = verdict.sig
    cycle.error = ...
    save(led)
    throw ...
  }
  if (verdict.outcome !== 'landed') {
    rememberAttempt(cycle, 'Sweep', e, led)
    throw e
  }
  cycle.sweepSig = verdict.sig
  console.log(...)
}
cycle.sweptLamports = String(amount); save(led)
```

So a refused sweep: sendRejected = true, cycle closed (cycleIsOpen returns false for sendRejected). An unknown: rememberAttempt records pendingSweepSig, throws, cycle stays open (intendedLamports set, no returnedSats). A landed: sweepSig set, continues. OK.

Now, the alarm's `detectSweepState` explains a sweep by a cycle with sweepSig OR (pendingSweepSig AND landed). The `landed` set is computed by the alarm's direct getSignatureStatuses lookup. So an uncertain send that landed explains the sweep. Good.

But here's a subtle issue: revenue.mjs's `classifySendFailure` on the sweep uses `statusOf(conn)` which is also getSignatureStatuses. If it says 'landed', sweepSig is set. If 'unknown', pendingSweepSig is set and the cycle is open. The alarm later checks pendingSweepSig via its own lookup; if landed, explains. Consistent.

Now let me look at the crank's `mintFailureCode` and the BENIGN handling for a subtle issue.

```js
export async function mintFailureCode(error, conn, { timeoutMs = 5000 } = {}) {
  let logs = error?.logs
  if ((!Array.isArray(logs) || !logs.length) && typeof error?.getLogs === 'function') {
    ... logs = await Promise.race([error.getLogs(conn), timeout]) ...
  }
  const stack = []
  let code = null
  for (const line of ...) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line)
    if (invoke) { stack.push(invoke[1]); continue }
    const anchor = /^Program log: AnchorError\b.*\bError Code: (\w+)\./.exec(line)
    if (anchor && stack.at(-1) === L.PROGRAM_IDS.mint) code = anchor[1]
    const end = /^Program (\w+) (success|failed:.*)$/.exec(line)
    if (end) {
      if (stack.at(-1) !== end[1]) return null
      stack.pop()
      if (end[1] === L.PROGRAM_IDS.mint && end[2].startsWith('failed:')) return code
      if (end[1] === L.PROGRAM_IDS.mint) code = null
    }
  }
  return null
}
```

This parses the invoke stack to attribute an AnchorError to MINT. Only a MINT error code is returned. The BENIGN regex is then tested against the code. The selftest proves a foreign same-named code doesn't masquerade. OK.

Hmm, but there's a subtlety: the regex `/^Program (\w+) invoke \[\d+\]$/` — `\w+` matches alphanumeric and underscore. A program id is base58, which includes those. OK. And the AnchorError regex requires `Error Code: (\w+)\.`. OK.

Now, one concern: the crank's `send` uses `sendAndConfirmTransaction`, which on a confirmation failure throws a SendTransactionError. `mintFailureCode` retrieves logs. If the error is a race (AlreadyCaptured etc.), benign. But what about a confirmation TIMEOUT where the transaction actually landed? `sendAndConfirmTransaction` throws TransactionExpiredBlockheightExceededError or a timeout. The logs might be unavailable. `mintFailureCode` returns null → 'fail'. So a capture that landed but timed out is a 'fail' → pages. Hmm, but the next pass would see it as already captured (benign). So one false page per timeout. The crank's failures page each pass. Acceptable (loud, self-correcting).

Actually wait — is this a problem? A capture that lands but times out pages "action failed" once, then next pass it's benign. The alarm's `crank_failing` needs 3 consecutive passes with failures. A single timeout doesn't trip it. OK.

Let me now look at the layouts (R3).

`parseRustStruct` parses `pub struct NAME { ... }`. The selftest asserts each STRUCTS entry equals the parsed Rust. Let me check the MintConfig fields against the Rust struct.

The Rust MintConfig:
```
version, collection, governance, pool_ata, round_id, opens_at, closes_at, price, cap, minted_this_round, minted_total, max_supply, bank_treasury, split_bps, sales_stopped, sweep_stopped, guardian, swap_operator, sol_reserve_lamports, bump, max_sweep_lamports, sweep_cooldown_secs, last_sweep_at, level_caps, level_minted, revealed_total, payment_mint, pob_collection, pob_root, charter_opens_at, charter_closes_at, charter_claimed, bare_burns_retired, total_active_weight, active_count, acc_scaled, owed_scaled, last_distribute_at, sales_stopped_at, sweep_stopped_at, pending_swap_operator, pending_swap_operator_at, monthly_secs, pending_guardian, pending_guardian_set, pending_guardian_at, notice_secs, sweep_floor_lamports, cooldown_ceiling_secs, reserve_ceiling_lamports, dist_epoch, pending_count, pending_this_epoch, cbob_mint, max_boost_weight, max_boost_epochs, boost_price, boost_weight, boost_epochs, boosts_active, boosts_due, boost_weight_total, cbob_burned_total, boost_expiring
```

The layout.mjs MintConfig fields match this order. Let me spot-check a few: version(u8), collection(Pubkey), governance(Pubkey), pool_ata(Pubkey), round_id(u32), opens_at(i64), closes_at(i64), price(u64), cap(u32), minted_this_round(u32), minted_total(u64), max_supply(u64), bank_treasury(Pubkey), split_bps(u16), sales_stopped(bool), sweep_stopped(bool), guardian(Pubkey), swap_operator(Pubkey), sol_reserve_lamports(u64), bump(u8), max_sweep_lamports(u64), sweep_cooldown_secs(i64), last_sweep_at(i64), level_caps([u32;5]), level_minted([u32;5]), revealed_total(u64), payment_mint(Pubkey), pob_collection(Pubkey), pob_root([u8;32]), charter_opens_at(i64), charter_closes_at(i64), charter_claimed(u32), bare_burns_retired(u64), total_active_weight(u64), active_count(u64), acc_scaled(u128), owed_scaled(u128), last_distribute_at(i64), sales_stopped_at(i64), sweep_stopped_at(i64), pending_swap_operator(Pubkey), pending_swap_operator_at(i64), monthly_secs(i64), pending_guardian(Pubkey), pending_guardian_set(bool), pending_guardian_at(i64), notice_secs(i64), sweep_floor_lamports(u64), cooldown_ceiling_secs(i64), reserve_ceiling_lamports(u64), dist_epoch(u64), pending_count(u64), pending_this_epoch(u64), cbob_mint(Pubkey), max_boost_weight(u8), max_boost_epochs(u16), boost_price(u64), boost_weight(u8), boost_epochs(u16), boosts_active(u32), boosts_due(u32), boost_weight_total(u64), cbob_burned_total(u64), boost_expiring([u32; BOOST_RING]).

Yes, matches. The selftest asserts this. OK.

The cross-program offsets: the selftest scrapes OFF_ constants from the Rust and compares to layout offsets. Let me verify one: GOV reads MINT's minted_total at 141. Let me compute: disc(8) + version(1) + collection(32) + governance(32) + pool_ata(32) + round_id(4) + opens_at(8) + closes_at(8) + price(8) + cap(4) + minted_this_round(4) = 8+1+32+32+32+4+8+8+8+4+4 = 141. Yes, minted_total at 141. OK.

BURN reads bare_burns_retired at 454. Let me compute: after revealed_total(8) at... let me see. Up to revealed_total: 141 + 8 (minted_total) + 8 (max_supply) + 32 (bank_treasury) + 2 (split_bps) + 1 (sales_stopped) + 1 (sweep_stopped) + 32 (guardian) + 32 (swap_operator) + 8 (sol_reserve) + 1 (bump) + 8 (max_sweep) + 8 (cooldown) + 8 (last_sweep) + 20 (level_caps) + 20 (level_minted) + 8 (revealed_total) = let me add: 141+8=149, +8=157, +32=189, +2=191, +1=192, +1=193, +32=225, +32=257, +8=265, +1=266, +8=274, +8=282, +8=290, +20=310, +20=330, +8=338. So revealed_total ends at 338. Then payment_mint(32)=370, pob_collection(32)=402, pob_root(32)=434, charter_opens_at(8)=442, charter_closes_at(8)=450, charter_claimed(4)=454. So bare_burns_retired at 454. Yes! OK.

The SEEDS assertion (round 24 D6): the selftest scrapes each program's seed constants and compares to layout.SEEDS. Let me verify the mapping: sealConfig → SEAL CONFIG_SEED = b"config". seal → SEAL_SEED = b"seal". mintConfig → MINT CONFIG_SEED = b"mint-config". mintAuthority → MINT_SEED = b"mint". vault → VAULT_SEED = b"vault". revenue → REVENUE_SEED = b"revenue". burnConfig → BURN CONFIG_SEED = b"burn-config". govConfig → GOV CONFIG_SEED = b"gov-config". gov → GOV_SEED = b"gov". proposal → PROPOSAL_SEED = b"proposal". vote → VOTE_SEED = b"vote". 

The MINT Rust: `pub const CONFIG_SEED: &[u8] = b"mint-config";` yes. `MINT_SEED: b"mint"` yes. `VAULT_SEED: b"vault"` yes. `REVENUE_SEED: b"revenue"` yes. OK. The selftest asserts all 11. Good — D6 is repaired (the assertion now exists).

Now R4: the money arithmetic.

`bank/accrual.mjs` mirrors MINT. Let me check `pendingScaled`:
```js
export function pendingScaled({ level, debt, boost = 0, carry = 0n }, acc) {
  const p = (weightOf(level) + BigInt(boost)) * BigInt(acc) + BigInt(carry) - BigInt(debt)
  if (p < 0n) throw ...
  return p
}
```

MINT's `owed_of`: `weight * acc + carry - debt`. weight = LEVEL_WEIGHTS[level-1] + boost_weight. Yes, matches.

`reweigh`:
```js
export function reweigh(v, acc, boost) {
  const owed = pendingScaled(v, acc)
  return { ...v, boost, carry: owed, debt: (weightOf(v.level) + BigInt(boost)) * BigInt(acc) }
}
```

MINT's `reweigh`: carry = owed, debt = new_weight * acc. Yes.

`credit`:
```js
const delta = avail * ACC_SCALE / w
return { acc: acc + delta, owed: owed + delta * w }
```

MINT's `credit`: delta = avail * ACC_SCALE / w; acc += delta; owed += delta * w. Yes.

`ceilSats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE`. MINT's `ceil_sats`: same. OK.

`available`: `poolBalance - ceilSats(owedScaled)`, floored at 0. MINT's distribute: `balance.checked_sub(owed)` with PoolShort on underflow. The mirror floors at 0 (the alarm reports the shortfall). OK, noted in the comment.

Now the crank's owed computation for the preExpired case:

```js
else if (preExpired.has(r.address)) {
  const atExpiry = pendingScaled({ level: r.level, debt: r.debt_scaled, boost: r.boost_weight, carry: r.carry_scaled }, cfg.acc_scaled)
  owed = (atExpiry + L.LEVEL_WEIGHTS[r.level - 1] * (acc - BigInt(cfg.acc_scaled))) / ACC_SCALE
}
```

So a vault whose boost is expired this pass (before the distribution): at expiry, its owed = pendingScaled at the OLD acc (with boost and carry). Then it earns this pass's distribution at its level weight alone: `LEVEL_WEIGHTS * (acc_new - acc_old)`. Sum, divide by SCALE. 

Let me verify against the program. The program's claim expires the boost first (expire_boost → reweigh to 0), then computes owed_of at the current acc. After expiry: carry = owed_at_expiry (with boost, at old acc), debt = level_weight * old_acc. Then the distribution runs (acc → acc_new). owed = level_weight * acc_new + carry - debt = level_weight * acc_new + owed_at_expiry - level_weight * old_acc = owed_at_expiry + level_weight * (acc_new - old_acc). Yes! Matches the crank's formula. 

But wait — the crank expires the boost in preExpires (a separate transaction BEFORE the distribute). So at claim time, the boost is already expired. The claim's own expiry branch (`if r.boost_weight > 0 && dist_epoch >= boost_end_epoch`) won't fire (boost_weight is 0 now). So the claim computes owed_of with boost=0, carry=owed_at_expiry, debt=level_weight*old_acc. owed = level_weight * acc_new + carry - level_weight * old_acc. Same. OK.

Hmm, but there's a subtlety: the crank's preExpires transaction runs BEFORE the distribute. The expire_boosts instruction calls expire_boost which reweighs at the CURRENT acc (old acc, before distribution). So carry = owed at old acc. Then distribute advances acc. Then claim. Consistent with the crank's computation. Good.

Now, the joinedNow case:
```js
if (joinedNow) owed = pendingSats({ level: r.level, debt: L.LEVEL_WEIGHTS[r.level - 1] * BigInt(cfg.acc_scaled) }, acc)
```
debt = level_weight * old_acc, acc = new acc. owed = level_weight * (new - old) / SCALE. The program: the vault joined in the join batch at old acc (debt = w * old_acc), then distribution, then claim: owed = w * acc_new - w * old_acc. Matches. OK.

Now, the `retiringOwed` computation:
```js
for (const addr of plan.retireBurned) {
  const r = records.find(x => x.address === addr)
  if (!r?.active) continue
  try { retiringOwed += pendingScaled({ level: r.level, debt: r.debt_scaled, boost: r.boost_weight ?? 0, carry: r.carry_scaled ?? 0n }, cfg.acc_scaled) }
  catch (e) { plan.problems.push(...) }
}
const owedAfterRetire = BigInt(cfg.owed_scaled) > retiringOwed ? BigInt(cfg.owed_scaled) - retiringOwed : 0n
```

The program's `retire` subtracts the retiring vault's pending from owed_scaled. So after retirement, owed_scaled is reduced by retiringOwed. The crank plans the distribution against owedAfterRetire. OK.

But wait — the retire happens in the retire transaction, which runs BEFORE the distribute. The program's retire computes pending = owed_of(r, c.acc_scaled) at the CURRENT acc (old acc). The crank computes retiringOwed at cfg.acc_scaled (old acc). Match. OK.

Now, `available(pool.amount + splitToPool, owedAfterRetire)`: the pool amount plus this pass's split, minus the post-retire owed. The program's distribute computes avail = balance - ceil_sats(owed_scaled). After the retire and split, balance = pool.amount + splitToPool, owed_scaled = owedAfterRetire. So avail matches. OK.

Hmm, but there's a subtle timing issue: the split adds splitToPool to the pool. The crank computes splitToPool = total - total*1500/10000 = total * 85%. The program's split_revenue: bank_cut = total * 1500 / 10000 (floored), holders = total - bank_cut. So holders = total - floor(total*0.15) = ceil(total*0.85). The crank: `total - total * 1500n / 10000n` — integer division floors total*1500/10000, so splitToPool = total - floor(...) = same as the program. OK.

Now let me check the alarm's pool health:
```js
const owedCeil = (owed + 999_999_999_999n) / 1_000_000_000_000n
if (BigInt(tok.amount) < owedCeil) ... pool_insolvent
```
ceilSats with ACC_SCALE = 1e12. OK.

Now R6: the gates.

Let me look at run-tests.sh floors and the selftest's stated-count gate.

The selftest's RX map:
```js
const RX = {
  'on-chain':   /(\d+) assertions, real cloned Core/g,
  'detector':   /(\d+) detector\b/g,
  'allocation': /(\d+) allocation\b/g,
  'poster':     /(\d+) poster\b/g,
  'mainnet':    /(\d+) live-mainnet\b/g,
  'launch':     /(\d+) launch\b/g,
  'pob':        /(\d+) Proof-of-Burn\b/g,
  'sim':        /(\d+) simulation assertions\b/g,
  'swap':       /(\d+) swap-fork assertions\b/g,
  'expiry':     /(\d+) expiry-budget\b/g,
}
```

Round 33 D3 widened launch to `/(\d+) launch\b/g` (from "launch assertions"). The selftest arm: `statedIn('47 launch and 33 live-mainnet', 'launch')` = [47]. And a planted stale one is caught. OK.

Now, the SPEC's Running-the-tests block says "47 launch and 33 live-mainnet". The launch RX matches "47 launch". Good. And "33 live-mainnet" matches mainnet RX. OK.

Let me check the floors: DET_FLOOR=909, ALLOC_FLOOR=39, POSTER_FLOOR=23, MAINNET_FLOOR=33, POB_FLOOR=14, LAUNCH_FLOOR=47, HOST_FLOOR=6, EXPIRY_FLOOR=4, MIN_ASSERTIONS=866, SWAP_FLOOR=16, SIM_FLOOR=71.

The selftest's FLOOR = 909 (its own count). The runner's DET_FLOOR = 909. The selftest asserts selfFloor === det. OK.

Now, the `floor()` function requires n === expected (equality). And the selftest's own FLOOR requires R.length === 909. OK.

Let me look for a gate that can't fail. The `everywhere` function:
```js
const everywhere = (what, want) => {
  const found = statedIn(spec, what)
  t(`SPEC states the ${what} floor correctly EVERYWHERE...`, found.length > 0 && found.every(n => n === want), true)
}
```
Requires found.length > 0 and all equal. OK, can't pass vacuously.

Now, the audit-coverage.sh gate. Let me look at the selftest for it:
```js
if (os.environ.get('GATE_SELFTEST') == '1') { ... 14 cases ... }
```
The selftest runs `audit-coverage.sh --selftest` and expects "14/14 gate assertions as predicted". OK.

Now, the coverage gate's `first_line_quorate`:
```js
return re.fullmatch(rf'# Round {num}, {label} pass: (?:NOT )?CLEAN; QUORUM MET\s*', line) is not None
```
So the verdict's first line must be exactly "# Round N, PROGRAMS pass: [NOT ]CLEAN; QUORUM MET" or "# Round N, OFF-CHAIN pass: ...". Round 33's verdict first line: "# Round 33, OFF-CHAIN pass: NOT CLEAN; QUORUM MET". Matches (NOT CLEAN is allowed, QUORUM MET required). OK.

Now, the bundles() function parses the audit script's TARGETS. Let me not go too deep here.

Let me now look for NEW defects more aggressively. Let me re-read the crank's main() I/O for issues.

```js
const tokInfos = await getMany(records.map(r => P(tokenAddr(r))))
const tokens = {}
records.forEach((r, i) => {
  const info = tokInfos[i], t = readTokenAccount(info)
  tokens[r.asset] = { ...t, address: tokenAddr(r),
    frozen: t.state === 'ok' && info.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
})
```

`tokenAddr(r) = r.active ? r.vault_ata : ataOf(payMint, signerPda(r.asset))`. For an active vault, the recorded vault_ata; for others, the canonical ATA. OK.

But `info.data[L.TOKEN_STATE_OFF]` — if info is null (absent), `t.state` is 'absent', and `t.state === 'ok'` is false, so frozen is false. But `info.data` on a null info would throw... wait, `t.state === 'ok' && info.data[...]` — short-circuit: if state !== 'ok', info.data is not read. OK. But if state === 'ok', info is non-null. OK.

Hmm, wait: `readTokenAccount(info)` with info null returns { state: 'absent', amount: 0n }. Then `t.state === 'ok'` false. OK.

Now the pool read:
```js
const poolInfo = await conn.getAccountInfo(P(cfg.pool_ata), 'confirmed')
const pt = readTokenAccount(poolInfo)
const pool = { ...pt, frozen: pt.state === 'ok' && poolInfo.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
```
Same pattern. OK.

Now, a concern: `getMany` batches 100 keys per getMultipleAccountsInfo call. At 2,100 vaults, that's 21 calls for assets + 21 for tokens = 42 calls per full pass. Plus the program accounts fetch. OK, bounded.

Let me look at the reveal lane's memcmp filter:
```js
...(REVEAL_ONLY ? [{ memcmp: { offset: L.offsets('VaultRecord').level, bytes: bs58.encode(Buffer.from([0])) } }] : [])
```
So the reveal lane fetches only records with level == 0. The offset is computed from the layout. OK.

Now, a subtle issue: the reveal lane plans reveals but the full lane ALSO plans reveals (planCrank without revealOnly includes reveals). Both lanes run under separate locks. They might both try to reveal the same vault. The loser's send gets AlreadyRevealed (benign) or the judgeRevealAttrs returns 'revealed'. OK, handled.

Now let me look at the alarm's handling of `looked.eventSigs` and the truncated logs.

```js
if (!looked.eventSigs) looked.eventSigs = new Set()
if (!looked.eventSigs.has(s.signature)) {
  looked.eventSigs.add(s.signature)
  if (tx.logsTruncated) {
    const ran = [...new Set(ixs.map(ix => ix.program).filter(p => OURS.has(p)))]
    if (ran.length) { if (!looked.logGaps) looked.logGaps = []; looked.logGaps.push(s.signature) }
    else findings.push({ kind: 'log_truncated_foreign', ... })
  }
  const ev = D.parseCbobLogs(tx.logsTruncated ? [] : tx.meta?.logMessages || [])
  ...
}
```

So a truncated transaction in which ours ran is recorded in logGaps; its logs are not parsed (ev from []). Its instructions ARE still checked (the detectors below run on ixs). OK.

But wait — `delete looked.eventSigs` after the loop. And `looked.logGaps` is read after the loop by `D.detectLogGaps(prev?.logGaps, looked.logGaps, ...)`. OK.

Hmm, but there's a subtle issue: `looked.eventSigs` is a Set created on `looked`, which is also used for the report (`looked.txs`, `looked.programs`, `looked.vaults`). The `delete looked.eventSigs` removes it before the report. OK.

Now, the cursor advancement with `unread`:
```js
let unread = 0
for (const s of sigs) {
  if (s.err) continue
  let tx
  try { tx = await readParsedTransaction(...) } catch (e) { unread++; ...; continue }
  if (!tx) { unread++; ...; continue }
  ...
}
if (!unread) { ... advance cursor ... }
```

So if any transaction is unreadable, the cursor holds (no advancement). The backlog stays. Next pass retries. OK. But this means ONE permanently unreadable transaction holds the cursor forever, and the backlog grows. Round 33 C01 discussed this: "a deterministic refusal holds the cursor, and once more than 2,000 later transactions accumulate the held segment becomes the backlog that every pass re-reads, so newer transactions on that program wait; tx_unreadable and scan_gap page every pass". So it's loud. But is there an attacker-constructible refusal? Round 31 C02 and round 32 L2 found none. The reader refuses malformed transactions, but an attacker can't craft a transaction that the RPC returns but the reader refuses (the RPC's jsonParsed is well-formed for real transactions). The truncated-logs case is handled (flag mode). So no attacker construction. OK.

Hmm, wait. Let me reconsider. The reader's `validateParsedTransaction` refuses a transaction with `meta.logMessages` containing 'Log truncated' UNLESS flag mode. The walking scanners use flag mode. But what about a transaction where the RPC returns `meta: null`? That happens for a transaction that's too old or... actually getTransaction returns meta for confirmed transactions. A transaction with `meta: null` would be refused ("metadata/error"). Can an attacker cause that? No — meta is null only for very old transactions or specific RPC issues. OK.

Let me now look at the poster's backlog handling.

```js
const { sigs, gap } = await signaturesSince(conn, new PublicKey(BURN_PROGRAM_ID), st.cursor, 20, 1000, backlog?.before)
```

The poster walks up to 20 pages (20,000). OK.

```js
for (const s of [...sigs].reverse()) {
  if (s.err) continue
  const tx = await readParsedTransaction(conn, s.signature, { truncatedLogs: 'flag' })
  if (!tx) throw new Error(`could not read ${s.signature}; not advancing past it`)
  if (tx.logsTruncated) { ... queue REJECTED if top-level BURN ...; if (!gap && !draining) st.cursor = s.signature; continue }
  for (const e of parseCbobLogs(...).events.filter(e => e.type === 'REDEEMED')) { ... draft ... }
  if (!gap && !draining) st.cursor = s.signature
}
```

Hmm — the poster advances `st.cursor = s.signature` inside the loop for each transaction when `!gap && !draining`. Since it iterates [...sigs].reverse() (oldest first), the cursor ends at the newest. OK.

But wait — if `!tx` (could not read), it throws, and the cursor is not advanced past it. But the cursor might have been advanced for EARLIER transactions in the loop before the throw. The `writeLedger(STATE, st)` at the end is not reached (the throw propagates). So the state is not saved. The cursor changes are lost. Next run re-reads. OK, safe.

Actually, `main().catch(e => { console.error(...); process.exit(3) })`. So the throw exits without saving. OK.

Now, the poster's REJECTED queue for truncated logs:
```js
if (tx.logsTruncated) {
  if (!queued.has(s.signature) && tx.transaction.message.instructions.some(ix => ix.programId === BURN_PROGRAM_ID)) {
    fs.appendFileSync(QUEUE, ... 'rejected' ...)
    queued.add(s.signature)
  }
  if (!gap && !draining) st.cursor = s.signature
  continue
}
```

So a truncated transaction with a top-level BURN call is queued REJECTED. But `ix.programId === BURN_PROGRAM_ID` — for a jsonParsed transaction, top-level instructions have `programId` as a string. OK. But this checks the RAW transaction's instructions, not the normalized ones. `tx.transaction.message.instructions` — each has programId. OK.

Hmm, but a redemption's BURN call is top-level. A truncated redemption is queued REJECTED for hand-drafting. OK.

Now let me look at a potential issue in the poster: the `releasedFromTx` and the draft. The poster reads the VaultRecord to get mint_index and level:
```js
const rec = L.decode('VaultRecord', (await conn.getAccountInfo(recAddr, 'confirmed')).data)
```
If the record account is absent (shouldn't be — records are never closed), this throws. The record persists after redemption. OK.

Now, let me step back and look at the round 33 verdict's confirmed findings and verify the repairs are actually in the tree.

L1: detectSweepState symmetric window. Current code: `Math.abs(t - st) <= half`. Yes, symmetric. And `landed` for uncertain sends. Yes. Repaired.

D1: comment corrected. The current comment says "a thief's sweep cannot sit inside an honest cycle's window, since it must wait a full cooldown after the honest one and revenue.mjs writes a row only once the cooldown has passed; and an uncertain send explains a sweep only when a direct getSignatureStatuses lookup (not the floodable walk) shows it landed." Yes, repaired.

D2: `mint.last_sweep_at` in WATCHED_KEYS. Current: yes, it's there (with the round 33 D2 comment). Repaired.

D3: launch count reader matches "47 launch". Current RX.launch = `/(\d+) launch\b/g`. And the selftest arm R33 D3. Repaired.

Gate-5 obligation: R33.G4 (pre-filled wSOL account closes). The VALIDATION says it's in the suite (866 on-chain). I can't run the suite, but the selftest and fork are the off-chain arms. The swap-fork has SW.1a "nothing stays wrapped". Hmm, the gate-5 obligation was "no suite, selftest or fork arm closes a NATIVE account with a balance". R33.G4 added it to the suite. The fork's SW.1a checks the wSOL account is closed after the swap. But does the fork test a PRE-FILLED wSOL account? Looking at swap-fork.mjs: the operator is a fresh keypair, so its wSOL ATA doesn't pre-exist. SW.1a checks `!!(await conn.getAccountInfo(ata(S.WSOL, op.publicKey)))` is false after the swap (nothing stays wrapped). But not a pre-filled one. The suite's R33.G4 covers the pre-filled case. OK, discharged in the suite (which I can't run, but the VALIDATION records 866/866 with R33.G4).

Now let me look for NEW issues. Let me re-examine the swap's `market()` and the venue selection.

```js
export async function market(conn, lamports, log = console.log) {
  const [wo, lb, solA, btcA, bm, clk] = await conn.getMultipleAccountsInfo([ORCA.pool, METEORA.pool,
    pythAccount(PYTH.SOL_USD), pythAccount(PYTH.BTC_USD), meteoraBitmap(), SYSVAR_CLOCK_PUBKEY], 'confirmed')
  const nowSec = clk && clk.owner?.toBase58?.() === SYSVAR_OWNER ? clockUnixTimestamp(clk.data) : null
  if (nowSec === null) throw ...
  const sol = readPyth(solA, PYTH.SOL_USD), btc = readPyth(btcA, PYTH.BTC_USD)
  const f = oracleFloor({ lamportsIn: lamports, sol, btc, nowSec })
  const venues = []
  let w = null, p = null
  try { w = readWhirlpool(wo); ... if (dv <= MAX_POOL_DEVIATION_BPS) venues.push('orca') } catch ...
  try { p = readLbPair(lb); ... if (dv <= ...) venues.push('meteora') } catch ...
  return { f, w, p, venues, bitmapExists: !!bm, nowSec }
}
```

So venues = ['orca', 'meteora'] filtered by deviation. Orca first. The revenue cycle iterates m2.venues in order, so Orca first, Meteora fallback. OK.

Hmm — `bitmapExists: !!bm`. If the bitmap account exists, bm is non-null. The Meteora swap passes the bitmap PDA if bitmapExists, else the program id. OK.

Now, a subtle issue: the deviation filter uses `f.satsPerLamport` (float). The pool spot is also float. The comparison is at 100 bps. Float error ~1e-16. Fine.

But wait — there's a potential issue with the oracle's `satsPerLamport` vs the pool's raw-units spot. Let me double-check the Orca spot direction. Orca Whirlpool: sqrt_price is the Q64.64 square root of the price of token B in terms of token A, where the price is in RAW units (B's smallest units per A's smallest units). Token A = wSOL (mintA), token B = cbBTC (mintB). So price = raw cbBTC per raw wSOL = sats per lamport. orcaSpot = (sqrt_price/2^64)^2 = sats per lamport. The oracle's satsPerLamport = (SOL/USD) / (BTC/USD) / 10 = ... let me verify: SOL/USD / (BTC/USD) = USD per SOL / USD per BTC = BTC per SOL. / 10 = ... hmm. BTC per SOL * (1e8 sats/BTC) / (1e9 lamports/SOL) = sats per lamport * (1e8/1e9) = sats per lamport / 10. So satsPerLamport = (SOL/USD)/(BTC/USD)/10. Yes. OK, same quantity.

Now the Meteora spot: price = (1 + bin_step/10000)^active_id. The DLMM's price is "how many raw Y per raw X" = lamports per sat (Y=wSOL, X=cbBTC). So meteoraSpot = 1/price = sats per lamport. OK.

Now, let me look at the revenue cycle's re-quote drift check:

```js
const minOut = BigInt(q.outAmount) * BigInt(10_000 - MAX_REQUOTE_DRIFT_BPS) / 10_000n
if (m2.f.expectedSats < minOut) throw ...
```

So the post-sweep oracle expectation must be within 200 bps of the pre-sweep one. OK.

And the floor for the swap is `guaranteed = m2.f.minSats` (the post-sweep oracle floor). The return is held to `delta < guaranteed` throws. OK.

Now, one thing to check: the swap's minSats is the oracle floor (150 bps under expected). The return check is `delta < guaranteed` where guaranteed = minSats. So the return must be >= the floor. But the swap enforces >= minSats on chain. So delta >= minSats always (if the swap landed). The check is redundant but safe. OK.

Hmm, wait — actually there's a subtle point. The swap's output goes to the operator's cbBTC ATA. The delta is `after - opBefore`. If opBefore was measured correctly and the swap output >= minSats, then delta >= minSats. But if the operator's ATA had a pre-existing balance that was somehow reduced... no, nothing reduces it. OK.

Now let me look at the split step:

```js
cycle.splitSig = await sendAndConfirmTransaction(conn, new Transaction().add(
  createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, ataOf(bankWallet), bankWallet, CBBTC),
  new TransactionInstruction({ programId: MINT_PROG, data: Buffer.concat([d('split_revenue'), Buffer.from([8])]), keys: [...] })),
  [operator], { commitment: 'confirmed' }).catch(async e => { ... })
```

The split creates the bank's ATA (idempotent) and calls split_revenue with decimals=8. The keys: config(0, readonly), revenue(1, writable), CBBTC mint(2, readonly), revAta(3, writable), pool(4, writable), bankAta(5, writable), TOKEN(6, readonly). Let me check against SplitRevenue: config, revenue, mint, revenue_ata, holders_ata, bank_ata, token_program. So holders_ata = pool (4), bank_ata = bankAta (5). OK.

Wait — the split's data is `d('split_revenue') + Buffer.from([8])` — decimals 8 (cbBTC). Hardcoded. The crank reads it from the mint (`splitDecimalsByte`). The revenue job hardcodes 8. cbBTC has 8 decimals (probed). OK, but a hardcoded 8 vs the crank's read — inconsistent approaches, both correct for cbBTC. Fine.

Now the catch:
```js
.catch(async e => {
  rememberAttempt(cycle, 'Split', e, led)
  if (isProvablyEmpty(await conn.getAccountInfo(revAta, 'confirmed'))) {
    cycle.splitByOther = true
    ...
    return undefined
  }
  throw e
})
```

So a failed split: if the revenue ATA is provably empty, someone else split it (splitByOther). Else throw. OK.

But `rememberAttempt` is called BEFORE the emptiness check. So even if splitByOther, pendingSplitSig is recorded. That's fine (evidence). But then cycle.splitByOther = true and splitSig stays undefined. cycleIsOpen: returnedSats > 0 and splitByOther → closed. OK.

Hmm, wait — there's a subtle issue. `cycle.splitSig = await ...catch(...)`. If the catch returns undefined (splitByOther), splitSig = undefined. Then `cycle.finishedAt = ...; save(led)`. The cycle has returnedSats > 0, splitByOther = true → closed. OK.

Now, the alarm's detectSplitClaims checks splitByOther cycles are anchored by a real split. The splitByOther cycle here has no splitSig, so it's anchored by closesCycle against the seen splits. The crank's hourly split or a stranger's split would be the anchor. OK.

Let me now look at a potential issue: the revenue cycle's `splitsSince` in the recovery path.

```js
const since = Math.min(...returnedUnsplit.map(c => Date.parse(c.returnedAt || c.startedAt) / 1000).filter(Number.isFinite))
const splits = Number.isFinite(since) ? await splitsSince(conn, revAtaC, since - 60) : []
```

So it walks the revenue ATA's signatures since the earliest return (minus 60s). Bounded to 10 pages. OK.

Now, let me look at the crank's distribute refusal judgment once more, because it involves `lastFailure`:

```js
const send = async (label, ixs) => {
  try { ...; return 'ok' } catch (e) {
    const code = await mintFailureCode(e, conn)
    const m = String(e.message) + ' ' + (e.logs || []).join(' ')
    if (code && BENIGN.test(code)) { ...; return 'benign' }
    lastFailure = code || ''
    console.log(`  FAIL ${label}: ...`); return 'fail'
  }
}
```

So `lastFailure` is set to the error code (or '') on a non-benign failure. For the distribute:
```js
if (plan.distribute) {
  const ok = await send('distribute (monthly, free)', [...])
  if (ok === 'fail') {
    let fresh = null
    try { fresh = L.readPinned(...) } catch { fresh = null }
    if (judgeDistributeRefusal(lastFailure, cfg, fresh) === 'benign') console.log('  skip distribute: ...')
    else failures.push('distribute (monthly, free)')
  }
}
```

`judgeDistributeRefusal(lastFailure, cfg, fresh)`: lastFailure is the code (e.g., 'NothingToDistribute'). The function tests `/PoolShort/.test(m)`, `BENIGN.test(m)`, `DISTRIBUTE_RACE.test(m)`. Wait — `m` here is `lastFailure`, which is just the code (e.g., "NothingToDistribute"), not the full message. Let me check: `judgeDistributeRefusal(message, planned, fresh)` does `const m = String(message ?? '')`. So m = "NothingToDistribute". BENIGN.test("NothingToDistribute") — BENIGN includes MonthNotElapsed but not NothingToDistribute. So BENIGN doesn't match. DISTRIBUTE_RACE = /NothingToDistribute|BoostsExpireFirst|JoinWaitingFirst/ — matches. Then checks if epoch moved. OK.

But wait — `lastFailure = code || ''`. If mintFailureCode returned null (no MINT code), lastFailure = ''. Then judgeDistributeRefusal('', ...) → BENIGN.test('') false, DISTRIBUTE_RACE.test('') false → 'fail'. OK.

Hmm, but there's a subtlety: `lastFailure` is set by EVERY failing send, and it's only read by the distribute handler. If a LATER send (after distribute) fails, lastFailure is overwritten — but the distribute handler runs synchronously right after the distribute send, so lastFailure is the distribute's code. OK.

Wait, actually — the distribute send is `const ok = await send('distribute (monthly, free)', ...)`. Inside send, on failure, `lastFailure = code || ''`. Then the handler reads lastFailure. But between the send and the handler, nothing else runs. OK.

Now, one more: the BENIGN regex includes MonthNotElapsed. So a distribute that fails MonthNotElapsed is benign (someone ran the month). But judgeDistributeRefusal: BENIGN.test(m) → 'benign' if m contains MonthNotElapsed. But the handler only calls judgeDistributeRefusal when send returned 'fail'. And send returns 'benign' (not 'fail') if the code is BENIGN. So a MonthNotElapsed distribute returns 'benign' from send, and the handler's `if (ok === 'fail')` is false. So judgeDistributeRefusal's BENIGN branch is only reached for codes that are BENIGN but... wait, send already filtered BENIGN. So judgeDistributeRefusal only sees non-BENIGN codes. Its `if (BENIGN.test(m)) return 'benign'` is dead code? Let me check: send returns 'fail' only when `!(code && BENIGN.test(code))`. So the code is not BENIGN. judgeDistributeRefusal(m=code): BENIGN.test(code) is false (same regex). So that branch is dead. Hmm, but the selftest tests judgeDistributeRefusal directly with BENIGN codes? Let me check... The selftest: `CR.judgeDistributeRefusal('Error Code: NothingToDistribute', was, moved)` etc. It passes the full "Error Code: X" string, not just the code. So the function is tested with full messages. In production, lastFailure is just the code. Both work because the regexes match the code name within the string. OK, not a bug, just dead defensive branch.

Now let me look at the alarm's `detectCrankHealth` and the covered freezes.

```js
const covered = p => (coveredFreezes.pool && (p === 'the pool cbBTC account is FROZEN; claims would all refuse' || /^the revenue address holds \d+ sats and cannot be split: the community pool's cbBTC account is FROZEN$/.test(p))) || (coveredFreezes.revenue && p === "the revenue address's cbBTC account is FROZEN; nothing in it can be split until it is thawed")
```

So a crank problem that exactly matches a freeze already reported by its transition detector is covered (not counted as a crank_problem streak). The strings must match EXACTLY the planner's messages. Let me check the planner's messages:

- Pool frozen: `plan.problems.push('the pool cbBTC account is FROZEN; claims would all refuse')`. Yes, exact.
- Revenue frozen: `plan.problems.push('the revenue address\'s cbBTC account is FROZEN; nothing in it can be split until it is thawed')`. The covered regex: `"the revenue address's cbBTC account is FROZEN; nothing in it can be split until it is thawed"`. Yes (the planner uses an escaped apostrophe, same string).
- Split blocked by frozen pool: `the revenue address holds ${revenue.amount} sats and cannot be split: the community pool's cbBTC account is FROZEN`. The covered regex: `/^the revenue address holds \d+ sats and cannot be split: the community pool's cbBTC account is FROZEN$/`. Yes.

OK, matches. The selftest R27 L2 arms these. Good.

Now, let me look at something the round 33 verdict didn't cover: the actual current state of the alarm's `detectUnsweptRoyalties` grace with the cooldown.

```js
if (cooldownSecs !== null && cooldownSecs !== undefined && Number.isFinite(Number(cooldownSecs)))
  graceSecs = Math.max(Number(graceSecs), Number(cooldownSecs) + REVENUE_CRON_PERIOD_SECS + 3600)
```

So grace = max(24h, cooldown + 1h + 1h). At the ruled 6h cooldown: max(24h, 8h) = 24h. At a voted-up 24h cooldown: max(24h, 26h) = 26h. OK.

Now, let me look at the `detectRevenueAccount` clock restart:

```js
let since = prevSince ?? nowSec
for (const e of splits || []) {
  const t = splitTime(e)
  if (t !== null && t !== undefined && t > since) since = t
}
```

So the clock is the later of the first sighting and the last split. OK.

Hmm, but there's a subtle issue: `since = prevSince ?? nowSec`, then moved to the last split's time. If a split happened at T-1h and prevSince is T-7h, since = max(T-7h, T-1h) = T-1h. So the clock restarts at the split. OK.

Now, let me look at the alarm's revenue account read and the legacy clock migration:

```js
if (prev?.revenueClock !== 'chain' && prev?.revenueSince != null && revenueRead.state === 'ok' && BigInt(revenueRead.amount) > 0n)
  findings.push({ kind: 'revenue_age_unknown', ... })
const rev = D.detectRevenueAccount({ read: revenueRead, prevSince: prev?.revenueClock === 'chain' ? prev.revenueSince ?? null : null, ... })
```

OK, migration handled.

Now let me hunt for something specific. Let me re-read the crank's `planCrank` activation logic against the program.

The program's `activate` first call: requires level drawn, asset live, vault_token is the canonical ATA, amount >= 21000. Sets pending, request_epoch = dist_epoch, vault_ata = canonical ATA.

The crank:
```js
for (const r of records) {
  if (r.level === 0 || r.active || r.pending || r.retired || assets[r.asset] !== 'live') continue
  const t = tokens[r.asset]
  if (!t || t.state !== 'ok') continue
  if (BigInt(t.amount) >= L.ACTIVATION_SATS) plan.activate.push(r.address)
}
```

So the crank activates revealed, non-active, non-pending, non-retired, live vaults with >= 21000 in the canonical account. `tokens[r.asset]` for a non-active vault is the canonical ATA (tokenAddr uses ataOf for non-active). OK.

The activate instruction keys in main():
```js
keys: [W(MINT_CFG.toBase58()), W(a), R(r.asset), R(tokens[r.asset].address), R(cfg.pool_ata)]
```
Activate accounts: config, vault_record, asset, vault_token, pool_token. So W(config), W(record), R(asset), R(vault_token), R(pool). OK. tokens[r.asset].address is the canonical ATA for a non-active vault. OK.

Now, the activate runs the monthly in-line first (monthly_inline), then the crank. Wait — the program's activate: `crank(ctx.remaining_accounts, ...)` FIRST, then monthly_inline. The crank's activate sends no remaining accounts (no crank records). So the program's crank does nothing. Then monthly_inline. Then the activation logic. OK.

Hmm, wait — the crank sends activations AFTER the distribute (per the comment and the order in main). Because activate runs monthly_inline, which would run the month if due, making the explicit distribute fail MonthNotElapsed. So the crank distributes first, then activates. OK.

But there's a subtle issue: the crank's plan computes the distribution and claims against the state AFTER retirements, joins, expiries, split, distribute. But ACTIVATIONS happen after the distribute and don't affect this pass's distribution (they're requests for the NEXT epoch). The plan's `waitingThisEpoch` accounts for retirements of this-epoch requesters. OK.

Now, let me look at a potential issue with the claim batch and the in-line monthly run.

The program's `claim` runs monthly_inline BEFORE paying. So a claim that closes a month also distributes. The crank plans claims against the post-distribution acc. If the crank's explicit distribute ran, the claim's monthly_inline sees the month as not due (last_distribute_at just stamped). OK. But if the crank did NOT distribute (e.g., not due), and a claim batch runs, the claim's monthly_inline might run the month if it became due between the plan and the send. Then the claim distributes in-line, and the claims pay at the new acc. The crank planned the claims at the old acc (owed >= 1 sat). The in-line distribution only ADDS to what they're owed, so the claim still pays (at least what was planned). OK, no refusal.

But — the in-line monthly run in a claim could be blocked by JoinWaitingFirst or BoostsExpireFirst? No — monthly_inline never refuses its host for those reasons (it logs and does nothing). Let me check: monthly_inline returns Ok(()) early if boosts_due > 0 or waiting_to_join > 0. So it does nothing, and the claim proceeds to pay at the old acc. OK.

Hmm, wait. Actually let me re-read monthly_inline:

```rust
fn monthly_inline(c: &mut MintConfig, pool: &AccountInfo, config_key: &Pubkey, now: i64) -> Result<()> {
    require_keys_eq!(pool.key(), c.pool_ata, MintError::WrongPool);
    let due = ...;
    if !due { return Ok(()); }
    if c.boosts_due > 0 { msg!(...); return Ok(()); }
    if waiting_to_join(c)? > 0 { msg!(...); return Ok(()); }
    if c.total_active_weight == 0 { if c.pending_this_epoch > 0 { tick(c, now)?; } return Ok(()); }
    if pool.owner != &SPL_TOKEN_ID { return Ok(()); }
    let balance = { ... };
    let avail = balance.saturating_sub(ceil_sats(c.owed_scaled));
    if avail == 0 { return Ok(()); }
    credit(c, avail, w, now)?;
    ...
}
```

So monthly_inline only refuses on WrongPool. Otherwise it degrades gracefully. OK.

Now, the explicit `distribute` DOES refuse on BoostsExpireFirst, JoinWaitingFirst, PoolShort, NothingToDistribute, MonthNotElapsed, NoActiveVaults. The crank plans around these. OK.

Let me now look at the crank's handling of the case where the pool account doesn't exist yet (item 52). The plan:
```js
const poolOk = pool && pool.state === 'ok'
if (!poolOk) plan.problems.push(`the pool account is ${pool ? pool.state : 'unread'}; nothing can be distributed or claimed`)
```
So no distribute, no claims if the pool isn't ok. And the split is blocked (pool not ok → blocker). OK. And the alarm pages pool_unreadable. OK.

Now, item 52's round-24 D8 note: an explicit distribute reads the pool BEFORE anything else, so until the pool exists, every distribute refuses, EVEN THE FREE LAUNCH TICK. Wait — let me check the program's distribute:

```rust
pub fn distribute<'info>(ctx: ..., burn: bool) -> Result<()> {
    let now = ...;
    let pool_owner = ctx.accounts.config.key();
    { require_keys_eq!(ctx.accounts.pool_token.key(), c.pool_ata, MintError::WrongPool); }
    let (balance, _) = read_token(&ctx.accounts.pool_token, &ctx.accounts.config.payment_mint, &pool_owner)?;
    ...
```

`read_token` requires the pool to be a classic SPL token account (owner SPL_TOKEN_ID, len 165). If the pool account doesn't exist, read_token fails (VaultAccountMissing). So yes, an explicit distribute refuses if the pool doesn't exist, even for the tick. The crank's plan: poolOk false → no distribute planned. So the crank doesn't waste a fee. But the launch tick can't run until the pool exists. Item 52 says road step 10 creates it. OK, consistent.

Hmm, but wait — the in-line monthly run degrades gracefully (performs the tick without reading the pool). Let me check: monthly_inline reads the pool only after the `total_active_weight == 0` check. For the launch tick (w == 0, pending_this_epoch > 0), it ticks WITHOUT reading the pool (the `if pool.owner != &SPL_TOKEN_ID { return Ok(()) }` is after the tick branch). Wait:

```rust
if c.total_active_weight == 0 {
    if c.pending_this_epoch > 0 { tick(c, now)?; }
    return Ok(());
}
if pool.owner != &SPL_TOKEN_ID { return Ok(()); }
```

So the tick happens before the pool read. So the in-line monthly run ticks even without a pool. But the explicit distribute reads the pool first (read_token) and refuses. So the launch tick can only run in-line (via a host) until the pool exists. The crank's explicit distribute would refuse. But the crank plans no distribute when the pool isn't ok. So the launch tick relies on host traffic (a mint, a claim, an activate) until the pool exists. Item 52 says road step 10 creates the pool right after initialize, so this is a launch-ordering non-issue. OK.

Now let me look at the crank's tick planning:

```js
} else if (joinable && poolOk && !pool.frozen && due && w === 0n && waitingThisEpoch) {
  plan.distribute = true; plan.distributeKind = 'tick'
}
```

The crank plans a tick only if poolOk. But the program's explicit distribute refuses the tick if the pool doesn't exist (read_token fails). So the crank correctly doesn't plan it. But the tick COULD run in-line without a pool. The crank doesn't do that (it only sends explicit distributes). So if the pool doesn't exist, the launch tick waits for host traffic. Item 52 covers this. OK.

Now, let me look at the crank's `waitingThisEpoch`:
```js
const retiringThisEpoch = BigInt(records.filter(r => retiring.has(r.address) && r.pending && !r.retired
  && BigInt(r.request_epoch) === BigInt(cfg.dist_epoch)).length)
const waitingThisEpoch = BigInt(cfg.pending_this_epoch ?? 0) - retiringThisEpoch > 0n
```

So waitingThisEpoch = pending_this_epoch minus this-pass's retirements of this-epoch requesters. OK.

Now, let me look at a potential issue: the crank plans a tick when w === 0 and waitingThisEpoch. But the program's distribute tick requires `!burn && c.pending_this_epoch > 0`. The crank's waitingThisEpoch accounts for retirements. But the program reads the LIVE pending_this_epoch (after the crank's retirements ran). So if the crank retires the only this-epoch requester, the program's pending_this_epoch drops to 0, and the tick refuses NoActiveVaults. The crank's waitingThisEpoch = pending_this_epoch - retiringThisEpoch = 0 → no tick planned. OK, consistent (round 23 L3).

Now let me look at the alarm's `detectDistributionOverdue` launch_tick_overdue:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', ... })
```

So if nobody's joined, some are waiting this epoch, and the month + grace passed, page. OK.

Now, let me look at a specific concern: the alarm reads `mint.pending_this_epoch` and `mint.pending_count`. These are in WATCHED_KEYS. OK.

Let me now look at the swap-fork test for coverage gaps.

The fork test swaps 2 SOL and 10 SOL through both venues, checks the floor holds, checks a 5%-above-oracle floor is refused, checks the judge. It drives market() with fresh/stale/future prices. It does NOT test:
- A pool pushed to the edge of the deviation gate (100 bps) — the selftest's L6 does this with stubbed pools.
- A sandwich attack — can't be tested on a fork easily.
- The wSOL pre-filled account — the suite's R33.G4 does this.

OK, reasonable coverage.

Now, let me look at the selftest's L6 arm:
```js
for (const venue of ['orca', 'meteora']) {
  const cases = [[1.0099, true], [0.9901, true], [1.0101, false], [0.9899, false]]
  ...
}
```
So a pool 99 bps from the oracle is used, 101 bps is not. Both directions, both venues. OK.

Now, let me look for a subtle bug in the deviation computation at the boundary. `deviationBps(pool, oracle) = Math.abs(pool - oracle) / oracle * 10000`. At exactly 100 bps: |pool - oracle|/oracle = 0.01 → 100 bps. `dv <= MAX_POOL_DEVIATION_BPS` (100) → used. So exactly 100 bps is used. The selftest uses 99 and 101. OK.

Now, let me look at the `stubConn` in the selftest and whether the market() reads are correctly stubbed. The stub provides orca, meteora, sol, btc, clock, bitmap. market() reads [ORCA.pool, METEORA.pool, pythAccount(SOL), pythAccount(BTC), meteoraBitmap(), SYSVAR_CLOCK]. The stub maps by base58. OK.

Now, let me look at a potential issue in the selftest's `solFor`:
```js
const solFor = target => BigInt(Math.round(target * Number(BTC) * 10))
```
So sol.price = target * BTC * 10, where target is sats per lamport. Let me verify: satsPerLamport = sol.price * 10^-8 / (BTC * 10^-8) / 10 = sol.price / BTC / 10. So sol.price = satsPerLamport * BTC * 10. Yes. OK.

Now, let me look at the alarm's `detectSweepState` once more for the `landed` computation edge case.

The alarm computes `landedSigs` from `pendingSigs` (cycles with pendingSweepSig and no sweepSig). It does a direct getSignatureStatuses. If the lookup throws, landedSigs is empty (nothing confirmed). The comment says "unknown: nothing confirmed, the loud direction". So a failed lookup means an uncertain send doesn't explain a sweep → pages. Loud. OK.

But here's a subtle issue: `pendingSigs.slice(-50)`. If there are more than 50 pending sweeps, only the last 50 are checked. A cycle beyond that with a pendingSweepSig that landed wouldn't explain a sweep. But 50 open cycles is absurd (the open-cycle guard prevents more than 1). OK.

Now, let me look at the revenue cycle's stage tracking and notices.

```js
const REVENUE_STAGES = ['lock', 'config', 'key', 'recovery', 'funding', 'market', 'prepare', 'sweep', 'swap', 'return', 'split']
```

`enterStage(stage)`: `revenuePassed.add(revenueStage); revenueStage = stage`. So entering a stage marks the PREVIOUS stage as passed. Hmm, `revenuePassed.add(revenueStage)` adds the CURRENT stage (before updating). So when entering 'key', revenueStage was 'config', so 'config' is added. OK.

Wait, but the initial revenueStage is 'config' (module-level `let revenueStage = 'config'`). And `enterStage('key')` adds 'config' then sets 'key'. So 'config' is marked passed when entering 'key'. But 'config' involves reading the config, which happens before enterStage('key'). OK.

Hmm, but the first stage is 'lock', added by the wrapper: `revenuePassed.add('lock')`. OK.

Now, `publishRevenueNotices(error)`:
```js
const previous = REVENUE_STAGES.filter(s => fs.existsSync(`${FAILURES}/${s}`))
for (const n of revenueNotices({ stage, error, previous, passed: [...revenuePassed] })) { ... }
```

`revenueNotices` sends recoveries for stages in `previous` (markers exist) that are in `passed` and not the failing stage. And a failure notice for the current stage. OK.

The selftest R26 arms these. OK.

Now, let me look at a potential issue: the revenue cycle's `enterStage('market')` is called BEFORE the first market read. And the market read might throw (no venues). Then the failure is at stage 'market'. OK.

Now, let me look at the crank's fee warning marker:

```js
const WARNED = (process.env.CBOB_CRANK_FEE_WARNED || '/opt/cbob-vaults/bank/.crank-fee-warned') + (fee.warnKind === 'floor' ? '-floor' : '')
```

So the floor warning has its own marker file (-floor suffix). The ceiling warning uses the base. OK (round 30 review).

Now, `warnDue(last, nowSec)`:
```js
export function warnDue(lastSec, nowSec, everySecs = 24 * 3600) {
  return !(Number(lastSec) > 0) || Number(nowSec) - Number(lastSec) >= everySecs
}
```
OK.

Now, the notify call:
```js
if (warnDue(last, nowSec)) {
  try { execFileSync(NOTIFY, [`CBOB crank: ${fee.warn}`, `${CRANK_LABEL}:fee_${fee.warnKind === 'floor' ? 'floor' : 'ceiling'}`], ...) } catch {}
  try { fs.writeFileSync(WARNED, String(nowSec)) } catch {}
}
```

Hmm — the marker is written even if the notify fails (the catch swallows). Round 33 C11 noted this: "the crank's fee-warning marker is written even if the notifier fails". The verdict said "ACCURATE; NOT A DEFECT" because the box notifier retries undelivered alerts itself. OK, accepted.

Now let me look at the alarm's `report` function and the `delivered` logic.

```js
let delivered = true
for (const n of plan.notices) {
  ...
  try { execFileSync(NOTIFY, [n.text, n.label], ...) } catch (e) { ...; code = 2; delivered = false }
}
```

So delivered is false if ANY notice fails. Then the caller holds every baseline. OK.

But — the notify wrapper (notify-gary-sms.sh) hands to the alert router, which returns 0 even when it suppresses (queues). So `execFileSync` succeeds (exit 0) even for a suppressed alert. The alarm treats exit 0 as delivered. The router holds and retries. So "delivered" means "handed to the router", not "emailed". The baselines advance when the router accepts. The router's suppression is handled by the per-kind streams and urgent break-through (round 24 H1). OK, that's the design.

Now, let me look at a specific concern: the alarm's state advancement when delivered.

```js
const sent = await report(findings, looked, cfg, false, { prevPaged })
const delivered = sent.delivered && !DRY
next.paged = sent.paged
if (!delivered) { ... hold baselines ... }
if (!DRY) writeState(next)
```

So if delivered, next (with advanced cursors, baselines) is written. If not, baselines are held (cursors, backlogs, etc. revert to prev). OK.

Hmm, but `next.paged = sent.paged` is set BEFORE the `if (!delivered)` block, and the `if (!delivered)` block sets `next.paged = [...new Set([...(prev?.paged || []), ...sent.paged])]`. So on undelivered, paged is the union (so recoveries aren't lost). OK.

Now, let me look at the `markEver` and the first-run logic.

```js
const EVER = ... '.alarm-has-run'
const markEver = () => { if (!DRY) fs.writeFileSync(EVER, started) }
if (!prev && fs.existsSync(EVER) && !ARGS.has('--first-run')) {
  throw new Error(`${STATE_FILE} is missing, but ${EVER} says this pipeline has run before. ...`)
}
```

So a missing state file with the marker present is a refusal. OK.

Now, let me look at the idle branch (mint config not initialized):

```js
if (!collection || cfg['mint._missing']) {
  if (prev?.config?.['mint.collection']) { ... config_vanished ...; return ... }
  console.log('mint config not initialised — nothing to watch yet')
  findings.push(...D.detectUnreconciledRevenue(led, ...))
  const idle = await report(findings, looked, cfg, true, { prevPaged })
  const idleDelivered = idle.delivered && !DRY
  if (idleDelivered) { writeState({...}); markEver() }
  return idleDelivered
}
```

OK.

Now, let me hunt for a real issue. Let me re-read the swap's `judgeSwapInstructions` for the Meteora bitmap handling.

The judge checks the swap's data and key positions. For Meteora, the bitmap is at key 1 (opt). The judge doesn't check key 1 (the bitmap). Could a tampered builder pass a wrong bitmap? The bitmap affects which bin arrays are valid. A wrong bitmap... hmm. The judge checks the pool (key 0), input (key 4), output (key 5), signer (key 10). It doesn't check the bitmap (key 1), reserves (keys 2,3), mints (keys 6,7), oracle (key 8), host_fee_in (key 9), token programs (11,12), event authority (13), program (14), or the bin arrays (15-17).

Round 33 C14 noted: "the judge leaves venue accounts, including Meteora host_fee_in, unpinned". The verdict: "COVERED round 32 C14; limit 10(c)". The reasoning: host_fee_in can only take a share of Meteora's protocol fee, never the floored output. And the venue program validates its pool-owned liquidity accounts.

But wait — what about the bin arrays? A tampered builder could pass WRONG bin arrays (e.g., arrays for a different price range). The Meteora program would... hmm. The bin arrays must be the ones covering the active bin and the bins the swap crosses. If wrong arrays are passed, the program either errors (refused) or computes a wrong price. But the min_amount_out floor is enforced regardless. So a wrong bin array can't cause an output below the floor. The worst case is the swap refuses (cycle stays open). OK.

What about the reserves (keys 2,3)? Those are the pool's vaults. The program validates them against the pool. A wrong reserve is refused by the program. OK.

What about the oracle (key 8)? Meteora's oracle is for its own price tracking; the swap doesn't read it for the output amount (the floor is min_amount_out). OK.

So the unpinned venue accounts can't route value below the floor. The judge + the on-chain floor + the post-swap delta check bound it. OK, consistent with the verdict.

Now, let me look at the Orca swap's remaining accounts. The judge checks keys 0-10 are... wait, the Orca swap has exactly 11 keys (token, owner, pool, ownerWsol, vaultA, ownerCbbtc, vaultB, t0, t1, t2, oracle). The judge checks key 2 (pool), key 3 (input), key 5 (output), key 1 (signer). It doesn't check vaultA, vaultB, t0-t2, oracle. Those are pool-owned (vaults) or derived (tick arrays, oracle). The program validates them. A wrong tick array → refused or wrong price, but the floor binds. OK.

Now, let me look at a potential issue with the Orca swap's `amount_specified` and the threshold. For exact-input a_to_b, `other_amount_threshold` is the minimum output. The judge checks `d.readBigUInt64LE(16) !== floor` — offset 16 is the threshold (after disc 8 + amount 8). OK.

Now, let me look at the crank's `splitDecimalsByte` and the split instruction.

The crank's split:
```js
data: Buffer.concat([d('split_revenue'), Buffer.from([payDecimals])]),
```
payDecimals from the mint's byte 44. If null, the split is not sent (a failure is recorded). OK.

Now, let me look at the alarm's `detectPoolHealth` and the owed read. The pool is read with a fresh config read (readPool reads both in one getMultipleAccountsInfo). OK.

Now, let me look at a potential issue in `readPool`:
```js
const [cInfo, info] = await conn.getMultipleAccountsInfo([mintCfg, new PublicKey(cfg['mint.pool_ata'])], 'confirmed')
const fresh = cInfo ? L.readPinned('MintConfig', cInfo, PublicKey) : null
const r = readTokenAccount(info)
return { ...r, owedScaled: fresh ? String(fresh.owed_scaled) : null, frozen: ... }
```

So the owed is read at the same time as the pool. OK. But `L.readPinned` throws if the config is wrong. If it throws, readPool throws, and main()... let me check. `const pool = await readPool(cfg)`. If it throws, main() throws, the alarm fails to run (run_failed). Loud. OK.

Now, let me look at the crank's `mintedAttributes` and the mpl-core deserializer version. The package is pinned (1.10.0 per round 33 C22). If Core adds a plugin type the deserializer doesn't know, it throws, the reveal run breaks, reveal_queue_stalled pages. OK, loud.

Now, let me look at the `detectNestedVaults` and the off-curve owner check.

```js
let ok
try { ok = isOnCurve(owner) } catch { ok = null }
if (ok === null || ok) continue
out.push({ kind: 'unredeemable_owner', ... })
```

The alarm passes `k => PublicKey.isOnCurve(new PublicKey(k).toBytes())`. If the owner is a bad key, `new PublicKey(k)` throws, caught, ok = null, skipped (not a verdict). OK.

Now, let me look at the alarm's `detectVaultSetChange` false-alarm guard:
```js
const allowed = Math.max(3, Math.floor(prevLive.length * ratio))
if (gone.length > allowed) { ... vault_index_shrank ...; trustCurrent: false }
```
ratio 0.1. OK.

Now, let me look at the `correlateBurns` and `rememberRedemptions`.

```js
export function rememberRedemptions(previous = [], findings = []) {
  const byAsset = new Map()
  for (const f of [...previous, ...findings.filter(f => f.kind === 'burn_via_program')])
    if (typeof f?.asset === 'string' && f.asset && typeof f.signature === 'string' && f.signature)
      byAsset.set(f.asset, { asset: f.asset, signature: f.signature })
  return [...byAsset.values()]
}
```

So only burn_via_program findings with a signature are remembered. The alarm attaches `signature: s.signature` to each finding. OK.

`correlateBurns(findings, previous)`: downgrades vault_burned etc. for assets with a seen burn_vault. OK.

Now, the load-bearing guard: the alarm skips failed transactions (`if (s.err) continue`). So a burn_via_program finding comes from a successful transaction. The selftest asserts this guard exists in alarm.mjs source. OK.

Let me now look at a potential issue: the alarm's scan reads transactions for SEAL, MINT, BURN, GOV (four programs), not SWEEP. The sweep helper is stateless and only called via Core ExecuteV1. Its transactions would appear in... hmm, the sweep is a CPI inside a redemption (Core ExecuteV1 → sweep). The redemption touches SEAL and BURN (top-level), so it's scanned. The sweep's effects (token transfers out of the vault) are inner instructions, read by the detectors. OK. The sweep's own program account is watched for upgrade authority and bytes (readConfigs includes SWEEP). OK.

Now, let me look at the `detectBurns` and the inner Core BurnV1 attribution.

```js
const burnVaultAt = new Map()
for (const ix of ixs) {
  if (ix.parent !== undefined || ix.program !== burnProgramId) continue
  if (burnVaultDiscriminator && !(ix.dataBytes && burnVaultDiscriminator.every((b, i) => ix.dataBytes[i] === b))) continue
  burnVaultAt.set(ix.index, ix.accounts?.[0])
}
for (const ix of ixs) {
  if (ix.program === burnProgramId) { ... burn_via_program ...; continue }
  if (ix.program !== CORE_ID) continue
  if (ix.dataBytes?.[0] !== IX_BURN_V1) continue
  const asset = ix.accounts?.[0]
  if (!assetSet.has(asset)) continue
  if (ix.parent !== undefined && burnVaultAt.get(ix.parent) === asset) continue
  out.push({ kind: 'bare_core_burn', ... })
}
```

So a Core BurnV1 inner instruction whose parent is a burn_vault for the same asset is BURN's own (not bare). A top-level Core BurnV1 of a vault is bare. An inner Core BurnV1 under a different program is bare. OK.

The selftest's round-22 A1 arms prove these shapes. OK.

Now, let me look at the `normaliseTx` and the data decoding.

```js
const one = ix => ({
  program: (ix.programId || keys[ix.programIdIndex]).toString(),
  parsed: ix.parsed,
  accounts: (ix.accounts || []).map(a => (typeof a === 'number' ? keys[a] : a.toString())),
  dataBytes: ix.data ? [...Buffer.from(bs58decode(ix.data))] : undefined,
})
```

So for a parsed instruction, programId is a string. For a raw one, programIdIndex → keys. accounts: numbers → keys, or strings. dataBytes: base58-decoded. OK.

Hmm, `bs58decode` is a local implementation. Let me check it:
```js
function bs58decode(s) {
  let n = 0n
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) return Buffer.alloc(0); n = n * 58n + BigInt(i) }
  const bytes = []; while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n }
  for (const c of s) { if (c === '1') bytes.unshift(0); else break }
  return Buffer.from(bytes)
}
```

Standard base58 decode. Leading '1's → leading zeros. OK. But note: an invalid character returns Buffer.alloc(0) (empty). The txread validator checks `/^[1-9A-HJ-NP-Za-km-z]*$/` for raw instruction data, so invalid base58 is refused before this. OK.

Now, let me look at the txread validator's coverage requirements once more, since the transaction history note says to check it.

`validateParsedTransaction`:
- version in ['legacy', 0, 1]
- slot uint
- blockTime null or uint
- signatures[0] === signature
- message with recentBlockhash, accountKeys non-empty, each key valid, unique, first is signer+writable
- v1: transactionConfig present, no lookupTable keys
- instructions: programId valid and in keys; parsed or raw shape; money instructions carry structured info
- meta: err present, fee uint, preBalances/postBalances match accountKeys length, logMessages array of strings, innerInstructions valid groups, preTokenBalances/postTokenBalances valid
- logsTruncated handling

OK, thorough. The round 27/29 arms prove the refusals.

Now, one thing: the validator requires `meta.logMessages` to be an array. A transaction with `logMessages: null` (e.g., a transaction that didn't execute?) is refused. But a confirmed transaction always has logMessages (possibly empty). OK.

Now, let me look at the alarm's handling of `s.err` (failed transactions). `if (s.err) continue` — skipped before reading. So failed transactions are never read. The load-bearing guard. OK.

Now, let me look at a potential issue: the alarm's `getSignatureStatuses` for the cursor resolvability check.

```js
if (cursors[id] && sigs.length === 0) {
  let resolvable = null
  try {
    const st = await conn.getSignatureStatuses([cursors[id]], { searchTransactionHistory: true })
    resolvable = !!st?.value?.[0]
  } catch { resolvable = null }
  if (resolvable === false) { ... scan_cursor_unresolvable CRITICAL ... }
}
```

So an empty walk with a cursor: if the cursor is not found, CRITICAL. If the lookup throws (resolvable null), nothing is said (the cursor might be fine, the RPC failed). Hmm — a failed lookup reads as "not unresolvable", which is the quiet direction. But the walk returning empty with a valid cursor means "nothing new", which is normal. So the check only fires when the cursor is positively gone. A failed lookup is ambiguous; saying nothing is acceptable (the next pass retries). OK.

Now, let me look at the backlog drain proof once more:

```js
else if (backlog) {
  let proven = false
  try {
    const below = await conn.getSignaturesForAddress(prog, { before: backlog.before, limit: 1 }, 'confirmed')
    if (cursors[id]) proven = below?.[0]?.signature === cursors[id]
    else {
      const st = await conn.getSignatureStatuses([backlog.before], { searchTransactionHistory: true })
      proven = !!st?.value?.[0] && Array.isArray(below) && below.length === 0
    }
  } catch { proven = false }
  if (proven) { cursors[id] = backlog.head; delete backlogs[id] }
  else findings.push({ kind: 'scan_backlog_unproven', ... CRITICAL ... })
}
```

So an empty resumed walk: if there's a cursor, the signature right below backlog.before must be the cursor. If no cursor, backlog.before must resolve and have nothing below it. OK.

Hmm, wait — there's a subtle issue. When the resumed walk comes back empty AND there are new transactions at the top... no, the resumed walk starts at backlog.before and goes backwards (older). If it's empty, there are no transactions between the cursor and backlog.before. The proof confirms the cursor is right below backlog.before. OK.

But what if the walk comes back empty because backlog.before fell out of history? Then `below` (the signature before backlog.before) would be... the RPC answers an unknown `before` with an empty list? Or the newest? Actually, `getSignaturesForAddress` with an unknown `before` returns... I think it returns an empty list or starts from the newest. The comment says "the RPC answers an unknown `before` with an empty list too". So below would be empty, and `below?.[0]?.signature === cursors[id]` is false → not proven → CRITICAL. OK, that's the intended behavior (the window must be re-scanned by hand).

Now, let me look at the crank's `planCostLamports` for the claims:

```js
const txs = BigInt(p.reschedule.length + p.capture.length + p.reveal.length + p.retireBurned.length + p.activate.length
  + p.claims.length + (p.split ? 1 : 0) + (p.distribute ? 1 : 0))
  + ceil(p.preJoins.length, L.CLAIM_BATCH) + ceil(p.preExpires.length, L.EXPIRE_BATCH) + ceil(p.postExpires.length, L.EXPIRE_BATCH)
```

So claims.length is already batches (planned in batches of 14). preJoins are batched by CLAIM_BATCH. preExpires/postExpires by EXPIRE_BATCH. OK.

Wait — but the joins (this-pass eligible) are folded into p.claims (ready.push(...plan.joins) before batching). So they're counted in claims.length. OK.

Now, `budgetPlan` drops reveals to fit the budget. The base plan cost includes claims, joins, etc. OK.

Now, let me look at a potential issue: the crank's reveal rent. `REVEAL_RENT_LAMPORTS = 16 * 6960 = 111,360`. The reveal writes a `level` attribute. The rent is for the bytes added. The comment says "up to 16 bytes at 6,960 lamports/byte". The level attribute is key "level" (5 chars) + value (1-3 chars: "I".."V" roman numerals, up to "III" wait no, LEVEL_NAMES are "I", "II", "III", "IV", "V" — up to 4 chars for "IIII"? No, "IV" is 2, "III" is 3, "V" is 1). So the attribute adds maybe 10-16 bytes. 16 bytes is the bound. OK.

Now, let me look at the crank's reveal instruction keys:

```js
keys: [W(MINT_CFG.toBase58()), W(a), W(r.asset), W(cfg.collection),
  { pubkey: payer.publicKey, isSigner: true, isWritable: true }, R(MINT_AUTH.toBase58()),
  R(SLOT_HASHES_ID), R(CORE_ID), R(SystemProgram.programId.toBase58())]
```

RevealLevel accounts: config, vault_record, asset, collection, payer, mint_authority, slot_hashes, mpl_core, system_program. So W(config), W(record), W(asset), W(collection), payer(signer, writable), R(mint_authority), R(slot_hashes), R(mpl_core), R(system). OK, matches.

Now, let me look at the capture instruction:
```js
keys: [W(a), R(SLOT_HASHES_ID)]
```
CaptureEntropy: vault_record, slot_hashes. OK.

Reschedule:
```js
keys: [W(a)]
```
RescheduleReveal: vault_record. OK.

Retire:
```js
keys: [W(MINT_CFG.toBase58()), W(a), R(r.asset)]
```
RetireBurned: config, vault_record, asset. OK.

Join batch (claim with crank=0):
```js
data: Buffer.concat([d('claim'), Buffer.from([0])]),
keys: [W(MINT_CFG.toBase58()), W(cfg.pool_ata), R(TOKEN_PROGRAM_ID), ...pairs.flatMap(([rec, ata]) => [W(rec), W(ata)])]
```
Claim accounts: config, pool_token, token_program, then remaining (pairs). crank_n=0, so no SlotHashes/crank records. pairs are (record, ata). OK.

Expire:
```js
data: d('expire_boosts'),
keys: [W(MINT_CFG.toBase58()), ...recs.map(a => W(a))]
```
ExpireBoosts: config, then remaining (records). OK.

Split:
```js
data: Buffer.concat([d('split_revenue'), Buffer.from([payDecimals])]),
keys: [R(MINT_CFG.toBase58()), W(REVENUE.toBase58()), R(payMint.toBase58()), W(revAta.toBase58()), W(cfg.pool_ata), W(bankAta.toBase58()), R(TOKEN_PROGRAM_ID)]
```
SplitRevenue: config(readonly), revenue(writable), mint(readonly), revenue_ata(writable), holders_ata(writable), bank_ata(writable), token_program(readonly). OK.

Distribute:
```js
data: Buffer.concat([d('distribute'), Buffer.from([0])]),
keys: [W(MINT_CFG.toBase58()), R(cfg.pool_ata)]
```
Distribute: config, pool_token. burn=false (0). OK.

Activate:
```js
keys: [W(MINT_CFG.toBase58()), W(a), R(r.asset), R(tokens[r.asset].address), R(cfg.pool_ata)]
```
Activate: config, vault_record, asset, vault_token, pool_token. OK.

Claim batch:
```js
data: Buffer.concat([d('claim'), Buffer.from([0])]),
keys: [W(MINT_CFG.toBase58()), W(cfg.pool_ata), R(TOKEN_PROGRAM_ID), ...pairs.flatMap(([rec, ata]) => [W(rec), W(ata)])]
```
Same as join batch. OK.

All the instruction shapes match. Good.

Now, let me look at the alarm's `readConfigs` and the program data reading.

```js
for (const [name, prog] of [['seal', SEAL], ['mint', MINT], ['burn', BURN], ['gov', GOV], ['sweep', SWEEP], ['core', CORE], ...THIRD]) {
  const [pdAddr] = PublicKey.findProgramAddressSync([prog.toBuffer()], BPF_LOADER_UPGRADEABLE)
  const acc = await conn.getAccountInfo(pdAddr, 'confirmed')
  if (!acc) { snap[`prog.${name}._missing`] = true; if (NOT_OURS.has(name)) { ... 'NO_PROGRAMDATA' ... } continue }
  const pdInfo = D.readProgramData(acc.data)
  if (pdInfo.problem) throw ...
  snap[`prog.${name}.upgrade_authority`] = pdInfo.hasAuth ? new PublicKey(acc.data.subarray(13, 45)).toBase58() : 'IMMUTABLE'
  snap[`prog.${name}.hash`] = createHash('sha256').update(acc.data.subarray(pdInfo.elfOffset)).digest('hex').slice(0, 32)
}
```

So the ProgramData account is derived as [program] under the BPF loader. The ELF is at offset 45. The authority at 13..45 if the tag at 12 is 1. OK, measured (round 16).

Now, the hash is `sha256(elf).slice(0, 32)` — a 32-char hex prefix. OK.

Now, the collection plugins hash:
```js
if (snap['mint.collection']) {
  const acc = await conn.getAccountInfo(new PublicKey(snap['mint.collection']), 'confirmed')
  snap['collection.plugins_hash'] = acc ? L.collectionPluginsHash(acc.data) : 'ABSENT'
}
```

`collectionPluginsHash` skips the base fields (key, update_authority, name, uri, num_minted, current_size) and hashes the rest. OK.

Now, let me look at a potential issue: the alarm reads `mint.collection` from the config, then reads that account. If the collection account is huge (many plugins), the read is fine. OK.

Now, let me look at the `pob_collection.update_authority` read:
```js
snap['pob_collection.update_authority'] = acc && acc.data.length >= 33 && acc.data[0] === 5
  ? new PublicKey(acc.data.subarray(1, 33)).toBase58() : 'ABSENT'
```

So a collection (key 5) has update_authority at 1..33. OK.

Now, let me look at the alarm's `detectMissingComponents`:
```js
const keys = ['seal', 'mint', 'burn', 'gov', ...['seal', 'mint', 'burn', 'gov', 'sweep'].map(p => `prog.${p}`)]
const missing = keys.filter(k => cur[`${k}._missing`] === true)
```

So past the lock deadline, a missing config or program pages. OK.

Now, let me step back and think about what round 33 might have missed, and what a fresh read finds.

Let me look at the crank's `planCrank` for the `owed` computation of a plain active vault:

```js
else owed = pendingSats({ level: r.level, debt: r.debt_scaled, boost: r.boost_weight ?? 0, carry: r.carry_scaled ?? 0n }, acc)
```

So a plain active vault's owed at the post-distribution acc. OK.

But wait — there's a subtle issue. The crank computes `acc` (the post-distribution accumulator) only if `plan.distribute` is true. If no distribution is planned (not due, or nothing to pay), acc = cfg.acc_scaled (unchanged). Then owed is computed at the current acc. OK.

But if a distribution IS planned, acc = cfg.acc_scaled + avail * SCALE / w. The claims are computed at this new acc. But the claims run AFTER the distribute in main(). So the program's acc is the new one when the claims run. OK.

Hmm, but what if the distribute FAILS (a real failure)? Then the claims run at the OLD acc (the distribution didn't happen), but the crank computed owed at the NEW acc. So the claims would pay MORE than the vault is owed at the old acc... wait, no. The claim pays `pending / ACC_SCALE` where pending is computed by the PROGRAM at the current (old) acc. The crank's owed computation only decides WHICH vaults to include (owed >= 1 sat). If the distribution failed, the program pays at the old acc, which is LESS than the crank computed. So the claim pays less, but doesn't overpay. The vault stays owed the rest. OK, no overpayment.

Actually wait — could the crank's claim batch pay a vault that's owed 0 at the old acc (because the crank counted the failed distribution)? The program's claim: `pay = pending / ACC_SCALE; if pay == 0 continue`. So a vault owed 0 is skipped. No payment. OK, safe.

Now, the reverse: the crank plans no distribute, but a claim's in-line monthly run distributes (the month became due between plan and send). Then the claims pay at the new acc (higher). The crank included vaults owed >= 1 sat at the old acc. The in-line distribution only adds. So all included vaults are still owed >= 1 sat. OK. But vaults that became owed >= 1 sat only after the in-line distribution are NOT included (the crank didn't plan them). They wait for the next pass. OK, bounded.

Now, let me look at a potential issue with the crank's `deferredFrozen` and the alarm's `claim_deferred_frozen`. The crank defers frozen vaults (doesn't send them). The program's claim logs CBOB_CLAIM_DEFERRED_FROZEN when it skips a frozen one. But the crank doesn't send frozen vaults at all, so the program never logs them via the crank. The alarm reads the program's log line. But if the crank never sends frozen vaults, the log line only appears when someone ELSE's claim includes a frozen vault. Hmm. The alarm also reads every reserve account's state each pass (`vault_account_frozen`). So a frozen vault account is paged by the account read, not the log line. OK, covered.

Now, let me look at the alarm's frozen vault account detection:
```js
if (r.state === 'ok' && info.data.length > L.TOKEN_STATE_OFF && info.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN)
  findings.push(...D.detectFrozenVaultAccount({ vault: l.vault, mint: l.mint, isPayment: ... }))
```

So each reserve account's state byte is checked. OK.

Now, let me look at the `applyFrozenTransitions`:
```js
const key = `${f.kind}:${f.asset ?? ''}:${f.mint ?? ''}`
```
So a freeze is keyed by kind:asset:mint. A new freeze pages urgent; a standing one is INFO. OK.

Now, let me look at a potential issue: the alarm's `detectFrozenVaultAccount` is called for EVERY reserve account (cbBTC, $GARY, $GIRAFFISH). But only cbBTC has a freeze authority. $GARY and $GIRAFFISH have no freeze authority (probed). So a frozen $GARY account is impossible (no freeze authority). But the detector fires for any frozen reserve. That's fine (defensive). OK.

Now, let me look at the crank's handling of a frozen vault account for ACTIVATION:
```js
// A frozen account still activates (the program reads the balance, not the state) — the claim is what defers.
```
The program's activate: `read_token` returns (amount, state), and `require!(amount >= ACTIVATION_SATS)`. It doesn't check state. So a frozen account activates. The crank: `if (!t || t.state !== 'ok') continue; if (BigInt(t.amount) >= L.ACTIVATION_SATS) plan.activate.push(...)`. The crank doesn't check frozen for activation. OK, consistent.

Now, let me look at the crank's claim for a frozen vault:
```js
if (t.frozen) { plan.deferredFrozen.push({ asset: r.asset, owed }); continue }
```
So frozen vaults are deferred, not sent. OK.

Now, let me look at a potential issue: the crank's `tokens[r.asset]` for an active vault is the RECORDED vault_ata. If the recorded account is frozen, the claim defers. OK.

Now, let me look at the alarm's `detectUnsweptRoyalties` and the reserve.

The alarm reads `royaltyLamports = BigInt(await conn.getBalance(REVENUE_PDA, 'confirmed'))`. The reserve is `cfg['mint.sol_reserve_lamports']`. The floor is `cfg['mint.sweep_floor_lamports']`. OK.

Now, let me look at the revenue cycle's `sweepAmount`:
```js
export function sweepAmount({ balance, reserve, maxPerCycle, chainCap }) {
  let amount = BigInt(balance) > BigInt(reserve) ? BigInt(balance) - BigInt(reserve) : 0n
  if (amount > BigInt(maxPerCycle)) amount = BigInt(maxPerCycle)
  if (amount > BigInt(chainCap)) amount = BigInt(chainCap)
  return amount < MIN_SWEEP_LAMPORTS ? 0n : amount
}
```

So the sweep is balance - reserve, capped by maxPerCycle (50 SOL local) and chainCap (the on-chain max_sweep_lamports, 10 SOL ruled). So the effective cap is min(50, 10) = 10 SOL. And dust under MIN_SWEEP_LAMPORTS (0.01 SOL) is not swept. OK.

Wait — the local MAX_PER_CYCLE_LAMPORTS is 50 SOL, and the chain cap is 10 SOL (ruled). So the chain cap binds. The comment says "Set this at or below the on-chain cap" — but 50 > 10. Hmm. The comment says "This is a convenience, not a control... Set this at or below the on-chain cap." But it's 50 SOL and the on-chain cap is 10 SOL. So the local constant is ABOVE the on-chain cap. Is that a problem? The sweepAmount takes min(maxPerCycle, chainCap) = min(50, 10) = 10. So the chain cap binds. The local 50 is a loose upper bound that never binds. The comment says to set it at or below the on-chain cap, but it's 50. This is a minor inconsistency: the comment's instruction isn't followed, but the chain cap makes it harmless. Actually, if a vote RAISED the on-chain cap... no, a vote can only LOWER the cap (tighten_sweep: max_sweep_lamports can only go DOWN via .min(x)). Wait:

```rust
if let Some(x) = max_sweep_lamports {
    require!(x >= c.sweep_floor_lamports && x <= MAX_SWEEP_LAMPORTS, MintError::TightenOutOfBounds);
    c.max_sweep_lamports = c.max_sweep_lamports.min(x);
}
```

So max_sweep_lamports can only DECREASE (min). So the chain cap never rises above 10 SOL. The local 50 SOL never binds. Harmless but the comment is misleading. Not a finding (the chain cap is the control).

Hmm, actually wait. Let me re-read. The comment in revenue.mjs says "Set this at or below the on-chain cap." and the value is 50 SOL. The on-chain cap at launch is 10 SOL. So the local value is 5x the on-chain cap. The sweepAmount takes the min, so 10 SOL binds. No issue. But if someone later lowered the on-chain cap to 5 SOL via vote, the min is 5. Still fine. The local 50 is just a never-binding backstop. OK, not a defect.

Now, let me look at the revenue cycle's operator floor:
```js
const OPERATOR_FLOOR = 20_000_000n     // 0.02 SOL
const opSol = BigInt(await conn.getBalance(operator.publicKey, 'confirmed'))
if (opSol < OPERATOR_FLOOR) throw ...
```

So the operator needs 0.02 SOL for fees and ATA rents. Limit 10 D2 notes: "OPERATOR_FLOOR IS the 0.02 SOL float and nothing refills it: fund it above the floor and top it up by hand." OK, accepted.

Now, let me look at a potential issue: the operator's balance is spent on fees and ATA rents over time, and nothing refills it. The swap returns the wSOL close to the operator (rent recovered). The cbBTC ATA, once created, persists. So the operator's SOL only decreases by fees. Eventually it drops below 0.02 and the cycle refuses. Limit 10 D2 covers this (top up by hand). OK.

Now, let me look at the crank's key. The crank key pays fees and reveal rent. It's refused below the plan cost. The reveals' rent is spent (Core's attribute rent). Does the crank key get refilled? The reveal rent goes to... Core's rent for the attribute bytes, which goes to the payer (the crank key pays it, and it's rent, recovered if the account closes — but the asset never closes until redemption, and then the rent goes to... hmm). Actually, the attribute rent is a cost. The crank key depletes over time. The floor check refuses a pass that can't afford its plan, and pages. A human tops it up. OK, operational.

Now, let me look at a potential issue with the crank's `budgetPlan` and the floor reserve:

```js
const room = BigInt(lamports) - planCostLamports(base) - BigInt(floor)
const n = room > 0n ? Number(room / (SIG_FEE_LAMPORTS + REVEAL_RENT_LAMPORTS)) : 0
```

So reveals are budgeted to keep the floor in reserve. OK (round 30 L2).

Now, let me look at the alarm's `detectCrankSilent`:
```js
const last = [stampSec, armedSinceSec].filter(v => v !== null && v !== undefined).reduce((a, b) => (b > a ? b : a), null)
const ref = last ?? nowSec
if (BigInt(nowSec) - BigInt(ref) <= BigInt(maxAgeSecs)) return []
```

So it pages if the newest of (heartbeat, armed-since) is over 3h old. OK.

Now, let me look at the crank's heartbeat write:
```js
if (!REVEAL_ONLY) {
  const BEAT = ...
  try { fs.writeFileSync(BEAT, JSON.stringify({ atSec: ..., failures: failures.length, problems: plan.problems }) + '\n') }
  catch (e) { failures.push(`heartbeat ${BEAT}: ${e.message}`) }
}
```

So the heartbeat carries failures and problems. The alarm's detectCrankHealth reads them. OK.

Now, let me look at `detectCrankHealth` once more:

```js
if (beat && beat.atSec !== next.lastAt) {
  const problems = {}
  for (const p of beat.problems || []) { if (covered(p)) continue; const key = problemKey(p); problems[key] = { n: (next.problems[key]?.n ?? 0) + 1, text: p } }
  next = { lastAt: beat.atSec, failStreak: beat.failures > 0 ? next.failStreak + 1 : 0, problems }
}
```

So a NEW heartbeat (new atSec) advances the streaks. A problem's count increments if present in consecutive passes. But `problems` is REBUILT each pass (only the current beat's problems, with counts carried from next.problems). So a problem absent in the current beat is dropped (not in the new problems map). OK.

Hmm, but there's a subtle issue: `problemKey` replaces numbers with '#'. So "owed 9 sats" and "owed 10 sats" have the same key. OK, that's intended (the numbers move).

Now, the prune:
```js
for (const [key, v] of Object.entries(next.problems)) if (covered(v.text)) delete next.problems[key]
```

So covered problems are pruned even on a duplicate heartbeat. OK (round 27 L2).

Now, let me look at a potential issue: the alarm reads the crank's heartbeat, but the heartbeat is written by the crank's full pass. If the crank's full pass is dry-run (not --live), no heartbeat. The alarm's crank_silent only pages if the crank is ARMED (--live). OK.

Now, let me look at the `crankArmed` and the installer's posture print.

```js
export function crankArmed(crontab) {
  return String(crontab || '').split('\n').some(l => !/^\s*#/.test(l) && /#cbob-vault-cron crank\s*$/.test(l)
    && !/--reveal-only/.test(l) && /\bbank\/crank\.mjs --live\b/.test(l))
}
```

So armed = a tagged, uncommented, full-pass (not reveal-only) crank line with --live. OK.

The installer's posture print:
```sh
if crontab -l 2>/dev/null | grep -E -- "$TAG crank[[:space:]]*\$" | grep -v '^[[:space:]]*#' | grep -v -- '--reveal-only' | grep -q -- '--live'; then
```

Same anchoring. OK. The selftest asserts the installer and the alarm read the same line. OK.

Now, let me look at the installer's `ours` function and the preserve logic.

```sh
ours() { grep -E -- "$TAG $1[[:space:]]*\$" <<<"$CUR" | grep -v '^[[:space:]]*#'; }
REV_LIVE=''
if ours revenue | grep -q 'revenue\.mjs --live'; then REV_LIVE=' --live'; ... fi
CRANK_LIVE=''
if ours crank | grep -q 'crank\.mjs --live'; then CRANK_LIVE=' --live'; ... fi
```

So a tagged, uncommented revenue/crank line with --live is preserved. The selftest runs the real shell logic. OK.

Now, the installer's crontab lines:
```sh
41 * * * * cd $R && mkdir -p $LOCKDIR && $FLOCK $LOCKDIR/revenue.flock /usr/bin/node bank/revenue.mjs$REV_LIVE >> $LOGDIR/revenue.log 2>&1 $TAG revenue
```

So revenue runs hourly at :41. The selftest asserts the period is 3600 and shorter than the ruled cooldown. OK.

Now, let me look at the deadman:
```sh
9 */2 * * * { [ ! -f $ALARM_STATE ] || [ -n "\$(find $ALARM_STATE -mmin +120 2>/dev/null)" ]; } && /opt/scripts/notify-gary-sms.sh "..." cbob-vault-alarm:deadman $TAG deadman
```

So every 2 hours, if the alarm state is missing or over 120 min old, page. OK.

Now, let me look at the `judgeCronTemplate`:
```js
for (const line of src.split('\n')) {
  if (!/^[0-9*]/.test(line)) continue
  if (!/node\s+bank\/\S+\.mjs/.test(line)) continue
  if (/\bflock\s+-n\b/.test(line)) continue
  if (/\$FLOCK\b/.test(line) && varHasN) continue
  bad.push(line.trim())
}
```

So every cron line running a bank/*.mjs must have flock -n. The deadman line doesn't run node (it's test/find/notify), so it's not checked. OK.

Hmm, wait — the deadman line: `9 */2 * * * { [ ! -f ... ] && ... }`. It starts with `9`, matches `/^[0-9*]/`. Does it match `/node\s+bank\/\S+\.mjs/`? No (no node bank). So it's skipped. OK.

Now, let me look at the selftest's control-table gate (F). It parses SPEC's control table and checks each row's claim. OK.

Now, let me look at the audit-coverage.sh more carefully for a bypass.

The gate reads the audit scripts (scripts/audit*.ts) to find bundled files. It checks each system file's CURRENT content was in a completed, quorate round's bundle. The `bundles()` function parses TARGETS. The `first_line_quorate` checks the verdict's first line.

Potential bypass: a MANIFEST with a high `auditors` count and a verdict with the right first line, but the bundle didn't actually include the file. The gate reads the script AS IT WAS at the audited commit (`script_at(m.get('head'), name)`) and parses its TARGETS. So the bundle is what the script would have delivered at that commit. If the script's TARGETS included the file, it's credited. OK.

But — the gate trusts the MANIFEST's `head` and `auditors`/`required`. A fabricated MANIFEST could claim a quorum. But that's the audit process's integrity, not something this gate can verify. The verdict's first line is checked. OK, this is process trust.

Now, let me look at the rehearsal-tree.sh for an issue.

The script substitutes the five program ids and the repo root path. It proves the reverse map recreates HEAD. It refuses a leftover 4+ char id prefix.

```python
for f in files:
    try: now = open(f"{dest}/{f}", encoding='utf-8').read()
    except UnicodeDecodeError: continue
    for o, _ in pairs[:-1]:
        if o[:4] in now: sys.exit(f"FATAL: {f} still holds '{o[:4]}', an abbreviated mainnet id")
```

`pairs[:-1]` — all pairs except the last (the root path). So it checks the five program ids' 4-char prefixes. OK.

Hmm, but the substitution replaces the ids everywhere, including in `bank/layout.mjs`, the programs' declare_id!, the tests, etc. And the root path. The proof reverses it. OK.

Now, the rehearsal tree shares the production node_modules (symlinked). And the keys are in .rehearsal-keys (mode 700). OK.

Now, the cron installer refuses a rehearsal tree:
```sh
[ ! -e "$R/REHEARSAL-RECORD.txt" ] || { echo "rehearsal tree: cron installation is disabled" >&2; exit 1; }
```
OK.

Now, let me look at the build-mainnet.sh for the sweep helper's byte identity.

```sh
cmp -s "$OUT/cbob_vault_sweep.so" "$LN_DIR/cbob_vault_sweep.so" || die "..."
cmp -s "$OUT/cbob_vault_sweep.so" "$ROOT/target/deploy/cbob_vault_sweep.so" || die "..."
```

So the sweep helper's mainnet bytes == localnet build bytes == target/deploy bytes (the tested ones). OK.

Now, the build deploys both mainnet and localnet builds and asks each whether it trusts the test key. For the four initializing programs. The sweep helper has no key, so it's only byte-compared. OK.

Now, let me look at a potential issue: the build's `ask` function deploys and runs tests/initauth.test.ts. The test checks the INIT_AUTHORITY behavior. OK.

Now, let me look at the launch checker.

`judgeLaunch` checks every value is RULED, matches the pins, passes the initialize bounds, the alarm's production list, and the PoB root recomputes. OK.

The two OPEN values (charter_opens_at, lock_deadline) refuse the file until filled. OK.

Now, let me look at a potential issue: the checker's `cur` for the alarm's detectStandingRisks includes `mint.charter_closes_at: Number(v('charter_opens_at')) + Number(v('charter_secs'))`. And the alarm's production list checks `mint.charter_secs` = 604800 (computed as closes - opens). The checker's cur computes charter_secs via the detectStandingRisks internal logic (it computes cur['mint.charter_secs'] from closes - opens). Wait, detectStandingRisks does:
```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
  cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```
So it computes charter_secs from the two dates. The checker passes charter_closes_at = opens + charter_secs. So charter_secs = charter_secs. OK.

Now, let me look at the PoB merkle root recomputation. The checker uses `rootOf` from pob-merkle.mjs. OK.

Now, let me think about what's genuinely new to find. Let me re-read the swap's `readWhirlpool` offsets against the real account.

```js
const w = { tickSpacing: d.readUInt16LE(41), feeRate: d.readUInt16LE(45), liquidity: readU128(d, 49),
  sqrtPrice: readU128(d, 65), tickCurrent: d.readInt32LE(81),
  mintA: pk(d, 101), vaultA: pk(d, 133), mintB: pk(d, 181), vaultB: pk(d, 213) }
```

The comment says: disc8 config32 bump1 tick_spacing u16 seed[2] fee_rate u16 protocol_fee_rate u16 liquidity u128 sqrt_price u128 tick_current i32 owed_a u64 owed_b u64 mint_a vault_a fee_growth_a u128 mint_b vault_b.

Let me compute offsets: disc 0-8, config 8-40, bump 40, tick_spacing 41-43, seed 43-45, fee_rate 45-47, protocol_fee_rate 47-49, liquidity 49-65, sqrt_price 65-81, tick_current 81-85, owed_a 85-93, owed_b 93-101, mint_a 101-133, vault_a 133-165, fee_growth_a 165-181, mint_b 181-213, vault_b 213-245. 

So tickSpacing at 41, feeRate at 45, liquidity at 49, sqrtPrice at 65, tickCurrent at 81, mintA at 101, vaultA at 133, mintB at 181, vaultB at 213. Matches the code. And the fork test reads the real pool and swaps succeed, so the offsets are proven. OK.

Now `readLbPair`:
```js
const p = { activeId: d.readInt32LE(76), binStep: d.readUInt16LE(80), status: d[82],
  mintX: pk(d, 88), mintY: pk(d, 120), reserveX: pk(d, 152), reserveY: pk(d, 184) }
```

The comment: active_id i32 @76, bin_step u16 @80, status u8 @82, token_x_mint @88, token_y_mint @120, reserve_x @152, reserve_y @184. The fork test proves these. OK.

Now, let me look at the Meteora swap's `swap_for_y` inference. The DLMM swap instruction doesn't take a direction byte; it infers from the token accounts. user_token_in = wSOL (Y), user_token_out = cbBTC (X). So swap_for_y = false (swapping Y for X). The program checks that user_token_in's mint is token_y and user_token_out's mint is token_x. OK.

Hmm, wait — actually, let me double-check the Meteora DLMM swap account order against the IDL. The lb_clmm `swap` accounts: lb_pair, bin_array_bitmap_extension (optional), reserve_x, reserve_y, user_token_in, user_token_out, token_x_mint, token_y_mint, oracle, host_fee_in (optional), user, token_x_program, token_y_program, event_authority, program. Then remaining: bin arrays. The code matches this. And the fork test swaps through the real Meteora program successfully. OK, proven.

Now, let me look at the Orca swap account order. Whirlpool `swap` (v1): token_program, token_authority, whirlpool, token_owner_account_a, token_vault_a, token_owner_account_b, token_vault_b, tick_array_0, tick_array_1, tick_array_2, oracle. The code matches. Fork-proven. OK.

Now, let me look at a potential issue: the swap uses the classic SPL Token program for both venues. cbBTC and wSOL are classic SPL. The Meteora pool's token_x_program and token_y_program are both passed as TOKEN (classic). OK, since both mints are classic.

Now, let me look at the `swapInstructions` CU limit: 400,000. The fork test swaps land within it. OK.

Now, let me look at the judge's CU check: `data(cu).readUInt32LE(1) !== SWAP_CU_LIMIT`. SetComputeUnitLimit data: [2, u32 LE units]. So data[0]=2, units at 1-5. OK.

Now, let me look at a potential issue: the judge refuses a priority fee (ComputeBudget data[0] === 3). But what about a ComputeBudget instruction with data[0] === 4 (SetLoadedAccountsDataSizeLimit) or data[0] === 1 (RequestHeapFrame) or data[0] === 0 (SetComputeUnitLimit... wait, 2 is SetComputeUnitLimit in the SDK). Let me check: ComputeBudgetInstructionType: RequestUnits = 0 (deprecated), RequestHeapFrame = 1, SetComputeUnitLimit = 2, SetComputeUnitPrice = 3, SetLoadedAccountsDataSizeLimit = 4. The SDK's `ComputeBudgetProgram.setComputeUnitLimit` produces data[0] = 2. The judge checks instruction 0 is data[0]===2 with the limit. And it refuses data[0]===3 (price) anywhere. But what about data[0]===1 (heap frame) or 4 (loaded accounts)? The judge's per-instruction loop only refuses data[0]===3. And the exact-sequence check requires instruction 0 to be the limit. A second ComputeBudget instruction (heap frame) would make ixs.length !== 7 → refused. So any extra ComputeBudget instruction is caught by the length check. OK.

Wait, but what if a tampered builder puts a heap-frame instruction in place of... no, the exact 7-instruction sequence is required. Any deviation changes the length or the positional checks. OK.

Now, let me look at the judge's System transfer check:
```js
const transfers = ixs.filter(ix => ix.programId.equals(SystemProgram.programId))
if (transfers.length !== 1) problems.push(...)
```
So exactly one System instruction. And it's the wrap (instruction 2). The ATA creations use the ATA program (which internally calls System, but those are CPIs, not top-level instructions). OK.

Now, let me look at the judge's Token instruction check:
```js
if (ix.programId.equals(TOKEN) && d[0] !== 17 && d[0] !== 9)
  problems.push(`a Token ${TOKEN_IX_NAMES[d[0]] ?? `instruction ${d[0]}`}: ...`)
```
So only SyncNative (17) and CloseAccount (9) at the top level. OK.

Now, let me look at a potential issue: the judge checks `ixs.length !== 7`. But what if a tampered builder produces 7 instructions with the right programs but a different 5th instruction's keys? The positional checks catch it. OK.

Now, let me think about the revenue cycle's `market` re-read and the venue loop once more.

```js
const m2 = await market(conn, amount)
...
const guaranteed = m2.f.minSats
...
for (const venue of m2.venues) {
  const ixs = SW.swapInstructions({ venue, owner: operator.publicKey, lamportsIn: amount, minSats: guaranteed, w: m2.w, p: m2.p, bitmapExists: m2.bitmapExists })
  const bad = SW.judgeSwapInstructions(ixs, operator.publicKey, venue, { lamportsIn: amount, minSats: guaranteed })
  if (bad.length) throw ...
  try { cycle.swapSig = await sendAndConfirmTransaction(...); cycle.swapVenue = venue; save(led); break }
  catch (e) { ... }
}
```

So for each venue in m2.venues (Orca first if usable), build, judge, send. On refusal, try next. On unknown, stop. On landed, break. OK.

Hmm — but `m2.w` and `m2.p` are the pool states read in market(). If a venue is in m2.venues, its pool read succeeded (w or p non-null). If Orca is not usable (read failed or deviation), w is null and 'orca' is not in venues. OK.

But wait — what if BOTH venues are usable, Orca's swap is refused (e.g., a tick array issue), and Meteora's swap is built with `p: m2.p`? m2.p is the Meteora pool state. OK.

Now, there's a subtle issue: the swap is built with the pool state read at market() time. Between the read and the send, the pool's active bin / tick could move (another swap). Then the derived bin arrays / tick arrays might be wrong (the swap crosses into a different array). The program would refuse (wrong array) or the floor binds. So a stale read → refusal → next venue or open cycle. Loud. OK.

Now, let me look at the revenue cycle's return transfer:
```js
cycle.returnSig = await sendAndConfirmTransaction(conn, new Transaction().add(
  createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, revAta, REVENUE, CBBTC),
  createTransferCheckedInstruction(opAta, CBBTC, revAta, operator.publicKey, got, 8)),
  [operator], { commitment: 'confirmed' })
```

So the return creates the revenue ATA (idempotent) and transfers `got` (the whole operator cbBTC balance) to it. `createTransferCheckedInstruction(opAta, CBBTC, revAta, operator, got, 8)` — source opAta, mint CBBTC, dest revAta, owner operator, amount got, decimals 8. OK.

Now, the revenue ATA is derived with `getAssociatedTokenAddressSync(CBBTC, REVENUE, true)` — the `true` is allowOwnerOffCurve (REVENUE is a PDA). OK.

Now, let me look at the split's bank ATA: `ataOf(bankWallet)` = `getAssociatedTokenAddressSync(CBBTC, w, true)` — allowOwnerOffCurve true (the Squads is off-curve). OK.

Now, let me look at a potential issue: the revenue cycle's `enterStage('return')` and the delta read. If the return's `requireTokenAmount` throws (the operator ATA is absent/foreign/malformed), the cycle stays open. But the operator ATA was created in prepare. So it's present. Unless someone closed it... the operator key would have to sign that. OK.

Now, let me look at the alarm's `detectUnreconciledRevenue` grace and the `cycleStartMs`.

```js
export function cycleStartMs(c, sweeps = [], nowMs = Date.now(), chainNowMs = null) {
  let t = Date.parse(c?.startedAt)
  const hit = (sweeps || []).find(e => e && e.sig && e.sig === c?.sweepSig && ...)
  if (hit && chainNowMs !== null) {
    const at = Number(hit.blockTime) * 1000
    return ... nowMs - (chainNowMs - at) ...
  }
  if (hit) t = ... Math.min(t, blockTime*1000) ...
  return Number.isFinite(t) && t <= nowMs ? t : -Infinity
}
```

So the cycle's start is capped by the sweep's block time (chain). With chainNowMs, the age is translated to wall-clock domain. OK.

Now, let me look at a potential issue: the alarm passes `chainNow: nowSec * 1000` and `now: wallSec * 1000`. So chainNowMs = chain time in ms, nowMs = wall time in ms. cycleStartMs translates the sweep's chain block time to wall-clock age. OK.

Now, let me look at the `closesCycle` anchor once more:
```js
const anchor = Number(c?.returnBlockTime)
const anchored = c?.returnBlockTime !== null && ... && Number.isFinite(anchor) && anchor > 0
const afterMs = Date.parse(c?.returnedAt || c?.startedAt)
if (!anchored && !Number.isFinite(afterMs)) return null
return dedupeSeenSplits(splits)
  .filter(e => !exclude.has(splitSig(e)) && splitTime(e) !== null && splitTotal(e) !== null)
  .filter(e => (anchored ? splitTime(e) >= anchor : splitTime(e) * 1000 >= afterMs - 60_000) && (upTo === null || splitTime(e) <= upTo))
  .sort((a, b) => splitTime(a) - splitTime(b))
  .find(e => splitTotal(e) >= need) ?? null
```

So the anchor is the return's block time (chain) if available, else returnedAt - 60s (box). The split must be at or after the anchor and >= the return amount. OK.

Now, let me look at a potential issue: `splitTime(e) * 1000 >= afterMs - 60_000` mixes chain (splitTime) and box (afterMs) domains. The 60s slack covers skew. Round 25 I1 anchored on returnBlockTime to avoid this; legacy rows keep the 60s slack. OK, bounded.

Now, let me look at the alarm's `detectSplitClaims` window:
```js
const counts = c => !!(c?.splitSig || c?.splitByOther) || (!c?.sendRejected && BigInt(c?.sweptLamports ?? c?.intendedLamports ?? 0) > 0n)
const recent = new Set([...cycles.filter(counts).slice(-verifyLastN), ...cycles.filter(c => c?.sweepSig && sweptOnChain.has(c.sweepSig))])
```

So the window is the last 200 "counting" cycles plus any whose sweep the scan saw. OK (round 24 L10c).

Now, let me look at a potential issue: a cycle with a splitSig that's NOT in the seen splits and past the grace → split_not_on_chain CRITICAL. But the seen splits come from the scan, which is bounded (2000 per program per pass). A very old split might not be in seenSplits if the scan hasn't reached it. But seenSplits is never sliced (accumulates). So once seen, always remembered. OK.

Hmm, but seenSplits only accumulates from the scan of the four programs. A split is a MINT transaction, so it's in MINT's walk. If MINT's walk has a backlog, a recent split might not be seen yet. But the cycle's grace (1h) covers the scan lag. OK.

Now, let me look at the alarm's `detectUnledgeredSweeps` deferred mechanism:
```js
const stale = !opts.blockTime || !opts.now || (opts.now - opts.blockTime) > graceSecs
...
if (!row) {
  if (!stale) { if (defer) defer.push({...}); continue }
  out.push({ kind: 'unledgered_sweep', ... })
  continue
}
```

So a fresh sweep (within 900s grace) with no row is deferred. A stale one with no row pages. The deferred ones are judged next pass by detectDeferredSweeps. OK.

Now, `opts.now` is `nowSec` (chain) and `opts.blockTime` is `s.blockTime` (chain). Same domain. OK.

Now, let me look at a potential issue: the alarm's `seenSweeps` accumulation:
```js
if (opts.seenSweeps && signature) opts.seenSweeps.push({ sig: signature, blockTime: opts.blockTime ?? null })
```
So every sweep the scan sees is pushed. Then:
```js
const allSweeps = [...(prev?.seenSweeps || []), ...seenSweeps].filter((e, i, a) => e?.sig && a.findIndex(x => x.sig === e.sig) === i)
```
Deduped. OK. But this grows unboundedly (every sweep ever seen). Over years, that's a lot. Hmm — but sweeps are at most 4/day, so ~1460/year. Manageable. OK.

Now, let me look at the `seenSplits`:
```js
seenSplits: D.dedupeSeenSplits([...seenSplits, ...(prev?.seenSplits || [])])
```
Also accumulates. Splits are hourly (the crank splits every pass). So ~24/day, ~8760/year. The state file grows. Hmm — over years, the state file could get large. But it's bounded by the number of splits, and each entry is small. Not a correctness issue. OK.

Actually wait — the crank splits EVERY pass (hourly), and the alarm runs every 30 min. So each split is seen once. ~8760/year. Each entry ~100 bytes. ~876 KB/year. The state file read/write each pass. Manageable for years. OK.

Now, let me look at a potential issue with the alarm's `logGaps` growth. Round 32 L3: unreviewed gaps are never evicted, and over 2000 escalate to CRITICAL. The list grows by at most 8000 entries a pass (a stranger paying one fee each). Over time, with no review, the list grows unboundedly. But the escalation pages CRITICAL, forcing review. OK, bounded by the human response.

Now, let me look at the crank's `describePlan` and the logging. Not security-critical.

Now, let me look at a potential issue in the swap's `oracleFloor` with the confidence check:
```js
if (p.conf * 10_000n > p.price * BigInt(MAX_ORACLE_CONF_BPS)) throw ...
```
So conf/price > 30/10000 = 30 bps → refused. OK.

Now, the age check:
```js
if (nowSec - p.publishTime > MAX_ORACLE_AGE_SECS) throw ... // stale
if (p.publishTime - nowSec > MAX_ORACLE_FUTURE_SECS) throw ... // future
```
OK.

Now, let me look at a potential overflow: `p.conf * 10_000n` — conf is a u64 read as BigInt. * 10000 is fine in BigInt. `p.price * 30n` fine. OK.

`num = BigInt(lamportsIn) * sol.price` — lamportsIn up to 50 SOL = 5e10, sol.price ~1.2e10. Product ~6e20, fine in BigInt. `den = btc.price * 10n` ~8.6e13. OK.

Now, let me look at the `satsPerLamport` float: `Number(sol.price) * 10 ** sol.expo / (Number(btc.price) * 10 ** btc.expo) / 10`. Number(1.2e10) is exact (within float53). 10**-8 is a float. The result is ~1.4e-5. Fine for the deviation filter. OK.

Now, let me look at a potential issue: the `oracleFloor` throws if `minSats <= 0n`. So a sweep too small to buy a sat is refused. And `sweepAmount` returns 0 for dust under MIN_SWEEP_LAMPORTS. So the revenue cycle skips dust before reaching oracleFloor. OK.

Now, let me look at the revenue cycle's `q.outAmount = String(m1.f.expectedSats)`. And the re-quote drift: `minOut = BigInt(q.outAmount) * 9800 / 10000`. So the post-sweep expectation must be >= 98% of the pre-sweep one. OK.

Now, let me look at a potential issue: the revenue cycle reads the market TWICE (m1 before the sweep, m2 after). Between them, the sweep lands (a few seconds). The oracle price could move. The drift check (200 bps) catches a big move. OK.

Now, let me look at the alarm's `detectRedemptionRate`:
```js
const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
if (c.remaining > near) return []
return [{ kind: 'redemptions_near_cap', ... }]
```

So it pages when remaining <= max(1, 20% of cap). And `if (c.remaining >= c.cap) return []` (idle window never pages). OK.

Now, `redemptionCapacity`:
```js
const live = minted - burned - bare
if (live < 0n) return null
let cap = (live * 210n + 9_999n) / 10_000n
if (cap < 1n) cap = 1n
if (cap > BigInt(RATE_RING)) cap = BigInt(RATE_RING)
const inWindow = BigInt(ring.filter(t => now - BigInt(t) < window).length)
return { live, cap, remaining: cap > inWindow ? cap - inWindow : 0n }
```

So cap = ceil(live * 2.1%), bounded by 64. remaining = cap - redemptions in the window. OK. Matches BURN's arithmetic.

Hmm, `live < 0n` returns null (unreadable). Round 33 C09 noted this: "live < 0 makes the rate monitor quiet". The verdict: "MECHANISM MEASURED; UNREACHABLE AT THE AUDITED PROGRAMS". OK.

Now, let me look at the ring read: `cur['burn.rate_ring']` is an array of 64 i64 (as strings after flatten). `ring.filter(t => now - BigInt(t) < window)`. Empty slots are 0 (decades ago), so now - 0 = huge > window → not in window. OK.

Now, let me look at the alarm's `detectIndexShortfall` and the mintedAfter race:
```js
const after = opts.mintedAfter === undefined || null ? null : BigInt(opts.mintedAfter)
if (after !== null && after >= total && seen >= total && seen <= after) return out
if (seen !== total) { ... index_disagrees_with_chain ... }
```

So if the index count is between the two chain reads (a sale landed during the walk), quiet. OK.

Now, let me look at a potential issue: the alarm reads `minted_total` from the config (readConfigs), then re-reads it after the DAS walk (readMintedTotal). If the first read is N and the second is N+1 (a sale), and the index shows N+1, then seen=N+1, total=N, after=N+1: after >= total (N+1 >= N), seen >= total (N+1 >= N), seen <= after (N+1 <= N+1) → quiet. OK.

But what if the index shows N (hasn't indexed the sale yet)? seen=N, total=N: seen === total → quiet (the second check). OK.

Now, let me look at the alarm's `detectVaultSetChange` and the trustCurrent flag:
```js
vaults: setChange.trustCurrent ? vaults : (prev?.vaults || vaults)
```
So an untrusted list doesn't overwrite the baseline. OK.

Now, let me look at a potential issue: the alarm's `balances` and the carry-forward.

```js
chunk.forEach((l, j) => {
  const info = infos?.[j] ?? null, r = readTokenAccount(info)
  const jr = D.judgeReserveRead(prev?.balances?.[l.key], r)
  if (jr.value !== null) balances[l.key] = jr.value
  if (jr.finding) findings.push({ kind: 'balance_unreadable', ... })
  if (r.state === 'ok' && ... frozen) findings.push(...D.detectFrozenVaultAccount(...))
})
```

`judgeReserveRead`:
```js
export function judgeReserveRead(prevValue, read) {
  const prior = prevValue === undefined || null ? null : String(prevValue)
  if (read?.state === 'ok') return { value: String(read.amount), finding: null }
  if (read?.state === 'absent' && (prior === null || BigInt(prior) === 0n)) return { value: '0', finding: null }
  return { value: prior, finding: { state: read?.state ?? 'no answer', carried: prior } }
}
```

So an ok read → its amount. An absent read with no prior or zero prior → '0' quietly. Anything else → carry the prior, HIGH finding. OK.

Hmm, but there's a subtle issue: a vault's reserve account that was FUNDED (prior > 0) and now reads absent → carry the prior, HIGH finding. But a redeemed vault's account is closed (absent) — but redeemed vaults are burned, so they're not in the `vaults` (live) list, so no leg is created for them. OK.

Wait — actually, the legs are built for `vaults` (live). A redeemed vault is not live, so no leg. But DAS lag: a vault redeemed between passes might still be listed live. Then its account is absent (closed by the sweep). judgeReserveRead: prior > 0, read absent → carry prior, HIGH balance_unreadable. And correlateBurns downgrades `balance_unreadable` with state 'absent' on a redeemed asset to INFO. OK:

```js
if (f.asset && viaProgram.has(f.asset) && f.kind === 'balance_unreadable' && f.state === 'absent') {
  out.push({ ...f, severity: S.INFO, ... })
}
```

OK.

Now, let me look at a potential issue: the alarm's `detectBalanceDrops` keys. The balances are keyed `<vault>` for cbBTC and `<vault>:<mint>` for others. detectBalanceDrops splits the key:
```js
const [vault, mint = null] = String(asset).split(':')
```
So the finding's asset is the vault, mint is set for non-cbBTC. correlateBurns matches on the vault. OK (round 24 L8).

Now, let me look at the alarm's `detectApprovals` fallback:
```js
const owner = pdaSet.has(info.owner) ? info.owner : ataOwner[info.source]
if (!pdaSet.has(owner)) continue
```

So if the parse has `owner` and it's a vault PDA, use it. Else resolve the owner from the account via ataOwner. OK.

Now, let me look at the alarm's `detectPdaTokenAccounts`:
```js
if (ix.program === ATA_ID) { wallet = i.wallet; account = i.account }
else if (TOKEN/TOKEN22 && /^initializeAccount/) { wallet = i.owner; account = i.account }
if (!wallet || !pdaSet.has(wallet)) continue
const expected = expectedAtas.has(account)
```

So a token account created for a vault PDA: canonical ATA → INFO, non-canonical → CRITICAL. OK.

Now, let me look at a potential issue: the alarm's `atas` set (expected ATAs) is built for LIVE vaults only:
```js
for (const v of vaults) { ... atas.add(ata(new PublicKey(m), p).toBase58()) }
```
So a canonical ATA created for a BURNED vault's PDA would be... the atas set doesn't include burned vaults' ATAs. So a reserve ATA created for a burned vault reads as non-canonical (CRITICAL). Hmm — but a burned vault's PDA can't receive a canonical ATA creation in a transaction we scan (the creation touches the ATA program, not our programs, so it's not scanned anyway). Wait — detectPdaTokenAccounts runs on the scanned transactions (our four programs). An ATA creation for a vault PDA inside one of OUR transactions... when does that happen? The crank doesn't create vault ATAs. A redemption creates the OWNER's destination ATAs, not the vault's. Hmm. Actually, the vault's reserve ATAs are created by... the holder depositing? No — anyone can create the canonical ATA for a vault PDA (idempotent). That transaction touches only the ATA program, not our programs, so it's NOT scanned. So detectPdaTokenAccounts only fires for ATA creations inside transactions that touch our programs. When does that happen? Rarely. OK, the reconcile (daily) covers the state-based detection. OK.

Now, let me look at the reconcile:
```js
for (const v of live) {
  const p = pda(...)
  const expected = new Set(reserve.map(m => ata(m, p).toBase58()))
  for (const prog of [TOK, TOKEN22]) {
    const r = await conn.getTokenAccountsByOwner(p, { programId: prog }, 'confirmed')
    const owned = r.value.map(...)
    findings.push(...D.detectUndeclaredTokenAccounts(v, expected, owned))
  }
}
```

So the reconcile enumerates each live vault's token accounts (both programs) and reports undeclared ones. OK.

Now, `detectUndeclaredTokenAccounts`:
```js
for (const { address, amount } of owned) {
  if (expected.has(address)) continue
  out.push({ kind: 'undeclared_token_account', severity: S.CRITICAL, ... })
}
```

So any non-canonical account, even with zero balance, fires. OK.

Now, let me look at a potential issue: the reconcile's `getTokenAccountsByOwner` for a vault PDA. This is an RPC call per vault per token program. At 2,100 vaults, that's 4,200 calls. Heavy but daily. OK.

Now, let me look at the alarm's `report` and the reconcile's separate state/labels. OK, covered by the selftest's R26 L4 arms.

Now, let me step back and think about the four questions about the accepted limits.

1. Is any limit WORSE than stated?
2. Is anything listed as a limit not actually a limit?
3. Is any DISCHARGED item not actually discharged?
4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

Let me think about limit 10 (the swap operator) and the round 33 repair. The repair made the sweep window symmetric and required uncertain sends to be confirmed by a direct lookup. Is the repair sound? I analyzed it above — it seems sound. But let me look for a subtle hole.

The detector: `|t - st| <= half` where t is the chain's last_sweep_at and st is the box's startedAt. The claim: a thief's sweep can't sit inside an honest cycle's window.

Consider: the honest cycle runs, its sweep lands at chain time T. The row's startedAt is box time ≈ T (plus skew). The thief's next legal sweep is at T + cooldown (chain). The detector judges last_sweep_at = T + cooldown (the thief's, the latest). Is there a cycle with |T + cooldown - st| <= half? The honest cycle's st ≈ T. |T + cooldown - T| = cooldown = 2*half > half. Not explained. Pages. Good.

But what if the thief sweeps FIRST, then the honest cycle? Thief at T0 (chain). Honest cycle at T0 + cooldown (its sweep lands then; startedAt ≈ T0 + cooldown box). The detector judges the LATEST last_sweep_at. After both, last_sweep_at = T0 + cooldown (the honest one). Explained by the honest cycle. The thief's sweep at T0 is masked (only latest visible). Stated limit.

But between the thief's sweep and the honest one, if the alarm runs, last_sweep_at = T0 (the thief's). Is there a cycle with |T0 - st| <= half? The honest cycle hasn't run yet. Previous honest cycles: the last one was at T0 - cooldown (its startedAt ≈ T0 - cooldown). |T0 - (T0 - cooldown)| = cooldown > half. Not explained. Pages. Good.

Hmm, but what about the honest cycle that ran BEFORE the thief's sweep? Its startedAt ≈ T0 - cooldown. The thief's sweep at T0: |T0 - (T0 - cooldown)| = cooldown = 2*half > half. Not explained. Good.

Now, the skew attack: can a thief exploit the symmetric window? The window is [st - half, st + half] around the honest cycle's start. The thief's sweep must satisfy the on-chain cooldown relative to the honest sweep. If the honest sweep landed at T, the thief's is at T + cooldown at the earliest. The honest cycle's st ≈ T (box). The window is [T - half, T + half]. The thief's sweep at T + 2*half is outside. Good.

But what if the box clock is heavily skewed (say 2 hours ahead)? Then st = T + 7200 (box 2h ahead). The window is [T + 7200 - 10800, T + 7200 + 10800] = [T - 3600, T + 18000]. The thief's sweep at T + cooldown = T + 21600 is outside (21600 > 18000). Good. At box 3h ahead: st = T + 10800, window [T, T + 21600]. The thief's sweep at T + 21600 is ON the boundary (|21600 - 10800| = 10800 <= 10800). Explained! So with the box 3h ahead, a thief's sweep exactly one cooldown after the honest one is explained.

Hmm. But wait — the box being 3 hours ahead is a broken box. And the thief doesn't control the box clock. The window is symmetric to tolerate skew; the cost is that extreme skew (>= half the cooldown) lets a thief's sweep be explained. But at that point, the box's clock is 3 hours off, which breaks other things (the alarm's wall-clock judgments). And the thief's sweep is still caught by the transaction walk (unledgered_sweep) — the state check is a BACKSTOP. So the masking requires a broken box clock AND the walk being flooded. Bounded. And the round 33 review explicitly chose the symmetric window to avoid false positives on honest skew. The residual (extreme skew + flood) is a reasonable accepted boundary. But is it STATED? Limit 10's round-33 paragraph says "the window is symmetric because the cycle's start is the box's wall clock and the sweep's time the chain's, so ordinary clock skew cannot page an honest sweep; a thief's sweep cannot sit inside an honest cycle's window, since it must wait a full cooldown after the honest one". The claim "a thief's sweep cannot sit inside an honest cycle's window" is TRUE only when the box clock is within half a cooldown of the chain. With extreme box skew, it can. But that requires a broken box, and the walk is the primary control. I'd call this a boundary worth noting but not a defect — the box clock being 3h off is itself a paged condition (other detectors use wall clock). Actually, is it? Let me check — the alarm uses `wallSec = Math.floor(Date.now()/1000)` for several detectors and `nowSec` (chain) for others. A 3h skew would affect the wall-clock ones (crank_silent uses wallSec, etc.). Hmm, but nothing explicitly pages "box clock is 3h off chain". Let me not over-claim this; it's a LOW boundary at most.

Actually, let me reconsider. The thief's sweep being explained requires |t_thief - st_honest| <= half. st_honest is the honest cycle's box-time start. t_thief is the thief's chain-time sweep. The honest sweep lands at chain time t_honest ≈ st_honest - skew (where skew = box - chain). The thief's sweep must be >= t_honest + cooldown (on-chain). So t_thief >= st_honest - skew + cooldown. For the thief's sweep to be explained: t_thief <= st_honest + half. So st_honest - skew + cooldown <= st_honest + half → cooldown - half <= skew → skew >= half = cooldown/2 = 3h. So yes, box 3h+ ahead lets a thief's sweep be explained. But this is a broken-box scenario, and the walk catches it. LOW at most. I'll note it as a boundary observation, not a finding, since the box clock being 3h off is a severe operational condition that other checks would surface, and the primary control (the walk) is intact.

Hmm, actually, wait. Let me reconsider whether this is even reachable. The honest cycle writes its row with startedAt = box time. If the box is 3h ahead, startedAt is 3h ahead of the chain. The thief's sweep at chain time t_honest + cooldown. The detector compares t_thief (chain) with st_honest (box, 3h ahead). |t_thief - st_honest| = |t_honest + 21600 - (t_honest + 10800)| = 10800 <= 10800. Explained. So yes, reachable with a 3h-ahead box. But again, the walk. And a 3h-ahead box is pathological. I'll mention it as a LOW boundary note.

Actually, let me reconsider the severity. The state check is a BACKSTOP to the walk (which can be flooded). The scenario: box 3h ahead + walk flooded + thief sweeps. Then the state check is fooled AND the walk is delayed. But the box being 3h ahead is a separate operational failure. And the flood is bounded (0.01 SOL/pass). And the thief needs the operator key. So it's a three-way conjunction. LOW. I'll note it.

Now, let me look for something more concrete. Let me re-read the crank's reveal ordering and the `capturedThisPass` set.

```js
const capturedThisPass = new Set()
for (const r of records) {
  if (r.level !== 0 || r.entropy_set) continue
  const rs = BigInt(r.reveal_slot)
  if (BigInt(slot) > rs + BigInt(L.REVEAL_WINDOW_SLOTS)) plan.reschedule.push(r.address)
  else if (slot > readySlot(r.reveal_slot)) { plan.capture.push(r.address); capturedThisPass.add(r.address) }
}
for (let i = BigInt(cfg.revealed_total); ; i++) {
  const r = byIndex.get(i)
  if (!r || r.level !== 0) break
  if (!(r.entropy_set || capturedThisPass.has(r.address))) break
  plan.reveal.push(r.address)
}
```

So a vault captured this pass counts as ready for its reveal. But the reveal runs AFTER the capture in main() (capture loop, then reveal loop). So the capture lands first, then the reveal reads the stored entropy. OK.

But wait — the reveal's `judgeRevealAttrs` reads the asset's attributes and checks the hash. The capture doesn't change the attributes. So the reveal's attribute check is independent of the capture. OK.

Hmm, but there's a subtle issue: the reveal is planned for a vault captured THIS pass. But the reveal instruction's `try_capture` inline would find the entropy already set (by the capture), so it uses the stored entropy. OK.

Now, what if the capture lands but the reveal's attribute read happens before the capture's confirmation? In main(), the capture is `await run(...)` (confirmed), then the reveal loop. So the capture is confirmed before the reveal. OK.

Now, let me look at a potential issue: the reveal lane (--reveal-only) runs every minute and plans captures and reveals. The full lane also plans them. They race. The loser's capture gets AlreadyCaptured (benign), the loser's reveal gets AlreadyRevealed (benign) or judgeRevealAttrs 'revealed'. OK.

Now, let me look at the crank's `readySlot` vs the program's `try_capture` once more.

The program's try_capture: A = first produced >= reveal_slot; B = first produced >= (A/4 + 2)*4; C = first produced >= (B/4 + 2)*4. The crank's readySlot(reveal_slot) = ((reveal_slot/4 + 2)*4 / 4 + 2)*4 assuming A = reveal_slot. With skips, A > reveal_slot, so the actual C is later. The crank's readySlot underestimates. So the crank might plan a capture before C exists → RevealTooEarly (benign). The next pass retries. OK.

But — is there a case where the crank's readySlot OVERESTIMATES and the capture window lapses? readySlot assumes A = reveal_slot (no skip). If A is skipped, the real C is LATER, so readySlot underestimates (plans too early, benign). If no skips, readySlot is exact. So readySlot never overestimates. The window check (`slot > rs + REVEAL_WINDOW_SLOTS`) is separate and exact. OK.

Now, let me look at the crank's reschedule planning:
```js
if (BigInt(slot) > rs + BigInt(L.REVEAL_WINDOW_SLOTS)) plan.reschedule.push(r.address)
```
So a vault past its window is rescheduled. The program's reschedule_reveal requires `now > reveal_slot + REVEAL_WINDOW_SLOTS`. OK, matches.

Now, let me look at a potential issue: the crank plans BOTH a reschedule and... no, a vault is either rescheduled (window passed) or captured (hashes exist) or neither. The `else if` ensures one. OK.

Now, let me look at the alarm's `detectRevealStall`:
```js
if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
```
So it pages when revealed_total didn't move between passes AND there are unrevealed vaults (r < m). OK.

Now, let me look at a potential issue: the alarm reads `mint.revealed_total` and `mint.minted_total` from the config snapshot (readConfigs). These are read once per pass. The prev pass's values are the baseline. OK.

Now, let me look at the crank's `planCrank` for the `problems` and how they page.

The problems are written to the heartbeat. The alarm's detectCrankHealth pages a problem present in 3 consecutive passes. OK.

Now, let me look at a potential issue: the crank's `plan.problems` includes a vault "left out of every claim batch" (a missing recorded account). This is a real problem (the vault can't be paid). It pages via crank_problem after 3 passes. OK.

Now, let me look at the alarm's `detectPoolHealth` insolvency check once more:
```js
const owedCeil = (owed + 999_999_999_999n) / 1_000_000_000_000n
if (BigInt(tok.amount) < owedCeil) ... pool_insolvent CRITICAL
```

So the pool must hold >= ceil(owed). The program never distributes what it doesn't hold (PoolShort). So a shortfall means value left the pool by an unknown path. CRITICAL. OK.

Now, let me look at a potential issue: the pool read uses a FRESH config read (readPool reads the config again). But the `owed_scaled` in the fresh read might differ from the snapshot's. The alarm uses the fresh one for the pool health. OK.

Now, let me look at the alarm's `detectDistributionOverdue` and the pool availability:
```js
const poolAvail = pool?.state === 'ok' ? D.poolAvailable(cfgAtPool, pool.amount) : null
findings.push(...D.detectDistributionOverdue(cfg, { nowSec, poolAvail, ... }))
```

So poolAvail is the undistributed amount. detectDistributionOverdue pages only if poolAvail > 0 (something to pay). OK.

Now, let me look at a potential issue: `poolAvailable` uses `cfgAtPool` (the fresh owed). OK.

Now, let me look at the crank's `available` call:
```js
const avail = available(BigInt(pool.amount) + splitToPool, owedAfterRetire)
```
Same arithmetic. OK.

Now, let me look at a potential issue with the crank's `w` computation:
```js
const w = BigInt(cfg.total_active_weight) + preJoinWeight - retiringWeight - expiringWeight
```

So the distribution's weight = current + preJoins - retiring - expiring. The program's distribute uses `total_active_weight` at distribute time, which is after the joins (join batch), retirements, and expiries. So the program's w = current + preJoinWeight - retiringWeight - expiringWeight. Matches. OK.

But wait — the expiringWeight: the preExpires are expired BEFORE the distribute. expire_boost → reweigh to 0 → total_active_weight decreases by the boost weight. So the program's w at distribute = current + preJoin - retiring - expiring. Matches. OK.

Hmm, but the retiringWeight uses `wOf(r)` = level weight + boost. And the retiring vault's boost is removed by retire (unschedule_boost). So the retire removes level + boost. The crank's retiringWeight = wOf(r) = level + boost. OK.

Now, the expiringWeight = boostOf(r) = just the boost. The expire removes just the boost (reweigh to 0). OK.

Now, let me look at a potential double-count: a vault that's BOTH retiring and expiring. The preExpires skip retiring vaults (`retiring.has(r.address)`). So no double-count. OK.

Now, let me look at the crank's `acc` computation:
```js
let acc = BigInt(cfg.acc_scaled)
...
if (joinable && poolOk && !pool.frozen && due && w > 0n) {
  const avail = available(...)
  if (avail > 0n) {
    plan.distribute = true; plan.distributeKind = 'credit'
    acc += avail * L.ACC_SCALE / w
  }
}
```

So acc is advanced only if a credit distribution is planned. OK.

Now, let me look at a potential issue: the crank's `owed` for a preJoined vault uses `acc` (the advanced one). But if the distribution is a TICK (not credit), acc is unchanged. And a tick has w === 0, so no preJoins (preJoins require eligible vaults, which require... hmm, actually a tick is when w === 0 and waitingThisEpoch. preJoins are vaults with request_epoch < dist_epoch. If w === 0, there are no active vaults, but there could be pending vaults from an earlier epoch? No — pending vaults join after a distribution. If w === 0, no vault has joined yet, so all pending vaults are this-epoch (pending_this_epoch = pending_count). So preJoins (request_epoch < dist_epoch) would be empty. OK, consistent.

Now, let me look at the crank's joins after a tick:
```js
if (plan.distribute) {
  for (const r of records) {
    if (r.retired || r.active || !r.pending || assets[r.asset] !== 'live') continue
    if (BigInt(r.request_epoch) !== BigInt(cfg.dist_epoch)) continue
    const dest = destOf(r)
    if (dest) plan.joins.push([r.address, dest])
  }
}
```

So after a tick, this-epoch requesters join. The tick advances dist_epoch, so they become eligible. The joins are in the claims (ready.push(...plan.joins)). OK.

But wait — after a tick, w is still 0 (nobody joined before the tick). The joins happen in the claim batches. The claim's join branch joins them. But the claim also runs monthly_inline first — which sees last_distribute_at just stamped (not due) → does nothing. OK.

Hmm, but the claim with only joins (no payments): the program's claim processes the pairs, joins the pending ones, pays nothing. OK.

Now, let me look at a potential issue: the crank's claims after a tick include the joins, but no active vault is owed anything (w was 0). So the claims are join-only. OK.

Now, let me look at the crank's `destOf`:
```js
const destOf = r => r.pending ? r.vault_ata : tokens[r.asset]?.address
```
For a pending vault, r.vault_ata (recorded at activation request). For others, the canonical ATA. OK.

Now, let me look at a potential issue: the joins use `dest` = r.vault_ata. The claim's join branch requires `dest.key() == r.vault_ata`. OK.

Now, let me look at the alarm's `detectUnsplitRevenue` and the revenue account read. Covered.

Now, let me look at a potential issue with the crank's split planning and the `bank` account:
```js
const blockers = [['the community pool', pool], ['the CBOBTC Squads', bank]]
  .filter(([, a]) => !a || a.state !== 'ok' || a.frozen)
  .map(...)
if (blockers.length) plan.problems.push(...)
else { plan.split = true; ... }
```

So the split is planned only if the pool and the Squads account are both ok and unfrozen. OK (round 24 L3).

Now, let me look at the alarm's `detectRevenueAccount` frozen check:
```js
if (read.frozen) findings.push({ kind: 'revenue_account_frozen', severity: S.HIGH, ... })
```
OK.

Now, let me look at a potential issue: the crank reads the Squads account (`bankAta`). If it's absent, the split is blocked. But item 52 says the Squads' cbBTC ATA exists (verified). OK.

Now, let me look at the crank's `splitDecimalsByte` failure:
```js
if (plan.split && payDecimals === null) failures.push('split_revenue NOT sent: ...')
else if (plan.split) await run('split_revenue ...', ...)
```
So a null decimals blocks the split and records a failure. OK.

Now, let me look at a potential issue: the crank's `payDecimals` read:
```js
const payDecimals = splitDecimalsByte((await conn.getAccountInfo(payMint, 'confirmed'))?.data?.[44])
```
So byte 44 of the mint. cbBTC is 82 bytes, decimals at 44. OK.

Now, let me look at the alarm's `detectStandingRisks` production checks once more, and the `test_value_in_production` list. The list includes the governance numbers, the tighten bounds, the wiring, the charter length, the boost ceilings, the cbob mint, the pob collection. OK.

Now, let me look at a potential issue: the alarm's `detectStandingRisks` checks `mint.charter_secs` (computed). But the production list has `['mint.charter_secs', 604800, ...]`. And the computation: `cur['mint.charter_secs'] = String(BigInt(closes) - BigInt(opens))`. So it's the window length. OK.

Now, let me look at the alarm's `detectUpgradeAuthorityAfterLock`:
```js
if (production && !(Number(lockDeadlineSec) > 0)) {
  const live = ['seal', 'mint', 'burn', 'gov', 'sweep'].filter(p => { const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
  return live.length ? [{ kind: 'lock_deadline_unset', ... }] : []
}
if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
const out = []
for (const p of ['seal', 'mint', 'burn', 'gov', 'sweep']) {
  const v = cur[`prog.${p}.upgrade_authority`]
  if (v === undefined) continue
  if (v === null || v === 'IMMUTABLE') continue
  out.push({ kind: 'program_not_locked', ... })
}
```

So past the lock deadline, an upgradeable program pages. And with no deadline, a deployed upgradeable program pages lock_deadline_unset. OK.

Now, let me look at the `lockDeadlineOf`:
```js
export function lockDeadlineOf(fileSec, charterOpensAt) {
  const xs = [fileSec, charterOpensAt].map(Number).filter(v => Number.isFinite(v) && v > 0)
  return xs.length ? Math.min(...xs) : null
}
```
The earlier of the file and the charter opening. OK.

Now, let me look at a potential issue: the alarm's `lockGate` uses `cfg['mint.charter_opens_at']`. If the config isn't initialized, it's undefined, and lockDeadlineOf returns the file value or null. OK.

Now, let me look at the crank's `main()` and the RPC connection. It reads HELIUS_RPC_URL from /opt/gary-club/.env.local. OK.

Now, let me look at a potential issue: the crank's `getProgramAccounts` with a memcmp filter. At 2,100 vaults, the full pass fetches all records (~460 KB). The reveal lane fetches only level-0 records. OK.

Now, let me look at the alarm's `listVaults` and the DAS paging:
```js
const MAX_PAGES = 50
for (let page = 1; page <= MAX_PAGES; page++) { ... if (items.length < 1000) return ... }
throw new Error(`collection has more than ${MAX_PAGES * 1000} assets ...`)
```
So up to 50,000 assets. max_supply is 2,100. OK.

Now, let me look at a potential issue: the DAS `getAssetsByGroup` returns items with `burnt` flag. The alarm splits live/burnt. OK.

Now, let me look at the `detectNestedVaults` and the pdaOf:
```js
const owners = new Map()
for (const v of vaults) { const p = pdaOf(v.id); if (p) owners.set(p, v.id) }
for (const { id, owner } of vaults) {
  if (!owner) continue
  const host = owners.get(owner)
  if (host === undefined) continue
  if (host === id) { ... vault_owns_itself ... } else { ... nested_vault ... }
}
```

So a vault owned by another vault's PDA is nested. OK. And the off-curve check. OK.

Now, let me look at a potential issue: `detectNestedVaults` includes BURNT vaults in the owners map (the alarm passes `everyVault` = live + burnt). So a vault nested in a burnt host is caught. OK.

Now, let me look at the alarm's `detectBurns` and the `assetSet`:
```js
const assets = new Set([...vaults, ...burnt])
```
So burns of live or burnt vaults are caught. OK.

Now, let me look at a potential issue: the alarm's `detectUnledgeredSweeps` reads the sweep instruction's amount from dataBytes. But the sweep instruction is a top-level MINT instruction. The dataBytes are the base58-decoded data. OK.

Now, let me look at the alarm's `IX_SWEEP` discriminator: `disc('sweep_sol_for_swap')`. OK.

Now, let me look at a potential issue: the alarm's `detectUnledgeredSweeps` requires `d.length < 16` to skip. The sweep data is 8 (disc) + 8 (amount) = 16 bytes. So `d.length < 16` skips shorter. OK.

Now, let me look at the alarm's `detectSplitClaims` and the `splitSig` reuse check:
```js
if (claimed.has(c.splitSig)) { ... split_sig_reused CRITICAL ...; continue }
claimed.add(c.splitSig)
```
OK.

Now, let me look at a potential issue: the alarm's `detectSplitClaims` and the `split_claim_unanchored`:
```js
if (BigInt(c.returnedSats ?? 0) > 0n) {
  const named = byS.get(c.splitSig)
  const at = splitTime(named)
  const anchor = at === null ? null : closesCycle(c, entries, { upTo: at })
  if (anchor === null) { ... split_claim_unanchored CRITICAL ... }
}
```

So an explicit splitSig must be anchored by a split at or after the return, up to the named one, >= the return. OK.

Now, let me look at the alarm's `detectUnreconciledRevenue` and the `closedOnChain`:
```js
const closedOnChain = returned > 0n && !c.splitSig && !c.splitByOther && closesCycle(c, opts.splits || [], { exclude: claimedSigs }) !== null
```
So a returned-but-unsplit cycle is closed on chain if a split at or after the return, >= the return, unclaimed, exists. OK.

Now, let me look at a potential issue: the `claimedSigs` are the cycles' splitSigs. So a split claimed by another cycle can't close this one. OK.

Now, let me look at the alarm's `detectUnreconciledRevenue` short_swap_return:
```js
const floor = quoted - (quoted * BigInt(Math.round(tol * 10_000)) / 10_000n)
if (returned < floor) { ... short_swap_return CRITICAL ... }
```
tol = 0.02. floor = quoted * 0.98. OK.

Now, let me look at a potential issue: the `quoted` is `c.quotedSats` (the oracle's expected output). The return is held to 98% of it. But the swap's floor is 150 bps (98.5%) under the oracle. So a return at the floor (98.5%) is above 98% → quiet. A return below 98% → CRITICAL. OK, consistent.

Hmm, wait — the swap's floor is 150 bps under the oracle's expected output AT SWAP TIME (m2). The quoted is the oracle's expected output at sweep time (m1, then updated to m2: `cycle.quotedSats = String(m2.f.expectedSats)`). So quoted = m2's expected. The floor = m2's minSats = 98.5% of m2's expected. The return >= floor (on-chain). So return >= 98.5% of quoted. The alarm's short_swap_return fires below 98% of quoted. So a return between 98% and 98.5% is... impossible (the on-chain floor is 98.5%). So the alarm's 98% is looser than the on-chain floor. A return at exactly the floor (98.5%) is quiet. OK, consistent and slightly looser (fine).

Now, let me look at a potential issue: the revenue cycle's `cycle.quotedSats = String(m2.f.expectedSats)` is set AFTER the sweep, before the swap. And `cycle.floorSats = String(guaranteed)`. OK.

Now, let me look at the alarm's `detectUnreconciledRevenue` and the `cycle_unsplit` grace:
```js
const rtMs = Date.parse(c.returnedAt || c.startedAt)
const sinceReturn = nowMs - (Number.isFinite(rtMs) && rtMs <= nowMs ? rtMs : -Infinity)
...
if (returned > 0n && !c.splitSig && !c.splitByOther && !closedOnChain && sinceReturn >= graceMs) { ... cycle_unsplit HIGH ... }
```

So a returned-but-unsplit cycle pages HIGH after the grace (1h) from the return. OK.

Now, let me look at a potential issue: the revenue cycle's split happens right after the return (same run). So the unsplit window is seconds. The grace (1h) covers it. OK.

Now, let me look at the crank's `BENIGN` regex and the `NothingToSplit`:
```js
export const BENIGN = /RevealTooEarly|AlreadyCaptured|AlreadyRevealed|RevealOutOfOrder|RescheduleTooEarly|MonthNotElapsed|AlreadyRetired|AlreadyActive|VaultRetired|ActivationPending|RevealWindowExpired|NeedsReschedule|NothingToSplit/
```
So NothingToSplit is benign (a stranger split first). OK.

Now, let me look at a potential issue: the crank's split is planned, and a stranger splits first → NothingToSplit → benign. But the crank's plan counted splitToPool toward the distribution. If the stranger split, the pool got the 85% anyway. So the distribution's avail is the same. OK.

But — the crank's plan computed `avail = available(pool.amount + splitToPool, ...)`. If the stranger split, the pool amount at distribute time = pool.amount + splitToPool (the stranger's split added it). So avail matches. OK.

Now, what if the stranger's split lands AFTER the crank's plan but the crank's split is sent first and the stranger's fails NothingToSplit? Same thing, the pool got it once. OK.

Now, let me look at a potential issue: the crank's distribute is planned against the post-split pool. If the split fails (a real failure, e.g., frozen destination — but the crank checks that), the distribute's avail is over-counted. But the crank checks the split's destinations before planning. So a blocked split → no split planned → splitToPool = 0. OK.

Hmm, wait — the crank's split is `plan.split = true` only if no blockers. And splitToPool is computed. If the split is sent and fails (a race: the destination froze between plan and send), the distribute would see a smaller pool. But the crank's distribute is planned with avail including splitToPool. If the split failed, the pool is smaller, so the program's avail is smaller. The program's distribute computes avail itself (balance - owed). If avail is 0, NothingToDistribute. The crank's judgeDistributeRefusal: NothingToDistribute with epoch unmoved → 'fail'. Pages. OK, loud.

Actually, wait — there's a subtler issue. The crank plans the distribute with `avail = available(pool.amount + splitToPool, owedAfterRetire)`. If avail > 0, it plans a credit distribution and computes acc += avail * SCALE / w. The claims are computed at this acc. If the split failed (pool smaller), the program's distribute distributes LESS (smaller avail), so acc advances less. The claims then pay at the actual acc (lower). The crank's owed computations assumed the higher acc. So the crank might include a vault owed >= 1 sat at the assumed acc but owed < 1 at the actual acc. The program's claim skips it (pay == 0). No overpayment. OK.

Now, let me look at a potential issue: the crank's `plan.owed` is used for the selftest's sats assertions, not for the actual sends. The sends include the pairs. OK.

Now, let me look at the alarm's `detectCrankHealth` covered freezes once more. The `coveredFreezes` are computed from the findings:
```js
coveredFreezes: { pool: findings.some(f => f.kind === 'pool_frozen'), revenue: rev.findings.some(f => f.kind === 'revenue_account_frozen') }
```
So if the pool is frozen (pool_frozen finding), the crank's "pool frozen" problem is covered. OK.

Now, let me look at a potential issue: the alarm's `detectCrankHealth` is called with `beat: D.readCrankBeat(beat)`. readCrankBeat parses the heartbeat. OK.

Now, let me look at the alarm's `detectCrankSilent` and the heartbeat read:
```js
let beat = null
try { beat = fs.readFileSync(...crank-heartbeat...) } catch { beat = null }
findings.push(...D.detectCrankSilent({ stampSec: D.parseCrankHeartbeat(beat), ... }))
```
OK.

Now, let me look at a potential issue: the alarm's `detectCrankPosture`:
```js
export function detectCrankPosture({ posture, prevArmedSince = null, nowSec }) {
  if (posture === 'armed') return { live: true, armedSince: prevArmedSince ?? nowSec, findings: [] }
  if (posture === 'dry') return { live: false, armedSince: null, findings: [] }
  return { live: prevArmedSince !== null && prevArmedSince !== undefined, armedSince: prevArmedSince ?? null, findings: [{ kind: 'crank_posture_unreadable', ... }] }
}
```
OK.

Now, let me look at the alarm's `crankPosture`:
```js
export function crankPosture(read) {
  if (!read) return 'unreadable'
  if (read.error) return /no crontab for/i.test(String(read.error.stderr ?? '')) ? 'dry' : 'unreadable'
  return crankArmed(read.text) ? 'armed' : 'dry'
}
```
OK.

Now, let me look at the alarm's crontab read:
```js
let crontabRead
try { crontabRead = { text: execFileSync('crontab', ['-l'], ...) } }
catch (e) { crontabRead = { error: { status: e.status ?? null, stderr: String(e.stderr || e.message || '') } } }
```
OK.

Now, let me look at a potential issue: the alarm's `detectCrankSilent` uses `wallSec` (box clock). If the box clock is wrong, this misfires. But that's a box-clock dependency. The heartbeat's atSec is box time (the crank writes `Math.floor(Date.now()/1000)`). So both are box time. Consistent. OK.

Now, let me look at the alarm's `detectUnsweptRoyalties` using `wallSec`:
```js
const royalty = D.detectUnsweptRoyalties({ ..., nowSec: wallSec, ... })
```
And `prevSince` is wall time. Consistent. OK.

Now, let me look at the alarm's `detectRevenueAccount` using `nowSec` (chain):
```js
const rev = D.detectRevenueAccount({ read: revenueRead, prevSince: ..., splits: ..., nowSec })
```
And the splits' blockTime is chain. Consistent. OK.

Now, let me look at a potential issue: the alarm's `detectUnsplitRevenue`:
```js
findings.push(...D.detectUnsplitRevenue({ amount: ..., sinceSec: revenueSince, nowSec }))
```
nowSec is chain. revenueSince is chain (from detectRevenueAccount). Consistent. OK.

Now, let me look at the alarm's `detectDistributionOverdue` using `nowSec` (chain) and `mint.last_distribute_at` (chain). Consistent. OK.

Now, let me look at the alarm's `detectSweepState` using `nowSec` (chain) for the grace and `last_sweep_at` (chain). The window uses `startedAt` (box). The round-33 repair made the window symmetric to tolerate the box/chain skew. OK (modulo the extreme-skew boundary I noted).

Now, let me look at a potential issue: the alarm's `detectDeferredSweeps`:
```js
const now = opts.now ?? Math.floor(Date.now() / 1000)
```
The alarm passes `now: nowSec` (chain). And the deferred sweeps' blockTime is chain. Consistent. OK.

Now, let me look at the alarm's `detectUnledgeredSweeps` grace: `opts.now` is nowSec (chain), `opts.blockTime` is s.blockTime (chain). Consistent. OK.

Now, let me look at the alarm's `detectUnreconciledRevenue` and `detectSplitClaims` using `now: wallSec * 1000` and `chainNow: nowSec * 1000`. The cycleStartMs translates. OK.

Now, let me look at a potential issue: the alarm's `detectLogGaps` and the watermark:
```js
const at = reviewedThrough ? all.indexOf(reviewedThrough) : -1
const unreviewed = at >= 0 ? all.slice(at + 1) : all
```
So gaps after the watermark are unreviewed. OK.

Now, let me look at the alarm's `readGapsReviewed`:
```js
const t = fs.readFileSync(GAPS_REVIEWED, 'utf8').trim(); return /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(t) ? t : null
```
So the watermark must be a base58 signature. OK.

Now, let me look at a potential issue: the alarm's `detectLogGaps` keep:
```js
const reviewed = at >= 0 ? all.slice(0, at + 1).slice(-Math.max(1, 500 - unreviewed.length)) : []
const keep = [...reviewed, ...unreviewed]
```
So the reviewed prefix is trimmed to keep the total bounded, keeping the watermark. OK.

Now, let me look at the alarm's `planAlarmNotices` once more:
```js
const urgent = isOneShotKind(kind, kinds) || list.some(f => f.urgent)
```
So a one-shot kind OR any urgent finding → urgent. OK.

Now, the recovery:
```js
if (fullPass) {
  for (const kind of new Set(prevPaged || [])) {
    if (paged.includes(kind) || isOneShotKind(kind, kinds)) continue
    notices.push({ kind, ..., recovery: true, ... })
  }
}
```
So a level kind in prevPaged that's not paged this pass gets a recovery. One-shots don't. OK.

Now, let me look at a potential issue: the `paged` list only includes non-urgent kinds:
```js
if (!urgent) paged.push(kind)
```
So only level kinds are remembered as paged. One-shots aren't (their baseline moves). OK.

Now, let me look at the alarm's `report` and the `delivered` for the reconcile. Covered.

Now, let me look at a potential issue: the alarm's `report` sets `process.exitCode = code`. code is 1 if there are critical/high findings, 2 if delivery failed. OK.

Now, let me look at the alarm's `main` and the `withLock`:
```js
withLock(LOCK, main, { staleMs: 2 * 3600_000 }).catch(e => { ... })
```
OK.

Now, let me look at the lock.mjs once more for a race.

The `acquireLock` with the generation scheme. The `confirmSole` re-scan. The `place` via link. OK.

Let me look at `confirmSole`:
```js
function confirmSole(file, myGen, myToken, brokenToken) {
  for (const g of scan(file)) {
    if (g === myGen) continue
    const r = readGen(file, g)
    if (g > myGen || !(brokenToken && r && r.token === brokenToken)) {
      if (g > myGen || r) { try { if (readGen(file, myGen)?.token === myToken) fs.unlinkSync(`${file}.${myGen}`) } catch {} ; return false }
    }
  }
  return true
}
```

So after placing myGen, re-scan. If a higher generation exists, or a lower one that's not the broken record, I lost (unlink mine, return false). OK.

Hmm, there's a subtle issue: `if (g > myGen || r)` — for a lower generation g with a record r that IS the broken token, the outer condition `!(brokenToken && r && r.token === brokenToken)` is false, so we don't enter the inner block. So the broken record below me is OK (I'll sweep it). For a lower generation with a DIFFERENT record (r exists, not the broken token), the outer condition is true, and `r` is truthy → unlink mine, return false. For a lower generation with NO record (r null, already swept), the outer condition is true (because `!(brokenToken && null && ...)` = `!(false)` = true), and `r` is null → the inner `if (g > myGen || r)` is false → don't unlink, don't return false. So a swept lower generation is OK. OK.

Wait, let me re-read. The outer `if (g > myGen || !(brokenToken && r && r.token === brokenToken))`. For a lower g with r null: `!(brokenToken && null && ...)` = `!(false)` = true. So we enter. Inner: `if (g > myGen || r)` = `if (false || null)` = false. So we don't unlink/return false. Continue. OK. So a null record below is fine.

For a lower g with r = broken token: outer = `!(true)` = false. Don't enter. Continue. OK.

For a lower g with r = other token: outer = `!(false)` = true. Enter. Inner: `r` truthy → unlink mine, return false. OK.

For a higher g: outer true. Inner: `g > myGen` true → unlink mine, return false. OK.

OK, confirmSole is correct.

Now, let me look at the `acquireLock` two-pass loop:
```js
for (let attempt = 0; attempt < 2; attempt++) {
  const gens = scan(file)
  if (!gens.length) {
    if (place(`${file}.0`, payload())) {
      _afterUnlink?.()
      if (!confirmSole(file, 0, token, null)) return { ok: false, ..., lostRace: true }
      return { ok: true, ..., gen: 0 }
    }
    continue
  }
  const G = gens[0]
  const held = readGen(file, G)
  if (!held || !held.at) return { ok: false, ..., unreadable: true }
  const age = now - Date.parse(held.at)
  if (!Number.isFinite(age)) return { ok: false, ..., unreadable: true }
  let gone = false
  if (held.pid) { ... }
  if (!gone) {
    if (age < staleMs) return { ok: false, ..., ageMs: age }
    if (held.pid) return { ok: false, ..., aliveHolder: true }
  }
  _beforeBreak?.()
  const still = readGen(file, G)
  if (!still || still.token !== held.token) return { ok: false, ..., lostRace: true }
  _beforeSteal?.()
  if (!place(`${file}.${G + 1}`, payload())) return { ok: false, ..., lostRace: true }
  _afterUnlink?.()
  if (!confirmSole(file, G + 1, token, held.token)) return { ok: false, ..., lostRace: true }
  for (const g of scan(file)) if (g < G + 1) { try { fs.unlinkSync(`${file}.${g}`) } catch {} }
  return { ok: true, broke: held, ..., gen: G + 1 }
}
return { ok: false, ..., lostRace: true }
```

OK. The break creates a higher generation, confirms sole, sweeps below. The selftest's race arms prove this. OK.

Now, let me look at a potential issue: the `held.pid` liveness. If the holder has no pid (a record with no pid), `gone` stays false, and `if (held.pid)` is false, so we don't return aliveHolder. Then we break (a no-pid record waits out staleMs, then is broken). Wait:

```js
if (!gone) {
  if (age < staleMs) return { ok: false, ... }  // fresh, wait
  if (held.pid) return { ok: false, ..., aliveHolder: true }  // old and alive, wait
}
// break
```

So a no-pid record: gone false, age >= staleMs → falls through (held.pid is falsy, so no aliveHolder return) → break. So a no-pid record is broken after staleMs. OK (the selftest's "fresh record with NO pid still waits out staleMs").

Now, let me look at the `releaseLock`:
```js
export function releaseLock(file, token) {
  if (!token) return false
  for (const g of scan(file)) {
    const rec = readGen(file, g)
    if (rec?.token !== token) continue
    try { fs.unlinkSync(`${file}.${g}`) } catch {}
    return true
  }
  return false
}
```
OK.

Now, let me look at the `readLedger`/`writeLedger` and the marker. OK.

Now, let me look at a potential issue: the `writeLedger` writes the marker FIRST, then renames. So a crash between the marker and the rename leaves a marker with an old ledger. Then a later delete of the ledger + the marker present → refusal. OK, safe direction.

Now, let me look at the alarm's `readState`/`writeState` using readLedger/writeLedger with no marker (STATE_FILE has the separate EVER marker). OK.

Now, let me look at a potential issue: the alarm's state file and the EVER marker. The EVER marker is written by markEver (separate from writeState). OK.

Now, let me look at the crank's key mode check:
```js
const mode = fs.statSync(KEY).mode & 0o777
if (mode & 0o077) throw new Error(`${KEY} is mode ${mode.toString(8)}; it must be 600`)
```
OK.

Now, the revenue's key mode check: same. OK.

Now, let me look at a potential issue: the crank's `CBOB_CRANK_KEY` env var can override the key path. And the revenue's key path is hardcoded. Hmm — the crank's key path is overridable by env. Is that a problem? The env var is set by the operator, not an attacker (an attacker with env control owns the box anyway). OK.

Now, let me look at the alarm's env vars: CBOB_ALARM_STATE, CBOB_ALARM_LOCK, CBOB_ALARM_ACKS, etc. Same. OK.

Now, let me look at a potential issue: the alarm's `CBOB_ALARM_REHEARSAL` must be exactly '1'. OK (fail closed).

Now, let me look at the swap-fork.sh and the SWAP_FLOOR:
```sh
SWAP_FLOOR=16
[ "$T" -eq "$SWAP_FLOOR" ] || die "..."
```
OK.

Now, let me look at the run-tests.sh's expiry-budget gate:
```sh
EXPIRY_FLOOR=4
floor "expiry-budget" "$EXPIRY_OUT" '[0-9]+/[0-9]+ expiry-budget assertions as predicted' "$EXPIRY_FLOOR"
```
OK.

Now, let me look at the expiry-budget test itself. It builds synthetic genesis accounts and runs expire_boosts with 20 records. It checks the default budget (200k CU) suffices and the transaction lands. OK.

Hmm, wait — the expiry-budget test's config has `boosts_due: 20, boosts_active: 20, boost_weight_total: 240n, total_active_weight: 280n`. And 20 records each with boost_weight 12, boost_end_epoch 1. The config's dist_epoch is 1. So all 20 are due (dist_epoch 1 >= end_epoch 1). After expiry: boosts_due 0, boosts_active 0, total_active_weight 40 (20 records * level weight 2), boost_weight_total 0. The test asserts these. OK.

But wait — the test's `total_active_weight: 280n` = 20 * (2 + 12) = 20 * 14 = 280. After expiry: 20 * 2 = 40. OK.

Now, the test uses `L.encode('MintConfig', cfg)` and `L.encode('VaultRecord', ...)`. The layouts are asserted against the Rust. OK.

Now, let me look at a potential issue: the expiry-budget test's `add` function creates accounts with lamports 1e9 and the given owner. The records are owned by MINT. The config by MINT. The payer by the system program. OK.

Now, let me look at the test's instruction:
```js
const ix = new TransactionInstruction({ programId: mint,
  keys: [cfgAddr, ...records].map(pubkey => ({ pubkey, isWritable: true, isSigner: false })),
  data: createHash('sha256').update('global:expire_boosts').digest().subarray(0, 8) })
```
So expire_boosts with config + 20 records. OK.

Now, let me look at a potential issue: the test asserts `value.logs?.filter(l => l.includes('CBOB_BOOST_EXPIRED asset=')).length === 20`. So 20 expiry log lines. OK.

Now, let me look at the run-tests.sh's main suite invocation and the floors. Covered.

Now, let me look at the selftest's `FLOOR = 909` and the count. The selftest has 909 assertions. The runner's DET_FLOOR = 909. The selftest asserts they match. OK.

Now, let me look at a potential issue: the selftest's stated-count gate reads SPEC.md and checks every occurrence of each floor. The RX map. Let me verify the SPEC's Running-the-tests block numbers match the floors:
- "866 assertions, real cloned Core" → on-chain 866. MIN_ASSERTIONS=866. OK.
- "909 detector" → DET_FLOOR=909. OK.
- "39 allocation" → ALLOC_FLOOR=39. OK.
- "23 poster" → POSTER_FLOOR=23. OK.
- "4 expiry-budget" → EXPIRY_FLOOR=4. OK.
- "14 Proof-of-Burn" → POB_FLOOR=14. OK.
- "47 launch" → LAUNCH_FLOOR=47. OK.
- "33 live-mainnet" → MAINNET_FLOOR=33. OK.
- "71 simulation assertions" → SIM_FLOOR=71. OK.
- "16 swap-fork assertions" → SWAP_FLOOR=16. OK.

OK, all match.

Now, let me look at a potential issue: the selftest's `everywhere` for 'launch' uses `num(/^LAUNCH_FLOOR=(\d+)/m, runner)`. And the SPEC says "47 launch and 33 live-mainnet". The RX.launch matches "47 launch". OK.

Now, let me look at the selftest's R33 D3 arm:
```js
t('R33 D3: the launch count reader sees the Running-the-tests phrasing and a planted stale one',
  [statedIn('47 launch and 33 live-mainnet', 'launch'), statedIn('48 launch and', 'launch').every(n => n === num(/^LAUNCH_FLOOR=(\d+)/m, runner))], [[47], false])
```
OK.

Now, let me look at a potential issue: the selftest's `statedIn` for 'launch' on the actual SPEC. The SPEC says "47 launch and". Are there other "N launch" phrases in SPEC? Let me search... "the launch values", "launch/mainnet-init.json", "at launch", "the launch case", "launch tick". Hmm — "launch tick" — is there a number before "launch"? Let me check: "the free launch tick" — no number. "47 launch and" — yes. Any other "N launch"? I don't see one in the Running-the-tests block. But the RX is global (`/g` over all of SPEC). Let me think about whether any other "N launch" appears... "the launch gate", "launch values", "a launch decision". I don't see a number directly before "launch" elsewhere. The selftest asserts `found.length > 0 && found.every(n => n === want)`. If there were a stray "N launch", it would fail. Since the suite passes (909/909), there's exactly one match (47). OK.

Now, let me look at a potential issue: the selftest's `statedIn` for 'pob' — `/(\d+) Proof-of-Burn\b/g`. SPEC says "14 Proof-of-Burn". Any other? "the Proof of Burn set" (no hyphen, no number). OK.

Now, let me look at the audit-coverage.sh's exclusions:
```sh
have=$(printf '%s\n' "$listed" | { grep -vE '^scripts/audit|/Cargo\.lock$|^bank/\.gitignore$' || true; } | sed '/^$/d' | sort -u)
```
So audit scripts, Cargo.lock, bank/.gitignore are excluded. OK.

Now, let me look at a potential issue: the coverage gate's `git ls-files` includes tests/fixtures/mainnet-v1.json. Was it ever bundled? It's in this round's bundle. OK.

Now, let me look at the rehearsal-tree.sh's file list:
```python
files = subprocess.check_output(['git', '-C', dest, 'ls-files', '--', 'programs', 'bank', 'scripts', 'tests', 'sim', 'launch', 'Anchor.toml'], text=True).split()
```
So it patches programs, bank, scripts, tests, sim, launch, Anchor.toml. OK.

Now, let me look at a potential issue: the rehearsal substitutes the ids in tests/fixtures/mainnet-v1.json? That fixture has no program ids of ours. OK.

Now, let me look at the rehearsal's "no abbreviated id" check:
```python
for o, _ in pairs[:-1]:
    if o[:4] in now: sys.exit(...)
```
So after substitution, no file should contain the first 4 chars of any mainnet id. But wait — the substitution replaces the FULL ids. A 4-char prefix of an id could appear coincidentally in other content (a hash, a comment). The check would false-positive. But the script is designed for this tree, and it passed at d57ee3a. Hmm — could a legitimate hash contain "Gsb7" (MINT's prefix)? Possible but unlikely. The check is a safety net. OK.

Now, let me look at a potential issue: the rehearsal's substitution of the root path `/opt/cbob-vaults` → DEST. This changes the cron paths, the key paths, etc. So the rehearsal's keys/locks/caches are separate. OK.

Now, let me look at the rehearsal's keypair generation:
```bash
[ -s "$kp" ] || solana-keygen new --no-bip39-passphrase -s -o "$kp" >/dev/null
```
So it reuses existing keys. OK.

Now, let me look at a potential issue: the rehearsal installs the keys as target/deploy keypairs. So the programs deploy at the throwaway ids. OK.

Now, let me look at the build-mainnet.sh's `boot` and the Core gate. Covered.

Now, let me look at a potential issue: the build's `ask` deploys with `--upgrade-authority "$UA"`. So the deployed program is upgradeable by UA. Then the initauth test checks the INIT_AUTHORITY behavior. OK.

Now, let me look at the initauth test... it's not in the bundle. But the selftest references it. OK.

Now, let me look at a potential issue: the build's `N=$(ls "$OUT"/*.so | wc -l); [ "$N" -eq 5 ]`. So exactly 5 programs. OK.

Now, let me look at the launch/create-cbob-token.mjs. It created the $CBOB mint once. The record is verified. OK. This is a one-time script, already run. Not a live concern.

Now, let me look at a potential issue: the create-cbob-token's `loadOrMake` for the release key. On mainnet, it requires the key to exist (or EXECUTE to make it). The key is bank/keys/cbob-release.json. Limit 56 covers the custody. OK.

Now, let me think about whether there are any REAL new findings. Let me re-read the crank's `planCrank` for the `preJoins` destination:

```js
plan.preJoins.push([r.address, r.vault_ata])
```

The preJoins use r.vault_ata. But the claim's join branch requires `dest.key() == r.vault_ata`. OK.

But wait — what if r.vault_ata is the default pubkey (all zeros)? A vault that requested activation has vault_ata set (the program sets it at the activation request). So a pending vault has a real vault_ata. OK.

Now, let me look at a potential issue: the crank's `preJoins` are sent as join batches BEFORE the distribute. But the join batch is a `claim` instruction with crank_n=0. The claim runs monthly_inline first. If the month is due, monthly_inline runs the distribution IN the join batch. Then the crank's explicit distribute would fail MonthNotElapsed (benign). Hmm — but the crank plans the distribute and computes acc against it. If the join batch's monthly_inline distributes first, the acc advances there, and the explicit distribute fails (benign). The claims then pay at the acc advanced by the join batch. The crank's owed computations assumed the explicit distribute's acc. Are they the same? The join batch's monthly_inline distributes avail = balance - owed (the same pool). So the acc advance is the same. OK.

But wait — the join batch's monthly_inline: does it run? The join batch is a claim. monthly_inline checks due, boosts_due, waiting_to_join. At the join batch, the preJoins haven't joined yet (they're being joined IN this batch). So waiting_to_join > 0 (the preJoins are still pending at the start of the batch)... wait, no. The claim processes the pairs in order. monthly_inline runs BEFORE the pairs. So at monthly_inline time, the preJoins are still pending (waiting_to_join > 0). So monthly_inline does nothing (CBOB_MONTHLY_WAITS_FOR_JOINS). So the join batch does NOT distribute. Then the explicit distribute runs (after the joins). OK.

Hmm, but the crank's explicit distribute requires waiting_to_join == 0 (JoinWaitingFirst). After the join batch, the preJoins are joined, so waiting_to_join == 0. So the distribute runs. OK.

But what about the claims (after the distribute)? They run monthly_inline too. At that point, the distribute just ran (last_distribute_at stamped), so monthly_inline sees not-due → does nothing. OK.

Now, there's a subtle issue: the crank's plan has BOTH preJoins (join before) and a distribute. The preJoins are joined in the join batch. The distribute then credits them (their weight is in w). The claims pay them. OK.

But what if the join batch's monthly_inline DID distribute (because waiting_to_join was 0 at its start)? That happens when there are no preJoins but there are joins (this-epoch requesters). Wait — joins (this-epoch) are in the claims, not the join batch. The join batch is only preJoins. If preJoins is empty, no join batch is sent. So the first transaction that runs monthly_inline is... the distribute (explicit) or the claims. The explicit distribute handles the month. OK.

Hmm, actually — wait. Let me reconsider. The crank sends: reschedule, capture, reveal, retire, preJoins (join batch), preExpires, split, distribute, postExpires, activate, claims. The retire is a `retire_burned` instruction, which does NOT run monthly_inline (it's not a host). Let me check: retire_burned's handler is just `retire(...)`. No monthly_inline. OK. The preExpires (expire_boosts) — no monthly_inline. OK. The split (split_revenue) — no monthly_inline. OK. The distribute — it's the explicit distribution. OK.

So the first host instruction that runs monthly_inline is... the activate or the claim. But the crank sends the explicit distribute BEFORE those. So the explicit distribute runs the month (if due). Then activate/claim see not-due. OK.

But wait — the activate runs monthly_inline FIRST (before the activation logic). And the crank sends activations AFTER the distribute. So the activate's monthly_inline sees not-due (the distribute just ran). OK.

Hmm, but what if the crank did NOT plan a distribute (not due)? Then the activate's monthly_inline might run the month if it became due between plan and send. That's fine (the month runs in-line). The activation then proceeds. OK.

Now, let me look at a potential issue: the crank's `plan.activate` is sent after the distribute. But the activate's monthly_inline could distribute if the month is due. The crank's plan didn't account for that (it planned no distribute). So the activation's in-line distribution advances acc, and the claims (planned at the old acc) pay less. But the claims are planned at the old acc (owed >= 1 sat), and the in-line distribution only adds. So the claims still pay. OK.

But — the activation's in-line distribution could be blocked by JoinWaitingFirst or BoostsExpireFirst? monthly_inline doesn't refuse for those (it does nothing). So the activation proceeds. OK.

Now, let me look at a potential issue: the crank's `plan.activate` for a vault whose activation would be the FIRST active vault. The activate's monthly_inline with w == 0 and pending_this_epoch > 0 ticks. Hmm — the activation request sets pending_this_epoch. But monthly_inline runs BEFORE the activation logic. So at monthly_inline time, the vault isn't pending yet. So pending_this_epoch is whatever it was. If 0, no tick. OK.

Now, let me look at the alarm's `detectDistributionOverdue` and the `launch_tick_overdue`. It pages when w == 0, pending_this_epoch > 0, and the month + grace passed. OK.

Now, let me look at a potential issue: the crank's tick planning requires `waitingThisEpoch` (pending_this_epoch minus retirements > 0). And the program's tick requires `pending_this_epoch > 0`. OK.

Now, let me look at the alarm's `detectStandingRisks` joins_waiting:
```js
const pc = cur['mint.pending_count'], pt = cur['mint.pending_this_epoch']
if (pc !== undefined && pt !== undefined && BigInt(pc) - BigInt(pt) > 0n) { ... joins_waiting INFO ... }
```
So eligible-but-unjoined vaults (pending_count - pending_this_epoch > 0) are INFO. OK.

Now, let me look at the alarm's `detectDistributionOverdue` joins_stalled:
```js
if (eligible > 0n && BigInt(nowSec) - last > BigInt(graceSecs)) stalls.push({ kind: 'joins_stalled', ... })
```
So eligible vaults unjoined long after the last distribution → HIGH. OK.

Now, let me look at a potential issue: the alarm's `detectDistributionOverdue` boosts_stalled:
```js
const bd = big(cur['mint.boosts_due'])
if (bd !== null && bd > 0n && BigInt(nowSec) - last > BigInt(graceSecs)) stalls.push({ kind: 'boosts_stalled', ... })
```
OK.

Now, let me look at the crank's `plan.preExpires` and the program's `boosts_due`. The crank computes due boosts from records. The program's distribute checks `boosts_due == 0` (the config counter). If the crank's records-based computation misses a due boost (e.g., a record the crank didn't fetch), the distribute refuses BoostsExpireFirst. The crank's judgeDistributeRefusal: BoostsExpireFirst with epoch unmoved → 'fail'. Pages. OK, loud.

But — could the crank's records fetch miss a boosted record? The full pass fetches ALL VaultRecords (no filter). So no. OK.

Now, let me look at a potential issue: the crank's reveal lane fetches only level-0 records. It doesn't plan expires/joins/claims (revealOnly). OK.

Now, let me look at the alarm's `detectSweepState` and the `judged` baseline persistence:
```js
sweepJudgedThrough: sweepState.judged,
```
And on undelivered: `next.sweepJudgedThrough = prev?.sweepJudgedThrough ?? null`. So the baseline rolls back if the page isn't delivered. OK.

Now, let me look at a potential issue: the alarm's `sweepCooldownSeen` persistence:
```js
sweepCooldownSeen: cooldownSeen,
```
And on undelivered: `next.sweepCooldownSeen = prev?.sweepCooldownSeen ?? null`. OK.

Now, let me look at the alarm's `detectSweepState` cooldown default:
```js
export function detectSweepState({ ..., cooldownSecs = 21600, ... }) {
```
The alarm passes `cooldownSecs: cooldownSeen`. cooldownSeen is computed from prev and current. OK.

Now, let me look at a potential issue: the `cooldownSeen` computation:
```js
const cooldownSeen = Math.min(...[prev?.sweepCooldownSeen, cfg['mint.sweep_cooldown_secs']].map(Number).filter(n => Number.isFinite(n) && n > 0), 21600)
```

Wait — `Math.min(...array, 21600)`. If the array is empty (both undefined), Math.min(21600) = 21600. If the array has [43200, 86400], Math.min(43200, 86400, 21600) = 21600. So cooldownSeen is capped at 21600. And it's the smallest of (prev, current, 21600). OK.

Hmm — but the ruled cooldown is 21600. So cooldownSeen starts at 21600 and can only stay or... wait, the current cooldown can only INCREASE (a vote lengthens it). So cfg's cooldown >= 21600 always (after launch). And prev's sweepCooldownSeen <= 21600. So cooldownSeen = min(prev, current, 21600) = min(prev, 21600) = prev (once set) or 21600. So it stays at 21600 unless... it can't go below 21600 (the ruled value is the minimum at launch, and it only increases). Wait — the launch value IS 21600. A vote can only lengthen. So the cooldown is always >= 21600. The smallest ever seen is 21600. So cooldownSeen = 21600 always. The Math.min with 21600 is redundant but harmless. OK.

Actually — hold on. Is the launch value guaranteed to be 21600? The launch checker pins it. And MINT's initialize bounds it to 1s..24h. So a wrong launch value could be less. But the launch checker refuses it. And the alarm's sweep_cooldown_too_short pages if < 3600. So a too-short cooldown is caught. The cooldownSeen = min(seen, 21600) would then be the short value, making the window narrower (loud direction). OK.

Now, let me look at a potential issue: the alarm's `detectSweepState` uses `cooldownSecs` for the half-window. If the cooldown is 21600, half is 10800. OK.

Now, let me look at the crank's `planCrank` for a potential issue with the `owed` of a vault that's both preJoined and preExpired. A preJoined vault is pending (not active), so it can't have a boost (boosts require active). So no overlap. OK.

Now, let me look at the crank's `plan.preExpires` for a vault that's active with a boost that's due. And the same vault is owed a claim. The claim's owed computation for a preExpired vault:
```js
else if (preExpired.has(r.address)) {
  const atExpiry = pendingScaled({...}, cfg.acc_scaled)
  owed = (atExpiry + L.LEVEL_WEIGHTS[r.level - 1] * (acc - BigInt(cfg.acc_scaled))) / ACC_SCALE
}
```
OK, verified earlier.

Now, let me look at a potential issue: the crank's `plan.postExpires` are expired AFTER the distribute. The postExpires are boosts with end_epoch == dist_epoch + 1. The distribute advances dist_epoch to dist_epoch + 1, making them due. The postExpires transaction runs after the distribute. OK.

But — the postExpires are computed only `if (plan.distribute)`. If no distribute, no postExpires. OK.

Now, let me look at a potential issue: the crank's `plan.postExpires` skip preExpires (`plan.preExpires.includes(r.address)`). A boost can't be both due now (preExpire) and made due by this distribution (postExpire). OK.

Now, let me look at the crank's `expire` helper:
```js
const expire = async (when, list) => { for (let i = 0; i < list.length; i += L.EXPIRE_BATCH) { ... } }
await expire('before', plan.preExpires)
...
if (plan.distribute) await expire('after', plan.postExpires)
```
OK.

Now, let me look at a potential issue: the crank's `plan.postExpires` are expired after the distribute. But the claims run after the postExpires. A vault whose boost is postExpired: its claim's owed computation... the crank computes owed for a plain active vault (not preExpired). But a postExpired vault's boost is expired after the distribute. So at claim time, its boost is 0. The crank's owed computation for it (plain active, with boost_weight from the record) would use the OLD boost_weight. Hmm.

Wait — let me re-read. The records are read at the start of the pass (before any sends). A postExpired vault's record has boost_weight = B (its live boost). The crank's owed computation for a plain active vault:
```js
else owed = pendingSats({ level: r.level, debt: r.debt_scaled, boost: r.boost_weight ?? 0, carry: r.carry_scaled ?? 0n }, acc)
```
So it uses boost = B (the live boost) and the post-distribution acc. But the postExpire expires the boost AFTER the distribute and BEFORE the claim. So at claim time, the vault's boost is 0, and its carry/debt are reweighed.

Let me compute what the program pays. After the distribute (acc = acc_new), the postExpire runs expire_boost: reweigh to 0. carry = owed_of(with boost B, at acc_new) = (level + B) * acc_new + carry_old - debt_old. debt = level * acc_new. Then the claim: owed = level * acc_new + carry - debt = level * acc_new + (level + B) * acc_new + carry_old - debt_old - level * acc_new = (level + B) * acc_new + carry_old - debt_old. 

The crank's computation: pendingSats({level, debt: debt_old, boost: B, carry: carry_old}, acc_new) = ((level + B) * acc_new + carry_old - debt_old) / SCALE. Same! So the crank's computation matches the program's payment even for a postExpired vault. Because the boost earns its last distribution (the one that made it due), and the expiry just reweighs (preserving the owed). OK, correct.

Wait, let me double-check the program's expire timing. The boost's end_epoch == dist_epoch + 1 (the new epoch after this distribution). The program's claim expires a boost if `dist_epoch >= boost_end_epoch`. After the distribute, dist_epoch = old + 1 = end_epoch. So the claim WOULD expire it (if the postExpire didn't already). But the crank sends the postExpire before the claims. So the postExpire expires it, and the claim sees boost_weight == 0. Either way, the owed is the same (the expiry preserves it). OK.

Actually — hmm, wait. Does the boost earn the distribution that makes it due? Let me check the program. The boost's end_epoch = E. It earns distributions while dist_epoch < E... no. Let me re-read.

`boost_vault`: end = dist_epoch + epochs. So a boost bought at epoch D with N epochs ends at D + N. It earns distributions at epochs D+1, D+2, ..., D+N (N distributions). When dist_epoch reaches D+N (= end), the boost is due (dist_epoch >= end). So the distribution that advances dist_epoch to D+N is the boost's LAST (it earns that one, because at credit time, the boost is still live — the due check is after). Let me verify: `advance_epoch` increments dist_epoch and adds the expiring boosts to boosts_due. So the distribution at epoch E credits the boost (it's still live during credit), then advance_epoch marks it due. So the boost earns its Nth distribution, then is due. OK.

So the crank's postExpires (end_epoch == dist_epoch + 1) are boosts that earn THIS distribution (the one advancing to dist_epoch + 1 = end_epoch) and then are due. The crank's owed computation includes the boost for this distribution. Correct. OK.

Now, let me look at the crank's preExpires: boosts with `dist_epoch >= boost_end_epoch` (due NOW, before this distribution). These are expired BEFORE the distribute, so they DON'T earn this distribution. The crank's owed computation for a preExpired vault: atExpiry (at old acc, with boost) + level weight * (acc_new - acc_old). So the boost earns up to the old acc (its last distribution was the previous one), and this distribution is at level weight only. Correct (the boost was due, so it's expired before this distribution). OK.

Now, let me look at a potential issue: the program's distribute refuses if boosts_due > 0. The crank's preExpires expire all due boosts before the distribute. So boosts_due == 0 at distribute. OK.

But — the crank's preExpires are computed from records. The config's boosts_due is the on-chain counter. If they disagree (a program bug), the distribute might refuse. But that's a bug scenario. OK.

Now, let me look at the alarm's `detectPoolHealth` and the frozen pool. OK.

Now, let me look at a potential issue: the crank's `plan.distribute` is not planned if the pool is frozen. And the claims are not planned if the pool is frozen. OK.

Now, let me look at the alarm's `detectRedemptionRate` and the ring read. The ring is `cur['burn.rate_ring']` (64 i64 as strings). OK.

Now, let me look at a potential issue: the alarm reads BURN's config for the ring. The ring is `[i64; 64]` = 512 bytes. The layout decodes it. OK.

Now, let me look at the alarm's `detectUpgradeAuthorityAfterLock` and the sweep helper. It includes 'sweep' in the five. OK.

Now, let me look at a potential issue: the alarm's `readConfigs` reads the sweep helper's ProgramData. The sweep is a native program (not Anchor), but it's still deployed via the BPF loader, so it has a ProgramData account. OK.

Now, let me look at the sweep helper's source for an issue.

```rust
pub fn process(_program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data != [0] { return Err(ProgramError::InvalidInstructionData); }
    if accounts.len() < 4 || (accounts.len() - 4) % 2 != 0 { return Err(ProgramError::NotEnoughAccountKeys); }
    let (signer, dest, token, system) = (&accounts[0], &accounts[1], &accounts[2], &accounts[3]);
    if !signer.is_signer { return Err(ProgramError::MissingRequiredSignature); }
    if *token.key != SPL_TOKEN_ID || *system.key != system_program::ID { return Err(ProgramError::IncorrectProgramId); }
    if signer.key == dest.key { return Err(ProgramError::InvalidArgument); }
    for pair in accounts[4..].chunks(2) {
        let (src, to) = (&pair[0], &pair[1]);
        let (src_mint, src_owner, amount) = read_token(src)?;
        let (to_mint, to_owner, _) = read_token(to)?;
        if src_owner != *signer.key { ... IllegalOwner ... }
        if to_owner != *dest.key || to_mint != src_mint { ... InvalidAccountData ... }
        if amount > 0 { ... transfer ... }
        ... close ...
    }
    let lamports = signer.lamports();
    if lamports > 0 { ... transfer all lamports to dest ... }
    Ok(())
}
```

So the sweep: for each (source, dest) pair, the source must be owned by the signer (the vault PDA), the dest must be owned by the dest wallet and same mint. Transfer all, close. Then transfer all lamports to dest.

Potential issue: the close sends the source's rent to `dest` (the destination wallet). Wait — the close instruction: `CloseAccount { account: src, destination: dest, owner: signer }`. So the rent goes to dest (the wallet), not the dest token account. Let me check: `AccountMeta::new(*dest.key, false)` — dest is the destination WALLET (accounts[1]). So the close's destination is the wallet. OK, the rent goes to the wallet.

Hmm, wait — but the pair's `to` is the destination TOKEN account. The close's destination is `dest` (the wallet), not `to`. Let me re-read:

```rust
invoke(&Instruction { program_id: SPL_TOKEN_ID, data: vec![IX_CLOSE_ACCOUNT], accounts: vec![
    AccountMeta::new(*src.key, false), AccountMeta::new(*dest.key, false), AccountMeta::new_readonly(*signer.key, true)] }, ...)
```

So CloseAccount { account: src, destination: dest (the wallet), owner: signer }. The rent goes to the wallet. OK. The comment says "closes the source (its rent to the destination wallet)". OK.

Now, a potential issue: the sweep transfers the source's balance to `to` (the dest token account), then closes the source to the wallet. OK.

Now, the lamports sweep: `system_instruction::transfer(signer.key, dest.key, lamports)`. So all the vault wallet's lamports to the dest wallet. OK.

Now, a potential issue: the sweep requires `signer.key != dest.key`. So the vault PDA can't be the dest. OK.

Now, a potential issue: the sweep's `read_token` requires the account to be a classic SPL token account (owner SPL_TOKEN_ID, len 165). A Token-2022 account is refused (IllegalOwner). A frozen account: read_token doesn't check the state. So a frozen source's transfer would fail at the Token program (frozen). The whole redemption reverts. Limit 44 covers this (a frozen stray account holding a balance reverts the redemption). OK.

Now, a potential issue: the sweep is called via Core ExecuteV1. Core signs as the vault PDA. The sweep's `signer` is the vault PDA (accounts[0]). Core's ExecuteV1 makes the PDA sign. So `signer.is_signer` is true (Core signs). OK.

Now, a potential issue: the sweep's access control is entirely Core's ExecuteV1 authority rule (only the asset's owner can Execute). Limit 40's round-25 N3 covers this. OK.

Now, let me look at a potential issue: the sweep's `data != [0]` check. So only a single byte 0 (SweepAll). OK.

Now, let me look at the sweep's pair count: `(accounts.len() - 4) % 2 != 0` refused. So pairs. OK.

Now, let me look at a potential issue: the sweep's dest token account must be owned by the dest wallet and same mint. But it doesn't check the dest token account is the dest wallet's ATA. So a redemption could sweep to any of the dest wallet's token accounts for that mint (not necessarily the ATA). That's fine (the redeemer chooses). OK.

Now, let me look at a potential issue: the sweep's source must be owned by the signer (vault PDA). But it doesn't check the source is a CANONICAL reserve ATA. So the sweep can move ANY classic token account the vault PDA owns (of any mint). That's the intended "rescue stray classic tokens" (limit 44, round 25 D7). OK.

Now, let me look at the BURN program's emptiness proof interaction. The sweep empties the named accounts and closes them. BURN's burn_vault checks the declared reserve accounts are empty. The sweep closes them, so they're empty (and closed). OK.

Now, let me look at a potential issue: the sweep closes the source accounts. BURN checks `amount == 0`, not closure. A closed account has amount 0. OK. And the sweep must close them (else the rent is stranded, limit 42/D8). OK.

Now, let me look at the redemption ordering: claim (if owed), open (SEAL), sweep (Core ExecuteV1), burn (BURN). The sweep moves the claim's payment out too. OK.

Now, let me look at a potential issue: the sweep is called with the vault PDA as signer. But the claim pays INTO the vault's cbBTC account (owned by the vault PDA). The sweep then moves it out. OK.

Now, let me look at the alarm's watching of the sweep helper. `prog.sweep.upgrade_authority` and `prog.sweep.hash`. OK.

Now, let me look at a potential issue: the sweep helper has no upgrade authority after the lock. The build proves its bytes are identical to the tested ones. OK.

Now, let me think about whether there's a REAL finding I've been circling. Let me re-read the crank's `planCrank` for the `retireBurned` and the `retiringOwed` interaction once more.

```js
let retiringOwed = 0n
for (const addr of plan.retireBurned) {
  const r = records.find(x => x.address === addr)
  if (!r?.active) continue
  try { retiringOwed += pendingScaled({...}, cfg.acc_scaled) }
  catch (e) { plan.problems.push(...) }
}
const owedAfterRetire = BigInt(cfg.owed_scaled) > retiringOwed ? BigInt(cfg.owed_scaled) - retiringOwed : 0n
```

So the crank subtracts the retiring vaults' owed from owed_scaled. But the program's retire does the same. OK.

But — the `pendingScaled` can throw (debt above entitlement). The catch pushes a problem and continues. So retiringOwed might be under-counted (a throwing vault is skipped). Then owedAfterRetire is over-counted (the throwing vault's owed isn't subtracted). Then avail is under-counted (available = pool - owedAfterRetire). So the crank plans a smaller distribution than the program would. The program's distribute computes avail itself. If the crank plans a credit distribution but the program's avail is different... hmm. Actually, the crank's `avail` only decides WHETHER to distribute and the acc advance. The program distributes its own avail. If the crank's avail is under-counted (a throwing vault), the crank might plan no distribute (avail == 0) while the program's avail > 0. Then the crank misses a distribution. But a throwing pendingScaled means the record and the accumulator disagree (a program bug or