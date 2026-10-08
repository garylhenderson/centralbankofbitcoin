/**
 * THE METADATA GENERATOR, offline, against a mock connection and a mock fetch:
 * the files it writes, and that a vault it cannot read completely KEEPS its
 * previous file (never a wrong one), and that nothing is written when the vault
 * list cannot be read.
 */
import fs from 'fs'
import path from 'path'
import * as web3 from '@solana/web3.js'
import * as spl from '@solana/spl-token'
import { encode } from '../../bank/layout.mjs'
import { profile } from '../src/config.js'
import { makeIds, ata } from '../src/lib/ids.mjs'
import { generate, vaultJson, LEVEL_IMAGES, UNDRAWN_IMAGE, COLLECTION_IMAGE } from '../meta/generate.mjs'
import { harness, ROOT } from './ref.mjs'

const H = harness('meta')
const W = web3.PublicKey
const kp = n => web3.Keypair.fromSeed(Buffer.alloc(32, n)).publicKey
const COLL = kp(41)
const P = { ...profile('mainnet'), collection: COLL.toBase58() }
const ids = makeIds(P)
const CBBTC = new W('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij')
const D = '11111111111111111111111111111111'
const OUT = `${ROOT}/web/test/.out/meta`
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
const s = v => Buffer.concat([u32(Buffer.byteLength(v)), Buffer.from(v)])

const cfgData = encode('MintConfig', {
  version: 6, collection: COLL.toBase58(), governance: ids.GOV_PDA.toBase58(), pool_ata: ata(ids.MINT_CFG, CBBTC).toBase58(), round_id: 0, opens_at: 0, closes_at: 0,
  price: 0, cap: 0, minted_this_round: 0, minted_total: 4, max_supply: 2100, bank_treasury: P.squads, split_bps: 8500, sales_stopped: false, sweep_stopped: false,
  guardian: P.initAuthority, swap_operator: kp(9).toBase58(), sol_reserve_lamports: 50000000, bump: 255, max_sweep_lamports: 10000000000, sweep_cooldown_secs: 21600,
  last_sweep_at: 0, level_caps: [945, 525, 315, 210, 105], level_minted: [0, 0, 1, 0, 0], revealed_total: 1, payment_mint: CBBTC.toBase58(), pob_collection: kp(8).toBase58(),
  pob_root: 'ab'.repeat(32), charter_opens_at: 1, charter_closes_at: 2, charter_claimed: 2, bare_burns_retired: 0, total_active_weight: 0, active_count: 0, acc_scaled: 0,
  owed_scaled: 0, last_distribute_at: 0, sales_stopped_at: 0, sweep_stopped_at: 0, pending_swap_operator: D, pending_swap_operator_at: 0, monthly_secs: 2592000,
  pending_guardian: D, pending_guardian_set: false, pending_guardian_at: 0, notice_secs: 604800, sweep_floor_lamports: 1000000000, cooldown_ceiling_secs: 86400,
  reserve_ceiling_lamports: 100000000, dist_epoch: 0, pending_count: 0, pending_this_epoch: 0, cbob_mint: kp(7).toBase58(), max_boost_weight: 12, max_boost_epochs: 24,
  boost_price: 0, boost_weight: 0, boost_epochs: 0, boosts_active: 0, boosts_due: 0, boost_weight_total: 0, cbob_burned_total: 0, boost_expiring: Array(64).fill(0) })
const rec = (asset, o) => encode('VaultRecord', { version: 4, asset: asset.toBase58(), mint_index: 0, reveal_slot: 1, level: 0, charter: false, entropy_set: false,
  entropy: '00'.repeat(32), attrs_hash: '00'.repeat(32), bump: 254, active: false, retired: false, reschedules: 0, vault_ata: D, debt_scaled: 0, pending: false,
  request_epoch: 0, boost_weight: 0, boost_end_epoch: 0, carry_scaled: 0, ...o })
const assetData = (coll = COLL) => Buffer.concat([Buffer.from([1]), kp(1).toBuffer(), Buffer.from([2]), coll.toBuffer(), s('CBOB Vault'), s('u'), Buffer.from([0])])
const tok = amount => { const b = Buffer.alloc(165); spl.AccountLayout.encode({ mint: CBBTC, owner: kp(99), amount: BigInt(amount), delegateOption: 0, delegate: W.default, state: 1,
  isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: W.default }, b); return b }
