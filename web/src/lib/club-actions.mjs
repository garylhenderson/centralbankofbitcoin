import { $, el, clear, addr, box, action as button } from './ui.mjs'
import { readClubSession, clubRequest, signInLink } from './club.mjs'
import { fmtToken } from './market-view.mjs'

export async function clubRead(name) {
  const r = await fetch(`/club/${name}`, { credentials: 'same-origin', cache: 'no-store' })
  const data = await r.json()
  if (!r.ok) throw new Error(data.error || 'The account could not be read.')
  return data
}
export async function reviewAction(out, action, input) {
  clear(out).append(box('note', 'Reading the chain and preparing your transaction...'))
  const quote = await clubRequest('prepare', { action, input })
  clear(out)
  const s = quote.summary, d = s.details
  out.append(el('h3', {}, s.stage === 'opening_setup' ? 'Prepare the receiving accounts' : 'Review this action'),
    el('p', {}, 'Signed by your Gary Club wallet after you confirm.'), addr(s.wallet))
  if (s.asset) out.append(el('p', {}, 'Vault: ', addr(s.asset)))
  if (d.pob) out.append(box('warn', 'This Proof of Burn will be destroyed in exchange for the vault: ', addr(d.pob)))
  if (d.price_sats) out.append(el('p', {}, `Vault price: ${fmtToken(d.price_sats, 8, 8)} cbBTC. Account rent is also paid in SOL.`))
  if (d.price_lamports && (BigInt(d.seller_lamports) + BigInt(d.royalty_lamports) !== BigInt(d.price_lamports) || BigInt(d.royalty_lamports) !== BigInt(d.price_lamports) / 10n)) throw new Error('The payment breakdown could not be verified.')
  if (d.price_lamports) out.append(el('dl', { class: 'facts' }, el('dt', {}, 'Buyer pays'), el('dd', {}, `${fmtToken(d.price_lamports, 9, 9)} SOL`),
    el('dt', {}, 'Seller receives'), el('dd', {}, `${fmtToken(d.seller_lamports, 9, 9)} SOL`), el('dt', {}, 'CBOB royalty'), el('dd', {}, `${fmtToken(d.royalty_lamports, 9, 9)} SOL (10%)`),
    el('dt', {}, 'Royalty destination'), el('dd', {}, addr(d.revenue))))
  if (action === 'open' && s.stage !== 'opening_setup') out.append(box('warn', 'Opening destroys this vault permanently. Its recoverable reserves are paid to your Gary Club wallet.'))
  if (d.vault_no) out.append(el('p', {}, `Vault No. ${d.vault_no} · Level ${['I','II','III','IV','V'][d.level - 1] || 'not drawn'}`))
  if (s.estimated_sol_change_lamports) out.append(el('p', {}, `Estimated wallet SOL change, including rent and fees: ${Number(s.estimated_sol_change_lamports) / 1e9} SOL.`))
  if (d.reserves) {
    const amounts = el('dl', { class: 'facts' })
    const known = { cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: ['cbBTC',8], '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk': ['$GARY',9], Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump: ['$GIRAFFISH',6] }
    for (const r of d.reserves) { const token = known[r.mint]; amounts.append(el('dt', {}, token?.[0] || r.mint || r.address), el('dd', {}, token ? fmtToken(r.raw, token[1], token[1]) : `${r.raw} base units`)) }
    out.append(amounts)
  }
  for (const note of [...(Array.isArray(d.note) ? d.note : d.note ? [d.note] : []), ...(d.steps || [])]) out.append(el('p', {}, note))
  out.append(el('p', {}, `Network fee: ${fmtToken(s.network_fee_lamports, 9, 9)} SOL. Quote expires ${new Date(quote.expires_at).toLocaleTimeString()}. Account setup may also require SOL rent.`))
  const acknowledgments = []
  for (const a of s.acks) {
    const id = `ack-${acknowledgments.length}`, input = el('input', { type: 'checkbox', id })
    acknowledgments.push([a.id, input]); out.append(el('div', { class: 'ack' }, input, el('label', { for: id }, a.text)))
  }
  const result = el('div', { role: 'status' })
  out.append(button(s.stage === 'opening_setup' ? 'Confirm setup with Gary Club' : 'Confirm with Gary Club', async () => {
    if (acknowledgments.some(([, node]) => !node.checked)) throw new Error('Please read and accept every acknowledgment.')
    const r = await clubRequest('confirm', { id: quote.id, acknowledged: acknowledgments.filter(([, node]) => node.checked).map(([id]) => id) })
    clear(out); showOutcome(out, r)
    if (r.status === 'complete' && action === 'open' && s.stage === 'opening_setup') out.append(button('Continue preparing the opening', () => reviewAction(out, action, input), { out }))
  }, { out: result }), result)
}
function showOutcome(out, r) {
  out.append(box(r.status === 'complete' ? 'ok' : 'note', r.status === 'complete' ? 'Confirmed on chain.' : r.status === 'failed' ? 'The transaction did not complete. Check your record before preparing again.' : 'Confirmation is pending. This action is recorded; do not prepare another copy.'))
  if (r.signature) out.append(el('p', {}, 'Transaction: ', el('code', {}, r.signature)))
  if (r.status === 'sending') out.append(button('Check confirmation', async () => {
    const next = await clubRequest('status', { id: r.id }); clear(out); showOutcome(out, next)
  }, { out }))
  out.append(el('a', { class: 'btn secondary', href: '/account/' }, 'Account record'))
}

