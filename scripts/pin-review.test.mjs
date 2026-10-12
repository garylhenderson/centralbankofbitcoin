import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {validatePinReview,validateReviewedHashes,validateAcceptedPins} from './pin-review.mjs'
function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbob-pin-review-'));const git=(...args)=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();try{git('init');fs.writeFileSync(path.join(root,'source'),'original');git('add','source');git('commit','-m','base');const source=git('rev-parse','HEAD');fs.mkdirSync(path.join(root,'audits'));const rel='audits/review.md';fs.writeFileSync(path.join(root,rel),'Reviewed source commit: `'+source+'`\nPin acceptance: APPROVED for `'+source+'`\n');fn({root,git,rel,source})}finally{fs.rmSync(root,{recursive:true,force:true})}}
test('one newly committed audit binds the reviewed source',()=>fixture(({root,git,rel,source})=>{git('add',rel);git('commit','-m','review');assert.equal(validatePinReview(root,rel,git('rev-parse','HEAD')).reviewed,source)}))
test('source changes cannot hide behind a review recording',()=>fixture(({root,git,rel})=>{fs.appendFileSync(path.join(root,'source'),'changed');git('add','source',rel);git('commit','-m','bad');assert.throws(()=>validatePinReview(root,rel,git('rev-parse','HEAD')),/add only/)}))
test('a review outside audits or through traversal is refused',()=>fixture(({root,git})=>{for(const rel of ['source','audits/../source','/tmp/review.md'])assert.throws(()=>validatePinReview(root,rel,git('rev-parse','HEAD')),/audit Markdown/)}))
test('an uncommitted rewrite cannot replace recorded evidence',()=>fixture(({root,git,rel})=>{git('add',rel);git('commit','-m','review');fs.appendFileSync(path.join(root,rel),'changed');assert.throws(()=>validatePinReview(root,rel,git('rev-parse','HEAD')),/committed evidence/)}))
test('modifying an old audit cannot authorize new source',()=>fixture(({root,git,rel})=>{git('add',rel);git('commit','-m','review');const source=git('rev-parse','HEAD');fs.writeFileSync(path.join(root,rel),'Reviewed source commit: `'+source+'`\nPin acceptance: APPROVED for `'+source+'`\n');git('add',rel);git('commit','-m','reuse');assert.throws(()=>validatePinReview(root,rel,git('rev-parse','HEAD')),/add only/)}))

test('a review with a blocked verdict cannot approve pins',()=>fixture(({root,git,rel,source})=>{fs.writeFileSync(path.join(root,rel),'Reviewed source commit: `'+source+'`\nPin acceptance: BLOCKED\n');git('add',rel);git('commit','-m','blocked');assert.throws(()=>validatePinReview(root,rel,git('rev-parse','HEAD')),/explicitly approve/)}))

const pinRows=(changed=false)=>['mainnet','mainnet-local'].flatMap((profile,p)=>Array.from({length:10},(_,i)=>`| \`${profile}\` | \`${i===9?'ceremony-example':`page-${i}`}/app.js\` | \`${(changed&&i===0?'b'.repeat(64):String(p*10+i+1).padStart(64,'0'))}\` |`)).join('\n')
const reviewRows=rows=>rows.replace(/^\| `([^`]+)` \| `([^`]+)` \| `([a-f0-9]{64})` \|$/gm,(_,p,f,h)=>`| ${p} | ${f} | ${'a'.repeat(64)} | ${h} |`)
test('fresh hashes must match the exact reviewed profile and file',()=>{
  assert.doesNotThrow(()=>validateReviewedHashes(pinRows(true),pinRows(),reviewRows(pinRows(true))))
  assert.throws(()=>validateReviewedHashes(pinRows(true),pinRows(),reviewRows(pinRows())),/omits an accepted fingerprint/)
  const rows=pinRows().split('\n'),hash=rows[1].match(/[a-f0-9]{64}/)[0]
  rows[0]=rows[0].replace(/[a-f0-9]{64}/,hash)
  assert.throws(()=>validateReviewedHashes(rows.join('\n'),pinRows(),reviewRows(pinRows())),/omits an accepted fingerprint/)
  assert.throws(()=>validateReviewedHashes(pinRows(),pinRows(),''),/exactly 20/)
})
test('missing, duplicated or substituted fingerprint rows cannot be approved',()=>{
  const rows=pinRows().split('\n'),review=reviewRows(pinRows())
  assert.throws(()=>validateReviewedHashes(rows.slice(1).join('\n'),pinRows(),review),/table differs/)
  assert.throws(()=>validateReviewedHashes([rows[0],...rows.slice(0,-1)].join('\n'),pinRows(),review),/table differs/)
  assert.throws(()=>validateReviewedHashes(pinRows().replace('page-0','unreviewed'),pinRows(),review),/table differs/)
  assert.throws(()=>validateReviewedHashes(pinRows(),pinRows(),review+'\n'+review.split('\n')[0]),/exactly 20/)
})
function acceptedFixture(fn){fixture(({root,git})=>{
  fs.mkdirSync(path.join(root,'web'));fs.writeFileSync(path.join(root,'web/README.md'),pinRows())
  git('add','.');git('commit','-m','source');const source=git('rev-parse','HEAD')
  const rel='audits/accepted.md',review='Reviewed source commit: `'+source+'`\nPin acceptance: APPROVED for `'+source+'`\n'+reviewRows(pinRows(true))+'\n'
  fs.writeFileSync(path.join(root,rel),review);git('add',rel);git('commit','-m','review');const recorded=git('rev-parse','HEAD')
  const readme=pinRows(true)+'\nPin review: `'+rel+'` · sha256 `'+createHash('sha256').update(review).digest('hex')+'` · source commit `'+recorded+'`.\n'
  fs.writeFileSync(path.join(root,'web/README.md'),readme);git('add','web/README.md');git('commit','-m','pins')
  fn({root,git,readme,rel})
})}
test('accepted source chain validates exact review bytes and all rows',()=>acceptedFixture(({root,git})=>assert.equal(validateAcceptedPins(root,git('rev-parse','HEAD')).readme.includes('Pin review:'),true)))
test('manually edited pins and review bytes are refused',()=>acceptedFixture(({root,git,readme,rel})=>{
  fs.writeFileSync(path.join(root,'web/README.md'),readme.replace('b'.repeat(64),'c'.repeat(64)));git('add','web/README.md');git('commit','-m','bad pins')
  assert.throws(()=>validateAcceptedPins(root,git('rev-parse','HEAD')),/omits an accepted fingerprint/)
  fs.writeFileSync(path.join(root,'web/README.md'),readme);fs.appendFileSync(path.join(root,rel),'changed')
  assert.throws(()=>validateAcceptedPins(root,git('rev-parse','HEAD')),/committed evidence/)
}))
test('code changes after accepted pins require another review',()=>acceptedFixture(({root,git})=>{
  fs.appendFileSync(path.join(root,'source'),'changed');git('add','source');git('commit','-m','code')
  assert.throws(()=>validateAcceptedPins(root,git('rev-parse','HEAD')),/Source changed after pin review/)
}))
