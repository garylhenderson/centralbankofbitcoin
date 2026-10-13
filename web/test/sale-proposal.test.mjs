import {Keypair,SystemProgram} from '@solana/web3.js'
import {harness,scopeFor,extractConst,ts2js,evalWith,SUITE,diffIx} from './ref.mjs'
import {saleProposalInput,executionInput,createSaleProposalIx,executeProposalIx,planGovernanceAction,verifyGovernanceQuote,austinTimestamp,cbBTCPrice,executionEffects} from '../src/lib/sale-proposal.mjs'
import {makeIds} from '../src/lib/ids.mjs'
import {PROFILES} from '../src/config.js'
import {proposalAddress} from '../src/lib/governance.mjs'
import {acctDisc,u8,u16,u32,u64,i64} from '../src/lib/enc.mjs'
import {encode,STRUCTS} from '../../bank/layout.mjs'
import {CLOCK_SYSVAR} from '../src/lib/reads.mjs'
import {judgeInput} from '../server/club-engine.mjs'
const H=harness('sale-proposal'),key=()=>Keypair.generate().publicKey,owner=Keypair.generate(),asset=key(),ids=makeIds({...PROFILES.mainnet,collection:key().toBase58()}),proposal=proposalAddress(ids,1)
const input={asset:asset.toBase58(),opens_at:'3000',closes_at:'4000',price:'21000',cap:'25',voting_ends_at:'2000'}
const fails=f=>{try{f();return false}catch{return true}},rejects=async f=>{try{await f();return false}catch{return true}}
H.eq('strict draft preserves every chosen value',saleProposalInput(input),input)
H.t('arbitrary instructions, destinations and missing fields refuse',[{...input,tx:'x'},{...input,price:undefined},{...input,asset:'bad'},{...input,cap:25},{...input,cap:'025'},{...input,price:'1e6'}].every(x=>fails(()=>saleProposalInput(x))))
H.t('price, cap and dates reject boundary violations',[{price:'20999'},{price:String(1n<<64n)},{cap:'0'},{cap:'2101'},{closes_at:'3000'},{closes_at:'31539001'},{opens_at:'2000'},{voting_ends_at:'253402300800'}].every(x=>fails(()=>saleProposalInput({...input,...x}))))
H.t('execution accepts only an exact proposal address',fails(()=>executionInput({proposal:proposal.toBase58(),tx:'x'}))&&fails(()=>executionInput({proposal:'bad'})))
H.t('named server actions reject an injected signature or action',fails(()=>judgeInput('propose',{...input,signature:'x'}))&&fails(()=>judgeInput('execute_proposal',{proposal:proposal.toBase58(),owner:asset.toBase58()}))&&fails(()=>judgeInput('set_round',input)))
const scope=scopeFor(ids,{propId:n=>proposalAddress(ids,n)})
const code=['acts','actRound','ixPropA','ixExec'].map(n=>ts2js(extractConst(SUITE,n))).join('\n')
const ref=evalWith(code,{...scope,PRICE:21000n,now:()=>1000},'({ixPropA,actRound,ixExec})')
H.eq('creation bytes and every account equal the frozen suite builder',diffIx(createSaleProposalIx(ids,1,owner.publicKey,input),ref.ixPropA(1,asset,owner,2000,ref.actRound(21000n,25,3000,4000))),[])
H.eq('permissionless execution equals the frozen suite builder',diffIx(executeProposalIx(ids,proposal),ref.ixExec(proposal)),[])
H.eq('Austin summer and winter convert independently of browser zone',[austinTimestamp('2026-10-26T12:00'),austinTimestamp('2026-12-25T12:00')],[String(Date.parse('2026-10-26T17:00:00Z')/1000),String(Date.parse('2026-12-25T18:00:00Z')/1000)])
H.t('invalid, missing and repeated wall-clock times refuse',['2026-02-30T12:00','2026-03-08T02:30','2026-11-01T01:30','today','2026-10-26T12:00Z'].every(x=>fails(()=>austinTimestamp(x))))
H.eq('decimal cbBTC stays exact beyond floating point precision',cbBTCPrice('90071992.54740993'),'9007199254740993')
H.t('no exponent, negative, overflow or excess decimals in price',['1e8','-1','0.000000001','184467440738',''].every(x=>fails(()=>cbBTCPrice(x))))
const base=name=>Object.fromEntries(STRUCTS[name].fields.map(([k,t])=>[k,k==='version'?STRUCTS[name].version:t==='Pubkey'?ids.COLL.toBase58():t==='bool'?false:t.startsWith('Vec')?[]:t==='[u8; 32]'?'00'.repeat(32):t==='[u32; 5]'?Array(5).fill(0):['[u32; BOOST_RING]','[i64; 64]'].includes(t)?Array(64).fill(0):0]))
function fixture(opts={}) {
 const rows=new Map(),add=(k,owner,data)=>rows.set(k.toBase58(),{owner,data,lamports:1})
 const cfg=(name,k,program,values)=>add(k,program,encode(name,{...base(name),...values}))
 cfg('SealConfig',ids.SEAL_CFG,ids.SEAL_PROG,{})
 cfg('MintConfig',ids.MINT_CFG,ids.MINT_PROG,{governance:ids.GOV_PDA.toBase58(),charter_closes_at:opts.charter??1000,minted_total:opts.minted??100,bare_burns_retired:5,notice_secs:604800,...opts.mint})
 cfg('BurnConfig',ids.BURN_CFG,ids.BURN_PROG,{burned_total:10})
 cfg('GovConfig',ids.GOV_CFG,ids.GOV_PROG,{min_voting_secs:1000,quorum_bps:2100,threshold_bps:5100,proposal_count:opts.count??0,...opts.gov})
 const clock=Buffer.alloc(40);clock.writeBigInt64LE(BigInt(opts.now??1000),32);add(CLOCK_SYSVAR,SystemProgram.programId,clock)
 add(asset,opts.foreignProgram?ids.MINT_PROG:ids.CORE,Buffer.concat([u8(1),(opts.foreignOwner?key():owner.publicKey).toBuffer(),u8(2),(opts.foreignCollection?key():ids.COLL).toBuffer(),u32(0),u32(0),u8(0)]))
 cfg('VaultRecord',ids.vaultRecord(asset),ids.MINT_PROG,{asset:asset.toBase58(),retired:!!opts.retired})
 if(opts.occupied)add(proposal,SystemProgram.programId,Buffer.alloc(0))
 if(opts.execute)add(proposal,opts.wrongProposalOwner?ids.MINT_PROG:ids.GOV_PROG,Buffer.concat([acctDisc('Proposal'),u64(opts.proposalId??1),u32(1),u8(0),i64(3000),i64(4000),u64(21000),u32(25),i64(1000),u64(opts.yes??50),u64(opts.no??0),u8(opts.executed?1:0),u8(254),u64(100),u16(2100),u16(5100),u64(100),i64(0)]))
 return {getAccountInfo:async k=>rows.get(k.toBase58())||null}
}
const plan=async(opts={},chosen=input)=>planGovernanceAction(fixture(opts),ids,owner.publicKey.toBase58(),'propose',chosen)
const initial=await plan()
H.eq('live snapshot subtracts redemptions and retired bare burns',[initial.details.quorum_supply,initial.details.index_snapshot,initial.details.proposal_id],['85','100','1'])
H.eq('creation builds one instruction and never votes automatically',initial.ixs.map(ix=>ix.data.subarray(0,8).toString('hex')),[createSaleProposalIx(ids,1,owner.publicKey,input).data.subarray(0,8).toString('hex')])
H.t('consent says creation does not vote or open the sale',initial.acks[0].text.includes('does not cast any vote')&&initial.acks[0].text.includes('executed separately'))
H.t('charter refuses one second before closing',await rejects(()=>plan({charter:1001})))
H.t('voting duration rejects below minimum and over maximum',await rejects(()=>plan({now:1001}))&&await rejects(()=>plan({}, {...input,voting_ends_at:'2593001',opens_at:'2593002',closes_at:'2593003'})))
H.eq('maximum voting duration is accepted exactly',(await plan({}, {...input,voting_ends_at:'2593000',opens_at:'2593001',closes_at:'2593002'})).ixs.length,1)
H.t('foreign owner, collection, program and retired vault all refuse',(await Promise.all([{foreignOwner:true},{foreignCollection:true},{foreignProgram:true},{retired:true}].map(o=>rejects(()=>plan(o))))).every(Boolean))
H.t('zero or invalid negative supply refuses',await rejects(()=>plan({minted:15}))&&await rejects(()=>plan({minted:14})))
H.t('occupied PDA and exhausted proposal counter refuse',await rejects(()=>plan({occupied:true}))&&await rejects(()=>plan({count:(1n<<64n)-1n})))
H.t('governance authority and collection are pinned',await rejects(()=>plan({mint:{governance:key().toBase58()}}))&&await rejects(()=>plan({gov:{collection:key().toBase58()}})))
H.t('concurrent proposal changes the predicted instruction and address',(await plan({count:1})).details.proposal!==initial.details.proposal)
H.t('review rejects changed price, asset, dates, cap or extra action',[{asset:key().toBase58()},{voting_ends_at:'2001'},{actions:[{...initial.details.actions[0],price:'21001'}]},{actions:[{...initial.details.actions[0],cap:26}]},{actions:[{...initial.details.actions[0],opens_at:'3001'}]},{actions:[...initial.details.actions,initial.details.actions[0]]}].every(change=>fails(()=>verifyGovernanceQuote('propose',input,{...initial.details,...change}))))
const execute=opts=>planGovernanceAction(fixture({execute:true,...opts}),ids,key().toBase58(),'execute_proposal',{proposal:proposal.toBase58()})
H.eq('execution needs a passed proposal but no owned vault',(await execute({})).details.proposal,proposal.toBase58())
H.t('open, failed, previously executed and expired decisions refuse',(await Promise.all([{now:999},{yes:0},{executed:true},{now:605801}].map(o=>rejects(()=>execute(o))))).every(Boolean))
H.eq('execution includes the final second of its seven-day window',(await execute({now:605800})).ixs.length,1)
H.t('execution checks program ownership and the decoded PDA',await rejects(()=>execute({wrongProposalOwner:true}))&&await rejects(()=>execute({proposalId:2})))
H.t('execution review binds the target address',fails(()=>verifyGovernanceQuote('execute_proposal',{proposal:proposal.toBase58()},{proposal:key().toBase58()})))
const over=(await execute({now:4000})).details.execution[0]
H.eq('expired sale still shows its superseding marker',[over.status,over.advances_round_id],['round_already_over','1'])
H.eq('superseded sale shows no round replacement',(await execute({gov:{last_round_id:2}})).details.execution[0].status,'superseded')
const replacing=(await execute({mint:{round_id:7,price:99999,opens_at:1,closes_at:9999,cap:50}})).details.execution[0]
H.eq('execution describes the live round being replaced',[replacing.status,replacing.replaces_round.id,replacing.replaces_round.price,replacing.replaces_round.cap],['applies','7','99999',50])
H.t('crossing sale close changes consented effects',JSON.stringify((await execute({now:3999})).details)!==JSON.stringify((await execute({now:4000})).details))
const brakes={id:'5',created_at:'100',actions:[{kind:'Brakes',set_guardian:true,restart_sales:true,restart_sweep:true}]},g={last_guardian_id:6,last_round_id:0,last_arm_id:0,last_boost_id:0},mint={sales_stopped:true,sales_stopped_at:100,sweep_stopped:false,sweep_stopped_at:101,notice_secs:604800}
H.eq('guardian and restart halves are judged independently',executionEffects(brakes,g,mint,200).map(e=>e.status),['superseded','stop_is_newer','sent'])
H.eq('same-second stop wins the restart tie',executionEffects(brakes,{...g,last_guardian_id:0},mint,200)[1].status,'stop_is_newer')
H.eq('older stop can be restarted',executionEffects(brakes,g,{...mint,sales_stopped_at:99},200)[1].status,'sent')
H.eq('operator change observes supersession',executionEffects({id:'5',actions:[{kind:'ArmSwapOperator'}]}, {...g,last_arm_id:5},mint,200)[0].status,'superseded')
H.eq('boost terms observe supersession',executionEffects({id:'5',actions:[{kind:'SetBoostTerms'}]}, {...g,last_boost_id:4},mint,200)[0].status,'applies')
H.t('consent discloses landing-time skips and all-skipped completion',(await execute({})).acks[0].text.includes('chain decides at landing')&&(await execute({})).acks[0].text.includes('every action is skipped'))
H.t('close within ten minutes requires a separate risk acknowledgment',(await execute({now:3400})).acks.some(a=>a.id==='sale_closes_soon'))
H.t('earlier execution has no near-close acknowledgment',!(await execute({now:3399})).acks.some(a=>a.id==='sale_closes_soon'))
H.t('near execution-window expiry has its own acknowledgment',(await execute({now:605200})).acks.some(a=>a.id==='execution_window_closes_soon'))
H.eq('unset and ended rounds are identified without inventing a live sale',[(await execute({})).details.execution[0].current_round_state,(await execute({mint:{round_id:4,closes_at:999}})).details.execution[0].current_round_state],['unset','ended'])
H.done()
