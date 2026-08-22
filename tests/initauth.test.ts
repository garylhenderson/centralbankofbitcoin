/**
 * Does THIS build trust the test key as INIT_AUTHORITY?
 *
 * Prints ACCEPTS or REJECTS. Used by scripts/build-mainnet.sh against both the
 * localnet build (must ACCEPT) and the mainnet build (must REJECT), which is the
 * only way to verify which key shipped: the compiler folds the 32-byte compare
 * into instruction immediates, so no contiguous run of even 4 key bytes survives
 * in the .so and a byte search can never answer the question.
 *
 * ROUND 6 — IT ONLY EVER ASKED MINT. SEAL, BURN and GOV each carry their own
 * `#[cfg(feature = "localnet")]` INIT_AUTHORITY block, i.e. three more places to
 * mis-copy a key, and the build script's closing banner asserted the Squads
 * address for all four artifacts on the strength of one. Pick the program with
 * CBOB_INITAUTH_PROGRAM.
 *
 * IT MUST REJECT FOR THE RIGHT REASON. A wrong-reason rejection is a false pass
 * (round 5 shipped three of those), so anything other than NotTheInitAuthority
 * prints INCONCLUSIVE and the caller treats that as a failure. That is also why
 * SEAL's authority check was moved to the TOP of its `initialize` in round 6:
 * it used to sit below `assert_classic_spl`, which would bounce this probe first
 * and make the property untestable.
 */
import { createHash } from 'crypto'
import { Connection, Keypair, PublicKey as W, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
const conn = new Connection('http://127.0.0.1:8999', 'confirmed')
const d = (n: string) => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8)
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b }
const i64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(n); return b }
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }

const PROG = {
  mint: { id: 'Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo', seed: 'mint-config' },
  seal: { id: '9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273', seed: 'config' },
  burn: { id: '8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8', seed: 'burn-config' },
  gov:  { id: '2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2', seed: 'gov-config' },
} as const

/** Well-formed arguments for each program's `initialize`, so the ONLY thing that
 *  can reject the call is the authority check itself. */
function args(which: keyof typeof PROG, k: W): Buffer {
  const pk = () => k.toBuffer()
  switch (which) {
    // collection, bank, governance, treasury, bank_treasury, swap_operator,
    // sol_reserve_lamports, max_supply, max_sweep_lamports, sweep_cooldown_secs,
    // governance_timelock_secs.
    // ⚠️ Anchor deserializes the instruction data BEFORE the handler runs, so a
    // stale argument list here rejects with InstructionDidNotDeserialize and the
    // probe correctly reports INCONCLUSIVE — which is exactly what happened the
    // first time this ran after MINT grew an argument. Keep it in step.
    case 'mint': return Buffer.concat([d('initialize'), pk(), pk(), pk(), pk(), pk(), pk(),
      u64(0n), u64(2100n), u64(50_000_000_000n), i64(3600n), i64(604800n)])
    // collection, bank, reserve_mints: Vec<Pubkey> (empty is fine — the authority
    // check now runs FIRST, which is the whole point of moving it)
    case 'seal': return Buffer.concat([d('initialize'), pk(), pk(), u32(0)])
    case 'burn': return Buffer.concat([d('initialize'), pk(), pk()])
    // collection, quorum_bps, threshold_bps, min_voting_secs
    case 'gov':  return Buffer.concat([d('initialize'), pk(), u16(2000), u16(6000), i64(604800n)])
  }
}

/** Errors that can only be reached AFTER the INIT_AUTHORITY check. See below. */
const REACHED_PAST: Partial<Record<keyof typeof PROG, RegExp>> = {
  seal: /NoReserveMints|TooManyReserveMints|ReserveMintNotClassicSpl/,
}

async function main() {
  const which = (process.env.CBOB_INITAUTH_PROGRAM || 'mint') as keyof typeof PROG
  if (!PROG[which]) { console.log(`VERDICT: INCONCLUSIVE — unknown program ${which}`); process.exit(1) }
  const prog = new W(PROG[which].id)
  const [cfg] = W.findProgramAddressSync([Buffer.from(PROG[which].seed)], prog)
  const testKey = Keypair.fromSeed(Buffer.alloc(32, 7))   // the --features localnet key
  await conn.confirmTransaction({ signature: await conn.requestAirdrop(testKey.publicKey, 50 * LAMPORTS_PER_SOL),
    ...(await conn.getLatestBlockhash()) }, 'confirmed')
  const k = Keypair.generate()
  try {
    await sendAndConfirmTransaction(conn, new Transaction().add(new TransactionInstruction({
      programId: prog,
      data: args(which, k.publicKey),
      keys: [{ pubkey: cfg, isSigner: false, isWritable: true },
        { pubkey: testKey.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] })),
      [testKey], { commitment: 'confirmed' })
    console.log(`VERDICT: ACCEPTS the test key as INIT_AUTHORITY (${which})`)
  } catch (e: any) {
    const l = (e?.logs || []).find((x: string) => /Error Code/.test(x)) || String(e?.message || e)
    if (/NotTheInitAuthority/.test(l)) console.log(`VERDICT: REJECTS the test key as INIT_AUTHORITY (${which})`)
    // REACHED PAST IT, which is the same evidence as accepting it.
    //
    // SEAL cannot be driven to a clean success from here: its `initialize` also
    // requires a non-empty reserve list of REAL classic-SPL mint accounts, and a
    // freshly booted validator has none. But `NoReserveMints` is thrown from a
    // line BELOW the authority check — the authority check is the first statement
    // in every `initialize`, which is why round 6 moved SEAL's there — so
    // reaching it proves the key was accepted just as firmly as a success would.
    //
    // The distinction that matters: an Anchor error like
    // InstructionDidNotDeserialize or ConstraintHasOne fires BEFORE the handler
    // runs and proves NOTHING. Only errors this list names are admissible, and
    // the verdict says which kind of evidence it is.
    else if (REACHED_PAST[which]?.test(l))
      console.log(`VERDICT: ACCEPTS the test key as INIT_AUTHORITY (${which}, by reaching a later check: ${l.match(/Error Code: (\w+)/)?.[1]})`)
    else console.log(`VERDICT: INCONCLUSIVE — ${which} rejected for a different reason: ${l.slice(0, 140)}`)
  }
}
main().catch(e => { console.log(`VERDICT: INCONCLUSIVE — ${e?.message || e}`); process.exit(1) })
