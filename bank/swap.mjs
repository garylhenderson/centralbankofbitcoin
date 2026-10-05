/**
 * THE ROYALTY SWAP, BUILT HERE AND NOWHERE ELSE (Gary, 2026-10-05: "Orca direct +
 * Meteora fallback").
 *
 * Until round 24 the SOL -> cbBTC hop signed a transaction Jupiter's HTTP API
 * built. Round 24 (M1) measured that API's host GONE (quote-api.jup.ag no longer
 * resolves), and accepted limit 10 had always carried the deeper cost: we signed
 * bytes a third party chose, checked only by a narrow blacklist. So the swap is
 * now built from first principles against two PINNED pools, every account derived
 * or pinned here, every byte ours:
 *
 *   1. ORCA WHIRLPOOL `CeaZcx…` (SOL/cbBTC, ~$10M liquidity, 0.16% fee): first.
 *   2. METEORA DLMM `H2USRS…` (cbBTC/SOL, ~$0.9M): only if the Orca swap refuses.
 *
 * Both were read off mainnet 2026-10-05 and their layouts proven against the live
 * accounts (pool owner, mints, vaults, tick- and bin-array derivations). Each
 * program's interface is from its published IDL (Orca `whirlpool.json`, Meteora
 * `lb_clmm`), never from memory. No SDK: gary-club's node_modules is shared, and a
 * key-holding bot is better with less code to trust.
 *
 * THE PRICE IS NOT THE POOL'S. A swap that honours a pool's own price is exactly
 * as good as that price, and a pool can be pushed. So the floor every swap
 * enforces ON CHAIN (`other_amount_threshold` / `min_amount_out`) is derived from
 * Pyth's SOL/USD and BTC/USD feeds (the sponsored, fully Wormhole-verified
 * accounts), and a pool whose spot price strays from the oracle is not used at all.
 *
 * Pure: builders and judgements only. The caller reads accounts and sends.
 */
import { PublicKey, SystemProgram, TransactionInstruction, ComputeBudgetProgram } from '@solana/web3.js'
import { createHash } from 'crypto'

export const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
export const WSOL = new PublicKey('So11111111111111111111111111111111111111112')
export const CBBTC = new PublicKey('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij')

// ── THE PINS (read off mainnet 2026-10-05; the fork test re-proves them) ──
export const ORCA = {
  program: new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'),
  pool: new PublicKey('CeaZcxBNLpJWtxzt58qQmfMBtJY8pQLvursXTJYGQpbN'),
  // token A is wSOL, token B is cbBTC: selling SOL is a_to_b.
}
export const METEORA = {
  program: new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'),
  pool: new PublicKey('H2USRSaWuUchkbdmSJgKNfAm7ocyD4ZnCm69oRGyecKw'),
  // token X is cbBTC, token Y is wSOL (the REVERSE of Orca): selling SOL is Y -> X.
}
export const PYTH = {
  receiver: new PublicKey('rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ'),
  push: new PublicKey('pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT'),
  // Feed ids from Pyth's own catalogue (hermes /v2/price_feeds), 2026-10-05.
  BTC_USD: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  SOL_USD: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
}
/** The sponsored price account for a feed (shard 0), derived, never typed. */
export const pythAccount = feedHex => PublicKey.findProgramAddressSync(
  [Buffer.alloc(2), Buffer.from(feedHex, 'hex')], PYTH.push)[0]

// ── THE RULES ──
/** A price older than this is not a price. Sponsored feeds post about once a
 *  minute and on every 0.5% move (measured ages 54 s, 2026-10-05). */
export const MAX_ORACLE_AGE_SECS = 180
/** Pyth's confidence interval, as a share of the price, above which we do not trade. */
export const MAX_ORACLE_CONF_BPS = 100
/** A pool whose spot price is further than this from the oracle is not used. */
export const MAX_POOL_DEVIATION_BPS = 100
/** The ON-CHAIN floor: the oracle's expected output less this. It covers the
 *  pool fee (Orca 0.16%), the price impact of a royalty-sized swap, and the
 *  oracle's own confidence; anything worse refuses and nothing moves. */
