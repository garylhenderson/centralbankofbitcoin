/**
 * THE VAULT MARKET, offline (Gary 2026-10-10: browse, filter, sort, see only yours, see
 * opened vaults "had they waited", performance). The view logic is pure; these prove it,
 * and that the page stays read-only: it never builds a transaction or asks a wallet to sign.
 */
import fs from 'fs'
import { selectVaults, sortVaults, changePct, sparkPath, fmtUsd, fmtPct, fmtToken, vaultNo, countdown, SORTS } from '../src/lib/market-view.mjs'
import { harness, ROOT } from './ref.mjs'

const H = harness('market')
const V = (no, o = {}) => ({ asset: `A${no}`, no, level: 1, status: 'earning', owner: 'O1', deposit: `D${no}`, reserves: {}, value_usd: 100, owed_sats: '0', boost: null, ...o })
const vs = [V(1, { level: 5, value_usd: 900 }), V(2, { status: 'sealed', owner: 'O2', value_usd: 50 }), V(3, { status: 'joining', value_usd: null }),
  V(4, { status: 'opened', value_usd: null, opened: { delta_usd: 5 } }), V(5, { level: 3, boost: { weight: 3, until_epoch: 9 }, owner: 'O2', owed_sats: '700' })]
const nos = list => list.map(v => v.no)

H.eq('all: every vault that is not opened', nos(selectVaults(vs, { tab: 'all' })), [1, 2, 3, 5])
H.eq('opened: only opened vaults', nos(selectVaults(vs, { tab: 'opened' })), [4])
H.eq('mine: only the given owner\'s; with no owner, nothing (never everyone\'s)', [nos(selectVaults(vs, { tab: 'mine', owner: 'O2' })), nos(selectVaults(vs, { tab: 'mine', owner: '' }))], [[2, 5], []])
H.eq('levels: any of the chosen levels', nos(selectVaults(vs, { tab: 'all', levels: [3, 5] })), [1, 5])
H.eq('status: chosen statuses, and "boosted" matches a boosted vault whatever its status', [nos(selectVaults(vs, { tab: 'all', statuses: ['sealed'] })), nos(selectVaults(vs, { tab: 'all', statuses: ['boosted'] }))], [[2], [5]])
H.eq('search: by number (leading zeros and # ignored), vault, owner or deposit address; never a partial number',
  [nos(selectVaults(vs, { tab: 'all', q: '#0005' })), nos(selectVaults(vs, { tab: 'all', q: 'D2' })), nos(selectVaults(vs, { tab: 'all', q: 'O2' })), nos(selectVaults(vs, { tab: 'all', q: '1' }))], [[5], [2], [2, 5], [1]])
H.eq('sort: most held first, an unpriced vault last; newest; highest level; largest payout owed',
  [nos(sortVaults(selectVaults(vs, { tab: 'all' }), 'value')), nos(sortVaults(vs, 'newest')).slice(0, 2), nos(sortVaults(vs, 'level')).slice(0, 2), nos(sortVaults(vs, 'owed'))[0]], [[1, 5, 2, 3], [5, 4], [1, 5], 5])
H.eq('sort: an unknown key falls back to most held, never throws', nos(sortVaults(selectVaults(vs, { tab: 'all' }), 'nope')), [1, 5, 2, 3])
const pts = [[100, 50], [110, 55], [125, 60], [130, 66]]
H.eq('30-day change: from the first point inside the window to the last; null below two points or from zero',
  [changePct(pts, 30), changePct(pts, 10), changePct([[1, 5]], 30), changePct([[1, 0], [2, 5]], 30)], [32, 10, null, null])
H.eq('the change feeds the 30-day sort', nos(sortVaults(selectVaults([V(1), V(2)], { tab: 'all' }, { daily: { A1: [[1, 10], [2, 11]], A2: [[1, 10], [2, 15]] } }), 'change')), [2, 1])
H.eq('sparkline: a path through every point in the box; null below two points; a flat line sits mid-height',
  [sparkPath([[0, 1], [10, 3]], 100, 20), sparkPath([[0, 1]]), sparkPath([[0, 2], [5, 2]], 100, 20)], ['M0.0 19.0 L100.0 1.0', null, 'M0.0 10.0 L100.0 10.0'])
H.eq('money: unavailable when unpriced, cents below $10,000, whole dollars above, millions abbreviated',
  [fmtUsd(null), fmtUsd(1621.17), fmtUsd(30530.4), fmtUsd(2500000)], ['price unavailable', '$1,621.17', '$30,530', '$2.50M'])
H.eq('percent with its sign; tokens from raw units; the vault number from one, padded',
  [fmtPct(11.64), fmtPct(-3), fmtPct(null), fmtToken('1743500', 8, 6), fmtToken('0', 9), vaultNo(42)], ['+11.64%', '-3.00%', '', '0.017435', '0', 'No. 0042'])
H.eq('countdown: days and hours, then hours and minutes; nothing once passed or unset',
  [countdown(1000 + 2 * 86400 + 4 * 3600, 1000), countdown(1000 + 3 * 3600 + 5 * 60, 1000), countdown(900, 1000), countdown(null, 1000)], ['2d 4h', '3h 5m', null, null])
H.t('every sort has a label', Object.values(SORTS).every(s => typeof s.label === 'string' && s.label.length > 0))
const page = fs.readFileSync(`${ROOT}/web/src/pages/market.mjs`, 'utf8')
H.t('read-only: the market page builds no transaction and never asks a wallet to sign',
  !/signExact|signTransaction|sendSigned|buildForWallet|from '\.\.\/lib\/tx\.mjs'|from '\.\.\/lib\/ix\.mjs'/.test(page) && /connectWallet/.test(page))
H.t('it reads only the published index, same origin', /fetch\('\/data\/vaults\.json'/.test(page) && /fetch\('\/data\/history\.json'/.test(page) && !/https?:\/\//.test(page.replace(/http:\/\/www\.w3\.org\/2000\/svg/, '')))
H.t('no em dash in anything the page says', !/—/.test(page) && !/—/.test(fs.readFileSync(`${ROOT}/web/src/html/market.html`, 'utf8')))
export default H.done()
