import test from 'node:test'
import assert from 'node:assert/strict'
import {readFetch} from '../bank/live-programs.mjs'
test('rate-limit retry preserves request and returns the successful read',async()=>{
 let n=0;const seen=[],opts={method:'POST',body:'{"minContextSlot":100}'}
 const response=await readFetch('https://example.invalid',opts,{fetchImpl:async(url,o)=>{seen.push(o.body);return ++n===1?new Response('{}',{status:429}):new Response('{"result":42}')},delay:async()=>{}})
 assert.equal(n,2);assert.deepEqual(seen,[opts.body,opts.body]);assert.equal((await response.json()).result,42)
})
test('lagging secondary keeps the minimum slot and retries only within the bound',async()=>{
 let n=0;const body='{"minContextSlot":100}'
 const response=await readFetch('https://example.invalid',{body},{fetchImpl:async(_,o)=>{assert.equal(o.body,body);n++;return new Response('{"error":{"code":-32016}}')},delay:async()=>{}})
 assert.equal(n,4);assert.equal((await response.json()).error.code,-32016)
})
test('other RPC failures are returned immediately and never hidden',async()=>{
 let n=0;const response=await readFetch('https://example.invalid',{}, {fetchImpl:async()=>{n++;return new Response('{"error":{"code":-32602}}')},delay:async()=>assert.fail('unexpected retry')})
 assert.equal(n,1);assert.equal((await response.json()).error.code,-32602)
})
