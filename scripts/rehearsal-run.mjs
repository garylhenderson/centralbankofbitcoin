#!/usr/bin/env node
/**
 * THE DRESS REHEARSAL, DRIVEN FROM THE BOX (SPEC road step 8, item 22).
 *
 * Gary 2026-10-08: "you sign the transactions". So the rehearsal deploys the
 * `--features localnet` build (its ONLY difference from the shipped build is
 * INIT_AUTHORITY, the seed-0x07 test key; scripts/build-mainnet.sh proves both
 * directions) at THROWAWAY program ids, and this script signs every step with
 * keys on the box. The programs are NEVER made final and are CLOSED at the end,
 * which returns their rent.
 *
 * It runs ONLY inside a recorded rehearsal tree (scripts/rehearsal-tree.sh) and
 * moves real SOL on mainnet, so it is built around five refusals and one rule:
 *   * not a recorded rehearsal tree, or the tree's release gate fails: refuse;
 *   * any program id equal to a mainnet id: refuse;
 *   * any value equal to a mainnet-only key or root (guardian, treasury, swap
 *     operator, release wallet, PoB root and collection, $CBOB mint): refuse;
 *   * the Core on the RPC is not the pinned Core: refuse;
 *   * more SOL would leave the funding wallet than --max-sol allows: refuse;
 *   * THE RULE: a step that completed is never sent again, and a step whose
 *     outcome is unknown is RE-READ from the chain, never blindly retried.
 *
 *   node scripts/rehearsal-run.mjs --rpc <url> --state <file> [--local|--mainnet]
 *        [--funding <keyfile>] [--max-sol <n>] [--execute] [--step <name>]
 *
 * Without --execute it prints every step with its estimated SOL and stops.
 * Every item-22 entry ends PASS, FAIL or NOT-RUN-HERE (with the reason) in the
 * rehearsal record (<state>.record.json and .md).
 */
import fs from 'fs'
import path from 'path'
import { execFileSync, spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, TransactionInstruction } from '@solana/web3.js'
import * as spl from '@solana/spl-token'
import { MAINNET_PROGRAMS } from '../web/src/config.js'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
export const DEPLOY_WALLET = 'FZjLB4e9mVMZTWA6YR1KbXVbByTqWsHpHy5sK83yJYUY'
export const CORE_ID = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
/** The five mainnet program ids, read from web/src/config.js: a rehearsal tree rewrites
 *  every LITERAL mainnet id under scripts/, so a copy written here would become the
 *  rehearsal's own ids and this refusal would invert (found driving the rehearsal). */
export const MAINNET_PROGRAM_IDS = { ...MAINNET_PROGRAMS }
/** Keys and roots that belong to the real launch and must never appear in a rehearsal value. */
export const MAINNET_ONLY = {
  'Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb': 'Gary\'s wallet (the mainnet guardian and init authority)',
  'bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1': 'the CBOBTC Squads (the real treasury)',
  'bipP7uK5aQDsrChYA8hpZ1Thb8BCw7emRGuEkLkHg6G': 'the ruled mainnet swap operator',
  'AT2qf412jXWksizKUYCUVp7D36inN9T13FMG1YfVJLm1': 'the real $CBOB release wallet',
  'GMm2yY2z333tMkDSHTxNGuxNzr196XgWVCgr3odSKaXc': 'the real $CBOB mint',
  'F9TDm35JQYZEB1zBPJG2HRTFM3M4ukjuLTMGhk13hsnT': 'the real Proof of Burn collection',
  '522ac90e5e6b9f1f3f262056c66b3bf5c19eebe5c4070cc607896f5b87d0809c': 'the real Proof of Burn root',
}
/** The value-file keys a rehearsal must fill with its OWN, never a mainnet one. */
export const REHEARSAL_OWN_KEYS = ['guardian', 'bank_treasury', 'swap_operator', 'cbob_release_wallet', 'cbob_mint', 'pob_collection', 'pob_root', 'vault_collection']
export const PROGRAM_FILES = { seal: 'cbob_vaults', mint: 'cbob_vault_mint', burn: 'cbob_vault_burn', gov: 'cbob_vault_gov', sweep: 'cbob_vault_sweep' }
const SOL = LAMPORTS_PER_SOL

// ════════════════════════ THE GUARDS (pure, selftested) ════════════════════════

