import {createHash} from 'node:crypto'
import {parseMint,parseTokenAccount,parseCoreCollection,absentIfDust} from '../web/src/lib/decode.mjs'
import {stepVerdict} from '../web/src/lib/ceremony-reads.mjs'
import {TOKEN_PROGRAM} from '../web/src/lib/ids.mjs'
import {STRUCTS,PROGRAM_IDS,offsets,fixedSize,decode} from '../bank/layout.mjs'

// Only activity counters are ignored. Governance settings, pending authorities,
// charter dates, collection, policy limits and every unlisted byte stay pinned.
const activityFields = {
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
  const ok=first.value.length===second.value.length&&JSON.stringify(first.value.map(normalize))===JSON.stringify(second.value.map(normalize))
  return {ok,slots,reason:ok?'agreement':slots.first===slots.second?'disagreement':'unstable'}
}

// Every provider must independently satisfy the setup expectation, including
// counters masked only for cross-slot comparison and the revenue rent balance.
export function independentStepVerdicts(states,{mode,hasCollection,step}) {
  const verdicts=states.map(stepVerdict)
  const allowed=mode==='--after'?['done']:!hasCollection&&['seal','mint','burn','gov'].includes(step)?['next']:['next','done']
  return {ok:verdicts.length===2&&verdicts.every(v=>allowed.includes(v)),verdicts}
}
