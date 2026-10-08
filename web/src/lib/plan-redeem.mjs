/**
 * THE REDEMPTION PLAN, as a pure function of what was read from the chain.
 *
 * It implements SPEC item 50, "What a redemption client (the redeem page first)
 * must do", and round 35 C5, and nothing else:
 *   * a PRIOR transaction creates the owner's destination accounts and any of
 *     the vault's three reserve accounts that does not exist yet (item 42);
 *   * the redemption is ONE legacy transaction:
 *       [claim]  (only for an activated vault, and never while the pool is frozen)
 *       open_for_redemption
 *       Core ExecuteV1 -> the sweep helper, naming all three reserve accounts and
 *                         every stray classic account it can close
 *       Core ExecuteV1 -> SPL Transfer, once per stray account whose CLOSE
 *                         authority a stranger kept (C5): its balance moves to
 *                         the owner and the empty account stays UNDECLARED
 *       burn_vault       declaring every reserve mint's ATA under both programs
 *     and it must fit 1,232 bytes;
 *   * judgeRedemptionCoverage (bank/detectors.mjs, unchanged) runs over
 *     everything the vault wallet holds, with "declared" meaning "moved out by
 *     this transaction", before anything is offered for signature.
 *
 * Outcome classes, each stated to the holder:
 *   refuse   the page will not build a redemption (and says what would fix it);
 *   ack      the page builds it only after the holder ticks a box naming what
 *            will be destroyed or forfeited;
 *   note     plain information.
 */
