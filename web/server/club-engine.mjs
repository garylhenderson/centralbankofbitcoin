/** Gary Club server adapter. Plans are the same pure planners used by holder pages.
 * No arbitrary transaction signing entrypoint. Inputs select a named Bank action.
 */
import { Keypair, PublicKey, Transaction, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import { createHash } from 'node:crypto'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { createNoopSigner, publicKey as umiKey } from '@metaplex-foundation/umi'
import { transferV1 } from '@metaplex-foundation/mpl-core'
import { PROFILES, SITE } from '../src/config.js'
import { makeIds, ata, TOKEN_PROGRAM } from '../src/lib/ids.mjs'
import { accounts, account, readConfigs, readBuySnapshot, chainNow, readVault, readRedemptionSnapshot } from '../src/lib/reads.mjs'
import { parseCoreAsset, parseCoreCollection, parseTokenAccount, absentIfDust } from '../src/lib/decode.mjs'
import { planClaim, planBuy, planDraw, readPobs } from '../src/lib/plan-get.mjs'
import { planActivate } from '../src/lib/plan-vault.mjs'
import { planClubOpening } from './club-opening.mjs'
import { buildForWallet, signExact, simulate, PAGE_CU_PRICE } from '../src/lib/tx.mjs'
import {keyChangeAcknowledgment} from '../src/lib/ballot-input.mjs'
import {voteInput,planVotes} from '../src/lib/vote-plan.mjs'
import {governanceActionInput,planGovernanceAction} from '../src/lib/sale-proposal.mjs'
import {orderCommitment,inspectCommitment,commitmentMatches} from '../src/lib/trade-state.mjs'
import POB_SET from '../src/generated/pob-set.json' with { type: 'json' }

export const profile = PROFILES.mainnet
const ids = makeIds(profile)
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const effect = ixs => ixs.map(ix => ({ program: ix.programId.toBase58(), data: ix.data.toString('base64'),
  keys: ix.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable]) }))
