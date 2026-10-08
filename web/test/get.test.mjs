/**
 * GETTING A VAULT, offline: the charter claim (real 240-address set, real proof,
 * the suite's own builder), the purchase (max_price = the price read), the level
 * draw, and every refusal, both ways.
 */
import fs from 'fs'
import * as web3 from '@solana/web3.js'
import * as spl from '@solana/spl-token'
import { encode, decode } from '../../bank/layout.mjs'
import { proofOf, verify, rootOf } from '../../scripts/pob-merkle.mjs'
import { profile, SITE } from '../src/config.js'
import { makeIds, ata } from '../src/lib/ids.mjs'
import { planClaim, planBuy, planDraw, readySlot, vaultMeta } from '../src/lib/plan-get.mjs'
import { legacySize, PACKET_LIMIT } from '../src/lib/plan-redeem.mjs'
import { SUITE, ROOT, extractConst, ts2js, evalWith, scopeFor, diffIx, harness } from './ref.mjs'

const H = harness('get')
const W = web3.PublicKey
const kp = n => web3.Keypair.fromSeed(Buffer.alloc(32, n)).publicKey
const COLL = kp(41)
const ids = makeIds({ ...profile('mainnet'), collection: COLL.toBase58() })
const SET = JSON.parse(fs.readFileSync(`${ROOT}/scripts/pob-set.json`, 'utf8'))
const CBBTC = new W('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij')
const POOL = ata(ids.MINT_CFG, CBBTC)
const owner = kp(1), stranger = kp(5), asset = kp(3)
const D = '11111111111111111111111111111111'
const NOW = 1_900_000_000
const mintCfg = (o = {}) => decode('MintConfig', encode('MintConfig', {
  version: 6, collection: COLL.toBase58(), governance: ids.GOV_PDA.toBase58(), pool_ata: POOL.toBase58(), round_id: 1, opens_at: NOW - 100, closes_at: NOW + 3600,
  price: 21000, cap: 10, minted_this_round: 2, minted_total: 100, max_supply: 2100, bank_treasury: D.replace(/1$/, '2'), split_bps: 8500,
  sales_stopped: false, sweep_stopped: false, guardian: owner.toBase58(), swap_operator: kp(9).toBase58(), sol_reserve_lamports: 50000000, bump: 255,
  max_sweep_lamports: 10000000000, sweep_cooldown_secs: 21600, last_sweep_at: 0, level_caps: [945, 525, 315, 210, 105], level_minted: [10, 0, 0, 0, 0],
  revealed_total: 7, payment_mint: CBBTC.toBase58(), pob_collection: SET.collection, pob_root: SET.root, charter_opens_at: NOW - 100, charter_closes_at: NOW + 600000,
  charter_claimed: 10, bare_burns_retired: 0, total_active_weight: 0, active_count: 0, acc_scaled: 0, owed_scaled: 0, last_distribute_at: 0,
  sales_stopped_at: 0, sweep_stopped_at: 0, pending_swap_operator: D, pending_swap_operator_at: 0, monthly_secs: 2592000, pending_guardian: D,
  pending_guardian_set: false, pending_guardian_at: 0, notice_secs: 604800, sweep_floor_lamports: 1000000000, cooldown_ceiling_secs: 86400,
  reserve_ceiling_lamports: 100000000, dist_epoch: 0, pending_count: 0, pending_this_epoch: 0, cbob_mint: kp(7).toBase58(), max_boost_weight: 12,
  max_boost_epochs: 24, boost_price: 0, boost_weight: 0, boost_epochs: 0, boosts_active: 0, boosts_due: 0, boost_weight_total: 0, cbob_burned_total: 0,
  boost_expiring: Array(64).fill(0), ...o }))
const coreAsset = (o = {}) => { const pl = Object.assign([...(o.plugins || [])], { externalCount: o.external || 0 })
  return { burned: false, owner: owner.toBase58(), collection: SET.collection, plugins: pl, plugin: t => pl.find(x => x.type === t) || null, ...o, ...{ plugins: pl } } }
