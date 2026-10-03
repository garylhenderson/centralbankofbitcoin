/**
 * Prove every detector in BOTH directions against synthetic input.
 *
 * The standing rule on this box: a gate that has only ever said OK is untested,
 * and this pipeline is the one that carries what the programs structurally
 * cannot. So each detector gets a case that MUST fire and a case that MUST NOT.
 */
import * as D from './detectors.mjs'
import * as LK from './lock.mjs'
import * as SPL from './spl.mjs'
import * as AN from './anchor.mjs'
import * as L from './layout.mjs'
import * as AC from './accrual.mjs'
import * as CR from './crank.mjs'
import * as PO from './redemption-poster.mjs'
/** This process's own /proc start time, for the pid-recycling assertions. */
const LKstart = () => { try {
  const st = fsx.readFileSync(`/proc/${process.pid}/stat`, 'utf8')
  return st.slice(st.lastIndexOf(')') + 2).split(' ')[19] || null } catch { return null } }
import fsx from 'fs'
import CP from 'child_process'
const R = []
// BigInt-safe: v6's layouts decode 64/128-bit fields as BigInt, and a plain
// JSON.stringify THROWS on one — which would crash the file instead of naming the
// assertion that broke.
const J = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? `${x}n` : x)
const t = (name, got, want) => { const ok = J(got) === J(want)
  R.push({ name, ok, got, want }); console.log(`  ${ok ? 'ok  ' : 'XX  '}${name}${ok ? '' : `\n        got ${J(got)}\n        want ${J(want)}`}`) }

const PDA = 'VauLtPDA1111111111111111111111111111111111'
const OTHER = 'SomeoneElse11111111111111111111111111111111'
const ASSET = 'VauLtAsset11111111111111111111111111111111'
const ATA_OK = 'CanonicalAta111111111111111111111111111111'
const ATA_BAD = 'SneakyTokenAcct11111111111111111111111111'
const BURN_PROG = '8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8'
const pdas = new Set([PDA]), assets = new Set([ASSET]), atas = new Set([ATA_OK])

console.log('── approvals ──')
t('fires on an approve BY a vault PDA',
  D.detectApprovals([{ program: D.TOKEN_ID, parsed: { type: 'approve', info: { owner: PDA, delegate: OTHER, source: ATA_OK } } }], pdas).length, 1)
t('fires on approveChecked too',
  D.detectApprovals([{ program: D.TOKEN_ID, parsed: { type: 'approveChecked', info: { owner: PDA, delegate: OTHER, source: ATA_OK } } }], pdas).length, 1)
t('QUIET on an approve by an unrelated wallet',
  D.detectApprovals([{ program: D.TOKEN_ID, parsed: { type: 'approve', info: { owner: OTHER, delegate: OTHER, source: ATA_OK } } }], pdas).length, 0)
t('QUIET on an ordinary transfer',
  D.detectApprovals([{ program: D.TOKEN_ID, parsed: { type: 'transfer', info: { owner: PDA } } }], pdas).length, 0)

console.log('── PDA-owned token accounts ──')
t('CRITICAL on a NON-canonical token account for a vault PDA',
  D.detectPdaTokenAccounts([{ program: D.ATA_ID, parsed: { info: { wallet: PDA, account: ATA_BAD } } }], pdas, atas)[0].severity, 'CRITICAL')
t('INFO on the canonical reserve ATA (this is activation)',
  D.detectPdaTokenAccounts([{ program: D.ATA_ID, parsed: { info: { wallet: PDA, account: ATA_OK } } }], pdas, atas)[0].severity, 'INFO')
t('fires on a raw initializeAccount3 owned by a vault PDA',
  D.detectPdaTokenAccounts([{ program: D.TOKEN_ID, parsed: { type: 'initializeAccount3', info: { owner: PDA, account: ATA_BAD } } }], pdas, atas)[0].severity, 'CRITICAL')
t('QUIET for a token account belonging to someone else',
  D.detectPdaTokenAccounts([{ program: D.ATA_ID, parsed: { info: { wallet: OTHER, account: ATA_BAD } } }], pdas, atas).length, 0)

console.log('── burns ──')
t('CRITICAL on a BARE Core BurnV1 of a known vault',
  D.detectBurns([{ program: D.CORE_ID, dataBytes: [12], accounts: [ASSET] }], assets, BURN_PROG)[0].severity, 'CRITICAL')
// ROUND 13: was HIGH. Under v5 `burn_vault` IS the redemption, so a HIGH here
// fired on every honest customer exit and buried `vault_left_index` — the ONLY
// detector for a bare Core BurnV1. `correlateBurns` now carries the judgement.
t('INFO on a burn through our burn program (the normal path under v5)',
  D.detectBurns([{ program: BURN_PROG, accounts: [ASSET] }], assets, BURN_PROG)[0].severity, 'INFO')
t('QUIET on a Core instruction that is not BurnV1',
  D.detectBurns([{ program: D.CORE_ID, dataBytes: [6], accounts: [ASSET] }], assets, BURN_PROG).length, 0)
t('QUIET on a burn of an asset that is not one of our vaults',
  D.detectBurns([{ program: D.CORE_ID, dataBytes: [12], accounts: [OTHER] }], assets, BURN_PROG).length, 0)

console.log('── vault set reconcile (the burn detector that can actually work) ──')
const V1='V1111111111111111111111111111111111111111', V2='V2222222222222222222222222222222222222222'
const V3='V3333333333333333333333333333333333333333'
t('CRITICAL when a known vault turns up BURNT',
  D.detectVaultSetChange([V1,V2],{live:[V2],burnt:[V1]}).findings[0].kind, 'vault_burned')
t('CRITICAL when a known vault simply leaves the index',
  D.detectVaultSetChange([V1,V2],{live:[V2],burnt:[]}).findings[0].kind, 'vault_left_index')
t('QUIET when nothing left (and a NEW vault appeared)',
  D.detectVaultSetChange([V1,V2],{live:[V1,V2,V3],burnt:[]}).findings.length, 0)
t('QUIET on the very first pass, with no prior set to compare',
  D.detectVaultSetChange(null,{live:[V1],burnt:[]}).findings.length, 0)
t('a MASS disappearance is reported as ONE index finding, not N burns',
  D.detectVaultSetChange(Array.from({length:100},(_,i)=>`v${i}`),{live:['v1'],burnt:[]}).findings.map(f=>f.kind),
  ['vault_index_shrank'])
t('...and the caller is told NOT to trust that list as the new baseline',
  D.detectVaultSetChange(Array.from({length:100},(_,i)=>`v${i}`),{live:['v1'],burnt:[]}).trustCurrent, false)
t('a plausible number of burns IS trusted and reported individually',
  D.detectVaultSetChange(Array.from({length:100},(_,i)=>`v${i}`),
    {live:Array.from({length:98},(_,i)=>`v${i+2}`),burnt:['v0','v1']}).findings.length, 2)

console.log('── standing risks added in round 6 ──')
// The program now REFUSES a zero cooldown, so the off-chain check moved from
// "is it absent" to "is it big enough" — see the sweep_cooldown_too_short cases
// in the round-7 block above. What is left here is the cap's own magnitude.
t('CRITICAL when there is no ceiling on a single sweep',
  D.detectStandingRisks({ 'mint.max_sweep_lamports': '0', 'mint.sweep_cooldown_secs': '3600' })
    .some(f => f.kind === 'sweep_bound_ineffective'), true)
t('QUIET when a real ceiling is set',
  D.detectStandingRisks({ 'mint.max_sweep_lamports': '50000000000', 'mint.sweep_cooldown_secs': '3600' })
    .some(f => f.kind === 'sweep_bound_ineffective'), false)

console.log('── the lock and the ledger (round 6: both jobs could pay twice) ──')
{
  const os_tmp = process.env.TMPDIR || '/tmp'
  const L = `${os_tmp}/.cbob-selftest-${process.pid}.lock`
  const F = `${os_tmp}/.cbob-selftest-${process.pid}.json`
  const lockDir = L.slice(0, L.lastIndexOf('/'))
  const base = L.slice(L.lastIndexOf('/') + 1)
  /** THE TESTS SPEAK POLICY, NOT LAYOUT. Round 16 replaced the mechanism under
   *  this block (one pathname -> generation-numbered records) and 24 raw touches
   *  of the lock file had to be rewritten with it. Anything that plants or reads
   *  a record now goes through these three, so the next mechanism change costs
   *  three lines instead of twenty-four. */
  const files = () => fsx.readdirSync(lockDir).filter(x => x.startsWith(base + '.'))
  const wipe = () => { for (const f of files()) { try { fsx.unlinkSync(`${lockDir}/${f}`) } catch {} } }
  const plant = (rec, gen = 0) => fsx.writeFileSync(`${L}.${gen}`, JSON.stringify(rec))
  const record = () => { const g = files().filter(f => /\.\d+$/.test(f)).sort().pop()
    try { return JSON.parse(fsx.readFileSync(`${lockDir}/${g}`, 'utf8')) } catch { return null } }
  const dead = () => false, live = () => true
  const old = h => new Date(Date.now() - h * 3600_000).toISOString()

  wipe()
  const a = LK.acquireLock(L)
  t('the FIRST runner gets the lock', a.ok, true)
  t('the SECOND runner is refused', LK.acquireLock(L).ok, false)
  t('release WITHOUT the token does nothing', LK.releaseLock(L), false)
  t('...and the lock is still held', LK.acquireLock(L).ok, false)
  t('release WITH the token frees it', LK.releaseLock(L, a.token), true)
  const b = LK.acquireLock(L)
  t('once freed, the next runner gets it', b.ok, true)
  t("a foreign token cannot free someone else's lock", LK.releaseLock(L, 'not-my-token'), false)
  LK.releaseLock(L, b.token)

  // ── STALE IS NOT DEAD. A slow money job must be waited for, never stolen from.
  wipe()
  const held = LK.acquireLock(L)
  t('a runner that is merely SLOW is not stolen from',
    LK.acquireLock(L, { now: Date.now() + 7 * 3600_000, alive: live }).ok, false)
  const broke = LK.acquireLock(L, { now: Date.now() + 7 * 3600_000, alive: dead })
  t('...but a stale lock whose holder is GONE is broken', broke.ok, true)
  t('...and the break is REPORTED, not silent', !!broke.broke, true)
  t('the broken-from token can no longer release', LK.releaseLock(L, held.token), false)
  t('...and the breaker holds it alone', LK.acquireLock(L, { alive: dead }).ok, false)
  LK.releaseLock(L, broke.token)

  // ── AN UNREADABLE OR EMPTY RECORD IS A REFUSAL, NEVER A BREAK.
  wipe(); fsx.writeFileSync(`${L}.0`, '')
  const unreadable = LK.acquireLock(L, { alive: dead })
  t('an EMPTY lock record is refused, not broken', unreadable.ok, false)
  t('...and says so rather than reporting a silent break', !!unreadable.unreadable, true)
  wipe(); plant({ pid: 999999, token: 'no-timestamp' })
  t('a record with no timestamp is refused too', LK.acquireLock(L, { alive: dead }).ok, false)

  // ── A RECYCLED PID IS NOT THE ORIGINAL HOLDER.
  wipe(); plant({ pid: process.pid, token: 'recycled', start: 'not-our-start-time', at: old(9) })
  const recycled = LK.acquireLock(L, { alive: live })
  t('a pid that is alive but RECYCLED is treated as gone', recycled.ok, true)
  LK.releaseLock(L, recycled.token)
  wipe(); plant({ pid: process.pid, token: 'really-alive', start: LKstart(), at: old(9) })
  t('...but a matching start time means the holder is REALLY alive',
    LK.acquireLock(L, { alive: live }).ok, false)

  // ══ ROUND 16: THE BREAK IS A CREATE, NOT A DELETE ══
  //
  // Rounds 12, 14 and 15 each fixed a different interleaving of "remove the
  // contended name, then put something back", and round 15 MEASURED the third:
  // between the rename and the restore the pathname does not exist, and a third
  // runner's ordinary claim lands there. Both paid. Round 15 answered with a
  // theorem — "no arrangement of rename, link and unlink is a compare-and-swap"
  // — and a round-16 auditor broke it in one line: `link` IS CAS(absent->mine).
  // What we never had is CAS(theirs->mine), and we do not need it: STOP DELETING
  // THE CONTENDED NAME. A breaker creates a HIGHER generation and only sweeps
  // strictly below its own, so there is no interval in which the lock is absent.
  //
  // MEASURED BEFORE THE CHANGE with a real claimer in the hole: the true holder
  // AND the interloper both returned ok:true. That is the double payment this
  // file exists to prevent, and no assertion had ever stated it.
  wipe(); plant({ pid: 999999, token: 'stale-A', start: null, at: old(9) })
  let winner = null
  const loser = LK.acquireLock(L, { alive: dead,
    _beforeSteal: () => { winner = LK.acquireLock(L, { alive: dead }) } })
  t('two racers break one stale lock and EXACTLY ONE wins',
    [winner?.ok, loser.ok].filter(Boolean).length, 1)
  t('...the loser says it lost the race', !!loser.lostRace, true)
  t('...and the winner took a HIGHER generation rather than the same name', winner.gen > 0, true)
  t('...and a third runner arriving mid-break is refused, not let into a hole',
    LK.acquireLock(L, { alive: dead }).ok, false)
  t('...and only the winner can free it', LK.releaseLock(L, winner.token), true)

  // THE `_beforeBreak` SEAM: another runner wins between our decision and our
  // confirming re-read. The record at G is no longer the one we judged.
  wipe(); plant({ pid: 999999, token: 'stale-C', start: null, at: old(9) })
  const preempted = LK.acquireLock(L, { alive: dead, _beforeBreak: () => {
    fsx.writeFileSync(`${L}.0`, JSON.stringify({ pid: 999999, token: 'someone-else', at: old(9) })) } })
  t('a runner whose judged record was REPLACED under it refuses', preempted.ok, false)
  t('...and says it lost the race rather than breaking what it never judged',
    !!preempted.lostRace, true)

  // GENERATIONS ONLY EVER GO UP while contended. A break that reused a number
  // would be the deletion this scheme exists to remove.
  wipe(); plant({ pid: 999999, token: 'stale-D', start: null, at: old(9) })
  const gA = LK.acquireLock(L, { alive: dead })
  const gB = LK.acquireLock(L, { now: Date.now() + 9 * 3600_000, alive: dead })
  t('a second break takes a HIGHER generation again', gB.gen > gA.gen, true)
  t('...and the superseded generation is swept', files().includes(`${base}.${gA.gen}`), false)
  LK.releaseLock(L, gB.token)

  // FOUR racers, the same stale record. One holder or the mechanism is wrong.
  wipe(); plant({ pid: 999999, token: 'stale-B', start: null, at: old(9) })
  const four = [0, 1, 2, 3].map(() => LK.acquireLock(L, { alive: dead }))
  t('FOUR racers on one stale lock: exactly one holder', four.filter(x => x.ok).length, 1)
  t('...and the other three all say they lost', four.filter(x => !x.ok).length, 3)
  LK.releaseLock(L, four.find(x => x.ok).token)

  // THE WINNER SWEEPS THE GARBAGE BELOW IT, and never at or above its own.
  wipe(); plant({ pid: 999999, token: 'g0', start: null, at: old(9) })
  const g1 = LK.acquireLock(L, { alive: dead })
  t('the breaker removes the generation it superseded', files().includes(`${base}.0`), false)
  t('...and its own record is still there', files().includes(`${base}.${g1.gen}`), true)
  LK.releaseLock(L, g1.token)
  t('a clean release leaves NOTHING behind', files(), [])

  // NO LITTER, and the check looks where litter can actually appear.
  //
  // ⚠️ ROUND 15: THIS ASSERTION COULD NEVER FAIL. It read
  // `fsx.readdirSync(fsx.existsSync(L) ? '.' : '.')` — a ternary whose two
  // branches are the SAME STRING, the process's CWD — while the lock and its
  // temporaries live in `os_tmp`. It reported 0 forever.
  const litter = () => files().filter(x => x.includes('.claim.')).length
  t('the break leaves no temp file behind', litter(), 0)
  {
    const planted = `${L}.claim.PROOF`
    fsx.writeFileSync(planted, 'x')
    t('...and the litter check looks somewhere litter can actually appear', litter(), 1)
    fsx.unlinkSync(planted)
    t('...and is quiet again once it is gone', litter(), 0)
  }
  // A LOCK THAT VANISHED IS NOT A CLEAN RELEASE.
  wipe()
  t('releasing a lock that is GONE reports failure, not success', LK.releaseLock(L, 'any-token'), false)
  const own = LK.acquireLock(L)
  t('...while releasing our own still reports success', LK.releaseLock(L, own.token), true)
  wipe()
  t('once the breaker releases, the lock is free again', LK.acquireLock(L).ok, true)
  LK.releaseLock(L, LK.acquireLock(L).token)
  wipe()

  try { fsx.unlinkSync(F) } catch {}
  t('a MISSING ledger is a fresh start, not an error', LK.readLedger(F, { days: {} }), { days: {} })
  LK.writeLedger(F, { days: { x: 1 } })
  t('what was written is what is read back', LK.readLedger(F, { days: {} }), { days: { x: 1 } })
  fsx.writeFileSync(F, '{"days": {"x": 1')          // truncated, as a crashed write leaves it
  let threw = false
  try { LK.readLedger(F, { days: {} }) } catch { threw = true }
  // THIS is the one that mattered: the old `catch { return {days:{}} }` read a
  // corrupt ledger as "nothing has ever been paid" and the next run would have
  // paid every activated vault a second time.
  t('a CORRUPT ledger throws instead of reading as empty', threw, true)
  try { fsx.unlinkSync(F) } catch {}
}

