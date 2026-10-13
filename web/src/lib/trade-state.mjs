import { sha256Hex } from './enc.mjs'

export function voteHistoryDigest(votes) {
  if(!Array.isArray(votes)||votes.length>10000)throw Error('The vault voting history could not be verified.')
  const seen=new Set(),rows=votes.map(v=>{
    if(!v||Object.keys(v).sort().join(',')!=='proposal,support'||typeof v.proposal!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v.proposal)||typeof v.support!=='boolean'||seen.has(v.proposal))throw Error('The vault voting history could not be verified.')
    seen.add(v.proposal);return [v.proposal,v.support]
  }).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0)
  return sha256Hex(JSON.stringify(rows))
}

/** A standing order binds the vault identity and minimum reserves, not an
 * equality hash of balances anyone can increase by depositing tokens. */
export function orderCommitment(asset,state,mints) {
  if(!state||state.retired||state.burned||!Number.isInteger(state.level)||state.level<1||state.level>5)throw Error('This vault is no longer tradable.')
  const reserves={}
  for(const mint of [...mints].sort()) {
    const raw=state.reserves?.[mint]
    if(typeof raw!=='string'||!/^(0|[1-9]\d{0,19})$/.test(raw)||BigInt(raw)>((1n<<64n)-1n))throw Error('The reserve minimum could not be verified.')
    reserves[mint]=raw
  }
  if(typeof state.votes_digest!=='string'||!/^[a-f0-9]{64}$/.test(state.votes_digest))throw Error('The vault voting history could not be verified.')
  return JSON.stringify({version:3,asset,level:state.level,reserves,votes_digest:state.votes_digest})
}
export function inspectCommitment(value,asset,mints) {
  if(typeof value!=='string'||value.length>1500)throw Error('This order needs a new review.')
  let saved;try{saved=JSON.parse(value)}catch{throw Error('This order needs a new review.')}
  if(!saved||saved.version!==3||saved.asset!==asset||Object.keys(saved).sort().join(',')!=='asset,level,reserves,version,votes_digest'||!saved.reserves||Array.isArray(saved.reserves)||Object.keys(saved.reserves).sort().join(',')!==[...mints].sort().join(','))throw Error('This order needs a new review.')
  // Reuse canonical range checks. Legacy balance hashes cannot be upgraded
  // silently because they contain no recoverable minimum amounts.
  orderCommitment(asset,saved,mints)
  return saved
}
export function commitmentMatches(value,asset,state,mints) {
  try {
    const saved=inspectCommitment(value,asset,mints)
    orderCommitment(asset,state,mints)
    return saved.level===state.level&&saved.votes_digest===state.votes_digest&&mints.every(mint=>BigInt(state.reserves[mint])>=BigInt(saved.reserves[mint]))
  }catch{return false}
}
