import test from 'node:test'
import assert from 'node:assert/strict'
import {judgeReceipt,judgeEvidence,evidenceDigest,EVIDENCE_FILES,runReceipt} from './prelock-receipt.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
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
test('raw-byte digest agrees with Python even with invalid UTF-8 in logs',()=>{
 const files=Object.fromEntries(EVIDENCE_FILES.map(f=>[f,Buffer.from([0xff,0xc3,0x28,0x00])]))
 const expected=execFileSync('python3',['-c','import hashlib,json,sys; names=json.loads(sys.argv[1]); b=bytes([255,195,40,0]); print(hashlib.sha256("".join(n+"\\0"+hashlib.sha256(b).hexdigest()+"\\n" for n in names).encode()).hexdigest())',JSON.stringify(EVIDENCE_FILES)],{encoding:'utf8'}).trim()
 assert.equal(evidenceDigest(files),expected)
 assert.notEqual(evidenceDigest(files),evidenceDigest(Object.fromEntries(Object.entries(files).map(([n,b])=>[n,b.toString()]))))
})
test('Python and JS cover exactly the same ordered evidence files',()=>{
 const source=fs.readFileSync(new URL('./seal-prelock.py',import.meta.url),'utf8')
 assert.deepEqual(JSON.parse(source.match(/^FILES=(.*)$/m)[1].replaceAll("'",'"')),EVIDENCE_FILES)
})
function stage(fn) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbob-receipt-')),dir=path.join(root,'.cache/prelock-rehearse/run-fixture')
 fs.mkdirSync(dir,{recursive:true})
 for(const [name,data] of Object.entries({...raw,commit,mode:'rehearsal'}))fs.writeFileSync(path.join(dir,name),data)
 for(const [name,data] of Object.entries({'scripts/run-tests.sh':'MIN_ASSERTIONS=913\nWEB_FLOOR=1010\n','sim/run-sim.sh':'SIM_FLOOR=71\n','web/test/e2e-localnet.sh':'E2E_FLOOR=160\n'})){const f=path.join(root,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,data)}
 const calls=[],options={root,now,getCommit:()=>commit,observe:()=>core,archive:(...args)=>calls.push(args)}
 try{fn({root,dir,options,calls,run:(args=['--seal',dir],opts={})=>runReceipt(args,{...options,...opts})})}finally{fs.rmSync(root,{recursive:true,force:true})}
}
test('rehearsal sealing actually invokes the archive and returns a separate root path',()=>stage(({run,calls,dir})=>{const r=run();assert.equal(r.rehearse,true);assert.equal(calls.length,1);assert.deepEqual(calls[0],[dir,r.digest]);assert.equal(r.archive,'/var/lib/cbob-prelock-rehearse/run-fixture');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'result.json'))).status,'rehearsal')}))
test('archive failure can retry an unchanged validated result without rerunning suites',()=>stage(({run,dir})=>{assert.throws(()=>run(undefined,{archive:()=>{throw Error('archive unavailable')}}),/archive unavailable/);const before=fs.readFileSync(path.join(dir,'result.json'));run(undefined,{now:now+1});assert.deepEqual(fs.readFileSync(path.join(dir,'result.json')),before)}))
test('staged source outside approved cache is refused',()=>stage(({run,root})=>{const outside=path.join(root,'run-outside');fs.mkdirSync(outside);assert.throws(()=>run(['--seal',outside]),/Invalid private/)}))
test('dirty source is refused before observation or archive',()=>stage(({run})=>assert.throws(()=>run(undefined,{getCommit:()=>{throw Error('Source is dirty')},observe:()=>assert.fail('must not read chain')}),/Source is dirty/)))
test('symlinked log is refused',()=>stage(({run,dir})=>{fs.renameSync(path.join(dir,'full-suite.log'),path.join(dir,'real.log'));fs.symlinkSync('real.log',path.join(dir,'full-suite.log'));assert.throws(()=>run(),/redirected/)}))
test('mode mismatch cannot turn rehearsal into certification',()=>stage(({run,dir})=>{fs.writeFileSync(path.join(dir,'mode'),'certification');assert.throws(()=>run(),/Wrong run mode/)}))
test('a planted result differing from raw evidence is refused on retry',()=>stage(({run,dir})=>{run();const f=path.join(dir,'result.json'),r=JSON.parse(fs.readFileSync(f));r.commit='f'.repeat(40);fs.writeFileSync(f,JSON.stringify(r));assert.throws(()=>run(),/Existing result differs/)}))
test('certification verify never accepts a rehearsal archive or staged directory',()=>stage(({run,dir})=>{assert.throws(()=>run(['--verify',dir,'--expect','f'.repeat(64)]),/matching root-owned archive/);assert.throws(()=>run(['--verify-rehearsal',dir,'--expect','f'.repeat(64)]),/matching root-owned archive/)}))
test('verify requires an independently supplied digest',()=>stage(({run,dir})=>assert.throws(()=>run(['--verify',dir]),/Usage/)))
