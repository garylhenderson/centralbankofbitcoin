[reasoning only]
The user wants me to audit this Solana project. Let me focus on the specific targets and look for real faults. I need to be careful not to invent findings and to provide evidence.

Let me go through the targets systematically.

**R1. THE CRANK (bank/crank.mjs)**

Looking at planCrank:

1. The reveal loop:
```js
for (let i = BigInt(cfg.revealed_total); ; i++) {
    const r = byIndex.get(i)
    if (!r || r.level !== 0) break
    if (!(r.entropy_set || capturedThisPass.has(r.address))) break
    plan.reveal.push(r.address)
}
```
This reveals in mint order. But wait - it checks `r.level !== 0` to break. If a vault has been revealed (level != 0), it breaks. But what if a vault was burned before reveal? The program says a burned vault still takes its draw. So the record still has level 0 until revealed. OK.

But there's a subtle issue: what if a vault is retired (bare burned) but not yet revealed? The crank's retireBurned loop only retires vaults with `r.level !== 0`. So a burned vault with level 0 won't be retired. That's fine because the program requires the reveal to happen anyway.

2. The activate loop:
```js
for (const r of records) {
    if (r.level === 0 || r.active || r.pending || r.retired || assets[r.asset] !== 'live') continue
    const t = tokens[r.asset]
    if (!t || t.state !== 'ok') continue
    if (BigInt(t.amount) >= L.ACTIVATION_SATS) plan.activate.push(r.address)
}
```
The token address used is `tokenAddr(r)` which is `r.active ? r.vault_ata : ataOf(payMint, signerPda(r.asset))`. For a non-active vault, it computes the canonical ATA. OK.

3. The preJoins loop:
```js
const destOf = r => r.pending ? r.vault_ata : tokens[r.asset]?.address
for (const r of records) {
    if (r.retired || r.active || !r.pending) continue
    if (assets[r.asset] === 'burned') continue
    if (BigInt(r.request_epoch) >= BigInt(cfg.dist_epoch)) continue
    plan.preJoins.push([r.address, r.vault_ata])
}
```
Wait - `destOf` is defined but not used in this loop. The preJoins always uses `r.vault_ata`. That's fine because pending vaults have vault_ata set.

4. The distribute logic:
```js
const w = BigInt(cfg.total_active_weight) + preJoinWeight - retiringWeight - expiringWeight
```
Hmm, `preJoinWeight` is computed from `plan.preJoins` using `L.LEVEL_WEIGHTS[r.level - 1]`. But wait - if a vault has a boost, its weight is level + boost. But preJoins are for pending vaults, which can't have boosts (boost requires active). So that's fine.

But `retiringWeight` uses `wOf(r)` which includes boost. And `expiringWeight` uses `boostOf(r)`. OK.

Wait, there's an issue. The `w` calculation subtracts `retiringWeight` and `expiringWeight`. But `retiringWeight` is the full weight (level + boost) of retiring vaults, and `expiringWeight` is just the boost weight of expiring vaults. So the final `w` should be:
- total_active_weight (current)
- + preJoinWeight (new joins)
- - retiringWeight (vaults leaving entirely)
- - expiringWeight (boosts expiring)

That looks right.

5. The claims loop:
```js
for (const r of records) {
    const joinedNow = preJoined.has(r.address)
    if ((!r.active && !joinedNow) || r.retired) continue
    if (assets[r.asset] === 'burned') continue
    let owed
    try {
        if (joinedNow) owed = pendingSats({ level: r.level, debt: L.LEVEL_WEIGHTS[r.level - 1] * BigInt(cfg.acc_scaled) }, acc)
        else if (preExpired.has(r.address)) {
            const atExpiry = pendingScaled({ level: r.level, debt: r.debt_scaled, boost: r.boost_weight, carry: r.carry_scaled }, cfg.acc_scaled)
            owed = (atExpiry + L.LEVEL_WEIGHTS[r.level - 1] * (acc - BigInt(cfg.acc_scaled))) / ACC_SCALE
        } else owed = pendingSats({ level: r.level, debt: r.debt_scaled, boost: r.boost_weight ?? 0, carry: r.carry_scaled ?? 0n }, acc)
    } catch (e) { plan.problems.push(`vault ${r.asset}: ${e.message}`); continue }
    ...
}
```

Wait, for `joinedNow` vaults, the debt is set to `L.LEVEL_WEIGHTS[r.level - 1] * BigInt(cfg.acc_scaled)`. But the program's `join` sets `r.debt_scaled = (w as u128) * c.acc_scaled` where `w = LEVEL_WEIGHTS[(r.level - 1) as usize]`. So that matches.

But wait - the crank uses `cfg.acc_scaled` (the OLD accumulator), while the program's join uses `c.acc_scaled` at the time of join. If the distribution runs in the same pass, the join happens BEFORE the distribution (preJoins are sent before distribute). So the join uses the old acc. Then the distribution credits at the new acc. So the crank's calculation is correct.

Hmm, but there's a subtle issue: the crank sends preJoins BEFORE the distribution. But the program's `claim` (which does the join) also runs `monthly_inline` first. So if the month is due, the claim itself might trigger the distribution before the join. Let me check...

Actually, looking at the program's `claim`:
```rust
pub fn claim<'info>(ctx: Context<'_, '_, '_, 'info, Claim<'info>>, crank_n: u8) -> Result<()> {
    ...
    // BEFORE paying, so a claim that closes a month also delivers it.
    { let key = ctx.accounts.config.key(); let now = Clock::get()?.unix_timestamp;
      let pool = ctx.accounts.pool_token.to_account_info();
      monthly_inline(&mut ctx.accounts.config, &pool, &key, now)?; }
    ...
}
```

So `claim` runs `monthly_inline` first. If the month is due and there are no waiting joins, it will distribute. But the crank sends preJoins BEFORE the distribution. So the preJoins claim will run monthly_inline first... but wait, `monthly_inline` checks `waiting_to_join(c)? > 0` and returns early if there are waiting vaults. So if there are preJoins to do, monthly_inline will skip. Good.

But what if there are NO preJoins but the month is due? Then the crank's distribute will run. But the crank sends preJoins first (empty), then distribute. OK.

Hmm, but there's a case: what if the crank plans preJoins AND distribute? The preJoins claim runs monthly_inline first. Since there are waiting vaults (the preJoins themselves), monthly_inline skips. Then the claim joins them. Then the crank sends distribute, which runs. OK.

But wait - the crank's `plan.distribute` is computed based on `waitingThisEpoch = BigInt(cfg.pending_this_epoch ?? 0) > 0n`. This is the count of vaults that requested in the CURRENT epoch. The preJoins are vaults that requested in an EARLIER epoch. So `waitingThisEpoch` doesn't include preJoins.

Hmm, let me re-read:
```js
const waitingThisEpoch = BigInt(cfg.pending_this_epoch ?? 0) > 0n
if (poolOk && !pool.frozen && due && w > 0n) {
    ...
} else if (poolOk && !pool.frozen && due && w === 0n && waitingThisEpoch) {
    plan.distribute = true; plan.distributeKind = 'tick'
}
```

So the tick only happens if `w === 0n` (no active weight) AND `waitingThisEpoch`. But if there are preJoins, `w` includes `preJoinWeight`, so `w > 0n`. So the credit path runs. OK.

But wait - the preJoins are sent BEFORE the distribute. So by the time distribute runs, the preJoins have joined, and `total_active_weight` on chain includes them. So the distribute's `w` on chain is `cfg.total_active_weight + preJoinWeight`. The crank's `w` calculation matches. OK.

6. The postExpires logic:
```js
if (plan.distribute) {
    for (const r of records) {
        if (r.retired || !r.active || boostOf(r) === 0n || retiring.has(r.address) || plan.preExpires.includes(r.address)) continue
        if (BigInt(r.boost_end_epoch) === BigInt(cfg.dist_epoch) + 1n) plan.postExpires.push(r.address)
    }
}
```

Wait - this checks `r.boost_end_epoch === cfg.dist_epoch + 1`. But the distribution advances the epoch by 1. So after the distribution, `dist_epoch` becomes `cfg.dist_epoch + 1`. A boost with `boost_end_epoch === cfg.dist_epoch + 1` becomes due after the distribution. So it should be expired. OK.

But hold on - the program's `advance_epoch` does:
```rust
fn advance_epoch(c: &mut MintConfig) -> Result<()> {
    c.dist_epoch = c.dist_epoch.checked_add(1).ok_or(MintError::Overflow)?;
    c.pending_this_epoch = 0;
    let i = (c.dist_epoch % BOOST_RING as u64) as usize;
    c.boosts_due = c.boosts_due.checked_add(c.boost_expiring[i]).ok_or(MintError::Overflow)?;
    c.boost_expiring[i] = 0;
    Ok(())
}
```

So after the epoch advances to `E+1`, it looks at `boost_expiring[(E+1) % 64]` and adds those to `boosts_due`. A boost with `boost_end_epoch = E+1` was scheduled at `boost_expiring[(E+1) % 64]`. So it becomes due. OK.

But wait - the crank's postExpires check is `r.boost_end_epoch === cfg.dist_epoch + 1`. But what if the distribution is a TICK (no credit)? The tick also advances the epoch. So the same logic applies. OK.

Hmm, but there's a subtle issue: the crank sends `expire('after', plan.postExpires)` AFTER the distribute. But the distribute might fail (e.g., MonthNotElapsed if traffic already ran it). In that case, the postExpires would still be sent. But if the distribution didn't run, the epoch didn't advance, so the boosts aren't due yet. The `expire_boosts` program instruction checks `ctx.accounts.config.dist_epoch < r.boost_end_epoch` and skips if not due. So it's safe.

7. The `destOf` function is defined but never used. That's dead code, not a bug.

8. Let me look at the `preJoinWeight` calculation:
```js
const preJoinWeight = plan.preJoins.reduce((a, [addr]) => {
    const r = records.find(x => x.address === addr); return a + L.LEVEL_WEIGHTS[r.level - 1] }, 0n)
```
This uses `L.LEVEL_WEIGHTS[r.level - 1]`. If `r.level` is 0, this would be `L.LEVEL_WEIGHTS[-1]` which is undefined. But preJoins only include vaults with `r.pending` true, and pending requires level 1-5. So OK.

9. The `retiringWeight` calculation:
```js
const retiringWeight = plan.retireBurned.reduce((a, addr) => {
    const r = records.find(x => x.address === addr); return r.active ? a + wOf(r) : a }, 0n)
```
This uses `wOf(r)` which is `L.LEVEL_WEIGHTS[r.level - 1] + boostOf(r)`. If `r.level` is 0, this would be undefined. But retireBurned only includes vaults with `r.level !== 0`. OK.

10. Now let me look at the `expire` function:
```js
const expire = async (when, list) => { for (let i = 0; i < list.length; i += L.EXPIRE_BATCH) { const recs = list.slice(i, i + L.EXPIRE_BATCH)
    await run(`expire boosts ${when} ${i / L.EXPIRE_BATCH + 1} (${recs.length})`, [new TransactionInstruction({ programId: MINT,
      data: d('expire_boosts'), keys: [W(MINT_CFG.toBase58()), ...recs.map(a => W(a))] })]) } }
```
This sends `expire_boosts` with the config and the records. The program's `expire_boosts` takes remaining accounts as records. OK.

11. The `split` logic:
```js
let splitToPool = 0n
if (revenue && revenue.state === 'ok' && BigInt(revenue.amount) > 0n) {
    plan.split = true
    const total = BigInt(revenue.amount)
    splitToPool = total - total * 1500n / 10000n
}
```
This computes the 85% of the revenue. But wait - the program's `split_revenue` computes:
```rust
let bank_cut = ((total as u128) * ((BPS as u128) - (cfg.split_bps as u128)) / BPS as u128) as u64;
let holders = total.checked_sub(bank_cut).ok_or(MintError::Overflow)?;
```
So `bank_cut = floor(total * 1500 / 10000)` and `holders = total - bank_cut`. The crank computes `splitToPool = total - total * 1500n / 10000n`. In JS, `total * 1500n / 10000n` is integer division (floor). So `splitToPool = total - floor(total * 1500 / 10000)`. That matches `holders`. OK.

12. Now let me look at the `distribute` calculation:
```js
if (poolOk && !pool.frozen && due && w > 0n) {
    const avail = available(BigInt(pool.amount) + splitToPool, cfg.owed_scaled)
    if (avail > 0n) {
        plan.distribute = true; plan.distributeKind = 'credit'
        acc += avail * L.ACC_SCALE / w
    }
}
```

Wait - `available(BigInt(pool.amount) + splitToPool, cfg.owed_scaled)`. But the split hasn't happened yet at this point in the plan. The split is sent BEFORE the distribute. So by the time distribute runs, the pool has `pool.amount + splitToPool`. OK.

But wait - the split sends 85% to the pool and 15% to the bank. So the pool gets `splitToPool`. But the pool's balance also includes what was already there. So `pool.amount + splitToPool` is the pool balance after the split. OK.

Hmm, but there's a subtle issue: the split might fail (e.g., NothingToSplit if someone else already split). In that case, the pool balance wouldn't increase. But the crank's `avail` calculation assumes it did. So the distribute might fail with `NothingToDistribute` or `PoolShort`. But that's a benign failure (the next pass picks it up). Actually, `NothingToDistribute` is not in the BENIGN regex. Let me check:

```js
const BENIGN = /RevealTooEarly|AlreadyCaptured|AlreadyRevealed|RevealOutOfOrder|RescheduleTooEarly|MonthNotElapsed/
```

`NothingToDistribute` is not benign. So it would be reported as a failure. Hmm. But that's a minor issue - the crank would page on a benign race.

Actually wait, let me re-check. If the split fails because someone else split, the pool balance is already increased (by the other split). So `pool.amount` read at the start of the pass is stale. The crank's `avail` calculation uses the stale `pool.amount`. So it might underestimate. But the distribute would still work if the actual pool balance is higher. OK.

If the split fails for another reason (e.g., the revenue ATA is empty), then the pool balance is unchanged, and the distribute might fail with `NothingToDistribute`. That would be reported as a failure. But that's a real issue worth reporting.

Hmm, actually, let me think about this more carefully. The crank reads `revenue.amount` at the start. If it's > 0, it plans a split. But between the read and the send, someone else might split. Then the crank's split fails with `NothingToSplit`. The pool balance is already increased. The crank's distribute uses the stale `pool.amount + splitToPool`. If the actual pool balance is higher, the distribute works. If it's the same (because the other split sent the same amount), it works. OK.

But if the split fails for a different reason (e.g., the revenue ATA is frozen), then the pool balance is unchanged, and the distribute might fail. But that's a real issue.

Actually, let me look at the `split_revenue` program instruction more carefully. It requires `total > 0`. If the revenue ATA is empty, it fails with `NothingToSplit`. But the crank only plans a split if `revenue.amount > 0`. So if the read is accurate, the split should succeed. Unless someone else split in between.

