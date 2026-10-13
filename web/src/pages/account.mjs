import { position, basketHistory, RESERVES, validObservation } from '../lib/position.mjs'
import { reserveMix, positionChart, metric, bankRibbon, wayfinder } from '../lib/position-view.mjs'
import { clubRead, reviewAction } from '../lib/club-actions.mjs'
import { fmtToken, fmtUsd, vaultNo, LEVEL_NAMES } from '../lib/market-view.mjs'
import { vaultArt } from '../lib/exhibition.mjs'
import { $, el, clear, addr, box, action } from '../lib/ui.mjs'
import { readClubSession, clubRequest, signInLink } from '../lib/club.mjs'

const walletDecimals = Object.fromEntries([['SOL',9], ...RESERVES])
const heading = (eyebrow, title) => el('div', { class: 'section-heading' }, el('div', {}, el('div', { class: 'eyebrow' }, eyebrow), el('h2', {}, title)))
async function boot() {
  const out = $('#account')
  if (!document.querySelector('.bank-dock')) document.body.append(wayfinder('Your desk'))
  try {
    const s = await readClubSession()
    clear(out); $('#account-status').textContent = s ? 'Account loaded. Reading your wallet and vaults.' : 'Sign in to view your account.'
    if (!s) {
      out.append(el('section', { class: 'account-arrival' },
        el('div', { class: 'arrival-copy' }, el('div', { class: 'eyebrow' }, 'The private desk / Gary Club'), el('h1', {}, 'Your seat', el('br'), 'at the ', el('em', {}, 'Bank.')),
          el('p', { class: 'hero-lede' }, 'Your wallet. Your vaults. Your call.'), el('p', {}, 'Sign in with Gary Club to see what you hold, follow your vaults and manage your listings. One account for Gary Club and the Central Bank of Bitcoin.'),
          el('div', { class: 'row' }, el('a', { class: 'btn', href: signInLink() }, 'Sign in with Gary Club ↗'), el('a', { class: 'btn secondary', href: signInLink('/account/', true) }, 'Create an account')),
          el('p', { class: 'arrival-note' }, 'Already in Gary Club? Your existing wallet comes with you.')),
        el('div', { class: 'arrival-art' }, el('img', { src: vaultArt(3), alt: 'Level III vault design', width: 720, height: 720 }), el('span', { class: 'arrival-stamp' }, 'YOUR VAULTS.\nON THE RECORD.'), el('div', { class: 'arrival-caption' }, 'LEVEL III / DESIGN SPECIMEN'))),
        el('section', { class: 'account-benefits' }, ...[
          ['01', 'See what is yours.', 'Your vault collection and the reserves inside each one, together.'],
          ['02', 'Manage your vaults.', 'Review reserves, participation and the vault record. Vault trading is not open yet.'],
          ['03', 'Keep the record.', 'Follow your listings, offers and confirmed transactions from your private desk.']
        ].map(([n, title, copy]) => el('div', {}, el('span', { class: 'eyebrow' }, n), el('h2', {}, title), el('p', {}, copy)))),
        el('div', { class: 'account-invitation' }, el('p', {}, 'The register is public. Your desk is personal.'), el('a', { class: 'text-action', href: '/market/' }, 'Explore the vaults first ↗')))
      return
    }
    out.append(el('section', { class: 'private-heading' }, el('div', {}, el('div', { class: 'eyebrow' }, 'The private desk'), el('h1', {}, 'Welcome back, ', el('em', {}, s.displayName || 'member'), '.'), el('p', {}, 'Vaults held by your Gary Club wallet.')), el('div', {class:'row'}, el('button',{class:'btn secondary',type:'button',onclick:()=>location.reload()},'Refresh'), action('Sign out', async () => { await clubRequest('signout'); location.reload() }, { kind: 'secondary', out }))))
    const overview = el('section', { class: 'position-overview', id: 'your-position' }, el('p', { class: 'sub' }, 'Reading your position...'))
    out.append(overview)
    const wallet = el('section', { class: 'wallet-passbook' }, el('div', { class: 'passbook-top' }, el('span', { class: 'eyebrow' }, 'GARY CLUB / YOUR ACCOUNT WALLET'), el('span', {}, 'SOLANA')), addr(s.wallet), el('div', { id: 'wallet-balances', class: 'wallet-balances' }, el('p', {}, 'Reading your balances...')))
    const custody = el('details', { class: 'custody-note' }, el('summary', {}, 'About your wallet & custody'), el('p', {}, s.custody), el('p', {}, 'This is your account wallet. Each vault has its own deposit address for sealed reserves.'))
    const walletDetails = el('details', { class: 'wallet-details', open: true }, el('summary', {}, 'Your Gary Club wallet', el('span', {}, 'Balances & deposit address')), wallet, custody)
    out.append(walletDetails, el('div', { class: 'row account-quick' }, el('a', { class: 'btn', href: '/market/?mine=1' }, 'Explore my vaults ↗'), el('a', { class: 'btn secondary', href: '/claim/?wallet=club' }, 'Claim a charter vault'), el('a', { class: 'btn secondary', href: '/buy/?wallet=club' }, 'Buy in a sale round')))
    const collection = el('section', { class: 'personal-collection', id: 'your-vaults' }, heading('Your collection', 'Every vault. Accounted for.')), orders = el('section', {}, heading('Your market desk', 'Listings & offers')), history = el('section', {}, heading('The paper trail', 'Recent actions'))
    const offers = el('section', { id: 'offers-received' }, heading('Your offers', 'Offers received')), notices = el('section', { id: 'order-notices' }, heading('Your market record', 'Order notices'))
    out.append(collection, offers, notices, el('div', { class: 'desk-columns' }, orders, history))
    await Promise.allSettled([
      (async () => {
        try {
          const w = await clubRead('wallet'), balances = clear($('#wallet-balances'))
          for (const [symbol, raw] of Object.entries({ SOL: w.sol_lamports, ...w.reserves })) balances.append(el('div', {}, el('span', { class: 'eyebrow' }, symbol), el('strong', {}, Object.hasOwn(walletDecimals,symbol.replace(/^\$/, '')) ? fmtToken(raw,walletDecimals[symbol.replace(/^\$/, '')],8) : 'Balance unavailable')))
          wallet.append(el('p', { class: 'passbook-pob' }, `${w.pobs.length} eligible Proof${w.pobs.length === 1 ? '' : 's'} of Burn`))
        } catch (e) { clear($('#wallet-balances')).append(box('refuse', e.message)) }
      })(),
      (async () => {
        try {
          const r = await fetch('/data/vaults.json', { cache: 'no-store' }); if (!r.ok) throw new Error('The vault register is temporarily unavailable.')
          const d = await r.json(); if (!validObservation(d)) throw new Error('The register has no valid observation time. Please refresh shortly.'); const p = position(d, s.wallet), mine = p.vaults, grid = el('div', { class: 'grid account-vaults' })
          const delayed = Date.now()/1000 - d.generated_at > 1800
          const shownLevel = mine.length ? mine.reduce((n,v)=>Math.max(n,v.level||0),0) : 5
          const stamp = `${delayed ? 'Delayed return. ' : ''}Observed ${new Date(d.generated_at*1000).toLocaleString('en-US',{timeZone:'America/Chicago'}) + ' Austin time'}. Estimates, not sale prices.`
          const hero = el('div', { class: 'position-hero' }, el('div', { class: 'position-hero-copy' }, el('div', { class: 'eyebrow' }, 'YOUR POSITION / CENTRAL BANK OF BITCOIN'), el('div', { class: 'position-value' }, fmtUsd(p.value)), el('p', {}, 'Estimated reserves in your Gary Club vaults'), el('p',{class:`hero-observed${delayed?' delayed':''}`},`${delayed?'Delayed return. ':''}As of ${new Date(d.generated_at*1000).toLocaleString('en-US',{timeZone:'America/Chicago'}) + ' Austin time'}`), el('a', { class: 'btn', href: '#your-vaults' }, 'Inspect your vaults ↗')),
            el('div', { class: 'position-art' }, el('img', { src: vaultArt(shownLevel), alt: mine.length ? (shownLevel ? `Level ${LEVEL_NAMES[shownLevel-1]} design; individual vaults appear below` : 'Bank seal; your vault levels have not been drawn yet') : 'Level V design specimen, not an owned vault', width: 720, height: 720 }), el('span', { class: 'eyebrow' }, mine.length ? `${mine.length} LIVE VAULT${mine.length===1?'':'S'} / YOUR COLLECTION` : 'YOUR COLLECTION BEGINS WITH ONE / DESIGN SPECIMEN')))
          const metrics = el('div', { class: 'position-metrics' }, metric('Recorded live vaults', String(mine.length), 'Per the observed register'), metric('Earning now', String(p.earning), 'Participating in Bank payouts'), metric('Payouts owed', p.owed===null ? 'Unavailable' : `${fmtToken(p.owed,8,8)} cbBTC`, 'Separate from reserves already held'))
          const cabinet = el('div', { class: 'collection-cabinet' }, ...p.levels.map(l => el('a', { href: `/market/?mine=1&level=${l.level}`, class: `cabinet-slot${l.count?' collected':''}` }, el('img', { src: vaultArt(l.level), alt: '', width:720,height:720,loading:'lazy' }), el('span',{},`LEVEL ${LEVEL_NAMES[l.level-1]}`), el('strong',{},l.count ? `${l.count} owned` : 'Not held'))))
          clear(overview).append(hero,metrics,el('p',{class:`sub position-freshness${delayed?' data-delayed':''}`},stamp),el('p',{class:'sub register-lag'},'Recent trades can take about 10 minutes to reach this register. Check Recent actions for transaction status.'),el('div',{class:'position-analysis'},reserveMix(p.held,d.prices),el('div',{id:'personal-chart'},el('p',{class:'sub'},'Reading reserve history...'))),el('div',{class:'cabinet-heading'},el('div',{},el('span',{class:'eyebrow'},'Your collection, at a glance'),el('h2',{},`${p.levels.filter(l=>l.count).length} of 5 levels.`)),el('a',{class:'text-action',href:'/market/#collection'},'Explore the five levels ↗')),cabinet,bankRibbon(d))
          fetch('/data/history.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('unavailable');return r.json()}).catch(()=>null).then(h=>{if(!$('#personal-chart'))return;if(!h){clear($('#personal-chart')).append(el('p',{class:'sub'},'Reserve history is temporarily unavailable. Your current holdings are shown above.'));return}try{clear($('#personal-chart')).append(positionChart(basketHistory(mine,h,d.generated_at),d.generated_at,undefined,mine.length))}catch(e){console.error('Reserve chart could not render',e.name);clear($('#personal-chart')).append(box('refuse','The reserve chart could not be displayed. Please refresh.'))}})

          for (const v of mine) grid.append(el('a', { class: 'card', href: `/market/?a=${encodeURIComponent(v.asset)}` }, el('div', { class: 'card-art' }, el('img', { src: vaultArt(v.level), alt: '', width: 720, height: 720, loading: 'lazy' })), el('div', { class: 'card-body' }, el('div', { class: 'eyebrow' }, `Level ${LEVEL_NAMES[v.level - 1] || 'not drawn'}`), el('h3', {}, vaultNo(v.no)), el('div', { class: 'val' }, fmtUsd(v.value_usd)), el('p', { class: 'sub' }, 'Estimated reserves held'), el('span', {class:'card-next'},'Inspect · List · Share ↗'))))
          if (!mine.length) collection.append(el('div', { class: 'personal-empty' }, el('img', { src: vaultArt(1), alt: 'Level I design specimen', width: 720, height: 720 }), el('div', {}, el('h3', {}, 'A place for your first vault.'), el('p', {}, 'No live vault is recorded for this wallet yet.'), el('a', { class: 'text-action', href: '/market/' }, 'Explore the register ↗'))))
          else collection.append(grid)
          collection.append(el('p', { class: 'sub' }, stamp))
        } catch (e) { clear(overview).append(box('refuse', e.message), el('button', {class:'btn secondary',type:'button',onclick:()=>location.reload()},'Try again')); collection.append(box('refuse', 'Your vault collection could not be read.')) }
      })(),
      (async () => {
        try {
          const market = await clubRead('market'), ownOrders = market.orders.filter(o => o.is_mine)
          for (const o of ownOrders) orders.append(el('a', { class: 'desk-record', href: `/market/?a=${encodeURIComponent(o.asset)}` }, el('span', { class: 'eyebrow' }, `${o.kind} / ${o.status}`), el('strong', {}, `${fmtToken(o.price_lamports, 9, 9)} SOL`), el('span', {}, 'View vault ↗')))
          if (!ownOrders.length) orders.append(el('p', { class: 'desk-empty' }, 'No standing orders are recorded.'))
          const reasons = { filled: 'This order was filled. The vault and SOL changed hands.', offer_received: 'An offer was received for your vault.', cancelled: 'This order was cancelled.', expired: 'This order expired.', invalid_vault: 'This order was cancelled because the vault no longer met its reviewed terms.', owner_changed: 'This listing was cancelled because ownership changed.', opened: 'This order was cancelled because the vault was opened.', traded: 'This order was cancelled after a vault trade.', self_owned: 'This offer was cancelled because the bidder now owns the vault.' }
          for (const n of market.notices || []) notices.append(el('article', { class: 'desk-record' }, el('p', {}, reasons[n.reason] || 'This order changed.'), el('strong', {}, `${fmtToken(n.price_lamports, 9, 9)} SOL`), el('p', { class: 'sub' }, new Date(n.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago' }) + ' Austin time'), el('a', { href: `/market/?a=${encodeURIComponent(n.asset)}` }, 'View vault record ↗')))
          if (!market.notices?.length) notices.append(el('p', { class: 'desk-empty' }, 'No order notices are recorded.'))
          try {
            const response = await fetch('/data/vaults.json', { cache: 'no-store' })
            if (!response.ok) throw Error('The vault register is temporarily unavailable.')
            const register = await response.json()
            if (!validObservation(register)) throw Error('The vault register is unavailable.')
            const mine = new Set(position(register, s.wallet).vaults.map(v => v.asset))
            const received = market.orders.filter(o => o.kind === 'offer' && !o.is_mine && o.status === 'active' && o.funded === true && mine.has(o.asset))
            offers.append(el('p', {}, 'Offers do not reserve the buyer’s SOL. Ownership, reserves and payment are checked again before you approve a sale. The public register can lag recent transfers.'))
            for (const o of received) {
              const row = el('article', { class: 'desk-record' }, el('strong', {}, `${fmtToken(o.price_lamports, 9, 9)} SOL`), el('a', { href: `/market/?a=${encodeURIComponent(o.asset)}` }, 'View vault record ↗'))
              if (s.tradingEnabled === true && market.tradingEnabled === true) {
                const review = el('div', { class: 'action-review' })
                row.append(action('Review offer', () => reviewAction(review, 'accept_offer', { id: o.id }), { out: review }), review)
              } else row.append(el('p', {}, 'Trading is not open yet.'))
              offers.append(row)
            }
            if (!received.length) offers.append(el('p', { class: 'desk-empty' }, 'No funded offers are shown for your recorded vaults.'))
          } catch { offers.append(box('note', 'Offers received cannot be matched to your vaults right now. Refresh the desk shortly.')) }

          for (const i of market.intents) {
            const row = el('div', { class: 'desk-record' }, el('span', { class: 'eyebrow' }, i.status), el('strong', {}, i.action.replaceAll('_', ' ')))
            if (i.signature) row.append(el('details', {}, el('summary', {}, 'Transaction reference'), el('code', {}, i.signature)))
            if (i.status === 'sending') row.append(action('Check confirmation', async () => { const r = await clubRequest('status', { id: i.id }); row.append(el('p', {}, r.status)) }, { out: row }))
            history.append(row)
          }
          if (!market.intents.length) history.append(el('p', { class: 'desk-empty' }, 'The file is open. The first entry is still to come.'))
        } catch (e) { orders.append(box('refuse', e.message)); history.append(box('refuse', 'Your recent actions could not be read.')); offers.append(box('refuse', 'Your offers could not be read.')); notices.append(box('refuse', 'Your order notices could not be read.')) }
      })()
    ])
    $('#account-status').textContent = 'Account sections loaded. Any unavailable records are marked.'
  } catch (e) { out.append(box('refuse', e.message)) }
}
boot()
