/**
 * "SHOW MY VAULTS", offline (round 46; Gary: "why do I have to put my address in. It
 * should show me my vaults and let me pick"). The DAS index and even the chain listing
 * are only SUGGESTIONS: every vault listed must be a live Core asset owned by this
 * wallet, in the vault collection, with a MINT VaultRecord naming it. Every lie the
 * index can tell (not owned, wrong collection, burned, no record, a record for another
 * asset, a retired one, an account Core does not own) lists NOTHING. The requests sent
 * are ones the relay accepts, and the pages keep the paste box.
 */
import fs from 'fs'
import * as web3 from '@solana/web3.js'
import { encode } from '../../bank/layout.mjs'
import { profile } from '../src/config.js'
import { makeIds } from '../src/lib/ids.mjs'
import { vaultsOwnedBy } from '../src/lib/reads.mjs'
import { myVaultsView } from '../src/lib/my-vaults.mjs'
import { refusal, gpaShape } from '../deploy/rpc-proxy.mjs'
import { harness, ROOT } from './ref.mjs'

const H = harness('mine')
const W = web3.PublicKey
const kp = n => web3.Keypair.fromSeed(Buffer.alloc(32, n)).publicKey
const COLL = kp(41)
const RPC = 'https://example.invalid/rpc'
const P = { ...profile('mainnet'), collection: COLL.toBase58(), rpc: RPC }
const ids = makeIds(P)
const D = '11111111111111111111111111111111'
const me = kp(1), stranger = kp(2)
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
const s = v => Buffer.concat([u32(Buffer.byteLength(v)), Buffer.from(v)])
const assetData = ({ owner = me, coll = COLL } = {}) => Buffer.concat([Buffer.from([1]), owner.toBuffer(), Buffer.from([2]), coll.toBuffer(), s('CBOB Vault'), s('u'), Buffer.from([0])])
const rec = (asset, o) => encode('VaultRecord', { version: 4, asset: asset.toBase58(), mint_index: 0, reveal_slot: 1, level: 0, charter: false, entropy_set: false,
  entropy: '00'.repeat(32), attrs_hash: '00'.repeat(32), bump: 254, active: false, retired: false, reschedules: 0, vault_ata: D, debt_scaled: 0, pending: false,
  request_epoch: 0, boost_weight: 0, boost_end_epoch: 0, carry_scaled: 0, ...o })

