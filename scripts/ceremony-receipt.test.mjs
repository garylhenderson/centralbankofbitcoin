import test from 'node:test'
import assert from 'node:assert/strict'
import {Keypair,Transaction,SystemProgram,PublicKey} from '@solana/web3.js'
import bs58 from 'bs58'
import {collectionFromReceipt,resolveCollection} from '../web/src/lib/ceremony-reads.mjs'
import {profile,SITE} from '../web/src/config.js'
import {makeIds} from '../web/src/lib/ids.mjs'
import {coreCreateCollection} from '../web/src/lib/ix.mjs'
const p=profile('mainnet'),base=makeIds(p),owner=new PublicKey(p.initAuthority),collection=Keypair.generate().publicKey,signature=bs58.encode(Buffer.alloc(64,1))
const tx=(payer=owner,asset=collection)=>({meta:{err:null},transaction:{signatures:[signature],message:new Transaction({feePayer:payer,recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(coreCreateCollection(base,asset,base.MINT_AUTH,payer,SITE.collectionName,SITE.collectionUri)).compileMessage()}})
const connection=value=>({getAccountInfo:async()=>null,getSignaturesForAddress:async()=>{throw Error('History must not be read')},getTransaction:async(sig,options)=>{assert.equal(sig,signature);assert.equal(options.commitment,'finalized');return value}})
const check=value=>collectionFromReceipt(connection(value),base,collection.toBase58(),p.initAuthority,signature)
test('exact finalized receipt recovers without reading padded history',async()=>assert.equal((await check(tx())).by,'launch'))
for(const [name,value] of [['unserved',null],['missing metadata',{...tx(),meta:null}],['failed',{...tx(),meta:{err:{InstructionError:[0,'Custom']}}}],['wrong signature',{...tx(),transaction:{...tx().transaction,signatures:[bs58.encode(Buffer.alloc(64,2))]}}],['other collection',tx(owner,Keypair.generate().publicKey)]])test(name+' cannot establish a collection',async()=>assert.equal((await check(value)).by,'unverifiable'))
test('another fee payer cannot establish the launch collection',async()=>assert.equal((await check(tx(Keypair.generate().publicKey))).by,'other'))
test('malformed receipt refuses before any network request',async()=>await assert.rejects(collectionFromReceipt({},base,collection.toBase58(),p.initAuthority,'bad'),/complete step-0/))
test('receipt replaces an unverified matching browser hint',async()=>{const r=await resolveCollection(connection(tx()),{...p,collection:null},base,{remembered:collection.toBase58(),receipt:{collection:collection.toBase58(),signature}});assert.equal(r.collection,collection.toBase58());assert.equal(r.conflict,null)})
test('receipt cannot override a different committed collection',async()=>{const r=await resolveCollection(connection(tx()),{...p,collection:Keypair.generate().publicKey.toBase58()},base,{receipt:{collection:collection.toBase58(),signature}});assert.match(r.conflict,/named differently/)})
test('invalid receipt refuses rather than offering another collection',async()=>{const r=await resolveCollection(connection(null),{...p,collection:null},base,{receipt:{collection:collection.toBase58(),signature}});assert.match(r.conflict,/receipt refused/);assert.equal(r.collection,null)})
test('only finalized launch receipts are cached, scoped to connection and identity',async()=>{
  let calls=0,finalized=false
  const c={getTransaction:async()=>{calls++;return finalized?tx():null}}
  const read=(key=collection)=>collectionFromReceipt(c,base,key.toBase58(),p.initAuthority,signature)
  assert.equal((await read()).by,'unverifiable');finalized=true
  assert.equal((await read()).by,'launch');assert.equal((await read()).by,'launch');assert.equal(calls,2)
  assert.equal((await read(Keypair.generate().publicKey)).by,'unverifiable');assert.equal(calls,3)
  assert.equal((await collectionFromReceipt(connection(null),base,collection.toBase58(),p.initAuthority,signature)).by,'unverifiable')
})
