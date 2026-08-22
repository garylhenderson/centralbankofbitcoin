[reasoning only]
Let me work through this carefully. Round 12. The instructions are clear: hunt the newest code first — `bank/spl.mjs`, `bank/sigwalk.mjs`, `bank/lock.mjs`, the round-11 repairs, and the test suite itself which is newly shown.

Let me go through systematically.

**1. `bank/spl.mjs` — the new token reader.**

```js
export function readTokenAccount(info) {
  if (!info) return { state: 'absent', amount: 0n }
  if (String(info.owner) !== TOKEN_PROGRAM_ID) return { state: 'foreign', amount: 0n }
  if (!info.data || info.data.length < MIN_TOKEN_ACCOUNT_LEN) return { state: 'malformed', amount: 0n }
  return { state: 'ok', amount: info.data.readBigUInt64LE(64) }
}
```

`String(info.owner)` — `info.owner` from web3.js `getAccountInfo` is a `PublicKey`. `String(publicKey)` calls `toBase58()`. OK. But in `alarm.mjs` reconcile: `readTokenAccount(account)` where `account` comes from `getTokenAccountsByOwner` — those accounts are already filtered by programId, and `account.owner`... Actually `getTokenAccountsByOwner` returns `{ pubkey, account }` where account is `AccountInfo<Buffer>`, and `account.owner` is a PublicKey. OK.

Wait — in `alarm.mjs` main loop: `readTokenAccount(info)` where `info` is from `conn.getAccountInfo(a, 'confirmed')`. If the account doesn't exist, `info` is `null` → 'absent' → `String(0n)` = '0'. Hmm, wait: `const bal = String(readTokenAccount(info).amount)` — for absent, amount is 0n, so bal = '0'. That's the intended "genuine zero" behavior. But what about 'foreign' or 'malformed' states in the alarm's activation loop? They also return amount 0n → bal = '0' → the vault reads as deactivated (if it was active) or inactive. A poisoned vault ATA (0-data account at the derived ATA) would read as balance 0 in the alarm — is that handled? In `distribute.mjs` the poisoned ATA is reported per-vault. In `alarm.mjs`, a malformed/foreign account at the vault's cbBTC ATA reads as '0' silently. Actually wait — the alarm's activation loop doesn't check `.state` at all! It just reads `.amount`. So a poisoned ATA (1-lamport system account) reads as balance 0 → if the vault was activated, `detectDeactivations` fires a HIGH 'deactivated' — a false alarm, but loud not silent. If the vault was not activated, nothing. Hmm, but the round-11 fix was supposed to make the alarm distinguish. The alarm guards were `data.length >= 72` before; now `readTokenAccount` returns the state but the alarm's activation loop ignores the state. Let me re-read:

```js
const info = await conn.getAccountInfo(a, 'confirmed')
const bal = String(readTokenAccount(info).amount)
balances[v] = bal
activation[v] = BigInt(bal) >= D.ACTIVATION_SATS
```

Yes — state is ignored. A foreign/malformed account reads as 0. For a vault holding 1 BTC whose ATA is somehow... well, the ATA can't become foreign or malformed once created (it's a real token account). The poisoning scenario is: vault has NO ATA, attacker sends 1 lamport to the derived address. Then the account exists, system-owned, 0 data → 'foreign' → amount 0n → bal '0'. Same as absent. So the alarm treats poisoned as zero, which is the same as absent. Not a false alarm generator beyond what absent does. OK, acceptable-ish. But the distribute.mjs side handles poisoned explicitly. Fine.

Now `requireTokenAmount` — used in revenue.mjs for the operator ATA and distributor ATA in distribute.mjs. Throws on absent/foreign/malformed. Good.

`isProvablyEmpty` — used in revenue.mjs splitByOther catch. Requires state 'ok' and amount 0n. 

**Attack on the emptiness proof** (the prompt says "Attack that proof"): `split_revenue` moves the ENTIRE balance of the revenue ATA. The proof: revenue ATA readable, Tokenkeg-owned, zero balance ⇒ a split happened. Can an attacker manufacture emptiness without a split? The revenue ATA is owned by the revenue PDA. Only `split_revenue` can move tokens out (the PDA signs only via MINT program). Could the ATA be closed? CloseAccount requires the owner's signature — the revenue PDA — only via MINT program instructions; MINT has no close instruction. Could the ATA be frozen by the cbBTC freeze authority? Frozen doesn't zero the balance. Could the cbBTC mint authority burn? No — SPL Token has no burn-by-authority; burn requires the account owner. So emptiness ⇒ split happened. But wait: what if the revenue ATA never had anything because the swap returned cbBTC to a DIFFERENT account? Step 3 returns to `revAta` derived with `getAssociatedTokenAddressSync(CBBTC, REVENUE, true)`. The split catch fires only if our split_revenue call failed. If our split failed for a reason OTHER than NothingToSplit — e.g., the holders ATA doesn't exist (we do create them idempotently in the same tx, so they exist), or a frozen destination ATA (cbBTC freeze authority froze the distributor's ATA!) — then split_revenue fails with a token program error, the revenue ATA still holds the cbBTC... `isProvablyEmpty` returns false → rethrow. Good.

But here's a subtle one: **the catch fires on ANY error, and if the revenue ATA is empty for the legitimate reason that the RETURN transfer hasn't landed yet**... no, return happens before split in sequence.

What about: our split transaction fails because of a confirmation timeout (unconfirmed, may have landed). The catch checks `isProvablyEmpty`. If the split actually landed, the ATA is empty → `splitByOther = true`. That's correct-ish (split happened, by us, but we record "by other" — the cycle closes; the splitSig is lost but the money moved correctly). Acceptable.

If the split did NOT land (timeout, never made it), the ATA still holds the returned cbBTC → not empty → rethrow. Good.

BUT: what if the return transfer itself returned 0 delta... no, delta must be ≥ minOut.

Hmm, what about this: **the revenue ATA could be empty because the cbBTC was never returned there** — if step 3's return transfer sent the tokens somewhere else? No, it's constructed explicitly.

What about a genuinely empty split: `split_revenue` requires `total > 0`. If the return was, say, exactly the amount and someone front-ran the split — fine, that's the designed case.

One more: the catch checks emptiness of `revAta` — but `revAta` is derived with `allowOwnerOffCurve = true`. Correct.

OK the emptiness proof seems sound. But note: **the split catch swallows the error and returns undefined even when the split failed for a transient reason AND the ATA happens to be empty because the split DID land via our own transaction**. Fine.

Now — a real issue: `cycle.splitSig = await sendAndConfirmTransaction(...).catch(...)`. If the catch returns undefined (splitByOther case), `cycle.splitSig = undefined`. Then `cycle.finishedAt` is set. `cycleIsOpen` checks `!(c?.splitSig || c?.splitByOther)` → splitByOther true → closed. Good.

**2. `bank/sigwalk.mjs`.**