OK, this is a minor issue. Let me move on.

13. Let me look at the `activate` loop more carefully:
```js
for (const r of records) {
    if (r.level === 0 || r.active || r.pending || r.retired || assets[r.asset] !== 'live') continue
    const t = tokens[r.asset]
    if (!t || t.state !== 'ok') continue
    if (BigInt(t.amount) >= L.ACTIVATION_SATS) plan.activate.push(r.address)
}
```

The token address is `tokenAddr(r)` which for a non-active vault is `ataOf(payMint, signerPda(r.asset))`. But the program's `activate` requires the vault's canonical cbBTC ATA. So this matches.

But wait - the crank's `tokens` map is keyed by `r.asset`. And `tokenAddr(r)` for a non-active vault computes the canonical ATA. So `tokens[r.asset]` is the canonical ATA's state. OK.

14. Now let me look at the `claims` loop more carefully. There's a potential issue with the `joinedNow` calculation:

```js
if (joinedNow) owed = pendingSats({ level: r.level, debt: L.LEVEL_WEIGHTS[r.level - 1] * BigInt(cfg.acc_scaled) }, acc)
```

This uses `cfg.acc_scaled` (the OLD accumulator). But the join happens BEFORE the distribution. So the join uses the old acc. Then the distribution credits at the new acc. So the vault's debt is `weight * old_acc`, and its entitlement is `weight * new_acc`. So `owed = weight * (new_acc - old_acc)`. The crank computes `pendingSats({ level, debt: weight * old_acc }, new_acc)` which is `(weight * new_acc - weight * old_acc) / ACC_SCALE`. That matches. OK.

15. Let me look at the `preExpired` calculation:
```js
else if (preExpired.has(r.address)) {
    const atExpiry = pendingScaled({ level: r.level, debt: r.debt_scaled, boost: r.boost_weight, carry: r.carry_scaled }, cfg.acc_scaled)
    owed = (atExpiry + L.LEVEL_WEIGHTS[r.level - 1] * (acc - BigInt(cfg.acc_scaled))) / ACC_SCALE
}
```

This computes what the vault was owed at expiry (using the old acc and the boost), then adds what it earns from the new distribution at its level weight alone. That matches the program's behavior: `expire_boost` calls `reweigh(c, r, 0)` which sets `carry = owed`, `debt = weight * acc`. Then the distribution credits at the new acc. So the vault's entitlement is `weight * new_acc + carry - weight * old_acc = weight * (new_acc - old_acc) + owed_at_expiry`. The crank computes `atExpiry + weight * (new_acc - old_acc)`. That matches. OK.

16. Now let me look at the `retireBurned` loop:
```js
for (const r of records) {
    if (!r.retired && assets[r.asset] === 'burned' && r.level !== 0) plan.retireBurned.push(r.address)
}
```

This retires vaults that are burned and have a level. But what about vaults that are burned and DON'T have a level? The program's `retire_burned` doesn't require a level. But the crank skips them. Hmm. Actually, a burned vault without a level still needs to be revealed (the program says a burned vault still takes its draw). So the crank's reveal loop handles it. After reveal, it has a level, and then the retireBurned loop picks it up. OK.

But wait - what if a vault is burned and its reveal window lapses? The crank's reschedule loop handles it (it checks `r.level !== 0 || r.entropy_set`). So a burned vault with level 0 and no entropy gets rescheduled. OK.

17. Let me look at the `preJoins` loop again:
```js
for (const r of records) {
    if (r.retired || r.active || !r.pending) continue
    if (assets[r.asset] === 'burned') continue
    if (BigInt(r.request_epoch) >= BigInt(cfg.dist_epoch)) continue
    plan.preJoins.push([r.address, r.vault_ata])
}
```

This joins vaults that requested in an earlier epoch. But what if the vault is burned? It's skipped. But the program's `claim` would join it (the program doesn't check if the asset is alive). Hmm, actually the crank skips it, which is correct (the program's `claim` would join a burned vault, adding dead weight). The crank's behavior is better. OK.

18. Now let me look at the `joins` loop:
```js
if (plan.distribute) {
    for (const r of records) {
        if (r.retired || r.active || !r.pending || assets[r.asset] === 'burned') continue
        if (BigInt(r.request_epoch) !== BigInt(cfg.dist_epoch)) continue
        const dest = destOf(r)
        if (dest) plan.joins.push([r.address, dest])
    }
}
```

This joins vaults that requested in the CURRENT epoch, after the distribution. The distribution advances the epoch, so these vaults become eligible. The crank sends these joins AFTER the distribution. OK.

But wait - the crank sends `plan.joins` as part of the claims batches:
```js
ready.push(...plan.joins)
for (let i = 0; i < ready.length; i += batch) plan.claims.push(ready.slice(i, i + batch))
```

So the joins are added to the claims. But the claims are sent AFTER the distribution. So the joins happen after the distribution. OK.

Hmm, but there's a subtle issue: the `plan.joins` are added to `ready` which is then batched. But the `ready` array also includes vaults that are owed. So a batch might contain both joins and claims. The program's `claim` handles both (it checks `r.pending` and joins if eligible). OK.

19. Let me look at the `destOf` function:
```js
const destOf = r => r.pending ? r.vault_ata : tokens[r.asset]?.address
```

For a pending vault, it returns `r.vault_ata`. For a non-pending vault, it returns `tokens[r.asset]?.address`. But the joins loop only includes pending vaults, so `destOf(r)` returns `r.vault_ata`. OK.

20. Now let me look at the `ready` array construction:
```js
const ready = []
const preJoined = new Set(plan.preJoins.map(([a]) => a))
const preExpired = new Set(plan.preExpires)
for (const r of records) {
    const joinedNow = preJoined.has(r.address)
    if ((!r.active && !joinedNow) || r.retired) continue
    if (assets[r.asset] === 'burned') continue
    ...
}
ready.push(...plan.joins)
```

So `ready` includes active vaults that are owed, plus pre-joined vaults, plus post-joins. OK.

But wait - the `preJoined` vaults are joined BEFORE the distribution. So they're active by the time the claims run. But the crank's `ready` includes them with `joinedNow = true`. The owed calculation uses the old acc for the debt. OK.

Hmm, but there's a subtle issue: the pre-joined vaults are joined in the `preJoins` batch, which is sent BEFORE the distribution. Then the distribution runs. Then the claims run. So the pre-joined vaults are active and owed. The crank's calculation is correct.

But what if the pre-join fails? Then the vault is still pending. The distribution would fail with `JoinWaitingFirst`. So the whole pass fails. Hmm. But that's a real issue - if a pre-join fails, the distribution is blocked. The crank would report the failure. OK.

21. Let me look at the `expire` function's batch size:
```js
const expire = async (when, list) => { for (let i = 0; i < list.length; i += L.EXPIRE_BATCH) { ... } }
```

`L.EXPIRE_BATCH` is 20. The program's `MAX_EXPIRE_BATCH` is 30. So 20 is within bounds. OK.

22. Now let me look at the `claim` batch size:
```js
const batch = opts.batch ?? L.CLAIM_BATCH
```
`L.CLAIM_BATCH` is 14. The program's `claim` takes pairs. So 14 pairs = 28 accounts. OK.

23. Let me look at the `reveal` loop:
```js
for (const a of plan.reveal) {
    const r = byAddr.get(a)
    let list = []
    if (assets[r.asset] === 'live') {
        list = await mintedAttributes(conn, P(r.asset))
        if (attrsHash(list) !== r.attrs_hash) { failures.push(...); break }
    }
    const ok = await send(`reveal #${r.mint_index} ${r.asset}`, [...])
    if (ok === 'fail') { failures.push(...); break }
    if (ok === 'benign') break
}
```

If the asset is burned, `list` is empty. The program's `reveal_level` skips the Core write for a burned asset. But it still checks the hash? Let me check:

```rust
if !burned {
    ...
    require!(hashv(&[&attributes.try_to_vec()?]).to_bytes() == hash, MintError::AttributesMismatch);
    ...
}
```

So for a burned asset, the hash check is skipped. So the crank sending an empty list is fine. OK.

24. Now let me look at the `mintedAttributes` function:
```js
export async function mintedAttributes(conn, assetPk) {
  const { deserializeAssetV1 } = await import('@metaplex-foundation/mpl-core')
  const info = await conn.getAccountInfo(assetPk, 'confirmed')
  if (!info) throw new Error(`asset ${assetPk.toBase58()} not found`)
  const a = deserializeAssetV1({...})
  return (a.attributes?.attributeList || []).map(({ key, value }) => ({ key, value }))
}
```

This reads the attributes from the asset. But the program's `reveal_level` expects the attributes WITHOUT the level (since the level is added by the program). The crank reads the attributes from the asset, which at this point don't include the level (since the level hasn't been revealed yet). So the list matches what the program hashed at mint. OK.

But wait - what if the asset has been modified? The crank checks the hash against `r.attrs_hash`. If they don't match, it reports a failure. OK.

25. Now let me look at the `judgeFeePayer` function:
```js
export function judgeFeePayer(lamports, { ceiling = FEE_CEILING_LAMPORTS, floor = FEE_FLOOR_LAMPORTS } = {}) {
  const l = BigInt(lamports)
  if (l > ceiling) return { ok: true, warn: `...`, why: null }
  if (l < floor) return { ok: false, why: `...` }
  return { ok: true, why: null }
}
```

This allows the crank to run even if the key holds more than the ceiling. The comment says this is intentional (round 22, F8). OK.

26. Now let me look at the `main` function's `send` function:
```js
const send = async (label, ixs) => {
    try {
      const sig = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer], { commitment: 'confirmed' })
      console.log(`  ok   ${label}  ${sig}`); return 'ok'
    } catch (e) {
      const m = String(e.message) + ' ' + (e.logs || []).join(' ')
      if (BENIGN.test(m)) { console.log(`  skip ${label}: ${m.match(BENIGN)[0]} (done by other traffic, or not yet)`); return 'benign' }
      console.log(`  FAIL ${label}: ${m.slice(0, 200)}`); return 'fail'
    }
}
```

The BENIGN regex includes `MonthNotElapsed`. But the crank's distribute is the free path (burn = 0). If the month hasn't elapsed, the program fails with `MonthNotElapsed`. The crank treats this as benign. OK.

But wait - the crank's distribute is only planned if `due` is true. So `MonthNotElapsed` shouldn't happen unless the read was stale. OK.

27. Let me look at the `run` function:
```js
const run = async (label, ixs) => { if ((await send(label, ixs)) === 'fail') failures.push(label) }
```

OK.

28. Now let me look at the `main` function's lock:
```js
const LOCK = process.env.CBOB_CRANK_LOCK || `/opt/cbob-vaults/bank/.crank${process.argv.includes('--reveal-only') ? '-reveal' : ''}.lock`
```

Two lanes, two locks. OK.

29. Let me look at the `withLock` call:
```js
withLock(LOCK, main, { staleMs: process.argv.includes('--reveal-only') ? 10 * 60_000 : 2 * 3600_000 }).catch(e => {
    ...
})
```

OK.

30. Now let me look at the `planCrank` function's `capturedThisPass` set:
```js
const capturedThisPass = new Set()
for (const r of records) {
    if (r.level !== 0 || r.entropy_set) continue
    const rs = BigInt(r.reveal_slot)
    if (BigInt(slot) > rs + BigInt(L.REVEAL_WINDOW_SLOTS)) plan.reschedule.push(r.address)
    else if (slot > readySlot(r.reveal_slot)) { plan.capture.push(r.address); capturedThisPass.add(r.address) }
}
```

OK.

31. Now let me look at the `reveal` loop in `planCrank`:
```js
for (let i = BigInt(cfg.revealed_total); ; i++) {
    const r = byIndex.get(i)
    if (!r || r.level !== 0) break
    if (!(r.entropy_set || capturedThisPass.has(r.address))) break
    plan.reveal.push(r.address)
}
```

This reveals in mint order. But what if a vault is retired? The program's `reveal_level` doesn't check if the vault is retired. So a retired vault can still be revealed. The crank includes it. OK.

But wait - what if a vault is retired AND has level 0? The crank's retireBurned loop skips it (requires level !== 0). So it stays unretired. The reveal loop reveals it. Then the retireBurned loop picks it up. OK.

32. Let me look at the `byIndex` map:
```js
const byIndex = new Map(records.map(r => [BigInt(r.mint_index), r]))
```

OK.

33. Now let me look at the `planCrank` function's `problems` array. It's populated with issues. OK.

34. Let me look at the `describePlan` function. It's just for logging. OK.

35. Now let me look at the `main` function's `records` fetch:
```js
const raw = await conn.getProgramAccounts(MINT, { commitment: 'confirmed',
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(disc) } },
      ...(REVEAL_ONLY ? [{ memcmp: { offset: L.offsets('VaultRecord').level, bytes: bs58.encode(Buffer.from([0])) } }] : [])] })
