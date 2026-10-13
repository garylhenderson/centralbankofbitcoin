import {mountWalletChoice,externalWalletMode} from './holder-wallet.mjs'
import {PROFILES} from '../config.js'
import {makeIds} from './ids.mjs'
import {inspectCommitment,voteHistoryDigest} from './trade-state.mjs'
import {verifyBallotQuote} from './ballot-input.mjs'
import {verifyGovernanceQuote} from './sale-proposal.mjs'
import { actionDetails, executionDetails, date } from './governance-view.mjs'
import { $, el, clear, addr, box, action as button } from './ui.mjs'
import { readClubSession, clubRequest, signInLink } from './club.mjs'
import { fmtToken, vaultNo, LEVEL_NAMES } from './market-view.mjs'
const knownTokens = { cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: ['cbBTC',8], '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk': ['$GARY',9], Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump: ['$GIRAFFISH',6] }

function showReserveMinimums(out,reserves) {
  out.append(el('h3',{},'Reserve minimums in this order'),el('p',{},'The vault must still hold at least these amounts when checked before settlement. Additional deposits and payouts do not cancel the order.'),...Object.entries(reserves).map(([mint,raw])=>{const token=knownTokens[mint];return el('p',{},token?`${fmtToken(raw,token[1],token[1])} ${token[0]}`:`${raw} base units of ${mint}`)}))
}

function showTradeVotes(out,votes) {
  voteHistoryDigest(votes)
  const section=el('section',{class:'trade-votes'},el('h3',{},'This vault’s votes'))
  section.append(el('p',{},votes.length?`${votes.length} vote${votes.length===1?' has':'s have'} already been cast. These votes stay with the vault after a sale. Its next holder cannot vote again on those proposals.`:'No recorded votes were found for this vault. This does not guarantee eligibility on every proposal.'))
  if(votes.length)section.append(el('details',{},el('summary',{},'See recorded votes'),el('ul',{},...votes.map(v=>el('li',{},v.support?'YES on ':'NO on ',el('a',{href:`/governance/?p=${encodeURIComponent(v.proposal)}`,target:'_blank',rel:'noopener'},`proposal ${v.proposal.slice(0,6)}…${v.proposal.slice(-4)}`))))))
  section.append(el('p',{class:'sub'},'A new vote requires a fresh order review. History is checked before signing; a vote can still land before the transfer completes.'),el('a',{href:'/governance/',target:'_blank',rel:'noopener'},'Open the voting register'))
  out.append(section)
}

