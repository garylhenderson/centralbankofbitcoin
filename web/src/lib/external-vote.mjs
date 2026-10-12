import bs58 from 'bs58'
import {el,clear,addr,box,action} from './ui.mjs'
import {date,actionDetails} from './governance-view.mjs'
import {planVotes,verifyBallotQuote} from './vote-plan.mjs'
import {voteInput,keyChangeAcknowledgment} from './ballot-input.mjs'
import {buildForWallet,signExact,sendSigned,setProgramNames} from './tx.mjs'
const effect=ixs=>JSON.stringify(ixs.map(ix=>({program:ix.programId.toBase58(),data:Array.from(ix.data),keys:ix.keys.map(k=>[k.pubkey.toBase58(),k.isSigner,k.isWritable])})))
const key=wallet=>`cbob-pending-vote:${wallet.publicKey.toBase58()}`
export function voteReceiptText(wallet) {
  try{return (localStorage.getItem(key(wallet))||'No saved receipt.').slice(0,5000)}catch{return 'This browser cannot read its saved receipt. Restore browser storage access before voting again.'}
}
export function pendingVote(wallet) {
  const raw=localStorage.getItem(key(wallet));if(!raw)return null
  let record
  try {
  record=JSON.parse(raw)
  if(typeof record.signature!=='string'||bs58.decode(record.signature).length!==64||!Number.isSafeInteger(record.lastValidBlockHeight)||record.lastValidBlockHeight<0)throw Error('The saved vote receipt needs recovery before another ballot can be signed.')
  voteInput({proposal:record.proposal,ballots:record.ballots})
  }catch{throw Error('The saved vote receipt cannot be read. Keep the receipt below and ask the Bank to verify it before resetting browser data.')}
  return record
}
export async function resolvePendingVote(conn,wallet) {
  if(!navigator.locks)throw Error('Use a browser with Web Locks to recover the saved ballot safely.')
  return navigator.locks.request(`cbob-vote:${wallet.publicKey.toBase58()}`,{mode:'exclusive',ifAvailable:true},lock=>{
    if(!lock) return {...pendingVote(wallet),status:'sending'}
    return resolveLocked(conn,wallet)
  })
}
async function resolveLocked(conn,wallet) {
  const record=pendingVote(wallet);if(!record)return null
  const response=await conn.getSignatureStatuses([record.signature],{searchTransactionHistory:true}),status=response.value[0]
  if(status&&['confirmed','finalized'].includes(status.confirmationStatus)) {
    localStorage.removeItem(key(wallet));return {...record,status:status.err?'failed':'complete'}
  }
  if(!status&&await conn.getBlockHeight('finalized')>record.lastValidBlockHeight) {
    localStorage.removeItem(key(wallet));return {...record,status:'failed'}
  }
  return {...record,status:'sending'}
}
export async function reviewExternalVote(out,input,{conn,ids,profile,wallet,onSettled,onPending}) {
  input=voteInput(input)
  if(pendingVote(wallet))throw Error('Check the saved vote transaction before preparing another ballot.')
  setProgramNames(profile.programs)
  if(await conn.getGenesisHash()!==profile.expectedGenesisHash)throw Error('The wallet connection is not on the expected network.')
  const owner=wallet.publicKey.toBase58(),plan=await planVotes(conn,ids,owner,input)
  verifyBallotQuote(plan.details,input)
  const built=await buildForWallet(conn,plan.ixs,wallet.publicKey,[wallet.publicKey])
  if(built.sim.err)throw Error(`The ballot dry run was refused: ${built.sim.explained}`)
  const fee=await conn.getFeeForMessage(built.tx.compileMessage(),'confirmed')
  if(fee.value===null)throw Error('The network could not quote its fee.')
  clear(out).append(el('h3',{},`Proposal ${plan.details.proposal_id}: your ballot`),addr(owner),el('p',{},`Voting ends ${date(plan.details.voting_ends_at)}.`),...plan.details.ballots.map(b=>el('p',{},`CBOB Vault #${b.vault_no}: ${b.support?'YES':'NO'} `,addr(b.asset))),...plan.details.actions.map(actionDetails),el('p',{},`Network fee: ${fee.value/1e9} SOL. Each new vote record also requires SOL rent. Your wallet reviews the transaction before signing.`))
  const consent=el('input',{type:'checkbox'}),messages=el('div',{role:'status'})
  out.append(el('label',{class:'ack'},consent,' I approve exactly these permanent vault votes. A transfer does not reset them.'))
  const keyAck=keyChangeAcknowledgment(plan.details.actions),keyConsent=keyAck?el('input',{type:'checkbox'}):null
  if(keyConsent)out.append(el('label',{class:'ack'},keyConsent,' '+keyAck.text))
  let sending=false
  function finish(result) {
    if(!result||result.status==='sending')return false
    sending=false;clear(out).append(box(result.status==='complete'?'ok':'warn',result.status==='complete'?'Confirmed on chain.':'This transaction did not complete. Your earlier confirmed transactions are unchanged.'),el('p',{},'Transaction: ',el('code',{},result.signature)))
    onSettled(result);return true
  }
  const submit=action('Sign these votes',async()=>{
    if(!navigator.locks)throw Error('Use a browser with Web Locks to prevent overlapping ballot signatures.')
    await navigator.locks.request(`cbob-vote:${owner}`,{mode:'exclusive',ifAvailable:true},async lock=>{
    if(!lock)throw Error('Another tab is confirming a ballot for this wallet.')
    if(sending)return
    if(!consent.checked||keyConsent&&!keyConsent.checked)throw Error('Read and approve the exact ballot and every acknowledgment first.')
    if(pendingVote(wallet))throw Error('Check the earlier transaction before signing again.')
    // Re-read ownership, deadline and prior votes immediately before signing.
    const fresh=await planVotes(conn,ids,owner,input)
    if(effect(fresh.ixs)!==effect(plan.ixs)||JSON.stringify(fresh.details)!==JSON.stringify(plan.details))throw Error('The ballot changed. Close this review and prepare it again.')
    const signingBuild=await buildForWallet(conn,fresh.ixs,wallet.publicKey,[wallet.publicKey])
    if(signingBuild.sim.err)throw Error('The fresh ballot dry run was refused. Return to the ballot and review it again.')
    const freshFee=await conn.getFeeForMessage(signingBuild.tx.compileMessage(),'confirmed')
    if(freshFee.value!==fee.value)throw Error('The network fee changed. Return to the ballot and review the new fee.')
    // Prove persistent recovery is available BEFORE opening the wallet.
    localStorage.setItem(key(wallet)+':probe','1');localStorage.removeItem(key(wallet)+':probe')
    sending=true;onPending()
    let signed
    try {signed=await signExact(wallet,signingBuild.tx,[],{minUnits:signingBuild.minUnits})}
    catch(e){sending=false;onSettled({status:'prepared'});throw e}
    const record={signature:bs58.encode(signed.signature),lastValidBlockHeight:signingBuild.lastValidBlockHeight,proposal:input.proposal,ballots:input.ballots.map(b=>({...b}))}
    try {localStorage.setItem(key(wallet),JSON.stringify(record));if(localStorage.getItem(key(wallet))!==JSON.stringify(record))throw Error()}
    catch {sending=false;onSettled({status:'prepared'});throw Error('The receipt could not be saved. Nothing was broadcast.')}
    clear(out).append(box('note','Your signed ballot is being confirmed. Keep this receipt.'),el('code',{},record.signature))
    try {await sendSigned(conn,signed,signingBuild.blockhash,signingBuild.lastValidBlockHeight)} catch(e) {
      const reason=String(e?.message||'')
      out.append(box('warn',/https?:|secret|api.key/i.test(reason)?'The network could not confirm this transaction.':reason.slice(0,300)||'The network could not confirm this transaction.',' Your receipt is saved. Check its status before trying again.'))
    }
    const check=async(lockHeld=false)=>{try{const result=await (lockHeld?resolveLocked(conn,wallet):resolvePendingVote(conn,wallet));if(!finish(result))messages.append(box('note','Still awaiting confirmation. Do not sign another copy.'))}catch{messages.append(box('warn','The transaction status is temporarily unavailable. Your receipt is saved.'))}}
    out.append(action('Check transaction',()=>check(),{out:messages}),messages)
    await check(true)
    })
  },{out:messages})
  out.append(submit,messages)
}
