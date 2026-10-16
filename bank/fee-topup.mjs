#!/usr/bin/env node
import fs from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { PublicKey, Keypair, Transaction, ComputeBudgetProgram, SystemProgram } from '@solana/web3.js'
import { withLock, readLedger, writeLedger } from './lock.mjs'
import { providerRpc, readConnection, readFetch } from './live-programs.mjs'
import { profile } from '../web/src/config.js'
import { SOURCE, OPERATOR, SOURCE_FLOOR, planTopup } from './topup-policy.mjs'
import { garyModule, safeError } from './ops-runtime.mjs'
import { ownerAlert } from './ops-notify.mjs'
import { readPinned } from './layout.mjs'

const DIR = '/var/lib/cbob-ops', FILE = DIR + '/topups.json', MARKER = FILE + '.written'
const GENESIS = profile('mainnet').expectedGenesisHash
const pk = s => new PublicKey(s)
const check = (yes, message) => { if (!yes) throw new Error(message) }
export function signingKey(file, expected) {
  check((fs.statSync(file).mode & 0o077) === 0, 'Signing key permissions must be private')
  const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8'))))
  check(key.publicKey.toBase58() === expected, 'Signing key differs from pinned wallet')
  return key
}
export async function main() {
  process.umask(0o077)
  const live = process.argv.includes('--live'), initialize = process.argv.includes('--initialize')
  const pins = JSON.parse(fs.readFileSync(DIR + '/wallets.json', 'utf8'))
  check(pins.source === SOURCE && pins.operator === OPERATOR && PublicKey.isOnCurve(pk(pins.crank).toBytes()), 'Invalid wallet pins')
  check(new Set([pins.source, pins.operator, pins.crank]).size === 3, 'Fee wallets must be distinct')
  signingKey('/opt/cbob-vaults/bank/keys/crank.json', pins.crank)
  signingKey('/opt/cbob-vaults/bank/keys/swap-operator.json', OPERATOR)
  const urls = [providerRpc(), 'https://api.mainnet-beta.solana.com'], conns = urls.map(readConnection)
  for (const c of conns) check(await c.getGenesisHash() === GENESIS, 'Wrong topup network')
  const mint = pk(profile('mainnet').programs.mint)
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('mint-config')], mint)
  for (const c of conns) {
    const cfg = readPinned('MintConfig', await c.getAccountInfo(config, 'finalized'), PublicKey)
    check(cfg && cfg.swap_operator === OPERATOR, 'On-chain swap operator differs from funding pin')
  }
  const addresses = ['source', 'crank', 'operator'].map(role => pk(pins[role]))
  async function snapshot() {
    const reads = await Promise.all(conns.map(c => c.getMultipleAccountsInfoAndContext(addresses, { commitment: 'finalized' })))
    const values = reads.map(r => r.value.map(a => {
      check(!a || a.owner.equals(SystemProgram.programId) && !a.executable && a.data.length === 0, 'Fee destination is not a plain SOL wallet')
      return a?.lamports ?? 0
    }))
    check(JSON.stringify(values[0]) === JSON.stringify(values[1]), 'Independent balances differ; wait for next pass')
    return Object.fromEntries(['source', 'crank', 'operator'].map((r, i) => [r, values[0][i]]))
  }
  async function rpc(index, method, params) {
    const response = await readFetch(urls[index], { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    check(response.ok, 'Topup provider HTTP failure')
    const body = await response.json()
    check(!body.error, 'Topup provider RPC failure')
    return body.result
  }
  async function verify(a) {
    const raw = Buffer.from(a.raw, 'base64'), tx = Transaction.from(raw)
    const keys = tx.compileMessage().accountKeys.map(k => k.toBase58())
    const proofs = []
    for (let i = 0; i < 2; i++) {
      let landed = null
      for (let n = 0; n < 30; n++) {
        landed = await rpc(i, 'getTransaction', [a.signature, { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 0 }])
        if (landed) break
        await new Promise(r => setTimeout(r, 1000))
      }
      check(landed && !landed.meta.err && Buffer.from(landed.transaction[0], 'base64').equals(raw), 'Finalized topup bytes unavailable or differ')
      check(landed.meta.fee === a.fee, 'Actual topup fee differs')
      for (const t of a.transfers) {
        const n = keys.indexOf(pins[t.role])
        check(n >= 0 && landed.meta.postBalances[n] - landed.meta.preBalances[n] === t.lamports, 'Actual topup destination credit differs')
      }
      const s = keys.indexOf(SOURCE)
      check(landed.meta.preBalances[s] - landed.meta.postBalances[s] === a.total + a.fee, 'Actual source debit differs')
      check(landed.meta.postBalances[s] >= SOURCE_FLOOR, 'Source fee floor violated')
      proofs.push({ provider: i ? 'public' : 'dedicated', slot: landed.slot, finalized: true, exact_bytes: true, fee: landed.meta.fee })
    }
    a.proofs = proofs
  }
  await withLock(FILE + '.lock', async () => {
    check(fs.existsSync(FILE) || initialize && !fs.existsSync(MARKER), 'Topup ledger missing; refuses automatic reset')
    check(!initialize || !fs.existsSync(FILE), 'Topup initialization already completed')
    const ledger = readLedger(FILE, { version: 1, attempts: [] }, MARKER)
    check(ledger.version === 1 && Array.isArray(ledger.attempts), 'Invalid topup ledger')
    const api = await garyModule('src/lib/solana-confirm.ts')
    for (const a of ledger.attempts) {
      if (!['landed', 'failed', 'expired'].includes(a.outcome?.status)) {
        a.outcome = await api.resolveRecordedSend({ signature: a.signature, blockhash: a.blockhash,
          last_valid_block_height: a.lastValidBlockHeight, created_at: a.created_at }, 20000)
        writeLedger(FILE, ledger, MARKER)
        check(a.outcome.status !== 'unknown', 'Earlier topup still unknown; no new transfer allowed')
      }
      if (a.outcome.status === 'landed' && !a.proofs) {
        await verify(a)
        writeLedger(FILE, ledger, MARKER)
      }
    }
    const balances = await snapshot(), day = new Date().toISOString().slice(0, 10)
    let plan = planTopup({ balances, attempts: ledger.attempts, day, fee: 12500 })
    if (initialize) {
      check(balances.source === 500000000 && balances.crank === 0 && balances.operator === 0, 'Initial fee allocation must match authorized 0.5SOL reserve')
      if (live) writeLedger(FILE, ledger, MARKER)
    }
    if (plan.status !== 'ready' || !live) {
      console.log(JSON.stringify({ at: new Date().toISOString(), live, balances, plan }))
      if (live && plan.status === 'hold') await ownerAlert('CBOB fee replenishment is paused: ' + plan.reason + '. Remaining reserve: ' + balances.source / 1e9 + ' SOL. Existing vault funds were not used.', 'topup:' + plan.reason)
      if (live) writeLedger(DIR + '/topup-health.json', { at: new Date().toISOString(), ok: true, balances, plan })
      return
    }
    const signer = signingKey('/opt/cbob-vaults/bank/keys/deploy-authority.json', SOURCE)
    // Use the public provider's current hash; every signed transaction is also
    // simulated on the dedicated provider before the durable send guard runs.
    const latest = await conns[1].getLatestBlockhash('confirmed')
    const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: latest.blockhash })
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 150000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }))
    for (const t of plan.transfers) tx.add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: pk(pins[t.role]), lamports: t.lamports }))
    const fees = await Promise.all(conns.map(c => c.getFeeForMessage(tx.compileMessage(), 'confirmed')))
    check(fees[0].value !== null && fees[0].value === fees[1].value, 'Independent topup fee quotes differ')
    plan = planTopup({ balances, attempts: ledger.attempts, day, fee: fees[0].value })
    check(plan.status === 'ready', 'Topup no longer fits budget')
    tx.sign(signer)
    const raw = tx.serialize(), signature = api.describeSignedTx(raw)?.signature
    check(signature && raw.length <= 1232, 'Invalid signed topup')
    const simulations = []
    for (let i = 0; i < 2; i++) {
      const sim = await rpc(i, 'simulateTransaction', [raw.toString('base64'), { encoding: 'base64', sigVerify: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: addresses.map(p => p.toBase58()) } }])
      check(!sim.value.err && sim.value.accounts[0].lamports === plan.reserve_after, 'Signed topup simulation refused or source reserve differs')
      for (const t of plan.transfers) check(sim.value.accounts[['source', 'crank', 'operator'].indexOf(t.role)].lamports === balances[t.role] + t.lamports, 'Simulated destination credit differs')
      simulations.push({ provider: i ? 'public' : 'dedicated', slot: sim.context.slot, units: sim.value.unitsConsumed, err: null })
    }
    const a = { created_at: new Date().toISOString(), day, signature, ...latest, intent: 'cbob-fee-topup:' + randomUUID(),
      total: plan.total, fee: fees[0].value, transfers: plan.transfers, before: balances, raw: raw.toString('base64'),
      sha256: createHash('sha256').update(raw).digest('hex'), simulations, outcome: null }
    ledger.attempts.push(a)
    writeLedger(FILE, ledger, MARKER)
    a.outcome = await api.landAndAwait(raw, { label: 'CBOB authorized operating SOL allocation', intent: a.intent,
      lastValidBlockHeight: latest.lastValidBlockHeight, skipPreflight: false, budgetMs: 60000 })
    writeLedger(FILE, ledger, MARKER)
    check(a.outcome.status === 'landed' && a.outcome.signature === signature, 'Topup not confirmed; reconcile existing attempt, never retry blindly')
    await verify(a)
    writeLedger(FILE, ledger, MARKER)
    const after = await snapshot()
    writeLedger(DIR + '/topup-health.json', { at: new Date().toISOString(), ok: true, balances: after, signature, proofs: a.proofs })
    console.log(JSON.stringify({ status: 'finalized_and_independently_verified', signature, transfers: a.transfers, fee: a.fee, after, proofs: a.proofs }))
  })
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(async e => {
  console.error(safeError(e))
  if (process.argv.includes('--live')) {
    try { await ownerAlert('CBOB automatic SOL funding needs attention: ' + safeError(e), 'topup:error') } catch {}
  }
  process.exitCode = 1
})
