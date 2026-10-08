/**
 * THE CEREMONY, offline: the launch gate is check-launch-params.mjs's own
 * judgeLaunch (so the page refuses exactly when it refuses), the values map onto
 * the four initializes exactly as the suite builds them, and every post-step
 * check catches a wrong field.
 */
import fs from 'fs'
import * as web3 from '@solana/web3.js'
import { encode, decode } from '../../bank/layout.mjs'
import { judgeLaunch } from '../../scripts/check-launch-params.mjs'
import { profile } from '../src/config.js'
import { makeIds, ata } from '../src/lib/ids.mjs'
import { sha256Hex } from '../src/lib/enc.mjs'
import * as IX from '../src/lib/ix.mjs'
import { valuesFrom, judgeRehearsal, STEPS, launchWithCollection, expectSeal, expectMint, expectBurn, expectGov, compare, checkCollectionAfterMint,
  checkCollectionBeforeMint, checkTokenAccount, judgeProgramBytes, judgeProbe } from '../src/lib/plan-ceremony.mjs'
import { parseCoreCollection } from '../src/lib/decode.mjs'
import { SITE } from '../src/config.js'
import { checkCollectionIdentity } from '../src/lib/plan-ceremony.mjs'
import { resolveCollection, collectionCreator, HISTORY_PAGE, HISTORY_PAGES } from '../src/lib/ceremony-reads.mjs'
import bs58 from 'bs58'
import { SUITE, ROOT, extractConst, ts2js, evalWith, scopeFor, diffIx, harness, wireSize } from './ref.mjs'

const H = harness('ceremony')
const W = web3.PublicKey
const kp = n => web3.Keypair.fromSeed(Buffer.alloc(32, n)).publicKey
const launch = JSON.parse(fs.readFileSync(`${ROOT}/launch/mainnet-init.json`, 'utf8'))
const pobSet = JSON.parse(fs.readFileSync(`${ROOT}/scripts/pob-set.json`, 'utf8'))
const COLL = kp(41)
const P = { ...profile('mainnet'), collection: COLL.toBase58() }
const ids = makeIds(P)
const NOW = Math.floor(Date.now() / 1000)

// ── the gate: TODAY the committed values are not launchable, and the page must say so ──
const today = judgeLaunch(launch, { nowSec: NOW, pobSet })
H.t('TODAY: judgeLaunch refuses the committed launch/mainnet-init.json (charter date OPEN)', today.some(x => /charter_opens_at is OPEN/.test(x)), today.join(' | '))
const filled = JSON.parse(JSON.stringify(launch))
filled.charter_opens_at = { value: NOW + 14 * 86400, status: 'RULED', source: 'test' }
filled.lock_deadline = { value: NOW + 7 * 86400, status: 'RULED', source: 'test' }
H.t('with only the two dates filled, judgeLaunch still refuses: the vault collection is OPEN until step 0',
  judgeLaunch(filled, { nowSec: NOW, pobSet }).some(x => /vault_collection is OPEN/.test(x)))
const NEWCOLL = kp(42).toBase58()
const subbed = launchWithCollection(filled, NEWCOLL)
H.eq('...and with the collection the ceremony created put in that one field, judgeLaunch passes', judgeLaunch(subbed.json, { nowSec: NOW, pobSet }), [])
H.eq('launchWithCollection changes ONLY vault_collection', Object.keys(filled).filter(k => JSON.stringify(filled[k]) !== JSON.stringify(subbed.json[k])), ['vault_collection'])
{
  const rec = JSON.parse(JSON.stringify(filled)); rec.vault_collection = { value: NEWCOLL, status: 'RULED', source: 'recorded' }
  H.eq('a file that already records the SAME collection: no change, no conflict', [launchWithCollection(rec, NEWCOLL).conflict, judgeLaunch(launchWithCollection(rec, NEWCOLL).json, { nowSec: NOW, pobSet })], [null, []])
  H.t('a file that records a DIFFERENT collection: STOP', !!launchWithCollection(rec, kp(43).toBase58()).conflict)
  H.t('the checker still refuses the Proof of Burn collection as the vault collection', judgeLaunch(launchWithCollection(filled, launch.pob_collection.value).json, { nowSec: NOW, pobSet }).some(x => /vault_collection must be its own/.test(x)))
}
Object.assign(filled, { vault_collection: subbed.json.vault_collection })
const v = valuesFrom(filled)

