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
 * ROUND 6 CORRECTION — THE SCANNER WAS DEAD AND SAID NOTHING. Until 2026-08-22
 * this kept ONE `lastSignature` and passed it as `until` to FIVE different
 * addresses. `until` only means anything if that signature is in THAT address's
 * own history; MEASURED against mainnet, a foreign one makes the RPC return an
 * EMPTY list. So from the second pass onward the approve / PDA-token-account /
 * burn detectors were fed SEAL's transactions and nothing else — no mints, no
 * burns, no governance. The watermark never advanced either (`if (!newest …)`
 * only ran when there was no previous state), so even SEAL was re-scanned from
 * the same first-pass sentinel forever and silently truncated at 200. Cursors
 * are now PER PROGRAM, advance every pass, page until the sentinel is found, and
 * a window that cannot be closed is a FINDING rather than a quiet truncation.
 *
 *   node bank/alarm.mjs                 # one pass, alert on findings
 *   node bank/alarm.mjs --reconcile     # STATE, not history: every token account
 *                                       # each vault PDA owns (see reconcile())
 *   node bank/alarm.mjs --dry-run       # print, never email
 *   node bank/alarm.mjs --selftest      # prove the detectors (see selftest.mjs)
 */
import fs from 'fs'
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { PublicKey, Connection } from '/opt/gary-club/node_modules/@solana/web3.js/lib/index.cjs.js'
import * as D from './detectors.mjs'
import { withLock, readLedger, writeLedger } from './lock.mjs'

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
const BPF_LOADER_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')
/** Anchor discriminators: sha256("global:<name>")[..8]. COMPUTED, never guessed. */
const disc = n => [...createHash('sha256').update(`global:${n}`).digest().subarray(0, 8)]
const IX_SWEEP = disc('sweep_sol_for_swap')
const IX_BURN_VAULT = disc('burn_vault')

function rpcUrl() {
  const env = fs.readFileSync('/opt/gary-club/.env.local', 'utf8')
  const m = env.match(/^HELIUS_RPC_URL=(.*)$/m)
  if (!m) throw new Error('HELIUS_RPC_URL not found in /opt/gary-club/.env.local')
  return m[1].trim()
}
const conn = new Connection(rpcUrl(), 'confirmed')
/** MISSING is a first run. UNPARSEABLE throws — see lock.mjs. A corrupt state
 *  file used to read as `null`, which silently disabled EVERY drift comparison
 *  and reset the scan cursors, i.e. the quiet-pipeline failure this file exists
 *  to avoid. */
const readState = () => readLedger(STATE_FILE, null)
const writeState = s => writeLedger(STATE_FILE, s)
const LOCK = process.env.CBOB_ALARM_LOCK || '/opt/cbob-vaults/bank/.alarm.lock'
/** cron is `23,53 * * * *`. Three missed passes is an outage worth naming. */
const EXPECTED_INTERVAL_MS = 30 * 60_000
const pda = (seeds, prog) => PublicKey.findProgramAddressSync(seeds, prog)[0]
const ata = (mint, owner) => PublicKey.findProgramAddressSync(
  [owner.toBuffer(), TOK.toBuffer(), mint.toBuffer()], ATA_P)[0]

/** DAS: every asset in the collection. A vault we do not know about is a vault
 *  nothing is watching, so this list failing is itself an alarm. */
async function listVaults(collection) {
  const live = [], burnt = []
  const MAX_PAGES = 50
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetch(rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'v', method: 'getAssetsByGroup',
        params: { groupKey: 'collection', groupValue: collection, page, limit: 1000 } }) })
    const j = await r.json()
    if (j.error) throw new Error(`DAS getAssetsByGroup: ${JSON.stringify(j.error)}`)
    const items = j.result?.items || []
    for (const i of items) (i.burnt ? burnt : live).push(i.id)
    if (items.length < 1000) return { live, burnt }
  }
  // A cap that stops quietly is a cap that reports "all clear" about vaults it
  // never looked at. max_supply is 2,100, so reaching this means something is
  // very wrong with either the collection or the index.
  throw new Error(`collection has more than ${MAX_PAGES * 1000} assets — refusing to report on a truncated vault list`)
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

/**
 * Every signature for ONE address newer than that address's OWN watermark.
 *
 * Two things here are the whole point. The cursor belongs to the ADDRESS (a
 * signature from another program makes `until` match nothing and the RPC returns
 * an empty list — measured). And it PAGES: `limit` alone silently drops
 * everything older than the newest N, which during a mint round is exactly the
 * traffic worth reading. If the sentinel is not reached inside `maxPages`, that
 * is returned as a gap for the caller to REPORT, never swallowed.
 */
