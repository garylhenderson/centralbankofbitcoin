import { el, clear } from './ui.mjs'

const time = t => new Date(t * 1000).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) + ' Austin time'
export function charterStatus(d, now = Date.now() / 1000) {
  if (!d || !Array.isArray(d.vaults) || typeof d.initialization_observed !== 'boolean' || !Number.isInteger(d.charter_claimed) || d.charter_claimed < 0 || d.charter_claimed > 240 || !Number.isFinite(d.generated_at) || Math.abs(now - d.generated_at) > 1800) return { state: 'unavailable', title: 'The charter record is temporarily unavailable.', detail: 'The Bank will not substitute a date or count. Please check again shortly.' }
  const claimed = d.vaults.filter(v => v.charter).length
  if ((!d.collection && d.initialization_observed) || (d.charter_claimed !== undefined && claimed !== d.charter_claimed)) return { state: 'unavailable', title: 'The charter record needs another reading.', detail: 'The Bank is checking the window and claim count. No date or count has been substituted.' }
  if (!d.collection || !d.charter_opens_at || !d.charter_closes_at) return { state: 'waiting', title: 'The charter date is to be announced.', detail: 'The Bank is completing its opening conditions. No charter date has been written permanently.', claimed }
  if (now < d.charter_opens_at) return { state: 'scheduled', title: 'The charter window is scheduled.', detail: `Opens ${time(d.charter_opens_at)}. Closes ${time(d.charter_closes_at)}.`, until: d.charter_opens_at, claimed }
  if (now < d.charter_closes_at) return { state: 'open', title: 'The charter window is open.', detail: `Closes ${time(d.charter_closes_at)}. Each eligible Proof of Burn can be exchanged once.`, until: d.charter_closes_at, claimed }
  return { state: 'closed', title: 'The charter window has closed.', detail: `Closed ${time(d.charter_closes_at)}. Proofs of Burn can no longer be exchanged for vaults.`, claimed }
}
export async function mountCharterStatus() {
  const out = document.getElementById('charter-status')
  if (!out) return
  try {
    const r = await fetch('/data/vaults.json', { cache: 'no-store' })
    if (!r.ok) throw new Error('unavailable')
    let d = await r.json()
    const draw = () => {
      const s = charterStatus(d)
      clear(out).append(el('p', { class: 'eyebrow' }, 'The charter desk / Public record'), el('h2', {}, s.title), el('p', {}, s.detail))
      if (s.claimed !== undefined) out.append(el('p', { class: 'charter-count' }, el('strong', {}, String(s.claimed)), ' of 240 eligible Proofs of Burn exchanged'))
      if (s.until) { const left = Math.max(0, Math.ceil(s.until - Date.now() / 1000)); out.append(el('p', { class: 'sub' }, `${Math.floor(left / 86400)} days · ${Math.floor(left % 86400 / 3600)} hours · ${Math.floor(left % 3600 / 60)} minutes until ${s.state === 'open' ? 'closing' : 'opening'}`)) }
      out.append(el('a', { href: '/statements/cbob-2026-7/' }, 'Read the charter terms ↗'), el('span', {}, ' · '), el('a', { href: '/statements/feed.xml' }, 'Follow the Bank’s releases'))
    }
    draw(); setInterval(async () => {
      try { const r = await fetch('/data/vaults.json', { cache: 'no-store' }); if (r.ok) d = await r.json() } catch { /* The age check withholds stale figures. */ }
      draw()
    }, 60000)
  } catch { clear(out).append(el('h2', {}, 'The charter record is temporarily unavailable.'), el('p', {}, 'Please check again shortly. No date or count has been substituted.'), el('a', { href: '/statements/cbob-2026-7/' }, 'Read the charter terms ↗')) }
}
