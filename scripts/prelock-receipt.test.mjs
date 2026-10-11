import test from 'node:test'
import assert from 'node:assert/strict'
import {judgeReceipt} from './prelock-receipt.mjs'
import {RULED_DATES} from './check-launch-params.mjs'
const now=RULED_DATES.lock_deadline-60, commit='a'.repeat(40)
const core={checked_at:now-10,matches:true,program:'core',programdata:'data',genesis:'mainnet',upgrade_slot:123,sha256:'b'.repeat(64),pinned_sha256:'b'.repeat(64),bytes:1000}
const hashes=Object.fromEntries(['full-suite.log','simulation.log','holder-e2e.log'].map(n=>[n,'c'.repeat(64)]))
const receipt={status:'passed',commit,started:now-3600,completed:now-20,core,logs:hashes}
const judge=(r=receipt,l=core,opts={})=>judgeReceipt(r,l,{now,commit,hashes,...opts})
test('fresh unchanged complete evidence passes',()=>assert.deepEqual(judge(),[]))
for(const [name,mutate] of [
 ['failed suite',r=>{r.status='failed'}],
 ['stale run',r=>{r.started=now-86401}],
 ['future completion',r=>{r.completed=now+1}],
 ['changed source',r=>{r.commit='d'.repeat(40)}],
 ['missing log',r=>{delete r.logs['holder-e2e.log']}],
 ['altered log',r=>{r.logs['full-suite.log']='f'.repeat(64)}],
 ['changed live Core bytes',r=>{r.core.sha256='0'.repeat(64)}],
 ['Core upgraded then reverted',r=>{r.core.upgrade_slot--}],
])test(name+' refuses',()=>{const r=structuredClone(receipt);mutate(r);assert.ok(judge(r).length)})
test('stale or off-pin live read refuses',()=>{assert.ok(judge(receipt,{...core,checked_at:now-61}).length);assert.ok(judge(receipt,{...core,matches:false}).length)})
test('past ruled deadline refuses even fresh tests',()=>assert.ok(judge(receipt,{...core,checked_at:RULED_DATES.lock_deadline+1},{now:RULED_DATES.lock_deadline+1}).length))
test('future live read refuses',()=>assert.ok(judge(receipt,{...core,checked_at:now+1}).length))
