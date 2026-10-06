#!/usr/bin/env node
/**
 * THE REVENUE CYCLE: sweep -> swap -> return -> split.
 *
 *   1. sweep_sol_for_swap   SOL leaves the revenue address for the pinned swap
 *                           operator, never below the fee reserve.   [on-chain]
 *   2. swap                 SOL -> cbBTC in a PINNED pool (Orca, Meteora
 *                           fallback), floor from Pyth, built here.  [bank/swap.mjs]
 *   3. return               the cbBTC goes straight back to the revenue
 *                           address's ATA.                           [off-chain]
 *   4. split_revenue        85% -> the program's pool, 15% -> the
 *                           CBOBTC Squads. Both fixed forever (v6). [on-chain]
 *
 * v6 (2026-10-03): mint prices now arrive as cbBTC, so this hop carries ONLY
 * royalty SOL. The holders' 85% goes to a pool the MINT program owns and pays
 * out itself; no distributor wallet exists any more. The guardian may STOP the
 * sweep (only a vote restarts it), and a vote may only TIGHTEN its bounds.
 *
 * STEPS 2 AND 3 ARE THE ONLY TRUSTED PART OF THE WHOLE REVENUE PATH, and they
 * are trusted for a reason that cannot be engineered away here: there is no
 * trustless SOL->cbBTC without a DEX CPI. So they are made small and loud
 * instead of pretended away. Every cycle writes what it swept and what it
 * returned; `--audit` reconciles the two and the Bank alarm reads the same file.
 *
 * ROUND 24 (M1, Gary 2026-10-05: "Orca direct + Meteora fallback"): the swap no
 * longer signs a transaction Jupiter's API built (its host was measured GONE).
 * bank/swap.mjs builds it against two pinned pools, with an on-chain output floor
 * from Pyth's SOL/USD and BTC/USD, and refuses a pool priced away from the oracle.
 * What is trusted now is the two pool programs and the oracle, not an HTTP reply.
 *
 * DEFAULTS TO DRY RUN. It moves real money; `--live` is deliberate.
 *
 *   node bank/revenue.mjs              # quote and plan only
 *   node bank/revenue.mjs --live
 *   node bank/revenue.mjs --audit      # swept vs returned, all time
 *   node bank/revenue.mjs --probe      # read-only: price 1 SOL through both pinned pools
 */
import fs from 'fs'
import { execFileSync } from 'child_process'
import { withLock, readLedger, writeLedger } from './lock.mjs'
import { readTokenAccount, requireTokenAmount, isProvablyEmpty } from './spl.mjs'
import * as L from './layout.mjs'
import { cycleIsOpen, closesCycle, normaliseTx, revenueOutflow, splitSig, REVENUE_STAGES, revenueNotices } from './detectors.mjs'
import { createHash } from 'crypto'
import { PublicKey, Connection, Keypair, Transaction, TransactionInstruction, SystemProgram,
  sendAndConfirmTransaction, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js'
import * as SW from './swap.mjs'
import { clockUnixTimestamp } from './crank.mjs'
import { readParsedTransaction } from './txread.mjs'
import { getAssociatedTokenAddressSync, createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'

const ARGS = new Set(process.argv.slice(2))
const LIVE = ARGS.has('--live')
const LEDGER = process.env.CBOB_REVENUE_LEDGER || '/opt/cbob-vaults/bank/revenue-ledger.json'
const NOTIFY = '/opt/scripts/notify-gary-sms.sh'
const NOTIFY_LIVE = LIVE && !ARGS.has('--probe') && !ARGS.has('--audit')
const FAILURES = process.env.CBOB_REVENUE_FAILING_DIR || `${LEDGER}.failures`
let revenueStage = 'config'
const revenuePassed = new Set()
function enterStage(stage) { revenuePassed.add(revenueStage); revenueStage = stage }
const SOL = 'So11111111111111111111111111111111111111112'
const CBBTC = new PublicKey('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij')
const MINT_PROG = new PublicKey('Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo')
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const [MINT_CFG] = PublicKey.findProgramAddressSync([Buffer.from('mint-config')], MINT_PROG)
const [REVENUE] = PublicKey.findProgramAddressSync([Buffer.from('revenue')], MINT_PROG)
/** Keep OUR cycles under the on-chain cap. This is a convenience, not a control.
 *
 *  It used to sit under a comment claiming a compromised operator key "is capped
 *  at one cycle's worth rather than the whole treasury" — false, because
 *  nothing stopped a holder of the operator key from sweeping without this file
 *  (`sweep_sol_for_swap` needs the operator's signature, nothing more), so a
 *  constant here bound nobody who chose not to run it. The bound is now `max_sweep_lamports`
 *  and `sweep_cooldown_secs` in the program, which is what makes the claim true.
 *  Set this at or below the on-chain cap. */
const MAX_PER_CYCLE_LAMPORTS = 50_000_000_000n   // 50 SOL
/** How far the post-sweep quote may fall below the one the sweep was decided on. */
const MAX_REQUOTE_DRIFT_BPS = 200
const d = n => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8)
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b }
const rpc = () => (fs.readFileSync('/opt/gary-club/.env.local', 'utf8').match(/^HELIUS_RPC_URL=(.*)$/m) || [])[1].trim()
const LOCK = process.env.CBOB_REVENUE_LOCK || '/opt/cbob-vaults/bank/.revenue.lock'
/** MISSING is a first run; UNPARSEABLE is an abort. This ledger is the ONLY
 *  record of SOL that left for the trusted hop, so silently reading a corrupt
 *  one as empty would erase every unreconciled sweep — the exact thing the
 *  alarm exists to shout about. */
