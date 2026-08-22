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
  try { fsx.unlinkSync(L) } catch {}
  const a = LK.acquireLock(L)
  t('the first runner takes the lock', a.ok, true)
  t('the SECOND runner is refused', LK.acquireLock(L).ok, false)
  // ROUND 11. RELEASE IS BY TOKEN. Unconditional unlink let a slow-but-alive
  // runner delete its REPLACEMENT's lock on the way out and a third runner in.
  t('release WITHOUT the token does nothing', LK.releaseLock(L), false)
  t('...and the lock is still held', LK.acquireLock(L).ok, false)
  t('release WITH the token frees it', LK.releaseLock(L, a.token), true)
  const b = LK.acquireLock(L)
  t('and the next runner can take it once the first releases', b.ok, true)
  t("a foreign token cannot free someone else's lock", LK.releaseLock(L, 'not-my-token'), false)
  LK.releaseLock(L, b.token)

  // A lock that can never be broken is an outage waiting for the first crash —
  // but AGE IS NOT DEATH, and a live holder must never be stolen from.
  const held = LK.acquireLock(L)
  const dead = () => false, live = () => true
  const refusedLive = LK.acquireLock(L, { now: Date.now() + 7 * 3600_000, alive: live })
  t('a STALE lock whose holder is STILL ALIVE is NOT broken', refusedLive.ok, false)
  t('...and it says why, so a human can kill it deliberately', !!refusedLive.aliveHolder, true)
  const broke = LK.acquireLock(L, { now: Date.now() + 7 * 3600_000, alive: dead })
  t('a stale lock whose holder is GONE is broken, and says which run it broke',
    broke.ok && !!broke.broke, true)
  // ATOMIC. Both of two runners meeting one dead stale lock used to win.
  t('the SECOND runner, meeting the now-FRESH replacement, is simply refused',
    LK.acquireLock(L, { alive: dead }).ok, false)
  // ROUND 12: AN UNREADABLE LOCK IS A REFUSAL, NOT A BREAK. It used to fall
  // through both gates — NaN age, no pid — and get broken in silence.
  LK.releaseLock(L, broke.token)
  fsx.writeFileSync(L, 'not json at all')
  const unreadable = LK.acquireLock(L, { alive: dead })
  t('an UNREADABLE lock is refused, never broken', unreadable.ok, false)
  t('...and says so, rather than reporting a break of nothing', !!unreadable.unreadable, true)
  fsx.writeFileSync(L, '')
  t('a ZERO-BYTE lock is refused too (the wx open-then-write window)',
    LK.acquireLock(L, { alive: dead }).ok, false)
  try { fsx.unlinkSync(L) } catch {}

  // A RECYCLED PID IS NOT THE HOLDER. Without the start-time check a crashed
  // run whose pid gets reused makes the lock permanently unbreakable.
  fsx.writeFileSync(L, JSON.stringify({ pid: process.pid, token: 'old', start: 'A_DIFFERENT_START',
    at: new Date(Date.now() - 9 * 3600_000).toISOString() }))
  const recycled = LK.acquireLock(L, { alive: live })
  t('a stale lock whose pid was RECYCLED is breakable', recycled.ok, true)
  LK.releaseLock(L, recycled.token)
  fsx.writeFileSync(L, JSON.stringify({ pid: process.pid, token: 'old', start: LKstart(),
    at: new Date(Date.now() - 9 * 3600_000).toISOString() }))
  t('...but a matching start time means the holder is REALLY alive', LK.acquireLock(L, { alive: live }).ok, false)
  try { fsx.unlinkSync(L) } catch {}

  // THE INTERLEAVING ROUND 11 GOT WRONG: two runners judge one stale lock, the
  // first breaks and holds, and the second's unlink deletes the WINNER'S fresh
  // lock. The re-read before the unlink is what stops it.
  const stale2 = { pid: 999999, token: 'stale-token', start: null,
    at: new Date(Date.now() - 9 * 3600_000).toISOString() }
  fsx.writeFileSync(L, JSON.stringify(stale2))
  let winner = null
  const stolenFrom = LK.acquireLock(L, { alive: dead, _beforeBreak: () => {
    // the other runner gets there first and is now holding a FRESH lock
    try { fsx.unlinkSync(L) } catch {}
    winner = LK.acquireLock(L, { alive: dead })
  } })
  t('the loser does NOT break the winner it was racing', stolenFrom.ok, false)
  t('...and says it lost the race', !!stolenFrom.lostRace, true)
  t('the winner still holds its lock afterwards', LK.acquireLock(L, { alive: dead }).ok, false)
  t('and only the winner can free it', LK.releaseLock(L, winner.token), true)
  try { fsx.unlinkSync(L) } catch {}

  // The real race is two processes between one unlink and one create. It cannot
  // be produced from a single process, so it is injected — otherwise the branch
  // that makes the break exclusive is the branch nothing ever executes.
  LK.releaseLock(L, broke.token)
  const stale = LK.acquireLock(L, { now: Date.now() - 9 * 3600_000 })
  const loser = LK.acquireLock(L, { alive: dead, _afterUnlink: () =>
    fsx.writeFileSync(L, JSON.stringify({ pid: 999999, token: 'someone-else', at: new Date().toISOString() })) })
  t('a runner that loses the create race does NOT get the lock', loser.ok, false)
  t('...and says it lost the race rather than pretending the lock is fresh', !!loser.lostRace, true)
  t('the loser cannot free the winner it lost to', LK.releaseLock(L, stale.token), false)
  fsx.writeFileSync(L, JSON.stringify({ pid: process.pid, token: broke.token, at: new Date().toISOString() }))
  LK.releaseLock(L, broke.token)

  // ── ROUND 14: THE BREAK IS NOW ONE ATOMIC `rename`, AND THIS IS THE BRANCH
  // THAT ONLY EXISTS BECAUSE OF IT. Three auditors wrote out the same
  // interleaving: two runners both judge one stale lock dead, both pass the
  // re-read, and compare-and-unlink lets BOTH take it. `rename` cannot be shared
  // — but the winner of the rename may find it has taken a lock that was
  // REPLACED after its own re-read, and taking that would be the very theft this
  // is preventing. It must put it back and lose.
  try { fsx.unlinkSync(L) } catch {}
  const stale3 = { pid: 999999, token: 'stale-3', start: null,
    at: new Date(Date.now() - 9 * 3600_000).toISOString() }
  fsx.writeFileSync(L, JSON.stringify(stale3))
  let racer = null
  const misSteal = LK.acquireLock(L, { alive: dead, _beforeSteal: () => {
    // another runner broke it and is holding a FRESH lock, AFTER our re-read
    try { fsx.unlinkSync(L) } catch {}
    racer = LK.acquireLock(L, { alive: dead })
  } })
  t('a runner that renames away a REPLACEMENT lock does not keep it', misSteal.ok, false)
  t('...and says it lost the race', !!misSteal.lostRace, true)
  t('...and the replacement is PUT BACK, not destroyed',
    (() => { try { return JSON.parse(fsx.readFileSync(L, 'utf8')).token === racer.token } catch { return false } })(), true)
  t('...and the winner can still free its own lock', LK.releaseLock(L, racer.token), true)
  // No `.breaking.` litter is left behind by any of it.
  //
  // ⚠️ ROUND 15: THIS ASSERTION COULD NEVER FAIL. It read
  // `fsx.readdirSync(fsx.existsSync(L) ? '.' : '.')` — a ternary whose two
  // branches are the SAME STRING, the process's CWD — while the lock and every
  // `.breaking.` file it makes live in `os_tmp`. It scanned a directory the
  // litter can never appear in and reported 0 forever. A gate that has only ever
  // said OK is untested; this one was structurally incapable of saying anything
  // else, which is worse. It now reads the lock's OWN directory and is proven in
  // both directions.
  const lockDir = L.slice(0, L.lastIndexOf('/'))
  const litter = () => fsx.readdirSync(lockDir).filter(x => x.includes('.breaking.')).length
  t('the steal leaves no temp file behind', litter(), 0)
  {
    const planted = `${L}.breaking.PROOF`
    fsx.writeFileSync(planted, 'x')
    t('...and the litter check is looking somewhere litter can actually appear', litter(), 1)
    fsx.unlinkSync(planted)
    t('...and is quiet again once it is gone', litter(), 0)
  }
  // ── ROUND 15: THE SAME BRANCH, WITH SOMEONE STANDING IN THE HOLE.
  //
  // The assertion above passes with the OLD `wx` restore too, because nothing
  // claims the pathname while it is empty. Between the rename and the restore it
  // IS empty, and an ordinary `claim()` succeeds there instantly — at which point
  // the `wx` restore failed EEXIST, the catch swallowed it, and the next line
  // unlinked the copy: the TRUE HOLDER'S LOCK, DESTROYED, while it was paying.
  // Measured before the fix. `rename` back always wins, so the true holder
  // survives. This is a narrowing and not a close — the interloper still believed
  // it held for the width of the hole — and the header says so.
  try { fsx.unlinkSync(L) } catch {}
  fsx.writeFileSync(L, JSON.stringify({ pid: 999999, token: 'stale-4', start: null,
    at: new Date(Date.now() - 9 * 3600_000).toISOString() }))
  let trueHolder = null
  const withInterloper = LK.acquireLock(L, { alive: dead,
    // another runner won the break and is now paying
    _beforeSteal: () => { try { fsx.unlinkSync(L) } catch {}; trueHolder = LK.acquireLock(L, { alive: dead }) },
    // a THIRD runner claims the pathname we just emptied
    _afterUnlink: () => { try { fsx.writeFileSync(L, JSON.stringify({ pid: process.pid, token: 'interloper',
      at: new Date().toISOString() }), { flag: 'wx' }) } catch { /* already there */ } } })
  t('a THIRD runner in the restore hole does not get to keep the lock', withInterloper.ok, false)
  t("...and the TRUE holder's lock survives rather than being destroyed",
    (() => { try { return JSON.parse(fsx.readFileSync(L, 'utf8')).token } catch { return 'GONE' } })(),
    trueHolder.token)
  t('...so the interloper cannot release what it thinks it holds',
    LK.releaseLock(L, 'interloper'), false)
  t('...and the true holder still can', LK.releaseLock(L, trueHolder.token), true)
  // A LOCK THAT VANISHED IS NOT A CLEAN RELEASE. This returned TRUE on ENOENT,
  // so the one state meaning "somebody took our lock" printed nothing.
  try { fsx.unlinkSync(L) } catch {}
  t('releasing a lock that is GONE reports failure, not success',
    LK.releaseLock(L, 'any-token'), false)
  const own = LK.acquireLock(L)
  t('...while releasing our own still reports success', LK.releaseLock(L, own.token), true)

  try { fsx.unlinkSync(L) } catch {}
  t('once the breaker releases, the lock is free again', LK.acquireLock(L).ok, true)
  LK.releaseLock(L, LK.acquireLock(L).token)
  try { fsx.unlinkSync(L) } catch {}

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
t('...and it says redemption is already halted',
  D.detectStandingRisks({ 'seal.bank': OTHER, 'burn.bank': PDA })
    .find(f => f.kind === 'banks_disagree').detail.includes('ALREADY HALTED'), true)
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
  t('...and an UNKNOWN fee payer does not refuse on its own',
    D.judgeRedemptionTx([mkOpen(), mkBurn()], { ...CFG, feePayer: null }, curve).ok, true)
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
  // A. WHERE THE ELF STARTS. The watch hashed from 45 unconditionally; an
  // IMMUTABLE program's ELF starts at 13, so 32 bytes — including the ENTRY
  // POINT — were outside the fingerprint. Applies to Metaplex Core, which we do
  // not control and which could be made immutable at any time.
  const pdSome = Buffer.alloc(200); pdSome[12] = 1
  const pdNone = Buffer.alloc(200); pdNone[12] = 0
  t('an UPGRADEABLE ProgramData puts the ELF at 45', D.readProgramData(pdSome).elfOffset, 45)
  t('...and an IMMUTABLE one puts it at 13', D.readProgramData(pdNone).elfOffset, 13)
  t('...so the two fingerprints are NOT the same slice',
    D.readProgramData(pdSome).elfOffset === D.readProgramData(pdNone).elfOffset, false)
  t('a truncated ProgramData account is refused, not guessed',
    D.readProgramData(Buffer.alloc(4)).elfOffset, null)

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
  const readers = fsx.readdirSync('/opt/cbob-vaults/bank')
    .filter(f => f.endsWith('.mjs'))
    .filter(f => keyPat.test(fsx.readFileSync(`/opt/cbob-vaults/bank/${f}`, 'utf8')))
  t('exactly ONE file in bank/ reads the Bank key', readers, ['cosign.mjs'])
  t('...and the check is capable of finding a second one',
    ['cosign.mjs', 'impostor.mjs'].filter(f => keyPat.test(f === 'cosign.mjs'
      ? 'const K = process.env.' + ['CBOB', 'BANK', 'KEY'].join('_')
      : 'const K = "/opt/cbob-vaults/bank/' + ['keys', 'bank.json'].join('/') + '"')).length, 2)
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
    D.judgeCronTemplate('7 9 * * * cd $R && $FLOCK /var/lock/x /usr/bin/node bank/distribute.mjs').length, 0)
}