/** The tree is a recorded rehearsal tree and its release gate passes. `gate` runs release_gate. */
export function judgeTree(root, gate) {
  const bad = []
  if (!fs.existsSync(path.join(root, 'REHEARSAL-RECORD.txt'))) bad.push(`${root} is not a recorded rehearsal tree (no REHEARSAL-RECORD.txt; make one with scripts/rehearsal-tree.sh)`)
  else { const g = gate(root); if (!g.ok) bad.push(`the rehearsal tree's release gate refused: ${g.why}`) }
  return bad
}

/** The rehearsal's program ids, from the tree's own map: five, distinct, none a mainnet id. */
export function judgeProgramIds(programs) {
  const bad = [], seen = new Set(), mainnet = new Set(Object.values(MAINNET_PROGRAM_IDS))
  for (const k of Object.keys(MAINNET_PROGRAM_IDS)) {
    const id = programs?.[k]
    if (!id) { bad.push(`no rehearsal id for ${k}`); continue }
    if (mainnet.has(id)) bad.push(`${k} is a MAINNET program id (${id})`)
    if (seen.has(id)) bad.push(`${k} repeats another program's id`)
    seen.add(id)
  }
  return bad
}

/** No rehearsal value may be a mainnet-only key or root; the funding wallet must be the deploy wallet on mainnet. */
export function judgeNoMainnetKeys(values, { network, funding }) {
  const bad = []
  for (const k of REHEARSAL_OWN_KEYS) {
    const v = values?.[k]?.value
    if (v != null && MAINNET_ONLY[v]) bad.push(`${k} is ${MAINNET_ONLY[v]}`)
  }
  for (const [k, e] of Object.entries(values || {})) if (!k.startsWith('_') && typeof e?.value === 'string' && MAINNET_ONLY[e.value] && !REHEARSAL_OWN_KEYS.includes(k) && k !== 'init_authority')
    bad.push(`${k} is ${MAINNET_ONLY[e.value]}`)
  if (values?.init_authority?.value !== 'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB') bad.push('init_authority is not the localnet test key the rehearsal build carries')
  if (network === 'mainnet' && funding !== DEPLOY_WALLET) bad.push(`on mainnet the funding wallet must be the deploy wallet ${DEPLOY_WALLET}, not ${funding}`)
  return bad
}

/** The deployed Core's bytes (ProgramData after its 45-byte header) hash to the pin. */
export function judgeCore(programDataBytes, pin) {
  if (!programDataBytes) return ['Core is not on this cluster']
  const h = createHash('sha256').update(programDataBytes.subarray(45)).digest('hex')
  return h === pin ? [] : [`Core on this cluster hashes to ${h}, not the pinned ${pin}`]
}

/**
 * IS THE TREE THE RELEASE? A rehearsal of an older commit proves nothing about the
 * one that ships, so a stale tree is REFUSED before anything is deployed. Once the
 * rehearsal has started, its throwaway keys may hold value, and refreshing the tree
 * (.cache/refresh-rehearsal-r28.py) would destroy them (SPEC, round 44): the driver
 * NEVER calls it and never asks for it then; it warns and finishes with this tree.
 */
export function judgeFreshness({ treeCommit, releaseHead, started }) {
  if (!treeCommit || !releaseHead) return { refuse: ['the tree\'s source commit or the release HEAD is unreadable'], warn: [] }
  if (treeCommit === releaseHead) return { refuse: [], warn: [] }
  return started
    ? { refuse: [], warn: [`the release repo moved on (${releaseHead.slice(0, 7)}) since this tree was made (${treeCommit.slice(0, 7)}). Do NOT refresh mid-rehearsal: it would destroy throwaway keys holding value. Finish (or close) with this tree.`] }
    : { refuse: [`this tree was made from ${treeCommit.slice(0, 7)} but the release repo is at ${releaseHead.slice(0, 7)}: make a fresh rehearsal tree BEFORE anything is deployed`], warn: [] }
}

/** --max-sol: the funding wallet's drawdown since the run began, plus this step's estimate. */
export function capAllows({ startLamports, nowLamports, estimate, maxLamports }) {
  const spent = BigInt(startLamports) - BigInt(nowLamports)
  const projected = spent + BigInt(estimate)
  return { ok: projected <= BigInt(maxLamports), spent, projected }
}

