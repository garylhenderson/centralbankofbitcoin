/**
 * Build, simulate, sign and send. The wallet only SIGNS: the page sends through
 * its own configured connection, so the same code works on every cluster.
 *
 * After the wallet signs, the page REFUSES to send unless every instruction it built
 * survives byte for byte, in order, and the wallet added only what judgeWalletEdits
 * allows (Lighthouse checks; a bounded compute budget only where the page set none).
 */
import { PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from '@solana/web3.js'
import { Buffer } from './enc.mjs'
import { PACKET_LIMIT } from './plan-redeem.mjs'
import ERRORS from '../generated/errors.json' with { type: 'json' }

export async function buildTx(conn, ixs, feePayer) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed')
  const tx = new Transaction({ feePayer: new PublicKey(feePayer), blockhash, lastValidBlockHeight }).add(...ixs)
  const size = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length
  if (size > PACKET_LIMIT) throw new Error(`the transaction is ${size} bytes, over the ${PACKET_LIMIT} limit`)
  return { tx, size, blockhash, lastValidBlockHeight }
}

/** Plain-English name of a program error, from the programs' own #[error_code] lists. */
let PROGRAM_NAMES = {}
/** { programId base58: 'seal' | 'mint' | 'burn' | 'gov' } from the profile. */
export function setProgramNames(programs) { PROGRAM_NAMES = Object.fromEntries(Object.entries(programs).filter(([, v]) => v).map(([k, v]) => [v, k])) }
export function explainError(err, tx) {
  if (!err) return null
  const ie = err.InstructionError
  if (!ie) return typeof err === 'string' ? err : JSON.stringify(err)
  const [idx, e] = ie
  const prog = tx?.instructions?.[idx]?.programId?.toBase58?.()
  if (e && typeof e === 'object' && 'Custom' in e) {
    const code = e.Custom
    const list = prog && PROGRAM_NAMES[prog] ? ERRORS[PROGRAM_NAMES[prog]] : null
    if (list && code >= 6000 && list[code - 6000]) return `step ${idx + 1} was refused: ${list[code - 6000].message} (${list[code - 6000].name})`
    return `step ${idx + 1} was refused with error ${code}`
  }
  return `step ${idx + 1} failed: ${typeof e === 'string' ? e : JSON.stringify(e)}`
}

/** Simulate WITHOUT signatures, returning the post-state of `watch` accounts.
 *  Round 46 (Gary on the hosted rehearsal page: "BlockhashNotFound"): the dry run judges
 *  OUTCOMES, never the blockhash, so it asks the node to use its own latest one. Behind a
 *  load-balanced RPC the simulating node may not yet know the blockhash the page fetched a
 *  moment ago from another node. The transaction the wallet signs and the page sends keeps
 *  the page's own blockhash; only the dry run substitutes. */
export const DRY_RUN_OPTS = { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }
export async function simulate(conn, tx, watch = []) {
  const vtx = new VersionedTransaction(tx.compileMessage())
  const r = await conn.simulateTransaction(vtx, { ...DRY_RUN_OPTS,
    accounts: watch.length ? { encoding: 'base64', addresses: watch.map(a => new PublicKey(a).toBase58()) } : undefined })
  const v = r.value
  return { err: v.err, explained: explainError(v.err, tx), logs: v.logs || [], unitsConsumed: v.unitsConsumed ?? null,
    accounts: (v.accounts || []).map(a => a ? { lamports: a.lamports, owner: a.owner, data: Buffer.from(a.data[0], 'base64') } : null) }
}

/** WHAT A WALLET MAY ADD (round 46, found on the hosted rehearsal page and MEASURED on a
 *  local chain with the real Lighthouse program; web/test/e2e-localnet.mjs).
 *
 *  Phantom returned every ceremony transaction as [compute-budget limit 200,000,
 *  compute-budget price, Lighthouse checks, <the page's instructions>, Lighthouse check].
 *  Measured with the real programs, every holder transaction wrapped that way is accepted,
 *  including the crack: SEAL's and BURN's walks of the instruction list find their pair
 *  wherever the wallet's instructions sit. BUT Phantom's fixed 200,000-CU limit is below
 *  what a claim-first crack needs (194,694 CU measured, about 207,500 with Lighthouse), so
 *  the page sets ITS OWN compute budget whenever it fits (withComputeBudget); Phantom
 *  documents that it adds no priority fee to a transaction that already has one.
 *
 *  The judge, for every page: every instruction the page built (its own compute budget
 *  included) is still there, in order, byte for byte, with the work as one unbroken block
 *  (the wallet's additions before and after it, the shape measured); the only additions are Lighthouse
 *  checks and, ONLY when the page set no budget, a wallet budget whose limit is at least
 *  what the page measured (`minUnits`) and whose fee is bounded; the fee payer and blockhash
 *  are unchanged; no signer and no writable account was added, and none the page made a
 *  signer or writable lost that role (round 47, V47-5: a wallet demoting an account to
 *  read-only passed). Anything else is refused, naming what changed. */
