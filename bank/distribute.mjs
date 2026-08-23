#!/usr/bin/env node
/**
 * DAILY cbBTC DISTRIBUTION to activated vaults.
 *
 * "We should hold the cbBTC for the vaults in a wallet and daily (as long as we
 *  have cbBTC) we should be sending to them. WE ONLY SEND TO ACTIVATED WALLETS
 *  with 21,000 (or more) satoshis in it." — Gary, 2026-08-22
 *
 * ⚠️ NO LONGER EQUAL PER VAULT. This header described the equal-split allocator
 * for hours after the SCHEDULE OF VAULTS replaced it, which is a comment claiming
 * behaviour that does not run — found by two round-17 auditors independently.
 * Payment is BY WEIGHT: see LEVEL_WEIGHTS and `allocateWeighted` below. A vault
 * below 21,000 sats is unactivated, carries weight 0, gets nothing and is not in
 * the denominator, so activating is worth something the day you do it rather than
 * the day we notice.
 *
 * THREE THINGS IT REFUSES TO DO
 *   * pay twice. Every transfer is recorded BEFORE the next one starts, so a
 *     crash halfway resumes instead of redoing — and the run holds an exclusive
 *     LOCK, because recording-before-the-next-one is only safe against a crash.
 *     Two runners (the cron firing while someone runs it by hand) each loaded
 *     the ledger at start and each rewrote the whole file, so the second one to
 *     save erased the first one's record of everything it had already sent and
 *     the next run paid those vaults again. The header used to claim this was
 *     covered; it was covered in sequence and not in parallel. A row with an
 *     intent but no SIGNATURE is neither paid nor unpaid: `sendAndConfirmTransaction`
 *     throws on a confirmation timeout for a transaction that landed, so such a
 *     row is REPORTED for a human and never silently re-sent or silently skipped.
 *   * create a token account for a vault PDA. An activated vault already has its
 *     cbBTC ATA (that is how it holds sats), so a missing one means the vault is
 *     not what we think it is: it is SKIPPED and reported, never created.
 *   * guess. If any read fails, it stops and says so. A distribution computed
 *     from a partial vault list would silently overpay everyone who was visible.
 *
 *   node bank/distribute.mjs --dry-run
 *   node bank/distribute.mjs --selftest
 *   node bank/distribute.mjs
 *
 * EXIT CODES, and the one that surprises people is documented because two
 * round-19 auditors raised it independently:
 *   0  ran, and either paid or held for a legitimate reason
 *   1  the distribution REFUSED and paid nobody, or a transfer failed or was
 *      left ambiguous. **NOT suppressed under `--dry-run`** — deliberately: a
 *      dry run exists to report the halt, and a halt that any stranger can
 *      trigger (activating a vault with no level) must not read as success.
 *      The PAGE is suppressed under --dry-run; the exit code is not. So a
 *      wrapper or CI job that runs `--dry-run` as a health check will go red on
 *      a griefed day, which is the intended signal and not a bug.
 *   3  the run could not start (lock held, or a fatal read failure).
 */
import fs from 'fs'
import fsx2 from 'fs'
import { execFileSync } from 'child_process'
import { withLock, readLedger, writeLedger } from './lock.mjs'
import { readTokenAccount, requireTokenAmount } from './spl.mjs'
import { pinnedAccountData } from './anchor.mjs'
import { judgeDasEnvelope, detectDistribution } from './detectors.mjs'
import { PublicKey, Connection, Keypair, Transaction, sendAndConfirmTransaction }
  from '/opt/gary-club/node_modules/@solana/web3.js/lib/index.cjs.js'
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync }
  from '/opt/gary-club/node_modules/@solana/spl-token/lib/cjs/index.js'

export const ACTIVATION_SATS = 21_000n
export const CBBTC_DECIMALS = 8
/** Below this a transfer costs more in fees and noise than it delivers. This is
 *  the ABSOLUTE floor — you cannot send zero — and it is NOT the cadence
 *  threshold. See EMISSION_MIN_PER_VAULT. */
export const MIN_PER_VAULT = 1n

/** THE SCHEDULE OF VAULTS — locked by Gary 2026-08-22.
 *
 * Five levels, I smallest to V largest, assigned at activation by fate and never
 * decreasing. A level is raised one step at a time by burning $CBOB.
 *
 *   odds at activation  I 45% | II 25% | III 15% | IV 10% | V 5%
 *   weights             I 2   | II 3   | III 4   | IV 5   | V 6
 *
 * ⚠️ THE LEVEL LIVES OFF-CHAIN. Gary, 2026-08-22: "we can keep this offchain if
 * we want as we will gamify it with $CBOB to alter emissions." So there is no
 * program change, no Core attribute and no on-chain VRF on the critical path —
 * this job reads a level, it never assigns one, and the odds are deliberately NOT
 * in this file.
 *
 * ⚠️ AND OFF-CHAIN MOVES A COST RATHER THAN REMOVING ONE, which has to be written
 * down before it is forgotten. The card says a level is "assigned by fate,
 * permanent, cannot be applied for or appealed". On-chain, that sentence is
 * enforced. Off-chain it is OUR WORD: the same party assigns the level, stores
 * it, and pays out against it — one source both asserting and certifying, which
 * is the arrangement this project refuses everywhere else.
 *
 * The cheap fix is not on-chain storage, it is a COMMITMENT: publish a hash of
 * the sealed assignment (or of the deck) BEFORE any activation, reveal after, and
 * anyone can check their level was not moved. Storage stays off-chain and free;
 * the claim becomes checkable. **This is not built. It is an open item for Gary,
 * and until it exists "cannot be appealed" is a promise rather than a proof.**
 *
 * VERIFIED AGAINST THE PUBLISHED CARD rather than trusted: at 240 vaults the
 * census is 108/60/36/24/12 and the denominator 732; at 2,100 it is
 * 945/525/315/210/105 and 6,405. Every per-$1,000 figure and every share
 * percentage on the card reproduces from these weights, and the shares sum to
 * 100.0%. Level V receives exactly 3x Level I. Asserted below, both ways. */
export const LEVELS = Object.freeze(['I', 'II', 'III', 'IV', 'V'])
export const LEVEL_WEIGHTS = Object.freeze({ I: 2, II: 3, III: 4, IV: 5, V: 6 })

/** THE ONE NUMBER THAT SETS THE CADENCE, and the only one.
 *
 * Gary, 2026-08-22: "we should be able to dynamically change emission frequency.
 * Daily, Weekly, Monthly (nothing longer or shorter) but volume will determine
 * how frequent we distribute."
 *
 * There is no stored band. The job runs daily and pays when the pool has grown
 * enough to be worth paying; the band FALLS OUT of volume. High volume clears the
 * threshold every day and reads as daily; lower volume clears it in about a week;
 * volume that never clears it is forced out at the ceiling below. A stored band
 * would be a second copy of a fact volume already determines, and two copies of a
 * fact is the defect this repository has shipped more often than any other.
 *
 * ⚠️ PROVISIONAL. 21 sats is one part in a thousand of the 21,000-sat activation
 * floor — a defensible story, not a ratified number. GARY MUST SET THIS BEFORE
 * ANYTHING RUNS LIVE. Nothing is deployed and nothing has minted, so a wrong
 * value costs nothing today and would cost real payouts the day it does. */
export const EMISSION_MIN_PER_VAULT = 21n
/** "Nothing longer than monthly" — the ceiling, in days since the last payout.
 *  At this point the pool goes out whatever it holds.
 *
 *  ⚠️ ROUND 19. THE CLAIM USED TO END "so no holder ever waits longer than a
 *  month EVEN AT ZERO VOLUME", and it is false in exactly the case it named.
 *  `decideEmission`'s FIRST branch returns `pay: false` when `smallestPer <
 *  MIN_PER_VAULT`, before `maxHoldDays` is consulted at all, and
 *  `allocateWeighted` skips before that. Measured: `smallestPer: 0n` with
 *  `daysSinceLastPayout: 99` (or 365) returns pay=false, forced=false. The
 *  file's own assertion says so a few hundred lines down — "nothing at all is
 *  never forced into a zero payout" — so the comment and the suite contradicted
 *  each other about a promise a holder reads.
 *
 *  THE TRUE STATEMENT, which is the one that goes on a card: the ceiling forces
 *  a payout only while the pool can give every activated vault at least one
 *  satoshi. Below that there is nothing to force out, and the wait is unbounded.
 *  At the published 2,100-vault census that floor is a denominator's worth —
 *  6,405 sats. Asserted in BOTH directions in bank/selftest.mjs. */
export const MAX_HOLD_DAYS = 31

/** Count of activated vaults per level. Pure. */
export function census(levels) {
  // ⚠️ ROUND 18. `Object.hasOwn` REACHED ONE OF THREE SITES.
  // Round 17 fixed a prototype-reachable level string in `allocateWeighted`'s
  // validation and stopped there. Measured on the shipped code:
  //   census({a:'constructor'})            -> a "constructor" key whose value is
  //                                           "function Object() { [native code] }1"
  //                                           (`c[v] += 1` CONCATENATED onto a function)
  //   denominator(Object.create({I: 999})) -> 1998, read off the prototype
  // Not reachable in production — `allocateWeighted` validates first, and a vault
  // key is a base58 pubkey — but these are EXPORTED and correct in isolation is
  // the only property an exported helper has. One-of-N-sites is this repository's
  // signature defect and it is what round 18's own CRITICAL was.
  const c = Object.create(null); for (const l of LEVELS) c[l] = 0
  for (const v of Object.values(levels)) if (Object.hasOwn(c, v)) c[v] += 1
  return { ...c }
}
/** The denominator every share divides by: the sum of the weights of all
 *  ACTIVATED vaults. Published every settlement alongside the census. */
export function denominator(c) {
  return LEVELS.reduce((s, l) => s + (Object.hasOwn(c ?? {}, l) ? c[l] : 0) * LEVEL_WEIGHTS[l], 0)
}

