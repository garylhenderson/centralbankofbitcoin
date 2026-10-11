import test from 'node:test'
import assert from 'node:assert/strict'
import {judgeReceipt,judgeEvidence,evidenceDigest,EVIDENCE_FILES} from './prelock-receipt.mjs'
import {RULED_DATES} from './check-launch-params.mjs'
const now=RULED_DATES.lock_deadline-60, commit='a'.repeat(40)
const core={checked_at:now-10,matches:true,program:'core',programdata:'data',genesis:'mainnet',upgrade_slot:123,sha256:'b'.repeat(64),pinned_sha256:'b'.repeat(64),bytes:1000,upgrade_authority:'authority',bank_programs:{burn:{sha256:'1'},gov:{sha256:'2'},mint:{sha256:'3'},seal:{sha256:'4'},sweep:{sha256:'5'}}}
const hashes=Object.fromEntries(['full-suite.log','simulation.log','holder-e2e.log'].map(n=>[n,'c'.repeat(64)]))
const receipt={status:'passed',commit,started:now-3600,completed:now-20,core,logs:hashes}
const judge=(r=receipt,l=core,opts={})=>judgeReceipt(r,l,{now,commit,hashes,...opts})
test('fresh unchanged complete evidence passes',()=>assert.deepEqual(judge(),[]))
for(const [name,mutate] of [
 ['failed suite',r=>{r.status='failed'}],
 ['stale run',r=>{r.started=now-86401}],
 ['future completion',r=>{r.completed=now+1}],
 ['changed source',r=>{r.commit='d'.repeat(40)}],
 ['missing log',r=>{delete r.logs['holder-e2e.log']}],
 ['altered log',r=>{r.logs['full-suite.log']='f'.repeat(64)}],
 ['changed live Core bytes',r=>{r.core.sha256='0'.repeat(64)}],
 ['Core upgraded then reverted',r=>{r.core.upgrade_slot--}],
])test(name+' refuses',()=>{const r=structuredClone(receipt);mutate(r);assert.ok(judge(r).length)})
test('stale or off-pin live read refuses',()=>{assert.ok(judge(receipt,{...core,checked_at:now-61}).length);assert.ok(judge(receipt,{...core,matches:false}).length)})
test('past ruled deadline refuses even fresh tests',()=>assert.ok(judge(receipt,{...core,checked_at:RULED_DATES.lock_deadline+1},{now:RULED_DATES.lock_deadline+1}).length))
test('future live read refuses',()=>assert.ok(judge(receipt,{...core,checked_at:now+1}).length))

const floors={onchain:'913',web:'1010',sim:'71',e2e:'160'}
const raw={started:String(now-3600),'core-before.json':JSON.stringify(core),'core-after.json':JSON.stringify(core),'full-suite.status':'0','simulation.status':'0','holder-e2e.status':'0','full-suite.log':'913/913 assertions, floor 913\nweb offline 1010/1010, floor 1010','simulation.log':'71/71, floor 71','holder-e2e.log':'e2e 160/160, floor 160'}
test('raw successful evidence passes',()=>assert.deepEqual(judgeEvidence(raw,floors),[]))
for(const field of ['full-suite.status','simulation.status','holder-e2e.status'])test(field+' failure is refused',()=>assert.ok(judgeEvidence({...raw,[field]:'1'},floors).length))
for(const field of ['full-suite.log','simulation.log','holder-e2e.log'])test(field+' incomplete floor is refused',()=>assert.ok(judgeEvidence({...raw,[field]:'some tests passed'},floors).length))
test('off-pin after observation is refused',()=>assert.ok(judgeEvidence({...raw,'core-after.json':JSON.stringify({...core,matches:false})},floors).length))
test('changed upgrade authority during run is refused',()=>assert.ok(judgeEvidence({...raw,'core-after.json':JSON.stringify({...core,upgrade_authority:'other'})},floors).length))
test('changed Bank program during run is refused',()=>assert.ok(judgeEvidence({...raw,'core-after.json':JSON.stringify({...core,bank_programs:{}})},floors).length))
test('digest covers statuses and result as well as logs',()=>{const all=Object.fromEntries(EVIDENCE_FILES.map(f=>[f,'original'])),digest=evidenceDigest(all);for(const f of EVIDENCE_FILES)assert.notEqual(evidenceDigest({...all,[f]:'altered'}),digest)})
test('rehearsal result is never a certification',()=>assert.ok(judge({...receipt,status:'rehearsal'}).length))
