#!/usr/bin/env node
/**
 * THE CRANK — layer one of "everything that can be automatic is" (v6).
 *
 * A Solana program never runs by itself; something has to send a transaction.
 * v6 gives every one of these jobs to ANYONE (they are permissionless) and has
 * ordinary traffic do the urgent ones in-line (Gary, 2026-10-03: "if our server
 * fails #2 picks up and if #2 fails #3 picks up"). This is #1: our own job, run
 * by cron, so that in the normal case nothing waits on a stranger.
 *
 * What one pass does, in this order:
 *   1. RESCHEDULE every vault whose level-draw window lapsed with no entropy
 *      (never a default level: "We can't lock everyone in the lowest level").
 *   2. CAPTURE entropy for every vault whose three slot hashes now exist.
 *   3. REVEAL levels strictly in mint order, re-sending each vault's minted
 *      attributes, which are read off the asset and checked against the hash
 *      the program stored before anything is sent.
 *   4. RETIRE vaults destroyed by a bare Core burn (their unpaid share returns
 *      to the pool and they stop counting toward the vote).
 *   5. ACTIVATE every live, revealed vault holding >= 21,000 sats of cbBTC, so
 *      a holder never has to learn the word.
 *   6. DISTRIBUTE, free, once the period has passed (the monthly path; no burn).
 *   7. DELIVER claims in batches of 14 to every vault owed a whole sat, skipping
 *      (and reporting) a frozen cbBTC account rather than wasting a fee on it.
 *
 * WHAT IT CAN NEVER DO: move value anywhere but where the program already sends
 * it. Every one of these instructions is permissionless and pins its own
 * destination; the crank's key signs only as FEE PAYER. That key is a dedicated
 * low-balance wallet (`bank/keys/crank.json`) and the crank REFUSES to run if it
 * holds more than a small ceiling, so it is never a honeypot.
 *
 * DEFAULTS TO DRY RUN: it plans and prints. `--live` sends. Installed opt-in,
 * like revenue.mjs: arming it is a launch decision, not a side effect of
 * installing the crontab.
 *
 *   node bank/crank.mjs                        # plan only
 *   node bank/crank.mjs --live                 # plan and send
 *   node bank/crank.mjs --reveal-only [--live] # the every-minute fast lane:
 *                                              # reschedule, capture, reveal only
 */
import fs from 'fs'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'
import * as L from './layout.mjs'
import { pendingSats, available } from './accrual.mjs'

export const CORE_ID = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
export const SLOT_HASHES_ID = 'SysvarS1otHashes111111111111111111111111111'
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111'
/** Fee-payer bounds. The ceiling is the honeypot guard: a crank key holding
 *  more than this is refused outright, because it only ever needs fees. */
export const FEE_CEILING_LAMPORTS = 250_000_000n     // 0.25 SOL
export const FEE_FLOOR_LAMPORTS = 5_000_000n          // 0.005 SOL

/** Anchor instruction discriminator: sha256("global:<name>")[..8]. Computed. */
export const ixDisc = n => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8)

/** Borsh `Vec<VaultAttribute>` exactly as the program hashes it. */
export function attrsBorsh(list) {
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
  const str = s => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([u32(b.length), b]) }
  return Buffer.concat([u32(list.length), ...list.flatMap(({ key, value }) => [str(key), str(value)])])
}
/** solana `hashv` is sha256 over the concatenated slices; one slice here. */
export const attrsHash = list => createHash('sha256').update(attrsBorsh(list)).digest('hex')

/** The slot after which all three entropy slot hashes exist on a fork that skips
 *  nothing: each is two 4-slot leader groups past the last (MINT `try_capture`).
 *  Skipped slots only push it later, and a NotYet answer is harmless. */
export function readySlot(revealSlot) {
  let a = Number(revealSlot)
  for (let i = 0; i < 2; i++) a = (Math.floor(a / 4) + 2) * 4
  return a
}

/** The fee payer's balance, judged: inside [floor, ceiling] or refused. */
export function judgeFeePayer(lamports, { ceiling = FEE_CEILING_LAMPORTS, floor = FEE_FLOOR_LAMPORTS } = {}) {
  const l = BigInt(lamports)
  if (l > ceiling) return { ok: false, why: `the crank key holds ${l} lamports, above the ${ceiling} ceiling. It only ever pays fees; a funded crank key is a honeypot. Move the excess out before it runs.` }
  if (l < floor) return { ok: false, why: `the crank key holds ${l} lamports, below the ${floor} it needs for a pass. Top it up (fees only).` }
  return { ok: true, why: null }
}

