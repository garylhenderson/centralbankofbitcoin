// Built page in an isolated browser context. Only fixture GETs; no accounts or signatures.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict'),WS=require('/opt/gary-club/node_modules/ws');
(async()=>{
 const root=path.resolve(__dirname,'../../dist'),now=Math.floor(Date.now()/1000),asset='Vote111111111111111111111111111111111111111',other='11111111111111111111111111111111';
 const {buildIndex}=await import('../../../bank/vault-index.mjs');
 const vault=(asset,no,level)=>({asset,no,level,owner:other,status:'sealed',reserves:{cbBTC:'21000',GARY:'0',GIRAFFISH:'0'},deposit:other,owed_sats:'0',value_usd:21});
 const register=buildIndex({nowSec:now,collection:asset,mintConfig:{charter_claimed:0,dist_epoch:0},vaults:[vault(asset,1,3),vault(other,2,1)],opened:{},prices:{cbBTC:100000,GARY:1,GIRAFFISH:1}});
 const fresh={version:1,generated_at:now,trading_enabled:false,listings:[{asset,price_lamports:'1500000001',expires_at:now+3600}],offers:[{asset,expires_at:[now+3600]}],sales:[{asset,price_lamports:'1000000000',signature:'2'.repeat(88),sold_at:now-100}],sales_limit:200,sales_partial:false};let book=fresh;
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');let data;
  if(u.pathname==='/data/vaults.json')data=register;
  else if(u.pathname==='/data/history.json')data={hourly:[],daily:{}};
  else if(u.pathname==='/data/market.json')data=book;
  else if(u.pathname==='/club/session')data={signedIn:false};
  if(data!==undefined){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return}
  let file=path.resolve(root,'.'+u.pathname+(u.pathname.endsWith('/')?'index.html':''));if(!file.startsWith(root+'/')){res.writeHead(403);res.end();return}
  if(!fs.existsSync(file)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.png')?'image/png':'application/octet-stream');res.end(fs.readFileSync(file));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const version=await(await fetch('http://127.0.0.1:9223/json/version')).json(),ws=new WS(version.webSocketDebuggerUrl);await new Promise(r=>ws.once('open',r));let seq=0,context,session;const pending=new Map(),errors=[],mutations=[];
 const send=(method,params={},sid)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}))});
 ws.on('message',async raw=>{const m=JSON.parse(raw);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);return}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Fetch.requestPaused'){const r=m.params,ok=r.request.method==='GET'&&r.request.url.startsWith(origin+'/');if(r.request.method!=='GET')mutations.push(r.request.url);await send(ok?'Fetch.continueRequest':'Fetch.failRequest',{requestId:r.requestId,...(!ok?{errorReason:'Aborted'}:{})},m.sessionId)}});
 try{
  context=(await send('Target.createBrowserContext')).browserContextId;const target=await send('Target.createTarget',{url:'about:blank',browserContextId:context});session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;const call=(m,p)=>send(m,p,session);
  const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
  const check=async(label,expr)=>{for(let i=0;i<80;i++){if(await ev(expr)){console.log('PASS '+label);return}await new Promise(r=>setTimeout(r,100))}throw Error(label+' '+JSON.stringify(errors))};
  await call('Page.enable');await call('Runtime.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*'}]});await call('Emulation.setDeviceMetricsOverride',{width:375,height:960,deviceScaleFactor:1,mobile:true});
  const go=async()=>{await call('Page.navigate',{url:origin+'/market/?tab=sale'});await check('market return rendered','document.querySelector("#market-board")?.textContent.includes("Observed")||document.querySelector("#market-board")?.textContent.includes("unavailable")||document.querySelector("#market-board")?.textContent.includes("delayed")')};
  await go();await check('public asks filter has one exact SOL price and separate reserves','document.querySelectorAll("#grid .card").length===1&&document.querySelector("#grid").textContent.includes("1.500000001 SOL")&&document.querySelector("#grid").textContent.includes("$21.00")');
  await check('five floors and closed trading status visible','document.querySelectorAll(".market-floor").length===5&&document.querySelector(".market-state").textContent.includes("after validation")');await check('mobile layout fits','document.documentElement.scrollWidth<=innerWidth');
  await ev('document.querySelector("#market-board").scrollIntoView()');if(process.env.CBOB_MARKET_SCREENSHOT){const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(process.env.CBOB_MARKET_SCREENSHOT,Buffer.from(shot.data,'base64'))}
  await ev('document.querySelector("#grid .card").click()');await check('vault detail shows sale receipt and standing offer without sign-in','document.querySelector("#detail").open&&document.querySelector(".vault-market-record").textContent.includes("1 standing offer")&&document.querySelector(".vault-market-record").textContent.includes("1 SOL")');
  await check('login continues to this specific vault','document.querySelector(".trade-panel a")?.textContent.includes("Sign in to trade")');await ev('document.querySelector("#detail").close()');
  book={...fresh,generated_at:now-1900,sales:[]};await go();await check('stale book hides asks and distinguishes unavailable from zero','document.querySelectorAll("#grid .card").length===0&&document.querySelector("#market-board").textContent.includes("Old asks")&&document.querySelector(".market-floor strong").textContent==="Unavailable"');
  book={};await go();await check('unreadable book keeps the reserve register usable','document.querySelector("#market-board").textContent.includes("Market data unavailable")');await ev('document.querySelector("[data-tab=all]").click()');await check('reserve cards remain visible during market outage','document.querySelectorAll("#grid .card").length===2&&!document.querySelector(".card-ask")');
  book=fresh;await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await go();await check('desktop layout fits','document.documentElement.scrollWidth<=innerWidth');await ev('document.querySelector(".market-floor:not(:disabled)").click()');await check('floor button selects for-sale level and price order','document.querySelector("[data-tab=sale]").getAttribute("aria-pressed")==="true"&&document.querySelector("#sort").value==="price"&&document.querySelectorAll("#grid .card").length===1');
  assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);console.log('PASS no runtime errors, remote calls, mutations or signatures');
 }finally{if(context)await send('Target.disposeBrowserContext',{browserContextId:context});ws.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