/**
 * THE RULE. What to do with a step, from its recorded state, whether the chain
 * already shows it done, and what its recorded signatures say:
 *   'skip'   it completed: never sent again;
 *   'mark'   the chain shows it done: record that, send nothing;
 *   'run'    nothing of it landed (never sent, or every signature failed or expired);
 *   'stop'   a signature landed or may still land and the chain does not show it done.
 */
export function nextAction(st, { doneOnChain, sigs }) {
  if (st?.status === 'done') return 'skip'
  if (doneOnChain) return 'mark'
  if (!st || st.status === 'pending' || !st.status) return 'run'
  if (st.status === 'sending' || st.status === 'unknown') {
    if (sigs === 'none-landed') return 'run'
    return 'stop'
  }
  return 'run'
}

/** Recorded signatures, judged: 'none-landed' | 'landed' | 'pending'. A null status is
 *  'pending' until the block height passes the signature's lastValidBlockHeight; one the
 *  RPC refused at preflight was never forwarded and counts as not landed. */
export function judgeSigs(recorded, statuses, blockHeight) {
  if (!recorded?.length) return 'none-landed'
  let pending = false
  for (let i = 0; i < recorded.length; i++) {
    // refused by the RPC's preflight: never forwarded to the cluster, so it cannot land
    if (recorded[i].preflightRefused) continue
    const s = statuses[i]
    if (s && !s.err) return 'landed'
    if (s && s.err) continue
    if (!(blockHeight > recorded[i].lastValidBlockHeight)) pending = true
  }
  return pending ? 'pending' : 'none-landed'
}

// ════════════════════════ STATE ════════════════════════

export function loadState(file) {
  if (!fs.existsSync(file)) return { version: 1, created: new Date().toISOString(), steps: {}, item22: {}, costs: {} }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
export function saveState(file, st) {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(st, null, 1), { mode: 0o600 }); fs.renameSync(tmp, file)
}

// ════════════════════════ THE RUN ════════════════════════

function args(argv) {
  const a = { execute: false, step: null, maxSol: null, rpc: null, state: null, funding: null, network: null, jobsRpc: null }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1]
    if (k === '--execute') a.execute = true
    else if (k === '--local') a.network = 'local'
    else if (k === '--mainnet') a.network = 'mainnet'
    else if (k === '--rpc') { a.rpc = v; i++ } else if (k === '--state') { a.state = v; i++ }
    else if (k === '--funding') { a.funding = v; i++ } else if (k === '--max-sol') { a.maxSol = Number(v); i++ }
    else if (k === '--step') { a.step = v; i++ }
    else if (k === '--jobs-rpc') { a.jobsRpc = v; i++ }
    else throw new Error(`unknown argument ${k}`)
  }
  return a
}

const readKey = f => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, 'utf8'))))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const lamportsStr = l => `${(Number(l) / SOL).toFixed(6)} SOL`

/** The rehearsal ids from the tree's own map (right-hand side). */
export function rehearsalPrograms(root) {
  const out = {}
  for (const l of fs.readFileSync(path.join(root, '.rehearsal-map'), 'utf8').split('\n')) {
    const [, nw, name] = l.trim().split(/\s+/)
    if (name && name !== 'root') out[name] = nw
  }
  return out
}

export function runReleaseGate(root) {
  const src = fs.readFileSync(path.join(root, 'scripts/run-tests.sh'), 'utf8')
  const fn = src.slice(src.indexOf('release_gate() {'), src.indexOf('# end release_gate'))
  const r = spawnSync('bash', ['-c', `${fn}\nrelease_gate "$1"`, 'gate', root], { encoding: 'utf8' })
  return { ok: r.status === 0, why: (r.stdout + r.stderr).trim().split('\n').pop() }
}