const HELD = 5
const pobs = (f = {}) => SET.assets.map((a, i) => ({ address: a.address, programOwner: ids.CORE.toBase58(),
  info: i === HELD ? coreAsset(f) : coreAsset({ owner: stranger.toBase58() }) }))
const snapC = (o = {}) => ({ mintConfig: mintCfg(o.cfg), nowSec: o.now ?? NOW, owner: owner.toBase58(), pobSet: o.set || SET, pobs: o.pobs || pobs(),
  pobCollection: o.coll === undefined ? { plugins: Object.assign([], { externalCount: 0 }) } : o.coll })

// ── the claim ──
const addrs = SET.assets.map(a => new W(a.address).toBytes())
{
  const p = planClaim(ids, SITE, snapC(), asset)
  H.eq('claim: ready, picks the one Proof of Burn this wallet holds', [p.ok, p.pick?.edition, p.refuse], [true, SET.assets[HELD].edition, []])
  const proof = proofOf(addrs, HELD)
  H.t('claim: the proof is the set\'s own (scripts/pob-merkle.mjs) and verifies against the committed root',
    verify(new W(SET.assets[HELD].address).toBytes(), proof, Buffer.from(SET.root, 'hex')) && Buffer.from(rootOf(addrs)).toString('hex') === SET.root)
  H.eq('claim: depth 8 for the 240-address set', p.proofDepth, 8)
  const sc = scopeFor(ids, { mint: CBBTC, POOL, POOLK: { pubkey: POOL, isSigner: false, isWritable: false }, MOMENTS: new W(SET.collection),
    ata: (o, m = CBBTC) => spl.getAssociatedTokenAddressSync(m, o, true) })
  // the suite's builder hard-codes its own name and link; the page's are ruled ones, so compare accounts and the proof bytes
  const ref = evalWith(ts2js(extractConst(SUITE, 'ixClaim')), sc, 'ixClaim')(asset, owner, owner, new W(SET.assets[HELD].address), proof.map(b => Buffer.from(b)))
  H.eq('claim: every account, order and flag == the suite\'s ixClaim', diffIx({ ...ref, data: p.ix.data }, p.ix), [])
  const tail = b => b.subarray(b.length - (4 + 32 * 8 + 1))
  H.t('claim: the proof and pob_extra = 0 are byte-identical to the suite\'s encoding', tail(Buffer.from(p.ix.data)).equals(tail(Buffer.from(ref.data))) && p.ix.data.at(-1) === 0)
  H.eq('claim: name "CBOB Vault", metadata at https://centralbankofbitcoin.com/v/<asset>.json', [p.name, p.uri], ['CBOB Vault', `https://centralbankofbitcoin.com/v/${asset.toBase58()}.json`])
  H.t('claim: the link fits MINT\'s 200 bytes and the name its 64', p.uri.length <= 200 && p.name.length <= 64)
  H.t('claim: NO crank and no pass-through accounts (13 accounts exactly)', p.ix.keys.length === 13)
  const size = legacySize([p.ix], owner)
  H.t(`claim: the widest real shape (depth-8 proof, owner pays) fits a legacy transaction (${size} bytes)`, size <= PACKET_LIMIT)
  H.t('claim: the new vault\'s address signs (it is a new account)', p.ix.keys[2].pubkey.equals(asset) && p.ix.keys[2].isSigner)
}
const refusedC = (name, s, re) => { const p = planClaim(ids, SITE, s, asset); H.t(`claim refused: ${name}`, !p.ok && p.refuse.some(r => re.test(r)), p.refuse.join(' | ')) }
refusedC('before the window opens', snapC({ cfg: { charter_opens_at: NOW + 60 } }), /has not opened yet/)
refusedC('after the window closes', snapC({ cfg: { charter_closes_at: NOW } }), /closed/)
refusedC('every vault already created', snapC({ cfg: { minted_total: 2100 } }), /All 2,100/)
refusedC('the wallet holds no Proof of Burn', snapC({ pobs: SET.assets.map(a => ({ address: a.address, programOwner: ids.CORE.toBase58(), info: coreAsset({ owner: stranger.toBase58() }) })) }), /does not hold a Proof of Burn/)
refusedC('a burned Proof of Burn does not count', snapC({ pobs: pobs({ burned: true }) }), /does not hold a Proof of Burn/)
refusedC('a Proof of Burn outside the PoB collection does not count', snapC({ pobs: pobs({ collection: kp(77).toBase58() }) }), /does not hold a Proof of Burn/)
refusedC('the Bank committed to a different root', snapC({ cfg: { pob_root: '00'.repeat(31) + '01' } }), /does not match/)
refusedC('the PoB collection carries an external plugin (SPEC 46)', snapC({ coll: { plugins: Object.assign([], { externalCount: 1 }) } }), /external plugin/)
refusedC('the Proof of Burn itself carries an external plugin', snapC({ pobs: pobs({ external: 1 }) }), /external plugin/)
refusedC('a frozen Proof of Burn', snapC({ pobs: pobs({ plugins: [{ type: 'FreezeDelegate', body: { frozen: true } }] }) }), /frozen/)
refusedC('the PoB collection cannot be read', snapC({ coll: null }), /could not be read/)
refusedC('a Proof of Burn whose plugins cannot be read (it cannot be shown not to be frozen)', snapC({ pobs: pobs({ pluginsUnreadable: true }) }), /cannot read/)
{
  const p = planClaim(ids, SITE, snapC(), asset, SET.assets[HELD + 1].address)
  H.t('claim refused: choosing someone else\'s Proof of Burn', !p.ok && p.refuse.some(r => /not held by this wallet/.test(r)))
}

