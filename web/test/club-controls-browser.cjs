// Isolated Chrome CDP on :9223; all wallet responses are local synthetic fixtures.
const assert = require('node:assert/strict'), http = require('node:http'), path = require('node:path');
const WS = require('/opt/gary-club/node_modules/ws');
const { build } = require('/home/ubuntu/luna-remotion/node_modules/esbuild');
(async () => {
  const root = path.resolve(__dirname, '../..');
  const built = await build({entryPoints:[root+'/web/src/lib/club-actions.mjs'],bundle:true,write:false,platform:'browser',format:'iife',globalName:'controls',logLevel:'silent'});
  const owner='A'.repeat(32), asset='B'.repeat(32), other='C'.repeat(32);
  let holder=false, trading=false, mine=true, vaultFailure=false, cancelled=0, prepares=0, unexpected=[], legacy=false, race=false, cancelStatus='cancelled';
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
    else if(u.pathname==='/club/prepare'){prepares++;if(race){let raw='';for await(const chunk of req)raw+=chunk;const {action}=JSON.parse(raw);if(action==='activate')await new Promise(r=>setTimeout(r,150));data={id:action,expires_at:new Date(Date.now()+60000).toISOString(),summary:{wallet:owner,stage:action,details:{note:'Fixture '+action+' review'},network_fee_lamports:'5000',acks:[]}}}else{data={error:'Fixture stops before signing'};code=409}}
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
    assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);console.log('PASS no runtime errors or unexpected requests; no signatures or chain calls');
  } finally {if(send)await send('Page.close').catch(()=>{});ws?.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
