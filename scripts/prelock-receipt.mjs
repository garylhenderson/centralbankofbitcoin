#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { RULED_DATES } from './check-launch-params.mjs'

export function judgeReceipt(r, live, { now, commit, hashes }) {
  const failures = [], need = (ok, why) => { if (!ok) failures.push(why) }
  need(r?.status === 'passed', 'suite receipt did not pass')
  need(r?.commit === commit, 'source commit changed since the full suite')
  need(Number.isInteger(r?.started) && Number.isInteger(r?.completed) && r.started <= r.completed && r.completed <= now && now-r.started <= 86400, 'suite is not fresh within 24 hours')
  need(r?.started >= RULED_DATES.lock_deadline-86400 && now <= RULED_DATES.lock_deadline, 'outside the ruled lock window')
  need(live?.matches === true && live.checked_at <= now && now-live.checked_at <= 60, 'live Core read is stale or off-pin')
  for (const k of ['program', 'programdata', 'genesis', 'upgrade_slot', 'sha256', 'pinned_sha256', 'bytes']) need(r?.core?.[k] === live?.[k], 'live Core changed: '+k)
  for (const name of ['full-suite.log','simulation.log','holder-e2e.log']) need(/^[a-f0-9]{64}$/.test(r?.logs?.[name] || '') && r.logs[name] === hashes[name], 'suite evidence changed: '+name)
  return failures
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [mode, dir] = process.argv.slice(2)
    if (!['--seal','--verify'].includes(mode) || !dir || process.argv.length !== 4) throw new Error('Usage: prelock-receipt.mjs --seal|--verify <receipt-directory>')
    const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
    const receiptDir = fs.realpathSync(dir)
    if (!receiptDir.startsWith(path.join(root,'.cache/prelock')+'/')) throw new Error('Receipt must be in the private prelock directory')
    const read = name => fs.readFileSync(path.join(receiptDir,name),'utf8')
    const commit = execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()
    if (execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}).trim()) throw new Error('Source is dirty')
    const live = JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/prelock-core.mjs')],{encoding:'utf8',stdio:['ignore','pipe','ignore']}))
    const hashes = Object.fromEntries(['full-suite.log','simulation.log','holder-e2e.log'].map(name => [name,createHash('sha256').update(read(name)).digest('hex')]))
    const now = Math.floor(Date.now()/1000)
    let r
    if (mode === '--seal') {
      const before = JSON.parse(read('core-before.json')), after = JSON.parse(read('core-after.json'))
      if (!before.matches || !after.matches || before.sha256 !== after.sha256 || before.upgrade_slot !== after.upgrade_slot) throw new Error('Core changed during tests')
      for (const name of ['full-suite','simulation','holder-e2e']) if (read(name+'.status').trim() !== '0') throw new Error('A suite did not exit successfully')
      const floor = (file,key) => {
        const value = fs.readFileSync(path.join(root,file),'utf8').match(new RegExp('^'+key+'=(\\d+)','m'))?.[1]
        if (!value) throw new Error('Missing suite floor')
        return value
      }
      const onchain=floor('scripts/run-tests.sh','MIN_ASSERTIONS'), web=floor('scripts/run-tests.sh','WEB_FLOOR'), sim=floor('sim/run-sim.sh','SIM_FLOOR'), e2e=floor('web/test/e2e-localnet.sh','E2E_FLOOR')
      if (!read('full-suite.log').includes(`${onchain}/${onchain} assertions, floor ${onchain}`) || !read('full-suite.log').includes(`web offline ${web}/${web}, floor ${web}`)) throw new Error('Full suite evidence incomplete')
      if (!read('simulation.log').includes(`${sim}/${sim}, floor ${sim}`) || !read('holder-e2e.log').includes(`e2e ${e2e}/${e2e}, floor ${e2e}`)) throw new Error('Scenario evidence incomplete')
      r = {status:'passed',commit:read('commit').trim(),started:Number(read('started')),completed:now,core:before,logs:hashes}
    } else r=JSON.parse(read('result.json'))
    const bad = judgeReceipt(r,live,{now,commit,hashes})
    if (bad.length) throw new Error(bad.join('; '))
    if (mode === '--seal') fs.writeFileSync(path.join(receiptDir,'result.json'),JSON.stringify(r,null,2)+'\n',{flag:'wx',mode:0o600})
    console.log('R1 receipt matches fresh live Core and unchanged source. This does not sign or authorize a lock.')
  } catch (e) { console.error('NO LOCK: '+String(e.message).replace(/https?:\/\/\S+/g,'<url>')); process.exitCode=1 }
}
