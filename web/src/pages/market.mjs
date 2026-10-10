import { tradePanel } from '../lib/club-actions.mjs'
/**
 * /market/ : THE VAULT MARKET (Gary 2026-10-10). Read-only: it never asks a wallet to
 * sign. "Connect Phantom" only reads the connected address, to show that wallet's vaults.
 *
 * Reads the public index the box writes every ten minutes (bank/vault-index.mjs):
 * /data/vaults.json and /data/history.json. Every action links to the page that already
 * does it (look up, open) with that vault filled in.
 */
import { activeProfile } from '../config.js'
import { connectWallet } from '../lib/wallet.mjs'
import { $, el, clear, addr } from '../lib/ui.mjs'
import { chairmanStatement, historyWindow, validAsset, vaultLink } from '../lib/ecosystem.mjs'
import { readClubSession, signInLink } from '../lib/club.mjs'
import { LEVEL_NAMES, STATUS_LABEL, SORTS, selectVaults, sortVaults, fmtUsd, fmtPct, fmtToken, vaultNo, sparkPath, changePct, countdown } from '../lib/market-view.mjs'

const P = activeProfile()
const RES = [['cbBTC', 8, '₿'], ['GARY', 9, '$GARY'], ['GIRAFFISH', 6, '$GIRAFFISH']]
const state = { data: null, history: null, f: { tab: 'all', owner: '', levels: [], statuses: [], q: '' }, sort: 'value', shown: 60 }
const img = level => level ? `/vaults/level-${level}.jpg` : '/seal.png'
const SVG = 'http://www.w3.org/2000/svg'

function countUp(node, to, fmt) {
  if (to === null || to === undefined) { node.textContent = fmt(to); return }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { node.textContent = fmt(to); return }
  const from = Number(node.dataset.v || 0), t0 = performance.now(), dur = 700
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3; node.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step) }
  node.dataset.v = String(to); requestAnimationFrame(step)
}

function chart(points, label) {
  const out = el('figure', { class: 'bank-chart' }), controls = el('div', { class: 'row', role: 'group', 'aria-label': 'Chart period' }), plot = el('div', {})
  const draw = days => {
    clear(plot)
    for (const b of controls.children) b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days))
    const pts = historyWindow(points, days), d = sparkPath(pts, 600, 150)
    if (!d) { plot.append(el('p', {}, 'History appears after two observations.')); return }
    const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 600 150'); s.setAttribute('role', 'img'); s.setAttribute('aria-label', label)
    const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p)
    plot.append(s, el('p', { class: 'sub' }, `${new Date(pts[0][0] * 1000).toLocaleDateString('en-US')}: ${fmtUsd(pts[0][1])} · Latest: ${fmtUsd(pts.at(-1)[1])}`))
    const records = el('details', {}, el('summary', {}, 'Read the observations')), table = el('table', { class: 'res' })
    for (const [t, value] of pts.slice(-100).reverse()) table.append(el('tr', {}, el('td', {}, new Date(t * 1000).toLocaleString('en-US')), el('td', {}, fmtUsd(value))))
    records.append(table); plot.append(records)
  }
  for (const days of [7, 30, 90, 365]) controls.append(el('button', { class: 'chip', type: 'button', 'data-days': days, onclick: () => draw(days) }, `${days} days`))
  out.append(el('figcaption', {}, label), controls, plot); draw(30); return out
}