export const SWAP_TOLERANCE_BPS = 150

const disc = n => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8)
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
const u128 = n => { const b = Buffer.alloc(16); const x = BigInt(n); b.writeBigUInt64LE(x & ((1n << 64n) - 1n)); b.writeBigUInt64LE(x >> 64n, 8); return b }
const readU128 = (d, o) => d.readBigUInt64LE(o) + (d.readBigUInt64LE(o + 8) << 64n)
const pk = (d, o) => new PublicKey(d.subarray(o, o + 32))

// ───────────────────────────── the oracle ─────────────────────────────
/** A Pyth `PriceUpdateV2`: disc, write_authority, verification_level (Partial =
 *  tag + u8, Full = tag), then the PriceFeedMessage. Only FULL verification and
 *  only the expected feed id are accepted; anything else throws. */
export function readPyth(acc, feedHex) {
  if (!acc) throw new Error('the Pyth price account is absent')
  if (!acc.owner.equals(PYTH.receiver)) throw new Error(`the Pyth price account is owned by ${acc.owner.toBase58()}, not the Pyth receiver`)
  const d = acc.data
  if (d.length < 8 + 32 + 1 + 32 + 8 + 8 + 4 + 8) throw new Error('the Pyth price account is truncated')
  let o = 8 + 32
  const level = d[o]
  if (level !== 1) throw new Error('the Pyth price is only PARTIALLY verified; refusing it')
  o += 1
  const feed = d.subarray(o, o + 32).toString('hex'); o += 32
  if (feed !== feedHex) throw new Error(`the Pyth account carries feed ${feed.slice(0, 12)}…, not ${feedHex.slice(0, 12)}…`)
  const price = d.readBigInt64LE(o), conf = d.readBigUInt64LE(o + 8), expo = d.readInt32LE(o + 16)
  const publishTime = Number(d.readBigInt64LE(o + 20))
  return { price, conf, expo, publishTime }
}

/** What `lamportsIn` of SOL should buy in cbBTC sats at the oracle, and the floor
 *  every swap must enforce. Throws on a stale, wide or non-positive price. */
export function oracleFloor({ lamportsIn, sol, btc, nowSec }) {
  for (const [n, p] of [['SOL/USD', sol], ['BTC/USD', btc]]) {
    if (p.price <= 0n) throw new Error(`${n} is not a positive price`)
    if (nowSec - p.publishTime > MAX_ORACLE_AGE_SECS) throw new Error(`${n} is ${nowSec - p.publishTime}s old, past ${MAX_ORACLE_AGE_SECS}s`)
    if (p.conf * 10_000n > p.price * BigInt(MAX_ORACLE_CONF_BPS)) throw new Error(`${n} confidence ${p.conf} is wider than ${MAX_ORACLE_CONF_BPS / 100}% of ${p.price}`)
  }
  // sats = lamports / 1e9 * SOL_USD / BTC_USD * 1e8 = lamports * sol * 10^(es - eb) / (btc * 10)
  const e = sol.expo - btc.expo
  let num = BigInt(lamportsIn) * sol.price, den = btc.price * 10n
  if (e >= 0) num *= 10n ** BigInt(e); else den *= 10n ** BigInt(-e)
  const expectedSats = num / den
  const minSats = expectedSats * BigInt(10_000 - SWAP_TOLERANCE_BPS) / 10_000n
  if (minSats <= 0n) throw new Error(`${lamportsIn} lamports buys no whole sat at the oracle`)
  return { expectedSats, minSats, satsPerLamport: Number(sol.price) * 10 ** sol.expo / (Number(btc.price) * 10 ** btc.expo) / 10 }
}

/** |pool - oracle| / oracle, in bps. */
export const deviationBps = (pool, oracle) => Math.abs(pool - oracle) / oracle * 10_000

