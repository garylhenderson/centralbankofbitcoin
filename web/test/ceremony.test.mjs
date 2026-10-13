/**
 * THE CEREMONY, offline: the launch gate is check-launch-params.mjs's own
 * judgeLaunch (so the page refuses exactly when it refuses), the values map onto
 * the four initializes exactly as the suite builds them, and every post-step
 * check catches a wrong field.
 */
import fs from 'fs'
import * as web3 from '@solana/web3.js'
import { encode, decode } from '../../bank/layout.mjs'
import { judgeLaunch, judgeRehearsal as judgeRehearsalFile } from '../../scripts/check-launch-params.mjs'
import { CBOBTC_SQUADS, GUARDIAN_AT_LAUNCH } from '../../bank/detectors.mjs'
import { profile, PROFILES } from '../src/config.js'
import { makeIds, ata } from '../src/lib/ids.mjs'
import { sha256Hex } from '../src/lib/enc.mjs'
import * as IX from '../src/lib/ix.mjs'
import { valuesFrom, judgeRehearsal, judgeFor, squadsFor, STEPS, launchWithCollection, expectSeal, expectMint, expectBurn, expectGov, compare, checkCollectionAfterMint,
  checkCollectionBeforeMint, checkTokenAccount, judgeProgramBytes, judgeProbe, walletRefusal, collectionRecordCopy } from '../src/lib/plan-ceremony.mjs'
import { parseCoreCollection } from '../src/lib/decode.mjs'
import { SITE } from '../src/config.js'
import { checkCollectionIdentity } from '../src/lib/plan-ceremony.mjs'
import { resolveCollection, collectionCreator, HISTORY_PAGE, HISTORY_PAGES, CREATOR_FETCH_MAX, readStep, stepVerdict } from '../src/lib/ceremony-reads.mjs'
import bs58 from 'bs58'
import { judgeWalletEdits } from '../src/lib/tx.mjs'
import { txRefusal } from '../deploy/rpc-proxy.mjs'
import { SUITE, ROOT, extractConst, ts2js, evalWith, scopeFor, diffIx, harness, wireSize } from './ref.mjs'

const H = harness('ceremony')
const W = web3.PublicKey
const kp = n => web3.Keypair.fromSeed(Buffer.alloc(32, n)).publicKey
const launch = JSON.parse(fs.readFileSync(`${ROOT}/launch/mainnet-init.json`, 'utf8'))
const pobSet = JSON.parse(fs.readFileSync(`${ROOT}/scripts/pob-set.json`, 'utf8'))
const COLL = kp(41)
const P = { ...profile('mainnet'), collection: COLL.toBase58() }
const ids = makeIds(P)
const NOW = 1792108800 // Fixed time before R1 lock; the committed dates are tested unchanged.

// The completed mainnet record passes; explicit pre-ceremony fixtures must still refuse.
const today = judgeLaunch(launch, { nowSec: NOW, pobSet })
H.eq('the verified mainnet collection and ruled dates pass the launch gate', today, [])
const filled = JSON.parse(JSON.stringify(launch))
filled.vault_collection = { value: null, status: 'OPEN', source: 'pre-ceremony negative fixture' }
H.t('with the ruled dates, judgeLaunch still refuses: the vault collection is OPEN until step 0',
  judgeLaunch(filled, { nowSec: NOW, pobSet }).some(x => /vault_collection is OPEN/.test(x)))
