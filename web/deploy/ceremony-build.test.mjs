import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import http from 'node:http'
import {spawn,execFileSync} from 'node:child_process'
import {verifyCeremonyBuild} from './ceremony-build.mjs'
const commit='a'.repeat(40), app='ceremony-a1/app.js'
function fixture(fn) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cbob-ceremony-test-')),root=path.join(dir,'web/dist-mainnet-local')
 const files={[app]:'reviewed script','ceremony-a1/index.html':'reviewed html','assets/style.css':'reviewed css'}
 const rows=Object.entries(files).map(([rel,body])=>{fs.mkdirSync(path.dirname(path.join(root,rel)),{recursive:true});fs.writeFileSync(path.join(root,rel),body);return[createHash('sha256').update(body).digest('hex'),rel]})
 fs.writeFileSync(path.join(root,'BUILD.txt'),`profile   mainnet-local\ncommit    ${commit}\n`+rows.map(x=>x.join('  ')).join('\n')+'\n')
 fs.writeFileSync(path.join(dir,'web/README.md'),rows.filter(x=>x[1]!== 'ceremony-a1/index.html').map(([h,f])=>`| \`mainnet-local\` | \`${f}\` | \`${h}\` |`).join('\n')+`\nPin review: \`audit.md\` · sha256 \`${createHash('sha256').update('review evidence').digest('hex')}\` · source commit \`${commit}\`.\n`)
 const cleanup=()=>fs.rmSync(dir,{recursive:true,force:true})
 try {const result=fn(root,()=>verifyCeremonyBuild(root,commit,{requireRootOwned:false}));if(result?.then)return result.finally(cleanup);cleanup();return result}catch(e){cleanup();throw e}
}
test('complete reviewed build passes and real deployment refuses a temporary root',()=>fixture((root,check)=>{assert.equal(check().files,3);assert.throws(()=>verifyCeremonyBuild(root,commit),/pinned artifact/)}))
test('changed script is refused',()=>fixture((root,check)=>{fs.appendFileSync(path.join(root,app),'tampered');assert.throws(check,/differs from manifest/)}))
test('wrong commit and dirty build are refused',()=>fixture((root,check)=>{const p=path.join(root,'BUILD.txt');fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(commit,commit+' (dirty)'));assert.throws(check,/identity differs/)}))
test('symlinked script is refused',()=>fixture((root,check)=>{const p=path.join(root,app);fs.renameSync(p,p+'.real');fs.symlinkSync(p+'.real',p);assert.throws(check,/symlinks/)}))
test('missing reviewed pin is refused',()=>fixture((root,check)=>{fs.writeFileSync(path.resolve(root,'../README.md'),'Pin review: incomplete\n');assert.throws(check,/reviewed fingerprint/)}))
test('duplicate manifest entry is refused',()=>fixture((root,check)=>{const p=path.join(root,'BUILD.txt');fs.appendFileSync(p,fs.readFileSync(p,'utf8').split('\n')[2]+'\n');assert.throws(check,/manifest path/)}))

