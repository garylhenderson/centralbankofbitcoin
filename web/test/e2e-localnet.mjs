/**
 * END TO END on a LOCAL validator (NOT run by `web/test/run-all.mjs`; run it with
 * web/test/e2e-localnet.sh, which prepares the validator the way sim/run-sim.sh
 * does: real Core, the three real reserve mints and two real Proof of Burn assets
 * cloned from mainnet, and the LOCALNET build of the five programs).
 *
 * It drives the pages' OWN library code, with keypairs in place of Phantom (plus, for gate 5,
 * a claim-first opening of an ACTIVE vault that is owed a share):
 *   CEREMONY  the collection; every program probed (and hashed against the
 *             build it deployed); road step 10 step by step exactly as the page
 *             runs it (readStep -> build -> simulate -> send -> readStep must be
 *             []); then run again to prove it resumes as "all done".
 *   VAULT     two charter vaults claimed with real Proofs of Burn and revealed;
 *             the vault page's reads; Activate from planActivate.
 *   RESCUE    a vault nested in another vault's deposit address (the redeem plan
 *             for the host does not refuse; its optional set-up step rescues it,
 *             round 39 V39-2), then the same vault in its OWN deposit address.
 *             Every rescue sends it to bank_treasury, the CBOBTC Squads, never to
 *             the host's owner (round 35 M1).
 *   REDEEM    a vault holding all three reserves, a stray classic token and a
 *             round 35 C5 account whose close authority a stranger kept; the
 *             prior transaction; the opening, with a stranger's 1-sat deposit
 *             landing AFTER the plan; every balance checked afterwards.
 *
 *   CBOB_E2E_RPC=http://127.0.0.1:8999 node web/test/e2e-localnet.mjs
 */
import fs from 'fs'
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js'
import * as spl from '@solana/spl-token'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { keypairIdentity, publicKey as pk } from '@metaplex-foundation/umi'
import { mplCore, transfer } from '@metaplex-foundation/mpl-core'
import { PROFILES, SITE } from '../src/config.js'
import { makeIds, ata } from '../src/lib/ids.mjs'
import * as IX from '../src/lib/ix.mjs'
import { sha256Hex, disc } from '../src/lib/enc.mjs'
import { STEPS, valuesFrom, judgeRehearsal, judgeProbe, judgeProgramBytes, launchWithCollection } from '../src/lib/plan-ceremony.mjs'
import { readStep, resolveCollection, withCollection, collectionCreator } from '../src/lib/ceremony-reads.mjs'
import { checkNewAddress } from '../src/lib/reads.mjs'
import { readRedemptionSnapshot, readConfigs, readVault, vaultWalletAccounts, coreAssetsOwnedBy, account, accounts, chainNow, collectionsOfMint, anchorAccount, dueBoostRecords } from '../src/lib/reads.mjs'
import { planRedemption, PACKET_LIMIT, planPayout, owedSats, rateLimit, prepareOpening, LATE_CONSENT_ID } from '../src/lib/plan-redeem.mjs'
import { planRescue, planActivate } from '../src/lib/plan-vault.mjs'
import { simulate, setProgramNames } from '../src/lib/tx.mjs'
import { parseCoreAsset, parseCoreCollection, parseProgramAccount, parseProgramData, parseTokenAccount } from '../src/lib/decode.mjs'
import { planClaim, planDraw, readPobs } from '../src/lib/plan-get.mjs'
import { harness, ROOT } from './ref.mjs'

