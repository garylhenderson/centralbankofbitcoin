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
 * What one pass does (the order it SENDS is: reschedule, capture, reveal,
 * retire, join eligible vaults, distribute, activate, claim; see main()):
 *   1. RESCHEDULE every vault whose level-draw window lapsed with no entropy
 *      (never a default level: "We can't lock everyone in the lowest level").
 *   2. CAPTURE entropy for every vault whose three slot hashes now exist.
 *   3. REVEAL levels strictly in mint order, re-sending each vault's minted
 *      attributes, which are read off the asset and checked against the hash
 *      the program stored before anything is sent.
 *   4. RETIRE vaults destroyed by a bare Core burn (their unpaid share returns
 *      to the pool and they stop counting toward the vote).
 *   5. ACTIVATE every live, revealed vault holding >= 21,000 sats of cbBTC, so
 *      a holder never has to learn the word. Since stage 3c that is a REQUEST:
 *      the vault joins the schedule only after the next distribution.
 *   6. DISTRIBUTE, free, once the period has passed (the monthly path; no burn).
 *      With nobody joined yet but vaults waiting, that run credits nothing and
 *      only advances the epoch so they can join (the launch case).
 *   7. DELIVER claims in batches of 14 to every vault owed a whole sat, skipping
 *      (and reporting) a frozen cbBTC account rather than wasting a fee on it,
 *      and JOIN every waiting vault a distribution has passed, in those batches.
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
  // OVER THE CEILING: RUN, AND SAY SO (round 22, F8). Refusing protected nothing
  // once the funds were already on the key, and it let ANYONE stop every crank
  // lane by sending it 0.25 SOL. The key still only ever signs as fee payer; the
  // excess is a honeypot a human must move, so it pages every pass until moved.
  if (l > ceiling) return { ok: true, warn: `the crank key holds ${l} lamports, above the ${ceiling} ceiling. It only ever pays fees, so the excess is a honeypot: move it out. The crank ran anyway.`, why: null }
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
  const { cfg, records, assets = {}, tokens = {}, pool, slot, nowSec, revenue = null } = s
  const batch = opts.batch ?? L.CLAIM_BATCH
  const plan = { reschedule: [], capture: [], reveal: [], retireBurned: [], activate: [],
    split: false, distribute: false, distributeKind: null, preJoins: [], joins: [], claims: [], deferredFrozen: [], problems: [] }
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

  // ACTIVATE (a request, stage 3c): revealed, not active, not already waiting,
  // not retired, LIVE, and >= 21,000 sats in its own canonical cbBTC account. A
  // frozen account still activates (the program reads the balance, not the
  // state) — the claim is what defers.
  for (const r of records) {
    if (r.level === 0 || r.active || r.pending || r.retired || assets[r.asset] !== 'live') continue
    const t = tokens[r.asset]
    if (!t || t.state !== 'ok') continue
    if (BigInt(t.amount) >= L.ACTIVATION_SATS) plan.activate.push(r.address)
  }

  // JOIN FIRST (stage 3c). A vault that asked in an EARLIER epoch is eligible, and
  // the program refuses every distribution while one waits (`JoinWaitingFirst`),
  // so they are joined in their own claim batches BEFORE the distribution.
  const destOf = r => r.pending ? r.vault_ata : tokens[r.asset]?.address
  for (const r of records) {
    if (r.retired || r.active || !r.pending) continue
    // A burned vault is RETIRED (above), never joined: joining adds weight to a
    // dead vault (red-team 3 finding 2).
    if (assets[r.asset] === 'burned') continue
    if (BigInt(r.request_epoch) >= BigInt(cfg.dist_epoch)) continue
    plan.preJoins.push([r.address, r.vault_ata])
  }
  const preJoinWeight = plan.preJoins.reduce((a, [addr]) => {
    const r = records.find(x => x.address === addr); return a + L.LEVEL_WEIGHTS[r.level - 1] }, 0n)
  // PLAN AGAINST THE STATE THIS PASS WILL HAVE MADE (round 22, F5): an active
  // vault retired above leaves the schedule before the distribution runs.
  const retiringWeight = plan.retireBurned.reduce((a, addr) => {
    const r = records.find(x => x.address === addr); return r.active ? a + L.LEVEL_WEIGHTS[r.level - 1] : a }, 0n)
  // SPLIT THE MINT-PRICE cbBTC EVERY PASS (round 22, S1): it used to be split only
  // at the end of a SOL swap cycle, so a quiet royalty week left every sale
  // unsplit and undistributed. Permissionless; destinations pinned on chain.
  let splitToPool = 0n
  if (revenue && revenue.state === 'ok' && BigInt(revenue.amount) > 0n) {
    plan.split = true
    const total = BigInt(revenue.amount)
    splitToPool = total - total * 1500n / 10000n
  }

  // DISTRIBUTE (the free monthly path): due, someone to pay, something to pay.
  let acc = BigInt(cfg.acc_scaled)
  const w = BigInt(cfg.total_active_weight) + preJoinWeight - retiringWeight
  const poolOk = pool && pool.state === 'ok'
  if (!poolOk) plan.problems.push(`the pool account is ${pool ? pool.state : 'unread'}; nothing can be distributed or claimed`)
  else if (pool.frozen) plan.problems.push('the pool cbBTC account is FROZEN; claims would all refuse')
  const due = BigInt(nowSec) >= BigInt(cfg.last_distribute_at) + BigInt(cfg.monthly_secs)
  // Activations are sent AFTER the distribution (red-team 3 finding 6: an
  // activate runs the monthly in-line first, so sending them first made the
  // explicit distribute fail as already-done), so only requests already on
  // chain can make this pass's run a tick.
  const waitingThisEpoch = BigInt(cfg.pending_this_epoch ?? 0) > 0n
  // Never from a FROZEN pool (round 22, F7): it could deliver nothing, and the
  // program's own in-line run declines to for the same reason.
  if (poolOk && !pool.frozen && due && w > 0n) {
    const avail = available(BigInt(pool.amount) + splitToPool, cfg.owed_scaled)
    if (avail > 0n) {
      plan.distribute = true; plan.distributeKind = 'credit'
      acc += avail * L.ACC_SCALE / w        // so this pass also delivers it
    }
  } else if (poolOk && !pool.frozen && due && w === 0n && waitingThisEpoch) {
    // Nobody joined, some asked this epoch (or are about to, earlier in this same
    // pass): the free run only advances the epoch, so they can join below.
    plan.distribute = true; plan.distributeKind = 'tick'
  }
  // JOIN AFTER: every vault this pass's distribution makes eligible (asked in
  // the current epoch, already on chain). Requests this pass sends land in the
  // NEW epoch and join on a later pass.
  if (plan.distribute) {
    for (const r of records) {
      if (r.retired || r.active || !r.pending || assets[r.asset] === 'burned') continue
      if (BigInt(r.request_epoch) !== BigInt(cfg.dist_epoch)) continue
      const dest = destOf(r)
      if (dest) plan.joins.push([r.address, dest])
    }
  }

  // DELIVER: active, owed >= 1 whole sat at the post-distribution acc. A missing
  // recorded account would refuse the WHOLE batch on chain, so it is reported
  // instead of sent; a frozen one is skipped and stays owed.
  if (poolOk && !pool.frozen) {
    const ready = []
    const preJoined = new Set(plan.preJoins.map(([a]) => a))
    for (const r of records) {
      // A vault joined at the start of this pass enters at the accumulator as it
      // stands and shares this pass's distribution (F5): plan its delivery too.
      const joinedNow = preJoined.has(r.address)
      if ((!r.active && !joinedNow) || r.retired) continue
      // Paying a burned vault destroys the sats; retiring it returns them.
      if (assets[r.asset] === 'burned') continue
      let owed
      const debt = joinedNow ? L.LEVEL_WEIGHTS[r.level - 1] * BigInt(cfg.acc_scaled) : r.debt_scaled
      try { owed = pendingSats({ level: r.level, debt }, acc) }
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
    // A pre-joined vault already has its own batch (it must be joined BEFORE the
    // distribution); its delivery goes in the claims after it.
    ready.push(...plan.joins)
    for (let i = 0; i < ready.length; i += batch) plan.claims.push(ready.slice(i, i + batch))
  }
  return plan
}

