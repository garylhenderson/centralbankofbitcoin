import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {validatePinReview,validateReviewedHashes} from './pin-review.mjs'
function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbob-pin-review-'));const git=(...args)=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();try{git('init');fs.writeFileSync(path.join(root,'source'),'original');git('add','source');git('commit','-m','base');const source=git('rev-parse','HEAD');fs.mkdirSync(path.join(root,'audits'));const rel='audits/review.md';fs.writeFileSync(path.join(root,rel),'Reviewed source commit: `'+source+'`\nPin acceptance: APPROVED for `'+source+'`\n');fn({root,git,rel,source})}finally{fs.rmSync(root,{recursive:true,force:true})}}
test('one newly committed audit binds the reviewed source',()=>fixture(({root,git,rel,source})=>{git('add',rel);git('commit','-m','review');assert.equal(validatePinReview(root,rel,git('rev-parse','HEAD')).reviewed,source)}))
test('source changes cannot hide behind a review recording',()=>fixture(({root,git,rel})=>{fs.appendFileSync(path.join(root,'source'),'changed');git('add','source',rel);git('commit','-m','bad');assert.throws(()=>validatePinReview(root,rel,git('rev-parse','HEAD')),/add only/)}))
test('a review outside audits or through traversal is refused',()=>fixture(({root,git})=>{for(const rel of ['source','audits/../source','/tmp/review.md'])assert.throws(()=>validatePinReview(root,rel,git('rev-parse','HEAD')),/audit Markdown/)}))
test('an uncommitted rewrite cannot replace recorded evidence',()=>fixture(({root,git,rel})=>{git('add',rel);git('commit','-m','review');fs.appendFileSync(path.join(root,rel),'changed');assert.throws(()=>validatePinReview(root,rel,git('rev-parse','HEAD')),/committed evidence/)}))
test('modifying an old audit cannot authorize new source',()=>fixture(({root,git,rel})=>{git('add',rel);git('commit','-m','review');const source=git('rev-parse','HEAD');fs.writeFileSync(path.join(root,rel),'Reviewed source commit: `'+source+'`\nPin acceptance: APPROVED for `'+source+'`\n');git('add',rel);git('commit','-m','reuse');assert.throws(()=>validatePinReview(root,rel,git('rev-parse','HEAD')),/add only/)}))

test('a review with a blocked verdict cannot approve pins',()=>fixture(({root,git,rel,source})=>{fs.writeFileSync(path.join(root,rel),'Reviewed source commit: `'+source+'`\nPin acceptance: BLOCKED\n');git('add',rel);git('commit','-m','blocked');assert.throws(()=>validatePinReview(root,rel,git('rev-parse','HEAD')),/explicitly approve/)}))

const pinRows=(changed=false)=>['mainnet','mainnet-local'].flatMap(profile=>Array.from({length:10},(_,i)=>`| \`${profile}\` | \`${i===9?'ceremony-example':`page-${i}`}/app.js\` | \`${(changed&&i===0?'b':'a').repeat(64)}\` |`)).join('\n')
test('fresh changed hashes and unchanged ceremony hashes must appear in the review',()=>{
  assert.doesNotThrow(()=>validateReviewedHashes(pinRows(true),pinRows(),'a'.repeat(64)+'\n'+'b'.repeat(64)))
  assert.throws(()=>validateReviewedHashes(pinRows(true),pinRows(),'a'.repeat(64)),/omits an accepted fingerprint/)
  assert.throws(()=>validateReviewedHashes(pinRows(),pinRows(),''),/omits an accepted fingerprint/)
})
test('missing, duplicated or substituted fingerprint rows cannot be approved',()=>{
  const rows=pinRows().split('\n'),review='a'.repeat(64)
  assert.throws(()=>validateReviewedHashes(rows.slice(1).join('\n'),pinRows(),review),/table differs/)
  assert.throws(()=>validateReviewedHashes([rows[0],...rows.slice(0,-1)].join('\n'),pinRows(),review),/table differs/)
  assert.throws(()=>validateReviewedHashes(pinRows().replace('page-0','unreviewed'),pinRows(),review),/table differs/)
})
