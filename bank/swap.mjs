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
 * Builders and judgements, all pure, plus `market()`, which only READS (through
 * the connection it is handed, so the selftest drives it with a stub). The
 * caller sends.
 */
import { PublicKey, SystemProgram, TransactionInstruction, ComputeBudgetProgram, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js'
import { createHash } from 'crypto'
// ROUND 25 (L2): the ONE chain-clock decoder, the crank's (round 24 I2), reused.
import { clockUnixTimestamp } from './crank.mjs'

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
/** Pyth's confidence interval, as a share of the price, above which we do not trade.
 *  ROUND 25 (I3): was 100, which is 70-100x the live confidence (SOL 1.5 bps, BTC
 *  1.0 bps, measured 2026-10-05). The 30 bps threshold applies to EACH USD feed.
 *  Reported confidence is not a hard bound on the true SOL/cbBTC market price;
 *  the 150 bps output floor is relative to the oracle-derived price only. */
export const MAX_ORACLE_CONF_BPS = 30
/** ROUND 25 (L2): a price stamped further than this AHEAD of the chain's clock
 *  is not a price either. A future `publishTime` used to pass the age test. */
export const MAX_ORACLE_FUTURE_SECS = 30
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
/** Round 42 (C06): the exponent range a USD price feed can sensibly carry (SOL/USD
 *  and BTC/USD are -8). Outside it the account is refused, so no exponent can make
 *  the floor arithmetic huge. */
export const PYTH_EXPO_MIN = -18, PYTH_EXPO_MAX = 0
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
  if (expo < PYTH_EXPO_MIN || expo > PYTH_EXPO_MAX) throw new Error(`the Pyth exponent ${expo} is outside ${PYTH_EXPO_MIN}..${PYTH_EXPO_MAX}; refusing it`)
  return { price, conf, expo, publishTime }
}

/** What `lamportsIn` of SOL should buy in cbBTC sats at the oracle, and the floor
 *  every swap must enforce. Throws on a stale, future-dated, wide or non-positive
 *  price. `nowSec` is the CHAIN's clock (round 25, L2: `market()` reads the Clock
 *  sysvar); an unreadable one is refused, never replaced by the box's. */