console.log('── acknowledging a finding nobody can act on ──')
{
  const A2 = 'AckVault111111111111111111111111111111111'
  const crit = (k, a) => ({ kind: k, severity: 'CRITICAL', asset: a, detail: 'the thing' })
  const one = (fs) => fs[0]
  t('an acked finding drops to INFO',
    one(D.applyAcks([crit('vault_owns_itself', A2)], { [`vault_owns_itself:${A2}`]: 'gary: bricked, accepted' })).severity,
    'INFO')
  t('...and is still PRINTED, with the reason, rather than deleted',
    one(D.applyAcks([crit('vault_owns_itself', A2)], { [`vault_owns_itself:${A2}`]: 'gary: bricked, accepted' })).detail.includes('ACKNOWLEDGED: gary: bricked, accepted'),
    true)
  // ── ROUND 15: AN ACK IS NOT A GENERAL MUTE BUTTON ──
  // It would downgrade ANY asset-scoped finding, so `vault_burned:<asset>` in
  // acks.json silenced the paging for a real bare Core BurnV1 — the one attack
  // the programs cannot prevent. Scoped to the three kinds that are unanswerable
  // by construction, which is what it was built for.
  t('a bare-burn CRITICAL cannot be acked away',
    one(D.applyAcks([crit('vault_burned', A2)], { [`vault_burned:${A2}`]: 'noisy, ignore it' })).severity,
    'CRITICAL')
  t('...nor can the one detector that sees a bare Core BurnV1',
    one(D.applyAcks([crit('vault_left_index', A2)], { [`vault_left_index:${A2}`]: 'x' })).severity,
    'CRITICAL')
  t('...nor an undeclared token account',
    one(D.applyAcks([crit('undeclared_token_account', A2)], { [`undeclared_token_account:${A2}`]: 'x' })).severity,
    'CRITICAL')
  t('...and the REFUSED ack is itself reported rather than ignored in silence',
    one(D.applyAcks([crit('vault_burned', A2)], { [`vault_burned:${A2}`]: 'noisy' })).detail.includes('WAS REFUSED'),
    true)
  // THE OTHER DIRECTION: the three it WAS built for still work.
  t('...while nested_vault still acks', 
    one(D.applyAcks([crit('nested_vault', A2)], { [`nested_vault:${A2}`]: 'gary: host burnt' })).severity, 'INFO')
  t('...and unredeemable_owner still acks',
    one(D.applyAcks([crit('unredeemable_owner', A2)], { [`unredeemable_owner:${A2}`]: 'gary: DAO holds it' })).severity, 'INFO')
  t('an unacked finding is untouched',
    one(D.applyAcks([crit('vault_owns_itself', A2)], {})).severity, 'CRITICAL')
  // THE KEY IS kind:asset, so an ack is never a blanket.
  t('acking one KIND does not ack another on the same asset',
    one(D.applyAcks([crit('nested_vault', A2)], { [`vault_owns_itself:${A2}`]: 'x' })).severity, 'CRITICAL')
  t('acking one ASSET does not ack the same kind on another',
    one(D.applyAcks([crit('nested_vault', 'OtherVault11111111111111111111111111111')],
      { [`nested_vault:${A2}`]: 'x' })).severity, 'CRITICAL')
  // THE REASON IS MANDATORY: an ack with no argument is indistinguishable from a
  // mistake, and it is the only record of why a permanent CRITICAL was accepted.
  t('`true` is not an ack', one(D.applyAcks([crit('nested_vault', A2)], { [`nested_vault:${A2}`]: true })).severity, 'CRITICAL')
  t('an empty reason is not an ack', one(D.applyAcks([crit('nested_vault', A2)], { [`nested_vault:${A2}`]: '   ' })).severity, 'CRITICAL')
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
const FLOOR = 328
const bad = R.filter(r => !r.ok)
if (R.length < FLOOR) {
  console.error(`\nONLY ${R.length} assertions ran; the floor is ${FLOOR}. The file stopped early.`)
  process.exit(1)
}
console.log(`\n${'='.repeat(60)}\n${R.length - bad.length}/${R.length} detector assertions as predicted`)
console.log(`every detector proven in BOTH directions: fires when it should, quiet when it should`)
process.exit(bad.length ? 1 : 0)
