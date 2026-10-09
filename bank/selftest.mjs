/**
 * Prove every detector in BOTH directions against synthetic input.
 *
 * The standing rule on this box: a gate that has only ever said OK is untested,
 * and this pipeline is the one that carries what the programs structurally
 * cannot. So each detector gets a case that MUST fire and a case that MUST NOT.
 */
import * as D from './detectors.mjs'
globalThis.__bs58 = (await import('bs58')).default
import * as LK from './lock.mjs'
import * as SPL from './spl.mjs'
import * as AN from './anchor.mjs'
import * as L from './layout.mjs'
import * as AC from './accrual.mjs'
import * as CR from './crank.mjs'
import * as PO from './redemption-poster.mjs'
import * as SW from './swap.mjs'
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
/** Round 45: inside a recorded rehearsal tree, a mainnet program id as this tree's
 *  recorded map rewrote it (`.rehearsal-map`: mainnet id, rehearsal id, name). With no
 *  map, the id itself, so every comparison outside a rehearsal tree stays exact. */
const REHEARSAL_MAP = (() => { try { return new Map(fsx.readFileSync(new URL('../.rehearsal-map', import.meta.url), 'utf8').split('\n')
  .map(l => l.trim().split(/\s+/)).filter(x => x.length >= 3 && x[2] !== 'root').map(([a, b]) => [a, b])) } catch { return null } })()
const viaRehearsalMap = id => REHEARSAL_MAP ? (REHEARSAL_MAP.get(id) ?? `${id} (not in the rehearsal map)`) : id
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

// ROUND 22 (A1): A REAL REDEMPTION'S SHAPE, flattened by the alarm's own
// normaliser. BURN's burn_vault destroys the vault with a Core BurnV1 CPI; that
// inner burn is the redemption, not a bare burn. Every honest redemption used to
// page CRITICAL here.
{
  const enc = b => (globalThis.__bs58).encode(Buffer.from(b))
  const BVD = [150, 115, 145, 83, 24, 135, 83, 99]
  const keys = ['Payer11111111111111111111111111111111111111', ASSET, BURN_PROG, D.CORE_ID, 'SeaL111111111111111111111111111111111111111', OTHER]
  const tx = (inner, topExtra = []) => ({ transaction: { message: { accountKeys: keys, instructions: [
      { programIdIndex: 4, accounts: [1, 0], data: enc([1]) },                      // SEAL open
      { programIdIndex: 2, accounts: [1, 0], data: enc([...BVD, 6]) },             // BURN burn_vault(asset)
      ...topExtra] } }, meta: { innerInstructions: inner } })
  const coreBurnOf = a => ({ programIdIndex: 3, accounts: [a, 0], data: enc([12, 0]) })
  const run = t0 => D.correlateBurns(D.detectBurns(D.normaliseTx(t0), assets, BURN_PROG, BVD))
  t('a REAL redemption (burn_vault + its own inner Core BurnV1) raises NO bare_core_burn',
    run(tx([{ index: 1, instructions: [coreBurnOf(1)] }])).map(f => f.kind), ['burn_via_program'])
  t('...but a TOP-LEVEL Core BurnV1 of the vault in the same transaction is still CRITICAL',
    run(tx([{ index: 1, instructions: [coreBurnOf(1)] }], [coreBurnOf(1)])).some(f => f.kind === 'bare_core_burn' && f.severity === 'CRITICAL'), true)
  t('...and an inner Core BurnV1 under a program that is NOT burn_vault is CRITICAL',
    run(tx([{ index: 0, instructions: [coreBurnOf(1)] }])).some(f => f.kind === 'bare_core_burn'), true)
  t('normaliseTx records each inner instruction\'s parent and each top-level index',
    D.normaliseTx(tx([{ index: 1, instructions: [coreBurnOf(1)] }])).map(i => [i.index, i.parent]), [[0, undefined], [1, undefined], [undefined, 1]])
}

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
  // ROUND 23 (L15): liveness is now asked BEFORE age, so a record whose holder is
  // dead is broken at any age. The race arms below used `dead` for EVERY record,
  // including the fresh ones this process just placed, and relied on age alone
  // to refuse those. `onlyUs` says what they mean: the planted 999999 holder is
  // gone, and the runners racing here (this process) are alive.
  const onlyUs = pid => pid === process.pid
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
  t('...and the breaker holds it alone', LK.acquireLock(L, { alive: onlyUs }).ok, false)
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

  // ── ROUND 23 (L15): LIVENESS BEFORE AGE. MEASURED BEFORE THE FIX: a record a
  // second old whose holder had died was refused for the whole `staleMs` (2 h on
  // the crank's full pass), because age was asked first.
  wipe(); plant({ pid: 999999, token: 'fresh-dead', start: null, at: new Date().toISOString() })
  const freshDead = LK.acquireLock(L, { alive: dead })
  t('L15: a FRESH lock whose holder is DEAD is broken at once, and the break is reported', [freshDead.ok, freshDead.broke?.token], [true, 'fresh-dead'])
  LK.releaseLock(L, freshDead.token)
  wipe(); plant({ pid: process.pid, token: 'fresh-recycled', start: 'not-our-start-time', at: new Date().toISOString() })
  const freshRecycled = LK.acquireLock(L, { alive: live })
  t('L15: ...and so is a fresh lock whose pid was RECYCLED', freshRecycled.ok, true)
  LK.releaseLock(L, freshRecycled.token)
  wipe(); plant({ pid: process.pid, token: 'fresh-self', start: LKstart(), at: new Date().toISOString() })
  t('L15: ...while a fresh lock held by a LIVE process (this one, real pidAlive) is refused', LK.acquireLock(L).ok, false)
  wipe(); plant({ token: 'fresh-no-pid', at: new Date().toISOString() })
  t('L15: ...and a fresh record with NO pid still waits out staleMs (nothing to ask)', LK.acquireLock(L, { alive: dead }).ok, false)
  wipe()

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
    LK.acquireLock(L, { alive: onlyUs }).ok, false)
  t('...and only the winner can free it', LK.releaseLock(L, winner.token), true)

  // ROUND 22 (F4), MEASURED BEFORE THE FIX: a breaker descheduled after its scan
  // while another runner breaks, finishes and releases, and a THIRD takes a fresh
  // generation 0. The first then linked a freed number and BOTH it and the third
  // returned ok. Now whoever places re-scans and loses to any live claim.
  wipe(); plant({ pid: 999999, token: 'stale-F4', start: null, at: old(9) })
  let third = null
  const late = LK.acquireLock(L, { alive: dead, _beforeSteal: () => {
    const b = LK.acquireLock(L, { alive: dead }); LK.releaseLock(L, b.token)
    third = LK.acquireLock(L, { alive: dead }) } })
  t('F4: a breaker that resumes after another runner broke, finished and released, while a third holds a fresh lock: NOT both',
    [late.ok, third?.ok], [false, true])
  t('F4: ...and the third runner\'s lock is still there, untouched', LK.releaseLock(L, third.token), true)

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
  const four = [0, 1, 2, 3].map(() => LK.acquireLock(L, { alive: onlyUs }))
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
  // (round 22, A6) as the reader really marks it: the config AND the program data
  // absent, and Core always produced (it is never "not deployed yet").
  t('QUIET for a program that is not deployed',
    D.missingWatchedKeys({ 'mint._missing': true, 'seal._missing': true, 'burn._missing': true, 'gov._missing': true,
      'prog.seal._missing': true, 'prog.mint._missing': true, 'prog.burn._missing': true, 'prog.gov._missing': true, 'prog.sweep._missing': true,
      'prog.core.upgrade_authority': 'x', 'prog.core.hash': 'x',
      // Round 25 (I2): the swap's third-party programs are produced like Core.
      ...Object.fromEntries(D.THIRD_PARTY_PROGRAMS.flatMap(([n]) => [[`prog.${n}.upgrade_authority`, 'x'], [`prog.${n}.hash`, 'x']])) }), [])
  t('...but a DEPLOYED program whose keys the reader forgot is NAMED (prog.* used to be exempt wholesale)',
    D.missingWatchedKeys(Object.fromEntries(D.WATCHED_KEYS.filter(k => k !== 'prog.mint.hash').map(k => [k, 'x']))), ['prog.mint.hash'])
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
  D.detectStandingRisks({ 'gov.min_voting_secs': 60 }, { production: true })[0].kind, 'test_value_in_production')
t('QUIET on the 3-day voting period Gary ruled',
  D.detectStandingRisks({ 'gov.min_voting_secs': 3 * 86400 }, { production: true }).length, 0)
t('...and a 7-day period is NOT what was ruled, so it fires too (it is fixed forever)',
  D.detectStandingRisks({ 'gov.min_voting_secs': 7 * 86400 }, { production: true })[0]?.kind, 'test_value_in_production')
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
    // Round 29 (INFO): `.mjs` tests too; tests/expiry-budget.mjs was outside this scan.
    ...fsx.readdirSync('/opt/cbob-vaults/tests').filter(f => f.endsWith('.ts') || f.endsWith('.mjs')).map(f => ['tests', f]),
  ].map(([d, f]) => ({ f, path: `${d}/${f}`, src: fsx.readFileSync(`/opt/cbob-vaults/${d}/${f}`, 'utf8') }))
  t('the searched tree covers bank/, scripts/ and tests/',
    ['bank', 'scripts', 'tests'].map(d => srcFiles.some(x => x.path.startsWith(d + '/'))), [true, true, true])
  t('...and every ops script and every top-level test file (tests/*.ts, tests/*.mjs) are in it, none skipped',
    ['scripts/audit-coverage.sh', 'scripts/cron-install.sh', 'scripts/run-tests.sh', 'tests/3prog.test.ts', 'tests/expiry-budget.mjs']
      .filter(n => !srcFiles.some(x => x.path === n)), [])
  const kf = n => ['keys', n].join('/')
  const KEY_OF = { [kf('swap-operator.json')]: 'SWAP-OPERATOR', [kf('crank.json')]: 'CRANK',
    [kf('bank.json')]: 'RETIRED-BANK', [kf('distributor.json')]: 'RETIRED-DISTRIBUTOR',
    // Round 44 (item 22): the dress-rehearsal driver signs with throwaway keys in
    // its tree's own key directory, and refuses to run outside a recorded rehearsal tree.
    [['.rehearsal', 'keys'].join('-')]: 'REHEARSAL-ONLY' }
  const sigPat = new RegExp(['from', 'Secret', 'Key'].join(''))
  const signerSet = extra => [...srcFiles, ...(extra ? [extra] : [])]
    .filter(x => sigPat.test(x.src))
    .map(x => {
      const keys = Object.keys(KEY_OF).filter(k => x.src.includes(k)).map(k => KEY_OF[k])
      return `${x.path} -> ${keys.length === 1 ? keys[0] : keys.length ? keys.join('+') : 'UNPINNED KEY'}`
    }).sort()
  // Round 24 (D7): "in v6" overstated the scan. `launch/create-cbob-token.mjs`
  // signs too (it minted $CBOB once) and lives outside the three scanned trees.
  t('exactly TWO production signers exist in bank/, scripts/ and tests/, each holding a different key, plus the REHEARSAL-ONLY driver (launch/ is not scanned)', signerSet(null), [
    'bank/crank.mjs -> CRANK',
    'bank/revenue.mjs -> SWAP-OPERATOR',
    'scripts/rehearsal-run.mjs -> REHEARSAL-ONLY',
    'scripts/rehearsal-steps.mjs -> REHEARSAL-ONLY',
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
  // ⚠️ ROUND 23 (L5): THIS LIST WAS TYPED BY HAND, AND ROUND 22'S DETECTORS NEVER
  // JOINED IT. MEASURED: cutting the detectRevealStall, detectUnsplitRevenue and
  // detectFrozenVaultAccount calls out of alarm.mjs left this gate at []. It is
  // DERIVED now: every `detect*` export, plus the log parser.
  const V6_WIRED = [...Object.keys(D).filter(n => /^detect/.test(n) && typeof D[n] === 'function'), 'parseCbobLogs']
  // ⚠️ ROUND 24 (L13b): THIS WAS TEXTUAL. `D.x(` anywhere in the file passed, so
  // the gate stayed green when main()'s detectIndexShortfall was deleted (the
  // daily reconcile still called it), when a call sat only in a COMMENT, and when
  // a call's RESULT was thrown away. Now: comments stripped (string-aware), each
  // FUNCTION read on its own, and a call counts only where its result is used:
  // pushed into `findings`, spread into a list, or bound to a name whose
  // `.findings` / `.events` (or the name itself, spread) is read later.
  const stripComments = src => { let out = '', i = 0, q = null
    while (i < src.length) { const c = src[i], d = src[i + 1]
      if (q) { out += c; if (c === '\\') { out += d ?? ''; i += 2; continue } if (c === q) q = null; i++; continue }
      if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue }
      if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
      if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue }
      out += c; i++ }
    return out }
  const bodyOf = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a + 1); return a < 0 || b < 0 ? '' : stripComments(src.slice(a, b)) }
  const consumed = (body, n) => {
    let k = (body.match(new RegExp(`\\.\\.\\.D\\.${n}\\(`, 'g')) || []).length
    for (const m of body.matchAll(new RegExp(`const (\\w+) = (?:await )?D\\.${n}\\(`, 'g')))
      if (new RegExp(`\\b${m[1]}\\.(findings|events)\\b|\\.\\.\\.${m[1]}\\b`).test(body.slice(m.index + m[0].length))) k++
    return k }
  const RECONCILE_ONLY = ['detectUndeclaredTokenAccounts']
  const wiringGate = src => [
    ...V6_WIRED.filter(n => !RECONCILE_ONLY.includes(n) && !consumed(bodyOf(src, 'async function main(', 'async function report('), n)).map(n => `main: ${n}`),
    ...['detectIndexShortfall', 'detectNestedVaults', 'detectUndeclaredTokenAccounts']
      .filter(n => !consumed(bodyOf(src, 'async function reconcile(', 'async function readMintedTotal('), n)).map(n => `reconcile: ${n}`)]
  t('alarm.mjs USES every v6 detector\'s result, in main() (and the reconcile its three), outside comments', wiringGate(alarmSrc), [])
  t('...and the stripped bodies are real: main() is long and its comments are gone',
    [bodyOf(alarmSrc, 'async function main(', 'async function report(').length > 5000, /ROUND|THE CRANK'S HEARTBEAT/.test(bodyOf(alarmSrc, 'async function main(', 'async function report('))], [true, false])
  const mainCut = (from, to) => alarmSrc.slice(0, alarmSrc.indexOf('async function main(')) + alarmSrc.slice(alarmSrc.indexOf('async function main(')).replace(from, to)
  t('L13b: main()\'s detectIndexShortfall DELETED (the reconcile still calls it) is caught',
    wiringGate(mainCut(/findings\.push\(\.\.\.D\.detectIndexShortfall\([^\n]*\n/, '\n')), ['main: detectIndexShortfall'])
  t('L13b: ...a call left only in a COMMENT is caught',
    wiringGate(mainCut('findings.push(...D.detectPoolHealth(cfgAtPool, pool))', '// findings.push(...D.detectPoolHealth(cfgAtPool, pool))')), ['main: detectPoolHealth'])
  t('L13b: ...and a call whose RESULT is thrown away is caught',
    wiringGate(mainCut('findings.push(...D.detectPoolHealth(cfgAtPool, pool))', 'D.detectPoolHealth(cfgAtPool, pool)')), ['main: detectPoolHealth'])
  // ROUND 24 (L13a): the second element here was ALWAYS [] (it listed the names
  // still called after their own call was cut, which is none, by construction).
  // Now: cutting each detector's uses names EXACTLY that detector.
  t('L5: the list is derived (round 23\'s detectors are in it), and deleting ANY ONE call from alarm.mjs turns this red',
    [['detectRevealStall', 'detectUnsplitRevenue', 'detectFrozenVaultAccount', 'detectCrankSilent', 'detectUnsweptRoyalties', 'detectRevenueAccount',
      'detectCrankPosture', 'detectCrankHealth'].every(n => V6_WIRED.includes(n)),
     V6_WIRED.filter(n => !RECONCILE_ONLY.includes(n))
       .filter(n => JSON.stringify(wiringGate(mainCut(new RegExp(`D\\.${n}\\(`, 'g'), 'D.cut(')).filter(x => x.startsWith('main:'))) !== JSON.stringify([`main: ${n}`]))], [true, []])
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
  // ROUND 24 (L12): `ours crank` matched the `crank-reveal` line too, so the
  // OTHER flag order armed the hourly pass. MEASURED: CRANK_LIVE=[ --live].
  t('L12: a reveal lane hand-armed as `--live --reveal-only` does NOT arm the full pass (either flag order)',
    [resolve(`* * * * * cd /opt/cbob-vaults && node bank/crank.mjs --live --reveal-only ${TAGC} crank-reveal`),
     resolve(`* * * * * cd /opt/cbob-vaults && node bank/crank.mjs --reveal-only --live ${TAGC} crank-reveal`)], ['|', '|'])
  t('L12: ...while the armed full-pass line beside it still arms, and so does one with trailing space',
    [resolve(`37 * * * * cd /opt/cbob-vaults && node bank/crank.mjs --live ${TAGC} crank\n* * * * * cd /opt/cbob-vaults && node bank/crank.mjs --reveal-only ${TAGC} crank-reveal`),
     resolve(`37 * * * * cd /opt/cbob-vaults && node bank/crank.mjs --live ${TAGC} crank  `)], ['| --live', '| --live'])
  t('L12: ...and the installer\'s posture print reads the same anchored line the alarm\'s crankArmed does',
    /grep -E -- "\$TAG crank\[\[:space:\]\]\*\\\$"/.test(cron), true)
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
  // was written into. EVERY occurrence of every floor listed below.
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
    // Round 22 (G3): these three were stated in SPEC and checked nowhere.
    // Round 33 (D3): the Running-the-tests block says "47 launch and".
    'launch':     /(\d+) launch\b/g,
    'pob':        /(\d+) Proof-of-Burn\b/g,
    'sim':        /(\d+) simulation assertions\b/g,
    'swap':       /(\d+) swap-fork assertions\b/g,
    // Round 32 (D1): stated in the Running-the-tests block and checked nowhere.
    'expiry':     /(\d+) expiry-budget\b/g,
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
    everywhere(what, { 'on-chain': onchain, detector: det, allocation: alloc, poster, mainnet,
      launch: num(/^LAUNCH_FLOOR=(\d+)/m, runner), pob: num(/^POB_FLOOR=(\d+)/m, runner),
      sim: num(/^SIM_FLOOR=(\d+)/m, fsx.readFileSync('/opt/cbob-vaults/sim/run-sim.sh', 'utf8')),
      swap: num(/^SWAP_FLOOR=(\d+)/m, fsx.readFileSync('/opt/cbob-vaults/sim/swap-fork.sh', 'utf8')),
      expiry: num(/^EXPIRY_FLOOR=(\d+)/m, runner) }[what])
  }
  t('R32 D1: the expiry-budget test\'s own expected count equals the runner\'s EXPIRY_FLOOR',
    num(/assert\.equal\(count, (\d+)/, fsx.readFileSync('/opt/cbob-vaults/tests/expiry-budget.mjs', 'utf8')), num(/^EXPIRY_FLOOR=(\d+)/m, runner))
  // ROUND 43: FOUR SCRIPTS BOOT OR BUILD AGAINST CORE, AND EACH CARRIED ITS OWN
  // COPY OF THE PIN. Metaplex upgraded Core twice under them; a re-pin that missed
  // one copy would leave that runner on a Core mainnet no longer has. (The live
  // comparison is the mainnet probe's; this keeps the four copies one value.)
  {
    const corePins = (src = {}) => [
      ['scripts/run-tests.sh', /^CORE_SHA256_EXPECTED=([0-9a-f]{64})$/m], ['web/test/e2e-localnet.sh', /^CORE_SHA256_EXPECTED=([0-9a-f]{64})$/m],
      ['sim/run-sim.sh', /^CORE_SHA256_EXPECTED=([0-9a-f]{64})$/m], ['scripts/build-mainnet.sh', /^\s*local want=([0-9a-f]{64})$/m],
    ].map(([f, re]) => (src[f] ?? fsx.readFileSync('/opt/cbob-vaults/' + f, 'utf8')).match(re)?.[1] ?? null)
    const pins = corePins()
    t('R43: run-tests, e2e-localnet, run-sim and build-mainnet pin the SAME Metaplex Core', [pins.every(Boolean), new Set(pins).size], [true, 1])
    const drifted = fsx.readFileSync('/opt/cbob-vaults/sim/run-sim.sh', 'utf8').replace(/^CORE_SHA256_EXPECTED=[0-9a-f]{64}$/m, 'CORE_SHA256_EXPECTED=' + 'f'.repeat(64))
    t('R43: ...and one copy left behind by a re-pin is caught', new Set(corePins({ 'sim/run-sim.sh': drifted })).size, 2)
  }
  t('R33 D3: the launch count reader sees the Running-the-tests phrasing and a planted stale one',
    [statedIn('47 launch and 33 live-mainnet', 'launch'), statedIn('48 launch and', 'launch').every(n => n === num(/^LAUNCH_FLOOR=(\d+)/m, runner))], [[47], false])
  t('D3: the swap count gate catches a later stale statement', statedIn('16 swap-fork assertions; 15 swap-fork assertions', 'swap').every(n => n === 16), false)
  t('D3: deleting every swap count fails the nonempty requirement', statedIn('no count', 'swap').length > 0, false)
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
  t('R37 C03: a COMMENTED-OUT -n definition does not count: the real template with it commented is refused, the synthetic case too',
    [D.judgeCronTemplate(cron.replace(/^(\s*)FLOCK="\$FLOCK -n"/m, '$1# FLOCK="$FLOCK -n"')).length > 0,
     D.judgeCronTemplate('# FLOCK="$FLOCK -n"\n7 9 * * * cd $R && $FLOCK /x /usr/bin/node bank/distribute.mjs').length, D.judgeCronTemplate(cron).length], [true, 1, 0])
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
    one(D.applyAcks([crit('unredeemable_owner', A2)], { [`unredeemable_owner:${A2}`]: ack('gary: DAO holds it, accepted') })).severity,
    'INFO')
  t('...and is still PRINTED, with the reason, rather than deleted',
    one(D.applyAcks([crit('unredeemable_owner', A2)], { [`unredeemable_owner:${A2}`]: ack('gary: DAO holds it, accepted') })).detail.includes('ACKNOWLEDGED until 2099-01-01: gary: DAO holds it, accepted'),
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
  // ROUND 36 (L4): since item 58 a nested vault, or one in its own wallet, always
  // has an action (rescue_nested), so neither kind can be muted any more.
  t('R36: nested_vault can NO LONGER be acked (rescue it instead)',
    [one(D.applyAcks([crit('nested_vault', A2)], { [`nested_vault:${A2}`]: ack('gary: host burnt') })).severity,
     one(D.applyAcks([crit('vault_owns_itself', A2)], { [`vault_owns_itself:${A2}`]: ack('gary: bricked') })).severity], ['CRITICAL', 'CRITICAL'])
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
    one(D.applyAcks([crit('unredeemable_owner', A2)], { [`unredeemable_owner:${A2}`]: ack('DAO holds it', '2020-01-01') })).severity,
    'CRITICAL')
  t('...and says WHY it was refused, with the date',
    one(D.applyAcks([crit('unredeemable_owner', A2)], { [`unredeemable_owner:${A2}`]: ack('DAO holds it', '2020-01-01') }))
      .detail.includes('EXPIRED on 2020-01-01'), true)
  t('an ack with NO expiry is refused — a permanent mute is the thing being removed',
    one(D.applyAcks([crit('unredeemable_owner', A2)], { [`unredeemable_owner:${A2}`]: { why: 'DAO holds it' } })).severity,
    'CRITICAL')
  t('a BARE STRING ack is refused, so the never-expiring shape is not the easy one',
    one(D.applyAcks([crit('unredeemable_owner', A2)], { [`unredeemable_owner:${A2}`]: 'DAO holds it' })).severity,
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
  // ROUND 37 (C01): these three drove `nested_vault`, which round 36 made
  // unackable, so they passed whatever judgeAck did. They now use the one kind
  // that CAN be acked, so each fails if its guard is removed.
  t('acking one KIND does not ack another on the same asset',
    one(D.applyAcks([crit('unredeemable_owner', A2)], { [`vault_burned:${A2}`]: ack('x') })).severity, 'CRITICAL')
  t('acking one ASSET does not ack the same kind on another',
    one(D.applyAcks([crit('unredeemable_owner', 'OtherVault11111111111111111111111111111')],
      { [`unredeemable_owner:${A2}`]: ack('x') })).severity, 'CRITICAL')
  // THE REASON IS MANDATORY: an ack with no argument is indistinguishable from a
  // mistake, and it is the only record of why a permanent CRITICAL was accepted.
  t('`true` is not an ack', one(D.applyAcks([crit('unredeemable_owner', A2)], { [`unredeemable_owner:${A2}`]: true })).severity, 'CRITICAL')
  t('an empty reason is not an ack', one(D.applyAcks([crit('unredeemable_owner', A2)], { [`unredeemable_owner:${A2}`]: ack('   ') })).severity, 'CRITICAL')
  t('R37 C01: ...and the same kind WITH a reason does ack (so the three above can fail)',
    one(D.applyAcks([crit('unredeemable_owner', A2)], { [`unredeemable_owner:${A2}`]: ack('gary: DAO holds it') })).severity, 'INFO')
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
  const SQUADS2 = 'MsigDAo111111111111111111111111111111111111' // any multisig but the CBOBTC Squads (round 35: that one is vault_awaiting_return)
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
  // Round 23 (L16): an anchor now carries the split's TOTAL, and must cover the
  // cycle's return; these cycles returned 5,000 sats and these splits moved 5,000.
  const anchorAt = (ts, total = '5000') => ({ sig: 'anchor' + ts, blockTime: Math.floor(Date.parse(ts) / 1000), total })
  t('...and one with a real unclaimed split AFTER its return is QUIET',
    D.detectSplitClaims([anchorAt('2026-08-01T00:30:00Z')],
      { cycles: [{ startedAt: '2026-08-01T00:00:00Z', returnedAt: '2026-08-01T00:20:00Z', returnedSats: '5000', splitByOther: true }] },
      later).some(f => f.kind === 'split_by_other_unanchored'), false)
  // L16, MEASURED BEFORE THE FIX: with the crank splitting every hour, ANY later
  // unclaimed split vouched for a cycle, however small; a 100-sat crank split of
  // mint revenue closed a cycle claiming 5,000 returned sats.
  t('L16: a 5,000-sat cycle with only a LATER 100-sat split is NOT anchored (CRITICAL)',
    D.detectSplitClaims([anchorAt('2026-08-01T00:30:00Z', '100')],
      { cycles: [{ startedAt: '2026-08-01T00:00:00Z', returnedAt: '2026-08-01T00:20:00Z', returnedSats: '5000', splitByOther: true }] },
      later).filter(f => f.kind === 'split_by_other_unanchored').map(f => f.severity), ['CRITICAL'])
  t('L16: ...and a split whose total is unknown (older state) anchors nothing',
    D.detectSplitClaims([{ sig: 'old', blockTime: Math.floor(Date.parse('2026-08-01T00:30:00Z') / 1000) }],
      { cycles: [{ startedAt: '2026-08-01T00:00:00Z', returnedAt: '2026-08-01T00:20:00Z', returnedSats: '5000', splitByOther: true }] },
      later).some(f => f.kind === 'split_by_other_unanchored'), true)
  t('L16: the split total is read off the transfers OUT of the revenue account, ignoring a deposit into it',
    String(D.revenueOutflow([
      { program: D.TOKEN_ID, parsed: { type: 'transferChecked', info: { source: 'RevAta', destination: 'Pool', tokenAmount: { amount: '4250' } } } },
      { program: D.TOKEN_ID, parsed: { type: 'transfer', info: { source: 'RevAta', destination: 'Squads', amount: '750' } } },
      { program: D.TOKEN_ID, parsed: { type: 'transfer', info: { source: 'Minter', destination: 'RevAta', amount: '21000' } } }], 'RevAta')), '5000')
  t('a split that landed BEFORE the cycle returned cannot vouch for it',
    D.detectSplitClaims([anchorAt('2026-07-30T00:00:00Z')],
      { cycles: [{ startedAt: '2026-08-01T00:00:00Z', returnedAt: '2026-08-01T00:20:00Z', splitByOther: true }] },
      later).some(f => f.kind === 'split_by_other_unanchored'), true)
  t('ONE unclaimed split cannot vouch for TWO cycles',
    D.detectSplitClaims([anchorAt('2026-08-01T00:30:00Z')],
      { cycles: [
        { startedAt: '2026-08-01T00:00:00Z', returnedAt: '2026-08-01T00:20:00Z', returnedSats: '5000', splitByOther: true },
        { startedAt: '2026-08-01T00:00:00Z', returnedAt: '2026-08-01T00:21:00Z', returnedSats: '5000', splitByOther: true }] },
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
  const mintp = pinned('programs/cbob-vault-mint/src/lib.rs', /^const OFF_(\w+): usize = (\d+);/gm)
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
    // stage 3c: GOV reads the stops, their times, the collection and the bounds;
    // MINT reads SEAL's reserve list at initialize.
    ['GOV OFF_MINT_COLLECTION', gov.MINT_COLLECTION, M.collection],
    ['GOV OFF_MINT_SALES_STOPPED', gov.MINT_SALES_STOPPED, M.sales_stopped],
    ['GOV OFF_MINT_SWEEP_STOPPED', gov.MINT_SWEEP_STOPPED, M.sweep_stopped],
    ['GOV OFF_MINT_SALES_STOPPED_AT', gov.MINT_SALES_STOPPED_AT, M.sales_stopped_at],
    ['GOV OFF_MINT_SWEEP_STOPPED_AT', gov.MINT_SWEEP_STOPPED_AT, M.sweep_stopped_at],
    ['GOV OFF_MINT_SWEEP_FLOOR', gov.MINT_SWEEP_FLOOR, M.sweep_floor_lamports],
    ['GOV OFF_MINT_COOLDOWN_CEILING', gov.MINT_COOLDOWN_CEILING, M.cooldown_ceiling_secs],
    ['GOV OFF_MINT_RESERVE_CEILING', gov.MINT_RESERVE_CEILING, M.reserve_ceiling_lamports],
    ['GOV OFF_MINT_MAX_BOOST_WEIGHT', gov.MINT_MAX_BOOST_WEIGHT, M.max_boost_weight],
    ['GOV OFF_MINT_MAX_BOOST_EPOCHS', gov.MINT_MAX_BOOST_EPOCHS, M.max_boost_epochs],
    ['MINT OFF_RESERVES (SEAL)', mintp.RESERVES, S0.reserve_mints],
    // Round 22 (L2): the seven scraped constants that were never compared.
    ['MINT OFF_VERSION (SEAL)', mintp.VERSION, S0.version], ['MINT OFF_COLLECTION (SEAL)', mintp.COLLECTION, S0.collection],
    ['BURN OFF_VERSION (SEAL)', burn.VERSION, S0.version], ['BURN OFF_MINT_VERSION', burn.MINT_VERSION, M.version],
    ['GOV OFF_MINT_VERSION', gov.MINT_VERSION, M.version], ['GOV OFF_BURN_VERSION', gov.BURN_VERSION, B.version],
    ['GOV OFF_REC_VERSION', gov.REC_VERSION, V.version],
  ]
  t('every cross-program offset the PROGRAMS pin equals the one this layout computes',
    want.filter(([, a, b]) => a !== b).map(([n, a, b]) => `${n}: rust ${a}, layout ${b}`), [])
  t('...and the scrape found every one of them (none undefined)', want.filter(([, a]) => a === undefined).map(([n]) => n), [])
  // ROUND 22 (L2): AND NOTHING SCRAPED GOES UNCOMPARED. The list above was typed
  // by hand, and seven pinned offsets were scraped and never checked.
  {
    const named = new Set(want.map(([n]) => n.replace(/ \(.*\)$/, '')))
    const unchecked = [...Object.keys(gov).map(k => `GOV OFF_${k}`), ...Object.keys(burn).map(k => `BURN OFF_${k}`), ...Object.keys(mintp).map(k => `MINT OFF_${k}`)]
      .filter(n => !named.has(n))
    t('L2: every OFF_ constant any program pins is compared against the layout (none scraped and ignored)', unchecked, [])
  }
  // ROUND 22 (L3): THE CONSTANTS THE MONEY AND THE DRAW REST ON, scraped from the
  // Rust rather than compared to a literal typed here.
  {
    const src = rs('programs/cbob-vault-mint/src/lib.rs')
    const num = n => Number(((src.match(new RegExp(`const ${n}: \\w+ = ([\\d_]+);`)) || [])[1] ?? 'NaN').replace(/_/g, ''))
    const w = ((src.match(/LEVEL_WEIGHTS: \[u64; 5\] = \[([^\]]*)\]/) || [])[1] ?? '').split(',').map(x => BigInt(x.trim()))
    t('L3: layout.mjs LEVEL_WEIGHTS equal MINT\'s', w.join(','), L.LEVEL_WEIGHTS.join(','))
    t('L3: layout.mjs ACC_SCALE equals MINT\'s', String(num('ACC_SCALE')), String(L.ACC_SCALE))
    t('L3: layout.mjs REVEAL_WINDOW_SLOTS equals MINT\'s', num('REVEAL_WINDOW_SLOTS'), L.REVEAL_WINDOW_SLOTS)
    // readySlot walks two strides of LEADER_GROUP_SLOTS x ENTROPY_GROUP_STRIDE.
    const g = num('LEADER_GROUP_SLOTS'), k = num('ENTROPY_GROUP_STRIDE')
    // Round 24 (L13d): this compared readySlot to a copy of its own expression.
    // Now: the Rust's two constants are the ones readySlot was written for, and
    // readySlot gives the hand-worked values (1000 -> 1008 -> 1016; 1004 -> 1020).
    t('L3: crank.mjs readySlot uses MINT\'s leader-group size and stride',
      [g, k, CR.readySlot(1000), CR.readySlot(1003), CR.readySlot(1004)], [4, 2, 1016, 1016, 1020])
  }
  // ROUND 24 (D6): layout.mjs said SEEDS were "asserted against the Rust" and
  // nothing asserted them. Each seed is now scraped from the program that
  // declares it (all eleven matched when measured; now it is a gate).
  {
    const seedOf = (f, n) => ((rs(f).match(new RegExp(`^pub const ${n}: &\\[u8\\] = b"([^"]*)";`, 'm')) || [])[1]) ?? null
    const SEAL_RS = 'programs/cbob-vaults/src/lib.rs', MINT_RS = 'programs/cbob-vault-mint/src/lib.rs'
    const BURN_RS = 'programs/cbob-vault-burn/src/lib.rs', GOV_RS = 'programs/cbob-vault-gov/src/lib.rs'
    const SEED_SRC = { sealConfig: [SEAL_RS, 'CONFIG_SEED'], seal: [SEAL_RS, 'SEAL_SEED'], mintConfig: [MINT_RS, 'CONFIG_SEED'],
      mintAuthority: [MINT_RS, 'MINT_SEED'], vault: [MINT_RS, 'VAULT_SEED'], revenue: [MINT_RS, 'REVENUE_SEED'], rescue: [MINT_RS, 'RESCUE_SEED'],
      burnConfig: [BURN_RS, 'CONFIG_SEED'], govConfig: [GOV_RS, 'CONFIG_SEED'], gov: [GOV_RS, 'GOV_SEED'],
      proposal: [GOV_RS, 'PROPOSAL_SEED'], vote: [GOV_RS, 'VOTE_SEED'] }
    const judgeSeeds = seeds => Object.entries(seeds).filter(([k, v]) => !SEED_SRC[k] || seedOf(...SEED_SRC[k]) !== v).map(([k, v]) => `${k}: layout ${v}, rust ${SEED_SRC[k] ? seedOf(...SEED_SRC[k]) : 'UNMAPPED'}`)
    t('D6: every PDA seed in layout.mjs equals the one its program declares (12 of 12)', [Object.keys(L.SEEDS).length, judgeSeeds(L.SEEDS)], [12, []])
    t('D6: ...and a mistyped seed, or one no program declares, is CAUGHT',
      [judgeSeeds({ ...L.SEEDS, mintConfig: 'mint-confiq' }).length, judgeSeeds({ ...L.SEEDS, extra: 'x' }).length], [1, 1])
  }
  // ROUND 22 (L1): THE PARSER REFUSES WHAT IT CANNOT READ.
  t('L1: a private field in a struct makes the parser THROW (it used to drop it and stay "equal")',
    (() => { try { L.parseRustStruct('pub struct X {\n    pub a: u64,\n    hidden: u64,\n}', 'X'); return 'parsed' } catch { return 'threw' } })(), 'threw')
  t('L1: ...and so does a pub(crate) field', (() => { try { L.parseRustStruct('pub struct X {\n    pub(crate) b: u8,\n}', 'X'); return 'parsed' } catch { return 'threw' } })(), 'threw')
  // ROUND 22 (L4): BurnConfig, ring included, round-trips.
  t('L4: a BurnConfig with its 64-slot ring round-trips through encode/decode',
    (() => { const ring = Array.from({ length: 64 }, (_, i) => BigInt(1_700_000_000 + i))
      const d = L.decode('BurnConfig', L.encode('BurnConfig', { version: 4, collection: '11111111111111111111111111111111', bump: 254,
        burned_total: 9n, redeem_window_secs: 3600n, rate_head: 5, rate_ring: ring }))
      return [d.rate_head, d.rate_ring[63] === ring[63], d.burned_total] })(), [5, true, 9n])
  // AND THE SUITE'S OWN COPIES. tests/3prog.test.ts reads the same accounts by
  // its own OFF_ constants; a drifted copy there certifies against the wrong byte.
  const testOff = pinned('tests/3prog.test.ts', /\bOFF_(\w+)=(\d+)/g)
  const suite = [['GOVERNANCE', M.governance], ['ROUND_ID', M.round_id], ['PRICE', M.price], ['MINTED_TOTAL', M.minted_total],
    ['SALES_STOPPED', M.sales_stopped], ['SWEEP_STOPPED', M.sweep_stopped], ['GUARDIAN', M.guardian],
    ['SWAP_OPERATOR', M.swap_operator], ['SWEEP_COOLDOWN', M.sweep_cooldown_secs], ['LEVEL_CAPS', M.level_caps],
    ['LEVEL_MINTED', M.level_minted], ['REVEALED', M.revealed_total], ['CHARTER_CLAIMED', M.charter_claimed],
    ['REC_INDEX', V.mint_index], ['REC_REVEAL', V.reveal_slot], ['REC_LEVEL', V.level], ['REC_CHARTER', V.charter],
    ['REC_SET', V.entropy_set], ['REC_ENTROPY', V.entropy],
    // stage 3c
    ['PENDING_GUARDIAN', M.pending_guardian], ['PENDING_GUARDIAN_SET', M.pending_guardian_set],
    ['PENDING_GUARDIAN_AT', M.pending_guardian_at], ['NOTICE', M.notice_secs], ['SWEEP_FLOOR', M.sweep_floor_lamports],
    ['COOLDOWN_CEIL', M.cooldown_ceiling_secs], ['RESERVE_CEIL', M.reserve_ceiling_lamports], ['DIST_EPOCH', M.dist_epoch],
    ['PENDING_COUNT', M.pending_count], ['PENDING_THIS', M.pending_this_epoch], ['REC_PENDING', V.pending], ['REC_REQ_EPOCH', V.request_epoch],
    ['REDEEM_WINDOW', B.redeem_window_secs], ['RATE_HEAD', B.rate_head], ['RATE_RING', B.rate_ring],
    // Round 23 (L6): the $CBOB boost's offsets the suite reads, never compared.
    ['CBOB_MINT', M.cbob_mint], ['MAX_BOOST_W', M.max_boost_weight], ['MAX_BOOST_E', M.max_boost_epochs],
    ['BOOST_PRICE', M.boost_price], ['BOOST_W', M.boost_weight], ['BOOST_E', M.boost_epochs],
    ['BOOSTS_ACTIVE', M.boosts_active], ['BOOSTS_DUE', M.boosts_due], ['BOOST_W_TOTAL', M.boost_weight_total],
    ['CBOB_BURNED', M.cbob_burned_total], ['BOOST_RING', M.boost_expiring],
    ['REC_BOOST_W', V.boost_weight], ['REC_BOOST_END', V.boost_end_epoch], ['REC_CARRY', V.carry_scaled]]
  t("the on-chain suite's own offset constants agree with the layout",
    suite.filter(([k, v]) => testOff[k] !== v).map(([k, v]) => `${k}: suite ${testOff[k]}, layout ${v}`), [])
  // ROUND 23 (L6): THE LAYOUT VERSIONS AND THE BOOST RING, scraped from the Rust.
  // `layout.decode` refuses a version mismatch at runtime and X.1/X.3 decode the
  // live accounts, so a bump was caught by the suite; it was never caught HERE,
  // against the source, and the ring's 64 was a literal nobody compared.
  {
    const VERSION_OF = { CONFIG_VERSION: 'SealConfig', SEAL_CONFIG_VERSION: 'SealConfig', MINT_CONFIG_VERSION: 'MintConfig',
      VAULT_RECORD_VERSION: 'VaultRecord', BURN_CONFIG_VERSION: 'BurnConfig', GOV_CONFIG_VERSION: 'GovConfig' }
    const progSrcs = ['programs/cbob-vaults/src/lib.rs', 'programs/cbob-vault-mint/src/lib.rs',
      'programs/cbob-vault-burn/src/lib.rs', 'programs/cbob-vault-gov/src/lib.rs'].map(f => [f, rs(f)])
    const versions = srcs => srcs.flatMap(([f, src]) => [...src.matchAll(/^pub const (\w*VERSION): u8 = (\d+);/gm)].map(m => [f, m[1], Number(m[2])]))
    const judgeVersions = srcs => versions(srcs).filter(([, n, v]) => !VERSION_OF[n] || L.STRUCTS[VERSION_OF[n]].version !== v)
      .map(([f, n, v]) => `${f.split('/')[1]} ${n} = ${v}, layout ${VERSION_OF[n] ? L.STRUCTS[VERSION_OF[n]].version : 'UNMAPPED'}`)
    t('L6: every layout version every program declares (its own and its copies of a sibling\'s) equals layout.mjs\'s',
      [[...new Set(versions(progSrcs).map(([, n]) => VERSION_OF[n]))].sort(), judgeVersions(progSrcs)],
      [['BurnConfig', 'GovConfig', 'MintConfig', 'SealConfig', 'VaultRecord'], []])
    t('L6: ...and a bumped MINT_CONFIG_VERSION in any copy is CAUGHT',
      judgeVersions(progSrcs.map(([f, src]) => [f, src.replace('pub const MINT_CONFIG_VERSION: u8 = 6;', 'pub const MINT_CONFIG_VERSION: u8 = 7;')])).length > 0, true)
    const ringOf = src => Number((src.match(/^const BOOST_RING: usize = (\d+);/m) || [])[1] ?? NaN)
    const mintSrc = rs('programs/cbob-vault-mint/src/lib.rs')
    const ringOk = src => ringOf(src) === L.fixedSize('[u32; BOOST_RING]') / 4 && ringOf(src) === Number(((rs('tests/3prog.test.ts').match(/\bBOOST_RING=(\d+)/) || [])[1]))
    t('L6: MINT\'s BOOST_RING equals the ring layout.mjs decodes and the suite reads (64)', [ringOf(mintSrc), ringOk(mintSrc)], [64, true])
    t('L6: ...and a ring of 128 in the Rust is CAUGHT', ringOk(mintSrc.replace('const BOOST_RING: usize = 64;', 'const BOOST_RING: usize = 128;')), false)
  }
  // DECODE: round trip, and every refusal names its reason.
  const mc = Object.fromEntries(L.STRUCTS.MintConfig.fields.map(([f, ty]) => [f,
    ty === 'Pubkey' ? '11111111111111111111111111111111' : ty === 'bool' ? false : ty === '[u32; 5]' ? [1, 2, 3, 4, 5]
    : ty === '[u32; BOOST_RING]' ? Array.from({ length: 64 }, (_, i) => i)
    : ty === '[u8; 32]' ? '00'.repeat(32) : /^u(64|128)$|^i64$/.test(ty) ? 7n : 7]))
  mc.version = 6; mc.acc_scaled = (1n << 100n) + 3n; mc.last_distribute_at = -5n; mc.sales_stopped = true
  const enc = L.encode('MintConfig', mc)
  const dec = L.decode('MintConfig', enc)
  t('a MintConfig round-trips, u128 and negative i64 included',
    [dec.acc_scaled === mc.acc_scaled, dec.last_distribute_at === -5n, dec.sales_stopped, dec.level_caps.join()], [true, true, true, '1,2,3,4,5'])
  // ⚠️ ROUND 24 (L13c): THIS COMPARED JS TO JS. `enc.length` is this file's own
  // encoder; the program's allocation is MINT_CONFIG_SPACE / VAULT_RECORD_SPACE,
  // which nothing read. Scraped and evaluated now (each is a sum of products of
  // literals and three named constants), and held to the layout minus padding.
  {
    const mintRs = rs('programs/cbob-vault-mint/src/lib.rs')
    const constOf = (src, n) => Number((src.match(new RegExp(`const ${n}: usize = (\\d+);`)) || [])[1])
    const spaceOf = (src, n) => {
      const m = src.match(new RegExp(`const ${n}: usize = ([^;]+);`))
      if (!m) return NaN
      const ex = m[1].replace(/BOOST_RING/g, constOf(src, 'BOOST_RING')).replace(/CONFIG_PADDING/g, constOf(src, 'CONFIG_PADDING'))
        .replace(/RECORD_PADDING/g, constOf(src, 'RECORD_PADDING'))
      return /^[\d\s+*()]+$/.test(ex) ? Function(`return (${ex})`)() : NaN
    }
    const judgeSpace = src => [spaceOf(src, 'MINT_CONFIG_SPACE') - constOf(src, 'CONFIG_PADDING'), spaceOf(src, 'VAULT_RECORD_SPACE') - constOf(src, 'RECORD_PADDING')]
    t('L13c: MINT_CONFIG_SPACE and VAULT_RECORD_SPACE, scraped from the Rust and evaluated, less padding, are the layout\'s fixed lengths',
      [judgeSpace(mintRs), [L.fixedLength('MintConfig'), L.fixedLength('VaultRecord')], enc.length === L.fixedLength('MintConfig')], [[1005, 211], [1005, 211], true])
    t('L13c: ...and one byte more in the Rust\'s allocation is CAUGHT',
      judgeSpace(mintRs.replace('+ 4 * BOOST_RING + CONFIG_PADDING;', '+ 4 * BOOST_RING + 1 + CONFIG_PADDING;'))[0] === L.fixedLength('MintConfig'), false)
  }
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
    new RegExp('not .*' + L.PROGRAM_IDS.mint).test(refuse(() => L.readPinned('MintConfig', { owner: { toBase58: () => 'Someone' }, data: enc }, class { constructor(k) { this.k = k } toBase58() { return this.k } }))), true)
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
  // ROUND 35 (item 58): the rescue line, exactly as MINT prints it.
  const resc = l => D.parseCbobLogs([inv(MINTID, 1), `Program log: CBOB_VAULT_RESCUED ${l}`, ok(MINTID)]).events
  const orph = resc('asset=V1 host=H1 to=SQ orphan=true'), back = resc('asset=V2 host=H2 to=OWN orphan=false')
  t('R35: a rescue is read with every field, orphan as a boolean',
    [orph[0]?.asset, orph[0]?.host, orph[0]?.to, orph[0]?.orphan, back[0]?.orphan], ['V1', 'H1', 'SQ', true, false])
  t('R35: ...a rescue printed by ANOTHER program is ignored',
    D.parseCbobLogs([inv(EVIL, 1), 'Program log: CBOB_VAULT_RESCUED asset=V1 host=H1 to=SQ orphan=true', ok(EVIL)]).events, [])
  const re = D.detectProgramEvents([...orph, ...back, ...resc('asset=V3 host=V3 to=SQ orphan=true')], 'sig')
  t('R35: EVERY rescue pages HIGH and urgent (a person must return it from the Squads)',
    re.map(f => [f.kind, f.severity, !!f.urgent]), [['vault_rescued_to_squads', 'HIGH', true], ['vault_rescued_to_squads', 'HIGH', true], ['vault_rescued_to_squads', 'HIGH', true]])
  t('R35: ...naming why: a burned host, another holder\'s vault, or its own deposit address',
    [re[0].detail.includes('(H1) was burned'), re[1].detail.includes("another holder's vault H2"), re[2].detail.includes('own deposit address')], [true, true, true])
  t('R35: ...registered once, and a vault HELD by the Squads is its own level kind, not unredeemable_owner',
    [D.ALARM_KINDS.vault_rescued_to_squads, D.ALARM_KINDS.vault_awaiting_return,
     D.detectNestedVaults([{ id: 'V9', owner: D.CBOBTC_SQUADS }], () => null, () => false).map(f => [f.kind, f.severity])],
    ['once', 'level', [['vault_awaiting_return', 'HIGH']]])
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
  // ROUND 45 (V45o-3): a FROZEN pool past the grace is still CRITICAL, but its text
  // says the distribution waits for the thaw, never that every layer failed.
  { const fr = D.detectDistributionOverdue(base, { nowSec: due + 7 * 3600, poolAvail: 50n, graceSecs: 6 * 3600, poolFrozen: true })[0]
    const ok = D.detectDistributionOverdue(base, { nowSec: due + 7 * 3600, poolAvail: 50n, graceSecs: 6 * 3600, poolFrozen: false })[0]
    t('R45 V45o-3: during a pool freeze the overdue page names the freeze and says there is nothing to run by hand; the unfrozen control still blames the missed runs',
      [fr?.severity, /FROZEN/.test(fr?.detail ?? ''), /all failed to happen|distribute\(false\)/.test(fr?.detail ?? ''), /all failed to happen/.test(ok?.detail ?? '')], ['CRITICAL', true, false, true]) }
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
  // THE ROLLING WINDOW, BURN's arithmetic (stage 3c): room = cap minus the
  // redemptions the 64-slot ring holds inside the last window.
  const bk = (live, times) => ({ 'mint.minted_total': String(live), 'burn.burned_total': '0', 'mint.bare_burns_retired': '0',
    'burn.redeem_window_secs': '3600', 'burn.rate_head': String(times.length % 64),
    'burn.rate_ring': [...times.map(String), ...Array(64 - times.length).fill('0')] })
  // Real unix times: an empty ring slot is 0, i.e. decades ago, as on chain.
  const T = 1_700_000_000
  const at = (n, t0) => Array.from({ length: n }, () => String(t0))
  t('2,100 live vaults: cap is ceil(2100 x 2.1%) = 45 an hour', String(D.redemptionCapacity(bk(2100, []), T).cap), '45')
  t('...an idle window has ALL 45 left', String(D.redemptionCapacity(bk(2100, []), T).remaining), '45')
  t('...45 redemptions in the last hour leave 0, and it pages', [String(D.redemptionCapacity(bk(2100, at(45, T)), T).remaining),
    D.detectRedemptionRate(bk(2100, at(45, T)), T)[0]?.kind], ['0', 'redemptions_near_cap'])
  t('...NEAR full (under 20% room) pages too', D.detectRedemptionRate(bk(2100, at(40, T)), T).length, 1)
  t('...while a comfortable window is QUIET', D.detectRedemptionRate(bk(2100, at(10, T)), T).length, 0)
  // THE 2x BURST IS GONE: the stage-3b bucket gave back cap/2 half an hour after
  // a full drain; the window gives back NOTHING until the drained hour is over.
  t('half an hour after 45 redemptions there is STILL no room (a bucket would have refilled 22)',
    String(D.redemptionCapacity(bk(2100, at(45, T)), T + 1800).remaining), '0')
  t('...and a full hour after, all 45 are back at once', String(D.redemptionCapacity(bk(2100, at(45, T)), T + 3600).remaining), '45')
  t('3 live vaults: the floor of ONE an hour holds (the last ones can always leave)', String(D.redemptionCapacity(bk(3, []), T).cap), '1')
  t('a cap above the 64-slot ring is held to 64 (stricter, never looser)', String(D.redemptionCapacity(bk(4000, []), T).cap), '64')
  t('an unreadable window is null, never a guess', [D.redemptionCapacity({}, 1), D.redemptionCapacity({ ...bk(3, []), 'burn.rate_ring': [] }, 1)], [null, null])
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
    D.detectUpgradeAuthorityAfterLock(progs, { lockDeadlineSec: 100, nowSec: 200, production: true }).map(f => f.kind), ['program_not_locked'])
  t('...quiet before the date (the deploy needs the key)', D.detectUpgradeAuthorityAfterLock(progs, { lockDeadlineSec: 300, nowSec: 200, production: true }).length, 0)
  t('...quiet with no date configured', D.detectUpgradeAuthorityAfterLock(progs, { nowSec: 200 }).length, 0)
  t('...and quiet once every program is IMMUTABLE',
    D.detectUpgradeAuthorityAfterLock({ ...progs, 'prog.seal.upgrade_authority': 'IMMUTABLE' }, { lockDeadlineSec: 100, nowSec: 200, production: true }).length, 0)
}

console.log('── v6: standing risks and drift, on the v6 config ──')
{
  t('an ARMED swap-operator replacement is CRITICAL every pass',
    D.detectStandingRisks({ 'mint.pending_swap_operator': OTHER, 'mint.pending_swap_operator_at': '9' }).some(f => f.kind === 'swap_operator_armed'), true)
  t('...and the default pubkey is not armed',
    D.detectStandingRisks({ 'mint.pending_swap_operator': D.DEFAULT_PUBKEY }).some(f => f.kind === 'swap_operator_armed'), false)
  t('a PENDING GUARDIAN CHANGE is CRITICAL every pass (stage 3c), and a retirement says so',
    [D.detectStandingRisks({ 'mint.pending_guardian_set': true, 'mint.pending_guardian': OTHER, 'mint.pending_guardian_at': '9' })[0]?.kind,
     /RETIRED/.test(D.detectStandingRisks({ 'mint.pending_guardian_set': true, 'mint.pending_guardian': D.DEFAULT_PUBKEY })[0]?.detail ?? '')],
    ['guardian_armed', true])
  t('vaults ELIGIBLE and not yet joined are visible at INFO (they hold every distribution); this-epoch requests are not',
    [D.detectStandingRisks({ 'mint.pending_count': '3', 'mint.pending_this_epoch': '1' })[0]?.kind,
     D.detectStandingRisks({ 'mint.pending_count': '2', 'mint.pending_this_epoch': '2' }).length], ['joins_waiting', 0])
  t('...and nothing pending is quiet', D.detectStandingRisks({ 'mint.pending_guardian_set': false, 'mint.pending_guardian': D.DEFAULT_PUBKEY }).length, 0)
  t('PRODUCTION: the 7-day notice and Gary\'s 21% / 51% / 3-day governance are asserted (fixed forever at initialize)',
    D.detectStandingRisks({ 'mint.notice_secs': '60', 'gov.quorum_bps': 500, 'gov.threshold_bps': 6000, 'gov.min_voting_secs': '60' }, { production: true })
      .filter(f => f.kind === 'test_value_in_production').length, 4)
  t('PRODUCTION: the three tighten bounds Gary approved (1 SOL, 24 h, 0.1 SOL) are asserted exactly',
    D.detectStandingRisks({ 'mint.sweep_floor_lamports': '500000000', 'mint.cooldown_ceiling_secs': '30',
      'mint.reserve_ceiling_lamports': '10000000000' }, { production: true }).filter(f => f.kind === 'test_value_in_production').length, 3)
  t('...and the ruled values are QUIET', D.detectStandingRisks({ 'mint.notice_secs': '604800', 'gov.quorum_bps': 2100,
    'gov.threshold_bps': 5100, 'gov.min_voting_secs': '259200', 'mint.sweep_floor_lamports': '1000000000',
    'mint.cooldown_ceiling_secs': '86400', 'mint.reserve_ceiling_lamports': '100000000' }, { production: true }).length, 0)
  t('the Proof of Burn collection\'s UPDATE AUTHORITY moving is CRITICAL (Gary kept it hot)',
    D.detectConfigDrift({ 'pob_collection.update_authority': 'a' }, { 'pob_collection.update_authority': 'b' })[0]?.severity, 'CRITICAL')
  t('a STOPPED sale is visible at INFO, not paged every pass',
    D.detectStandingRisks({ 'mint.sales_stopped': true }).map(f => [f.kind, f.severity]), [['sales_stopped', 'INFO']])
  t('a retired guardian is visible at INFO', D.detectStandingRisks({ 'mint.guardian': D.DEFAULT_PUBKEY })[0]?.kind, 'guardian_retired')
  t('PRODUCTION: a test-length payout period or redemption window is CRITICAL (fixed forever at initialize)',
    D.detectStandingRisks({ 'mint.monthly_secs': '150', 'burn.redeem_window_secs': '10' }, { production: true })
      .filter(f => f.kind === 'test_value_in_production').length, 2)
  t('...the real values are QUIET', D.detectStandingRisks({ 'mint.monthly_secs': '2592000', 'burn.redeem_window_secs': '3600' }, { production: true }).length, 0)
  t('...and a test chain is not judged on them', D.detectStandingRisks({ 'mint.monthly_secs': '150' }).length, 0)
  const FOREVER = ['mint.split_bps', 'mint.bank_treasury', 'mint.pool_ata', 'mint.max_supply', 'mint.pob_root',
    'mint.charter_closes_at', 'mint.monthly_secs', 'burn.redeem_window_secs', 'gov.quorum_bps', 'gov.min_voting_secs', 'mint.level_caps',
    'mint.notice_secs', 'mint.sweep_floor_lamports', 'mint.cooldown_ceiling_secs', 'mint.reserve_ceiling_lamports']
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

console.log('── round 22: the off-chain findings, each both ways ──')
{
  const T = 1_700_000_000
  // A3: an idle window is never near the cap.
  const idle = { 'mint.minted_total': '3', 'burn.burned_total': '0', 'mint.bare_burns_retired': '0', 'burn.redeem_window_secs': '3600',
    'burn.rate_head': '0', 'burn.rate_ring': Array(64).fill('0') }
  t('A3: an IDLE window at a cap of one does not page (it did, at every supply up to 47)', D.detectRedemptionRate(idle, T).length, 0)
  t('A3: ...while that cap actually used up still does', D.detectRedemptionRate({ ...idle, 'burn.rate_head': '1', 'burn.rate_ring': [String(T), ...Array(63).fill('0')] }, T).length, 1)
  // A4: the stalls.
  const st = { 'mint.last_distribute_at': String(T), 'mint.monthly_secs': '2592000', 'mint.total_active_weight': '0',
    'mint.pending_count': '3', 'mint.pending_this_epoch': '3' }
  t('A4: nobody joined, 3 waiting, the month + grace passed: launch_tick_overdue CRITICAL (it was silent)',
    D.detectDistributionOverdue(st, { nowSec: T + 2592000 + 7 * 3600, poolAvail: 0n }).map(f => [f.kind, f.severity]), [['launch_tick_overdue', 'CRITICAL']])
  t('A4: ...quiet before the month is up', D.detectDistributionOverdue(st, { nowSec: T + 3600, poolAvail: 0n }).length, 0)
  t('A4: vaults ELIGIBLE and unjoined long after a distribution: joins_stalled HIGH',
    D.detectDistributionOverdue({ ...st, 'mint.total_active_weight': '4', 'mint.pending_this_epoch': '0' }, { nowSec: T + 7 * 3600, poolAvail: 0n }).map(f => f.kind), ['joins_stalled'])
  t('BOOST: a DUE boost unexpired long after a distribution: boosts_stalled HIGH',
    D.detectDistributionOverdue({ ...st, 'mint.total_active_weight': '4', 'mint.pending_count': '0', 'mint.pending_this_epoch': '0', 'mint.boosts_due': '1' },
      { nowSec: T + 7 * 3600, poolAvail: 0n }).map(f => [f.kind, f.severity]), [['boosts_stalled', 'HIGH']])
  t('BOOST: ...quiet inside the grace, and quiet with none due',
    [D.detectDistributionOverdue({ ...st, 'mint.total_active_weight': '4', 'mint.pending_count': '0', 'mint.pending_this_epoch': '0', 'mint.boosts_due': '1' }, { nowSec: T + 3600, poolAvail: 0n }).length,
     D.detectDistributionOverdue({ ...st, 'mint.total_active_weight': '4', 'mint.pending_count': '0', 'mint.pending_this_epoch': '0', 'mint.boosts_due': '0' }, { nowSec: T + 7 * 3600, poolAvail: 0n }).length], [0, 0])
  t('BOOST: the $CBOB mint and the boost bounds are watched as fixed-forever (CRITICAL on any change)',
    ['mint.cbob_mint', 'mint.max_boost_weight', 'mint.max_boost_epochs'].map(k => D.detectConfigDrift({ [k]: 'a' }, { [k]: 'b' })[0]?.severity), ['CRITICAL', 'CRITICAL', 'CRITICAL'])
  t('BOOST: ...and a vote changing the boost terms is reported',
    D.detectConfigDrift({ 'mint.boost_price': '0' }, { 'mint.boost_price': '5' })[0]?.severity, 'HIGH')
  t('A4: ...quiet inside the grace (the crank joins them each pass)',
    D.detectDistributionOverdue({ ...st, 'mint.total_active_weight': '4', 'mint.pending_this_epoch': '0' }, { nowSec: T + 3600, poolAvail: 0n }).length, 0)
  const q = (m, r) => ({ 'mint.minted_total': String(m), 'mint.revealed_total': String(r) })
  t('A4: a level queue that did not move between two passes pages', D.detectRevealStall(q(10, 7), q(10, 7))[0]?.kind, 'reveal_queue_stalled')
  t('A4: ...quiet when it moved, when it is empty, or on the first pass',
    [D.detectRevealStall(q(10, 7), q(11, 8)).length, D.detectRevealStall(q(10, 10), q(10, 10)).length, D.detectRevealStall(null, q(10, 7)).length], [0, 0, 0])
  // A5: the lock deadline.
  const progs = { 'prog.seal.upgrade_authority': 'K', 'prog.mint.upgrade_authority': 'K', 'prog.burn.upgrade_authority': 'IMMUTABLE', 'prog.gov.upgrade_authority': 'K' }
  t('A5: deployed, upgradeable, NO deadline on record, production: lock_deadline_unset CRITICAL',
    D.detectUpgradeAuthorityAfterLock(progs, { lockDeadlineSec: null, nowSec: T, production: true }).map(f => f.kind), ['lock_deadline_unset'])
  t('A5: ...quiet when every program is already immutable, or nothing is deployed',
    [D.detectUpgradeAuthorityAfterLock({ 'prog.seal.upgrade_authority': 'IMMUTABLE' }, { nowSec: T, production: true }).length,
     D.detectUpgradeAuthorityAfterLock({}, { nowSec: T, production: true }).length], [0, 0])
  // A7: the fixed-forever wiring is pinned in production.
  const wiring = { 'mint.max_supply': '2100', 'mint.level_caps': [945, 525, 315, 210, 105], 'mint.payment_mint': D.CBBTC_MINT,
    'mint.bank_treasury': D.CBOBTC_SQUADS, 'seal.reserve_mints': D.RESERVE_MINTS, 'mint.pob_root': D.POB_ROOT,
    'mint.charter_opens_at': String(T), 'mint.charter_closes_at': String(T + 604800) }
  t('A7: the ruled wiring is QUIET in production', D.detectStandingRisks(wiring, { production: true }).length, 0)
  t('A7: ...and each field changed is CRITICAL (supply, census, payment mint, treasury, reserves, PoB root, charter length)',
    [['mint.max_supply', '21000'], ['mint.level_caps', [900, 500, 300, 200, 100]], ['mint.payment_mint', OTHER], ['mint.bank_treasury', OTHER],
     ['seal.reserve_mints', [D.CBBTC_MINT]], ['mint.pob_root', '00'.repeat(32)], ['mint.charter_closes_at', String(T + 1209600)]]
      .map(([k, v]) => D.detectStandingRisks({ ...wiring, [k]: v }, { production: true }).some(f => f.kind === 'test_value_in_production')), [true, true, true, true, true, true, true])
  // A9: a legal tightened sweep is status, not a permanent HIGH.
  t('A9: a vote-tightened 24 h / 1 SOL sweep is INFO, never a HIGH that cannot be acked',
    D.detectStandingRisks({ 'mint.sweep_cooldown_secs': '86400', 'mint.max_sweep_lamports': '1000000000' }).every(f => f.severity === 'INFO'), true)
  // S1: unsplit revenue.
  t('S1: mint-price cbBTC unsplit past the grace pages', D.detectUnsplitRevenue({ amount: 21000n, sinceSec: T, nowSec: T + 7 * 3600 })[0]?.kind, 'revenue_unsplit')
  t('S1: ...quiet inside the grace, or with nothing there',
    [D.detectUnsplitRevenue({ amount: 21000n, sinceSec: T, nowSec: T + 3600 }).length, D.detectUnsplitRevenue({ amount: 0n, sinceSec: T, nowSec: T + 9e5 }).length], [0, 0])
  // F6: a frozen vault account.
  t('F6: a FROZEN vault cbBTC account pages HIGH and says it blocks the redemption',
    D.detectFrozenVaultAccount({ vault: 'V', mint: D.CBBTC_MINT, isPayment: true }).map(f => [f.kind, f.severity, /cannot be redeemed/.test(f.detail)]), [['vault_account_frozen', 'HIGH', true]])
}

console.log('── round 23: the off-chain findings, each both ways ──')
{
  const T = 1_700_000_000, H = 3600
  const ok5000 = { state: 'ok', amount: 5000n, frozen: false }
  const unsplit = rc => D.detectUnsplitRevenue({ amount: 5000n, sinceSec: rc.since, nowSec: T }).map(f => [f.kind, f.severity])
  // M1, MEASURED BEFORE THE FIX: the clock reset only on a zero balance, so a
  // sale with a mint every ~16 min paged revenue_unsplit HIGH every half hour
  // from hour six although the crank split every hour.
  t('M1: first sighting 7 h ago and a cbBTC split 1 h ago: QUIET, the clock restarts at the split',
    (() => { const rc = D.detectRevenueAccount({ read: ok5000, prevSince: T - 7 * H, splits: [{ sig: 's', blockTime: T - H }], nowSec: T })
      return [rc.since, unsplit(rc)] })(), [T - H, []])
  t('M1: ...first sighting 7 h ago and NO split since: revenue_unsplit HIGH',
    unsplit(D.detectRevenueAccount({ read: ok5000, prevSince: T - 7 * H, splits: [{ sig: 'old', blockTime: T - 9 * H }], nowSec: T })), [['revenue_unsplit', 'HIGH']])
  t('M1: ...and an empty account stops the clock', D.detectRevenueAccount({ read: { ...ok5000, amount: 0n }, prevSince: T - 7 * H, nowSec: T }), { since: null, findings: [] })
  // L10: an unreadable account pages, and the clock is KEPT, not reset.
  t('L10: an UNREADABLE revenue account after initialize is HIGH and keeps the previous clock',
    ['absent', 'foreign', 'malformed', null].map(st => { const rc = D.detectRevenueAccount({ read: st ? { state: st, amount: 0n } : null, prevSince: T - 7 * H, nowSec: T })
      return [rc.since, rc.findings.map(f => [f.kind, f.severity])] }),
    Array(4).fill([T - 7 * H, [['revenue_account_unreadable', 'HIGH']]]))
  // L9: frozen at ANY balance.
  t('L9: a FROZEN revenue account is HIGH even holding nothing; a healthy one is QUIET',
    [D.detectRevenueAccount({ read: { state: 'ok', amount: 0n, frozen: true }, nowSec: T }).findings.map(f => [f.kind, f.severity]),
     D.detectRevenueAccount({ read: { state: 'ok', amount: 0n, frozen: false }, nowSec: T }).findings], [[['revenue_account_frozen', 'HIGH']], []])
  // M3: an armed crank that stopped completing full passes.
  t('M3: armed, last full pass 4 h ago: crank_silent HIGH',
    D.detectCrankSilent({ stampSec: T - 4 * H, live: true, armedSinceSec: T - 99 * H, nowSec: T }).map(f => [f.kind, f.severity]), [['crank_silent', 'HIGH']])
  t('M3: ...QUIET when the pass is fresh, when the crank is a dry run, or when it was armed under 3 h ago and has not stamped yet',
    [D.detectCrankSilent({ stampSec: T - H, live: true, nowSec: T }).length, D.detectCrankSilent({ stampSec: T - 99 * H, live: false, nowSec: T }).length,
     D.detectCrankSilent({ stampSec: null, live: true, armedSinceSec: T - 2 * H, nowSec: T }).length], [0, 0, 0])
  t('M3: ...and armed 4 h ago with NO stamp ever pages', D.detectCrankSilent({ stampSec: null, live: true, armedSinceSec: T - 4 * H, nowSec: T }).length, 1)
  t('M3: the heartbeat parses, and a torn or foreign file reads as NO heartbeat',
    [D.parseCrankHeartbeat('{"atSec": 1700000000, "failures": 0}'), D.parseCrankHeartbeat('{"atS'), D.parseCrankHeartbeat('{}'), D.parseCrankHeartbeat(null)], [T, null, null, null])
  {
    const TAGC = '#cbob-vault-cron'
    t('M3: "armed" is our tagged full-pass line with --live, exactly as the installer prints it',
      [D.crankArmed(`37 * * * * cd /opt/cbob-vaults && mkdir -p x && /usr/bin/flock -n x/crank.flock /usr/bin/node bank/crank.mjs --live >> /var/log/cbob/crank.log 2>&1 ${TAGC} crank`),
       D.crankArmed(`37 * * * * cd /opt/cbob-vaults && /usr/bin/node bank/crank.mjs >> /var/log/cbob/crank.log 2>&1 ${TAGC} crank`),
       D.crankArmed(`# 37 * * * * cd /opt/cbob-vaults && /usr/bin/node bank/crank.mjs --live ${TAGC} crank`),
       D.crankArmed(`* * * * * cd /opt/cbob-vaults && /usr/bin/node bank/crank.mjs --reveal-only --live >> x 2>&1 ${TAGC} crank-reveal`), D.crankArmed('')],
      [true, false, false, false, false])
  }
  // M4: royalty SOL nobody swept.
  const SOL = 1_000_000_000n
  const roy = o => D.detectUnsweptRoyalties({ lamports: 2n * SOL + 50_000_000n, reserve: '50000000', floor: '1000000000', nowSec: T, ...o })
  t('M4: 2 SOL above the reserve for 25 h: royalties_unswept HIGH', roy({ prevSince: T - 25 * H, prevLamports: 2n * SOL + 50_000_000n }).findings.map(f => [f.kind, f.severity]), [['royalties_unswept', 'HIGH']])
  t('M4: ...QUIET for 5 h, for 0.04 SOL, after a sweep since the last pass (the balance FELL), or with the sweep brake on',
    [roy({ prevSince: T - 5 * H }).findings.length, roy({ lamports: 90_000_000n, prevSince: T - 99 * H }).findings.length,
     roy({ prevSince: T - 25 * H, prevLamports: 9n * SOL }).findings.length, roy({ prevSince: T - 25 * H, sweepStopped: true }).findings.length], [0, 0, 0, 0])
  // L7: the alarm's own $CBOB pin had no arm either.
  t('L7: a $CBOB mint other than the ruled one is CRITICAL in production; the ruled one is quiet',
    [D.detectStandingRisks({ 'mint.cbob_mint': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }, { production: true }).map(f => [f.kind, f.severity]),
     D.detectStandingRisks({ 'mint.cbob_mint': D.CBOB_MINT }, { production: true })], [[['test_value_in_production', 'CRITICAL']], []])
  // L13: the Proof of Burn collection, pinned like the launch gate pins it.
  t('L13: a Proof of Burn collection other than Giraffish Moments is test_value_in_production; the ruled one is quiet',
    [D.detectStandingRisks({ 'mint.pob_collection': OTHER }, { production: true }).map(f => f.kind),
     D.detectStandingRisks({ 'mint.pob_collection': D.POB_COLLECTION }, { production: true })], [['test_value_in_production'], []])
  // L11, MEASURED BEFORE THE FIX: the first pass after initialize paged every
  // fixed-forever value as drift from null (27 CRITICALs for one MintConfig).
  t('L11: a program APPEARING (absent in the last snapshot) is not drift',
    [D.detectConfigDrift({ 'mint._missing': true }, { 'mint.split_bps': 8500, 'mint.pool_ata': 'P', 'collection.plugins_hash': 'h' }),
     D.detectConfigDrift({ 'prog.mint._missing': true }, { 'prog.mint.hash': 'abc', 'prog.mint.upgrade_authority': 'K' })], [[], []])
  t('L11: ...while a value CHANGING is still CRITICAL, a value going from null with the program present still drifts, and Core from NO_PROGRAMDATA still drifts',
    [D.detectConfigDrift({ 'mint.split_bps': 8500 }, { 'mint.split_bps': 8000 })[0]?.severity,
     D.detectConfigDrift({ 'mint.split_bps': null }, { 'mint.split_bps': 8500 })[0]?.severity,
     D.detectConfigDrift({ 'prog.core._missing': true, 'prog.core.hash': 'NO_PROGRAMDATA' }, { 'prog.core.hash': 'abc' })[0]?.severity],
    ['CRITICAL', 'CRITICAL', 'CRITICAL'])
  // L12: the lock date is bounded by MINT's immutable charter opening.
  const upg = { 'prog.seal.upgrade_authority': 'K', 'prog.mint.upgrade_authority': 'IMMUTABLE', 'prog.burn.upgrade_authority': 'IMMUTABLE', 'prog.gov.upgrade_authority': 'IMMUTABLE' }
  t('L12: box file UNSET, the charter has opened, a program still upgradeable: program_not_locked CRITICAL',
    D.detectUpgradeAuthorityAfterLock(upg, { lockDeadlineSec: D.lockDeadlineOf(null, String(T)), nowSec: T, production: true }).map(f => [f.kind, f.severity]), [['program_not_locked', 'CRITICAL']])
  t('L12: ...and a box file set FAR past the opening does not postpone it; before the opening it is quiet',
    [D.lockDeadlineOf(T + 9e6, String(T)), D.detectUpgradeAuthorityAfterLock(upg, { lockDeadlineSec: D.lockDeadlineOf(T + 9e6, String(T)), nowSec: T - 1, production: true }).length],
    [T, 0])
  t('L12: ...an EARLIER box file still wins, and with neither the deadline is unset (the A5 page)', [D.lockDeadlineOf(T - 5, String(T)), D.lockDeadlineOf(null, undefined)], [T - 5, null])
  // I3: the reader must produce the keys the stall detector and the report read.
  t('I3: revealed_total and active_count are WATCHED, so a reader that drops one is named',
    [['mint.revealed_total', 'mint.active_count'].every(k => D.WATCHED_KEYS.includes(k)),
     D.missingWatchedKeys(Object.fromEntries(D.WATCHED_KEYS.filter(k => k !== 'mint.revealed_total').map(k => [k, 'x'])))], [true, ['mint.revealed_total']])
}

console.log('── round 24: the off-chain findings, each both ways ──')
{
  const T = 1_700_000_000, H = 3600
  const detSrc = fsx.readFileSync('/opt/cbob-vaults/bank/detectors.mjs', 'utf8')
  const almSrc = fsx.readFileSync('/opt/cbob-vaults/bank/alarm.mjs', 'utf8')
  // ── H1: EVERY KIND CLASSIFIED, ONE STREAM EACH, ONE-SHOTS URGENT ──
  // Every `kind:` the alarm's sources can emit (a ternary's two names included),
  // and every kind the alarm names for its own failure notes.
  const kindsIn = src => [...new Set([...[...src.matchAll(/\bkind: ([^,\n]*)/g)].flatMap(m => [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map(x => x[1])),
    ...[...src.matchAll(/alarmLabel\('([a-z0-9_]+)'(?:,|\))/g)].map(m => m[1])])]
  // `classifyPdaTokenAccount` labels a HOLDING ('token'), not a finding.
  const NOT_FINDINGS = ['token']
  const emitted = [...new Set([...kindsIn(detSrc), ...kindsIn(almSrc)])].filter(k => !NOT_FINDINGS.includes(k))
  t('H1: every finding kind the detectors and the alarm can emit is classified once / level / info (none unlisted)',
    [emitted.length > 60, emitted.filter(k => !(k in D.ALARM_KINDS))], [true, []])
  t('H1: ...and the gate sees a new one: a planted `kind: \'brand_new_thing\'` is named',
    kindsIn("x.push({ kind: 'brand_new_thing', severity: S.HIGH })").filter(k => !(k in D.ALARM_KINDS)), ['brand_new_thing'])
  t('H1: a scoped label call also counts as an emitted kind', kindsIn("alarmLabel('reconcile_failed', RECONCILE_LABEL)"), ['reconcile_failed'])
  t('H1: ...and the table names no kind nothing emits (a stale entry reads as coverage)',
    Object.keys(D.ALARM_KINDS).filter(k => !emitted.includes(k)), [])
  t('H1: every label is cbob-vault-alarm:<kind or its short name> and at most 40 characters (longer folds into the router\'s shared stream)',
    Object.keys(D.ALARM_KINDS).map(k => D.alarmLabel(k)).filter(l => l.length > 40 || !l.startsWith('cbob-vault-alarm:')), [])
  // Every baseline-consuming detector, driven, and every kind it produced.
  const sweepDisc = [...(await import('crypto')).createHash('sha256').update('global:sweep_sol_for_swap').digest().subarray(0, 8)]
  const sweepIx = { program: D.MINT_PROGRAM_ID, dataBytes: [...sweepDisc, 5, 0, 0, 0, 0, 0, 0, 0] }
  const ledgerOf = rows => ({ cycles: rows })
  const oneShots = [
    ...D.detectConfigDrift({ 'mint.split_bps': 8500, 'prog.core.hash': 'a' }, { 'mint.split_bps': 9900, 'prog.core.hash': 'b' }),
    ...D.detectBrakeTransitions({ 'mint.sales_stopped': false, 'mint.sweep_stopped': true }, { 'mint.sales_stopped': true, 'mint.sweep_stopped': false }),
    ...D.detectVaultSetChange([V1, V2, V3], { live: [V3], burnt: [V1] }).findings,
    ...D.detectBalanceDrops({ [V3]: '9' }, { [V3]: '1' }),
    ...D.detectProgramEvents([{ type: 'REVEAL_RESCHEDULED', asset: 'A' }, { type: 'CLAIM_DEFERRED_FROZEN', asset: 'B' }, { type: 'REDEEMED_POOL_FROZEN', asset: 'C', forfeited: '7' },
      { type: 'VAULT_RESCUED', asset: 'D', host: 'E', to: 'SQ', orphan: true }]),
    ...D.detectUnledgeredSweeps([sweepIx], D.MINT_PROGRAM_ID, sweepDisc, ledgerOf([]), 'sigU', { blockTime: T - 9999, now: T }),
    ...D.detectUnledgeredSweeps([sweepIx], D.MINT_PROGRAM_ID, sweepDisc, ledgerOf([{ sweepSig: 'sigM', sweptLamports: '4' }]), 'sigM', { blockTime: T - 9999, now: T }),
    ...D.detectUnledgeredSweeps([sweepIx], D.MINT_PROGRAM_ID, sweepDisc, ledgerOf([{ sweepSig: 'sigR', sendRejected: true }]), 'sigR', { blockTime: T - 9999, now: T }),
    ...D.detectApprovals([{ program: D.TOKEN_ID, parsed: { type: 'approve', info: { owner: PDA, delegate: OTHER, source: ATA_OK } } }], pdas),
    ...D.detectPdaTokenAccounts([{ program: D.ATA_ID, parsed: { info: { wallet: PDA, account: ATA_BAD } } }], pdas, atas),
    ...D.detectBurns([{ program: D.CORE_ID, dataBytes: [12], accounts: [ASSET] }], assets, BURN_PROG),
    ...D.applyFrozenTransitions([...D.detectPoolHealth({}, { state: 'ok', amount: 1n, frozen: true }),
      ...D.detectFrozenVaultAccount({ vault: 'V', mint: D.CBBTC_MINT, isPayment: true }),
      ...D.detectRevenueAccount({ read: { state: 'ok', amount: 0n, frozen: true }, nowSec: T }).findings], []).findings,
    { kind: 'watchdog_gap', severity: 'HIGH', detail: 'x' }, { kind: 'log_unparseable', severity: 'HIGH', detail: 'x' },
  ]
  const ONE_SHOT = ['config_drift', 'brake_pulled', 'brake_released', 'vault_burned', 'vault_left_index', 'reserve_fell', 'reveal_rescheduled',
    'claim_deferred_frozen', 'pool_frozen_forfeit', 'vault_rescued_to_squads', 'unledgered_sweep', 'sweep_amount_mismatch', 'sweep_on_rejected_row', 'approve',
    'non_ata_token_account', 'bare_core_burn', 'pool_frozen', 'vault_account_frozen', 'revenue_account_frozen', 'watchdog_gap', 'log_unparseable']
  const np = D.planAlarmNotices(oneShots, { stamp: 'S1' })
  t('H1: every kind whose baseline the alarm advances after reporting is produced by the detectors driven here',
    ONE_SHOT.filter(k => !oneShots.some(f => f.kind === k)), [])
  t('H1: ...and each is ONE notice on its OWN label, ALERT_URGENT, carrying the pass time (so it is new to the router every time)',
    np.notices.filter(n => !(n.urgent && n.label === D.alarmLabel(n.kind) && /at pass S1/.test(n.text))).map(n => n.kind), [])
  t('H1: ...and is never put on the recovery list (a recovery would cancel a still-pending one-shot)', np.paged, [])
  t('H1: ...and a table that called config_drift level would send it WITHOUT urgent (the arm can fail)',
    D.planAlarmNotices(oneShots, { kinds: { ...D.ALARM_KINDS, config_drift: 'level' } }).notices.find(n => n.kind === 'config_drift')?.urgent, false)
  const lv = [{ kind: 'pool_insolvent', severity: 'CRITICAL', detail: 'P1' }, { kind: 'revenue_unsplit', severity: 'HIGH', detail: 'R1' },
    { kind: 'revenue_unsplit', severity: 'HIGH', detail: 'R2', signature: 'sigX' }, { kind: 'sales_stopped', severity: 'INFO', detail: 'I' }]
  const nl = D.planAlarmNotices(lv, { stamp: 'S2' })
  t('H1: findings group ONE notice per kind, with the FULL detail list (it sent crit[0] only), INFO never pages',
    nl.notices.map(n => [n.label, n.urgent, n.text.includes('R1') && n.text.includes('R2') && n.text.includes('sigX') || n.kind !== 'revenue_unsplit']),
    [['cbob-vault-alarm:pool_insolvent', false, true], ['cbob-vault-alarm:revenue_unsplit', false, true]])
  t('H1: ...a level kind is not urgent and is remembered as paged', nl.paged, ['pool_insolvent', 'revenue_unsplit'])
  const rc = D.planAlarmNotices([lv[0]], { prevPaged: ['pool_insolvent', 'revenue_unsplit', 'config_drift', 'run_failed'], stamp: 'S3' })
  t('H1: the first FULL pass after a level kind paged and found none sends that kind a RECOVERY (and the dead run\'s), never a one-shot\'s, never a kind still present',
    rc.notices.filter(n => n.recovery).map(n => [n.label, /RECOVERED/.test(n.text)]),
    [['cbob-vault-alarm:revenue_unsplit', true], ['cbob-vault-alarm:run_failed', true]])
  t('H1: ...and a pass that returned early (not a full pass) sends no recovery at all',
    D.planAlarmNotices([], { prevPaged: ['revenue_unsplit'], fullPass: false }).notices, [])
  t('H1: a level text the router would read as RECOVERY ("cannot be resolved") is defanged; urgent text is left alone',
    [D.defangForRouter('cannot be resolved; all clear; back to $5'), D.planAlarmNotices([{ kind: 'scan_gap', severity: 'HIGH', detail: 'resolved' }]).notices[0].text.includes('resolved'),
     D.planAlarmNotices([{ kind: 'config_drift', severity: 'HIGH', detail: 'resolved' }]).notices[0].text.includes('resolved')],
    ['cannot be resolv-ed; all cle-ar; back to -$5', false, true])
  t('H1: a kind with thousands of findings stays one deliverable argument (the kernel caps one at 128 KiB) and says how many it left out',
    (() => { const n = D.planAlarmNotices(Array.from({ length: 3000 }, (_, i) => ({ kind: 'reserve_fell', severity: 'HIGH', detail: 'x'.repeat(100) + i }))).notices[0]
      return [n.text.length < 61_000, /more of this kind/.test(n.text)] })(), [true, true])
  t('H1: alarm.mjs sends per notice from planAlarmNotices, and no bare cbob-vault-alarm label survives in it or the installer',
    [/D\.planAlarmNotices\(findings/.test(almSrc), /\[[^\]]*'cbob-vault-alarm'\]/.test(almSrc),
     /notify-gary-sms\.sh "[^"]*" cbob-vault-alarm \$TAG/.test(fsx.readFileSync('/opt/cbob-vaults/scripts/cron-install.sh', 'utf8'))], [true, false, false])
  t('H1: ...and a level notice never inherits ALERT_URGENT from the environment', /delete env\.ALERT_URGENT/.test(almSrc), true)

  // ── H1 AGAINST THE ROUTER ITSELF, in a throwaway state dir, never flushed ──
  // /opt/scripts/alert-router.py is what the notify wrapper hands every alert to;
  // these assertions are about ITS behaviour, so they run IT (emit only: nothing
  // is ever sent). A missing router fails them, which is the truth: the alarm
  // cannot deliver without it.
  const routerRun = ops => {
    const py = String.raw`
import json, os, sys, io, shutil, tempfile, contextlib, importlib.util
d = tempfile.mkdtemp(prefix='cbob-selftest-router-')
os.environ['ALERT_STATE_DIR'] = d; os.environ['ALERT_LOG'] = os.path.join(d, 'alerts.log'); os.environ.pop('ALERT_URGENT', None)
try:
    spec = importlib.util.spec_from_file_location('router', '/opt/scripts/alert-router.py')
    R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
    out = []
    for op in json.load(sys.stdin):
        if op.get('urgent'): os.environ['ALERT_URGENT'] = '1'
        else: os.environ.pop('ALERT_URGENT', None)
        k = op['op']
        if k == 'pattern': out.append(R.RECOVERY.pattern)
        elif k == 'key': out.append(R.stream_key(op['label'], op.get('text', '')))
        elif k == 'classify': out.append(R.classify(R.strip_dashes(op['text']), op['label']))
        elif k == 'open':
            o = R.load(R.OPEN, {}); o[R.stream_key(op['label'], op['text'])] = {'label': op['label'], 'text': op['text'],
                'first': R.now() - 3600, 'notified': R.now() - 3600, 'n': 1}
            R.save(R.OPEN, o); out.append('opened')
        elif k == 'emit':
            b = io.StringIO()
            with contextlib.redirect_stdout(b): R.emit(op['text'], op['label'])
            out.append(b.getvalue().strip().split(' ')[0])
    print(json.dumps(out))
finally:
    os.environ.pop('ALERT_URGENT', None); shutil.rmtree(d, ignore_errors=True)
`
    try { return JSON.parse(CP.execFileSync('python3', ['-c', py], { input: JSON.stringify(ops), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })) }
    catch (e) { return [`ROUTER UNAVAILABLE: ${String(e.message).slice(0, 120)}`] }
  }
  // ROUND 42 (C08): the crank's two fee-warning labels are DERIVED from its own
  // template (not typed here), so a renamed or merged label cannot hide.
  const feeTpl = /`\$\{CRANK_LABEL\}:fee_\$\{fee\.warnKind === 'floor' \? '(\w+)' : '(\w+)'\}`/.exec(fsx.readFileSync(new URL('./crank.mjs', import.meta.url), 'utf8'))
  const feeLabels = feeTpl ? [`${CR.CRANK_LABEL}:fee_${feeTpl[1]}`, `${CR.CRANK_LABEL}:fee_${feeTpl[2]}`] : ['FEE LABEL TEMPLATE MISSING']
  const labels = [...Object.keys(D.ALARM_KINDS).map(k => D.alarmLabel(k)), 'cbob-vault-alarm:deadman', 'cbob-vault-crank:full',
    'cbob-vault-crank:reveal', ...feeLabels]
  t('R42 C08: the crank\'s fee warnings use two labels, fee_floor and fee_ceiling, read from crank.mjs itself', feeLabels, ['cbob-vault-crank:fee_floor', 'cbob-vault-crank:fee_ceiling'])
  const keys = routerRun(labels.map(label => ({ op: 'key', label })))
  t('H1 router: every label is its OWN stream under the router\'s stream_key (distinct kinds really are distinct streams)',
    [keys.length === labels.length, new Set(keys).size === labels.length, keys.every(k => !k.startsWith('alert'))], [true, true, true])
  t('H1 router: the mirrored RECOVERY pattern IS the router\'s (a new recovery word there could swallow a level alert here)',
    routerRun([{ op: 'pattern' }])[0], D.ROUTER_RECOVERY_SRC)
  // THE MEASURED H1 SEQUENCE, against the router, both ways.
  const seq = routerRun([
    { op: 'open', label: D.alarmLabel('pool_insolvent'), text: 'CBOB VAULTS CRITICAL pool_insolvent: 1 finding(s)\n- P0' },
    { op: 'open', label: D.alarmLabel('config_drift'), text: 'CBOB VAULTS CRITICAL config_drift: 1 finding(s) at pass S0\n- old' },
    // a NEW kind while another kind's stream is open: its own stream, queued
    { op: 'emit', label: D.alarmLabel('brake_pulled'), text: (np.notices.find(n => n.kind === 'brake_pulled')?.text ?? 'MISSING'), urgent: true },
    // a one-shot on its own already-OPEN stream with new text: breaks through
    { op: 'emit', label: D.alarmLabel('config_drift'), text: (np.notices.find(n => n.kind === 'config_drift')?.text ?? 'MISSING'), urgent: true },
    // the same text again: quiet
    { op: 'emit', label: D.alarmLabel('config_drift'), text: (np.notices.find(n => n.kind === 'config_drift')?.text ?? 'MISSING'), urgent: true },
    // a standing level condition re-asserted: suppressed
    { op: 'emit', label: D.alarmLabel('pool_insolvent'), text: nl.notices[0].text },
    // its recovery closes it
    { op: 'emit', label: D.alarmLabel('pool_insolvent'), text: D.planAlarmNotices([], { prevPaged: ['pool_insolvent'], stamp: 'S4' }).notices[0]?.text ?? 'MISSING' },
    // THE OLD SHAPE, measured: one shared label, a non-urgent second kind on an open stream is swallowed
    { op: 'open', label: 'cbob-vault-alarm', text: 'CBOB VAULTS: 1 critical, 0 high — pool frozen' },
    { op: 'emit', label: 'cbob-vault-alarm', text: 'CBOB VAULTS: 1 critical, 0 high — mint.split_bps: 8500 -> 9900' },
  ])
  t('H1 router: open pool_insolvent + config_drift; a new kind QUEUES, a new one-shot QUEUES through its open stream, the same one again joins it (PENDING), not a second email',
    seq.slice(2, 5), ['QUEUED', 'QUEUED', 'PENDING'])
  t('H1 router: ...a standing level kind re-asserted is SUPPRESSED, and its RECOVERY is QUEUED as an all-clear',
    seq.slice(5, 7), ['SUPPRESSED', 'QUEUED'])
  t('H1 router: ...and the OLD single-label shape is measured swallowing the second finding (why every kind has its own stream)',
    seq.slice(7, 9), ['opened', 'SUPPRESSED'])
  const revenueOpen = D.revenueNotices({ stage: 'recovery', error: 'open cycle' })[0]
  const revenueMarket = D.revenueNotices({ stage: 'market', error: 'neither venue usable' })[0]
  const revenueClear = D.revenueNotices({ previous: ['recovery'], passed: ['recovery'] })[0]
  t('R26 revenue router: an open-cycle failure cannot suppress a later market failure',
    routerRun([{ op: 'open', ...revenueOpen }, { op: 'emit', ...revenueMarket }]), ['opened', 'QUEUED'])
  t('R26 revenue router: a completed step produces a matching all-clear',
    routerRun([{ op: 'open', ...revenueOpen }, { op: 'emit', ...revenueClear }]), ['opened', 'QUEUED'])
  // ROUND 44 (V44o-5): a rehearsal crank or revenue run never shares a production
  // stream. Inside a tree carrying REHEARSAL-RECORD.txt every notice moves to its
  // own <stream>-rehearsal label family and says REHEARSAL; outside, unchanged.
  // And every notify site in both jobs goes through the wrapper.
  {
    const crankFail = CR.crankNotices({ lane: 'full', failures: ['x'] }).notices[0]
    const reh = [D.rehearsalNotice(revenueOpen, true), D.rehearsalNotice(crankFail, true), D.rehearsalNotice({ text: 'CBOB CRANK FAILED TO RUN: e', label: 'cbob-vault-crank:full' }, true)]
    t('V44o-5: in a rehearsal tree the crank and revenue notices take their own -rehearsal streams and say REHEARSAL; in production they are unchanged',
      [reh.map(n => n.label), reh.map(n => /^CBOB (crank|CRANK|REVENUE) \(REHEARSAL\)/.test(n.text)), D.rehearsalNotice(revenueOpen, false) === revenueOpen, D.REHEARSAL_MARKER],
      [['cbob-revenue-rehearsal:recovery', 'cbob-vault-crank-rehearsal:full', 'cbob-vault-crank-rehearsal:full'], [true, true, true], true, '/opt/cbob-vaults/REHEARSAL-RECORD.txt'])
    const sites = f => { const src = fsx.readFileSync(new URL(f, import.meta.url), 'utf8')
      return [(src.match(/execFileSync\((NOTIFY|notify|'\/opt\/scripts\/notify-gary-sms\.sh'),/g) || []).length, (src.match(/rehearsalNotice\(/g) || []).length - 0] }
    t('V44o-5: every notify call in crank.mjs (3) and revenue.mjs (1) passes through rehearsalNotice',
      [sites('./crank.mjs'), sites('./revenue.mjs')], [[3, 3], [1, 1]])
  }
  // EVERY TEXT THIS FILE PRODUCES, classified by the router: an alert is never
  // read as a recovery, a status update or a customer's box; a recovery is.
  const sampleFindings = [...oneShots, ...lv,
    ...D.detectStandingRisks({ 'mint.split_bps': 1, 'mint.pending_swap_operator': OTHER, 'mint.pending_guardian_set': true, 'mint.max_sweep_lamports': '0',
      'mint.sweep_cooldown_secs': '1', 'mint.monthly_secs': '150' }, { production: true }),
    { kind: 'scan_cursor_unresolvable', severity: 'CRITICAL', detail: 'the scan bookmark for X (Y) is not found by the cluster, and it would be resolved and cleared by hand' }]
  const texts = D.planAlarmNotices(sampleFindings, { stamp: 'S5' }).notices
  const cls = routerRun([...texts.map(n => ({ op: 'classify', label: n.label, text: n.text, urgent: n.urgent })),
    ...[CR.crankNotices({ lane: 'full', failures: ['claim batch 1 (14): custom program error 0x1'] }).notices[0]?.text ?? 'MISSING',
      CR.crankNotices({ lane: 'full', prevFailing: true }).notices[0]?.text ?? 'MISSING'].map(text => ({ op: 'classify', label: 'cbob-vault-crank:full', text })),
    { op: 'classify', label: D.alarmLabel('revenue_unsplit'), text: rc.notices.find(n => n.recovery)?.text ?? 'MISSING' }])
  t('H1 router: every alarm notice is classified URGENT (one-shot) or ALERT (level), never RECOVERY, ROUTINE or IGNORED',
    texts.map((n, i) => [n.kind, cls[i]]).filter(([k, c]) => c !== (D.isOneShotKind(k) ? 'URGENT' : 'ALERT')), [])
  t('H1 router: the crank\'s failure notice is an ALERT, its recovery and the alarm\'s recovery are RECOVERY',
    cls.slice(texts.length), ['ALERT', 'RECOVERY', 'RECOVERY'])

  // ── L4: the crank's posture and health ──
  const TAGC = '#cbob-vault-cron'
  const armedLine = `37 * * * * cd /opt/cbob-vaults && /usr/bin/node bank/crank.mjs --live >> x 2>&1 ${TAGC} crank`
  t('L4a: a crontab that FAILS to read is UNREADABLE, "no crontab for ubuntu" is a real answer (dry), an armed line is armed',
    [D.crankPosture({ error: { status: 1, stderr: 'crontab: cannot open /var/spool: Permission denied' } }), D.crankPosture({ error: { status: 1, stderr: 'no crontab for ubuntu' } }),
     D.crankPosture({ text: armedLine }), D.crankPosture(null)], ['unreadable', 'dry', 'armed', 'unreadable'])
  t('L4a: unreadable, armed before: HIGH crank_posture_unreadable, the armed-since clock KEPT, and the silence check still runs',
    (() => { const p = D.detectCrankPosture({ posture: 'unreadable', prevArmedSince: T - 9 * H, nowSec: T })
      return [p.findings.map(f => [f.kind, f.severity]), p.armedSince, p.live,
        D.detectCrankSilent({ stampSec: T - 5 * H, live: p.live, armedSinceSec: p.armedSince, nowSec: T }).length] })(),
    [[['crank_posture_unreadable', 'HIGH']], T - 9 * H, true, 1])
  t('L4a: ...a dry crontab is quiet and clears the clock; an armed one starts it',
    [D.detectCrankPosture({ posture: 'dry', prevArmedSince: T - H, nowSec: T }), D.detectCrankPosture({ posture: 'armed', nowSec: T }).armedSince],
    [{ live: false, armedSince: null, findings: [] }, T])
  t('L4b: the heartbeat\'s failures and problems are READ (it parsed {failures:150} to a bare fresh stamp)',
    D.readCrankBeat(`{"atSec": ${T}, "failures": 150, "problems": ["vault A is owed 9 sats but X"]}`), { atSec: T, failures: 150, problems: ['vault A is owed 9 sats but X'] })
  {
    const beats = (n, o = {}) => Array.from({ length: n }, (_, i) => ({ atSec: T + i * H, failures: 0, problems: [], ...o }))
    const run = (list, k) => list.reduce((acc, b) => D.detectCrankHealth({ beat: b, prev: acc.next, k }), { next: null })
    t('L4b: three live passes in a row with failed actions page crank_failing HIGH; two do not; a clean pass clears it',
      [run(beats(3, { failures: 2 })).findings.map(f => [f.kind, f.severity]), run(beats(2, { failures: 2 })).findings,
       run([...beats(3, { failures: 2 }), { atSec: T + 9 * H, failures: 0, problems: [] }]).findings], [[['crank_failing', 'HIGH']], [], []])
    t('L4c: one PROBLEM in three passes in a row pages crank_problem (its numbers may move); a heartbeat read twice counts once',
      [run(beats(3).map((b, i) => ({ ...b, problems: [`vault A is owed ${10 + i} sats but its recorded cbBTC account X is absent`] }))).findings.map(f => f.kind),
       run([...beats(2, { problems: ['p'] }), beats(2, { problems: ['p'] })[1]]).findings], [['crank_problem'], []])
  }
  // ── L5: drift across a one-pass failed read ──
  {
    const k = 'burn.redeem_window_secs'
    const p0 = { [k]: 3600, 'burn.version': 4 }, blip = { 'burn._missing': true }, back = { [k]: 60, 'burn.version': 4 }
    t('L5: old -> MISSING -> NEW: the blip pages, and the change behind it is compared against the last real value (CRITICAL)',
      [D.detectConfigDrift(p0, blip).find(f => f.detail.startsWith(k))?.severity, D.detectConfigDrift(D.carryConfigBaseline(p0, blip), back).map(f => f.severity)],
      ['CRITICAL', ['CRITICAL']])
    t('L5: ...old -> missing -> OLD is quiet, and never-present -> present is still not drift (L11 holds)',
      [D.detectConfigDrift(D.carryConfigBaseline(p0, blip), p0), D.detectConfigDrift(D.carryConfigBaseline({ 'prog.mint._missing': true }, { 'prog.mint._missing': true }), { 'prog.mint.hash': 'h' })],
      [[], []])
    t('L5: ...the same for program bytes: hash -> unreadable -> NEW hash is CRITICAL',
      D.detectConfigDrift(D.carryConfigBaseline({ 'prog.mint.hash': 'a' }, { 'prog.mint._missing': true }), { 'prog.mint.hash': 'b' }).map(f => f.severity), ['CRITICAL'])
    t('L5: alarm.mjs stores the carried baseline', /config: D\.carryConfigBaseline\(prev\?\.config, cfg\)/.test(almSrc), true)
  }
  // ── L7: one reserve account, read ──
  t('L7: a null, foreign or malformed element CARRIES the last value and is reported; a never-funded absent account is 0, quietly',
    [D.judgeReserveRead('500', { state: 'absent', amount: 0n }), D.judgeReserveRead('500', { state: 'foreign', amount: 0n }),
     D.judgeReserveRead(undefined, { state: 'absent', amount: 0n }), D.judgeReserveRead('0', { state: 'absent', amount: 0n }),
     D.judgeReserveRead('500', { state: 'ok', amount: 7n })],
    [{ value: '500', finding: { state: 'absent', carried: '500' } }, { value: '500', finding: { state: 'foreign', carried: '500' } },
     { value: '0', finding: null }, { value: '0', finding: null }, { value: '7', finding: null }])
  t('L7: ...so a carried value raises no false reserve_fell', D.detectBalanceDrops({ V: '500' }, { V: D.judgeReserveRead('500', { state: 'absent' }).value }), [])
  t('L7: alarm.mjs judges each element of a batched read', /D\.judgeReserveRead\(prev\?\.balances\?\.\[l\.key\], r\)/.test(almSrc), true)
  // ── L8: a three-reserve redemption correlates all three ──
  {
    const G = '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk', F = 'Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump'
    const drops = D.detectBalanceDrops({ [V1]: '100', [`${V1}:${G}`]: '5', [`${V1}:${F}`]: '7' }, { [V1]: '0', [`${V1}:${G}`]: '0', [`${V1}:${F}`]: '0' })
    t('L8: a redeemed vault\'s cbBTC, $GARY and $GIRAFFISH drops are ALL INFO (two of the three stayed HIGH)',
      D.correlateBurns([...drops, { kind: 'burn_via_program', severity: 'INFO', asset: V1, detail: 'x' }]).filter(f => f.kind === 'reserve_fell').map(f => f.severity), ['INFO', 'INFO', 'INFO'])
    t('L8: ...the same drops with no redemption stay HIGH, each naming the vault and the mint',
      D.correlateBurns(drops).map(f => [f.severity, f.asset, f.mint ?? null]), [['HIGH', V1, null], ['HIGH', V1, G], ['HIGH', V1, F]])
  }
  // ── L9: the index race ──
  t('L9: a sale landing during the DAS walk (index 4, chain 3 then 4) is QUIET; the same with no re-read, or a re-read that still disagrees, is CRITICAL',
    [D.detectIndexShortfall(3n, ['a', 'b', 'c', 'd'], [], { mintedAfter: 4n }), D.detectIndexShortfall(3n, ['a', 'b', 'c', 'd'], []).map(f => f.severity),
     D.detectIndexShortfall(3n, ['a', 'b', 'c', 'd', 'e'], [], { mintedAfter: 4n }).map(f => f.severity), D.detectIndexShortfall(5n, ['a'], [], { mintedAfter: 5n }).map(f => f.severity)],
    [[], ['CRITICAL'], ['CRITICAL'], ['CRITICAL']])
  t('L9: alarm.mjs re-reads minted_total after the walk at BOTH call sites', (almSrc.match(/mintedAfter: await readMintedTotal\(\)/g) || []).length, 2)
  // ── L10 / L11: the ledger's writer, held to the chain ──
  {
    const iso = s => new Date(s * 1000).toISOString()
    const ret = { startedAt: iso(T - 2 * H), sweepSig: 'sw1', sweptLamports: '5', quotedSats: '5000', returnedSats: '5000', returnedAt: iso(T - H) }
    t('L10a: a REAL sweep filed under a REFUSED row is CRITICAL (it closed the cycle and quieted all three detectors)',
      D.detectUnledgeredSweeps([sweepIx], D.MINT_PROGRAM_ID, sweepDisc, ledgerOf([{ sweepSig: 'sigR', sendRejected: true }]), 'sigR', { blockTime: T - 9999, now: T }).map(f => f.kind), ['sweep_on_rejected_row'])
    t('L10a: ...a refused row carrying a sweep signature or amount is CRITICAL in the ledger itself; an honest refused row is quiet',
      [D.detectUnreconciledRevenue(ledgerOf([{ ...ret, sendRejected: true }]), { now: T * 1000 }).map(f => f.kind),
       D.detectUnreconciledRevenue(ledgerOf([{ startedAt: iso(T - 2 * H), intendedLamports: '5', sendRejected: true }]), { now: T * 1000 })], [['rejected_row_has_sweep'], []])
    t('L10a: ...and a deferred sweep later filed under a refused row is CRITICAL too',
      D.detectDeferredSweeps([{ sig: 'sigR', blockTime: T - 9999, amount: '5' }], ledgerOf([{ sweepSig: 'sigR', sendRejected: true }]), { now: T }).findings.map(f => f.kind), ['sweep_on_rejected_row'])
    const sc = (splits, cyc = ret) => D.detectSplitClaims(splits, ledgerOf([{ ...cyc, splitSig: 'sp' }]), { now: T * 1000 }).map(f => f.kind)
    t('L10b: an explicit splitSig naming a 1-sat split from BEFORE the return is CRITICAL (the same data as splitByOther already was)',
      [sc([{ sig: 'sp', blockTime: T - 2 * H, total: '1' }]), D.detectSplitClaims([{ sig: 'other', blockTime: T - 2 * H, total: '1' }],
        ledgerOf([{ ...ret, splitByOther: true }]), { now: T * 1000 }).map(f => f.kind)], [['split_claim_unanchored'], ['split_by_other_unanchored']])
    t('L10b: ...the honest split after the return, as large as it, is quiet; so is ours after a stranger\'s split that took the return',
      [sc([{ sig: 'sp', blockTime: T - H + 30, total: '5000' }]), sc([{ sig: 'x', blockTime: T - H + 10, total: '5000' }, { sig: 'sp', blockTime: T - H + 20, total: '3' }])], [[], []])
    const fake = { startedAt: iso(T - 9 * H), sweepSig: 'swF', sweptLamports: '5', returnedSats: '0', splitSig: 'fabricated' }
    const pad = Array.from({ length: 250 }, () => ({ startedAt: iso(T - 8 * H) }))
    t('L10c: 250 EMPTY rows after a fabricated splitSig no longer push it past the window',
      D.detectSplitClaims([], ledgerOf([fake, ...pad]), { now: T * 1000 }).map(f => f.kind), ['split_not_on_chain'])
    const honest = Array.from({ length: 250 }, (_, i) => ({ startedAt: iso(T - 8 * H), sweptLamports: '1', splitSig: `h${i}` }))
    t('L10c: ...and a cycle whose SWEEP the scan saw is verified wherever it sits; without that chain evidence it is past the window',
      [D.detectSplitClaims(honest.map(c => c.splitSig), ledgerOf([fake, ...honest]), { now: T * 1000, sweeps: [{ sig: 'swF', blockTime: T - 9 * H }] }).map(f => f.kind),
       D.detectSplitClaims(honest.map(c => c.splitSig), ledgerOf([fake, ...honest]), { now: T * 1000 }).map(f => f.kind)], [['split_not_on_chain'], []])
    t('L10d: a cycle stamped in the FUTURE is not graced: swept SOL with no return pages (it was silent for as long as its writer liked)',
      [D.detectUnreconciledRevenue(ledgerOf([{ startedAt: '2099-01-01T00:00:00Z', sweptLamports: '5' }]), { now: T * 1000 }).map(f => f.kind),
       D.detectUnreconciledRevenue(ledgerOf([{ startedAt: '2099-01-01T00:00:00Z', sweepSig: 's9', sweptLamports: '5' }]), { now: T * 1000, sweeps: [{ sig: 's9', blockTime: T - 3 * H }] }).map(f => f.kind)],
      [['unreconciled_swap'], ['unreconciled_swap']])
    t('L10d: ...while an honest cycle inside its hour of grace is quiet, and its sweep\'s block time is the clock',
      [D.detectUnreconciledRevenue(ledgerOf([{ startedAt: iso(T - 600), sweptLamports: '5' }]), { now: T * 1000 }),
       D.cycleStartMs({ startedAt: iso(T + 99), sweepSig: 's' }, [{ sig: 's', blockTime: T - 60 }], T * 1000)], [[], (T - 60) * 1000])
    t('L11: a split at or after the return, at least as large and claimed by no other cycle, CLOSES the cycle; a small, early or claimed one does not',
      [D.closesCycle(ret, [{ sig: 'a', blockTime: T - H + 300, total: '6000' }])?.sig, D.closesCycle(ret, [{ sig: 'a', blockTime: T - H + 300, total: '100' }]),
       D.closesCycle(ret, [{ sig: 'a', blockTime: T - 2 * H, total: '9000' }]), D.closesCycle(ret, [{ sig: 'a', blockTime: T - H + 300, total: '6000' }], { exclude: new Set(['a']) })],
      ['a', null, null, null])
    t('L11: a returned-but-unrecorded split closes cycle_unsplit in the alarm; with no such split it is still HIGH',
      [D.detectUnreconciledRevenue(ledgerOf([ret]), { now: T * 1000, splits: [{ sig: 'a', blockTime: T - H + 300, total: '6000' }] }).map(f => f.kind),
       D.detectUnreconciledRevenue(ledgerOf([ret]), { now: T * 1000, splits: [] }).map(f => f.kind)], [[], ['cycle_unsplit']])
    const revSrc = fsx.readFileSync('/opt/cbob-vaults/bank/revenue.mjs', 'utf8')
    t('L11: revenue.mjs\'s recovery closes on the SAME predicate, read off the chain, before the provably-empty proof',
      [/closesCycle\(c, splits, \{ exclude: claimed \}\)/.test(revSrc), revSrc.indexOf('closesCycle(c, splits') < revSrc.indexOf('isProvablyEmpty(await conn.getAccountInfo(revAta0')], [true, true])
    t('L10/L11: alarm.mjs feeds both ledger detectors the chain\'s sweeps and splits',
      [/detectUnreconciledRevenue\(led, \{ splits: allSplits, sweeps: allSweeps, now: wallSec \* 1000, chainNow: nowSec \* 1000 \}\)/.test(almSrc), /detectSplitClaims\(allSplits, led, \{ sweeps: allSweeps, now: wallSec \* 1000, chainNow: nowSec \* 1000 \}\)/.test(almSrc)], [true, true])
  }
  // ── I3: a holder's forfeit ──
  {
    const inv = (p, n) => `Program ${p} invoke [${n}]`, ok = p => `Program ${p} success`
    const ev = D.parseCbobLogs([inv(D.BURN_PROGRAM_ID, 1), inv(D.MINT_PROGRAM_ID, 2), 'Program log: CBOB_REDEEMED_POOL_FROZEN asset=AAA forfeited_sats=42', ok(D.MINT_PROGRAM_ID),
      'Program log: CBOB_REDEEMED AAA', ok(D.BURN_PROGRAM_ID)]).events
    t('I3: CBOB_REDEEMED_POOL_FROZEN is read (MINT\'s, under BURN) and pages HIGH, urgent, naming the forfeited sats',
      [ev.map(e => e.type), D.detectProgramEvents(ev).filter(f => f.urgent).map(f => [f.kind, f.severity, /42 sats/.test(f.detail)])],
      [['REDEEMED_POOL_FROZEN', 'REDEEMED'], [['pool_frozen_forfeit', 'HIGH', true]]])
    t('I3: ...and printed by any other program it is ignored',
      D.parseCbobLogs([inv(OTHER, 1), 'Program log: CBOB_REDEEMED_POOL_FROZEN asset=AAA forfeited_sats=42', ok(OTHER)]).events, [])
  }
  // ── I5: a freeze is news once ──
  {
    const fz = [...D.detectPoolHealth({}, { state: 'ok', amount: 1n, frozen: true }), ...D.detectFrozenVaultAccount({ vault: 'V', mint: 'M1', isPayment: false })]
    const first = D.applyFrozenTransitions(fz, [])
    const again = D.applyFrozenTransitions(fz, first.frozen)
    t('I5: a NEW freeze pages at full severity, urgent; the SAME freeze next pass is INFO (it could never be acked and held the stream open)',
      [first.findings.map(f => [f.kind, f.severity, f.urgent]), again.findings.map(f => f.severity)],
      [[['pool_frozen', 'CRITICAL', true], ['vault_account_frozen', 'HIGH', true]], ['INFO', 'INFO']])
    t('I5: ...a second account freezing while the first stands still pages; a thaw drops it from the set',
      [D.applyFrozenTransitions([...fz, ...D.detectFrozenVaultAccount({ vault: 'V', mint: 'M2', isPayment: false })], first.frozen).findings.filter(f => f.severity !== 'INFO').length,
       D.applyFrozenTransitions([], first.frozen).frozen], [1, []])
    t('I5: alarm.mjs applies it over the finished list and keeps the set as a baseline', /D\.applyFrozenTransitions\(findings, prev\?\.frozen/.test(almSrc), true)
  }
  // ── D5: the rehearsal seam ──
  t('D5: production unless CBOB_ALARM_REHEARSAL is exactly "1" (a typo is production, never a quiet rehearsal)',
    [D.alarmProduction({}), D.alarmProduction({ CBOB_ALARM_REHEARSAL: '1' }), D.alarmProduction({ CBOB_ALARM_REHEARSAL: 'yes' }), D.alarmProduction({ CBOB_ALARM_REHEARSAL: '0' })],
    [true, false, true, true])
  t('D5: alarm.mjs passes that switch to both production checks and says REHEARSAL in the report',
    [(almSrc.match(/production: PRODUCTION/g) || []).length, /production: true/.test(almSrc), /REHEARSAL: CBOB_ALARM_REHEARSAL=1/.test(almSrc)], [2, false, true])
}

console.log('── round 24 (A3): the sweep helper is locked and watched like the other four ──')
{
  const imm = { 'prog.seal.upgrade_authority': 'IMMUTABLE', 'prog.mint.upgrade_authority': 'IMMUTABLE', 'prog.burn.upgrade_authority': 'IMMUTABLE', 'prog.gov.upgrade_authority': 'IMMUTABLE' }
  t('A3: the SWEEP helper still upgradeable past the lock deadline pages CRITICAL (and quiet once immutable)',
    [D.detectUpgradeAuthorityAfterLock({ ...imm, 'prog.sweep.upgrade_authority': 'K' }, { lockDeadlineSec: 100, nowSec: 200, production: true }).map(f => f.severity),
     D.detectUpgradeAuthorityAfterLock({ ...imm, 'prog.sweep.upgrade_authority': 'IMMUTABLE' }, { lockDeadlineSec: 100, nowSec: 200, production: true }).length], [['CRITICAL'], 0])
  t('A3: ...and a change to its deployed bytes is CRITICAL drift', D.detectConfigDrift({ 'prog.sweep.hash': 'a' }, { 'prog.sweep.hash': 'b' })[0]?.severity, 'CRITICAL')
}

console.log('── round 24 (M1): the royalty swap, built here against pinned pools ──')
{
  const { PublicKey: PK } = await import('@solana/web3.js')
  const NOW = 1_800_000_000
  // Real numbers off mainnet, 2026-10-05 (expo -8 both).
  const sol = { price: 12045355552n, conf: 1571698n, expo: -8, publishTime: NOW - 54 }
  const btc = { price: 8592910904675n, conf: 1886936280n, expo: -8, publishTime: NOW - 54 }
  const f = SW.oracleFloor({ lamportsIn: 2_000_000_000n, sol, btc, nowSec: NOW })
  const flo = 2 * 120.45355552 / 85929.10904675 * 1e8
  t('M1: the oracle expects what the arithmetic says (2 SOL, within a sat of the float)', Math.abs(Number(f.expectedSats) - flo) < 1, true)
  {
    // ROUND 30 (L3), both ways: dust that buys no whole sat is "nothing worth
    // sweeping", not a market failure; the minimum itself buys sats and sweeps;
    // the caps still bind; and revenue.mjs uses this one function.
    const thr = f => { try { f(); return 'ok' } catch (e) { return e.message } }
    const rev = fsx.readFileSync(new URL('./revenue.mjs', import.meta.url), 'utf8')
    const dustThrows = /buys no whole sat/.test(thr(() => SW.oracleFloor({ lamportsIn: 10_000n, sol, btc, nowSec: NOW })))
    const a = x => SW.sweepAmount({ balance: 1_000_000n + x, reserve: 1_000_000n, maxPerCycle: 50_000_000_000n, chainCap: 1_000_000_000n })
    t('R30 L3: dust above the reserve is nothing to sweep, the minimum sweeps and prices, the caps bind, and revenue.mjs uses it',
      [dustThrows, a(10_000n), a(SW.MIN_SWEEP_LAMPORTS), thr(() => SW.oracleFloor({ lamportsIn: SW.MIN_SWEEP_LAMPORTS, sol, btc, nowSec: NOW })), a(5_000_000_000n), /SW\.sweepAmount\(/.test(rev)],
      [true, 0n, SW.MIN_SWEEP_LAMPORTS, 'ok', 1_000_000_000n, true])
  }
  {
    // ROUND 31 (L1, review): the coverage gate credits a pass only for the exact
    // "# Round N, FOCUS pass: [NOT ]CLEAN; QUORUM MET" headline. Its own cases
    // (made-up wordings, wrong round, wrong focus, a failed quorum) run here.
    const { execFileSync } = await import('node:child_process')
    let out = ''; try { out = execFileSync('bash', ['/opt/cbob-vaults/scripts/audit-coverage.sh', '--selftest'], { encoding: 'utf8' }) } catch (e) { out = String(e.stdout || e.message) }
    t('R31 L1: the coverage gate\'s quorum-headline check passes its own both-ways cases', out.trim(), '19/19 gate assertions as predicted')
  }
  {
    // ROUND 45 (V45o-5): `--selftest` is parsed before the freeze check, so a
    // tracked file not yet bundled no longer turns this selftest red; the freeze
    // check itself still fails closed on it. A throwaway git fixture holding one
    // such file, and the tree's own coverage script.
    const { execFileSync } = await import('node:child_process'), os = await import('node:os'), path = await import('node:path')
    const fx = fsx.mkdtempSync(path.join(os.tmpdir(), 'cbob-cov45-'))
    try {
      fsx.mkdirSync(path.join(fx, 'scripts')); fsx.mkdirSync(path.join(fx, 'bank'))
      fsx.copyFileSync(new URL('../scripts/audit-coverage.sh', import.meta.url), path.join(fx, 'scripts/audit-coverage.sh'))
      fsx.writeFileSync(path.join(fx, 'bank/new-helper.mjs'), 'export const x = 1\n')
      fsx.writeFileSync(path.join(fx, 'scripts/audit1.ts'), "const TARGETS = [\n  ['bank/old-helper.mjs', 'a file an earlier round did send'],\n]\n")
      execFileSync('git', ['init', '-q'], { cwd: fx }); execFileSync('git', ['add', 'bank/new-helper.mjs'], { cwd: fx })
      const run = args => { try { return [0, execFileSync('bash', [path.join(fx, 'scripts/audit-coverage.sh'), ...args], { encoding: 'utf8', cwd: fx })] } catch (e) { return [e.status, String(e.stdout || '')] } }
      const [stRc, stOut] = run(['--selftest']), [frRc, frOut] = run([])
      t('R45 V45o-5: with one tracked file never bundled, the coverage gate\'s --selftest still runs its own cases (19/19) and the freeze check still fails closed naming it',
        [stRc, stOut.trim(), frRc, /NEVER SENT TO ANY AUDITOR[\s\S]*bank\/new-helper\.mjs/.test(frOut)], [0, '19/19 gate assertions as predicted', 1, true])
    } finally { fsx.rmSync(fx, { recursive: true, force: true }) }
  }
  {
    // ROUND 32 (L1): the sweep is judged from account state. A newer
    // last_sweep_at with a ledger cycle near it (confirmed or uncertain) is
    // quiet; without one it pages CRITICAL once; inside the grace it waits and
    // is judged next pass; the first pass only takes a baseline.
    const T=1_800_000_000, at=st=>({cycles:[{startedAt:new Date(st*1000).toISOString(),sweepSig:'s'}]})
    const cyc=(o)=>({cycles:[{startedAt:new Date((T-60)*1000).toISOString(),...o}]})
    const j=o=>D.detectSweepState({judgedThrough:T-7200,lastSweepAt:T,nowSec:T+1000,cooldownSecs:21600,...o})
    const fresh=D.detectSweepState({judgedThrough:T-7200,lastSweepAt:T,ledger:{cycles:[]},nowSec:T+60})
    // Review 32: a missing baseline is MINT's initial 0, so the first pass JUDGES
    // the latest sweep; the window is one-sided (cycle start - 120 s ... start +
    // min(1 h, cooldown/2)), so a sweep a cooldown after an honest cycle is not
    // explained by it.
    const first=k=>D.detectSweepState({judgedThrough:undefined,lastSweepAt:T,ledger:k,nowSec:T+1000}).findings.length
    // Round 33 (L1, D1): the window is |t - start| <= cooldown/2, so box-clock
    // skew of minutes (or an hour) cannot page an honest sweep; an uncertain
    // send explains only when the direct lookup says it landed.
    t('R32/R33 L1: a sweep in account state is explained only by a landed ledger sweep within half a cooldown of its cycle start (skew-proof), else CRITICAL once; fresh ones wait; a missing baseline judges from 0',
      [first(cyc({sweepSig:'s'})),first(null),j({ledger:cyc({sweepSig:'s'})}).findings.length,
       j({ledger:cyc({pendingSweepSig:'p'})}).findings.length,j({ledger:cyc({pendingSweepSig:'p'}),landed:new Set(['p'])}).findings.length,
       j({ledger:cyc({})}).findings[0]?.severity,j({ledger:null}).judged,fresh.findings.length,fresh.judged,
       D.detectSweepState({judgedThrough:T,lastSweepAt:T,ledger:null,nowSec:T+9999}).findings.length,D.ALARM_KINDS.sweep_unledgered_state,
       j({ledger:at(T-10800)}).findings.length,j({ledger:at(T-10801)}).findings.length,j({ledger:at(T+10800)}).findings.length,j({ledger:at(T+10801)}).findings.length,
       j({ledger:at(T+300)}).findings.length,j({ledger:at(T-3700)}).findings.length,
       j({ledger:at(T-1800),cooldownSecs:3600}).findings.length,j({ledger:at(T-1801),cooldownSecs:3600}).findings.length,
       D.WATCHED_KEYS.includes('mint.last_sweep_at')],
      [0,1,0,1,0,'CRITICAL',T,0,T-7200,0,'once',0,1,0,1,0,0,0,1,true])
    const almSrc=fsx.readFileSync(new URL('./alarm.mjs', import.meta.url),'utf8')
    t('R32 L1 (review): the alarm persists the sweep baseline and the gap list, and rolls the baseline back when a page is not delivered',
      ['    sweepJudgedThrough: sweepState.judged,','    next.sweepJudgedThrough = prev?.sweepJudgedThrough ?? null','    logGaps: gaps.keep,','    next.backlogs = prev?.backlogs ?? {}',
       '    sweepCooldownSeen: cooldownSeen,','    next.sweepCooldownSeen = prev?.sweepCooldownSeen ?? null'].map(l=>almSrc.includes(l)),[true,true,true,true,true,true])
    // Review 33: the alarm's own lookup and cooldown fragment, extracted and run.
    // Only a confirmed or finalized, error-free status counts as landed; an
    // errored, processed-only or unknown one and a throwing lookup count as not
    // landed (the loud direction); the cooldown used is the smallest ever seen,
    // because a vote can only lengthen it.
    {
      const AF=Object.getPrototypeOf(async function(){}).constructor
      const a=almSrc.indexOf('  const pendingSigs = '), b=almSrc.indexOf('  const sweepState = ', a)
      const frag=new AF('ctx','with(ctx){'+almSrc.slice(a,b)+';return {landedSigs,cooldownSeen}}')
      const led={cycles:['ok','bad','proc','none'].map(x=>({pendingSweepSig:x})).concat([{pendingSweepSig:'done',sweepSig:'done'}])}
      const vals={ok:{confirmationStatus:'confirmed',err:null},bad:{confirmationStatus:'finalized',err:{InstructionError:[0,'x']}},proc:{confirmationStatus:'processed',err:null},none:null}
      const conn={getSignatureStatuses:async(sigs)=>({value:sigs.map(x=>vals[x])})}
      const r1=await frag({led,conn,prev:{sweepCooldownSeen:43200},cfg:{'mint.sweep_cooldown_secs':'86400'}})
      const r2=await frag({led,conn:{getSignatureStatuses:async()=>{throw new Error('rpc')}},prev:{sweepCooldownSeen:7200},cfg:{'mint.sweep_cooldown_secs':'86400'}})
      t('R33 L1 (review): only a confirmed, error-free pending send counts as landed (a throwing lookup counts none); the cooldown judged is the smallest seen, never above 6 h',
        [[...r1.landedSigs],r1.cooldownSeen,[...r2.landedSigs],r2.cooldownSeen],[['ok'],21600,[],7200])
    }
  }
  {
    // ROUND 34 (L1): closesCycle sorts the split list ONCE per list and binary
    // searches it. Proven identical to the old filter-sort-find on 400 random
    // cases (anchored and wall-clock rows, exclusions, upTo), fast at the
    // triage's measured worst size, and the growth is paged at level.
    const oldCloses = (c, splits = [], { exclude = new Set(), upTo = null } = {}) => {
      let need = 0n; try { need = BigInt(c?.returnedSats ?? 0) } catch { return null }
      if (need <= 0n) return null
      const anchor = Number(c?.returnBlockTime)
      const anchored = c?.returnBlockTime !== null && c?.returnBlockTime !== undefined && Number.isFinite(anchor) && anchor > 0
      const afterMs = Date.parse(c?.returnedAt || c?.startedAt)
      if (!anchored && !Number.isFinite(afterMs)) return null
      return D.dedupeSeenSplits(splits).filter(e => !exclude.has(D.splitSig(e)) && D.splitTime(e) !== null && D.splitTotal(e) !== null)
        .filter(e => (anchored ? D.splitTime(e) >= anchor : D.splitTime(e) * 1000 >= afterMs - 60_000) && (upTo === null || D.splitTime(e) <= upTo))
        .sort((a, b) => D.splitTime(a) - D.splitTime(b)).find(e => D.splitTotal(e) >= need) ?? null }
    // Review 34: mulberry32, not a low-bit LCG (whose alternating low bit made
    // the branches rarely taken), and every branch is required to be exercised.
    let st = 0x9e3779b9; const rnd = n => { st |= 0; st = st + 0x6D2B79F5 | 0; let x = Math.imul(st ^ st >>> 15, 1 | st)
      x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) % n }
    let same = 0, hits = { anchored: 0, wall: 0, excl: 0, upToBinds: 0 }
    for (let k = 0; k < 400; k++) {
      const splits = Array.from({ length: 1 + rnd(40) }, () => ({ sig: `s${rnd(30)}`, blockTime: 1000 + rnd(500), total: String(rnd(9000)) }))
      const c = rnd(2) ? { returnedSats: String(1 + rnd(8000)), returnBlockTime: 1000 + rnd(500) }
        : { returnedSats: String(1 + rnd(8000)), returnedAt: new Date((1000 + rnd(500)) * 1000).toISOString() }
      const o = { exclude: new Set(rnd(2) ? [`s${rnd(30)}`, `s${rnd(30)}`] : []), upTo: rnd(2) ? 1000 + rnd(500) : null }
      if (D.splitSig(oldCloses(c, splits, o) ?? {}) === D.splitSig(D.closesCycle(c, splits, o) ?? {})) same++
      hits[c.returnBlockTime ? 'anchored' : 'wall']++; if (o.exclude.size) hits.excl++
      if (o.upTo !== null && D.splitSig(oldCloses(c, splits, { ...o, upTo: null }) ?? {}) !== D.splitSig(oldCloses(c, splits, o) ?? {})) hits.upToBinds++
    }
    // A deterministic arm: a small split at the return and a large one later:
    // with upTo at the small one nothing closes the cycle (the
    // split_claim_unanchored case); without upTo the large one does.
    const sm = [{ sig: 'small', blockTime: 100, total: '5' }, { sig: 'large', blockTime: 200, total: '9000' }], cy = { returnedSats: '1000', returnBlockTime: 100 }
    const big = Array.from({ length: 100_000 }, (_, i) => ({ sig: `x${i}`, blockTime: 2_000_000 + i, total: '1' }))
    const cyc = { cycles: Array.from({ length: 1460 }, (_, i) => ({ startedAt: new Date(1_000_000_000 + i).toISOString(), sweepSig: `w${i}`, splitByOther: true, returnedSats: '5', returnBlockTime: 2_000_000 + i })) }
    // Round 42: CPU time, not wall time. The box is shared, and a neighbour's load
    // stretched the wall clock past the bound with this code unchanged (7-11 s);
    // the property is the algorithm's cost, which CPU time measures. The old form
    // took 34 s, so a 15 s bound still fails any return to it.
    const c0 = process.cpuUsage(); D.detectSplitClaims(big, cyc, { now: 9e12, sweeps: cyc.cycles.map(c => ({ sig: c.sweepSig, blockTime: 1 })), chainNow: 9e12 })
    const cu = process.cpuUsage(c0), ms = (cu.user + cu.system) / 1000
    t('R34 L1: closesCycle is identical to the old form on 400 random cases; 1,460 cycles against 100,000 splits now take seconds at most (34 s before); over 50,000 entries pages split_history_large at level',
      [same, Object.values(hits).every(n => n >= 50), D.closesCycle(cy, sm, { upTo: 100 }), D.closesCycle(cy, sm)?.sig,
       ms < 15000, D.detectSplitHistoryGrowth(big)[0]?.kind, D.ALARM_KINDS.split_history_large, D.detectSplitHistoryGrowth(big.slice(0, 50_000)).length],
      [400, true, null, 'large', true, 'split_history_large', 'level', 0])
  }
  {
    // ROUND 34 (L2): the reconcile states a Token-2022 account's base-field
    // amount, labelled, never a confident 0; a short account is "unreadable".
    const acc = n => { const b = Buffer.alloc(165); b.writeBigUInt64LE(BigInt(n), 64); return b }
    const det = D.detectUndeclaredTokenAccounts('A', [], [{ address: 'X', amount: D.reconcileAmount(D.TOKEN22_ID, acc(1_000_000)) }])[0]?.detail ?? ''
    t('R34 L2: reconcile amounts come from the owning program: classic and Token-2022 read their base field (the latter labelled), short or foreign data is unreadable, and the page never says 0 units for a funded Token-2022 account',
      [D.reconcileAmount(D.TOKEN_ID, acc(1_000_000)), /^1000000 units in the Token-2022 base field/.test(D.reconcileAmount(D.TOKEN22_ID, acc(1_000_000))),
       D.reconcileAmount(D.TOKEN22_ID, Buffer.alloc(10)), D.reconcileAmount('Other1111111111111111111111111111111111111', acc(5)), /\(0 units\)/.test(det), /1000000 units in the Token-2022/.test(det)],
      ['1000000', true, 'unreadable', 'unreadable', false, true])
  }
  {
    // ROUND 36 (off-chain C06, refuted by measurement): the sweep revenue.mjs
    // ACTUALLY builds makes the operator the fee payer AND a signer, although its
    // own key list says isSigner:false. The statement is extracted and compiled.
    const W3 = await import('@solana/web3.js')
    const rev = fsx.readFileSync(new URL('./revenue.mjs', import.meta.url), 'utf8')
    const a = rev.indexOf('new Transaction().add(new TransactionInstruction({\n    programId: MINT_PROG'), b = rev.indexOf(',\n    [operator], {', a)
    const operator = W3.Keypair.generate(), K = () => W3.Keypair.generate().publicKey
    const tx = new Function('Transaction', 'TransactionInstruction', 'SystemProgram', 'Buffer', 'd', 'u64', 'amount', 'MINT_PROG', 'MINT_CFG', 'REVENUE', 'operator',
      `return ${rev.slice(a, b)}`)(W3.Transaction, W3.TransactionInstruction, W3.SystemProgram, Buffer, () => Buffer.alloc(8), () => Buffer.alloc(8), 1n, K(), K(), K(), operator)
    tx.recentBlockhash = K().toBase58(); tx.sign(operator)
    const m = tx.compileMessage()
    t('R36 C06: revenue.mjs\'s own sweep compiles with the operator as fee payer AND signer (one signature)',
      [a > 0 && b > a, m.accountKeys[0].equals(operator.publicKey), m.isAccountSigner(0), m.header.numRequiredSignatures], [true, true, true, 1])
  }
  {
    // ROUND 36 (L5): the index-lag limit as SPEC now states it. The alarm runs
    // every 30 minutes and the router's grace is 25, so a recovery can only come
    // from a pass AFTER the grace: every observed lag pages once, then clears.
    const cron = fsx.readFileSync(new URL('../scripts/cron-install.sh', import.meta.url), 'utf8')
    const mins = ((cron.match(/^(\d+(?:,\d+)*) \* \* \* \* .*bank\/alarm\.mjs >>/m) || [])[1] || '').split(',').map(Number)
    const gap = mins.length > 1 ? Math.min(...mins.map((x, i) => ((mins[(i + 1) % mins.length] - x) + 60) % 60 || 60)) : 60
    let grace = null
    try { grace = Number((fsx.readFileSync('/opt/scripts/alert-router.py', 'utf8').match(/GRACE_MIN\s*=\s*int\(os\.environ\.get\('ALERT_GRACE_MIN', '(\d+)'\)\)/) || [])[1]) } catch {}
    t('R36 L5: the alarm\'s pass interval (30 min) exceeds the router\'s grace (25), so SPEC\'s "pages once, then ALL CLEAR" is the true reading',
      [gap, grace, gap > grace, D.ALARM_KINDS.index_disagrees_with_chain], [30, 25, true, 'level'])
  }
  {
    // ROUND 36 (L3): a vault in a FOREIGN Core asset's wallet is not "sealed for
    // good": the text names the host-owner execute and, for a burned host, the rescue.
    const f = D.detectNestedVaults([{ id: 'V1', owner: 'ForeignAssetSignerPda1111111111111111111111' }], () => null, () => false)
    t('R36 L3: unredeemable_owner names the execute and the rescue, and no longer says "sealed for good"',
      [f[0]?.kind, f[0]?.detail.includes('rescue_nested'), f[0]?.detail.includes('executing through it'), f[0]?.detail.includes('sealed for good')],
      ['unredeemable_owner', true, true, false])
  }
  {
    // ROUND 34 (L3): revenue.mjs's split recovery starts its chain scan at the
    // return's CHAIN time; a box clock 300 s ahead no longer starts it after the
    // split. The actual statement is extracted and run.
    const rev = fsx.readFileSync(new URL('./revenue.mjs', import.meta.url), 'utf8')
    const a = rev.indexOf('      const since = Math.min('), b = rev.indexOf('      const splits = ', a)
    const sinceOf = new Function('returnedUnsplit', rev.slice(a, b) + ';return since')
    const R = 1_800_000_000
    const skewed = [{ returnBlockTime: R, returnedAt: new Date((R + 300) * 1000).toISOString() }]
    const legacy = [{ returnedAt: new Date((R + 300) * 1000).toISOString() }]
    t('R34 L3: the split-recovery scan starts at the return\'s chain time (box clock 300 s ahead); a row without one keeps the box clock (a stated residual)',
      [sinceOf(skewed) - 60 <= R + 5, sinceOf(legacy)], [true, R + 300])
  }
  {
    // ROUND 30 (D1): a rehearsal's recovery and run-failure notices say REHEARSAL.
    const alm = fsx.readFileSync(new URL('./alarm.mjs', import.meta.url), 'utf8')
    const rec = r => D.planAlarmNotices([], { prevPaged: ['crank_silent'], fullPass: true, rehearsal: r, stamp: 'x' }).notices.find(n => n.recovery)?.text ?? ''
    t('R30 D1: rehearsal RECOVERED notices are tagged (production ones are not) and the alarm\'s run-failure and reconcile-failure texts carry the tag',
      [/\(REHEARSAL\)/.test(rec(true)), /REHEARSAL/.test(rec(false)), /RECOVERED/.test(rec(true)),
       ['RECONCILE FAILED', 'ALARM DID NOT RUN', 'ALARM FAILED TO RUN'].every(k => alm.includes("CBOB VAULT${PRODUCTION ? '' : ' (REHEARSAL)'} " + k))],
      [true, false, true, true])
  }
  t('M1: ...and the on-chain floor is exactly the tolerance below it',
    f.minSats, f.expectedSats * BigInt(10_000 - SW.SWAP_TOLERANCE_BPS) / 10_000n)
  // ROUND 40 (C02): the arm above recomputes the code's own expression, so a
  // wrong tolerance (9000 bps) passed it. Pinned BY HAND: 2 SOL at $120.45355552
  // over $85,929.10904675 is 280,355.65 sats, floored to 280,355; 150 bps under
  // that is 280,355 x 9,850 / 10,000 = 276,149.68, floored to 276,149.
  t('R40 C02: the floor is PINNED by hand at 150 bps (280,355 expected, 276,149 minimum), and SPEC\'s 150 is the constant',
    [f.expectedSats, f.minSats, SW.SWAP_TOLERANCE_BPS], [280_355n, 276_149n, 150])
  const thr = fn => { try { fn(); return 'ok' } catch (e) { return e.message } }
  t('M1: a price older than the bound is REFUSED (and one just inside it is not)',
    [/old/.test(thr(() => SW.oracleFloor({ lamportsIn: 1n, sol: { ...sol, publishTime: NOW - SW.MAX_ORACLE_AGE_SECS - 1 }, btc, nowSec: NOW }))),
     thr(() => SW.oracleFloor({ lamportsIn: 1_000_000_000n, sol: { ...sol, publishTime: NOW - SW.MAX_ORACLE_AGE_SECS }, btc, nowSec: NOW }))], [true, 'ok'])
  // ROUND 41 (C02): the arm above derives its boundary from the code's own
  // constant, so 300 or 399 s passed it. SPEC states 180 s: pinned in LITERALS.
  t('R41 C02: the price-age bound is 180 s, in literals: 181 s old is refused, 180 s old is used, and the constant is 180',
    [/old/.test(thr(() => SW.oracleFloor({ lamportsIn: 1n, sol: { ...sol, publishTime: NOW - 181 }, btc, nowSec: NOW }))),
     thr(() => SW.oracleFloor({ lamportsIn: 1_000_000_000n, sol: { ...sol, publishTime: NOW - 180 }, btc, nowSec: NOW })), SW.MAX_ORACLE_AGE_SECS], [true, 'ok', 180])
  // ROUND 41 (C06): SPEC's 0.01 SOL minimum sweep, in a literal.
  // ROUND 42 (C09): revenue.mjs's operator float, read from its source, is SPEC's 0.02 SOL.
  { const m = /const OPERATOR_FLOOR = ([\d_]+)n/.exec(fsx.readFileSync(new URL('./revenue.mjs', import.meta.url), 'utf8'))
    t('R42 C09: the swap operator float OPERATOR_FLOOR is 0.02 SOL (20,000,000 lamports), as SPEC says', m ? BigInt(m[1].replace(/_/g, '')) : 'MISSING', 20_000_000n) }
  t('R41 C06: the minimum sweep is 0.01 SOL (10,000,000 lamports) in a literal, and sweepAmount refuses below it',
    [SW.MIN_SWEEP_LAMPORTS,
     SW.sweepAmount({ balance: 1_009_999_999n, reserve: 1_000_000_000n, maxPerCycle: 10n ** 12n, chainCap: 10n ** 12n }),
     SW.sweepAmount({ balance: 1_010_000_000n, reserve: 1_000_000_000n, maxPerCycle: 10n ** 12n, chainCap: 10n ** 12n })],
    [10_000_000n, 0n, 10_000_000n])
  t('M1: a confidence wider than the bound is REFUSED', /confidence/.test(thr(() => SW.oracleFloor({ lamportsIn: 1n, sol, btc: { ...btc, conf: btc.price / 50n }, nowSec: NOW }))), true)
  t('M1: a non-positive price is REFUSED', /positive/.test(thr(() => SW.oracleFloor({ lamportsIn: 1n, sol: { ...sol, price: 0n }, btc, nowSec: NOW }))), true)
  t('M1: a swap too small to buy a whole sat at the floor is REFUSED', /no whole sat/.test(thr(() => SW.oracleFloor({ lamportsIn: 1n, sol, btc, nowSec: NOW }))), true)
  // readPyth: owner, verification level, feed id.
  const pyth = (lvl, feed, owner = SW.PYTH.receiver, expo = -8) => { const d = Buffer.alloc(8 + 32 + 2 + 32 + 8 + 8 + 4 + 8 + 40)
    let o = 40; if (lvl === 'full') d[o++] = 1; else { d[o++] = 0; d[o++] = 5 }
    Buffer.from(feed, 'hex').copy(d, o); o += 32
    d.writeBigInt64LE(sol.price, o); d.writeBigUInt64LE(sol.conf, o + 8); d.writeInt32LE(expo, o + 16); d.writeBigInt64LE(BigInt(NOW), o + 20)
    return { owner, data: d } }
  t('M1: a FULLY verified Pyth account for the expected feed reads', SW.readPyth(pyth('full', SW.PYTH.SOL_USD), SW.PYTH.SOL_USD).price, sol.price)
  t('M1: ...a PARTIALLY verified one, the wrong feed, or a foreign owner is REFUSED',
    [/PARTIALLY/.test(thr(() => SW.readPyth(pyth('partial', SW.PYTH.SOL_USD), SW.PYTH.SOL_USD))),
     /carries feed/.test(thr(() => SW.readPyth(pyth('full', SW.PYTH.BTC_USD), SW.PYTH.SOL_USD))),
     /not the Pyth receiver/.test(thr(() => SW.readPyth(pyth('full', SW.PYTH.SOL_USD, SW.ORCA.program), SW.PYTH.SOL_USD)))], [true, true, true])
  // ROUND 42 (C06, a measured rejection pinned): an out-of-range exponent is refused
  // by name, at the read and at the floor; -8 (the real feeds) is accepted.
  t('R42 C06: a Pyth exponent outside -18..0 is REFUSED (int32 extremes, +1, -19) at the read and the floor; -8, -18 and 0 read',
    [[-2147483648, 2147483647, 1, -19].every(x => /exponent .* is outside -18\.\.0/.test(thr(() => SW.readPyth(pyth('full', SW.PYTH.SOL_USD, SW.PYTH.receiver, x), SW.PYTH.SOL_USD)))),
     /exponent -2147483648 is outside/.test(thr(() => SW.oracleFloor({ lamportsIn: 1_000_000_000n, sol: { ...sol, expo: -2147483648 }, btc, nowSec: NOW }))),
     [-8, -18, 0].map(x => SW.readPyth(pyth('full', SW.PYTH.SOL_USD, SW.PYTH.receiver, x), SW.PYTH.SOL_USD).expo), [SW.PYTH_EXPO_MIN, SW.PYTH_EXPO_MAX]],
    [true, true, [-8, -18, 0], [-18, 0]])
  t('M1: the Orca tick arrays an a_to_b swap crosses (proven against mainnet 2026-10-05)', SW.orcaTickArrayStarts(-88733, 16), [-90112, -91520, -92928])
  t('M1: ...a tick exactly on an array boundary starts that array', SW.orcaTickArrayStarts(-90112, 16)[0], -90112)
  t('M1: the Meteora bin arrays a Y->X swap crosses (mainnet 2026-10-05), and a negative id floors down',
    [SW.meteoraBinArrayIndexes(5920), SW.meteoraBinArrayIndexes(-1)], [[84, 85, 86], [-1, 0, 1]])
  // Pool readers refuse the wrong token order (Orca is wSOL/cbBTC; Meteora the reverse).
  const wpool = (a, b) => { const d = Buffer.alloc(653); a.toBuffer().copy(d, 101); b.toBuffer().copy(d, 181); return { owner: SW.ORCA.program, data: d } }
  const lpool = (x, y) => { const d = Buffer.alloc(904); x.toBuffer().copy(d, 88); y.toBuffer().copy(d, 120); return { owner: SW.METEORA.program, data: d } }
  t('M1: the Orca reader accepts wSOL/cbBTC and REFUSES the reverse',
    [thr(() => SW.readWhirlpool(wpool(SW.WSOL, SW.CBBTC))), /not wSOL\/cbBTC/.test(thr(() => SW.readWhirlpool(wpool(SW.CBBTC, SW.WSOL))))], ['ok', true])
  t('M1: the Meteora reader accepts cbBTC/wSOL and REFUSES the reverse',
    [thr(() => SW.readLbPair(lpool(SW.CBBTC, SW.WSOL))), /not cbBTC\/wSOL/.test(thr(() => SW.readLbPair(lpool(SW.WSOL, SW.CBBTC))))], ['ok', true])
  t('M1: ...and a pool owned by another program is REFUSED', /not owned by the Whirlpool/.test(thr(() => SW.readWhirlpool({ ...wpool(SW.WSOL, SW.CBBTC), owner: SW.METEORA.program }))), true)
  // The judge, both ways, on instructions built by the real builder.
  const op = new PK('bipP7uK5aQDsrChYA8hpZ1Thb8BCw7emRGuEkLkHg6G')
  const w = SW.readWhirlpool(wpool(SW.WSOL, SW.CBBTC)), lp = SW.readLbPair(lpool(SW.CBBTC, SW.WSOL))
  for (const venue of ['orca', 'meteora']) {
    const ixs = SW.swapInstructions({ venue, owner: op, lamportsIn: 1_000_000_000n, minSats: 1n, w, p: lp, bitmapExists: true })
    // Round 25 (L1): the judge is told the amount and the floor it must find.
    const amounts = { lamportsIn: 1_000_000_000n, minSats: 1n }
    t(`M1: the judge passes the ${venue} swap we built`, SW.judgeSwapInstructions(ixs, op, venue, amounts), [])
    const other = new PK('11111111111111111111111111111112')
    const extraSigner = ixs.map((ix, i) => i === 5 ? { ...ix, programId: ix.programId, data: ix.data, keys: [...ix.keys, { pubkey: other, isSigner: true, isWritable: false }] } : ix)
    const twoSwaps = [...ixs, ixs[5]]
    const foreign = [...ixs, { ...ixs[1], programId: new PK('BPFLoaderUpgradeab1e11111111111111111111111'), keys: ixs[1].keys, data: ixs[1].data }]
    const noClose = ixs.filter((_, i) => i !== 6)
    t(`M1: ...and REFUSES a ${venue} swap with a second signer, two swaps, a foreign program, or no wSOL close`,
      [extraSigner, twoSwaps, foreign, noClose].map(x => SW.judgeSwapInstructions(x, op, venue, amounts).length > 0), [true, true, true, true])
  }
  t('M1: the swap is ON CHAIN-floored: the minimum rides in the instruction data (Orca other_amount_threshold, Meteora min_amount_out)',
    ['orca', 'meteora'].map(v => SW.swapInstructions({ venue: v, owner: op, lamportsIn: 7n, minSats: 4242n, w, p: lp, bitmapExists: true })[5].data.readBigUInt64LE(16)), [4242n, 4242n])
  t('M1: Orca is told EXACT INPUT and a_to_b (selling wSOL for cbBTC), at the minimum price limit',
    (d => [d[40], d[41], d.readBigUInt64LE(24) + (d.readBigUInt64LE(32) << 64n)])(SW.swapInstructions({ venue: 'orca', owner: op, lamportsIn: 7n, minSats: 1n, w, p: lp, bitmapExists: true })[5].data),
    [1, 1, 4295048016n])
  const rv = fsx.readFileSync(new URL('./revenue.mjs', import.meta.url), 'utf8')
  t('M1: revenue.mjs no longer calls Jupiter, and swaps only through bank/swap.mjs',
    [/jup\.ag/.test(rv.replace(/^\s*(\/\/|\*).*$/gm, '')), /from '\.\/swap\.mjs'/.test(rv), /judgeSwapInstructions/.test(rv)], [false, true, true])
}

console.log('── v6: the crank plans only what the program will accept ──')
{
  // `x` after the index: padding `Asset1` and `Asset11` with 1s collides them.
  const A = i => `Asset${i}x`.padEnd(32, '1')
  const rec = (i, o = {}) => ({ address: `Rec${i}`, asset: A(i), mint_index: BigInt(i), reveal_slot: 1000n, level: 0,
    entropy_set: false, active: false, retired: false, vault_ata: `Ata${i}`, debt_scaled: 0n, attrs_hash: '',
    pending: false, request_epoch: 0n, ...o })
  const cfg0 = { revealed_total: 0n, acc_scaled: 0n, total_active_weight: 0n, owed_scaled: 0n, last_distribute_at: 0n, monthly_secs: 2592000n,
    dist_epoch: 0n, pending_count: 0n, pending_this_epoch: 0n }
  const pool0 = { state: 'ok', amount: 0n, frozen: false }
  // Round 23 (L2): only a POSITIVELY live asset is joined or paid, so every
  // record defaults to 'live' here unless an arm says otherwise.
  // Round 24 (L3): the split's second destination, the CBOBTC Squads' cbBTC
  // account, is read now and must be healthy for a split; healthy by default here.
  const bank0 = { state: 'ok', amount: 0n, frozen: false }
  const plan = (o = {}) => CR.planCrank({ cfg: cfg0, records: [], tokens: {}, pool: pool0, slot: 5000, nowSec: 100, bank: bank0,
    ...o, assets: o.assets ?? Object.fromEntries((o.records || []).map(r => [r.asset, 'live'])) })
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
  t('...nor one already WAITING to join (stage 3c: a request is made once)',
    plan({ records: [rec(0, { level: 1, pending: true })], assets: { [A(0)]: 'live' }, tokens: { [A(0)]: tok(99999n) } }).activate, [])
  // STAGE 3c: JOINS. A waiting vault joins once a distribution has passed it.
  t('a WAITING vault a distribution has passed is JOINED, in its own batch BEFORE any distribution',
    (() => { const p = plan({ cfg: { ...cfg0, dist_epoch: 1n, pending_count: 1n }, records: [rec(0, { level: 1, pending: true, request_epoch: 0n })] })
      return [p.preJoins, p.joins] })(), [[['Rec0', 'Ata0']], []])
  t('...but not one no distribution has passed yet (it would be refused as ActivationPending)',
    (() => { const p = plan({ cfg: { ...cfg0, dist_epoch: 1n, pending_count: 1n, pending_this_epoch: 1n }, records: [rec(0, { level: 1, pending: true, request_epoch: 1n })] })
      return [p.preJoins.length, p.joins.length] })(), [0, 0])
  t('nobody joined, vaults asked this epoch, the month due: the free run is an EPOCH TICK, and they join after it',
    (() => { const p = plan({ cfg: { ...cfg0, monthly_secs: 100n, pending_count: 1n, pending_this_epoch: 1n }, records: [rec(0, { level: 1, pending: true, request_epoch: 0n })], nowSec: 100 })
      return [p.distribute, p.distributeKind, p.joins.length] })(), [true, 'tick', 1])
  t('R37 C02: a FROZEN pool still ticks and joins (the tick moves nothing; a waiting vault\'s claim joins without touching the pool), and says so',
    (() => { const p = plan({ cfg: { ...cfg0, monthly_secs: 100n, pending_count: 1n, pending_this_epoch: 1n }, records: [rec(0, { level: 1, pending: true, request_epoch: 0n })], nowSec: 100,
      pool: { ...pool0, frozen: true } })
      return [p.distribute, p.distributeKind, p.joins.length, p.problems.some(x => /free tick and joins still go through/.test(x))] })(), [true, 'tick', 1, true])
  // ROUND 38 (C01): round 37's arm checked only the PLAN; the joins were never
  // batched for sending. The crank sends exactly plan.claims, so assert it there.
  t('R38 C01: ...and those joins are SENT: one join-only claim batch carrying the vault, and no paying claims',
    (() => { const p = plan({ cfg: { ...cfg0, monthly_secs: 100n, pending_count: 1n, pending_this_epoch: 1n }, records: [rec(0, { level: 1, pending: true, request_epoch: 0n })], nowSec: 100,
      pool: { ...pool0, frozen: true } })
      return [p.claims.length, p.claims[0]?.map(([r]) => r), Object.keys(p.owed).length] })(), [1, ['Rec0'], 0])
  t('...and no tick with nobody waiting (it would be refused, and there is no one to let in)',
    plan({ cfg: { ...cfg0, monthly_secs: 100n }, nowSec: 100 }).distribute, false)
  t('a request sent THIS pass joins on a LATER pass (it is sent after the distribution, into the new epoch)',
    [plan({ cfg: { ...cfg0, monthly_secs: 100n }, records: [rec(0, { level: 1 })], assets: { [A(0)]: 'live' }, tokens: { [A(0)]: tok(21000n, { address: 'Ata0' }) }, nowSec: 100 }).joins.length,
     plan({ cfg: { ...cfg0, monthly_secs: 100n }, records: [rec(0, { level: 1 })], assets: { [A(0)]: 'live' }, tokens: { [A(0)]: tok(21000n, { address: 'Ata0' }) }, nowSec: 100 }).distribute], [0, false])
  t('a BURNED waiting vault is never joined (it is retired instead): red-team 3 finding 2',
    (() => { const p = plan({ cfg: { ...cfg0, dist_epoch: 1n, pending_count: 1n }, records: [rec(0, { level: 1, pending: true, request_epoch: 0n })], assets: { [A(0)]: 'burned' } })
      return [p.preJoins.length, p.retireBurned] })(), [0, ['Rec0']])
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
  t('a due distribution with an eligible vault waiting: joined FIRST (the program refuses otherwise), and its weight is counted',
    (() => { const p = plan({ cfg: { ...cfgD, dist_epoch: 1n, pending_count: 1n }, records: [act(0, 1), rec(1, { level: 1, pending: true, request_epoch: 0n })],
        tokens: toks(2), pool: { ...pool0, amount: 40n }, nowSec: 100 })
      return [p.preJoins.length, p.distributeKind, p.claims.flat().length] })(), [1, 'credit', 2])
  t('...and the joined vault is DELIVERED its share in the same pass (round 22, F5), at debt = weight x the old acc',
    (() => { const p = plan({ cfg: { ...cfgD, dist_epoch: 1n, pending_count: 1n }, records: [act(0, 1), rec(1, { level: 1, pending: true, request_epoch: 0n })],
        tokens: toks(2), pool: { ...pool0, amount: 40n }, nowSec: 100 })
      return p.claims.flat().map(([r]) => r).sort() })(), ['Rec0', 'Rec1'])
  t('F5: retiring the LAST active vault this pass means no credit is planned (it would fail NoActiveVaults)',
    plan({ cfg: { ...cfgD, total_active_weight: 2n }, records: [act(0, 1)], assets: { [A(0)]: 'burned' }, tokens: toks(1), pool: { ...pool0, amount: 50n }, nowSec: 100 }).distribute, false)
  t('F7: a FROZEN pool is never distributed from', plan({ cfg: cfgD, pool: { ...pool0, amount: 50n, frozen: true }, nowSec: 100 }).distribute, false)
  t('S1: mint-price cbBTC in the revenue address is SPLIT this pass, and its 85% counts toward the distribution',
    (() => { const p = plan({ cfg: cfgD, pool: { ...pool0, amount: 0n }, revenue: { state: 'ok', amount: 1000n }, nowSec: 100 })
      return [p.split, p.distribute] })(), [true, true])
  t('S1: ...and nothing to split plans no split', plan({ cfg: cfgD, revenue: { state: 'ok', amount: 0n }, nowSec: 0 }).split, false)
  const p1 = plan({ cfg: { ...cfgD, total_active_weight: 2n }, records: [act(0, 1)], tokens: toks(1), pool: { ...pool0, amount: 50n }, nowSec: 100 })
  t('a vault owed by THIS pass\'s distribution is delivered in the same pass', p1.claims, [[['Rec0', 'Ata0']]])
  const many = [...Array(30)].map((_, i) => act(i, 1))
  const pm = plan({ cfg: { ...cfgD, total_active_weight: 60n, acc_scaled: 10n * AC.ACC_SCALE }, records: many, tokens: toks(30), nowSec: 0 })
  t('claims are batched 14 per transaction (the measured legacy limit)', pm.claims.map(b => b.length), [14, 14, 2])
  t('a BURNED active vault is never paid (the sats would be destroyed; retiring returns them)',
    plan({ cfg: { ...cfgD, acc_scaled: 10n * AC.ACC_SCALE }, records: [act(0, 1)], assets: { [A(0)]: 'burned' }, tokens: toks(1), nowSec: 0 }).claims, [])
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
  // THE $CBOB BOOST (2026-10-04): a due boost is expired BEFORE the distribution
  // (the program refuses one while any is due), and one this pass makes due right
  // after it; the owed math carries the boost and the carry exactly as MINT does.
  const boosted = (i, end, o = {}) => act(i, 1, { boost_weight: 2, boost_end_epoch: end, carry_scaled: 0n, ...o })
  t('BOOST: a DUE boost is expired before the distribution, and its weight leaves the denominator first',
    (() => { const p = plan({ cfg: { ...cfgD, total_active_weight: 6n, dist_epoch: 3n }, records: [act(0, 1), boosted(1, 3n)], tokens: toks(2), pool: { ...pool0, amount: 40n }, nowSec: 100 })
      return [p.preExpires, p.distribute, p.claims.flat().map(([r]) => r).sort()] })(), [['Rec1'], true, ['Rec0', 'Rec1']])
  t('BOOST: ...and both are then paid at weight 2 (40 sats over the post-expiry weight 4: 20 each)',
    (() => { const p = plan({ cfg: { ...cfgD, total_active_weight: 6n, dist_epoch: 3n }, records: [act(0, 1), boosted(1, 3n)], tokens: toks(2), pool: { ...pool0, amount: 40n }, nowSec: 100 })
      return p.claims.length })(), 1)
  t('BOOST: a boost THIS distribution makes due is expired right after it, and not before',
    (() => { const p = plan({ cfg: { ...cfgD, total_active_weight: 6n, dist_epoch: 2n }, records: [act(0, 1), boosted(1, 3n)], tokens: toks(2), pool: { ...pool0, amount: 60n }, nowSec: 100 })
      return [p.preExpires, p.postExpires] })(), [[], ['Rec1']])
  t('BOOST: ...nothing is expired after when no distribution runs this pass',
    plan({ cfg: { ...cfgD, total_active_weight: 6n, dist_epoch: 2n }, records: [boosted(1, 3n)], tokens: toks(2), nowSec: 0 }).postExpires, [])
  t('BOOST: a live boost is paid at level + boost, with its carry (6 per unit x 4 + 5 carried = 29)',
    (() => { const p = plan({ cfg: { ...cfgD, acc_scaled: 6n * AC.ACC_SCALE, total_active_weight: 4n, dist_epoch: 1n },
        records: [boosted(0, 5n, { carry_scaled: 5n * AC.ACC_SCALE })], tokens: toks(1), nowSec: 0 })
      return [p.claims.flat().length, p.problems] })(), [1, []])
  t('BOOST: a burned boosted vault is RETIRED, never expired (the retire removes its boost)',
    (() => { const p = plan({ cfg: { ...cfgD, total_active_weight: 4n, dist_epoch: 3n }, records: [boosted(0, 3n)], assets: { [A(0)]: 'burned' }, tokens: toks(1), nowSec: 0 })
      return [p.retireBurned, p.preExpires] })(), [['Rec0'], []])
  t('BOOST: the expire batch fits MINT\'s bound', L.EXPIRE_BATCH <= Number((src => (src.match(/const MAX_EXPIRE_BATCH: usize = (\d+);/) || [])[1])(
    fsx.readFileSync(new URL('../programs/cbob-vault-mint/src/lib.rs', import.meta.url), 'utf8'))), true)
  t('the reveal-only fast lane plans reveals and NOTHING else',
    (() => { const p = CR.planCrank({ cfg: { ...cfgD, acc_scaled: 10n * AC.ACC_SCALE }, records: [rec(0), act(1, 1, { mint_index: 1n })], assets: {}, tokens: toks(2),
      pool: { ...pool0, amount: 50n }, slot: ready + 1, nowSec: 999 }, { revealOnly: true })
      return [p.capture.length, p.distribute, p.claims.length, p.activate.length] })(), [1, false, 0, 0])
  // THE FEE PAYER IS NEVER A HONEYPOT.
  // Round 22 (F8): refusing let anyone stop every crank lane by sending the key 0.25 SOL.
  t('a crank key above the 0.25 SOL ceiling RUNS and WARNS (a honeypot to move, not a reason to stop)',
    [CR.judgeFeePayer(CR.FEE_CEILING_LAMPORTS + 1n).ok, !!CR.judgeFeePayer(CR.FEE_CEILING_LAMPORTS + 1n).warn], [true, true])
  t('...one below the floor is refused too', CR.judgeFeePayer(CR.FEE_FLOOR_LAMPORTS - 1n).ok, false)
  t('...and a fee-sized balance runs', CR.judgeFeePayer(50_000_000n).ok, true)
  // THE ATTRIBUTE HASH IS THE PROGRAM'S: Borsh Vec<VaultAttribute>, sha256.
  const list = [{ key: 'charter', value: 'Pob1' }, { key: 'k', value: 'v' }]
  const ATTRS_VECTOR = '34bea1c8111c3272760e87e103636aa1f4fc629b9988a27eead63cdd495fe4d3'
  t('attrsBorsh is u32 count, then u32-length-prefixed key and value',
    CR.attrsBorsh([{ key: 'ab', value: 'c' }]).toString('hex'), '01000000' + '02000000' + '6162' + '01000000' + '63')
  // Round 24 (L13d): this recomputed attrsHash's own expression. A fixed vector:
  // sha256 of the Borsh bytes of [{charter: Pob1}, {k: v}], computed once by hand
  // (`printf '\x02\x00…' | sha256sum`) and pinned.
  t('attrsHash is sha256 of exactly those bytes (a pinned vector)',
    CR.attrsHash(list), ATTRS_VECTOR)
  t('...and order matters (Core stores a list, the program hashed that list)',
    CR.attrsHash(list) === CR.attrsHash([...list].reverse()), false)
  t('the crank\'s instruction discriminators are COMPUTED, never typed',
    CR.ixDisc('reveal_level').toString('hex'), (await import('crypto')).createHash('sha256').update('global:reveal_level').digest().subarray(0, 8).toString('hex'))
  // Round 43 (V43-1): rescue_nested joins the list. It is permissionless and MINT
  // pins its only destination to bank_treasury, so the crank still chooses nothing.
  t('crank.mjs sends only permissionless MINT instructions (no transfer, no system move of value)',
    (() => { const src = fsx.readFileSync('/opt/cbob-vaults/bank/crank.mjs', 'utf8')
      const used = [...src.matchAll(/d\('(\w+)'\)/g)].map(m => m[1]).sort()
      return [...new Set(used)] })(), ['activate', 'capture_entropy', 'claim', 'distribute', 'expire_boosts', 'reschedule_reveal', 'rescue_nested', 'retire_burned', 'reveal_level', 'split_revenue'])
  // Round 22 (G1): the name list says WHICH MINT instructions; this says nothing
  // else moves value. No SPL transfer, no system transfer, no other program.
  t('...and crank.mjs builds no token or SOL transfer of its own, and calls no program but MINT',
    (() => { const src = fsx.readFileSync('/opt/cbob-vaults/bank/crank.mjs', 'utf8')
      return [/createTransfer|SystemProgram\.transfer|transferChecked|\btransfer\(/.test(src),
        [...src.matchAll(/programId:\s*([A-Za-z_]+)/g)].map(m => m[1]).filter(x => x !== 'MINT')] })(), [false, []])
  t('...and the distribute it sends is the FREE path (burn = 0), never a $GARY burn from the crank key',
    /d\('distribute'\), Buffer\.from\(\[0\]\)/.test(fsx.readFileSync('/opt/cbob-vaults/bank/crank.mjs', 'utf8')), true)
  t('crank.mjs is DRY-RUN unless --live is passed', /if \(!LIVE\) \{ console\.log\('\\nDRY RUN/.test(fsx.readFileSync('/opt/cbob-vaults/bank/crank.mjs', 'utf8')), true)

  // ══ ROUND 23: the crank's findings, each both ways ══
  // M2: the two lanes race on a reveal. The loser read attributes that already
  // carry `level`, the hash check failed, and it paged a false "reader and
  // program disagree" every sale hour. MEASURED BEFORE THE FIX: attrsHash(list)
  // === attrsHash([...list, level]) is false, and the old code had no other path.
  {
    const minted = [{ key: 'charter', value: 'Pob1' }, { key: 'k', value: 'v' }], h = CR.attrsHash(minted)
    t('M2: the minted list is SENT, the same list plus the program\'s `level` is REVEALED (done elsewhere), a tampered list is a MISMATCH',
      [CR.judgeRevealAttrs(minted, h), CR.judgeRevealAttrs([...minted, { key: 'level', value: 'III' }], h),
       CR.judgeRevealAttrs([{ key: 'charter', value: 'Pob2' }, { key: 'k', value: 'v' }], h)], ['send', 'revealed', 'mismatch'])
    t('M2: ...and a tampered list that also carries `level` is still a MISMATCH, never waved through as revealed',
      CR.judgeRevealAttrs([{ key: 'charter', value: 'Pob2' }, { key: 'level', value: 'I' }], h), 'mismatch')
  }
  // L1: the races round 22 missed are benign; the refusals that mean OUR plan is
  // wrong, or an empty key, still FAIL.
  t('L1: every race code is benign (retired, activated or pending elsewhere, a window that closed)',
    ['AlreadyRetired', 'AlreadyActive', 'VaultRetired', 'ActivationPending', 'RevealWindowExpired', 'NeedsReschedule',
     'AlreadyRevealed', 'MonthNotElapsed'].filter(c => !CR.BENIGN.test(`Error Code: ${c}`)), [])
  t('L1: ...while BoostsExpireFirst, JoinWaitingFirst and an empty fee payer are NOT',
    ['Error Code: BoostsExpireFirst', 'Error Code: JoinWaitingFirst', 'Attempt to debit an account but found no record of a prior credit',
     'insufficient funds for fee'].filter(m => CR.BENIGN.test(m)), [])
  t('L1: crank.mjs reads a reveal\'s attributes inside a try, so one RPC blip ends the reveal run, not the pass',
    /try \{ list = await mintedAttributes\(/.test(fsx.readFileSync('/opt/cbob-vaults/bank/crank.mjs', 'utf8')), true)
  // L2: 'other' is a null RPC answer, never a live asset.
  t('L2: an active vault whose asset reads as OTHER is not claimed, and is reported; LIVE is claimed',
    [(() => { const p = plan({ cfg: { ...cfgD, acc_scaled: 10n * AC.ACC_SCALE }, records: [act(0, 1)], assets: { [A(0)]: 'other' }, tokens: toks(1), nowSec: 0 })
       return [p.claims.length, p.problems.length] })(),
     plan({ cfg: { ...cfgD, acc_scaled: 10n * AC.ACC_SCALE }, records: [act(0, 1)], assets: { [A(0)]: 'live' }, tokens: toks(1), nowSec: 0 }).claims.length],
    [[0, 1], 1])
  t('L2: an ELIGIBLE waiting vault read as OTHER is not pre-joined, so NO distribution is planned (JoinWaitingFirst), and it is reported',
    (() => { const p = plan({ cfg: { ...cfgD, dist_epoch: 1n, pending_count: 1n }, records: [act(0, 1), rec(1, { level: 1, pending: true, request_epoch: 0n })],
        assets: { [A(0)]: 'live', [A(1)]: 'other' }, tokens: toks(2), pool: { ...pool0, amount: 40n }, nowSec: 100 })
      return [p.preJoins.length, p.distribute, p.problems.some(x => /eligible to join/.test(x))] })(), [0, false, true])
  // L3: the tick, planned against this pass's retirements.
  t('L3: nobody joined, the ONLY this-epoch requester is bare-burned and retired this pass: NO tick (it would fail NoActiveVaults)',
    (() => { const p = plan({ cfg: { ...cfg0, monthly_secs: 100n, pending_count: 1n, pending_this_epoch: 1n },
        records: [rec(0, { level: 1, pending: true, request_epoch: 0n })], assets: { [A(0)]: 'burned' }, nowSec: 100 })
      return [p.retireBurned, p.distribute] })(), [['Rec0'], false])
  t('L3: ...with a LIVE co-requester the tick still runs, and only the live one joins after it',
    (() => { const p = plan({ cfg: { ...cfg0, monthly_secs: 100n, pending_count: 2n, pending_this_epoch: 2n },
        records: [rec(0, { level: 1, pending: true, request_epoch: 0n }), rec(1, { level: 1, pending: true, request_epoch: 0n })],
        assets: { [A(0)]: 'burned', [A(1)]: 'live' }, nowSec: 100 })
      return [p.distributeKind, p.joins.map(([r]) => r)] })(), ['tick', ['Rec1']])
  // L4: SATS, not batch counts. MEASURED BEFORE THE FIX: removing `boost` and
  // `carry` from the owed line left both BOOST arms above green.
  t('L4: the expired boost and the plain vault are each owed EXACTLY 20 sats (40 over the post-expiry weight 4)',
    (() => { const p = plan({ cfg: { ...cfgD, total_active_weight: 6n, dist_epoch: 3n }, records: [act(0, 1), boosted(1, 3n)], tokens: toks(2), pool: { ...pool0, amount: 40n }, nowSec: 100 })
      return [String(p.owed.Rec0), String(p.owed.Rec1)] })(), ['20', '20'])
  t('L4: the live boost is owed EXACTLY 29 (4 x 6 + 5 carried); its level weight alone would give 12',
    String(plan({ cfg: { ...cfgD, acc_scaled: 6n * AC.ACC_SCALE, total_active_weight: 4n, dist_epoch: 1n },
      records: [boosted(0, 5n, { carry_scaled: 5n * AC.ACC_SCALE })], tokens: toks(1), nowSec: 0 }).owed.Rec0), '29')
  t('L4: the threshold is one whole sat: owed exactly 1 is claimed, a scaled unit short of it is not',
    [plan({ cfg: { ...cfgD, acc_scaled: AC.ACC_SCALE / 2n }, records: [act(0, 1)], tokens: toks(1), nowSec: 0 }).claims.length,
     plan({ cfg: { ...cfgD, acc_scaled: AC.ACC_SCALE / 2n - 1n }, records: [act(0, 1)], tokens: toks(1), nowSec: 0 }).claims.length], [1, 0])
  // L9: a frozen revenue account is reported, never split into the same refusal.
  t('L9: a FROZEN revenue account with a balance plans NO split and reports it; an unfrozen one splits',
    [(() => { const p = plan({ cfg: cfgD, revenue: { state: 'ok', amount: 1000n, frozen: true }, nowSec: 100 }); return [p.split, p.problems.some(x => /revenue .*FROZEN/.test(x))] })(),
     plan({ cfg: cfgD, revenue: { state: 'ok', amount: 1000n, frozen: false }, nowSec: 100 }).split], [[false, true], true])
  // I1: an unrevealed bare burn is retired now, not at its turn to reveal.
  t('I1: an UNREVEALED bare-burned vault is retired (retire_burned needs no level); a live unrevealed one is not',
    [plan({ records: [rec(0)], assets: { [A(0)]: 'burned' } }).retireBurned, plan({ records: [rec(0)], assets: { [A(0)]: 'live' } }).retireBurned], [['Rec0'], []])
  // L14: the floor is sized from the plan; the honeypot warning once a day.
  {
    const reveals = plan({ records: [...Array(60)].map((_, i) => rec(i, { entropy_set: true, mint_index: BigInt(i) })), slot: 1001 })
    const cost = CR.planCostLamports(reveals)
    t('L14: 60 reveals cost 60 fees plus 60 attribute rents (about 0.0067 SOL), more than the bare 0.005 SOL floor',
      [reveals.reveal.length, String(cost), cost > CR.FEE_FLOOR_LAMPORTS], [60, String(60n * (CR.SIG_FEE_LAMPORTS + CR.REVEAL_RENT_LAMPORTS)), true])
    t('L14: a balance between the floor and that plan\'s cost is REFUSED for it, and runs a cheap plan',
      [CR.judgeFeePayer(6_000_000n, { need: cost }).ok, CR.judgeFeePayer(6_000_000n, { need: CR.planCostLamports(plan({})) }).ok], [false, true])
    t('L14: the over-ceiling warning is due once a day, not every pass (never warned: due; 1 h ago: not; 25 h ago: due)',
      [CR.warnDue(null, 1e9), CR.warnDue(1e9 - 3600, 1e9), CR.warnDue(1e9 - 25 * 3600, 1e9)], [true, false, true])
  }
  // M3: the crank stamps the file the alarm reads, on a LIVE full pass only.
  {
    const cs = fsx.readFileSync('/opt/cbob-vaults/bank/crank.mjs', 'utf8'), as = fsx.readFileSync('/opt/cbob-vaults/bank/alarm.mjs', 'utf8')
    const beat = "CBOB_CRANK_HEARTBEAT || '/opt/cbob-vaults/bank/.crank-heartbeat'"
    t('M3: the crank writes the heartbeat the alarm reads (same env var, same default path)', [cs.includes(beat), as.includes(beat)], [true, true])
    t('M3: ...only AFTER the dry-run return, and only on the full pass (not the reveal lane)',
      cs.indexOf("if (!LIVE) {") < cs.indexOf(beat) && /if \(!REVEAL_ONLY\) \{\s*const BEAT/.test(cs), true)
  }

  // ══ ROUND 24: the crank's findings, each both ways ══
  {
    const cs = fsx.readFileSync('/opt/cbob-vaults/bank/crank.mjs', 'utf8')
    // L1: the money-instruction races. MEASURED BEFORE THE FIX: BENIGN matched
    // none of NothingToSplit, NothingToDistribute, BoostsExpireFirst,
    // JoinWaitingFirst or PoolShort, so a stranger's hourly split before :37, or a
    // host's in-line monthly run between plan and send, paged "action failed".
    t('L1: a stranger\'s split between plan and send (NothingToSplit) is benign',
      CR.BENIGN.test('Error Code: NothingToSplit'), true)
    const was = { dist_epoch: 4n, last_distribute_at: 100n }
    const moved = { dist_epoch: 5n, last_distribute_at: 200n }
    t('L1: a refused distribute with the epoch MOVED since the plan is benign, for each race code',
      ['NothingToDistribute', 'BoostsExpireFirst', 'JoinWaitingFirst'].map(c => CR.judgeDistributeRefusal(`Error Code: ${c}`, was, moved)), ['benign', 'benign', 'benign'])
    t('L1: ...the same codes with the epoch UNMOVED are a failure (our plan was wrong), and so is an unreadable re-read',
      [...['NothingToDistribute', 'BoostsExpireFirst', 'JoinWaitingFirst'].map(c => CR.judgeDistributeRefusal(`Error Code: ${c}`, was, { ...was })),
       CR.judgeDistributeRefusal('Error Code: NothingToDistribute', was, null)], ['fail', 'fail', 'fail', 'fail'])
    t('L1: ...and PoolShort is a failure even with the epoch moved (a pool short of what it owes is never a race)',
      CR.judgeDistributeRefusal('Error Code: PoolShort', was, moved), 'fail')
    t('L1: crank.mjs re-reads the config and judges a refused distribute (not a bare run())',
      /judgeDistributeRefusal\(lastFailure, cfg, fresh\)/.test(cs) && !/await run\('distribute/.test(cs), true)
    // L2: the reveal's attribute list, and the split's decimals.
    t('L2: a BURNED asset is revealed with [] ; a LIVE one is read; an OTHER (null read) is SKIPPED, never sent with []',
      ['burned', 'live', 'other', undefined].map(CR.revealAttrSource), ['empty', 'read', 'skip', 'skip'])
    // L2's "breaks the reveal run on a skip" is RUN, not read: R43 V43o-3, beside R39 C01.
    t('L2: the payment mint\'s decimals must be ONE BYTE (a null read made Buffer.from([undefined]) = 00, decimals 0)',
      [CR.splitDecimalsByte(8), CR.splitDecimalsByte(0), CR.splitDecimalsByte(undefined), CR.splitDecimalsByte(256), Buffer.from([undefined]).toString('hex')],
      [8, 0, null, null, '00'])
    t('L2: ...and crank.mjs refuses the split when it is not', /plan\.split && payDecimals === null/.test(cs), true)
    // L3: both destinations of the split, read and judged.
    {
      const rev = { state: 'ok', amount: 1000n, frozen: false }
      const pl = o => plan({ cfg: cfgD, revenue: rev, nowSec: 100, ...o })
      t('L3: a FROZEN pool, a FROZEN Squads account and an ABSENT Squads account each plan NO split, with one problem naming it',
        [pl({ pool: { ...pool0, frozen: true } }), pl({ bank: { ...bank0, frozen: true } }), pl({ bank: { state: 'absent', amount: 0n } })]
          .map(p => [p.split, p.problems.filter(x => /cannot be split/.test(x)).length,
            /(community pool|CBOBTC Squads)'s cbBTC account is (FROZEN|absent)/.test(p.problems.join(' '))]),
        [[false, 1, true], [false, 1, true], [false, 1, true]])
      t('L3: ...an ABSENT pool plans no split either (measured before the fix: split:true)',
        pl({ pool: { state: 'absent', amount: 0n } }).split, false)
      t('L3: ...a blocked split does NOT count toward the distribution (it failed NothingToDistribute at the month boundary)',
        pl({ bank: { ...bank0, frozen: true }, pool: { ...pool0, amount: 0n } }).distribute, false)
      t('L3: ...and all three healthy: the split is planned and counted', [pl({}).split, pl({ pool: { ...pool0, amount: 0n } }).distribute], [true, true])
      t('L3: crank.mjs reads the Squads account and passes it to the planner', /readTokenAccount\(bankInfo\)/.test(cs) && /revenue, bank \}/.test(cs), true)
    }
    // L6: the fee floor, both defects.
    {
      const M = 1_000_000n
      t('L6a: all four of funded/short x above/below the 0.25 SOL ceiling (short above the ceiling was ok:true)',
        [CR.judgeFeePayer(300n * M, { need: 260n * M }), CR.judgeFeePayer(251n * M, { need: 260n * M }),
         CR.judgeFeePayer(50n * M, { need: 7n * M }), CR.judgeFeePayer(6n * M, { need: 7_280_000n })].map(j => [j.ok, !!j.warn]),
        [[true, true], [false, false], [true, false], [false, false]])
      // 1,100 captures cost 5.5 M lamports in fees, over the 5 M floor, so the
      // balance below is exactly the captures plus five reveals and one lamport.
      const big = plan({ records: [...[...Array(1100)].map((_, i) => rec(i, { reveal_slot: 900n, mint_index: BigInt(i + 100) })),
        ...[...Array(60)].map((_, i) => rec(i + 1100, { entropy_set: true, mint_index: BigInt(i) }))], slot: 1000 })
      const each = CR.SIG_FEE_LAMPORTS + CR.REVEAL_RENT_LAMPORTS
      // Round 30 (L2): the reveals keep the floor in reserve, so the balance that
      // buys exactly five is the captures, the floor, five reveals and a lamport.
      const b5 = CR.budgetPlan(big, 1100n * CR.SIG_FEE_LAMPORTS + CR.FEE_FLOOR_LAMPORTS + 5n * each + 1n)
      t('L6b: a key short of the reveals still sends its captures, and as many reveals (in mint order) as it can pay for',
        [big.capture.length, big.reveal.length, b5.ok, b5.plan.capture.length, b5.plan.reveal.length, b5.dropped, b5.plan.reveal[0] === big.reveal[0]],
        [1100, 60, true, 1100, 5, 55, true])
      t('L6b: ...a key that covers everything drops nothing, and one short of even the captures is refused',
        [CR.budgetPlan(big, 10n ** 9n).dropped, CR.budgetPlan(big, CR.FEE_FLOOR_LAMPORTS - 1n).ok], [0, false])
      {
        // ROUND 30 (L2), both ways: a budgeted pass never leaves the key below
        // the floor through reveals, and a key BELOW the floor still sends every
        // capture it can pay for (it used to send nothing at all).
        const small = plan({ records: [...[...Array(10)].map((_, i) => rec(i, { reveal_slot: 900n, mint_index: BigInt(i + 100) })),
          ...[...Array(60)].map((_, i) => rec(i + 10, { entropy_set: true, mint_index: BigInt(i) }))], slot: 1000 })
        const at = CR.budgetPlan(small, CR.FEE_FLOOR_LAMPORTS), under = CR.budgetPlan(small, CR.FEE_FLOOR_LAMPORTS - 1n)
        // Review 30: a key covering the WHOLE plan by a lamport used to run every
        // reveal and end near zero; it now keeps the floor too.
        const whole = CR.budgetPlan(small, CR.planCostLamports(small) + 1n)
        const spent = p => CR.planCostLamports(p.plan)
        t('R30 L2: at the floor the captures run and no reveal spends below it; under the floor the captures still run, with a warning',
          [at.ok, at.plan.capture.length, CR.FEE_FLOOR_LAMPORTS - spent(at) >= 0n && at.plan.reveal.length === 0,
           under.ok, under.plan.capture.length, under.plan.reveal.length, /below the .* floor/.test(under.warn ?? ''), under.warnKind,
           CR.planCostLamports(small) + 1n - spent(whole) >= CR.FEE_FLOOR_LAMPORTS, whole.dropped > 0],
          [true, 10, true, true, 10, 0, true, 'floor', true, true])
      }
      t('L6b: crank.mjs budgets the plan and pages the reveals it dropped', /budgetPlan\(plan, /.test(cs) && /if \(fee\.dropped\) failures\.push/.test(cs), true)
    }
    // I1: a retirement frees what the retiring vault was owed.
    {
      const S = AC.ACC_SCALE
      // Vault 0 (burned, active, Level I) is owed 10 sats; vault 1 is owed 10 too.
      // The pool holds exactly the 20 it owes, so before the retirement nothing is
      // undistributed, and after it vault 0's 10 are.
      const st = { cfg: { ...cfgD, acc_scaled: 5n * S, total_active_weight: 4n, owed_scaled: 20n * S },
        records: [act(0, 1), act(1, 1)], assets: { [A(0)]: 'burned', [A(1)]: 'live' }, tokens: toks(2), pool: { ...pool0, amount: 20n }, nowSec: 100 }
      t('I1: retiring an owed vault frees its share BEFORE our distribution, so the pass plans it (it was left to a claim\'s in-line run)',
        (() => { const p = plan(st); return [p.retireBurned, p.distribute, p.distributeKind, String(p.owed.Rec1)] })(), [['Rec0'], true, 'credit', '20'])
      t('I1: ...with nothing retiring, the same full pool plans no distribution', plan({ ...st, assets: { [A(0)]: 'live', [A(1)]: 'live' } }).distribute, false)
    }
    // I2: the chain's clock.
    {
      const clk = Buffer.alloc(40); clk.writeBigInt64LE(1_800_000_123n, 32)
      t('I2: the Clock sysvar\'s unix_timestamp is read at byte 32; a short or empty account is null',
        [CR.clockUnixTimestamp(clk), CR.clockUnixTimestamp(Buffer.alloc(8)), CR.clockUnixTimestamp(null)], [1_800_000_123, null, null])
      t('I2: crank.mjs plans against the chain clock without a wall-clock fallback', /nowSec: chainSec,/.test(cs), true)
    }
    // H1, the crank's half: one stream per lane, the full list, a recovery.
    {
      const f = ['claim batch 1 (14)', 'claim batch 2 (14)', 'distribute (monthly, free)', 'reveal X']
      const n1 = CR.crankNotices({ lane: 'full', failures: f })
      t('H1 crank: a failing pass pages its OWN lane\'s stream with EVERY failure (it sent the first three on one shared label)',
        [n1.failing, n1.notices.map(n => n.label), f.every(x => n1.notices[0].text.includes(x)), n1.notices[0].urgent], [true, ['cbob-vault-crank:full'], true, false])
      t('H1 crank: the first CLEAN live pass after a failing one sends that lane a RECOVERY; a clean pass after a clean one sends nothing',
        [CR.crankNotices({ lane: 'reveal', prevFailing: true }).notices.map(n => [n.label, /RECOVERED/.test(n.text)]), CR.crankNotices({ lane: 'reveal' }).notices],
        [[['cbob-vault-crank:reveal', true]], []])
      t('H1 crank: crank.mjs labels every notify per lane or per condition (no bare `cbob-vault-crank` label left)',
        [/'cbob-vault-crank'\]/.test(cs), /crankNotices\(\{ lane, failures/.test(cs)], [false, true])
    }
  }
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
  const p = PO.draftPost({ mintIndex: 6, level: 2, released: [{ mint: L.CBBTC_MINT, amount: 21000n }] })
  t('the draft passes every copy rule', p.problems, [])
  t('...and states only the figures read off the chain', p.x, 'Vault No. 0007 (Level II) has been redeemed. 0.00021 BTC was released to its holder. The vault no longer exists.')
  t('the poster has no sender in it (asserted in its own selftest too)',
    /api\.x\.com|zernio/i.test(fsx.readFileSync('/opt/cbob-vaults/bank/redemption-poster.mjs', 'utf8').split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l)).filter(l => !/new RegExp|SENDER/.test(l)).join('\n')), false)
}

console.log('── round 25: the off-chain findings, each both ways ──')
{
  const W3 = await import('@solana/web3.js')
  const SPLT = await import('@solana/spl-token')
  const { PublicKey: PK, Keypair: KP, ComputeBudgetProgram: CB, SystemProgram: SP } = W3
  const T = 1_800_000_000, H = 3600
  const thr = fn => { try { fn(); return 'ok' } catch (e) { return e.message } }
  const athr = async fn => { try { await fn(); return 'ok' } catch (e) { return e.message } }
  const op = new PK('bipP7uK5aQDsrChYA8hpZ1Thb8BCw7emRGuEkLkHg6G')
  const stranger = KP.generate().publicKey
  const ataOf = (mint, owner) => PK.findProgramAddressSync([owner.toBuffer(), SW.TOKEN.toBuffer(), mint.toBuffer()], SW.ATA_PROGRAM)[0]
  const rvSrc = fsx.readFileSync('/opt/cbob-vaults/bank/revenue.mjs', 'utf8')
  const almSrc = fsx.readFileSync('/opt/cbob-vaults/bank/alarm.mjs', 'utf8')
  const rvCode = rvSrc.replace(/^\s*(\/\/|\*).*$/gm, '')

  // ── fixtures: two pools and two prices, as the accounts carry them ──
  const BTC = 8592910904675n
  const pythAcc = (feed, price, publishTime, conf = price / 10_000n) => { const d = Buffer.alloc(134)
    d[40] = 1; Buffer.from(feed, 'hex').copy(d, 41)
    d.writeBigInt64LE(price, 73); d.writeBigUInt64LE(conf, 81); d.writeInt32LE(-8, 89); d.writeBigInt64LE(BigInt(publishTime), 93)
    return { owner: SW.PYTH.receiver, data: d } }
  const orcaAcc = spot => { const d = Buffer.alloc(653); SW.WSOL.toBuffer().copy(d, 101); SW.CBBTC.toBuffer().copy(d, 181)
    d.writeUInt16LE(16, 41); d.writeInt32LE(-88733, 81)
    const s = BigInt(Math.round(Math.sqrt(spot) * 2 ** 64)); d.writeBigUInt64LE(s & ((1n << 64n) - 1n), 65); d.writeBigUInt64LE(s >> 64n, 73)
    return { owner: SW.ORCA.program, data: d } }
  const meteoraAcc = (activeId, binStep = 15) => { const d = Buffer.alloc(904); SW.CBBTC.toBuffer().copy(d, 88); SW.WSOL.toBuffer().copy(d, 120)
    d.writeInt32LE(activeId, 76); d.writeUInt16LE(binStep, 80); return { owner: SW.METEORA.program, data: d } }
  const clockAcc = sec => { const d = Buffer.alloc(40); d.writeBigInt64LE(BigInt(sec), 32); return { owner: new PK('Sysvar1111111111111111111111111111111111111'), data: d } }
  /** The oracle price of SOL (expo -8) that makes the oracle `target` sats per lamport. */
  const solFor = target => BigInt(Math.round(target * Number(BTC) * 10))
  const stubConn = ({ orca, meteora, sol, btc, clock = clockAcc(T), bitmap = { owner: SW.METEORA.program, data: Buffer.alloc(8) } }) => {
    const by = { [SW.ORCA.pool.toBase58()]: orca, [SW.METEORA.pool.toBase58()]: meteora, [SW.pythAccount(SW.PYTH.SOL_USD).toBase58()]: sol,
      [SW.pythAccount(SW.PYTH.BTC_USD).toBase58()]: btc, [SW.meteoraBitmap().toBase58()]: bitmap, [W3.SYSVAR_CLOCK_PUBKEY.toBase58()]: clock }
    return { getMultipleAccountsInfo: async keys => keys.map(k => by[k.toBase58()] ?? null) } }
  const quiet = () => {}
  const MSPOT = SW.meteoraSpot({ binStep: 15, activeId: 5920 })
  const fresh = (o = {}) => ({ orca: orcaAcc(MSPOT), meteora: meteoraAcc(5920), sol: pythAcc(SW.PYTH.SOL_USD, solFor(MSPOT), T - 54),
    btc: pythAcc(SW.PYTH.BTC_USD, BTC, T - 54), ...o })

  // ── L1: THE JUDGE JUDGES THE SWAP ──
  // The round-24 judge, re-stated verbatim, so the arms below are shown able to fail.
  const judge24 = (ixs, owner, venue) => {
    const allowed = new Set([CB.programId, SP.programId, SW.TOKEN, SW.ATA_PROGRAM, venue === 'orca' ? SW.ORCA.program : SW.METEORA.program].map(k => k.toBase58()))
    const problems = []
    for (const ix of ixs) {
      if (!allowed.has(ix.programId.toBase58())) problems.push('foreign')
      for (const k of ix.keys) if (k.isSigner && !k.pubkey.equals(owner)) problems.push('signer')
    }
    const swaps = ixs.filter(ix => ix.programId.equals(venue === 'orca' ? SW.ORCA.program : SW.METEORA.program))
    if (swaps.length !== 1) problems.push('swaps')
    const pool = venue === 'orca' ? SW.ORCA.pool : SW.METEORA.pool
    if (swaps[0] && !swaps[0].keys.some(k => k.pubkey.equals(pool))) problems.push('pool')
    const transfers = ixs.filter(ix => ix.programId.equals(SP.programId))
    if (transfers.length !== 1) problems.push('transfers')
    const ownWsol = ataOf(SW.WSOL, owner)
    if (transfers[0] && !transfers[0].keys[1]?.pubkey.equals(ownWsol)) problems.push('wrap dest')
    const closes = ixs.filter(ix => ix.programId.equals(SW.TOKEN) && ix.data[0] === 9)
    if (closes.length !== 1 || !closes[0].keys[0].pubkey.equals(ownWsol) || !closes[0].keys[1].pubkey.equals(owner)) problems.push('close')
    return problems
  }
  const w = SW.readWhirlpool(orcaAcc(MSPOT)), lp = SW.readLbPair(meteoraAcc(5920))
  const LAM = 2_000_000_000n, MIN = 2_771_000n
  const amounts = { lamportsIn: LAM, minSats: MIN }
  const cl = ix => ({ programId: ix.programId, data: Buffer.from(ix.data), keys: ix.keys.map(k => ({ ...k })) })
  const TAMPERS = {
    'the output account (swap key 5) handed to a stranger': [(x, v) => { x[5].keys[5].pubkey = ataOf(SW.CBBTC, stranger) }, /output account is not the operator's own cbBTC/],
    'a min-out of 0': [x => { x[5].data.writeBigUInt64LE(0n, 16) }, /on-chain floor is 0 sats, not the oracle floor/],
    'the amount in changed': [x => { x[5].data.writeBigUInt64LE(LAM * 2n, 8) }, /the swap sells 4000000000 lamports, not 2000000000/],
    'the direction flipped (Orca a_to_b = 0; Meteora in and out swapped)': [(x, v) => { if (v === 'orca') x[5].data[41] = 0
      else { const k4 = x[5].keys[4]; x[5].keys[4] = x[5].keys[5]; x[5].keys[5] = k4 } }, null],
    'a setComputeUnitPrice of 25e9 µlamports appended': [x => { x.push(CB.setComputeUnitPrice({ microLamports: 25_000_000_000n })) }, /priority fee/],
    "a Token Approve of the operator's cbBTC to a stranger": [x => { x.push(SPLT.createApproveInstruction(ataOf(SW.CBBTC, op), stranger, op, 10n ** 12n)) }, /a Token Approve: a swap uses only SyncNative and CloseAccount/],
    'the cbBTC ATA created for another owner': [x => { x[4] = SPLT.createAssociatedTokenAccountIdempotentInstruction(op, ataOf(SW.CBBTC, stranger), stranger, SW.CBBTC) }, /instruction 4 does not create the operator's own cbBTC account/],
    'the wrap inflated to 50 SOL': [x => { x[2] = SP.transfer({ fromPubkey: op, toPubkey: ataOf(SW.WSOL, op), lamports: 50_000_000_000n }) }, /the wrap moves 50000000000 lamports, not the 2000000000/],
  }
  for (const venue of ['orca', 'meteora']) {
    const honest = SW.swapInstructions({ venue, owner: op, lamportsIn: LAM, minSats: MIN, w, p: lp, bitmapExists: true })
    t(`L1: the honest ${venue} build passes the exact-sequence judge (seven instructions, amount and floor as told)`, SW.judgeSwapInstructions(honest, op, venue, amounts), [])
    const tampered = {}
    for (const [name, [apply, want]] of Object.entries(TAMPERS)) {
      const x = honest.map(cl); apply(x, venue); tampered[name] = x
      const re = want ?? (venue === 'orca' ? /not exact-input, a_to_b/ : /input account is not the operator's own wSOL/)
      const got = SW.judgeSwapInstructions(x, op, venue, amounts)
      t(`L1: ${venue}: ${name} is REFUSED, by name`, got.some(m => re.test(m)), true)
    }
    t(`L1: ${venue}: ...and the round-24 judge passed every one of those eight (so each arm above can fail)`,
      Object.values(tampered).map(x => judge24(x, op, venue).length), [0, 0, 0, 0, 0, 0, 0, 0])
  }
  t('L1: the judge judges nothing it was not told: no amount or floor is itself a refusal',
    ['orca', 'meteora'].map(v => SW.judgeSwapInstructions(SW.swapInstructions({ venue: v, owner: op, lamportsIn: LAM, minSats: MIN, w, p: lp, bitmapExists: true }), op, v).length > 0), [true, true])
  {
    const honest = SW.swapInstructions({ venue: 'orca', owner: op, lamportsIn: LAM, minSats: MIN, w, p: lp, bitmapExists: true })
    const cu = honest.map(cl); cu[0] = CB.setComputeUnitLimit({ units: 1_400_000 })
    const exactOut = honest.map(cl); exactOut[5].data[40] = 0
    const limit = honest.map(cl); limit[5].data.writeBigUInt64LE(0n, 24)
    t('L1: ...and a changed compute limit, an exact-OUTPUT Orca swap, or a moved price limit is refused too',
      [cu, exactOut, limit].map(x => SW.judgeSwapInstructions(x, op, 'orca', amounts).length > 0), [true, true, true])
  }
  t('L1: revenue.mjs and the fork tell the judge the amount and the floor they built with',
    [/judgeSwapInstructions\(ixs, operator\.publicKey, venue, \{ lamportsIn: amount, minSats: floor \}\)/.test(rvSrc)
      && /swapInstructions\(\{ venue, owner: operator\.publicKey, lamportsIn: amount, minSats: floor,/.test(rvSrc)
      // Round 44: the floor is the guaranteed one, raised ONLY by the rehearsal flag and only for Orca
      && /const floor = forceOrcaRefusal && venue === 'orca' \? guaranteed \* 2n : guaranteed\n/.test(rvSrc),
     (src => { const all = src.match(/judgeSwapInstructions\(/g) || [], told = src.match(/judgeSwapInstructions\(\w+, op\.publicKey, [^,()]+, (told|\{ lamportsIn)/g) || []
       return all.length >= 5 && all.length === told.length })(fsx.readFileSync('/opt/cbob-vaults/sim/swap-fork.mjs', 'utf8'))], [true, true])

  // ── L2: THE ORACLE'S AGE ON THE CHAIN'S CLOCK ──
  const oldSol = pythAcc(SW.PYTH.SOL_USD, solFor(MSPOT), T - 400), oldBtc = pythAcc(SW.PYTH.BTC_USD, BTC, T - 400)
  t('L2: market() judges a price 400 s old by the CHAIN clock: REFUSED, where the box clock 300 s behind called it 100 s old and passed it',
    [/400s old/.test(await athr(() => SW.market(stubConn(fresh({ sol: oldSol, btc: oldBtc })), LAM, quiet))),
     thr(() => SW.oracleFloor({ lamportsIn: LAM, sol: SW.readPyth(oldSol, SW.PYTH.SOL_USD), btc: SW.readPyth(oldBtc, SW.PYTH.BTC_USD), nowSec: T - 300 }))],
    [true, 'ok'])
  t('L2: a price stamped in the FUTURE of the chain clock is REFUSED past 30 s (an hour ahead used to pass); 30 s is not',
    [/FUTURE/.test(await athr(() => SW.market(stubConn(fresh({ sol: pythAcc(SW.PYTH.SOL_USD, solFor(MSPOT), T + 3600) })), LAM, quiet))),
     /FUTURE/.test(thr(() => SW.oracleFloor({ lamportsIn: LAM, sol: SW.readPyth(pythAcc(SW.PYTH.SOL_USD, solFor(MSPOT), T + 31), SW.PYTH.SOL_USD), btc: SW.readPyth(fresh().btc, SW.PYTH.BTC_USD), nowSec: T }))),
     thr(() => SW.oracleFloor({ lamportsIn: LAM, sol: SW.readPyth(pythAcc(SW.PYTH.SOL_USD, solFor(MSPOT), T + 30), SW.PYTH.SOL_USD), btc: SW.readPyth(fresh().btc, SW.PYTH.BTC_USD), nowSec: T }))],
    [true, true, 'ok'])
  t('L2: an absent, foreign-owned or truncated Clock sysvar REFUSES (never the box clock); oracleFloor with no clock refuses',
    [...await Promise.all([null, { ...clockAcc(T), owner: SW.ORCA.program }, { ...clockAcc(T), data: Buffer.alloc(8) }]
      .map(async c => /chain clock/.test(await athr(() => SW.market(stubConn(fresh({ clock: c })), LAM, quiet))))),
     /no chain clock/.test(thr(() => SW.oracleFloor({ lamportsIn: LAM, sol: SW.readPyth(fresh().sol, SW.PYTH.SOL_USD), btc: SW.readPyth(fresh().btc, SW.PYTH.BTC_USD), nowSec: undefined })))],
    [true, true, true, true])
  {
    const m = await SW.market(stubConn(fresh()), LAM, quiet)
    t('L2: a fresh price on readable pools: both venues usable, judged at the clock the chain gave', [m.venues, m.nowSec], [['orca', 'meteora'], T])
  }
  t('L2/L4: revenue.mjs reads no box clock for a price or a cooldown: it calls SW.market and SW.sweepCooldownOver on the Clock sysvar',
    [/Date\.now\(\)/.test(rvCode.replace(/new Date\(\)\.toISOString\(\)|Date\.parse\([^)]*\)/g, '')), /SW\.market\(conn, lamports\)/.test(rvSrc),
     /SW\.sweepCooldownOver\(\{ lastSweepAt: lastSweep, cooldownSecs: cooldown, chainNowSec: chainNow \}\)/.test(rvSrc),
     /clockUnixTimestamp\(\(await conn\.getAccountInfo\(SYSVAR_CLOCK_PUBKEY/.test(rvSrc), /async function market\(/.test(rvSrc)],
    [false, true, true, true, false])
  t('L2: swap.mjs reuses the crank\'s Clock decoder (round 24 I2) rather than a second one',
    [/import \{ clockUnixTimestamp \} from '\.\/crank\.mjs'/.test(fsx.readFileSync('/opt/cbob-vaults/bank/swap.mjs', 'utf8')), /readBigInt64LE\(32\)/.test(fsx.readFileSync('/opt/cbob-vaults/bank/swap.mjs', 'utf8'))], [true, false])

  // ── L3: A FAILED SEND, ASKED OF THE CHAIN ──
  const SIG = (globalThis.__bs58).encode(Buffer.alloc(64, 7))
  const preflight = new W3.SendTransactionError({ action: 'simulate', signature: '', transactionMessage: 'Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1772',
    logs: ['Program log: AnchorError occurred. Error Code: SweepTooSoon.'] })
  const onchain = new W3.SendTransactionError({ action: 'send', signature: SIG, transactionMessage: `Status: (${JSON.stringify({ err: { InstructionError: [5, { Custom: 6036 }] } })})` })
  const expired = new W3.TransactionExpiredBlockheightExceededError(SIG)
  const ROUND24 = /custom program error|Error Code:|Transaction simulation failed/
  t('L3: the round-24 regex read web3.js\'s own on-chain-failure and expiry errors as UNCONFIRMED (the defect), only preflight as refused',
    [preflight, onchain, expired].map(e => ROUND24.test(String(e.message) + (e.logs || []).join(' '))), [true, false, false])
  let asked = 0
  const st = v => async () => { asked++; if (v instanceof Error) throw v; return v }
  const failedSt = { slot: 9, confirmationStatus: 'confirmed', err: { InstructionError: [5, { Custom: 6036 }] } }
  const okSt = { slot: 9, confirmationStatus: 'finalized', err: null }
  const cls = async (e, s) => { const r = await SW.classifySendFailure(e, st(s)); return [r.outcome, r.sig === SIG] }
  t('L3: a preflight refusal is REFUSED without asking the chain',
    [(await SW.classifySendFailure(preflight, st(okSt))).outcome, asked], ['refused', 0])
  t('L3: landed and FAILED on chain (status err, confirmed) -> REFUSED, nothing moved: sendRejected for a sweep, the next venue for a swap',
    await cls(onchain, failedSt), ['refused', true])
  t('L3: expired and the chain has no status -> REFUSED (it never landed)', await cls(expired, null), ['refused', true])
  t('L3: a confirmation that failed on a transaction the chain says LANDED and succeeded -> LANDED (recorded, the cycle goes on)',
    [await cls(expired, okSt), await cls(onchain, { ...okSt, confirmationStatus: 'confirmed' })], [['landed', true], ['landed', true]])
  t('L3: only what the chain cannot settle stays OPEN: processed-only, no status without expiry, a failed lookup, no signature at all',
    [(await SW.classifySendFailure(expired, st({ ...failedSt, confirmationStatus: 'processed' }))).outcome,
     (await SW.classifySendFailure(onchain, st(null))).outcome,
     (await SW.classifySendFailure(onchain, st(new Error('fetch failed')))).outcome,
     (await SW.classifySendFailure(new Error('fetch failed'), st(okSt))).outcome],
    ['unknown', 'unknown', 'unknown', 'unknown'])
  t('L3: the signature is read from the message when the error object does not carry it',
    (await SW.classifySendFailure(new Error(`Transaction ${SIG} resulted in an error. Status: ({})`), st(failedSt))).sig, SIG)
  {
    const ledgerOf = rows => ({ cycles: rows })
    const iso = s => new Date(s * 1000).toISOString()
    const intentOnly = { startedAt: iso(T - 2 * H), intendedLamports: '5000000000' }
    const refusedRow = { ...intentOnly, sendRejected: true, refusedSig: SIG }
    t('L3: the intent row the old path left paged unreconciled_swap CRITICAL for SOL that never moved; the refused row is closed and quiet',
      [D.detectUnreconciledRevenue(ledgerOf([intentOnly]), { now: T * 1000 }).map(f => [f.kind, f.severity]),
       D.cycleIsOpen(refusedRow), D.detectUnreconciledRevenue(ledgerOf([refusedRow]), { now: T * 1000 })],
      [[['unreconciled_swap', 'CRITICAL']], false, []])
    const disc8 = [...(await import('crypto')).createHash('sha256').update('global:sweep_sol_for_swap').digest().subarray(0, 8)]
    t('L3: ...and if that judgement were ever wrong and the sweep HAD landed, the chain scan still pages it CRITICAL (no row claims it as a sweep)',
      D.detectUnledgeredSweeps([{ program: D.MINT_PROGRAM_ID, dataBytes: [...disc8, 5, 0, 0, 0, 0, 0, 0, 0] }], D.MINT_PROGRAM_ID, disc8,
        ledgerOf([refusedRow]), SIG, { blockTime: T - 2 * H, now: T }).map(f => [f.kind, f.severity]), [['unledgered_sweep', 'CRITICAL']])
    t('L3: revenue.mjs keeps a refused sweep\'s signature as `refusedSig`, never `sweepSig` (a refused row with a sweep is itself CRITICAL)',
      [/cycle\.refusedSig = verdict\.sig/.test(rvSrc), /sendRejected = true[\s\S]{0,400}cycle\.sweepSig = verdict\.sig[\s\S]{0,200}throw new Error\(`the sweep was REFUSED/.test(rvSrc),
       D.detectUnreconciledRevenue(ledgerOf([{ ...refusedRow, sweepSig: SIG, refusedSig: undefined }]), { now: T * 1000 }).map(f => f.kind)], [true, false, ['rejected_row_has_sweep']])
    // ROUND 37 (C04): `--audit`'s total. The actual expression, extracted.
    const sw = rvSrc.slice(rvSrc.indexOf('  const swept = l.cycles.reduce('), rvSrc.indexOf('\n', rvSrc.indexOf('  const swept = l.cycles.reduce(')))
    const sweptOf = new Function('l', sw + '; return swept')
    t('R37 C04: --audit counts a REFUSED sweep as nothing swept, a landed one in full, an open intent as intended',
      [sweptOf({ cycles: [refusedRow] }), sweptOf({ cycles: [{ sweptLamports: '7' }] }), sweptOf({ cycles: [{ intendedLamports: '5' }] })], [0n, 7n, 5n])
    // ROUND 37 (C07, refuted by measurement): a refused row that carries a sweep
    // signature can never make the sweep check silent: the ledger check pages it.
    const both = { ...refusedRow, sweepSig: SIG, refusedSig: undefined }
    t('R37 C07: a {sendRejected, sweepSig} row pages rejected_row_has_sweep CRITICAL in the same pass, so it can silence nothing',
      D.detectUnreconciledRevenue(ledgerOf([both]), { now: T * 1000 }).map(f => [f.kind, f.severity]), [['rejected_row_has_sweep', 'CRITICAL']])
  }
  t('L3: revenue.mjs sends BOTH failure paths (sweep and swap) through classifySendFailure, and no bare refusal regex is left',
    [(rvSrc.match(/SW\.classifySendFailure\(e, statusOf\(conn\)\)/g) || []).length, /custom program error\|Error Code:/.test(rvCode),
     /searchTransactionHistory: true/.test(rvSrc)], [2, false, true])

  // ── L4: THE CRON AND THE COOLDOWN ──
  const instSrc = fsx.readFileSync('/opt/cbob-vaults/scripts/cron-install.sh', 'utf8')
  /** Seconds between runs of a crontab line, for the shapes we write: `M * * * *`, `M *\/N * * *`, `M H * * *`. */
  const cronPeriod = line => { const [m, h, dom, mon, dow] = line.trim().split(/\s+/)
    if (!/^\d+$/.test(m) || dom !== '*' || mon !== '*' || dow !== '*') return null
    if (h === '*') return 3600
    const s = h.match(/^\*\/(\d+)$/); if (s) return Number(s[1]) * 3600
    return /^\d+$/.test(h) ? 86400 : null }
  const revLine = instSrc.split('\n').find(l => /bank\/revenue\.mjs\$REV_LIVE/.test(l) && /\$TAG revenue\s*$/.test(l))
  const ruledCooldown = Number(JSON.parse(fsx.readFileSync('/opt/cbob-vaults/launch/mainnet-init.json', 'utf8')).sweep_cooldown_secs.value)
  t('L4: the installed revenue line runs every REVENUE_CRON_PERIOD_SECS (hourly), SHORTER than the ruled cooldown',
    [cronPeriod(revLine || ''), cronPeriod(revLine || '') === D.REVENUE_CRON_PERIOD_SECS, cronPeriod(revLine || '') < ruledCooldown, ruledCooldown], [3600, true, true, 21600])
  t('L4: ...and the round-24 line (41 */6) is caught: its period EQUALS the cooldown, so every run lands a second early',
    [cronPeriod('41 */6 * * * cd x'), cronPeriod('41 */6 * * * cd x') < ruledCooldown], [21600, false])
  t('L4: sweepCooldownOver judges the CHAIN clock: over at last+cooldown, not a second before, never on an unreadable clock',
    [SW.sweepCooldownOver({ lastSweepAt: BigInt(T), cooldownSecs: 21600n, chainNowSec: T + 21600 }),
     SW.sweepCooldownOver({ lastSweepAt: BigInt(T), cooldownSecs: 21600n, chainNowSec: T + 21599 }),
     SW.sweepCooldownOver({ lastSweepAt: BigInt(T), cooldownSecs: 21600n, chainNowSec: null })], [true, false, false])
  const SOL1 = 1_000_000_000n
  const roy = o => D.detectUnsweptRoyalties({ lamports: 2n * SOL1 + 50_000_000n, reserve: '50000000', floor: '1000000000', nowSec: T,
    prevLamports: 2n * SOL1 + 50_000_000n, ...o }).findings.map(f => f.kind)
  t('L4: a cooldown voted up to the 24 h ceiling: a WORKING sweep (no fall for 25 h) is quiet, a dead one (27 h) still pages, and the old fixed grace paged the working one',
    [roy({ prevSince: T - 25 * H, cooldownSecs: 86400 }), roy({ prevSince: T - 27 * H, cooldownSecs: 86400 }), roy({ prevSince: T - 25 * H })],
    [[], ['royalties_unswept'], ['royalties_unswept']])
  t('L4: ...the ruled 6 h cooldown keeps the 24 h grace exactly (25 h still pages), and alarm.mjs passes the on-chain cooldown',
    [roy({ prevSince: T - 25 * H, cooldownSecs: 21600 }), roy({ prevSince: T - 23 * H, cooldownSecs: 21600 }),
     /cooldownSecs: cfg\['mint\.sweep_cooldown_secs'\]/.test(almSrc)], [['royalties_unswept'], [], true])

  // ── L6: THE SWAP'S PURE GATES CAN FAIL ──
  t('L6: orcaSpot is (sqrt_price / 2^64)^2, meteoraSpot the inverse bin power, deviationBps symmetric in bps',
    [SW.orcaSpot({ sqrtPrice: 1n << 64n }), SW.orcaSpot({ sqrtPrice: 1n << 63n }), SW.meteoraSpot({ binStep: 100, activeId: 0 }),
     Math.abs(SW.meteoraSpot({ binStep: 100, activeId: 2 }) - 1 / 1.0201) < 1e-12, SW.deviationBps(101, 100), SW.deviationBps(99, 100)], [1, 0.25, 1, true, 100, 100])
  for (const venue of ['orca', 'meteora']) {
    // The pool is fixed; the oracle is placed 99 and 101 bps from it, on both sides.
    const cases = [[1.0099, true], [0.9901, true], [1.0101, false], [0.9899, false]]
    const used = []
    for (const [k] of cases) {
      const oracle = MSPOT / k
      const m = await SW.market(stubConn(fresh({ sol: pythAcc(SW.PYTH.SOL_USD, solFor(oracle), T - 54),
        ...(venue === 'orca' ? { meteora: null } : { orca: null }) })), LAM, quiet)
      used.push(m.venues.includes(venue))
    }
    t(`L6: ${venue}: a pool 99 bps above / below the oracle is USED; 101 bps above / below is NOT (through market())`, used, cases.map(c => c[1]))
  }

  // ── L7: THE PROGRAM IDS, EVERY COPY ──
  const read = f => { try { return fsx.readFileSync(`/opt/cbob-vaults/${f}`, 'utf8') } catch { return '' } }
  const ID_SITES = [
    ['bank/alarm.mjs', /^const (SEAL|MINT|BURN|GOV|SWEEP)\s*= new PublicKey\('([^']*)'\)/gm, ['seal', 'mint', 'burn', 'gov', 'sweep']],
    ['bank/detectors.mjs', /^export const (MINT|BURN)_PROGRAM_ID = '([^']*)'/gm, ['mint', 'burn']],
    ['bank/revenue.mjs', /^const (MINT)_PROG = new PublicKey\('([^']*)'\)/gm, ['mint']],
    ['bank/selftest.mjs', /^const (BURN)_PROG = '([^']*)'$|^const (MINT)P = '([^']*)'$/gm, ['burn', 'mint']],
    ['programs/cbob-vaults/src/lib.rs', /^declare_id!\("()([^"]*)"\);/gm, ['seal']],
    ['programs/cbob-vault-mint/src/lib.rs', /^declare_id!\("()([^"]*)"\);/gm, ['mint']],
    ['programs/cbob-vault-burn/src/lib.rs', /^declare_id!\("()([^"]*)"\);/gm, ['burn']],
    ['programs/cbob-vault-gov/src/lib.rs', /^declare_id!\("()([^"]*)"\);/gm, ['gov']],
  ]
  const CRATES = { seal: 'cbob_vaults', mint: 'cbob_vault_mint', burn: 'cbob_vault_burn', gov: 'cbob_vault_gov', sweep: 'cbob_vault_sweep' }
  // PUBLIC KEYS ONLY, and no signer is built: the ed25519 public key is derived
  // from the file's 32-byte seed by node's crypto (and must equal the public half
  // the file stores). Nothing derived from the seed is printed or kept.
  const CRY = await import('crypto')
  const pubOfKeypairFile = file => { const b = Buffer.from(JSON.parse(fsx.readFileSync(file, 'utf8')))
    if (b.length !== 64) return 'MALFORMED'
    const seedKey = CRY.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), b.subarray(0, 32)]), format: 'der', type: 'pkcs8' })
    const pub = Buffer.from(CRY.createPublicKey(seedKey).export({ format: 'jwk' }).x, 'base64url')
    return pub.equals(b.subarray(32)) ? (globalThis.__bs58).encode(pub) : 'INCONSISTENT' }
  const keypairIds = Object.fromEntries(Object.entries(CRATES).map(([role, crate]) => { try {
    return [role, pubOfKeypairFile(`/opt/cbob-vaults/target/deploy/${crate}-keypair.json`)]
  } catch { return [role, 'UNREADABLE'] } }))
  const idGate = (srcs, kps) => {
    const out = []
    for (const [f, re, roles] of ID_SITES) {
      const found = [...(srcs[f] ?? '').matchAll(re)].map(m => { const g = m.slice(1).filter(x => x !== undefined)
        return [(g.length === 2 && g[0] === '' ? roles[0] : g[0].toLowerCase()), g[1]] })
      if (JSON.stringify(found.map(x => x[0]).sort()) !== JSON.stringify([...roles].sort())) out.push(`${f}: the copies found are [${found.map(x => x[0])}], not [${roles}]`)
      for (const [role, v] of found) if (v !== L.PROGRAM_IDS[role]) out.push(`${f}: ${role} is ${v}, not layout.mjs's ${L.PROGRAM_IDS[role]}`)
    }
    for (const [role, v] of Object.entries(kps)) if (v !== L.PROGRAM_IDS[role]) out.push(`target/deploy ${CRATES[role]}: the keypair's public key is ${v}, not ${L.PROGRAM_IDS[role]}`)
    // An UNNAMED copy: any base58 literal keeping an id's first four characters but not equal to it.
    const ids = Object.values(L.PROGRAM_IDS)
    for (const [f, src] of Object.entries(srcs)) for (const m of src.matchAll(/['"`]([1-9A-HJ-NP-Za-km-z]{32,44})['"`]/g))
      if (!ids.includes(m[1]) && ids.some(id => id.slice(0, 4) === m[1].slice(0, 4))) out.push(`${f}: ${m[1]} looks like a mistyped program id`)
    return out
  }
  const srcs = Object.fromEntries([...new Set([...ID_SITES.map(s => s[0]), 'bank/layout.mjs', 'bank/crank.mjs', 'bank/swap.mjs', 'bank/redemption-poster.mjs', 'bank/lock.mjs', 'bank/spl.mjs', 'bank/anchor.mjs', 'bank/accrual.mjs', 'bank/sigwalk.mjs', 'scripts/check-launch-params.mjs', 'sim/swap-fork.mjs'])].map(f => [f, read(f)]))
  t('L7: every copy of the five program ids (alarm, detectors, revenue, selftest), the four declare_id! and each target/deploy keypair\'s public key equals layout.mjs PROGRAM_IDS',
    [idGate(srcs, keypairIds), Object.keys(keypairIds).length], [[], 5])
  const bump = v => v.slice(0, -1) + (v.at(-1) === '2' ? '3' : '2')
  const mutated = []
  for (const [f, re, roles] of ID_SITES) for (const m of srcs[f].matchAll(re)) {
    const v = m.slice(1).filter(x => x !== undefined).at(-1)
    const got = idGate({ ...srcs, [f]: srcs[f].slice(0, m.index) + m[0].replace(v, bump(v)) + srcs[f].slice(m.index + m[0].length) }, keypairIds)
    mutated.push(got.some(x => x.startsWith(f)))
  }
  t('L7: ...one character mutated in ANY of those copies turns it red, naming the file (each of 14 copies)', [mutated.length, mutated.every(Boolean)], [14, true])
  t('L7: ...and a keypair whose public key differs, or cannot be read, is named',
    [idGate(srcs, { ...keypairIds, sweep: bump(keypairIds.sweep) }).some(x => /cbob_vault_sweep/.test(x)), idGate(srcs, { ...keypairIds, gov: 'UNREADABLE' }).some(x => /cbob_vault_gov/.test(x))], [true, true])
  t('L7: ...and an UNNAMED copy keeping an id\'s 4-character prefix is caught (a stray literal in any scanned file)',
    idGate({ ...srcs, 'bank/crank.mjs': srcs['bank/crank.mjs'] + `\nconst X = '${bump(L.PROGRAM_IDS.mint)}'\n` }, keypairIds).some(x => /bank\/crank\.mjs: .* looks like a mistyped program id/.test(x)), true)

  // ── I1: THE RETURN'S BLOCK TIME ANCHORS THE SPLIT ──
  {
    const R0 = T - H
    const row = { startedAt: new Date((R0 - 600) * 1000).toISOString(), sweepSig: 'sw1', sweptLamports: '5', quotedSats: '5000',
      returnedAt: new Date(R0 * 1000).toISOString(), returnedSats: '5000', returnSig: 'r' }
    const early = [{ sig: 'early', blockTime: R0 - 50, total: '6000' }], later = [{ sig: 'late', blockTime: R0, total: '6000' }]
    t('I1: with the return\'s block time, a split 50 s BEFORE it does not close the cycle; one at it does; the legacy row (no block time) still takes the early one',
      [D.closesCycle({ ...row, returnBlockTime: R0 }, early), D.closesCycle({ ...row, returnBlockTime: R0 }, later)?.sig, D.closesCycle(row, early)?.sig],
      [null, 'late', 'early'])
    t('I1: ...the alarm agrees: cycle_unsplit stays for the early split, and closes on the later one',
      [D.detectUnreconciledRevenue({ cycles: [{ ...row, returnBlockTime: R0 }] }, { now: T * 1000, splits: early }).map(f => f.kind),
       D.detectUnreconciledRevenue({ cycles: [{ ...row, returnBlockTime: R0 }] }, { now: T * 1000, splits: later }).map(f => f.kind)], [['cycle_unsplit'], []])
    t('I1: revenue.mjs records returnBlockTime off the return signature, and fills it in the recovery BEFORE closesCycle runs',
      [/cycle\.returnBlockTime = await blockTimeOf\(conn, cycle\.returnSig\)/.test(rvSrc),
       rvSrc.indexOf('c.returnBlockTime = bt') > 0 && rvSrc.indexOf('c.returnBlockTime = bt') < rvSrc.indexOf('closesCycle(c, splits')], [true, true])
  }

  // ── I2: THE THIRD-PARTY PROGRAMS THE SWAP RESTS ON ──
  t('I2: the watched third-party programs are exactly swap.mjs\'s pins (Orca, Meteora, Pyth receiver and push)',
    D.THIRD_PARTY_PROGRAMS.map(([, id]) => id), [SW.ORCA.program, SW.METEORA.program, SW.PYTH.receiver, SW.PYTH.push].map(k => k.toBase58()))
  t('I2: a change to any one\'s bytes or upgrade authority is HIGH drift (routine upgrades, so not CRITICAL); NO_PROGRAMDATA -> bytes too',
    [...D.THIRD_PARTY_PROGRAMS.flatMap(([n]) => [D.detectConfigDrift({ [`prog.${n}.hash`]: 'a' }, { [`prog.${n}.hash`]: 'b' })[0]?.severity,
      D.detectConfigDrift({ [`prog.${n}.upgrade_authority`]: 'K1' }, { [`prog.${n}.upgrade_authority`]: 'K2' })[0]?.severity]),
     D.detectConfigDrift({ 'prog.orca.hash': 'NO_PROGRAMDATA' }, { 'prog.orca.hash': 'b' })[0]?.severity], Array(9).fill('HIGH'))
  t('I2: ...a baseline from before round 25 (never recorded) is not drift; an unchanged one is quiet; they are never "our program not locked"',
    [D.detectConfigDrift({ 'mint.split_bps': 8500 }, { 'mint.split_bps': 8500, 'prog.orca.hash': 'b', 'prog.pyth_push.upgrade_authority': 'K' }),
     D.detectConfigDrift({ 'prog.meteora.hash': 'b' }, { 'prog.meteora.hash': 'b' }),
     D.detectUpgradeAuthorityAfterLock({ 'prog.orca.upgrade_authority': 'K', 'prog.meteora.upgrade_authority': 'K' }, { lockDeadlineSec: 100, nowSec: 200, production: true })], [[], [], []])
  t('I2: alarm.mjs reads their ProgramData in Core\'s loop, as values even when absent, and a reader that forgot one is named',
    [/\.\.\.THIRD\]\) \{/.test(almSrc), /NOT_OURS\.has\(name\)/.test(almSrc),
     D.missingWatchedKeys(Object.fromEntries(D.WATCHED_KEYS.filter(k => k !== 'prog.pyth_push.hash').map(k => [k, 'x'])))], [true, true, ['prog.pyth_push.hash']])

  // ── I3: THE CONFIDENCE BOUND ──
  {
    const at = bps => thr(() => SW.oracleFloor({ lamportsIn: LAM, nowSec: T, btc: SW.readPyth(fresh().btc, SW.PYTH.BTC_USD),
      sol: { ...SW.readPyth(fresh().sol, SW.PYTH.SOL_USD), conf: solFor(MSPOT) * BigInt(bps * 10) / 100_000n } }))
    t('I3: a confidence of 31 bps is REFUSED (the old 100 bps bound passed it, and 99); 30 bps and the live 1.5 bps pass',
      [SW.MAX_ORACLE_CONF_BPS, /confidence/.test(at(31)), /confidence/.test(at(99)), at(30), at(1.5)], [30, true, true, 'ok', 'ok'])
  }

  // ── I4: THE ALARM'S DETECTOR CALLS, ARGUMENTS PINNED ──
  {
    const callsIn = src => { const a = src.indexOf('async function main('), b = src.indexOf('async function report(')
      const body = a < 0 || b < 0 ? '' : src.slice(a, b), out = []
      for (const m of body.matchAll(/D\.(detect\w+|parseCbobLogs)\(/g)) {
        let i = m.index + m[0].length, depth = 1
        while (depth && i < body.length) { const c = body[i]; if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--; i++ }
        out.push(`${m[1]}(${body.slice(m.index + m[0].length, i - 1).replace(/\s+/g, ' ').trim()})`)
      }
      return out }
    const PINNED = [
      'detectConfigDrift(prev?.config, cfg)',
      'detectStandingRisks(cfg, { production: PRODUCTION })',
      'detectBrakeTransitions(prev?.config, cfg)',
      'detectUpgradeAuthorityAfterLock(cfg, lockGate)',
      'detectMissingComponents(cfg, lockGate)',
      'detectUnreconciledRevenue(led, { now: wallSec * 1000, chainNow: nowSec * 1000, sweeps: prev?.seenSweeps || [] })',
      'detectUnreconciledRevenue(led, { now: wallSec * 1000, chainNow: nowSec * 1000, sweeps: prev?.seenSweeps || [] })',
      'detectPoolHealth(cfgAtPool, pool)',
      'detectDistributionOverdue(cfg, { nowSec, poolAvail, graceSecs: Number(process.env.CBOB_DISTRIBUTION_GRACE_SECS || 6 * 3600), poolFrozen: !!pool?.frozen })',
      'detectRedemptionRate(cfg, nowSec)',
      'detectRevealStall(prev?.config, cfg)',
      "detectUnsweptRoyalties({ lamports: royaltyLamports, reserve: cfg['mint.sol_reserve_lamports'], floor: cfg['mint.sweep_floor_lamports'], prevLamports: prev?.royaltyLamports ?? null, prevSince: prev?.royaltySince ?? null, nowSec: wallSec, sweepStopped: cfg['mint.sweep_stopped'] === true, cooldownSecs: cfg['mint.sweep_cooldown_secs'] ?? null })",
      'detectCrankPosture({ posture: D.crankPosture(crontabRead), prevArmedSince: prev?.crankArmedSince ?? null, nowSec: wallSec })',
      'detectCrankSilent({ stampSec: D.parseCrankHeartbeat(beat), live: posture.live, armedSinceSec: crankArmedSince, nowSec: wallSec })',
      "detectNestedVaults(everyVault, id => pda([Buffer.from('mpl-core-execute'), new PublicKey(id).toBuffer()], CORE).toBase58(), k => PublicKey.isOnCurve(new PublicKey(k).toBytes()))",
      "detectIndexShortfall(cfg['mint.minted_total'], vaults, burnt, { mintedAfter: await readMintedTotal() })",
      'detectVaultSetChange(prev?.vaults, { live: vaults, burnt })',
      'detectFrozenVaultAccount({ vault: l.vault, mint: l.mint, isPayment: l.mint === payment.toBase58() })',
      'detectBalanceDrops(prev?.balances, balances)',
      // Round 29 (M1): runtime-truncated logs are a recorded gap, never parsed.
      'parseCbobLogs(tx.logsTruncated ? [] : tx.meta?.logMessages || [])',
      'detectProgramEvents(ev.events, s.signature)',
      'detectApprovals(ixs, pdas, ataOwner)',
      'detectPdaTokenAccounts(ixs, pdas, atas)',
      'detectBurns(ixs, assets, BURN.toBase58(), IX_BURN_VAULT)',
      'detectUnledgeredSweeps(ixs, MINT.toBase58(), IX_SWEEP, led, s.signature, { blockTime: s.blockTime, now: nowSec, deferred: deferredSweeps, seenSweeps })',
      "detectSweepState({ judgedThrough: prev?.sweepJudgedThrough, lastSweepAt: cfg['mint.last_sweep_at'], ledger: led, nowSec, cooldownSecs: cooldownSeen, landed: landedSigs })",
      'detectLogGaps(prev?.logGaps, looked.logGaps, readGapsReviewed())',
      'detectUnreadSkips(prev?.unreadSkips, looked.unreadSkips, readGapsReviewed(SKIPS_REVIEWED))',
      'detectUnreconciledRevenue(led, { splits: allSplits, sweeps: allSweeps, now: wallSec * 1000, chainNow: nowSec * 1000 })',
      'detectSplitClaims(allSplits, led, { sweeps: allSweeps, now: wallSec * 1000, chainNow: nowSec * 1000 })',
      'detectRevenueAccount({ read: revenueRead, prevSince: prev?.revenueClock === \'chain\' ? prev.revenueSince ?? null : null, splits: [...seenSplits, ...(prev?.seenSplits || [])], nowSec })',
      "detectCrankHealth({ beat: D.readCrankBeat(beat), prev: prev?.crankHealth ?? null, coveredFreezes: { pool: findings.some(f => f.kind === 'pool_frozen'), revenue: rev.findings.some(f => f.kind === 'revenue_account_frozen') } })",
      "detectUnsplitRevenue({ amount: revenueRead.state === 'ok' ? revenueRead.amount : 0n, sinceSec: revenueSince, nowSec })",
      'detectDeferredSweeps([...(prev?.deferredSweeps || []), ...deferredSweeps], led, { now: nowSec })',
      'detectSplitHistoryGrowth(next.seenSplits)',
    ]
    const pinDiff = src => { const got = callsIn(src); return got.length !== PINNED.length ? [`${got.length} calls, ${PINNED.length} pinned`]
      : got.map((g, i) => g === PINNED[i] ? null : g.split('(')[0]).filter(Boolean) }
    t('I4: every detector call in alarm.mjs main() passes exactly the pinned arguments, in the pinned order', pinDiff(almSrc), [])
    t('I4: ...two positional arguments swapped are caught, naming the detector',
      pinDiff(almSrc.replace('D.detectConfigDrift(prev?.config, cfg)', 'D.detectConfigDrift(cfg, prev?.config)')), ['detectConfigDrift'])
    t('I4: ...and a wrong value inside an options object is caught too',
      pinDiff(almSrc.replace('sinceSec: revenueSince, nowSec })', 'sinceSec: nowSec, nowSec })')), ['detectUnsplitRevenue'])
  }
}

// Round 26: exercise the repaired revenue handlers without importing its entry
// point, loading a key, accessing an RPC or invoking the real notifier.
{
  const src = fsx.readFileSync(new URL('./revenue.mjs', import.meta.url), 'utf8')
  const body = (name, next) => src.slice(src.indexOf(`function ${name}(`), src.indexOf(next, src.indexOf(`function ${name}(`)))
  const attemptSource = body('rememberAttempt', '// Per-stage files')
  const saveCalls = []
  const remember = new Function('SW', 'save', `${attemptSource}; return rememberAttempt`)(SW, x => saveCalls.push(structuredClone(x)))
  const sig = '3'.repeat(88), err = Object.assign(new Error('confirmation unavailable'), { signature: sig })
  for (const hop of ['Sweep', 'Swap', 'Return', 'Split']) {
    const cycle = { intendedLamports: '5' }, ledger = { cycles: [cycle] }
    saveCalls.length = 0
    remember(cycle, hop, err, ledger, hop === 'Swap' ? 'orca' : undefined)
    t(`R26 ${hop}: a failed send preserves its candidate signature before leaving the handler`,
      [saveCalls.length, saveCalls[0]?.cycles[0]?.[`pending${hop}Sig`], cycle.pendingSwapVenue ?? null,
       Object.keys(cycle).some(k => /^(sweepSig|swapSig|returnSig|splitSig|sendRejected)$/.test(k)), D.cycleIsOpen(cycle)],
      [1, sig, hop === 'Swap' ? 'orca' : null, false, true])
  }
  saveCalls.length = 0
  remember({}, 'Return', new Error('no candidate supplied'), { cycles: [] })
  t('R26 a send error without a signature cannot invent an attempt record', saveCalls.length, 0)
  t('R26 candidate extraction also preserves the web3 error-message signature',
    SW.sendFailureSignature(new Error(`Transaction ${sig} resulted in an error. Status: unknown`)), sig)
  t('R26 all four actual value-hop catch handlers call the candidate recorder with their own stage',
    ['Sweep', 'Swap', 'Return', 'Split'].map(h => (src.match(new RegExp(`rememberAttempt\\(cycle, '${h}', e, led(?:, venue)?\\)`, 'g')) || []).length), [1, 1, 1, 1])

  const at = 1_800_000_000, iso = n => new Date(n * 1000).toISOString()
  const c = { startedAt: iso(at - 600), returnedAt: iso(at), returnBlockTime: at,
    returnedSats: '5000', sweptLamports: '1000000000', returnSig: 'return' }
  const check = (rows, entries) => D.detectSplitClaims(entries, { cycles: rows }, { now: (at + 7200) * 1000 }).map(x => x.kind)
  const early = [{ sig: 'early', blockTime: at - 50, total: '6000' }]
  const late = [{ sig: 'late', blockTime: at, total: '6000' }]
  t('R26 anonymous split claims cannot use a split before the chain return time', check([{ ...c, splitByOther: true }], early), ['split_by_other_unanchored'])
  t('R26 explicit split claims enforce the same chain-time rule', check([{ ...c, splitSig: 'early' }], early), ['split_claim_unanchored'])
  t('R26 a sufficiently large split at the chain return time anchors an anonymous claim', check([{ ...c, splitByOther: true }], late), [])
  t('R26 legacy rows retain their documented clock-skew allowance', check([{ ...c, returnBlockTime: null, splitByOther: true }], early), [])
  t('R26 one split cannot anchor two anonymous claims', check([{ ...c, splitByOther: true }, { ...c, splitByOther: true }], late), ['split_by_other_unanchored'])
  t('R26 a split explicitly claimed elsewhere cannot anchor an anonymous claim', check([{ ...c, splitSig: 'late' }, { ...c, splitByOther: true }], late), ['split_by_other_unanchored'])
  t('R26 a too-small split still cannot anchor an anonymous claim', check([{ ...c, splitByOther: true }], [{ ...late[0], total: '4999' }]), ['split_by_other_unanchored'])

  const notices = x => D.revenueNotices(x).map(n => [n.stage, n.recovery])
  t('R26 cooldown no-op cannot clear an unresolved swap or open-cycle marker', notices({ previous: ['swap', 'recovery'], passed: ['lock', 'config'] }), [])
  t('R26 a funding step that passed recovers even when the later market step fails',
    notices({ previous: ['funding', 'swap'], passed: ['funding'], stage: 'market', error: 'unavailable' }), [['funding', true], ['market', false]])
  t('R26 a repeated stage that now fails cannot announce its own recovery',
    notices({ previous: ['market'], passed: ['market'], stage: 'market', error: 'unavailable' }), [['market', false]])
  t('R26 completed stages recover once each, and unknown markers are ignored',
    notices({ previous: ['return', 'return', '../foreign'], passed: ['return', '../foreign'] }), [['return', true]])
  t('R26 failure messages containing recovery words remain failures',
    new RegExp(D.ROUTER_RECOVERY_SRC, 'i').test(D.revenueNotices({ stage: 'swap', error: 'RECOVERED and resolved but still failing' })[0].text), false)

  const publishSource = body('publishRevenueNotices', '// One runner, or two cycles')
  const harness = ({ live = true, failNotify = false, previous = [], passed = [], error = null, stage = 'swap' } = {}) => {
    const markers = new Set(previous.map(s => `/markers/${s}`)), events = [], sent = []
    const fakeFs = { existsSync: p => markers.has(p), mkdirSync() {}, writeFileSync(p) { markers.add(p); events.push('write') },
      rmSync(p) { markers.delete(p); events.push('remove') } }
    const notify = (_file, args, opts) => { events.push('notify'); sent.push({ args, opts }); if (failNotify) throw new Error('offline notifier') }
    const publish = new Function('fs', 'NOTIFY_LIVE', 'FAILURES', 'REVENUE_STAGES', 'revenueNotices', 'revenuePassed', 'revenueStage', 'execFileSync', 'NOTIFY', 'process', 'console', 'rehearsalNotice', 'REHEARSAL_MARKER',
      `${publishSource}; return publishRevenueNotices`)(fakeFs, live, '/markers', D.REVENUE_STAGES, D.revenueNotices, new Set(passed), stage, notify, '/stub-notifier', { env: { ALERT_URGENT: '1' } }, { error() {} }, D.rehearsalNotice, D.REHEARSAL_MARKER)
    publish(error, stage)
    return { markers: [...markers].sort(), events, sent }
  }
  t('R26 dry/probe/audit notice path neither writes nor sends nor clears',
    harness({ live: false, previous: ['swap'], passed: ['swap'] }), { markers: ['/markers/swap'], events: [], sent: [] })
  const failed = harness({ error: 'unavailable' })
  t('R26 a live failure is marked before notification and uses its own stream',
    [failed.events, failed.markers, failed.sent[0]?.args[1]], [['write', 'notify'], ['/markers/swap'], 'cbob-revenue:swap'])
  t('R26 revenue level notices cannot inherit urgency and request changed-error delivery',
    failed.sent[0]?.opts.env, { ALERT_ON_CHANGE: '1' })
  const recovered = harness({ previous: ['swap', 'recovery'], passed: ['swap'] })
  t('R26 successful recovery delivery removes only the completed stage marker',
    [recovered.events, recovered.markers], [['notify', 'remove'], ['/markers/recovery']])
  const undelivered = harness({ previous: ['swap'], passed: ['swap'], failNotify: true })
  t('R26 failed recovery delivery keeps the marker for retry', [undelivered.events, undelivered.markers], [['notify'], ['/markers/swap']])
  t('R26 actual wrapper awaits main and publishes step recovery while still under its lock',
    /withLock\(LOCK, async \(\) => \{[\s\S]*try \{ await main\(\) \}[\s\S]*revenuePassed\.add\(revenueStage\)[\s\S]*publishRevenueNotices\(\)\n\}, \{ staleMs:/.test(src), true)
  const wrapperSource = src.slice(src.indexOf('let revenueFailureReported = false')).replace('withLock(LOCK,', 'return withLock(LOCK,')
  const runWrapper = async (lockError, mainError) => {
    const notices = [], exits = []
    const lock = async (_path, fn) => { if (lockError) throw Object.assign(new Error('lock acquisition failed'), { code: lockError }); return fn() }
    const run = new Function('withLock', 'LOCK', 'main', 'revenuePassed', 'revenueStage', 'publishRevenueNotices', 'console', 'process', wrapperSource)
    await run(lock, '/stub-lock', async () => { if (mainError) throw new Error('market failed') }, new Set(), 'market',
      (e, stage = 'market') => notices.push([stage, e?.message ?? null]), { error() {} }, { exit: n => exits.push(n) })
    return [notices, exits]
  }
  t('R26 failed lock acquisition notifies for EACCES, not only an already-held lock', await runWrapper('EACCES'), [[['lock', 'lock acquisition failed']], [3]])
  t('R26 a missing lock directory is also an immediate lock-stage fault', await runWrapper('ENOENT'), [[['lock', 'lock acquisition failed']], [3]])
  t('R26 a main failure is reported once on its actual stage, not again as a lock failure', await runWrapper(null, true), [[['market', 'market failed']], [3]])
}


console.log('── ROUND 26: reconciliation recovery and rehearsal isolation ──')
{
  const source = fsx.readFileSync(new URL('./alarm.mjs', import.meta.url), 'utf8')
  // Extract only these functions into a stubbed world; never import the live entrypoint.
  const reportSource = source.slice(source.indexOf('async function report('), source.indexOf("\nif (ARGS.has('--selftest'))"))
  const reconcileSource = source.slice(source.indexOf('async function reconcile()'), source.indexOf('/** Round 24 (L9)'))
  const prefix = 'cbob-reconcile', state = '/stub/reconcile', marker = state + '.failed'
  const dust = { kind: 'undeclared_token_account', severity: 'HIGH', detail: 'unexpected account' }
  const prior = [dust.kind, 'reconcile_failed']
  const harness = async ({ findings = [], prevPaged = [], dry = false, fail = false, reconcile = false, minted = 0 } = {}) => {
    const messages = [], printed = [], removed = [], written = []
    const report = new Function('D', 'DRY', 'PRODUCTION', 'RUN_FAILED', 'NOTIFY', 'ACKS', 'fs', 'execFileSync', 'process', 'console',
      reportSource + '; return report')(D, dry, true, '/stub/main-failed', '/stub/notify', '/stub/acks',
      { existsSync: () => true, unlinkSync: f => removed.push(f) },
      (_cmd, args) => { if (fail) throw new Error('delivery failed'); messages.push(args) },
      { env: {}, exitCode: 0 }, { log: x => printed.push(x), error() {} })
    let result
    if (reconcile) {
      const fn = new Function('D', 'DRY', 'RECONCILE_STATE', 'RECONCILE_FAILED', 'RECONCILE_LABEL', 'readLedger', 'writeLedger',
        'readConfigs', 'listVaults', 'readMintedTotal', 'fs', 'readAcks', 'report', 'console',
        reconcileSource + '; return reconcile')(D, dry, state, marker, prefix,
        () => ({ paged: prevPaged }), (f, v) => written.push([f, v.paged]),
        async () => ({ 'mint.collection': 'stub', 'mint.minted_total': minted, 'seal.reserve_mints': [] }),
        async () => ({ live: [], burnt: [], all: [] }), async () => minted,
        { existsSync: () => true }, () => ({}), report, { log() {} })
      await fn()
    } else result = await report(findings, { vaults: 1, txs: 0, programs: 0 }, {}, false,
      { prevPaged, scope: 'reconcile', prefix, failedMarker: marker })
    return { messages, printed: printed.join('\n'), removed, written, result }
  }
  const active = await harness({ findings: [dust] })
  t('L4: reconciliation pages its own stream and saves a recoverable kind',
    [active.messages[0]?.[1], active.result.paged], [D.alarmLabel(dust.kind, prefix), [dust.kind]])
  const clean = await harness({ prevPaged: prior, reconcile: true })
  t('L4: an actual completed reconciliation sends both outstanding recoveries',
    clean.messages.map(([text, label]) => [label, /RECOVERED/.test(text)]), prior.map(k => [D.alarmLabel(k, prefix), true]))
  t('L4: recovery clears only reconciliation history and marker', [clean.written, clean.removed], [[[state, []]], [marker]])
  const incomplete = await harness({ prevPaged: [dust.kind], reconcile: true, minted: 1 })
  t('L4: incomplete census cannot recover an unscanned vault or clear the failure marker',
    [incomplete.messages.some(([text]) => /RECOVERED/.test(text)), incomplete.removed,
     incomplete.written[0]?.[1]], [false, [], [...prior, 'index_disagrees_with_chain']])
  const completeLater = await harness({ prevPaged: incomplete.written[0][1], reconcile: true })
  t('L4: a later complete census recovers the preserved conditions and index fault',
    [completeLater.messages.filter(([text]) => /RECOVERED/.test(text)).length, completeLater.written], [3, [[state, []]]])
  t('L4: reconciliation makes only its scoped all-clear claim',
    [clean.printed.includes('no index shortfall'), clean.printed.includes('no overdue distribution')], [true, false])
  const failed = await harness({ prevPaged: [dust.kind], reconcile: true, fail: true })
  t('L4: failed recovery delivery preserves both outstanding kinds and its marker',
    [failed.written, failed.removed], [[[state, prior]], []])
  const dry = await harness({ prevPaged: prior, reconcile: true, dry: true })
  t('L4: a dry reconciliation neither notifies nor changes either history', [dry.messages, dry.written, dry.removed], [[], [], []])
  const stillBad = await harness({ findings: [dust], prevPaged: [dust.kind] })
  t('L4: a persisting fault is reasserted, never recovered', stillBad.messages.every(([text]) => !/RECOVERED/.test(text)), true)
  const partial = await harness({ findings: [dust], prevPaged: ['index_shortfall'], fail: true })
  t('L4: failed report retains the newly observed kind for the caller to merge', [partial.result.delivered, partial.result.paged], [false, [dust.kind]])
  t('L4: every reconciliation kind has a distinct router-safe label',
    ['undeclared_token_account', 'index_self_contradictory', 'index_disagrees_with_chain', 'nested_vault', 'vault_owns_itself', 'unredeemable_owner', 'reconcile_failed']
      .every(k => D.alarmLabel(k, prefix).length <= 40 && D.alarmLabel(k, prefix) !== D.alarmLabel(k)), true)
  t('L4: the failure path writes and routes only its own marker and label',
    /writeFileSync\(RECONCILE_FAILED/.test(source) && /alarmLabel\('reconcile_failed', RECONCILE_LABEL\)/.test(source), true)

  // Run the actual installer prelude with synthetic roots and stubbed external
  // commands. Both branches stop before any real crontab, sudo or file write.
  const installer = fsx.readFileSync(new URL('../scripts/cron-install.sh', import.meta.url), 'utf8')
  const prelude = installer.slice(installer.indexOf('set -euo pipefail'), installer.indexOf("TAG='#cbob-vault-cron'"))
  const tmp = fsx.mkdtempSync('/tmp/cbob-r26-cron-')
  const q = x => "'" + x.replaceAll("'", "'\\''") + "'"
  try {
    const run = () => CP.spawnSync('bash', ['-c',
      'id() { echo ubuntu; }\ncrontab() { exit 91; }\nsudo() { exit 92; }\n' +
      prelude.replace('R=/opt/cbob-vaults', `R=${q(tmp)}`) + '\necho prelude-passed'], { encoding: 'utf8' })
    const production = run()
    t('L6: a production root passes the installer prelude', [production.status, production.stdout.trim()], [0, 'prelude-passed'])
    fsx.writeFileSync(tmp + '/REHEARSAL-RECORD.txt', 'synthetic')
    const rehearsal = run()
    t('L6: a rehearsal exits before any installer action',
      [rehearsal.status, rehearsal.stdout, /rehearsal tree: cron installation is disabled/.test(rehearsal.stderr)], [1, '', true])
  } finally { fsx.rmSync(tmp, { recursive: true, force: true }) }
}


{
  const src = fsx.readFileSync(new URL('./revenue.mjs', import.meta.url), 'utf8')
  const auditSource = src.slice(src.indexOf('function audit()'), src.indexOf('/** The oracle'))
  const printed = [], cycle = { startedAt: 'synthetic', intendedLamports: '1', pendingSwapVenue: 'orca' }
  for (const hop of ['Sweep', 'Swap', 'Return', 'Split']) cycle[`pending${hop}Sig`] = hop + 'Candidate'
  const audit = new Function('load', 'cycleIsOpen', 'console', 'process', auditSource + '; return audit')(
    () => ({ cycles: [cycle] }), D.cycleIsOpen, { log: x => printed.push(x) }, { exitCode: 0 })
  audit()
  t('L1: the actual audit diagnostic names all four candidates and the swap venue',
    ['SweepCandidate', 'SwapCandidate (orca)', 'ReturnCandidate', 'SplitCandidate', 'not confirmations'].every(x => printed.join('\n').includes(x)), true)
}

// Round 27: actual planner and SDK shapes; no live alarm or transaction sends.
{
  const masked = D.detectUnsweptRoyalties({ lamports: 101_000_000_000n, prevLamports: 100_000_000_000n, reserve: 50_000_000n, floor: 1_000_000_000n, prevSince: 1, nowSec: 100000, cooldownSecs: 21600 })
  t('R27 D4: a sweep masked by new deposits still pages only the observed net-balance condition', [masked.findings[0]?.severity, masked.findings[0]?.detail.includes('no observed net balance decrease'), masked.findings[0]?.detail.includes('masked successful sweeps')], ['HIGH', true, true])
  const gate = { lockDeadlineSec: 100, nowSec: 100, production: true }
  const mutable = Object.fromEntries(['seal', 'mint', 'burn', 'gov', 'sweep'].map(p => [`prog.${p}.upgrade_authority`, 'synthetic-key']))
  t('R27 L4: rehearsal disables both elapsed and unset lock checks', [100, null].map(lockDeadlineSec => D.detectUpgradeAuthorityAfterLock(mutable, { ...gate, lockDeadlineSec, production: false }).length), [0, 0])
  t('R27 L4: exact rehearsal switch is required; typo still pages five mutable programs', ['1', 'true'].map(v => D.detectUpgradeAuthorityAfterLock(mutable, { ...gate, production: D.alarmProduction({ CBOB_ALARM_REHEARSAL: v }) }).length), [0, 5])
  const keys = ['seal', 'mint', 'burn', 'gov', 'prog.seal', 'prog.mint', 'prog.burn', 'prog.gov', 'prog.sweep']
  t('R27 L1: every explicit missing component pages on its first reading at deadline', keys.map(k => D.detectMissingComponents({ [`${k}._missing`]: true }, gate)[0]?.kind), keys.map(() => 'component_missing'))
  t('R27 L1: predeadline, unset, rehearsal, and present components remain quiet',
    [{ nowSec: 99 }, { lockDeadlineSec: null }, { production: false }].map(o => D.detectMissingComponents({ 'burn._missing': true }, { ...gate, ...o }).length).concat(D.detectMissingComponents({}, gate).length), [0, 0, 0, 0])
  const alarm = fsx.readFileSync(new URL('./alarm.mjs', import.meta.url), 'utf8')
  const body = alarm.slice(alarm.indexOf('  const lockGate ='), alarm.indexOf('\n\n  // What the last delivered'))
  const runGate = new Function('D', 'cfg', 'nowSec', 'PRODUCTION', 'lockDeadline', `const findings=[]; ${body}; return findings`)
  t('R27 L4: actual alarm wiring keeps rehearsal lock checks off after charter opens', [true, false].map(p => runGate(D, { ...mutable, 'mint.charter_opens_at': 100 }, 101, p, () => 200).filter(f => f.kind === 'program_not_locked').length), [5, 0])
  t('R27 L1: actual alarm uses earlier chain deadline and respects rehearsal', [true, false].map(p => runGate(D, { 'mint.charter_opens_at': 100, 'burn._missing': true }, 101, p, () => 200).some(f => f.kind === 'component_missing')), [true, false])
  const cfg = { revealed_total: 0n, monthly_secs: 100n, last_distribute_at: 0n, dist_epoch: 2n, total_active_weight: 0n, pending_count: 0n, pending_this_epoch: 0n, acc_scaled: 0n, owed_scaled: 0n }
  const account = { state: 'ok', amount: 100n, frozen: false }, frozen = { ...account, frozen: true }
  const plan = (pool, bank = account, revenue = account) => CR.planCrank({ cfg, records: [], pool, bank, revenue, slot: 1000, nowSec: 1000 })
  const ps = plan(frozen).problems
  const streak = (problems, coveredFreezes = {}, failures = 0) => {
    let r
    for (let atSec = 1; atSec <= 3; atSec++) r = D.detectCrankHealth({ prev: r?.next, beat: { atSec, problems, failures }, coveredFreezes })
    return r
  }
  const poolFindings = D.detectPoolHealth({ 'mint.owed_scaled': '0' }, frozen)
  const first = D.applyFrozenTransitions(poolFindings)
  t('R27 L2: actual frozen pool produces claims and split blockers', ps.length, 2)
  t('R27 L2: three covered heartbeats leave only the existing INFO freeze', D.applyFrozenTransitions([...poolFindings, ...streak(ps, { pool: true }).findings], first.frozen).findings.map(f => [f.kind, f.severity]), [['pool_frozen', 'INFO']])
  t('R27 L2: absent transition coverage retains both fault streaks', streak(ps).findings.length, 2)
  t('R27 L2: mixed missing or frozen Squads blockers remain HIGH', [{ state: 'absent' }, frozen].map(bank => streak(plan(frozen, bank).problems, { pool: true }).findings.length), [1, 1])
  t('R27 L2: revenue freeze uses only its own transition coverage', streak(plan(account, account, frozen).problems, { revenue: true }).findings, [])
  t('R27 L2: covered freezes never suppress failed actions', streak(ps, { pool: true }, 1).findings.map(f => f.kind), ['crank_failing'])
  const pruned = D.detectCrankHealth({ prev: streak(ps).next, beat: { atSec: 3, failures: 0, problems: ps }, coveredFreezes: { pool: true } })
  t('R27 L2: duplicate heartbeat prunes old freeze streak', [pruned.findings, pruned.next.problems], [[], {}])
  t('R27 L2: thaw with stale heartbeat does not resurrect old streak', D.detectCrankHealth({ prev: pruned.next, beat: { atSec: 3, failures: 0, problems: ps } }).findings, [])
  t('R27 L2: unfamiliar freeze strings remain visible', streak(['unknown FROZEN account'], { pool: true, revenue: true }).findings.length, 1)
  t('R27 L2: thaw then refreeze is a fresh urgent transition', D.applyFrozenTransitions(poolFindings, D.applyFrozenTransitions([], first.frozen).frozen).findings[0].urgent, true)
  const { sendAndConfirmTransaction, Transaction } = await import('@solana/web3.js')
  const mint = L.PROGRAM_IDS.mint, foreign = CR.TOKEN_PROGRAM_ID
  const logs = (code, owner = mint) => [`Program ${owner} invoke [1]`, `Program log: AnchorError thrown. Error Code: ${code}. Error Number: 6047.`, `Program ${owner} failed: custom program error: 0x179f`]
  const source = fsx.readFileSync(new URL('./crank.mjs', import.meta.url), 'utf8')
  const sendBody = source.slice(source.indexOf('  const send = async (label, ixs) => {'), source.indexOf('\n  const run = async', source.indexOf('  const send = async (label, ixs) => {')))
  const sender = (error, conn) => new Function('sendAndConfirmTransaction', 'Transaction', 'conn', 'payer', 'BENIGN', 'mintFailureCode', 'console', `return async()=>{let lastFailure=''; ${sendBody}; return {result:await send('capture',[]),lastFailure}}`)(async () => { throw error }, class { add() { return this } }, conn, {}, CR.BENIGN, CR.mintFailureCode, { log() {} })()
  const conn = { sendTransaction: async () => 'synthetic', confirmTransaction: async () => ({ value: { err: { InstructionError: [0, { Custom: 6047 }] } } }), getTransaction: async () => ({ meta: { logMessages: logs('AlreadyCaptured') } }) }
  let error
  try { await sendAndConfirmTransaction(conn, new Transaction(), [], { commitment: 'confirmed' }) } catch (e) { error = e }
  t('R27 L3: actual SDK confirmation error initially lacks logs', [error.constructor.name, error.logs], ['SendTransactionError', undefined])
  t('R27 L3: actual sender retrieves MINT race logs', (await sender(error, conn)).result, 'benign')
  t('R27 L3: MINT preflight logs also classify race', (await sender({ message: 'preflight', logs: logs('AlreadyCaptured') }, conn)).result, 'benign')
  t('R27 L3: foreign same-named code cannot masquerade as MINT race', (await sender({ message: 'AlreadyCaptured', logs: logs('AlreadyCaptured', foreign) }, conn)).result, 'fail')
  const nested = [`Program ${mint} invoke [1]`, ...logs('AlreadyCaptured', foreign).map(s => s.replace('invoke [1]', 'invoke [2]')), `Program ${mint} failed: custom program error: 0x179f`]
  t('R27 L3: nested CPI error retains its own attribution', await CR.mintFailureCode({ logs: nested }, conn), null)
  t('R27 L3: unavailable logs fail closed', (await sender({ message: 'AlreadyCaptured', getLogs: async () => { throw Error('unavailable') } }, conn)).result, 'fail')
  t('R27 L3: stalled retrieval is bounded', await CR.mintFailureCode({ getLogs: () => new Promise(() => {}) }, conn, { timeoutMs: 1 }), null)
  const was = { dist_epoch: 2, last_distribute_at: 10 }, moved = { dist_epoch: 3, last_distribute_at: 11 }
  for (const code of ['NothingToDistribute', 'BoostsExpireFirst', 'JoinWaitingFirst', 'PoolShort']) {
    const sent = await sender({ message: 'numeric error', getLogs: async () => logs(code) }, conn)
    t(`R27 L3: ${code} retains distribution-counter check`, [sent.result, CR.judgeDistributeRefusal(sent.lastFailure, was, was), CR.judgeDistributeRefusal(sent.lastFailure, was, moved)], ['fail', 'fail', code === 'PoolShort' ? 'fail' : 'benign'])
  }
}

// Validation-discovered v1 gap: captured successful public mainnet transaction
// 5BUyz...JQer, slot 453742789 (2026-10-06); no keys or private RPC URL in fixture.
// The legacy/v0 controls deliberately reuse its parsed payload, not its wire bytes.
{
  const { readParsedTransaction, validateParsedTransaction } = await import('./txread.mjs')
  const { Connection } = await import('@solana/web3.js')
  const fixture = JSON.parse(fsx.readFileSync(new URL('../tests/fixtures/mainnet-v1.json', import.meta.url)))
  const signature = fixture.transaction.signatures[0]
  const conn = new Connection('http://127.0.0.1:1', 'confirmed')
  let request
  conn._rpcRequest = async (...args) => { request = args; return { jsonrpc: '2.0', id: 'test', result: structuredClone(fixture) } }
  let sdkError
  try { await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 1 }) } catch (e) { sdkError = e }
  t('R27 V1: installed SDK actually rejects the public v1 fixture', [sdkError?.name, sdkError?.path], ['StructError', ['version']])
  const tx = await readParsedTransaction(conn, signature)
  t('R27 V1: reader explicitly requests resolved v1 history', request, ['getTransaction', [signature, { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }]])
  t('R27 V1: real transaction retains every field including v1 configuration', tx, fixture)
  t('R27 V1: real fixture retains top-level and CPI coverage', [D.normaliseTx(tx).filter(ix => ix.index !== undefined).length, D.normaliseTx(tx).filter(ix => ix.parent !== undefined).length, tx.meta.logMessages.length], [3, 19, 85])
  for (const version of ['legacy', 0]) {
    const control = structuredClone(fixture)
    control.version = version; delete control.transaction.message.transactionConfig
    if (version === 0) control.transaction.message.accountKeys.at(-1).source = 'lookupTable'
    conn._rpcRequest = async () => ({ jsonrpc: '2.0', id: 'test', result: structuredClone(control) })
    const old = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 })
    const read = await readParsedTransaction(conn, signature)
    t(`R27 V1: ${version} parsed control matches SDK normalization`, D.normaliseTx(read), D.normaliseTx(old))
  }
  const minimal = structuredClone(fixture)
  minimal.meta.logMessages = []; minimal.meta.innerInstructions = []; minimal.transaction.message.instructions = []
  t('R27 V1: explicit empty coverage is readable', D.normaliseTx(validateParsedTransaction(minimal, signature)), [])
  const memo = structuredClone(minimal)
  memo.transaction.message.instructions.push({ programId: memo.transaction.message.accountKeys.at(-1).pubkey, program: 'spl-memo', parsed: 'memo text' })
  t('R27 V1: parsed memo string remains readable', D.normaliseTx(validateParsedTransaction(memo, signature))[0].parsed, 'memo text')
  const markerText = structuredClone(fixture); markerText.meta.logMessages = ['Program log: Log truncated']
  t('R28 M1: user log text cannot impersonate the runtime marker', validateParsedTransaction(markerText, signature), markerText)
  const mutations = [
    ['future version', x => { x.version = 2 }],
    ['missing version', x => { delete x.version }],
    ['wrong signature', x => { x.transaction.signatures[0] = 'other' }],
    ['invalid account key', x => { x.transaction.message.accountKeys[0].pubkey = 'bad' }],
    ['unsigned payer', x => { x.transaction.message.accountKeys[0].signer = false }],
    ['missing v1 config', x => { delete x.transaction.message.transactionConfig }],
    ['v1 lookup table key', x => { x.transaction.message.accountKeys.at(-1).source = 'lookupTable' }],
    ['absent metadata', x => { x.meta = null }],
    ['null logs', x => { x.meta.logMessages = null }],
    ['absent logs', x => { delete x.meta.logMessages }],
    ['runtime-truncated logs', x => { x.meta.logMessages = ['Log truncated'] }],
    ['null CPI coverage', x => { x.meta.innerInstructions = null }],
    ['absent CPI coverage', x => { delete x.meta.innerInstructions }],
    ['invalid parent index', x => { x.meta.innerInstructions[0].index = 1000 }],
    ['null parsed payload', x => { x.meta.innerInstructions[0].instructions[0] = { programId: x.transaction.message.accountKeys[0].pubkey, program: 'bad', parsed: null } }],
    ['missing money info', x => { x.meta.innerInstructions[0].instructions[0] = { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', program: 'spl-token', parsed: { type: 'transfer' } } }],
    ['null token balances', x => { x.meta.preTokenBalances = null }],
    ['absent token balances', x => { delete x.meta.postTokenBalances }],
    ['empty transfer fields', x => { const ix = x.meta.innerInstructions.flatMap(g => g.instructions).find(ix => ix.parsed?.type === 'transferChecked'); ix.parsed.info = {} }],
    ['negative transfer amount', x => { const ix = x.meta.innerInstructions.flatMap(g => g.instructions).find(ix => ix.parsed?.type === 'transferChecked'); ix.parsed.info.tokenAmount.amount = '-1' }],
    ['missing transfer destination', x => { const ix = x.meta.innerInstructions.flatMap(g => g.instructions).find(ix => ix.parsed?.type === 'transferChecked'); delete ix.parsed.info.destination }],
    ['truncated balances', x => { x.meta.postBalances.pop() }],
    ['invalid raw data', x => { const ix = x.transaction.message.instructions.find(ix => 'data' in ix); ix.data = '0' }],
  ]
  for (const [name, mutate] of mutations) {
    const bad = structuredClone(fixture); mutate(bad)
    let refused = false
    try { validateParsedTransaction(bad, signature) } catch (e) { refused = e.message.startsWith('unreadable parsed transaction:') }
    t(`R27 V1: ${name} refuses before scan progress`, refused, true)
  }
  {
    // Round 29 (M1): a walking scanner opts in to see runtime truncation as a
    // flag on an otherwise fully validated transaction; nothing else relaxes.
    const cut = structuredClone(fixture); cut.meta.logMessages = ['Log truncated']
    const flagged = validateParsedTransaction(cut, signature, { truncatedLogs: 'flag' })
    const broken = structuredClone(cut); broken.meta.postBalances.pop()
    const refusedOther = (() => { try { validateParsedTransaction(broken, signature, { truncatedLogs: 'flag' }); return false } catch { return true } })()
    const refusedOption = (() => { try { validateParsedTransaction(fixture, signature, { truncatedLogs: 'ignore' }); return false } catch { return true } })()
    t('R29 M1: flag mode returns a truncated transaction marked, still refuses every other defect and an unknown option',
      [flagged?.logsTruncated, validateParsedTransaction(fixture, signature, { truncatedLogs: 'flag' }).logsTruncated, refusedOther, refusedOption], [true, undefined, true, true])
  }
  conn._rpcRequest = async () => ({ result: null })
  t('R27 V1: missing transaction stays unknown', await readParsedTransaction(conn, signature), null)
  for (const response of [{ error: { code: -32015, message: 'unsupported' } }, {}]) {
    conn._rpcRequest = async () => response
    let refused = false; try { await readParsedTransaction(conn, signature) } catch { refused = true }
    t(`R27 V1: ${response.error ? 'RPC refusal' : 'malformed envelope'} cannot become empty history`, refused, true)
  }
}

// Ten source-extracted integration assertions; no live entrypoint is imported.
// Legacy/v0 controls reuse parsed shape; only v1 is a captured live transaction.
{
const fs=await import('node:fs');const {PublicKey}=await import('@solana/web3.js');
const {readParsedTransaction}=await import('./txread.mjs');
const fixture=JSON.parse(fs.readFileSync(new URL('../tests/fixtures/mainnet-v1.json',import.meta.url),'utf8'));
const signature=fixture.transaction.signatures[0],sr={signature,err:null,blockTime:fixture.blockTime};
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;const P=s=>new PublicKey(s);
const alm=fs.readFileSync(new URL('./alarm.mjs', import.meta.url),'utf8'),start=alm.indexOf('  for (const prog of [SEAL, MINT, BURN, GOV]) {'),end=alm.indexOf('  delete looked.eventSigs',start);
const alarmRun=new AsyncFunction('ctx','with(ctx){'+alm.slice(start,end)+';return {cursors,findings,looked}}');
const rev=fs.readFileSync(new URL('./revenue.mjs', import.meta.url),'utf8'),rstart=rev.indexOf('async function splitsSince('),rend=rev.indexOf('\n// A candidate signature',rstart);const splitRun=new Function('readParsedTransaction','revenueOutflow','normaliseTx',rev.slice(rstart,rend)+';return splitsSince')(readParsedTransaction,D.revenueOutflow,D.normaliseTx);
const post=fs.readFileSync(new URL('./redemption-poster.mjs', import.meta.url),'utf8'),pstart=post.indexOf('  let drafted = 0',post.indexOf('async function main()')),pend=post.indexOf('\n  console.log(`${drafted} redemption',pstart);const postRun=new AsyncFunction('ctx','with(ctx){'+post.slice(pstart,pend)+';return {st,drafted}}');
const pureStart=post.indexOf('export function releasedFromTx('),pureEnd=post.indexOf('\n/** The post.',pureStart);const released=new Function(post.slice(pureStart,pureEnd).replace('export ','')+';return releasedFromTx')();
const source=D.normaliseTx(fixture).find(i=>i.parsed?.type==='transferChecked').parsed.info.source,ata={toBase58:()=>source};
for(const version of ['legacy',0,1]){const tx=structuredClone(fixture);tx.version=version;if(version!==1)delete tx.transaction.message.transactionConfig
const conn={_rpcRequest:async()=>({result:tx}),getSignatureStatuses:async()=>({value:[{}]})};let pages=0;conn.getSignaturesForAddress=async()=>pages++===0?[sr]:[];
const ctx={SEAL:P(L.PROGRAM_IDS.seal),MINT:P(L.PROGRAM_IDS.mint),BURN:P(L.PROGRAM_IDS.burn),GOV:P(L.PROGRAM_IDS.gov),PER_PROGRAM_READS:2000,backlogs:{},unreadPasses:{},cursors:{[L.PROGRAM_IDS.seal]:'old'},walkSigs:async(c,p)=>({sigs:p.toBase58()===L.PROGRAM_IDS.seal?[sr]:[],gap:false}),findings:[],conn,looked:{programs:0,txs:0},readParsedTransaction,D,IX_SPLIT:[255],IX_BURN_VAULT:[255],IX_SWEEP:[255],payment:P('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'),seenSplits:[],REVENUE_ATA:ata,pdas:new Set(),ataOwner:{},atas:new Set(),assets:new Set(),led:{cycles:[]},nowSec:fixture.blockTime,deferredSweeps:[],seenSweeps:[]};
const a=await alarmRun(ctx);
  t(`R27 V1 consumer: ${version} actual alarm walk advances only after reading`, [a.cursors[L.PROGRAM_IDS.seal]===signature,a.looked.txs,a.findings.length], [true,1,0]);
  const out=await splitRun(conn,ata,1);
  t(`R27 V1 consumer: ${version} actual revenue scan retains CPI outflow and anchor`, [out.map(x=>x.total),!!D.closesCycle({returnedSats:'1',returnBlockTime:1},out)], [['8844308'],true]);
  let saved=false;const pc={sigs:[sr],gap:false,conn,readParsedTransaction,parseCbobLogs:D.parseCbobLogs,draftKey:PO.draftKey,st:{cursor:'old'},writeLedger:()=>{saved=true},STATE:'scratch-only',queued:new Set(),UNREADABLE_SKIP_PASSES:D.UNREADABLE_SKIP_PASSES};
  const result=await postRun(pc),owner=fixture.transaction.message.accountKeys[0].pubkey;
  t(`R27 V1 consumer: ${version} actual poster loop saves cursor and release reader keeps amounts`, [result.st.cursor===signature,saved,result.drafted,released(await readParsedTransaction(conn,signature),owner).map(x=>String(x.amount))], [true,true,0,['8845308','33273213631','54595576627310']]); // round 31 (D2): + the 1,000-lamport System transfer from the same address, now counted as released SOL
  if (version===1) {
    delete tx.meta.logMessages;ctx.cursors[L.PROGRAM_IDS.seal]='old';pc.st.cursor='old';saved=false;pages=0;
    const refused=[];let alarmOut=null;for(const run of [async()=>{alarmOut=await alarmRun({...ctx,findings:[],looked:{programs:0,txs:0},cursors:ctx.cursors,backlogs:{}})},async()=>{const o=await splitRun(conn,ata,1);if(!o.length&&o.refused.length)throw new Error(o.refused[0])},()=>postRun(pc)]){try{await run();refused.push(false)}catch(e){refused.push(/unreadable parsed transaction: logs/.test(e.message))}}
    // Round 32 (L2): the alarm no longer ABORTS the pass on an unreadable
    // transaction; it reports tx_unreadable and holds the cursor, so the pass's
    // other findings still go out. Revenue and the poster still refuse.
    // Round 43 (V43o-2): the poster now SAVES one thing before it stops, the
    // signature's retry count (its cursor still holds), so a permanent fault ends
    // in a queued hand-draft instead of stopping every later run.
    // Round 44 (V44o-2): the split scan no longer throws; it returns no split and
    // NAMES the refused signature (the stub rethrows that name to keep the shape).
    t('R27 V1 consumer: missing coverage holds alarm/poster cursors (the alarm reports tx_unreadable and continues), saves only the poster\'s retry count and supplies no split evidence',
      [refused,alarmOut?.findings.some(f=>f.kind==='tx_unreadable'),ctx.cursors[L.PROGRAM_IDS.seal],pc.st.cursor,saved,pc.st.unread], [[false,true,true],true,'old','old',true,{[signature]:1}]);
    // ROUND 29 (M1): one stranger-padded transaction with runtime-truncated logs
    // must not halt any walk. The alarm pages it as a coverage gap, still runs
    // its instruction detectors (here a non-ATA token account for a watched PDA)
    // and moves its cursor past it; the revenue scan keeps its outflow; the
    // poster queues a REJECTED hand-draft only for a top-level BURN call.
    // A real CBOB event line BEFORE the marker: a walk that parsed truncated
    // logs anyway would page reveal_rescheduled, which must not happen.
    tx.meta.logMessages = [`Program ${L.PROGRAM_IDS.mint} invoke [1]`,'Program log: CBOB_REVEAL_RESCHEDULED asset=AAA mint_index=7 old_slot=100 new_slot=500 times=2',`Program ${L.PROGRAM_IDS.mint} success`,'Log truncated'];pages=0;
    const pda='D9Ew95W9qBLu6Ku8GupFQCawqhmDUqTgysR7aKja6nW';
    // Round 30 (L1): the fixture executes none of our programs, so it is the
    // stranger shape (recorded at INFO, never paged); naming one of ITS
    // programs as ours turns it into the invoked shape, which pages HIGH.
    const ours=new Set([L.PROGRAM_IDS.seal,L.PROGRAM_IDS.mint,L.PROGRAM_IDS.burn,L.PROGRAM_IDS.gov,L.PROGRAM_IDS.sweep]);
    const mk=o=>({...ctx,OURS:o,backlogs:{},findings:[],looked:{programs:0,txs:0},pdas:new Set([pda]),cursors:{[L.PROGRAM_IDS.seal]:'old'},seenSplits:[],deferredSweeps:[],seenSweeps:[]});
    const ta=await alarmRun(mk(ours)),kinds=ta.findings.map(f=>f.kind);
    t('R29 M1: alarm walk records the truncated transaction, never parses its logs, still reports its instruction findings and advances',
      [ta.cursors[L.PROGRAM_IDS.seal]===signature,kinds.includes('reveal_rescheduled'),kinds.includes('non_ata_token_account')],
      [true,false,true]);
    const tb=await alarmRun(mk(new Set([...ours,tx.transaction.message.instructions[2].programId]))),kb=tb.findings.map(f=>f.kind);
    t('R30 L1: a stranger shape that ran none of our programs is INFO and unrecorded; one in which ours ran is recorded as a gap',
      [kinds.filter(k=>k==='log_coverage_gap').length,ta.findings.find(f=>f.kind==='log_truncated_foreign')?.severity,D.ALARM_KINDS.log_truncated_foreign,
       kb.includes('log_truncated_foreign'),ta.looked.logGaps,tb.looked.logGaps],
      [0,'INFO','info',false,undefined,[signature]]);
    {
      // ROUND 31 (L1, after review): the gap is a LEVEL condition only a person
      // clears. It stands every pass while any kept gap is newer than the
      // reviewed watermark (so the router's 25-minute recovery window cannot
      // swallow it), its text names no signature or count (so a stranger's
      // extra gaps send no new email), it clears once reviewed, and a new gap
      // after the watermark reopens it. A watermark not among the kept gaps
      // leaves all unreviewed.
      const g1=D.detectLogGaps([],tb.looked.logGaps,null),g2=D.detectLogGaps(g1.keep,[],null),g3=D.detectLogGaps(g2.keep,['other'],null);
      const done=D.detectLogGaps(g3.keep,[],'other'),again=D.detectLogGaps(done.keep,['newer'],'other'),lost=D.detectLogGaps(['a','b'],[],'gone');
      const n=f=>D.planAlarmNotices(f.findings,{stamp:'x'}).notices[0];
      t('R31 L1: the truncation gap stands every pass until reviewed, with unchanged non-urgent text, clears at the watermark and reopens on a newer gap',
        [D.ALARM_KINDS.log_coverage_gap,g1.findings.length,g2.findings.length,n(g1)?.urgent,n(g1)?.text===n(g3)?.text,
         done.findings.length,again.findings.length,lost.findings.length,g3.keep],
        ['level',1,1,false,true,0,1,1,[signature,'other']]);
    }
    {
      // ROUND 32 (L3): an unreviewed gap is NEVER evicted. 600 later gaps leave
      // the first one listed; a reviewed prefix is trimmed but keeps the
      // watermark; more than 2,000 unreviewed escalate to CRITICAL.
      const many=Array.from({length:600},(_,i)=>`p${i}`),flood=D.detectLogGaps([signature],many,null);
      const rev=D.detectLogGaps(flood.keep,[],'p299'),big=D.detectLogGaps([],Array.from({length:2001},(_,i)=>`q${i}`),null);
      t('R32 L3: 600 cheap gaps cannot evict an unreviewed one; review trims only the reviewed prefix (keeping the watermark); over 2,000 unreviewed escalates to CRITICAL',
        [flood.keep[0],flood.keep.length,rev.keep.includes('p299'),rev.keep.includes(signature),rev.keep.slice(-300).join()===many.slice(300).join(),
         flood.findings[0]?.severity,big.findings[0]?.severity,/LAST signature listed/.test(flood.findings[0]?.detail??'')],
        [signature,601,true,false,true,'HIGH','CRITICAL',true]);
    }
    {
      // ROUND 32 (L2): one unreadable transaction, or a listing that throws, is
      // reported as tx_unreadable and holds that cursor; the pass continues and
      // the other programs are still walked.
      const boom=async()=>{throw new Error('getTransaction RPC error -32000: boom')};
      const lr={...ctx,OURS:new Set(),backlogs:{},findings:[],looked:{programs:0,txs:0},cursors:{[L.PROGRAM_IDS.seal]:'old'},readParsedTransaction:boom,
        walkSigs:async(c,p)=>{if(p.toBase58()===L.PROGRAM_IDS.mint)throw new Error('listing failed');return {sigs:p.toBase58()===L.PROGRAM_IDS.seal?[sr]:[],gap:false}},seenSplits:[],deferredSweeps:[],seenSweeps:[]};
      const r=await alarmRun(lr),k=r.findings.filter(f=>f.kind==='tx_unreadable').map(f=>/listing|list the/.test(f.detail)?'list':'read').sort();
      t('R32 L2: a throwing read and a throwing listing each become tx_unreadable, the cursor holds, and all four programs are still visited',
        [k,r.cursors[L.PROGRAM_IDS.seal],r.looked.programs],[['list','read'],'old',4]);
    }
    const tout=await splitRun(conn,ata,1);
    t('R29 M1: revenue scan reads the outflow of a truncated-log transaction instead of stopping', tout.map(x=>x.total), ['8844308']);
    const os=await import('node:os'),path=await import('node:path'),q=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'cbob-poster-')),'q.jsonl');
    const prun=async(burnId)=>{fs.writeFileSync(q,'');const c={...pc,fs,QUEUE:q,BURN_PROGRAM_ID:burnId,st:{cursor:'old'},queued:new Set()};saved=false;const r=await postRun(c);
      return [r.st.cursor===signature,r.drafted,fs.readFileSync(q,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).map(e=>[e.status,e.web.signature===signature])]};
    const topLevel=tx.transaction.message.instructions[2].programId;
    // CAMMCzo5... appears in this fixture only as an INNER instruction.
    t('R29 M1: poster moves past a truncated transaction; only a top-level BURN call is queued REJECTED for a hand draft',
      [await prun(L.PROGRAM_IDS.burn),await prun('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'),await prun(topLevel)], [[true,0,[]],[true,0,[]],[true,0,[['rejected',true]]]]);
    fs.rmSync(path.dirname(q),{recursive:true,force:true});
    {
      // ROUND 43 (V43o-2), both ways, on the actual extracted walk: one
      // signature that is PERMANENTLY unreadable (a transaction version this
      // reader refuses) used to hold the cursor and the backlog for good, so
      // newer transactions (n3, n4) were never read. Now it is retried for
      // UNREADABLE_SKIP_PASSES passes, then skipped and kept in unreadSkips (a
      // level page only a person clears), and the backlog drains. Control: the
      // same signature unreadable for fewer passes holds the cursor and is then
      // read, never skipped. Budget 2, history n2,n1,X,a above cursor c, and
      // n4,n3 arrive at pass 3 (the triage's wedge.mjs shape).
      // ROUND 45 (V45o-4): the retry counts are carried by the alarm's OWN state
      // write, extracted from alarm.mjs and evaluated, so this follows main().
      const unreadWrite=(fs.readFileSync(new URL('./alarm.mjs',import.meta.url),'utf8').match(/^    unreadPasses: (D\.carryUnreadPasses\([^\n]*?\)), unreadSkips:/m)||[])[1];
      const writeUnread=unreadWrite?new Function('D','prev','looked','return '+unreadWrite).bind(null,D):()=>{throw new Error('the alarm\'s unreadPasses write was not found')};
      const writeUnreadOf=(passes,looked)=>writeUnread({unreadPasses:passes},looked);
      const wedge=async permanent=>{let chain=['n2','n1','X','a'];const cursors={[L.PROGRAM_IDS.seal]:'c'},backlogs={};let passes={},skips=[];const out=[];
        for(let pass=1;pass<=6;pass++){if(pass===3)chain=['n4','n3',...chain];const read=[];
          const r=await alarmRun({...ctx,OURS:new Set(),PER_PROGRAM_READS:2,backlogs,cursors,unreadPasses:passes,findings:[],looked:{programs:0,txs:0},seenSplits:[],deferredSweeps:[],seenSweeps:[],
            conn:{getSignatureStatuses:async()=>({value:[{}]}),getSignaturesForAddress:async(_p,o)=>{const i=chain.indexOf(o.before);return i>=0&&chain[i+1]?[{signature:chain[i+1]}]:[]}},
            walkSigs:async(_c,prog,until,_p,_pp,before)=>{if(prog.toBase58()!==L.PROGRAM_IDS.seal)return {sigs:[],gap:false};const i0=before?chain.indexOf(before)+1:0;let i1=until?chain.indexOf(until):chain.length;if(i1<0)i1=chain.length;
              return {sigs:chain.slice(i0,i1).map(signature=>({signature,err:null,blockTime:fixture.blockTime})),gap:false}},
            readParsedTransaction:async(_c,sig)=>{read.push(sig);const v=structuredClone(fixture);v.transaction.signatures[0]=sig;if(sig==='X'&&(permanent||pass<4))v.version=2;return validateParsedTransaction(v,sig,{truncatedLogs:'flag'})}});
          passes=writeUnreadOf(passes,r.looked);const sk=D.detectUnreadSkips(skips,r.looked.unreadSkips,null);skips=sk.keep;
          out.push(`${read.join(',')}|${cursors[L.PROGRAM_IDS.seal]}|${r.findings.filter(f=>f.kind==='tx_unreadable').length}|${sk.findings.map(f=>`${f.kind}:${f.severity}`).join()}`)}
        return {out,skips,cleared:D.detectUnreadSkips(skips,[],skips[skips.length-1]).findings.length}};
      const {validateParsedTransaction}=await import('./txread.mjs');
      const perm=await wedge(true),ctl=await wedge(false);
      t('R43 V43o-2: a PERMANENTLY unreadable signature is retried for 3 passes, then skipped and paged as a level finding; the backlog drains and the newer n4, n3 are read; the watermark clears it',
        [D.UNREADABLE_SKIP_PASSES,perm.out,perm.skips,perm.cleared],
        [3,['n2,n1|c|0|','X,a|c|1|','X,a|c|1|','X,a|n2|0|tx_skipped_unreadable:HIGH','n4,n3|n4|0|tx_skipped_unreadable:HIGH','|n4|0|tx_skipped_unreadable:HIGH'],['X'],0]);
      t('R43 V43o-2: ...control: unreadable for only 2 passes holds the cursor, is then READ, and nothing is skipped',
        [ctl.out,ctl.skips],[['n2,n1|c|0|','X,a|c|1|','X,a|c|1|','X,a|n2|0|','n4,n3|n4|0|','|n4|0|'],[]]);
      t('R43 V43o-2: ...the retry page says which pass it is and that a skip follows',
        [/pass 1 of 3; after that it is skipped/.test((await alarmRun({...ctx,OURS:new Set(),backlogs:{},unreadPasses:{},findings:[],looked:{programs:0,txs:0},cursors:{[L.PROGRAM_IDS.seal]:'old'},readParsedTransaction:async()=>null,seenSplits:[],deferredSweeps:[],seenSweeps:[]})).findings.find(f=>f.kind==='tx_unreadable')?.detail??'')],[true]);
      // ROUND 45 (V45o-4): a flood that pushes X out of a pass's budget used to
      // reset its count (kept only for signatures attempted that pass), so X held
      // the walk for up to FOUR passes against SPEC's three. Budget 2, history b,X
      // above cursor c, three new signatures arriving before pass 2 or pass 3 (the
      // triage's flood.mjs shapes). X is permanently unreadable.
      const flood=async floodAt=>{let chain=['b','X'];const cursors={[L.PROGRAM_IDS.seal]:'c'},backlogs={};let passes={},skips=[],held=0,skipAt=0;
        for(let pass=1;pass<=7;pass++){if(pass===floodAt)chain=['f3','f2','f1',...chain];
          const r=await alarmRun({...ctx,OURS:new Set(),PER_PROGRAM_READS:2,backlogs,cursors,unreadPasses:passes,findings:[],looked:{programs:0,txs:0},seenSplits:[],deferredSweeps:[],seenSweeps:[],
            conn:{getSignatureStatuses:async()=>({value:[{}]}),getSignaturesForAddress:async(_p,o)=>{const i=chain.indexOf(o.before);return i>=0&&chain[i+1]?[{signature:chain[i+1]}]:[]}},
            walkSigs:async(_c,prog,until,_p,_pp,before)=>{if(prog.toBase58()!==L.PROGRAM_IDS.seal)return {sigs:[],gap:false};const i0=before?chain.indexOf(before)+1:0;let i1=until?chain.indexOf(until):chain.length;if(i1<0)i1=chain.length;
              return {sigs:chain.slice(i0,i1).map(signature=>({signature,err:null,blockTime:fixture.blockTime})),gap:false}},
            readParsedTransaction:async(_c,sig)=>{const v=structuredClone(fixture);v.transaction.signatures[0]=sig;if(sig==='X')v.version=2;return validateParsedTransaction(v,sig,{truncatedLogs:'flag'})}});
          passes=writeUnreadOf(passes,r.looked);skips=D.detectUnreadSkips(skips,r.looked.unreadSkips,null).keep;
          if(r.findings.some(f=>f.kind==='tx_unreadable'))held++;if(!skipAt&&skips.includes('X'))skipAt=pass}
        return [held,skipAt]};
      t('R45 V45o-4: a flood that pushes an unreadable signature past the budget no longer resets its count: it holds the walk at most UNREADABLE_SKIP_PASSES-1 passes, before or after the flood',
        [await flood(0),await flood(2),await flood(3)],[[2,3],[2,5],[2,5]]);
      t('R45 V45o-4: ...carryUnreadPasses keeps a signature this pass did not attempt, takes the new count of one it did, and drops one it read',
        D.carryUnreadPasses({X:1,Y:2,Z:1},{Y:3},new Set(['Y','Z'])),{X:1,Y:3});
      // The poster, the same way: two runs stop with the cursor held (saving only
      // the retry count); the third queues a REJECTED hand-read and moves on, and
      // the next run reads what came after it.
      const q2=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'cbob-poster43-')),'q.jsonl');fs.writeFileSync(q2,'');
      const st={cursor:'old'},runs=[];
      for(let i=0;i<4;i++){const sig=i<3?'X':'n1';let err='';
        try{await postRun({...pc,fs,QUEUE:q2,PublicKey,BURN_PROGRAM_ID:L.PROGRAM_IDS.burn,sigs:[{signature:sig,err:null,blockTime:1}],gap:false,st,queued:new Set(),
          readParsedTransaction:async(_c,x)=>x==='X'?null:{transaction:{message:{accountKeys:[],instructions:[]}},meta:{logMessages:[],innerInstructions:[]}}})}catch(e){err=/run \d of 3/.test(e.message)?'stop':e.message}
        runs.push(`${err||'ok'}|${st.cursor}|${JSON.stringify(st.unread??null)}`)}
      const rows=fs.readFileSync(q2,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).map(e=>`${e.status}:${e.web.signature}`);
      fs.rmSync(path.dirname(q2),{recursive:true,force:true});
      t('R43 V43o-2: the poster stops on an unreadable signature for two runs, then queues it REJECTED for a hand read and moves on to newer ones',
        [runs,rows],[['stop|old|{"X":1}','stop|old|{"X":2}','ok|X|null','ok|n1|null'],['rejected:X']]);
      // ROUND 44 (V44o-1): the same walk with TWO signatures, X (unreadable) newer
      // than A (readable), while a backlog drains and on a walk that gapped. The
      // next run re-walks the same window from its oldest end, and reading A used
      // to wipe the whole count, so X stayed "run 1 of 3" forever and nothing was
      // queued. State is persisted only through writeLedger, as the job does.
      const twoSig=async(initial,gap)=>{const q3=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'cbob-poster44-')),'q.jsonl');fs.writeFileSync(q3,'');
        let saved=structuredClone(initial);const out=[];
        for(let run=1;run<=4;run++){const st2=structuredClone(saved);let res='ok';
          try{await postRun({...pc,fs,QUEUE:q3,PublicKey,BURN_PROGRAM_ID:L.PROGRAM_IDS.burn,sigs:['X','A'].map(signature=>({signature,err:null,blockTime:1})),gap,st:st2,queued:new Set(),
            writeLedger:(_p,x)=>{saved=structuredClone(x)},conn:{getSignaturesForAddress:async()=>[],getSignatureStatuses:async()=>({value:[null]})},
            readParsedTransaction:async(_c,x)=>x==='X'?null:{transaction:{message:{accountKeys:[],instructions:[]}},meta:{logMessages:[],innerInstructions:[]}}})}
          catch(e){res=(e.message.match(/run (\d) of 3/)||[])[1]?`stop${e.message.match(/run (\d) of 3/)[1]}`:e.message}
          out.push(`${res}|${JSON.stringify(saved.unread??null)}`)}
        const qr=fs.readFileSync(q3,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).map(e=>`${e.status}:${e.web.signature}`);
        fs.rmSync(path.dirname(q3),{recursive:true,force:true});return [out.slice(0,3).map(o=>o.split('|')[0]),qr]};
      t('R44 V44o-1: while a backlog DRAINS, an unreadable X newer than a readable A still reaches its third run and is queued REJECTED',
        await twoSig({cursor:'c',backlog:{head:'n2',before:'n1'}},false),[['stop1','stop2','ok'],['rejected:X']]);
      t('R44 V44o-1: ...and on a walk that GAPPED, the same',
        await twoSig({cursor:'c'},true),[['stop1','stop2','ok'],['rejected:X']]);
      // ROUND 44 (V44o-2): the revenue job's split-recovery scan threw on ONE read
      // the reader refuses (here an unknown version), so the readable split beside
      // it was never seen and the returned cycle wedged every later run. The real
      // splitsSince and the real recovery block, run as written.
      const sig0=fixture.transaction.signatures[0];
      const splitConn=(withSplit)=>({getSignaturesForAddress:async(_a,o)=>o.before?[]:[{signature:'X',err:null,blockTime:fixture.blockTime},...(withSplit?[{signature:sig0,err:null,blockTime:fixture.blockTime}]:[])],
        _rpcRequest:async(_m,[sig])=>{if(sig==='X'){const v=structuredClone(fixture);v.transaction.signatures[0]='X';v.version=2;return {result:v}}return {result:structuredClone(fixture)}},
        getAccountInfo:async()=>({owner:{toBase58:()=>'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'},data:(()=>{const d=Buffer.alloc(165);d.writeBigUInt64LE(5n,64);d[108]=1;return d})(),lamports:2039280})});
      let scanned='';try{const o=await splitRun(splitConn(true),ata,fixture.blockTime-60);scanned=JSON.stringify([o.map(x=>x.total),o.refused.map(x=>x.split(' ')[0])])}catch(e){scanned='THREW '+e.message.slice(0,60)}
      t('R44 V44o-2: one REFUSED read beside a readable split: the scan returns the split and names the refused signature, never throws',scanned,JSON.stringify([['8844308'],['X']]));
      const recStart=rev.indexOf('    let returnedUnsplit = (led.cycles || [])'),recEnd=rev.indexOf('\n  const open = (led.cycles || []).filter(cycleIsOpen)',recStart);
      const recBlock=rev.slice(recStart,recEnd).replace(/\n  \}\s*$/,'');
      const recRun=new AsyncFunction('ctx','with(ctx){'+recBlock+'}');
      const recover=async(withSplit)=>{const led={cycles:[{startedAt:'2026-01-01T00:00:00Z',sweptLamports:'100000000',returnedSats:'8844308',returnSig:'r',returnBlockTime:fixture.blockTime-1}]};
        try{await recRun({led,conn:splitConn(withSplit),cycleIsOpen:D.cycleIsOpen,closesCycle:D.closesCycle,splitSig:D.splitSig,blockTimeOf:async()=>null,save:()=>{},
          getAssociatedTokenAddressSync:()=>ata,CBBTC:'C',REVENUE:'R',splitsSince:(c,a,t0)=>splitRun(c,a,t0),isProvablyEmpty:()=>false,console:{log(){}}});return `closed:${led.cycles[0].splitSig??'none'}`}
        catch(e){return /could not read 1 transaction\(s\).*X \(/.test(e.message)?'stopped naming X':'THREW '+e.message.slice(0,60)}};
      t('R44 V44o-2: ...the recovery block CLOSES the returned cycle on the readable split; with only the refused one it stops and names it (hand read, SPEC limit 10)',
        [await recover(true),await recover(false)],[`closed:${sig0}`,'stopped naming X']);
    }
    // ROUND 30 (M1), both ways: a flood larger than one pass is DRAINED. A stub
    // cluster with getSignaturesForAddress's newest-first before/until paging,
    // the real signaturesSince, and the actual extracted walk: 25,000 MINT
    // transactions after the cursor gap pass one; pass two resumes where pass
    // one stopped, reads the buried transaction just after the cursor and moves
    // the cursor to the backlog's head; pass three reads what arrived since. A
    // cleared cursor drains the same way. Lightweight stub transactions only.
    {
      const {signaturesSince}=await import('./sigwalk.mjs');
      const list=Array.from({length:25000},(_,i)=>`s${25000-i}`);
      const stubConn=extra=>({getSignatureStatuses:async()=>({value:[{}]}),getSignaturesForAddress:async(_a,o)=>{
        const all=[...extra,...list,'s0'];if(o.before&&!all.includes(o.before))return [];let i=o.before?all.indexOf(o.before)+1:0;const out=[];
        while(i<all.length&&out.length<o.limit&&all[i]!==o.until){out.push({signature:all[i],err:null,blockTime:1});i++}return out}});
      const seen=new Set(),mini={transaction:{message:{accountKeys:[{pubkey:pda}],instructions:[]}},meta:{logMessages:[],innerInstructions:[]}};
      const flood=(cursor,backlogs,extra=[],budget=20000)=>alarmRun({...ctx,OURS:new Set(),PER_PROGRAM_READS:budget,backlogs,findings:[],looked:{programs:0,txs:0},cursors:cursor?{[L.PROGRAM_IDS.mint]:cursor}:{},
        conn:stubConn(extra),walkSigs:(c,p,u,mp,lim,b)=>p.toBase58()===L.PROGRAM_IDS.mint?signaturesSince(c,p,u,mp,lim,b):{sigs:[],gap:false},
        readParsedTransaction:async(_c,sig)=>{seen.add(sig);return mini},seenSplits:[],deferredSweeps:[],seenSweeps:[]});
      const bl={},p1=await flood('s0',bl),afterP1=[seen.has('s1'),p1.findings.some(f=>f.kind==='scan_gap'),p1.cursors[L.PROGRAM_IDS.mint],bl[L.PROGRAM_IDS.mint]?.head];
      const p2=await flood(p1.cursors[L.PROGRAM_IDS.mint],bl),afterP2=[seen.has('s1'),p2.findings.some(f=>f.kind==='scan_gap'),p2.cursors[L.PROGRAM_IDS.mint],L.PROGRAM_IDS.mint in bl];
      seen.clear();const p3=await flood(p2.cursors[L.PROGRAM_IDS.mint],bl,['s25001']),afterP3=[seen.has('s25001'),seen.size,p3.cursors[L.PROGRAM_IDS.mint]];
      const bl2={},c1=await flood(undefined,bl2,[]),c2=await flood(c1.cursors[L.PROGRAM_IDS.mint],bl2,[]);
      t('R30 M1: a 25,000-transaction flood gaps one pass, then drains: the buried transaction is read and the cursor reaches the head; a cleared cursor recovers too',
        [afterP1,afterP2,afterP3,[c1.findings.some(f=>f.kind==='scan_gap'),c2.cursors[L.PROGRAM_IDS.mint]]],
        [[false,true,'s0','s25000'],[true,false,'s25000',false],[true,1,'s25001'],[true,'s25000']]);
      // Review 30: an EMPTY resumed walk is not proof the backlog drained. A
      // resume point the cluster no longer knows answers empty; the backlog is
      // KEPT and paged CRITICAL. Control: a real drain to the cursor is proven.
      const ghost={[L.PROGRAM_IDS.mint]:{head:'s25000',before:'sGONE'}},g=await flood('s0',ghost);
      const real={[L.PROGRAM_IDS.mint]:{head:'s25000',before:'s1'}},r=await flood('s0',real);
      // ROUND 31 (L2): with the shipped per-program read budget the same flood
      // drains over passes that each read at most the budget, and the buried
      // transaction is still read before the cursor reaches the head.
      {
        const blb={};let cur='s0',passes=0,maxRead=0;seen.clear();
        while(passes<30){const before=seen.size;const r=await flood(cur,blb,[],2000);passes++;maxRead=Math.max(maxRead,seen.size-before);cur=r.cursors[L.PROGRAM_IDS.mint];if(!(L.PROGRAM_IDS.mint in blb))break}
        // Review 31: a budget that is not a whole number of pages exercises the
        // trim and the over-budget gap (at 2,000 the walk itself stops there).
        const buried=seen.has('s1'),b15={};seen.clear();const r15=await flood('s0',b15,[],1500);
        // 1,799 transactions after this cursor: the walk ENDS (no gap of its own)
        // between the budget and two pages, so only the over-budget flag keeps
        // the 299 it did not read in the backlog.
        const b17={},r17=await flood('s23201',b17,[],1500);
        t('R31 L2: under a 2,000-read budget a 25,000-transaction flood drains in 13 passes, none reading more than 2,000, and the buried transaction is read; a 1,500 budget reads 1,500 and resumes after the last one read',
          [passes,maxRead<=2000,buried,cur,seen.size,b15[L.PROGRAM_IDS.mint]?.before,r15.findings.some(f=>f.kind==='scan_gap'),r17.cursors[L.PROGRAM_IDS.mint],b17[L.PROGRAM_IDS.mint]?.before],[13,true,true,'s25000',1500,'s23501',true,'s23201','s23501']);
      }
      t('R30 M1: an empty resumed walk keeps the backlog and pages CRITICAL unless the cluster proves the cursor is next; a real drain is proven',
        [g.cursors[L.PROGRAM_IDS.mint],ghost[L.PROGRAM_IDS.mint]?.before,g.findings.find(f=>f.kind==='scan_backlog_unproven')?.severity,
         r.cursors[L.PROGRAM_IDS.mint],L.PROGRAM_IDS.mint in real,r.findings.some(f=>f.kind==='scan_backlog_unproven')],
        ['s0','sGONE','CRITICAL','s25000',false,false]);
      // The poster drains the same way (its walk runs outside the extracted
      // loop, so each pass hands the loop what signaturesSince returned).
      const conn2=stubConn([]),seenP=new Set(),walk=async(st)=>signaturesSince(conn2,P(L.PROGRAM_IDS.burn),st.cursor,20,1000,st.backlog?.before);
      const pRun=async st=>{const w=await walk(st);await postRun({...pc,PublicKey,BURN_PROGRAM_ID:L.PROGRAM_IDS.burn,conn:conn2,sigs:w.sigs,gap:w.gap,st,queued:new Set(),
        readParsedTransaction:async(_c,sig)=>{seenP.add(sig);return mini}});return st};
      const ps=await pRun({cursor:'s0'}),q1=[ps.cursor,ps.backlog?.head,seenP.has('s1')];await pRun(ps);const q2=[ps.cursor,'backlog' in ps,seenP.has('s1')];
      const pg=await pRun({cursor:'s0',backlog:{head:'s25000',before:'sGONE'}}),pr=await pRun({cursor:'s0',backlog:{head:'s25000',before:'s1'}});
      t('R30 M1: the poster drains a flood across passes, and keeps a backlog whose empty resumed walk the cluster does not prove',
        [q1,q2,[pg.cursor,pg.backlog?.before],[pr.cursor,'backlog' in pr]],
        [['s0','s25000',false],['s25000',false,true],['s0','sGONE'],['s25000',false]]);
    }
  }
}
}

// Round 28: execute isolated production fragments with stubbed I/O. Never import
// the alarm entrypoint or send transactions/notifications from these tests.
{
  const { PublicKey } = await import('@solana/web3.js')
  const alarm = fsx.readFileSync(new URL('./alarm.mjs', import.meta.url), 'utf8')
  const crank = fsx.readFileSync(new URL('./crank.mjs', import.meta.url), 'utf8')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0 || s.indexOf(b, i) < 0) throw Error('missing tested fragment'); return s.slice(i, s.indexOf(b, i)) }
  const clockBody = between(alarm.slice(alarm.indexOf('async function main()')), '  const started', '  const prev')
  const clockRun = new AsyncFunction('Date', 'conn', 'SYSVAR_CLOCK_PUBKEY', 'clockUnixTimestamp', clockBody + ';return {nowSec,wallSec}')
  const chain = 1000000, clockData = Buffer.alloc(40); clockData.writeBigInt64LE(BigInt(chain), 32)
  const fakeDate = sec => class extends Date { static now() { return sec * 1000 } }
  const lockBody = between(alarm, '  const lockGate =', '\n  // What the last delivered')
  const lockRun = new Function('D', 'cfg', 'nowSec', 'lockDeadline', 'PRODUCTION', 'let findings=[];' + lockBody + ';return findings')
  for (const skew of [-7 * 3600, 7 * 3600]) {
    const c = await clockRun(fakeDate(chain + skew), { getAccountInfo: async () => ({ data: clockData }) }, {}, CR.clockUnixTimestamp)
    t(`R28 clock: actual alarm retains separate clocks under ${skew}s skew`, c, { nowSec: chain, wallSec: chain + skew })
    const after = lockRun(D, { 'prog.mint.upgrade_authority': 'key' }, c.nowSec, () => chain - 1, true)
    const before = lockRun(D, { 'prog.mint.upgrade_authority': 'key' }, c.nowSec, () => chain + 1, true)
    t(`R28 clock: actual lock wiring obeys chain deadline under ${skew}s skew`, [after.some(f => f.kind === 'program_not_locked'), before.some(f => f.kind === 'program_not_locked')], [true, false])
    const row = { startedAt: new Date((chain + skew - 10) * 1000).toISOString(), sweepSig: 's' }
    t(`R28 clock: anchored ledger age ignores ${skew}s wall skew`, (chain + skew) * 1000 - D.cycleStartMs(row, [{ sig: 's', blockTime: chain - 7200 }], (chain + skew) * 1000, chain * 1000), 7200000)
  }
  for (const data of [undefined, Buffer.alloc(39), Buffer.alloc(40)]) {
    let refused = false
    try { await clockRun(fakeDate(chain), { getAccountInfo: async () => ({ data }) }, {}, CR.clockUnixTimestamp) } catch { refused = true }
    t(`R28 clock: missing/truncated/nonpositive sysvar (${data?.length ?? 'absent'}) refuses alarm pass`, refused, true)
  }
  {
    // ROUND 39 (C01): WHAT main() SENDS, and in what order. Round 38's "joins are
    // SENT" arm read only the planner, so a sender that dropped every claim, or
    // re-ordered the steps red-team 3 finding 6 fixed, still passed. The actual
    // send block is extracted and run with recording stubs.
    const sendBlock = between(crank, '  for (const a of plan.retireBurned) {', '\n  // THE HEARTBEAT')
    const sendRun = new AsyncFunction('ctx', 'with(ctx){' + sendBlock + '}')
    const stubCtx = (plan) => { const sent = []
      const rec = (label, ixs) => { sent.push({ label, keys: ixs.flatMap(i => i.keys.map(k => String(k.pubkey ?? k))) }); return 'ok' }
      return { sent, ctx: { plan, sent, byAddr: new Map(Object.entries({ RetA: { asset: 'AssetR' }, Act1: { asset: 'AssetA' } })),
        run: async (l, i) => rec(l, i), send: async (l, i) => rec(l, i), failures: [], lastFailure: null, conn: {},
        TransactionInstruction: class { constructor(o) { Object.assign(this, o) } }, MINT: 'MINT', d: n => Buffer.from(n), Buffer,
        W: k => ({ pubkey: k }), R: k => ({ pubkey: k }), MINT_CFG: { toBase58: () => 'CFG' }, cfg: { pool_ata: 'POOL' },
        TOKEN_PROGRAM_ID: 'TOK', L, payDecimals: 8, tokens: { AssetA: { address: 'AtaA' } }, judgeDistributeRefusal: () => 'fault',
        PublicKey: class {}, console: { log() {} } } } }
    const all = { retireBurned: ['RetA'], preJoins: [['J1', 'JA1']], preExpires: ['E1'], split: false, distribute: true, postExpires: ['E2'],
      activate: ['Act1'], claims: [[['C1', 'CA1']], [['JO', 'JOA']]] }
    const a1 = stubCtx(all); await sendRun(a1.ctx)
    t('R39 C01: main() sends every step, in the red-team-3 order (retire, join, expire, distribute, expire, activate, claim)',
      a1.sent.map(x => x.label.split(' ')[0] + (x.label.startsWith('expire') ? ':' + x.label.split(' ')[2] : '')),
      ['retire', 'join', 'expire:before', 'distribute', 'expire:after', 'activate', 'claim', 'claim'])
    // And the frozen-pool case end to end: the REAL planner's plan through the REAL sender.
    // The planner block's own fixtures, restated here (they are block-scoped there).
    const Ax = i => `Asset${i}x`.padEnd(32, '1')
    const recF = { address: 'Rec0', asset: Ax(0), mint_index: 0n, reveal_slot: 1000n, level: 1, entropy_set: false, active: false, retired: false,
      vault_ata: 'Ata0', debt_scaled: 0n, attrs_hash: '', pending: true, request_epoch: 0n }
    const cfgF = { revealed_total: 0n, acc_scaled: 0n, total_active_weight: 0n, owed_scaled: 0n, last_distribute_at: 0n, monthly_secs: 100n,
      dist_epoch: 0n, pending_count: 1n, pending_this_epoch: 1n }
    const pF = CR.planCrank({ cfg: cfgF, records: [recF], tokens: {}, pool: { state: 'ok', amount: 0n, frozen: true },
      slot: 5000, nowSec: 100, bank: { state: 'ok', amount: 0n, frozen: false }, assets: { [recF.asset]: 'live' } })
    const a2 = stubCtx(pF); a2.ctx.byAddr = new Map(); await sendRun(a2.ctx)
    t('R39 C01: ...and from a FROZEN pool the planner\'s joins leave main() in a claim batch (the tick first)',
      [a2.sent.some(x => x.label.startsWith('distribute')), a2.sent.filter(x => x.label.startsWith('claim')).some(x => x.keys.includes('Rec0'))], [true, true])
  }
  {
    // ROUND 43 (V43o-3): THE REVEAL RUN, AS WRITTEN. Round 24 L2's repair (a null
    // read of a vault's asset ends the run before anything is sent, because []
    // against a live asset is refused AttributesMismatch) was pinned only by the
    // ORDER of two strings, so deleting the `break` still passed. The actual loop
    // is extracted and run with recording stubs.
    const revealBlock = between(crank, '  for (const a of plan.reveal) {', '\n  // Round 43 (V43-1): every nested vault')
    const revealRun = new AsyncFunction('ctx', 'with(ctx){' + revealBlock + '}')
    const revealCtx = (assets) => { const sent = []
      return { sent, ctx: { plan: { reveal: ['Rec1', 'Rec2'] }, assets, failures: [], conn: {},
        byAddr: new Map([['Rec1', { asset: 'AssetOne', mint_index: 1n, attrs_hash: 'h' }], ['Rec2', { asset: 'AssetTwo', mint_index: 2n, attrs_hash: 'h' }]]),
        revealAttrSource: CR.revealAttrSource, mintedAttributes: async () => [['k', 'v']], judgeRevealAttrs: () => 'match', P: k => k,
        send: async (label, ixs) => { sent.push(label); return 'ok' }, TransactionInstruction: class { constructor(o) { Object.assign(this, o) } },
        MINT: 'MINT', d: n => Buffer.from(n), attrsBorsh: () => Buffer.alloc(0), Buffer, W: k => ({ pubkey: k }), R: k => ({ pubkey: k }),
        MINT_CFG: { toBase58: () => 'CFG' }, MINT_AUTH: { toBase58: () => 'AUTH' }, cfg: { collection: 'COLL' }, payer: { publicKey: 'PAYER' },
        SLOT_HASHES_ID: 'SH', CORE_ID: 'CORE', SystemProgram: { programId: { toBase58: () => 'SYS' } }, console: { log() {} } } } }
    const sk = revealCtx({ AssetOne: 'other', AssetTwo: 'live' }); await revealRun(sk.ctx)
    t('V43o-3: an asset that reads as neither live nor burned ENDS the reveal run: nothing is sent, not even for the next record',
      [sk.sent, sk.ctx.failures], [[], []])
    const un = revealCtx({ AssetTwo: 'live' }); await revealRun(un.ctx)
    t('V43o-3: ...and so does an asset that was never read at all', un.sent, [])
    const go = revealCtx({ AssetOne: 'burned', AssetTwo: 'live' }); await revealRun(go.ctx)
    t('V43o-3: ...while a BURNED asset is revealed (with []) and the run goes on to the next record, so the stubs can see a send',
      go.sent, ['reveal #1 AssetOne', 'reveal #2 AssetTwo'])
  }
  {
    // ROUND 39 (C02): the alarm's BASELINE WRITES, run as written. Round 24 L7's
    // repair (a null element carried forward, never stored as 0) had only a regex
    // gate, so restoring the original line or deleting the write passed.
    const alarmSrc = fsx.readFileSync(new URL('./alarm.mjs', import.meta.url), 'utf8')
    const each = between(alarmSrc, '    chunk.forEach((l, j) => {', '\n    })\n') + '\n    })'
    const writeRun = new Function('ctx', 'with(ctx){' + each + '}')
    const SPLm = SPL, tokInfo = (amt) => { const d = Buffer.alloc(165); d.writeBigUInt64LE(amt, 64); d[108] = 1; return { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', data: d } }
    const bctx = { chunk: [{ key: 'k1', vault: 'V1', mint: 'M1' }, { key: 'k2', vault: 'V2', mint: 'M2' }], infos: [tokInfo(100n), null],
      prev: { balances: { k2: '500' } }, readTokenAccount: SPLm.readTokenAccount, D, L, balances: {}, findings: [], payment: { toBase58: () => 'M1' } }
    let threw = null; try { writeRun(bctx) } catch (e) { threw = e.message }
    t('R39 C02: the balance write stores a read balance, CARRIES a null element\'s last value (never 0), and pages it',
      [threw, bctx.balances, bctx.findings.some(f => f.kind === 'balance_unreadable' && f.asset === 'V2')], [null, { k1: '100', k2: '500' }, true])
    const vline = (alarmSrc.match(/^    vaults: (setChange\.trustCurrent \? vaults : \(prev\?\.vaults \|\| vaults\)) }/m) || [])[1]
    const pick = vline ? new Function('setChange', 'prev', 'vaults', 'return ' + vline) : () => 'MISSING'
    t('R39 C02: the vault set reported untrustworthy is NOT adopted as the new baseline (the trusted one is)',
      [pick({ trustCurrent: false }, { vaults: ['A', 'B'] }, ['A']), pick({ trustCurrent: true }, { vaults: ['A', 'B'] }, ['A'])], [['A', 'B'], ['A']])
    // ROUND 42 (C01): the WHOLE balance block, run as written, across a shrink. A
    // pass whose index list shrank (untrusted) must still read and keep every
    // STORED vault's reserve, so a fall in a vault the short list omitted is paged
    // (in that pass, and against a kept baseline in the next).
    const block = between(alarmSrc, '  const balances = {}\n', '  findings.push(...D.detectBalanceDrops(prev?.balances, balances))')
      + '  findings.push(...D.detectBalanceDrops(prev?.balances, balances))\n  return balances'
    const blockRun = new AsyncFunction('ctx', 'with(ctx){' + block + '}')
    const W3b = await import('@solana/web3.js')
    const VS = Array.from({ length: 10 }, () => W3b.Keypair.generate().publicKey.toBase58()), MINTX = W3b.Keypair.generate().publicKey.toBase58()
    const passOf = async ({ listed, trustCurrent, prev, held }) => {
      const pdaOfX = {}
      const ctx = { setChange: { trustCurrent }, vaults: listed, burnt: [], prev, pdaOf: pdaOfX, CORE: 'CORE', PublicKey: W3b.PublicKey, Buffer,
        pda: seeds => ({ toBase58: () => 'p' + new W3b.PublicKey(seeds[1]).toBase58() }), ata: (m, p) => ({ v: p.toBase58().slice(1) }),
        cfg: { 'seal.reserve_mints': [MINTX] }, payment: { toBase58: () => MINTX },
        conn: { getMultipleAccountsInfo: async addrs => addrs.map(a => { const d = Buffer.alloc(165); d.writeBigUInt64LE(held[a.v], 64); d[108] = 1
          return { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', data: d } }) },
        readTokenAccount: SPL.readTokenAccount, D, L, findings: [] }
      for (const v of listed) pdaOfX[v] = ctx.pda([Buffer.from('x'), new W3b.PublicKey(v).toBuffer()])
      const balances = await blockRun(ctx)
      return { balances, fell: ctx.findings.filter(f => f.kind === 'reserve_fell').map(f => f.asset ?? f.vault ?? f.key) }
    }
    const full = Object.fromEntries(VS.map(v => [v, 100n]))
    const p1 = await passOf({ listed: VS, trustCurrent: true, prev: null, held: full })
    const p2 = await passOf({ listed: [VS[0]], trustCurrent: false, prev: { balances: p1.balances, vaults: VS }, held: full })
    const p3 = await passOf({ listed: VS, trustCurrent: true, prev: { balances: p2.balances, vaults: VS }, held: { ...full, [VS[5]]: 50n } })
    t('R42 C01: after a SHRUNK index pass, every stored vault keeps its reserve baseline, and a later fall in an OMITTED vault is paged',
      [Object.keys(p2.balances).length, p3.fell.length === 1 && JSON.stringify(p3.fell).includes(VS[5].slice(0, 8))], [10, true])
    const p2b = await passOf({ listed: [VS[0]], trustCurrent: false, prev: { balances: p1.balances, vaults: VS }, held: { ...full, [VS[7]]: 40n } })
    t('R42 C01: ...and a fall in an omitted vault DURING the shrunk pass is paged in that pass (the stored set is read)',
      p2b.fell.length === 1 && JSON.stringify(p2b.fell).includes(VS[7].slice(0, 8)), true)
    // ROUND 44 (V44o-3): the same block across a ONE-PASS null SEAL config (cfg
    // without seal.*, as readConfigs leaves it). It used to fall back to cbBTC
    // alone, store cbBTC keys only (6 -> 2 here) and never compare a $GARY fall
    // across that window. Now the reserve list comes from the carried config,
    // and any stored leg not built is carried forward and paged.
    {
      const V2 = VS.slice(0, 2), GARYX = W3b.Keypair.generate().publicKey.toBase58(), GIRAX = W3b.Keypair.generate().publicKey.toBase58()
      const R3 = [MINTX, GARYX, GIRAX]
      const sealPass = async ({ sealReadable, held, prev }) => {
        const pdaOfX = {}
        const ctx = { setChange: { trustCurrent: true }, vaults: V2, burnt: [], prev, pdaOf: pdaOfX, CORE: 'CORE', PublicKey: W3b.PublicKey, Buffer,
          pda: seeds => ({ toBase58: () => 'p' + new W3b.PublicKey(seeds[1]).toBase58() }), ata: (m, p) => ({ v: `${p.toBase58().slice(1)}|${m.toBase58()}` }),
          cfg: sealReadable ? { 'seal.reserve_mints': R3 } : { 'seal._missing': true }, payment: { toBase58: () => MINTX },
          conn: { getMultipleAccountsInfo: async addrs => addrs.map(a => { const d = Buffer.alloc(165); d.writeBigUInt64LE(held[a.v] ?? 0n, 64); d[108] = 1
            return { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', data: d } }) },
          readTokenAccount: SPL.readTokenAccount, D, L, findings: [] }
        for (const v of V2) pdaOfX[v] = ctx.pda([Buffer.from('x'), new W3b.PublicKey(v).toBuffer()])
        const balances = await blockRun(ctx)
        return { balances, unread: ctx.findings.filter(f => f.kind === 'balance_unreadable').length,
          fell: ctx.findings.filter(f => f.kind === 'reserve_fell').map(f => f.mint === GARYX ? 'GARY' : f.mint === GIRAX ? 'GIRA' : 'cbBTC') }
      }
      const fullR = {}; for (const v of V2) for (const m of R3) fullR[`${v}|${m}`] = 1000n
      const drainedR = { ...fullR, [`${V2[0]}|${GARYX}`]: 1n }
      const run3 = async (blip, withConfig) => {
        const q1 = await sealPass({ sealReadable: true, held: fullR, prev: null })
        const cfg1 = withConfig ? { 'seal.reserve_mints': R3 } : undefined
        const q2 = await sealPass({ sealReadable: !blip, held: fullR, prev: { balances: q1.balances, config: cfg1 } })
        const q3 = await sealPass({ sealReadable: true, held: drainedR, prev: { balances: q2.balances, config: cfg1 } })
        return [Object.keys(q1.balances).length, Object.keys(q2.balances).length, q2.unread, q3.fell]
      }
      t('R44 V44o-3: a ONE-PASS null SEAL config keeps every vault\'s $GARY and $GIRAFFISH baseline (from the carried config), and a later $GARY fall is paged',
        await run3(true, true), [6, 6, 0, ['GARY']])
      t('R44 V44o-3: ...with no carried config either, the unbuilt legs are carried forward and paged, never dropped, and the fall is still paged',
        await run3(true, false), [6, 6, 1, ['GARY']])
      t('R44 V44o-3: ...control: SEAL readable throughout keeps all six and pages the same fall',
        await run3(false, true), [6, 6, 0, ['GARY']])
    }
    // ROUND 45 (V45o-1): V44o-3 carried the reserve list into the balance block
    // only. The per-pass ATA maps and the daily reconcile still read a null SEAL
    // config as "no reserve mints": a canonical reserve ATA created that pass paged
    // non_ata_token_account CRITICAL, and the reconcile paged every canonical
    // account undeclared (three a vault). Both blocks run as written.
    {
      const RM = D.RESERVE_MINTS, V2x = [W3b.Keypair.generate().publicKey.toBase58(), W3b.Keypair.generate().publicKey.toBase58()]
      const pdaX = seeds => { const k = 'pda' + new W3b.PublicKey(seeds[1]).toBase58().slice(0, 20); return { toBase58: () => k } }
      const ataX = (m, p) => ({ toBase58: () => `${p.toBase58()}|${m.toBase58()}` })
      const mapsBlock = between(alarmSrc, "  const payment = new PublicKey(cfg['mint.payment_mint']", '  // ---- cbBTC balances, read fresh every pass ----') + '\n  return { pdas, atas, ataOwner }'
      const mapsRun = new Function('ctx', 'with(ctx){' + mapsBlock + '}')
      const createdOn = (sealReadable, prevCfg) => {
        const m = mapsRun({ cfg: sealReadable ? { 'seal.reserve_mints': RM } : { 'seal._missing': true }, prev: prevCfg ? { config: prevCfg } : null, D, PublicKey: W3b.PublicKey, Buffer,
          CBBTC: new W3b.PublicKey(RM[0]), vaults: V2x, burnt: [], CORE: 'CORE', pda: pdaX, ata: ataX, pdas: new Set(), atas: new Set(), ataOwner: {}, pdaOf: {} })
        const p0 = pdaX([0, new W3b.PublicKey(V2x[0]).toBuffer()]).toBase58()
        return D.detectPdaTokenAccounts([{ program: D.ATA_ID, parsed: { info: { wallet: p0, account: `${p0}|${RM[1]}` } } }], m.pdas, m.atas).map(f => `${f.kind}:${f.severity}`)
      }
      t('R45 V45o-1: a canonical reserve ATA created during a pass that reads SEAL as null is reserve_ata_created INFO (carried list), never non_ata_token_account CRITICAL',
        [createdOn(true, null), createdOn(false, { 'seal.reserve_mints': RM }), createdOn(false, null)], [['reserve_ata_created:INFO'], ['reserve_ata_created:INFO'], ['reserve_ata_created:INFO']])
      const recBlock = between(alarmSrc, '  const findings = [...indexFindings,', '  console.log(`reconcile:') + '\n  return findings'
      const AsyncFunctionX = Object.getPrototypeOf(async function () {}).constructor
      const recRun = new AsyncFunctionX('ctx', 'with(ctx){' + recBlock + '}')
      const tokData = () => { const d = Buffer.alloc(165); d.writeBigUInt64LE(5n, 64); d[108] = 1; return d }
      const reconcileOn = async (sealReadable, stored) => {
        try {
          const f = await recRun({ indexFindings: [], D, everyVault: [], live: V2x, CORE: 'CORE', pda: pdaX, ata: ataX, PublicKey: W3b.PublicKey, Buffer,
            cfg: sealReadable ? { 'seal.reserve_mints': RM } : { 'seal._missing': true }, readState: () => stored ? { config: stored } : null,
            TOK: { toBase58: () => D.TOKEN_ID }, conn: { getTokenAccountsByOwner: async (p, o) => ({ value: o.programId.toBase58() === D.TOKEN_ID
              ? RM.map(m => ({ pubkey: { toBase58: () => `${p.toBase58()}|${m}` }, account: { owner: { toBase58: () => D.TOKEN_ID }, data: tokData() } })) : [] }) } })
          return f.filter(x => x.kind === 'undeclared_token_account').length
        } catch (e) { return /SEAL.s config is unreadable/.test(e.message) ? 'refused' : e.message }
      }
      t('R45 V45o-1: the daily reconcile over canonical accounts with SEAL read as null pages NOTHING (the stored list is carried), and with nothing stored it REFUSES rather than page every account',
        [await reconcileOn(true, null), await reconcileOn(false, { 'seal.reserve_mints': RM }), await reconcileOn(false, null)], [0, 0, 'refused'])
    }
  }
  {
    // ROUND 40 (C10, a measured rejection, pinned): the crank's reveal reads a
    // vault's attributes through mpl-core's deserializeAssetV1 (mintedAttributes).
    // Hand-built Core accounts: the richest real shape (seal, attributes, five owner
    // plugins, a 20-signature autograph) and vaults carrying plugin types Core does
    // not know (77, 40). If an SDK bump ever makes either unreadable, this fails.
    const W3 = await import('@solana/web3.js')
    const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }, u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
    const str = x => Buffer.concat([u32(Buffer.byteLength(x)), Buffer.from(x)]), key = () => W3.Keypair.generate().publicKey
    const asset = plugins => {
      const base = Buffer.concat([Buffer.from([1]), key().toBuffer(), Buffer.from([2]), key().toBuffer(), str('CBOB Vault'), str('u'), Buffer.from([0])])
      let at = base.length + 9; const bodies = [], reg = [Buffer.from([4]), u32(plugins.length)]
      for (const [t, b, auth] of plugins) { reg.push(Buffer.from([t, auth]), u64(at)); const body = Buffer.concat([Buffer.from([t]), b]); bodies.push(body); at += body.length }
      reg.push(u32(0))
      return Buffer.concat([base, Buffer.from([3]), u64(at), ...bodies, ...reg]) }
    const attrs = Buffer.concat([u32(1), str('level'), str('III')])
    const rich = asset([[17, Buffer.from([1]), 2], [6, attrs, 2], [1, Buffer.from([1]), 1], [2, Buffer.alloc(0), 1], [3, Buffer.alloc(0), 1], [16, Buffer.from([0]), 1],
      [14, Buffer.concat([u32(20), ...Array.from({ length: 20 }, () => Buffer.concat([key().toBuffer(), str('x'.repeat(200))]))]), 1]])
    const unknown = t => asset([[17, Buffer.from([1]), 2], [6, attrs, 2], [t, t === 40 ? Buffer.from([1, 2, 3]) : Buffer.alloc(0), 1]])
    const readVia = async data => { const conn = { getAccountInfo: async () => ({ data, owner: { toBase58: () => 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d' }, lamports: 1 }) }
      try { return JSON.stringify(await CR.mintedAttributes(conn, key())) } catch (e) { return 'THROWS ' + e.message.slice(0, 80) } }
    const want = JSON.stringify([{ key: 'level', value: 'III' }])
    t('R40 C10: the crank\'s attribute reader reads the richest vault shape and vaults with plugin types Core does not know (77, 40)',
      [await readVia(rich), await readVia(unknown(77)), await readVia(unknown(40))], [want, want, want])
  }
  {
    // ROUND 39 W1 (carried; a measured rejection, pinned): bank/txread.mjs does NOT
    // refuse a Token-2022 transferCheckedWithFee (it carries tokenAmount and
    // feeAmount, no `amount`); the amount check covers only transfer,
    // transferChecked, approve and approveChecked. Controls both ways.
    const W3 = await import('@solana/web3.js'), { validateParsedTransaction } = await import('./txread.mjs')
    const k = () => W3.Keypair.generate().publicKey.toBase58(), fp = k(), sig = '5'.repeat(88), T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
    const src = k(), dst = k(), mnt = k()
    const txOf = ix => ({ version: 'legacy', slot: 1, blockTime: 1, transaction: { signatures: [sig], message: { recentBlockhash: k(),
      accountKeys: [fp, T22, src, dst, mnt].map((x, i) => ({ pubkey: x, signer: i === 0, writable: i !== 1 })), instructions: [ix] } },
      meta: { err: null, fee: 5000, preBalances: [1, 1, 1, 1, 1], postBalances: [1, 1, 1, 1, 1], logMessages: [], innerInstructions: [], preTokenBalances: [], postTokenBalances: [] } })
    const ix = (type, info) => ({ programId: T22, program: 'spl-token', parsed: { type, info: { source: src, destination: dst, mint: mnt, authority: fp, ...info } } })
    const verdict = x => { try { validateParsedTransaction(txOf(x), sig); return 'accepted' } catch (e) { return /token movement amount/.test(e.message) ? 'refused:amount' : 'refused:other' } }
    const amt = a => ({ amount: a, decimals: 6, uiAmount: Number(a) / 1e6, uiAmountString: String(Number(a) / 1e6) })
    t('R39 W1: txread accepts a Token-2022 transferCheckedWithFee (tokenAmount + feeAmount), refuses a transfer with no amount, accepts one with it',
      [verdict(ix('transferCheckedWithFee', { tokenAmount: amt('100'), feeAmount: amt('1') })), verdict(ix('transfer', {})), verdict(ix('transfer', { amount: '100' }))],
      ['accepted', 'refused:amount', 'accepted'])
  }
  {
    // ROUND 41 (C01): ONE DRAFT PER REDEMPTION. The poster's ACTUAL loop on one
    // transaction carrying TWO CBOB_REDEEMED events must draft both (it keyed on
    // the signature and silently skipped the second).
    const W3 = await import('@solana/web3.js'), os = await import('os'), pathm = await import('path')
    const post = fsx.readFileSync(new URL('./redemption-poster.mjs', import.meta.url), 'utf8')
    const pstart = post.indexOf('  let drafted = 0', post.indexOf('async function main()')), pend = post.indexOf('\n  console.log(`${drafted} redemption', pstart)
    const loop = new AsyncFunction('ctx', 'with(ctx){' + post.slice(pstart, pend) + ';return {st,drafted}}')
    const dflt = t => t === 'Pubkey' ? W3.PublicKey.default.toBase58() : t === 'bool' ? false : /^u(8|16|32)$/.test(t) ? 0 : /^(u64|i64|u128)$/.test(t) ? 0n
      : t === '[u32; 5]' ? [0, 0, 0, 0, 0] : t === '[u8; 32]' ? '00'.repeat(32) : t === '[i64; 64]' || t === '[u32; BOOST_RING]' ? Array(64).fill(0) : t === 'Vec<Pubkey>' ? [] : (() => { throw new Error(t) })()
    const recOf = (asset, mint_index, level) => { const o = {}; for (const [f, ty] of L.STRUCTS.VaultRecord.fields) o[f] = dflt(ty)
      o.version = L.STRUCTS.VaultRecord.version; o.asset = asset; o.mint_index = mint_index; o.level = level; return L.encode('VaultRecord', o) }
    const MINTp = new W3.PublicKey(L.PROGRAM_IDS.mint), BURNid = L.PROGRAM_IDS.burn
    const runPoster = async levels => {
      const assets = levels.map(() => W3.Keypair.generate().publicKey.toBase58()), logs = []
      assets.forEach(a => logs.push(`Program ${BURNid} invoke [1]`, `Program log: CBOB_REDEEMED ${a}`, `Program ${BURNid} success`))
      const accts = {}; assets.forEach((a, i) => { const r = W3.PublicKey.findProgramAddressSync([Buffer.from(L.SEEDS.vault), new W3.PublicKey(a).toBuffer()], MINTp)[0]; accts[r.toBase58()] = { data: recOf(a, 10 + i, levels[i]) } })
      const sig = '2'.repeat(88), dir = fsx.mkdtempSync(pathm.join(os.tmpdir(), 'cbob-r41-poster-')), q = pathm.join(dir, 'q.jsonl'); fsx.writeFileSync(q, '')
      const tx = { meta: { logMessages: logs, preTokenBalances: [], postTokenBalances: [], preBalances: [], postBalances: [] }, transaction: { message: { accountKeys: [], instructions: [] } } }
      const ctx = { sigs: [{ signature: sig, err: null, blockTime: 1 }], gap: false, draining: null, conn: { getAccountInfo: async k => accts[k.toBase58()] ?? null },
        st: { cursor: 'old' }, queued: new Set(), fs: fsx, QUEUE: q, readParsedTransaction: async () => tx, parseCbobLogs: D.parseCbobLogs, PublicKey: W3.PublicKey, L, MINT: MINTp,
        BURN_PROGRAM_ID: BURNid, draftPost: PO.draftPost, draftKey: PO.draftKey, releasedFromTx: () => [], STATE: 'scratch-only', writeLedger: () => {} }
      const r = await loop(ctx), lines = fsx.readFileSync(q, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
      // a second pass over the SAME transaction (a crash before the cursor save) drafts nothing new
      ctx.queued = new Set(lines.map(l => PO.draftKey(l.web))); ctx.st = { cursor: 'old' }; const again = await loop(ctx)
      fsx.rmSync(dir, { recursive: true, force: true })
      return [r.drafted, lines.map(l => l.web.vault), again.drafted] }
    t('R41 C01: two redemptions in ONE transaction get TWO drafts, and re-reading the transaction drafts nothing twice',
      await runPoster([3, 2]), [2, ['0011', '0012'], 0])
    // ROUND 41 (C04, a measured rejection pinned): a redemption of an UNDRAWN
    // (level 0) vault is REFUSED loudly: the run throws, nothing is queued and the
    // cursor stays, so a human sees it; it clears once the level is drawn.
    let l0 = null; try { await runPoster([0]); l0 = 'no throw' } catch (e) { l0 = e.message }
    t('R41 C04: a level-0 redemption makes the poster loop REFUSE (throws "is not I..V"), never draft "Level undefined"', /is not I\.\.V/.test(l0), true)
  }
  {
    // ROUND 42 (pre-round drift A1-A3): a stranger's lamports at an address created
    // LATER (System-owned, no data) is NOT CREATED YET in bank/ too, never foreign.
    const W3 = await import('@solana/web3.js'), AN = await import('./anchor.mjs')
    const SYS = '11111111111111111111111111111111', sys = { toBase58: () => SYS, toString: () => SYS }
    const dust = { owner: sys, data: Buffer.alloc(0), lamports: 650_240 }, sysData = { owner: sys, data: Buffer.alloc(8), lamports: 1 }
    const other = { owner: { toBase58: () => 'Other1111111111111111111111111111111111111', toString: () => 'Other1111111111111111111111111111111111111' }, data: Buffer.alloc(300), lamports: 1 }
    const pinned = a => { try { return String(AN.pinnedAccountData(a, { program: new W3.PublicKey(L.PROGRAM_IDS.mint), struct: 'MintConfig', version: 6, what: 'MINT config' })) } catch { return 'throws' } }
    t('R42 A1: a dusted config reads as NOT CREATED (null); a foreign-owned or System-owned-with-data one still refuses',
      [AN.isSystemDust(dust), pinned(dust), pinned(sysData), pinned(other)], [true, 'null', 'throws', 'throws'])
    t('R42 A2/A3: a dusted token-account address reads ABSENT (so the operator ATA is created and no balance_unreadable pages); foreign and short still are not',
      [SPL.readTokenAccount({ owner: SYS, data: Buffer.alloc(0) }).state, SPL.readTokenAccount({ owner: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', data: Buffer.alloc(165) }).state,
       SPL.readTokenAccount({ owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', data: Buffer.alloc(10) }).state, SPL.readTokenAccount({ owner: SYS, data: Buffer.alloc(8) }).state],
      ['absent', 'foreign', 'malformed', 'foreign'])
    // The alarm's ACTUAL config read, run as written: a dusted config is `_missing`, the pass does not throw.
    const alarmSrc2 = fsx.readFileSync(new URL('./alarm.mjs', import.meta.url), 'utf8')
    const gSrc = between(alarmSrc2, '  const g = async (key, structName, seeds, prog) => {', "\n  await g('seal'")
    const gRun = new AsyncFunction('ctx', 'with(ctx){' + gSrc + "\n  await g('mint', 'MintConfig', [L.SEEDS.mintConfig], MINT); return snap }")
    const gctx = acc => ({ snap: {}, pda: () => new W3.PublicKey(L.PROGRAM_IDS.mint), conn: { getAccountInfo: async () => acc }, L, PublicKey: W3.PublicKey,
      isSystemDust: AN.isSystemDust, MINT: new W3.PublicKey(L.PROGRAM_IDS.mint), Buffer })
    let gOut, gThrew = null; try { gOut = await gRun(gctx(dust)) } catch (e) { gThrew = e.message }
    let oThrew = false; try { await gRun(gctx(other)) } catch { oThrew = true }
    t('R42 A1: the alarm\'s actual config read marks a DUSTED config `_missing` without throwing (a foreign-owned one still throws)',
      [gThrew, gOut?.['mint._missing'], oThrew], [null, true, true])
  }
  const crankClock = between(crank, '  let chainSec = null', '\n  console.log(`crank')
  const crankRun = new AsyncFunction('ctx', 'with(ctx){' + crankClock + ';return plan}')
  let planned = false
  const cx = { conn: { getAccountInfo: async () => null }, SYSVAR_CLOCK_PUBKEY: {}, clockUnixTimestamp: CR.clockUnixTimestamp, planCrank: () => { planned = true; return {} }, cfg: {}, records: [], assets: {}, tokens: {}, pool: {}, slot: 1, revenue: {}, bank: {}, REVEAL_ONLY: false }
  let refused = false; try { await crankRun(cx) } catch { refused = true }
  t('R28 clock: actual crank refuses before planning when chain clock is missing', [refused, planned], [true, false])
  const migrate = between(alarm, "  if (prev?.revenueClock !== 'chain'", '  const crankHealth =')
  const revRun = new Function('prev', 'revenueRead', 'nowSec', 'D', 'const findings=[],seenSplits=[];' + migrate + ';return {revenueSince,findings}')
  const legacy = { revenueSince: chain + 90000 }
  const migrated = revRun(legacy, { state: 'ok', amount: 1n }, chain, D)
  t('R28 clock: legacy mixed timer produces a notice and a chain baseline', [migrated.revenueSince, migrated.findings.map(f => f.kind)], [chain, ['revenue_age_unknown']])
  t('R28 clock: zero legacy balance requires no unknown-age notice', revRun(legacy, { state: 'ok', amount: 0n }, chain, D), { revenueSince: null, findings: [] })
  t('R28 clock: existing chain timer keeps its age', revRun({ revenueClock: 'chain', revenueSince: chain - 90000 }, { state: 'ok', amount: 1n }, chain, D), { revenueSince: chain - 90000, findings: [] })
  const unreadRevenue = revRun(legacy, { state: 'absent' }, chain, D)
  t('R28 clock: an unreadable account retains the legacy age until it can be migrated', [unreadRevenue.revenueSince, unreadRevenue.findings.map(f => f.kind)], [legacy.revenueSince, ['revenue_account_unreadable']])
  const retryBody = between(alarm, '  if (!delivered) {', '  if (!DRY) writeState(next)')
  const retry = new Function('ctx', 'with(ctx){' + retryBody + ';return next}')
  const pending = { delivered: false, next: { revenueSince: chain, revenueClock: 'chain' }, prev: legacy, cfg: {}, balances: {}, deferredSweeps: [], sent: { paged: [] } }
  const retried = retry(pending)
  t('R28 clock: undelivered migration notice retains its old timer/domain for retry', [retried.revenueSince, retried.revenueClock], [legacy.revenueSince, null])
  const done = retry({ ...pending, delivered: true, next: { revenueSince: chain, revenueClock: 'chain' } })
  t('R28 clock: delivered migration records the chain domain', [done.revenueSince, done.revenueClock], [chain, 'chain'])
  const postureLine = alarm.match(/^  const posture = .*$/m)[0]
  const silentLine = alarm.match(/^  findings.push\(\.\.\.D.detectCrankSilent.*$/m)[0]
  const heartbeatRun = new Function('D', 'wallSec', 'nowSec', 'beat', 'const findings=[],prev={crankArmedSince:1},crontabRead={};' + postureLine + ';const crankArmedSince=posture.armedSince;' + silentLine + ';return findings')
  const clockD = { ...D, crankPosture: () => 'armed' }
  t('R28 clock: actual heartbeat wiring uses local elapsed time, not skewed chain time', heartbeatRun(clockD, chain, chain + 90000, JSON.stringify({ atSec: chain })).length, 0)

  const records = Array.from({ length: 150 }, (_, i) => { const b = Buffer.alloc(32); b.writeUInt32LE(i + 1); return { address: new PublicKey(b).toBase58(), asset: new PublicKey(b).toBase58(), mint_index: BigInt(i), level: 1, active: true, retired: false, vault_ata: 'ata', debt_scaled: 0n } })
  const cfg = { revealed_total: 150n, acc_scaled: 10n * AC.ACC_SCALE, total_active_weight: 300n, owed_scaled: 0n, last_distribute_at: 0n, monthly_secs: 100n, dist_epoch: 0n, pending_count: 0n, pending_this_epoch: 0n }
  const beatBody = between(crank, '    try { fs.writeFileSync(BEAT, JSON.stringify', '\n  }\n\n  // ROUND 24 (H1)')
  const writeBeat = new Function('fs', 'BEAT', 'Date', 'plan', 'failures', beatBody)
  let health, emitted
  for (let i = 0; i < 3; i++) {
    const off = i * 50
    const plan = CR.planCrank({ cfg, records: [...records.slice(off), ...records.slice(0, off)], assets: {}, tokens: {}, pool: { state: 'ok', amount: 0n, frozen: false }, slot: 1000, nowSec: 0 })
    writeBeat({ writeFileSync: (_, text) => { emitted = D.readCrankBeat(text) } }, 'stub', fakeDate(i + 1), plan, [])
    health = D.detectCrankHealth({ beat: emitted, prev: health?.next })
  }
  t('R28 heartbeat: actual writer retains 150 rotating planner problems', emitted.problems.length, 150)
  t('R28 heartbeat: every persistent problem reaches its third-pass alarm', health.findings.filter(f => f.kind === 'crank_problem').length, 150)

  const prior = D.rememberRedemptions([], [{ kind: 'burn_via_program', asset: 'A', signature: 'confirmed' }])
  const late = D.detectVaultSetChange(['A', 'B'], { live: [], burnt: ['A', 'B'] }).findings
  t('R28 burn: earlier confirmed instruction evidence correlates later DAS burn only for that asset', D.correlateBurns(late, prior).map(f => [f.asset, f.severity]), [['A', 'INFO'], ['B', 'CRITICAL']])
  t('R28 burn: an untrusted event or missing signature is not persisted evidence', D.rememberRedemptions([], [{ kind: 'redeemed', asset: 'A', signature: 'log' }, { kind: 'burn_via_program', asset: 'B' }]), [])
  t('R28 burn: duplicate scans persist one confirmed redemption', D.rememberRedemptions(prior, [{ kind: 'burn_via_program', asset: 'A', signature: 'confirmed' }]), prior)
  const noise = ['absent', 'foreign', 'malformed'].map(state => ({ kind: 'balance_unreadable', asset: 'A', severity: 'HIGH', state }))
  noise.push({ kind: 'balance_unreadable', severity: 'HIGH' }, { kind: 'approve', asset: 'A', severity: 'CRITICAL' })
  t('R28 burn: only an absent account on the redeemed asset is expected', D.correlateBurns(noise, prior).map(f => f.severity), ['INFO', 'HIGH', 'HIGH', 'HIGH', 'CRITICAL'])

  // Run the actual rehearsal substitution/proof engine on a disposable git
  // fixture. No production worktree or keypair is touched.
  const os = await import('node:os'), path = await import('node:path')
  const rehearsal = fsx.readFileSync(new URL('../scripts/rehearsal-tree.sh', import.meta.url), 'utf8')
  const py = rehearsal.split("python3 - \"$DEST\" \"$MAP\" <<'EOF'\n")[1].split('\nEOF')[0]
  const fixtureRoot = fsx.mkdtempSync(path.join(os.tmpdir(), 'cbob-rehearsal-proof-'))
  try {
    const fixtureGit = (...args) => CP.execFileSync('git', ['-C', fixtureRoot, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    fixtureGit('init', '-q')
    const programFiles = ['cbob-vaults', 'cbob-vault-mint', 'cbob-vault-burn', 'cbob-vault-gov', 'cbob-vault-sweep']
    const ids = ['seal', 'mint', 'burn', 'gov', 'sweep'].map(k => L.PROGRAM_IDS[k])
    for (let i = 0; i < programFiles.length; i++) {
      const file = path.join(fixtureRoot, 'programs', programFiles[i], 'src/lib.rs')
      fsx.mkdirSync(path.dirname(file), { recursive: true }); fsx.writeFileSync(file, ids[i])
    }
    fsx.mkdirSync(path.join(fixtureRoot, 'bank')); fsx.writeFileSync(path.join(fixtureRoot, 'bank/layout.mjs'), ids.join('\n'))
    fsx.mkdirSync(path.join(fixtureRoot, 'launch'))
    const launchSource = fsx.readFileSync(new URL('../launch/create-cbob-token.mjs', import.meta.url), 'utf8')
    fsx.writeFileSync(path.join(fixtureRoot, 'launch/create-cbob-token.mjs'), launchSource)
    fixtureGit('add', 'programs', 'bank', 'launch')
    fixtureGit('-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'fixture')
    const mapFile = path.join(fixtureRoot, '.map')
    const mapped = ids.map((id, i) => `${id} ${new PublicKey(Buffer.alloc(32, 70 + i)).toBase58()}`).join('\n')
      + `\n/opt/cbob-vaults ${fixtureRoot}\n`
    fsx.writeFileSync(mapFile, mapped)
    const runMap = source => {
      fixtureGit('checkout', '--', '.')
      CP.execFileSync('python3', ['-c', source, fixtureRoot, mapFile], { stdio: ['ignore', 'pipe', 'pipe'] })
      const result = fsx.readFileSync(path.join(fixtureRoot, 'launch/create-cbob-token.mjs'), 'utf8')
      return !result.includes('/opt/cbob-vaults/') && result.includes(fixtureRoot + '/bank/keys')
    }
    t('R28 rehearsal: actual forward/reverse proof isolates copied launch paths', runMap(py), true)
    t('R28 rehearsal: deleting launch from the substitution scope defeats that isolation check', runMap(py.replace("'sim', 'launch', 'Anchor.toml'", "'sim', 'Anchor.toml'")), false)
  } finally { fsx.rmSync(fixtureRoot, { recursive: true, force: true }) }

  // ROUND 44 (V44o-4): THE RUNNER'S LAST STATEMENT, RUN AS WRITTEN with the
  // network check stubbed to fail. As `[ ship ] && die`, it returned 1 when the
  // flag was unset, so a no-network box exited 1 after every gate had passed.
  {
    const runner = fsx.readFileSync(new URL('../scripts/run-tests.sh', import.meta.url), 'utf8')
    const dieDef = (runner.match(/^die\(\)\{.*\}$/m) || [''])[0]
    const at = runner.lastIndexOf('\nif node -e '), tail = at > 0 ? runner.slice(at + 1).replace(/^if node -e "[^\n]*" 2>\/dev\/null; then/, 'if false; then') : ''
    const last = (ship) => { const r = CP.spawnSync('bash', ['-c', `set -euo pipefail\n${dieDef}\n${tail}`], { encoding: 'utf8', env: { ...process.env, CBOB_SHIP_GATE: ship } })
      return [r.status, /SKIPPED sim\/swap-fork\.sh/.test(r.stdout), /FATAL: CBOB_SHIP_GATE=1: the swap fork may not be skipped/.test(r.stderr)] }
    t('V44o-4: with no network the runner\'s last step SKIPS and exits 0; a certifying run (CBOB_SHIP_GATE=1) dies naming why',
      [!!dieDef && tail.startsWith('if false; then'), last(''), last('1')], [true, [0, true, false], [1, true, true]])
  }
  // ROUND 43 (V43o-1): THE RUNNER'S RELEASE-COMMIT GATE, RUN AS WRITTEN, IN A
  // RECORDED REHEARSAL. Round 42's C10 compared the program source to
  // RELEASE_COMMIT with a bare `git diff`, which the rehearsal tree can never pass
  // (its programs carry throwaway ids by design), so item 53's re-run died at the
  // gate. `release_gate` is extracted from scripts/run-tests.sh and run on a
  // disposable git fixture patched by rehearsal-tree.sh's own substitution engine.
  {
    const runner = fsx.readFileSync(new URL('../scripts/run-tests.sh', import.meta.url), 'utf8')
    const from = runner.indexOf('release_gate() {'), to = runner.indexOf('# end release_gate')
    t('V43o-1: the release gate is still findable in the runner', from > 0 && to > from, true)
    const gate = runner.slice(from, to)
    const root = fsx.mkdtempSync(path.join(os.tmpdir(), 'cbob-r43-gate-'))
    try {
      const g = (...args) => CP.execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      g('init', '-q')
      const progs = ['cbob-vaults', 'cbob-vault-mint', 'cbob-vault-burn', 'cbob-vault-gov', 'cbob-vault-sweep']
      const names = ['seal', 'mint', 'burn', 'gov', 'sweep'], ids = names.map(k => L.PROGRAM_IDS[k])
      progs.forEach((dir, i) => { const f = path.join(root, 'programs', dir, 'src/lib.rs')
        fsx.mkdirSync(path.dirname(f), { recursive: true }); fsx.writeFileSync(f, `declare_id!("${ids[i]}");\n${dir === 'cbob-vault-burn' ? 'require!(signer_lamports==0);\n' : ''}`) })
      fsx.mkdirSync(path.join(root, 'bank')); fsx.writeFileSync(path.join(root, 'bank/layout.mjs'), ids.join('\n') + '\n')
      fsx.writeFileSync(path.join(root, 'Cargo.toml'), '[workspace]\n')
      g('add', 'programs', 'bank', 'Cargo.toml')
      g('-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'release')
      const rel = g('rev-parse', 'HEAD').trim()
      fsx.mkdirSync(path.join(root, 'web/src'), { recursive: true })
      fsx.writeFileSync(path.join(root, 'web/src/config.js'), `export const MAINNET_PROGRAMS = {\n${names.map((k, i) => `  ${k}: '${ids[i]}',`).join('\n')}\n}\nexport const RELEASE_COMMIT = '${rel}'\n`)
      const run = () => { const r = CP.spawnSync('bash', ['-c', `set -euo pipefail\n${gate}\nrelease_gate "$1"`, 'gate', root], { encoding: 'utf8' })
        return [r.status, r.stdout.trim()] }
      const marker = ['REHEARSAL-RECORD.txt', '.rehearsal-map', '.rehearsal-files', '.rehearsal-sha']
      const patch = () => {
        g('checkout', '--', '.')
        fsx.writeFileSync(path.join(root, '.rehearsal-map'), ids.map((id, i) => `${id} ${new PublicKey(Buffer.alloc(32, 80 + i)).toBase58()} ${names[i]}`).join('\n')
          + `\n${['', 'opt', 'cbob-vaults'].join('/')} ${root} root\n`)
        CP.execFileSync('python3', ['-c', py, root, path.join(root, '.rehearsal-map')], { stdio: ['ignore', 'pipe', 'pipe'] })
        fsx.writeFileSync(path.join(root, 'REHEARSAL-RECORD.txt'), `REHEARSAL TREE\npatch sha256   ${fsx.readFileSync(path.join(root, '.rehearsal-sha'), 'utf8')}\n`)
      }
      const [okRc, okOut] = run()
      t('V43o-1: the audited tree (no marker, programs at RELEASE_COMMIT) passes the gate', [okRc, /^program source equals RELEASE_COMMIT/.test(okOut)], [0, true])
      patch()
      const [rhRc, rhOut] = run()
      t('V43o-1: the recorded rehearsal (marker + the recorded id patch) passes, and says it is the rehearsal tree', [rhRc, /^REHEARSAL TREE: program source equals RELEASE_COMMIT/.test(rhOut)], [0, true])
      fsx.renameSync(path.join(root, 'REHEARSAL-RECORD.txt'), path.join(root, 'RR'))
      t('V43o-1: ...the same patched programs WITHOUT the marker die (C10 is unchanged outside the rehearsal)', run()[0], 1)
      fsx.renameSync(path.join(root, 'RR'), path.join(root, 'REHEARSAL-RECORD.txt'))
      fsx.appendFileSync(path.join(root, 'Cargo.toml'), 'members = []\n')
      const [unRc, unOut] = run()
      t('V43o-1: ...with the marker, an UNRECORDED program-side edit dies', [unRc, /is not a recorded rehearsal file/.test(unOut)], [1, true])
      g('checkout', '--', 'Cargo.toml')
      // A forger who also rewrites the recorded sha still fails: the reverse map
      // must recreate RELEASE_COMMIT's bytes.
      fsx.appendFileSync(path.join(root, 'programs/cbob-vault-gov/src/lib.rs'), '// extra\n')
      const h = (await import('crypto')).createHash('sha256')
      for (const f of fsx.readFileSync(path.join(root, '.rehearsal-files'), 'utf8').trim().split('\n')) { h.update(f); h.update(fsx.readFileSync(path.join(root, f), 'utf8')) }
      const forged = h.digest('hex')
      fsx.writeFileSync(path.join(root, '.rehearsal-sha'), forged)
      fsx.writeFileSync(path.join(root, 'REHEARSAL-RECORD.txt'), `REHEARSAL TREE\npatch sha256   ${forged}\n`)
      const [fgRc, fgOut] = run()
      t('V43o-1: ...an edit to a patched program, with the sha forged to match, dies on the reverse map', [fgRc, /is not RELEASE_COMMIT under the reverse map/.test(fgOut)], [1, true])
      patch(); const keep = marker.map(m => [m, fsx.readFileSync(path.join(root, m))])
      g('checkout', '--', '.'); keep.forEach(([m, b]) => fsx.writeFileSync(path.join(root, m), b))
      t('V43o-1: ...and a marker copied into an UNPATCHED tree dies', run()[0], 1)
      // ROUND 44 (V44-2 i): a "map" that swaps a CODE token, not an id. The engine
      // applies it, the recorded sha matches and the reverse recreates the release,
      // so the round-43 gate passed it (measured on BURN's lamport check).
      g('checkout', '--', '.'); marker.forEach(m => fsx.rmSync(path.join(root, m), { force: true }))
      fsx.writeFileSync(path.join(root, '.rehearsal-map'), ids.map((id, i) => names[i] === 'burn' ? 'lamports==0 true||0==0 burn'
        : `${id} ${new PublicKey(Buffer.alloc(32, 80 + i)).toBase58()} ${names[i]}`).join('\n') + `\n${['', 'opt', 'cbob-vaults'].join('/')} ${root} root\n`)
      CP.execFileSync('python3', ['-c', py, root, path.join(root, '.rehearsal-map')], { stdio: ['ignore', 'pipe', 'pipe'] })
      fsx.writeFileSync(path.join(root, 'REHEARSAL-RECORD.txt'), `REHEARSAL TREE\npatch sha256   ${fsx.readFileSync(path.join(root, '.rehearsal-sha'), 'utf8')}\n`)
      const [fmRc, fmOut] = run()
      t('V44-2: a recorded "id map" that rewrites a CODE token (BURN\'s lamport check) dies: the left side must be the mainnet ids', [fmRc, /does not map the mainnet burn id/.test(fmOut)], [1, true])
      // ROUND 44 (V44-2 ii): `git diff` cannot see an untracked file, so an
      // untracked build.rs passed both branches.
      g('checkout', '--', '.'); marker.forEach(m => fsx.rmSync(path.join(root, m), { force: true }))
      const loose = path.join(root, 'programs/cbob-vaults/build.rs')
      fsx.writeFileSync(loose, 'fn main() {}\n')
      const [ltRc, ltOut] = run()
      t('V44-2: an UNTRACKED build.rs in a program dies in the audited-tree branch', [ltRc, /files git does not track/.test(ltOut)], [1, true])
      fsx.rmSync(loose); patch(); fsx.writeFileSync(loose, 'fn main() {}\n')
      const [lrRc, lrOut] = run()
      t('V44-2: ...and in the recorded-rehearsal branch', [lrRc, /files git does not track/.test(lrOut)], [1, true])
      fsx.rmSync(loose)
    } finally { fsx.rmSync(root, { recursive: true, force: true }) }
    // Round 44: the gate reads the five mainnet ids from web/src/config.js (outside the
    // rehearsal substitution), and that export is bank/layout.mjs's PROGRAM_IDS.
    const cfgSrc = fsx.readFileSync(new URL('../web/src/config.js', import.meta.url), 'utf8')
    const pinned = Object.fromEntries([...(cfgSrc.match(/export const MAINNET_PROGRAMS = \{([\s\S]*?)\}/)?.[1] || '').matchAll(/(seal|mint|burn|gov|sweep): '([1-9A-HJ-NP-Za-km-z]{32,44})'/g)].map(m => [m[1], m[2]]))
    // Round 45: inside a recorded rehearsal tree bank/layout.mjs carries the THROWAWAY
    // ids and web/ the mainnet ones, by design; there the comparison goes through the
    // tree's own recorded map (whose integrity the release gate proves). No map: exact.
    t('V44-2: the gate\'s five mainnet ids (web/src/config.js MAINNET_PROGRAMS) are bank/layout.mjs\'s PROGRAM_IDS', ['seal', 'mint', 'burn', 'gov', 'sweep'].map(k => viaRehearsalMap(pinned[k]) === L.PROGRAM_IDS[k]), [true, true, true, true, true])
    t('R44: the gate holds NO literal mainnet program id and no literal release root (rehearsal-tree.sh would rewrite it and turn the gate against every rehearsal tree), and reads them from web/src/config.js',
      [Object.values(L.PROGRAM_IDS).filter(id => gate.includes(id)), gate.includes(['', 'opt', 'cbob-vaults'].join('/')), /web\/src\/config\.js/.test(gate) && /MAINNET_PROGRAMS/.test(gate)], [[], false, true])
  }
}

// ROUND 43 (V43-1): THE CRANK RESCUES EVERY NESTED VAULT. A vault sent into another
// live vault's deposit address can be kept by that vault's owner, who opens their
// own vault before anyone runs the rescue. The rescue is permissionless and MINT
// pins its destination, so the crank now sends it every full pass. The planner,
// the send block and the wiring in main() are each run as written.
{
  const { createHash } = await import('crypto')
  const crankSrc = fsx.readFileSync(new URL('./crank.mjs', import.meta.url), 'utf8')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0 || s.indexOf(b, i) < 0) throw Error('missing tested fragment'); return s.slice(i, s.indexOf(b, i)) }
  const pdaOf = id => `PDA:${id}`
  const live = ids => Object.fromEntries(ids.map(i => [i, 'live']))
  const mixed = [{ id: 'HostV', owner: 'alice' }, { id: 'NestV', owner: pdaOf('HostV') }, { id: 'SelfV', owner: pdaOf('SelfV') },
    { id: 'BurntH', owner: null }, { id: 'NestB', owner: pdaOf('BurntH') }, { id: 'NestF', owner: pdaOf('ForeignAsset') }]
  t('R43 V43-1: the crank plans a rescue for a vault nested in a LIVE vault, in its own address, and behind a BURNED vault',
    CR.planRescues(mixed, pdaOf, { ...live(['HostV', 'NestV', 'SelfV', 'NestB', 'NestF']), BurntH: 'burned' }),
    [{ vault: 'NestV', host: 'HostV' }, { vault: 'SelfV', host: 'SelfV' }, { vault: 'NestB', host: 'BurntH' }])
  t('R43 V43-1: ...and NONE for a vault in a FOREIGN asset\'s wallet (MINT refuses that host, HostUnresolved)',
    CR.planRescues([{ id: 'HostV', owner: 'alice' }, { id: 'NestF', owner: pdaOf('ForeignAsset') }], pdaOf, live(['HostV', 'NestF'])), [])
  t('R43 V43-1: ...and NONE when nothing is nested',
    CR.planRescues([{ id: 'HostV', owner: 'alice' }, { id: 'B', owner: 'bob' }], pdaOf, live(['HostV', 'B'])), [])
  t('R43 V43-1: ...and NONE while the host, or the nested vault, reads as neither live nor burned (next pass)',
    [CR.planRescues(mixed.slice(0, 2), pdaOf, { HostV: 'other', NestV: 'live' }), CR.planRescues(mixed.slice(0, 2), pdaOf, { HostV: 'live', NestV: 'other' })], [[], []])
  // The send block, run as written with recording stubs.
  const rescueBlock = between(crankSrc, '  const RESCUE = pda(', '\n  for (const a of plan.retireBurned) {')
  const rescueRun = new AsyncFunction('ctx', 'with(ctx){' + rescueBlock + '}')
  const sent = []
  await rescueRun({ plan: { rescue: [{ vault: 'NestV', host: 'HostV' }] }, pda: () => ({ toBase58: () => 'RESCUEPDA' }), Buffer, L, MINT: 'MINT',
    run: async (label, ixs) => { sent.push({ label, ixs }); return 'ok' }, TransactionInstruction: class { constructor(o) { Object.assign(this, o) } },
    d: n => Buffer.from(n), W: k => ({ pubkey: k, isWritable: true }), R: k => ({ pubkey: k, isWritable: false }), MINT_CFG: { toBase58: () => 'CFG' },
    cfg: { collection: 'COLL', bank_treasury: 'SQUADS' }, payer: { publicKey: 'CRANKKEY' }, CORE_ID: CR.CORE_ID,
    SystemProgram: { programId: { toBase58: () => CR.SYSTEM_PROGRAM_ID } } })
  const k = sent[0]?.ixs?.[0]?.keys?.map(x => `${x.pubkey}${x.isSigner ? '!' : ''}${x.isWritable ? '+' : ''}`)
  t('R43 V43-1: main() sends rescue_nested(vault, host) with the CBOBTC Squads as new_owner and the crank key only as fee payer',
    [sent.length, String(sent[0]?.ixs?.[0]?.data), k],
    [1, 'rescue_nested', ['CFG', 'NestV+', 'COLL', 'HostV', 'SQUADS', 'CRANKKEY!+', 'RESCUEPDA', CR.CORE_ID, CR.SYSTEM_PROGRAM_ID]])
  // The wiring: owners read off the asset accounts main() already fetched (bytes
  // 1..33 of a live AssetV1), full pass only, and before the fee budget is judged.
  const wire = between(crankSrc, '  plan.rescue = REVEAL_ONLY', '\n  console.log(`crank ')
  const wireRun = new Function('ctx', 'with(ctx){' + wire + '; return plan.rescue}')
  const key = id => createHash('sha256').update(id).digest()
  const wctx = REVEAL_ONLY => ({ REVEAL_ONLY, plan: {}, planRescues: CR.planRescues, records: [{ asset: 'HostV' }, { asset: 'NestV' }],
    assets: live(['HostV', 'NestV']), assetInfos: [{ data: Buffer.concat([Buffer.from([1]), key('alice')]) }, { data: Buffer.concat([Buffer.from([1]), key('HostV')]) }],
    PublicKey: class { constructor(b) { this.b = b } toBase58() { return Buffer.from(this.b).toString('hex') } },
    signerPda: id => ({ toBase58: () => key(id).toString('hex') }) })
  t('R43 V43-1: main() plans the rescue from the vaults\' own asset reads on a full pass, and none on the reveal lane',
    [wireRun(wctx(false)), wireRun(wctx(true))], [[{ vault: 'NestV', host: 'HostV' }], []])
  t('R43 V43-1: ...before the fee budget is judged, and the budget charges one signature per rescue',
    [crankSrc.indexOf('  plan.rescue = REVEAL_ONLY') < crankSrc.indexOf('  const fee = budgetPlan(plan'),
     CR.planCostLamports({ reschedule: [], capture: [], reveal: [], retireBurned: [], activate: [], claims: [], preJoins: [], preExpires: [], postExpires: [], rescue: ['a', 'b'] })],
    [true, 2n * CR.SIG_FEE_LAMPORTS])
  t('R43 V43-1: a rescue refused NotNested (rescued elsewhere, or taken out since the plan) is a race; a wrong destination or host is NOT',
    ['Error Code: NotNested', 'Error Code: WrongRescueDestination', 'Error Code: HostUnresolved'].map(m => CR.BENIGN.test(m)), [true, false, false])
}

{
  // ═══ ROUND 44 (item 22): THE REHEARSAL DRIVER'S GUARDS AND THE REHEARSAL-ONLY OVERRIDES ═══
  // scripts/rehearsal-run.mjs moves real SOL on mainnet, so each refusal is pinned
  // here as the PURE function the driver calls, both ways.
  const RR = await import('../scripts/rehearsal-run.mjs')
  const RE = await import('./rehearsal-env.mjs')
  const tmpd = fsx.mkdtempSync('/tmp/cbob-rr-')
  t('R44 RR: a tree with no REHEARSAL-RECORD.txt is refused before any gate runs',
    RR.judgeTree(tmpd, () => ({ ok: true })).some(x => /not a recorded rehearsal tree/.test(x)), true)
  fsx.writeFileSync(`${tmpd}/REHEARSAL-RECORD.txt`, 'x')
  t('R44 RR: ...a recorded tree whose release gate refuses is refused, naming the gate',
    RR.judgeTree(tmpd, () => ({ ok: false, why: 'map is not five programs' })).some(x => /release gate refused: map is not five programs/.test(x)), true)
  t('R44 RR: ...and a recorded tree whose gate passes is accepted', RR.judgeTree(tmpd, () => ({ ok: true, why: '' })), [])
  t('R44 RR: the driver holds NO literal mainnet program id (a rehearsal tree would rewrite it and invert the refusal); it reads web/src/config.js',
    [['scripts/rehearsal-run.mjs', 'scripts/rehearsal-steps.mjs', 'scripts/rehearsal-recover.mjs', 'bank/rehearsal-env.mjs'].flatMap(f => Object.values(L.PROGRAM_IDS).filter(id => fsx.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').includes(id)).map(id => `${f}: ${id}`)),
      Object.keys(RR.MAINNET_PROGRAM_IDS).map(k => viaRehearsalMap(RR.MAINNET_PROGRAM_IDS[k]) === L.PROGRAM_IDS[k] || 'differs')], [[], [true, true, true, true, true]])
  t('R44 RR: a tree made from another commit than the release HEAD is REFUSED before anything is deployed; mid-rehearsal it only warns (a refresh would destroy keys holding value)',
    [RR.judgeFreshness({ treeCommit: 'a'.repeat(40), releaseHead: 'a'.repeat(40), started: false }), RR.judgeFreshness({ treeCommit: 'a'.repeat(40), releaseHead: 'b'.repeat(40), started: false }).refuse.length,
      RR.judgeFreshness({ treeCommit: 'a'.repeat(40), releaseHead: 'b'.repeat(40), started: true }).refuse.length, /Do NOT refresh/.test(RR.judgeFreshness({ treeCommit: 'a'.repeat(40), releaseHead: 'b'.repeat(40), started: true }).warn[0]),
      RR.judgeFreshness({ treeCommit: null, releaseHead: 'b'.repeat(40), started: true }).refuse.length], [{ refuse: [], warn: [] }, 1, 0, true, 1])
  t('R44 RR: the driver NEVER runs the rehearsal refresh (it would destroy throwaway keys holding value)',
    ['scripts/rehearsal-run.mjs', 'scripts/rehearsal-steps.mjs', 'scripts/rehearsal-recover.mjs'].filter(f => fsx.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').split('\n').some(l => l.includes(['refresh', 'rehearsal'].join('-')) && !/^\s*(\*|\/\/)/.test(l))), [])
  const fakeIds = { seal: 'S1111111111111111111111111111111111111111111', mint: 'M1111111111111111111111111111111111111111111', burn: 'B1111111111111111111111111111111111111111111', gov: 'G1111111111111111111111111111111111111111111', sweep: 'W1111111111111111111111111111111111111111111' }
  t('R44 RR: five distinct throwaway program ids pass', RR.judgeProgramIds(fakeIds), [])
  t('R44 RR: ...a MAINNET program id is refused by name (each of the five)',
    Object.keys(fakeIds).map(k => RR.judgeProgramIds({ ...fakeIds, [k]: RR.MAINNET_PROGRAM_IDS[k] }).some(x => x.includes(`${k} is a MAINNET program id`))), [true, true, true, true, true])
  t('R44 RR: ...and a repeated or missing id is refused', [RR.judgeProgramIds({ ...fakeIds, gov: fakeIds.seal }).length > 0, RR.judgeProgramIds({ ...fakeIds, sweep: null }).length > 0], [true, true])
  const vals = { init_authority: { value: 'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB' }, guardian: { value: 'Gd11111111111111111111111111111111111111111' },
    bank_treasury: { value: 'Tr11111111111111111111111111111111111111111' }, swap_operator: { value: 'Op11111111111111111111111111111111111111111' },
    payment_mint: { value: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij' } }
  t('R44 RR: rehearsal-owned keys pass (the real cbBTC payment mint is allowed)', RR.judgeNoMainnetKeys(vals, { network: 'local', funding: 'x' }), [])
  t('R44 RR: ...every mainnet-only key or root in a rehearsal value is refused by name',
    Object.keys(RR.MAINNET_ONLY).map(m => RR.judgeNoMainnetKeys({ ...vals, guardian: { value: m } }, { network: 'local', funding: 'x' }).length === 1), Object.keys(RR.MAINNET_ONLY).map(() => true))
  t('R44 RR: ...a wrong init authority is refused, and on mainnet only the deploy wallet may fund',
    [RR.judgeNoMainnetKeys({ ...vals, init_authority: { value: 'Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb' } }, { network: 'local', funding: 'x' }).length > 0,
      RR.judgeNoMainnetKeys(vals, { network: 'mainnet', funding: 'Someone111111111111111111111111111111111111' }).length > 0,
      RR.judgeNoMainnetKeys(vals, { network: 'mainnet', funding: RR.DEPLOY_WALLET }).length], [true, true, 0])
  const pdBytes = Buffer.concat([Buffer.alloc(45, 1), Buffer.from('core-bytes')])
  const pdPin = (await import('crypto')).createHash('sha256').update(Buffer.from('core-bytes')).digest('hex')
  t('R44 RR: Core judged on ProgramData after its 45-byte header: the pin passes, anything else and an absent Core are refused',
    [RR.judgeCore(pdBytes, pdPin), RR.judgeCore(Buffer.concat([pdBytes, Buffer.from([1])]), pdPin).length, RR.judgeCore(null, pdPin).length], [[], 1, 1])
  t('R44 RR: --max-sol: a step that would pass the cap is refused, one inside it runs (drawdown + estimate)',
    [RR.capAllows({ startLamports: 10_000, nowLamports: 6_000, estimate: 4_001, maxLamports: 8_000 }).ok, RR.capAllows({ startLamports: 10_000, nowLamports: 6_000, estimate: 4_000, maxLamports: 8_000 }).ok], [false, true])
  t('R44 RR: THE RULE: a completed step is never sent again, whatever the chain or its signatures say',
    [RR.nextAction({ status: 'done' }, { doneOnChain: false, sigs: 'landed' }), RR.nextAction({ status: 'done' }, { doneOnChain: false, sigs: 'none-landed' })], ['skip', 'skip'])
  t('R44 RR: ...an unknown outcome is RE-READ: done on chain is recorded, a landed or pending signature STOPS, only nothing-landed re-runs',
    [RR.nextAction({ status: 'unknown' }, { doneOnChain: true, sigs: 'landed' }), RR.nextAction({ status: 'unknown' }, { doneOnChain: false, sigs: 'landed' }),
      RR.nextAction({ status: 'sending' }, { doneOnChain: false, sigs: 'pending' }), RR.nextAction({ status: 'unknown' }, { doneOnChain: false, sigs: 'none-landed' }),
      RR.nextAction(undefined, { doneOnChain: false, sigs: 'none-landed' })], ['mark', 'stop', 'stop', 'run', 'run'])
  t('R44 RR: signatures judged: one succeeded = landed; a null status before its blockhash expires = pending; failed or expired = none-landed',
    [RR.judgeSigs([{ lastValidBlockHeight: 10 }], [{ err: null }], 5), RR.judgeSigs([{ lastValidBlockHeight: 10 }], [null], 5),
      RR.judgeSigs([{ lastValidBlockHeight: 10 }, { lastValidBlockHeight: 10 }], [{ err: { x: 1 } }, null], 11), RR.judgeSigs([], [], 0),
      RR.judgeSigs([{ lastValidBlockHeight: 10, preflightRefused: true }], [null], 5)],
    ['landed', 'pending', 'none-landed', 'none-landed', 'none-landed'])
  t('R44 RE: a rehearsal-only override SET outside a recorded tree is REFUSED (never silently ignored); unset is the production value',
    [(() => { try { RE.rehearsalOnly('CBOB_REHEARSAL_RPC', 'prod', { env: { CBOB_REHEARSAL_RPC: 'http://127.0.0.1:8999' }, inTree: false }); return 'ran' } catch (e) { return /rehearsal-only override/.test(e.message) ? 'refused' : 'other' } })(),
      RE.rehearsalOnly('CBOB_REHEARSAL_RPC', 'prod', { env: {}, inTree: false })], ['refused', 'prod'])
  t('R44 RE: ...inside a recorded tree it is honoured, and a flag is true only for exactly "1"',
    [RE.rehearsalOnly('CBOB_REHEARSAL_NOTIFY', '/opt/scripts/notify-gary-sms.sh', { env: { CBOB_REHEARSAL_NOTIFY: '/tmp/n.sh' }, inTree: true }),
      RE.rehearsalFlag('X', { env: { X: '1' }, inTree: true }), RE.rehearsalFlag('X', { env: { X: 'yes' }, inTree: true })], ['/tmp/n.sh', true, false])
  t('R44 RE: the jobs\' RPC: the box provider by default; the rehearsal RPC only inside a recorded tree, refused outside',
    [RE.jobRpc(() => 'HELIUS_RPC_URL=https://provider.invalid/x\n', { env: {}, inTree: false }),
      RE.jobRpc(() => 'HELIUS_RPC_URL=https://provider.invalid/x\n', { env: { CBOB_REHEARSAL_RPC: 'http://127.0.0.1:8999' }, inTree: true }),
      (() => { try { RE.jobRpc(() => 'HELIUS_RPC_URL=https://provider.invalid/x\n', { env: { CBOB_REHEARSAL_RPC: 'http://127.0.0.1:8999' }, inTree: false }); return 'ran' } catch { return 'refused' } })()],
    ['https://provider.invalid/x', 'http://127.0.0.1:8999', 'refused'])
  const revSrc = fsx.readFileSync(new URL('./revenue.mjs', import.meta.url), 'utf8')
  t('R44 RE: the two forced failures in revenue.mjs are reachable ONLY through rehearsalFlag (never a raw env read)',
    [/rehearsalFlag\('CBOB_REHEARSAL_FAIL_AFTER_SWEEP'\)/.test(revSrc), /rehearsalFlag\('CBOB_REHEARSAL_FORCE_ORCA_REFUSAL'\)/.test(revSrc), /process\.env\.CBOB_REHEARSAL/.test(revSrc)], [true, true, false])
  // ROUND 45 (V45o-2): the two forced failures were read where they act, AFTER the
  // sweep, so a stray one outside a rehearsal tree was refused with the SOL already
  // on the operator key. Every override is now judged at load. Checked by source
  // order, never by importing revenue.mjs here (a regression would run the job).
  t('R45 V45o-2: refuseStrayOverrides refuses EACH of the four rehearsal overrides set outside a recorded tree, and passes them all inside one or unset',
    [RE.REHEARSAL_OVERRIDES.map(n => { try { RE.refuseStrayOverrides({ env: { [n]: '1' }, inTree: false }); return 'ran' } catch (e) { return /rehearsal-only override/.test(e.message) ? 'refused' : e.message } }),
      RE.REHEARSAL_OVERRIDES.map(n => { try { RE.refuseStrayOverrides({ env: { [n]: '1' }, inTree: true }); return 'ran' } catch { return 'refused' } }),
      (() => { try { RE.refuseStrayOverrides({ env: {}, inTree: false }); return 'ran' } catch { return 'refused' } })()],
    [Array(4).fill('refused'), Array(4).fill('ran'), 'ran'])
  {
    const mainAt = src => src.indexOf('async function main(')
    const topLevel = (src, re) => { const m = src.match(re); return !!m && m.index < mainAt(src) && !/^\s/.test(src.slice(src.lastIndexOf('\n', m.index) + 1, m.index)) }
    const mainBody = src => src.slice(mainAt(src))
    const crankMain = mainBody(fsx.readFileSync(new URL('./crank.mjs', import.meta.url), 'utf8'))
    const alarmText = fsx.readFileSync(new URL('./alarm.mjs', import.meta.url), 'utf8')
    t('R45 V45o-2: revenue.mjs refuses every stray override and reads BOTH forced failures at module load, before main() and so before the sweep; main() calls rehearsalFlag nowhere',
      [topLevel(revSrc, /^refuseStrayOverrides\(\)/m), topLevel(revSrc, /^const FAIL_AFTER_SWEEP = rehearsalFlag\('CBOB_REHEARSAL_FAIL_AFTER_SWEEP'\)/m),
        topLevel(revSrc, /^const FORCE_ORCA_REFUSAL = rehearsalFlag\('CBOB_REHEARSAL_FORCE_ORCA_REFUSAL'\)/m), /rehearsalFlag\(/.test(mainBody(revSrc)),
        mainBody(revSrc).indexOf('if (FAIL_AFTER_SWEEP)') > mainBody(revSrc).indexOf("enterStage('sweep')")], [true, true, true, false, true])
    t('R45 V45o-2: the alarm refuses at load, and the crank before it reads its RPC or sends anything',
      [topLevel(alarmText, /^refuseStrayOverrides\(\)/m), crankMain.indexOf('refuseStrayOverrides()') > 0 && crankMain.indexOf('refuseStrayOverrides()') < crankMain.indexOf('jobRpc()')], [true, true])
  }
  fsx.rmSync(tmpd, { recursive: true, force: true })
}

{
  // ═══ ROUND 45: THE DRIVER'S DEPLOY KEY, ARGV, RECORD JUDGES AND RESUME ═══
  // Each repair is pinned as the pure function the driver calls, plus the source
  // facts that say the driver calls it, so removing either turns an arm red.
  const RR = await import('../scripts/rehearsal-run.mjs')
  const steps = fsx.readFileSync(new URL('../scripts/rehearsal-steps.mjs', import.meta.url), 'utf8')
  const recover = fsx.readFileSync(new URL('../scripts/rehearsal-recover.mjs', import.meta.url), 'utf8')
  const ids5 = { seal: 'S1111111111111111111111111111111111111111111', mint: 'M1111111111111111111111111111111111111111111', burn: 'B1111111111111111111111111111111111111111111', gov: 'G1111111111111111111111111111111111111111111', sweep: 'W1111111111111111111111111111111111111111111' }
  const dep = 'Dep1111111111111111111111111111111111111111', fund = 'Fund111111111111111111111111111111111111111'
  // V45-3
  t('R45 V45-3: a deploy whose keypair IS the recorded rehearsal id, signed by the throwaway deployer, passes',
    RR.judgeDeployKey({ name: 'mint', keypairPubkey: ids5.mint, programs: ids5, deployer: dep, funding: fund }), [])
  t('R45 V45-3: ...a keypair that is not the recorded id is refused (a misplaced file), and a MAINNET program keypair is refused by name',
    [RR.judgeDeployKey({ name: 'mint', keypairPubkey: ids5.seal, programs: ids5, deployer: dep, funding: fund }).some(x => /not the recorded rehearsal id/.test(x)),
      RR.judgeDeployKey({ name: 'mint', keypairPubkey: RR.MAINNET_PROGRAM_IDS.mint, programs: ids5, deployer: dep, funding: fund }).some(x => /MAINNET program id/.test(x))], [true, true])
  t('R45 V45-3: ...the funding wallet, or the deploy wallet (the real programs\' upgrade key), as upgrade authority is refused',
    [RR.judgeDeployKey({ name: 'mint', keypairPubkey: ids5.mint, programs: ids5, deployer: fund, funding: fund }).some(x => /funding wallet/.test(x)),
      RR.judgeDeployKey({ name: 'mint', keypairPubkey: ids5.mint, programs: ids5, deployer: RR.DEPLOY_WALLET, funding: fund }).some(x => /deploy wallet/.test(x))], [true, true])
  {
    // the deploy step judges the key BEFORE `solana program deploy`, signs with the deployer, and writes into its own recorded buffer
    const d = steps.slice(steps.indexOf("step(`deploy-${i + 1}`"), steps.indexOf("// ROAD STEP 10"))
    t('R45 V45-3: the deploy step calls judgeDeployKey before sending, and the deployer (never the funding wallet) is payer and upgrade authority, writing its own recorded --buffer',
      [/const bad = judgeDeployKey\(\{[^\n]*\n\s*if \(bad\.length\) throw new Error\(`REFUSED/.test(d) && d.indexOf('const bad = judgeDeployKey(') < d.indexOf("'program', 'deploy'"), /'--keypair', deployerPath\(\), '--upgrade-authority', deployerPath\(\)/.test(d),
        /st\.buffers = /.test(d) && d.indexOf('st.buffers = ') < d.indexOf("'program', 'deploy'"), /'--buffer', keyPath\(`buffer-\$\{k\}`\)/.test(d)], [true, true, true, true])
  }
  t('R45 V45-3: a buffer is closed by its RECORDED address only; no driver file ever passes --buffers (every buffer a key owns)',
    [RR.bufferCloseArgv('Buf1111111111111111111111111111111111111111', '/k.json', fund).includes('Buf1111111111111111111111111111111111111111'), RR.bufferCloseArgv(null, '/k.json', fund),
      ['scripts/rehearsal-run.mjs', 'scripts/rehearsal-steps.mjs'].filter(f => fsx.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').split('\n').some(l => /'--buffers'/.test(l)))], [true, null, []])
  t('R45 V45-3: the deployer holds every remaining ProgramData rent plus the largest buffer outstanding at any one deploy',
    RR.deployerNeed([{ programData: 10, buffer: 12 }, { programData: 5, buffer: 6 }, { programData: 1, buffer: 30 }], 7), Math.max(10 + 12, 15 + 6, 15 + 1 + 30) + 7)
  // V45-2
  t('R45 V45-2: the CLI reads the RPC from a config file (--config), so its argv carries no URL; a URL in argv is caught',
    [RR.solanaArgv('/cfg.yml', ['program', 'show']).join(' '), RR.judgeArgv(['--url', 'https://rpc.example/?api-key=SECRET'], ['https://rpc.example/?api-key=SECRET']).length,
      RR.judgeArgv(RR.solanaArgv('/cfg.yml', ['program', 'show']), ['https://rpc.example/?api-key=SECRET']).length], ['--config /cfg.yml program show', 1, 0])
  t('R45 V45-2: on mainnet only --rpc box is accepted (a URL on the driver\'s own command line carries the key); the steps never pass --url',
    [RR.judgeRpcArg({ network: 'mainnet', rpc: 'https://x' }).length, RR.judgeRpcArg({ network: 'mainnet', rpc: 'box' }).length, RR.judgeRpcArg({ network: 'local', rpc: 'http://127.0.0.1:8999' }).length,
      /'--url'/.test(steps), /solanaArgv\(ctx\.cliConfig/.test(steps)], [1, 0, 0, false, true])
  // V45-1
  const report = (sections) => ['CBOB vault alarm (watch) — x', '⚠️ REHEARSAL: ...', '', ...sections.flatMap(([sev, kinds]) => [`${sev} (${kinds.length}):`, ...kinds.map(k => `  [${k}] detail sweep`), '']), '>>> ACTION REQUIRED'].join('\n')
  t('R45 V45-1 (22.4): only an [unreconciled_swap] line under CRITICAL is the alarm 22.4 names; an unrelated CRITICAL beside an INFO naming the sweep is NOT, nor the kind under HIGH',
    [RR.judgeForcedFailureAlarm(report([['CRITICAL', ['unreconciled_swap']]])), RR.judgeForcedFailureAlarm(report([['CRITICAL', ['config_drift']], ['INFO', ['sweep_stopped']]])),
      RR.judgeForcedFailureAlarm(report([['HIGH', ['unreconciled_swap']]]))], [true, false, false])
  t('R45 V45-1 (22.4): the driver waits past the alarm\'s grace before judging: the detector is still quiet at the grace and fires one minute past it',
    [D.detectUnreconciledRevenue({ cycles: [{ startedAt: '2026-08-22T00:00:00Z', sweptLamports: '5', sweepSig: 's' }] }, { now: Date.parse('2026-08-22T00:00:00Z') + RR.ALARM_GRACE_MS - 60_000 }).length,
      D.detectUnreconciledRevenue({ cycles: [{ startedAt: '2026-08-22T00:00:00Z', sweptLamports: '5', sweepSig: 's' }] }, { now: Date.parse('2026-08-22T00:00:00Z') + RR.ALARM_GRACE_MS + 60_000 }).map(f => f.kind),
      /started \+ ALARM_GRACE_MS \+ 60_000/.test(steps), /judgeForcedFailureAlarm\(a\.out\)/.test(steps)], [0, ['unreconciled_swap'], true, true])
  t('R45 V45-1 (22.2): an alarm pass that did not complete, lacks REHEARSAL, or carries an unexplained CRITICAL is a FAIL; an explained one passes',
    [RR.judgeAlarmPass({ code: 3, out: 'REHEARSAL' }).verdict, RR.judgeAlarmPass({ code: 0, out: 'x' }).verdict,
      RR.judgeAlarmPass({ code: 1, out: report([['CRITICAL', ['config_drift']]]) }).verdict,
      RR.judgeAlarmPass({ code: 1, out: report([['CRITICAL', ['revenue_ledger_unreadable']]]), explained: ['revenue_ledger_unreadable'] }).verdict,
      /item\(2, fail \? 'FAIL' : 'PASS'/.test(steps)], ['FAIL', 'FAIL', 'FAIL', 'PASS', true])
  t('R45 V45-1 (22.5): only a boolean `burnt` answers the DAS question; an error or a null is a FAIL, and the step records that judgement',
    [RR.judgeDas({ burnt: true }), RR.judgeDas({ burnt: false }), RR.judgeDas({ burnt: null, error: 'x' }), RR.judgeDas(undefined), /item\(5, judgeDas\(st\.das\)/.test(steps)], ['PASS', 'PASS', 'FAIL', 'FAIL', true])
  // V45-5
  t('R45 V45-5 (22.3): one closed cycle on EACH venue, whatever the order, is a PASS; a genuine Orca refusal in both is PARTIAL with the cause named, never a wedge',
    [RR.judgeRevenueCycles([{ swapVenue: 'orca' }, { swapVenue: 'meteora' }]).verdict, RR.judgeRevenueCycles([{ swapVenue: 'meteora' }, { swapVenue: 'orca' }]).verdict,
      RR.judgeRevenueCycles([{ swapVenue: 'meteora' }, { swapVenue: 'meteora' }]).verdict + '/' + RR.judgeRevenueCycles([{ swapVenue: 'orca' }, { swapVenue: 'orca' }]).verdict, /Orca never closed/.test(RR.judgeRevenueCycles([{ swapVenue: 'meteora' }, { swapVenue: 'meteora' }]).why),
      /st\[`rev\$\{n\}`\] === 'not-here' \|\| closedCycles\(\)\.length >= n,/.test(steps)], ['PASS', 'PASS', 'PARTIAL/PARTIAL', true, true])
  // V45-4
  t('R45 V45-4: --resume re-enters a step whose signature LANDED; a still-pending one is never raced; without --resume it stops',
    [RR.nextAction({ status: 'unknown' }, { doneOnChain: false, sigs: 'landed', resume: true }), RR.nextAction({ status: 'unknown' }, { doneOnChain: false, sigs: 'pending', resume: true }),
      RR.nextAction({ status: 'unknown' }, { doneOnChain: false, sigs: 'landed' })], ['run', 'stop', 'stop'])
  {
    const r = steps.slice(steps.indexOf("step('rescue'"), steps.indexOf('// the crack: vault-1'))
    t('R45 V45-4: the rescue sends both transfers through send() (signatures recorded), reads where vault-3 is before each send, and is resumable',
      [/sendAndConfirm/.test(r), (r.match(/await send\(rec, coreTransferIxs/g) || []).length, /\}, \{ resumable: true \}\)/.test(r),
        /x\.owner === nest/.test(r) && /x\.owner === treasury/.test(r)], [false, 2, true, true])
  }
  // V45-6
  t('R45 V45-6: a step after verify-configs is refused (even by --step) until the configs are verified',
    [RR.requiresVerified(['a', 'verify-configs', 'claim-1'], 'claim-1', {}).length, RR.requiresVerified(['a', 'verify-configs', 'claim-1'], 'claim-1', { configsVerified: true }).length,
      RR.requiresVerified(['a', 'verify-configs', 'claim-1'], 'a', {}).length], [1, 0, 0])
  t('R45 V45-6: every preparation step runs BEFORE the deploys, and the ceremony right after them',
    [steps.indexOf("step('fill-values'") < steps.indexOf("step('fund-deployer'"), steps.indexOf("step('fund-deployer'") < steps.indexOf("step(`deploy-${i + 1}`"),
      steps.indexOf("step(`deploy-${i + 1}`") < steps.indexOf("step('ceremony-collection'"), steps.indexOf("step('fund-roles'") < steps.indexOf("step(`deploy-${i + 1}`")], [true, true, true, true])
  // V45-7, V45-8, V45-11
  t('R45 V45-7/8/11: the profile\'s RPC is the resolved URL (not the argv word `box`); 22.1 says it ran at 5 vaults; a taken collection address gets a fresh key',
    [/rpc: ctx\.A\.rpcResolved, programs/.test(steps), /PASS at 5 vaults \(scale not exercised\)/.test(steps), /checkNewAddress\(conn, pre, newKey\(name\)/.test(steps)], [true, true, true])
  // V45-10
  {
    const order = [], led = { cycles: [{}] }
    const conn = { getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 9 }),
      sendRawTransaction: async () => { order.push(`send:${led.cycles[0].pendingSwapSig ? 'recorded' : 'unrecorded'}`) }, confirmTransaction: async () => ({ value: { err: null } }) }
    const { Keypair, Transaction, SystemProgram } = await import('@solana/web3.js')
    const k = Keypair.generate(), RV = await import('../scripts/rehearsal-recover.mjs')
    const sig = await RV.sendRecorded({ conn, tx: new Transaction().add(SystemProgram.transfer({ fromPubkey: k.publicKey, toPubkey: k.publicKey, lamports: 1 })), signers: [k], c: led.cycles[0], field: 'pendingSwapSig', save: () => order.push('save') })
    t('R45 V45-10: the hand recovery writes each signature to the ledger and SAVES it before sending; it no longer sends any other way',
      [order, led.cycles[0].pendingSwapSig === sig, /sendAndConfirmTransaction/.test(recover), (recover.match(/sendRecorded\(\{ conn, tx:/g) || []).length], [['save', 'send:recorded'], true, false, 3])
  }
}

// A FLOOR ON THESE TOO. `process.exit(bad.length ? 1 : 0)` cannot tell "all
// passed" from "the file threw after two assertions and both of those passed",
// and this file is the only proof most of the pipeline has.
// ROUND 14: this said 195 against a real count of 221 while the commit beside it
// added an EXTERNAL floor and claimed "every floor equals its real count". A
// floor 26 below reality is the same defeat round 12 fixed on-chain, left
// standing in the fix for it — and SPEC documents running this file DIRECTLY,
// which bypasses the runner's floor entirely. It is the current count.
const FLOOR = 1032
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
