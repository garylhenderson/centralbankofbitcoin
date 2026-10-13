import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { acctDisc } from '../src/lib/enc.mjs'
import { readVote, voteAddress } from '../src/lib/governance.mjs'
import { voteHistoryDigest, MAX_TRADE_VOTES } from '../src/lib/trade-state.mjs'

/** Read the immutable ballots belonging to this vault, never a cached index. */
export async function tradeVotes(conn,ids,asset) {
  const address=new PublicKey(asset).toBase58()
  // This slot is fetched after the vault/reserve reads; a lagging node must
  // catch up or refuse instead of returning an older ballot snapshot.
  const minContextSlot=await conn.getSlot('confirmed')
  if(!Number.isSafeInteger(minContextSlot)||minContextSlot<0)throw Error('The vault voting history could not be verified.')
  const rows=await conn.getProgramAccounts(ids.GOV_PROG,{commitment:'confirmed',minContextSlot,filters:[
    {dataSize:74},{memcmp:{offset:0,bytes:bs58.encode(acctDisc('VoteRecord'))}},
    {memcmp:{offset:40,bytes:address}},
  ]})
  if(!Array.isArray(rows)||rows.length>MAX_TRADE_VOTES)throw Error('The vault voting history could not be verified.')
  const votes=rows.map(({pubkey,account})=>{
    if(!account.owner.equals(ids.GOV_PROG)||account.data.length!==74)throw Error('The vault voting history could not be verified.')
    const v=readVote(account.data)
    if(v.asset!==address||!pubkey.equals(voteAddress(ids,v.proposal,address)))throw Error('The vault voting history could not be verified.')
    return {proposal:v.proposal,support:v.support}
  }).sort((a,b)=>a.proposal<b.proposal?-1:a.proposal>b.proposal?1:0)
  return {vote_history:votes,votes_digest:voteHistoryDigest(votes)}
}
