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

/** Ask the wallet to sign; refuse if it changed the message. `extra` are
 *  keypairs made in this page (a new vault's or collection's address), which
 *  sign AFTER the wallet, so the wallet sees exactly the message the page built. */
export async function signExact(wallet, tx, extra = []) {
  const want = Buffer.from(tx.serializeMessage())
  const signed = await wallet.signTransaction(tx)
  const got = Buffer.from(signed.serializeMessage())
  if (!got.equals(want)) throw new Error('The wallet changed the transaction before signing it (it added or altered an instruction). For your safety the page did not send it.')
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
