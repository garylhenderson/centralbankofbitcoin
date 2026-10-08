#!/usr/bin/env node
/**
 * EVERY REDEMPTION IS PUBLIC (Gary, 2026-10-03: "Alert - YES post to X and on our
 * CentralBankOfBitcoin Website"). The on-chain 2.1%-per-hour cap is the CONTROL;
 * the public post is the ALARM anyone can read — a thief emptying vaults through
 * leaked keys does it in public, one post at a time, while we move the rest.
 *
 * ⚠️ BUILT AND SELF-TESTED ONLY. THIS FILE CANNOT POST ANYWHERE. There is no X
 * client, no Zernio call and no website write in it, deliberately. Two things
 * stand between this and a live post, and neither is this file's to grant:
 *   1. ~/.claude/rules/cbob-x-account.md grants STANDING authorization for
 *      REPLIES on @cbobtc only — "replies yes, new posts/announcements/
 *      commitments no". An automated post per redemption is a new post. Gary's
 *      line above is the product decision; the posting MECHANISM (Zernio
 *      account 6a8350e977555aae01aed694, cadence, batching in a busy hour) still
 *      needs his explicit go-ahead before a sender is written.
 *   2. The CBOB website surface for the record (which page, which table) is not
 *      chosen. `web` below is the row it would carry.
 * Until both exist, it writes each drafted post to a local queue file and the
 * log, which is also what a reviewer reads to approve the copy.
 *
 * THE COPY FOLLOWS THE ACCOUNT'S CANON: the Bank speaks, flat, one or two short
 * sentences; never a number that is not real (every figure here is read from the
 * redemption transaction itself); no em dashes; no links.
 *
 *   node bank/redemption-poster.mjs              # draft posts for new redemptions
 *   node bank/redemption-poster.mjs --selftest   # prove the copy, both ways
 */
import fs from 'fs'
import { fileURLToPath } from 'url'
import { parseCbobLogs, BURN_PROGRAM_ID } from './detectors.mjs'
import { readParsedTransaction } from './txread.mjs'

export const LEVEL_NAMES = ['I', 'II', 'III', 'IV', 'V']
/** The three reserve assets and how the Bank names them. Anything else that
 *  left a vault is named by its mint, not guessed at. */
export const ASSETS = {
  cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: { name: 'BTC', decimals: 8 },
  '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk': { name: '$GARY', decimals: 9 },
  Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump: { name: '$GIRAFFISH', decimals: 6 },
  // Round 31 (D2): the vault wallet's own SOL, swept to the holder by a System
  // transfer, is released too; it is keyed by the native mint.
  So11111111111111111111111111111111111111112: { name: 'SOL', decimals: 9 },
}
const X_LIMIT = 280

/** ROUND 41 (C01): the queue key, one per REDEMPTION (signature:vault), or
 *  signature:* for a whole transaction rejected by hand (truncated logs). */
export function draftKey(w) { return w?.signature ? `${w.signature}:${w.vault ?? '*'}` : null }

/** Exact decimal rendering of a base-unit amount. Never a float: the Bank does
 *  not round a holder's money in public. Trailing zeros trimmed, separators added
 *  to the whole part. */
export function formatAmount(base, decimals) {
  const b = BigInt(base)
  if (b < 0n) throw new Error('negative amount')
  const s = b.toString().padStart(decimals + 1, '0')
  const whole = s.slice(0, s.length - decimals) || '0'
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, '') : ''
  const w = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac ? `${w}.${frac}` : w
}

/**
 * What LEFT the vault, from the redemption transaction's own token balances:
 * every token account OWNED BY THE VAULT'S asset-signer PDA whose balance fell.
 * `pre`/`post` are `meta.preTokenBalances` / `postTokenBalances`.
 */
export function releasedFrom(pre, post, vaultPda) {
  const key = b => `${b.accountIndex}`
  const after = new Map((post || []).map(b => [key(b), b]))
  const out = new Map()
  for (const b of pre || []) {
    if (b.owner !== vaultPda) continue
    const a = after.get(key(b))
    const before = BigInt(b.uiTokenAmount?.amount ?? '0')
    const now = a ? BigInt(a.uiTokenAmount?.amount ?? '0') : 0n
    if (before > now) out.set(b.mint, (out.get(b.mint) ?? 0n) + (before - now))
  }
  return [...out].map(([mint, amount]) => ({ mint, amount }))
}

