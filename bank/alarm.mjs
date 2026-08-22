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
import { readTokenAccount } from './spl.mjs'
import { signaturesSince as walkSigs } from './sigwalk.mjs'

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
const writeState = s => writeLedger(STATE_FILE, s)
const LOCK = process.env.CBOB_ALARM_LOCK || '/opt/cbob-vaults/bank/.alarm.lock'
/** ACKNOWLEDGEMENTS: `{"<kind>:<asset>": "who, why, when"}`.
 *  A SEPARATE FILE from state.json on purpose, the same argument as
 *  `.alarm-has-run`: deleting one must not delete the other's memory. An ack
 *  DOWNGRADES a finding to INFO with its reason attached; it never deletes it,
 *  so an accepted permanent condition stays visible and only stops paging.
 *  An unreadable or malformed file acks NOTHING — failing open here would be a
 *  way to silence every CRITICAL by corrupting one file. */
const ACKS = process.env.CBOB_ALARM_ACKS || '/opt/cbob-vaults/bank/acks.json'
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
    const j = await r.json()
    if (j.error) throw new Error(`DAS getAssetsByGroup: ${JSON.stringify(j.error)}`)
    const items = j.result?.items || []
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

async function readConfigs() {
  const snap = {}
  // Every one of these is a raw-offset read of an UPGRADEABLE program's account.
  // The programs pin each other's configs by discriminator AND version byte for
  // exactly that reason; this pipeline reads three of the same accounts and
  // pinned none of them. It reads the version now and reports it as drift, so a
  // layout change announces itself instead of silently moving what we think we
  // are looking at.
  const g = async (key, prog, seeds, fields, struct) => {
    const addr = pda(seeds, prog)
    const acc = await conn.getAccountInfo(addr, 'confirmed')
    if (!acc) { snap[`${key}._missing`] = true; return }
    const d = acc.data
    if (d.length < 9) { snap[`${key}._malformed`] = true; return }
    // OWNER AND DISCRIMINATOR BEFORE ANY OFFSET. Neither is a drift signal —
    // both are preconditions for the offsets below meaning anything at all.
    if (!acc.owner.equals(prog)) { snap[`${key}._wrong_owner`] = acc.owner.toBase58(); return }
    if (struct && !d.subarray(0, 8).equals(acctDisc(struct))) {
      snap[`${key}._wrong_discriminator`] = d.subarray(0, 8).toString('hex'); return
    }
    for (const [name, off, kind] of fields) {
      // EVERY WIDTH THIS FILE ASKS FOR MUST EXIST. `u32` had no case, so
      // `mint.round_id` and `mint.cap` fell through to `d[off]` and were read as
      // a single byte — a round_id of 256 would have read as 0 and drifted
      // backwards. An unknown width is now a throw, not a silent one-byte read.
      snap[`${key}.${name}`] =
        kind === 'pk'  ? new PublicKey(d.subarray(off, off + 32)).toBase58() :
        kind === 'u64' ? String(d.readBigUInt64LE(off)) :
        kind === 'i64' ? String(d.readBigInt64LE(off)) :
        kind === 'u32' ? d.readUInt32LE(off) :
        kind === 'u16' ? d.readUInt16LE(off) :
        kind === 'u8'  ? d[off] :
        (() => { throw new Error(`readConfigs: unknown field width '${kind}' for ${key}.${name}`) })()
    }
    if (key === 'seal') {
      const n = d.readUInt32LE(105)
      snap['seal.reserve_mints'] = Array.from({ length: n },
        (_, i) => new PublicKey(d.subarray(109 + i * 32, 141 + i * 32)).toBase58())
      // SEAL's pending rotations sit AFTER the reserve Vec, so their offset moves
      // with its length. That is why they are declared last: MINT and BURN read
      // this account at fixed offsets and every one of those is before the Vec.
      const after = 109 + n * 32
      if (d.length >= after + 80) {
        snap['seal.pending_bank'] = new PublicKey(d.subarray(after, after + 32)).toBase58()
        snap['seal.pending_bank_at'] = String(d.readBigInt64LE(after + 32))
        snap['seal.pending_admin'] = new PublicKey(d.subarray(after + 40, after + 72)).toBase58()
        snap['seal.pending_admin_at'] = String(d.readBigInt64LE(after + 72))
      }
    }
  }
  // offsets mirror the programs' own pinned layouts (disc 8 + version 1 first)
  await g('seal', SEAL, [Buffer.from('config')], [['version',8,'u8'],['admin',9,'pk'],['collection',41,'pk'],['bank',73,'pk']], 'Config')
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
    ['pending_bank',409,'pk'],['pending_bank_at',441,'i64'],
    ['pending_operator',449,'pk'],['pending_operator_at',481,'i64'],
    // the single output of the whole governance system, previously unwatched
    ['round_id',169,'u32'],['opens_at',173,'i64'],['closes_at',181,'i64'],
    ['price_lamports',189,'u64'],['cap',197,'u32']], 'MintConfig')
  // GovConfig grew a `version` byte at offset 8 in round 6, so every field below
  // it moved by one. It is the only place `min_voting_secs` is asserted at all,
  // and a raw-offset read of an account that can be upgraded is a silent misread
  // waiting to happen — so the version is READ and reported as drift like any
  // other watched value. A layout change now announces itself.
  // BURN gained a version byte in round 6 too, so everything below it moved by one.
  await g('burn', BURN, [Buffer.from('burn-config')], [['version',8,'u8'],['admin',9,'pk'],
    ['collection',41,'pk'],['bank',73,'pk'],
    ['pending_bank',106,'pk'],['pending_bank_at',138,'i64'],
    ['pending_admin',146,'pk'],['pending_admin_at',178,'i64']], 'BurnConfig')
  await g('gov', GOV, [Buffer.from('gov-config')], [['version',8,'u8'],['admin',9,'pk'],['collection',41,'pk'],
    ['quorum_bps',73,'u16'],['threshold_bps',75,'u16'],['min_voting_secs',77,'i64'],
    // 94, not 93. GovConfig is version(1)@8 admin(32)@9 collection(32)@41
    // quorum(2)@73 threshold(2)@75 min_voting(8)@77 proposal_count(8)@85
    // bump(1)@93 last_executed_id(8)@94 — reading it one byte low returned
    // `bump + 256 * last_executed_id`, which still drifts on any change but puts
    // a nonsense number in the one report a human reads under pressure.
    ['proposal_count',85,'u64'],['last_executed_id',94,'u64'],
    ['pending_admin',102,'pk'],['pending_admin_at',134,'i64']], 'GovConfig')
  // ---- the programs themselves ----
  // A config that never drifts proves nothing if the program reading it can be
  // replaced. BPFLoaderUpgradeable stores the upgrade authority and the bytes in
  // a separate ProgramData account, derived as ["<program>"] under the loader.
  //
  // ⚠️ CORE IS IN THIS LIST, AND IT IS THE MOST IMPORTANT ENTRY (round 13).
  // Every seal, thaw, sweep and burn is a hand-built CPI into Metaplex Core — a
  // mainnet program with a LIVE upgrade authority that has shipped upgrades
  // before. `scripts/run-tests.sh` refuses to certify unless the local Core is
  // byte-identical to the pinned mainnet dump, and then PRODUCTION NEVER LOOKED
  // AT IT AGAIN. A Core upgrade changing `UpdatePluginV1`, `ExecuteV1` or
  // `BurnV1` semantics lands on every vault we hold with no signal here, and the
  // behaviour change IS the failure — detecting it afterwards is not detection.
  // The runner's gate had no production counterpart; now it does.
  for (const [name, prog] of [['seal', SEAL], ['mint', MINT], ['burn', BURN], ['gov', GOV], ['core', CORE]]) {
    const [pdAddr] = PublicKey.findProgramAddressSync([prog.toBuffer()], BPF_LOADER_UPGRADEABLE)
    const acc = await conn.getAccountInfo(pdAddr, 'confirmed')
    if (!acc) {
      snap[`prog.${name}._missing`] = true
      // CORE IS NEVER "NOT DEPLOYED YET". It is on mainnet and every vault rests
      // on it, so an absent ProgramData account is a fact about OUR read, not
      // about Core — and leaving the key unproduced would make the drift watch
      // silently do nothing, which is the exact class this file keeps finding.
      // Produce a value so a later change is still a drift.
      if (name === 'core') { snap['prog.core.upgrade_authority'] = 'NO_PROGRAMDATA'; snap['prog.core.hash'] = 'NO_PROGRAMDATA' }
      continue
    }
    // ProgramData layout: [0..4] enum=3, [4..12] slot, [12] Option<authority>,
    // [13..45] authority when present, then the ELF.
    //
    // ⚠️ THE ELF DOES NOT ALWAYS START AT 45 (round 16, carried from 15). When the
    // authority is `None` — an IMMUTABLE program — it starts at 13, and this line
    // hashed from 45 regardless, fingerprinting the ELF with its first 32 bytes
    // cut off. Those bytes include the ENTRY POINT. The offset is now derived by
    // `readProgramData`, which is asserted both ways.
    const pd = D.readProgramData(acc.data)
    snap[`prog.${name}.upgrade_authority`] = pd.hasAuth
      ? new PublicKey(acc.data.subarray(13, 45)).toBase58()
      : 'IMMUTABLE'
    snap[`prog.${name}.hash`] = createHash('sha256').update(acc.data.subarray(pd.elfOffset)).digest('hex').slice(0, 32)
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
  // EVERY KEY THE DETECTORS WATCH MUST ACTUALLY BE PRODUCED HERE.
  //
  // `mint.pending_bank` was added to the drift list AND to the standing-risk
  // loop and never added to the reads above, so the notice period on the Bank
  // co-signer — the control that makes the wait worth anything — did not run at
  // all. Two auditors found it independently, and it is the third round running
  // in which a detector was proven in both directions while nothing checked its
  // WIRING. This is the mechanical version of that lesson: a watched key nobody
  // populates fails the pass instead of reading as calm.
  const missing = D.missingWatchedKeys(snap)
  if (missing.length) {
    throw new Error(`readConfigs does not produce ${missing.join(', ')}, which detectors watch. `
      + 'A watched key that nothing populates is a control that does not run.')
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
  const { live, burnt, all: everyVault } = await listVaults(collection)
  const findings = [...D.detectIndexShortfall(cfg['mint.minted_total'], live, burnt),
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
  report(D.applyAcks(findings, readAcks()), { vaults: scanned, txs: 0, programs: 0, burnt: burnt.length }, cfg, false)
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
  /** ONE writer for the marker, used by both the idle and the busy branch. They
   *  had drifted: the busy one stamped it, the idle one did not, so before
   *  launch an `rm state.json` re-baselined the alarm in silence. NOT swallowed
   *  — a marker that fails to write is how a deleted state file later reads as
   *  day one, which is the whole thing it exists to prevent. */
  const markEver = () => { if (!DRY) fs.writeFileSync(EVER, started) }
  if (!prev && fs.existsSync(EVER) && !ARGS.has('--first-run')) {
    throw new Error(`${STATE_FILE} is missing, but ${EVER} says this pipeline has run before. `
      + 'Every drift comparison is against that file, so a fresh one silently adopts whatever is on chain right now as correct. '
      + 'Restore it, or pass --first-run deliberately after satisfying yourself the current config is the intended one.')
  }
  let findings = []
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
  // THE BANK MUST STAY A PLAIN KEYPAIR — the one authority here that cannot be
  // moved into the multisig, because v5 needs both halves of a redemption as
  // TOP-LEVEL instructions and a Squads vault signs by CPI. Cannot be checked
  // on-chain (`is_on_curve` panics on BPF); it is one call from here.
  findings.push(...D.detectBankIsNotSignable(cfg, k => PublicKey.isOnCurve(new PublicKey(k).toBytes())))

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
    // REPORT FIRST, THEN ADVANCE — and not at all under --dry-run. This branch
    // still had the round-7 defect its busy twin had fixed: it wrote the
    // baseline before it knew the report had gone anywhere, so an undelivered
    // finding on this path would have been consumed by the pass that raised it,
    // and a dry run wrote state that only a real run is entitled to write.
    const idleDelivered = report(findings, looked, cfg, true) && !DRY
    if (idleDelivered) {
      // The EVER marker goes down with it. The busy branch writes both and this
      // one wrote only the state, so pre-launch an `rm state.json` re-baselined
      // in silence — the round-10 dry-run/marker split, mirrored in its twin.
      writeState({ startedAt: started, config: cfg, activation: {}, vaults: [], cursors: prev?.cursors || {} })
      markEver()
    }
    return idleDelivered
  }

  const { live: vaults, burnt, all: everyVault } = await listVaults(collection)
  looked.vaults = vaults.length
  looked.burnt = burnt.length

  // ---- A VAULT INSIDE A VAULT. Free: the owner came back on the same DAS page.
  // v5 turned this from stranding into destruction (every redemption now ends in
  // a burn, and `burn_vault` can only refuse a nested asset that is DECLARED), so
  // it is checked every pass rather than in the daily reconcile.
  findings.push(...D.detectNestedVaults(everyVault,
    id => pda([Buffer.from('mpl-core-execute'), new PublicKey(id).toBuffer()], CORE).toBase58(),
    k => PublicKey.isOnCurve(new PublicKey(k).toBytes())))

  // Does the index agree with the chain's own count of vaults ever created?
  // A short DAS page is indistinguishable from a small collection otherwise,
  // and everything downstream divides by what the index returned.
  findings.push(...D.detectIndexShortfall(cfg['mint.minted_total'], vaults, burnt))

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
      const bal = String(readTokenAccount(info).amount)
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
  const seenSplits = []
  // Sweeps seen too recently to judge. The cursor never goes back, so these are
  // carried in our own state and re-judged next pass — otherwise the grace
  // window is a hole rather than a delay.
  const deferredSweeps = []
  for (const prog of [SEAL, MINT, BURN, GOV]) {
    const id = prog.toBase58()
    const { sigs, gap } = await walkSigs(conn, prog, cursors[id])
    if (gap) {
      findings.push({ kind: 'scan_gap', severity: 'HIGH',
        detail: `more transactions on ${id} than one pass will page through. Older ones were NOT examined this pass; the cursor was left where it was so they are not skipped.` })
    }
    // ⚠️ A CURSOR THE CLUSTER CANNOT RESOLVE MAKES THIS SCANNER SILENTLY BLIND.
    //
    // Round 6 measured it: `until` is a SENTINEL, and one the RPC cannot resolve
    // matches nothing and returns an EMPTY LIST. The cursor is taken from a
    // 'confirmed' read, so a transaction that is later forked out — or pruned by
    // a provider rotation — leaves a bookmark pointing at nothing. Every later
    // pass then reads zero signatures with `gap:false`, raises no finding, never
    // advances the cursor, and the report prints "no approvals, no unexpected
    // PDA token accounts, no burns...". That is the round-6 defect in a new
    // shape: the scanner is dead and the report reads as an all-clear.
    if (cursors[id] && sigs.length === 0) {
      let resolvable = null
      try {
        const st = await conn.getSignatureStatuses([cursors[id]], { searchTransactionHistory: true })
        resolvable = !!st?.value?.[0]
      } catch { resolvable = null }   // could not ask; do not claim either way
      if (resolvable === false) {
        findings.push({ kind: 'scan_cursor_unresolvable', severity: 'CRITICAL',
          detail: `the scan bookmark for ${id} (${cursors[id]}) cannot be resolved by the cluster, and an unresolvable `
            + `sentinel returns an EMPTY list rather than an error — so this program has been scanned as "nothing `
            + `happened" and will be on every future pass. Clear the cursor and re-scan the window by hand.` })
      }
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
      // The other end of the trusted hop: a split the scan has actually seen.
      //
      // ⚠️ IT MUST BE A SPLIT OF cbBTC. `split_revenue` works for ANY token by
      // design (round 8), and this matched the DISCRIMINATOR alone — so anyone
      // could manufacture unlimited "splits" for a few cents: create the revenue
      // PDA's ATA for a junk mint (permissionless), the two destination ATAs,
      // send dust, call `split_revenue(junkMint)`. Each one is a real MINT
      // transaction carrying this discriminator and claimed by no cycle, which
      // satisfied BOTH closure paths — a fabricated `splitSig` and the round-11
      // `splitByOther` anchor. The reconciliation of the one trusted hop, which
      // is the alarm's entire reason for existing, was purchasable.
      //
      // `mint` is account index 2 of SplitRevenue (config, revenue, mint, ...).
      // BLOCK TIME is carried too: without it an anchor has no temporal
      // relationship to the cycle it is supposed to vouch for, so an old split
      // could vouch for a cycle that had not happened when it landed.
      if (ixs.some(ix => ix.program === MINT.toBase58() && ix.dataBytes
          && IX_SPLIT.every((b, i) => ix.dataBytes[i] === b)
          && ix.accounts?.[2] === CBBTC.toBase58())) {
        seenSplits.push({ sig: s.signature, blockTime: s.blockTime ?? null })
      }
      for (const f of [...D.detectApprovals(ixs, pdas, ataOwner),
                       ...D.detectPdaTokenAccounts(ixs, pdas, atas),
                       ...D.detectBurns(ixs, assets, BURN.toBase58(), IX_BURN_VAULT),
                       // A sweep that our own script did not make. The ledger is
                       // written by the same process that holds the operator key;
                       // this is the half of the reconciliation that is not.
                       ...D.detectUnledgeredSweeps(ixs, MINT.toBase58(), IX_SWEEP, led, s.signature,
                         { blockTime: s.blockTime, now: Math.floor(Date.now() / 1000),
                           deferred: deferredSweeps })]) {
        findings.push({ ...f, signature: s.signature })
      }
    }
    // Advance only over a window we actually read, end to end.
    if (!gap && !unread && sigs.length) cursors[id] = sigs[0].signature
  }

  findings.push(...D.detectSplitClaims([...seenSplits, ...(prev?.seenSplits || [])], led))
  // and the ones an earlier pass could not judge yet
  const dsw = D.detectDeferredSweeps([...(prev?.deferredSweeps || []), ...deferredSweeps], led)
  findings.push(...dsw.findings)

  const next = { startedAt: started, config: cfg, activation, balances, cursors,
    // NOT SLICED. A verdict that ages out of a window turns every completed
    // cycle back into a CRITICAL, forever — an alarm guaranteed to become noise
    // is an alarm nobody reads. One entry per cycle is a few hundred a year.
    // Deduped BY SIGNATURE. `new Set` over objects dedupes nothing, and these
    // are objects now; a growing duplicate list would also inflate the
    // unclaimed-anchor count, which is exactly the number an attacker wants up.
    seenSplits: D.dedupeSeenSplits([...seenSplits, ...(prev?.seenSplits || [])]),
    deferredSweeps: dsw.keep,
    // Do not overwrite the known vault set with a list we have just reported as
    // untrustworthy, or the false reading becomes the new baseline.
    vaults: setChange.trustCurrent ? vaults : (prev?.vaults || vaults) }
  // REPORT FIRST. State used to be written before the alert went out, so a
  // CRITICAL config drift whose email failed became the new baseline and was
  // never mentioned again — the loudest possible finding, silenced by the
  // pipeline's own bookkeeping.
  // NOT under --dry-run: it writes no state.json, so stamping the marker would
  // make the next REAL run refuse to start on a box that has never truly run.
  markEver()
  // A DRY RUN MUST NOT CONSUME A FINDING. `report` returns "delivered" when it
  // did not try to send, so --dry-run advanced every baseline and the CRITICAL
  // it had just printed was never mentioned again.
  // ---- LAST, over the FINISHED list: tell a redemption from a bare Core burn.
  // Every honest exit under v5 is a burn, so `vault_burned` fired CRITICAL on the
  // normal path and would have buried `vault_left_index` — the only detector that
  // sees the one attack the programs cannot prevent. Runs here because it needs
  // the signature walk's findings AND the DAS diff's, and it is pure, so it needs
  // no reordering of anything above it.
  findings = D.correlateBurns(findings)
  // ...and LAST of all, the human's answer to anything nobody can act on. A
  // finding with no way to be answered is one that gets ignored rather than
  // answered, and two detectors added in round 13 could nag CRITICAL forever.
  findings = D.applyAcks(findings, readAcks())
  const delivered = report(findings, looked, cfg, false) && !DRY
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
    // AND THE DEFERRED SWEEPS. `dsw.keep` drops anything it just REPORTED, so an
    // undelivered `unledgered_sweep` was thrown away with the alert that failed
    // to send — the loudest finding in the pipeline, deleted by the bookkeeping
    // of the pass that raised it. Round 9's own fix, one field short.
    next.deferredSweeps = [...(prev?.deferredSweeps || []), ...deferredSweeps]
      .filter((d, i, a) => a.findIndex(x => x.sig === d.sig) === i)
  }
  if (!DRY) writeState(next)
}

