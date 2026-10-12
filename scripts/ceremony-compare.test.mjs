import test from 'node:test'
import {createHash} from 'node:crypto'
import {TOKEN_PROGRAM} from '../web/src/lib/ids.mjs'
import {STRUCTS,PROGRAM_IDS,fixedLength,offsets} from '../bank/layout.mjs'
import assert from 'node:assert/strict'
import {stableSetupAccount,programFailureCheck,compareSetupSnapshots,independentStepVerdicts,activityFields,compareSetupWithRetry,setupProgramIdentity,finalizedStepConnection,checkStepsWithRetry,beforePublicActivity} from './ceremony-compare.mjs'
const account=(data,owner=TOKEN_PROGRAM.toBase58())=>({data,owner:{toBase58:()=> owner},executable:false,lamports:100})
test('mint supply and lamports may differ, mint authority may not',()=>{
  const data=Buffer.alloc(82);data[45]=1;const a=account(data),b={...a,data:Buffer.from(data),lamports:200};b.data.writeBigUInt64LE(123n,36)
  assert.deepEqual(stableSetupAccount(a,'mint'),stableSetupAccount(b,'mint'))
  b.data[4]=1;assert.notDeepEqual(stableSetupAccount(a,'mint'),stableSetupAccount(b,'mint'))
})
test('token amount may differ, owner or frozen state may not',()=>{
  const a=account(Buffer.alloc(165)),b=account(Buffer.alloc(165));b.data.writeBigUInt64LE(123n,64)
  assert.deepEqual(stableSetupAccount(a,'token'),stableSetupAccount(b,'token'))
  b.data[32]=1;assert.notDeepEqual(stableSetupAccount(a,'token'),stableSetupAccount(b,'token'))
  b.data[32]=0;b.data[108]=2;assert.notDeepEqual(stableSetupAccount(a,'token'),stableSetupAccount(b,'token'))
})
test('collection counts may differ, metadata and authority may not',()=>{
  const a=account(Buffer.alloc(49));a.data[0]=5;const b=account(Buffer.from(a.data));b.data.writeUInt32LE(1,41);b.data.writeUInt32LE(1,45)
  assert.deepEqual(stableSetupAccount(a,'collection',a.owner.toBase58()),stableSetupAccount(b,'collection',a.owner.toBase58()))
  b.data[1]=1;assert.notDeepEqual(stableSetupAccount(a,'collection',a.owner.toBase58()),stableSetupAccount(b,'collection',a.owner.toBase58()))
})
test('configuration bytes, owner and executable remain part of comparison',()=>{
  const a=account(Buffer.alloc(8)),b=account(Buffer.alloc(8));b.data[0]=1
  assert.notDeepEqual(stableSetupAccount(a),stableSetupAccount(b))
  assert.notDeepEqual(stableSetupAccount(a),stableSetupAccount({...a,executable:true}))
  assert.notDeepEqual(stableSetupAccount(a),stableSetupAccount({...a,owner:{toBase58:()=> 'other'}}))
})
test('missing and malformed accounts cannot become matching valid accounts',()=>{
  assert.equal(stableSetupAccount(null),null)
  for(const kind of ['mint','token','collection'])assert.throws(()=>stableSetupAccount(account(Buffer.alloc(1)),kind,TOKEN_PROGRAM.toBase58()))
})
test('provider failures classify integrity separately from network without leaking text',()=>{
  assert.match(programFailureCheck(Error('Independent providers disagree')),/agreement/)
  assert.match(programFailureCheck(Error('Bank program differs from audited build')),/audited/)
  assert.match(programFailureCheck(Error('Wrong genesis')),/identity/)
  assert.equal(programFailureCheck(Error('HTTP 429 https://secret.invalid/key')),'independent program network or configuration read')
})