/**
 * What LEFT the vault, counted as the OUTGOING TRANSFERS from its own token
 * accounts in the redemption transaction (round 22, P1). Pre/post balances
 * under-counted: a redemption claims its payout INTO the vault and sweeps it out
 * in the same transaction, so 21,000 before and 0 after read as 21,000 released
 * while the holder received 22,000. `tx` is a jsonParsed transaction.
 */
export function releasedFromTx(tx, vaultPda) {
  // Self-contained: the selftest extracts this function's text on its own.
  const SYSTEM_PROGRAM = '11111111111111111111111111111111', NATIVE_MINT = 'So11111111111111111111111111111111111111112'
  const keys = (tx?.transaction?.message?.accountKeys || []).map(k => String(k.pubkey ?? k))
  const owned = new Map()
  for (const b of [...(tx?.meta?.preTokenBalances || []), ...(tx?.meta?.postTokenBalances || [])])
    if (b.owner === vaultPda) owned.set(keys[b.accountIndex], b.mint)
  const out = new Map()
  const all = [...(tx?.transaction?.message?.instructions || []), ...(tx?.meta?.innerInstructions || []).flatMap(g => g.instructions)]
  for (const ix of all) {
    const p = ix.parsed
    if (!p || (p.type !== 'transfer' && p.type !== 'transferChecked')) continue
    if (String(ix.programId) === SYSTEM_PROGRAM) {
      if (p.info?.source === vaultPda) out.set(NATIVE_MINT, (out.get(NATIVE_MINT) ?? 0n) + BigInt(p.info.lamports ?? 0))
      continue
    }
    const mint = owned.get(p.info?.source)
    if (!mint) continue
    const amt = BigInt(p.info.tokenAmount?.amount ?? p.info.amount ?? '0')
    out.set(mint, (out.get(mint) ?? 0n) + amt)
  }
  return [...out].map(([mint, amount]) => ({ mint, amount }))
}