```js
export async function signaturesSince(conn, address, until, maxPages = 20, limit = 1000) {
  const out = []
  let before
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

Issue: when `until` is provided and the sentinel is reached mid-page, the RPC returns results up to `until` — the batch may be exactly `limit` long even though the sentinel was reached... Actually if `until` is found within the page, the returned batch ends at the sentinel (exclusive? `until` is exclusive — signatures newer than `until`). If the batch length < limit, we stop — correct. If batch length == limit exactly AND the last one is the one just newer than until, then next page with `before` = last sig and `until` = sentinel returns an empty array (or signatures between last and until — none) → batch.length 0 < limit → return gap false. OK.

Edge: `until` undefined and the address has exactly `limit * maxPages` signatures → gap true even though we got everything. Benign (reports a gap falsely — loud, not silent).

Edge: `batch.length === 0` on first page → `batch[batch.length-1]` undefined → but we return before that since 0 < limit. OK.

The probe asserts behavior against mainnet. Fine.

One thing: the alarm calls `walkSigs(conn, prog, cursors[id])` with default maxPages=20, limit=1000. 20,000 signatures per program per pass. Fine.

**3. `bank/lock.mjs`.**

```js
export function acquireLock(file, { staleMs = 6 * 3600_000, now = Date.now(), alive = pidAlive, _afterUnlink = null } = {}) {
```

Flow: try `wx` create → success. On EEXIST: read lock, parse. `age = now - Date.parse(held?.at || 0)`. If `held` is null (unparseable), `held?.at || 0` → `Date.parse(0)` → NaN? `Date.parse('0')`... `held?.at || 0` is `0` (number) → `Date.parse(0)` coerces 0 to "0" → NaN. So `Number.isFinite(age)` false → skip the "fresh" branch → proceed to alive check: `held?.pid` undefined → skip → break the lock. So an unparseable lock is treated as stale+gone and broken immediately regardless of age. Hmm — an unparseable lock file: who writes lock files? Only this module, atomically? No — `writeFileSync(file, payload, {flag:'wx'})` is NOT atomic: a crash mid-write leaves a partial JSON lock file. Then the next runner finds an unparseable lock and breaks it immediately — even if the original writer is alive and just started. But the original writer crashed mid-write (that's how it got partial) — is it alive? If the process crashed during writeFileSync, it's dead. Actually a partial write happens only if the process dies during the write syscall — extremely narrow, and the process is dead by definition. But there's another case: two runners, one creates the lock (alive, fresh), and... no, the file is written in one writeFileSync — partial only on crash. OK, marginal.

More important: **`now` is captured once at options default** — `{ now = Date.now() }` — fine for a single acquire.

**The stale-but-alive refusal and the outage question**: the prompt asks "does refusing to break a live holder create an outage nobody is paged about?" Look at `withLock` failure path in each caller: alarm.mjs catch → notifies via NOTIFY unless DRY. distribute.mjs catch → notifies unless DRY. revenue.mjs catch → notifies if LIVE. So an ELOCKED is paged. OK.

**`process.kill(pid, 0)` across reboot / recycled pid**: after a reboot, the lock file persists (it's on disk, e.g. /opt/cbob-vaults/bank/.distribute.lock), the pid may be recycled by an unrelated process → `alive(pid)` true → lock never broken → the job never runs again until a human intervenes. It IS paged (ELOCKED → notify). The prompt asks about this — it's a real operational hazard but it pages. Severity: LOW/MEDIUM. Also pid recycling: a stale lock from a dead runner whose pid got recycled by a long-lived process (e.g., a system service) → permanent refusal, paged every cron run. That's the designed trade ("an outage that pages is the correct trade"). Hmm, they explicitly stated this trade. But note: the lock payload includes `at` timestamp and the pid's START time could be checked via /proc to avoid pid-reuse confusion — not done. Worth a LOW.

**releaseLock read-then-unlink race**: 

```js
export function releaseLock(file, token) {
  let held = null
  try { held = JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (e) { return e.code === 'ENOENT' }
  if (!token || held?.token !== token) return false
  try { fs.unlinkSync(file) } catch { /* already gone */ }
  return true
}
```

Race: we read the lock (our token), then before unlink, another process breaks it (thinks we're dead — but we're alive, so `alive(ourPid)` is true → they won't break). Since breakers check liveness, and we're alive during release, nobody breaks between our read and unlink. Unless our pid... we're the current process, `process.kill(pid,0)` on ourselves always succeeds. So safe. But: what if the lock was ALREADY broken before our release (we were stalled > staleMs AND... no, break requires dead). Since break requires the holder dead, and the holder is us (alive by definition while releasing), the lock can't be broken out from under a live holder. The only way the token mismatches is if WE were dead... contradiction. So release is safe. Good design.

**The `_afterUnlink` test seam**: it's an option passed only by the selftest. In production, callers use `withLock(file, fn, { staleMs })` — `_afterUnlink` not set. Could an attacker set it? It's a code-level option, not env. Safe. But wait — `withLock` passes `opts` through to `acquireLock`: `acquireLock(file, opts)`. Callers pass `{ staleMs: ... }`. Fine.

**A subtle lock issue**: `acquireLock` computes `age = now - Date.parse(held?.at || 0)`. If `held.at` is in the FUTURE (clock skew, or a lock written with a future timestamp), age is negative → `age < staleMs` → refused as fresh. A lock with a far-future timestamp would block forever (until now catches up). Who writes `at`? `new Date(now).toISOString()` with `now = Date.now()`. System clock set forward then back → a lock stamped 2027 blocks until 2027. Edge case, LOW.

**Bigger lock issue — the `held` returned on the fresh-refusal path**: fine.

Now, **the real question for lock.mjs — is there a remaining hole?** Consider: runner A holds lock, alive, running long (20h payout). Runner B sees fresh-ish lock (< staleMs) → refused. After 20h, B sees stale lock, checks `alive(A.pid)` → A alive → refused with aliveHolder. Good. A finishes, releases by token. Good.

Crash case: A dies at hour 1. Lock is stale at hour 7 (staleMs 6h for... wait, distribute uses 20h, revenue 2h, alarm 2h, reconcile 6h). B at hour 3 (revenue, staleMs 2h): stale, dead → unlink, wx-create → wins. Good.

Race: B and C both see stale+dead. Both unlink (one succeeds, other gets ENOENT — caught). Both wx-create — one wins, other gets EEXIST → lostRace. Good.

**BUT**: there's a window — B unlinks, B is preempted, C unlinks (ENOENT, fine), C creates (wx) → C wins. B creates → EEXIST → lostRace. Good. What if B unlinks, C creates, C finishes and RELEASES (unlink), then B creates → B wins. Fine — serialized.

What about: B unlinks, B creates, B runs. C had unlinked earlier (before B's create)? Order: both unlink first, then both create. B: unlink ok. C: unlink ENOENT ok. C: create wx ok → C wins. B: create → EEXIST → lostRace. Fine.

The seam `_afterUnlink` is called AFTER unlink, BEFORE create — matches the race window. OK.

**4. Now the round-11 repairs in detectors.mjs / alarm.mjs.**

**`detectSplitClaims` — the splitByOther anchor.** N splitByOther cycles require N unclaimed splits in `seenSplits`. Attack: `seenSplits` accumulates over passes — `[...seenSplits, ...(prev?.seenSplits || [])]` — and is NEVER pruned ("NOT SLICED"). So unclaimed splits from ANY age accumulate. The `inWindow` filter applies to cycles (grace..horizon), but `unclaimed` counts ALL seen splits ever, including ancient ones. So: the operator (who writes the ledger) closes a cycle with `splitByOther: true` and no real split — the check passes as long as there's ANY old unclaimed split in seenSplits from history. Wait — but an old unclaimed split would itself have been... hmm, splits seen on chain that no cycle claims: every legitimate front-run split leaves one. Over a year, a few accumulate. Each one can anchor one fabricated splitByOther cycle. The operator key holder can fabricate cycles anyway (they write the ledger) — the point of the anchor is to catch the ledger lying. With N historical unclaimed splits, N fabricated cycles pass. But also: a fabricated splitByOther cycle means cbBTC returned and "split by someone else" — the money DID move to the pinned addresses if a split happened; if no split happened, the cbBTC sits in the revenue ATA and... `cycle_unsplit` doesn't fire (splitByOther closes it). So the operator could sweep SOL, NOT return cbBTC... no wait, returnedSats must be > 0 for the cycle to be open... Let me think about what a lying ledger achieves. The operator steals the swapped cbBTC (never returns it), writes returnedSats: '100', splitByOther: true. `cycleIsOpen` → closed. `detectUnreconciledRevenue`: returned > 0, splitByOther → no cycle_unsplit. Short-return check: returned vs quoted — operator writes returnedSats = quotedSats. `detectSplitClaims`: needs an unclaimed split in seenSplits — if any historical front-run split exists, it anchors. So the whole chain-derived verification of the return side can be defeated by the operator key holder IF there's a stale unclaimed split lying around. The fix: bound `unclaimed` to the same window. This is a real finding — MEDIUM/HIGH. Actually wait, let me double check `seenSplits` accumulation: `seenSplits: [...new Set([...seenSplits, ...(prev?.seenSplits || [])])]` — yes, grows forever, never pruned. And `detectSplitClaims` receives the full set. The `unclaimed` count includes splits from cycles past the horizon. So yes — stale splits anchor fresh lies. The round-11 fix ("N such cycles now require N splits on chain that no cycle claims") is defeated by history. Good finding: the anchor must count only splits inside the same grace..horizon window... but seenSplits entries have no timestamps! They're bare signature strings. So the detector CAN'T window them. The state would need to store {sig, blockTime}. That's the fix.

Hmm wait, but is this exploitable in practice? The attacker needs the operator key. The operator key is "THE ONE TRUSTED HOP". The detectors exist to catch the operator. With one historical front-run split (plausible — split_revenue is permissionless and the docs invite anyone to call it; actually the cron itself... no, the cron's splits are claimed. A front-run split happens when a stranger calls split_revenue — the design explicitly handles that case, so it's expected to occur eventually), the operator can close ONE fake cycle. Each fake cycle = up to 50 SOL worth of cbBTC. That's a real hole in the new repair. Severity HIGH (it's a detection gap on the trusted hop, not a direct theft path — the theft is by the trusted key, which is already trusted with 50 SOL/cycle; the detector is the control that bounds it).

Actually — wait. Even simpler: the operator can just... create a real split! The operator holds the key that receives swept SOL and returns cbBTC. The operator can call split_revenue themselves at any time (permissionless) on whatever is in the revenue ATA. Hmm, but that split moves real cbBTC to the right places. The fake cycle needs an UNCLAIMED split. The operator can manufacture one: send some cbBTC to the revenue ATA (their own), call split_revenue from a random key → that split is seen by the scan and unclaimed → anchors a fake cycle. Cost: a tiny amount of cbBTC. So the anchor is defeatable for the price of dust. The windowing fix + requiring the anchoring split to postdate the cycle's return would raise the bar. Honestly the deeper issue: `splitByOther` cycles are anchored by COUNT, not by correspondence. A count-based anchor with an unbounded accumulator is weak. I'll file this as HIGH with the concrete attack.

**`detectDistribution` — resolvedBy on all three sites.** Looks fine now. `paymentState` has resolvedBy above rejected. The loop in distribute.mjs skips 'resolved'. OK.

**WATCHED_KEYS / COLLECTION_KEYS.** `missingWatchedKeys` skips keys whose program has `_missing`. It also skips 'prog' and 'collection' prefixes. COLLECTION_KEYS are seal/mint/burn/gov.collection — covered. What else do standing checks read that isn't watched? `detectStandingRisks` reads: mint.split_bps ✓, mint.paused ✓, gov.min_voting_secs ✓, mint.pending_governance ✓, mint.pending_governance_at ✓, mint.max_sweep_lamports ✓, mint.sweep_cooldown_secs ✓, mint.governance_timelock_secs ✓, the rotation list (mint.pending_admin, mint.pending_operator, mint.pending_bank, seal.pending_bank, seal.pending_admin, burn.pending_bank, burn.pending_admin, gov.pending_admin) ✓ all in WATCHED_KEYS, COLLECTION_KEYS ✓. What about `mint.pending_operator_at`? In WATCHED_KEYS ✓. `gov.pending_admin_at` ✓. OK.

But wait — `readConfigs` produces `mint.pending_operator_at` at offset 481. MintConfig layout: ...pending_operator at 449..481, pending_operator_at at 481..489. Let me verify offsets against the struct. MintConfig fields: version(1)@8, admin@9..41, collection@41..73, bank@73..105, governance@105..137, treasury@137..169, round_id(u32)@169..173, opens_at(i64)@173..181, closes_at@181..189, price_lamports(u64)@189..197, cap(u32)@197..201, minted_this_round(u32)@201..205, minted_total(u64)@205..213, max_supply(u64)@213..221, bank_treasury@221..253, split_bps(u16)@253..255, paused(bool)@255..256, swap_operator@256..288, sol_reserve_lamports(u64)@288..296, bump(1)@296..297, max_sweep_lamports(u64)@297..305, sweep_cooldown_secs(i64)@305..313, last_sweep_at(i64)@313..321, pending_governance@321..353, pending_governance_at(i64)@353..361, governance_timelock_secs(i64)@361..369, pending_admin@369..401, pending_admin_at@401..409, pending_bank@409..441, pending_bank_at@441..449, pending_operator@449..481, pending_operator_at@481..489. Total 489 + 256 padding = 745 + 8 disc = ... The Initialize space: 8 + 1 + 32*5 + 4 + 8 + 8 + 8 + 4 + 4 + 8 + 8 + 32 + 2 + 1 + 32 + 8 + 1 + 8 + 8 + 8 + 32 + 8 + 8 + 32 + 8 + 32 + 8 + 32 + 8 + 256. Let me sum: 8+1=9; 32*5=160 → 169; +4=173; +8=181; +8=189; +8=197; +4=201; +4=205; +8=213; +8=221; +32=253; +2=255; +1=256; +32=288; +8=296; +1=297; +8=305; +8=313; +8=321; +32=353; +8=361; +8=369; +32=401; +8=409; +32=441; +8=449; +32=481; +8=489; +256=745. Struct size needed: 8 disc + 489 fields = 497. Allocated 745. 745 - 497 = 248... wait, padding should be 256. 489 + 256 = 745, plus 8 disc = 753? Let me recount. The space expression starts with 8 (disc) + 1 (version) + ... So total = 8 + field sizes + 256. Field sizes sum: 1+160+4+8+8+8+4+4+8+8+32+2+1+32+8+1+8+8+8+32+8+8+32+8+32+8+32+8 = let me add: 1+160=161; +4=165; +8=173; +8=181; +8=189; +4=193; +4=197; +8=205; +8=213; +32=245; +2=247; +1=248; +32=280; +8=288; +1=289; +8=297; +8=305; +8=313; +32=345; +8=353; +8=361; +32=393; +8=401; +32=433; +8=441; +32=473; +8=481. So fields = 481 bytes, +8 disc = 489, +256 padding = 745. And the space expression: 8 + 1 + 32*5 + 4 + 8 + 8 + 8 + 4 + 4 + 8 + 8 + 32 + 2 + 1 + 32 + 8 + 1 + 8 + 8 + 8 + 32 + 8 + 8 + 32 + 8 + 32 + 8 + 32 + 8 + 256. Count terms: 8, 1, 160, 4, 8, 8, 8, 4, 4, 8, 8, 32, 2, 1, 32, 8, 1, 8, 8, 8, 32, 8, 8, 32, 8, 32, 8, 32, 8, 256. Sum: 8+1=9; +160=169; +4=173; +8=181; +8=189; +8=197; +4=201; +4=205; +8=213; +8=221; +32=253; +2=255; +1=256; +32=288; +8=296; +1=297; +8=305; +8=313; +8=321; +32=353; +8=361; +8=369; +32=401; +8=409; +32=441; +8=449; +32=481; +8=489; +256=745. ✓ matches. Good — MINT padding correct.

SEAL: Config: version(1), admin(32), collection(32), bank(32), reserve_mints Vec<Pubkey> (4 + 32*8), bump(1), pending_bank(32), pending_bank_at(8), pending_admin(32), pending_admin_at(8). Wait — the struct declares bump LAST: `pub pending_admin_at: i64, pub bump: u8`. But the Initialize space: `8 + 1 + 32 + 32 + 32 + 4 + (32 * MAX_RESERVE_MINTS) + 1 + 32 + 8 + 32 + 8 + CONFIG_PADDING`. Order in the space calc: 8 disc, 1 version, 32 admin, 32 collection, 32 bank, 4+256 vec, 1 bump, 32 pending_bank, 8, 32 pending_admin, 8, 256 padding. Sum: 8+1+96+4+256+1+32+8+32+8+256 = 702. Struct actual size: 8 + 1+32+32+32+ (4+256) + 32+8+32+8 + 1 (bump at end) = 8+1+96+260+80+1 = 446. 446 + 256 = 702 ✓. But NOTE: the struct field ORDER is version, admin, collection, bank, reserve_mints, pending_bank, pending_bank_at, pending_admin, pending_admin_at, bump. Borsh serializes in declaration order. So bump sits at offset 8+1+96+260+80 = 445. The alarm reads seal.pending_* at `after = 109 + n*32` where n = vec length: 109 + 8*32 = 365 for full vec. pending_bank@365..397, pending_bank_at@397..405, pending_admin@405..437, pending_admin_at@437..445. ✓ matches the struct (109 = 8+1+32+32+32+4). Good. And the alarm's `if (d.length >= after + 80)` guard — with padding, d.length = 702, after+80 = 445 ≤ 702 ✓.

BURN: BurnConfig: version(1)@8, admin@9..41, collection@41..73, bank@73..105, bump@105, pending_bank@106..138, pending_bank_at@138..146, pending_admin@146..178, pending_admin_at@178..186. Space: 8 + 1 + 32*3 + 1 + 32 + 8 + 32 + 8 + 256 = 8+1+96+1+32+8+32+8+256 = 442. Struct: 8+1+96+1+80 = 186; +256 = 442 ✓. Alarm reads burn.pending_bank@106 ✓, pending_bank_at@138 ✓, pending_admin@146 ✓, pending_admin_at@178 ✓.

GOV: GovConfig: version(1)@8, admin@9..41, collection@41..73, quorum_bps(2)@73..75, threshold_bps(2)@75..77, min_voting_secs(8)@77..85, proposal_count(8)@85..93, bump(1)@93, last_executed_id(8)@94..102, pending_admin@102..134, pending_admin_at@134..142. Space: 8 + 1 + 32 + 32 + 2 + 2 + 8 + 8 + 1 + 8 + 32 + 8 + 256 = 8+1+64+4+8+8+1+8+32+8+256 = 398. Struct: 8+1+64+4+8+8+1+8+32+8 = 142; +256 = 398 ✓. Alarm: proposal_count@85 ✓, last_executed_id@94 ✓, pending_admin@102 ✓, pending_admin_at@134 ✓.

**BUT — the discriminator check in readConfigs.** `acctDisc(struct)` with struct names 'Config', 'MintConfig', 'BurnConfig', 'GovConfig'. SEAL's account struct is named `Config` → sha256("account:Config"). MINT's is `MintConfig` ✓. BURN's is `BurnConfig` ✓. GOV's is `GovConfig` ✓. And SEAL_CONFIG_DISC in MINT/BURN programs is [155, 12, 170, 224, 30, 250, 204, 130] — pinned constant, presumably sha256("account:Config")[..8]. Fine.

**Now — a KEY round-11 change: `readConfigs` verifies owner and discriminator. What happens when the check fails?** It sets `snap['mint._wrong_discriminator']` and returns — producing NO other mint keys. Then `missingWatchedKeys(snap)` throws because all mint.* keys are missing... wait: `missingWatchedKeys` skips programs with `_missing` set, but `_wrong_discriminator` is not `_missing`. So it throws "readConfigs does not produce mint.admin...". The alarm's main() → the throw propagates to withLock catch → "CBOB VAULT ALARM FAILED TO RUN" → notify. Loud. Good. But hmm — `_wrong_owner`/`_wrong_discriminator`/`_malformed` keys are set in the snap but nothing reports them as findings; the throw covers it. OK.

**Now the alarm idle branch** — fixed to report first then write state, and not under DRY. Looks right: `const idleDelivered = report(...) && !DRY; if (idleDelivered) writeState(...)`. But note: the EVER marker is NOT stamped in the idle branch... Actually the EVER stamp happens later in main() — `if (!DRY) { try { fs.writeFileSync(EVER, started) } catch {} }` — which is AFTER the idle branch returns. Wait, no: the idle branch `return idleDelivered` happens BEFORE the EVER stamp line? Let me re-read main():

```js
const collection = cfg['mint.collection']
if (!collection || cfg['mint._missing']) {
  if (prev?.config?.['mint.collection']) { ... return report(findings, looked, cfg, false) }
  console.log('mint config not initialised — nothing to watch yet')
  const idleDelivered = report(findings, looked, cfg, true) && !DRY
  if (idleDelivered) { writeState({...}) }
  return idleDelivered
}
```

The EVER stamp is further down: after the scan, `if (!DRY) { try { fs.writeFileSync(EVER, started) } catch {} }`. So on the idle path, EVER is never stamped. Then a later REAL run (after deployment) with prev state existing... the has-run check: `if (!prev && fs.existsSync(EVER) && !ARGS.has('--first-run'))`. If the pipeline only ever ran idle passes, prev exists (state written), so the check passes fine. If state.json is deleted after idle runs, EVER doesn't exist → reads as first run → re-baselines silently. Minor: the marker's purpose is to catch deleted state; idle passes don't stamp it. Edge case, LOW. Actually wait — the round-11 fix list says "The alarm's idle branch wrote state BEFORE reporting and ignored --dry-run" — fixed. The EVER stamp omission on the idle path is a small residual gap. LOW.

**`detectDeferredSweeps` delivery-failure carry** — fixed: `next.deferredSweeps = [...(prev?.deferredSweeps || []), ...deferredSweeps]` deduped by sig. But note: on delivery failure, `next.deferredSweeps` keeps prev + new deferred — but drops nothing that was reported... it keeps everything, so reported-but-undelivered sweeps are re-judged next pass. Good. But on SUCCESS, `deferredSweeps: dsw.keep` — keep drops reported ones. Good.

Hmm wait, one thing in the success path: `dsw.keep` — sweeps still fresh. And `deferredSweeps` (newly deferred this pass) are included in the input to detectDeferredSweeps: `D.detectDeferredSweeps([...(prev?.deferredSweeps || []), ...deferredSweeps], led)`. Good.

**`--dry-run` has-run marker** — `if (!DRY)` guards the EVER stamp. And writeState guarded by `if (!DRY) writeState(next)`. Good.

**Split-signature reuse across the whole ledger** — `claimed` set built from ALL cycles regardless of age ✓.

**`detectDistribution` refused-vs-unconfirmed** — `unresolved` excludes `r.rejected` ✓, `refused` separate ✓.

**Hardcoded Core sha** ✓ in both scripts.

**20-hour payout lock vs 24-hour cadence** — distribute cron at 9:07 daily; staleMs 20h. A run that crashes at hour 19 leaves the lock; next day's cron at hour 24 breaks it (stale, holder dead) → runs. Good. A run still alive at hour 20+ → next cron refuses (aliveHolder) → pages. OK.

**Absent-ATA-is-a-fault** — distribute uses requireTokenAmount for the distributor ATA ✓.

**resolvedBy as attacker-reachable silencing**: who can write `resolvedBy` into distributions.json? Someone with write access to the file — same user as the signing keys. The ledger is the audited key's own testimony... for the DISTRIBUTOR key. A compromised distributor key holder can edit the ledger directly anyway (it's the same uid). resolvedBy doesn't lower the bar. OK.

**Selftest assertion floors** — selftest.mjs FLOOR 170, distribute FLOOR 17. Count distribute selftest assertions: t() calls... 10 allocate + 8 paymentState = 18? Let me count: 'pays only vaults...', 'splits equally', 'exactly 21,000', '20,999 does not', 'skips when nothing activated', 'skips when no cbBTC', 'skips rather than dust', 'never over-distributes', 'remainder kept', 'order deterministic' = 10; paymentState: 'paid', 'unpaid', 'ambiguous', '...timeout', 'refused→unpaid', 'resolved', 'resolved refusal' = 7. Total 17. FLOOR = 17. OK exactly at floor — if one is added later, floor must move; fine.

selftest.mjs FLOOR 170 — count is large; trust it.

**Now the test suite (tests/3prog.test.ts) — newly shown, read adversarially.**

Key things to check:

1. **`because()` coverage** — now covers 3.1, 3.3, 3.6, 3.7, 4.1, 4.4, 5.1, 8.12. Check 3.7: 'custom program error: 0x9' — Core error 9. The bare Execute test: `send([...sweep(V,SATS,0)],[bank,alice])`. sweep builds an `execute` via umi with authority aliceU. Signers: bank (fee payer) and alice. The comment says the earlier version passed for the wrong reason (missing bank signature). Now signed by [bank, alice]. The Execute should be refused by Core with 0x9 (plugin validation failure). OK.

But wait — 3.7 runs AFTER 3.6 (open with no close rejected) and after 3.2 (successful open+close). After 3.2, the vault was opened and closed — `mark_opened` stamped redemption:opened, and the vault is re-frozen. 3.7's bare execute should be refused because frozen. ✓.

2. **Test 6.20e/6.20f offsets**: pending_operator at 449 ✓ (matches layout above).

3. **7.2b**: pending_governance at 321..353 ✓. **7.2n**: pending_admin at 369..401 ✓. **effectiveAt** read at offset 353 (pending_governance_at) ✓.

4. **nextProp reads proposal_count at offset 85** ✓ (GOV layout).

5. **The suite's `wiring()` helper** — field order: bank, governance, treasury, admin, max_supply, bank_treasury, split_bps, swap_operator, sol_reserve, max_sweep, sweep_cooldown, gov_timelock. Matches `update_wiring` signature order: bank, governance, treasury, admin, max_supply, bank_treasury, split_bps, swap_operator, sol_reserve_lamports, max_sweep_lamports, sweep_cooldown_secs, governance_timelock_secs ✓.

6. **6.20g 'admin ALONE tightens the cap BELOW the working floor' expects REJECT with TreasuryNeedsGovernance.** Program: `max_sweep_lamports.map_or(false, |x| x > c.max_sweep_lamports || x < MIN_ADMIN_SWEEP_LAMPORTS)` → 500_000 < 1 SOL → needs_governance → governance account not provided → error TreasuryNeedsGovernance ✓. But wait — `UpdateWiring` has `governance: Option<Signer>`; the test's adminOnly passes MINT_PROG as the third key... look: adminOnly keys: MINT_CFG, bank, MINT_PROG. The third account is `governance: Option<Signer>` — they pass MINT_PROG as a non-signer placeholder. When needs_governance is true, `ctx.accounts.governance.as_ref().ok_or(...)` — Some(MINT_PROG) → `require_keys_eq!(gov.key(), c.governance, ...)` → MINT_PROG != gov → TreasuryNeedsGovernance ✓. When needs_governance false, the placeholder is ignored ✓. OK.

Hmm wait — actually for `adminOnly({maxSweep:...})` where tightening within range: needs_governance false → governance ignored ✓.

7. **6.20i: 'even GOVERNANCE cannot raise the cap past 50 SOL'** — govWiring({maxSweep: 51 SOL}): needs_governance (x > current) → gov signs ✓ → then `require!(x > 0 && x <= MAX_SWEEP_LAMPORTS, BadSweepBound)` → 51 > 50 → BadSweepBound ✓.

8. **The 6.23 sequence**: apply operator rotation after waiting GOV_TIMELOCK+2 seconds. But 6.23a raised gov timelock to GOV_TIMELOCK*2 = 120s AFTER the operator rotation was armed at 60s... wait, order: 6.20 arms operator rotation with `c.governance_timelock_secs` = 60 at that time. Then 6.23 waits 62s, applies. THEN 6.23a raises timelock to 120. Then "put it back": `adminOnly({swapOperator: swapOp.publicKey})` arms a rotation back — now with timelock 120s → waits (GOV_TIMELOCK+2)*1000 = 62s — NOT ENOUGH! The re-arm uses the CURRENT timelock (120s), but the wait is only 62s!

Let me re-read:

```js
await send([adminOnly({swapOperator:swapOp.publicKey})],[bank])
await new Promise(r=>setTimeout(r,(GOV_TIMELOCK+2)*1000))
await send([...apply_pending_operator...],[bank])
```

GOV_TIMELOCK = 60. After 6.23a, governance_timelock_secs = 120. The re-arm sets pending_operator_at = now + 120. The wait is 62s. apply_pending_operator requires now >= pending_operator_at → 62 < 120 → REJECT with GovernanceTimelockActive. And this `send` is NOT wrapped in `att` — it's a raw await send → throws → main().catch → FATAL → exit 2. The suite would FAIL... unless 6.23a's tlUp happened AFTER the re-arm. Order in the file: 6.23 (apply op rotation), 6.23f, 6.23g, then "put it back for the rest of the suite" (arm + wait 62s + apply), THEN 6.23a (raise timelock to 120). Let me re-read the actual order:

```js
const applyOp=...rec('6.23',...)
const oldOpSweep=...rec('6.23f',...)
await new Promise(r=>setTimeout(r,2500))
const newOpSweep=...rec('6.23g',...)
// put it back for the rest of the suite
await send([adminOnly({swapOperator:swapOp.publicKey})],[bank])
await new Promise(r=>setTimeout(r,(GOV_TIMELOCK+2)*1000))
await send([...apply_pending_operator...],[bank])

// The notice period on a governance rotation RATCHETS UP...
const tlUp=await att(()=>send([govWiring({govTimelock:GOV_TIMELOCK*2})],[bank,gov]))
rec('6.23a',...)
```

So the put-back happens BEFORE 6.23a raises the timelock. At put-back time, timelock is still 60. Wait 62s → apply succeeds. THEN tlUp raises to 120. OK — no bug. But wait: 6.23 armed the FIRST rotation at armedOpAt with timelock 60, waited 62s — but between arming and applying, did anything raise the timelock? 6.20 armed at timelock 60 (initial GOV_TIMELOCK). ✓. And the apply at 6.23: `now >= pending_operator_at` where pending_operator_at = arm time + 60. Wait is 62s. ✓.

Hmm, but there's a subtlety: `pending_operator_at` is computed from the Clock (validator time), while the test waits on wall-clock `Date.now()`. Validator time ≈ wall clock on a local validator. OK.

9. **7.2g arms governance rotation to GOV_PDA; effectiveAt read from chain at offset 353** — pending_governance_at. But WAIT: 6.23a raised governance_timelock_secs to 120 BEFORE section 7. So the arm at 7.2g sets effective = now + 120. The suite waits `while(Math.floor(Date.now()/1000) <= effectiveAt+1)`. ✓ reads the real deadline. Good — that was the fix mentioned ("Read the DEADLINE the program actually wrote").

10. **7.13b: 'execute under a quorum lowered AFTER the votes were cast' expects REJECT QuorumNotMet.** Proposal idP6 opened at quorum 100% (10_000). One vote cast (A by carol). Divisor = max(quorum_supply, minted_now). quorum_supply at creation = minted_total then; minted_now same (no mints since). need = ceil(supply * 10000/10000) = supply. cast = 1 < supply → QuorumNotMet ✓.

11. **7.13c: floor-quorum proposal with ZERO votes** — idP8 opened at quorum 500, no votes. cast = 0 → `require!(cast > 0)` → QuorumNotMet ✓.

12. **7.14 executes P1** — P1 has votes: A (yes, by alice), B (yes, by alice)... wait, A was transferred to carol. Votes on P1: v1 (A, alice, yes), v4 (B, alice, yes). cast = 2. Quorum at snapshot 3000 bps. Divisor = max(quorum_supply at P1 creation, minted_now). How many vaults minted by then? V, H(burned — minted_total doesn't decrement), N, P, A, B = 6 mints (V, H, N, P, A, B). Plus any others? mkVault calls: V, H, N, P, A, B → 6. Also the BRICK attempt (rejected, no mint), SLIP (rejected). So minted_total = 6. quorum_supply at P1 creation = 6. need = ceil(6*3000/10000) = ceil(1.8) = 2. cast = 2 ✓. yes_bps = 10000 ≥ threshold 6000 ✓. Executes ✓.

13. **7.25/7.26**: idP4, idP5 each got 2 votes (A by carol, B by alice). Execute newer (idP5) first → OK; then idP4 → ProposalSuperseded ✓. But wait — 7.14 executed P1 (id=1). last_executed_id = 1. idP4 and idP5 are ids 4 and 5 (P3 = 3). Execute idP5 (5 > 1 ✓) → last_executed_id = 5. Then idP4 (4 < 5) → ProposalSuperseded ✓. And P3 (id 3) — 7.13a tried to execute it BEFORE 7.14 (rejected RoundAlreadyOver) ✓.

Hmm wait — 7.13a executes P3 which is ratified (2 votes) but its round already closed. Rejected RoundAlreadyOver ✓. But note the ORDER: `require!(proposal.closes_at > now, RoundAlreadyOver)` comes BEFORE the quorum checks? Let me check execute_proposal order: VotingOpen check, AlreadyExecuted, ProposalExpired, RoundAlreadyOver, then read_mint_config, then quorum... Yes RoundAlreadyOver is 4th. ✓ because('7.13a','RoundAlreadyOver').

14. **8.12 pause test**: `pausedErr` extraction — `(e?.logs||[]).find(x=>/Error Code/.test(x))` — mkVault throws raw (not via att). because('8.12','MintPaused') — the recorded `n` is pausedErr sliced to 110 chars. Does the log line contain 'MintPaused'? The log line is like "Program log: Error: MintPaused" or "Program log: AnchorError occurred. Error Code: MintPaused..." Hmm — Anchor error logs: "Program log: AnchorError thrown in programs/... Error Code: MintPaused. Error Number: 60xx." The find looks for /Error Code/ — the line contains "Error Code: MintPaused" → includes 'MintPaused' ✓. But slice(0,110) — could cut off before 'MintPaused' if the line is long. "Program log: AnchorError occurred. Error Code: MintPaused. Error Number: 6024. Error Message: minting is paused." — 'MintPaused' appears early ✓.

15. **The `att()` error extraction**: filters logs for /Error Code|custom program error|panicked/ and joins, else falls back to message, sliced to 220. For 7.7/7.9 'custom program error: 0x0' — the VoteRecord init fails with system program error "custom program error: 0x0" ✓.

16. **3.7 'custom program error: 0x9'** — Core's Execute refused by the freeze plugin. Core error 9 = InvalidAuthority? Actually the round notes say Core 0x9. Trust it.

17. **A test that MINTS has side effects** — noted: 3.6/3.7 reuse V. ✓ no extra mints. Total mints: V, H, N, P, A, B = 6. Governance quorum math depends on it. ✓.

18. **6.32** — real jsonParsed approve carries info.owner ✓ measured.

19. **What does the suite NOT test that it claims?** The header says "200-assertion suite". run-tests.sh floor is 160. Fine.

Now — **is there an assertion that passes whether or not the thing is true?** Look at 2.3a: `a.permanentFreezeExecute?.frozen===true` — real check. 6.27: `r?.basisPoints ?? 'none'` — real. 6.33a/b read SEAL config at computed offsets — real.

Check 6.20e: reads MINT_CFG offset 256..288 = swap_operator ✓ unchanged after arming ✓.

**Potential issue in the suite: 8.10b 'a stranger PAYS while the operator signs'** — `ixSweep(1_000_000n, alice)` with signers [alice, swapOp]. ixSweep keys: MINT_CFG, REVENUE, dest=swapOp (signer writable), SystemProgram. Wait — `ixSweep=(amt,_s?,dest=swapOp.publicKey)` — the `_s` param is unused; dest defaults to swapOp. Keys: dest isSigner:true. Alice is the fee payer (first signer in send). The program requires swap_operator to sign ✓ and amount ≤ cap ✓ and cooldown elapsed (2.5s wait, cooldown 1s) ✓ and reserve: REVENUE was topped up 1_000_000 lamports after 8.8 swept to the reserve. bal = reserve + 1_000_000. keep = 0.05 SOL. amount 1_000_000. bal >= keep + amount → reserve + 1M >= 0.05SOL + 1M → reserve >= 0.05 SOL ✓ (8.8 swept down to exactly the reserve... `safe = revSol - 0.05 SOL`, swept safe → balance = 0.05 SOL exactly). ✓ then +1M top-up → sweep 1M leaves 0.05 SOL ✓.

20. **Section 6b ordering issue**: 6.16 'sweep exactly the cap' ALLOW — cap was lowered to 1_000_000 (6.14), sweep 1_000_000 ✓. But cooldown: SWEEP_COOLDOWN = 1 at init. 6.16 sweeps at time T. 6.17 immediately attempts 3 sweeps in one tx — first one would be `now >= last_sweep_at + 1`. If the block timestamp advanced ≥1s, the FIRST sweep in loop3 succeeds, second fails SweepTooSoon → tx reverts → REJECT ✓ because SweepTooSoon ✓. If timestamp hasn't advanced (same second), first fails too — still SweepTooSoon ✓. Either way the error is SweepTooSoon ✓.

6.19b: after 6.18 raised cooldown to 3600, a sweep → SweepTooSoon ✓ (last sweep was 6.16's... wait, 6.17 reverted so last_sweep_at is from 6.16). Then `await send([govWiring({sweepCooldown:SWEEP_COOLDOWN,maxSweep:SWEEP_CAP})],[bank,gov])` resets.

Hmm — 6.18 raised cooldown to 3600 via govWiring — needs_governance? `sweep_cooldown_secs.map_or(false, |x| x < c.sweep_cooldown_secs || x > MAX_ADMIN_SWEEP_COOLDOWN_SECS)` — 3600 > current (1) → not < current, not > 24h → needs_governance FALSE → admin alone could do it. But govWiring passes gov as signer anyway — harmless (extra signer). ✓. 6.18a set cooldown 0 → BadSweepBound (range check 1..=7days) ✓.

21. **6.20a 'admin ALONE tightens the sweep cap, within the working range'** — maxSweep 2 SOL. Current cap after the reset = SWEEP_CAP = 50 SOL. 2 SOL < 50 → tightening; 2 SOL ≥ MIN_ADMIN_SWEEP_LAMPORTS (1 SOL) → needs_governance false → ALLOW ✓.

Then 6.20g (500_000 < 1 SOL floor) → needs_governance → REJECT ✓. 6.20h cooldown 7 days > 24h → needs_governance → REJECT ✓. 6.20b loosen back to 50 SOL: current is 2 SOL → x > current → needs_governance → REJECT ✓. 6.20c lengthen cooldown to 600: current 1 → 600 > 1, ≤ 24h → admin OK → ALLOW ✓. 6.20d shorten to 1: x < current → needs_governance → REJECT ✓. Then govWiring resets cooldown to 1 (with gov sig) ✓. 6.21 treasury alice admin-only → needs_governance → REJECT ✓. `await send([govWiring({maxSweep:SWEEP_CAP})],[bank,gov])` — restore cap to 50 with gov ✓.

22. **6.22 'sweep to the PENDING operator before the notice period'** — sweepTo(1M, newOp) signed by [alice, newOp]. Program requires swap_operator == cfg.swap_operator (still swapOp) → WrongTreasury ✓.

23. **Royalties 6.24**: 10_000 bps > MAX_ROYALTY_BPS 1000 → BadRoyalty ✓. 6.25 without gov: keys include alice as governance → constraint `governance.key() == config.governance` → TreasuryNeedsGovernance ✓.

24. **6.26 ADD royalties** — hand-built CPI: [IX_ADD_COLLECTION_PLUGIN_V1=3, PLUGIN_ROYALTIES=0, bps u16, 1u32 creators, revenue pubkey, 100, RULESET_NONE=0, 0 (Option None)]. Asserted Core decodes 500 ✓ measured working.

25. **6.31** opens_at=-1, closes_at=i64::MAX → checked_sub overflows → BadWindow ✓.

Now — **the suite's gaps**: what important property is NOT asserted?

- **No test that `split_revenue` rejects a WRONG mint or wrong ATAs** — 8.6 tests empty split. Not the pinned destinations. Hmm, the destinations are derived in-handler; a wrong-ATA test would be nice but the derivation is the enforcement.
- **No test of `apply_pending_bank` in MINT** — the bank rotation arm/apply is tested for SEAL (6.33) but MINT's apply_pending_bank is never exercised! Let me check... searching the suite for 'apply_pending_bank' — not present. MINT has apply_pending_bank, cancel_pending_bank — untested. Also `cancel_pending_operator` untested. And SEAL's apply_pending after the full notice (7 days — can't test, constant). GOV's apply_pending_admin/cancel_pending_admin — untested! GOV admin rotation: update_gov_config with admin param arms it; apply_pending_admin lands it. Not exercised in the suite. Hmm — the round-11 note says "the suite exercises the ARM, the REFUSAL and the CANCEL" for SEAL. For GOV's admin rotation: nothing. That's a gap worth noting — MEDIUM/LOW: an untested apply path is exactly the class they keep getting bitten by. Actually wait — GOV's apply_pending_admin: `require_keys_neq!(c.pending_admin, ...); require!(now >= c.pending_admin_at, BadWindow)`. Uses BadWindow error for timelock-active — cosmetic. The arm path: `update_gov_config` with `admin: Some(x)` — has_one = admin ✓. Untested but simple. LOW.

- **MINT's apply_pending_bank/cancel_pending_bank untested** — same shape as tested apply_pending_admin/operator. LOW.

**Now the programs — hunt for real defects.**

**MINT `update_wiring` — the `needs_governance` direction split.** Look carefully:

```rust
|| max_sweep_lamports.map_or(false, |x| x > c.max_sweep_lamports || x < MIN_ADMIN_SWEEP_LAMPORTS)
|| sweep_cooldown_secs.map_or(false, |x| x < c.sweep_cooldown_secs || x > MAX_ADMIN_SWEEP_COOLDOWN_SECS);
```

Admin alone can: lower cap to ≥ 1 SOL; raise cooldown to ≤ 24h. Governance needed: raise cap, lower cap below 1 SOL, lower cooldown, raise cooldown above 24h.

Wait — **admin alone can RAISE the cooldown to 24h**. Combined with pausing? set_paused stops sweeps entirely — admin already has that. So 24h cooldown is weaker than pause. OK.

**Admin alone can lower the cap to 1 SOL.** MIN_ADMIN_SWEEP_LAMPORTS = 1 SOL. The alarm's sweep_cap_wedged fires below 1 SOL. Consistent.

Hmm — but here's a thing: **admin can lower `max_sweep_lamports` to 1 SOL and raise cooldown to 24h simultaneously, repeatedly**... that's within the "working pipeline" envelope by definition. OK.

**`update_wiring` — `sol_reserve_lamports` needs governance ALWAYS** (`sol_reserve_lamports.is_some()` → needs_governance). Comment says who-gets-paid needs governance. Reserve is a safety param; making it governance-gated means in production (governance = GOV PDA which can only sign set_round) the reserve is UNCHANGEABLE. Same for treasury, bank_treasury, split_bps, governance_timelock_secs. That's the documented trade (7.18 asserts it). OK.

**`governance_timelock_secs` ratchet**: `require!(x >= c.governance_timelock_secs && x <= MAX_GOVERNANCE_TIMELOCK_SECS)` and it's in needs_governance list → in production, unreachable. Documented.

**Now — a REAL issue: `apply_pending_operator` etc. use `ApplyPendingGovernance` context which has NO admin check — permissionless by design. Fine.**

**MINT initialize: `require!(max_sweep_lamports > 0 && <= MAX_SWEEP_LAMPORTS)` ✓; cooldown range ✓; reserve ✓; timelock range ✓.**

**`sweep_sol_for_swap`**: paused ✓, amount > 0 ✓, operator key match ✓, cap ✓, cooldown ✓, revenue PDA ✓, reserve ✓. `emit!(SolSweptForSwap { amount, operator, remaining: bal - amount })` — bal - amount can't underflow (bal >= keep + amount). ✓.

**`split_revenue`**: pins revenue PDA, ATAs derived from config.treasury/bank_treasury and the mint passed in. **The mint is caller-supplied** — by design (any token). The ATAs are derived for THAT mint. total read from revenue_ata data[64..72] — but does it verify revenue_ata is a real token account owned by Tokenkeg? It checks the ADDRESS is the derived ATA ✓. A derived ATA for (revenue, Tokenkeg, mint) — if it doesn't exist, the address can't be faked with a non-token account... actually anyone can send lamports to that address creating a 0-data system account! Then `d.len() >= 72` fails → WrongTreasury error. If d.len() >= 72 but it's not a token account — can a non-token program create an account at that address with ≥72 bytes? Only the system program (transfer → 0 data) or a program that owns it via createAccount — createAccount requires the new account to sign... PDA can't sign for arbitrary programs. ATA address is a PDA of the ATA program; only the ATA program can create it (via create). So the account at that address is either absent, a 0-data system account (lamports sent), or a real ATA. ✓ safe.

The transfer CPI: `invoke_signed` with revenue PDA as owner ✓. token_program pinned to SPL_TOKEN_ID ✓. decimals passed by caller — TransferChecked verifies decimals against the mint ✓.

Rounding: bank_cut = total * (10000 - split_bps) / 10000 (floored), holders = total - bank_cut ✓.

**`mint_vault`**: checks ✓. The CreateV2 CPI — plugins: PermanentFreezeExecute frozen=1 authority=seal_pda; Attributes with authority seal_pda. Wait — the Attributes plugin authority is the SEAL PDA: `data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend_from_slice(seal_pda.as_ref())` — that's for the freeze plugin. For attributes: after the attribute list, `data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend_from_slice(seal_pda.as_ref())` ✓. Then `data.push(1); data.extend_from_slice(&0u32.to_le_bytes())` — that's... the outer plugins Vec end? CreateV2 data layout: [20, 0 (DataState?), name, uri, 1 (Some plugins), 2u32 count, plugin1..., plugin2..., then 1 + 0u32 = ?]. This is the "1" for Some(...) and 0u32 for an empty vec — probably the `external_plugin_adapters` or remaining option. It works against real Core (suite passes). ✓.

**SEAL `open_for_redemption`**: introspection requires a later close_redemption with account 0 = asset and account 2 = owner ✓. Bank signs ✓. Owner matches asset owner ✓.

**SEAL `close_redemption`**: requires preceding open for the same asset (account 0) — but NOT the same owner! Open checks close binds owner; close checks open binds only asset. Could there be an open for asset X by owner A, and a close for asset X by... owner must equal asset owner (read_core_asset check in close) — so the close's owner is the asset's actual owner, same as open's. ✓.

`inspect_reserves` — checks both token programs' ATAs declared in remaining_accounts, skips non-token-owned, skips < 165, checks owner == pda, delegate/close authority zero, len == 165. ✓.

**GOV `execute_proposal`** — divisor = max(snapshot, live) ✓; need = ceil ✓; threshold ✓; monotonic ✓; execution window ✓; RoundAlreadyOver ✓.

**GOV `cast_vote`** — VoteRecord seeded by asset ✓; owner read live ✓; voting window ✓; not executed ✓.

**GOV `create_proposal`** — proposer must own a vault ✓; dur >= min_voting_secs ✓; cap > 0 ✓; window bounds ✓; snapshots quorum_supply, quorum_bps, threshold_bps ✓.

Hmm — **create_proposal doesn't check `voting_ends_at > now`?** `dur = voting_ends_at.checked_sub(now).ok_or(BadWindow)` — if voting_ends_at < now, checked_sub → None → BadWindow ✓.

**GOV `update_gov_config` — quorum_bps lowerable by admin alone, immediately.** Round-7 fix snapshotted the rule into proposals. But: **a NEW proposal created AFTER the quorum lowering uses the new low quorum.** Admin lowers quorum to 500 (floor), then a confederate holding one vault creates a proposal and... still needs quorum of votes from real vaults: need = ceil(supply * 500/10000) = 5% of supply. At 2100 vaults = 105 votes. The 21% holder has ~400 charter vaults → clears quorum alone. That's the accepted business concentration. OK.

**Now — the off-chain pipeline, deeper.**

**distribute.mjs — the plan resume.** `st.days[day].plan` fixed once. On resume, `plan.activated` from the stored plan. Vaults burned mid-run are checked per-transfer ✓. 

**The `outstanding` count for the SOL floor**: `plan.activated.filter(v => { const row = done[v]; return !row?.skipped && paymentState(row) === 'unpaid' })`. paymentState returns 'unpaid' for no row or rejected-not-resolved. ✓ matches the loop's send predicate: loop sends when state is not 'paid', not 'resolved', not skipped, not 'ambiguous' → i.e., 'unpaid'. ✓ consistent.

**distribute.mjs — `if (st.days[day].plan && !DRY)`** — on DRY with an existing plan, it recomputes a fresh plan (doesn't use stored). Fine for a dry run.

**A subtle one: the plan stores `activated` and `per`, but NOT `available`. On resume, if the distributor's balance dropped below per*remaining (e.g., someone moved cbBTC out of the distributor ATA), transfers start failing with insufficient funds → rejected=true → 'unpaid' → retried next run. The 'insufficient funds' regex is in the rejected test ✓. OK.

**distribute.mjs — `done[v] = { amount, sig: null, sentAt }` written BEFORE send; on rejection, `done[v] = { amount, sig: null, rejected, sentAt: done[v].sentAt, error }`.** ✓.

**The day-finish condition**: `if (!failed.length && !ambiguous.length) st.days[day].finishedAt = ...`. But `failed` includes rejected rows — which are retryable. A day with refusals never gets finishedAt → `distribution_unfinished` fires... wait, detectDistribution: `rec.startedAt && !rec.finishedAt && !rec.nothingToDo && !rec.resolvedBy && day !== opts.today` → HIGH. And `distribution_refused` also fires. Two findings for one condition — noisy but not wrong. Hmm, actually refused rows: the day stays unfinished forever until resolved. The refused finding covers it. Double-reporting, minor.

**revenue.mjs — the open-cycle guard runs BEFORE the sweep but the cycle intent is pushed AFTER the quote.** ✓.

**revenue.mjs — `cycle.quotedSats = q2.outAmount` overwritten after re-quote** ✓.

**revenue.mjs — `delta < minOut` check**: minOut from the FIRST quote. If the market moved up, delta could exceed; fine. If the swap partially filled... Jupiter swaps are atomic. OK.

**revenue.mjs — `got = after` sends the ENTIRE operator ATA balance to revenue, records `delta` as the return.** If the operator ATA held leftovers from a previous failed cycle, they're swept to revenue — but not recorded as returned. Then the revenue ATA holds MORE cbBTC than the ledger accounts for. The split splits everything. The ledger's returnedSats understates. detectUnreconciledRevenue is satisfied (returned ≥ floor). The extra cbBTC gets split and distributed — untracked but beneficial. OK-ish, documented ("leftovers belong to the project too").

**revenue.mjs — the swap transaction inspection**: one signer + forbidden list + ≤4 lookup tables. Stated as insufficient in round 10 — operational mitigation documented. Not re-filing.

**alarm.mjs — `normalise`**: `dataBytes: ix.data ? [...Buffer.from(bs58decode(ix.data))] : undefined`. bs58decode returns Buffer.alloc(0) on invalid char — dataBytes = [] → `d.length < 16` skips in detectUnledgeredSweeps; detectBurns checks `ix.dataBytes?.[0] !== IX_BURN_V1` → undefined ≠ 12 → skip. OK.

**alarm.mjs — `seenSplits` detection**: `ixs.some(ix => ix.program === MINT && ix.dataBytes && IX_SPLIT.every((b,i) => ix.dataBytes[i] === b))`. IX_SPLIT is 8 bytes; dataBytes could be shorter — `ix.dataBytes[i]` undefined ≠ b → false. ✓. But note: split_revenue called via CPI from another program would appear in inner instructions — normalise includes inner ✓.

**alarm.mjs — cursor advance**: `if (!gap && !unread && sigs.length) cursors[id] = sigs[0].signature`. sigs[0] is newest ✓ (probe asserts newest-first).

**alarm.mjs — `detectUnledgeredSweeps` per-transaction**: called with `signature = s.signature`, and inside, `const row = signature ? byS.get(signature) : null`. The sweep ix is in tx s → the ledger row's sweepSig should equal s.signature ✓.

**The grace logic**: `stale = !opts.blockTime || !opts.now || (now - blockTime) > graceSecs`. If blockTime missing → stale = true → immediately judged. OK.

**alarm.mjs — `detectSplitClaims([...seenSplits, ...(prev?.seenSplits || [])], led)`** — the unbounded accumulator discussed above. **This is my main finding.**

Let me also double-check `detectSplitClaims`'s reuse check ordering: for splitByOther cycles, `byOther.push(c); continue` — they're excluded from `claimed`. The anchor: `unclaimed = [...seen].filter(sig => !claimed.has(sig)).length`. seen includes ALL historical splits. inWindow counts only recent splitByOther cycles. So one ancient unclaimed split anchors one fresh lie. **Confirmed.**

Also — **the horizon creates a permanent-hole**: cycles older than 30 days are never re-asked. A split_not_on_chain finding for a cycle at day 31 disappears... it fires between grace and horizon, then stops. If the alert failed... delivery-failure carry doesn't apply to this (it's recomputed each pass from the ledger). Fine.

**Now — the BIG one to check: `detectUnreconciledRevenue` and `cycleIsOpen` with `splitByOther`.** A cycle with sweptLamports, returnedSats = 0, splitByOther = true? cycleIsOpen: moved > 0, sendRejected false, returnedSats 0 → `BigInt(c?.returnedSats ?? 0) === 0n || !(...)` → true → OPEN. Then detectUnreconciledRevenue: returned === 0n → unreconciled_swap CRITICAL ✓. Good — splitByOther with zero return still alarms.

**`cycle_unsplit` grace from returnedAt** ✓.

**Now let me look for the FOURTH introduced defect** (the prompt says three were caught; hunt a fourth).

Candidates:

(a) **In `alarm.mjs`, the idle branch**: `const idleDelivered = report(findings, looked, cfg, true) && !DRY`. `report` sets `process.exitCode`. Returns delivered. If idle and delivered and !DRY → writeState. But the EVER marker is NOT written on this path (it's later). Already noted — LOW.

(b) **`readConfigs` seal pending offsets when reserve_mints < 8**: `after = 109 + n*32` — reads pending fields right after the ACTUAL vec length ✓ (Borsh vec is length-prefixed, fields follow immediately). ✓.

(c) **`missingWatchedKeys` skips `prog` and `collection` prefixes** — so `collection.hash` and `prog.*.hash` are never asserted present. If readConfigs stops producing `collection.hash` (e.g., the `if (snap['mint.collection'])` guard fails because mint config read failed)... then mint.* keys missing → throw anyway. But `prog.seal.hash` — if the ProgramData fetch fails, `snap['prog.seal._missing']` is set, and missingWatchedKeys skips ALL prog.* keys (prefix skip). So a missing program-data read is silent?? `snap[`prog.${name}._missing`] = true` — set when `!acc`. Nothing turns that into a finding! detectConfigDrift watches prog.seal.hash etc. — drift compares prev vs cur; if cur lacks the key, `JSON.stringify(cur[k] ?? null)` = null vs prev's hash → drift fires CRITICAL ✓ (on the second pass). First pass: baseline adopts missing-ness silently. Hmm — but `_missing` for prog data on a deployed program means RPC failure. The drift catches it next pass. Marginal.

(d) **The `detectStandingRisks` `sweep_cap_wedged` check**: `if (cap !== undefined && BigInt(cap) > 0n && BigInt(cap) < minCapLamports)`. cap from readConfigs is a String (u64 → String). BigInt(string) ✓.

(e) **`detectStandingRisks` weak_rotation_timelock loop**: `for (const [k, what] of [['mint.governance_timelock_secs', ...]])` — only one entry. Fine.

(f) **THE SUITE — `because('6.17a','AccountNotSigner')`**: 6.17a is the stranger sweep without operator signing. Keys: swapOp as isSigner:false. The program requires `swap_operator: Signer` — Anchor constraint → AccountNotSigner? Actually the error would be... `require_keys_eq!(ctx.accounts.swap_operator.key(), cfg.swap_operator)` comes first? No — Anchor validates account constraints BEFORE the handler: `pub swap_operator: Signer<'info>` — a non-signer in that slot → Anchor returns AccountNotSigner (error 6003? or a constraint error). The handler never runs. ✓ because AccountNotSigner ✓.

(g) **Suite 8.10**: `ixSweep(1n, alice, alice.publicKey)` — dest = alice, signed [alice]. Program: swap_operator key must equal cfg.swap_operator → alice ≠ swapOp → WrongTreasury ✓. But Anchor's Signer check passes (alice signs). Handler runs → WrongTreasury ✓ because ✓.

(h) **A REAL SUITE ISSUE — 6.23g 'sweep to the NEW operator'**: after applying the rotation, sweep to newOp. But the cooldown! 6.22's sweep attempt was REJECTED (WrongTreasury) — doesn't stamp last_sweep_at. The last SUCCESSFUL sweep was... 6.16 (before the cap/cooldown resets). Then many minutes pass (62s waits). 6.23g waits 2.5s after 6.23f. Cooldown is 1s (reset by govWiring after 6.20d). ✓.

But wait — after the operator rotation is applied and then rotated BACK (put it back), the config's swap_operator = swapOp again for section 8. ✓.

(i) **8.7 'sweeping SOL that would breach the fee reserve'**: `ixSweep(revSol, bank)` — amount = entire balance. bal >= keep + amount → revSol >= 0.05SOL + revSol → false → ReserveWouldBreach ✓. But cooldown: last sweep was 6.23g (or the put-back apply). 2.5s wait before 8.7 ✓ (cooldown 1s).

Hmm wait — actually there's a problem: **8.7 sweeps amount = revSol which EXCEEDS the cap (50 SOL)?** revSol at that point: initial mint price 0.05 SOL + 3 SOL top-up + ... let me trace: mint V cost 0.05 SOL → revenue. Section 6b: +3 SOL. Sweeps: 6.16 swept 1M lamports (0.001 SOL) to swapOp; 6.23g swept 1M to newOp. Section 8: revSol ≈ 0.05 + 3 - 0.002 + mint prices from H, N, P, A, B mints (5 × 0.05 = 0.25) ≈ 3.298 SOL < 50 SOL cap ✓. amount = revSol ≈ 3.3 SOL ≤ cap ✓. Cooldown elapsed ✓. So it rejects on ReserveWouldBreach ✓ — and `