import { position, reserveValues, validObservation, basketHistory } from '../lib/position.mjs'
import { reserveMix, metric, wayfinder } from '../lib/position-view.mjs'
import { showcase, weightIllustration, vaultArt, shareLink, shareVault, downloadVaultCard, downloadBankCard, notice } from '../lib/exhibition.mjs'
import { tradePanel } from '../lib/club-actions.mjs'
/** Public vault register. Trading uses the existing reviewed Gary Club panel.
 * Read-only browsing, saved vaults, illustrations and exports never authorize a trade. */
import { activeProfile } from '../config.js'
import { connectWallet } from '../lib/wallet.mjs'
import { $, el, clear, addr } from '../lib/ui.mjs'
import { chairmanStatement, historyWindow, validAsset, vaultLink } from '../lib/ecosystem.mjs'
import { readClubSession, signInLink } from '../lib/club.mjs'
import { LEVEL_NAMES, STATUS_LABEL, SORTS, selectVaults, sortVaults, fmtUsd, fmtPct, fmtToken, vaultNo, sparkPath, changePct } from '../lib/market-view.mjs'

const P = activeProfile()
const RES = [['cbBTC', 8, '₿'], ['GARY', 9, '$GARY'], ['GIRAFFISH', 6, '$GIRAFFISH']]
const state = { data: null, history: null, f: { tab: 'all', owner: '', levels: [], statuses: [], q: '' }, sort: 'value', shown: 60, sessionWallet: '', ownerTouched: false, chartDays: {}, chartAt: {} }
const img = vaultArt
let sessionReady = Promise.resolve()
let saved = []
try { saved = JSON.parse(localStorage.getItem('cbob-saved-vaults') || '[]').filter(validAsset).slice(0, 500) } catch {}
const save = asset => { saved = saved.includes(asset) ? saved.filter(x => x !== asset) : [...saved, asset].slice(-500); try { localStorage.setItem('cbob-saved-vaults', JSON.stringify(saved)) } catch { notice('Saved for this visit. Browser storage is unavailable.') } }
const SVG = 'http://www.w3.org/2000/svg'

function preserveView(fn) {
  const active = document.activeElement, id = active?.id, key = active?.dataset.focus
  const expanded = [...document.querySelectorAll('details[id][open]')].map(n => n.id)
  fn()
  for (const id of expanded) { const n = document.getElementById(id); if (n) n.open = true }
  if (!active?.isConnected) {
    const target = id ? document.getElementById(id) : key ? [...document.querySelectorAll('[data-focus]')].find(n => n.dataset.focus === key) : null
    target?.focus({ preventScroll: true })
  }
}
function showFreshness(failed = false) {
  preserveView(renderMemberBrief)
  const d = state.data, stale = d && Date.now() / 1000 - d.generated_at > 1800, n = $('#data-status')
  const text = !d ? 'The register is temporarily unavailable. The vault designs remain open to inspection.' : `${failed ? 'Refresh unavailable. Showing the last recorded return. ' : stale ? 'Delayed return. ' : ''}Observed ${new Date(d.generated_at * 1000).toLocaleString('en-US', { timeZone: 'America/Chicago', timeZoneName: 'short' })}. Reserve values are estimates.`
  if (n.textContent !== text) n.textContent = text
  n.classList.toggle('data-delayed', failed || !!stale || !d)
  if (d) { $('#chairman-text').textContent = chairmanStatement(d); $('#freshness').textContent = `${text} cbBTC uses BTC/USD; other tokens use the latest available warehouse quote, whose age is not reported.`; if (failed || stale) $('#register-note').textContent = 'The last recorded register is shown. See the update notice above.' }
}