/** The post. Pure, so the copy rules are proven, not hoped. */
export function draftPost({ mintIndex, level, released, blockTime, signature }) {
  if (!Number.isInteger(level) || level < 1 || level > 5) throw new Error(`level ${level} is not I..V`)
  // Gary 2026-10-07: vaults are numbered from ONE, as their metadata names them
  // ("CBOB Vault #1"); mint_index stays 0-based on chain.
  const no = String(mintIndex + 1).padStart(4, '0')
  const parts = released
    .filter(r => BigInt(r.amount) > 0n)
    .map(r => { const a = ASSETS[r.mint]; return a ? `${formatAmount(r.amount, a.decimals)} ${a.name}` : `${r.amount} units of ${r.mint}` })
  const list = parts.length === 0 ? 'Nothing was held.'
    : parts.length === 1 ? `${parts[0]} was released to its holder.`
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]} were released to its holder.`
  const x = `Vault No. ${no} (Level ${LEVEL_NAMES[level - 1]}) has been redeemed. ${list} The vault no longer exists.`
  const problems = judgeCopy(x)
  return { x, problems, web: { vault: no, level: LEVEL_NAMES[level - 1], released: parts, at: blockTime ?? null, signature: signature ?? null } }
}

/** The account's canon, mechanically: length, no em/en dashes, no links, no
 *  exclamation, no emoji. A draft with a problem is never queued as ready. */
export function judgeCopy(text) {
  const p = []
  if (text.length > X_LIMIT) p.push(`${text.length} characters, over ${X_LIMIT}`)
  if (/[—–]/.test(text)) p.push('contains an em or en dash')
  if (/https?:\/\/|www\./i.test(text)) p.push('contains a link')
  if (/!/.test(text)) p.push('contains an exclamation mark')
  if (/\p{Extended_Pictographic}/u.test(text)) p.push('contains an emoji')
  return p
}

// ───────────────────────────────── selftest ─────────────────────────────────
function selftest() {
  const R = []
  const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want)
    R.push(ok); console.log(`  ${ok ? 'ok  ' : 'XX  '}${name}${ok ? '' : `\n        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`) }
  const CB = 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', GA = '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk'
  const GI = 'Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump', PDA = 'VaultPda1111111111111111111111111111111111'
  console.log('── amounts are exact ──')
  t('21,000 sats renders as 0.00021 BTC', formatAmount(21000n, 8), '0.00021')
  t('one whole BTC renders without a fraction', formatAmount(100000000n, 8), '1')
  t('1,234.5 $GARY keeps its separator and its half', formatAmount(1234500000000n, 9), '1,234.5')
  t('one base unit is not rounded away', formatAmount(1n, 8), '0.00000001')
  t('zero is zero', formatAmount(0n, 6), '0')
  console.log('── what left the vault ──')
  const pre = [{ accountIndex: 3, mint: CB, owner: PDA, uiTokenAmount: { amount: '50000' } },
    { accountIndex: 4, mint: GA, owner: PDA, uiTokenAmount: { amount: '1000000000000' } },
    { accountIndex: 7, mint: CB, owner: 'SomeoneElse', uiTokenAmount: { amount: '9' } }]
  const post = [{ accountIndex: 3, mint: CB, owner: PDA, uiTokenAmount: { amount: '0' } },
    { accountIndex: 7, mint: CB, owner: 'SomeoneElse', uiTokenAmount: { amount: '50009' } }]
  const rel = releasedFrom(pre, post, PDA)
  t('reads the vault\'s own falls, including a CLOSED account', rel.map(r => [r.mint, String(r.amount)]), [[CB, '50000'], [GA, '1000000000000']])
  t('...and ignores an account that is not the vault\'s', releasedFrom(pre, post, 'Nobody').length, 0)
  // ROUND 22 (P1): the claim lands IN the vault and is swept out in the same
  // transaction; balances say 21,000 left, transfers say 22,000 did.
  {
    const tx = { transaction: { message: { accountKeys: ['Payer', 'VaultAtaCb', 'HolderAta', 'Pool'].map(pubkey => ({ pubkey })),
      instructions: [] } }, meta: {
      preTokenBalances: [{ accountIndex: 1, mint: CB, owner: PDA, uiTokenAmount: { amount: '21000' } }],
      postTokenBalances: [],
      innerInstructions: [{ index: 1, instructions: [
        { parsed: { type: 'transfer', info: { source: 'Pool', destination: 'VaultAtaCb', amount: '1000' } } },
        { parsed: { type: 'transferChecked', info: { source: 'VaultAtaCb', destination: 'HolderAta', tokenAmount: { amount: '22000' } } } }] }] } }
    t('a redemption that claims and sweeps in ONE transaction reports what the holder actually got (22,000, not 21,000)',
      releasedFromTx(tx, PDA).map(r => [r.mint, String(r.amount)]), [[CB, '22000']])
    t('...and an inbound transfer to the vault is never counted as released',
      releasedFromTx({ ...tx, meta: { ...tx.meta, innerInstructions: [{ index: 1, instructions: [tx.meta.innerInstructions[0].instructions[0]] }] } }, PDA).length, 0)
  }
  console.log('── the copy ──')
  const p = draftPost({ mintIndex: 141, level: 3, released: rel, blockTime: 1, signature: 's' })
  t('a full redemption reads as the Bank', p.x, 'Vault No. 0142 (Level III) has been redeemed. 0.0005 BTC and 1,000 $GARY were released to its holder. The vault no longer exists.')
  t('...and passes every copy rule', p.problems, [])
  t('three assets are listed with commas and a final "and"',
    draftPost({ mintIndex: 0, level: 5, released: [{ mint: CB, amount: 21000n }, { mint: GA, amount: 1n }, { mint: GI, amount: 2000000n }] }).x,
    'Vault No. 0001 (Level V) has been redeemed. 0.00021 BTC, 0.000000001 $GARY and 2 $GIRAFFISH were released to its holder. The vault no longer exists.')
  {
    // ROUND 31 (D2): the vault wallet's SOL swept by a System transfer is
    // released and named; a vault whose only release was SOL no longer reads
    // "Nothing was held."
    const solTx = { transaction: { message: { accountKeys: [{ pubkey: PDA }], instructions: [] } },
      meta: { preTokenBalances: [], postTokenBalances: [], innerInstructions: [{ index: 0, instructions: [
        { programId: '11111111111111111111111111111111', parsed: { type: 'transfer', info: { source: PDA, destination: 'Holder111', lamports: 2_500_000 } } },
        { programId: '11111111111111111111111111111111', parsed: { type: 'transfer', info: { source: 'Someone111', destination: PDA, lamports: 9 } } }] }] } }
    const rel = releasedFromTx(solTx, PDA)
    t('R31 D2: SOL swept from the vault wallet is released and named, and SOL sent TO it is not',
      [rel.map(r => [r.mint, String(r.amount)]), draftPost({ mintIndex: 6, level: 2, released: rel }).x],
      [[['So11111111111111111111111111111111111111112', '2500000']], 'Vault No. 0007 (Level II) has been redeemed. 0.0025 SOL was released to its holder. The vault no longer exists.'])
  }
  t('numbering counts from one: mint index 0 posts as Vault No. 0001, index 2099 as No. 2100 (Gary 2026-10-07)',
    [draftPost({ mintIndex: 0, level: 1, released: [] }).x.startsWith('Vault No. 0001 '), draftPost({ mintIndex: 2099, level: 1, released: [] }).x.startsWith('Vault No. 2100 ')], [true, true])
  t('an empty vault says so rather than inventing a figure', draftPost({ mintIndex: 8, level: 1, released: [] }).x,
    'Vault No. 0009 (Level I) has been redeemed. Nothing was held. The vault no longer exists.')
  t('an unknown asset is named by its mint, never guessed', draftPost({ mintIndex: 2, level: 2, released: [{ mint: 'Weird1111', amount: 5n }] }).x.includes('5 units of Weird1111'), true)
  t('an undrawn level is refused, not posted as Level undefined', (() => { try { draftPost({ mintIndex: 1, level: 0, released: [] }); return false } catch { return true } })(), true)
  t('an em dash is caught', judgeCopy('The vault — is gone.'), ['contains an em or en dash'])
  t('a link is caught', judgeCopy('See https://example.com'), ['contains a link'])
  t('an exclamation is caught', judgeCopy('Redeemed!'), ['contains an exclamation mark'])
  t('an emoji is caught', judgeCopy('Redeemed \u{1F680}'), ['contains an emoji'])
  t('over 280 characters is caught', judgeCopy('x'.repeat(281)), ['281 characters, over 280'])
  // ASSEMBLED, so the pattern does not find itself (the "search that finds its
  // own searcher" defect, five times in Phase 0). Comment lines are excluded:
  // the header names Zernio on purpose, to say it is absent.
  const SENDER = new RegExp(['zer' + 'nio', 'api\\.x\\.com', 'twit' + 'ter', 'fet' + 'ch\\('].join('|'), 'i')
  const code = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l)).join('\n')
  t('this file contains no posting client (it must not be able to post)', SENDER.test(code), false)
  t('...and the check can fail: a sender line IS caught', SENDER.test(code + '\nawait fet' + 'ch("https://api' + '.x' + '.com/2/tweets")'), true)
  const ok = R.filter(Boolean).length
  console.log(`\n${ok}/${R.length} poster assertions as predicted`)
  process.exit(ok === R.length ? 0 : 1)
}

