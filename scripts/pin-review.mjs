import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'

/** Bind fresh outputs to the hashes actually named by the independent review. */
export function validateReviewedHashes(rows, previous, review) {
  const parse=text=>[...text.matchAll(/^\| `(mainnet|mainnet-local)` \| `([^`]+)` \| `([a-f0-9]{64})` \|$/gm)]
  const before=new Map(parse(previous).map(m=>[m[1]+'/'+m[2],m[3]]))
  const after=parse(rows), keys=new Set(after.map(m=>m[1]+'/'+m[2]))
  if(after.length!==20||keys.size!==20||before.size!==20||[...keys].some(k=>!before.has(k)))throw Error('Reviewed fingerprint table differs')
  for(const m of after)if((before.get(m[1]+'/'+m[2])!==m[3]||m[2].startsWith('ceremony-'))&&!review.includes(m[3]))throw Error('Review omits an accepted fingerprint: '+m[1]+'/'+m[2])
}

/** Evidence must be a newly added audit, with no intervening source change. */
export function validatePinReview(root, relative, recordedCommit) {
  if (!/^audits\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.md$/.test(relative || '')) throw Error('Pin review must be an audit Markdown file')
  if (!/^[a-f0-9]{40}$/.test(recordedCommit || '')) throw Error('Invalid pin review commit')
  const file = path.join(root, relative)
  if (fs.realpathSync(file) !== path.resolve(file) || !fs.statSync(file).isFile()) throw Error('Pin review may not be redirected')
  const review = fs.readFileSync(file, 'utf8')
  const reviewed = review.match(/^Reviewed source commit: `([a-f0-9]{40})`$/m)?.[1]
  if (!reviewed) throw Error('Review must name its exact source commit')
  const verdicts=[...review.matchAll(/^Pin acceptance: (.+)$/gm)]
  if(verdicts.length!==1 || verdicts[0][1]!==`APPROVED for \`${reviewed}\``)throw Error('Review must explicitly approve pin acceptance for this source')
  const git = args => execFileSync('git', args, {cwd:root,encoding:'utf8'})
  git(['merge-base','--is-ancestor',reviewed,recordedCommit])
  const changes = git(['diff','--no-renames','--name-status','-z',reviewed,recordedCommit]).split('\0').filter(Boolean)
  if (changes.length !== 2 || changes[0] !== 'A' || changes[1] !== relative) throw Error('Review recording must add only its audit file after the reviewed source')
  if (git(['show',recordedCommit+':'+relative]) !== review) throw Error('Review differs from committed evidence')
  return {review, reviewed}
}
