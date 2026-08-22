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
t('HIGH on a burn through our burn program',
  D.detectBurns([{ program: BURN_PROG, accounts: [ASSET] }], assets, BURN_PROG)[0].severity, 'HIGH')
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

// detectBurns must not call routine admin work a burn.
t('QUIET on a NON-burn_vault instruction to the burn program',
  D.detectBurns([{ program: BURN_PROG, dataBytes: [9, 9, 9, 9, 9, 9, 9, 9], accounts: [ASSET] }],
    assets, BURN_PROG, [1, 2, 3, 4, 5, 6, 7, 8]).length, 0)
t('HIGH on the burn_vault discriminator itself',
  D.detectBurns([{ program: BURN_PROG, dataBytes: [1, 2, 3, 4, 5, 6, 7, 8], accounts: [ASSET] }],
    assets, BURN_PROG, [1, 2, 3, 4, 5, 6, 7, 8])[0].severity, 'HIGH')

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

console.log('── nested vaults (a vault inside a vault) ──')
{
  const OUTER = 'OuterVault11111111111111111111111111111111'
  const INNER = 'InnerVault11111111111111111111111111111111'
  const OUTER_PDA = 'OuterPda111111111111111111111111111111111'
  const INNER_PDA = 'InnerPda111111111111111111111111111111111'
  const pdaOf = id => ({ [OUTER]: OUTER_PDA, [INNER]: INNER_PDA })[id] || null
  // `[0].kind` THROWS when a detector returns nothing, which aborts the whole
  // selftest with a stack trace instead of reporting a mismatch — every later
  // assertion then never runs. Proven: stubbing this detector to `return []`
  // exited 1 with a TypeError and printed no XX line at all. The `?.` makes a
  // dead detector read as `null` vs the expected kind, which is a finding you
  // can act on. THE SAME FRAGILITY IS ALL OVER THIS FILE and predates v5.
  const HUMAN = 'AliceWallet1111111111111111111111111111111'
  t('CRITICAL when one vault is owned by another vault\'s asset-signer PDA',
    D.detectNestedVaults([{ id: OUTER, owner: HUMAN }, { id: INNER, owner: OUTER_PDA }], pdaOf)[0]?.kind ?? null,
    'nested_vault')
  t('...and it names the HOST vault, not just the inner one',
    D.detectNestedVaults([{ id: OUTER, owner: HUMAN }, { id: INNER, owner: OUTER_PDA }], pdaOf)[0]?.detail?.includes(OUTER) ?? null,
    true)
  // THE OTHER DIRECTION, which is the whole reason this file exists. A detector
  // that has only ever said CRITICAL is exactly as untested as one that has only
  // ever said quiet.
  t('QUIET when every vault is owned by a wallet',
    D.detectNestedVaults([{ id: OUTER, owner: HUMAN }, { id: INNER, owner: HUMAN }], pdaOf).length, 0)
  t('QUIET when a vault is owned by a PDA that is NOT one of our vaults',
    D.detectNestedVaults([{ id: OUTER, owner: 'SomeOtherPda11111111111111111111111111111' }], pdaOf).length, 0)
  t('QUIET on an owner DAS did not return',
    D.detectNestedVaults([{ id: OUTER, owner: null }], pdaOf).length, 0)
  // Proven impossibility 3, one level in: its own PDA, which is a different and
  // worse finding — nobody can reach it, not even by burning something else.
  t('a vault owned by its OWN asset-signer PDA is a distinct finding',
    D.detectNestedVaults([{ id: OUTER, owner: OUTER_PDA }], pdaOf)[0]?.kind ?? null, 'vault_owns_itself')
  t('...and it is not also reported as a nested vault',
    D.detectNestedVaults([{ id: OUTER, owner: OUTER_PDA }], pdaOf).length, 1)
  // A BURNT host is the worst case, not an excluded one: the PDA can never sign
  // again, so anything inside it is already unreachable.
  t('fires when the HOST vault is one the caller listed as burnt',
    D.detectNestedVaults([{ id: OUTER, owner: HUMAN, burnt: true }, { id: INNER, owner: OUTER_PDA }], pdaOf).length, 1)
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
const FLOOR = 195
const bad = R.filter(r => !r.ok)
if (R.length < FLOOR) {
  console.error(`\nONLY ${R.length} assertions ran; the floor is ${FLOOR}. The file stopped early.`)
  process.exit(1)
}
console.log(`\n${'='.repeat(60)}\n${R.length - bad.length}/${R.length} detector assertions as predicted`)
console.log(`every detector proven in BOTH directions: fires when it should, quiet when it should`)
process.exit(bad.length ? 1 : 0)
