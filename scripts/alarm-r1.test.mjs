import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {RULED_DATES} from '../bank/detectors.mjs'
// Optional source is only for triaging a not-yet-applied alarm patch. Production never reads it.
const source=fs.readFileSync(process.env.CBOB_ALARM_TEST_SOURCE||new URL('../bank/alarm.mjs',import.meta.url),'utf8')
const body=source.match(/function lockDeadline\(\) \{([\s\S]*?)\n\}/)[1]
const blob=`export const RULED_DATES = Object.freeze({ lock_deadline: ${RULED_DATES.lock_deadline}, charter_opens_at: ${RULED_DATES.charter_opens_at} })`
const run=(production,env={},committed=blob)=>new Function('D','PRODUCTION','process','fs','execFileSync',body)({RULED_DATES},production,{env},{readFileSync:()=>{assert.equal(production,false,'production must never read editing launch JSON');return JSON.stringify({lock_deadline:{value:123}})}},()=>committed)
test('production uses ruled deadline',()=>assert.equal(run(true),1792170000))
test('later override cannot postpone alarm',()=>assert.equal(run(true,{CBOB_LOCK_DEADLINE:'9999999999'}),1792170000))
test('earlier override still alarms early',()=>assert.equal(run(true,{CBOB_LOCK_DEADLINE:'1'}),1))
test('invalid overrides retain ruled deadline',()=>{for(const value of ['broken','0','-1'])assert.equal(run(true,{CBOB_LOCK_DEADLINE:value}),1792170000)})
test('rehearsal file remains effective',()=>assert.equal(run(false),123))
test('rehearsal override remains effective',()=>assert.equal(run(false,{CBOB_LOCK_DEADLINE:'999'}),999))
test('uncommitted date drift fails loudly',()=>assert.throws(()=>run(true,{},blob.replace('1792170000','1792170001')),/differ from the committed ruling/))
test('missing committed date pin fails loudly',()=>assert.throws(()=>run(true,{},''),/differ from the committed ruling/))
