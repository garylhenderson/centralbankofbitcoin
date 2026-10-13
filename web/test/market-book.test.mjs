import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectMarket, readRows, confirmedSaleTime, SALE_LIMIT, readOfferFunding, publishMarket } from '../../bank/market-index.mjs'
import { marketBook, marketVaults, levelFloors, exactSol, receiptLink } from '../src/lib/market-book.mjs'
import { selectVaults, sortVaults } from '../src/lib/market-view.mjs'
const now=1791900000, asset='Vote111111111111111111111111111111111111111', other='11111111111111111111111111111111', signature='2'.repeat(88)
const vault={asset,owner:'holder',no:1,level:3,status:'sealed'}, listing={id:'private-order',member_id:'private-member',wallet:'holder',asset,kind:'listing',price_lamports:'1000000001',status:'active',expires_at:new Date((now+100)*1000).toISOString()}
const receipt={id:'private-intent',asset,status:'complete',action:'buy_order',signature,price_lamports:'2000000000',payload:{secret:'never public'}}
const input={orders:[listing],receipts:[receipt],times:{[signature]:now-100},vaults:[vault],now,tradingEnabled:false,funding:{balances:new Map([['bidder',2000000000n]]),rent:890880n}}
const project=o=>projectMarket({...input,...o})
test('public projection allowlists fields and strips private identities and payloads',()=>{
 const d=project();assert.deepEqual(d.listings,[{asset,price_lamports:'1000000001',expires_at:now+100}]);assert.deepEqual(d.sales,[{asset,price_lamports:'2000000000',signature,sold_at:now-100}]);assert.doesNotMatch(JSON.stringify(d),/private-|member_id|wallet|payload|secret|holder/);assert.equal(d.trading_enabled,false)
})
test('expired, settling, retired and former-owner listings never enter the public book',()=>{
 for(const row of [{...listing,expires_at:new Date(now*1000).toISOString()},{...listing,status:'settling'},{...listing,wallet:'former'}])assert.equal(project({orders:[row]}).listings.length,0)
 assert.equal(project({vaults:[{...vault,status:'opened'}]}).listings.length,0)
})
test('standing offers count only active unexpired non-owner records, without identities',()=>{
 const d=project({orders:[{...listing,kind:'offer',wallet:'bidder'},{...listing,kind:'offer'}]});assert.deepEqual(d.offers,[{asset,expires_at:[now+100]}]);assert.equal(marketBook(d,now).offers.get(asset),1)
})
test('duplicate listings and malformed prices fail closed',()=>{
 assert.throws(()=>project({orders:[listing,listing]}));for(const p of ['-1','1e9','0','1000000000000000',5])assert.throws(()=>project({orders:[{...listing,price_lamports:p}]}))
})
test('unproven or failed sales never turn into history and incomplete history is marked',()=>{
 const d=project({times:{}});assert.equal(d.sales.length,0);assert.equal(d.sales_partial,true)
 assert.equal(project({receipts:[{...receipt,status:'failed'}]}).sales.length,0)
 assert.equal(project({salesTruncated:true}).sales_partial,true)
})
test('confirmed transaction requires exact signature, successful meta and real block time',()=>{
 const tx={meta:{err:null},transaction:{signatures:[signature]},blockTime:now-50};assert.equal(confirmedSaleTime(tx,signature,now),now-50)
 for(const x of [null,{...tx,meta:{err:'failed'}},{...tx,blockTime:null},{...tx,blockTime:now+60},{...tx,transaction:{signatures:['different']}}])assert.equal(confirmedSaleTime(x,signature,now),null)
})
test('stale snapshots hide prices and offers but retain explicitly dated sale history',()=>{
 const b=marketBook(project(),now+1801);assert.equal(b.available,true);assert.equal(b.fresh,false);assert.equal(b.enabled,false);assert.equal(b.listings.size,0);assert.equal(b.sales.length,1)
})
test('expiration is enforced in the browser even before the next public refresh',()=>{
 const b=marketBook(project({orders:[listing,{...listing,kind:'offer',wallet:'bidder'}]}),now+100);assert.equal(b.listings.size,0);assert.equal(b.offers.get(asset),0)
})
test('invalid feed, future timestamp, malformed data or duplicate signatures never show a price',()=>{
 for(const d of [null,{}, {...project(),generated_at:now+31},{...project(),listings:[{...project().listings[0],price_lamports:'0'}]},{...project(),sales:[project().sales[0],project().sales[0]]},{...project(),offers:[{asset,expires_at:[NaN]}]}])assert.equal(marketBook(d,now).available,false)
})
test('sale filtering and exact price sorting leave unlisted vaults last',()=>{
 const b=marketBook(project(),now),vs=marketVaults([vault,{...vault,asset:other,no:2}],b)
 assert.deepEqual(selectVaults(vs,{tab:'sale'}).map(v=>v.no),[1]);assert.deepEqual(sortVaults(vs.reverse(),'price').map(v=>v.no),[1,2]);assert.equal(marketVaults([{...vault,status:'opened'}],b)[0].listing,null)
})
test('per-level floors are asking prices only, with no zero price for an empty level',()=>{
 const vs=marketVaults([vault],marketBook(project(),now));assert.deepEqual(levelFloors(vs)[2],{level:3,count:1,price:'1000000001'});assert.deepEqual(levelFloors(vs)[0],{level:1,count:0,price:null})
})
test('SOL formatting preserves all nine decimal places and receipt links cannot redirect',()=>{
 assert.equal(exactSol('1000000001'),'1.000000001 SOL');assert.equal(exactSol('999999999999999'),'999,999.999999999 SOL');assert.equal(exactSol('0'),'Unavailable');assert.equal(receiptLink('javascript:alert(1)'),'/market/');assert.equal(new URL(receiptLink(signature)).hostname,'explorer.solana.com')
})
test('bounded pagination accepts server-capped pages and proves the full count',async()=>{
 const rows=Array.from({length:5},(_,i)=>({id:String(i)}));let calls=0
 const got=await readRows(async(offset)=>{calls++;const data=rows.slice(offset,offset+2);return {data,range:`${offset}-${offset+data.length-1}/5`}},{max:10});assert.deepEqual(got.rows,rows);assert.equal(calls,3)
})
test('oversized or changing books refuse, not silently truncate public floors',async()=>{
 await assert.rejects(readRows(async()=>({data:[{id:'1'}],range:'0-0/5001'}),{max:5000}))
 await assert.rejects(readRows(async(o)=>({data:[{id:String(o)}],range:`${o}-${o}/${o?3:2}`} ),{max:5,pageSize:1}))
})
test('missing ranges, gaps, repeated IDs and empty mid-pages refuse publication',async()=>{
 for(const fetch of [async()=>({data:[{id:'x'}],range:null}),async()=>({data:[{id:'x'}],range:'1-1/2'}),async(o)=>({data:[{id:'x'}],range:`${o}-${o}/2`}),async(o)=>o?({data:[],range:'*/2'}):({data:[{id:'x'}],range:'0-0/2'})])await assert.rejects(readRows(fetch,{max:5,pageSize:1}))
})
test('sale receipt truncation is explicit and empty books are valid',async()=>{
 const rows=Array.from({length:SALE_LIMIT},(_,i)=>({id:String(i)}));const r=await readRows(async()=>({data:rows,range:`0-${SALE_LIMIT-1}/999`}),{max:SALE_LIMIT,truncate:true});assert.equal(r.truncated,true);assert.equal(r.rows.length,200)
 assert.deepEqual(await readRows(async()=>({data:[],range:'*/0'}),{max:5000}),{rows:[],truncated:false})
})

