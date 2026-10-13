/**
 * THE VAULT MARKET's view logic (Gary 2026-10-10: "visual and like a built in
 * marketplace ... browse vaults, filter, sort, see only yours, see opened vaults to
 * track + or - had they waited ... Make it fun and dynamic"). Pure: the page renders
 * what these return, and web/test/market.test.mjs proves them without a browser.
 *
 * The data is /data/vaults.json and /data/history.json, written every 10 minutes by
 * bank/vault-index.mjs from the chain. Nothing here signs or sends.
 */
import { compareAsks } from './market-book.mjs'
export const LEVEL_NAMES = ['I', 'II', 'III', 'IV', 'V']
export const STATUS_LABEL = { earning: 'Earning', joining: 'Joining payouts', sealed: 'Sealed', unrevealed: 'Level not drawn yet', opened: 'Opened', unrecorded: 'Unrecorded' }
export const SORTS = {
  price: { label: 'Lowest asking price', cmp: compareAsks },
  value: { label: 'Most held', cmp: (a, b) => (b.value_usd ?? -1) - (a.value_usd ?? -1) || a.no - b.no },
  newest: { label: 'Newest', cmp: (a, b) => b.no - a.no },
  oldest: { label: 'Oldest', cmp: (a, b) => a.no - b.no },
  level: { label: 'Highest level', cmp: (a, b) => (b.level ?? 0) - (a.level ?? 0) || (b.value_usd ?? -1) - (a.value_usd ?? -1) },
  change: { label: 'Best 30 days', cmp: (a, b) => (b.change30 ?? -Infinity) - (a.change30 ?? -Infinity) || a.no - b.no },
  owed: { label: 'Largest payout owed', cmp: (a, b) => Number(BigInt(b.owed_sats ?? 0) - BigInt(a.owed_sats ?? 0)) || a.no - b.no },
}

/** Change over the last `days` of a vault's daily values, in percent (null without two points). */
export function changePct(points, days = 30) {
  if (!Array.isArray(points) || points.length < 2) return null
  const last = points[points.length - 1], cut = last[0] - days
  const first = points.find(p => p[0] >= cut) || points[0]
  if (first === last || !(first[1] > 0)) return null
  return Math.round((last[1] - first[1]) / first[1] * 10000) / 100
}

/** The vaults one view shows. `f` = { tab: 'all'|'mine'|'opened', owner, levels: [1..5], statuses: [...], q } */
export function selectVaults(vaults, f = {}, history = null) {
  const q = String(f.q || '').trim().replace(/^#/, '')
  return (vaults || [])
    .map(v => ({ ...v, change30: history?.daily?.[v.asset] ? changePct(history.daily[v.asset], 30) : null }))
    .filter(v => f.tab === 'opened' ? v.status === 'opened' : v.status !== 'opened')
    .filter(v => f.tab !== 'mine' || (!!f.owner && v.owner === f.owner))
    .filter(v => f.tab !== 'sale' || !!v.listing)
    .filter(v => !f.levels?.length || f.levels.includes(v.level))
    .filter(v => !f.statuses?.length || f.statuses.includes(v.status) || (f.statuses.includes('boosted') && !!v.boost))
    .filter(v => !q || String(v.no) === q.replace(/^0+/, '') || v.asset === q || v.owner === q || v.deposit === q)
}
export function sortVaults(vaults, key = 'value') {
  return [...vaults].sort((SORTS[key] || SORTS.value).cmp)
}

export const fmtUsd = n => n === null || n === undefined ? 'price unavailable'
  : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const fmtPct = p => p === null || p === undefined ? '' : `${p > 0 ? '+' : ''}${p.toFixed(2)}%`
export const vaultNo = no => `No. ${String(no).padStart(4, '0')}`
export function fmtToken(raw, decimals, places = 4) {
  const n = Number(BigInt(raw ?? 0)) / 10 ** decimals
  return n === 0 ? '0' : n < 10 ** -places ? `<${(10 ** -places).toFixed(places)}` : n.toLocaleString('en-US', { maximumFractionDigits: places })
}

/** An SVG path for a sparkline of daily values in a w x h box (null below two points). */
export function sparkPath(points, w = 120, h = 32) {
  if (!Array.isArray(points) || points.length < 2) return null
  const xs = points.map(p => p[0]), ys = points.map(p => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const X = x => x1 === x0 ? w : (x - x0) / (x1 - x0) * w, Y = y => y1 === y0 ? h / 2 : h - (y - y0) / (y1 - y0) * (h - 2) - 1
  return points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(' ')
}

/** "Opens in 2d 4h" style countdown, or null once it has passed. */
export function countdown(atSec, nowSec) {
  if (!atSec || atSec <= nowSec) return null
  const s = atSec - nowSec, d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}
