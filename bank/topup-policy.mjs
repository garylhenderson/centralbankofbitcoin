export const SOURCE = 'FZjLB4e9mVMZTWA6YR1KbXVbByTqWsHpHy5sK83yJYUY'
export const OPERATOR = 'bipP7uK5aQDsrChYA8hpZ1Thb8BCw7emRGuEkLkHg6G'
export const DAY_CAP = 250000000
export const SOURCE_FLOOR = 5000000
export const ROLES = {
  crank: { below: 50000000, target: 200000000 },
  operator: { below: 25000000, target: 50000000 },
}
export function planTopup({ balances, attempts, day, fee }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid UTC budget day')
  for (const n of [balances.source, balances.crank, balances.operator, fee]) {
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid balance or fee')
  }
  if (fee > 20000) throw new Error('Topup fee exceeds 20000 lamports')
  if (attempts.some(a => !['landed', 'failed', 'expired'].includes(a.outcome?.status))) throw new Error('Unresolved prior topup')
  const used = attempts.filter(a => a.day === day && a.outcome.status === 'landed').reduce((n, a) => n + a.total, 0)
  if (!Number.isSafeInteger(used) || used < 0) throw new Error('Invalid budget ledger')
  const transfers = Object.entries(ROLES).filter(([r, p]) => balances[r] < p.below)
    .map(([role, p]) => ({ role, lamports: p.target - balances[role] }))
  const total = transfers.reduce((n, a) => n + a.lamports, 0)
  if (used + total > DAY_CAP) return { status: 'hold', reason: 'daily_cap', used, total, transfers: [] }
  if (total && balances.source - total - fee < SOURCE_FLOOR) return { status: 'hold', reason: 'reserve_low', used, total, transfers: [] }
  return { status: total ? 'ready' : 'idle', used, total, transfers, reserve_after: balances.source - total - (total ? fee : 0) }
}
