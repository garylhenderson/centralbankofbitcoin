import test from 'node:test'
import assert from 'node:assert/strict'
import {stableSetupAccount,programFailureCheck} from './ceremony-compare.mjs'
const account=data=>({data,owner:{toBase58:()=> 'owner'},executable:false,lamports:100})
test('mint supply and lamports may differ, mint authority may not',()=>{
  const data=Buffer.alloc(82);data[45]=1;const a=account(data),b={...a,data:Buffer.from(data),lamports:200};b.data.writeBigUInt64LE(123n,36)
  assert.deepEqual(stableSetupAccount(a,'mint'),stableSetupAccount(b,'mint'))
  b.data[4]=1;assert.notDeepEqual(stableSetupAccount(a,'mint'),stableSetupAccount(b,'mint'))
})
test('token amount may differ, owner or frozen state may not',()=>{
  const a=account(Buffer.alloc(165)),b=account(Buffer.alloc(165));b.data.writeBigUInt64LE(123n,64)
  assert.deepEqual(stableSetupAccount(a,'token'),stableSetupAccount(b,'token'))
  b.data[32]=1;assert.notDeepEqual(stableSetupAccount(a,'token'),stableSetupAccount(b,'token'))
  b.data[32]=0;b.data[108]=2;assert.notDeepEqual(stableSetupAccount(a,'token'),stableSetupAccount(b,'token'))
})
test('collection counts may differ, metadata and authority may not',()=>{
  const a=account(Buffer.alloc(49));a.data[0]=5;const b=account(Buffer.from(a.data));b.data.writeUInt32LE(1,41);b.data.writeUInt32LE(1,45)
  assert.deepEqual(stableSetupAccount(a,'collection'),stableSetupAccount(b,'collection'))
  b.data[1]=1;assert.notDeepEqual(stableSetupAccount(a,'collection'),stableSetupAccount(b,'collection'))
})
test('configuration bytes, owner and executable remain part of comparison',()=>{
  const a=account(Buffer.alloc(8)),b=account(Buffer.alloc(8));b.data[0]=1
  assert.notDeepEqual(stableSetupAccount(a),stableSetupAccount(b))
  assert.notDeepEqual(stableSetupAccount(a),stableSetupAccount({...a,executable:true}))
  assert.notDeepEqual(stableSetupAccount(a),stableSetupAccount({...a,owner:{toBase58:()=> 'other'}}))
})
test('missing and malformed accounts cannot become matching valid accounts',()=>{
  assert.equal(stableSetupAccount(null),null)
  for(const kind of ['mint','token','collection'])assert.throws(()=>stableSetupAccount(account(Buffer.alloc(1)),kind))
})
test('provider failures classify integrity separately from network without leaking text',()=>{
  assert.match(programFailureCheck(Error('Independent providers disagree')),/agreement/)
  assert.match(programFailureCheck(Error('Bank program differs from audited build')),/audited/)
  assert.match(programFailureCheck(Error('Wrong genesis')),/identity/)
  assert.equal(programFailureCheck(Error('HTTP 429 https://secret.invalid/key')),'independent program network or configuration read')
})
