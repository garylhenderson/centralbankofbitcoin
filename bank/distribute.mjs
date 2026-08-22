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
 *   * pay twice. Every transfer is recorded BEFORE the next one starts, so a
 *     crash halfway resumes instead of redoing — and the run holds an exclusive
 *     LOCK, because recording-before-the-next-one is only safe against a crash.
 *     Two runners (the cron firing while someone runs it by hand) each loaded
 *     the ledger at start and each rewrote the whole file, so the second one to
 *     save erased the first one's record of everything it had already sent and
 *     the next run paid those vaults again. The header used to claim this was
 *     covered; it was covered in sequence and not in parallel. A row with an
 *     intent but no SIGNATURE is neither paid nor unpaid: `sendAndConfirmTransaction`
 *     throws on a confirmation timeout for a transaction that landed, so such a
 *     row is REPORTED for a human and never silently re-sent or silently skipped.
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
import { withLock, readLedger, writeLedger } from './lock.mjs'
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

/**
 * PAID, UNPAID, or NEITHER. Pure, so the one decision that can double-pay a
 * customer is tested rather than inspected.
 *
 * A SIGNATURE IS A RECEIPT. An intent with no signature is neither: it means a
 * send was started and its outcome is unknown, because
 * `sendAndConfirmTransaction` throws on a confirmation timeout for a transaction
 * that DID land. Re-sending risks paying twice; skipping risks never paying.
 * The only honest answer is to say so and stop.
 */
