/**
 * THE REDEMPTION PLAN, offline, on synthetic chain snapshots built with the
 * Bank's own layout encoder. The plain case is compared as a WHOLE legacy
 * message against the Test Vault simulation's S8 builders; every rule of SPEC
 * item 50 and round 35 C5 is driven both ways.
 */
import fs from 'fs'
import * as web3 from '@solana/web3.js'
import * as spl from '@solana/spl-token'
import { encode, decode } from '../../bank/layout.mjs'
import { profile } from '../src/config.js'
import { makeIds, ata, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from '../src/lib/ids.mjs'
import { planRedemption, legacySize, owedSats, rateLimit, PACKET_LIMIT, planPayout, prepareOpening, pressStopMessage, LATE_CONSENT, LATE_CONSENT_ID, OPEN_ATTEMPTS } from '../src/lib/plan-redeem.mjs'
import { planRescue, planActivate } from '../src/lib/plan-vault.mjs'
import { parseCoreAsset } from '../src/lib/decode.mjs'
import * as IX from '../src/lib/ix.mjs'
import { SIM, SUITE, ROOT, extractConst, ts2js, evalWith, scopeFor, messageBytes, wireSize, diffIx, harness } from './ref.mjs'

const H = harness('plan')
const W = web3.PublicKey
const kp = n => web3.Keypair.fromSeed(Buffer.alloc(32, n)).publicKey
const COLL = kp(41)
const P = { ...profile('mainnet'), collection: COLL.toBase58() }
const ids = makeIds(P)
const CBBTC = new W('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'), GARY = new W('8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk'), GIRAFFISH = new W('Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump')
const RES = [CBBTC, GARY, GIRAFFISH]
const owner = kp(1), asset = kp(3), stranger = kp(5)
const pda = ids.depositAddress(asset)
const POOL = ata(ids.MINT_CFG, CBBTC)
const D = '11111111111111111111111111111111'
const B = 10n ** 12n

// ── synthetic accounts, through the Bank's encoder so every field name is real ──
const mintCfg = (o = {}) => decode('MintConfig', encode('MintConfig', {
  version: 6, collection: COLL.toBase58(), governance: ids.GOV_PDA.toBase58(), pool_ata: POOL.toBase58(), round_id: 1, opens_at: 0, closes_at: 0,
  price: 21000, cap: 10, minted_this_round: 0, minted_total: 100, max_supply: 2100, bank_treasury: P.squads, split_bps: 8500,
  sales_stopped: false, sweep_stopped: false, guardian: P.initAuthority, swap_operator: kp(9).toBase58(), sol_reserve_lamports: 50000000, bump: 255,
  max_sweep_lamports: 10000000000, sweep_cooldown_secs: 21600, last_sweep_at: 0, level_caps: [945, 525, 315, 210, 105], level_minted: [10, 0, 0, 0, 0],
  revealed_total: 10, payment_mint: CBBTC.toBase58(), pob_collection: kp(8).toBase58(), pob_root: 'ab'.repeat(32), charter_opens_at: 1, charter_closes_at: 2,
  charter_claimed: 10, bare_burns_retired: 0, total_active_weight: 20, active_count: 10, acc_scaled: 5n * B, owed_scaled: 0, last_distribute_at: 0,
  sales_stopped_at: 0, sweep_stopped_at: 0, pending_swap_operator: D, pending_swap_operator_at: 0, monthly_secs: 2592000, pending_guardian: D,
  pending_guardian_set: false, pending_guardian_at: 0, notice_secs: 604800, sweep_floor_lamports: 1000000000, cooldown_ceiling_secs: 86400,
  reserve_ceiling_lamports: 100000000, dist_epoch: 3, pending_count: 0, pending_this_epoch: 0, cbob_mint: kp(7).toBase58(), max_boost_weight: 12,
  max_boost_epochs: 24, boost_price: 0, boost_weight: 0, boost_epochs: 0, boosts_active: 0, boosts_due: 0, boost_weight_total: 0, cbob_burned_total: 0,
  boost_expiring: Array(64).fill(0), ...o }))
const record = (o = {}) => decode('VaultRecord', encode('VaultRecord', {
  version: 4, asset: asset.toBase58(), mint_index: 7, reveal_slot: 1, level: 3, charter: true, entropy_set: true, entropy: '00'.repeat(32),
  attrs_hash: '00'.repeat(32), bump: 254, active: true, retired: false, reschedules: 0, vault_ata: ata(pda, CBBTC).toBase58(), debt_scaled: 4n * 5n * B,
  pending: false, request_epoch: 1, boost_weight: 0, boost_end_epoch: 0, carry_scaled: 0, ...o }))
const sealCfg = decode('SealConfig', encode('SealConfig', { version: 2, collection: COLL.toBase58(), reserve_mints: RES.map(String), bump: 255 }))
const burnCfg = (o = {}) => decode('BurnConfig', encode('BurnConfig', { version: 4, collection: COLL.toBase58(), bump: 255, burned_total: 0,
  redeem_window_secs: 3600, rate_head: 0, rate_ring: Array(64).fill(0), ...o }))
const tok = (address, mint, amount, o = {}) => ({ address: address.toString(), program: o.program || 'token', dataLen: o.dataLen || 165, lamports: 2039280,
  parsed: { mint: mint.toString(), owner: (o.owner || pda).toString(), amount: BigInt(amount), delegate: null, state: o.state ?? 1, isNative: false,
    delegatedAmount: 0n, closeAuthority: o.closeAuthority ? o.closeAuthority.toString() : null, dataLen: o.dataLen || 165 } })
const snap = (o = {}) => ({
  owner: owner.toBase58(), asset: asset.toBase58(), assetInfo: { burned: false, owner: owner.toBase58(), collection: COLL.toBase58() },
  record: record(), mintConfig: mintCfg(), sealConfig: sealCfg, burnConfig: burnCfg(),
  pool: { state: 1, amount: 1000n }, pdaLamports: 0n,
  pdaTokens: RES.map((m, i) => tok(ata(pda, m), m, 1000 * (i + 1))),
  nested: [], ownerAtaExists: new Set(RES.map(m => ata(owner, m).toBase58())), nowSec: 1_900_000_000,
  // every mint readable, none freezable unless a test says so (cbBTC's real freeze authority is set below)
  ownerAtaFrozen: new Set(), mintFreeze: new Proxy({ [CBBTC.toBase58()]: kp(190).toBase58() }, { get: (t, k) => k in t ? t[k] : null }),
  tokenNames: P.tokenNames, ...o })

// ── 1. the plain case == the Test Vault's S8 shape, as a whole message ──
const TVU = { asset, pda, owner: { publicKey: owner } }
const simScope = scopeFor(ids, { RES, POOL, POOLK: { pubkey: POOL, isSigner: false, isWritable: false }, CBBTC, GARY, GIRAFFISH })
simScope.declare = p => RES.flatMap(m => [spl.getAssociatedTokenAddressSync(m, p, true), spl.getAssociatedTokenAddressSync(m, p, true, spl.TOKEN_2022_PROGRAM_ID)])
const X = name => evalWith(ts2js(extractConst(SIM, name)), simScope, name)
TVU.pdaU = simScope.findAssetSignerPda(simScope.umi, { asset: simScope.pk(asset.toBase58()) })[0]
const simHelper = evalWith(ts2js(`const alice = { publicKey: OWNER }\n${extractConst(SIM, 'helper')}\n${extractConst(SIM, 'viaCore')}`), { ...simScope, OWNER: owner, TV: TVU }, 'viaCore')
const simRedIxs = [X('ixOpen')(TVU, owner), X('ixPoolClaim')([TVU]), ...simHelper, X('ixBurn')(TVU, owner)]
{
  const p = planRedemption(ids, snap())
  H.eq('plain: nothing refused, nothing to acknowledge, no prior transaction', [p.refuse, p.ack, p.prior.length], [[], [], 0])
  H.eq('plain: claim + open + Core Execute(helper) + burn', p.redemption.map(i => i.programId.toBase58()),
    [ids.MINT_PROG, ids.SEAL_PROG, ids.CORE, ids.BURN_PROG].map(String))
  // the sim sends open, claim, sweep, burn; the page puts claim first (SPEC "REDEEMING A VAULT")
  const refPageOrder = [simRedIxs[1], simRedIxs[0], simRedIxs[2], simRedIxs[3]]
  H.t('plain: the WHOLE legacy message equals the sim S8 builders in the page\'s order', messageBytes(p.redemption, owner).equals(messageBytes(refPageOrder, owner)))
  H.eq('plain: each instruction equals its sim S8 counterpart', p.redemption.map((ix, i) => diffIx(ix, refPageOrder[i]).length), [0, 0, 0, 0])
  const simSize = wireSize(simRedIxs, owner)
  H.eq('the sim S8 shape measures 1,061 bytes here too (SPEC item 50: "1,061 bytes")', simSize, 1061)
  H.eq('plain: the page\'s redemption is the same 1,061 bytes', p.size, 1061)
  H.t('plain: room for a compute-budget pair and a separate fee payer (1,061 + 148 <= 1,232)', p.size + 148 <= PACKET_LIMIT)
  const burn = p.redemption[3]
  H.eq('plain: burn declares the 3 reserve ATAs under BOTH token programs, in order',
    burn.keys.slice(14).map(k => k.pubkey.toBase58()), RES.flatMap(m => [ata(pda, m, TOKEN_PROGRAM), ata(pda, m, TOKEN_2022_PROGRAM)]).map(String))
  H.eq('plain: the claim pays into the vault\'s OWN cbBTC account', p.redemption[0].keys[4].pubkey.toBase58(), ata(pda, CBBTC).toBase58())
  H.eq('plain: the helper sends everything to the OWNER', p.redemption[2].keys.slice(7, 9).map(k => k.pubkey.toBase58()), [pda.toBase58(), owner.toBase58()])
  H.eq('plain: the coverage judgement (bank/detectors.mjs) passes', p.coverage.ok, true)
}
// ── 2. the prior transaction (item 42) ──
{
  const p = planRedemption(ids, snap({ pdaTokens: [tok(ata(pda, CBBTC), CBBTC, 5)], ownerAtaExists: new Set() }))
  const created = p.prior.flat().map(x => x.ix.keys[1].pubkey.toBase58()).sort()
  const want = [ata(pda, GARY), ata(pda, GIRAFFISH), ...RES.map(m => ata(owner, m))].map(String).sort()
  H.eq('missing accounts: the PRIOR transaction creates the vault\'s 2 missing reserve accounts and the owner\'s 3', created, want)
  H.t('missing accounts: every prior transaction fits', p.prior.every(g => legacySize(g.map(x => x.ix), owner) <= PACKET_LIMIT))
  H.t('missing accounts: each create is the idempotent ATA instruction, paid by the owner',
    p.prior.flat().every(x => x.ix.programId.equals(new W('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')) && x.ix.data[0] === 1 && x.ix.keys[0].pubkey.equals(owner)))
  H.t('missing accounts: the redemption still names all three reserve accounts', p.redemption[2].keys.length === 7 + 4 + 6)
}
// ── 3. the pool is frozen: no claim; an owed share needs an acknowledgement ──
{
  const frozen = { state: 2, amount: 1000n }
  const owing = record({ debt_scaled: 0n })                       // 4 x 5e12 owed = 20 sats
  const p = planRedemption(ids, snap({ pool: frozen, record: owing }))
  H.eq('pool frozen: NO claim (round 24 D4), open + Execute + burn', p.redemption.map(i => i.programId.toBase58()), [ids.SEAL_PROG, ids.CORE, ids.BURN_PROG].map(String))
  H.eq('pool frozen: the 20 credited sats are named in an acknowledgement', [p.owedSats, p.ack.map(a => a.id)], [20n, ['forfeit']])
  const p2 = planRedemption(ids, snap({ pool: frozen }))
  H.eq('pool frozen, nothing owed: no acknowledgement', p2.ack, [])
  const p3 = planRedemption(ids, snap({ record: owing }))
  H.eq('pool NOT frozen, 20 owed: claimed, no acknowledgement', [p3.claim, p3.ack.length], [true, 0])
}
H.eq('owedSats == MINT owed_of: (weight x acc + carry - debt) / 1e12, level III weight 4', owedSats(record({ debt_scaled: 0n, carry_scaled: 999999999999n }), mintCfg()), 20n)
H.eq('owedSats of a boosted level V (6 + 3) at acc 5e12', owedSats(record({ level: 5, boost_weight: 3, debt_scaled: 0n }), mintCfg()), 45n)
{
  const p = planRedemption(ids, snap({ record: record({ active: false, pending: true }) }))
  H.eq('a vault waiting to join: no claim, a note', [p.claim, p.note.some(n => /asked to join/.test(n))], [false, true])
}
// ── 4. a stray classic account: swept by the helper (round 25 D7) ──
const strayAddr = kp(70), strayMint = kp(71)
{
  const p = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, tok(strayAddr, strayMint, 55)] }))
  H.eq('stray (close authority none): swept by the helper, nothing refused', [p.refuse, p.helperStrays], [[], [strayAddr.toBase58()]])
  const h = p.redemption[2].keys
  H.eq('stray: its pair follows the three reserve pairs', h.slice(-2).map(k => k.pubkey.toBase58()), [strayAddr.toBase58(), ata(owner, strayMint).toBase58()])
  H.t('stray: the owner\'s account for it is created in the prior transaction', p.prior.flat().some(x => x.ix.keys[1].pubkey.equals(ata(owner, strayMint))))
  H.t('stray: NOT declared to burn_vault (the helper closes it)', !p.redemption.at(-1).keys.some(k => k.pubkey.equals(strayAddr)))
  H.t('stray: fits', p.size <= PACKET_LIMIT)
  const p2 = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, tok(strayAddr, strayMint, 55, { closeAuthority: pda })] }))
  H.eq('stray whose close authority IS the vault: still the helper', p2.helperStrays, [strayAddr.toBase58()])
}
// ── 5. round 35 C5: a stranger kept the CLOSE authority ──
{
  const p = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, tok(strayAddr, strayMint, 1, { closeAuthority: stranger })] }))
  H.eq('C5: not in the helper (its close would revert the whole opening)', [p.helperStrays, p.transferStrays], [[], [strayAddr.toBase58()]])
  const t = p.redemption.find((ix, i) => ix.programId.equals(ids.CORE) && i !== 2)
  const want = IX.coreExecute(ids, { asset, collection: COLL, assetSigner: pda, payer: owner, authority: owner, inner: IX.tokenTransfer(strayAddr, ata(owner, strayMint), pda, 1n) })
  H.eq('C5: its balance moves by a Core Execute of an SPL Transfer of exactly that balance to the owner', t ? diffIx(t, want) : ['missing'], [])
  H.t('C5: the emptied account is left UNDECLARED in burn_vault', !p.redemption.at(-1).keys.some(k => k.pubkey.equals(strayAddr)))
  H.t('C5: the burn is still the last instruction, the transfer between open and burn',
    p.redemption.at(-1).programId.equals(ids.BURN_PROG) && p.redemption.findIndex(i => i.programId.equals(ids.SEAL_PROG)) < p.redemption.indexOf(t))
  H.eq('C5: nothing refused; the coverage judgement passes; the holder is told why', [p.refuse, p.coverage.ok, p.note.some(n => /kept the right to close it/.test(n))], [[], true, true])
  H.t('C5: fits', p.size <= PACKET_LIMIT, String(p.size))
  const z = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, tok(strayAddr, strayMint, 0, { closeAuthority: stranger })] }))
  H.eq('C5 with a ZERO balance: nothing to do, nothing refused, not declared', [z.refuse, z.transferStrays, z.helperStrays, z.coverage.ok], [[], [], [], true])
  const f = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, tok(strayAddr, strayMint, 9, { closeAuthority: stranger, state: 2 })] }))
  H.t('C5 FROZEN with a balance: NOT refused; named in a box to tick (lost on opening)', f.refuse.length === 0 && f.ack.some(a => a.id === `lost:${strayAddr.toBase58()}`), f.refuse.join(' | '))
}
// ── 6. REVIEW H1: A STRANGER CANNOT BLOCK AN OPENING. Each vector the review
//    reproduced, alone and all at once: never a refusal, always a named box to tick,
//    and the opening (reserve sweep + burn) is still built and fits. ──
const opens = p => p.refuse.length === 0 && p.redemption.at(-1).programId.equals(ids.BURN_PROG) && p.size <= PACKET_LIMIT
const T22 = { program: 'token2022' }
const coreWithGroups = (() => {
  const u32b = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }, u64b = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
  const sb = v => Buffer.concat([u32b(Buffer.byteLength(v)), Buffer.from(v)])
  const base = Buffer.concat([Buffer.from([1]), pda.toBuffer(), Buffer.from([2]), kp(150).toBuffer(), sb('junk'), sb('u'), Buffer.from([0])])
  const pAt = base.length + 9, body = Buffer.from([18, 0, 0, 0, 0])
  return parseCoreAsset(Buffer.concat([base, Buffer.from([3]), u64b(pAt + body.length), body, Buffer.from([4]), u32b(1), Buffer.from([18, 2]), u64b(pAt), u32b(0)]))
})()
const VECTORS = [
  ['an EMPTY Token-2022 ATA (170 bytes, ImmutableOwner) for any Token-2022 mint', { pdaTokens: [tok(kp(160), kp(161), 0, { ...T22, dataLen: 170 })] }, kp(160)],
  ['a Token-2022 account holding a balance', { pdaTokens: [tok(kp(162), kp(163), 5, { ...T22, dataLen: 165 })] }, kp(162)],
  ['a FROZEN account of a stranger-controlled classic mint, 1 unit', { pdaTokens: [tok(kp(164), kp(165), 1, { state: 2 })] }, kp(164)],
  ['a programmable NFT (its token account kept frozen by Token Metadata)', { pdaTokens: [tok(kp(166), kp(167), 1, { state: 2 })] }, kp(166)],
  ['a C5 account (stranger keeps close authority) that is also FROZEN', { pdaTokens: [tok(kp(168), kp(169), 3, { state: 2, closeAuthority: stranger })] }, kp(168)],
  ['a token account this page cannot parse', { pdaTokens: [{ address: kp(170).toBase58(), program: 'token', dataLen: 165, parsed: null }] }, kp(170)],
  ['a Core NFT carrying the Groups plugin (type 18), now READ', { nested: [{ address: kp(171).toBase58(), ourVault: coreWithGroups.collection === COLL.toBase58(), name: coreWithGroups.name }] }, kp(171)],
  ['a Core NFT this page cannot read at all', { nested: [{ address: kp(172).toBase58(), ourVault: false, unreadable: true }] }, kp(172)],
  ['a compressed NFT owned by the deposit address', { compressed: [{ address: kp(173).toBase58(), compressed: true }], compressedChecked: true }, kp(173)],
]
H.t('the Groups-plugin NFT really parses (owner = the deposit address, plugin 18 listed)', coreWithGroups.owner === pda.toBase58() && coreWithGroups.plugins[0].typeId === 18)
for (const [name, extra, addr] of VECTORS) {
  const base = snap()
  const p = planRedemption(ids, { ...base, ...extra, pdaTokens: [...base.pdaTokens, ...(extra.pdaTokens || [])] })
  H.t(`H1, ${name}: the opening is NOT blocked; it is named in a box to tick`, opens(p) && p.ack.some(a => a.text.includes(addr.toBase58())),
    `refuse: ${p.refuse.join(' | ')} / ack: ${p.ack.map(a => a.id).join(',')}`)
}
{
  const base = snap()
  const all = planRedemption(ids, { ...base, pdaTokens: [...base.pdaTokens, ...VECTORS.flatMap(v => v[1].pdaTokens || [])],
    nested: VECTORS.flatMap(v => v[1].nested || []), compressed: [{ address: kp(173).toBase58(), compressed: true }], compressedChecked: true })
  H.t('H1, every vector at once: still not blocked, every one of them named', opens(all) && VECTORS.every(([, , a]) => all.ack.some(x => x.text.includes(a.toBase58()))))
  H.t('H1: every box\'s text is free of em dashes, and none says nothing could ever take an NFT out', all.ack.every(a => !a.text.includes('\u2014') && !/Nothing can take it out/.test(a.text)))
  const unchecked = planRedemption(ids, snap({ compressed: null, compressedChecked: false }))
  H.t('compressed NFTs NOT checked (no index): said plainly, not silently skipped', opens(unchecked) && unchecked.note.some(n => /could not look for compressed NFTs/.test(n)))
}
// what DOES refuse: the vault's own reserve accounts and a nested CBOB vault (rescuable), and nothing else
{
  const fz0 = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, tok(strayAddr, strayMint, 0, { state: 2 })] }))
  H.eq('a frozen stray holding ZERO: nothing to tick, nothing refused', [fz0.refuse, fz0.ack], [[], []])
  const cbz = planRedemption(ids, snap({ pdaTokens: [tok(ata(pda, CBBTC), CBBTC, 5, { state: 2 }), ...snap().pdaTokens.slice(1)] }))
  H.t('the vault\'s OWN cbBTC frozen by Coinbase with a balance: refused (item 28)', cbz.refuse.some(r => /frozen your vault's cbBTC/.test(r)))
  const resUnread = planRedemption(ids, snap({ pdaTokens: [{ address: ata(pda, CBBTC).toBase58(), program: 'token', dataLen: 165, parsed: null }, ...snap().pdaTokens.slice(1)] }))
  H.t('the vault\'s OWN reserve account unreadable: refused', resUnread.refuse.length === 1)
}
// ── 7. nested Core assets (items 9 and 44) ──
{
  const inner = kp(80)
  const ours = planRedemption(ids, snap({ nested: [{ address: inner.toBase58(), ourVault: true }] }))
  // round 39 V39-2: never a refusal: the set-up step rescues it, optionally, then the vault opens
  const want = planRescue(ids, mintCfg(), inner, { burned: false, collection: COLL.toBase58(), owner: pda.toBase58() }, asset, { burned: false, collection: COLL.toBase58() }, ids.CORE.toBase58(), owner)
  const grp = ours.prior.find(g => g.optional)
  H.eq('V39-2: a CBOB VAULT nested inside: NOT refused; the set-up step rescues it (alone, optional) with exactly the vault page\'s live-host rescue, to bank_treasury',
    [ours.refuse, opens(ours), grp?.length, grp && diffIx(grp[0].ix, want.ix).length, want.kind, want.dest], [[], true, 1, 0, 'live-host', mintCfg().bank_treasury])
  H.t('V39-2/V40-5: ...and a box explains it (it goes to the multisig, which returns it to whoever sent it in; if not, it is rescued afterwards) and never claims who sent it (the holder may have)',
    ours.note.some(n => n.includes(inner.toBase58()) && /returns it to whoever sent it in/.test(n) && /rescued afterwards/.test(n)) && /inside yours/.test(grp[0].why) &&
    ![...ours.note, grp[0].why].some(t => /not yours|someone sent|Someone sent/i.test(t)))
  const foreign = planRedemption(ids, snap({ nested: [{ address: inner.toBase58(), ourVault: false }] }))
  H.eq('a foreign NFT inside: needs an explicit acknowledgement that it will be destroyed', [foreign.refuse, foreign.ack.map(a => a.id)], [[], [`asset:${inner.toBase58()}`]])
}
// ── ROUND 36 H1: a destination a stranger can freeze never carries the opening ──
{
  const m = kp(200), sa = kp(201), dest = ata(owner, m).toBase58()
  const stray = tok(sa, m, 1)
  const freezable = new Proxy({ [m.toBase58()]: stranger.toBase58() }, { get: (t, k) => k in t ? t[k] : null })
  const a = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, stray], mintFreeze: freezable, ownerAtaExists: new Set([...snap().ownerAtaExists, dest]) }))
  H.t('R36 H1: a stray whose MINT a stranger can freeze is NOT delivered (left, named in a box); the opening is built without it',
    opens(a) && !a.helperStrays.includes(sa.toBase58()) && a.ack.some(x => x.text.includes(sa.toBase58()) && /can freeze accounts/.test(x.text)) &&
    !a.redemption[2].keys.some(k => k.pubkey.toBase58() === dest))
  const b = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, stray], ownerAtaExists: new Set([...snap().ownerAtaExists, dest]), ownerAtaFrozen: new Set([dest]) }))
  H.t('R36 H1: a stray whose receiving account is ALREADY frozen is not delivered either; never refused',
    opens(b) && !b.helperStrays.includes(sa.toBase58()) && b.ack.some(x => x.text.includes(sa.toBase58()) && /is frozen/.test(x.text)))
  const c5 = tok(kp(202), m, 2, { closeAuthority: stranger })
  const c = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, c5], mintFreeze: freezable }))
  H.t('R36 H1: the same rule for a C5 account (no Execute(Transfer) into a freezable destination)', opens(c) && c.transferStrays.length === 0 && c.ack.some(x => x.text.includes(kp(202).toBase58())))
  const unknownMint = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, stray], mintFreeze: { [CBBTC.toBase58()]: kp(190).toBase58() } }))
  H.t('R36 H1: a stray whose mint could not be read is not delivered (fail safe), never refused', opens(unknownMint) && unknownMint.helperStrays.length === 0)
  const free = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, stray] }))
  H.t('R36 H1: CONTROL: a mint nobody can freeze IS still delivered', free.helperStrays.includes(sa.toBase58()))
  const cb = planRedemption(ids, snap())
  H.t('R36 H1: the reserves are delivered although cbBTC has a freeze authority (Coinbase, not a stranger)', opens(cb) && cb.redemption[2].keys.slice(7).some(k => k.pubkey.equals(ata(owner, CBBTC))))
  const ownFrozen = planRedemption(ids, snap({ ownerAtaFrozen: new Set([ata(owner, GARY).toBase58()]) }))
  H.t('R36 H1: the holder\'s OWN $GARY account frozen: refused with the reason (the reserve must be delivered)', ownFrozen.refuse.some(r => /Your own \$GARY account/.test(r)))
  const drop = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, stray], dropStrays: true }))
  H.t('R36 H1: after a dry run failed on a stray, the re-plan leaves EVERY stray behind, named, and still opens', opens(drop) && drop.helperStrays.length === 0 && drop.ack.some(x => /could not be delivered in the dry run/.test(x.text)))
}
// ── review round 36 L2: "Run a payout" expires due boosts first, as the crank does ──
{
  const GARYM = GARY
  const assetsDue = [kp(210), kp(211)]
  const recs = assetsDue.map(a => ids.vaultRecord(a).toBase58())
  const pp = planPayout(ids, { mintConfig: mintCfg({ boosts_due: 2 }), waiting: [], dueRecords: recs, burner: owner, garyMint: GARYM })
  H.eq('L2: two boosts due: expire them, THEN distribute', pp.groups.map(g => g.map(i => i.data.subarray(0, 8).toString('hex'))),
    [[Buffer.from(IX.expireBoosts(ids, []).data).toString('hex')], [Buffer.from(IX.distribute(ids, POOL, owner, GARYM).data).subarray(0, 8).toString('hex')]])
  const sc = scopeFor(ids, { POOLK: { pubkey: POOL, isSigner: false, isWritable: false } })
  H.eq('L2: ...the expiry == the suite\'s ixExpire', diffIx(pp.groups[0][0], evalWith(ts2js(extractConst(SUITE, 'ixExpire')), sc, 'ixExpire')(assetsDue.map(a => ({ asset: a })))), [])
  const waiting = [{ asset: kp(212).toBase58(), vault_ata: ata(ids.depositAddress(kp(212)), CBBTC).toBase58() }]
  const all = planPayout(ids, { mintConfig: mintCfg({ boosts_due: 2, pending_count: 1, pending_this_epoch: 0 }), waiting, dueRecords: recs, burner: owner, garyMint: GARYM })
  H.eq('L2: due boosts AND a waiting vault: expire, join, distribute, in that order', all.groups.map(g => g[0].data.subarray(0, 8).toString('hex')),
    ['expire_boosts', 'claim', 'distribute'].map(n => Buffer.from(IX.expireBoosts(ids, []).data).toString('hex') && Buffer.from((n === 'claim' ? IX.poolClaim(ids, POOL, []) : n === 'distribute' ? IX.distribute(ids, POOL) : IX.expireBoosts(ids, [])).data).subarray(0, 8).toString('hex')))
  const many = planPayout(ids, { mintConfig: mintCfg({ boosts_due: 30 }), waiting: [], dueRecords: Array.from({ length: 30 }, (_, i) => ids.vaultRecord(kp(220 + i)).toBase58()), burner: owner, garyMint: GARYM })
  H.t('L2: 30 due boosts: two expiry transactions of at most 20, every transaction fits', many.ok && many.groups.length === 3 && many.groups[0][0].keys.length === 21 && many.groups[1][0].keys.length === 11 &&
    many.groups.every(g => legacySize(g, owner) <= PACKET_LIMIT))
  const short = planPayout(ids, { mintConfig: mintCfg({ boosts_due: 2 }), waiting: [], dueRecords: recs.slice(0, 1), burner: owner, garyMint: GARYM })
  H.t('L2: found fewer due boosts than MINT counts: refused before anything is burned', !short.ok && /boosts that are due/.test(short.refuse[0]))
  const none = planPayout(ids, { mintConfig: mintCfg(), waiting: [], dueRecords: [], burner: owner, garyMint: GARYM })
  H.eq('L2: nothing due, nobody waiting: distribute alone', none.groups.length, 1)
}
// ── REVIEW L2: the re-plan just before the opening never asks for another set-up ──
{
  const late = tok(kp(180), kp(181), 7)
  const p = planRedemption(ids, snap({ noPrior: true, pdaTokens: [...snap().pdaTokens, late] }))
  H.t('L2: a stray of a NEW mint arriving after the set-up: no new prior transaction, named in a box, still opens',
    p.prior.length === 0 && opens(p) && p.ack.some(a => a.id === `left:${kp(180).toBase58()}` && /no account of yours to receive it/.test(a.text) && !/arrived after/.test(a.text)))
  const first = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, late] }))
  H.t('L2: ...whereas on the FIRST check it is taken out (its account created in the prior transaction)', first.helperStrays.includes(kp(180).toBase58()) && first.prior.length === 1)
}
// ── 8. the packet: strays that do not fit are named, never silently dropped ──
{
  const many = Array.from({ length: 8 }, (_, i) => tok(kp(100 + i), kp(120 + i), 10 + i))
  const p = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, ...many] }))
  H.t('8 strays: the redemption still fits', p.size <= PACKET_LIMIT, String(p.size))
  H.eq('8 strays: every stray is either moved or named in an acknowledgement', p.helperStrays.length + p.left.length, 8)
  H.t('8 strays: the ones left behind each need an acknowledgement saying they are lost',
    p.left.length > 0 && p.left.every(a => p.ack.some(x => x.id === `left:${a}` && /lost when the vault is opened/.test(x.text))))
  H.eq('8 strays: nothing refused (a stranger cannot block an opening with junk)', p.refuse, [])
}
// ── 9. who may open ──
{
  const notOwner = planRedemption(ids, snap({ assetInfo: { burned: false, owner: stranger.toBase58(), collection: COLL.toBase58() } }))
  H.t('not the owner: refused', notOwner.refuse.some(r => /does not own/.test(r)))
  const foreignColl = planRedemption(ids, snap({ assetInfo: { burned: false, owner: owner.toBase58(), collection: kp(99).toBase58() } }))
  H.t('not our collection: refused', foreignColl.refuse.some(r => /not a vault/.test(r)))
  const gone = planRedemption(ids, snap({ assetInfo: { burned: true } }))
  H.t('already burned: refused', gone.refuse.some(r => /no longer exists/.test(r)))
  const retired = planRedemption(ids, snap({ record: record({ retired: true }) }))
  H.t('retired record: refused', retired.refuse.some(r => /retired/.test(r)))
}
// ── 10. the rate limit (BURN's rolling window), read only ──
{
  const now = 1_900_000_000
  H.eq('rate limit: 100 live -> cap ceil(2.1) = 3; an empty ring allows', rateLimit(burnCfg(), mintCfg(), now).allowed, true)
  const ring = Array(64).fill(0); ring[61] = now - 30; ring[62] = now - 20; ring[63] = now - 10
  const full = rateLimit(burnCfg({ rate_ring: ring, rate_head: 0 }), mintCfg(), now)
  H.eq('rate limit: three openings in the last minute block a fourth until the oldest is an hour old', [full.allowed, full.cap, full.nextAt], [false, 3, now - 30 + 3600])
  const p = planRedemption(ids, snap({ burnConfig: burnCfg({ rate_ring: ring, rate_head: 0 }), nowSec: now }))
  H.t('rate limit: the page says when the next opening is possible', p.note.some(n => /hourly opening limit/.test(n)))
}

