import { shareLink } from '../lib/exhibition.mjs'
import { downloadRecordCard } from '../lib/record-card.mjs'
import { $, el, clear, addr, action as button, box } from '../lib/ui.mjs'
import { tally, actionTitle } from '../lib/governance.mjs'
import { readClubSession, signInLink } from '../lib/club.mjs'
import { reviewAction } from '../lib/club-actions.mjs'
import { wayfinder } from '../lib/position-view.mjs'
import { date, actionDetails } from '../lib/governance-view.mjs'
const completedVotes = new Set()
let sessionError = false, vaultsError = false
let data, vaults = [], session = null, tab = new URLSearchParams(location.search).get('view') === 'past' ? 'past' : 'all'
function proposalCard(p) {
  const observedAt = data.generated_at
  const t = tally(p, observedAt), votes = data.votes.filter(v => v.proposal === p.address)
  const card = el('article', { class: 'record-card', id: `proposal-${p.id}` }, el('div', { class: 'record-meta' }, el('span', { class: 'eyebrow' }, `PROPOSAL ${p.id}`), el('span', { class: 'bank-stamp' }, t.status)), el('h2', {}, p.actions.map(actionTitle).join(' + ')), el('p', { class: 'sub' }, `Opened ${date(p.created_at)} · Voting ends ${date(p.voting_ends_at)}`))
  card.append(el('div', { class: 'record-tally' }, el('div', {}, el('strong', {}, p.yes), ' Yes'), el('div', {}, el('strong', {}, p.no), ' No'), el('div', {}, el('strong', {}, `${t.cast} / ${t.quorum}`), ' quorum')),
    el('p', {}, `${p.quorum_supply} live vaults in the snapshot. Requires ${p.threshold_bps/100}% Yes among votes cast and at least ${t.requiredYes} Yes votes${t.keyChange ? ' because this changes a Bank key' : ''}.`))
  const detail = el('details', { class: 'proposal-detail' }, el('summary', {}, 'Read the exact actions'), ...p.actions.map(actionDetails)); card.append(detail)
  if (p.executed) card.append(el('p', { class: 'sub' }, 'Recorded as executed on chain. Superseded actions may have been skipped; this record does not assert that every action changed a setting.'))
  const ballotList = el('div', { class: 'ballot-list' })
  for (const v of votes) ballotList.append(el('div', { class: 'ballot-row' }, el('strong', {}, v.support ? 'YES' : 'NO'), el('a', { href: `/market/?a=${encodeURIComponent(v.asset)}` }, `Vault ${v.asset.slice(0, 6)}…${v.asset.slice(-4)} →`), addr(v.address)))
  card.append(el('details', {}, el('summary', {}, `Vote history · ${votes.length} recorded`), el('p', { class: 'sub' }, 'Votes belong to vaults. The current owner may differ from the person who cast the vote. Vote accounts do not store a timestamp.'), votes.length ? ballotList : el('p', {}, 'No votes recorded yet.')))
  if (t.status === 'Voting open' && Date.now()/1000 < Number(p.voting_ends_at)) {
    const desk = el('div', { class: 'task-counter vote-counter' })
    if (sessionError) desk.append(box('warn', 'Gary Club account access is temporarily unavailable. Refresh to try again.'))
    else if (!session) desk.append(el('a', { class: 'btn', href: signInLink(`/governance/?p=${p.address}`) }, 'Sign in to vote →'))
    else if (session.actionsEnabled !== true) desk.append(box('note', 'Voting actions are awaiting activation. The public record remains available.'))
    else if (vaultsError) desk.append(box('warn', 'Your vault register is temporarily unavailable. Refresh to try again.'))
    else {
      const completed = vaults.filter(v=>completedVotes.has(`${p.address}:${v.asset}`))
      if (completed.length) desk.append(box('ok', 'Your vote was recorded on chain. The public register updates within about ten minutes.'))
      const owned = vaults.filter(v => v.owner === session.wallet && v.status !== 'opened' && Number.isSafeInteger(v.no) && v.no > 0 && BigInt(v.no - 1) < BigInt(p.index_snapshot) && !votes.some(b => b.asset === v.asset) && !completedVotes.has(`${p.address}:${v.asset}`))
      if (!owned.length) desk.append(el('p', {}, 'No unvoted eligible vaults from your Gary Club wallet appear in this return. Each vault can vote once; vaults issued after this proposal opened cannot vote.'))
      else {
        const select = el('select', { 'aria-label': `Vault voting on Proposal ${p.id}` }), review = el('div', { 'aria-live': 'polite' })
        owned.forEach(v => select.append(el('option', { value: v.asset }, `Vault No. ${v.no}`)))
        const form = el('div', { class: 'action-form' }, select)
        const close = button('Close review', () => { delete review.dataset.voteReviewActive; document.querySelectorAll('.record-tools input,.record-tools button').forEach(n=>n.disabled=false); render() }, { out: review })
        close.hidden = true
        for (const support of [true, false]) form.append(el('button', { class: 'btn', type: 'button', onclick: async () => {
          review.dataset.voteReviewActive = 'true'; close.hidden = false
          document.querySelectorAll('.vote-counter .action-form button,.vote-counter .action-form select').forEach(n=>n.disabled=true)
          close.disabled = false
          document.querySelectorAll('.record-tools input,.record-tools button').forEach(n=>n.disabled=true)
          try { await reviewAction(review, 'vote', { asset: select.value, proposal: p.address, support }, { onSettled: result => { if(result.status==='complete') completedVotes.add(`${p.address}:${select.value}`); close.disabled=false; close.textContent='Back to proposals' } }) } catch (e) { review.append(box('refuse', e.message || 'The vote could not be prepared.')) }
        } }, `Review ${support ? 'Yes' : 'No'} vote`))
        form.append(close)
        desk.append(form, el('p', { class: 'sub' }, 'The server checks ownership, eligibility, prior votes and the deadline again before signing. Network fees and vote-record rent are paid in SOL.'), review)
      }
    }
    card.append(desk)
  }
  const url = `/governance/?p=${encodeURIComponent(p.address)}`
  card.append(el('div', { class: 'record-share' }, button('Share proposal', () => shareLink(url, `CBOB Proposal ${p.id}`)), button('Download record card', () => downloadRecordCard({ title: `Proposal ${p.id}`, status: t.status, lines: [`${p.yes} Yes / ${p.no} No`, `${t.cast} votes cast; quorum ${t.quorum}`, `${p.quorum_supply} vaults in the snapshot`, 'Status and tally at the observation time.', 'Execution may skip superseded actions.'], url, observedAt, filename: `CBOB-proposal-${p.id}.png` }))), el('a', { class: 'text-action', href: url }, 'Permanent proposal link →'), el('details', {}, el('summary', {}, 'On-chain proposal address'), addr(p.address)))
  return card
}
function render() {
  if (!data || document.querySelector('[data-vote-review-active]')) return
  const selected = new URLSearchParams(location.search).get('p'), q = $('#record-search').value.trim().toLowerCase()
  const list = data.proposals.filter(p => (!selected || p.address === selected) && (tab === 'all' || (tally(p, data.generated_at).status === 'Voting open') === (tab === 'open')) && (!q || `${p.id} ${p.address} ${p.actions.map(actionTitle).join(' ')}`.toLowerCase().includes(q)))
  for (const b of document.querySelectorAll('[data-record-tab]')) b.setAttribute('aria-pressed', String(b.dataset.recordTab === tab))
  $('#record-freshness').textContent = `${Date.now()/1000-data.generated_at>1800?'Delayed return. ':''}Chain records observed ${date(data.generated_at)}. Updated about every ten minutes.`
  $('#records-total').textContent = String(data.proposals.length)
  $('.record-tools').hidden = !data.proposals.length
  clear($('#records')).append(...list.map(proposalCard))
  if (!list.length) $('#records').append(el('div', { class: 'record-empty' }, el('span', { class: 'bank-stamp' }, data.proposals.length ? 'NO MATCHING RECORDS' : 'NO PROPOSALS FILED'), el('h2', {}, data.proposals.length ? 'No proposals under this heading.' : 'The first motion is still to come.'), el('p', {}, !data.initialized ? 'The Bank is completing its opening conditions. Voting opens after vaults are issued. Proposals can begin only after the charter claim window closes.' : Date.now()/1000 < Number(data.charter_closes_at) ? `Proposals open after the charter closes: ${date(data.charter_closes_at)}.` : 'No proposals have been recorded. This register will show each proposal, its exact actions, tally, outcome and every vault vote.'), el('div', { class: 'empty-ledger-head' }, el('span', {}, 'PROPOSAL'), el('span', {}, 'YES / NO'), el('span', {}, 'OUTCOME'))))
  $('#record-count').textContent = `${list.length} proposals · ${data.votes.length} ${data.votes.length===1?'vote':'votes'} in the public register`
  if (selected) $('#record-count').append(' · ', el('a', { href: '/governance/' }, 'See all proposals'))
}
async function load() {
  try {
    const r = await fetch('/data/governance.json', { cache: 'no-store' }); if (!r.ok) throw new Error()
    const d = await r.json(); if (!Array.isArray(d.proposals) || !Array.isArray(d.votes) || !Number.isFinite(d.generated_at) || d.generated_at > Date.now()/1000+60) throw new Error()
    data = d; if (document.querySelector('[data-vote-review-active]')) return
    render()
  } catch { $('#record-freshness').textContent = 'The governance return is unavailable. Any displayed records are from the last successful observation.'; if (!data) { $('.record-tools').hidden=true; $('#records-total').textContent='Unavailable'; clear($('#records')).append(box('warn', 'The record could not be read. This is not evidence that no proposals or votes exist.')) } }
}
document.body.append(wayfinder('Votes'))
for (const b of document.querySelectorAll('[data-record-tab]')) b.addEventListener('click', () => { tab = b.dataset.recordTab; render() })
$('#record-search').addEventListener('input', render)
load()
Promise.allSettled([readClubSession(), fetch('/data/vaults.json', { cache: 'no-store' }).then(r=>{if(!r.ok)throw new Error();return r.json()})]).then(([s,d])=>{sessionError=s.status==='rejected';session=s.status==='fulfilled'?s.value:null;vaultsError=d.status==='rejected'||!Array.isArray(d.value?.vaults);vaults=d.status==='fulfilled'&&Array.isArray(d.value?.vaults)?d.value.vaults:[];render()})
setInterval(load,120000)
