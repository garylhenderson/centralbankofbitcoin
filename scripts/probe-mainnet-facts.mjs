#!/usr/bin/env node
/**
 * THE FACTS ABOUT MAINNET THAT THIS SYSTEM RESTS ON, MEASURED.
 *
 * Two of them, both of which had been ASSUMED: that the alarm's signature walk
 * behaves the way its code reads, and that the three reserve mints are classic
 * SPL. Neither can be exercised on the local validator — one needs a busy
 * program with real history, the other needs mainnet itself.
 *
 * PART ONE — PROVE THE ALARM'S SIGNATURE WALK AGAINST A LIVE, BUSY PROGRAM.
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

/** THE ACTUAL HELPER THE ALARM RUNS — imported, not copied. It was duplicated
 *  here under a comment saying the two must not drift, and they already had. */
import { signaturesSince as walk } from '../bank/sigwalk.mjs'
const signaturesSince = (address, until, maxPages, limit) => walk(conn, address, until, maxPages, limit)

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

// ───────────────────────────────────────────────────────────────────────────
// THE RESERVE MINTS ARE CLASSIC SPL. The whole money path pins Tokenkeg —
// `split_revenue` builds its CPI against it, every ATA is derived with it, and
// both emptiness proofs demand a 165-byte account. Round 10 asked, correctly,
// whether that is TRUE of mainnet cbBTC rather than assumed, and the answer had
// never been asserted anywhere. A Token-2022 cbBTC would mean the distributor's
// ATA does not exist, the split cannot execute, and no vault is ever paid.
console.log('\n── the reserve mints ──')
const TOKENKEG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
for (const [name, mint] of [
  ['cbBTC', 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'],
  ['$GARY', '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk'],
  ['$GIRAFFISH', 'Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump'],
]) {
  const acc = await conn.getAccountInfo(new PublicKey(mint), 'confirmed')
  t(`${name} is a CLASSIC SPL mint, not Token-2022`, acc?.owner?.toBase58(), TOKENKEG)
  // 82 bytes is a bare Mint. Anything longer carries extensions, and a
  // confidential-balance extension reads zero in the base `amount` field —
  // which is what both emptiness proofs read.
  t(`${name} carries no mint extensions`, acc?.data.length, 82)
}

// ───────────────────────────────────────────────────────────────────────────
// THE ELF IN A ProgramData ACCOUNT STARTS AT 45 EVEN WHEN THE AUTHORITY IS GONE.
//
// `bank/alarm.mjs` fingerprints every program — including METAPLEX CORE, which we
// do not control and which is the most important entry in that watch — with
// `acc.data.subarray(45)`. Two auditors across two rounds filed that as a defect:
// bincode serializes `Option::None` as ONE byte, so an immutable program's ELF
// should start at 13. That reasoning is correct about bincode and wrong about
// this account: `set_authority` rewrites the header INTO THE EXISTING ACCOUNT and
// never resizes it, so the 32 authority bytes are left behind as garbage.
//
// A LOCAL VALIDATOR CANNOT SHOW THIS. It has no program that was upgradeable,
// had its authority cleared, and kept the stale bytes — which is exactly why the
// claim survived two rounds unmeasured. So it is asserted here, against two real
// immutable mainnet programs, and the "fix" that would have folded 32 bytes of
// stale authority into Core's fingerprint stays dead.
console.log('\n── the ProgramData ELF offset ──')
const MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46])
for (const [name, pd] of [
  ['Token Metadata', 'PwDiXFxQsGra4sFFTT8r1QWRMd4vfumiWC1jfWNfdYT'],
  ['Squads v4', 'Fy3YMJCvwbAXUgUM5b91ucUVA3jYzwWLHL3MwBqKsh8n'],
]) {
  const acc = await conn.getAccountInfo(new PublicKey(pd), 'confirmed')
  t(`${name} ProgramData is a ProgramData account`, acc?.data.readUInt32LE(0), 3)
  t(`${name} has NO upgrade authority (the Option tag is None)`, acc?.data[12], 0)
  t(`${name}'s ELF still starts at 45, NOT 13`, acc?.data.subarray(45, 49).equals(MAGIC), true)
  t(`...and bytes 13..45 are the STALE authority, not the ELF`,
    acc?.data.subarray(13, 17).equals(MAGIC), false)
}

console.log(`\n${R.filter(Boolean).length}/${R.length} as predicted`
  + ` (walked ${walked.sigs.length} signatures over ${walked.pages} pages of a live mainnet program)`)
process.exit(R.every(Boolean) ? 0 : 1)
