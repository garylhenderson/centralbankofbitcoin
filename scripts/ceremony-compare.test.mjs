import test from 'node:test'
import {createHash} from 'node:crypto'
import {TOKEN_PROGRAM} from '../web/src/lib/ids.mjs'
import {STRUCTS,PROGRAM_IDS,fixedLength,offsets} from '../bank/layout.mjs'
import assert from 'node:assert/strict'
import {stableSetupAccount,programFailureCheck} from './ceremony-compare.mjs'
const account=(data,owner=TOKEN_PROGRAM.toBase58())=>({data,owner:{toBase58:()=> owner},executable:false,lamports:100})
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
  assert.deepEqual(stableSetupAccount(a,'collection',a.owner.toBase58()),stableSetupAccount(b,'collection',a.owner.toBase58()))
  b.data[1]=1;assert.notDeepEqual(stableSetupAccount(a,'collection',a.owner.toBase58()),stableSetupAccount(b,'collection',a.owner.toBase58()))
})
test('configuration bytes, owner and executable remain part of comparison',()=>{
  const a=account(Buffer.alloc(8)),b=account(Buffer.alloc(8));b.data[0]=1
  assert.notDeepEqual(stableSetupAccount(a),stableSetupAccount(b))
  assert.notDeepEqual(stableSetupAccount(a),stableSetupAccount({...a,executable:true}))
  assert.notDeepEqual(stableSetupAccount(a),stableSetupAccount({...a,owner:{toBase58:()=> 'other'}}))
})
test('missing and malformed accounts cannot become matching valid accounts',()=>{
  assert.equal(stableSetupAccount(null),null)
  for(const kind of ['mint','token','collection'])assert.throws(()=>stableSetupAccount(account(Buffer.alloc(1)),kind,TOKEN_PROGRAM.toBase58()))
})
test('provider failures classify integrity separately from network without leaking text',()=>{
  assert.match(programFailureCheck(Error('Independent providers disagree')),/agreement/)
  assert.match(programFailureCheck(Error('Bank program differs from audited build')),/audited/)
  assert.match(programFailureCheck(Error('Wrong genesis')),/identity/)
  assert.equal(programFailureCheck(Error('HTTP 429 https://secret.invalid/key')),'independent program network or configuration read')
})

test('System dust at uninitialized addresses is absent for every setup kind',()=>{
  for(const kind of ['config','token','mint','collection','MintConfig','BurnConfig','GovConfig'])
    assert.equal(stableSetupAccount(account(Buffer.alloc(0),'11111111111111111111111111111111'),kind),null)
})
test('unexpected owners keep raw bytes without typed parsing or counter masking',()=>{
  for(const kind of ['mint','token','collection','MintConfig','BurnConfig','GovConfig']) {
    const a=account(Buffer.from([1]),'unexpected'),b=account(Buffer.from([2]),'unexpected')
    assert.equal(stableSetupAccount(a,kind,'expected').data,createHash('sha256').update(a.data).digest('hex'))
    assert.notDeepEqual(stableSetupAccount(a,kind,'expected'),stableSetupAccount(b,kind,'expected'))
  }
})
for(const [kind,counter] of [['MintConfig','minted_total'],['BurnConfig','burned_total'],['GovConfig','proposal_count']]) {
  test(`${kind}: activity can advance between slots, collection and configuration cannot`,()=>{
    const data=Buffer.alloc(fixedLength(kind)),positions=offsets(kind)
    createHash('sha256').update(`account:${STRUCTS[kind].struct}`).digest().copy(data,0,0,8)
    data[8]=STRUCTS[kind].version
    const a=account(data,PROGRAM_IDS[STRUCTS[kind].program]),b=account(Buffer.from(data),a.owner.toBase58())
    b.data[positions[counter]]=1
    assert.deepEqual(stableSetupAccount(a,kind),stableSetupAccount(b,kind))
    for(const field of ['collection',...(kind==='MintConfig'?['guardian','pending_guardian','pending_swap_operator','charter_opens_at','charter_closes_at','split_bps']:[])]) {
      b.data[positions[field]]=1
      assert.notDeepEqual(stableSetupAccount(a,kind),stableSetupAccount(b,kind),field)
      b.data[positions[field]]=0
    }
    b.data[8]=255;assert.throws(()=>stableSetupAccount(b,kind),/layout version/)
  })
}
