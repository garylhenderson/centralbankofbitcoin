import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {verifyDependencySnapshot,normalizeBuildLabels,reviewedDependencySnapshot} from './build-dependencies.mjs'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbob-deps-'))
 const file='app/node_modules/example/index.js'
 fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true})
 fs.writeFileSync(path.join(root,file),'original')
 const manifest={schema:1,node:process.version,files:{[file]:hash('original')}}
 const save=()=>{const text=JSON.stringify(manifest);fs.writeFileSync(path.join(root,'DEPENDENCIES.json'),text);return hash(text)}
 try{fn({root,file,manifest,save,digest:save()})}finally{fs.rmSync(root,{recursive:true,force:true})}
}
test('dependency verifier accepts exactly the pinned file set',()=>fixture(({root,digest})=>assert.equal(verifyDependencySnapshot(root,digest).digest,digest)))
test('changed dependency bytes are refused',()=>fixture(({root,file,digest})=>{fs.writeFileSync(path.join(root,file),'changed');assert.throws(()=>verifyDependencySnapshot(root,digest),/bytes differ/)}))
test('extra and missing dependencies are refused',()=>fixture(({root,file,digest})=>{
 const extra=path.join(root,'extra');fs.writeFileSync(extra,'extra');assert.throws(()=>verifyDependencySnapshot(root,digest),/file set/)
 fs.unlinkSync(extra);fs.unlinkSync(path.join(root,file));assert.throws(()=>verifyDependencySnapshot(root,digest),/file set/)
}))
test('manifest replacement and missing expected digest are refused',()=>fixture(({root,manifest,save,digest})=>{
 assert.throws(()=>verifyDependencySnapshot(root),/reviewed dependency/)
 manifest.esbuild='unexpected';save();assert.throws(()=>verifyDependencySnapshot(root,digest),/digest differs/)
}))
test('wrong Node version and dependency symlinks are refused',()=>fixture(({root,file,manifest,save})=>{
 manifest.node='v0.0.0';assert.throws(()=>verifyDependencySnapshot(root,save()),/toolchain/)
 manifest.node=process.version;const digest=save();fs.unlinkSync(path.join(root,file));fs.symlinkSync('/etc/hostname',path.join(root,file));assert.throws(()=>verifyDependencySnapshot(root,digest),/symlink/)
}))
test('unsafe paths and special files cannot be admitted by a matching manifest',()=>fixture(({root,manifest,save})=>{
 manifest.files['../escape']=hash('escape');assert.throws(()=>verifyDependencySnapshot(root,save()),/file set|Invalid/)
 delete manifest.files['../escape'];execFileSync('mkfifo',[path.join(root,'fifo')]);assert.throws(()=>verifyDependencySnapshot(root,save()),/special file/)
}))
test('path normalization changes labels only, never executable strings',()=>{
 const input='../../scratch/frozen/app/node_modules/pkg/a.js'
 const text=`// ${input}\n  "${input}"(exports) {\nconst value = "${input}";\n`
 const result=normalizeBuildLabels(text,'/opt/cbob-vaults',{inputs:{[input]:{}}},{frozen:{root:'/scratch/frozen'}})
 assert.equal(result,`// ../gary-club/node_modules/pkg/a.js\n  "../gary-club/node_modules/pkg/a.js"(exports) {\nconst value = "${input}";\n`)
})
test('pin acceptance requires the committed snapshot digest',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbob-dep-pin-')),before={dir:process.env.CBOB_BUILD_DEPS,sha:process.env.CBOB_BUILD_DEPS_SHA256}
 try{
 fs.mkdirSync(path.join(root,'launch'));fs.writeFileSync(path.join(root,'launch/build-dependency-lock.json'),JSON.stringify({snapshot_sha256:'a'.repeat(64)}))
 delete process.env.CBOB_BUILD_DEPS;assert.throws(()=>reviewedDependencySnapshot(root),/frozen build/)
 process.env.CBOB_BUILD_DEPS=root;process.env.CBOB_BUILD_DEPS_SHA256='b'.repeat(64);assert.throws(()=>reviewedDependencySnapshot(root),/committed pin/)
 }finally{for(const [key,value] of [['CBOB_BUILD_DEPS',before.dir],['CBOB_BUILD_DEPS_SHA256',before.sha]]){if(value===undefined)delete process.env[key];else process.env[key]=value}fs.rmSync(root,{recursive:true,force:true})}
})
test('registry reconstruction rejects unsafe archives and mismatched inputs',()=>{
 const result=execFileSync('python3',['-B',new URL('./freeze-build-deps.test.py',import.meta.url).pathname],{encoding:'utf8',stdio:['ignore','pipe','pipe']})
 assert.match(result,/7 dependency reconstruction tests passed/)
})
