#!/usr/bin/env node
/**
 * DAILY cbBTC DISTRIBUTION to activated vaults.
 *
 * "We should hold the cbBTC for the vaults in a wallet and daily (as long as we
 *  have cbBTC) we should be sending to them. WE ONLY SEND TO ACTIVATED WALLETS
 *  with 21,000 (or more) satoshis in it." — Gary, 2026-08-22
 *
 * Equal per activated vault, because one vault is one unit and one vote. A vault
 * below 21,000 sats gets nothing and is not counted in the divisor, so activating
 * is worth something the day you do it rather than the day we notice.
 *
 * THREE THINGS IT REFUSES TO DO
 *   * pay twice. One distribution per UTC day, and every transfer is recorded
 *     BEFORE the next one starts, so a crash halfway resumes instead of redoing.
 *   * create a token account for a vault PDA. An activated vault already has its
 *     cbBTC ATA (that is how it holds sats), so a missing one means the vault is
 *     not what we think it is: it is SKIPPED and reported, never created.
 *   * guess. If any read fails, it stops and says so. A distribution computed
 *     from a partial vault list would silently overpay everyone who was visible.
 *
 *   node bank/distribute.mjs --dry-run
 *   node bank/distribute.mjs --selftest
 *   node bank/distribute.mjs
 */
import fs from 'fs'
import { execFileSync } from 'child_process'
import { PublicKey, Connection, Keypair, Transaction, sendAndConfirmTransaction }
  from '/opt/gary-club/node_modules/@solana/web3.js/lib/index.cjs.js'
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync }
  from '/opt/gary-club/node_modules/@solana/spl-token/lib/cjs/index.js'

export const ACTIVATION_SATS = 21_000n
export const CBBTC_DECIMALS = 8
/** Below this a transfer costs more in fees and noise than it delivers. */
export const MIN_PER_VAULT = 1n

/** PURE. Which vaults get paid, and how much each. Proven in both directions. */
export function allocate(balances, available, opts = {}) {
  const min = opts.minPerVault ?? MIN_PER_VAULT
  const activated = Object.entries(balances)
    .filter(([, b]) => BigInt(b) >= ACTIVATION_SATS)
    .map(([a]) => a)
    .sort()
  if (activated.length === 0) return { activated, per: 0n, total: 0n, skip: 'no activated vaults' }
  if (available <= 0n) return { activated, per: 0n, total: 0n, skip: 'no cbBTC to distribute' }
  const per = available / BigInt(activated.length)
  if (per < min) return { activated, per: 0n, total: 0n, skip: `only ${available} for ${activated.length} vaults` }
  const total = per * BigInt(activated.length)
  return { activated, per, total, remainder: available - total, skip: null }
}

const ARGS = new Set(process.argv.slice(2))
const DRY = ARGS.has('--dry-run')
const STATE = process.env.CBOB_DIST_STATE || '/opt/cbob-vaults/bank/distributions.json'
const NOTIFY = '/opt/scripts/notify-gary-sms.sh'
const CBBTC = new PublicKey('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij')
const MINT_PROG = new PublicKey('Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo')
const CORE = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d')
const today = () => new Date().toISOString().slice(0, 10)
const rpc = () => (fs.readFileSync('/opt/gary-club/.env.local', 'utf8').match(/^HELIUS_RPC_URL=(.*)$/m) || [])[1].trim()
const load = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return { days: {} } } }
const save = s => fs.writeFileSync(STATE, JSON.stringify(s, null, 2))

