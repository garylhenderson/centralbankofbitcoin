import bs58 from 'bs58'
import {el,clear,addr,box,action} from './ui.mjs'
import {date,actionDetails} from './governance-view.mjs'
import {planVotes,verifyBallotQuote} from './vote-plan.mjs'
import {voteInput} from './ballot-input.mjs'
import {buildForWallet,signExact,sendSigned,setProgramNames} from './tx.mjs'
const effect=ixs=>JSON.stringify(ixs.map(ix=>({program:ix.programId.toBase58(),data:Array.from(ix.data),keys:ix.keys.map(k=>[k.pubkey.toBase58(),k.isSigner,k.isWritable])})))
const key=wallet=>`cbob-pending-vote:${wallet.publicKey.toBase58()}`
export function pendingVote(wallet) {
  const raw=localStorage.getItem(key(wallet));if(!raw)return null
  const record=JSON.parse(raw)
  if(typeof record.signature!=='string'||bs58.decode(record.signature).length!==64||!Number.isSafeInteger(record.lastValidBlockHeight)||record.lastValidBlockHeight<0)throw Error('The saved vote receipt needs recovery before another ballot can be signed.')
  voteInput({proposal:record.proposal,ballots:record.ballots})
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
    if(!consent.checked)throw Error('Read and approve the exact ballot first.')
    if(pendingVote(wallet))throw Error('Check the earlier transaction before signing again.')
    // Re-read ownership, deadline and prior votes immediately before signing.
    const fresh=await planVotes(conn,ids,owner,input)
    if(effect(fresh.ixs)!==effect(plan.ixs)||JSON.stringify(fresh.details)!==JSON.stringify(plan.details))throw Error('The ballot changed. Close this review and prepare it again.')
    if(await conn.getBlockHeight('confirmed')>built.lastValidBlockHeight)throw Error('This transaction expired. Prepare it again.')
    // Prove persistent recovery is available BEFORE opening the wallet.
    localStorage.setItem(key(wallet)+':probe','1');localStorage.removeItem(key(wallet)+':probe')
    sending=true;onPending()
    let signed
    try {signed=await signExact(wallet,built.tx,[],{minUnits:built.minUnits})}
    catch(e){sending=false;onSettled({status:'prepared'});throw e}
    const record={signature:bs58.encode(signed.signature),lastValidBlockHeight:built.lastValidBlockHeight,proposal:input.proposal,ballots:input.ballots.map(b=>({...b}))}
    try {localStorage.setItem(key(wallet),JSON.stringify(record));if(localStorage.getItem(key(wallet))!==JSON.stringify(record))throw Error()}
    catch {sending=false;onSettled({status:'prepared'});throw Error('The receipt could not be saved. Nothing was broadcast.')}
    clear(out).append(box('note','Your signed ballot is being confirmed. Keep this receipt.'),el('code',{},record.signature))
    try {await sendSigned(conn,signed,built.blockhash,built.lastValidBlockHeight)} catch { /* status evidence, never a second signature */ }
    const check=async(lockHeld=false)=>{try{const result=await (lockHeld?resolveLocked(conn,wallet):resolvePendingVote(conn,wallet));if(!finish(result))messages.append(box('note','Still awaiting confirmation. Do not sign another copy.'))}catch{messages.append(box('warn','The transaction status is temporarily unavailable. Your receipt is saved.'))}}
    out.append(action('Check transaction',()=>check(),{out:messages}),messages)
    await check(true)
    })
  },{out:messages})
  out.append(submit,messages)
}
