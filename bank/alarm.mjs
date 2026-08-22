#!/usr/bin/env node
/**
 * CBOB Bank alarm pipeline.
 *
 * WHY THIS EXISTS, STATED PLAINLY: once the Bank's co-signature became
 * load-bearing, a real share of the vault guarantee moved OFF-CHAIN. Core cannot
 * enumerate the token accounts a PDA owns, so `burn_vault` can only check what a
 * caller declares, and a bare Core BurnV1 cannot be prevented at all while the
 * vault stays freely transferable. Those are properties of Core, not choices —
 * and this file is the only thing watching them.
 *
 * IT REPORTS WHAT IT LOOKED AT, NOT "ALL CLEAR". A read that fails is an ALARM,
 * never a pass: the failure mode this is built to avoid is a green report from a
 * pipeline that was quietly looking at nothing.
 *
 *   node bank/alarm.mjs                 # one pass, alert on findings
 *   node bank/alarm.mjs --dry-run       # print, never email
 *   node bank/alarm.mjs --selftest      # prove the detectors (see selftest.mjs)
 */
import fs from 'fs'
import { execFileSync } from 'child_process'
import { PublicKey, Connection } from '/opt/gary-club/node_modules/@solana/web3.js/lib/index.cjs.js'
import * as D from './detectors.mjs'

const ARGS = new Set(process.argv.slice(2))
const DRY = ARGS.has('--dry-run')
const STATE_FILE = process.env.CBOB_ALARM_STATE || '/opt/cbob-vaults/bank/state.json'
const NOTIFY = '/opt/scripts/notify-gary-sms.sh'   // email-only; see internal-alert-channel rule

const SEAL = new PublicKey('9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273')
const MINT = new PublicKey('Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo')
const BURN = new PublicKey('8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8')
const GOV  = new PublicKey('2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2')
const CORE = new PublicKey(D.CORE_ID)
const ATA_P = new PublicKey(D.ATA_ID)
const TOK = new PublicKey(D.TOKEN_ID)
const CBBTC = new PublicKey('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij')

function rpcUrl() {
  const env = fs.readFileSync('/opt/gary-club/.env.local', 'utf8')
  const m = env.match(/^HELIUS_RPC_URL=(.*)$/m)
  if (!m) throw new Error('HELIUS_RPC_URL not found in /opt/gary-club/.env.local')
  return m[1].trim()
}
const conn = new Connection(rpcUrl(), 'confirmed')
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return null } }
const writeState = s => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2))
const pda = (seeds, prog) => PublicKey.findProgramAddressSync(seeds, prog)[0]
const ata = (mint, owner) => PublicKey.findProgramAddressSync(
  [owner.toBuffer(), TOK.toBuffer(), mint.toBuffer()], ATA_P)[0]

/** DAS: every asset in the collection. A vault we do not know about is a vault
 *  nothing is watching, so this list failing is itself an alarm. */
async function listVaults(collection) {
  const out = []
  for (let page = 1; page < 50; page++) {
    const r = await fetch(rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'v', method: 'getAssetsByGroup',
        params: { groupKey: 'collection', groupValue: collection, page, limit: 1000 } }) })
    const j = await r.json()
    if (j.error) throw new Error(`DAS getAssetsByGroup: ${JSON.stringify(j.error)}`)
    const items = j.result?.items || []
    out.push(...items.filter(i => !i.burnt).map(i => i.id))
    if (items.length < 1000) break
  }
  return out
}