console.log('── round 7: the predicate, the sweeps, the distribution ──')
// ONE predicate. There were three copies and they disagreed; the third carried
// the original truthiness bug back in.
// A cycle is finished when the cbBTC has been SPLIT, not when it comes back:
// money sitting unsplit in the revenue ATA is money the holders have not been paid.
t('a cycle whose cbBTC returned but was never SPLIT is still OPEN',
  D.cycleIsOpen({ sweptLamports: '5', returnedSats: '9' }), true)
t('a cycle that returned AND split is CLOSED',
  D.cycleIsOpen({ sweptLamports: '5', returnedSats: '9', splitSig: 'sig' }), false)
// split_revenue is permissionless: a stranger front-running our call divides our
// cbBTC by the same enforced rule to the same pinned addresses. We lose the
// signature, not the money — demanding one anyway would wedge the pipeline.
t('a cycle split by ANOTHER caller is CLOSED too',
  D.cycleIsOpen({ sweptLamports: '5', returnedSats: '9', splitByOther: true }), false)
t("a cycle that returned the STRING '0' is OPEN", D.cycleIsOpen({ sweptLamports: '5', returnedSats: '0' }), true)
t('a cycle with only an intent is OPEN', D.cycleIsOpen({ intendedLamports: '5' }), true)
t('a cycle whose send was REFUSED by the program is CLOSED, not open',
  D.cycleIsOpen({ intendedLamports: '5', sendRejected: true }), false)
t('a cycle that never moved anything is CLOSED', D.cycleIsOpen({}), false)

const SWEEP = [1, 2, 3, 4, 5, 6, 7, 8]
const MINTP = 'Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo'
t('CRITICAL on a sweep with no matching ledger cycle',
  D.detectUnledgeredSweeps([{ program: MINTP, dataBytes: [...SWEEP, 7, 0, 0, 0, 0, 0, 0, 0] }], MINTP, SWEEP,
    { cycles: [] }, 'sigAAA')[0].kind, 'unledgered_sweep')
// The amount is IN the instruction: 7 lamports, little-endian, after the disc.
const SWEEP7 = [...SWEEP, 7, 0, 0, 0, 0, 0, 0, 0]
t('QUIET on a sweep the ledger records with the RIGHT amount',
  D.detectUnledgeredSweeps([{ program: MINTP, dataBytes: SWEEP7 }], MINTP, SWEEP,
    { cycles: [{ sweepSig: 'sigAAA', sweptLamports: '7' }] }, 'sigAAA').length, 0)
// Matching on the signature alone let the operator sweep the cap and write a row
// claiming one lamport; the detector was satisfied by a row it never checked.
t('CRITICAL when the ledger row UNDERSTATES what the chain moved',
  D.detectUnledgeredSweeps([{ program: MINTP, dataBytes: SWEEP7 }], MINTP, SWEEP,
    { cycles: [{ sweepSig: 'sigAAA', sweptLamports: '1' }] }, 'sigAAA')[0].kind, 'sweep_amount_mismatch')
t('QUIET on a DIFFERENT instruction to the same program',
  D.detectUnledgeredSweeps([{ program: MINTP, dataBytes: [9, 9, 9, 9, 9, 9, 9, 9, 0, 0, 0, 0, 0, 0, 0, 0] }],
    MINTP, SWEEP, { cycles: [] }, 'sigAAA').length, 0)
// The alarm can scan a sweep before revenue.mjs has saved its row.
t('QUIET on a sweep that landed moments ago and has no row YET',
  D.detectUnledgeredSweeps([{ program: MINTP, dataBytes: SWEEP7 }], MINTP, SWEEP,
    { cycles: [] }, 'sigAAA', { blockTime: 1000, now: 1060 }).length, 0)
t('CRITICAL once it has had time to be recorded and still has none',
  D.detectUnledgeredSweeps([{ program: MINTP, dataBytes: SWEEP7 }], MINTP, SWEEP,
    { cycles: [] }, 'sigAAA', { blockTime: 1000, now: 99999 })[0].kind, 'unledgered_sweep')

// A repeated id must not satisfy the completeness check.
t('CRITICAL when the index repeats ids to reach the chain count',
  D.detectIndexShortfall('3', ['a', 'a', 'a'], [])[0].kind, 'index_disagrees_with_chain')
t('CRITICAL when an asset is reported BOTH live and burnt',
  D.detectIndexShortfall('2', ['a', 'b'], ['b'])[0].kind, 'index_self_contradictory')
t('QUIET when the unique counts agree with the chain exactly',
  D.detectIndexShortfall('3', ['a', 'b'], ['c']).length, 0)
t('CRITICAL when the index returns MORE than was ever minted',
  D.detectIndexShortfall('2', ['a', 'b', 'c'], []).length, 1)

t('CRITICAL on a one-second sweep cooldown (the program floor is not a rate limit)',
  D.detectStandingRisks({ 'mint.max_sweep_lamports': '1', 'mint.sweep_cooldown_secs': '1' })
    .some(f => f.kind === 'sweep_cooldown_too_short'), true)
t('QUIET on an hourly cooldown',
  D.detectStandingRisks({ 'mint.max_sweep_lamports': '1', 'mint.sweep_cooldown_secs': '3600' })
    .some(f => f.kind === 'sweep_cooldown_too_short'), false)
t('CRITICAL when the four programs name different collections',
  D.detectStandingRisks({ 'seal.collection': OTHER, 'mint.collection': PDA })
    .some(f => f.kind === 'collections_disagree'), true)
t('QUIET when they agree',
  D.detectStandingRisks({ 'seal.collection': OTHER, 'mint.collection': OTHER, 'burn.collection': OTHER })
    .some(f => f.kind === 'collections_disagree'), false)
// detectBurns must not call routine admin work a burn.
t('QUIET on a NON-burn_vault instruction to the burn program',
  D.detectBurns([{ program: BURN_PROG, dataBytes: [9, 9, 9, 9, 9, 9, 9, 9], accounts: [ASSET] }],
    assets, BURN_PROG, [1, 2, 3, 4, 5, 6, 7, 8]).length, 0)
t('INFO on the burn_vault discriminator itself',
  D.detectBurns([{ program: BURN_PROG, dataBytes: [1, 2, 3, 4, 5, 6, 7, 8], accounts: [ASSET] }],
    assets, BURN_PROG, [1, 2, 3, 4, 5, 6, 7, 8])[0].severity, 'INFO')

console.log('── round 9: the grace window must be a delay, not a hole ──')
{
  const D0 = [{ sig: 'sigF', blockTime: 1000, amount: '50' }]
  t('a fresh sweep with no row yet is KEPT for the next pass',
    D.detectDeferredSweeps(D0, { cycles: [] }, { now: 1100 }).keep.length, 1)
  t('...and reports nothing while it is fresh',
    D.detectDeferredSweeps(D0, { cycles: [] }, { now: 1100 }).findings.length, 0)
  // The cursor never goes back, so without this the sweep is never looked at again.
  t('once it is stale and still has no row, CRITICAL',
    D.detectDeferredSweeps(D0, { cycles: [] }, { now: 99999 }).findings[0].kind, 'unledgered_sweep')
  t('a row that appears LATER resolves it and stops the carry',
    D.detectDeferredSweeps(D0, { cycles: [{ sweepSig: 'sigF', sweptLamports: '50' }] }, { now: 99999 }).keep.length, 0)
  t('...and a row that appears later with the WRONG amount is CRITICAL',
    D.detectDeferredSweeps(D0, { cycles: [{ sweepSig: 'sigF', sweptLamports: '1' }] }, { now: 99999 })
      .findings[0].kind, 'sweep_amount_mismatch')
}
{
  const T = Date.parse('2026-08-22T00:00:00Z')
  // cycleIsOpen calls this money the holders have not been paid, and nothing said so.
  t('HIGH when cbBTC came back and was never SPLIT',
    D.detectUnreconciledRevenue({ cycles: [{ startedAt: '2026-08-22T00:00:00Z', sweptLamports: '5',
      quotedSats: '100', returnedSats: '100' }] }, { now: T + 7200_000 })
      .some(f => f.kind === 'cycle_unsplit'), true)
  t('QUIET once it has split',
    D.detectUnreconciledRevenue({ cycles: [{ startedAt: '2026-08-22T00:00:00Z', sweptLamports: '5',
      quotedSats: '100', returnedSats: '100', splitSig: 'x' }] }, { now: T + 7200_000 }).length, 0)
  // ROUND 12: THE HORIZON IS A LEDGER POSITION, NOT A CLAIMED TIMESTAMP. This
  // assertion used to prove the bypass: backdate `startedAt` — a field the
  // operator's own process writes — and verification was skipped entirely.
  t('BACKDATING a cycle past the old 30-day horizon no longer buys silence',
    D.detectSplitClaims([], { cycles: [{ startedAt: '2026-07-01T00:00:00Z', splitSig: 'sigS' }] },
      { now: T + 40 * 86400_000 }).some(f => f.kind === 'split_not_on_chain'), true)
  t('...while a genuinely OLD cycle, pushed far back in the ledger, is not re-asked forever',
    D.detectSplitClaims([], { cycles: [
      { startedAt: '2026-08-22T00:00:00Z', splitSig: 'sigOld' },
      ...Array.from({ length: 250 }, (_, i) => ({ startedAt: '2026-08-22T00:00:00Z', splitSig: 'later' + i })),
    ] }, { now: T + 40 * 86400_000 }).some(f => f.detail.includes('sigOld')), false)
}

console.log('── round 10 ──')
{
  const T = Date.parse('2026-08-22T00:00:00Z')
  const two = { cycles: [
    { startedAt: '2026-08-22T00:00:00Z', splitSig: 'sigX' },
    { startedAt: '2026-08-22T06:00:00Z', splitSig: 'sigX' }] }
  t('CRITICAL when two cycles claim the SAME split signature',
    D.detectSplitClaims(['sigX'], two, { now: T + 86400_000 })
      .some(f => f.kind === 'split_sig_reused'), true)
  t('QUIET when each cycle names its own',
    D.detectSplitClaims(['sigX', 'sigY'], { cycles: [
      { startedAt: '2026-08-22T00:00:00Z', splitSig: 'sigX' },
      { startedAt: '2026-08-22T06:00:00Z', splitSig: 'sigY' }] }, { now: T + 86400_000 }).length, 0)
}

console.log('── round 9: a watched key nobody populates ──')
{
  // The class this closes: v5's `mint.pending_bank` was watched by two detectors
  // and read by neither, so a notice period did not run at all.
  const full = Object.fromEntries(D.WATCHED_KEYS.map(k => [k, 'x']))
  t('QUIET when the reader produces every watched key', D.missingWatchedKeys(full), [])
  const { 'mint.pool_ata': _drop, ...short } = full
  t('names the key when one is missing', D.missingWatchedKeys(short), ['mint.pool_ata'])
  // A program that is not deployed has no keys, and that is not a wiring fault.
  t('QUIET for a program that is not deployed',
    D.missingWatchedKeys({ 'mint._missing': true, 'seal._missing': true,
      'burn._missing': true, 'gov._missing': true }), [])
}

console.log('── round 8: the other end of the trusted hop ──')
{
  const T = Date.parse('2026-08-22T00:00:00Z')
  t('CRITICAL when a cycle claims a split the chain scan has not seen',
    D.detectSplitClaims([], { cycles: [{ startedAt: '2026-08-22T00:00:00Z', splitSig: 'sigS' }] },
      { now: T + 7200_000 })[0].kind, 'split_not_on_chain')
  t('QUIET when the scan has seen it',
    D.detectSplitClaims(['sigS'], { cycles: [{ startedAt: '2026-08-22T00:00:00Z', splitSig: 'sigS' }] },
      { now: T + 7200_000 }).length, 0)
  t('QUIET while the cycle is still inside the grace window',
    D.detectSplitClaims([], { cycles: [{ startedAt: '2026-08-22T00:00:00Z', splitSig: 'sigS' }] },
      { now: T + 60_000 }).length, 0)
  t('QUIET for a cycle that claims no split at all',
    D.detectSplitClaims([], { cycles: [{ startedAt: '2026-08-22T00:00:00Z' }] }, { now: T + 7200_000 }).length, 0)
}

console.log('── round 8: a MISSING ledger is not a fresh start ──')
{
  const os_tmp = process.env.TMPDIR || '/tmp'
  const F = `${os_tmp}/.cbob-r8-${process.pid}.json`
  const M = `${F}.has-run`
  for (const f of [F, M]) { try { fsx.unlinkSync(f) } catch {} }
  t('a ledger that has NEVER existed is a fresh start', LK.readLedger(F, { days: {} }, M), { days: {} })
  LK.writeLedger(F, { days: { d: 1 } }, M)
  t('saving it stamps the marker', fsx.existsSync(M), true)
  fsx.unlinkSync(F)
  let threw = false
  try { LK.readLedger(F, { days: {} }, M) } catch { threw = true }
  // THE CASE THAT MATTERS: deleting distributions.json made every vault read as
  // unpaid, and a same-day re-run would have paid them all a second time. The
  // lock does not help — it stops two writers, not one fresh process holding an
  // empty ledger.
  t('deleting it AFTER it has been written is a refusal, not day one', threw, true)
  fsx.unlinkSync(M)
  t('and removing the marker deliberately restores a fresh start',
    LK.readLedger(F, { days: {} }, M), { days: {} })
}

console.log('── config drift ──')
t('fires when the pool (the holders\' 85%) moves',
  D.detectConfigDrift({ 'mint.pool_ata': 'A' }, { 'mint.pool_ata': 'B' })[0].severity, 'CRITICAL')
t('fires when a reserve mint is added',
  D.detectConfigDrift({ 'seal.reserve_mints': ['a'] }, { 'seal.reserve_mints': ['a', 'b'] }).length, 1)
t('QUIET when nothing moved',
  D.detectConfigDrift({ 'mint.pool_ata': 'A', 'mint.bank_treasury': 'B' }, { 'mint.pool_ata': 'A', 'mint.bank_treasury': 'B' }).length, 0)
t('QUIET on the first ever run (no previous state)',
  D.detectConfigDrift(null, { 'mint.pool_ata': 'A' }).length, 0)

console.log('── standing risks ──')
t('CRITICAL when the 85/15 rule itself has been changed',
  D.detectStandingRisks({ 'mint.split_bps': 5000 })[0].severity, 'CRITICAL')
t('QUIET at 8500',
  D.detectStandingRisks({ 'mint.split_bps': 8500 }).length, 0)
t('fires when the swap operator is repointed',
  D.detectConfigDrift({ 'mint.swap_operator': 'A' }, { 'mint.swap_operator': 'B' })[0].severity, 'CRITICAL')
t('fires on a production voting period left at the test floor',
  D.detectStandingRisks({ 'gov.min_voting_secs': 60 }, { production: true })[0].kind, 'weak_voting_period')
t('QUIET on a 7-day voting period',
  D.detectStandingRisks({ 'gov.min_voting_secs': 7 * 86400 }, { production: true }).length, 0)
t('...and a test chain (not production) is not judged on it',
  D.detectStandingRisks({ 'gov.min_voting_secs': 60 }).length, 0)

console.log('── balance drops, index shortfall, approve fallback (round 6) ──')
t('ANY fall in a reserve fires, not only one below the activation line',
  D.detectBalanceDrops({ [ASSET]: '100000000' }, { [ASSET]: '21000' })[0].kind, 'reserve_fell')
t('QUIET when a reserve grew',
  D.detectBalanceDrops({ [ASSET]: '21000' }, { [ASSET]: '99999' }).length, 0)
t('QUIET when a reserve did not move',
  D.detectBalanceDrops({ [ASSET]: '21000' }, { [ASSET]: '21000' }).length, 0)
t('QUIET for a vault that left the set (the reconcile owns that)',
  D.detectBalanceDrops({ [ASSET]: '21000' }, {}).length, 0)
t('CRITICAL when the index returns fewer vaults than the chain minted',
  D.detectIndexShortfall('5', ['a','b'], ['c'])[0].kind, 'index_disagrees_with_chain')
t('QUIET when live + burnt reach minted_total',
  D.detectIndexShortfall('3', ['a','b'], ['c']).length, 0)
t('QUIET when the chain count is unknown',
  D.detectIndexShortfall(undefined, ['a'], []).length, 0)
// THE WIRING, not just the detector. Both alarm call sites passed `.length` for a
// whole round and the silent coercion made the check dead AND made it scream.
{
  let threw = false
  try { D.detectIndexShortfall('2', 2, 0) } catch { threw = true }
  t('passing COUNTS instead of ids throws instead of coercing', threw, true)
}
t('an approve still fires when the parse omits `owner`',
  D.detectApprovals([{ program: D.TOKEN_ID, parsed: { type: 'approve', info: { delegate: OTHER, source: ATA_OK } } }],
    pdas, { [ATA_OK]: PDA })[0].severity, 'CRITICAL')