const A = { drawn: kp(11), undrawn: kp(12), opened: kp(13), foreign: kp(14) }

const STATE = `${ROOT}/web/test/.out/meta-state.json`
function world(o = {}) {
  const acct = new Map()
  const put = (k, owner, data) => acct.set(new W(k).toBase58(), { owner: new W(owner), data: Buffer.from(data), lamports: 1, executable: false })
  put(ids.MINT_CFG, ids.MINT_PROG, cfgData)
  put(A.drawn, ids.CORE, assetData()); put(A.undrawn, ids.CORE, assetData()); put(A.opened, ids.CORE, Buffer.from([0])); put(A.foreign, ids.CORE, assetData(kp(77)))
  put(ata(ids.depositAddress(A.drawn), CBBTC), spl.TOKEN_PROGRAM_ID, tok(50_000))
  put(ata(ids.depositAddress(A.undrawn), CBBTC), spl.TOKEN_PROGRAM_ID, tok(0))
  const records = [
    [A.drawn, rec(A.drawn, { mint_index: 7, level: 3, charter: true, active: true })],
    [A.undrawn, rec(A.undrawn, { mint_index: 8 })],
    [A.opened, rec(A.opened, { mint_index: 9, level: 2, retired: true })],
    [A.foreign, rec(A.foreign, { mint_index: 10, level: 1 })],
  ]
  return {
    getMultipleAccountsInfo: async keys => { if (o.failAccounts) throw new Error('rpc down'); return keys.map(k => o.override?.(new W(k).toBase58()) ?? acct.get(new W(k).toBase58()) ?? null) },
    getMultipleAccountsInfoAndContext: async keys => { if (o.failAccounts) throw new Error('rpc down')
      return { context: { slot: o.slot ?? 1000 }, value: keys.map(k => { const kk = new W(k).toBase58(); const v = o.override?.(kk); return v === undefined ? acct.get(kk) || null : v }) } },
    getProgramAccounts: async () => { if (o.failList) throw new Error('getProgramAccounts refused')
      return records.map(([a, d]) => ({ pubkey: ids.vaultRecord(a), account: { data: o.records?.[a.toBase58()] || d, owner: ids.MINT_PROG } })) },
  }
}
const fetchOk = down => async (url) => ({ status: down?.has(url) ? 404 : 200, headers: { get: () => down?.has(url) ? 'text/html' : 'image/png' } })
const read = a => JSON.parse(fs.readFileSync(path.join(OUT, `${a.toBase58()}.json`), 'utf8'))