const MARKER = `${LEDGER}.has-run`
const load = () => readLedger(LEDGER, { cycles: [] }, MARKER)
const save = s => writeLedger(LEDGER, s, MARKER)

function audit() {
  const l = load()
  const swept = l.cycles.reduce((a, c) => a + BigInt(c.sweptLamports || c.intendedLamports || 0), 0n)
  const returned = l.cycles.reduce((a, c) => a + BigInt(c.returnedSats || 0), 0n)
  // THE SAME IMPORTED PREDICATE. This was a FOURTH copy of the question, and it
  // had already drifted from the canonical one — it did not know about a sweep
  // the program REFUSED, so `--audit` would have reported a cycle as open that
  // never moved a lamport.
  const open = l.cycles.filter(cycleIsOpen)
  console.log(`revenue cycles: ${l.cycles.length}`)
  console.log(`  SOL swept out to the operator : ${swept} lamports`)
  console.log(`  cbBTC returned to revenue     : ${returned} sats`)
  console.log(`  cycles swept but NOT returned : ${open.length}`)
  for (const c of open) console.log(`    ${c.startedAt}  ${c.sweptLamports || c.intendedLamports} lamports unaccounted${c.sweptLamports ? '' : ' (sweep never confirmed into the ledger)'}`)
  for (const c of l.cycles) {
    const pending = ['Sweep', 'Swap', 'Return', 'Split'].filter(hop => c[`pending${hop}Sig`])
    if (pending.length) console.log(`    ${c.startedAt} candidate signatures (check chain; these are not confirmations): ` +
      pending.map(hop => `${hop}=${c[`pending${hop}Sig`]}${hop === 'Swap' && c.pendingSwapVenue ? ` (${c.pendingSwapVenue})` : ''}`).join(', '))
  }
  const short = l.cycles.filter(c => BigInt(c.returnedSats ?? 0) > 0n && BigInt(c.quotedSats ?? 0) > 0n
    && BigInt(c.returnedSats) < BigInt(c.quotedSats) * 98n / 100n)
  if (short.length) {
    console.log(`  cycles that returned WELL BELOW quote : ${short.length}`)
    for (const c of short) console.log(`    ${c.startedAt}  quoted ${c.quotedSats}, returned ${c.returnedSats}`)
    process.exitCode = 1
  }
  // The one number that matters: SOL that left and never came back as cbBTC.
  if (open.length) { console.log('\n>>> UNRECONCILED. Every sweep must have a matching return.'); process.exitCode = 1 }
  return open.length
}

/** The oracle's expected output and the usable pinned pools: `SW.market`, which
 *  lives in bank/swap.mjs since round 25 (L2) so the selftest can drive it, and
 *  judges the oracle's age on the CHAIN's clock, not this box's. */
const market = (conn, lamports) => SW.market(conn, lamports)

/** ROUND 25 (L3): the chain's word on one signature, history included. */
const statusOf = conn => async sig => (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true }))?.value?.[0] ?? null
/** ROUND 25 (I1): a landed transaction's block time, read off the chain, or null. */
async function blockTimeOf(conn, sig) {
  try {
    const st = await statusOf(conn)(sig)
    if (!st || st.slot === null || st.slot === undefined) return null
    const bt = await conn.getBlockTime(st.slot)
    return Number.isFinite(bt) && bt > 0 ? bt : null
  } catch { return null }
}

