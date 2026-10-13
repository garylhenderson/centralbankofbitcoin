import bs58 from 'bs58'
import {el,clear,addr,box,action} from './ui.mjs'
import {date,actionDetails,executionDetails} from './governance-view.mjs'
import {governanceActionInput,planGovernanceAction} from './sale-proposal.mjs'
import {account} from './reads.mjs'
import {keyChangeAcknowledgment} from './ballot-input.mjs'
import {buildForWallet,signExact,sendSigned,setProgramNames} from './tx.mjs'

const effect=p=>JSON.stringify({ixs:p.ixs.map(ix=>({program:ix.programId.toBase58(),data:Array.from(ix.data),keys:ix.keys.map(k=>[k.pubkey.toBase58(),k.isSigner,k.isWritable])})),details:p.details,acks:p.acks})
const key=wallet=>`cbob-pending-proposal:${wallet.publicKey.toBase58()}`
const lockKey=wallet=>`cbob-proposal:${wallet.publicKey.toBase58()}`
export function proposalReceiptText(wallet) {
  try{return (localStorage.getItem(key(wallet))||'No saved receipt.').slice(0,5000)}catch{return 'Restore browser storage access to recover your receipt before signing again.'}
}
export function pendingProposal(wallet) {
  const raw=localStorage.getItem(key(wallet));if(!raw)return null
  try {
    const r=JSON.parse(raw)
    if(r.wallet!==wallet.publicKey.toBase58()||typeof r.signature!=='string'||bs58.decode(r.signature).length!==64||!Number.isSafeInteger(r.lastValidBlockHeight)||r.lastValidBlockHeight<0)throw Error()
    governanceActionInput(r.action,r.input)
    return r
  }catch{throw Error('The saved proposal receipt cannot be read. Keep it for recovery before resetting browser data or signing again.')}
}
async function resolveLocked(conn,wallet) {
  const r=pendingProposal(wallet);if(!r)return null
  const s=(await conn.getSignatureStatuses([r.signature],{searchTransactionHistory:true})).value[0]
  if(s&&['confirmed','finalized'].includes(s.confirmationStatus)) {
    localStorage.removeItem(key(wallet));return {...r,status:s.err?'failed':'complete'}
  }
  if(!s&&await conn.getBlockHeight('finalized')>r.lastValidBlockHeight) {
    localStorage.removeItem(key(wallet));return {...r,status:'failed'}
  }
  return {...r,status:'sending'}
}
export async function resolvePendingProposal(conn,wallet) {
  if(!navigator.locks)throw Error('Use a browser with Web Locks to recover this transaction safely.')
  return navigator.locks.request(lockKey(wallet),{mode:'exclusive',ifAvailable:true},lock=>{if(lock)return resolveLocked(conn,wallet);const saved=pendingProposal(wallet);return saved?{...saved,status:'sending'}:{status:'busy_elsewhere'}})
}
export async function reviewExternalProposal(out,name,input,{conn,ids,profile,wallet,onPending=()=>{},onSettled=()=>{}}) {
  input=governanceActionInput(name,input)
  if(pendingProposal(wallet))throw Error('Check your saved proposal transaction before preparing another.')
  setProgramNames(profile.programs)
  if(await conn.getGenesisHash()!==profile.expectedGenesisHash)throw Error('The wallet connection is not on the expected network.')
  const owner=wallet.publicKey.toBase58(),plan=await planGovernanceAction(conn,ids,owner,name,input)
  const before=(await account(conn,wallet.publicKey))?.lamports??0
  const built=await buildForWallet(conn,plan.ixs,wallet.publicKey,[wallet.publicKey])
  if(built.sim.err)throw Error(`The network dry run refused this action: ${built.sim.explained}`)
  const after=built.sim.accounts?.[0]?.lamports
  if(!Number.isSafeInteger(before)||!Number.isSafeInteger(after))throw Error('The wallet cost could not be estimated. Review again when the chain is readable.')
  const solChange=(after-before)/1e9
  const fee=await conn.getFeeForMessage(built.tx.compileMessage(),'confirmed')
  if(fee.value===null)throw Error('The network could not quote its fee.')
  clear(out).append(el('h3',{},`${name==='propose'?'File':'Execute'} Proposal ${plan.details.proposal_id}`),addr(owner),el('p',{},'Proposal address: ',addr(plan.details.proposal)),el('p',{},`Voting deadline: ${date(plan.details.voting_ends_at)}.`),...plan.details.actions.map(actionDetails),el('p',{},`Network fee: ${fee.value/1e9} SOL. Creating a proposal also requires SOL rent. Your wallet reviews the transaction before signing.`))
  out.append(el('p',{class:'estimated-wallet-change'},`Estimated wallet SOL change, including rent and fees: ${solChange} SOL. This estimate can change before signing.`))
  if(name==='execute_proposal')out.append(executionDetails(plan.details.execution))
  if(plan.details.execution_window_closes)out.append(el('p',{class:plan.details.execution_window_closes_soon?'warn':'sub'},`Execution window ends: ${date(plan.details.execution_window_closes)}.`))
  const acks=[...plan.acks],keyAck=keyChangeAcknowledgment(plan.details.actions)
  if(keyAck)acks.push(keyAck)
  const checks=acks.map(a=>{const check=el('input',{type:'checkbox'});out.append(el('label',{class:'ack'},check,' '+a.text));return check})
  const messages=el('div',{role:'status'});let sending=false
  const finish=result=>{
    if(!result||['sending','busy_elsewhere'].includes(result.status))return false
    sending=false
    clear(out).append(box(result.status==='complete'?'ok':'warn',result.status==='complete'?'Confirmed on chain. The public voting record updates within about ten minutes.':'This transaction did not complete.'),el('p',{},'Transaction: ',el('code',{},result.signature)))
    if(result.status==='complete'&&name==='propose')out.append(el('a',{class:'btn',href:`/governance/?p=${plan.details.proposal}${location.search.includes('wallet=external')?'&wallet=external':''}`},'Open the proposal and cast your votes'))
    onSettled(result);return true
  }
  out.append(action(name==='propose'?'Sign this proposal':'Sign execution',async()=>{
    if(!navigator.locks)throw Error('Use a browser with Web Locks to prevent overlapping signatures.')
    await navigator.locks.request(lockKey(wallet),{mode:'exclusive',ifAvailable:true},async lock=>{
      if(!lock)throw Error('Another tab is confirming a proposal transaction for this wallet.')
      if(sending)return
      if(checks.some(c=>!c.checked))throw Error('Read and approve every acknowledgment first.')
      if(pendingProposal(wallet))throw Error('Check the earlier transaction before signing again.')
      const fresh=await planGovernanceAction(conn,ids,owner,name,input)
      if(effect(fresh)!==effect(plan))throw Error('The proposal or Bank settings changed. Return to your draft and review again.')
      const next=await buildForWallet(conn,fresh.ixs,wallet.publicKey,[wallet.publicKey])
      if(next.sim.err)throw Error('The fresh dry run was refused. Return to your draft and review again.')
      if((await conn.getFeeForMessage(next.tx.compileMessage(),'confirmed')).value!==fee.value)throw Error('The network fee changed. Review the new fee before signing.')
      localStorage.setItem(key(wallet)+':probe','1');localStorage.removeItem(key(wallet)+':probe')
      sending=true;onPending()
      let signed
      try {signed=await signExact(wallet,next.tx,[],{minUnits:next.minUnits})}
      catch(e){sending=false;onSettled({status:'prepared'});throw e}
      const record={wallet:owner,signature:bs58.encode(signed.signature),lastValidBlockHeight:next.lastValidBlockHeight,action:name,input}
      try {localStorage.setItem(key(wallet),JSON.stringify(record));if(localStorage.getItem(key(wallet))!==JSON.stringify(record))throw Error()}
      catch {sending=false;onSettled({status:'prepared'});throw Error('The receipt could not be saved. Nothing was broadcast.')}
      clear(out).append(box('note','Your signed transaction is being confirmed. Keep this receipt.'),el('code',{},record.signature))
      try {await sendSigned(conn,signed,next.blockhash,next.lastValidBlockHeight)}
      catch {out.append(box('warn','The network has not confirmed the transaction. Your receipt is saved. Check its status before signing another copy.'))}
      const check=async held=>{try{const result=await (held?resolveLocked(conn,wallet):resolvePendingProposal(conn,wallet));if(!result)messages.append(box('note','No saved transaction remains in this browser. Check the wallet history before starting another proposal.'));else if(result.status==='busy_elsewhere')messages.append(box('note','Another tab is reviewing a proposal. No saved transaction was found. Return to the desk after that review closes.'));else if(!finish(result))messages.append(box('note','Still awaiting confirmation. Do not sign another copy.'))}catch{messages.append(box('warn','Transaction status is unavailable. Your receipt is saved.'))}}
      out.append(action('Check transaction',()=>check(false),{out:messages}),messages)
      await check(true)
    })
  },{out:messages}),messages)
}