import { PublicKey, Transaction } from '@solana/web3.js'
import { judgeRedemptionCoverage, classifyPdaTokenAccount } from '../../../bank/detectors.mjs'
import { ata, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from './ids.mjs'
import * as IX from './ix.mjs'

export const PACKET_LIMIT = 1232
export const LEVEL_WEIGHTS = [2n, 3n, 4n, 5n, 6n]
export const ACC_SCALE = 1_000_000_000_000n
export const ACTIVATION_SATS = 21_000n
const TOKEN_FROZEN = 2
const DUMMY_BLOCKHASH = '11111111111111111111111111111111'

/** Legacy wire size of `ixs` with `feePayer`, signatures included as zeros. */
export function legacySize(ixs, feePayer) {
  const t = new Transaction().add(...ixs)
  t.feePayer = new PublicKey(feePayer); t.recentBlockhash = DUMMY_BLOCKHASH
  try { return t.serialize({ requireAllSignatures: false, verifySignatures: false }).length } catch { return Infinity }
}

/** What an ACTIVE vault is owed now, in whole sats (MINT `owed_of`, floored). */
export function owedSats(record, mintConfig) {
  if (!record.active || record.level < 1 || record.level > 5) return 0n
  const w = LEVEL_WEIGHTS[record.level - 1] + BigInt(record.boost_weight)
  const owed = w * BigInt(mintConfig.acc_scaled) + BigInt(record.carry_scaled) - BigInt(record.debt_scaled)
  return owed > 0n ? owed / ACC_SCALE : 0n
}

/** BURN's rolling-window rate limit, read-only: { allowed, cap, nextAt }. */
export function rateLimit(burnConfig, mintConfig, nowSec) {
  const live = BigInt(mintConfig.minted_total) - BigInt(burnConfig.burned_total) - BigInt(mintConfig.bare_burns_retired)
  let cap = (live * 210n + 9999n) / 10000n; if (cap < 1n) cap = 1n
  const k = Number(cap > 64n ? 64n : cap)
  const head = burnConfig.rate_head % 64
  const kth = BigInt(burnConfig.rate_ring[(head + 64 - k) % 64])
  const win = BigInt(burnConfig.redeem_window_secs)
  const nextAt = kth + win
  return { allowed: BigInt(nowSec) - kth >= win, cap: Number(cap), nextAt: Number(nextAt), live: Number(live) }
}

/**
 * @param ids   makeIds(profile)
 * @param s     the snapshot (see web/src/lib/reads.mjs readRedemptionSnapshot)
 * @returns     { refuse[], ack[], note[], prior: ix[][], redemption: ix[], size, ... }
 */
export function planRedemption(ids, s) {
  const refuse = [], ack = [], note = []
  const owner = new PublicKey(s.owner), asset = new PublicKey(s.asset)
  const pda = ids.depositAddress(asset)
  const name = m => s.tokenNames?.[m] || `token ${m}`

  // ── the vault itself ──
  if (!s.assetInfo || s.assetInfo.burned) refuse.push('This vault no longer exists: it has been opened or burned.')
  else {
    if (s.assetInfo.collection !== ids.COLL.toBase58()) refuse.push('This NFT is not a vault of the Central Bank of Bitcoin collection.')
    if (s.assetInfo.owner !== owner.toBase58()) refuse.push('The connected wallet does not own this vault. Only its owner can open it.')
  }
  if (!s.record) refuse.push('The Bank has no record for this vault.')
  else if (s.record.retired) refuse.push('This vault has already been retired from the payout schedule.')

  const reserves = s.sealConfig.reserve_mints
  const poolFrozen = !!s.pool && s.pool.state === TOKEN_FROZEN
  const owed = s.record ? owedSats(s.record, s.mintConfig) : 0n

  // ── claim before the sweep, except while the pool is frozen (round 24 D4) ──
  const claim = !!s.record?.active && !poolFrozen
  if (s.record?.active && poolFrozen && owed > 0n)
    ack.push({ id: 'forfeit', text: `The Bank's payout pool is frozen by Coinbase right now, so this opening cannot collect the ${owed} sats credited to your vault and not yet delivered. They go back to the pool for the vaults that remain. Wait for the pool to be unfrozen to keep them.` })
  if (s.record?.pending) note.push('This vault has asked to join the payouts and has not joined yet, so it is owed nothing. Opening it simply takes it out of the queue.')

  // ── the prior transaction: every account the sweep will name must exist ──
  const priorIxs = []
  const ownerAta = m => ata(owner, m)
  const needOwnerAta = new Set()
  const reservePairs = []
  const covered = new Set()
  for (const m of reserves) {
    const v = ata(pda, m).toBase58()
    covered.add(v)
    const acc = s.pdaTokens.find(t => t.address === v)
    if (!acc) priorIxs.push({ why: `create your vault's ${name(m)} account, so the opening can name it (it is closed again in the same opening, its rent back to you)`,
      ix: IX.createAtaIdempotent(owner, v, pda, m) })
    else {
      const t = acc.parsed
      if (!t) refuse.push(`Your vault's ${name(m)} account could not be read. This needs a person to look at it.`)
      else if (acc.program !== 'token' || acc.dataLen !== 165) refuse.push(`Your vault's ${name(m)} account is not a classic token account. This needs a person to look at it.`)
      else if (t.state === TOKEN_FROZEN && t.amount > 0n) refuse.push(`Coinbase has frozen your vault's ${name(m)} account. Nothing can be taken out of a frozen account, and a vault can only be opened whole, so it cannot be opened until Coinbase unfreezes it. Payouts owed to it stay owed.`)
      else if (t.closeAuthority && t.closeAuthority !== pda.toBase58()) refuse.push(`Your vault's ${name(m)} account names someone else as the one who may close it, so the opening could not empty it. This needs a person to look at it.`)
    }
    if (s.ownerAtaFrozen?.has(ownerAta(m).toBase58())) refuse.push(`Your own ${name(m)} account (${ownerAta(m).toBase58()}) is frozen by its issuer, so it cannot receive what your vault holds. It must be unfrozen before the vault can be opened.`)
    needOwnerAta.add(m)
    reservePairs.push([new PublicKey(v), ownerAta(m)])
  }

  // ── everything else the vault wallet holds ──
  // ROUND 2 OF THE REVIEW (H1): a stranger can put things here for pennies. The
  // programs never look at what the burn is not shown, so NOTHING here may block an
  // opening. What the page can move, it moves; what it cannot is named, one by one,
  // in a box the holder ticks ("this is destroyed"). Only the vault's own three
  // reserve accounts and a nested CBOB vault (rescuable) can refuse an opening.
  const helperStrays = [], transferStrays = [], owned = [], cannot = []
  for (const acc of s.pdaTokens) {
    if (covered.has(acc.address)) {
      const c = acc.parsed ? classifyPdaTokenAccount({ address: acc.address, dataLen: acc.dataLen, amount: acc.parsed.amount }) : null
      if (c) owned.push(c)
      continue
    }
    if (!acc.parsed) { cannot.push({ address: acc.address, text: `The vault wallet owns an account this page cannot read (${acc.address}). Whatever it holds stays there and is lost when the vault is opened.` }); continue }
    const c = classifyPdaTokenAccount({ address: acc.address, dataLen: acc.dataLen, amount: acc.parsed.amount })
    if (c) owned.push(c)
    const t = acc.parsed
    if (acc.program !== 'token' || acc.dataLen !== 165) {
      if (c) cannot.push({ address: acc.address, text: `A Token-2022 account (${acc.address}, ${name(t.mint)}) is owned by the vault wallet${t.amount > 0n ? `, holding ${t.amount} units` : ''}. This page cannot move Token-2022 tokens, and part of such an account can be hidden from it, so whatever it holds is lost when the vault is opened. Anyone can create one of these for any vault for a few cents; it is not something you did.` })
      continue
    }
    if (t.amount === 0n) continue                     // a classic empty account: nothing to lose (its rent is its creator's)
    if (t.state === TOKEN_FROZEN) { cannot.push({ address: acc.address, text: `${t.amount} units of ${name(t.mint)} sit in an account the token's issuer has frozen (${acc.address}). Nothing can move them, so they are lost when the vault is opened. (Frozen NFTs such as programmable NFTs look like this too.)` }); continue }
    if (!t.closeAuthority || t.closeAuthority === pda.toBase58()) helperStrays.push(acc)
    else transferStrays.push(acc)                     // C5: move the balance, leave the account undeclared
  }
  // ROUND 36 H1: a stray of a mint whose freeze authority someone holds is NEVER
  // delivered: whoever holds it could freeze the holder's receiving account between
  // the plan and the send and make every opening fail. Same for a receiving account
  // that is frozen already, and for every stray when the caller asks (a dry run that
  // failed on one). Each is named in a box instead; the opening never depends on it.
  const reservesSet = new Set(reserves)
  const undeliverable = a => {
    const m = a.parsed.mint
    if (s.dropStrays) return 'it could not be delivered in the dry run just now'
    if (s.ownerAtaFrozen?.has(ownerAta(m).toBase58())) return 'your own account for this token is frozen'
    const f = s.mintFreeze?.[m]
    if (f === undefined || f === 'unknown') return 'this page could not read who controls this token'
    if (f && !reservesSet.has(m)) return 'whoever issued this token can freeze accounts, so a stranger holding that power could freeze your receiving account and stop the opening'
    return null
  }
  for (const list of [helperStrays, transferStrays]) for (const a of [...list]) {
    const why = undeliverable(a)
    if (!why) continue
    list.splice(list.indexOf(a), 1)
    cannot.push({ address: a.address, text: `Your vault also holds ${a.parsed.amount} units of ${name(a.parsed.mint)} (account ${a.address}). It is left in the vault because ${why}. It is lost when the vault is opened.` })
  }
  // second pass (the re-plan just before the opening): no new prior transaction is
  // ever demanded, so a stranger cannot make the holder pay for account after account
  // ROUND 38 V38-2: the final re-plan (s.known = the strays the holder saw would be
  // moved) never delivers anything that arrived after the check: delivering it could
  // fail, and the holder's standing consent (LATE_CONSENT) already covers it. It stays.
  const late = []
  if (s.known) for (const list of [helperStrays, transferStrays]) for (const a of [...list])
    if (!s.known.has(a.address)) { list.splice(list.indexOf(a), 1); late.push(a) }
  const canReceive = a => !s.noPrior || s.ownerAtaExists.has(ownerAta(a.parsed.mint).toBase58())
  const noAccount = [...helperStrays, ...transferStrays].filter(a => !canReceive(a))
  // ROUND 38 V38-1: remove each from the list that HOLDS it (indexOf -1 would splice the last helper stray)
  const drop = (list, a) => { const i = list.indexOf(a); if (i >= 0) list.splice(i, 1) }
  for (const a of noAccount) { drop(helperStrays, a); drop(transferStrays, a) }
  for (const n of s.nested) owned.push({ address: n.address, kind: 'asset' })

  // ── the redemption, fitted to the packet ──
  const declared = reserves.flatMap(m => [ata(pda, m, TOKEN_PROGRAM), ata(pda, m, TOKEN_2022_PROGRAM)])
  const pool = new PublicKey(s.mintConfig.pool_ata)
  const build = (hs, ts) => {
    const ixs = []
    if (claim) ixs.push(IX.poolClaim(ids, pool, [{ asset, dest: ata(pda, s.mintConfig.payment_mint) }]))
    ixs.push(IX.openForRedemption(ids, asset, owner))
    ixs.push(IX.coreExecute(ids, { asset, collection: ids.COLL, assetSigner: pda, payer: owner, authority: owner,
      inner: IX.sweepHelper(ids, pda, owner, [...reservePairs, ...hs.map(a => [new PublicKey(a.address), ownerAta(a.parsed.mint)])]) }))
    for (const a of ts) ixs.push(IX.coreExecute(ids, { asset, collection: ids.COLL, assetSigner: pda, payer: owner, authority: owner,
      inner: IX.tokenTransfer(a.address, ownerAta(a.parsed.mint), pda, a.parsed.amount) }))
    ixs.push(IX.burnVault(ids, asset, owner, pda, pool, declared))
    return ixs
  }
  let hs = [...helperStrays], ts = [...transferStrays]
  const left = []
  let redemption = build(hs, ts), size = legacySize(redemption, owner)
  while (size > PACKET_LIMIT && (hs.length || ts.length)) {
    left.push(ts.length ? ts.pop() : hs.pop())
    redemption = build(hs, ts); size = legacySize(redemption, owner)
  }
  if (size > PACKET_LIMIT) refuse.push(`The opening does not fit one transaction (${size} of ${PACKET_LIMIT} bytes). This needs a person to look at it.`)
  for (const a of [...hs, ...ts]) { covered.add(a.address); needOwnerAta.add(a.parsed.mint) }
  for (const a of [...left, ...noAccount]) ack.push({ id: `left:${a.address}`, text: `Your vault also holds ${a.parsed.amount} units of ${name(a.parsed.mint)} in the account ${a.address}. ${noAccount.includes(a) ? 'There is no account of yours to receive it, and creating one would need another set-up transaction' : 'There is no room to take it out in the same opening (the transaction is full)'}, so it is lost when the vault is opened.` })
  for (const a of ts) note.push(`The account ${a.address} was handed to your vault by someone who kept the right to close it. The opening moves the ${a.parsed.amount} units of ${name(a.parsed.mint)} read a moment ago to you and leaves the account behind (its rent belongs to whoever can close it). Anything sent to that account after this check stays in it.`)
  for (const a of hs) note.push(`Your vault also holds ${a.parsed.amount} units of ${name(a.parsed.mint)} (account ${a.address}). The opening moves it to you too.`)
  for (const x of cannot) ack.push({ id: `lost:${x.address}`, text: x.text })

  // ── NFTs in the deposit address ──
  for (const n of s.nested) {
    if (n.ourVault) refuse.push(`Another vault (${n.address}) is inside this vault's deposit address. Rescue it first on its own vault page: the rescue moves it to the Bank's multisig, which returns it to whoever sent it in. This page will not open a vault with another vault inside.`)
    else if (n.unreadable) ack.push({ id: `asset:${n.address}`, text: `The deposit address holds an NFT this page could not read (${n.address}). This page does not move NFTs out of a vault, so it is lost when the vault is opened.` })
    else ack.push({ id: `asset:${n.address}`, text: `The deposit address holds an NFT that is not a vault (${n.address}${n.name ? `, "${n.name}"` : ''}). This page does not move NFTs out of a vault, so it is DESTROYED when the vault is opened.` })
  }
  for (const c of s.compressed || []) ack.push({ id: `cnft:${c.address}`, text: `The deposit address owns a compressed NFT (${c.address}). It has no account the opening could name, and after the opening nobody can sign for the vault wallet again, so it is lost for good.` })
  if (s.compressed === null || s.compressedChecked === false) note.push('This check could not look for compressed NFTs (the index that lists them did not answer). A compressed NFT sent to the deposit address would be lost when the vault is opened, and is not shown here.')

  // ── the coverage judgement (bank/detectors.mjs), as a cross-check: everything
  //    it finds uncovered must already be named above, or the page refuses ──
  const judged = judgeRedemptionCoverage(owned, [...covered])
  const named = new Set([...ack.map(a => a.id.split(':').slice(1).join(':')), ...late.map(a => a.address), ...s.nested.filter(n => n.ourVault).map(n => n.address)])
  for (const reason of judged.reasons)
    if (![...named].some(a => a && reason.includes(a))) refuse.push(`The vault holds something this page did not expect, so it will not open it: ${reason.replace(/\s*\u2014\s*/g, ': ')}`)
  // ── round 37 V1: what could not be listed or examined is ONE box, never a refusal ──
  const inc = s.strayReadIncomplete
  if (inc?.unlisted) ack.push({ id: 'unlisted:all', text: `This page could not list the other accounts your vault wallet owns (the network did not answer the listing in full). Your vault's own three accounts were read directly and come to you in full. Anything in an account this page could not list stays there and is lost when the vault is opened. Anyone can create accounts for a vault wallet for a few cents each; it is not something you did.` })
  else if (inc?.unexamined) ack.push({ id: `unlisted:${inc.unexamined}`, text: `Your vault wallet owns ${inc.unexamined} more token ${inc.unexamined === 1 ? 'account' : 'accounts'} than this page examines (it reads at most ${inc.cap} besides your vault's own three). Whatever ${inc.unexamined === 1 ? 'it holds' : 'they hold'} stays there and is lost when the vault is opened. Your vault's own three accounts come to you in full. Anyone can create accounts for a vault wallet for a few cents each; it is not something you did.` })
  // the same for the NFTs: a CBOB vault the page FOUND refuses (above); one it could
  // not look for can still be rescued after the opening (item 58: a vault inside a
  // burned host is rescued to the Bank's multisig), so not looking is a box, never a refusal
  const ninc = s.nftReadIncomplete
  if (ninc?.unlisted) ack.push({ id: 'nfts:unlisted', text: `This page could not check for NFTs inside this vault (the network did not list them in full). Any NFT there is lost when the vault is opened, except a CBOB vault: anyone can then rescue it to the Bank's multisig, which returns it to whoever sent it in.` })
  else if (ninc?.unexamined) ack.push({ id: `nfts:${ninc.unexamined}`, text: `The deposit address holds ${ninc.unexamined} more ${ninc.unexamined === 1 ? 'NFT' : 'NFTs'} than this page examines (it reads at most ${ninc.cap}). Any NFT among them is lost when the vault is opened, except a CBOB vault: anyone can then rescue it to the Bank's multisig, which returns it to whoever sent it in.` })
  // ROUND 38 V38-2: in the final re-plan, a box the holder did not tick is about
  // something that arrived after the check, which the standing consent covers: it is
  // shown as information and never stops the send. Two exceptions still ask: a box
  // about a stray the holder was told would come to them (the dry run dropped it; its
  // id is its own address, so it asks once), and a payout forfeited because Coinbase
  // froze the pool (not a stranger's doing). Nothing is grouped here, so no id can
  // change with what a stranger adds or removes.
  const lateInfo = []
  if (!s.consented) groupAcks(ack)
  else {
    const aboutKnown = a => s.known?.has(a.id.split(':').slice(1).join(':'))
    for (const a of [...ack]) if (!s.consented.has(a.id) && a.id !== 'forfeit' && !aboutKnown(a)) { ack.splice(ack.indexOf(a), 1); lateInfo.push(a.text) }
    if (late.length) lateInfo.push(`${late.length} ${late.length === 1 ? 'token account' : 'token accounts'} arrived at the deposit address after your check (${late.slice(0, 5).map(a => a.address).join(', ')}${late.length > 5 ? ', ...' : ''}). As you agreed, they stay in the vault and are lost when it opens.`)
  }
  for (const m of needOwnerAta) {
    const a = ownerAta(m).toBase58()
    if (!s.ownerAtaExists.has(a)) priorIxs.push({ why: `create your own ${name(m)} account to receive it`, ix: IX.createAtaIdempotent(owner, a, owner, m) })
  }

  // ── the prior transactions, packed ──
  const prior = []
  let cur = []
  for (const p of priorIxs) {
    if (cur.length && legacySize([...cur, p].map(x => x.ix), owner) > PACKET_LIMIT) { prior.push(cur); cur = [] }
    cur.push(p)
  }
  if (cur.length) prior.push(cur)

  if (s.burnConfig && s.mintConfig) {
    const rl = rateLimit(s.burnConfig, s.mintConfig, s.nowSec)
    if (!rl.allowed) note.push(`The hourly opening limit is reached right now (${rl.cap} openings per hour at ${rl.live} sealed vaults). The next opening is possible from ${new Date(rl.nextAt * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC.`)
  }
  return { refuse, ack, note, lateInfo, late: late.map(a => a.address), prior, redemption, size, claim, poolFrozen, owedSats: owed, depositAddress: pda.toBase58(),
    covered: [...covered], helperStrays: hs.map(a => a.address), transferStrays: ts.map(a => a.address), left: left.map(a => a.address),
    coverage: judged }
}

/** ROUND 38 V38-2: the ONE standing consent the holder gives before signing. Its id
 *  carries no address, count or digest, so nothing a stranger lands can change it. */
export const LATE_CONSENT_ID = 'late-arrivals'
export const LATE_CONSENT = 'Anything that arrives at this vault\'s deposit address after this check and before the opening lands is lost when it opens, except cbBTC, $GARY, $GIRAFFISH and SOL in the vault\'s own accounts, which come to you.'

/**
 * The press, as a pure loop (ROUND 38 V38-2), so a stranger landing something new
 * before every re-plan cannot keep it from sending. It re-plans with the holder's
 * ticks (`consented`) and the strays they were told would come to them (`known`):
 * anything newer is left behind under the standing consent and shown as information.
 * It stops only for a refusal, a set-up the re-plan would need, a box the consent does
 * not cover, or a dry run that fails twice. At most OPEN_ATTEMPTS dry runs, no loop.
 *   replan({ dropStrays }) -> plan ; dryRun(plan) -> { err }
 * Returns { ok, plan, sim, dropStrays, stop?, newAcks? }.
 */
export const OPEN_ATTEMPTS = 2

/** Round 39 A2: the warning for a press stopped by new boxes, chosen by WHICH boxes are
 *  new (never by whether the dry run dropped the extras): the pool frozen since the check
 *  (forfeit), and/or a stray the holder was told would come to them that can no longer be
 *  moved (its issuer froze it, the holder's own account for it is gone, or the dry run failed). */
export function pressStopMessage(newAcks, dropStrays) {
  const forfeit = newAcks.some(a => a.id === 'forfeit'), strays = newAcks.some(a => a.id !== 'forfeit')
  return [forfeit ? 'Coinbase has frozen the Bank\'s payout pool since the check, so the payout owed to this vault would be given up.' : null,
    strays ? (dropStrays ? 'The dry run failed while taking out the extra tokens sent into your vault, so they are now left behind.'
      : 'Something this page was going to take out to you can no longer be moved, so it is now left behind.') : null,
    `${newAcks.length === 1 ? 'It is' : 'They are'} listed above. Tick ${newAcks.length === 1 ? 'it' : 'them'}, then press the button again. Nothing was opened.`].filter(Boolean).join(' ')
}
export async function prepareOpening({ replan, dryRun, consented, dropStrays = false }) {
  let plan = null, sim = null
  for (let attempt = 0; attempt < OPEN_ATTEMPTS; attempt++) {
    plan = await replan({ dropStrays })
    if (plan.refuse.length) return { ok: false, stop: 'refuse', plan, dropStrays }
    if (plan.prior.length) return { ok: false, stop: 'prior', plan, dropStrays }
    const newAcks = plan.ack.filter(a => !consented.has(a.id))
    if (newAcks.length) return { ok: false, stop: 'ack', plan, newAcks, dropStrays }
    sim = await dryRun(plan)
    if (!sim.err) return { ok: true, plan, sim, dropStrays }
    // the opening carried extra tokens: one of them may be what failed. Leave them all behind once.
    if (dropStrays || !(plan.helperStrays.length || plan.transferStrays.length)) break
    dropStrays = true
  }
  return { ok: false, stop: 'dry-run', plan, sim, dropStrays }
}

/** Round 37 V1: more than STRAY_GROUP_OVER boxes for things left behind become ONE
 *  box with the count and the first STRAY_GROUP_OVER listed. Its id carries the count
 *  and a digest of every address in it, so anything new arriving later is a new box. */
export const STRAY_GROUP_OVER = 20
const GROUPED = ['lost', 'left', 'asset', 'cnft']
const fnv = str => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(16).padStart(8, '0') }
function groupAcks(ack) {
  const many = ack.filter(a => GROUPED.includes(a.id.split(':')[0]))
  if (many.length <= STRAY_GROUP_OVER) return
  const kinds = { lost: 0, left: 0, asset: 0, cnft: 0 }
  for (const a of many) kinds[a.id.split(':')[0]]++
  const parts = [kinds.lost && `${kinds.lost} token ${kinds.lost === 1 ? 'account' : 'accounts'} this page cannot take out`,
    kinds.left && `${kinds.left} that do not fit in the opening`, kinds.asset && `${kinds.asset} ${kinds.asset === 1 ? 'NFT' : 'NFTs'}`,
    kinds.cnft && `${kinds.cnft} compressed ${kinds.cnft === 1 ? 'NFT' : 'NFTs'}`].filter(Boolean)
  const keep = ack.filter(a => !many.includes(a))
  ack.length = 0
  ack.push(...keep, { id: `group:${many.length}:${fnv(many.map(a => a.id).join(','))}`, covers: many.map(a => a.id),
    text: `Your vault wallet holds ${many.length} things that stay behind and are lost when the vault is opened: ${parts.join(', ')}. Anyone can send things to a vault wallet; it is not something you did. Your vault's own three accounts come to you in full. The first ${STRAY_GROUP_OVER} are listed below.`,
    list: many.slice(0, STRAY_GROUP_OVER).map(a => a.text), more: many.length - STRAY_GROUP_OVER })
}

