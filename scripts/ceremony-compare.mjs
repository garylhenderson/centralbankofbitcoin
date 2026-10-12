import {createHash} from 'node:crypto'
import {parseMint,parseTokenAccount,parseCoreCollection,absentIfDust} from '../web/src/lib/decode.mjs'
import {stepVerdict} from '../web/src/lib/ceremony-reads.mjs'
import {TOKEN_PROGRAM} from '../web/src/lib/ids.mjs'
import {STRUCTS,PROGRAM_IDS,offsets,fixedSize,decode} from '../bank/layout.mjs'

// Only activity counters are ignored. Governance settings, pending authorities,
// charter dates, collection, policy limits and every unlisted byte stay pinned.
export const activityFields = {
  MintConfig: ['minted_this_round','minted_total','last_sweep_at','level_minted','revealed_total','charter_claimed','bare_burns_retired','total_active_weight','active_count','acc_scaled','owed_scaled','last_distribute_at','dist_epoch','pending_count','pending_this_epoch','boosts_active','boosts_due','boost_weight_total','cbob_burned_total','boost_expiring'],
  BurnConfig: ['burned_total','rate_head','rate_ring'],
  GovConfig: ['proposal_count','last_round_id','last_guardian_id','last_arm_id','last_boost_id'],
}

// Compare authority/configuration bytes. Permissionless balance and supply
// changes between finalized slots cannot change the ceremony's immutable values.
export function stableSetupAccount(account, kind='config', expectedOwner) {
  account=absentIfDust(account)
  if (!account) return null
  const owner=account.owner.toBase58()
  const tokenOwner=TOKEN_PROGRAM.toBase58()
  const data=Buffer.from(account.data)
  if(kind==='mint' && owner===tokenOwner) { parseMint(data); data.fill(0,36,44) }
  if(kind==='token' && owner===tokenOwner) { parseTokenAccount(data); data.fill(0,64,72) }
  if(kind==='collection' && owner===expectedOwner) {
    parseCoreCollection(data)
    const uriOffset=37+data.readUInt32LE(33)
    const countsOffset=uriOffset+4+data.readUInt32LE(uriOffset)
    data.fill(0,countsOffset,countsOffset+8)
  }
  if(activityFields[kind] && owner===PROGRAM_IDS[STRUCTS[kind].program]) {
    decode(kind,data) // Reject malformed layouts before masking any bytes.
    const positions=offsets(kind)
    for(const field of activityFields[kind]) {
      const type=STRUCTS[kind].fields.find(([name])=>name===field)[1]
      data.fill(0,positions[field],positions[field]+fixedSize(type))
    }
  }
  return {owner,executable:account.executable,data:createHash('sha256').update(data).digest('hex')}
}

export function programFailureCheck(error) {
  if(error?.message==='Independent providers disagree') return 'independent program bytes and authority agreement'
  if(error?.message==='Bank program differs from audited build') return 'independent audited program bytes'
  if(['Wrong genesis','Invalid program','Invalid ProgramData owner','Missing program bytes'].includes(error?.message)) return 'independent program identity'
  return 'independent program network or configuration read'
}

// Different finalized slots can straddle a legitimate configuration change.
// A mismatching same-slot observation is a disagreement; a different-slot
// mismatch is unstable and the caller retries without relaxing any comparison.
export function compareSetupSnapshots(first,second,normalize) {
  const slots={first:first.context.slot,second:second.context.slot}
  const a=first.value.map(normalize),b=second.value.map(normalize),differingIndices=[]
  for(let i=0;i<Math.max(a.length,b.length);i++)
    if(JSON.stringify(a[i])!==JSON.stringify(b[i]))differingIndices.push(i)
  const ok=differingIndices.length===0
  return {ok,slots,differingIndices,reason:ok?'agreement':slots.first===slots.second?'disagreement':'unstable'}
}

const pause = ms => new Promise(resolve=>setTimeout(resolve,ms))
export async function compareSetupWithRetry(read,normalize,sleep=pause) {
  const observations=[]
  for(let attempt=0;attempt<3;attempt++) {
    const [first,second]=await read(attempt,observations.at(-1)?.slots.second)
    const comparison=compareSetupSnapshots(first,second,normalize)
    observations.push(comparison)
    if(comparison.reason!=='unstable')break
    if(attempt<2)await sleep(700)
  }
  const comparison={...observations.at(-1)}
  if(observations.length===3&&observations.every(o=>o.reason==='unstable'&&JSON.stringify(o.differingIndices)===JSON.stringify(comparison.differingIndices)))
    comparison.reason='persistent cross-slot disagreement'
  return {comparison,observations}
}

export function setupProgramIdentity(programs) {
  return Object.entries(PROGRAM_IDS).every(([name,id])=>programs?.[name]===id)
}

// CLI-only adapter: browser reads and the frozen signing bundle stay unchanged.
// Every account read records the actual finalized slot and cannot precede the
// agreeing setup snapshot. Rent RPC has no context slot; record that separately.
export function finalizedStepConnection(conn,minContextSlot,observations) {
  if(!Number.isSafeInteger(minContextSlot)||minContextSlot<0)throw Error('Invalid snapshot slot')
  return {
    async getAccountInfo(key) {
      const r=await conn.getAccountInfoAndContext(key,{commitment:'finalized',minContextSlot})
      if(!Number.isSafeInteger(r.context?.slot)||r.context.slot<minContextSlot)throw Error('Step read precedes snapshot')
      observations.push({address:key.toBase58(),slot:r.context.slot,commitment:'finalized'})
      return r.value
    },
    async getMinimumBalanceForRentExemption(size) {
      const lamports=await conn.getMinimumBalanceForRentExemption(size,'finalized')
      observations.push({rent_size:size,lamports,commitment:'finalized',slot:null})
      return lamports
    },
  }
}

// Every provider must independently satisfy the setup expectation, including
// counters masked only for cross-slot comparison and the revenue rent balance.
export function independentStepVerdicts(states,{mode,hasCollection,step}) {
  const verdicts=states.map(stepVerdict)
  const allowed=mode==='--after'?['done']:!hasCollection&&['seal','mint','burn','gov'].includes(step)?['next']:['next','done']
  const disagreement=verdicts.length===2&&verdicts[0]!==verdicts[1]
  return {ok:verdicts.length===2&&!disagreement&&verdicts.every(v=>allowed.includes(v)),verdicts,disagreement}
}

export async function checkStepsWithRetry(read,options,sleep=pause) {
  const observations=[]
  for(let attempt=0;attempt<2;attempt++) {
    const {states,reads}=await read()
    const checked=independentStepVerdicts(states,options)
    observations.push({...checked,differences:states,reads})
    if(!checked.disagreement)break
    if(attempt===0)await sleep(700)
  }
  return {checked:observations.at(-1),observations}
}

export const beforePublicActivity = (now,opens) => Number.isFinite(now)&&Number.isFinite(opens)&&now<opens
