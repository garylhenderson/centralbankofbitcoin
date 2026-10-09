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
import { coreAssetsOwnedBy, findHostOf, waitingVaults, collectionsOfMint, dueBoostRecords, vaultWalletAccounts, STRAY_FULL_READ_MAX, NFT_FULL_READ_MAX } from '../src/lib/reads.mjs'
import { collectionCreator } from '../src/lib/ceremony-reads.mjs'
import crypto from 'crypto'
import { STEPS, valuesFrom } from '../src/lib/plan-ceremony.mjs'
import * as spl from '@solana/spl-token'
import { tokenListingShape, ALLOWED, refusal, handler, MAX_BODY, MAX_RESPONSE, CORE, MINT, MINT_AUTH, TOKEN, TOKEN_2022, gpaShape, ipKey, readCapped, txRefusal, programSet, MAINNET_SET } from '../deploy/rpc-proxy.mjs'
import { staticFile, localListener, judgeOrigins, serverConfig, rehearsalPrograms } from '../deploy/ceremony-local.mjs'
import { MAINNET_PROGRAMS } from '../src/config.js'
import os from 'os'
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
await dueBoostRecords(capConn, ids, 3).catch(() => {})
// round 37: the bounded token reads (V1) and the creator check (V2), from a connection that answers
const answer = { getMultipleAccounts: p => ({ context: { slot: 1 }, value: p[0].map(() => null) }), getProgramAccounts: () => [], getTokenAccountsByOwner: () => ({ context: { slot: 1 }, value: [] }),
  getSignaturesForAddress: () => [{ signature: bs58.encode(Buffer.alloc(64, 3)), slot: 1, err: null, memo: null, blockTime: null, confirmationStatus: 'finalized' }], getTransaction: () => null }
const ansConn = new Connection('https://example.invalid/rpc', { fetch: async (u, init) => { const c = JSON.parse(init.body); captured.push(c)
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: c.id, result: answer[c.method](c.params) }), { headers: { 'content-type': 'application/json' } }) } })
await vaultWalletAccounts(ansConn, owner, [COLL])
await collectionCreator(ansConn, ids, COLL, P.initAuthority)
const gpa = [...new Map(captured.filter(c => c.method === 'getProgramAccounts').map(c => [JSON.stringify(c.params), c])).values()]
H.eq('five distinct getProgramAccounts shapes were captured from the pages\' own reads', gpa.map(c => gpaShape(c.params[0], c.params[1], COLL)),
  ['core-owner', 'core-collection', 'mint-waiting', 'core-mint-coll', 'mint-boosts'])
