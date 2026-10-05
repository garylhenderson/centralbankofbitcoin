#!/usr/bin/env node
/**
 * THE ROYALTY SWAP, PROVEN ON A MAINNET FORK (2026-10-05).
 *
 * bank/swap.mjs builds both swaps by hand. Nothing about a hand-built CPI is
 * proven until the REAL program accepts it against REAL pool state, so this runs
 * on a local validator into which sim/swap-fork.sh cloned, from mainnet:
 *   * the Orca Whirlpool and Meteora DLMM PROGRAMS (their upgradeable bytes);
 *   * the two pinned pools, their vaults/reserves, the tick and bin arrays a
 *     SOL -> cbBTC swap can cross, Meteora's oracle and bitmap extension;
 *   * the cbBTC mint and Pyth's two sponsored price accounts.
 * Then it swaps real-sized SOL through each venue, with the oracle floor
 * enforced ON CHAIN, and proves the refusals.
 *
 *   node sim/swap-fork.mjs plan     # print the clone list (mainnet reads only)
 *   node sim/swap-fork.mjs run      # against the fork on 127.0.0.1:8999
 */
import fs from 'fs'
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import * as S from '../bank/swap.mjs'

const MODE = process.argv[2]
const mainnet = () => new Connection((fs.readFileSync('/opt/gary-club/.env.local', 'utf8').match(/^HELIUS_RPC_URL=(.*)$/m) || [])[1].trim(), 'confirmed')
const ata = (mint, owner) => PublicKey.findProgramAddressSync([owner.toBuffer(), S.TOKEN.toBuffer(), mint.toBuffer()], S.ATA_PROGRAM)[0]

async function plan() {
  const c = mainnet()
  const w = S.readWhirlpool(await c.getAccountInfo(S.ORCA.pool))
  const p = S.readLbPair(await c.getAccountInfo(S.METEORA.pool))
  const span = 88 * w.tickSpacing
  const s0 = Math.floor(w.tickCurrent / span) * span
  const ticks = [-3, -2, -1, 0, 1].map(k => S.orcaTickArray(s0 + k * span))
  const i0 = Math.floor(p.activeId / 70)
  const bins = [-1, 0, 1, 2, 3].map(k => S.meteoraBinArray(i0 + k))
  const mOracle = PublicKey.findProgramAddressSync([Buffer.from('oracle'), S.METEORA.pool.toBuffer()], S.METEORA.program)[0]
  const wcfg = new PublicKey((await c.getAccountInfo(S.ORCA.pool)).data.subarray(8, 40))
  const want = [S.ORCA.pool, wcfg, w.vaultA, w.vaultB, ...ticks, S.METEORA.pool, p.reserveX, p.reserveY, mOracle, S.meteoraBitmap(),
    ...bins, S.CBBTC, S.pythAccount(S.PYTH.SOL_USD), S.pythAccount(S.PYTH.BTC_USD)]
  // Only accounts that EXIST can be cloned; the absent ones stay absent on the fork too.
  const infos = await c.getMultipleAccountsInfo(want)
  console.log(want.filter((_, i) => infos[i]).map(k => k.toBase58()).join(' '))
}

