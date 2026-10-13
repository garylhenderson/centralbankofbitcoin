import {test} from 'node:test'
import assert from 'node:assert/strict'
import {noticeSecret,reconcileNotices} from '../deploy/reconcile-notices.mjs'
test('only the one nonempty cron credential is selected',()=>{
  assert.equal(noticeSecret('OTHER=unrelated\nCRON_SECRET="fixture"\n'),'fixture')
  for(const raw of ['','CRON_SECRET=\n','CRON_SECRET=""\n','CRON_SECRET=a\nCRON_SECRET=b\n'])assert.throws(()=>noticeSecret(raw))
})
test('existing Notice route is posted once with private header, bounded time and no redirect',async()=>{
  let calls=0
  await reconcileNotices('fixture',async(url,options)=>{
    calls++;assert.equal(url,'http://localhost:3003/api/cron/cbob-reconcile');assert.equal(options.method,'POST')
    assert.deepEqual(options.headers,{Authorization:'Bearer fixture'});assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal)
    return {ok:true,arrayBuffer:async()=>new ArrayBuffer(0)}
  })
  assert.equal(calls,1)
})
test('failed or uncertain delivery is never automatically retried',async()=>{
  for(const failure of ['http','network']) {
    let calls=0
    await assert.rejects(reconcileNotices('fixture',async()=>{calls++;if(failure==='network')throw Error('private provider context');return {ok:false}}))
    assert.equal(calls,1)
  }
})
