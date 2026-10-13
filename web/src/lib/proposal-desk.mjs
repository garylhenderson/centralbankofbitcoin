import {activeProfile} from '../config.js'
import {makeIds} from './ids.mjs'
import {connect,anchorAccount,readConfigs,chainNow} from './reads.mjs'
import {connectWallet,externalWalletMode} from './holder-wallet.mjs'
import {readClubSession,signInLink} from './club.mjs'
import {reviewAction} from './club-actions.mjs'
import {reviewExternalProposal,resolvePendingProposal,proposalReceiptText} from './external-proposal.mjs'
import {saleProposalInput,austinTimestamp,cbBTCPrice} from './sale-proposal.mjs'
import {el,clear,addr,box,action,amount} from './ui.mjs'
import {date} from './governance-view.mjs'

let openDesk=null
export const executeAtDesk=proposal=>openDesk?.(proposal)
export function mountProposalDesk(anchor) {
  const profile=activeProfile(),ids=makeIds(profile),external=externalWalletMode()
  let wallet=null,session=null,busy=false,pending=false,mode='propose',target=null
  const desk=el('details',{class:'proposal-desk',id:'proposal-desk'}),body=el('div',{class:'proposal-desk-body'})
  const heading=el('h2',{},'Put the next round to a vote.'),identity=el('div',{class:'proposal-identity'}),messages=el('div',{role:'status'}),review=el('div',{class:'action-review','aria-live':'polite'})
  const form=el('form',{class:'proposal-form'}),fields={}
  const field=(name,label,attrs,hint)=>{
    const input=el('input',{id:`proposal-${name}`,required:true,...attrs}),wrap=el('div',{class:'proposal-field'},el('label',{for:input.id},label),input)
    if(hint){const h=el('p',{class:'sub',id:`${input.id}-hint`},hint);input.setAttribute('aria-describedby',h.id);wrap.append(h)}
    fields[name]=input;return wrap
  }
  const vault=field('asset','Your proposing vault',{type:'text',placeholder:'Paste its vault address',spellcheck:false},'Any live vault you own can file the proposal. Ownership is checked on chain.')
  const sale=el('fieldset',{},el('legend',{},'01 / Set the terms'),vault,
    field('price','Price per vault, in cbBTC',{type:'text',inputmode:'decimal',placeholder:'Enter a price'},'Minimum 0.00021000 cbBTC (21,000 sats). This is the sale price, separate from the deposit inside a vault.'),
    field('cap','Maximum vaults in this round',{type:'number',min:1,max:2100,step:1,placeholder:'Choose a cap'},'The lifetime limit remains 2,100. A round cannot increase it.'))
  const schedule=el('fieldset',{},el('legend',{},'02 / Give holders time to decide'),
    field('voting_ends_at','Voting closes, Austin time',{type:'datetime-local'},'The Bank checks its minimum voting period at submission; the maximum is 30 days.'),
    field('opens_at','Sale opens, Austin time',{type:'datetime-local'},'Choose a time after voting closes. Leave time for someone to execute the passed proposal.'),
    field('closes_at','Sale closes, Austin time',{type:'datetime-local'},'The sale window can last up to 365 days.'))
  const preview=el('aside',{class:'proposal-preview','aria-live':'polite'},el('span',{class:'eyebrow'},'THE MOTION'),el('h3',{},'Your terms. Their decision.'),el('p',{},'Choose a price and cap to see the proposed round.'))
  const reviewButton=el('button',{class:'btn',type:'submit'},'Review proposal'),back=action('Back to draft',()=>{
    if(pending)throw Error('Check the pending transaction before returning to the draft.')
    clear(review);setBusy(false);back.hidden=true
  },{out:messages});back.hidden=true
  form.append(el('div',{class:'proposal-fields'},sale,schedule),preview,reviewButton)
  form.addEventListener('input',()=>{
    try {
      const price=cbBTCPrice(fields.price.value.trim()),cap=fields.cap.value
      if(!/^[1-9]\d*$/.test(cap)||BigInt(cap)>2100n||BigInt(price)<21000n)throw Error()
      clear(preview).append(el('span',{class:'eyebrow'},'THE MOTION'),el('h3',{},`Up to ${cap} vault${cap==='1'?'':'s'}.`),el('p',{class:'proposal-price'},`${amount(price,8)} cbBTC each`),el('p',{},'Price goes to Bank revenue: 85% to activated vaults and 15% to the Bank’s treasury.'),el('p',{class:'sub'},'Each purchased vault starts empty. It needs its own 21,000-sat cbBTC deposit to activate. Creating this proposal issues no vaults and casts no votes.'))
      if(fields.closes_at.value&&fields.voting_ends_at.value) {
        try { if(BigInt(austinTimestamp(fields.closes_at.value))<BigInt(austinTimestamp(fields.voting_ends_at.value))+604800n)preview.append(box('warn','This sale ends before the seven-day execution window does. A passed proposal must be executed before the sale closes to start this round.')) } catch { /* Date validation at review explains invalid Austin times. */ }
      }
    }catch{clear(preview).append(el('span',{class:'eyebrow'},'THE MOTION'),el('h3',{},'Your terms. Their decision.'),el('p',{},'Choose a valid price and vault cap to preview the round.'))}
  })
  const owner=()=>external?wallet?.publicKey.toBase58():session?.wallet
  function setBusy(value) {
    busy=value
    if(value)desk.setAttribute('data-vote-review-active','');else desk.removeAttribute('data-vote-review-active')
    form.querySelectorAll('input,select,button').forEach(n=>n.disabled=value)
    identity.querySelectorAll('button').forEach(n=>n.disabled=value)
    const choice=document.querySelector('.wallet-choice');if(choice)choice.inert=value
  }
  const options={onPending:()=>{pending=true;back.hidden=true},onSettled:r=>{
    pending=false
    if(r.status==='complete'){back.hidden=true;setBusy(true);desk.removeAttribute('data-vote-review-active');review.append(el('a',{class:'btn secondary',href:'/governance/'},'Return to the voting room'));return}
    // Keep the draft locked until the holder explicitly leaves the old review.
    back.hidden=false
  }}
  async function recover() {
    try {
      const result=await resolvePendingProposal(connect(profile),wallet)
      if(result?.status==='busy_elsewhere')throw Error('Another tab is reviewing a proposal. Close that review before continuing. No saved transaction was found.')
      if(result?.status==='sending')throw Error('A proposal transaction is still pending. Check it before signing again.')
      if(result)identity.append(box(result.status==='complete'?'ok':'note',result.status==='complete'?'Your saved transaction confirmed. Check the voting record before filing another proposal.':'Your saved transaction did not complete.'),el('code',{},result.signature))
      pending=false;setBusy(false)
    }catch(e){
      pending=true;setBusy(true)
      identity.append(box('warn',e.message),el('details',{},el('summary',{},'Saved transaction receipt'),el('pre',{class:'logs'},proposalReceiptText(wallet))),action('Check saved transaction',recover,{out:identity}))
    }
  }
  async function chooseVaults() {
    if(!owner())return
    vault.querySelector('select')?.remove()
    try {
      const r=await fetch('/data/vaults.json',{cache:'no-store'});if(!r.ok)throw Error()
      const data=await r.json(),mine=data.vaults.filter(v=>v.owner===owner()&&v.status!=='opened')
      if(!mine.length)return
      const picker=el('select',{'aria-label':'Choose your proposing vault'},el('option',{value:''},'Choose from your vaults'))
      for(const v of mine)picker.append(el('option',{value:v.asset},`CBOB Vault #${v.no}`))
      picker.addEventListener('change',()=>{if(picker.value)fields.asset.value=picker.value});picker.disabled=busy;vault.append(picker)
    }catch{identity.append(el('p',{class:'sub'},'The vault picker is unavailable. You can still paste a vault address; ownership is checked live.'))}
  }
  async function boot() {
    clear(identity)
    if(external) {
      identity.append(action('Connect your wallet',async()=>{
        wallet=await connectWallet(profile);clear(identity).append(el('p',{},'Using your wallet'),addr(owner()));await recover();await chooseVaults()
      },{out:identity}))
    } else {
      try {
        session=await readClubSession()
        if(!session)identity.append(el('p',{},'Draft the round, then sign in to file it with your Gary Club wallet.'),el('a',{class:'btn',href:signInLink('/governance/')},'Sign in with Gary Club'),el('a',{class:'btn secondary',href:signInLink('/governance/',true)},'Create an account'))
        else {identity.append(el('p',{},'Using your Gary Club wallet'),addr(session.wallet));await chooseVaults()}
      }catch{identity.append(box('warn','Gary Club account access is temporarily unavailable. Your draft remains available.'),action('Retry account',boot,{out:identity}))}
    }
    if(!ids.COLL)identity.append(box('note','You can draft now. Proposals can be filed after the Bank is initialized and the seven-day charter window has closed.'))
    else try {
      const conn=connect(profile),[gov,cfg,now]=await Promise.all([anchorAccount(conn,'GovConfig',ids.GOV_CFG,ids.GOV_PROG),readConfigs(conn,ids),chainNow(conn)])
      identity.append(el('p',{class:'sub'},`Minimum voting period: ${Number(gov.min_voting_secs)/3600} hours from submission. Charter closes ${date(cfg.mint.charter_closes_at)}.${now<Number(cfg.mint.charter_closes_at)?' Filing is not open yet.':''}`))
    }catch{identity.append(box('note','Live voting settings are unavailable. Preparing a review requires a fresh network check.'))}
  }
  async function prepare() {
    if(busy)throw Error('Finish or close the current review first.')
    if(!owner())throw Error(external?'Connect your wallet before reviewing.':'Sign in with Gary Club before reviewing.')
    if(!external&&session.holderActionsEnabled!==true)throw Error('Holder actions are awaiting activation. You can keep working on this draft.')
    const input=mode==='execute_proposal'?{proposal:target}:saleProposalInput({asset:fields.asset.value.trim(),price:cbBTCPrice(fields.price.value.trim()),cap:fields.cap.value,voting_ends_at:austinTimestamp(fields.voting_ends_at.value),opens_at:austinTimestamp(fields.opens_at.value),closes_at:austinTimestamp(fields.closes_at.value)})
    setBusy(true);clear(messages);clear(review).append(box('note','Checking the live proposal rules...'))
    try {
      if(external)await reviewExternalProposal(review,mode,input,{...options,conn:connect(profile),ids,profile,wallet})
      else await reviewAction(review,mode,input,options)
      back.hidden=false;review.scrollIntoView({block:'start',behavior:'smooth'})
    }catch(e){clear(review);setBusy(false);throw e}
  }
  form.addEventListener('submit',async e=>{e.preventDefault();try{await prepare()}catch(err){messages.append(box('refuse',err.message))}})
  const executeButton=action('Review execution',prepare,{out:messages}),newDraft=action('Draft a sale round',()=>openDesk(null),{out:messages});executeButton.hidden=true;newDraft.hidden=true
  openDesk=proposal=>{
    if(busy||pending){desk.open=true;desk.scrollIntoView({block:'start'});return}
    target=proposal;mode=proposal?'execute_proposal':'propose';form.hidden=!!proposal;executeButton.hidden=!proposal;newDraft.hidden=!proposal
    heading.textContent=proposal?'Put a passed decision into effect.':'Put the next round to a vote.'
    clear(review);clear(messages);if(proposal)messages.append(el('p',{},'The Bank will recheck the result and seven-day execution window on chain. Review every action before signing.'),addr(proposal))
    desk.open=true;desk.scrollIntoView({block:'start',behavior:'smooth'})
  }
  desk.append(el('summary',{},el('span',{class:'eyebrow'},'THE GOVERNORS’ DESK'),el('span',{},'File a sale-round proposal'),el('span',{'aria-hidden':'true'},'+')),body)
  body.append(heading,el('p',{class:'hero-lede'},'A vault gives you a voice. Set out the terms, let holders vote, then execute the decision if it passes.'),identity,form,executeButton,newDraft,messages,review,back)
  anchor.before(desk);boot()
}