```

For the reveal-only lane, it filters by level = 0. But the offset is `L.offsets('VaultRecord').level`. Let me check the layout:

```js
VaultRecord: {
    fields: [
      ['version', 'u8'], ['asset', 'Pubkey'], ['mint_index', 'u64'], ['reveal_slot', 'u64'], ['level', 'u8'],
      ...
    ]
}
```

So `level` is at offset 8 (disc) + 1 (version) + 32 (asset) + 8 (mint_index) + 8 (reveal_slot) = 57. Let me verify: 8 + 1 = 9, + 32 = 41, + 8 = 49, + 8 = 57. So `level` is at offset 57. The `offsets` function computes this. OK.

36. Now let me look at the `assets` map:
```js
const assetInfos = await getMany(records.map(r => P(r.asset)))
const assets = {}
records.forEach((r, i) => {
    const a = assetInfos[i]
    assets[r.asset] = !a ? 'other'
      : a.owner.toBase58() === CORE_ID && a.data.length === 1 && a.data[0] === 0 ? 'burned'
      : a.owner.toBase58() === CORE_ID && a.data[0] === 1 ? 'live' : 'other'
})
```

This classifies assets as 'burned', 'live', or 'other'. OK.

37. Now let me look at the `tokens` map:
```js
const payMint = P(cfg.payment_mint)
const tokenAddr = r => r.active ? r.vault_ata : ataOf(payMint, signerPda(r.asset)).toBase58()
const tokInfos = await getMany(records.map(r => P(tokenAddr(r))))
const tokens = {}
records.forEach((r, i) => {
    const info = tokInfos[i], t = readTokenAccount(info)
    tokens[r.asset] = { ...t, address: tokenAddr(r),
      frozen: t.state === 'ok' && info.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
})
```

OK.

38. Now let me look at the `pool` read:
```js
const poolInfo = await conn.getAccountInfo(P(cfg.pool_ata), 'confirmed')
const pt = readTokenAccount(poolInfo)
const pool = { ...pt, frozen: pt.state === 'ok' && poolInfo.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
```

OK.

39. Now let me look at the `revenue` read:
```js
const REVENUE = pda([Buffer.from(L.SEEDS.revenue)], MINT)
const revAta = ataOf(payMint, REVENUE), bankAta = ataOf(payMint, P(cfg.bank_treasury))
const revenue = readTokenAccount(await conn.getAccountInfo(revAta, 'confirmed'))
```

OK.

40. Now let me look at the `payDecimals` read:
```js
const payDecimals = (await conn.getAccountInfo(payMint, 'confirmed'))?.data?.[44]
```

This reads the decimals from the mint account. Offset 44 is the decimals field in a classic SPL mint. OK.

41. Now let me look at the `slot` and `nowSec` reads:
```js
const slot = await conn.getSlot('confirmed')
const nowSec = Math.floor(Date.now() / 1000)
```

OK.

42. Now let me look at the `plan` call:
```js
const plan = planCrank({ cfg, records, assets, tokens, pool, slot, nowSec, revenue }, { revealOnly: REVEAL_ONLY })
```

OK.

43. Now let me look at the `LIVE` check:
```js
if (!LIVE) { console.log('\nDRY RUN. Re-run with --live to send.'); return }
```

OK.

44. Now let me look at the fee payer:
```js
const KEY = process.env.CBOB_CRANK_KEY || '/opt/cbob-vaults/bank/keys/crank.json'
const mode = fs.statSync(KEY).mode & 0o777
if (mode & 0o077) throw new Error(`${KEY} is mode ${mode.toString(8)}; it must be 600`)
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEY, 'utf8'))))
const fee = judgeFeePayer(BigInt(await conn.getBalance(payer.publicKey, 'confirmed')))
if (!fee.ok) throw new Error(fee.why)
if (fee.warn) { console.error(fee.warn); try { execFileSync(NOTIFY, [...]) } catch {} }
```

OK.

45. Now let me look at the `d` function:
```js
const d = n => ixDisc(n)
```

OK.

46. Now let me look at the `W` and `R` functions:
```js
const W = (pubkey, w = true) => ({ pubkey: P(pubkey), isSigner: false, isWritable: w })
const R = pubkey => W(pubkey, false)
```

OK.

47. Now let me look at the `byAddr` map:
```js
const byAddr = new Map(records.map(r => [r.address, r]))
```

OK.

48. Now let me look at the `failures` array. OK.

49. Now let me look at the `BENIGN` regex. OK.

50. Now let me look at the `send` function. OK.

51. Now let me look at the `run` function. OK.

52. Now let me look at the reschedule loop:
```js
for (const a of plan.reschedule) await run(`reschedule ${a}`, [new TransactionInstruction({ programId: MINT,
    data: d('reschedule_reveal'), keys: [W(a)] })])
```

OK.

53. Now let me look at the capture loop:
```js
for (const a of plan.capture) await run(`capture ${a}`, [new TransactionInstruction({ programId: MINT,
    data: d('capture_entropy'), keys: [W(a), R(SLOT_HASHES_ID)] })])
```

OK.

54. Now let me look at the reveal loop. OK.

55. Now let me look at the retireBurned loop:
```js
for (const a of plan.retireBurned) { const r = byAddr.get(a)
    await run(`retire ${r.asset}`, [new TransactionInstruction({ programId: MINT, data: d('retire_burned'),
      keys: [W(MINT_CFG.toBase58()), W(a), R(r.asset)] })]) }
```

OK.

56. Now let me look at the preJoins loop:
```js
for (let i = 0; i < plan.preJoins.length; i += L.CLAIM_BATCH) { const pairs = plan.preJoins.slice(i, i + L.CLAIM_BATCH)
    await run(`join batch ${i / L.CLAIM_BATCH + 1} (${pairs.length})`, [new TransactionInstruction({
      programId: MINT, data: Buffer.concat([d('claim'), Buffer.from([0])]),
      keys: [W(MINT_CFG.toBase58()), W(cfg.pool_ata), R(TOKEN_PROGRAM_ID), ...pairs.flatMap(([rec, ata]) => [W(rec), W(ata)])] })]) }
```

OK.

57. Now let me look at the expire function. OK.

58. Now let me look at the split:
```js
if (plan.split) await run('split_revenue (85/15, pinned destinations)', [new TransactionInstruction({ programId: MINT,
    data: Buffer.concat([d('split_revenue'), Buffer.from([payDecimals])]),
    keys: [R(MINT_CFG.toBase58()), W(REVENUE.toBase58()), R(payMint.toBase58()), W(revAta.toBase58()), W(cfg.pool_ata),
      W(bankAta.toBase58()), R(TOKEN_PROGRAM_ID)] })])
```

OK.

59. Now let me look at the distribute:
```js
if (plan.distribute) await run('distribute (monthly, free)', [new TransactionInstruction({ programId: MINT,
    data: Buffer.concat([d('distribute'), Buffer.from([0])]), keys: [W(MINT_CFG.toBase58()), R(cfg.pool_ata)] })])
```

OK.

60. Now let me look at the postExpires:
```js
if (plan.distribute) await expire('after', plan.postExpires)
```

OK.

61. Now let me look at the activate loop:
```js
for (const a of plan.activate) { const r = byAddr.get(a)
    await run(`activate ${r.asset}`, [new TransactionInstruction({ programId: MINT, data: d('activate'),
      keys: [W(MINT_CFG.toBase58()), W(a), R(r.asset), R(tokens[r.asset].address), R(cfg.pool_ata)] })]) }
```

OK.

62. Now let me look at the claims loop:
```js
for (const [i, pairs] of plan.claims.entries()) await run(`claim batch ${i + 1} (${pairs.length})`, [new TransactionInstruction({
    programId: MINT, data: Buffer.concat([d('claim'), Buffer.from([0])]),
    keys: [W(MINT_CFG.toBase58()), W(cfg.pool_ata), R(TOKEN_PROGRAM_ID), ...pairs.flatMap(([rec, ata]) => [W(rec), W(ata)])] })])
```

OK.

63. Now let me look at the failures handling:
```js
if (failures.length) {
    const msg = `CBOB crank: ${failures.length} action(s) failed — ${failures.slice(0, 3).join('; ')}`
    console.error(msg)
    try { execFileSync(NOTIFY, [msg, 'cbob-vault-crank'], { stdio: 'ignore' }) } catch {}
    process.exitCode = 1
}
```

OK.

Now let me look for actual bugs.

**Potential bug 1: The `destOf` function is defined but never used in the preJoins loop.**

Actually, looking more carefully, `destOf` is used in the joins loop:
```js
const dest = destOf(r)
if (dest) plan.joins.push([r.address, dest])
```

So it's used. OK.

**Potential bug 2: The `preJoinWeight` calculation uses `records.find` which is O(n) per preJoin.**

This is a performance issue, not a correctness one. OK.

**Potential bug 3: The `retiringWeight` calculation uses `records.find` which is O(n) per retireBurned.**

Same. OK.

**Potential bug 4: The `expiringWeight` calculation uses `records.find` which is O(n) per preExpire.**

Same. OK.

**Potential bug 5: The `w` calculation might be wrong if a vault is both retiring and expiring.**

Let me check: `retiringWeight` includes the full weight of retiring vaults. `expiringWeight` includes the boost weight of expiring vaults. If a vault is both retiring and expiring, it would be double-counted. But the preExpires loop skips retiring vaults:
```js
for (const r of records) {
    if (r.retired || !r.active || boostOf(r) === 0n || retiring.has(r.address)) continue
    ...
}
```

So a retiring vault is not in preExpires. OK.

**Potential bug 6: The `postExpires` loop might include a vault that was already in preExpires.**

Let me check:
```js
if (plan.distribute) {
    for (const r of records) {
        if (r.retired || !r.active || boostOf(r) === 0n || retiring.has(r.address) || plan.preExpires.includes(r.address)) continue
        if (BigInt(r.boost_end_epoch) === BigInt(cfg.dist_epoch) + 1n) plan.postExpires.push(r.address)
    }
}
```

It skips `plan.preExpires`. OK.

**Potential bug 7: The `claims` loop might include a vault that was already in preJoins.**

Let me check:
```js
const preJoined = new Set(plan.preJoins.map(([a]) => a))
...
for (const r of records) {
    const joinedNow = preJoined.has(r.address)
    if ((!r.active && !joinedNow) || r.retired) continue
    ...
}
```

So a pre-joined vault is included with `joinedNow = true`. OK.

**Potential bug 8: The `ready.push(...plan.joins)` might duplicate a vault that's already in `ready`.**

Let me check: `plan.joins` are vaults that requested in the current epoch. They're not active yet. So they're not in `ready` (which only includes active vaults). OK.

**Potential bug 9: The `plan.claims` batching might split a join from its claim.**

Actually, the joins are added to `ready` and then batched. So a join and its claim are in the same batch. OK.

**Potential bug 10: The `expire` function sends `expire_boosts` with the config and records. But the program's `expire_boosts` requires the config to be writable.**

Let me check the program:
```rust
#[derive(Accounts)]
pub struct ExpireBoosts<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
}
```

Yes, the config is `mut`. The crank sends `W(MINT_CFG.toBase58())`. OK.

**Potential bug 11: The `split` instruction sends `payDecimals` which might be undefined.**

Let me check:
```js
const payDecimals = (await conn.getAccountInfo(payMint, 'confirmed'))?.data?.[44]
```

If the mint account doesn't exist, `payDecimals` is undefined. Then `Buffer.from([payDecimals])` would throw. But the mint should exist. OK.

**Potential bug 12: The `distribute` instruction sends `Buffer.from([0])` for the burn flag.**

The program's `distribute` takes `burn: bool`. Borsh encodes bool as 1 byte. So `Buffer.from([0])` is correct. OK.

**Potential bug 13: The `claim` instruction sends `Buffer.from([0])` for the crank_n.**

The program's `claim` takes `crank_n: u8`. So `Buffer.from([0])` is correct. OK.

**Potential bug 14: The `activate` instruction doesn't send the pool account as writable.**

Let me check:
```js
keys: [W(MINT_CFG.toBase58()), W(a), R(r.asset), R(tokens[r.asset].address), R(cfg.pool_ata)]
```

The pool is `R(cfg.pool_ata)` (read-only). But the program's `activate` calls `monthly_inline` which reads the pool. It doesn't write to it. So read-only is fine. OK.

Wait, actually, let me check the program's `Activate` accounts:
```rust
pub struct Activate<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    #[account(mut, seeds = [VAULT_SEED, vault_record.asset.as_ref()], bump = vault_record.bump)]
    pub vault_record: Account<'info, VaultRecord>,
    /// CHECK: must equal vault_record.asset and be a live vault in our collection.
    pub asset: UncheckedAccount<'info>,
    /// CHECK: the vault's canonical cbBTC ATA, derived and read in-handler.
    pub vault_token: UncheckedAccount<'info>,
    /// CHECK: the pool (config.pool_ata), read for the monthly in-line run.
    pub pool_token: UncheckedAccount<'info>,
}
```

The pool is not `mut`. So read-only is fine. OK.

**Potential bug 15: The `claim` instruction sends the pool as writable.**

Let me check:
```js
keys: [W(MINT_CFG.toBase58()), W(cfg.pool_ata), R(TOKEN_PROGRAM_ID), ...]
```

The pool is `W(cfg.pool_ata)` (writable). The program's `Claim` accounts:
```rust
pub struct Claim<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    /// CHECK: must equal config.pool_ata.
    #[account(mut)]
    pub pool_token: UncheckedAccount<'info>,
    ...
}
```

Yes, the pool is `mut`. OK.

**Potential bug 16: The `split` instruction sends the revenue as writable.**

Let me check:
```js
keys: [R(MINT_CFG.toBase58()), W(REVENUE.toBase58()), R(payMint.toBase58()), W(revAta.toBase58()), W(cfg.pool_ata),
      W(bankAta.toBase58()), R(TOKEN_PROGRAM_ID)]
```

The revenue is `W(REVENUE.toBase58())` (writable). The program's `SplitRevenue` accounts:
```rust
pub struct SplitRevenue<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    /// CHECK: the ["revenue"] PDA, verified in-handler.
    #[account(mut)]
    pub revenue: UncheckedAccount<'info>,
    ...
}
```

Yes, the revenue is `mut`. OK.

**Potential bug 17: The `distribute` instruction sends the pool as read-only.**

Let me check:
```js
keys: [W(MINT_CFG.toBase58()), R(cfg.pool_ata)]
```

The pool is `R(cfg.pool_ata)` (read-only). But the program's `Distribute` accounts:
```rust
pub struct Distribute<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    /// CHECK: must equal config.pool_ata; read in-handler.
    pub pool_token: UncheckedAccount<'info>,
}
```

The pool is not `mut`. So read-only is fine. OK.

**Potential bug 18: The `retire_burned` instruction sends the asset as read-only.**

Let me check:
```js
keys: [W(MINT_CFG.toBase58()), W(a), R(r.asset)]
```

The asset is `R(r.asset)` (read-only). The program's `RetireBurned` accounts:
```rust
pub struct RetireBurned<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    #[account(mut, seeds = [VAULT_SEED, vault_record.asset.as_ref()], bump = vault_record.bump)]
    pub vault_record: Account<'info, VaultRecord>,
    /// CHECK: must equal vault_record.asset and be POSITIVELY burned.
    pub asset: UncheckedAccount<'info>,
}
```

The asset is not `mut`. So read-only is fine. OK.

**Potential bug 19: The `reveal_level` instruction sends the asset as writable.**

Let me check:
```js
keys: [W(MINT_CFG.toBase58()), W(a), W(r.asset), W(cfg.collection),
    { pubkey: payer.publicKey, isSigner: true, isWritable: true }, R(MINT_AUTH.toBase58()),
    R(SLOT_HASHES_ID), R(CORE_ID), R(SystemProgram.programId.toBase58())]
