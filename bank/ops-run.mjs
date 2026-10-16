#!/usr/bin/env node
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { writeLedger, readLedger } from './lock.mjs'
import { ownerAlert } from './ops-notify.mjs'
import { safeError } from './ops-runtime.mjs'

const ROOT = '/opt/cbob-vaults', DIR = '/var/lib/cbob-ops'
const [script, ...args] = process.argv.slice(2)
const reveal = args.includes('--reveal-only')
const job = script === 'bank/fee-topup.mjs' ? 'topup' : script === 'bank/crank.mjs' ? reveal ? 'reveal' : 'crank' : script === 'bank/revenue.mjs' ? 'revenue' : null
if (!job || !args.includes('--live') || args.some(a => !['--live', '--reveal-only'].includes(a))) throw new Error('Invalid operational job')
process.umask(0o077)
const file = DIR + '/job-' + job + '.json', old = readLedger(file, {}, file + '.written')
const started_at = new Date().toISOString()
const child = spawn('/usr/bin/node', [ROOT + '/' + script, ...args], { cwd: ROOT, stdio: 'inherit' })
const timer = setTimeout(() => child.kill('SIGTERM'), job === 'crank' ? 20 * 60000 : 6 * 60000)
let result
try {
  result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) })
} catch (e) { result = { code: 1, error: safeError(e) } }
finally { clearTimeout(timer) }
const ok = result.code === 0
const health = { started_at, finished_at: new Date().toISOString(), process_ok: ok, result,
  consecutive_failures: ok ? 0 : (old.consecutive_failures || 0) + 1,
  last_success: ok ? new Date().toISOString() : old.last_success || null }
writeLedger(file, health, file + '.written')
if (health.consecutive_failures >= 3) {
  try { await ownerAlert(`CBOB ${job} job failed ${health.consecutive_failures} consecutive runs. Luna needs to inspect its saved transaction and recovery records.`, 'cbob-ops:' + job) }
  catch (e) { console.error(safeError(e)) }
}
process.exitCode = ok ? 0 : 1
