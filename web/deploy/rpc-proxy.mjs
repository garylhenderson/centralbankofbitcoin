#!/usr/bin/env node
/**
 * THE SAME-ORIGIN RPC PROXY behind https://centralbankofbitcoin.com/rpc
 * (Gary, 2026-10-07). STAGED, NOT INSTALLED: web/README.md, "Enabling the RPC
 * proxy", says how. nginx alone cannot read a request body to allowlist JSON-RPC
 * methods, so this small Node process does it, and nginx in front of it does TLS,
 * the per-IP rate limit and the body cap (web/deploy/nginx-rpc.conf).
 *
 *   * The upstream URL (with its provider key) comes ONLY from the environment,
 *     loaded from a mode-600 file the operator fills (never the repo):
 *       node --env-file=/etc/cbob/rpc-proxy.env web/deploy/rpc-proxy.mjs
 *     CBOB_RPC_UPSTREAM=https://...      (required)
 *     CBOB_DAS_UPSTREAM=https://...      (optional; DAS methods go here, else to the above)
 *     CBOB_RPC_ORIGIN=https://centralbankofbitcoin.com   (the only Origin accepted)
 *     CBOB_RPC_PORT=8789                 (loopback only)
 *     CBOB_VAULT_COLLECTION=<address>    (required: collection and DAS group queries are limited to it)
 *     The URL is never logged or echoed: errors name the upstream's HOST at most.
 *   * POST only, application/json only, at most 16 KB, a batch of at most 8.
 *   * EXACTLY the JSON-RPC methods the pages call (web/test/proxy.test.mjs proves
 *     the list equals what web/src calls); getProgramAccounts only in the five
 *     exact filtered shapes the pages send (filter for filter, byte for byte);
 *     sendTransaction / simulateTransaction only for transactions that call the
 *     programs the pages use.
 *   * Same-origin only: no CORS headers are ever sent; a request whose Origin is
 *     not the site, or that carries NO Origin (curl, a script), is refused, and so
 *     is OPTIONS. (A non-browser client can forge an Origin; the method, shape and
 *     transaction rules and the rate limits are what bound it.)
 *   * A second, per-IP rate limit here (nginx has the first), IPv6 keyed by /64,
 *     stricter for sendTransaction, simulateTransaction and getProgramAccounts.
 *   * The upstream response is capped at 8 MB WHILE it streams in.
 */
import http from 'http'
import { fileURLToPath } from 'url'
import { PublicKey, VersionedTransaction, Message } from '@solana/web3.js'
import bs58 from 'bs58'

export const CORE = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
export const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
export const MINT = 'Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo'
/** MINT's ["mint"] PDA: the update authority of the vault collection. */
export const MINT_AUTH = PublicKey.findProgramAddressSync([Buffer.from('mint')], new PublicKey(MINT))[0].toBase58()
/** sha256("account:VaultRecord")[0..8] in base58. */
export const VAULT_RECORD_DISC_B58 = '8s2gvH1XffL'
export const MAX_BODY = 16 * 1024, MAX_BATCH = 8, MAX_RESPONSE = 8 * 1024 * 1024
/** The programs a transaction sent or simulated through here may call. */
export const TX_PROGRAMS = new Set(['9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273', MINT, '8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8',
  '2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2', 'EB2uVvsaThLp4PWt3LwAWveTCa9ZynPVbWzZfUhMf2aa', CORE,
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', '11111111111111111111111111111111',
  'ComputeBudget111111111111111111111111111111',
  // Round 46: Phantom adds Lighthouse guard assertions to the ceremony's transactions
  'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'])

/** Every JSON-RPC method the pages send (web3 Connection names). */
export const ALLOWED = new Set(['getAccountInfo', 'getMultipleAccounts', 'getProgramAccounts', 'getSlot', 'getSignaturesForAddress', 'getTransaction',
  'getBlockHeight', 'getGenesisHash', 'getLatestBlockhash', 'getMinimumBalanceForRentExemption', 'getFeeForMessage', 'simulateTransaction',
  'sendTransaction', 'getSignatureStatuses', 'getAssetsByOwner', 'getAssetsByGroup', 'getTokenAccountsByOwner'])
