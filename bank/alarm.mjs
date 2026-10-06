#!/usr/bin/env node
/**
 * CBOB vault alarm pipeline (v6).
 *
 * WHY THIS EXISTS, STATED PLAINLY. v6 (2026-10-03) moved the money INTO the
 * programs: no Bank key, no distributor wallet, no admin, and the programs are
 * made immutable at launch. What is left for this file is what a program
 * structurally cannot do for itself:
 *   * SEE. Core cannot enumerate what a vault PDA owns, so `burn_vault` checks
 *     only what a redeemer declares, and a bare Core BurnV1 cannot be prevented
 *     while the vault stays freely transferable.
 *   * NOTICE ABSENCE. A program never runs unless someone sends a transaction,
 *     so a monthly payout that nobody triggered, a reveal queue nobody cranked,
 *     or a brake nobody saw pulled is invisible on chain until somebody looks.
 *   * WATCH WHAT IT RESTS ON. Metaplex Core is upgradeable by Metaplex, cbBTC is
 *     freezable by Coinbase, and until the lock date our own five programs are
 *     upgradeable by whoever holds the deploy key.
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
import { PublicKey, Connection, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js'
import * as D from './detectors.mjs'
import * as L from './layout.mjs'
import { withLock, readLedger, writeLedger } from './lock.mjs'
import { readTokenAccount } from './spl.mjs'
import { signaturesSince as walkSigs } from './sigwalk.mjs'
import { readParsedTransaction } from './txread.mjs'
import { clockUnixTimestamp } from './crank.mjs'

const ARGS = new Set(process.argv.slice(2))
const DRY = ARGS.has('--dry-run')
const STATE_FILE = process.env.CBOB_ALARM_STATE || '/opt/cbob-vaults/bank/state.json'
// Daily reconciliation has its own coverage, recovery history and router labels.
const RECONCILE_STATE = `${STATE_FILE}.reconcile`
const RECONCILE_FAILED = `${RECONCILE_STATE}.failed`
const RECONCILE_LABEL = 'cbob-reconcile'
const NOTIFY = '/opt/scripts/notify-gary-sms.sh'   // email-only; see internal-alert-channel rule
/** Round 24 (D5): a dress rehearsal turns the production-only value checks off,
 *  by `CBOB_ALARM_REHEARSAL=1` exactly, and says so in every report. */
const PRODUCTION = D.alarmProduction(process.env)
/** Round 24 (H1): a run that died is a condition with its own stream, and the
 *  next completed pass sends its RECOVERY. The marker is a separate file because
 *  the failure may BE the state file. */
const RUN_FAILED = process.env.CBOB_ALARM_RUN_FAILED || '/opt/cbob-vaults/bank/.alarm-run-failed'

const SEAL = new PublicKey('9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273')
const MINT = new PublicKey('Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo')
const BURN = new PublicKey('8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8')
const GOV  = new PublicKey('2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2')
/** Round 24 (A3): the stateless sweep helper, deployed and LOCKED with the rest. */
const SWEEP = new PublicKey('EB2uVvsaThLp4PWt3LwAWveTCa9ZynPVbWzZfUhMf2aa')
/** Round 30 (L1): the programs that print CBOB event lines. A truncated log can
 *  only have lost one if one of these EXECUTED in the transaction. */
const OURS = new Set([SEAL, MINT, BURN, GOV, SWEEP].map(p => p.toBase58()))
/** Round 31 (L2): at most this many transactions are READ per program per pass.
 *  A flood used to make one pass read 20,000 transactions one at a time before
 *  anything was reported, delaying every page (CRITICALs from account state
 *  included) by 40 to 130 minutes. Beyond the budget the walk records a backlog
 *  exactly as for a gap, so the flood slows only that program's transaction
 *  scan, never the other programs or the pass's report. */
const PER_PROGRAM_READS = (n => Number.isInteger(n) && n > 0 ? n : 2000)(Number(process.env.CBOB_ALARM_READS_PER_PROGRAM || 2000))
const CORE = new PublicKey(D.CORE_ID)
const ATA_P = new PublicKey(D.ATA_ID)
const TOK = new PublicKey(D.TOKEN_ID)
const CBBTC = new PublicKey('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij')
const BPF_LOADER_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')
/** Anchor discriminators: sha256("global:<name>")[..8]. COMPUTED, never guessed. */
const disc = n => [...createHash('sha256').update(`global:${n}`).digest().subarray(0, 8)]
/** ACCOUNT discriminators are a DIFFERENT preimage: sha256("account:<Struct>").
 *  Round 11: this reader took raw offsets out of whatever sat at a derived
 *  address, having verified neither the owning program nor the discriminator —
 *  weaker than the on-chain siblings, which pin both, and the file's own comment
 *  admitted it read the version "as drift" instead. Drift is a report AFTER the
 *  fact; the first pass has no baseline to drift from, so an account of the
 *  wrong type would have been adopted as the baseline and read at the old
 *  offsets until a human noticed. */
const acctDisc = n => createHash('sha256').update(`account:${n}`).digest().subarray(0, 8)
const IX_SWEEP = disc('sweep_sol_for_swap')
const IX_BURN_VAULT = disc('burn_vault')
const IX_SPLIT = disc('split_revenue')

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
/** The lock deadline lives in launch/mainnet-init.json with every other launch
 *  value (round 22, A5: an env var nothing set). The env var may only override it. */
function lockDeadline() {
  const env = Number(process.env.CBOB_LOCK_DEADLINE || 0)
  if (env > 0) return env
  try { const v = Number(JSON.parse(fs.readFileSync('/opt/cbob-vaults/launch/mainnet-init.json', 'utf8')).lock_deadline?.value)
    return v > 0 ? v : null } catch { return null }
}
const writeState = s => writeLedger(STATE_FILE, s)
const LOCK = process.env.CBOB_ALARM_LOCK || '/opt/cbob-vaults/bank/.alarm.lock'
/** ACKNOWLEDGEMENTS: `{"<kind>:<asset>": {"why": "...", "until": "<ISO date>"}}`
 *  (the shape `D.judgeAck` requires; round 22 found this comment describing an
 *  older string form).
 *  A SEPARATE FILE from state.json on purpose, the same argument as
 *  `.alarm-has-run`: deleting one must not delete the other's memory. An ack
 *  DOWNGRADES a finding to INFO with its reason attached; it never deletes it,
 *  so an accepted permanent condition stays visible and only stops paging.
 *  An unreadable or malformed file acks NOTHING — failing open here would be a
 *  way to silence every CRITICAL by corrupting one file. */
const ACKS = process.env.CBOB_ALARM_ACKS || '/opt/cbob-vaults/bank/acks.json'
/** Round 31 (L1): the newest log-gap signature a person has reviewed, written
 *  by hand to this file. Absent or unreadable means none reviewed (loud). */
const GAPS_REVIEWED = process.env.CBOB_ALARM_LOG_GAPS_REVIEWED || '/opt/cbob-vaults/bank/log-gaps-reviewed'
function readGapsReviewed() {
  try { const t = fs.readFileSync(GAPS_REVIEWED, 'utf8').trim(); return /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(t) ? t : null }
  catch { return null }
}

