/** Public, read-only projection of Gary Club's standing orders and confirmed sales.
 * No member IDs, wallets, order IDs, review tokens or private payloads are published.
 * Quotes are indicative; settlement always revalidates the signed order and chain.
 */
import fs from 'node:fs'
import path from 'node:path'
import { PROFILES } from '../web/src/config.js'
export const ORDER_LIMIT = 5000, SALE_LIMIT = 200, RECEIPT_BUDGET = 24
const assetId = value => typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
const signatureId = value => typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value)
const price = value => typeof value === 'string' && /^[1-9][0-9]{0,14}$/.test(value)
const validTime = value => Number.isSafeInteger(value) && value > 0
const seconds = value => Math.floor(Date.parse(value) / 1000)

export function projectMarket({ orders, receipts, times, vaults, now, tradingEnabled, salesTruncated = false }) {
  if (!validTime(now) || orders.length > ORDER_LIMIT || receipts.length > SALE_LIMIT) throw Error('Market input exceeds its bounds')
  const live = new Map(vaults.filter(v => v.status !== 'opened').map(v => [v.asset, v]))
  const listings = [], offerCounts = new Map(), seen = new Set()
  for (const row of orders) {
    if (!assetId(row.asset) || !price(row.price_lamports) || !['listing','offer'].includes(row.kind)) throw Error('Invalid order record')
    if (row.status !== 'active' || !(seconds(row.expires_at) > now) || !live.has(row.asset)) continue
    if (row.kind === 'listing') {
      if (row.wallet !== live.get(row.asset).owner) continue
      if (seen.has(row.asset)) throw Error('Duplicate listing')
      seen.add(row.asset)
      listings.push({ asset: row.asset, price_lamports: row.price_lamports, expires_at: seconds(row.expires_at) })
    } else {
      if (row.wallet === live.get(row.asset).owner) continue
      const entries = offerCounts.get(row.asset) || []
      entries.push(seconds(row.expires_at)); offerCounts.set(row.asset, entries)
    }
  }
  const sales = [], signatures = new Set()
  for (const row of receipts) {
    if (!assetId(row.asset) || !price(row.price_lamports) || !signatureId(row.signature)) throw Error('Invalid sale receipt')
    if (row.status !== 'complete' || !['trade','buy_order','accept_offer'].includes(row.action)) continue
    if (signatures.has(row.signature)) continue
    signatures.add(row.signature)
    const time = times[row.signature]
    if (!validTime(time) || time > now + 30) continue
    sales.push({ asset: row.asset, price_lamports: row.price_lamports, signature: row.signature, sold_at: time })
  }
  sales.sort((a,b) => b.sold_at - a.sold_at || a.signature.localeCompare(b.signature))
  return { version: 1, generated_at: now, trading_enabled: tradingEnabled === true,
    listings, offers: [...offerCounts].map(([asset, expires_at]) => ({ asset, expires_at })), sales,
    sales_limit: SALE_LIMIT, sales_partial: salesTruncated || sales.length < signatures.size }
}

/** A successful confirmed transaction supplies the sale time; review time is not sale time. */
export function confirmedSaleTime(tx, signature, now) {
  if (!tx || !tx.meta || tx.meta.err !== null || tx.transaction?.signatures?.[0] !== signature || !validTime(tx.blockTime) || tx.blockTime > now + 30) return null
  return tx.blockTime
}