H.eq('...and the proxy accepts each of them', gpa.map(c => refusal(c, OPTS)), gpa.map(() => null))
// round 46: the vault wallet's token accounts, one getTokenAccountsByOwner per token program
const tabo = [...new Map(captured.filter(c => c.method === 'getTokenAccountsByOwner').map(c => [JSON.stringify(c.params), c])).values()]
H.eq('R46: the token listing the pages send is getTokenAccountsByOwner, classic and Token-2022, balance slice only', tabo.map(c => tokenListingShape(c.params)), ['token-owner-amounts', 'token22-owner-amounts'])
H.eq('R46: ...and the proxy accepts each of them', tabo.map(c => refusal(c, OPTS)), tabo.map(() => null))
const hist = captured.filter(c => c.method === 'getSignaturesForAddress' || c.method === 'getTransaction')
H.eq('V2: the creator check\'s getSignaturesForAddress and getTransaction, as web3 sends them, are accepted', [hist.map(c => c.method), hist.map(c => refusal(c, OPTS))], [['getSignaturesForAddress', 'getTransaction'], [null, null]])
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
refused('MINT records with a WIDER slice than the boosts read', g(MINT, { encoding: 'base64', dataSlice: { offset: 0, length: 200 }, filters: [{ memcmp: { offset: 0, bytes: '8s2gvH1XffL' } }] }))
refused('MINT records without the pending filter (every record)', g(MINT, { encoding: 'base64', filters: [{ memcmp: { offset: 0, bytes: '8s2gvH1XffL' } }] }))
refused('getProgramAccounts on the token program', g('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', { encoding: 'base64', filters: [{ memcmp: { offset: 0, bytes: '2' } }] }))
// round 37 V1: the token reads are balances or addresses of ONE owner, nothing wider
const tk = (prog, filters, dataSlice = { offset: 64, length: 8 }) => g(prog, { encoding: 'base64', commitment: 'confirmed', ...(dataSlice ? { dataSlice } : {}), filters })
const own = { memcmp: { offset: 32, bytes: owner.toBase58() } }
refused('token amounts with a slice WIDER than the balance (whole accounts)', tk(TOKEN, [{ dataSize: 165 }, own], { offset: 0, length: 165 }))
refused('token amounts with no slice at all', tk(TOKEN, [{ dataSize: 165 }, own], null))
refused('token amounts without the dataSize filter', tk(TOKEN, [own]))
refused('token amounts of another size (166)', tk(TOKEN, [{ dataSize: 166 }, own]))
refused('token amounts with two dataSize filters', tk(TOKEN, [{ dataSize: 165 }, { dataSize: 165 }, own]))
refused('token amounts with a ONE-byte owner filter', tk(TOKEN, [{ dataSize: 165 }, { memcmp: { offset: 32, bytes: '2' } }]))
refused('token amounts filtered on the MINT (offset 0) instead of the owner', tk(TOKEN, [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: owner.toBase58() } }]))
refused('Token-2022 addresses with account DATA', tk(TOKEN_2022, [own], { offset: 0, length: 200 }))
refused('classic token ADDRESSES of every size (the Token-2022-only shape on the classic program)', tk(TOKEN, [own], { offset: 0, length: 0 }))
refused('the token shapes on another program', tk(CORE, [{ dataSize: 165 }, own]))
refused('getTokenAccountsByOwner (the unbounded listing round 37 V1 replaced)', { jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [owner.toBase58(), { programId: TOKEN }, { encoding: 'base64' }] })
// round 46: the listing is getTokenAccountsByOwner again, but ONLY with the 8-byte balance slice
{ const tabo = (f, c) => ({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [owner.toBase58(), f, c] })
  const ok = { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 64, length: 8 } }
  H.eq('R46: getTokenAccountsByOwner, one owner, classic or Token-2022, balance slice: accepted', [refusal(tabo({ programId: TOKEN }, ok), OPTS), refusal(tabo({ programId: TOKEN_2022 }, ok), OPTS)], [null, null])
  refused('R46: getTokenAccountsByOwner as jsonParsed', tabo({ programId: TOKEN }, { ...ok, encoding: 'jsonParsed' }))
  refused('R46: getTokenAccountsByOwner with the full account data', tabo({ programId: TOKEN }, { encoding: 'base64', dataSlice: { offset: 0, length: 165 } }))
  refused('R46: getTokenAccountsByOwner filtered by a mint (not the listing the page sends)', tabo({ mint: COLL }, ok))
  refused('R46: getTokenAccountsByOwner for another program', tabo({ programId: CORE }, ok))
  refused('R46: getTokenAccountsByOwner of a non-address owner', { jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: ['1', { programId: TOKEN }, ok] }) }