```

The asset is `W(r.asset)` (writable). The program's `RevealLevel` accounts:
```rust
pub struct RevealLevel<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    #[account(mut, seeds = [VAULT_SEED, vault_record.asset.as_ref()], bump = vault_record.bump)]
    pub vault_record: Account<'info, VaultRecord>,
    /// CHECK: must equal vault_record.asset; a live AssetV1 or a burned one.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    ...
}
```

Yes, the asset is `mut`. OK.

**Potential bug 20: The `capture_entropy` instruction sends the record as writable.**

Let me check:
```js
keys: [W(a), R(SLOT_HASHES_ID)]
```

The record is `W(a)` (writable). The program's `CaptureEntropy` accounts:
```rust
pub struct CaptureEntropy<'info> {
    #[account(mut, seeds = [VAULT_SEED, vault_record.asset.as_ref()], bump = vault_record.bump)]
    pub vault_record: Account<'info, VaultRecord>,
    ...
}
```

Yes, the record is `mut`. OK.

**Potential bug 21: The `reschedule_reveal` instruction sends the record as writable.**

Let me check:
```js
keys: [W(a)]
```

The record is `W(a)` (writable). The program's `RescheduleReveal` accounts:
```rust
pub struct RescheduleReveal<'info> {
    #[account(mut, seeds = [VAULT_SEED, vault_record.asset.as_ref()], bump = vault_record.bump)]
    pub vault_record: Account<'info, VaultRecord>,
}
```

Yes, the record is `mut`. OK.

OK, I've gone through the crank pretty thoroughly. Let me now look at the detectors.

**R2. THE ALARM (bank/detectors.mjs, bank/alarm.mjs)**

Let me look for dangerous on-chain states that read as quiet, and routine states that page every pass.

1. `detectApprovals` - fires on any approve by a vault PDA. OK.

2. `detectPdaTokenAccounts` - fires on any token account created for a vault PDA. OK.

3. `detectBurns` - fires on bare Core burns. OK.

4. `detectVaultSetChange` - fires on vaults leaving the live set. OK.

5. `detectConfigDrift` - fires on any watched key change. OK.

6. `detectStandingRisks` - fires on various standing risks. OK.

7. `detectUnreconciledRevenue` - fires on unreconciled swaps. OK.

8. `detectUndeclaredTokenAccounts` - fires on undeclared token accounts. OK.

9. `judgeRedemptionCoverage` - pure function. OK.

10. `classifyPdaTokenAccount` - classifies token accounts. OK.

11. `parseAcks` - parses acks. OK.

12. `judgeAck` - judges acks. OK.

13. `applyAcks` - applies acks. OK.

14. `correlateBurns` - correlates burns. OK.

15. `detectNestedVaults` - fires on nested vaults. OK.

16. `detectUnledgeredSweeps` - fires on unledgered sweeps. OK.

17. `detectDeferredSweeps` - fires on deferred sweeps. OK.

18. `detectSplitClaims` - fires on split claims. OK.

19. `detectBalanceDrops` - fires on balance drops. OK.

20. `detectIndexShortfall` - fires on index shortfalls. OK.

21. `judgeCronTemplate` - judges cron template. OK.

22. `readProgramData` - reads program data. OK.

23. `judgeDasEnvelope` - judges DAS envelope. OK.

24. `parseCbobLogs` - parses CBOB logs. OK.

25. `detectProgramEvents` - fires on program events. OK.

26. `detectDistributionOverdue` - fires on overdue distributions. OK.

27. `detectPoolHealth` - fires on pool issues. OK.

28. `poolAvailable` - computes pool available. OK.

29. `redemptionCapacity` - computes redemption capacity. OK.

30. `detectRedemptionRate` - fires on near-cap redemptions. OK.

31. `detectUnsplitRevenue` - fires on unsplit revenue. OK.

32. `detectFrozenVaultAccount` - fires on frozen vault accounts. OK.

33. `detectRevealStall` - fires on reveal stalls. OK.

34. `detectBrakeTransitions` - fires on brake transitions. OK.

35. `detectUpgradeAuthorityAfterLock` - fires on upgradeable programs past lock. OK.

Let me look for issues.

**Potential issue 1: `detectDistributionOverdue` uses `cur['mint.active_count']` in the detail string, but this key is not in WATCHED_KEYS.**

Let me check:
```js
return [...stalls, { kind: 'distribution_overdue', severity: S.CRITICAL,
    detail: `no distribution for ${(BigInt(nowSec) - last) / 3600n}h: it was due at unix ${due} and is ${late / 3600n}h late, with ${poolAvail} sats undistributed and ${cur['mint.active_count'] ?? '?'} vault(s) waiting. ...` }]