/** PostgREST can cap a page. Exact content ranges keep an incomplete book from looking complete. */
export async function readRows(fetchPage, { max, pageSize = 500, truncate = false }) {
  const rows = [], ids = new Set(); let total = null
  do {
    const { data, range } = await fetchPage(rows.length, Math.min(pageSize, max - rows.length))
    const m = /^(?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(range || '')
    if (!m || !Array.isArray(data)) throw Error('Incomplete market response')
    const count = Number(m[3])
    if (!Number.isSafeInteger(count) || (total !== null && total !== count) || (!truncate && count > max)) throw Error('Market count changed or exceeded limit')
    total = count
    if (data.length !== (m[1] === undefined ? 0 : Number(m[2]) - Number(m[1]) + 1) || (data.length && Number(m[1]) !== rows.length) || data.length > Math.min(pageSize, max - rows.length) || (!data.length && rows.length < Math.min(total,max))) throw Error('Incomplete market page')
    for (const row of data) { if (!row.id || ids.has(row.id)) throw Error('Duplicate market row'); ids.add(row.id); rows.push(row) }
  } while (rows.length < Math.min(total, max))
  if (rows.length !== Math.min(total, max)) throw Error('Incomplete market book')
  return { rows, truncated: total > max }
}

const atomic = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive:true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value)); fs.renameSync(tmp,file) }
export async function publishMarket(site, { cacheFile = '/opt/cbob-vaults/.cache/market-sale-times.json' } = {}) {
  const env = fs.readFileSync('/opt/gary-club/.env.local','utf8')
  const setting = name => env.match(new RegExp(`^${name}=(.*)$`,'m'))?.[1]?.trim().replace(/^["']|["']$/g,'')
  const base = setting('NEXT_PUBLIC_SUPABASE_URL'), key = setting('SUPABASE_SERVICE_ROLE_KEY'), rpc = setting('HELIUS_RPC_URL')
  // Fixed destination prevents an accidental environment change leaking the service credential.
  if (!['https://db.gary.club','https://zwyoyilmlpjkuukziacf.supabase.co'].includes(base) || !key || !rpc) throw Error('Market data configuration unavailable')
  const now = Math.floor(Date.now()/1000)
  const register = JSON.parse(fs.readFileSync(`${site}/data/vaults.json`,'utf8'))
  if (!validTime(register.generated_at) || now-register.generated_at > 1800 || register.generated_at > now+30 || !Array.isArray(register.vaults)) throw Error('Market needs a fresh vault register')
  const read = async (table, query, options) => readRows(async (offset, limit) => {
    const url = new URL(`${base}/rest/v1/${table}`)
    for (const [key,value] of Object.entries({...query, offset:String(offset), limit:String(limit)})) url.searchParams.set(key,value)
    const res = await fetch(url, { headers:{apikey:key,Authorization:`Bearer ${key}`,Prefer:'count=exact'}, redirect:'error', signal:AbortSignal.timeout(15000) })
    if (!res.ok) throw Error('Market database unavailable')
    return {data:await res.json(),range:res.headers.get('content-range')}
  },options)
  const [orders,receipts] = await Promise.all([
    read('gc_cbob_orders',{ select:'id,asset,kind,wallet,price_lamports,status,expires_at',status:'eq.active',expires_at:`gt.${new Date(now*1000).toISOString()}`,order:'id.asc' },{max:ORDER_LIMIT}),
    read('gc_cbob_intents',{ select:'id,asset,action,status,signature,price_lamports:summary->details->>price_lamports',status:'eq.complete',action:'in.(trade,buy_order,accept_offer)',order:'created_at.desc,id.desc' },{max:SALE_LIMIT,truncate:true}),
  ])
  const previous = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile,'utf8')) : {}
  const times = {}; let budget = RECEIPT_BUDGET
  const rpcRead = async (method, params) => {
    const res = await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),redirect:'error',signal:AbortSignal.timeout(5000)})
    if (!res.ok) throw Error('Sale transaction provider unavailable')
    const body=await res.json()
    if (body.error) throw Error('Sale transaction read unavailable')
    return body.result
  }
  if(receipts.rows.some(row=>!validTime(previous[row.signature]))) {
    if(await rpcRead('getGenesisHash',[])!==PROFILES.mainnet.expectedGenesisHash)throw Error('Market transaction provider is not mainnet')
  }
  for (const row of receipts.rows) {
    if (!signatureId(row.signature)) throw Error('Invalid sale signature')
    if (validTime(previous[row.signature]) && previous[row.signature] <= now+30) { times[row.signature] = previous[row.signature]; continue }
    if (budget <= 0) continue
    budget--
    try {
      const tx=await rpcRead('getTransaction',[row.signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:0}]), time=confirmedSaleTime(tx,row.signature,now)
      if (time) times[row.signature]=time
    } catch { /* Retain proven receipts; unavailable transactions never become sales. */ }
  }
  const market = projectMarket({orders:orders.rows,receipts:receipts.rows,times,vaults:register.vaults,now,tradingEnabled:setting('CBOB_PORTAL_TRADING_ENABLED')==='1',salesTruncated:receipts.truncated})
  atomic(cacheFile,times); atomic(`${site}/data/market.json`,market)
  console.log(`Market return: ${market.listings.length} recorded asks, ${market.sales.length} confirmed sale receipts.`)
}
