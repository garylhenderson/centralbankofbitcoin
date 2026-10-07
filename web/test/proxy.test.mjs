/**
 * THE RPC PROXY, offline (an in-process HTTP server on loopback and a fake
 * upstream; nothing leaves the machine):
 *   * its method allowlist EQUALS the set of RPC methods web/src calls;
 *   * the exact requests web3 sends for the pages' filtered getProgramAccounts
 *     calls are accepted, and every broader or malformed shape is refused (review M1);
 *   * no Origin, or another site's, is refused; POST only; no CORS header; 16 KB cap;
 *     batch cap; per-IP limits with IPv6 keyed by /64; transactions limited to the
 *     pages' programs; the response capped while it streams; the upstream URL (its
 *     key) never echoed.
 */
import fs from 'fs'
import path from 'path'
import http from 'http'
import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js'
import bs58 from 'bs58'
import { profile } from '../src/config.js'
import { makeIds } from '../src/lib/ids.mjs'
import * as IX from '../src/lib/ix.mjs'
import { coreAssetsOwnedBy, findHostOf, waitingVaults, collectionsOfMint } from '../src/lib/reads.mjs'
import { ALLOWED, refusal, handler, MAX_BODY, CORE, MINT, MINT_AUTH, gpaShape, ipKey, readCapped, txRefusal } from '../deploy/rpc-proxy.mjs'
import { harness, ROOT } from './ref.mjs'

const H = harness('proxy')
const COLL = 'HqznL4EpJTbWZmqqetb4sJPftBUN1s6uNdQURBAfAsBr'
const P = { ...profile('mainnet'), collection: COLL }
const ids = makeIds(P)
const OPTS = { collection: COLL }