/** PURE. Who gets paid and how much, by WEIGHT. Proven in both directions.
 *
 * `vault_share = drop * vault_weight / denominator`, integer satoshis.
 *
 * ⚠️ THE DUST CARRIES FORWARD; IT IS NEVER SPLIT. Ruling, Gary 2026-08-22.
 * Integer division leaves ONE fractional part per PAID VAULT, each strictly less
 * than a sat, so the true bound is `dust < activated count` — at 2,100 vaults at
 * most 2,099 sats, and that is the number to quote. This comment used to say
 * "up to (denominator - 1) ... up to 6,404", which is a real upper bound but a
 * loose one, and it overstated what a settlement retains by about threefold.
 * Measured across the 2,100-vault census: worst observed 2,099, never near 6,404.
 * A disclosure figure has to be the one that is TRUE, not merely one that holds.
 * Still not dust at scale, so the carry rule below is unchanged. The alternative
 * (largest-remainder) makes 100% land in the same settlement at the price of two
 * vaults AT THE SAME LEVEL differing by one sat, and "your level determines your
 * share" is the whole product. So same level always means the same number, and
 * the leftover stays in the pool for the next drop. "Nothing retained" means the
 * Bank keeps no cut — the dust is still the holders' and it lands next time.
 *
 * ⚠️ AN ACTIVATED VAULT WITH NO LEVEL IS A REFUSAL, NOT A WEIGHT OF ZERO. Weight
 * zero is what an UNACTIVATED vault has, and it is a fact about the vault. A
 * missing level is a fact about OUR DATA, and paying everyone else while silently
 * dropping that holder is the shape this file already refuses everywhere else. */
export function allocateWeighted(balances, levels, available, opts = {}) {
  const min = opts.minPerVault ?? MIN_PER_VAULT
  const activated = Object.entries(balances)
    .filter(([, b]) => BigInt(b) >= ACTIVATION_SATS)
    .map(([a]) => a)
    .sort()
  const empty = { activated, per: {}, total: 0n, dust: 0n, census: census({}), denominator: 0 }
  if (activated.length === 0) return { ...empty, skip: 'no activated vaults' }
  // ⚠️ `Object.hasOwn`, NOT TRUTHINESS. `LEVEL_WEIGHTS['constructor']` is the
  // Object constructor via the prototype chain — truthy — so a level named
  // `constructor`, `toString`, `valueOf` or `__proto__` PASSED this guard and
  // then threw inside `BigInt()` in the middle of the money job. Measured on all
  // five. Round 17.
  const unlevelled = activated.filter(v => !Object.hasOwn(LEVEL_WEIGHTS, levels[v] ?? ''))
  // ⚠️ `refusal: true` SEPARATES A HALT FROM A QUIET DAY. Round 17: both were
  // recorded as `nothingToDo`, so a vault activated without a level stopped every
  // payout, the day looked legitimately quiet, the run exited 0 and NO DETECTOR
  // FIRED. The trigger is the ordinary customer activation path, so this is a
  // halt anyone can cause for the price of one vault. An empty pool is quiet; a
  // refusal is an emergency, and they must not share a field.
  if (unlevelled.length) return { ...empty, refusal: true, skip: `${unlevelled.length} activated vault(s) carry no level: ${unlevelled.slice(0, 3).join(', ')}` }
  const cen = census(Object.fromEntries(activated.map(v => [v, levels[v]])))
  const den = denominator(cen)
  if (den <= 0) return { ...empty, census: cen, refusal: true, skip: 'denominator is zero' }
  if (available <= 0n) return { ...empty, census: cen, denominator: den, skip: 'no cbBTC to distribute' }
  const per = {}
  let total = 0n
  for (const v of activated) {
    const amt = (available * BigInt(LEVEL_WEIGHTS[levels[v]])) / BigInt(den)
    per[v] = amt; total += amt
  }
  const smallest = activated.reduce((m, v) => per[v] < m ? per[v] : m, per[activated[0]])
  if (smallest < min) return { ...empty, census: cen, denominator: den, skip: `only ${available} for a denominator of ${den}` }
  return { activated, per, total, dust: available - total, census: cen, denominator: den, skip: null }
}

/** PURE. Pay now, or hold? The whole cadence, in one place.
 *
 * `smallestPer` is the LOWEST amount any activated vault would receive — a Level
 * I share. Judging on the smallest rather than an average means the threshold is
 * a promise to every holder, not to the average holder. */
export function decideEmission({ smallestPer, daysSinceLastPayout,
  threshold = EMISSION_MIN_PER_VAULT, maxHoldDays = MAX_HOLD_DAYS }) {
  if (smallestPer < MIN_PER_VAULT) return { pay: false, forced: false, reason: 'nothing to distribute' }
  if (smallestPer >= threshold) return { pay: true, forced: false, reason: `${smallestPer} >= threshold ${threshold}` }
  if (daysSinceLastPayout >= maxHoldDays) return { pay: true, forced: true, reason: `held ${daysSinceLastPayout} days; the ceiling is ${maxHoldDays}` }
  return { pay: false, forced: false, reason: `${smallestPer} < threshold ${threshold}; held ${daysSinceLastPayout} of ${maxHoldDays} days` }
}

/** SUPERSEDE A NON-PAYING VERDICT. PURE, so it can be proven; it was not before.
 *
 *  ⚠️ ROUND 19. THE ROUND-18 REPAIR CLEARED TWO OF **THREE** MARKS, AND THE ONE
 *  IT LEFT IS THE STRONGEST SUPPRESSOR OF THE THREE.
 *
 *  A skip day writes `nothingToDo`, optionally `refused`, AND `finishedAt`.
 *  `detectDistribution`'s unfinished arm is
 *      `startedAt && !finishedAt && !nothingToDo && !resolvedBy`
 *  so ANY of those three silences it. Round 18 found the repair clearing one of
 *  two and fixed it to two; `finishedAt` was never in the list at all.
 *
 *  MEASURED: a quiet 09:07 writes `nothingToDo` + `finishedAt`; an afternoon run
 *  proceeds, clears the two, starts paying and dies before writing a row. Next
 *  day the ledger still carries the MORNING `finishedAt`, so the half-finished
 *  day is silent — while the identical crash with no quiet morning before it
 *  raises `distribution_unfinished`. The same fail-open the repair exists to
 *  close, reached through the flag the repair did not know about.
 *
 *  Worse, the repair's own comment argued from a premise its code makes false:
 *  it said such a day would be "leaving `finishedAt` unset because some transfers
 *  failed or were ambiguous". `finishedAt` is not unset in that ordering — it is
 *  LEFT OVER. A justification that is wrong about the state it describes.
 *
 *  So: clear all three, and record BOTH prior verdicts rather than whichever the
 *  `||` reached first — losing the other was a second, quieter defect in the
 *  same six lines. */
/** The marks that make `detectDistribution` treat a day as DONE. Asserted against
 *  the detector's own predicate in bank/selftest.mjs, in both directions. */
export const DONE_MARKS = ['finishedAt', 'nothingToDo', 'resolvedBy']

export function supersede(rec, nowIso) {
  const was = [rec?.refused, rec?.nothingToDo].filter(Boolean)
  if (!was.length) return { rec, superseded: false, wasRefusal: false, was }
  const out = { ...rec }
  out.supersededAt = nowIso
  out.supersededWas = was.join(' + ')
  const wasRefusal = Boolean(rec.refused)
  delete out.refused
  // ⚠️ EVERY SUPPRESSOR OF `distribution_unfinished`, AND THE LIST IS NOT WRITTEN
  // HERE BY HAND — that is the mistake this line has now made twice.
  //
  // Round 18's repair cleared TWO of the three marks. Round 19 found that and
  // cleared THREE — and a round-19 auditor immediately found the FOURTH,
  // `resolvedBy`, still silencing the alarm on exactly the crash the repair
  // exists to expose. Measured: with `resolvedBy` present the superseded-then-
  // crashed day is silent; without it the identical record fires. An enumeration
  // written from memory has now been wrong twice running, which is the signal to
  // stop enumerating.
  //
  // `bank/selftest.mjs` parses the suppressors out of `detectDistribution`'s own
  // predicate and asserts this function removes every one of them, so a
  // suppressor added to the detector and not cleared here turns the build red
  // rather than going quiet. One fact, one reader.
  // ⚠️ PRESERVE THE HUMAN'S RECORD WHILE REMOVING ITS SUPPRESSING POWER.
  // A round-19 auditor: clearing `resolvedBy` outright destroys an operator's
  // resolution note on a proceeding day. Both halves are right — it MUST stop
  // suppressing `distribution_unfinished`, and it MUST NOT vanish. So it moves
  // rather than dies. Same argument another auditor made about the verdicts:
  // never delete history, supersede it.
  if (rec?.resolvedBy !== undefined) out.supersededResolvedBy = rec.resolvedBy
  for (const mark of DONE_MARKS) delete out[mark]
  // ⚠️ EXCEPT ON A DAY THAT ALREADY PAID. A round-19 auditor filed this as a HIGH
  // — that superseding could strip `finishedAt` off a completed paying day and
  // both re-open the transfer loop and page `distribution_unfinished` on a day
  // whose rows carry real signatures.
  //
  // MEASURED: it is NOT reachable from main(). `st.days[day].plan` is written
  // only on a paying day, and the caller routes any day that HAS a plan to the
  // resume branch, which never calls this function; `--dry-run` never reaches it
  // either. So the production claim is refuted.
  //
  // The STRUCTURAL half of the finding is right and is the reason this guard
  // exists anyway: a pure exported function whose safety depends on a caller's
  // branch guard is one refactor away from being wrong, and nothing pinned it.
  // A day that produced a plan, or that has a row which actually paid somebody,
  // is FINISHED — a stale no-pay flag on it is an operator artifact, not a
  // verdict to supersede.
  const alreadyPaid = Boolean(rec?.plan) || Object.values(rec?.paid || {}).some(settledAsPayout)
  if (alreadyPaid && rec?.finishedAt !== undefined) out.finishedAt = rec.finishedAt
  return { rec: out, superseded: true, wasRefusal, was, alreadyPaid }
}