fs.rmSync(OUT, { recursive: true, force: true }); fs.rmSync(STATE, { force: true })
// nothing readable: nothing written
{
  const r = await generate({ conn: world({ failList: true }), profile: P, out: OUT, stateFile: STATE, fetchImpl: fetchOk() })
  H.t('the vault list cannot be read: FATAL, and nothing is written', !!r.fatal && !fs.existsSync(OUT))
}
// a normal pass
{
  const r = await generate({ conn: world(), profile: P, out: OUT, stateFile: STATE, fetchImpl: fetchOk() })
  H.eq('a pass: three vault files and collection.json written; the vault outside the collection kept (none written for it)',
    [r.fatal, [...r.written].sort(), r.kept.map(k => k.asset)], [null, [A.drawn, A.undrawn, A.opened].map(String).concat('collection').sort(), [A.foreign.toBase58()]])
  const d = read(A.drawn)
  H.eq('drawn vault: name, picture (the ratified Level III shell), link', [d.name, d.image, d.external_url],
    ['CBOB Vault #8', 'https://cdn.gary.club/cbob/vaults/v1/level-3/master.png', `https://centralbankofbitcoin.com/vault/?a=${A.drawn.toBase58()}`])
  H.eq('drawn vault: attributes Level, Charter, Activated, cbBTC', d.attributes, [{ trait_type: 'Level', value: 'III' }, { trait_type: 'Charter', value: 'Yes' },
    { trait_type: 'Activated', value: 'Yes' }, { trait_type: 'cbBTC', value: '0.00050000' }])
  H.eq('numbering counts from one: mint index 0 is CBOB Vault #1, index 2099 is #2100 (Gary 2026-10-07)',
    [vaultJson({ asset: A.drawn, record: { level: 0, mint_index: 0n }, burned: false, cbbtcSats: 0n }).name,
     vaultJson({ asset: A.drawn, record: { level: 0, mint_index: 2099n }, burned: false, cbbtcSats: 0n }).name], ['CBOB Vault #1', 'CBOB Vault #2100'])
  const u = read(A.undrawn)
  H.eq('undrawn vault: the covered-vault picture Gary chose, and no level claimed', [UNDRAWN_IMAGE, u.image, u.attributes[0].value],
    ['https://cdn.gary.club/cbob/vaults/v1/undrawn/master.png', 'https://cdn.gary.club/cbob/vaults/v1/undrawn/master.png', 'Not drawn yet'])
  H.eq('a vault that no longer exists: Activated "Gone", and the text does not claim its contents went to its owner (a bare burn destroys them)',
    [read(A.opened).attributes[2].value, /opened on the Bank's redeem page, which gives everything in it to its owner, or burned some other way, which destroys its contents/.test(read(A.opened).description)], ['Gone', true])
  H.t('the slot state file is written OUTSIDE the public directory', fs.existsSync(STATE) && !fs.readdirSync(OUT).some(f => f.includes('state')))
  const c = JSON.parse(fs.readFileSync(path.join(OUT, 'collection.json'), 'utf8'))
  H.eq('collection.json: the ruled name and the seal', [c.name, c.image], ['Central Bank of Bitcoin Vaults', COLLECTION_IMAGE])
  const all = fs.readdirSync(OUT).map(f => fs.readFileSync(path.join(OUT, f), 'utf8')).join('')
  H.t('no file carries an em dash', !all.includes('\u2014'))
  H.t('every picture used is one of the five verified level shells', Object.values(LEVEL_IMAGES).every(u => /^https:\/\/cdn\.gary\.club\/cbob\/vaults\/v1\/level-[1-5]\/master\.png$/.test(u)))
}
// a second pass with nothing changed
{
  const r = await generate({ conn: world(), profile: P, out: OUT, stateFile: STATE, fetchImpl: fetchOk() })
  H.eq('an unchanged pass rewrites nothing', [r.written.length, r.unchanged], [0, 3])
}
// fail closed per vault
{
  const before = fs.readFileSync(path.join(OUT, `${A.drawn.toBase58()}.json`), 'utf8')
  const r = await generate({ conn: world(), profile: P, out: OUT, stateFile: STATE, fetchImpl: fetchOk(new Set([LEVEL_IMAGES[3]])) })
  H.t('the Level III picture is down: that vault keeps its previous file, byte for byte', r.kept.some(k => k.asset === A.drawn.toBase58() && /picture/.test(k.why)) &&
    fs.readFileSync(path.join(OUT, `${A.drawn.toBase58()}.json`), 'utf8') === before)
  const r2 = await generate({ conn: world({ failAccounts: true }), profile: P, out: OUT, stateFile: STATE, fetchImpl: fetchOk() })
  H.t('the NFT reads fail: every vault keeps its previous file', (r2.fatal || r2.kept.length >= 3) && fs.readFileSync(path.join(OUT, `${A.drawn.toBase58()}.json`), 'utf8') === before)
  const r3 = await generate({ conn: world(), profile: { ...P, collection: kp(55).toBase58() }, out: OUT, stateFile: STATE, fetchImpl: fetchOk() })
  H.t('MINT names another collection than config.js: FATAL, nothing written', !!r3.fatal)
  const r4 = await generate({ conn: world(), profile: { ...P, collection: null }, out: OUT, stateFile: STATE, fetchImpl: fetchOk() })
  H.t('no collection configured: FATAL', !!r4.fatal)
}
// REVIEW L4: never an older view, never backwards
{
  const before = fs.readFileSync(path.join(OUT, `${A.drawn.toBase58()}.json`), 'utf8')
  const older = await generate({ conn: world({ slot: 999 }), profile: P, out: OUT, stateFile: STATE, fetchImpl: fetchOk() })
  H.t('L4: a read answered at an OLDER slot than the file\'s keeps the file', older.kept.some(k => k.asset === A.drawn.toBase58() && /older/.test(k.why)) &&
    fs.readFileSync(path.join(OUT, `${A.drawn.toBase58()}.json`), 'utf8') === before)
  const undrawn = await generate({ conn: world({ slot: 2000, records: { [A.drawn.toBase58()]: rec(A.drawn, { mint_index: 7, level: 0, charter: true, active: true }) } }), profile: P, out: OUT, stateFile: STATE, fetchImpl: fetchOk() })
  H.t('L4: a level reading as undrawn after it was drawn keeps the file (levels never undraw)', undrawn.kept.some(k => k.asset === A.drawn.toBase58() && /undrawn/.test(k.why)) &&
    fs.readFileSync(path.join(OUT, `${A.drawn.toBase58()}.json`), 'utf8') === before)
  const nullAta = await generate({ conn: world({ slot: 2001, override: k => k === ata(ids.depositAddress(A.drawn), CBBTC).toBase58() ? null : undefined }), profile: P, out: OUT, stateFile: STATE, fetchImpl: fetchOk() })
  H.t('L4: an earning vault\'s cbBTC account reading as missing keeps the file (never "0 cbBTC")', nullAta.kept.some(k => k.asset === A.drawn.toBase58() && /missing/.test(k.why)) &&
    fs.readFileSync(path.join(OUT, `${A.drawn.toBase58()}.json`), 'utf8') === before)
  const back = await generate({ conn: world({ slot: 2002, override: k => k === A.opened.toBase58() ? { owner: ids.CORE, data: Buffer.concat([Buffer.from([1]), kp(1).toBuffer(), Buffer.from([2]), COLL.toBuffer(), s('CBOB Vault'), s('u'), Buffer.from([0])]), lamports: 1, executable: false } : undefined,
    records: { [A.opened.toBase58()]: rec(A.opened, { mint_index: 9, level: 2 }) } }), profile: P, out: OUT, stateFile: STATE, fetchImpl: fetchOk() })
  H.t('L4: a vault reading as existing after it was gone keeps the file', back.kept.some(k => k.asset === A.opened.toBase58() && /gone/.test(k.why)))
  const newer = await generate({ conn: world({ slot: 3000 }), profile: P, out: OUT, stateFile: STATE, fetchImpl: fetchOk() })
  H.eq('L4: a NEWER complete read is accepted again', newer.kept.map(k => k.asset), [A.foreign.toBase58()])
  const noState = await generate({ conn: world(), profile: P, out: OUT, fetchImpl: fetchOk() })
  H.t('no state file given: FATAL, nothing written', !!noState.fatal)
}
// round 40 V40-3: a NEW, unfunded vault whose cbBTC account ADDRESS a stranger dusted (System-owned, 0 bytes)
{
  const OUT2 = `${ROOT}/web/test/.out/v40-meta`, ST2 = `${ROOT}/web/test/.out/v40-meta-state.json`
  const undrawnAta = ata(ids.depositAddress(A.undrawn), CBBTC).toBase58()
  const SYS = new W('11111111111111111111111111111111')
  for (const [label, val] of [['M0 control: the cbBTC account absent', null], ['M1: the cbBTC account ADDRESS dusted', { owner: SYS, data: Buffer.alloc(0), lamports: 650240, executable: false }]]) {
    fs.rmSync(OUT2, { recursive: true, force: true }); fs.rmSync(ST2, { force: true })
    const r = await generate({ conn: world({ override: k => k === undrawnAta ? val : undefined }), profile: P, out: OUT2, stateFile: ST2, fetchImpl: fetchOk() })
    const f = path.join(OUT2, `${A.undrawn.toBase58()}.json`)
    H.eq(`V40-3 ${label}, no previous file: the vault's file IS written, reading 0 sats, and it is not kept back`,
      [r.written.includes(A.undrawn.toBase58()), fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).attributes.find(a => a.trait_type === 'cbBTC')?.value, r.kept.some(k => k.asset === A.undrawn.toBase58())], [true, '0.00000000', false])
  }
  fs.rmSync(OUT2, { recursive: true, force: true }); fs.rmSync(ST2, { force: true })
  const wrong = await generate({ conn: world({ override: k => k === undrawnAta ? { owner: SYS, data: Buffer.alloc(8), lamports: 1, executable: false } : undefined }), profile: P, out: OUT2, stateFile: ST2, fetchImpl: fetchOk() })
  H.t('V40-3 control: an account there that is NOT a token account and not a stranger\'s bare lamports (it has data) is still refused', wrong.kept.some(k => k.asset === A.undrawn.toBase58() && /not a token account/.test(k.why)))
  fs.rmSync(OUT2, { recursive: true, force: true }); fs.rmSync(ST2, { force: true })
}
export default H.done()
