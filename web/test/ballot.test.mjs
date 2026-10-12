import test from 'node:test'
import assert from 'node:assert/strict'
import {Keypair,PublicKey,SystemProgram,Transaction} from '@solana/web3.js'
import {voteInput,ballotBatches,planVotes,verifyBallotQuote,VOTE_BATCH_LIMIT} from '../src/lib/vote-plan.mjs'
import {makeIds} from '../src/lib/ids.mjs'
import {PROFILES} from '../src/config.js'
import {proposalAddress,voteAddress,castVoteIx} from '../src/lib/governance.mjs'
import {acctDisc,u8,u16,u32,u64,i64} from '../src/lib/enc.mjs'
import {encode,STRUCTS} from '../../bank/layout.mjs'
import {CLOCK_SYSVAR} from '../src/lib/reads.mjs'
import {judgeInput} from '../server/club-engine.mjs'
const key=()=>Keypair.generate().publicKey,owner=key(),assets=Array.from({length:6},key),ids=makeIds({...PROFILES.mainnet,collection:key().toBase58()}),proposal=proposalAddress(ids,1)
const input={proposal:proposal.toBase58(),ballots:assets.slice(0,4).map((a,i)=>({asset:a.toBase58(),support:i%2===0}))}
const base=name=>Object.fromEntries(STRUCTS[name].fields.map(([k,t])=>[k,k==='version'?STRUCTS[name].version:t==='Pubkey'?ids.COLL.toBase58():t==='bool'?false:t.startsWith('Vec')?[]:t==='[u8; 32]'?'00'.repeat(32):t==='[u32; 5]'?Array(5).fill(0):t==='[u32; BOOST_RING]'?Array(64).fill(0):0]))
function fixture({foreign=false,late=false,voted=false,expired=false,executed=false,dust=false}={}) {
 const rows=new Map(),add=(k,owner,data)=>rows.set(k.toBase58(),{owner,data,executable:false,lamports:1})
 const clock=Buffer.alloc(40);clock.writeBigInt64LE(expired?1001n:500n,32);add(CLOCK_SYSVAR,SystemProgram.programId,clock)
 const raw=Buffer.concat([acctDisc('Proposal'),u64(1),u32(1),u8(0),i64(2000),i64(3000),u64(21000),u32(25),i64(1000),u64(0),u64(0),u8(executed?1:0),u8(254),u64(10),u16(2100),u16(5100),u64(10),i64(100)])
 add(proposal,ids.GOV_PROG,raw)
 for(const [i,asset] of assets.entries()) {
  // Core AssetV1 key, owner, collection update authority, name, URI, seq=None.
  add(asset,ids.CORE,Buffer.concat([u8(1),(foreign&&i===1?key():owner).toBuffer(),u8(2),ids.COLL.toBuffer(),u32(0),u32(0),u8(0)]))
  add(ids.vaultRecord(asset),ids.MINT_PROG,encode('VaultRecord',{...base('VaultRecord'),asset:asset.toBase58(),mint_index:late&&i===1?10:i,level:1}))
 }
 if(voted)add(voteAddress(ids,proposal,assets[1]),ids.GOV_PROG,Buffer.alloc(74))
 if(dust)add(voteAddress(ids,proposal,assets[1]),SystemProgram.programId,Buffer.alloc(0))
 return {getAccountInfo:async k=>rows.get(k.toBase58())||null}
}
test('batch input is bounded, unique and strictly tied to explicit boolean choices',()=>{
 assert.deepEqual(voteInput(input),input);assert.doesNotThrow(()=>judgeInput('vote',input))
 for(const bad of [{...input,ballots:[]},{...input,ballots:[...input.ballots,input.ballots[0]]},{...input,ballots:[input.ballots[0],input.ballots[0]]},{...input,ballots:[{...input.ballots[0],support:'yes'}]},{...input,ballots:[{...input.ballots[0],destination:owner.toBase58()}]},{...input,asset:assets[0].toBase58()},{...input,tx:'arbitrary'}])assert.throws(()=>voteInput(bad))
})
test('legacy one-vault input stays supported and does not default missing choices',()=>{
 assert.equal(voteInput({proposal:input.proposal,...input.ballots[0]}).ballots.length,1)
 assert.throws(()=>voteInput({proposal:input.proposal,asset:input.ballots[0].asset}))
})
test('large ballots split without dropping or changing assignments and copy their data',()=>{
 const all=assets.map((a,i)=>({asset:a.toBase58(),support:!!(i%2)})),b=ballotBatches(all)
 assert.deepEqual(b.map(x=>x.length),[4,2]);assert.deepEqual(b.flat(),all);b[0][0].support=!all[0].support;assert.notEqual(b[0][0].support,all[0].support)
})
test('mixed batch builds the exact per-vault instructions and fits the packet',async()=>{
 const p=await planVotes(fixture(),ids,owner.toBase58(),input)
 assert.deepEqual(p.details.ballots.map(({asset,support})=>({asset,support})),input.ballots)
 const tx=new Transaction({feePayer:owner,recentBlockhash:key().toBase58()}).add(...p.ixs)
 assert.ok(tx.serialize({requireAllSignatures:false,verifySignatures:false}).length<1100)
 assert.equal(p.ixs.length,VOTE_BATCH_LIMIT)
 p.ixs.forEach((ix,i)=>assert.deepEqual(ix,castVoteIx(ids,proposal,assets[i],owner,input.ballots[i].support)))
})
test('a single ineligible vault refuses the entire atomic batch',async()=>{
 for(const opts of [{foreign:true},{late:true},{voted:true},{expired:true},{executed:true}])await assert.rejects(planVotes(fixture(opts),ids,owner.toBase58(),input))
 assert.equal((await planVotes(fixture({dust:true}),ids,owner.toBase58(),input)).ixs.length,4)
})
test('client verifies every choice, proposal, ordering and count before showing confirmation',()=>{
 const details={proposal:input.proposal,ballots:input.ballots.map(b=>({...b}))}
 assert.doesNotThrow(()=>verifyBallotQuote(details,input))
 for(const wrong of [{...details,proposal:owner.toBase58()},{...details,ballots:details.ballots.slice(1)},{...details,ballots:[...details.ballots].reverse()},{...details,ballots:details.ballots.map((b,i)=>i?b:{...b,support:!b.support})}])assert.throws(()=>verifyBallotQuote(wrong,input))
})