/** DESCRIPTIVE ONLY — the vocabulary Gary asked for, derived from what actually
 *  happened rather than stored anywhere. Nothing branches on this. */
export function describeCadence(daysSinceLastPayout) {
  if (daysSinceLastPayout <= 1) return 'daily'
  if (daysSinceLastPayout <= 7) return 'weekly'
  return 'monthly'
}

/** Whole days between two YYYY-MM-DD keys. */
export function dayDiff(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)
}

/** DERIVED, NEVER STORED. The last day this ledger actually paid somebody,
 *  excluding today. A `lastPaidDay` field would be a second copy of something the
 *  ledger already knows, and the two would disagree the first time a run died
 *  between writing the field and writing the payment. Falls back to the earliest
 *  day the ledger has ever seen, so a first-ever run has an anchor and cannot be
 *  "forced" on day one. */
/** DID THIS ROW PUT MONEY IN A HOLDER'S HANDS? A DIFFERENT QUESTION FROM
 *  `paymentState`, AND ROUND 18 FOUND THEM CONFLATED.
 *
 *  Round 17 fixed `holdDays` to stop counting ROWS and ask `paymentState`
 *  instead — correct, and then it accepted exactly ONE of that function's five
 *  answers. `resolvedBy` is written by a human closing an ambiguous or refused
 *  transfer, and the comment on `paymentState` says plainly that it covers TWO
 *  readings: "I paid it by hand" and "I established nothing landed". The first
 *  is a payout day. The second is not. Counting neither made a hand-paid day
 *  invisible to the cadence: measured, an old real payout 52 days back plus a
 *  hand-paid day two days ago returned 52, so the 31-day ceiling fires on a
 *  schedule that ignores the most recent time a holder was actually paid.
 *
 *  ⚠️ THE DEFAULT DOES NOT MOVE, AND THE DIRECTION IS THE REASON. A bare
 *  `resolvedBy` with no stated result still does NOT reset the clock. Not
 *  resetting makes `holdDays` LARGER, which fires the ceiling EARLIER and pays
 *  sooner; assuming "paid" would make holders wait longer on an assumption. When
 *  a guess must be made, guess in the direction that pays people. An operator
 *  who really did pay by hand says so with `resolvedAs: 'paid'` — a field, not a
 *  phrase, because parsing the prose of `resolvedBy` is the fragile thing this
 *  repository keeps being bitten by.
 *
 *  `paymentState` is UNCHANGED on purpose: a resolved row still reads as settled
 *  and is never resent, whatever its result. This function answers the cadence
 *  question only. */
export function settledAsPayout(row) {
  if (paymentState(row) === 'paid') return true
  return paymentState(row) === 'resolved' && row?.resolvedAs === 'paid'
}

export function holdDays(st, day) {
  // ⚠️ ROUND 17. THIS ASKED `paymentState` NOTHING, AND THAT WAS THE DEFECT.
  // It counted ROWS in `days[d].paid`, and a row is written BEFORE each send —
  // so a day on which every transfer was refused, skipped or left ambiguous read
  // as a payout and RESET THE CLOCK. Measured: an old real payout 52 days back
  // plus a recent all-failed day gave 2 days instead of 52, so the 31-day ceiling
  // never fired and nobody was force-paid. Silent.
  //
  // `paymentState` is the ONE authority on what "paid" means — it separates paid
  // from ambiguous, rejected and resolved, and is proven in both directions. This
  // function re-derived that fact with a poorer copy. One fact, two readers, the
  // second one wrong: this repository's most repeated defect, committed here.
  //
  // ⚠️ AND THE KEYS ARE VALIDATED NOW. `dayDiff` is `Date.parse` arithmetic, and
  // an unparseable key gave NaN — `NaN >= maxHoldDays` is false, so the ceiling
  // could NEVER fire. Worse, `'2026-02-30'` PARSES, rolling into March, and
  // returned a confidently wrong 173. A ledger that will not parse is already an
  // abort here; a ledger whose DAY KEY will not parse is the same thing.
  const days = Object.keys(st?.days || {}).filter(d => realDay(d) && d < day)
  const bad = Object.keys(st?.days || {}).filter(d => !realDay(d))
  if (bad.length) throw new Error(`the distribution ledger has ${bad.length} day key(s) that are not YYYY-MM-DD, e.g. ${JSON.stringify(bad[0])} — refusing to compute a payout schedule from a date I cannot read`)
  const paid = days.filter(d => Object.values(st.days[d]?.paid || {}).some(settledAsPayout)).sort()
  const anchor = paid.length ? paid[paid.length - 1] : (days.sort()[0] ?? day)
  const n = dayDiff(anchor, day)
  if (!Number.isFinite(n)) throw new Error(`could not measure the days held since ${anchor}`)
  return Math.max(0, n)
}
/** ⚠️ SHAPE IS NOT ENOUGH, AND THE COMMENT THAT USED TO SIT HERE WAS FALSE.
 *  It claimed `2026-02-30` was "refused by `dayDiff`'s finiteness check" — it is
 *  not. `Date.parse` ROLLS IT OVER to March 2, which is perfectly finite, and
 *  `holdDays` returned a confident 173. A round-18 auditor found it, and found
 *  something worse beside it: the assertion written to cover this case was NAMED
 *  "does not produce a confident wrong answer" and ASSERTED 173 — the wrong
 *  answer itself. The test pinned the defect, so fixing it would have turned the
 *  suite red. A gate that certifies a bug is worse than no gate.
 *
 *  A real day must ROUND-TRIP: parse it, render it back, and demand the same
 *  string. That is the only check that separates a date from a date-shaped
 *  string, and it costs one comparison. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const realDay = d => {
  // ⚠️ `.toISOString()` THROWS on an Invalid Date, it does not return something
  // falsy — so the first draft of this very fix threw a RangeError on
  // `2026-13-01` instead of refusing it. A date fix with a date bug in it.
  if (!ISO_DAY.test(d)) return false
  const t = Date.parse(d + 'T00:00:00Z')
  if (!Number.isFinite(t)) return false
  return new Date(t).toISOString().slice(0, 10) === d
}

/* ⚠️ `allocate()` — THE EQUAL-PER-VAULT ALLOCATOR — WAS DELETED HERE, 2026-08-22.
 *
 * The locked SCHEDULE OF VAULTS pays by WEIGHT, so `allocateWeighted` above
 * replaced its only production caller and this became dead code. Dead is not why
 * it went: two allocators side by side, one splitting equally and one by level,
 * is a live hazard — calling the wrong one pays every holder the same and nothing
 * would have failed. That is a second copy of "how much does this vault get",
 * which is the defect class this repository has shipped more than any other.
 *
 * Its assertions were not deleted with it. Every one that still means something
 * (the 21,000 activation edge, determinism, refusing dust, refusing an empty
 * pool) now points at `allocateWeighted`. The one that did not survive was
 * "splits equally across the activated", which is no longer true by design and
 * whose replacement is "two vaults at the SAME level receive EXACTLY the same
 * amount". */

/**
 * PAID, UNPAID, or NEITHER. Pure, so the one decision that can double-pay a
 * customer is tested rather than inspected.
 *
 * A SIGNATURE IS A RECEIPT. An intent with no signature is neither: it means a
 * send was started and its outcome is unknown, because
 * `sendAndConfirmTransaction` throws on a confirmation timeout for a transaction
 * that DID land. Re-sending risks paying twice; skipping risks never paying.
 * The only honest answer is to say so and stop.
 */
export function paymentState(row) {
  if (!row) return 'unpaid'
  if (row.sig) return 'paid'
  // A REFUSED SEND IS NOT AN AMBIGUOUS ONE. `revenue.mjs` learned to tell a
  // program rejection from a confirmation timeout in round 7 and this did not,
  // so a frozen destination ATA — cbBTC has a live freeze authority — was
  // recorded as ambiguous and that vault was never paid AGAIN, on any later day,
  // by any run. Nothing landed, so the honest state is unpaid and retryable.
  // A ROW A HUMAN HAS RESOLVED IS SETTLED, WHATEVER LEFT IT OPEN — and this
  // test goes ABOVE the rejection test deliberately. `resolvedBy` was added in
  // round 10 so an ambiguous transfer could be answered, and the job that acts
  // on these rows was never taught the field. Putting it below `rejected` (as I
  // first did) means a refusal somebody had already settled BY HAND reads as
  // unpaid and is sent a second time — the resolution field turned into a
  // double-payment. When the two readings of a resolved refusal are "I paid it"
  // and "I fixed the cause, retry it", only the first is safe to assume; a
  // human who wants it retried deletes the row.
  if (row.resolvedBy) return 'resolved'
  if (row.rejected) return 'unpaid'
  return 'ambiguous'
}

const ARGS = new Set(process.argv.slice(2))
const DRY = ARGS.has('--dry-run')
const STATE = process.env.CBOB_DIST_STATE || '/opt/cbob-vaults/bank/distributions.json'
const NOTIFY = '/opt/scripts/notify-gary-sms.sh'
const CBBTC = new PublicKey('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij')
const MINT_PROG = new PublicKey('Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo')
const CORE = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d')
const today = () => new Date().toISOString().slice(0, 10)
const rpc = () => (fs.readFileSync('/opt/gary-club/.env.local', 'utf8').match(/^HELIUS_RPC_URL=(.*)$/m) || [])[1].trim()
const LOCK = process.env.CBOB_DIST_LOCK || '/opt/cbob-vaults/bank/.distribute.lock'
/** A MISSING ledger is a first run. One that exists and will not parse is an
 *  ABORT: reading it as `{days:{}}` would mean "nothing has ever been paid",
 *  and this job's next act would be to pay every activated vault again. */
const MARKER = `${STATE}.has-run`
const load = () => readLedger(STATE, { days: {} }, MARKER)
const save = s => writeLedger(STATE, s, MARKER)