const R = []
const rec = (id, t, want, got, note = '') => { const ok = String(want) === String(got); R.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'XX  '}${id}  ${t}  [want ${want}, got ${got}]${note ? `\n         ↳ ${note}` : ''}`) }
const att = async f => { try { return { ok: true, v: await f(), err: '' } } catch (e) {
  return { ok: false, err: ((e?.logs || e?.transactionLogs || []).filter(l => /Error|error|failed|exceed|slippage/i.test(l)).join(' | ') || String(e.message)).slice(0, 300) } } }

async function run() {
  const conn = new Connection('http://127.0.0.1:8999', 'confirmed')
  const op = Keypair.generate()
  await conn.confirmTransaction(await conn.requestAirdrop(op.publicKey, 50 * LAMPORTS_PER_SOL), 'confirmed')
  const cb = ata(S.CBBTC, op.publicKey)
  const cbBal = async () => { const a = await conn.getAccountInfo(cb); return a ? a.data.readBigUInt64LE(64) : 0n }
  const read = async () => {
    const [wo, lb, sol, btc, bm] = await conn.getMultipleAccountsInfo([S.ORCA.pool, S.METEORA.pool,
      S.pythAccount(S.PYTH.SOL_USD), S.pythAccount(S.PYTH.BTC_USD), S.meteoraBitmap()])
    const P = { sol: S.readPyth(sol, S.PYTH.SOL_USD), btc: S.readPyth(btc, S.PYTH.BTC_USD) }
    return { w: S.readWhirlpool(wo), p: S.readLbPair(lb), ...P, bitmapExists: !!bm }
  }
  // The fork's clock is the wall clock; the cloned prices are minutes old, so the
  // staleness rule is judged against their own publish time here (it is proven
  // both ways in bank/selftest.mjs).
  const st = await read()
  const now = Math.max(st.sol.publishTime, st.btc.publishTime)
  const LAM = 2n * BigInt(LAMPORTS_PER_SOL)
  const f = S.oracleFloor({ lamportsIn: LAM, sol: st.sol, btc: st.btc, nowSec: now })
  console.log(`  oracle: 2 SOL -> ${f.expectedSats} sats expected, floor ${f.minSats} (${S.SWAP_TOLERANCE_BPS} bps)`)
  const devO = S.deviationBps(S.orcaSpot(st.w), f.satsPerLamport), devM = S.deviationBps(S.meteoraSpot(st.p), f.satsPerLamport)
  rec('SW.0', 'both pinned pools price within the deviation bound of the oracle', 'true,true',
    `${devO <= S.MAX_POOL_DEVIATION_BPS},${devM <= S.MAX_POOL_DEVIATION_BPS}`, `orca ${devO.toFixed(1)} bps, meteora ${devM.toFixed(1)} bps`)

  const swap = async (venue, minSats, lamports = LAM) => {
    const s = await read()
    const ixs = S.swapInstructions({ venue, owner: op.publicKey, lamportsIn: lamports, minSats, w: s.w, p: s.p, bitmapExists: s.bitmapExists })
    const bad = S.judgeSwapInstructions(ixs, op.publicKey, venue)
    if (bad.length) throw new Error('judge: ' + bad.join('; '))
    return sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [op], { commitment: 'confirmed' })
  }

  for (const venue of ['orca', 'meteora']) {
    const b0 = await cbBal(), l0 = BigInt(await conn.getBalance(op.publicKey))
    const r = await att(() => swap(venue, f.minSats))
    const got = (await cbBal()) - b0, spent = l0 - BigInt(await conn.getBalance(op.publicKey))
    const id = venue === 'orca' ? 'SW.1' : 'SW.4'
    rec(id, `${venue}: 2 SOL swapped, the oracle floor held ON CHAIN`, 'ALLOW,true', `${r.ok ? 'ALLOW' : 'REJECT'},${got >= f.minSats}`,
      `${got} sats (floor ${f.minSats}, expected ${f.expectedSats}); ${r.err}`)
    rec(`${id}a`, `${venue}: the operator spent the 2 SOL plus fees and rent, and nothing stays wrapped`, 'true,false',
      `${spent >= LAM && spent < LAM + 10_000_000n},${!!(await conn.getAccountInfo(ata(S.WSOL, op.publicKey)))}`, `spent ${spent}`)
    const hi = f.expectedSats * 105n / 100n
    const b1 = await cbBal(), l1 = BigInt(await conn.getBalance(op.publicKey))
    const n = await att(() => swap(venue, hi))
    rec(`${id}b`, `${venue}: a floor 5% ABOVE the oracle is refused by the pool program, and nothing moves`, 'REJECT,0,true',
      `${n.ok ? 'ALLOW' : 'REJECT'},${(await cbBal()) - b1},${l1 - BigInt(await conn.getBalance(op.publicKey)) < 100_000n}`, n.err)
  }
  // The judge, against the real built instructions.
  const s = await read()
  const ixs = S.swapInstructions({ venue: 'orca', owner: op.publicKey, lamportsIn: LAM, minSats: f.minSats, w: s.w, p: s.p, bitmapExists: s.bitmapExists })
  rec('SW.6', 'the judge passes the instructions we built', '0', String(S.judgeSwapInstructions(ixs, op.publicKey, 'orca').length))
  const evil = Keypair.generate().publicKey
  const t = ixs.map(ix => ix); t[2] = { ...t[2], keys: t[2].keys.map((k, i) => i === 1 ? { ...k, pubkey: evil } : k), programId: t[2].programId, data: t[2].data }
  rec('SW.6a', '...and refuses a wrap that sends the SOL anywhere but our own wSOL account', 'true',
    String(S.judgeSwapInstructions(t, op.publicKey, 'orca').some(x => /SOL transfer goes to/.test(x))))
  rec('SW.6b', '...and refuses the Orca instructions judged as a Meteora swap (wrong program for the venue)', 'true',
    String(S.judgeSwapInstructions(ixs, op.publicKey, 'meteora').length > 0))
  const ok = R.filter(Boolean).length
  console.log(`\n${ok}/${R.length} swap-fork assertions as predicted`)
  process.exit(ok === R.length ? 0 : 1)
}

if (MODE === 'plan') await plan()
else if (MODE === 'run') await run()
else { console.error('usage: node sim/swap-fork.mjs plan|run'); process.exit(2) }
