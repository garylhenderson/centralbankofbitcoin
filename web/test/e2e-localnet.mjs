/**
 * END TO END on a LOCAL validator (NOT run by `web/test/run-all.mjs`; run it with
 * web/test/e2e-localnet.sh, which prepares the validator the way sim/run-sim.sh
 * does: real Core, the three real reserve mints and two real Proof of Burn assets
 * cloned from mainnet, and the LOCALNET build of the five programs).
 *
 * It drives the pages' OWN library code, with keypairs in place of Phantom:
 *   CEREMONY  the collection; every program probed (and hashed against the
 *             build it deployed); road step 10 step by step exactly as the page
 *             runs it (readStep -> build -> simulate -> send -> readStep must be
 *             []); then run again to prove it resumes as "all done".
 *   VAULT     two charter vaults claimed with real Proofs of Burn and revealed;
 *             the vault page's reads; Activate from planActivate.
 *   RESCUE    a vault nested in another vault's deposit address (the redeem plan
 *             must refuse the host and point at the rescue; the rescue returns it
 *             to the host's owner), then the same vault in its OWN deposit address
 *             (the rescue sends it to bank_treasury).
 *   REDEEM    a vault holding all three reserves, a stray classic token and a
 *             round 35 C5 account whose close authority a stranger kept; the
 *             prior transaction; the opening, with a stranger's 1-sat deposit
 *             landing AFTER the plan; every balance checked afterwards.
 *
 *   CBOB_E2E_RPC=http://127.0.0.1:8999 node web/test/e2e-localnet.mjs
 */
