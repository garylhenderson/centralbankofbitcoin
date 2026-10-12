import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
const script=new URL('./prepare-ceremony.sh',import.meta.url).pathname
// Execute the real shell branches with read-only command doubles. Neither the
// installer nor the builder can run; their argument vectors are captured.
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cbob-prepare-')),commit='a'.repeat(40),capture=path.join(dir,'capture')
 const stub=(name,body)=>{const f=path.join(dir,name);fs.writeFileSync(f,'#!/bin/bash\nset -eu\n'+body);fs.chmodSync(f,0o700)}
 stub('git','case "$1" in status|fetch|merge-base) exit 0;; rev-parse) printf "%s\\n" "$CBOB_TEST_COMMIT";; *) exit 99;; esac\n')
 stub('stat','printf "0:0 755\\n"\n');stub('cmp','exit 0\n')
 stub('realpath','printf "%s\\n" "$CBOB_TEST_CACHE"\n')
 for(const name of ['sudo','env'])stub(name,'printf "%s\\n" "$@" > "$CBOB_TEST_CAPTURE"\n')
 const run=(mode,cache='/scratch/cbob-vaults-cache')=>execFileSync('/bin/bash',[script,mode,commit,'b'.repeat(40),'c'.repeat(64)],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{PATH:dir+':/usr/bin:/bin',CBOB_TEST_COMMIT:commit,CBOB_TEST_CAPTURE:capture,CBOB_TEST_CACHE:cache,CBOB_BUILD_DEPS:'/fixture/deps'}})
 try{fn({commit,capture,run})}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('prepare build uses canonical cache but install preserves the pinned logical argument',()=>fixture(({commit,capture,run})=>{
 run('--build');let args=fs.readFileSync(capture,'utf8').trim().split('\n')
 assert.equal(args.at(-1),'/scratch/cbob-vaults-cache/ceremony-artifacts/'+commit)
 run('--install');args=fs.readFileSync(capture,'utf8').trim().split('\n')
 assert.equal(args[2],'/opt/cbob-vaults/.cache/ceremony-artifacts/'+commit)
}))
test('prepare refuses a cache redirected outside the pinned server layout',()=>fixture(({capture,run})=>{
 assert.throws(()=>run('--build','/tmp/redirected'),/Candidate cache target differs/)
 assert.equal(fs.existsSync(capture),false)
}))