function chart(points, label, key = label, daily = false) {
  const stamp = t => daily ? `${new Date(t*1000).toLocaleDateString('en-US',{timeZone:'UTC'})} (UTC day)` : new Date(t*1000).toLocaleString('en-US',{timeZone:'America/Chicago',timeZoneName:'short'})
  const out = el('figure', { class: 'bank-chart' }), controls = el('div', { class: 'row', role: 'group', 'aria-label': 'Chart period' }), plot = el('div', {})
  const draw = days => {
    state.chartDays[key] = days
    clear(plot)
    for (const b of controls.children) b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days))
    const pts = historyWindow(points, days), d = sparkPath(pts, 600, 150)
    if (!d) { plot.append(el('div', { class: 'chart-empty' }, el('span', {}, 'THE FIRST LINE IS STILL TO BE WRITTEN.'), el('p', {}, state.history ? 'The chart begins after two recorded observations.' : 'History is temporarily unavailable.'))); return }
    const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 600 150'); s.setAttribute('role', 'img'); s.setAttribute('aria-label', label)
    const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p)
    const readout = el('output', { class: 'chart-readout' }), slider = el('input', { type: 'range', min: 0, max: pts.length - 1, value: pts.length - 1, 'aria-label': 'Inspect recorded value', 'data-focus': `chart-${label}` })
    if (state.chartAt[key]) { const index = pts.findIndex(p => p[0] >= state.chartAt[key]); if (index >= 0) slider.value = index }
    const inspect = () => { const point = pts[Number(slider.value)]; readout.textContent = `${stamp(point[0])}: ${fmtUsd(point[1])}`; slider.setAttribute('aria-valuetext',readout.textContent) }
    slider.addEventListener('input', () => { state.chartAt[key] = pts[Number(slider.value)][0]; inspect() }); inspect(); plot.append(readout)
    plot.append(s, el('p', { class: 'sub' }, `${stamp(pts[0][0])}: ${fmtUsd(pts[0][1])} · Latest: ${fmtUsd(pts.at(-1)[1])}`))
    const records = el('details', { id: `observations-${label.replaceAll(' ', '-')}` }, el('summary', { 'data-focus': `records-${label}` }, 'Read the observations')), table = el('table', { class: 'res' })
    for (const [t, value] of pts.slice(-100).reverse()) table.append(el('tr', {}, el('td', {}, stamp(t)), el('td', {}, fmtUsd(value))))
    records.append(table); plot.append(slider, records)
  }
  for (const days of [7, 30, 90, 365]) controls.append(el('button', { class: 'chip', type: 'button', 'data-days': days, 'data-focus': `period-${label}-${days}`, onclick: () => draw(days) }, `${days} days`))
  out.append(el('figcaption', {}, label), controls, plot); draw(state.chartDays[key] || 30); return out
}