// ── 1. the allowlist == what the pages call ──
const walk = d => fs.readdirSync(d).flatMap(f => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walk(p) : p.endsWith('.mjs') ? [p] : [] })
const src = walk(`${ROOT}/web/src`).map(f => fs.readFileSync(f, 'utf8')).join('\n')
const WEB3_TO_RPC = { getMultipleAccountsInfo: 'getMultipleAccounts', sendRawTransaction: 'sendTransaction' }
const called = new Set([...src.matchAll(/\bconn\.(\w+)\(/g)].map(m => WEB3_TO_RPC[m[1]] || m[1]))
for (const m of src.matchAll(/das\(profile, '(\w+)'/g)) called.add(m[1])
H.eq('the proxy allows EXACTLY the RPC methods web/src calls', [...ALLOWED].sort(), [...called].sort())
H.eq('MINT_AUTH in the proxy == the pages\' derivation', MINT_AUTH, ids.MINT_AUTH.toBase58())

// ── 2. the requests web3 actually sends for the pages' four filtered reads ──
const captured = []
const capConn = new Connection('https://example.invalid/rpc', { fetch: async (u, init) => { captured.push(JSON.parse(init.body)); throw new Error('captured') } })
const owner = ids.depositAddress(new PublicKey(COLL))
await coreAssetsOwnedBy({ ...P, rpc: 'https://example.invalid/rpc' }, capConn, ids, owner).catch(() => {})
await findHostOf({ ...P, rpc: 'https://example.invalid/rpc' }, capConn, ids, owner.toBase58()).catch(() => {})
await waitingVaults(capConn, ids, 3).catch(() => {})
await collectionsOfMint(capConn, ids).catch(() => {})
const gpa = [...new Map(captured.filter(c => c.method === 'getProgramAccounts').map(c => [JSON.stringify(c.params), c])).values()]
H.eq('four distinct getProgramAccounts shapes were captured from the pages\' own reads', gpa.map(c => gpaShape(c.params[0], c.params[1], COLL)),
  ['core-owner', 'core-collection', 'mint-waiting', 'core-mint-coll'])
H.eq('...and the proxy accepts each of them', gpa.map(c => refusal(c, OPTS)), [null, null, null, null])
const g = (prog, cfg) => ({ jsonrpc: '2.0', id: 1, method: 'getProgramAccounts', params: [prog, cfg] })
const core = (filters, extra = {}) => g(CORE, { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, filters: filters.map(([offset, bytes]) => ({ memcmp: { offset, bytes, encoding: 'base58' } })), ...extra })
const refused = (name, call) => H.t(`refused: ${name}`, !!refusal(call, OPTS), String(refusal(call, OPTS)))
refused('Core "owner" filter of ONE byte (would match 1/256 of all Core)', core([[0, '2'], [1, '1']]))
refused('Core "owner" filter that is EMPTY', core([[0, '2'], [1, '']]))
refused('Core owner filter of 31 bytes', core([[0, '2'], [1, bs58.encode(Buffer.alloc(31, 7))]]))
refused('Core collection filter at 34 of one byte', core([[0, '2'], [33, '3'], [34, '2']]))
refused('Core collection filter for ANOTHER collection', core([[0, '2'], [33, '3'], [34, Keypair.generate().publicKey.toBase58()]]))
refused('Core collection filter without the update-authority-is-collection tag at 33', core([[0, '2'], [34, COLL]]))
refused('Core owner filter plus a third, unknown filter', core([[0, '2'], [1, owner.toBase58()], [66, '2']]))
refused('Core owner filter but returning account DATA', core([[0, '2'], [1, owner.toBase58()]], { dataSlice: undefined }))
refused('Core owner filter with a dataSlice of 1 byte', core([[0, '2'], [1, owner.toBase58()]], { dataSlice: { offset: 0, length: 1 } }))
refused('Core collections of ANOTHER update authority', core([[0, '6'], [1, owner.toBase58()]]))
refused('Core filters given as base64 instead of base58', g(CORE, { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, filters: [{ memcmp: { offset: 0, bytes: 'AQ==', encoding: 'base64' } }, { memcmp: { offset: 1, bytes: owner.toBase58() } }] }))
refused('Core with a dataSize filter added', g(CORE, { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, filters: [{ memcmp: { offset: 0, bytes: '2' } }, { memcmp: { offset: 1, bytes: owner.toBase58() } }, { dataSize: 0 }] }))
refused('MINT with any other value at 177', g(MINT, { encoding: 'base64', filters: [{ memcmp: { offset: 0, bytes: '8s2gvH1XffL' } }, { memcmp: { offset: 177, bytes: '1' } }] }))
refused('MINT records without the pending filter (every record)', g(MINT, { encoding: 'base64', filters: [{ memcmp: { offset: 0, bytes: '8s2gvH1XffL' } }] }))
refused('getProgramAccounts on the token program', g('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', { encoding: 'base64', filters: [{ memcmp: { offset: 0, bytes: '2' } }] }))
refused('a method the pages never call (requestAirdrop)', { jsonrpc: '2.0', id: 1, method: 'requestAirdrop', params: [] })
refused('getBlockTime (the pages read the Clock sysvar now)', { jsonrpc: '2.0', id: 1, method: 'getBlockTime', params: [1] })
refused('getMultipleAccounts of 101 accounts', { jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [Array(101).fill(COLL)] })
refused('DAS by group for another collection', { jsonrpc: '2.0', id: 1, method: 'getAssetsByGroup', params: { groupKey: 'collection', groupValue: CORE, page: 1, limit: 1000 } })
refused('DAS by owner with a non-address owner', { jsonrpc: '2.0', id: 1, method: 'getAssetsByOwner', params: { ownerAddress: '1', page: 1, limit: 1000 } })
H.eq('DAS by group for the vault collection: accepted', refusal({ jsonrpc: '2.0', id: 1, method: 'getAssetsByGroup', params: { groupKey: 'collection', groupValue: COLL, page: 1, limit: 1000 } }, OPTS), null)
// transactions
{
  const kp = Keypair.generate()
  const t = ixs => { const x = new Transaction().add(...ixs); x.feePayer = kp.publicKey; x.recentBlockhash = '11111111111111111111111111111111'
    return x.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') }
  H.eq('a page transaction (open + burn) is accepted', txRefusal([t([IX.openForRedemption(ids, kp.publicKey, kp.publicKey)]), { encoding: 'base64' }]), null)
  H.eq('a prior transaction (ATA creates) is accepted', txRefusal([t([IX.createAtaIdempotent(kp.publicKey, kp.publicKey, kp.publicKey, kp.publicKey)]), { encoding: 'base64' }]), null)
  H.t('a transaction calling any other program is refused (no relay for strangers\' transactions)',
    !!txRefusal([t([new TransactionInstruction({ programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), data: Buffer.from('x'), keys: [] })]), { encoding: 'base64' }]))
  H.t('...even hidden after a page instruction', !!txRefusal([t([SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 }),
    new TransactionInstruction({ programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), data: Buffer.from('x'), keys: [] })]), { encoding: 'base64' }]))
  H.t('a base58-encoded transaction is refused (base64 only)', !!txRefusal(['abc', { encoding: 'base58' }]))
}
H.eq('IPv6 rate limits are keyed by /64; IPv4 and IPv4-mapped as themselves',
  [ipKey('2001:db8:1:2:aaaa::1'), ipKey('2001:db8:1:2:ffff:ffff:ffff:ffff'), ipKey('2001:db8:1:3::1'), ipKey('::ffff:9.9.9.9'), ipKey('9.9.9.9')],
  ['2001:0db8:0001:0002::/64', '2001:0db8:0001:0002::/64', '2001:0db8:0001:0003::/64', '9.9.9.9', '9.9.9.9'])
{
  let aborted = false
  const big = new ReadableStream({ start(c) { for (let i = 0; i < 10; i++) c.enqueue(new Uint8Array(1024)); c.close() } })
  let threw = ''; try { await readCapped(big, 4096, () => { aborted = true }) } catch (e) { threw = e.message }
  H.t('the response cap stops the read WHILE it streams (4 KB cap, 10 KB body)', threw === 'response too large' && aborted)
}