/**
 * PLAN ONE PASS. Pure: everything it needs is passed in, so it is proven both
 * ways in bank/selftest.mjs and the I/O below is only fetching and sending.
 *
 * @param s.cfg       decoded MintConfig (layout.mjs; BigInt fields)
 * @param s.records   [{ address, ...decoded VaultRecord }]
 * @param s.assets    { [asset]: 'live' | 'burned' | 'other' }
 * @param s.tokens    { [asset]: { state, amount: bigint, frozen, address } } — the
 *                    vault's CANONICAL cbBTC account (for activation), and for an
 *                    active vault its RECORDED account (for claims)
 * @param s.pool      { state, amount: bigint, frozen }
 * @param s.slot      current slot; s.nowSec — current unix time
 */
export function planCrank(s, opts = {}) {
  const { cfg, records, assets = {}, tokens = {}, pool, slot, nowSec } = s
  const batch = opts.batch ?? L.CLAIM_BATCH
  const plan = { reschedule: [], capture: [], reveal: [], retireBurned: [], activate: [],
    distribute: false, claims: [], deferredFrozen: [], problems: [] }
  const byIndex = new Map(records.map(r => [BigInt(r.mint_index), r]))
  const capturedThisPass = new Set()

  for (const r of records) {
    if (r.level !== 0 || r.entropy_set) continue
    const rs = BigInt(r.reveal_slot)
    if (BigInt(slot) > rs + BigInt(L.REVEAL_WINDOW_SLOTS)) plan.reschedule.push(r.address)
    else if (slot > readySlot(r.reveal_slot)) { plan.capture.push(r.address); capturedThisPass.add(r.address) }
  }

  // REVEAL IN MINT ORDER, from `revealed_total`, while the next vault is ready.
  // One not ready stops the run: the program refuses out-of-order draws anyway.
  for (let i = BigInt(cfg.revealed_total); ; i++) {
    const r = byIndex.get(i)
    if (!r || r.level !== 0) break
    if (!(r.entropy_set || capturedThisPass.has(r.address))) break
    plan.reveal.push(r.address)
  }

  // THE FAST LANE ends here. The capture window is ~300 slots (about two
  // minutes), so the reveal steps run every minute with only the unrevealed
  // records fetched; everything below runs on the slower full pass.
  if (opts.revealOnly) return plan

  // RETIRE BARE BURNS. A vault the program has not retired whose asset is
  // positively burned. (A redemption retires itself inside burn_vault.)
  for (const r of records) {
    if (!r.retired && assets[r.asset] === 'burned' && r.level !== 0) plan.retireBurned.push(r.address)
  }

  // ACTIVATE: revealed, not active, not retired, LIVE, and >= 21,000 sats in its
  // own canonical cbBTC account. A frozen account still activates (the program
  // reads the balance, not the state) — the claim is what defers.
  for (const r of records) {
    if (r.level === 0 || r.active || r.retired || assets[r.asset] !== 'live') continue
    const t = tokens[r.asset]
    if (!t || t.state !== 'ok') continue
    if (BigInt(t.amount) >= L.ACTIVATION_SATS) plan.activate.push(r.address)
  }

  // DISTRIBUTE (the free monthly path): due, someone to pay, something to pay.
  let acc = BigInt(cfg.acc_scaled)
  const w = BigInt(cfg.total_active_weight)
  const poolOk = pool && pool.state === 'ok'
  if (!poolOk) plan.problems.push(`the pool account is ${pool ? pool.state : 'unread'}; nothing can be distributed or claimed`)
  else if (pool.frozen) plan.problems.push('the pool cbBTC account is FROZEN; claims would all refuse')
  const due = BigInt(nowSec) >= BigInt(cfg.last_distribute_at) + BigInt(cfg.monthly_secs)
  if (poolOk && due && w > 0n) {
    const avail = available(pool.amount, cfg.owed_scaled)
    if (avail > 0n) {
      plan.distribute = true
      acc += avail * L.ACC_SCALE / w        // so this pass also delivers it
    }
  }

  // DELIVER: active, owed >= 1 whole sat at the post-distribution acc. A missing
  // recorded account would refuse the WHOLE batch on chain, so it is reported
  // instead of sent; a frozen one is skipped and stays owed.
  if (poolOk && !pool.frozen) {
    const ready = []
    for (const r of records) {
      if (!r.active || r.retired) continue
      let owed
      try { owed = pendingSats({ level: r.level, debt: r.debt_scaled }, acc) }
      catch (e) { plan.problems.push(`vault ${r.asset}: ${e.message}`); continue }
      if (owed < 1n) continue
      const t = tokens[r.asset]
      if (!t || t.state !== 'ok' || t.address !== r.vault_ata) {
        plan.problems.push(`vault ${r.asset} is owed ${owed} sats but its recorded cbBTC account ${r.vault_ata} is ${t ? t.state : 'unread'}; a claim never creates one, so it was left out of every batch`)
        continue
      }
      if (t.frozen) { plan.deferredFrozen.push({ asset: r.asset, owed }); continue }
      ready.push([r.address, r.vault_ata])
    }
    for (let i = 0; i < ready.length; i += batch) plan.claims.push(ready.slice(i, i + batch))
  }
  return plan
}

