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

export function acquireLock(file, { staleMs = 6 * 3600_000, now = Date.now() } = {}) {
  const payload = JSON.stringify({ pid: process.pid, at: new Date(now).toISOString() })
  try {
    fs.writeFileSync(file, payload, { flag: 'wx' })
    return { ok: true, broke: null }
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
  }
  let held = null
  try { held = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* unreadable lock: treat by age */ }
  const age = now - Date.parse(held?.at || 0)
  if (Number.isFinite(age) && age < staleMs) {
    return { ok: false, broke: null, held, ageMs: age }
  }
  // Stale. Break it, but SAY SO — a silently broken lock is how you get two
  // runners anyway, on the day the first one was merely slow.
  fs.writeFileSync(file, payload)
  return { ok: true, broke: held, ageMs: age }
}

export function releaseLock(file) { try { fs.unlinkSync(file) } catch { /* already gone */ } }

/** Run `fn` under an exclusive lock, releasing it however `fn` ends. */
export async function withLock(file, fn, opts = {}) {
  const l = acquireLock(file, opts)
  if (!l.ok) {
    const e = new Error(`another run holds ${file} (pid ${l.held?.pid}, started ${l.held?.at}) — refusing to run concurrently`)
    e.code = 'ELOCKED'
    throw e
  }
  try { return await fn(l) } finally { releaseLock(file) }
}

/**
 * MISSING is a fresh start. UNPARSEABLE is an abort, never an empty ledger.
 * `fallback` is what a first-ever run should see.
 */
export function readLedger(file, fallback) {
  let raw
  try { raw = fs.readFileSync(file, 'utf8') }
  catch (e) {
    if (e.code === 'ENOENT') return structuredClone(fallback)
    throw e
  }
  try { return JSON.parse(raw) }
  catch (e) {
    throw new Error(`${file} exists but will not parse (${e.message}). REFUSING to treat a corrupt ledger as an empty one — that would re-send everything it recorded. Fix or move the file by hand.`)
  }
}

/** Atomic: write beside the target, fsync, rename. A crash leaves the old file. */
export function writeLedger(file, obj) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp${process.pid}`)
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, JSON.stringify(obj, null, 2))
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, file)
}