// ── the values become the suite's initialize instructions ──
const auth = new W(v.initAuthority)
const scope = scopeFor(ids, { mint: new W(v.paymentMint), bankTreasury: { publicKey: new W(v.bankTreasury) }, swapOp: { publicKey: new W(v.swapOperator) },
  guardian: { publicKey: new W(v.guardian) }, MAX_SUPPLY: BigInt(v.maxSupply), SWEEP_CAP: BigInt(v.maxSweepLamports), SWEEP_COOLDOWN: v.sweepCooldownSecs,
  LEVEL_CAPS: v.levelCaps, MOMENTS: new W(v.pobCollection), POB_ROOT: Buffer.from(v.pobRootHex, 'hex'), CHARTER_OPENS: v.charterOpensAt,
  CHARTER_CLOSES: v.charterClosesAt, MONTHLY: v.monthlySecs, NOTICE: v.noticeSecs, SWEEP_FLOOR: BigInt(v.sweepFloorLamports),
  COOLDOWN_CEIL: v.cooldownCeilingSecs, RESERVE_CEIL: BigInt(v.reserveCeilingLamports), MAX_BOOST_W: v.maxBoostWeight, MAX_BOOST_E: v.maxBoostEpochs,
  cbobMint: new W(v.cbobMint), REDEEM_WINDOW: v.redeemWindowSecs, VOTE_SECS: v.minVotingSecs })
const S = name => evalWith(ts2js(extractConst(SUITE, name)), scope, name)
const a = { publicKey: auth }
const steps = Object.fromEntries(STEPS.map(s => [s.id, s]))
const one = (id, ctx = {}) => steps[id].build(ids, auth, v, ctx)
H.eq('the 0.05 SOL reserve in the suite builder is the ruled value', v.solReserveLamports, 50_000_000)
H.eq('step SEAL == suite ixSealInit(the three ruled reserves)', diffIx(one('seal')[0], S('ixSealInit')(a, v.reserveMints.map(m => new W(m)))), [])
H.eq('step MINT == suite ixMintInit with every ruled value', diffIx(one('mint')[0], S('ixMintInit')(a)), [])
H.eq('step BURN == suite ixBurnInit(3600)', diffIx(one('burn')[0], S('ixBurnInit')(a, v.redeemWindowSecs)), [])
// the suite's GOV builder pins threshold 6000; the ruled 5100 is checked at the data level
{
  const g = one('gov')[0], ref = S('ixGovInit')(a, v.quorumBps)
  const thr = Buffer.alloc(2); thr.writeUInt16LE(v.thresholdBps)
  const want = Buffer.from(ref.data); thr.copy(want, 8 + 32 + 2)
  H.t('step GOV == suite ixGovInit, accounts identical, data identical but for the ruled 51% threshold',
    diffIx({ ...ref, data: want, programId: ref.programId, keys: ref.keys }, g).length === 0 && g.data.readUInt16LE(42) === 5100 && g.data.readUInt16LE(40) === 2100)
}
H.t('MINT initialize carries charter_closes_at = opens + 7 days', one('mint')[0].data.readBigInt64LE(8 + 32 + 32 + 33 + 8 + 8 + 8 + 8 + 20 + 32 + 32 + 32 + 8) === BigInt(v.charterOpensAt + 604800))
for (const s of ['seal', 'mint', 'burn', 'gov']) H.t(`step ${s} fits a legacy transaction`, wireSize(one(s), auth) <= 1232)
{
  const ctx = { squads: P.squads, existing: new Set() }
  const ixs = one('atas', ctx)
  H.eq('step ATAS: the pool (MINT config), the revenue address and the Squads, idempotent, Gary pays',
    ixs.map(i => [i.keys[1].pubkey.toBase58(), i.keys[2].pubkey.toBase58(), i.data[0], i.keys[0].pubkey.toBase58()]),
    [[ata(ids.MINT_CFG, v.paymentMint), ids.MINT_CFG], [ata(ids.REVENUE, v.paymentMint), ids.REVENUE], [ata(P.squads, v.paymentMint), new W(P.squads)]]
      .map(([x, o]) => [x.toBase58(), o.toBase58(), 1, auth.toBase58()]))
  H.eq('step ATAS: the pool account is the one MINT derives (config pool_ata)', ata(ids.MINT_CFG, v.paymentMint).toBase58(), expectMint(ids, v).pool_ata)
  H.eq('step ATAS: an account that exists is not created again', one('atas', { squads: P.squads, existing: new Set([ata(P.squads, v.paymentMint).toBase58()]) }).length, 2)
  H.t('step ATAS fits', wireSize(ixs, auth) <= 1232)
  H.eq('step FUND: tops the revenue address up by exactly the shortfall', one('fund', { shortfall: 650_240 }).map(i => i.data.readBigUInt64LE(4)), [650240n])
  H.eq('step FUND: nothing when already rent exempt', one('fund', { shortfall: 0 }).length, 0)
}