async function signaturesSince(address, until, maxPages = 20, limit = 1000) {
  const out = []
  let before
  for (let p = 0; p < maxPages; p++) {
    const batch = await conn.getSignaturesForAddress(address,
      { limit, ...(before ? { before } : {}), ...(until ? { until } : {}) }, 'confirmed')
    out.push(...batch)
    if (batch.length < limit) return { sigs: out, gap: false }
    before = batch[batch.length - 1].signature
  }
  return { sigs: out, gap: true }
}

async function readConfigs() {
  const snap = {}
  // Every one of these is a raw-offset read of an UPGRADEABLE program's account.
  // The programs pin each other's configs by discriminator AND version byte for
  // exactly that reason; this pipeline reads three of the same accounts and
  // pinned none of them. It reads the version now and reports it as drift, so a
  // layout change announces itself instead of silently moving what we think we
  // are looking at.
  const g = async (key, prog, seeds, fields) => {
    const acc = await conn.getAccountInfo(pda(seeds, prog), 'confirmed')
    if (!acc) { snap[`${key}._missing`] = true; return }
    const d = acc.data
    if (d.length < 9) { snap[`${key}._malformed`] = true; return }
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
    ['bank',73,'pk'],['governance',105,'pk'],['treasury',137,'pk'],['minted_total',205,'u64'],['max_supply',213,'u64'],
    ['bank_treasury',221,'pk'],['split_bps',253,'u16'],['paused',255,'u8'],
    ['swap_operator',256,'pk'],['sol_reserve_lamports',288,'u64'],
    // appended after `bump` in round 6, so nothing above moved
    ['max_sweep_lamports',297,'u64'],['sweep_cooldown_secs',305,'i64'],['last_sweep_at',313,'i64'],
    ['pending_governance',321,'pk'],['pending_governance_at',353,'i64'],
    // round 7: the field MINT's own comment said this pipeline asserted, one
    // offset past where the reads used to stop.
    ['governance_timelock_secs',361,'i64'],['pending_admin',369,'pk'],['pending_admin_at',401,'i64'],
    // the single output of the whole governance system, previously unwatched
    ['round_id',169,'u32'],['opens_at',173,'i64'],['closes_at',181,'i64'],
    ['price_lamports',189,'u64'],['cap',197,'u32'],['last_sweep_at',313,'i64']])
  // GovConfig grew a `version` byte at offset 8 in round 6, so every field below
  // it moved by one. It is the only place `min_voting_secs` is asserted at all,
  // and a raw-offset read of an account that can be upgraded is a silent misread
  // waiting to happen — so the version is READ and reported as drift like any
  // other watched value. A layout change now announces itself.
  // BURN gained a version byte in round 6 too, so everything below it moved by one.
  await g('burn', BURN, [Buffer.from('burn-config')], [['version',8,'u8'],['admin',9,'pk'],
    ['collection',41,'pk'],['bank',73,'pk']])
  await g('gov', GOV, [Buffer.from('gov-config')], [['version',8,'u8'],['admin',9,'pk'],['collection',41,'pk'],
    ['quorum_bps',73,'u16'],['threshold_bps',75,'u16'],['min_voting_secs',77,'i64'],
    ['last_executed_id',93,'u64']])
  // ---- the programs themselves ----
  // A config that never drifts proves nothing if the program reading it can be
  // replaced. BPFLoaderUpgradeable stores the upgrade authority and the bytes in
  // a separate ProgramData account, derived as ["<program>"] under the loader.
  for (const [name, prog] of [['seal', SEAL], ['mint', MINT], ['burn', BURN], ['gov', GOV]]) {
    const [pdAddr] = PublicKey.findProgramAddressSync([prog.toBuffer()], BPF_LOADER_UPGRADEABLE)
    const acc = await conn.getAccountInfo(pdAddr, 'confirmed')
    if (!acc) { snap[`prog.${name}._missing`] = true; continue }
    // ProgramData layout: [0..4] enum=3, [4..12] slot, [12] Option<authority>,
    // [13..45] authority when present, then the ELF.
    const hasAuth = acc.data[12] === 1
    snap[`prog.${name}.upgrade_authority`] = hasAuth
      ? new PublicKey(acc.data.subarray(13, 45)).toBase58()
      : 'IMMUTABLE'
    snap[`prog.${name}.hash`] = createHash('sha256').update(acc.data.subarray(45)).digest('hex').slice(0, 32)
  }
  // THE COLLECTION ACCOUNT ITSELF. `collection.hash` was added to the drift watch
  // in round 6 and NOTHING EVER WROTE THE KEY, so royalty and plugin changes were
  // invisible while the report said the collection was watched. A watch on a key
  // no one populates is quieter than no watch at all, because it reads as covered.
  if (snap['mint.collection']) {
    const acc = await conn.getAccountInfo(new PublicKey(snap['mint.collection']), 'confirmed')
    snap['collection.hash'] = acc
      ? createHash('sha256').update(acc.data).digest('hex').slice(0, 32)
      : 'ABSENT'
  }
  return snap
}