async function main() {
  if (ARGS.has('--audit')) return audit()
  const conn = new Connection(rpc(), 'confirmed')
  // THE VENUE PROBE (round 24 M1): read-only, runnable before launch. Prices 1 SOL
  // through both pinned pools against the oracle; exit 1 when neither is usable.
  if (ARGS.has('--probe')) {
    const m = await market(conn, 1_000_000_000n)
    console.log(`  1 SOL -> ${m.f.expectedSats} sats at the oracle, floor ${m.f.minSats}; usable venues: ${m.venues.join(', ') || 'NONE'}`)
    process.exitCode = m.venues.length ? 0 : 1
    return
  }
  const led = load()
  const cfgAcc = await conn.getAccountInfo(MINT_CFG, 'confirmed')
  // OWNER, DISCRIMINATOR AND VERSION BEFORE ANY OFFSET — the pinning round 11
  // applied to the alarm and not to the two jobs that move money.
  // Pinned (owner, discriminator, version) and decoded by bank/layout.mjs, whose
  // field list is asserted against the Rust. The hand-typed offsets that lived
  // here were v5's; v6 moved half of these fields.
  const cfg = L.readPinned('MintConfig', cfgAcc, PublicKey)
  if (!cfg) { console.log('mint config not initialised — no revenue to cycle yet'); return }
  if (cfg.sweep_stopped) {
    console.log('  the SOL sweep is STOPPED by the guardian; only a governance vote restarts it. Nothing to do.')
    return
  }
  const pool = new PublicKey(cfg.pool_ata)
  const bankWallet = new PublicKey(cfg.bank_treasury)
  const operatorPk = new PublicKey(cfg.swap_operator)
  const reserve = cfg.sol_reserve_lamports
  const splitBps = cfg.split_bps
  // THE BOUNDS THIS SCRIPT MUST OBEY LIVE ON CHAIN. It used to sweep its own
  // hardcoded 50 SOL and never read `max_sweep_lamports`, `sweep_cooldown_secs`
  // or `last_sweep_at` — so a config the script disagreed with produced an
  // on-chain rejection AFTER the intent row was written, which then wedged every
  // future run and raised a CRITICAL about lamports that never moved.
  // ⚠️ ROUND 25 (L4): ON THE CHAIN'S CLOCK, AND RUN HOURLY. `last_sweep_at` is
  // the chain time the sweep LANDED, several round trips after the run began, so
  // the next 6-hourly run read the box clock ~1 s after starting, before
  // `last + 21600`, and skipped: the cadence was 12 h. The cron is now hourly (the
  // gate makes the extra runs no-ops) and this compares the Clock sysvar, which
  // only moves forward, so a pass here cannot meet SweepTooSoon on landing.
  const chainCap = cfg.max_sweep_lamports
  const cooldown = cfg.sweep_cooldown_secs
  const lastSweep = cfg.last_sweep_at
  const chainNow = clockUnixTimestamp((await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'confirmed'))?.data)
  if (chainNow === null) throw new Error('the chain clock (the Clock sysvar) is unreadable; the cooldown is judged on the chain\'s time, never the box\'s')
  const nowSec = BigInt(chainNow)
  if (!SW.sweepCooldownOver({ lastSweepAt: lastSweep, cooldownSecs: cooldown, chainNowSec: chainNow })) {
    console.log(`  cooldown: the last sweep was at ${lastSweep}, next allowed at ${lastSweep + cooldown} (now ${nowSec}). Nothing to do.`)
    return
  }

  enterStage('key')
  const KEYFILE = '/opt/cbob-vaults/bank/keys/swap-operator.json'
  const mode = fs.statSync(KEYFILE).mode & 0o777
  if (mode & 0o077) throw new Error(`${KEYFILE} is mode ${mode.toString(8)} — a signing key readable by anyone but its owner is not a key`)
  const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYFILE, 'utf8'))))
  if (!operator.publicKey.equals(operatorPk))
    throw new Error(`local operator key ${operator.publicKey} is not the one pinned in config (${operatorPk})`)

  enterStage('recovery')
  // A CYCLE THAT NEVER FINISHED IS NOT A REASON TO START ANOTHER.
  // After a successful sweep whose swap then failed, the next run saw a swept
  // revenue address, printed "nothing to sweep" and returned — never looking at
  // the open cycle, never reporting it, and stacking a fresh sweep on top of it
  // the moment more income arrived. The unfinished one is the news.
  // ONE predicate, imported. This line was a THIRD copy of the question and it
  // carried the original truthiness bug: `!'0'` is false, so a cycle that
  // returned NOTHING read as closed and a fresh sweep stacked on top of it.
  // ROUND 22 (S6): A CRASH BETWEEN THE SPLIT LANDING AND THE LEDGER SAVE left a
  // cycle that had returned its cbBTC and been split, but recorded no split, and
  // it wedged every later run here. Same proof as the split-by-other path below:
  // a readable, EMPTY revenue ATA means a correct 85/15 split happened (only
  // `split_revenue` can move tokens out of it, and it moves everything).
  {
    let returnedUnsplit = (led.cycles || []).filter(c => cycleIsOpen(c) && BigInt(c?.returnedSats ?? 0) > 0n)
    // ⚠️ ROUND 24 (L11): CHAIN EVIDENCE FIRST. The proof below needs the revenue
    // ATA EMPTY at :41, and during a busy sale it is refilled minutes after the
    // crank's :37 split, so this guard could wedge the job for as long as the sale
    // ran ("never recorded a cbBTC return") over a cycle that HAD been split. A
    // cbBTC split at or after the return, at least as large as it and claimed by
    // no other cycle, is that cycle's split: `closesCycle`, the SAME predicate
    // the alarm closes `cycle_unsplit` with. Recorded as the cycle's `splitSig`, so
    // the alarm then verifies it on chain like any other.
    if (returnedUnsplit.length) {
      // ROUND 25 (I1): the return's CHAIN time anchors which split is its own; a
      // row from before this field, or a crash before it was saved, gets it here.
      for (const c of returnedUnsplit) if (c.returnSig && !(Number(c.returnBlockTime) > 0)) {
        const bt = await blockTimeOf(conn, c.returnSig)
        if (bt) c.returnBlockTime = bt
      }
      const revAtaC = getAssociatedTokenAddressSync(CBBTC, REVENUE, true)
      const since = Math.min(...returnedUnsplit.map(c => Date.parse(c.returnedAt || c.startedAt) / 1000).filter(Number.isFinite))
      const splits = Number.isFinite(since) ? await splitsSince(conn, revAtaC, since - 60) : []
      const claimed = new Set((led.cycles || []).map(c => c.splitSig).filter(Boolean))
      for (const c of returnedUnsplit) {
        const hit = closesCycle(c, splits, { exclude: claimed })
        if (!hit) continue
        c.splitSig = splitSig(hit); claimed.add(c.splitSig)
        c.splitFailure = `recovered: split ${c.splitSig} (${hit.total} sats, after the return) is on chain and was never recorded`
      }
      save(led)
      returnedUnsplit = returnedUnsplit.filter(c => !c.splitSig)
    }
    if (returnedUnsplit.length) {
      const revAta0 = getAssociatedTokenAddressSync(CBBTC, REVENUE, true)
      if (isProvablyEmpty(await conn.getAccountInfo(revAta0, 'confirmed'))) {
        for (const c of returnedUnsplit) { c.splitByOther = true; c.splitByOtherAt = new Date().toISOString()
          c.splitFailure = 'recovered: the revenue ATA was provably empty at the next run (a crash after the split, before the save)' }
        save(led)
      }
    }
  }
  const open = (led.cycles || []).filter(cycleIsOpen)
  if (open.length) {
    throw new Error(`${open.length} revenue cycle(s) swept SOL and never recorded a cbBTC return (oldest ${open[0].startedAt}). Resolve them by hand — the SOL is on the operator key — before another cycle runs. \`--audit\` lists them.`)
  }

  // THE OPERATOR PAYS FOR FOUR TRANSACTIONS out of its own balance — the swap,
  // the return transfer, two idempotent ATA creations and the split — and
  // nothing checked or funded it. On a fresh operator the first cycle would
  // sweep the SOL, buy the cbBTC, and then fail to send it back for want of a
  // few thousand lamports, leaving an open cycle and a CRITICAL.
  enterStage('funding')
  const OPERATOR_FLOOR = 20_000_000n     // 0.02 SOL: fees plus two ATA rents
  const opSol = BigInt(await conn.getBalance(operator.publicKey, 'confirmed'))
  if (opSol < OPERATOR_FLOOR)
    throw new Error(`the swap operator holds ${opSol} lamports and needs about ${OPERATOR_FLOOR} to pay for the swap, the return and the split. Fund it before sweeping.`)

  const balance = BigInt(await conn.getBalance(REVENUE, 'confirmed'))
  let amount = balance > reserve ? balance - reserve : 0n
  if (amount > MAX_PER_CYCLE_LAMPORTS) amount = MAX_PER_CYCLE_LAMPORTS
  if (amount > chainCap) amount = chainCap        // the program's ceiling wins
  console.log(`revenue address ${REVENUE.toBase58()}`)
  console.log(`  holds ${balance} lamports, reserve ${reserve}, sweepable ${amount}, split ${splitBps / 100}% / ${(10000 - splitBps) / 100}%`)
  if (amount === 0n) { console.log('  nothing to sweep'); return }

  // ---- price first, so a bad market stops us BEFORE any SOL moves ----
  // The oracle's expected output, and which pinned pools price close enough to it
  // to be used at all (round 24 M1: no third-party quote any more).
  enterStage('market')
  const m1 = await market(conn, amount)
  const q = { outAmount: String(m1.f.expectedSats) }
  console.log(`  oracle: ${amount} lamports -> ${m1.f.expectedSats} sats expected, on-chain floor ${m1.f.minSats}; usable venues: ${m1.venues.join(', ') || 'NONE'}`)
  if (!m1.venues.length)
    throw new Error('neither pinned pool prices within the oracle bound — refusing to sweep into a market we would not trade in')
  if (!LIVE) { console.log('\nDRY RUN. Re-run with --live to move funds.'); return }

  // THE OPERATOR'S OWN cbBTC ATA, MEASURED AND CREATED BEFORE ANY SOL MOVES.
  //
  // ROUND 12, found by four auditors, and it was MY defect from round 11. The
  // baseline read sat between the sweep and the swap under a comment reading
  // "It is checked here, before anything moves" — 27 lines AFTER up to 50 SOL
  // had already left the revenue address. Round 11 also swapped `?? 0n` for
  // `requireTokenAmount`, which THROWS on absent.
  //
  // An absent operator cbBTC ATA is not a poisoned account: it is the NORMAL
  // state of the first live cycle and of every cycle after an operator
  // rotation, and nothing in this repo creates it (Jupiter would have, and
  // never runs). So the repair converted a routine first-run condition into a
  // hard fault positioned after the money moved: SOL on the operator, an open
  // cycle, and every later run dead at the open-cycle guard until a human
  // finished the swap by hand. The fix was worse than the defect it replaced.
  //
  // ABSENT IS ZERO FOR A DELTA BASELINE. The absent-is-not-empty rule governs
  // PROOFS — "someone else already split this" — not balance reads. Foreign and
  // malformed still refuse, because those are a poisoned or wrong account and
  // no delta computed against them means anything.
  enterStage('prepare')
  const opAtaAddr = getAssociatedTokenAddressSync(CBBTC, operator.publicKey)
  const opInfo = await conn.getAccountInfo(opAtaAddr, 'confirmed')
  const opBefore = readTokenAccount(opInfo).state === 'absent'
    ? 0n
    : requireTokenAmount(opInfo, 'the swap operator cbBTC token account', opAtaAddr.toBase58())
  if (readTokenAccount(opInfo).state === 'absent') {
    console.log(`  creating the operator cbBTC ATA ${opAtaAddr.toBase58()} (first cycle for this key)`)
    await sendAndConfirmTransaction(conn, new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, opAtaAddr, operator.publicKey, CBBTC)),
      [operator], { commitment: 'confirmed' })
  }

  // THE INTENT IS WRITTEN BEFORE THE SEND, not after the confirmation.
  // `sweptLamports` used to be stamped only once `sendAndConfirmTransaction`
  // returned, and a confirmation timeout on a transaction that actually landed
  // (routine on Solana) left a row with no amount at all — which the alarm's
  // reconciler then SKIPPED, forever. SOL gone, watcher quiet.
  const cycle = { startedAt: new Date().toISOString(), quotedSats: q.outAmount,
    intendedLamports: String(amount) }
  led.cycles.push(cycle); save(led)

  // 1. sweep (on-chain, capped and cooled down IN THE PROGRAM, evented)
  //
  // A REJECTED SEND IS NOT AN OPEN CYCLE. If the program refuses — SweepTooSoon,
  // SweepAboveCap, MintPaused — nothing moved, and leaving the intent row
  // standing wedged every future run behind the open-cycle guard AND told the
  // alarm that SOL had left the revenue address. A confirmation timeout is the
  // opposite case and must still count as open, so the two are distinguished by
  // whether the cluster gave us a program error at all.
  // ⚠️ ROUND 25 (L3): AND BY ASKING THE CHAIN. A send that passed preflight and
  // FAILED on chain, or expired, carries no program-error text, so it was filed
  // unconfirmed and the alarm paged `unreconciled_swap` CRITICAL an hour later
  // for SOL that never moved. `SW.classifySendFailure` reads the signature's
  // status: failed or expired-and-absent is a refusal, landed-and-succeeded is a
  // sweep, and only a status the chain cannot give stays open.
  enterStage('sweep')
  try {
  cycle.sweepSig = await sendAndConfirmTransaction(conn, new Transaction().add(new TransactionInstruction({
    programId: MINT_PROG, data: Buffer.concat([d('sweep_sol_for_swap'), u64(amount)]),
    // WRITABLE as of round 6: `sweep_sol_for_swap` stamps the cooldown into
    // config, because a cap with no rate limit is a step size, not a bound.
    keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: true },
      { pubkey: REVENUE, isSigner: false, isWritable: true },
      { pubkey: operator.publicKey, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] })),
    [operator], { commitment: 'confirmed' })
  } catch (e) {
    const verdict = await SW.classifySendFailure(e, statusOf(conn))
    if (verdict.outcome === 'refused') {
      cycle.sendRejected = true
      // The signature, when there is one, is kept for the record as `refusedSig`,
      // NEVER `sweepSig` (a refused row carrying a sweep is `rejected_row_has_sweep`,
      // CRITICAL). If this judgement were ever wrong and the sweep had landed, no
      // row claims that signature, so the chain scan pages `unledgered_sweep`.
      if (verdict.sig) cycle.refusedSig = verdict.sig
      cycle.error = `${verdict.why}: ${String(e.message).slice(0, 240)}`
      save(led)
      throw new Error(`the sweep was REFUSED and no SOL moved (${verdict.why}): ${String(e.message).slice(0, 300)}`)
    }
    if (verdict.outcome !== 'landed') {
      rememberAttempt(cycle, 'Sweep', e, led)
      throw e // candidate signature is evidence for hand recovery, not a sweep claim
    }
    cycle.sweepSig = verdict.sig
    console.log(`  the sweep's confirmation failed but the chain says it LANDED: ${verdict.sig}`)
  }
  cycle.sweptLamports = String(amount); save(led)

  // Measured BEFORE the swap so the return can be a delta rather than a balance.
  cycle.operatorSatsBefore = String(opBefore); save(led)

  // 2. swap (the trusted hop: a pinned pool, an oracle floor ON CHAIN)
  // RE-PRICE. The read above was taken before the SOL moved and decided only
  // whether to move it; the swap is built from a fresh one.
  enterStage('swap')
  const m2 = await market(conn, amount)
  // AN OUTPUT FLOOR AGAINST THE FIRST READ, because a market that moved between
  // the two is news: the decision to sweep was made on the first.
  const minOut = BigInt(q.outAmount) * BigInt(10_000 - MAX_REQUOTE_DRIFT_BPS) / 10_000n
  if (m2.f.expectedSats < minOut)
    throw new Error(`the post-sweep oracle expects ${m2.f.expectedSats} sats against ${q.outAmount} before the sweep, below the ${MAX_REQUOTE_DRIFT_BPS / 100}% drift this cycle allows — SOL is on the operator key and must be returned or swapped by hand`)
  if (!m2.venues.length)
    throw new Error('after the sweep neither pinned pool prices within the oracle bound — SOL is on the operator key and must be swapped by hand')
  // ONE FLOOR, the one the pool program enforces: the oracle's expectation less
  // the swap tolerance. The return below is held to exactly this.
  const guaranteed = m2.f.minSats
  cycle.quotedSats = String(m2.f.expectedSats); cycle.floorSats = String(guaranteed); save(led)
  // ORCA FIRST, METEORA ONLY IF ORCA'S PROGRAM REFUSES. A refusal (a program
  // error or a failed preflight) moved nothing, so the next venue is safe to try.
  // An UNCONFIRMED send is not a refusal: it may have landed, and a second swap
  // would then fail for want of SOL at best. So it stops the cycle, open and loud.
  // ROUND 25 (L3): a swap that FAILED ON CHAIN (its floor broke between the
  // simulation and the landing) or expired unlanded is a refusal too, read off
  // the signature's status, so Meteora is tried; one that landed is recorded.
  const tried = []
  for (const venue of m2.venues) {
    const ixs = SW.swapInstructions({ venue, owner: operator.publicKey, lamportsIn: amount, minSats: guaranteed,
      w: m2.w, p: m2.p, bitmapExists: m2.bitmapExists })
    const bad = SW.judgeSwapInstructions(ixs, operator.publicKey, venue, { lamportsIn: amount, minSats: guaranteed })
    if (bad.length) throw new Error(`refusing to sign the ${venue} swap we built: ${bad.join('; ')}`)
    try {
      cycle.swapSig = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [operator], { commitment: 'confirmed' })
      cycle.swapVenue = venue; save(led)
      console.log(`  swapped on ${venue}: ${cycle.swapSig}`)
      break
    } catch (e) {
      const verdict = await SW.classifySendFailure(e, statusOf(conn))
      if (verdict.outcome === 'landed') {
        cycle.swapSig = verdict.sig; cycle.swapVenue = venue; save(led)
        console.log(`  swapped on ${venue} (confirmation failed, the chain says it LANDED): ${cycle.swapSig}`)
        break
      }
      if (verdict.outcome !== 'refused') {
        rememberAttempt(cycle, 'Swap', e, led, venue)
        throw e // never try another venue while this attempt may have landed
      }
      tried.push(`${venue}: ${verdict.why}: ${String(e.message).slice(0, 140)}`)
      console.log(`  ${venue} refused the swap; ${venue === m2.venues.at(-1) ? 'no venue left' : 'trying the next venue'}`)
    }
  }
  if (!cycle.swapSig) {
    cycle.swapFailure = tried.join(' | ').slice(0, 400); save(led)
    throw new Error(`every pinned venue refused the swap (${tried.join(' | ')}) — SOL is on the operator key and must be swapped by hand`)
  }

  // 3. return EVERYTHING to the revenue address
  enterStage('return')
  const opAta = getAssociatedTokenAddressSync(CBBTC, operator.publicKey)
  const revAta = getAssociatedTokenAddressSync(CBBTC, REVENUE, true)
  // THE DELTA, NOT THE BALANCE. Reading the operator ATA's whole balance and
  // calling it this cycle's return was described as self-healing in round 6; it
  // is the opposite. A swap that returned almost nothing reconciles cleanly if
  // the ATA already held cbBTC from an earlier failed cycle or from anyone who
  // sent some — and the reconciliation is the only thing standing behind the one
  // trusted hop in the system.
  const after = requireTokenAmount(await conn.getAccountInfo(opAta, 'confirmed'),
    'the swap operator cbBTC token account', opAta.toBase58())
  const delta = after > opBefore ? after - opBefore : 0n
  if (delta < guaranteed)
    throw new Error(`the swap credited ${delta} sats to the operator (balance ${opBefore} -> ${after}) against the route's guaranteed ${guaranteed}. Refusing to record it as this cycle's return.`)
  // Send everything the ATA holds — leftovers from a previous cycle belong to the
  // project too — but RECORD only what this cycle produced.
  const got = after
  cycle.returnSig = await sendAndConfirmTransaction(conn, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, revAta, REVENUE, CBBTC),
    createTransferCheckedInstruction(opAta, CBBTC, revAta, operator.publicKey, got, 8)),
    [operator], { commitment: 'confirmed' }).catch(e => {
      rememberAttempt(cycle, 'Return', e, led)
      throw e
    })
  cycle.returnedSats = String(delta)
  // WHEN the cbBTC landed, so the watcher can grace the unsplit check from the
  // return instead of from the sweep. Graced from `startedAt`, `cycle_unsplit`
  // fired a HIGH about a cycle that was mid-step-4 in another process.
  cycle.returnedAt = new Date().toISOString()
  // ROUND 25 (I1): and the return's CHAIN time, which `closesCycle` anchors on
  // (a split even a second before it is not this cycle's). Null if unreadable;
  // the recovery path fills it from `returnSig`.
  cycle.returnBlockTime = await blockTimeOf(conn, cycle.returnSig)
  cycle.sweptAtaTotal = String(got); save(led)

  // 4. split (on-chain, enforced, permissionless)
  //
  // ANYONE MAY SPLIT, so a stranger front-running this leaves our own call
  // reverting on `NothingToSplit` — and the cycle would then carry a return with
  // no `splitSig` forever, wedging every later run at the open-cycle guard for a
  // split that DID happen. Their split divided our cbBTC by the same enforced
  // rule to the same pinned addresses, so the money is where it should be; only
  // the bookkeeping is missing. Record that rather than throwing on it.
  enterStage('split')
  const ataOf = w => getAssociatedTokenAddressSync(CBBTC, w, true)
  cycle.splitSig = await sendAndConfirmTransaction(conn, new Transaction().add(
    // The pool already exists (initialize derives it) and is the config PDA's
    // own ATA; only the 15% destination may need creating.
    createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, ataOf(bankWallet), bankWallet, CBBTC),
    new TransactionInstruction({ programId: MINT_PROG,
      data: Buffer.concat([d('split_revenue'), Buffer.from([8])]),
      keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: false },
        { pubkey: REVENUE, isSigner: false, isWritable: true },
        { pubkey: CBBTC, isSigner: false, isWritable: false },
        { pubkey: revAta, isSigner: false, isWritable: true },
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: ataOf(bankWallet), isSigner: false, isWritable: true },
        { pubkey: TOKEN, isSigner: false, isWritable: false }] })),
    [operator], { commitment: 'confirmed' }).catch(async e => {
    rememberAttempt(cycle, 'Split', e, led)
    // Did someone else already do it? THE EMPTINESS IS THE PROOF, AND IT DECIDES.
    //
    // This used to require the Anchor error NAME `NothingToSplit` to appear in
    // `e.message`. It does not live there: `sendAndConfirmTransaction` throws
    // with the RPC-level string and the Anchor name is emitted in the program
    // LOGS. The sibling rejection test in this same file already knows that and
    // matches the generic shape instead — the one site that leaned on the name
    // was the one site that read the wrong field, so the fix would simply not
    // have fired and the wedge it was written to prevent would have happened.
    //
    // The proof never needed the text. `split_revenue` is the ONLY instruction
    // that can move tokens out of the revenue ATA, it pins both destinations
    // from config, and it always moves the entire balance. So a readable,
    // Tokenkeg-owned revenue ATA holding zero means a correct 85/15 split
    // happened, whoever paid for it. ABSENT IS NOT EMPTY: an ATA that never
    // existed would otherwise "prove" a split that never occurred, which is the
    // same absent-vs-empty confusion round 10 fixed one file over.
    if (isProvablyEmpty(await conn.getAccountInfo(revAta, 'confirmed'))) {
      cycle.splitByOther = true
      cycle.splitByOtherAt = new Date().toISOString()
      // NOT a signature. `splitSig` used to be stamped with the literal string
      // 'split-by-another-caller'; every current reader checks `splitByOther`
      // first and the next one would not have.
      cycle.splitFailure = String(e.message).slice(0, 300)
      return undefined
    }
    throw e
  })
  // `splitSig` is what closes the cycle. cbBTC sitting unsplit in the revenue
  // ATA is money the holders have not been paid, and treating the RETURN as the
  // end made a failed split look like a finished cycle.
  cycle.finishedAt = new Date().toISOString(); save(led)
  console.log(`  swept ${amount} -> got ${got} sats -> split ${splitBps / 100}/${(10000 - splitBps) / 100}`)
  audit()
}