function renderBank() {
  const d = state.data, b = d.bank, out = clear($('#bank'))
  $('#chairman-text').textContent = chairmanStatement(d)
  const age = Date.now() / 1000 - d.generated_at
  $('#freshness').textContent = `${age > 1800 ? 'Delayed return. ' : ''}Last read ${new Date(d.generated_at * 1000).toLocaleString('en-US', { timeZone: 'America/Chicago', timeZoneName: 'short' })}. Values are estimates. cbBTC uses BTC/USD; other tokens use the latest available warehouse quote, whose age is not reported.`
  if (!b) return
  out.append(el('h2', {}, 'The Bank in figures'))
  const table = el('table', { class: 'res' }, el('caption', {}, 'Reserves held in live vaults'), el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Token'), el('th', { scope: 'col' }, 'Held'), el('th', { scope: 'col' }, 'Estimated USD')))), body = el('tbody', {})
  for (const [sym, decimals, label] of RES) {
    const raw = b.held[sym], value = BigInt(raw) === 0n ? 0 : d.prices[sym] === null ? null : Number(raw) / 10 ** decimals * d.prices[sym]
    body.append(el('tr', {}, el('td', {}, label), el('td', {}, fmtToken(raw, decimals, decimals)), el('td', {}, fmtUsd(value))))
  }
  table.append(body); out.append(table)
  const facts = el('dl', { class: 'facts' })
  for (const [label, raw] of [['Payout pool', b.pool_sats], ['Credited and owed', b.owed_sats], ['Available for future allocation', b.available_sats]]) facts.append(el('dt', {}, label), el('dd', {}, raw === null ? 'Not initialized or unavailable' : `${fmtToken(raw, 8, 8)} cbBTC`))
  facts.append(el('dt', {}, 'Vaults earning / joining'), el('dd', {}, `${b.active} / ${b.joining}`), el('dt', {}, 'Retired outside redemption'), el('dd', {}, String(b.bare_burns)),
    el('dt', {}, 'Released reserves'), el('dd', {}, b.released ? RES.map(([sym, decimals, label]) => `${fmtToken(b.released[sym], decimals, decimals)} ${label}`).join(' · ') : 'Opening history is incomplete; no total is asserted.'))
  if (b.stranded) facts.append(el('dt', {}, 'Reserves remaining at retired vault addresses'), el('dd', {}, RES.map(([sym, decimals, label]) => `${fmtToken(b.stranded[sym], decimals, decimals)} ${label}`).join(' · ')))
  const fin = b.financial
  for (const [label, key, decimals, symbol] of [['Gross revenue split', 'revenue_sats', 8, 'cbBTC'], ['Allocated to payouts', 'distributed_sats', 8, 'cbBTC'], ['Payouts delivered into vaults', 'paid_sats', 8, 'cbBTC'], ['Royalty revenue swept', 'swept_lamports', 9, 'SOL']]) facts.append(el('dt', {}, label), el('dd', {}, fin?.coverage === 'complete' ? `${fmtToken(fin[key], decimals, decimals)} ${symbol}` : 'History is being reconciled; no total is asserted.'))
  out.append(facts, chart((state.history?.hourly || []).filter(r => r.value_usd !== null).map(r => [r.t, r.value_usd]), 'Value held across live vaults'),
    el('p', { class: 'sub' }, 'Value changes include deposits, token price changes, payouts and openings. They are not an investment return. The payout pool is separate from reserves already held inside vaults.'))
}

function spark(points) {
  const d = sparkPath(points, 120, 32)
  if (!d) return null
  const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 120 32'); s.setAttribute('class', 'spark'); s.setAttribute('aria-hidden', 'true')
  const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d)
  const up = points[points.length - 1][1] >= points[0][1]; p.setAttribute('class', up ? 'up' : 'down')
  s.append(p); return s
}

function renderStats() {
  const d = state.data, box = clear($('#stats'))
  const cell = (label, node) => el('div', { class: 'stat' }, el('div', { class: 'k' }, label), node)
  const total = el('div', { class: 'v big' }), live = el('div', { class: 'v' }), opened = el('div', { class: 'v' })
  box.append(cell('Held in live vaults', total), cell('Live vaults', live), cell('Retired', opened),
    cell('Bitcoin', el('div', { class: 'v' }, fmtUsd(d.prices.cbBTC))), cell('$GARY', el('div', { class: 'v' }, d.prices.GARY ? `$${d.prices.GARY.toPrecision(3)}` : 'unavailable')),
    cell('$GIRAFFISH', el('div', { class: 'v' }, d.prices.GIRAFFISH ? `$${d.prices.GIRAFFISH.toPrecision(3)}` : 'unavailable')))
  countUp(total, d.totals.value_usd, fmtUsd); countUp(live, d.totals.live, n => Math.round(n).toLocaleString('en-US')); countUp(opened, d.totals.opened, n => Math.round(n).toLocaleString('en-US'))
}

