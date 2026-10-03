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
 * ROUND 14 made the break a single atomic `rename` to a name only this process
 * knows, so two racers can never both take the lock out of the way. What follows
 * described the old narrowing, and is kept because the reasoning is still why the
 * re-read is there.
 *
 * ⚠️ ROUND 15 CALLED A NARROWING A CLOSE, AND ROUND 16 REPLACED THE MECHANISM.
 *
 * Round 15 measured the remaining hole: between the rename and the restore the
 * pathname does not exist, and a third runner's ordinary claim lands there. Both
 * it and the true holder returned ok:true. It then justified leaving that open
 * with a theorem — "no arrangement of `rename`, `link` and `unlink` is a
 * compare-and-swap" — and a round-16 auditor broke it in one line:
 *
 *     `link()` IS compare-and-swap. CAS(absent -> mine), atomic,
 *     kernel-enforced, and `place()` has relied on it since round 12.
 *
 * What this file never had is CAS(theirs -> mine), and it does not need it. The
 * hole exists only because the break REMOVES the contended name and then tries
 * to put it back. So the break stopped removing anything:
 *
 *   * the lock is the set of records `<file>.0`, `<file>.1`, ...
 *   * the HOLDER is the record in the highest-numbered file;
 *   * a breaker LINKS `<file>.<G+1>` — exactly one racer can win that — and then
 *     sweeps only generations strictly BELOW its own;
 *   * a live holder's record is therefore never removed by anyone else, and
 *     there is no interval in which the lock is absent.
 *
 * The restore branch — the source of every lock defect in rounds 12, 14 and 15 —
 * does not exist any more, because nothing is taken away to restore. Two, three
 * and four-racer interleavings all reduce to "one `link` winner per generation",
 * which is the primitive the uncontended path already trusted.
 *
 * `flock -n` in `scripts/cron-install.sh` stays as the OS-level belt for every
 * unattended run. It is no longer the only real answer, and it should not have
 * been: it was resting on a claim nobody had tried to break.
 *
 * WHAT IS STILL TRUE: a lock is only as good as the policy above it. STALE AND
 * GONE is the only condition that permits a break, an unreadable record is a
 * refusal, and a merely slow money job is waited for. */

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

/** Write a record under a name only this process could have chosen, then LINK it
 *  into place. `link` is CAS(absent -> mine): atomic, kernel-enforced, EEXIST for
 *  everyone else. It is the only primitive here and the whole scheme rests on it. */
function place(name, payload) {
  const tmp = `${name}.claim.${process.pid}.${crypto.randomBytes(6).toString('hex')}`
  fs.writeFileSync(tmp, payload)
  try { fs.linkSync(tmp, name); return true }
  catch (e) { if (e.code === 'EEXIST') return false; throw e }
  finally { try { fs.unlinkSync(tmp) } catch { /* nothing to clean */ } }
}

/** Every generation record present, newest first. The HOLDER is the record in the
 *  highest-numbered file; everything below it is garbage a winner has not swept. */
function scan(file) {
  const dir = file.slice(0, file.lastIndexOf('/')) || '.'
  const base = file.slice(file.lastIndexOf('/') + 1)
  let names
  try { names = fs.readdirSync(dir) } catch { return [] }
  const gens = []
  for (const n of names) {
    if (!n.startsWith(base + '.')) continue
    const tail = n.slice(base.length + 1)
    if (!/^\d+$/.test(tail)) continue          // .claim.<pid>.<rand> is not a generation
    gens.push(Number(tail))
  }
  return gens.sort((a, b) => b - a)
}

function readGen(file, g) {
  try { return JSON.parse(fs.readFileSync(`${file}.${g}`, 'utf8')) } catch { return null }
}
/**
 * CONFIRM, AFTER PLACING, THAT NOBODY ELSE HOLDS IT (round 22, F4).
 *
 * Generations can be REUSED: a release unlinks, and a breaker sweeps lower ones,
 * so a runner descheduled between its scan and its `place` could link a number
 * that had already been freed while a newer runner held another, and both
 * returned ok (measured through `_beforeSteal`). So whoever places re-scans:
 *   * any generation HIGHER than ours means somebody newer holds it: we lost;
 *   * a LOWER generation is ours to sweep only if it is the very record we
 *     decided to break (same token); anything else there is a live claim that
 *     arrived while we were not looking: we lost.
 * Losing unlinks OUR generation only. Two runners can both lose this way (the
 * safe direction); the next pass runs. Never both win.
 */
function confirmSole(file, myGen, myToken, brokenToken) {
  for (const g of scan(file)) {
    if (g === myGen) continue
    const r = readGen(file, g)
    if (g > myGen || !(brokenToken && r && r.token === brokenToken)) {
      if (g > myGen || r) { try { if (readGen(file, myGen)?.token === myToken) fs.unlinkSync(`${file}.${myGen}`) } catch {}
        return false }
    }
  }
  return true
}