const NEWCOLL = kp(42).toBase58()
const subbed = launchWithCollection(filled, NEWCOLL)
H.eq('...and with the collection the ceremony created put in that one field, judgeLaunch passes', judgeLaunch(subbed.json, { nowSec: NOW, pobSet }), [])
H.eq('launchWithCollection changes ONLY vault_collection', Object.keys(filled).filter(k => JSON.stringify(filled[k]) !== JSON.stringify(subbed.json[k])), ['vault_collection'])
{
  const rec = JSON.parse(JSON.stringify(filled)); rec.vault_collection = { value: NEWCOLL, status: 'RULED', source: 'recorded' }
  H.eq('a file that already records the SAME collection: no change, no conflict', [launchWithCollection(rec, NEWCOLL).conflict, judgeLaunch(launchWithCollection(rec, NEWCOLL).json, { nowSec: NOW, pobSet })], [null, []])
  H.t('a file that records a DIFFERENT collection: STOP', !!launchWithCollection(rec, kp(43).toBase58()).conflict)
  // Round 46: the rehearsal page refused every step because the stand-in was relabelled RULED.
  H.eq('R46 page: a REHEARSAL-OPEN vault_collection keeps its status when the ceremony fills it (the rehearsal judge requires it)',
    launchWithCollection({ vault_collection: { value: null, status: 'REHEARSAL-OPEN', source: 'x' } }, NEWCOLL).json.vault_collection.status, 'REHEARSAL-OPEN')
  H.eq('R46 page: ...and the mainnet file\'s OPEN still becomes RULED', launchWithCollection({ vault_collection: { value: null, status: 'OPEN', source: 'x' } }, NEWCOLL).json.vault_collection.status, 'RULED')
  // R46 (the hosted rehearsal page told Gary to write the rehearsal collection into the mainnet files)
  const MAINFILES = /config\.js|mainnet-init\.json/
  const rc = collectionRecordCopy(PROFILES.rehearsal, NEWCOLL), lc = collectionRecordCopy(PROFILES.localnet, NEWCOLL)
  const says = c => [...c.lines, c.ack, c.pins].join('\n')
  H.t('R46 page: after step 0 the REHEARSAL says the box records the collection in the rehearsal state, and NEVER in the mainnet files',
    /box records this collection in its rehearsal state/.test(says(rc)) && /NEVER put it in web\/src\/config\.js's mainnet profile or in launch\/mainnet-init\.json/.test(says(rc)) && /never goes in the mainnet files/.test(rc.ack), says(rc))
  H.t('R46 page: ...and gives no instruction to write it into a mainnet file (localnet likewise)', [rc, lc].every(c => !MAINFILES.test(says(c).replace(/NEVER put it in .*? when the rehearsal ends\./, ''))), says(rc))
  H.t('R46 page: mainnet and its local mode still say record it in config.js and launch/mainnet-init.json as RULED', ['mainnet', 'mainnet-local'].every(n =>
    /web\/src\/config\.js, mainnet profile: collection: '/.test(says(collectionRecordCopy(PROFILES[n], NEWCOLL))) && /"status" to "RULED"/.test(says(collectionRecordCopy(PROFILES[n], NEWCOLL)))))
  H.eq('R46 page: the rehearsal value file\'s stand-in source names the rehearsal state, not the mainnet file', /rehearsal state, never in the mainnet files/.test(launchWithCollection({ vault_collection: { value: null, status: 'REHEARSAL-OPEN', source: 'x' } }, NEWCOLL).json.vault_collection.source), true)
  H.t('R46 page: the ceremony page takes every one of those words from collectionRecordCopy', (src => /collectionRecordCopy\(P, collection\)\.lines/.test(src) && /collectionRecordCopy\(P, collection\)\.ack/.test(src) && !/mainnet-init\.json \(vault_collection\)/.test(src))(fs.readFileSync(`${ROOT}/web/src/pages/ceremony.mjs`, 'utf8')))
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
// ROUND 46 (the hosted rehearsal page): EVERY ceremony step, as Phantom returns it (a
// priority fee and a Lighthouse guard around the page's own instructions), must pass BOTH
// the page's wallet-edit judge AND the relay's transaction rule. One step at a time missed
// the relay; this walks all seven.
{
  const CBP = new W('ComputeBudget111111111111111111111111111111'), LHP = new W('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95')
  const cb = (k, n) => { const d = Buffer.alloc(k === 2 ? 5 : 9); d[0] = k; k === 2 ? d.writeUInt32LE(n, 1) : d.writeBigUInt64LE(BigInt(n), 1); return new web3.TransactionInstruction({ programId: CBP, keys: [], data: d }) }
  const lh = new web3.TransactionInstruction({ programId: LHP, keys: [{ pubkey: auth, isSigner: false, isWritable: false }], data: Buffer.from([1, 2]) })
  const results = STEPS.map(s => {
    const ctx = { newCollection: web3.Keypair.generate(), squads: P.squads, shortfall: 1_000_000, rent0: 890_880 }
    const ixs = s.build(makeIds({ ...P, collection: s.id === 'collection' ? null : P.collection }), auth, v, ctx)
    const mk = list => { const x = new web3.Transaction().add(...list); x.feePayer = auth; x.recentBlockhash = '11111111111111111111111111111111'; return x }
    const want = mk(ixs), got = mk([cb(2, 200_000), cb(3, 1_000), ...ixs, lh])
    const page = judgeWalletEdits(want, got).bad
    const relay = txRefusal([got.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), { encoding: 'base64' }])
    return `${s.id}:${page.length ? page.join('/') : 'page ok'}:${relay || 'relay ok'}`
  })
  H.eq('R46 page: all seven ceremony steps, as Phantom returns them, pass the page AND the relay', results,
    STEPS.map(s => `${s.id}:page ok:relay ok`))
  const only = new web3.Transaction().add(cb(3, 1_000), lh); only.feePayer = auth; only.recentBlockhash = '11111111111111111111111111111111'
  H.t('R46 relay: the wallet\'s additions ALONE are still refused (they are never the work)', !!txRefusal([only.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), { encoding: 'base64' }]))
  const ride = new web3.Transaction().add(cb(3, 1_000), web3.SystemProgram.transfer({ fromPubkey: auth, toPubkey: kp(77), lamports: 1 }), lh); ride.feePayer = auth; ride.recentBlockhash = '11111111111111111111111111111111'
  H.t('R46 relay: ...and riding with a stranger\'s transfer, still refused', !!txRefusal([ride.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), { encoding: 'base64' }]))
}
// ROUND 47 (V47-4): the ceremony hands the wallet-edit judge its compute floor, from the
// step's own dry run, so a wallet limit below what the step needs is refused by name
{
  const pageSrc = fs.readFileSync(`${ROOT}/web/src/pages/ceremony.mjs`, 'utf8')
  H.t('R47 V47-4: the ceremony signs with minUnits from the step\'s dry run', /const sim = await simulate\(ctx\.conn, tx\)[\s\S]*?signExact\(wallet, tx, s\.id === 'collection' \? \[ctx\.newCollection\] : \[\], \{ minUnits: sim\.unitsConsumed \|\| null \}\)/.test(pageSrc))
  const CBP = new W('ComputeBudget111111111111111111111111111111')
  const lim = n => { const d = Buffer.alloc(5); d[0] = 2; d.writeUInt32LE(n, 1); return new web3.TransactionInstruction({ programId: CBP, keys: [], data: d }) }
  const ixs = STEPS[1].build(makeIds(P), auth, v, { newCollection: web3.Keypair.generate(), squads: P.squads, shortfall: 1_000_000, rent0: 890_880 })
  const mk = list => { const x = new web3.Transaction().add(...list); x.feePayer = auth; x.recentBlockhash = '11111111111111111111111111111111'; return x }
  H.eq('R47 V47-4: with that floor, a wallet limit of 1 on a ceremony step is refused by name, and Phantom\'s 200,000 on a 150,000-unit step passes',
    [judgeWalletEdits(mk(ixs), mk([lim(1), ...ixs]), { minUnits: 150_000 }).bad.some(b => /compute limit of 1, below the 150000/.test(b)), judgeWalletEdits(mk(ixs), mk([lim(200_000), ...ixs]), { minUnits: 150_000 }).bad], [true, []])
}
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
  // round 40 V40-2: a stranger's lamports at a cbBTC account's ADDRESS (System-owned, 0 bytes) read as "not run"
  { const SYS = new W('11111111111111111111111111111111'), pm = new W(v.paymentMint)
    const poolAta = ata(ids.MINT_CFG, pm), revAta = ata(ids.REVENUE, pm), sqAta = ata(new W(P.squads), pm)
    const tokenAcct = (owner, mint = pm) => { const d = Buffer.alloc(165); mint.toBuffer().copy(d, 0); new W(owner).toBuffer().copy(d, 32); d[108] = 1; return { owner: new W('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), data: d, lamports: 2039280, executable: false } }
    const conn = state => ({ getAccountInfo: async a => state[a.toBase58()] || null })
    const dust = { owner: SYS, data: Buffer.alloc(0), lamports: 650240, executable: false }
    for (const [label, addr] of [['pool', poolAta], ['revenue', revAta], ['Squads', sqAta]]) {
      const ctx = { ids, v, squads: P.squads, conn: conn({ [addr.toBase58()]: dust }) }
      const st = await readStep(ctx, 'atas')
      H.eq(`V40-2: the ${label} cbBTC address dusted: step 5 reads "not run" (never WRONG ON CHAIN), and its builder creates all three`, [st, one('atas', ctx).length], [null, 3])
    }
    const mixed = { ids, v, squads: P.squads, conn: conn({ [poolAta.toBase58()]: dust, [revAta.toBase58()]: tokenAcct(ids.REVENUE), [sqAta.toBase58()]: tokenAcct(P.squads) }) }
    H.eq('V40-2: two created, the pool address dusted: still "not run" and only the pool account is created', [await readStep(mixed, 'atas'), one('atas', mixed).map(i => i.keys[1].pubkey.toBase58())], [null, [poolAta.toBase58()]])
    const wrong = { ids, v, squads: P.squads, conn: conn({ [poolAta.toBase58()]: tokenAcct(kp(77)) }) }
    H.t('V40-2 control: a real token account with the WRONG owner at the pool address still stops (broken)', ((await readStep(wrong, 'atas')) || []).some(b => b.includes(poolAta.toBase58()))) }
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
  // Round 46 (V46o-4): the placeholder is a TRACKED fixture (it lived only in the
  // untracked .cache, so this suite could not run from the repository), pinned by
  // sha256 here and in its own SHA256SUMS.
  const PH = `${ROOT}/web/test/fixtures/placeholder`
  const phSums = Object.fromEntries(fs.readFileSync(`${PH}/SHA256SUMS`, 'utf8').trim().split('\n').map(l => l.split(/\s+/)).map(([h, f]) => [f, h]))
  const placeholder = fs.readFileSync(`${PH}/cbob_placeholder.so`)
  H.eq('V46o-4: the tracked placeholder fixture is the 20,920 bytes the mainnet ids hold (sha256 94f75099...), and its source matches its SHA256SUMS',
    [placeholder.length, sha256Hex(placeholder), phSums['cbob_placeholder.so'], sha256Hex(fs.readFileSync(`${PH}/src/lib.rs`))],
    [20920, '94f750995689a59f2b4cc3e4c5336a34bce1697ae7ff040e41a9d57040e64219', '94f750995689a59f2b4cc3e4c5336a34bce1697ae7ff040e41a9d57040e64219', phSums['src/lib.rs']])
  H.t('program bytes: the 20,920-byte PLACEHOLDER is caught', placeholder.length === 20920 && judgeProgramBytes(pd(placeholder), exp, sha256Hex).length === 1)
  H.t('program bytes: an unconfigured profile says it did NOT check', /NOT checked/.test(judgeProgramBytes(pd(so), null, sha256Hex)[0]))
  H.eq('probe: a real Anchor program answers 101', judgeProbe('anchor', { err: { InstructionError: [0, { Custom: 101 }] }, logs: [] }), [])
  H.t('probe: the placeholder (Custom 0 + its log line) is caught', judgeProbe('anchor', { err: { InstructionError: [0, { Custom: 0 }] }, logs: ['Program log: CBOB placeholder: not launched; every instruction is refused'] }).length === 1)
  H.t('probe: the placeholder answering the SWEEP probe is caught', judgeProbe('sweep', { err: { InstructionError: [0, { Custom: 0 }] }, logs: [] }).length === 1)
  H.eq('probe: the sweep helper answers InvalidInstructionData', judgeProbe('sweep', { err: { InstructionError: [0, 'InvalidInstructionData'] }, logs: [] }), [])
  const placeholderSrc = fs.readFileSync(`${PH}/src/lib.rs`, 'utf8')
  H.t('probe: the placeholder source really logs "CBOB placeholder" and returns Custom(0)', /CBOB placeholder/.test(placeholderSrc) && /Custom\(0\)/.test(placeholderSrc))
  H.eq('probe: the instruction is an 8-byte discriminator no program defines', [IX.anchorProbe(ids.SEAL_PROG).data.length, IX.anchorProbe(ids.SEAL_PROG).keys.length], [8, 0])
  const anyProg = ['programs/cbob-vaults/src/lib.rs', 'programs/cbob-vault-mint/src/lib.rs', 'programs/cbob-vault-burn/src/lib.rs', 'programs/cbob-vault-gov/src/lib.rs']
    .some(f => fs.readFileSync(`${ROOT}/${f}`, 'utf8').includes(IX.PROBE_NAME))
  H.t('probe: no CBOB program has an instruction by the probe\'s name', !anyProg)
}

// ── step 0: the vault collection (Gary 2026-10-07) ──
{
  H.eq('the ceremony starts with step 0, then SEAL, MINT, BURN, GOV, the cbBTC accounts, the rent', STEPS.map(s => s.id), ['collection', 'seal', 'mint', 'burn', 'gov', 'atas', 'fund'])
  // round 39 C04: FRESH (a new key on every build, never reused) and NEVER KEPT (nothing
  // written to any browser store while building, and the page persists only the address)
  const writes = [], store = name => ({ setItem: (k, val) => writes.push([name, k, String(val)]), getItem: () => null, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 })
  const saved = {}
  for (const g of ['localStorage', 'sessionStorage', 'indexedDB']) { saved[g] = Object.getOwnPropertyDescriptor(globalThis, g); Object.defineProperty(globalThis, g, { value: g === 'indexedDB' ? { open: (...a) => { writes.push(['indexedDB', ...a]); return {} } } : store(g), configurable: true, writable: true }) }
  const ctx = {}, ctx2 = {}
  const ixs = steps.collection.build(makeIds({ ...P, collection: null }), auth, v, ctx)
  const first = ctx.newCollection
  steps.collection.build(makeIds({ ...P, collection: null }), auth, v, ctx)          // the same ctx, built again (a reload of the step)
  steps.collection.build(makeIds({ ...P, collection: null }), auth, v, ctx2)         // a fresh ctx
  for (const g of Object.keys(saved)) saved[g] ? Object.defineProperty(globalThis, g, saved[g]) : delete globalThis[g]
  const keys = [first, ctx.newCollection, ctx2.newCollection]
  ctx.newCollection = first        // the arms below check the instruction built with the first key
  H.t('C04 step 0: each build makes a NEW keypair (three builds, three different public AND secret keys; never reused)',
    keys.every(k => k instanceof web3.Keypair) && new Set(keys.map(k => k.publicKey.toBase58())).size === 3 && new Set(keys.map(k => Buffer.from(k.secretKey).toString('hex'))).size === 3)
  H.eq('C04 step 0: building it writes NOTHING to localStorage, sessionStorage or IndexedDB', writes, [])
  { const page = fs.readFileSync(`${ROOT}/web/src/pages/ceremony.mjs`, 'utf8'), lib = fs.readFileSync(`${ROOT}/web/src/lib/plan-ceremony.mjs`, 'utf8')
    const uses = [...page.matchAll(/newCollection[\w.\]()]*/g)].map(m => m[0])
    const remembers = [...page.matchAll(/remember\(([^)]*\)?)\)/g)].map(m => m[1])
    H.t('C04: the page uses the step-0 key ONLY to sign (signExact extra) and for its public address; it never reads its secret',
      uses.length > 0 && uses.every(u => /^newCollection(\.publicKey\.toBase58\(\)\)*|\])$/.test(u)) && !/secretKey/.test(page) && !/secretKey/.test(lib), uses.join(' | '))
    H.t('C04: browser persistence holds only public address/receipt hints, never the collection private key',
      remembers.length > 0 && remembers.every(a => a === 'ctx.newCollection.publicKey.toBase58()' || a === 'collection') &&
      (page.match(/localStorage\.setItem/g) || []).length === 1 &&
      /\{collection:ctx\.newCollection\.publicKey\.toBase58\(\),signature:null,lastValidBlockHeight\}/.test(page) &&
      /writePending\(localStorage,pendingKey\(\),\{\.\.\.pending,signature:stepZeroReceipt\.signature\}\)/.test(page) &&
      !/sessionStorage|indexedDB/.test(page) && !/localStorage|sessionStorage|indexedDB/.test(lib), remembers.join(' | ')) }
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
  // ROUND 41 V41-1: a stranger's lamports at the four program CONFIG addresses (System-owned, 0 bytes)
  { const SYS = new web3.PublicKey('11111111111111111111111111111111')
    const dust = { owner: SYS, data: Buffer.alloc(0), lamports: 650240, executable: false }
    const at = (addr, acct) => ({ getAccountInfo: async a => a.equals(addr) ? acct : null })
    const r0 = await resolveCollection(at(base.SEAL_CFG, dust), { ...P, collection: null }, base, { discovered: [] })
    H.eq('V41-1: SEAL_CFG dusted before the ceremony: preflight has NO conflict (SEAL is simply not initialized yet), step 0 is next', [r0.collection, r0.conflict], [null, null])
    for (const [step, addr] of [['seal', ids.SEAL_CFG], ['mint', ids.MINT_CFG], ['burn', ids.BURN_CFG], ['gov', ids.GOV_CFG]]) {
      const ctx = { ids, v, squads: P.squads, conn: at(addr, dust) }
      let st, err = null
      try { st = await readStep(ctx, step) } catch (e) { err = e.message }
      H.eq(`V41-1: the ${step.toUpperCase()} config address dusted: readStep says "not run" (no throw) and the step's initialize is offered`, [err, st, one(step, ctx).length > 0], [null, null, true])
    }
    const other = { owner: ids.MINT_PROG, data: Buffer.alloc(64, 1), lamports: 1, executable: false }, sysData = { owner: SYS, data: Buffer.alloc(8), lamports: 1, executable: false }
    H.t('V41-1 control: an account at SEAL_CFG owned by ANOTHER program still gives the conflict', /not owned by SEAL/.test((await resolveCollection(at(base.SEAL_CFG, other), { ...P, collection: null }, base, { discovered: [] })).conflict || ''))
    H.t('V41-1 control: a System-owned account WITH data at SEAL_CFG still gives the conflict', /not owned by SEAL/.test((await resolveCollection(at(base.SEAL_CFG, sysData), { ...P, collection: null }, base, { discovered: [] })).conflict || ''))
    for (const [step, addr] of [['mint', ids.MINT_CFG], ['gov', ids.GOV_CFG]]) {
      let thrown = ''; try { await readStep({ ids, v, squads: P.squads, conn: at(addr, other.owner.equals(ids.MINT_PROG) && step === 'mint' ? { ...other, owner: ids.SEAL_PROG } : other) }, step) } catch (e) { thrown = e.message }
      H.t(`V41-1 control: the ${step.toUpperCase()} config owned by another program WITH data still throws "not owned by its program"`, /not owned by its program/.test(thrown), thrown)
    }
  }
  const noCheck = () => { throw new Error('the creator must not be read when a pin exists') }
  H.eq('resume: nothing anywhere AND nothing on chain -> step 0 is next', await R(null, { collection: null }, { discovered: [] }), { collection: null, conflict: null, source: '', ignored: [], unverified: [] })
  H.eq('resume: made in this session', (await R(null, { collection: null }, { created: A })).collection, A)
  H.eq('resume: SEAL already names it (page reloaded mid-ceremony)', (await R(A, { collection: null }, {})).collection, A)
  H.eq('resume: config.js and SEAL agree', (await R(A, { collection: A }, {})).collection, A)
  H.t('STOP: config.js and SEAL name different collections', !!(await R(B, { collection: A }, {})).conflict)
  // REVIEW M2: a reload between step 0 and SEAL, with nothing recorded yet
  H.eq('M2: reload after step 0, nothing recorded: this browser remembered it -> step 0 is DONE, not offered again',
    (await R(null, { collection: null }, { remembered: A, creatorOf: async () => ({ by: 'launch', signature: 'SIG' }) })).collection, A)
  H.t('M2: the launch file records a different one from this browser\'s: STOP', !!(await R(null, { collection: null }, { fromLaunch: A, remembered: B, creatorOf: async () => ({ by: 'launch', signature: 'SIG' }) })).conflict)
  // ROUND 37 V2: anyone can create a decoy naming MINT's PDA; it never stops the page
  const D = kp(63).toBase58(), E = kp(64).toBase58()
  const byLaunch = ok => async c => ok.includes(c) ? { by: 'launch', why: 'created by the launch key', signature: 'SIG' } : { by: 'other', why: `it was created by ${kp(9).toBase58()}, not the launch key` }
  { const r = await R(null, { collection: null }, { remembered: D, creatorOf: byLaunch([]) }); H.eq('R1: planted browser collection is never adopted', [r.collection, r.ignored[0].address], [null, D]) }
  { const r = await R(null, { collection: null }, { remembered: A, creatorOf: async () => ({ by: 'unverifiable', why: 'history unavailable' }) }); H.eq('R1: unverified saved collection stops instead of offering a duplicate step 0', [r.collection, r.unverified.length, /Do not create another/.test(r.conflict)], [null, 1, true]) }
  { const r = await R(null, { collection: null }, { fromLaunch: A, remembered: D, creatorOf: byLaunch([]) }); H.eq('R1: planted browser hint cannot override a committed collection', [r.collection, r.conflict], [A, null]) }
  for (const [label, pin] of [['config.js', { prof: { collection: A } }], ['SEAL', { seal: A }], ['the launch file', { o: { fromLaunch: A } }], ['this browser', { o: { remembered: A } }], ['this session', { o: { created: A } }]]) {
    const r = await R(pin.seal || null, { collection: null, ...(pin.prof || {}) }, { ...(pin.o || {}), discovered: [A, D], creatorOf: label === 'this browser' ? byLaunch([A]) : noCheck })
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
  // ROUND 39 B4 (replaces round 38 V38-3's STOP): nothing pinned, nothing verified -> warn and STILL offer step 0
  const padded1 = async () => ({ by: 'unverifiable', why: 'more than 5000 transactions name it' })
  { const r = await R(null, { collection: null }, { discovered: [D], creatorOf: padded1 })
    H.eq('B4: before step 0, a stranger\'s PADDED decoy and nothing pinned: no stop, nothing adopted (step 0 is offered), the decoy listed for the warning with its reason',
      [r.collection, r.conflict, r.unverified.map(i => [i.address, i.why])], [null, null, [[D, 'more than 5000 transactions name it']]]) }
  { const r = await R(null, { collection: null }, { discovered: [D], creatorOf: async () => ({ by: 'unverifiable', why: 'the network no longer serves the transaction that created it' }) })
    H.t('B4: a pruned creating transaction is the same warning, never a stop', r.conflict === null && r.collection === null && r.unverified.length === 1) }
  { const r = await R(null, { collection: null }, { discovered: [D, A], creatorOf: async c => c === A ? { by: 'launch', why: 'x', signature: 'SIG' } : padded1() })
    H.eq('B4: no pin, ours VERIFIED beside a padded decoy: ours is adopted, the decoy listed by address as ignored with its reason, no stop',
      [r.collection, r.conflict, r.ignored.map(i => [i.address, i.why]), r.unverified], [A, null, [[D, 'more than 5000 transactions name it']], undefined]) }
  { const r = await R(null, { collection: null }, { discovered: [A, B, D], creatorOf: async c => c === D ? padded1() : { by: 'launch', why: 'x', signature: 'SIG' } })
    H.t('B4: no pin, TWO verified as the launch key\'s (and an unverifiable one): STOP', r.collection === null && /launch key created 2/.test(r.conflict || '')) }
  { const pageSrc = fs.readFileSync(`${ROOT}/web/src/pages/ceremony.mjs`, 'utf8')
    H.t('B4: both unverified warnings require the independent receipt instead of creating another collection or trusting browser memory',
      (pageSrc.match(/unverifiedBox\(found\.unverified\)/g) || []).length === 2 && /do NOT create another/.test(pageSrc) && /independent step-0 receipt/.test(pageSrc) && /Browser memory alone does not verify it/.test(pageSrc))
    H.t('B4: after step 0 the new address is persisted and nothing continues until an explicit "I recorded it" tick',
      /remember\(collection\)/.test(pageSrc) && /if \(ctx\.recordedCollection !== collection\)/.test(pageSrc) && /if \(!tick\.checked\) throw/.test(pageSrc) && /collectionRecordCopy\(P, collection\)\.ack/.test(pageSrc) && /I have copied \$\{collection\} and recorded it/.test(fs.readFileSync(`${ROOT}/web/src/lib/plan-ceremony.mjs`, 'utf8'))) }
  for (const [label, o] of [['this browser', { remembered: A }], ['the launch file', { fromLaunch: A }]]) {
    const r = await R(null, { collection: null }, { ...o, discovered: [A, D], creatorOf: label === 'this browser' ? byLaunch([A]) : noCheck })
    H.eq(`B4: pinned by ${label}, an unverifiable decoy beside it: ours is used, the decoy ignored, no stop`, [r.collection, r.conflict], [A, null])
  }
  H.t('V38-3: the ceremony page stops on a conflict before offering any step (step 0 included)', /if \(conflict\) \{ line\(false, `STOP: \$\{conflict\}\.`\); return null \}/.test(fs.readFileSync(`${ROOT}/web/src/pages/ceremony.mjs`, 'utf8')))
  // collectionCreator on real compiled messages: the oldest SUCCESSFUL create of the address (round 42 V42-2)
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
  // round 42 V42-2: no successful create of the address in a complete history is
  // UNVERIFIABLE (a prominent "pin it" warning, step 0 still offered), never 'other'
  H.eq('V2 creator: a FAILED create by the launch key is never adopted (no successful create: unverifiable)', [(await cc(E)).by, /no successful transaction/.test((await cc(E)).why)], ['unverifiable', true])
  H.eq('V2 creator: a create by the launch key of a DIFFERENT address is never adopted for this one (unverifiable)', (await cc(B)).by, 'unverifiable')
  H.eq('V2 creator: no history: unverifiable', (await cc(kp(65).toBase58())).by, 'unverifiable')
  const padded = { [A]: [...Array.from({ length: HISTORY_PAGE * HISTORY_PAGES }, (_, i) => ({ signature: `pad${i}`, tx: null })), { signature: sigOf(1), tx: tx(GARY, createIx(A, GARY)) }] }
  H.eq('V2 creator: a history padded past what the page reads: unverifiable (ignored, never adopted)', (await collectionCreator(chain(padded), base, A, P.initAuthority)).by, 'unverifiable')
  { const r = await resolveCollection(Object.assign(fake(null), chain(hist)), { ...P, collection: null }, base, { discovered: [D, A, E] })
    H.eq('V2 end to end (real creator check): ours adopted among a stranger\'s decoy and a failed create', [r.collection, r.conflict, r.ignored.map(i => i.address).sort()], [A, null, [D, E].sort()]) }
  // ── ROUND 42 (V42-2): a stranger's transaction naming the address lands BEFORE the
  // real create (a front-run, or a retry reusing the keypair). The creator is the
  // oldest SUCCESSFUL create of exactly this address, so ours is still ours. ──
  {
    const F = kp(70).toBase58(), G = kp(71).toBase58(), J = kp(72).toBase58(), K = kp(73).toBase58(), L = kp(74).toBase58()
    const to = (dst, n = 1) => web3.SystemProgram.transfer({ fromPubkey: MALLORY, toPubkey: new web3.PublicKey(dst), lamports: n })
    const failedSig = { InstructionError: [0, 'InsufficientFundsForRent'] }
    const h42 = {
      // the RPC lists a failed transaction with its err (the page skips it unread)
      [F]: [{ signature: sigOf(21), tx: tx(GARY, createIx(F, GARY)) }, { signature: sigOf(20), err: failedSig, tx: tx(MALLORY, to(F), failedSig) }],
      // the same, with only the transaction's own meta.err saying it failed
      [K]: [{ signature: sigOf(31), tx: tx(GARY, createIx(K, GARY)) }, { signature: sigOf(30), tx: tx(MALLORY, to(K), failedSig) }],
      // a stranger's SUCCESSFUL transfer lands first
      [G]: [{ signature: sigOf(23), tx: tx(GARY, createIx(G, GARY)) }, { signature: sigOf(22), tx: tx(MALLORY, to(G, 2_000_000)) }],
      // only strangers' transfers, no create at all
      [J]: [{ signature: sigOf(25), tx: tx(MALLORY, to(J, 2_000_000)) }, { signature: sigOf(24), tx: tx(MALLORY, to(J, 2_000_000)) }],
      // more successful transfers before the create than the page fetches: bounded, unverifiable
      [L]: [{ signature: sigOf(40), tx: tx(GARY, createIx(L, GARY)) }, ...Array.from({ length: CREATOR_FETCH_MAX }, (_, i) => ({ signature: `pre${i}`, tx: tx(MALLORY, to(L, 2_000_000)) }))],
    }
    const c42 = c => collectionCreator(chain(h42), base, c, P.initAuthority)
    H.eq('V42-2: a stranger\'s FAILED transfer listed before the launch key\'s create: ours (by the create\'s signature)', [(await c42(F)).by, (await c42(F)).signature], ['launch', sigOf(21)])
    H.eq('V42-2: the same, the failure known only from the transaction\'s meta.err: ours', [(await c42(K)).by, (await c42(K)).signature], ['launch', sigOf(31)])
    H.eq('V42-2: a stranger\'s SUCCESSFUL transfer listed before the launch key\'s create: ours', [(await c42(G)).by, (await c42(G)).signature], ['launch', sigOf(23)])
    H.eq('V42-2 control: a complete history of strangers\' transfers with no create: unverifiable, never other', (await c42(J)).by, 'unverifiable')
    H.eq(`V42-2 control: ${CREATOR_FETCH_MAX} successful transfers before the create: the search is bounded and says unverifiable`, (await c42(L)).by, 'unverifiable')
    const r = await resolveCollection(Object.assign(fake(null), chain({ ...hist, ...h42 })), { ...P, collection: null }, base, { discovered: [D, F] })
    H.eq('V42-2 end to end: nothing pinned, the real collection behind a stranger\'s failed transfer is ADOPTED, the decoy ignored', [r.collection, r.conflict, r.ignored.map(i => i.address)], [F, null, [D]])
  }
  const pageSrc = fs.readFileSync(`${ROOT}/web/src/pages/ceremony.mjs`, 'utf8')
  H.t('M2: the page remembers the new address BEFORE step 0 is signed, and refuses step 0 when it cannot scan the chain',
    // round 40 C01: indexOf is -1 when the call is MISSING, so presence is required before the order is compared
    (at => at >= 0 && at < pageSrc.indexOf("await signExact(wallet, tx, s.id === 'collection'"))(pageSrc.indexOf("remember(ctx.newCollection.publicKey.toBase58())")) &&
    /if \(!collection && discoverErr\)/.test(pageSrc))
}
// ── the rehearsal bounds (localnet and rehearsal only) ──
H.eq('rehearsal bounds: the ruled values (dates filled) pass', judgeRehearsal(filled, NOW), [])
H.t('rehearsal bounds: an OPEN value is refused', judgeRehearsal({ ...launch, vault_collection: { value: null, status: 'OPEN', source: 'negative fixture' } }, NOW).some(x => /OPEN/.test(x)))
{
  const q = JSON.parse(JSON.stringify(filled)); q.quorum_bps.value = 400
  H.t('rehearsal bounds: a quorum below GOV\'s 500 floor is refused', judgeRehearsal(q, NOW).some(x => /quorum/.test(x)))
}