const DAS = new Set(['getAssetsByOwner', 'getAssetsByGroup'])
/** Per-IP buckets: [refill per second, burst]. */
export const LIMITS = { default: [10, 60], sendTransaction: [1, 5], simulateTransaction: [3, 15], getProgramAccounts: [2, 12], getTokenAccountsByOwner: [2, 12], getSignaturesForAddress: [2, 12], getTransaction: [2, 12] }

const isSig = b => { try { return typeof b === 'string' && bs58.decode(b).length === 64 } catch { return false } }
const is32 = b => { try { return typeof b === 'string' && bs58.decode(b).length === 32 } catch { return false } }

/**
 * getProgramAccounts: ONLY the five exact shapes the pages send, filter for filter,
 * value for value (a 1-byte or empty "owner" filter would match a slice of all Core).
 *   (round 46: a vault wallet's token accounts are no longer read here: our RPC
 *   refuses getProgramAccounts on Token-2022, so they are getTokenAccountsByOwner,
 *   one owner, one token program, ONLY the 8-byte balance; see tokenListingShape)
 *   core-owner      Core AssetV1 owned by one 32-byte address, addresses only
 *   core-collection Core AssetV1 in THE vault collection, addresses only
 *   core-mint-coll  Core CollectionV1 whose update authority is MINT's PDA, addresses only
 *   mint-waiting    MINT vault records with pending = 1
 *   mint-boosts     every MINT vault record, ONLY bytes 125..195 (active, retired,
 *                   boost weight and end), to find the boosts a payout must expire
 */
export function gpaShape(prog, cfg, collection, ps = MAINNET_SET) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null
  if (Object.keys(cfg).some(k => !['commitment', 'encoding', 'dataSlice', 'filters'].includes(k))) return null
  if (cfg.encoding !== undefined && cfg.encoding !== 'base64') return null
  const f = cfg.filters
  const isSize = x => Object.keys(x).length === 1 && x.dataSize === 165
  if (!Array.isArray(f) || f.some(x => !x || typeof x !== 'object' || (!isSize(x) && (Object.keys(x).length !== 1 || !x.memcmp || typeof x.memcmp.offset !== 'number'
    || typeof x.memcmp.bytes !== 'string' || Object.keys(x.memcmp).some(k => !['offset', 'bytes', 'encoding'].includes(k))
    || (x.memcmp.encoding !== undefined && x.memcmp.encoding !== 'base58'))))) return null
  const sized = f.filter(x => x.dataSize !== undefined).length
  if (sized > 1) return null
  const m = f.filter(x => x.memcmp).map(x => [x.memcmp.offset, x.memcmp.bytes])
  const exactly = want => m.length === want.length && want.every(([o, test]) => m.filter(([mo]) => mo === o).length === 1 && test(m.find(([mo]) => mo === o)[1]))
  const ds = cfg.dataSlice
  const slice = (o, l) => !!ds && typeof ds === 'object' && Object.keys(ds).length === 2 && ds.offset === o && ds.length === l
  const noData = slice(0, 0)
  if (sized) return null
  if (prog === CORE && noData) {
    if (exactly([[0, b => b === '2'], [1, is32]])) return 'core-owner'
    if (collection && exactly([[0, b => b === '2'], [33, b => b === '3'], [34, b => b === collection]])) return 'core-collection'
    if (exactly([[0, b => b === '6'], [1, b => b === ps.MINT_AUTH]])) return 'core-mint-coll'
  }
  if (prog === ps.MINT && ds === undefined && exactly([[0, b => b === VAULT_RECORD_DISC_B58], [177, b => b === '2']])) return 'mint-waiting'
  if (prog === ps.MINT && ds && Object.keys(ds).length === 2 && ds.offset === 125 && ds.length === 70 && exactly([[0, b => b === VAULT_RECORD_DISC_B58]])) return 'mint-boosts'
  return null
}