/** Round 24 (L11): every cbBTC split out of the revenue ATA since `sinceSec`,
 *  read off the chain: `{ sig, blockTime, total }`. Only `split_revenue` can move
 *  tokens out of that account, so any transaction with an outflow is a split.
 *  Bounded (10 pages); an unread older split only leaves a cycle open, the loud
 *  direction. */
async function splitsSince(conn, revAta, sinceSec) {
  const out = []
  let before
  for (let page = 0; page < 10; page++) {
    const sigs = await conn.getSignaturesForAddress(revAta, { before, limit: 1000 }, 'confirmed')
    if (!sigs.length) break
    for (const s of sigs) {
      if (s.err || s.blockTime === null || s.blockTime === undefined || s.blockTime < sinceSec) continue
      const tx = await readParsedTransaction(conn, s.signature)
      if (!tx) continue
      const total = revenueOutflow(normaliseTx(tx), revAta.toBase58())
      if (total > 0n) out.push({ sig: s.signature, blockTime: s.blockTime, total: String(total) })
    }
    const last = sigs[sigs.length - 1]
    if (last.blockTime !== null && last.blockTime !== undefined && last.blockTime < sinceSec) break
    before = last.signature
  }
  return out
}

// A candidate signature records an ATTEMPT, never a confirmed value movement.
// Retain it before an uncertain send leaves its cycle handler.
function rememberAttempt(cycle, hop, error, ledger, venue) {
  const sig = SW.sendFailureSignature(error)
  if (!sig) return
  cycle[`pending${hop}Sig`] = sig
  if (venue) cycle.pendingSwapVenue = venue
  save(ledger)
}

