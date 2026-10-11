/** Reserve accounting only. Wallet balances, pending payouts and sale prices
 * never enter the held total. Missing observations stay unavailable. */
export const RESERVES = [['cbBTC', 8], ['GARY', 9], ['GIRAFFISH', 6]]
export function position(index, owner) {
  const vaults = owner ? (index.vaults || []).filter(v => v.owner === owner && v.status !== 'opened') : []
  const held = Object.fromEntries(RESERVES.map(([s]) => [s, '0']))
  let value = 0, owed = 0n
  for (const v of vaults) {
    value = value === null || !Number.isFinite(v.value_usd) ? null : value + v.value_usd
    owed = owed === null || v.owed_sats == null ? null : owed + BigInt(v.owed_sats)
    for (const [s] of RESERVES) held[s] = held[s] === null || v.reserves?.[s] == null ? null : String(BigInt(held[s]) + BigInt(v.reserves[s]))
  }
  return { vaults, value, held, owed: owed === null ? null : String(owed), earning: vaults.filter(v => v.status === 'earning').length,
    levels: [1,2,3,4,5].map(level => ({ level, count: vaults.filter(v => v.level === level).length })) }
}
export function reserveValues(held, prices) {
  return RESERVES.map(([symbol, decimals]) => {
    const raw = held?.[symbol], price = prices?.[symbol]
    const value = raw == null ? null : BigInt(raw) === 0n ? 0 : Number.isFinite(price) && price > 0 ? Number(raw) / 10 ** decimals * price : null
    return { symbol, decimals, raw, value }
  })
}
// A fixed basket of CURRENT vaults, never the owner's historical portfolio.
// Require an observation for every vault on each plotted day; no forward-fill.
export function basketHistory(vaults, history, observedAt) {
  if (!vaults.length || !history?.daily) return []
  const maps = vaults.map(v => new Map((history.daily[v.asset] || []).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] * 86400 <= observedAt && (p[0] < Math.floor(observedAt / 86400) || (Number.isFinite(history.generated_at) && history.generated_at <= observedAt)))))
  return [...maps[0].keys()].filter(day => maps.every(m => m.has(day))).sort((a,b) => a-b).map(day => [day * 86400, maps.reduce((sum,m) => sum + m.get(day), 0)])
}

export const validObservation = (d, now = Date.now()/1000) => Number.isFinite(d?.generated_at) && d.generated_at > 0 && d.generated_at <= now + 600