function readAcks() {
  // ⚠️ THE FIRST VERSION CALLED A BARE `readFileSync`, WHICH IS NOT IMPORTED HERE
  // (this file uses `fs.readFileSync`). The ReferenceError landed in this very
  // catch and returned {}, so the whole mechanism would have silently acked
  // nothing, forever, while reading as wired. A bare catch around an unresolved
  // name is indistinguishable from a missing file — which is why ABSENT and
  // BROKEN are now told apart below and only one of them is quiet.
  let raw
  try { raw = fs.readFileSync(ACKS, 'utf8') }
  catch (e) {
    if (e.code === 'ENOENT') return {}                       // no acks is normal
    console.error(`acks file ${ACKS} is present but unreadable: ${e.message} — acking NOTHING`)
    return {}
  }
  const { acks, problem } = D.parseAcks(raw)
  if (problem) console.error(`acks file ${ACKS} is present but ${problem} — acking NOTHING`)
  return acks
}
/** cron is `23,53 * * * *`. Three missed passes is an outage worth naming. */
const EXPECTED_INTERVAL_MS = 30 * 60_000
const pda = (seeds, prog) => PublicKey.findProgramAddressSync(seeds, prog)[0]
const ata = (mint, owner) => PublicKey.findProgramAddressSync(
  [owner.toBuffer(), TOK.toBuffer(), mint.toBuffer()], ATA_P)[0]

/** DAS: every asset in the collection. A vault we do not know about is a vault
 *  nothing is watching, so this list failing is itself an alarm. */
async function listVaults(collection) {
  const live = [], burnt = [], all = []
  const MAX_PAGES = 50
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetch(rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'v', method: 'getAssetsByGroup',
        params: { groupKey: 'collection', groupValue: collection, page, limit: 1000 } }) })
    // ONE JUDGEMENT, TWO CALLERS. This used to be `j.result?.items || []`, so a
    // 200 carrying `{}` or `{result:null}` read as "this collection contains no
    // vaults" — and `detectNestedVaults` and `detectUndeclaredTokenAccounts`,
    // which ARE the post-hoc half of the control table, would each report a
    // clean all-clear over an empty list. Round 15 hardened the same shape in
    // cosign.mjs and left this one. See `judgeDasEnvelope`.
    const env = D.judgeDasEnvelope({ ok: r.ok, status: r.status, json: await r.json() })
    if (env.problem) throw new Error(`DAS getAssetsByGroup: ${env.problem}`)
    const items = env.items
    for (const i of items) {
      (i.burnt ? burnt : live).push(i.id)
      // THE OWNER WAS ALREADY ON THE WIRE AND WAS BEING DISCARDED. It is the only
      // instrument that can see a vault nested inside another vault: nesting is a
      // plain Core TransferV1 touching none of our programs, so no signature scan
      // can see it, and `getTokenAccountsByOwner` is structurally blind to a Core
      // asset. Keeping it costs nothing — same call, same page.
      all.push({ id: i.id, owner: i.ownership?.owner ?? null, burnt: !!i.burnt })
    }
    if (items.length < 1000) return { live, burnt, all }
  }
  // A cap that stops quietly is a cap that reports "all clear" about vaults it
  // never looked at. max_supply is 2,100, so reaching this means something is
  // very wrong with either the collection or the index.
  throw new Error(`collection has more than ${MAX_PAGES * 1000} assets — refusing to report on a truncated vault list`)
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

async function readConfigs() {
  const snap = {}
  // EVERY STRUCT IS READ THROUGH bank/layout.mjs: owner, discriminator and layout
  // version are pinned before a single field is decoded, and the field list is
  // asserted against the Rust in bank/selftest.mjs. v5 read these by hand-typed
  // offsets in four files; that map is gone. An account that is present but is
  // NOT what the layout describes THROWS — a pass that cannot read must never
  // look like a quiet one — and an ABSENT one is `<prog>._missing` (not deployed
  // yet); explicit absences are reported after the production lock deadline.
  const g = async (key, structName, seeds, prog) => {
    const addr = pda(seeds.map(x => Buffer.from(x)), prog)
    const acc = await conn.getAccountInfo(addr, 'confirmed')
    if (!acc) { snap[`${key}._missing`] = true; return }
    Object.assign(snap, L.flatten(key, L.readPinned(structName, acc, PublicKey)))
  }
  await g('seal', 'SealConfig', [L.SEEDS.sealConfig], SEAL)
  await g('mint', 'MintConfig', [L.SEEDS.mintConfig], MINT)
  await g('burn', 'BurnConfig', [L.SEEDS.burnConfig], BURN)
  await g('gov', 'GovConfig', [L.SEEDS.govConfig], GOV)
  // ---- the programs themselves ----
  // A config that never drifts proves nothing if the program reading it can be
  // replaced. BPFLoaderUpgradeable stores the upgrade authority and the bytes in
  // a separate ProgramData account, derived as ["<program>"] under the loader.
  // ⚠️ CORE IS IN THIS LIST, AND IT IS THE MOST IMPORTANT ENTRY (round 13): every
  // seal, thaw, sweep and burn is a hand-built CPI into Metaplex Core, whose
  // upgrade authority is live and not ours.
  // ROUND 25 (I2): and the four third-party programs the royalty swap trades
  // through (Orca, Meteora, Pyth's receiver and push oracle), HIGH on a change.
  const THIRD = D.THIRD_PARTY_PROGRAMS.map(([n, id]) => [n, new PublicKey(id)])
  const NOT_OURS = new Set(['core', ...THIRD.map(([n]) => n)])
  for (const [name, prog] of [['seal', SEAL], ['mint', MINT], ['burn', BURN], ['gov', GOV], ['sweep', SWEEP], ['core', CORE], ...THIRD]) {
    const [pdAddr] = PublicKey.findProgramAddressSync([prog.toBuffer()], BPF_LOADER_UPGRADEABLE)
    const acc = await conn.getAccountInfo(pdAddr, 'confirmed')
    if (!acc) {
      snap[`prog.${name}._missing`] = true
      // CORE (AND EVERY PROGRAM NOT OURS) IS NEVER "NOT DEPLOYED YET": produce a
      // value so a later change is still a drift rather than an unproduced key
      // that reads as calm.
      if (NOT_OURS.has(name)) { snap[`prog.${name}.upgrade_authority`] = 'NO_PROGRAMDATA'; snap[`prog.${name}.hash`] = 'NO_PROGRAMDATA' }
      continue
    }
    // ⚠️ 45 IS RIGHT EVEN WHEN THE AUTHORITY IS ABSENT — measured round 16, see
    // `D.readProgramData`. The ELF never moves when the authority is cleared.
    const pdInfo = D.readProgramData(acc.data)
    if (pdInfo.problem) throw new Error(`ProgramData for ${name} is unreadable: ${pdInfo.problem}`)
    snap[`prog.${name}.upgrade_authority`] = pdInfo.hasAuth
      ? new PublicKey(acc.data.subarray(13, 45)).toBase58()
      : 'IMMUTABLE'
    snap[`prog.${name}.hash`] = createHash('sha256').update(acc.data.subarray(pdInfo.elfOffset)).digest('hex').slice(0, 32)
  }
  // THE COLLECTION'S PLUGINS — the fixed 10% royalty lives here, with plugin
  // authority None. The whole account cannot be hashed in v6: `num_minted` and
  // `current_size` move with every mint, so a whole-account hash would page on
  // every sale. The plugin region after the base fields is what must not move.
  if (snap['mint.collection']) {
    const acc = await conn.getAccountInfo(new PublicKey(snap['mint.collection']), 'confirmed')
    snap['collection.plugins_hash'] = acc ? L.collectionPluginsHash(acc.data) : 'ABSENT'
  }
  // AND THE PROOF OF BURN COLLECTION, which is not ours (red-team 2, finding 1).
  if (snap['mint.pob_collection']) {
    const acc = await conn.getAccountInfo(new PublicKey(snap['mint.pob_collection']), 'confirmed')
    snap['pob_collection.plugins_hash'] = acc ? L.collectionPluginsHash(acc.data) : 'ABSENT'
    // ...and WHO can change those plugins (Gary kept that key hot: page on any move).
    snap['pob_collection.update_authority'] = acc && acc.data.length >= 33 && acc.data[0] === 5
      ? new PublicKey(acc.data.subarray(1, 33)).toBase58() : 'ABSENT'
  }
  // EVERY KEY THE DETECTORS WATCH MUST ACTUALLY BE PRODUCED HERE: a watched key
  // nobody populates is a control that does not run, and it reads as calm.
  const missing = D.missingWatchedKeys(snap)
  if (missing.length) {
    throw new Error(`readConfigs does not produce ${missing.join(', ')}, which detectors watch. `
      + 'A watched key that nothing populates is a control that does not run.')
  }
  return snap
}

