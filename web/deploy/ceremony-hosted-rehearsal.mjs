#!/usr/bin/env node
/** Root-only, synthetic delivery test. Never starts a production unit or calls RPC.
 * sudo /usr/bin/node web/deploy/ceremony-hosted-rehearsal.mjs
 * Builds as the invoking unprivileged user, installs a temporary root-owned
 * fixture, and executes the REAL launcher and hosted bundle as nobody.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import assert from 'node:assert/strict'
import {randomBytes,createHash} from 'node:crypto'
import {execFileSync,spawn} from 'node:child_process'
import {once} from 'node:events'
import {fileURLToPath} from 'node:url'
import {reviewedDependencySnapshot} from './build-dependencies.mjs'

if(process.getuid()!==0 || !['SUDO_UID','SUDO_GID'].every(k=>/^\d+$/.test(process.env[k]||'')&&Number(process.env[k])>0)) throw Error('Run with sudo from the unprivileged source owner')
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const commit=randomBytes(20).toString('hex'),parent='/opt/cbob-ceremony',tree=path.join(parent,commit)
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'cbob-hosted-fixture-'))
const uid=Number(process.env.SUDO_UID),gid=Number(process.env.SUDO_GID)
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
let proc,parentCreated=false,fixtureCreated=false,cleanupPromise
const stop=async()=>{if(proc&&proc.exitCode===null&&proc.signalCode===null){const exited=once(proc,'close');proc.kill('SIGTERM');const timer=setTimeout(()=>proc?.kill('SIGKILL'),2000);try{await exited}finally{clearTimeout(timer)}}proc=null}
const cleanup=()=>cleanupPromise ||= (async()=>{
  const failures=[]
  for(const clean of [stop,()=>{if(fixtureCreated)fs.rmSync(tree,{recursive:true,force:true})},()=>{if(parentCreated&&fs.existsSync(parent)&&fs.readdirSync(parent).length===0)fs.rmdirSync(parent)},()=>fs.rmSync(stage,{recursive:true,force:true})])try{await clean()}catch{failures.push('Fixture cleanup failed; inspect '+tree+' and '+stage)}
  if(failures.length)throw Error(failures.join('\n'))
})()
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,()=>{cleanup().then(()=>process.exit(130),()=>process.exit(1))})
try {
  const git=args=>execFileSync('git',args,{cwd:source,uid,gid,env:{PATH:'/usr/bin:/bin'},encoding:'utf8'}).trim()
  const sourceCommit=git(['rev-parse','HEAD']),dirty=!!git(['status','--porcelain','--untracked-files=all'])
  if(dirty&&!process.argv.includes('--development'))throw Error('Commit source first; --development results cannot satisfy the release gate')
  console.log(JSON.stringify({source_commit:sourceCommit,source_dirty:dirty,development:process.argv.includes('--development'),node:process.version,fixture:tree}))
  reviewedDependencySnapshot(source)
  const buildEnv={PATH:'/usr/bin:/bin',CBOB_BUILD_DEPS:process.env.CBOB_BUILD_DEPS,CBOB_BUILD_DEPS_SHA256:process.env.CBOB_BUILD_DEPS_SHA256}
  fs.chownSync(stage,uid,gid)
  execFileSync(process.execPath,[path.join(source,'web/deploy/bundle-ceremony.mjs'),source,stage,'--require-frozen'],{uid,gid,env:buildEnv,stdio:'pipe',timeout:30000})
  if(!fs.existsSync(parent)){fs.mkdirSync(parent,{mode:0o755});parentCreated=true}
  const st=fs.lstatSync(parent)
  if(st.isSymbolicLink()||fs.realpathSync(parent)!==parent||st.uid!==0||(st.mode&0o022))throw Error('Unsafe fixture parent')
  fs.mkdirSync(tree,{mode:0o755});fixtureCreated=true
  fs.cpSync(stage,tree,{recursive:true})
  const deploy=path.join(tree,'web/deploy'),root=path.join(tree,'web/dist-mainnet-local')
  for(const name of ['launch-ceremony.mjs','ceremony-build.mjs','check-ceremony-env.py'])fs.copyFileSync(path.join(source,'web/deploy',name),path.join(deploy,name))
  const pages={'ceremony-a1/index.html':'<!doctype html><title>Synthetic signing fixture</title>','ceremony-a1/app.js':'/* synthetic fixture, no signing */','assets/style.css':'body { color: black; }'}
  for(const [rel,body] of Object.entries(pages)){fs.mkdirSync(path.dirname(path.join(root,rel)),{recursive:true});fs.writeFileSync(path.join(root,rel),body)}
  const rows=Object.entries(pages).map(([rel,body])=>`${hash(body)}  ${rel}`)
  fs.writeFileSync(path.join(root,'BUILD.txt'),`profile   mainnet-local\ncommit    ${commit}\n${rows.join('\n')}\n`)
  const evidence='Synthetic fixture only. This is not a signing authorization.\n'
  fs.writeFileSync(path.join(deploy,'pin-review.md'),evidence)
  fs.copyFileSync(path.join(source,'launch/build-dependency-lock.json'),path.join(deploy,'build-dependency-lock.json'))
  fs.writeFileSync(path.join(deploy,'page-build-inputs.json'),JSON.stringify({...JSON.parse(fs.readFileSync(path.join(deploy,'build-inputs.json'))),synthetic:true})+'\n')
  fs.writeFileSync(path.join(tree,'web/README.md'),Object.entries(pages).filter(([rel])=>!rel.endsWith('.html')).map(([rel,body])=>`| \`mainnet-local\` | \`${rel}\` | \`${hash(body)}\` |`).join('\n')+`\nPin review: \`audits/fixture.md\` · sha256 \`${hash(evidence)}\` · source commit \`${commit}\`.\n`)
  const files={}
  const walk=dir=>{fs.chmodSync(dir,0o755);for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Symlink in fixture');if(entry.isDirectory())walk(file);else{fs.chmodSync(file,0o644);files[path.relative(tree,file)]=hash(fs.readFileSync(file))}}}
  walk(tree)
  const manifest=JSON.stringify({source_commit:commit,files},null,2)+'\n'
  fs.writeFileSync(path.join(tree,'ARTIFACT.json'),manifest,{mode:0o644})
  fs.writeFileSync(path.join(tree,'SYNTHETIC-REHEARSAL'),'Temporary synthetic test. Never install or sign with this artifact.\n',{mode:0o644})
  console.log(JSON.stringify({esbuild:JSON.parse(fs.readFileSync(path.join(deploy,'build-inputs.json'))).esbuild,fixture_deploy_hashes:Object.fromEntries(Object.entries(files).filter(([rel])=>rel.startsWith('web/deploy/')))}))
  // An on-disk file outside the signed manifests must never be served.
  fs.mkdirSync(path.join(root,'ceremony-b2'),{mode:0o755})
  fs.writeFileSync(path.join(root,'ceremony-b2/app.js'),'not attested',{mode:0o644})
  fs.writeFileSync(path.join(root,'planted.js'),'not attested',{mode:0o644})
  const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
  const secret=randomBytes(32).toString('hex')
  const env={PATH:'/usr/bin:/bin',CBOB_CEREMONY_COMMIT:commit,CBOB_CEREMONY_ARTIFACT_SHA256:hash(manifest),CBOB_CEREMONY_PROFILE:'mainnet-hosted',CBOB_CEREMONY_ORIGINS:'https://sign.centralbankofbitcoin.com',CBOB_CEREMONY_HOSTED_AUTH:'nginx-basic',CBOB_CEREMONY_PROXY_SECRET:secret,CBOB_LOCAL_PORT:String(port),CBOB_RPC_UPSTREAM:'http://127.0.0.1:1'}
  let stdout='',stderr=''
  const start=()=>{stdout='';stderr='';proc=spawn(process.execPath,[path.join(deploy,'launch-ceremony.mjs')],{uid:65534,gid:65534,env,stdio:['ignore','pipe','pipe']});proc.stdout.on('data',b=>stdout+=b);proc.stderr.on('data',b=>stderr+=b)}
  const refuses=async pattern=>{start();const closed=once(proc,'close'),timer=setTimeout(()=>proc.kill('SIGKILL'),3000);const [code,signal]=await closed;clearTimeout(timer);assert.equal(signal,null);assert.notEqual(code,0);assert.match(stderr,pattern);assert.equal(stdout,'')}
  start()
  const origin='http://127.0.0.1:'+port,headers={'x-cbob-ceremony':secret}
  let ready=false
  for(let n=0;n<150;n++){if(proc.exitCode!==null)throw Error('Hosted fixture exited: '+stderr);if(stdout.includes('local ceremony (mainnet-hosted)')){ready=true;break}await new Promise(resolve=>setTimeout(resolve,20))}
  assert.ok(ready,'Hosted listener must start within three seconds')
  assert.equal((await fetch(origin+'/BUILD.txt')).status,403)
  assert.equal((await fetch(origin+'/BUILD.txt',{headers:{'x-cbob-ceremony':'0'.repeat(64)}})).status,403)
  for(const [rel,body] of [...Object.entries(pages),['BUILD.txt',fs.readFileSync(path.join(root,'BUILD.txt'),'utf8')]]){const response=await fetch(origin+'/'+rel,{headers});assert.equal(response.status,200);assert.equal(hash(Buffer.from(await response.arrayBuffer())),hash(body));assert.equal(response.headers.get('cache-control'),'no-store')}
  for(const rel of ['planted.js','ceremony-b2/app.js','web/deploy/ceremony-server.mjs'])assert.equal((await fetch(origin+'/'+rel,{headers})).status,404)
  assert.equal((await fetch(origin+'/rpc',{headers})).status,405)
  assert.equal((await fetch(origin+'/rpc',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getSlot'})})).status,403)
  const rpc=(method,originHeader='https://sign.centralbankofbitcoin.com')=>fetch(origin+'/rpc',{method:'POST',headers:{...headers,'content-type':'application/json',origin:originHeader,'sec-fetch-site':'same-origin'},body:JSON.stringify({jsonrpc:'2.0',id:1,method})})
  assert.equal((await rpc('getSlot')).status,502)
  const forbidden=await rpc('requestAirdrop');assert.equal(forbidden.status,403);assert.equal((await forbidden.json()).error.code,-32601)
  assert.equal((await rpc('getSlot','https://centralbankofbitcoin.com')).status,403)
  console.log('PASS actual launcher → attestation → hosted bundle: authenticated bytes, secret and unlisted-file refusal, accepted-origin RPC forwarding, wrong-origin and forbidden-method refusal')
  await stop()
  const pageFile=path.join(root,'ceremony-a1/app.js')
  fs.chownSync(pageFile,65534,65534);await refuses(/Writable or redirected artifact/);fs.chownSync(pageFile,0,0)
  fs.chmodSync(pageFile,0o664);await refuses(/Writable or redirected artifact/);fs.chmodSync(pageFile,0o644)
  fs.chmodSync(root,0o775);await refuses(/Writable or redirected artifact/);fs.chmodSync(root,0o755)
  env.CBOB_CEREMONY_ARTIFACT_SHA256='0'.repeat(64);await refuses(/Artifact attestation differs/);env.CBOB_CEREMONY_ARTIFACT_SHA256=hash(manifest)
  console.log('PASS wrong ownership, writable file/directory and wrong digest refuse before listening')
  fs.appendFileSync(path.join(root,'ceremony-a1/app.js'),'tampered')
  await refuses(/Artifact bytes differ/)
  console.log('PASS tampered artifact refuses before opening a listener')
} finally {
  await cleanup()
}
