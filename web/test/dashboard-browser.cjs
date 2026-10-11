// Run against local preview :8769 and isolated Chrome CDP :9223. All account
// responses are synthetic. No live account or transaction is used.
const fs=require('fs'),WS=require('ws');
(async()=>{
const page=await(await fetch('http://127.0.0.1:9223/json/new?about:blank',{method:'PUT'})).json(),ws=new WS(page.webSocketDebuggerUrl);await new Promise(r=>ws.once('open',r));let seq=0;const pending=new Map(),errors=[];
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id,method,params}))});
const now=Math.floor(Date.now()/1000),owner='B'.repeat(32),asset=n=>'A'.repeat(31)+n;
const base={prices:{cbBTC:83000,GARY:.08,GIRAFFISH:.0002},levels:[1,2,3,4,5].map(level=>({level,cap:100,minted:1,live:1})),bank:{held:{cbBTC:'2000000',GARY:'400000000000',GIRAFFISH:'1600000000'},pool_sats:'5000',owed_sats:'2468',available_sats:'2532',active:2,joining:0,bare_burns:0,released:{cbBTC:'0',GARY:'0',GIRAFFISH:'0'}}};base.generated_at=now;base.open=true;base.collection='C'.repeat(32);base.totals={minted:3,live:2,opened:1,value_usd:3200};
base.vaults=[1,2,3].map(n=>({asset:asset(n),no:n,level:n+2,status:n===3?'opened':'earning',owner,deposit:'D'.repeat(32),reserves:{cbBTC:'1000000',GARY:'200000000000',GIRAFFISH:'800000000'},value_usd:n===1?2000:1200,owed_sats:'1234',charter:true,...(n===3?{opened:{coverage:'complete',paid:{cbBTC:'1000000',GARY:'100000000000',GIRAFFISH:'200000000'},value_at_open_usd:1000,value_now_usd:1400,delta_usd:400,delta_pct:40}}:{})}));
const history={generated_at:now,hourly:[{t:now-86400,value_usd:2500},{t:now,value_usd:3200}],daily:Object.fromEntries(base.vaults.map(v=>[v.asset,[[Math.floor(now/86400)-1,1500],[Math.floor(now/86400),v.value_usd]]]))};
let fixture=true, walletUnavailable=false, indexUnavailable=false, marketUnavailable=false, slowSession=false;
ws.on('message',async s=>{const m=JSON.parse(s);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);else if(m.method==='Fetch.requestPaused'){
const p=m.params,url=new URL(p.request.url);let body;
if(fixture){if(url.pathname==='/data/vaults.json')body=base;else if(url.pathname==='/data/history.json')body=history;else if(url.pathname==='/club/session')body={wallet:owner,displayName:'Review Member',custody:'Fixture custodial wallet. Never a live account.',csrf:'fixture'};else if(url.pathname==='/club/wallet')body={sol_lamports:'1234000000',reserves:{cbBTC:'2500000','$GARY':'100000000000','$GIRAFFISH':'300000000'},pobs:[]};else if(url.pathname==='/club/market')body={enabled:false,orders:[],intents:[]};}
if(slowSession && url.pathname==='/club/session')await new Promise(r=>setTimeout(r,1400));
if(body)await send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:((walletUnavailable&&url.pathname==='/club/wallet')||(indexUnavailable&&url.pathname==='/data/vaults.json')||(marketUnavailable&&url.pathname==='/club/market'))?503:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});else await send('Fetch.continueRequest',{requestId:p.requestId});
}});
await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*/data/*'},{urlPattern:'*/club/*'}]});await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:'/tmp/cbob-design-downloads'});
const delay=()=>new Promise(r=>setTimeout(r,800)),evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value};
const check=async(label,expr)=>{for(let i=0;i<20;i++){try{if(await evaluate(expr)){console.log('PASS '+label);return}}catch{}await new Promise(r=>setTimeout(r,250))}throw Error('FAIL '+label)};
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

await send('Page.addScriptToEvaluateOnNewDocument',{source:"const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(...a){(window.__exportText ||= []).push(a[0]);return fill.apply(this,a)}"});
for(const width of [375,1440]) {
 await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===375});
 await send('Page.navigate',{url:'http://127.0.0.1:8769/account/'});await delay();
 await check('production wallet symbols and decimals','[...document.querySelectorAll(".wallet-balances>div")].find(n=>n.querySelector("span")?.textContent==="$GARY").querySelector("strong").textContent==="100"&&[...document.querySelectorAll(".wallet-balances>div")].find(n=>n.querySelector("span")?.textContent==="$GIRAFFISH").querySelector("strong").textContent==="300"');
 await check(width+' own reserve total excludes wallet and pending', 'document.querySelector(".position-value").textContent==="$3,200.00"');
 await check('payouts owed remain separate','document.querySelector(".position-metrics").innerText.includes("0.00002468 cbBTC")');
 await check('register delay and refresh are discoverable','document.querySelector(".register-lag").textContent.includes("10 minutes")&&[...document.querySelectorAll(".private-heading button")].some(n=>n.textContent==="Refresh")');
 await check('actual level collection counts','document.querySelector(".cabinet-heading h2").textContent==="2 of 5 levels."');
 await check('history is labeled current basket, not lifetime owner return','document.querySelector(".position-chart").innerText.includes("before you acquired them")');
 await evaluate('let input=document.querySelector(".position-chart input"); input.value=0;input.dispatchEvent(new Event("input"))');
 await check('history has accessible value and records','document.querySelector(".position-chart input").getAttribute("aria-valuetext").includes("UTC day")&&document.querySelectorAll(".position-chart table tr").length===2');
 await check('history scrub changes reserve observation','document.querySelector(".position-readout").textContent.includes("$3,000.00")');
 await click('.position-chart [data-days="7"]');await check('history period controls','document.querySelector(".position-chart [aria-pressed=true]").dataset.days==="7"');
 await check('bank total visible at private desk','document.querySelector(".bank-ribbon").innerText.includes("2 live vaults")');
 await check('no page overflow','document.documentElement.scrollWidth<=innerWidth');
 await check('all dashboard controls meet touch size','[...document.querySelectorAll("button,a.btn,input,select,.cabinet-slot,.bank-dock a")].every(x=>!x.getBoundingClientRect().width||x.getBoundingClientRect().height>=44)');
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(`/tmp/cbob-v3-account-${width}.png`,Buffer.from(shot.data,'base64'));
 await click('.cabinet-slot.collected');await delay();
 await check('cabinet opens only own vaults at selected level','document.querySelector("[data-tab=mine]").getAttribute("aria-pressed")==="true"&&document.querySelectorAll("#grid .card").length===1');
 await check('market personal total is visible','document.querySelector("#member-brief").innerText.includes("$3,200.00")');
 await click('#download-bank');await delay();
 await check('Bank share card captures public observed total','window.__exportText.includes("$3,200.00")&&window.__exportText.some(s=>s.startsWith("OBSERVED "))');
 await check('Bank share card excludes private identity','!window.__exportText.some(s=>s.includes("Review Member")||s.includes("BBBBBBBB"))');
 await click('#surprise-vault');await check('discovery opens a real vault','document.querySelector("#detail").open');await click('.dialog-close');await delay();
}
base.vaults[0].value_usd=null;base.prices.cbBTC=null;base.generated_at=now-3600;
await send('Page.navigate',{url:'http://127.0.0.1:8769/account/'});await delay();
await check('unknown aggregate never displays a partial dollar total','document.querySelector(".position-value").textContent==="price unavailable"');
await check('stale snapshot is visibly marked','document.querySelector(".position-freshness").textContent.startsWith("Delayed return." )');
await check('missing token quote stays unavailable','document.querySelector(".reserve-line").innerText.includes("price unavailable")');
await check('delay is visible in the hero','document.querySelector(".hero-observed.delayed").textContent.includes("Delayed return" )');
await send('Page.navigate',{url:'http://127.0.0.1:8769/market/'});await delay();
await check('delay is visible in market member summary','document.querySelector("#member-brief").innerText.includes("DELAYED RETURN")');
await click('#download-bank');await delay();await check('Bank export marks delay','window.__exportText.includes("DELAYED RETURN")');
base.generated_at=now;base.vaults[0].value_usd=2000;base.prices.cbBTC=83000;
slowSession=true;
await send('Page.navigate',{url:'http://127.0.0.1:8769/market/?a='+asset(1)});await new Promise(r=>setTimeout(r,2300));
await check('deep link awaits delayed account before showing owned actions','document.querySelector("#detail").open&&document.querySelector("#detail").innerText.includes("Open this vault")');
slowSession=false;
base.vaults.forEach(v=>{v.level=0;v.status='unrevealed'});marketUnavailable=true;
await send('Page.navigate',{url:'http://127.0.0.1:8769/account/'});await delay();
await check('undrawn collection uses the seal, not Level V','document.querySelector(".position-art img").getAttribute("src")==="/seal.png"');
await check('market read failure marks both orders and recent actions','document.querySelectorAll(".desk-columns [role=alert]").length===2');
base.vaults=[];marketUnavailable=false;
await send('Page.navigate',{url:'http://127.0.0.1:8769/account/'});await delay();
await check('empty collection chart has an honest empty state','document.querySelector(".position-chart-empty").textContent.includes("No vaults to chart yet" )');
base.generated_at=null;
await send('Page.navigate',{url:'http://127.0.0.1:8769/account/'});await delay();
await check('invalid snapshot time is unavailable, never Invalid Date','document.querySelector("#your-position [role=alert]").textContent.includes("observation time")&&!document.body.innerText.includes("Invalid Date")');
base.generated_at=now;
walletUnavailable=true;
await send('Page.navigate',{url:'http://127.0.0.1:8769/account/'});await delay();
await check('wallet failure does not hide vault position','!!document.querySelector("#wallet-balances [role=alert]")&&!!document.querySelector(".position-value")');
indexUnavailable=true;
await send('Page.navigate',{url:'http://127.0.0.1:8769/account/'});await delay();
await check('index failure replaces loading with error and retry','!!document.querySelector("#your-position [role=alert]")&&document.querySelector("#your-position").textContent.includes("Try again")');
console.log('Runtime exceptions',errors);if(errors.length)throw Error('Runtime errors');await send('Fetch.disable');ws.close();
})().catch(e=>{console.error(e.message);process.exit(1)})