/** One line per action, for the log and for a human reading a dry run. */
export function describePlan(p) {
  return [
    `reschedule ${p.reschedule.length}, capture ${p.capture.length}, reveal ${p.reveal.length} (in mint order), `
      + `retire bare burns ${p.retireBurned.length}, activate ${p.activate.length}, `
      + `distribute ${p.distribute ? 'YES (monthly, free)' : 'no'}, claim batches ${p.claims.length} `
      + `(${p.claims.reduce((a, b) => a + b.length, 0)} vaults), frozen deferred ${p.deferredFrozen.length}`,
    ...p.problems.map(x => `  PROBLEM: ${x}`),
  ].join('\n')
}

// ═══════════════════════════════════ I/O ═══════════════════════════════════
async function main() {
  const { PublicKey, Connection, Keypair, Transaction, TransactionInstruction, SystemProgram,
    sendAndConfirmTransaction } = await import('@solana/web3.js')
  const { readTokenAccount } = await import('./spl.mjs')
  const { execFileSync } = await import('child_process')
  const LIVE = process.argv.includes('--live')
  const REVEAL_ONLY = process.argv.includes('--reveal-only')
  const NOTIFY = '/opt/scripts/notify-gary-sms.sh'
  const env = fs.readFileSync('/opt/gary-club/.env.local', 'utf8')
  const rpc = (env.match(/^HELIUS_RPC_URL=(.*)$/m) || [])[1]?.trim()
  if (!rpc) throw new Error('HELIUS_RPC_URL not found')
  const conn = new Connection(rpc, 'confirmed')
  const P = k => new PublicKey(k)
  const MINT = P(L.PROGRAM_IDS.mint)
  const pda = (seeds, prog) => PublicKey.findProgramAddressSync(seeds, prog)[0]
  const MINT_CFG = pda([Buffer.from(L.SEEDS.mintConfig)], MINT)
  const MINT_AUTH = pda([Buffer.from(L.SEEDS.mintAuthority)], MINT)
  const vrec = a => pda([Buffer.from(L.SEEDS.vault), P(a).toBuffer()], MINT)
  const signerPda = a => pda([Buffer.from('mpl-core-execute'), P(a).toBuffer()], P(CORE_ID))
  const ataOf = (mint, owner) => pda([owner.toBuffer(), P(TOKEN_PROGRAM_ID).toBuffer(), mint.toBuffer()],
    P('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))

  const cfgAcc = await conn.getAccountInfo(MINT_CFG, 'confirmed')
  const cfg = L.readPinned('MintConfig', cfgAcc, PublicKey)
  if (!cfg) { console.log('MINT config not initialised — nothing to crank'); return }

  // Every VaultRecord: filtered by discriminator, each one pinned by layout.
  const disc = createHash('sha256').update('account:VaultRecord').digest().subarray(0, 8)
  const bs58 = (await import('bs58')).default
  // The fast lane fetches only records whose level is still 0 (offset from the
  // layout, never typed): at 2,100 vaults that is the difference between ~460 KB
  // a minute and a few records.
  const raw = await conn.getProgramAccounts(MINT, { commitment: 'confirmed',
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(disc) } },
      ...(REVEAL_ONLY ? [{ memcmp: { offset: L.offsets('VaultRecord').level, bytes: bs58.encode(Buffer.from([0])) } }] : [])] })
  const records = raw.map(({ pubkey, account }) => ({ address: pubkey.toBase58(), ...L.decode('VaultRecord', account.data) }))

  const getMany = async keys => {
    const out = []
    for (let i = 0; i < keys.length; i += 100) out.push(...await conn.getMultipleAccountsInfo(keys.slice(i, i + 100), 'confirmed'))
    return out
  }
  const assetInfos = await getMany(records.map(r => P(r.asset)))
  const assets = {}
  records.forEach((r, i) => {
    const a = assetInfos[i]
    assets[r.asset] = !a ? 'other'
      : a.owner.toBase58() === CORE_ID && a.data.length === 1 && a.data[0] === 0 ? 'burned'
      : a.owner.toBase58() === CORE_ID && a.data[0] === 1 ? 'live' : 'other'
  })
  const payMint = P(cfg.payment_mint)
  const tokenAddr = r => r.active ? r.vault_ata : ataOf(payMint, signerPda(r.asset)).toBase58()
  const tokInfos = await getMany(records.map(r => P(tokenAddr(r))))
  const tokens = {}
  records.forEach((r, i) => {
    const info = tokInfos[i], t = readTokenAccount(info)
    tokens[r.asset] = { ...t, address: tokenAddr(r),
      frozen: t.state === 'ok' && info.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
  })
  const poolInfo = await conn.getAccountInfo(P(cfg.pool_ata), 'confirmed')
  const pt = readTokenAccount(poolInfo)
  const pool = { ...pt, frozen: pt.state === 'ok' && poolInfo.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
  const slot = await conn.getSlot('confirmed')
  const nowSec = Math.floor(Date.now() / 1000)

  const plan = planCrank({ cfg, records, assets, tokens, pool, slot, nowSec }, { revealOnly: REVEAL_ONLY })
  console.log(`crank ${new Date().toISOString()}  slot ${slot}  records ${records.length}`)
  console.log(describePlan(plan))
  if (!LIVE) { console.log('\nDRY RUN. Re-run with --live to send.'); return }

  // ── the fee payer: dedicated, low balance, refused above a ceiling ──
  const KEY = process.env.CBOB_CRANK_KEY || '/opt/cbob-vaults/bank/keys/crank.json'
  const mode = fs.statSync(KEY).mode & 0o777
  if (mode & 0o077) throw new Error(`${KEY} is mode ${mode.toString(8)}; it must be 600`)
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEY, 'utf8'))))
  const fee = judgeFeePayer(BigInt(await conn.getBalance(payer.publicKey, 'confirmed')))
  if (!fee.ok) throw new Error(fee.why)

  const d = n => ixDisc(n)
  const W = (pubkey, w = true) => ({ pubkey: P(pubkey), isSigner: false, isWritable: w })
  const R = pubkey => W(pubkey, false)
  const byAddr = new Map(records.map(r => [r.address, r]))
  const send = async (label, ixs) => {
    try {
      const sig = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer], { commitment: 'confirmed' })
      console.log(`  ok   ${label}  ${sig}`); return true
    } catch (e) { console.log(`  FAIL ${label}: ${String(e.message).slice(0, 200)}`); return false }
  }
  const failures = []
  const run = async (label, ixs) => { if (!(await send(label, ixs))) failures.push(label) }

  for (const a of plan.reschedule) await run(`reschedule ${a}`, [new TransactionInstruction({ programId: MINT,
    data: d('reschedule_reveal'), keys: [W(a)] })])
  for (const a of plan.capture) await run(`capture ${a}`, [new TransactionInstruction({ programId: MINT,
    data: d('capture_entropy'), keys: [W(a), R(SLOT_HASHES_ID)] })])
  for (const a of plan.reveal) {
    const r = byAddr.get(a)
    let list = []
    if (assets[r.asset] === 'live') {
      list = await mintedAttributes(conn, P(r.asset))
      // THE HASH IS CHECKED HERE, BEFORE A FEE IS SPENT. The program checks it
      // too; a mismatch means this reader and the program disagree about the
      // asset, which is a fault to report, never a reveal to retry blindly.
      if (attrsHash(list) !== r.attrs_hash) { failures.push(`reveal ${r.asset}: attributes read off the asset do not hash to the stored attrs_hash`); break }
    }
    const ok = await send(`reveal #${r.mint_index} ${r.asset}`, [new TransactionInstruction({ programId: MINT,
      data: Buffer.concat([d('reveal_level'), attrsBorsh(list)]),
      keys: [W(MINT_CFG.toBase58()), W(a), W(r.asset), W(cfg.collection),
        { pubkey: payer.publicKey, isSigner: true, isWritable: true }, R(MINT_AUTH.toBase58()),
        R(SLOT_HASHES_ID), R(CORE_ID), R(SystemProgram.programId.toBase58())] })])
    if (!ok) { failures.push(`reveal ${r.asset}`); break }     // strictly in order: stop at the first failure
  }
  for (const a of plan.retireBurned) { const r = byAddr.get(a)
    await run(`retire ${r.asset}`, [new TransactionInstruction({ programId: MINT, data: d('retire_burned'),
      keys: [W(MINT_CFG.toBase58()), W(a), R(r.asset)] })]) }
  for (const a of plan.activate) { const r = byAddr.get(a)
    await run(`activate ${r.asset}`, [new TransactionInstruction({ programId: MINT, data: d('activate'),
      keys: [W(MINT_CFG.toBase58()), W(a), R(r.asset), R(tokens[r.asset].address), R(cfg.pool_ata)] })]) }
  if (plan.distribute) await run('distribute (monthly, free)', [new TransactionInstruction({ programId: MINT,
    data: Buffer.concat([d('distribute'), Buffer.from([0])]), keys: [W(MINT_CFG.toBase58()), R(cfg.pool_ata)] })])
  for (const [i, pairs] of plan.claims.entries()) await run(`claim batch ${i + 1} (${pairs.length})`, [new TransactionInstruction({
    programId: MINT, data: Buffer.concat([d('claim'), Buffer.from([0])]),
    keys: [W(MINT_CFG.toBase58()), W(cfg.pool_ata), R(TOKEN_PROGRAM_ID), ...pairs.flatMap(([rec, ata]) => [W(rec), W(ata)])] })])

  if (failures.length) {
    const msg = `CBOB crank: ${failures.length} action(s) failed — ${failures.slice(0, 3).join('; ')}`
    console.error(msg)
    try { execFileSync(NOTIFY, [msg, 'cbob-vault-crank'], { stdio: 'ignore' }) } catch {}
    process.exitCode = 1
  }
}