async function main() {
  const conn = new Connection(rpc(), 'confirmed')
  const st = load()
  const day = today()
  st.days[day] ||= { paid: {}, startedAt: new Date().toISOString() }
  const done = st.days[day].paid

  const distributor = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync('/opt/cbob-vaults/bank/keys/distributor.json', 'utf8'))))

  // the collection this program is wired to
  const cfgAcc = await conn.getAccountInfo(
    PublicKey.findProgramAddressSync([Buffer.from('mint-config')], MINT_PROG)[0], 'confirmed')
  if (!cfgAcc) { console.log('mint config not initialised — nothing to distribute to yet'); return }
  const collection = new PublicKey(cfgAcc.data.subarray(41, 73)).toBase58()

  // every vault. A partial list would overpay everyone visible, so a failure here stops us.
  const vaults = []
  for (let page = 1; page < 50; page++) {
    const r = await fetch(rpc(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'd', method: 'getAssetsByGroup',
        params: { groupKey: 'collection', groupValue: collection, page, limit: 1000 } }) })
    const j = await r.json()
    if (j.error) throw new Error(`DAS: ${JSON.stringify(j.error)}`)
    const items = j.result?.items || []
    vaults.push(...items.filter(i => !i.burnt).map(i => i.id))
    if (items.length < 1000) break
  }

  const balances = {}, ataOf = {}, missing = []
  for (const v of vaults) {
    const pda = PublicKey.findProgramAddressSync(
      [Buffer.from('mpl-core-execute'), new PublicKey(v).toBuffer()], CORE)[0]
    const a = getAssociatedTokenAddressSync(CBBTC, pda, true)
    ataOf[v] = a
    const info = await conn.getAccountInfo(a, 'confirmed')
    if (!info) { missing.push(v); balances[v] = '0'; continue }   // never created here
    balances[v] = String(info.data.readBigUInt64LE(64))
  }

  const src = getAssociatedTokenAddressSync(CBBTC, distributor.publicKey)
  const srcInfo = await conn.getAccountInfo(src, 'confirmed')
  const available = srcInfo ? srcInfo.data.readBigUInt64LE(64) : 0n
  const plan = allocate(balances, available)

  console.log(`distribution ${day}`)
  console.log(`  vaults ${vaults.length}, activated ${plan.activated.length} (>= ${ACTIVATION_SATS} sats), no cbBTC account ${missing.length}`)
  console.log(`  distributor holds ${available} sats -> ${plan.per} each` + (plan.skip ? `  SKIP: ${plan.skip}` : ''))
  if (plan.skip) { save(st); return }

  const sol = await conn.getBalance(distributor.publicKey, 'confirmed')
  if (sol < 5_000_000) {
    const msg = `CBOB distributor is low on SOL (${sol} lamports) and cannot pay fees`
    console.error(msg); if (!DRY) try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {}
    return
  }

  let sent = 0
  for (const v of plan.activated) {
    if (done[v]) continue                       // resume, never redo
    if (DRY) { console.log(`  would send ${plan.per} -> ${v}`); sent++; continue }
    const ix = createTransferCheckedInstruction(src, CBBTC, ataOf[v], distributor.publicKey,
      plan.per, CBBTC_DECIMALS)
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [distributor],
      { commitment: 'confirmed' })
    done[v] = { amount: String(plan.per), sig }  // recorded BEFORE the next one
    save(st); sent++
  }
  st.days[day].finishedAt = new Date().toISOString()
  st.days[day].per = String(plan.per)
  save(st)
  console.log(`  ${DRY ? 'would pay' : 'paid'} ${sent} vaults, ${plan.per} sats each`)
  if (missing.length) console.log(`  NOT created (reported, never created): ${missing.slice(0, 5).join(', ')}`)
}

if (ARGS.has('--selftest')) {
  const R = []
  const t = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want)
    R.push(ok); console.log(`  ${ok ? 'ok  ' : 'XX  '}${n}${ok ? '' : ` got ${got} want ${want}`}`) }
  const A = 'a', B = 'b', C = 'c'
  t('pays only vaults at or above 21,000 sats',
    allocate({ [A]: '21000', [B]: '20999', [C]: '99999' }, 300n).activated, [A, C])
  t('splits equally across the activated',
    String(allocate({ [A]: '21000', [C]: '21000' }, 300n).per), '150')
  t('exactly 21,000 counts as activated',
    allocate({ [A]: '21000' }, 100n).activated.length, 1)
  t('20,999 does not', allocate({ [A]: '20999' }, 100n).activated.length, 0)
  t('skips when nothing is activated', allocate({ [A]: '0' }, 100n).skip !== null, true)
  t('skips when there is no cbBTC', allocate({ [A]: '21000' }, 0n).skip !== null, true)
  t('skips rather than sending dust',
    allocate({ [A]: '21000', [C]: '21000' }, 1n, { minPerVault: 1n }).skip !== null, true)
  t('never over-distributes (floor, remainder stays)',
    String(allocate({ [A]: '21000', [B]: '21000', [C]: '21000' }, 100n).total), '99')
  t('the remainder is kept, not lost',
    String(allocate({ [A]: '21000', [B]: '21000', [C]: '21000' }, 100n).remainder), '1')
  t('order is deterministic', allocate({ c: '21000', a: '21000' }, 200n).activated, ['a', 'c'])
  console.log(`\n${R.filter(Boolean).length}/${R.length} allocation assertions as predicted`)
  process.exit(R.every(Boolean) ? 0 : 1)
} else {
  main().catch(e => {
    const msg = `CBOB DISTRIBUTION FAILED: ${e.message}`
    console.error(msg)
    if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
    process.exit(3)
  })
}