/** Flatten a jsonParsed tx into the shape the detectors expect. */
function normalise(tx) {
  const keys = tx.transaction.message.accountKeys.map(k => (k.pubkey || k).toString())
  const one = ix => ({
    program: (ix.programId || keys[ix.programIdIndex]).toString(),
    parsed: ix.parsed,
    accounts: (ix.accounts || []).map(a => (typeof a === 'number' ? keys[a] : a.toString())),
    dataBytes: ix.data ? [...Buffer.from(bs58decode(ix.data))] : undefined,
  })
  const top = (tx.transaction.message.instructions || []).map(one)
  const inner = (tx.meta?.innerInstructions || []).flatMap(g => g.instructions.map(one))
  return [...top, ...inner]
}
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function bs58decode(s) {
  let n = 0n
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) return Buffer.alloc(0); n = n * 58n + BigInt(i) }
  const bytes = []; while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n }
  for (const c of s) { if (c === '1') bytes.unshift(0); else break }
  return Buffer.from(bytes)
}

async function readConfigs() {
  const snap = {}
  const g = async (key, prog, seeds, fields) => {
    const acc = await conn.getAccountInfo(pda(seeds, prog), 'confirmed')
    if (!acc) { snap[`${key}._missing`] = true; return }
    const d = acc.data
    for (const [name, off, kind] of fields) {
      snap[`${key}.${name}`] =
        kind === 'pk'  ? new PublicKey(d.subarray(off, off + 32)).toBase58() :
        kind === 'u64' ? String(d.readBigUInt64LE(off)) :
        kind === 'i64' ? String(d.readBigInt64LE(off)) :
        kind === 'u16' ? d.readUInt16LE(off) : d[off]
    }
    if (key === 'seal') {
      const n = d.readUInt32LE(105)
      snap['seal.reserve_mints'] = Array.from({ length: n },
        (_, i) => new PublicKey(d.subarray(109 + i * 32, 141 + i * 32)).toBase58())
    }
  }
  // offsets mirror the programs' own pinned layouts (disc 8 + version 1 first)
  await g('seal', SEAL, [Buffer.from('config')], [['version',8,'u8'],['admin',9,'pk'],['collection',41,'pk'],['bank',73,'pk']])
  await g('mint', MINT, [Buffer.from('mint-config')], [['version',8,'u8'],['admin',9,'pk'],['collection',41,'pk'],
    ['bank',73,'pk'],['governance',105,'pk'],['treasury',137,'pk'],['minted_total',205,'u64'],['max_supply',213,'u64']])
  await g('gov', GOV, [Buffer.from('gov-config')], [['admin',8,'pk'],['collection',40,'pk'],
    ['quorum_bps',72,'u16'],['threshold_bps',74,'u16'],['min_voting_secs',76,'i64']])
  return snap
}

