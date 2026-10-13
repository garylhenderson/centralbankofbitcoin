import { el, clear, amount } from './ui.mjs'

const unavailable = () => ({ state: 'unavailable', title: 'Sale-round record unavailable', detail: 'Please refresh shortly. No price or remaining count is being assumed.' })
const time = t => new Date(t * 1000).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) + ' Austin time'
export function saleRound(d, now = Date.now() / 1000) {
  if (!d || !Number.isSafeInteger(d.generated_at) || d.generated_at > now + 30 || now - d.generated_at > 1800 || typeof d.initialization_observed !== 'boolean' || Boolean(d.collection) !== d.initialization_observed) return unavailable()
  if (!d.initialization_observed) return d.sale_round === null ? { state: 'waiting', title: 'The first round is still ahead.', detail: 'The Bank has not been initialized. A sale round needs a holder vote after the charter window.' } : unavailable()
  const r = d.sale_round
  if (!r || ['id', 'cap', 'minted', 'minted_total', 'max_supply', 'level_supply', 'opens_at', 'closes_at'].some(k => !Number.isSafeInteger(r[k]) || r[k] < 0) || typeof r.stopped !== 'boolean' || !/^(0|[1-9]\d*)$/.test(r.price_sats) || BigInt(r.price_sats) > 18446744073709551615n || r.minted > r.cap || r.minted > r.minted_total || r.minted_total > r.max_supply || r.minted_total > r.level_supply || r.level_supply > r.max_supply || r.max_supply < 1) return unavailable()
  if (r.id === 0) return { state: 'unvoted', title: 'The holders set the next round.', detail: 'No sale round has been voted into effect. Follow proposals for its price, size and dates.' }
  if (!r.cap || BigInt(r.price_sats) < 21000n || !r.opens_at || r.closes_at <= r.opens_at || !Number.isFinite(new Date(r.closes_at * 1000).getTime())) return unavailable()
  const remaining = Math.max(0, Math.min(r.cap - r.minted, r.max_supply - r.minted_total, r.level_supply - r.minted_total))
  const state = r.stopped ? 'paused' : now >= r.closes_at ? 'closed' : now < r.opens_at ? 'scheduled' : remaining === 0 ? 'sold_out' : 'open'
  const titles = { paused: 'Issuance is paused.', closed: 'This round has closed.', sold_out: 'This round is sold out.', scheduled: 'The next round is on the record.', open: 'This round is open.' }
  return { state, title: titles[state], detail: `${state === 'paused' ? 'Only a holder vote can restart sales. ' : ''}Opens ${time(r.opens_at)}. Closes ${time(r.closes_at)}.`, round: r, remaining, observed: d.generated_at }
}
export async function mountSaleRound() {
  const out = document.getElementById('sale-round')
  if (!out) return
  let data = null
  const draw = () => {
    let s
    try { s = saleRound(data) } catch { s = unavailable() }
    clear(out).append(el('p', { class: 'eyebrow' }, 'Primary issuance / The holder-approved round'), el('h2', {}, s.title), el('p', {}, s.detail))
    if (s.round) {
      const r = s.round
      out.append(el('div', { class: 'position-metrics' }, ...[
        ['Round', `#${r.id}`], ['Minted this round', `${r.minted} of ${r.cap}`], ['Remaining capacity', String(s.remaining)], ['Price per vault', `${amount(r.price_sats, 8)} cbBTC`]
      ].map(([label, value]) => el('div', {}, el('p', { class: 'eyebrow' }, label), el('strong', {}, value)))),
      el('progress', { max: r.cap, value: r.minted, 'aria-label': `${r.minted} of ${r.cap} vaults minted in this round` }),
      el('p', { class: 'sub' }, `Observed ${time(s.observed)}. Counts can lag about 10 minutes; your purchase is checked against the chain. Remaining capacity is not an offer to buy outside an open round.`))
    }
    out.append(el('a', { class: 'text-action', href: '/governance/' }, 'Follow the vote ↗'))
  }
  const refresh = async () => { try { const r = await fetch('/data/vaults.json', { cache: 'no-store' }); if (r.ok) data = await r.json() } catch {} draw() }
  await refresh(); setInterval(refresh, 60000)
}