/** The vault's minted attribute list, read off its Core Attributes plugin. Before
 *  the reveal that list IS what the program hashed at mint (the reveal is what
 *  adds `level`), and the caller checks the hash before sending anything. */
export async function mintedAttributes(conn, assetPk) {
  const { deserializeAssetV1 } = await import('@metaplex-foundation/mpl-core')
  const info = await conn.getAccountInfo(assetPk, 'confirmed')
  if (!info) throw new Error(`asset ${assetPk.toBase58()} not found`)
  const a = deserializeAssetV1({ publicKey: assetPk.toBase58(), data: new Uint8Array(info.data),
    executable: false, owner: info.owner.toBase58(), lamports: { basisPoints: BigInt(info.lamports), identifier: 'SOL', decimals: 9 } })
  return (a.attributes?.attributeList || []).map(({ key, value }) => ({ key, value }))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { withLock } = await import('./lock.mjs')
  // Two lanes, two locks: a slow full pass must not starve the every-minute reveal.
  const LOCK = process.env.CBOB_CRANK_LOCK || `/opt/cbob-vaults/bank/.crank${process.argv.includes('--reveal-only') ? '-reveal' : ''}.lock`
  const { execFileSync } = await import('child_process')
  // A crank that cannot run must never look like a quiet one. Dry runs print
  // only; a LIVE run that fails to start pages, because then nobody is cranking.
  withLock(LOCK, main, { staleMs: 2 * 3600_000 }).catch(e => {
    console.error(`CBOB CRANK FAILED TO RUN: ${e.message}`)
    if (process.argv.includes('--live')) {
      try { execFileSync('/opt/scripts/notify-gary-sms.sh', [`CBOB CRANK FAILED TO RUN: ${e.message}`, 'cbob-vault-crank']) } catch {}
    }
    process.exit(3)
  })
}
