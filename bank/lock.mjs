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

/**
 * ROUND 12. THE ROUND-11 REWRITE WAS STILL NOT EXCLUSIVE, and two auditors found
 * the same interleaving:
 *
 *   A reads a stale, dead lock.   B reads the same stale, dead lock.
 *   A unlinks, creates with wx  -> A HOLDS and starts paying.
 *   B unlinks (DELETING A'S FRESH LOCK), creates with wx -> B HOLDS TOO.
 *
 * `wx` made the CREATE exclusive and nothing guarded the UNLINK, so the header's
 * claim that "exactly one racer wins" was false in the very ordering it was
 * written for. Worse, the `_afterUnlink` seam I added tests the OTHER order —
 * someone creates during MY gap — so the broken branch was the untested one.
 *
 * Three changes:
 *   1. The lock is created with `link()` from a temp file, not `writeFileSync`
 *      with `wx`. `wx` is open-then-write, so the lock is briefly observable at
 *      ZERO BYTES; a reader landing there parses nothing (see 2). `link` is a
 *      single atomic syscall that fails EEXIST, and the file is fully formed
 *      before it is ever visible under its real name.
 *   2. An UNREADABLE or EMPTY lock is a REFUSAL, never a break. The old code
 *      fell through both gates: `Date.parse(undefined)` is NaN, so the
 *      freshness test was skipped, and `held?.pid` was null so the liveness test
 *      was skipped. It then broke the lock and reported `broke: null`, which
 *      `withLock` prints nothing for — so the one break that is definitely
 *      unsafe was the one break that happened in silence.
 *   3. The break RE-READS and requires the same token immediately before the
 *      unlink. That closes the descheduling-sized window above.
 *
 * ROUND 14 CLOSED THE TOCTOU THIS PARAGRAPH USED TO ADMIT. The break is now a
 * single atomic `rename` to a name only this process knows, so two racers can
 * never both take the lock out of the way. What follows described the old
 * narrowing, and is kept because the reasoning is still why the re-read is there.
 *
 * A microsecond TOCTOU remained between the re-read and the unlink. The durable
 * answer is a lock nobody has to break — an OS lease on an open fd — and that
 * is recorded as the next step rather than half-built here.
 */

/** EPERM means the pid exists and is not ours; only ESRCH means gone. */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

/** A pid is not an identity: pid_max is 32768 on many boxes, so within a 20-hour
 *  window a crashed run's pid is routinely reused by something unrelated and the
 *  lock becomes permanently unbreakable. Linux field 22 of /proc/<pid>/stat is
 *  the process START TIME, which distinguishes a recycled pid from the original.
 *  Unavailable (non-Linux, permissions) reads as null and we fall back to the
 *  pid alone, which is the safe direction: refuse rather than break. */
function pidStart(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] || null
  } catch { return null }
}

/** Create the lock ATOMICALLY and never in a half-written state. */
function claim(file, payload) {
  const tmp = `${file}.claim.${process.pid}.${crypto.randomBytes(6).toString('hex')}`
  fs.writeFileSync(tmp, payload)
  try {
    fs.linkSync(tmp, file)       // atomic; EEXIST if anyone holds it
    return true
  } catch (e) {
    if (e.code === 'EEXIST') return false
    throw e
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* nothing to clean */ }
  }
}

