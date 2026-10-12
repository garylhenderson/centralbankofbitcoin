// Static build + intercepted account/data endpoints. No live mutation or signature.
const assert=require('node:assert/strict'),fs=require('node:fs'),WS=require('/opt/gary-club/node_modules/ws');
(async()=>{
 const origin=process.env.CBOB_BROWSER_ORIGIN||'http://127.0.0.1:8877',cdp=process.env.CBOB_BROWSER_CDP||'http://127.0.0.1:9223';
 const tab=await(await fetch(cdp+'/json/new?about:blank',{method:'PUT'})).json(),ws=new WS(tab.webSocketDebuggerUrl);await new Promise(r=>ws.once('open',r));
 let seq=0,session=null,quoteMismatch=false,passed=false;const pending=new Map(),exceptions=[],requests=[],results=[];
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id,method,params}))});
 const owner='11111111111111111111111111111111',asset='Vote111111111111111111111111111111111111111',proposal='Stake11111111111111111111111111111111111111';
 ws.on('message',async raw=>{const m=JSON.parse(raw);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);return}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text);if(m.method!=='Fetch.requestPaused')return;
  const r=m.params,u=new URL(r.request.url);let body={},status=200;
  if(u.pathname==='/club/session')body=session||{signedIn:false};
  else if(u.pathname==='/data/governance.json')body={initialized:false,generated_at:Date.now()/1000,charter_closes_at:1793034000,proposals:passed?[{address:proposal,id:"1",actions:[{kind:"SetRound",price:"21000",cap:25,opens_at:String(Date.now()/1000+3600),closes_at:String(Date.now()/1000+7200)}],yes:"50",no:"0",executed:false,voting_ends_at:String(Math.floor(Date.now()/1000)-60),quorum_supply:"100",quorum_bps:2100,threshold_bps:5100,index_snapshot:"100"}]:[],votes:[]};
  else if(u.pathname==='/data/vaults.json')body={vaults:[{asset,owner,status:'live',no:1,level:1}]};
  else if(u.pathname==='/club/prepare') {
   const b=JSON.parse(r.request.postData);requests.push({path:u.pathname,body:b});const d=b.input;
   body={id:'11111111-1111-4111-8111-111111111111',expires_at:new Date(Date.now()+60000).toISOString(),summary:{action:'propose',stage:'propose',asset:d.asset,wallet:owner,network_fee_lamports:'5000',acks:[{id:'create_sale_proposal',text:'I approve this proposal. Creating it does not cast any vote.'}],details:{...d,proposal,proposal_id:'1',actions:[{kind:'SetRound',opens_at:d.opens_at,closes_at:d.closes_at,price:quoteMismatch?'999999':d.price,cap:Number(d.cap)}]}}};
  }else if(u.pathname==='/club/confirm'){requests.push({path:u.pathname,body:JSON.parse(r.request.postData)});body={status:'complete',signature:'fixture-only-no-signature'}}
  else {status=404;body={error:'Fixture endpoint not found'}}
  await send('Fetch.fulfillRequest',{requestId:r.requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
 });
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value};
 const check=async(label,expression)=>{for(let i=0;i<60;i++){if(await ev(expression)){results.push(label);console.log('PASS '+label);return}await new Promise(r=>setTimeout(r,100))}throw Error(label)};
 const click=selector=>ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const go=async suffix=>{await send('Page.navigate',{url:origin+'/governance/'+suffix});await check('Governors desk hydrates '+suffix,'!!document.querySelector("#proposal-desk")');await click('#proposal-desk>summary');};
 const fill=async()=>{await ev(`(()=>{for(const [name,value] of Object.entries({asset:${JSON.stringify(asset)},price:'0.00021001',cap:'25',voting_ends_at:'2026-10-29T12:00',opens_at:'2026-10-30T12:00',closes_at:'2026-11-02T12:00'})){const el=document.querySelector('#proposal-'+name);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}})()`)};
 try {
  await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:origin+'/club/*'},{urlPattern:origin+'/data/*'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:true});
  await go('');await check('Gary Club is the default and signup stays visible','document.querySelector(".wallet-choice a[aria-current=page]").textContent.includes("Gary Club")&&document.querySelector(".proposal-identity").textContent.includes("Create an account")');
  await fill();await check('exact decimal price and treasury/deposit explanation','document.querySelector(".proposal-preview").textContent.includes("0.00021001 cbBTC each")&&document.querySelector(".proposal-preview").textContent.includes("15% to the Bank’s treasury")&&document.querySelector(".proposal-preview").textContent.includes("21,000-sat")');
  await check('375px draft has no horizontal overflow','document.documentElement.scrollWidth<=innerWidth');
  await check('all composer inputs retain 16px type and 44px targets','[...document.querySelectorAll(".proposal-field input")].every(e=>parseFloat(getComputedStyle(e).fontSize)>=16&&e.getBoundingClientRect().height>=44)');
  await click('.proposal-form button[type=submit]');await check('signed-out draft never prepares a transaction','document.querySelector(".proposal-desk-body").textContent.includes("Sign in with Gary Club before reviewing.")');assert.equal(requests.length,0);
  session={wallet:owner,csrf:'fixture',holderActionsEnabled:false};await go('');await fill();await click('.proposal-form button[type=submit]');await check('closed holder lane leaves the draft available','document.querySelector(".proposal-desk-body").textContent.includes("Holder actions are awaiting activation.")');assert.equal(requests.length,0);
  session.holderActionsEnabled=true;await go('');await fill();await click('.proposal-form button[type=submit]');await check('exact proposal review shows the chosen terms and explicit consent','document.querySelector(".action-review").textContent.includes("File Proposal 1")&&!!document.querySelector(".action-review input[type=checkbox]")');
  assert.equal(requests.at(-1).body.input.price,'21001');assert.equal(requests.at(-1).body.input.opens_at,'1793379600');
  await check('draft is frozen during a review','[...document.querySelectorAll(".proposal-form input")].every(e=>e.disabled)');
  await click('.action-review .btn');await check('no consent means no confirmation','document.querySelector(".action-review").textContent.includes("accept every acknowledgment")');assert.equal(requests.filter(r=>r.path==='/club/confirm').length,0);
  await click('.action-review input[type=checkbox]');await click('.action-review .btn');await check('explicit confirmation finishes and preserves a receipt','document.querySelector(".action-review").textContent.includes("fixture-only-no-signature")');assert.deepEqual(requests.at(-1).body.acknowledged,['create_sale_proposal']);
  quoteMismatch=true;await go('');await fill();await click('.proposal-form button[type=submit]');await check('changed server price refuses the review','document.querySelector(".proposal-desk-body").textContent.includes("does not match your draft")');
  passed=true;await go('');await ev("[...document.querySelectorAll('#records button')].find(b=>b.textContent==='Review execution').click()");await check('passed record opens its execution review at the desk',"document.querySelector('.proposal-desk-body h2').textContent.includes('passed decision')&&document.querySelector('.proposal-form').hidden");await check('execution mode fits a 375px screen','document.documentElement.scrollWidth<=innerWidth');
  await go('?wallet=external');await check('external wallet choice is explicit','document.querySelector(".wallet-choice a[aria-current=page]").textContent.includes("own wallet")&&document.querySelector(".proposal-identity").textContent.includes("Connect your wallet")');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await fill();await check('desktop composer has a side-by-side preview',"document.querySelector('.proposal-preview').getBoundingClientRect().left>document.querySelector('.proposal-fields').getBoundingClientRect().right&&document.documentElement.scrollWidth<=innerWidth");
  assert.deepEqual(exceptions,[]);
  if(process.env.CBOB_BROWSER_SCREENSHOT){const pic=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(process.env.CBOB_BROWSER_SCREENSHOT,Buffer.from(pic.data,'base64'))}
  console.log(`${results.length} proposal browser checks passed. All mutations intercepted; no live signatures or transactions.`);
 }finally{await send('Page.close');ws.close()}
})().catch(e=>{console.error(e.message);process.exit(1)});
