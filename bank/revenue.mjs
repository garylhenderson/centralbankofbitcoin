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
/** Never move more than this in one cycle. A bug or a compromised operator key
 *  is capped at one cycle's worth rather than the whole treasury. */
const MAX_PER_CYCLE_LAMPORTS = 50_000_000_000n   // 50 SOL
const SLIPPAGE_BPS = 100
const d = n => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8)
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b }
const rpc = () => (fs.readFileSync('/opt/gary-club/.env.local', 'utf8').match(/^HELIUS_RPC_URL=(.*)$/m) || [])[1].trim()
const load = () => { try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')) } catch { return { cycles: [] } } }
const save = s => fs.writeFileSync(LEDGER, JSON.stringify(s, null, 2))

function audit() {
  const l = load()
  const swept = l.cycles.reduce((a, c) => a + BigInt(c.sweptLamports || 0), 0n)
  const returned = l.cycles.reduce((a, c) => a + BigInt(c.returnedSats || 0), 0n)
  const open = l.cycles.filter(c => c.sweptLamports && !c.returnedSats)
  console.log(`revenue cycles: ${l.cycles.length}`)
  console.log(`  SOL swept out to the operator : ${swept} lamports`)
  console.log(`  cbBTC returned to revenue     : ${returned} sats`)
  console.log(`  cycles swept but NOT returned : ${open.length}`)
  for (const c of open) console.log(`    ${c.startedAt}  ${c.sweptLamports} lamports unaccounted`)
  // The one number that matters: SOL that left and never came back as cbBTC.
  if (open.length) { console.log('\n>>> UNRECONCILED. Every sweep must have a matching return.'); process.exitCode = 1 }
  return open.length
}

async function main() {
  if (ARGS.has('--audit')) return audit()
  const conn = new Connection(rpc(), 'confirmed')
  const led = load()
  const cfg = await conn.getAccountInfo(MINT_CFG, 'confirmed')
  if (!cfg) { console.log('mint config not initialised — no revenue to cycle yet'); return }
  const holders = new PublicKey(cfg.data.subarray(137, 169))
  const bankWallet = new PublicKey(cfg.data.subarray(221, 253))
  const operatorPk = new PublicKey(cfg.data.subarray(256, 288))
  const reserve = cfg.data.readBigUInt64LE(288)
  const splitBps = cfg.data.readUInt16LE(253)

  const operator = Keypair.fromSecretKey(Uint8Array.from(
    JSON.parse(fs.readFileSync('/opt/cbob-vaults/bank/keys/swap-operator.json', 'utf8'))))
  if (!operator.publicKey.equals(operatorPk))
    throw new Error(`local operator key ${operator.publicKey} is not the one pinned in config (${operatorPk})`)

  const balance = BigInt(await conn.getBalance(REVENUE, 'confirmed'))
  let amount = balance > reserve ? balance - reserve : 0n
  if (amount > MAX_PER_CYCLE_LAMPORTS) amount = MAX_PER_CYCLE_LAMPORTS
  console.log(`revenue address ${REVENUE.toBase58()}`)
  console.log(`  holds ${balance} lamports, reserve ${reserve}, sweepable ${amount}, split ${splitBps / 100}% / ${(10000 - splitBps) / 100}%`)
  if (amount === 0n) { console.log('  nothing to sweep'); return }

  // ---- quote first, so a bad market stops us BEFORE any SOL moves ----
  const q = await (await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${SOL}&outputMint=${CBBTC.toBase58()}&amount=${amount}&slippageBps=${SLIPPAGE_BPS}`)).json()
  if (!q?.outAmount) throw new Error(`no Jupiter route: ${JSON.stringify(q).slice(0, 200)}`)
  console.log(`  quote: ${amount} lamports -> ${q.outAmount} sats (impact ${q.priceImpactPct}%)`)
  if (!LIVE) { console.log('\nDRY RUN. Re-run with --live to move funds.'); return }

  const cycle = { startedAt: new Date().toISOString(), quotedSats: q.outAmount }
  led.cycles.push(cycle); save(led)

  // 1. sweep (on-chain, bounded, evented, permissionless so a cron can do it)
  cycle.sweepSig = await sendAndConfirmTransaction(conn, new Transaction().add(new TransactionInstruction({
    programId: MINT_PROG, data: Buffer.concat([d('sweep_sol_for_swap'), u64(amount)]),
    keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: false },
      { pubkey: REVENUE, isSigner: false, isWritable: true },
      { pubkey: operator.publicKey, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] })),
    [operator], { commitment: 'confirmed' })
  cycle.sweptLamports = String(amount); save(led)

  // 2. swap (OFF-CHAIN, the trusted hop)
  const sw = await (await fetch('https://quote-api.jup.ag/v6/swap', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteResponse: q, userPublicKey: operator.publicKey.toBase58(), wrapAndUnwrapSol: true }) })).json()
  const vtx = VersionedTransaction.deserialize(Buffer.from(sw.swapTransaction, 'base64'))
  vtx.sign([operator])
  cycle.swapSig = await conn.sendRawTransaction(vtx.serialize(), { skipPreflight: false })
  await conn.confirmTransaction({ signature: cycle.swapSig, ...(await conn.getLatestBlockhash()) }, 'confirmed')
  save(led)

  // 3. return EVERYTHING to the revenue address
  const opAta = getAssociatedTokenAddressSync(CBBTC, operator.publicKey)
  const revAta = getAssociatedTokenAddressSync(CBBTC, REVENUE, true)
  const got = (await conn.getAccountInfo(opAta, 'confirmed')).data.readBigUInt64LE(64)
  cycle.returnSig = await sendAndConfirmTransaction(conn, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, revAta, REVENUE, CBBTC),
    createTransferCheckedInstruction(opAta, CBBTC, revAta, operator.publicKey, got, 8)),
    [operator], { commitment: 'confirmed' })
  cycle.returnedSats = String(got); save(led)

  // 4. split (on-chain, enforced, permissionless)
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
    [operator], { commitment: 'confirmed' })
  cycle.finishedAt = new Date().toISOString(); save(led)
  console.log(`  swept ${amount} -> got ${got} sats -> split ${splitBps / 100}/${(10000 - splitBps) / 100}`)
  audit()
}

main().catch(e => {
  const msg = `CBOB REVENUE CYCLE FAILED: ${e.message}`
  console.error(msg)
  if (LIVE) { try { execFileSync(NOTIFY, [msg, 'cbob-revenue']) } catch {} }
  process.exit(3)
})
