import bs58 from 'bs58'
import { planMove, moveInput } from './vault-move.mjs'
import { buildForWallet, signExact, sendSigned } from './tx.mjs'
import { readClubSession } from './club.mjs'
import { el, clear, addr, box, action, amount } from './ui.mjs'

const reviews = new WeakMap()
const key = wallet => `cbob-pending-move:${wallet.publicKey.toBase58()}`
const lockKey = wallet => `cbob-move:${wallet.publicKey.toBase58()}`
export function pendingMove(wallet) {
  const raw = localStorage.getItem(key(wallet)); if (!raw) return null
  try {
    const r = JSON.parse(raw); moveInput(r.input)
    if (r.wallet !== wallet.publicKey.toBase58() || bs58.decode(r.signature).length !== 64 || !Number.isSafeInteger(r.lastValidBlockHeight) || r.lastValidBlockHeight < 0) throw Error()
    return r
  } catch { throw Error('The saved transfer receipt cannot be read. Keep browser data and check wallet history before trying again.') }
}
async function resolveLocked(conn, wallet) {
  const r = pendingMove(wallet); if (!r) return null
  const s = (await conn.getSignatureStatuses([r.signature], { searchTransactionHistory: true })).value[0]
  if (s && ['confirmed', 'finalized'].includes(s.confirmationStatus)) { localStorage.removeItem(key(wallet)); return { ...r, status: s.err ? 'failed' : 'complete' } }
  if (!s && await conn.getBlockHeight('finalized') > r.lastValidBlockHeight) { localStorage.removeItem(key(wallet)); return { ...r, status: 'failed' } }
  return { ...r, status: 'sending' }
}
export async function resolvePendingMove(conn, wallet) {
  if (!navigator.locks) throw Error('Use a browser with Web Locks to recover this transfer safely.')
  return navigator.locks.request(lockKey(wallet), { mode: 'exclusive', ifAvailable: true }, lock => lock ? resolveLocked(conn, wallet) : { status: 'busy_elsewhere' })
}
export function showMove(out, asset, d, profile) {
  out.append(el('h3', {}, 'Move the whole vault'), el('p', {}, 'Vault: ', addr(asset)), el('p', {}, 'From: ', addr(d.sender)), el('p', {}, 'To: ', addr(d.recipient)),
    box('warn', 'This transfers ownership. It does not open the vault or pay you for it. Its reserves stay sealed at the same deposit address, under the receiving wallet’s control. Recorded votes stay with the vault.'))
  out.append(el('p', { class: 'sub' }, 'Observed Bank reserve tokens are listed below. Other assets may also be held at the vault’s deposit address.'))
  const decimals = { cbBTC: 8, '$GARY': 9, GARY: 9, '$GIRAFFISH': 6, GIRAFFISH: 6 }
  for (const r of d.held) { const label = profile.tokenNames[r.mint]; out.append(el('p', {}, `${label || r.mint}: ${amount(r.raw, decimals[label])}`)) }
}
const checkSession = async recipient => {
  const s = await readClubSession()
  if (!s || s.wallet !== recipient || s.holderActionsEnabled !== true) throw Error('Your Gary Club account changed or vault actions are unavailable. Return to your desk and review again.')
}
export async function reviewExternalMove(out, input, { conn, ids, profile, wallet }) {
  const version = Symbol(); reviews.set(out, version)
  const current = () => reviews.get(out) === version
  clear(out).append(box('note', 'Reading the vault and preparing your transfer...'))
  moveInput(input)
  input = { ...input }
  if (pendingMove(wallet)) throw Error('Check your saved transfer before preparing another.')
  await checkSession(input.recipient)
  const owner = wallet.publicKey.toBase58(), plan = await planMove(conn, ids, profile, owner, input)
  const built = await buildForWallet(conn, plan.ixs, wallet.publicKey)
  if (built.sim.err) throw Error('The network dry run refused this transfer. Nothing was signed.')
  const fee = (await conn.getFeeForMessage(built.tx.compileMessage(), 'confirmed')).value
  if (!Number.isSafeInteger(fee) || fee < 0) throw Error('The network fee is unavailable.')
  if (!current()) return
  clear(out); showMove(out, input.asset, plan.details, profile)
  out.append(el('p', {}, `Network fee: ${amount(fee, 9)} SOL, paid by your connected wallet.`))
  const consent = el('input', { type: 'checkbox' })
  out.append(el('label', { class: 'ack' }, consent, plan.acks[0].text))
  const messages = el('div', { role: 'status' })
  let submitted = false
  out.append(action('Sign transfer into Gary Club', async () => {
    if (!current()) throw Error('This review was replaced. Use the current transfer review.')
    if (submitted) return
    if (!navigator.locks) throw Error('Use a browser with Web Locks to prevent overlapping transfers.')
    await navigator.locks.request(lockKey(wallet), { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) throw Error('Another tab is confirming a transfer for this wallet.')
      if (!consent.checked) throw Error('Check the receiving address and approve the transfer first.')
      if (pendingMove(wallet)) throw Error('Check the saved transfer before signing another.')
      await checkSession(input.recipient)
      const fresh = await planMove(conn, ids, profile, owner, input)
      if (JSON.stringify(fresh.details) !== JSON.stringify(plan.details)) throw Error('The vault changed. Prepare and review it again.')
      const next = await buildForWallet(conn, fresh.ixs, wallet.publicKey)
      if (next.sim.err || (await conn.getFeeForMessage(next.tx.compileMessage(), 'confirmed')).value !== fee) throw Error('The dry run or network fee changed. Review again.')
      localStorage.setItem(key(wallet) + ':probe', '1'); localStorage.removeItem(key(wallet) + ':probe')
      if (!current()) throw Error('This review was replaced before signing.')
      const signed = await signExact(wallet, next.tx, [], { minUnits: next.minUnits })
      await checkSession(input.recipient)
      if (!current()) throw Error('This review was replaced. Nothing was broadcast.')
      const r = { wallet: owner, input, signature: bs58.encode(signed.signature), lastValidBlockHeight: next.lastValidBlockHeight }
      localStorage.setItem(key(wallet), JSON.stringify(r))
      if (localStorage.getItem(key(wallet)) !== JSON.stringify(r)) throw Error('The transfer receipt could not be saved. Nothing was broadcast.')
      submitted = true
      clear(out).append(box('note', 'Transfer submitted. Keep this receipt until confirmation.'), el('code', {}, r.signature))
      try { await sendSigned(conn, signed, next.blockhash, next.lastValidBlockHeight) } catch { out.append(box('warn', 'Confirmation did not finish here. Check the saved receipt for its outcome before another transfer.')) }
      const show = r => out.append(box(r?.status === 'complete' ? 'ok' : 'note', r?.status === 'complete' ? 'Confirmed. The vault register will catch up within about 10 minutes.' : r?.status === 'failed' ? 'The transfer did not complete.' : 'Still awaiting confirmation. Do not send another copy.'))
      out.append(action('Check transfer', async () => show(await resolvePendingMove(conn, wallet)), { out }), el('a', { href: '/account/' }, 'Return to your vaults'))
      try { show(await resolveLocked(conn, wallet)) } catch { out.append(box('note', 'Status is unavailable. Keep the saved receipt.')) }
    })
  }, { out: messages }), messages)
}
