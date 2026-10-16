#!/opt/cbob-vaults/bank/ops-node
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { withLock, readLedger, writeLedger } from './lock.mjs'
import { garyModule, safeError } from './ops-runtime.mjs'

const DIR = '/var/lib/cbob-ops'
export function ownerAlertDestination(file = DIR + '/owner-alert.json') {
  if (fs.statSync(file).mode & 0o077) throw new Error('Owner alert routing must remain private')
  const config = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!/^\+[1-9]\d{7,14}$/.test(config.to || '')) throw new Error('Owner alert routing is not configured')
  return config.to
}
export function alertKey(text, label, day) {
  // Counts/balances changing each minute must not page repeatedly; recovery
  // and a materially different issue still have their own durable receipt.
  const normalized = text.replace(/\b\d+\b/g, 'N')
  return createHash('sha256').update(label + ':' + day + ':' + normalized).digest('hex')
}
export async function ownerAlert(text, label) {
  process.umask(0o077)
  const GARY = ownerAlertDestination()
  text = safeError({ message: text })
  if (!text.trim() || !label || label.length > 160) throw new Error('Invalid CBOB owner alert')
  const day = new Date().toISOString().slice(0, 10)
  const key = alertKey(text, label, day)
  const file = DIR + '/alerts/' + key + '.json'
  fs.mkdirSync(DIR + '/alerts', { recursive: true, mode: 0o700 })
  return withLock(file + '.lock', async () => {
    const transport = await garyModule('src/lib/luna/austin/transport/linq.ts')
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const prior = readLedger(file, null, file + '.written')
    if (prior?.verified) return prior
    const a = prior || { at: new Date().toISOString(), text, label, key: 'cbob-ops-alert:' + key, result: null }
    if (!prior) {
      writeLedger(file, a, file + '.written')
      // Gary explicitly requested that Luna text CBOB issues on his existing line.
      a.result = await transport.linqTransport.sendDirect(sb, { to: GARY, text: a.text, idempotencyKey: a.key })
      writeLedger(file, a, file + '.written')
    }
    // A process crash or uncertain submission never authorizes a second send.
    const proof = await transport.findSentMessage(sb, { to: [GARY], text: a.text, since: a.at })
    if (!proof) throw new Error('Owner alert delivery unverified; retained for reconciliation without resend')
    a.verified = proof
    writeLedger(file, a, file + '.written')
    return a
  })
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ownerAlert(process.argv[2] || '', process.argv[3] || 'cbob-operations').then(() => {
    console.log('CBOB owner alert provider receipt verified')
  }).catch(e => { console.error(safeError(e)); process.exitCode = 1 })
}