// ── RESCUE (round 35, as ruled 2026-10-07): always to bank_treasury, only from a vault ──
{
  const mc = mintCfg()
  const vault = asset, hostA = kp(140), hostOwner = kp(141)
  const live = (o, coll = COLL) => ({ burned: false, owner: o, collection: coll.toBase58() })
  const into = h => live(ids.depositAddress(h).toBase58())
  const CORE = ids.CORE.toBase58()
  const self = planRescue(ids, mc, vault, into(vault), null, null, null, stranger)
  H.eq('rescue: a vault in its OWN deposit address goes to bank_treasury (the CBOBTC Squads)', [self.ok, self.kind, self.dest, self.host], [true, 'self', P.squads, vault.toBase58()])
  H.eq('rescue: ...as the suite\'s ixRescue builds it', diffIx(self.ix, evalWith(ts2js(extractConst(SUITE, 'ixRescue')), scopeFor(ids), 'ixRescue')(vault, vault, new W(P.squads), stranger)), [])
  const inLive = planRescue(ids, mc, vault, into(hostA), hostA, live(hostOwner.toBase58()), CORE, stranger)
  H.eq('rescue: inside a LIVE vault of the collection goes to bank_treasury too, NEVER to that vault\'s owner', [inLive.ok, inLive.kind, inLive.dest], [true, 'live-host', P.squads])
  H.eq('rescue: ...its instruction names bank_treasury as the new owner', inLive.ix.keys[4].pubkey.toBase58(), P.squads)
  const inBurned = planRescue(ids, mc, vault, into(hostA), hostA, { burned: true }, CORE, stranger)
  H.eq('rescue: inside a BURNED vault (a Core tombstone) goes to bank_treasury', [inBurned.ok, inBurned.kind, inBurned.dest], [true, 'burned-host', P.squads])
  const foreign = planRescue(ids, mc, vault, into(hostA), hostA, live(hostOwner.toBase58(), kp(77)), CORE, stranger)
  H.t('rescue: inside a FOREIGN live NFT: refused, as MINT refuses it (HostUnresolved)', !foreign.ok && /not a vault of the Bank/.test(foreign.why))
  const never = planRescue(ids, mc, vault, into(hostA), hostA, null, null, stranger)
  H.t('rescue: a holder that never existed: refused (HostUnresolved)', !never.ok)
  const notCore = planRescue(ids, mc, vault, into(hostA), hostA, null, '11111111111111111111111111111111', stranger)
  H.t('rescue: a holder that is not a Core account: refused (HostUnresolved)', !notCore.ok)
  const loop = planRescue(ids, mc, vault, into(hostA), hostA, into(hostA), CORE, stranger)
  H.eq('rescue: a host held in that same wallet is still a live vault: allowed, to bank_treasury (RescueNoProgress is gone)', [loop.ok, loop.dest], [true, P.squads])
  const wrongHost = planRescue(ids, mc, vault, into(hostA), kp(142), live(hostOwner.toBase58()), CORE, stranger)
  H.t('rescue: a host whose deposit address is not the holder: refused (NotNested)', !wrongHost.ok && /deposit address is/.test(wrongHost.why))
  const plain = planRescue(ids, mc, vault, live(owner.toBase58()), null, null, null, stranger)
  H.t('rescue: an ordinary owned vault: nothing to rescue', !plain.ok)
  const mint = (await import('fs')).readFileSync('/opt/cbob-vaults/programs/cbob-vault-mint/src/lib.rs', 'utf8')
  const fn = mint.slice(mint.indexOf('pub fn rescue_nested'), mint.indexOf('pub fn rescue_nested') + 2500)
  H.t('rescue: the program itself sends to config.bank_treasury and refuses a non-vault host (checked in its source)',
    /let dest = a\.config\.bank_treasury;/.test(fn) && /require_live_vault\(&a\.host, &a\.config\.collection\)\.is_ok\(\), MintError::HostUnresolved/.test(fn) && !/RescueNoProgress/.test(fn))
}
// ── round 37 V1: a flood of stranger accounts never blocks, and the boxes scale ──
{
  const freezeAll = new Proxy({}, { get: () => kp(203).toBase58() })
  const strays = (n, f) => Array.from({ length: n }, (_, i) => f(i))
  const addrAt = i => { const b = Buffer.alloc(32, 9); b.writeUInt32LE(i, 0); return new web3.PublicKey(b) }
  const base3 = snap().pdaTokens
  const t22empty165 = planRedemption(ids, snap({ pdaTokens: [...base3, tok(addrAt(1), kp(241), 0, { program: 'token2022' })] }))
  H.eq('W10: an empty 165-byte Token-2022 stray gets NO box, and the vault opens', [opens(t22empty165), t22empty165.ack], [true, []])
  const v1a = planRedemption(ids, snap({ pdaTokens: [...base3, ...strays(300, i => tok(addrAt(i), kp(241), 0, { program: 'token2022' }))] }))
  H.eq('V1a: 300 empty 165-byte Token-2022 strays: opens, 0 boxes', [opens(v1a), v1a.ack.length], [true, 0])
  const v1b = planRedemption(ids, snap({ pdaTokens: [...base3, ...strays(300, i => tok(addrAt(i), kp(241), 0, { program: 'token2022', dataLen: 170 }))] }))
  const g = v1b.ack[0]
  H.eq('V1b: 300 empty 170-byte Token-2022 accounts: opens, ONE grouped box (was 300), the count and the first 20 listed',
    [opens(v1b), v1b.ack.length, /^group:300:[0-9a-f]{8}$/.test(g.id), g.list.length, g.more, /holds 300 things/.test(g.text)], [true, 1, true, 20, 280, true])
  const v1c = planRedemption(ids, snap({ pdaTokens: [...base3, ...strays(300, i => tok(addrAt(i), kp(240), 1))], mintFreeze: freezeAll }))
  H.eq('V1c: 300 one-unit strays of a freezable mint: opens, ONE grouped box', [opens(v1c), v1c.ack.length, v1c.ack[0].id.startsWith('group:300:')], [true, 1, true])
  const at20 = planRedemption(ids, snap({ pdaTokens: [...base3, ...strays(20, i => tok(addrAt(i), kp(240), 1))], mintFreeze: freezeAll }))
  const at21 = planRedemption(ids, snap({ pdaTokens: [...base3, ...strays(21, i => tok(addrAt(i), kp(240), 1))], mintFreeze: freezeAll }))
  H.eq('V1: 20 strays are still 20 boxes, one each; 21 become one', [at20.ack.length, at20.ack.every(a => a.id.startsWith('lost:')), at21.ack.length, at21.ack[0].id.startsWith('group:21:')], [20, true, 1, true])
  const v1c2 = planRedemption(ids, snap({ pdaTokens: [...base3, ...strays(300, i => tok(addrAt(i === 299 ? 1000 : i), kp(240), 1))], mintFreeze: freezeAll }))
  H.t('V1: a different stray (one replaced) gives the grouped box a NEW id, so the page asks again', v1c2.ack[0].id !== v1c.ack[0].id && v1c2.ack[0].id.startsWith('group:300:'))
  const withNft = planRedemption(ids, snap({ pdaTokens: [...base3, ...strays(30, i => tok(addrAt(i), kp(240), 1))], mintFreeze: freezeAll, nested: [{ address: kp(242).toBase58(), ourVault: false, name: 'x' }] }))
  H.eq('V1: a foreign NFT among 30 strays joins the group (31 things, "1 NFT")', [opens(withNft), withNft.ack.length, withNft.ack[0].id.startsWith('group:31:'), /1 NFT/.test(withNft.ack[0].text)], [true, 1, true, true])
  const nestedVault = planRedemption(ids, snap({ pdaTokens: [...base3, ...strays(30, i => tok(addrAt(i), kp(240), 1))], mintFreeze: freezeAll, nested: [{ address: kp(243).toBase58(), ourVault: true }] }))
  H.t('V1/V39-2: a nested CBOB VAULT is never a refusal and never folded into the strays\' box (it is rescued in the set-up step)', opens(nestedVault) && nestedVault.prior.some(g => g.optional) && !nestedVault.ack.some(a => a.id.startsWith('asset:')))
  const forfeit = planRedemption(ids, snap({ pool: { state: 2, amount: 1000n }, record: record({ debt_scaled: 0n }), pdaTokens: [...base3, ...strays(30, i => tok(addrAt(i), kp(240), 1))], mintFreeze: freezeAll }))
  H.eq('V1: the forfeited-payout box stays its own box beside the group', forfeit.ack.map(a => a.id.split(':')[0]), ['forfeit', 'group'])
  const unlisted = planRedemption(ids, snap({ strayReadIncomplete: { unlisted: 'response too large', unexamined: 0, cap: 200 } }))
  H.eq('V1: the listing could not be read at all (over the cap): opens, ONE box saying unknown strays may be lost, never a refusal',
    [opens(unlisted), unlisted.ack.map(a => a.id), /could not list/.test(unlisted.ack[0].text) && /lost when the vault is opened/.test(unlisted.ack[0].text)], [true, ['unlisted:all'], true])
  // round 46 (our Helius refuses the Token-2022 listing): a classic stray that WAS listed is still swept,
  // and the box names only the program that could not be listed
  const half = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, tok(strayAddr, strayMint, 55)], strayReadIncomplete: { unlisted: 'token2022: Too many accounts requested', unlistedPrograms: ['token2022'], unexamined: 0, cap: 200 } }))
  H.eq('R46: only Token-2022 unlisted: the listed classic stray is still swept by the helper, and ONE box names Token-2022',
    [opens(half), half.helperStrays, half.ack.map(a => a.id), /could not list the other Token-2022 accounts/.test(half.ack[0]?.text || '')], [true, [strayAddr.toBase58()], ['unlisted:token2022'], true])
  const both2 = planRedemption(ids, snap({ strayReadIncomplete: { unlisted: 'x', unlistedPrograms: ['token2022'], unexamined: 7, cap: 200 } }))
  H.eq('R46: unlisted Token-2022 AND 7 unexamined classic: both boxes, no refusal', [opens(both2), both2.ack.map(a => a.id)], [true, ['unlisted:token2022', 'unlisted:7']])
  const unexamined = planRedemption(ids, snap({ strayReadIncomplete: { unlisted: null, unexamined: 19800, cap: 200 } }))
  H.eq('V1: 19,800 accounts beyond what the page examines: opens, ONE box with the count', [opens(unexamined), unexamined.ack.map(a => a.id), /19800 more token accounts/.test(unexamined.ack[0].text)], [true, ['unlisted:19800'], true])
  const both = planRedemption(ids, snap({ strayReadIncomplete: { unlisted: null, unexamined: 5, cap: 200 }, pdaTokens: [...base3, ...strays(300, i => tok(addrAt(i), kp(240), 1))], mintFreeze: freezeAll }))
  H.eq('V1: 300 strays AND 5 unexamined: two boxes, no refusal', [opens(both), both.ack.map(a => a.id.split(':')[0])], [true, ['unlisted', 'group']])
  // the NFTs: not looking is ONE box (a CBOB vault left inside can be rescued after, item 58); finding one still refuses
  const nUnlisted = planRedemption(ids, snap({ nftReadIncomplete: { unlisted: true, unexamined: 0, cap: 200 } }))
  H.eq('NFTs: both NFT reads failed: the opening PLANS, with ONE box naming the gap and the rescue of a CBOB vault left inside',
    [opens(nUnlisted), nUnlisted.ack.map(a => a.id), /could not check for NFTs/.test(nUnlisted.ack[0].text) && /except a CBOB vault: anyone can then rescue it to the Bank's multisig/.test(nUnlisted.ack[0].text)], [true, ['nfts:unlisted'], true])
  const nMore = planRedemption(ids, snap({ nftReadIncomplete: { unlisted: false, unexamined: 801, cap: 200 } }))
  H.eq('NFTs: 801 beyond what the page examines: opens, ONE box with the count', [opens(nMore), nMore.ack.map(a => a.id), /801 more NFTs/.test(nMore.ack[0].text)], [true, ['nfts:801'], true])
  const nWithStrays = planRedemption(ids, snap({ nftReadIncomplete: { unlisted: true, unexamined: 0, cap: 200 }, pdaTokens: [...base3, ...strays(30, i => tok(addrAt(i), kp(240), 1))], mintFreeze: freezeAll }))
  H.eq('NFTs: the NFT box stays its own box beside the grouped strays', [opens(nWithStrays), nWithStrays.ack.map(a => a.id.split(':')[0]).sort()], [true, ['group', 'nfts']])
  const nFound = planRedemption(ids, snap({ nftReadIncomplete: { unlisted: false, unexamined: 801, cap: 200 }, nested: [{ address: kp(244).toBase58(), ourVault: true }] }))
  H.t('NFTs/V39-2: a CBOB vault the page DID find is rescued in the set-up step (no refusal), even with others unexamined', opens(nFound) && nFound.prior.some(g => g.optional) && nFound.ack.some(a => a.id === 'nfts:801'))
  const reserveMissing = planRedemption(ids, snap({ strayReadIncomplete: { unlisted: 'x', unexamined: 0, cap: 200 }, pdaTokens: base3.slice(0, 2) }))
  H.t('V1: with the listing gone, a missing reserve account is still CREATED in the prior transaction (read by address, never through the listing)', opens(reserveMissing) && reserveMissing.prior.flat().some(x => x.ix.keys[1].pubkey.equals(ata(pda, RES[2]))))
}
// ── round 38 V38-1: the final re-plan removes exactly the stray it means to ──
{
  const hAddr = kp(150), hMint = kp(151), cAddr = kp(152), cMint = kp(153), stranger = kp(154)
  const helper = tok(hAddr, hMint, 9), c5 = tok(cAddr, cMint, 1, { closeAuthority: stranger })
  const exists = new Set([...snap().ownerAtaExists, ata(owner, hMint).toBase58()])
  const A1 = planRedemption(ids, snap({ noPrior: true, pdaTokens: [...snap().pdaTokens, helper, c5], ownerAtaExists: exists }))
  H.eq('V38-1 A1: re-plan, a helper stray plus a LATE C5 stray (no account to receive it): NO refusal, the helper stray still swept, one left: box for the C5',
    [A1.refuse, A1.helperStrays, A1.transferStrays, A1.ack.map(a => a.id)], [[], [hAddr.toBase58()], [], [`left:${cAddr.toBase58()}`]])
  const A2 = planRedemption(ids, snap({ noPrior: true, pdaTokens: [...snap().pdaTokens, helper], ownerAtaExists: exists }))
  H.eq('V38-1 A2 (control): the helper stray alone: swept, nothing refused', [A2.refuse, A2.helperStrays], [[], [hAddr.toBase58()]])
  const A3 = planRedemption(ids, snap({ noPrior: true, pdaTokens: [...snap().pdaTokens, c5], ownerAtaExists: exists }))
  H.eq('V38-1 A3 (control): the late C5 stray alone: one left: box, nothing refused', [A3.refuse, A3.ack.map(a => a.id)], [[], [`left:${cAddr.toBase58()}`]])
  const A4 = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, helper, c5], ownerAtaExists: exists }))
  H.eq('V38-1 A4 (control): both on the FIRST check: one swept, one transferred, nothing refused', [A4.refuse, A4.helperStrays, A4.transferStrays], [[], [hAddr.toBase58()], [cAddr.toBase58()]])
  const cb = tok(kp(155), CBBTC, 1)          // a non-ATA cbBTC account (reserve mints are exempt from the freeze rule)
  const A5 = planRedemption(ids, snap({ noPrior: true, pdaTokens: [...snap().pdaTokens, cb, c5], ownerAtaExists: exists }))
  H.eq('V38-1 A5: a non-ATA cbBTC stray plus the late C5: no refusal, the cbBTC stray swept', [A5.refuse, A5.helperStrays], [[], [kp(155).toBase58()]])
}
// ── round 38 V38-2: ONE standing consent; a stranger landing something new before every re-plan cannot stop the send ──
{
  const freezeAll = new Proxy({ }, { get: (t, k) => k === CBBTC.toBase58() ? kp(190).toBase58() : kp(203).toBase58() })
  const at = i => { const b = Buffer.alloc(32, 11); b.writeUInt32LE(i, 0); return new web3.PublicKey(b) }
  const knownStray = tok(kp(160), kp(161), 4)                                         // a deliverable stray seen at the check
  const notFreezable = new Proxy({ [CBBTC.toBase58()]: kp(190).toBase58() }, { get: (t, k) => k in t ? t[k] : null })
  const first = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, knownStray, tok(at(0), kp(240), 1)], mintFreeze: new Proxy({ [kp(240).toBase58()]: kp(203).toBase58(), [CBBTC.toBase58()]: kp(190).toBase58() }, { get: (t, k) => k in t ? t[k] : null }), ownerAtaExists: new Set([...snap().ownerAtaExists, ata(owner, kp(161)).toBase58()]) }))
  const consented = new Set([...first.ack.map(a => a.id), LATE_CONSENT_ID]), known = new Set([...first.helperStrays, ...first.transferStrays])
  H.eq('V38-2: the check plans the known stray for delivery and boxes the freezable one', [known.has(kp(160).toBase58()), first.ack.map(a => a.id)], [true, [`lost:${at(0).toBase58()}`]])
  // the adversary: before EVERY re-plan it lands one more thing of every kind that used to re-gate the press
  let n = 0, replans = 0, dry = 0
  const landed = () => { n++; return {
    pdaTokens: [...snap().pdaTokens, knownStray, ...Array.from({ length: n }, (_, i) => tok(at(100 + i), kp(240), 1)),                      // freezable strays (lost:, then group:)
      ...Array.from({ length: n }, (_, i) => tok(at(300 + i), kp(241), 2)),                                                                     // DELIVERABLE strays (would be moved)
      ...Array.from({ length: n }, (_, i) => tok(at(500 + i), kp(242), 0, { program: 'token2022', dataLen: 170 }))],                            // Token-2022
    nested: Array.from({ length: n }, (_, i) => ({ address: at(700 + i).toBase58(), ourVault: false, name: 'spam' })),
    compressed: Array.from({ length: n }, (_, i) => ({ address: at(900 + i).toBase58(), compressed: true })),
    strayReadIncomplete: { unlisted: null, unexamined: n, cap: 200 }, nftReadIncomplete: { unlisted: false, unexamined: n, cap: 200 } } }
  const snapNow = d => snap({ noPrior: true, dropStrays: d, known, consented, mintFreeze: new Proxy({ [kp(240).toBase58()]: kp(203).toBase58(), [CBBTC.toBase58()]: kp(190).toBase58() }, { get: (t, k) => k in t ? t[k] : null }),
    ownerAtaExists: new Set([...snap().ownerAtaExists, ata(owner, kp(161)).toBase58(), ata(owner, kp(241)).toBase58()]), ...landed() })
  for (let press = 1; press <= 5; press++) {
    const r = await prepareOpening({ consented, replan: async ({ dropStrays }) => { replans++; return planRedemption(ids, snapNow(dropStrays)) }, dryRun: async () => { dry++; return { err: null } } })
    H.t(`V38-2 press ${press}: something new of EVERY kind landed before the re-plan, and the opening is still built and would be sent (no new box)`,
      r.ok && r.plan.ack.every(a => consented.has(a.id)) && r.plan.refuse.length === 0 && r.plan.lateInfo.length >= 5, JSON.stringify(r.stop || r.plan.ack.map(a => a.id)))
    if (press === 5) {
      H.eq('V38-2: the late DELIVERABLE strays are NOT delivered (left behind under the consent); the known one still is', [r.plan.helperStrays, r.plan.late.length], [[kp(160).toBase58()], 5])
      H.t('V38-2: what arrived late is shown as information (the strays named by address)', r.plan.lateInfo.some(t => /arrived at the deposit address after your check/.test(t) && t.includes(at(300).toBase58())))
    }
  }
  H.eq('V38-2: one re-plan and one dry run per press, nothing more', [replans, dry], [5, 5])
  // the bound: a dry run that keeps failing stops after OPEN_ATTEMPTS, and dropping the known stray asks ONCE
  let calls = 0
  const failing = await prepareOpening({ consented, replan: async ({ dropStrays }) => planRedemption(ids, snapNow(dropStrays)), dryRun: async () => { calls++; return { err: 'x' } } })
  H.eq(`V38-2: a dry run that fails: at most ${OPEN_ATTEMPTS} tries, then the known stray it could not deliver is asked about ONCE (a box about something the holder was told they would get)`,
    [failing.ok, failing.stop, failing.dropStrays, calls, failing.newAcks.map(a => a.id)], [false, 'ack', true, 1, [`lost:${kp(160).toBase58()}`]])
  const after = await prepareOpening({ consented: new Set([...consented, ...failing.newAcks.map(a => a.id)]), dropStrays: true,
    replan: async ({ dropStrays }) => planRedemption(ids, snapNow(dropStrays)), dryRun: async () => ({ err: null }) })
  H.t('V38-2: ...and once that is ticked, more late arrivals still cannot stop the next press', after.ok)
  let calls2 = 0
  const dead = await prepareOpening({ consented, dropStrays: true, replan: async ({ dropStrays }) => planRedemption(ids, snap({ noPrior: true, dropStrays, known: new Set(), consented })), dryRun: async () => { calls2++; return { err: 'x' } } })
  H.eq('V38-2: nothing extra carried and the dry run fails: one try, a stop (never a retry loop)', [dead.ok, dead.stop, calls2], [false, 'dry-run', 1])
  const pressSnap = o => snap({ noPrior: true, known, consented, pdaTokens: [...snap().pdaTokens, knownStray], ownerAtaExists: new Set([...snap().ownerAtaExists, ata(owner, kp(161)).toBase58()]), ...o })
  const frozenPool = await prepareOpening({ consented, replan: async () => planRedemption(ids, pressSnap({ pool: { state: 2, amount: 1000n }, record: record({ debt_scaled: 0n }) })), dryRun: async () => ({ err: null }) })
  H.eq('V38-2: a pool Coinbase froze after the check (a forfeited payout) still asks: the consent does not cover the holder\'s own payout', [frozenPool.stop, frozenPool.newAcks?.map(a => a.id)], ['ack', ['forfeit']])
  const nestedLate = await prepareOpening({ consented, replan: async () => planRedemption(ids, pressSnap({ nested: [{ address: kp(245).toBase58(), ourVault: true }] })), dryRun: async () => ({ err: null }) })
  H.t('V39-2: a CBOB vault a stranger sends in just before the press does NOT stop it: the opening is sent, and the page says it can be rescued afterwards',
    nestedLate.ok && nestedLate.plan.refuse.length === 0 && nestedLate.plan.prior.length === 0 && nestedLate.plan.pressInfo.some(t => t.includes(kp(245).toBase58()) && /rescue it from its own page/.test(t)))
  // ── round 39 V39-1: what the holder was PROMISED is re-read by address at the press; never dropped silently ──
  { const X = kp(160).toBase58()
    const run = o => prepareOpening({ consented, replan: async () => planRedemption(ids, pressSnap(o)), dryRun: async () => ({ err: null }) })
    const f1a = await run({ strayReadIncomplete: { unlisted: 'response too large', unexamined: 0, cap: 200 } })
    H.eq('V39-1 F1a: the press-time LISTING failed, but the promised stray (re-read by address) is still delivered, nothing asked', [f1a.ok, f1a.plan.helperStrays], [true, [X]])
    const f1b = await run({ strayReadIncomplete: { unlisted: null, unexamined: 250, cap: 200 } })
    H.eq('V39-1 F1b: the promised stray is beyond the 200 read in full (250 more): still delivered (read by address)', [f1b.ok, f1b.plan.helperStrays], [true, [X]])
    const gone = await run({ pdaTokens: snap().pdaTokens, strayReadIncomplete: { unlisted: 'x', unexamined: 0, cap: 200 } })
    H.eq('V39-1: the promised account is MISSING or unreadable at the press: the press STOPS on a box about it (by its own address), never ok without it',
      [gone.ok, gone.stop, gone.newAcks?.map(a => a.id), /no longer there or could not be read/.test(gone.newAcks?.[0]?.text || '')], [false, 'ack', [`lost:${X}`], true])
    H.t('V39-1: ...and the warning says it can no longer be moved (not "arrived after your check")', /can no longer be moved/.test(pressStopMessage(gone.newAcks, gone.dropStrays)) && !gone.plan.lateInfo.some(t => t.includes(X)))
    const unread = await run({ pdaTokens: [...snap().pdaTokens, { address: X, program: 'token', dataLen: 165, lamports: 1, parsed: null }] })
    H.eq('V39-1: the promised account cannot be parsed at the press: a box about it, the press stops', [unread.stop, unread.newAcks?.map(a => a.id)], ['ack', [`lost:${X}`]])
    let dry = 0
    const readFail = await prepareOpening({ consented, replan: async () => { throw new Error('Could not read your vault\'s own accounts and the ones this page is moving to you from the network') }, dryRun: async () => { dry++; return { err: null } } }).then(() => 'resolved', e => e.message)
    H.t('V39-1: the by-address re-read itself FAILS: the press stops with that error (no dry run, nothing sent)', /Could not read/.test(readFail) && dry === 0)
    // F1d: a promised non-ATA cbBTC account
    const cbP = kp(173), cbTok = tok(cbP, CBBTC, 9)
    const chk = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, cbTok] }))
    const kn = new Set([...chk.helperStrays, ...chk.transferStrays]), co = new Set([...chk.ack.map(a => a.id), LATE_CONSENT_ID])
    const f1d = await prepareOpening({ consented: co, replan: async () => planRedemption(ids, snap({ noPrior: true, known: kn, consented: co, pdaTokens: [...snap().pdaTokens, cbTok], strayReadIncomplete: { unlisted: 'x', unexamined: 0, cap: 200 } })), dryRun: async () => ({ err: null }) })
    H.eq('V39-1 F1d: a promised non-ATA cbBTC account, listing failed at the press: still delivered', [[...kn], f1d.ok, f1d.plan.helperStrays], [[cbP.toBase58()], true, [cbP.toBase58()]])
    const f1dGone = await prepareOpening({ consented: co, replan: async () => planRedemption(ids, snap({ noPrior: true, known: kn, consented: co, strayReadIncomplete: { unlisted: 'x', unexamined: 0, cap: 200 } })), dryRun: async () => ({ err: null }) })
    H.eq('V39-1 F1d: ...and if it cannot be re-read: a box about it, never a silent drop', [f1dGone.stop, f1dGone.newAcks?.map(a => a.id)], ['ack', [`lost:${cbP.toBase58()}`]])
    // "arrived after your check" is never said of what was there at the check
    const seenFrz = Array.from({ length: 25 }, (_, i) => tok(at(1100 + i), kp(240), 1))
    const chk2 = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, ...seenFrz], mintFreeze: freezeAll }))
    const co2 = new Set([...chk2.ack.map(a => a.id), LATE_CONSENT_ID]), seen2 = new Set([...snap().pdaTokens, ...seenFrz].map(t => t.address))
    const later = tok(at(1200), kp(240), 1)
    const p2 = await prepareOpening({ consented: co2, replan: async () => planRedemption(ids, snap({ noPrior: true, known: new Set(), consented: co2, seen: seen2, pdaTokens: [...snap().pdaTokens, ...seenFrz, later], mintFreeze: freezeAll, strayReadIncomplete: { unlisted: null, unexamined: 3, cap: 200 } })), dryRun: async () => ({ err: null }) })
    H.eq('V39-1: 25 strays boxed (grouped) at the check come back as single boxes at the press: NOT called late; only the one that really arrived is; a count gap is "at this moment" information',
      [p2.ok, chk2.ack[0].id.startsWith('group:25:'), p2.plan.lateInfo.length, p2.plan.lateInfo[0].includes(at(1200).toBase58()), seenFrz.some(t => p2.plan.lateInfo.join(' ').includes(t.address)), p2.plan.pressInfo.some(t => /3 more token accounts/.test(t))],
      [true, true, 1, true, false, true])
    // round 40 W2 (g40.mjs shape): consent given through a GROUPED box, nothing new at the press
    { const p3 = await prepareOpening({ consented: co2, replan: async () => planRedemption(ids, snap({ noPrior: true, known: new Set(), consented: co2, seen: seen2, pdaTokens: [...snap().pdaTokens, ...seenFrz], mintFreeze: freezeAll })), dryRun: async () => ({ err: null }) })
      H.eq('W2 (round 40): 25 strays consented through ONE grouped box, nothing new at the press: no stop, no new box, nothing re-listed as late or "at this moment", no refusal, the opening proceeds',
        [p3.ok, p3.stop ?? null, p3.newAcks ?? null, p3.plan.lateInfo, p3.plan.pressInfo, p3.plan.refuse, p3.plan.redemption.at(-1).programId.equals(ids.BURN_PROG)], [true, null, null, [], [], [], true]) }
    const page = fs.readFileSync(`${ROOT}/web/src/pages/redeem.mjs`, 'utf8')
    H.t('V39-1: the page re-reads the promised accounts by address at the press and passes what was seen at the check',
      /readRedemptionSnapshot\(P, conn, ids, wallet\.publicKey, asset, final \? \[\.\.\.final\.known\] : \[\]\)/.test(page) && /freshPlan\(asset, true, d, \{ known, consented, seen \}\)/.test(page))
    H.t('V39-2: the page never stops the opening on a failed optional rescue', /if \(sim\.err && group\.optional\)/.test(page) && /if \(!group\.optional\) throw e/.test(page)) }
  // round 39 A2: the press's warning names the real cause
  { const cbAddr = kp(170), cbStray = o => tok(cbAddr, CBBTC, 6, o)                               // a non-ATA cbBTC stray (reserve mint: deliverable)
    const chk = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, cbStray()] }))
    const known3 = new Set([...chk.helperStrays, ...chk.transferStrays]), cons3 = new Set([...chk.ack.map(a => a.id), LATE_CONSENT_ID])
    H.eq('A2 setup: the cbBTC stray is planned for delivery at the check', [...known3], [cbAddr.toBase58()])
    const frozeIt = await prepareOpening({ consented: cons3, replan: async () => planRedemption(ids, snap({ noPrior: true, known: known3, consented: cons3, pdaTokens: [...snap().pdaTokens, cbStray({ state: 2 })] })), dryRun: async () => ({ err: null }) })
    const m1 = pressStopMessage(frozeIt.newAcks, frozeIt.dropStrays)
    H.eq('A2 (a): Coinbase freezes a stray the holder was promised: the press stops on ITS box, before any dry run', [frozeIt.stop, frozeIt.dropStrays, frozeIt.newAcks.map(a => a.id)], ['ack', false, [`lost:${cbAddr.toBase58()}`]])
    H.t('A2 (a): ...and the warning says it can no longer be moved, NOT that the payout pool froze', /can no longer be moved/.test(m1) && !/payout pool/.test(m1), m1)
    const hm = kp(171), hs = tok(kp(172), hm, 3)
    const chk2 = planRedemption(ids, snap({ pdaTokens: [...snap().pdaTokens, hs], ownerAtaExists: new Set([...snap().ownerAtaExists, ata(owner, hm).toBase58()]) }))
    const known4 = new Set([...chk2.helperStrays, ...chk2.transferStrays]), cons4 = new Set([...chk2.ack.map(a => a.id), LATE_CONSENT_ID])
    const gone = await prepareOpening({ consented: cons4, replan: async () => planRedemption(ids, snap({ noPrior: true, known: known4, consented: cons4, pdaTokens: [...snap().pdaTokens, hs] })), dryRun: async () => ({ err: null }) })
    H.t('A2 (b): the holder\'s own account for a promised stray is gone: one left: box that says so, never "arrived after the first check", and the "can no longer be moved" warning',
      gone.stop === 'ack' && gone.newAcks.length === 1 && gone.newAcks[0].id === `left:${kp(172).toBase58()}` && /no account of yours to receive it/.test(gone.newAcks[0].text) && !/arrived after/.test(gone.newAcks[0].text) && /can no longer be moved/.test(pressStopMessage(gone.newAcks, gone.dropStrays)))
    const pool = pressStopMessage([{ id: 'forfeit' }], true), both = pressStopMessage([{ id: 'forfeit' }, { id: 'lost:x' }], false)
    H.t('A2 (c): a pool frozen AFTER the dry run dropped the extras still says the pool froze, not that the dry run failed', /payout pool/.test(pool) && !/dry run failed/.test(pool))
    H.t('A2: both causes at once name both', /payout pool/.test(both) && /can no longer be moved/.test(both) && /They are listed above/.test(both))
    H.t('A2: the redeem page builds that warning with pressStopMessage (by which boxes are new), not by dropStrays', /box\('warn', pressStopMessage\(r\.newAcks, r\.dropStrays\)\)/.test(fs.readFileSync(`${ROOT}/web/src/pages/redeem.mjs`, 'utf8'))) }
  // the consent text, and that the page shows it before anything is signed
  H.eq('V38-2: the standing consent says exactly what it covers', LATE_CONSENT, 'Anything that arrives at this vault\'s deposit address after this check and before the opening lands is lost when it opens, except cbBTC, $GARY, $GIRAFFISH and SOL in the vault\'s own accounts, which come to you.')
  const page = fs.readFileSync(`${ROOT}/web/src/pages/redeem.mjs`, 'utf8')
  H.t('V38-2: the redeem page adds the consent box (always, before the button) and the press goes through prepareOpening, with no "tick it and press again" for late arrivals',
    page.indexOf('addAck({ id: LATE_CONSENT_ID, text: LATE_CONSENT })') > 0 && page.indexOf('addAck({ id: LATE_CONSENT_ID, text: LATE_CONSENT })') < page.indexOf("steps.append(action(") &&
    /await prepareOpening\(/.test(page) && !/Something new arrived in the vault since it was checked/.test(page))
}
{
  const mc = mintCfg()
  const vt = n => ({ state: 1, amount: BigInt(n) })
  const r0 = record({ active: false, pending: false })
  H.eq('activate: 21,000 sats, drawn, sealed: the first call', [planActivate(ids, mc, asset, { burned: false, collection: COLL.toBase58() }, r0, vt(21000)).step], ['request'])
  H.t('activate: 20,999 sats: not yet', !planActivate(ids, mc, asset, { burned: false, collection: COLL.toBase58() }, r0, vt(20999)).ok)
  H.t('activate: level not drawn: not yet', !planActivate(ids, mc, asset, { burned: false, collection: COLL.toBase58() }, record({ active: false, level: 0 }), vt(50000)).ok)
  H.eq('activate: requested at epoch 1, now epoch 3: the join call', planActivate(ids, mc, asset, { burned: false, collection: COLL.toBase58() }, record({ active: false, pending: true, request_epoch: 1 }), null).step, 'join')
  H.t('activate: requested in the current epoch: wait', !planActivate(ids, mc, asset, { burned: false, collection: COLL.toBase58() }, record({ active: false, pending: true, request_epoch: 3 }), null).ok)
  // round 37 V3: MINT's activate reads the balance, not the state (lib.rs read_token), so a
  // frozen account activates; the page builds it and says the payouts wait for the unfreeze
  { const f = planActivate(ids, mc, asset, { burned: false, collection: COLL.toBase58() }, r0, { state: 2, amount: 50000n })
    H.eq('V3 activate: the vault\'s cbBTC frozen by Coinbase: it CAN activate (the same instruction), with a note that payouts wait for the unfreeze',
      [f.ok, f.step, diffIx(f.ix, planActivate(ids, mc, asset, { burned: false, collection: COLL.toBase58() }, r0, vt(50000)).ix).length, /can still activate/.test(f.note) && /only delivered into it after Coinbase unfreezes it/.test(f.note), /cannot activate/.test(JSON.stringify(f))],
      [true, 'request', 0, true, false]) }
  H.t('V3 activate: frozen with 20,999 sats: still not yet (the balance rule is the program\'s)', !planActivate(ids, mc, asset, { burned: false, collection: COLL.toBase58() }, r0, { state: 2, amount: 20999n }).ok)
  H.eq('V3 activate: frozen and waiting to join: the join call, with the same note', (({ step, note }) => [step, !!note])(planActivate(ids, mc, asset, { burned: false, collection: COLL.toBase58() }, record({ active: false, pending: true, request_epoch: 1 }), { state: 2, amount: 50000n })), ['join', true])
  H.eq('V3 activate: an unfrozen account carries no note', planActivate(ids, mc, asset, { burned: false, collection: COLL.toBase58() }, r0, vt(21000)).note, null)
  H.t('V3: the program really ignores the state (read_token discards it in activate), checked in its source',
    /let \(amount, _\) = read_token\(/.test(fs.readFileSync(`${ROOT}/programs/cbob-vault-mint/src/lib.rs`, 'utf8')))
  H.t('activate: already active: nothing to do', !planActivate(ids, mc, asset, { burned: false, collection: COLL.toBase58() }, record(), vt(50000)).ok)
  const a = planActivate(ids, mc, asset, { burned: false, collection: COLL.toBase58() }, r0, vt(21000))
  H.eq('activate: the instruction is the suite\'s ixActivate', diffIx(a.ix, evalWith(ts2js(extractConst(SUITE, 'ixActivate')), scopeFor(ids, { POOLK: { pubkey: POOL, isSigner: false, isWritable: false },
    ata: (o, m = CBBTC) => spl.getAssociatedTokenAddressSync(m, o, true), crankKeys: () => [] }), 'ixActivate')({ asset, pda })), [])
}
// ── round 40 V40-1: a stranger's lamports at a missing account's ADDRESS (System-owned, 0 bytes),
//    read through the page's own readers from the mock RPC, with and without the dust ──
{
  const { spawn } = await import('child_process')
  const { PROFILES } = await import('../src/config.js')
  const { readRedemptionSnapshot } = await import('../src/lib/reads.mjs')
  const startMock = (port, env) => new Promise((res, rej) => {
    const c = spawn(process.execPath, [`${ROOT}/web/test/mock-rpc.mjs`], { env: { ...process.env, MOCK_PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    c.stdout.on('data', d => { if (/mock RPC on/.test(String(d))) res(c) }); c.on('exit', code => rej(new Error(`mock exited ${code}`))) })
  const mk = n => web3.Keypair.fromSeed(Buffer.alloc(32, n))
  const MOWNER = mk(1).publicKey, MASSET = mk(3).publicKey, MCOLL = mk(41).publicKey
  const MGARY = new W('8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk'), MGIRAFFISH = new W('Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump')
  const plain = await startMock(8981, {}), dusty = await startMock(8982, { MOCK_DUST: '1' })
  try {
    const read = async port => { const MP = { ...PROFILES.localnet, collection: MCOLL.toBase58(), rpc: `http://127.0.0.1:${port}` }, mids = makeIds(MP)
      const sn = await readRedemptionSnapshot(MP, new web3.Connection(MP.rpc, 'confirmed'), mids, MOWNER, MASSET)
      return { sn, plan: planRedemption(mids, sn), mids } }
    const A = await read(8981), Dd = await read(8982)
    const vaultGir = ata(A.mids.depositAddress(MASSET), MGIRAFFISH).toBase58(), ownerGary = ata(MOWNER, MGARY).toBase58()
    const raw = await new web3.Connection('http://127.0.0.1:8982', 'confirmed').getMultipleAccountsInfo([new W(vaultGir), new W(ownerGary)])
    H.t('V40-1 setup: in the dusted mock both addresses hold a stranger\'s lamports (System-owned, 0 bytes)', raw.every(a => a && a.owner.toBase58() === '11111111111111111111111111111111' && a.data.length === 0 && a.lamports === 650240))
    H.eq('V40-1 reader: the dusted vault $GIRAFFISH address is ABSENT, and the dusted holder $GARY address neither exists nor is frozen',
      [Dd.sn.pdaTokens.some(t => t.address === vaultGir), Dd.sn.ownerAtaExists.has(ownerGary), Dd.sn.ownerAtaFrozen.has(ownerGary)], [false, false, false])
    const created = p => p.prior.flat().map(x => x.ix.keys[1].pubkey.toBase58())
    H.eq('V40-1: no refusal; the set-up creates the vault\'s $GIRAFFISH account AND the holder\'s $GARY account at the dusted addresses',
      [Dd.plan.refuse, created(Dd.plan).includes(vaultGir), created(Dd.plan).includes(ownerGary)], [[], true, true])
    const shape = p => JSON.stringify({ prior: p.prior.map(g => g.map(x => [x.why, x.ix.programId.toBase58(), x.ix.keys.map(k => k.pubkey.toBase58()), Buffer.from(x.ix.data).toString('hex')])),
      red: p.redemption.map(ix => [ix.programId.toBase58(), ix.keys.map(k => `${k.pubkey.toBase58()}${+k.isSigner}${+k.isWritable}`), Buffer.from(ix.data).toString('hex')]), ack: p.ack.map(a => a.id), refuse: p.refuse })
    H.t('V40-1: the dusted plan (set-up AND the redemption, byte for byte) equals the plan with nothing there', shape(Dd.plan) === shape(A.plan) && A.plan.prior.length > 0)
  } finally { plain.kill(); dusty.kill() }
  // the control the verdict keeps: a TOKEN-owned reserve account that cannot be parsed still refuses
  const tokenUnreadable = planRedemption(ids, snap({ pdaTokens: [snap().pdaTokens[0], snap().pdaTokens[1], { ...snap().pdaTokens[2], parsed: null }] }))
  H.t('V40-1 control: a TOKEN-owned reserve account that cannot be parsed still refuses ("could not be read")', tokenUnreadable.refuse.some(r => /could not be read/.test(r)))
  const { absentIfDust } = await import('../src/lib/decode.mjs')
  H.eq('V40-1 absentIfDust: System + 0 bytes is absent; System WITH data, a token account, and nothing pass through unchanged',
    [absentIfDust({ owner: new W('11111111111111111111111111111111'), data: Buffer.alloc(0), lamports: 1 }), !!absentIfDust({ owner: new W('11111111111111111111111111111111'), data: Buffer.alloc(8), lamports: 1 }),
      !!absentIfDust({ owner: TOKEN_PROGRAM, data: Buffer.alloc(0), lamports: 1 }), absentIfDust(null)], [null, true, true, null])
}
export default H.done()