import fs from 'fs'
import { Connection, Keypair, PublicKey, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import * as spl from '@solana/spl-token'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { keypairIdentity, publicKey as pk } from '@metaplex-foundation/umi'
import { mplCore, transfer } from '@metaplex-foundation/mpl-core'
import { PROFILES, SITE } from '../src/config.js'
import { makeIds, ata } from '../src/lib/ids.mjs'
import * as IX from '../src/lib/ix.mjs'
import { sha256Hex } from '../src/lib/enc.mjs'
import { STEPS, valuesFrom, judgeRehearsal, judgeProbe, judgeProgramBytes, launchWithCollection } from '../src/lib/plan-ceremony.mjs'
import { readStep, resolveCollection, withCollection } from '../src/lib/ceremony-reads.mjs'
import { readRedemptionSnapshot, readConfigs, readVault, tokenAccountsOf, coreAssetsOwnedBy, account, accounts, chainNow, collectionsOfMint } from '../src/lib/reads.mjs'
import { planRedemption, PACKET_LIMIT } from '../src/lib/plan-redeem.mjs'
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
  set('bank_treasury', treasury.publicKey.toBase58()); set('cbob_mint', cbobMint.toBase58()); set('charter_opens_at', OPENS); set('charter_secs', 600); set('lock_deadline', OPENS - 30)
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
  H.eq('resume: nothing exists yet, so step 0 is next', await resolveCollection(conn, P0, base, { discovered: await collectionsOfMint(conn, base) }), { collection: null, conflict: null, source: '' })
  for (const s of STEPS) {
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
  H.eq('M2: the chain scan finds exactly the one collection step 0 made', await collectionsOfMint(conn, base), [ctx.ids.COLL.toBase58()])
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
    const kp = Keypair.generate()
    const plan = planClaim(ids, SITE, await claimSnapshot(ids), kp.publicKey, p.address)
    H.eq(`claim page: Proof of Burn #${p.edition} is held and claimable`, [plan.ok, plan.refuse], [true, []])
    const sim = await simOf([plan.ix], alice.publicKey)
    H.t(`claim page: the dry run passes (${sim.unitsConsumed} CU, no crank, no compute-budget instruction)`, !sim.err, sim.explained || '')
    await send([plan.ix], [alice, kp])
    const a = parseCoreAsset((await conn.getAccountInfo(kp.publicKey)).data)
    H.eq('claim page: the vault is named "CBOB Vault" with its metadata at /v/<asset>.json, owned by the claimer',
      [a.name, a.uri, a.owner], ['CBOB Vault', `https://centralbankofbitcoin.com/v/${kp.publicKey.toBase58()}.json`, alice.publicKey.toBase58()])
    H.t(`claim page: Proof of Burn #${p.edition} is burned`, (await conn.getAccountInfo(new PublicKey(p.address))).data.length === 1)
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
  H.eq('vault page: the deposit address holds the three reserves', (await tokenAccountsOf(conn, pdaTV)).filter(t => t.parsed?.amount > 0n).length, 3)
  const act = planActivate(ids, cfg.mint, TV, tv.info, tv.record, parseTokenAccount((await conn.getAccountInfo(ata(pdaTV, CBBTC))).data))
  H.eq('activate: eligible at 50,000 sats', [act.ok, act.step], [true, 'request'])
  await send([act.ix], [stranger])
  H.t('activate: the record is now pending', (await readVault(conn, ids, TV)).record.pending === true)

  // ═══ RESCUE: nested in TV, then in its own deposit address ═══
  const coreTransfer = async (asset, to) => transfer(umi, { asset: { publicKey: pk(asset.toBase58()), owner: pk(alice.publicKey.toBase58()) },
    collection: { publicKey: coll.publicKey }, newOwner: pk(to.toBase58()) }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
  await coreTransfer(TV2, pdaTV)
  const nested = await coreAssetsOwnedBy(P, conn, ids, pdaTV)
  H.eq('nested: the read sees TV2 inside TV, as one of OUR vaults', nested.assets.map(a => [a.address, a.ourVault]), [[TV2.toBase58(), true]])
  {
    const snap = await readRedemptionSnapshot(P, conn, ids, alice.publicKey, TV)
    H.t('nested: the redeem plan for the HOST refuses and points at the rescue', planRedemption(ids, snap).refuse.some(r => /Rescue it first/.test(r)))
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

  // ═══ REDEEM TV with a stray and a C5 account ═══
  const m1 = await spl.createMint(conn, stranger, stranger.publicKey, null, 0)
  await send([spl.createAssociatedTokenAccountIdempotentInstruction(stranger.publicKey, ata(pdaTV, m1), pdaTV, m1)], [stranger])
  await spl.mintTo(conn, stranger, m1, ata(pdaTV, m1), stranger, 5n)
  const m2 = await spl.createMint(conn, stranger, stranger.publicKey, null, 0)
  const c5 = Keypair.generate()
  await spl.createAccount(conn, stranger, m2, stranger.publicKey, c5)
  await spl.mintTo(conn, stranger, m2, c5.publicKey, stranger, 1n)
  await send([spl.createSetAuthorityInstruction(c5.publicKey, stranger.publicKey, spl.AuthorityType.CloseAccount, stranger.publicKey),
    spl.createSetAuthorityInstruction(c5.publicKey, stranger.publicKey, spl.AuthorityType.AccountOwner, pdaTV)], [stranger])
  const c5t = parseTokenAccount((await conn.getAccountInfo(c5.publicKey)).data)
  H.eq('C5 fixture: owned by the vault, close authority the stranger, 1 token', [c5t.owner, c5t.closeAuthority, c5t.amount], [pdaTV.toBase58(), stranger.publicKey.toBase58(), 1n])
  let snap = await readRedemptionSnapshot(P, conn, ids, alice.publicKey, TV)
  let plan = planRedemption(ids, snap)
  H.eq('redeem plan: nothing refused or to acknowledge', [plan.refuse, plan.ack.map(a => a.id)], [[], []])
  H.eq('redeem plan: the stray goes through the helper, the C5 balance by a transfer', [plan.helperStrays, plan.transferStrays], [[ata(pdaTV, m1).toBase58()], [c5.publicKey.toBase58()]])
  for (const group of plan.prior) await send(group.map(x => x.ix), [alice])
  snap = await readRedemptionSnapshot(P, conn, ids, alice.publicKey, TV)
  plan = planRedemption(ids, snap)
  H.eq('after the prior transaction: no more prior, nothing refused', [plan.prior.length, plan.refuse], [0, []])
  H.t('the redemption fits', plan.size <= PACKET_LIMIT, String(plan.size))
  const before = {}; for (const m of [CBBTC, GARY, GIRAFFISH, m1, m2]) before[m] = await bal(ata(alice.publicKey, m))
  await spl.mintTo(conn, alice, CBBTC, ata(pdaTV, CBBTC), mintAuth, 1n)       // the race: 1 sat lands AFTER the plan
  const sim = await simOf(plan.redemption, alice.publicKey)
  H.t('redeem: the dry run passes', !sim.err, sim.explained || '')
  const { size } = await send(plan.redemption, [alice])
  H.eq('redeem: the landed transaction is the planned size', size, plan.size)
  const gone = await conn.getAccountInfo(TV)
  H.t('redeem: the vault is burned (Core, 1 byte, key 0)', !!gone && gone.data.length === 1 && gone.data[0] === 0)
  H.eq('redeem: alice received 50,001 sats (the race sat included), all $GARY and $GIRAFFISH, the stray 5 and the C5 1',
    [await bal(ata(alice.publicKey, CBBTC)) - before[CBBTC], await bal(ata(alice.publicKey, GARY)) - before[GARY], await bal(ata(alice.publicKey, GIRAFFISH)) - before[GIRAFFISH],
      await bal(ata(alice.publicKey, m1)) - before[m1], await bal(ata(alice.publicKey, m2)) - before[m2]], [50_001n, 7_000_000_000n, 9_000_000n, 5n, 1n])
  H.eq('redeem: the reserve accounts and the stray are closed; the C5 account remains, empty', [await conn.getAccountInfo(ata(pdaTV, CBBTC)), await conn.getAccountInfo(ata(pdaTV, m1)),
    parseTokenAccount((await conn.getAccountInfo(c5.publicKey)).data).amount], [null, null, 0n])
  H.eq('redeem: the vault wallet holds no SOL', (await account(conn, pdaTV))?.lamports ?? 0, 0)
  H.t('redeem: the record is retired', (await readVault(conn, ids, TV)).record.retired === true)
}

/** What the claim page reads, read the claim page's way. */
async function claimSnapshot(ids) {
  const [cfg, nowSec, pobs, pc] = await Promise.all([readConfigs(conn, ids), chainNow(conn), readPobs(conn, accounts, ids, SET, parseCoreAsset), account(conn, SET.collection)])
  return { mintConfig: cfg.mint, nowSec, owner: alice.publicKey.toBase58(), pobSet: SET, pobs, pobCollection: pc ? parseCoreCollection(pc.data) : null }
}

main().then(() => { const r = H.done(); process.exit(r.ok === r.total ? 0 : 1) }, e => { console.error(e); H.done(); process.exit(1) })