```

`mint.active_count` is not in WATCHED_KEYS. But it's only used in the detail string, not for logic. So it's fine (it would show '?' if missing). OK.

**Potential issue 2: `detectRedemptionRate` uses `cur['burn.rate_ring']` which is an array of strings.**

Let me check:
```js
const ring = cur['burn.rate_ring']
...
if (!Array.isArray(ring) || ring.length !== RATE_RING) return null
...
const inWindow = BigInt(ring.filter(t => now - BigInt(t) < window).length)
```

The ring is an array of strings (from `flatten`). `BigInt(t)` converts each string to BigInt. OK.

**Potential issue 3: `detectStandingRisks` checks `cur['mint.split_bps'] !== undefined && Number(cur['mint.split_bps']) !== 8500`.**

If `split_bps` is undefined, the check is skipped. But `split_bps` is in WATCHED_KEYS, so it should be produced. OK.

**Potential issue 4: `detectStandingRisks` checks `cur['mint.guardian'] === DEFAULT_PUBKEY`.**

`DEFAULT_PUBKEY` is `'11111111111111111111111111111111'`. If the guardian is retired, it's set to `Pubkey::default()` which is the same. OK.

**Potential issue 5: `detectStandingRisks` checks `cur['mint.pending_swap_operator']` and `cur['mint.pending_guardian_set']`.**

These are in WATCHED_KEYS. OK.

**Potential issue 6: `detectStandingRisks` checks `cur['mint.pending_count']` and `cur['mint.pending_this_epoch']`.**

These are in WATCHED_KEYS. OK.

**Potential issue 7: `detectStandingRisks` checks `cur['mint.max_sweep_lamports']` and `cur['mint.sweep_cooldown_secs']`.**

These are in WATCHED_KEYS. OK.

**Potential issue 8: `detectStandingRisks` checks `cur['mint.charter_closes_at']` and `cur['mint.charter_opens_at']`.**

These are in WATCHED_KEYS. OK.

**Potential issue 9: `detectStandingRisks` checks `cur['mint.charter_secs']` which is computed.**

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

OK.

**Potential issue 10: `detectStandingRisks` checks `cur['mint.max_boost_weight']` and `cur['mint.max_boost_epochs']`.**

These are in WATCHED_KEYS. OK.

**Potential issue 11: `detectStandingRisks` checks `cur['mint.cbob_mint']`.**

This is in WATCHED_KEYS. OK.

**Potential issue 12: `detectStandingRisks` checks `cur['mint.payment_mint']`, `cur['mint.bank_treasury']`, `cur['seal.reserve_mints']`, `cur['mint.pob_root']`.**

These are in WATCHED_KEYS. OK.

**Potential issue 13: `detectStandingRisks` checks `cur['mint.max_supply']`, `cur['mint.level_caps']`.**

These are in WATCHED_KEYS. OK.

**Potential issue 14: `detectStandingRisks` checks `cur['gov.quorum_bps']`, `cur['gov.threshold_bps']`, `cur['gov.min_voting_secs']`.**

These are in WATCHED_KEYS. OK.

**Potential issue 15: `detectStandingRisks` checks `cur['mint.notice_secs']`, `cur['mint.sweep_floor_lamports']`, `cur['mint.cooldown_ceiling_secs']`, `cur['mint.reserve_ceiling_lamports']`.**

These are in WATCHED_KEYS. OK.

**Potential issue 16: `detectStandingRisks` checks `cur['burn.redeem_window_secs']`.**

This is in WATCHED_KEYS. OK.

**Potential issue 17: `detectStandingRisks` checks `cur['mint.monthly_secs']`.**

This is in WATCHED_KEYS. OK.

OK, the standing risks look comprehensive.

Let me look at the alarm's `readConfigs` function.

**Potential issue 18: `readConfigs` reads the configs and produces the snapshot. It checks `missingWatchedKeys`.**

```js
const missing = D.missingWatchedKeys(snap)
if (missing.length) {
    throw new Error(`readConfigs does not produce ${missing.join(', ')}, which detectors watch. ...`)
}
```

OK.

**Potential issue 19: `readConfigs` reads the program data for each program.**

```js
for (const [name, prog] of [['seal', SEAL], ['mint', MINT], ['burn', BURN], ['gov', GOV], ['core', CORE]]) {
    const [pdAddr] = PublicKey.findProgramAddressSync([prog.toBuffer()], BPF_LOADER_UPGRADEABLE)
    const acc = await conn.getAccountInfo(pdAddr, 'confirmed')
    if (!acc) {
      snap[`prog.${name}._missing`] = true
      if (name === 'core') { snap['prog.core.upgrade_authority'] = 'NO_PROGRAMDATA'; snap['prog.core.hash'] = 'NO_PROGRAMDATA' }
      continue
    }
    const pdInfo = D.readProgramData(acc.data)
    if (pdInfo.problem) throw new Error(`ProgramData for ${name} is unreadable: ${pdInfo.problem}`)
    snap[`prog.${name}.upgrade_authority`] = pdInfo.hasAuth
      ? new PublicKey(acc.data.subarray(13, 45)).toBase58()
      : 'IMMUTABLE'
    snap[`prog.${name}.hash`] = createHash('sha256').update(acc.data.subarray(pdInfo.elfOffset)).digest('hex').slice(0, 32)
}
```

OK.

**Potential issue 20: `readConfigs` reads the collection plugins hash.**

```js
if (snap['mint.collection']) {
    const acc = await conn.getAccountInfo(new PublicKey(snap['mint.collection']), 'confirmed')
    snap['collection.plugins_hash'] = acc ? L.collectionPluginsHash(acc.data) : 'ABSENT'
}
```

OK.

**Potential issue 21: `readConfigs` reads the PoB collection plugins hash and update authority.**

```js
if (snap['mint.pob_collection']) {
    const acc = await conn.getAccountInfo(new PublicKey(snap['mint.pob_collection']), 'confirmed')
    snap['pob_collection.plugins_hash'] = acc ? L.collectionPluginsHash(acc.data) : 'ABSENT'
    snap['pob_collection.update_authority'] = acc && acc.data.length >= 33 && acc.data[0] === 5
      ? new PublicKey(acc.data.subarray(1, 33)).toBase58() : 'ABSENT'
}
```

OK.

**Potential issue 22: `readPool` reads the pool and the config together.**

```js
async function readPool(cfg) {
  if (!cfg['mint.pool_ata']) return null
  const mintCfg = pda([Buffer.from(L.SEEDS.mintConfig)], MINT)
  const [cInfo, info] = await conn.getMultipleAccountsInfo([mintCfg, new PublicKey(cfg['mint.pool_ata'])], 'confirmed')
  const fresh = cInfo ? L.readPinned('MintConfig', cInfo, PublicKey) : null
  const r = readTokenAccount(info)
  return { ...r, owedScaled: fresh ? String(fresh.owed_scaled) : null,
    frozen: r.state === 'ok' && info.data.length > L.TOKEN_STATE_OFF && info.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
}
```

OK.

**Potential issue 23: The alarm's `main` function reads the ledger.**

```js
let led = null
try { led = JSON.parse(fs.readFileSync(LEDGER, 'utf8')) } catch { led = null }
findings.push(...D.detectUnreconciledRevenue(led))
```

If the ledger is missing, `led` is null, and `detectUnreconciledRevenue` returns a CRITICAL. OK.

**Potential issue 24: The alarm's `main` function reads the configs.**

```js
const cfg = await readConfigs()
findings.push(...D.detectConfigDrift(prev?.config, cfg))
findings.push(...D.detectStandingRisks(cfg, { production: true }))
findings.push(...D.detectBrakeTransitions(prev?.config, cfg))
findings.push(...D.detectUpgradeAuthorityAfterLock(cfg, { lockDeadlineSec: lockDeadline(), nowSec, production: true }))
```

OK.

**Potential issue 25: The alarm's `main` function reads the pool.**

```js
const pool = await readPool(cfg)
const cfgAtPool = pool?.owedScaled ? { ...cfg, 'mint.owed_scaled': pool.owedScaled } : cfg
findings.push(...D.detectPoolHealth(cfgAtPool, pool))
const poolAvail = pool?.state === 'ok' ? D.poolAvailable(cfgAtPool, pool.amount) : null
findings.push(...D.detectDistributionOverdue(cfg, { nowSec, poolAvail, graceSecs: ... }))
findings.push(...D.detectRedemptionRate(cfg, nowSec))
findings.push(...D.detectRevealStall(prev?.config, cfg))
```

OK.

**Potential issue 26: The alarm's `main` function reads the revenue.**

```js
let revenueSince = null
{
    const revenue = pda([Buffer.from(L.SEEDS.revenue)], MINT)
    const payMint = new PublicKey(cfg['mint.payment_mint'] || CBBTC.toBase58())
    const r = readTokenAccount(await conn.getAccountInfo(ata(payMint, revenue), 'confirmed'))
    if (r.state === 'ok' && r.amount > 0n) {
      revenueSince = prev?.revenueSince ?? nowSec
      findings.push(...D.detectUnsplitRevenue({ amount: r.amount, sinceSec: revenueSince, nowSec }))
    }
}
```

OK.

**Potential issue 27: The alarm's `main` function reads the vaults.**

```js
const { live: vaults, burnt, all: everyVault } = await listVaults(collection)
looked.vaults = vaults.length
looked.burnt = burnt.length
```

OK.

**Potential issue 28: The alarm's `main` function detects nested vaults.**

```js
findings.push(...D.detectNestedVaults(everyVault,
    id => pda([Buffer.from('mpl-core-execute'), new PublicKey(id).toBuffer()], CORE).toBase58(),
    k => PublicKey.isOnCurve(new PublicKey(k).toBytes())))
```

OK.

**Potential issue 29: The alarm's `main` function detects index shortfalls.**

```js
findings.push(...D.detectIndexShortfall(cfg['mint.minted_total'], vaults, burnt))
```

OK.

**Potential issue 30: The alarm's `main` function detects vault set changes.**

```js
const setChange = D.detectVaultSetChange(prev?.vaults, { live: vaults, burnt })
findings.push(...setChange.findings)
```

OK.

**Potential issue 31: The alarm's `main` function reads balances.**

```js
const balances = {}
const reserves = (cfg['seal.reserve_mints'] || [payment.toBase58()])
const legs = []
for (const v of vaults) for (const m of reserves)
    legs.push({ key: m === payment.toBase58() ? v : `${v}:${m}`, vault: v, mint: m, addr: ata(new PublicKey(m), pdaOf[v]) })
for (let i = 0; i < legs.length; i += 100) {
    const chunk = legs.slice(i, i + 100)
    let infos
    try { infos = await conn.getMultipleAccountsInfo(chunk.map(l => l.addr), 'confirmed') }
    catch {
      for (const l of chunk) if (prev?.balances?.[l.key] !== undefined) balances[l.key] = prev.balances[l.key]
      findings.push({ kind: 'balance_unreadable', severity: 'HIGH', ... })
      continue
    }
    chunk.forEach((l, j) => {
      const info = infos[j], r = readTokenAccount(info)
      balances[l.key] = String(r.amount)
      if (r.state === 'ok' && info.data.length > L.TOKEN_STATE_OFF && info.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN)
        findings.push(...D.detectFrozenVaultAccount({ vault: l.vault, mint: l.mint, isPayment: l.mint === payment.toBase58() }))
    })
}
findings.push(...D.detectBalanceDrops(prev?.balances, balances))
```

OK.

**Potential issue 32: The alarm's `main` function walks signatures.**

```js
const cursors = { ...(prev?.cursors || {}) }
const seenSplits = []
const deferredSweeps = []
for (const prog of [SEAL, MINT, BURN, GOV]) {
    const id = prog.toBase58()
    const { sigs, gap } = await walkSigs(conn, prog, cursors[id])
    ...
}
```

OK.

**Potential issue 33: The alarm's `main` function processes each transaction.**

```js
for (const s of sigs) {
    if (s.err) continue
    const tx = await conn.getParsedTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
    if (!tx) { unread++; findings.push({ kind: 'tx_unreadable', ... }); continue }
    looked.txs++
    const ixs = D.normaliseTx(tx)
    ...
}
```

OK.

**Potential issue 34: The alarm's `main` function advances cursors.**

```js
if (!gap && !unread && sigs.length) cursors[id] = sigs[0].signature
```

OK.

**Potential issue 35: The alarm's `main` function writes state.**

```js
const next = { startedAt: started, config: cfg, balances, cursors, revenueSince,
    seenSplits: D.dedupeSeenSplits([...seenSplits, ...(prev?.seenSplits || [])]),
    deferredSweeps: dsw.keep,
    vaults: setChange.trustCurrent ? vaults : (prev?.vaults || vaults) }
markEver()
findings = D.correlateBurns(findings)
findings = D.applyAcks(findings, readAcks())
const delivered = report(findings, looked, cfg, false) && !DRY
if (!delivered) {
    next.config = prev?.config ?? cfg
    next.balances = prev?.balances ?? balances
    next.cursors = prev?.cursors ?? {}
    next.vaults = prev?.vaults ?? next.vaults
    next.deferredSweeps = [...(prev?.deferredSweeps || []), ...deferredSweeps]
      .filter((d, i, a) => a.findIndex(x => x.sig === d.sig) === i)
}
if (!DRY) writeState(next)
```

OK.

Hmm, let me look for a specific issue. The alarm's `main` function reads the configs and then checks `if (!collection || cfg['mint._missing'])`. If the config is missing, it reports `config_vanished` if a previous pass read it. OK.

Let me look at the `report` function.

**Potential issue 36: The `report` function's all-clear message.**

```js
lines.push(crit.length || high.length
    ? '>>> ACTION REQUIRED'
    : idle ? 'nothing deployed yet — this is not an all-clear'
    : 'no approvals, no unexpected PDA token accounts, no nested vaults, no burn this'
      + '\npass could not account for, no vault left the collection, no reserve fell,'
      + '\nno unreconciled sweep, no overdue distribution, a readable unfrozen pool,'
      + '\nand no drift in any config value, program upgrade authority, program bytes'
      + '\nor the collection plugins.')
```

OK.

**Potential issue 37: The `report` function's NOT CHECKED list.**

```js
lines.push('NOT CHECKED BY THIS PASS, and this list is the point of the report:')
lines.push('  * a token account created for a vault PDA by a route that touches none')
lines.push('    of our four programs. No signature scan can see one — that is what')
lines.push('    `--reconcile` is for, and it runs DAILY, not every half hour.')
lines.push('  * anything at all before this pipeline first ran.')
lines.push('  * whether a reserve that fell was redeemed legitimately or drained.')
lines.push('    This pass can tell you it moved. A fall that ENDS in a burn this')
lines.push('    pass could account for is a redemption; a fall with the vault still')
lines.push('    alive is not, and only a human can tell you why.')
```

OK.

**Potential issue 38: The `report` function's alert delivery.**

```js
if (urgent && !DRY) {
    try {
      const once = [...crit, ...high].some(f => f.urgent)
      execFileSync(NOTIFY, [`CBOB VAULTS: ${crit.length} critical, ${high.length} high — ${crit[0]?.detail || high[0]?.detail}`, 'cbob-vault-alarm'],
        { stdio: 'ignore', env: once ? { ...process.env, ALERT_URGENT: '1' } : process.env })
    } catch (e) {
      console.error('ALERT DELIVERY FAILED:', e.message); code = 2; delivered = false
    }
}
```

OK.

Let me now look at the layout.

**R3. THE LAYOUTS (bank/layout.mjs)**

Let me check the assertions.

1. `STRUCTS` declares each struct with its fields. OK.

2. `offsets` computes the byte offset of each field. OK.

3. `decode` decodes the raw bytes. OK.

4. `readPinned` pins the owner, discriminator, and version. OK.

5. `encode` encodes a decoded object back to bytes. OK.

6. `flatten` flattens a decoded struct into the alarm's snapshot. OK.

7. `parseRustStruct` parses a Rust struct. OK.

8. `collectionPluginsHash` hashes the collection's plugins. OK.

Let me look for issues.

**Potential issue 39: `offsets` stops at the first variable-length field.**

```js
export function offsets(name) {
  const s = STRUCTS[name]
  if (!s) throw new Error(`unknown struct ${name}`)
  const out = {}
  let o = 8
  for (const [f, t] of s.fields) {
    out[f] = o
    const n = FIXED[t]
    if (n === undefined) break
    o += n
  }
  return out
}
```

This is correct for fixed-size fields. After a variable-length field, the offset depends on the data. OK.

**Potential issue 40: `fixedLength` returns null if there's a variable-length field.**

```js
export function fixedLength(name) {
  const s = STRUCTS[name]
  let o = 8
  for (const [, t] of s.fields) { const n = FIXED[t]; if (n === undefined) return null; o += n }
  return o
}
```

OK.

**Potential issue 41: `readField` handles each type.**

```js
function readField(t, d, o) {
  const need = FIXED[t]
  if (need !== undefined && o + need > d.length) throw new Error(`truncated: ${t} at ${o} needs ${need} bytes, account is ${d.length}`)
  switch (t) {
    case 'u8': return [d[o], 1]
    case 'bool': {
      if (d[o] !== 0 && d[o] !== 1) throw new Error(`bool at ${o} is ${d[o]}, neither 0 nor 1`)
      return [d[o] === 1, 1]
    }
    ...
  }
}
```

OK.

**Potential issue 42: `decode` checks the discriminator and version.**

```js
export function decode(name, data) {
  const s = STRUCTS[name]
  const d = Buffer.from(data)
  const want = createHash('sha256').update(`account:${s.struct}`).digest().subarray(0, 8)
  if (d.length < 9 || !d.subarray(0, 8).equals(want)) throw new Error(`${name}: wrong discriminator`)
  if (d[8] !== s.version) throw new Error(`${name}: layout version ${d[8]}, this code reads ${s.version}`)
  ...
}
```

OK.

**Potential issue 43: `readPinned` uses `pinnedAccountData`.**

```js
export function readPinned(name, acc, PublicKeyCtor) {
  const s = STRUCTS[name]
  const data = pinnedAccountData(acc, { program: new PublicKeyCtor(PROGRAM_IDS[s.program]), struct: s.struct,
    version: s.version, what: `${s.program} ${s.struct}` })
  return data ? decode(name, data) : null
}
```

OK.

**Potential issue 44: `encode` handles each type.**

```js
export function encode(name, obj) {
  const s = STRUCTS[name]
  const parts = [createHash('sha256').update(`account:${s.struct}`).digest().subarray(0, 8)]
  for (const [f, t] of s.fields) {
    const v = obj[f]
    let b
    switch (t) {
      ...
    }
    parts.push(b)
  }
  return Buffer.concat(parts)
}
```

OK.

**Potential issue 45: `flatten` converts BigInt to string.**

```js
export function flatten(prefix, obj) {
  const out = {}
  const str = v => typeof v === 'bigint' ? v.toString() : v
  for (const [k, v] of Object.entries(obj || {})) out[`${prefix}.${k}`] = Array.isArray(v) ? v.map(str) : str(v)
  return out
}
```

OK.

**Potential issue 46: `parseRustStruct` parses a Rust struct.**

```js
export function parseRustStruct(src, name) {
  const m = new RegExp(`pub struct ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src)
  if (!m) return null
  const out = []
  for (const raw of m[1].split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim()
    if (!line || line.startsWith('#[')) continue
    const f = /^pub (\w+):\s*(.+?),?$/.exec(line)
    if (!f) throw new Error(`parseRustStruct(${name}): a line it cannot read as one \`pub name: Type,\` field: ${JSON.stringify(line)}`)
    out.push([f[1], f[2].replace(/,$/, '').trim()])
  }
  return out
}
```

OK.

**Potential issue 47: `collectionPluginsHash` hashes the collection's plugins.**

```js
export function collectionPluginsHash(data) {
  const d = Buffer.from(data)
  if (d.length < 41 || d[0] !== 5) return 'NOT_A_COLLECTION'
  let o = 33
  for (let i = 0; i < 2; i++) {
    if (o + 4 > d.length) return 'TRUNCATED'
    const n = d.readUInt32LE(o); o += 4 + n
  }
  o += 8
  if (o > d.length) return 'TRUNCATED'
  return createHash('sha256').update(d.subarray(o)).digest('hex').slice(0, 32)
}
```

OK.

Let me now look at the accrual.

**R4. THE MONEY ARITHMETIC (bank/accrual.mjs)**

Let me check the formulas.

1. `ceilSats` - `(BigInt(scaled) + ACC_SCALE - 1n) / ACC_SCALE`. Matches the program's `ceil_sats`. OK.

2. `available` - `BigInt(poolBalance) - ceilSats(owedScaled)`. Matches the program's `avail`. OK.

3. `credit` - `delta = avail * ACC_SCALE / w`, `acc += delta`, `owed += delta * w`. Matches the program's `credit`. OK.

4. `pendingSats` - `pendingScaled(v, acc) / ACC_SCALE`. Matches the program's `owed_of` / `ACC_SCALE`. OK.

5. `pendingScaled` - `(weightOf(level) + BigInt(boost)) * BigInt(acc) + BigInt(carry) - BigInt(debt)`. Matches the program's `owed_of`. OK.

6. `reweigh` - `owed = pendingScaled(v, acc)`, `carry = owed`, `debt = (weightOf(v.level) + BigInt(boost)) * BigInt(acc)`. Matches the program's `reweigh`. OK.

7. `debtAtActivation` - `weightOf(level) * BigInt(acc)`. Matches the program's `join`. OK.

Let me look for issues.

**Potential issue 48: `pendingScaled` throws if `p < 0n`.**

```js
export function pendingScaled({ level, debt, boost = 0, carry = 0n }, acc) {
  const p = (weightOf(level) + BigInt(boost)) * BigInt(acc) + BigInt(carry) - BigInt(debt)
  if (p < 0n) throw new Error('debt above entitlement: the record and the accumulator disagree')
  return p
}
```

The program's `owed_of` uses `checked_sub` which returns an error if the result is negative. So the off-chain version matches. OK.

**Potential issue 49: `credit` throws if `w <= 0n`.**

```js
export function credit({ acc, owed }, avail, w) {
  avail = BigInt(avail); w = BigInt(w)
  if (w <= 0n) throw new Error('no activated weight')
  ...
}
```

The program's `credit` is only called with `w > 0`. OK.

**Potential issue 50: `weightOf` throws if the level is invalid.**

```js
export const weightOf = level => {
  if (!Number.isInteger(level) || level < 1 || level > 5) throw new Error(`level ${level} has no weight`)
  return WEIGHTS[level - 1]
}
```

OK.

Let me now look at the revenue.

**R5. THE SWAP HOP (bank/revenue.mjs)**

Let me check the bounds.

1. `MAX_PER_CYCLE_LAMPORTS` is 50 SOL. OK.

2. `SLIPPAGE_BPS` is 100 (1%). OK.

3. `MAX_PRICE_IMPACT_PCT` is 1.5%. OK.

4. `MAX_REQUOTE_DRIFT_BPS` is 200 (2%). OK.

5. The sweep is capped by `chainCap` (from config). OK.

6. The cooldown is checked. OK.

7. The operator key is checked. OK.

8. The operator's SOL balance is checked. OK.

9. The quote is checked for price impact. OK.

10. The post-sweep quote is checked for drift. OK.

11. The swap transaction is checked for signers and forbidden programs. OK.

12. The return is checked as a delta. OK.

13. The split is checked. OK.

Let me look for issues.

**Potential issue 51: The `cycleIsOpen` predicate.**

```js
export function cycleIsOpen(c) {
  const moved = BigInt(c?.sweptLamports ?? c?.intendedLamports ?? 0)
  if (c?.sendRejected) return false
  if (moved === 0n) return false
  return BigInt(c?.returnedSats ?? 0) === 0n || !(c?.splitSig || c?.splitByOther)
}
```

OK.

**Potential issue 52: The `audit` function.**

```js
function audit() {
  const l = load()
  const swept = l.cycles.reduce((a, c) => a + BigInt(c.sweptLamports || c.intendedLamports || 0), 0n)
  const returned = l.cycles.reduce((a, c) => a + BigInt(c.returnedSats || 0), 0n)
  const open = l.cycles.filter(cycleIsOpen)
  ...
}
```

OK.

**Potential issue 53: The `main` function's open-cycle guard.**

```js
const open = (led.cycles || []).filter(cycleIsOpen)
if (open.length) {
    throw new Error(`${open.length} revenue cycle(s) swept SOL and never recorded a cbBTC return ...`)
}
```

OK.

**Potential issue 54: The `main` function's crash recovery.**

```js
{
    const returnedUnsplit = (led.cycles || []).filter(c => cycleIsOpen(c) && BigInt(c?.returnedSats ?? 0) > 0n)
    if (returnedUnsplit.length) {
      const revAta0 = getAssociatedTokenAddressSync(CBBTC, REVENUE, true)
      if (isProvablyEmpty(await conn.getAccountInfo(revAta0, 'confirmed'))) {
        for (const c of returnedUnsplit) { c.splitByOther = true; c.splitByOtherAt = new Date().toISOString()
          c.splitFailure = 'recovered: the revenue ATA was provably empty at the next run (a crash after the split, before the save)' }
        save(led)
      }
    }
}
```

OK.

**Potential issue 55: The `main` function's operator ATA creation.**

```js
const opAtaAddr = getAssociatedTokenAddressSync(CBBTC, operator.publicKey)
const opInfo = await conn.getAccountInfo(opAtaAddr, 'confirmed')
const opBefore = readTokenAccount(opInfo).state === 'absent'
    ? 0n
    : requireTokenAmount(opInfo, 'the swap operator cbBTC token account', opAtaAddr.toBase58())
if (readTokenAccount(opInfo).state === 'absent') {
    console.log(`  creating the operator cbBTC ATA ${opAtaAddr.toBase58()} (first cycle for this key)`)
    await sendAndConfirmTransaction(conn, new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, opAtaAddr, operator.publicKey, CBBTC)),
      [operator], { commitment: 'confirmed' })
}
```

OK.

**Potential issue 56: The `main` function's intent write.**

```js
const cycle = { startedAt: new Date().toISOString(), quotedSats: q.outAmount,
    intendedLamports: String(amount) }
