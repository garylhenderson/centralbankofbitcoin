/**
 * The signing guard and the error names: the page sends ONLY the message it
 * built and simulated, and a program refusal is shown by its own name.
 */
import { Keypair, Transaction, TransactionInstruction, PublicKey } from '@solana/web3.js'
import { signExact, explainError, setProgramNames, buildForWallet, simulate, sendSigned, sendRaw, DRY_RUN_OPTS, SEND_BLOCKHASH_RETRIES, withComputeBudget, pageUnits, CB_PROGRAM, LIGHTHOUSE_PROGRAM, PAGE_CU_PRICE, LIGHTHOUSE_CU_ALLOWANCE, MAX_WALLET_PRIORITY_LAMPORTS } from '../src/lib/tx.mjs'
import { PROFILES } from '../src/config.js'
import ERRORS from '../src/generated/errors.json' with { type: 'json' }
import { generate } from '../gen-errors.mjs'
import { harness } from './ref.mjs'

const H = harness('tx')
const me = Keypair.fromSeed(Buffer.alloc(32, 1))
const build = () => { const t = new Transaction().add(new TransactionInstruction({ programId: new PublicKey(PROFILES.mainnet.programs.burn), data: Buffer.from([1, 2, 3]), keys: [{ pubkey: me.publicKey, isSigner: true, isWritable: true }] }))
  t.feePayer = me.publicKey; t.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'; return t }
const honest = { signTransaction: async tx => { tx.sign(me); return tx } }
const adder = { signTransaction: async tx => { const t = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }))
  t.add(new TransactionInstruction({ programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), data: Buffer.from('guard'), keys: [] })); t.sign(me); return t } }
const forger = { signTransaction: async tx => { tx.addSignature(me.publicKey, Buffer.alloc(64, 9)); return tx } }
let ok = false; try { await signExact(honest, build()); ok = true } catch { ok = false }
H.t('an honest wallet: the signed transaction is accepted', ok)
let msg = ''; try { await signExact(adder, build()) } catch (e) { msg = e.message }
H.t('a wallet that ADDS an instruction (a "guard"): refused, nothing sent', /changed the transaction/.test(msg), msg)
msg = ''; try { await signExact(forger, build()) } catch (e) { msg = e.message }
H.t('a wallet returning a signature that does not verify: refused', /do not verify/.test(msg), msg)

