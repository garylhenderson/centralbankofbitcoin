import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Transaction, VersionedTransaction } from '@solana/web3.js'
import { withLock, readLedger, writeLedger } from './lock.mjs'
import { inRehearsalTree } from './rehearsal-env.mjs'
import { garyModule } from './ops-runtime.mjs'
import { profile } from '../web/src/config.js'

const STATE = '/var/lib/cbob-ops'

export class WorkerDeferred extends Error {
  constructor(kind, priorSignature = null) {
    super('Current worker transaction was not submitted; ' + (kind === 'busy' ? 'another lane is sending' : 'earlier attempt requires reconciliation/replanning'))
    this.name = 'WorkerDeferred'
    this.kind = kind
    this.noCurrentSend = true
    this.priorSignature = priorSignature
  }
}
export async function payerLease(file, fn, { waitMs = 15000, lock = withLock, delay = ms => new Promise(r => setTimeout(r, ms)), now = Date.now } = {}) {
  const deadline = now() + waitMs
  for (;;) {
    try { return await lock(file, fn) }
    catch (e) {
      if (e.code !== 'ELOCKED') throw e
      if (now() >= deadline) throw new WorkerDeferred('busy')
      await delay(250)
    }
  }
}
export async function reconcileAttempts(ledger, save, api) {
  const pending = ledger.attempts.filter(a => !['landed', 'failed', 'expired'].includes(a.outcome?.status))
  for (const a of pending) {
    a.outcome = await api.resolveRecordedSend({ signature: a.signature, blockhash: a.blockhash,
      last_valid_block_height: a.lastValidBlockHeight, created_at: a.created_at }, 20000)
    save()
  }
  return pending
}
export async function reconcileWorker(conn, payer) {
  if (inRehearsalTree()) return false
  const file = `${STATE}/send-${payer}.json`, marker = file + '.written'
  try { return await payerLease(file + '.lock', async () => {
    const ledger = readLedger(file, { version: 1, attempts: [] }, marker)
    if (!ledger.attempts.some(a => !['landed', 'failed', 'expired'].includes(a.outcome?.status))) return false
    if (await conn.getGenesisHash() !== profile('mainnet').expectedGenesisHash) throw new Error('Wrong reconciliation network')
    const api = await garyModule('src/lib/solana-confirm.ts')
    const pending = await reconcileAttempts(ledger, () => writeLedger(file, ledger, marker), api)
    if (pending.some(a => a.outcome.status === 'unknown')) throw new WorkerDeferred('unknown', pending[0].signature)
    return 'reconciled'
  }) } catch (e) {
    if (e.noCurrentSend && e.kind === 'busy') return 'busy'
    throw e
  }
}

export async function guardedAttempt({ ledger, save, api, build }) {
  const pending = await reconcileAttempts(ledger, save, api)
  if (pending.length) {
    throw new WorkerDeferred(pending.some(a => a.outcome.status === 'unknown') ? 'unknown' : 'replan', pending[0].signature)
  }
  const a = await build()
  try {
  ledger.attempts.push(a)
  save()
  try {
    a.outcome = await api.landAndAwait(Buffer.from(a.raw, 'base64'), { label: 'CBOB permissionless operations', intent: a.intent,
      lastValidBlockHeight: a.lastValidBlockHeight, skipPreflight: false, budgetMs: 60000 })
  } catch {
    a.outcome = { status: 'unknown', signature: a.signature, reason: 'send guard interrupted; reconcile this exact attempt' }
  }
  save()
  if (a.outcome.status !== 'landed') {
    const e = new api.TxNotLandedError(a.outcome, 'CBOB operations')
    e.transactionSignature = a.signature
    if (a.outcome.status === 'failed') {
      e.logs = a.outcome.err?.logs || []
      if (api.failureLogs) {
        try { e.logs = await api.failureLogs(a) } catch { /* unavailable logs never invent a benign refusal */ }
      }
    }
    throw e
  }
  if (a.outcome.signature !== a.signature) throw new Error('Worker intent resolved to unexpected signature')
  return a
  } catch (e) {
    // Even a disk failure after a successful send belongs to THIS attempt.
    // Never attach a prior attempt here (those defer before build() above).
    if (!e.signature) e.signature = a.signature
    throw e
  }
}

