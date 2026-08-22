#!/usr/bin/env node
/**
 * THE REVENUE CYCLE: sweep -> swap -> return -> split.
 *
 *   1. sweep_sol_for_swap   SOL leaves the revenue address for the pinned swap
 *                           operator, never below the fee reserve.   [on-chain]
 *   2. swap                 SOL -> cbBTC via Jupiter.               [OFF-CHAIN]
 *   3. return               the cbBTC goes straight back to the revenue
 *                           address's ATA.                           [off-chain]
 *   4. split_revenue        85% -> distributor, 15% -> Squads.       [on-chain]
 *
 * STEPS 2 AND 3 ARE THE ONLY TRUSTED PART OF THE WHOLE REVENUE PATH, and they
 * are trusted for a reason that cannot be engineered away here: there is no
 * trustless SOL->cbBTC without a DEX CPI. So they are made small and loud
 * instead of pretended away. Every cycle writes what it swept and what it
 * returned; `--audit` reconciles the two and the Bank alarm reads the same file.
 *
 * DEFAULTS TO DRY RUN. It moves real money; `--live` is deliberate.
 *
 *   node bank/revenue.mjs              # quote and plan only
 *   node bank/revenue.mjs --live
 *   node bank/revenue.mjs --audit      # swept vs returned, all time
 */
import fs from 'fs'
import { execFileSync } from 'child_process'
import { withLock, readLedger, writeLedger } from './lock.mjs'
import { readTokenAccount, requireTokenAmount, isProvablyEmpty } from './spl.mjs'
import { pinnedAccountData } from './anchor.mjs'
import { cycleIsOpen } from './detectors.mjs'
import { createHash } from 'crypto'
import { PublicKey, Connection, Keypair, Transaction, TransactionInstruction, SystemProgram,
  VersionedTransaction, sendAndConfirmTransaction } from '/opt/gary-club/node_modules/@solana/web3.js/lib/index.cjs.js'
import { getAssociatedTokenAddressSync, createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction } from '/opt/gary-club/node_modules/@solana/spl-token/lib/cjs/index.js'

const ARGS = new Set(process.argv.slice(2))
const LIVE = ARGS.has('--live')
const LEDGER = process.env.CBOB_REVENUE_LEDGER || '/opt/cbob-vaults/bank/revenue-ledger.json'
const NOTIFY = '/opt/scripts/notify-gary-sms.sh'
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
 *  `sweep_sol_for_swap` is permissionless, so a constant in this file bound
 *  nobody who chose not to run this file. The bound is now `max_sweep_lamports`
 *  and `sweep_cooldown_secs` in the program, which is what makes the claim true.
 *  Set this at or below the on-chain cap. */
const MAX_PER_CYCLE_LAMPORTS = 50_000_000_000n   // 50 SOL
const SLIPPAGE_BPS = 100
/** Ceiling on the QUOTE, separate from slippage on its execution. */
const MAX_PRICE_IMPACT_PCT = 1.5
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