async function main() {
  const started = new Date().toISOString()
  const prev = readState()
  const findings = []
  const looked = { vaults: 0, txs: 0, since: prev?.lastSignature || null }

  const cfg = await readConfigs()
  findings.push(...D.detectConfigDrift(prev?.config, cfg))
  findings.push(...D.detectStandingRisks(cfg))

  const collection = cfg['mint.collection']
  if (!collection || cfg['mint._missing']) {
    // Nothing is deployed/initialised yet. Say so; do not report "all clear".
    console.log('mint config not initialised — nothing to watch yet')
    writeState({ startedAt: started, config: cfg, activation: {}, lastSignature: null })
    return report(findings, looked, cfg, true)
  }

  const vaults = await listVaults(collection)
  looked.vaults = vaults.length
  const pdas = new Set(), atas = new Set(), assets = new Set(vaults)
  const pdaOf = {}
  for (const v of vaults) {
    const p = pda([Buffer.from('mpl-core-execute'), new PublicKey(v).toBuffer()], CORE)
    pdaOf[v] = p; pdas.add(p.toBase58())
    for (const m of (cfg['seal.reserve_mints'] || [])) atas.add(ata(new PublicKey(m), p).toBase58())
  }

  // ---- activation, read fresh every pass ----
  const activation = {}, balances = {}
  for (const v of vaults) {
    const a = ata(CBBTC, pdaOf[v])
    let bal = '0'
    try { const r = await conn.getTokenAccountBalance(a, 'confirmed'); bal = r.value.amount } catch { bal = '0' }
    balances[v] = bal
    activation[v] = BigInt(bal) >= D.ACTIVATION_SATS
  }
  findings.push(...D.detectDeactivations(prev?.activation, balances))

  // ---- transactions touching the programs, since the last pass ----
  let newest = prev?.lastSignature || null
  for (const prog of [SEAL, MINT, BURN, GOV, CORE]) {
    const sigs = await conn.getSignaturesForAddress(prog,
      { until: prev?.lastSignature || undefined, limit: 200 }, 'confirmed')
    if (!newest && sigs.length) newest = sigs[0].signature
    for (const s of sigs) {
      if (s.err) continue
      const tx = await conn.getParsedTransaction(s.signature,
        { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
      if (!tx) continue
      looked.txs++
      const ixs = normalise(tx)
      for (const f of [...D.detectApprovals(ixs, pdas),
                       ...D.detectPdaTokenAccounts(ixs, pdas, atas),
                       ...D.detectBurns(ixs, assets, BURN.toBase58())]) {
        findings.push({ ...f, signature: s.signature })
      }
    }
  }

  writeState({ startedAt: started, config: cfg, activation, lastSignature: newest })
  return report(findings, looked, cfg, false)
}

function report(findings, looked, cfg, idle) {
  const bySev = s => findings.filter(f => f.severity === s)
  const crit = bySev('CRITICAL'), high = bySev('HIGH'), info = bySev('INFO')
  const lines = []
  lines.push(`CBOB vault alarm — ${new Date().toISOString()}`)
  lines.push(`looked at: ${looked.vaults} vaults, ${looked.txs} transactions${looked.since ? ` since ${looked.since.slice(0, 12)}…` : ' (first pass)'}`)
  lines.push(`config: supply ${cfg['mint.minted_total'] ?? '?'}/${cfg['mint.max_supply'] ?? '?'}, reserve mints ${(cfg['seal.reserve_mints'] || []).length}, voting ${cfg['gov.min_voting_secs'] ?? '?'}s`)
  lines.push('')
  for (const [label, list] of [['CRITICAL', crit], ['HIGH', high], ['INFO', info]]) {
    if (!list.length) continue
    lines.push(`${label} (${list.length}):`)
    for (const f of list) lines.push(`  [${f.kind}] ${f.detail}${f.signature ? `\n     tx ${f.signature}` : ''}`)
    lines.push('')
  }
  // This is the honest bottom line. It is a statement about what was CHECKED.
  lines.push(crit.length || high.length
    ? '>>> ACTION REQUIRED'
    : idle ? 'nothing deployed yet — this is not an all-clear'
    : 'no approvals, no unexpected PDA token accounts, no burns, no deactivations, no config drift.')
  lines.push('NOT checked by this pass: anything before the first run, and any token')
  lines.push('account created for a vault PDA by a route that does not appear in these')
  lines.push('programs\' transaction history. Completeness is a reconcile, not a tail.')
  const text = lines.join('\n')
  console.log(text)
  const urgent = crit.length + high.length
  if (urgent && !DRY) {
    try {
      execFileSync(NOTIFY, [`CBOB VAULTS: ${crit.length} critical, ${high.length} high — ${crit[0]?.detail || high[0]?.detail}`, 'cbob-vault-alarm'], { stdio: 'ignore' })
    } catch (e) { console.error('ALERT DELIVERY FAILED:', e.message); process.exitCode = 2 }
  }
  process.exitCode = urgent ? 1 : 0
}

if (ARGS.has('--selftest')) {
  await import('./selftest.mjs')
} else {
  main().catch(e => {
    // A pipeline that cannot read must NEVER look like a quiet one.
    const msg = `CBOB VAULT ALARM FAILED TO RUN: ${e.message}`
    console.error(msg)
    if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-vault-alarm']) } catch {} }
    process.exit(3)
  })
}