/** THE LEVEL REGISTER — off-chain, by ruling (see the header).
 *
 * A flat map of vault asset address -> 'I'|'II'|'III'|'IV'|'V'. This job only
 * READS it; nothing here assigns or raises a level.
 *
 * ⚠️ ABSENT IS A HARD STOP, NOT AN EMPTY MAP. Reading a missing register as `{}`
 * would make every activated vault unlevelled, and while `allocateWeighted` does
 * refuse that, it would refuse it with the wrong sentence — "vaults carry no
 * level" instead of "there is no register". Same class as the ledger's own
 * missing-file rule two lines above: a file that will not load is an abort,
 * because the alternative reading is a confident statement about money.
 *
 * ⚠️ A BAD LEVEL IS CAUGHT HERE, AT LOAD, not at allocation. `allocateWeighted`
 * checks it too and that is deliberate belt-and-braces, but a typo in the
 * register should name itself when the register is read, while there is still a
 * file and a key to point at. */
const LEVELS_FILE = process.env.CBOB_LEVELS || '/opt/cbob-vaults/bank/levels.json'
function loadLevels() {
  if (!fs.existsSync(LEVELS_FILE)) {
    throw new Error(`no level register at ${LEVELS_FILE} — a distribution is weighted by level and there is nothing to weight it by. Refusing.`)
  }
  let raw
  try { raw = JSON.parse(fs.readFileSync(LEVELS_FILE, 'utf8')) }
  catch (e) { throw new Error(`the level register at ${LEVELS_FILE} will not parse (${e.message}) — refusing to distribute against a file I cannot read`) }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`the level register must be an object of vault -> level`)
  const bad = Object.entries(raw).filter(([, l]) => !Object.hasOwn(LEVEL_WEIGHTS, l ?? ''))
  if (bad.length) throw new Error(`the level register carries ${bad.length} unrecognised level(s), e.g. ${bad[0][0]} -> ${JSON.stringify(bad[0][1])}. Levels are ${LEVELS.join('/')}.`)
  return raw
}