// round 37 V2
const sig = bs58.encode(Buffer.alloc(64, 3))
refused('getSignaturesForAddress of 1,001', { jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [COLL, { limit: 1001 }] })
refused('getSignaturesForAddress with no limit', { jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [COLL, {}] })
refused('getSignaturesForAddress of a non-address', { jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: ['1', { limit: 10 }] })
refused('getSignaturesForAddress with an unknown option', { jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [COLL, { limit: 10, until: sig, minContextSlot: 1 }] })
refused('getTransaction of a non-signature', { jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [COLL, { maxSupportedTransactionVersion: 0 }] })
refused('getTransaction as jsonParsed', { jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }] })
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
// ── review round 36 L1: no relay for transactions that call none of the Bank's programs ──
{
  const kp = Keypair.generate(), other = Keypair.generate().publicKey
  const enc = ixs => { const x = new Transaction().add(...ixs); x.feePayer = kp.publicKey; x.recentBlockhash = '11111111111111111111111111111111'
    return [x.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), { encoding: 'base64' }] }
  const relay = (name, ixs) => H.t(`L1 refused: ${name}`, !!txRefusal(enc(ixs)), String(txRefusal(enc(ixs))))
  relay('a plain SOL transfer between strangers', [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: other, lamports: 1 })])
  relay('a plain SPL token transfer', [spl.createTransferInstruction(other, other, kp.publicKey, 1n)])
  relay('an ATA create followed by a token transfer', [IX.createAtaIdempotent(kp.publicKey, other, other, other), spl.createTransferInstruction(other, other, kp.publicKey, 1n)])
  relay('a Core instruction alone that is not the ceremony\'s collection create', [IX.rescueNested(ids, other, other, other, kp.publicKey)].map(ix => ({ ...ix, programId: ids.CORE })))
  relay('a collection create with ANOTHER update authority', [IX.coreCreateCollection(ids, other, kp.publicKey, kp.publicKey, 'x', 'y')])
  relay('a System transfer to anyone but the revenue address', [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: ids.MINT_CFG, lamports: 1 })])
  relay('compute-budget instructions only', [new TransactionInstruction({ programId: new PublicKey('ComputeBudget111111111111111111111111111111'), data: Buffer.from([2, 0, 0, 0, 0]), keys: [] })])
  // and EVERY transaction the pages build is accepted
  const launch = JSON.parse(fs.readFileSync(`${ROOT}/launch/mainnet-init.json`, 'utf8'))
  for (const k of Object.keys(launch)) if (launch[k]?.value === null) launch[k].value = k === 'vault_collection' ? COLL : 1_900_000_000
  const v = valuesFrom(launch), ctx = { squads: P.squads, existing: new Set(), shortfall: 1000 }
  const ceremony = STEPS.map(st => [st.id, st.build(ids, kp.publicKey, v, ctx)])
  const page = [
    ...ceremony,
    ['redeem prior', [IX.createAtaIdempotent(kp.publicKey, other, other, other)]],
    ['redemption', [IX.poolClaim(ids, other, [{ asset: other, dest: other }]), IX.openForRedemption(ids, other, kp.publicKey), IX.burnVault(ids, other, kp.publicKey, other, other, [])]],
    ['payout: expire', [IX.expireBoosts(ids, [other])]], ['payout: distribute', [IX.distribute(ids, other, kp.publicKey, other)]],
    ['claim', [IX.claimCharterVault(ids, { asset: other, owner: kp.publicKey, pob: other, pobCollection: other, pool: other, proof: [], name: 'CBOB Vault', uri: 'u' })]],
    ['draw', [IX.revealLevel(ids, other, [], kp.publicKey)]], ['rescue', [IX.rescueNested(ids, other, other, other, kp.publicKey)]],
    ['activate', [IX.activate(ids, other, other, other)]], ['probe (sweep helper)', [IX.sweepProbe(ids.SWEEP)]],
  ]
  for (const [name, ixs] of page) H.eq(`L1 accepted: the pages' own ${name} transaction`, txRefusal(enc(ixs)), null)
  // round 37 W6, the chosen rule: one CBOB instruction (even a no-op) carries the rest.
  // README "Enabling the RPC proxy" says so; the rate limits are what bound it.
  H.eq('W6: a no-op CBOB instruction plus a stranger\'s SOL transfer IS relayed (stated in the README)',
    [txRefusal(enc([IX.expireBoosts(ids, [other]), SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: other, lamports: 1 })])), !!txRefusal(enc([SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: other, lamports: 1 })]))], [null, true])
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

