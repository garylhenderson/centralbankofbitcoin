import { activeProfile } from '../config.js'
import { makeIds } from './ids.mjs'
import { connect } from './reads.mjs'
import { connectWallet } from './holder-wallet.mjs'
import { reviewAction } from './club-actions.mjs'
import { pendingMove, resolvePendingMove, reviewExternalMove } from './external-move.mjs'
import { el, addr, box, action, clear } from './ui.mjs'

async function vaultChoices(field, owner) {
  try {
    const response = await fetch('/data/vaults.json', { cache: 'no-store' }); if (!response.ok) return
    const d = await response.json(); if (!Array.isArray(d.vaults) || !Number.isFinite(d.generated_at) || Math.abs(Date.now()/1000-d.generated_at)>1800) return
    const list = el('datalist', { id: `${field.id}-choices` })
    for (const v of d.vaults.filter(v => v.owner === owner && v.status !== 'opened')) list.append(el('option', { value: v.asset }, `Vault #${v.no} · Level ${v.level || 'not drawn'}`))
    field.setAttribute('list', list.id); field.after(list)
  } catch { /* The holder can paste an address; the planner verifies it on chain. */ }
}

export function moveDesk(session) {
  const profile = activeProfile(), out = el('section', { id: 'move-vaults', class: 'charter-status' },
    el('p', { class: 'eyebrow' }, 'Your vault / Your choice of wallet'), el('h2', {}, 'A change of address.'),
    el('p', {}, 'Keep your whole vault together. Move it between your Gary Club account and a Solana wallet you control. No sale. No opening. No reset of its votes.'))
  const recovery = el('div', { role: 'status' })
  out.append(action('Check a saved external transfer', async () => {
    const wallet = await connectWallet(profile), r = await resolvePendingMove(connect(profile), wallet)
    clear(recovery).append(box('note', r ? `Transfer status: ${r.status}. ${r.status === 'sending' ? 'Keep the receipt and check again before another transfer.' : 'Check wallet history before starting another transfer.'}` : 'No pending transfer receipt is saved for this wallet in this browser.'))
    if (r?.signature) recovery.append(el('code', {}, r.signature))
  }, { kind: 'secondary', out: recovery }), recovery)
  if (session.holderActionsEnabled !== true) { out.append(box('note', 'Guided transfers open with holder actions after initialization and validation.')); return out }
  const section = (title, text) => { const s = el('details', { class: 'wallet-details' }, el('summary', {}, title), el('p', {}, text)); out.append(s); return s }
  const assetField = id => el('input', { id, type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'Full vault address', class: 'input' })
  const outgoing = section('Move out of Gary Club ↗', 'Choose your vault and the wallet that will control it. The receiving address is a wallet, not a vault deposit address.'), asset = assetField('move-out-asset'), recipient = el('input', { id: 'move-to-wallet', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'Receiving Solana wallet address', class: 'input' }), review = el('div', { class: 'action-review' })
  outgoing.append(el('label', { for: 'move-out-asset' }, 'Vault to move'), asset, el('p', {}, el('a', { href: '#your-vaults' }, 'Find a vault in your collection')), el('label', { for: 'move-to-wallet' }, 'Receiving wallet'), recipient,
    action('Use my connected wallet as destination', async () => { recipient.value = (await connectWallet(profile)).publicKey.toBase58(); clear(review) }, { kind: 'secondary', out: review }),
    action('Review transfer out', () => reviewAction(review, 'move', { asset: asset.value.trim(), recipient: recipient.value.trim() }), { out: review }), review)
  queueMicrotask(() => vaultChoices(asset, session.wallet))
  const incoming = section('Bring a vault into Gary Club ↙', 'Connect the wallet holding your vault. That wallet signs and pays the SOL network fee. The destination is your signed-in Gary Club wallet.'), inside = el('div', {})
  incoming.append(el('p', {}, 'Your Gary Club destination: ', addr(session.wallet)), action('Connect the wallet holding my vault', async () => {
    const wallet = await connectWallet(profile), conn = connect(profile), ids = makeIds(profile)
    clear(inside).append(el('p', {}, 'Connected: ', addr(wallet.publicKey.toBase58())))
    if (pendingMove(wallet)) {
      inside.append(box('note', 'This browser has an unfinished transfer receipt.'), action('Check saved transfer', async () => {
        const r = await resolvePendingMove(conn, wallet)
        inside.append(box('note', r ? `Transfer status: ${r.status}. ${['failed', 'complete'].includes(r.status) ? 'Reconnect here to continue.' : 'Keep this receipt and check again.'}` : 'No pending receipt remains. Check wallet history before continuing.'))
        if (r?.signature) inside.append(el('code', {}, r.signature))
      }, { out: inside }))
      return
    }
    const chosen = assetField('move-in-asset'), area = el('div', { class: 'action-review' })
    inside.append(el('label', { for: 'move-in-asset' }, 'Vault to bring in'), chosen, action('Review transfer into Gary Club', () => reviewExternalMove(area, { asset: chosen.value.trim(), recipient: session.wallet }, { conn, ids, profile, wallet }), { out: area }), area)
    vaultChoices(chosen, wallet.publicKey.toBase58())
  }, { out: inside }), inside)
  return out
}
