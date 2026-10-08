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
import { planRedemption, legacySize, owedSats, rateLimit, PACKET_LIMIT, planPayout } from '../src/lib/plan-redeem.mjs'
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
  H.t('a VAULT nested inside: refused, pointing at the rescue (to the Bank\'s multisig)', ours.refuse.some(r => /Rescue it first/.test(r) && /multisig/.test(r)))
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
    p.prior.length === 0 && opens(p) && p.ack.some(a => a.id === `left:${kp(180).toBase58()}` && /arrived after the first check/.test(a.text)))
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
  H.t('V1: a nested CBOB VAULT is still a refusal, never folded into a box', nestedVault.refuse.some(r => /Another vault/.test(r)))
  const forfeit = planRedemption(ids, snap({ pool: { state: 2, amount: 1000n }, record: record({ debt_scaled: 0n }), pdaTokens: [...base3, ...strays(30, i => tok(addrAt(i), kp(240), 1))], mintFreeze: freezeAll }))
  H.eq('V1: the forfeited-payout box stays its own box beside the group', forfeit.ack.map(a => a.id.split(':')[0]), ['forfeit', 'group'])
  const unlisted = planRedemption(ids, snap({ strayReadIncomplete: { unlisted: 'response too large', unexamined: 0, cap: 200 } }))
  H.eq('V1: the listing could not be read at all (over the cap): opens, ONE box saying unknown strays may be lost, never a refusal',
    [opens(unlisted), unlisted.ack.map(a => a.id), /could not list/.test(unlisted.ack[0].text) && /lost when the vault is opened/.test(unlisted.ack[0].text)], [true, ['unlisted:all'], true])
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
  H.t('NFTs: a CBOB vault the page DID find still refuses (rescue it first), even with others unexamined', nFound.refuse.some(r => /Another vault/.test(r) && /Rescue it first/.test(r)))
  const reserveMissing = planRedemption(ids, snap({ strayReadIncomplete: { unlisted: 'x', unexamined: 0, cap: 200 }, pdaTokens: base3.slice(0, 2) }))
  H.t('V1: with the listing gone, a missing reserve account is still CREATED in the prior transaction (read by address, never through the listing)', opens(reserveMissing) && reserveMissing.prior.flat().some(x => x.ix.keys[1].pubkey.equals(ata(pda, RES[2]))))
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
export default H.done()
