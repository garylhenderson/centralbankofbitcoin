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
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, createTransferCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import * as SW from '../bank/swap.mjs'
import { readLedger, writeLedger } from '../bank/lock.mjs'
import { readTokenAccount } from '../bank/spl.mjs'
import { disc } from '../web/src/lib/enc.mjs'

const CBBTC = new PublicKey('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij')
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const b58 = buf => { let n = BigInt('0x' + Buffer.from(buf).toString('hex')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n } for (const x of buf) { if (x === 0) s = '1' + s; else break } return s }

/**
 * ROUND 45 (V45-10): THE SIGNATURE IS IN THE LEDGER BEFORE THE TRANSACTION IS SENT,
 * as bank/revenue.mjs's rememberAttempt does. The transaction is signed here, its
 * signature written to `c[field]` and the ledger saved, and only then sent; so a crash
 * or a lost confirmation after a landed swap leaves the signature where step 1 of the
 * next run reads it, and the swap is never repeated.
 */
export async function sendRecorded({ conn, tx, signers, c, field, save }) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash; tx.feePayer = signers[0].publicKey; tx.sign(...signers)
  const sig = b58(tx.signature)
  c[field] = sig; save()
  await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' })
  const r = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  if (r.value.err) throw new Error(`transaction ${sig} failed: ${JSON.stringify(r.value.err)}`)
  return sig
}

/** The cycle a hand recovery already closed (V46-4): read as done, never an error. */
export const handClosed = c => !!(c?.handRecovered && c.swapSig && c.returnSig && (c.splitSig || c.splitByOther))