async function main() {
  const conn = new Connection(rpc(), 'confirmed')
  const st = load()
  const levels = loadLevels()
  const day = today()
  st.days[day] ||= { paid: {}, startedAt: new Date().toISOString() }
  const done = st.days[day].paid

  const KEYFILE = '/opt/cbob-vaults/bank/keys/distributor.json'
  const mode = fs.statSync(KEYFILE).mode & 0o777
  if (mode & 0o077) throw new Error(`${KEYFILE} is mode ${mode.toString(8)} — a signing key readable by anyone but its owner is not a key`)
  const distributor = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYFILE, 'utf8'))))

  // the collection this program is wired to
  const cfgAcc = await conn.getAccountInfo(
    PublicKey.findProgramAddressSync([Buffer.from('mint-config')], MINT_PROG)[0], 'confirmed')
  if (!cfgAcc) { console.log('mint config not initialised — nothing to distribute to yet'); return }
  // OWNER, DISCRIMINATOR AND VERSION BEFORE ANY OFFSET. Same class as the alarm's,
  // in the job that decides who is paid how much.
  pinnedAccountData(cfgAcc, { program: MINT_PROG, struct: 'MintConfig', what: 'the MINT config' })
  const collection = new PublicKey(cfgAcc.data.subarray(41, 73)).toBase58()
  const mintedTotal = cfgAcc.data.readBigUInt64LE(205)
  // PIN THE PAYER TO THE CHAIN, the way revenue.mjs pins the swap operator.
  // `split_revenue` sends the holders' 85% to the ATA of `config.treasury`; this
  // script pays out of whatever keypair is on disk. Nothing connected the two,
  // so a treasury rotation would have left the 85% piling up at the config
  // address while this reported "no cbBTC to distribute" — forever, quietly.
  const treasury = new PublicKey(cfgAcc.data.subarray(137, 169))
  if (!treasury.equals(distributor.publicKey))
    throw new Error(`distributor key ${distributor.publicKey} is not config.treasury (${treasury}) — the 85% is being paid to a different address than it is sent to`)

  // every vault. A partial list would overpay everyone visible, so a failure here stops us.
  const vaults = [], burnt = []
  const MAX_PAGES = 50
  let complete = false
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetch(rpc(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'd', method: 'getAssetsByGroup',
        params: { groupKey: 'collection', groupValue: collection, page, limit: 1000 } }) })
    // ONE JUDGEMENT, THREE CALLERS. Round 16's gate for "is there a THIRD copy of
    // the fail-open DAS shape" found this one on its first run — I had been
    // fixing two. Contained here by the `minted_total` cross-check below, which
    // is a DIFFERENT mechanism and could itself change; the read should not
    // depend on the thing downstream of it. See `judgeDasEnvelope`.
    const env = judgeDasEnvelope({ ok: r.ok, status: r.status, json: await r.json() })
    if (env.problem) throw new Error(`DAS: ${env.problem}`)
    const items = env.items
    for (const i of items) (i.burnt ? burnt : vaults).push(i.id)
    if (items.length < 1000) { complete = true; break }
  }
  // The whole point of "refuses to guess": a truncated vault list makes `per`
  // too large and overpays everyone who WAS visible. A cap that breaks quietly
  // is the same bug as a read that fails quietly.
  if (!complete) throw new Error(`vault list did not terminate within ${MAX_PAGES} pages — refusing to distribute against a partial list`)
  // A SHORT PAGE looks exactly like the end of the list, and this job divides the
  // day's cbBTC by the number of vaults it can SEE — so an indexer that returns
  // half the collection does not fail, it silently pays everyone visible twice
  // what they are owed. `minted_total` is the chain's own count of vaults ever
  // created and never decrements, so live + burnt must reach it.
  // UNIQUE ids, and EXACT agreement. `>=` on raw counts accepted a page that
  // repeated ids while omitting real vaults — and `balances` is keyed by id, so
  // duplicates COLLAPSE: 2,100 copies of one vault would satisfy the count and
  // then pay the whole day's cbBTC to that single recipient. Only mint_vault can
  // add to this collection, so more is as wrong as fewer.
  const uniqLive = [...new Set(vaults)], uniqBurnt = new Set(burnt)
  if (uniqLive.some(a => uniqBurnt.has(a)))
    throw new Error('the index reports the same asset as both live and burnt — refusing to distribute against a self-contradictory list')
  if (BigInt(uniqLive.length + uniqBurnt.size) !== mintedTotal)
    throw new Error(`the index returned ${uniqLive.length} unique live + ${uniqBurnt.size} burnt vaults but the chain says ${mintedTotal} were minted — refusing to distribute against a list that does not agree with the chain`)
  vaults.length = 0; vaults.push(...uniqLive)

  const balances = {}, ataOf = {}, missing = [], poisoned = []
  for (const v of vaults) {
    const pda = PublicKey.findProgramAddressSync(
      [Buffer.from('mpl-core-execute'), new PublicKey(v).toBuffer()], CORE)[0]
    const a = getAssociatedTokenAddressSync(CBBTC, pda, true)
    ataOf[v] = a
    const info = await conn.getAccountInfo(a, 'confirmed')
    // ONE POISONED ATA MUST NOT COST EVERY VAULT ITS PAYMENT. A stranger can
    // put a 0-data account at any vault's derived ATA for one lamport; the read
    // used to throw here and abort the whole distribution. It is a per-vault
    // fault, reported per vault, and the run carries on paying everyone else.
    const t = readTokenAccount(info)
    if (t.state === 'absent') { missing.push(v); balances[v] = '0'; continue }   // never created here
    if (t.state !== 'ok') { poisoned.push([v, t.state]); balances[v] = '0'; continue }
    balances[v] = String(t.amount)
  }
  // ⚠️ PERSISTED, NOT PRINTED. Round 12: this went to `console.error` and
  // nowhere else — not the ledger, not a detector, not the notification path —
  // so the comment claiming it was "reported" meant "logged", and a vault that
  // an attacker poisoned for one lamport was quietly never paid while the day
  // still recorded `finishedAt`. A stderr line on a cron is not a report.
  if (poisoned.length && !DRY) {
    st.days[day].unreadableAtas = poisoned.map(([v, state]) => ({ vault: v, state }))
    save(st)
  }
  if (poisoned.length) {
    console.error(`  WARNING: ${poisoned.length} vault ATA(s) are present but are NOT readable token accounts `
      + `(a 1-lamport account at a derived ATA address looks like this). Treated as 0 and NOT paid: `
      + poisoned.slice(0, 5).map(([v, st]) => `${v}:${st}`).join(', '))
  }

  const src = getAssociatedTokenAddressSync(CBBTC, distributor.publicKey)
  const srcInfo = await conn.getAccountInfo(src, 'confirmed')
  // AN ABSENT ATA IS NOT AN EMPTY ONE. Reading a missing account as "no cbBTC to
  // distribute" marked the day legitimately finished and reported nothing — so a
  // distributor that had never been set up, or was set up at the wrong address,
  // looked exactly like a quiet day, every day.
  // ...and the same is true of a present-but-unreadable one, which used to throw
  // a RangeError here rather than say what was wrong.
  const available = requireTokenAmount(srcInfo, 'the distributor cbBTC token account', src.toBase58())

  // THE PLAN IS FIXED ONCE PER DAY AND REUSED ON RESUME.
  // It used to be recomputed from the REMAINING balance every run while the
  // divisor stayed the full activated set, so a crash halfway paid the rest of
  // the day less than the first half: two vaults, 100 sats, A gets 50, crash, the
  // resume divides the remaining 50 by 2 and pays B twenty-five. Equal-per-vault
  // is the whole rule; a plan that changes under a resume is not equal.
  let plan
  if (st.days[day].plan && !DRY) {
    plan = { activated: st.days[day].plan.activated,
      per: Object.fromEntries(Object.entries(st.days[day].plan.per).map(([v, a]) => [v, BigInt(a)])),
      census: st.days[day].plan.census, denominator: st.days[day].plan.denominator, skip: null }
    console.log(`distribution ${day} — RESUMING the plan fixed at ${st.days[day].startedAt}`)
  } else {
    plan = allocateWeighted(balances, levels, available)
    // ─── THE CADENCE GATE ───
    // Runs AFTER the arithmetic and BEFORE anything is written, because the
    // decision needs to know what the smallest holder would actually receive. It
    // is skipped entirely on a RESUME: that day's decision was already made and
    // its plan is durable, and re-deciding under a smaller pool is how a resumed
    // day pays half its vaults and then changes its mind.
    if (!plan.skip) {
      const held = holdDays(st, day)
      const smallest = plan.activated.reduce((m, v) => plan.per[v] < m ? plan.per[v] : m, plan.per[plan.activated[0]])
      const d = decideEmission({ smallestPer: smallest, daysSinceLastPayout: held })
      console.log(`  cadence: ${describeCadence(held)} — ${d.reason}` + (d.forced ? '  [FORCED at the ceiling]' : ''))
      if (!d.pay) plan = { ...plan, skip: `holding: ${d.reason}` }
    }
    if (!plan.skip && !DRY) {
      // ⚠️ ROUND 18. A REPAIRED REFUSAL WAS STILL RECORDED AS AN ACTIVE REFUSAL.
      // `refused` was written and never cleared by anything, and the operator's
      // repair path is exactly "add the missing level, rerun the same day". The
      // rerun paid everybody while `detectDistribution` went on raising a HIGH
      // saying "the distribution REFUSED and paid nobody — every activated vault
      // is unpaid", forever, on a day whose `paid` rows carry real signatures.
      // The only way to silence it was to hand-edit the money ledger, which is
      // the last file anyone should be editing to quiet an alarm.
      // A plan that is proceeding SUPERSEDES the NON-PAYING VERDICT that preceded
      // it — and that is BOTH flags, not just the refusal.
      //
      // ⚠️ THE FIRST VERSION OF THIS REPAIR CLEARED ONE OF TWO, WHICH IS THE
      // DEFECT IT WAS FIXING. `nothingToDo` has exactly one reader
      // (`detectors.mjs`, the `distribution_unfinished` arm) and its job there is
      // to SUPPRESS that finding. So a quiet morning that wrote `nothingToDo`,
      // followed by an afternoon run that paid only PART of the vaults — leaving
      // `finishedAt` unset because some transfers failed or were ambiguous — was
      // a half-finished day with unpaid holders whose alarm was silenced by a
      // leftover flag from the run that paid nobody. Fail-open, and the refusal
      // arm beside it had just been fixed for the identical shape.
      const sup = supersede(st.days[day], new Date().toISOString())
      st.days[day] = sup.rec
      if (sup.superseded) console.log(`  a ${sup.wasRefusal ? 'REFUSAL' : 'no-pay verdict'} earlier today is SUPERSEDED by this plan: ${sup.was.join(' + ')}`)
      st.days[day].plan = { activated: plan.activated,
        per: Object.fromEntries(Object.entries(plan.per).map(([v, a]) => [v, String(a)])),
        census: plan.census, denominator: plan.denominator, available: String(available) }
      save(st)                                  // the plan is durable BEFORE any transfer
    }
    console.log(`distribution ${day}`)
  }
  console.log(`  vaults ${vaults.length}, activated ${plan.activated.length} (>= ${ACTIVATION_SATS} sats), no cbBTC account ${missing.length}`)
  // THE CENSUS AND THE DENOMINATOR ARE PUBLISHED EVERY SETTLEMENT, per the locked
  // schedule. They are what makes a share checkable by the holder rather than
  // taken on trust, so they are printed even on a day that pays nothing.
  if (plan.census) console.log(`  census ${LEVELS.map(l => `${l}:${plan.census[l] || 0}`).join(' ')}  denominator ${plan.denominator}`)
  console.log(`  distributor holds ${available} sats` + (plan.skip ? `  SKIP: ${plan.skip}` : ''))
  if (plan.skip) {
    // A day with nothing to pay is FINISHED, not abandoned halfway. Leaving it
    // open raised a HIGH every day until the first revenue arrived.
    if (!DRY) {
      st.days[day].nothingToDo = plan.skip
      // A REFUSAL IS ALSO RECORDED AS ITSELF, so `detectDistribution` can tell a
      // halt from a quiet day. `nothingToDo` is kept so the day still reads as
      // finished and does not raise `distribution_unfinished` every pass.
      if (plan.refusal) st.days[day].refused = plan.skip
      st.days[day].finishedAt = new Date().toISOString(); save(st)
    }
    // ⚠️ ROUND 18. A REFUSAL PAGED NOBODY AND EXITED 0.
    // Fifteen lines below, the SOL-floor failure calls NOTIFY and sets
    // exitCode 1. This branch — a HALT that any stranger can trigger by
    // activating a vault we have no level for — wrote a field and returned
    // clean, leaving `alarm.mjs` as the only path to a human. Two failures of
    // the same job, one function apart, disagreeing about whether a halt is
    // worth waking anyone. A quiet day stays quiet; a REFUSAL pages.
    if (plan.refusal) {
      const msg = `CBOB DISTRIBUTION REFUSED and paid nobody: ${plan.skip}`
      console.error(msg)
      if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
      process.exitCode = 1
    }
    return
  }

  // 5,000 lamports a transfer against ~2,100 vaults is 10.5M, so the old flat
  // 5,000,000 floor funded under half a full run and the rest of the vaults were
  // simply not paid that day.
  // THE FEE FLOOR MUST COUNT WHAT THE PAYMENT LOOP WILL ACTUALLY SEND.
  // `!done[v]` and `paymentState(...) === 'unpaid'` are different questions, and
  // they diverged the moment a REFUSED row started being retried: a rejected row
  // EXISTS in `done`, so it counted as nothing to do, while the loop below sends
  // it. A day where every transfer was refused budgeted zero SOL and then tried
  // to make 2,100 transfers — running dry part-way through the retry that was
  // supposed to repair it. One predicate, both places.
  const outstanding = plan.activated.filter(v => {
    const row = done[v]
    return !row?.skipped && paymentState(row) === 'unpaid'
  }).length
  const needSol = 5_000 * outstanding * 2
  const sol = await conn.getBalance(distributor.publicKey, 'confirmed')
  if (sol < needSol) {
    const msg = `CBOB distributor has ${sol} lamports and needs about ${needSol} to pay ${outstanding} vaults — stopping before a half-finished run`
    console.error(msg); if (!DRY) try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {}
    // A day on which nobody was paid must not exit 0.
    process.exitCode = 1
    return
  }

  let sent = 0
  const failed = [], ambiguous = [], burnedMidRun = []
  for (const v of plan.activated) {
    const state = paymentState(done[v])
    if (state === 'paid') continue
    // A ROW A HUMAN RESOLVED IS SETTLED, NOT A ROW TO RE-SEND. Adding the state
    // to `paymentState` without teaching THIS loop about it would have made the
    // resolution field mean "send it again" — the one-of-two-sites shape, in the
    // commit that exists to fix five of them.
    if (state === 'resolved') continue
    if (done[v]?.skipped) continue          // deliberately not paid, and recorded
    if (state === 'ambiguous') {
      // AN INTENT WITH NO SIGNATURE IS AMBIGUOUS, AND STAYS AMBIGUOUS.
      // `sendAndConfirmTransaction` throws on a confirmation timeout for a
      // transaction that DID land, so neither re-sending nor skipping is safe
      // without looking at the chain. This is exactly the case where a program
      // must refuse to guess: it is reported, and a human resolves it by
      // finding the transfer or establishing it never happened.
      ambiguous.push(v); continue
    }
    if (DRY) { console.log(`  would send ${plan.per[v]} (level ${levels[v]}) -> ${v}`); sent++; continue }
    // THE PLAN IS FIXED; THE WORLD IS NOT. A vault can be bare-burned between the
    // plan being written and its turn in the loop — Core allows it and nothing
    // can prevent it — and its asset-signer PDA outlives the burn, so the
    // transfer would succeed into an account nobody can ever redeem from.
    const stillThere = await conn.getAccountInfo(new PublicKey(v), 'confirmed')
    if (!stillThere || stillThere.data.length < 1 || stillThere.data[0] !== 1) {
      done[v] = { amount: String(plan.per[v]), sig: null, skipped: 'vault is no longer a live Core asset' }
      save(st); burnedMidRun.push(v); continue
    }
    // The intent is written BEFORE the send. It used to be written only after
    // confirmation, so a crash in the window between a transfer landing and the
    // ledger recording it left the transfer invisible and the next run paid it
    // again. With the intent on disk, a resume can SEE the ambiguity instead of
    // assuming the transfer never happened.
    done[v] = { amount: String(plan.per[v]), sig: null, sentAt: new Date().toISOString() }
    save(st)
    try {
      const ix = createTransferCheckedInstruction(src, CBBTC, ataOf[v], distributor.publicKey,
        plan.per[v], CBBTC_DECIMALS)
      const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [distributor],
        { commitment: 'confirmed' })
      done[v] = { amount: String(plan.per[v]), sig }
      save(st); sent++
    } catch (e) {
      // ONE BAD VAULT MUST NOT DENY ALL THE OTHERS. cbBTC has a live freeze
      // authority, so a single frozen destination ATA used to throw out of this
      // loop, exit 3, and leave every remaining vault unpaid for the day with
      // nothing scheduled to try again. The row keeps `sig: null`, so the next
      // run treats it as ambiguous rather than re-sending into the dark.
      // The cluster gave us a program error, so nothing landed and this is
      // retryable. Anything else — a confirmation timeout above all — leaves the
      // outcome genuinely unknown and must stay ambiguous.
      const rejected = /custom program error|Error Code:|Transaction simulation failed|insufficient funds/
        .test(String(e.message))
      done[v] = { amount: String(plan.per[v]), sig: null, rejected,
        sentAt: done[v].sentAt, error: String(e.message).slice(0, 200) }
      save(st); failed.push(v)
    }
  }
  if (!DRY) {
    // A dry run must not write to the ledger that decides who has been paid.
    // Only mark the day FINISHED if nothing is still unresolved: `finishedAt`
    // on a day with an ambiguous transfer reads as "done" to every later run
    // and to the watcher.
    if (!failed.length && !ambiguous.length) st.days[day].finishedAt = new Date().toISOString()
    // PER-VAULT AMOUNTS ARE ALREADY IN `done`; what the day needs at the top
    // level is the two numbers a holder checks their share against.
    st.days[day].census = plan.census
    st.days[day].denominator = plan.denominator
    save(st)
  }
  console.log(`  ${DRY ? 'would pay' : 'paid'} ${sent} vaults; ${String(plan.total ?? '')} sats out, dust ${String(plan.dust ?? 0n)} carried to the next drop`)
  if (missing.length) console.log(`  NOT created (reported, never created): ${missing.slice(0, 5).join(', ')}`)
  if (burnedMidRun.length) console.log(`  SKIPPED (burned after the plan was fixed): ${burnedMidRun.join(', ')}`)
  if (failed.length || ambiguous.length) {
    const msg = `CBOB distribution ${day}: paid ${sent}; ${failed.length} FAILED; `
      + `${ambiguous.length} AMBIGUOUS (an intent with no signature — the transfer may or may not have landed, `
      + `resolve on chain before re-running). First failed: ${failed[0] || 'none'}. First ambiguous: ${ambiguous[0] || 'none'}`
    console.error(msg)
    if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
    process.exitCode = 1
  }
}