// the wallet's real vaults, and every lie an index (or a lying listing) can tell
const A = { drawn: kp(11), undrawn: kp(12), notMine: kp(13), foreign: kp(14), burned: kp(15), noRecord: kp(16), otherRecord: kp(17), retired: kp(18), spoof: kp(19), badRecordOwner: kp(20) }
function chain() {
  const m = new Map(), put = (k, owner, data) => m.set(k.toBase58(), { owner, data: Buffer.from(data), lamports: 1, executable: false })
  put(A.drawn, ids.CORE, assetData()); put(ids.vaultRecord(A.drawn), ids.MINT_PROG, rec(A.drawn, { level: 3, entropy_set: true, active: true }))
  put(A.undrawn, ids.CORE, assetData()); put(ids.vaultRecord(A.undrawn), ids.MINT_PROG, rec(A.undrawn))
  put(A.notMine, ids.CORE, assetData({ owner: stranger })); put(ids.vaultRecord(A.notMine), ids.MINT_PROG, rec(A.notMine, { level: 2 }))
  put(A.foreign, ids.CORE, assetData({ coll: kp(77) })); put(ids.vaultRecord(A.foreign), ids.MINT_PROG, rec(A.foreign, { level: 1 }))
  put(A.burned, ids.CORE, Buffer.from([0])); put(ids.vaultRecord(A.burned), ids.MINT_PROG, rec(A.burned, { level: 4 }))
  put(A.noRecord, ids.CORE, assetData())
  put(A.otherRecord, ids.CORE, assetData()); put(ids.vaultRecord(A.otherRecord), ids.MINT_PROG, rec(A.drawn, { level: 5 }))
  put(A.retired, ids.CORE, assetData()); put(ids.vaultRecord(A.retired), ids.MINT_PROG, rec(A.retired, { level: 2, retired: true }))
  put(A.spoof, ids.MINT_PROG, assetData()); put(ids.vaultRecord(A.spoof), ids.MINT_PROG, rec(A.spoof, { level: 1 }))
  put(A.badRecordOwner, ids.CORE, assetData()); put(ids.vaultRecord(A.badRecordOwner), new W(D), rec(A.badRecordOwner, { level: 1 }))
  return m
}
const ALL = Object.values(A).map(k => k.toBase58())
// o.list: what getProgramAccounts answers (null = it fails); o.das: what getAssetsByOwner answers (null = it fails)
function world(o = {}) {
  const m = chain(), sent = []
  const conn = {
    getProgramAccounts: async (prog, cfg) => { sent.push({ method: 'getProgramAccounts', prog: prog.toBase58(), cfg })
      if (!o.list) throw new Error('getProgramAccounts refused'); return o.list.map(a => ({ pubkey: new W(a), account: { data: Buffer.alloc(0), owner: ids.CORE } })) },
    getMultipleAccountsInfo: async keys => { sent.push({ method: 'getMultipleAccounts', n: keys.length }); if (o.failAccounts) throw new Error('rpc down')
      return keys.map(k => m.get(new W(k).toBase58()) || null) },
  }
  const fetchImpl = async (url, init) => { const c = JSON.parse(init.body); sent.push(c)
    if (!o.das) return { ok: false, status: 503, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: c.id, result: { items: o.das.map(id => ({ id, interface: 'MplCoreAsset', compression: { compressed: false } })) } }) } }
  return { conn, fetchImpl, sent }
}
async function run(o) {
  const w = world(o), real = globalThis.fetch
  globalThis.fetch = w.fetchImpl
  try { return { r: await vaultsOwnedBy(P, w.conn, ids, me), sent: w.sent } } catch (e) { return { err: e.message, sent: w.sent } } finally { globalThis.fetch = real }
}
const listed = r => r.vaults.map(v => v.address).sort()
const WANT = [A.drawn, A.undrawn].map(k => k.toBase58()).sort()

const viaChain = await run({ list: ALL, das: ALL })
H.eq('the chain listing names every lie: ONLY the two real vaults are listed', listed(viaChain.r), WANT)
H.eq('...read from the chain listing', viaChain.r.how, 'chain')
H.eq('...with each one\'s level and whether it is active', viaChain.r.vaults.map(v => [v.address, v.level, v.active]).sort(),
  [[A.drawn.toBase58(), 3, true], [A.undrawn.toBase58(), 0, false]].sort())
const viaDas = await run({ list: null, das: ALL })
H.eq('the chain listing down, DAS lists every lie: STILL only the two real vaults (each verified on chain)', listed(viaDas.r), WANT)
H.eq('...read from the index', viaDas.r.how, 'index')
for (const [name, k] of Object.entries(A).filter(([n]) => n !== 'drawn' && n !== 'undrawn')) {
  const one = await run({ list: null, das: [k.toBase58()] })
  H.eq(`DAS lies (${name}): nothing listed`, one.r.vaults, [])
}
const down = await run({ list: null, das: null })
H.eq('both listings fail: no throw, nothing listed, the gap REPORTED (so the page says so and shows the box)', [down.r.vaults, down.r.unlisted], [[], true])
const empty = await run({ list: null, das: [] })
H.eq('DAS empty and the chain listing down: nothing listed, reported as found-none (not a failure)', [empty.r.vaults, empty.r.unlisted], [[], false])
const recDown = await run({ list: ALL, das: ALL, failAccounts: true })
H.eq('the account reads fail: nothing listed and the gap reported, never a list built from the listing alone', [recDown.r?.vaults, recDown.r?.unlisted], [[], true])