export async function clubRead(name) {
  const r = await fetch(`/club/${name}`, { credentials: 'same-origin', cache: 'no-store' })
  const data = await r.json().catch(() => { throw new Error('The Bank returned an unreadable response. Please try again shortly.') })
  if (!r.ok) throw new Error(data.error || 'The account could not be read.')
  return data
}
const reviewVersions = new WeakMap(), reviewLocks = new WeakSet()
function beginReview(out) {
  if (reviewLocks.has(out)) throw new Error('Check the current confirmation before preparing another action.')
  const version = Symbol('review')
  reviewVersions.set(out, version)
  return () => reviewVersions.get(out) === version
}
export async function reviewAction(out, action, input, { onSettled, onPending } = {}) {
  const currentReview = beginReview(out)
  clear(out).append(box('note', 'Reading the chain and preparing your transaction...'))
  let quote
  try { quote = await clubRequest('prepare', { action, input }) }
  catch (e) { if (!currentReview()) return; throw e }
  if (!currentReview()) return
  clear(out)
  const s = quote.summary, d = s.details
  out.append(el('h3', {}, s.stage === 'opening_setup' ? 'Prepare the receiving accounts' : 'Review this action'),
    el('p', {}, 'Signed by your Gary Club wallet after you confirm.'), addr(s.wallet))
  if (s.asset) out.append(el('p', {}, 'Vault: ', addr(s.asset)))
  if(action==='propose'||action==='execute_proposal') {
    if(s.action!==action||s.stage!==action)throw Error('The review names a different action.')
    verifyGovernanceQuote(action,input,d)
    out.append(el('h3',{},`${action==='propose'?'File':'Execute'} Proposal ${d.proposal_id}`),addr(d.proposal),el('p',{},`Voting deadline: ${date(d.voting_ends_at)}.`),...d.actions.map(actionDetails))
    if(action==='propose')out.append(box('note','Creating this proposal does not vote for it. Return to the voting room to cast your own vault votes.'))
    else out.append(executionDetails(d.execution))
    if(d.execution_window_closes)out.append(el('p',{class:d.execution_window_closes_soon?'warn':'sub'},`Execution window ends: ${date(d.execution_window_closes)}.`))
  }
  if(action==='vote'&&input.ballots) {
    verifyBallotQuote(d,input)
    out.append(el('h3',{},`Proposal ${d.proposal_id}: your ballot`),el('p',{},`Voting ends ${date(d.voting_ends_at)}.`),...d.ballots.map(b=>el('p',{},`CBOB Vault #${b.vault_no}: ${b.support?'YES':'NO'} `,addr(b.asset))),...d.actions.map(actionDetails))
  }
  if (action === 'vote' && !input.ballots && (d.support !== input.support || d.proposal !== input.proposal || s.asset !== input.asset)) throw new Error('The vote does not match your choice. Prepare it again.')
  if (action === 'vote' && !input.ballots) out.append(el('h3', {}, `Proposal ${d.proposal_id}: vote ${d.support ? 'YES' : 'NO'}`), el('p', {}, `Voting ends ${date(d.voting_ends_at)}.`), el('a', { href: `/governance/?p=${encodeURIComponent(d.proposal)}`, target: '_blank', rel: 'noopener' }, 'Read the proposal and exact actions ↗'), ...d.actions.map(actionDetails))
  if (d.pob) out.append(box('warn', 'This Proof of Burn will be destroyed in exchange for the vault: ', addr(d.pob)))
  if (d.price_sats) out.append(el('p', {}, `Vault price: ${fmtToken(d.price_sats, 8, 8)} cbBTC. Account rent is also paid in SOL.`))
  if (d.price_lamports && (BigInt(d.seller_lamports) + BigInt(d.royalty_lamports) !== BigInt(d.price_lamports) || BigInt(d.royalty_lamports) !== BigInt(d.price_lamports) / 10n)) throw new Error('The payment breakdown could not be verified.')
  if (d.price_lamports && d.revenue !== makeIds(PROFILES.mainnet).REVENUE.toBase58()) throw new Error('The royalty destination does not match the Bank. Prepare it again.')
  if (d.price_lamports && (action === 'accept_offer' ? d.seller !== s.wallet : action === 'buy_order' ? d.buyer !== s.wallet : false)) throw new Error('The trade does not match your wallet. Prepare it again.')
  if (d.price_lamports) out.append(el('p', { class: 'trade-role' }, action === 'accept_offer' ? 'You are selling this vault. It will leave your Gary Club wallet when you confirm.' : 'You are buying this vault. It will move into your Gary Club wallet when you confirm.'))
  if (d.price_lamports) out.append(el('dl', { class: 'facts' }, el('dt', {}, 'Buyer pays'), el('dd', {}, `${fmtToken(d.price_lamports, 9, 9)} SOL`),
    el('dt', {}, 'Seller receives'), el('dd', {}, `${fmtToken(d.seller_lamports, 9, 9)} SOL`), el('dt', {}, 'CBOB royalty'), el('dd', {}, `${fmtToken(d.royalty_lamports, 9, 9)} SOL (10%, rounded down to a whole lamport)`),
    el('dt', {}, 'Royalty destination'), el('dd', {}, addr(d.revenue))))
  if(action==='buy_order'||action==='accept_offer')showTradeVotes(out,d.vote_history)
  if(d.state?.minimum_reserves)showReserveMinimums(out,d.state.minimum_reserves)
  if (action === 'open' && s.stage !== 'opening_setup') out.append(box('warn', 'Opening destroys this vault permanently. Its recoverable reserves are paid to your Gary Club wallet.'))
  if (d.vault_no) out.append(el('p', {}, `Vault No. ${d.vault_no} · Level ${['I','II','III','IV','V'][d.level - 1] || 'not drawn'}`))
  if (s.estimated_sol_change_lamports) out.append(el('p', {}, `Estimated wallet SOL change, including rent and fees: ${Number(s.estimated_sol_change_lamports) / 1e9} SOL.`))
  if (d.reserves) {
    out.append(el('h3', {}, 'Accounts found at the vault address'), el('p', { class: 'sub' }, 'These are observed balances, not a simulated receipt. Review the acknowledgments below for any accounts or assets that will remain behind or be destroyed.'))
    const amounts = el('dl', { class: 'facts' })
    for (const r of d.reserves) { const token = knownTokens[r.mint]; amounts.append(el('dt', {}, token?.[0] || r.mint || r.address), el('dd', {}, token ? fmtToken(r.raw, token[1], token[1]) : `${r.raw} base units`)) }
    out.append(amounts)
  }
  for (const note of [...(Array.isArray(d.note) ? d.note : d.note ? [d.note] : []), ...(d.steps || [])]) out.append(el('p', {}, note))
  out.append(el('p', {}, `Network fee: ${fmtToken(s.network_fee_lamports, 9, 9)} SOL. Quote expires ${new Date(quote.expires_at).toLocaleTimeString()}. Account setup may also require SOL rent.`))
  if (s.max_network_fee_lamports) out.append(el('p', { class: 'opening-fee-budget' }, `Maximum network fee you are approving: ${fmtToken(s.max_network_fee_lamports, 9, 9)} SOL. Newly due payouts can change the measured work. Any higher fee requires another review.`))
  const acknowledgments = []
  for (const a of s.acks) {
    const id = `ack-${acknowledgments.length}`, input = el('input', { type: 'checkbox', id })
    acknowledgments.push([a.id, input]); out.append(el('div', { class: 'ack' }, input, el('label', { for: id }, a.text)))
    if (a.list) out.append(el('details', { class: 'ack-list' }, el('summary', {}, `Show the ${a.list.length} listed`), el('ul', {}, ...a.list.map(t => el('li', {}, t))), a.more ? el('p', {}, `and ${a.more} more, counted in the box above.`) : null))
  }
  const result = el('div', { role: 'status' })
  out.append(button(s.stage === 'opening_setup' ? 'Confirm setup with Gary Club' : 'Confirm with Gary Club', async () => {
    if (acknowledgments.some(([, node]) => !node.checked)) throw new Error('Please read and accept every acknowledgment.')
    if (!currentReview()) throw new Error('This review was replaced. Review the current action.')
    reviewLocks.add(out)
    onPending?.()
    // Keep the original intent reachable even if a proxy loses the confirm response.
    const entries = out.closest('.task-counter')?.querySelectorAll('.action-form button, .action-form select, .action-form input') || []
    for (const entry of entries) entry.disabled = true
    const finish = r => {
      if (['complete', 'failed', 'prepared'].includes(r.status)) reviewLocks.delete(out)
      clear(out); showOutcome(out, r, onSettled)
      if (r.status === 'complete' && action === 'open' && s.stage === 'opening_setup') out.append(button('Continue preparing the opening', () => reviewAction(out, action, input), { out }))
    }
    try { finish(await clubRequest('confirm', { id: quote.id, acknowledged: acknowledgments.filter(([, node]) => node.checked).map(([id]) => id) })) }
    catch (e) {
      clear(out).append(box('warn', `${e.message || 'The confirmation response was interrupted.'} Check this action before preparing another.`))
      out.append(button('Check this action', async () => finish(await clubRequest('status', { id: quote.id })), { out }), el('a', { class: 'btn secondary', href: '/account/' }, 'View the account record'))
    }
  }, { out: result }), result)
}
function showOutcome(out, r, onSettled) {
  if (['complete', 'failed', 'prepared'].includes(r.status)) { reviewLocks.delete(out); onSettled?.(r) }
  out.append(box(r.status === 'complete' ? 'ok' : 'note', r.status === 'complete' ? 'Confirmed on chain.' : r.status === 'failed' ? 'The transaction did not complete. Check your record before preparing again.' : r.status === 'prepared' ? 'This quote has not been submitted. Return to your account record before preparing another action.' : 'Confirmation is pending. This action is recorded; do not prepare another copy.'))
  if (r.signature) out.append(el('p', {}, 'Transaction: ', el('code', {}, r.signature)))
  if (r.status === 'sending') out.append(button('Check confirmation', async () => {
    const next = await clubRequest('status', { id: r.id }); clear(out); showOutcome(out, next, onSettled)
  }, { out }))
  out.append(el('a', { class: 'btn secondary', href: '/account/' }, 'Account record'))
}

