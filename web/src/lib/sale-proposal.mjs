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
/** Mirror GOV's per-action skip rules without changing the frozen execution. */
export function executionEffects(proposal, gov, mint, now) {
  const id = BigInt(proposal.id), effects = [], value = k => String(mint[k] ?? 0)
  const add = (kind, status, note, extra = {}) => effects.push({ kind, status, note, ...extra })
  for (const action of proposal.actions) {
    if (action.kind === 'SetRound') {
      if (id <= BigInt(gov.last_round_id)) add('Sale round', 'superseded', 'Skipped. A newer or equal sale-round decision has already taken priority.')
      else if (BigInt(action.closes_at) <= BigInt(now)) add('Sale round', 'round_already_over', 'Skipped because this sale has already closed. This execution still supersedes older sale-round proposals.', { advances_round_id: String(id) })
      else add('Sale round', 'applies', 'Replaces the current sale round and resets its mint count to zero under the new cap.', {
        advances_round_id: String(id), opens_immediately: BigInt(action.opens_at) <= BigInt(now),
        replaces_round: { id: value('round_id'), opens_at: value('opens_at'), closes_at: value('closes_at'), price: value('price'), cap: Number(mint.cap || 0) },
      })
    } else if (action.kind === 'Brakes') {
      if (action.set_guardian) add('Guardian', id <= BigInt(gov.last_guardian_id) ? 'superseded' : 'armed', id <= BigInt(gov.last_guardian_id) ? 'Skipped. A newer guardian decision has priority.' : 'Arms the guardian change. The current guardian keeps its brake during the notice period.', { notice_secs: value('notice_secs') })
      for (const [flag, label, stopped, at] of [['restart_sales','Sales restart','sales_stopped','sales_stopped_at'],['restart_sweep','Reserve-swap restart','sweep_stopped','sweep_stopped_at']]) if (action[flag]) {
        const blocked = mint[stopped] && BigInt(mint[at]) >= BigInt(proposal.created_at)
        add(label, blocked ? 'stop_is_newer' : 'sent', blocked ? 'Skipped. The stop is at least as recent as this proposal, so it wins.' : (mint[stopped] ? 'Sends the voted restart.' : 'Sends the voted restart; this activity is not currently stopped.'), { stopped: !!mint[stopped], stopped_at: value(at), proposal_created_at: String(proposal.created_at) })
      }
    } else if (action.kind === 'TightenSweep') add('Reserve-swap limits', 'sent', 'Applies at least these restrictions. A limit already tighter than the proposal stays tighter.', { current: { sol_reserve_lamports: value('sol_reserve_lamports'), max_sweep_lamports: value('max_sweep_lamports'), sweep_cooldown_secs: value('sweep_cooldown_secs') } })
    else if (action.kind === 'ArmSwapOperator') add('Swap operator', id <= BigInt(gov.last_arm_id) ? 'superseded' : 'armed', id <= BigInt(gov.last_arm_id) ? 'Skipped. A newer operator decision has priority.' : 'Arms the operator change, effective after the notice period.', { notice_secs: value('notice_secs') })
    else if (action.kind === 'SetBoostTerms') add('Boost terms', id <= BigInt(gov.last_boost_id) ? 'superseded' : 'applies', id <= BigInt(gov.last_boost_id) ? 'Skipped. A newer boost decision has priority.' : 'Applies these voted boost terms.')
  }
  return effects
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
  const details={proposal:chosen.proposal,proposal_id:p.id,actions:p.actions,voting_ends_at:p.voting_ends_at,quorum_supply:p.quorum_supply,quorum_bps:p.quorum_bps,threshold_bps:p.threshold_bps,yes:p.yes,no:p.no,notice_secs:String(cfg.mint.notice_secs),last_round_id:String(gov.last_round_id),last_guardian_id:String(gov.last_guardian_id),last_arm_id:String(gov.last_arm_id),last_boost_id:String(gov.last_boost_id),execution:executionEffects(p,gov,cfg.mint,now)}
  return {ixs:[executeProposalIx(ids,proposal)],details,acks:[{id:'execute_passed_proposal',text:'I approve executing this passed proposal with the outcomes shown. The chain decides at landing: a sale that closes before then is skipped but still supersedes older rounds. Even if every action is skipped, the proposal is recorded as executed. Key changes observe the Bank notice period; this does not cast or change any vote.'}]}
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
