import {createRequire} from 'node:module'
import fs from 'node:fs'
import {PublicKey,Transaction,SystemProgram} from '@solana/web3.js'
import {harness} from './ref.mjs'
import {makeIds,ata} from '../src/lib/ids.mjs'
import {snap,P,owner,asset,kp,tok,pda,CBBTC,mintCfg,record} from './redeem-fixtures.mjs'
const require=createRequire(import.meta.url),{build}=require('/home/ubuntu/luna-remotion/node_modules/esbuild'),H=harness('opening-engine'),ids=makeIds(P)
let snapshot, promised=[],dryRuns=0,failExtras=false,fee=5000
const reset=()=>{snapshot=snap();promised=[];dryRuns=0;failExtras=false}
reset()
globalThis.__openingFixture={PROFILES:{mainnet:P},SITE:{},readConfigs:async()=>({mint:snapshot.mintConfig}),readVault:async()=>({info:snapshot.assetInfo,record:snapshot.record}),readRedemptionSnapshot:async(_p,_c,_i,_o,_a,known)=>{promised.push(known);return {...snapshot}},buildForWallet:async(_c,ixs,payer)=>{dryRuns++;const tx=new Transaction({feePayer:payer,recentBlockhash:SystemProgram.programId.toBase58()}).add(...ixs);return {tx,sim:{err:failExtras?'fixture failed':null,explained:'fixture failure'},blockhash:tx.recentBlockhash,lastValidBlockHeight:99,minUnits:1}},simulate:async()=>({err:null,accounts:[{lamports:999000}]})}
const stub=`const x=globalThis.__openingFixture;export const PROFILES=x.PROFILES,SITE=x.SITE,readConfigs=x.readConfigs,readVault=x.readVault,readRedemptionSnapshot=x.readRedemptionSnapshot,buildForWallet=x.buildForWallet,simulate=x.simulate;export const PAGE_CU_PRICE=100000;export const accounts=()=>{},account=()=>{},anchorAccount=()=>{},chainNow=()=>{},readBuySnapshot=()=>{},signExact=()=>{};`
const outfile='/opt/cbob-vaults/web/test/.out/opening-engine.cjs';fs.mkdirSync('web/test/.out',{recursive:true})
await build({entryPoints:['web/server/club-engine.mjs'],outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent',plugins:[{name:'opening-fixture',setup(b){b.onResolve({filter:/^[^./]/},a=>['bs58','base-x'].includes(a.path)?undefined:{path:a.path,external:true});b.onResolve({filter:/\/(?:config\.js|reads\.mjs|tx\.mjs)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:stub,loader:'js'}))}}]})
const engine=require(outfile),conn={rpcEndpoint:'http://127.0.0.1:1',getGenesisHash:async()=>P.expectedGenesisHash,getFeeForMessage:async()=>({value:fee}),getBalance:async()=>1000000}
const prepare=review=>engine.prepare(conn,owner.toBase58(),'open',{asset:asset.toBase58()},null,review),confirm=q=>prepare({confirming:q})
const refuses=async(fn,pattern)=>{try{await fn();return false}catch(e){return pattern.test(e.message)}}
let q=await prepare();H.eq('plain opening is reviewed as open',q.summary.stage,'open');H.t('standing late arrival consent is required',q.summary.acks.some(a=>a.id==='late-arrivals'))
snapshot.pdaTokens[0].parsed.amount+=1n;H.eq('reserve dust preserves reviewed opening effect',(await confirm(q)).effectHash,q.effectHash)
fee=12000;snapshot.mintConfig=mintCfg({acc_scaled:10000000000000n});H.eq('newly accrued payout preserves reviewed opening effect',(await confirm(q)).effectHash,q.effectHash)
H.eq('opening review states a bounded priority-fee allowance',q.summary.max_network_fee_lamports,'145000');H.t('fee allowance requires explicit consent',q.summary.acks.some(a=>a.id==='opening_fee_budget'));H.eq('payout dry run may quote a different fee',(await confirm(q)).summary.network_fee_lamports,'12000');
snapshot.pdaTokens.push(tok(kp(81),kp(82),123));snapshot.nested.push({address:kp(83).toBase58(),name:'late NFT'});snapshot.compressed=[{address:kp(84).toBase58()}]
const late=await confirm(q);H.eq('late tokens and NFTs do not demand another signature review',late.effectHash,q.effectHash);H.t('late arrivals are informational',late.summary.details.note.some(n=>n.includes('arrived')))
H.eq('confirmation creates no new setup for late tokens',late.summary.stage,'open')
reset();snapshot.nested=[{address:kp(85).toBase58(),ourVault:true}];q=await prepare();H.eq('nested rescue is never a required setup',q.summary.stage,'open');H.t('skippable rescue is explained',q.summary.details.note.some(n=>n.includes('rescued separately')))
H.eq('nested rescue stays optional at confirmation',(await confirm(q)).effectHash,q.effectHash)
reset();const extra=kp(86),mint=kp(87);snapshot.pdaTokens.push(tok(extra,mint,99));snapshot.ownerAtaExists.add(ata(owner,mint).toBase58());q=await prepare();H.t('promised strays enter stored context',q.openingContext.known.includes(extra.toBase58()));await confirm(q);H.t('promised accounts are passed for address-based reread',promised.at(-1).includes(extra.toBase58()))
snapshot.pdaTokens=snapshot.pdaTokens.filter(t=>t.address!==extra.toBase58());H.t('missing promised account requires fresh loss consent',await refuses(()=>confirm(q),/left behind|no longer|fresh review/))
reset();snapshot.pool={state:1,amount:1000000n};fee=12000;snapshot.mintConfig=mintCfg({acc_scaled:10000000000000n});q=await prepare();snapshot.pool.state=2;H.t('newly frozen payout pool requires new forfeiture consent',await refuses(()=>confirm(q),/frozen.*payout pool/))
reset();q=await prepare();snapshot.pdaTokens[0].parsed.state=2;H.t('frozen reserve still refuses',await refuses(()=>confirm(q),/frozen/))
reset();q=await prepare();snapshot.assetInfo={...snapshot.assetInfo,owner:kp(88).toBase58()};H.t('owner transfer still refuses',await refuses(()=>confirm(q),/not held/))
reset();snapshot.ownerAtaExists=new Set();q=await prepare();H.eq('missing reserve destinations require setup',q.summary.stage,'opening_setup');H.t('setup stores opening consent and original seen set',q.openingContext.consented.includes('late-arrivals')&&q.openingContext.seen.length===3)
snapshot.pdaTokens.push(tok(kp(89),kp(90),123));H.eq('late deposit cannot expand the approved setup',(await confirm(q)).effectHash,q.effectHash)
snapshot.ownerAtaExists=new Set(snap().ownerAtaExists);const continuation=await prepare({previous:q.openingContext});H.eq('completed setup continues to opening',continuation.summary.stage,'open');H.eq('setup continuation retains original known and seen sets',[continuation.openingContext.known,continuation.openingContext.seen],[q.openingContext.known,q.openingContext.seen]);H.eq('continued opening passes consent confirmation',(await confirm(continuation)).effectHash,continuation.effectHash)
reset();q=await prepare();const legacy={...q,openingContext:null};H.t('pre-safeguard reviews refuse fresh signing',await refuses(()=>confirm(legacy),/predates/));H.t('caller cannot submit a context in named input',await refuses(()=>engine.prepare(conn,owner.toBase58(),'open',{asset:asset.toBase58(),openingContext:q.openingContext}),/Unexpected/))
H.t('a context for another wallet is refused',await refuses(()=>prepare({previous:{...q.openingContext,owner:kp(91).toBase58()}}),/saved opening review/))
reset();q=await prepare();failExtras=true;const before=dryRuns;H.t('a failed dry run never produces a signable opening',await refuses(()=>confirm(q),/dry run refused/));H.t('dry run attempts are bounded',dryRuns-before<=2)
H.done()