import {verifyCeremonyArtifact,verifyBuildProvenance} from './ceremony-build.mjs'
import {pinnedBuildFor,localListener} from './ceremony-local.mjs'
test('tunnel profile executes the same pinned-build guard',()=>{let called=false;const r=pinnedBuildFor('/opt/cbob-ceremony/'+commit,{profile:'mainnet-local',root:'/pinned'},{CBOB_CEREMONY_COMMIT:commit},(root,c)=>{called=true;assert.equal(root,'/pinned');assert.equal(c,commit);return{allowed:['BUILD.txt']}});assert.ok(called);assert.deepEqual(r.allowed,['BUILD.txt'])})
test('pinned path with missing identity cannot silently use the unpinned tunnel',()=>assert.throws(()=>pinnedBuildFor('/opt/cbob-ceremony/'+commit,{profile:'mainnet-local',root:'/missing'},{},()=>{throw Error('identity missing')}),/identity missing/))
test('listener refuses files outside the reviewed manifest',()=>fixture((root)=>{let status;const res={set statusCode(v){status=v},end(){}};localListener(root,()=>{},new Set(['BUILD.txt']))({url:'/'+app,method:'GET'},res);assert.equal(status,404)}))
test('full attestation covers HTML and server code, not only executable page pins',()=>fixture((root)=>{
 const tree=path.resolve(root,'../..');fs.mkdirSync(path.join(tree,'web/deploy'))
 for(const name of ['launch-ceremony.mjs','ceremony-build.mjs','ceremony-server.mjs','check-ceremony-env.py','build-inputs.json','page-build-inputs.json'])fs.writeFileSync(path.join(tree,'web/deploy',name),'server code')
 const {lock,inputs}=provenanceFixture()
 for(const [name,value] of [['build-dependency-lock.json',lock],['build-inputs.json',inputs],['page-build-inputs.json',inputs]])fs.writeFileSync(path.join(tree,'web/deploy',name),JSON.stringify(value))
 fs.writeFileSync(path.join(tree,'web/deploy/pin-review.md'),'review evidence')
 const files={};function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else files[path.relative(tree,f)]=createHash('sha256').update(fs.readFileSync(f)).digest('hex')}}walk(tree)
 const manifest=JSON.stringify({source_commit:commit,files}),expected=createHash('sha256').update(manifest).digest('hex');fs.writeFileSync(path.join(tree,'ARTIFACT.json'),manifest)
 assert.equal(verifyCeremonyArtifact(tree,commit,expected,{requireRootOwned:false}).files,3)
 const verifyRecord=record=>{const bytes=JSON.stringify(record);fs.writeFileSync(path.join(tree,'ARTIFACT.json'),bytes);return verifyCeremonyArtifact(tree,commit,createHash('sha256').update(bytes).digest('hex'),{requireRootOwned:false})}
 assert.throws(()=>verifyRecord({source_commit:'b'.repeat(40),files}),/source commit differs/)
 const missing={...files};delete missing['web/deploy/launch-ceremony.mjs'];assert.throws(()=>verifyRecord({source_commit:commit,files:missing}),/Incomplete/)
 const noPageInputs={...files};delete noPageInputs['web/deploy/page-build-inputs.json'];assert.throws(()=>verifyRecord({source_commit:commit,files:noPageInputs}),/Incomplete/)
 const unattested={...files};delete unattested['web/dist-mainnet-local/ceremony-a1/index.html'];assert.throws(()=>verifyRecord({source_commit:commit,files:unattested}),/Unattested page/)
 fs.writeFileSync(path.join(tree,'ARTIFACT.json'),manifest)
 fs.appendFileSync(path.join(root,'ceremony-a1/index.html'),'<script>tamper</script>');assert.throws(()=>verifyCeremonyArtifact(tree,commit,expected,{requireRootOwned:false}),/bytes differ/)
 files['web/dist-mainnet-local/ceremony-a1/index.html']=createHash('sha256').update(fs.readFileSync(path.join(root,'ceremony-a1/index.html'))).digest('hex');fs.writeFileSync(path.join(tree,'ARTIFACT.json'),JSON.stringify({source_commit:commit,files}));assert.throws(()=>verifyCeremonyArtifact(tree,commit,expected,{requireRootOwned:false}),/attestation differs/)
}))
test('actual manifest listener serves reviewed bytes and refuses an extra file',()=>fixture(async(root,check)=>{
 const server=http.createServer(localListener(root,()=>{},new Set(check().allowed)))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const base='http://127.0.0.1:'+server.address().port
  const good=await fetch(base+'/'+app);assert.equal(good.status,200);assert.equal(await good.text(),'reviewed script')
  fs.writeFileSync(path.join(root,'planted.js'),'not reviewed');assert.equal((await fetch(base+'/planted.js')).status,404)
 }finally{await new Promise(resolve=>server.close(resolve))}
}))
test('standalone bundle starts only its own loopback listener with no runtime node_modules',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cbob-bundle-')),source=path.resolve(new URL('../..',import.meta.url).pathname)
 let proc
 try {
  execFileSync(process.execPath,[path.join(source,'web/deploy/bundle-ceremony.mjs'),source,dir],{stdio:'pipe'})
  fs.mkdirSync(path.join(dir,'web/dist-mainnet-local'))
  proc=spawn(process.execPath,[path.join(dir,'web/deploy/ceremony-server.mjs')],{env:{PATH:'/usr/bin:/bin',CBOB_LOCAL_PORT:'0',CBOB_RPC_UPSTREAM:'https://example.invalid'}})
  let stdout='',stderr='';proc.stdout.on('data',b=>stdout+=b);proc.stderr.on('data',b=>stderr+=b)
  const timer=setTimeout(()=>proc.kill('SIGTERM'),1200)
  const [code,signal]=await new Promise(resolve=>proc.once('exit',(...args)=>resolve(args)));clearTimeout(timer)
  assert.equal(signal,'SIGTERM',stderr);assert.equal(code,null);assert.equal((stdout.match(/local ceremony/g)||[]).length,1);assert.doesNotMatch(stderr,/Error/)
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir,'web/deploy/build-inputs.json'))).esbuild)
 } finally {if(proc&&!proc.killed)proc.kill();fs.rmSync(dir,{recursive:true,force:true})}
})

function provenanceFixture(){
 const lock={schema:1,snapshot_sha256:'a'.repeat(64),node:'fixture',esbuild:'fixture',packages:{},inputs:{'tools/node_modules/esbuild/lib/main.js':'1'.repeat(64)}}
 const inputs={schema:1,snapshot:lock.snapshot_sha256,node:lock.node,esbuild:lock.esbuild,packages:{},inputs:{...lock.inputs,'source/example.mjs':'2'.repeat(64)}}
 return {lock,inputs}
}
test('artifact launch refuses installed, mismatched and unpinned dependency provenance',()=>{
 const {lock,inputs}=provenanceFixture()
 verifyBuildProvenance(lock,[inputs,inputs])
 assert.throws(()=>verifyBuildProvenance(lock,[]),/Both/)
 for(const change of [{snapshot:null},{node:'wrong'},{esbuild:'wrong'}])assert.throws(()=>verifyBuildProvenance(lock,[inputs,{...inputs,...change}]),/frozen toolchain/)
 assert.throws(()=>verifyBuildProvenance(lock,[inputs,{...inputs,inputs:{...inputs.inputs,'app/node_modules/extra/index.js':'3'.repeat(64)}}]),/Unpinned/)
 assert.throws(()=>verifyBuildProvenance(lock,[inputs,{...inputs,inputs:{}}]),/Incomplete/)
})