// ── after each step: the account must equal the ruled values, field by field ──
const roundtrip = (name, obj) => decode(name, encode(name, obj))
for (const [name, want] of [['SealConfig', expectSeal(ids, v)], ['MintConfig', expectMint(ids, v)], ['BurnConfig', expectBurn(ids, v)], ['GovConfig', expectGov(ids, v)]]) {
  const onChain = roundtrip(name, want)
  H.eq(`${name}: an account holding exactly the ruled values passes`, compare(onChain, want), [])
  H.eq(`${name}: the check names every field of the struct (nothing unchecked)`, Object.keys(onChain).filter(k => !(k in want)), [])
}
{
  const want = expectMint(ids, v)
  const bad = roundtrip('MintConfig', { ...want, guardian: kp(77).toBase58() })
  H.t('MintConfig: a different guardian is caught, by name', compare(bad, want).some(x => x.startsWith('guardian is')))
  const caps = roundtrip('MintConfig', { ...want, level_caps: [945, 525, 315, 210, 104] })
  H.t('MintConfig: a census one short is caught', compare(caps, want).some(x => x.startsWith('level_caps')))
  const root = roundtrip('MintConfig', { ...want, pob_root: '00'.repeat(32) })
  H.t('MintConfig: a different Proof of Burn root is caught', compare(root, want).some(x => x.startsWith('pob_root')))
  const seal = expectSeal(ids, v)
  H.t('SealConfig: reserves in another order are caught', compare(roundtrip('SealConfig', { ...seal, reserve_mints: [...seal.reserve_mints].reverse() }), seal).length === 1)
  const gov = expectGov(ids, v)
  H.t('GovConfig: a 60% threshold is caught', compare(roundtrip('GovConfig', { ...gov, threshold_bps: 6000 }), gov).some(x => x.startsWith('threshold_bps')))
  const burn = expectBurn(ids, v)
  H.t('BurnConfig: a 10-second window is caught', compare(roundtrip('BurnConfig', { ...burn, redeem_window_secs: 10 }), burn).some(x => x.startsWith('redeem_window_secs')))
}