/** getTokenAccountsByOwner (round 46, the vault wallet's token accounts): EXACTLY one
 *  32-byte owner, one token program (classic or Token-2022) as `programId`, base64,
 *  and ONLY the 8-byte balance (dataSlice 64/8), so each account costs the same bounded
 *  bytes round 37 V1's reads did and a stranger's flood meets the 8 MB response cap
 *  rather than growing the read. Anything else, a mint filter, jsonParsed, a full or
 *  different slice, is refused. */
export function tokenListingShape(p) {
  if (!Array.isArray(p) || p.length !== 3 || !is32(p[0])) return null
  const f = p[1], c = p[2]
  if (!f || typeof f !== 'object' || Array.isArray(f) || Object.keys(f).length !== 1 || (f.programId !== TOKEN && f.programId !== TOKEN_2022)) return null
  if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some(k => !['commitment', 'encoding', 'dataSlice'].includes(k))) return null
  if (c.encoding !== 'base64') return null
  const ds = c.dataSlice
  if (!ds || typeof ds !== 'object' || Object.keys(ds).length !== 2 || ds.offset !== 64 || ds.length !== 8) return null
  return f.programId === TOKEN ? 'token-owner-amounts' : 'token22-owner-amounts'
}

/** The five CBOB programs: every relayed transaction must call one of them, or be
 *  one of the three exact shapes the pages send without one (review round 36 L1). */
export const CBOB_PROGRAMS = new Set(['9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273', MINT, '8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8',
  '2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2', 'EB2uVvsaThLp4PWt3LwAWveTCa9ZynPVbWzZfUhMf2aa'])
export const REVENUE = PublicKey.findProgramAddressSync([Buffer.from('revenue')], new PublicKey(MINT))[0].toBase58()
const ATA_PROG = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', SYSTEM = '11111111111111111111111111111111', CB = 'ComputeBudget111111111111111111111111111111'
/** Round 46: the wallet's guard (Phantom adds it); like CB it is never the transaction's work. */
export const LIGHTHOUSE = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'

/** The program ids every rule below is keyed on. Mainnet unless a DRESS REHEARSAL's
 *  local ceremony server passes its five throwaway ids (round 46: the hosted
 *  rehearsal page, Gary 2026-10-09). The rules are the same rules, applied to
 *  those five; nothing else about the proxy changes. */
export const MAINNET_SET = { MINT, MINT_AUTH, REVENUE, CBOB: CBOB_PROGRAMS, TX: TX_PROGRAMS }
export function programSet(programs = null) {
  if (!programs) return MAINNET_SET
  const ids = ['seal', 'mint', 'burn', 'gov', 'sweep'].map(k => programs[k])
  if (ids.some(x => !is32(x)) || new Set(ids).size !== 5) throw new Error('a program set needs five distinct 32-byte ids (seal, mint, burn, gov, sweep)')
  const mint = programs.mint
  return { MINT: mint, MINT_AUTH: PublicKey.findProgramAddressSync([Buffer.from('mint')], new PublicKey(mint))[0].toBase58(),
    REVENUE: PublicKey.findProgramAddressSync([Buffer.from('revenue')], new PublicKey(mint))[0].toBase58(),
    CBOB: new Set(ids), TX: new Set([...ids, CORE, ATA_PROG, TOKEN, SYSTEM, CB, LIGHTHOUSE]) }
}

/** sendTransaction / simulateTransaction: at most 1,232 bytes, calling only the
 *  programs the pages use, and at least one CBOB program, unless it is exactly:
 *    * associated-token-account creations only (the redeem page's set-up, the
 *      ceremony's cbBTC accounts),
 *    * the ceremony's collection create (Core CreateCollectionV2, MINT's PDA as
 *      its update authority),
 *    * the ceremony's rent top-up (System transfers to the revenue address).
 *  So the endpoint relays no plain SOL or token transfer between strangers. */
