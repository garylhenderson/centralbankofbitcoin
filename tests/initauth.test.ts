/**
 * Does THIS build trust the test key as INIT_AUTHORITY?
 *
 * Prints ACCEPTS or REJECTS. Used by scripts/build-mainnet.sh against both the
 * localnet build (must ACCEPT) and the mainnet build (must REJECT), which is the
 * only way to verify which key shipped: the compiler folds the 32-byte compare
 * into instruction immediates, so no contiguous run of even 4 key bytes survives
 * in the .so and a byte search can never answer the question.
 */
import { createHash } from 'crypto'
import { Connection, Keypair, PublicKey as W, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
const conn = new Connection('http://127.0.0.1:8999', 'confirmed')
const MINT_PROG = new W('Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo')
const [MINT_CFG] = W.findProgramAddressSync([Buffer.from('mint-config')], MINT_PROG)
const d = (n: string) => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8)
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b }

async function main() {
  const testKey = Keypair.fromSeed(Buffer.alloc(32, 7))   // the --features localnet key
  await conn.confirmTransaction({ signature: await conn.requestAirdrop(testKey.publicKey, 50 * LAMPORTS_PER_SOL),
    ...(await conn.getLatestBlockhash()) }, 'confirmed')
  const k = Keypair.generate()
  try {
    await sendAndConfirmTransaction(conn, new Transaction().add(new TransactionInstruction({
      programId: MINT_PROG,
      data: Buffer.concat([d('initialize'), k.publicKey.toBuffer(), k.publicKey.toBuffer(),
        k.publicKey.toBuffer(), k.publicKey.toBuffer(), k.publicKey.toBuffer(), k.publicKey.toBuffer(),
        u64(0n), u64(2100n)]),
      keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: true },
        { pubkey: testKey.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] })),
      [testKey], { commitment: 'confirmed' })
    console.log('VERDICT: ACCEPTS the test key as INIT_AUTHORITY')
  } catch (e: any) {
    const l = (e?.logs || []).find((x: string) => /Error Code/.test(x)) || String(e?.message || e)
    if (/NotTheInitAuthority/.test(l)) console.log('VERDICT: REJECTS the test key as INIT_AUTHORITY')
    else console.log(`VERDICT: INCONCLUSIVE — rejected for a different reason: ${l.slice(0, 120)}`)
  }
}
main().catch(e => { console.log(`VERDICT: INCONCLUSIVE — ${e?.message || e}`); process.exit(1) })
