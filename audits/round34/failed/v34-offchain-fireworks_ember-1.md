[reasoning only]
Let me start by understanding what I'm being asked to do. This is round 34 of an AI audit process for a Solana vault system. The previous round (33) verdict is bundled and found:
- L1 (LOW): `detectSweepState` compared box wall clock with chain clock — REPAIRED (symmetric window)
- D1 (INFO): comment overstated; pending candidate explaining a sweep — REPAIRED (landed lookup)
- D2 (INFO): `mint.last_sweep_at` not in WATCHED_KEYS — REPAIRED
- D3 (INFO): SPEC "47 launch" count not checked — REPAIRED
- Gate-5 obligation: pre-existing wSOL balance claim needed an on-chain arm — DISCHARGED (R33.G4)

My job: independently audit the whole current tree, verify round 33's repairs hold, and find new defects. The targets are R0 (round 33 verdict), R1 (crank), R2 (alarm), R3 (layouts), R4 (money arithmetic), R5 (swap and revenue), R6 (gates).

Let me work through the files carefully.

**R0: Round 33's verdict and repairs**

Round 33 found L1: `detectSweepState` compared `t` (chain time from `last_sweep_at`) with `st = Date.parse(c.startedAt)` (box wall clock). The repair: symmetric window `|t - st| <= cooldown/2`, and uncertain sends only explain when a direct `getSignatureStatuses` lookup shows landed. Also the cooldown used is the smallest ever seen.

Let me check the current `detectSweepState`:

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
}
```

Wait — there's a subtlety here. The window is `|t - st| <= half`. The claim in SPEC limit 10 round 33 text: "a thief's sweep cannot sit inside an honest cycle's window, since it must wait a full cooldown after the honest one and revenue.mjs writes a row only once the cooldown has passed".

Hmm, let me think about this. The honest cycle: revenue.mjs writes the row with `startedAt` = box time when the cycle STARTS (before the sweep is sent). The sweep lands at chain time `t = last_sweep_at`. So `t - st` = (time from cycle start to sweep landing) + (chain-box skew). The cycle start to sweep landing is seconds normally. So honest: `|t - st|` is small. Good.

A thief's sweep: must wait a full cooldown after the honest sweep (chain-enforced: `now >= last_sweep_at + cooldown`). So thief's `t_thief >= t_honest + cooldown`. The honest cycle's window is `[st_honest - half, st_honest + half]`. Since `st_honest ≈ t_honest` (within skew), `t_thief >= t_honest + cooldown > st_honest + half` when `cooldown > half + skew`, i.e. always since half = cooldown/2. OK.

But wait — what about a thief's sweep and the NEXT honest cycle? The next honest cycle starts after the cooldown from the thief's sweep... no wait, the honest cycle starts when revenue.mjs runs and the cooldown from the LAST sweep (the thief's) has passed. So `st_next ≈ t_thief + cooldown`. The thief's sweep at `t_thief` vs the next honest window `[st_next - half, st_next + half]`: `t_thief ≈ st_next - cooldown < st_next - half`. So the thief's sweep is NOT inside the next honest window either. Good.

But here's a question: what if the thief sweeps, and then the alarm reads `last_sweep_at` = t_thief, and there's NO honest cycle at all? Then no cycle explains it → pages CRITICAL. Good.

What if revenue.mjs is DOWN (not running) and the thief sweeps? Then no rows at all → pages. Good.

Now, the round 33 repair also says the cooldown used is the SMALLEST ever seen. In alarm.mjs:

```js
const cooldownSeen = Math.min(...[prev?.sweepCooldownSeen, cfg['mint.sweep_cooldown_secs']].map(Number).filter(n => Number.isFinite(n) && n > 0), 21600)
```

Wait, `Math.min(..., 21600)` — so it's capped at 21600 (6h, the ruled value). And it's the min of the previous seen and current. Since a vote can only LENGTHEN the cooldown, the smallest ever seen is a lower bound on the true cooldown at any past time... hmm, actually is that right? The cooldown at the time of the sweep could have been shorter than the current one (if a vote lengthened it). Using the smallest ever seen makes the window NARROWER, which is the loud direction (more likely to page). OK.

But wait: there's a subtle issue. The window is `|t - st| <= half` where half = cooldownSeen/2. If the cooldown was lengthened from 6h to 24h, then cooldownSeen = 6h (the smallest), half = 3h. An honest cycle: revenue.mjs writes a row only once the cooldown (24h now) has passed since the last sweep. So `st_next ≈ t_prev + 24h`. The previous honest sweep at `t_prev` vs the window `[st_next - 3h, st_next + 3h]`: `t_prev ≈ st_next - 24h`, way outside. Fine.

Hmm, but actually there's a potential FALSE POSITIVE here: consider the alarm's FIRST run after deployment, or after the feature shipped. `sweepCooldownSeen` starts undefined; `prev?.sweepCooldownSeen` is undefined, so cooldownSeen = min(current, 21600). If current is 21600, fine.

Actually wait, there's a subtler issue: `Math.min(...[...].filter(...), 21600)`. If BOTH prev and current are missing/non-finite, the filter gives an empty array, and `Math.min(21600)` = 21600. OK, defaults to 21600. Fine.

Now let me look at the `landed` lookup in alarm.mjs:

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

OK. That looks right.

D2 repair: `mint.last_sweep_at` is now in WATCHED_KEYS (I see it in the list with the round 33 D2 comment). Good.

D3 repair: SPEC's Running-the-tests block now says "47 launch and" and the RX.launch pattern is `/(\d+) launch\b/g`. Let me check: the block says "47 launch and 33 live-mainnet". The pattern `/(\d+) launch\b/` matches "47 launch". And the selftest has:
```js
t('R33 D3: the launch count reader sees the Running-the-tests phrasing and a planted stale one',
  [statedIn('47 launch and 33 live-mainnet', 'launch'), statedIn('48 launch and', 'launch').every(n => n === num(/^LAUNCH_FLOOR=(\d+)/m, runner))], [[47], false])