/** Mainnet defaults to the Gary Club wallet. The audited Phantom path remains explicit. */
export function mountClubAction(kind, profile) {
  if(profile.name!=='mainnet')return false
  mountWalletChoice($('#wallet')||$('#result'))
  if(externalWalletMode())return false
  const walletBox = $('#wallet'), out = $('#result'), connect = $('#connect')
  if (connect) connect.hidden = true
  if ($('#check')) $('#check').hidden = true
  const boot = async () => {
    const s = await readClubSession()
    if (walletBox) clear(walletBox)
    const route = `/${kind === 'open' ? 'redeem' : kind}/`
    const asset = new URLSearchParams(location.search).get('a') || ''
    const next = route + (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(asset) ? `?a=${encodeURIComponent(asset)}` : '')
    if (!s) {
      out.append(el('div', { class: 'task-welcome' }, el('h2', {}, 'Begin with your account.'), el('p', {}, 'Your Gary Club account is your Bank account. Sign in to use the wallet you already have, or create an account to get started.'),
        el('div', { class: 'row' }, el('a', { class: 'btn', href: signInLink(next) }, 'Sign in with Gary Club →'), el('a', { class: 'btn secondary', href: signInLink(next, true) }, 'Create an account')),
        el('p', { class: 'sub' }, 'Gary Club holds your wallet key and signs the transactions you approve. You review the details before confirming.')))
      return
    }
    out.append(el('p', { class: 'account-greeting' }, `Welcome, ${s.displayName || 'account holder'}.`), el('details', { class: 'account-context' }, el('summary', {}, 'Using your Gary Club wallet', el('span', {}, 'View address +')), addr(s.wallet), el('p', {}, s.custody)))
    if (!profile.collection) {
      out.append(el('div', { class: 'task-welcome' }, el('h2', {}, 'The Bank is preparing to open.'), el('p', {}, 'Your account is ready. Vault actions become available when the Bank opens and the relevant claim window or sale round permits them.'), el('p', { class: 'sub' }, 'The opening date is still to be confirmed.'), el('a', { class: 'btn secondary', href: '/market/' }, 'Explore the five vault levels ↗')))
      return
    }
    if (s.holderActionsEnabled !== true) {
      out.append(box('note', 'Vault actions are not open yet. Your wallet and account record remain available.'), el('a', { class: 'btn secondary', href: '/account/' }, 'View your account'))
      return
    }
    const form = el('div', { class: 'action-form' }), review = el('div', { class: 'action-review', 'aria-live': 'polite' })
    let chosen = null
    if (kind === 'claim') {
      const w = await clubRead('wallet')
      if (!w.pobs.length) { out.append(el('div', { class: 'task-welcome' }, el('h2', {}, 'No eligible proof here yet.'), el('p', {}, 'This Gary Club wallet does not hold an eligible Proof of Burn. Charter claims require one during the seven-day window.'), el('a', { class: 'btn secondary', href: '/market/' }, 'Explore the vaults ↗'))); return }
      chosen = el('select', { id: 'club-proof', 'aria-label': 'Proof of Burn' })
      for (const p of w.pobs) chosen.append(el('option', { value: p.address }, `Proof of Burn #${p.edition}`))
      form.append(el('label', { for: 'club-proof' }, 'Choose your Proof of Burn'), chosen)
    } else if (kind !== 'buy') {
      chosen = el('input', { id: 'club-vault', type: 'text', 'aria-label': 'Vault address', placeholder: 'Paste a vault NFT address', spellcheck: false })
      chosen.value = asset
      // The register is a convenience picker, never proof of ownership. The server
      // checks the selected vault and owner on chain when preparing the action.
      try {
        const r = await fetch('/data/vaults.json', { cache: 'no-store' })
        if (!r.ok) throw new Error('Register unavailable')
        const data = await r.json(), mine = data.vaults.filter(v => v.owner === s.wallet && v.status !== 'opened')
        if (mine.length) {
          const pick = el('select', { id: 'club-pick', 'aria-label': 'Choose one of your vaults' }, el('option', { value: '' }, 'Choose a vault from your collection'))
          for (const v of mine) pick.append(el('option', { value: v.asset }, `${vaultNo(v.no)} · Level ${LEVEL_NAMES[v.level - 1] || 'not drawn'}`))
          pick.value = asset; pick.addEventListener('change', () => { if (pick.value) chosen.value = pick.value })
          form.append(el('label', { for: 'club-pick' }, 'From your collection'), pick, el('p', { class: 'sub' }, 'Recent transfers may take about 10 minutes to appear. Ownership is checked again before you confirm.'))
        }
      } catch { /* An address can still be supplied when the public register is unavailable. */ }
      form.append(el('label', { for: 'club-vault' }, 'Vault to review'), chosen)
    }
    form.append(button('Prepare and review', () => reviewAction(review, kind, kind === 'buy' ? {} : { [kind === 'claim' ? 'pob' : 'asset']: chosen.value }), { out: review }))
    out.append(form, review)
  }
  boot().catch(e => out.append(box('refuse', e.message)))
  return true
}