/**
 * THE COMPLETENESS RECONCILE — the one thing the signature tail structurally
 * cannot do, and the one BURN's own header already promised existed.
 *
 * `programs/cbob-vault-burn/src/lib.rs` says the non-ATA gap is covered by "the
 * off-chain scanner, which uses getTokenAccountsByOwner and DOES see non-ATA
 * accounts". Until round 6 NO SHIPPED FILE CALLED IT. That mattered more than a
 * missing feature: creating a token account owned by a vault PDA needs no
 * signature from the PDA and touches none of our four programs, so such a
 * transaction never appears in any signature scan we run. `detectPdaTokenAccounts`
 * could only ever see one nested inside a transaction that also touched us —
 * which is not how anybody would plant one. State, not history, is the only
 * instrument that answers this, and enumeration is impossible ON-CHAIN, not from
 * a script.
 *
 * Separate from the 30-minute pass because it is one RPC call per vault per
 * token program: heavy at 2,100 vaults, cheap once a day.
 */
async function reconcile() {
  const cfg = await readConfigs()
  const collection = cfg['mint.collection']
  if (!collection || cfg['mint._missing']) { console.log('nothing deployed to reconcile'); return }
  const { live, burnt } = await listVaults(collection)
  const findings = [...D.detectIndexShortfall(cfg['mint.minted_total'], live.length, burnt.length)]
  const reserve = (cfg['seal.reserve_mints'] || []).map(m => new PublicKey(m))
  let scanned = 0, accounts = 0
  for (const v of live) {
    const p = pda([Buffer.from('mpl-core-execute'), new PublicKey(v).toBuffer()], CORE)
    const expected = new Set(reserve.map(m => ata(m, p).toBase58()))
    for (const prog of [TOK, new PublicKey(D.TOKEN22_ID)]) {
      const r = await conn.getTokenAccountsByOwner(p, { programId: prog }, 'confirmed')
      const owned = r.value.map(({ pubkey, account }) => ({ address: pubkey.toBase58(),
        amount: account.data.length >= 72 ? account.data.readBigUInt64LE(64) : 0n }))
      accounts += owned.length
      // The JUDGEMENT lives in a pure, both-ways-tested detector; this loop is
      // only the I/O that cannot be exercised on a local validator.
      findings.push(...D.detectUndeclaredTokenAccounts(v, expected, owned))
    }
    scanned++
  }
  console.log(`reconcile: ${scanned} vaults, ${accounts} token accounts, ${findings.length} findings`)
  report(findings, { vaults: scanned, txs: 0, programs: 0, burnt: burnt.length }, cfg, false)
}