// ── the collection, before and after MINT ──
{
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
  const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
  const s = x => Buffer.concat([u32(x.length), Buffer.from(x)])
  const base = ua => Buffer.concat([Buffer.from([5]), ua.toBuffer(), s('CBOBTC Vaults'), s('u'), u32(0), u32(0)])
  H.eq('collection before MINT: clean and MINT\'s is accepted', checkCollectionBeforeMint(ids, parseCoreCollection(base(ids.MINT_AUTH))), [])
  H.t('collection before MINT: a wallet update authority is refused', checkCollectionBeforeMint(ids, parseCoreCollection(base(kp(5)))).length === 1)
  const roy = (bps, who, pct, authTag) => {
    const b = base(ids.MINT_AUTH), pAt = b.length + 9
    const body = Buffer.concat([Buffer.from([0]), Buffer.from([bps & 255, bps >> 8]), u32(1), who.toBuffer(), Buffer.from([pct, 0])])
    return Buffer.concat([b, Buffer.from([3]), u64(pAt + body.length), body, Buffer.from([4]), u32(1), Buffer.from([0, authTag]), u64(pAt), u32(0)])
  }
  H.eq('collection after MINT: 10% to the revenue address, authority None: passes', checkCollectionAfterMint(ids, parseCoreCollection(roy(1000, ids.REVENUE, 100, 0))), [])
  H.t('collection after MINT: 5% is caught', checkCollectionAfterMint(ids, parseCoreCollection(roy(500, ids.REVENUE, 100, 0))).length === 1)
  H.t('collection after MINT: a royalty the update authority could change is caught', checkCollectionAfterMint(ids, parseCoreCollection(roy(1000, ids.REVENUE, 100, 2))).length === 1)
  H.t('collection after MINT: royalties to another address are caught', checkCollectionAfterMint(ids, parseCoreCollection(roy(1000, kp(6), 100, 0))).length === 1)
  H.t('collection before MINT: a collection already carrying a plugin is refused', checkCollectionBeforeMint(ids, parseCoreCollection(roy(1000, ids.REVENUE, 100, 0))).length === 1)
}
{
  const t = { mint: v.paymentMint, owner: ids.MINT_CFG.toBase58(), state: 1, delegate: null, closeAuthority: null, dataLen: 165 }
  H.eq('a pool account as created passes', checkTokenAccount(t, v.paymentMint, ids.MINT_CFG.toBase58()), [])
  H.t('a FROZEN pool account is caught', checkTokenAccount({ ...t, state: 2 }, v.paymentMint, ids.MINT_CFG.toBase58()).some(x => /FROZEN/.test(x)))
}
// ── is it the real program? ──
{
  const so = fs.readFileSync(`${ROOT}/dist/cbob_vaults.so`)
  const exp = P.programBytes.seal
  const pd = (elf) => ({ elf })
  H.eq('program bytes: the dist/ build followed by zero padding passes', judgeProgramBytes(pd(Buffer.concat([so, Buffer.alloc(4096)])), exp, sha256Hex), [])
  const tamper = Buffer.from(so); tamper[1000] ^= 1
  H.t('program bytes: one flipped byte is caught', judgeProgramBytes(pd(tamper), exp, sha256Hex).length === 1)
  H.t('program bytes: a non-zero byte in the padding is caught', judgeProgramBytes(pd(Buffer.concat([so, Buffer.from([0, 7])])), exp, sha256Hex).length === 1)
  const placeholder = fs.readFileSync(`${ROOT}/.cache/placeholder/out/cbob_placeholder.so`)
  H.t('program bytes: the 20,920-byte PLACEHOLDER is caught', placeholder.length === 20920 && judgeProgramBytes(pd(placeholder), exp, sha256Hex).length === 1)
  H.t('program bytes: an unconfigured profile says it did NOT check', /NOT checked/.test(judgeProgramBytes(pd(so), null, sha256Hex)[0]))
  H.eq('probe: a real Anchor program answers 101', judgeProbe('anchor', { err: { InstructionError: [0, { Custom: 101 }] }, logs: [] }), [])
  H.t('probe: the placeholder (Custom 0 + its log line) is caught', judgeProbe('anchor', { err: { InstructionError: [0, { Custom: 0 }] }, logs: ['Program log: CBOB placeholder: not launched; every instruction is refused'] }).length === 1)
  H.t('probe: the placeholder answering the SWEEP probe is caught', judgeProbe('sweep', { err: { InstructionError: [0, { Custom: 0 }] }, logs: [] }).length === 1)
  H.eq('probe: the sweep helper answers InvalidInstructionData', judgeProbe('sweep', { err: { InstructionError: [0, 'InvalidInstructionData'] }, logs: [] }), [])
  const placeholderSrc = fs.readFileSync(`${ROOT}/.cache/placeholder/src/lib.rs`, 'utf8')
  H.t('probe: the placeholder source really logs "CBOB placeholder" and returns Custom(0)', /CBOB placeholder/.test(placeholderSrc) && /Custom\(0\)/.test(placeholderSrc))
  H.eq('probe: the instruction is an 8-byte discriminator no program defines', [IX.anchorProbe(ids.SEAL_PROG).data.length, IX.anchorProbe(ids.SEAL_PROG).keys.length], [8, 0])
  const anyProg = ['programs/cbob-vaults/src/lib.rs', 'programs/cbob-vault-mint/src/lib.rs', 'programs/cbob-vault-burn/src/lib.rs', 'programs/cbob-vault-gov/src/lib.rs']
    .some(f => fs.readFileSync(`${ROOT}/${f}`, 'utf8').includes(IX.PROBE_NAME))
  H.t('probe: no CBOB program has an instruction by the probe\'s name', !anyProg)
}

