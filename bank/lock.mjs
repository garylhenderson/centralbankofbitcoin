/**
 * ONE RUNNER AT A TIME, and a ledger that never lies about what it has paid.
 *
 * WHY THIS FILE EXISTS. Two of these jobs move real money and both kept their
 * record of what they had already done in a JSON file they read at startup and
 * rewrote after every transfer. That is safe against a CRASH — which is what the
 * comments claimed — and it is not safe against a SECOND RUNNER. Two processes
 * (the cron firing while someone runs it by hand, or a run that overruns its own
 * interval) each load the ledger at start, each hold their own copy in memory,
 * and each `save()` writes the WHOLE object. The second one to write erases the
 * first one's record of every transfer it made, and the next run pays those
 * vaults again. `distribute.mjs`'s header said it "refuses to pay twice"; it
 * refused to pay twice in sequence, never in parallel.
 *
 * TWO PROBLEMS, TWO ANSWERS:
 *
 *   withLock()  an O_EXCL lock file holding the pid and a timestamp. A second
 *               runner refuses to start rather than racing. A lock older than
 *               `staleMs` is broken deliberately and loudly, because a lock that
 *               can never be broken is an outage waiting for the first crash.
 *
 *   readLedger()/writeLedger()  a MISSING file is a fresh start; a file that
 *               exists and will not parse is an ABORT. The old `try { ... }
 *               catch { return {} }` could not tell those apart, so a truncated
 *               or corrupted ledger read as "nothing has ever been paid" and the
 *               next run would have paid every vault a second time. Writes go
 *               through a temp file and a rename, so a crash mid-write leaves
 *               the previous ledger intact instead of the truncation that
 *               created that state in the first place.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

/**
 * ROUND 11. EVERY AUDITOR FOUND THIS FILE, AND THEY WERE RIGHT.
 *
 * The lock above was not a lock. Three defects composed into exactly the
 * double-payment its own header says it exists to prevent:
 *
 *   1. THE STALE BREAK WAS A PLAIN OVERWRITE. `writeFileSync` with no `wx`, so
 *      two runners that both saw one stale lock both wrote it and both returned
 *      ok. The single path that most needed O_EXCL was the one path without it.
 *   2. RELEASE WAS UNCONDITIONAL. `unlinkSync` with no ownership test, called
 *      from `finally`, so a slow-but-alive runner deleted its REPLACEMENT's
 *      lock on the way out and a third runner walked in.
 *   3. AGE WAS TREATED AS DEATH. Nothing asked whether the holder was still
 *      running, so a job that was merely slow — 2,100 sequential confirmed
 *      transfers, or one RPC call with no timeout — was stolen from rather
 *      than waited for. Round 10 moved the timeout 6h -> 20h, which lowers the
 *      probability of that and establishes no exclusion at all.
 *
 * And the comment promised "SAY SO" while `withLock` took `l.broke` and dropped
 * it. The only consumer of `broke` in the repo was the SELFTEST asserting the
 * return value. A property can be tested and still not be delivered.
 *
 * THE RULE NOW: a lock may only be broken when the holder is BOTH stale AND
 * gone, the break is atomic, release is by token, and breaking is loud. A live
 * holder is never stolen from — for a money job an outage that pages is the
 * correct trade against a payment made twice.
 */

/** EPERM means the pid exists and is not ours; only ESRCH means gone. */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

export function acquireLock(file, { staleMs = 6 * 3600_000, now = Date.now(), alive = pidAlive,
  /** TEST SEAM, never set in production. The lost-race branch below is only
   *  reachable when a SECOND process creates the lock between our unlink and
   *  our O_EXCL create — which cannot be produced from one process, and which
   *  is exactly the branch whose absence made the old break non-exclusive. A
   *  branch that has only ever said one thing is untested, so there is a way to
   *  make it say the other. */
  _afterUnlink = null } = {}) {
  const token = crypto.randomUUID()
  const payload = JSON.stringify({ pid: process.pid, token, at: new Date(now).toISOString() })
  try {
    fs.writeFileSync(file, payload, { flag: 'wx' })
    return { ok: true, broke: null, token }
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
  }
  let held = null
  try { held = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* unreadable lock: treat by age */ }
  const age = now - Date.parse(held?.at || 0)
  if (Number.isFinite(age) && age < staleMs) {
    return { ok: false, broke: null, held, ageMs: age }
  }
  // STALE IS NOT DEAD. The case this break exists for is a CRASH; a slow run is
  // not that, and stealing from it is the double-pay.
  if (held?.pid && alive(held.pid)) {
    return { ok: false, broke: null, held, ageMs: age, aliveHolder: true }
  }
  // Stale AND gone. Break it ATOMICALLY: unlink, then re-create with O_EXCL, so
  // of two runners racing the same dead lock exactly one can win.
  try { fs.unlinkSync(file) } catch (e) { if (e.code !== 'ENOENT') throw e }
  _afterUnlink?.()
  try {
    fs.writeFileSync(file, payload, { flag: 'wx' })
  } catch (e) {
    if (e.code === 'EEXIST') return { ok: false, broke: null, held, ageMs: age, lostRace: true }
    throw e
  }
  return { ok: true, broke: held, ageMs: age, token }
}