t('...and stays QUIET when the account is not a vault ATA either',
  D.detectApprovals([{ program: D.TOKEN_ID, parsed: { type: 'approve', info: { delegate: OTHER, source: ATA_BAD } } }],
    pdas, { [ATA_OK]: PDA }).length, 0)

console.log("── the redeem page's preflight: did the burn declare everything the vault holds? ──")
{
  // v6 deleted the Bank and its co-signer. This judgement survives because the
  // REDEEM PAGE must run it before the holder signs (anything undeclared is
  // destroyed by the burn), and that page is not built yet.
  // ---- coverage: did the burn declare everything the vault actually holds? ----
  const cov = (owned, decl) => D.judgeRedemptionCoverage(owned, decl)
  t('coverage passes when every holding is declared',
    cov([{ address: 'ata1', amount: '5', kind: 'token' }], ['ata1']).ok, true)
  t('an UNDECLARED token account is refused',
    cov([{ address: 'ata9', amount: '5', kind: 'token' }], ['ata1']).ok, false)
  t('an UNDECLARED nested Core asset is refused',
    cov([{ address: 'inner', kind: 'asset' }], ['ata1'])[ 'ok' ], false)
  t('...and the refusal says it would be DESTROYED',
    cov([{ address: 'inner', kind: 'asset' }], []).reasons[0].includes('DESTROYED'), true)
  t('a vault that holds nothing passes', cov([], []).ok, true)

  // ───────── ROUND 15: A ZERO IN THE BASE `amount` IS NOT AN EMPTY ACCOUNT ─────────
  //
  // BURN's own second loop was fixed a round earlier for exactly this, and said
  // why in the code: "a confidential balance reads zero in the base `amount`".
  // The scan written later read that field and dropped the account. One of two
  // identical sites, again.
  const cls = D.classifyPdaTokenAccount
  t('a classic EMPTY token account is ignored',
    cls({ address: 'a', dataLen: 165, amount: 0n }), null)
  t('a classic FUNDED token account must be declared',
    cls({ address: 'a', dataLen: 165, amount: 7n }).amount, '7')
  // ⚠️ `?? 'DROPPED'` AND `.filter(Boolean)` ARE LOAD-BEARING. Stubbing the
  // classifier dead makes it return null here, and reading `.undeclarable` off
  // null CRASHES the file — which fails the build with a stack trace instead of
  // naming the property that broke. This project has already shipped a selftest
  // that crashed instead of reporting when a detector was stubbed dead; a gate
  // that cannot say WHAT it caught is most of the way to not being a gate.
  const clsx = a => cls(a) ?? 'DROPPED'
  const covx = (a, decl) => cov([cls(a)].filter(Boolean), decl)
  t('a Token-2022 account with EXTENSIONS is UNDECLARABLE even reading zero',
    clsx({ address: 'a', dataLen: 182, amount: 0n }).undeclarable ?? 'DROPPED', true)
  t('...and so is a funded one',
    clsx({ address: 'a', dataLen: 182, amount: 5n }).undeclarable ?? 'DROPPED', true)
  t('an UNDECLARABLE holding is refused EVEN WHEN DECLARED — burn_vault would revert on it',
    covx({ address: 'ext', dataLen: 182, amount: 0n }, ['ext']).ok, false)
  t('...and the refusal names the extensions and the orphaning',
    (covx({ address: 'ext', dataLen: 182, amount: 0n }, ['ext']).reasons[0] || '').includes('EXTENSIONS'), true)
  t('...while a DECLARED classic funded account still passes',
    covx({ address: 'ok', dataLen: 165, amount: 9n }, ['ok']).ok, true)
}

