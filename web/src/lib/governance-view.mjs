import { el, amount } from './ui.mjs'
import { actionTitle } from './governance.mjs'
export const date = t => new Date(Number(t) * 1000).toLocaleString('en-US', { timeZone: 'America/Chicago' }) + ' Austin time'
export function actionDetails(a) {
  const dl = el('dl', { class: 'facts' }), row = (k,v) => dl.append(el('dt', {}, k), el('dd', {}, v))
  if (a.kind === 'SetRound') { row('Sale opens',date(a.opens_at)); row('Sale closes',date(a.closes_at)); row('Price per vault',`${amount(a.price,8)} cbBTC (${a.price} sats)`); row('Vault cap',String(a.cap)) }
  if (a.kind === 'Brakes') { row('Restart sales',a.restart_sales?'Yes':'No'); row('Restart reserve swaps',a.restart_sweep?'Yes':'No'); if(a.set_guardian) row('New guardian',a.guardian||'Remove guardian'); else row('Guardian','Unchanged') }
  if (a.kind === 'TightenSweep') { for (const [k,title] of [['sol_reserve_lamports','SOL reserve'],['max_sweep_lamports','Maximum swap']]) row(title,a[k]===null?'Unchanged':`${amount(a[k],9)} SOL`); row('Swap cooldown',a.sweep_cooldown_secs===null?'Unchanged':`${a.sweep_cooldown_secs} seconds`) }
  if (a.kind === 'ArmSwapOperator') row('New operator',a.operator)
  if (a.kind === 'SetBoostTerms') { row('Burn per boost',BigInt(a.price)===0n?'Off':`${amount(a.price,6)} $CBOB (${a.price} base units)`); row('Extra payout weight',String(a.weight)); row('Duration',`${a.epochs} distributions`) }
  return el('section', { class: 'proposal-action' }, el('h3', {}, actionTitle(a)), dl)
}

export function executionDetails(effects) {
  const out = el('section', { class: 'execution-effects' }, el('h3', {}, 'Expected result at this review'), el('p', {}, 'These results are checked again before signing. The chain decides at landing. A round that closes while the transaction is pending is skipped and still supersedes older rounds. Any failed instruction reverts the whole execution.'))
  for (const effect of effects || []) {
    const row = el('article', { class: 'proposal-action' }, el('h4', {}, effect.kind), el('p', {}, effect.note))
    if (effect.opens_immediately !== undefined) row.append(el('p', {}, effect.opens_immediately ? 'The proposed sale would open immediately.' : 'The proposed sale starts at its stated opening time.'))
    if (effect.replaces_round) row.append(el('h4', {}, `Current round ${effect.replaces_round.id}, replaced by this decision`), actionDetails({ ...effect.replaces_round, kind: 'SetRound' }))
    if (effect.current) row.append(el('h4', {}, 'Current restrictions'), actionDetails({ ...effect.current, kind: 'TightenSweep' }))
    if (effect.notice_secs) row.append(el('p', {}, `Notice period: ${effect.notice_secs} seconds from execution.`))
    if (effect.stopped) row.append(el('p', {}, `Stop recorded ${date(effect.stopped_at)}. Proposal filed ${date(effect.proposal_created_at)}.`))
    out.append(row)
  }
  return out
}