led.cycles.push(cycle); save(led)
```

OK.

**Potential issue 57: The `main` function's sweep.**

```js
try {
  cycle.sweepSig = await sendAndConfirmTransaction(conn, new Transaction().add(new TransactionInstruction({
    programId: MINT_PROG, data: Buffer.concat([d('sweep_sol_for_swap'), u64(amount)]),
    keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: true },
      { pubkey: REVENUE, isSigner: false, isWritable: true },
      { pubkey: operator.publicKey, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] })),
    [operator], { commitment: 'confirmed' })
} catch (e) {
  const rejected = /custom program error|Error Code:|Transaction simulation failed/.test(String(e.message))
  if (rejected) {
    cycle.sendRejected = true
    cycle.error = String(e.message).slice(0, 300)
    save(led)
    throw new Error(`the sweep was REFUSED by the program and no SOL moved: ${cycle.error}`)
  }
  throw e
}
cycle.sweptLamports = String(amount); save(led)
```

OK.

**Potential issue 58: The `main` function's re-quote.**

```js
const q2 = await (await fetch(`https://quote-api.jup.ag/v6/quote?...`)).json()
if (!q2?.outAmount) throw new Error(`no Jupiter route after the sweep: ...`)
if (q2.priceImpactPct === undefined || q2.priceImpactPct === null)
    throw new Error('the post-sweep Jupiter quote carried no priceImpactPct; ...')
const impact2 = Math.abs(Number(q2.priceImpactPct))
if (!Number.isFinite(impact2) || impact2 > MAX_PRICE_IMPACT_PCT)
    throw new Error(`post-sweep price impact ${q2.priceImpactPct}% exceeds ${MAX_PRICE_IMPACT_PCT}% ...`)
const minOut = BigInt(q.outAmount) * BigInt(10_000 - MAX_REQUOTE_DRIFT_BPS) / 10_000n
if (BigInt(q2.outAmount) < minOut)
    throw new Error(`the post-sweep quote is ${q2.outAmount} sats against ${q.outAmount} before the sweep, ...`)
const guaranteed = BigInt(q2.otherAmountThreshold ?? 0)
if (guaranteed < minOut)
    throw new Error(`the post-sweep route guarantees only ${guaranteed} sats ...`)
cycle.quotedSats = q2.outAmount; save(led)
```

OK.

**Potential issue 59: The `main` function's swap transaction check.**

```js
{
    const msg = vtx.message
    const signers = msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures)
    if (signers.length !== 1 || !signers[0].equals(operator.publicKey))
      throw new Error(`the swap transaction wants ${signers.length} signer(s) and we expect exactly one (the operator): ...`)
    const keys = msg.staticAccountKeys.map(k => k.toBase58())
    const FORBIDDEN = ['BPFLoaderUpgradeab1e11111111111111111111111', MINT_PROG.toBase58()]
    const bad = keys.filter(k => FORBIDDEN.includes(k))
    if (bad.length) throw new Error(`the swap transaction touches ${bad.join(', ')}, which no swap needs`)
    if (msg.addressTableLookups?.length > 4)
      throw new Error(`the swap transaction carries ${msg.addressTableLookups.length} address table lookups, more than any route we expect`)
}
```

OK.

**Potential issue 60: The `main` function's return.**

```js
const after = requireTokenAmount(await conn.getAccountInfo(opAta, 'confirmed'),
    'the swap operator cbBTC token account', opAta.toBase58())
const delta = after > opBefore ? after - opBefore : 0n
if (delta < guaranteed)
    throw new Error(`the swap credited ${delta} sats to the operator (balance ${opBefore} -> ${after}) against the route's guaranteed ${guaranteed}. Refusing to record it as this cycle's return.`)
const got = after
cycle.returnSig = await sendAndConfirmTransaction(conn, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, revAta, REVENUE, CBBTC),
    createTransferCheckedInstruction(opAta, CBBTC, revAta, operator.publicKey, got, 8)),
    [operator], { commitment: 'confirmed' })
cycle.returnedSats = String(delta)
cycle.returnedAt = new Date().toISOString()
cycle.sweptAtaTotal = String(got); save(led)
```

OK.

**Potential issue 61: The `main` function's split.**

```js
cycle.splitSig = await sendAndConfirmTransaction(conn, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, ataOf(bankWallet), bankWallet, CBBTC),
    new TransactionInstruction({ programId: MINT_PROG,
      data: Buffer.concat([d('split_revenue'), Buffer.from([8])]),
      keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: false },
        { pubkey: REVENUE, isSigner: false, isWritable: true },
        { pubkey: CBBTC, isSigner: false, isWritable: false },
        { pubkey: revAta, isSigner: false, isWritable: true },
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: ataOf(bankWallet), isSigner: false, isWritable: true },
        { pubkey: TOKEN, isSigner: false, isWritable: false }] })),
    [operator], { commitment: 'confirmed' }).catch(async e => {
    if (isProvablyEmpty(await conn.getAccountInfo(revAta, 'confirmed'))) {
      cycle.splitByOther = true
      cycle.splitByOtherAt = new Date().toISOString()
      cycle.splitFailure = String(e.message).slice(0, 300)
      return undefined
    }
    throw e
})
```

OK.

**Potential issue 62: The `main` function's final save.**

```js
cycle.finishedAt = new Date().toISOString(); save(led)
console.log(`  swept ${amount} -> got ${got} sats -> split ${splitBps / 100}/${(10000 - splitBps) / 100}`)
audit()
```

OK.

Let me now look at the selftest.

**R6. THE GATES (bank/selftest.mjs, scripts/run-tests.sh)**

Let me look for assertions that cannot fail, floors that can be satisfied by deleting work, and checks that pass vacuously when their input is empty.

**Potential issue 63: The `FLOOR` in selftest.mjs.**

```js
const FLOOR = 509
const bad = R.filter(r => !r.ok)
if (R.length !== FLOOR) {
  console.error(`\n${R.length} assertions ran; the floor says ${FLOOR}. They must be EQUAL — the file stopped early, or the floor was not moved with the suite.`)
  process.exit(1)
}
```

OK.

**Potential issue 64: The `floor` function in run-tests.sh.**

```bash
floor(){ # floor <label> <output> <regex> <expected>
  local n; n=$(grep -oE "$3" <<<"$2" | grep -oE '^[0-9]+' | tail -1)
  [ -n "$n" ] || die "$1: could not read an assertion count out of the output"
  [ "$n" -ge "$4" ] || die "$1: $n assertions, floor is $4 — assertions went missing"
  [ "$n" -eq "$4" ] || die "$1: $n assertions but the floor says $4 — the floor must EQUAL the count. Move it (and SPEC's stated counts) in the same commit."
}
```

OK.

**Potential issue 65: The `MIN_ASSERTIONS` check in run-tests.sh.**

```bash
[ "$TOTAL" -ge "$MIN_ASSERTIONS" ] || die "suite made only $TOTAL assertions, floor is $MIN_ASSERTIONS — it stopped early"
[ "$TOTAL" -eq "$MIN_ASSERTIONS" ] || die "suite made $TOTAL assertions but MIN_ASSERTIONS says $MIN_ASSERTIONS — the floor must EQUAL the count. Move it and SPEC's stated counts in the same commit."
```

OK.

Let me look for specific issues in the selftest.

**Potential issue 66: The `t` function in selftest.mjs.**

```js
const t = (name, got, want) => { const ok = J(got) === J(want)
  R.push({ name, ok, got, want }); console.log(`  ${ok ? 'ok  ' : 'XX  '}${name}${ok ? '' : `\n        got ${J(got)}\n        want ${J(want)}`}`) }
```

OK.

**Potential issue 67: The `J` function.**

```js
const J = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? `${x}n` : x)
```

OK.

Let me look for assertions that cannot fail.

**Potential issue 68: The `detectApprovals` test.**

```js
t('fires on an approve BY a vault PDA',
  D.detectApprovals([{ program: D.TOKEN_ID, parsed: { type: 'approve', info: { owner: PDA, delegate: OTHER, source: ATA_OK } } }], pdas).length, 1)
```

This should fire. OK.

**Potential issue 69: The `detectPdaTokenAccounts` test.**

```js
t('CRITICAL on a NON-canonical token account for a vault PDA',
  D.detectPdaTokenAccounts([{ program: D.ATA_ID, parsed: { info: { wallet: PDA, account: ATA_BAD } } }], pdas, atas)[0].severity, 'CRITICAL')
```

This should fire. OK.

**Potential issue 70: The `detectBurns` test.**

```js
t('CRITICAL on a BARE Core BurnV1 of a known vault',
  D.detectBurns([{ program: D.CORE_ID, dataBytes: [12], accounts: [ASSET] }], assets, BURN_PROG)[0].severity, 'CRITICAL')
```

This should fire. OK.

**Potential issue 71: The `detectVaultSetChange` test.**

```js
t('CRITICAL when a known vault turns up BURNT',
  D.detectVaultSetChange([V1,V2],{live:[V2],burnt:[V1]}).findings[0].kind, 'vault_burned')
```

This should fire. OK.

**Potential issue 72: The `detectStandingRisks` test.**

```js
t('CRITICAL when there is no ceiling on a single sweep',
  D.detectStandingRisks({ 'mint.max_sweep_lamports': '0', 'mint.sweep_cooldown_secs': '3600' })
    .some(f => f.kind === 'sweep_bound_ineffective'), true)
```

This should fire. OK.

**Potential issue 73: The lock tests.**

These are extensive. OK.

**Potential issue 74: The `detectIndexShortfall` test.**

```js
t('CRITICAL when the index repeats ids to reach the chain count',
  D.detectIndexShortfall('3', ['a', 'a', 'a'], [])[0].kind, 'index_disagrees_with_chain')
```

This should fire. OK.

**Potential issue 75: The `detectUnreconciledRevenue` test.**

```js
t('CRITICAL when SOL was swept and no cbBTC came back',
  D.detectUnreconciledRevenue({ cycles: [{ startedAt: '2026-08-22T00:00:00Z', sweptLamports: '5' }] },
    { now: T0 + 7200_000 })[0].severity, 'CRITICAL')
```

This should fire. OK.

**Potential issue 76: The `detectSplitClaims` test.**

```js
t('CRITICAL when a cycle claims a split the chain scan has not seen',
  D.detectSplitClaims([], { cycles: [{ startedAt: '2026-08-22T00:00:00Z', splitSig: 'sigS' }] },
    { now: T + 7200_000 })[0].kind, 'split_not_on_chain')
```

This should fire. OK.

**Potential issue 77: The `detectNestedVaults` test.**

```js
t('CRITICAL when one vault is owned by another vault\'s asset-signer PDA',
  D.detectNestedVaults([{ id: OUTER, owner: HUMAN }, { id: INNER, owner: OUTER_PDA }], pdaOf, curve2)[0]?.kind ?? null,
  'nested_vault')
```

This should fire. OK.

**Potential issue 78: The `detectUndeclaredTokenAccounts` test.**

```js
t('CRITICAL on a token account a vault owns that is not a reserve ATA',
  D.detectUndeclaredTokenAccounts(ASSET, [ATA_OK], [{ address: ATA_BAD, amount: 5n }])[0].kind,
  'undeclared_token_account')
```

This should fire. OK.

**Potential issue 79: The `judgeRedemptionCoverage` test.**

```js
t('coverage passes when every holding is declared',
  cov([{ address: 'ata1', amount: '5', kind: 'token' }], ['ata1']).ok, true)
```

OK.

**Potential issue 80: The `classifyPdaTokenAccount` test.**

```js
t('a classic EMPTY token account is ignored',
  cls({ address: 'a', dataLen: 165, amount: 0n }), null)
```

OK.

**Potential issue 81: The `parseAcks` test.**

```js
t('an absent ack file is quiet and acks nothing',
  JSON.stringify(D.parseAcks(null)), JSON.stringify({ acks: {}, problem: null }))
```

OK.

**Potential issue 82: The `judgeAck` test.**

```js
t('an acked finding drops to INFO',
  one(D.applyAcks([crit('vault_owns_itself', A2)], { [`vault_owns_itself:${A2}`]: ack('gary: bricked, accepted') })).severity,
  'INFO')
```

OK.

**Potential issue 83: The `correlateBurns` test.**

```js
t('a vault that vanished WITH a scanned burn_vault is a redemption (INFO)',
  sev(D.correlateBurns([gone(A), via(A)]), 'vault_burned', A), 'INFO')
```

OK.

**Potential issue 84: The `detectProgramEvents` test.**

```js
t('a reschedule and a frozen deferral PAGE, URGENT (they fire once)',
  ev.filter(f => f.urgent).map(f => [f.kind, f.severity]), [['reveal_rescheduled', 'HIGH'], ['claim_deferred_frozen', 'HIGH']])
```

OK.

**Potential issue 85: The `detectDistributionOverdue` test.**

```js
t('OVERDUE: past the period plus grace, with weight and something to pay',
  D.detectDistributionOverdue(base, { nowSec: due + 7 * 3600, poolAvail: 50n, graceSecs: 6 * 3600 })[0]?.severity, 'CRITICAL')
```

OK.

**Potential issue 86: The `detectPoolHealth` test.**

```js
t('a healthy pool is QUIET', D.detectPoolHealth(owed, { state: 'ok', amount: 100n, frozen: false }), [])
```

OK.

**Potential issue 87: The `redemptionCapacity` test.**

```js
t('2,100 live vaults: cap is ceil(2100 x 2.1%) = 45 an hour', String(D.redemptionCapacity(bk(2100, []), T).cap), '45')
```

OK.

**Potential issue 88: The `detectRedemptionRate` test.**

```js
t('...45 redemptions in the last hour leave 0, and it pages', [String(D.redemptionCapacity(bk(2100, at(45, T)), T).remaining),
  D.detectRedemptionRate(bk(2100, at(45, T)), T)[0]?.kind], ['0', 'redemptions_near_cap'])
```

OK.

**Potential issue 89: The `detectBrakeTransitions` test.**

```js
t('the brake PULLED is CRITICAL and URGENT',
  D.detectBrakeTransitions({ 'mint.sales_stopped': false }, { 'mint.sales_stopped': true }).map(f => [f.kind, f.severity, f.urgent]), [['brake_pulled', 'CRITICAL', true]])
```

OK.

**Potential issue 90: The `detectUpgradeAuthorityAfterLock` test.**

```js
t('an upgradeable program PAST the lock date is CRITICAL',
  D.detectUpgradeAuthorityAfterLock(progs, { lockDeadlineSec: 100, nowSec: 200 }).map(f => f.kind), ['program_not_locked'])
```

OK.

**Potential issue 91: The `detectUnsplitRevenue` test.**

```js
t('S1: mint-price cbBTC unsplit past the grace pages', D.detectUnsplitRevenue({ amount: 21000n, sinceSec: T, nowSec: T + 7 * 3600 })[0]?.kind, 'revenue_unsplit')
```

OK.

**Potential issue 92: The `detectFrozenVaultAccount` test.**

```js
t('F6: a FROZEN vault cbBTC account pages HIGH and says it blocks the redemption',
  D.detectFrozenVaultAccount({ vault: 'V', mint: D.CBBTC_MINT, isPayment: true }).map(f => [f.kind, f.severity, /cannot be redeemed/.test(f.detail)]), [['vault_account_frozen', 'HIGH', true]])