export function txRefusal(p, ps = MAINNET_SET, collection = null) {
  if (!Array.isArray(p) || typeof p[0] !== 'string') return 'a transaction is required'
  const enc = p[1]?.encoding
  if (enc !== undefined && enc !== 'base64') return 'base64 transactions only'
  const raw = Buffer.from(p[0], 'base64')
  if (!raw.length || raw.length > 1232) return 'transaction size out of range'
  let tx; try { tx = VersionedTransaction.deserialize(raw) } catch { return 'not a transaction' }
  const keys = tx.message.staticAccountKeys.map(k => k.toBase58())
  const ixs = tx.message.compiledInstructions.map(ix => ({ prog: keys[ix.programIdIndex], data: Buffer.from(ix.data), accts: ix.accountKeyIndexes.map(i => keys[i]) }))
  for (const ix of ixs) if (!ps.TX.has(ix.prog)) return 'that transaction calls a program these pages never call'
  if (ixs.some(ix => ps.CBOB.has(ix.prog))) return null
  const work = ixs.filter(ix => ix.prog !== CB && ix.prog !== LIGHTHOUSE)
  if (!work.length) return 'that transaction does nothing these pages do'
  if (work.every(ix => ix.prog === ATA_PROG && ix.data.length === 1 && ix.data[0] === 1)) return null
  if (work.length === 1 && work[0].prog === CORE && work[0].data[0] === 21 && work[0].accts[1] === ps.MINT_AUTH) return null
  // Ordinary vault moves only, bound to the configured Bank collection. Core
  // enforces the actual collection and the current owner's signature on chain.
  if (collection && work.length === 1 && work[0].prog === CORE && work[0].data.equals(Buffer.from([14, 0])) && work[0].accts.length === 7 && work[0].accts[1] === collection && work[0].accts[2] === work[0].accts[3] && work[0].accts[5] === CORE && work[0].accts[6] === CORE) return null
  if (work.every(ix => ix.prog === SYSTEM && ix.data.length === 12 && ix.data.readUInt32LE(0) === 2 && ix.accts[1] === ps.REVENUE)) return null
  return 'that transaction calls none of the Bank\'s programs'
}