export async function assertBank(conn) {
  if (!ids.COLL) throw new Error('The Bank is awaiting its initialization ceremony. No vault can be issued or traded yet.')
  if (await conn.getGenesisHash() !== profile.expectedGenesisHash) throw new Error('The connection is not Solana mainnet.')
}
export async function ownedVault(conn, asset, owner = null) {
  await assertBank(conn)
  const v = await readVault(conn, ids, new PublicKey(asset))
  if (!v.info || v.info.burned || v.info.collection !== ids.COLL.toBase58() || !v.record || v.record.asset !== String(asset) || v.record.retired) throw Object.assign(new Error('That live Bank vault is not held by this wallet.'),{code:'CBOB_ORDER_INVALID'})
  if (owner && v.info.owner !== owner) throw Object.assign(new Error('That live Bank vault is not held by this wallet.'), { code: 'CBOB_OWNER_MISMATCH' })
  return v
}
export async function tradableVault(conn, asset, owner = null) {
  const v = await ownedVault(conn, asset, owner)
  if (v.record.level < 1 || v.record.level > 5) throw new Error('The level must be drawn before a vault can be listed or receive offers.')
  const reserves = {}
  for (const mint of Object.keys(profile.tokenNames)) {
    const a = absentIfDust(await account(conn, ata(ids.depositAddress(asset), mint))), token = a ? parseTokenAccount(a.data) : null
    if (token && (!a.owner.equals(TOKEN_PROGRAM) || token.mint !== mint || token.owner !== ids.depositAddress(asset).toBase58() || token.state !== 1)) throw Object.assign(new Error('A reserve account is frozen or could not be verified.'),{code:'CBOB_ORDER_INVALID'})
    reserves[mint] = String(token?.amount || 0)
  }
  const state = { reserves, level: v.record.level, active: v.record.active, pending: v.record.pending, retired: v.record.retired, burned: v.info.burned }
  return { ...v, state, orderState: orderCommitment(String(asset),state,Object.keys(profile.tokenNames)) }
}
export const orderMatches=(v,asset,saved)=>commitmentMatches(saved,String(asset),v.state,Object.keys(profile.tokenNames))
export async function walletState(conn, owner) {
  const address = new PublicKey(owner)
  const result = { sol_lamports: String(await conn.getBalance(address, 'confirmed')), pobs: [], initialized: !!ids.COLL, reserves: {} }
  for (const [mint, label] of Object.entries(profile.tokenNames || {})) {
    const a = await account(conn, ata(address, mint))
    result.reserves[label] = a && a.data.length ? String(parseTokenAccount(a.data).amount) : '0'
  }
  const pobs = await readPobs(conn, accounts, ids, POB_SET, parseCoreAsset)
  result.pobs = pobs.filter(p => p.info && !p.info.burned && p.info.owner === owner && p.info.collection === POB_SET.collection).map(p => ({ address: p.address, edition: POB_SET.assets.find(x => x.address === p.address).edition }))
  return result
}
/** Pure input policy; never accepts program ids, destination overrides or serialized bytes. */
export function judgeInput(action, input) {
  if (!['claim', 'buy', 'activate', 'draw', 'open', 'trade', 'vote', 'propose', 'execute_proposal'].includes(action)) throw new Error('Unknown Bank action.')
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid action details.')
  if(action==='vote') { voteInput(input); return }
  if(['propose','execute_proposal'].includes(action)) { governanceActionInput(action,input); return }
  const allowed = action === 'claim' ? ['pob'] : action === 'buy' ? [] : action === 'trade' ? ['asset', 'buyer', 'seller', 'price', 'orderId', 'vaultState'] : ['asset']
  if (Object.keys(input).some(k => !allowed.includes(k))) throw new Error('Unexpected action details.')
  for (const k of allowed.filter(k => ['asset', 'pob', 'buyer', 'seller', 'proposal'].includes(k))) {
    if (typeof input[k] !== 'string') throw new Error('Missing action address.')
    new PublicKey(input[k])
  }
  if (action === 'trade' && (!/^[1-9]\d{0,14}$/.test(input.price) || BigInt(input.price) > 100000000000000n || input.buyer === input.seller)) throw new Error('Invalid trade.')
}
export function tradeInstructions(ids, rpc, owner, asset, seller, buyer, price) {
  price = BigInt(price); const royalty = price / 10n
  const umi = createUmi(rpc)
    const transfer = transferV1(umi, { asset: umiKey(asset), collection: umiKey(ids.COLL.toBase58()), payer: createNoopSigner(umiKey(owner)), authority: createNoopSigner(umiKey(seller)), newOwner: umiKey(buyer) })
  const ixs = transfer.getInstructions().map(ix => new TransactionInstruction({ programId: new PublicKey(ix.programId), keys: ix.keys.map(k => ({ ...k, pubkey: new PublicKey(k.pubkey) })), data: Buffer.from(ix.data) }))
    ixs.push(SystemProgram.transfer({ fromPubkey: new PublicKey(buyer), toPubkey: new PublicKey(seller), lamports: price - royalty }),
      SystemProgram.transfer({ fromPubkey: new PublicKey(buyer), toPubkey: ids.REVENUE, lamports: royalty }))
  return ixs
}
export async function prepare(conn, owner, action, input = {}, assetSecret = null, openingReview = null) {
  judgeInput(action, input); await assertBank(conn)
  const pubkey = new PublicKey(owner), cfg = await readConfigs(conn, ids)
  let ixs, asset = input.asset || null, kp = null, acks = [], details = {}, stage = action, openingContext = null, openingBuilt = null
  if (action === 'claim' || action === 'buy') {
    kp = assetSecret ? Keypair.fromSecretKey(Buffer.from(assetSecret, 'base64')) : Keypair.generate(); asset = kp.publicKey.toBase58()
    if (await account(conn, kp.publicKey)) throw new Error('This vault address is already in use. Read your vaults before preparing another issuance.')
    let plan
    if (action === 'buy') plan = planBuy(ids, SITE, await readBuySnapshot(conn, ids, pubkey), kp.publicKey)
    else {
      const pc = await account(conn, POB_SET.collection)
      plan = planClaim(ids, SITE, { mintConfig: cfg.mint, nowSec: await chainNow(conn), owner, pobSet: POB_SET,
        pobs: await readPobs(conn, accounts, ids, POB_SET, parseCoreAsset), pobCollection: pc && pc.owner.equals(ids.CORE) ? parseCoreCollection(pc.data) : null }, kp.publicKey, input.pob)
    }
    if (!plan.ok) throw new Error(plan.refuse.join(' '))
    ixs = [plan.ix]; details = { name: plan.name, uri: plan.uri, price_sats: String(plan.price || 0), pob: plan.pick?.address || null }
  } else if (action === 'vote') {
    const plan=await planVotes(conn,ids,owner,input)
    ixs=plan.ixs;details=plan.details
    if(!input.ballots) { const b=details.ballots[0]; details={...details,...b};asset=b.asset }
    acks=[{id:'one_vault_one_vote',text:`Cast the ${details.ballots.length} listed vault vote(s) on Proposal ${details.proposal_id}, exactly as shown. Each vote is public, permanent and cannot be changed. Gary Club signs only after your approval. A transfer does not reset a vote.`}]
  } else if (action === 'propose' || action === 'execute_proposal') {
    const plan=await planGovernanceAction(conn,ids,owner,action,input)
    ixs=plan.ixs;details=plan.details;acks=plan.acks
  } else if (action === 'trade') {
    const v=await tradableVault(conn,asset,input.seller)
    if(!orderMatches(v,asset,input.vaultState))throw Object.assign(new Error('This vault no longer matches the order. A new order is required.'),{code:'CBOB_ORDER_INVALID'})
    const {info}=v,committed=inspectCommitment(input.vaultState,asset,Object.keys(profile.tokenNames))
    if (owner !== input.buyer && owner !== input.seller) throw new Error('This account is not a party to the trade.')
    const price = BigInt(input.price), royalty = price / 10n
    ixs = tradeInstructions(ids, conn.rpcEndpoint, owner, asset, info.owner, input.buyer, price)
    // Only the approved reserve minimum enters the confirmation effect. Dust,
    // claims and activation can improve a closed vault without killing orders.
    details = { state: {level:committed.level,minimum_reserves:committed.reserves}, buyer: input.buyer, seller: input.seller, price_lamports: String(price), seller_lamports: String(price - royalty), royalty_lamports: String(royalty), revenue: ids.REVENUE.toBase58() }
  } else {
    const v = await ownedVault(conn, asset, owner)
    if (action === 'activate') {
      const a = await account(conn, ata(ids.depositAddress(asset), cfg.mint.payment_mint))
      const p = planActivate(ids, cfg.mint, asset, v.info, v.record, a && a.data.length ? parseTokenAccount(a.data) : null)
      if (!p.ok) throw new Error(p.why)
      ixs = [p.ix]; details = { step: p.step, note: p.note }
    } else if (action === 'draw') {
      const p = planDraw(ids, cfg.mint, asset, v.info, v.record, await conn.getSlot('confirmed'), owner)
      if (!p.ix) throw new Error(p.text)
      ixs = [p.ix]; details = { step: p.state, note: p.text }
    } else {
      const opening = await planClubOpening({ profile, conn, ids, owner, asset,
        previous: openingReview?.previous || null, confirming: openingReview?.confirming || null })
      ;({ ixs, details, stage, acks, openingContext } = opening)
      openingBuilt = opening.built
    }
  }
  if(action==='vote'||action==='execute_proposal') { const ack=keyChangeAcknowledgment(details.actions);if(ack)acks.push(ack) }
  const built = openingBuilt || await buildForWallet(conn, ixs, pubkey)
  if (built.sim.err) throw new Error(`The network dry run refused this action: ${built.sim.explained}`)
  const fee = await conn.getFeeForMessage(built.tx.compileMessage(), 'confirmed')
  if (!Number.isSafeInteger(fee.value) || fee.value < 0) throw new Error('The network could not quote its fee. Prepare again.')
  const before = await conn.getBalance(pubkey, 'confirmed'), watched = await simulate(conn, built.tx, [pubkey])
  if (watched.err || !watched.accounts[0]) throw new Error('The wallet balance change could not be checked.')
  const summary = { estimated_sol_change_lamports: String(BigInt(watched.accounts[0].lamports) - BigInt(before)), action, stage, asset, wallet: owner, details, acks, network_fee_lamports: String(fee.value) }
  if (action === 'open' && stage === 'open') {
    // Reserve one full transaction's priority budget above the observed fee so
    // a newly due payout cannot force perpetual re-quotes. The member explicitly
    // approves this maximum; actual fees still come from the fresh RPC quote.
    summary.max_network_fee_lamports = String(fee.value + Math.ceil(1_400_000 * PAGE_CU_PRICE / 1_000_000))
    acks.push({ id: 'opening_fee_budget', text: `I approve a network fee up to ${Number(summary.max_network_fee_lamports) / 1e9} SOL for this opening. The exact fee may change when newly due payouts are included; a higher fee requires a new review.` })
  }
  return { asset, summary, effectHash: hash(action === 'open' ? { stage, openingContext, ...(stage === 'opening_setup' ? { instructions: effect(ixs) } : {}) } : { instructions: effect(ixs), stage, details, acks }), tx: built.tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
    blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight, minUnits: built.minUnits,
    openingContext,
    assetSecret: kp ? Buffer.from(kp.secretKey).toString('base64') : null }
}
export async function signPrepared(prepared, ownerKey, additionalKeys = []) {
  const tx = Transaction.from(Buffer.from(prepared.tx, 'base64'))
  const extras = [...additionalKeys, ...(prepared.assetSecret ? [Keypair.fromSecretKey(Buffer.from(prepared.assetSecret, 'base64'))] : [])]
  const signed = await signExact({ publicKey: ownerKey.publicKey, signTransaction: async t => { t.partialSign(ownerKey); return t } }, tx, extras, { minUnits: prepared.minUnits })
  return signed.serialize()
}
