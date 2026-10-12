import test from 'node:test'
import assert from 'node:assert/strict'
import bs58 from 'bs58'
import {Keypair} from '@solana/web3.js'
import {pendingVote,resolvePendingVote} from '../src/lib/external-vote.mjs'
const wallet={publicKey:Keypair.generate().publicKey},key=`cbob-pending-vote:${wallet.publicKey.toBase58()}`
const saved={signature:bs58.encode(new Uint8Array(64).fill(7)),lastValidBlockHeight:100,proposal:Keypair.generate().publicKey.toBase58(),ballots:[{asset:Keypair.generate().publicKey.toBase58(),support:false}]}
const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}
let lockAvailable=true,requests=0,status=null,height=100
Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true})
Object.defineProperty(globalThis,'navigator',{value:{locks:{request:async(name,opts,cb)=>{assert.equal(name,`cbob-vote:${wallet.publicKey.toBase58()}`);assert.equal(opts.ifAvailable,true);return cb(lockAvailable?{}:null)}}},configurable:true})
const conn={getSignatureStatuses:async(signatures,opts)=>{requests++;assert.deepEqual(signatures,[saved.signature]);assert.equal(opts.searchTransactionHistory,true);return {value:[status]}},getBlockHeight:async commitment=>{assert.equal(commitment,'finalized');return height}}
function reset(){values.clear();values.set(key,JSON.stringify(saved));status=null;height=100;lockAvailable=true;requests=0}
test('saved receipt survives an uncertain confirmation and equal-height expiry boundary',async()=>{
 reset();assert.deepEqual(pendingVote(wallet),saved)
 assert.equal((await resolvePendingVote(conn,wallet)).status,'sending');assert.ok(values.has(key))
 status={confirmationStatus:'processed',err:null};height=101
 assert.equal((await resolvePendingVote(conn,wallet)).status,'sending');assert.ok(values.has(key))
})
test('only a confirmed or finalized result resolves a saved transaction',async()=>{
 for(const confirmationStatus of ['confirmed','finalized'])for(const err of [null,{InstructionError:[0,'Custom']}]){
  reset();status={confirmationStatus,err};const result=await resolvePendingVote(conn,wallet)
  assert.equal(result.status,err?'failed':'complete');assert.deepEqual(result.ballots,saved.ballots);assert.equal(values.has(key),false)
 }
})
test('absent signature is released only after the finalized height expires',async()=>{
 reset();height=101;assert.equal((await resolvePendingVote(conn,wallet)).status,'failed');assert.equal(values.has(key),false)
})
test('another tab holding the ballot lock prevents stale receipt deletion',async()=>{
 reset();lockAvailable=false;status={confirmationStatus:'confirmed',err:null}
 assert.equal((await resolvePendingVote(conn,wallet)).status,'sending');assert.equal(requests,0);assert.ok(values.has(key))
})
test('RPC failure and corrupted recovery data fail closed without erasing evidence',async()=>{
 reset();await assert.rejects(resolvePendingVote({...conn,getSignatureStatuses:async()=>{throw Error('offline')}},wallet));assert.ok(values.has(key))
 for(const invalid of [{...saved,signature:'wrong'},{...saved,lastValidBlockHeight:-1},{...saved,ballots:[{...saved.ballots[0],support:'yes'}]}]){
  values.set(key,JSON.stringify(invalid));assert.throws(()=>pendingVote(wallet));assert.ok(values.has(key))
 }
})
test('no saved transaction needs no RPC request',async()=>{
 reset();values.clear();assert.equal(await resolvePendingVote(conn,wallet),null);assert.equal(requests,0)
})