const RPC = process.env.CBOB_E2E_RPC || 'http://127.0.0.1:8999'
const H = harness('e2e-localnet')
const conn = new Connection(RPC, 'confirmed')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const now = () => Math.floor(Date.now() / 1000)
const FIX = `${ROOT}/sim/.fixtures`
const key = f => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${FIX}/${f}`, 'utf8'))))
const deployer = Keypair.fromSeed(Buffer.alloc(32, 7))          // the localnet INIT_AUTHORITY
const alice = key('pob-owner.json'), mintAuth = key('mint-authority.json')
const stranger = Keypair.generate(), guardian = Keypair.generate(), swapOp = Keypair.generate()
// stands in for the CBOBTC Squads, so the e2e can play its part: return a rescued vault to its sender
const treasury = Keypair.generate()
const SET = JSON.parse(fs.readFileSync(`${ROOT}/scripts/pob-set.json`, 'utf8'))
const PICKS = JSON.parse(fs.readFileSync(`${FIX}/pob-picks.json`, 'utf8'))
const CBBTC = new PublicKey('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'), GARY = new PublicKey('8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk'), GIRAFFISH = new PublicKey('Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump')

async function send(ixs, signers, feePayer = signers[0]) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed')
  const tx = new Transaction({ feePayer: feePayer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs)
  tx.sign(...signers)
  const sig = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' })
  const c = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  if (c.value.err) throw new Error(`tx failed: ${JSON.stringify(c.value.err)}`)
  return { sig, size: tx.serialize().length }
}
const simOf = async (ixs, payer) => { const { blockhash } = await conn.getLatestBlockhash('confirmed'); const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(...ixs); return simulate(conn, tx) }
const bal = async a => { const i = await conn.getAccountInfo(new PublicKey(a), 'confirmed'); return i ? parseTokenAccount(i.data).amount : 0n }

async function main() {
  for (const k of [deployer, alice, stranger, mintAuth, treasury]) { const s = await conn.requestAirdrop(k.publicKey, 100 * LAMPORTS_PER_SOL); await conn.confirmTransaction(s, 'confirmed') }
  const umi = createUmi(RPC, { commitment: 'confirmed' }).use(mplCore()).use(keypairIdentity(createUmi(RPC).eddsa.createKeypairFromSecretKey(alice.secretKey)))

  // ═══ CEREMONY: step 0 creates the collection, then road step 10 ═══
  const P0 = { ...PROFILES.localnet, rpc: RPC, collection: null, squads: treasury.publicKey.toBase58() }
  const base = makeIds(P0)
  setProgramNames(P0.programs)
  const cbobMint = await spl.createMint(conn, deployer, deployer.publicKey, null, 6)
  const launch = JSON.parse(fs.readFileSync(`${ROOT}/launch/mainnet-init.json`, 'utf8'))
  const OPENS = now() + 60, set = (k, v) => { launch[k] = { value: v, status: 'RULED', source: 'e2e' } }
  set('init_authority', deployer.publicKey.toBase58()); set('guardian', guardian.publicKey.toBase58()); set('swap_operator', swapOp.publicKey.toBase58())
  set('bank_treasury', treasury.publicKey.toBase58()); set('cbob_mint', cbobMint.toBase58()); set('charter_opens_at', OPENS); set('charter_secs', 120); set('lock_deadline', OPENS - 30)
  set('monthly_secs', 120); set('notice_secs', 60); set('min_voting_secs', 60); set('redeem_window_secs', 20)
  H.eq('values: the rehearsal bounds pass with a stand-in for the collection', judgeRehearsal(launchWithCollection(launch, Keypair.generate().publicKey.toBase58()).json, now()), [])
  for (const [k, kind] of [['seal', 'anchor'], ['mint', 'anchor'], ['burn', 'anchor'], ['gov', 'anchor'], ['sweep', 'sweep']]) {
    const id = new PublicKey(P0.programs[k])
    H.eq(`probe ${k}: answers as the real program`, judgeProbe(kind, await simOf([kind === 'anchor' ? IX.anchorProbe(id) : IX.sweepProbe(id)], deployer.publicKey)), [])
    const pd = parseProgramData((await conn.getAccountInfo(new PublicKey(parseProgramAccount((await conn.getAccountInfo(id)).data).programData))).data)
    const file = { seal: 'cbob_vaults', mint: 'cbob_vault_mint', burn: 'cbob_vault_burn', gov: 'cbob_vault_gov', sweep: 'cbob_vault_sweep' }[k]
    const so = fs.readFileSync(`${ROOT}/target/deploy/${file}.so`)
    H.eq(`bytes ${k}: the deployed ProgramData is target/deploy/${file}.so then zeros`, judgeProgramBytes(pd, { sha256: sha256Hex(so), len: so.length }, sha256Hex), [])
  }
  const ctx = { ids: base, conn, v: valuesFrom(launchWithCollection(launch, Keypair.generate().publicKey.toBase58()).json), squads: P0.squads }
  // ROUND 37 V2, gate 5: a stranger creates a DECOY first, an exact copy naming MINT's PDA
  const decoy = Keypair.generate()
  await send([IX.coreCreateCollection(base, decoy.publicKey, base.MINT_AUTH, stranger.publicKey, SITE.collectionName, SITE.collectionUri)], [stranger, decoy])
  {
    const r = await resolveCollection(conn, P0, base, { discovered: await collectionsOfMint(conn, base) })
    H.eq('V2 e2e: a stranger\'s decoy (same name and link, MINT\'s PDA) before step 0: NOT adopted, named, no stop, so step 0 is next',
      [r.collection, r.conflict, r.ignored.map(i => i.address), /not the launch key/.test(r.ignored[0]?.why || '')], [null, null, [decoy.publicKey.toBase58()], true])
  }
  // ROUND 41 V41-1, gate 5: a stranger's lamports at all FOUR program config addresses before step 0
  {
    const cfgs = [base.SEAL_CFG, base.MINT_CFG, base.BURN_CFG, base.GOV_CFG]
    await send(cfgs.map(c => SystemProgram.transfer({ fromPubkey: stranger.publicKey, toPubkey: c, lamports: 890_880 })), [stranger])
    const got = await Promise.all(cfgs.map(c => conn.getAccountInfo(c)))
    H.t('V41-1 e2e: the four config addresses hold a stranger\'s lamports (System-owned, 0 bytes)', got.every(a => a && a.owner.equals(SystemProgram.programId) && a.data.length === 0))
    const r = await resolveCollection(conn, P0, base, { discovered: await collectionsOfMint(conn, base) })
    H.eq('V41-1 e2e: with the configs dusted, preflight has no conflict and step 0 is still next', [r.collection, r.conflict], [null, null])
  }
  for (const s of STEPS) {
    if (s.id === 'atas') {
      // ROUND 40 V40-2, gate 5: a stranger's lamports at the pool's cbBTC account ADDRESS before step 5
      const poolAtaAddr = ata(ctx.ids.MINT_CFG, ctx.v.paymentMint)
      await send([SystemProgram.transfer({ fromPubkey: stranger.publicKey, toPubkey: poolAtaAddr, lamports: 890_880 })], [stranger])
      const d = await conn.getAccountInfo(poolAtaAddr)
      H.t('V40-2 e2e: the pool cbBTC address now holds a stranger\'s lamports (System-owned, 0 bytes)', !!d && d.owner.equals(SystemProgram.programId) && d.data.length === 0)
    }
    const before = await readStep(ctx, s.id)
    H.eq(`step ${s.id}: not yet done`, before, null)
    const ixs = s.build(ctx.ids, deployer.publicKey, ctx.v, ctx)
    const sim = await simOf(ixs, deployer.publicKey)
    H.t(`step ${s.id}: dry run passes`, !sim.err, sim.explained || '')
    if (ixs.length) await send(ixs, s.id === 'collection' ? [deployer, ctx.newCollection] : [deployer])
    if (s.id === 'collection') {
      const created = ctx.newCollection.publicKey.toBase58()
      ctx.ids = withCollection(P0, created)
      ctx.v = valuesFrom(launchWithCollection(launch, created).json)
      H.eq('values: with the created collection in vault_collection, the rehearsal bounds pass', judgeRehearsal(launchWithCollection(launch, created).json, now()), [])
    }
    H.eq(`step ${s.id}: re-read, every field equals the ruled value`, await readStep(ctx, s.id), [])
  }
  for (const s of STEPS) H.eq(`resume: step ${s.id} reads as done`, await readStep(ctx, s.id), [])
  H.eq('resume: a reloaded page finds the collection through SEAL', (await resolveCollection(conn, P0, base, { discovered: await collectionsOfMint(conn, base) })).collection, ctx.ids.COLL.toBase58())
  H.eq('M2/V2: the chain scan finds the collection step 0 made AND the decoy', (await collectionsOfMint(conn, base)).sort(), [ctx.ids.COLL.toBase58(), decoy.publicKey.toBase58()].sort())
  {
    // with no pin at all (this browser's memory gone, nothing in config.js), the page asks the chain WHO created each:
    // SEAL is initialized here, so call the creator check directly, as resolveCollection does before SEAL exists
    const mine = await collectionCreator(conn, base, ctx.ids.COLL.toBase58(), P0.initAuthority), theirs = await collectionCreator(conn, base, decoy.publicKey.toBase58(), P0.initAuthority)
    H.eq('V2 e2e: the creator check on the real chain: ours was created by the launch key, the decoy by someone else', [mine.by, theirs.by], ['launch', 'other'])
    const r = await resolveCollection(conn, P0, base, { discovered: await collectionsOfMint(conn, base) })
    H.eq('V2 e2e: after SEAL, the decoy is named and ignored, never a stop', [r.collection, r.conflict, r.ignored.map(i => i.address)], [ctx.ids.COLL.toBase58(), null, [decoy.publicKey.toBase58()]])
  }
  const again = await simOf(STEPS.find(s => s.id === 'seal').build(ctx.ids, deployer.publicKey, ctx.v, ctx), deployer.publicKey)
  H.t('a second SEAL initialize is refused', !!again.err)
  const ids = ctx.ids
  const P = { ...P0, collection: ids.COLL.toBase58() }
  const coll = { publicKey: pk(ids.COLL.toBase58()) }

  // ═══ TWO CHARTER VAULTS, CLAIMED THROUGH THE CLAIM PAGE'S OWN PLAN ═══
  {
    const early = planClaim(ids, SITE, await claimSnapshot(ids), Keypair.generate().publicKey)
    H.t('claim page: before the window opens, refused with the opening time', !early.ok && early.refuse.some(r => /has not opened yet/.test(r)))
  }
  while (now() <= OPENS + 1) await sleep(500)
  const vaults = []
  for (const p of PICKS) {
    let kp = Keypair.generate()
    if (p === PICKS[0]) {
      // ROUND 42 (C12): a stranger funds the new vault's address before the claim.
      // Core cannot create over it; the claim page's check swaps in a fresh key.
      await send([SystemProgram.transfer({ fromPubkey: stranger.publicKey, toPubkey: kp.publicKey, lamports: 1_000_000 })], [stranger])
      const blocked = planClaim(ids, SITE, await claimSnapshot(ids), kp.publicKey, p.address)
      const simB = await simOf([blocked.ix], alice.publicKey)
      H.t('C12 e2e: a claim at a new-vault address a stranger FUNDED first is refused by the network (already in use)', !!simB.err && simB.logs.some(l => /already in use/.test(l)), simB.explained || '')
      const na = await checkNewAddress(conn, ids, kp, () => Keypair.generate())
      H.eq('C12 e2e: the claim page\'s address check reports it TAKEN and supplies a fresh key', [na.state, na.kp.publicKey.equals(kp.publicKey)], ['taken', false])
      kp = na.kp
    }
    const plan = planClaim(ids, SITE, await claimSnapshot(ids), kp.publicKey, p.address)
    H.eq(`claim page: Proof of Burn #${p.edition} is held and claimable`, [plan.ok, plan.refuse], [true, []])
    const sim = await simOf([plan.ix], alice.publicKey)
    H.t(`claim page: the dry run passes (${sim.unitsConsumed} CU, no crank, no compute-budget instruction)`, !sim.err, sim.explained || '')
    await send([plan.ix], [alice, kp])
    const a = parseCoreAsset((await conn.getAccountInfo(kp.publicKey)).data)
    H.eq('claim page: the vault is named "CBOB Vault" with its metadata at /v/<asset>.json, owned by the claimer',
      [a.name, a.uri, a.owner], ['CBOB Vault', `https://centralbankofbitcoin.com/v/${kp.publicKey.toBase58()}.json`, alice.publicKey.toBase58()])
    H.t(`claim page: Proof of Burn #${p.edition} is burned`, (await conn.getAccountInfo(new PublicKey(p.address))).data.length === 1)
    if (p === PICKS[0]) H.eq('C12 e2e: ...the claim with the fresh key LANDS, and a re-check of that key says it landed (no repeat)', (await checkNewAddress(conn, ids, kp, () => Keypair.generate())).state, 'landed')
    vaults.push(kp.publicKey)
  }
  {
    const again = planClaim(ids, SITE, await claimSnapshot(ids), Keypair.generate().publicKey)
    H.t('claim page: with both Proofs of Burn spent, the wallet holds none', !again.ok && again.refuse.some(r => /does not hold a Proof of Burn/.test(r)))
  }
  const [TV, TV2] = vaults
  // the level draw, through the pages' own planDraw (the vault page's "Draw my level")
  for (const a of vaults) {
    for (let i = 0; i < 200; i++) {
      const [cfg0, v0, slot] = await Promise.all([readConfigs(conn, ids), readVault(conn, ids, a), conn.getSlot('confirmed')])
      const d = planDraw(ids, cfg0.mint, a, v0.info, v0.record, slot, stranger.publicKey)
      if (d.state === 'drawn') break
      if (d.ix) { const sim = await simOf([d.ix], stranger.publicKey); if (!sim.err) await send([d.ix], [stranger]) }
      await sleep(400)
    }
    H.eq('draw: the level is drawn by a stranger through planDraw', planDraw(ids, (await readConfigs(conn, ids)).mint, a, null, (await readVault(conn, ids, a)).record, 0, stranger.publicKey).state, 'drawn')
  }
  const pdaTV = ids.depositAddress(TV)
  for (const [m, amt] of [[CBBTC, 50_000n], [GARY, 7_000_000_000n], [GIRAFFISH, 9_000_000n]]) {
    await send([spl.createAssociatedTokenAccountIdempotentInstruction(alice.publicKey, ata(pdaTV, m), pdaTV, m)], [alice])
    await spl.mintTo(conn, alice, m, ata(pdaTV, m), mintAuth, amt)
  }
  // the vault page's reads
  const cfg = await readConfigs(conn, ids)
  const tv = await readVault(conn, ids, TV)
  H.t('vault page: the level is read from the record (1..5) and the NFT carries the matching attribute',
    tv.record.level >= 1 && tv.record.level <= 5 && tv.info.plugin('Attributes')?.body.attributeList.some(x => x.key === 'level' && x.value === ['I', 'II', 'III', 'IV', 'V'][tv.record.level - 1]))
  H.t('vault page: sealed', tv.info.plugin('PermanentFreezeExecute')?.body.frozen === true)
  { const w = await vaultWalletAccounts(conn, pdaTV, cfg.seal.reserve_mints)
    H.eq('vault page: the deposit address holds the three reserves (read by address, round 37 V1)', [w.tokens.filter(t => t.parsed?.amount > 0n).length, w.incomplete], [3, null]) }
  const act = planActivate(ids, cfg.mint, TV, tv.info, tv.record, parseTokenAccount((await conn.getAccountInfo(ata(pdaTV, CBBTC))).data))
  H.eq('activate: eligible at 50,000 sats', [act.ok, act.step], [true, 'request'])
  await send([act.ix], [stranger])
  H.t('activate: the record is now pending', (await readVault(conn, ids, TV)).record.pending === true)

  // ═══ RESCUE: nested in TV, then in its own deposit address ═══
  const coreTransfer = async (asset, to) => transfer(umi, { asset: { publicKey: pk(asset.toBase58()), owner: pk(alice.publicKey.toBase58()) },
    collection: { publicKey: coll.publicKey }, newOwner: pk(to.toBase58()) }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
  await coreTransfer(TV2, pdaTV)
  const nested = await coreAssetsOwnedBy(P, conn, ids, pdaTV)
  H.eq('nested: the read sees TV2 inside TV, as one of OUR vaults, and the read is complete', [nested.assets.map(a => [a.address, a.ourVault]), nested.incomplete], [[[TV2.toBase58(), true]], null])
  {
    const snap = await readRedemptionSnapshot(P, conn, ids, alice.publicKey, TV)
    const hp = planRedemption(ids, snap), g = hp.prior.find(x => x.optional)
    const want = planRescue(ids, (await readConfigs(conn, ids)).mint, TV2, parseCoreAsset((await conn.getAccountInfo(TV2)).data), TV, parseCoreAsset((await conn.getAccountInfo(TV)).data), ids.CORE.toBase58(), alice.publicKey)
    H.t('V39-2 nested: the redeem plan for the HOST does NOT refuse; its set-up step rescues TV2 (alone, optional) with exactly the vault page\'s live-host rescue',
      hp.refuse.length === 0 && !!g && g.length === 1 && g[0].ix.data.equals(want.ix.data) && JSON.stringify(g[0].ix.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable])) === JSON.stringify(want.ix.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable])))
    const sim = g ? await simOf([g[0].ix], alice.publicKey) : { err: 'no rescue planned', explained: 'no rescue planned' }
    H.t('V39-2 nested: that set-up rescue passes a dry run on the real programs', !sim.err, sim.explained || '')
  }
  const v2 = parseCoreAsset((await conn.getAccountInfo(TV2)).data)
  const hostInfo = parseCoreAsset((await conn.getAccountInfo(TV)).data)
  const r1 = planRescue(ids, cfg.mint, TV2, v2, TV, hostInfo, ids.CORE.toBase58(), stranger.publicKey)
  H.eq('rescue (inside a live vault): the destination is bank_treasury, never the host\'s owner', [r1.ok, r1.kind, r1.dest], [true, 'live-host', treasury.publicKey.toBase58()])
  await send([r1.ix], [stranger])
  H.eq('rescue (inside a live vault): TV2 is with bank_treasury', parseCoreAsset((await conn.getAccountInfo(TV2)).data).owner, treasury.publicKey.toBase58())
  // the multisig returns it to whoever sent it in
  const umiT = createUmi(RPC, { commitment: 'confirmed' }).use(mplCore()).use(keypairIdentity(createUmi(RPC).eddsa.createKeypairFromSecretKey(treasury.secretKey)))
  await transfer(umiT, { asset: { publicKey: pk(TV2.toBase58()), owner: pk(treasury.publicKey.toBase58()) }, collection: { publicKey: coll.publicKey },
    newOwner: pk(alice.publicKey.toBase58()) }).sendAndConfirm(umiT, { confirm: { commitment: 'confirmed' } })
  await coreTransfer(TV2, ids.depositAddress(TV2))
  const r2 = planRescue(ids, cfg.mint, TV2, parseCoreAsset((await conn.getAccountInfo(TV2)).data), null, null, null, stranger.publicKey)
  H.eq('rescue (its own wallet): the destination is MINT bank_treasury', [r2.ok, r2.kind, r2.dest], [true, 'self', cfg.mint.bank_treasury])
  await send([r2.ix], [stranger])
  H.eq('rescue (its own wallet): TV2 is now owned by bank_treasury', parseCoreAsset((await conn.getAccountInfo(TV2)).data).owner, cfg.mint.bank_treasury)
  {
    // a vault inside a FOREIGN Core NFT's wallet: the page refuses exactly where MINT does (HostUnresolved)
    const foreignColl = Keypair.generate(), foreignNft = Keypair.generate()
    const { createCollection, create } = await import('@metaplex-foundation/mpl-core')
    const { createSignerFromKeypair } = await import('@metaplex-foundation/umi')
    const fc = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(foreignColl.secretKey)), fa = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(foreignNft.secretKey))
    await createCollection(umi, { collection: fc, name: 'foreign', uri: 'local' }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
    await create(umi, { asset: fa, collection: { publicKey: fc.publicKey }, name: 'foreign', uri: 'local' }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
    // only the planner and a dry run: nothing of ours is moved into it
    const fake = { ...parseCoreAsset((await conn.getAccountInfo(TV)).data), owner: ids.depositAddress(foreignNft.publicKey).toBase58() }
    const f = planRescue(ids, cfg.mint, TV, fake, foreignNft.publicKey, parseCoreAsset((await conn.getAccountInfo(foreignNft.publicKey)).data), ids.CORE.toBase58(), stranger.publicKey)
    H.t('rescue: a foreign NFT as the holder is refused by the page', !f.ok)
  }

  // ═══ GATE 5: make TV an ACTIVE vault with a share owed, so its opening claims first ═══
  {
    const closes = OPENS + 120
    while (now() <= closes + 120 + 2) await sleep(1000)                         // the free monthly tick is due (monthly 120 s)
    const cfg0 = (await readConfigs(conn, ids)).mint
    const POOL = new PublicKey(cfg0.pool_ata)
    await spl.mintTo(conn, alice, CBBTC, POOL, mintAuth, 10_000n)                // revenue in the pool
    await send([IX.distribute(ids, POOL)], [stranger])                          // the free monthly tick with nobody joined: the epoch advances (sim S7.3)
    const j = planActivate(ids, (await readConfigs(conn, ids)).mint, TV, (await readVault(conn, ids, TV)).info, (await readVault(conn, ids, TV)).record, null)
    H.eq('gate 5: after a payout epoch, TV can JOIN (the vault page\'s second Activate)', [j.ok, j.step], [true, 'join'])
    await send([j.ix], [stranger])
    H.t('gate 5: TV is ACTIVE', (await readVault(conn, ids, TV)).record.active === true)
    await send([spl.createAssociatedTokenAccountIdempotentInstruction(alice.publicKey, ata(alice.publicKey, GARY), alice.publicKey, GARY)], [alice])
    await spl.mintTo(conn, alice, GARY, ata(alice.publicKey, GARY), mintAuth, 100_000_000_000n)
    const cfg1 = (await readConfigs(conn, ids)).mint
    const pp = planPayout(ids, { mintConfig: cfg1, waiting: [], dueRecords: [], burner: alice.publicKey, garyMint: GARY })
    H.eq('gate 5: "Run a payout" plans exactly a distribute (nothing due, nobody waiting)', [pp.ok, pp.groups.length], [true, 1])
    for (const g of pp.groups) await send(g, [alice])
    const rec = (await readVault(conn, ids, TV)).record
    H.t('gate 5: TV is now owed a share (credited, not yet delivered)', owedSats(rec, (await readConfigs(conn, ids)).mint) > 0n)
  }

  // ═══ GATE 5 item 3 (round 36 L2): a DUE $CBOB boost, cleared by the page's "Run a payout" ═══
  {
    const u64b = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }, u16b = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
    const i64b = n => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b }, u32b = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
    const K = (k, sg, w) => ({ pubkey: new PublicKey(k), isSigner: sg, isWritable: w })
    const gov = await anchorAccount(conn, 'GovConfig', ids.GOV_CFG, ids.GOV_PROG)
    const id = Number(gov.proposal_count) + 1
    const prop = PublicKey.findProgramAddressSync([Buffer.from('proposal'), u64b(id)], ids.GOV_PROG)[0]
    const BPRICE = 1_000_000n, ends = now() + 60 + 5
    // the sim's own shapes (sim/test-vault.ts S7b): a boost-terms proposal, one YES vote, execution
    await send([new TransactionInstruction({ programId: ids.GOV_PROG, data: Buffer.concat([disc('create_proposal'), u32b(1), Buffer.from([4]), u64b(BPRICE), Buffer.from([2]), u16b(1), i64b(ends)]),
      keys: [K(ids.GOV_CFG, false, true), K(prop, false, true), K(ids.MINT_CFG, false, false), K(ids.BURN_CFG, false, false), K(TV, false, false), K(alice.publicKey, true, true), K(SystemProgram.programId, false, false)] })], [alice])
    await send([new TransactionInstruction({ programId: ids.GOV_PROG, data: Buffer.concat([disc('cast_vote'), Buffer.from([1])]),
      keys: [K(ids.GOV_CFG, false, false), K(prop, false, true), K(PublicKey.findProgramAddressSync([Buffer.from('vote'), prop.toBuffer(), TV.toBuffer()], ids.GOV_PROG)[0], false, true),
        K(TV, false, false), K(ids.vaultRecord(TV), false, false), K(alice.publicKey, true, false), K(alice.publicKey, true, true), K(SystemProgram.programId, false, false)] })], [alice])
    while (now() <= ends + 1) await sleep(1000)
    await send([new TransactionInstruction({ programId: ids.GOV_PROG, data: disc('execute_proposal'),
      keys: [K(ids.GOV_CFG, false, true), K(prop, false, true), K(ids.MINT_CFG, false, true), K(ids.GOV_PDA, false, false), K(ids.MINT_PROG, false, false)] })], [stranger])
    H.eq('L2 e2e: the vote turned $CBOB boosts on', BigInt((await readConfigs(conn, ids)).mint.boost_price), BPRICE)
    await send([spl.createAssociatedTokenAccountIdempotentInstruction(alice.publicKey, ata(alice.publicKey, cbobMint), alice.publicKey, cbobMint)], [alice])
    await spl.mintTo(conn, deployer, cbobMint, ata(alice.publicKey, cbobMint), deployer, 10n * BPRICE)
    const POOL = new PublicKey((await readConfigs(conn, ids)).mint.pool_ata)
    await send([new TransactionInstruction({ programId: ids.MINT_PROG, data: Buffer.concat([disc('boost_vault'), u64b(BPRICE), Buffer.from([2]), u16b(1)]),
      keys: [K(ids.MINT_CFG, false, true), K(ids.vaultRecord(TV), false, true), K(TV, false, false), K(alice.publicKey, true, false), K(ata(alice.publicKey, cbobMint), false, true),
        K(cbobMint, false, true), K(spl.TOKEN_PROGRAM_ID, false, false), K(POOL, false, false)] })], [alice])
    // one distribution makes it DUE
    await spl.mintTo(conn, alice, CBBTC, POOL, mintAuth, 2_000n)
    await spl.mintTo(conn, alice, GARY, ata(alice.publicKey, GARY), mintAuth, 200_000_000_000n)
    for (const g of planPayout(ids, { mintConfig: (await readConfigs(conn, ids)).mint, waiting: [], dueRecords: [], burner: alice.publicKey, garyMint: GARY }).groups) await send(g, [alice])
    const c = (await readConfigs(conn, ids)).mint
    H.eq('L2 e2e: the boost is DUE after one distribution (boosts_due 1)', Number(c.boosts_due), 1)
    // the page's "Run a payout", exactly as it builds it
    await spl.mintTo(conn, alice, CBBTC, POOL, mintAuth, 3_000n)
    const due = await dueBoostRecords(conn, ids, c.dist_epoch)
    H.eq('L2 e2e: the page finds the one due boost (its vault record)', due, [ids.vaultRecord(TV).toBase58()])
    const pp = planPayout(ids, { mintConfig: c, waiting: [], dueRecords: due, burner: alice.publicKey, garyMint: GARY })
    H.eq('L2 e2e: the plan expires it FIRST, then distributes', pp.groups.map(g => g[0].data.subarray(0, 8).toString('hex')),
      [disc('expire_boosts').toString('hex'), disc('distribute').toString('hex')])
    const plainDistribute = await simOf([IX.distribute(ids, POOL, alice.publicKey, GARY)], alice.publicKey)
    H.t('L2 e2e: CONTROL: a distribute WITHOUT the expiry is refused (BoostsExpireFirst)', !!plainDistribute.err && /BoostsExpireFirst/.test(plainDistribute.explained || ''), plainDistribute.explained)
    for (const g of pp.groups) { const sim = await simOf(g, alice.publicKey); H.t('L2 e2e: each payout step passes its dry run', !sim.err, sim.explained || ''); await send(g, [alice]) }
    H.eq('L2 e2e: the payout LANDED: nothing due any more', Number((await readConfigs(conn, ids)).mint.boosts_due), 0)
  }

  // ═══ GATE 5 item 4 (W2): a MONTH DUE at the opening, so the claim runs the month in-line first ═══
  {
    const c = (await readConfigs(conn, ids)).mint
    await spl.mintTo(conn, alice, CBBTC, new PublicKey(c.pool_ata), mintAuth, 5_000n)
    const dueAt = Number(c.last_distribute_at) + Number(c.monthly_secs) + 2
    while ((await chainNow(conn)) < dueAt) await sleep(1000)
  }

  // ═══ REDEEM TV with a stray, a C5 account and a FREEZABLE stray (round 36 H1) ═══
  const m1 = await spl.createMint(conn, stranger, stranger.publicKey, null, 0)
  await send([spl.createAssociatedTokenAccountIdempotentInstruction(stranger.publicKey, ata(pdaTV, m1), pdaTV, m1)], [stranger])
  await spl.mintTo(conn, stranger, m1, ata(pdaTV, m1), stranger, 5n)
  const m2 = await spl.createMint(conn, stranger, stranger.publicKey, null, 0)
  const c5 = Keypair.generate()
  await spl.createAccount(conn, stranger, m2, stranger.publicKey, c5)
  await spl.mintTo(conn, stranger, m2, c5.publicKey, stranger, 1n)
  await send([spl.createSetAuthorityInstruction(c5.publicKey, stranger.publicKey, spl.AuthorityType.CloseAccount, stranger.publicKey),
    spl.createSetAuthorityInstruction(c5.publicKey, stranger.publicKey, spl.AuthorityType.AccountOwner, pdaTV)], [stranger])
  // round 36 H1: a stray of a mint the stranger can freeze, and the stranger freezes alice's own account for it
  const m3 = await spl.createMint(conn, stranger, stranger.publicKey, stranger.publicKey, 0)
  await send([spl.createAssociatedTokenAccountIdempotentInstruction(stranger.publicKey, ata(pdaTV, m3), pdaTV, m3),
    spl.createAssociatedTokenAccountIdempotentInstruction(stranger.publicKey, ata(alice.publicKey, m3), alice.publicKey, m3)], [stranger])
  await spl.mintTo(conn, stranger, m3, ata(pdaTV, m3), stranger, 1n)
  await send([spl.createFreezeAccountInstruction(ata(alice.publicKey, m3), m3, stranger.publicKey)], [stranger])
  const c5t = parseTokenAccount((await conn.getAccountInfo(c5.publicKey)).data)
  H.eq('C5 fixture: owned by the vault, close authority the stranger, 1 token', [c5t.owner, c5t.closeAuthority, c5t.amount], [pdaTV.toBase58(), stranger.publicKey.toBase58(), 1n])
  let snap = await readRedemptionSnapshot(P, conn, ids, alice.publicKey, TV)
  let plan = planRedemption(ids, snap)
  H.eq('redeem plan: nothing refused; only the freezable stray is left behind, named (round 36 H1)', [plan.refuse, plan.ack.map(a => a.id)], [[], [`lost:${ata(pdaTV, m3).toBase58()}`]])
  H.eq('redeem plan: the stray goes through the helper, the C5 balance by a transfer', [plan.helperStrays, plan.transferStrays], [[ata(pdaTV, m1).toBase58()], [c5.publicKey.toBase58()]])
  for (const group of plan.prior) await send(group.map(x => x.ix), [alice])
  snap = await readRedemptionSnapshot(P, conn, ids, alice.publicKey, TV)
  plan = planRedemption(ids, snap)
  H.eq('after the prior transaction: no more prior, nothing refused', [plan.prior.length, plan.refuse], [0, []])
  // ROUND 39 V39-2, gate 5: a stranger holding a CBOB vault (here the multisig's key holds TV2) sends it into TV's
  // deposit address just before the press. The press does not stop; the vault is rescued after the opening.
  await transfer(umiT, { asset: { publicKey: pk(TV2.toBase58()), owner: pk(treasury.publicKey.toBase58()) }, collection: { publicKey: coll.publicKey },
    newOwner: pk(pdaTV.toBase58()) }).sendAndConfirm(umiT, { confirm: { commitment: 'confirmed' } })
  {
    const known3 = new Set([...plan.helperStrays, ...plan.transferStrays]), consented3 = new Set([...plan.ack.map(a => a.id), LATE_CONSENT_ID])
    const s3 = await readRedemptionSnapshot(P, conn, ids, alice.publicKey, TV, [...known3])
    Object.assign(s3, { noPrior: true, known: known3, consented: consented3 })
    const p3 = planRedemption(ids, s3)
    H.t('V39-2 e2e: a CBOB vault sent in just before the press: no refusal, no set-up, no new box, and the page says it can be rescued afterwards',
      p3.refuse.length === 0 && p3.prior.length === 0 && p3.ack.every(a => consented3.has(a.id)) && p3.pressInfo.some(t => t.includes(TV2.toBase58())))
    plan = p3
  }
  H.t('the redemption fits', plan.size <= PACKET_LIMIT, String(plan.size))
  H.t('gate 5: the opening of an ACTIVE vault CLAIMS FIRST (MINT claim, then SEAL open)', plan.claim && plan.redemption[0].programId.equals(ids.MINT_PROG) && plan.redemption[1].programId.equals(ids.SEAL_PROG))
  const owedNow = plan.owedSats
  const before = {}; for (const m of [CBBTC, GARY, GIRAFFISH, m1, m2]) before[m] = await bal(ata(alice.publicKey, m))
  await spl.mintTo(conn, alice, CBBTC, ata(pdaTV, CBBTC), mintAuth, 1n)       // the race: 1 sat lands AFTER the plan
  const sim = await simOf(plan.redemption, alice.publicKey)
  H.t('redeem: the dry run passes', !sim.err, sim.explained || '')
  const cfgB = (await readConfigs(conn, ids)).mint, poolB = await bal(cfgB.pool_ata)
  const { size, sig: redSig } = await send(plan.redemption, [alice])
  H.eq('redeem: the landed transaction is the planned size', size, plan.size)
  const gone = await conn.getAccountInfo(TV)
  H.t('redeem: the vault is burned (Core, 1 byte, key 0)', !!gone && gone.data.length === 1 && gone.data[0] === 0)
  // The claim can also run a due month IN-LINE (W2 below), so the share delivered
  // is whatever left the pool, not the share owed when the page planned it.
  const paidFromPool = poolB - await bal(cfgB.pool_ata)
  H.eq('redeem: alice received 50,001 sats plus exactly what the pool paid her, all $GARY and $GIRAFFISH, the stray 5 and the C5 1',
    [await bal(ata(alice.publicKey, CBBTC)) - before[CBBTC], await bal(ata(alice.publicKey, GARY)) - before[GARY], await bal(ata(alice.publicKey, GIRAFFISH)) - before[GIRAFFISH],
      await bal(ata(alice.publicKey, m1)) - before[m1], await bal(ata(alice.publicKey, m2)) - before[m2]], [50_001n + paidFromPool, 7_000_000_000n, 9_000_000n, 5n, 1n])
  H.t('gate 5: the claim paid something (the share was not zero)', owedNow > 0n)
  H.eq('round 36 H1: the frozen-destination stray did NOT block the opening, and stays (lost) at the vault wallet', await bal(ata(pdaTV, m3)), 1n)
  H.eq('redeem: the reserve accounts and the stray are closed; the C5 account remains, empty', [await conn.getAccountInfo(ata(pdaTV, CBBTC)), await conn.getAccountInfo(ata(pdaTV, m1)),
    parseTokenAccount((await conn.getAccountInfo(c5.publicKey)).data).amount], [null, null, 0n])
  H.eq('redeem: the vault wallet holds no SOL', (await account(conn, pdaTV))?.lamports ?? 0, 0)
  H.t('redeem: the record is retired', (await readVault(conn, ids, TV)).record.retired === true)
  {
    // gate 5 item 4 (W2): the claim-first opening of an ACTIVE vault with a month due
    const logs = (await conn.getTransaction(redSig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }))?.meta?.logMessages || []
    const cfgA = (await readConfigs(conn, ids)).mint, poolA = await bal(cfgA.pool_ata)
    const delivered = (await bal(ata(alice.publicKey, CBBTC))) - before[CBBTC] - 50_001n
    console.log(`  gate 5: delivered share ${delivered} sats (planned at least ${owedNow}); pool ${poolB} -> ${poolA}; owed_scaled ${cfgB.owed_scaled} -> ${cfgA.owed_scaled}`)
    H.t('W2: the month ran IN-LINE inside the claim (a distribution in the redemption\'s logs)', logs.some(l => /CBOB_DISTRIBUTED/.test(l)), logs.filter(l => /CBOB_/.test(l)).join(' | '))
    H.t('W2: retire_redeemed did NOT refuse (no ClaimBeforeBurn), and the opening is logged', !logs.some(l => /ClaimBeforeBurn|failed/.test(l)) && logs.some(l => /CBOB_REDEEMED /.test(l)))
    H.t('W2: the share delivered is at least what was owed at the plan (the month added to it)', delivered >= owedNow && delivered > 0n, String(delivered))
    H.eq('W2: the pool fell by EXACTLY the delivered share', poolB - poolA, delivered)
    H.eq('W2: with the only active vault gone, nothing is owed any more (owed fell by exactly its whole share)', BigInt(cfgA.owed_scaled), 0n)
  }

  {
    // ROUND 39 V39-2: the vault left inside the burned host is rescued afterwards (item 58)
    const rb = planRescue(ids, cfg.mint, TV2, parseCoreAsset((await conn.getAccountInfo(TV2)).data), TV, parseCoreAsset((await conn.getAccountInfo(TV)).data), ids.CORE.toBase58(), stranger.publicKey)
    H.eq('V39-2 e2e: after the opening, the vault left inside is rescued from the BURNED host', [rb.ok, rb.kind, rb.dest], [true, 'burned-host', cfg.mint.bank_treasury])
    await send([rb.ix], [stranger])
    H.eq('V39-2 e2e: ...and TV2 is with bank_treasury again, its record untouched', [parseCoreAsset((await conn.getAccountInfo(TV2)).data).owner, (await readVault(conn, ids, TV2)).record.retired], [cfg.mint.bank_treasury, false])
  }

  // ═══ GATE 5 item 6 (W5): the most C5 transfers that fit, measured ═══
  {
    await transfer(umiT, { asset: { publicKey: pk(TV2.toBase58()), owner: pk(treasury.publicKey.toBase58()) }, collection: { publicKey: coll.publicKey },
      newOwner: pk(alice.publicKey.toBase58()) }).sendAndConfirm(umiT, { confirm: { commitment: 'confirmed' } })
    const pda2 = ids.depositAddress(TV2), c5s = []
    for (let i = 0; i < 4; i++) {
      const m = await spl.createMint(conn, stranger, stranger.publicKey, null, 0), k = Keypair.generate()
      await spl.createAccount(conn, stranger, m, stranger.publicKey, k)
      await spl.mintTo(conn, stranger, m, k.publicKey, stranger, 1n)
      await send([spl.createSetAuthorityInstruction(k.publicKey, stranger.publicKey, spl.AuthorityType.CloseAccount, stranger.publicKey),
        spl.createSetAuthorityInstruction(k.publicKey, stranger.publicKey, spl.AuthorityType.AccountOwner, pda2)], [stranger])
      c5s.push(k.publicKey.toBase58())
    }
    // ROUND 37 V1, gate 5: a stranger parks a few hundred accounts at the deposit address:
    // 200 empty classic ones and 120 holding one unit of a mint the stranger can freeze
    const EMPTY = 200, FREEZABLE = 120, mF = await spl.createMint(conn, stranger, stranger.publicKey, stranger.publicKey, 0)
    const rent = await spl.getMinimumBalanceForRentExemptAccount(conn), parked = []
    for (let i = 0; i < EMPTY + FREEZABLE; i += 4) {
      const ks = Array.from({ length: Math.min(4, EMPTY + FREEZABLE - i) }, () => Keypair.generate())
      await send(ks.flatMap((k, j) => [SystemProgram.createAccount({ fromPubkey: stranger.publicKey, newAccountPubkey: k.publicKey, lamports: rent, space: spl.ACCOUNT_SIZE, programId: spl.TOKEN_PROGRAM_ID }),
        spl.createInitializeAccount3Instruction(k.publicKey, mF, pda2), ...(i + j >= EMPTY ? [spl.createMintToInstruction(mF, k.publicKey, stranger.publicKey, 1n)] : [])]), [stranger, ...ks])
      parked.push(...ks.map(k => k.publicKey))
    }
    {
      const s0 = await readRedemptionSnapshot(P, conn, ids, alice.publicKey, TV2), p0 = planRedemption(ids, s0)
      const groups = p0.ack.filter(a => a.id.startsWith('group:'))
      H.eq(`V1 e2e: ${EMPTY + FREEZABLE} parked accounts: the listing is complete, nothing refused, ONE grouped box naming the ${FREEZABLE} freezable strays (and anything that does not fit)`,
        [s0.strayReadIncomplete, p0.refuse, groups.length, p0.ack.filter(a => /^(lost|left):/.test(a.id)).length, Number(groups[0]?.id.split(':')[1]) >= FREEZABLE],
        [null, [], 1, 0, true])
    }
    // ROUND 40 V40-1, gate 5: a stranger's lamports at the vault's missing $GIRAFFISH account address and at the
    // holder's missing account address for a stray's mint, before the check
    // ROUND 39 W2 (carried, gate 5): a stranger DELEGATES a classic stray, then hands it to the vault with
    // SetAuthority(AccountOwner). SPL Token clears the delegate on an owner change, so the page sees a plain
    // stray and moves it; the opening lands and the holder receives it.
    const dMint = await spl.createMint(conn, stranger, stranger.publicKey, null, 0), dAcct = Keypair.generate(), dHelper = Keypair.generate()
    await spl.createAccount(conn, stranger, dMint, stranger.publicKey, dAcct)
    await spl.mintTo(conn, stranger, dMint, dAcct.publicKey, stranger, 4n)
    await send([spl.createApproveInstruction(dAcct.publicKey, dHelper.publicKey, stranger.publicKey, 4n)], [stranger])
    H.eq('W2 e2e setup: the stray carries a delegate for all 4 before the handover', [parseTokenAccount((await conn.getAccountInfo(dAcct.publicKey)).data).delegate, parseTokenAccount((await conn.getAccountInfo(dAcct.publicKey)).data).delegatedAmount], [dHelper.publicKey.toBase58(), 4n])
    await send([spl.createSetAuthorityInstruction(dAcct.publicKey, stranger.publicKey, spl.AuthorityType.AccountOwner, pda2)], [stranger])
    { const t = parseTokenAccount((await conn.getAccountInfo(dAcct.publicKey)).data)
      H.eq('W2 e2e: after SetAuthority(AccountOwner) the vault owns it and the delegate is CLEARED', [t.owner, t.delegate, t.delegatedAmount, t.amount], [pda2.toBase58(), null, 0n, 4n]) }
    // (b) is the holder's missing account for a stray the opening DOES deliver: the once-delegated classic
    // stray above is a helper stray (no close authority kept), which the packet keeps before any C5 transfer.
    // (The first run dusted the holder's account for a C5 mint, whose balance the packet left behind, so
    // correctly no create was planned for it.)
    const dusted = [ata(pda2, GIRAFFISH), ata(alice.publicKey, dMint)]
    for (const d of dusted) if (!(await conn.getAccountInfo(d))) await send([SystemProgram.transfer({ fromPubkey: stranger.publicKey, toPubkey: d, lamports: 890_880 })], [stranger])
    H.t('V40-1 e2e: both addresses hold a stranger\'s lamports (System-owned, 0 bytes)', (await Promise.all(dusted.map(d => conn.getAccountInfo(d)))).every(a => a && a.owner.equals(SystemProgram.programId) && a.data.length === 0))
    let p2 = planRedemption(ids, await readRedemptionSnapshot(P, conn, ids, alice.publicKey, TV2))
    { const noCreate = dusted.filter(d => !p2.prior.flat().some(x => x.ix.keys[1].pubkey.equals(d))).map(String)
      H.t('V40-1 e2e: the check does not refuse, delivers the stray, and its set-up creates BOTH dusted accounts', p2.refuse.length === 0 && noCreate.length === 0 && p2.helperStrays.includes(dAcct.publicKey.toBase58()),
        `refuse ${JSON.stringify(p2.refuse)}; no create for [${noCreate.join(', ')}]; helperStrays has the stray: ${p2.helperStrays.includes(dAcct.publicKey.toBase58())}`) }
    for (const g of p2.prior) await send(g.map(x => x.ix), [alice])
    { const after = await Promise.all(dusted.map(d => conn.getAccountInfo(d)))
      const notToken = dusted.filter((d, i) => !(after[i] && after[i].owner.equals(spl.TOKEN_PROGRAM_ID) && after[i].data.length === 165)).map(String)
      H.t('V40-1 e2e: the set-up LANDED on both dusted addresses: each is now a token account', notToken.length === 0, `not a token account: [${notToken.join(', ')}]`) }
    p2 = planRedemption(ids, await readRedemptionSnapshot(P, conn, ids, alice.publicKey, TV2))
    while (true) { const s2 = await readRedemptionSnapshot(P, conn, ids, alice.publicKey, TV2); if (rateLimit(s2.burnConfig, s2.mintConfig, s2.nowSec).allowed) break; await sleep(1000) }
    p2 = planRedemption(ids, await readRedemptionSnapshot(P, conn, ids, alice.publicKey, TV2))
    H.t('W5: the plan moves as many C5 balances as fit and names the rest', p2.transferStrays.length >= 1 && p2.transferStrays.length + p2.left.length === 4 && p2.refuse.length === 0)
    // ROUND 38 V38-2, gate 5: the holder ticks once (the boxes + the standing consent), then presses
    // three times; before EVERY re-plan a stranger lands a freezable stray AND a fresh-mint account
    // handed in with the close authority kept (the V38-1 shape). The last press sends.
    {
      const known2 = new Set([...p2.helperStrays, ...p2.transferStrays]), consented2 = new Set([...p2.ack.map(a => a.id), LATE_CONSENT_ID]), lateLanded = []
      const land = async () => {
        const k = Keypair.generate()
        await send([SystemProgram.createAccount({ fromPubkey: stranger.publicKey, newAccountPubkey: k.publicKey, lamports: rent, space: spl.ACCOUNT_SIZE, programId: spl.TOKEN_PROGRAM_ID }),
          spl.createInitializeAccount3Instruction(k.publicKey, mF, pda2), spl.createMintToInstruction(mF, k.publicKey, stranger.publicKey, 1n)], [stranger, k])
        const mx = await spl.createMint(conn, stranger, stranger.publicKey, null, 0), c = Keypair.generate()
        await spl.createAccount(conn, stranger, mx, stranger.publicKey, c)
        await spl.mintTo(conn, stranger, mx, c.publicKey, stranger, 3n)
        await send([spl.createSetAuthorityInstruction(c.publicKey, stranger.publicKey, spl.AuthorityType.CloseAccount, stranger.publicKey),
          spl.createSetAuthorityInstruction(c.publicKey, stranger.publicKey, spl.AuthorityType.AccountOwner, pda2)], [stranger])
        lateLanded.push(k.publicKey, c.publicKey)
      }
      let r2 = null
      // ROUND 39 V39-1, gate 5: before the first press, 112 MORE balance-holding junk accounts (so the listing holds
      // over 200 and a promised account can fall outside what it reads in full); on the second press the listing FAILS
      for (let i = 0; i < 112; i += 4) {
        const ks = Array.from({ length: 4 }, () => Keypair.generate())
        await send(ks.flatMap(k => [SystemProgram.createAccount({ fromPubkey: stranger.publicKey, newAccountPubkey: k.publicKey, lamports: rent, space: spl.ACCOUNT_SIZE, programId: spl.TOKEN_PROGRAM_ID }),
          spl.createInitializeAccount3Instruction(k.publicKey, mF, pda2), spl.createMintToInstruction(mF, k.publicKey, stranger.publicKey, 1n)]), [stranger, ...ks])
      }
      const listingDown = new Proxy(conn, { get: (t, k) => k === 'getProgramAccounts' ? async () => { throw new Error('listing down (gate 5)') } : (typeof t[k] === 'function' ? t[k].bind(t) : t[k]) })
      for (let press = 1; press <= 3; press++) {
        r2 = await prepareOpening({ consented: consented2,
          replan: async ({ dropStrays }) => { await land(); const s2 = await readRedemptionSnapshot(P, press === 2 ? listingDown : conn, ids, alice.publicKey, TV2, [...known2])
            Object.assign(s2, { noPrior: true, dropStrays, known: known2, consented: consented2 }); return planRedemption(ids, s2) },
          dryRun: async p => simOf(p.redemption, alice.publicKey) })
        H.t(`V38-2 e2e press ${press}: new things landed before the re-plan, and the opening is still built, dry-run clean, with no new box`, r2.ok && r2.plan.refuse.length === 0 && (press === 2 || r2.plan.late.length >= 1), String(r2.stop || ''))
        H.eq(`V39-1 e2e press ${press}${press === 2 ? ' (the listing FAILED)' : ''}: every promised C5 balance is still moved (re-read by address), none dropped`, r2.plan.transferStrays.slice().sort(), [...p2.transferStrays].sort())
      }
      // The PROPERTY, not a count: each press lands two items and a press can
      // re-plan more than once, so how many are late varies (measured 5, not 3).
      // A stray already NAMED as left behind at the check (it did not fit then) can
      // fit at the final re-plan; it is held back too, as the holder agreed. So a
      // late item is one the stranger landed OR one the holder already saw left.
      const landedSet = new Set([...lateLanded.map(String), ...p2.left.map(a => String(a.address ?? a))]), delivered = new Set([...r2.plan.helperStrays, ...r2.plan.transferStrays].map(x => String(x.address ?? x)))
      const lateIds = r2.plan.late.map(x => String(x.address ?? x.account ?? x))
      H.eq('V38-2 e2e: the late arrivals are left behind, never delivered; the strays the holder saw are still moved',
        [lateIds.length >= 3, lateIds.every(a => landedSet.has(a)), lateLanded.some(a => delivered.has(String(a))), r2.plan.transferStrays.slice().sort()],
        [true, true, false, [...p2.transferStrays].sort()])
      p2 = r2.plan
      var lateAtOpen = lateLanded
    }
    const { sig: s2sig, size: s2size } = await send(p2.redemption, [alice])
    const meta = (await conn.getTransaction(s2sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }))?.meta
    const nIx = p2.redemption.length, cu = meta?.computeUnitsConsumed ?? -1
    console.log(`  W5: a redemption carrying ${p2.transferStrays.length} C5 transfers: ${s2size} bytes, ${cu} compute units, ${nIx} instructions (default budget ${Math.min(1_400_000, 200_000 * nIx)})`)
    H.t(`W5: ${p2.transferStrays.length} C5 transfers: under 1,232 bytes and inside the default compute budget`, s2size <= 1232 && cu > 0 && cu < Math.min(1_400_000, 200_000 * nIx), `${s2size} B, ${cu} CU`)
    H.t('W5: ...and it opened the vault', (await conn.getAccountInfo(TV2)).data.length === 1)
    H.eq('W2 e2e: the once-delegated stray was MOVED to the holder by the opening (4 units), not left or lost', [p2.helperStrays.includes(dAcct.publicKey.toBase58()) || p2.transferStrays.includes(dAcct.publicKey.toBase58()), await bal(ata(alice.publicKey, dMint))], [true, 4n])
    H.t(`W1: the largest redemption landed with NO compute-budget instruction (${cu} CU recorded)`,
      !p2.redemption.some(ix => ix.programId.toBase58() === 'ComputeBudget111111111111111111111111111111') && cu > 0 && !meta.err, String(cu))
    H.t('V38-2 e2e: the opening LANDED despite a stranger landing things before every press, and everything they landed stays at the vault wallet',
      (await conn.getAccountInfo(TV2)).data.length === 1 && (await Promise.all(lateAtOpen.map(k => bal(k)))).every(b => b > 0n))
    H.eq('V1 e2e: the parked accounts did not stop the opening; the freezable strays stay behind (lost), the empty ones untouched',
      [(await Promise.all(parked.slice(EMPTY).map(k => bal(k)))).every(b => b === 1n), (await Promise.all(parked.slice(0, EMPTY).map(k => bal(k)))).every(b => b === 0n)], [true, true])
  }
}

/** What the claim page reads, read the claim page's way. */
async function claimSnapshot(ids) {
  const [cfg, nowSec, pobs, pc] = await Promise.all([readConfigs(conn, ids), chainNow(conn), readPobs(conn, accounts, ids, SET, parseCoreAsset), account(conn, SET.collection)])
  return { mintConfig: cfg.mint, nowSec, owner: alice.publicKey.toBase58(), pobSet: SET, pobs, pobCollection: pc ? parseCoreCollection(pc.data) : null }
}

main().then(() => { const r = H.done(); process.exit(r.ok === r.total ? 0 : 1) }, e => { console.error(e); H.done(); process.exit(1) })
