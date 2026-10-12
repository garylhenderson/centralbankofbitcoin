// Isolated Chrome CDP on :9223; all wallet responses are local synthetic fixtures.
const assert = require('node:assert/strict'), http = require('node:http'), path = require('node:path');
const WS = require('/opt/gary-club/node_modules/ws');
(async () => {
  const root = path.resolve(__dirname, '../..');
  const {buildToolchain}=await import('../deploy/build-dependencies.mjs'),toolchain=buildToolchain(root);
  const shim=f=>root+'/web/src/shims/'+f;
  const built = await toolchain.esbuild.build({plugins:toolchain.plugins,alias:{crypto:shim('crypto.mjs'),fs:shim('empty.mjs'),url:shim('url.mjs')},inject:[shim('globals.mjs')],define:{__CBOB_PROFILE__:'"mainnet"',__CBOB_OVERRIDES__:'{}','import.meta.url':'""'},entryPoints:[root+'/web/src/lib/club-actions.mjs'],bundle:true,write:false,platform:'browser',format:'iife',globalName:'controls',logLevel:'silent'});
  const owner='A'.repeat(32), asset='B'.repeat(32), other='C'.repeat(32);
  let holder=false, trading=false, mine=true, vaultFailure=false, cancelled=0, prepares=0, unexpected=[], legacy=false, race=false, cancelStatus='cancelled';
  let staleFailure=false, confirms=0, confirmationFailure=false, statusValue='sending', releaseConfirm;
  let quoteFault='',orderPrepares=0,releaseOrder;
  const commitment=JSON.stringify({version:2,asset,level:1,reserves:{cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij:'21000','8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk':'1000000000',Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump:'0'}});
  const orders=[{id:'own-order',asset,kind:'listing',price_lamports:'1000000000',is_mine:true,status:'active'},
    {id:'other-listing',asset,kind:'listing',price_lamports:'1000000000',is_mine:false,status:'active'},
    {id:'other-offer',asset,kind:'offer',price_lamports:'1000000000',is_mine:false,status:'active'}];
  const server=http.createServer(async(req,res)=>{
    const u=new URL(req.url,'http://localhost'); let data,code=200;
    if(u.pathname==='/bundle.js'){res.setHeader('Content-Type','application/javascript');res.end(built.outputFiles[0].text);return}
    if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>CBOB synthetic controls</title><div id="wallet"></div><div id="result"></div><button id="connect"></button><button id="check"></button><script src="/bundle.js"></script>');return}
    if(u.pathname==='/favicon.ico'){res.statusCode=204;res.end();return}
    if(u.pathname==='/club/session')data={wallet:owner,csrf:'fixture',displayName:'Fixture',...(!legacy?{holderActionsEnabled:holder,tradingEnabled:trading}:{}),actionsEnabled:true};
    else if(u.pathname==='/club/market')data={orders,enabled:true,...(!legacy?{holderActionsEnabled:holder,tradingEnabled:trading}:{})};
    else if(u.pathname==='/club/vault'){code=vaultFailure?503:200;data=vaultFailure?{error:'Fixture ownership unavailable'}:{owner:mine?owner:other}}
    else if(u.pathname==='/club/cancel'){let raw='';for await(const chunk of req)raw+=chunk;assert.equal(JSON.parse(raw).id,'own-order');cancelled++;data={status:cancelStatus}}
    else if(u.pathname==='/club/prepare'){prepares++;if(race){let raw='';for await(const chunk of req)raw+=chunk;const {action}=JSON.parse(raw);if(action==='activate')await new Promise(r=>setTimeout(r,150));data={id:action,expires_at:new Date(Date.now()+60000).toISOString(),summary:{wallet:owner,stage:action,details:{note:'Fixture '+action+' review'},network_fee_lamports:'5000',acks:[]}};if(staleFailure&&action==='activate'){code=503;data={error:'Stale preparation failed'}}}else{data={error:'Fixture stops before signing'};code=409}}
    else if(u.pathname==='/club/confirm'){confirms++;await new Promise(r=>{releaseConfirm=r});code=confirmationFailure?503:200;data=confirmationFailure?{error:'Confirmation response interrupted'}:{id:'draw',status:'sending'}}
    else if(u.pathname==='/club/status')data={id:'draw',status:statusValue};
    else if(u.pathname==='/club/order'){
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
      if(body.review_token){assert.equal(body.acknowledged,'standing_order_v1');await new Promise(r=>{releaseOrder=r});data={status:'active'}}
      else{orderPrepares++;data={kind:quoteFault==='kind'?'offer':body.kind,asset:quoteFault==='asset'?other:body.asset,price_lamports:'1000000000',seller_lamports:'900000000',royalty_lamports:quoteFault==='arithmetic'?'1':'100000000',vault_state:quoteFault==='reserve'?'legacy-hash':commitment,review_token:'fixture-order',expires_at:new Date(Date.now()+60000).toISOString()}}
    }
    else if(u.pathname==='/data/vaults.json')data={vaults:[]};
    else if(u.pathname==='/club/wallet')data={pobs:[{address:asset,edition:1}]};
    else {unexpected.push(req.url);code=404;data={error:'Unexpected fixture request'}}
    res.statusCode=code;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  let ws,send;
  try {
    const page=await(await fetch('http://127.0.0.1:9223/json/new?about:blank',{method:'PUT'})).json();
    ws=new WS(page.webSocketDebuggerUrl);await new Promise(r=>ws.once('open',r));
    let seq=0;const pending=new Map(),errors=[];
    send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id,method,params}))});
    ws.on('message',async s=>{const m=JSON.parse(s);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);else if(m.method==='Fetch.requestPaused'){const r=m.params;await send(r.request.url.startsWith(origin+'/')?'Fetch.continueRequest':'Fetch.failRequest',{requestId:r.requestId,...(!r.request.url.startsWith(origin+'/')?{errorReason:'BlockedByClient'}:{})})}});
    const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value};
    const wait=async expression=>{for(let n=0;n<100;n++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,20))}throw Error('Timed out: '+expression)};
    const buttons=()=>ev('[...document.querySelectorAll(".trade-panel button")].map(b=>b.textContent)');
    const mount=async()=>{await ev(`document.querySelector('.trade-panel')?.remove();document.body.append(controls.tradePanel({asset:${JSON.stringify(asset)}}))`);await wait('document.querySelector(".trade-panel")?.dataset.state === "ready"')};
    await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});await send('Page.navigate',{url:origin+'/'});await wait('typeof controls === "object"');
    for(const [h,t] of [[false,false],[true,false],[false,true],[true,true]]){
      holder=h;trading=t;mine=true;await mount();const labels=await buttons();
      assert.ok(labels.includes('Cancel'));assert.equal(labels.includes('Activate vault'),h);assert.equal(labels.includes('Record level draw'),h);assert.equal(labels.includes('Review listing'),t);assert.equal(labels.includes('Review this offer'),t);
      console.log(`PASS holder=${h} trading=${t}: independent controls and cancellation`);
    }
    orders[0].kind='offer';orders[0].funded=false;orders[2].funded=false;holder=true;trading=true;await mount();assert.ok((await buttons()).includes('Cancel'));assert.ok(!(await buttons()).includes('Review this offer'));assert.ok(await ev('document.querySelector(".trade-panel").textContent.includes("hidden from other holders")'));console.log('PASS unfunded offer remains cancellable without an acceptance control');orders[0].funded=null;orders[2].funded=null;await mount();assert.ok((await buttons()).includes('Cancel'));assert.ok(!(await buttons()).includes('Review this offer'));assert.ok(await ev('document.querySelector(".trade-panel").textContent.includes("Funding could not be checked")'));console.log('PASS unknown funding keeps cancellation and refuses offer acceptance');orders[0].kind='listing';delete orders[0].funded;delete orders[2].funded;
    holder=false;trading=false;await mount();await ev('[...document.querySelectorAll("button")].find(b=>b.textContent==="Cancel").click()');await wait('document.querySelectorAll(".order-row").length === 2');assert.equal(cancelled,1);console.log('PASS cancel works with both controls off');
    holder=true;trading=true;vaultFailure=true;await mount();await wait('document.body.textContent.includes("Fixture ownership unavailable")');assert.ok((await buttons()).includes('Cancel'));assert.ok(!(await buttons()).includes('Review listing'));console.log('PASS ownership outage keeps cancellation reachable');vaultFailure=false;
    mine=false;holder=false;trading=true;await mount();assert.ok((await buttons()).includes('Review purchase'));assert.ok(!(await buttons()).includes('Activate vault'));assert.ok((await buttons()).includes('Make an offer'));assert.ok(!(await buttons()).includes('Review this offer'));console.log('PASS buyer trading works while holder controls are off');
    holder=true;trading=false;mine=true;await mount();await ev('[...document.querySelectorAll("button")].find(b=>b.textContent==="Activate vault").click()');await wait('document.body.textContent.includes("Fixture stops before signing")');assert.equal(prepares,1);console.log('PASS activation reaches review with trading off');
    for(const kind of ['claim','buy','open']){
      holder=false;await ev(`document.querySelector('#result').replaceChildren();controls.mountClubAction(${JSON.stringify(kind)},{name:'mainnet',collection:'fixture'})`);await wait('document.querySelector("#result").textContent.includes("Vault actions are not open yet")');assert.equal(await ev('!!document.querySelector(".action-form")'),false);console.log('PASS '+kind+' shows holder-off state');
    }
    for(const kind of ['claim','buy','open']){
      holder=true;await ev(`document.querySelector('#result').replaceChildren();controls.mountClubAction(${JSON.stringify(kind)},{name:'mainnet',collection:'fixture'})`);await wait('!!document.querySelector(".action-form")');console.log('PASS '+kind+' renders with holder control on');
    }
    for(const shape of ['legacy','string']){legacy=shape==='legacy';holder='true';trading='1';await mount();const labels=await buttons();assert.deepEqual(labels,['Cancel']);console.log('PASS '+shape+' flags cannot enable controls')}legacy=false;
    holder=true;trading=true;mine=false;await mount();assert.ok(!(await buttons()).includes('Activate vault'));assert.ok(!(await buttons()).includes('Record level draw'));mine=true;await mount();assert.ok(!(await buttons()).includes('Review purchase'));console.log('PASS controls follow fresh ownership');
    orders[0].status='settling';holder=false;trading=false;cancelStatus='cancellation_requested';await mount();assert.ok((await buttons()).includes('Request cancellation'));await ev('[...document.querySelectorAll("button")].find(b=>b.textContent==="Request cancellation").click()');await wait('document.body.textContent.includes("Cancellation requested")');assert.equal(await ev('document.querySelectorAll(".order-row").length'),3);console.log('PASS settling cancellation shows the pending outcome');orders[0].status='active';
    holder=true;trading=false;race=true;await mount();await ev(`Promise.all([controls.reviewAction(document.querySelector('.trade-panel > div'),'activate',{asset:${JSON.stringify(asset)}}),controls.reviewAction(document.querySelector('.trade-panel > div'),'draw',{asset:${JSON.stringify(asset)}})])`);assert.equal(await ev('document.querySelector(".trade-panel").textContent.includes("Fixture draw review")'),true);assert.equal(await ev('document.querySelector(".trade-panel").textContent.includes("Fixture activate review")'),false);console.log('PASS a slow earlier review cannot overwrite the latest choice');
    staleFailure=true;await ev(`Promise.all([controls.reviewAction(document.querySelector('.trade-panel > div'),'activate',{}),controls.reviewAction(document.querySelector('.trade-panel > div'),'draw',{})])`);assert.equal(await ev('document.querySelector(".trade-panel").textContent.includes("Fixture draw review")'),true);assert.equal(await ev('document.body.textContent.includes("Stale preparation failed")'),false);console.log('PASS stale preparation failure cannot overwrite the current review');staleFailure=false;
    for(const failed of [false,true]){
      confirmationFailure=failed;statusValue='sending';releaseConfirm=null;
      await ev(`controls.reviewAction(document.querySelector('.trade-panel > div'),'draw',{})`);
      await ev('[...document.querySelectorAll(".trade-panel button")].find(b=>b.textContent==="Confirm with Gary Club").click()');
      for(let n=0;!releaseConfirm&&n<100;n++)await new Promise(r=>setTimeout(r,20));assert.ok(releaseConfirm);
      const count=prepares;
      const blocked=()=>ev(`controls.reviewAction(document.querySelector('.trade-panel > div'),'activate',{}).then(()=>false,e=>e.message.includes('current confirmation'))`);
      assert.equal(await blocked(),true);assert.equal(prepares,count);releaseConfirm();
      await wait(`document.querySelector('.trade-panel').textContent.includes(${JSON.stringify(failed?'Check this action':'Check confirmation')})`);
      assert.equal(await blocked(),true);assert.equal(prepares,count);
      statusValue='complete';await ev(`[...document.querySelectorAll('.trade-panel button')].find(b=>b.textContent===${JSON.stringify(failed?'Check this action':'Check confirmation')}).click()`);
      await wait('document.querySelector(".trade-panel").textContent.includes("Confirmed on chain.")');
      await ev(`controls.reviewAction(document.querySelector('.trade-panel > div'),'draw',{})`);assert.equal(prepares,count+1);
      console.log('PASS '+(failed?'lost response':'pending confirmation')+' preserves the action until status resolves, then unlocks');
    }
    assert.equal(confirms,2);
    holder=false;trading=true;mine=true;
    for(const fault of ['asset','kind','arithmetic']){
      quoteFault=fault;await mount();await ev('[...document.querySelectorAll(".trade-panel button")].find(b=>b.textContent==="Review listing").click()');
      await wait('document.querySelector(".trade-panel").textContent.includes("does not match this vault")');
      assert.ok(!(await buttons()).includes('Confirm listing'));console.log('PASS '+fault+' mismatch refuses the standing-order quote');
    }
    quoteFault='reserve';await mount();await ev('[...document.querySelectorAll(".trade-panel button")].find(b=>b.textContent==="Review listing").click()');await wait('document.querySelector(".trade-panel").textContent.includes("needs a new review")');assert.ok(!(await buttons()).includes('Confirm listing'));console.log('PASS malformed reserve commitment refuses standing-order consent');
    quoteFault='';await mount();await ev('[...document.querySelectorAll(".trade-panel button")].find(b=>b.textContent==="Review listing").click()');await wait('[...document.querySelectorAll(".trade-panel button")].some(b=>b.textContent==="Confirm listing")');
    const reviewText=await ev('document.querySelector(".trade-panel").textContent');assert.ok(reviewText.includes('Reserve minimums in this order')&&reviewText.includes('0.00021 cbBTC')&&reviewText.includes('1 $GARY')&&reviewText.includes('Austin time'));console.log('PASS standing-order review displays exact reserve minimums and Austin expiry');
    await ev('document.querySelector(".trade-panel input[type=checkbox]").checked=true;[...document.querySelectorAll(".trade-panel button")].find(b=>b.textContent==="Confirm listing").click()');
    for(let n=0;!releaseOrder&&n<100;n++)await new Promise(r=>setTimeout(r,20));assert.ok(releaseOrder);const priorOrders=orderPrepares;
    await ev('[...document.querySelectorAll(".trade-panel button")].find(b=>b.textContent==="Review listing").click()');await wait('document.querySelector(".trade-panel").textContent.includes("current confirmation")');assert.equal(orderPrepares,priorOrders);
    releaseOrder();await wait('document.querySelector(".trade-panel").textContent.includes("Listing recorded")');console.log('PASS order confirmation cannot be replaced while its request is in flight');
    assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);console.log('PASS no runtime errors or unexpected requests; no signatures or chain calls');
  } finally {if(send)await send('Page.close').catch(()=>{});ws?.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