// The old interface remains for the two reviewed workers. Production writes an
// intent before broadcast; an interrupted attempt blocks every lane for its payer.
export async function guardedSend(conn, tx, signers) {
  if (inRehearsalTree()) {
    const { sendAndConfirmTransaction } = await import('@solana/web3.js')
    return sendAndConfirmTransaction(conn, tx, signers, { commitment: 'confirmed' })
  }
  if (await conn.getGenesisHash() !== profile('mainnet').expectedGenesisHash) throw new Error('Wrong worker network')
  const pins = JSON.parse(fs.readFileSync(STATE + '/wallets.json', 'utf8'))
  const payer = signers[0]?.publicKey.toBase58()
  if (signers.length !== 1 || ![pins.crank, pins.operator].includes(payer)) throw new Error('Unpinned worker payer')
  const file = `${STATE}/send-${payer}.json`, marker = file + '.written'
  return payerLease(file + '.lock', async () => {
    const api = await garyModule('src/lib/solana-confirm.ts')
    const ledger = readLedger(file, { version: 1, attempts: [] }, marker)
    const guardedApi = { ...api,
      landAndAwait: async (raw, opts) => {
        const sim = await conn.simulateTransaction(VersionedTransaction.deserialize(raw), { sigVerify: true, commitment: 'confirmed' })
        if (sim.value.err) return { status: 'failed', signature: api.describeSignedTx(raw).signature,
          err: { preflight: 'Simulation failed before submission', logs: sim.value.logs || [] } }
        return api.landAndAwait(raw, opts)
      },
      failureLogs: async a => {
        if (Array.isArray(a.outcome.err?.logs)) return a.outcome.err.logs
        if (a.outcome.err?.preflight) {
          // The central guard conservatively truncates preflight error text.
          // A read-only repeat simulation can establish a currently benign
          // refusal; never turn an unavailable/successful replay into one.
          const sim = await conn.simulateTransaction(VersionedTransaction.deserialize(Buffer.from(a.raw, 'base64')), { sigVerify: true, commitment: 'confirmed' })
          return sim.value.err ? sim.value.logs || [] : []
        }
        return (await conn.getTransaction(a.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }))?.meta?.logMessages || []
      },
    }
    const a = await guardedAttempt({ ledger, save: () => writeLedger(file, ledger, marker), api: guardedApi, build: async () => {
      const latest = await conn.getLatestBlockhash('confirmed')
      tx.recentBlockhash = latest.blockhash
      tx.lastValidBlockHeight = latest.lastValidBlockHeight
      tx.feePayer = signers[0].publicKey
      // Preserve the reviewed fee/rent budget and DEX instruction policy.
      tx.sign(...signers)
      const raw = tx.serialize(), signature = api.describeSignedTx(raw)?.signature
      if (!signature || !(tx instanceof Transaction)) throw new Error('Invalid worker transaction')
      return { created_at: new Date().toISOString(), signature, ...latest,
        intent: 'cbob-worker:' + payer + ':' + randomUUID(), raw: raw.toString('base64'), outcome: null }
    } })
    // Revenue delta reads must not hit a pool member behind the confirmed swap.
    conn._cbobMinimumReadSlot = Math.max(conn._cbobMinimumReadSlot || 0, a.outcome.slot || 0)
    if (!conn._cbobReadWrapped) {
      const original = conn.getAccountInfo.bind(conn)
      conn.getAccountInfo = (address, opts) => original(address, {
        ...(typeof opts === 'string' ? { commitment: opts } : opts || {}),
        minContextSlot: Math.max(conn._cbobMinimumReadSlot, typeof opts === 'object' ? opts?.minContextSlot || 0 : 0),
      })
      conn._cbobReadWrapped = true
    }
    return a.signature
  })
}
