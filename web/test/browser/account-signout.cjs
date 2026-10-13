// Isolated built-page checks. Only local fixtures; no keys, provider calls or signatures.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict'),WS=require('/opt/gary-club/node_modules/ws');
(async()=>{
 const root=path.resolve(process.env.CBOB_ACCOUNT_TEST_ROOT||path.join(__dirname,'../../dist')),now=Math.floor(Date.now()/1000),{Keypair}=require('/opt/gary-club/node_modules/@solana/web3.js');
 const owner=Keypair.generate().publicKey.toBase58(),asset=Keypair.generate().publicKey.toBase58(),recipient=Keypair.generate().publicKey.toBase58();let signedIn=false,holder=false,emails=true,stale=false,signoutFails=false;const posts=[];
 const register={generated_at:now,initialization_observed:true,collection:asset,charter_claimed:0,charter_opens_at:now-864000,charter_closes_at:now-259200,sale_round:{id:1,opens_at:now-10,closes_at:now+3600,price_sats:'21001',cap:20,minted:3,minted_total:243,max_supply:2100,level_supply:2100,stopped:false},prices:{cbBTC:100000,GARY:1,GIRAFFISH:1},levels:[],bank:{},totals:{minted:1,live:1,opened:0,value_usd:21},vaults:[{asset,no:1,charter:false,level:3,owner,status:'sealed',reserves:{cbBTC:'21000',GARY:'0',GIRAFFISH:'0'},deposit:recipient,owed_sats:'0',value_usd:21}]};
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');let data;
  if(req.method==='POST'){let body='';for await(const c of req)body+=c;const b=JSON.parse(body);posts.push(u.pathname);assert.equal(req.headers['x-cbob-csrf'],'fixture');if(u.pathname==='/club/signout'){if(signoutFails){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Sign out temporarily unavailable. Try again.'}));return}signedIn=false;data={ok:true}}else if(u.pathname==='/club/email-preferences'){emails=b.offer_emails;data={offer_emails:emails}}else if(u.pathname==='/club/prepare'){assert.equal(b.action,'move');data={id:'fixture',expires_at:new Date(Date.now()+60000).toISOString(),summary:{action:'move',stage:'move',asset:b.input.asset,wallet:owner,details:{sender:owner,recipient:b.input.recipient,held:[{mint:'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',raw:'21000'}]},acks:[{id:'move_whole_vault',text:'I checked the receiving wallet.'}],network_fee_lamports:'5000'}}}else{res.writeHead(403);res.end();return}}
  else if(u.pathname==='/data/vaults.json')data={...register,generated_at:stale?now-1900:now};
  else if(u.pathname==='/data/history.json')data={hourly:[],daily:{}};
  else if(u.pathname==='/club/session')data=signedIn?{wallet:owner,csrf:'fixture',displayName:'Fixture',custody:'Gary Club holds the wallet key.',holderActionsEnabled:holder,tradingEnabled:false}:{signedIn:false};
  else if(u.pathname==='/club/wallet')data={sol_lamports:'1000000000',reserves:{cbBTC:'0'},pobs:[]};
  else if(u.pathname==='/club/market')data={orders:[],intents:[],notices:[],tradingEnabled:false};
  else if(u.pathname==='/club/email-preferences')data={offer_emails:emails};
  if(data!==undefined){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return}
  const file=path.resolve(root,'.'+u.pathname+(u.pathname.endsWith('/')?'index.html':''));if(!file.startsWith(root+'/')||!fs.existsSync(file)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const v=await(await fetch('http://127.0.0.1:9223/json/version')).json(),ws=new WS(v.webSocketDebuggerUrl);await new Promise(r=>ws.once('open',r));let seq=0,context,session;const pending=new Map(),errors=[],remote=[];
 const send=(method,params={},sid)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}))});
 ws.on('message',async raw=>{const m=JSON.parse(raw);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);return}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Fetch.requestPaused'){const r=m.params,ok=r.request.url.startsWith(origin+'/')&&(r.request.method==='GET'||['/club/signout'].some(p=>r.request.url===origin+p));if(!ok)remote.push(r.request.url);await send(ok?'Fetch.continueRequest':'Fetch.failRequest',{requestId:r.requestId,...(!ok?{errorReason:'Aborted'}:{})},m.sessionId)}});
 try{
  context=(await send('Target.createBrowserContext')).browserContextId;const target=await send('Target.createTarget',{url:'about:blank',browserContextId:context});session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;const call=(m,p)=>send(m,p,session),ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
  const check=async(name,e)=>{for(let i=0;i<100;i++){if(await ev(e)){console.log('PASS '+name);return}await new Promise(r=>setTimeout(r,30))}throw Error(name)};
  await call('Runtime.enable');await call('Page.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*'}]});await call('Emulation.setDeviceMetricsOverride',{width:375,height:1000,deviceScaleFactor:1,mobile:true});
  for(const width of [375,1440]) {
   signedIn=true;
   await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width===375});
   await call('Page.navigate',{url:origin+'/account/?width='+width});
   await check(width+'px: named Sign out control visible in top navigation','(()=>{const b=document.querySelector(".bank-nav #account-signout");if(!b)return false;const r=b.getBoundingClientRect();return b.textContent==="Sign out"&&b.getAttribute("aria-label")==="Sign out of your Bank account"&&r.height>=44&&r.width>=44&&r.top>=0&&r.bottom<innerHeight&&r.left>=0&&r.right<=innerWidth&&getComputedStyle(b).visibility==="visible"})()');
   await check('account data loaded','!!document.querySelector(".wallet-passbook .addr")&&document.querySelectorAll("#your-vaults .card").length===1');
   await check('account fits viewport','document.documentElement.scrollWidth<=innerWidth');
   if(process.env.CBOB_ACCOUNT_SCREENSHOTS){fs.mkdirSync(process.env.CBOB_ACCOUNT_SCREENSHOTS,{recursive:true});const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.CBOB_ACCOUNT_SCREENSHOTS,'signout-'+width+'.png'),Buffer.from(shot.data,'base64'))}
   signoutFails=true;await ev('document.querySelector("#account-signout").click()');
   await check('failed signout shows visible error and retains retry','document.querySelector("#signout-feedback")?.textContent.includes("Sign out temporarily unavailable")&&document.querySelector("#signout-feedback").getBoundingClientRect().top<innerHeight&&!document.querySelector("#account-signout").disabled&&!!document.querySelector(".wallet-passbook")');
   signoutFails=false;await ev('document.querySelector("#account-signout").click()');
   await check('successful signout returns to sign-in and removes private desk','document.querySelector("#account")?.textContent.includes("Sign in with Gary Club")&&!document.querySelector("#account-signout")&&!document.querySelector(".wallet-passbook")&&!document.querySelector("#your-vaults")');
   assert.equal(signedIn,false);
  }
  signedIn=true;register.vaults=[];
  await call('Page.navigate',{url:origin+'/account/?empty=1'});
  await check('empty holder still has Sign out','!!document.querySelector("#account-signout")&&document.querySelector("#your-vaults")?.textContent.includes("No live vault is recorded")');
  await ev('document.querySelector(".private-heading button:last-child").click()');
  await check('existing heading signout also returns to sign-in','document.querySelector("#account")?.textContent.includes("Sign in with Gary Club")&&!document.querySelector("#account-signout")');
  assert.deepEqual(posts,Array(5).fill('/club/signout'));assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  console.log('PASS five CSRF-bearing signout requests; no remote calls, chain writes or signatures');

 }finally{if(context)await send('Target.disposeBrowserContext',{browserContextId:context});ws.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
