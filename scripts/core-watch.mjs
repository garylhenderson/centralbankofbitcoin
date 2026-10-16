#!/usr/bin/env node
// CORE WATCH (Gary 2026-10-09: keep Metaplex Core as a dependency and MANAGE it;
// "don't want to reach out. let's just build"). Read-only. Sends nothing on chain.
//
// WHY THIS EXISTS. Metaplex upgraded Core on mainnet three times in five weeks
// (2026-09-03, 2026-10-07, 2026-10-09 21:21 UTC). The last one came from a PRIVATE
// repo with no release tag and no verified build, and we found it only because
// the dress rehearsal refused to resume. Every vault is a Core asset, so a Core
// change is a change to what our sealed programs call. The on-chain bytes are
// the only signal that never misses; Metaplex's release feed missed the 10-09 one.
//
// WHAT IT DOES, every run (cron, every 10 minutes):
//   1. Reads Core's ProgramData from mainnet: deploy slot + sha256 of the bytes
//      after the 45-byte header (exactly what `solana program dump` writes and
//      what scripts/run-tests.sh pins as CORE_SHA256_EXPECTED).
//   2. Live != pin  -> first sight: saves the bytes, emails Gary URGENT once, and
//      starts scripts/core-watch-suite.sh, which runs the whole on-chain suite
//      against the NEW bytes as soon as the validator is free and emails the
//      result. While it stays unpinned it re-asserts (non-urgent; the alert
//      router collapses repeats), because every watchdog behind the router must
//      be level-triggered.
//   3. Records OtterSec's verified-build status and Metaplex's public release
//      tags. A change in the verified status is emailed (it is the moment a
//      public diff of the new build becomes possible); a new tag alone is logged.
//
// It NEVER re-pins. Re-pinning stays a source edit and a commit, after a green
// run, because a Metaplex upgrade should be a decision (run-tests.sh line ~86).
//
// Usage: node scripts/core-watch.mjs            one tick (cron)
//        node scripts/core-watch.mjs --dry      one tick, no email, no suite start
//        node scripts/core-watch.mjs --status   print the recorded state
//        node scripts/core-watch.mjs --selftest prove every decision in BOTH directions
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { spawn, spawnSync } from 'child_process'

const ROOT = '/opt/cbob-vaults'
const DIR = `${ROOT}/.cache/core-watch`
const STATE = `${DIR}/state.json`
const LOG = `${DIR}/watch.log`
const CORE = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
const NOTIFY = '/opt/cbob-vaults/bank/ops-notify.mjs'
const OSEC = `https://verify.osec.io/status/${CORE}`
const RELEASES = 'https://api.github.com/repos/metaplex-foundation/mpl-core/releases?per_page=5'
const UNREADABLE_ALERT_EVERY = 6 // consecutive failed reads (= 1 hour at */10) before it says so
const args = process.argv.slice(2)

export function readPin(src = fs.readFileSync(`${ROOT}/scripts/run-tests.sh`, 'utf8')) {
  const m = src.match(/^CORE_SHA256_EXPECTED=([0-9a-f]{64})$/m)
  if (!m) throw new Error('no CORE_SHA256_EXPECTED in run-tests.sh')
  return m[1]
}