async function main() {
  const started = new Date().toISOString()
  const prev = readState()
  // ABSENT IS NOT A FIRST RUN once the pipeline has ever run. Round 6 made a
  // CORRUPT state file abort and left an ABSENT one reading as "day one", so
  // `rm state.json` — on the same host, as the same user as the signing keys —
  // made the next pass adopt whatever it found as canonical, print "no config
  // drift", and exit 0. The marker is deliberately separate from the state file
  // so deleting one does not delete the other's memory of it.
  const EVER = process.env.CBOB_ALARM_EVER || '/opt/cbob-vaults/bank/.alarm-has-run'
  if (!prev && fs.existsSync(EVER) && !ARGS.has('--first-run')) {
    throw new Error(`${STATE_FILE} is missing, but ${EVER} says this pipeline has run before. `
      + 'Every drift comparison is against that file, so a fresh one silently adopts whatever is on chain right now as correct. '
      + 'Restore it, or pass --first-run deliberately after satisfying yourself the current config is the intended one.')
  }
  const findings = []
  const looked = { vaults: 0, txs: 0, programs: 0 }

  // A pass that did not happen is the one thing this pipeline cannot see about
  // itself. It can at least say so on the way back: if the gap since the last
  // pass is three intervals or more, nothing was watching for that whole window.
  // (The real dead-man's switch is the separate cron in cron-install.sh that
  // watches this file's mtime, because a watchdog cannot report its own death.)
  if (prev?.startedAt) {
    const gap = Date.now() - Date.parse(prev.startedAt)
    if (gap > 3 * EXPECTED_INTERVAL_MS) {
      findings.push({ kind: 'watchdog_gap', severity: 'HIGH',
        detail: `this pipeline last ran ${Math.round(gap / 60000)} minutes ago (expected every ${EXPECTED_INTERVAL_MS / 60000}). Nothing was watching in between.` })
    }
  }

  // the trusted hop, counted. A ledger we cannot read is a CRITICAL, not a
  // shrug: `catch { /* no ledger yet is not a finding */ }` meant `rm` on one
  // file turned this watch off silently. The path honours the SAME env var
  // revenue.mjs writes through — they used to disagree, so an env-configured
  // deployment had the writer and the watcher looking at different files.
  const LEDGER = process.env.CBOB_REVENUE_LEDGER || '/opt/cbob-vaults/bank/revenue-ledger.json'
  let led = null
  try { led = JSON.parse(fs.readFileSync(LEDGER, 'utf8')) } catch { led = null }
  findings.push(...D.detectUnreconciledRevenue(led))

  // The daily distribution moves customer cbBTC and NOTHING read its ledger.
  const DIST = process.env.CBOB_DIST_STATE || '/opt/cbob-vaults/bank/distributions.json'
  let dist = null
  try { dist = JSON.parse(fs.readFileSync(DIST, 'utf8')) } catch { dist = null }
  // A ledger that has NEVER existed is not yet a finding. One that existed and
  // vanished is the worst case — every vault reads as unpaid and a same-day
  // re-run pays them all again — and skipping the detector on an absent file
  // made that the ONE case this pass could not see.
  if (dist !== null || fs.existsSync(DIST) || fs.existsSync(`${DIST}.has-run`)) {
    const d0 = new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
    findings.push(...D.detectDistribution(dist, { yesterday: d0, today: new Date().toISOString().slice(0, 10) }))
  }

  const cfg = await readConfigs()
  findings.push(...D.detectConfigDrift(prev?.config, cfg))
  findings.push(...D.detectStandingRisks(cfg))

  const collection = cfg['mint.collection']
  if (!collection || cfg['mint._missing']) {
    // "not initialised" and "the RPC did not answer" are the same null. If a
    // PREVIOUS pass read this account, it cannot have un-existed, so this is a
    // failed read wearing an idle report's clothes — which used to exit 0 with
    // no notification at all.
    if (prev?.config?.['mint.collection']) {
      findings.push({ kind: 'config_vanished', severity: 'CRITICAL',
        detail: `MINT's config read as absent this pass, but a previous pass read it at ${prev.config['mint.collection']}. A config account cannot un-exist: this is a failed read or a closed account, and either needs a human.` })
      return report(findings, looked, cfg, false)     // state deliberately NOT advanced
    }
    console.log('mint config not initialised — nothing to watch yet')
    writeState({ startedAt: started, config: cfg, activation: {}, vaults: [], cursors: prev?.cursors || {} })
    return report(findings, looked, cfg, true)
  }

  const { live: vaults, burnt } = await listVaults(collection)
  looked.vaults = vaults.length
  looked.burnt = burnt.length

  // Does the index agree with the chain's own count of vaults ever created?
  // A short DAS page is indistinguishable from a small collection otherwise,
  // and everything downstream divides by what the index returned.
  findings.push(...D.detectIndexShortfall(cfg['mint.minted_total'], vaults.length, burnt.length))

  // ---- burns, by RECONCILE. See detectVaultSetChange: a bare Core BurnV1
  //      cannot be caught in a signature tail, so it is caught here instead.
  const setChange = D.detectVaultSetChange(prev?.vaults, { live: vaults, burnt })
  findings.push(...setChange.findings)

  // `assets` includes the BURNT ones. It used to be built from the live list
  // only, so the moment a bare Core burn SUCCEEDED its asset dropped out of DAS,
  // `assetSet.has(asset)` went false, and `detectBurns` could never name it —
  // blind precisely when the one attack the design cannot prevent had worked.
  const pdas = new Set(), atas = new Set(), assets = new Set([...vaults, ...burnt])
  const ataOwner = {}
  const pdaOf = {}
  for (const v of [...vaults, ...burnt]) {
    const p = pda([Buffer.from('mpl-core-execute'), new PublicKey(v).toBuffer()], CORE)
    pdas.add(p.toBase58())
    for (const m of (cfg['seal.reserve_mints'] || [])) ataOwner[ata(new PublicKey(m), p).toBase58()] = p.toBase58()
  }
  for (const v of vaults) {
    const p = pda([Buffer.from('mpl-core-execute'), new PublicKey(v).toBuffer()], CORE)
    pdaOf[v] = p
    for (const m of (cfg['seal.reserve_mints'] || [])) atas.add(ata(new PublicKey(m), p).toBase58())
  }

  // ---- activation, read fresh every pass ----
  // getAccountInfo, not getTokenAccountBalance, so that "there is no account"
  // (a genuine zero) is a NULL RESULT and an RPC failure is a THROW. The old
  // `catch { bal = '0' }` collapsed both into zero, which raised a false
  // deactivation alarm AND recorded the vault as inactive — after which a real
  // drain on the next pass was skipped as "it was already inactive".
  const activation = {}, balances = {}, unreadable = []
  for (const v of vaults) {
    const a = ata(CBBTC, pdaOf[v])
    try {
      const info = await conn.getAccountInfo(a, 'confirmed')
      const bal = info && info.data.length >= 72 ? String(info.data.readBigUInt64LE(64)) : '0'
      balances[v] = bal
      activation[v] = BigInt(bal) >= D.ACTIVATION_SATS
    } catch {
      unreadable.push(v)
      // Carry the last known answers forward rather than inventing new ones.
      // BOTH of them: round 6 carried `activation` and dropped `balances`, and
      // `detectBalanceDrops` iterates the PREVIOUS balances — so one unreadable
      // pass deleted that vault's baseline permanently and it was never compared
      // again. A vault drained from 1 BTC to 0.5 across that pass stays activated
      // and produces no finding: exactly the case the detector was written for.
      activation[v] = prev?.activation?.[v] ?? false
      if (prev?.balances?.[v] !== undefined) balances[v] = prev.balances[v]
    }
  }
  findings.push(...D.detectDeactivations(prev?.activation, balances, unreadable))
  // ANY fall in a reserve, not just one below the activation line.
  findings.push(...D.detectBalanceDrops(prev?.balances, balances))

  // ---- transactions touching OUR programs, since each program's OWN cursor ----
  // Core is deliberately NOT in this list. Its signature tail is ~117 seconds of
  // global activity per 200 signatures (measured), so scanning it can never see
  // one of our vaults and only ever cost RPC. The reconcile above covers it.
  const cursors = { ...(prev?.cursors || {}) }
  for (const prog of [SEAL, MINT, BURN, GOV]) {
    const id = prog.toBase58()
    const { sigs, gap } = await signaturesSince(prog, cursors[id])
    if (gap) {
      findings.push({ kind: 'scan_gap', severity: 'HIGH',
        detail: `more transactions on ${id} than one pass will page through. Older ones were NOT examined this pass; the cursor was left where it was so they are not skipped.` })
    }
    looked.programs++
    let unread = 0
    for (const s of sigs) {
      if (s.err) continue
      const tx = await conn.getParsedTransaction(s.signature,
        { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
      if (!tx) {
        // `if (!tx) continue` used to CONSUME the signature: the cursor moved
        // past a transaction whose instructions were never examined, and it
        // could never be revisited. A read that fails is an alarm, never a pass.
        unread++
        findings.push({ kind: 'tx_unreadable', severity: 'HIGH',
          detail: `could not fetch ${s.signature} on ${id}; its instructions were NOT examined. The cursor stays where it was so the next pass tries again.` })
        continue
      }
      looked.txs++
      const ixs = normalise(tx)
      for (const f of [...D.detectApprovals(ixs, pdas, ataOwner),
                       ...D.detectPdaTokenAccounts(ixs, pdas, atas),
                       ...D.detectBurns(ixs, assets, BURN.toBase58(), IX_BURN_VAULT),
                       // A sweep that our own script did not make. The ledger is
                       // written by the same process that holds the operator key;
                       // this is the half of the reconciliation that is not.
                       ...D.detectUnledgeredSweeps(ixs, MINT.toBase58(), IX_SWEEP, led, s.signature)]) {
        findings.push({ ...f, signature: s.signature })
      }
    }
    // Advance only over a window we actually read, end to end.
    if (!gap && !unread && sigs.length) cursors[id] = sigs[0].signature
  }

  const next = { startedAt: started, config: cfg, activation, balances, cursors,
    // Do not overwrite the known vault set with a list we have just reported as
    // untrustworthy, or the false reading becomes the new baseline.
    vaults: setChange.trustCurrent ? vaults : (prev?.vaults || vaults) }
  // REPORT FIRST. State used to be written before the alert went out, so a
  // CRITICAL config drift whose email failed became the new baseline and was
  // never mentioned again — the loudest possible finding, silenced by the
  // pipeline's own bookkeeping.
  try { fs.writeFileSync(EVER, started) } catch { /* best effort */ }
  const delivered = report(findings, looked, cfg, false)
  if (!delivered) {
    // Keep EVERY baseline, cursors included. Round 6 reverted the config,
    // activation and balance baselines but still banked the scan cursors — so a
    // CRITICAL approve or burn whose email failed was never re-reported, because
    // the transaction that carried it had been scanned past. An undelivered
    // finding has to survive into the next pass whole.
    next.config = prev?.config ?? cfg
    next.activation = prev?.activation ?? activation
    next.balances = prev?.balances ?? balances
    next.cursors = prev?.cursors ?? {}
    next.vaults = prev?.vaults ?? next.vaults
  }
  writeState(next)
}

function report(findings, looked, cfg, idle) {
  const bySev = s => findings.filter(f => f.severity === s)
  const crit = bySev('CRITICAL'), high = bySev('HIGH'), info = bySev('INFO')
  const lines = []
  lines.push(`CBOB vault alarm — ${new Date().toISOString()}`)
  lines.push(`looked at: ${looked.vaults} vaults (${looked.burnt ?? 0} burnt), ${looked.txs} transactions across ${looked.programs} programs`)
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
    : 'no approvals, no unexpected PDA token accounts, no burns, no vault left the'
      + '\ncollection, no reserve fell, no unreconciled sweep, and no drift in any'
      + '\nconfig value, program upgrade authority, program bytes or the collection.')
  lines.push('')
  lines.push('NOT CHECKED BY THIS PASS, and this list is the point of the report:')
  lines.push('  * a token account created for a vault PDA by a route that touches none')
  lines.push('    of our four programs. No signature scan can see one — that is what')
  lines.push('    `--reconcile` is for, and it runs DAILY, not every half hour.')
  lines.push('  * anything at all before this pipeline first ran.')
  lines.push('  * whether a reserve that fell was redeemed legitimately or drained.')
  lines.push('    This pass can tell you it moved; only the open/close stamp and a')
  lines.push('    human can tell you why.')
  const text = lines.join('\n')
  console.log(text)
  const urgent = crit.length + high.length
  let code = urgent ? 1 : 0
  let delivered = true
  if (urgent && !DRY) {
    try {
      execFileSync(NOTIFY, [`CBOB VAULTS: ${crit.length} critical, ${high.length} high — ${crit[0]?.detail || high[0]?.detail}`, 'cbob-vault-alarm'], { stdio: 'ignore' })
    } catch (e) {
      // 2 = we found something AND could not tell anyone. This used to be set
      // and then immediately overwritten by the line below, so the worst
      // outcome the pipeline can have looked exactly like the ordinary one.
      console.error('ALERT DELIVERY FAILED:', e.message); code = 2; delivered = false
    }
  }
  process.exitCode = code
  return delivered
}

if (ARGS.has('--selftest')) {
  await import('./selftest.mjs')
} else if (ARGS.has('--reconcile')) {
  withLock(LOCK + '.reconcile', reconcile, { staleMs: 6 * 3600_000 }).catch(e => {
    const msg = `CBOB VAULT RECONCILE FAILED: ${e.message}`
    console.error(msg)
    if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-vault-alarm']) } catch {} }
    process.exit(3)
  })
} else {
  // One runner. Two passes racing would each write the whole state file, and the
  // loser's advanced cursors would be erased — re-scanning, or worse, skipping.
  withLock(LOCK, main, { staleMs: 2 * 3600_000 }).catch(e => {
    // A pipeline that cannot read must NEVER look like a quiet one.
    const msg = e.code === 'ELOCKED'
      ? `CBOB VAULT ALARM DID NOT RUN: ${e.message}`
      : `CBOB VAULT ALARM FAILED TO RUN: ${e.message}`
    console.error(msg)
    if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-vault-alarm']) } catch {} }
    process.exit(3)
  })
}
