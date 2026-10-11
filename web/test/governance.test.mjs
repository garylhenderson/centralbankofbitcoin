import { Keypair } from '@solana/web3.js'
import fs from 'node:fs'
import { harness, scopeFor, extractConst, ts2js, evalWith, SUITE } from './ref.mjs'
import { makeIds } from '../src/lib/ids.mjs'
import { PROFILES } from '../src/config.js'
import { Buffer, acctDisc, u8, u16, u32, u64, i64 } from '../src/lib/enc.mjs'
import { readProposal, readVote, tally, proposalAddress, voteAddress, castVoteIx } from '../src/lib/governance.mjs'
import { governanceIndex } from '../../bank/governance-index.mjs'
import { encode, STRUCTS } from '../../bank/layout.mjs'
import { judgeInput } from '../server/club-engine.mjs'
const H=harness('governance'), fails=f=>{try{f();return false}catch{return true}}, owner=Keypair.generate(), asset=Keypair.generate().publicKey, ids=makeIds({...PROFILES.mainnet,collection:Keypair.generate().publicKey.toBase58()}), prop=proposalAddress(ids,1)
const actions=[Buffer.concat([u8(0),i64(100),i64(200),u64(21000),u32(25)]),Buffer.concat([u8(1),u8(1),u8(0),u8(1),u8(1),owner.publicKey.toBuffer()]),Buffer.concat([u8(2),u8(1),u64(500),u8(0),u8(1),i64(60)]),Buffer.concat([u8(3),owner.publicKey.toBuffer()]),Buffer.concat([u8(4),u64(9007199254740993n),u8(3),u16(12)])]
const raw=Buffer.concat([acctDisc('Proposal'),u64(1),u32(5),...actions,i64(1000),u64(12),u64(8),u8(0),u8(254),u64(100),u16(2100),u16(5100),u64(101),i64(100)])
const p=readProposal(raw)
H.eq('proposal field order and all five action variants decode',p,{id:'1',actions:[{kind:'SetRound',opens_at:'100',closes_at:'200',price:'21000',cap:25},{kind:'Brakes',restart_sales:true,restart_sweep:false,set_guardian:true,guardian:owner.publicKey.toBase58()},{kind:'TightenSweep',sol_reserve_lamports:'500',max_sweep_lamports:null,sweep_cooldown_secs:'60'},{kind:'ArmSwapOperator',operator:owner.publicKey.toBase58()},{kind:'SetBoostTerms',price:'9007199254740993',weight:3,epochs:12}],voting_ends_at:'1000',yes:'12',no:'8',executed:false,bump:254,quorum_supply:'100',quorum_bps:2100,threshold_bps:5100,index_snapshot:'101',created_at:'100'})
H.t('all truncated proposal lengths refuse',Array.from({length:raw.length},(_,i)=>i).every(i=>fails(()=>readProposal(raw.subarray(0,i)))))
const wrong=Buffer.from(raw);wrong[0]^=1;H.t('wrong discriminator refuses',fails(()=>readProposal(wrong)))
const unknown=Buffer.from(raw);unknown[20]=99;H.t('unknown action refuses',fails(()=>readProposal(unknown)))
const badCount=Buffer.from(raw);badCount.writeUInt32LE(6,16);H.t('oversized action vector refuses',fails(()=>readProposal(badCount)))
const vote=Buffer.concat([acctDisc('VoteRecord'),prop.toBuffer(),asset.toBuffer(),u8(1),u8(255)])
H.eq('vote records bind the proposal and vault, not a wallet',readVote(vote),{proposal:prop.toBase58(),asset:asset.toBase58(),support:true,bump:255})
const badVote=Buffer.from(vote);badVote[72]=2;H.t('invalid ballot boolean refuses',fails(()=>readVote(badVote)))
const q={...p,actions:[p.actions[0]],yes:'11',no:'10'}
H.eq('voting stays open until the deadline',tally(q,999).status,'Voting open')
H.eq('minimum turnout, majority, and affirmative floor pass',tally(q,1000).status,'Ready to execute')
H.eq('zero turnout never passes',tally({...q,yes:'0',no:'0',quorum_supply:'0'},1000).status,'Did not pass')
H.eq('quorum rounds up',tally({...q,quorum_supply:'101'},1000).quorum,'22')
H.eq('minority cannot pass',tally({...q,yes:'10',no:'11'},1000).status,'Did not pass')
H.eq('ten percent affirmative floor holds despite small configured quorum',tally({...q,quorum_bps:500,yes:'9',no:'0'},1000).status,'Did not pass')
H.eq('key change needs half the snapshot',tally({...q,actions:[p.actions[3]],yes:'49',no:'0'},1000).status,'Did not pass')
H.eq('key change passes at exactly half',tally({...q,actions:[p.actions[3]],yes:'50',no:'0'},1000).status,'Ready to execute')
H.eq('execution window includes its last second',tally(q,605800).status,'Ready to execute')
H.eq('unexecuted passed proposal expires after seven days',tally(q,605801).status,'Expired unexecuted')
H.eq('executed record survives expiry',tally({...q,executed:true},605801).status,'Executed')
const scope=scopeFor(ids,{deployer:owner,vrec:a=>ids.vaultRecord(a),voteRec:(p,a)=>voteAddress(ids,p,a)})
const ref=evalWith(ts2js(extractConst(SUITE,'ixVote')),scope,'ixVote')
const shape=x=>({program:x.programId.toBase58(),data:x.data.toString('hex'),keys:x.keys.map(k=>[k.pubkey.toBase58(),k.isSigner,k.isWritable])})
for(const support of [false,true])H.eq(`vote instruction equals the actual on-chain suite builder (${support})`,shape(castVoteIx(ids,prop,asset,owner.publicKey,support)),shape(ref(prop,{asset},owner,support)))
H.t('nonboolean support refuses at both entry points',fails(()=>castVoteIx(ids,prop,asset,owner.publicKey,'yes'))&&fails(()=>judgeInput('vote',{asset:asset.toBase58(),proposal:prop.toBase58(),support:1})))
H.t('vote does not accept a destination or serialized transaction',fails(()=>judgeInput('vote',{asset:asset.toBase58(),proposal:prop.toBase58(),support:true,tx:'x'})))
H.t('proposal address is validated',fails(()=>judgeInput('vote',{asset:asset.toBase58(),proposal:'wrong',support:true})))
H.eq('preinitialization register is explicit and holds no invented votes',(await governanceIndex(null)).initialized,false)
const rust=fs.readFileSync('programs/cbob-vault-gov/src/lib.rs','utf8')
H.eq('proposal layout is pinned to deployed Rust source', [...rust.match(/pub struct Proposal \{([\s\S]*?)\n\}/)[1].matchAll(/pub (\w+): ([^,\n]+)/g)].map(x=>[x[1],x[2]]),[['id','u64'],['actions','Vec<ProposalAction>'],['voting_ends_at','i64'],['yes','u64'],['no','u64'],['executed','bool'],['bump','u8'],['quorum_supply','u64'],['quorum_bps','u16'],['threshold_bps','u16'],['index_snapshot','u64'],['created_at','i64']])
H.eq('zero supply cannot pass even with a malformed positive tally',tally({...q,quorum_supply:'0',yes:'1',no:'0'},1000).status,'Did not pass')
H.eq('odd key-change snapshot rounds up',tally({...q,actions:[p.actions[3]],quorum_supply:'101',yes:'50',no:'0'},1000).requiredYes,'51')
H.eq('one live vault requires one affirmative vote',tally({...q,quorum_supply:'1',yes:'1',no:'0'},1000).status,'Ready to execute')
const base=name=>Object.fromEntries(STRUCTS[name].fields.map(([k,t])=>[k,k==='version'?STRUCTS[name].version:t==='Pubkey'?ids.COLL.toBase58():t==='bool'?false:t.startsWith('Vec')?[]:t==='[u8; 32]'?'00'.repeat(32):t==='[u32; 5]'?Array(5).fill(0):t==='[u32; BOOST_RING]'?Array(64).fill(0):0]))
let count=1n,rows=[],wrongOwner=false
const cfg=()=>[{owner:ids.GOV_PROG,data:encode('GovConfig',{...base('GovConfig'),proposal_count:count})},{owner:ids.MINT_PROG,data:encode('MintConfig',{...base('MintConfig'),governance:ids.GOV_PDA.toBase58()})}]
const accounts=[{pubkey:prop,account:{owner:ids.GOV_PROG,data:raw}},...Array.from({length:20},(_,i)=>{const a=Keypair.generate().publicKey;return {pubkey:voteAddress(ids,prop,a),account:{owner:ids.GOV_PROG,data:Buffer.concat([acctDisc('VoteRecord'),prop.toBuffer(),a.toBuffer(),u8(i<12?1:0),u8(255)])}}})]
const conn={getGenesisHash:async()=>PROFILES.mainnet.expectedGenesisHash,getMultipleAccountsInfo:async()=>{const c=cfg();if(wrongOwner)c[0].owner=ids.MINT_PROG;return c},getProgramAccounts:async()=>rows},profile={...PROFILES.mainnet,collection:ids.COLL.toBase58()}
const rejects=async()=>{try{await governanceIndex(conn,profile);return false}catch{return true}}
rows=accounts;const indexed=await governanceIndex(conn,profile)
H.eq('initialized register publishes verified proposals and ballots',[indexed.initialized,indexed.proposals.length,indexed.votes.length],[true,1,20])
count=2n;H.t('missing proposal count refuses a partial return',await rejects());count=1n
rows=accounts.slice(0,-1);H.t('tally mismatch refuses partial ballots',await rejects());rows=accounts
wrongOwner=true;H.t('foreign config owner refuses',await rejects());wrongOwner=false
rows=[{...accounts[0],pubkey:asset},...accounts.slice(1)];H.t('proposal PDA mismatch refuses',await rejects())
rows=[accounts[0],{...accounts[1],pubkey:asset},...accounts.slice(2)];H.t('vote PDA mismatch refuses',await rejects())
rows=[{...accounts[0],account:{...accounts[0].account,owner:ids.MINT_PROG}},...accounts.slice(1)];H.t('foreign account owner refuses',await rejects())
H.eq('vote record layout is pinned to Rust',[...rust.match(/pub struct VoteRecord \{([\s\S]*?)\n\}/)[1].matchAll(/pub (\w+): ([^,\n]+)/g)].map(x=>[x[1],x[2]]),[['proposal','Pubkey'],['asset','Pubkey'],['support','bool'],['bump','u8']])
H.done()
