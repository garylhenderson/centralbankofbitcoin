import { shareLink } from '../lib/exhibition.mjs'
import { downloadRecordCard } from '../lib/record-card.mjs'
import { action as button } from '../lib/ui.mjs'
import { $, el, clear, box, amount } from '../lib/ui.mjs'
import { fmtUsd } from '../lib/market-view.mjs'
import { wayfinder } from '../lib/position-view.mjs'
let data, mode='all'
const date = t => Number.isFinite(t) ? new Date(t*1000).toLocaleString('en-US',{timeZone:'America/Chicago',timeZoneName:'short'}) : 'Time unavailable'
function render() {
  if (!data) return
  const q=$('#record-search').value.trim().toLowerCase()
  const selected=new URLSearchParams(location.search).get('a')
  const rows=data.vaults.filter(v=>(!selected||v.asset===selected)&&v.status==='opened' && (!q || `${v.no} ${v.asset}`.toLowerCase().includes(q)) && (mode==='all'||(v.opened?.coverage==='bare_burn')===(mode==='burn'))).sort((a,b)=>(b.opened?.block_time||b.opened?.seen_at||0)-(a.opened?.block_time||a.opened?.seen_at||0))
  $('#records-total').textContent = String(data.vaults.filter(v=>v.status==='opened').length)
  $('.record-tools').hidden = !data.vaults.some(v=>v.status==='opened')
  for(const b of document.querySelectorAll('[data-record-tab]')) b.setAttribute('aria-pressed',String(b.dataset.recordTab===mode))
  $('#record-count').textContent=`${rows.length} opened or retired vaults`
  if(selected) $('#record-count').append(' · ',el('a',{href:'/history/'},'See all openings'))
  clear($('#records'))
  for (const v of rows) {
    const o=v.opened, bare=o?.coverage==='bare_burn', known=o?.coverage==='observed', delta=Number.isFinite(o?.delta_usd)?o.delta_usd:null, observedAt=data.generated_at
    const card=el('article',{class:'record-card opening-record'},el('img',{src:v.level?`/assets/vaults/level-${v.level}.jpg`:'/seal.png',alt:`Level ${v.level} vault`,loading:'lazy'}),el('div',{},el('div',{class:'bank-stamp'},bare?'BURNED':'OPENED & RETIRED'),el('h2',{},`Vault No. ${v.no}`),el('p',{class:'sub'},o?.block_time ? `Retired ${date(o.block_time)}` : `First observed retired: ${date(o?.seen_at)}`)))
    const body=card.lastChild
    if (!known) body.append(el('strong',{class:'opening-value'},bare?'No payout attributed':'Release record unavailable'))
    if (known) {
      body.append(el('section',{class:'hindsight-record'},el('h3',{},'Had they waited?'),el('strong',{class:delta===null?'':delta>=0?'up':'down'},delta===null?'Comparison unavailable':`${delta>=0?'+':'−'}${fmtUsd(Math.abs(delta))}`),el('p',{class:'sub'},'Same released tokens, repriced. Excludes hypothetical later payouts.')))
      body.append(el('p',{},[['cbBTC',8],['GARY',9],['GIRAFFISH',6]].map(([k,d])=>`${amount(o.paid?.[k]??'0',d)} ${k==='cbBTC'?k:'$'+k}`).join(' · ')),el('div',{class:'opening-ledger'},el('div',{},el('span',{},'VALUE AT OPENING'),el('strong',{},fmtUsd(o.value_at_open_usd))),el('div',{},el('span',{},'SAME TOKENS TODAY'),el('strong',{},fmtUsd(o.value_now_usd)))))
    }
    else body.append(el('p',{},bare?'A burn outside redemption is not counted as a reserve payout.':'Released amounts could not be established. No payout is invented.'))
    const url=`/history/?a=${encodeURIComponent(v.asset)}`
    body.append(el('div',{class:'record-share'},button('Share record',()=>shareLink(url,`CBOB Vault No. ${v.no}: opening record`)),button('Download record card',()=>downloadRecordCard({title:`Vault No. ${v.no}`,status:bare?'Burned outside redemption':known?'Opened':'Release record unavailable',lines:known?[`At opening ${fmtUsd(o.value_at_open_usd)} / Today ${fmtUsd(o.value_now_usd)}`,delta===null?'Comparison unavailable':`Had they waited? ${delta>=0?'+':'−'}${fmtUsd(Math.abs(delta))}`,'Same released tokens, repriced.','Estimated values; not an investment return.','Excludes hypothetical later payouts.']:[bare?'No payout attributed.':'Released amounts could not be established.'],url,observedAt,filename:`CBOB-opening-${v.no}.png`}))))
    body.append(el('a',{class:'text-action',href:`/market/?a=${encodeURIComponent(v.asset)}`},'Open the complete vault record →')); $('#records').append(card)
  }
  if (!rows.length) $('#records').append(el('div',{class:'record-empty'},el('span',{class:'bank-stamp'},data.vaults.some(v=>v.status==='opened')?'NO MATCHING RECORDS':'NO DEPARTURES ON RECORD'),el('h2',{},data.vaults.some(v=>v.status==='opened')?'No records match.':'No departures on record.'),el('p',{},'When a vault opens, its record stays here: reserves released, its recorded value at opening, and what those same tokens are worth later.'),el('div',{class:'empty-ledger-head'},el('span',{},'VAULT / OPENED'),el('span',{},'RELEASED'),el('span',{},'THEN / NOW'))))
}
async function load(){try{const r=await fetch('/data/vaults.json',{cache:'no-store'});if(!r.ok)throw new Error();const d=await r.json();if(!Array.isArray(d.vaults)||!Number.isFinite(d.generated_at)||d.generated_at>Date.now()/1000+60)throw new Error();data=d;$('#record-freshness').textContent=`${Date.now()/1000-d.generated_at>1800?'Delayed return. ':''}Observed ${date(d.generated_at)}. Valuations are estimates; the comparison excludes hypothetical later payouts.`;render()}catch{$('#record-freshness').textContent='The opening register is unavailable. Any displayed records are from the last successful observation.';if(!data){$('.record-tools').hidden=true;$('#records-total').textContent='Unavailable';clear($('#records')).append(box('warn','The record could not be read. This does not mean no vaults have opened.'))}}}
document.body.append(wayfinder('History'))
$('#record-search').addEventListener('input',render);for(const b of document.querySelectorAll('[data-record-tab]')) b.addEventListener('click',()=>{mode=b.dataset.recordTab;render()});load();setInterval(load,120000)
