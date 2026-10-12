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
  return JSON.stringify({version:2,asset,level:state.level,reserves})
}
export function inspectCommitment(value,asset,mints) {
  if(typeof value!=='string'||value.length>1500)throw Error('This order needs a new review.')
  let saved;try{saved=JSON.parse(value)}catch{throw Error('This order needs a new review.')}
  if(!saved||saved.version!==2||saved.asset!==asset||Object.keys(saved).sort().join(',')!=='asset,level,reserves,version'||!saved.reserves||Array.isArray(saved.reserves)||Object.keys(saved.reserves).sort().join(',')!==[...mints].sort().join(','))throw Error('This order needs a new review.')
  // Reuse canonical range checks. Legacy balance hashes cannot be upgraded
  // silently because they contain no recoverable minimum amounts.
  orderCommitment(asset,saved,mints)
  return saved
}
export function commitmentMatches(value,asset,state,mints) {
  try {
    const saved=inspectCommitment(value,asset,mints)
    orderCommitment(asset,state,mints)
    return saved.level===state.level&&mints.every(mint=>BigInt(state.reserves[mint])>=BigInt(saved.reserves[mint]))
  }catch{return false}
}