/**
 * "RUN A PAYOUT" (review round 36 L2), the way the crank and the suite run one:
 *   1. expire every DUE $CBOB boost (MINT refuses a payout otherwise: BoostsExpireFirst),
 *   2. join every vault waiting from an earlier payout (JoinWaitingFirst),
 *   3. distribute, burning exactly 100 $GARY of the burner's.
 * Each group is one legacy transaction; returns { ok, refuse[], groups: ix[][] }.
 */
export const EXPIRE_BATCH = 20, JOIN_BATCH = 14
export function planPayout(ids, { mintConfig: c, waiting, dueRecords, burner, garyMint }) {
  const refuse = []
  const due = BigInt(c.boosts_due), wait = BigInt(c.pending_count) - BigInt(c.pending_this_epoch)
  if (BigInt(dueRecords.length) !== due) refuse.push(`Found ${dueRecords.length} of the ${due} boosts that are due; a payout would be refused until every one is expired. Nothing was sent.`)
  if (BigInt(waiting.length) !== wait) refuse.push(`Found ${waiting.length} of the ${wait} vaults waiting to join; a payout would be refused. Nothing was sent.`)
  if (refuse.length) return { ok: false, refuse, groups: [] }
  const pool = new PublicKey(c.pool_ata), groups = []
  for (let i = 0; i < dueRecords.length; i += EXPIRE_BATCH) groups.push([IX.expireBoosts(ids, dueRecords.slice(i, i + EXPIRE_BATCH).map(r => new PublicKey(r)))])
  for (let i = 0; i < waiting.length; i += JOIN_BATCH) groups.push([IX.poolClaim(ids, pool, waiting.slice(i, i + JOIN_BATCH).map(r => ({ asset: new PublicKey(r.asset), dest: new PublicKey(r.vault_ata) })))])
  groups.push([IX.distribute(ids, pool, new PublicKey(burner), new PublicKey(garyMint))])
  for (const g of groups) if (legacySize(g, burner) > PACKET_LIMIT) return { ok: false, refuse: ['A payout step does not fit one transaction. Nothing was sent.'], groups: [] }
  return { ok: true, refuse, groups }
}
