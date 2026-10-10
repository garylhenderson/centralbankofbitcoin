#!/usr/bin/env node
// THE VAULT INDEX: what the public vault gallery shows (Gary 2026-10-10: "it should be
// visual and like a built in marketplace ... browse vaults, filter, sort, see only yours,
// see opened vaults to track + or - had they waited ... Existing vaults we should show
// performance").
//
// READ-ONLY. It never signs and never sends; it holds no key. Every 10 minutes (cron) it
// reads every vault from the chain, prices what each holds, and writes the public JSON the
// gallery page renders:
//   <site>/data/vaults.json   every vault: number, level, status, owner, deposit address,
//                             reserves, their value now, the share it is owed, its boost;
//                             each OPENED vault with what it paid out, that payout's value
//                             when the index first saw it and now ("had they waited").
//   <site>/data/history.json  hourly prices and totals, and each vault's value by day.
// State on the box (.cache/vault-index/): the opened ledger, so a payout's value at opening
// is fixed once and never re-priced.
//
// PRICES. cbBTC is priced at BTC/USD from Pyth on chain (bank/swap.mjs readPyth, the same
// fully verified, fresh read the swap trusts). $GARY and $GIRAFFISH come from the platform's
// warehouse (/v1/token/:mint price_usd), the one source gary.club's own price modules use
// (gary-price.ts, giraffish-price.ts). A price that cannot be read is null and every value
// that needs it is null; nothing is guessed.
//
// Usage: node bank/vault-index.mjs              one run (cron)
//        node bank/vault-index.mjs --dry        one run, print, write nothing
//        node bank/vault-index.mjs --selftest   the pure parts, both ways
import fs from 'fs'
import path from 'path'
import { scanLedger, emptyTotals } from './market-ledger.mjs'
import { readParsedTransaction } from './txread.mjs'
import { bankTotals } from '../web/src/lib/ecosystem.mjs'