// ROUND 46, then round 47 (the holder pages): Phantom wraps a transaction in compute-budget
// and Lighthouse instructions. EVERY page accepts exactly that wrap, bounded, and the page
// sets its own compute budget so Phantom's 200,000-CU limit cannot starve a crack.
{
  const CB = new PublicKey(CB_PROGRAM), LH = new PublicKey(LIGHTHOUSE_PROGRAM)
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }, u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
  const cbLimit = n => new TransactionInstruction({ programId: CB, keys: [], data: Buffer.concat([Buffer.from([2]), u32(n)]) })
  const cbPrice = n => new TransactionInstruction({ programId: CB, keys: [], data: Buffer.concat([Buffer.from([3]), u64(n)]) })
  const lh = (w = false, signer = false) => new TransactionInstruction({ programId: LH, keys: [{ pubkey: Keypair.fromSeed(Buffer.alloc(32, 5)).publicKey, isSigner: signer, isWritable: w }], data: Buffer.from([6, 4, 1, 0]) })
  const wallet = edit => ({ signTransaction: async tx => { const t = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })); edit(t); t.sign(me); return t } })
  const prepend = (...ixs) => t => { t.instructions = [...ixs, ...t.instructions] }
  const append = (...ixs) => t => { t.instructions = [...t.instructions, ...ixs] }
  // Phantom as measured: its budget only when the page set none, Lighthouse before and after
  const phantom = wallet(t => { if (!t.instructions.some(ix => ix.programId.equals(CB))) prepend(cbLimit(200000), cbPrice(375000))(t); prepend(lh())(t); append(lh())(t) })
  const mk = ixs => { const t = new Transaction().add(...ixs); t.feePayer = me.publicKey; t.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'; return t }
  const work = (prog, data) => new TransactionInstruction({ programId: new PublicKey(prog), data: Buffer.from(data), keys: [{ pubkey: me.publicKey, isSigner: true, isWritable: true }] })
  const P = PROFILES.mainnet.programs
  const crack = () => mk([work(P.seal, [1]), work(P.burn, [2]), work(P.mint, [3])])                     // open, burn, retire
  const budgeted = () => mk([cbLimit(228_000), cbPrice(PAGE_CU_PRICE), work(P.seal, [1]), work(P.burn, [2])])
  const tryIt = async (w, opts = {}, tx = build()) => { try { await signExact(w, tx, [], opts); return 'ok' } catch (e) { return e.message } }

  H.eq('R47: a Phantom-wrapped transaction is ACCEPTED on a holder page', await tryIt(phantom, { minUnits: 120_000 }), 'ok')
  H.eq('R47: a Phantom-wrapped CRACK (SEAL open + BURN burn + MINT retire) is ACCEPTED (measured to land on a local chain)', await tryIt(phantom, { minUnits: 120_000 }, crack()), 'ok')
  H.eq('R47: the page\'s OWN compute budget, kept by the wallet, with Lighthouse around it, is ACCEPTED', await tryIt(phantom, { minUnits: 228_000 }, budgeted()), 'ok')
  H.eq('R47: ...and with the guard slipped in AFTER the page\'s budget (the runtime reads a budget anywhere), still ACCEPTED', await tryIt(wallet(t => { t.instructions.splice(2, 0, lh()); append(lh())(t) }), { minUnits: 228_000 }, budgeted()), 'ok')
  H.t('R47: a wallet budget BELOW what the page measured is refused (Phantom\'s 200,000 on a 228,000 crack)', /compute limit of 200000, below the 228000/.test(await tryIt(phantom, { minUnits: 228_000 }, crack())))
  H.t('R47: the wallet CHANGING the page\'s own compute budget is refused', /changed, removed or reordered|does not allow/.test(await tryIt(wallet(t => { t.instructions[0] = cbLimit(200_000) }), { minUnits: 228_000 }, budgeted())))
  H.t('R47: the wallet ADDING a second budget when the page set one is refused', /does not allow|changed, removed/.test(await tryIt(wallet(prepend(cbPrice(1))), { minUnits: 228_000 }, budgeted())))
  H.t('R47: an added instruction for any other program is refused, naming it', /MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr/.test(await tryIt(wallet(append(new TransactionInstruction({ programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [], data: Buffer.from('x') }))))))
  H.t('R47: an instruction the page built, CHANGED by the wallet, is refused', /changed, removed or reordered|does not allow/.test(await tryIt(wallet(t => { t.instructions[0].data = Buffer.from([7, 7, 7]) }))))
  H.t('R47: the page\'s instructions REORDERED by the wallet are refused', /changed, removed or reordered/.test(await tryIt(wallet(t => { t.instructions = [t.instructions[1], t.instructions[0], t.instructions[2]] }), {}, crack())))
  H.t('R47: a page instruction DROPPED by the wallet is refused', /changed, removed or reordered/.test(await tryIt(wallet(t => { t.instructions = t.instructions.slice(0, 2) }), {}, crack())))
  H.t('R47: a guard put IN BETWEEN the page\'s work (not a measured shape) is refused', /in between/.test(await tryIt(wallet(t => { t.instructions.splice(1, 0, lh()) }), {}, crack())))
  H.t('R47: a priority fee over 0.01 SOL is refused', /priority fee/.test(await tryIt(wallet(prepend(cbLimit(1_400_000), cbPrice(10_000_000))))))
  H.t('R47: ...and with NO limit set, the fee is bounded at the cluster default (200,000 per instruction: 3 x 200,000 x 20,000,000 = 0.012 SOL)', /priority fee/.test(await tryIt(wallet(prepend(cbPrice(20_000_000))), {}, crack())))
  H.t('R47: a compute-budget kind the page does not allow is refused (heap frame)', /kind 1/.test(await tryIt(wallet(prepend(new TransactionInstruction({ programId: CB, keys: [], data: Buffer.concat([Buffer.from([1]), u32(262144)]) }))))))
  H.t('R47: a guard that makes a NEW account writable is refused', /writable/.test(await tryIt(wallet(append(lh(true))))))
  H.t('R47: a guard that adds a SIGNER (one the wallet also signs for) is refused', /added a signer/.test(await tryIt({ signTransaction: async tx => { const t = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })); t.add(lh(false, true)); t.sign(me, Keypair.fromSeed(Buffer.alloc(32, 5))); return t } })))
  H.t('R47: a changed fee payer is refused', /fee payer|do not verify|missing/.test(await tryIt({ signTransaction: async tx => { const t = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })); const o = Keypair.fromSeed(Buffer.alloc(32, 8)); t.feePayer = o.publicKey; t.sign(o, me); return t } })))

  // the page's own budget
  const bare = [work(P.seal, [1])]
  const withCb = withComputeBudget(bare, 194_694, me.publicKey)
  H.eq('R47: the page sets its own budget when it fits: limit = measured +10% + the Lighthouse allowance, price PAGE_CU_PRICE', [withCb.length, Buffer.from(withCb[0].data).readUInt32LE(1), Buffer.from(withCb[1].data).readBigUInt64LE(1)], [3, Math.ceil(194_694 * 1.1) + LIGHTHOUSE_CU_ALLOWANCE, BigInt(PAGE_CU_PRICE)])
  H.t('R47: ...never twice', withComputeBudget(withCb, 194_694, me.publicKey) === withCb)
  const fat = [new TransactionInstruction({ programId: new PublicKey(P.seal), data: Buffer.alloc(1060), keys: [{ pubkey: me.publicKey, isSigner: true, isWritable: true }] })]
  H.t('R47: ...and NOT when the budget would push it over 1,232 bytes (the cluster default applies)', withComputeBudget(fat, 100_000, me.publicKey) === fat)
  H.eq('R47: the page budget never exceeds the 1,400,000-CU cap', pageUnits(5_000_000), 1_400_000)
  H.t('R47: the page\'s budget fee is far under the wallet cap (0.01 SOL) at the cap limit', BigInt(PAGE_CU_PRICE) * 1_400_000n / 1_000_000n < BigInt(MAX_WALLET_PRIORITY_LAMPORTS))

  // buildForWallet: the dry run shown is of the transaction the holder signs
  const sims = []
  const conn = { getLatestBlockhash: async () => ({ blockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N', lastValidBlockHeight: 9 }),
    simulateTransaction: async vtx => { sims.push(vtx.message.compiledInstructions.length); return { value: { err: null, logs: [], unitsConsumed: 100_000 + sims.length, accounts: null } } } }
  const b = await buildForWallet(conn, bare, me.publicKey)
  H.eq('R47: buildForWallet dry-runs the bare work, then RE-runs the budgeted transaction it hands the wallet', [sims, b.budgeted, b.tx.instructions.length, b.sim.unitsConsumed, b.minUnits], [[1, 3], true, 3, 100_002, pageUnits(100_001)])
}
setProgramNames(PROFILES.mainnet.programs)
const t = build()
const rl = ERRORS.burn.findIndex(e => e.name === 'RateLimited')
H.t('a BURN custom error is named from the program\'s own list (RateLimited)', /RateLimited/.test(explainError({ InstructionError: [0, { Custom: 6000 + rl }] }, t)))
H.t('an unknown program\'s error is reported by number, not guessed', /error 6001/.test(explainError({ InstructionError: [0, { Custom: 6001 }] }, { instructions: [{ programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') }] })))
// ROUND 46 (Gary on the hosted rehearsal page: "BlockhashNotFound"): behind a load-balanced
// RPC the node that SIMULATES may not have seen the blockhash the page fetched from another.
// The dry run asks the node for its own blockhash; what the wallet signs and the page sends
// keeps the page's own, and a lagging PREFLIGHT gets the same signed bytes again, bounded.
{
  const PAGE_BH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'
  const seen = []
  const lagging = { simulateTransaction: async (vtx, opts) => { seen.push({ bh: vtx.message.recentBlockhash, opts })
    if (!opts?.replaceRecentBlockhash) return { context: { slot: 1 }, value: { err: 'BlockhashNotFound', logs: [], accounts: null, unitsConsumed: 0 } }
    return { context: { slot: 1 }, value: { err: null, logs: ['ok'], accounts: null, unitsConsumed: 1234 } } } }
  const sim = await simulate(lagging, build())
  H.eq('R46: the dry run on a node that never saw the page\'s blockhash PASSES (the node substitutes its own)', [sim.err, sim.unitsConsumed], [null, 1234])
  H.eq('R46: ...the dry run asks for replaceRecentBlockhash, unsigned', [DRY_RUN_OPTS.replaceRecentBlockhash, DRY_RUN_OPTS.sigVerify, seen[0].opts.replaceRecentBlockhash], [true, false, true])
  const sendErr = (n, msg) => { let k = 0; const bh = []; return { sends: bh, sendRawTransaction: async raw => { bh.push(Transaction.from(raw).recentBlockhash + ':' + Buffer.from(raw).toString('base64').length)
    if (k++ < n) throw new Error(msg); return 'SIG' }, getSignatureStatuses: async () => ({ value: [{ err: null, confirmationStatus: 'confirmed' }] }), getBlockHeight: async () => 1 } }
  const signed = build(); signed.sign(me)
  const lag2 = sendErr(2, 'failed to send transaction: Transaction simulation failed: Blockhash not found')
  H.eq('R46: a send whose PREFLIGHT lags the blockhash is sent again (same bytes, the page\'s blockhash) and lands', [await sendSigned(lag2, signed, PAGE_BH, 100).catch(e => e.message), lag2.sends.length, new Set(lag2.sends).size, lag2.sends[0].startsWith(PAGE_BH)], ['SIG', 3, 1, true])
  const other = sendErr(1, 'Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1770')
  let m = ''; try { await sendRaw(other, signed.serialize(), async () => {}) } catch (e) { m = e.message }
  H.t('R46: any OTHER send refusal is thrown at once, never resent', /0x1770/.test(m) && other.sends.length === 1, `${m} ${other.sends.length}`)
  const never = sendErr(99, 'Blockhash not found')
  m = ''; try { await sendRaw(never, signed.serialize(), async () => {}) } catch (e) { m = e.message }
  H.eq('R46: a blockhash that never appears: bounded resends, then the refusal is shown', [/Blockhash not found/.test(m), never.sends.length], [true, SEND_BLOCKHASH_RETRIES + 1])
}
H.eq('web/src/generated/errors.json is current with the programs\' source', ERRORS, generate())
H.eq('error counts per program (SEAL, MINT, BURN, GOV)', Object.fromEntries(Object.entries(ERRORS).map(([k, v]) => [k, v.length])), Object.fromEntries(Object.entries(generate()).map(([k, v]) => [k, v.length])))
export default H.done()
