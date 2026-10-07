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

setProgramNames(PROFILES.mainnet.programs)
const t = build()
const rl = ERRORS.burn.findIndex(e => e.name === 'RateLimited')
H.t('a BURN custom error is named from the program\'s own list (RateLimited)', /RateLimited/.test(explainError({ InstructionError: [0, { Custom: 6000 + rl }] }, t)))
H.t('an unknown program\'s error is reported by number, not guessed', /error 6001/.test(explainError({ InstructionError: [0, { Custom: 6001 }] }, { instructions: [{ programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') }] })))
H.eq('web/src/generated/errors.json is current with the programs\' source', ERRORS, generate())
H.eq('error counts per program (SEAL, MINT, BURN, GOV)', Object.fromEntries(Object.entries(ERRORS).map(([k, v]) => [k, v.length])), Object.fromEntries(Object.entries(generate()).map(([k, v]) => [k, v.length])))
export default H.done()