// ── 3. over HTTP ──
const SECRET = 'https://rpc.example.invalid/?api-key=SECRETKEY123'
const seen = []
const mk = o => handler({ upstream: SECRET, das: SECRET, origin: 'https://centralbankofbitcoin.com', collection: COLL,
  forward: async (url, body) => { seen.push({ url, body }); if (body.includes('"fail"')) throw new Error(`connect ECONNREFUSED ${url}`); return { status: 200, text: '{"jsonrpc":"2.0","id":1,"result":42}' } },
  limits: { default: [10, 60], sendTransaction: [1, 5], simulateTransaction: [3, 15], getProgramAccounts: [1, 6] }, ...o })
const srv = http.createServer(mk()); await new Promise(r => srv.listen(0, '127.0.0.1', r))
const port = srv.address().port
const req = (method, body, headers = {}) => new Promise(res => {
  const hs = Object.fromEntries(Object.entries({ 'content-type': 'application/json', origin: 'https://centralbankofbitcoin.com', ...headers }).filter(([, v]) => v !== undefined))
  const r = http.request({ host: '127.0.0.1', port, path: '/rpc', method, agent: false, headers: hs }, x => {
    let t = ''; x.on('data', c => { t += c }); x.on('end', () => res({ status: x.statusCode, headers: x.headers, text: t })) })
  r.on('error', () => res({ status: 0, headers: {}, text: '' })); if (body !== undefined) r.write(body); r.end() })