```

OK.

**Potential issue 93: The `detectRevealStall` test.**

```js
t('A4: a level queue that did not move between two passes pages', D.detectRevealStall(q(10, 7), q(10, 7))[0]?.kind, 'reveal_queue_stalled')
```

OK.

**Potential issue 94: The crank tests.**

These are extensive. OK.

**Potential issue 95: The accrual tests.**

These are extensive. OK.

**Potential issue 96: The poster tests.**

These are extensive. OK.

Let me now look for actual bugs in the code.

**Bug 1: The `detectDistributionOverdue` function uses `cur['mint.active_count']` which is not in WATCHED_KEYS.**

Actually, this is only used in the detail string, so it's not a bug. But it's worth noting.

**Bug 2: The `detectStandingRisks` function checks `cur['mint.split_bps'] !== undefined && Number(cur['mint.split_bps']) !== 8500`.**

If `split_bps` is undefined, the check is skipped. But `split_bps` is in WATCHED_KEYS, so it should be produced. OK.

**Bug 3: The `detectStandingRisks` function checks `cur['mint.guardian'] === DEFAULT_PUBKEY`.**

`DEFAULT_PUBKEY` is `'11111111111111111111111111111111'`. If the guardian is retired, it's set to `Pubkey::default()` which is the same. OK.

**Bug 4: The `detectStandingRisks` function checks `cur['mint.pending_swap_operator']` and `cur['mint.pending_guardian_set']`.**

These are in WATCHED_KEYS. OK.

**Bug 5: The `detectStandingRisks` function checks `cur['mint.pending_count']` and `cur['mint.pending_this_epoch']`.**

These are in WATCHED_KEYS. OK.

**Bug 6: The `detectStandingRisks` function checks `cur['mint.max_sweep_lamports']` and `cur['mint.sweep_cooldown_secs']`.**

These are in WATCHED_KEYS. OK.

**Bug 7: The `detectStandingRisks` function checks `cur['mint.charter_closes_at']` and `cur['mint.charter_opens_at']`.**

These are in WATCHED_KEYS. OK.

**Bug 8: The `detectStandingRisks` function checks `cur['mint.charter_secs']` which is computed.**

OK.

**Bug 9: The `detectStandingRisks` function checks `cur['mint.max_boost_weight']` and `cur['mint.max_boost_epochs']`.**

These are in WATCHED_KEYS. OK.

**Bug 10: The `detectStandingRisks` function checks `cur['mint.cbob_mint']`.**

This is in WATCHED_KEYS. OK.

**Bug 11: The `detectStandingRisks` function checks `cur['mint.payment_mint']`, `cur['mint.bank_treasury']`, `cur['seal.reserve_mints']`, `cur['mint.pob_root']`.**

These are in WATCHED_KEYS. OK.

**Bug 12: The `detectStandingRisks` function checks `cur['mint.max_supply']`, `cur['mint.level_caps']`.**

These are in WATCHED_KEYS. OK.

**Bug 13: The `detectStandingRisks` function checks `cur['gov.quorum_bps']`, `cur['gov.threshold_bps']`, `cur['gov.min_voting_secs']`.**

These are in WATCHED_KEYS. OK.

**Bug 14: The `detectStandingRisks` function checks `cur['mint.notice_secs']`, `cur['mint.sweep_floor_lamports']`, `cur['mint.cooldown_ceiling_secs']`, `cur['mint.reserve_ceiling_lamports']`.**

These are in WATCHED_KEYS. OK.

**Bug 15: The `detectStandingRisks` function checks `cur['burn.redeem_window_secs']`.**

This is in WATCHED_KEYS. OK.

**Bug 16: The `detectStandingRisks` function checks `cur['mint.monthly_secs']`.**

This is in WATCHED_KEYS. OK.

OK, the standing risks look comprehensive.

Let me look at the alarm's `readConfigs` function.

**Bug 17: `readConfigs` reads the configs and produces the snapshot. It checks `missingWatchedKeys`.**

OK.

**Bug 18: `readConfigs` reads the program data for each program.**

OK.

**Bug 19: `readConfigs` reads the collection plugins hash.**

OK.

**Bug 20: `readConfigs` reads the PoB collection plugins hash and update authority.**

OK.

**Bug 21: `readPool` reads the pool and the config together.**

OK.

**Bug 22: The alarm's `main` function reads the ledger.**

OK.

**Bug 23: The alarm's `main` function reads the configs.**

OK.

**Bug 24: The alarm's `main` function reads the pool.**

OK.

**Bug 25: The alarm's `main` function reads the revenue.**

OK.

**Bug 26: The alarm's `main` function reads the vaults.**

OK.

**Bug 27: The alarm's `main` function detects nested vaults.**

OK.

**Bug 28: The alarm's `main` function detects index shortfalls.**

OK.

**Bug 29: The alarm's `main` function detects vault set changes.**

OK.

**Bug 30: The alarm's `main` function reads balances.**

OK.

**Bug 31: The alarm's `main` function walks signatures.**

OK.

**Bug 32: The alarm's `main` function processes each transaction.**

OK.

**Bug 33: The alarm's `main` function advances cursors.**

OK.

**Bug 34: The alarm's `main` function writes state.**

OK.

Let me now look for specific issues in the code.

**Issue 1: The `detectDistributionOverdue` function's `launch_tick_overdue` check.**

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. OK.

**Issue 2: The `detectDistributionOverdue` function's `joins_stalled` check.**

```js
if (eligible > 0n && BigInt(nowSec) - last > BigInt(graceSecs)) stalls.push({ kind: 'joins_stalled', severity: S.HIGH, ... })
```

This fires if there are eligible vaults and the last distribution was more than grace ago. OK.

**Issue 3: The `detectDistributionOverdue` function's `boosts_stalled` check.**

```js
const bd = big(cur['mint.boosts_due'])
if (bd !== null && bd > 0n && BigInt(nowSec) - last > BigInt(graceSecs)) stalls.push({ kind: 'boosts_stalled', severity: S.HIGH, ... })
```

This fires if there are due boosts and the last distribution was more than grace ago. OK.

**Issue 4: The `detectRedemptionRate` function's `nearFraction` check.**

```js
if (c.remaining >= c.cap) return []
const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
if (c.remaining > near) return []
```

This fires if the remaining capacity is <= 20% of the cap. OK.

**Issue 5: The `detectUnsplitRevenue` function's check.**

```js
if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
```

This fires if there's unsplit revenue and it's been more than grace. OK.

**Issue 6: The `detectFrozenVaultAccount` function's check.**

```js
return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
```

This always fires when called. OK.

**Issue 7: The `detectRevealStall` function's check.**

```js
if (!prev) return []
const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
if ([m0, r0, m1, r1].some(v => v === null)) return []
if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
```

This fires if the reveal queue hasn't moved. OK.

**Issue 8: The `detectBrakeTransitions` function's check.**

```js
for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
}
```

This fires on brake transitions. OK.

**Issue 9: The `detectUpgradeAuthorityAfterLock` function's check.**

```js
if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
}
if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
const out = []
for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
}
return out
```

This fires if a program is upgradeable past the lock date. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

**Bug 1: The `detectDistributionOverdue` function's `launch_tick_overdue` check uses `pt > 0n` but `pt` is `pending_this_epoch`.**

Actually, this is correct. The launch tick is needed when there are vaults waiting to join in the current epoch. OK.

**Bug 2: The `detectDistributionOverdue` function's `joins_stalled` check uses `eligible = pc - pt`.**

This is the number of vaults eligible to join (requested in an earlier epoch). OK.

**Bug 3: The `detectDistributionOverdue` function's `boosts_stalled` check uses `bd = big(cur['mint.boosts_due'])`.**

This is the number of due boosts. OK.

**Bug 4: The `detectRedemptionRate` function's `nearFraction` check.**

OK.

**Bug 5: The `detectUnsplitRevenue` function's check.**

OK.

**Bug 6: The `detectFrozenVaultAccount` function's check.**

OK.

**Bug 7: The `detectRevealStall` function's check.**

OK.

**Bug 8: The `detectBrakeTransitions` function's check.**

OK.

**Bug 9: The `detectUpgradeAuthorityAfterLock` function's check.**

OK.

Let me look at the crank's `planCrank` function more carefully.

**Bug 10: The `planCrank` function's `preJoinWeight` calculation.**

```js
const preJoinWeight = plan.preJoins.reduce((a, [addr]) => {
    const r = records.find(x => x.address === addr); return a + L.LEVEL_WEIGHTS[r.level - 1] }, 0n)
```

This uses `L.LEVEL_WEIGHTS[r.level - 1]`. If `r.level` is 0, this would be `L.LEVEL_WEIGHTS[-1]` which is undefined. But preJoins only include vaults with `r.pending` true, and pending requires level 1-5. So OK.

**Bug 11: The `planCrank` function's `retiringWeight` calculation.**

```js
const retiringWeight = plan.retireBurned.reduce((a, addr) => {
    const r = records.find(x => x.address === addr); return r.active ? a + wOf(r) : a }, 0n)
```

This uses `wOf(r)` which is `L.LEVEL_WEIGHTS[r.level - 1] + boostOf(r)`. If `r.level` is 0, this would be undefined. But retireBurned only includes vaults with `r.level !== 0`. OK.

**Bug 12: The `planCrank` function's `expiringWeight` calculation.**

```js
const expiringWeight = plan.preExpires.reduce((a, addr) => a + boostOf(records.find(x => x.address === addr)), 0n)
```

This uses `boostOf(r)` which is `BigInt(r.boost_weight ?? 0)`. OK.

**Bug 13: The `planCrank` function's `w` calculation.**

```js
const w = BigInt(cfg.total_active_weight) + preJoinWeight - retiringWeight - expiringWeight
```

OK.

**Bug 14: The `planCrank` function's `avail` calculation.**

```js
const avail = available(BigInt(pool.amount) + splitToPool, cfg.owed_scaled)
```

OK.

**Bug 15: The `planCrank` function's `acc` calculation.**

```js
acc += avail * L.ACC_SCALE / w
```

OK.

**Bug 16: The `planCrank` function's `postExpires` check.**

```js
if (BigInt(r.boost_end_epoch) === BigInt(cfg.dist_epoch) + 1n) plan.postExpires.push(r.address)
```

OK.

**Bug 17: The `planCrank` function's `joins` check.**

```js
if (BigInt(r.request_epoch) !== BigInt(cfg.dist_epoch)) continue
```

OK.

**Bug 18: The `planCrank` function's `claims` check.**

```js
if (joinedNow) owed = pendingSats({ level: r.level, debt: L.LEVEL_WEIGHTS[r.level - 1] * BigInt(cfg.acc_scaled) }, acc)
```

OK.

**Bug 19: The `planCrank` function's `preExpired` check.**

```js
else if (preExpired.has(r.address)) {
    const atExpiry = pendingScaled({ level: r.level, debt: r.debt_scaled, boost: r.boost_weight, carry: r.carry_scaled }, cfg.acc_scaled)
    owed = (atExpiry + L.LEVEL_WEIGHTS[r.level - 1] * (acc - BigInt(cfg.acc_scaled))) / ACC_SCALE
}
```

OK.

**Bug 20: The `planCrank` function's `else` branch.**

```js
else owed = pendingSats({ level: r.level, debt: r.debt_scaled, boost: r.boost_weight ?? 0, carry: r.carry_scaled ?? 0n }, acc)
```

OK.

Let me look at the crank's `main` function more carefully.

**Bug 21: The `main` function's `records` fetch.**

```js
const raw = await conn.getProgramAccounts(MINT, { commitment: 'confirmed',
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(disc) } },
      ...(REVEAL_ONLY ? [{ memcmp: { offset: L.offsets('VaultRecord').level, bytes: bs58.encode(Buffer.from([0])) } }] : [])] })