// the relay serves exactly what this sends, for a WALLET owner (not only a deposit PDA)
const gpa = viaChain.sent.filter(c => c.method === 'getProgramAccounts')
const asCall = c => ({ jsonrpc: '2.0', id: 1, method: 'getProgramAccounts', params: [c.prog, { encoding: 'base64', ...c.cfg }] })
H.eq('the chain listing is the relay\'s core-owner shape, for the wallet', gpa.map(c => gpaShape(asCall(c).params[0], asCall(c).params[1], COLL.toBase58())), ['core-owner'])
H.eq('...and the relay accepts it', gpa.map(c => refusal(asCall(c), { collection: COLL.toBase58() })), [null])
const dasCalls = viaChain.sent.filter(c => c.method === 'getAssetsByOwner')
H.t('the DAS call names this wallet and is accepted by the relay', dasCalls.length >= 1 && dasCalls.every(c => c.params.ownerAddress === me.toBase58() && refusal(c, { collection: COLL.toBase58() }) === null))
H.t('every account read is at most 100 accounts (the relay\'s getMultipleAccounts limit)', viaChain.sent.filter(c => c.method === 'getMultipleAccounts').every(c => c.n <= 100))

// what the pick list SAYS
const v2 = myVaultsView(viaChain.r)
H.eq('two vaults: a pick list, one button each, level shown, undrawn named as such', [v2.kind, v2.items.map(i => i.label).sort()], ['pick', ['CBOB Vault, Level III, active', 'CBOB Vault, not drawn yet']])
H.t('...and the paste box is offered as well', /paste another address below/.test(v2.text), v2.text)
H.eq('one vault: singular wording', myVaultsView({ vaults: [viaChain.r.vaults[0]], how: 'chain' }).text.startsWith('Your vault ('), true)
H.eq('unlisted: a note saying the list could not be read, pointing at the box', [myVaultsView(down.r).kind, /could not list.*Paste your vault/.test(myVaultsView(down.r).text)], ['note', true])
H.eq('no result at all (an error): the same note', myVaultsView(null).kind, 'note')
H.eq('none found: a note pointing at the box', [myVaultsView(empty.r).kind, /No vaults were found.*paste/.test(myVaultsView(empty.r).text)], ['note', true])
H.t('a wallet with more NFTs than are read at once: says a vault may be missing and can be pasted', /can still be pasted/.test(myVaultsView({ vaults: [], how: 'chain', more: true }).more || ''))
H.t('no em dashes anywhere in the wording', ![v2, myVaultsView(down.r), myVaultsView(empty.r), myVaultsView({ vaults: [], more: true })].some(v => /—/.test(JSON.stringify(v))))

// the pages: the pick list after Phantom connects, and the paste box kept
const src = f => fs.readFileSync(`${ROOT}/web/src/${f}`, 'utf8')
H.t('redeem page: lists the wallet\'s vaults once Phantom connects; a pick fills the box and checks it',
  /showMyVaults\(\$\('#mine'\), \{[^}]*owner: wallet\.publicKey,[^}]*onPick: a => \{ \$\('#asset'\)\.value = a; check\(\) \}/.test(src('pages/redeem.mjs')))
H.t('vault page: a "Show my vaults" button connects Phantom and lists them; a pick fills the box and looks it up',
  /\$\('#mine-btn'\)/.test(src('pages/vault.mjs')) && /showMyVaults\(\$\('#mine'\), \{[^}]*onPick: a => \{ input\.value = a; lookup\(a\) \}/.test(src('pages/vault.mjs')))
H.t('both pages keep the paste-an-address box and have the list\'s place', ['html/redeem.html', 'html/vault.html'].every(f => /id="mine"/.test(src(f))) &&
  /id="asset"/.test(src('html/redeem.html')) && /id="mine-btn"/.test(src('html/vault.html')))
export default H.done()