/** The pool's cbBTC account, as `D.detectPoolHealth` wants it: spl.mjs's
 *  absent/foreign/malformed/ok, plus the frozen flag (state byte 108). */
async function readPool(cfg) {
  if (!cfg['mint.pool_ata']) return null
  // ONE read for the pool AND the config whose `owed_scaled` it is judged against
  // (round 22, A2): read apart, a claim landing in between made a solvent pool
  // read as insolvent.
  const mintCfg = pda([Buffer.from(L.SEEDS.mintConfig)], MINT)
  const [cInfo, info] = await conn.getMultipleAccountsInfo([mintCfg, new PublicKey(cfg['mint.pool_ata'])], 'confirmed')
  const fresh = cInfo ? L.readPinned('MintConfig', cInfo, PublicKey) : null
  const r = readTokenAccount(info)
  return { ...r, owedScaled: fresh ? String(fresh.owed_scaled) : null,
    frozen: r.state === 'ok' && info.data.length > L.TOKEN_STATE_OFF && info.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
}

/**
 * THE COMPLETENESS RECONCILE — the one thing the signature tail structurally
 * cannot do, and the one BURN's own header already promised existed.
 *
 * `programs/cbob-vault-burn/src/lib.rs` says the non-ATA gap is covered by "the
 * off-chain scanner, which uses getTokenAccountsByOwner and DOES see non-ATA
 * accounts". Until round 6 NO SHIPPED FILE CALLED IT. That mattered more than a
 * missing feature: creating a token account owned by a vault PDA needs no
 * signature from the PDA and touches none of our programs, so such a
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
  const prev = readLedger(RECONCILE_STATE, null)
  const cfg = await readConfigs()
  const collection = cfg['mint.collection']
  if (!collection || cfg['mint._missing']) { console.log('nothing deployed to reconcile'); return }
  const { live, burnt, all: everyVault } = await listVaults(collection)
  const indexFindings = D.detectIndexShortfall(cfg['mint.minted_total'], live, burnt, { mintedAfter: await readMintedTotal() })
  const complete = cfg['mint.minted_total'] !== undefined && cfg['mint.minted_total'] !== null && indexFindings.length === 0
  const findings = [...indexFindings,
    ...D.detectNestedVaults(everyVault,
      id => pda([Buffer.from('mpl-core-execute'), new PublicKey(id).toBuffer()], CORE).toBase58(),
      k => PublicKey.isOnCurve(new PublicKey(k).toBytes()))]
  const reserve = (cfg['seal.reserve_mints'] || []).map(m => new PublicKey(m))
  let scanned = 0, accounts = 0
  for (const v of live) {
    const p = pda([Buffer.from('mpl-core-execute'), new PublicKey(v).toBuffer()], CORE)
    const expected = new Set(reserve.map(m => ata(m, p).toBase58()))
    for (const prog of [TOK, new PublicKey(D.TOKEN22_ID)]) {
      const r = await conn.getTokenAccountsByOwner(p, { programId: prog }, 'confirmed')
      const owned = r.value.map(({ pubkey, account }) => ({ address: pubkey.toBase58(),
        amount: readTokenAccount(account).amount }))
      accounts += owned.length
      // The JUDGEMENT lives in a pure, both-ways-tested detector; this loop is
      // only the I/O that cannot be exercised on a local validator.
      findings.push(...D.detectUndeclaredTokenAccounts(v, expected, owned))
    }
    scanned++
  }
  console.log(`reconcile: ${scanned} vaults, ${accounts} token accounts, ${findings.length} findings`)
  const prevPaged = [...(prev?.paged || []), ...(fs.existsSync(RECONCILE_FAILED) ? ['reconcile_failed'] : [])]
  const sent = await report(D.applyAcks(findings, readAcks()),
    { vaults: scanned, txs: 0, programs: 0, burnt: burnt.length }, cfg, false,
    { prevPaged, fullPass: complete, scope: 'reconcile', prefix: RECONCILE_LABEL, failedMarker: RECONCILE_FAILED })
  if (!DRY) writeLedger(RECONCILE_STATE, { at: new Date().toISOString(),
    paged: sent.delivered && complete ? sent.paged : [...new Set([...prevPaged, ...sent.paged])] })
}

/** Round 24 (L9): `minted_total` AFTER the DAS walk, so a sale landing during
 *  the walk is a race the index check can recognise, not a CRITICAL. A failed
 *  read returns null, which leaves the check exactly as strict as before. */
async function readMintedTotal() {
  try {
    const acc = await conn.getAccountInfo(pda([Buffer.from(L.SEEDS.mintConfig)], MINT), 'confirmed')
    const c = acc ? L.readPinned('MintConfig', acc, PublicKey) : null
    return c ? String(c.minted_total) : null
  } catch { return null }
}

async function main() {
  const started = new Date().toISOString()
  const wallSec = Math.floor(Date.now() / 1000)
  const nowSec = clockUnixTimestamp((await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'confirmed'))?.data)
  if (nowSec === null) throw new Error('Clock sysvar unreadable; chain deadlines were not evaluated')
  const prev = readState()
  // ABSENT IS NOT A FIRST RUN once the pipeline has ever run. The marker is
  // deliberately separate from the state file so deleting one does not delete
  // the other's memory of it.
  const EVER = process.env.CBOB_ALARM_EVER || '/opt/cbob-vaults/bank/.alarm-has-run'
  /** ONE writer for the marker, used by both the idle and the busy branch. NOT
   *  swallowed — a marker that fails to write is how a deleted state file later
   *  reads as day one, which is the whole thing it exists to prevent. */
  const markEver = () => { if (!DRY) fs.writeFileSync(EVER, started) }
  if (!prev && fs.existsSync(EVER) && !ARGS.has('--first-run')) {
    throw new Error(`${STATE_FILE} is missing, but ${EVER} says this pipeline has run before. `
      + 'Every drift comparison is against that file, so a fresh one silently adopts whatever is on chain right now as correct. '
      + 'Restore it, or pass --first-run deliberately after satisfying yourself the current config is the intended one.')
  }
  let findings = []
  const looked = { vaults: 0, txs: 0, programs: 0 }

  // A pass that did not happen is the one thing this pipeline cannot see about
  // itself. (The real dead-man's switch is the separate cron in cron-install.sh.)
  if (prev?.startedAt) {
    const gap = Date.now() - Date.parse(prev.startedAt)
    if (gap > 3 * EXPECTED_INTERVAL_MS) {
      findings.push({ kind: 'watchdog_gap', severity: 'HIGH',
        detail: `this pipeline last ran ${Math.round(gap / 60000)} minutes ago (expected every ${EXPECTED_INTERVAL_MS / 60000}). Nothing was watching in between.` })
    }
  }

  // THE ONE TRUSTED HOP, counted. v6 kept exactly one off-chain money step —
  // royalty SOL -> cbBTC through the swap operator — and this is its ledger. A
  // ledger we cannot read is a CRITICAL, not a shrug.
  const LEDGER = process.env.CBOB_REVENUE_LEDGER || '/opt/cbob-vaults/bank/revenue-ledger.json'
  let led = null
  try { led = JSON.parse(fs.readFileSync(LEDGER, 'utf8')) } catch { led = null }
  // JUDGED AFTER THE SIGNATURE WALK (round 24, L10/L11): its grace windows and
  // its unsplit check now rest on the sweeps and splits the walk read off chain.
  // The two early returns below judge it on the ledger alone.

  const cfg = await readConfigs()
  findings.push(...D.detectConfigDrift(prev?.config, cfg))
  findings.push(...D.detectStandingRisks(cfg, { production: PRODUCTION }))
  findings.push(...D.detectBrakeTransitions(prev?.config, cfg))
  // The lock date is the EARLIER of the box file and MINT's immutable
  // `charter_opens_at` (round 23, L12): the file alone could be unset or late.
  const lockGate = { lockDeadlineSec: D.lockDeadlineOf(lockDeadline(), cfg['mint.charter_opens_at']), nowSec, production: PRODUCTION }
  findings.push(...D.detectUpgradeAuthorityAfterLock(cfg, lockGate))
  findings.push(...D.detectMissingComponents(cfg, lockGate))

  // What the last delivered full pass paged, and whether the last RUN died: the
  // kinds a clean pass sends a RECOVERY for (round 24, H1).
  const prevPaged = [...(prev?.paged || []), ...(fs.existsSync(RUN_FAILED) ? ['run_failed'] : [])]
  const collection = cfg['mint.collection']
  if (!collection || cfg['mint._missing']) {
    // "not initialised" and "the RPC did not answer" are the same null. If a
    // PREVIOUS pass read this account, it cannot have un-existed.
    if (prev?.config?.['mint.collection']) {
      findings.push({ kind: 'config_vanished', severity: 'CRITICAL',
        detail: `MINT's config read as absent this pass, but a previous pass read it at ${prev.config['mint.collection']}. A config account cannot un-exist: this is a failed read or a closed account, and either needs a human.` })
      findings.push(...D.detectUnreconciledRevenue(led, { now: wallSec * 1000, chainNow: nowSec * 1000, sweeps: prev?.seenSweeps || [] }))
      return (await report(findings, looked, cfg, false, { fullPass: false })).delivered     // state deliberately NOT advanced
    }
    console.log('mint config not initialised — nothing to watch yet')
    // REPORT FIRST, THEN ADVANCE — and not at all under --dry-run.
    findings.push(...D.detectUnreconciledRevenue(led, { now: wallSec * 1000, chainNow: nowSec * 1000, sweeps: prev?.seenSweeps || [] }))
    const idle = await report(findings, looked, cfg, true, { prevPaged })
    const idleDelivered = idle.delivered && !DRY
    if (idleDelivered) {
      writeState({ startedAt: started, config: D.carryConfigBaseline(prev?.config, cfg), balances: {}, vaults: [],
        cursors: prev?.cursors || {}, backlogs: prev?.backlogs || {}, logGaps: prev?.logGaps || [], paged: idle.paged })
      markEver()
    }
    return idleDelivered
  }

  // ---- THE POOL AND THE PAYOUT CLOCK (v6) ----
  // The pool holds every distributed-but-undelivered sat. Its health and the
  // monthly clock are the two liveness facts nothing on chain can report.
  const pool = await readPool(cfg)
  const cfgAtPool = pool?.owedScaled ? { ...cfg, 'mint.owed_scaled': pool.owedScaled } : cfg
  findings.push(...D.detectPoolHealth(cfgAtPool, pool))
  const poolAvail = pool?.state === 'ok' ? D.poolAvailable(cfgAtPool, pool.amount) : null
  findings.push(...D.detectDistributionOverdue(cfg, { nowSec, poolAvail,
    graceSecs: Number(process.env.CBOB_DISTRIBUTION_GRACE_SECS || 6 * 3600) }))
  findings.push(...D.detectRedemptionRate(cfg, nowSec))
  findings.push(...D.detectRevealStall(prev?.config, cfg))
  // ── MINT-PRICE cbBTC WAITING TO BE SPLIT (round 22, S1). It is split by the
  //    crank each pass; revenue sitting unsplit for hours means nobody did. READ
  //    here, JUDGED after the signature walk (round 23, M1), because the clock
  //    restarts at the last split the walk sees.
  const REVENUE_PDA = pda([Buffer.from(L.SEEDS.revenue)], MINT)
  const REVENUE_ATA = ata(new PublicKey(cfg['mint.payment_mint'] || CBBTC.toBase58()), REVENUE_PDA)
  const revenueRead = await (async () => {
    const info = await conn.getAccountInfo(REVENUE_ATA, 'confirmed')
    const r = readTokenAccount(info)
    // The state byte too (round 23, L9): frozen is paged at ANY balance.
    return { ...r, frozen: r.state === 'ok' && info.data.length > L.TOKEN_STATE_OFF && info.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
  })()
  // ── ROYALTY SOL NOBODY SWEPT (round 23, M4). Nothing read these lamports, so a
  //    dormant, wedged or dead revenue job left royalties sitting in silence.
  const royaltyLamports = BigInt(await conn.getBalance(REVENUE_PDA, 'confirmed'))
  const royalty = D.detectUnsweptRoyalties({ lamports: royaltyLamports, reserve: cfg['mint.sol_reserve_lamports'],
    floor: cfg['mint.sweep_floor_lamports'], prevLamports: prev?.royaltyLamports ?? null, prevSince: prev?.royaltySince ?? null,
    nowSec: wallSec, sweepStopped: cfg['mint.sweep_stopped'] === true, cooldownSecs: cfg['mint.sweep_cooldown_secs'] ?? null })
  findings.push(...royalty.findings)
  // ── THE CRANK'S HEARTBEAT (round 23, M3). Owed shares growing with nobody
  //    delivering them is a stall no other detector sees. Armed = our tagged
  //    full-pass crontab line carries --live (the installer's own posture test).
  // Round 24 (L4a): THREE answers. A `crontab -l` that FAILED used to read as
  // "not armed", which reset the armed-since clock and silenced crank_silent.
  let crontabRead
  try { crontabRead = { text: execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } }
  catch (e) { crontabRead = { error: { status: e.status ?? null, stderr: String(e.stderr || e.message || '') } } }
  const posture = D.detectCrankPosture({ posture: D.crankPosture(crontabRead), prevArmedSince: prev?.crankArmedSince ?? null, nowSec: wallSec })
  findings.push(...posture.findings)
  const crankArmedSince = posture.armedSince
  let beat = null
  try { beat = fs.readFileSync(process.env.CBOB_CRANK_HEARTBEAT || '/opt/cbob-vaults/bank/.crank-heartbeat', 'utf8') } catch { beat = null }
  findings.push(...D.detectCrankSilent({ stampSec: D.parseCrankHeartbeat(beat), live: posture.live, armedSinceSec: crankArmedSince, nowSec: wallSec }))
  // Judge heartbeat problems after both account-freeze findings are available.

  const { live: vaults, burnt, all: everyVault } = await listVaults(collection)
  looked.vaults = vaults.length
  looked.burnt = burnt.length

  // ---- A VAULT INSIDE A VAULT. Free: the owner came back on the same DAS page.
  findings.push(...D.detectNestedVaults(everyVault,
    id => pda([Buffer.from('mpl-core-execute'), new PublicKey(id).toBuffer()], CORE).toBase58(),
    k => PublicKey.isOnCurve(new PublicKey(k).toBytes())))
  // Does the index agree with the chain's own count of vaults ever created?
  // Re-read AFTER the walk (round 24, L9): a sale in between is a race, not a fault.
  findings.push(...D.detectIndexShortfall(cfg['mint.minted_total'], vaults, burnt, { mintedAfter: await readMintedTotal() }))
  // ---- burns, by RECONCILE: a bare Core BurnV1 cannot be caught in a signature
  //      tail, so it is caught by diffing the whole collection.
  const setChange = D.detectVaultSetChange(prev?.vaults, { live: vaults, burnt })
  findings.push(...setChange.findings)

  // `assets` includes the BURNT ones, so a bare burn that already SUCCEEDED can
  // still be named by `detectBurns`.
  const pdas = new Set(), atas = new Set(), assets = new Set([...vaults, ...burnt])
  const ataOwner = {}
  const pdaOf = {}
  const payment = new PublicKey(cfg['mint.payment_mint'] || CBBTC.toBase58())
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

  // ---- cbBTC balances, read fresh every pass ----
  // In v6 a sealed vault's balance can only RISE (contents leave only by a
  // redemption, which burns it), so ANY fall in a live vault is a finding.
  // An unreadable account carries the last known value forward rather than
  // inventing a zero (round 6: a zero there buried a real drain).
  // ROUND 22: EVERY RESERVE, not only cbBTC (A8: $GARY and $GIRAFFISH were never
  // watched while the report said "no reserve fell"), in batched reads, and a
  // FROZEN account is paged (F6: Coinbase freezing a vault's cbBTC blocks that
  // vault's claims AND its whole redemption, and nothing reported it).
  // Keys: the vault id for cbBTC (unchanged), `<vault>:<mint>` for the others.
  const balances = {}
  const reserves = (cfg['seal.reserve_mints'] || [payment.toBase58()])
  const legs = []
  for (const v of vaults) for (const m of reserves)
    legs.push({ key: m === payment.toBase58() ? v : `${v}:${m}`, vault: v, mint: m, addr: ata(new PublicKey(m), pdaOf[v]) })
  for (let i = 0; i < legs.length; i += 100) {
    const chunk = legs.slice(i, i + 100)
    let infos
    try { infos = await conn.getMultipleAccountsInfo(chunk.map(l => l.addr), 'confirmed') }
    catch {
      for (const l of chunk) if (prev?.balances?.[l.key] !== undefined) balances[l.key] = prev.balances[l.key]
      findings.push({ kind: 'balance_unreadable', severity: 'HIGH',
        detail: `could not read ${chunk.length} vault reserve account(s) this pass; their last known balances were carried forward.` })
      continue
    }
    // Round 24 (L7): EACH ELEMENT judged. A null, foreign or malformed element in a
    // call that succeeded was stored as 0: a false reserve_fell and a zeroed baseline.
    chunk.forEach((l, j) => {
      const info = infos?.[j] ?? null, r = readTokenAccount(info)
      const jr = D.judgeReserveRead(prev?.balances?.[l.key], r)
      if (jr.value !== null) balances[l.key] = jr.value
      if (jr.finding) findings.push({ kind: 'balance_unreadable', severity: 'HIGH',
        asset: l.vault, mint: l.mint, state: jr.finding.state,
        detail: `${l.key} answered as ${jr.finding.state}; its last known balance ${jr.finding.carried ?? 'unknown'} was carried forward, never read as zero.` })
      if (r.state === 'ok' && info.data.length > L.TOKEN_STATE_OFF && info.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN)
        findings.push(...D.detectFrozenVaultAccount({ vault: l.vault, mint: l.mint, isPayment: l.mint === payment.toBase58() }))
    })

  }
  findings.push(...D.detectBalanceDrops(prev?.balances, balances))

  // ---- transactions touching OUR programs, since each program's OWN cursor ----
  const cursors = { ...(prev?.cursors || {}) }
  // ROUND 30 (M1): a backlog bigger than one pass is drained, never abandoned.
  // backlogs[id] = { head, before }: `head` is the newest signature of the
  // backlog (the cursor once it drains), `before` the oldest one examined so far.
  const backlogs = { ...(prev?.backlogs || {}) }
  const seenSplits = []
  const seenSweeps = []
  const deferredSweeps = []
  for (const prog of [SEAL, MINT, BURN, GOV]) {
    const id = prog.toBase58()
    const backlog = backlogs[id] ?? null
    const walked = await walkSigs(conn, prog, cursors[id], Math.min(20, Math.ceil(PER_PROGRAM_READS / 1000)), 1000, backlog?.before)
    // Newest first, so the budget keeps the newest PER_PROGRAM_READS and the
    // rest of the window stays in the backlog for the next pass (round 31, L2).
    const sigs = walked.sigs.slice(0, PER_PROGRAM_READS), gap = walked.gap || walked.sigs.length > PER_PROGRAM_READS
    if (gap) {
      findings.push({ kind: 'scan_gap', severity: 'HIGH',
        detail: `more transactions on ${id} than one pass reads (${PER_PROGRAM_READS}) (${backlog ? 'still draining a backlog' : 'a backlog began'}). This pass walked the next ${sigs.length}; the rest, back to the cursor, are examined on later passes, resuming from the oldest one read end to end (a window with an unreadable transaction is re-read), and newer transactions only after the backlog drains. Repeated passes with this page mean someone may be flooding the program to delay detection.` })
    }
    // ⚠️ A CURSOR THE CLUSTER CANNOT RESOLVE MAKES THIS SCANNER SILENTLY BLIND:
    // an unresolvable `until` returns an EMPTY list rather than an error. An
    // empty answer while draining a backlog is checked the same way before the
    // backlog is declared drained.
    if (cursors[id] && sigs.length === 0) {
      let resolvable = null
      try {
        const st = await conn.getSignatureStatuses([cursors[id]], { searchTransactionHistory: true })
        resolvable = !!st?.value?.[0]
      } catch { resolvable = null }
      if (resolvable === false) {
        findings.push({ kind: 'scan_cursor_unresolvable', severity: 'CRITICAL',
          detail: `the scan bookmark for ${id} (${cursors[id]}) is not found by the cluster, and an unresolvable `
            + `sentinel returns an EMPTY list rather than an error — so this program has been scanned as "nothing `
            + `happened" and will be on every future pass. Clear the cursor and re-scan the window by hand.` })
      }
    }
    looked.programs++
    let unread = 0
    for (const s of sigs) {
      if (s.err) continue
      const tx = await readParsedTransaction(conn, s.signature, { truncatedLogs: 'flag' })
      if (!tx) {
        unread++
        findings.push({ kind: 'tx_unreadable', severity: 'HIGH',
          detail: `could not fetch ${s.signature} on ${id}; its instructions were NOT examined. The cursor stays where it was so the next pass tries again.` })
        continue
      }
      looked.txs++
      const ixs = D.normaliseTx(tx)
      // The other end of the trusted hop: a split OF cbBTC the scan has seen.
      // `mint` is account index 2 of SplitRevenue (config, revenue, mint, ...).
      // Round 23 (L16): with its TOTAL, read off the transfers out of the revenue
      // account, so a `splitByOther` cycle is anchored only by a split as large
      // as its return.
      if (ixs.some(ix => ix.program === MINT.toBase58() && ix.dataBytes
          && IX_SPLIT.every((b, i) => ix.dataBytes[i] === b)
          && ix.accounts?.[2] === payment.toBase58())) {
        seenSplits.push({ sig: s.signature, blockTime: s.blockTime ?? null,
          total: String(D.revenueOutflow(ixs, REVENUE_ATA.toBase58())) })
      }
      // THE PROGRAMS' OWN EVENT LINES (v6): reschedules and frozen-claim
      // deferrals are paged; attribution is by the invoke stack, so a line any
      // other program prints is ignored. Scanned once per transaction even
      // though a redemption appears in three programs' walks: keyed by sig.
      if (!looked.eventSigs) looked.eventSigs = new Set()
      if (!looked.eventSigs.has(s.signature)) {
        looked.eventSigs.add(s.signature)
        // ROUND 29 (M1): a stranger can pad any transaction that names one of
        // our programs until the runtime truncates its logs, for one fee. Its
        // event lines may be missing, so they are not read; this signature is a
        // recorded, paged coverage gap. Its instructions and token movements are
        // complete and are still checked below, and the walk moves past it,
        // because refusing the whole pass let one transaction halt every pass.
        if (tx.logsTruncated) {
          // Round 30 (L1): only a transaction in which one of our programs RAN
          // can have lost a CBOB event line (they are printed by our programs,
          // attributed by the invoke stack, and inner instructions are not
          // truncated). A stranger's padded transaction that merely NAMES one is
          // recorded at INFO, never paged, so it cannot buy an urgent page.
          const ran = [...new Set(ixs.map(ix => ix.program).filter(p => OURS.has(p)))]
          // Only real gaps go in the bounded `logGaps` record, so a stranger's
          // padding cannot push them out of it. They are judged after the
          // walk by D.detectLogGaps against the reviewed watermark (round 31, L1).
          if (ran.length) { if (!looked.logGaps) looked.logGaps = []; looked.logGaps.push(s.signature) }
          else findings.push({ kind: 'log_truncated_foreign', severity: 'INFO', signature: s.signature,
            detail: `the runtime truncated the logs of ${s.signature}, which names ${id} but executed none of our programs, so no CBOB event line can be missing. Recorded, not paged.` })
        }
        const ev = D.parseCbobLogs(tx.logsTruncated ? [] : tx.meta?.logMessages || [])
        if (ev.problem) findings.push({ kind: 'log_unparseable', severity: 'HIGH', signature: s.signature,
          detail: `the program logs of ${s.signature} could not be attributed (${ev.problem}); its CBOB events were NOT read.` })
        findings.push(...D.detectProgramEvents(ev.events, s.signature).map(f => ({ ...f, signature: s.signature })))
      }
      for (const f of [...D.detectApprovals(ixs, pdas, ataOwner),
                       ...D.detectPdaTokenAccounts(ixs, pdas, atas),
                       ...D.detectBurns(ixs, assets, BURN.toBase58(), IX_BURN_VAULT),
                       ...D.detectUnledgeredSweeps(ixs, MINT.toBase58(), IX_SWEEP, led, s.signature,
                         { blockTime: s.blockTime, now: nowSec, deferred: deferredSweeps, seenSweeps })]) {
        findings.push({ ...f, signature: s.signature })
      }
    }
    // Advance only over a window we actually read, end to end. A gap records how
    // far this pass got; the cursor moves to the backlog's head only once a
    // later pass reaches the cursor (round 30, M1).
    if (!unread) {
      if (gap) backlogs[id] = { head: backlog?.head ?? sigs[0].signature, before: sigs[sigs.length - 1].signature }
      else if (sigs.length) { cursors[id] = backlog?.head ?? sigs[0].signature; delete backlogs[id] }
      else if (backlog) {
        // An EMPTY resumed walk is not proof the backlog drained: the RPC answers
        // an unknown `before` with an empty list too, which would skip the rest
        // of the backlog forever. Require positive proof: the signature right
        // below `before` must be the cursor itself, or, with no cursor, `before`
        // must resolve and nothing may lie below it.
        let proven = false
        try {
          const below = await conn.getSignaturesForAddress(prog, { before: backlog.before, limit: 1 }, 'confirmed')
          if (cursors[id]) proven = below?.[0]?.signature === cursors[id]
          else {
            const st = await conn.getSignatureStatuses([backlog.before], { searchTransactionHistory: true })
            proven = !!st?.value?.[0] && Array.isArray(below) && below.length === 0
          }
        } catch { proven = false }
        if (proven) { cursors[id] = backlog.head; delete backlogs[id] }
        else findings.push({ kind: 'scan_backlog_unproven', severity: 'CRITICAL',
          detail: `the scan of ${id} was draining a backlog from ${backlog.before} back to its cursor ${cursors[id] ?? '(none)'}, and the resumed walk came back empty without the cluster proving it reached the cursor. The backlog was KEPT, not declared drained; if this repeats, that resume point has fallen out of the cluster's history and the window must be re-scanned by hand.` })
      }
    }
  }
  delete looked.eventSigs
  // ROUND 31 (L1): the truncation gap stands until a person has reviewed it.
  const gaps = D.detectLogGaps(prev?.logGaps, looked.logGaps, readGapsReviewed())
  findings.push(...gaps.findings)

  // Round 24 (L10c/d): every sweep the walks have ever seen, with its block time.
  const allSweeps = [...(prev?.seenSweeps || []), ...seenSweeps].filter((e, i, a) => e?.sig && a.findIndex(x => x.sig === e.sig) === i)
  const allSplits = [...seenSplits, ...(prev?.seenSplits || [])]
  findings.push(...D.detectUnreconciledRevenue(led, { splits: allSplits, sweeps: allSweeps, now: wallSec * 1000, chainNow: nowSec * 1000 }))
  findings.push(...D.detectSplitClaims(allSplits, led, { sweeps: allSweeps, now: wallSec * 1000, chainNow: nowSec * 1000 }))
  // THE UNSPLIT CLOCK, judged now the walk has seen this pass's splits (round 23:
  // M1 restarts it at the last split, L9 pages a frozen account, L10 pages an
  // unreadable one and KEEPS the clock).
  // Older snapshots mixed local observation times with chain split timestamps.
  // Page an unknown positive balance's age once, then establish a chain baseline.
  if (prev?.revenueClock !== 'chain' && prev?.revenueSince != null
      && revenueRead.state === 'ok' && BigInt(revenueRead.amount) > 0n)
    findings.push({ kind: 'revenue_age_unknown', severity: 'HIGH',
      detail: 'The existing unsplit-revenue timer used mixed clocks. Its age is unknown; inspect the positive balance now. This pass establishes a chain-clock baseline.' })
  const rev = D.detectRevenueAccount({ read: revenueRead, prevSince: prev?.revenueClock === 'chain' ? prev.revenueSince ?? null : null,
    splits: [...seenSplits, ...(prev?.seenSplits || [])], nowSec })
  const keepLegacyRevenueClock = revenueRead.state !== 'ok' && prev?.revenueClock !== 'chain' && prev?.revenueSince != null
  const revenueSince = keepLegacyRevenueClock ? prev.revenueSince : rev.since
  findings.push(...rev.findings)
  const crankHealth = D.detectCrankHealth({ beat: D.readCrankBeat(beat), prev: prev?.crankHealth ?? null,
    coveredFreezes: { pool: findings.some(f => f.kind === 'pool_frozen'),
      revenue: rev.findings.some(f => f.kind === 'revenue_account_frozen') } })
  findings.push(...crankHealth.findings)
  findings.push(...D.detectUnsplitRevenue({ amount: revenueRead.state === 'ok' ? revenueRead.amount : 0n, sinceSec: revenueSince, nowSec }))
  const dsw = D.detectDeferredSweeps([...(prev?.deferredSweeps || []), ...deferredSweeps], led, { now: nowSec })
  findings.push(...dsw.findings)

  // Round 24 (L5): the baseline keeps every key's last NON-NULL value, so a change
  // across a one-pass failed read is compared, not skipped.
  const next = { startedAt: started, config: D.carryConfigBaseline(prev?.config, cfg), balances, cursors, revenueSince, revenueClock: keepLegacyRevenueClock ? prev.revenueClock ?? null : 'chain',
    royaltySince: royalty.since, royaltyLamports: String(royaltyLamports), crankArmedSince, crankHealth: crankHealth.next,
    backlogs,
    seenSplits: D.dedupeSeenSplits([...seenSplits, ...(prev?.seenSplits || [])]), seenSweeps: allSweeps,
    deferredSweeps: dsw.keep,
    // Round 29 (M1): every signature scanned past with runtime-truncated logs.
    logGaps: gaps.keep,
    // Do not overwrite the known vault set with a list we have just reported as
    // untrustworthy, or the false reading becomes the new baseline.
    vaults: setChange.trustCurrent ? vaults : (prev?.vaults || vaults) }
  markEver()
  // LAST, over the FINISHED list: tell a redemption from a bare Core burn, then
  // apply the human's acknowledgements (which downgrade, never delete).
  next.seenRedemptions = D.rememberRedemptions(prev?.seenRedemptions || [], findings)
  findings = D.correlateBurns(findings, next.seenRedemptions)
  findings = D.applyAcks(findings, readAcks())
  // A FREEZE IS PAGED WHEN IT HAPPENS (round 24, I5), and listed at INFO while it
  // stands; the set of frozen accounts is a baseline like the balances.
  const frz = D.applyFrozenTransitions(findings, prev?.frozen || [])
  findings = frz.findings
  next.frozen = frz.frozen
  // REPORT FIRST. A DRY RUN MUST NOT CONSUME A FINDING.
  const sent = await report(findings, looked, cfg, false, { prevPaged })
  const delivered = sent.delivered && !DRY
  next.paged = sent.paged
  if (!delivered) {
    // Keep EVERY baseline, cursors included, so an undelivered finding survives
    // into the next pass whole.
    next.config = prev?.config ?? cfg
    next.balances = prev?.balances ?? balances
    next.cursors = prev?.cursors ?? {}
    next.backlogs = prev?.backlogs ?? {}
    next.revenueSince = prev?.revenueSince ?? null
    next.revenueClock = prev?.revenueClock ?? null
    next.vaults = prev?.vaults ?? next.vaults
    next.deferredSweeps = [...(prev?.deferredSweeps || []), ...deferredSweeps]
      .filter((d, i, a) => a.findIndex(x => x.sig === d.sig) === i)
    // A freeze not delivered is a freeze not yet paged; a level stream that may
    // be open is still owed its recovery.
    next.frozen = prev?.frozen ?? []
    next.paged = [...new Set([...(prev?.paged || []), ...sent.paged])]
  }
  if (!DRY) writeState(next)
}

/**
 * TELL THE ROUTER, ONE STREAM PER FINDING KIND (round 24, H1). Returns
 * `{ delivered, paged }`: `delivered` only if EVERY notice went out (the caller
 * holds every baseline otherwise), `paged` the level kinds paged this pass, which
 * the next full pass sends a RECOVERY for when they clear. The decisions are
 * `D.planAlarmNotices`, pure and proven both ways in bank/selftest.mjs; this is
 * only the printing and the sending.
 */
async function report(findings, looked, cfg, idle, { prevPaged = [], fullPass = true,
  scope = 'watch', prefix = D.ALARM_LABEL, failedMarker = RUN_FAILED } = {}) {
  const bySev = s => findings.filter(f => f.severity === s)
  const crit = bySev('CRITICAL'), high = bySev('HIGH'), info = bySev('INFO')
  // AN ACK FILE THAT NOBODY SEES IS A MUTE BUTTON. Say how many were downgraded,
  // every pass, so a growing ack list is as visible as a growing finding list.
  const acked = findings.filter(f => f.acked).length
  const lines = []
  lines.push(`CBOB vault alarm (${scope}) — ${new Date().toISOString()}`)
  if (!PRODUCTION) lines.push('⚠️ REHEARSAL: CBOB_ALARM_REHEARSAL=1, so the production value checks (test_value_in_production, the lock deadline) are OFF. This is never a mainnet report.')
  lines.push(`looked at: ${looked.vaults} vaults (${looked.burnt ?? 0} burnt), ${looked.txs} transactions across ${looked.programs} programs`)
  lines.push(`config: supply ${cfg['mint.minted_total'] ?? '?'}/${cfg['mint.max_supply'] ?? '?'}, active ${cfg['mint.active_count'] ?? '?'} (weight ${cfg['mint.total_active_weight'] ?? '?'}), last distribution ${cfg['mint.last_distribute_at'] ?? '?'}, sales ${cfg['mint.sales_stopped'] ? 'STOPPED' : 'open'}, voting ${cfg['gov.min_voting_secs'] ?? '?'}s`)
  if (acked) lines.push(`⚠️ ${acked} finding(s) DOWNGRADED by an acknowledgement in ${ACKS} — listed under INFO with the reason`)
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
    : scope === 'reconcile' ? (fullPass
      ? 'no index shortfall, nested vault or unexpected PDA token account found by this reconciliation'
      : 'incomplete reconciliation — prior conditions remain unresolved')
    // "no burns" would now be a lie in a report that lists an INFO burn beneath
    // it: under v5 a redemption IS a burn, and correlateBurns files the routine
    // ones as INFO. The all-clear may only claim the UNEXPLAINED ones.
    : 'no approvals, no unexpected PDA token accounts, no nested vaults, no burn this'
      + '\npass could not account for, no vault left the collection, no reserve fell,'
      + '\nno unreconciled sweep, no overdue distribution, a readable unfrozen pool,'
      + '\na readable unfrozen revenue account, no royalty SOL unswept for a day, no'
      + '\narmed crank without a completed full pass in 3 hours,'
      + '\nand no drift in any config value, program upgrade authority, program bytes'
      + '\nor the collection plugins.')
  lines.push('')
  lines.push('NOT CHECKED BY THIS PASS, and this list is the point of the report:')
  if (scope === 'reconcile') {
    lines.push('  * the transaction, balance, program, configuration and operational checks of the 30-minute watch.')
  } else {
  lines.push('  * a token account created for a vault PDA by a route that touches none')
  lines.push('    of our programs. No signature scan can see one — that is what')
  lines.push('    `--reconcile` is for, and it runs DAILY, not every half hour.')
  lines.push('  * anything at all before this pipeline first ran.')
  // The open/close stamp this used to point at was deleted with close_redemption.
  lines.push('  * whether a reserve that fell was redeemed legitimately or drained.')
  lines.push('    This pass can tell you it moved. A fall that ENDS in a burn this')
  lines.push('    pass could account for is a redemption; a fall with the vault still')
  lines.push('    alive is not, and only a human can tell you why.')
  }
  const text = lines.join('\n')
  console.log(text)
  const stamp = new Date().toISOString()
  const plan = D.planAlarmNotices(findings, { prevPaged, fullPass, stamp, prefix, rehearsal: !PRODUCTION })
  const urgent = crit.length + high.length
  let code = urgent ? 1 : 0
  let delivered = true
  for (const n of plan.notices) {
    console.log(`notice ${n.label}${n.urgent ? ' URGENT' : ''}${n.recovery ? ' RECOVERY' : ''}`)
    if (DRY) continue
    // ALERT_URGENT for a kind that fires ONCE (its baseline moves past it): the
    // router suppresses repeats on an open stream, and since 2026-10-05 lets an
    // URGENT emit with new text through. A LEVEL kind must NOT inherit the flag
    // from this process's environment, or every re-assertion would break through.
    const env = { ...process.env }
    delete env.ALERT_URGENT
    try {
      execFileSync(NOTIFY, [n.text, n.label], { stdio: 'ignore', env: n.urgent ? { ...env, ALERT_URGENT: '1' } : env })
    } catch (e) {
      // 2 = we found something AND could not tell anyone. This used to be set
      // and then immediately overwritten by the line below, so the worst
      // outcome the pipeline can have looked exactly like the ordinary one.
      console.error(`ALERT DELIVERY FAILED (${n.label}):`, e.message); code = 2; delivered = false
    }
  }
  // The run completed and reported: a previous FAILED TO RUN has recovered, and
  // its RECOVERY (planned above from `prevPaged`) has been sent.
  if (delivered && fullPass && !DRY && fs.existsSync(failedMarker)) { try { fs.unlinkSync(failedMarker) } catch {} }
  process.exitCode = code
  return { delivered, paged: plan.paged }
}