// ── step 0: the vault collection (Gary 2026-10-07) ──
{
  H.eq('the ceremony starts with step 0, then SEAL, MINT, BURN, GOV, the cbBTC accounts, the rent', STEPS.map(s => s.id), ['collection', 'seal', 'mint', 'burn', 'gov', 'atas', 'fund'])
  const ctx = {}
  const ixs = steps.collection.build(makeIds({ ...P, collection: null }), auth, v, ctx)
  H.t('step 0 makes a fresh keypair for the collection (signs once, never kept)', ctx.newCollection instanceof web3.Keypair)
  H.eq('step 0 == coreCreateCollection(name "Central Bank of Bitcoin Vaults", uri .../v/collection.json, MINT\'s PDA, Gary pays)',
    diffIx(ixs[0], IX.coreCreateCollection(ids, ctx.newCollection.publicKey, ids.MINT_AUTH, auth, 'Central Bank of Bitcoin Vaults', 'https://centralbankofbitcoin.com/v/collection.json')), [])
  H.eq('the ruled name and link are what config SITE says', [SITE.collectionName, SITE.collectionUri], ['Central Bank of Bitcoin Vaults', 'https://centralbankofbitcoin.com/v/collection.json'])
  H.t('step 0 fits a legacy transaction', wireSize(ixs, auth) <= 1232)
  H.t('step 0 carries NO plugin (plugins Some([]) and adapters Some([]): the last ten bytes)', Buffer.from(ixs[0].data).subarray(-10).equals(Buffer.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0])))
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
  const st = x => Buffer.concat([u32(Buffer.byteLength(x)), Buffer.from(x)])
  const coll = (name, uri, ua) => parseCoreCollection(Buffer.concat([Buffer.from([5]), ua.toBuffer(), st(name), st(uri), u32(0), u32(0)]))
  H.eq('a collection as step 0 makes it: our name, our link, MINT\'s PDA', checkCollectionIdentity(ids, coll(SITE.collectionName, SITE.collectionUri, ids.MINT_AUTH)), [])
  H.t('...another name is caught', checkCollectionIdentity(ids, coll('CBOBTC Vaults', SITE.collectionUri, ids.MINT_AUTH)).length === 1)
  H.t('...another link is caught', checkCollectionIdentity(ids, coll(SITE.collectionName, 'https://cdn.gary.club/cbob/c.json', ids.MINT_AUTH)).length === 1)
  H.t('...a wallet update authority is caught', checkCollectionIdentity(ids, coll(SITE.collectionName, SITE.collectionUri, kp(5))).length === 1)
  // which collection: config, else SEAL's, else this session's; disagreement stops
  const sealData = c => encode('SealConfig', { version: 2, collection: c, reserve_mints: v.reserveMints, bump: 255 })
  const fake = sealColl => ({ getAccountInfo: async a => a.equals(ids.SEAL_CFG) && sealColl ? { owner: ids.SEAL_PROG, data: sealData(sealColl), lamports: 1, executable: false } : null })
  const base = makeIds({ ...P, collection: null })
  const A = kp(61).toBase58(), B = kp(62).toBase58()
  const R = (sealColl, prof, o) => resolveCollection(fake(sealColl), { ...P, ...prof }, base, o)
  const noCheck = () => { throw new Error('the creator must not be read when a pin exists') }
  H.eq('resume: nothing anywhere AND nothing on chain -> step 0 is next', await R(null, { collection: null }, { discovered: [] }), { collection: null, conflict: null, source: '', ignored: [] })
  H.eq('resume: made in this session', (await R(null, { collection: null }, { created: A })).collection, A)
  H.eq('resume: SEAL already names it (page reloaded mid-ceremony)', (await R(A, { collection: null }, {})).collection, A)
  H.eq('resume: config.js and SEAL agree', (await R(A, { collection: A }, {})).collection, A)
  H.t('STOP: config.js and SEAL name different collections', !!(await R(B, { collection: A }, {})).conflict)
  // REVIEW M2: a reload between step 0 and SEAL, with nothing recorded yet
  H.eq('M2: reload after step 0, nothing recorded: this browser remembered it -> step 0 is DONE, not offered again',
    (await R(null, { collection: null }, { remembered: A })).collection, A)
  H.t('M2: the launch file records a different one from this browser\'s: STOP', !!(await R(null, { collection: null }, { fromLaunch: A, remembered: B })).conflict)
  // ROUND 37 V2: anyone can create a decoy naming MINT's PDA; it never stops the page
  const D = kp(63).toBase58(), E = kp(64).toBase58()
  const byLaunch = ok => async c => ok.includes(c) ? { by: 'launch', why: 'created by the launch key', signature: 'SIG' } : { by: 'other', why: `it was created by ${kp(9).toBase58()}, not the launch key` }
  for (const [label, pin] of [['config.js', { prof: { collection: A } }], ['SEAL', { seal: A }], ['the launch file', { o: { fromLaunch: A } }], ['this browser', { o: { remembered: A } }], ['this session', { o: { created: A } }]]) {
    const r = await R(pin.seal || null, { collection: null, ...(pin.prof || {}) }, { ...(pin.o || {}), discovered: [A, D], creatorOf: noCheck })
    H.eq(`V2: pinned by ${label}, a decoy on chain: ours is used, the decoy is ignored and named, no stop`, [r.collection, r.conflict, r.ignored.map(i => i.address)], [A, null, [D]])
  }
  { const r = await R(A, { collection: A }, { fromLaunch: A, discovered: [A, D, E], creatorOf: noCheck })
    H.eq('V2: config.js, SEAL and the launch file agree, TWO decoys: ours, both decoys named (the round 37 MA measurement)', [r.collection, r.conflict, r.ignored.length], [A, null, 2]) }
  H.t('V2: a decoy where config.js names another collection is NOT a stop any more (it was round 36 M2)', (await R(null, { collection: B }, { discovered: [A], creatorOf: noCheck })).collection === B)
  { const r = await R(null, { collection: null }, { discovered: [D], creatorOf: byLaunch([]) })
    H.eq('V2: no pin, only a decoy on chain: NOT adopted (step 0 is next), named, no stop', [r.collection, r.conflict, r.ignored.map(i => i.address)], [null, null, [D]]) }
  { const r = await R(null, { collection: null }, { discovered: [D, A, E], creatorOf: byLaunch([A]) })
    H.eq('V2: no pin, ours among decoys: only the one the launch key created is adopted, and the page says how it found it', [r.collection, r.conflict, /created by the launch key/.test(r.source), r.ignored.length], [A, null, true, 2]) }
  H.t('V2: no pin, the launch key created TWO: STOP (both are ours; config.js must name one)', /launch key created 2/.test((await R(null, { collection: null }, { discovered: [A, B, D], creatorOf: byLaunch([A, B]) })).conflict || ''))
  { const r = await R(null, { collection: null }, { discovered: [D], creatorOf: async () => ({ by: 'unverifiable', why: 'more than 5000 transactions name it' }) })
    H.eq('V2: a candidate whose creation cannot be reached (padded history): ignored with the reason, never adopted, never a stop', [r.collection, r.conflict, r.ignored[0].why], [null, null, 'more than 5000 transactions name it']) }
  // collectionCreator on real compiled messages: the FIRST transaction naming the address
  const GARY = new web3.PublicKey(P.initAuthority), MALLORY = kp(9)
  const msgOf = (payer, ix) => new web3.Transaction({ feePayer: payer, recentBlockhash: kp(1).toBase58() }).add(ix).compileMessage()
  const createIx = (c, payer) => IX.coreCreateCollection(base, new web3.PublicKey(c), base.MINT_AUTH, payer, SITE.collectionName, SITE.collectionUri)
  const sigOf = n => bs58.encode(Buffer.alloc(64, n))
  const chain = hist => ({
    getSignaturesForAddress: async (k, o) => { const all = hist[k.toBase58()] || []; const from = o.before ? all.findIndex(x => x.signature === o.before) + 1 : 0; return all.slice(from, from + o.limit) },
    getTransaction: async sig => { for (const h of Object.values(hist)) { const x = h.find(y => y.signature === sig); if (x) return x.tx } return null } })
  const tx = (payer, ix, err = null) => ({ transaction: { message: msgOf(payer, ix) }, meta: { err } })
  const later = { signature: sigOf(7), tx: tx(MALLORY, web3.SystemProgram.transfer({ fromPubkey: MALLORY, toPubkey: new web3.PublicKey(A), lamports: 1 })) }
  const hist = {
    [A]: [later, { signature: sigOf(1), tx: tx(GARY, createIx(A, GARY)) }],
    [D]: [{ signature: sigOf(2), tx: tx(MALLORY, createIx(D, MALLORY)) }],
    [E]: [{ signature: sigOf(3), tx: tx(GARY, createIx(E, GARY), { InstructionError: [0, 'Custom'] }) }],
    [B]: [{ signature: sigOf(4), tx: tx(GARY, createIx(A, GARY)) }],
  }
  const cc = c => collectionCreator(chain(hist), base, c, P.initAuthority)
  H.eq('V2 creator: created by the launch key (the newest transaction naming it is a stranger\'s, the FIRST is the create)', [(await cc(A)).by, (await cc(A)).signature], ['launch', sigOf(1)])
  H.t('V2 creator: a decoy created and paid for by a stranger is not ours', (await cc(D)).by === 'other' && /not the launch key/.test((await cc(D)).why))
  H.eq('V2 creator: a FAILED create by the launch key is not ours', (await cc(E)).by, 'other')
  H.eq('V2 creator: a create by the launch key of a DIFFERENT address is not this one', (await cc(B)).by, 'other')
  H.eq('V2 creator: no history: unverifiable', (await cc(kp(65).toBase58())).by, 'unverifiable')
  const padded = { [A]: [...Array.from({ length: HISTORY_PAGE * HISTORY_PAGES }, (_, i) => ({ signature: `pad${i}`, tx: null })), { signature: sigOf(1), tx: tx(GARY, createIx(A, GARY)) }] }
  H.eq('V2 creator: a history padded past what the page reads: unverifiable (ignored, never adopted)', (await collectionCreator(chain(padded), base, A, P.initAuthority)).by, 'unverifiable')
  { const r = await resolveCollection(Object.assign(fake(null), chain(hist)), { ...P, collection: null }, base, { discovered: [D, A, E] })
    H.eq('V2 end to end (real creator check): ours adopted among a stranger\'s decoy and a failed create', [r.collection, r.conflict, r.ignored.map(i => i.address).sort()], [A, null, [D, E].sort()]) }
  const pageSrc = fs.readFileSync(`${ROOT}/web/src/pages/ceremony.mjs`, 'utf8')
  H.t('M2: the page remembers the new address BEFORE step 0 is signed, and refuses step 0 when it cannot scan the chain',
    pageSrc.indexOf("remember(ctx.newCollection.publicKey.toBase58())") < pageSrc.indexOf("const signed = await signExact(wallet, tx, s.id === 'collection'") &&
    /if \(!collection && discoverErr\)/.test(pageSrc))
}
// ── the rehearsal bounds (localnet and rehearsal only) ──
H.eq('rehearsal bounds: the ruled values (dates filled) pass', judgeRehearsal(filled, NOW), [])
H.t('rehearsal bounds: an OPEN value is refused', judgeRehearsal(launch, NOW).some(x => /OPEN/.test(x)))
{
  const q = JSON.parse(JSON.stringify(filled)); q.quorum_bps.value = 400
  H.t('rehearsal bounds: a quorum below GOV\'s 500 floor is refused', judgeRehearsal(q, NOW).some(x => /quorum/.test(x)))
}
export default H.done()