/** Mainnet defaults to the Gary Club wallet. The audited Phantom path remains explicit. */
export function mountClubAction(kind, profile) {
  if (profile.name !== 'mainnet' || new URLSearchParams(location.search).get('wallet') === 'phantom') return false
  const walletBox = $('#wallet'), out = $('#result'), connect = $('#connect')
  if (connect) connect.hidden = true
  if ($('#check')) $('#check').hidden = true
  const boot = async () => {
    const s = await readClubSession()
    if (walletBox) clear(walletBox)
    if (!s) {
      out.append(el('p', {}, 'Use your Gary Club account to hold and manage your vaults.'), el('a', { class: 'btn', href: signInLink(`/${kind === 'open' ? 'redeem' : kind}/`) }, 'Sign in with Gary Club'))
      return
    }
    out.append(el('p', {}, 'Your Gary Club wallet: ', addr(s.wallet)), box('note', s.custody))
    const form = el('div', {}), review = el('div', {})
    let chosen = null
    if (kind === 'claim') {
      const w = await clubRead('wallet')
      if (!w.pobs.length) { out.append(box('note', 'Your Gary Club wallet does not hold an eligible Proof of Burn.')); return }
      chosen = el('select', { 'aria-label': 'Proof of Burn' })
      for (const p of w.pobs) chosen.append(el('option', { value: p.address }, `Proof of Burn #${p.edition}`))
      form.append(chosen)
    } else if (kind !== 'buy') {
      chosen = el('input', { type: 'text', 'aria-label': 'Vault address', placeholder: 'Vault address', spellcheck: false })
      chosen.value = new URLSearchParams(location.search).get('a') || ''
      form.append(chosen)
    }
    form.append(button('Prepare and review', () => reviewAction(review, kind, kind === 'buy' ? {} : { [kind === 'claim' ? 'pob' : 'asset']: chosen.value }), { out: review }))
    out.append(form, review)
  }
  boot().catch(e => out.append(box('refuse', e.message)))
  return true
}