/** Why a single JSON-RPC call is refused, or null. Pure. */
export function refusal(call, { collection = null, ps = MAINNET_SET } = {}) {
  if (!call || typeof call !== 'object' || call.jsonrpc !== '2.0' || typeof call.method !== 'string') return 'not a JSON-RPC 2.0 call'
  if (!ALLOWED.has(call.method)) return `method ${String(call.method).slice(0, 40)} is not served here`
  const p = call.params
  switch (call.method) {
    case 'getMultipleAccounts': if (!Array.isArray(p?.[0]) || p[0].length > 100) return 'at most 100 accounts'; break
    case 'getSignatureStatuses': if (!Array.isArray(p?.[0]) || p[0].length > 50) return 'at most 50 signatures'; break
    case 'getProgramAccounts': if (!gpaShape(p?.[0], p?.[1], collection, ps)) return 'getProgramAccounts: only the exact filtered shapes these pages send'; break
    case 'getTokenAccountsByOwner': if (!tokenListingShape(p)) return 'getTokenAccountsByOwner: one owner, one token program, the 8-byte balance only'; break
    case 'sendTransaction': case 'simulateTransaction': { const why = txRefusal(p, ps, collection); if (why) return why; break }
    case 'getFeeForMessage': {
      if(!Array.isArray(p)||p.length!==2||typeof p[0]!=='string'||!p[1]||Object.keys(p[1]).some(k=>k!=='commitment')||p[1].commitment!=='confirmed')return 'getFeeForMessage: one legacy message at confirmed commitment'
      try {
        const raw=Buffer.from(p[0],'base64')
        if(!raw.length||raw.length>1232||raw[0]>=128||raw.toString('base64')!==p[0])return 'getFeeForMessage: invalid message encoding or size'
        const message=Message.from(raw)
        if(!Buffer.from(message.serialize()).equals(raw))return 'getFeeForMessage: invalid message'
        const why=txRefusal([Buffer.from(new VersionedTransaction(message).serialize()).toString('base64')],ps,collection)
        if(why)return why
      }catch{return 'getFeeForMessage: invalid message'}
      break
    }
    // round 37 V2: the ceremony reads who created a candidate collection
    case 'getSignaturesForAddress': {
      const o = p?.[1]
      if (!Array.isArray(p) || p.length > 2 || !is32(p[0]) || !o || typeof o !== 'object' || Object.keys(o).some(k => !['limit', 'before', 'commitment'].includes(k))
        || !Number.isInteger(o.limit) || o.limit < 1 || o.limit > 1000 || (o.before !== undefined && !isSig(o.before))) return 'getSignaturesForAddress: one address, at most 1,000 a page'
      break
    }
    case 'getTransaction': {
      const o = p?.[1]
      if (!Array.isArray(p) || p.length > 2 || !isSig(p[0]) || !o || typeof o !== 'object' || Object.keys(o).some(k => !['commitment', 'maxSupportedTransactionVersion', 'encoding'].includes(k))
        || (o.encoding !== undefined && o.encoding !== 'json')) return 'getTransaction: one signature, JSON'
      break
    }
    case 'getAssetsByOwner': if (!p || !is32(p.ownerAddress) || Number(p.limit || 1000) > 1000) return 'getAssetsByOwner: one owner, at most 1,000 a page'; break
    case 'getAssetsByGroup':
      if (!p || p.groupKey !== 'collection' || Number(p.limit || 1000) > 1000) return 'getAssetsByGroup: a collection, at most 1,000 a page'
      if (!collection || p.groupValue !== collection) return 'getAssetsByGroup: only the vault collection'
      break
  }
  return null
}

/** The rate-limit key of an address: IPv4 as is, IPv6 by its /64 (one host can
 *  hold 2^64 addresses), IPv4-mapped IPv6 as the IPv4. */
export function ipKey(ip) {
  const a = String(ip || '').trim().toLowerCase().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1')
  if (!a.includes(':')) return a
  const [head, tail = ''] = a.split('::')
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : []
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t].map(x => x.padStart(4, '0'))
  return `${full.slice(0, 4).join(':')}::/64`
}

/** A token bucket per (ip key, class). */
export function limiter(limits = LIMITS, now = () => Date.now()) {
  const b = new Map()
  setInterval(() => { const t = now(); for (const [k, v] of b) if (t - v.at > 600_000) b.delete(k) }, 60_000).unref?.()
  return (ip, method) => {
    const cls = limits[method] ? method : 'default'
    const [rate, burst] = limits[cls], k = `${ipKey(ip)}|${cls}`, t = now()
    const s = b.get(k) || { tokens: burst, at: t }
    s.tokens = Math.min(burst, s.tokens + (t - s.at) / 1000 * rate); s.at = t
    if (s.tokens < 1) { b.set(k, s); return false }
    s.tokens -= 1; b.set(k, s); return true
  }
}

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

