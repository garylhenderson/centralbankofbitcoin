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
import { PublicKey, Connection, Keypair, TransactionMessage, VersionedTransaction } from '/opt/gary-club/node_modules/@solana/web3.js/lib/index.cjs.js'
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'

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
// Round 25 W1: use a funded fee-payer address only in UNSIGNED simulation.
// No key is read and no transaction is sent. A fresh off-curve owner makes each
// ATA absent, so the classic control exercises creation rather than a no-op.
let simulationPayer
for (const sig of page1.filter(s => !s.err).slice(0, 20)) {
  const tx = await conn.getTransaction(sig.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  const candidate = tx?.transaction.message.staticAccountKeys?.[0] ?? tx?.transaction.message.accountKeys?.[0]
  if (candidate && await conn.getBalance(candidate, 'confirmed') >= 10_000_000) { simulationPayer = candidate; break }
}
if (!simulationPayer) throw new Error('no funded simulation fee payer found in the sampled mainnet history')
const simulationOwner = PublicKey.findProgramAddressSync([Keypair.generate().publicKey.toBuffer()], BUSY)[0]
const { blockhash } = await conn.getLatestBlockhash('confirmed')
for (const [name, mint, expectedFreeze] of [
  ['cbBTC', 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', 'DSFAkPhfrSR95J9oq9Sh8rUetbj5vgFmwiSuHw6rAVnz'],
  ['$GARY', '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk', null],
  ['$GIRAFFISH', 'Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump', null],
]) {
  const acc = await conn.getAccountInfo(new PublicKey(mint), 'confirmed')
  t(`${name} is a CLASSIC SPL mint, not Token-2022`, acc?.owner?.toBase58(), TOKENKEG)
  // 82 bytes is a bare Mint. Anything longer carries extensions, and a
  // confidential-balance extension reads zero in the base `amount` field —
  // which is what both emptiness proofs read.
  t(`${name} carries no mint extensions`, acc?.data.length, 82)
  const tag = acc?.data.length === 82 ? acc.data.readUInt32LE(46) : -1
  const freeze = tag === 0 ? null : tag === 1 ? new PublicKey(acc.data.subarray(50, 82)).toBase58() : 'invalid freeze-authority COption'
  t(`${name} freeze authority matches the recorded mainnet authority`, freeze, expectedFreeze)
  for (const tokenProgram of [TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID]) {
    const mintKey = new PublicKey(mint)
    const ata = getAssociatedTokenAddressSync(mintKey, simulationOwner, true, tokenProgram)
    const ix = createAssociatedTokenAccountIdempotentInstruction(simulationPayer, ata, simulationOwner, mintKey, tokenProgram)
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: simulationPayer, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message())
    const result = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' })
    const token2022 = tokenProgram.equals(TOKEN_2022_PROGRAM_ID)
    t(`${name}: ${token2022 ? 'Token-2022 ATA creation refuses IncorrectProgramId' : 'classic ATA creation control succeeds'}`,
      result.value.err, token2022 ? { InstructionError: [0, 'IncorrectProgramId'] } : null)
  }
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

// ───────────────────────────────────────────────────────────────────────────
// THE PROOF OF BURN SET (v6 stage 2). A PoB is NOT its own mint or collection: it
// is one of 240 Core assets inside the SHARED Giraffish Moments collection, marked
// only by a name and uri the collection's hot-key update authority can rewrite,
// and beside which it could mint a lookalike. So MINT pins the set by ADDRESS, as
// a Merkle root, and this re-derives that root from mainnet RAW account data (not
// DAS, which has failed open here three times) every run.
// After the charter window opens, claimed PoBs are BURNED; a burned Core asset is
// identified POSITIVELY (round 21) as Core-owned, one byte, key 0.
console.log('\n── the Proof of Burn set ──')
{
  const { rootOf } = await import('./pob-merkle.mjs')
  const set = JSON.parse(fs.readFileSync(new URL('./pob-set.json', import.meta.url), 'utf8'))
  const CORE = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
  t('the pinned set is exactly 240 assets, editions 1..240 in order',
    set.assets.length === 240 && set.assets.every((x, i) => x.edition === i + 1), true)
  t('the committed root is rebuilt from those 240 addresses',
    rootOf(set.assets.map(x => new PublicKey(x.address).toBytes())).toString('hex'), set.root)
  let live = 0, burned = 0, bad = []
  for (let i = 0; i < set.assets.length; i += 100) {
    const slice = set.assets.slice(i, i + 100)
    const accs = await conn.getMultipleAccountsInfo(slice.map(x => new PublicKey(x.address)), 'confirmed')
    accs.forEach((a, j) => {
      const x = slice[j]
      if (a && a.owner.toBase58() === CORE && a.data.length === 1 && a.data[0] === 0) { burned++; return }
      const ok = a && a.owner.toBase58() === CORE && a.data[0] === 1 && a.data[33] === 2
        && new PublicKey(a.data.subarray(34, 66)).toBase58() === set.collection
        && a.data.subarray(70, 70 + a.data.readUInt32LE(66)).toString() === `Proof of Burn #${x.edition}`
      if (ok) live++; else bad.push(x.edition)
    })
  }
  t('every pinned address is a live PoB in the Moments collection, or positively burned',
    bad.length === 0 ? 'all' : `editions ${bad.join(',')}`, 'all')
  console.log(`  ${live} live, ${burned} burned`)
  const cb = await conn.getAccountInfo(new PublicKey('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'), 'confirmed')
  // The round price floor is "21,000 sats" in BASE UNITS of the payment mint. That
  // is only true if cbBTC has 8 decimals.
  t('cbBTC has 8 decimals, so 21,000 base units is 21,000 sats', cb?.data[44], 8)
  // STAGE 3b: a distribution burns DISTRIBUTE_BURN_GARY = 100_000_000_000 base
  // units, which is 100 $GARY only if $GARY has 9 decimals. Classic SPL is
  // already asserted above; the burn pins that owner too.
  const gy = await conn.getAccountInfo(new PublicKey('8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk'), 'confirmed')
  t('$GARY has 9 decimals, so 100_000_000_000 base units is 100 $GARY', gy?.data[44], 9)
}

console.log(`\n${R.filter(Boolean).length}/${R.length} as predicted`
  + ` (walked ${walked.sigs.length} signatures over ${walked.pages} pages of a live mainnet program)`)
process.exit(R.every(Boolean) ? 0 : 1)
