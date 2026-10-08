/**
 * GETTING A VAULT, as pure functions of what was read:
 *   planClaim  the charter claim: burn one Proof of Burn the wallet owns, with its
 *              Merkle proof (scripts/pob-merkle.mjs over scripts/pob-set.json, the
 *              SAME code the suite and the mainnet probe use), inside the window;
 *   planBuy    mint_vault in an open, voted round, paying cbBTC, with max_price set
 *              to the round price READ ON CHAIN (a vote that raises it in between
 *              refuses the mint instead of charging more);
 *   planDraw   the level draw that follows either one.
 * Both mints carry NO crank (SPEC item 37 and 54: the page cannot rely on a wallet
 * keeping a compute-budget instruction, and the Bank's crank captures anyway) and
 * name the new vault "CBOB Vault" with its metadata at <metadataBase><asset>.json.
 */
import { PublicKey } from '@solana/web3.js'
import { rootOf, proofOf } from '../../../scripts/pob-merkle.mjs'
import { Buffer } from './enc.mjs'
import { ata } from './ids.mjs'
import * as IX from './ix.mjs'

export const MAX_NAME_LEN = 64, MAX_URI_LEN = 200
const when = t => new Date(Number(t) * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

/** The new vault's on-chain name and metadata link. Throws if MINT would refuse them. */
export function vaultMeta(site, asset) {
  const name = site.vaultName, uri = `${site.metadataBase}${new PublicKey(asset).toBase58()}.json`
  if (Buffer.byteLength(name) > MAX_NAME_LEN) throw new Error('vault name longer than MINT allows')
  if (Buffer.byteLength(uri) > MAX_URI_LEN) throw new Error('metadata link longer than MINT allows')
  return { name, uri }
}

/** Supply checks MINT makes on every mint and claim (check_supply). */
function supplyRefusals(c) {
  const out = []
  const capTotal = c.level_caps.reduce((a, b) => a + BigInt(b), 0n)
  if (BigInt(c.minted_total) >= BigInt(c.max_supply)) out.push('All 2,100 vaults have been created. There are no more.')
  else if (BigInt(c.minted_total) >= capTotal) out.push('Every level has been allotted. No more vaults can be created.')
  return out
}

/**
 * @param s { mintConfig, nowSec, owner, pobSet {collection, assets[{edition,address}]},
 *            pobs: [{ address, programOwner, info|null }] (every set member, read now),
 *            pobCollection: parsed CollectionV1 of the Proof of Burn collection, or null }
 * @param choose the chosen Proof of Burn address (optional; default: the first eligible)
 */
export function planClaim(ids, site, s, newAsset, choose = null) {
  const c = s.mintConfig, refuse = [], note = []
  const now = BigInt(s.nowSec)
  if (now < BigInt(c.charter_opens_at)) refuse.push(`The charter window has not opened yet. It opens ${when(c.charter_opens_at)}.`)
  else if (now >= BigInt(c.charter_closes_at)) refuse.push(`The charter window closed ${when(c.charter_closes_at)}. Proofs of Burn can no longer be exchanged for vaults.`)
  refuse.push(...supplyRefusals(c))
  if (s.pobSet.collection !== c.pob_collection) refuse.push('This page\'s Proof of Burn list is not for the collection the Bank was set up with. Nothing can be claimed here.')
  const addrs = s.pobSet.assets.map(a => new PublicKey(a.address).toBytes())
  const root = Buffer.from(rootOf(addrs)).toString('hex')
  if (root !== c.pob_root) refuse.push('This page\'s Proof of Burn list does not match the one the Bank committed to. Nothing can be claimed here.')
  if (!s.pobCollection || s.pobCollection.pluginsUnreadable) refuse.push('The Proof of Burn collection could not be read.')
  else if (s.pobCollection.plugins.externalCount) refuse.push('The Proof of Burn collection now carries an extra rule (an external plugin). This page cannot pass the accounts that rule needs, so it will not try. This needs a person.')
  const owner = new PublicKey(s.owner).toBase58()
  const mine = s.pobs.map((p, i) => ({ ...p, edition: s.pobSet.assets[i].edition, index: i }))
    .filter(p => p.programOwner === ids.CORE.toBase58() && p.info && !p.info.burned && p.info.owner === owner && p.info.collection === c.pob_collection)
  if (!mine.length) refuse.push('This wallet does not hold a Proof of Burn from the set. Each of the 240 Proofs of Burn can be exchanged for one vault, by its holder.')
  const pick = choose ? mine.find(p => p.address === choose) : mine[0]
  if (choose && !pick) refuse.push('That Proof of Burn is not held by this wallet.')
  if (pick && pick.info.pluginsUnreadable) refuse.push(`Proof of Burn #${pick.edition} carries plugins this page cannot read, so it cannot tell whether the burn would be refused. This needs a person.`)
  if (pick) {
    const frozen = ['FreezeDelegate', 'PermanentFreezeDelegate'].some(t => pick.info.plugin(t)?.body.frozen)
    if (frozen) refuse.push(`Proof of Burn #${pick.edition} is frozen, so it cannot be burned to claim a vault.`)
    if (pick.info.plugins.externalCount) refuse.push(`Proof of Burn #${pick.edition} carries an extra rule (an external plugin). This page cannot pass the accounts that rule needs. This needs a person.`)
  }
  if (refuse.length || !pick) return { ok: false, refuse, note, mine }
  const proof = proofOf(addrs, pick.index)
  const { name, uri } = vaultMeta(site, newAsset)
  const ix = IX.claimCharterVault(ids, { asset: new PublicKey(newAsset), owner: new PublicKey(owner), pob: new PublicKey(pick.address),
    pobCollection: new PublicKey(c.pob_collection), pool: new PublicKey(c.pool_ata), proof, name, uri })
  note.push(`Proof of Burn #${pick.edition} is burned in the same step that creates your vault. Nothing is paid apart from the network fee and the rent of the new accounts.`)
  return { ok: true, refuse, note, mine, pick, ix, name, uri, proofDepth: proof.length }
}

/**
 * @param s { mintConfig, nowSec, owner, payerToken: parsed classic token account|null,
 *            revenueTokenExists: bool, decimals }
 */
export function planBuy(ids, site, s, newAsset) {
  const c = s.mintConfig, refuse = []
  const now = BigInt(s.nowSec), price = BigInt(c.price)
  if (c.sales_stopped) refuse.push('Sales are stopped by the guardian. Only a community vote can restart them.')
  if (Number(c.round_id) === 0) refuse.push('No sale round has been voted yet.')
  else if (now < BigInt(c.opens_at)) refuse.push(`The current sale round opens ${when(c.opens_at)}.`)
  else if (now >= BigInt(c.closes_at)) refuse.push(`The last sale round closed ${when(c.closes_at)}. A new round needs a community vote.`)
  else if (Number(c.minted_this_round) >= Number(c.cap)) refuse.push(`This round is sold out (${c.cap} of ${c.cap}).`)
  refuse.push(...supplyRefusals(c))
  const owner = new PublicKey(s.owner)
  const payerToken = ata(owner, c.payment_mint)
  if (!s.payerToken) refuse.push('This wallet has no cbBTC account. It needs at least the round price in cbBTC.')
  else if (s.payerToken.state === 2) refuse.push('This wallet\'s cbBTC account is frozen by Coinbase.')
  else if (s.payerToken.amount < price) refuse.push(`This wallet holds ${s.payerToken.amount} sats of cbBTC; the round price is ${price} sats.`)
  if (!s.revenueTokenExists) refuse.push('The Bank\'s revenue account for cbBTC is not set up yet, so a sale cannot be paid.')
  if (refuse.length) return { ok: false, refuse, price }
  const { name, uri } = vaultMeta(site, newAsset)
  const ix = IX.mintVault(ids, { asset: new PublicKey(newAsset), owner, payerToken, paymentMint: new PublicKey(c.payment_mint),
    revenueToken: ata(ids.REVENUE, c.payment_mint), pool: new PublicKey(c.pool_ata), maxPrice: price, name, uri })
  return { ok: true, refuse, price, ix, name, uri, roundId: Number(c.round_id), left: Number(c.cap) - Number(c.minted_this_round) }
}

// ── the level draw ──

export const REVEAL_WINDOW_SLOTS = 300
/** The slot after which the three hashes a draw uses can all exist (A, then two
 *  4-slot leader groups later twice; sim/test-vault.ts `readySlot`). */
export const readySlot = rs => { let a = Number(rs); for (let i = 0; i < 2; i++) a = (Math.floor(a / 4) + 2) * 4; return a }

/** What can be done for this vault's draw right now. `slot` = the cluster's slot. */
export function planDraw(ids, mintConfig, asset, assetInfo, record, slot, payer) {
  if (!record) return { state: 'none', text: 'The Bank has no record for this vault.' }
  if (record.level >= 1 && record.level <= 5) return { state: 'drawn', text: `Level ${['I', 'II', 'III', 'IV', 'V'][record.level - 1]} has been drawn.` }
  const a = new PublicKey(asset), rs = Number(record.reveal_slot)
  if (assetInfo && !assetInfo.burned && assetInfo.pluginsUnreadable) return { state: 'unknown', text: 'This vault\'s details could not be read, so this page cannot draw its level. The Bank\'s draw job does it every minute.' }
  // Round 42 (C7): an Attributes plugin whose body could not be parsed is the same
  // unknown as unreadable plugins (never a TypeError, never a reveal without them).
  const attrPlugin = assetInfo && !assetInfo.burned ? assetInfo.plugin('Attributes') : null
  if (attrPlugin && !attrPlugin.body) return { state: 'unknown', text: 'This vault\'s details could not be read, so this page cannot draw its level. The Bank\'s draw job does it every minute.' }
  const attrs = (attrPlugin?.body?.attributeList || []).map(x => [x.key, x.value])
  const next = BigInt(record.mint_index) === BigInt(mintConfig.revealed_total)
  const expired = slot > rs + REVEAL_WINDOW_SLOTS
  if (!record.entropy_set && expired)
    return { state: 'reschedule', ix: IX.rescheduleReveal(ids, a),
      text: 'Nobody recorded this vault\'s draw in its two-minute window, so it is drawn again from fresh blocks. Anyone can start that, free apart from the network fee.' }
  if (!record.entropy_set && slot <= readySlot(rs))
    return { state: 'wait', text: `The draw uses blocks that do not exist yet. It becomes possible in about ${Math.max(1, Math.ceil((readySlot(rs) + 1 - slot) * 0.4))} seconds.` }
  if (next) return { state: 'reveal', ix: IX.revealLevel(ids, a, attrs, new PublicKey(payer)),
    text: 'Your vault is next in line. Anyone can draw its level now and write it onto the vault, free apart from the network fee and a little rent.' }
  if (!record.entropy_set) return { state: 'capture', ix: IX.captureEntropy(ids, a),
    text: `Vaults are drawn in the order they were created, and ${BigInt(record.mint_index) - BigInt(mintConfig.revealed_total)} created before yours are still waiting. You can record your draw's randomness now, so it cannot lapse; the level itself is written when its turn comes. The Bank's draw job does both every minute.` }
  return { state: 'queued', text: `Your draw's randomness is recorded. The level is written when the ${BigInt(record.mint_index) - BigInt(mintConfig.revealed_total)} vault(s) before it have been drawn; the Bank's draw job does that every minute, and anyone can.` }
}

/** Every Proof of Burn in the set, read now (getMultipleAccounts, 100 at a time). */
export async function readPobs(conn, accountsFn, ids, pobSet, parseCoreAsset) {
  const infos = await accountsFn(conn, pobSet.assets.map(a => a.address), 'the Proofs of Burn')
  return infos.map((a, i) => {
    let info = null
    if (a && a.owner.equals(ids.CORE)) { try { info = parseCoreAsset(a.data) } catch { info = null } }
    return { address: pobSet.assets[i].address, programOwner: a ? a.owner.toBase58() : null, info }
  })
}