// ── ROUND 44 (V44-1): the dress rehearsal's ceremony judges launch/rehearsal-init.json
//    with check-launch-params' OWN --rehearsal judge; the page could not before ──
{
  const REH = JSON.parse(fs.readFileSync(`${ROOT}/launch/rehearsal-init.json`, 'utf8'))
  const RP = PROFILES.rehearsal
  const fillReh = (over = {}) => {
    const q = JSON.parse(JSON.stringify(REH)), set = (k, val) => { q[k].value = val }
    set('guardian', kp(61).toBase58()); set('bank_treasury', kp(62).toBase58()); set('swap_operator', kp(63).toBase58())
    set('pob_collection', kp(64).toBase58()); set('vault_collection', kp(65).toBase58()); set('cbob_mint', kp(66).toBase58())
    set('cbob_release_wallet', kp(67).toBase58()); set('pob_root', '11'.repeat(32)); set('charter_opens_at', NOW + 300)
    for (const [k, val] of Object.entries(over)) set(k, val)
    return q
  }
  const judge = judgeFor(RP, { judgeLaunch, judgeRehearsalFile, judgeRehearsal, mainnetJson: launch, pobSet })
  H.eq('V44-1: the rehearsal profile\'s ceremony judges the REAL launch/rehearsal-init.json (its REHEARSAL-OPEN keys filled) and passes it; lock_deadline stays REHEARSAL-NA', judge(fillReh(), NOW), [])
  H.t('V44-1: ...and it is check-launch-params\' own judge: the real guardian is refused there, as --rehearsal refuses it', judge(fillReh({ guardian: GUARDIAN_AT_LAUNCH }), NOW).some(x => /guardian is the mainnet guardian/.test(x)))
  H.t('V44-1: ...the real CBOBTC Squads as the rehearsal treasury is refused too', judge(fillReh({ bank_treasury: CBOBTC_SQUADS }), NOW).some(x => /bank_treasury is the CBOBTC Squads/.test(x)))
  H.t('V44-1: ...and the unfilled committed file still refuses (its OPEN keys named), never passes', judge(REH, NOW).some(x => /^OPEN: guardian/.test(x)))
  H.eq('V44-1: the localnet bounds judge no longer calls a REHEARSAL-NA key OPEN', judgeRehearsal(fillReh(), NOW).filter(x => /lock_deadline/.test(x)), [])
  H.t('V44-1 control: the MAINNET profile\'s ceremony still refuses the rehearsal file', judgeFor(profile('mainnet'), { judgeLaunch, judgeRehearsalFile, judgeRehearsal, mainnetJson: launch, pobSet })(fillReh(), NOW).length > 0)
  H.eq('V44-1: the rehearsal profile\'s init key IS the value file\'s init_authority (the box signs, Gary 2026-10-08)', RP.initAuthority, REH.init_authority.value)
  H.eq('V44-1: the rehearsal profile pins no Squads; the 15% goes to the value file\'s throwaway treasury', [RP.squads, squadsFor(RP, valuesFrom(fillReh()))], [null, kp(62).toBase58()])
  H.eq('V44-1 control: mainnet still pins the CBOBTC Squads whatever a value file says', squadsFor(profile('mainnet'), valuesFrom(fillReh())), CBOBTC_SQUADS)
  H.t('V44-1: an unknown judge name refuses rather than passing', judgeFor({ name: 'x', launchJudge: 'nope' }, {})(fillReh(), NOW).length === 1)
}
// ── ROUND 46: only Gary's wallet signs the hosted rehearsal page (Gary 2026-10-09),
//    the rehearsal init key on mainnet genesis (V46-8), refused values stop the
//    preflight (V46-6) ──
{
  const pageSrc = fs.readFileSync(`${ROOT}/web/src/pages/ceremony.mjs`, 'utf8')
  const REH = JSON.parse(fs.readFileSync(`${ROOT}/launch/rehearsal-init.json`, 'utf8'))
  const RP = PROFILES.rehearsal, LOCALNET_KEY = 'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB'
  H.eq('R46 option 1: the rehearsal profile\'s init key is Gary\'s wallet, RULED in the value file', [RP.initAuthority, REH.init_authority.value, REH.init_authority.status], [GUARDIAN_AT_LAUNCH, GUARDIAN_AT_LAUNCH, 'RULED'])
  H.eq('R46 walletRefusal: the launch key, with a value file naming it (or none yet), may sign', [walletRefusal(GUARDIAN_AT_LAUNCH, RP.initAuthority, GUARDIAN_AT_LAUNCH), walletRefusal(GUARDIAN_AT_LAUNCH, RP.initAuthority, undefined)], [null, null])
  H.t('R46 walletRefusal: ANY other wallet is refused before a transaction is built (the localnet key, a stranger)',
    [LOCALNET_KEY, kp(70).toBase58()].every(w => /not the launch key/.test(walletRefusal(w, RP.initAuthority, GUARDIAN_AT_LAUNCH) || '')))
  H.t('R46 walletRefusal: ...and a page built with a value file naming another init key refuses even the launch key',
    /value file whose init_authority \(GmaDrpp/.test(walletRefusal(GUARDIAN_AT_LAUNCH, RP.initAuthority, LOCALNET_KEY) || ''))
  const runBody = pageSrc.slice(pageSrc.indexOf('async function run()'), pageSrc.indexOf('async function preflight()'))
  H.t('R46 the page asks walletRefusal FIRST in run(), with the value file\'s init_authority, and returns on a refusal before preflight or any step',
    /const refusal = walletRefusal\(wallet\.publicKey\.toBase58\(\), P\.initAuthority, launchJson\(\)\?\.init_authority\?\.value\)\n\s+if \(refusal\) \{ out\.append\(box\('refuse', refusal\)\); return \}/.test(runBody)
    && runBody.indexOf('walletRefusal(') < runBody.indexOf('preflight()') && runBody.indexOf('walletRefusal(') < runBody.indexOf('steps('))
  const judge = judgeFor(RP, { judgeLaunch, judgeRehearsalFile, judgeRehearsal, mainnetJson: launch, pobSet })
  const fillInit = a => { const q = JSON.parse(JSON.stringify(REH)), set = (k, val) => { q[k].value = val }
    set('guardian', kp(61).toBase58()); set('bank_treasury', kp(62).toBase58()); set('swap_operator', kp(63).toBase58())
    set('pob_collection', kp(64).toBase58()); set('vault_collection', kp(65).toBase58()); set('cbob_mint', kp(66).toBase58())
    set('cbob_release_wallet', kp(67).toBase58()); set('pob_root', '11'.repeat(32)); set('charter_opens_at', NOW + 300); set('init_authority', a); return q }
  H.eq('R46 V46-8: the rehearsal page judges on MAINNET genesis: Gary\'s wallet passes, the seed-7 localnet key is refused',
    [judge(fillInit(GUARDIAN_AT_LAUNCH), NOW), judge(fillInit(LOCALNET_KEY), NOW).some(x => /Gary's wallet on mainnet genesis/.test(x))], [[], true])
  const pre = pageSrc.slice(pageSrc.indexOf('async function preflight()'))
  H.t('R46 V46-6: refused launch values END the preflight (NOT READY) before the program, mint or account reads',
    /\n  if \(fails\.length\) return null\n/.test(pre) && pre.indexOf('if (fails.length) return null') > pre.indexOf('line(v.bankTreasury === squadsFor(P, v)')
    && pre.indexOf('if (fails.length) return null') < pre.indexOf('// the programs'))
}
// ── ROUND 44 (V44-7): a PINNED collection that does not exist is "the pin is wrong",
//    not "WRONG ON CHAIN ... can never be rewritten" ──
{
  const none = { getAccountInfo: async () => null }
  const st = await readStep({ ids, v, conn: none }, 'collection')
  H.eq('V44-7: a pinned, absent collection gives the ABSENT result, not BROKEN', stepVerdict(st), 'absent')
  H.eq('V44-7: stepVerdict reads every readStep shape once: not run, done, broken, absent, and an unknown object is never done',
    [stepVerdict(null), stepVerdict([]), stepVerdict(['x']), stepVerdict({ absent: 'y' }), stepVerdict({})], ['next', 'done', 'broken', 'absent', 'broken'])
  const pg = fs.readFileSync(`${ROOT}/web/src/pages/ceremony.mjs`, 'utf8')
  H.t('V44-7: the page decides each step, and the after-landing check, through stepVerdict', /const verdict = stepVerdict\(state\)/.test(pg) && /stepVerdict\(after\) !== 'done'/.test(pg) && !/if \(!after \|\| after\.length\)/.test(pg))
}
export default H.done()