function report(findings, looked, cfg, idle) {
  const bySev = s => findings.filter(f => f.severity === s)
  const crit = bySev('CRITICAL'), high = bySev('HIGH'), info = bySev('INFO')
  // AN ACK FILE THAT NOBODY SEES IS A MUTE BUTTON. Say how many were downgraded,
  // every pass, so a growing ack list is as visible as a growing finding list.
  const acked = findings.filter(f => f.acked).length
  const lines = []
  lines.push(`CBOB vault alarm — ${new Date().toISOString()}`)
  lines.push(`looked at: ${looked.vaults} vaults (${looked.burnt ?? 0} burnt), ${looked.txs} transactions across ${looked.programs} programs`)
  lines.push(`config: supply ${cfg['mint.minted_total'] ?? '?'}/${cfg['mint.max_supply'] ?? '?'}, reserve mints ${(cfg['seal.reserve_mints'] || []).length}, voting ${cfg['gov.min_voting_secs'] ?? '?'}s`)
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
    // "no burns" would now be a lie in a report that lists an INFO burn beneath
    // it: under v5 a redemption IS a burn, and correlateBurns files the routine
    // ones as INFO. The all-clear may only claim the UNEXPLAINED ones.
    : 'no approvals, no unexpected PDA token accounts, no nested vaults, no burn this'
      + '\npass could not account for, no vault left the'
      + '\ncollection, no reserve fell, no unreconciled sweep, and no drift in any'
      + '\nconfig value, program upgrade authority, program bytes or the collection.')
  lines.push('')
  lines.push('NOT CHECKED BY THIS PASS, and this list is the point of the report:')
  lines.push('  * a token account created for a vault PDA by a route that touches none')
  lines.push('    of our four programs. No signature scan can see one — that is what')
  lines.push('    `--reconcile` is for, and it runs DAILY, not every half hour.')
  lines.push('  * anything at all before this pipeline first ran.')
  // The open/close stamp this used to point at was deleted with close_redemption.
  lines.push('  * whether a reserve that fell was redeemed legitimately or drained.')
  lines.push('    This pass can tell you it moved. A fall that ENDS in a burn this')
  lines.push('    pass could account for is a redemption; a fall with the vault still')
  lines.push('    alive is not, and only a human can tell you why.')
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
