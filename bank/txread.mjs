/** Read legacy/v0/v1 history without changing the shared web3.js installation.
 * Its parsed-response schema accepts only legacy/v0, even when the RPC opts in
 * to v1. jsonParsed supplies resolved string keys for all three formats; the
 * consumers already accept those strings. Preserve version/config verbatim.
 * Unknown versions, malformed responses and RPC errors throw before a caller
 * can advance its cursor or close a revenue cycle. No signing or sending here.
 */
import { PublicKey } from '@solana/web3.js'

const object = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const uint = x => Number.isSafeInteger(x) && x >= 0
const need = (ok, field) => { if (!ok) throw new Error(`unreadable parsed transaction: ${field}`) }
const key = x => {
  if (typeof x !== 'string') return false
  try { return new PublicKey(x).toBase58() === x } catch { return false }
}

export function validateParsedTransaction(tx, signature) {
  if (tx === null) return null
  need(object(tx) && ['legacy', 0, 1].includes(tx.version), 'version')
  need(uint(tx.slot), 'slot')
  need(tx.blockTime === null || uint(tx.blockTime), 'blockTime')
  const t = tx.transaction, m = t?.message, meta = tx.meta
  need(object(t) && Array.isArray(t.signatures) && t.signatures.length > 0
    && t.signatures.every(s => typeof s === 'string') && t.signatures[0] === signature, 'signature')
  need(object(m) && key(m.recentBlockhash) && Array.isArray(m.accountKeys) && m.accountKeys.length > 0, 'message')
  need(m.accountKeys.every(k => object(k) && key(k.pubkey) && typeof k.signer === 'boolean'
    && typeof k.writable === 'boolean' && (k.source === undefined || ['transaction', 'lookupTable'].includes(k.source))), 'accountKeys')
  const keys = new Set(m.accountKeys.map(k => k.pubkey))
  need(keys.size === m.accountKeys.length && m.accountKeys[0].signer && m.accountKeys[0].writable, 'fee payer/account keys')
  if (tx.version === 1) {
    need(object(m.transactionConfig), 'v1 transactionConfig')
    need(m.accountKeys.every(k => k.source !== 'lookupTable'), 'v1 lookup-table key')
  }
  const instruction = ix => {
    need(object(ix) && key(ix.programId) && keys.has(ix.programId), 'instruction program')
    if ('parsed' in ix) {
      need(typeof ix.program === 'string' && (typeof ix.parsed === 'string'
        || (object(ix.parsed) && typeof ix.parsed.type === 'string')), 'parsed instruction')
      // Memo payloads are strings. System/token payloads feed the money-path
      // detectors and must carry their structured info rather than vanish.
      if (['11111111111111111111111111111111',
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
        'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'].includes(ix.programId))
        need(object(ix.parsed) && object(ix.parsed.info), 'parsed money instruction')
      const info = ix.parsed?.info, kind = ix.parsed?.type
      const amount = a => typeof a === 'string' && /^\d+$/.test(a)
      if (['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'].includes(ix.programId)) {
        if (['transfer', 'transferChecked', 'approve', 'approveChecked'].includes(kind)) {
          need(key(info.source) && key(kind.startsWith('transfer') ? info.destination : info.delegate), 'token movement accounts')
          need(kind.endsWith('Checked')
            ? object(info.tokenAmount) && amount(info.tokenAmount.amount) && uint(info.tokenAmount.decimals) && info.tokenAmount.decimals <= 255
            : amount(info.amount), 'token movement amount')
        }
        if (/^initializeAccount/.test(kind)) need(key(info.account) && key(info.owner), 'token account creation')
      }
      if (ix.programId === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
        && ['create', 'createIdempotent'].includes(kind)) need(key(info.account) && key(info.wallet), 'ATA creation')
    }
    else need(Array.isArray(ix.accounts) && ix.accounts.every(k => key(k) && keys.has(k))
      && typeof ix.data === 'string' && /^[1-9A-HJ-NP-Za-km-z]*$/.test(ix.data), 'raw instruction')
  }
  need(Array.isArray(m.instructions), 'instructions')
  m.instructions.forEach(instruction)
  // Metadata is required for monitoring. A null metadata result is unknown,
  // not a successful scan with no transfers or events.
  need(object(meta) && 'err' in meta && (meta.err === null || typeof meta.err === 'string' || object(meta.err)), 'metadata/error')
  need(uint(meta.fee), 'fee')
  for (const name of ['preBalances', 'postBalances']) need(Array.isArray(meta[name])
    && meta[name].length === m.accountKeys.length && meta[name].every(v => Number.isFinite(v) && v >= 0), name)
  need(Array.isArray(meta.logMessages) && meta.logMessages.every(s => typeof s === 'string'), 'logs')
  // The runtime marker means subsequent events may be missing, even on success.
  // A program's own `Program log: Log truncated` is ordinary text, not this marker.
  need(!meta.logMessages.includes('Log truncated'), 'logs truncated by runtime')
  {
    need(Array.isArray(meta.innerInstructions), 'innerInstructions')
    for (const group of meta.innerInstructions) {
      need(object(group) && uint(group.index) && group.index < m.instructions.length && Array.isArray(group.instructions), 'inner instruction group')
      group.instructions.forEach(instruction)
    }
  }
  for (const name of ['preTokenBalances', 'postTokenBalances']) {
    need(Array.isArray(meta[name]), name)
    for (const b of meta[name]) need(object(b) && uint(b.accountIndex) && b.accountIndex < m.accountKeys.length
      && key(b.mint) && (b.owner === undefined || key(b.owner))
      && (b.programId === undefined || key(b.programId)) && object(b.uiTokenAmount)
      && typeof b.uiTokenAmount.amount === 'string' && /^\d+$/.test(b.uiTokenAmount.amount)
      && uint(b.uiTokenAmount.decimals) && b.uiTokenAmount.decimals <= 255, name)
  }
  return tx
}

export async function readParsedTransaction(conn, signature) {
  // This is the installed SDK's transport only, not its version-limited result
  // decoder. It retains the connection's configured RPC headers and retry path.
  if (typeof conn?._rpcRequest !== 'function') throw new Error('transaction RPC transport unavailable')
  const answer = await conn._rpcRequest('getTransaction', [signature,
    { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }])
  if (answer?.error) throw new Error(`getTransaction RPC error ${answer.error.code}: ${answer.error.message}`)
  need(object(answer) && Object.hasOwn(answer, 'result'), 'RPC envelope')
  return validateParsedTransaction(answer.result, signature)
}