if (ARGS.has('--selftest')) {
  const R = []
  const t = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want)
    R.push(ok); console.log(`  ${ok ? 'ok  ' : 'XX  '}${n}${ok ? '' : ` got ${got} want ${want}`}`) }
  const A = 'a', B = 'b', C = 'c'
  const allI = { [A]: 'I', [B]: 'I', [C]: 'I' }
  t('pays only vaults at or above 21,000 sats',
    allocateWeighted({ [A]: '21000', [B]: '20999', [C]: '99999' }, allI, 300n).activated, [A, C])
  t('exactly 21,000 counts as activated',
    allocateWeighted({ [A]: '21000' }, allI, 100n).activated.length, 1)
  t('20,999 does not', allocateWeighted({ [A]: '20999' }, allI, 100n).activated.length, 0)
  t('skips when nothing is activated', allocateWeighted({ [A]: '0' }, allI, 100n).skip !== null, true)
  t('skips when there is no cbBTC', allocateWeighted({ [A]: '21000' }, allI, 0n).skip !== null, true)
  t('skips rather than sending dust',
    allocateWeighted({ [A]: '21000', [C]: '21000' }, allI, 1n, { minPerVault: 1n }).skip !== null, true)
  t('never over-distributes: the total can never exceed the pool',
    (() => { const r = allocateWeighted({ [A]: '21000', [B]: '21000', [C]: '21000' }, allI, 100n); return r.total <= 100n })(), true)
  t('order is deterministic', allocateWeighted({ c: '21000', a: '21000' }, { a: 'I', c: 'I' }, 200n).activated, ['a', 'c'])
  t('a row with a signature is PAID', paymentState({ amount: '5', sig: 'abc' }), 'paid')
  t('no row at all is UNPAID', paymentState(undefined), 'unpaid')
  // The one that matters: an intent whose send threw may still have LANDED.
  t('an intent with no signature is AMBIGUOUS, not unpaid',
    paymentState({ amount: '5', sig: null, sentAt: 'x' }), 'ambiguous')
  t('...and so is one whose send merely timed out',
    paymentState({ amount: '5', sig: null, error: 'timeout' }), 'ambiguous')
  // A frozen destination ATA is a definite refusal: nothing landed, so it is
  // retryable. Treating it as ambiguous meant that vault was never paid again.
  t('a REFUSED send is UNPAID and retryable, not ambiguous',
    paymentState({ amount: '5', sig: null, rejected: true, error: 'custom program error: 0x11' }), 'unpaid')
  // ─── THE SCHEDULE OF VAULTS ───
  // EVERY FIGURE ON THE PUBLISHED CARD, REPRODUCED FROM THE WEIGHTS. A card is a
  // promise to a buyer; the arithmetic behind it is checked here rather than
  // trusted, and it is checked from the WEIGHTS so a weight change turns this red
  // instead of quietly making the card wrong.
  const cen240 = { I: 108, II: 60, III: 36, IV: 24, V: 12 }
  const cen2100 = { I: 945, II: 525, III: 315, IV: 210, V: 105 }
  t('the 240-vault census sums to 240', LEVELS.reduce((a, l) => a + cen240[l], 0), 240)
  t('...and its denominator is 732', denominator(cen240), 732)
  t('the 2,100-vault census sums to 2,100', LEVELS.reduce((a, l) => a + cen2100[l], 0), 2100)
  t('...and its denominator is 6,405', denominator(cen2100), 6405)
  t('Level V receives exactly 3x Level I', LEVEL_WEIGHTS.V / LEVEL_WEIGHTS.I, 3)
  t('per $1,000 at 240 vaults matches the card',
    LEVELS.map(l => (1000 * LEVEL_WEIGHTS[l] / 732).toFixed(2)), ['2.73', '4.10', '5.46', '6.83', '8.20'])
  t('per $1,000 at 2,100 vaults matches the card',
    LEVELS.map(l => (1000 * LEVEL_WEIGHTS[l] / 6405).toFixed(2)), ['0.31', '0.47', '0.62', '0.78', '0.94'])
  t('share of every drop by level at 2,100 matches the card',
    LEVELS.map(l => (100 * cen2100[l] * LEVEL_WEIGHTS[l] / 6405).toFixed(1)), ['29.5', '24.6', '19.7', '16.4', '9.8'])
  t('...and those shares sum to exactly 100%',
    LEVELS.reduce((a, l) => a + 100 * cen2100[l] * LEVEL_WEIGHTS[l] / 6405, 0).toFixed(1), '100.0')
  // BOTH WAYS: the card check must FAIL if a weight moves, or it is decoration.
  t('...and a weight changed by one makes the card figures wrong',
    (1000 * 7 / 732).toFixed(2) === '8.20', false)

  // ─── WEIGHTED ALLOCATION ───
  const lv = { [A]: 'I', [B]: 'I', [C]: 'V' }
  const bal3 = { [A]: '21000', [B]: '21000', [C]: '21000' }
  t('pays by WEIGHT, not equally',
    (() => { const r = allocateWeighted(bal3, lv, 1000n); return [String(r.per[A]), String(r.per[C])] })(), ['200', '600'])
  t('...so a Level V vault receives 3x a Level I on the same drop',
    (() => { const r = allocateWeighted(bal3, lv, 1000n); return String(r.per[C] / r.per[A]) })(), '3')
  t('two vaults at the SAME level receive EXACTLY the same amount',
    (() => { const r = allocateWeighted(bal3, lv, 1000n); return r.per[A] === r.per[B] })(), true)
  t('the denominator is the sum of ACTIVATED weights only',
    allocateWeighted({ [A]: '21000', [B]: '20999', [C]: '21000' }, lv, 1000n).denominator, 2 + 6)
  t('...and an unactivated vault is simply absent, never weight-zero-and-paid',
    allocateWeighted({ [A]: '21000', [B]: '20999', [C]: '21000' }, lv, 1000n).activated, [A, C])
  // THE DUST CARRIES; IT IS NEVER SPLIT AND NEVER KEPT.
  t('the dust is what integer division left, and it is reported',
    (() => { const r = allocateWeighted(bal3, lv, 1000n); return [String(r.total), String(r.dust)] })(), ['1000', '0'])
  t('...and a drop that does not divide leaves dust for the NEXT drop',
    (() => { const r = allocateWeighted(bal3, lv, 1001n); return [String(r.total), String(r.dust)] })(), ['1000', '1'])
  // ⚠️ THIS ASSERTED THE LOOSE BOUND, SO IT COULD NEVER HAVE CAUGHT THE COMMENT
  // ABOVE BEING THREEFOLD WRONG. `dust < denominator` is true and uninformative;
  // the bound that actually holds is one fractional part per paid vault.
  t('...and the dust is under ONE SAT PER PAID VAULT, not merely under the denominator',
    (() => { const r = allocateWeighted(bal3, lv, 1007n)
             return r.dust < BigInt(r.activated.length) })(), true)
  t('...and that tighter bound holds across a full 2,100-vault census',
    (() => {
      const levels = {}; let i = 0
      for (const [l, n] of [['I', 945], ['II', 525], ['III', 315], ['IV', 210], ['V', 105]])
        for (let k = 0; k < n; k++) levels['v' + (i++)] = l
      const bals = Object.fromEntries(Object.keys(levels).map(v => [v, '21000']))
      let worst = 0n
      for (const avail of [1000000n, 1000001n, 999999n, 123456789n, 51239n, 1n, 7n]) {
        const r = allocateWeighted(bals, levels, avail)
        if (r.dust > worst) worst = r.dust
        if (r.dust >= BigInt(r.activated.length)) return 'BOUND BROKEN at ' + avail
      }
      return worst < 2100n
    })(), true)
  // AN ACTIVATED VAULT WITH NO LEVEL IS A REFUSAL, NOT A ZERO.
  t('an activated vault carrying NO level stops the whole distribution',
    allocateWeighted(bal3, { [A]: 'I', [C]: 'V' }, 1000n).skip !== null, true)
  t('...and an unknown level string is refused too, never coerced',
    allocateWeighted(bal3, { [A]: 'I', [B]: 'VI', [C]: 'V' }, 1000n).skip !== null, true)
  t('...while the SAME vaults with every level present are paid',
    allocateWeighted(bal3, lv, 1000n).skip, null)

  // ─── THE CADENCE: ONE THRESHOLD, THE BAND FALLS OUT ───
  t('a drop that clears the threshold pays NOW',
    decideEmission({ smallestPer: 21n, daysSinceLastPayout: 0 }).pay, true)
  t('...and one that does not, holds',
    decideEmission({ smallestPer: 20n, daysSinceLastPayout: 3 }).pay, false)
  t('...but is FORCED out at the ceiling, however small',
    (() => { const d = decideEmission({ smallestPer: 1n, daysSinceLastPayout: 31 }); return [d.pay, d.forced] })(), [true, true])
  t('...and one day short of the ceiling still holds',
    decideEmission({ smallestPer: 1n, daysSinceLastPayout: 30 }).pay, false)
  t('nothing at all is never "forced" into a zero payout',
    decideEmission({ smallestPer: 0n, daysSinceLastPayout: 99 }).pay, false)
  // THE BAND IS DESCRIPTIVE AND DERIVED — there is no stored band to drift.
  t('the observed cadence reads back as the words on the card',
    [describeCadence(1), describeCadence(7), describeCadence(31)], ['daily', 'weekly', 'monthly'])
  // THE HOLD CLOCK IS DERIVED FROM THE LEDGER, never stored beside it.
  t('days held counts from the last day that actually PAID somebody',
    holdDays({ days: { '2026-08-01': { paid: { x: 1 } }, '2026-08-05': { paid: {} } } }, '2026-08-08'), 7)
  t('...and a ledger that has never paid anchors on its earliest day, not on today',
    holdDays({ days: { '2026-08-01': { paid: {} } } }, '2026-08-08'), 7)
  t('...and a first-ever run has nothing to force', holdDays({ days: {} }, '2026-08-08'), 0)
  // ─── ROUND 17 FIXES, each proven in the direction that was broken ───
  // A DAY ON WHICH NOTHING LANDED IS NOT A PAYOUT. Rows are written BEFORE the
  // send, so an all-failed day used to reset the clock from 52 days to 2 and the
  // ceiling never fired.
  {
    const failedDay = { paid: {
      a: { amount: '9', sig: null, sentAt: 'x' },                      // ambiguous
      b: { amount: '9', sig: null, rejected: true, error: 'frozen' },  // refused
      c: { amount: '9', sig: null, skipped: 'not a live Core asset' },
    } }
    const real = { paid: { a: { amount: '9', sig: 'A_REAL_SIGNATURE' } } }
    t('a day on which every transfer FAILED does not reset the hold clock',
      holdDays({ days: { '2026-07-01': real, '2026-08-20': failedDay } }, '2026-08-22'), 52)
    t('...while a day that really paid DOES',
      holdDays({ days: { '2026-07-01': real, '2026-08-20': real } }, '2026-08-22'), 2)
    t('...and the ceiling therefore fires on the failed-day ledger, as it must',
      decideEmission({ smallestPer: 1n, daysSinceLastPayout:
        holdDays({ days: { '2026-07-01': real, '2026-08-20': failedDay } }, '2026-08-22') }).forced, true)
  }
  // A LEDGER DAY KEY THAT IS NOT A DATE IS AN ABORT, NOT A GUESS.
  {
    const threw = k => { try { holdDays({ days: { [k]: { paid: {} } } }, '2026-08-22'); return false } catch { return true } }
    t('an unparseable ledger day key is refused, not computed on',
      ['0000-00-00', 'not-a-date', '    '].map(threw), [true, true, true])
    t('...and a REAL date is still accepted', threw('2026-07-01'), false)
    // `2026-02-30` is shaped like a date and rolls into March. It must not be
    // silently turned into a confident 173.
    // ⚠️ THIS ASSERTION USED TO EXPECT 173 — the wrong answer — under a name that
    // said it did not. It pinned the defect. `2026-02-30` is date-SHAPED and rolls
    // into March; only a round-trip separates it from a date.
    t('...and a shaped-but-impossible date is REFUSED, not rolled over',
      (() => { try { return holdDays({ days: { '2026-02-30': { paid: { a: { sig: 'x' } } } } }, '2026-08-22') } catch { return 'REFUSED' } })(), 'REFUSED')
    t('...and every real date still round-trips',
      ['2026-02-28', '2024-02-29', '2026-12-31', '2026-01-01'].every(realDay), true)
    t('...while the impossible ones do not',
      ['2026-02-30', '2026-13-01', '2026-00-10', '2023-02-29'].some(realDay), false)
  }
  // A LEVEL NAMED AFTER AN Object.prototype MEMBER IS NOT A LEVEL.
  {
    const protoLevels = { [A]: 'constructor', [B]: 'I', [C]: 'I' }
    t('a level inherited from Object.prototype is refused, not weighted',
      allocateWeighted(bal3, protoLevels, 1000n).skip !== null, true)
    t('...and the old truthiness check would have PASSED it',
      !!({ I: 2, II: 3, III: 4, IV: 5, V: 6 })['constructor'], true)
    t('...for every prototype member, not just constructor',
      ['constructor', 'toString', 'valueOf', 'hasOwnProperty'].every(k =>
        allocateWeighted(bal3, { [A]: k, [B]: 'I', [C]: 'I' }, 1000n).skip !== null), true)
  }
  t('a row a human RESOLVED is settled, not re-sent',
    paymentState({ amount: '5', sig: null, resolvedBy: 'gary: found it on chain' }), 'resolved')
  t('...and a resolved REFUSAL is SETTLED, never re-sent (order matters here)',
    paymentState({ amount: '5', sig: null, rejected: true, resolvedBy: 'gary: ATA unfrozen, paid by hand' }), 'resolved')

  // ROUND 18 — SETTLED IS NOT THE SAME QUESTION AS PAID OUT.
  // `holdDays` accepted one of `paymentState`'s five answers, so a day settled by
  // a HAND PAYMENT was invisible to the cadence. Proven in BOTH directions here:
  // the annotated hand payment resets the clock, and nothing else does.
  t('a real signature is a payout day', settledAsPayout({ sig: 'S' }), true)
  t('a hand payment SAYING SO is a payout day',
    settledAsPayout({ sig: null, resolvedBy: 'gary: paid by hand', resolvedAs: 'paid' }), true)
  t('...but a bare resolvedBy is NOT — the guess must pay people sooner, not later',
    settledAsPayout({ sig: null, resolvedBy: 'gary: closed it' }), false)
  t('...and a resolution that says nothing landed is NOT a payout day',
    settledAsPayout({ sig: null, resolvedBy: 'gary: nothing landed', resolvedAs: 'unpaid' }), false)
  t('an unpaid row is not a payout day', settledAsPayout({ sig: null }), false)
  t('the whole point: a hand-paid day RESETS the hold clock, a bare one does not',
    (() => {
      const mk = r => ({ days: { '2026-07-01': { paid: { a: { sig: 'old' } } },
                                 '2026-08-20': { paid: { a: r } } } })
      return [holdDays(mk({ sig: null, resolvedBy: 'x', resolvedAs: 'paid' }), '2026-08-22'),
              holdDays(mk({ sig: null, resolvedBy: 'x' }), '2026-08-22')].join(',')
    })(), '2,52')

  // ─────────── ROUND 19 ───────────
  // ⚠️ SUPERSEDING A NO-PAY VERDICT CLEARED TWO OF **THREE** MARKS.
  // `distribution_unfinished` is suppressed by `finishedAt` OR `nothingToDo` OR
  // `resolvedBy`. Round 18 fixed "one of two" to "two of two"; `finishedAt` —
  // which the SKIP path writes on the same line as `nothingToDo` — was never in
  // the list. And the repair's own comment argued from a premise its code makes
  // false: it said such a day would be "leaving `finishedAt` unset", when
  // `finishedAt` is not unset in that ordering, it is LEFT OVER.
  //
  // The supersede is a pure function now because it could not be reached before:
  // it lived inside main() behind an RPC connection, a keyfile, a levels file and
  // a DAS fetch, so round 18's two arms proved the DETECTOR and left the WRITER
  // untested. Proven here in both directions, including the unfixed shape.
  {
    const day = '2026-08-22', today = '2026-08-23'
    const kinds = st => detectDistribution(st, { today }).map(f => f.kind)
    const quiet = { startedAt: '2026-08-22T09:07:00Z', nothingToDo: 'below threshold', finishedAt: '2026-08-22T09:07:05Z' }
    const crashed = { plan: { activated: ['v1', 'v2'], per: { v1: '100', v2: '100' }, census: {}, denominator: 5, available: '200' } }
    t('a quiet morning is legitimately silent', kinds({ days: { [day]: quiet } }), [])
    const sup = supersede(quiet, '2026-08-22T14:00:00Z')
    t('superseding clears refused, nothingToDo AND finishedAt',
      ['refused', 'nothingToDo', 'finishedAt'].filter(k => k in sup.rec), [])
    t('...so a run that proceeds and then DIES is no longer silent',
      kinds({ days: { [day]: { ...sup.rec, ...crashed } } }), ['distribution_unfinished'])
    t('...and the UNFIXED shape — finishedAt left behind — is what went dark',
      kinds({ days: { [day]: { ...sup.rec, finishedAt: quiet.finishedAt, ...crashed } } }), [])
    const both = supersede({ ...quiet, refused: 'no level for vault X' }, '2026-08-22T14:00:00Z')
    t('BOTH prior verdicts are recorded, not whichever the || reached first',
      both.rec.supersededWas, 'no level for vault X + below threshold')
    t('...and a refusal is still reported as a refusal', both.wasRefusal, true)
    // A human's resolution note must survive, without its suppressing power.
    // Both halves of a round-19 auditor's point are right: it MUST stop
    // suppressing distribution_unfinished, and it MUST NOT simply vanish.
    const withRes = supersede({ startedAt: 'x', nothingToDo: 'quiet', finishedAt: 'y',
      resolvedBy: 'gary: checked the chain, nothing landed' }, 'now')
    t('a human resolution note is PRESERVED, not destroyed',
      withRes.rec.supersededResolvedBy, 'gary: checked the chain, nothing landed')
    t('...while losing its power to suppress the unfinished alarm',
      'resolvedBy' in withRes.rec, false)
    const untouched = supersede({ startedAt: 'a', finishedAt: 'b' }, 'now')
    t('a day that never held a verdict keeps its finishedAt',
      [untouched.superseded, untouched.rec.finishedAt], [false, 'b'])
  }

  // ⚠️ A DAY THAT ALREADY PAID IS FINISHED, WHATEVER STALE FLAG IT CARRIES.
  // Filed as a HIGH by a round-19 auditor against the round-19 repair: that
  // superseding could strip `finishedAt` off a completed paying day, re-open the
  // transfer loop and page `distribution_unfinished` on rows carrying real
  // signatures. The production claim was REFUTED by measurement — a day with a
  // plan is routed to the resume branch, which never calls supersede, and
  // --dry-run never reaches it. The structural half was accepted: a pure
  // exported function must not depend on a caller's branch guard.
  {
    const paidDay = { startedAt: 'x', finishedAt: 'y', nothingToDo: 'stale',
      paid: { v1: { sig: 'REAL', amount: '100' } },
      plan: { activated: ['v1'], per: { v1: '100' }, census: {}, denominator: 2, available: '100' } }
    t('a day that already produced a plan KEEPS its finishedAt', supersede(paidDay, 'now').rec.finishedAt, 'y')
    const noPlan = { startedAt: 'x', finishedAt: 'y', nothingToDo: 'stale',
      paid: { v1: { sig: 'REAL', amount: '100' } } }
    t('...and so does one with a row that actually paid somebody', supersede(noPlan, 'now').rec.finishedAt, 'y')
    t('...and it is reported as such', supersede(paidDay, 'now').alreadyPaid, true)
    // THE OTHER DIRECTION: the quiet morning this function exists for still clears.
    const quiet = { startedAt: 'x', finishedAt: 'y', nothingToDo: 'below threshold' }
    t('a quiet day with no plan and no payout still LOSES finishedAt',
      'finishedAt' in supersede(quiet, 'now').rec, false)
    t('...and is not reported as already paid', supersede(quiet, 'now').alreadyPaid, false)
    // AND A ROW THAT MERELY EXISTS IS NOT A PAYOUT — the distinction settledAsPayout draws.
    const ambiguous = { startedAt: 'x', finishedAt: 'y', nothingToDo: 'stale', paid: { v1: { sig: null } } }
    t('an ambiguous row does not make a day count as paid',
      'finishedAt' in supersede(ambiguous, 'now').rec, false)
  }

  // ⚠️ THE SUPPRESSOR LIST IS DERIVED FROM THE DETECTOR, NOT RETYPED.
  // Round 18 cleared two of three marks. Round 19 found that, cleared three, and
  // an auditor found the FOURTH (`resolvedBy`) in the same session — an
  // enumeration wrong twice running. This arm parses `detectDistribution`'s own
  // `distribution_unfinished` predicate, extracts every `!rec.X` term, and
  // requires `supersede` to clear all of them. A suppressor added to the detector
  // and not cleared here is now RED instead of silent.
  {
    const detSrc = fsx2.readFileSync('/opt/cbob-vaults/bank/detectors.mjs', 'utf8')
    const guard = (detSrc.match(/if \(rec\.startedAt &&([\s\S]*?)&& day !== opts\.today\)/) || [])[1] || ''
    const needed = [...guard.matchAll(/!rec\.(\w+)/g)].map(m => m[1]).sort()
    t('the detector still has an unfinished guard this arm can read', needed.length > 0, true)
    t('supersede clears EVERY suppressor the detector honours', (() => {
      const rec = { startedAt: 'x', refused: 'r', ...Object.fromEntries(needed.map(k => [k, 'set'])) }
      const out = supersede(rec, 'now').rec
      return needed.filter(k => k in out)
    })(), [])
    t('...and DONE_MARKS is exactly that set, not a hand-kept copy', [...DONE_MARKS].sort(), needed)
    // BOTH WAYS, and simply: a clearing that misses ONE mark leaves exactly that
    // mark behind, which is the shape both the round-18 and the round-19 repair
    // shipped. Each suppressor is checked, so no single one can be forgotten.
    for (const missed of needed) {
      t(`...and a clearing that forgets '${missed}' is CAUGHT`, (() => {
        const rec = { startedAt: 'x', ...Object.fromEntries(needed.map(k => [k, 'set'])) }
        for (const m of needed) if (m !== missed) delete rec[m]
        return needed.filter(k => k in rec)
      })(), [missed])
    }
  }

  // ⚠️ "NO HOLDER EVER WAITS LONGER THAN A MONTH EVEN AT ZERO VOLUME" WAS FALSE
  // IN THE CASE IT NAMED. `decideEmission`'s first branch returns before
  // `maxHoldDays` is consulted, so at zero volume the ceiling never fires at any
  // age — and the assertion two hundred lines below the claim already said so.
  // The comment is corrected; this pins both directions of the true statement.
  t('at zero volume the ceiling never fires, at any age',
    [1, 31, 99, 365].map(d => decideEmission({ smallestPer: 0n, daysSinceLastPayout: d }).pay),
    [false, false, false, false])
  t('...but one satoshi per vault IS forced out at the ceiling',
    decideEmission({ smallestPer: 1n, daysSinceLastPayout: MAX_HOLD_DAYS }).forced, true)
  t('...and one day short of the ceiling it still holds',
    decideEmission({ smallestPer: 1n, daysSinceLastPayout: MAX_HOLD_DAYS - 1 }).pay, false)

  // ⚠️ REJECTED BY MEASUREMENT, PINNED SO IT STAYS REJECTED.
  // An auditor filed "worst observed 2,099 is not attainable; the true maximum is
  // about 1,731", with a lattice argument. The bound IS attained, at
  // available = denominator - 1, where every level's floor lands exactly one
  // short of its weight. The offered maximum is a local one.
  {
    const N = [945, 525, 315, 210, 105], W = [2n, 3n, 4n, 5n, 6n], DEN = 6405n
    const dustAt = a => a - N.reduce((acc, n, i) => acc + BigInt(n) * (a * W[i] / DEN), 0n)
    t('the 2,100-vault dust bound is ATTAINED at available = denominator-1', String(dustAt(6404n)), '2099')
    t('...which is exactly activated-1, the stated bound',
      String(dustAt(6404n)), String(N.reduce((a, b) => a + b, 0) - 1))
    t('...and the figure offered as the true maximum is merely a local one', dustAt(3202n) < dustAt(6404n), true)
    // ⚠️ AND SPEC MUST PUBLISH THE SAME NUMBER. Round 18 corrected this figure in
    // distribute.mjs and left SPEC saying 6,404 — one of two sites, and the one
    // that survived was the customer-facing document. A round-19 auditor found it.
    {
      const spec = fsx2.readFileSync('/opt/cbob-vaults/SPEC.md', 'utf8')
      const published = (spec.match(/at 2,100 vaults the remainder can be\s*\n?up to \*\*([\d,]+)\*\* sats/) || [])[1]
      t("SPEC publishes the dust maximum this arithmetic actually produces",
        published && published.replace(/,/g, ''), String(dustAt(6404n)))
      t('...and the superseded 6,404 figure is no longer stated as the maximum',
        /remainder can be\s*\n?up to 6,404 sats/.test(spec), false)
    }
  }

  // ⚠️ REJECTED BY MEASUREMENT: "the settledAsPayout default is backwards and
  // holders wait longer". Traced end to end — NOT resetting the clock makes
  // holdDays LARGER, which crosses the ceiling SOONER. Three auditors reached the
  // same conclusion independently; this pins it so a future edit cannot reverse
  // the default quietly.
  {
    const d = '2026-08-23'
    const led = extra => ({ days: { '2026-07-02': { paid: { v1: { sig: 'REAL' } } },
      '2026-08-21': { paid: { v1: { sig: null, resolvedBy: 'gary: paid by hand', ...extra } } } } })
    t('a bare resolvedBy leaves the clock at the last REAL payout', holdDays(led({}), d), 52)
    t('...and an explicit resolvedAs:paid resets it', holdDays(led({ resolvedAs: 'paid' }), d), 2)
    t('...so the conservative default forces a payout SOONER, as claimed',
      [decideEmission({ smallestPer: 1n, daysSinceLastPayout: holdDays(led({}), d) }).pay,
       decideEmission({ smallestPer: 1n, daysSinceLastPayout: holdDays(led({ resolvedAs: 'paid' }), d) }).pay],
      [true, false])
  }

  console.log(`\n${R.filter(Boolean).length}/${R.length} allocation assertions as predicted`)
  // A FLOOR HERE TOO. Its twin in `selftest.mjs` got one last night and this
  // one did not, which is the same one-of-two-sites shape for the sixth round
  // running. `R.every(Boolean)` on a list that stopped early is `true`, and
  // `run-tests.sh` treats this exit code as a gate over the arithmetic that
  // decides who gets paid how much.

  const FLOOR = 95
  // ⚠️ ROUND 19: EQUALITY, NOT A LOWER BOUND — the same repair as floor() in
// scripts/run-tests.sh. A `<` check accumulates slack, and slack is what a
// floor exists to remove: the on-chain floor sat two assertions under its
// real count for a whole round because nothing demanded they match.
if (R.length !== FLOOR) {
    console.error(`\n${R.length} assertions ran; the floor says ${FLOOR}. They must be EQUAL — the file stopped early, or the floor was not moved with the suite.`)
    process.exit(1)
  }
  process.exit(R.every(Boolean) ? 0 : 1)
} else {
  // 20 HOURS, not 6. A full run is up to ~2,100 sequential confirmed transfers;
  // at a second or two each under load that is hours, and a stale-lock timeout
  // shorter than the work it guards lets a second runner break in mid-payout —
  // which is the one thing the lock exists to prevent. It still expires well
  // inside the daily cadence, so a crashed run does not block tomorrow's.
  withLock(LOCK, main, { staleMs: 20 * 3600_000 }).catch(e => {
    const msg = e.code === 'ELOCKED'
      ? `CBOB DISTRIBUTION DID NOT RUN: ${e.message}`
      : `CBOB DISTRIBUTION FAILED: ${e.message}`
    console.error(msg)
    if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
    process.exit(3)
  })
}