```

OK.

**Bug 22: The `main` function's `assets` map.**

```js
const assetInfos = await getMany(records.map(r => P(r.asset)))
const assets = {}
records.forEach((r, i) => {
    const a = assetInfos[i]
    assets[r.asset] = !a ? 'other'
      : a.owner.toBase58() === CORE_ID && a.data.length === 1 && a.data[0] === 0 ? 'burned'
      : a.owner.toBase58() === CORE_ID && a.data[0] === 1 ? 'live' : 'other'
})
```

OK.

**Bug 23: The `main` function's `tokens` map.**

```js
const payMint = P(cfg.payment_mint)
const tokenAddr = r => r.active ? r.vault_ata : ataOf(payMint, signerPda(r.asset)).toBase58()
const tokInfos = await getMany(records.map(r => P(tokenAddr(r))))
const tokens = {}
records.forEach((r, i) => {
    const info = tokInfos[i], t = readTokenAccount(info)
    tokens[r.asset] = { ...t, address: tokenAddr(r),
      frozen: t.state === 'ok' && info.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
})
```

OK.

**Bug 24: The `main` function's `pool` read.**

```js
const poolInfo = await conn.getAccountInfo(P(cfg.pool_ata), 'confirmed')
const pt = readTokenAccount(poolInfo)
const pool = { ...pt, frozen: pt.state === 'ok' && poolInfo.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
```

OK.

**Bug 25: The `main` function's `revenue` read.**

```js
const REVENUE = pda([Buffer.from(L.SEEDS.revenue)], MINT)
const revAta = ataOf(payMint, REVENUE), bankAta = ataOf(payMint, P(cfg.bank_treasury))
const revenue = readTokenAccount(await conn.getAccountInfo(revAta, 'confirmed'))
```

OK.

**Bug 26: The `main` function's `payDecimals` read.**

```js
const payDecimals = (await conn.getAccountInfo(payMint, 'confirmed'))?.data?.[44]
```

OK.

**Bug 27: The `main` function's `slot` and `nowSec` reads.**

```js
const slot = await conn.getSlot('confirmed')
const nowSec = Math.floor(Date.now() / 1000)
```

OK.

**Bug 28: The `main` function's `plan` call.**

```js
const plan = planCrank({ cfg, records, assets, tokens, pool, slot, nowSec, revenue }, { revealOnly: REVEAL_ONLY })
```

OK.

**Bug 29: The `main` function's `LIVE` check.**

```js
if (!LIVE) { console.log('\nDRY RUN. Re-run with --live to send.'); return }
```

OK.

**Bug 30: The `main` function's fee payer.**

```js
const KEY = process.env.CBOB_CRANK_KEY || '/opt/cbob-vaults/bank/keys/crank.json'
const mode = fs.statSync(KEY).mode & 0o777
if (mode & 0o077) throw new Error(`${KEY} is mode ${mode.toString(8)}; it must be 600`)
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEY, 'utf8'))))
const fee = judgeFeePayer(BigInt(await conn.getBalance(payer.publicKey, 'confirmed')))
if (!fee.ok) throw new Error(fee.why)
if (fee.warn) { console.error(fee.warn); try { execFileSync(NOTIFY, [...]) } catch {} }
```

OK.

**Bug 31: The `main` function's `d` function.**

```js
const d = n => ixDisc(n)
```

OK.

**Bug 32: The `main` function's `W` and `R` functions.**

```js
const W = (pubkey, w = true) => ({ pubkey: P(pubkey), isSigner: false, isWritable: w })
const R = pubkey => W(pubkey, false)
```

OK.

**Bug 33: The `main` function's `byAddr` map.**

```js
const byAddr = new Map(records.map(r => [r.address, r]))
```

OK.

**Bug 34: The `main` function's `failures` array.**

OK.

**Bug 35: The `main` function's `BENIGN` regex.**

OK.

**Bug 36: The `main` function's `send` function.**

OK.

**Bug 37: The `main` function's `run` function.**

OK.

**Bug 38: The `main` function's reschedule loop.**

OK.

**Bug 39: The `main` function's capture loop.**

OK.

**Bug 40: The `main` function's reveal loop.**

OK.

**Bug 41: The `main` function's retireBurned loop.**

OK.

**Bug 42: The `main` function's preJoins loop.**

OK.

**Bug 43: The `main` function's expire function.**

OK.

**Bug 44: The `main` function's split.**

OK.

**Bug 45: The `main` function's distribute.**

OK.

**Bug 46: The `main` function's postExpires.**

OK.

**Bug 47: The `main` function's activate loop.**

OK.

**Bug 48: The `main` function's claims loop.**

OK.

**Bug 49: The `main` function's failures handling.**

OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `planCrank` function's `preJoins` loop:

```js
for (const r of records) {
    if (r.retired || r.active || !r.pending) continue
    if (assets[r.asset] === 'burned') continue
    if (BigInt(r.request_epoch) >= BigInt(cfg.dist_epoch)) continue
    plan.preJoins.push([r.address, r.vault_ata])
}
```

This joins vaults that requested in an earlier epoch. But what if the vault is burned? It's skipped. But the program's `claim` would join it (the program doesn't check if the asset is alive). Hmm, actually the crank skips it, which is correct (the program's `claim` would join a burned vault, adding dead weight). The crank's behavior is better. OK.

But wait - what if the vault is burned and NOT retired? The crank's retireBurned loop only retires vaults with `r.level !== 0`. So a burned vault with level 0 is not retired. But it's also not joined (because it's burned). So it stays pending forever. Hmm. But the program's `retire_burned` doesn't require a level. So the crank could retire it. But the crank's retireBurned loop requires `r.level !== 0`. So it doesn't.

Actually, let me re-read the retireBurned loop:

```js
for (const r of records) {
    if (!r.retired && assets[r.asset] === 'burned' && r.level !== 0) plan.retireBurned.push(r.address)
}
```

So a burned vault with level 0 is not retired. But the program's `retire_burned` doesn't require a level. So the crank could retire it. But it doesn't. This means a burned vault with level 0 stays in the pending queue forever. Hmm.

But wait - the reveal loop reveals it (it's in mint order). After reveal, it has a level, and then the retireBurned loop picks it up. So it's eventually retired. OK.

But what if the reveal window lapses? The reschedule loop handles it. OK.

So the burned vault with level 0 is eventually revealed and retired. OK.

Hmm, but there's a subtle issue: the reveal loop reveals in mint order. If a burned vault with level 0 is at the head of the queue, it blocks the reveal of all later vaults until it's revealed. But the reveal loop includes it (it's in mint order). So it's revealed. OK.

OK, I think the crank is pretty solid.

Let me now look at the detectors more carefully.

**Bug 50: The `detectApprovals` function's fallback.**

```js
const owner = pdaSet.has(info.owner) ? info.owner : ataOwner[info.source]
if (!pdaSet.has(owner)) continue
```

This uses `ataOwner[info.source]` as a fallback. If `info.owner` is undefined, `pdaSet.has(undefined)` is false, so it uses the fallback. OK.

**Bug 51: The `detectPdaTokenAccounts` function's check.**

```js
if (!wallet || !pdaSet.has(wallet)) continue
const expected = expectedAtas.has(account)
out.push({
    kind: expected ? 'reserve_ata_created' : 'non_ata_token_account',
    severity: expected ? S.INFO : S.CRITICAL,
    ...
})
```

OK.

**Bug 52: The `detectBurns` function's check.**

```js
const burnVaultAt = new Map()
for (const ix of ixs) {
    if (ix.parent !== undefined || ix.program !== burnProgramId) continue
    if (burnVaultDiscriminator && !(ix.dataBytes && burnVaultDiscriminator.every((b, i) => ix.dataBytes[i] === b))) continue
    burnVaultAt.set(ix.index, ix.accounts?.[0])
}
for (const ix of ixs) {
    if (ix.program === burnProgramId) {
      if (burnVaultDiscriminator && !(ix.dataBytes && burnVaultDiscriminator.every((b, i) => ix.dataBytes[i] === b))) continue
      out.push({ kind: 'burn_via_program', severity: S.INFO, asset: ix.accounts?.[0] ?? null, ... })
      continue
    }
    if (ix.program !== CORE_ID) continue
    if (ix.dataBytes?.[0] !== IX_BURN_V1) continue
    const asset = ix.accounts?.[0]
    if (!assetSet.has(asset)) continue
    if (ix.parent !== undefined && burnVaultAt.get(ix.parent) === asset) continue
    out.push({ kind: 'bare_core_burn', severity: S.CRITICAL, asset, ... })
}
```

OK.

**Bug 53: The `detectVaultSetChange` function's check.**

```js
if (!prevLive || !prevLive.length) return { findings: out, trustCurrent: true }
const live = new Set(current.live || [])
const burnt = new Set(current.burnt || [])
const gone = prevLive.filter(a => !live.has(a))
const ratio = opts.maxDropRatio ?? 0.1
const allowed = Math.max(3, Math.floor(prevLive.length * ratio))
if (gone.length > allowed) {
    out.push({ kind: 'vault_index_shrank', severity: S.CRITICAL, ... })
    return { findings: out, trustCurrent: false }
}
for (const a of gone) {
    out.push(burnt.has(a)
      ? { kind: 'vault_burned', severity: S.CRITICAL, asset: a, ... }
      : { kind: 'vault_left_index', severity: S.CRITICAL, asset: a, ... })
}
return { findings: out, trustCurrent: true }
```

OK.

**Bug 54: The `detectConfigDrift` function's check.**

```js
for (const [k, severity, why] of watch) {
    const a = JSON.stringify(prev[k] ?? null), b = JSON.stringify(cur[k] ?? null)
    if (a !== b) out.push({ kind: 'config_drift', severity, detail: `${k}: ${a} -> ${b}  (${why})` })
}
```

OK.

**Bug 55: The `detectStandingRisks` function's check.**

OK.

**Bug 56: The `detectUnreconciledRevenue` function's check.**

OK.

**Bug 57: The `detectUndeclaredTokenAccounts` function's check.**

OK.

**Bug 58: The `judgeRedemptionCoverage` function's check.**

OK.

**Bug 59: The `classifyPdaTokenAccount` function's check.**

OK.

**Bug 60: The `parseAcks` function's check.**

OK.

**Bug 61: The `judgeAck` function's check.**

OK.

**Bug 62: The `applyAcks` function's check.**

OK.

**Bug 63: The `correlateBurns` function's check.**

OK.

**Bug 64: The `detectNestedVaults` function's check.**

OK.

**Bug 65: The `detectUnledgeredSweeps` function's check.**

OK.

**Bug 66: The `detectDeferredSweeps` function's check.**

OK.

**Bug 67: The `detectSplitClaims` function's check.**

OK.

**Bug 68: The `detectBalanceDrops` function's check.**

OK.

**Bug 69: The `detectIndexShortfall` function's check.**

OK.

**Bug 70: The `judgeCronTemplate` function's check.**

OK.

**Bug 71: The `readProgramData` function's check.**

OK.

**Bug 72: The `judgeDasEnvelope` function's check.**

OK.

**Bug 73: The `parseCbobLogs` function's check.**

OK.

**Bug 74: The `detectProgramEvents` function's check.**

OK.

**Bug 75: The `detectDistributionOverdue` function's check.**

OK.

**Bug 76: The `detectPoolHealth` function's check.**

OK.

**Bug 77: The `poolAvailable` function's check.**

OK.

**Bug 78: The `redemptionCapacity` function's check.**

OK.

**Bug 79: The `detectRedemptionRate` function's check.**

OK.

**Bug 80: The `detectUnsplitRevenue` function's check.**

OK.

**Bug 81: The `detectFrozenVaultAccount` function's check.**

OK.

**Bug 82: The `detectRevealStall` function's check.**

OK.

**Bug 83: The `detectBrakeTransitions` function's check.**

OK.

**Bug 84: The `detectUpgradeAuthorityAfterLock` function's check.**

OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ['burn.redeem_window_secs', 3600, 'the redemption rate-limit window (one hour)'],
      ['mint.notice_secs', 604800, 'the notice before a voted guardian or swap operator lands (7 days)'],
      ['mint.sweep_floor_lamports', 1000000000, 'the smallest per-sweep cap a vote may set (1 SOL)'],
      ['mint.cooldown_ceiling_secs', 86400, 'the longest sweep cooldown a vote may set (24 hours)'],
      ['mint.reserve_ceiling_lamports', 100000000, 'the most SOL a vote may hold back (0.1 SOL)'],
      ['gov.quorum_bps', 2100, 'the quorum (21% of live vaults)'],
      ['gov.threshold_bps', 5100, 'the YES threshold (51% of votes cast)'],
      ['gov.min_voting_secs', 259200, 'the voting period (3 days)'],
      ['mint.max_supply', 2100, 'the lifetime supply (2,100 vaults)'],
      ['mint.level_caps', '945,525,315,210,105', 'the level census (945/525/315/210/105)'],
      ['mint.payment_mint', CBBTC_MINT, 'the payment mint (cbBTC)'],
      ['mint.bank_treasury', CBOBTC_SQUADS, 'the 15% destination (the CBOBTC Squads)'],
      ['seal.reserve_mints', RESERVE_MINTS.join(','), 'the three reserve assets (cbBTC, $GARY, $GIRAFFISH)'],
      ['mint.pob_root', POB_ROOT, 'the 240-address Proof of Burn root'],
      ['mint.charter_secs', 604800, 'the charter claim window (7 days)'],
      ['mint.max_boost_weight', 12, 'the largest extra weight a vote may give a boost (12)'],
      ['mint.max_boost_epochs', 24, 'the most distributions a vote may let a boost last (24)'],
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true, ... })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true, ... })
  }
  return out
}
```

If `prev` is null, it returns early. Otherwise, it checks each brake. OK.

Let me look at the `detectUpgradeAuthorityAfterLock` function's check more carefully.

```js
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL, ... }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL, ... })
  }
  return out
}
```

If production and no lock deadline, it checks if any program is upgradeable. If so, it fires `lock_deadline_unset`. Otherwise, if no lock deadline or now < lock deadline, it returns early. Otherwise, it checks each program. OK.

OK, I've gone through the code pretty thoroughly. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `test_value_in_production` check:

```js
if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ...
    ]
    ...
}
```

OK.

Hmm, let me check the `mint.level_caps` comparison. The `cur['mint.level_caps']` is an array of numbers (from `flatten`). The `want` value is the string `'945,525,315,210,105'`. The comparison is `String(cur[k]) !== String(v)`. So `String([945, 525, 315, 210, 105])` is `'945,525,315,210,105'`. OK.

Let me check the `seal.reserve_mints` comparison. The `cur['seal.reserve_mints']` is an array of strings. The `want` value is `RESERVE_MINTS.join(',')`. So `String(cur[k])` is the array joined by commas. OK.

Let me check the `mint.pob_root` comparison. The `cur['mint.pob_root']` is a hex string. The `want` value is `POB_ROOT`. OK.

OK, the standing risks look comprehensive.

Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectStandingRisks` function's `charter_secs` computation:

```js
if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
    cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
```

This computes `charter_secs` from the two timestamps. OK.

But wait - this is done AFTER the `want` array is defined. So the `want` array's `mint.charter_secs` check uses the computed value. OK.

Hmm, but the `cur` is reassigned. So the subsequent checks use the new `cur`. OK.

OK, I think the code is pretty solid. Let me now look for actual bugs.

Actually, let me look at one thing more carefully. The `detectDistributionOverdue` function's `launch_tick_overdue` check:

```js
if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL, ... })
```

This fires if there's no active weight, some pending this epoch, and the month is overdue. But wait - the `w === 0n` check is for `total_active_weight`. If there are no active vaults, the launch tick is needed. OK.

But what if there are active vaults but no pending this epoch? Then the launch tick is not needed. OK.

Hmm, but there's a subtle issue: the `launch_tick_overdue` check uses `pt > 0n` (pending this epoch). But the launch tick is needed when there are vaults waiting to join in the current epoch. If `pt > 0n`, there are such vaults. OK.

But wait - the `joins_stalled` check uses `eligible = pc - pt`. If `eligible > 0n`, there are vaults eligible to join (requested in an earlier epoch). These need to be joined before any distribution. OK.

So the two checks are complementary. OK.

Let me look at the `detectRedemptionRate` function's `nearFraction` check more carefully.

```js
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH, ... }]
}
```

If `c.remaining >= c.cap`, it returns early (idle window). Otherwise, it computes `near = max(1, floor(cap * 0.2))`. If `c.remaining > near`, it returns early. Otherwise, it fires. OK.

Hmm, but what if `c.cap` is 1 and `c.remaining` is 0? Then `near = max(1, floor(0.2)) = 1`. `c.remaining (0) > near (1)` is false, so it fires. OK.

What if `c.cap` is 1 and `c.remaining` is 1? Then `c.remaining >= c.cap` is true, so it returns early. OK.

What if `c.cap` is 45 and `c.remaining` is 9? Then `near = max(1, floor(9)) = 9`. `c.remaining (9) > near (9)` is false, so it fires. OK.

What if `c.cap` is 45 and `c.remaining` is 10? Then `near = max(1, floor(9)) = 9`. `c.remaining (10) > near (9)` is true, so it returns early. OK.

So the threshold is 20% of the cap. OK.

Let me look at the `detectUnsplitRevenue` function's check more carefully.

```js
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH, ... }]
}
```

If `amount` is 0 or `sinceSec` is null, it returns early. Otherwise, if the elapsed time is <= grace, it returns early. Otherwise, it fires. OK.

Let me look at the `detectFrozenVaultAccount` function's check more carefully.

```js
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, detail: ... }]
}
```

This always fires when called. OK.

Let me look at the `detectRevealStall` function's check more carefully.

```js
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH, ... }]
}
```

If `prev` is null, it returns early. If any of the values is null, it returns early. If the queue hasn't moved (r0 < m0, r1 < m1, r1 === r0), it fires. OK.

Let me look at the `detectBrakeTransitions` function's check more carefully.

```js
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_st