async function main() {
  if (ARGS.has('--audit')) return audit()
  const conn = new Connection(rpc(), 'confirmed')
  const led = load()
  const cfgAcc = await conn.getAccountInfo(MINT_CFG, 'confirmed')
  // OWNER, DISCRIMINATOR AND VERSION BEFORE ANY OFFSET — the pinning round 11
  // applied to the alarm and not to the two jobs that move money.
  const cfg = { data: pinnedAccountData(cfgAcc, { program: MINT_PROG, struct: 'MintConfig',
    what: 'the MINT config' }) }
  if (!cfg.data) { console.log('mint config not initialised — no revenue to cycle yet'); return }
  if (!cfg) { console.log('mint config not initialised — no revenue to cycle yet'); return }
  const holders = new PublicKey(cfg.data.subarray(137, 169))
  const bankWallet = new PublicKey(cfg.data.subarray(221, 253))
  const operatorPk = new PublicKey(cfg.data.subarray(256, 288))
  const reserve = cfg.data.readBigUInt64LE(288)
  const splitBps = cfg.data.readUInt16LE(253)
  // THE BOUNDS THIS SCRIPT MUST OBEY LIVE ON CHAIN. It used to sweep its own
  // hardcoded 50 SOL and never read `max_sweep_lamports`, `sweep_cooldown_secs`
  // or `last_sweep_at` — so a config the script disagreed with produced an
  // on-chain rejection AFTER the intent row was written, which then wedged every
  // future run and raised a CRITICAL about lamports that never moved. The
  // 6-hourly cron guarantees this against any cooldown longer than six hours.
  const chainCap = cfg.data.readBigUInt64LE(297)
  const cooldown = cfg.data.readBigInt64LE(305)
  const lastSweep = cfg.data.readBigInt64LE(313)
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  if (nowSec < lastSweep + cooldown) {
    console.log(`  cooldown: the last sweep was at ${lastSweep}, next allowed at ${lastSweep + cooldown} (now ${nowSec}). Nothing to do.`)
    return
  }

  const KEYFILE = '/opt/cbob-vaults/bank/keys/swap-operator.json'
  const mode = fs.statSync(KEYFILE).mode & 0o777
  if (mode & 0o077) throw new Error(`${KEYFILE} is mode ${mode.toString(8)} — a signing key readable by anyone but its owner is not a key`)
  const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYFILE, 'utf8'))))
  if (!operator.publicKey.equals(operatorPk))
    throw new Error(`local operator key ${operator.publicKey} is not the one pinned in config (${operatorPk})`)

  // A CYCLE THAT NEVER FINISHED IS NOT A REASON TO START ANOTHER.
  // After a successful sweep whose swap then failed, the next run saw a swept
  // revenue address, printed "nothing to sweep" and returned — never looking at
  // the open cycle, never reporting it, and stacking a fresh sweep on top of it
  // the moment more income arrived. The unfinished one is the news.
  // ONE predicate, imported. This line was a THIRD copy of the question and it
  // carried the original truthiness bug: `!'0'` is false, so a cycle that
  // returned NOTHING read as closed and a fresh sweep stacked on top of it.
  const open = (led.cycles || []).filter(cycleIsOpen)
  if (open.length) {
    throw new Error(`${open.length} revenue cycle(s) swept SOL and never recorded a cbBTC return (oldest ${open[0].startedAt}). Resolve them by hand — the SOL is on the operator key — before another cycle runs. \`--audit\` lists them.`)
  }

  // THE OPERATOR PAYS FOR FOUR TRANSACTIONS out of its own balance — the swap,
  // the return transfer, two idempotent ATA creations and the split — and
  // nothing checked or funded it. On a fresh operator the first cycle would
  // sweep the SOL, buy the cbBTC, and then fail to send it back for want of a
  // few thousand lamports, leaving an open cycle and a CRITICAL.
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

  // ---- quote first, so a bad market stops us BEFORE any SOL moves ----
  const q = await (await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${SOL}&outputMint=${CBBTC.toBase58()}&amount=${amount}&slippageBps=${SLIPPAGE_BPS}`)).json()
  if (!q?.outAmount) throw new Error(`no Jupiter route: ${JSON.stringify(q).slice(0, 200)}`)
  console.log(`  quote: ${amount} lamports -> ${q.outAmount} sats (impact ${q.priceImpactPct}%)`)
  // slippageBps bounds execution against the QUOTE; it says nothing about the
  // quote itself. A route through a manipulated pool can be honoured exactly as
  // quoted and still be robbery, so the quote gets its own ceiling.
  // `?? 0` made a response that OMITS the field read as 0% impact and sail past
  // the ceiling — a missing measurement is not a good measurement.
  if (q.priceImpactPct === undefined || q.priceImpactPct === null)
    throw new Error('the Jupiter quote carried no priceImpactPct; refusing to swap against an unmeasured route')
  const impact = Math.abs(Number(q.priceImpactPct))
  if (!Number.isFinite(impact) || impact > MAX_PRICE_IMPACT_PCT)
    throw new Error(`price impact ${q.priceImpactPct}% exceeds the ${MAX_PRICE_IMPACT_PCT}% ceiling — refusing to swap into a thin or manipulated route`)
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
    const rejected = /custom program error|Error Code:|Transaction simulation failed/.test(String(e.message))
    if (rejected) {
      cycle.sendRejected = true
      cycle.error = String(e.message).slice(0, 300)
      save(led)
      throw new Error(`the sweep was REFUSED by the program and no SOL moved: ${cycle.error}`)
    }
    throw e     // unconfirmed: the row stays open, which is correct
  }
  cycle.sweptLamports = String(amount); save(led)

  // Measured BEFORE the swap so the return can be a delta rather than a balance.
  cycle.operatorSatsBefore = String(opBefore); save(led)

  // 2. swap (OFF-CHAIN, the trusted hop)
  // RE-QUOTE. The quote above was taken before the SOL moved and is used only to
  // decide whether to move it; submitting that same stale quote afterwards is how
  // a swap fails on a route that has since changed, leaving the SOL stranded on
  // the operator key. The impact ceiling is re-checked on the fresh quote too.
  const q2 = await (await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${SOL}&outputMint=${CBBTC.toBase58()}&amount=${amount}&slippageBps=${SLIPPAGE_BPS}`)).json()
  if (!q2?.outAmount) throw new Error(`no Jupiter route after the sweep: ${JSON.stringify(q2).slice(0, 200)}`)
  // THE SAME RULE AS THE FIRST QUOTE. `?? 0` was fixed on the pre-sweep quote and
  // left here — and this is the quote that MATTERS, because by now the SOL has
  // already left the revenue address. Both round-8 auditors found it independently,
  // and it is the third time in three rounds that a fix landed on one of two
  // identical sites.
  if (q2.priceImpactPct === undefined || q2.priceImpactPct === null)
    throw new Error('the post-sweep Jupiter quote carried no priceImpactPct; refusing to swap against an unmeasured route')
  const impact2 = Math.abs(Number(q2.priceImpactPct))
  if (!Number.isFinite(impact2) || impact2 > MAX_PRICE_IMPACT_PCT)
    throw new Error(`post-sweep price impact ${q2.priceImpactPct}% exceeds ${MAX_PRICE_IMPACT_PCT}% — SOL is on the operator key and must be returned or swapped by hand`)
  // AND AN OUTPUT FLOOR, because price impact is not a price. It measures the
  // route's own depth, not whether cbBTC/SOL moved between the two quotes, so a
  // shallow-impact route at a terrible rate passes it happily. The first quote is
  // the number the decision to sweep was made on; hold the second to it.
  const minOut = BigInt(q.outAmount) * BigInt(10_000 - MAX_REQUOTE_DRIFT_BPS) / 10_000n
  if (BigInt(q2.outAmount) < minOut)
    throw new Error(`the post-sweep quote is ${q2.outAmount} sats against ${q.outAmount} before the sweep, below the ${MAX_REQUOTE_DRIFT_BPS / 100}% drift this cycle allows — SOL is on the operator key and must be returned or swapped by hand`)
  cycle.quotedSats = q2.outAmount; save(led)
  const sw = await (await fetch('https://quote-api.jup.ag/v6/swap', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteResponse: q2, userPublicKey: operator.publicKey.toBase58(), wrapAndUnwrapSol: true }) })).json()
  const vtx = VersionedTransaction.deserialize(Buffer.from(sw.swapTransaction, 'base64'))
  // LOOK AT IT BEFORE SIGNING IT. `vtx.sign([operator])` on whatever an HTTP
  // response returned is a blank cheque: the operator holds the swept SOL and any
  // cbBTC in flight, so a substituted or tampered response could simply ask for
  // it. The on-chain cap bounds the sweep and nothing bounded this.
  //
  // This is a bound, not a proof. Jupiter routes through many programs and
  // enumerating them all would break on their next release, so the check is
  // narrow and honest: exactly ONE signer (us), and no program in the message
  // that we know moves value outside a swap. A dedicated operator wallet holding
  // nothing but the cycle's own funds is the other half, and is an ops matter.
  {
    const msg = vtx.message
    const signers = msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures)
    if (signers.length !== 1 || !signers[0].equals(operator.publicKey))
      throw new Error(`the swap transaction wants ${signers.length} signer(s) and we expect exactly one (the operator): ${signers.map(k => k.toBase58()).join(', ')}`)
    const keys = msg.staticAccountKeys.map(k => k.toBase58())
    const FORBIDDEN = ['BPFLoaderUpgradeab1e11111111111111111111111', MINT_PROG.toBase58()]
    const bad = keys.filter(k => FORBIDDEN.includes(k))
    if (bad.length) throw new Error(`the swap transaction touches ${bad.join(', ')}, which no swap needs`)
    if (msg.addressTableLookups?.length > 4)
      throw new Error(`the swap transaction carries ${msg.addressTableLookups.length} address table lookups, more than any route we expect`)
  }
  vtx.sign([operator])
  cycle.swapSig = await conn.sendRawTransaction(vtx.serialize(), { skipPreflight: false })
  await conn.confirmTransaction({ signature: cycle.swapSig, ...(await conn.getLatestBlockhash()) }, 'confirmed')
  save(led)

  // 3. return EVERYTHING to the revenue address
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
  if (delta < minOut)
    throw new Error(`the swap credited ${delta} sats to the operator (balance ${opBefore} -> ${after}) against a floor of ${minOut}. Refusing to record it as this cycle's return.`)
  // Send everything the ATA holds — leftovers from a previous cycle belong to the
  // project too — but RECORD only what this cycle produced.
  const got = after
  cycle.returnSig = await sendAndConfirmTransaction(conn, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, revAta, REVENUE, CBBTC),
    createTransferCheckedInstruction(opAta, CBBTC, revAta, operator.publicKey, got, 8)),
    [operator], { commitment: 'confirmed' })
  cycle.returnedSats = String(delta)
  // WHEN the cbBTC landed, so the watcher can grace the unsplit check from the
  // return instead of from the sweep. Graced from `startedAt`, `cycle_unsplit`
  // fired a HIGH about a cycle that was mid-step-4 in another process.
  cycle.returnedAt = new Date().toISOString()
  cycle.sweptAtaTotal = String(got); save(led)

  // 4. split (on-chain, enforced, permissionless)
  //
  // ANYONE MAY SPLIT, so a stranger front-running this leaves our own call
  // reverting on `NothingToSplit` — and the cycle would then carry a return with
  // no `splitSig` forever, wedging every later run at the open-cycle guard for a
  // split that DID happen. Their split divided our cbBTC by the same enforced
  // rule to the same pinned addresses, so the money is where it should be; only
  // the bookkeeping is missing. Record that rather than throwing on it.
  const ataOf = w => getAssociatedTokenAddressSync(CBBTC, w, true)
  cycle.splitSig = await sendAndConfirmTransaction(conn, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, ataOf(holders), holders, CBBTC),
    createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, ataOf(bankWallet), bankWallet, CBBTC),
    new TransactionInstruction({ programId: MINT_PROG,
      data: Buffer.concat([d('split_revenue'), Buffer.from([8])]),
      keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: false },
        { pubkey: REVENUE, isSigner: false, isWritable: true },
        { pubkey: CBBTC, isSigner: false, isWritable: false },
        { pubkey: revAta, isSigner: false, isWritable: true },
        { pubkey: ataOf(holders), isSigner: false, isWritable: true },
        { pubkey: ataOf(bankWallet), isSigner: false, isWritable: true },
        { pubkey: TOKEN, isSigner: false, isWritable: false }] })),
    [operator], { commitment: 'confirmed' }).catch(async e => {
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

// One runner, or two cycles sweep at once and neither ledger entry is complete.
withLock(LOCK, main, { staleMs: 2 * 3600_000 }).catch(e => {
  const msg = e.code === 'ELOCKED'
    ? `CBOB REVENUE CYCLE DID NOT RUN: ${e.message}`
    : `CBOB REVENUE CYCLE FAILED: ${e.message}`
  console.error(msg)
  if (LIVE) { try { execFileSync(NOTIFY, [msg, 'cbob-revenue']) } catch {} }
  process.exit(3)
})