// ── 4. round 37 V1, end to end: 20,000 accounts parked at a deposit address, read by the
//    page's own reader through THIS proxy (its 8 MB streaming cap), from a fake upstream ──
{
  const vaultPda = ids.depositAddress(Keypair.generate().publicKey), RES3 = [0, 1, 2].map(() => Keypair.generate().publicKey)
  const tokData = (mint, own, amount) => { const b = Buffer.alloc(165); mint.toBuffer().copy(b, 0); own.toBuffer().copy(b, 32); b.writeBigUInt64LE(BigInt(amount), 64); b[108] = 1; return b }
  const acct = (data, prog, space = data.length) => ({ data: [data.toString('base64'), 'base64'], executable: false, lamports: 2039280, owner: prog, rentEpoch: 18446744073709551615, space })
  const rnd = () => bs58.encode(crypto.randomBytes(32))
  const mkChain = (emptyClassic, holdClassic = 0, t22 = 0, t22plain = 0) => {
    const m = new Map()
    RES3.forEach((r, i) => m.set(spl.getAssociatedTokenAddressSync(r, vaultPda, true).toBase58(), { prog: TOKEN, data: tokData(r, vaultPda, 1000 * (i + 1)) }))
    for (let i = 0; i < emptyClassic; i++) m.set(rnd(), { prog: TOKEN, data: tokData(RES3[0], vaultPda, 0) })
    for (let i = 0; i < holdClassic; i++) m.set(rnd(), { prog: TOKEN, data: tokData(Keypair.generate().publicKey, vaultPda, 1) })
    for (let i = 0; i < t22; i++) m.set(rnd(), { prog: TOKEN_2022, data: Buffer.concat([tokData(RES3[1], vaultPda, 0), Buffer.alloc(5)]) })   // 170 bytes: extensions
    for (let i = 0; i < t22plain; i++) m.set(rnd(), { prog: TOKEN_2022, data: tokData(RES3[1], vaultPda, 0) })                            // 165 bytes, empty
    return m
  }
  const answerFor = (chain, c) => {
    if (c.method === 'getMultipleAccounts') return { context: { slot: 1 }, value: c.params[0].map(a => chain.has(a) ? acct(chain.get(a).data, chain.get(a).prog) : null) }
    if (c.method === 'getProgramAccounts') {
      const [prog, cfg] = c.params, sz = cfg.filters.find(f => f.dataSize)?.dataSize, ds = cfg.dataSlice
      return [...chain].filter(([, v]) => v.prog === prog && (!sz || v.data.length === sz)).map(([k, v]) => ({ pubkey: k, account: acct(v.data.subarray(ds.offset, ds.offset + ds.length), prog) }))
    }
    if (c.method === 'getTokenAccountsByOwner') { const ds = c.params[2]?.dataSlice   // like Helius: the slice, and the account's real `space`
      return { context: { slot: 1 }, value: [...chain].filter(([, v]) => v.prog === c.params[1].programId).map(([k, v]) => ({ pubkey: k, account: acct(ds ? v.data.subarray(ds.offset, ds.offset + ds.length) : v.data, v.prog, v.data.length) })) } }
    throw new Error(`unexpected ${c.method}`)
  }
  let sizes = []
  const upstreamOf = chain => async (url, body) => {
    const calls = JSON.parse(body), one = !Array.isArray(calls)
    const out = (one ? [calls] : calls).map(c => ({ jsonrpc: '2.0', id: c.id, result: answerFor(chain, c) }))
    const text = JSON.stringify(one ? out[0] : out), buf = Buffer.from(text)
    sizes.push(buf.length)
    // the same streaming cap the live proxy applies (forwardFetch -> readCapped)
    const stream = new ReadableStream({ start(ctl) { for (let i = 0; i < buf.length; i += 65536) ctl.enqueue(new Uint8Array(buf.subarray(i, i + 65536))); ctl.close() } })
    return { status: 200, text: await readCapped(stream, MAX_RESPONSE) }
  }
  const viaProxy = async (chain, promised = [], failMulti = false, refuseProg = null) => {
    const up0 = upstreamOf(chain)
    // round 46: our Helius refuses a listing outright ("Too many accounts requested"), as a JSON-RPC error
    const up = async (url, body) => refuseProg && body.includes('getTokenAccountsByOwner') && body.includes(refuseProg)
      ? { status: 200, text: JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(body).id, error: { code: -32600, message: 'Too many accounts requested (Large number of pubkeys)' } }) } : up0(url, body)
    const srv2 = http.createServer(handler({ upstream: SECRET, das: SECRET, origin: 'https://centralbankofbitcoin.com', collection: COLL,
      forward: async (url, body) => { if (failMulti && body.includes('getMultipleAccounts')) throw new Error('upstream down'); return up(url, body) },
      limits: { default: [1000, 1000], sendTransaction: [1, 5], simulateTransaction: [3, 15], getProgramAccounts: [1000, 1000] } }))
    await new Promise(r => srv2.listen(0, '127.0.0.1', r))
    const conn = new Connection(`http://127.0.0.1:${srv2.address().port}/rpc`, { disableRetryOnRateLimit: true,
      fetch: (u, init) => fetch(u, { ...init, headers: { ...init.headers, origin: 'https://centralbankofbitcoin.com' } }) })
    sizes = []
    try { return await vaultWalletAccounts(conn, vaultPda, RES3, promised) } finally { srv2.close() }
  }
  const N = 20000
  const flood = mkChain(N)
  // the measurement: the OLD unbounded listing is over the cap, the new reads are not
  const oldSize = Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: 1, result: answerFor(flood, { method: 'getTokenAccountsByOwner', params: [vaultPda.toBase58(), { programId: TOKEN }] }) }))
  H.t(`V1 measured: the old one-call listing of ${N.toLocaleString('en-US')} accounts is ${(oldSize / 1048576).toFixed(1)} MB, over the 8 MB cap`, oldSize > MAX_RESPONSE)
  const r = await viaProxy(flood)
  H.eq(`V1: ${N.toLocaleString('en-US')} empty accounts through the proxy: the three reserves read, nothing else examined, nothing incomplete`,
    [r.tokens.map(t => t.parsed.amount), r.incomplete], [[1000n, 2000n, 3000n], null])
  H.t(`V1: ...every response stays under the cap (largest ${(Math.max(...sizes) / 1048576).toFixed(2)} MB, ${Math.round(Math.max(...sizes) / N)} bytes an account)`, Math.max(...sizes) < MAX_RESPONSE)
  const over = await viaProxy(mkChain(Math.ceil(MAX_RESPONSE / (Math.max(...sizes) / N)) + 1000))
  H.eq('V1: a flood past even the bounded listing\'s cap: the proxy refuses the listing, the reader does NOT throw, the reserves are still read, and the gap is reported',
    [over.tokens.map(t => t.parsed.amount), !!over.incomplete?.unlisted], [[1000n, 2000n, 3000n], true])
  // round 39 V39-1: a PROMISED account is re-read by address, so neither a failed listing nor the 200 cap hides it
  { const X = Keypair.generate().publicKey.toBase58(), withX = c => { c.set(X, { prog: TOKEN, data: tokData(Keypair.generate().publicKey, vaultPda, 5) }); return c }
    const overX = await viaProxy(withX(mkChain(Math.ceil(MAX_RESPONSE / 238) + 1000)), [X])
    H.eq('V39-1 reader: listing over the cap, the promised account is still read (by address)', [!!overX.incomplete?.unlisted, overX.tokens.find(t => t.address === X)?.parsed.amount], [true, 5n])
    const capX = await viaProxy(withX(mkChain(100, 400)), [X])
    H.eq('V39-1 reader: 400 other holding strays (past the 200 read in full), the promised account is still read', [capX.incomplete?.unexamined, capX.tokens.find(t => t.address === X)?.parsed.amount, capX.tokens.filter(t => t.address === X).length], [400 - STRAY_FULL_READ_MAX, 5n, 1])
    const failed = await viaProxy(withX(mkChain(10)), [X], true).then(() => 'resolved', e => e.constructor.name)
    H.eq('V39-1 reader: the by-address re-read FAILS: the read throws (the press stops), it never returns without the promised account', failed, 'ReadError') }
  const mixed = await viaProxy(mkChain(N, 150, 100, 300))
  H.eq(`V1: 150 holding classic strays, 100 170-byte Token-2022 accounts and 300 empty 165-byte ones (skipped, W10): at most ${STRAY_FULL_READ_MAX} examined, the rest COUNTED as unexamined`,
    [mixed.tokens.length, mixed.incomplete?.unexamined], [3 + STRAY_FULL_READ_MAX, 250 - STRAY_FULL_READ_MAX])
  // round 46 (our Helius refuses the Token-2022 listing): one program's listing refused never hides the other's
  { const c = mkChain(10, 3, 2)
    const no22 = await viaProxy(c, [], false, TOKEN_2022)
    H.eq('R46: the Token-2022 listing REFUSED: the classic strays are still listed and read, and ONLY Token-2022 is named as unlisted',
      [no22.tokens.length, no22.incomplete?.unlistedPrograms, /token2022/.test(no22.incomplete?.unlisted || '')], [3 + 3, ['token2022'], true])
    const noClassic = await viaProxy(c, [], false, TOKEN)
    H.eq('R46: ...the classic listing refused: the Token-2022 accounts are still listed and read, ONLY classic named',
      [noClassic.tokens.length, noClassic.incomplete?.unlistedPrograms], [3 + 2, ['token']])
    const ok = await viaProxy(c)
    H.eq('R46: ...both listings answering: every holding stray is read and nothing is incomplete', [ok.tokens.length, ok.incomplete], [3 + 3 + 2, null]) }
}