function renderLevels() {
  const d = state.data, box = clear($('#levels'))
  const now = Math.floor(Date.now() / 1000)
  if (!d.open) {
    const cd = countdown(d.charter_opens_at, now)
    box.append(el('div', { class: 'soon' }, el('h2', {}, cd ? `The charter opens in ${cd}` : 'The vaults open soon'),
      el('p', {}, 'The first vaults are claimed with a Proof of Burn during the seven-day charter window, then sold in rounds. Newly issued vaults appear with the next register update.')))
  }
  for (const l of d.levels) {
    const pct = l.cap ? Math.round(l.minted / l.cap * 100) : 0
    const bar = el('div', { class: 'fill' }); bar.style.width = `${pct}%`
    box.append(el('button', { class: `lvl${state.f.levels.includes(l.level) ? ' on' : ''}`, type: 'button', title: `Show only Level ${LEVEL_NAMES[l.level - 1]}` ,
      onclick: () => toggle(state.f.levels, l.level) },
      el('img', { src: img(l.level), alt: `Level ${LEVEL_NAMES[l.level - 1]}`, loading: 'lazy', width: 160, height: 160 }),
      el('div', { class: 'lvl-name' }, `Level ${LEVEL_NAMES[l.level - 1]}`),
      el('div', { class: 'lvl-n' }, `${l.minted.toLocaleString('en-US')} of ${l.cap.toLocaleString('en-US')} minted`),
      el('div', { class: 'meter' }, bar)))
  }
}

function toggle(list, v) { const i = list.indexOf(v); i < 0 ? list.push(v) : list.splice(i, 1); state.shown = 60; render() }

function renderFilters() {
  const lc = clear($('#level-chips')), sc = clear($('#status-chips'))
  LEVEL_NAMES.forEach((n, i) => lc.append(el('button', { class: `chip${state.f.levels.includes(i + 1) ? ' on' : ''}`, type: 'button', onclick: () => toggle(state.f.levels, i + 1) }, `Level ${n}`)))
  for (const [k, label] of [['earning', 'Earning'], ['joining', 'Joining'], ['sealed', 'Sealed'], ['unrevealed', 'Not drawn yet'], ['boosted', 'Boosted']])
    sc.append(el('button', { class: `chip${state.f.statuses.includes(k) ? ' on' : ''}`, type: 'button', onclick: () => toggle(state.f.statuses, k) }, label))
  $('#status-chips').hidden = state.f.tab === 'opened'
  $('#sort').hidden = state.f.tab === 'opened'   // opened vaults list newest first
}

function card(v) {
  const mine = state.f.owner && v.owner === state.f.owner
  const pts = state.history?.daily?.[v.asset]
  const head = el('div', { class: 'card-art' }, el('img', { src: img(v.level), alt: '', loading: 'lazy', width: 240, height: 240 }),
    el('span', { class: 'badge' }, v.level ? LEVEL_NAMES[v.level - 1] : '?'), v.boost ? el('span', { class: 'boost', title: `Boosted until payout ${v.boost.until_epoch}` }, '★ Boosted') : null)
  const body = el('div', { class: 'card-body' },
    el('div', { class: 'card-top' }, el('span', { class: 'no' }, vaultNo(v.no)), el('span', { class: `st st-${v.status}` }, STATUS_LABEL[v.status] || v.status)))
  if (v.status === 'opened' && v.opened) {
    const o = v.opened, cls = o.delta_usd === null ? '' : o.delta_usd >= 0 ? 'up' : 'down'
    body.append(el('div', { class: 'val' }, o.coverage === 'bare_burn' ? 'Burned' : fmtUsd(o.value_at_open_usd)), el('div', { class: 'sub' }, o.coverage === 'bare_burn' ? 'Retired outside redemption; no payout' : 'Released tokens, estimated opening value'),
      el('div', { class: `waited ${cls}` }, o.delta_usd === null ? 'Had they waited: price unavailable' : `Had they waited: ${o.delta_usd >= 0 ? '+' : '-'}${fmtUsd(Math.abs(o.delta_usd))} (${fmtPct(o.delta_pct)})`))
  } else {
    const ch = changePct(pts, 30)
    body.append(el('div', { class: 'val' }, fmtUsd(v.value_usd)),
      el('div', { class: 'sub' }, RES.filter(([s]) => BigInt(v.reserves?.[s] ?? 0) > 0n).map(([s, d, u]) => `${fmtToken(v.reserves[s], d, s === 'cbBTC' ? 6 : 0)} ${u}`).join(' · ') || 'Empty, waiting for its first deposit'))
    const sp = spark(pts); if (sp) body.append(el('div', { class: 'trend' }, sp, ch !== null ? el('span', { class: ch >= 0 ? 'up' : 'down' }, `${fmtPct(ch)} 30d`) : null))
  }
  if (mine) body.append(el('div', { class: 'yours' }, 'Yours'))
  return el('button', { class: `card${mine ? ' mine' : ''}`, type: 'button', onclick: () => detail(v), 'aria-label': `${vaultNo(v.no)}, Level ${v.level ? LEVEL_NAMES[v.level - 1] : 'not drawn yet'}` }, head, body)
}

