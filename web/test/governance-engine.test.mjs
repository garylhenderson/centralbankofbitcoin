import { createRequire } from 'node:module'
import fs from 'node:fs'
import { Keypair, Transaction, SystemProgram } from '@solana/web3.js'
import { harness } from './ref.mjs'
import { PROFILES } from '../src/config.js'
import { makeIds } from '../src/lib/ids.mjs'
import { acctDisc, u8, u16, u32, u64, i64 } from '../src/lib/enc.mjs'
import { proposalAddress, voteAddress } from '../src/lib/governance.mjs'
const require=createRequire(import.meta.url),{build}=require('/home/ubuntu/luna-remotion/node_modules/esbuild'),H=harness('governance-engine')
const owner=Keypair.generate(),asset=Keypair.generate().publicKey,collection=Keypair.generate().publicKey.toBase58(),profile={...PROFILES.mainnet,collection},ids=makeIds(profile),proposal=proposalAddress(ids,1),voted=voteAddress(ids,proposal,asset)
let currentOwner=owner.publicKey.toBase58(),mintIndex=1n,hasVoted=false,ends=1000,now=900,yes=0n,proposalId=1n,executed=false,brakes=false,retired=false,burned=false
const raw=()=>Buffer.concat([acctDisc('Proposal'),u64(proposalId),u32(1),...(brakes?[u8(1),u8(0),u8(0),u8(1),u8(0)]:[u8(0),i64(1100),i64(1200),u64(21000),u32(10)]),i64(ends),u64(yes),u64(0),u8(executed?1:0),u8(255),u64(10),u16(2100),u16(5100),u64(10),i64(800)])
globalThis.__govFixture={PROFILES:{mainnet:profile},SITE:{},account:async(_c,a)=>a.equals(proposal)?{owner:ids.GOV_PROG,data:raw()}:a.equals(voted)&&hasVoted?{owner:ids.GOV_PROG,data:Buffer.alloc(74)}:null,readConfigs:async()=>({mint:{}}),chainNow:async()=>now,readVault:async(_c,_ids,requested)=>({info:{owner:currentOwner,collection,burned},record:{asset:requested.toBase58(),level:1,retired,mint_index:mintIndex}}),buildForWallet:async(_c,ixs,payer)=>{const tx=new Transaction({feePayer:payer,recentBlockhash:SystemProgram.programId.toBase58()}).add(...ixs);return {tx,sim:{err:null},blockhash:tx.recentBlockhash,lastValidBlockHeight:99,minUnits:1}},simulate:async()=>({err:null,accounts:[{lamports:999000}]})}
const stub=`const x=globalThis.__govFixture;export const PROFILES=x.PROFILES;export const SITE=x.SITE;export const account=(...a)=>x.account(...a);export const accounts=()=>{};export const readConfigs=x.readConfigs;export const chainNow=x.chainNow;export const readVault=x.readVault;export const readBuySnapshot=()=>{};export const readRedemptionSnapshot=()=>{};export const buildForWallet=x.buildForWallet;export const simulate=x.simulate;export const signExact=()=>{};`
const outfile='/opt/cbob-vaults/web/test/.out/governance-engine.cjs';fs.mkdirSync('web/test/.out',{recursive:true})
await build({entryPoints:['web/server/club-engine.mjs'],outfile,bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent',plugins:[{name:'gov-fixture',setup(b){b.onResolve({filter:/\/(?:config\.js|reads\.mjs|tx\.mjs)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:stub,loader:'js'}))}}]})
const engine=require(outfile),conn={getGenesisHash:async()=>profile.expectedGenesisHash,getFeeForMessage:async()=>({value:5000}),getBalance:async()=>1000000}
const prepare=(support=true)=>engine.prepare(conn,owner.publicKey.toBase58(),'vote',{asset:asset.toBase58(),proposal:proposal.toBase58(),support})
const rejects=async message=>{try{await prepare();return false}catch(e){return e.message.includes(message)}}
const initial=await prepare();H.eq('prepared review binds choice, proposal and explicit irrevocable consent',[initial.summary.details.proposal_id,initial.summary.details.support,initial.summary.acks.map(a=>a.id)],['1',true,['one_vault_one_vote']])
yes=2n;H.eq('other holders voting does not invalidate the reviewed choice',(await prepare()).effectHash,initial.effectHash)
currentOwner=Keypair.generate().publicKey.toBase58();H.t('ownership is rechecked before preparing',await rejects('live Bank vault held'));currentOwner=owner.publicKey.toBase58()
mintIndex=10n;H.t('vault at snapshot boundary is ineligible',await rejects('issued after'));mintIndex=1n
hasVoted=true;H.t('existing vote refuses another vote even after transfer',await rejects('already voted'));hasVoted=false
now=1000;H.t('the exact closing second refuses',await rejects('closed'));now=900
executed=true;H.t('executed proposal refuses a vote',await rejects('closed'));executed=false
proposalId=2n;H.t('proposal PDA must match its decoded ID',await rejects('proposal address'));proposalId=1n
const tx=Transaction.from(Buffer.from(initial.tx,'base64'));H.eq('only GOV cast_vote is prepared',tx.instructions.map(i=>i.programId.toBase58()),[ids.GOV_PROG.toBase58()])
H.t('changing the choice changes the reviewed effect',(await prepare(false)).effectHash!==initial.effectHash)
brakes=true;const keyChange=await prepare();H.t('guardian removal requires the extra key-change acknowledgement',keyChange.summary.acks.some(a=>a.id==='bank_key_change'&&a.text.includes('removes the guardian brake')&&a.text.includes('notice period')));brakes=false
retired=true;H.t('retired vaults cannot cast votes',await rejects('live Bank vault held'));retired=false
burned=true;H.t('burned vaults cannot cast votes',await rejects('live Bank vault held'));burned=false
const batchInput={proposal:proposal.toBase58(),ballots:[{asset:asset.toBase58(),support:true},{asset:Keypair.generate().publicKey.toBase58(),support:false}]}
const batch=await engine.prepare(conn,owner.publicKey.toBase58(),'vote',batchInput)
H.eq('batch has no single asset and names every choice in consent',[batch.asset,batch.summary.details.ballots.map(({asset,support})=>({asset,support})),batch.summary.acks[0].text.includes('2 listed vault')],[null,batchInput.ballots,true])
H.eq('unchanged mixed batch has a stable confirmation hash',(await engine.prepare(conn,owner.publicKey.toBase58(),'vote',batchInput)).effectHash,batch.effectHash)
H.t('one changed batch choice changes the confirmation hash',(await engine.prepare(conn,owner.publicKey.toBase58(),'vote',{...batchInput,ballots:batchInput.ballots.map(b=>({...b,support:!b.support}))})).effectHash!==batch.effectHash)
H.done()
