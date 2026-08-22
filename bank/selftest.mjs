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
/** This process's own /proc start time, for the pid-recycling assertions. */
const LKstart = () => { try {
  const st = fsx.readFileSync(`/proc/${process.pid}/stat`, 'utf8')
  return st.slice(st.lastIndexOf(')') + 2).split(' ')[19] || null } catch { return null } }
import fsx from 'fs'
const R = []
const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want)
  R.push({ name, ok, got, want }); console.log(`  ${ok ? 'ok  ' : 'XX  '}${name}${ok ? '' : `\n        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`) }

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

console.log('── activation ──')
t('fires when an activated vault falls below 21,000 sats',
  D.detectDeactivations({ [ASSET]: true }, { [ASSET]: '20999' })[0].kind, 'deactivated')
t('fires when an activated vault becomes unreadable',
  D.detectDeactivations({ [ASSET]: true }, {})[0].kind, 'vault_vanished')
t('QUIET at exactly 21,000 sats',
  D.detectDeactivations({ [ASSET]: true }, { [ASSET]: '21000' }).length, 0)
t('QUIET for a vault that was never activated',
  D.detectDeactivations({ [ASSET]: false }, { [ASSET]: '0' }).length, 0)
t('an UNREADABLE balance is its own finding, never a silent zero',
  D.detectDeactivations({ [ASSET]: true }, {}, [ASSET])[0].kind, 'vault_unreadable')
t('...and it does NOT also fire a false deactivation for the same vault',
  D.detectDeactivations({ [ASSET]: true }, {}, [ASSET]).length, 1)
t('QUIET when nothing was unreadable',
  D.detectDeactivations({ [ASSET]: true }, { [ASSET]: '21000' }, []).length, 0)

console.log('── standing risks added in round 6 ──')
t('CRITICAL while a governance rotation is armed',
  D.detectStandingRisks({ 'mint.pending_governance': OTHER, 'mint.pending_governance_at': '99' })
    .some(f => f.kind === 'governance_rotation_armed'), true)
t('QUIET when the pending slot holds the default pubkey',
  D.detectStandingRisks({ 'mint.pending_governance': D.DEFAULT_PUBKEY, 'mint.pending_governance_at': '0' })
    .some(f => f.kind === 'governance_rotation_armed'), false)
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

t('CRITICAL when a transfer has no signature', D.detectDistribution(
  { days: { '2026-08-20': { startedAt: 'x', finishedAt: 'y', paid: { v1: { sig: null } } } } })
  .some(f => f.kind === 'distribution_unresolved'), true)
t('QUIET when every transfer has one', D.detectDistribution(
  { days: { '2026-08-20': { startedAt: 'x', finishedAt: 'y', paid: { v1: { sig: 'abc' } } } } },
  { today: '2026-08-21' }).length, 0)
t('HIGH when a run started and never finished', D.detectDistribution(
  { days: { '2026-08-20': { startedAt: 'x', paid: { v1: { sig: 'abc' } } } } }, { today: '2026-08-21' })
  .some(f => f.kind === 'distribution_unfinished'), true)
t('HIGH when yesterday has no record at all', D.detectDistribution(
  { days: { '2026-08-19': { startedAt: 'x', finishedAt: 'y', paid: {} } } },
  { yesterday: '2026-08-20', today: '2026-08-21' }).some(f => f.kind === 'distribution_missed'), true)
t('CRITICAL when the distribution ledger cannot be read',
  D.detectDistribution(null)[0].kind, 'distribution_ledger_unreadable')

// A repeated id must not satisfy the completeness check.
t('CRITICAL when the index repeats ids to reach the chain count',
  D.detectIndexShortfall('3', ['a', 'a', 'a'], [])[0].kind, 'index_disagrees_with_chain')
t('CRITICAL when an asset is reported BOTH live and burnt',
  D.detectIndexShortfall('2', ['a', 'b'], ['b'])[0].kind, 'index_self_contradictory')
t('QUIET when the unique counts agree with the chain exactly',
  D.detectIndexShortfall('3', ['a', 'b'], ['c']).length, 0)
t('CRITICAL when the index returns MORE than was ever minted',
  D.detectIndexShortfall('2', ['a', 'b', 'c'], []).length, 1)

t('CRITICAL on a notice period below the production minimum',
  D.detectStandingRisks({ 'mint.governance_timelock_secs': '60' })
    .some(f => f.kind === 'weak_rotation_timelock'), true)
t('QUIET on a seven-day notice period',
  D.detectStandingRisks({ 'mint.governance_timelock_secs': String(7 * 86400) })
    .some(f => f.kind === 'weak_rotation_timelock'), false)
t('CRITICAL on a one-second sweep cooldown (the program floor is not a rate limit)',
  D.detectStandingRisks({ 'mint.max_sweep_lamports': '1', 'mint.sweep_cooldown_secs': '1' })
    .some(f => f.kind === 'sweep_cooldown_too_short'), true)
t('QUIET on an hourly cooldown',
  D.detectStandingRisks({ 'mint.max_sweep_lamports': '1', 'mint.sweep_cooldown_secs': '3600' })
    .some(f => f.kind === 'sweep_cooldown_too_short'), false)
for (const k of ['mint.pending_admin', 'mint.pending_bank', 'seal.pending_bank',
                 'seal.pending_admin', 'burn.pending_bank', 'burn.pending_admin', 'gov.pending_admin']) {
  t(`CRITICAL while ${k} is armed`,
    D.detectStandingRisks({ [k]: OTHER }).some(f => f.kind === 'rotation_armed'), true)
  t(`QUIET when ${k} holds the default pubkey`,
    D.detectStandingRisks({ [k]: D.DEFAULT_PUBKEY }).some(f => f.kind === 'rotation_armed'), false)
}
t('CRITICAL when the four programs name different collections',
  D.detectStandingRisks({ 'seal.collection': OTHER, 'mint.collection': PDA })
    .some(f => f.kind === 'collections_disagree'), true)
t('QUIET when they agree',
  D.detectStandingRisks({ 'seal.collection': OTHER, 'mint.collection': OTHER, 'burn.collection': OTHER })
    .some(f => f.kind === 'collections_disagree'), false)
// ── ROUND 16: THE SAME CHECK ON THE BANK, WHICH DID NOT EXIST ──
// Three programs keep their own `bank` and rotate it independently; burn_vault
// cross-checks SEAL's against its own and reverts (WiringDiverged), so a
// disagreement means redemption is ALREADY halted. Nothing compared them, and
// `mint.bank` / `burn.bank` were not even in the watch list — the round-11
// collections finding, in the sibling field, three rounds after its fix.
t('CRITICAL when the programs name different Banks',
  D.detectStandingRisks({ 'seal.bank': OTHER, 'burn.bank': PDA })
    .some(f => f.kind === 'banks_disagree'), true)
t('...and a seal/burn divergence says REDEMPTION is halted',
  D.detectStandingRisks({ 'seal.bank': OTHER, 'burn.bank': PDA })
    .find(f => f.kind === 'banks_disagree').detail.includes('REDEMPTION is halted'), true)
// ROUND 16: the text said "REDEMPTION IS ALREADY HALTED" for ANY divergence, and
// a seal/mint divergence halts MINTING. A wrong sentence in a CRITICAL about the
// product's most sensitive path, on a case the selftest never exercised.
t('...and a seal/MINT divergence says MINTING, not redemption',
  D.detectStandingRisks({ 'seal.bank': OTHER, 'burn.bank': OTHER, 'mint.bank': PDA })
    .find(f => f.kind === 'banks_disagree').detail.includes('MINTING is impaired'), true)
t('...and does NOT claim redemption is halted when seal and burn agree',
  D.detectStandingRisks({ 'seal.bank': OTHER, 'burn.bank': OTHER, 'mint.bank': PDA })
    .find(f => f.kind === 'banks_disagree').detail.includes('REDEMPTION is halted'), false)
t('WATCH lists each bank key exactly once (the literal and the spread collided)',
  D.WATCHED_KEYS.filter(k => k === 'seal.bank').length, 1)
t('QUIET when the Banks agree',
  D.detectStandingRisks({ 'seal.bank': OTHER, 'mint.bank': OTHER, 'burn.bank': OTHER })
    .some(f => f.kind === 'banks_disagree'), false)
t('QUIET when only ONE bank is readable — that is not a disagreement',
  D.detectStandingRisks({ 'seal.bank': OTHER }).some(f => f.kind === 'banks_disagree'), false)

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
  // A vault deliberately skipped, and a day with nothing to pay, are RESOLVED.
  t('QUIET for a row skipped on purpose', D.detectDistribution(
    { days: { '2026-08-20': { startedAt: 'x', finishedAt: 'y', paid: { v1: { sig: null, skipped: 'burned' } } } } },
    { today: '2026-08-21' }).length, 0)
  t('QUIET for a day with nothing to distribute', D.detectDistribution(
    { days: { '2026-08-20': { startedAt: 'x', nothingToDo: 'no cbBTC', paid: {} } } },
    { today: '2026-08-21' }).length, 0)
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
  // A refused transfer is retryable and must not read as an unknown one.
  t('HIGH, and its own kind, for a transfer the cluster REFUSED', D.detectDistribution(
    { days: { '2026-08-20': { startedAt: 'x', finishedAt: 'y',
      paid: { v1: { sig: null, rejected: true, error: 'frozen' } } } } }, { today: '2026-08-21' })
      .map(f => f.kind), ['distribution_refused'])
}

console.log('── round 9: a watched key nobody populates ──')
{
  // The class this closes: `mint.pending_bank` was watched by two detectors and
  // read by neither, so the Bank co-signer's notice period did not run at all.
  const full = Object.fromEntries(D.WATCHED_KEYS.map(k => [k, 'x']))
  t('QUIET when the reader produces every watched key', D.missingWatchedKeys(full), [])
  const { 'mint.pending_bank': _drop, ...short } = full
  t('names the key when one is missing', D.missingWatchedKeys(short), ['mint.pending_bank'])
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
t('fires when the treasury moves',
  D.detectConfigDrift({ 'mint.treasury': 'A' }, { 'mint.treasury': 'B' })[0].severity, 'CRITICAL')
t('fires when a reserve mint is added',
  D.detectConfigDrift({ 'seal.reserve_mints': ['a'] }, { 'seal.reserve_mints': ['a', 'b'] }).length, 1)
t('QUIET when nothing moved',
  D.detectConfigDrift({ 'mint.treasury': 'A', 'seal.bank': 'B' }, { 'mint.treasury': 'A', 'seal.bank': 'B' }).length, 0)
t('QUIET on the first ever run (no previous state)',
  D.detectConfigDrift(null, { 'mint.treasury': 'A' }).length, 0)

console.log('── standing risks ──')
t('CRITICAL when the 85/15 rule itself has been changed',
  D.detectStandingRisks({ 'mint.split_bps': 5000 })[0].severity, 'CRITICAL')
t('QUIET at 8500',
  D.detectStandingRisks({ 'mint.split_bps': 8500 }).length, 0)
t('fires when the swap operator is repointed',
  D.detectConfigDrift({ 'mint.swap_operator': 'A' }, { 'mint.swap_operator': 'B' })[0].severity, 'CRITICAL')
t('fires on a production voting period left at the test floor',
  D.detectStandingRisks({ 'gov.min_voting_secs': 60 })[0].kind, 'weak_voting_period')
t('QUIET on a 7-day voting period',
  D.detectStandingRisks({ 'gov.min_voting_secs': 7 * 86400 }).length, 0)

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

console.log("── the Bank's pre-signature judgement on a redemption ──")
{
  const SEALP = 'SeaLProg1111111111111111111111111111111111'
  const BURNP = 'BurnProg1111111111111111111111111111111111'
  const BANKK = 'BankKey11111111111111111111111111111111111'
  const OWN = 'OwnerKey1111111111111111111111111111111111'
  const AST = 'AssetKey1111111111111111111111111111111111'
  const PDAX = 'OffCurvePda11111111111111111111111111111111'
  const OPEN_D = [1, 1, 1, 1, 1, 1, 1, 1], BURN_D = [2, 2, 2, 2, 2, 2, 2, 2]
  const SYSP = '11111111111111111111111111111111'
  const CFG = { sealProgram: SEALP, burnProgram: BURNP, bank: BANKK,
    openDisc: OPEN_D, burnDisc: BURN_D, burnFixedAccounts: 11,
    allowedPrograms: [D.CORE_ID, D.TOKEN_ID, D.TOKEN22_ID, D.ATA_ID, SYSP] }
  const curve = k => k !== PDAX
  // asset, collection, owner, bank, + 6 more to reach the 10 SEAL takes
  const mkOpen = (a = AST, o = OWN, b = BANKK) =>
    ({ programId: SEALP, data: OPEN_D, accounts: [a, 'coll', o, b, 'p', 'cfg', 'seal', 'core', 'sysvar', 'sys'] })
  const mkBurn = (a = AST, o = OWN, b = BANKK, decl = []) =>
    ({ programId: BURNP, data: [...BURN_D, decl.length],
       accounts: [a, 'coll', o, b, 'signer', 'payer', 'cfg', 'sealcfg', 'sysvar', 'core', 'sys', ...decl] })
  const j = (ixs) => D.judgeRedemptionTx(ixs, CFG, curve)

  t('a well-formed redemption is ACCEPTED', j([mkOpen(), 'sweep', mkBurn()].filter(x => x !== 'sweep')).ok, true)
  t('...and it reports the asset and owner it bound', 
    [j([mkOpen(), mkBurn()]).asset, j([mkOpen(), mkBurn()]).owner], [AST, OWN])
  // Every refusal below is a thing a Bank signature would otherwise have blessed.
  t('a thaw with NO burn is refused', j([mkOpen()]).ok, false)
  t('a burn with NO thaw is refused', j([mkBurn()]).ok, false)
  t('TWO redemptions in one transaction are refused',
    j([mkOpen(), mkBurn(), mkOpen('B2'), mkBurn('B2')]).ok, false)
  t('the burn BEFORE the thaw is refused', j([mkBurn(), mkOpen()]).ok, false)
  t('a burn naming a DIFFERENT asset is refused', j([mkOpen(), mkBurn('Other')]).ok, false)
  t('a burn naming a DIFFERENT owner is refused', j([mkOpen(), mkBurn(AST, 'Other')]).ok, false)
  t('a thaw naming someone else as the Bank is refused', j([mkOpen(AST, OWN, 'NotUs')]).ok, false)
  t('a burn naming someone else as the Bank is refused', j([mkOpen(), mkBurn(AST, OWN, 'NotUs')]).ok, false)
  // ROUND 14's finding, enforced before a signature rather than reported after.
  t('an OFF-CURVE owner is refused (it could never sign the pair anyway)',
    j([mkOpen(AST, PDAX), mkBurn(AST, PDAX)]).ok, false)
  t('an EXTRA instruction to SEAL is refused',
    j([mkOpen(), mkBurn(), { programId: SEALP, data: [9, 9, 9, 9, 9, 9, 9, 9], accounts: [] }]).ok, false)
  t('a declared COUNT that disagrees with the accounts carried is refused',
    D.judgeRedemptionTx([mkOpen(), { ...mkBurn(AST, OWN, BANKK, ['a', 'b']), data: [...BURN_D, 5] }], CFG, curve).ok,
    false)
  t('...and every refusal SAYS why', j([mkBurn()]).reasons.length > 0, true)

  // ───────── ROUND 15: A SIGNATURE AUTHORISES THE WHOLE MESSAGE ─────────
  //
  // MEASURED before the fix, on a REAL serialized legacy transaction decompiled
  // exactly as cosign.mjs does it: `[open, SystemProgram.transfer(from=BANK,
  // to=attacker), burn]` returned ok:true with an EMPTY reasons array, and
  // `--live` would have partial-signed it. Every assertion below fires on the
  // theft and STAYS QUIET on the redemption that legitimately needs the same
  // program, because a judge that refuses everything is not a judge.
  const sweep = (accts = ['someAta', 'ownerAta', OWN]) => ({ programId: D.TOKEN_ID, data: [3, 0], accounts: accts })
  t('an extra instruction NAMING THE BANK is refused (the drain)',
    j([mkOpen(), { programId: SYSP, data: [2, 0, 0, 0], accounts: [BANKK, 'Attacker'] }, mkBurn()]).ok, false)
  t('...and the refusal says the Bank would have AUTHORISED it',
    j([mkOpen(), { programId: SYSP, data: [2, 0, 0, 0], accounts: [BANKK, 'Attacker'] }, mkBurn()])
      .reasons.some(r => r.includes('the Bank') && r.includes('authorise')), true)
  t('an SPL approve authorised by the BANK is refused',
    j([mkOpen(), { programId: D.TOKEN_ID, data: [4], accounts: ['BankAta', 'Delegate', BANKK] }, mkBurn()]).ok, false)
  // THE OTHER DIRECTION. The same programs, the same shape, no Bank in them.
  t('...but an ordinary sweep on the SAME token program is ACCEPTED',
    j([mkOpen(), sweep(), mkBurn()]).ok, true)
  t('a System instruction that does NOT name the Bank is ACCEPTED',
    j([mkOpen(), { programId: SYSP, data: [2, 0, 0, 0], accounts: ['payer', 'ownerAta'] }, mkBurn()]).ok, true)
  // ARM 2: THE PROGRAM ALLOWLIST, and it fails CLOSED when the caller omits it.
  t('an instruction to a program NOT on the allowlist is refused',
    j([mkOpen(), { programId: 'EvilProg11111111111111111111111111111111', data: [0], accounts: ['x'] }, mkBurn()]).ok, false)
  t('...and an OMITTED allowlist permits the pair and nothing else',
    D.judgeRedemptionTx([mkOpen(), sweep(), mkBurn()],
      { ...CFG, allowedPrograms: undefined }, curve).ok, false)
  t('...while the pair ALONE still passes with no allowlist configured',
    D.judgeRedemptionTx([mkOpen(), mkBurn()], { ...CFG, allowedPrograms: undefined }, curve).ok, true)
  // THE FEE PAYER IS A DEBIT NO INSTRUCTION LISTS, so the confinement above is
  // structurally blind to it and it needs its own arm.
  t('the BANK as FEE PAYER is refused',
    D.judgeRedemptionTx([mkOpen(), mkBurn()], { ...CFG, feePayer: BANKK }, curve).ok, false)
  t('...and any other fee payer is fine',
    D.judgeRedemptionTx([mkOpen(), mkBurn()], { ...CFG, feePayer: OWN }, curve).ok, true)
  // ROUND 16 FLIPPED THIS. Round 15 asserted the fail-OPEN direction as correct:
  // `null` means the caller LOOKED and could not tell, and a judge whose job is to
  // refuse what it cannot see must not shrug at the one debit no instruction lists.
  t('a fee payer we could NOT determine is refused',
    D.judgeRedemptionTx([mkOpen(), mkBurn()], { ...CFG, feePayer: null }, curve).ok, false)
  t('...while a caller that does not supply one at all is not judged on it',
    D.judgeRedemptionTx([mkOpen(), mkBurn()], CFG, curve).ok, true)
  // An unreadable curve check must not become a refusal: "we could not tell" and
  // "it is a program" are different answers.
  t('an unreadable curve check does not refuse on its own',
    D.judgeRedemptionTx([mkOpen(), mkBurn()], CFG, () => { throw new Error('bad') }).ok, true)

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

  // C. THE BANK KEY HAS EXACTLY ONE READER. `bank/cosign.mjs` is the only thing
  // that may put the Bank's signature on anything, and every check in it is
  // worth nothing if a second file quietly learns to sign. A new reader is now a
  // build failure and a deliberate decision rather than an accident.
  // ⚠️ THE PATTERN IS ASSEMBLED, NOT WRITTEN. Spelled literally it appears in THIS
  // file, so the check matched itself and reported two readers — a search that
  // finds its own searcher. Built from fragments, this file is inside the checked
  // set like every other, which is where it belongs: a selftest that learned to
  // sign would be the last place anyone looked.
  const keyPat = new RegExp(['CBOB', 'BANK', 'KEY'].join('_') + '|' + ['keys', 'bank\\.json'].join('/'))
  // ⚠️ ROUND 16 WIDENED THE SEARCH, AND THE OLD WIDTH WAS THE FINDING. This read
  // `bank/` only, so a second signer living in `scripts/` or `tests/` — the two
  // other directories in this repository that hold executable code — was outside
  // the check written to make a second signer impossible. `srcFiles` is the whole
  // executable tree, defined once and shared by every arm below that searches it.
  // (No count here on purpose: a comment that enumerates the controls it documents
  // is how one of them gets deleted by someone tidying up, which is a finding a
  // round-16 auditor made against `judgeRedemptionTx` sixty lines from here.)
  //
  // ⚠️ NOTHING IS EXCLUDED BY NAME. A first draft skipped `scripts/audit*`, and
  // that was reflex rather than reason — the audit PROMPTS embed whole source
  // files and would self-match, but they are `.ts` in `scripts/` and this only
  // takes `.mjs` and `.sh` there, so the prefix filter was buying nothing and
  // costing `audit-coverage.sh` its place in the set. Measured before removing it:
  // that file contains none of the searched strings. An exclusion that is not
  // load-bearing is a hole waiting for a file to be moved into it.
  const srcFiles = [
    ...fsx.readdirSync('/opt/cbob-vaults/bank').filter(f => f.endsWith('.mjs')).map(f => ['bank', f]),
    ...fsx.readdirSync('/opt/cbob-vaults/scripts').filter(f => f.endsWith('.mjs') || f.endsWith('.sh')).map(f => ['scripts', f]),
    ...fsx.readdirSync('/opt/cbob-vaults/tests').filter(f => f.endsWith('.ts')).map(f => ['tests', f]),
  ].map(([d, f]) => ({ f, path: `${d}/${f}`, src: fsx.readFileSync(`/opt/cbob-vaults/${d}/${f}`, 'utf8') }))
  // The widening is only worth anything if it is actually reaching those
  // directories, and "the set got bigger" is the kind of thing that is true until
  // a filter typo makes it quietly false again.
  t('...and the search now covers scripts/ and tests/, not just bank/',
    ['bank', 'scripts', 'tests'].map(d => srcFiles.some(x => x.path.startsWith(d + '/'))), [true, true, true])
  // Named files rather than only directories: a glob can go quietly wrong in a way
  // that still leaves each directory represented by something.
  t('...and every ops script and the whole test suite are in it, none skipped',
    ['scripts/audit-coverage.sh', 'scripts/cron-install.sh', 'scripts/run-tests.sh', 'tests/3prog.test.ts']
      .filter(n => !srcFiles.some(x => x.path === n)), [])
  const readers = srcFiles.filter(x => keyPat.test(x.src)).map(x => x.path)
  t('exactly ONE file in the tree reads the Bank key', readers, ['bank/cosign.mjs'])
  t('...and the check is capable of finding a second one',
    ['cosign.mjs', 'impostor.mjs'].filter(f => keyPat.test(f === 'cosign.mjs'
      ? 'const K = process.env.' + ['CBOB', 'BANK', 'KEY'].join('_')
      : 'const K = "/opt/cbob-vaults/bank/' + ['keys', 'bank.json'].join('/') + '"')).length, 2)

  // C2. THE SIGNER SET, PINNED FILE BY FILE AND KEY BY KEY.
  //
  // A round-16 auditor named the hole in C1 exactly: it checks for READERS OF
  // THIS SPECIFIC KEY FILE, not for ANY ACTOR THAT SIGNS. A second signer that
  // hardcodes its own path to the same bytes — or reads them from a new env var —
  // is invisible to a pattern built out of the documented path.
  //
  // What cannot be hidden is the secret-key constructor on `Keypair` (spelled in
  // fragments below, for the reason the next block asserts): turning bytes into a
  // signer is the one thing every such file must do. So the SET is pinned, with
  // the key each member reads. Three signers exist and each holds a DIFFERENT
  // key; a fourth, or an existing one reaching for different bytes, is red.
  // ⚠️ ASSEMBLED, NOT SPELLED — the same trap as C1's pattern, and the first run
  // of this gate walked into it twice: the Bank's key path written out in THIS
  // map made selftest.mjs a second READER of the Bank key, and the sample command
  // in C4's both-ways case below made it a second INVOKER of the co-signer. Both
  // went red on the first run, which is the gate working: this file stays INSIDE
  // the checked set, so every literal it needs is built from fragments.
  //
  // THE SECOND RUN THEN FAILED ON THE COMMENT THAT SAYS THIS. The prose above
  // originally quoted the path it was warning about, and the searches do not read
  // comments differently from code — deliberately, because a gate that skips
  // comments is a gate you can hide a path in, and parsing JS comments with a
  // regex is a worse bug than the one it would dodge. So the rule is absolute:
  // in this file, neither of those two strings may appear spelled out ANYWHERE,
  // prose included.
  const kf = n => ['keys', n].join('/')
  const KEY_OF = { [kf('bank.json')]: 'BANK', [kf('swap-operator.json')]: 'SWAP-OPERATOR', [kf('distributor.json')]: 'DISTRIBUTOR' }
  // ⚠️ THE SIGNING PATTERN IS ASSEMBLED FOR THE SAME REASON, and the first draft of
  // this arm got it wrong in the more dangerous way. Spelled out, both the regex
  // and the impostor string below made THIS file look like a signer, and the
  // draft dodged that by excluding `selftest.mjs` from the scan BY NAME. That is
  // not a fix, it is the hole: the round-16 comment above says in as many words
  // that a selftest which learned to sign would be the last place anyone looked,
  // and an exclusion by name is exactly how it would stay unlooked-at. Assemble
  // the literal, keep every file in the set, exclude nothing.
  const sigPat = new RegExp(['from', 'Secret', 'Key'].join(''))
  const signerSet = extra => [...srcFiles, ...(extra ? [extra] : [])]
    .filter(x => sigPat.test(x.src))
    .map(x => {
      const keys = Object.keys(KEY_OF).filter(k => x.src.includes(k)).map(k => KEY_OF[k])
      return `${x.path} -> ${keys.length === 1 ? keys[0] : keys.length ? keys.join('+') : 'UNPINNED KEY'}`
    }).sort()
  t('exactly THREE signers exist, each holding a different key', signerSet(null), [
    'bank/cosign.mjs -> BANK',
    'bank/distribute.mjs -> DISTRIBUTOR',
    'bank/revenue.mjs -> SWAP-OPERATOR',
  ])
  // The scan must be capable of seeing this file, or the paragraph above is a
  // comment claiming a control that does not run — in the gate written to stop
  // that. Asserted directly: selftest.mjs is IN the set being filtered.
  t('...and selftest.mjs is itself inside the scanned set, excluded by nothing',
    srcFiles.some(x => x.path === ['bank', 'selftest.mjs'].join('/')), true)

  // ⚠️ SELF-MATCH, NAMED. Three arms above search the tree for three strings, and
  // this file is deliberately inside that tree, so writing any of them out — IN
  // CODE OR IN PROSE — makes this file look like a second reader, a second
  // invoker or a second signer. That happened FOUR times while these arms were
  // being written, and THREE of those were in comments explaining the rule, the
  // last one in the sentence twelve lines above.
  //
  // The arms already catch it, but they catch it wearing the wrong face: the
  // failure reads "the selftest learned to sign", which sends the next reader
  // hunting for a signer instead of for a paragraph. Four repeats is enough
  // evidence that a comment saying "assemble the literal" does not work. This
  // says what actually happened, in one line, at the top of the pile.
  {
    const forbidden = {
      'the Bank key path': ['keys', 'bank.json'].join('/'),
      'the Bank key env var': ['CBOB', 'BANK', 'KEY'].join('_'),
      'a co-signer invocation': 'node ' + ['bank', 'cosign.mjs'].join('/'),
      'the secret-key constructor': ['from', 'Secret', 'Key'].join(''),
    }
    const selfSrc = fsx.readFileSync('/opt/cbob-vaults/bank/selftest.mjs', 'utf8')
    const spelled = src => Object.entries(forbidden).filter(([, lit]) => src.includes(lit)).map(([n]) => n)
    t('no searched-for string is spelled out in this file, prose included', spelled(selfSrc), [])
    t('...and the check fires on a comment that quotes one', 
      spelled('// e.g. the Bank key lives at ' + ['keys', 'bank.json'].join('/')), ['the Bank key path'])
  }
  // BOTH WAYS, AND SPECIFICALLY AGAINST THE BYPASS THE AUDITOR DESCRIBED: a file
  // that builds a keypair from bytes it found somewhere C1's pattern cannot name.
  // C1 stays green on this input; C2 goes red. That difference IS the arm.
  {
    const impostor = { path: 'bank/impostor.mjs', f: 'impostor.mjs',
      src: 'const k = Keypair.' + ['from', 'Secret', 'Key'].join('') + '(readFileSync(process.env.SOME_OTHER_VAR))' }
    t('...and a signer reading bytes from anywhere else is caught as UNPINNED',
      signerSet(impostor).includes('bank/impostor.mjs -> UNPINNED KEY'), true)
    t('...which is exactly what the one-reader check alone CANNOT see',
      keyPat.test(impostor.src), false)
  }

  // C3. NO ROUTE TO A BANK SIGNATURE THAT SKIPS THE SCAN.
  // `cosign.mjs` must contain exactly one `partialSign`, and it must sit AFTER
  // the refusal exit. A second one, or one hoisted above the refusal, is a
  // signature produced without a verdict — which is the entire thing this file
  // exists to prevent, and is a two-line edit away at any time.
  const cosignSrc = fsx.readFileSync('/opt/cbob-vaults/bank/cosign.mjs', 'utf8')
  const oneSign = src => {
    const signs = [...src.matchAll(/partialSign/g)].map(m => m.index)
    const refuse = src.indexOf('if (!v.ok)')
    return signs.length === 1 && refuse > 0 && signs[0] > refuse
  }
  t('cosign.mjs has ONE partialSign and it is downstream of the refusal', oneSign(cosignSrc), true)
  t('...and a SECOND signing site is caught',
    oneSign(cosignSrc.replace('tx.partialSign(bank)', 'tx.partialSign(bank); tx.partialSign(bank)')), false)
  t('...and one hoisted ABOVE the refusal is caught',
    oneSign(cosignSrc.replace('if (!v.ok)', 'tx.partialSign(bank)\n  if (!v.ok)')
      .replace(/tx\.partialSign\(bank\)\n(?![\s\S]*tx\.partialSign)/, '')), false)

  // C4. THE SANCTIONED PATH IS SINGULAR, AND SPEC DOCUMENTS THE ONE THAT EXISTS.
  // Phase 0 of the freeze asked for "a single documented, scripted way to produce
  // a Bank signature". A path that is documented and a path that exists are two
  // claims, and this project's most repeated defect is the gap between them.
  const SANCTIONED = 'scripts/bank-sign.sh'
  t('the sanctioned signing script exists and is executable',
    fsx.existsSync(`/opt/cbob-vaults/${SANCTIONED}`) && !!(fsx.statSync(`/opt/cbob-vaults/${SANCTIONED}`).mode & 0o111), true)
  // Only the wrapper may invoke the co-signer. cosign.mjs naming itself in its own
  // usage text is not a second invoker, so it is excluded — and this is the ONE
  // by-name exclusion in this block, which is worth justifying rather than
  // waving through, because the signer arm above was nearly ruined by one. It is
  // bounded: it exempts a single named file from a single check, and that file is
  // covered against the thing this check is for by C3 above, which proves it has
  // exactly one signing site and that the site is downstream of the refusal. The
  // alternative — a regex clever enough to tell a usage line from a real call —
  // would have hidden a real invocation somewhere else in the tree.
  const invokers = srcFiles.filter(x => x.path !== 'bank/cosign.mjs' && /node\s+\S*bank\/cosign\.mjs/.test(x.src)).map(x => x.path)
  t('exactly ONE file invokes the co-signer', invokers, [SANCTIONED])
  t('...and a second invoker anywhere in the tree is caught',
    /node\s+\S*bank\/cosign\.mjs/.test('cd /opt/cbob-vaults && /usr/bin/node ' + ['bank', 'cosign.mjs'].join('/') + ' --tx $T --live'), true)
  const specSrc = fsx.readFileSync('/opt/cbob-vaults/SPEC.md', 'utf8')
  t('SPEC documents that exact script as the one sanctioned path',
    specSrc.includes('### SIGNING A REDEMPTION — the ONE sanctioned path') && specSrc.includes(`./${SANCTIONED} tx.b64 --live`), true)
  // The wrapper's whole safety claim is that it forwards nothing it does not
  // understand. Asserted against the source that runs, because a `*"$@"` added in
  // a tidy-up would reopen it silently.
  const signSh = fsx.readFileSync(`/opt/cbob-vaults/${SANCTIONED}`, 'utf8')
  t('the wrapper forwards no argument it has not recognised',
    /^\s*exec .*cosign\.mjs --tx "\$TX" \$\{LIVE\[@\]\+"\$\{LIVE\[@\]\}"\}\s*$/m.test(signSh), true)
  // THE READ MUST PRECEDE THE `cd`. The wrapper resolves the operator's relative
  // path in the operator's own shell and only then moves to the repository. The
  // first version had it the other way round, and MEASURED, from /tmp with a
  // stale tx.b64 at the repo root, it fed the co-signer the REPO's file and said
  // nothing: the Bank asked to judge a DIFFERENT transaction than the one named.
  // That is the worst failure this file can have and it was fail-open. It was
  // found by running the thing, not by any gate, so it gets one.
  const readBeforeCd = src => {
    // NOT ^-anchored: one read sits after a `then` on the same line and the other
    // is indented inside an `else`. An anchor demanding column zero matched
    // NEITHER and made this arm fail on the CORRECT file — which is how a gate
    // gets loosened until it means nothing. Take the FIRST read of either shape.
    // (No line numbers in this comment on purpose: they drift on the next edit.)
    const read = src.search(/RAW=\$\(cat/)
    const cd = src.search(/^cd "\$\(dirname/m)
    // `search` returns -1 when absent, so >= 0 is the honest found-test. A
    // missing half must be RED, never "well, one of them is in the right place".
    return read >= 0 && cd >= 0 && read < cd
  }
  t('the wrapper reads the transaction BEFORE it changes directory', readBeforeCd(signSh), true)
  t('...and the original order — cd first — is caught',
    readBeforeCd(['cd "$(dirname $0)/.."', 'RAW=$(cat -- "$SRC")'].join('\n')), false)
  t('...and a wrapper missing either half is caught, not silently passed',
    [readBeforeCd('RAW=$(cat -- "$SRC")'), readBeforeCd('cd "$(dirname $0)/.."')], [false, false])
  t('...and a pass-through of "$@" would be caught',
    /^\s*exec .*cosign\.mjs --tx "\$TX" \$\{LIVE\[@\]\+"\$\{LIVE\[@\]\}"\}\s*$/m.test(signSh.replace(/exec .*cosign\.mjs.*$/m, 'exec node ' + ['bank', 'cosign.mjs'].join('/') + ' --tx "$TX" "$@"')), false)

  // C5. THE CONTROL TABLE'S FOURTH COLUMN IS MECHANICALLY TRUE.
  //
  // ⚠️ THIS IS THE ARM THAT MATTERS MOST, and it answers the defect this project
  // has shipped more times than any other: a comment asserting a control that
  // does not run. SPEC's control table is the ONE place that says what runs, and
  // for eight rounds nothing checked it against reality. Now every row marked
  // AUTOMATIC must name a file `scripts/cron-install.sh` actually installs, and
  // every row marked PROCEDURE must name one it does not.
  const cronSrc = fsx.readFileSync('/opt/cbob-vaults/scripts/cron-install.sh', 'utf8')
  // The crontab lines only — not the commentary, which discusses files it does
  // not install. A tag is on every installed line and on nothing else.
  const cronLines = cronSrc.split('\n').filter(l => /^\S+ .*\$TAG/.test(l)).join('\n')
  const tableRows = src => src.split('\n')
    .filter(l => /^\| .*\| \*\*(AUTOMATIC|PROCEDURE)\.\*\*/.test(l))
    .map(l => {
      // ⚠️ NO CLOSING BACKTICK IN THE PATTERN. The reconcile row names its file
      // inside a longer command (`bank/alarm.mjs --reconcile`), so a pattern
      // demanding a backtick straight after `.mjs` read it as unnamed. That
      // happened to fail CLOSED on an AUTOMATIC row and would have failed OPEN on
      // a PROCEDURE one — an unparseable row silently agreeing with itself. The
      // pattern is loosened AND an unnamed row is now red on its own account.
      const file = (l.match(/`(bank\/[\w.-]+\.mjs)/) || [])[1] || 'NO FILE NAMED'
      const claim = /\*\*AUTOMATIC\.\*\*/.test(l) ? 'AUTOMATIC' : 'PROCEDURE'
      const real = cronLines.includes(file) ? 'AUTOMATIC' : 'PROCEDURE'
      return `${file} claims ${claim}, cron says ${real}`
    })
  const rows = tableRows(specSrc)
  t('the control table has three classified rows', rows.length, 3)
  // A row this parser cannot read is not a row that passes. Without this an
  // unnamed PROCEDURE row would agree with itself and read green forever.
  t('...and every one of them named a file the parser could read',
    rows.filter(r => r.startsWith('NO FILE NAMED')), [])
  t('...and a row whose file the parser cannot read is caught',
    tableRows(specSrc.replace('`bank/alarm.mjs`, cron', 'the alarm, cron'))
      .some(r => r.startsWith('NO FILE NAMED')), true)
  t('every row\'s claim matches what cron actually installs',
    rows.filter(r => r.split('claims ')[1].split(',')[0] !== r.split('cron says ')[1]), [])
  // BOTH WAYS. Flip the co-signer's row to AUTOMATIC without wiring a cron: red.
  t('...and a row claiming AUTOMATIC with no cron behind it is caught',
    tableRows(specSrc.replace('| **PROCEDURE.** An operator runs', '| **AUTOMATIC.** An operator runs'))
      .some(r => r.includes('cosign.mjs claims AUTOMATIC, cron says PROCEDURE')), true)
  // ...and the reverse: wire something and forget to say so. Simulated on the
  // alarm's row, which is the one that IS in cron.
  t('...and a row claiming PROCEDURE for something cron DOES run is caught',
    tableRows(specSrc.replace('| **AUTOMATIC.** `bank/alarm.mjs`, cron', '| **PROCEDURE.** `bank/alarm.mjs`, cron'))
      .some(r => r.includes('alarm.mjs claims PROCEDURE, cron says AUTOMATIC')), true)
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
  t('SPEC states the on-chain floor', num(/# (\d+) assertions, real cloned Core/, spec), onchain)
  t('SPEC states the detector floor', num(/\(\+ (\d+) detector/, spec), det)
  t('SPEC states the allocation floor', num(/(\d+) allocation and \d+ live-mainnet/, spec), alloc)
  // BOTH WAYS: the reader must fail on a wrong number, not just pass on a right one.
  t('...and a stale number in that block is caught',
    num(/# (\d+) assertions, real cloned Core/, spec.replace(/# \d+ assertions, real cloned Core/, '# 178 assertions, real cloned Core')) === onchain,
    false)
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
  t('...and the file list is not empty (the discovery still finds them)',
    dasFiles.length >= 3, true)
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

console.log('── the Bank must be a plain keypair ──')
{
  // A real off-curve address: the CBOBTC Squads vault named as INIT_AUTHORITY.
  const SQUADS = 'bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1'
  const HOTKEY = '4epGVaxS4rYH9q8tvEjuzxCtm9gSWQvmEp9By3uUvYge'
  const curve = k => k !== SQUADS
  t('CRITICAL when seal.bank is off-curve (a multisig or program address)',
    D.detectBankIsNotSignable({ 'seal.bank': SQUADS }, curve)[0]?.kind ?? null, 'bank_is_off_curve')
  t('...and it says WHY, so the operator does not just rotate it back and repeat',
    D.detectBankIsNotSignable({ 'seal.bank': SQUADS }, curve)[0]?.detail.includes('TOP-LEVEL'), true)
  t('QUIET on an ordinary keypair Bank',
    D.detectBankIsNotSignable({ 'seal.bank': HOTKEY }, curve).length, 0)
  t('all three programs\' banks are checked',
    D.detectBankIsNotSignable({ 'seal.bank': SQUADS, 'burn.bank': SQUADS, 'mint.bank': SQUADS }, curve).length, 3)
  // ADMIN IS DELIBERATELY EXEMPT. Its instructions are single top-level calls
  // with no introspection, so a Squads vault signs them by CPI — and that is the
  // INTENDED production shape. An auditor extended the finding to admin; firing
  // on it would make this detector cry wolf about the correct configuration.
  t('QUIET on an off-curve ADMIN, which is the intended production shape',
    D.detectBankIsNotSignable({ 'seal.admin': SQUADS, 'mint.admin': SQUADS }, curve).length, 0)
  t('QUIET on an unset bank', D.detectBankIsNotSignable({ 'seal.bank': D.DEFAULT_PUBKEY }, curve).length, 0)
  t('QUIET on a snapshot with no bank at all', D.detectBankIsNotSignable({}, curve).length, 0)
  // An unreadable key must not be reported as off-curve: "we could not tell" and
  // "it is a program" are different answers and only one of them halts a business.
  t('QUIET when the curve check itself throws',
    D.detectBankIsNotSignable({ 'seal.bank': 'not-a-pubkey' }, () => { throw new Error('bad') }).length, 0)
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
  try { SPL.requireTokenAmount(null, 'the distributor account', 'ADDR') } catch (e) { threw = e.message }
  t('a money path REFUSES an absent account instead of reading it as 0',
    /does not exist/.test(threw), true)
  t('...and reads a good one normally', String(SPL.requireTokenAmount(acct(7n), 'x', 'y')), '7')
}

// THE FOUR COLLECTION KEYS ARE WATCHED. `collections_disagree` read them and
// none was in the watch list, so the mechanism built to close the
// wired-to-nothing class did not cover the CRITICAL sitting next to it.
t('every collection key the standing checks read is in the watch list',
  D.COLLECTION_KEYS.filter(k => !D.WATCHED_KEYS.includes(k)), [])
t('...and so is every BANK key (mint.bank and burn.bank were not, until round 16)',
  D.BANK_KEYS.filter(k => !D.WATCHED_KEYS.includes(k)), [])
t('a reader that stops producing gov.collection is CAUGHT, not read as agreement',
  // The key must be genuinely ABSENT: `Object.keys` still lists one whose value
  // is `undefined`, so setting it to undefined proves nothing. (It did not, and
  // this assertion failed until the test matched the mechanism.)
  D.missingWatchedKeys(Object.fromEntries(
    D.WATCHED_KEYS.filter(k => k !== 'gov.collection').map(k => [k, 'x']))),
  ['gov.collection'])
t('...and a reader producing all of them is quiet',
  D.missingWatchedKeys(Object.fromEntries(D.WATCHED_KEYS.map(k => [k, 'x']))), [])

// `resolvedBy` landed on ONE of three branches that can nag forever.
t('a REFUSED transfer raises a finding a human can answer', D.detectDistribution(
  { days: { '2026-08-20': { startedAt: 'x', finishedAt: 'y', paid: { v1: { sig: null, rejected: true } } } } },
  { today: '2026-08-21' }).some(f => f.kind === 'distribution_refused'), true)
t('...and once a human RESOLVES it, it stops', D.detectDistribution(
  { days: { '2026-08-20': { startedAt: 'x', finishedAt: 'y',
    paid: { v1: { sig: null, rejected: true, resolvedBy: 'gary: paid by hand' } } } } },
  { today: '2026-08-21' }).some(f => f.kind === 'distribution_refused'), false)
t('an UNFINISHED day can be resolved too, rather than nagging every 30 minutes forever',
  D.detectDistribution({ days: { '2026-08-20': { startedAt: 'x', resolvedBy: 'gary: day abandoned deliberately',
    paid: { v1: { sig: 'abc' } } } } }, { today: '2026-08-21' }).some(f => f.kind === 'distribution_unfinished'), false)

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

// A poisoned vault ATA is a stranger's one-lamport denial of that vault's pay.
t('an unreadable vault ATA is REPORTED, not merely survived', D.detectDistribution(
  { days: { '2026-08-20': { startedAt: 'x', finishedAt: 'y', paid: { v1: { sig: 'abc' } },
    unreadableAtas: [{ vault: 'vPoison', state: 'malformed' }] } } }, { today: '2026-08-21' })
  .some(f => f.kind === 'distribution_vault_unreadable'), true)
t('...and a human can resolve it', D.detectDistribution(
  { days: { '2026-08-20': { startedAt: 'x', finishedAt: 'y', paid: { v1: { sig: 'abc' } },
    unreadableAtas: [{ vault: 'vPoison', state: 'malformed' }], resolvedBy: 'gary: dust account, ignored' } } },
  { today: '2026-08-21' }).some(f => f.kind === 'distribution_vault_unreadable'), false)
t('a clean day raises nothing of the sort', D.detectDistribution(
  { days: { '2026-08-20': { startedAt: 'x', finishedAt: 'y', paid: { v1: { sig: 'abc' } } } } },
  { today: '2026-08-21' }).some(f => f.kind === 'distribution_vault_unreadable'), false)

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

// A FLOOR ON THESE TOO. `process.exit(bad.length ? 1 : 0)` cannot tell "all
// passed" from "the file threw after two assertions and both of those passed",
// and this file is the only proof most of the pipeline has.
// ROUND 14: this said 195 against a real count of 221 while the commit beside it
// added an EXTERNAL floor and claimed "every floor equals its real count". A
// floor 26 below reality is the same defeat round 12 fixed on-chain, left
// standing in the fix for it — and SPEC documents running this file DIRECTLY,
// which bypasses the runner's floor entirely. It is the current count.
const FLOOR = 381
const bad = R.filter(r => !r.ok)
if (R.length < FLOOR) {
  console.error(`\nONLY ${R.length} assertions ran; the floor is ${FLOOR}. The file stopped early.`)
  process.exit(1)
}
console.log(`\n${'='.repeat(60)}\n${R.length - bad.length}/${R.length} detector assertions as predicted`)
console.log(`every detector proven in BOTH directions: fires when it should, quiet when it should`)
process.exit(bad.length ? 1 : 0)
