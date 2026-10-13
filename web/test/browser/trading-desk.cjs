// Local static build only. All remote data and every mutation are intercepted.
const assert=require('node:assert/strict'),WS=require('/opt/gary-club/node_modules/ws');
(async()=>{
 const {PROFILES}=await import('../../src/config.js'),{makeIds}=await import('../../src/lib/ids.mjs'),revenue=makeIds(PROFILES.mainnet).REVENUE.toBase58();
 const origin=process.env.CBOB_BROWSER_ORIGIN||'http://127.0.0.1:8877',cdp='http://127.0.0.1:9223';
 const tab=await(await fetch(cdp+'/json/new?about:blank',{method:'PUT'})).json(),ws=new WS(tab.webSocketDebuggerUrl);await new Promise(r=>ws.once('open',r));
 let seq=0,enabled=true,funded=true,registerOk=true,ownerRefusal=false,wrongRevenue=false;const pending=new Map(),exceptions=[],requests=[],results=[];
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id,method,params}))});
 const owner='11111111111111111111111111111111',asset='Vote111111111111111111111111111111111111111',order='11111111-1111-4111-8111-111111111111';
 ws.on('message',async raw=>{const m=JSON.parse(raw);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);return}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text);if(m.method!=='Fetch.requestPaused')return;
  const r=m.params,u=new URL(r.request.url);let body={},status=200;
  if(u.origin===origin&&!u.pathname.startsWith('/club/')&&!u.pathname.startsWith('/data/')){await send('Fetch.continueRequest',{requestId:r.requestId});return}
  if(u.pathname==='/club/session')body={wallet:owner,csrf:'fixture',displayName:'Fixture',holderActionsEnabled:false,tradingEnabled:enabled};
  else if(u.pathname==='/club/wallet')body={sol_lamports:'1000000000',reserves:{cbBTC:'21000'},pobs:[]};
  else if(u.pathname==='/data/vaults.json'){status=registerOk?200:503;body={generated_at:Date.now()/1000,prices:{cbBTC:60000,GARY:1,GIRAFFISH:1},vaults:[{asset,owner,status:'sealed',no:1,level:1,reserves:{cbBTC:'21000',GARY:'0',GIRAFFISH:'0'},owed_sats:'0',value_usd:12.6}]}}
  else if(u.pathname==='/data/history.json')body={daily:{}};
  else if(u.pathname==='/club/market')body={tradingEnabled:enabled,orders:[{id:order,kind:'offer',asset,status:'active',price_lamports:'1000000000',funded,is_mine:false}],intents:[],notices:[{asset,reason:'invalid_vault',price_lamports:'1000000000',created_at:'2026-10-13T09:00:00Z'}]};
  else if(u.pathname==='/club/prepare'){
   requests.push({path:u.pathname,body:JSON.parse(r.request.postData)});status=ownerRefusal?403:200;
   body=ownerRefusal?{error:'Only the vault owner can accept this offer.'}:{id:order,expires_at:new Date(Date.now()+60000).toISOString(),summary:{action:'trade',stage:'trade',asset,wallet:owner,network_fee_lamports:'5000',acks:[{id:'trade',text:'I approve this sale.'}],details:{vote_history:[{proposal:asset,support:false}],seller:owner,revenue:wrongRevenue?owner:revenue,price_lamports:'1000000000',seller_lamports:'900000000',royalty_lamports:'100000000'}}};
  }else if(u.pathname==='/club/confirm'){requests.push({path:u.pathname,body:JSON.parse(r.request.postData)});body={status:'complete',signature:'fixture-not-a-transaction'}}
  else{status=404;body={error:'No external requests in this fixture'}}
  await send('Fetch.fulfillRequest',{requestId:r.requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
 });
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value};
 const check=async(label,expression)=>{for(let i=0;i<60;i++){if(await ev(expression)){results.push(label);console.log('PASS '+label);return}await new Promise(r=>setTimeout(r,100))}throw Error(label)};
 const go=async()=>{await send('Page.navigate',{url:origin+'/account/'});await check('private desk loads','document.querySelector("#account-status")?.textContent.includes("sections loaded")')};
 const review=()=>ev('[...document.querySelectorAll("#offers-received button")].find(b=>b.textContent==="Review offer").click()');
 try{
  await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:true});await go();
  await check('durable notice has reason and Austin time','document.querySelector("#order-notices").textContent.includes("reviewed terms")&&document.querySelector("#order-notices").textContent.includes("Austin time")');
  await check('received offer displays unreserved payment warning','document.querySelector("#offers-received").textContent.includes("do not reserve")&&!!document.querySelector("#offers-received button")');
  await check('mobile desk does not overflow','document.documentElement.scrollWidth<=innerWidth');assert.equal(requests.length,0);
  await review();await check('offer opens explicit sale consent','!!document.querySelector("#offers-received .ack input")');await check('trade review discloses previous vote and landing limit','document.querySelector(".trade-votes").textContent.includes("NO on")&&document.querySelector(".trade-votes").textContent.includes("before the transfer completes")');assert.deepEqual(requests.at(-1).body,{action:'accept_offer',input:{id:order}});assert.equal(requests.filter(x=>x.path==='/club/confirm').length,0);
  await ev('[...document.querySelectorAll("#offers-received button")].find(b=>b.textContent==="Confirm with Gary Club").click()');await check('unchecked consent prevents confirmation','document.querySelector("#offers-received").textContent.includes("accept every acknowledgment")');assert.equal(requests.filter(x=>x.path==='/club/confirm').length,0);
  wrongRevenue=true;await go();await review();await check('unexpected royalty destination refuses confirmation','document.querySelector("#offers-received").textContent.includes("royalty destination does not match")&&!document.querySelector("#offers-received .ack input")');wrongRevenue=false;
  ownerRefusal=true;await go();await review();await check('fresh ownership refusal remains visible','document.querySelector("#offers-received").textContent.includes("Only the vault owner")');assert.equal(requests.filter(x=>x.path==='/club/confirm').length,0);
  enabled=false;await go();await check('closed trading leaves notices readable with no offer action','document.querySelector("#offers-received").textContent.includes("not open")&&!document.querySelector("#offers-received button")&&document.querySelector("#order-notices").textContent.includes("reviewed terms")');
  enabled=true;funded=null;await go();await check('unknown funding never offers acceptance','!document.querySelector("#offers-received button")&&document.querySelector("#offers-received").textContent.includes("No funded offers")');
  registerOk=false;await go();await check('unavailable register is distinct from an empty inbox','document.querySelector("#offers-received").textContent.includes("cannot be matched")&&!document.querySelector("#offers-received button")');
  registerOk=true;funded=true;await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await go();await check('desktop desk fits','document.documentElement.scrollWidth<=innerWidth');assert.deepEqual(exceptions,[]);
  console.log(`${results.length} trading desk browser checks passed. No live mutations or signatures.`);
 }finally{await send('Page.close');ws.close()}
})().catch(e=>{console.error(e.message);process.exit(1)});
