#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {RULED_DATES} from './check-launch-params.mjs'

export const EVIDENCE_FILES=['commit','started','mode','core-before.json','core-after.json','full-suite.log','simulation.log','holder-e2e.log','full-suite.status','simulation.status','holder-e2e.status','result.json']
const CORE_KEYS=['program','programdata','genesis','upgrade_slot','upgrade_authority','sha256','pinned_sha256','bytes','bank_programs']
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
export const evidenceDigest=files=>sha(EVIDENCE_FILES.map(name=>name+'\0'+sha(files[name])+'\n').join(''))
export function judgeEvidence(e,floors) {
 e=Object.fromEntries(Object.entries(e).map(([k,v])=>[k,Buffer.isBuffer(v)?v.toString('utf8'):v]))
 const bad=[],need=(ok,why)=>{if(!ok)bad.push(why)}
 for(const name of ['full-suite','simulation','holder-e2e'])need(e[name+'.status']?.trim()==='0',name+' did not exit successfully')
 need(e['full-suite.log']?.includes(`${floors.onchain}/${floors.onchain} assertions, floor ${floors.onchain}`)&&e['full-suite.log']?.includes(`web offline ${floors.web}/${floors.web}, floor ${floors.web}`),'full suite evidence incomplete')
 need(e['simulation.log']?.includes(`${floors.sim}/${floors.sim}, floor ${floors.sim}`),'simulation evidence incomplete')
 need(e['holder-e2e.log']?.includes(`e2e ${floors.e2e}/${floors.e2e}, floor ${floors.e2e}`),'holder e2e evidence incomplete')
 try {
  const before=JSON.parse(e['core-before.json']),after=JSON.parse(e['core-after.json'])
  need(before.matches===true&&after.matches===true,'Core observation is off-pin')
  for(const key of CORE_KEYS)need(equal(before[key],after[key]),'program state changed during tests: '+key)
  need(before.checked_at>=Number(e.started)&&after.checked_at>=before.checked_at,'observation times do not cover the run')
 }catch{bad.push('program evidence is unreadable')}
 return bad
}
export function judgeReceipt(r,live,{now,commit,hashes,rehearse=false}) {
 const failures=[],need=(ok,why)=>{if(!ok)failures.push(why)}
 need(r?.status===(rehearse?'rehearsal':'passed'),'suite receipt did not pass')
 need(r?.commit===commit,'source commit changed since the full suite')
 need(Number.isInteger(r?.started)&&Number.isInteger(r?.completed)&&r.started<=r.completed&&r.completed<=now&&now-r.started<=86400,'suite is not fresh within 24 hours')
 if(!rehearse)need(r?.started>=RULED_DATES.lock_deadline-86400&&now<=RULED_DATES.lock_deadline,'outside the ruled lock window')
 need(live?.matches===true&&live.checked_at<=now&&now-live.checked_at<=60,'live Core read is stale or off-pin')
 need(Object.keys(live?.bank_programs||{}).sort().join(',')==='burn,gov,mint,seal,sweep','five Bank programs were not checked')
 for(const key of CORE_KEYS)need(equal(r?.core?.[key],live?.[key]),'live program state changed: '+key)
 for(const name of ['full-suite.log','simulation.log','holder-e2e.log'])need(/^[a-f0-9]{64}$/.test(r?.logs?.[name]||'')&&r.logs[name]===hashes[name],'suite evidence changed: '+name)
 return failures
}
const ROOT=path.resolve(fileURLToPath(new URL('../',import.meta.url)))
export function runReceipt(argv, options={}) {
  // Dependency injection is for tests importing this function. The CLI has no
  // environment or argument that can replace the source, live read or archive.
  const root=options.root||ROOT, archiveBase=options.archiveBase||'/var/lib',
    getCommit=options.getCommit||(()=>{if(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}).trim())throw new Error('Source is dirty');return execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()}),
    observe=options.observe||(()=>JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/prelock-core.mjs')],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:90000}))),
    archive=options.archive||((directory,digest)=>execFileSync('sudo',['-n','/usr/local/sbin/cbob-seal-prelock',directory,digest],{stdio:'inherit'}))
  const [mode,dir,flag,expected]=argv, verifying=['--verify','--verify-rehearsal'].includes(mode)
  if(!['--seal','--verify','--verify-rehearsal'].includes(mode)||!dir||(verifying?(flag!=='--expect'||!/^[a-f0-9]{64}$/.test(expected||'')||argv.length!==4):argv.length!==2))throw new Error('Usage: prelock-receipt.mjs --seal <directory> OR --verify[-rehearsal] <archived-directory> --expect <independently recorded hash>')
  const receiptDir=fs.realpathSync(dir)
  const rehearse=mode==='--verify-rehearsal'||(mode==='--seal'&&path.dirname(receiptDir)===path.join(root,'.cache/prelock-rehearse'))
  if(mode==='--seal'&&!rehearse&&!receiptDir.startsWith(path.join(root,'.cache/prelock')+'/'))throw new Error('Invalid private staging directory')
  if(!/^run-[A-Za-z0-9]+$/.test(path.basename(receiptDir)))throw new Error('Invalid receipt name')
  if(verifying&&path.dirname(receiptDir)!==path.join(archiveBase,rehearse?'cbob-prelock-rehearse':'cbob-prelock'))throw new Error('Verify requires the matching root-owned archive; rehearsal receipts cannot certify a lock')
  const commit=getCommit()
  const files={}
  for(const name of EVIDENCE_FILES){if(mode==='--seal'&&name==='result.json')continue;const f=path.join(receiptDir,name),st=fs.lstatSync(f);if(st.isSymbolicLink()||!st.isFile()||(verifying&&(st.uid!==0||(st.mode&0o022))))throw new Error('Evidence is redirected or writable');files[name]=fs.readFileSync(f)}
  if(verifying){
   for(let d=receiptDir;d!==path.dirname(d);d=path.dirname(d)){const st=fs.lstatSync(d);if(st.uid!==0||(st.mode&0o022)||st.isSymbolicLink())throw new Error('Evidence archive is not protected')}
   if(evidenceDigest(files)!==expected)throw new Error('Evidence differs from the independently recorded digest')
  }
  if(files.mode.toString().trim()!==(rehearse?'rehearsal':'certification'))throw new Error('Wrong run mode')
  const floor=(file,key)=>{const n=fs.readFileSync(path.join(root,file),'utf8').match(new RegExp('^'+key+'=(\\d+)','m'))?.[1];if(!n)throw new Error('Missing suite floor');return n}
  const floors={onchain:floor('scripts/run-tests.sh','MIN_ASSERTIONS'),web:floor('scripts/run-tests.sh','WEB_FLOOR'),sim:floor('sim/run-sim.sh','SIM_FLOOR'),e2e:floor('web/test/e2e-localnet.sh','E2E_FLOOR')}
  const incomplete=judgeEvidence(files,floors);if(incomplete.length)throw new Error(incomplete.join('; '))
  const live=observe(),now=options.now??Math.floor(Date.now()/1000),hashes=Object.fromEntries(['full-suite.log','simulation.log','holder-e2e.log'].map(n=>[n,sha(files[n])]))
  const r=mode==='--seal'?{status:rehearse?'rehearsal':'passed',commit:files.commit.toString().trim(),started:Number(files.started),completed:now,core:JSON.parse(files['core-before.json']),logs:hashes}:JSON.parse(files['result.json'])
  if(r.commit!==files.commit.toString().trim()||r.started!==Number(files.started)||!equal(r.core,JSON.parse(files['core-before.json'])))throw new Error('Receipt differs from its raw evidence')
  const bad=judgeReceipt(r,live,{now,commit,hashes,rehearse});if(bad.length)throw new Error(bad.join('; '))
  if(mode==='--seal'){
   files['result.json']=Buffer.from(JSON.stringify(r,null,2)+'\n');
   const resultPath=path.join(receiptDir,'result.json')
   // A failed archive can be retried without losing a completed suite. Never
   // replace an existing result; accept it only after revalidating all evidence.
   if(fs.existsSync(resultPath)) {
    const st=fs.lstatSync(resultPath);if(st.isSymbolicLink()||!st.isFile())throw new Error('Result is redirected')
    const existing=fs.readFileSync(resultPath),old=JSON.parse(existing)
    if(old.commit!==r.commit||old.started!==r.started||!equal(old.core,r.core)||judgeReceipt(old,live,{now,commit,hashes,rehearse}).length)throw new Error('Existing result differs from validated evidence')
    files['result.json']=existing
   }else fs.writeFileSync(resultPath,files['result.json'],{flag:'wx',mode:0o600})
   const digest=evidenceDigest(files)
   archive(receiptDir,digest)
   return {rehearse,digest,archive:path.join(archiveBase,rehearse?'cbob-prelock-rehearse':'cbob-prelock',path.basename(receiptDir))}
  }
  return {rehearse,digest:expected,verified:true}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  const r=runReceipt(process.argv.slice(2))
  if(r.verified)console.log(r.rehearse?'REHEARSAL archive and final verification passed. Never valid for a lock.':'R1 evidence, two-provider program state and source match. No signature or lock was performed.')
  else {
   console.log((r.rehearse?'REHEARSAL ONLY. Evidence digest ':'Record this digest outside the box before locking: ')+r.digest)
   if(r.rehearse)execFileSync(process.execPath,[fileURLToPath(import.meta.url),'--verify-rehearsal',r.archive,'--expect',r.digest],{stdio:'inherit'})
  }
 }catch(e){console.error('NO LOCK: '+String(e.message).replace(/https?:\/\/\S+/g,'<url>'));process.exitCode=1}
}
