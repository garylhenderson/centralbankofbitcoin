import {PublicKey} from '@solana/web3.js'
import {account,chainNow,readVault} from './reads.mjs'
import {absentIfDust} from './decode.mjs'
import {readProposal,proposalAddress,voteAddress,castVoteIx} from './governance.mjs'

import {voteInput} from './ballot-input.mjs'
export {voteInput,ballotBatches,verifyBallotQuote,VOTE_BATCH_LIMIT} from './ballot-input.mjs'
export async function planVotes(conn,ids,owner,input) {
  const chosen=voteInput(input),proposal=new PublicKey(chosen.proposal)
  const a=await account(conn,proposal,'the proposal')
  if(!a?.owner.equals(ids.GOV_PROG))throw Error('This proposal could not be verified.')
  const p=readProposal(a.data)
  if(!proposal.equals(proposalAddress(ids,p.id)))throw Error('This is not a Bank proposal address.')
  if(p.executed||await chainNow(conn)>=Number(p.voting_ends_at))throw Error('Voting has closed on this proposal.')
  const ballots=[]
  for(const b of chosen.ballots) {
    const v=await readVault(conn,ids,new PublicKey(b.asset))
    const label=v.record?.asset===b.asset?`CBOB Vault #${Number(v.record.mint_index)+1} (${b.asset})`:`Vault ${b.asset}`
    if(!v.info||v.info.burned||v.info.collection!==ids.COLL?.toBase58()||v.info.owner!==owner||!v.record||v.record.retired||v.record.asset!==b.asset)throw Error(`${label} is not a live Bank vault held by this wallet. Return to the ballot and exclude it.`)
    if(BigInt(v.record.mint_index)>=BigInt(p.index_snapshot))throw Error(`${label} was issued after this proposal opened. Return to the ballot and exclude it.`)
    if(absentIfDust(await account(conn,voteAddress(ids,proposal,b.asset))))throw Error(`${label} has already voted. Return to the ballot to refresh eligibility.`)
    ballots.push({...b,vault_no:Number(v.record.mint_index)+1,level:v.record.level})
  }
  const details={proposal:chosen.proposal,proposal_id:p.id,ballots,actions:p.actions,voting_ends_at:p.voting_ends_at,quorum_supply:p.quorum_supply,quorum_bps:p.quorum_bps,threshold_bps:p.threshold_bps,index_snapshot:p.index_snapshot}
  return {ixs:ballots.map(b=>castVoteIx(ids,proposal,b.asset,owner,b.support)),details}
}