// Per-stage files also let a failed lock acquisition leave its own marker
// without racing a read/modify/write of the running cycle's marker set.
function publishRevenueNotices(error = null, stage = revenueStage) {
  if (!NOTIFY_LIVE) return
  const previous = REVENUE_STAGES.filter(s => fs.existsSync(`${FAILURES}/${s}`))
  for (const n of revenueNotices({ stage, error, previous, passed: [...revenuePassed] })) {
    const marker = `${FAILURES}/${n.stage}`
    if (!n.recovery) {
      try { fs.mkdirSync(FAILURES, { recursive: true, mode: 0o700 }); fs.writeFileSync(marker, new Date().toISOString(), { mode: 0o600 }) }
      catch (e) { console.error(`cannot persist revenue failure marker: ${e.message}`) }
    }
    try {
      const env = { ...process.env, ALERT_ON_CHANGE: '1' }
      delete env.ALERT_URGENT
      execFileSync(NOTIFY, [n.text, n.label], { stdio: 'ignore', env })
      if (n.recovery) fs.rmSync(marker, { force: true })
    } catch (e) { console.error(`revenue notice not completed (${n.stage}): ${e.message}`) }
  }
}

// One runner, or two cycles sweep at once and neither ledger entry is complete.
// Recovery notification stays inside the lock. A failed delivery keeps its
// marker for the next live pass; dry/probe/audit runs never notify or clear it.
let revenueFailureReported = false
withLock(LOCK, async () => {
  revenuePassed.add('lock')
  try { await main() }
  catch (e) { revenueFailureReported = true; publishRevenueNotices(e); throw e }
  revenuePassed.add(revenueStage)
  publishRevenueNotices()
}, { staleMs: 2 * 3600_000 }).catch(e => {
  const msg = e.code === 'ELOCKED'
    ? `CBOB REVENUE CYCLE DID NOT RUN: ${e.message}`
    : `CBOB REVENUE CYCLE FAILED: ${e.message}`
  console.error(msg)
  if (!revenueFailureReported) publishRevenueNotices(e, 'lock')
  process.exit(3)
})
