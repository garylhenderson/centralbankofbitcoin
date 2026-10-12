import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {verifyDependencySnapshot,normalizeBuildLabels,reviewedDependencySnapshot,buildToolchain} from './build-dependencies.mjs'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbob-deps-'))
 const file='app/node_modules/example/index.js'
 fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true})
 fs.writeFileSync(path.join(root,file),'original')
 const manifest={schema:1,node:process.version,directories:['app','app/node_modules','app/node_modules/example'],files:{[file]:hash('original')}}
 const save=()=>{const text=JSON.stringify(manifest);fs.writeFileSync(path.join(root,'DEPENDENCIES.json'),text);return hash(text)}
 try{fn({root,file,manifest,save,digest:save()})}finally{fs.rmSync(root,{recursive:true,force:true})}
}
test('dependency verifier accepts exactly the pinned file set',()=>fixture(({root,digest})=>assert.equal(verifyDependencySnapshot(root,digest).digest,digest)))
test('changed dependency bytes are refused',()=>fixture(({root,file,digest})=>{fs.writeFileSync(path.join(root,file),'changed');assert.throws(()=>verifyDependencySnapshot(root,digest),/bytes differ/)}))
test('extra and missing dependencies are refused',()=>fixture(({root,file,digest})=>{
 const extra=path.join(root,'extra');fs.writeFileSync(extra,'extra');assert.throws(()=>verifyDependencySnapshot(root,digest),/file set/)
 fs.unlinkSync(extra);fs.mkdirSync(extra);assert.throws(()=>verifyDependencySnapshot(root,digest),/directory set/);fs.rmdirSync(extra);fs.unlinkSync(path.join(root,file));assert.throws(()=>verifyDependencySnapshot(root,digest),/file set/)
}))
test('hardlinked dependency files are refused',()=>fixture(({root,file,digest})=>{const link=path.join(root,'linked');fs.linkSync(path.join(root,file),link);assert.throws(()=>verifyDependencySnapshot(root,digest),/hardlink/)}))
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
 const disabled=normalizeBuildLabels(`// (disabled):${input}\n`,'/opt/cbob-vaults',{inputs:{['(disabled):'+input]:{}}},{frozen:{root:'/scratch/frozen'}})
 assert.equal(disabled,'// (disabled):../gary-club/node_modules/pkg/a.js\n')
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
 const result=execFileSync('python3',['-I','-B',new URL('./freeze-build-deps.test.py',import.meta.url).pathname],{encoding:'utf8',stdio:['ignore','pipe','pipe']})
 assert.ok(result.includes('12 dependency reconstruction/installer tests passed'))
})

test('real frozen resolver preserves a package and refuses parent node_modules fallback',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbob-frozen-resolver-')),source=path.join(root,'source'),snapshot=path.join(root,'deps')
 const previous={dir:process.env.CBOB_BUILD_DEPS,sha:process.env.CBOB_BUILD_DEPS_SHA256}
 let chain
 const write=(rel,text)=>{const f=path.join(root,rel);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,text)}
 try{
  write('source/package.json','{"private":true}')
  write('source/entry.mjs','import value from "good"; console.log(value)')
  write('deps/app/package.json','{"private":true}')
  write('deps/app/node_modules/good/package.json','{"name":"good","version":"1.0.0","main":"index.js"}')
  write('deps/app/node_modules/good/index.js','module.exports=42')
  write('node_modules/escape/index.js','module.exports=7')
  for(const name of ['esbuild',`@esbuild/${process.platform}-${process.arch}`])fs.cpSync('/home/ubuntu/luna-remotion/node_modules/'+name,path.join(snapshot,'tools/node_modules',name),{recursive:true,dereference:true})
  const configure=()=>{
   const files={},directories=[]
   const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name),rel=path.relative(snapshot,f);if(e.isDirectory()){directories.push(rel);walk(f)}else if(rel!=='DEPENDENCIES.json')files[rel]=hash(fs.readFileSync(f))}}
   walk(snapshot)
   const text=JSON.stringify({schema:1,node:process.version,directories:directories.sort(),files})
   fs.writeFileSync(path.join(snapshot,'DEPENDENCIES.json'),text)
   process.env.CBOB_BUILD_DEPS=snapshot;process.env.CBOB_BUILD_DEPS_SHA256=hash(text)
   chain=buildToolchain(source)
   return {entryPoints:[path.join(source,'entry.mjs')],absWorkingDir:source,bundle:true,write:false,metafile:true,tsconfigRaw:{},platform:'browser',logLevel:'silent',plugins:chain.plugins}
  }
  const built=await chainBuild(configure());assert.match(built.outputFiles[0].text,/42/)
  write('deps/app/node_modules/good/index.js','module.exports=require("escape")')
  await assert.rejects(()=>chainBuild(configure()),/escaped snapshot/)
  function chainBuild(options){return chain.esbuild.build(options)}
 }finally{
  chain?.esbuild.stop()
  for(const [key,value] of [['CBOB_BUILD_DEPS',previous.dir],['CBOB_BUILD_DEPS_SHA256',previous.sha]]){if(value===undefined)delete process.env[key];else process.env[key]=value}
  fs.rmSync(root,{recursive:true,force:true})
 }
})
