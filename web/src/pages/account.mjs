import { clubRead } from '../lib/club-actions.mjs'
import { fmtToken } from '../lib/market-view.mjs'
import { $, el, clear, addr, box, action } from '../lib/ui.mjs'
import { readClubSession, clubRequest, signInLink } from '../lib/club.mjs'

async function boot() {
  const out = $('#account')
  try {
    const s = await readClubSession()
    clear(out)
    if (!s) {
      out.append(el('h2', {}, 'Your Gary Club account'), el('p', {}, 'Use your existing Gary Club account, or create one. Your wallet and vaults belong to the same account on both websites.'),
        el('div', { class: 'row' }, el('a', { class: 'btn', href: signInLink() }, 'Sign in with Gary Club'), el('a', { class: 'btn secondary', href: signInLink('/account/', true) }, 'Create an account')))
      return
    }
    out.append(el('h2', {}, s.displayName), el('p', {}, 'Your Gary Club wallet'), addr(s.wallet),
      box('note', s.custody), el('p', {}, 'This is your account wallet. Each vault has a separate deposit address for its sealed reserves.'),
      el('div', { class: 'row' }, el('a', { class: 'btn', href: '/market/?mine=1' }, 'My vaults'),
        el('a', { class: 'btn secondary', href: '/claim/?wallet=club' }, 'Claim a charter vault'), el('a', { class: 'btn secondary', href: '/buy/?wallet=club' }, 'Buy in a sale round')),
      action('Sign out of the Bank', async () => { await clubRequest('signout'); location.reload() }, { out }))
    const w = await clubRead('wallet')
    out.append(el('h2', {}, 'Wallet balance'), el('p', {}, `${fmtToken(w.sol_lamports, 9, 9)} SOL`))
    for (const [symbol, amount] of Object.entries(w.reserves || {})) out.append(el('p', {}, `${fmtToken(amount, symbol === 'cbBTC' ? 8 : symbol.replace('$', '') === 'GARY' ? 9 : 6, 9)} ${symbol}`))
    out.append(el('p', {}, `${w.pobs.length} eligible Proof${w.pobs.length === 1 ? '' : 's'} of Burn in this wallet.`))
    const market = await clubRead('market')
    const ownOrders = market.orders.filter(o => o.is_mine)
    out.append(el('h2', {}, 'Your listings and offers'))
    for (const o of ownOrders) out.append(el('div', { class: 'order-row' }, el('a', { href: `/market/?a=${o.asset}`, class: 'btn secondary' }, `${o.kind} · ${fmtToken(o.price_lamports, 9, 9)} SOL · ${o.status}`)))
    if (!ownOrders.length) out.append(el('p', {}, 'No active listings or offers.'))
    out.append(el('h2', {}, 'Your recent actions'))
    for (const i of market.intents) {
      const row = el('div', { class: 'order-row' }, el('p', {}, `${i.action.replaceAll('_', ' ')} · ${i.status}`))
      if (i.signature) row.append(el('code', {}, i.signature))
      if (i.status === 'sending') row.append(action('Check confirmation', async () => { const r = await clubRequest('status', { id: i.id }); row.append(el('p', {}, r.status)) }, { out: row }))
      out.append(row)
    }
    if (!market.intents.length) out.append(el('p', {}, 'No Bank actions have been recorded for this account.'))
  } catch (e) { out.append(box('refuse', e.message)) }
}
boot()
