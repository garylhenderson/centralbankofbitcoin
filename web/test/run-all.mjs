#!/usr/bin/env node
/**
 * Every OFFLINE test of the pages, after a fresh mainnet build. No validator, no
 * network. Each file's assertion count must EQUAL its floor here: an exit code
 * cannot tell "all passed" from "stopped early and passed what it reached".
 *   node web/test/run-all.mjs
 */
import { execFileSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLOORS = { 'ids.test.mjs': 41, 'ix.test.mjs': 47, 'decode.test.mjs': 16, 'plan.test.mjs': 173, 'get.test.mjs': 57, 'ceremony.test.mjs': 164, 'tx.test.mjs': 37, 'proxy.test.mjs': 134, 'meta.test.mjs': 25, 'bundle.test.mjs': 133, 'mine.test.mjs': 31, 'market.test.mjs': 18, 'ecosystem.test.mjs': 58, 'public-data.test.mjs': 5, 'position.test.mjs': 27, 'governance.test.mjs': 36, 'governance-engine.test.mjs': 27, 'sale-proposal.test.mjs': 42, 'trade-state.test.mjs': 21, 'trade-engine.test.mjs': 31, 'opening-engine.test.mjs': 30 }
execFileSync(process.execPath, [path.join(HERE, '..', 'build.mjs')], { stdio: ['ignore', 'ignore', 'inherit'] })
let bad = 0, total = 0
for (const [f, floor] of Object.entries(FLOORS)) {
  let out = ''
  try { out = execFileSync(process.execPath, [path.join(HERE, f)], { encoding: 'utf8' }) } catch (e) { out = (e.stdout || '') + (e.stderr || '') }
  const m = /: (\d+)\/(\d+) passed\s*$/.exec(out.trim())
  const fails = out.split('\n').filter(l => l.startsWith('  XX'))
  const ok = m && m[1] === m[2] && Number(m[2]) === floor
  total += m ? Number(m[2]) : 0
  console.log(`${ok ? 'ok  ' : 'XX  '}${f}  ${m ? `${m[1]}/${m[2]}` : 'did not finish'} (floor ${floor})`)
  if (!ok) { bad++; console.log(fails.join('\n') || out.slice(-2000)) }
}
// Node's runner covers asynchronous ballot, wallet and receipt behavior. Require
// an exact case count, zero skips and a successful exit, independently of floors.
for(const [file,count] of Object.entries({'ballot.test.mjs':9,'holder-wallet.test.mjs':5,'vote-recovery.test.mjs':6,'proposal-recovery.test.mjs':6,'proposal-signing.test.mjs':8,'market-book.test.mjs':27,'sale-round.test.mjs':10,'vault-move.test.mjs':8,'move-recovery.test.mjs':8})) {
  let out='',ok=false
  try {
    out=execFileSync(process.execPath,['--test',path.join(HERE,file)],{encoding:'utf8'})
    ok=new RegExp(`^# tests ${count}$`,'m').test(out)&&new RegExp(`^# pass ${count}$`,'m').test(out)&&/^# fail 0$/m.test(out)&&/^# skipped 0$/m.test(out)&&/^# cancelled 0$/m.test(out)
  }catch(e){out=(e.stdout||'')+(e.stderr||'')}
  console.log(`${ok?'ok  ':'XX  '}${file} (${count} required cases)`)
  if(!ok){bad++;console.log(out.slice(-2000))}
}
console.log(bad ? `FAILED: ${bad} file(s)` : `all ${total} offline assertions passed in ${Object.keys(FLOORS).length} files, plus 87 ballot/wallet/recovery/market/round/move cases`)
process.exit(bad ? 1 : 0)