console.log('── the ProgramData ELF offset, and two cross-file facts ──')
{
  // A. WHERE THE ELF STARTS: 45, WHETHER OR NOT THE AUTHORITY IS PRESENT.
  //
  // Two auditors across two rounds filed `subarray(45)` as a defect on the
  // textbook bincode argument that `Option::None` serializes to one byte. The
  // fix was written and then MEASURED AWAY against two live immutable mainnet
  // programs (Token Metadata, Squads v4): `set_authority` rewrites the header in
  // place without resizing, so the stale authority bytes stay and the ELF never
  // moves. Reading from 13 would have fired a spurious CRITICAL on METAPLEX CORE
  // the day it became immutable.
  //
  // These assertions exist so nobody re-litigates it, and the live half is in
  // scripts/probe-mainnet-facts.mjs because a local validator cannot produce an
  // immutable program with a stale authority still in its header.
  const pdSome = Buffer.alloc(200); pdSome[12] = 1
  const pdNone = Buffer.alloc(200); pdNone[12] = 0
  t('an UPGRADEABLE ProgramData puts the ELF at 45', D.readProgramData(pdSome).elfOffset, 45)
  t('...and an IMMUTABLE one puts it at 45 TOO — measured, not reasoned',
    D.readProgramData(pdNone).elfOffset, 45)
  t('...so the fingerprint is the SAME slice either way',
    D.readProgramData(pdSome).elfOffset === D.readProgramData(pdNone).elfOffset, true)
  t('...while the AUTHORITY still reads from the Option tag', 
    [D.readProgramData(pdSome).hasAuth, D.readProgramData(pdNone).hasAuth], [true, false])
  t('a truncated ProgramData account is refused, not guessed',
    D.readProgramData(Buffer.alloc(4)).elfOffset, null)
  // A TAG THAT IS NEITHER 0 NOR 1 IS MALFORMED, not "immutable". `=== 1` folded
  // every other byte into hasAuth:false, which the caller renders as the WORD
  // IMMUTABLE — a confident claim about an account we could not read.
  {
    const pdBad = Buffer.alloc(200); pdBad[12] = 7
    t('a malformed Option tag is a PROBLEM, not a claim of immutability',
      [D.readProgramData(pdBad).hasAuth, D.readProgramData(pdBad).problem !== null], [null, true])
  }

  // B. THE GUARD `correlateBurns` RESTS ON, IN ANOTHER FILE. `burn_via_program`
  // is keyed on a caller-supplied account, and the only reason that cannot be
  // borrowed to launder a bare burn is that alarm.mjs never decodes a FAILED
  // transaction. A reasonable future change ("let's see attempted attacks too")
  // opens the route silently. Asserted against the source that runs.
  const alarmSrc = fsx.readFileSync('/opt/cbob-vaults/bank/alarm.mjs', 'utf8')
  t('alarm.mjs still skips FAILED transactions before decoding them',
    /if \(s\.err\) continue/.test(alarmSrc), true)
  t('...and the assertion is looking at something that can be absent',
    /if \(s\.err\) continue/.test(alarmSrc.replace('if (s.err) continue', 'if (false) continue')), false)

  // C. THE v6 SIGNER SET, PINNED FILE BY FILE AND KEY BY KEY.
  //
  // v5 had three signers (the Bank's co-signer, the distributor, the swap
  // operator) and gates that pinned each. v6 deleted the first two with the Bank
  // and the distributor wallet. What signs now is exactly:
  //   * bank/revenue.mjs -> the SWAP OPERATOR (the one trusted hop), and
  //   * bank/crank.mjs   -> the CRANK fee payer, which signs as FEE PAYER only.
  // What cannot be hidden is the secret-key constructor on `Keypair`: turning
  // bytes into a signer is the one thing every such file must do. So the SET is
  // pinned, with the key each member reads; a third signer, or one reaching for
  // different bytes, is red.
  // ⚠️ EVERY SEARCHED LITERAL IS ASSEMBLED, NEVER SPELLED, because this file is
  // inside the searched tree (Phase 0 hit the self-match five times; the arm
  // below names it directly).
  const srcFiles = [
    ...fsx.readdirSync('/opt/cbob-vaults/bank').filter(f => f.endsWith('.mjs')).map(f => ['bank', f]),
    ...fsx.readdirSync('/opt/cbob-vaults/scripts').filter(f => f.endsWith('.mjs') || f.endsWith('.sh')).map(f => ['scripts', f]),
    ...fsx.readdirSync('/opt/cbob-vaults/tests').filter(f => f.endsWith('.ts')).map(f => ['tests', f]),
  ].map(([d, f]) => ({ f, path: `${d}/${f}`, src: fsx.readFileSync(`/opt/cbob-vaults/${d}/${f}`, 'utf8') }))
  t('the searched tree covers bank/, scripts/ and tests/',
    ['bank', 'scripts', 'tests'].map(d => srcFiles.some(x => x.path.startsWith(d + '/'))), [true, true, true])
  t('...and every ops script and the whole test suite are in it, none skipped',
    ['scripts/audit-coverage.sh', 'scripts/cron-install.sh', 'scripts/run-tests.sh', 'tests/3prog.test.ts']
      .filter(n => !srcFiles.some(x => x.path === n)), [])
  const kf = n => ['keys', n].join('/')
  const KEY_OF = { [kf('swap-operator.json')]: 'SWAP-OPERATOR', [kf('crank.json')]: 'CRANK',
    [kf('bank.json')]: 'RETIRED-BANK', [kf('distributor.json')]: 'RETIRED-DISTRIBUTOR' }
  const sigPat = new RegExp(['from', 'Secret', 'Key'].join(''))
  const signerSet = extra => [...srcFiles, ...(extra ? [extra] : [])]
    .filter(x => sigPat.test(x.src))
    .map(x => {
      const keys = Object.keys(KEY_OF).filter(k => x.src.includes(k)).map(k => KEY_OF[k])
      return `${x.path} -> ${keys.length === 1 ? keys[0] : keys.length ? keys.join('+') : 'UNPINNED KEY'}`
    }).sort()
  t('exactly TWO signers exist in v6, each holding a different key', signerSet(null), [
    'bank/crank.mjs -> CRANK',
    'bank/revenue.mjs -> SWAP-OPERATOR',
  ])
  t('...and selftest.mjs is itself inside the scanned set, excluded by nothing',
    srcFiles.some(x => x.path === ['bank', 'selftest.mjs'].join('/')), true)
  {
    const impostor = { path: 'bank/impostor.mjs', f: 'impostor.mjs',
      src: 'const k = Keypair.' + ['from', 'Secret', 'Key'].join('') + '(readFileSync(process.env.SOME_OTHER_VAR))' }
    t('...and a third signer reading bytes from anywhere is caught as UNPINNED',
      signerSet(impostor).includes('bank/impostor.mjs -> UNPINNED KEY'), true)
    const revived = { path: 'bank/revived.mjs', f: 'revived.mjs',
      src: 'Keypair.' + ['from', 'Secret', 'Key'].join('') + '(read("/opt/cbob-vaults/bank/' + kf('distributor.json') + '"))' }
    t('...and a file that revives a RETIRED key (the distributor) is named as such',
      signerSet(revived).includes('bank/revived.mjs -> RETIRED-DISTRIBUTOR'), true)
  }
  // NO FILE MAY EVEN READ A RETIRED KEY PATH — not just sign with it. v6 has no
  // Bank and no distributor; a reader of either is code that predates the design.
  const retiredKeyReaders = srcFiles.filter(x => [kf('bank.json'), kf('distributor.json')].some(k => x.src.includes(k))).map(x => x.path)
  t('no file in the tree reads the retired Bank or distributor key path', retiredKeyReaders, [])
  {
    const forbidden = {
      'the retired Bank key path': kf('bank.json'),
      'the retired distributor key path': kf('distributor.json'),
      'the secret-key constructor': ['from', 'Secret', 'Key'].join(''),
    }
    const selfSrc = fsx.readFileSync('/opt/cbob-vaults/bank/selftest.mjs', 'utf8')
    const spelled = src => Object.entries(forbidden).filter(([, lit]) => src.includes(lit)).map(([n]) => n)
    t('no searched-for string is spelled out in this file, prose included', spelled(selfSrc), [])
    t('...and the check fires on a comment that quotes one',
      spelled('// e.g. it lived at ' + kf('bank.json')), ['the retired Bank key path'])
  }

  // D. WHAT v6 RETIRED IS GONE, AND NOTHING STILL REACHES FOR IT.
  const retired = ['bank/cosign.mjs', 'bank/deck.mjs', 'bank/distribute.mjs', 'scripts/bank-sign.sh']
  t('the retired v5 files are deleted, not stubbed', retired.filter(f => fsx.existsSync(`/opt/cbob-vaults/${f}`)), [])
  const importsOf = src => [...src.matchAll(/(?:from|import\()\s*['"]\.{1,2}\/([\w./-]+)['"]/g)].map(m => m[1])
  t('...and no file imports one of them',
    srcFiles.filter(x => importsOf(x.src).some(i => /(cosign|deck|distribute)\.mjs$/.test(i))).map(x => x.path), [])
  t('...and the import scanner can see an import (both ways)',
    importsOf("import * as X from './" + "deck.mjs'"), ['deck.mjs'])

  // E. THE ALARM IS WIRED TO EVERY v6 DETECTOR. A detector proven both ways that
  // nothing calls is the wired-to-nothing class this file keeps finding.
  const V6_WIRED = ['detectPoolHealth', 'detectDistributionOverdue', 'detectRedemptionRate',
    'detectBrakeTransitions', 'detectUpgradeAuthorityAfterLock', 'detectProgramEvents', 'parseCbobLogs',
    'detectNestedVaults', 'detectStandingRisks', 'detectConfigDrift', 'detectBalanceDrops']
  const calls = (src, n) => new RegExp(`D\\.${n}\\(`).test(src)
  t('alarm.mjs calls every v6 detector', V6_WIRED.filter(n => !calls(alarmSrc, n)), [])
  t('...and an unwired one is caught (both ways)',
    calls(alarmSrc.replace(/D\.detectPoolHealth\(/g, 'D.x('), 'detectPoolHealth'), false)
  t('alarm.mjs reads every config through the pinned layout, not hand-typed offsets',
    [/L\.readPinned\(/.test(alarmSrc), /readUInt32LE\(105\)|subarray\(137/.test(alarmSrc)], [true, false])
  t('alarm.mjs sends ALERT_URGENT for a finding that fires once', /ALERT_URGENT: '1'/.test(alarmSrc), true)

  // F. THE CONTROL TABLE'S FOURTH COLUMN IS MECHANICALLY TRUE (v6).
  //
  // SPEC's control table is the ONE place that says what runs. Three values:
  //   ON-CHAIN   — the row names program source(s) AND at least one refusal that
  //                is REALLY a variant of that program's error enum. (v5 verified
  //                the Bank pin; v6 has no Bank, so the proof is now the refusal
  //                the program actually emits.)
  //   AUTOMATIC  — the row names a bank/*.mjs that scripts/cron-install.sh installs.
  //   PROCEDURE  — the row names one it does not.
  const specSrc = fsx.readFileSync('/opt/cbob-vaults/SPEC.md', 'utf8')
  const cronSrc = fsx.readFileSync('/opt/cbob-vaults/scripts/cron-install.sh', 'utf8')
  // CRONTAB LINES ONLY: a schedule first, the tag last. (`/^\S+ .*\$TAG/` also
  // matched the installer's own shell lines that mention the tag.)
  const cronLines = cronSrc.split('\n').filter(l => /^[0-9*][^ ]* .*\$TAG \S+$/.test(l)).join('\n')
  const errorVariants = file => {
    let src
    try { src = fsx.readFileSync(`/opt/cbob-vaults/${file}`, 'utf8') } catch { return null }
    const m = src.match(/#\[error_code\]\s*pub enum \w+ \{([\s\S]*?)\n\}/)
    if (!m) return null
    return new Set([...m[1].matchAll(/\)\]\s*(\w+),/g)].map(x => x[1]))
  }
  const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)
  const judgeRow = l => {
    const claim = (l.match(/\*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/) || [])[1]
    if (claim === 'ON-CHAIN') {
      const progs = [...l.matchAll(/`(programs\/[\w-]+\/src\/lib\.rs)`/g)].map(m => m[1])
      if (!progs.length) return 'NO PROGRAM NAMED claims ON-CHAIN, source says PROCEDURE'
      const names = [...l.matchAll(/`([A-Z][A-Za-z]+)`/g)].map(m => m[1])
      const sets = progs.map(errorVariants)
      if (sets.some(x => !x)) return `${progs[sets.findIndex(x => !x)]} claims ON-CHAIN, source says UNREADABLE`
      const real = names.filter(n => sets.some(set => set.has(n)))
      return real.length ? `${progs.join('+')} claims ON-CHAIN, source says ON-CHAIN`
        : `${progs.join('+')} claims ON-CHAIN, source says NO REFUSAL NAMED`
    }
    const file = (l.match(/`(bank\/[\w.-]+\.mjs)/) || [])[1] || 'NO FILE NAMED'
    return `${file} claims ${claim}, cron says ${cronLines.includes(file) ? 'AUTOMATIC' : 'PROCEDURE'}`
  }
  const controlTableBlock = src => {
    const lines = src.split('\n')
    const h = lines.findIndex(l => /^\| control \| what it catches \| when \|/.test(l))
    if (h < 0) return null
    const out = []
    for (let i = h + 2; i < lines.length && lines[i].startsWith('|'); i++) out.push(lines[i])
    return out
  }
  const block = controlTableBlock(specSrc) || []
  const rows = block.filter(isTableRow).map(judgeRow)
  t('the control table header is still findable, with rows', block.length >= 5, true)
  t('EVERY row in the control table block carries a classification', block.filter(l => !isTableRow(l)), [])
  t("every row's claim matches what actually enforces it",
    rows.filter(r => r.split('claims ')[1].split(',')[0] !== r.split(/(?:cron|source) says /)[1]), [])
  t('...and the table has ON-CHAIN, AUTOMATIC and PROCEDURE rows',
    ['ON-CHAIN', 'AUTOMATIC', 'PROCEDURE'].map(c => rows.some(r => r.includes(`claims ${c}`))), [true, true, true])
  t('...and a row claiming AUTOMATIC for a file cron does NOT install is caught',
    judgeRow('| x | y | z | **AUTOMATIC.** `bank/redemption-poster.mjs` runs |').endsWith('cron says PROCEDURE'), true)
  t('...and a row claiming PROCEDURE for something cron DOES run is caught',
    judgeRow('| x | y | z | **PROCEDURE.** `bank/crank.mjs` |').endsWith('cron says AUTOMATIC'), true)
  t('...and an ON-CHAIN row naming a refusal the program does NOT have is caught',
    judgeRow('| x | `programs/cbob-vault-burn/src/lib.rs` refuses `NotARealError` | z | **ON-CHAIN.** |').endsWith('NO REFUSAL NAMED'), true)
  t('...and an ON-CHAIN row naming a real one passes',
    judgeRow('| x | `programs/cbob-vault-burn/src/lib.rs` refuses `RateLimited` | z | **ON-CHAIN.** |').endsWith('source says ON-CHAIN'), true)
  t('...and the error-enum parser reads a real enum (not an empty match)',
    (errorVariants('programs/cbob-vault-mint/src/lib.rs') || new Set()).has('NotTheGuardian'), true)
}

console.log('── the installer arms money only from OUR uncommented line (v6: revenue and crank) ──')
{
  // ROUND 19 measured two defects in the preserve block, both arming money: a
  // COMMENTED-OUT line (the ordinary way to disable a cron), a prose note or
  // another project's line all armed `--live`, and one of two identical sites
  // was left unpreserved. v6 replaces v5's opt-OUT distribute job with the crank,
  // which is opt-IN like revenue. THIS ARM RUNS THE REAL SHELL: the preservation
  // logic is extracted from scripts/cron-install.sh verbatim and executed.
  const cron = fsx.readFileSync('/opt/cbob-vaults/scripts/cron-install.sh', 'utf8')
  const from = cron.indexOf('ours() {')
  const to = cron.indexOf('grep -v "$TAG" <<<"$CUR"')
  t('the preservation block is still findable in the installer', from > 0 && to > from, true)
  const logic = cron.slice(from, to)
  const resolve = (cur) => {
    const script = `set -euo pipefail\nTAG='#cbob-vault-cron'\nCUR=$(cat)\n${logic}\nprintf 'RESOLVED<%s|%s>' "\${REV_LIVE}" "\${CRANK_LIVE}"`
    const out = CP.execFileSync('bash', ['-c', script], { input: cur, encoding: 'utf8' })
    return (out.match(/RESOLVED<([^>]*)>/) || [])[1] ?? 'NO MARKER'
  }
  const TAGC = '#cbob-vault-cron'
  t('a COMMENTED-OUT tagged revenue line does not arm --live',
    resolve(`# 41 */6 * * * cd /opt/cbob-vaults && node bank/revenue.mjs --live  (disabled) ${TAGC} revenue`), '|')
  t('a COMMENTED-OUT tagged crank line does not arm --live',
    resolve(`# 37 * * * * cd /opt/cbob-vaults && node bank/crank.mjs --live ${TAGC} crank`), '|')
  t('a prose note mentioning the flag does not arm either',
    resolve('# note: never run revenue.mjs --live or crank.mjs --live without checking'), '|')
  t("another project's line does not arm --live",
    resolve('41 */6 * * * cd /other && node bank/revenue.mjs --live'), '|')
  t('our own tagged --live revenue line IS preserved',
    resolve(`41 */6 * * * cd /opt/cbob-vaults && /usr/bin/node bank/revenue.mjs --live >> /var/log/cbob/revenue.log 2>&1 ${TAGC} revenue`), ' --live|')
  t('our own tagged --live crank line IS preserved',
    resolve(`37 * * * * cd /opt/cbob-vaults && /usr/bin/node bank/crank.mjs --live >> /var/log/cbob/crank.log 2>&1 ${TAGC} crank`), '| --live')
  t('a fresh crontab arms neither', resolve(''), '|')
  t('a tagged WATCHER line quoting the flags arms nothing',
    resolve(`23,53 * * * * cd /opt/cbob-vaults && node bank/alarm.mjs # revenue.mjs --live crank.mjs --live ${TAGC} watcher`), '|')
  t('...and a tagged REVENUE line does not arm the crank',
    resolve(`41 */6 * * * cd /opt/cbob-vaults && node bank/revenue.mjs --live crank.mjs --live ${TAGC} revenue`), ' --live|')
  t('...and only the full-pass line arms the crank, not a hand-edited reveal lane',
    resolve(`* * * * * cd /opt/cbob-vaults && node bank/crank.mjs --reveal-only --live ${TAGC} crank-reveal`), '|')
  t('the revenue cron line interpolates $REV_LIVE', /bank\/revenue\.mjs\$REV_LIVE/.test(cron), true)
  t('BOTH crank lanes interpolate $CRANK_LIVE',
    [/bank\/crank\.mjs\$CRANK_LIVE/.test(cron), /bank\/crank\.mjs --reveal-only\$CRANK_LIVE/.test(cron)], [true, true])
  const installs = cron.split('\n').filter(l => /^[0-9*][^ ]* .*\$TAG \S+$/.test(l))
  t('the template installs exactly the six v6 jobs',
    installs.map(l => l.match(/\$TAG (\S+)$/)?.[1]).sort(), ['crank', 'crank-reveal', 'deadman', 'reconcile', 'revenue', 'watcher'])
  t('...and no retired job is installed',
    installs.filter(l => /distribute\.mjs|cosign\.mjs|bank-sign/.test(l)).length, 0)
  t('the reveal lane runs every minute (the capture window is ~2 minutes)',
    installs.some(l => /^\* \* \* \* \* .*crank\.mjs --reveal-only/.test(l)), true)
}

console.log('── ROUND 19: the audit prompt interpolates its floors, and one escape is deliberate ──')
{
  // ⚠️ THREE AUDITORS ACROSS TWO RUNS FILED "the prompt ships a literal
  // ${FLOORS.onchain}", one of them as a CRITICAL. All three are REFUTED: the
  // single escaped interpolation is the R1 bullet that DESCRIBES the round-18
  // defect, and it has to render literally or the sentence is unreadable. Every
  // floor that states a number interpolates and renders as digits — measured on
  // the rendered artifact, which is the only way to see either.
  //
  // It is pinned because it is a RECURRING FALSE POSITIVE: the prompt teaches
  // auditors to hunt this shape, so it will be filed again, and an assertion is
  // cheaper than adjudicating it every round. It also fails for real if someone
  // escapes a floor that should interpolate.
  const a19 = fsx.readFileSync('/opt/cbob-vaults/scripts/audit19.ts', 'utf8')
  const escaped = a19.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => l.includes('\\${'))
  t('every escaped interpolation in the prompt is the deliberate R1 example',
    escaped.filter(([, l]) => !/HAD SHIPPED AS LITERAL TEXT/.test(l)).map(([n]) => n), [])
  t('...and that example is still there, so this arm is looking at something',
    escaped.length, 1)
  // The sentence that states the four floors must INTERPOLATE, not escape.
  const floorLine = a19.split('\n').find(l => l.includes('-assertion suite on a local validator')) || ''
  t('the floors sentence interpolates all four floors',
    ['FLOORS.onchain', 'FLOORS.detector', 'FLOORS.alloc', 'FLOORS.mainnet'].filter(k => !floorLine.includes('${' + k + '}')), [])
  t('...and none of them is escaped', /\\\$\{FLOORS/.test(floorLine), false)
}

console.log('── ROUND 19: findings REJECTED by measurement, pinned so they stay rejected ──')
{
  // ⚠️ BOTH WERE FILED THIS ROUND AND REFUTED BY RUNNING SOMETHING. They are
  // assertions rather than paragraphs so nobody re-litigates them, and so a
  // change that quietly makes one TRUE turns the build red.

  // R7-2 (opus-5): "pinnedAccountData is called WITHOUT `version` in the money
  // job, under a comment claiming a version check — both cannot be right."
  // REFUTED: `version = 1` is a DEFAULT PARAMETER, so the omitting call gets the
  // identical check and the comment is true. The auditor's own suggested
  // evidence — "one look at the signature in bank/anchor.mjs" — is what refutes
  // it, and it could not look, because anchor.mjs was in neither bundle.
  const acc = ver => ({ owner: { toBase58: () => 'P' },
    data: Buffer.concat([AN.accountDiscriminator('MintConfig'), Buffer.from([ver])]) })
  const prog = { toBase58: () => 'P' }
  t('pinnedAccountData enforces the layout version even when the caller omits it', (() => {
    try { AN.pinnedAccountData(acc(2), { program: prog, struct: 'MintConfig', what: 'x' }); return 'accepted' }
    catch (e) { return /layout version 2/.test(e.message) ? 'refused' : 'other' }
  })(), 'refused')
  t('...and still accepts the version it was written for', (() => {
    try { return AN.pinnedAccountData(acc(1), { program: prog, struct: 'MintConfig', what: 'x' }) ? 'accepted' : 'null' }
    catch { return 'refused' }
  })(), 'accepted')

}

console.log("── SPEC's stated assertion counts equal the real floors ──")
{
  // CARRY-OVER SINCE ROUND 8: SPEC's "Running the tests" block read 178 / 93 / 14
  // against a real 267 / 305 / 17. Nobody is misled about safety by a stale
  // number, and that is exactly the problem — a documented count that is visibly
  // wrong teaches the reader that the floors beside it are decorative too. It is
  // four numbers and a regex, so it is a gate now rather than a carry item.
  const spec = fsx.readFileSync('/opt/cbob-vaults/SPEC.md', 'utf8')
  const runner = fsx.readFileSync('/opt/cbob-vaults/scripts/run-tests.sh', 'utf8')
  const num = (re, src) => { const m = src.match(re); return m ? Number(m[1]) : 'NOT FOUND' }
  const onchain = num(/^MIN_ASSERTIONS=(\d+)/m, runner)
  const det = num(/^DET_FLOOR=(\d+)/m, runner)
  const alloc = num(/^ALLOC_FLOOR=(\d+)/m, runner)
  // ⚠️ ROUND 19 (opus-5, R6-1): THE FLOORS ARE STORED TWICE AND ONLY ONE COPY WAS
  // CHECKED. `scripts/run-tests.sh` holds DET_FLOOR/ALLOC_FLOOR; `bank/selftest.mjs`
  // and `bank/distribute.mjs` each hold their own `FLOOR`. Nothing compared the
  // pairs, so they could drift silently — which is exactly how MIN_ASSERTIONS came
  // to sit two under the real on-chain count. A fact stored twice is a fact that
  // will disagree; if it must be stored twice, the disagreement must be red.
  const selfFloor = num(/^const FLOOR = (\d+)$/m, fsx.readFileSync('/opt/cbob-vaults/bank/selftest.mjs', 'utf8'))
  t("selftest.mjs's own FLOOR equals run-tests.sh's DET_FLOOR", selfFloor, det)
  t('...and a drifted copy is caught', num(/^const FLOOR = (\d+)$/m, 'const FLOOR = 999') === det, false)
  // ⚠️ PHASE 1: THIS GATE READ EXACTLY ONE OCCURRENCE OF EACH OF THREE FLOORS,
  // AND SPEC STATES THEM MORE THAN ONCE. `String.match` stops at the first hit,
  // so everything below was invisible to a gate whose whole job is stale numbers:
  //   * the SECOND statement of the allocation count, twenty lines under the
  //     first, sat at 63 against a real 103;
  //   * THE SHIP GATE section said "270-assertion suite" and "thirteen rounds"
  //     six rounds after both stopped being true;
  //   * the deck and mainnet floors were checked by NOTHING AT ALL.
  // One fact, several readers, one of them checked — which is the defect the
  // round-19 note directly above describes, reproduced inside the gate that note
  // was written into. EVERY occurrence now, and all FIVE floors.
  // v6: the deck is gone (levels are drawn on chain from slot hashes); the
  // poster's copy rules are the new suite with a floor.
  const poster = num(/^POSTER_FLOOR=(\d+)/m, runner)
  const mainnet = num(/^MAINNET_FLOOR=(\d+)/m, runner)
  // Each phrasing is anchored on the WORD the number describes, so a new sentence
  // in SPEC stating a count is caught by the phrasing rather than by someone
  // remembering to add it here. `g` and `matchAll` are the load-bearing part.
  const RX = {
    'on-chain':   /(\d+) assertions, real cloned Core/g,
    'detector':   /(\d+) detector\b/g,
    'allocation': /(\d+) allocation\b/g,
    'poster':     /(\d+) poster\b/g,
    'mainnet':    /(\d+) live-mainnet\b/g,
  }
  const statedIn = (src, what) => [...src.matchAll(RX[what])].map(m => Number(m[1]))
  const everywhere = (what, want) => {
    const found = statedIn(spec, what)
    // ZERO OCCURRENCES IS A FAILURE, NOT A PASS. `.every` on an empty array is
    // true, so a floor SPEC stopped mentioning would sail through silently —
    // which is how the deck floor came to be documented nowhere.
    t(`SPEC states the ${what} floor correctly EVERYWHERE it states it (${JSON.stringify(found)} vs ${want})`,
      found.length > 0 && found.every(n => n === want), true)
  }
  for (const what of Object.keys(RX)) {
    everywhere(what, { 'on-chain': onchain, detector: det, allocation: alloc, poster, mainnet }[what])
  }
  // BOTH WAYS, AND ON THE SECOND OCCURRENCE SPECIFICALLY — a reader that only
  // checks the first is what this replaces, so proving it on the first proves
  // nothing about the change. Plant a stale number at the LAST occurrence.
  {
    const hits = [...spec.matchAll(RX.allocation)]
    const last = hits[hits.length - 1]
    const poisoned = spec.slice(0, last.index) + `63 allocation` + spec.slice(last.index + last[0].length)
    const found = [...poisoned.matchAll(RX.allocation)].map(m => Number(m[1]))
    t('...and a stale number at a LATER occurrence is caught, not just the first',
      found.length > 0 && found.every(n => n === alloc), false)
    t('...while the unpoisoned document passes the same reader', 
      statedIn(spec, 'allocation').every(n => n === alloc), true)
  }
}

console.log('── one DAS judgement, two callers ──')
{
  // ⚠️ ROUND 15 FIXED ONE OF TWO IDENTICAL SITES — cosign.mjs's scanPda — and
  // left alarm.mjs's listVaults on `j.result?.items || []`, in the same commit
  // whose verdict named that as this project's most repeated defect. It is now
  // one function with two callers, so they cannot agree today and drift tomorrow.
  const J = D.judgeDasEnvelope
  t('a good page is returned', J({ ok: true, status: 200, json: { result: { items: [1, 2] } } }).items.length, 2)
  t('a NON-2xx is a refusal', J({ ok: false, status: 503, json: {} }).problem, 'HTTP 503')
  t('a 200 with an RPC error is a refusal',
    J({ ok: true, status: 200, json: { error: { code: -1 } } }).items, null)
  t('a 200 carrying {} is a refusal, NOT "owns nothing"',
    J({ ok: true, status: 200, json: {} }).items, null)
  t('a 200 with result:null is a refusal', J({ ok: true, status: 200, json: { result: null } }).items, null)
  t('a non-object body is a refusal', J({ ok: true, status: 200, json: null }).items, null)
  t('...and a genuinely EMPTY collection is still an answer',
    J({ ok: true, status: 200, json: { result: { items: [] } } }).items, [])
  // BOTH READERS GO THROUGH IT. A third copy appearing is the thing to catch.
  // EVERY DAS READER IN bank/, DISCOVERED rather than listed. A hardcoded list of
  // two is how you fix two of three: this gate's first run found a THIRD copy in
  // distribute.mjs that I did not know was there.
  const dasFiles = fsx.readdirSync('/opt/cbob-vaults/bank').filter(f => f.endsWith('.mjs'))
    .filter(f => f !== 'selftest.mjs' && f !== 'detectors.mjs')
    .filter(f => /getAssetsBy/.test(fsx.readFileSync(`/opt/cbob-vaults/bank/${f}`, 'utf8')))
  t('every DAS reader in bank/ uses the shared judgement',
    dasFiles.filter(f => !/judgeDasEnvelope/.test(fsx.readFileSync(`/opt/cbob-vaults/bank/${f}`, 'utf8'))), [])
  // CODE, NOT COMMENTS. The first version of this matched a comment QUOTING the
  // old shape and reported its own explanation as a defect.
  const code = f => fsx.readFileSync(`/opt/cbob-vaults/bank/${f}`, 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  t('...and none of them still carries the fail-open shape in CODE',
    dasFiles.filter(f => /result\?\.items \|\| \[\]/.test(code(f))), [])
  // v6 retired two of the three readers (cosign.mjs and distribute.mjs) with the
  // Bank and the distributor. The alarm is the one left, and it must still be found.
  t('...and the file list is not empty (the discovery still finds the alarm)',
    dasFiles.includes('alarm.mjs'), true)
}

console.log('── the cron template carries the OS lease ──')
{
  // AGAINST THE REAL FILE, not a fixture. A dropped `$FLOCK` prefix leaves the
  // crons working and merely non-exclusive, which is invisible until two runs
  // overlap and the ledger pays twice.
  const cron = fsx.readFileSync('/opt/cbob-vaults/scripts/cron-install.sh', 'utf8')
  t('every money job in the REAL cron template is wrapped in flock',
    D.judgeCronTemplate(cron), [])
  t('...and a line that lost its prefix is caught',
    D.judgeCronTemplate('7 9 * * * cd $R && /usr/bin/node bank/distribute.mjs >> x.log 2>&1').length, 1)
  t('...while a non-cron line is not mistaken for one',
    D.judgeCronTemplate('# /usr/bin/node bank/distribute.mjs in a comment').length, 0)
  t('...and a job that HAS the prefix is quiet',
    D.judgeCronTemplate('FLOCK="$FLOCK -n"\n7 9 * * * cd $R && $FLOCK /x /usr/bin/node bank/distribute.mjs').length, 0)
  // ── ROUND 16: `-n` IS THE PROPERTY. A WAITING flock double-pays. ──
  // The first version of this gate matched `flock` and stopped there, so a
  // blocking lock passed and the suite stayed green — a gate blind to its own
  // subject, the same class as the litter ternary round 15 fixed.
  t('a WAITING flock is caught — a queued second run pays the same day twice',
    D.judgeCronTemplate('7 9 * * * cd $R && flock /x /usr/bin/node bank/distribute.mjs').length, 1)
  t('...and a literal `flock -n` is quiet',
    D.judgeCronTemplate('7 9 * * * cd $R && flock -n /x /usr/bin/node bank/distribute.mjs').length, 0)
  t('...and `$FLOCK` is trusted ONLY when the variable carries -n',
    D.judgeCronTemplate('FLOCK=/usr/bin/flock\n7 9 * * * cd $R && $FLOCK /x /usr/bin/node bank/distribute.mjs').length, 1)
  t('the REAL template still passes the -n gate', D.judgeCronTemplate(cron), [])
}

console.log('── acknowledging a finding nobody can act on ──')
{
  const A2 = 'AckVault111111111111111111111111111111111'
  const crit = (k, a) => ({ kind: k, severity: 'CRITICAL', asset: a, detail: 'the thing' })
  const one = (fs) => fs[0]
  // ROUND 16: AN ACK IS AN OBJECT WITH A REASON AND AN EXPIRY.
  const ack = (why, until = '2099-01-01') => ({ why, until })
  t('an acked finding drops to INFO',
    one(D.applyAcks([crit('vault_owns_itself', A2)], { [`vault_owns_itself:${A2}`]: ack('gary: bricked, accepted') })).severity,
    'INFO')
  t('...and is still PRINTED, with the reason, rather than deleted',
    one(D.applyAcks([crit('vault_owns_itself', A2)], { [`vault_owns_itself:${A2}`]: ack('gary: bricked, accepted') })).detail.includes('ACKNOWLEDGED until 2099-01-01: gary: bricked, accepted'),
    true)
  // ── ROUND 15: AN ACK IS NOT A GENERAL MUTE BUTTON ──
  // It would downgrade ANY asset-scoped finding, so `vault_burned:<asset>` in
  // acks.json silenced the paging for a real bare Core BurnV1 — the one attack
  // the programs cannot prevent. Scoped to the three kinds that are unanswerable
  // by construction, which is what it was built for.
  t('a bare-burn CRITICAL cannot be acked away',
    one(D.applyAcks([crit('vault_burned', A2)], { [`vault_burned:${A2}`]: ack('noisy, ignore it') })).severity,
    'CRITICAL')
  t('...nor can the one detector that sees a bare Core BurnV1',
    one(D.applyAcks([crit('vault_left_index', A2)], { [`vault_left_index:${A2}`]: ack('x') })).severity,
    'CRITICAL')
  t('...nor an undeclared token account',
    one(D.applyAcks([crit('undeclared_token_account', A2)], { [`undeclared_token_account:${A2}`]: ack('x') })).severity,
    'CRITICAL')
  t('...and the REFUSED ack is itself reported rather than ignored in silence',
    one(D.applyAcks([crit('vault_burned', A2)], { [`vault_burned:${A2}`]: ack('noisy') })).detail.includes('WAS REFUSED'),
    true)
  // THE OTHER DIRECTION: the three it WAS built for still work.
  t('...while nested_vault still acks', 
    one(D.applyAcks([crit('nested_vault', A2)], { [`nested_vault:${A2}`]: ack('gary: host burnt') })).severity, 'INFO')
  t('...and unredeemable_owner still acks',
    one(D.applyAcks([crit('unredeemable_owner', A2)], { [`unredeemable_owner:${A2}`]: ack('gary: DAO holds it') })).severity, 'INFO')
  // ── ROUND 16: AN ACK EXPIRES, and the expiry is what answers two auditors ──
  // The kind allowlist stops the worst case; it does NOT establish that a given
  // condition is unanswerable. A `nested_vault` inside a LIVE host is recoverable
  // (its owner can Execute it straight back out); only a BURNT host makes it
  // permanent. `unredeemable_owner` on a marketplace escrow clears on delisting.
  // This file cannot judge recoverability per asset. It CAN bound how long a
  // human's judgement is trusted — which is the blind spot detectors.mjs already
  // named: "an ack that was true when written and is not any more".
  t('an EXPIRED ack does not silence anything',
    one(D.applyAcks([crit('nested_vault', A2)], { [`nested_vault:${A2}`]: ack('host is burnt', '2020-01-01') })).severity,
    'CRITICAL')
  t('...and says WHY it was refused, with the date',
    one(D.applyAcks([crit('nested_vault', A2)], { [`nested_vault:${A2}`]: ack('host is burnt', '2020-01-01') }))
      .detail.includes('EXPIRED on 2020-01-01'), true)
  t('an ack with NO expiry is refused — a permanent mute is the thing being removed',
    one(D.applyAcks([crit('nested_vault', A2)], { [`nested_vault:${A2}`]: { why: 'host is burnt' } })).severity,
    'CRITICAL')
  t('a BARE STRING ack is refused, so the never-expiring shape is not the easy one',
    one(D.applyAcks([crit('nested_vault', A2)], { [`nested_vault:${A2}`]: 'host is burnt' })).severity,
    'CRITICAL')
  t('an ack with an unreal date is refused',
    D.judgeAck({ why: 'x', until: '2026-13-45' }).ok, false)
  t('...and a live one is honoured right up to the end of its last day',
    D.judgeAck({ why: 'x', until: '2026-08-22' }, Date.parse('2026-08-22T23:59:00Z')).ok, true)
  t('...and is dead the moment after',
    D.judgeAck({ why: 'x', until: '2026-08-22' }, Date.parse('2026-08-23T00:00:01Z')).ok, false)

  t('an unacked finding is untouched',
    one(D.applyAcks([crit('vault_owns_itself', A2)], {})).severity, 'CRITICAL')
  // THE KEY IS kind:asset, so an ack is never a blanket.
  t('acking one KIND does not ack another on the same asset',
    one(D.applyAcks([crit('nested_vault', A2)], { [`vault_owns_itself:${A2}`]: ack('x') })).severity, 'CRITICAL')
  t('acking one ASSET does not ack the same kind on another',
    one(D.applyAcks([crit('nested_vault', 'OtherVault11111111111111111111111111111')],
      { [`nested_vault:${A2}`]: ack('x') })).severity, 'CRITICAL')
  // THE REASON IS MANDATORY: an ack with no argument is indistinguishable from a
  // mistake, and it is the only record of why a permanent CRITICAL was accepted.
  t('`true` is not an ack', one(D.applyAcks([crit('nested_vault', A2)], { [`nested_vault:${A2}`]: true })).severity, 'CRITICAL')
  t('an empty reason is not an ack', one(D.applyAcks([crit('nested_vault', A2)], { [`nested_vault:${A2}`]: ack('   ') })).severity, 'CRITICAL')
  t('a finding with no asset is never acked',
    one(D.applyAcks([{ kind: 'scan_gap', severity: 'HIGH', detail: 'x' }], { 'scan_gap:undefined': 'x' })).severity, 'HIGH')
  t('no acks at all is a no-op', D.applyAcks([crit('nested_vault', A2)]).length, 1)
  // ABSENT vs BROKEN. A bare catch cannot tell them apart, and the difference is
  // a silent mute button: corrupt one file and every CRITICAL goes quiet.
  t('an absent ack file is quiet and acks nothing',
    JSON.stringify(D.parseAcks(null)), JSON.stringify({ acks: {}, problem: null }))
  t('a MALFORMED ack file acks nothing AND says so',
    D.parseAcks('{not json').problem !== null, true)
  t('...and a JSON array is not an ack file either',
    D.parseAcks('[]').problem, 'not a JSON object')
  t('...nor is a bare string', D.parseAcks('"hello"').problem, 'not a JSON object')
  t('a good ack file parses', D.parseAcks('{"a:b":"why"}').acks['a:b'], 'why')
}

console.log('── telling a redemption from a bare Core burn ──')
{
  const A = 'BurnedVaultA111111111111111111111111111111'
  const B = 'BurnedVaultB111111111111111111111111111111'
  const gone = a => ({ kind: 'vault_burned', severity: 'CRITICAL', asset: a, detail: `vault ${a} is BURNED.` })
  const via = a => ({ kind: 'burn_via_program', severity: 'INFO', asset: a, detail: 'burn_vault invoked' })
  const sev = (fs, kind, asset) => fs.find(f => f.kind === kind && f.asset === asset)?.severity ?? null
  t('a vault that vanished WITH a scanned burn_vault is a redemption (INFO)',
    sev(D.correlateBurns([gone(A), via(A)]), 'vault_burned', A), 'INFO')
  t('a vault that vanished with NO burn_vault stays CRITICAL',
    sev(D.correlateBurns([gone(A)]), 'vault_burned', A), 'CRITICAL')
  t('...and says what that looks like, so the reader does not have to know',
    D.correlateBurns([gone(A)]).find(f => f.kind === 'vault_burned')?.detail.includes('BARE Core BurnV1'), true)
  // THE ONE THAT MATTERS: a real redemption in the same pass as a bare burn must
  // not launder the bare one. This is the whole reason the correlation is
  // per-asset rather than a global "did we see any burn this pass".
  t('a bare burn is NOT laundered by an unrelated redemption in the same pass',
    sev(D.correlateBurns([gone(A), via(A), gone(B)]), 'vault_burned', B), 'CRITICAL')
  t('...while the genuine redemption beside it is still INFO',
    sev(D.correlateBurns([gone(A), via(A), gone(B)]), 'vault_burned', A), 'INFO')
  // The redemption transaction touches SEAL and BURN, so it is scanned in both
  // walks and the same burn arrives twice.
  t('a burn_via_program seen in two program walks is reported ONCE',
    D.correlateBurns([via(A), via(A), gone(A)]).filter(f => f.kind === 'burn_via_program').length, 1)
  t('every other finding passes through untouched',
    D.correlateBurns([{ kind: 'approve_by_vault_pda', severity: 'CRITICAL', asset: A, detail: 'x' }])[0].severity,
    'CRITICAL')
  // ROUND 14: the first version rewrote ONE of FOUR kinds a redemption produces,
  // so every honest exit still rang a CRITICAL and the fix delivered nothing it
  // was written for. A fix applied to one of N identical sites is this project's
  // most repeated defect, and it appeared inside the commit written to remove it.
  for (const k of ['vault_vanished', 'deactivated', 'reserve_fell']) {
    t(`a redemption's ${k} is downgraded too, not just vault_burned`,
      sev(D.correlateBurns([{ kind: k, severity: 'CRITICAL', asset: A, detail: 'x' }, via(A)]), k, A), 'INFO')
    t(`...and ${k} stays loud when NO burn_vault was seen`,
      sev(D.correlateBurns([{ kind: k, severity: 'CRITICAL', asset: A, detail: 'x' }]), k, A), 'CRITICAL')
  }
  // THE ALLOWLIST IS THE POINT. A burn must never launder the evidence of
  // something that should not have happened, so anything describing a real
  // wrong stays loud even on an asset we watched being redeemed.
  for (const k of ['approve_by_vault_pda', 'nested_vault', 'undeclared_token_account', 'vault_left_index']) {
    t(`a burn does NOT quiet ${k} on the same asset`,
      sev(D.correlateBurns([{ kind: k, severity: 'CRITICAL', asset: A, detail: 'x' }, via(A)]), k, A), 'CRITICAL')
  }
  t('an empty pass produces nothing', D.correlateBurns([]).length, 0)
  // And the severity that started all this.
  t('burn_via_program is INFO, not HIGH — it is the normal path under v5',
    D.detectBurns([{ program: BURN_PROG, dataBytes: [1, 2, 3, 4, 5, 6, 7, 8], accounts: [ASSET] }],
      assets, BURN_PROG, [1, 2, 3, 4, 5, 6, 7, 8])[0]?.severity ?? null, 'INFO')
  t('...and a BARE Core BurnV1 is still CRITICAL',
    D.detectBurns([{ program: D.CORE_ID, dataBytes: [D.IX_BURN_V1], accounts: [ASSET] }],
      assets, BURN_PROG, [1, 2, 3, 4, 5, 6, 7, 8])[0]?.severity ?? null, 'CRITICAL')
}

console.log('── nested vaults (a vault inside a vault) ──')
{
  const OUTER = 'OuterVault11111111111111111111111111111111'
  const INNER = 'InnerVault11111111111111111111111111111111'
  const OUTER_PDA = 'OuterPda111111111111111111111111111111111'
  const INNER_PDA = 'InnerPda111111111111111111111111111111111'
  const pdaOf = id => ({ [OUTER]: OUTER_PDA, [INNER]: INNER_PDA })[id] || null
  // A REAL off-curve address (the CBOBTC Squads vault) and a real keypair one.
  const SQUADS2 = 'bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1'
  const curve2 = k => k !== SQUADS2 && k !== OUTER_PDA && k !== INNER_PDA
  // `[0].kind` THROWS when a detector returns nothing, which aborts the whole
  // selftest with a stack trace instead of reporting a mismatch — every later
  // assertion then never runs. Proven: stubbing this detector to `return []`
  // exited 1 with a TypeError and printed no XX line at all. The `?.` makes a
  // dead detector read as `null` vs the expected kind, which is a finding you
  // can act on. THE SAME FRAGILITY IS ALL OVER THIS FILE and predates v5.
  const HUMAN = 'AliceWallet1111111111111111111111111111111'
  t('CRITICAL when one vault is owned by another vault\'s asset-signer PDA',
    D.detectNestedVaults([{ id: OUTER, owner: HUMAN }, { id: INNER, owner: OUTER_PDA }], pdaOf, curve2)[0]?.kind ?? null,
    'nested_vault')
  t('...and it names the HOST vault, not just the inner one',
    D.detectNestedVaults([{ id: OUTER, owner: HUMAN }, { id: INNER, owner: OUTER_PDA }], pdaOf, curve2)[0]?.detail?.includes(OUTER) ?? null,
    true)
  // THE OTHER DIRECTION, which is the whole reason this file exists. A detector
  // that has only ever said CRITICAL is exactly as untested as one that has only
  // ever said quiet.
  t('QUIET when every vault is owned by a wallet',
    D.detectNestedVaults([{ id: OUTER, owner: HUMAN }, { id: INNER, owner: HUMAN }], pdaOf, curve2).length, 0)
  t('QUIET when a vault is owned by a PDA that is NOT one of our vaults',
    D.detectNestedVaults([{ id: OUTER, owner: 'SomeOtherPda11111111111111111111111111111' }], pdaOf, curve2).length, 0)
  t('QUIET on an owner DAS did not return',
    D.detectNestedVaults([{ id: OUTER, owner: null }], pdaOf, curve2).length, 0)
  // Proven impossibility 3, one level in: its own PDA, which is a different and
  // worse finding — nobody can reach it, not even by burning something else.
  t('a vault owned by its OWN asset-signer PDA is a distinct finding',
    D.detectNestedVaults([{ id: OUTER, owner: OUTER_PDA }], pdaOf, curve2)[0]?.kind ?? null, 'vault_owns_itself')
  t('...and it is not also reported as a nested vault',
    D.detectNestedVaults([{ id: OUTER, owner: OUTER_PDA }], pdaOf, curve2).length, 1)
  // A BURNT host is the worst case, not an excluded one: the PDA can never sign
  // again, so anything inside it is already unreachable.
  t('fires when the HOST vault is one the caller listed as burnt',
    D.detectNestedVaults([{ id: OUTER, owner: HUMAN, burnt: true }, { id: INNER, owner: OUTER_PDA }], pdaOf, curve2).length, 1)
  // ROUND 14: NESTING IS THE NARROW SUBCASE. A vault owned by ANY off-curve
  // address can never be redeemed — v5 needs two TOP-LEVEL owner signatures and a
  // program signs only by CPI. Round 13 checked the BANK for exactly this and not
  // the OWNER: one of two identical sites, again.
  t('CRITICAL on a vault owned by a multisig or program address',
    D.detectNestedVaults([{ id: OUTER, owner: SQUADS2 }], pdaOf, curve2)[0]?.kind ?? null,
    'unredeemable_owner')
  t('...and it names the marketplace-escrow reading too, rather than guessing',
    D.detectNestedVaults([{ id: OUTER, owner: SQUADS2 }], pdaOf, curve2)[0]?.detail.includes('marketplace'), true)
  t('QUIET on a vault owned by an ordinary wallet',
    D.detectNestedVaults([{ id: OUTER, owner: HUMAN }], pdaOf, curve2).length, 0)
  // A nested vault is ALSO off-curve; it must be named once, by the arm that can
  // say WHICH vault is holding it.
  t('a nested vault is reported ONCE, as nested, not twice',
    D.detectNestedVaults([{ id: OUTER, owner: HUMAN }, { id: INNER, owner: OUTER_PDA }], pdaOf, curve2)
      .filter(x => x.asset === INNER).map(x => x.kind), ['nested_vault'])
  t('an unreadable owner is NOT a verdict',
    D.detectNestedVaults([{ id: OUTER, owner: 'junk' }], pdaOf, () => { throw new Error('bad') }).length, 0)
}

console.log('── undeclared token accounts (the completeness reconcile) ──')
t('CRITICAL on a token account a vault owns that is not a reserve ATA',
  D.detectUndeclaredTokenAccounts(ASSET, [ATA_OK], [{ address: ATA_BAD, amount: 5n }])[0].kind,
  'undeclared_token_account')
t('QUIET on the canonical reserve ATA itself',
  D.detectUndeclaredTokenAccounts(ASSET, [ATA_OK], [{ address: ATA_OK, amount: 21000n }]).length, 0)
t('an undeclared account with a ZERO balance still fires (it is still destroyed)',
  D.detectUndeclaredTokenAccounts(ASSET, [ATA_OK], [{ address: ATA_BAD, amount: 0n }]).length, 1)
t('QUIET for a vault that owns nothing at all',
  D.detectUndeclaredTokenAccounts(ASSET, [ATA_OK], []).length, 0)

console.log('── revenue reconciliation ──')
const T0 = Date.parse('2026-08-22T00:00:00Z')
t('CRITICAL when SOL was swept and no cbBTC came back',
  D.detectUnreconciledRevenue({ cycles: [{ startedAt: '2026-08-22T00:00:00Z', sweptLamports: '5' }] },
    { now: T0 + 7200_000 })[0].severity, 'CRITICAL')
t('QUIET while the cycle is still in flight',
  D.detectUnreconciledRevenue({ cycles: [{ startedAt: '2026-08-22T00:00:00Z', sweptLamports: '5' }] },
    { now: T0 + 60_000 }).length, 0)
t('QUIET once the cbBTC has returned AND been split',
  D.detectUnreconciledRevenue({ cycles: [{ startedAt: '2026-08-22T00:00:00Z', sweptLamports: '5',
    returnedSats: '9', splitSig: 'x' }] }, { now: T0 + 7200_000 }).length, 0)
t('a MISSING ledger is a CRITICAL, not a quiet day',
  D.detectUnreconciledRevenue(null)[0].kind, 'revenue_ledger_unreadable')
t('QUIET for a ledger that exists and is genuinely empty',
  D.detectUnreconciledRevenue({ cycles: [] }).length, 0)
// `String(0n)` is `'0'`, which is truthy — this is the assertion that catches it.
t('a return of ZERO is UNRECONCILED, not reconciled',
  D.detectUnreconciledRevenue({ cycles: [{ startedAt: '2026-08-22T00:00:00Z', sweptLamports: '5', returnedSats: '0' }] },
    { now: T0 + 7200_000 })[0].kind, 'unreconciled_swap')
t('a sweep recorded only as an INTENT still counts as unreconciled',
  D.detectUnreconciledRevenue({ cycles: [{ startedAt: '2026-08-22T00:00:00Z', intendedLamports: '5' }] },
    { now: T0 + 7200_000 })[0].kind, 'unreconciled_swap')
t('ONE SATOSHI back against a big quote is a SHORT RETURN, not a clean cycle',
  D.detectUnreconciledRevenue({ cycles: [{ startedAt: '2026-08-22T00:00:00Z', sweptLamports: '50000000000',
    quotedSats: '1000000', returnedSats: '1', splitSig: 'x' }] }, { now: T0 + 7200_000 })[0].kind, 'short_swap_return')
t('QUIET when the return is within the tolerance of the quote',
  D.detectUnreconciledRevenue({ cycles: [{ startedAt: '2026-08-22T00:00:00Z', sweptLamports: '50000000000',
    quotedSats: '1000000', returnedSats: '990000', splitSig: 'x' }] }, { now: T0 + 7200_000 }).length, 0)


console.log('\u2500\u2500 round 11: the lock, the one token reader, and four repairs of repairs \u2500\u2500')
// ONE READER FOR A TOKEN ACCOUNT. Five of six call sites had no length guard,
// so a present 0-data account threw a RangeError instead of reading as anything
// — and a stranger can create one at any vault's derived ATA for one lamport.
{
  const T = SPL.TOKEN_PROGRAM_ID
  const acct = amt => { const b = Buffer.alloc(165); b.writeBigUInt64LE(amt, 64); return { owner: T, data: b } }
  t('a real token account reads its amount', String(SPL.readTokenAccount(acct(4242n)).amount), '4242')
  t('an ABSENT account is absent, not zero', SPL.readTokenAccount(null).state, 'absent')
  t('a POISONED 0-data account is malformed, and does not throw',
    SPL.readTokenAccount({ owner: T, data: Buffer.alloc(0) }).state, 'malformed')
  t('an account owned by someone else is FOREIGN',
    SPL.readTokenAccount({ owner: '11111111111111111111111111111111', data: Buffer.alloc(165) }).state, 'foreign')
  // The emptiness PROOF is the one place absent-read-as-zero is catastrophic:
  // it would prove a split that never happened with an ATA that never existed.
  t('an ABSENT ata does NOT prove emptiness', SPL.isProvablyEmpty(null), false)
  t('a poisoned ata does NOT prove emptiness', SPL.isProvablyEmpty({ owner: T, data: Buffer.alloc(0) }), false)
  t('a genuine, readable, zero ata DOES', SPL.isProvablyEmpty(acct(0n)), true)
  let threw = ''
  try { SPL.requireTokenAmount(null, 'the pool account', 'ADDR') } catch (e) { threw = e.message }
  t('a money path REFUSES an absent account instead of reading it as 0',
    /does not exist/.test(threw), true)
  t('...and reads a good one normally', String(SPL.requireTokenAmount(acct(7n), 'x', 'y')), '7')
}

// THE FOUR COLLECTION KEYS ARE WATCHED. `collections_disagree` read them and
// none was in the watch list, so the mechanism built to close the
// wired-to-nothing class did not cover the CRITICAL sitting next to it.
t('every collection key the standing checks read is in the watch list',
  D.COLLECTION_KEYS.filter(k => !D.WATCHED_KEYS.includes(k)), [])
t('a reader that stops producing gov.collection is CAUGHT, not read as agreement',
  // The key must be genuinely ABSENT: `Object.keys` still lists one whose value
  // is `undefined`, so setting it to undefined proves nothing. (It did not, and
  // this assertion failed until the test matched the mechanism.)
  D.missingWatchedKeys(Object.fromEntries(
    D.WATCHED_KEYS.filter(k => k !== 'gov.collection').map(k => [k, 'x']))),
  ['gov.collection'])
t('...and a reader producing all of them is quiet',
  D.missingWatchedKeys(Object.fromEntries(D.WATCHED_KEYS.map(k => [k, 'x']))), [])

// A cycle closed as "someone else split it" must point at a real split on chain
// that no other cycle claims. Round 10 closed "two rows, one sig" and opened
// "one real split, no claimant, stolen by a later row".
{
  const T = Date.parse('2026-08-01T00:00:00Z')
  const later = { now: T + 7200_000 }
  t('a splitByOther cycle with NO unclaimed split on chain is reported',
    D.detectSplitClaims([], { cycles: [{ startedAt: '2026-08-01T00:00:00Z', splitByOther: true }] }, later)
      .some(f => f.kind === 'split_by_other_unanchored'), true)
  // ROUND 12: ATTRIBUTION, NOT CARDINALITY. This assertion used to pass a bare
  // `'orphanSig'` with no temporal relationship to the cycle at all — so the
  // test I wrote in round 11 certified the very weakness an auditor then found.
  const anchorAt = ts => ({ sig: 'anchor' + ts, blockTime: Math.floor(Date.parse(ts) / 1000) })
  t('...and one with a real unclaimed split AFTER its return is QUIET',
    D.detectSplitClaims([anchorAt('2026-08-01T00:30:00Z')],
      { cycles: [{ startedAt: '2026-08-01T00:00:00Z', returnedAt: '2026-08-01T00:20:00Z', splitByOther: true }] },
      later).some(f => f.kind === 'split_by_other_unanchored'), false)
  t('a split that landed BEFORE the cycle returned cannot vouch for it',
    D.detectSplitClaims([anchorAt('2026-07-30T00:00:00Z')],
      { cycles: [{ startedAt: '2026-08-01T00:00:00Z', returnedAt: '2026-08-01T00:20:00Z', splitByOther: true }] },
      later).some(f => f.kind === 'split_by_other_unanchored'), true)
  t('ONE unclaimed split cannot vouch for TWO cycles',
    D.detectSplitClaims([anchorAt('2026-08-01T00:30:00Z')],
      { cycles: [
        { startedAt: '2026-08-01T00:00:00Z', returnedAt: '2026-08-01T00:20:00Z', splitByOther: true },
        { startedAt: '2026-08-01T00:00:00Z', returnedAt: '2026-08-01T00:21:00Z', splitByOther: true }] },
      later).some(f => f.kind === 'split_by_other_unanchored'), true)
  t('a pre-round-12 bare signature carries no time and cannot anchor',
    D.detectSplitClaims(['orphanSig'],
      { cycles: [{ startedAt: '2026-08-01T00:00:00Z', returnedAt: '2026-08-01T00:20:00Z', splitByOther: true }] },
      later).some(f => f.kind === 'split_by_other_unanchored'), true)
  t('and duplicate observations of ONE split do not inflate the anchor pool',
    D.dedupeSeenSplits([anchorAt('2026-08-01T00:30:00Z'), anchorAt('2026-08-01T00:30:00Z')]).length, 1)
  t('a split already CLAIMED by another cycle cannot also anchor a splitByOther one',
    D.detectSplitClaims(['sigA'], { cycles: [
      { startedAt: '2026-08-01T00:00:00Z', splitSig: 'sigA' },
      { startedAt: '2026-08-01T00:00:00Z', splitByOther: true }] }, later)
      .some(f => f.kind === 'split_by_other_unanchored'), true)
  t('a splitByOther cycle still inside the grace window is not asked yet',
    D.detectSplitClaims([], { cycles: [{ startedAt: '2026-08-01T00:00:00Z', splitByOther: true }] },
      { now: T + 60_000 }).some(f => f.kind === 'split_by_other_unanchored'), false)
}

// `cycle_unsplit` had no age gate at all, so it fired about a cycle that was
// being split by another process as it read.
{
  const c = { startedAt: '2026-08-01T00:00:00Z', sweptLamports: '5', returnedSats: '9',
    returnedAt: '2026-08-01T05:00:00Z' }
  const T = Date.parse('2026-08-01T05:00:00Z')
  t('a cycle whose cbBTC returned SECONDS ago is not yet unsplit-alarming',
    D.detectUnreconciledRevenue({ cycles: [c] }, { now: T + 30_000 })
      .some(f => f.kind === 'cycle_unsplit'), false)
  t('...and one that returned an hour ago and still has no split IS',
    D.detectUnreconciledRevenue({ cycles: [c] }, { now: T + 7200_000 })
      .some(f => f.kind === 'cycle_unsplit'), true)
}

// PINNING AN ANCHOR ACCOUNT BEFORE READING BYTE OFFSETS OUT OF IT.
{
  const prog = { toBase58: () => 'PROG111111111111111111111111111111111111111' }
  const other = { toBase58: () => 'OTHER11111111111111111111111111111111111111' }
  const mk = (disc, ver, owner = prog) => ({ owner, data: Buffer.concat([disc, Buffer.from([ver]), Buffer.alloc(64)]) })
  const good = AN.accountDiscriminator('MintConfig')
  const threw = f => { try { f(); return '' } catch (e) { return e.message } }
  t('a correctly pinned account reads', !!AN.pinnedAccountData(mk(good, 1), { program: prog, struct: 'MintConfig' }), true)
  t('an ABSENT account is the caller\'s to interpret, not a throw',
    AN.pinnedAccountData(null, { program: prog, struct: 'MintConfig' }), null)
  t('the WRONG OWNER is refused',
    /not/.test(threw(() => AN.pinnedAccountData(mk(good, 1, other), { program: prog, struct: 'MintConfig' }))), true)
  t('the WRONG DISCRIMINATOR is refused', /discriminator/.test(threw(() =>
    AN.pinnedAccountData(mk(AN.accountDiscriminator('SomethingElse'), 1), { program: prog, struct: 'MintConfig' }))), true)
  t('an UNKNOWN LAYOUT VERSION is refused rather than misread', /version/.test(threw(() =>
    AN.pinnedAccountData(mk(good, 2), { program: prog, struct: 'MintConfig' }))), true)
  t('and an instruction discriminator is NOT an account discriminator',
    AN.accountDiscriminator('MintConfig').equals(
      (await import('crypto')).createHash('sha256').update('global:MintConfig').digest().subarray(0, 8)), false)
}

// A bound can be wedged as well as loosened, and only one direction was watched.
t('a cooldown stretched to a week is reported', D.detectStandingRisks(
  { 'mint.sweep_cooldown_secs': 7 * 24 * 3600, 'mint.max_sweep_lamports': '50000000000' })
  .some(f => f.kind === 'sweep_cooldown_wedged'), true)
t('a cap tightened to dust is reported', D.detectStandingRisks(
  { 'mint.sweep_cooldown_secs': 3600, 'mint.max_sweep_lamports': '500000' })
  .some(f => f.kind === 'sweep_cap_wedged'), true)
t('...and a workable pair is QUIET in both directions', D.detectStandingRisks(
  { 'mint.sweep_cooldown_secs': 3600, 'mint.max_sweep_lamports': '50000000000' })
  .some(f => f.kind === 'sweep_cap_wedged' || f.kind === 'sweep_cooldown_wedged'), false)

// ═════════════════════════════════ v6 (stage 4) ═════════════════════════════════

console.log('── v6: the layouts ARE the Rust structs ──')
{
  const rs = f => fsx.readFileSync(`/opt/cbob-vaults/${f}`, 'utf8')
  for (const [name, s] of Object.entries(L.STRUCTS)) {
    t(`layout.mjs ${name} equals \`pub struct ${s.struct}\` in ${s.src.split('/')[1]}, field for field`,
      JSON.stringify(L.parseRustStruct(rs(s.src), s.struct)) === JSON.stringify(s.fields), true)
  }
  // BOTH WAYS: a field added to the Rust and not here is caught, and so is one
  // whose TYPE changed while its name did not (an i64 -> u64 is invisible to a
  // name-only comparison and moves nothing, but reads negative values wrong).
  {
    const src = rs(L.STRUCTS.MintConfig.src)
    const grown = src.replace('    pub monthly_secs: i64,', '    pub monthly_secs: i64,\n    pub new_field: u64,')
    t('...and a field added to the Rust and not here is CAUGHT',
      JSON.stringify(L.parseRustStruct(grown, 'MintConfig')) === JSON.stringify(L.STRUCTS.MintConfig.fields), false)
    const retyped = src.replace('    pub last_sweep_at: i64,', '    pub last_sweep_at: u64,')
    t('...and a changed TYPE under the same name is CAUGHT',
      JSON.stringify(L.parseRustStruct(retyped, 'MintConfig')) === JSON.stringify(L.STRUCTS.MintConfig.fields), false)
    t('...and the parser returns null for a struct that is not there, rather than []',
      L.parseRustStruct(src, 'NoSuchStruct'), null)
  }
  // THE OFFSETS THE PROGRAMS PIN ACROSS PROGRAM BOUNDARIES. GOV and BURN read
  // MINT's config (and GOV reads VaultRecord) by raw offset; every one of those
  // constants must equal the offset this layout computes.
  const pinned = (file, re) => Object.fromEntries([...rs(file).matchAll(re)].map(m => [m[1], Number(m[2])]))
  const gov = pinned('programs/cbob-vault-gov/src/lib.rs', /^const OFF_(\w+): usize = (\d+);/gm)
  const burn = pinned('programs/cbob-vault-burn/src/lib.rs', /^const OFF_(\w+): usize = (\d+);/gm)
  const M = L.offsets('MintConfig'), V = L.offsets('VaultRecord'), B = L.offsets('BurnConfig'), S0 = L.offsets('SealConfig')
  const want = [
    ['GOV OFF_MINT_GOVERNANCE', gov.MINT_GOVERNANCE, M.governance],
    ['GOV OFF_MINT_MINTED_TOTAL', gov.MINT_MINTED_TOTAL, M.minted_total],
    ['GOV OFF_MINT_BARE_RETIRED', gov.MINT_BARE_RETIRED, M.bare_burns_retired],
    ['GOV OFF_MINT_CHARTER_CLOSES', gov.MINT_CHARTER_CLOSES, M.charter_closes_at],
    ['GOV OFF_MINT_SOL_RESERVE', gov.MINT_SOL_RESERVE, M.sol_reserve_lamports],
    ['GOV OFF_MINT_MAX_SWEEP', gov.MINT_MAX_SWEEP, M.max_sweep_lamports],
    ['GOV OFF_MINT_COOLDOWN', gov.MINT_COOLDOWN, M.sweep_cooldown_secs],
    ['GOV OFF_BURN_TOTAL', gov.BURN_TOTAL, B.burned_total],
    ['GOV OFF_REC_ASSET', gov.REC_ASSET, V.asset],
    ['GOV OFF_REC_INDEX', gov.REC_INDEX, V.mint_index],
    ['BURN OFF_MINT_MINTED_TOTAL', burn.MINT_MINTED_TOTAL, M.minted_total],
    ['BURN OFF_MINT_BARE_RETIRED', burn.MINT_BARE_RETIRED, M.bare_burns_retired],
    ['BURN OFF_COLLECTION (SEAL)', burn.COLLECTION, S0.collection],
    ['BURN OFF_RESERVES (SEAL)', burn.RESERVES, S0.reserve_mints],
  ]
  t('every cross-program offset the PROGRAMS pin equals the one this layout computes',
    want.filter(([, a, b]) => a !== b).map(([n, a, b]) => `${n}: rust ${a}, layout ${b}`), [])
  t('...and the scrape found every one of them (none undefined)', want.filter(([, a]) => a === undefined).map(([n]) => n), [])
  // AND THE SUITE'S OWN COPIES. tests/3prog.test.ts reads the same accounts by
  // its own OFF_ constants; a drifted copy there certifies against the wrong byte.
  const testOff = pinned('tests/3prog.test.ts', /\bOFF_(\w+)=(\d+)/g)
  const suite = [['GOVERNANCE', M.governance], ['ROUND_ID', M.round_id], ['PRICE', M.price], ['MINTED_TOTAL', M.minted_total],
    ['SALES_STOPPED', M.sales_stopped], ['SWEEP_STOPPED', M.sweep_stopped], ['GUARDIAN', M.guardian],
    ['SWAP_OPERATOR', M.swap_operator], ['SWEEP_COOLDOWN', M.sweep_cooldown_secs], ['LEVEL_CAPS', M.level_caps],
    ['LEVEL_MINTED', M.level_minted], ['REVEALED', M.revealed_total], ['CHARTER_CLAIMED', M.charter_claimed],
    ['REC_INDEX', V.mint_index], ['REC_REVEAL', V.reveal_slot], ['REC_LEVEL', V.level], ['REC_CHARTER', V.charter],
    ['REC_SET', V.entropy_set], ['REC_ENTROPY', V.entropy]]
  t("the on-chain suite's own offset constants agree with the layout",
    suite.filter(([k, v]) => testOff[k] !== v).map(([k, v]) => `${k}: suite ${testOff[k]}, layout ${v}`), [])
  // DECODE: round trip, and every refusal names its reason.
  const mc = Object.fromEntries(L.STRUCTS.MintConfig.fields.map(([f, ty]) => [f,
    ty === 'Pubkey' ? '11111111111111111111111111111111' : ty === 'bool' ? false : ty === '[u32; 5]' ? [1, 2, 3, 4, 5]
    : ty === '[u8; 32]' ? '00'.repeat(32) : /^u(64|128)$|^i64$/.test(ty) ? 7n : 7]))
  mc.version = 4; mc.acc_scaled = (1n << 100n) + 3n; mc.last_distribute_at = -5n; mc.sales_stopped = true
  const enc = L.encode('MintConfig', mc)
  const dec = L.decode('MintConfig', enc)
  t('a MintConfig round-trips, u128 and negative i64 included',
    [dec.acc_scaled === mc.acc_scaled, dec.last_distribute_at === -5n, dec.sales_stopped, dec.level_caps.join()], [true, true, true, '1,2,3,4,5'])
  t('...and its fixed part is the length the program allocates before padding', enc.length, L.fixedLength('MintConfig'))
  const refuse = f => { try { f(); return 'accepted' } catch (e) { return e.message } }
  t('a bool byte that is neither 0 nor 1 is REFUSED, not read as true',
    /neither 0 nor 1/.test(refuse(() => { const b = Buffer.from(enc); b[L.offsets('MintConfig').sales_stopped] = 2; L.decode('MintConfig', b) })), true)
  t('a wrong layout version is refused', /layout version 3/.test(refuse(() => { const b = Buffer.from(enc); b[8] = 3; L.decode('MintConfig', b) })), true)
  t('a wrong discriminator is refused', /discriminator/.test(refuse(() => L.decode('VaultRecord', enc))), true)
  t('a truncated account is refused, not zero-filled', /truncated/.test(refuse(() => L.decode('MintConfig', enc.subarray(0, 300)))), true)
  const sc = L.encode('SealConfig', { version: 2, collection: '11111111111111111111111111111111',
    reserve_mints: ['So11111111111111111111111111111111111111112', '11111111111111111111111111111111'], bump: 254 })
  t('a SealConfig Vec<Pubkey> decodes, and the field after it lands right',
    [L.decode('SealConfig', sc).reserve_mints.length, L.decode('SealConfig', sc).bump], [2, 254])
  t('...and an incredible Vec length is refused',
    /not credible/.test(refuse(() => { const b = Buffer.from(sc); b.writeUInt32LE(9999, 41); L.decode('SealConfig', b) })), true)
  t('readPinned refuses an account owned by the wrong program',
    /not .*Gsb7/.test(refuse(() => L.readPinned('MintConfig', { owner: { toBase58: () => 'Someone' }, data: enc }, class { constructor(k) { this.k = k } toBase58() { return this.k } }))), true)
  // THE COLLECTION'S PLUGIN HASH: blind to the mint counters, not to the royalty.
  const coll = (minted, plugin) => { const name = Buffer.from('CBOB'), uri = Buffer.from('u')
    const n = Buffer.alloc(4); n.writeUInt32LE(name.length); const u = Buffer.alloc(4); u.writeUInt32LE(uri.length)
    const c = Buffer.alloc(8); c.writeUInt32LE(minted); c.writeUInt32LE(minted, 4)
    return Buffer.concat([Buffer.from([5]), Buffer.alloc(32), n, name, u, uri, c, Buffer.from(plugin)]) }
  t('a mint (num_minted moving) does NOT change the plugin hash',
    L.collectionPluginsHash(coll(1, [9, 9, 9])) === L.collectionPluginsHash(coll(2000, [9, 9, 9])), true)
  t('...but a changed plugin byte (the royalty) DOES', L.collectionPluginsHash(coll(1, [9, 9, 9])) === L.collectionPluginsHash(coll(1, [9, 9, 8])), false)
  t('...and an account that is not a collection is named, not hashed', L.collectionPluginsHash(Buffer.alloc(80)), 'NOT_A_COLLECTION')
}

console.log('── v6: the programs\' own event lines, attributed by the invoke stack ──')
{
  const MINTID = D.MINT_PROGRAM_ID, BURNID = D.BURN_PROGRAM_ID, EVIL = 'EviL1111111111111111111111111111111111111111'
  const inv = (p, n) => `Program ${p} invoke [${n}]`, ok = p => `Program ${p} success`
  const redeemTx = [inv(BURNID, 1), inv(MINTID, 2), 'Program log: CBOB_DISTRIBUTED amount=5 path=monthly_inline', ok(MINTID),
    'Program log: CBOB_REDEEMED VauLt111', ok(BURNID)]
  const r = D.parseCbobLogs(redeemTx)
  t('a real redemption: BURN\'s REDEEMED and MINT\'s in-line DISTRIBUTED are both read',
    r.events.map(e => e.type), ['DISTRIBUTED', 'REDEEMED'])
  t('...with their fields', [r.events[1].asset, r.events[0].amount, r.events[0].path], ['VauLt111', '5', 'monthly_inline'])
  t('a CBOB_REDEEMED printed by ANOTHER program is ignored (a fake post costs nothing otherwise)',
    D.parseCbobLogs([inv(EVIL, 1), 'Program log: CBOB_REDEEMED VauLt111', ok(EVIL)]).events, [])
  t('...and a REDEEMED line printed by MINT (not BURN) is ignored too',
    D.parseCbobLogs([inv(MINTID, 1), 'Program log: CBOB_REDEEMED VauLt111', ok(MINTID)]).events, [])
  t('...and a line from a program INSIDE our call is attributed to it, not to us',
    D.parseCbobLogs([inv(MINTID, 1), inv(EVIL, 2), 'Program log: CBOB_REVEAL_RESCHEDULED asset=X mint_index=1 old_slot=1 new_slot=2 times=1', ok(EVIL), ok(MINTID)]).events, [])
  const resch = D.parseCbobLogs([inv(MINTID, 1), 'Program log: CBOB_REVEAL_RESCHEDULED asset=AAA mint_index=7 old_slot=100 new_slot=500 times=2', ok(MINTID)]).events[0]
  t('a reschedule is read with every field', [resch.asset, resch.mintIndex, resch.oldSlot, resch.newSlot, resch.times], ['AAA', '7', '100', '500', '2'])
  t('an unbalanced invoke stack is a PROBLEM, never a guess',
    D.parseCbobLogs([inv(MINTID, 1), ok(EVIL)]).problem !== null, true)
  const ev = D.detectProgramEvents([{ type: 'REVEAL_RESCHEDULED', asset: 'A', mintIndex: '1', oldSlot: '1', newSlot: '2', times: '1' },
    { type: 'CLAIM_DEFERRED_FROZEN', asset: 'B', owed: '9' }, { type: 'DISTRIBUTED', amount: '5', path: 'burn' }, { type: 'REDEEMED', asset: 'C' }], 'sig')
  t('a reschedule and a frozen deferral PAGE, URGENT (they fire once)',
    ev.filter(f => f.urgent).map(f => [f.kind, f.severity]), [['reveal_rescheduled', 'HIGH'], ['claim_deferred_frozen', 'HIGH']])
  t('...while a distribution and a redemption are INFO, not alerts', ev.filter(f => f.severity === 'INFO').map(f => f.kind), ['distributed', 'redeemed'])
}

console.log('── v6: liveness — the payout clock, the pool, the 2.1% bucket ──')
{
  const base = { 'mint.last_distribute_at': '1000', 'mint.monthly_secs': '2592000', 'mint.total_active_weight': '20', 'mint.active_count': '5' }
  const due = 1000 + 2592000
  t('OVERDUE: past the period plus grace, with weight and something to pay',
    D.detectDistributionOverdue(base, { nowSec: due + 7 * 3600, poolAvail: 50n, graceSecs: 6 * 3600 })[0]?.severity, 'CRITICAL')
  t('QUIET inside the grace window', D.detectDistributionOverdue(base, { nowSec: due + 3600, poolAvail: 50n, graceSecs: 6 * 3600 }).length, 0)
  t('QUIET with no activated vault (nobody to pay)',
    D.detectDistributionOverdue({ ...base, 'mint.total_active_weight': '0' }, { nowSec: due * 2, poolAvail: 50n }).length, 0)
  t('QUIET with nothing undistributed (nothing to pay)', D.detectDistributionOverdue(base, { nowSec: due * 2, poolAvail: 0n }).length, 0)
  t('QUIET when the pool could not be read (the pool detector reports that, not this one)',
    D.detectDistributionOverdue(base, { nowSec: due * 2, poolAvail: null }).length, 0)
  const owed = { 'mint.owed_scaled': String(30n * AC.ACC_SCALE + 1n) }
  t('a healthy pool is QUIET', D.detectPoolHealth(owed, { state: 'ok', amount: 100n, frozen: false }), [])
  t('a pool holding EXACTLY what it owes is quiet (ceil)', D.detectPoolHealth(owed, { state: 'ok', amount: 31n, frozen: false }), [])
  t('a pool holding a sat LESS than it owes is INSOLVENT, CRITICAL',
    D.detectPoolHealth(owed, { state: 'ok', amount: 30n, frozen: false }).map(f => [f.kind, f.severity]), [['pool_insolvent', 'CRITICAL']])
  t('a FROZEN pool is CRITICAL and URGENT',
    D.detectPoolHealth(owed, { state: 'ok', amount: 100n, frozen: true }).map(f => [f.kind, f.urgent]), [['pool_frozen', true]])
  t('an absent/foreign/malformed pool is CRITICAL, never a zero',
    ['absent', 'foreign', 'malformed'].map(st => D.detectPoolHealth(owed, { state: st, amount: 0n })[0]?.kind), ['pool_unreadable', 'pool_unreadable', 'pool_unreadable'])
  t('poolAvailable is the program\'s arithmetic', D.poolAvailable(owed, 100n), 69n)
  // THE BUCKET, BURN's arithmetic line for line.
  const bk = (live, units, last) => ({ 'mint.minted_total': String(live), 'burn.burned_total': '0', 'mint.bare_burns_retired': '0',
    'burn.redeem_window_secs': '3600', 'burn.rate_units': String(units), 'burn.rate_last_at': String(last) })
  t('2,100 live vaults: cap is ceil(2100 x 2.1%) = 45 an hour', String(D.redemptionCapacity(bk(2100, 0, 0), 10_000_000).cap), '45')
  t('...a long-idle bucket is FULL (45 left)', String(D.redemptionCapacity(bk(2100, 0, 0), 10_000_000).remaining), '45')
  t('...and an EMPTY one has 0 left and pages', D.detectRedemptionRate(bk(2100, 0, 1000), 1000)[0]?.kind, 'redemptions_near_cap')
  t('...and NEAR empty (under 20%) pages too', D.detectRedemptionRate(bk(2100, 3600 * 8, 1000), 1000).length, 1)
  t('...while a comfortable bucket is QUIET', D.detectRedemptionRate(bk(2100, 3600 * 30, 1000), 1000).length, 0)
  t('3 live vaults: the floor of ONE an hour holds (the last ones can always leave)', String(D.redemptionCapacity(bk(3, 0, 0), 10_000_000).cap), '1')
  t('...and refill: one window after an empty bucket at cap 1, exactly one is back',
    String(D.redemptionCapacity(bk(3, 0, 1000), 1000 + 3600).remaining), '1')
  t('an unreadable bucket is null, never a guess', D.redemptionCapacity({}, 1), null)
  // THE BRAKES: pulled and released, each once, URGENT.
  t('the brake PULLED is CRITICAL and URGENT',
    D.detectBrakeTransitions({ 'mint.sales_stopped': false }, { 'mint.sales_stopped': true }).map(f => [f.kind, f.severity, f.urgent]), [['brake_pulled', 'CRITICAL', true]])
  t('...the sweep brake too', D.detectBrakeTransitions({ 'mint.sweep_stopped': false }, { 'mint.sweep_stopped': true })[0]?.kind, 'brake_pulled')
  t('a RELEASE (only a vote can) is HIGH and URGENT',
    D.detectBrakeTransitions({ 'mint.sales_stopped': true }, { 'mint.sales_stopped': false }).map(f => [f.kind, f.severity, f.urgent]), [['brake_released', 'HIGH', true]])
  t('QUIET with no change, and on the first ever pass',
    [D.detectBrakeTransitions({ 'mint.sales_stopped': true }, { 'mint.sales_stopped': true }).length, D.detectBrakeTransitions(null, { 'mint.sales_stopped': true }).length], [0, 0])
  t('the brakes are NOT also in the drift list (one transition, one page)',
    D.detectConfigDrift({ 'mint.sales_stopped': false }, { 'mint.sales_stopped': true }).length, 0)
  t('...but the reader must still produce them', ['mint.sales_stopped', 'mint.sweep_stopped'].every(k => D.WATCHED_KEYS.includes(k)), true)
  // THE LOCK DATE.
  const progs = { 'prog.seal.upgrade_authority': 'Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb', 'prog.mint.upgrade_authority': 'IMMUTABLE',
    'prog.burn.upgrade_authority': 'IMMUTABLE', 'prog.gov.upgrade_authority': 'IMMUTABLE' }
  t('an upgradeable program PAST the lock date is CRITICAL',
    D.detectUpgradeAuthorityAfterLock(progs, { lockDeadlineSec: 100, nowSec: 200 }).map(f => f.kind), ['program_not_locked'])
  t('...quiet before the date (the deploy needs the key)', D.detectUpgradeAuthorityAfterLock(progs, { lockDeadlineSec: 300, nowSec: 200 }).length, 0)
  t('...quiet with no date configured', D.detectUpgradeAuthorityAfterLock(progs, { nowSec: 200 }).length, 0)
  t('...and quiet once every program is IMMUTABLE',
    D.detectUpgradeAuthorityAfterLock({ ...progs, 'prog.seal.upgrade_authority': 'IMMUTABLE' }, { lockDeadlineSec: 100, nowSec: 200 }).length, 0)
}

console.log('── v6: standing risks and drift, on the v6 config ──')
{
  t('an ARMED swap-operator replacement is CRITICAL every pass',
    D.detectStandingRisks({ 'mint.pending_swap_operator': OTHER, 'mint.pending_swap_operator_at': '9' }).some(f => f.kind === 'swap_operator_armed'), true)
  t('...and the default pubkey is not armed',
    D.detectStandingRisks({ 'mint.pending_swap_operator': D.DEFAULT_PUBKEY }).some(f => f.kind === 'swap_operator_armed'), false)
  t('a STOPPED sale is visible at INFO, not paged every pass',
    D.detectStandingRisks({ 'mint.sales_stopped': true }).map(f => [f.kind, f.severity]), [['sales_stopped', 'INFO']])
  t('a retired guardian is visible at INFO', D.detectStandingRisks({ 'mint.guardian': D.DEFAULT_PUBKEY })[0]?.kind, 'guardian_retired')
  t('PRODUCTION: a test-length payout period or redemption window is CRITICAL (fixed forever at initialize)',
    D.detectStandingRisks({ 'mint.monthly_secs': '150', 'burn.redeem_window_secs': '10' }, { production: true })
      .filter(f => f.kind === 'test_value_in_production').length, 2)
  t('...the real values are QUIET', D.detectStandingRisks({ 'mint.monthly_secs': '2592000', 'burn.redeem_window_secs': '3600' }, { production: true }).length, 0)
  t('...and a test chain is not judged on them', D.detectStandingRisks({ 'mint.monthly_secs': '150' }).length, 0)
  const FOREVER = ['mint.split_bps', 'mint.bank_treasury', 'mint.pool_ata', 'mint.max_supply', 'mint.pob_root',
    'mint.charter_closes_at', 'mint.monthly_secs', 'burn.redeem_window_secs', 'gov.quorum_bps', 'gov.min_voting_secs', 'mint.level_caps']
  t('every value fixed forever at initialize drifts as CRITICAL',
    FOREVER.filter(k => D.detectConfigDrift({ [k]: 'a' }, { [k]: 'b' })[0]?.severity !== 'CRITICAL'), [])
  t('supply growing (minted_total) is a STATUS, not a drift alert',
    D.detectConfigDrift({ 'mint.minted_total': '5' }, { 'mint.minted_total': '6' }).length, 0)
  t('the collection plugins (the 10% royalty) drift as CRITICAL',
    D.detectConfigDrift({ 'collection.plugins_hash': 'a' }, { 'collection.plugins_hash': 'b' })[0]?.severity, 'CRITICAL')
  t('a change to the PROOF OF BURN collection\'s plugins is CRITICAL (red-team 2: it can kill every charter claim)',
    D.detectConfigDrift({ 'pob_collection.plugins_hash': 'a' }, { 'pob_collection.plugins_hash': 'b' })[0]?.severity, 'CRITICAL')
  t('no v5 key survives in the watch list (bank, admin, treasury, deck, distributor)',
    D.WATCHED_KEYS.filter(k => /\.(bank|admin|treasury|deck_\w+|pending_bank\w*|pending_admin\w*|pending_governance\w*)$/.test(k)), [])
}

console.log('── v6: the crank plans only what the program will accept ──')
{
  // `x` after the index: padding `Asset1` and `Asset11` with 1s collides them.
  const A = i => `Asset${i}x`.padEnd(32, '1')
  const rec = (i, o = {}) => ({ address: `Rec${i}`, asset: A(i), mint_index: BigInt(i), reveal_slot: 1000n, level: 0,
    entropy_set: false, active: false, retired: false, vault_ata: `Ata${i}`, debt_scaled: 0n, attrs_hash: '', ...o })
  const cfg0 = { revealed_total: 0n, acc_scaled: 0n, total_active_weight: 0n, owed_scaled: 0n, last_distribute_at: 0n, monthly_secs: 2592000n }
  const pool0 = { state: 'ok', amount: 0n, frozen: false }
  const plan = (o = {}) => CR.planCrank({ cfg: cfg0, records: [], assets: {}, tokens: {}, pool: pool0, slot: 5000, nowSec: 100, ...o })
  const ready = CR.readySlot(1000)
  t('readySlot is two 4-slot leader groups past the last hash (MINT try_capture)', ready, 1016)
  t('a lapsed draw (window passed, no entropy) is RESCHEDULED, never defaulted',
    plan({ records: [rec(0)], slot: 1000 + 301 }).reschedule, ['Rec0'])
  t('...not before the window has passed', plan({ records: [rec(0)], slot: 1000 + 300 }).reschedule, [])
  t('a draw whose three hashes now exist is CAPTURED', plan({ records: [rec(0)], slot: ready + 1 }).capture, ['Rec0'])
  t('...not while the third hash does not exist yet', plan({ records: [rec(0)], slot: ready }).capture, [])
  t('reveals run STRICTLY in mint order from revealed_total, and stop at the first not ready',
    plan({ records: [rec(0, { entropy_set: true }), rec(1, { entropy_set: true }), rec(2), rec(3, { entropy_set: true })], slot: 1001 }).reveal, ['Rec0', 'Rec1'])
  t('...and a capture planned this pass counts as ready for its reveal',
    plan({ records: [rec(0)], slot: ready + 1 }).reveal, ['Rec0'])
  t('...and nothing is revealed when the head of the queue is not ready',
    plan({ cfg: { ...cfg0, revealed_total: 1n }, records: [rec(0, { level: 2 }), rec(1), rec(2, { entropy_set: true })], slot: 1001 }).reveal, [])
  const tok = (amount, o = {}) => ({ state: 'ok', amount, frozen: false, address: 'x', ...o })
  t('a LIVE revealed vault at exactly 21,000 sats is ACTIVATED',
    plan({ records: [rec(0, { level: 1 })], assets: { [A(0)]: 'live' }, tokens: { [A(0)]: tok(21000n) } }).activate, ['Rec0'])
  t('...at 20,999 it is not', plan({ records: [rec(0, { level: 1 })], assets: { [A(0)]: 'live' }, tokens: { [A(0)]: tok(20999n) } }).activate, [])
  t('...nor before its level is drawn, nor when burned, nor twice',
    [plan({ records: [rec(0)], assets: { [A(0)]: 'live' }, tokens: { [A(0)]: tok(99999n) } }).activate.length,
     plan({ records: [rec(0, { level: 1 })], assets: { [A(0)]: 'burned' }, tokens: { [A(0)]: tok(99999n) } }).activate.length,
     plan({ records: [rec(0, { level: 1, active: true })], assets: { [A(0)]: 'live' }, tokens: { [A(0)]: tok(99999n) } }).activate.length], [0, 0, 0])
  t('a bare-burned, unretired vault is RETIRED (its share back to the pool)',
    plan({ records: [rec(0, { level: 3 })], assets: { [A(0)]: 'burned' } }).retireBurned, ['Rec0'])
  t('...but not one already retired, and not a live one',
    [plan({ records: [rec(0, { level: 3, retired: true })], assets: { [A(0)]: 'burned' } }).retireBurned.length,
     plan({ records: [rec(0, { level: 3 })], assets: { [A(0)]: 'live' } }).retireBurned.length], [0, 0])
  const cfgD = { ...cfg0, total_active_weight: 2n, last_distribute_at: 0n, monthly_secs: 100n }
  t('the monthly distribution runs FREE once due, with weight and something to pay',
    plan({ cfg: cfgD, pool: { ...pool0, amount: 50n }, nowSec: 100 }).distribute, true)
  t('...not before it is due', plan({ cfg: cfgD, pool: { ...pool0, amount: 50n }, nowSec: 99 }).distribute, false)
  t('...not with nothing undistributed', plan({ cfg: { ...cfgD, owed_scaled: 50n * AC.ACC_SCALE }, pool: { ...pool0, amount: 50n }, nowSec: 100 }).distribute, false)
  t('...not with no activated weight', plan({ cfg: { ...cfgD, total_active_weight: 0n }, pool: { ...pool0, amount: 50n }, nowSec: 100 }).distribute, false)
  // CLAIMS: delivered at the post-distribution accumulator, batched, never into a
  // missing account, frozen ones deferred.
  const act = (i, level, o = {}) => rec(i, { level, active: true, vault_ata: `Ata${i}`, ...o })
  const toks = n => Object.fromEntries([...Array(n)].map((_, i) => [A(i), tok(0n, { address: `Ata${i}` })]))
  const p1 = plan({ cfg: { ...cfgD, total_active_weight: 2n }, records: [act(0, 1)], tokens: toks(1), pool: { ...pool0, amount: 50n }, nowSec: 100 })
  t('a vault owed by THIS pass\'s distribution is delivered in the same pass', p1.claims, [[['Rec0', 'Ata0']]])
  const many = [...Array(30)].map((_, i) => act(i, 1))
  const pm = plan({ cfg: { ...cfgD, total_active_weight: 60n, acc_scaled: 10n * AC.ACC_SCALE }, records: many, tokens: toks(30), nowSec: 0 })
  t('claims are batched 14 per transaction (the measured legacy limit)', pm.claims.map(b => b.length), [14, 14, 2])
  t('a vault owed under one whole sat is not sent (it would pay nothing)',
    plan({ cfg: { ...cfgD, acc_scaled: AC.ACC_SCALE / 3n }, records: [act(0, 1)], tokens: toks(1), nowSec: 0 }).claims, [])
  t('a FROZEN destination is deferred and reported, not sent',
    (() => { const p = plan({ cfg: { ...cfgD, acc_scaled: 10n * AC.ACC_SCALE }, records: [act(0, 1)], tokens: { [A(0)]: tok(0n, { address: 'Ata0', frozen: true }) }, nowSec: 0 })
      return [p.claims.length, p.deferredFrozen.map(d => String(d.owed))] })(), [0, ['20']])
  t('a MISSING destination is left out of every batch and reported (it would refuse the whole batch on chain)',
    (() => { const p = plan({ cfg: { ...cfgD, acc_scaled: 10n * AC.ACC_SCALE }, records: [act(0, 1), act(1, 1)], tokens: { [A(0)]: tok(0n, { address: 'Ata0' }), [A(1)]: { state: 'absent', amount: 0n } }, nowSec: 0 })
      return [p.claims, p.problems.length] })(), [[[['Rec0', 'Ata0']]], 1])
  t('...and a destination that is not the RECORDED account is refused the same way',
    plan({ cfg: { ...cfgD, acc_scaled: 10n * AC.ACC_SCALE }, records: [act(0, 1)], tokens: { [A(0)]: tok(0n, { address: 'NotAta0' }) }, nowSec: 0 }).claims, [])
  t('a FROZEN pool plans no claims at all, and says why',
    (() => { const p = plan({ cfg: { ...cfgD, acc_scaled: 10n * AC.ACC_SCALE }, records: [act(0, 1)], tokens: toks(1), pool: { ...pool0, frozen: true }, nowSec: 0 })
      return [p.claims.length, p.problems.some(x => /FROZEN/.test(x))] })(), [0, true])
  t('the reveal-only fast lane plans reveals and NOTHING else',
    (() => { const p = CR.planCrank({ cfg: { ...cfgD, acc_scaled: 10n * AC.ACC_SCALE }, records: [rec(0), act(1, 1, { mint_index: 1n })], assets: {}, tokens: toks(2),
      pool: { ...pool0, amount: 50n }, slot: ready + 1, nowSec: 999 }, { revealOnly: true })
      return [p.capture.length, p.distribute, p.claims.length, p.activate.length] })(), [1, false, 0, 0])
  // THE FEE PAYER IS NEVER A HONEYPOT.
  t('a crank key above the 0.25 SOL ceiling is REFUSED', CR.judgeFeePayer(CR.FEE_CEILING_LAMPORTS + 1n).ok, false)
  t('...one below the floor is refused too', CR.judgeFeePayer(CR.FEE_FLOOR_LAMPORTS - 1n).ok, false)
  t('...and a fee-sized balance runs', CR.judgeFeePayer(50_000_000n).ok, true)
  // THE ATTRIBUTE HASH IS THE PROGRAM'S: Borsh Vec<VaultAttribute>, sha256.
  const list = [{ key: 'charter', value: 'Pob1' }, { key: 'k', value: 'v' }]
  t('attrsBorsh is u32 count, then u32-length-prefixed key and value',
    CR.attrsBorsh([{ key: 'ab', value: 'c' }]).toString('hex'), '01000000' + '02000000' + '6162' + '01000000' + '63')
  t('attrsHash is sha256 of exactly those bytes',
    CR.attrsHash(list), (await import('crypto')).createHash('sha256').update(CR.attrsBorsh(list)).digest('hex'))
  t('...and order matters (Core stores a list, the program hashed that list)',
    CR.attrsHash(list) === CR.attrsHash([...list].reverse()), false)
  t('the crank\'s instruction discriminators are COMPUTED, never typed',
    CR.ixDisc('reveal_level').toString('hex'), (await import('crypto')).createHash('sha256').update('global:reveal_level').digest().subarray(0, 8).toString('hex'))
  t('crank.mjs sends only permissionless MINT instructions (no transfer, no system move of value)',
    (() => { const src = fsx.readFileSync('/opt/cbob-vaults/bank/crank.mjs', 'utf8')
      const used = [...src.matchAll(/d\('(\w+)'\)/g)].map(m => m[1]).sort()
      return [...new Set(used)] })(), ['activate', 'capture_entropy', 'claim', 'distribute', 'reschedule_reveal', 'retire_burned', 'reveal_level'])
  t('...and the distribute it sends is the FREE path (burn = 0), never a $GARY burn from the crank key',
    /d\('distribute'\), Buffer\.from\(\[0\]\)/.test(fsx.readFileSync('/opt/cbob-vaults/bank/crank.mjs', 'utf8')), true)
  t('crank.mjs is DRY-RUN unless --live is passed', /if \(!LIVE\) \{ console\.log\('\\nDRY RUN/.test(fsx.readFileSync('/opt/cbob-vaults/bank/crank.mjs', 'utf8')), true)
}

console.log('── v6: the payout arithmetic is the program\'s ──')
{
  t('accrual credit equals the Rust formula (delta = avail x 1e12 / W; owed += delta x W)',
    (() => { const c = AC.credit({ acc: 0n, owed: 0n }, 7n, 3n); return [String(c.acc), String(c.owed)] })(),
    [String(7n * AC.ACC_SCALE / 3n), String((7n * AC.ACC_SCALE / 3n) * 3n)])
  t('Level V is exactly 3x Level I', AC.weightOf(5) / AC.weightOf(1), 3n)
  t('the crank and the program use the same weights (2..6)', AC.WEIGHTS.map(String), ['2', '3', '4', '5', '6'])
  t('layout.mjs and accrual.mjs agree on the scale', L.ACC_SCALE === AC.ACC_SCALE, true)
}

console.log('── v6: the redemption post (drafted, never sent) ──')
{
  const p = PO.draftPost({ mintIndex: 7, level: 2, released: [{ mint: L.CBBTC_MINT, amount: 21000n }] })
  t('the draft passes every copy rule', p.problems, [])
  t('...and states only the figures read off the chain', p.x, 'Vault No. 0007 (Level II) has been redeemed. 0.00021 BTC was released to its holder. The vault no longer exists.')
  t('the poster has no sender in it (asserted in its own selftest too)',
    /api\.x\.com|zernio/i.test(fsx.readFileSync('/opt/cbob-vaults/bank/redemption-poster.mjs', 'utf8').split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l)).filter(l => !/new RegExp|SENDER/.test(l)).join('\n')), false)
}

// A FLOOR ON THESE TOO. `process.exit(bad.length ? 1 : 0)` cannot tell "all
// passed" from "the file threw after two assertions and both of those passed",
// and this file is the only proof most of the pipeline has.
// ROUND 14: this said 195 against a real count of 221 while the commit beside it
// added an EXTERNAL floor and claimed "every floor equals its real count". A
// floor 26 below reality is the same defeat round 12 fixed on-chain, left
// standing in the fix for it — and SPEC documents running this file DIRECTLY,
// which bypasses the runner's floor entirely. It is the current count.
const FLOOR = 439
const bad = R.filter(r => !r.ok)
// ⚠️ ROUND 19: EQUALITY, NOT A LOWER BOUND — the same repair as floor() in
// scripts/run-tests.sh. A `<` check accumulates slack, and slack is what a
// floor exists to remove: the on-chain floor sat two assertions under its
// real count for a whole round because nothing demanded they match.
if (R.length !== FLOOR) {
  console.error(`\n${R.length} assertions ran; the floor says ${FLOOR}. They must be EQUAL — the file stopped early, or the floor was not moved with the suite.`)
  process.exit(1)
}
console.log(`\n${'='.repeat(60)}\n${R.length - bad.length}/${R.length} detector assertions as predicted`)
console.log(`every detector proven in BOTH directions: fires when it should, quiet when it should`)
process.exit(bad.length ? 1 : 0)
