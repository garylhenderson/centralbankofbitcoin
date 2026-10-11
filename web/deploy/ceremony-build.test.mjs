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