```
Good.

Gate-5 obligation: R33.G4 in the suite pins the pre-filled wSOL account closing. That's in tests/3prog.test.ts which I don't have in full, but VALIDATION says it passed 866/866.

Now, let me look for NEW defects. Let me go through the targets.

**R1: The crank**

Let me look at `planCrank` carefully.

```js
for (const r of records) {
  if (r.level !== 0 || r.entropy_set) continue
  const rs = BigInt(r.reveal_slot)
  if (BigInt(slot) > rs + BigInt(L.REVEAL_WINDOW_SLOTS)) plan.reschedule.push(r.address)
  else if (slot > readySlot(r.reveal_slot)) { plan.capture.push(r.address); capturedThisPass.add(r.address) }
}
```

`readySlot(revealSlot)`: 
```js
export function readySlot(revealSlot) {
  let a = Number(revealSlot)
  for (let i = 0; i < 2; i++) a = (Math.floor(a / 4) + 2) * 4
  return a
}
```

MINT's `try_capture`: A is the first produced slot at or after reveal_slot; B is first produced at or after (A/4 + 2)*4; C similarly after B. `readySlot` computes: a = reveal_slot; then a = (floor(a/4)+2)*4 twice. Hmm, this approximates "the slot at which all three hashes exist". A >= reveal_slot, B >= (floor(A/4)+2)*4, C >= (floor(B/4)+2)*4. readySlot computes (floor(reveal_slot/4)+2)*4 then again. Since A >= reveal_slot, floor(A/4) >= floor(reveal_slot/4), so B >= (floor(reveal_slot/4)+2)*4... wait no: B >= (floor(A/4)+2)*4 >= (floor(reveal_slot/4)+2)*4. And C >= (floor(B/4)+2)*4. readySlot's second iteration: (floor(B'/4)+2)*4 where B' = (floor(reveal_slot/4)+2)*4 <= B. So readySlot <= C's earliest possible slot. So `slot > readySlot` is a necessary but not sufficient condition for all three hashes to exist. The comment says "The slot after which all three entropy slot hashes exist on a fork that skips nothing: each is two 4-slot leader groups past the last (MINT try_capture). Skipped slots only push it later, and a NotYet answer is harmless." OK so it's a lower bound, and a premature capture gets RevealTooEarly which is benign. Fine.

Reveal order: from `cfg.revealed_total`, while next vault is ready. Uses `byIndex` map. Note: `byIndex` is built from ALL records (including retired ones). A retired vault with level 0... hmm, can a vault be retired with level 0? `retire_burned` doesn't need a drawn level (round 23 I1). So a bare-burned unrevealed vault gets retired with level 0. Then in the reveal loop: `if (!r || r.level !== 0) break` — a retired vault with level 0 would NOT break the loop! It would be pushed to plan.reveal. But wait — can reveal_level be called on a retired vault? Looking at MINT's reveal_level: it checks `ctx.accounts.vault_record.level == 0` (AlreadyRevealed otherwise), `index == revealed_total` (RevealOutOfOrder), and handles burned assets (skips the Core write). It does NOT check `retired`. So revealing a retired vault works on chain. And the FIFO requires it: if vault #5 was bare-burned before reveal, vault #6 can't reveal until #5 does (RevealOutOfOrder). So the crank MUST reveal retired burned vaults. And indeed the reveal loop doesn't skip retired records. Good — that's correct behavior.

But wait: in the reveal loop, `if (!(r.entropy_set || capturedThisPass.has(r.address))) break`. For a retired vault, capture: the capture loop skips retired? Let me check: `for (const r of records) { if (r.level !== 0 || r.entropy_set) continue; ... }` — no retired check. So a retired unrevealed vault still gets captured/rescheduled. Good, because the FIFO needs it.

Hmm wait, but there's a subtlety: `reschedule_reveal` on a retired vault — MINT's reschedule_reveal checks `r.level == 0 && !r.entropy_set` but not retired. OK fine.

Now the reveal send loop in main():

```js
for (const a of plan.reveal) {
  const r = byAddr.get(a)
  let list = []
  const how = revealAttrSource(assets[r.asset])
  if (how === 'skip') { ...; break }
  if (how === 'read') { ... }
  const ok = await send(...)
  if (ok === 'fail') { failures.push(...); break }
  if (ok === 'benign') break
}
```

For a burned asset, `how === 'empty'`, list = []. MINT's reveal_level for a burned asset skips the attribute hash check? Let me check: `if !burned { ...require hashv == hash... }`. Yes, for burned it skips the hash check. Good.

Now `retireBurned`: `if (!r.retired && assets[r.asset] === 'burned') plan.retireBurned.push(r.address)`. This includes unrevealed ones. Good (round 23 I1).

But note the ORDER of sends in main(): reschedule, capture, reveal, retire, preJoins, preExpires, split, distribute, postExpires, activate, claims. Retire comes after reveal. Fine.

Now, an important one: the reveal loop `break`s on the first skip/fail/benign. Since reveals must be in order, that's right.

Let me look at the activate planning:

```js
for (const r of records) {
  if (r.level === 0 || r.active || r.pending || r.retired || assets[r.asset] !== 'live') continue
  const t = tokens[r.asset]
  if (!t || t.state !== 'ok') continue
  if (BigInt(t.amount) >= L.ACTIVATION_SATS) plan.activate.push(r.address)
}
```

`tokens[r.asset]` is the vault's canonical cbBTC account: `tokenAddr = r => r.active ? r.vault_ata : ataOf(payMint, signerPda(r.asset))`. For a non-active vault, the ATA of the signer PDA. OK.

Now joins:

```js
const destOf = r => r.pending ? r.vault_ata : tokens[r.asset]?.address
```

For preJoins: `plan.preJoins.push([r.address, r.vault_ata])`. For joins (after distribution): `const dest = destOf(r); if (dest) plan.joins.push([r.address, dest])`. Since r.pending is true, dest = r.vault_ata. OK.

Claim batch construction:

```js
ready.push(...plan.joins)
for (let i = 0; i < ready.length; i += batch) plan.claims.push(ready.slice(i, i + batch))
```

Wait — `plan.joins` are pairs [record, ata] of vaults being JOINED this pass (after the distribution). They're added to `ready` so they get delivered in the claims. But a vault that just joined has debt = weight * acc (the post-distribution acc), so it's owed 0. Including it in a claim batch is harmless (claim skips owed-0 vaults? No wait — claim JOINS pending vaults; but these vaults were already joined by... hmm.

Wait, let me re-read. `plan.joins` is "every vault this pass's distribution makes eligible (asked in the current epoch, already on chain)". These are vaults with `request_epoch === cfg.dist_epoch` (the CURRENT epoch, before this pass's distribution). After this pass's distribution, dist_epoch becomes cfg.dist_epoch + 1 > request_epoch, so they're eligible to join. The claim instruction joins them (the `if r.pending` branch in MINT's claim).

But hold on: `plan.preJoins` are vaults with `request_epoch < cfg.dist_epoch` (eligible NOW, before the distribution). They're joined in their own batches BEFORE the distribution (because the program refuses a distribution while one waits — JoinWaitingFirst).

Then `plan.joins` (request_epoch === dist_epoch) join AFTER the distribution via the claim batches.

Now in the claims planning loop:

```js
const preJoined = new Set(plan.preJoins.map(([a]) => a))
...
for (const r of records) {
  const joinedNow = preJoined.has(r.address)
  if ((!r.active && !joinedNow) || r.retired) continue
  ...
}
```

So pre-joined vaults are also considered for delivery (they share this pass's distribution). Their owed: `pendingSats({ level: r.level, debt: L.LEVEL_WEIGHTS[r.level - 1] * BigInt(cfg.acc_scaled) }, acc)` where acc is the post-distribution accumulator. Since they join at debt = weight * cfg.acc_scaled (the PRE-distribution acc, because join happens before distribute)... wait, no. The pre-joins happen BEFORE the distribution in the crank's send order. MINT's join sets `debt = weight * acc` at the CURRENT acc (pre-distribution). Then the distribution raises acc. So the pre-joined vault earns from this distribution: owed = weight * (acc_new - acc_old). The crank computes `pendingSats({level, debt: weight * cfg.acc_scaled}, acc)` where cfg.acc_scaled is the pre-distribution acc and acc is post. That's exactly right.

And `plan.joins` vaults (joined by the claim itself): they join at debt = weight * acc_new (the post-distribution acc, since the claim's monthly_inline runs first... wait, no. The claim instruction runs monthly_inline FIRST (which performs the distribution if due), THEN joins. Hmm, but the crank already sent an explicit distribute before the claims. So when the claim runs, the distribution already happened, acc is at its new value, and the join sets debt = weight * acc_new. Owed 0. Correct.

But wait — there's a subtle issue with the explicit `distribute` and the claim's monthly_inline. The crank sends `distribute` (free monthly). Then the claim's monthly_inline sees last_distribute_at = now (just stamped), so it's not due, does nothing. Good.

But what if the explicit distribute was a 'tick' (w === 0, nobody joined)? Then plan.joins includes vaults with request_epoch === dist_epoch, and after the tick dist_epoch advanced, so they join in the claims. And `ready.push(...plan.joins)` adds them. But with w === 0 there's no credit, so no vault is owed anything; the joins just join them. The claim with those pairs: each pair joins (n_joined++), owed 0, no payment. Fine.

Hmm, but wait: in the tick case, `plan.distribute = true; plan.distributeKind = 'tick'`. Then the joins loop runs `if (plan.distribute)`. Good.

Now, what about `plan.postExpires`? Boosts this pass's distribution makes due: `BigInt(r.boost_end_epoch) === BigInt(cfg.dist_epoch) + 1n`. After the distribution, dist_epoch = cfg.dist_epoch + 1 = boost_end_epoch, so they're due. Expired right after. Good.

But here's a question: the preExpires check is `BigInt(cfg.dist_epoch) >= BigInt(r.boost_end_epoch)` — due NOW (before the distribution). And the program refuses a distribution while any is due (BoostsExpireFirst). So preExpires must be sent before distribute. In main(): `await expire('before', plan.preExpires)` comes before the split and distribute. Good.

Wait, actually there's an ordering issue in main(): the order is reschedule, capture, reveal, retire, preJoins, preExpires, split, distribute, postExpires, activate, claims. Let me check against the plan's assumptions:

- preJoins before distribute: yes (JoinWaitingFirst).
- preExpires before distribute: yes (BoostsExpireFirst).
- split before distribute: yes, and splitToPool is counted toward the distribution's avail. Good.
- retire before distribute: yes, and retiringWeight/retiringOwed are accounted. Good.

Now, one thing to check: `plan.distribute` uses `w = total_active_weight + preJoinWeight - retiringWeight - expiringWeight`. The preJoinWeight is the weight of vaults joined this pass before the distribution. But wait — the pre-joined vaults join at their LEVEL weight only (join uses `LEVEL_WEIGHTS[r.level - 1]`, no boost — a pending vault can't have a boost since boost requires active). OK. And retiringWeight uses wOf (level + boost) for active retiring vaults. expiringWeight is the boost weight of pre-expired vaults. So w = the weight that the distribution will actually credit over. Let me verify against MINT's distribute: `let w = ctx.accounts.config.total_active_weight` at the time distribute runs. At that point: pre-joins added preJoinWeight, retires removed retiringWeight, pre-expires removed expiringWeight. So w matches. Good.

And `acc += avail * ACC_SCALE / w` — matches credit's delta. Good.

Now the owed computation for claims. For a normal active vault: `pendingSats({ level, debt: r.debt_scaled, boost: r.boost_weight ?? 0, carry: r.carry_scaled ?? 0n }, acc)`. That's (weight + boost) * acc + carry - debt, over ACC_SCALE. Matches owed_of. Good.

For a pre-expired vault (boost expired this pass before the distribution): 
```js
const atExpiry = pendingScaled({ level: r.level, debt: r.debt_scaled, boost: r.boost_weight, carry: r.carry_scaled }, cfg.acc_scaled)
owed = (atExpiry + L.LEVEL_WEIGHTS[r.level - 1] * (acc - BigInt(cfg.acc_scaled))) / ACC_SCALE
```
At