export async function handRecover({ ROOT, conn, ids, operator, bankWallet, deps = {} }) {
  if (!fs.existsSync(path.join(ROOT, 'REHEARSAL-RECORD.txt'))) throw new Error('the scripted hand recovery is rehearsal-only (no REHEARSAL-RECORD.txt)')
  const send = deps.send || sendRecorded, readToken = deps.readToken || readTokenAccount, sw = deps.sw || SW
  const LEDGER = path.join(ROOT, 'bank', 'revenue-ledger.json'), MARKER = `${LEDGER}.has-run`
  const led = readLedger(LEDGER, { cycles: [] }, MARKER)
  const save = () => writeLedger(LEDGER, led, MARKER)
  const open = (led.cycles || []).filter(c => c.sweepSig && !c.returnSig && !c.splitSig && !c.splitByOther)
  // V46-4: an operator (or an earlier run) that already closed the cycle by hand is DONE
  if (!open.length && handClosed((led.cycles || []).at(-1))) { const c = led.cycles.at(-1); return { alreadyRecovered: true, swapSig: c.swapSig, returnSig: c.returnSig, splitSig: c.splitSig, returnedSats: c.returnedSats } }
  if (open.length !== 1) throw new Error(`expected exactly one open cycle, found ${open.length}`)
  const c = open[0]
  // 1. every recorded or candidate signature, from history
  const cands = ['sweepSig', 'pendingSweepSig', 'swapSig', 'pendingSwapSig', 'pendingReturnSig', 'pendingSplitSig'].filter(k => c[k]).map(k => [k, c[k]])
  const { value } = await conn.getSignatureStatuses(cands.map(([, s]) => s), { searchTransactionHistory: true })
  const statuses = Object.fromEntries(cands.map(([k], i) => [k, value[i] ? (value[i].err ? 'failed' : 'landed') : 'absent']))
  if (statuses.sweepSig !== 'landed') throw new Error(`the sweep ${c.sweepSig} is ${statuses.sweepSig}; nothing to recover by hand`)
  const opAta = getAssociatedTokenAddressSync(CBBTC, operator.publicKey)
  const landedSwap = ['swapSig', 'pendingSwapSig'].find(k => statuses[k] === 'landed')
  let swapSig = null, venue = null, opBefore, credited
  if (landedSwap) {
    // V46-4: a swap that LANDED is never repeated (that is a double swap). Its credit is
    // the operator's cbBTC above the balance recorded before it was sent; then the
    // return and split continue below, each skipped if it too already landed.
    if (c.operatorSatsBefore === undefined) throw new Error(`a swap (${landedSwap}) LANDED and no balance was recorded before it: finish the return by hand`)
    swapSig = c[landedSwap]; venue = c.pendingSwapVenue || c.swapVenue || null; opBefore = BigInt(c.operatorSatsBefore)
  } else {
    // 2. the operator's balances, RECORDED before the swap is sent
    const before = readToken(await conn.getAccountInfo(opAta, 'confirmed'))
    opBefore = before.state === 'absent' ? 0n : before.amount
    c.operatorSatsBefore = String(opBefore); save()
    const lamports = BigInt(c.sweptLamports)
    const sol = BigInt(await conn.getBalance(operator.publicKey, 'confirmed'))
    if (sol < lamports) throw new Error(`the operator holds ${sol} lamports, less than the ${lamports} swept`)
    // 3. the swap, by hand, through the same builder, judge and floor
    const m = await sw.market(conn, lamports)
    if (!m.venues.length) throw new Error('no pinned venue prices within the oracle bound: hold the SOL and retry later')
    for (const v of m.venues) {
      const ixs = sw.swapInstructions({ venue: v, owner: operator.publicKey, lamportsIn: lamports, minSats: m.f.minSats, w: m.w, p: m.p, bitmapExists: m.bitmapExists })
      const bad = sw.judgeSwapInstructions(ixs, operator.publicKey, v, { lamportsIn: lamports, minSats: m.f.minSats })
      if (bad.length) throw new Error(`refusing the ${v} swap we built: ${bad.join('; ')}`)
      c.pendingSwapVenue = v; save()
      try { swapSig = await send({ conn, tx: new Transaction().add(...ixs), signers: [operator], c, field: 'pendingSwapSig', save }); venue = v; break }
      catch (e) { const verdict = await sw.classifySendFailure(e, async s => (await conn.getSignatureStatuses([s], { searchTransactionHistory: true })).value[0])
        if (verdict.outcome !== 'refused') throw new Error(`the hand swap on ${v} may have landed (${verdict.outcome}); STOP and inspect before anything else`) }
    }
    if (!swapSig) throw new Error('every pinned venue refused the hand swap')
    const after = readToken(await conn.getAccountInfo(opAta, 'confirmed')).amount
    if (after - opBefore < m.f.minSats) throw new Error(`the hand swap credited ${after - opBefore} sats, below the floor ${m.f.minSats}`)
  }
  // 4. the return, everything the operator's cbBTC account holds (once; a landed one is kept)
  const revAta = getAssociatedTokenAddressSync(CBBTC, ids.REVENUE, true)
  let returnSig = statuses.pendingReturnSig === 'landed' ? c.pendingReturnSig : null
  if (!returnSig) {
    const after = readToken(await conn.getAccountInfo(opAta, 'confirmed')).amount
    credited = after - opBefore
    if (credited <= 0n) throw new Error(`the operator holds ${after} sats, no more than the ${opBefore} it held before the swap: finish the return by hand`)
    c.swapCredited = String(credited); save()
    returnSig = await send({ conn, tx: new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, revAta, ids.REVENUE, CBBTC),
      createTransferCheckedInstruction(opAta, CBBTC, revAta, operator.publicKey, after, 8)), signers: [operator], c, field: 'pendingReturnSig', save })
  } else credited = BigInt(c.swapCredited ?? 0)
  // 5. the split, exactly as bank/revenue.mjs sends it (once; a landed one is kept)
  const bankAta = getAssociatedTokenAddressSync(CBBTC, bankWallet, true), pool = getAssociatedTokenAddressSync(CBBTC, ids.MINT_CFG, true)
  const splitSig = statuses.pendingSplitSig === 'landed' ? c.pendingSplitSig : await send({ conn, tx: new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, bankAta, bankWallet, CBBTC),
    new TransactionInstruction({ programId: ids.MINT_PROG, data: Buffer.concat([disc('split_revenue'), Buffer.from([8])]),
      keys: [{ pubkey: ids.MINT_CFG, isSigner: false, isWritable: false }, { pubkey: ids.REVENUE, isSigner: false, isWritable: true },
        { pubkey: CBBTC, isSigner: false, isWritable: false }, { pubkey: revAta, isSigner: false, isWritable: true },
        { pubkey: pool, isSigner: false, isWritable: true }, { pubkey: bankAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }] })), signers: [operator], c, field: 'pendingSplitSig', save })
  // 6. the ledger: every signature, marked as a hand recovery
  const blockTime = (await conn.getTransaction(returnSig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }))?.blockTime ?? null
  Object.assign(c, { swapSig, swapVenue: venue, operatorSatsBefore: String(opBefore), returnSig, returnedSats: String(credited), returnedAt: new Date().toISOString(),
    returnBlockTime: blockTime, splitSig, handRecovered: { at: new Date().toISOString(), statuses, runbook: 'SPEC limit 10', resumedAfterLandedSwap: !!landedSwap } })
  save()
  return { statuses, swapSig, venue, returnSig, splitSig, returnedSats: String(credited) }
}