// ───────────────────────────── Orca Whirlpool ─────────────────────────────
/** Whirlpool layout (IDL): disc8 config32 bump1 tick_spacing u16 seed[2] fee_rate
 *  u16 protocol_fee_rate u16 liquidity u128 sqrt_price u128 tick_current i32
 *  owed_a u64 owed_b u64 mint_a vault_a fee_growth_a u128 mint_b vault_b ... */
export function readWhirlpool(acc) {
  if (!acc || !acc.owner.equals(ORCA.program)) throw new Error('the Orca pool is absent or not owned by the Whirlpool program')
  const d = acc.data
  if (d.length < 245) throw new Error('the Orca pool account is truncated')
  const w = { tickSpacing: d.readUInt16LE(41), feeRate: d.readUInt16LE(45), liquidity: readU128(d, 49),
    sqrtPrice: readU128(d, 65), tickCurrent: d.readInt32LE(81),
    mintA: pk(d, 101), vaultA: pk(d, 133), mintB: pk(d, 181), vaultB: pk(d, 213) }
  if (!w.mintA.equals(WSOL) || !w.mintB.equals(CBBTC)) throw new Error('the Orca pool is not wSOL/cbBTC in that order')
  return w
}
/** Spot price in cbBTC sats per lamport: (sqrt_price / 2^64)^2 in raw units. */
export const orcaSpot = w => { const s = Number(w.sqrtPrice) / 2 ** 64; return s * s }
const TICK_ARRAY_SIZE = 88
/** The three tick arrays an a_to_b swap may cross: the one holding the current
 *  tick, then the two BELOW it (selling A pushes the price, and the tick, down). */
export function orcaTickArrayStarts(tickCurrent, tickSpacing) {
  const span = TICK_ARRAY_SIZE * tickSpacing
  const s0 = Math.floor(tickCurrent / span) * span
  return [s0, s0 - span, s0 - 2 * span]
}
export const orcaTickArray = start => PublicKey.findProgramAddressSync(
  [Buffer.from('tick_array'), ORCA.pool.toBuffer(), Buffer.from(String(start))], ORCA.program)[0]
const ORCA_MIN_SQRT_PRICE = 4295048016n
/** Orca `swap` (v1, classic SPL tokens): exact input, a_to_b, floor on output. */
export function orcaSwapIx({ w, owner, ownerWsol, ownerCbbtc, lamportsIn, minSats }) {
  const [t0, t1, t2] = orcaTickArrayStarts(w.tickCurrent, w.tickSpacing).map(orcaTickArray)
  const oracle = PublicKey.findProgramAddressSync([Buffer.from('oracle'), ORCA.pool.toBuffer()], ORCA.program)[0]
  return new TransactionInstruction({ programId: ORCA.program,
    data: Buffer.concat([disc('swap'), u64(lamportsIn), u64(minSats), u128(ORCA_MIN_SQRT_PRICE), Buffer.from([1, 1])]),
    keys: [
      { pubkey: TOKEN, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: ORCA.pool, isSigner: false, isWritable: true },
      { pubkey: ownerWsol, isSigner: false, isWritable: true },
      { pubkey: w.vaultA, isSigner: false, isWritable: true },
      { pubkey: ownerCbbtc, isSigner: false, isWritable: true },
      { pubkey: w.vaultB, isSigner: false, isWritable: true },
      { pubkey: t0, isSigner: false, isWritable: true },
      { pubkey: t1, isSigner: false, isWritable: true },
      { pubkey: t2, isSigner: false, isWritable: true },
      { pubkey: oracle, isSigner: false, isWritable: false },
    ] })
}

// ───────────────────────────── Meteora DLMM ─────────────────────────────
/** LbPair layout (IDL, proven against the live account 2026-10-05): disc8
 *  StaticParameters32 VariableParameters32 bump1 bin_step_seed2 pair_type1
 *  active_id i32 @76, bin_step u16 @80, status u8 @82, ..., token_x_mint @88,
 *  token_y_mint @120, reserve_x @152, reserve_y @184. */