test('System dust at uninitialized addresses is absent for every setup kind',()=>{
  for(const kind of ['config','token','mint','collection','MintConfig','BurnConfig','GovConfig'])
    assert.equal(stableSetupAccount(account(Buffer.alloc(0),'11111111111111111111111111111111'),kind),null)
})
test('unexpected owners keep raw bytes without typed parsing or counter masking',()=>{
  for(const kind of ['mint','token','collection','MintConfig','BurnConfig','GovConfig']) {
    const a=account(Buffer.from([1]),'unexpected'),b=account(Buffer.from([2]),'unexpected')
    assert.equal(stableSetupAccount(a,kind,'expected').data,createHash('sha256').update(a.data).digest('hex'))
    assert.notDeepEqual(stableSetupAccount(a,kind,'expected'),stableSetupAccount(b,kind,'expected'))
  }
})
for(const [kind,counter] of [['MintConfig','minted_total'],['BurnConfig','burned_total'],['GovConfig','proposal_count']]) {
  test(`${kind}: activity can advance between slots, collection and configuration cannot`,()=>{
    const data=Buffer.alloc(fixedLength(kind)),positions=offsets(kind)
    createHash('sha256').update(`account:${STRUCTS[kind].struct}`).digest().copy(data,0,0,8)
    data[8]=STRUCTS[kind].version
    const a=account(data,PROGRAM_IDS[STRUCTS[kind].program]),b=account(Buffer.from(data),a.owner.toBase58())
    b.data[positions[counter]]=1
    assert.deepEqual(stableSetupAccount(a,kind),stableSetupAccount(b,kind))
    for(const [field] of STRUCTS[kind].fields.filter(([name])=>name!=='version'&&!activityFields[kind].includes(name))) {
      b.data[positions[field]]=1
      assert.notDeepEqual(stableSetupAccount(a,kind),stableSetupAccount(b,kind),field)
      b.data[positions[field]]=0
    }
    b.data[8]=255;assert.throws(()=>stableSetupAccount(b,kind),/layout version/)
  })
}

test('same-slot disagreement and cross-slot instability stay distinct',()=>{
  const snapshot=(slot,value)=>({context:{slot},value:[value]})
  assert.deepEqual(compareSetupSnapshots(snapshot(10,1),snapshot(11,1),x=>x),{ok:true,reason:'agreement',slots:{first:10,second:11},differingIndices:[]})
  assert.equal(compareSetupSnapshots(snapshot(10,1),snapshot(11,2),x=>x).reason,'unstable')
  assert.equal(compareSetupSnapshots(snapshot(10,1),snapshot(10,2),x=>x).reason,'disagreement')
})
test('after signing both providers must accept each complete step including initial counters',()=>{
  const opts={mode:'--after',hasCollection:true,step:'mint'}
  assert.equal(independentStepVerdicts([[],[]],opts).ok,true)
  for(const states of [[[],['minted_total differs']],[['minted_total differs'],[]],[[],null],[[],{absent:'collection'}],[[]]])
    assert.equal(independentStepVerdicts(states,opts).ok,false)
})
test('preflight requires both providers to report uninitialized settings when no collection exists',()=>{
  for(const step of ['seal','mint','burn','gov']) {
    const opts={mode:'--preflight',hasCollection:false,step}
    assert.equal(independentStepVerdicts([null,null],opts).ok,true)
    assert.equal(independentStepVerdicts([null,[]],opts).ok,false)
  }
})
test('funding can be pending before signing but must be sufficient at both providers afterward',()=>{
  assert.equal(independentStepVerdicts([[],null],{mode:'--preflight',hasCollection:false,step:'fund'}).ok,false)
  assert.equal(independentStepVerdicts([[],null],{mode:'--after',hasCollection:true,step:'fund'}).ok,false)
  assert.equal(independentStepVerdicts([[],[]],{mode:'--after',hasCollection:true,step:'fund'}).ok,true)
})