export function paymentState(row) {
  if (!row) return 'unpaid'
  if (row.sig) return 'paid'
  return 'ambiguous'
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
const LOCK = process.env.CBOB_DIST_LOCK || '/opt/cbob-vaults/bank/.distribute.lock'
/** A MISSING ledger is a first run. One that exists and will not parse is an
 *  ABORT: reading it as `{days:{}}` would mean "nothing has ever been paid",
 *  and this job's next act would be to pay every activated vault again. */
const load = () => readLedger(STATE, { days: {} })
const save = s => writeLedger(STATE, s)

async function main() {
  const conn = new Connection(rpc(), 'confirmed')
  const st = load()
  const day = today()
  st.days[day] ||= { paid: {}, startedAt: new Date().toISOString() }
  const done = st.days[day].paid

  const KEYFILE = '/opt/cbob-vaults/bank/keys/distributor.json'
  const mode = fs.statSync(KEYFILE).mode & 0o777
  if (mode & 0o077) throw new Error(`${KEYFILE} is mode ${mode.toString(8)} — a signing key readable by anyone but its owner is not a key`)
  const distributor = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYFILE, 'utf8'))))

  // the collection this program is wired to
  const cfgAcc = await conn.getAccountInfo(
    PublicKey.findProgramAddressSync([Buffer.from('mint-config')], MINT_PROG)[0], 'confirmed')
  if (!cfgAcc) { console.log('mint config not initialised — nothing to distribute to yet'); return }
  const collection = new PublicKey(cfgAcc.data.subarray(41, 73)).toBase58()
  const mintedTotal = cfgAcc.data.readBigUInt64LE(205)
  // PIN THE PAYER TO THE CHAIN, the way revenue.mjs pins the swap operator.
  // `split_revenue` sends the holders' 85% to the ATA of `config.treasury`; this
  // script pays out of whatever keypair is on disk. Nothing connected the two,
  // so a treasury rotation would have left the 85% piling up at the config
  // address while this reported "no cbBTC to distribute" — forever, quietly.
  const treasury = new PublicKey(cfgAcc.data.subarray(137, 169))
  if (!treasury.equals(distributor.publicKey))
    throw new Error(`distributor key ${distributor.publicKey} is not config.treasury (${treasury}) — the 85% is being paid to a different address than it is sent to`)

  // every vault. A partial list would overpay everyone visible, so a failure here stops us.
  const vaults = [], burnt = []
  const MAX_PAGES = 50
  let complete = false
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetch(rpc(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'd', method: 'getAssetsByGroup',
        params: { groupKey: 'collection', groupValue: collection, page, limit: 1000 } }) })
    const j = await r.json()
    if (j.error) throw new Error(`DAS: ${JSON.stringify(j.error)}`)
    const items = j.result?.items || []
    for (const i of items) (i.burnt ? burnt : vaults).push(i.id)
    if (items.length < 1000) { complete = true; break }
  }
  // The whole point of "refuses to guess": a truncated vault list makes `per`
  // too large and overpays everyone who WAS visible. A cap that breaks quietly
  // is the same bug as a read that fails quietly.
  if (!complete) throw new Error(`vault list did not terminate within ${MAX_PAGES} pages — refusing to distribute against a partial list`)
  // A SHORT PAGE looks exactly like the end of the list, and this job divides the
  // day's cbBTC by the number of vaults it can SEE — so an indexer that returns
  // half the collection does not fail, it silently pays everyone visible twice
  // what they are owed. `minted_total` is the chain's own count of vaults ever
  // created and never decrements, so live + burnt must reach it.
  // UNIQUE ids, and EXACT agreement. `>=` on raw counts accepted a page that
  // repeated ids while omitting real vaults — and `balances` is keyed by id, so
  // duplicates COLLAPSE: 2,100 copies of one vault would satisfy the count and
  // then pay the whole day's cbBTC to that single recipient. Only mint_vault can
  // add to this collection, so more is as wrong as fewer.
  const uniqLive = [...new Set(vaults)], uniqBurnt = new Set(burnt)
  if (uniqLive.some(a => uniqBurnt.has(a)))
    throw new Error('the index reports the same asset as both live and burnt — refusing to distribute against a self-contradictory list')
  if (BigInt(uniqLive.length + uniqBurnt.size) !== mintedTotal)
    throw new Error(`the index returned ${uniqLive.length} unique live + ${uniqBurnt.size} burnt vaults but the chain says ${mintedTotal} were minted — refusing to distribute against a list that does not agree with the chain`)
  vaults.length = 0; vaults.push(...uniqLive)

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

  // THE PLAN IS FIXED ONCE PER DAY AND REUSED ON RESUME.
  // It used to be recomputed from the REMAINING balance every run while the
  // divisor stayed the full activated set, so a crash halfway paid the rest of
  // the day less than the first half: two vaults, 100 sats, A gets 50, crash, the
  // resume divides the remaining 50 by 2 and pays B twenty-five. Equal-per-vault
  // is the whole rule; a plan that changes under a resume is not equal.
  let plan
  if (st.days[day].plan && !DRY) {
    plan = { activated: st.days[day].plan.activated, per: BigInt(st.days[day].plan.per), skip: null }
    console.log(`distribution ${day} — RESUMING the plan fixed at ${st.days[day].startedAt}`)
  } else {
    plan = allocate(balances, available)
    if (!plan.skip && !DRY) {
      st.days[day].plan = { activated: plan.activated, per: String(plan.per), available: String(available) }
      save(st)                                  // the plan is durable BEFORE any transfer
    }
    console.log(`distribution ${day}`)
  }
  console.log(`  vaults ${vaults.length}, activated ${plan.activated.length} (>= ${ACTIVATION_SATS} sats), no cbBTC account ${missing.length}`)
  console.log(`  distributor holds ${available} sats -> ${plan.per} each` + (plan.skip ? `  SKIP: ${plan.skip}` : ''))
  if (plan.skip) { if (!DRY) save(st); return }

  // 5,000 lamports a transfer against ~2,100 vaults is 10.5M, so the old flat
  // 5,000,000 floor funded under half a full run and the rest of the vaults were
  // simply not paid that day.
  const outstanding = plan.activated.filter(v => !done[v]).length
  const needSol = 5_000 * outstanding * 2
  const sol = await conn.getBalance(distributor.publicKey, 'confirmed')
  if (sol < needSol) {
    const msg = `CBOB distributor has ${sol} lamports and needs about ${needSol} to pay ${outstanding} vaults — stopping before a half-finished run`
    console.error(msg); if (!DRY) try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {}
    // A day on which nobody was paid must not exit 0.
    process.exitCode = 1
    return
  }

  let sent = 0
  const failed = [], ambiguous = []
  for (const v of plan.activated) {
    const state = paymentState(done[v])
    if (state === 'paid') continue
    if (state === 'ambiguous') {
      // AN INTENT WITH NO SIGNATURE IS AMBIGUOUS, AND STAYS AMBIGUOUS.
      // `sendAndConfirmTransaction` throws on a confirmation timeout for a
      // transaction that DID land, so neither re-sending nor skipping is safe
      // without looking at the chain. This is exactly the case where a program
      // must refuse to guess: it is reported, and a human resolves it by
      // finding the transfer or establishing it never happened.
      ambiguous.push(v); continue
    }
    if (DRY) { console.log(`  would send ${plan.per} -> ${v}`); sent++; continue }
    // The intent is written BEFORE the send. It used to be written only after
    // confirmation, so a crash in the window between a transfer landing and the
    // ledger recording it left the transfer invisible and the next run paid it
    // again. With the intent on disk, a resume can SEE the ambiguity instead of
    // assuming the transfer never happened.
    done[v] = { amount: String(plan.per), sig: null, sentAt: new Date().toISOString() }
    save(st)
    try {
      const ix = createTransferCheckedInstruction(src, CBBTC, ataOf[v], distributor.publicKey,
        plan.per, CBBTC_DECIMALS)
      const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [distributor],
        { commitment: 'confirmed' })
      done[v] = { amount: String(plan.per), sig }
      save(st); sent++
    } catch (e) {
      // ONE BAD VAULT MUST NOT DENY ALL THE OTHERS. cbBTC has a live freeze
      // authority, so a single frozen destination ATA used to throw out of this
      // loop, exit 3, and leave every remaining vault unpaid for the day with
      // nothing scheduled to try again. The row keeps `sig: null`, so the next
      // run treats it as ambiguous rather than re-sending into the dark.
      done[v] = { amount: String(plan.per), sig: null,
        sentAt: done[v].sentAt, error: String(e.message).slice(0, 200) }
      save(st); failed.push(v)
    }
  }
  if (!DRY) {
    // A dry run must not write to the ledger that decides who has been paid.
    // Only mark the day FINISHED if nothing is still unresolved: `finishedAt`
    // on a day with an ambiguous transfer reads as "done" to every later run
    // and to the watcher.
    if (!failed.length && !ambiguous.length) st.days[day].finishedAt = new Date().toISOString()
    st.days[day].per = String(plan.per)
    save(st)
  }
  console.log(`  ${DRY ? 'would pay' : 'paid'} ${sent} vaults, ${plan.per} sats each`)
  if (missing.length) console.log(`  NOT created (reported, never created): ${missing.slice(0, 5).join(', ')}`)
  if (failed.length || ambiguous.length) {
    const msg = `CBOB distribution ${day}: paid ${sent}; ${failed.length} FAILED; `
      + `${ambiguous.length} AMBIGUOUS (an intent with no signature — the transfer may or may not have landed, `
      + `resolve on chain before re-running). First failed: ${failed[0] || 'none'}. First ambiguous: ${ambiguous[0] || 'none'}`
    console.error(msg)
    if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
    process.exitCode = 1
  }
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
  t('a row with a signature is PAID', paymentState({ amount: '5', sig: 'abc' }), 'paid')
  t('no row at all is UNPAID', paymentState(undefined), 'unpaid')
  // The one that matters: an intent whose send threw may still have LANDED.
  t('an intent with no signature is AMBIGUOUS, not unpaid',
    paymentState({ amount: '5', sig: null, sentAt: 'x' }), 'ambiguous')
  t('...and so is one that recorded an error', 
    paymentState({ amount: '5', sig: null, error: 'timeout' }), 'ambiguous')
  console.log(`\n${R.filter(Boolean).length}/${R.length} allocation assertions as predicted`)
  process.exit(R.every(Boolean) ? 0 : 1)
} else {
  withLock(LOCK, main, { staleMs: 6 * 3600_000 }).catch(e => {
    const msg = e.code === 'ELOCKED'
      ? `CBOB DISTRIBUTION DID NOT RUN: ${e.message}`
      : `CBOB DISTRIBUTION FAILED: ${e.message}`
    console.error(msg)
    if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
    process.exit(3)
  })
}