export function readLbPair(acc) {
  if (!acc || !acc.owner.equals(METEORA.program)) throw new Error('the Meteora pool is absent or not owned by the DLMM program')
  const d = acc.data
  if (d.length < 216) throw new Error('the Meteora pool account is truncated')
  const p = { activeId: d.readInt32LE(76), binStep: d.readUInt16LE(80), status: d[82],
    mintX: pk(d, 88), mintY: pk(d, 120), reserveX: pk(d, 152), reserveY: pk(d, 184) }
  if (!p.mintX.equals(CBBTC) || !p.mintY.equals(WSOL)) throw new Error('the Meteora pool is not cbBTC/wSOL in that order')
  return p
}
/** Spot price in cbBTC sats per lamport. The pair prices X in Y:
 *  (1 + bin_step/10_000)^active_id lamports per sat, so a sat per lamport is its inverse. */
export const meteoraSpot = p => 1 / (1 + p.binStep / 10_000) ** p.activeId
const MAX_BIN_PER_ARRAY = 70
const binArrayIndex = id => Math.floor(id / MAX_BIN_PER_ARRAY)
/** Buying X with Y moves the active bin UP: the array holding it, then the two above. */
export const meteoraBinArrayIndexes = activeId => { const i = binArrayIndex(activeId); return [i, i + 1, i + 2] }
export const meteoraBinArray = i => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(i))
  return PublicKey.findProgramAddressSync([Buffer.from('bin_array'), METEORA.pool.toBuffer(), b], METEORA.program)[0] }
const mPda = (...s) => PublicKey.findProgramAddressSync(s.map(x => typeof x === 'string' ? Buffer.from(x) : x.toBuffer()), METEORA.program)[0]
/** Meteora `swap`: amount_in, min_amount_out; remaining accounts are the bin
 *  arrays. Optional accounts (`host_fee_in`, and the bitmap extension when the
 *  pool has none) are passed as the program id, Anchor's "None". */
export function meteoraSwapIx({ p, owner, ownerWsol, ownerCbbtc, lamportsIn, minSats, bitmapExists }) {
  const opt = (key, present) => ({ pubkey: present ? key : METEORA.program, isSigner: false, isWritable: present })
  return new TransactionInstruction({ programId: METEORA.program,
    data: Buffer.concat([disc('swap'), u64(lamportsIn), u64(minSats)]),
    keys: [
      { pubkey: METEORA.pool, isSigner: false, isWritable: true },
      opt(mPda('bitmap', METEORA.pool), bitmapExists),
      { pubkey: p.reserveX, isSigner: false, isWritable: true },
      { pubkey: p.reserveY, isSigner: false, isWritable: true },
      { pubkey: ownerWsol, isSigner: false, isWritable: true },        // user_token_in: wSOL (Y)
      { pubkey: ownerCbbtc, isSigner: false, isWritable: true },       // user_token_out: cbBTC (X)
      { pubkey: p.mintX, isSigner: false, isWritable: false },
      { pubkey: p.mintY, isSigner: false, isWritable: false },
      { pubkey: mPda('oracle', METEORA.pool), isSigner: false, isWritable: true },
      opt(null, false),                                                // host_fee_in: None
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: TOKEN, isSigner: false, isWritable: false },
      { pubkey: TOKEN, isSigner: false, isWritable: false },
      { pubkey: mPda('__event_authority'), isSigner: false, isWritable: false },
      { pubkey: METEORA.program, isSigner: false, isWritable: false },
      ...meteoraBinArrayIndexes(p.activeId).map(i => ({ pubkey: meteoraBinArray(i), isSigner: false, isWritable: true })),
    ] })
}
export const meteoraBitmap = () => mPda('bitmap', METEORA.pool)

// ───────────────────────────── the transaction ─────────────────────────────
const ata = (mint, owner) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0]
const createAtaIdempotent = (payer, owner, mint) => new TransactionInstruction({ programId: ATA_PROGRAM, data: Buffer.from([1]),
  keys: [{ pubkey: payer, isSigner: true, isWritable: true }, { pubkey: ata(mint, owner), isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN, isSigner: false, isWritable: false }] })