function renderBank() {
  const d = state.data, b = d.bank, out = clear($('#bank'))
  $('#chairman-text').textContent = chairmanStatement(d)
  const age = Date.now() / 1000 - d.generated_at
  $('#freshness').textContent = `${age > 1800 ? 'Delayed return. ' : ''}Last read ${new Date(d.generated_at * 1000).toLocaleString('en-US', { timeZone: 'America/Chicago', timeZoneName: 'short' })}. Values are estimates. cbBTC uses BTC/USD; other tokens use the latest available warehouse quote, whose age is not reported.`
  if (!b) return
  out.append(el('div', { class: 'bank-overview' }, el('div', {}, el('div', { class: 'eyebrow' }, 'Held inside live vaults'), el('div', { class: 'bank-total' }, fmtUsd(d.totals.value_usd)), el('p', { class: 'sub' }, 'Estimated reserve value. Not a sale price.')), el('div', {}, el('div', { class: 'eyebrow' }, 'Issued / live / retired'), el('div', { class: 'bank-census' }, `${d.totals.minted} / ${d.totals.live} / ${d.totals.opened}`))))
  const table = el('table', { class: 'res' }, el('caption', {}, 'Reserves held in live vaults'), el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Token'), el('th', { scope: 'col' }, 'Held'), el('th', { scope: 'col' }, 'Estimated USD')))), body = el('tbody', {})
  for (const [sym, decimals, label] of RES) {
    const raw = b.held[sym], value = reserveValues(b.held,d.prices).find(r=>r.symbol===sym).value
    body.append(el('tr', {}, el('td', {}, label), el('td', {}, fmtToken(raw, decimals, decimals)), el('td', {}, fmtUsd(value))))
  }
  table.append(body); out.append(el('div',{class:'bank-analysis'},reserveMix(b.held,d.prices),chart((state.history?.hourly || []).filter(r=>Number.isFinite(r.value_usd)).map(r=>[r.t,r.value_usd]),'Value held across live vaults')))
  const rawReserves = el('details',{class:'accounting-detail',id:'raw-reserves'},el('summary',{},'Read exact reserve balances'),table);out.append(rawReserves)
  const facts = el('dl', { class: 'facts' })
  for (const [label, raw] of [['Payout pool', b.pool_sats], ['Credited and owed', b.owed_sats], ['Available for future allocation', b.available_sats]]) facts.append(el('dt', {}, label), el('dd', {}, raw === null ? 'Not initialized or unavailable' : `${fmtToken(raw, 8, 8)} cbBTC`))
  facts.append(el('dt', {}, 'Vaults earning / joining'), el('dd', {}, `${b.active} / ${b.joining}`), el('dt', {}, 'Retired outside redemption'), el('dd', {}, String(b.bare_burns)),
    el('dt', {}, 'Released reserves'), el('dd', {}, b.released ? RES.map(([sym, decimals, label]) => `${fmtToken(b.released[sym], decimals, decimals)} ${label}`).join(' · ') : 'Opening history is incomplete; no total is asserted.'))
  if (b.stranded) facts.append(el('dt', {}, 'Reserves remaining at retired vault addresses'), el('dd', {}, RES.map(([sym, decimals, label]) => `${fmtToken(b.stranded[sym], decimals, decimals)} ${label}`).join(' · ')))
  const fin = b.financial
  for (const [label, key, decimals, symbol] of [['Gross revenue split', 'revenue_sats', 8, 'cbBTC'], ['Allocated to payouts', 'distributed_sats', 8, 'cbBTC'], ['Payouts delivered into vaults', 'paid_sats', 8, 'cbBTC'], ['Royalty revenue swept', 'swept_lamports', 9, 'SOL']]) facts.append(el('dt', {}, label), el('dd', {}, fin?.coverage === 'complete' ? `${fmtToken(fin[key], decimals, decimals)} ${symbol}` : 'History is being reconciled; no total is asserted.'))
  const ledger = el('details', { class: 'accounting-detail', id: 'accounting-detail' }, el('summary', { 'data-focus': 'accounting-summary' }, 'Follow the money: payouts, revenue & retired reserves'), facts)
  out.append(el('div',{class:'bank-flow'},metric('Delivered into vaults',fin?.coverage==='complete'?`${fmtToken(fin.paid_sats,8,8)} cbBTC`:'Unavailable','Cumulative Bank payouts'),metric('Credited & owed',b.owed_sats===null?'Not initialized':`${fmtToken(b.owed_sats,8,8)} cbBTC`,'Still in the payout pool'),metric('Awaiting allocation',b.available_sats===null?'Not initialized':`${fmtToken(b.available_sats,8,8)} cbBTC`,'Available in the payout pool')),ledger,
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

function renderMemberBrief() {
  const out=clear($('#member-brief'))
  if(!state.data || !state.sessionWallet) { out.hidden=true;return }
  out.hidden=false
  const p=position(state.data,state.sessionWallet)
  out.append(el('div',{},el('span',{class:'eyebrow'},`${Date.now()/1000-state.data.generated_at>1800?'DELAYED RETURN / ':''}YOUR GARY CLUB VAULTS`),el('strong',{},fmtUsd(p.value)),el('span',{},`${p.vaults.length} recorded live vault${p.vaults.length===1?'':'s'} · ${p.earning} earning`)),el('span',{class:'sub'},`Observed ${new Date(state.data.generated_at*1000).toLocaleString('en-US',{timeZone:'America/Chicago',timeZoneName:'short'})}`),el('a',{class:'btn',href:'/account/','data-focus':'member-desk'},'Go to your desk ↗'))
}
function renderStats() {
  const d = state.data, box = clear($('#stats'))
  const cell = (label, value, note) => el('div', { class: 'stat' }, el('div', { class: 'k' }, label), el('div', { class: 'v' }, value), el('div', { class: 'stat-note' }, note))
  box.append(cell('Held in live vaults', fmtUsd(d.totals.value_usd), 'Estimated reserve value'), cell('Vaults issued', d.totals.minted.toLocaleString('en-US'), 'Entered in the register'), cell('Live vaults', d.totals.live.toLocaleString('en-US'), 'Reserves still inside'), cell('Opened & retired', d.totals.opened.toLocaleString('en-US'), 'Permanently out of circulation'))
}

function renderLevels() { preserveView(renderLevelsContent) }
function renderLevelsContent() {
  const d = state.data, box = clear($('#levels'))
  $('#register-note').textContent = (Date.now() / 1000 - d.generated_at > 1800 ? 'Delayed return. ' : '') + (!d.collection ? 'Pre-opening. No vaults have been issued yet.' : d.open ? 'Every issued vault. Read directly from the chain.' : 'The next chapter is being prepared.') + ` Observed ${new Date(d.generated_at * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago', timeZoneName: 'short' })}.`
  for (const l of d.levels) {
    const pct = l.cap ? Math.round(l.minted / l.cap * 100) : 0
    const bar = el('div', { class: 'fill' }); bar.style.width = `${Math.min(100, pct)}%`
    box.append(el('button', { class: `lvl${state.f.levels.includes(l.level) ? ' on' : ''}`, type: 'button', 'aria-pressed': String(state.f.levels.includes(l.level)), 'data-focus': `level-${l.level}`, title: `Filter by Level ${LEVEL_NAMES[l.level - 1]}`,
      onclick: () => { toggle(state.f.levels, l.level); renderLevels() } },
      el('div', { class: 'level-topline' }, el('span', {}, `LEVEL ${LEVEL_NAMES[l.level - 1]}`), el('span', {}, `${((l.level + 1) / 2).toFixed(1)}×`)),
      el('img', { src: img(l.level), alt: `Level ${LEVEL_NAMES[l.level - 1]} vault design`, loading: 'lazy', width: 720, height: 720 }),
      el('div', { class: 'lvl-name' }, `Level ${LEVEL_NAMES[l.level - 1]}`),
      el('div', { class: 'lvl-n' }, `${l.minted.toLocaleString('en-US')} / ${l.cap.toLocaleString('en-US')} issued`),
      el('div', { class: 'meter' }, bar), el('span', { class: 'level-inspect' }, 'Inspect the register ↗')))
  }
}

function toggle(list, v) { const i = list.indexOf(v); i < 0 ? list.push(v) : list.splice(i, 1); state.shown = 60; render(); renderLevels() }

function renderFilters() {
  const lc = clear($('#level-chips')), sc = clear($('#status-chips'))
  LEVEL_NAMES.forEach((n, i) => lc.append(el('button', { class: `chip${state.f.levels.includes(i + 1) ? ' on' : ''}`, type: 'button', 'aria-pressed': String(state.f.levels.includes(i + 1)), 'data-focus': `filter-level-${i + 1}`, onclick: () => toggle(state.f.levels, i + 1) }, `Level ${n}`)))
  for (const [k, label] of [['earning', 'Earning'], ['joining', 'Joining'], ['sealed', 'Sealed'], ['unrevealed', 'Not drawn yet'], ['boosted', 'Boosted']])
    sc.append(el('button', { class: `chip${state.f.statuses.includes(k) ? ' on' : ''}`, type: 'button', 'aria-pressed': String(state.f.statuses.includes(k)), 'data-focus': `filter-status-${k}`, onclick: () => toggle(state.f.statuses, k) }, label))
  $('#status-chips').hidden = state.f.tab === 'opened'
  $('#sort').hidden = state.f.tab === 'opened'   // opened vaults list newest first
}

function card(v) {
  const mine = state.sessionWallet && v.owner === state.sessionWallet
  const pts = state.history?.daily?.[v.asset]
  const head = el('div', { class: 'card-art' }, el('img', { src: img(v.level), alt: '', loading: 'lazy', width: 240, height: 240 }),
    el('span', { class: 'badge' }, v.level ? LEVEL_NAMES[v.level - 1] : '?'), v.boost ? el('span', { class: 'boost', title: `Boosted until payout ${v.boost.until_epoch}` }, '★ Boosted') : null)
  const body = el('div', { class: 'card-body' },
    el('div', { class: 'card-top' }, el('span', { class: 'no' }, vaultNo(v.no)), el('span', { class: `st st-${v.status}` }, STATUS_LABEL[v.status] || v.status)))
  if (v.status === 'opened') {
    const o = v.opened || { coverage: 'unavailable', delta_usd: null }, missing = o.coverage === 'unavailable', cls = o.delta_usd === null ? '' : o.delta_usd >= 0 ? 'up' : 'down'
    body.append(el('div', { class: 'val' }, missing ? 'Record unavailable' : o.coverage === 'bare_burn' ? 'Burned' : fmtUsd(o.value_at_open_usd)), el('div', { class: 'sub' }, missing ? 'Opening record has not been reconciled' : o.coverage === 'bare_burn' ? 'Retired outside redemption; no payout' : 'Released tokens, estimated opening value'),
      el('div', { class: `waited ${cls}` }, missing ? 'Repricing unavailable' : o.delta_usd === null ? 'Had they waited: price unavailable' : `Had they waited: ${o.delta_usd >= 0 ? '+' : '-'}${fmtUsd(Math.abs(o.delta_usd))} (${fmtPct(o.delta_pct)})`))
  } else {
    const ch = changePct(pts, 30)
    body.append(el('div', { class: 'val' }, fmtUsd(v.value_usd)),
      el('div', { class: 'sub' }, RES.filter(([s]) => BigInt(v.reserves?.[s] ?? 0) > 0n).map(([s, d, u]) => `${fmtToken(v.reserves[s], d, s === 'cbBTC' ? 6 : 0)} ${u}`).join(' · ') || 'Empty, waiting for its first deposit'))
    const sp = spark(pts); if (sp) body.append(el('div', { class: 'trend' }, sp, ch !== null ? el('span', { class: ch >= 0 ? 'up' : 'down' }, `${fmtPct(ch)} 30d`) : null))
  }
  if (mine) body.append(el('div', { class: 'yours' }, 'Yours'))
  return el('a', { class: `card${mine ? ' mine' : ''}`, href: vaultLink(v.asset), 'data-focus': `vault-${v.asset}`, 'aria-haspopup': 'dialog', onclick: e => { e.preventDefault(); detail(v) } }, head, body)
}

function detail(v) {
  const observedAt = state.data.generated_at
  const dlg = clear($('#detail')); dlg.dataset.returnFocus = document.activeElement?.dataset.focus || `vault-${v.asset}`; dlg.setAttribute('aria-labelledby', 'detail-title')
  const close = el('button', { class: 'dialog-close', type: 'button', 'aria-label': 'Close vault detail', onclick: () => dlg.close() }, '×')
  const saveButton = el('button', { class: 'btn secondary', type: 'button', 'aria-pressed': String(saved.includes(v.asset)), onclick: () => { save(v.asset); saveButton.textContent = saved.includes(v.asset) ? 'Saved ✓' : 'Save this vault'; saveButton.setAttribute('aria-pressed', String(saved.includes(v.asset))); render() } }, saved.includes(v.asset) ? 'Saved ✓' : 'Save this vault')
  dlg.append(close, el('div', { class: 'detail-plate' }, el('img', { src: img(v.level), alt: `Vault ${vaultNo(v.no)}`, width: 720, height: 720 }), el('span', { class: 'plate-caption' }, 'CENTRAL BANK OF BITCOIN / PUBLIC REGISTER')), el('div', { class: 'row detail-share' }, saveButton, el('button', { class: 'btn secondary', type: 'button', onclick: () => shareVault(v) }, 'Share vault ↗'), el('button', { class: 'btn secondary', type: 'button', onclick: async () => { try { await downloadVaultCard(v, observedAt) } catch { notice('The card could not be downloaded. Please try again.') } } }, 'Download vault card ↓')))
  if (validAsset(v.asset)) { const url = new URL(location.href); url.searchParams.set('a', v.asset); history.replaceState(null, '', url.pathname + url.search + url.hash) }
  const rows = RES.map(([s, d, u]) => el('tr', {}, el('td', {}, s === 'cbBTC' ? 'cbBTC' : u), el('td', {}, v.status === 'opened' && (!v.opened || v.opened.coverage === 'unavailable') ? 'Unavailable' : fmtToken((v.status === 'opened' ? v.opened?.paid : v.reserves)?.[s] ?? 0, d, s === 'cbBTC' ? 8 : 2))))
  const mine = state.sessionWallet && v.owner === state.sessionWallet
  dlg.append(
    el('div', { class: 'detail-head' },
      el('div', {}, el('h2', { id: 'detail-title' }, vaultNo(v.no)), el('p', {}, `Level ${v.level ? LEVEL_NAMES[v.level - 1] : 'not drawn yet'} · ${STATUS_LABEL[v.status] || v.status}${v.charter ? ' · Charter vault' : ''}`))),
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
  if (v.status === 'opened' && v.opened?.delta_usd !== null && v.opened?.delta_usd !== undefined) dlg.append(el('section', { class: 'hindsight' }, el('div', { class: 'eyebrow' }, 'Had they waited'), el('h3', {}, `${v.opened.delta_usd >= 0 ? '+' : '-'}${fmtUsd(Math.abs(v.opened.delta_usd))}`), el('p', {}, `The same released tokens, repriced today. ${fmtUsd(v.opened.value_at_open_usd)} then. ${fmtUsd(v.opened.value_now_usd)} now.`)))
  if (v.status !== 'opened') dlg.append(chart(basketHistory([v], state.history, state.data.generated_at), 'Reserve value over time', v.asset, true))
  else dlg.append(el('p', { class: 'sub' }, 'The comparison reprices the tokens released. It excludes later deposits and payouts the vault might have earned. The opening estimate uses the last hourly price observation at or before the transaction, no more than one hour old. Without that observation, the comparison is unavailable.'))
  if (v.status !== 'opened') dlg.append(tradePanel(v))
  if (!dlg.open) dlg.showModal()
}

function render() { preserveView(renderContent) }
function renderContent() {
  if (!state.data) return
  renderFilters()
  for (const b of document.querySelectorAll('#tabs .tab')) { const on = b.dataset.tab === state.f.tab; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)) }
  $('#mine-bar').hidden = state.f.tab !== 'mine'
  const list = sortVaults(selectVaults(state.f.tab === 'saved' ? state.data.vaults.filter(v => saved.includes(v.asset)) : state.data.vaults, state.f, state.history).concat(state.f.tab === 'saved' ? selectVaults(state.data.vaults.filter(v => saved.includes(v.asset)), { ...state.f, tab: 'opened' }, state.history) : []), state.f.tab === 'opened' ? 'newest' : state.sort)
  const grid = clear($('#grid'))
  const countText = !state.data.open ? '' : state.f.tab === 'mine' && !state.f.owner ? 'Sign in with Gary Club to see your vaults, or look up another wallet.'
    : `${list.length.toLocaleString('en-US')} ${list.length === 1 ? 'vault' : 'vaults'}${state.f.tab === 'mine' && state.f.owner && state.f.owner !== state.sessionWallet ? ' held by the looked-up wallet' : ''}`
  if ($('#count').textContent !== countText) $('#count').textContent = countText
  for (const v of list.slice(0, state.shown)) grid.append(card(v))
  if (list.length > state.shown) grid.append(el('button', { class: 'btn secondary more', type: 'button', 'data-focus': 'show-more', onclick: () => { state.shown += 60; render() } }, `Show more (${(list.length - state.shown).toLocaleString('en-US')} left)`))
  if (!list.length) {
    const title = state.f.tab === 'saved' ? 'Keep an eye on a vault.' : state.f.tab === 'mine' && !state.f.owner ? 'Your place in the Bank.' : state.f.tab === 'opened' ? 'No departures on record.' : !state.data.collection ? 'The doors are not open. The books are.' : 'Nothing under this heading.'
    const copy = state.f.tab === 'saved' ? 'Save a vault from its detail view to return to it here. Saved on this device.' : state.f.tab === 'mine' && !state.f.owner ? 'Sign in with Gary Club. Your existing wallet and your vaults will be waiting here.' : state.f.tab === 'opened' ? 'When a vault opens, its record stays. See what it released and what those same tokens would be worth later.' : !state.data.collection ? 'Explore the five designs above. The first issued vaults will appear here after the charter opens. The opening date is still to be confirmed.' : 'Try another level, status or vault number.'
    grid.append(el('div', { class: 'register-empty' }, el('div', { class: 'empty-seal' }, el('img', { src: '/seal.png', alt: '', width: 72, height: 72 })), el('h3', {}, title), el('p', {}, copy), el('a', { class: 'text-action', href: '/account/', 'data-focus': 'empty-account' }, 'Your Gary Club account ↗'), el('button', { class: 'text-action', type: 'button', 'data-focus': 'clear-filters', onclick: () => { state.f.levels = []; state.f.statuses = []; state.f.q = ''; $('#q').value = ''; render(); renderLevels() } }, 'Clear filters')))
  }
}

async function load() {
  try {
    const [d, h] = await Promise.all([fetch('/data/vaults.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null), fetch('/data/history.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)])
    if (!validObservation(d)) throw new Error('the vault index has no valid observation time')
    if (state.data && d.generated_at <= state.data.generated_at) { showFreshness(); return }
    state.data = d; state.history = h ?? state.history
    preserveView(() => { renderStats(); renderMemberBrief(); renderLevels(); renderBank(); render() }); showFreshness()
    const target = new URLSearchParams(location.search).get('a')
    if (target && !$('#detail').open) {
      await sessionReady
      if ($('#detail').open) return
      const v = d.vaults.find(x => x.asset === target)
      if (v) detail(v)
      else $('#count').textContent = 'That vault is not in the latest register.'
    }
  } catch { showFreshness(true); if (!state.data) clear($('#grid')).append(el('p', { class: 'empty' }, 'The register could not be read just now. It refreshes every ten minutes.')) }
}

function boot() {
  document.body.append(wayfinder('Explore'))
  weightIllustration($('#weight-lab'))
  const selected = Number(new URLSearchParams(location.search).get('level'))
  if ([1,2,3,4,5].includes(selected) && new URLSearchParams(location.search).has('mine')) state.f.levels=[selected]
  showcase($('#showcase'), [1,2,3,4,5].map(level => ({ level })), [1,2,3,4,5].includes(selected) ? selected : 5, level => {
    state.f.levels = [level]; state.f.tab = 'all'; render(); if (state.data) renderLevels(); $('#tabs').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
  })
  if (new URLSearchParams(location.search).has('mine')) state.f.tab = 'mine'
  $('#download-bank').addEventListener('click', async () => { if (!state.data) { notice('The Bank return is unavailable. Please try again.'); return } const snapshot=state.data; try { await downloadBankCard(snapshot) } catch { notice('The Bank card could not be downloaded. Please try again.') } })
  $('#surprise-vault').addEventListener('click', () => { const candidates=(state.data?.vaults||[]).filter(v=>v.status!=='opened'); if(!candidates.length) { notice('No vaults have been issued yet. Explore the five designs above.'); return } detail(candidates[Math.floor(Math.random()*candidates.length)]) })
  $('#share-bank').addEventListener('click', () => shareLink('/market/', 'It cannot print. So it stacks.'))
  for (const mode of ['gallery', 'list']) $(`#view-${mode}`).addEventListener('click', () => { $('#grid').classList.toggle('list-view', mode === 'list'); for (const m of ['gallery', 'list']) $(`#view-${m}`).setAttribute('aria-pressed', String(m === mode)) })
  $('#detail').addEventListener('click', e => { if (e.target === $('#detail')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close() } })
  $('#detail').addEventListener('close', () => { const url = new URL(location.href); url.searchParams.delete('a'); history.replaceState(null, '', url.pathname + url.search + url.hash); const key = $('#detail').dataset.returnFocus; [...document.querySelectorAll('[data-focus]')].find(n => n.dataset.focus === key)?.focus({ preventScroll: true }) })
  sessionReady = readClubSession().then(s => {
    if (!s) return
    state.sessionWallet = s.wallet; if (!state.ownerTouched) { state.f.owner = s.wallet; $('#owner').value = s.wallet }
    $('#account-link').textContent = 'Your vaults ↗'; $('#account-link').href = '/account/'
    renderMemberBrief(); render()
  }).catch(() => { $('#account-link').textContent = 'Account access unavailable'; $('#account-link').href = '/account/' })
  $('#account-link').href = '/account/'
  const sel = $('#sort'); for (const [k, s] of Object.entries(SORTS)) sel.append(el('option', { value: k }, s.label))
  sel.addEventListener('change', () => { state.sort = sel.value; render() })
  $('#q').addEventListener('input', e => { state.f.q = e.target.value; state.shown = 60; render() })
  for (const b of document.querySelectorAll('#tabs .tab')) b.addEventListener('click', () => { state.f.tab = b.dataset.tab; state.shown = 60; render() })
  $('#owner').addEventListener('input', e => { state.ownerTouched = true; state.f.owner = e.target.value.trim(); render() })
  $('#connect').addEventListener('click', async () => {
    try { const w = await connectWallet(P); state.ownerTouched = true; state.f.owner = w.publicKey.toBase58(); $('#owner').value = state.f.owner; render() }
    catch (e) { $('#count').textContent = String(e?.message || e) }
  })
  load(); setInterval(load, 120_000)
}
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot()