async function main() {
  const A = args(process.argv.slice(2))
  if (!A.rpc || !A.state) throw new Error('usage: --rpc <url> --state <file> (--local|--mainnet) [--funding <keyfile>] [--max-sol <n>] [--execute] [--step <name>]')
  if (!A.network) throw new Error('say --local or --mainnet explicitly; the genesis hash must agree')
  // `--rpc box` reads the provider from the box's env file, so a key-bearing URL never sits in a process's argv (security.md #67)
  A.rpcResolved = A.rpc === 'box' ? (await import('../bank/rehearsal-env.mjs')).jobRpc() : A.rpc
  // ── the refusals that need no chain ──
  const treeBad = judgeTree(ROOT, runReleaseGate)
  if (treeBad.length) throw new Error(`REFUSED: ${treeBad.join('; ')}`)
  const programs = rehearsalPrograms(ROOT)
  const idsBad = judgeProgramIds(programs)
  if (idsBad.length) throw new Error(`REFUSED: ${idsBad.join('; ')}`)
  const conn = new Connection(A.rpcResolved, 'confirmed')
  const genesis = await conn.getGenesisHash()
  if ((genesis === MAINNET_GENESIS) !== (A.network === 'mainnet')) throw new Error(`REFUSED: --${A.network} but the RPC's genesis is ${genesis}`)
  if (A.jobsRpc && A.network === 'mainnet') throw new Error('REFUSED: --jobs-rpc is for the local proof only (sim/das-shim.mjs); on mainnet the jobs use the box provider')
  const pin = (fs.readFileSync(path.join(ROOT, 'scripts/run-tests.sh'), 'utf8').match(/^CORE_SHA256_EXPECTED=([0-9a-f]{64})$/m) || [])[1]
  const coreAcc = await conn.getAccountInfo(new PublicKey(CORE_ID))
  const corePd = coreAcc ? (await conn.getAccountInfo(new PublicKey(coreAcc.data.subarray(4, 36))))?.data : null
  const coreBad = judgeCore(corePd, pin)
  if (coreBad.length) throw new Error(`REFUSED: ${coreBad.join('; ')}`)

  const keysDir = path.join(ROOT, '.rehearsal-keys')
  const statePath = path.resolve(A.state)
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 })
  const st = loadState(statePath)
  const save = () => saveState(statePath, st)
  st.network ??= A.network; st.genesis ??= genesis; st.programs ??= programs
  {
    // the release root is ASSEMBLED: a rehearsal tree rewrites the literal path
    const treeCommit = (fs.readFileSync(path.join(ROOT, 'REHEARSAL-RECORD.txt'), 'utf8').match(/^source commit\s+([0-9a-f]{40})$/m) || [])[1]
    let releaseHead = null; try { releaseHead = execFileSync('git', ['-C', ['', 'opt', 'cbob-vaults'].join('/'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch {}
    const f = judgeFreshness({ treeCommit, releaseHead, started: Object.values(st.steps).some(x => x.status && x.status !== 'pending') })
    for (const w of f.warn) console.log(`  WARNING: ${w}`)
    if (f.refuse.length) { if (A.network === 'mainnet') throw new Error(`REFUSED: ${f.refuse.join('; ')}`); console.log(`  (local proof, not enforced) ${f.refuse.join('; ')}`) }
  }
  if (st.network !== A.network || st.genesis !== genesis) throw new Error(`REFUSED: this state file belongs to ${st.network} (${st.genesis})`)
  if (JSON.stringify(st.programs) !== JSON.stringify(programs)) throw new Error('REFUSED: this state file was made for other program ids')

  // ── the funding wallet ──
  let funding
  if (A.network === 'mainnet') {
    if (!A.funding) throw new Error('--funding <keyfile> is required on mainnet (the deploy wallet)')
    funding = readKey(A.funding)
  } else {
    const f = path.join(keysDir, 'local-funding.json')
    if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600, flag: 'wx' })
    funding = readKey(f)
    if ((await conn.getBalance(funding.publicKey)) < 40 * SOL) { const s = await conn.requestAirdrop(funding.publicKey, 60 * SOL); await conn.confirmTransaction(s, 'confirmed') }
  }
  if (A.network === 'mainnet' && funding.publicKey.toBase58() !== DEPLOY_WALLET) throw new Error(`REFUSED: the funding key is ${funding.publicKey.toBase58()}, not the deploy wallet ${DEPLOY_WALLET}`)
  st.funding ??= funding.publicKey.toBase58()
  st.fundingStartLamports ??= String(await conn.getBalance(funding.publicKey, 'confirmed'))
  const maxLamports = BigInt(Math.round((A.maxSol ?? (A.network === 'mainnet' ? 12 : 1000)) * SOL))
  save()

  const ctx = { A, conn, st, save, ROOT, keysDir, funding, programs, network: A.network, pin,
    fundingPath: A.network === 'mainnet' ? path.resolve(A.funding) : path.join(keysDir, 'local-funding.json'),
    localMintAuth: A.network === 'local' ? readKey(path.join(ROOT, 'sim', '.fixtures', 'mint-authority.json')) : null }
  const steps = (await import('./rehearsal-steps.mjs')).makeSteps(ctx)

  console.log(`rehearsal on ${A.network} (${genesis.slice(0, 8)}), tree ${ROOT}, funding ${funding.publicKey.toBase58()}`)
  console.log(`  programs: ${Object.entries(programs).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  console.log(`  Core ${pin.slice(0, 16)} pinned and live; --max-sol ${lamportsStr(maxLamports)}; state ${statePath}`)
  if (!A.execute) {
    let total = 0n
    for (const s of steps) { const e = BigInt(await s.estimate(ctx)); total += e
      console.log(`  ${(st.steps[s.name]?.status || 'pending').padEnd(8)} ${s.name.padEnd(28)} ~${lamportsStr(e)}  ${s.title}`) }
    console.log(`PLAN ONLY (no --execute): estimated peak drawdown ${lamportsStr(total)}; nothing was sent.`)
    return
  }
  const todo = A.step ? steps.filter(s => s.name === A.step) : steps
  if (A.step && !todo.length) throw new Error(`no step named ${A.step}`)
  for (const s of todo) {
    const rec = st.steps[s.name] ||= { status: 'pending', sigs: [] }
    const doneOnChain = rec.status === 'done' ? true : await s.done(ctx)
    let sigs = 'none-landed'
    if (rec.sigs?.length && rec.status !== 'done') {
      // a 'pending' signature is WAITED OUT (until its blockhash expires, at most 3 min), never re-sent
      for (let w = 0; w < 36; w++) {
        const { value } = await conn.getSignatureStatuses(rec.sigs.map(x => x.sig), { searchTransactionHistory: true })
        sigs = judgeSigs(rec.sigs, value, await conn.getBlockHeight('confirmed'))
        if (sigs !== 'pending') break
        if (w === 0) console.log(`  ${s.name}: a recorded signature may still land; waiting for its blockhash to expire`)
        await sleep(5000)
      }
    }
    const act = nextAction(rec, { doneOnChain, sigs })
    if (act === 'skip') { console.log(`= ${s.name}: done earlier`); continue }
    if (act === 'mark') { rec.status = 'done'; rec.at = new Date().toISOString(); save(); console.log(`= ${s.name}: already on chain, recorded`); continue }
    if (act === 'stop') throw new Error(`STOPPED at ${s.name}: a recorded signature ${sigs === 'landed' ? 'LANDED' : 'may still land'} but the chain does not show the step done. Inspect ${rec.sigs.map(x => x.sig).join(', ')} before anything else.`)
    const est = BigInt(await s.estimate(ctx))
    const now = BigInt(await conn.getBalance(funding.publicKey, 'confirmed'))
    const cap = capAllows({ startLamports: st.fundingStartLamports, nowLamports: now, estimate: est, maxLamports })
    if (!cap.ok) throw new Error(`STOPPED before ${s.name}: ${lamportsStr(cap.spent)} already drawn + ~${lamportsStr(est)} would pass --max-sol ${lamportsStr(maxLamports)}`)
    console.log(`> ${s.name}: ${s.title} (~${lamportsStr(est)})`)
    rec.status = 'sending'; rec.startedAt = new Date().toISOString(); rec.balanceBefore = String(now); save()
    try { rec.result = await s.run(ctx, rec) } catch (e) { rec.status = 'unknown'; rec.error = String(e.message).slice(0, 600); save(); throw e }
    if (!(await s.done(ctx))) { rec.status = 'unknown'; rec.error = 'the step ran but its read-back does not show it done'; save(); throw new Error(`STOPPED after ${s.name}: ${rec.error}`) }
    rec.status = 'done'; rec.at = new Date().toISOString()
    rec.balanceAfter = String(await conn.getBalance(funding.publicKey, 'confirmed'))
    st.costs[s.name] = String(BigInt(rec.balanceBefore) - BigInt(rec.balanceAfter)); save()
    console.log(`  done; funding wallet ${BigInt(rec.balanceBefore) >= BigInt(rec.balanceAfter) ? '-' : '+'}${lamportsStr((BigInt(rec.balanceBefore) - BigInt(rec.balanceAfter)) < 0n ? -(BigInt(rec.balanceBefore) - BigInt(rec.balanceAfter)) : BigInt(rec.balanceBefore) - BigInt(rec.balanceAfter))}`)
  }
  const { writeRecord } = await import('./rehearsal-steps.mjs')
  writeRecord(ctx)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(String(e.stack || e)); process.exit(1) })
}