export function acquireLock(file, { staleMs = 6 * 3600_000, now = Date.now(), alive = pidAlive,
  /** TEST SEAM. Fires after we have decided to break and before we link the new
   *  generation — the moment another runner could win it. It is the ONLY window
   *  in this scheme, and the point is that a loser there gets EEXIST and refuses
   *  rather than finding an empty pathname. */
  _beforeSteal = null,
  /** TEST SEAM, kept from the old API so the round-15 scenario still runs
   *  verbatim against the new mechanism: it fires immediately after we take a
   *  generation. Under the old code this was the hole; here there is nothing to
   *  land in. */
  _afterUnlink = null,
  /** TEST SEAM: fires between the decision and the confirming re-read. */
  _beforeBreak = null } = {}) {
  const token = crypto.randomUUID()
  const payload = () => JSON.stringify({ pid: process.pid, token, start: pidStart(process.pid),
    at: new Date(now).toISOString() })

  // Two passes at most. A lost race at generation 0 means somebody else just
  // created it, so the second pass evaluates their FRESH lock and refuses. There
  // is no third state to loop over.
  for (let attempt = 0; attempt < 2; attempt++) {
    const gens = scan(file)
    if (!gens.length) {
      if (place(`${file}.0`, payload())) {
        _afterUnlink?.()
        if (!confirmSole(file, 0, token, null)) return { ok: false, broke: null, held: null, lostRace: true }
        return { ok: true, broke: null, token, gen: 0 }
      }
      continue                                   // somebody linked .0 first; look again
    }
    const G = gens[0]
    const held = readGen(file, G)
    // AN UNREADABLE LOCK IS A REFUSAL, never a break. Unchanged policy.
    if (!held || !held.at) return { ok: false, broke: null, held: null, unreadable: true }
    const age = now - Date.parse(held.at)
    if (!Number.isFinite(age)) return { ok: false, broke: null, held, unreadable: true }
    if (age < staleMs) return { ok: false, broke: null, held, ageMs: age }
    // STALE IS NOT DEAD. A recorded start time that no longer matches means the
    // pid was RECYCLED and the holder really is gone.
    if (held.pid && alive(held.pid)) {
      const nowStart = pidStart(held.pid)
      const recycled = held.start && nowStart && held.start !== nowStart
      if (!recycled) return { ok: false, broke: null, held, ageMs: age, aliveHolder: true }
    }
    _beforeBreak?.()
    const still = readGen(file, G)
    if (!still || still.token !== held.token) {
      return { ok: false, broke: null, held: still, ageMs: age, lostRace: true }
    }
    _beforeSteal?.()
    // ---- THE BREAK IS A CREATE, NOT A DELETE. ROUND 16. ----
    //
    // Rounds 12, 14 and 15 each fixed a different interleaving of "remove the
    // contended name, then put something back", and round 15 MEASURED the third:
    // between the rename and the restore the pathname does not exist, and a third
    // runner's ordinary claim lands there. Both paid.
    //
    // The round-15 header answered that with a theorem — "no arrangement of
    // rename, link and unlink is a compare-and-swap" — and a round-16 auditor
    // broke it in one line: `link` IS compare-and-swap, CAS(absent -> mine),
    // which `place()` above has always relied on. What we never had is
    // CAS(theirs -> mine), and we do not need it: STOP DELETING THE CONTENDED
    // NAME. A breaker creates a HIGHER generation and only ever removes
    // generations strictly below its own, so a live holder's record is never
    // removed by anyone else and there is no interval in which the lock is
    // absent. Exactly one racer can link `${file}.${G+1}`; the losers get EEXIST,
    // look again, see a fresh record and refuse.
    //
    // The restore branch — the source of every lock defect in rounds 12, 14 and
    // 15 — does not exist any more, because nothing is taken away to restore.
    if (!place(`${file}.${G + 1}`, payload())) {
      return { ok: false, broke: null, held, ageMs: age, lostRace: true }
    }
    _afterUnlink?.()
    if (!confirmSole(file, G + 1, token, held.token)) return { ok: false, broke: null, held, ageMs: age, lostRace: true }
    // Sweep the record we broke, and only it (confirmSole proved nothing else
    // remains below us). Never at or above: at is ours.
    for (const g of scan(file)) if (g < G + 1) { try { fs.unlinkSync(`${file}.${g}`) } catch { /* already gone */ } }
    return { ok: true, broke: held, ageMs: age, token, gen: G + 1 }
  }
  // Both passes lost the create race, which means somebody holds a lock we could
  // not read in time. Refusing is the safe direction.
  return { ok: false, broke: null, held: null, lostRace: true }
}

/** Unlink ONLY a lock still carrying this run's token. Returns whether it did.
 *  A lock that has been broken out from under us is left alone: it belongs to
 *  whoever holds it now, and deleting it is how a third runner gets in. */
export function releaseLock(file, token) {
  // ROUND 15. This returned TRUE when the file was missing — "already gone, treat
  // it as released" — so the one state that means somebody took our lock out from
  // under us was the one state `withLock` printed nothing for.
  //
  // ROUND 16: it now looks for the generation carrying OUR token, which is the
  // only record we may ever remove. A generation that is not ours belongs to
  // whoever holds it now.
  if (!token) return false
  for (const g of scan(file)) {
    const rec = readGen(file, g)
    if (rec?.token !== token) continue
    try { fs.unlinkSync(`${file}.${g}`) } catch { /* already gone */ }
    return true
  }
  return false
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
  // AND FSYNC THE DIRECTORY. The file's own bytes are durable above; the RENAME
  // is a directory operation and is not, so a power loss between the two can
  // leave a fsynced ledger that no name points at — which reads as day one on the
  // next run and pays everyone again. Best-effort: a filesystem that will not let
  // us open the directory is not a reason to fail a payment run that has already
  // completed.
  try { const dfd = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dfd) } finally { fs.closeSync(dfd) } }
  catch { /* nothing more we can do here */ }
}