// ── the purchase ──
const snapB = (o = {}) => ({ mintConfig: mintCfg(o.cfg), nowSec: o.now ?? NOW, owner: owner.toBase58(),
  payerToken: o.payerToken === undefined ? { state: 1, amount: 50_000n } : o.payerToken, revenueTokenExists: o.rev ?? true })
{
  const p = planBuy(ids, SITE, snapB(), asset)
  H.eq('buy: ready, at the price read on chain, 8 left', [p.ok, p.price, p.left], [true, 21000n, 8])
  const sc = scopeFor(ids, { mint: CBBTC, POOL, POOLK: { pubkey: POOL, isSigner: false, isWritable: false }, revAta: ata(ids.REVENUE, CBBTC), PRICE: 21000n,
    ata: (o, m = CBBTC) => spl.getAssociatedTokenAddressSync(m, o, true), attrs: () => Buffer.from([0, 0, 0, 0]) })
  const ref = evalWith(ts2js(extractConst(SUITE, 'ixMint')), sc, 'ixMint')(asset, owner, owner, { name: 'CBOB Vault', uri: p.uri, maxPrice: 21000n })
  H.eq('buy: == the suite\'s ixMint with the ruled name, link and max_price = the round price', diffIx(p.ix, ref), [])
  H.eq('buy: max_price in the data is the price read', p.ix.data.readBigUInt64LE(8 + 4 + 10 + 4 + p.uri.length), 21000n)
  H.t('buy: NO crank (15 accounts exactly), fits', p.ix.keys.length === 15 && legacySize([p.ix], owner) <= PACKET_LIMIT)
}
const refusedB = (name, s, re) => { const p = planBuy(ids, SITE, s, asset); H.t(`buy refused: ${name}`, !p.ok && p.refuse.some(r => re.test(r)), p.refuse.join(' | ')) }
refusedB('sales stopped by the guardian', snapB({ cfg: { sales_stopped: true } }), /Sales are stopped/)
refusedB('no round voted yet', snapB({ cfg: { round_id: 0 } }), /No sale round/)
refusedB('the round has not opened', snapB({ cfg: { opens_at: NOW + 10 } }), /opens/)
refusedB('the round has closed', snapB({ cfg: { closes_at: NOW } }), /closed/)
refusedB('the round is sold out', snapB({ cfg: { minted_this_round: 10 } }), /sold out/)
refusedB('every level allotted', snapB({ cfg: { level_caps: [20, 20, 20, 20, 20] } }), /Every level/)
refusedB('the wallet lacks cbBTC', snapB({ payerToken: { state: 1, amount: 20_999n } }), /holds 20999 sats/)
refusedB('the wallet has no cbBTC account', snapB({ payerToken: null }), /no cbBTC account/)
refusedB('the wallet\'s cbBTC is frozen', snapB({ payerToken: { state: 2, amount: 99_999n } }), /frozen/)
refusedB('the revenue account is missing', snapB({ rev: false }), /revenue account/)
{
  let threw = ''; try { vaultMeta({ ...SITE, metadataBase: 'https://centralbankofbitcoin.com/' + 'x'.repeat(170) + '/' }, asset) } catch (e) { threw = e.message }
  H.t('a metadata link MINT would refuse (over 200 bytes) is refused before signing', /longer than MINT allows/.test(threw))
}