const slot = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: [] })
const ok = await req('POST', slot)
H.eq('an allowed call from the site is forwarded and its answer returned', [ok.status, ok.text], [200, '{"jsonrpc":"2.0","id":1,"result":42}'])
H.t('...with no CORS header (same-origin only)', !('access-control-allow-origin' in ok.headers))
const before0 = seen.length
H.eq('a request with NO Origin (curl, a script) is refused, and never reaches the upstream', [(await req('POST', slot, { origin: undefined })).status, seen.length - before0], [403, 0])
H.eq('another site\'s Origin is refused', (await req('POST', slot, { origin: 'https://evil.example' })).status, 403)
H.eq('a cross-site fetch (Sec-Fetch-Site: cross-site) is refused even with our Origin', (await req('POST', slot, { 'sec-fetch-site': 'cross-site' })).status, 403)
H.eq('GET is refused', (await req('GET')).status, 405)
H.eq('OPTIONS (a CORS preflight) is refused', (await req('OPTIONS')).status, 405)
H.eq('a non-JSON content type is refused', (await req('POST', 'x', { 'content-type': 'text/plain' })).status, 415)
H.eq(`a body over ${MAX_BODY} bytes is refused`, (await req('POST', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: ['x'.repeat(MAX_BODY)] }))).status, 413)
H.eq('a batch of 9 is refused', (await req('POST', JSON.stringify(Array(9).fill({ jsonrpc: '2.0', id: 1, method: 'getSlot' })))).status, 400)
H.eq('a batch hiding one forbidden call is refused whole', (await req('POST', JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'getSlot' }, { jsonrpc: '2.0', id: 2, method: 'requestAirdrop' }]))).status, 403)
H.eq('a malicious getProgramAccounts filter is refused over HTTP too', (await req('POST', JSON.stringify(core([[0, '2'], [1, '1']])))).status, 403)
const kp = Keypair.generate()
const tx = (() => { const x = new Transaction().add(IX.openForRedemption(ids, kp.publicKey, kp.publicKey)); x.feePayer = kp.publicKey; x.recentBlockhash = '11111111111111111111111111111111'
  return x.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') })()
const sendTx = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [tx, { encoding: 'base64' }] })
const before = seen.length
const sends = []
for (let i = 0; i < 6; i++) sends.push((await req('POST', sendTx, { 'x-real-ip': '2001:db8:9:9::' + (i + 1) })).status)
H.eq('sendTransaction: 5 then refused (429), counted per /64 (six different IPv6 addresses in one /64)', sends, [200, 200, 200, 200, 200, 429])
H.eq('...and the refused one never reached the upstream', seen.length - before, 5)
H.eq('...while another visitor is unaffected', (await req('POST', sendTx, { 'x-real-ip': '8.8.8.8' })).status, 200)
const fail = await req('POST', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: ['fail'] }))
H.t('an upstream failure is a 502 that names the host, never the URL or its key', fail.status === 502 && !fail.text.includes('SECRETKEY123') && fail.text.includes('rpc.example.invalid'), fail.text)
H.eq('DAS and ordinary calls may not share a batch', (await req('POST', JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'getSlot' }, { jsonrpc: '2.0', id: 2, method: 'getAssetsByOwner', params: { ownerAddress: COLL } }]))).status, 400)
srv.close()
let threw = false; try { handler({ upstream: '', collection: COLL, origin: 'x', forward: async () => ({}) }) } catch { threw = true }
H.t('the proxy will not start without an upstream URL', threw)
threw = false; try { handler({ upstream: SECRET, origin: 'https://centralbankofbitcoin.com', forward: async () => ({}) }) } catch { threw = true }
H.t('the public proxy will not start without CBOB_VAULT_COLLECTION', threw)
const conf = fs.readFileSync(`${ROOT}/web/deploy/nginx-rpc.conf`, 'utf8')
H.t('nginx-rpc.conf: POST only, 16k cap, rate limit, loopback proxy, no CORS header, no upstream URL',
  /limit_except POST \{ deny all; \}/.test(conf) && /client_max_body_size 16k;/.test(conf) && /limit_req zone=cbob_rpc/.test(conf) &&
  /proxy_pass http:\/\/127\.0\.0\.1:8789;/.test(conf) && !/^\s*add_header Access-Control/m.test(conf) && !/https:\/\/[^\s]*(helius|quicknode|alchemy|triton)/i.test(conf))
export default H.done()
