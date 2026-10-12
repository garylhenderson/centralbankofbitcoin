/** Sale-round proposals use the frozen GOV instruction and explicit holder consent. */
import {PublicKey,TransactionInstruction,SystemProgram} from '@solana/web3.js'
import {Buffer,disc,u8,u32,u64,i64} from './enc.mjs'
import {account,anchorAccount,chainNow,readConfigs,readVault} from './reads.mjs'
import {readProposal,proposalAddress,tally} from './governance.mjs'
const MAX_U64=(1n<<64n)-1n,MAX_TIME=253402300799n
function integer(value,label,max=MAX_U64) {
  if(typeof value!=='string'||!/^(0|[1-9]\d*)$/.test(value)||BigInt(value)>max)throw Error(`Enter ${label} as a whole number in range.`)
  return value
}
function shape(input,allowed) {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==allowed.length||Object.keys(input).some(k=>!allowed.includes(k)))throw Error('Unexpected proposal details.')
}
function address(value) {
  if(typeof value!=='string'||new PublicKey(value).toBase58()!==value)throw Error('Enter a valid Bank address.')
  return value
}
export function saleProposalInput(input) {
  shape(input,['asset','opens_at','closes_at','price','cap','voting_ends_at'])
  const chosen={asset:address(input.asset),opens_at:integer(input.opens_at,'the opening time',MAX_TIME),closes_at:integer(input.closes_at,'the closing time',MAX_TIME),price:integer(input.price,'the price in sats'),cap:integer(input.cap,'the vault cap',2100n),voting_ends_at:integer(input.voting_ends_at,'the voting deadline',MAX_TIME)}
  if(BigInt(chosen.price)<21000n)throw Error('The sale price must be at least 21,000 sats of cbBTC.')
  if(BigInt(chosen.cap)<1n)throw Error('Choose at least one vault for this round.')
  if(BigInt(chosen.closes_at)<=BigInt(chosen.opens_at)||BigInt(chosen.closes_at)-BigInt(chosen.opens_at)>31536000n)throw Error('A sale must close after it opens and last no more than 365 days.')
  if(BigInt(chosen.opens_at)<=BigInt(chosen.voting_ends_at))throw Error('The sale must open after voting ends, allowing time to execute a passed proposal.')
  return chosen
}
export function executionInput(input) { shape(input,['proposal']);return {proposal:address(input.proposal)} }
const k=(pubkey,isSigner=false,isWritable=false)=>({pubkey:new PublicKey(pubkey),isSigner,isWritable})
export function createSaleProposalIx(ids,id,owner,input) {
  const p=saleProposalInput(input)
  return new TransactionInstruction({programId:ids.GOV_PROG,data:Buffer.concat([disc('create_proposal'),u32(1),u8(0),i64(p.opens_at),i64(p.closes_at),u64(p.price),u32(Number(p.cap)),i64(p.voting_ends_at)]),keys:[k(ids.GOV_CFG,false,true),k(proposalAddress(ids,id),false,true),k(ids.MINT_CFG),k(ids.BURN_CFG),k(p.asset),k(owner,true,true),k(SystemProgram.programId)]})
}
export function executeProposalIx(ids,proposal) {
  return new TransactionInstruction({programId:ids.GOV_PROG,data:disc('execute_proposal'),keys:[k(ids.GOV_CFG,false,true),k(proposal,false,true),k(ids.MINT_CFG,false,true),k(ids.GOV_PDA),k(ids.MINT_PROG)]})
}
export function governanceActionInput(action,input) {
  if(action==='propose')return saleProposalInput(input)
  if(action==='execute_proposal')return executionInput(input)
  throw Error('Unknown governance action.')
}
export function verifyGovernanceQuote(action,input,details) {
  const chosen=governanceActionInput(action,input)
  if(action==='propose') {
    const a=details?.actions?.[0]
    if(details?.asset!==chosen.asset||details.voting_ends_at!==chosen.voting_ends_at||details.actions.length!==1||a?.kind!=='SetRound'||['opens_at','closes_at','price','cap'].some(k=>String(a[k])!==chosen[k]))throw Error('The proposal review does not match your draft.')
  } else if(details?.proposal!==chosen.proposal)throw Error('The execution review names a different proposal.')
}
export async function planGovernanceAction(conn,ids,owner,action,input) {
  const chosen=governanceActionInput(action,input)
  if(!ids.COLL)throw Error('The Bank has not completed initialization.')
  const [cfg,gov,now]=await Promise.all([readConfigs(conn,ids),anchorAccount(conn,'GovConfig',ids.GOV_CFG,ids.GOV_PROG),chainNow(conn)])
  if(!gov||gov.collection!==ids.COLL.toBase58()||cfg.burn.collection!==ids.COLL.toBase58()||cfg.mint.governance!==ids.GOV_PDA.toBase58())throw Error('The Bank governance settings could not be verified.')
  if(action==='propose') {
    if(BigInt(now)<BigInt(cfg.mint.charter_closes_at))throw Error('Proposals begin only after the charter claim window closes.')
    const duration=BigInt(chosen.voting_ends_at)-BigInt(now)
    if(duration<BigInt(gov.min_voting_secs)||duration>2592000n)throw Error(`Voting must run for at least ${gov.min_voting_secs} seconds from submission and no more than 30 days. Choose a later deadline if your review took time.`)
    const v=await readVault(conn,ids,new PublicKey(chosen.asset))
    if(!v.info||v.info.burned||v.info.owner!==owner||v.info.collection!==ids.COLL.toBase58()||!v.record||v.record.retired||v.record.asset!==chosen.asset)throw Error('Choose a live Bank vault held by this wallet.')
    const supply=BigInt(cfg.mint.minted_total)-BigInt(cfg.burn.burned_total)-BigInt(cfg.mint.bare_burns_retired)
    if(supply<=0n)throw Error('There are no live vaults available to govern.')
    const id=BigInt(gov.proposal_count)+1n
    if(id>MAX_U64)throw Error('The proposal counter is full.')
    const proposal=proposalAddress(ids,id)
    if(await account(conn,proposal))throw Error('The next proposal address is already occupied. Refresh before continuing.')
    const actions=[{kind:'SetRound',opens_at:chosen.opens_at,closes_at:chosen.closes_at,price:chosen.price,cap:Number(chosen.cap)}]
    const details={asset:chosen.asset,proposal:proposal.toBase58(),proposal_id:String(id),voting_ends_at:chosen.voting_ends_at,actions,quorum_supply:String(supply),quorum_bps:gov.quorum_bps,threshold_bps:gov.threshold_bps,index_snapshot:String(cfg.mint.minted_total)}
    return {ixs:[createSaleProposalIx(ids,id,owner,chosen)],details,acks:[{id:'create_sale_proposal',text:'I approve publishing this exact sale-round proposal. Creating it does not cast any vote, issue a vault, or open the sale. Holders decide; a passed proposal must be executed separately.'}]}
  }
  const proposal=new PublicKey(chosen.proposal),a=await account(conn,proposal)
  if(!a?.owner.equals(ids.GOV_PROG))throw Error('This proposal could not be verified.')
  const p=readProposal(a.data)
  if(!proposal.equals(proposalAddress(ids,p.id)))throw Error('This is not a Bank proposal address.')
  if(tally(p,now).status!=='Ready to execute')throw Error('Only a passed proposal within its seven-day execution window can be executed.')
  const details={proposal:chosen.proposal,proposal_id:p.id,actions:p.actions,voting_ends_at:p.voting_ends_at,quorum_supply:p.quorum_supply,quorum_bps:p.quorum_bps,threshold_bps:p.threshold_bps,yes:p.yes,no:p.no,notice_secs:String(cfg.mint.notice_secs),last_round_id:String(gov.last_round_id),last_guardian_id:String(gov.last_guardian_id),last_arm_id:String(gov.last_arm_id),last_boost_id:String(gov.last_boost_id)}
  return {ixs:[executeProposalIx(ids,proposal)],details,acks:[{id:'execute_passed_proposal',text:'I approve executing this passed proposal. Superseded actions may be skipped. Key changes observe the Bank notice period; this does not cast or change any vote.'}]}
}

/** Interpret a date/time field explicitly in Austin, including daylight saving. */
export function austinTimestamp(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Choose a date and time in Austin.')
  const wall=Date.parse(value+'Z'),matches=[]
  const format=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  for(const hours of [5,6]){const utc=wall+hours*3600000;if(Number.isFinite(utc)&&format.format(new Date(utc)).replace(' ','T')===value)matches.push(utc/1000)}
  if(matches.length!==1)throw Error('That Austin time is missing or repeated during a daylight-saving change. Choose another time.')
  return String(matches[0])
}
export function cbBTCPrice(value) {
  if(typeof value!=='string'||!/^\d+(?:\.\d{1,8})?$/.test(value))throw Error('Enter a cbBTC amount with no more than eight decimal places.')
  const [whole,fraction='']=value.split('.'),price=BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,'0'))
  return integer(String(price),'the price in sats')
}
