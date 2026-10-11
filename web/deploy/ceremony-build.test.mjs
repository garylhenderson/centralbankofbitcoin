import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {verifyCeremonyBuild} from './ceremony-build.mjs'
const commit='a'.repeat(40), app='ceremony-a1/app.js'
function fixture(fn) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cbob-ceremony-test-')),root=path.join(dir,'web/dist-mainnet-local')
 const files={[app]:'reviewed script','ceremony-a1/index.html':'reviewed html','assets/style.css':'reviewed css'}
 const rows=Object.entries(files).map(([rel,body])=>{fs.mkdirSync(path.dirname(path.join(root,rel)),{recursive:true});fs.writeFileSync(path.join(root,rel),body);return[createHash('sha256').update(body).digest('hex'),rel]})
 fs.writeFileSync(path.join(root,'BUILD.txt'),`profile   mainnet-local\ncommit    ${commit}\n`+rows.map(x=>x.join('  ')).join('\n')+'\n')
 fs.writeFileSync(path.join(dir,'web/README.md'),rows.filter(x=>x[1]!== 'ceremony-a1/index.html').map(([h,f])=>`| \`mainnet-local\` | \`${f}\` | \`${h}\` |`).join('\n')+'\nPin review: reviewed artifact\n')
 try {fn(root,()=>verifyCeremonyBuild(root,commit,{requireRootOwned:false}))}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('complete reviewed build passes and real deployment refuses a temporary root',()=>fixture((root,check)=>{assert.equal(check().files,3);assert.throws(()=>verifyCeremonyBuild(root,commit),/pinned artifact/)}))
test('changed script is refused',()=>fixture((root,check)=>{fs.appendFileSync(path.join(root,app),'tampered');assert.throws(check,/differs from manifest/)}))
test('wrong commit and dirty build are refused',()=>fixture((root,check)=>{const p=path.join(root,'BUILD.txt');fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(commit,commit+' (dirty)'));assert.throws(check,/identity differs/)}))
test('symlinked script is refused',()=>fixture((root,check)=>{const p=path.join(root,app);fs.renameSync(p,p+'.real');fs.symlinkSync(p+'.real',p);assert.throws(check,/symlinks/)}))
test('missing reviewed pin is refused',()=>fixture((root,check)=>{fs.writeFileSync(path.resolve(root,'../README.md'),'Pin review: incomplete\n');assert.throws(check,/reviewed fingerprint/)}))
test('duplicate manifest entry is refused',()=>fixture((root,check)=>{const p=path.join(root,'BUILD.txt');fs.appendFileSync(p,fs.readFileSync(p,'utf8').split('\n')[2]+'\n');assert.throws(check,/manifest path/)}))

import {verifyCeremonyArtifact} from './ceremony-build.mjs'
import {pinnedBuildFor,localListener} from './ceremony-local.mjs'
test('tunnel profile executes the same pinned-build guard',()=>{let called=false;const r=pinnedBuildFor('/opt/cbob-ceremony/'+commit,{profile:'mainnet-local',root:'/pinned'},{CBOB_CEREMONY_COMMIT:commit},(root,c)=>{called=true;assert.equal(root,'/pinned');assert.equal(c,commit);return{allowed:['BUILD.txt']}});assert.ok(called);assert.deepEqual(r.allowed,['BUILD.txt'])})
test('pinned path with missing identity cannot silently use the unpinned tunnel',()=>assert.throws(()=>pinnedBuildFor('/opt/cbob-ceremony/'+commit,{profile:'mainnet-local',root:'/missing'},{},()=>{throw Error('identity missing')}),/identity missing/))
test('listener refuses files outside the reviewed manifest',()=>fixture((root)=>{let status;const res={set statusCode(v){status=v},end(){}};localListener(root,()=>{},new Set(['BUILD.txt']))({url:'/'+app,method:'GET'},res);assert.equal(status,404)}))
test('full attestation covers HTML and server code, not only executable page pins',()=>fixture((root)=>{
 const tree=path.resolve(root,'../..');fs.mkdirSync(path.join(tree,'web/deploy'))
 for(const name of ['launch-ceremony.mjs','ceremony-build.mjs','ceremony-server.mjs'])fs.writeFileSync(path.join(tree,'web/deploy',name),'server code')
 const files={};function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else files[path.relative(tree,f)]=createHash('sha256').update(fs.readFileSync(f)).digest('hex')}}walk(tree)
 const manifest=JSON.stringify({source_commit:commit,files}),expected=createHash('sha256').update(manifest).digest('hex');fs.writeFileSync(path.join(tree,'ARTIFACT.json'),manifest)
 assert.equal(verifyCeremonyArtifact(tree,commit,expected,{requireRootOwned:false}).files,3)
 fs.appendFileSync(path.join(root,'ceremony-a1/index.html'),'<script>tamper</script>');assert.throws(()=>verifyCeremonyArtifact(tree,commit,expected,{requireRootOwned:false}),/bytes differ/)
 files['web/dist-mainnet-local/ceremony-a1/index.html']=createHash('sha256').update(fs.readFileSync(path.join(root,'ceremony-a1/index.html'))).digest('hex');fs.writeFileSync(path.join(tree,'ARTIFACT.json'),JSON.stringify({source_commit:commit,files}));assert.throws(()=>verifyCeremonyArtifact(tree,commit,expected,{requireRootOwned:false}),/attestation differs/)
}))