const snapshot=(slot,...value)=>({context:{slot},value})
test('snapshot retries are bounded, paused, and report persistent indices',async()=>{
  const calls=[],sleeps=[]
  const r=await compareSetupWithRetry(async(i,previous)=>{
    calls.push([i,previous]);return [snapshot(10+i,1,2),snapshot(11+i,1,3)]
  },x=>x,async ms=>sleeps.push(ms))
  assert.deepEqual(calls,[[0,undefined],[1,11],[2,12]])
  assert.deepEqual(sleeps,[700,700])
  assert.equal(r.comparison.reason,'persistent cross-slot disagreement')
  assert.deepEqual(r.observations.map(o=>o.differingIndices),[[1],[1],[1]])
})
test('same-slot disagreements stop immediately; transient differences can settle',async()=>{
  for(const agreement of [true,false]) {
    let n=0
    const r=await compareSetupWithRetry(async()=>{n++;return [snapshot(4,1),snapshot(4,agreement?1:2)]},x=>x,()=>assert.fail('must not pause'))
    assert.equal(n,1);assert.equal(r.comparison.reason,agreement?'agreement':'disagreement')
  }
  const r=await compareSetupWithRetry(async i=>[snapshot(i,1),snapshot(i+1,i?1:2)],x=>x,async()=>{})
  assert.equal(r.observations.length,2);assert.equal(r.comparison.ok,true)
})
test('changing cross-slot differences remain unstable; length mismatches record index',async()=>{
  const r=await compareSetupWithRetry(async i=>[snapshot(i,1,2),snapshot(i+1,i===1?0:1,i===1?2:3)],x=>x,async()=>{})
  assert.equal(r.comparison.reason,'unstable')
  assert.deepEqual(compareSetupSnapshots(snapshot(1,null),snapshot(2,null,null),x=>x).differingIndices,[1])
})
test('profile must match every masking program identity',()=>{
  assert.equal(setupProgramIdentity({...PROGRAM_IDS}),true)
  for(const name of Object.keys(PROGRAM_IDS)) {
    assert.equal(setupProgramIdentity({...PROGRAM_IDS,[name]:'wrong'}),false)
    const missing={...PROGRAM_IDS};delete missing[name];assert.equal(setupProgramIdentity(missing),false)
  }
  assert.equal(setupProgramIdentity(null),false)
})
test('finalized step adapter records actual slots and refuses stale responses',async()=>{
  const reads=[],calls=[],key={toBase58:()=> 'account'}
  let slot=51
  const conn=finalizedStepConnection({
    async getAccountInfoAndContext(k,opts){calls.push(opts);return {context:{slot},value:'value'}},
    async getMinimumBalanceForRentExemption(size,commitment){assert.equal(commitment,'finalized');return 890880},
  },50,reads)
  assert.equal(await conn.getAccountInfo(key,'confirmed'),'value')
  assert.deepEqual(calls,[{commitment:'finalized',minContextSlot:50}])
  assert.equal(await conn.getMinimumBalanceForRentExemption(0),890880)
  assert.deepEqual(reads,[{address:'account',slot:51,commitment:'finalized'},{rent_size:0,lamports:890880,commitment:'finalized',slot:null}])
  slot=49;await assert.rejects(conn.getAccountInfo(key),/precedes snapshot/)
  slot=undefined;await assert.rejects(conn.getAccountInfo(key),/precedes snapshot/)
  assert.throws(()=>finalizedStepConnection({},undefined,[]),/Invalid snapshot/)
})
test('provider step disagreement retries once then fails closed or reaches agreement',async()=>{
  for(const recover of [true,false]) {
    let n=0,pauses=0
    const r=await checkStepsWithRetry(async()=>({states:++n===2&&recover?[[],[]]:[[],null],reads:[[],[]]}),
      {mode:'--preflight',hasCollection:true,step:'fund'},async()=>{pauses++})
    assert.equal(n,2);assert.equal(pauses,1);assert.equal(r.checked.ok,recover)
    assert.equal(r.observations.length,2)
  }
  const r=await checkStepsWithRetry(async()=>({states:[['wrong'],['wrong']],reads:[[],[]]}),
    {mode:'--after',hasCollection:true,step:'mint'},()=>assert.fail('must not retry broken agreement'))
  assert.equal(r.checked.ok,false);assert.equal(r.observations.length,1)
})
test('initial ceremony evidence window ends exactly at charter opening',()=>{
  assert.equal(beforePublicActivity(99,100),true)
  for(const now of [100,101,NaN,Infinity])assert.equal(beforePublicActivity(now,100),false)
  assert.equal(beforePublicActivity(99,undefined),false)
})
