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
const FLOORS = { 'ids.test.mjs': 41, 'ix.test.mjs': 47, 'decode.test.mjs': 16, 'plan.test.mjs': 173, 'get.test.mjs': 57, 'ceremony.test.mjs': 161, 'tx.test.mjs': 37, 'proxy.test.mjs': 129, 'meta.test.mjs': 25, 'bundle.test.mjs': 133, 'mine.test.mjs': 31, 'market.test.mjs': 18, 'ecosystem.test.mjs': 46, 'position.test.mjs': 27, 'governance.test.mjs': 36, 'governance-engine.test.mjs': 13 }
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
console.log(bad ? `FAILED: ${bad} file(s)` : `all ${total} offline assertions passed in ${Object.keys(FLOORS).length} files`)
process.exit(bad ? 1 : 0)
