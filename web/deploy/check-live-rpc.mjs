#!/usr/bin/env node
import { PROFILES } from '../src/config.js'
const direct=process.argv.includes('--direct'),origin='https://centralbankofbitcoin.com',url=direct?'http://127.0.0.1:8789':origin+'/rpc'
async function probe(label,method,headers,body,expected,judge){
 const r=await fetch(url,{method,headers:{'User-Agent':'CBOB-release-check/1.0',...headers},body,signal:AbortSignal.timeout(30000)})
 if(r.status!==expected||r.headers.has('access-control-allow-origin'))throw new Error(`${label}: unexpected HTTP response`)
 if(judge&&!judge(await r.json()))throw new Error(`${label}: unexpected relay response`)
 console.log(`${label}: passed`)
}
const headers={'Content-Type':'application/json',Origin:origin,'Sec-Fetch-Site':'same-origin'}
const call=(method,params=[])=>JSON.stringify({jsonrpc:'2.0',id:1,method,params})
const refused=code=>d=>d.error?.code===code
await probe('mainnet genesis','POST',headers,call('getGenesisHash'),200,d=>d.result==='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
await probe('getSlot','POST',headers,call('getSlot'),200,d=>Number.isSafeInteger(d.result))
await probe('collection owner','POST',headers,call('getAccountInfo',[PROFILES.mainnet.collection,{encoding:'base64',commitment:'confirmed'}]),200,d=>d.result?.value?.owner==='CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d')
for(const method of ['GET','OPTIONS'])await probe(method+' refused',method,{},undefined,direct?405:403,direct?refused(-32600):null)
await probe('Missing Origin refused','POST',{'Content-Type':'application/json'},call('getSlot'),403,refused(-32600))
await probe('Wrong Origin refused','POST',{...headers,Origin:'https://example.invalid'},call('getSlot'),403,refused(-32600))
await probe('Cross-site refused','POST',{...headers,'Sec-Fetch-Site':'cross-site'},call('getSlot'),403,refused(-32600))
await probe('requestAirdrop refused','POST',headers,call('requestAirdrop',['11111111111111111111111111111111',1]),403,d=>d.error?.code===-32601&&d.error?.message==='method requestAirdrop is not served here')
await probe('Foreign collection refused','POST',headers,call('getAssetsByGroup',{groupKey:'collection',groupValue:'11111111111111111111111111111111'}),403,d=>d.error?.code===-32601&&d.error?.message==='getAssetsByGroup: only the vault collection')