test('unfunded offers are hidden and unknown funding stays unavailable rather than zero',()=>{
 const offer={...listing,kind:'offer',wallet:other}
 for(const balance of [0n,1000000000n,1000000002n])assert.equal(project({orders:[offer],funding:{balances:new Map([[other,balance]]),rent:890880n}}).offers.length,0)
 for(const balance of [1000000001n,1000890881n])assert.equal(project({orders:[offer],funding:{balances:new Map([[other,balance]]),rent:890880n}}).offers.length,1)
 const d=project({orders:[offer],funding:null});assert.equal(d.offers_available,false);assert.equal(marketBook(d,now).offersAvailable,false)
})
test('funding uses unique bidder reads and refuses incomplete or unsafe balances',async()=>{
 let reads=0;const rpc=async(method)=>{if(method==='getMinimumBalanceForRentExemption')return 890880;reads++;return {value:[{lamports:2000000000}]}}
 const f=await readOfferFunding([{wallet:other},{wallet:other}],rpc);assert.equal(reads,1);assert.equal(f.balances.get(other),2000000000n)
 for(const value of [[],[{lamports:-1}],[{lamports:9007199254740992}]])await assert.rejects(readOfferFunding([{wallet:other}],async m=>m==='getMinimumBalanceForRentExemption'?890880:{value}))
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PROFILES } from '../src/config.js'
async function publisherFixture(run) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cbob-market-test-'));fs.mkdirSync(dir+'/data');fs.writeFileSync(dir+'/data/vaults.json',JSON.stringify({generated_at:now,vaults:[vault]}))
 const state={orders:[listing],receipts:[receipt],genesis:PROFILES.mainnet.expectedGenesisHash,failRpc:false,failDb:false,calls:[],missing:new Set(),cacheFile:dir+'/times.json'}
 const env='NEXT_PUBLIC_SUPABASE_URL=https://db.gary.club\nSUPABASE_SERVICE_ROLE_KEY=fixture-secret\nHELIUS_RPC_URL=https://rpc.example.invalid\nCBOB_PORTAL_TRADING_ENABLED=0'
 const fetchImpl=async(url,options)=>{
  const u=new URL(url)
  if(u.hostname==='db.gary.club') {
   assert.equal(options.redirect,'error');assert.equal(options.headers.apikey,'fixture-secret');assert.equal(options.method,undefined)
   if(state.failDb)throw Error('simulated DB outage')
   const all=u.pathname.endsWith('gc_cbob_orders')?state.orders:state.receipts, offset=Number(u.searchParams.get('offset')),limit=Number(u.searchParams.get('limit')),rows=all.slice(offset,offset+limit)
   return {ok:true,headers:new Map([['content-range',rows.length?`${offset}-${offset+rows.length-1}/${all.length}`:`*/${all.length}`]]),json:async()=>rows}
  }
  assert.equal(u.hostname,'rpc.example.invalid');assert.equal(options.headers.Authorization,undefined)
  const req=JSON.parse(options.body);state.calls.push(req)
  if(state.failRpc)throw Error('simulated RPC outage')
  let result
  if(req.method==='getGenesisHash')result=state.genesis
  else if(req.method==='getTransaction'){
   assert.equal(req.params[1].commitment,'finalized')
   result=state.missing.has(req.params[0])?null:{meta:{err:null},transaction:{signatures:[req.params[0]]},blockTime:now-50}
  }else if(req.method==='getMinimumBalanceForRentExemption')result=890880
  else if(req.method==='getMultipleAccounts')result={value:req.params[0].map(()=>({lamports:0}))}
  else throw Error('Unexpected RPC method')
  return {ok:true,json:async()=>({result})}
 }
 const publish=opts=>publishMarket(dir,{cacheFile:state.cacheFile,env,now,fetchImpl,...opts}),read=()=>JSON.parse(fs.readFileSync(dir+'/data/market.json','utf8'))
 try{await run({state,publish,read,dir,env})}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('publisher refuses unapproved database hosts before sending any credential',async()=>publisherFixture(async({publish,env,state})=>{
 await assert.rejects(publish({env:env.replace('https://db.gary.club','https://attacker.example.invalid')}),/configuration unavailable/);assert.equal(state.calls.length,0)
}))
test('publisher bounds new receipts, prunes the cache and reuses only finalized version-two times',async()=>publisherFixture(async({publish,state,read})=>{
 state.receipts=Array.from({length:30},(_,i)=>({...receipt,id:String(i),signature:String.fromCharCode(65+i%8).repeat(86)+'123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[i]}))
 fs.writeFileSync(state.cacheFile,JSON.stringify({[state.receipts[0].signature]:now-60})) // old unversioned confirmed cache is not trusted
 await publish();assert.equal(state.calls.filter(c=>c.method==='getTransaction').length,24);assert.equal(read().sales.length,24);assert.equal(read().sales_partial,true)
 state.calls=[];await publish();assert.equal(state.calls.filter(c=>c.method==='getTransaction').length,6);assert.equal(read().sales.length,30)
 state.receipts=[state.receipts[0]];state.calls=[];await publish();assert.equal(state.calls.length,0);assert.equal(Object.keys(JSON.parse(fs.readFileSync(state.cacheFile)).times).length,1)
}))
test('RPC outage or corrupt cache cannot hide database asks and unknown offers stay unavailable',async()=>publisherFixture(async({publish,state,read})=>{
 fs.writeFileSync(state.cacheFile,'not json');state.failRpc=true;state.orders.push({...listing,id:'offer',kind:'offer',wallet:other});await publish()
 assert.equal(read().listings.length,1);assert.equal(read().sales.length,0);assert.equal(read().sales_partial,true);assert.equal(read().offers_available,false)
}))
test('wrong chain never supplies funding or transaction evidence, while database asks remain usable',async()=>publisherFixture(async({publish,state,read})=>{
 state.genesis='wrong chain';await publish();assert.deepEqual(state.calls.map(c=>c.method),['getGenesisHash']);assert.equal(read().listings.length,1);assert.equal(read().sales.length,0)
}))
test('database failures retain the previous public file unchanged',async()=>publisherFixture(async({publish,state,dir})=>{
 const file=dir+'/data/market.json';fs.writeFileSync(file,'previous return');state.failDb=true;await assert.rejects(publish());assert.equal(fs.readFileSync(file,'utf8'),'previous return')
}))
test('publisher excludes unfunded offers and emits a finalized transaction time, not quote time',async()=>publisherFixture(async({publish,state,read})=>{
 state.orders.push({...listing,id:'offer',kind:'offer',wallet:other});await publish();assert.equal(read().offers_available,true);assert.deepEqual(read().offers,[]);assert.equal(read().sales[0].sold_at,now-50)
}))
test('unresolvable receipts rotate so early failures cannot starve later history',async()=>publisherFixture(async({publish,state,read})=>{
 state.receipts=Array.from({length:26},(_,i)=>({...receipt,id:String(i),signature:'3'.repeat(86)+'123456789ABCDEFGHJKLMNPQRST'[i]}));state.missing=new Set(state.receipts.slice(0,24).map(r=>r.signature));await publish();assert.equal(read().sales.length,0)
 state.calls=[];await publish({now:now+60});const tx=state.calls.filter(c=>c.method==='getTransaction');assert.equal(tx.length,24);assert.deepEqual(tx.slice(0,2).map(c=>c.params[0]),state.receipts.slice(24).map(r=>r.signature));assert.equal(read().sales.length,2)
}))