const syncNative = acct => new TransactionInstruction({ programId: TOKEN, data: Buffer.from([17]),
  keys: [{ pubkey: acct, isSigner: false, isWritable: true }] })
const closeAccount = (acct, dest, owner) => new TransactionInstruction({ programId: TOKEN, data: Buffer.from([9]),
  keys: [{ pubkey: acct, isSigner: false, isWritable: true }, { pubkey: dest, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: true, isWritable: false }] })

/** The whole swap as ONE transaction's instructions: wrap exactly `lamportsIn`
 *  into the operator's wSOL account, swap it on the chosen venue with the oracle
 *  floor enforced on chain, and close the wSOL account so nothing is left
 *  wrapped. It lands whole or not at all. */
export function swapInstructions({ venue, owner, lamportsIn, minSats, w, p, bitmapExists }) {
  const ownerWsol = ata(WSOL, owner), ownerCbbtc = ata(CBBTC, owner)
  const swap = venue === 'orca' ? orcaSwapIx({ w, owner, ownerWsol, ownerCbbtc, lamportsIn, minSats })
    : venue === 'meteora' ? meteoraSwapIx({ p, owner, ownerWsol, ownerCbbtc, lamportsIn, minSats, bitmapExists })
    : (() => { throw new Error(`unknown venue ${venue}`) })()
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    createAtaIdempotent(owner, owner, WSOL),
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: ownerWsol, lamports: BigInt(lamportsIn) }),
    syncNative(ownerWsol),
    createAtaIdempotent(owner, owner, CBBTC),
    swap,
    closeAccount(ownerWsol, owner, owner),
  ]
}

/** LOOK AT IT BEFORE SIGNING IT, even though we built it: every program is one
 *  this cycle needs, exactly one signer (the operator), and the swap goes to the
 *  pinned pool on the pinned program. A defect here, or a tampered module, must
 *  fail loudly rather than sign. */
export function judgeSwapInstructions(ixs, owner, venue) {
  const allowed = new Set([ComputeBudgetProgram.programId, SystemProgram.programId, TOKEN, ATA_PROGRAM,
    venue === 'orca' ? ORCA.program : METEORA.program].map(k => k.toBase58()))
  const problems = []
  for (const ix of ixs) {
    if (!allowed.has(ix.programId.toBase58())) problems.push(`instruction for ${ix.programId.toBase58()}, which no ${venue} swap needs`)
    for (const k of ix.keys) if (k.isSigner && !k.pubkey.equals(owner)) problems.push(`a second signer ${k.pubkey.toBase58()}`)
  }
  const swaps = ixs.filter(ix => ix.programId.equals(venue === 'orca' ? ORCA.program : METEORA.program))
  if (swaps.length !== 1) problems.push(`${swaps.length} swap instructions, not one`)
  const pool = venue === 'orca' ? ORCA.pool : METEORA.pool
  if (swaps[0] && !swaps[0].keys.some(k => k.pubkey.equals(pool))) problems.push('the swap does not name the pinned pool')
  const transfers = ixs.filter(ix => ix.programId.equals(SystemProgram.programId))
  if (transfers.length !== 1) problems.push(`${transfers.length} SOL transfers, not exactly the one wrap`)
  // The one SOL transfer goes into OUR wSOL account and nowhere else, and the
  // close sends the wrapped remainder back to the operator.
  const ownWsol = ata(WSOL, owner)
  if (transfers[0] && !transfers[0].keys[1]?.pubkey.equals(ownWsol)) problems.push(`the SOL transfer goes to ${transfers[0].keys[1]?.pubkey.toBase58()}, not the operator's own wSOL account`)
  const closes = ixs.filter(ix => ix.programId.equals(TOKEN) && ix.data[0] === 9)
  if (closes.length !== 1 || !closes[0].keys[0].pubkey.equals(ownWsol) || !closes[0].keys[1].pubkey.equals(owner))
    problems.push('the wSOL account is not closed back to the operator exactly once')
  return problems
}