export function tradePanel(v) {
  const panel = el('section', { class: 'trade-panel' }, el('h3', {}, 'Vault actions and trading')), messages = el('div', { role: 'status' })
  panel.append(messages)
  const load = async () => {
    const s = await readClubSession()
    if (!s) { panel.append(el('a', { class: 'btn', href: signInLink(`/market/?a=${v.asset}`) }, 'Sign in to trade')); return }
    const market = await clubRead('market')
    panel.append(el('p', {}, 'Trades settle in SOL. The royalty is 10% rounded down to a whole lamport; the seller receives the remainder. The royalty goes to Bank revenue, split 85% to activated vaults and 15% to the Bank’s treasury. There is no additional Gary Club fee. Network fees are paid by the member who confirms. Offers reserve no funds and are checked again when accepted.'))
    if(market.fundingAvailable===false)panel.append(box('note','Offer funding is temporarily unavailable. Unverified offers are hidden; you can still cancel your own orders.'))
    const trading = market.tradingEnabled === true, holder = s.holderActionsEnabled === true
    const orders = market.orders.filter(o => o.asset === v.asset), rows = []
    for (const o of orders) {
      const row = el('div', { class: 'order-row' }, el('p', {}, `${o.kind === 'listing' ? 'Listed for' : 'Offer'} ${fmtToken(o.price_lamports, 9, 9)} SOL${o.status === 'settling' ? ' · settling' : ''}`))
      if(o.funded===false)row.append(box('note','This offer is hidden from other holders because your wallet cannot currently cover it. Add SOL or cancel it. Funds are not reserved.'))
      if(o.funded===null)row.append(box('note','Funding could not be checked. This offer is hidden until the check succeeds. You can still cancel it.'))
      if (o.is_mine) row.append(button(o.status === 'settling' ? 'Request cancellation' : 'Cancel', async () => { const result = await clubRequest('cancel', { id: o.id }); if (result.status === 'cancelled') row.remove(); else messages.append(box('note', 'Cancellation requested. If the current settlement fails, the order will close. An already confirmed sale cannot be reversed.')) }, { out: messages }))
      panel.append(row)
      rows.push([o, row])
    }
    if (!trading) panel.append(box('note', 'Vault trading is not open yet. You can still cancel your orders. Uncancelled orders remain authorized until they expire and can settle when trading resumes.'))
    if (!holder && !trading) return
    // Cancellation does not depend on a fresh ownership read or an enabled lane.
    const current = await clubRead(`vault?a=${encodeURIComponent(v.asset)}`), mine = s.wallet === current.owner
    if (mine && holder) panel.append(el('section', { class: 'holder-actions' }, el('h4', {}, 'Your vault'),
      button('Activate vault', () => reviewAction(messages, 'activate', { asset: v.asset }), { out: messages }),
      button('Record level draw', () => reviewAction(messages, 'draw', { asset: v.asset }), { out: messages })))
    if (!trading) return
    for (const [o, row] of rows) {
      if (o.status === 'active' && !o.is_mine && o.funded!==false && o.funded!==null) {
        if (o.kind === 'listing' && !mine) row.append(button('Review purchase', () => reviewAction(messages, 'buy_order', { id: o.id }), { out: messages }))
        else if (o.kind === 'offer' && mine) row.append(button('Review this offer', () => reviewAction(messages, 'accept_offer', { id: o.id }), { out: messages }))
      }
    }
    const price = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Price in SOL', 'aria-label': 'Price in SOL' })
    panel.append(price, button(mine ? 'Review listing' : 'Make an offer', async () => {
      const currentReview = beginReview(messages)
      clear(messages).append(box('note', 'Preparing your order review...'))
      let quote
      try { quote = await clubRequest('order', { kind: mine ? 'listing' : 'offer', asset: v.asset, price: price.value.trim() }) }
      catch (e) { if (!currentReview()) return; throw e }
      if (!currentReview()) return
      if (quote.kind !== (mine ? 'listing' : 'offer') || quote.asset !== v.asset || BigInt(quote.seller_lamports) + BigInt(quote.royalty_lamports) !== BigInt(quote.price_lamports) || BigInt(quote.royalty_lamports) !== BigInt(quote.price_lamports) / 10n) throw new Error('The order quote does not match this vault and payment breakdown.')
      const committed=inspectCommitment(quote.vault_state,v.asset,Object.keys(knownTokens))
      if(voteHistoryDigest(quote.vote_history)!==committed.votes_digest)throw Error('The voting history does not match this order. Prepare it again.')
      clear(messages).append(el('h3', {}, mine ? 'Authorize this listing' : 'Authorize this offer'),
        el('p', {}, `Price: ${fmtToken(quote.price_lamports, 9, 9)} SOL (${quote.price_lamports} lamports). Seller receives ${fmtToken(quote.seller_lamports, 9, 9)} SOL. The Bank receives ${fmtToken(quote.royalty_lamports, 9, 9)} SOL. Its 10% royalty rounds down to a whole lamport; the seller receives the remainder.`),
        el('p', {}, `This review must be confirmed within 60 seconds. The standing order expires ${date(Date.parse(quote.expires_at)/1000)}. You may cancel before settlement starts.`))
      messages.append(el('p',{},`Vault level: ${LEVEL_NAMES[committed.level-1]}.`))
      showReserveMinimums(messages,committed.reserves)
      showTradeVotes(messages,quote.vote_history)
      const consent = el('input', { type: 'checkbox', id: 'standing-order-consent' })
      messages.append(el('div', { class: 'ack' }, consent, el('label', { for: 'standing-order-consent' }, mine
        ? 'I authorize Gary Club to sign the transfer of this vault automatically when a buyer accepts this price. I will not be asked to sign again.'
        : `I authorize Gary Club to pay ${fmtToken(quote.price_lamports, 9, 9)} SOL from my wallet automatically when the owner accepts. No funds are reserved. I will not be asked to sign again.`)))
      messages.append(button(mine ? 'Confirm listing' : 'Confirm offer', async () => {
        if (!consent.checked) throw new Error('Accept the standing order authorization to continue.')
        if (!currentReview()) throw new Error('This review was replaced. Review the current order.')
        reviewLocks.add(messages)
        try { await clubRequest('order', { review_token: quote.review_token, acknowledged: 'standing_order_v1' }) }
        finally { reviewLocks.delete(messages) }
        clear(messages).append(box('ok', `${mine ? 'Listing' : 'Offer'} recorded at ${fmtToken(quote.price_lamports, 9, 9)} SOL. Reopen this vault to see it.`))
      }, { out: messages }))
    }, { out: messages }))
  }
  load().catch(e => panel.append(box('refuse', e.message))).finally(() => { panel.dataset.state = 'ready' })
  return panel
}