export const RESERVES = [
  { sym: 'cbBTC', mint: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', decimals: 8 },
  { sym: 'GARY', mint: '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk', decimals: 9 },
  { sym: 'GIRAFFISH', mint: 'Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump', decimals: 6 },
]
export const LEVEL_CAPS = [945, 525, 315, 210, 105]
const ROOT = '/opt/cbob-vaults'
const SITE = process.env.CBOB_SITE_ROOT || '/var/www/centralbankofbitcoin'
const STATE_DIR = `${ROOT}/.cache/vault-index`
const HISTORY_DAYS = 400

// ── THE PURE PART ──

/** A whole-unit amount (bigint or string of base units) as a decimal number of tokens. */
export const toUi = (raw, decimals) => Number(BigInt(raw ?? 0)) / 10 ** decimals

/** USD value of holdings {sym: raw} at prices {sym: usd|null}. Null if any HELD token has no price. */
export function valueUsd(holdings, prices) {
  let sum = 0
  for (const r of RESERVES) {
    const raw = BigInt(holdings?.[r.sym] ?? 0)
    if (raw === 0n) continue
    const p = prices?.[r.sym]
    if (!Number.isFinite(p) || !(p > 0)) return null
    sum += toUi(raw, r.decimals) * p
  }
  return Math.round(sum * 100) / 100
}

/** A vault's status from its MINT record and its Core asset. */
export function statusOf(record, asset) {
  if (!record) return 'unrecorded'
  if (record.retired || asset?.burned) return 'opened'
  if (record.active) return 'earning'
  if (record.pending) return 'joining'
  if (!record.level) return 'unrevealed'
  return 'sealed'
}

/** The opened entry, priced ONCE when first seen; `now` re-prices the same payout. */
export function openedEntry({ asset, record, released, seenAtSec, prices }) {
  const holdings = {}
  for (const x of released || []) { const r = RESERVES.find(y => y.mint === x.mint); if (r) holdings[r.sym] = String(BigInt(holdings[r.sym] ?? 0) + BigInt(x.amount)) }
  return { asset, no: Number(record.mint_index) + 1, level: record.level, paid: holdings, seen_at: seenAtSec, value_at_open_usd: valueUsd(holdings, prices) }
}

/** "Had they waited": the same payout at today's prices, against its value at opening. */
export function hadTheyWaited(entry, pricesNow) {
  const now = valueUsd(entry.paid, pricesNow)
  if (now === null || entry.value_at_open_usd === null) return { value_now_usd: now, delta_usd: null, delta_pct: null }
  const d = Math.round((now - entry.value_at_open_usd) * 100) / 100
  return { value_now_usd: now, delta_usd: d, delta_pct: entry.value_at_open_usd > 0 ? Math.round(d / entry.value_at_open_usd * 10000) / 100 : null }
}

/** The public index. Inputs are plain data; nothing here reads the chain. */
export function buildIndex({ nowSec, collection, mintConfig, charterOpensAt, vaults, opened, prices, poolSats = null }) {
  const live = vaults.filter(v => v.status !== 'opened')
  const levels = LEVEL_CAPS.map((cap, i) => ({ level: i + 1, cap, minted: vaults.filter(v => v.level === i + 1).length, live: live.filter(v => v.level === i + 1).length }))
  const total = live.reduce((s, v) => (s === null || v.value_usd === null ? null : s + v.value_usd), 0)
  return {
    generated_at: nowSec, collection: collection || null, open: !!collection,
    charter_opens_at: charterOpensAt ?? null,
    prices: { ...prices }, levels,
    bank: { ...bankTotals(vaults.map(v => ({ ...v, opened: opened[v.asset] })), mintConfig, poolSats), ...(!mintConfig ? { financial: { coverage: 'complete', ...emptyTotals() } } : {}) },
    totals: { minted: vaults.length, live: live.length, opened: vaults.length - live.length, value_usd: total === null ? null : Math.round(total * 100) / 100,
      dist_epoch: mintConfig ? Number(mintConfig.dist_epoch) : null },
    vaults: vaults.map(v => ({ ...v, ...(v.status === 'opened' && opened[v.asset] ? { opened: { ...opened[v.asset], ...hadTheyWaited(opened[v.asset], prices) } } : {}) })),
  }
}

/** History: one row per hour (prices and totals) and each live vault's value per day. */
export function mergeHistory(prev, index) {
  const h = prev && Array.isArray(prev.hourly) ? prev : { hourly: [], daily: {} }
  const hour = Math.floor(index.generated_at / 3600) * 3600, day = Math.floor(index.generated_at / 86400)
  const row = { t: hour, prices: index.prices, value_usd: index.totals.value_usd, live: index.totals.live, bank: index.bank }
  const hourly = h.hourly.filter(r => r.t !== hour).concat([row]).filter(r => r.t > hour - HISTORY_DAYS * 86400).sort((a, b) => a.t - b.t)
  const daily = { ...h.daily }
  for (const v of index.vaults) {
    if (v.status === 'opened' || v.value_usd === null) continue
    const pts = (daily[v.asset] || []).filter(p => p[0] !== day && p[0] > day - HISTORY_DAYS)
    pts.push([day, v.value_usd]); daily[v.asset] = pts.sort((a, b) => a[0] - b[0])
  }
  return { hourly, daily }
}

// ── THE READING PART (cron) ──

async function rpcUrl() {
  const m = fs.readFileSync('/opt/gary-club/.env.local', 'utf8').match(/^HELIUS_RPC_URL=(.*)$/m)
  if (!m) throw new Error('HELIUS_RPC_URL is not set')
  return m[1].trim().replace(/^["']|["']$/g, '')
}
async function warehousePrice(mint) {
  const env = fs.readFileSync('/opt/gary-club/.env.local', 'utf8')
  const key = (env.match(/^SDN_GATEWAY_KEY=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '')
  const base = ((env.match(/^SDN_GATEWAY_URL=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '') || 'http://199.127.60.180:8080').replace(/\/+$/, '')
  if (!key) return null
  try {
    const r = await fetch(`${base}/v1/token/${mint}`, { headers: { 'x-api-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
    const j = await r.json(); const p = Number(j?.price_usd ?? j?.data?.price_usd)
    return p > 0 ? p : null
  } catch { return null }
}
async function btcUsd(conn) {
  const { PYTH, pythAccount, readPyth } = await import('./swap.mjs')
  try {
    const acc = await conn.getAccountInfo(pythAccount(PYTH.BTC_USD), 'confirmed')
    const p = readPyth(acc, PYTH.BTC_USD)
    if (Date.now() / 1000 - p.publishTime > 600 || p.publishTime > Date.now() / 1000 + 30 || p.price <= 0n || p.conf * 10000n > p.price * 100n) return null
    return Number(p.price) * 10 ** p.expo
  } catch { return null }
}

async function collect() {
  const { Connection, PublicKey } = await import('@solana/web3.js')
  const { PROFILES } = await import('../web/src/config.js')
  const { makeIds, ata, TOKEN_PROGRAM } = await import('../web/src/lib/ids.mjs')
  const { parseCoreAsset, parseTokenAccount, absentIfDust } = await import('../web/src/lib/decode.mjs')
  const { owedSats } = await import('../web/src/lib/plan-redeem.mjs')
  const L = await import('./layout.mjs')
  const { releasedFromTx } = await import('./redemption-poster.mjs')
  const conn = new Connection(await rpcUrl(), 'confirmed')
  if (await conn.getGenesisHash() !== PROFILES.mainnet.expectedGenesisHash) throw new Error('Index connection is not mainnet')
  const ids = makeIds(PROFILES.mainnet)
  const launch = JSON.parse(fs.readFileSync(`${ROOT}/launch/mainnet-init.json`, 'utf8'))
  const nowSec = Math.floor(Date.now() / 1000)
  const prices = { cbBTC: await btcUsd(conn), GARY: await warehousePrice(RESERVES[1].mint), GIRAFFISH: await warehousePrice(RESERVES[2].mint) }
  const cfgAcc = absentIfDust(await conn.getAccountInfo(ids.MINT_CFG, 'confirmed'))
  if (cfgAcc && !cfgAcc.owner.equals(ids.MINT_PROG)) throw new Error('Invalid MINT configuration owner')
  let mintConfig = cfgAcc ? L.decode('MintConfig', cfgAcc.data) : null
  if (ids.COLL && !mintConfig) throw new Error('The initialized Bank configuration is unavailable')
  if (!ids.COLL || !mintConfig) return { index: buildIndex({ nowSec, collection: null, mintConfig, charterOpensAt: launch.charter_opens_at?.value, vaults: [], opened: {}, prices }), newOpened: {} }
  // every vault record MINT holds (the discriminator is the filter)
  const { createHash } = await import('crypto')
  const disc = createHash('sha256').update('account:VaultRecord').digest().subarray(0, 8)
  const bs58 = (await import('bs58')).default
  const recs = await conn.getProgramAccounts(ids.MINT_PROG, { commitment: 'confirmed', filters: [{ memcmp: { offset: 0, bytes: bs58.encode(disc) } }] })
  const records = recs.map(r => L.decode('VaultRecord', r.account.data))
  const chunk = (a, n) => a.length ? [a.slice(0, n), ...chunk(a.slice(n), n)] : []
  const assets = {}, balances = {}
  for (const part of chunk(records, 100)) {
    const infos = await conn.getMultipleAccountsInfo(part.map(r => new PublicKey(r.asset)), 'confirmed')
    part.forEach((r, i) => {
      if (!infos[i]) { if (!r.retired) throw new Error('A live vault asset is unavailable'); assets[r.asset] = { burned: true }; return }
      if (!infos[i].owner.equals(ids.CORE)) throw new Error('Invalid Core asset owner')
      assets[r.asset] = parseCoreAsset(infos[i].data)
      if (!assets[r.asset].burned && assets[r.asset].collection !== ids.COLL.toBase58()) throw new Error('Invalid vault collection')
    })
  }
  const live = records // Retired deposit addresses may still hold stranded reserves.
  const mintAccounts = await conn.getMultipleAccountsInfo(RESERVES.map(r => new PublicKey(r.mint)), 'confirmed')
  if (mintAccounts.some(a => !a || !a.owner.equals(TOKEN_PROGRAM))) throw new Error('A reserve mint has an unexpected token program')
  const ataList = live.flatMap(r => RESERVES.map(x => [r.asset, x.sym, ata(ids.depositAddress(r.asset), new PublicKey(x.mint))]))
  for (const part of chunk(ataList, 100)) {
    const infos = await conn.getMultipleAccountsInfo(part.map(p => p[2]), 'confirmed')
    part.forEach(([asset, sym], i) => {
      const a = absentIfDust(infos[i]), token = a ? parseTokenAccount(a.data) : null
      if (a && (!a.owner.equals(TOKEN_PROGRAM) || token.owner !== ids.depositAddress(asset).toBase58() || token.mint !== RESERVES.find(r => r.sym === sym).mint)) throw new Error('Invalid reserve token account')
      ;(balances[asset] ||= {})[sym] = token ? String(token.amount) : '0'
    })
  }
  const [freshCfg, poolAcc] = await conn.getMultipleAccountsInfo([ids.MINT_CFG, new PublicKey(mintConfig.pool_ata)], 'confirmed')
  if (!freshCfg || !freshCfg.owner.equals(ids.MINT_PROG) || !poolAcc || !poolAcc.owner.equals(TOKEN_PROGRAM)) throw new Error('The pool snapshot is unavailable')
  mintConfig = L.decode('MintConfig', freshCfg.data)
  const pool = parseTokenAccount(poolAcc.data)
  if (pool.mint !== mintConfig.payment_mint) throw new Error('Invalid pool payment mint')
  const poolSats = String(pool.amount)
  const vaults = records.map(r => {
    const a = assets[r.asset], status = statusOf(r, a)
    const holdings = status === 'opened' ? {} : (balances[r.asset] || {})
    return { asset: r.asset, no: Number(r.mint_index) + 1, level: r.level || null, charter: !!r.charter, status,
      owner: a && !a.burned ? a.owner : null, deposit: ids.depositAddress(r.asset).toBase58(), reserves: holdings, stranded: status === 'opened' ? balances[r.asset] : null,
      value_usd: status === 'opened' ? null : valueUsd(holdings, prices), owed_sats: String(owedSats(r, mintConfig)),
      boost: r.boost_weight ? { weight: r.boost_weight, until_epoch: Number(r.boost_end_epoch) } : null }
  })
  // the opened ledger: priced once, when first seen
  fs.mkdirSync(STATE_DIR, { recursive: true })
  const ledgerFile = `${STATE_DIR}/opened.json`
  const opened = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : {}
  const financialFile = `${STATE_DIR}/financial.json`
  let financialState = null, financial = { coverage: 'unavailable' }
  try {
    const prior = fs.existsSync(financialFile) ? JSON.parse(fs.readFileSync(financialFile, 'utf8')) : null
    const scanned = await scanLedger(conn, ids, new PublicKey(mintConfig.payment_mint), prior)
    financialState = scanned.state; financial = scanned.financial
  } catch { /* Retain old public values with an explicit coverage gap. */ }
  const histFile = `${SITE}/data/history.json`
  const historical = fs.existsSync(histFile) ? JSON.parse(fs.readFileSync(histFile, 'utf8')).hourly || [] : []
  const newOpened = {}
  for (const v of vaults.filter(v => v.status === 'opened' && (!opened[v.asset] || opened[v.asset].coverage === 'unavailable'))) {
    const rec = records.find(r => r.asset === v.asset), retirement = financialState?.retirements?.[v.asset]
    let released = [], found = false
    if (retirement?.redeemed) {
      try { const tx = await readParsedTransaction(conn, retirement.signature); if (tx && !tx.meta?.err) { released = releasedFromTx(tx, v.deposit); found = true } } catch { /* retry next pass */ }
    }
    const blockTime = retirement?.block_time
    const past = historical.filter(row => row.t <= blockTime && blockTime - row.t <= 3600).sort((a,b) => b.t - a.t)[0]
    const entry = openedEntry({ asset: v.asset, record: rec, released, seenAtSec: nowSec, prices: past?.prices || {} })
    newOpened[v.asset] = { ...entry, coverage: retirement && !retirement.redeemed ? 'bare_burn' : found ? 'observed' : 'unavailable', signature: retirement?.signature || null, block_time: blockTime || null,
      value_at_open_usd: found && past ? entry.value_at_open_usd : null, price_observed_at: past?.t || null }
  }
  const index = buildIndex({ nowSec, collection: ids.COLL.toBase58(), mintConfig, charterOpensAt: launch.charter_opens_at?.value, vaults, opened: { ...opened, ...newOpened }, prices, poolSats })
  index.bank.financial = financial
  return { index, newOpened, ledgerFile, opened, financialFile, financialState }
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp.${process.pid}`, data); fs.renameSync(`${file}.tmp.${process.pid}`, file)
}

export async function run({ dry }) {
  const { index, newOpened, ledgerFile, opened, financialFile, financialState } = await collect()
  if (dry) { console.log(JSON.stringify({ ...index, vaults: index.vaults.slice(0, 3) }, null, 1)); return }
  if (ledgerFile && Object.keys(newOpened).length) writeAtomic(ledgerFile, JSON.stringify({ ...opened, ...newOpened }))
  if (financialState) writeAtomic(financialFile, JSON.stringify(financialState))
  const histFile = `${SITE}/data/history.json`
  const prev = fs.existsSync(histFile) ? JSON.parse(fs.readFileSync(histFile, 'utf8')) : null
  writeAtomic(`${SITE}/data/vaults.json`, JSON.stringify(index))
  writeAtomic(histFile, JSON.stringify(mergeHistory(prev, index)))
  console.log(`${new Date().toISOString()} vaults ${index.totals.minted} (live ${index.totals.live}, opened ${index.totals.opened}) value ${index.totals.value_usd} prices ${JSON.stringify(index.prices)}`)
}

function selftest() {
  let ok = 0, bad = 0
  const t = (name, got, want) => { const pass = JSON.stringify(got) === JSON.stringify(want); pass ? ok++ : bad++; console.log(`  ${pass ? 'ok ' : 'XX '} ${name}${pass ? '' : `\n        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`) }
  const P = { cbBTC: 100000, GARY: 0.01, GIRAFFISH: 0.002 }
  t('value: 0.5 cbBTC + 1,000 $GARY + 10,000 $GIRAFFISH at the given prices', valueUsd({ cbBTC: '50000000', GARY: '1000000000000', GIRAFFISH: '10000000000' }, P), 50000 + 10 + 20)
  t('value: a held token with no price is NO value (null), never a partial sum', valueUsd({ cbBTC: '1', GARY: '5' }, { ...P, GARY: null }), null)
  t('value: a token NOT held needs no price', valueUsd({ cbBTC: '100000000' }, { ...P, GARY: null, GIRAFFISH: null }), 100000)
  t('value: nothing held is $0', valueUsd({}, P), 0)
  t('status: retired or burned is opened; active earning; pending joining; level 0 unrevealed; else sealed',
    [statusOf({ retired: true }, {}), statusOf({ retired: false }, { burned: true }), statusOf({ active: true, level: 2 }, {}), statusOf({ pending: true, level: 2 }, {}), statusOf({ level: 0 }, {}), statusOf({ level: 3 }, {}), statusOf(null, {})],
    ['opened', 'opened', 'earning', 'joining', 'unrevealed', 'sealed', 'unrecorded'])
  const e = openedEntry({ asset: 'A', record: { mint_index: 41n, level: 3 }, released: [{ mint: RESERVES[0].mint, amount: 1000000n }, { mint: RESERVES[0].mint, amount: 500000n }, { mint: 'So11111111111111111111111111111111111111112', amount: 9n }], seenAtSec: 7, prices: P })
  t('opened: the payout summed per reserve, numbered from one, valued at opening; SOL rent is not a reserve',
    [e.no, e.paid, e.value_at_open_usd], [42, { cbBTC: '1500000' }, 1500])
  t('had they waited: BTC up 10% -> +$150 (+10%)', hadTheyWaited(e, { ...P, cbBTC: 110000 }), { value_now_usd: 1650, delta_usd: 150, delta_pct: 10 })
  t('had they waited: BTC down 20% -> -$300 (-20%)', hadTheyWaited(e, { ...P, cbBTC: 80000 }), { value_now_usd: 1200, delta_usd: -300, delta_pct: -20 })
  t('had they waited: no price now -> no delta (never a guess)', hadTheyWaited(e, { ...P, cbBTC: null }), { value_now_usd: null, delta_usd: null, delta_pct: null })
  const vs = [{ asset: 'A', level: 3, status: 'opened', value_usd: null }, { asset: 'B', level: 1, status: 'earning', value_usd: 100 }, { asset: 'C', level: 1, status: 'sealed', value_usd: 50.5 }]
  const ix = buildIndex({ nowSec: 3600 * 30, collection: 'COLL', mintConfig: { dist_epoch: 4n }, charterOpensAt: 9, vaults: vs, opened: { A: e }, prices: { ...P, cbBTC: 110000 } })
  t('index: totals count live and opened, value only the live ones; per level minted and live',
    [ix.totals, ix.levels[0], ix.levels[2]], [{ minted: 3, live: 2, opened: 1, value_usd: 150.5, dist_epoch: 4 }, { level: 1, cap: 945, minted: 2, live: 2 }, { level: 3, cap: 315, minted: 1, live: 0 }])
  t('index: the opened vault carries its payout and "had they waited"', [ix.vaults[0].opened?.delta_usd, ix.vaults[1].opened], [150, undefined])
  t('index: one live vault with no value makes the total null (never understated)', buildIndex({ nowSec: 0, collection: 'C', mintConfig: null, vaults: [{ asset: 'X', status: 'sealed', value_usd: null, level: 1 }], opened: {}, prices: P }).totals.value_usd, null)
  t('index: before step 10 (no collection) it is not open and lists nothing', (i => [i.open, i.vaults.length, i.charter_opens_at])(buildIndex({ nowSec: 0, collection: null, mintConfig: null, charterOpensAt: 123, vaults: [], opened: {}, prices: P })), [false, 0, 123])
  const h1 = mergeHistory(null, ix), h2 = mergeHistory(h1, { ...ix, generated_at: ix.generated_at + 60 }), h3 = mergeHistory(h2, { ...ix, generated_at: ix.generated_at + 3600 })
  t('history: one row per hour (a second run in the same hour replaces it), live vaults by day, opened ones not',
    [h2.hourly.length, h3.hourly.length, Object.keys(h3.daily).sort(), h3.daily.B.length], [1, 2, ['B', 'C'], 1])
  const FLOOR = 14   // EQUAL, as every selftest here: deleting an arm fails too
  console.log(`\n${ok}/${ok + bad} vault-index assertions as predicted`)
  if (ok + bad !== FLOOR) console.log(`${ok + bad} vault-index assertions ran; the floor says ${FLOOR}. They must be EQUAL.`)
  process.exit(bad || ok + bad !== FLOOR ? 1 : 0)
}

const args = process.argv.slice(2)
if (args.includes('--selftest')) selftest()
else if (import.meta.url === `file://${process.argv[1]}`) await run({ dry: args.includes('--dry') })
