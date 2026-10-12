import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import {Keypair} from '@solana/web3.js'
const require=createRequire(import.meta.url),{build}=require('/home/ubuntu/luna-remotion/node_modules/esbuild')
const owner=Keypair.generate().publicKey,proposal=Keypair.generate().publicKey.toBase58(),asset=Keypair.generate().publicKey.toBase58(),storageKey=`cbob-pending-proposal:${owner.toBase58()}`
const input={asset,price:'21000',cap:'5',opens_at:'3000',closes_at:'4000',voting_ends_at:'2000'},values=new Map()
const el=(tag,attrs={},...children)=>({tag,attrs,children,checked:false,append(...c){this.children.push(...c);return this}})
const x={buttons:[],storageFail:false,lock:true,reads:0,signs:0,sends:0,fee:5000,change:false,pendingCalls:0,settled:[],status:null}
const plan=()=>({ixs:[{programId:owner,data:new Uint8Array([1]),keys:[{pubkey:owner,isSigner:true,isWritable:true}]}],details:{proposal,proposal_id:'1',actions:[{kind:'SetRound',price:x.change&&x.reads>1?'21001':'21000'}],voting_ends_at:'2000'},acks:[{id:'create_sale_proposal',text:'Approve this proposal.'}]})
globalThis.__proposalSigning={el,clear:n=>{n.children=[];return n},action:(label,run)=>{const b={label,run};x.buttons.push(b);return b},plan:async()=>{x.reads++;return plan()},build:async()=>({tx:{compileMessage:()=>({})},sim:{err:null},blockhash:'fixture',lastValidBlockHeight:100,minUnits:1}),sign:async()=>{x.signs++;return {signature:new Uint8Array(64).fill(7)}},send:async()=>{assert.ok(values.get(storageKey),'receipt must be persisted before broadcast');x.sends++;throw Error('connection interrupted')}}
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>{if(x.storageFail)throw Error('storage blocked');values.set(k,v)},removeItem:k=>values.delete(k)}})
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_name,_opts,cb)=>cb(x.lock?{}:null)}}})
globalThis.location={search:''}
const stub=`const x=globalThis.__proposalSigning;export const el=x.el,clear=x.clear,addr=a=>a,box=(k,...c)=>x.el('box',{k},...c),action=x.action,date=t=>t,actionDetails=a=>x.el('action',a);export const governanceActionInput=(_a,i)=>structuredClone(i),planGovernanceAction=x.plan,buildForWallet=x.build,signExact=x.sign,sendSigned=x.send,setProgramNames=()=>{};`
const outfile='/opt/cbob-vaults/web/test/.out/proposal-signing.cjs';fs.mkdirSync('web/test/.out',{recursive:true})
await build({entryPoints:['web/src/lib/external-proposal.mjs'],outfile,bundle:true,format:'cjs',platform:'node',logLevel:'silent',plugins:[{name:'signing-fixture',setup(b){b.onResolve({filter:/^\.\/(ui|governance-view|sale-proposal|tx)\.mjs$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:stub,loader:'js'}))}}]})
const {reviewExternalProposal}=require(outfile),wallet={publicKey:owner},profile={programs:{},expectedGenesisHash:'fixture'},conn={getGenesisHash:async()=>profile.expectedGenesisHash,getFeeForMessage:async()=>({value:x.fee}),getSignatureStatuses:async()=>({value:[x.status]}),getBlockHeight:async()=>100}
function reset(){values.clear();Object.assign(x,{buttons:[],storageFail:false,lock:true,reads:0,signs:0,sends:0,fee:5000,change:false,pendingCalls:0,settled:[],status:null})}
const nodes=n=>[n,...(n.children||[]).flatMap(nodes)]
async function review(){const out=el('div');await reviewExternalProposal(out,'propose',input,{conn,ids:{},profile,wallet,onPending:()=>x.pendingCalls++,onSettled:r=>x.settled.push(r)});return {out,approve:()=>nodes(out).filter(n=>n.tag==='input').forEach(n=>n.checked=true),sign:()=>x.buttons.find(b=>b.label==='Sign this proposal').run()}}
test('external proposal requires explicit consent before any wallet signature',async()=>{reset();const r=await review();await assert.rejects(r.sign(),/acknowledgment/);assert.equal(x.signs,0);assert.equal(x.sends,0)})
test('changed proposal and changed fee each stop before signing',async()=>{for(const what of ['change','fee']){reset();const r=await review();r.approve();x[what]=what==='change'?true:6000;await assert.rejects(r.sign(),what==='change'?/settings changed/:/fee changed/);assert.equal(x.signs,0)}})
test('another tab and unavailable persistent storage stop before signing',async()=>{for(const what of ['lock','storageFail']){reset();const r=await review();r.approve();x[what]=what==='lock'?false:true;await assert.rejects(r.sign());assert.equal(x.signs,0);assert.equal(x.sends,0)}})
test('interrupted confirmation saves a receipt and never re-signs',async()=>{reset();const r=await review();r.approve();await r.sign();assert.equal(x.signs,1);assert.equal(x.sends,1);assert.ok(values.has(storageKey));await r.sign();assert.equal(x.signs,1);assert.equal(x.pendingCalls,1);assert.deepEqual(x.settled,[])})
test('a new review refuses while an earlier signed proposal is unresolved',async()=>{reset();const r=await review();r.approve();await r.sign();await assert.rejects(review(),/saved proposal transaction/);assert.equal(x.signs,1)})
test('confirmed receipt clears only after a definitive status check',async()=>{reset();const r=await review();r.approve();await r.sign();x.status={confirmationStatus:'confirmed',err:null};await x.buttons.find(b=>b.label==='Check transaction').run();assert.equal(values.has(storageKey),false);assert.equal(x.settled[0].status,'complete');assert.equal(x.signs,1)})