export function oracleFloor({ lamportsIn, sol, btc, nowSec }) {
  if (typeof nowSec !== 'number' || !Number.isFinite(nowSec) || nowSec <= 0) throw new Error('no chain clock to judge the oracle\'s age against')
  for (const [n, p] of [['SOL/USD', sol], ['BTC/USD', btc]]) {
    if (p.price <= 0n) throw new Error(`${n} is not a positive price`)
    if (!Number.isInteger(p.expo) || p.expo < PYTH_EXPO_MIN || p.expo > PYTH_EXPO_MAX) throw new Error(`${n} exponent ${p.expo} is outside ${PYTH_EXPO_MIN}..${PYTH_EXPO_MAX}; refusing it`)
    if (nowSec - p.publishTime > MAX_ORACLE_AGE_SECS) throw new Error(`${n} is ${nowSec - p.publishTime}s old, past ${MAX_ORACLE_AGE_SECS}s`)
    if (p.publishTime - nowSec > MAX_ORACLE_FUTURE_SECS) throw new Error(`${n} is stamped ${p.publishTime - nowSec}s in the FUTURE of the chain clock, past ${MAX_ORACLE_FUTURE_SECS}s`)
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

/** ROUND 30 (L3): the least the revenue job will sweep. Anyone can send dust to
 *  the revenue PDA, and an amount too small to buy one whole sat made the job
 *  fail at its market step every hour and page a false failure. Below this
 *  (0.01 SOL: about 1,400 sats at the 2026-10-05 SOL/BTC ratio, still over a
 *  hundred at a far lower one) it is not worth sweeping; it accumulates until
 *  real royalties arrive. The program's sweep floor is at least 0.1 SOL, so
 *  the per-sweep ceiling never falls below this minimum. */
export const MIN_SWEEP_LAMPORTS = 10_000_000n

/** What the revenue job sweeps this cycle: the balance above the reserve,
 *  capped by its own per-cycle cap and the program's ceiling, or 0n when that is
 *  under MIN_SWEEP_LAMPORTS. Pure, so the selftest drives it. */
export function sweepAmount({ balance, reserve, maxPerCycle, chainCap }) {
  let amount = BigInt(balance) > BigInt(reserve) ? BigInt(balance) - BigInt(reserve) : 0n
  if (amount > BigInt(maxPerCycle)) amount = BigInt(maxPerCycle)
  if (amount > BigInt(chainCap)) amount = BigInt(chainCap)
  return amount < MIN_SWEEP_LAMPORTS ? 0n : amount
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

/** The compute-unit limit every swap asks for, and the only budget instruction. */
export const SWAP_CU_LIMIT = 400_000
const TOKEN_IX_NAMES = { 3: 'Transfer', 4: 'Approve', 5: 'Revoke', 6: 'SetAuthority', 7: 'MintTo', 8: 'Burn', 9: 'CloseAccount',
  12: 'TransferChecked', 13: 'ApproveChecked', 17: 'SyncNative' }

/**
 * LOOK AT IT BEFORE SIGNING IT, even though we built it.
 *
 * ROUND 25 (L1): this used to check only the programs, the one signer, that the
 * venue instruction NAMED the pool, that the one System instruction's second key
 * was our wSOL account and that one Token close went back to us. Measured: an
 * output account handed to a stranger, a min-out of 0, a changed amount, Orca's
 * direction flipped, a priority fee appended, a Token Approve of our cbBTC to a
 * stranger, the cbBTC ATA created for someone else, and a 50 SOL wrap ALL
 * returned `[]`, on both venues. So it now requires the EXACT seven-instruction
 * sequence `swapInstructions` emits, independently checking value-moving roles,
 * amounts and the floor. Both share pure ATA/discriminator/byte primitives;
 * the venue program validates its pool-owned liquidity accounts:
 *
 *   0  ComputeBudget SetComputeUnitLimit(400,000), and no other budget
 *      instruction anywhere (no priority fee);
 *   1  ATA CreateIdempotent(payer owner, ata(wSOL, owner), owner, wSOL);
 *   2  System Transfer (discriminator 2) owner -> ata(wSOL, owner) of exactly
 *      `lamportsIn`;
 *   3  Token SyncNative of that account;
 *   4  ATA CreateIdempotent(payer owner, ata(cbBTC, owner), owner, cbBTC);
 *   5  the venue's `swap`: our wSOL in (Orca key 3, Meteora key 4), our cbBTC
 *      out (key 5 on both), amount = `lamportsIn`, threshold = `minSats`, and for
 *      Orca exact-input, a_to_b, at the minimum sqrt-price limit;
 *   6  Token CloseAccount(our wSOL -> owner, signed by owner).
 *
 * Token instructions are limited to SyncNative and CloseAccount.
 *
 * WHAT THIS CAN AND CANNOT CATCH (round 25, D1). It catches OUR defects: a
 * builder that misroutes, drops the floor or pads the transaction. It cannot stop
 * a tamper with write access to this tree, which can edit this function as
 * easily as the builder; that residue is accepted limit 10's box-owner trust.
 * A value-moving miss here is still caught after signing by revenue.mjs's
 * post-swap delta check (`delta < guaranteed` throws, the cycle stays open).
 */
export function judgeSwapInstructions(ixs, owner, venue, { lamportsIn, minSats } = {}) {
  const venueProg = venue === 'orca' ? ORCA.program : venue === 'meteora' ? METEORA.program : null
  if (!venueProg) return [`unknown venue ${venue}`]
  let amt, floor
  try { amt = BigInt(lamportsIn); floor = BigInt(minSats) } catch { amt = null; floor = null }
  if (amt === null || floor === null || amt <= 0n || floor <= 0n)
    return ['the judge was not told a positive amount in and on-chain floor (lamportsIn, minSats); it judges nothing without them']
  const allowed = new Set([ComputeBudgetProgram.programId, SystemProgram.programId, TOKEN, ATA_PROGRAM, venueProg].map(k => k.toBase58()))
  const problems = []
  for (const ix of ixs) {
    if (!allowed.has(ix.programId.toBase58())) problems.push(`instruction for ${ix.programId.toBase58()}, which no ${venue} swap needs`)
    for (const k of ix.keys) if (k.isSigner && !k.pubkey.equals(owner)) problems.push(`a second signer ${k.pubkey.toBase58()}`)
    const d = Buffer.from(ix.data || [])
    if (ix.programId.equals(ComputeBudgetProgram.programId) && d[0] === 3) problems.push('a priority fee (setComputeUnitPrice): the swap pays the base fee only')
    if (ix.programId.equals(TOKEN) && d[0] !== 17 && d[0] !== 9)
      problems.push(`a Token ${TOKEN_IX_NAMES[d[0]] ?? `instruction ${d[0]}`}: a swap uses only SyncNative and CloseAccount`)
  }
  if (ixs.length !== 7) problems.push(`${ixs.length} instructions, not the seven a swap is`)
  const swaps = ixs.filter(ix => ix.programId.equals(venueProg))
  if (swaps.length !== 1) problems.push(`${swaps.length} swap instructions, not one`)
  const transfers = ixs.filter(ix => ix.programId.equals(SystemProgram.programId))
  if (transfers.length !== 1) problems.push(`${transfers.length} SOL transfers, not exactly the one wrap`)
  const ownWsol = ata(WSOL, owner), ownCbbtc = ata(CBBTC, owner)
  const keyAt = (ix, i) => ix?.keys?.[i]?.pubkey
  const keysAre = (ix, want) => !!ix && ix.keys.length === want.length && want.every((w, i) => ix.keys[i].pubkey.equals(w))
  const data = ix => Buffer.from(ix?.data || [])
  const [cu, cw, wrap, sync, cc, sw, close] = ixs
  // 0. the budget
  if (!cu?.programId.equals(ComputeBudgetProgram.programId) || data(cu).length !== 5 || data(cu)[0] !== 2
      || data(cu).readUInt32LE(1) !== SWAP_CU_LIMIT || cu.keys.length)
    problems.push(`instruction 0 is not SetComputeUnitLimit(${SWAP_CU_LIMIT})`)
  // 1 and 4. the two ATA creations: OUR accounts, owned by us, paid by us
  const ataOk = (ix, mint) => !!ix && ix.programId.equals(ATA_PROGRAM) && data(ix).equals(Buffer.from([1]))
    && keysAre(ix, [owner, ata(mint, owner), owner, mint, SystemProgram.programId, TOKEN])
  if (!ataOk(cw, WSOL)) problems.push('instruction 1 does not create the operator\'s own wSOL account (payer, account, owner, mint)')
  if (!ataOk(cc, CBBTC)) problems.push('instruction 4 does not create the operator\'s own cbBTC account (payer, account, owner, mint)')
  // 2. the wrap: exactly the amount, into our wSOL account
  if (transfers[0] && !transfers[0].keys[1]?.pubkey.equals(ownWsol))
    problems.push(`the SOL transfer goes to ${transfers[0].keys[1]?.pubkey.toBase58()}, not the operator's own wSOL account`)
  if (!wrap?.programId.equals(SystemProgram.programId) || data(wrap).length !== 12 || data(wrap).readUInt32LE(0) !== 2
      || !keysAre(wrap, [owner, ownWsol]))
    problems.push('instruction 2 is not a System transfer from the operator to its own wSOL account')
  else if (data(wrap).readBigUInt64LE(4) !== amt)
    problems.push(`the wrap moves ${data(wrap).readBigUInt64LE(4)} lamports, not the ${amt} this swap sells`)
  // 3. SyncNative of our wSOL account
  if (!sync?.programId.equals(TOKEN) || !data(sync).equals(Buffer.from([17])) || !keysAre(sync, [ownWsol]))
    problems.push('instruction 3 is not SyncNative of the operator\'s own wSOL account')
  // 5. the swap itself
  if (!sw?.programId.equals(venueProg)) problems.push(`instruction 5 is not the ${venue} swap`)
  else {
    const d = data(sw)
    const orca = venue === 'orca'
    if (d.length !== (orca ? 42 : 24) || !d.subarray(0, 8).equals(disc('swap'))) problems.push(`the ${venue} swap's data is not a \`swap\` call of the expected length`)
    else {
      if (d.readBigUInt64LE(8) !== amt) problems.push(`the swap sells ${d.readBigUInt64LE(8)} lamports, not ${amt}`)
      if (d.readBigUInt64LE(16) !== floor) problems.push(`the swap's on-chain floor is ${d.readBigUInt64LE(16)} sats, not the oracle floor ${floor}`)
      if (orca && (readU128(d, 24) !== ORCA_MIN_SQRT_PRICE || d[40] !== 1 || d[41] !== 1))
        problems.push('the Orca swap is not exact-input, a_to_b (selling wSOL), at the minimum price limit')
    }
    if (!keyAt(sw, orca ? 2 : 0)?.equals(orca ? ORCA.pool : METEORA.pool)) problems.push('the swap does not name the pinned pool')
    if (!keyAt(sw, orca ? 3 : 4)?.equals(ownWsol)) problems.push('the swap\'s input account is not the operator\'s own wSOL account')
    if (!keyAt(sw, 5)?.equals(ownCbbtc)) problems.push('the swap\'s output account is not the operator\'s own cbBTC account')
    const signer = sw.keys[orca ? 1 : 10]
    if (!signer?.pubkey.equals(owner) || !signer.isSigner) problems.push('the swap is not signed by the operator in its authority slot')
  }
  // 6. the close: our wSOL account, back to us, once
  const closes = ixs.filter(ix => ix.programId.equals(TOKEN) && data(ix)[0] === 9)
  if (closes.length !== 1 || !close?.programId.equals(TOKEN) || !data(close).equals(Buffer.from([9])) || !keysAre(close, [ownWsol, owner, owner]))
    problems.push('the wSOL account is not closed back to the operator exactly once, last')
  return [...new Set(problems)]
}

// ───────────────────────────── the market read ─────────────────────────────
/**
 * The oracle's expected output for `lamports`, and which pinned pools price close
 * enough to it to be used at all. READS ONLY, through `conn`.
 *
 * ROUND 25 (L2): moved here from revenue.mjs so the selftest can drive it, and
 * the oracle's age is now judged against the CHAIN's clock (the Clock sysvar, in
 * the same read as the prices), with the crank's decoder. revenue.mjs passed
 * `Date.now()`: a price 400 s old was accepted with the box 300 s behind.
 */
export async function market(conn, lamports, log = console.log) {
  const [wo, lb, solA, btcA, bm, clk] = await conn.getMultipleAccountsInfo([ORCA.pool, METEORA.pool,
    pythAccount(PYTH.SOL_USD), pythAccount(PYTH.BTC_USD), meteoraBitmap(), SYSVAR_CLOCK_PUBKEY], 'confirmed')
  const nowSec = clk && clk.owner?.toBase58?.() === SYSVAR_OWNER ? clockUnixTimestamp(clk.data) : null
  if (nowSec === null) throw new Error('the chain clock (the Clock sysvar) is unreadable; the oracle\'s age is judged on the chain\'s time, never the box\'s')
  const sol = readPyth(solA, PYTH.SOL_USD), btc = readPyth(btcA, PYTH.BTC_USD)
  const f = oracleFloor({ lamportsIn: lamports, sol, btc, nowSec })
  const venues = []
  let w = null, p = null
  try { w = readWhirlpool(wo); const dv = deviationBps(orcaSpot(w), f.satsPerLamport)
    log(`  orca pool ${dv.toFixed(1)} bps from the oracle`); if (dv <= MAX_POOL_DEVIATION_BPS) venues.push('orca') }
  catch (e) { log(`  orca pool unusable: ${e.message}`) }
  try { p = readLbPair(lb); const dv = deviationBps(meteoraSpot(p), f.satsPerLamport)
    log(`  meteora pool ${dv.toFixed(1)} bps from the oracle`); if (dv <= MAX_POOL_DEVIATION_BPS) venues.push('meteora') }
  catch (e) { log(`  meteora pool unusable: ${e.message}`) }
  return { f, w, p, venues, bitmapExists: !!bm, nowSec }
}
const SYSVAR_OWNER = 'Sysvar1111111111111111111111111111111111111'

/** ROUND 25 (L4): is the on-chain sweep cooldown over, by the CHAIN's clock? The
 *  box clock read ~1 s after the run started, before `last + cooldown` on every
 *  6-hourly run, so the cadence silently became 12 h. An unreadable clock is
 *  never "over". */
export function sweepCooldownOver({ lastSweepAt, cooldownSecs, chainNowSec }) {
  if (chainNowSec === null || chainNowSec === undefined || !Number.isFinite(Number(chainNowSec))) return false
  return BigInt(chainNowSec) >= BigInt(lastSweepAt) + BigInt(cooldownSecs)
}

// ───────────────────────────── a failed send ─────────────────────────────
/** A preflight refusal: the cluster simulated it, the program said no, nothing
 *  was ever submitted. */
export const PREFLIGHT_REFUSAL = /custom program error|Error Code:|Transaction simulation failed/

/**
 * ROUND 25 (L3): WHAT A FAILED SEND MEANS, by asking the chain.
 *
 * web3.js 1.98 throws `SendTransactionError` "Transaction <sig> resulted in an
 * error. Status: ({"err":...})" for a transaction that passed preflight and
 * FAILED ON CHAIN, with no logs, and `TransactionExpiredBlockheightExceededError`
 * when its blockhash ran out. Neither matched the refusal regex, so both were
 * filed "unconfirmed": a sweep's intent row then paged `unreconciled_swap`
 * CRITICAL for SOL that never moved, and a swap whose floor broke between
 * simulation and landing skipped the Meteora fallback.
 *
 * `statusOf(sig)` is `getSignatureStatuses([sig], {searchTransactionHistory:true})
 * .value[0]`. Returns `{ outcome, sig, why }`:
 *   refused  nothing moved (a preflight refusal; landed with `err`; or expired and
 *            never landed);
 *   landed   it landed and SUCCEEDED (confirmed or finalized), so the caller
 *            records the signature and carries on;
 *   unknown  anything else, including a status lookup that failed: the cycle
 *            stays open, which is the loud direction.
 */
export function sendFailureSignature(e) {
  return (typeof e?.signature === 'string' && e.signature)
    || (String(e?.message ?? e).match(/(?:Transaction|Signature) ([1-9A-HJ-NP-Za-km-z]{64,90}) (?:resulted in an error|has expired)/) || [])[1] || null
}
export async function classifySendFailure(e, statusOf) {
  const msg = String(e?.message ?? e)
  let logs = []
  try { logs = e?.transactionLogs || e?.logs || [] } catch { logs = [] }
  if (PREFLIGHT_REFUSAL.test(msg + ' ' + (Array.isArray(logs) ? logs.join(' ') : '')))
    return { outcome: 'refused', sig: e?.signature ?? null, why: 'refused at preflight; never submitted' }
  const sig = sendFailureSignature(e)
  if (!sig) return { outcome: 'unknown', sig: null, why: 'no signature to ask the chain about' }
  const expired = e?.name === 'TransactionExpiredBlockheightExceededError' || /block height exceeded/.test(msg)
  let st
  try { st = await statusOf(sig) } catch (x) { return { outcome: 'unknown', sig, why: `the status lookup failed: ${String(x?.message ?? x).slice(0, 120)}` } }
  const settled = st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')
  if (settled && st.err) return { outcome: 'refused', sig, why: `landed and FAILED on chain (${JSON.stringify(st.err).slice(0, 120)}); nothing moved` }
  if (settled) return { outcome: 'landed', sig, why: 'landed and succeeded' }
  if (!st && expired) return { outcome: 'refused', sig, why: 'its blockhash expired and it never landed' }
  return { outcome: 'unknown', sig, why: st ? `status ${st.confirmationStatus ?? 'unsettled'}` : 'no status yet' }
}
