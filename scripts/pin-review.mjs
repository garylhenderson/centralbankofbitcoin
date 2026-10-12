import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'

/** Generated outputs are expected; ignored executable inputs are not. */
export function validateIgnoredInputs(root) {
  const ignored=execFileSync('/usr/bin/git',['ls-files','--others','--ignored','--exclude-standard','-z','--','web','bank','scripts','launch','package.json'],{cwd:root,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}}).split('\0').filter(Boolean)
  const allowed=/^(?:web\/dist\/|web\/dist-[^/]+\/|web\/test\/\.out\/|web\/\.cache\/|bank\/(?:\.alarm-has-run$|(?:acks|state|distributions|revenue-ledger)\.json$|\.crank-(?:heartbeat|fee-warned)$|\.[^/]+\.lock[^/]*$|keys\/[^/]+\.json$|locks\/))/
  const unexpected=ignored.filter(f=>!allowed.test(f))
  if(unexpected.length)throw Error('Ignored source files cannot authorize fingerprints: '+unexpected.map(f=>JSON.stringify(f)).join(', '))
}

/** Bind fresh outputs to the hashes actually named by the independent review. */
export function validateReviewedHashes(rows, previous, review) {
  const parse=text=>[...text.matchAll(/^\| `(mainnet|mainnet-local)` \| `([^`]+)` \| `([a-f0-9]{64})` \|$/gm)]
  const before=new Map(parse(previous).map(m=>[m[1]+'/'+m[2],m[3]]))
  const after=parse(rows), keys=new Set(after.map(m=>m[1]+'/'+m[2]))
  if(after.length!==20||keys.size!==20||before.size!==20||[...keys].some(k=>!before.has(k)))throw Error('Reviewed fingerprint table differs')
  const approved=[...review.matchAll(/^\| (mainnet|mainnet-local) \| ([^|]+?) \| [a-f0-9]{64} \| ([a-f0-9]{64}) \|$/gm)]
  const accepted=new Map(approved.map(m=>[m[1]+'/'+m[2].trim(),m[3]]))
  if(approved.length!==20||accepted.size!==20)throw Error('Review must list exactly 20 accepted fingerprint rows')
  for(const m of after)if(accepted.get(m[1]+'/'+m[2])!==m[3])throw Error('Review omits an accepted fingerprint: '+m[1]+'/'+m[2])
}

/** Both public publishing and ceremony construction enforce this same chain. */
export function validateAcceptedPins(root, commit) {
  validateIgnoredInputs(root)
  const git=args=>execFileSync('/usr/bin/git',args,{cwd:root,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}})
  const readme=fs.readFileSync(path.join(root,'web/README.md'),'utf8')
  const pin=readme.match(/^Pin review: `([^`]+)` · sha256 `([a-f0-9]{64})` · source commit `([a-f0-9]{40})`\.$/m)
  if(!pin)throw Error('Missing exact pin review source')
  git(['merge-base','--is-ancestor',pin[3],commit])
  const changed=git(['diff','--no-renames','--name-only','-z',pin[3],commit]).split('\0').filter(Boolean)
  if(changed.some(f=>f!=='web/README.md'))throw Error('Source changed after pin review')
  const {review,reviewed}=validatePinReview(root,pin[1],pin[3])
  const reviewBytes=fs.readFileSync(path.join(root,pin[1]))
  if(createHash('sha256').update(reviewBytes).digest('hex')!==pin[2])throw Error('Pin review bytes differ')
  validateReviewedHashes(readme,git(['show',reviewed+':web/README.md']),review)
  return {reviewBytes,readme}
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