// THE DECISION, pure, so --selftest can prove it without a network or a mailbox.
// obs = { live: {hash, slot} | null, pin, osec: {verified, commit} | null, tags: [..] | null, suite: {status,...} | undefined,
//         prior: { [hash]: {status,...} } for EARLIER off-pin builds whose result was never sent }
// A suite result file that exists but cannot be parsed is { status: 'unreadable' }: a run that
// FINISHED with an unknown result. It is reported once as a failure and never restarted
// (round 47, V47o-1: a PASS written as invalid JSON re-ran the whole suite every tick).
export function decide(state, obs, now) {
  const s = JSON.parse(JSON.stringify(state || {}))
  s.seen ||= {}
  const acts = []
  if (!obs.live) {
    s.failStreak = (s.failStreak || 0) + 1
    if (s.failStreak % UNREADABLE_ALERT_EVERY === 0)
      acts.push({ kind: 'email', urgent: false, label: 'cbob-core-watch:unreadable',
        text: `CBOB Core watch could not read Metaplex Core on mainnet for ${s.failStreak} runs in a row (about ${s.failStreak * 10} min). Nothing is known to have changed; the watch is blind until a read succeeds. Log: ${LOG}` })
    return { state: s, acts }
  }
  s.failStreak = 0
  const { hash, slot } = obs.live
  const prev = s.lastHash
  s.lastHash = hash; s.lastSlot = slot; s.lastReadAt = now
  if (hash !== obs.pin) {
    const rec = s.seen[hash] ||= { firstSeen: now, slot }
    if (!rec.alertedAt) {
      rec.alertedAt = now
      acts.push({ kind: 'save', hash })
      acts.push({ kind: 'email', urgent: true, hash, label: `cbob-core-watch:changed:${hash.slice(0, 12)}`,
        text: `Metaplex Core changed on mainnet (deploy slot ${slot}). New bytes sha256 ${hash.slice(0, 16)}..., pinned ${obs.pin.slice(0, 16)}.... Every CBOB vault is a Core asset, so our tests no longer cover the Core that is live. The full on-chain suite against the new bytes starts as soon as the test validator is free; its result follows by email. Nothing is re-pinned automatically. ${releaseNote(obs)}` })
    }
    const suite = obs.suite
    if (!suite) acts.push({ kind: 'suite', hash })
    else if (finished(suite) && !rec.resultSentAt) {
      rec.resultSentAt = now
      acts.push(resultEmail(hash, suite, ''))
    } else if (prev === hash) {
      // level-triggered re-assertion while live stays off the pin; the router collapses repeats
      acts.push({ kind: 'email', urgent: false, label: 'cbob-core-watch:unpinned',
        text: `Metaplex Core on mainnet is still not the pinned build (live ${hash.slice(0, 16)}..., pinned ${obs.pin.slice(0, 16)}...). Suite: ${suite.status}${suite.rc !== undefined ? ' rc ' + suite.rc : ''}.` })
    }
  }
  // round 47, V47o-7: Core changed AGAIN before an earlier build's suite finished. That result
  // was promised by email ("its result follows"), so it is still sent, once, marked as earlier.
  for (const [h, res] of Object.entries(obs.prior || {})) {
    const rec = s.seen[h]
    if (h === hash || !rec || !rec.alertedAt || rec.resultSentAt || !finished(res)) continue
    rec.resultSentAt = now
    acts.push(resultEmail(h, res, ` This was an EARLIER Core build; live has since changed again (now ${hash.slice(0, 16)}...).`))
  }
  if (obs.osec) {
    const o = { verified: !!obs.osec.verified, commit: obs.osec.commit || null }
    if (s.osec && (s.osec.verified !== o.verified || s.osec.commit !== o.commit))
      acts.push({ kind: 'email', urgent: false, label: 'cbob-core-watch:verified-build',
        text: `Metaplex Core's verified-build status changed: verified ${s.osec.verified} -> ${o.verified}, commit ${s.osec.commit || 'none'} -> ${o.commit || 'none'}. If it now matches the live bytes, a public source diff of the new Core is possible.` })
    s.osec = o
  }
  if (obs.tags) {
    const known = new Set(s.tags || [])
    for (const t of obs.tags) if (!known.has(t)) acts.push({ kind: 'log', text: `new Metaplex release tag ${t}` })
    s.tags = [...new Set([...(s.tags || []), ...obs.tags])]
  }
  return { state: s, acts }
}
function finished(suite) { return suite.status === 'done' || suite.status === 'unreadable' }
function resultEmail(hash, suite, note) {
  const label = `cbob-core-watch:result:${hash.slice(0, 12)}`
  if (suite.status === 'unreadable') return { kind: 'email', urgent: true, hash, label,
    text: `${suite.died
      ? `The CBOB on-chain suite against the new Metaplex Core (${hash.slice(0, 16)}...) DIED while ${suite.was} (killed, out of memory or a reboot), so its result is UNKNOWN.`
      : `The CBOB on-chain suite against the new Metaplex Core (${hash.slice(0, 16)}...) finished, but its result file cannot be read, so its result is UNKNOWN.`} Treat it as FAILED: do not move any CBOB program toward lock until the log is read. It is not re-run automatically; to run it again: bash ${ROOT}/scripts/core-watch-suite.sh ${hash}. Result file: ${DIR}/suite-${hash}.json.${note}` }
  const pass = suite.rc === 0
  return { kind: 'email', urgent: !pass, hash, label,
    text: pass
      ? `The full CBOB on-chain suite PASSED against the new Metaplex Core (${hash.slice(0, 16)}...): ${suite.summary}. Next is a deliberate re-pin (a commit), then e2e and sim against it. Log: ${suite.log}${note}`
      : `The full CBOB on-chain suite FAILED against the new Metaplex Core (${hash.slice(0, 16)}...), rc ${suite.rc}: ${suite.summary}. Do not move any CBOB program toward lock until this is understood. Log: ${suite.log}${note}` }
}
function releaseNote(obs) {
  return obs.tags && obs.tags.length ? `Latest public Metaplex release tag: ${obs.tags[0]}.` : 'No public release tag was readable.'
}

