#!/usr/bin/env node
import fs from 'node:fs'
import { ownerAlert } from './ops-notify.mjs'
import { safeError } from './ops-runtime.mjs'
import { reconcileWorker } from './guarded-send.mjs'
import { providerRpc, readConnection } from './live-programs.mjs'
import { readLedger } from './lock.mjs'
const DIR = '/var/lib/cbob-ops', now = Date.now(), issues = []
const pins = JSON.parse(fs.readFileSync(DIR + '/wallets.json', 'utf8'))
for (const payer of [pins.crank, pins.operator]) {
  const file = `${DIR}/send-${payer}.json`
  try {
    const ledger = readLedger(file, { attempts: [] }, file + '.written')
    if (ledger.attempts.some(a => !['landed', 'failed', 'expired'].includes(a.outcome?.status))) {
      await reconcileWorker(readConnection(providerRpc()), payer)
    }
  } catch { issues.push('an operating transaction remains unresolved or its journal is unreadable') }
}
for (const [job, seconds] of Object.entries({ topup: 240, reveal: 240, crank: 10800, revenue: 10800 })) {
  let state
  try { state = JSON.parse(fs.readFileSync(`${DIR}/job-${job}.json`, 'utf8')) } catch {}
  const last = Date.parse(state?.last_success)
  if (!Number.isFinite(last) || last > now + 60000 || now - last > seconds * 1000) issues.push(job + ' has no recent successful pass')
}
for (const [name, file, seconds] of [
  ['Core watcher', '/opt/cbob-vaults/.cache/core-watch/state.json', 3600],
  ['vault alarm', '/opt/cbob-vaults/bank/state.json', 7200],
]) {
  try { if (now - fs.statSync(file).mtimeMs > seconds * 1000) issues.push(name + ' state is stale') }
  catch { issues.push(name + ' state is missing') }
}
try {
  const topup = JSON.parse(fs.readFileSync(DIR + '/topup-health.json', 'utf8'))
  if (topup.balances.source < 50000000) issues.push('replenishment reserve is below 0.05 SOL')
} catch { issues.push('fee funding health is unreadable') }
if (issues.length) {
  console.error(JSON.stringify({ at: new Date().toISOString(), issues }))
  ownerAlert('CBOB operations need attention: ' + issues.join('; ') + '.', 'cbob-ops:watch')
    .catch(e => { console.error(safeError(e)); process.exitCode = 1 })
} else console.log(JSON.stringify({ at: new Date().toISOString(), status: 'healthy' }))
