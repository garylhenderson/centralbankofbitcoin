import {voteAddress,readVote} from './governance.mjs'
import {absentIfDust} from './decode.mjs'
// Live vote records prevent the ten-minute public return from offering a vault
// that already voted on another tab/device. Ownership is checked by the planner.
export async function recordedVaultVotes(conn,ids,proposal,assets) {
  const recorded=new Set()
  for(let i=0;i<assets.length;i+=100) {
    const batch=assets.slice(i,i+100),rows=await conn.getMultipleAccountsInfo(batch.map(a=>voteAddress(ids,proposal,a)),'confirmed')
    if(rows.length!==batch.length)throw Error('The live vote record is incomplete.')
    rows.forEach((raw,j)=>{
      const account=absentIfDust(raw);if(!account)return
      if(!account.owner.equals(ids.GOV_PROG))throw Error('A live vote record could not be verified.')
      const vote=readVote(account.data)
      if(vote.proposal!==proposal||vote.asset!==batch[j])throw Error('A live vote record does not match this ballot.')
      recorded.add(batch[j])
    })
  }
  return recorded
}
