/**
 * The signing guard and the error names: the page sends ONLY the message it
 * built and simulated, and a program refusal is shown by its own name.
 */
import { Keypair, Transaction, TransactionInstruction, PublicKey } from '@solana/web3.js'
import { signExact, explainError, setProgramNames } from '../src/lib/tx.mjs'
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

// ROUND 46 (the hosted rehearsal page): Phantom adds compute-budget and Lighthouse
// instructions. The CEREMONY accepts exactly those, bounded; everything else stays refused.
{
  const CB = new PublicKey('ComputeBudget111111111111111111111111111111'), LH = new PublicKey('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95')
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }, u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
  const cbLimit = n => new TransactionInstruction({ programId: CB, keys: [], data: Buffer.concat([Buffer.from([2]), u32(n)]) })
  const cbPrice = n => new TransactionInstruction({ programId: CB, keys: [], data: Buffer.concat([Buffer.from([3]), u64(n)]) })
  const lh = (w = false) => new TransactionInstruction({ programId: LH, keys: [{ pubkey: Keypair.fromSeed(Buffer.alloc(32, 5)).publicKey, isSigner: false, isWritable: w }], data: Buffer.from([9, 9]) })
  const wallet = edit => ({ signTransaction: async tx => { const t = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })); edit(t); t.sign(me); return t } })
  const prepend = (...ixs) => t => { t.instructions = [...ixs, ...t.instructions] }
  const append = (...ixs) => t => { t.instructions = [...t.instructions, ...ixs] }
  const phantom = wallet(t => { prepend(cbLimit(200000), cbPrice(1000))(t); append(lh())(t) })
  const progs = { seal: PROFILES.mainnet.programs.seal, burn: '11111111111111111111111111111112' }
  const tryIt = async (w, opts, tx = build()) => { try { await signExact(w, tx, [], opts); return 'ok' } catch (e) { return e.message } }
  H.eq('R46 ceremony: a Phantom-like wallet adding compute budget and a Lighthouse guard is ACCEPTED on the ceremony', await tryIt(phantom, { allowWalletAdditions: true, programs: progs }), 'ok')
  H.t('R46 ceremony: ...and the same wallet is still REFUSED on every other page', /changed the transaction/.test(await tryIt(phantom, {})))
  H.t('R46 ceremony: an added instruction for any other program is refused, naming it', /MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr/.test(await tryIt(wallet(append(new TransactionInstruction({ programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [], data: Buffer.from('x') }))), { allowWalletAdditions: true, programs: progs })))
  H.t('R46 ceremony: an instruction the page built, CHANGED by the wallet, is refused', /changed, removed or reordered|does not allow/.test(await tryIt(wallet(t => { t.instructions[0].data = Buffer.from([7, 7, 7]) }), { allowWalletAdditions: true, programs: progs })))
  H.t('R46 ceremony: a priority fee over 0.01 SOL is refused', /priority fee/.test(await tryIt(wallet(prepend(cbLimit(1_400_000), cbPrice(10_000_000))), { allowWalletAdditions: true, programs: progs })))
  H.t('R46 ceremony: a guard that makes a NEW account writable is refused', /writable/.test(await tryIt(wallet(append(lh(true))), { allowWalletAdditions: true, programs: progs })))
  const sealTx = () => { const t = new Transaction().add(new TransactionInstruction({ programId: new PublicKey(progs.seal), data: Buffer.from([1]), keys: [{ pubkey: me.publicKey, isSigner: true, isWritable: true }] })); t.feePayer = me.publicKey; t.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'; return t }
  H.t('R46 ceremony: a transaction carrying a SEAL instruction stays byte-exact even with the allowance', /SEAL or BURN/.test(await tryIt(phantom, { allowWalletAdditions: true, programs: progs }, sealTx())))
}
setProgramNames(PROFILES.mainnet.programs)
const t = build()
const rl = ERRORS.burn.findIndex(e => e.name === 'RateLimited')
H.t('a BURN custom error is named from the program\'s own list (RateLimited)', /RateLimited/.test(explainError({ InstructionError: [0, { Custom: 6000 + rl }] }, t)))
H.t('an unknown program\'s error is reported by number, not guessed', /error 6001/.test(explainError({ InstructionError: [0, { Custom: 6001 }] }, { instructions: [{ programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') }] })))
H.eq('web/src/generated/errors.json is current with the programs\' source', ERRORS, generate())
H.eq('error counts per program (SEAL, MINT, BURN, GOV)', Object.fromEntries(Object.entries(ERRORS).map(([k, v]) => [k, v.length])), Object.fromEntries(Object.entries(generate()).map(([k, v]) => [k, v.length])))
export default H.done()