export function tradePanel(v) {
  const panel = el('section', { class: 'trade-panel' }, el('h3', {}, 'Trade this vault')), messages = el('div', { role: 'status' })
  const load = async () => {
    const s = await readClubSession()
    if (!s) { panel.append(el('a', { class: 'btn', href: signInLink(`/market/?a=${v.asset}`) }, 'Sign in to trade')); return }
    const market = await clubRead('market')
    panel.append(el('p', {}, 'Trades settle in SOL. The seller receives 90%; CBOB receives 10%. Network fees are paid by the member who confirms. Offers reserve no funds and are checked again when accepted.'))
    if (!market.enabled) { panel.append(box('note', 'Trading opens after initialization and validation.')); return }
    const current = await clubRead(`vault?a=${encodeURIComponent(v.asset)}`), mine = s.wallet === current.owner
    const orders = market.orders.filter(o => o.asset === v.asset)
    for (const o of orders) {
      const row = el('div', { class: 'order-row' }, el('p', {}, `${o.kind === 'listing' ? 'Listed for' : 'Offer'} ${fmtToken(o.price_lamports, 9, 9)} SOL${o.status === 'settling' ? ' · settling' : ''}`))
      if (o.is_mine) row.append(button(o.status === 'settling' ? 'Request cancellation' : 'Cancel', async () => { const result = await clubRequest('cancel', { id: o.id }); if (result.status === 'cancelled') row.remove(); else messages.append(box('note', 'Cancellation requested. If the current settlement fails, the order will close. An already confirmed sale cannot be reversed.')) }, { out: messages }))
      if (o.status === 'active' && !o.is_mine) {
        if (o.kind === 'listing' && !mine) row.append(button('Review purchase', () => reviewAction(messages, 'buy_order', { id: o.id }), { out: messages }))
        else if (o.kind === 'offer' && mine) row.append(button('Review offer', () => reviewAction(messages, 'accept_offer', { id: o.id }), { out: messages }))
      }
      panel.append(row)
    }
    const price = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Price in SOL', 'aria-label': 'Price in SOL' })
    panel.append(price, button(mine ? 'Review listing' : 'Review offer', async () => {
      const quote = await clubRequest('order', { kind: mine ? 'listing' : 'offer', asset: v.asset, price: price.value.trim() })
      clear(messages).append(el('h3', {}, mine ? 'Authorize this listing' : 'Authorize this offer'),
        el('p', {}, `Price: ${fmtToken(quote.price_lamports, 9, 9)} SOL (${quote.price_lamports} lamports). Seller receives ${fmtToken(quote.seller_lamports, 9, 9)} SOL. The Bank receives ${fmtToken(quote.royalty_lamports, 9, 9)} SOL.`),
        el('p', {}, `Expires ${new Date(quote.expires_at).toLocaleString()}. You may cancel before settlement starts.`))
      const consent = el('input', { type: 'checkbox', id: 'standing-order-consent' })
      messages.append(el('div', { class: 'ack' }, consent, el('label', { for: 'standing-order-consent' }, mine
        ? 'I authorize Gary Club to sign the transfer of this vault automatically when a buyer accepts this price. I will not be asked to sign again.'
        : `I authorize Gary Club to pay ${fmtToken(quote.price_lamports, 9, 9)} SOL from my wallet automatically when the owner accepts. No funds are reserved. I will not be asked to sign again.`)))
      messages.append(button(mine ? 'Confirm listing' : 'Confirm offer', async () => {
        if (!consent.checked) throw new Error('Accept the standing order authorization to continue.')
        await clubRequest('order', { review_token: quote.review_token, acknowledged: 'standing_order_v1' })
        clear(messages).append(box('ok', `${mine ? 'Listing' : 'Offer'} recorded at ${fmtToken(quote.price_lamports, 9, 9)} SOL. Reopen this vault to see it.`))
      }, { out: messages }))
    }, { out: messages }))
    if (mine) panel.append(button('Activate vault', () => reviewAction(messages, 'activate', { asset: v.asset }), { out: messages }),
      button('Record level draw', () => reviewAction(messages, 'draw', { asset: v.asset }), { out: messages }))
    panel.append(messages)
  }
  load().catch(e => panel.append(box('refuse', e.message)))
  return panel
}
