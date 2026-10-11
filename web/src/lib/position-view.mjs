import { el, clear } from './ui.mjs'
import { fmtUsd, fmtToken, fmtPct, sparkPath } from './market-view.mjs'
import { historyWindow } from './ecosystem.mjs'
import { reserveValues } from './position.mjs'

export function reserveMix(held, prices) {
  const rows = reserveValues(held, prices), total = rows.every(r => r.value !== null) ? rows.reduce((s,r) => s+r.value,0) : null
  const out = el('section', { class: 'reserve-mix' }), track = el('div', { class: 'reserve-track', 'aria-hidden': 'true' })
  if (total > 0) for (const [i,r] of rows.entries()) { const bar = el('span', { class: `token-${i}` }); bar.style.width = `${r.value / total * 100}%`; track.append(bar) }
  out.append(el('div', { class: 'eyebrow' }, 'Inside the vaults'), track)
  for (const [i,r] of rows.entries()) out.append(el('div', { class: 'reserve-line' }, el('span', { class: `token-dot token-${i}`, 'aria-hidden': 'true' }), el('div', {}, el('strong', {}, r.symbol === 'cbBTC' ? 'cbBTC' : '$'+r.symbol), el('span', {}, r.raw === null || r.raw === undefined ? 'Balance unavailable' : fmtToken(r.raw, r.decimals, 8))), el('div', {}, el('strong', {}, fmtUsd(r.value)), el('span', {}, total > 0 && r.value !== null ? `${(r.value / total * 100).toFixed(1)}% of reserves` : 'Estimated token value'))))
  return out
}

export function positionChart(points, observedAt, label = 'Your current vaults over time', vaultCount = 1) {
  const out = el('section', { class: 'position-chart' }), plot = el('div', {}), controls = el('div', { class: 'row', role: 'group', 'aria-label': label+' period' })
  const draw = days => {
    clear(plot)
    for (const b of controls.children) b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days))
    const pts = historyWindow(points, days, observedAt), path = sparkPath(pts, 700, 180)
    if (!path) { plot.append(el('div', { class: 'position-chart-empty' }, el('span', { class: 'eyebrow' }, 'A record worth keeping.'), el('p', {}, !vaultCount ? 'No vaults to chart yet.' : points.length >= 2 ? 'Fewer than two shared observations in this period. Try a longer one.' : 'The combined chart needs two dated observations for every current vault. A newly acquired or issued vault can shorten its history.'))); return }
    const first = pts[0], last = pts.at(-1), change = first[1] > 0 ? (last[1]-first[1])/first[1]*100 : null
    const output = el('output', { class: 'position-readout' }), svg = document.createElementNS('http://www.w3.org/2000/svg','svg')
    svg.setAttribute('viewBox','0 0 700 180'); svg.setAttribute('role','img'); svg.setAttribute('aria-label',label)
    const line = document.createElementNS(svg.namespaceURI,'path'); line.setAttribute('d',path); svg.append(line)
    const cursor = document.createElementNS(svg.namespaceURI,'line'); cursor.setAttribute('y1','0'); cursor.setAttribute('y2','180'); cursor.setAttribute('class','chart-cursor'); svg.append(cursor)
    const input = el('input', { type:'range', min:0, max:pts.length-1, value:pts.length-1, 'aria-label':'Inspect your vault reserve history' })
    const inspect = () => { const p=pts[Number(input.value)],x=(p[0]-first[0])/(last[0]-first[0])*700; cursor.setAttribute('x1',x);cursor.setAttribute('x2',x); output.textContent=`${fmtUsd(p[1])} · ${new Date(p[0]*1000).toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'})} (UTC day)`;input.setAttribute('aria-valuetext',output.textContent) }
    input.addEventListener('input',inspect);inspect()
    svg.setAttribute('aria-label',`${label}: ${fmtUsd(first[1])} to ${fmtUsd(last[1])}. ${change===null?'':fmtPct(change)} reserve-value change.`)
    const records=el('details',{},el('summary',{},'Read the observations')),table=el('table',{class:'res'},el('caption',{},'Daily reserve observations (UTC)'));for(const [t,v] of [...pts].reverse())table.append(el('tr',{},el('td',{},new Date(t*1000).toLocaleDateString('en-US',{timeZone:'UTC'})),el('td',{},fmtUsd(v))));records.append(table)
    plot.append(el('div',{class:'position-change'},change===null?'Change unavailable':fmtPct(change),el('span',{},`Reserve-value change · ${new Date(first[0]*1000).toLocaleDateString('en-US',{timeZone:'UTC'})} to ${new Date(last[0]*1000).toLocaleDateString('en-US',{timeZone:'UTC'})}`)), output,svg,input,records)
  }
  for (const days of [7,30,90,365]) controls.append(el('button',{class:'chip',type:'button','data-days':days,onclick:()=>draw(days)},days===365?'1Y':`${days}D`))
  out.append(el('div',{class:'chart-heading'},el('h3',{},label),controls),plot,el('p',{class:'sub'},'Daily readings are grouped by UTC day. Tracks the vaults you own now, including observations before you acquired them. Deposits, payouts and token prices change this value. It is not your investment return.'));draw(30);return out
}

export const metric = (label, value, note) => el('div', { class: 'position-metric' }, el('span', { class: 'eyebrow' }, label), el('strong', {}, value), el('span', { class: 'metric-note' }, note))
export function bankRibbon(d) {
  return el('a', { class: 'bank-ribbon', href: '/market/#bank-section' }, el('span', { class: 'eyebrow' }, `${Date.now()/1000-d.generated_at>1800?'Delayed return / ':''}Across the Bank`), el('span', {}, el('strong', {}, fmtUsd(d.totals.value_usd)), ' reserves held'), el('span', {}, el('strong', {}, d.totals.live), ' live vaults'), el('span', {}, el('strong', {}, d.totals.opened), ' retired'), el('span', {}, 'See the books ↗'))
}
export function wayfinder(active) {
  return el('nav', { class: 'bank-dock', 'aria-label': 'Quick navigation' }, ...[['/market/','Explore','◈'],['/market/#bank-section','The Bank','▥'],['/account/','Your desk','▣']].map(([href,label,icon]) => el('a', {href,'aria-current':label===active?'page':null},el('span',{'aria-hidden':'true'},icon),label)))
}
