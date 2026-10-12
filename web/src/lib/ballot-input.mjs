import {PublicKey} from '@solana/web3.js'
// Bounded at four instructions; the builder and wallet validate packet size.
// A larger ballot is explicitly reviewed in separate atomic transactions.
export const VOTE_BATCH_LIMIT=4
const address=value=>{
  if(typeof value!=='string'||new PublicKey(value).toBase58()!==value)throw Error('Invalid vote address.')
  return value
}
export function voteInput(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid ballot.')
  const batch=Object.hasOwn(input,'ballots'),allowed=batch?['proposal','ballots']:['proposal','asset','support']
  if(Object.keys(input).some(k=>!allowed.includes(k)))throw Error('Unexpected ballot details.')
  const proposal=address(input.proposal)
  const ballots=batch?input.ballots:[{asset:input.asset,support:input.support}]
  if(!Array.isArray(ballots)||!ballots.length||ballots.length>VOTE_BATCH_LIMIT)throw Error(`Choose one to ${VOTE_BATCH_LIMIT} vaults per transaction.`)
  const seen=new Set()
  return {proposal,ballots:ballots.map(b=>{
    if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['asset','support'].includes(k))||typeof b.support!=='boolean')throw Error('Choose Yes or No for each vault.')
    const asset=address(b.asset)
    if(seen.has(asset))throw Error('A vault can appear only once in a ballot.')
    seen.add(asset);return {asset,support:b.support}
  })}
}
export function ballotBatches(ballots) {
  const batches=[]
  for(let i=0;i<ballots.length;i+=VOTE_BATCH_LIMIT)batches.push(ballots.slice(i,i+VOTE_BATCH_LIMIT).map(b=>({...b})))
  return batches
}
export function verifyBallotQuote(details,input) {
  const chosen=voteInput(input)
  if(details?.proposal!==chosen.proposal||!Array.isArray(details.ballots)||details.ballots.length!==chosen.ballots.length||details.ballots.some((b,i)=>b.asset!==chosen.ballots[i].asset||b.support!==chosen.ballots[i].support))throw Error('The ballot does not match your choices. Prepare it again.')
}
export function keyChangeAcknowledgment(actions) {
  if(!actions.some(a=>a.kind==='ArmSwapOperator'||(a.kind==='Brakes'&&a.set_guardian)))return null
  return {id:'bank_key_change',text:`${actions.some(a=>a.kind==='Brakes'&&a.set_guardian&&!a.guardian)?'This proposal removes the guardian brake.':'This proposal changes a Bank operator or guardian key.'} It requires Yes votes from at least half of the snapshotted live vaults. The key change takes effect only after the notice period, unless a newer decision has overtaken it. Any restart in this proposal takes effect when the proposal is executed. Review the exact change before voting.`}
}
