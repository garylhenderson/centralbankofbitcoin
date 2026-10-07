/**
 * BYTE-FOR-BYTE: every instruction the pages build against the builder the
 * suite or the Test Vault simulation sends (extracted from their source by
 * ref.mjs), against mpl-core's own `execute`, and against @solana/spl-token.
 */
import * as web3 from '@solana/web3.js'
import * as spl from '@solana/spl-token'
import { profile } from '../src/config.js'
import { makeIds, ata, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from '../src/lib/ids.mjs'
import * as IX from '../src/lib/ix.mjs'
import { SUITE, SIM, extractConst, extractIxAround, ts2js, evalWith, scopeFor, diffIx, harness } from './ref.mjs'

const { PublicKey: W, Keypair } = web3
const H = harness('ix')
const kp = n => Keypair.fromSeed(Buffer.alloc(32, n)).publicKey
const COLL = kp(41)
const ids = makeIds({ ...profile('mainnet'), collection: COLL.toBase58() })
const owner = kp(1), payer = kp(2), asset = kp(3), host = kp(4), stranger = kp(5)
const pda = ids.depositAddress(asset)
const CBBTC = new W('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'), GARY = new W('8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk'), GIRAFFISH = new W('Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump')
const RES = [CBBTC, GARY, GIRAFFISH]
const POOL = spl.getAssociatedTokenAddressSync(CBBTC, ids.MINT_CFG, true)
const POOLK = { pubkey: POOL, isSigner: false, isWritable: false }
const same = (name, mine, ref) => { const d = diffIx(mine, ref); H.t(name, d.length === 0, d.join('\n        ')) }

// ── tests/3prog.test.ts builders ──
const suiteScope = scopeFor(ids, { mint: CBBTC, POOL, POOLK, GARY_MINT: GARY,
  ata: (o, m = CBBTC) => spl.getAssociatedTokenAddressSync(m, o, true) })
const S = name => evalWith(ts2js(extractConst(SUITE, name)), suiteScope, name)

same('3prog ixOpen == openForRedemption', IX.openForRedemption(ids, asset, owner), S('ixOpen')({ asset }, owner))
same('3prog ixOpen (separate payer) == openForRedemption', IX.openForRedemption(ids, asset, owner, payer), S('ixOpen')({ asset }, owner, payer))
{
  const declared = RES.flatMap(m => [ata(pda, m, TOKEN_PROGRAM), ata(pda, m, TOKEN_2022_PROGRAM)])
  same('3prog ixBurn == burnVault (six declared accounts)', IX.burnVault(ids, asset, owner, pda, POOL, declared), S('ixBurn')({ asset, pda }, owner, declared))
  same('3prog ixBurn (separate payer) == burnVault', IX.burnVault(ids, asset, owner, pda, POOL, declared, payer), S('ixBurn')({ asset, pda }, owner, declared, payer))
}
same('3prog ixPoolClaim == poolClaim (one vault, its own cbBTC account)',
  IX.poolClaim(ids, POOL, [{ asset, dest: ata(pda, CBBTC) }]), S('ixPoolClaim')([{ asset, pda }]))
same('3prog ixActivate == activate', IX.activate(ids, asset, ata(pda, CBBTC), POOL), S('ixActivate')({ asset, pda }))
same('3prog ixRescue (round 35) == rescueNested', IX.rescueNested(ids, asset, host, owner, payer), S('ixRescue')(asset, host, owner, payer))
same('3prog ixRescue, the vault in its own wallet == rescueNested', IX.rescueNested(ids, asset, asset, stranger, payer), S('ixRescue')(asset, asset, stranger, payer))
same('3prog ixDistribute(burn) == distribute (100 $GARY burn)', IX.distribute(ids, POOL, owner, GARY), S('ixDistribute')({ burn: true, burner: owner }))
same('3prog ixDistribute(free) == distribute', IX.distribute(ids, POOL), S('ixDistribute')({}))

// initializes: the suite's builders close over its fixtures; we hand them mainnet's values
const MAINNET = { treasury: new W('bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1'), swapOp: new W('bipP7uK5aQDsrChYA8hpZ1Thb8BCw7emRGuEkLkHg6G'),
  guardian: new W('Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb'), cbob: new W('GMm2yY2z333tMkDSHTxNGuxNzr196XgWVCgr3odSKaXc'),
  moments: new W('F9TDm35JQYZEB1zBPJG2HRTFM3M4ukjuLTMGhk13hsnT'), root: Buffer.from('522ac90e5e6b9f1f3f262056c66b3bf5c19eebe5c4070cc607896f5b87d0809c', 'hex') }
const auth = { publicKey: MAINNET.guardian }
const opens = 1_800_000_000, closes = opens + 604800
const initScope = scopeFor(ids, { mint: CBBTC, POOL, POOLK, bankTreasury: { publicKey: MAINNET.treasury }, swapOp: { publicKey: MAINNET.swapOp },
  guardian: { publicKey: MAINNET.guardian }, MAX_SUPPLY: 2100n, SWEEP_CAP: 10_000_000_000n, SWEEP_COOLDOWN: 21600,
  LEVEL_CAPS: [945, 525, 315, 210, 105], MOMENTS: MAINNET.moments, POB_ROOT: MAINNET.root, CHARTER_OPENS: opens, CHARTER_CLOSES: closes,
  MONTHLY: 2592000, NOTICE: 604800, SWEEP_FLOOR: 1_000_000_000n, COOLDOWN_CEIL: 86400, RESERVE_CEIL: 100_000_000n,
  MAX_BOOST_W: 12, MAX_BOOST_E: 24, cbobMint: MAINNET.cbob, REDEEM_WINDOW: 3600, VOTE_SECS: 259200 })
const I = name => evalWith(ts2js(extractConst(SUITE, name)), initScope, name)
same('3prog ixSealInit == sealInit (three reserves)', IX.sealInit(ids, MAINNET.guardian, COLL, RES), I('ixSealInit')(auth, RES))
const V = { bankTreasury: MAINNET.treasury, swapOperator: MAINNET.swapOp, guardian: MAINNET.guardian, solReserveLamports: 50_000_000,
  maxSupply: 2100, maxSweepLamports: 10_000_000_000, sweepCooldownSecs: 21600, levelCaps: [945, 525, 315, 210, 105],
  paymentMint: CBBTC, pobCollection: MAINNET.moments, pobRoot: MAINNET.root, charterOpensAt: opens, charterClosesAt: closes,
  monthlySecs: 2592000, noticeSecs: 604800, sweepFloorLamports: 1_000_000_000, cooldownCeilingSecs: 86400,
  reserveCeilingLamports: 100_000_000, maxBoostWeight: 12, maxBoostEpochs: 24, cbobMint: MAINNET.cbob, collection: COLL }
same('3prog ixMintInit == mintInit (mainnet values)', IX.mintInit(ids, MAINNET.guardian, V), I('ixMintInit')(auth))
same('3prog ixBurnInit == burnInit', IX.burnInit(ids, MAINNET.guardian, COLL, 3600), I('ixBurnInit')(auth, 3600))
same('3prog ixGovInit == govInit (its threshold is fixed at 6000 there)', IX.govInit(ids, MAINNET.guardian, COLL, 2100, 6000, 259200), I('ixGovInit')(auth, 2100))

// ── sim/test-vault.ts: the production-shaped builders and the inline initializes ──
const simScope = scopeFor(ids, { RES, POOL, POOLK, CBBTC, GARY, GIRAFFISH,
  deployer: { publicKey: MAINNET.guardian }, treasury: { publicKey: MAINNET.treasury }, swapOp: { publicKey: MAINNET.swapOp },
  guardian: { publicKey: MAINNET.guardian }, MAX_SUPPLY: 2100n, CENSUS: [945, 525, 315, 210, 105], MOMENTS: MAINNET.moments,
  SET: { root: MAINNET.root.toString('hex') }, OPENS: opens, CLOSES: closes, MONTHLY: 2592000, NOTICE: 604800, WINDOW: 3600,
  VOTE_SECS: 259200, CBOB: MAINNET.cbob })
simScope.declare = p => RES.flatMap(m => [spl.getAssociatedTokenAddressSync(m, p, true), spl.getAssociatedTokenAddressSync(m, p, true, spl.TOKEN_2022_PROGRAM_ID)])
const X = name => evalWith(ts2js(extractConst(SIM, name)), simScope, name)
const TV = { asset, pda, owner: { publicKey: owner } }
same('sim ixOpen == openForRedemption', IX.openForRedemption(ids, asset, owner), X('ixOpen')(TV, owner))
same('sim ixBurn (declare = 3 reserves x 2 programs) == burnVault',
  IX.burnVault(ids, asset, owner, pda, POOL, RES.flatMap(m => [ata(pda, m, TOKEN_PROGRAM), ata(pda, m, TOKEN_2022_PROGRAM)])), X('ixBurn')(TV, owner))
same('sim ixPoolClaim == poolClaim', IX.poolClaim(ids, POOL, [{ asset, dest: ata(pda, CBBTC) }]), X('ixPoolClaim')([TV]))
same('sim ixActivate == activate', IX.activate(ids, asset, ata(pda, CBBTC), POOL), X('ixActivate')(TV))
const inline = (marker, extra = '') => evalWith(ts2js(`const __ix = ${extractIxAround(SIM, marker)}`), simScope, '__ix')
same('sim S1 SEAL initialize == sealInit', IX.sealInit(ids, MAINNET.guardian, COLL, RES),
  inline("data: Buffer.concat([d('initialize'), COLL.toBuffer(), u32(3)"))
const simMint = inline("data: Buffer.concat([d('initialize'), treasury.publicKey.toBuffer()")
same('sim S1 MINT initialize == mintInit (its own values: 50 SOL, 3600 s, 6 / 24)',
  IX.mintInit(ids, MAINNET.guardian, { ...V, maxSweepLamports: 50_000_000_000, sweepCooldownSecs: 3600, monthlySecs: 2592000, maxBoostWeight: 6 }), simMint)
same('sim S1 BURN initialize == burnInit', IX.burnInit(ids, MAINNET.guardian, COLL, 3600),
  inline("{ programId: BURN_PROG, data: Buffer.concat([d('initialize'), COLL.toBuffer(), i64(WINDOW)])"))
same('sim S1 GOV initialize == govInit (Gary\'s 21% / 51%)', IX.govInit(ids, MAINNET.guardian, COLL, 2100, 5100, 259200),
  inline("data: Buffer.concat([d('initialize'), COLL.toBuffer(), u16(2100), u16(5100), i64(VOTE_SECS)])"))
// the helper instruction exactly as S8 builds it, and through Core
const TVU = { asset, pda, pdaU: findPdaU(simScope, asset), owner: { publicKey: owner } }
const simHelper = evalWith(ts2js(`const alice = { publicKey: OWNER }\n${extractConst(SIM, 'helper')}`), { ...simScope, OWNER: owner, TV: TVU }, 'helper')
const pairs = RES.map(m => [ata(pda, m), ata(owner, m)])
same('sim S8 helper == sweepHelper (all three reserves)', IX.sweepHelper(ids, pda, owner, pairs), simHelper)
const simViaCore = evalWith(ts2js(`const alice = { publicKey: OWNER }\n${extractConst(SIM, 'helper')}\n${extractConst(SIM, 'viaCore')}`),
  { ...simScope, OWNER: owner, TV: TVU }, 'viaCore')
H.t('sim S8 viaCore is ONE ExecuteV1', simViaCore.length === 1)
same('sim S8 viaCore (mpl-core execute) == coreExecute(sweepHelper)',
  IX.coreExecute(ids, { asset, collection: COLL, assetSigner: pda, payer: owner, authority: owner, inner: IX.sweepHelper(ids, pda, owner, pairs) }), simViaCore[0])
// a stray pair beyond the reserves (round 25 D7)
{
  const stray = kp(60), strayDest = ata(owner, kp(61))
  const ref = evalWith(ts2js(extractConst(SUITE, 'sweepIx')), suiteScope, 'sweepIx')({ pda }, owner, [...pairs, [stray, strayDest]])
  same('3prog sweepIx with a stray pair == sweepHelper', IX.sweepHelper(ids, pda, owner, [...pairs, [stray, strayDest]]), ref)
}
// C5: a plain SPL transfer through Core (the sim's own `sweep` with one transfer leg)
{
  const amt = 12345n
  const ref = X('sweep')({ asset, pdaU: findPdaU(simScope, asset), pda, owner: { publicKey: owner } }, [[GARY, amt, false]])
  H.t('sim sweep (one transfer leg) is ONE ExecuteV1', ref.length === 1)
  same('sim sweep (transfer leg) == coreExecute(tokenTransfer) (round 35 C5)',
    IX.coreExecute(ids, { asset, collection: COLL, assetSigner: pda, payer: owner, authority: owner, inner: IX.tokenTransfer(ata(pda, GARY), ata(owner, GARY), pda, amt) }), ref[0])
}

// ── SPL ──
same('createAtaIdempotent == spl-token createAssociatedTokenAccountIdempotentInstruction (off-curve owner)',
  IX.createAtaIdempotent(owner, ata(pda, CBBTC), pda, CBBTC), spl.createAssociatedTokenAccountIdempotentInstruction(owner, ata(pda, CBBTC), pda, CBBTC))
same('tokenTransfer == spl-token createTransferInstruction', IX.tokenTransfer(kp(70), kp(71), pda, 99n), spl.createTransferInstruction(kp(70), kp(71), pda, 99n))
same('systemTransfer == SystemProgram.transfer', IX.systemTransfer(owner, ids.REVENUE, 1000), web3.SystemProgram.transfer({ fromPubkey: owner, toPubkey: ids.REVENUE, lamports: 1000 }))
H.eq('ExecuteV1 discriminator is mpl-core\'s 31', IX.IX_CORE_EXECUTE_V1, 31)


// ── round 2: the collection, claim, buy and the level draw ──
{
  const POBC = new W('F9TDm35JQYZEB1zBPJG2HRTFM3M4ukjuLTMGhk13hsnT'), pob = kp(30)
  const proof = [Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(32, 3)]
  const sc = scopeFor(ids, { mint: CBBTC, POOL, POOLK, MOMENTS: POBC, revAta: spl.getAssociatedTokenAddressSync(CBBTC, ids.REVENUE, true), PRICE: 50_000n,
    ata: (o, m = CBBTC) => spl.getAssociatedTokenAddressSync(m, o, true),
    attrs: list => Buffer.concat([Buffer.from(Uint32Array.of(list.length).buffer), ...list.flatMap(([k, v]) => [Buffer.concat([Buffer.from(Uint32Array.of(Buffer.byteLength(k)).buffer), Buffer.from(k)]), Buffer.concat([Buffer.from(Uint32Array.of(Buffer.byteLength(v)).buffer), Buffer.from(v)])])]),
    proofBuf: pr => Buffer.concat([Buffer.from(Uint32Array.of(pr.length).buffer), ...pr]), SLOT_HASHES: new W('SysvarS1otHashes111111111111111111111111111'),
    deployer: { publicKey: payer } })
  const T = name => evalWith(ts2js(extractConst(SUITE, name)), sc, name)
  const base = { asset, owner, pob, pobCollection: POBC, pool: POOL, proof, name: 'CBOBTC Charter Vault', uri: 'https://cdn.gary.club/cbob/v.json' }
  same('3prog ixClaim (no crank, no pass-through) == claimCharterVault', IX.claimCharterVault(ids, base), T('ixClaim')(asset, owner, owner, pob, proof))
  same('3prog ixClaim (separate payer, two pass-through accounts) == claimCharterVault',
    IX.claimCharterVault(ids, { ...base, payer, extra: [kp(31), kp(32)] }), T('ixClaim')(asset, owner, payer, pob, proof, { extra: [kp(31), kp(32)] }))
  same('3prog ixClaim with provenance attributes == claimCharterVault', IX.claimCharterVault(ids, { ...base, attributes: [['a', 'b']] }), T('ixClaim')(asset, owner, owner, pob, proof, { attrs: [['a', 'b']] }))
  const mbase = { asset, owner, payerToken: ata(owner, CBBTC), paymentMint: CBBTC, revenueToken: ata(ids.REVENUE, CBBTC), pool: POOL,
    maxPrice: 50_000n, name: 'CBOBTC Vault', uri: 'https://cdn.gary.club/cbob/v.json' }
  same('3prog ixMint (no crank) == mintVault', IX.mintVault(ids, mbase), T('ixMint')(asset, owner, owner))
  same('3prog ixMint (separate payer, its own cbBTC account) == mintVault',
    IX.mintVault(ids, { ...mbase, payer, payerToken: ata(payer, CBBTC) }), T('ixMint')(asset, owner, payer))
  same('3prog ixMint with a different max price == mintVault', IX.mintVault(ids, { ...mbase, maxPrice: 21_000n }), T('ixMint')(asset, owner, owner, { maxPrice: 21_000n }))
  same('3prog ixCapture == captureEntropy', IX.captureEntropy(ids, asset), T('ixCapture')(asset))
  same('3prog ixReveal == revealLevel (charter provenance re-supplied)', IX.revealLevel(ids, asset, [['charter', pob.toBase58()]], payer), T('ixReveal')(asset, [['charter', pob.toBase58()]], payer))
  same('3prog ixReschedule == rescheduleReveal', IX.rescheduleReveal(ids, asset), T('ixReschedule')(asset))
  // the production-shaped ones in the sim
  const ss = { ...simScope, ata: (o, m) => spl.getAssociatedTokenAddressSync(m, o, true), revAta: spl.getAssociatedTokenAddressSync(CBBTC, ids.REVENUE, true), MOMENTS: POBC,
    attrs: sc.attrs }
  same('sim ixClaim == claimCharterVault', IX.claimCharterVault(ids, base), evalWith(ts2js(extractConst(SIM, 'ixClaim')), ss, 'ixClaim')(asset, owner, pob, proof))
  same('sim ixMint (real cbBTC) == mintVault', IX.mintVault(ids, { ...mbase, maxPrice: 21_000n, name: 'CBOBTC Vault' }), evalWith(ts2js(extractConst(SIM, 'ixMint')), ss, 'ixMint')(asset, owner, 21_000n))
  // the collection, against mpl-core's createCollection (the helper both test files call)
  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults')
  const { createNoopSigner, signerIdentity, publicKey: upk } = await import('@metaplex-foundation/umi')
  const { mplCore, createCollection } = await import('@metaplex-foundation/mpl-core')
  const umi = createUmi('http://127.0.0.1:1').use(mplCore()).use(signerIdentity(createNoopSigner(upk(payer.toBase58()))))
  const collKey = kp(33)
  const ref = createCollection(umi, { collection: createNoopSigner(upk(collKey.toBase58())), name: 'Central Bank of Bitcoin Vaults',
    uri: 'https://centralbankofbitcoin.com/v/collection.json', updateAuthority: upk(ids.MINT_AUTH.toBase58()) }).getInstructions()
  H.t('mpl-core createCollection is ONE instruction', ref.length === 1)
  const refIx = new web3.TransactionInstruction({ programId: new W(ref[0].programId), data: Buffer.from(ref[0].data),
    keys: ref[0].keys.map(k => ({ pubkey: new W(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })) })
  same('mpl-core createCollection (no plugins, MINT\'s PDA as update authority) == coreCreateCollection',
    IX.coreCreateCollection(ids, collKey, ids.MINT_AUTH, payer, 'Central Bank of Bitcoin Vaults', 'https://centralbankofbitcoin.com/v/collection.json'), refIx)
  const simColl = SIM.includes("createCollection(umi, { collection: coll, name: 'CBOBTC Vaults', uri: 'https://cdn.gary.club/cbob/c.json',\n    updateAuthority: pk(MINT_AUTH.toBase58()) })")
  H.t('...the sim creates its collection with that same helper and no plugins (checked in its source)', simColl)
}

// the comparison itself must be able to fail: one flag, one byte, one account
{
  const good = IX.openForRedemption(ids, asset, owner)
  const flag = IX.openForRedemption(ids, asset, owner); flag.keys[2] = { ...flag.keys[2], isSigner: false }
  const byte = IX.openForRedemption(ids, asset, owner); byte.data = Buffer.from(byte.data); byte.data[0] ^= 1
  const acct = IX.openForRedemption(ids, asset, stranger)
  H.t('CONTROL: diffIx catches a cleared signer flag, a changed data byte, and a different account',
    diffIx(good, flag).length > 0 && diffIx(good, byte).length > 0 && diffIx(good, acct).length > 0)
}

function findPdaU(scope, a) { return scope.findAssetSignerPda(scope.umi, { asset: scope.pk(a.toBase58()) })[0] }
export default H.done()