// ─────────────────────────────── drafting (I/O) ──────────────────────────────
async function main() {
  const { Connection, PublicKey } = await import('@solana/web3.js')
  const L = await import('./layout.mjs')
  const { signaturesSince } = await import('./sigwalk.mjs')
  const { readLedger, writeLedger } = await import('./lock.mjs')
  const env = fs.readFileSync('/opt/gary-club/.env.local', 'utf8')
  const conn = new Connection((env.match(/^HELIUS_RPC_URL=(.*)$/m) || [])[1].trim(), 'confirmed')
  const STATE = process.env.CBOB_POSTER_STATE || '/opt/cbob-vaults/bank/poster-state.json'
  const QUEUE = process.env.CBOB_POSTER_QUEUE || '/opt/cbob-vaults/bank/redemption-posts.jsonl'
  const st = readLedger(STATE, { cursor: null })
  const MINT = new PublicKey(L.PROGRAM_IDS.mint)
  // ROUND 30 (M1): a backlog bigger than one pass is drained from where the
  // last pass stopped (`st.backlog = { head, before }`), never re-read from the
  // top forever. The cursor moves to the backlog's head once a pass reaches it.
  const backlog = st.backlog ?? null
  const { sigs, gap } = await signaturesSince(conn, new PublicKey(BURN_PROGRAM_ID), st.cursor, 20, 1000, backlog?.before)
  if (gap) console.log('more BURN transactions than one pass pages through; this pass drafts the next window and the next run continues from where it stopped')
  const queued = new Set()
  // ROUND 41 (C01): ONE DRAFT PER REDEMPTION, not per transaction. A transaction
  // can carry two redemptions, and keying on the signature alone drafted the
  // first and silently skipped the second. A draft is keyed signature:vault; a
  // whole-transaction rejection (truncated logs) is keyed signature:*.
  try { for (const l of fs.readFileSync(QUEUE, 'utf8').split('\n')) if (l.trim()) { const k = draftKey(JSON.parse(l).web); if (k) queued.add(k) } } catch {}
  let drafted = 0
  const draining = st.backlog ?? null   // the backlog this pass resumed (round 30, M1)
  for (const s of [...sigs].reverse()) {
    if (s.err) continue
    const tx = await readParsedTransaction(conn, s.signature, { truncatedLogs: 'flag' })
    if (!tx) throw new Error(`could not read ${s.signature}; not advancing past it`)
    // ROUND 29 (M1): anyone can pad a transaction naming BURN until the runtime
    // truncates its logs, which used to stop this walk for good. Its REDEEMED
    // lines may be missing, so it is never drafted from them. One that invoked
    // BURN at the top level (a redemption must) is queued REJECTED for a human
    // to draft by hand; anything else is noise. Either way the walk continues.
    if (tx.logsTruncated) {
      if (!queued.has(`${s.signature}:*`) && tx.transaction.message.instructions.some(ix => ix.programId === BURN_PROGRAM_ID)) {
        fs.appendFileSync(QUEUE, JSON.stringify({ x: null, status: 'rejected',
          problems: ['the runtime truncated this transaction\'s logs, so its REDEEMED event could not be read; draft this redemption by hand'],
          web: { signature: s.signature, at: s.blockTime ?? null } }) + '\n')
        queued.add(`${s.signature}:*`)
        console.log(`REJECTED  ${s.signature}  (logs truncated by the runtime; draft it by hand)`)
      }
      if (!gap && !draining) st.cursor = s.signature
      continue
    }
    for (const e of parseCbobLogs(tx.meta?.logMessages || []).events.filter(e => e.type === 'REDEEMED')) {
      const recAddr = PublicKey.findProgramAddressSync([Buffer.from(L.SEEDS.vault), new PublicKey(e.asset).toBuffer()], MINT)[0]
      const rec = L.decode('VaultRecord', (await conn.getAccountInfo(recAddr, 'confirmed')).data)
      const vaultPda = PublicKey.findProgramAddressSync([Buffer.from('mpl-core-execute'), new PublicKey(e.asset).toBuffer()],
        new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'))[0].toBase58()
      const p = draftPost({ mintIndex: Number(rec.mint_index), level: rec.level,
        released: releasedFromTx(tx, vaultPda),
        blockTime: s.blockTime, signature: s.signature })
      // ONE DRAFT PER REDEMPTION (round 22, P1): a crash after the append and
      // before the cursor save re-reads the same signature next pass.
      const key = draftKey(p.web)
      if (queued.has(key) || queued.has(`${s.signature}:*`)) continue
      fs.appendFileSync(QUEUE, JSON.stringify({ ...p, status: p.problems.length ? 'rejected' : 'draft-awaiting-authorization' }) + '\n')
      queued.add(key)
      console.log(`${p.problems.length ? 'REJECTED' : 'DRAFT'}  ${p.x}${p.problems.length ? `  (${p.problems.join('; ')})` : ''}`)
      drafted++
    }
    // NEVER PAST A GAP (round 22, P1): the walk returned the NEWEST pages, and
    // advancing to them would skip the older redemptions between the old cursor
    // and the oldest one fetched. The dedupe above makes re-reading them harmless.
    // Inside a backlog the cursor waits for the backlog's head (round 30, M1).
    if (!gap && !draining) st.cursor = s.signature
  }
  if (gap && sigs.length) st.backlog = { head: draining?.head ?? sigs[0].signature, before: sigs[sigs.length - 1].signature }
  else if (!gap && draining && sigs.length) { st.cursor = draining.head; delete st.backlog }
  else if (!gap && draining) {
    // An empty resumed walk is not proof (an unknown `before` also answers
    // empty): the signature right below `before` must be the cursor, or, with no
    // cursor, `before` must resolve with nothing below it. Otherwise keep the
    // backlog and say so; never declare it drained.
    const below = await conn.getSignaturesForAddress(new PublicKey(BURN_PROGRAM_ID), { before: draining.before, limit: 1 }, 'confirmed')
    const proven = st.cursor ? below?.[0]?.signature === st.cursor
      : !!(await conn.getSignatureStatuses([draining.before], { searchTransactionHistory: true }))?.value?.[0] && below.length === 0
    if (proven) { st.cursor = draining.head; delete st.backlog }
    else console.log(`the BURN backlog resumed from ${draining.before} came back empty without reaching the cursor; it is KEPT. If this repeats, re-scan that window by hand.`)
  }
  writeLedger(STATE, st)
  console.log(`${drafted} redemption post(s) drafted to ${QUEUE}. NOTHING WAS POSTED: this job has no sender.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--selftest')) selftest()
  else main().catch(e => { console.error(`CBOB REDEMPTION POSTER FAILED: ${e.message}`); process.exit(3) })
}
