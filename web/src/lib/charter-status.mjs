import { el, clear } from './ui.mjs'

const time = t => new Date(t * 1000).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) + ' Austin time'
const unavailable = () => ({ state: 'unavailable', title: 'The charter record is temporarily unavailable.', detail: 'The Bank will not substitute a date or count. Please check again shortly.' })
const validTime = t => Number.isSafeInteger(t) && t > 0 && Number.isFinite(new Date(t * 1000).getTime())
export function charterStatus(d, now = Date.now() / 1000) {
  if (!d || !Array.isArray(d.vaults) || d.vaults.some(v => !v || typeof v !== 'object' || Array.isArray(v) || typeof v.charter !== 'boolean') || typeof d.initialization_observed !== 'boolean' || !Number.isInteger(d.charter_claimed) || d.charter_claimed < 0 || d.charter_claimed > 240 || !Number.isFinite(d.generated_at) || Math.abs(now - d.generated_at) > 1800) return unavailable()
  const claimed = d.vaults.filter(v => v.charter).length
  if (Boolean(d.collection) !== d.initialization_observed || claimed !== d.charter_claimed || (!d.initialization_observed && claimed !== 0)) return unavailable()
  if (!d.initialization_observed) return { state: 'waiting', title: 'The charter date is to be announced.', detail: 'The Bank is completing its opening conditions. No charter date has been written permanently.', claimed }
  if (!validTime(d.charter_opens_at) || !validTime(d.charter_closes_at) || d.charter_closes_at <= d.charter_opens_at) return unavailable()
  if (now < d.charter_opens_at) return { state: 'scheduled', title: 'The charter window is scheduled.', detail: `Opens ${time(d.charter_opens_at)}. Closes ${time(d.charter_closes_at)}.`, until: d.charter_opens_at, claimed }
  if (now < d.charter_closes_at) return { state: 'open', title: 'The charter window is open.', detail: `Closes ${time(d.charter_closes_at)}. Each eligible Proof of Burn can be exchanged once.`, until: d.charter_closes_at, claimed }
  return { state: 'closed', title: 'The charter window has closed.', detail: `Closed ${time(d.charter_closes_at)}. Proofs of Burn can no longer be exchanged for vaults.`, claimed }
}
export async function mountCharterStatus() {
  const out = document.getElementById('charter-status')
  if (!out) return
  const heading = out.dataset.charterHeading || 'The charter desk / Public record'
  const title = el('h2', {}), detail = el('p', {}), number = el('strong', {})
  const count = el('p', { class: 'charter-count' }, number, ' of 240 eligible Proofs of Burn exchanged')
  const countdown = el('p', { class: 'sub' })
  clear(out).append(el('p', { class: 'eyebrow' }, heading), title, detail, count, countdown,
    el('a', { href: '/statements/cbob-2026-7/' }, 'Read the charter terms ↗'), el('span', {}, ' · '), el('a', { href: '/statements/feed.xml' }, 'Follow the Bank’s releases'))
  let d = null
  const draw = () => {
    let s
    try { s = charterStatus(d) } catch { s = unavailable() }
    title.textContent = s.title; detail.textContent = s.detail
    count.hidden = s.claimed === undefined; number.textContent = s.claimed === undefined ? '' : String(s.claimed)
    countdown.hidden = !s.until
    if (s.until) { const left = Math.max(0, Math.ceil(s.until - Date.now() / 1000)); countdown.textContent = `${Math.floor(left / 86400)} days · ${Math.floor(left % 86400 / 3600)} hours · ${Math.floor(left % 3600 / 60)} minutes until ${s.state === 'open' ? 'closing' : 'opening'}` }
  }
  const refresh = async () => {
    try { const r = await fetch('/data/vaults.json', { cache: 'no-store' }); if (r.ok) d = await r.json() } catch { /* The age check withholds stale figures. */ }
    draw()
  }
  title.textContent = 'Reading the charter record.'
  detail.textContent = 'Checking the current dates and claim count.'
  count.hidden = true; countdown.hidden = true
  await refresh(); setInterval(refresh, 60000)
}
