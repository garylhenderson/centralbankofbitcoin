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

export const LEVEL_NAMES = ['I', 'II', 'III', 'IV', 'V']
/** The three reserve assets and how the Bank names them. Anything else that
 *  left a vault is named by its mint, not guessed at. */
export const ASSETS = {
  cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: { name: 'BTC', decimals: 8 },
  '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk': { name: '$GARY', decimals: 9 },
  Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump: { name: '$GIRAFFISH', decimals: 6 },
}
const X_LIMIT = 280

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

/** The post. Pure, so the copy rules are proven, not hoped. */
export function draftPost({ mintIndex, level, released, blockTime, signature }) {
  if (!Number.isInteger(level) || level < 1 || level > 5) throw new Error(`level ${level} is not I..V`)
  const no = String(mintIndex).padStart(4, '0')
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
  console.log('── the copy ──')
  const p = draftPost({ mintIndex: 142, level: 3, released: rel, blockTime: 1, signature: 's' })
  t('a full redemption reads as the Bank', p.x, 'Vault No. 0142 (Level III) has been redeemed. 0.0005 BTC and 1,000 $GARY were released to its holder. The vault no longer exists.')
  t('...and passes every copy rule', p.problems, [])
  t('three assets are listed with commas and a final "and"',
    draftPost({ mintIndex: 1, level: 5, released: [{ mint: CB, amount: 21000n }, { mint: GA, amount: 1n }, { mint: GI, amount: 2000000n }] }).x,
    'Vault No. 0001 (Level V) has been redeemed. 0.00021 BTC, 0.000000001 $GARY and 2 $GIRAFFISH were released to its holder. The vault no longer exists.')
  t('an empty vault says so rather than inventing a figure', draftPost({ mintIndex: 9, level: 1, released: [] }).x,
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
  const { sigs, gap } = await signaturesSince(conn, new PublicKey(BURN_PROGRAM_ID), st.cursor)
  if (gap) console.log('more redemptions than one pass pages through; the rest are drafted next pass')
  let drafted = 0
  for (const s of [...sigs].reverse()) {
    if (s.err) continue
    const tx = await conn.getParsedTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
    if (!tx) throw new Error(`could not read ${s.signature}; not advancing past it`)
    for (const e of parseCbobLogs(tx.meta?.logMessages || []).events.filter(e => e.type === 'REDEEMED')) {
      const recAddr = PublicKey.findProgramAddressSync([Buffer.from(L.SEEDS.vault), new PublicKey(e.asset).toBuffer()], MINT)[0]
      const rec = L.decode('VaultRecord', (await conn.getAccountInfo(recAddr, 'confirmed')).data)
      const vaultPda = PublicKey.findProgramAddressSync([Buffer.from('mpl-core-execute'), new PublicKey(e.asset).toBuffer()],
        new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'))[0].toBase58()
      const p = draftPost({ mintIndex: Number(rec.mint_index), level: rec.level,
        released: releasedFrom(tx.meta.preTokenBalances, tx.meta.postTokenBalances, vaultPda),
        blockTime: s.blockTime, signature: s.signature })
      fs.appendFileSync(QUEUE, JSON.stringify({ ...p, status: p.problems.length ? 'rejected' : 'draft-awaiting-authorization' }) + '\n')
      console.log(`${p.problems.length ? 'REJECTED' : 'DRAFT'}  ${p.x}${p.problems.length ? `  (${p.problems.join('; ')})` : ''}`)
      drafted++
    }
    st.cursor = s.signature
  }
  writeLedger(STATE, st)
  console.log(`${drafted} redemption post(s) drafted to ${QUEUE}. NOTHING WAS POSTED: this job has no sender.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--selftest')) selftest()
  else main().catch(e => { console.error(`CBOB REDEMPTION POSTER FAILED: ${e.message}`); process.exit(3) })
}
