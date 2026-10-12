#!/usr/bin/env node
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import {validatePinReview,validateReviewedHashes,validateIgnoredInputs} from './pin-review.mjs'
import {reviewedDependencySnapshot} from '../web/deploy/build-dependencies.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requireFrozen=process.argv.includes('--accept-reviewed')||process.argv.includes('--require-frozen')
if(requireFrozen)reviewedDependencySnapshot(root)
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cbob-pins-'))
process.on('exit', () => fs.rmSync(temporary, { recursive: true, force: true }))
let readme = fs.readFileSync(path.join(root,'web/README.md'),'utf8'), rows = []
for (const profile of ['mainnet','mainnet-local']) {
  const dir=path.join(temporary,profile)
  const provenance=path.join(temporary,profile+'-inputs.json')
  const frozen=requireFrozen
  const env={PATH:'/usr/bin:/bin',...(process.env.CBOB_BUILD_DEPS?{CBOB_BUILD_DEPS:process.env.CBOB_BUILD_DEPS,CBOB_BUILD_DEPS_SHA256:process.env.CBOB_BUILD_DEPS_SHA256}:{})}
  execFileSync(process.execPath,[path.join(root,'web/build.mjs'),'--profile',profile,'--out',dir,'--provenance',provenance,...(frozen?['--require-frozen']:[])],{stdio:'ignore',env})
  if(frozen&&JSON.parse(fs.readFileSync(provenance)).snapshot!==reviewedDependencySnapshot(root).digest)throw Error('Pin build did not use the committed dependency snapshot')
  for(const line of fs.readFileSync(path.join(dir,'BUILD.txt'),'utf8').split('\n')) {
    const m=/^([a-f0-9]{64})  (.+)$/.exec(line)
    if(m&&(m[2].endsWith('/app.js')||m[2]==='assets/style.css')) rows.push(`| \`${profile}\` | \`${m[2]}\` | \`${m[1]}\` |`)
  }
}
const existing = [...readme.matchAll(/^\| `(mainnet|mainnet-local)` \| `([^`]+)` \| `[a-f0-9]{64}` \|$/gm)]
if(existing.length !== rows.length || existing.length !== 20 || new Set(existing.map(m=>m[1]+'/'+m[2])).size !== 20) throw new Error('Published pin table is missing, duplicated or malformed')
readme=readme.replace(/(?:^\| `(mainnet|mainnet-local)` \| `[^`]+` \| `[a-f0-9]{64}` \|\n)+/m,rows.join('\n')+'\n')
const previous = fs.readFileSync(path.join(root, 'web/README.md'), 'utf8')
if (previous === readme && !process.argv.includes('--accept-reviewed')) { console.log('Published hash pins match both fresh builds.'); process.exit(0) }
if (!process.argv.includes('--accept-reviewed')) {
  console.error('Fresh bundles differ from published pins. Review the source and bundles; then use --accept-reviewed --review <audit-file>. No pins changed.')
  process.exit(1)
}
const reviewArg = process.argv.indexOf('--review'), reviewPath = reviewArg >= 0 ? process.argv[reviewArg + 1] : null
if (!reviewPath || !fs.existsSync(reviewPath) || fs.statSync(reviewPath).size < 100) throw new Error('A completed review artifact is required')
const dirty = execFileSync('git', ['status','--porcelain','--untracked-files=all'], {cwd:root,encoding:'utf8'}).trim()
if(dirty) throw new Error('Commit reviewed source before accepting new pins')
validateIgnoredInputs(root)
const {review,reviewed}=validatePinReview(root,path.relative(root,path.resolve(reviewPath)),execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim())
validateReviewedHashes(rows.join('\n'),execFileSync('git',['show',reviewed+':web/README.md'],{cwd:root,encoding:'utf8'}),review)
const evidence = 'Pin review: `' + path.relative(root,path.resolve(reviewPath)) + '` · sha256 `' + createHash('sha256').update(fs.readFileSync(reviewPath)).digest('hex') + '` · source commit `' + execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim() + '`.'
readme = readme.replace(/^Pin review:.*\n/m,'') + '\n' + evidence + '\n'
fs.writeFileSync(path.join(root, 'web/README.md'), readme)
console.log('Pins explicitly accepted with review sha256 ' + createHash('sha256').update(fs.readFileSync(reviewPath)).digest('hex'))