function log(line) { fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`) }

async function rpcUrls() {
  const urls = ['https://api.mainnet-beta.solana.com']
  try { // the box's Helius as a fallback, read in-process and never printed
    const m = fs.readFileSync('/opt/gary-club/.env.local', 'utf8').match(/^HELIUS_RPC_URL=(.*)$/m)
    if (m) urls.push(m[1].trim())
  } catch {}
  return urls
}
async function rpc(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'curl/7.81.0' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) })
  const j = await r.json()
  if (j.error || !j.result) throw new Error(`${method}: ${j.error?.message || 'no result'}`)
  return j.result.value
}
async function readLive() {
  for (const url of await rpcUrls()) {
    try {
      const core = await rpc(url, 'getAccountInfo', [CORE, { encoding: 'base64', commitment: 'finalized' }])
      const cdata = Buffer.from(core.data[0], 'base64')
      if (cdata.readUInt32LE(0) !== 2) throw new Error('Core is not an upgradeable program account')
      const pdKey = b58(cdata.subarray(4, 36))
      const pd = await rpc(url, 'getAccountInfo', [pdKey, { encoding: 'base64', commitment: 'finalized' }])
      const data = Buffer.from(pd.data[0], 'base64')
      if (data.readUInt32LE(0) !== 3 || data.subarray(45, 49).toString('hex') !== '7f454c46') throw new Error('ProgramData is not a program')
      return { hash: createHash('sha256').update(data.subarray(45)).digest('hex'), slot: Number(data.readBigUInt64LE(4)), bytes: data.subarray(45) }
    } catch (e) { log(`read failed on ${url.startsWith('https://api.mainnet') ? 'public RPC' : 'box RPC'}: ${String(e.message).replace(/https?:\/\/\S+/g, '<url>').slice(0, 160)}`) }
  }
  return null
}
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function b58(buf) {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex')), s = ''
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n }
  for (const b of buf) { if (b) break; s = '1' + s }
  return s
}
async function readOsec() {
  try { const j = await (await fetch(OSEC, { signal: AbortSignal.timeout(20000) })).json(); return { verified: j.is_verified === true, commit: j.commit || null } }
  catch { return null }
}
async function readTags() {
  try {
    const j = await (await fetch(RELEASES, { headers: { 'user-agent': 'curl/7.81.0' }, signal: AbortSignal.timeout(20000) })).json()
    return Array.isArray(j) ? j.map(r => r.tag_name).filter(Boolean) : null
  } catch { return null }
}
// undefined only when NO result file exists (the suite never started); a file that will not
// parse is a finished run with an unknown result, never a reason to start again (V47o-1).
// Round 48 (V48o-1): a result still saying queued/waiting/running whose run is GONE (it
// names another boot, or a pid that no longer runs the diagnostic) is a run that DIED
// outside its trap: unknown too, reported once, never left waiting forever.
const BOOT_NOW = (() => { try { return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() } catch { return null } })()
export function runGone(r, bootNow = BOOT_NOW, alive = pid => { try { return /core-watch-suite\.sh/.test(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')) } catch { return false } }) {
  if (!['queued', 'waiting', 'running'].includes(r.status) || !r.pid) return false
  return (!!r.boot && !!bootNow && r.boot !== bootNow) || !alive(r.pid)
}
export function suiteStatus(hash, dir = DIR, gone = runGone) {
  const f = `${dir}/suite-${hash}.json`
  if (!fs.existsSync(f)) return undefined
  let r; try { r = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return { status: 'unreadable', log: f } }
  return gone(r) ? { status: 'unreadable', died: true, was: r.status, log: f } : r
}

async function tick({ dry }) {
  fs.mkdirSync(DIR, { recursive: true })
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {}
  const live = await readLive()
  const pin = readPin()
  const obs = { live: live && { hash: live.hash, slot: live.slot }, pin, osec: await readOsec(), tags: await readTags(),
    suite: live && live.hash !== pin ? suiteStatus(live.hash) : undefined,
    prior: Object.fromEntries(Object.entries(state.seen || {}).filter(([h, r]) => r.alertedAt && !r.resultSentAt && (!live || h !== live.hash))
      .map(([h]) => [h, suiteStatus(h)]).filter(([, v]) => v)) }
  const { state: next, acts } = decide(state, obs, new Date().toISOString())
  log(`live ${live ? live.hash.slice(0, 16) + ' slot ' + live.slot : 'UNREADABLE'} pin ${pin.slice(0, 16)} ${live && live.hash === pin ? 'OK' : 'OFF-PIN'}; actions: ${acts.map(a => a.kind).join(',') || 'none'}`)
  for (const a of acts) {
    if (a.kind === 'log') log(a.text)
    if (a.kind === 'save') {
      const f = `${DIR}/core-${a.hash}.so`
      if (!fs.existsSync(f)) fs.writeFileSync(f, live.bytes, { mode: 0o644 })
      if (createHash('sha256').update(fs.readFileSync(f)).digest('hex') !== a.hash) throw new Error('saved Core bytes do not hash to what was read')
    }
    if (a.kind === 'suite') {
      if (dry) { log(`DRY: would start the suite against ${a.hash.slice(0, 16)}`); continue }
      const c = spawn('setsid', ['bash', `${ROOT}/scripts/core-watch-suite.sh`, a.hash], { detached: true, stdio: 'ignore' })
      c.unref(); log(`suite started for ${a.hash.slice(0, 16)} (pid ${c.pid})`)
      // the diagnostic overwrites this at once; pid and boot let a start that never ran read as DIED (V48o-1)
      if (!fs.existsSync(`${DIR}/suite-${a.hash}.json`)) fs.writeFileSync(`${DIR}/suite-${a.hash}.json`, JSON.stringify({ status: 'queued', pid: c.pid, boot: BOOT_NOW, at: new Date().toISOString() }))
    }
    if (a.kind === 'email') {
      if (dry) { log(`DRY: would email (${a.urgent ? 'URGENT' : 'normal'}) ${a.label}: ${a.text}`); continue }
      const r = spawnSync(NOTIFY, [a.text, a.label], { env: { ...process.env, ...(a.urgent ? { ALERT_URGENT: '1' } : {}) }, stdio: 'ignore', timeout: 60000 })
      log(`email ${a.label} ${a.urgent ? 'URGENT ' : ''}rc ${r.status}`)
      if (r.status !== 0 && a.hash) { // undelivered: un-mark it so the next tick sends it again
        const rec = next.seen?.[a.hash]
        if (rec) delete rec[a.label.includes(':changed:') ? 'alertedAt' : 'resultSentAt']
      }
    }
  }
  if (!dry) fs.writeFileSync(STATE, JSON.stringify(next, null, 1))
  return live && live.hash === pin ? 0 : live ? 1 : 2
}

function selftest() {
  const P = 'a'.repeat(64), N = 'b'.repeat(64), now = 't'
  let ok = 0, bad = 0
  const t = (name, cond) => { cond ? ok++ : bad++; console.log(`  ${cond ? 'ok ' : 'XX '} ${name}`) }
  const kinds = r => r.acts.map(a => a.kind + (a.urgent ? '!' : '')).join(',')
  let r = decide({}, { live: { hash: P, slot: 1 }, pin: P, osec: null, tags: null }, now)
  t('live == pin: no email, no suite', kinds(r) === '')
  r = decide({ lastHash: P }, { live: { hash: N, slot: 2 }, pin: P, osec: null, tags: ['release/core@9'] }, now)
  t('live != pin, first sight: save + URGENT email + suite start', kinds(r) === 'save,email!,suite,log')
  t('...and the email names the new hash and the release tag', /bbbbbbbbbbbbbbbb/.test(r.acts[1].text) && /release\/core@9/.test(r.acts[1].text))
  const s1 = r.state
  r = decide(s1, { live: { hash: N, slot: 2 }, pin: P, osec: null, tags: null, suite: { status: 'running' } }, now)
  t('still off pin, suite running: one NON-urgent re-assertion, no second urgent, no second suite', kinds(r) === 'email')
  r = decide(s1, { live: { hash: N, slot: 2 }, pin: P, osec: null, tags: null, suite: { status: 'done', rc: 0, summary: 'x', log: 'l' } }, now)
  t('suite passed: one normal result email', kinds(r) === 'email' && /PASSED/.test(r.acts[0].text))
  r = decide(r.state, { live: { hash: N, slot: 2 }, pin: P, osec: null, tags: null, suite: { status: 'done', rc: 0 } }, now)
  t('...sent once: the next tick only re-asserts', kinds(r) === 'email' && r.acts[0].label === 'cbob-core-watch:unpinned')
  r = decide(s1, { live: { hash: N, slot: 2 }, pin: P, osec: null, tags: null, suite: { status: 'done', rc: 1, summary: 'x', log: 'l' } }, now)
  t('suite failed: URGENT result email', kinds(r) === 'email!' && /FAILED/.test(r.acts[0].text))
  r = decide(s1, { live: { hash: N, slot: 2 }, pin: N, osec: null, tags: null }, now)
  t('re-pinned to the new bytes: silent', kinds(r) === '')
  let st = {}
  for (let i = 1; i <= 12; i++) { r = decide(st, { live: null, pin: P }, now); st = r.state; if (i === 5) t('unreadable 5x: silent', kinds(r) === ''); if (i === 6) t('unreadable 6x: one normal email', kinds(r) === 'email'); if (i === 7) t('unreadable 7x: silent again', kinds(r) === '') }
  r = decide(st, { live: { hash: P, slot: 1 }, pin: P }, now)
  t('a good read resets the unreadable streak', r.state.failStreak === 0)
  r = decide({ osec: { verified: false, commit: 'c1' } }, { live: { hash: P, slot: 1 }, pin: P, osec: { verified: false, commit: 'c1' } }, now)
  t('verified-build status unchanged: silent', kinds(r) === '')
  r = decide({ osec: { verified: false, commit: 'c1' } }, { live: { hash: P, slot: 1 }, pin: P, osec: { verified: true, commit: 'c2' } }, now)
  t('verified-build status changed: one normal email', kinds(r) === 'email')
  r = decide({}, { live: { hash: P, slot: 1 }, pin: P, osec: { verified: false, commit: 'c1' } }, now)
  t('first osec reading only records', kinds(r) === '' && r.state.osec.commit === 'c1')
  r = decide({ tags: ['a'] }, { live: { hash: P, slot: 1 }, pin: P, tags: ['b', 'a'] }, now)
  t('a new release tag alone is logged, never emailed', kinds(r) === 'log')
  // round 47, V47o-1: a finished run whose result file is unreadable is reported once, URGENT, and never re-run
  r = decide(s1, { live: { hash: N, slot: 2 }, pin: P, osec: null, tags: null, suite: { status: 'unreadable', log: 'f' } }, now)
  t('V47o-1: an UNREADABLE result is one URGENT "unknown, treat as failed" email and NO new suite', kinds(r) === 'email!' && /UNKNOWN/.test(r.acts[0].text))
  r = decide(r.state, { live: { hash: N, slot: 2 }, pin: P, osec: null, tags: null, suite: { status: 'unreadable', log: 'f' } }, now)
  t('V47o-1: ...and the next tick neither re-sends it nor restarts the suite', kinds(r) === 'email' && r.acts[0].label === 'cbob-core-watch:unpinned')
  {
    const fs2 = fs, d = fs2.mkdtempSync('/tmp/cbob-cw47-')
    fs2.writeFileSync(`${d}/suite-${N}.json`, '{"status":"done","rc":0,"summary":"0\n0"}'.replace('\\n', '\n'))
    const raw = fs2.readFileSync(`${d}/suite-${N}.json`, 'utf8')
    t('V47o-1: suiteStatus reads a raw-newline result file as unreadable, a missing one as never started', /\n/.test(raw) && suiteStatus(N, d)?.status === 'unreadable' && suiteStatus(P, d) === undefined)
    const sh = spawnSync('bash', ['-c', `OUT=${d}/r.json; LOGF=/x; source <(sed -n '/^res(){/p' ${ROOT}/scripts/core-watch-suite.sh); res done 0 "912/912 as predicted"$'\n'"0 failing assertions"; cat $OUT`], { encoding: 'utf8' })
    let parsed; try { parsed = JSON.parse(sh.stdout) } catch { parsed = null }
    t('V47o-1: core-watch-suite.sh writes a result with a newline in it as VALID JSON', parsed?.status === 'done' && parsed?.rc === 0 && /\n/.test(parsed?.summary || ''))
    fs2.rmSync(d, { recursive: true, force: true })
  }
  // round 47, V47o-7: Core changes again before the first suite finishes; the first result is still sent
  const M = 'c'.repeat(64)
  r = decide(s1, { live: { hash: M, slot: 3 }, pin: P, osec: null, tags: null, prior: { [N]: { status: 'running' } } }, now)
  const s2 = r.state
  t('V47o-7: a second change starts its own suite and holds the first, still running', kinds(r) === 'save,email!,suite')
  r = decide(s2, { live: { hash: M, slot: 3 }, pin: P, osec: null, tags: null, suite: { status: 'running' }, prior: { [N]: { status: 'done', rc: 0, summary: 'x', log: 'l' } } }, now)
  t('V47o-7: ...the FIRST build\'s result is emailed once, marked as an earlier build', r.acts.some(a => a.label === `cbob-core-watch:result:${N.slice(0, 12)}` && /EARLIER Core build/.test(a.text)))
  r = decide(r.state, { live: { hash: M, slot: 3 }, pin: P, osec: null, tags: null, suite: { status: 'running' }, prior: { [N]: { status: 'done', rc: 0 } } }, now)
  t('V47o-7: ...and only once', !r.acts.some(a => a.label === `cbob-core-watch:result:${N.slice(0, 12)}`))
  // round 48, V48o-1: a run killed outside its trap reads as DIED (once, URGENT), never "waiting" forever
  {
    const live = () => true, dead = () => false
    t('V48o-1: a waiting/running result from ANOTHER boot, or whose pid is gone, is a run that died; a live one, a finished one or one without a pid is not',
      [runGone({ status: 'waiting', pid: 7, boot: 'b1' }, 'b2', live), runGone({ status: 'running', pid: 7, boot: 'b1' }, 'b1', dead), runGone({ status: 'running', pid: 7, boot: 'b1' }, 'b1', live),
        runGone({ status: 'done', rc: 0, pid: 7, boot: 'b1' }, 'b2', dead), runGone({ status: 'queued' }, 'b2', dead)].join(), 'true,true,false,false,false')
    const d = fs.mkdtempSync('/tmp/cbob-cw48-')
    fs.writeFileSync(`${d}/suite-${N}.json`, JSON.stringify({ status: 'waiting', pid: 7, boot: 'b-old' }))
    const st = suiteStatus(N, d, r => runGone(r, 'b-now', live))
    t('V48o-1: ...suiteStatus reads it as an unknown result that DIED while waiting', st?.status === 'unreadable' && st.died === true && st.was === 'waiting')
    r = decide(s1, { live: { hash: N, slot: 2 }, pin: P, osec: null, tags: null, suite: st }, now)
    t('V48o-1: ...and the watch sends ONE URGENT "DIED ... UNKNOWN" email with the command to run it again, and starts nothing', kinds(r) === 'email!' && /DIED while waiting/.test(r.acts[0].text) && /core-watch-suite\.sh bbbb/.test(r.acts[0].text))
    fs.rmSync(d, { recursive: true, force: true })
    const src = fs.readFileSync(`${ROOT}/scripts/core-watch-suite.sh`, 'utf8')
    t('V48o-1 / V48o-5: the diagnostic stamps pid and boot in every result and its marker replaces a dead one; its failure count is read from its OWN log',
      /"\$\$" "\$BOOT" > "\$OUT\.tmp"/.test(src) && /kill -0 "\$\{MPID:-0\}"/.test(src) && /grep -c '\^  XX' "\$LOGF"/.test(src) && !/\$C\/suite\.log/.test(src))
  }
  t('readPin reads the real pin', /^[0-9a-f]{64}$/.test(readPin()))
  let threw = false; try { readPin('nothing here') } catch { threw = true }
  t('readPin refuses a file with no pin', threw)
  // round 48 (V48o-2): EQUAL to its floor, as every other selftest here, so deleting an arm fails too
  const FLOOR = 29
  console.log(`\n${ok}/${ok + bad} core-watch assertions as predicted`)
  if (ok + bad !== FLOOR) console.log(`${ok + bad} core-watch assertions ran; the floor says ${FLOOR}. They must be EQUAL.`)
  process.exit(bad || ok + bad !== FLOOR ? 1 : 0)
}

if (args.includes('--selftest')) selftest()
else if (args.includes('--status')) console.log(fs.existsSync(STATE) ? fs.readFileSync(STATE, 'utf8') : 'no state yet')
else process.exit(await tick({ dry: args.includes('--dry') }))
