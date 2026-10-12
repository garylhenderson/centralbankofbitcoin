import {el,clear,box,action} from './ui.mjs'
import {ballotBatches} from './ballot-input.mjs'

/** No default choices and no automatic confirmations. Each transaction is reviewed. */
export function ballotEditor({proposal,vaults,reviewBatch,onComplete,onBusy,onClose,draft=new Map()}) {
  const form=el('div',{class:'action-form ballot-editor'}),out=el('div',{'aria-live':'polite'}),progress=el('div',{class:'ballot-summary',role:'status'})
  const controls=[],choices=new Map(),rows=el('div',{class:'ballot-list-editor'})
  const tally=()=>{for(const [asset,s] of choices){if(s.value)draft.set(asset,s.value);else draft.delete(asset)}const values=[...choices.values()].map(s=>s.value);progress.textContent=`${values.filter(v=>v==='yes').length} Yes · ${values.filter(v=>v==='no').length} No · ${values.filter(v=>v==='').length} not voting`}
  const setAll=value=>{for(const s of choices.values())s.value=value;tally()}
  const toolbar=el('div',{class:'ballot-toolbar'})
  for(const [label,value] of [['All Yes','yes'],['All No','no'],['Clear choices','']]) {
    const b=el('button',{class:'btn secondary',type:'button',onclick:()=>setAll(value)},label);controls.push(b);toolbar.append(b)
  }
  for(const v of vaults) {
    const s=el('select',{'aria-label':`Vote for CBOB Vault #${v.no}`},el('option',{value:''},'Not voting'),el('option',{value:'yes'},'Yes'),el('option',{value:'no'},'No'))
    s.value=draft.get(v.asset)||''
    choices.set(v.asset,s);controls.push(s);s.addEventListener('change',tally)
    rows.append(el('label',{class:'ballot-choice-row'},el('span',{},`CBOB Vault #${v.no}`),s))
  }
  let batches=[],index=0,reviewing=false,finished=false,pending=false
  const close=el('button',{class:'btn secondary',type:'button',onclick:()=>{if(close.disabled)return;onBusy(false);delete out.dataset.voteReviewActive;onClose()}},'Return to ballot')
  close.hidden=true
  const next=action('Review next transaction',async()=>{if(!finished)throw Error('Wait for this transaction to finish.');await showBatch()},{out});next.hidden=true
  async function showBatch() {
    finished=false;pending=false;next.hidden=true;close.disabled=true
    const batch=batches[index]
    progress.textContent=`Transaction ${index+1} of ${batches.length} · ${batch.filter(b=>b.support).length} Yes / ${batch.filter(b=>!b.support).length} No`
    try {
      await reviewBatch(out,{proposal:proposal.address,ballots:batch.map(b=>({...b}))},{onSettled:result=>{
        pending=false;close.disabled=false
        if(result.status==='complete'&&!finished) {
          finished=true;for(const b of batch)draft.delete(b.asset);onComplete(batch);index++
          if(index<batches.length){next.hidden=false;next.disabled=false}
          else {progress.textContent='Your ballot is recorded. Every confirmed vault vote appears in the public register.';close.textContent='Back to proposals'}
        }
      },onPending:()=>{pending=true;close.disabled=true}})
      // Review is prepared, not signed. A pending or uncertain result calls
      // onPending, while a terminal result alone re-enables the close button.
      if(!pending)close.disabled=false
    } catch(e) {out.append(box('refuse',e.message||'The ballot could not be prepared.'));close.disabled=false}
  }
  const review=action('Review ballot',async()=>{
    if(reviewing)return
    const selected=[...choices].filter(([,s])=>s.value!=='').map(([asset,s])=>({asset,support:s.value==='yes'}))
    if(!selected.length)throw Error('Choose Yes or No for at least one vault.')
    reviewing=true;batches=ballotBatches(selected);index=0
    controls.forEach(n=>n.disabled=true);review.hidden=true;close.hidden=false;out.dataset.voteReviewActive='true';onBusy(true)
    await showBatch()
  },{out});controls.push(review)
  form.append(toolbar,rows,progress,review,next,close)
  tally()
  return el('div',{class:'holder-ballot'},el('h3',{},'Your vaults. Your vote.'),el('p',{},'Choose one side for all your vaults, or split them below. Nothing is voted until you review and confirm. Large ballots use several transactions; earlier confirmed votes stay recorded if you stop.'),form,out)
}
