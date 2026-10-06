/**
 * THE SIGNATURE WALK, DECLARED ONCE.
 *
 * ROUND 11. There were two copies: one in `bank/alarm.mjs` and one in
 * `scripts/probe-mainnet-facts.mjs` under a comment reading "VERBATIM the
 * helper from bank/alarm.mjs. If they drift, this proves nothing." They had
 * already drifted — the probe's copy returned a `pages` field the alarm's did
 * not — so the probe was asserting a function nothing called against a live
 * mainnet program, and the function the alarm actually uses was untested.
 *
 * The behaviour itself is the thing this system's whole burn/sweep/split
 * detection rests on, and it CANNOT be tested on a local validator: a
 * validator has no 1,599-signature program to page through. So it is asserted
 * against mainnet, and now it is asserted against the code that runs.
 *
 * `until` is a SENTINEL, not a filter: a signature belonging to another program
 * matches nothing and the RPC returns an empty list (measured — that is how one
 * bookmark shared across five programs left the scanner structurally dead after
 * its first pass). And `limit` alone silently drops everything older than the
 * newest N, which during a mint round is exactly the traffic worth reading, so
 * it PAGES. A sentinel not reached inside `maxPages` comes back as a GAP for
 * the caller to report, never swallowed.
 *
 * ROUND 30 (M1): a gap must be RECOVERABLE. More than `maxPages` pages after the
 * cursor (about 0.1 SOL of stranger transactions naming the program) used to
 * gap every later pass forever, because each pass re-read only the newest
 * window. `startBefore` resumes the walk from the oldest signature a previous
 * pass examined, so a caller can drain any backlog over several passes and
 * advance its cursor only when the walk finally reaches it.
 */
export async function signaturesSince(conn, address, until, maxPages = 20, limit = 1000, startBefore = undefined) {
  const out = []
  let before = startBefore
  for (let p = 0; p < maxPages; p++) {
    const batch = await conn.getSignaturesForAddress(address,
      { limit, ...(before ? { before } : {}), ...(until ? { until } : {}) }, 'confirmed')
    out.push(...batch)
    if (batch.length < limit) return { sigs: out, gap: false, pages: p + 1 }
    before = batch[batch.length - 1].signature
  }
  return { sigs: out, gap: true, pages: maxPages }
}