// ── 5. the same for the NFTs inside a vault: a flood never makes the read throw ──
{
  const vaultPda = ids.depositAddress(Keypair.generate().publicKey), rnd = () => bs58.encode(crypto.randomBytes(32))
  const s = x => { const b = Buffer.from(x); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]) }
  const assetData = coll => Buffer.concat([Buffer.from([1]), vaultPda.toBuffer(), Buffer.from([2]), new PublicKey(coll).toBuffer(), s('Some NFT'), s('https://example.invalid/a.json'), Buffer.from([0])])
  const acct = (data, prog) => ({ data: [data.toString('base64'), 'base64'], executable: false, lamports: 3000000, owner: prog, rentEpoch: 0, space: data.length })
  const mk = (foreign, ours = []) => { const m = new Map(); for (let i = 0; i < foreign; i++) m.set(rnd(), assetData(Keypair.generate().publicKey)); for (const a of ours) m.set(a, assetData(COLL)); return m }
  const upstreamOf = (chain, { fail = false, fatDas = false } = {}) => async (url, body) => {
    if (fail) throw new Error('upstream down')
    const c = JSON.parse(body)
    let result
    if (c.method === 'getProgramAccounts') result = [...chain.keys()].map(k => ({ pubkey: k, account: acct(Buffer.alloc(0), CORE) }))
    else if (c.method === 'getMultipleAccounts') result = { context: { slot: 1 }, value: c.params[0].map(a => chain.has(a) ? acct(chain.get(a), CORE) : null) }
    else if (c.method === 'getAssetsByOwner') { const all = [...chain.keys()], from = (c.params.page - 1) * c.params.limit
      result = { total: all.length, limit: c.params.limit, page: c.params.page, items: all.slice(from, from + c.params.limit).map(id => ({ id, interface: 'MplCoreAsset', compression: { compressed: false },
        content: { metadata: { name: fatDas ? 'x'.repeat(9000) : 'n' } } })) } }
    const buf = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: c.id, result }))
    const stream = new ReadableStream({ start(ctl) { for (let i = 0; i < buf.length; i += 65536) ctl.enqueue(new Uint8Array(buf.subarray(i, i + 65536))); ctl.close() } })
    return { status: 200, text: await readCapped(stream, MAX_RESPONSE) }
  }
  const nftsVia = async (chain, o) => {
    const srv3 = http.createServer(handler({ upstream: SECRET, das: SECRET, origin: 'https://centralbankofbitcoin.com', collection: COLL, forward: upstreamOf(chain, o),
      limits: { default: [1000, 1000], sendTransaction: [1, 5], simulateTransaction: [3, 15], getProgramAccounts: [1000, 1000] } }))
    await new Promise(r => srv3.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${srv3.address().port}/rpc`, realFetch = globalThis.fetch
    // the browser sends Origin itself; node does not, so add it (the pages' DAS read uses fetch directly)
    globalThis.fetch = (u, init = {}) => realFetch(u, { ...init, headers: { ...(init.headers || {}), origin: 'https://centralbankofbitcoin.com' } })
    const conn = new Connection(url, { disableRetryOnRateLimit: true, fetch: (u, init) => realFetch(u, { ...init, headers: { ...init.headers, origin: 'https://centralbankofbitcoin.com' } }) })
    try { return await coreAssetsOwnedBy({ ...P, rpc: url }, conn, ids, vaultPda) } finally { globalThis.fetch = realFetch; srv3.close() }
  }
  const down = await nftsVia(mk(3), { fail: true })
  H.eq('NFTs: BOTH reads failing (chain listing and the DAS index): no throw, nothing found, the gap reported', [down.assets, down.incomplete?.unlisted], [[], true])
  const flood = await nftsVia(mk(60000), { fatDas: true })
  H.eq('NFTs: 60,000 parked NFTs, the chain listing AND the index both over the 8 MB cap: no throw, the gap reported', [flood.assets.length, flood.incomplete?.unlisted], [0, true])
  const ours = Keypair.generate().publicKey.toBase58()
  const many = await nftsVia(mk(1000, [ours]))
  H.eq(`NFTs: 1,001 under the cap: listed, ${NFT_FULL_READ_MAX} read in full, the rest COUNTED`, [many.how, many.assets.length, many.incomplete], ['chain', NFT_FULL_READ_MAX, { unlisted: false, unexamined: 1001 - NFT_FULL_READ_MAX, cap: NFT_FULL_READ_MAX }])
  const few = await nftsVia(mk(5, [ours]))
  H.eq('NFTs: a CBOB vault among a few NFTs is FOUND (so the opening still refuses and offers the rescue), nothing incomplete', [few.assets.filter(a => a.ourVault).map(a => a.address), few.incomplete], [[ours], null])
}

// ── ROUND 42 (V42-1): the LOCAL ceremony server survives a malformed path ──
// Driven through its own exported listener on loopback: /%E0 and /% are a 404
// and the server keeps answering; a real file is served; escapes stay refused.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cbob-local-'))
  fs.mkdirSync(path.join(root, 'x')); fs.writeFileSync(path.join(root, 'x', 'index.html'), 'ok-page')
  const rpcCalls = []
  const srvL = http.createServer(localListener(root, (req, res) => { rpcCalls.push(req.url); res.end('rpc') }))
  await new Promise(r => srvL.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${srvL.address().port}`
  const get = async p => { try { const r = await fetch(base + p); return `${r.status}:${await r.text()}` } catch (e) { return `dead:${e.cause?.code || e.message}` } }
  const seq = [await get('/x/'), await get('/%E0'), await get('/%'), await get('/x/')]
  H.eq('V42-1: the local ceremony server answers /%E0 and /% with 404 and then STILL serves a real file', seq, ['200:ok-page', '404:not found', '404:not found', '200:ok-page'])
  H.eq('V42-1 controls: staticFile serves the file, refuses /../ escapes (plain and encoded) and a malformed escape', [
    staticFile(root, '/x/') === path.join(root, 'x', 'index.html'), staticFile(root, '/../etc/passwd'), staticFile(root, '/%2e%2e/%2e%2e/etc/passwd'), staticFile(root, '/%E0')],
    [true, null, null, null])
  srvL.close(); fs.rmSync(root, { recursive: true, force: true })
}

let threw = false; try { handler({ upstream: '', collection: COLL, origin: 'x', forward: async () => ({}) }) } catch { threw = true }
H.t('the proxy will not start without an upstream URL', threw)
threw = false; try { handler({ upstream: SECRET, origin: 'https://centralbankofbitcoin.com', forward: async () => ({}) }) } catch { threw = true }
H.t('the public proxy will not start without CBOB_VAULT_COLLECTION', threw)
// ── round 46: the rehearsal signing page, hosted (Gary 2026-10-09) ──
{
  const HOSTED = 'https://centralbankofbitcoin.com'
  H.eq('R46 origins: an https://host origin is accepted; *, http, a path, a user:password@ or a query are each refused',
    [judgeOrigins(HOSTED).origins, ...['*', 'https://*.example.com', 'http://centralbankofbitcoin.com', 'https://centralbankofbitcoin.com/x', 'https://u:p@centralbankofbitcoin.com', 'https://centralbankofbitcoin.com?x=1']
      .map(o => judgeOrigins(o).refuse.length === 1 && judgeOrigins(`${HOSTED},${o}`).origins.length === 0)],
    [[HOSTED], true, true, true, true, true, true])
  const rk = () => Keypair.generate().publicKey.toBase58()
  const reh = { seal: rk(), mint: rk(), burn: rk(), gov: rk(), sweep: rk() }
  const record = ['REHEARSAL TREE', 'id map (mainnet -> rehearsal):', ...Object.keys(reh).map(k => `  ${MAINNET_PROGRAMS[k]} ${reh[k]} ${k}`), '  /opt/cbob-vaults /tmp/x root', ''].join('\n')
  const tree = '/tmp/r46-tree', io = has => ({ tree, port: 8790, exists: f => has && f === `${tree}/REHEARSAL-RECORD.txt`, readFile: () => record })
  const throws = f => { try { f(); return null } catch (e) { return e.message } }
  const mainLocal = serverConfig({}, io(false))
  H.eq('R46 serverConfig: mainnet-local (the default) serves dist-mainnet-local to the two tunnel origins ONLY, with the mainnet program set',
    [mainLocal.root, mainLocal.origins, mainLocal.programs], [`${tree}/web/dist-mainnet-local`, ['http://localhost:8790', 'http://127.0.0.1:8790'], null])
  H.t('R46 serverConfig: ...and REFUSES any extra origin (the mainnet ceremony is reached through the SSH tunnel)',
    /rehearsal profile only/.test(throws(() => serverConfig({ CBOB_CEREMONY_ORIGINS: HOSTED }, io(true))) || ''))
  const rc = serverConfig({ CBOB_CEREMONY_PROFILE: 'rehearsal', CBOB_CEREMONY_ORIGINS: HOSTED }, io(true))
  H.eq('R46 serverConfig: rehearsal serves dist-rehearsal to the tunnel origins plus the named HTTPS origin, with the record\'s five program ids',
    [rc.root, rc.origins, rc.programs], [`${tree}/web/dist-rehearsal`, ['http://localhost:8790', 'http://127.0.0.1:8790', HOSTED], reh])
  H.eq('R46 serverConfig: ...refused outside a recorded tree, with a bad origin, or an unknown profile',
    [/not a recorded rehearsal tree/.test(throws(() => serverConfig({ CBOB_CEREMONY_PROFILE: 'rehearsal' }, io(false)))),
      /not an https:\/\/host origin/.test(throws(() => serverConfig({ CBOB_CEREMONY_PROFILE: 'rehearsal', CBOB_CEREMONY_ORIGINS: '*' }, io(true)))),
      /is not mainnet-local or rehearsal/.test(throws(() => serverConfig({ CBOB_CEREMONY_PROFILE: 'mainnet' }, io(true))))], [true, true, true])
  H.t('R46 rehearsalPrograms: a record line that does not map the MAINNET id is refused',
    /does not map the mainnet seal id/.test(throws(() => rehearsalPrograms(record.replace(MAINNET_PROGRAMS.seal, rk()))) || ''))
  // the proxy relays to the program set it was given, and to no other
  const kp = Keypair.generate(), rset = programSet(reh)
  const t = ixs => { const x = new Transaction().add(...ixs); x.feePayer = kp.publicKey; x.recentBlockhash = '11111111111111111111111111111111'
    return x.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') }
  const toProg = id => [t([new TransactionInstruction({ programId: new PublicKey(id), data: Buffer.from([1]), keys: [] })]), { encoding: 'base64' }]
  H.eq('R46 programSet: a transaction to a REHEARSAL program passes under the rehearsal set and is refused under the mainnet set; a MAINNET program the other way',
    [txRefusal(toProg(reh.seal), rset), !!txRefusal(toProg(reh.seal), MAINNET_SET), !!txRefusal(toProg(MAINNET_PROGRAMS.seal), rset), txRefusal(toProg(MAINNET_PROGRAMS.seal))],
    [null, true, true, null])
  H.eq('R46 programSet: the rehearsal MINT_AUTH is the rehearsal mint\'s PDA; four ids, or a repeated id, are refused',
    [rset.MINT_AUTH === PublicKey.findProgramAddressSync([Buffer.from('mint')], new PublicKey(reh.mint))[0].toBase58(), rset.MINT_AUTH !== MAINNET_SET.MINT_AUTH,
      !!throws(() => programSet({ ...reh, sweep: undefined })), !!throws(() => programSet({ ...reh, sweep: reh.seal }))], [true, true, true, true])
  const ng = fs.readFileSync(`${ROOT}/web/deploy/nginx-rehearsal-ceremony.conf.example`, 'utf8')
  H.t('R46 nginx-rehearsal-ceremony.conf.example: one unlisted location, basic auth, loopback 8790, no-store always, noindex, and the removal steps',
    /location \^~ \/REPLACE-WITH-UNLISTED-PATH\/ \{/.test(ng) && /auth_basic_user_file /.test(ng) && /proxy_pass http:\/\/127\.0\.0\.1:8790\/;/.test(ng) &&
    /add_header Cache-Control "no-store" always;/.test(ng) && /X-Robots-Tag "noindex/.test(ng) && /TO REMOVE IT/.test(ng) && !/Access-Control-Allow-Origin/.test(ng))
}
const conf = fs.readFileSync(`${ROOT}/web/deploy/nginx-rpc.conf`, 'utf8')
H.t('nginx-rpc.conf: POST only, 16k cap, rate limit, loopback proxy, no CORS header, no upstream URL',
  /limit_except POST \{ deny all; \}/.test(conf) && /client_max_body_size 16k;/.test(conf) && /limit_req zone=cbob_rpc/.test(conf) &&
  /proxy_pass http:\/\/127\.0\.0\.1:8789;/.test(conf) && !/^\s*add_header Access-Control/m.test(conf) && !/https:\/\/[^\s]*(helius|quicknode|alchemy|triton)/i.test(conf))
export default H.done()
