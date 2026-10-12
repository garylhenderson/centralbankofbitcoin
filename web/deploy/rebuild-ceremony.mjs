#!/usr/bin/env node
/** Portable, inert artifact rebuild. No install, service, signing or network. */
import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {verifyDependencySnapshot} from './build-dependencies.mjs'
import {verifyCeremonyArtifact} from './ceremony-build.mjs'
const [sourceArg,snapshotArg,distArg,outputArg]=process.argv.slice(2)
if(!sourceArg||!snapshotArg||!distArg||!outputArg)throw Error('Pass source, frozen dependencies, verified release dist, and a NEW output directory')
const source=fs.realpathSync(sourceArg),snapshot=fs.realpathSync(snapshotArg),dist=fs.realpathSync(distArg),output=path.resolve(outputArg)
const git=args=>execFileSync('/usr/bin/git',args,{cwd:source,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}}).trim()
const commit=git(['rev-parse','HEAD'])
if(git(['status','--porcelain','--untracked-files=all']))throw Error('Source must be clean')
const lock=JSON.parse(fs.readFileSync(path.join(source,'launch/build-dependency-lock.json')))
verifyDependencySnapshot(snapshot,lock.snapshot_sha256)
const readme=fs.readFileSync(path.join(source,'web/README.md'),'utf8')
const pin=readme.match(/^Pin review: `([^`]+)` · sha256 `([a-f0-9]{64})` · source commit `([a-f0-9]{40})`\.$/m)
if(!pin)throw Error('Missing exact pin review source')
git(['merge-base','--is-ancestor',pin[3],commit])
const changed=(a,b)=>execFileSync('/usr/bin/git',['diff','--no-renames','--name-only','-z',a,b],{cwd:source,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}}).split('\0').filter(Boolean)
if(changed(pin[3],commit).some(f=>f!=='web/README.md'))throw Error('Source changed after pin review')
const {validatePinReview}=await import(pathToFileURL(path.join(source,'scripts/pin-review.mjs')))
const {review,reviewed}=validatePinReview(source,pin[1],pin[3])
git(['merge-base','--is-ancestor',reviewed,pin[3]])
if(changed(reviewed,pin[3]).some(f=>f!==pin[1]))throw Error('Code changed while recording review')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const reviewBytes=fs.readFileSync(path.join(source,pin[1]))
if(hash(reviewBytes)!==pin[2])throw Error('Pin review bytes differ')
const rows=text=>[...text.matchAll(/^\| `(mainnet|mainnet-local)` \| `([^`]+)` \| `([a-f0-9]{64})` \|$/gm)]
const old=new Map(rows(git(['show',reviewed+':web/README.md'])).map(m=>[m[1]+'/'+m[2],m[3]]))
for(const m of rows(readme))if((old.get(m[1]+'/'+m[2])!==m[3]||m[2].startsWith('ceremony-'))&&!review.includes(m[3]))throw Error('Review omits an accepted fingerprint')
if(fs.existsSync(output))throw Error('Output exists; never replace an artifact')
fs.mkdirSync(path.dirname(output),{recursive:true})
const stage=fs.mkdtempSync(path.join(path.dirname(output),'.ceremony-build-'))
const env={PATH:'/usr/bin:/bin',CBOB_BUILD_DEPS:snapshot,CBOB_BUILD_DEPS_SHA256:lock.snapshot_sha256}
try{
 fs.mkdirSync(path.join(stage,'web/deploy'),{recursive:true})
 execFileSync(process.execPath,[path.join(source,'web/build.mjs'),'--require-frozen','--profile','mainnet-local','--dist',dist,'--out',path.join(stage,'web/dist-mainnet-local'),'--provenance',path.join(stage,'web/deploy/page-build-inputs.json')],{cwd:source,env,stdio:'pipe'})
 fs.copyFileSync(path.join(source,'web/README.md'),path.join(stage,'web/README.md'))
 for(const f of ['ceremony-build.mjs','launch-ceremony.mjs','check-ceremony-env.py'])fs.copyFileSync(path.join(source,'web/deploy',f),path.join(stage,'web/deploy',f))
 fs.copyFileSync(path.join(source,'launch/build-dependency-lock.json'),path.join(stage,'web/deploy/build-dependency-lock.json'))
 fs.writeFileSync(path.join(stage,'web/deploy/pin-review.md'),reviewBytes)
 execFileSync(process.execPath,[path.join(source,'web/deploy/bundle-ceremony.mjs'),source,stage,'--require-frozen'],{cwd:source,env,stdio:'pipe'})
 if(git(['status','--porcelain','--untracked-files=all']))throw Error('Build changed source')
 const files={};const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
  const f=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('No artifact symlinks');if(e.isDirectory())walk(f);else files[path.relative(stage,f)]=hash(fs.readFileSync(f))
 }}
 walk(stage)
 const manifest=JSON.stringify({source_commit:commit,files},null,2)+'\n'
 fs.writeFileSync(path.join(stage,'ARTIFACT.json'),manifest)
 verifyCeremonyArtifact(stage,commit,hash(manifest),{requireRootOwned:false})
 fs.renameSync(stage,output)
 console.log(JSON.stringify({source_commit:commit,artifact_sha256:hash(manifest),snapshot_sha256:lock.snapshot_sha256,installed:false}))
}finally{if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true})}