/** The proxy as a request handler. `forward(url, body)` -> { status, text }. */
export function handler({ upstream, das = upstream, origin, origins = null, collection = null, requireCollection = true, forward, limits = LIMITS, log = () => {}, programs = null }) {
  const ps = programSet(programs)
  if (!upstream || !/^https?:\/\//.test(upstream)) throw new Error('CBOB_RPC_UPSTREAM is not set')
  if (requireCollection && !is32(collection)) throw new Error('CBOB_VAULT_COLLECTION is not set: collection and DAS group queries are limited to it')
  const allowed = new Set(origins || [origin])
  if (!allowed.size || [...allowed].some(o => !o)) throw new Error('CBOB_RPC_ORIGIN is not set')
  const allow = limiter(limits)
  const host = u => { try { return new URL(u).host } catch { return 'upstream' } }
  return (req, res) => {
    const send = (status, obj) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store')
      res.setHeader('x-content-type-options', 'nosniff'); res.end(JSON.stringify(obj)) }
    if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return send(405, rpcError(null, -32600, 'POST only')) }
    // A browser always sends Origin on a POST. None, or another site's: refused.
    if (!req.headers.origin || !allowed.has(req.headers.origin)) return send(403, rpcError(null, -32600, 'not this site'))
    const sfs = req.headers['sec-fetch-site']
    if (sfs !== undefined && sfs !== 'same-origin') return send(403, rpcError(null, -32600, 'not this site'))
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(415, rpcError(null, -32600, 'application/json only'))
    const ip = (req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::1') && req.headers['x-real-ip'] ? String(req.headers['x-real-ip']) : req.socket.remoteAddress
    let size = 0, chunks = [], aborted = false
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { aborted = true; send(413, rpcError(null, -32600, 'request too large')); req.destroy() } else chunks.push(c) })
    req.on('end', async () => {
      if (aborted) return
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return send(400, rpcError(null, -32700, 'not JSON')) }
      const calls = Array.isArray(body) ? body : [body]
      if (!calls.length || calls.length > MAX_BATCH) return send(400, rpcError(null, -32600, `a batch of 1 to ${MAX_BATCH}`))
      for (const c of calls) {
        const why = refusal(c, { collection, ps })
        if (why) { log('refused', ipKey(ip), c?.method, why); return send(403, rpcError(c?.id, -32601, why)) }
        if (!allow(ip, c.method)) { log('limited', ipKey(ip), c.method); res.setHeader('retry-after', '2'); return send(429, rpcError(c.id, -32005, 'too many requests, slow down')) }
      }
      const toDas = calls.every(c => DAS.has(c.method)), mixed = !toDas && calls.some(c => DAS.has(c.method))
      if (mixed) return send(400, rpcError(null, -32600, 'do not batch DAS with other calls'))
      const url = toDas ? das : upstream
      try {
        const r = await forward(url, JSON.stringify(body))
        res.statusCode = r.status; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff')
        res.end(r.text)
      } catch (e) { log('upstream', ipKey(ip), calls[0].method, String(e?.message || e).replaceAll(url, host(url))); send(502, rpcError(calls[0].id, -32603, `upstream ${host(url)} unavailable`)) }
    })
  }
}

/** Read a web stream to text, aborting the moment it passes `cap` bytes. */
export async function readCapped(stream, cap, abort = () => {}) {
  const reader = stream.getReader(), parts = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    n += value.length
    if (n > cap) { abort(); try { await reader.cancel() } catch { /* already gone */ } throw new Error('response too large') }
    parts.push(Buffer.from(value))
  }
  return Buffer.concat(parts).toString('utf8')
}

/** fetch with a timeout, the response capped WHILE it streams in. */
export async function forwardFetch(url, body, cap = MAX_RESPONSE) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 20_000)
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: ac.signal })
    return { status: r.status, text: await readCapped(r.body, cap, () => ac.abort()) }
  } finally { clearTimeout(t) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.CBOB_RPC_PORT || 8789)
  const h = handler({ upstream: process.env.CBOB_RPC_UPSTREAM, das: process.env.CBOB_DAS_UPSTREAM || process.env.CBOB_RPC_UPSTREAM,
    origin: process.env.CBOB_RPC_ORIGIN || 'https://centralbankofbitcoin.com', collection: process.env.CBOB_VAULT_COLLECTION,
    forward: forwardFetch, log: (...a) => console.log(new Date().toISOString(), ...a) })
  http.createServer(h).listen(port, '127.0.0.1', () => console.log(`cbob rpc proxy on 127.0.0.1:${port}`))
}
