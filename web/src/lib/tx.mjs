/**
 * Build, simulate, sign and send. The wallet only SIGNS: the page sends through
 * its own configured connection, so the same code works on every cluster.
 *
 * After the wallet signs, the page REFUSES to send unless the signed message is
 * byte-for-byte the message it built and simulated. A wallet that adds or
 * reorders an instruction (some add "guard" instructions) would change what
 * BURN and SEAL see, and could push a redemption over the packet limit.
 */
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
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

/** Simulate WITHOUT signatures, returning the post-state of `watch` accounts. */
export async function simulate(conn, tx, watch = []) {
  const vtx = new VersionedTransaction(tx.compileMessage())
  const r = await conn.simulateTransaction(vtx, { sigVerify: false, replaceRecentBlockhash: false, commitment: 'confirmed',
    accounts: watch.length ? { encoding: 'base64', addresses: watch.map(a => new PublicKey(a).toBase58()) } : undefined })
  const v = r.value
  return { err: v.err, explained: explainError(v.err, tx), logs: v.logs || [], unitsConsumed: v.unitsConsumed ?? null,
    accounts: (v.accounts || []).map(a => a ? { lamports: a.lamports, owner: a.owner, data: Buffer.from(a.data[0], 'base64') } : null) }
}

/** WHAT A WALLET MAY ADD, AND ONLY ON THE CEREMONY (round 46, found on the hosted
 *  rehearsal page: Phantom added instructions to step 0 and the page refused it).
 *  Phantom adds compute-budget instructions (a priority fee) and Lighthouse guard
 *  assertions. They are allowed ONLY where `allowWalletAdditions` is passed (the
 *  ceremony's own steps, which carry no SEAL or BURN instruction: those programs read
 *  the instruction list, so a transaction holding either stays byte-exact), and only if
 *  every instruction the page built is still there, in order, byte for byte; the fee
 *  payer and blockhash are unchanged; no signer and no writable account was added; and
 *  the priority fee is bounded. Anything else is refused, naming what was added. */
export const WALLET_ADDABLE = { ComputeBudget111111111111111111111111111111: 'compute budget', L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95: 'Lighthouse (the wallet\'s guard)' }
export const MAX_WALLET_PRIORITY_LAMPORTS = 10_000_000 // 0.01 SOL
const sameIx = (a, b) => a.programId.equals(b.programId) && Buffer.from(a.data).equals(Buffer.from(b.data))
  && a.keys.length === b.keys.length && a.keys.every((k, i) => k.pubkey.equals(b.keys[i].pubkey))
const roles = tx => { const m = tx.compileMessage(), h = m.header, n = m.accountKeys.length
  const signers = new Set(), writable = new Set()
  m.accountKeys.forEach((k, i) => { const b = k.toBase58()
    if (i < h.numRequiredSignatures) signers.add(b)
    if (i < h.numRequiredSignatures - h.numReadonlySignedAccounts || (i >= h.numRequiredSignatures && i < n - h.numReadonlyUnsignedAccounts)) writable.add(b) })
  return { signers, writable } }
export function judgeWalletEdits(want, got, programs = {}) {
  const bad = []
  const crack = new Set([programs.seal, programs.burn].filter(Boolean))
  if (want.instructions.some(ix => crack.has(ix.programId.toBase58()))) bad.push('this transaction carries a SEAL or BURN instruction, which must reach the program exactly as built')
  if (!got.feePayer || !want.feePayer || !got.feePayer.equals(want.feePayer)) bad.push('the fee payer changed')
  if (got.recentBlockhash !== want.recentBlockhash) bad.push('the blockhash changed')
  const ours = [], added = []
  for (const ix of got.instructions) (WALLET_ADDABLE[ix.programId.toBase58()] ? added : ours).push(ix)
  if (ours.length !== want.instructions.length || !ours.every((ix, i) => sameIx(ix, want.instructions[i]))) {
    const foreign = ours.filter(ix => !want.instructions.some(w => sameIx(ix, w))).map(ix => ix.programId.toBase58())
    bad.push(foreign.length ? `the wallet added instructions for programs the page does not allow: ${[...new Set(foreign)].join(', ')}` : 'the instructions the page built were changed, removed or reordered')
  }
  const a = roles(want), b = roles(got)
  for (const k of b.signers) if (!a.signers.has(k)) bad.push(`the wallet added a signer ${k}`)
  for (const k of b.writable) if (!a.writable.has(k)) bad.push(`the wallet made ${k} writable`)
  let limit = 200_000 * Math.max(1, ours.length), price = 0n
  for (const ix of added) {
    if (ix.programId.toBase58() !== 'ComputeBudget111111111111111111111111111111') continue
    const d = Buffer.from(ix.data)
    if (d[0] === 2 && d.length >= 5) limit = d.readUInt32LE(1)
    else if (d[0] === 3 && d.length >= 9) price = d.readBigUInt64LE(1)
    else bad.push(`a compute-budget instruction the page does not allow (kind ${d[0]})`)
  }
  const fee = price * BigInt(limit) / 1_000_000n
  if (fee > BigInt(MAX_WALLET_PRIORITY_LAMPORTS)) bad.push(`the wallet's priority fee would be ${Number(fee) / 1e9} SOL, over the ${MAX_WALLET_PRIORITY_LAMPORTS / 1e9} SOL the page allows`)
  return { bad, added: added.map(ix => WALLET_ADDABLE[ix.programId.toBase58()]) }
}

/** Ask the wallet to sign; refuse if it changed the message. `extra` are
 *  keypairs made in this page (a new vault's or collection's address), which
 *  sign AFTER the wallet, so the wallet sees exactly the message the page built.
 *  `opts.allowWalletAdditions` (the ceremony only) accepts judgeWalletEdits' list. */
export async function signExact(wallet, tx, extra = [], opts = {}) {
  const want = Buffer.from(tx.serializeMessage())
  const wantTx = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }))
  const signed = await wallet.signTransaction(tx)
  const got = Buffer.from(signed.serializeMessage())
  if (!got.equals(want)) {
    if (!opts.allowWalletAdditions) throw new Error('The wallet changed the transaction before signing it (it added or altered an instruction). For your safety the page did not send it.')
    const j = judgeWalletEdits(wantTx, signed, opts.programs)
    if (j.bad.length) throw new Error(`The wallet changed the transaction in a way the page does not allow, so nothing was sent: ${j.bad.join('; ')}.`)
  }
  if (!signed.verifySignatures(false)) throw new Error('The wallet returned a transaction whose signatures do not verify. Nothing was sent.')
  for (const k of extra) signed.partialSign(k)
  if (!signed.verifySignatures(true)) throw new Error('The transaction is missing a signature. Nothing was sent.')
  return signed
}

/** Send, then confirm by POLLING signature status (no websocket: the page's
 *  Content-Security-Policy allows only its https RPC), until the blockhash
 *  expires. A transaction the cluster never confirmed is reported as such. */
export async function sendSigned(conn, signed, blockhash, lastValidBlockHeight) {
  const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 5 })
  for (;;) {
    const st = (await conn.getSignatureStatuses([sig])).value[0]
    if (st?.err) throw Object.assign(new Error(explainError(st.err, signed) || 'the transaction failed'), { signature: sig })
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig
    if ((await conn.getBlockHeight('confirmed')) > lastValidBlockHeight)
      throw Object.assign(new Error(`The network did not confirm the transaction in time (${sig}). Check it before trying again.`), { signature: sig })
    await new Promise(r => setTimeout(r, 1000))
  }
}
