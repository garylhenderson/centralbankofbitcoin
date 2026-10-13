import {createRequire} from 'node:module'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import bs58 from 'bs58'
import {Keypair,PublicKey,Transaction,SystemProgram} from '@solana/web3.js'
import {acctDisc} from '../src/lib/enc.mjs'
import {voteAddress} from '../src/lib/governance.mjs'
import {harness} from './ref.mjs'
import {PROFILES} from '../src/config.js'
import {makeIds,ata,TOKEN_PROGRAM} from '../src/lib/ids.mjs'
const require=createRequire(import.meta.url),{build}=require('/home/ubuntu/luna-remotion/node_modules/esbuild'),H=harness('trade-engine')
const key=()=>Keypair.generate().publicKey,buyer=key(),seller=key(),asset=key(),collection=key().toBase58(),profile={...PROFILES.mainnet,collection},ids=makeIds(profile),mints=Object.keys(profile.tokenNames)
let slot=789,votes=[],voteFault='',voteReadFailed=false
const proposal=key(),voteRow=()=>{const data=Buffer.concat([acctDisc('VoteRecord'),proposal.toBuffer(),asset.toBuffer(),Buffer.from([1,0])]);return {pubkey:voteAddress(ids,proposal,asset),account:{owner:ids.GOV_PROG,data}}}
let reserves=[21000n,500n,0n],tokenState=1,tokenProgram=TOKEN_PROGRAM,wrongMint=false,wrongTokenOwner=false,currentOwner=seller.toBase58(),retired=false,burned=false,active=false,pending=false,wrongRecord=false
const rows=()=>new Map(mints.map((mint,i)=>{const data=Buffer.alloc(165);new PublicKey(wrongMint?buyer:mint).toBuffer().copy(data);(wrongTokenOwner?buyer:ids.depositAddress(asset)).toBuffer().copy(data,32);data.writeBigUInt64LE(reserves[i],64);data[108]=tokenState;return [ata(ids.depositAddress(asset),mint).toBase58(),{owner:tokenProgram,data}]}))
globalThis.__tradeFixture={PROFILES:{mainnet:profile},SITE:{},account:async(_c,a)=>rows().get(new PublicKey(a).toBase58())||null,readConfigs:async()=>({mint:{}}),readVault:async()=>({info:{owner:currentOwner,collection,burned},record:{asset:wrongRecord?buyer.toBase58():asset.toBase58(),level:3,retired,active,pending}}),buildForWallet:async(_c,ixs,payer)=>{const tx=new Transaction({feePayer:payer,recentBlockhash:SystemProgram.programId.toBase58()}).add(...ixs);return {tx,sim:{err:null},blockhash:tx.recentBlockhash,lastValidBlockHeight:99,minUnits:1}},simulate:async()=>({err:null,accounts:[{lamports:999000}]})}
const stub=`const x=globalThis.__tradeFixture;export const PROFILES=x.PROFILES,SITE=x.SITE,account=x.account,readConfigs=x.readConfigs,readVault=x.readVault,buildForWallet=x.buildForWallet,simulate=x.simulate;export const PAGE_CU_PRICE=100000;export const accounts=()=>{},anchorAccount=()=>{},chainNow=()=>{},readBuySnapshot=()=>{},readRedemptionSnapshot=()=>{},signExact=()=>{};`
const outfile='/opt/cbob-vaults/web/test/.out/trade-engine.cjs';fs.mkdirSync('web/test/.out',{recursive:true})
await build({entryPoints:['web/server/club-engine.mjs'],outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent',plugins:[{name:'trade-fixture',setup(b){b.onResolve({filter:/^[^./]/},a=>['bs58','base-x'].includes(a.path)?undefined:{path:a.path,external:true});b.onResolve({filter:/\/(?:config\.js|reads\.mjs|tx\.mjs)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:stub,loader:'js'}))}}]})
const engine=require(outfile),conn={getSlot:async()=>slot,getProgramAccounts:async(program,options)=>{assert.equal(options.commitment,'confirmed');assert.equal(options.minContextSlot,789);assert.deepEqual(options.filters,[{dataSize:74},{memcmp:{offset:0,bytes:bs58.encode(acctDisc('VoteRecord'))}},{memcmp:{offset:40,bytes:asset.toBase58()}}]);if(voteReadFailed)throw Error('RPC voting unavailable');if(!program.equals(ids.GOV_PROG)||options.filters[2].memcmp.offset!==40||options.filters[2].memcmp.bytes!==asset.toBase58())throw Error('Wrong vote query');if(voteFault==='nonarray')return {};if(voteFault==='limit')return Array(513).fill(voteRow());return votes.map(r=>voteFault==='length'?{...r,account:{...r.account,data:r.account.data.subarray(0,73)}}:voteFault==='disc'?{...r,account:{...r.account,data:Buffer.concat([Buffer.alloc(8),r.account.data.subarray(8)])}}:voteFault==='support'?{...r,account:{...r.account,data:Buffer.concat([r.account.data.subarray(0,72),Buffer.from([2,0])])}}:voteFault==='program'?{...r,account:{...r.account,owner:ids.CORE}}:voteFault==='address'?{...r,pubkey:buyer}:voteFault==='asset'?{...r,account:{...r.account,data:Buffer.concat([r.account.data.subarray(0,40),buyer.toBuffer(),r.account.data.subarray(72)])}}:r)},rpcEndpoint:'http://127.0.0.1:1',getGenesisHash:async()=>profile.expectedGenesisHash,getFeeForMessage:async()=>({value:5000}),getBalance:async()=>1000000000}
const v=await engine.tradableVault(conn,asset,seller.toBase58()),input={asset:asset.toBase58(),buyer:buyer.toBase58(),seller:seller.toBase58(),price:'1000001',orderId:'fixture-order',vaultState:v.orderState}
const prepare=()=>engine.prepare(conn,buyer.toBase58(),'trade',input),rejected=async()=>{try{await prepare();return false}catch(e){return ['CBOB_ORDER_INVALID','CBOB_OWNER_MISMATCH'].includes(e.code)}}
const first=await prepare()
H.eq('review binds the recorded minimums, not observed balances',first.summary.details.state.minimum_reserves,JSON.parse(v.orderState).reserves)
H.eq('rounding preserves the exact 90/10 SOL payment',[first.summary.details.seller_lamports,first.summary.details.royalty_lamports],['900001','100000'])
reserves=[99999n,9000000n,1n];H.eq('additional deposits do not invalidate the confirmation effect',(await prepare()).effectHash,first.effectHash)
active=true;pending=true;H.eq('activation does not invalidate the confirmation effect',(await prepare()).effectHash,first.effectHash)
H.t('the original standing review remains valid after growth',engine.orderMatches(await engine.tradableVault(conn,asset),asset,input.vaultState))
reserves=[20999n,9000000n,1n];H.t('decreased cbBTC cancels the order before signing',await rejected());reserves=[21000n,500n,0n]
tokenState=2;H.t('a frozen reserve refuses settlement',await rejected());tokenState=0;H.t('an uninitialized reserve refuses settlement',await rejected());tokenState=1
tokenProgram=ids.CORE;H.t('a non-token program cannot masquerade as a reserve',await rejected());tokenProgram=TOKEN_PROGRAM
wrongMint=true;H.t('wrong reserve mint refuses',await rejected());wrongMint=false
wrongTokenOwner=true;H.t('reserve must belong to the vault deposit address',await rejected());wrongTokenOwner=false
currentOwner=buyer.toBase58();H.t('transferred vault refuses the old seller',await rejected());currentOwner=seller.toBase58()
retired=true;H.t('retired vault refuses',await rejected());retired=false
burned=true;H.t('burned vault refuses',await rejected());burned=false
wrongRecord=true;H.t('record must identify this exact asset',await rejected());wrongRecord=false
const tx=Transaction.from(Buffer.from(first.tx,'base64'))
H.eq('trade still contains exactly Core transfer and two SOL transfers',tx.instructions.map(ix=>ix.programId.toBase58()),[ids.CORE.toBase58(),SystemProgram.programId.toBase58(),SystemProgram.programId.toBase58()])
H.eq('empty voting history is disclosed explicitly',first.summary.details.vote_history,[])
H.t('trade consent warns of retained votes and landing race',first.summary.acks.some(a=>a.id==='trade_vote_history'&&a.text.includes('landing')))
votes=[voteRow()];H.t('a vote after order authorization invalidates the order',await rejected())
input.vaultState=(await engine.tradableVault(conn,asset)).orderState
H.eq('new review carries exact proposal and choice',(await prepare()).summary.details.vote_history,[{proposal:proposal.toBase58(),support:true}])
const readFails=async()=>{try{await engine.tradableVault(conn,asset);return false}catch{return true}}
for(const fault of ['program','address','asset','length','disc','support','nonarray','limit']){voteFault=fault;H.t('voting '+fault+' mismatch refuses read',await readFails())}voteFault=''
votes.push(voteRow());H.t('duplicate vote records fail closed',await readFails());votes=[]
voteReadFailed=true;H.t('failed voting read is never an empty history',await readFails())
voteReadFailed=false;slot=NaN;H.t('invalid context slot refuses the voting read',await readFails())
H.done()
