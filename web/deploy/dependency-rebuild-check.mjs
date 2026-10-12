#!/usr/bin/env node
// Read-only source / isolated outputs. No signing, deployment, registry fetch,
// npm invocation or live service changes. Both snapshots must already exist.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {verifyDependencySnapshot} from './build-dependencies.mjs'
const source=path.resolve(new URL('../..',import.meta.url).pathname)
const [first,second]=process.argv.slice(2)
if(!first||!second)throw Error('Pass two independently reconstructed snapshot directories')
const pin=JSON.parse(fs.readFileSync(path.join(source,'launch/build-dependency-lock.json')))
for(const dir of [first,second])verifyDependencySnapshot(dir,pin.snapshot_sha256)
if(fs.realpathSync(first)===fs.realpathSync(second))throw Error('Use two separate reconstructed snapshots')
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim()
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:source,encoding:'utf8'}).trim(),'','Commit source before recording build evidence')
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'cbob-dependency-check-'))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const files=root=>{
 const out={};const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else out[path.relative(root,f)]=hash(fs.readFileSync(f))}}
 walk(root);return Object.fromEntries(Object.entries(out).sort())
}
const receipt={source_commit:commit,source_dirty:false,snapshot_sha256:pin.snapshot_sha256,profiles:{},server:{}}
try{
 for(const profile of ['mainnet','mainnet-local']){
  let reference,provenance
  for(const [label,dir] of [['installed',null],['frozen-a',first],['frozen-b',second]]){
   const out=path.join(stage,profile,label),record=out+'.inputs.json'
   const env={PATH:process.env.PATH,...(dir?{CBOB_BUILD_DEPS:dir,CBOB_BUILD_DEPS_SHA256:pin.snapshot_sha256}:{})}
   execFileSync(process.execPath,[path.join(source,'web/build.mjs'),'--profile',profile,'--out',out,'--provenance',record],{cwd:source,env,stdio:'pipe',timeout:30000})
   const actual=files(out),inputs=JSON.parse(fs.readFileSync(record))
   if(reference){assert.deepEqual(actual,reference,profile+' '+label+' differs');assert.deepEqual(inputs.inputs,provenance,profile+' dependency inputs differ')}
   else{reference=actual;provenance=inputs.inputs}
  }
  receipt.profiles[profile]=reference
 }
 let reference,provenance
 for(const [label,dir] of [['installed',null],['frozen-a',first],['frozen-b',second]]){
  const out=path.join(stage,'server',label)
  const env={PATH:process.env.PATH,...(dir?{CBOB_BUILD_DEPS:dir,CBOB_BUILD_DEPS_SHA256:pin.snapshot_sha256}:{})}
  execFileSync(process.execPath,[path.join(source,'web/deploy/bundle-ceremony.mjs'),source,out],{cwd:source,env,stdio:'pipe',timeout:30000})
  const actual=hash(fs.readFileSync(path.join(out,'web/deploy/ceremony-server.mjs'))),inputs=JSON.parse(fs.readFileSync(path.join(out,'web/deploy/build-inputs.json')))
  if(reference){assert.equal(actual,reference,'server bundle differs');assert.deepEqual(inputs.inputs,provenance,'server dependency inputs differ')}
  else{reference=actual;provenance=inputs.inputs}
 }
 receipt.server.sha256=reference
 receipt.ok=true
 receipt.limits='Same-box reproducibility only. Independent operator/off-box comparison, fingerprint review and delivery checks remain required.'
 console.log(JSON.stringify(receipt,null,2))
}finally{fs.rmSync(stage,{recursive:true,force:true})}