function detail(v) {
  const dlg = clear($('#detail'))
  if (validAsset(v.asset)) history.replaceState(null, '', vaultLink(v.asset))
  const rows = RES.map(([s, d, u]) => el('tr', {}, el('td', {}, s === 'cbBTC' ? 'cbBTC' : u), el('td', {}, v.status === 'opened' && (!v.opened || v.opened.coverage === 'unavailable') ? 'Unavailable' : fmtToken((v.status === 'opened' ? v.opened?.paid : v.reserves)?.[s] ?? 0, d, s === 'cbBTC' ? 8 : 2))))
  const mine = state.f.owner && v.owner === state.f.owner
  dlg.append(
    el('div', { class: 'detail-head' }, el('img', { src: img(v.level), alt: '', width: 120, height: 120 }),
      el('div', {}, el('h2', {}, vaultNo(v.no)), el('p', {}, `Level ${v.level ? LEVEL_NAMES[v.level - 1] : 'not drawn yet'} · ${STATUS_LABEL[v.status] || v.status}${v.charter ? ' · Charter vault' : ''}`))),
    el('h3', {}, v.status === 'opened' ? 'Paid out when opened' : 'Holds'), el('table', { class: 'res' }, ...rows),
    v.opened?.coverage === 'bare_burn' ? el('p', {}, 'This vault was burned outside redemption. No reserve payout is attributed to that burn.') : v.status === 'opened' && v.opened ? el('p', {}, `Worth ${fmtUsd(v.opened.value_at_open_usd)} when opened; the same tokens are worth ${fmtUsd(v.opened.value_now_usd)} today (${fmtPct(v.opened.delta_pct) || 'no change data'}).`)
      : el('p', {}, `Worth ${fmtUsd(v.value_usd)} today.${BigInt(v.owed_sats ?? 0) > 0n ? ` It is also owed ${Number(v.owed_sats).toLocaleString('en-US')} sats of cbBTC from the payout pool.` : ''}`),
    el('h3', {}, 'Addresses'), el('div', { class: 'kv' }, el('span', {}, 'Vault'), addr(v.asset)),
    v.status !== 'opened' ? el('div', { class: 'kv' }, el('span', {}, 'Deposit address'), addr(v.deposit)) : null,
    v.owner ? el('div', { class: 'kv' }, el('span', {}, 'Owner'), addr(v.owner)) : null,
    el('div', { class: 'row' },
      el('a', { class: 'btn', href: `../vault/?a=${encodeURIComponent(v.asset)}` }, 'Look it up on chain'),
      el('a', { class: 'btn secondary', href: vaultLink(v.asset) }, 'Permanent link'),
      mine && v.status !== 'opened' ? el('a', { class: 'btn secondary', href: `../redeem/?a=${encodeURIComponent(v.asset)}` }, 'Open this vault') : null,
      el('button', { class: 'btn secondary', type: 'button', onclick: () => dlg.close() }, 'Close')))
  if (v.status !== 'opened') dlg.append(chart((state.history?.daily?.[v.asset] || []).map(([day, val]) => [day * 86400, val]), 'Reserve value over time'))
  else dlg.append(el('p', { class: 'sub' }, 'The comparison reprices the tokens released. It excludes later deposits and payouts the vault might have earned. The opening estimate uses the last hourly price observation at or before the transaction, no more than one hour old. Without that observation, the comparison is unavailable.'))
  if (v.status !== 'opened') dlg.append(tradePanel(v))
  if (!dlg.open) dlg.showModal()
}