// ── the draw ──
{
  const rec = (o = {}) => ({ level: 0, mint_index: 7, reveal_slot: 1000, entropy_set: false, ...o })
  const info = coreAsset({ plugins: [{ type: 'Attributes', body: { attributeList: [{ key: 'charter', value: SET.assets[HELD].address }] } }] })
  const mc = mintCfg()
  const at = (r, slot) => planDraw(ids, mc, asset, info, r, slot, owner)
  H.eq('draw: a drawn level is reported', at(rec({ level: 4 }), 5000).state, 'drawn')
  H.eq('draw: before its blocks exist, wait (ready after slot ' + readySlot(1000) + ')', [at(rec(), 1000).state, at(rec(), readySlot(1000)).state], ['wait', 'wait'])
  const rv = at(rec(), readySlot(1000) + 1)
  H.eq('draw: next in line and in its window: reveal_level', rv.state, 'reveal')
  const sc = scopeFor(ids, { SLOT_HASHES: new W('SysvarS1otHashes111111111111111111111111111'), deployer: { publicKey: owner },
    attrs: list => Buffer.concat([Buffer.from(Uint32Array.of(list.length).buffer), ...list.flatMap(([k, v]) => [Buffer.concat([Buffer.from(Uint32Array.of(k.length).buffer), Buffer.from(k)]), Buffer.concat([Buffer.from(Uint32Array.of(v.length).buffer), Buffer.from(v)])])]) })
  H.eq('draw: ...re-supplying the minted provenance (the charter attribute) == the suite\'s ixReveal',
    diffIx(rv.ix, evalWith(ts2js(extractConst(SUITE, 'ixReveal')), sc, 'ixReveal')(asset, [['charter', SET.assets[HELD].address]], owner)), [])
  H.eq('draw: not next, entropy not yet captured: capture_entropy', at(rec({ mint_index: 9 }), readySlot(1000) + 1).state, 'capture')
  H.eq('draw: not next, captured: wait for the queue', at(rec({ mint_index: 9, entropy_set: true }), readySlot(1000) + 1).state, 'queued')
  H.eq('draw: window missed, nothing captured: reschedule_reveal', at(rec(), 1000 + 301).state, 'reschedule')
  H.eq('draw: window missed but captured, and next: reveal from the stored entropy', at(rec({ entropy_set: true }), 1000 + 301).state, 'reveal')
  H.eq('draw: the reschedule == the suite\'s ixReschedule', diffIx(at(rec(), 1301).ix, evalWith(ts2js(extractConst(SUITE, 'ixReschedule')), sc, 'ixReschedule')(asset)), [])
  H.eq('draw: a vault whose plugins cannot be read: no draw offered (its minted attributes are unknown)', planDraw(ids, mc, asset, { ...info, pluginsUnreadable: true }, rec(), readySlot(1000) + 1).state, 'unknown')
  H.t('draw: every message is free of em dashes', [rv, at(rec(), 1000), at(rec({ mint_index: 9 }), 1100), at(rec(), 1301)].every(d => !d.text.includes('\u2014')))
}
// ── round 41 C2 (gate 5): the BUY PAGE'S OWN READ (readBuySnapshot, which buy.mjs calls) with dusted addresses ──
{
  const { readBuySnapshot } = await import('../src/lib/reads.mjs')
  const SYS = new W(D), TOKEN = spl.TOKEN_PROGRAM_ID
  const seal = encode('SealConfig', { version: 2, collection: COLL.toBase58(), reserve_mints: [CBBTC.toBase58(), kp(61).toBase58(), kp(62).toBase58()], bump: 255 })
  const burn = encode('BurnConfig', { version: 4, collection: COLL.toBase58(), bump: 255, burned_total: 0, redeem_window_secs: 3600, rate_head: 0, rate_ring: Array(64).fill(0) })
  const clock = (() => { const c = Buffer.alloc(40); c.writeBigInt64LE(BigInt(NOW), 32); return c })()
  const tokenData = (own, amount) => { const b = Buffer.alloc(165); spl.AccountLayout.encode({ mint: CBBTC, owner: own, amount: BigInt(amount), delegateOption: 0, delegate: W.default, state: 1,
    isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: W.default }, b); return b }
  const dust = { owner: SYS, data: Buffer.alloc(0), lamports: 650240, executable: false }
  const holderAta = ata(owner, CBBTC), revAta = ata(ids.REVENUE, CBBTC)
  const world = (o = {}) => { const m = new Map([[ids.SEAL_CFG.toBase58(), { owner: ids.SEAL_PROG, data: seal, lamports: 1, executable: false }],
      [ids.MINT_CFG.toBase58(), { owner: ids.MINT_PROG, data: encode('MintConfig', mintCfg()), lamports: 1, executable: false }],
      [ids.BURN_CFG.toBase58(), { owner: ids.BURN_PROG, data: burn, lamports: 1, executable: false }],
      ['SysvarC1ock11111111111111111111111111111111', { owner: new W('Sysvar1111111111111111111111111111111111111'), data: clock, lamports: 1, executable: false }]])
    const set = (k, v) => { if (v !== undefined) v === null ? m.delete(k.toBase58()) : m.set(k.toBase58(), v) }
    set(holderAta, o.holder === undefined ? { owner: TOKEN, data: tokenData(owner, 50_000), lamports: 1, executable: false } : o.holder)
    set(revAta, o.rev === undefined ? { owner: TOKEN, data: tokenData(ids.REVENUE, 0), lamports: 1, executable: false } : o.rev)
    return { getAccountInfo: async k => m.get(new W(k).toBase58()) || null } }
  const ok = await readBuySnapshot(world(), ids, owner)
  H.eq('C2 control: the buy page\'s own read, everything set up: the plan is ready', [ok.revenueTokenExists, ok.payerToken?.amount, planBuy(ids, SITE, ok, asset).ok], [true, 50000n, true])
  const revDust = await readBuySnapshot(world({ rev: dust }), ids, owner), pr = planBuy(ids, SITE, revDust, asset)
  H.eq('C2: the REVENUE cbBTC address dusted: the read says not set up (no throw), and the page refuses "not set up yet" with no mint_vault',
    [revDust.revenueTokenExists, pr.ok, pr.refuse.some(r => /revenue account for cbBTC is not set up yet/.test(r)), pr.ix ?? null], [false, false, true, null])
  const holderDust = await readBuySnapshot(world({ holder: dust }), ids, owner), ph = planBuy(ids, SITE, holderDust, asset)
  H.eq('C2: the HOLDER\'s cbBTC address dusted: "no cbBTC account" (never "could not be read")', [holderDust.payerToken, ph.refuse.some(r => /has no cbBTC account/.test(r))], [null, true])
  const bad = await readBuySnapshot(world({ holder: { owner: TOKEN, data: Buffer.alloc(10), lamports: 1, executable: false } }), ids, owner).then(() => 'read', e => e.message)
  H.t('C2 control: a TOKEN-owned holder account that cannot be parsed still refuses ("could not be read")', /could not be read/.test(bad), bad)
  H.t('C2: buy.mjs gets its snapshot from readBuySnapshot (this test drives the page\'s own read)', /const read = conn => readBuySnapshot\(conn, ids, wallet\.publicKey\)/.test(fs.readFileSync(`${ROOT}/web/src/pages/buy.mjs`, 'utf8')))
}
export default H.done()
