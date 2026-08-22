#!/usr/bin/env node
/**
 * PROVE THE ALARM'S SIGNATURE WALK AGAINST A LIVE, BUSY PROGRAM.
 *
 * Round 6's headline finding was that the old walk could not work: one cursor
 * was passed as `until` to five different addresses, and a signature foreign to
 * an address makes the RPC return an EMPTY list. That was settled by measurement
 * rather than argument, and so is the replacement — a helper that pages is not
 * obviously correct just because it reads correctly.
 *
 * The local validator cannot exercise this: it has no history and no busy
 * program. So this probe runs against mainnet, against the SPL Associated Token
 * Account program, which is busy enough that 1,000 signatures is a short window.
 *
 * It asserts four things:
 *   1. exceeding maxPages reports a GAP rather than truncating silently,
 *   2. it pages PAST the 1,000-signature response cap to reach a cursor,
 *   3. the newest signature is at index 0, so the cursor advances correctly,
 *   4. the cursor itself is EXCLUDED, so nothing is scanned twice.
 *
 *   node scripts/probe-signature-paging.mjs
 */
import fs from 'fs'
import { PublicKey, Connection } from '/opt/gary-club/node_modules/@solana/web3.js/lib/index.cjs.js'

const rpc = (fs.readFileSync('/opt/gary-club/.env.local', 'utf8').match(/^HELIUS_RPC_URL=(.*)$/m) || [])[1].trim()
const conn = new Connection(rpc, 'confirmed')

/** VERBATIM the helper from bank/alarm.mjs. If they drift, this proves nothing. */
async function signaturesSince(address, until, maxPages = 20, limit = 1000) {
  const out = []
  let before
  for (let p = 0; p < maxPages; p++) {
    const batch = await conn.getSignaturesForAddress(address,
      { limit, ...(before ? { before } : {}), ...(until ? { until } : {}) }, 'confirmed')
    out.push(...batch)
    if (batch.length < limit) return { sigs: out, gap: false, pages: p + 1 }
    before = batch[batch.length - 1].signature
  }
  return { sigs: out, gap: true, pages: maxPages }
}

const R = []
const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want)
  R.push(ok); console.log(`  ${ok ? 'ok  ' : 'XX  '}${name}${ok ? '' : ` got ${got} want ${want}`}`) }

const BUSY = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

const capped = await signaturesSince(BUSY, undefined, 2, 1000)
t('a window it cannot close is reported as a GAP, not truncated', capped.gap, true)

// Walk back ~1,600 signatures by hand so the cursor is provably past a page edge.
const page1 = await conn.getSignaturesForAddress(BUSY, { limit: 1000 }, 'confirmed')
const page2 = await conn.getSignaturesForAddress(BUSY, { limit: 600, before: page1[999].signature }, 'confirmed')
const cursor = page2[page2.length - 1].signature

const walked = await signaturesSince(BUSY, cursor, 20, 1000)
t('it pages PAST the 1000-signature response cap', walked.sigs.length > 1000, true)
t('and stops, rather than running to maxPages', walked.gap, false)
t('the newest signature is index 0, so the cursor advances forward',
  walked.sigs[0].blockTime >= walked.sigs[walked.sigs.length - 1].blockTime, true)
t('the cursor itself is EXCLUDED, so nothing is scanned twice',
  walked.sigs.some(s => s.signature === cursor), false)

console.log(`\n${R.filter(Boolean).length}/${R.length} as predicted`
  + ` (walked ${walked.sigs.length} signatures over ${walked.pages} pages of a live mainnet program)`)
process.exit(R.every(Boolean) ? 0 : 1)