/** Unlink ONLY a lock still carrying this run's token. Returns whether it did.
 *  A lock that has been broken out from under us is left alone: it belongs to
 *  whoever holds it now, and deleting it is how a third runner gets in. */
export function releaseLock(file, token) {
  let held = null
  try { held = JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (e) { return e.code === 'ENOENT' }
  if (!token || held?.token !== token) return false
  try { fs.unlinkSync(file) } catch { /* already gone */ }
  return true
}

/** Run `fn` under an exclusive lock, releasing it however `fn` ends. */
export async function withLock(file, fn, opts = {}) {
  const l = acquireLock(file, opts)
  if (!l.ok) {
    const mins = Number.isFinite(l.ageMs) ? Math.round(l.ageMs / 60_000) : '?'
    const why = l.aliveHolder
      ? `pid ${l.held?.pid} is STILL ALIVE after ${mins} min. Refusing to break a live holder's lock: `
        + `if it is genuinely wedged, kill it and remove ${file} by hand.`
      : l.lostRace ? 'another runner broke the same stale lock first'
      : `pid ${l.held?.pid}, started ${l.held?.at}`
    const e = new Error(`another run holds ${file} (${why}) — refusing to run concurrently`)
    e.code = 'ELOCKED'
    throw e
  }
  // SAY SO — the thing the old comment promised and no caller did.
  if (l.broke) {
    console.error(`WARNING: broke a STALE lock on ${file}. Held by pid ${l.broke.pid} since ${l.broke.at} `
      + `(${Math.round(l.ageMs / 60_000)} min); that process is no longer running.`)
  }
  try { return await fn(l) }
  finally {
    if (!releaseLock(file, l.token)) {
      console.error(`WARNING: did NOT release ${file} — it no longer carries this run's token. `
        + 'Another runner holds it now; this run may have been running beside it.')
    }
  }
}

/**
 * MISSING is a fresh start ONLY THE FIRST TIME. UNPARSEABLE is always an abort.
 *
 * Round 6 made a corrupt ledger fatal and left an ABSENT one reading as day one.
 * Round 7 closed that for the alarm's state file and left the two MONEY ledgers
 * open — so deleting `distributions.json`, on the same host and as the same user
 * as the signing keys, made every vault look unpaid and a same-day re-run pay
 * them all again. Deleting `revenue-ledger.json` erased every unreconciled sweep.
 * The lock does not help: it stops two writers, not one fresh process that has
 * just been handed an empty ledger.
 *
 * So a MARKER is written beside the ledger the first time it is saved, and a
 * missing ledger with the marker present is a refusal. The marker is deliberately
 * a separate file: deleting one does not delete the other's memory of it.
 */
export function readLedger(file, fallback, marker = null) {
  let raw
  try { raw = fs.readFileSync(file, 'utf8') }
  catch (e) {
    if (e.code === 'ENOENT') {
      if (marker && fs.existsSync(marker)) {
        throw new Error(`${file} is MISSING, but ${marker} says it has been written before. `
          + 'That file is the only record of what has already been done; starting fresh would repeat all of it. '
          + 'Restore it, or remove the marker deliberately once you are satisfied.')
      }
      return structuredClone(fallback)
    }
    throw e
  }
  try { return JSON.parse(raw) }
  catch (e) {
    throw new Error(`${file} exists but will not parse (${e.message}). REFUSING to treat a corrupt ledger as an empty one — that would re-send everything it recorded. Fix or move the file by hand.`)
  }
}

/** Atomic: write beside the target, fsync, rename. A crash leaves the old file.
 *  Stamps the marker so a later disappearance is a refusal, not a fresh start. */
export function writeLedger(file, obj, marker = null) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp${process.pid}`)
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, JSON.stringify(obj, null, 2))
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  // THE MARKER GOES DOWN FIRST, AND ITS FAILURE IS FATAL. It was written after
  // the rename and its error swallowed, so a crash or a permissions fault
  // between the two left a saved ledger with no marker — and deleting that
  // ledger later read as day one, which is the whole failure the marker exists
  // to stop. Written first, the only way to be wrong is to refuse a genuinely
  // fresh start, which costs a human one deliberate `rm` and never a repeat
  // payment.
  if (marker && !fs.existsSync(marker)) fs.writeFileSync(marker, new Date().toISOString())
  fs.renameSync(tmp, file)
}
