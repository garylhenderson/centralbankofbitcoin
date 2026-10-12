import test from 'node:test'
import assert from 'node:assert/strict'
import {Keypair,PublicKey,Transaction} from '@solana/web3.js'
import bs58 from 'bs58'
import {readPending,writePending,pendingVerdict} from '../web/src/lib/ceremony-pending.mjs'
import {profile,SITE} from '../web/src/config.js'
import {makeIds} from '../web/src/lib/ids.mjs'
import {coreCreateCollection} from '../web/src/lib/ix.mjs'
const p=profile('mainnet'),ids=makeIds(p),owner=new PublicKey(p.initAuthority),collection=Keypair.generate().publicKey,signature=bs58.encode(Buffer.alloc(64,1))
const record={collection:collection.toBase58(),signature,lastValidBlockHeight:100}
const conn=(status=null,height=100,account=null)=>({getSignatureStatuses:async()=>({value:[status]}),getBlockHeight:async c=>{assert.equal(c,'finalized');return height},getAccountInfo:async(k,c)=>{assert.equal(c,'finalized');return account}})
const check=c=>pendingVerdict(c,ids,p.initAuthority,record)
test('reload before wallet signature or before expiry cannot offer a fresh collection',async()=>{
  assert.equal((await check(conn())).state,'waiting')
  assert.equal((await pendingVerdict(conn(),ids,p.initAuthority,{...record,signature:null})).state,'waiting')
})
test('confirmed success waits for finalization even after validity height',async()=>assert.equal((await check(conn({confirmationStatus:'confirmed',err:null},101))).state,'waiting'))
test('unknown signature clears only after finalized expiry and account absence',async()=>{
  assert.equal((await check(conn(null,101))).state,'clear')
  assert.equal((await check(conn(null,101,{data:Buffer.alloc(0)}))).state,'waiting')
})
test('finalized failure releases the pending attempt',async()=>assert.equal((await check(conn({confirmationStatus:'finalized',err:{custom:1}}))).state,'clear'))
test('finalized success requires the exact launch-key creation receipt',async()=>{
  const c=conn({confirmationStatus:'finalized',err:null})
  c.getTransaction=async()=>({meta:{err:null},transaction:{signatures:[signature],message:new Transaction({feePayer:owner,recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(coreCreateCollection(ids,collection,ids.MINT_AUTH,owner,SITE.collectionName,SITE.collectionUri)).compileMessage()}})
  assert.deepEqual(await check(c),{state:'landed',receipt:{collection:record.collection,signature}})
  const missing=conn({confirmationStatus:'finalized',err:null});missing.getTransaction=async()=>null;await assert.rejects(check(missing),/could not be verified/)
})
test('network failures cannot authorize another collection',async()=>{const c=conn();c.getSignatureStatuses=async()=>{throw Error('network unavailable')};await assert.rejects(check(c),/network unavailable/)} )
test('pending receipt round-trips without any private key, and malformed storage refuses',()=>{
  let value=null;const storage={getItem:()=>value,setItem:(key,v)=>{value=v}}
  assert.equal(readPending(storage,'key'),null);writePending(storage,'key',record);assert.deepEqual(readPending(storage,'key'),record)
  assert.deepEqual(Object.keys(JSON.parse(value)).sort(),['collection','lastValidBlockHeight','signature'])
  value=JSON.stringify({...record,lastValidBlockHeight:'100'});assert.throws(()=>readPending(storage,'key'),/validity window/)
})