export const CB_PROGRAM = 'ComputeBudget111111111111111111111111111111'
export const LIGHTHOUSE_PROGRAM = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'
export const WALLET_ADDABLE = { [CB_PROGRAM]: 'compute budget', [LIGHTHOUSE_PROGRAM]: 'Lighthouse (the wallet\'s guard)' }
export const MAX_WALLET_PRIORITY_LAMPORTS = 10_000_000 // 0.01 SOL
/** The page's own budget: what the dry run measured, +10%, + room for a wallet's Lighthouse
 *  checks (measured at up to 12,825 CU for six before-checks and the after-check). */
export const LIGHTHOUSE_CU_ALLOWANCE = 20_000
export const PAGE_CU_PRICE = 100_000 // micro-lamports per CU: 0.00002 SOL at 200,000 CU
const sameIx = (a, b) => a.programId.equals(b.programId) && Buffer.from(a.data).equals(Buffer.from(b.data))
  && a.keys.length === b.keys.length && a.keys.every((k, i) => k.pubkey.equals(b.keys[i].pubkey))
const roles = tx => { const m = tx.compileMessage(), h = m.header, n = m.accountKeys.length
  const signers = new Set(), writable = new Set()
  m.accountKeys.forEach((k, i) => { const b = k.toBase58()
    if (i < h.numRequiredSignatures) signers.add(b)
    if (i < h.numRequiredSignatures - h.numReadonlySignedAccounts || (i >= h.numRequiredSignatures && i < n - h.numReadonlyUnsignedAccounts)) writable.add(b) })
  return { signers, writable } }
const isCb = ix => ix.programId.toBase58() === CB_PROGRAM, isLh = ix => ix.programId.toBase58() === LIGHTHOUSE_PROGRAM
const u32le = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }, u64le = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
export const cbLimitIx = n => new TransactionInstruction({ programId: new PublicKey(CB_PROGRAM), keys: [], data: Buffer.concat([Buffer.from([2]), u32le(n)]) })
export const cbPriceIx = n => new TransactionInstruction({ programId: new PublicKey(CB_PROGRAM), keys: [], data: Buffer.concat([Buffer.from([3]), u64le(n)]) })
export const pageUnits = measured => Math.min(1_400_000, Math.ceil(Number(measured || 0) * 1.1) + LIGHTHOUSE_CU_ALLOWANCE)
/** The page's own compute budget in front of `ixs`, IF the transaction still fits the
 *  packet; otherwise `ixs` unchanged (a wallet's budget cannot fit either, so the cluster's
 *  default per-instruction budget applies). Never added twice. */
export function withComputeBudget(ixs, measuredUnits, feePayer) {
  if (ixs.some(isCb)) return ixs
  const withCb = [cbLimitIx(pageUnits(measuredUnits)), cbPriceIx(PAGE_CU_PRICE), ...ixs]
  const t = new Transaction({ feePayer: new PublicKey(feePayer), recentBlockhash: '11111111111111111111111111111111' }).add(...withCb)
  const m = t.compileMessage()
  return 1 + 64 * m.header.numRequiredSignatures + m.serialize().length <= PACKET_LIMIT ? withCb : ixs
}
export function judgeWalletEdits(want, got, opts = {}) {
  const bad = []
  if (!got.feePayer || !want.feePayer || !got.feePayer.equals(want.feePayer)) bad.push('the fee payer changed')
  if (got.recentBlockhash !== want.recentBlockhash) bad.push('the blockhash changed')
  const pageSetBudget = want.instructions.some(isCb)
  // the page's own instructions, its own compute budget included, must survive byte for byte
  const keep = ix => !isLh(ix) && !(isCb(ix) && !pageSetBudget)
  const ours = got.instructions.filter(keep), added = got.instructions.filter(ix => !keep(ix))
  // measured shape: the wallet's additions sit BEFORE and AFTER the page's work, never inside
  // it (the page's own compute budget is read by the runtime wherever it sits, so a wallet
  // that slips its guard in after the page's budget is still the measured shape)
  const at = got.instructions.map((ix, i) => keep(ix) && !isCb(ix) ? i : -1).filter(i => i >= 0)
  if (at.length && at[at.length - 1] - at[0] + 1 !== at.length) bad.push('the wallet put instructions in between the page\'s own')
  if (ours.length !== want.instructions.length || !ours.every((ix, i) => sameIx(ix, want.instructions[i]))) {
    const foreign = ours.filter(ix => !want.instructions.some(w => sameIx(ix, w))).map(ix => ix.programId.toBase58())
    bad.push(foreign.length ? `the wallet added or changed instructions the page does not allow (${[...new Set(foreign)].join(', ')})` : 'the instructions the page built were changed, removed or reordered')
  }
  const a = roles(want), b = roles(got)
  for (const k of b.signers) if (!a.signers.has(k)) bad.push(`the wallet added a signer ${k}`)
  for (const k of b.writable) if (!a.writable.has(k)) bad.push(`the wallet made ${k} writable`)
  for (const k of a.signers) if (!b.signers.has(k)) bad.push(`the wallet removed the signer ${k}`)
  for (const k of a.writable) if (!b.writable.has(k)) bad.push(`the wallet made ${k} read-only`)
  let limit = null, price = 0n
  for (const ix of added.filter(isCb)) {
    const d = Buffer.from(ix.data)
    if (d[0] === 2 && d.length >= 5) limit = d.readUInt32LE(1)
    else if (d[0] === 3 && d.length >= 9) price = d.readBigUInt64LE(1)
    else bad.push(`a compute-budget instruction the page does not allow (kind ${d[0]})`)
  }
  if (limit !== null && opts.minUnits && limit < opts.minUnits)
    bad.push(`the wallet set a compute limit of ${limit}, below the ${opts.minUnits} this transaction needs, so it would fail on the network`)
  // with no limit set, the cluster's default is 200,000 per instruction that is not a compute-budget one
  const fee = price * BigInt(limit ?? Math.min(1_400_000, 200_000 * got.instructions.filter(ix => !isCb(ix)).length)) / 1_000_000n
  if (fee > BigInt(MAX_WALLET_PRIORITY_LAMPORTS)) bad.push(`the wallet's priority fee would be ${Number(fee) / 1e9} SOL, over the ${MAX_WALLET_PRIORITY_LAMPORTS / 1e9} SOL the page allows`)
  return { bad, added: added.map(ix => WALLET_ADDABLE[ix.programId.toBase58()]) }
}