export function acquireLock(file, { staleMs = 6 * 3600_000, now = Date.now(), alive = pidAlive, _beforeSteal = null,
  /** TEST SEAM, never set in production. The lost-race branch below is only
   *  reachable when a SECOND process creates the lock between our unlink and
   *  our O_EXCL create — which cannot be produced from one process, and which
   *  is exactly the branch whose absence made the old break non-exclusive. A
   *  branch that has only ever said one thing is untested, so there is a way to
   *  make it say the other. */
  _afterUnlink = null,
  /** The second seam, for the interleaving the first one MISSED: another runner
   *  wins the break while we are still deciding to break. Fires between the
   *  decision and the confirming re-read. Round 12 found that branch by reading
   *  the code, because no test could reach it. */
  _beforeBreak = null } = {}) {
  const token = crypto.randomUUID()
  const payload = JSON.stringify({ pid: process.pid, token, start: pidStart(process.pid),
    at: new Date(now).toISOString() })
  if (claim(file, payload)) return { ok: true, broke: null, token }

  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }
  const held = read()
  // AN UNREADABLE LOCK IS A REFUSAL. It used to fall through the freshness gate
  // (NaN age) AND the liveness gate (no pid) and get broken, silently.
  if (!held || !held.at) {
    return { ok: false, broke: null, held: null, unreadable: true }
  }
  const age = now - Date.parse(held.at)
  if (!Number.isFinite(age)) return { ok: false, broke: null, held, unreadable: true }
  if (age < staleMs) return { ok: false, broke: null, held, ageMs: age }
  // STALE IS NOT DEAD. The case this break exists for is a CRASH; a slow run is
  // not that, and stealing from it is the double-pay. A recorded start time that
  // no longer matches means the pid was RECYCLED and the holder really is gone.
  if (held.pid && alive(held.pid)) {
    const nowStart = pidStart(held.pid)
    const recycled = held.start && nowStart && held.start !== nowStart
    if (!recycled) return { ok: false, broke: null, held, ageMs: age, aliveHolder: true }
  }
  // Stale AND gone. RE-READ AND CONFIRM THE SAME LOCK immediately before the
  // unlink: without this, two runners that both judged one stale lock each
  // unlinked in turn, and the second deleted the FIRST'S FRESH LOCK and then
  // created its own. Both held. That is the double-payment this file exists to
  // prevent, and it survived the round-11 rewrite.
  _beforeBreak?.()
  const still = read()
  if (!still || still.token !== held.token) {
    return { ok: false, broke: null, held: still, ageMs: age, lostRace: true }
  }
  // ---- THE STEAL IS ONE ATOMIC OPERATION. ROUND 14 (and 12, and 11). ----
  //
  // This used to be `unlinkSync(file)` then `claim(file)`, and three round-14
  // auditors independently wrote out the same interleaving:
  //
  //   A and B both read the same stale, dead lock and both see the same token.
  //   A unlinks, claims with wx  -> A HOLDS, and starts paying.
  //   B unlinks — DELETING A'S FRESH LOCK — claims with wx -> B HOLDS TOO.
  //
  // Re-reading immediately before the unlink NARROWS that window; it does not
  // close it, because compare-and-unlink is still two operations. The previous
  // header admitted "a microsecond TOCTOU remains" — that TOCTOU *is* the
  // double-payment this file exists to prevent, so admitting it was not a fix.
  //
  // `rename` IS atomic. Two racers renaming the same path to their own unique
  // names cannot both succeed: the loser gets ENOENT because the source is
  // already gone. Exactly one process can ever take the lock out of the way, and
  // it is the same process that then claims it. No native module, no flock, no
  // helper binary — the kernel already provides the primitive.
  const stolen = `${file}.breaking.${token}`
  // TEST SEAM. The branch below — "we renamed away a lock that had been REPLACED
  // since our re-read" — is a two-process interleaving that cannot happen inside
  // one process, so without this it is a branch nothing ever executes, which is
  // the same as not having written it.
  _beforeSteal?.()
  try { fs.renameSync(file, stolen) }
  catch (e) {
    if (e.code === 'ENOENT') return { ok: false, broke: null, held, ageMs: age, lostRace: true }
    throw e
  }
  _afterUnlink?.()
  // WE MAY HAVE STOLEN A REPLACEMENT. The read above was microseconds ago, but a
  // racer that won its own break in that gap left a FRESH lock here, and taking
  // it would be the very theft this is preventing. The rename is the only thing
  // that had to be atomic; this is the check that says WHOSE lock we took.
  let takenToken = null
  try { takenToken = JSON.parse(fs.readFileSync(stolen, 'utf8'))?.token ?? null } catch { /* unreadable */ }
  if (takenToken !== held.token) {
    // Put it back, but with an EXCLUSIVE create, never a rename: if a third
    // process has claimed `file` since, restoring by rename would clobber a live
    // lock and make things worse than the bug.
    try {
      const bytes = fs.readFileSync(stolen)
      const fd = fs.openSync(file, 'wx'); fs.writeSync(fd, bytes); fs.closeSync(fd)
    } catch { /* somebody already holds it; theirs stands */ }
    try { fs.unlinkSync(stolen) } catch { /* nothing to clean */ }
    return { ok: false, broke: null, held, ageMs: age, lostRace: true }
  }
  if (!claim(file, payload)) {
    try { fs.unlinkSync(stolen) } catch { /* nothing to clean */ }
    return { ok: false, broke: null, held, ageMs: age, lostRace: true }
  }
  try { fs.unlinkSync(stolen) } catch { /* nothing to clean */ }
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
    const why = l.unreadable
      ? `the lock file is unreadable or empty. It is NOT broken automatically — that is how a live `
        + `holder gets stolen from. Check whether a run is in progress, then remove ${file} by hand.`
      : l.aliveHolder
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