if (ARGS.has('--selftest')) {
  await import('./selftest.mjs')
} else if (ARGS.has('--reconcile')) {
  withLock(LOCK + '.reconcile', reconcile, { staleMs: 6 * 3600_000 }).catch(e => {
    // Round 30 (D1): a rehearsal's notices all say so (SPEC item 53).
    const msg = `CBOB VAULT${PRODUCTION ? '' : ' (REHEARSAL)'} RECONCILE FAILED: ${e.message}`
    console.error(msg)
    if (!DRY) {
      try { fs.writeFileSync(RECONCILE_FAILED, new Date().toISOString()) } catch {}
      try { execFileSync(NOTIFY, [msg, D.alarmLabel('reconcile_failed', RECONCILE_LABEL)]) } catch {}
    }
    process.exit(3)
  })
} else {
  // One runner. Two passes racing would each write the whole state file, and the
  // loser's advanced cursors would be erased — re-scanning, or worse, skipping.
  withLock(LOCK, main, { staleMs: 2 * 3600_000 }).catch(e => {
    // A pipeline that cannot read must NEVER look like a quiet one.
    const msg = e.code === 'ELOCKED'
      ? `CBOB VAULT${PRODUCTION ? '' : ' (REHEARSAL)'} ALARM DID NOT RUN: ${e.message}`
      : `CBOB VAULT${PRODUCTION ? '' : ' (REHEARSAL)'} ALARM FAILED TO RUN: ${e.message}`
    console.error(msg)
    // Its OWN stream (round 24, H1): this note used to share `cbob-vault-alarm`
    // with every finding, and held it open for two days on the live router. The
    // marker lets the next completed pass send its RECOVERY.
    if (!DRY) {
      try { fs.writeFileSync(RUN_FAILED, new Date().toISOString()) } catch {}
      try { execFileSync(NOTIFY, [msg, D.alarmLabel('run_failed')]) } catch {}
    }
    process.exit(3)
  })
}