/** Ask the wallet to sign; refuse if it changed the message beyond what judgeWalletEdits
 *  allows. `extra` are keypairs made in this page (a new vault's or collection's address),
 *  which sign AFTER the wallet, so they sign exactly the message the wallet returned.
 *  `opts.minUnits`: the compute the page measured (pageUnits of its dry run). */
export async function signExact(wallet, tx, extra = [], opts = {}) {
  const want = Buffer.from(tx.serializeMessage())
  const wantTx = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }))
  const signed = await wallet.signTransaction(tx)
  const got = Buffer.from(signed.serializeMessage())
  if (!got.equals(want)) {
    const j = judgeWalletEdits(wantTx, signed, opts)
    if (j.bad.length) throw new Error(`The wallet changed the transaction in a way the page does not allow, so nothing was sent: ${j.bad.join('; ')}.`)
  }
  if (!signed.verifySignatures(false)) throw new Error('The wallet returned a transaction whose signatures do not verify. Nothing was sent.')
  for (const k of extra) signed.partialSign(k)
  if (!signed.verifySignatures(true)) throw new Error('The transaction is missing a signature. Nothing was sent.')
  return signed
}

/** The holder pages' one path: dry-run the page's instructions, then build the transaction
 *  the wallet will see, with the page's own compute budget when it fits. Returns what
 *  buildTx returns plus the dry run and the `minUnits` to hand signExact. */
export async function buildForWallet(conn, ixs, feePayer, watch = []) {
  const bare = await buildTx(conn, ixs, feePayer)
  const sim = await simulate(conn, bare.tx, watch)
  if (sim.err) return { ...bare, sim, minUnits: null }
  const minUnits = pageUnits(sim.unitsConsumed)
  const withCb = withComputeBudget(ixs, sim.unitsConsumed, feePayer)
  if (withCb === ixs) return { ...bare, sim, minUnits, budgeted: false }
  // the transaction the holder signs is the budgeted one, so its dry run is the one shown
  const built = await buildTx(conn, withCb, feePayer)
  return { ...built, sim: await simulate(conn, built.tx, watch), minUnits, budgeted: true }
}

/** Round 46: the node's PREFLIGHT can lag the blockhash the page fetched from another node
 *  behind the same load balancer ("Blockhash not found"). The same signed bytes are sent
 *  again, a few times, a second apart: one signature, so it can land at most once. Any
 *  other refusal is thrown at once. */
export const SEND_BLOCKHASH_RETRIES = 4
export async function sendRaw(conn, raw, wait = ms => new Promise(r => setTimeout(r, ms))) {
  for (let i = 0; ; i++) {
    try { return await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 5 }) }
    catch (e) { if (i >= SEND_BLOCKHASH_RETRIES || !/blockhash ?not ?found/i.test(String(e?.message || e))) throw e; await wait(1000) }
  }
}

/** Send, then confirm by POLLING signature status (no websocket: the page's
 *  Content-Security-Policy allows only its https RPC), until the blockhash
 *  expires. A transaction the cluster never confirmed is reported as such. */
export async function sendSigned(conn, signed, blockhash, lastValidBlockHeight) {
  const sig = await sendRaw(conn, signed.serialize())
  for (;;) {
    const st = (await conn.getSignatureStatuses([sig])).value[0]
    if (st?.err) throw Object.assign(new Error(explainError(st.err, signed) || 'the transaction failed'), { signature: sig })
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig
    if ((await conn.getBlockHeight('confirmed')) > lastValidBlockHeight)
      throw Object.assign(new Error(`The network did not confirm the transaction in time (${sig}). Check it before trying again.`), { signature: sig })
    await new Promise(r => setTimeout(r, 1000))
  }
}