/** One line per action, for the log and for a human reading a dry run. */
export function describePlan(p) {
  return [
    `reschedule ${p.reschedule.length}, capture ${p.capture.length}, reveal ${p.reveal.length} (in mint order), `
      + `retire bare burns ${p.retireBurned.length}, split ${p.split ? 'YES' : 'no'}, activate ${p.activate.length}, `
      + `distribute ${p.distribute ? `YES (monthly, free${p.distributeKind === 'tick' ? ', epoch tick only' : ''})` : 'no'}, `
      + `join before ${p.preJoins.length}, join after ${p.joins.length}, claim batches ${p.claims.length} `
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
  const REVENUE = pda([Buffer.from(L.SEEDS.revenue)], MINT)
  const revAta = ataOf(payMint, REVENUE), bankAta = ataOf(payMint, P(cfg.bank_treasury))
  const revenue = readTokenAccount(await conn.getAccountInfo(revAta, 'confirmed'))
  const payDecimals = (await conn.getAccountInfo(payMint, 'confirmed'))?.data?.[44]
  const slot = await conn.getSlot('confirmed')
  const nowSec = Math.floor(Date.now() / 1000)

  const plan = planCrank({ cfg, records, assets, tokens, pool, slot, nowSec, revenue }, { revealOnly: REVEAL_ONLY })
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
  if (fee.warn) { console.error(fee.warn); try { execFileSync(NOTIFY, [`CBOB crank: ${fee.warn}`, 'cbob-vault-crank'], { stdio: 'ignore' }) } catch {} }

  const d = n => ixDisc(n)
  const W = (pubkey, w = true) => ({ pubkey: P(pubkey), isSigner: false, isWritable: w })
  const R = pubkey => W(pubkey, false)
  const byAddr = new Map(records.map(r => [r.address, r]))
  const failures = []
  // RACES ARE NOT FAILURES (round 22, F1/F2). Ordinary traffic captures and
  // reveals too, the two lanes overlap, and `readySlot` is only a LOWER bound when
  // a leader skipped a slot. Each of these refusals means "already done" or "not
  // yet", and the next pass (a minute away) picks it up; the alarm's
  // reveal_queue_stalled is what pages if nothing ever moves.
  const BENIGN = /RevealTooEarly|AlreadyCaptured|AlreadyRevealed|RevealOutOfOrder|RescheduleTooEarly|MonthNotElapsed/
  const send = async (label, ixs) => {
    try {
      const sig = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer], { commitment: 'confirmed' })
      console.log(`  ok   ${label}  ${sig}`); return 'ok'
    } catch (e) {
      const m = String(e.message) + ' ' + (e.logs || []).join(' ')
      if (BENIGN.test(m)) { console.log(`  skip ${label}: ${m.match(BENIGN)[0]} (done by other traffic, or not yet)`); return 'benign' }
      console.log(`  FAIL ${label}: ${m.slice(0, 200)}`); return 'fail'
    }
  }
  const run = async (label, ixs) => { if ((await send(label, ixs)) === 'fail') failures.push(label) }

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
    if (ok === 'fail') { failures.push(`reveal ${r.asset}`); break }     // strictly in order: stop at the first failure
    if (ok === 'benign') break                                        // not yet, or done elsewhere: next pass
  }
  for (const a of plan.retireBurned) { const r = byAddr.get(a)
    await run(`retire ${r.asset}`, [new TransactionInstruction({ programId: MINT, data: d('retire_burned'),
      keys: [W(MINT_CFG.toBase58()), W(a), R(r.asset)] })]) }
  // Eligible vaults are joined FIRST: the program refuses a distribution while one waits.
  for (let i = 0; i < plan.preJoins.length; i += L.CLAIM_BATCH) { const pairs = plan.preJoins.slice(i, i + L.CLAIM_BATCH)
    await run(`join batch ${i / L.CLAIM_BATCH + 1} (${pairs.length})`, [new TransactionInstruction({
      programId: MINT, data: Buffer.concat([d('claim'), Buffer.from([0])]),
      keys: [W(MINT_CFG.toBase58()), W(cfg.pool_ata), R(TOKEN_PROGRAM_ID), ...pairs.flatMap(([rec, ata]) => [W(rec), W(ata)])] })]) }
  if (plan.split) await run('split_revenue (85/15, pinned destinations)', [new TransactionInstruction({ programId: MINT,
    data: Buffer.concat([d('split_revenue'), Buffer.from([payDecimals])]),
    keys: [R(MINT_CFG.toBase58()), W(REVENUE.toBase58()), R(payMint.toBase58()), W(revAta.toBase58()), W(cfg.pool_ata),
      W(bankAta.toBase58()), R(TOKEN_PROGRAM_ID)] })])
  if (plan.distribute) await run('distribute (monthly, free)', [new TransactionInstruction({ programId: MINT,
    data: Buffer.concat([d('distribute'), Buffer.from([0])]), keys: [W(MINT_CFG.toBase58()), R(cfg.pool_ata)] })])
  for (const a of plan.activate) { const r = byAddr.get(a)
    await run(`activate ${r.asset}`, [new TransactionInstruction({ programId: MINT, data: d('activate'),
      keys: [W(MINT_CFG.toBase58()), W(a), R(r.asset), R(tokens[r.asset].address), R(cfg.pool_ata)] })]) }
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
  // The every-minute reveal lane is short: a crashed holder's lock goes stale in
  // 10 minutes, not 2 hours (round 22, F3: a fresh lock with a dead pid blocked the
  // lane for 2 h and paged every minute). A LIVE holder is still never stolen from.
  withLock(LOCK, main, { staleMs: process.argv.includes('--reveal-only') ? 10 * 60_000 : 2 * 3600_000 }).catch(e => {
    console.error(`CBOB CRANK FAILED TO RUN: ${e.message}`)
    if (process.argv.includes('--live')) {
      try { execFileSync('/opt/scripts/notify-gary-sms.sh', [`CBOB CRANK FAILED TO RUN: ${e.message}`, 'cbob-vault-crank']) } catch {}
    }
    process.exit(3)
  })
}
