import { clubRead } from '../lib/club-actions.mjs'
import { fmtToken, fmtUsd, vaultNo, LEVEL_NAMES } from '../lib/market-view.mjs'
import { vaultArt } from '../lib/exhibition.mjs'
import { $, el, clear, addr, box, action } from '../lib/ui.mjs'
import { readClubSession, clubRequest, signInLink } from '../lib/club.mjs'

const heading = (eyebrow, title) => el('div', { class: 'section-heading' }, el('div', {}, el('div', { class: 'eyebrow' }, eyebrow), el('h2', {}, title)))
async function boot() {
  const out = $('#account')
  try {
    const s = await readClubSession()
    clear(out); $('#account-status').textContent = s ? 'Account loaded. Reading your wallet and vaults.' : 'Sign in to view your account.'
    if (!s) {
      out.append(el('section', { class: 'account-arrival' },
        el('div', { class: 'arrival-copy' }, el('div', { class: 'eyebrow' }, 'The private desk / Gary Club'), el('h1', {}, 'Your seat', el('br'), 'at the ', el('em', {}, 'Bank.')),
          el('p', { class: 'hero-lede' }, 'Your wallet. Your vaults. Your call.'), el('p', {}, 'Sign in with Gary Club to see what you hold, follow your vaults and manage your listings. One account across both websites.'),
          el('div', { class: 'row' }, el('a', { class: 'btn', href: signInLink() }, 'Sign in with Gary Club ↗'), el('a', { class: 'btn secondary', href: signInLink('/account/', true) }, 'Create an account')),
          el('p', { class: 'arrival-note' }, 'Already in Gary Club? Your existing wallet comes with you.')),
        el('div', { class: 'arrival-art' }, el('img', { src: vaultArt(3), alt: 'Level III vault design', width: 720, height: 720 }), el('span', { class: 'arrival-stamp' }, 'YOUR VAULTS.\nON THE RECORD.'), el('div', { class: 'arrival-caption' }, 'LEVEL III / DESIGN SPECIMEN'))),
        el('section', { class: 'account-benefits' }, ...[
          ['01', 'See what is yours.', 'Your vault collection and the reserves inside each one, together.'],
          ['02', 'Make your next move.', 'List a vault. Make an offer. Review before you authorize. Standing orders settle automatically at your price.'],
          ['03', 'Keep the record.', 'Follow your listings, offers and confirmed transactions from your private desk.']
        ].map(([n, title, copy]) => el('div', {}, el('span', { class: 'eyebrow' }, n), el('h2', {}, title), el('p', {}, copy)))),
        el('div', { class: 'account-invitation' }, el('p', {}, 'The register is public. Your desk is personal.'), el('a', { class: 'text-action', href: '/market/' }, 'Explore the vaults first ↗')))
      return
    }
    out.append(el('section', { class: 'private-heading' }, el('div', {}, el('div', { class: 'eyebrow' }, 'The private desk'), el('h1', {}, 'Welcome back, ', el('em', {}, s.displayName || 'member'), '.'), el('p', {}, 'Your position at the Bank. All in one place.')), action('Sign out', async () => { await clubRequest('signout'); location.reload() }, { kind: 'secondary', out })))
    const wallet = el('section', { class: 'wallet-passbook' }, el('div', { class: 'passbook-top' }, el('span', { class: 'eyebrow' }, 'GARY CLUB / YOUR ACCOUNT WALLET'), el('span', {}, 'SOLANA')), addr(s.wallet), el('div', { id: 'wallet-balances', class: 'wallet-balances' }, el('p', {}, 'Reading your balances...')))
    const custody = el('details', { class: 'custody-note' }, el('summary', {}, 'About your wallet & custody'), el('p', {}, s.custody), el('p', {}, 'This is your account wallet. Each vault has its own deposit address for sealed reserves.'))
    out.append(wallet, custody, el('div', { class: 'row account-quick' }, el('a', { class: 'btn', href: '/market/?mine=1' }, 'Explore my vaults ↗'), el('a', { class: 'btn secondary', href: '/claim/?wallet=club' }, 'Claim a charter vault'), el('a', { class: 'btn secondary', href: '/buy/?wallet=club' }, 'Buy in a sale round')))
    const collection = el('section', { class: 'personal-collection' }, heading('Your collection', 'Every vault. Accounted for.')), orders = el('section', {}, heading('Your market desk', 'Listings & offers')), history = el('section', {}, heading('The paper trail', 'Recent actions'))
    out.append(collection, el('div', { class: 'desk-columns' }, orders, history))
    await Promise.allSettled([
      (async () => {
        try {
          const w = await clubRead('wallet'), balances = clear($('#wallet-balances'))
          for (const [symbol, raw] of Object.entries({ SOL: w.sol_lamports, ...w.reserves })) balances.append(el('div', {}, el('span', { class: 'eyebrow' }, symbol), el('strong', {}, fmtToken(raw, symbol === 'cbBTC' ? 8 : ['SOL', 'GARY'].includes(symbol.replace('$', '')) ? 9 : 6, 8))))
          wallet.append(el('p', { class: 'passbook-pob' }, `${w.pobs.length} eligible Proof${w.pobs.length === 1 ? '' : 's'} of Burn`))
        } catch (e) { clear($('#wallet-balances')).append(box('refuse', e.message)) }
      })(),
      (async () => {
        try {
          const r = await fetch('/data/vaults.json', { cache: 'no-store' }); if (!r.ok) throw new Error('The vault register is temporarily unavailable.')
          const d = await r.json(), mine = d.vaults.filter(v => v.owner === s.wallet && v.status !== 'opened'), grid = el('div', { class: 'grid account-vaults' })
          for (const v of mine) grid.append(el('a', { class: 'card', href: `/market/?a=${encodeURIComponent(v.asset)}` }, el('div', { class: 'card-art' }, el('img', { src: vaultArt(v.level), alt: '', width: 720, height: 720, loading: 'lazy' })), el('div', { class: 'card-body' }, el('div', { class: 'eyebrow' }, `Level ${LEVEL_NAMES[v.level - 1] || 'not drawn'}`), el('h3', {}, vaultNo(v.no)), el('div', { class: 'val' }, fmtUsd(v.value_usd)), el('p', { class: 'sub' }, 'Estimated reserves held'))))
          if (!mine.length) collection.append(el('div', { class: 'personal-empty' }, el('img', { src: vaultArt(1), alt: 'Level I design specimen', width: 720, height: 720 }), el('div', {}, el('h3', {}, 'A place for your first vault.'), el('p', {}, 'No live vault is recorded for this wallet yet.'), el('a', { class: 'text-action', href: '/market/' }, 'Explore the register ↗'))))
          else collection.append(grid)
          collection.append(el('p', { class: 'sub' }, `Register observed ${new Date(d.generated_at * 1000).toLocaleString('en-US')}. Estimated token values are not sale prices.`))
        } catch (e) { collection.append(box('refuse', e.message)) }
      })(),
      (async () => {
        try {
          const market = await clubRead('market'), ownOrders = market.orders.filter(o => o.is_mine)
          for (const o of ownOrders) orders.append(el('a', { class: 'desk-record', href: `/market/?a=${encodeURIComponent(o.asset)}` }, el('span', { class: 'eyebrow' }, `${o.kind} / ${o.status}`), el('strong', {}, `${fmtToken(o.price_lamports, 9, 9)} SOL`), el('span', {}, 'View vault ↗')))
          if (!ownOrders.length) orders.append(el('p', { class: 'desk-empty' }, 'No standing orders. Your next move is yours.'))
          for (const i of market.intents) {
            const row = el('div', { class: 'desk-record' }, el('span', { class: 'eyebrow' }, i.status), el('strong', {}, i.action.replaceAll('_', ' ')))
            if (i.signature) row.append(el('details', {}, el('summary', {}, 'Transaction reference'), el('code', {}, i.signature)))
            if (i.status === 'sending') row.append(action('Check confirmation', async () => { const r = await clubRequest('status', { id: i.id }); row.append(el('p', {}, r.status)) }, { out: row }))
            history.append(row)
          }
          if (!market.intents.length) history.append(el('p', { class: 'desk-empty' }, 'The file is open. The first entry is still to come.'))
        } catch (e) { orders.append(box('refuse', e.message)) }
      })()
    ])
    $('#account-status').textContent = 'Account sections loaded. Any unavailable records are marked.'
  } catch (e) { out.append(box('refuse', e.message)) }
}
boot()
