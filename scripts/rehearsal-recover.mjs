/**
 * THE HAND RECOVERY OF AN OPEN REVENUE CYCLE, as SPEC limit 10's runbook says,
 * for the dress rehearsal's forced post-sweep failure (item 22.4). Rehearsal
 * only: it refuses outside a recorded rehearsal tree.
 *
 * The runbook, in order: look up every recorded or candidate signature with
 * getSignatureStatuses(searchTransactionHistory) and read the operator's wSOL and
 * cbBTC; a swap that may have landed is NEVER repeated (that is a double swap);
 * swap by hand through the same pinned venues, the same builder and the same
 * judge the automatic path uses, held to the same floor; return the cbBTC to the
 * revenue address; split; record every signature in the ledger; `--audit` after.
 */
import fs from 'fs'
import path from 'path'
import { PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, createTransferCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import * as SW from '../bank/swap.mjs'
import { readLedger, writeLedger } from '../bank/lock.mjs'
import { readTokenAccount } from '../bank/spl.mjs'
import { disc } from '../web/src/lib/enc.mjs'

const CBBTC = new PublicKey('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij')

export async function handRecover({ ROOT, conn, ids, operator, bankWallet }) {
  if (!fs.existsSync(path.join(ROOT, 'REHEARSAL-RECORD.txt'))) throw new Error('the scripted hand recovery is rehearsal-only (no REHEARSAL-RECORD.txt)')
  const LEDGER = path.join(ROOT, 'bank', 'revenue-ledger.json'), MARKER = `${LEDGER}.has-run`
  const led = readLedger(LEDGER, { cycles: [] }, MARKER)
  const open = (led.cycles || []).filter(c => c.sweepSig && !c.returnSig && !c.splitSig && !c.splitByOther)
  if (open.length !== 1) throw new Error(`expected exactly one open cycle, found ${open.length}`)
  const c = open[0]
  // 1. every recorded or candidate signature, from history
  const cands = ['sweepSig', 'pendingSweepSig', 'swapSig', 'pendingSwapSig', 'pendingReturnSig', 'pendingSplitSig'].filter(k => c[k]).map(k => [k, c[k]])
  const { value } = await conn.getSignatureStatuses(cands.map(([, s]) => s), { searchTransactionHistory: true })
  const statuses = Object.fromEntries(cands.map(([k], i) => [k, value[i] ? (value[i].err ? 'failed' : 'landed') : 'absent']))
  if (statuses.sweepSig !== 'landed') throw new Error(`the sweep ${c.sweepSig} is ${statuses.sweepSig}; nothing to recover by hand`)
  for (const k of ['swapSig', 'pendingSwapSig']) if (statuses[k] === 'landed') throw new Error(`a swap (${k}) LANDED: swapping again would be a double swap; finish the return by hand instead`)
  // 2. the operator's balances
  const opAta = getAssociatedTokenAddressSync(CBBTC, operator.publicKey)
  const before = readTokenAccount(await conn.getAccountInfo(opAta, 'confirmed'))
  const opBefore = before.state === 'absent' ? 0n : before.amount
  const lamports = BigInt(c.sweptLamports)
  const sol = BigInt(await conn.getBalance(operator.publicKey, 'confirmed'))
  if (sol < lamports) throw new Error(`the operator holds ${sol} lamports, less than the ${lamports} swept`)
  // 3. the swap, by hand, through the same builder, judge and floor
  const m = await SW.market(conn, lamports)
  if (!m.venues.length) throw new Error('no pinned venue prices within the oracle bound: hold the SOL and retry later')
  let swapSig = null, venue = null
  for (const v of m.venues) {
    const ixs = SW.swapInstructions({ venue: v, owner: operator.publicKey, lamportsIn: lamports, minSats: m.f.minSats, w: m.w, p: m.p, bitmapExists: m.bitmapExists })
    const bad = SW.judgeSwapInstructions(ixs, operator.publicKey, v, { lamportsIn: lamports, minSats: m.f.minSats })
    if (bad.length) throw new Error(`refusing the ${v} swap we built: ${bad.join('; ')}`)
    try { swapSig = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [operator], { commitment: 'confirmed' }); venue = v; break }
    catch (e) { const verdict = await SW.classifySendFailure(e, async s => (await conn.getSignatureStatuses([s], { searchTransactionHistory: true })).value[0])
      if (verdict.outcome !== 'refused') throw new Error(`the hand swap on ${v} may have landed (${verdict.outcome}); STOP and inspect before anything else`) }
  }
  if (!swapSig) throw new Error('every pinned venue refused the hand swap')
  const after = readTokenAccount(await conn.getAccountInfo(opAta, 'confirmed')).amount
  const delta = after - opBefore
  if (delta < m.f.minSats) throw new Error(`the hand swap credited ${delta} sats, below the floor ${m.f.minSats}`)
  // 4. the return, everything the operator's cbBTC account holds
  const revAta = getAssociatedTokenAddressSync(CBBTC, ids.REVENUE, true)
  const returnSig = await sendAndConfirmTransaction(conn, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, revAta, ids.REVENUE, CBBTC),
    createTransferCheckedInstruction(opAta, CBBTC, revAta, operator.publicKey, after, 8)), [operator], { commitment: 'confirmed' })
  // 5. the split, exactly as bank/revenue.mjs sends it
  const bankAta = getAssociatedTokenAddressSync(CBBTC, bankWallet, true), pool = getAssociatedTokenAddressSync(CBBTC, ids.MINT_CFG, true)
  const splitSig = await sendAndConfirmTransaction(conn, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, bankAta, bankWallet, CBBTC),
    new TransactionInstruction({ programId: ids.MINT_PROG, data: Buffer.concat([disc('split_revenue'), Buffer.from([8])]),
      keys: [{ pubkey: ids.MINT_CFG, isSigner: false, isWritable: false }, { pubkey: ids.REVENUE, isSigner: false, isWritable: true },
        { pubkey: CBBTC, isSigner: false, isWritable: false }, { pubkey: revAta, isSigner: false, isWritable: true },
        { pubkey: pool, isSigner: false, isWritable: true }, { pubkey: bankAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }] })), [operator], { commitment: 'confirmed' })
  // 6. the ledger: every signature, marked as a hand recovery
  const blockTime = (await conn.getTransaction(returnSig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }))?.blockTime ?? null
  Object.assign(c, { swapSig, swapVenue: venue, operatorSatsBefore: String(opBefore), returnSig, returnedSats: String(delta), returnedAt: new Date().toISOString(),
    returnBlockTime: blockTime, sweptAtaTotal: String(after), splitSig, handRecovered: { at: new Date().toISOString(), statuses, runbook: 'SPEC limit 10' } })
  writeLedger(LEDGER, led, MARKER)
  return { statuses, swapSig, venue, returnSig, splitSig, returnedSats: String(delta) }
}