function render() {
  if (!state.data) return
  renderFilters()
  for (const b of document.querySelectorAll('#tabs .tab')) { const on = b.dataset.tab === state.f.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)) }
  $('#mine-bar').hidden = state.f.tab !== 'mine'
  const list = sortVaults(selectVaults(state.data.vaults, state.f, state.history), state.f.tab === 'opened' ? 'newest' : state.sort)
  const grid = clear($('#grid'))
  $('#count').textContent = !state.data.open ? '' : state.f.tab === 'mine' && !state.f.owner ? 'Connect Phantom or paste your address to see your vaults.'
    : `${list.length.toLocaleString('en-US')} ${list.length === 1 ? 'vault' : 'vaults'}`
  for (const v of list.slice(0, state.shown)) grid.append(card(v))
  if (list.length > state.shown) grid.append(el('button', { class: 'btn secondary more', type: 'button', onclick: () => { state.shown += 60; render() } }, `Show more (${(list.length - state.shown).toLocaleString('en-US')} left)`))
  if (!list.length && state.data.open && !(state.f.tab === 'mine' && !state.f.owner)) grid.append(el('p', { class: 'empty' }, state.f.tab === 'opened' ? 'No vault has been opened or retired yet.' : 'No vault matches these filters.'))
}

async function load() {
  try {
    const [d, h] = await Promise.all([fetch('/data/vaults.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null), fetch('/data/history.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)])
    if (!d) throw new Error('the vault index is not published yet')
    state.data = d; state.history = h
    renderStats(); renderLevels(); renderBank(); render()
    const target = new URLSearchParams(location.search).get('a')
    if (target && !$('#detail').open) {
      const v = d.vaults.find(x => x.asset === target)
      if (v) detail(v)
      else $('#count').textContent = 'That vault is not in the latest register.'
    }
  } catch (e) { clear($('#grid')).append(el('p', { class: 'empty' }, `The vault index could not be read just now (${e.message}). It refreshes every ten minutes.`)) }
}

function boot() {
  if (new URLSearchParams(location.search).has('mine')) state.f.tab = 'mine'
  $('#detail').addEventListener('close', () => history.replaceState(null, '', '/market/'))
  readClubSession().then(s => {
    if (!s) return
    state.f.owner = s.wallet; $('#owner').value = s.wallet
    $('#account-link').textContent = 'Your Gary Club wallet'; $('#account-link').href = '/account/'
    render()
  }).catch(() => { $('#account-link').textContent = 'Account access unavailable'; $('#account-link').href = '/account/' })
  $('#account-link').href = signInLink('/market/')
  const sel = $('#sort'); for (const [k, s] of Object.entries(SORTS)) sel.append(el('option', { value: k }, s.label))
  sel.addEventListener('change', () => { state.sort = sel.value; render() })
  $('#q').addEventListener('input', e => { state.f.q = e.target.value; state.shown = 60; render() })
  for (const b of document.querySelectorAll('#tabs .tab')) b.addEventListener('click', () => { state.f.tab = b.dataset.tab; state.shown = 60; render() })
  $('#owner').addEventListener('input', e => { state.f.owner = e.target.value.trim(); render() })
  $('#connect').addEventListener('click', async () => {
    try { const w = await connectWallet(P); state.f.owner = w.publicKey.toBase58(); $('#owner').value = state.f.owner; render() }
    catch (e) { $('#count').textContent = String(e?.message || e) }
  })
  load(); setInterval(load, 120_000)
}
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot()
