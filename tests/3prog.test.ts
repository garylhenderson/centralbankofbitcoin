/**
 * v6 STAGE 2 (Gary, 2026-10-03). THERE IS NO BANK, NO ADMIN, AND NO WALLET EVER
 * HOLDS GOVERNANCE. `deployer` is the localnet INIT_AUTHORITY test key (Gary's
 * wallet on mainnet): it signs the one-time initializes and is otherwise a funder.
 *
 * THE SUITE RUNS IN THE ONLY ORDER PRODUCTION CAN:
 *   init -> the charter window opens -> Proof of Burn holders claim the first
 *   vaults -> their levels are drawn from slot hashes -> THOSE vaults vote the
 *   first paid round in -> everything else.
 * Governance is the GOV program's PDA from `initialize`, so every governance arm
 * below is a REAL proposal, voted by real vaults, executed by CPI. They are
 * batched so one voting window serves many arms.
 *
 * Every vault holds a real SPL token balance; Core is the real mainnet build.
 *
 * v6 STAGE 3: THE COMMUNITY POOL. The 85% lands in a token account of MINT's
 * config PDA; vaults activate at 21,000 sats, earn by level weight 2/3/4/5/6, and
 * are paid INTO THEIR OWN cbBTC ACCOUNT by a permissionless claim. A redemption
 * claims first and BURN retires the vault by CPI. And a missed capture window is
 * RESCHEDULED, never defaulted to the lowest level (Gary: "We can't lock everyone
 * in the lowest level"); four instructions crank queued vaults as they pass.
 *
 * The stand-in cbBTC has a FREEZE AUTHORITY, like mainnet cbBTC (Coinbase), so a
 * frozen vault account is tested rather than argued.
 *
 * v6 STAGE 3b (Gary, 2026-10-03, after red-team 1): A VOTE ONLY REACHES WHAT MAY
 * SAFELY CHANGE. No proposal before the charter window closes (the RT1 attack:
 * the FIRST vault, alone, carried any vote); YES must reach 10% of live supply;
 * up to four actions per proposal, one per kind, atomic; the split, both
 * destinations and max_supply are permanent; the sweep only tightens; a new swap
 * operator waits seven days. And AT MOST 2.1% OF LIVE VAULTS ARE REDEEMED PER
 * WINDOW, on chain: every redemption below waits for a token (`send`), and
 * section RL drains the bucket on purpose. GOV runs at quorum 5% so the 10%
 * turnout rule can be seen to bind (D.1).
 *
 * v6 STAGE 3c (Gary, 2026-10-03, red-team 2): a guardian change or a new swap
 * operator needs YES from HALF OF ALL LIVE VAULTS, never shares a proposal with
 * the other, and lands only after a notice (60 s here, 7 days on mainnet); the
 * guardian may cancel a pending operator. A tighten is bounded by values fixed at
 * initialize. An overtaken action is a LOGGED NO-OP, not a revert. An activation
 * REQUESTS, and the vault JOINS only after the next distribution. The redemption
 * cap is a true rolling window. Initialize checks SEAL, MINT and BURN agree. And
 * the charter claim passes an Oracle's account through to Core (section OR).
 */
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { Connection, Keypair, PublicKey as W, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL, SYSVAR_INSTRUCTIONS_PUBKEY, AddressLookupTableProgram,
  TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createMint, getAssociatedTokenAddressSync, mintTo,
  createTransferInstruction, createAssociatedTokenAccountIdempotentInstruction, createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction, createApproveInstruction, createFreezeAccountInstruction,
  createThawAccountInstruction, createAccount } from '@solana/spl-token'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { keypairIdentity, createNoopSigner, createSignerFromKeypair, generateSigner,
  publicKey as pk } from '@metaplex-foundation/umi'
import { toWeb3JsPublicKey, fromWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters'
import { mplCore, createCollection, execute, fetchAsset, fetchCollection, findAssetSignerPda, create, transfer, burn,
  updateCollectionPlugin, removeCollectionPlugin, addCollectionPlugin, addPlugin, updatePlugin, removePlugin, ruleSet, PluginType, CheckResult,
  getAddCollectionPluginV1InstructionDataSerializer, getUpdatePluginV1InstructionDataSerializer,
  getBurnV1InstructionDataSerializer } from '@metaplex-foundation/mpl-core'
// THE SAME MERKLE CODE THE MAINNET PROBE USES. The program verifying a proof this
// module built is the only check that can fail if the JS and the Rust drift.
import { rootOf as pobRoot, proofOf as pobProof } from '../scripts/pob-merkle.mjs'
const RPC='http://127.0.0.1:8999'; const CM='confirmed' as const
const conn=new Connection(RPC,CM)
const SEAL_PROG=new W('9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273')
const MINT_PROG=new W('Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo')
const BURN_PROG=new W('8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8')
const GOV_PROG=new W('2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2')
const [GOV_CFG]=W.findProgramAddressSync([Buffer.from('gov-config')],GOV_PROG)
const [GOV_PDA]=W.findProgramAddressSync([Buffer.from('gov')],GOV_PROG)
const CORE=new W('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d')
const [SEAL]=W.findProgramAddressSync([Buffer.from('seal')],SEAL_PROG)
const [SEAL_CFG]=W.findProgramAddressSync([Buffer.from('config')],SEAL_PROG)
const [MINT_AUTH]=W.findProgramAddressSync([Buffer.from('mint')],MINT_PROG)
const [MINT_CFG]=W.findProgramAddressSync([Buffer.from('mint-config')],MINT_PROG)
const [REVENUE]=W.findProgramAddressSync([Buffer.from('revenue')],MINT_PROG)
const [BURN_CFG]=W.findProgramAddressSync([Buffer.from('burn-config')],BURN_PROG)
const SLOT_HASHES=new W('SysvarS1otHashes111111111111111111111111111')
const vrec=(asset:W)=>W.findProgramAddressSync([Buffer.from('vault'),asset.toBuffer()],MINT_PROG)[0]
const d=(n:string)=>createHash('sha256').update(`global:${n}`).digest().subarray(0,8)
const acctDisc=(n:string)=>createHash('sha256').update(`account:${n}`).digest().subarray(0,8)
const R:{id:string;t:string;want:string;got:string;ok:boolean;n?:string}[]=[]
const rec=(id:string,t:string,want:string,got:string,n?:string)=>{const ok=want===got;R.push({id,t,want,got,ok,n})
  console.log(`  ${ok?'ok  ':'XX  '}${id}  ${t}  [want ${want}, got ${got}]${n?`\n         ↳ ${n}`:''}`)}
const u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b}
const u8b=(n:number)=>Buffer.from([n])
const u16=(n:number)=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b}
const i64=(n:number|bigint)=>{const b=Buffer.alloc(8);b.writeBigInt64LE(BigInt(n));return b}
const u64=(n:number|bigint)=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b}
const str=(v:string)=>Buffer.concat([u32(Buffer.byteLength(v)),Buffer.from(v)])
const NONE=Buffer.from([0])
const SOME=(b:Buffer)=>Buffer.concat([Buffer.from([1]),b])
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms))
const caps5=(c:number[])=>Buffer.concat(c.map(u32))
const proofBuf=(pr:Buffer[])=>Buffer.concat([u32(pr.length),...pr])
const LNAME=['I','II','III','IV','V']
// THE CENSUS. Tiny on purpose, and EXHAUSTED at the end of the suite (L.18-L.22),
// so "the quotas hold exactly" is measured by filling them rather than argued.
// At P, at most 20 earlier fixtures are ineligible (burned, active, funded or
// owned elsewhere). A quota of 21 guarantees an eligible vault at EVERY level
// after exhaustion, even if every excluded fixture draws the same level.
const LEVEL_CAPS=[21,21,21,21,21]
const CAP_TOTAL=LEVEL_CAPS.reduce((a,b)=>a+b,0)
const MAX_SUPPLY=2100n
// MintConfig v6 layout (version 2). GOV reads governance at 41, minted_total at 141.
const OFF_GOVERNANCE=41, OFF_ROUND_ID=105, OFF_PRICE=125, OFF_MINTED_TOTAL=141
const OFF_SALES_STOPPED=191, OFF_SWEEP_STOPPED=192, OFF_GUARDIAN=193, OFF_SWAP_OPERATOR=225
const OFF_SWEEP_COOLDOWN=274, OFF_LEVEL_CAPS=290, OFF_LEVEL_MINTED=310, OFF_REVEALED=330
const OFF_CHARTER_CLAIMED=450
// v6 stage 3 (MintConfig version 3): the pool. pool_ata sits at 73, where the
// distributor wallet was; the pool state is appended after charter_claimed.
const OFF_POOL_ATA=73, OFF_BARE_RETIRED=454, OFF_TOTAL_WEIGHT=462, OFF_ACTIVE_COUNT=470
const OFF_ACC=478, OFF_OWED=494, OFF_LAST_DIST=510
// v6 stage 3b (MintConfig version 4): stage 3's emission_min[518] is DELETED and
// five fields follow last_distribute_at. Nothing GOV or BURN reads moved: GOV
// reads charter_closes_at at 442 and the sweep bounds at 257/266/274.
const OFF_SOL_RESERVE=257, OFF_MAX_SWEEP=266, OFF_LAST_SWEEP=282, OFF_CHARTER_CLOSES=442
const OFF_SALES_STOPPED_AT=518, OFF_PENDING_OP=534, OFF_PENDING_OP_AT=566, OFF_MONTHLY=574
// v6 stage 3c (MintConfig version 5): nine fields appended after monthly_secs.
const OFF_PENDING_GUARDIAN=582, OFF_PENDING_GUARDIAN_SET=614, OFF_PENDING_GUARDIAN_AT=615, OFF_NOTICE=623
const OFF_SWEEP_FLOOR=631, OFF_COOLDOWN_CEIL=639, OFF_RESERVE_CEIL=647, OFF_DIST_EPOCH=655, OFF_PENDING_COUNT=663, OFF_PENDING_THIS=671
// The $CBOB boost (MintConfig version 6), appended after pending_this_epoch.
const OFF_CBOB_MINT=679, OFF_MAX_BOOST_W=711, OFF_MAX_BOOST_E=712, OFF_BOOST_PRICE=714, OFF_BOOST_W=722, OFF_BOOST_E=723
const OFF_BOOSTS_ACTIVE=725, OFF_BOOSTS_DUE=729, OFF_BOOST_W_TOTAL=733, OFF_CBOB_BURNED=741, OFF_BOOST_RING=749, BOOST_RING=64
/** A distribution: burn exactly 100 $GARY of THE $GARY mint, or wait the period.
 *  ⚠️ MAINNET MUST INITIALIZE THE PERIOD AT 30 DAYS (2,592,000 s); the suite uses
 *  150 s so the free and in-line paths can be watched running. */
const GARY_MINT=new W('8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk')
const DIST_BURN=100_000_000_000n
const MONTHLY=150
// BurnConfig version 4 (stage 3c): burned_total[42..50] redeem_window_secs[50..58]
// rate_head[58] rate_ring[59..59+8*64] — the last 64 redemption times.
const OFF_REDEEM_WINDOW=50, OFF_RATE_HEAD=58, OFF_RATE_RING=59, RATE_RING=64
/** The suite's redemption window. ⚠️ MAINNET MUST BE 3600; 10 is the floor, so
 *  the bucket can be drained and watched refilling inside a test run. */
const REDEEM_WINDOW=10
const SYSVAR_CLOCK=new W('SysvarC1ock11111111111111111111111111111111')
// VaultRecord (version 2): disc[0..8] version[8] asset[9..41] mint_index[41..49]
// reveal_slot[49..57] level[57] charter[58] entropy_set[59] entropy[60..92]
// attrs_hash[92..124] bump[124] active[125] retired[126] reschedules[127..129]
// vault_ata[129..161] debt_scaled[161..177]; version 3 (stage 3c): pending[177]
// request_epoch[178..186]
const OFF_REC_PENDING=177, OFF_REC_REQ_EPOCH=178
// VaultRecord version 4: the $CBOB boost and the carried share, in what was padding.
const OFF_REC_BOOST_W=186, OFF_REC_BOOST_END=187, OFF_REC_CARRY=195
const OFF_REC_INDEX=41, OFF_REC_REVEAL=49, OFF_REC_LEVEL=57, OFF_REC_CHARTER=58, OFF_REC_SET=59, OFF_REC_ENTROPY=60
const OFF_REC_ACTIVE=125, OFF_REC_RETIRED=126, OFF_REC_RESCHED=127, OFF_REC_ATA=129, OFF_REC_DEBT=161
const u128le=(b:Buffer,o:number)=>b.readBigUInt64LE(o)+(b.readBigUInt64LE(o+8)<<64n)
const ACC_SCALE=1_000_000_000_000n
const WEIGHTS=[2n,3n,4n,5n,6n]
const ACTIVATION=21_000n
const OFF_BURNED_TOTAL=42
const REVEAL_LEAD=16, REVEAL_WINDOW=300
// SweepTighten, one encoder for every TightenSweep proposal (stage 3b: the ONLY
// sweep change a vote can make, and only tighter). There is no encoder for the
// split, the destinations or max_supply: no instruction takes them any more.
const tightenArgs=(o:any={})=>Buffer.concat([
  o.solReserve!==undefined?SOME(u64(o.solReserve)):NONE,
  o.maxSweep!==undefined?SOME(u64(o.maxSweep)):NONE,
  o.sweepCooldown!==undefined?SOME(i64(o.sweepCooldown)):NONE])
const tighten=(o:any={})=>Buffer.concat([d('tighten_sweep'),tightenArgs(o)])
const armOp=(k:W)=>Buffer.concat([d('arm_swap_operator'),k.toBuffer()])
const attrs=(list:[string,string][])=>Buffer.concat([u32(list.length),
  ...list.flatMap(([k,v])=>[str(k),str(v)])])
const SATS=100_000_000n
/** The voted round price, in sats of the stand-in cbBTC. Above the 21,000 floor. */
const PRICE=50_000n
const SWEEP_CAP=BigInt(50*LAMPORTS_PER_SOL)
const SWEEP_COOLDOWN=1
const VOTE_SECS=60
/** Stage 3c: public notice before a voted guardian or swap operator lands.
 *  ⚠️ MAINNET MUST INITIALIZE IT AT 7 DAYS; 60 s is the floor, so `apply` runs. */
const NOTICE=60
/** Stage 3c: the bounds no vote may tighten past, fixed at initialize. */
const SWEEP_FLOOR=BigInt(LAMPORTS_PER_SOL/2), COOLDOWN_CEIL=30, RESERVE_CEIL=BigInt(LAMPORTS_PER_SOL/10)
/** The boost's bounds fixed at init (the suite's; mainnet's are in launch/mainnet-init.json). */
const MAX_BOOST_W=6, MAX_BOOST_E=10
/** The two genesis Oracle accounts (run-tests.sh): burn APPROVED, burn REJECTED. */
const ORACLE_OK=Keypair.fromSeed(Buffer.alloc(32,11)).publicKey, ORACLE_NO=Keypair.fromSeed(Buffer.alloc(32,12)).publicKey

async function main(){
  const deployer=Keypair.fromSeed(Buffer.alloc(32,7)), alice=Keypair.generate()
  const bob=Keypair.generate(), carol=Keypair.generate()
  const bankTreasury=Keypair.generate(), swapOp=Keypair.generate()
  const guardian=Keypair.generate(), guardian2=Keypair.generate(), stranger=Keypair.generate()
  const momentsAuth=Keypair.generate(), ctrlUA=Keypair.generate()
  for(const k of [deployer,alice,bob,carol,guardian,guardian2,stranger,momentsAuth,ctrlUA]){
    const s=await conn.requestAirdrop(k.publicKey,50*LAMPORTS_PER_SOL)
    await conn.confirmTransaction({signature:s,...(await conn.getLatestBlockhash())},CM) }
  const umi=createUmi(RPC,{commitment:CM}).use(mplCore())
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(deployer.secretKey)))
  const U=(k:Keypair)=>createSignerFromKeypair(umi,umi.eddsa.createKeypairFromSecretKey(k.secretKey))
  const aliceU=U(alice)
  const sendRaw=(ixs:TransactionInstruction[],s:Keypair[])=>sendAndConfirmTransaction(conn,new Transaction().add(...ixs),s,{commitment:CM})
  // EVERY REDEMPTION COUNTS AGAINST THE ROLLING WINDOW, so any transaction
  // carrying a burn waits until the window has room. Otherwise an arm testing
  // some OTHER refusal would be refused RateLimited first, which `because` would
  // rightly call a wrong-reason reject. Section RL uses `sendNow` to fill it.
  const BURN_DISC=d('burn_vault')
  const isBurnIx=(i:TransactionInstruction)=>i.programId.equals(BURN_PROG)&&i.data.length>=8&&Buffer.from(i.data.subarray(0,8)).equals(BURN_DISC)
  // Round 26: certify the CAP, not an overstated live-supply estimate. Each
  // coherent snapshot bounds monotonic minted/bare counters around every burn.
  // Only an interval wholly inside one rounding bucket proves its exact cap.
  type SupplySnapshot={minted:bigint,bare:bigint,burned:bigint}
  const capAt=(live:bigint)=>{const n=(live*210n+9_999n)/10_000n;return n<1n?1n:n}
  const stampCaps=(a:SupplySnapshot,b:SupplySnapshot,stamps:Map<number,bigint>)=>{
    if(b.minted<a.minted||b.bare<a.bare||b.burned<a.burned) throw new Error('supply snapshot counters moved backwards')
    for(let k=a.burned;k<b.burned;k++){
      const lo=capAt(a.minted-k-b.bare), hi=capAt(b.minted-k-a.bare)
      if(lo!==hi) throw new Error(`ambiguous redemption cap at ordinal ${k}: ${lo}..${hi}`)
      const prev=stamps.get(Number(k))
      if(prev!==undefined&&prev!==lo) throw new Error(`conflicting redemption cap at ordinal ${k}`)
      stamps.set(Number(k),lo)
    }
  }
  {
    const snapshot=(minted:bigint,bare=0n,burned=0n)=>({minted,bare,burned})
    const probe=(a:SupplySnapshot,b:SupplySnapshot,prior?:bigint)=>{const m=new Map<number,bigint>();if(prior!==undefined)m.set(0,prior)
      try{stampCaps(a,b,m);return [...m.values()].join(',')}catch(e){return String((e as Error).message)}}
    rec('RL.S1','cap stamps accept concurrent supply changes inside one cap bucket','1',probe(snapshot(10n),snapshot(11n,0n,1n)))
    rec('RL.S2','cap stamps refuse a concurrent mint crossing 47 to 48 live vaults','true',String(probe(snapshot(47n),snapshot(48n,0n,1n)).includes('ambiguous redemption cap')))
    rec('RL.S3','cap stamps refuse a concurrent bare retirement crossing 48 to 47','true',String(probe(snapshot(48n),snapshot(48n,1n,1n)).includes('ambiguous redemption cap')))
    rec('RL.S4','overlapping observations of the same cap are idempotent','1',probe(snapshot(10n),snapshot(11n,0n,1n),1n))
    rec('RL.S5','overlapping observations cannot overwrite a conflicting cap','true',String(probe(snapshot(10n),snapshot(11n,0n,1n),2n).includes('conflicting redemption cap')))
    rec('RL.S6','backward snapshot counters invalidate the evidence','true',String(probe(snapshot(11n),snapshot(10n,0n,1n)).includes('moved backwards')))
  }
  const CAP_STAMPS=new Map<number,bigint>()
  const supplyNow=async()=>{const [ma,ba]=await conn.getMultipleAccountsInfo([MINT_CFG,BURN_CFG],CM)
    if(!ma||!ba)throw new Error('missing supply snapshot account')
    return {minted:ma.data.readBigUInt64LE(OFF_MINTED_TOTAL),bare:ma.data.readBigUInt64LE(OFF_BARE_RETIRED),burned:ba.data.readBigUInt64LE(OFF_BURNED_TOTAL)}}
  const sendNow=async(ixs:TransactionInstruction[],s:Keypair[])=>{
    if(!ixs.some(isBurnIx)) return sendRaw(ixs,s)
    const a=await supplyNow(); const sig=await sendRaw(ixs,s); const b=await supplyNow()
    stampCaps(a,b,CAP_STAMPS)
    return sig}
  const send=async(ixs:TransactionInstruction[],s:Keypair[])=>{
    if(ixs.some(isBurnIx)) await waitRedeemToken()
    return sendNow(ixs,s)}
  // A REJECT FOR THE WRONG REASON IS A FALSE PASS, so the reason has to survive intact.
  const att=async(f:()=>Promise<unknown>)=>{try{await f();return{ok:true,err:''}}catch(e:any){
    const l=(e?.logs||e?.transactionLogs||[]).filter((x:string)=>/Error Code|custom program error|panicked|CBOB_SWEEP refused/.test(x))
    return{ok:false,err:(l.join(' | ')||String(e?.message||e)).replace(/\s+/g,' ').slice(0,260)}}}
  // ROUND 25 (N4): a refusal that is a bare ProgramError ("invalid instruction
  // data", "Provided owner is not allowed", ...) emits none of att's patterns, so
  // att falls back to the generic message, which does not say WHICH program
  // refused. attP also keeps every "Program <id> failed: ..." line, so a pin can
  // name the program that failed and its exact error.
  const attP=async(f:()=>Promise<unknown>)=>{try{await f();return{ok:true,err:''}}catch(e:any){
    const l=(e?.logs||e?.transactionLogs||[]).filter((x:string)=>/Error Code|custom program error|panicked|CBOB_SWEEP refused| failed: /.test(x))
    return{ok:false,err:(l.join(' | ')||String(e?.message||e)).replace(/\s+/g,' ').slice(0,600)}}}
  const cfg=async()=>(await conn.getAccountInfo(MINT_CFG,CM))!.data
  // SPEC 54: ANY transaction carrying a capture sets the compute limit (host cost
  // + ~115,000 per capture). Item 50 binds the holder pages to the same rule.
  const cuLim=(n:number)=>new TransactionInstruction({programId:new W('ComputeBudget111111111111111111111111111111'),keys:[],
    data:Buffer.concat([Buffer.from([2]),Buffer.from(new Uint32Array([n]).buffer)])})
  const crankCU=(o:any)=>o?.crank?.length?[cuLim(250_000+o.crank.length*130_000)]:[]
  const stops=async()=>{const c=await cfg(); return `${c[OFF_SALES_STOPPED]},${c[OFF_SWEEP_STOPPED]}`}
  const guardianNow=async()=>new W((await cfg()).subarray(OFF_GUARDIAN,OFF_GUARDIAN+32)).toBase58()
  const attrMap=(x:any)=>Object.fromEntries((x?.attributes?.attributeList||[]).map((e:any)=>[e.key,e.value]))
  /** The redemption window as the program will see it NOW (chain clock), computed
   *  independently: cap = max(1, ceil(live x 210 / 10_000)); a redemption lands
   *  iff the cap-th most recent one is at least a full window old. */
  const chainNow=async()=>(await conn.getAccountInfo(SYSVAR_CLOCK,CM))!.data.readBigInt64LE(32)
  const bucket=async()=>{const b=(await conn.getAccountInfo(BURN_CFG,CM))!.data; const c=await cfg()
    const live=c.readBigUInt64LE(OFF_MINTED_TOTAL)-b.readBigUInt64LE(OFF_BURNED_TOTAL)-c.readBigUInt64LE(OFF_BARE_RETIRED)
    let cap=(live*210n+9_999n)/10_000n; if(cap<1n) cap=1n
    const win=b.readBigInt64LE(OFF_REDEEM_WINDOW), head=b[OFF_RATE_HEAD]
    const ring=Array.from({length:RATE_RING},(_,i)=>b.readBigInt64LE(OFF_RATE_RING+8*i))
    const recent=(k:number)=>ring[((head-k)%RATE_RING+RATE_RING)%RATE_RING]   // k-th most recent, 1-based
    const now=await chainNow(), k=Number(cap<BigInt(RATE_RING)?cap:BigInt(RATE_RING))
    const room=now-recent(k)>=win, empty=now-recent(1)>=win
    return {live,cap,win,head,ring,recent,now,room,empty}}
  async function waitRedeemToken(){ for(let i=0;i<900;i++){ const k=await bucket(); if(k.room) return; await sleep(1000) }
    throw new Error('the redemption window never made room') }

  // ── the CBOB collection: CLEAN, update authority = MINT's PDA ──
  const coll=generateSigner(umi)
  await createCollection(umi,{collection:coll,name:'CBOBTC Vaults',uri:'https://cdn.gary.club/cbob/c.json',
    updateAuthority:pk(MINT_AUTH.toBase58())}).sendAndConfirm(umi,{confirm:{commitment:CM}})
  const COLL=toWeb3JsPublicKey(coll.publicKey)
  // A collection that already carries a plugin (what a careless or hostile launch
  // would hand MINT), and one that is not MINT's at all.
  const dirty=generateSigner(umi)
  await createCollection(umi,{collection:dirty,name:'dirty',uri:'u',updateAuthority:pk(MINT_AUTH.toBase58()),
    plugins:[{type:'PermanentBurnDelegate',authority:{type:'Address',address:pk(deployer.publicKey.toBase58())}} as any]})
    .sendAndConfirm(umi,{confirm:{commitment:CM}})
  const foreign=generateSigner(umi)
  await createCollection(umi,{collection:foreign,name:'foreign',uri:'u'}).sendAndConfirm(umi,{confirm:{commitment:CM}})

  // ── the stand-in cbBTC: the payment mint AND the reserve mint ──
  // WITH a freeze authority, because mainnet cbBTC has a live one (Coinbase).
  const mint=await createMint(conn,deployer,deployer.publicKey,deployer.publicKey,8)
  const ata=(o:W,m:W=mint)=>getAssociatedTokenAddressSync(m,o,true)
  const declare=(p:W)=>[getAssociatedTokenAddressSync(mint,p,true),getAssociatedTokenAddressSync(mint,p,true,TOKEN_2022_PROGRAM_ID)]
  const revAta=ata(REVENUE)
  // THE POOL: every host instruction carries it, for the monthly in-line run.
  const POOL=getAssociatedTokenAddressSync(mint,MINT_CFG,true)
  const POOLK={pubkey:POOL,isSigner:false,isWritable:false}
  await send([...[deployer,alice,bob,carol].map(k=>createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,ata(k.publicKey),k.publicKey,mint)),
    createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,revAta,REVENUE,mint)],[deployer])
  await mintTo(conn,deployer,mint,ata(deployer.publicKey),deployer,20_000_000_000n,[],{commitment:CM})
  await mintTo(conn,deployer,mint,ata(alice.publicKey),deployer,5_000_000_000n,[],{commitment:CM})
  // THE $CBOB FIXTURE: a classic SPL mint the deployer controls (mainnet's is
  // created before launch with nothing released, and pinned at init).
  const cbobMint=await createMint(conn,deployer,deployer.publicKey,null,6)
  const cbobAta=(k:W)=>getAssociatedTokenAddressSync(cbobMint,k,true)
  await send([...[alice,bob].map(k=>createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,cbobAta(k.publicKey),k.publicKey,cbobMint))],[deployer])
  await mintTo(conn,deployer,cbobMint,cbobAta(alice.publicKey),deployer,100_000_000_000n,[],{commitment:CM})
  await mintTo(conn,deployer,cbobMint,cbobAta(bob.publicKey),deployer,1_000_000_000n,[],{commitment:CM})
  const cbobSupply=async()=>(await conn.getAccountInfo(cbobMint,CM))!.data.readBigUInt64LE(36)
  const tokBal=async(x:W)=>BigInt((await conn.getTokenAccountBalance(x,CM)).value.amount)

  // ── THE PROOF OF BURN FIXTURE, SHAPED LIKE MAINNET ──
  // On mainnet a PoB is a Core asset in the SHARED Giraffish Moments collection,
  // whose update authority is a hot wallet that could mint a lookalike. So the
  // fixture is the same shape: one collection, the real set, and a lookalike the
  // update authority mints beside it with the same name pattern.
  const moments=generateSigner(umi)
  await createCollection(umi,{collection:moments,name:'Giraffish Moments',uri:'u',
    updateAuthority:pk(momentsAuth.publicKey.toBase58())}).sendAndConfirm(umi,{confirm:{commitment:CM}})
  const MOMENTS=toWeb3JsPublicKey(moments.publicKey)
  const mkPob=async(owner:Keypair,n:number)=>{const a=generateSigner(umi)
    await create(umi,{asset:a,collection:{publicKey:moments.publicKey} as any,authority:U(momentsAuth),
      name:`Proof of Burn #${n}`,uri:`https://cdn.gary.club/moments/pieces/proof-of-burn/${n}.json`,
      owner:pk(owner.publicKey.toBase58())}).sendAndConfirm(umi,{confirm:{commitment:CM}})
    return toWeb3JsPublicKey(a.publicKey)}
  const POB_OWNERS=[alice,alice,alice,alice,bob,carol,carol,carol]
  const POB:W[]=[]; for(let i=0;i<POB_OWNERS.length;i++) POB.push(await mkPob(POB_OWNERS[i],i+1))
  const LOOKALIKE=await mkPob(alice,241)
  const POB_ROOT=pobRoot(POB.map(p=>p.toBytes()))
  const pobProofFor=(i:number)=>pobProof(POB.map(p=>p.toBytes()),i)

  // ════════════════════════════ 0. INIT ════════════════════════════
  console.log('─── 0. init: one write per config, by INIT_AUTHORITY, and never another ───')
  // STAGE 3c: SEAL FIRST. MINT checks SEAL names its collection and carries the
  // payment mint as a reserve; BURN checks SEAL; GOV checks MINT (red-team 2 #7).
  // SEAL. Its reserve list is written HERE and nowhere else.
  const t22=await createMint(conn,deployer,deployer.publicKey,null,6,undefined,{commitment:CM},TOKEN_2022_PROGRAM_ID)
  const ixSealInit=(signer:Keypair,mints:W[])=>new TransactionInstruction({programId:SEAL_PROG,
    data:Buffer.concat([d('initialize'),COLL.toBuffer(),u32(mints.length),...mints.map(m=>m.toBuffer())]),
    keys:[{pubkey:SEAL_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
      ...mints.map(m=>({pubkey:m,isSigner:false,isWritable:false}))]})
  const s0=await att(()=>send([ixSealInit(stranger,[mint])],[stranger]))
  rec('0.2','SEAL: a stranger initializes the config','REJECT',s0.ok?'ALLOW':'REJECT',s0.err)
  const r22=await att(()=>send([ixSealInit(deployer,[mint,t22])],[deployer]))
  rec('6.13','SEAL: initialize with a Token-2022 reserve mint (would seal every vault)','REJECT',r22.ok?'ALLOW':'REJECT',r22.err)
  // ROUND 32 (gate 5, round 31 W2): a stranger pre-funds the config PDA first.
  // Anchor's `init` takes an address that already holds lamports, so dusting it
  // cannot block the one-time initialize.
  await send([SystemProgram.transfer({fromPubkey:stranger.publicKey,toPubkey:SEAL_CFG,lamports:1_000_000})],[stranger])
  const dusted=(await conn.getAccountInfo(SEAL_CFG,CM))
  const seal1=await att(()=>send([ixSealInit(deployer,[mint])],[deployer]))
  rec('0.2a','SEAL: INIT_AUTHORITY initializes it','ALLOW',seal1.ok?'ALLOW':'REJECT',seal1.err)
  rec('R31.W2a','SEAL: a config PDA a stranger pre-funded (System-owned, 1,000,000 lamports) still initializes, and SEAL owns it',
    `${SystemProgram.programId.toBase58()},1000000,${SEAL_PROG.toBase58()}`,
    `${dusted?.owner.toBase58()},${dusted?.lamports},${(await conn.getAccountInfo(SEAL_CFG,CM))?.owner.toBase58()}`)
  const CHARTER_OPEN_IN=25, CHARTER_SECS=100
  const t0=Math.floor(Date.now()/1000)
  const CHARTER_OPENS=t0+CHARTER_OPEN_IN, CHARTER_CLOSES=CHARTER_OPENS+CHARTER_SECS
  const ixMintInit=(signer:Keypair,o:any={})=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('initialize'),(o.treasury??bankTreasury.publicKey).toBuffer(),
      swapOp.publicKey.toBuffer(),SOME(guardian.publicKey.toBuffer()),
      u64(BigInt(0.05*LAMPORTS_PER_SOL)),u64(MAX_SUPPLY),u64(SWEEP_CAP),i64(SWEEP_COOLDOWN),caps5(LEVEL_CAPS),
      (o.payMint??mint).toBuffer(),MOMENTS.toBuffer(),o.root??POB_ROOT,i64(o.opens??CHARTER_OPENS),i64(o.closes??CHARTER_CLOSES),
      i64(o.monthly??MONTHLY),i64(o.notice??NOTICE),u64(o.floor??SWEEP_FLOOR),i64(o.coolCeil??COOLDOWN_CEIL),u64(o.resCeil??RESERVE_CEIL),
      u8b(o.maxBW??MAX_BOOST_W),u16(o.maxBE??MAX_BOOST_E)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:true},
      {pubkey:o.coll??COLL,isSigner:false,isWritable:true},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
      {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
      {pubkey:SEAL_CFG,isSigner:false,isWritable:false},{pubkey:o.cbob??cbobMint,isSigner:false,isWritable:false}]})
  const mi0=await att(()=>send([ixMintInit(stranger)],[stranger]))
  rec('0.1','MINT: a stranger initializes the config','REJECT',mi0.ok?'ALLOW':'REJECT',mi0.err)
  const miOver=await att(()=>send([ixMintInit(deployer,{opens:t0-600,closes:t0-300})],[deployer]))
  rec('0.1e','MINT: a charter window already over at init','REJECT',miOver.ok?'ALLOW':'REJECT',miOver.err)
  const miRoot=await att(()=>send([ixMintInit(deployer,{root:Buffer.alloc(32)})],[deployer]))
  rec('0.1f','MINT: an all-zero Proof of Burn root','REJECT',miRoot.ok?'ALLOW':'REJECT',miRoot.err)
  const miEm=await att(()=>send([ixMintInit(deployer,{monthly:30*24*3600+1})],[deployer]))
  rec('P.0a','MINT: a distribution period longer than 30 days','REJECT',miEm.ok?'ALLOW':'REJECT',miEm.err)
  // THE COLLECTION MUST ARRIVE CLEAN. A collection-level PermanentBurnDelegate held
  // by a wallet would let that wallet burn every vault ever minted into it.
  const miDirty=await att(()=>send([ixMintInit(deployer,{coll:toWeb3JsPublicKey(dirty.publicKey)})],[deployer]))
  rec('0.1g','MINT: a collection that already carries a plugin (a wallet-held permanent burn delegate)','REJECT',miDirty.ok?'ALLOW':'REJECT',miDirty.err)
  const miForeign=await att(()=>send([ixMintInit(deployer,{coll:toWeb3JsPublicKey(foreign.publicKey)})],[deployer]))
  rec('0.1h','MINT: a collection whose update authority is not MINT\'s PDA','REJECT',miForeign.ok?'ALLOW':'REJECT',miForeign.err)
  // ── STAGE 3c: the one-time values that would brick something for ever ──
  const miTreas=await att(()=>send([ixMintInit(deployer,{treasury:new W('11111111111111111111111111111111')})],[deployer]))
  rec('0.1j','MINT: the 15% destination is the default key (every split would fail for ever)','REJECT',miTreas.ok?'ALLOW':'REJECT',miTreas.err)
  const notReserve=await createMint(conn,deployer,deployer.publicKey,null,8)
  const miPay=await att(()=>send([ixMintInit(deployer,{payMint:notReserve})],[deployer]))
  rec('0.1k','MINT: a payment mint that is not one of SEAL\'s reserves (the pool could pay what no vault can redeem)','REJECT',miPay.ok?'ALLOW':'REJECT',miPay.err)
  const miFloor=await att(()=>send([ixMintInit(deployer,{floor:SWEEP_CAP+1n})],[deployer]))
  rec('0.1l','MINT: a tighten floor ABOVE the per-sweep cap being installed','REJECT',miFloor.ok?'ALLOW':'REJECT',miFloor.err)
  const miRes=await att(()=>send([ixMintInit(deployer,{resCeil:BigInt(11*LAMPORTS_PER_SOL)})],[deployer]))
  rec('0.1m','MINT: a reserve ceiling above the 10 SOL absolute bound','REJECT',miRes.ok?'ALLOW':'REJECT',miRes.err)
  const miNotice=await att(()=>send([ixMintInit(deployer,{notice:59})],[deployer]))
  rec('0.1n','MINT: a key-change notice under its 60 s floor','REJECT',miNotice.ok?'ALLOW':'REJECT',miNotice.err)
  // ── THE $CBOB BOOST: the mint and the bounds, once ──
  const bo0=[
    ['0.1o','the $CBOB mint is the PAYMENT mint (a cbBTC burn would buy boosts)',{cbob:mint}],
    ['0.1p','the $CBOB mint is the $GARY mint',{cbob:GARY_MINT}],
    ['0.1q','the $CBOB mint is a Token-2022 mint, not classic SPL',{cbob:t22}],
    ['0.1r','the $CBOB "mint" is not a mint at all (a token account)',{cbob:ata(alice.publicKey)}],
    ['0.1s','a boost weight bound of 0',{maxBW:0}],
    ['0.1t','a boost weight bound of 13, above the program\'s 12',{maxBW:13}],
    ['0.1u','a boost length bound of 64 distributions (the ring holds 63)',{maxBE:64}],
    ['0.1v','a boost length bound of 0',{maxBE:0}]] as [string,string,any][]
  for(const [id,t,o] of bo0){ const x=await att(()=>send([ixMintInit(deployer,o)],[deployer])); rec(id,'MINT: '+t,'REJECT',x.ok?'ALLOW':'REJECT',x.err) }
  const mi=await att(()=>send([ixMintInit(deployer)],[deployer]))
  rec('0.1a','MINT: INIT_AUTHORITY initializes it, with a guardian and a charter window','ALLOW',mi.ok?'ALLOW':'REJECT',mi.err)
  if(!mi.ok){ console.log('  MINT config already exists — use a FRESH validator'); }
  {
    const c=await cfg()
    rec('0.1b','MINT: the guardian is on chain at its fixed offset',guardian.publicKey.toBase58(),
      new W(c.subarray(OFF_GUARDIAN,OFF_GUARDIAN+32)).toBase58())
    // NO WALLET EVER HOLDS GOVERNANCE. Stage 1 needed a keypair and a one-way
    // handover; the charter claim removed the reason.
    rec('0.1c','MINT: governance is the GOV program\'s PDA from block one',GOV_PDA.toBase58(),
      new W(c.subarray(OFF_GOVERNANCE,OFF_GOVERNANCE+32)).toBase58())
    rec('0.1d','MINT: both stops start CLEAR','0,0',`${c[OFF_SALES_STOPPED]},${c[OFF_SWEEP_STOPPED]}`)
    // THE POOL IS DERIVED: MINT's config PDA's own ATA for the payment mint.
    rec('P.0b','MINT: the pool is the config PDA\'s cbBTC account, derived at init',
      getAssociatedTokenAddressSync(mint,MINT_CFG,true).toBase58(),new W(c.subarray(OFF_POOL_ATA,OFF_POOL_ATA+32)).toBase58())
    rec('P.0c','MINT: the distribution period is on chain (the suite\'s; mainnet must be 30 days)',String(MONTHLY),String(c.readBigInt64LE(OFF_MONTHLY)))
    rec('3c.0','MINT: the notice and the three tighten bounds are on chain at their pinned offsets',
      `${NOTICE},${SWEEP_FLOOR},${COOLDOWN_CEIL},${RESERVE_CEIL},0,0`,
      `${c.readBigInt64LE(OFF_NOTICE)},${c.readBigUInt64LE(OFF_SWEEP_FLOOR)},${c.readBigInt64LE(OFF_COOLDOWN_CEIL)},${c.readBigUInt64LE(OFF_RESERVE_CEIL)},${c.readBigUInt64LE(OFF_DIST_EPOCH)},${c.readBigUInt64LE(OFF_PENDING_COUNT)}`)
    rec('BO.0','MINT: THE $CBOB mint and the boost bounds are pinned, and boosts start OFF',
      `${cbobMint.toBase58()},${MAX_BOOST_W},${MAX_BOOST_E},0,0,0`,
      `${new W(c.subarray(OFF_CBOB_MINT,OFF_CBOB_MINT+32)).toBase58()},${c[OFF_MAX_BOOST_W]},${c.readUInt16LE(OFF_MAX_BOOST_E)},${c.readBigUInt64LE(OFF_BOOST_PRICE)},${c[OFF_BOOST_W]},${c.readUInt16LE(OFF_BOOST_E)}`)
  }
  const miAgain=await att(()=>send([ixMintInit(deployer)],[deployer]))
  rec('0.1i','MINT: a SECOND initialize','REJECT',miAgain.ok?'ALLOW':'REJECT',miAgain.err)

  // ═══ R. THE ROYALTY: 10%, FOREVER (Gary, 2026-10-03) ═══
  console.log('\n─── R. royalties: fixed at 10% by Core, not by our instruction list ───')
  {
    const c:any=await fetchCollection(umi,coll.publicKey)
    rec('R.1','the collection royalty is 1000 basis points','1000',String(c.royalties?.basisPoints??'none'))
    rec('R.2','the sole creator is THE revenue address at 100%',`${REVENUE.toBase58()}:100`,
      c.royalties?.creators?.length===1?`${c.royalties.creators[0].address}:${c.royalties.creators[0].percentage}`:'none')
    // THE WHOLE CLAIM. PluginAuthority::None: Core refuses every update and every
    // removal, whoever signs — including the update authority, which is our PDA.
    rec('R.3','the Royalties plugin authority is NONE (immutable in Core)','None',String(c.royalties?.authority?.type))
    const kinds=Object.keys(c).filter(k=>/delegate|royalties|attributes|edition|oracle|lifecycle|autograph|verifiedCreators|addBlocker|immutableMetadata|bubblegum/i.test(k)&&c[k])
    rec('R.4','...and it is the ONLY plugin on the collection','royalties',kinds.join(','))
  }
  // THE CORE SEMANTICS, PROVEN ON A COLLECTION WHOSE UPDATE AUTHORITY WE CAN SIGN
  // FOR. Our PDA has no key, so "even the update authority cannot change it" is
  // proven on a control collection with a keypair update authority, both ways.
  const mkCtrl=async(auth:any)=>{const c=generateSigner(umi)
    await createCollection(umi,{collection:c,name:'ctrl',uri:'u',updateAuthority:pk(ctrlUA.publicKey.toBase58()),
      plugins:[{type:'Royalties',basisPoints:1000,creators:[{address:pk(REVENUE.toBase58()),percentage:100}],
        ruleSet:ruleSet('None'),authority:auth} as any]}).sendAndConfirm(umi,{confirm:{commitment:CM}}); return c}
  const ctrlNone=await mkCtrl({type:'None'}), ctrlUa=await mkCtrl({type:'UpdateAuthority'})
  // ROUND 32 (gate 5, A22): SPEC 46's POSITIVE BOUND, MEASURED. On a collection
  // shaped like Giraffish Moments (a keypair update authority, a Royalties
  // plugin), the update authority can neither TRANSFER nor BURN a holder's asset
  // (Core: 0x1a, NoApprovals); the owner can do both.
  {
    const ml=generateSigner(umi)
    await createCollection(umi,{collection:ml,name:'Moments-shaped',uri:'u',updateAuthority:pk(momentsAuth.publicKey.toBase58()),
      plugins:[{type:'Royalties',basisPoints:500,creators:[{address:pk(momentsAuth.publicKey.toBase58()),percentage:100}],
        ruleSet:ruleSet('None')} as any]}).sendAndConfirm(umi,{confirm:{commitment:CM}})
    const piece=generateSigner(umi)
    await create(umi,{asset:piece,collection:{publicKey:ml.publicKey} as any,authority:U(momentsAuth),name:'piece',uri:'u',
      owner:pk(carol.publicKey.toBase58())}).sendAndConfirm(umi,{confirm:{commitment:CM}})
    const errText=async(f:()=>Promise<unknown>)=>{try{await f();return 'ALLOW'}catch(e:any){return `REJECT ${e?.name??''} ${e?.message??''} ${JSON.stringify(e?.logs??e?.transactionLogs??[])}`}}
    const col=await fetchCollection(umi,ml.publicKey)
    const uaX=await errText(()=>transfer(umi,{asset:{publicKey:piece.publicKey,owner:pk(carol.publicKey.toBase58())} as any,collection:{publicKey:ml.publicKey} as any,
      newOwner:pk(momentsAuth.publicKey.toBase58()),authority:U(momentsAuth),payer:U(momentsAuth)}).sendAndConfirm(umi,{confirm:{commitment:CM}}))
    const uaB=await errText(async()=>burn(umi,{asset:await fetchAsset(umi,piece.publicKey),collection:col,authority:U(momentsAuth),payer:U(momentsAuth)} as any).sendAndConfirm(umi,{confirm:{commitment:CM}}))
    const after:any=await fetchAsset(umi,piece.publicKey)
    const noApproval=(t:string)=>t.startsWith('REJECT')&&/0x1a\b|NoApprovals/.test(t)?'REJECT-0x1a':t.slice(0,60)
    rec('R32.A22a','a Moments-shaped collection\'s UPDATE AUTHORITY cannot transfer or burn a holder\'s asset (0x1a), and the holder still owns it',
      `REJECT-0x1a,REJECT-0x1a,${carol.publicKey.toBase58()}`,`${noApproval(uaX)},${noApproval(uaB)},${after.owner}`)
    const ownX=await errText(()=>transfer(umi,{asset:{publicKey:piece.publicKey,owner:pk(carol.publicKey.toBase58())} as any,collection:{publicKey:ml.publicKey} as any,
      newOwner:aliceU.publicKey,authority:U(carol),payer:U(carol)}).sendAndConfirm(umi,{confirm:{commitment:CM}}))
    const ownB=await errText(async()=>burn(umi,{asset:await fetchAsset(umi,piece.publicKey),collection:col,authority:aliceU,payer:aliceU} as any).sendAndConfirm(umi,{confirm:{commitment:CM}}))
    const tomb=await conn.getAccountInfo(toWeb3JsPublicKey(piece.publicKey),CM)
    rec('R32.A22b','CONTROL: on the same collection the OWNER transfers it and the new owner burns it, leaving the one-byte tombstone',
      'ALLOW,ALLOW,1',`${ownX.slice(0,60)},${ownB.slice(0,60)},${tomb?.data.length}`)
  }
  const upRoy=(c:any)=>updateCollectionPlugin(umi,{collection:c.publicKey,authority:U(ctrlUA),
    plugin:{type:'Royalties',basisPoints:5000,creators:[{address:pk(ctrlUA.publicKey.toBase58()),percentage:100}],ruleSet:ruleSet('None')} as any})
    .sendAndConfirm(umi,{confirm:{commitment:CM}})
  const rUpOk=await att(()=>upRoy(ctrlUa))
  rec('R.5','CONTROL: with plugin authority UpdateAuthority, the update authority CAN rewrite it','ALLOW',rUpOk.ok?'ALLOW':'REJECT',rUpOk.err)
  const rUpNone=await att(()=>upRoy(ctrlNone))
  rec('R.6','with plugin authority NONE, even the update authority cannot rewrite it','REJECT',rUpNone.ok?'ALLOW':'REJECT',rUpNone.err)
  // ⚠️ THE FIRST VERSION OF THIS ARM PASSED WITHOUT REACHING CORE: the SDK wants
  // `plugin:{type}` and threw "reading 'type'" client-side, which `att` recorded as
  // a REJECT. The control below (R.6c) proves the call is well formed, and the
  // `because` on R.6a demands Core's own error, not ours.
  const rmRoy=(c:any)=>removeCollectionPlugin(umi,{collection:c.publicKey,authority:U(ctrlUA),
    plugin:{type:'Royalties'}} as any).sendAndConfirm(umi,{confirm:{commitment:CM}})
  const rRmNone=await att(()=>rmRoy(ctrlNone))
  rec('R.6a','...nor remove it','REJECT',rRmNone.ok?'ALLOW':'REJECT',rRmNone.err)
  rec('R.6b','...and the control collection still reads 10%','1000',
    String(((await fetchCollection(umi,ctrlNone.publicKey)) as any).royalties?.basisPoints))
  const rRmUa=await att(()=>rmRoy(ctrlUa))
  rec('R.6c','CONTROL: the same removal on an UpdateAuthority-held plugin goes through','ALLOW',rRmUa.ok?'ALLOW':'REJECT',rRmUa.err)
  // AND MINT'S HAND-BUILT CORE OPCODES ARE THE SDK'S. One byte off and Core would
  // deserialize something else — or nothing.
  const MINT_SRC=readFileSync('/opt/cbob-vaults/programs/cbob-vault-mint/src/lib.rs','utf8')
  const SEAL_SRC=readFileSync('/opt/cbob-vaults/programs/cbob-vaults/src/lib.rs','utf8')
  const BURN_SRC=readFileSync('/opt/cbob-vaults/programs/cbob-vault-burn/src/lib.rs','utf8')
  const GOV_SRC=readFileSync('/opt/cbob-vaults/programs/cbob-vault-gov/src/lib.rs','utf8')
  const constU8=(src:string,name:string)=>{const m=src.match(new RegExp(`const ${name}: u8 = (\\d+);`)); return m?m[1]:'NOT FOUND'}
  rec('R.7','MINT pins Core AddCollectionPluginV1 to the SDK opcode',
    String(getAddCollectionPluginV1InstructionDataSerializer().serialize({plugin:{__kind:'Royalties',fields:[{basisPoints:0,creators:[],ruleSet:{__kind:'None'}}]} as any,initAuthority:null} as any)[0]),
    constU8(MINT_SRC,'IX_ADD_COLLECTION_PLUGIN_V1'))
  rec('R.7a','MINT pins Core UpdatePluginV1 to the SDK opcode',
    String(getUpdatePluginV1InstructionDataSerializer().serialize({plugin:{__kind:'Attributes',fields:[{attributeList:[]}]}} as any)[0]),
    constU8(MINT_SRC,'IX_UPDATE_PLUGIN_V1'))
  rec('R.7b','MINT pins Core BurnV1 to the SDK opcode',
    String(getBurnV1InstructionDataSerializer().serialize({compressionProof:null} as any)[0]),constU8(MINT_SRC,'IX_BURN_V1'))

  const ixBurnInit=(signer:Keypair,win=REDEEM_WINDOW,coll:W=COLL)=>new TransactionInstruction({programId:BURN_PROG,
    data:Buffer.concat([d('initialize'),coll.toBuffer(),i64(win)]),
    keys:[{pubkey:BURN_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},{pubkey:SEAL_CFG,isSigner:false,isWritable:false}]})
  const b0=await att(()=>send([ixBurnInit(stranger)],[stranger]))
  rec('0.3','BURN: a stranger initializes the config','REJECT',b0.ok?'ALLOW':'REJECT',b0.err)
  const bWin=await att(()=>send([ixBurnInit(deployer,REDEEM_WINDOW-1)],[deployer]))
  rec('RL.0','BURN: a redemption window below its floor','REJECT',bWin.ok?'ALLOW':'REJECT',bWin.err)
  const bColl=await att(()=>send([ixBurnInit(deployer,REDEEM_WINDOW,toWeb3JsPublicKey(foreign.publicKey))],[deployer]))
  rec('0.3b','BURN: a collection SEAL does not name (every redemption would fail for ever)','REJECT',bColl.ok?'ALLOW':'REJECT',bColl.err)
  const burn1=await att(()=>send([ixBurnInit(deployer)],[deployer]))
  rec('0.3a','BURN: INIT_AUTHORITY initializes it','ALLOW',burn1.ok?'ALLOW':'REJECT',burn1.err)
  {
    const b=(await conn.getAccountInfo(BURN_CFG,CM))!.data
    rec('RL.0a','BURN config is layout version 4 and carries the window it was given, ring empty',`4,${REDEEM_WINDOW},0,0`,
      `${b[8]},${b.readBigInt64LE(OFF_REDEEM_WINDOW)},${b[OFF_RATE_HEAD]},${b.subarray(OFF_RATE_RING,OFF_RATE_RING+8*RATE_RING).some(x=>x!==0)?1:0}`)
  }
  // GOV, BEFORE ANY VAULT: the charter vaults are its first voters.
  const ixGovInit=(signer:Keypair,quorum:number,coll:W=COLL)=>new TransactionInstruction({programId:GOV_PROG,
    data:Buffer.concat([d('initialize'),coll.toBuffer(),u16(quorum),u16(6000),i64(VOTE_SECS)]),
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},{pubkey:MINT_CFG,isSigner:false,isWritable:false}]})
  const gi0=await att(()=>send([ixGovInit(stranger,3000)],[stranger]))
  rec('7.0','GOV: a stranger initializes the config','REJECT',gi0.ok?'ALLOW':'REJECT',gi0.err)
  const gColl=await att(()=>send([ixGovInit(deployer,500,toWeb3JsPublicKey(foreign.publicKey))],[deployer]))
  rec('7.0a','GOV: a collection MINT does not mint into (no vault could ever vote)','REJECT',gColl.ok?'ALLOW':'REJECT',gColl.err)
  const qFloor=await att(()=>send([ixGovInit(deployer,1)],[deployer]))
  rec('7.12e','GOV: initialize with quorum at 1 basis point (arithmetic, not policy)','REJECT',qFloor.ok?'ALLOW':'REJECT',qFloor.err)
  // QUORUM 5% (the program floor). With a 60% threshold that is YES >= 3% of
  // supply, BELOW the 10% turnout rule, so D.1 can show the turnout rule binding.
  const gi=await att(()=>send([ixGovInit(deployer,500)],[deployer]))
  rec('7.1','governance program initialised','ALLOW',gi.ok?'ALLOW':'REJECT',gi.err)

  // THE DELETED PATHS ARE GONE, NOT MERELY GATED: an unknown discriminator answers
  // InstructionFallbackNotFound; a gated handler would answer a constraint error.
  const gone=(prog:W,name:string,keys:W[])=>att(()=>send([new TransactionInstruction({programId:prog,
    data:d(name),keys:keys.map(k=>({pubkey:k,isSigner:k.equals(deployer.publicKey),isWritable:!k.equals(deployer.publicKey)}))})],[deployer]))
  for(const [id,prog,name,keys,t] of [
    ['0.4',SEAL_PROG,'update_config',[SEAL_CFG,deployer.publicKey],'SEAL has NO update_config'],
    ['0.4a',BURN_PROG,'update_config',[BURN_CFG,deployer.publicKey],'BURN has NO update_config'],
    ['0.4b',MINT_PROG,'set_paused',[MINT_CFG,deployer.publicKey],'MINT has NO set_paused (only the guardian\'s one-way stops)'],
    ['0.4c',MINT_PROG,'apply_pending_governance',[MINT_CFG],'MINT has NO governance rotation'],
    ['0.4d',GOV_PROG,'update_gov_config',[GOV_CFG,deployer.publicKey],'GOV has NO update_gov_config'],
    ['0.4e',MINT_PROG,'handover_governance',[MINT_CFG,deployer.publicKey],'MINT has NO handover (no wallet ever held governance)'],
    ['0.4f',MINT_PROG,'commit_seed',[MINT_CFG,deployer.publicKey],'MINT has NO commit_seed (there is no deck)'],
    ['0.4g',MINT_PROG,'commit_deck',[MINT_CFG,deployer.publicKey,SLOT_HASHES],'MINT has NO commit_deck'],
    ['0.4h',MINT_PROG,'set_collection_royalties',[MINT_CFG,deployer.publicKey,COLL],'MINT has NO set_collection_royalties (the rate is fixed)'],
    ['0.4i',MINT_PROG,'update_wiring',[MINT_CFG,deployer.publicKey],'MINT has NO update_wiring (split, both destinations and max_supply are permanent)'],
  ] as [string,W,string,W[],string][]){
    const g=await gone(prog,name,keys); rec(id,t,'REJECT',g.ok?'ALLOW':'REJECT',g.err) }

  // ── helpers: vaults, redemption ──
  type V={asset:W,kp:Keypair,umiAsset:any,pdaU:any,pda:W,owner:Keypair,charter?:boolean,attrs:[string,string][]}
  const VAULTS:V[]=[]
  const mkV=(kp:Keypair,owner:Keypair,attrsList:[string,string][],charter=false):V=>{
    const [pdaU]=findAssetSignerPda(umi,{asset:pk(kp.publicKey.toBase58())})
    const v={asset:kp.publicKey,kp,umiAsset:pk(kp.publicKey.toBase58()),pdaU,pda:toWeb3JsPublicKey(pdaU),owner,charter,attrs:attrsList}
    VAULTS.push(v); return v}
  const fund=async(v:V,tokens:bigint)=>{ if(tokens>0n) await sendAndConfirmTransaction(conn,new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,ata(v.pda),v.pda,mint),
    createTransferInstruction(ata(deployer.publicKey),ata(v.pda),deployer.publicKey,tokens)),[deployer],{commitment:CM}) }
  // THE OPPORTUNISTIC CRANK: [SlotHashes, queued records...] after the fixed accounts.
  const crankKeys=(assets:W[]|undefined)=>assets&&assets.length?[{pubkey:SLOT_HASHES,isSigner:false,isWritable:false},
    ...assets.map(a=>({pubkey:vrec(a),isSigner:false,isWritable:true}))]:[]
  const ixMint=(asset:W,owner:W,payer:W,o:any={})=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('mint_vault'),str(o.name??'CBOBTC Vault'),str('https://cdn.gary.club/cbob/v.json'),
      u64(o.maxPrice??PRICE),attrs(o.attrs??[])]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:vrec(asset),isSigner:false,isWritable:true},
      {pubkey:asset,isSigner:true,isWritable:true},{pubkey:COLL,isSigner:false,isWritable:true},
      {pubkey:owner,isSigner:o.ownerSigns??true,isWritable:false},{pubkey:payer,isSigner:true,isWritable:true},
      {pubkey:o.payerToken??ata(payer),isSigner:false,isWritable:true},{pubkey:o.payMint??mint,isSigner:false,isWritable:false},
      {pubkey:o.revToken??revAta,isSigner:false,isWritable:true},{pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},
      {pubkey:SEAL_CFG,isSigner:false,isWritable:false},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
      {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
      POOLK,...crankKeys(o.crank)]})
  /** A paid mint: alice pays the round price in cbBTC and owns the vault. */
  const mkVault=async(tokens=SATS,prov:[string,string][]=[])=>{
    const kp=Keypair.generate()
    await send([ixMint(kp.publicKey,alice.publicKey,alice.publicKey,{attrs:prov})],[alice,kp])
    const v=mkV(kp,alice,prov); await fund(v,tokens); return v}
  const ixClaim=(asset:W,owner:W,payer:W,pob:W,proof:Buffer[],o:any={})=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('claim_charter_vault'),str('CBOBTC Charter Vault'),str('https://cdn.gary.club/cbob/v.json'),
      attrs(o.attrs??[]),proofBuf(proof),u8b(o.pobExtra??(o.extra?.length??0))]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:vrec(asset),isSigner:false,isWritable:true},
      {pubkey:asset,isSigner:true,isWritable:true},{pubkey:COLL,isSigner:false,isWritable:true},
      {pubkey:owner,isSigner:true,isWritable:false},{pubkey:payer,isSigner:true,isWritable:true},
      {pubkey:pob,isSigner:false,isWritable:true},{pubkey:o.pobColl??MOMENTS,isSigner:false,isWritable:true},
      {pubkey:SEAL_CFG,isSigner:false,isWritable:false},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
      {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
      POOLK,...(o.extra??[]).map((k:W)=>({pubkey:k,isSigner:false,isWritable:false})),...crankKeys(o.crank)]})
  const claim=async(owner:Keypair,i:number,o:any={})=>{const kp=Keypair.generate()
    await send([...crankCU(o),ixClaim(kp.publicKey,owner.publicKey,owner.publicKey,o.pob??POB[i],o.proof??pobProofFor(i),o)],[owner,kp])
    return mkV(kp,owner,[...(o.attrs??[]),['charter',(o.pob??POB[i]).toBase58()]],true)}
  const OWNER_WRAP=new W(Uint8Array.from(JSON.parse(readFileSync('/opt/cbob-vaults/.cache/cpi-wrapper/cbob_test_cpi_wrapper-keypair.json','utf8')).slice(32)))
  const [CPI_OWNER]=W.findProgramAddressSync([Buffer.from('owner')],OWNER_WRAP)
  const signedOwnerIx=(ix:TransactionInstruction)=>new TransactionInstruction({programId:OWNER_WRAP,
    data:Buffer.concat([Buffer.from('PDASIGN!'),ix.data]),keys:[{pubkey:ix.programId,isSigner:false,isWritable:false},
      ...ix.keys.map(k=>({...k,isSigner:k.pubkey.equals(CPI_OWNER)?false:k.isSigner}))]})
  const returnFromPda=async(asset:W,collection:W,to:W)=>{
    const ixs=transfer(umi,{asset:{publicKey:pk(asset.toBase58()),owner:pk(CPI_OWNER.toBase58())} as any,
      collection:{publicKey:pk(collection.toBase58())} as any,newOwner:pk(to.toBase58()),
      authority:createNoopSigner(pk(CPI_OWNER.toBase58())),payer:aliceU}).getInstructions()
      .map(i=>new TransactionInstruction({programId:toWeb3JsPublicKey(i.programId),data:Buffer.from(i.data),
        keys:i.keys.map(k=>({pubkey:toWeb3JsPublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable}))}))
    await send(ixs.map(signedOwnerIx),[alice])
  }
  const ixOpen=(v:any,o:W,payer:W=o)=>new TransactionInstruction({programId:SEAL_PROG,data:Buffer.from(d('open_for_redemption')),keys:[
    {pubkey:v.asset,isSigner:false,isWritable:true},{pubkey:COLL,isSigner:false,isWritable:true},
    {pubkey:o,isSigner:true,isWritable:false},
    {pubkey:payer,isSigner:true,isWritable:true},{pubkey:SEAL_CFG,isSigner:false,isWritable:false},
    {pubkey:SEAL,isSigner:false,isWritable:false},{pubkey:CORE,isSigner:false,isWritable:false},
    {pubkey:SYSVAR_INSTRUCTIONS_PUBKEY,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const ixBurn=(v:any,o:W,extra:W[]=[],payer:W=o)=>new TransactionInstruction({programId:BURN_PROG,
    data:Buffer.concat([d('burn_vault'),Buffer.from([extra.length])]),keys:[
    {pubkey:v.asset,isSigner:false,isWritable:true},{pubkey:COLL,isSigner:false,isWritable:true},
    {pubkey:o,isSigner:true,isWritable:false},
    {pubkey:v.pda,isSigner:false,isWritable:true},{pubkey:payer,isSigner:true,isWritable:true},
    {pubkey:BURN_CFG,isSigner:false,isWritable:true},{pubkey:SEAL_CFG,isSigner:false,isWritable:false},
    {pubkey:SYSVAR_INSTRUCTIONS_PUBKEY,isSigner:false,isWritable:false},
    {pubkey:CORE,isSigner:false,isWritable:false},
    {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
    // v6 stage 3: BURN retires the vault in MINT by CPI, in the same instruction.
    {pubkey:MINT_PROG,isSigner:false,isWritable:false},{pubkey:MINT_CFG,isSigner:false,isWritable:true},
    {pubkey:vrec(v.asset),isSigner:false,isWritable:true},POOLK,
    ...extra.map(p=>({pubkey:p,isSigner:false,isWritable:true}))]})
  const sweep=(v:V,amt:bigint,lam:number,close=true,to:Keypair=v.owner)=>{
    const ixs:any[]=[]
    if(amt>0n){ ixs.push(fromWeb3JsInstruction(createTransferInstruction(ata(v.pda),ata(to.publicKey),v.pda,amt)))
      if(close) ixs.push(fromWeb3JsInstruction(createCloseAccountInstruction(ata(v.pda),to.publicKey,v.pda))) }
    if(lam>0) ixs.push(fromWeb3JsInstruction(SystemProgram.transfer({fromPubkey:v.pda,toPubkey:to.publicKey,lamports:lam})))
    return execute(umi,{asset:{publicKey:v.umiAsset},collection:{publicKey:coll.publicKey} as any,instructions:ixs,
      signers:[createNoopSigner(v.pdaU)],authority:U(v.owner),payer:U(v.owner)}).getInstructions().map(i=>new TransactionInstruction({
        programId:toWeb3JsPublicKey(i.programId),data:Buffer.from(i.data),
        keys:i.keys.map(k=>({pubkey:toWeb3JsPublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable}))}))
  }

  // ── helpers: the community pool ──
  const ixActivate=(v:{asset:W,pda:W},o:any={})=>new TransactionInstruction({programId:MINT_PROG,data:d('activate'),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:vrec(v.asset),isSigner:false,isWritable:true},
      {pubkey:o.asset??v.asset,isSigner:false,isWritable:false},{pubkey:o.token??ata(v.pda),isSigner:false,isWritable:false},
      POOLK,...crankKeys(o.crank)]})
  /** distribute(burn). The burn path appends [burner, burner's $GARY account,
   *  $GARY mint, token program]; each can be swapped out to test a refusal. */
  const ixDistribute=(o:{burn?:boolean,pool?:W,burner?:W,from?:W,gmint?:W,tprog?:W}={})=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('distribute'),u8b(o.burn?1:0)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:o.pool??POOL,isSigner:false,isWritable:false},
      ...(o.burn?[{pubkey:o.burner!,isSigner:true,isWritable:false},
        {pubkey:o.from??getAssociatedTokenAddressSync(o.gmint??GARY_MINT,o.burner!,true),isSigner:false,isWritable:true},
        {pubkey:o.gmint??GARY_MINT,isSigner:false,isWritable:true},{pubkey:o.tprog??TOKEN_PROGRAM_ID,isSigner:false,isWritable:false}]:[])]})
  const burnBy=(k:Keypair)=>({burn:true,burner:k.publicKey})
  const garyAta=(k:W)=>getAssociatedTokenAddressSync(GARY_MINT,k,true)
  const garySupply=async()=>(await conn.getAccountInfo(GARY_MINT,CM))!.data.readBigUInt64LE(36)
  // $GARY for the burn path: alice holds plenty, bob holds 99.999 (one short).
  await send([createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,garyAta(alice.publicKey),alice.publicKey,GARY_MINT),
    createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,garyAta(bob.publicKey),bob.publicKey,GARY_MINT),
    createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,garyAta(deployer.publicKey),deployer.publicKey,GARY_MINT)],[deployer])
  await mintTo(conn,deployer,GARY_MINT,garyAta(alice.publicKey),deployer,100n*DIST_BURN,[],{commitment:CM})
  await mintTo(conn,deployer,GARY_MINT,garyAta(bob.publicKey),deployer,DIST_BURN-1_000_000n,[],{commitment:CM})
  /** Sleep until the free / in-line distribution is due on the CHAIN clock. */
  const waitDue=async()=>{for(let i=0;i<400;i++){const c=await cfg()
    if((await chainNow())>=c.readBigInt64LE(OFF_LAST_DIST)+c.readBigInt64LE(OFF_MONTHLY)) return; await sleep(1000)}
    throw new Error('the distribution never became due')}
  const sigLogs=async(sig:string)=>(await logsOf(sig)).logs.filter(l=>l.includes('CBOB_DISTRIBUTED'))
  /** Batched claim: pairs of (vault, destination). Destination defaults to the
   *  vault's own cbBTC account, the only one the program will pay. */
  const ixPoolClaim=(vs:{asset:W,pda:W,dest?:W}[],o:any={})=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('claim'),u8b(o.crank?.length??0)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:o.pool??POOL,isSigner:false,isWritable:true},
      {pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},...crankKeys(o.crank),
      ...vs.flatMap(v=>[{pubkey:vrec(v.asset),isSigner:false,isWritable:true},{pubkey:v.dest??ata(v.pda),isSigner:false,isWritable:true}])]})
  const ixRetireBurned=(rec:W,asset:W)=>new TransactionInstruction({programId:MINT_PROG,data:d('retire_burned'),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:vrec(rec),isSigner:false,isWritable:true},
      {pubkey:asset,isSigner:false,isWritable:false}]})
  const ixReschedule=(asset:W)=>new TransactionInstruction({programId:MINT_PROG,data:d('reschedule_reveal'),
    keys:[{pubkey:vrec(asset),isSigner:false,isWritable:true}]})
  await send([createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,POOL,MINT_CFG,mint)],[deployer])
  const pool=async()=>{const c=await cfg(); const bal=await tokBal(POOL); const owed=u128le(c,OFF_OWED)
    const owedCeil=(owed+ACC_SCALE-1n)/ACC_SCALE
    return {bal,owed,owedCeil,avail:bal-owedCeil,acc:u128le(c,OFF_ACC),w:c.readBigUInt64LE(OFF_TOTAL_WEIGHT),
      active:c.readBigUInt64LE(OFF_ACTIVE_COUNT),bare:c.readBigUInt64LE(OFF_BARE_RETIRED)}}
  const pendingOf=async(asset:W)=>{const r=(await recOf(asset))!; if(!r[OFF_REC_ACTIVE]) return 0n
    const p=await pool(); return ((WEIGHTS[r[OFF_REC_LEVEL]-1]+BigInt(r[OFF_REC_BOOST_W]))*p.acc+u128le(r,OFF_REC_CARRY)-u128le(r,OFF_REC_DEBT))}
  /** ROUND 25 (round-24 C9): THE BOOKS, outside section BO. Section BO's `books()`
   *  plus one more leg: the pool's `owed` is EXACTLY the sum of every live
   *  record's `weight x acc + carry - debt` (each share owed once, none lost).
   *  Recomputed from every record after each money operation in sections IN, 3c
   *  and P; `ck` records the label only when every leg holds. */
  const ledger=async()=>{const c=await cfg(); const p=await pool(); let w=0n, bw=0n, n=0, owed=0n
    const seen=new Set<string>(), vs=VAULTS.filter(v=>!seen.has(v.asset.toBase58())&&!!seen.add(v.asset.toBase58()))
    for(let i=0;i<vs.length;i+=100){ const infos=await conn.getMultipleAccountsInfo(vs.slice(i,i+100).map(v=>vrec(v.asset)),CM)
      for(const a of infos){ const r=a?.data; if(!r||!r[OFF_REC_ACTIVE]||r[OFF_REC_RETIRED]) continue
        const wt=WEIGHTS[r[OFF_REC_LEVEL]-1]+BigInt(r[OFF_REC_BOOST_W]); w+=wt; bw+=BigInt(r[OFF_REC_BOOST_W]); if(r[OFF_REC_BOOST_W]) n++
        owed+=wt*p.acc+u128le(r,OFF_REC_CARRY)-u128le(r,OFF_REC_DEBT) } }
    let ring=0; for(let i=0;i<BOOST_RING;i++) ring+=c.readUInt32LE(OFF_BOOST_RING+4*i)
    const active=c.readUInt32LE(OFF_BOOSTS_ACTIVE), due=c.readUInt32LE(OFF_BOOSTS_DUE)
    return p.w===w&&c.readBigUInt64LE(OFF_BOOST_W_TOTAL)===bw&&active===n&&ring+due===active&&p.bal>=p.owedCeil&&p.owed===owed}
  const BK:Record<string,string[]>={IN:[],'3c':[],P:[]}
  const ck=async(sec:string,label:string)=>{ if(await ledger()) BK[sec].push(label); else console.log(`  !! the books did NOT balance after ${label}`) }
  const logsOf=async(sig:string)=>{for(let i=0;i<20;i++){const t=await conn.getTransaction(sig,{commitment:CM,maxSupportedTransactionVersion:0})
    if(t?.meta) return {logs:t.meta.logMessages||[],slot:t.slot}; await sleep(250)} return {logs:[] as string[],slot:0}}

  // ── helpers: the level draw ──
  const recOf=async(asset:W)=>(await conn.getAccountInfo(vrec(asset),CM))?.data
  const ixCapture=(asset:W)=>new TransactionInstruction({programId:MINT_PROG,data:d('capture_entropy'),
    keys:[{pubkey:vrec(asset),isSigner:false,isWritable:true},{pubkey:SLOT_HASHES,isSigner:false,isWritable:false}]})
  const ixReveal=(asset:W,list:[string,string][],payer:W=deployer.publicKey)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('reveal_level'),attrs(list)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:vrec(asset),isSigner:false,isWritable:true},
      {pubkey:asset,isSigner:false,isWritable:true},{pubkey:COLL,isSigner:false,isWritable:true},
      {pubkey:payer,isSigner:true,isWritable:true},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
      {pubkey:SLOT_HASHES,isSigner:false,isWritable:false},{pubkey:CORE,isSigner:false,isWritable:false},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const waitSlotPast=async(s:number)=>{for(let i=0;i<2000&&await conn.getSlot(CM)<=s;i++) await sleep(200)}
  /** STAGE 3: the draw needs THREE slot hashes, each two leader groups (8 slots)
   *  past the last, so entropy is ready only once the third exists. A local
   *  validator skips no slots, so this is exact here. */
  const readySlot=(rs:number)=>{let a=rs; for(let i=0;i<2;i++) a=(Math.floor(a/4)+2)*4; return a}
  const waitEntropy=async(asset:W)=>waitSlotPast(readySlot(Number((await recOf(asset))!.readBigUInt64LE(OFF_REC_REVEAL))))
  /** Reveal every pending vault, IN MINT ORDER, the way a crank would. */
  const revealAll=async()=>{
    for(;;){
      const c=await cfg(); const next=Number(c.readBigUInt64LE(OFF_REVEALED)), minted=Number(c.readBigUInt64LE(OFF_MINTED_TOTAL))
      if(next>=minted) return
      let v:V|undefined
      for(const x of VAULTS){const r=await recOf(x.asset); if(r&&Number(r.readBigUInt64LE(OFF_REC_INDEX))===next){v=x;break}}
      if(!v) throw new Error(`no known vault at mint index ${next}`)
      await readyToReveal(v)
      await send([ixReveal(v.asset,v.attrs)],[deployer])
    }
  }
  /** Get a vault's entropy onto its record the way a crank would: capture inside
   *  the window, RESCHEDULE a missed one (never default it), then capture. */
  async function readyToReveal(v:{asset:W}){
    for(let tries=0;tries<4;tries++){
      const r=(await recOf(v.asset))!; if(r[OFF_REC_SET]) return
      const rs=Number(r.readBigUInt64LE(OFF_REC_REVEAL))
      await waitSlotPast(readySlot(rs))
      if(await conn.getSlot(CM)>rs+REVEAL_WINDOW){ await send([ixReschedule(v.asset)],[deployer]); continue }
      const c=await att(()=>send([ixCapture(v.asset)],[deployer])); if(c.ok) return
    }
    throw new Error(`could not capture entropy for ${v.asset.toBase58()}`)
  }
  /** The draw, re-implemented independently: r = u64le(entropy[0..8]) mod remaining. */
  const drawOf=(entropy:Buffer,caps:number[],minted:number[])=>{
    const rem=caps.map((c,i)=>c-minted[i]); const total=rem.reduce((a,b)=>a+b,0)
    let x=entropy.readBigUInt64LE(0)%BigInt(total)
    for(let i=0;i<5;i++){ if(x<BigInt(rem[i])) return i+1; x-=BigInt(rem[i]) } return -1 }
  const census=async()=>{const c=await cfg()
    return {caps:[0,1,2,3,4].map(i=>c.readUInt32LE(OFF_LEVEL_CAPS+4*i)),minted:[0,1,2,3,4].map(i=>c.readUInt32LE(OFF_LEVEL_MINTED+4*i))}}

  // ════════════════════ C. THE CHARTER CLAIM ════════════════════
  console.log('\n─── C. the charter claim: one Proof of Burn in, one vault out, inside one window ───')
  const cEarly=await att(()=>claim(alice,0))
  rec('C.1','a charter claim BEFORE the window opens','REJECT',cEarly.ok?'ALLOW':'REJECT',cEarly.err)
  // There is no round, and a wallet cannot become one: governance is a PDA.
  const ixSetRoundDirect=(signer:Keypair)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('set_round'),i64(t0-60),i64(t0+3600),u64(PRICE),u32(10)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false}]})
  const g1=await att(()=>send([ixSetRoundDirect(deployer)],[deployer]))
  rec('1.1','the INIT_AUTHORITY sets a round directly','REJECT',g1.ok?'ALLOW':'REJECT',g1.err)
  const noRound=await att(()=>mkVault(0n))
  rec('C.1a','a paid mint before any round was ever voted','REJECT',noRound.ok?'ALLOW':'REJECT',noRound.err)
  console.log(`  (waiting ${Math.max(0,CHARTER_OPENS-Math.floor(Date.now()/1000))}s for the charter window to open)`)
  while(Math.floor(Date.now()/1000)<=CHARTER_OPENS+1) await sleep(500)

  const C1=await claim(alice,0)
  rec('C.2','alice burns PoB #1 and claims a charter vault, ALONE, at price 0','true',String(!!C1))
  {
    const p=await conn.getAccountInfo(POB[0],CM)
    rec('C.3','...and the Proof of Burn is BURNED, identified positively (Core, 1 byte, key 0)',
      'core,1,0',`${p?.owner.equals(CORE)?'core':p?.owner.toBase58()},${p?.data.length},${p?.data[0]}`)
    const a:any=await fetchAsset(umi,C1.umiAsset)
    rec('C.4','the vault is in the CBOB collection, owned by the PoB holder',alice.publicKey.toBase58(),String(a.owner))
    rec('C.4a','...stamped with the SPENT PoB\'s address, by the program',POB[0].toBase58(),String(attrMap(a).charter))
    rec('C.4b','...and with NO level yet: it is drawn after the mint, not at it','undefined',String(attrMap(a).level))
    const r=(await recOf(C1.asset))!
    rec('C.5','its record: charter, mint index 0, level not drawn','1,0,0',
      `${r[OFF_REC_CHARTER]},${r.readBigUInt64LE(OFF_REC_INDEX)},${r[OFF_REC_LEVEL]}`)
    const c=await cfg()
    rec('C.6','charter_claimed and minted_total both 1','1,1',`${c.readUInt32LE(OFF_CHARTER_CLAIMED)},${c.readBigUInt64LE(OFF_MINTED_TOTAL)}`)
    rec('2.3','seal plugin authority is the SEAL program PDA',SEAL.toBase58(),String(a.permanentFreezeExecute?.authority?.address))
    rec('2.3a','the seal plugin decodes FROZEN, not merely present','true',String(a.permanentFreezeExecute?.frozen===true))
    rec('2.4','no permanent transfer delegate','true',String(!a.permanentTransferDelegate))
  }
  // ═══ RT1.1. THE RED-TEAM ATTACK, VERBATIM: the FIRST charter vault opens a
  // proposal alone. Before stage 3b its quorum was one, every later vault was
  // VaultTooNew, and it carried the vote. Now nothing is proposed in the window.
  {
    const gc=(await conn.getAccountInfo(GOV_CFG,CM))!.data; const id=Number(gc.readBigUInt64LE(53))+1
    const pid=W.findProgramAddressSync([Buffer.from('proposal'),u64(id)],GOV_PROG)[0]
    const nowS=Math.floor(Date.now()/1000)
    const act=Buffer.concat([u8b(0),i64(nowS-60),i64(nowS+6*3600),u64(PRICE),u32(100)])
    const rt=await att(()=>send([new TransactionInstruction({programId:GOV_PROG,
      data:Buffer.concat([d('create_proposal'),u32(1),act,i64(nowS+VOTE_SECS+5)]),
      keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:true},{pubkey:pid,isSigner:false,isWritable:true},
        {pubkey:MINT_CFG,isSigner:false,isWritable:false},{pubkey:BURN_CFG,isSigner:false,isWritable:false},
        {pubkey:C1.asset,isSigner:false,isWritable:false},{pubkey:alice.publicKey,isSigner:true,isWritable:true},
        {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[alice]))
    rec('RT1.1','the FIRST charter vault, alone, opens a proposal inside the charter window (red-team 1 finding 1)','REJECT',
      rt.ok?'ALLOW':'REJECT',rt.err)
  }
  const cAgain=await att(()=>claim(alice,0))
  rec('C.7','the SAME Proof of Burn again (it is burned)','REJECT',cAgain.ok?'ALLOW':'REJECT',cAgain.err)
  // THE LOOKALIKE: same collection, same name pattern, minted by the same hot
  // update authority. On mainnet that key could do this tomorrow. Identity by
  // ADDRESS is what refuses it.
  const cLook=await att(()=>claim(alice,0,{pob:LOOKALIKE,proof:pobProofFor(1)}))
  rec('C.8','a LOOKALIKE "Proof of Burn #241" from the same collection and authority','REJECT',cLook.ok?'ALLOW':'REJECT',cLook.err)
  const cTheft=await att(()=>claim(bob,1))
  rec('C.9','bob claims with ALICE\'s Proof of Burn','REJECT',cTheft.ok?'ALLOW':'REJECT',cTheft.err)
  const cVault=await att(()=>claim(alice,1,{pob:C1.asset,pobColl:COLL}))
  rec('C.10','a CBOB vault offered as a Proof of Burn','REJECT',cVault.ok?'ALLOW':'REJECT',cVault.err)
  const cRes=await att(()=>claim(alice,1,{attrs:[['charter','forged']]}))
  rec('C.11','a caller that writes its OWN charter attribute','REJECT',cRes.ok?'ALLOW':'REJECT',cRes.err)
  const cWrongProof=await att(()=>claim(alice,1,{proof:pobProofFor(2)}))
  rec('C.12','a real PoB with ANOTHER PoB\'s proof','REJECT',cWrongProof.ok?'ALLOW':'REJECT',cWrongProof.err)

  // ═══ 6c. THE GUARDIAN: it can STOP, and that is ALL it can do ═══
  console.log('\n─── 6c. the guardian: one-way stops; the charter is out of its reach ───')
  const ixStop=(what:'sales'|'sweep',signer:Keypair)=>new TransactionInstruction({programId:MINT_PROG,
    data:d(what==='sales'?'emergency_stop_sales':'emergency_stop_sweep'),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false}]})
  const ixGovSigned=(data:Buffer,signer:Keypair)=>new TransactionInstruction({programId:MINT_PROG,data,
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false}]})
  /** Stage 3c: the guardian's third stop, cancelling a PENDING swap operator. */
  const ixStopCancel=(signer:Keypair)=>new TransactionInstruction({programId:MINT_PROG,data:d('cancel_swap_operator'),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false}]})
  /** Stage 3c: anyone lands a pending guardian / swap operator once the notice has run. */
  const ixApply=(what:'guardian'|'swap_operator')=>new TransactionInstruction({programId:MINT_PROG,data:d(`apply_${what}`),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true}]})
  /** Wait out the notice from a pending stamp, on the CHAIN clock. */
  const waitNotice=async(offAt:number)=>{for(let i=0;i<200;i++){const c=await cfg()
    if((await chainNow())>=c.readBigInt64LE(offAt)+BigInt(NOTICE)) return; await sleep(1000)}
    throw new Error('the notice never ran')}
  const gs0=await att(()=>send([ixStop('sales',alice)],[alice]))
  rec('6c.1','a STRANGER pulls the sales brake','REJECT',gs0.ok?'ALLOW':'REJECT',gs0.err)
  const gs1=await att(()=>send([ixStop('sales',guardian)],[guardian]))
  rec('6c.3','the GUARDIAN stops sales, immediately, alone','ALLOW',gs1.ok?'ALLOW':'REJECT',gs1.err)
  rec('6c.4','...and the sales flag is set, the sweep flag is not','1,0',await stops())
  const gm=await att(()=>mkVault(0n))
  rec('6c.5','a paid mint while sales are stopped','REJECT',gm.ok?'ALLOW':'REJECT',gm.err)
  // THE RULING: the brake cannot cost a charter member their claim.
  // Same charter fixture and census; temporarily exercise an off-curve owner.
  await transfer(umi,{asset:{publicKey:pk(POB[1].toBase58()),owner:aliceU.publicKey} as any,
    collection:{publicKey:moments.publicKey} as any,newOwner:pk(CPI_OWNER.toBase58()),authority:aliceU,payer:aliceU})
    .sendAndConfirm(umi,{confirm:{commitment:CM}})
  const cpiKp=Keypair.generate()
  const stoppedCharterBefore=(await cfg()).readUInt32LE(OFF_CHARTER_CLAIMED)
  const cpiClaim=await att(()=>send([cuLim(400_000),signedOwnerIx(ixClaim(cpiKp.publicKey,CPI_OWNER,alice.publicKey,POB[1],pobProofFor(1)))],[alice,cpiKp]))
  rec('R27.C1','a program-owned Proof of Burn claims through its owner program invoke_signed with a separate payer','ALLOW',cpiClaim.ok?'ALLOW':'REJECT',cpiClaim.err)
  rec('R27.C2','the claimed vault belongs to that off-curve owner and the Proof of Burn is consumed',`${CPI_OWNER.toBase58()},0`,
    `${String((await fetchAsset(umi,pk(cpiKp.publicKey.toBase58()))).owner)},${(await conn.getAccountInfo(POB[1],CM))?.data[0]}`)
  await returnFromPda(cpiKp.publicKey,COLL,alice.publicKey)
  const C2=mkV(cpiKp,alice,[['charter',POB[1].toBase58()]],true)
  const stoppedCharterAfter=await cfg()
  rec('C.13','the claim increments the charter count once while the sales stop remains set',
    `1,${stoppedCharterBefore+1}`,`${stoppedCharterAfter[OFF_SALES_STOPPED]},${stoppedCharterAfter.readUInt32LE(OFF_CHARTER_CLAIMED)}`)
  const gs2=await att(()=>send([ixStop('sweep',guardian)],[guardian]))
  rec('6c.6','the GUARDIAN stops the SOL sweep (the stolen-operator-key answer)','ALLOW',gs2.ok?'ALLOW':'REJECT',gs2.err)
  const gr0=await att(()=>send([ixGovSigned(Buffer.concat([d('restart'),Buffer.from([1,1]),i64(Math.floor(Date.now()/1000))]),guardian)],[guardian]))
  rec('6c.8','the GUARDIAN tries to restart (it cannot turn anything back on)','REJECT',gr0.ok?'ALLOW':'REJECT',gr0.err)
  const gg0=await att(()=>send([ixGovSigned(Buffer.concat([d('arm_guardian'),SOME(alice.publicKey.toBuffer())]),guardian)],[guardian]))
  rec('6c.9','the GUARDIAN tries to hand the brake to someone else','REJECT',gg0.ok?'ALLOW':'REJECT',gg0.err)
  const gc0=await att(()=>send([ixStopCancel(guardian)],[guardian]))
  rec('3c.K0','the GUARDIAN cancels a pending swap operator when NONE is pending','REJECT',gc0.ok?'ALLOW':'REJECT',gc0.err)
  const gw0=await att(()=>send([ixGovSigned(tighten({sweepCooldown:7200}),guardian)],[guardian]))
  rec('6c.10','the GUARDIAN tries to change the sweep bounds','REJECT',gw0.ok?'ALLOW':'REJECT',gw0.err)
  const gw1=await att(()=>send([ixGovSigned(armOp(guardian.publicKey),guardian)],[guardian]))
  rec('6c.10b','the GUARDIAN tries to arm itself as the swap operator','REJECT',gw1.ok?'ALLOW':'REJECT',gw1.err)
  rec('6c.10a','...and after all of that both stops are still set','1,1',await stops())
  // ═══ OR. AN EXTERNAL PLUGIN ON THE PROOF OF BURN COLLECTION (red-team 2 #1) ═══
  // The Giraffish Moments update authority is a HOT wallet and stays one (Gary:
  // "we keep it and it will stay secure"). It can add an Oracle plugin that Core
  // consults on every burn, and Core then refuses a burn that does not carry the
  // oracle's account. Stage 3b's claim passed none, so ANY such plugin, even a
  // benign one, stopped every charter claim until a window nobody can reopen
  // closed. The claim now passes them through, never as signers.
  console.log('\n─── OR. a Core Oracle on the Proof of Burn collection: passed through, never trusted ───')
  const addOracle=(base:W)=>addCollectionPlugin(umi,{collection:moments.publicKey,authority:U(momentsAuth),
    plugin:{type:'Oracle',baseAddress:pk(base.toBase58()),lifecycleChecks:{burn:[CheckResult.CAN_REJECT]},
      resultsOffset:{type:'NoOffset'}} as any}).sendAndConfirm(umi,{confirm:{commitment:CM}})
  const dropOracle=(base:W)=>removeCollectionPlugin(umi,{collection:moments.publicKey,authority:U(momentsAuth),
    plugin:{type:'Oracle',baseAddress:pk(base.toBase58())} as any}).sendAndConfirm(umi,{confirm:{commitment:CM}})
  const orAdd=await att(()=>addOracle(ORACLE_OK))
  rec('OR.1','the Moments hot wallet adds an Oracle that APPROVES burns (a benign hook)','ALLOW',orAdd.ok?'ALLOW':'REJECT',orAdd.err)
  const orBare=await att(()=>claim(alice,2))
  rec('OR.2','a charter claim that does NOT pass the oracle\'s account (stage 3b had no way to)','REJECT',orBare.ok?'ALLOW':'REJECT',orBare.err)
  const orShort=await att(()=>claim(alice,2,{pobExtra:3,extra:[ORACLE_OK]}))
  rec('OR.3','pob_extra claims more pass-through accounts than the transaction carries','REJECT',orShort.ok?'ALLOW':'REJECT',orShort.err)
  let C3:any=null
  const orOk=await att(async()=>{ C3=await claim(alice,2,{extra:[ORACLE_OK]}) })
  rec('OR.4','...the same claim PASSING it through lands: PoB burned, vault minted','ALLOW,1',
    `${orOk.ok?'ALLOW':'REJECT'},${(await conn.getAccountInfo(POB[2],CM))?.data.length}`,orOk.err)
  // THE RULED LIMIT: a hook that REJECTS still refuses. Gary kept the authority
  // hot; what covers a hostile one is the alarm on any plugin change to F9TDm35J.
  const orNo=await att(()=>addOracle(ORACLE_NO))
  const orRej=await att(()=>claim(alice,3,{extra:[ORACLE_OK,ORACLE_NO]}))
  rec('OR.5','a SECOND oracle that REJECTS burns: passing it through does not make Core approve (the ruled limit; the alarm covers it)',
    'ALLOW,REJECT',`${orNo.ok?'ALLOW':'REJECT'},${orRej.ok?'ALLOW':'REJECT'}`,`${orNo.err} ${orRej.err}`)
  rec('OR.5!','  ...refused by CORE (the rejecting oracle), not by our program','true',String(orRej.err.includes('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d failed')))
  const orClean=await att(async()=>{ await dropOracle(ORACLE_NO); await dropOracle(ORACLE_OK) })
  rec('OR.6','...both plugins removed; the collection is back to how mainnet holds it today','ALLOW',orClean.ok?'ALLOW':'REJECT',orClean.err)
  const C4=await claim(alice,3), C5=await claim(bob,4)
  // THE CRANK RIDES ON A CHARTER CLAIM (stage 3): carol's claim captures C4's
  // entropy on its way past, so ordinary traffic keeps the queue moving.
  await waitEntropy(C4.asset)
  const C6=await claim(carol,5,{crank:[C4.asset]})
  rec('K.1','a CHARTER CLAIM captures a queued vault\'s entropy on its way past','1',String((await recOf(C4.asset))![OFF_REC_SET]))
  rec('C.14','six charter vaults exist, claimed by three holders','6',String((await cfg()).readUInt32LE(OFF_CHARTER_CLAIMED)))
  // "IT TOUCHES NOTHING A HOLDER OWNS." Both stops set; bob funds his charter vault
  // and takes the whole Bitcoin back out, alone. (C5 is redeemed BEFORE its level
  // is drawn — L.11 proves the draw survives that.)
  await fund(C5,SATS)
  const bobBefore=await tokBal(ata(bob.publicKey))
  const gRedeem=await att(()=>send([ixOpen(C5,bob.publicKey),...sweep(C5,SATS,0),ixBurn(C5,bob.publicKey,declare(C5.pda))],[bob]))
  rec('6c.11','REDEMPTION by the owner alone while BOTH stops are set','ALLOW',gRedeem.ok?'ALLOW':'REJECT',gRedeem.err)
  rec('6c.11a','...and the owner got the whole Bitcoin out',String(SATS),String(await tokBal(ata(bob.publicKey))-bobBefore))
  const rogue=generateSigner(umi)
  const r=await att(()=>create(umi,{asset:rogue,name:'ROGUE',uri:'u',owner:aliceU.publicKey,
    collection:{publicKey:coll.publicKey,oracles:[],lifecycleHooks:[]} as any,plugins:[]}).sendAndConfirm(umi,{confirm:{commitment:CM}}))
  rec('2.5','a direct mint into the collection','REJECT',r.ok?'ALLOW':'REJECT',r.err)
  // A VAULT CANNOT GROW ITS OWN ROYALTY. Asset-level Royalties OVERRIDES the
  // collection's, so an owner who could add one could reprice every resale of
  // their vault. Core reserves it to the update authority, our PDA.
  const ownRoy=await att(()=>addPlugin(umi,{asset:C1.umiAsset,collection:coll.publicKey,authority:aliceU,
    plugin:{type:'Royalties',basisPoints:0,creators:[{address:aliceU.publicKey,percentage:100}],ruleSet:ruleSet('None')} as any})
    .sendAndConfirm(umi,{confirm:{commitment:CM}}))
  rec('R.8','a vault OWNER adds an asset-level Royalties plugin to dodge the 10%','REJECT',ownRoy.ok?'ALLOW':'REJECT',ownRoy.err)
  // ═══ ROUND 24 SHIP-GATE-5 PINS (round 25 N2), against the pinned Core binary ═══
  // An OWNER cannot add an external plugin adapter to a vault: an Oracle that may
  // reject updates is refused NoApprovals (only the update authority, our PDA, is
  // ever approved). An AgentIdentity adapter (the one route that can APPROVE an
  // Execute, round 25 N3) is refused earlier still: Core requires the agent
  // identity registry's PDA to sign the addition (MEASURED on this binary, a
  // scratch probe, 2026-10-05: the control below shows even a keypair update
  // authority is refused the same way without it), so it never reaches the
  // authority check at all.
  const ownerAdd=(plugin:any)=>attP(()=>addPlugin(umi,{asset:C1.umiAsset,collection:coll.publicKey,authority:aliceU,payer:aliceU,plugin} as any)
    .sendAndConfirm(umi,{confirm:{commitment:CM}}))
  const adOracle=await ownerAdd({type:'Oracle',baseAddress:pk(ORACLE_OK.toBase58()),lifecycleChecks:{update:[CheckResult.CAN_REJECT]},resultsOffset:{type:'NoOffset'}})
  rec('R24.1','a vault OWNER adds an Oracle adapter that can reject updates (round 24 A5 / W3)','REJECT',adOracle.ok?'ALLOW':'REJECT',adOracle.err)
  const adAgent=await ownerAdd({type:'AgentIdentity',uri:'https://example.invalid/agent',lifecycleChecks:{execute:[CheckResult.CAN_LISTEN]}})
  rec('R24.1a','a vault OWNER adds an AgentIdentity adapter (the Execute-approving route, round 25 N3)','REJECT',adAgent.ok?'ALLOW':'REJECT',adAgent.err)
  // THE CONTROL: a collection whose update authority is a KEYPAIR we hold (ours is
  // MINT's PDA, which nobody can sign for), and an asset in it owned by alice,
  // carrying the vault's PermanentFreezeExecute THAWED (two of them: CB takes the
  // adapter controls here, CA stays plain for SR.5c/5d).
  const ctrlX=generateSigner(umi), CA=generateSigner(umi), CB=generateSigner(umi)
  await createCollection(umi,{collection:ctrlX,name:'ctrlX',uri:'u',updateAuthority:pk(ctrlUA.publicKey.toBase58())}).sendAndConfirm(umi,{confirm:{commitment:CM}})
  for(const a of [CA,CB]) await create(umi,{asset:a,collection:{publicKey:ctrlX.publicKey} as any,authority:U(ctrlUA),name:'ctrl asset',uri:'u',owner:aliceU.publicKey,
    plugins:[{type:'PermanentFreezeExecute',frozen:false,authority:{type:'Address',address:pk(ctrlUA.publicKey.toBase58())}} as any]}).sendAndConfirm(umi,{confirm:{commitment:CM}})
  const uaAdd=(plugin:any)=>attP(()=>addPlugin(umi,{asset:CB.publicKey,collection:ctrlX.publicKey,authority:U(ctrlUA),payer:U(ctrlUA),plugin} as any)
    .sendAndConfirm(umi,{confirm:{commitment:CM}}))
  const uaOracle=await uaAdd({type:'Oracle',baseAddress:pk(ORACLE_OK.toBase58()),lifecycleChecks:{update:[CheckResult.CAN_REJECT]},resultsOffset:{type:'NoOffset'}})
  rec('R24.1b','CONTROL: the same Oracle addition signed by a collection update authority goes through (the call is well formed)','ALLOW',uaOracle.ok?'ALLOW':'REJECT',uaOracle.err)
  const uaAgent=await uaAdd({type:'AgentIdentity',uri:'https://example.invalid/agent',lifecycleChecks:{execute:[CheckResult.CAN_LISTEN]}})
  rec('R24.1c','CONTROL: the same AgentIdentity addition is refused even to the update authority (only the agent registry\'s PDA can add one)','REJECT',uaAgent.ok?'ALLOW':'REJECT',uaAgent.err)

  // ═══ L. THE DRAW: after the mint, from a slot hash, in mint order ═══
  console.log('\n─── L. levels: drawn by the program from a slot hash that did not exist at signing ───')
  const capEarly=await att(()=>send([ixCapture(C6.asset)],[deployer]))
  rec('L.1','capture a vault\'s entropy before its reveal slot exists','REJECT',capEarly.ok?'ALLOW':'REJECT',capEarly.err)
  // Round 26 rejected F1: owner-managed plugins cannot veto MINT's Attributes
  // update. Exercise every owner-managed kind against the pinned Core binary.
  const ownerRevealPlugins:any[]=[{type:'FreezeDelegate',frozen:true},{type:'BurnDelegate'},
    {type:'TransferDelegate'},{type:'Autograph',signatures:[]},{type:'FreezeExecute',frozen:true}]
  for(const [i,plugin] of ownerRevealPlugins.entries()){
    const r=await ownerAdd(plugin)
    rec(`R26.P${i+1}`,`owner adds ${plugin.type} before its vault's level reveal`,'ALLOW',r.ok?'ALLOW':'REJECT',r.err)
  }
  // A compact test-only CPI expands the final message, beyond the legacy wire
  // payload. The ordinary SDK encoding is retained except for that known tail.
  {
    // ROUND 32 (gate 5, round 31 W1): THE LARGEST AUTOGRAPH AN OWNER CAN WRITE.
    // A message rides in Core's instruction data, and the runtime caps CPI
    // instruction data at 10,240 bytes, so 10,198 is the most that fits and
    // 10,199 is refused by the RUNTIME (the test wrapper's own guard is higher).
    const autographIx=(length:number,who=aliceU,sigs?:any[])=>{
      const message='x'.repeat(length)
      const ix=updatePlugin(umi,{asset:C1.umiAsset,collection:coll.publicKey,authority:who,payer:who,
        plugin:{type:'Autograph',signatures:sigs??[{address:who.publicKey,message}]}} as any).getInstructions()[0]
      const data=Buffer.from(ix.data)
      if(!data.subarray(-length).equals(Buffer.from(message))) throw new Error('Autograph message is not the final encoded field')
      return {core:data.length,ix:new TransactionInstruction({programId:OWNER_WRAP,
        keys:[{pubkey:toWeb3JsPublicKey(ix.programId),isSigner:false,isWritable:false},
          ...ix.keys.map(k=>({pubkey:toWeb3JsPublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable}))],
        data:Buffer.concat([Buffer.from('PADTAIL!'),u16(length),data.subarray(0,-length)])})}
    }
    const over=autographIx(10199)
    const tooBig=await attP(()=>send([cuLim(400_000),over.ix],[alice]))
    rec('R31.W1a','an owner autograph one byte past the CPI limit (10,199 bytes, 10,241 of Core data) is refused by the runtime, not by our wrapper','REJECT,runtime,10241,0',
      `${tooBig.ok?'ALLOW':'REJECT'},${/too large \(10241 > 10240\)/.test(tooBig.err)?'runtime':'other'},${over.core},${(await fetchAsset(umi,C1.umiAsset) as any).autograph?.signatures?.length??0}`,tooBig.err)
    const max=autographIx(10198)
    const large=await att(()=>send([cuLim(400_000),max.ix],[alice]))
    const asset:any=await fetchAsset(umi,C1.umiAsset)
    rec('R28.A1','owner writes the LARGEST autograph that fits (10,198 bytes, 10,240 of Core data) before the actual FIFO-head reveal','ALLOW,10198,10240',
      `${large.ok?'ALLOW':'REJECT'},${asset.autograph?.signatures?.[0]?.message?.length??0},${max.core}`,large.err)
    // A second signer cannot grow it: an update must carry every existing
    // signature unchanged, so bob's own signature alone is refused (0x28).
    let bobLog=''
    const bobSig=await attP(async()=>{try{await updatePlugin(umi,{asset:C1.umiAsset,collection:coll.publicKey,authority:U(bob),payer:U(bob),
      plugin:{type:'Autograph',signatures:[{address:pk(bob.publicKey.toBase58()),message:'mine'}]}} as any).sendAndConfirm(umi,{confirm:{commitment:CM}})}
      catch(e:any){bobLog=`${e?.name??''} ${e?.message??''} ${JSON.stringify(e?.logs??e?.transactionLogs??[])}`;throw e}})
    const kept=(await fetchAsset(umi,C1.umiAsset) as any).autograph?.signatures
    rec('R31.W1b','a stranger replacing the list with only his own signature is refused (0x28) and the 10,198-byte signature stays','REJECT,0x28,1,10198',
      `${bobSig.ok?'ALLOW':'REJECT'},${/0x28\b|MissingSigner/.test(bobLog)?'0x28':'other'},${kept?.length},${kept?.[0]?.message?.length}`,bobSig.err)
  }
  const outOfOrder=await att(()=>send([ixReveal(C2.asset,C2.attrs)],[deployer]))
  rec('L.2','reveal vault #1 before vault #0 (FIFO: order is a choice, so nobody gets it)','REJECT',outOfOrder.ok?'ALLOW':'REJECT',outOfOrder.err)
  await waitEntropy(C6.asset)
  const cap3=await att(()=>send([ixCapture(C3.asset)],[deployer]))
  rec('L.3','capture is permissionless and ANY order (vault #2 before #0)','ALLOW',cap3.ok?'ALLOW':'REJECT',cap3.err)
  rec('L.3a','...and the entropy is stored','1',String((await recOf(C3.asset))![OFF_REC_SET]))
  // ROUND 22 (F19): RE-DERIVE THE ENTROPY FROM THE RAW SYSVAR, not from what the
  // program stored. Slot A is the first produced slot at or after reveal_slot; B
  // and C are each the first produced slot at or after the slot two 4-slot leader
  // groups past the previous one; entropy = sha256(hA || hB || hC || asset).
  {
    const sh=(await conn.getAccountInfo(SLOT_HASHES,CM))!.data, n=Number(sh.readBigUInt64LE(0))
    const entries=Array.from({length:n},(_,i)=>({slot:sh.readBigUInt64LE(8+i*40),hash:sh.subarray(16+i*40,48+i*40)}))
    const pick=(want:bigint)=>entries.filter(e=>e.slot>=want&&e.slot<=want+64n).sort((a,b)=>a.slot<b.slot?-1:1)[0]
    const r=(await recOf(C3.asset))!; let want=r.readBigUInt64LE(OFF_REC_REVEAL); const hs:Buffer[]=[]
    for(let k=0;k<3;k++){ const e=pick(want); if(!e) break; hs.push(Buffer.from(e.hash)); want=(e.slot/4n+2n)*4n }
    const mine=hs.length===3?createHash('sha256').update(Buffer.concat([...hs,C3.asset.toBuffer()])).digest().toString('hex'):'slot hashes not found'
    rec('L.3c','the stored entropy equals sha256(hA||hB||hC||asset) re-derived independently from the raw SlotHashes sysvar',
      Buffer.from(r.subarray(OFF_REC_ENTROPY,OFF_REC_ENTROPY+32)).toString('hex'),mine)
  }
  await send([ixCapture(C1.asset),ixCapture(C2.asset)],[deployer])
  const cap3b=await att(()=>send([ixCapture(C3.asset)],[deployer]))
  rec('L.3b','capture the same vault twice','REJECT',cap3b.ok?'ALLOW':'REJECT',cap3b.err)
  // THE ATTRIBUTES ARE RE-SUPPLIED (Core replaces the whole list) AND HASH-CHECKED.
  const tamper=await att(()=>send([ixReveal(C1.asset,[['charter',POB[1].toBase58()]])],[deployer]))
  rec('L.4','reveal with ONE attribute altered','REJECT',tamper.ok?'ALLOW':'REJECT',tamper.err)
  const rv1=await att(()=>send([ixReveal(C1.asset,C1.attrs,alice.publicKey)],[alice]))
  rec('L.5','reveal vault #0 (anyone may; alice pays here)','ALLOW',rv1.ok?'ALLOW':'REJECT',rv1.err)
  {
    const a=attrMap(await fetchAsset(umi,C1.umiAsset)); const r=(await recOf(C1.asset))!
    rec('L.6','the vault now CARRIES the level its record holds',LNAME[r[OFF_REC_LEVEL]-1]??'none',String(a.level))
    rec('L.7','...beside its charter mark, not instead of it',POB[0].toBase58(),String(a.charter))
    const k=await census()
    rec('L.8','one vault drawn: revealed_total 1, census minted sums to 1','1,1',
      `${(await cfg()).readBigUInt64LE(OFF_REVEALED)},${k.minted.reduce((x,y)=>x+y,0)}`)
  }
  {
    const a=await fetchAsset(umi,C1.umiAsset) as any
    rec('R26.P6','MINT revealed through all five owner plugins while both owner freezes and the permanent seal stayed frozen','true',
      String(rv1.ok&&a.freezeDelegate?.frozen===true&&a.freezeExecute?.frozen===true&&a.permanentFreezeExecute?.frozen===true&&!!a.burnDelegate&&!!a.transferDelegate&&!!a.autograph))
    const common={asset:C1.umiAsset,collection:coll.publicKey,authority:aliceU,payer:aliceU}
    // ROUND 28 BOUNDARY, MEASURED: the pinned Core runs every instruction in a
    // fixed 32 KiB bump heap (a requested heap frame is not used). With this
    // revealed 10,198-byte autograph, Core can no longer SHRINK the asset:
    // clearing the signatures and RemovePlugin both exhaust that heap and
    // revert. The vault is not stuck: the owner freezes still thaw here, and
    // C1 keeps the autograph and all five plugins through every later CBOB step
    // (activation, claims, votes). Transfer, bare burn, the seal's thaw/refreeze
    // and Execute were measured in .cache/r28-recovery-probe.mjs.
    let clearLog=''
    const clear=await att(async()=>{try{await updatePlugin(umi,{...common,plugin:{type:'Autograph',signatures:[]}} as any)
      .sendAndConfirm(umi,{confirm:{commitment:CM}})}catch(e:any){clearLog=`${e?.message??''} ${JSON.stringify(e?.logs??e?.transactionLogs??[])}`;throw e}})
    const kept=await fetchAsset(umi,C1.umiAsset) as any
    rec('R28.A2','Core cannot shrink the revealed 10,198-byte autograph (heap exhausted, reverted); level and permanent seal unchanged','REJECT,oom,10198,true',
      `${clear.ok?'ALLOW':'REJECT'},${/memory allocation failed/.test(clearLog)?'oom':'other'},${kept.autograph?.signatures?.[0]?.message?.length??0},${kept.permanentFreezeExecute?.frozen===true&&attrMap(kept).level===attrMap(a).level}`,clear.err)
    for(const type of ['FreezeDelegate','FreezeExecute']) await updatePlugin(umi,{...common,plugin:{type,frozen:false}} as any).sendAndConfirm(umi,{confirm:{commitment:CM}})
    const thawed=await fetchAsset(umi,C1.umiAsset) as any
    rec('R26.P7','owner thaws both owner freezes beside the large autograph; the permanent seal and revealed level remain','true',
      String(thawed.freezeDelegate?.frozen===false&&thawed.freezeExecute?.frozen===false&&!!thawed.autograph&&thawed.permanentFreezeExecute?.frozen===true&&attrMap(thawed).level===attrMap(a).level))
  }
  const rv1b=await att(()=>send([ixReveal(C1.asset,C1.attrs)],[deployer]))
  rec('L.9','reveal the same vault twice','REJECT',rv1b.ok?'ALLOW':'REJECT',rv1b.err)
  await send([ixReveal(C2.asset,C2.attrs)],[deployer])
  // THE DRAW, CHECKED BY AN INDEPENDENT IMPLEMENTATION, on the vault whose entropy
  // was captured out of order: what the program stored, run through this file's
  // own arithmetic against the census at its turn, must give the level it wrote.
  {
    const k=await census(); const e=(await recOf(C3.asset))!.subarray(OFF_REC_ENTROPY,OFF_REC_ENTROPY+32)
    const want=drawOf(Buffer.from(e),k.caps,k.minted)
    await send([ixReveal(C3.asset,C3.attrs)],[deployer])
    rec('L.10','the level the program drew equals an independent re-computation of the draw',
      String(want),String((await recOf(C3.asset))![OFF_REC_LEVEL]))
  }
  await revealAll()
  {
    const r5=(await recOf(C5.asset))!
    // C5 WAS REDEEMED (BURNED) BEFORE ITS DRAW. The FIFO must not stop at it, and
    // the census must count it, or one burned vault would halt every reveal after.
    rec('L.11','a vault burned BEFORE its draw still takes one (the queue never stops at it)',
      'true',String(r5[OFF_REC_LEVEL]>=1&&r5[OFF_REC_LEVEL]<=5))
    rec('L.11a','...and its asset is still the burned one-byte account','1,0',
      `${(await conn.getAccountInfo(C5.asset,CM))?.data.length},${(await conn.getAccountInfo(C5.asset,CM))?.data[0]}`)
  }

  // ═══ G1. THE FIRST VOTE: charter vaults vote the first paid round in ═══
  console.log('\n─── G1. governance bootstrap: the charter vaults are the first voters, once the window has CLOSED ───')
  const propId=(n:number)=>W.findProgramAddressSync([Buffer.from('proposal'),u64(n)],GOV_PROG)[0]
  const nextProp=async()=>Number((await conn.getAccountInfo(GOV_CFG,CM))!.data.readBigUInt64LE(53))+1
  const now=()=>Math.floor(Date.now()/1000)
  const actRound=(price=PRICE,cap=100,o?:number,c?:number)=>Buffer.concat([u8b(0),i64(o??now()-60),i64(c??now()+6*3600),u64(price),u32(cap)])
  const actBrakes=(o:{sales?:boolean,sweep?:boolean,guardian?:W|null})=>Buffer.concat([u8b(1),
    u8b(o.sales?1:0),u8b(o.sweep?1:0),u8b(o.guardian!==undefined?1:0),o.guardian?SOME(o.guardian.toBuffer()):NONE])
  const actTighten=(o:any)=>Buffer.concat([u8b(2),tightenArgs(o)])
  const actArm=(k:W)=>Buffer.concat([u8b(3),k.toBuffer()])
  const actBoost=(price:bigint,weight:number,epochs:number)=>Buffer.concat([u8b(4),u64(price),u8b(weight),u16(epochs)])
  /** A proposal carries a Vec of actions (stage 3b, rule E). */
  const acts=(a:Buffer|Buffer[])=>{const l=Array.isArray(a)?a:[a]; return Buffer.concat([u32(l.length),...l])}
  const ixPropA=(id:number,asset:W,who:Keypair,ends:number,action:Buffer|Buffer[],raw?:Buffer)=>new TransactionInstruction({programId:GOV_PROG,
    data:Buffer.concat([d('create_proposal'),raw??acts(action),i64(ends)]),
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:true},{pubkey:propId(id),isSigner:false,isWritable:true},
      {pubkey:MINT_CFG,isSigner:false,isWritable:false},{pubkey:BURN_CFG,isSigner:false,isWritable:false},
      {pubkey:asset,isSigner:false,isWritable:false},{pubkey:who.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const voteRec=(prop:W,asset:W)=>W.findProgramAddressSync([Buffer.from('vote'),prop.toBuffer(),asset.toBuffer()],GOV_PROG)[0]
  const ixVote=(prop:W,v:{asset:W},who:Keypair,support:boolean,record:W=vrec(v.asset))=>new TransactionInstruction({programId:GOV_PROG,
    data:Buffer.concat([d('cast_vote'),Buffer.from([support?1:0])]),
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:false},{pubkey:prop,isSigner:false,isWritable:true},
      {pubkey:voteRec(prop,v.asset),isSigner:false,isWritable:true},{pubkey:v.asset,isSigner:false,isWritable:false},
      {pubkey:record,isSigner:false,isWritable:false},
      {pubkey:who.publicKey,isSigner:true,isWritable:false},{pubkey:deployer.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const ixExec=(prop:W)=>new TransactionInstruction({programId:GOV_PROG,data:Buffer.from(d('execute_proposal')),
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:true},{pubkey:prop,isSigner:false,isWritable:true},
      {pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:GOV_PDA,isSigner:false,isWritable:false},
      {pubkey:MINT_PROG,isSigner:false,isWritable:false}]})
  /** Decode a Proposal: the actions are a Borsh Vec of variable-length enums, so
   *  the fixed fields after it are found by walking it, never by a constant offset. */
  const readProp=async(id:number)=>{const b=(await conn.getAccountInfo(propId(id),CM))!.data
    let o=16; const n=b.readUInt32LE(o); o+=4; let key=false
    for(let i=0;i<n;i++){ const tag=b[o++]
      if(tag===0) o+=28
      else if(tag===1){ if(b[o+2]===1) key=true; o+=3; o+=b[o]===1?33:1 }
      else if(tag===2){ for(const sz of [8,8,8]) o+=b[o]===1?1+sz:1 }
      else if(tag===3){ key=true; o+=32 }
      else o+=11 }
    o+=8; const yes=b.readBigUInt64LE(o); o+=8; const no=b.readBigUInt64LE(o); o+=8; o+=2
    const quorumSupply=Number(b.readBigUInt64LE(o)); o+=8; const qbps=b.readUInt16LE(o); o+=4
    const indexSnapshot=Number(b.readBigUInt64LE(o)); o+=8; const createdAt=Number(b.readBigInt64LE(o))
    const need=Math.ceil(quorumSupply*qbps/10000), needYes=Math.ceil(quorumSupply*1000/10000)
    // STAGE 3c: a guardian change or a new swap operator needs half of ALL live vaults.
    const needKey=key?Math.ceil(quorumSupply*5000/10000):0
    return {yes,no,quorumSupply,qbps,indexSnapshot,createdAt,nActions:n,need,needYes,needKey,key,eff:Math.max(need,needYes,needKey)}}
  const OWNERS=[alice,bob,carol]
  /** Live vaults our keys own, read OFF THE CHAIN (owner bytes), never assumed. */
  const voters=async(snapshot:number)=>{const out:{v:V,kp:Keypair}[]=[]
    for(const v of VAULTS){const a=await conn.getAccountInfo(v.asset,CM); if(!a||a.data[0]!==1) continue
      const o=new W(a.data.subarray(1,33)); const kp=OWNERS.find(k=>k.publicKey.equals(o)); if(!kp) continue
      const r=await recOf(v.asset); if(!r||Number(r.readBigUInt64LE(OFF_REC_INDEX))>=snapshot) continue
      out.push({v,kp})}
    return out}
  /** Create one proposal and (unless told not to) vote it through with exactly
   *  the YES votes it needs: the larger of quorum and the 10% turnout (rule D). */
  const propose=async(action:Buffer|Buffer[],o:{votes?:'none'|'need'|'quorumOnly'|'quorumAndTurnout'|number,ends?:number}={})=>{
    const id=await nextProp(); const vs=await voters(Number((await cfg()).readBigUInt64LE(OFF_MINTED_TOTAL)))
    const ends=o.ends??now()+VOTE_SECS+5
    const res=await att(()=>send([ixPropA(id,vs[0].v.asset,vs[0].kp,ends,action)],[vs[0].kp]))
    if(res.ok&&o.votes!=='none'){
      const p=await readProp(id)
      const n=typeof o.votes==='number'?o.votes:o.votes==='quorumOnly'?p.need:o.votes==='quorumAndTurnout'?Math.max(p.need,p.needYes):p.eff
      const elig=await voters(p.indexSnapshot)
      for(const {v,kp} of elig.slice(0,n)) await send([ixVote(propId(id),v,kp,true)],[deployer,kp])
    }
    return {id,ends,...res}}
  const waitEnds=async(ends:number)=>{ const w=ends+2-now()
    if(w>0){ console.log(`  (waiting ${w}s for the voting window to close)`); while(now()<=ends+1) await sleep(500) } }
  const exec=async(id:number)=>att(()=>send([ixExec(propId(id))],[deployer]))

  // THE CHARTER WINDOW CLOSES FOREVER FIRST. Rule C: no proposal exists until
  // every charter member has had the whole window to claim, so the first vote's
  // electorate is the whole charter.
  await waitEnds(CHARTER_CLOSES)
  const cLate=await att(()=>claim(carol,7))
  rec('C.15','a VALID, unspent, owned Proof of Burn claimed AFTER the window','REJECT',cLate.ok?'ALLOW':'REJECT',cLate.err)
  rec('C.16','...and that PoB survives as what Gary ruled it now is: a collectible','1',
    String((await conn.getAccountInfo(POB[7],CM))?.data[0]))

  // Refused at CREATION, so no vote is wasted on a proposal MINT would refuse.
  const ends1=now()+VOTE_SECS+5
  const newOp=Keypair.generate(), newOp2=Keypair.generate()
  {
    const id=await nextProp()
    const gp2=await att(()=>send([ixPropA(id,C1.asset,deployer,ends1,actRound())],[deployer]))
    rec('7.4','a NON-holder creates a proposal','REJECT',gp2.ok?'ALLOW':'REJECT',gp2.err)
    const mk=async(t:string,rid:string,action:Buffer|Buffer[],raw?:Buffer)=>{const x=await att(()=>send([ixPropA(id,C1.asset,alice,ends1,action,raw)],[alice]))
      rec(rid,t,'REJECT',x.ok?'ALLOW':'REJECT',x.err)}
    await mk('a round priced BELOW the 21,000-sat floor (20,999)','G.1',actRound(20_999n))
    await mk('a round with cap=0 (used to mean UNLIMITED)','6.1',actRound(PRICE,0))
    await mk('a round with a window that never closes','6.2',actRound(PRICE,100,now()-60,8640000000000000))
    await mk('a round with opens_at=-1 and closes_at=i64::MAX','6.31',Buffer.concat([u8b(0),i64(-1),i64(9223372036854775807n),u64(PRICE),u32(10)]))
    await mk('a Brakes proposal that restarts nothing and replaces nobody','7.27',actBrakes({}))
    await mk('a TightenSweep proposal that changes nothing','7.27a',actTighten({}))
    // RULE E: a bounded list, one action per kind.
    await mk('a proposal with NO actions','E.4',[])
    await mk('a proposal with SIX actions (the bound is five, one of each kind)','E.5',
      [actRound(),actBrakes({sales:true}),actTighten({maxSweep:BigInt(LAMPORTS_PER_SOL)}),actArm(newOp.publicKey),actBoost(1n,1,1),actRound()])
    await mk('a proposal carrying TWO boost terms','E.6b',[actBoost(1n,1,1),actBoost(2n,1,1)])
    // THE BOOST'S BOUNDS, refused at creation against MINT's fixed values.
    await mk('boost terms with an extra weight ABOVE the bound fixed at init','BO.1a',actBoost(1_000_000n,MAX_BOOST_W+1,2))
    await mk('boost terms with an extra weight of 0','BO.1b',actBoost(1_000_000n,0,2))
    await mk('boost terms lasting MORE distributions than the bound','BO.1c',actBoost(1_000_000n,2,MAX_BOOST_E+1))
    await mk('boost terms lasting 0 distributions','BO.1d',actBoost(1_000_000n,2,0))
    await mk('a proposal carrying TWO rounds','E.6',[actRound(),actRound(PRICE,50)])
    // RULE B: the sweep only tightens, judged against what is live NOW.
    await mk('a vote RAISES the sweep cap past what is live (50 SOL -> 51)','6.20i',actTighten({maxSweep:BigInt(51*LAMPORTS_PER_SOL)}))
    await mk('a vote LOWERS the cooldown (1s -> 0)','6.18a',actTighten({sweepCooldown:0}))
    await mk('a vote LOWERS the SOL reserve (0.05 SOL -> 1,000 lamports)','6.34',actTighten({solReserve:1000n}))
    await mk('a vote arms the default pubkey as swap operator','6.23d',actArm(new W('11111111111111111111111111111111')))
    // STAGE 3c: the bounds fixed at initialize (red-team 2 #3), and the bundle (#2).
    await mk('a vote tightens the per-sweep cap BELOW the floor fixed at init (0.5 SOL)','3c.B1',actTighten({maxSweep:SWEEP_FLOOR-1n}))
    await mk('a vote raises the SOL reserve ABOVE the ceiling fixed at init (u64::MAX locked every lamport)','3c.B2',actTighten({solReserve:18446744073709551615n}))
    await mk('a vote raises the cooldown ABOVE the ceiling fixed at init','3c.B3',actTighten({sweepCooldown:COOLDOWN_CEIL+1}))
    await mk('ONE proposal that replaces the guardian AND arms a swap operator (the red-team 2 bundle)','3c.K1',
      [actBrakes({guardian:null}),actArm(newOp.publicKey)])
    // THE DELETED SHAPE: the old UpdateWiring carried bank_treasury first. Tag 2
    // is TightenSweep now, and the bytes that used to say "pay the 15% here" do
    // not parse as anything a proposal can carry.
    await mk('a proposal in the DELETED UpdateWiring shape (bank_treasury = some key)','W.1',[],
      Buffer.concat([u32(1),u8b(2),SOME(Buffer.alloc(32,7)),NONE,NONE,NONE,NONE,NONE,NONE]))
  }
  const B1:Record<string,any>={}
  B1.restartSales=await propose(actBrakes({sales:true}))
  B1.round=await propose(actRound())
  rec('7.3','a charter vault holder creates the FIRST round proposal, after the window closed','ALLOW',B1.round.ok?'ALLOW':'REJECT',B1.round.err)
  B1.zero=await propose(actRound(),{votes:'none'})
  rec('7.12','a proposal nobody will vote on','ALLOW',B1.zero.ok?'ALLOW':'REJECT',B1.zero.err)
  B1.closed=await propose(actRound(PRICE,10,now()-600,now()-300))
  rec('7.12a','a proposal for a round that has ALREADY closed can be created','ALLOW',B1.closed.ok?'ALLOW':'REJECT',B1.closed.err)
  B1.capLow=await propose(actTighten({maxSweep:BigInt(LAMPORTS_PER_SOL)}))
  B1.capZero=await propose(actTighten({maxSweep:0n}))
  rec('6.23e','a vote sets the sweep cap to zero: refused when PROPOSED (below the floor), so nobody votes on it','REJECT',
    B1.capZero.ok?'ALLOW':'REJECT',B1.capZero.err)
  B1.okReserve=await propose(actTighten({solReserve:60_000_000n}))
  B1.newOp=await propose(actArm(newOp.publicKey))
  // STAGE 3c: the same arm carried only by quorum and the 10% turnout, short of
  // half of ALL live vaults.
  B1.newOpLow=await propose(actArm(newOp.publicKey),{votes:'quorumAndTurnout'})
  // RED-TEAM 2 #6: a round that a NEWER round will overtake, bundled with a
  // tightening. Stage 3b reverted the whole bundle; now the round is skipped.
  B1.atomic=await propose([actRound(PRICE,50),actTighten({sweepCooldown:2})])
  rec('E.1','a proposal carrying TWO different actions is created','ALLOW',B1.atomic.ok?'ALLOW':'REJECT',B1.atomic.err)
  // A PRE-FUNDED PDA. Settled by DOING it, not by reasoning about Anchor `init`.
  {
    const id=await nextProp()
    await send([SystemProgram.transfer({fromPubkey:deployer.publicKey,toPubkey:propId(id),lamports:2_000_000})],[deployer])
    B1.p4=await propose(actRound())
    rec('7.12d','create a proposal at a PDA a griefer pre-funded','ALLOW',B1.p4.ok?'ALLOW':'REJECT',B1.p4.err)
  }
  B1.p5=await propose(actRound())
  // VOTING ARMS, on the round proposal (already carrying its needed votes).
  const P1=propId(B1.round.id)
  const v0=await att(()=>send([ixVote(P1,C4,deployer,true)],[deployer]))
  rec('7.5','a NON-owner votes with someone else\'s vault','REJECT',v0.ok?'ALLOW':'REJECT',v0.err)
  await transfer(umi,{asset:{publicKey:C4.umiAsset,owner:aliceU.publicKey} as any,
    collection:{publicKey:coll.publicKey} as any,newOwner:pk(CPI_OWNER.toBase58()),authority:aliceU,payer:aliceU})
    .sendAndConfirm(umi,{confirm:{commitment:CM}})
  const pdaVote=ixVote(P1,C4,alice,true)
  pdaVote.keys=pdaVote.keys.map(k=>k.pubkey.equals(alice.publicKey)?{...k,pubkey:CPI_OWNER}:k)
  const ownerVoteBefore=await readProp(B1.round.id)
  const v1=await att(()=>send([signedOwnerIx(pdaVote)],[deployer]))
  rec('R27.V1','a program-owned vault votes through its owner program invoke_signed with a separate payer','ALLOW',v1.ok?'ALLOW':'REJECT',v1.err)
  await returnFromPda(C4.asset,COLL,alice.publicKey)
  const ownerVoteAfter=await readProp(B1.round.id)
  rec('7.6','the owner vote adds exactly one YES and leaves NO unchanged',
    `${ownerVoteBefore.yes+1n},${ownerVoteBefore.no}`,`${ownerVoteAfter.yes},${ownerVoteAfter.no}`)
  const v2=await att(()=>send([ixVote(P1,C4,alice,true)],[deployer,alice]))
  rec('7.7','the SAME vault votes twice','REJECT',v2.ok?'ALLOW':'REJECT',v2.err)
  const xfer=await att(()=>transfer(umi,{asset:{publicKey:C4.umiAsset,owner:aliceU.publicKey} as any,
    collection:{publicKey:coll.publicKey} as any,newOwner:pk(carol.publicKey.toBase58()),authority:aliceU})
    .sendAndConfirm(umi,{confirm:{commitment:CM}}))
  rec('7.8','transfer the already-voted vault to a new owner','ALLOW',xfer.ok?'ALLOW':'REJECT',xfer.err)
  C4.owner=carol
  const v3=await att(()=>send([ixVote(P1,C4,carol,true)],[deployer,carol]))
  rec('7.9','NEW owner votes again with the same vault (double-vote by transfer)','REJECT',v3.ok?'ALLOW':'REJECT',v3.err)
  // THE VAULT RECORD IS PINNED: a vote carrying some other account as its record
  // cannot smuggle in a lower mint index.
  const vFake=await att(()=>send([ixVote(P1,C6,carol,true,vrec(C1.asset))],[deployer,carol]))
  rec('G.3','a vote presenting ANOTHER vault\'s record (an older mint index)','REJECT',vFake.ok?'ALLOW':'REJECT',vFake.err)
  const e0=await exec(B1.round.id)
  rec('7.11','execute while voting is still open','REJECT',e0.ok?'ALLOW':'REJECT',e0.err)
  const afterRot=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,data:tighten({maxSweep:1n}),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:GOV_PDA,isSigner:false,isWritable:false}]})],[deployer]))
  rec('7.18','tighten the sweep by naming the GOV PDA, which cannot sign','REJECT',afterRot.ok?'ALLOW':'REJECT',afterRot.err)

  await waitEnds(B1.p5.ends)
  const roundBefore=(await cfg()).readUInt32LE(OFF_ROUND_ID)
  const x=async(k:string)=>exec(B1[k].id)
  // RED-TEAM 1 FINDING 2: execution used to move forward by id across EVERY kind,
  // so executing the later round first made the earlier restart unexecutable.
  // The round goes first here on purpose.
  const e2=await x('round'); rec('7.14','execute the ratified FIRST round','ALLOW',e2.ok?'ALLOW':'REJECT',e2.err)
  {
    const c=await cfg()
    rec('7.15','MINT round_id advanced (the vote actually set the round)',String(roundBefore+1),String(c.readUInt32LE(OFF_ROUND_ID)))
    rec('7.16','MINT price is the proposal price, in sats',String(PRICE),String(c.readBigUInt64LE(OFF_PRICE)))
  }
  const xr=await x('restartSales'); rec('6c.13','a VOTE restarts sales','ALLOW',xr.ok?'ALLOW':'REJECT',xr.err)
  rec('RT1.2','...and it is the EARLIER proposal, executed AFTER a later one (red-team 1 finding 2)','ALLOW,true',
    `${xr.ok?'ALLOW':'REJECT'},${B1.restartSales.id<B1.round.id}`,xr.err)
  rec('6c.14','...and only sales: the sweep is still stopped','0,1',await stops())
  const e1=await x('zero'); rec('7.13','execute a proposal with ZERO votes','REJECT',e1.ok?'ALLOW':'REJECT',e1.err)
  let sigClosed=''
  const e1b=await att(async()=>{ sigClosed=await send([ixExec(propId(B1.closed.id))],[deployer]) })
  rec('7.13a','execute a RATIFIED proposal whose round already closed: a LOGGED NO-OP, the round is not installed','ALLOW,true,true',
    `${e1b.ok?'ALLOW':'REJECT'},${(await logsOf(sigClosed)).logs.some(l=>l.includes('CBOB_ACTION_SKIPPED')&&l.includes('round_already_over'))},${(await cfg()).readUInt32LE(OFF_ROUND_ID)===roundBefore+1}`,e1b.err)
  const capLow=await x('capLow'); rec('6.14','a vote LOWERS the on-chain sweep cap (50 SOL -> 1 SOL)','ALLOW',capLow.ok?'ALLOW':'REJECT',capLow.err)
  rec('6.14a','...and MINT holds the tighter cap',String(LAMPORTS_PER_SOL),String((await cfg()).readBigUInt64LE(OFF_MAX_SWEEP)))
  const okReserve=await x('okReserve'); rec('6.34a','a vote RAISES the SOL reserve (0.05 -> 0.06 SOL)','ALLOW',okReserve.ok?'ALLOW':'REJECT',okReserve.err)
  rec('6.34b','...and MINT holds it','60000000',String((await cfg()).readBigUInt64LE(OFF_SOL_RESERVE)))
  const lowOp=await x('newOpLow')
  rec('3c.K2','arm a swap operator with quorum and the 10% turnout but short of HALF of all live vaults','REJECT',lowOp.ok?'ALLOW':'REJECT',lowOp.err)
  {
    const p=await readProp(B1.newOpLow.id)
    rec('3c.K2p','(precondition) it carried every vote the stage-3b rules asked for, and fewer than half','true',
      String(Number(p.yes)>=Math.max(p.need,p.needYes)&&Number(p.yes)<p.needKey),`yes ${p.yes}; quorum ${p.need}, turnout ${p.needYes}, half ${p.needKey} of ${p.quorumSupply}`)
  }
  const rotOp=await x('newOp'); rec('6.20','a vote ARMS a replacement swap operator, with YES from half of all live vaults','ALLOW',rotOp.ok?'ALLOW':'REJECT',rotOp.err)
  {
    const c=await cfg()
    rec('6.20e','...which does NOT take over: the live operator is unchanged',swapOp.publicKey.toBase58(),
      new W(c.subarray(OFF_SWAP_OPERATOR,OFF_SWAP_OPERATOR+32)).toBase58())
    rec('6.20f','...it is PENDING, stamped when armed',`${newOp.publicKey.toBase58()},true`,
      `${new W(c.subarray(OFF_PENDING_OP,OFF_PENDING_OP+32)).toBase58()},${Math.abs(Number(c.readBigInt64LE(OFF_PENDING_OP_AT))-now())<120}`)
  }
  const early=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,data:d('apply_swap_operator'),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true}]})],[alice]))
  rec('6.20g','ANYONE applies it before the seven-day notice has run','REJECT',early.ok?'ALLOW':'REJECT',early.err)
  const e5=await exec(B1.p5.id); rec('7.25','execute the NEWER of two ratified rounds','ALLOW',e5.ok?'ALLOW':'REJECT',e5.err)
  {
    const r5=(await cfg()).readUInt32LE(OFF_ROUND_ID); let sig4=''
    const e4=await att(async()=>{ sig4=await send([ixExec(propId(B1.p4.id))],[deployer]) })
    rec('7.26','then execute the OLDER round: a LOGGED NO-OP (it would revive a superseded decision), the newer round stays',
      `ALLOW,true,${r5}`,`${e4.ok?'ALLOW':'REJECT'},${(await logsOf(sig4)).logs.some(l=>l.includes('CBOB_ACTION_SKIPPED')&&l.includes('superseded'))},${(await cfg()).readUInt32LE(OFF_ROUND_ID)}`,e4.err)
    // RED-TEAM 2 #6: the overtaken round no longer takes its bundle down with it.
    let sigA=''
    const at=await att(async()=>{ sigA=await send([ixExec(propId(B1.atomic.id))],[deployer]) })
    rec('E.2','a bundle whose ROUND a newer vote overtook still executes: its tightening lands','ALLOW,2',
      `${at.ok?'ALLOW':'REJECT'},${(await cfg()).readBigInt64LE(OFF_SWEEP_COOLDOWN)}`,at.err)
    rec('E.2a','...the overtaken round is skipped and LOGGED (CBOB_ACTION_SKIPPED), and the round in force is untouched',`true,${r5}`,
      `${(await logsOf(sigA)).logs.some(l=>l.includes('CBOB_ACTION_SKIPPED')&&l.includes('set_round'))},${(await cfg()).readUInt32LE(OFF_ROUND_ID)}`)
  }
  const e3=await x('round'); rec('7.17','execute the same proposal twice','REJECT',e3.ok?'ALLOW':'REJECT',e3.err)

  // ════════════════════ 2. THE PAID MINT, IN cbBTC ════════════════════
  console.log('\n─── 2. a voted round: paid in cbBTC, into THE revenue address ───')
  const revBefore=await tokBal(revAta), aliceBefore=await tokBal(ata(alice.publicKey))
  // ROUND 32 (gate 5, round 31 W2): the stranger pre-funds this vault's record
  // PDA and its reserve token-account address before the mint, and the reserve
  // account is then created NON-idempotently. Neither address can be squatted.
  const vKp=Keypair.generate(), V=mkV(vKp,alice,[])
  await send([SystemProgram.transfer({fromPubkey:stranger.publicKey,toPubkey:vrec(V.asset),lamports:1_000_000}),
    SystemProgram.transfer({fromPubkey:stranger.publicKey,toPubkey:ata(V.pda),lamports:1_000_000})],[stranger])
  const preRec=await conn.getAccountInfo(vrec(V.asset),CM), preAta=await conn.getAccountInfo(ata(V.pda),CM)
  const vMint=await att(()=>send([ixMint(V.asset,alice.publicKey,alice.publicKey,{attrs:[]})],[alice,vKp]))
  const vAta=await att(()=>send([createAssociatedTokenAccountInstruction(deployer.publicKey,ata(V.pda),V.pda,mint),
    createTransferInstruction(ata(deployer.publicKey),ata(V.pda),deployer.publicKey,SATS)],[deployer]))
  const sys=SystemProgram.programId.toBase58()
  rec('R31.W2b','a vault record PDA and a reserve account address a stranger pre-funded: the mint and a NON-idempotent account create both land, owned by MINT and Token',
    `${sys},${sys},ALLOW,ALLOW,${MINT_PROG.toBase58()},${TOKEN_PROGRAM_ID.toBase58()}`,
    `${preRec?.owner.toBase58()},${preAta?.owner.toBase58()},${vMint.ok?'ALLOW':'REJECT'},${vAta.ok?'ALLOW':'REJECT'},${(await conn.getAccountInfo(vrec(V.asset),CM))?.owner.toBase58()},${(await conn.getAccountInfo(ata(V.pda),CM))?.owner.toBase58()}`,
    vMint.err||vAta.err)
  rec('2.1','a vault minted in a voted round','true',String(!!V.asset))
  rec('2.2','the whole price landed in the revenue address, in cbBTC',String(PRICE),String(await tokBal(revAta)-revBefore))
  rec('2.2a','...and came out of the payer\'s cbBTC, the price and nothing else',String(PRICE),String(aliceBefore-await tokBal(ata(alice.publicKey))))
  rec('2.2b','its record: NOT charter','0',String((await recOf(V.asset))![OFF_REC_CHARTER]))
  // ── THE CRANK RIDES ON A PAID MINT, AN ACTIVATION AND A CLAIM ──
  // SPEC 54: a transaction carrying a crank sets the compute limit, as item 50
  // requires of the holder pages. Without it this helper passed only while the
  // validator's SlotHashes was still short (round 25 run 3 died here at 200,000).
  const mintWith=async(o:any={})=>{const k=Keypair.generate()
    await send([...crankCU(o),ixMint(k.publicKey,alice.publicKey,alice.publicKey,o)],[alice,k]); return mkV(k,alice,[])}
  const revealSlotOf=async(a:W)=>Number((await recOf(a))!.readBigUInt64LE(OFF_REC_REVEAL))
  await waitEntropy(V.asset)
  const Q1=await mintWith({crank:[V.asset]})
  rec('K.2','a PAID MINT captures a queued vault\'s entropy on its way past','1',String((await recOf(V.asset))![OFF_REC_SET]))
  // A crank account that is not one of this program's writable records is
  // SKIPPED, never fatal: the crank must not be a way to make a member's mint fail.
  const kJunk=await att(()=>{const k=Keypair.generate(); return send([new TransactionInstruction({...ixMint(k.publicKey,alice.publicKey,alice.publicKey),
    keys:[...ixMint(k.publicKey,alice.publicKey,alice.publicKey).keys,{pubkey:SLOT_HASHES,isSigner:false,isWritable:false},
      {pubkey:ata(alice.publicKey),isSigner:false,isWritable:true},{pubkey:MINT_CFG,isSigner:false,isWritable:true}]})],[alice,k])
    .then(()=>mkV(k,alice,[]))})
  rec('K.3','a crank list carrying a token account and the config (not records) is skipped, the mint lands','ALLOW',kJunk.ok?'ALLOW':'REJECT',kJunk.err)
  const kMany=await att(()=>mintWith({crank:[C1.asset,C2.asset,C3.asset,C4.asset,C6.asset]}))
  rec('K.4','a crank of FIVE records (the bound is four)','REJECT',kMany.ok?'ALLOW':'REJECT',kMany.err)
  // An UNREVEALED vault cannot activate, whatever it holds.
  await fund(Q1,ACTIVATION)
  const aEarly=await att(()=>send([ixActivate(Q1)],[deployer]))
  rec('P.1','activate a vault whose level is not drawn yet','REJECT',aEarly.ok?'ALLOW':'REJECT',aEarly.err)
  await waitEntropy(Q1.asset)
  // ROUND 24 SHIP-GATE-5 PIN (W14): activate carrying ITS OWN record in the crank.
  // The crank captures it (level 0, entropy ready), then activate demands a drawn
  // level and refuses, so the WHOLE transaction reverts, the capture with it.
  const ownCrank=await att(()=>send([...crankCU({crank:[1]}),ixActivate(Q1,{crank:[Q1.asset]})],[deployer]))
  rec('R24.5','activate a vault carrying ITS OWN record in the crank: refused, and the crank\'s capture reverts with it','REJECT,0',
    `${ownCrank.ok?'ALLOW':'REJECT'},${(await recOf(Q1.asset))![OFF_REC_SET]}`,ownCrank.err)
  await fund(C1,ACTIVATION)
  const aC1=await att(()=>send([...crankCU({crank:[1]}),ixActivate(C1,{crank:[Q1.asset]})],[deployer]))
  rec('P.2','activate a drawn charter vault holding exactly 21,000 sats: it REQUESTS','ALLOW',aC1.ok?'ALLOW':'REJECT',aC1.err)
  rec('K.5','...and the ACTIVATION captured a queued vault\'s entropy on its way past','1',String((await recOf(Q1.asset))![OFF_REC_SET]))
  // ROUND 28 VALIDATION: the boundary R28.A2 pins, on the REAL vault shape. C1
  // still carries the 10,198-byte autograph and all five owner plugins, where
  // Core cannot remove even FreezeDelegate. SIMULATED only, so C1 is unchanged:
  // a transfer, and the complete redemption (SEAL open, Execute sweep of its
  // funded cbBTC, BURN) as one top-level transaction.
  {
    const simOk=async(ixs:TransactionInstruction[],signers:Keypair[])=>{
      const tx=new Transaction().add(cuLim(1_400_000),...ixs); tx.feePayer=signers[0].publicKey
      tx.recentBlockhash=(await conn.getLatestBlockhash(CM)).blockhash; tx.sign(...signers)
      const r=(await conn.simulateTransaction(tx)).value
      return {ok:r.err==null,err:r.err?`${JSON.stringify(r.err)} ${(r.logs??[]).filter(l=>/Error|failed|panicked|memory/.test(l)).join(' | ')}`.slice(0,600):''}}
    const xfer=transfer(umi,{asset:{publicKey:C1.umiAsset,owner:aliceU.publicKey} as any,collection:{publicKey:coll.publicKey} as any,
      newOwner:pk(bob.publicKey.toBase58()),authority:aliceU,payer:aliceU}).getInstructions()
      .map(i=>new TransactionInstruction({programId:toWeb3JsPublicKey(i.programId),data:Buffer.from(i.data),
        keys:i.keys.map(k=>({pubkey:toWeb3JsPublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable}))}))
    const t=await simOk(xfer,[alice])
    rec('R28.A3','the large-autograph vault can still change hands (simulated transfer on the real shape)','ALLOW',t.ok?'ALLOW':'REJECT',t.err)
    await waitRedeemToken()
    const o=await simOk([ixOpen(C1,alice.publicKey),...sweep(C1,ACTIVATION,0),ixBurn(C1,alice.publicKey,declare(C1.pda))],[alice])
    const still=await fetchAsset(umi,C1.umiAsset) as any
    rec('R28.A4','...and its complete redemption (open, Execute sweep, burn) runs on the real shape; simulated, so C1 is unchanged','ALLOW,10198',
      `${o.ok?'ALLOW':'REJECT'},${still.owner===aliceU.publicKey?still.autograph?.signatures?.[0]?.message?.length??0:'moved'}`,o.err)
  }
  // ═══ 3c.A THE ACTIVATION JOINS AT THE NEXT DISTRIBUTION (red-team 2 #5) ═══
  {
    const r=(await recOf(C1.asset))!, c=await cfg()
    rec('3c.A1','...a request is WAITING, not on the schedule: pending, no weight, counted as waiting','1,0,0,1',
      `${r[OFF_REC_PENDING]},${r[OFF_REC_ACTIVE]},${c.readBigUInt64LE(OFF_TOTAL_WEIGHT)},${c.readBigUInt64LE(OFF_PENDING_COUNT)}`)
    // THE LAUNCH ATTACK: with nobody joined, a burn would let the first
    // requester open the door alone and take the whole backlog with the next one.
    const door=await att(()=>send([ixDistribute(burnBy(alice))],[alice]))
    rec('3c.A3','a 100 $GARY burn tries to open the door while nobody has joined (the first-activator attack)','REJECT',door.ok?'ALLOW':'REJECT',door.err)
  }
  await waitDue()
  {
    // DUE, nobody joined, one waiting: ordinary traffic opens the door. The host
    // lands, credits nothing, and advances the epoch so the waiting vault can join.
    const e0=(await cfg()).readBigUInt64LE(OFF_DIST_EPOCH)
    const k=Keypair.generate(); let sig=''
    const m=await att(async()=>{ sig=await send([ixMint(k.publicKey,alice.publicKey,alice.publicKey)],[alice,k]) })
    if(m.ok) mkV(k,alice,[])
    const l=m.ok?(await logsOf(sig)).logs:[]
    rec('3c.A4','a mint once the month is due, nobody joined, one waiting: it lands, ticks the epoch, credits NOTHING',
      `ALLOW,${e0+1n},true,0`,`${m.ok?'ALLOW':'REJECT'},${(await cfg()).readBigUInt64LE(OFF_DIST_EPOCH)},${l.some(x=>x.includes('CBOB_EPOCH_TICK'))},${l.filter(x=>x.includes('CBOB_DISTRIBUTED')).length}`,m.err)
    await ck('3c','3c.A4')
    // THE GATE: the waiting vault is now ELIGIBLE. Until it is joined, no
    // distribution may run, so nobody can tick, join only themselves and burn.
    const gate=await att(()=>send([ixDistribute()],[alice]))
    rec('3c.A4b','a distribution while a vault eligible to join is still waiting','REJECT',gate.ok?'ALLOW':'REJECT',gate.err)
    const j=await att(()=>send([ixActivate(C1)],[deployer]))
    const c=await cfg(), r=(await recOf(C1.asset))!
    rec('3c.A5','...and the waiting vault JOINS: on the schedule at the accumulator as it stands, nobody waiting',
      `ALLOW,1,0,${WEIGHTS[r[OFF_REC_LEVEL]-1]},0,${WEIGHTS[r[OFF_REC_LEVEL]-1]*u128le(c,OFF_ACC)}`,
      `${j.ok?'ALLOW':'REJECT'},${r[OFF_REC_ACTIVE]},${r[OFF_REC_PENDING]},${c.readBigUInt64LE(OFF_TOTAL_WEIGHT)},${c.readBigUInt64LE(OFF_PENDING_COUNT)+c.readBigUInt64LE(OFF_PENDING_THIS)},${u128le(r,OFF_REC_DEBT)}`,j.err)
    await ck('3c','3c.A5')
  }
  // ═══ IN.0 THE MONTHLY IN-LINE RUN NEVER FAILS ITS HOST ═══
  // Due (the period has run since the tick), one vault active, and NOTHING has
  // ever reached the pool: a host must land and distribute nothing.
  await waitDue()
  {
    const p=await pool(), last=(await cfg()).readBigInt64LE(OFF_LAST_DIST)
    rec('IN.0p','(precondition) DUE, a vault is active, and the pool holds nothing undistributed','true',String(p.w>0n&&p.avail===0n),
      `weight ${p.w}, avail ${p.avail}`)
    const k=Keypair.generate(); let sig=''
    const m=await att(async()=>{ sig=await send([ixMint(k.publicKey,alice.publicKey,alice.publicKey)],[alice,k]) })
    if(m.ok) mkV(k,alice,[])
    rec('IN.0','a mint while the month is DUE but the pool is EMPTY lands, distributes nothing, and stamps nothing','ALLOW,0,true',
      `${m.ok?'ALLOW':'REJECT'},${m.ok?(await sigLogs(sig)).length:-1},${(await cfg()).readBigInt64LE(OFF_LAST_DIST)===last}`,m.err)
    await ck('IN','IN.0')
  }
  const Q2=await mintWith()
  await waitEntropy(Q2.asset)
  const kClaim=await att(()=>send([...crankCU({crank:[1]}),ixPoolClaim([C1],{crank:[Q2.asset]})],[deployer]))
  rec('K.6','a CLAIM with nothing owed lands, and captures a queued vault on its way past','ALLOW,1',
    `${kClaim.ok?'ALLOW':'REJECT'},${(await recOf(Q2.asset))![OFF_REC_SET]}`,kClaim.err)
  // ROUND 25 (round-24 C9): THE CRANK AND THE PAIRS NAME THE SAME RECORD. The crank
  // writes only a level-0 record still waiting for entropy; the pair path loads
  // its records AFTER the crank and stores only an active (so drawn) one. Here a
  // queued level-0 record rides in both lists: the crank's write must survive and
  // the pair path must leave it alone (it is not active, so it is skipped).
  {
    let u:V|undefined
    for(const v of VAULTS){ if(v===Q2) continue; const r=await recOf(v.asset); if(r&&r[OFF_REC_LEVEL]===0&&!r[OFF_REC_SET]){u=v;break} }
    if(!u) throw new Error('no queued level-0 record left for the crank/pair overlap arm')
    await waitEntropy(u.asset)
    const r0=(await recOf(u.asset))!
    const both=await att(()=>send([...crankCU({crank:[1]}),ixPoolClaim([u!,C1],{crank:[u!.asset]})],[deployer]))
    const r1=(await recOf(u.asset))!
    // Captured if its window is still open, rescheduled if it has passed: either is the crank's own write.
    const crankWrote=(r1[OFF_REC_SET]===1&&r1.readUInt16LE(OFF_REC_RESCHED)===r0.readUInt16LE(OFF_REC_RESCHED))
      ||(r1[OFF_REC_SET]===0&&r1.readUInt16LE(OFF_REC_RESCHED)===r0.readUInt16LE(OFF_REC_RESCHED)+1)
    rec('K.7','a claim whose crank AND pair list both name one queued record lands; the crank\'s write survives and the pair path leaves it un-joined, undrawn',
      'ALLOW,true,0,0,0',`${both.ok?'ALLOW':'REJECT'},${crankWrote},${r1[OFF_REC_LEVEL]},${r1[OFF_REC_ACTIVE]},${r1[OFF_REC_PENDING]}`,
      `${both.err} entropy ${r0[OFF_REC_SET]}->${r1[OFF_REC_SET]}, reschedules ${r0.readUInt16LE(OFF_REC_RESCHED)}->${r1.readUInt16LE(OFF_REC_RESCHED)}`)
  }
  const slip=await att(()=>{const k=Keypair.generate(); return send([ixMint(k.publicKey,alice.publicKey,alice.publicKey,{maxPrice:PRICE-1n})],[alice,k])})
  rec('6.12','price rose above the payer\'s stated maximum','REJECT',slip.ok?'ALLOW':'REJECT',slip.err)
  const otherMint=await createMint(conn,deployer,deployer.publicKey,null,8)
  await send([createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,ata(alice.publicKey,otherMint),alice.publicKey,otherMint)],[deployer])
  await mintTo(conn,deployer,otherMint,ata(alice.publicKey,otherMint),deployer,1_000_000n,[],{commitment:CM})
  const wrongPay=await att(()=>{const k=Keypair.generate(); return send([ixMint(k.publicKey,alice.publicKey,alice.publicKey,
    {payMint:otherMint,payerToken:ata(alice.publicKey,otherMint)})],[alice,k])})
  rec('G.4','pay the round price in a DIFFERENT token','REJECT',wrongPay.ok?'ALLOW':'REJECT',wrongPay.err)
  const wrongRev=await att(()=>{const k=Keypair.generate(); return send([ixMint(k.publicKey,alice.publicKey,alice.publicKey,
    {revToken:ata(bob.publicKey)})],[alice,k])})
  rec('G.5','pay the round price to an account that is not the revenue address','REJECT',wrongRev.ok?'ALLOW':'REJECT',wrongRev.err)
  const lFake=await att(()=>mkVault(0n,[['level','V']]))
  rec('11.3','a caller that writes its OWN level attribute','REJECT',lFake.ok?'ALLOW':'REJECT',lFake.err)
  const lDup=await att(()=>mkVault(0n,[['notice','1'],['notice','2']]))
  rec('11.4','two attributes sharing a key','REJECT',lDup.ok?'ALLOW':'REJECT',lDup.err)
  const t1=await att(()=>send([ixGovSigned(tighten({maxSweep:1n}),deployer)],[deployer]))
  rec('6.10','the DEPLOYER (INIT_AUTHORITY) changes the sweep bounds','REJECT',t1.ok?'ALLOW':'REJECT',t1.err)
  const payMe=await att(()=>send([ixGovSigned(armOp(alice.publicKey),alice)],[alice]))
  rec('6.21','a STRANGER arms themselves as the swap operator','REJECT',payMe.ok?'ALLOW':'REJECT',payMe.err)
  const brick=Keypair.generate()
  const [bPda]=W.findProgramAddressSync([Buffer.from('mpl-core-execute'),brick.publicKey.toBuffer()],CORE)
  const n2=await att(()=>send([ixMint(brick.publicKey,bPda,alice.publicKey,{ownerSigns:false})],[alice,brick]))
  rec('5.2','mint a vault whose named owner does not sign it (here a PDA, which never could): the owner must sign','REJECT',n2.ok?'ALLOW':'REJECT',n2.err)

  // ════════════ 3/4. THE REDEMPTION: OPEN + SWEEP + BURN, ATOMIC ════════════
  console.log('\n─── 3. redemption: the owner signs, the programs are the second party ───')
  const impostor=Keypair.generate()
  const c1=await att(()=>send([ixOpen(V,impostor.publicKey,alice.publicKey),
    ixBurn(V,impostor.publicKey,declare(V.pda),alice.publicKey)],[alice,impostor]))
  rec('3.1','a STRANGER signs as owner and redeems someone else\'s vault','REJECT',c1.ok?'ALLOW':'REJECT',c1.err)
  const pinned=(src:string,name:string)=>{const i=src.indexOf(name+': [u8; 8] = [')
    if(i<0) return 'NOT FOUND'
    const at=i+name.length+13
    return src.slice(at,src.indexOf(']',at)).split(',').map(x=>Number(x.trim())).join(',')}
  rec('3.1a','SEAL pins the real burn_vault discriminator',[...d('burn_vault')].join(','),pinned(SEAL_SRC,'IX_BURN_VAULT_DISC'))
  rec('3.1b','BURN pins the real open_for_redemption discriminator',[...d('open_for_redemption')].join(','),pinned(BURN_SRC,'IX_OPEN_FOR_REDEMPTION_DISC'))
  rec('3.1j','GOV pins the real set_round discriminator',[...d('set_round')].join(','),pinned(GOV_SRC,'IX_SET_ROUND'))
  rec('3.1k','GOV pins the real restart discriminator',[...d('restart')].join(','),pinned(GOV_SRC,'IX_RESTART'))
  rec('3.1l','GOV pins the real arm_guardian discriminator',[...d('arm_guardian')].join(','),pinned(GOV_SRC,'IX_ARM_GUARDIAN'))
  rec('3.1m','GOV pins the real tighten_sweep discriminator',[...d('tighten_sweep')].join(','),pinned(GOV_SRC,'IX_TIGHTEN_SWEEP'))
  rec('3.1t','GOV pins the real arm_swap_operator discriminator',[...d('arm_swap_operator')].join(','),pinned(GOV_SRC,'IX_ARM_SWAP_OPERATOR'))
  // STAGE 3b: BURN reads MINT's config too (live supply for the rate limit), so
  // there are now THREE readers of one layout, and they must agree on it.
  rec('3c.M1','GOV\'s reserve floor mirrors MINT\'s (a proposal MINT refuses is refused at creation)',
    (MINT_SRC.match(/const RENT_EXEMPT_0_BYTES: u64 = ([\d_]+);/)||[])[1]??'MINT NOT FOUND',
    (GOV_SRC.match(/const RENT_EXEMPT_0_BYTES: u64 = ([\d_]+);/)||[])[1]??'GOV NOT FOUND')
  rec('3.1u','BURN pins MINT\'s MintConfig account discriminator',[...acctDisc('MintConfig')].join(','),pinned(BURN_SRC,'MINT_CONFIG_DISC'))
  rec('3.1y','BURN pins SEAL\'s Config account discriminator (round 24 C8)',[...acctDisc('Config')].join(','),pinned(BURN_SRC,'SEAL_CONFIG_DISC'))
  {
    const ver=(src:string)=>(src.match(/MINT_CONFIG_VERSION: u8 = (\d+);/)||[])[1]??'NOT FOUND'
    rec('3.1v','MINT, GOV and BURN agree on the MintConfig layout version, and the chain carries it','6,6,6,6',
      `${ver(MINT_SRC)},${ver(GOV_SRC)},${ver(BURN_SRC)},${(await cfg())[8]}`)
    const c=await cfg()
    rec('3.1w','GOV\'s raw offsets read the live config right: charter close, reserve, cap, cooldown',
      `${CHARTER_CLOSES},60000000,${LAMPORTS_PER_SOL},2`,
      `${c.readBigInt64LE(OFF_CHARTER_CLOSES)},${c.readBigUInt64LE(OFF_SOL_RESERVE)},${c.readBigUInt64LE(OFF_MAX_SWEEP)},${c.readBigInt64LE(OFF_SWEEP_COOLDOWN)}`)
  }
  // v6 STAGE 2: GOV reads two more sibling accounts by raw offset.
  rec('3.1n','GOV pins MINT\'s VaultRecord account discriminator',[...acctDisc('VaultRecord')].join(','),pinned(GOV_SRC,'VAULT_RECORD_DISC'))
  rec('3.1o','GOV pins BURN\'s BurnConfig account discriminator',[...acctDisc('BurnConfig')].join(','),pinned(GOV_SRC,'BURN_CONFIG_DISC'))
  rec('3.1p','GOV pins MINT\'s MintConfig account discriminator',[...acctDisc('MintConfig')].join(','),pinned(GOV_SRC,'MINT_CONFIG_DISC'))
  // v6 STAGE 3: BURN calls MINT, and MINT accepts that call only from burn_vault.
  rec('3.1q','BURN pins MINT\'s real retire_redeemed discriminator',[...d('retire_redeemed')].join(','),pinned(BURN_SRC,'IX_RETIRE_REDEEMED_DISC'))
  rec('3.1r','MINT pins BURN\'s real burn_vault discriminator',[...d('burn_vault')].join(','),pinned(MINT_SRC,'IX_BURN_VAULT_DISC'))
  const idx=(src:string,name:string)=>{const i=src.indexOf(name+': usize = ')
    return i<0?'NOT FOUND':src.slice(i+name.length+10,src.indexOf(';',i)).trim()}
  rec('3.1c','SEAL binds the burn asset at account 0','0',idx(SEAL_SRC,'BURN_IX_ASSET_IDX'))
  rec('3.1d','SEAL binds the burn owner at account 2','2',idx(SEAL_SRC,'BURN_IX_OWNER_IDX'))
  rec('3.1e','BURN binds the open asset at account 0','0',idx(BURN_SRC,'SEAL_IX_ASSET_IDX'))
  rec('3.1f','BURN binds the open owner at account 2','2',idx(BURN_SRC,'SEAL_IX_OWNER_IDX'))
  rec('3.1s','MINT binds the burn asset at account 0 (as SEAL does)','0',idx(MINT_SRC,'BURN_IX_ASSET_IDX'))
  const o1=await att(()=>send([ixOpen(V,alice.publicKey)],[alice]))
  rec('3.6','the OWNER ALONE opens with no terminal burn in the same transaction','REJECT',o1.ok?'ALLOW':'REJECT',o1.err)
  // Round 25 (round-24 C8): Core's 0x9 is InvalidAuthority, which it also returns
  // for R.6, so the code alone does not say WHY. The decoded state does: the
  // signer IS the owner (Core's asset check approves the owner's Execute), and the
  // only thing on the asset that can REJECT an Execute is the seal, FROZEN. A probe
  // of this Core binary logged exactly that sequence (asset.rs:335 Approve, then
  // permanent_freeze_execute.rs:49 Reject, then 0x9); SR.5 shows a NON-owner
  // gets 0x1a NoApprovals instead, never 0x9.
  const v37=await fetchAsset(umi,V.umiAsset) as any
  const bare=await att(()=>send([...sweep(V,SATS,0)],[alice]))
  rec('3.7','a BARE owner Execute with no open at all (the seal, tested): refused while the signer IS the owner and the seal decodes FROZEN','REJECT,true,true',
    `${bare.ok?'ALLOW':'REJECT'},${String(v37.owner)===alice.publicKey.toBase58()},${v37.permanentFreezeExecute?.frozen===true}`,bare.err)
  const o2=await att(()=>send([ixBurn(V,alice.publicKey,declare(V.pda))],[alice]))
  rec('3.8','a BURN with no preceding open in the same transaction','REJECT',o2.ok?'ALLOW':'REJECT',o2.err)
  const decoyKey=Keypair.generate().publicKey
  const [decoyPda]=W.findProgramAddressSync([Buffer.from('mpl-core-execute'),decoyKey.toBuffer()],CORE)
  const DECOY={asset:decoyKey,pda:decoyPda}
  const o3=await att(()=>send([ixOpen(V,alice.publicKey),...sweep(V,SATS,0),
    ixBurn(DECOY,alice.publicKey,declare(DECOY.pda))],[alice]))
  rec('3.9','thaw a FULL vault, pair it with a burn naming a DIFFERENT asset','REJECT',o3.ok?'ALLOW':'REJECT',o3.err)
  const o4=await att(()=>send([ixOpen(V,alice.publicKey),...sweep(V,SATS,0),
    ixBurn(V,bob.publicKey,declare(V.pda))],[alice,bob]))
  rec('3.10','open names alice, burn names a different owner','REJECT',o4.ok?'ALLOW':'REJECT',o4.err)
  const o5=await att(()=>send([ixOpen(V,alice.publicKey),...sweep(V,SATS/2n,0,false),
    ixBurn(V,alice.publicKey,declare(V.pda))],[alice]))
  rec('3.11','a PARTIAL sweep (take half, burn the rest away)','REJECT',o5.ok?'ALLOW':'REJECT',o5.err)
  rec('3.11a','...and the vault still holds every sat',String(SATS),String(await tokBal(ata(V.pda))))
  const viaExec=(v:V,ix:any)=>execute(umi,{asset:{publicKey:v.umiAsset},collection:{publicKey:coll.publicKey} as any,
    instructions:[fromWeb3JsInstruction(ix)],signers:[createNoopSigner(v.pdaU)],authority:aliceU,payer:aliceU}).getInstructions()
    .map(i=>new TransactionInstruction({programId:toWeb3JsPublicKey(i.programId),data:Buffer.from(i.data),
      keys:i.keys.map(k=>({pubkey:toWeb3JsPublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable}))}))
  const dele=viaExec(V,createApproveInstruction(ata(V.pda),stranger.publicKey,V.pda,SATS))
  const drain=viaExec(V,createTransferInstruction(ata(V.pda),ata(alice.publicKey),V.pda,SATS))
  const c3=await att(()=>send([ixOpen(V,alice.publicKey),...dele,...drain,ixBurn(V,alice.publicKey,declare(V.pda))],[alice]))
  rec('3.3','delegate planted during the thaw, reserve ATA left OPEN','REJECT',c3.ok?'ALLOW':'REJECT',c3.err)
  const c3b=await att(()=>send([ixOpen(V,alice.publicKey),...dele,...sweep(V,SATS,0),ixBurn(V,alice.publicKey,declare(V.pda))],[alice]))
  rec('3.3a','...the same delegate, but the ATA is CLOSED by the sweep','ALLOW',c3b.ok?'ALLOW':'REJECT',
    `the delegated account no longer exists, so there is nothing left for it to authorise. ${c3b.err}`)

  console.log('\n─── 4. the happy path, and what it leaves behind ───')
  const H=await mkVault()
  const b1=await att(()=>send([ixOpen(H,alice.publicKey),ixBurn(H,alice.publicKey,declare(H.pda))],[alice]))
  rec('4.1','open + burn with the BTC still inside','REJECT',b1.ok?'ALLOW':'REJECT',b1.err)
  const before=await tokBal(ata(alice.publicKey))
  const burnedBefore=Number((await conn.getAccountInfo(BURN_CFG,CM))!.data.readBigUInt64LE(OFF_BURNED_TOTAL))
  const redeem=[ixOpen(H,alice.publicKey),...sweep(H,SATS,0),ixBurn(H,alice.publicKey,declare(H.pda))]
  const h1=await att(()=>send(redeem,[alice]))
  rec('4.2','full redemption by the OWNER ALONE: open + sweep + burn, ONE transaction','ALLOW',h1.ok?'ALLOW':'REJECT',h1.err)
  rec('4.3','owner received the BTC',String(SATS),String(await tokBal(ata(alice.publicKey))-before))
  const hinf=await conn.getAccountInfo(H.asset,CM)
  rec('4.4','...and the vault is GONE in the same transaction','gone',(hinf&&hinf.data.length>=33&&hinf.data[0]===1)?'still live':'gone')
  rec('4.5','no vault survives emptied: its asset-signer PDA holds nothing','0',String(await conn.getBalance(H.pda,CM)))
  rec('4.5a','BURN counted it: the electorate GOV divides by just shrank by one',String(burnedBefore+1),
    String((await conn.getAccountInfo(BURN_CFG,CM))!.data.readBigUInt64LE(OFF_BURNED_TOTAL)))
  rec('4.5b','...and BURN retired it in MINT by CPI, in the same instruction (off the payout schedule for good)','1,0',
    `${(await recOf(H.asset))![OFF_REC_RETIRED]},${(await recOf(H.asset))![OFF_REC_ACTIVE]}`)
  const sizer=new Transaction().add(...redeem)
  sizer.feePayer=alice.publicKey; sizer.recentBlockhash=(await conn.getLatestBlockhash()).blockhash
  const REDEEM_BYTES=sizer.serialize({requireAllSignatures:false,verifySignatures:false}).length
  rec('4.6','a 1-reserve-mint redemption fits a legacy transaction (1232 bytes)','true',String(REDEEM_BYTES<=1232),
    `serialized ${REDEEM_BYTES} bytes; headroom ${1232-REDEEM_BYTES}`)

  // ═══ RL. THE REDEMPTION RATE LIMIT (stage 3b, Gary 2026-10-03) ═══
  // At most 2.1% of LIVE vaults redeemed per window, whoever signs. If custodial
  // keys ever leaked, a thief could not empty those vaults faster than they can
  // be moved to fresh keys (a transfer is not limited; a redemption is).
  console.log('\n─── RL. redemptions: at most 2.1% of live vaults per window, ON CHAIN ───')
  {
    const k0=await bucket()
    let want=(k0.live*210n+9_999n)/10_000n; if(want<1n) want=1n
    rec('RL.1a','(here 2.1% of live supply rounds DOWN to zero, so rounding UP is what lets a vault out at all)','0',String(k0.live*210n/10_000n))
    const n=Number(k0.cap)+1
    const RLV:V[]=[]; for(let i=0;i<n;i++) RLV.push(await mkVault(0n))
    // An EMPTY window: the most recent redemption is at least a window old.
    for(let i=0;i<120;i++){ const k=await bucket(); if(k.empty) break; await sleep(1000) }
    const redeemNow=(v:V)=>att(()=>sendNow([ixOpen(v,alice.publicKey),ixBurn(v,alice.publicKey,declare(v.pda))],[alice]))
    // ALL AT ONCE against an EMPTY window: exactly the cap land.
    const res=await Promise.all(RLV.map(redeemNow))
    // A CONCURRENT send can surface only the confirm-stage status, which carries
    // the CODE and not the name, so the code is derived from BURN's own error
    // enum (its position + 6000) rather than typed in.
    const burnErrs=(BURN_SRC.slice(BURN_SRC.indexOf('pub enum BurnError'),BURN_SRC.indexOf('}',BURN_SRC.indexOf('pub enum BurnError')))
      .match(/\)\] (\w+),/g)||[]).map(x=>x.replace(/\)\] |,/g,''))
    const RL_CODE=6000+burnErrs.indexOf('RateLimited')
    const isRL=(e:string)=>e.includes('RateLimited')||e.includes(`"Custom":${RL_CODE}`)
    const okN=res.filter(r=>r.ok).length, limited=res.filter(r=>!r.ok&&isRL(r.err)).length
    rec('RL.2',`${n} redemptions at once against an EMPTY window: exactly the cap (${n-1}) land, the rest are RATE LIMITED`,
      `${n-1},1`,`${okN},${limited}`,res.map(r=>r.err).filter(Boolean).join(' | '))
    const vb=RLV[Math.max(0,res.findIndex(r=>!r.ok))]
    // A ROLLING WINDOW, NOT AN HOURLY COUNTER AND NOT A BUCKET: nothing refills
    // early, and there is no boundary to wait out. Room returns exactly when the
    // oldest of the last `cap` redemptions is a full window old.
    const k1=await bucket()
    await sleep(Math.floor(Number(k1.win)*600))
    const half=await redeemNow(vb)
    rec('RL.3','...60% of a window later it is STILL refused (a stage-3b bucket would already have refilled part of the cap)','REJECT',half.ok?'ALLOW':'REJECT',half.err)
    await waitRedeemToken()
    let sig4=''
    const okLater=await att(async()=>{ sig4=await sendNow([ixOpen(vb,alice.publicKey),ixBurn(vb,alice.publicKey,declare(vb.pda))],[alice]) })
    rec('RL.4','...and once the window has rolled past, the SAME redemption lands (the last vaults can always get out)','ALLOW',okLater.ok?'ALLOW':'REJECT',okLater.err)
    const {logs}=await logsOf(sig4)
    rec('RL.5','a redemption logs CBOB_REDEEMED <asset> for the public poster (X + the CBOB website)','true',
      String(logs.some(l=>l.includes(`CBOB_REDEEMED ${vb.asset.toBase58()}`))))
  }

  console.log('\n─── 5. round-4 fixes ───')
  const N=await mkVault()
  const miscount=new TransactionInstruction({...ixBurn(N,alice.publicKey,declare(N.pda)),
    data:Buffer.concat([d('burn_vault'),Buffer.from([declare(N.pda).length+1])])})
  const n1=await att(()=>send([ixOpen(N,alice.publicKey),...sweep(N,SATS,0),miscount],[alice]))
  rec('5.1','a burn declaring MORE accounts than it passes','REJECT',n1.ok?'ALLOW':'REJECT',n1.err)
  const n3=await att(()=>send([ixOpen(N,alice.publicKey),...sweep(N,SATS,0),
    new TransactionInstruction({programId:BURN_PROG,data:Buffer.concat([d('burn_vault'),Buffer.from([2])]),keys:[
    {pubkey:N.asset,isSigner:false,isWritable:true},{pubkey:COLL,isSigner:false,isWritable:true},
    {pubkey:alice.publicKey,isSigner:true,isWritable:false},
    {pubkey:N.pda,isSigner:false,isWritable:true},{pubkey:alice.publicKey,isSigner:true,isWritable:true},
    {pubkey:BURN_CFG,isSigner:false,isWritable:true},{pubkey:MINT_CFG,isSigner:false,isWritable:false},
    {pubkey:SYSVAR_INSTRUCTIONS_PUBKEY,isSigner:false,isWritable:false},
    {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
    {pubkey:MINT_PROG,isSigner:false,isWritable:false},{pubkey:MINT_CFG,isSigner:false,isWritable:true},
    {pubkey:vrec(N.asset),isSigner:false,isWritable:true},POOLK,
    ...declare(N.pda).map(p=>({pubkey:p,isSigner:false,isWritable:true}))]})],[alice]))
  rec('5.3','burn with a BOGUS seal_config account','REJECT',n3.ok?'ALLOW':'REJECT',n3.err)

  console.log('\n─── 6. provenance, and what redemption does to it ───')
  const P=await mkVault(SATS,[['notice','CBOB-NOTICE-0042'],['governor','yes']])
  await revealAll()
  const m0=attrMap(await fetchAsset(umi,P.umiAsset))
  rec('6.3','provenance is stamped at mint','CBOB-NOTICE-0042',String(m0.notice))
  rec('6.3a','...and survives the level being drawn onto it','yes',String(m0.governor))
  const p1=await att(()=>send([ixOpen(P,alice.publicKey),...sweep(P,SATS,0),ixBurn(P,alice.publicKey,declare(P.pda))],[alice]))
  rec('6.4','redeem it','ALLOW',p1.ok?'ALLOW':'REJECT',p1.err)
  const pinf=await conn.getAccountInfo(P.asset,CM)
  rec('6.5','a redeemed vault no longer exists','gone',(pinf&&pinf.data.length>=33&&pinf.data[0]===1)?'still live':'gone')
  const gonePa=await fetchAsset(umi,P.umiAsset).then(x=>attrMap(x)).catch(()=>({} as any))
  rec('6.6','...so its stamped provenance is unreadable','undefined',String(gonePa.notice))

  // ════════════ G2. the sweep, the guardian's hand-off, and who may vote ════════════
  console.log('\n─── G2. ONE vote restarts the sweep, ARMS a new guardian AND opens a round; a NEW vault cannot vote ───')
  // THE MISSED-WINDOW VAULT is minted here, before two voting windows, so its
  // capture window is long gone by the time it reaches the head of the queue
  // (L.15-L.17f). F2 misses its window too, and is rescheduled by a CRANK.
  const E=await mkVault(0n), F2=await mkVault(0n)
  const eRevealSlot=Number((await recOf(E.asset))!.readBigUInt64LE(OFF_REC_REVEAL))
  // 1.5 SOL: enough for one full-cap sweep and to leave the revenue address
  // under the (tightened) cap for section 8, which no vote can loosen back.
  await send([SystemProgram.transfer({fromPubkey:deployer.publicKey,toPubkey:REVENUE,lamports:1.5*LAMPORTS_PER_SOL})],[deployer])
  const sweepTo=(amt:bigint,dest:W)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('sweep_sol_for_swap'),u64(amt)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},
      {pubkey:REVENUE,isSigner:false,isWritable:true},{pubkey:dest,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  /** Wait out the sweep cooldown on the CHAIN clock. */
  const waitCooldown=async()=>{for(let i=0;i<120;i++){const c=await cfg()
    if((await chainNow())>=c.readBigInt64LE(OFF_LAST_SWEEP)+c.readBigInt64LE(OFF_SWEEP_COOLDOWN)+1n) return; await sleep(1000)}}
  const CAP=BigInt(LAMPORTS_PER_SOL)
  const gsw=await att(()=>send([sweepTo(1_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('6c.7','a sweep while the sweep is stopped','REJECT',gsw.ok?'ALLOW':'REJECT',gsw.err)
  const B2:Record<string,any>={}
  // RULE E: one proposal, two kinds, applied atomically.
  B2.multi=await propose([actBrakes({sweep:true,guardian:guardian2.publicKey}),actRound()])
  // A RESTART VOTED WHILE SALES ARE RUNNING. The guardian will stop sales AFTER
  // this opens; executing it then must not reopen them (3b.S1).
  B2.stale=await propose(actBrakes({sales:true}))
  B2.snap=await propose(actRound(),{votes:'none'})
  // THE ELECTORATE IS FIXED WHEN A PROPOSAL OPENS. A vault minted after it — the
  // shape that v5 relied on the Bank to refuse — cannot vote on it.
  const VN=await mkVault(0n)
  // VN, BEHIND E IN THE QUEUE, IS CAPTURED IN TIME: its entropy is fixed now, and
  // L.17e proves E's reschedule did not touch it.
  await waitEntropy(VN.asset)
  await send([ixCapture(VN.asset)],[deployer])
  const vnEntropy=Buffer.from((await recOf(VN.asset))!.subarray(OFF_REC_ENTROPY,OFF_REC_ENTROPY+32)).toString('hex')
  const vNew=await att(()=>send([ixVote(propId(B2.snap.id),VN,alice,true)],[deployer,alice]))
  rec('G.6','a vault minted AFTER the proposal opened votes on it','REJECT',vNew.ok?'ALLOW':'REJECT',vNew.err)
  const vOld=await att(()=>send([ixVote(propId(B2.snap.id),C1,alice,true)],[deployer,alice]))
  rec('G.7','...while a vault that existed when it opened may','ALLOW',vOld.ok?'ALLOW':'REJECT',vOld.err)
  await waitEnds(B2.snap.ends)
  const r2=(await cfg()).readUInt32LE(OFF_ROUND_ID)
  const xb=await exec(B2.multi.id)
  rec('6c.15','ONE VOTE restarts the sweep, arms a new guardian, and opens a round','ALLOW',xb.ok?'ALLOW':'REJECT',xb.err)
  // STAGE 3c: the guardian is ARMED, not set. The one in office keeps its brake
  // through the notice, so a captured vote cannot take the brake away at once.
  rec('6c.15a','...the sweep is running and the round advanced, but the OLD guardian is still in office with the new one PENDING',
    `0,0|${guardian.publicKey.toBase58()}|${r2+1}|${guardian2.publicKey.toBase58()},1`,
    `${await stops()}|${await guardianNow()}|${(await cfg()).readUInt32LE(OFF_ROUND_ID)}|${new W((await cfg()).subarray(OFF_PENDING_GUARDIAN,OFF_PENDING_GUARDIAN+32)).toBase58()},${(await cfg())[OFF_PENDING_GUARDIAN_SET]}`)
  const gEarly=await att(()=>send([ixApply('guardian')],[alice]))
  rec('3c.G1','ANYONE lands the new guardian before the notice has run','REJECT',gEarly.ok?'ALLOW':'REJECT',gEarly.err)
  await waitCooldown()
  const overCap=await att(()=>send([sweepTo(CAP+1n,swapOp.publicKey)],[alice,swapOp]))
  rec('6.15','sweep MORE than the (voted-down) on-chain cap','REJECT',overCap.ok?'ALLOW':'REJECT',overCap.err)
  const pendSweep=await att(()=>send([sweepTo(1_000_000n,newOp.publicKey)],[alice,newOp]))
  rec('6.23f','sweep to the PENDING operator before its notice has run','REJECT',pendSweep.ok?'ALLOW':'REJECT',pendSweep.err)
  const underCap=await att(()=>send([sweepTo(CAP,swapOp.publicKey)],[alice,swapOp]))
  rec('6.16','sweep exactly the cap, to the operator still in office','ALLOW',underCap.ok?'ALLOW':'REJECT',underCap.err)
  // Round 22 (F20): wait the cooldown out first, or the FIRST sweep is refused as
  // too soon and this arm never reaches the three-in-one-transaction case.
  await waitCooldown()
  const loopShut=await att(()=>send([sweepTo(1_000_000n,swapOp.publicKey),sweepTo(1_000_000n,swapOp.publicKey),
    sweepTo(1_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('6.17','three sweeps in ONE transaction, each under the cap','REJECT',loopShut.ok?'ALLOW':'REJECT',loopShut.err)
  const strangerSweep=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('sweep_sol_for_swap'),u64(1_000_000n)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:REVENUE,isSigner:false,isWritable:true},
      {pubkey:swapOp.publicKey,isSigner:false,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[alice]))
  rec('6.17a','a stranger sweeps without the operator signing','REJECT',strangerSweep.ok?'ALLOW':'REJECT',strangerSweep.err)
  const zeroSweep=await att(()=>send([sweepTo(0n,swapOp.publicKey)],[alice,swapOp]))
  rec('6.17b','a ZERO sweep, which moves nothing and burns the whole cooldown','REJECT',zeroSweep.ok?'ALLOW':'REJECT',zeroSweep.err)
  await waitNotice(OFF_PENDING_GUARDIAN_AT)
  const gApply=await att(()=>send([ixApply('guardian')],[alice]))
  rec('3c.G2','...once the notice has run, ANYONE lands it: the vote\'s guardian takes office, the slot is cleared',
    `ALLOW|${guardian2.publicKey.toBase58()}|0`,`${gApply.ok?'ALLOW':'REJECT'}|${await guardianNow()}|${(await cfg())[OFF_PENDING_GUARDIAN_SET]}`,gApply.err)
  const gs3=await att(()=>send([ixStop('sales',guardian)],[guardian]))
  rec('6c.18','the OLD guardian pulls the brake','REJECT',gs3.ok?'ALLOW':'REJECT',gs3.err)
  const gs4=await att(()=>send([ixStop('sales',guardian2),ixStop('sweep',guardian2)],[guardian2]))
  rec('6c.19','the NEW guardian stops sales AND the sweep in one transaction','ALLOW',gs4.ok?'ALLOW':'REJECT',gs4.err)
  rec('6.20h','...while a replacement operator is still PENDING (the brake covers the notice period)',newOp.publicKey.toBase58(),
    new W((await cfg()).subarray(OFF_PENDING_OP,OFF_PENDING_OP+32)).toBase58())
  // STAGE 3c (red-team 2 #2): the guardian may CANCEL a pending operator. A stop,
  // so it is the guardian's; nobody else's.
  const kc0=await att(()=>send([ixStopCancel(alice)],[alice]))
  rec('3c.K3','a STRANGER cancels the pending swap operator','REJECT',kc0.ok?'ALLOW':'REJECT',kc0.err)
  const kc1=await att(()=>send([ixStopCancel(guardian2)],[guardian2]))
  rec('3c.K4','the GUARDIAN cancels the pending swap operator: the slot is cleared, the operator in office is untouched',
    `ALLOW|11111111111111111111111111111111|${swapOp.publicKey.toBase58()}`,
    `${kc1.ok?'ALLOW':'REJECT'}|${new W((await cfg()).subarray(OFF_PENDING_OP,OFF_PENDING_OP+32)).toBase58()}|${new W((await cfg()).subarray(OFF_SWAP_OPERATOR,OFF_SWAP_OPERATOR+32)).toBase58()}`,kc1.err)
  const kc2=await att(()=>send([ixApply('swap_operator')],[alice]))
  rec('3c.K4a','...so there is nothing left to land','REJECT',kc2.ok?'ALLOW':'REJECT',kc2.err)
  const gbm=await att(()=>mkVault(0n))
  rec('8.12','minting while stopped','REJECT',gbm.ok?'ALLOW':'REJECT',gbm.err)
  const gbG=await att(()=>send([ixGovSigned(Buffer.concat([d('restart'),Buffer.from([1,1]),i64(Math.floor(Date.now()/1000))]),guardian2)],[guardian2]))
  rec('8.13b','the NEW guardian tries to restart','REJECT',gbG.ok?'ALLOW':'REJECT',gbG.err)
  // A RATIFIED RESTART IS NOT A BEARER INSTRUMENT FOR THE NEXT EMERGENCY. Stage
  // 3c: it is a logged no-op rather than a revert, so it could not have taken a
  // bundle down with it either.
  let sigStale=''
  const stale=await att(async()=>{ sigStale=await send([ixExec(propId(B2.stale.id))],[deployer]) })
  rec('3b.S1','execute a restart that was VOTED BEFORE the stop it would lift: a logged no-op','ALLOW,true',
    `${stale.ok?'ALLOW':'REJECT'},${(await logsOf(sigStale)).logs.some(l=>l.includes('CBOB_ACTION_SKIPPED')&&l.includes('stop_is_newer'))}`,stale.err)
  rec('3b.S1a','...and sales stay stopped','1',String((await cfg())[OFF_SALES_STOPPED]))
  {
    const at0=(await cfg()).readBigInt64LE(OFF_SALES_STOPPED_AT)
    await sleep(2000)
    const again=await att(()=>send([ixStop('sales',guardian2)],[guardian2]))
    rec('3b.S2','the guardian re-pulls an already-pulled brake: allowed, and the stop time does NOT move','ALLOW,true',
      `${again.ok?'ALLOW':'REJECT'},${(await cfg()).readBigInt64LE(OFF_SALES_STOPPED_AT)===at0}`,
      'a moving stop time would let a hostile guardian out-date every restart vote')
  }

  // ════════════ G3. ONE proposal, all four kinds ════════════
  console.log('\n─── G3. one vote restarts both, tightens the cooldown, opens a round and arms an operator; another retires the brake ───')
  const B3:Record<string,any>={}
  // Stage 3c: the guardian change rides in its OWN proposal (it may never share
  // one with an operator arm), so the four kinds are a restart, not a retirement.
  const ALL4=[actBrakes({sales:true,sweep:true}),actTighten({sweepCooldown:20}),actRound(),actArm(newOp2.publicKey)]
  B3.all=await propose(ALL4)
  rec('E.3','a proposal carrying all FOUR kinds is created','ALLOW',B3.all.ok?'ALLOW':'REJECT',B3.all.err)
  B3.retire=await propose(actBrakes({guardian:null}))
  // ROUND 24 SHIP-GATE-5 PIN (W4): the same retirement spelled as the DEFAULT key.
  B3.retireDef=await propose(actBrakes({guardian:new W('11111111111111111111111111111111')}))
  {
    const tx=new Transaction().add(ixPropA(B3.all.id+1,C1.asset,alice,now()+999,ALL4)); tx.feePayer=alice.publicKey
    tx.recentBlockhash='11111111111111111111111111111111'
    const n=tx.serialize({requireAllSignatures:false,verifySignatures:false}).length
    rec('E.3a','...and the four-action create fits a legacy transaction','true',String(n<=1232),`${n} bytes`)
  }
  await waitEnds(Math.max(B3.all.ends,B3.retire.ends,B3.retireDef.ends))
  const r3=(await cfg()).readUInt32LE(OFF_ROUND_ID)
  let sigAll=''
  const gg2=await att(async()=>{ sigAll=await send([ixExec(propId(B3.all.id))],[deployer]) })
  rec('6c.20','a VOTE restarts both, tightens the cooldown, opens a round, arms an operator: ONE transaction','ALLOW',gg2.ok?'ALLOW':'REJECT',gg2.err)
  {
    const c=await cfg()
    rec('6c.20a','...both running, the guardian still in office','0,0|'+guardian2.publicKey.toBase58(),`${await stops()}|${await guardianNow()}`)
    rec('6.18','...the cooldown is the tighter 20s','20',String(c.readBigInt64LE(OFF_SWEEP_COOLDOWN)))
    rec('E.3b','...the round advanced and the NEW operator is the pending one (armed here, with half of all live vaults)',
      `${r3+1},${newOp2.publicKey.toBase58()}`,`${c.readUInt32LE(OFF_ROUND_ID)},${new W(c.subarray(OFF_PENDING_OP,OFF_PENDING_OP+32)).toBase58()}`)
    let cu=0; for(let i=0;i<20&&!cu;i++){const t=await conn.getTransaction(sigAll,{commitment:CM,maxSupportedTransactionVersion:0})
      cu=t?.meta?.computeUnitsConsumed??0; if(!cu) await sleep(250)}
    rec('E.3c','the four-action execute (five CPIs) stays under the 400,000 CU regression ceiling','true',String(cu>0&&cu<400_000),`${cu} CU`)
  }
  let sigRet=''
  const xRet=await att(async()=>{ sigRet=await send([ixExec(propId(B3.retire.id))],[deployer]) })
  rec('6c.20b','a SEPARATE vote, with YES from half of all live vaults, retires the brake: armed, still in office','ALLOW|'+guardian2.publicKey.toBase58(),
    `${xRet.ok?'ALLOW':'REJECT'}|${await guardianNow()}`,xRet.err)
  {
    // Round 24 W4: `arm_guardian` takes Option<Pubkey> and stores unwrap_or_default,
    // so Some(default) IS None. Executed after it (a newer id, so not superseded):
    // the same pending key, the same flag, the guardian in office untouched, and
    // the same log line once its timestamp is set aside.
    const st=async()=>{const c=await cfg(); return `${new W(c.subarray(OFF_PENDING_GUARDIAN,OFF_PENDING_GUARDIAN+32)).toBase58()},${c[OFF_PENDING_GUARDIAN_SET]},${await guardianNow()}`}
    const armed=async(sig:string)=>((await logsOf(sig)).logs.find(l=>l.includes('CBOB_GUARDIAN_ARMED'))??'no CBOB_GUARDIAN_ARMED line').replace(/ applies_after=\d+/,'')
    const s0=await st(), l0=await armed(sigRet)
    let sigD=''; const xd=await att(async()=>{ sigD=await send([ixExec(propId(B3.retireDef.id))],[deployer]) })
    rec('R24.2','Brakes{guardian: Some(default key)} executed leaves EXACTLY the state, and logs exactly the line, of Brakes{guardian: None}',
      `ALLOW|${s0}|${l0}`,`${xd.ok?'ALLOW':'REJECT'}|${await st()}|${xd.ok?await armed(sigD):''}`,xd.err)
  }
  await waitNotice(OFF_PENDING_GUARDIAN_AT)
  await send([ixApply('guardian')],[alice])
  rec('6c.20c','...and after the notice, no guardian on chain','11111111111111111111111111111111',await guardianNow())
  const gs5=await att(()=>send([ixStop('sweep',guardian2)],[guardian2]))
  rec('6c.21','...after which NOBODY can pull it, not even the last guardian','REJECT',gs5.ok?'ALLOW':'REJECT',gs5.err)
  await waitCooldown()
  const sw19=await att(()=>send([sweepTo(1_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('6.19a','a sweep once the (longer) cooldown has passed','ALLOW',sw19.ok?'ALLOW':'REJECT',sw19.err)
  const tooSoon=await att(()=>send([sweepTo(1_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('6.19b','a second sweep inside the cooldown','REJECT',tooSoon.ok?'ALLOW':'REJECT',tooSoon.err)

  // ═══ L (cont.). A MISSED WINDOW IS RESCHEDULED, NEVER DEFAULTED ═══
  // Gary, 2026-10-03: "We can't lock everyone in the lowest level."
  await waitSlotPast(eRevealSlot+REVEAL_WINDOW)
  const capLate=await att(()=>send([ixCapture(E.asset)],[deployer]))
  rec('L.15','capture a vault\'s entropy after its window has passed','REJECT',capLate.ok?'ALLOW':'REJECT',capLate.err)
  {
    // E is the head of the queue only once everything minted before it is drawn.
    const eIdx=Number((await recOf(E.asset))!.readBigUInt64LE(OFF_REC_INDEX))
    await revealAllUpTo(eIdx)
    const rvE0=await att(()=>send([ixReveal(E.asset,E.attrs)],[deployer]))
    rec('L.16','reveal a vault whose window passed with NO entropy (stage 2 gave it the lowest level)','REJECT',rvE0.ok?'ALLOW':'REJECT',rvE0.err)
    const vnFirst=await att(()=>send([ixReveal(VN.asset,VN.attrs)],[deployer]))
    rec('L.16a','...and the vault BEHIND it, entropy in hand, still waits (nobody behind is drawn first)','REJECT',vnFirst.ok?'ALLOW':'REJECT',vnFirst.err)
    const Fr=await mkVault(0n)
    await waitEntropy(Fr.asset)
    const early=await att(()=>send([ixReschedule(Fr.asset)],[deployer]))
    rec('L.16b','reschedule a vault whose window is still OPEN (capture it instead)','REJECT',early.ok?'ALLOW':'REJECT',early.err)
    await send([ixCapture(Fr.asset)],[deployer])
    const sig=await send([ixReschedule(E.asset)],[deployer])
    const {logs,slot}=await logsOf(sig)
    const r=(await recOf(E.asset))!
    const newRs=Number(r.readBigUInt64LE(OFF_REC_REVEAL))
    rec('L.17','the missed window is RESCHEDULED to a slot that did not exist when it landed',String(slot+REVEAL_LEAD),String(newRs),
      `rescheduled in slot ${slot}; was ${eRevealSlot}, now ${newRs}`)
    rec('L.17a','...with a DISTINCT log line the alarm pages on','true',String(logs.some(l=>l.includes('CBOB_REVEAL_RESCHEDULED'))))
    rec('L.17b','...and the record counts it','1',String(r.readUInt16LE(OFF_REC_RESCHED)))
    // THE CRANK RESCHEDULES TOO: a claim that is handed F2 (window missed) moves it.
    const f2Before=Number((await recOf(F2.asset))!.readBigUInt64LE(OFF_REC_REVEAL))
    const csig=await send([ixPoolClaim([C1],{crank:[F2.asset]})],[deployer])
    const cl=await logsOf(csig)
    rec('L.17c','a CLAIM handed a vault whose window was missed reschedules it, logged','true,1',
      `${cl.logs.some(l=>l.includes('CBOB_REVEAL_RESCHEDULED'))},${(await recOf(F2.asset))!.readUInt16LE(OFF_REC_RESCHED)}`,
      `reveal slot ${f2Before} -> ${(await recOf(F2.asset))!.readBigUInt64LE(OFF_REC_REVEAL)}`)
    await readyToReveal(E)
    const k=await census(); const e=(await recOf(E.asset))!.subarray(OFF_REC_ENTROPY,OFF_REC_ENTROPY+32)
    const want=drawOf(Buffer.from(e),k.caps,k.minted)
    const rvE=await att(()=>send([ixReveal(E.asset,E.attrs)],[deployer]))
    rec('L.17d','...and it draws from REAL entropy, re-derived independently (never a default)',`ALLOW,${want}`,
      `${rvE.ok?'ALLOW':'REJECT'},${(await recOf(E.asset))![OFF_REC_LEVEL]}`,rvE.err)
    rec('L.17e','the vault behind it kept the entropy it captured before the reschedule',vnEntropy,
      Buffer.from((await recOf(VN.asset))!.subarray(OFF_REC_ENTROPY,OFF_REC_ENTROPY+32)).toString('hex'))
  }
  async function revealAllUpTo(stop:number){
    for(;;){ const c=await cfg(); const next=Number(c.readBigUInt64LE(OFF_REVEALED)); if(next>=stop) return
      let v:V|undefined
      for(const x of VAULTS){const r=await recOf(x.asset); if(r&&Number(r.readBigUInt64LE(OFF_REC_INDEX))===next){v=x;break}}
      if(!v) throw new Error(`no known vault at mint index ${next}`)
      await readyToReveal(v)
      await send([ixReveal(v.asset,v.attrs)],[deployer]) } }
  await revealAll()

  // ════════════ G4. LIVE SUPPLY IS THE DIVISOR, the 10% turnout, and a tighter sweep ════════════
  console.log('\n─── G4. quorum against the LIVE electorate, and YES must reach 10% of it ───')
  const B4:Record<string,any>={}
  // Strictly tighter than what G1-G3 left (reserve 0.06 SOL, cap 1 SOL, cooldown 20s).
  // ROUND 25 (round-24 C9): an OLDER tightening, LESS tight than the newer one below,
  // executed AFTER it (8.14b): `tighten_sweep` is max/min, so it must change nothing.
  B4.tOld=await propose(actTighten({solReserve:65_000_000n,maxSweep:950_000_000n}))
  B4.home=await propose(actTighten({solReserve:70_000_000n,maxSweep:900_000_000n,sweepCooldown:21}))
  B4.guard=await propose(actBrakes({guardian:guardian.publicKey}))
  // RED-TEAM 3 #4: an OLDER round, then a NEWER one whose round will be over by
  // the time it executes. The newer still supersedes the older.
  B4.oldRound=await propose(actRound(PRICE,7))
  B4.overRound=await propose(actRound(PRICE,8,now()-60,now()+VOTE_SECS+12))
  // ROUND 22 (F18): NO VOTES. Until now no arm ever cast one. Two harmless
  // proposals (restart sales, which are running): one at 50% YES, below the 60%
  // threshold; one at exactly 60%. Both clear quorum and the 10% turnout.
  B4.nay=await propose(actBrakes({sales:true}),{votes:'none'})
  B4.exact=await propose(actBrakes({sales:true}),{votes:'none'})
  {
    const p=await readProp(B4.nay.id); const k=Math.ceil(Math.max(p.need,p.needYes)/3)
    const elig=await voters(p.indexSnapshot)
    const castAll=async(id:number,yes:number,no:number)=>{ for(const [i,{v,kp}] of elig.slice(0,yes+no).entries())
      await send([ixVote(propId(id),v,kp,i<yes)],[deployer,kp]) }
    B4.voters=elig.length; B4.k=k
    await castAll(B4.nay.id,3*k,3*k)
    await castAll(B4.exact.id,3*k,2*k)
  }
  B4.live=await propose(actRound(),{votes:'none'})
  // RULE D: a proposal carried by quorum and threshold alone, with YES under 10%.
  B4.turnout=await propose(actRound(),{votes:'quorumOnly'})
  {
    const c=await cfg(); const minted=Number(c.readBigUInt64LE(OFF_MINTED_TOTAL))
    const burned=Number((await conn.getAccountInfo(BURN_CFG,CM))!.data.readBigUInt64LE(OFF_BURNED_TOTAL))
    const p=await readProp(B4.live.id)
    rec('G.8','a proposal\'s divisor is LIVE supply (minted - burned) when it opens',String(minted-burned),String(p.quorumSupply),
      `${minted} minted, ${burned} burned through our burn path`)
    const needMinted=Math.max(Math.ceil(minted*p.qbps/10000),Math.ceil(minted*1000/10000))
    rec('G.9','...so burns LOWER the divisor, and the bar never rises above the old one','true,true',
      `${p.quorumSupply<minted},${p.eff<=needMinted}`,`needs ${p.eff} YES (quorum ${p.need}, turnout ${p.needYes}); dividing by supply ever minted: ${needMinted}`)
    const elig=await voters(p.indexSnapshot)
    for(const {v,kp} of elig.slice(0,p.eff)) await send([ixVote(propId(B4.live.id),v,kp,true)],[deployer,kp])
    B4.liveNeed=p.eff; B4.liveNeedMinted=needMinted
    const t=await readProp(B4.turnout.id)
    rec('D.0','(precondition) quorum needs FEWER votes than the 10% turnout here, and the proposal holds exactly the quorum, all YES',
      `true,${t.need},0`,`${t.need<t.needYes},${t.yes},${t.no}`,`live ${t.quorumSupply}: quorum ${t.need}, turnout ${t.needYes}`)
  }
  await waitEnds(Math.max(B4.live.ends,B4.turnout.ends))
  const xd=await exec(B4.turnout.id)
  rec('D.1','execute a proposal that meets quorum and threshold (100% YES) but not the 10% turnout','REJECT',xd.ok?'ALLOW':'REJECT',xd.err)
  {
    while(now()<=B4.overRound.ends+14) await sleep(500)
    const r0=(await cfg()).readUInt32LE(OFF_ROUND_ID)
    const xo=await exec(B4.overRound.id), xold=await exec(B4.oldRound.id)
    rec('3c.R1','a NEWER round already over is skipped, and the OLDER one after it is skipped too (it was superseded)',
      `ALLOW,ALLOW,${r0}`,`${xo.ok?'ALLOW':'REJECT'},${xold.ok?'ALLOW':'REJECT'},${(await cfg()).readUInt32LE(OFF_ROUND_ID)}`,`${xo.err} ${xold.err}`)
  }
  const xh=await exec(B4.home.id)
  rec('8.14','a ratified TightenSweep tightens all three sweep bounds at once','ALLOW',xh.ok?'ALLOW':'REJECT',xh.err)
  {
    const c=await cfg()
    rec('8.14a','...and MINT took GOV\'s SweepTighten byte for byte','70000000|900000000|21',
      `${c.readBigUInt64LE(OFF_SOL_RESERVE)}|${c.readBigUInt64LE(OFF_MAX_SWEEP)}|${c.readBigInt64LE(OFF_SWEEP_COOLDOWN)}`)
  }
  {
    const xo=await exec(B4.tOld.id); const c=await cfg()
    rec('8.14b','an OLDER, looser TightenSweep executed AFTER the newer one lands and changes NOTHING (max/min, never a loosening)',
      `true,ALLOW|70000000|900000000|21`,`${B4.tOld.id<B4.home.id},${xo.ok?'ALLOW':'REJECT'}|${c.readBigUInt64LE(OFF_SOL_RESERVE)}|${c.readBigUInt64LE(OFF_MAX_SWEEP)}|${c.readBigInt64LE(OFF_SWEEP_COOLDOWN)}`,xo.err)
  }
  const xg=await exec(B4.guard.id)
  rec('8.15','a vote installs a guardian again (from None)','ALLOW',xg.ok?'ALLOW':'REJECT',xg.err)
  await waitNotice(OFF_PENDING_GUARDIAN_AT)
  await send([ixApply('guardian')],[alice])
  rec('8.15a','...and after the notice it is the one the vote named',guardian.publicKey.toBase58(),await guardianNow())
  const xl=await exec(B4.live.id)
  rec('G.10',`it PASSES with exactly the YES it needs (${B4.liveNeed}; ${B4.liveNeedMinted} under the old divisor)`,
    'ALLOW',xl.ok?'ALLOW':'REJECT',xl.err)
  {
    while(now()<=Math.max(B4.nay.ends,B4.exact.ends)+1) await sleep(500)
    const pn=await readProp(B4.nay.id), pe=await readProp(B4.exact.id)
    rec('F18.0','(precondition) both carry NO votes and clear quorum and turnout on YES alone','true',
      String(Number(pn.no)>0&&Number(pe.no)>0&&Number(pn.yes)>=Math.max(pn.need,pn.needYes)&&Number(pe.yes)>=Math.max(pe.need,pe.needYes)),
      `nay ${pn.yes}/${pn.no}, exact ${pe.yes}/${pe.no}, ${B4.voters} eligible`)
    const xn=await exec(B4.nay.id)
    rec('F18.1','a proposal at 50% YES (below the 60% threshold) is REFUSED','REJECT',xn.ok?'ALLOW':'REJECT',xn.err)
    const xe=await exec(B4.exact.id)
    rec('F18.2','...and one at EXACTLY 60% YES passes','ALLOW',xe.ok?'ALLOW':'REJECT',xe.err)
  }

  // ════════════ 8. REVENUE: one address in, 85/15 out ════════════
  console.log('\n─── 8. revenue: one address in, enforced 85/15 out ───')
  // v6 stage 3: the HOLDERS' side is THE POOL. There is no distributor wallet.
  const holdersAta=POOL, bankAta=ata(bankTreasury.publicKey)
  // Made NOW, while the pool is empty, so its own mint runs no distribution: IN.1
  // redeems it as one of three hosts landing together.
  const RD=await mkVault(0n)
  await send([createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,bankAta,bankTreasury.publicKey,mint)],[deployer])
  // NOTHING CAN VOTE THE MONEY ELSEWHERE (stage 3b): the only sweep change a vote
  // can carry is SweepTighten, and it has no field for any destination, the
  // split, or the supply. The struct must EXIST in both, or this proves nothing.
  const structBody=(src:string,name:string)=>{const i=src.indexOf(`pub struct ${name} {`); return i<0?'NOT FOUND':src.slice(i,src.indexOf('}',i))}
  const money=/pub (treasury|pool\w*|bank_treasury|split_bps|max_supply|swap_operator):/
  rec('P.0e','the one vote-carried wiring struct (MINT\'s and GOV\'s SweepTighten) has no field for a destination, the split or the supply',
    'true,true,false,false',`${structBody(MINT_SRC,'SweepTighten')!=='NOT FOUND'},${structBody(GOV_SRC,'SweepTighten')!=='NOT FOUND'},`
    +`${money.test(structBody(MINT_SRC,'SweepTighten'))},${money.test(structBody(GOV_SRC,'SweepTighten'))}`)
  rec('P.0f','...and no WiringArgs survives in either program','NOT FOUND,NOT FOUND',`${structBody(MINT_SRC,'WiringArgs')},${structBody(GOV_SRC,'WiringArgs')}`)
  const INCOME=1_000_000_000n
  await send([createTransferInstruction(ata(deployer.publicKey),revAta,deployer.publicKey,INCOME)],[deployer])
  const revTotal=await tokBal(revAta)
  rec('8.1','the revenue address holds the mint prices AND the income, all cbBTC','true',String(revTotal>INCOME),
    `${revTotal} sats: ${revTotal-INCOME} from voted-round mints + ${INCOME} other income`)
  const splitTo=(rev:W,hold:W,bnk:W)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('split_revenue'),Buffer.from([8])]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:false},{pubkey:REVENUE,isSigner:false,isWritable:true},
      {pubkey:mint,isSigner:false,isWritable:false},{pubkey:rev,isSigner:false,isWritable:true},
      {pubkey:hold,isSigner:false,isWritable:true},{pubkey:bnk,isSigner:false,isWritable:true},
      {pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false}]})
  const ixSplit=splitTo(revAta,holdersAta,bankAta)
  const thief=ata(alice.publicKey)
  const spA=await att(()=>send([splitTo(revAta,thief,bankAta)],[alice]))
  rec('8.2a',"split with the caller's own account as the HOLDERS destination",'REJECT',spA.ok?'ALLOW':'REJECT',spA.err)
  const spB=await att(()=>send([splitTo(revAta,holdersAta,thief)],[alice]))
  rec('8.2b',"split with the caller's own account as the 15% destination",'REJECT',spB.ok?'ALLOW':'REJECT',spB.err)
  const spC=await att(()=>send([splitTo(thief,holdersAta,bankAta)],[alice]))
  rec('8.2c','split reading a SOURCE the caller supplies','REJECT',spC.ok?'ALLOW':'REJECT',spC.err)
  rec('8.2e','the revenue balance is UNTOUCHED by the three refusals',String(revTotal),String(await tokBal(revAta)))
  const splitOther=await att(()=>send([new TransactionInstruction({...splitTo(revAta,holdersAta,bankAta),
    keys:splitTo(revAta,holdersAta,bankAta).keys.map((k,i)=>i===2?{...k,pubkey:otherMint}:k)})],[alice]))
  rec('P.0d','split a token that is NOT the payment mint (the pool can only pay cbBTC)','REJECT',splitOther.ok?'ALLOW':'REJECT',splitOther.err)
  const frozenSplitBefore=[await tokBal(revAta),await tokBal(holdersAta),await tokBal(bankAta)]
  await send([createFreezeAccountInstruction(bankAta,mint,deployer.publicKey)],[deployer])
  const frozenSplit=await att(()=>send([ixSplit],[alice]))
  rec('R28.F1','a frozen 15% destination refuses the split','REJECT',frozenSplit.ok?'ALLOW':'REJECT',frozenSplit.err)
  rec('R28.F2','the refused split leaves revenue and BOTH destinations unchanged',frozenSplitBefore.join(','),
    [await tokBal(revAta),await tokBal(holdersAta),await tokBal(bankAta)].join(','))
  await send([createThawAccountInstruction(bankAta,mint,deployer.publicKey)],[deployer])
  const poolBefore=await tokBal(holdersAta)
  const sp=await att(()=>send([ixSplit],[alice]))
  rec('8.2','ANYONE can trigger the split (destinations are pinned)','ALLOW',sp.ok?'ALLOW':'REJECT',sp.err)
  const bankCut=revTotal*1500n/10000n
  rec('8.3','THE POOL received the 85% (the remainder)',String(revTotal-bankCut),String(await tokBal(holdersAta)-poolBefore))
  rec('8.4','the project treasury received the floored 15%',String(bankCut),String(await tokBal(bankAta)))
  rec('8.5','nothing was left behind or created','0',String(await tokBal(revAta)))
  const sp2=await att(()=>send([ixSplit],[alice]))
  rec('8.6','splitting an empty revenue address','REJECT',sp2.ok?'ALLOW':'REJECT',sp2.err)
  {
    const b={h:await tokBal(holdersAta),b:await tokBal(bankAta)}
    await send([createTransferInstruction(ata(deployer.publicKey),revAta,deployer.publicKey,7n)],[deployer])
    const spr=await att(()=>send([ixSplit],[alice]))
    rec('8.6a','split an amount that does NOT divide evenly','ALLOW',spr.ok?'ALLOW':'REJECT',spr.err)
    rec('8.6b','the 15% side takes the FLOOR of its share','1',String(await tokBal(bankAta)-b.b))
    rec('8.6c','the holders take the remainder, including the rounding','6',String(await tokBal(holdersAta)-b.h))
  }
  await waitCooldown()
  const revSol=BigInt(await conn.getBalance(REVENUE,CM))
  const w1=await att(()=>send([sweepTo(revSol,swapOp.publicKey)],[deployer,swapOp]))
  rec('8.7','sweeping SOL that would breach the fee reserve','REJECT',w1.ok?'ALLOW':'REJECT',w1.err)
  const safe=revSol-(await cfg()).readBigUInt64LE(OFF_SOL_RESERVE)
  rec('8.7p','(precondition) the revenue balance is under the (voted-down) cap, so 8.7 can only fail on the reserve','true',
    String(revSol<=(await cfg()).readBigUInt64LE(OFF_MAX_SWEEP)),`${revSol} lamports vs cap ${(await cfg()).readBigUInt64LE(OFF_MAX_SWEEP)}`)
  await waitCooldown()
  const opBefore=BigInt(await conn.getBalance(swapOp.publicKey,CM))
  const w2=await att(()=>send([sweepTo(safe,swapOp.publicKey)],[deployer,swapOp]))
  rec('8.8','sweeping what the reserve allows','ALLOW',w2.ok?'ALLOW':'REJECT',w2.err)
  rec('8.9','the operator received it',String(safe),String(BigInt(await conn.getBalance(swapOp.publicKey,CM))-opBefore))
  const w3=await att(()=>send([sweepTo(1n,alice.publicKey)],[alice]))
  rec('8.10','sweeping SOL to an address of the caller\'s choosing','REJECT',w3.ok?'ALLOW':'REJECT',w3.err)
  await send([SystemProgram.transfer({fromPubkey:deployer.publicKey,toPubkey:REVENUE,lamports:1_000_000})],[deployer])
  await waitCooldown()
  const w4=await att(()=>send([sweepTo(1_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('8.10b','a stranger PAYS while the operator signs (the cron needs this)','ALLOW',w4.ok?'ALLOW':'REJECT',w4.err)

  // ═══ IN. THE MONTHLY DISTRIBUTION RUNS ITSELF (Gary, 2026-10-03: "the monthly
  // path should run programmatically without any human interaction and require
  // NO $GARY burn"). The splits above put revenue in the pool; nobody calls
  // `distribute`. Ordinary traffic does it, exactly once.
  console.log('\n─── IN. the monthly distribution rides on ordinary traffic, once per period ───')
  {
    await waitDue()
    const p0=await pool()
    rec('IN.1p','(precondition) DUE, the pool holds undistributed revenue, a vault is active','true',String(p0.avail>0n&&p0.w>0n),
      `${p0.avail} sats over weight ${p0.w}`)
    const kIn=Keypair.generate()
    await waitRedeemToken()
    const sigs=['','','']
    const r=await Promise.all([
      att(async()=>{ sigs[0]=await sendNow([ixMint(kIn.publicKey,alice.publicKey,alice.publicKey)],[alice,kIn]) }),
      att(async()=>{ sigs[1]=await sendNow([ixPoolClaim([C1])],[deployer]) }),
      att(async()=>{ sigs[2]=await sendNow([ixOpen(RD,alice.publicKey),ixBurn(RD,alice.publicKey,declare(RD.pda))],[alice]) })])
    if(r[0].ok) mkV(kIn,alice,[])
    const logs=await Promise.all(sigs.map(x=>x?sigLogs(x):Promise.resolve([] as string[])))
    const slots=await Promise.all(sigs.map(async x=>x?(await logsOf(x)).slot:0))
    rec('IN.1','a mint, a claim and a redemption land TOGETHER while the month is due: none of them fails','ALLOW,ALLOW,ALLOW',
      r.map(x=>x.ok?'ALLOW':'REJECT').join(','),r.map(x=>x.err).filter(Boolean).join(' | '))
    rec('IN.2','...and EXACTLY ONE of them ran the distribution, logged path=monthly_inline','1,true',
      `${logs.reduce((a,l)=>a+l.length,0)},${logs.flat().every(l=>l.includes('path=monthly_inline'))}`,
      `per host [mint,claim,redeem]: ${logs.map(l=>l.length).join(',')}; slots ${slots.join(',')}`)
    const p1=await pool()
    rec('IN.3','...crediting ALL of it to the active vaults: nothing undistributed is left, and the accumulator moved','0,true',
      `${p1.avail},${p1.acc>p0.acc}`)
    await ck('IN','IN.1')
    const sigN=await send([ixPoolClaim([C1])],[deployer])
    rec('IN.4','a host right after (NOT due) runs no distribution','0',String((await sigLogs(sigN)).length))
    await ck('IN','IN.4')
  }

  // ════════════ 9. NESTING AND AIRDROPS — CHARACTERISED, NOT ASSUMED ════════════
  console.log('\n─── 9. nesting + airdrops (the hazard, measured) ───')
  const OUTER=await mkVault(SATS), INNER=await mkVault(SATS)
  const x0=await att(()=>send([ixOpen(OUTER,alice.publicKey),...sweep(OUTER,SATS,0),
    ixBurn(INNER,alice.publicKey,declare(INNER.pda)),ixBurn(OUTER,alice.publicKey,declare(OUTER.pda))],[alice]))
  rec('9.0','burn vault INNER off the back of vault OUTER\'s thaw','REJECT',x0.ok?'ALLOW':'REJECT',x0.err)
  const nest=await att(()=>transfer(umi,{asset:{publicKey:INNER.umiAsset,owner:aliceU.publicKey} as any,
    collection:{publicKey:coll.publicKey} as any,newOwner:pk(OUTER.pda.toBase58()),authority:aliceU})
    .sendAndConfirm(umi,{confirm:{commitment:CM}}))
  rec('9.1','Core PERMITS sending one vault into another','ALLOW',nest.ok?'ALLOW':'REJECT',nest.err)
  const innerNow:any=nest.ok?await fetchAsset(umi,INNER.umiAsset):null
  rec('9.2','the inner vault is now owned by the outer vault\'s asset-signer PDA',OUTER.pda.toBase58(),String(innerNow?.owner||'n/a'))
  const inner1=await att(()=>send([ixOpen(INNER,alice.publicKey),...sweep(INNER,SATS,0),ixBurn(INNER,alice.publicKey,declare(INNER.pda))],[alice]))
  rec('9.3','redeem a NESTED vault (alice no longer owns it)','REJECT',inner1.ok?'ALLOW':'REJECT',inner1.err)
  const out1=await att(()=>send([ixOpen(OUTER,alice.publicKey),...sweep(OUTER,SATS,0),
    ixBurn(OUTER,alice.publicKey,[...declare(OUTER.pda),INNER.asset])],[alice]))
  rec('9.4','burn the outer vault with the nested one DECLARED','REJECT',out1.ok?'ALLOW':'REJECT',out1.err)
  const out2=await att(()=>send([ixOpen(OUTER,alice.publicKey),...sweep(OUTER,SATS,0),
    ixBurn(OUTER,alice.publicKey,declare(OUTER.pda))],[alice]))
  rec('9.5','burn the outer vault with the nested one UNDECLARED','ALLOW',out2.ok?'ALLOW':'REJECT',
    `THE GAP: on-chain enumeration of nested Core assets does not exist, so the redeem client must scan BEFORE the owner signs. ${out2.err}`)
  const orphan:any=await fetchAsset(umi,INNER.umiAsset).catch(()=>null)
  rec('9.6','...and the inner vault is orphaned behind a burned asset\'s PDA',OUTER.pda.toBase58(),String(orphan?.owner||'n/a'))
  const Z=await mkVault(SATS)
  await send([ixOpen(Z,alice.publicKey),...sweep(Z,SATS,0),ixBurn(Z,alice.publicKey,declare(Z.pda))],[alice])
  const zinf=await conn.getAccountInfo(Z.asset,CM)
  rec('9.12','after BurnV1 the asset account still EXISTS','true',String(!!zinf),
    zinf?`owner=${zinf.owner.toBase58().slice(0,8)} lamports=${zinf.lamports} bytes=${zinf.data.length} key=${zinf.data[0]}`:'account is gone')
  const remint=await att(()=>send([ixMint(Z.asset,alice.publicKey,alice.publicKey)],[alice,Z.kp]))
  rec('9.13','re-mint a vault at a BURNED asset address, holding its keypair: refused at the vault\'s RECORD, which still exists (System "already in use"), before Core is reached','REJECT',remint.ok?'ALLOW':'REJECT',remint.err)

  // THE REDEMPTION CEILING, MEASURED PER RESERVE MINT.
  const CEIL=await mkVault(SATS)
  const extraMints:any[]=[mint]
  for(let i=1;i<8;i++) extraMints.push(await createMint(conn,deployer,deployer.publicKey,null,8))
  for(const m of extraMints.slice(1)){
    const a=getAssociatedTokenAddressSync(m,CEIL.pda,true)
    await sendAndConfirmTransaction(conn,new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,a,CEIL.pda,m)),[deployer],{commitment:CM})
    await mintTo(conn,deployer,m,a,deployer,1_000n,[],{commitment:CM})
  }
  const sizeFor=(n:number,createDest=false,withClaim=false)=>{
    const ms=extraMints.slice(0,n)
    const inner=ms.flatMap(m=>{
      const src=getAssociatedTokenAddressSync(m,CEIL.pda,true), dst=getAssociatedTokenAddressSync(m,alice.publicKey,true)
      return [fromWeb3JsInstruction(createTransferInstruction(src,dst,CEIL.pda,1n)),
              fromWeb3JsInstruction(createCloseAccountInstruction(src,alice.publicKey,CEIL.pda))]})
    inner.push(fromWeb3JsInstruction(SystemProgram.transfer({fromPubkey:CEIL.pda,toPubkey:alice.publicKey,lamports:1})))
    const sw=execute(umi,{asset:{publicKey:CEIL.umiAsset},collection:{publicKey:coll.publicKey} as any,
      instructions:inner,signers:[createNoopSigner(CEIL.pdaU)],authority:aliceU,payer:aliceU})
      .getInstructions().map(i=>new TransactionInstruction({programId:toWeb3JsPublicKey(i.programId),
        data:Buffer.from(i.data),keys:i.keys.map(k=>({pubkey:toWeb3JsPublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable}))}))
    const decl=ms.flatMap(m=>[getAssociatedTokenAddressSync(m,CEIL.pda,true),getAssociatedTokenAddressSync(m,CEIL.pda,true,TOKEN_2022_PROGRAM_ID)])
    const mk=createDest?ms.map(m=>createAssociatedTokenAccountIdempotentInstruction(
      alice.publicKey,getAssociatedTokenAddressSync(m,alice.publicKey,true),alice.publicKey,m)):[]
    // v6 stage 3: an ACTIVATED vault's redemption carries `claim` before the sweep.
    const tx=new Transaction().add(...mk,ixOpen(CEIL,alice.publicKey),...(withClaim?[ixPoolClaim([CEIL])]:[]),...sw,
      ixBurn(CEIL,alice.publicKey,decl))
    tx.feePayer=alice.publicKey; tx.recentBlockhash='11111111111111111111111111111111'
    return tx.serialize({requireAllSignatures:false,verifySignatures:false}).length
  }
  const sizes:number[]=[]
  for(let n=1;n<=8;n++){ try{ sizes.push(sizeFor(n)) }catch(e:any){ sizes.push(99999) } }
  const fits=sizes.filter(b=>b<=1232).length
  {
    const probe=new Transaction().add(SystemProgram.transfer({fromPubkey:alice.publicKey,toPubkey:deployer.publicKey,lamports:1}))
    probe.feePayer=deployer.publicKey; probe.recentBlockhash='11111111111111111111111111111111'
    const unsigned=probe.serialize({requireAllSignatures:false,verifySignatures:false}).length
    probe.sign(deployer,alice)
    rec('9.13a','an UNSIGNED serialization already reserves the signature bytes','true',String(unsigned===probe.serialize().length))
  }
  // Stage 3: BURN now names MINT, MINT's config and the vault record (it retires
  // the vault by CPI), which costs three keys (~99 bytes). MEASURED: the ceiling
  // fell from 4 to 3, which is still every reserve asset (9.15a).
  const EXPECTED_CEILING=3
  rec('9.14','the LARGEST reserve-mint count whose redemption fits a legacy transaction',String(EXPECTED_CEILING),String(fits),
    `bytes by N = ${sizes.map((b,i)=>`${i+1}:${b>=99999?'too big to build':b}`).join('  ')}  (limit 1232)`)
  // STAGE 3b: +33 bytes, the pool account BURN hands to retire_redeemed so a due
  // monthly distribution can run inside a redemption. The rate limit itself added
  // NOTHING (it reads the MINT config the redemption already carried).
  rec('9.14a','a 3-mint worst-case redemption is 1153 bytes (stage 3: 1120; stage 2: 1021; v5, with the Bank: 1119)','1153',String(sizes[2]))
  const withMk:number[]=[]
  for(let n=1;n<=8;n++){ try{ withMk.push(sizeFor(n,true)) }catch(e:any){ withMk.push(99999) } }
  // ⚠️ STAGE 3 COST: with all three reserve assets, the redeemer's DESTINATION
  // accounts must exist before the redemption (a prior transaction); stage 2 fit
  // three with them created in the same one. Stated in SPEC (redemption).
  rec('9.14b','...and TWO if the redeemer creates their destination ATAs in the same transaction (three need a prior tx)','2',
    String(withMk.filter(b=>b<=1232).length),`bytes by N = ${withMk.map((b,i)=>`${i+1}:${b>=99999?'too big':b}`).join('  ')}`)
  // AN ACTIVATED VAULT'S REDEMPTION CARRIES `claim` (P.17-P.19). The three
  // reserve assets must still fit with it, or an activated vault could not be
  // redeemed in one transaction.
  const withClaim:number[]=[], withClaimMk:number[]=[]
  for(let n=1;n<=8;n++){ try{ withClaim.push(sizeFor(n,false,true)) }catch(e:any){ withClaim.push(99999) }
    try{ withClaimMk.push(sizeFor(n,true,true)) }catch(e:any){ withClaimMk.push(99999) } }
  rec('9.14c','an ACTIVATED vault\'s redemption (claim + open + sweep + burn) still carries all THREE reserve assets','true',
    String(withClaim[2]<=1232),`bytes by N = ${withClaim.map((b,i)=>`${i+1}:${b>=99999?'too big':b}`).join('  ')}`)
  rec('9.14d','...and how many if it ALSO creates its destination ATAs in the same transaction (measured)','2',
    String(withClaimMk.filter(b=>b<=1232).length),`bytes by N = ${withClaimMk.map((b,i)=>`${i+1}:${b>=99999?'too big':b}`).join('  ')}`)
  const capInSeal=idx(SEAL_SRC,'MAX_RESERVE_MINTS'), capInBurn=idx(BURN_SRC,'MAX_RESERVE_MINTS')
  rec('9.15','SEAL caps reserve mints at the three reserve assets','3',capInSeal)
  rec('9.15a','...which does not exceed the count a redemption has been MEASURED to carry','true',String(Number(capInSeal)<=fits))
  rec('9.16','...and BURN agrees, so the two cannot drift',capInSeal,capInBurn)

  const AIR=await mkVault(SATS)
  const junk=await createMint(conn,deployer,deployer.publicKey,null,0)
  const junkAta=getAssociatedTokenAddressSync(junk,AIR.pda,true)
  await sendAndConfirmTransaction(conn,new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,junkAta,AIR.pda,junk)),[deployer],{commitment:CM})
  await mintTo(conn,deployer,junk,junkAta,deployer,7_000n,[],{commitment:CM})
  rec('9.7','a stranger can airdrop an undeclared token into a sealed vault','7000',String(await tokBal(junkAta)))
  const air1=await att(()=>send([ixOpen(AIR,alice.publicKey),...sweep(AIR,SATS,0),ixBurn(AIR,alice.publicKey,[...declare(AIR.pda),junkAta])],[alice]))
  rec('9.8','burn with the airdropped token DECLARED','REJECT',air1.ok?'ALLOW':'REJECT',air1.err)
  const air2=await att(()=>send([ixOpen(AIR,alice.publicKey),...sweep(AIR,SATS,0),ixBurn(AIR,alice.publicKey,declare(AIR.pda))],[alice]))
  rec('9.9','burn with the airdropped token UNDECLARED','ALLOW',air2.ok?'ALLOW':'REJECT',
    `THE GAP again: 7,000 airdropped units destroyed by a burn nothing on chain could refuse. ${air2.err}`)
  const G=await mkVault(SATS)
  await send([SystemProgram.transfer({fromPubkey:stranger.publicKey,toPubkey:G.pda,lamports:1_000_000})],[stranger])
  const grief=await att(()=>send([ixOpen(G,alice.publicKey),...sweep(G,SATS,0),ixBurn(G,alice.publicKey,declare(G.pda))],[alice]))
  rec('9.10','a stranger\'s SOL sitting in the PDA blocks the burn','REJECT',grief.ok?'ALLOW':'REJECT',grief.err)
  const ok9=await att(()=>send([ixOpen(G,alice.publicKey),...sweep(G,SATS,1_000_000),ixBurn(G,alice.publicKey,declare(G.pda))],[alice]))
  rec('9.11','...and the same redemption sweeping it too','ALLOW',ok9.ok?'ALLOW':'REJECT',ok9.err)

  console.log('\n─── 9c. there is no privileged signature in a redemption to spend ───')
  // IN.5: THE REDEMPTION IS A HOST TOO. Alone, while due, with revenue waiting.
  {
    const RR=await mkVault(0n)
    await waitDue()
    await send([createTransferInstruction(ata(deployer.publicKey),POOL,deployer.publicKey,1_000n)],[deployer])
    let sig=''
    const rr=await att(async()=>{ sig=await send([ixOpen(RR,alice.publicKey),ixBurn(RR,alice.publicKey,declare(RR.pda))],[alice]) })
    const l=rr.ok?await sigLogs(sig):[]
    rec('IN.5','a REDEMPTION alone, while due, runs the monthly distribution inside burn_vault (after retiring itself)','ALLOW,1,true',
      `${rr.ok?'ALLOW':'REJECT'},${l.length},${l.length>0&&l.every(x=>x.includes('path=monthly_inline'))}`,rr.err)
    rec('IN.5a','...and the pool is left with nothing undistributed','0',String((await pool()).avail))
    await ck('IN','IN.5')
  }
  const bystander=Keypair.generate()
  const T2=await mkVault()
  const donate=await att(()=>send([ixOpen(T2,alice.publicKey),
    SystemProgram.transfer({fromPubkey:alice.publicKey,toPubkey:bystander.publicKey,lamports:LAMPORTS_PER_SOL/100}),
    ...sweep(T2,SATS,0),ixBurn(T2,alice.publicKey,declare(T2.pda))],[alice]))
  rec('4.8','a redemption carrying the OWNER\'s own unrelated transfer','ALLOW',donate.ok?'ALLOW':'REJECT',donate.err)
  const RA=await mkVault(0n), RB=await mkVault(0n)
  // STAGE 3b: at this supply the cap is ONE redemption per window, so the second
  // half of a two-redemption transaction is refused by the RATE LIMIT. That is
  // also the proof the PAIRING accepted it: the rate check runs after the pair
  // check in burn_vault, so RateLimited cannot be reached by an unpaired burn.
  const k9=await bucket()
  rec('RL.6','(precondition) live supply here gives a cap of ONE redemption per window','1',String(k9.cap),`live ${k9.live}`)
  const two=await att(()=>send([ixOpen(RA,alice.publicKey),ixBurn(RA,alice.publicKey,declare(RA.pda)),
    ixOpen(RB,alice.publicKey),ixBurn(RB,alice.publicKey,declare(RB.pda))],[alice]))
  rec('4.9','TWO paired redemptions in ONE transaction at a cap of one: the second is RATE LIMITED','REJECT',two.ok?'ALLOW':'REJECT',two.err)
  const XA=await mkVault(0n), XB=await mkVault(0n)
  const cross=await att(()=>send([ixOpen(XA,alice.publicKey),ixBurn(XB,alice.publicKey,declare(XB.pda))],[alice]))
  rec('4.10','open vault A, burn vault B, nothing else','REJECT',cross.ok?'ALLOW':'REJECT',cross.err)
  const nest2=await att(()=>send([ixOpen(XA,alice.publicKey),ixOpen(XB,alice.publicKey),
    ixBurn(XB,alice.publicKey,declare(XB.pda)),ixBurn(XA,alice.publicKey,declare(XA.pda))],[alice]))
  rec('4.10a','...open A, open B, burn B, burn A: both pair, and the rate limit refuses the second','REJECT',nest2.ok?'ALLOW':'REJECT',nest2.err)
  await revealAll()

  // ═══ 11. THE LEVEL, AFTER IT IS DRAWN ═══
  console.log('\n─── 11. the drawn level cannot be rewritten, and the packet carries the reveal ───')
  const L3=await mkVault(0n,[['notice','7']])
  await revealAll()
  const upLevel=(signer:Keypair,asset:W,to:string)=>new TransactionInstruction({programId:CORE,
    data:Buffer.concat([Buffer.from([6,6]),attrs([['level',to]])]),
    keys:[{pubkey:asset,isSigner:false,isWritable:true},{pubkey:COLL,isSigner:false,isWritable:true},
      {pubkey:signer.publicKey,isSigner:true,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},{pubkey:CORE,isSigner:false,isWritable:false}]})
  const dealt=String(attrMap(await fetchAsset(umi,L3.umiAsset)).level)
  rec('11.2','a paid vault carries its drawn level beside its provenance','7',String(attrMap(await fetchAsset(umi,L3.umiAsset)).notice))
  const ownerRewrite=await att(()=>send([upLevel(alice,L3.asset,'V')],[alice]))
  rec('11.13','the vault OWNER cannot rewrite its level','REJECT',ownerRewrite.ok?'ALLOW':'REJECT',ownerRewrite.err)
  const initRewrite=await att(()=>send([upLevel(deployer,L3.asset,'V')],[deployer]))
  rec('11.14','...and neither can the INIT_AUTHORITY','REJECT',initRewrite.ok?'ALLOW':'REJECT',initRewrite.err)
  rec('11.15','...and the level on chain is still the one the program drew',dealt,String(attrMap(await fetchAsset(umi,L3.umiAsset)).level))
  // THE REVEAL RE-SUPPLIES THE ATTRIBUTES, so every list that can be MINTED must be
  // REVEALABLE, or a vault could be minted that can never take its level and the
  // FIFO would stop at it forever. Measured on the artifact, at the 128-byte max.
  const fitTx=(ix:TransactionInstruction,bh:string)=>{try{const tx=new Transaction(); tx.feePayer=alice.publicKey
    tx.recentBlockhash=bh; tx.add(ix); tx.serialize({requireAllSignatures:false,verifySignatures:false}); return true}catch{return false}}
  {
    const bh=(await conn.getLatestBlockhash()).blockhash
    // STAGE 3 (red-team finding 5): the stored list is bounded IN BYTES at mint
    // (MAX_ATTR_BYTES, 640: Borsh 8 + key + value per pair), so the bound is the
    // reveal, not the mint. A list of EXACTLY the budget must reveal in a LEGACY
    // transaction, and one byte more must be refused at mint.
    const budget=Number((MINT_SRC.match(/const MAX_ATTR_BYTES: usize = (\d+);/)||[])[1]??'0')
    const exact=(extra=0):[string,string][]=>{const l:[string,string][]=Array.from({length:4},(_,i)=>[`k${i}`.padEnd(64,'k'),'v'.repeat(64)])
      const used=l.reduce((a,[k,v])=>a+8+k.length+v.length,0); l.push(['k4'.padEnd(8,'k'),'v'.repeat(budget-used-16+extra)]); return l}
    const sizeOf=(l:[string,string][])=>l.reduce((a,[k,v])=>a+8+k.length+v.length,0)
    const revTx=new Transaction(); revTx.feePayer=alice.publicKey; revTx.recentBlockhash=bh; revTx.add(ixReveal(Keypair.generate().publicKey,exact()))
    let revBytes=99999; try{ revBytes=revTx.serialize({requireAllSignatures:false,verifySignatures:false}).length }catch{}
    rec('L.12','a vault carrying the WHOLE attribute budget can still be revealed in a legacy transaction','true',
      String(budget===640&&sizeOf(exact())===budget&&revBytes<=1232),`budget ${budget} bytes; that reveal is ${revBytes} bytes of 1232`)
    // A LEGACY mint cannot even carry the budget (it has more accounts and signers
    // than a reveal). This test reaches the bound using v0 and an address lookup
    // table; the program's attribute bound applies regardless of transaction format.
    const slot=await conn.getSlot(CM)
    const [mkLut,LUT]=AddressLookupTableProgram.createLookupTable({authority:deployer.publicKey,payer:deployer.publicKey,recentSlot:slot-1})
    await send([mkLut,AddressLookupTableProgram.extendLookupTable({payer:deployer.publicKey,authority:deployer.publicKey,lookupTable:LUT,
      addresses:[MINT_CFG,COLL,ata(alice.publicKey),mint,revAta,TOKEN_PROGRAM_ID,SEAL_CFG,MINT_AUTH,CORE,SystemProgram.programId]})],[deployer])
    await waitSlotPast((await conn.getSlot(CM))+2)
    const lut=(await conn.getAddressLookupTable(LUT,{commitment:CM})).value!
    const sendV0=async(ix:TransactionInstruction,signers:Keypair[])=>{
      const msg=new TransactionMessage({payerKey:alice.publicKey,recentBlockhash:(await conn.getLatestBlockhash()).blockhash,instructions:[ix]}).compileToV0Message([lut])
      const vtx=new VersionedTransaction(msg); vtx.sign(signers)
      const sig=await conn.sendTransaction(vtx); await conn.confirmTransaction(sig,CM)
      const st=await conn.getSignatureStatus(sig); if(st.value?.err) throw new Error(JSON.stringify(st.value.err)); return sig}
    const kOver=Keypair.generate()
    const over=await att(()=>sendV0(ixMint(kOver.publicKey,alice.publicKey,alice.publicKey,{attrs:exact(1)}),[alice,kOver]))
    rec('L.12a','a v0 mint carrying ONE byte more than a reveal could re-send','REJECT',over.ok?'ALLOW':'REJECT',`${over.err} | list of ${sizeOf(exact(1))} bytes`)
    const kAt=Keypair.generate()
    const at=await att(()=>sendV0(ixMint(kAt.publicKey,alice.publicKey,alice.publicKey,{attrs:exact()}),[alice,kAt]))
    if(at.ok) mkV(kAt,alice,exact())
    rec('L.12b','...and one carrying EXACTLY the budget lands (it is revealed, by a legacy transaction, below)','ALLOW',at.ok?'ALLOW':'REJECT',at.err)
    const tiny=(n:number):[string,string][]=>Array.from({length:n},(_,i)=>[`k${i}`,'v'])
    rec('L.13','at the PROGRAM\'s limit (7 short pairs) both the mint and its reveal serialize','true,true',
      `${fitTx(ixMint(Keypair.generate().publicKey,alice.publicKey,alice.publicKey,{attrs:tiny(7)}),bh)},${fitTx(ixReveal(Keypair.generate().publicKey,tiny(7)),bh)}`)
    const eight=await att(()=>mkVault(0n,tiny(8)))
    rec('L.14','an 8th caller attribute (the level is the program\'s)','REJECT',eight.ok?'ALLOW':'REJECT',eight.err)
  }

  // ═══ 10. COMPUTE UNITS ═══
  console.log('\n─── 10. compute units ───')
  const cuOf=async(sig:string)=>{for(let i=0;i<20;i++){
      const t=await conn.getTransaction(sig,{commitment:CM,maxSupportedTransactionVersion:0})
      if(t?.meta?.computeUnitsConsumed!=null) return t.meta.computeUnitsConsumed
      await sleep(250)}
    throw new Error(`could not read computeUnitsConsumed for ${sig}`)}
  const mintCU=async(pad:number)=>{const k=Keypair.generate(); const ixs:TransactionInstruction[]=[]
    for(let i=0;i<pad;i++) ixs.push(SystemProgram.transfer({fromPubkey:alice.publicKey,toPubkey:carol.publicKey,lamports:i+1}))
    ixs.push(ixMint(k.publicKey,alice.publicKey,alice.publicKey))
    const tx=new Transaction().add(...ixs); const sig=await sendAndConfirmTransaction(conn,tx,[alice,k],{commitment:CM})
    mkV(k,alice,[]); return {cu:await cuOf(sig),bytes:tx.serialize().length}}
  const bhCU=(await conn.getLatestBlockhash()).blockhash
  let maxPad=0
  // THE PAD IS FOUND, AND THE CEILING MUST NOT BE WHAT IS FOUND (10.2a): the first
  // stage-2 run answered 24 because the loop stopped at 24, not the packet.
  const PAD_CEILING=64
  for(let n=1;n<=PAD_CEILING;n++){ const tx=new Transaction(); tx.feePayer=alice.publicKey; tx.recentBlockhash=bhCU
    for(let i=0;i<n;i++) tx.add(SystemProgram.transfer({fromPubkey:alice.publicKey,toPubkey:carol.publicKey,lamports:i+1}))
    tx.add(ixMint(Keypair.generate().publicKey,alice.publicKey,alice.publicKey))
    try{ tx.serialize({requireAllSignatures:false,verifySignatures:false}); maxPad=n }catch{ break } }
  const cuPlain=await mintCU(0), cuWide=await mintCU(maxPad)
  await revealAll()
  const CU_LIMIT=1_400_000, CU_CEILING=400_000
  console.log(`  mint_vault: ${cuPlain.cu} CU ${cuPlain.bytes}B; widest pad ${maxPad}: ${cuWide.cu} CU ${cuWide.bytes}B`)
  rec('10.1','a plain mint lands and its compute units are MEASURED, not estimated','true',String(cuPlain.cu>0))
  rec('10.2','MEASURED, not a refusal: a mint padded to the BYTE ceiling lands within 1232 bytes and under the 1,400,000 CU maximum','true',String(cuWide.cu<CU_LIMIT&&cuWide.bytes<=1232),`${cuWide.cu} CU, ${cuWide.bytes} bytes`)
  rec('10.2a','...and the PACKET stopped the padding, not the probe\'s ceiling','true',String(maxPad>0&&maxPad<PAD_CEILING),`${maxPad} pad instructions`)
  rec('10.3',`a plain mint stays under the ${CU_CEILING.toLocaleString()} CU regression ceiling`,'true',String(cuPlain.cu<CU_CEILING))
  let inlineAsset:W|null=null
  {
    // AND THE REVEAL, which is new: it walks SlotHashes (up to 512 entries).
    const k=Keypair.generate(); inlineAsset=k.publicKey; await send([ixMint(k.publicKey,alice.publicKey,alice.publicKey)],[alice,k]); const v=mkV(k,alice,[])
    await waitEntropy(v.asset)
    const sig=await send([ixReveal(v.asset,v.attrs)],[deployer]); const cu=await cuOf(sig)
    console.log(`  reveal_level (inline capture, full SlotHashes walk): ${cu} CU`)
    rec('10.4','a reveal, walking the whole SlotHashes sysvar, stays under the regression ceiling','true',String(cu<CU_CEILING),`${cu} CU`)
  }
  {
    // ROUND 22 D7 / SPEC 54: THE PIGGYBACK CRANK AT FULL WIDTH. Each capture walks
    // SlotHashes three times, and ordinary traffic may carry MAX_CRANK of them.
    // SIMULATED, so nothing is consumed; the five vaults are then revealed in mint
    // order so no later arm finds the queue blocked by them.
    const lim=(n:number)=>new TransactionInstruction({programId:new W('ComputeBudget111111111111111111111111111111'),keys:[],
      data:Buffer.concat([Buffer.from([2]),Buffer.from(new Uint32Array([n]).buffer)])})
    const simCU=async(ixs:TransactionInstruction[],signers:Keypair[],limit?:number)=>{
      const tx=new Transaction(); if(limit) tx.add(lim(limit)); tx.add(...ixs)
      tx.feePayer=signers[0].publicKey; tx.recentBlockhash=(await conn.getLatestBlockhash(CM)).blockhash; tx.sign(...signers)
      const r=await conn.simulateTransaction(tx); return {cu:r.value.unitsConsumed??0,ok:r.value.err==null,logs:r.value.logs??[]}}
    const ks=Array.from({length:5},()=>Keypair.generate())
    for(const k of ks){ await send([ixMint(k.publicKey,alice.publicKey,alice.publicKey)],[alice,k]); mkV(k,alice,[]) }
    await waitEntropy(ks[4].publicKey)
    const due=ks.slice(0,4).map(k=>k.publicKey)
    const one=await simCU([ixCapture(ks[4].publicKey)],[deployer])
    const kn=Keypair.generate()
    const base=await simCU([ixMint(kn.publicKey,alice.publicKey,alice.publicKey)],[alice,kn],1_400_000)
    const wide=await simCU([ixMint(kn.publicKey,alice.publicKey,alice.publicKey,{crank:due})],[alice,kn],1_400_000)
    const dflt=await simCU([ixMint(kn.publicKey,alice.publicKey,alice.publicKey,{crank:due})],[alice,kn])
    const one1=await simCU([ixMint(kn.publicKey,alice.publicKey,alice.publicKey,{crank:due.slice(0,1)})],[alice,kn],1_400_000)
    const one1d=await simCU([ixMint(kn.publicKey,alice.publicKey,alice.publicKey,{crank:due.slice(0,1)})],[alice,kn])
    const shN=Number((await conn.getAccountInfo(SLOT_HASHES,CM))!.data.readBigUInt64LE(0))
    console.log(`  capture alone: ${one.cu} CU; mint ${base.cu} CU; mint + crank(4): ${wide.cu} CU; default budget: ${dflt.ok?'lands':'refused'} at ${dflt.cu} CU`)
    rec('10.5','one capture, alone, is MEASURED (three full SlotHashes walks)','true,true',`${one.ok},${one.cu>0}`,`${one.cu} CU`)
    // Round 24 (C6): the simulation commits nothing, so "unset" proved only that.
    // What shows the four captures RAN is their cost: four full SlotHashes walks.
    rec('10.6','a mint carrying the FULL crank (4 due captures) lands within the 1,400,000-unit maximum, and costs four captures more than a plain mint','true,true',
      `${wide.ok&&wide.cu<1_400_000},${wide.cu>=base.cu+4*100_000}`,`${wide.cu} CU (mint alone ${base.cu}, one capture ${one.cu})`)
    rec('10.6a','...and under the DEFAULT budget it lands exactly when its measured cost is within 200,000 (the number decides the page rule)',
      'true',String(dflt.ok===(wide.cu<=200_000)),`${wide.cu} CU, default ${dflt.ok?'lands':'refused'}`)
    // Round 25: SPEC 54 said ONE piggybacked capture leaves a mint "a few percent
    // under the default". Run 3 of the round-25 suite died on exactly that shape.
    // Measured here, at the SlotHashes length stated, and the page rule follows the number.
    console.log(`  mint + ONE capture: ${one1.cu} CU (SlotHashes ${shN} entries); default budget: ${one1d.ok?'lands':'refused'}`)
    rec('10.6b','a mint carrying ONE capture is MEASURED with the SlotHashes length it walked, and the default budget lands it exactly when that number is within 200,000',
      'true,true',`${one1.ok&&one1.cu>base.cu+100_000},${one1d.ok===(one1.cu<=200_000)}`,`${one1.cu} CU at ${shN} slot hashes (mint alone ${base.cu})`)
    for(const k of ks){ await readyToReveal({asset:k.publicKey}); await send([ixReveal(k.publicKey,[])],[deployer]) }
  }

  // ═══ L (end). THE QUOTAS HOLD EXACTLY: fill the census and count ═══
  console.log('\n─── L. the census, exhausted: every quota exactly, none exceeded ───')
  {
    let filled=0
    for(;;){ const c=await cfg(); if(Number(c.readBigUInt64LE(OFF_MINTED_TOTAL))>=CAP_TOTAL) break
      await mkVault(0n); filled++ }
    await revealAll()
    const k=await census()
    rec('L.18','after the census is exhausted, every level drew EXACTLY its cap',LEVEL_CAPS.join(','),k.minted.join(','),
      `${filled} vaults minted to fill it`)
    rec('L.19','...and minted_total equals the sum of the caps',String(CAP_TOTAL),String((await cfg()).readBigUInt64LE(OFF_MINTED_TOTAL)))
    const over=await att(()=>mkVault(0n))
    rec('L.20','one more vault, with no level left to draw','REJECT',over.ok?'ALLOW':'REJECT',over.err)
    const recs=await conn.getProgramAccounts(MINT_PROG,{commitment:CM,filters:[{memcmp:{offset:0,bytes:
      (await import('bs58')).default.encode(acctDisc('VaultRecord'))}}]})
    const perLevel=[0,0,0,0,0]; for(const a of recs) perLevel[a.account.data[OFF_REC_LEVEL]-1]++
    rec('L.21','counted record by record, the chain agrees',LEVEL_CAPS.join(','),perLevel.join(','),`${recs.length} vault records`)
    let mismatch=0, live=0
    for(const a of recs){ const asset=new W(a.account.data.subarray(9,41)); const ai=await conn.getAccountInfo(asset,CM)
      if(!ai||ai.data[0]!==1) continue; live++
      const lv=String(attrMap(await fetchAsset(umi,pk(asset.toBase58()))).level)
      if(lv!==LNAME[a.account.data[OFF_REC_LEVEL]-1]) mismatch++ }
    rec('L.22','every LIVE vault\'s level attribute matches its record','0',String(mismatch),`${live} live vaults checked`)
  }
  // EVERY DRAW, REPLAYED. Walk all records in mint order, rebuild the census turn
  // by turn, and check each captured vault's level against this file's own draw.
  {
    const recs=(await conn.getProgramAccounts(MINT_PROG,{commitment:CM,filters:[{memcmp:{offset:0,bytes:
      (await import('bs58')).default.encode(acctDisc('VaultRecord'))}}]})).map(a=>a.account.data)
      .sort((a,b)=>Number(a.readBigUInt64LE(OFF_REC_INDEX))-Number(b.readBigUInt64LE(OFF_REC_INDEX)))
    const minted=[0,0,0,0,0]; let verified=0, wrong=0, noEntropy=0, rescheduled=0
    for(const r of recs){ const lvl=r[OFF_REC_LEVEL]
      if(r.readUInt16LE(OFF_REC_RESCHED)>0) rescheduled++
      // STAGE 3: EVERY draw has its entropy on the record (an inline capture now
      // stores it too), because no level is ever assigned without one.
      if(r[OFF_REC_SET]){ if(drawOf(Buffer.from(r.subarray(OFF_REC_ENTROPY,OFF_REC_ENTROPY+32)),LEVEL_CAPS,minted)===lvl) verified++; else wrong++ }
      else noEntropy++
      minted[lvl-1]++ }
    rec('L.23','EVERY draw, replayed in mint order against the census at its turn, matches','0',String(wrong),
      `${verified} draws re-derived, ${rescheduled} of them after a missed window was rescheduled`)
    rec('L.23a','...and NO vault was drawn without entropy (stage 2 had a lowest-level default; it is gone)','0',String(noEntropy),
      `inline-capture vault: ${inlineAsset?.toBase58().slice(0,8)}`)
  }
  // ═══ P. THE COMMUNITY POOL: activated vaults only, weighted, paid INTO the vault ═══
  console.log('\n─── P. the pool: activate at 21,000 sats, weighted 2..6, claimed into the vault itself ───')
  {
    const isAlice=async(v:V)=>{const a=await conn.getAccountInfo(v.asset,CM)
      return !!a&&a.data[0]===1&&new W(a.data.subarray(1,33)).equals(alice.publicKey)}
    const cands:V[]=[]
    // EMPTY vaults only, so the 21,000-sat threshold is measured from zero (a
    // vault minted with the default fund already holds a whole Bitcoin).
    const empty=async(v:V)=>{const a=await conn.getAccountInfo(ata(v.pda),CM); return !a||(await tokBal(ata(v.pda)))===0n}
    // C1 was credited by the monthly in-line runs (IN.1, IN.5). Deliver that
    // first, so P.11 reads ONE distribution off the payouts and nothing older.
    await send([ixPoolClaim([C1])],[alice])
    for(const v of VAULTS){const r=await recOf(v.asset); if(!r||r[OFF_REC_ACTIVE]||r[OFF_REC_RETIRED]||!r[OFF_REC_LEVEL]) continue
      if(await isAlice(v)&&await empty(v)) cands.push(v)}
    rec('P.2a','the exhausted census guarantees an eligible empty Alice vault at every level: each quota exceeds all excluded fixtures','true',
      String(CAP_TOTAL-cands.length<=20&&Math.min(...LEVEL_CAPS)>CAP_TOTAL-cands.length),`${CAP_TOTAL-cands.length} excluded, smallest quota ${Math.min(...LEVEL_CAPS)}`)
    const lvl=async(v:V)=>(await recOf(v.asset))![OFF_REC_LEVEL]
    const byLevel:(V|undefined)[]=[undefined,undefined,undefined,undefined,undefined]
    const rest:V[]=[]
    for(const v of cands){const l=await lvl(v); if(!byLevel[l-1]) byLevel[l-1]=v; else rest.push(v)}
    const picks=byLevel.filter(Boolean) as V[]
    const ex=rest.shift()!, ex1=rest.shift()!
    // ── ACTIVATION ──
    await fund(ex,ACTIVATION-1n)
    const aLow=await att(()=>send([ixActivate(ex)],[deployer]))
    rec('P.3','activate a vault holding 20,999 sats (one short of the seed)','REJECT',aLow.ok?'ALLOW':'REJECT',aLow.err)
    await fund(ex,1n)
    const aOk=await att(()=>send([ixActivate(ex)],[deployer]))
    rec('P.4','...one more sat and ANYONE may activate it (it requests)','ALLOW',aOk.ok?'ALLOW':'REJECT',aOk.err)
    const aTwice=await att(()=>send([ixActivate(ex)],[deployer]))
    rec('P.5','activate the same vault twice before a distribution has run','REJECT',aTwice.ok?'ALLOW':'REJECT',aTwice.err)
    const aGone=await att(()=>send([ixActivate(H)],[deployer]))
    rec('P.6','activate a REDEEMED vault (its record is retired)','REJECT',aGone.ok?'ALLOW':'REJECT',aGone.err)
    await fund(ex1,ACTIVATION)
    const aWrong=await att(()=>send([ixActivate(ex1,{token:ata(ex.pda)})],[deployer]))
    rec('P.7','activate a vault by pointing at ANOTHER vault\'s funded account','REJECT',aWrong.ok?'ALLOW':'REJECT',aWrong.err)
    for(const v of picks){ await fund(v,ACTIVATION); await send([ixActivate(v)],[deployer]) }
    const top=async(n:bigint)=>{ if(n>0n) await send([createTransferInstruction(ata(deployer.publicKey),POOL,deployer.publicKey,n)],[deployer]) }
    // ═══ 3c.A6 RED-TEAM 2 #5, VERBATIM: activate and distribute in ONE transaction ═══
    // Before stage 3c the vault joined at once and took a full weighted share of
    // a backlog that built up before it existed. Now it is excluded from that
    // distribution and joins after it.
    const atk=rest.shift()!
    // A DISTRIBUTION FIRST, so ex and the picks (requested above) become ELIGIBLE,
    // then one claim joins them all. Waiting for the month makes this the same on
    // every run, whatever the clock happened to be.
    await waitDue()
    // An exact multiple of the weight, so no sub-sat residue is left owed (P.12a).
    { const p=await pool(); await top(p.w+(p.w-(p.avail%p.w))%p.w); await send([ixDistribute()],[alice]) }
    await send([ixPoolClaim([C1,ex,...picks])],[alice])
    const JOINED=[C1,ex,...picks]
    {
      await fund(atk,ACTIVATION)
      const p=await pool(); await top(7n*p.w+(p.w-(p.avail%p.w))%p.w)
      const q=await pool(), before=await Promise.all(JOINED.map(v=>tokBal(ata(v.pda)))), atkBefore=await tokBal(ata(atk.pda))
      const both=await att(()=>send([ixActivate(atk),ixDistribute(burnBy(alice))],[alice]))
      rec('3c.A6','activate a vault AND distribute (burning 100 $GARY) in ONE transaction','ALLOW',both.ok?'ALLOW':'REJECT',both.err)
      await ck('3c','3c.A6')
      // THE GATE AGAIN: atk is now eligible and unjoined, so the next one waits.
      // Something to distribute, so the ONLY reason left to refuse is the gate.
      const pw=(await pool()).w; await top(pw)
      const s0=await garySupply()
      const second=await att(()=>send([ixDistribute(burnBy(alice))],[alice]))
      rec('3c.A6c','a SECOND burn distribution before the newly eligible vault is joined (and it burns nothing)','REJECT,true',
        `${second.ok?'ALLOW':'REJECT'},${s0===await garySupply()}`,second.err)
      const cl=await att(()=>send([ixPoolClaim([atk,...JOINED])],[alice]))
      const got=await Promise.all(JOINED.map(async(v,i)=>(await tokBal(ata(v.pda)))-before[i]))
      const gotAtk=(await tokBal(ata(atk.pda)))-atkBefore
      rec('3c.A6a','...the activator got NOTHING of the backlog; the vaults already on the schedule got all of it',
        `ALLOW,0,${q.avail}`,`${cl.ok?'ALLOW':'REJECT'},${gotAtk},${got.reduce((a,b)=>a+b,0n)}`,cl.err)
      const r=(await recOf(atk.asset))!
      rec('3c.A6b','...and the claim that delivered it JOINED the activator, at the accumulator after that distribution',
        `1,0,${WEIGHTS[r[OFF_REC_LEVEL]-1]*(await pool()).acc},0`,
        `${r[OFF_REC_ACTIVE]},${r[OFF_REC_PENDING]},${u128le(r,OFF_REC_DEBT)},${(await cfg()).readBigUInt64LE(OFF_PENDING_COUNT)}`)
      await ck('3c','3c.A6a')
      const aActive=await att(()=>send([ixActivate(atk)],[deployer]))
      rec('3c.A7','activate a vault that has already joined','REJECT',aActive.ok?'ALLOW':'REJECT',aActive.err)
    }
    const ACT=[C1,ex,atk,...picks]
    {
      const p=await pool(); let want=0n; for(const v of ACT) want+=WEIGHTS[(await lvl(v))-1]
      rec('P.8','the denominator is the sum of the ACTIVATED vaults\' level weights, and nothing else',`${want},${ACT.length}`,`${p.w},${p.active}`)
    }
    // ── ONE DISTRIBUTION, MADE EXACT, SO THE WEIGHTS CAN BE READ OFF THE PAYOUTS ──
    {
      // The monthly in-line runs (IN.*) have already distributed everything that
      // arrived, so put in a known amount, an exact multiple of the weight.
      const p=await pool(); await top(10n*p.w+(p.w-(p.avail%p.w))%p.w)
      const q=await pool(); const k=q.avail/q.w
      rec('P.8a','(precondition) the pool holds a whole number of sats per weight unit, at least 10','true',String(k>=10n&&q.avail%q.w===0n),`${q.avail} over ${q.w}`)
      const dist=await att(()=>send([ixDistribute(burnBy(alice))],[alice]))
      rec('P.9','ANYONE can distribute the pool (85% of income, already split into it)','ALLOW',dist.ok?'ALLOW':'REJECT',`${dist.err} | ${q.avail} sats over weight ${q.w}`)
      await ck('P','P.9')
      const before=await Promise.all(ACT.map(v=>tokBal(ata(v.pda))))
      const cl=await att(()=>send([ixPoolClaim(ACT)],[alice]))
      rec('P.10','ANYONE can claim for a batch of vaults','ALLOW',cl.ok?'ALLOW':'REJECT',cl.err)
      await ck('P','P.10')
      const got=await Promise.all(ACT.map(async(v,i)=>(await tokBal(ata(v.pda)))-before[i]))
      const want=await Promise.all(ACT.map(async v=>WEIGHTS[(await lvl(v))-1]*k))
      rec('P.11','every vault was paid exactly weight x share, INTO ITS OWN cbBTC ACCOUNT',want.join(','),got.join(','))
      const perLevel=picks.length?await Promise.all(picks.map(async(v,i)=>`${LNAME[(await lvl(v))-1]}:${got[i+3]/(k*2n)}x${(got[i+3]%(k*2n))*2n/(k*2n)?'.5':''}`)):[]
      const wantLevel=await Promise.all(picks.map(async v=>{const w=WEIGHTS[(await lvl(v))-1]; return `${LNAME[(await lvl(v))-1]}:${w/2n}x${w%2n?'.5':''}`}))
      // Round 25 (round-24 C8): the expected line is FIXED, all five levels. It used
      // to be built from the picks, so with no picks it read ''=='' and passed.
      rec('P.11a',`Level I : II : III : IV : V pays 1 : 1.5 : 2 : 2.5 : 3, ALL FIVE levels present (here ${picks.length} of 5)`,'I:1x II:1x.5 III:2x IV:2x.5 V:3x',perLevel.join(' '),
        `computed from the picks: ${wantLevel.join(' ')}`)
      rec('P.11b','MINT\'s weight table is the Schedule of Vaults',`[2, 3, 4, 5, 6]`,(MINT_SRC.match(/LEVEL_WEIGHTS: \[u64; 5\] = (\[[^\]]*\])/)||[])[1]??'NOT FOUND')
      const again=await Promise.all(ACT.map(v=>tokBal(ata(v.pda))))
      await send([ixPoolClaim(ACT)],[alice])
      const zero=await Promise.all(ACT.map(async(v,i)=>(await tokBal(ata(v.pda)))-again[i]))
      rec('P.12','claim the same batch again: nothing more is owed','0',String(zero.reduce((a,b)=>a+b,0n)))
      await ck('P','P.12')
      const e=await pool()
      // Round 23 prep (2026-10-04): this read "0,0", which held only when every
      // earlier distribution happened to divide evenly. The in-line monthly runs
      // in section IN credit whatever arrived over whatever weight the random
      // draws produced, and a weight-3 vault keeps a sub-sat third owed. The
      // property is that an EXACT distribution, fully claimed, leaves that dust
      // exactly as it was and the pool holding nothing it does not owe.
      rec('P.12a','...and the pool owes exactly the sub-sat dust it owed before, and holds nothing it does not owe',
        `${q.owed},${q.owedCeil},true`,`${e.owed},${e.bal},${q.owed<BigInt(ACT.length)*ACC_SCALE}`)
    }
    // ── DUST CARRIES ──
    {
      const p=await pool(); await top(11n*p.w+1n)
      await send([ixDistribute(burnBy(alice))],[alice]); await send([ixPoolClaim(ACT)],[alice])
      const q=await pool()
      rec('P.13','the odd sat that does not divide stays IN THE POOL, owed to holders (nobody keeps a cut)','1,1,0',`${q.bal},${q.owedCeil},${q.avail}`)
      await ck('P','P.13')
    }
    // ── THE TRIGGER (Gary, 2026-10-03): BURN EXACTLY 100 $GARY, OR WAIT THE PERIOD ──
    {
      const p=await pool(); await top(5n*p.w)
      const s0=await garySupply()
      const short=await att(()=>send([ixDistribute(burnBy(bob))],[bob]))
      rec('PG.2','distribute burning from a holder with 99.999 $GARY','REJECT',short.ok?'ALLOW':'REJECT',short.err)
      const wrongMint=await createMint(conn,deployer,deployer.publicKey,null,9)
      const wm=await att(()=>send([ixDistribute({...burnBy(alice),gmint:wrongMint,from:garyAta(alice.publicKey)})],[alice]))
      rec('PG.3','distribute "burning" a DIFFERENT classic 9-decimal mint','REJECT',wm.ok?'ALLOW':'REJECT',wm.err)
      const t22g=await createMint(conn,deployer,deployer.publicKey,null,9,undefined,{commitment:CM},TOKEN_2022_PROGRAM_ID)
      const wt=await att(()=>send([ixDistribute({...burnBy(alice),gmint:t22g,from:garyAta(alice.publicKey),tprog:TOKEN_2022_PROGRAM_ID})],[alice]))
      rec('PG.4','distribute "burning" a Token-2022 lookalike mint','REJECT',wt.ok?'ALLOW':'REJECT',wt.err)
      const xfer=await att(()=>send([createTransferInstruction(garyAta(alice.publicKey),garyAta(deployer.publicKey),alice.publicKey,DIST_BURN),
        ixDistribute()],[alice]))
      rec('PG.5','TRANSFER 100 $GARY away (not a burn) and distribute without one, before the period','REJECT',xfer.ok?'ALLOW':'REJECT',xfer.err)
      const early=await att(()=>send([ixDistribute()],[alice]))
      rec('PG.6','the FREE path before the period has run','REJECT',early.ok?'ALLOW':'REJECT',early.err)
      rec('PG.6a','...and none of those five refusals burned a single $GARY',String(s0),String(await garySupply()))
      const aG=await tokBal(garyAta(alice.publicKey)); let sig=''
      const okb=await att(async()=>{ sig=await send([ixDistribute(burnBy(alice))],[alice]) })
      rec('PG.1','distribute by BURNING exactly 100 $GARY: anyone, any time','ALLOW',okb.ok?'ALLOW':'REJECT',okb.err)
      rec('PG.1a','...the $GARY SUPPLY fell by exactly 100, all from the burner',`${DIST_BURN},${DIST_BURN}`,
        `${s0-await garySupply()},${aG-await tokBal(garyAta(alice.publicKey))}`)
      const ll=okb.ok?await sigLogs(sig):[]
      rec('PG.1b','...and it logged CBOB_DISTRIBUTED path=burn','true',String(ll.length===1&&ll[0].includes('path=burn')),ll.join(' | '))
      await ck('P','PG.1')
      {
        let cu=0; for(let i=0;i<20&&!cu;i++){const t=await conn.getTransaction(sig,{commitment:CM,maxSupportedTransactionVersion:0})
          cu=t?.meta?.computeUnitsConsumed??0; if(!cu) await sleep(250)}
        const tx=new Transaction().add(ixDistribute(burnBy(alice))); tx.feePayer=alice.publicKey; tx.recentBlockhash='11111111111111111111111111111111'
        const B=tx.serialize({requireAllSignatures:false,verifySignatures:false}).length
        rec('PG.1c','a distribute-with-burn is MEASURED: under the 400,000 CU ceiling and a legacy packet','true',String(cu>0&&cu<400_000&&B<=1232),`${cu} CU, ${B} bytes`)
      }
      const s1=await garySupply()
      const empty=await att(()=>send([ixDistribute(burnBy(alice))],[alice]))
      rec('PG.7','distribute again with NOTHING undistributed in the pool','REJECT',empty.ok?'ALLOW':'REJECT',empty.err)
      rec('PG.7a','...and it burned nothing',String(s1),String(await garySupply()))
    }
    // ── A LATECOMER EARNS FROM THE DISTRIBUTION AFTER THE ONE AFTER ITS REQUEST ──
    const late=rest.shift()!
    {
      await fund(late,ACTIVATION); await send([ixActivate(late)],[deployer])
      const b=await tokBal(ata(late.pda)); await send([ixPoolClaim([late])],[alice])
      const r=(await recOf(late.asset))!
      rec('P.17','a vault activated AFTER a distribution gets nothing from it','0',String((await tokBal(ata(late.pda)))-b))
      rec('P.17a','...because it is only WAITING, stamped with the epoch it asked in','1,0,'+(await cfg()).readBigUInt64LE(OFF_DIST_EPOCH),
        `${r[OFF_REC_PENDING]},${r[OFF_REC_ACTIVE]},${r.readBigUInt64LE(OFF_REC_REQ_EPOCH)}`)
      const p=await pool(); await top(3n*p.w); await send([ixDistribute(burnBy(alice))],[alice])
      const b2=await tokBal(ata(late.pda)); await send([ixPoolClaim([late])],[alice])
      const r2=(await recOf(late.asset))!
      rec('P.17b','...the NEXT distribution passes it by; the claim after it joins it, owed nothing yet',
        `0,1,${WEIGHTS[r2[OFF_REC_LEVEL]-1]*(await pool()).acc}`,`${(await tokBal(ata(late.pda)))-b2},${r2[OFF_REC_ACTIVE]},${u128le(r2,OFF_REC_DEBT)}`)
      await ck('P','P.17b')
    }
    // ── ROUND 22 (F21): A VAULT RETIRED WHILE STILL WAITING TO JOIN ──
    // One redeemed and one bare-burned, both requested THIS epoch: each must
    // leave BOTH the waiting count and this epoch's count, or the join gate
    // (waiting = pending_count - pending_this_epoch) drifts for ever.
    {
      const pr1=rest.shift()!, pr2=rest.shift()!
      for(const v of [pr1,pr2]){ await fund(v,ACTIVATION); await send([ixActivate(v)],[deployer]) }
      const c0=await cfg(), pc0=c0.readBigUInt64LE(OFF_PENDING_COUNT), pt0=c0.readBigUInt64LE(OFF_PENDING_THIS)
      const held=await tokBal(ata(pr1.pda))
      const rr=await att(()=>send([ixOpen(pr1,alice.publicKey),...sweep(pr1,held,0),ixBurn(pr1,alice.publicKey,declare(pr1.pda))],[alice]))
      const a2=await fetchAsset(umi,pr2.umiAsset), col2=await fetchCollection(umi,coll.publicKey)
      const bb=await att(async()=>{ await burn(umi,{asset:a2,collection:col2,authority:aliceU}).sendAndConfirm(umi,{confirm:{commitment:CM}})
        await send([ixRetireBurned(pr2.asset,pr2.asset)],[alice]) })
      const c1=await cfg()
      rec('F21.1','a WAITING vault redeemed, and another bare-burned and retired: both leave both counters',
        `ALLOW,ALLOW,${pc0-2n},${pt0-2n}`,`${rr.ok?'ALLOW':'REJECT'},${bb.ok?'ALLOW':'REJECT'},${c1.readBigUInt64LE(OFF_PENDING_COUNT)},${c1.readBigUInt64LE(OFF_PENDING_THIS)}`,`${rr.err} ${bb.err}`)
      rec('F21.2','...and both records are retired and no longer waiting','1,0,1,0',
        `${(await recOf(pr1.asset))![OFF_REC_RETIRED]},${(await recOf(pr1.asset))![OFF_REC_PENDING]},${(await recOf(pr2.asset))![OFF_REC_RETIRED]},${(await recOf(pr2.asset))![OFF_REC_PENDING]}`)
      await ck('P','F21.1')
    }
    // ── A FROZEN VAULT ACCOUNT (cbBTC's freeze authority) DEFERS ONE, BLOCKS NONE ──
    const [Y,Z,Rv,Qv]=[picks[0]??rest.shift()!,picks[1]??rest.shift()!,picks[2]??rest.shift()!,picks[3]??rest.shift()!]
    {
      const pY=await pendingOf(Y.asset), pZ=await pendingOf(Z.asset)
      await send([createFreezeAccountInstruction(ata(Y.pda),mint,deployer.publicKey)],[deployer])
      const bY=await tokBal(ata(Y.pda)), bZ=await tokBal(ata(Z.pda))
      const fr=await att(()=>send([ixPoolClaim([Y,Z])],[alice]))
      rec('P.18','a batch where one vault\'s cbBTC account is FROZEN still lands','ALLOW',fr.ok?'ALLOW':'REJECT',fr.err)
      await ck('P','P.18')
      rec('P.18a','...the unfrozen vault is paid in full',String(pZ/ACC_SCALE),String((await tokBal(ata(Z.pda)))-bZ))
      rec('P.18b','...the frozen one is paid nothing and STILL OWED every sat',`0,${pY}`,`${(await tokBal(ata(Y.pda)))-bY},${await pendingOf(Y.asset)}`)
      await send([createThawAccountInstruction(ata(Y.pda),mint,deployer.publicKey)],[deployer])
      await send([ixPoolClaim([Y])],[alice])
      rec('P.18c','thawed, it is paid exactly what it was owed',String(pY/ACC_SCALE),String((await tokBal(ata(Y.pda)))-bY))
      await ck('P','P.18c')
      const wrongDest=await att(()=>send([ixPoolClaim([{...Z,dest:ata(Y.pda)}])],[alice]))
      rec('P.19','claim a vault\'s share into ANOTHER account','REJECT',wrongDest.ok?'ALLOW':'REJECT',wrongDest.err)
      const noPairs=await att(()=>send([ixPoolClaim([])],[alice]))
      rec('P.19a','a claim naming no vault','REJECT',noPairs.ok?'ALLOW':'REJECT',noPairs.err)
      const wrongPool=await att(()=>send([ixPoolClaim([Z],{pool:ata(alice.publicKey)})],[alice]))
      rec('P.19b','a claim paying out of an account that is not the pool','REJECT',wrongPool.ok?'ALLOW':'REJECT',wrongPool.err)
      const dWrong=await att(()=>send([ixDistribute({pool:ata(alice.publicKey)})],[alice]))
      rec('P.19c','a distribution reading an account that is not the pool','REJECT',dWrong.ok?'ALLOW':'REJECT',dWrong.err)
    }
    // ── A REDEMPTION CLAIMS FIRST, AND BURN TAKES THE VAULT OFF THE SCHEDULE ──
    {
      // STAMP a distribution now, so the period cannot fall due inside the
      // redemption below and change what it is owed while it is being measured.
      { const p=await pool(); await top(p.w); await send([ixDistribute(burnBy(alice))],[alice]) }
      const pR=await pendingOf(Rv.asset); const held=await tokBal(ata(Rv.pda))
      const noClaim=await att(()=>send([ixOpen(Rv,alice.publicKey),...sweep(Rv,held,0),ixBurn(Rv,alice.publicKey,declare(Rv.pda))],[alice]))
      rec('P.20','redeem an activated vault that is still OWED its share, without claiming','REJECT',noClaim.ok?'ALLOW':'REJECT',`${noClaim.err} | owed ${pR/ACC_SCALE} sats`)
      const closedFirst=await att(()=>send([ixOpen(Rv,alice.publicKey),...sweep(Rv,held,0),ixPoolClaim([Rv]),
        ixBurn(Rv,alice.publicKey,declare(Rv.pda))],[alice]))
      rec('P.21','...claim AFTER the sweep closed its account (a claim never creates one)','REJECT',closedFirst.ok?'ALLOW':'REJECT',closedFirst.err)
      // REVENUE THAT ARRIVED AND WAS NOT YET DISTRIBUTED belongs to whoever is
      // active when it is: the redeemer leaves with what was already distributed.
      const UNDIST=500n; await top(UNDIST)
      const w0=(await pool()).w, wR=WEIGHTS[(await lvl(Rv))-1], aBefore=await tokBal(ata(alice.publicKey))
      const redeem=[ixOpen(Rv,alice.publicKey),ixPoolClaim([Rv]),...sweep(Rv,held+pR/ACC_SCALE,0),ixBurn(Rv,alice.publicKey,declare(Rv.pda))]
      const ok=await att(()=>send(redeem,[alice]))
      rec('P.22','open + CLAIM + sweep + burn: the share is paid into the vault and swept out with the rest','ALLOW',ok.ok?'ALLOW':'REJECT',ok.err)
      rec('P.22a','...the owner received the vault AND its share',String(held+pR/ACC_SCALE),String((await tokBal(ata(alice.publicKey)))-aBefore))
      rec('P.22b','...its weight left the schedule in the same transaction',String(w0-wR),String((await pool()).w))
      rec('P.22c','...and its record is retired, not active','1,0',`${(await recOf(Rv.asset))![OFF_REC_RETIRED]},${(await recOf(Rv.asset))![OFF_REC_ACTIVE]}`)
      rec('P.22e','...and the revenue that was NOT yet distributed stayed in the pool for the vaults that remain',String(UNDIST),String((await pool()).avail))
      await ck('P','P.22')
      await send([ixDistribute(burnBy(alice))],[alice])
      const sz=new Transaction().add(...redeem); sz.feePayer=alice.publicKey; sz.recentBlockhash='11111111111111111111111111111111'
      const B=sz.serialize({requireAllSignatures:false,verifySignatures:false}).length
      rec('P.22d','an activated vault\'s 1-mint redemption, claim included, fits a legacy transaction','true',String(B<=1232),`${B} bytes`)
      const direct=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,data:d('retire_redeemed'),
        keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:vrec(Z.asset),isSigner:false,isWritable:true},
          {pubkey:Z.asset,isSigner:false,isWritable:false},{pubkey:SYSVAR_INSTRUCTIONS_PUBKEY,isSigner:false,isWritable:false},POOLK]})],[alice]))
      rec('P.23','call MINT\'s retire_redeemed DIRECTLY to knock a live vault off the schedule','REJECT',direct.ok?'ALLOW':'REJECT',direct.err)
      // ═══ ROUND 23 (F8): THE SAME ATTACKS, ONE LEVEL DOWN, THROUGH A WRAPPER ═══
      // tests/cpi-wrapper is a TEST-ONLY program that forwards any instruction as a
      // CPI (accounts[0] = target). Every top-level and stack-height check on the
      // redemption path exists to refuse exactly this shape; here it is sent.
      // Its ADDRESS only: a Solana keypair file's last 32 bytes are the public key, so no signer is ever built.
      const WRAP=new W(Uint8Array.from(JSON.parse(readFileSync('/opt/cbob-vaults/.cache/cpi-wrapper/cbob_test_cpi_wrapper-keypair.json','utf8')).slice(32)))
      const wrap=(ix:TransactionInstruction)=>new TransactionInstruction({programId:WRAP,data:ix.data,
        keys:[{pubkey:ix.programId,isSigner:false,isWritable:false},...ix.keys]})
      rec('WR.0','(precondition) the wrapper program is deployed on this validator','true',String(!!(await conn.getAccountInfo(WRAP,CM))?.executable))
      const viaWrap=await att(()=>send([wrap(new TransactionInstruction({programId:MINT_PROG,data:d('retire_redeemed'),
        keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:vrec(Z.asset),isSigner:false,isWritable:true},
          {pubkey:Z.asset,isSigner:false,isWritable:false},{pubkey:SYSVAR_INSTRUCTIONS_PUBKEY,isSigner:false,isWritable:false},POOLK]}))],[alice]))
      rec('WR.1','retire_redeemed reached THROUGH a wrapper program (stack height 2, top-level not BURN)','REJECT,1',
        `${viaWrap.ok?'ALLOW':'REJECT'},${(await recOf(Z.asset))![OFF_REC_ACTIVE]}`,viaWrap.err)
      // A live, sealed vault alice owns, holding something, to aim the wrapped redemptions at.
      let T:V|null=null
      for(const v of VAULTS){const r=await recOf(v.asset); if(!r||r[OFF_REC_ACTIVE]||r[OFF_REC_PENDING]||r[OFF_REC_RETIRED]) continue
        const a=await conn.getAccountInfo(v.asset,CM); if(!a||a.data[0]!==1||!new W(a.data.subarray(1,33)).equals(alice.publicKey)) continue
        const ta=await conn.getAccountInfo(ata(v.pda),CM); if(ta&&(await tokBal(ata(v.pda)))>0n){T=v;break}}
      rec('WR.pre','(precondition) a live, sealed, funded vault alice owns','true',String(!!T))
      if(T){
        const heldT=await tokBal(ata(T.pda))
        const w2=await att(()=>send([ixOpen(T!,alice.publicKey),...sweep(T!,heldT,0),wrap(ixBurn(T!,alice.publicKey,declare(T!.pda)))],[alice]))
        rec('WR.2','a genuine top-level OPEN, the sweep, then burn_vault THROUGH a wrapper','REJECT',w2.ok?'ALLOW':'REJECT',w2.err)
        const w3=await att(()=>send([wrap(ixOpen(T!,alice.publicKey)),...sweep(T!,heldT,0),ixBurn(T!,alice.publicKey,declare(T!.pda))],[alice]))
        rec('WR.3','open_for_redemption THROUGH a wrapper, the sweep, then a genuine top-level burn','REJECT',w3.ok?'ALLOW':'REJECT',w3.err)
        const a=await conn.getAccountInfo(T.asset,CM)
        rec('WR.4','...and after both, the vault is still a live asset holding everything it held','1,'+heldT,`${a?.data[0]},${await tokBal(ata(T.pda))}`)
        // ═══ ROUND 24 (A3; Gary 2026-10-05: build the sweep-at-execution helper) ═══
        // programs/cbob-vault-sweep moves what the vault holds AT THE MOMENT IT RUNS,
        // called through Core's Execute (which only the owner can sign). So a deposit
        // landing between "read the balance" and "send" no longer blocks an opening.
        const SWEEP=new W('EB2uVvsaThLp4PWt3LwAWveTCa9ZynPVbWzZfUhMf2aa')
        rec('SR.0','(precondition) the sweep helper is deployed on this validator','true',String(!!(await conn.getAccountInfo(SWEEP,CM))?.executable))
        const sweepIx=(v:V,dest:W,pairs:[W,W][],pdaSigns=true)=>new TransactionInstruction({programId:SWEEP,data:Buffer.from([0]),
          keys:[{pubkey:v.pda,isSigner:pdaSigns,isWritable:true},{pubkey:dest,isSigner:false,isWritable:true},
            {pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
            ...pairs.flatMap(([a,b])=>[{pubkey:a,isSigner:false,isWritable:true},{pubkey:b,isSigner:false,isWritable:true}])]})
        const viaCore=(v:V,ix:TransactionInstruction)=>execute(umi,{asset:{publicKey:v.umiAsset},collection:{publicKey:coll.publicKey} as any,
          instructions:[fromWeb3JsInstruction(ix)],signers:[createNoopSigner(v.pdaU)],authority:U(v.owner),payer:U(v.owner)}).getInstructions()
          .map(i=>new TransactionInstruction({programId:toWeb3JsPublicKey(i.programId),data:Buffer.from(i.data),
            keys:i.keys.map(k=>({pubkey:toWeb3JsPublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable}))}))
        const direct=await att(()=>send([sweepIx(T,alice.publicKey,[[ata(T.pda),ata(alice.publicKey)]],false)],[alice]))
        rec('SR.1','the helper called DIRECTLY, not through Core (nobody can sign for the vault wallet)','REJECT,'+heldT,
          `${direct.ok?'ALLOW':'REJECT'},${await tokBal(ata(T.pda))}`,direct.err)
        const elsewhere=await att(()=>send([ixOpen(T,alice.publicKey),...viaCore(T,sweepIx(T,alice.publicKey,[[ata(T.pda),ata(bob.publicKey)]])),
          ixBurn(T,alice.publicKey,declare(T.pda))],[alice]))
        rec('SR.2','a redemption whose sweep names, as the destination, an account the named destination wallet does NOT own (bob\'s, for alice)','REJECT,'+heldT,
          `${elsewhere.ok?'ALLOW':'REJECT'},${await tokBal(ata(T.pda))}`,elsewhere.err)
        // THE RACE, staged: the page read heldT, then a stranger's dust landed.
        await send([createTransferInstruction(ata(deployer.publicKey),ata(T.pda),deployer.publicKey,1n)],[deployer])
        const stale=await att(()=>send([ixOpen(T,alice.publicKey),...sweep(T,heldT,0),ixBurn(T,alice.publicKey,declare(T.pda))],[alice]))
        rec('SR.3','(the defect) the exact-amount sweep, after 1 sat of dust landed: the opening FAILS','REJECT',stale.ok?'ALLOW':'REJECT',stale.err)
        // Round 25 (N4): SR.4a is EXACT. Every lamport that moves is between alice,
        // the vault wallet, its cbBTC account and the asset, plus the fee; each is
        // measured, and the helper's own log names the wallet's lamports it moved.
        const pda0=BigInt(await conn.getBalance(T.pda,CM))
        await send([SystemProgram.transfer({fromPubkey:deployer.publicKey,toPubkey:T.pda,lamports:1_000_000})],[deployer])
        const aB=await tokBal(ata(alice.publicKey)), lamB=BigInt(await conn.getBalance(alice.publicKey,CM))
        const ataL=BigInt(await conn.getBalance(ata(T.pda),CM)), assetL0=BigInt(await conn.getBalance(T.asset,CM)), pda1=BigInt(await conn.getBalance(T.pda,CM))
        let sigLive=''
        const live=await att(async()=>{ sigLive=await send([ixOpen(T,alice.publicKey),...viaCore(T,sweepIx(T,alice.publicKey,[[ata(T.pda),ata(alice.publicKey)]])),
          ixBurn(T,alice.publicKey,declare(T.pda))],[alice]) })
        const aT=await conn.getAccountInfo(T.asset,CM)
        rec('SR.4','the SAME race through the helper: the opening lands, the owner gets everything INCLUDING the dust, the vault is burned',
          `ALLOW,${heldT+1n},0,true`,`${live.ok?'ALLOW':'REJECT'},${(await tokBal(ata(alice.publicKey)))-aB},${await conn.getBalance(T.pda,CM)},${!aT||aT.data[0]!==1}`,live.err)
        {
          let fee=-1n, swept='no CBOB_SWEEP lamports line'
          for(let i=0;i<20&&fee<0n;i++){ const t=await conn.getTransaction(sigLive,{commitment:CM,maxSupportedTransactionVersion:0})
            if(t?.meta){ fee=BigInt(t.meta.fee); swept=(t.meta.logMessages||[]).find(l=>l.includes('CBOB_SWEEP lamports='))?.split('CBOB_SWEEP lamports=')[1]??swept } else await sleep(250) }
          const assetL1=BigInt(await conn.getBalance(T.asset,CM)), lamA=BigInt(await conn.getBalance(alice.publicKey,CM))
          const want=1_000_000n+pda0+ataL+(assetL0-assetL1)-fee
          rec('SR.4a','...and EXACTLY this many lamports reached her: the stranger\'s 1,000,000 + what the vault wallet held before + the closed cbBTC account\'s rent + what the burn returned from the asset - the fee she paid; the helper moved the wallet\'s whole balance itself',
            `${want},${pda0+1_000_000n},${pda0+1_000_000n}`,`${lamA-lamB},${pda1},${swept}`,
            `1,000,000 + wallet ${pda0} + account rent ${ataL} + asset ${assetL0}->${assetL1} - fee ${fee}`)
        }
        await ck('P','SR.4')
        // ═══ ROUND 25 (N3): THE HELPER'S WHOLE ACCESS CONTROL IS CORE'S ExecuteV1 RULE ═══
        // ...and the only state where it matters is a THAWED vault, inside a genuine
        // open. Core (this pinned binary) approves an Execute only for the asset's
        // owner; the collection abstains; a transfer delegate has no Execute rule.
        // The one plugin route that can APPROVE one, AgentIdentity, cannot be added
        // by an owner (R24.1a). Each attempt below would sweep the vault to the
        // attacker if Core let it through; each must be refused BY CORE (0x1a
        // NoApprovals), with SEAL's open itself untouched.
        let U2:V|null=null
        for(const v of VAULTS){ if(v===T) continue; const r=await recOf(v.asset); if(!r||r[OFF_REC_ACTIVE]||r[OFF_REC_PENDING]||r[OFF_REC_RETIRED]) continue
          const a=await conn.getAccountInfo(v.asset,CM); if(!a||a.data[0]!==1||!new W(a.data.subarray(1,33)).equals(alice.publicKey)) continue
          if(await conn.getAccountInfo(ata(v.pda),CM)){U2=v;break} }
        rec('SR.pre','(precondition) a second live, sealed, unactivated vault alice owns, with a cbBTC account','true',String(!!U2))
        if(U2){
          const V2=U2
          await send([createTransferInstruction(ata(deployer.publicKey),ata(V2.pda),deployer.publicKey,1_000n),
            SystemProgram.transfer({fromPubkey:deployer.publicKey,toPubkey:V2.pda,lamports:1_000_000})],[deployer])
          const h2=await tokBal(ata(V2.pda)), l2=await conn.getBalance(V2.pda,CM)
          const by=(v:{umiAsset:any,pdaU:any},ix:TransactionInstruction,who:Keypair,c:any=coll.publicKey)=>execute(umi,{asset:{publicKey:v.umiAsset},
            collection:{publicKey:c} as any,instructions:[fromWeb3JsInstruction(ix)],signers:[createNoopSigner(v.pdaU)],authority:U(who),payer:U(who)})
            .getInstructions().map(i=>new TransactionInstruction({programId:toWeb3JsPublicKey(i.programId),data:Buffer.from(i.data),
              keys:i.keys.map(k=>({pubkey:toWeb3JsPublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable}))}))
          const thawedBy=(who:Keypair,dest:W)=>attP(()=>send([ixOpen(V2,alice.publicKey),...by(V2,sweepIx(V2,dest,[[ata(V2.pda),ata(dest)]]),who),
            ixBurn(V2,alice.publicKey,declare(V2.pda))],[alice,who]))
          const sealFailed=(e:string)=>e.includes(`${SEAL_PROG.toBase58()} failed`)
          const xBob=await thawedBy(bob,bob.publicKey)
          rec('SR.5','inside a GENUINE open (the vault thawed), BOB, a stranger, drives Core ExecuteV1 into the helper to sweep the vault to himself','REJECT,false',
            `${xBob.ok?'ALLOW':'REJECT'},${sealFailed(xBob.err)}`,xBob.err)
          const del=Keypair.generate()
          await send([SystemProgram.transfer({fromPubkey:deployer.publicKey,toPubkey:del.publicKey,lamports:LAMPORTS_PER_SOL/10}),
            createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,ata(del.publicKey),del.publicKey,mint)],[deployer])
          const tdAdd=await attP(()=>addPlugin(umi,{asset:V2.umiAsset,collection:coll.publicKey,authority:aliceU,payer:aliceU,
            plugin:{type:'TransferDelegate',authority:{type:'Address',address:pk(del.publicKey.toBase58())}}} as any).sendAndConfirm(umi,{confirm:{commitment:CM}}))
          const xDel=await thawedBy(del,del.publicKey)
          rec('SR.5a','...the same by a Core TRANSFER DELEGATE the owner herself added (the add lands; the Execute does not)','ALLOW,REJECT,false',
            `${tdAdd.ok?'ALLOW':'REJECT'},${xDel.ok?'ALLOW':'REJECT'},${sealFailed(xDel.err)}`,`${tdAdd.err} ${xDel.err}`)
          if(tdAdd.ok) await att(()=>removePlugin(umi,{asset:V2.umiAsset,collection:coll.publicKey,authority:aliceU,payer:aliceU,plugin:{type:'TransferDelegate'}} as any).sendAndConfirm(umi,{confirm:{commitment:CM}}))
          // THE COLLECTION'S UPDATE AUTHORITY. On the CBOB collection it is MINT's
          // PDA: off-curve, so no key exists to sign an Execute as it, and MINT has no
          // Execute CPI (its Core CPIs are Create, AddCollectionPlugin, UpdatePlugin,
          // BurnV1). Core's rule for one that CAN sign is measured on the control.
          const cobj:any=await fetchCollection(umi,coll.publicKey)
          rec('SR.5b','the CBOB collection\'s update authority is MINT\'s PDA, OFF-CURVE: no key exists that could sign an Execute as it',
            `${MINT_AUTH.toBase58()},false`,`${String(cobj.updateAuthority)},${W.isOnCurve(MINT_AUTH.toBytes())}`)
          const [caPdaU]=findAssetSignerPda(umi,{asset:CA.publicKey}), caPda=toWeb3JsPublicKey(caPdaU)
          await send([SystemProgram.transfer({fromPubkey:deployer.publicKey,toPubkey:caPda,lamports:1_000_000})],[deployer])
          const CAV={umiAsset:CA.publicKey,pdaU:caPdaU,pda:caPda}
          const xUA=await attP(()=>send(by(CAV,sweepIx(CAV as any,ctrlUA.publicKey,[]),ctrlUA,ctrlX.publicKey),[ctrlUA]))
          rec('SR.5c','CONTROL ASSET, seal thawed: its COLLECTION update authority (a key we hold) drives Execute into the helper','REJECT',xUA.ok?'ALLOW':'REJECT',xUA.err)
          const xOwn=await attP(()=>send(by(CAV,sweepIx(CAV as any,alice.publicKey,[]),alice,ctrlX.publicKey),[alice]))
          rec('SR.5d','CONTROL: the same Execute signed by that asset\'s OWNER lands, and its wallet is emptied (the call is well formed)','ALLOW,0',
            `${xOwn.ok?'ALLOW':'REJECT'},${await conn.getBalance(caPda,CM)}`,xOwn.err)
          await send([SystemProgram.transfer({fromPubkey:deployer.publicKey,toPubkey:caPda,lamports:1_000_000})],[deployer])
          const nonSystemBefore=(await conn.getAccountInfo(ata(alice.publicKey),CM))!
          const xNonSystem=await attP(()=>send(by(CAV,sweepIx(CAV as any,ata(alice.publicKey),[]),alice,ctrlX.publicKey),[alice]))
          const nonSystemAfter=(await conn.getAccountInfo(ata(alice.publicKey),CM))!
          rec('R27.S1','helper may credit lamports to a non-System-owned destination; its token data stays unchanged','ALLOW,0,1000000,true',
            `${xNonSystem.ok?'ALLOW':'REJECT'},${await conn.getBalance(caPda,CM)},${nonSystemAfter.lamports-nonSystemBefore.lamports},${nonSystemBefore.owner.equals(TOKEN_PROGRAM_ID)&&nonSystemAfter.owner.equals(nonSystemBefore.owner)&&nonSystemAfter.data.equals(nonSystemBefore.data)}`,xNonSystem.err)
          // ═══ ROUND 25 (N4): EVERY REFUSAL BRANCH OF THE HELPER, each in a genuine
          // owner redemption (open, Core Execute by the owner, burn), each pinned to
          // the exact error the helper produced (measured on this binary first). ═══
          const hx=(dest:W,pairs:[W,W][],o:any={})=>new TransactionInstruction({programId:SWEEP,data:Buffer.from(o.data??[0]),
            keys:[{pubkey:V2.pda,isSigner:true,isWritable:true},{pubkey:dest,isSigner:false,isWritable:true},
              {pubkey:o.tok??TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},{pubkey:o.sys??SystemProgram.programId,isSigner:false,isWritable:false},
              ...pairs.flatMap(([a,b])=>[{pubkey:a,isSigner:false,isWritable:true},{pubkey:b,isSigner:false,isWritable:true}]),
              ...(o.extra??[]).map((k:W)=>({pubkey:k,isSigner:false,isWritable:true}))]})
          const ownerTx=(ix:TransactionInstruction)=>attP(()=>send([ixOpen(V2,alice.publicKey),...by(V2,ix,alice),ixBurn(V2,alice.publicKey,declare(V2.pda))],[alice]))
          const pU:[W,W]=[ata(V2.pda),ata(alice.publicKey)]
          for(const [id,t,ix] of [
            ['SR.6','the helper\'s instruction data is not the single byte 0',hx(alice.publicKey,[pU],{data:[1]})],
            ['SR.7','an ODD account count: a source with no destination after it',hx(alice.publicKey,[pU],{extra:[ata(V2.pda)]})],
            ['SR.8','a wrong TOKEN program id (Token-2022 in the classic program\'s place)',hx(alice.publicKey,[pU],{tok:TOKEN_2022_PROGRAM_ID})],
            ['SR.9','a wrong SYSTEM program id (the token program in its place)',hx(alice.publicKey,[pU],{sys:TOKEN_PROGRAM_ID})],
            ['SR.10','the destination wallet IS the vault wallet (a sweep to itself)',hx(V2.pda,[[ata(V2.pda),ata(V2.pda)]])],
            ['SR.11','a SOURCE the vault wallet does not own (alice\'s own cbBTC account)',hx(alice.publicKey,[[ata(alice.publicKey),ata(alice.publicKey)]])],
            ['SR.12','a destination that is the wallet\'s account for a DIFFERENT mint',hx(alice.publicKey,[[ata(V2.pda),ata(alice.publicKey,otherMint)]])],
            ['SR.12a','the SAME source named twice (a duplicate pair: the first closes it)',hx(alice.publicKey,[pU,pU])],
          ] as [string,string,TransactionInstruction][]){ const x=await ownerTx(ix); rec(id,t,'REJECT',x.ok?'ALLOW':'REJECT',x.err) }
          // A FROZEN SOURCE (cbBTC's freeze authority): the token program refuses the
          // transfer and the whole opening reverts, nothing moved.
          await send([createFreezeAccountInstruction(ata(V2.pda),mint,deployer.publicKey)],[deployer])
          const xFz=await ownerTx(hx(alice.publicKey,[pU]))
          await send([createThawAccountInstruction(ata(V2.pda),mint,deployer.publicKey)],[deployer])
          rec('SR.14','a FROZEN source account: the transfer is refused and the opening reverts','REJECT',xFz.ok?'ALLOW':'REJECT',xFz.err)
          const a2=await fetchAsset(umi,V2.umiAsset) as any
          rec('SR.5e','...and after every one of those attempts the vault still holds every sat and lamport, still SEALED, still alice\'s, the delegate removed',
            `${h2},${l2},true,${alice.publicKey.toBase58()},true`,`${await tokBal(ata(V2.pda))},${await conn.getBalance(V2.pda,CM)},${a2.permanentFreezeExecute?.frozen===true},${String(a2.owner)},${!a2.transferDelegate}`)
        }
        // ZERO PAIRS (the lamports-only sweep BURN's header relies on): a vault with
        // no token account at all, a stranger's lamports in its wallet. It opens.
        let U3:V|null=null
        for(const v of VAULTS){ if(v===T||v===U2) continue; const r=await recOf(v.asset); if(!r||r[OFF_REC_ACTIVE]||r[OFF_REC_PENDING]||r[OFF_REC_RETIRED]) continue
          const a=await conn.getAccountInfo(v.asset,CM); if(!a||a.data[0]!==1||!new W(a.data.subarray(1,33)).equals(alice.publicKey)) continue
          if(!(await conn.getAccountInfo(ata(v.pda),CM))&&!(await conn.getAccountInfo(declare(v.pda)[1],CM))){U3=v;break} }
        rec('SR.pre3','(precondition) a live, sealed, unactivated vault alice owns holding NO token account','true',String(!!U3))
        if(U3){
          const V3=U3
          await send([SystemProgram.transfer({fromPubkey:stranger.publicKey,toPubkey:V3.pda,lamports:1_000_000})],[stranger])
          const w3=BigInt(await conn.getBalance(V3.pda,CM)); let sig3=''
          const z=await att(async()=>{ sig3=await send([ixOpen(V3,alice.publicKey),...viaCore(V3,sweepIx(V3,alice.publicKey,[])),ixBurn(V3,alice.publicKey,declare(V3.pda))],[alice]) })
          const a3=await conn.getAccountInfo(V3.asset,CM)
          rec('SR.13','ZERO pairs: a lamports-only sweep opens a vault with no token account; the wallet\'s whole balance moved, the vault is burned',
            `ALLOW,true,0,true`,`${z.ok?'ALLOW':'REJECT'},${z.ok&&(await logsOf(sig3)).logs.some(l=>l.includes(`CBOB_SWEEP lamports=${w3}`))},${await conn.getBalance(V3.pda,CM)},${!a3||a3.data[0]!==1}`,
            `${z.err} wallet held ${w3}`)
          await ck('P','SR.13')
        }
      }
    }
    // ═══ 3c.F A FROZEN POOL NEVER LOCKS A VAULT (red-team 3 finding 1) ═══
    // Coinbase can freeze cbBTC accounts, the pool included. Every claim then
    // refuses, and a redemption must settle what it is owed first, so before this
    // fix every activated vault was unopenable for as long as the freeze lasted.
    {
      const Fv=late
      { const p=await pool(); await top(p.w); await send([ixDistribute(burnBy(alice))],[alice]) }
      const owed=await pendingOf(Fv.asset)
      rec('3c.F0','(precondition) the vault about to open is owed at least a whole sat','true',String(owed>=ACC_SCALE),`${owed/ACC_SCALE} sats`)
      await send([createFreezeAccountInstruction(POOL,mint,deployer.publicKey)],[deployer])
      const fc=await att(()=>send([ixPoolClaim([Fv])],[alice]))
      rec('3c.F1','with the POOL frozen, no claim can deliver','REJECT',fc.ok?'ALLOW':'REJECT',fc.err)
      const held=await tokBal(ata(Fv.pda)), p0=await pool(); let sig=''
      const fr=await att(async()=>{ sig=await send([ixOpen(Fv,alice.publicKey),...sweep(Fv,held,0),ixBurn(Fv,alice.publicKey,declare(Fv.pda))],[alice]) })
      rec('3c.F2','...yet the owner still OPENS the vault and takes everything inside it','ALLOW',fr.ok?'ALLOW':'REJECT',fr.err)
      const p1=await pool()
      rec('3c.F3','...the undelivered share returned to the pool (no longer owed), and the forfeit is logged',
        `${owed},true`,`${p0.owed-p1.owed},${(await logsOf(sig)).logs.some(l=>l.includes('CBOB_REDEEMED_POOL_FROZEN'))}`)
      await send([createThawAccountInstruction(POOL,mint,deployer.publicKey)],[deployer])
      await ck('3c','3c.F2')
    }
    // ── A BARE CORE BURN IS RETIRED BY ANYONE, AND ITS SHARE GOES BACK TO THE POOL ──
    {
      const live=await att(()=>send([ixRetireBurned(Qv.asset,Qv.asset)],[alice]))
      rec('P.24','retire a LIVE vault as if it were burned','REJECT',live.ok?'ALLOW':'REJECT',live.err)
      const pQ=await pendingOf(Qv.asset), wQ=WEIGHTS[(await lvl(Qv))-1]
      rec('P.24a','(the vault about to be bare-burned is owed a share)','true',String(pQ>=ACC_SCALE),`${pQ/ACC_SCALE} sats`)
      const asset=await fetchAsset(umi,Qv.umiAsset), col=await fetchCollection(umi,coll.publicKey)
      const bare=await att(()=>burn(umi,{asset,collection:col,authority:aliceU}).sendAndConfirm(umi,{confirm:{commitment:CM}}))
      rec('P.25','the OWNER bare-burns an activated vault through Core (proven impossibility 1: it cannot be stopped)','ALLOW',bare.ok?'ALLOW':'REJECT',bare.err)
      const imp=await att(()=>send([ixRetireBurned(Qv.asset,Keypair.generate().publicKey)],[alice]))
      rec('P.26','retire it presenting an EMPTY system account as the asset','REJECT',imp.ok?'ALLOW':'REJECT',imp.err)
      const p0=await pool()
      const ret=await att(()=>send([ixRetireBurned(Qv.asset,Qv.asset)],[alice]))
      rec('P.27','ANYONE retires the bare-burned vault','ALLOW',ret.ok?'ALLOW':'REJECT',ret.err)
      const p1=await pool()
      rec('P.27a','...its unclaimed share is no longer owed: it returned to the pool',String(pQ),String(p0.owed-p1.owed))
      rec('P.27b','...its weight left, and it is counted as a bare burn',`${p0.w-wQ},${p0.bare+1n}`,`${p1.w},${p1.bare}`)
      await ck('P','P.27')
      const twice=await att(()=>send([ixRetireBurned(Qv.asset,Qv.asset)],[alice]))
      rec('P.28','retire it twice','REJECT',twice.ok?'ALLOW':'REJECT',twice.err)
      const BQ=await propose(actRound(),{votes:'none'})
      const pr=await readProp(BQ.id); const c=await cfg()
      const minted=c.readBigUInt64LE(OFF_MINTED_TOTAL), burned=(await conn.getAccountInfo(BURN_CFG,CM))!.data.readBigUInt64LE(OFF_BURNED_TOTAL)
      rec('P.29','GOV\'s live supply subtracts the RETIRED bare burn too',String(minted-burned-c.readBigUInt64LE(OFF_BARE_RETIRED)),String(pr.quorumSupply),
        `${minted} minted - ${burned} redeemed - ${c.readBigUInt64LE(OFF_BARE_RETIRED)} bare-burned`)
    }
    // ── THE BATCH BOUND, AND WHAT IT COSTS ──
    {
      const bh='11111111111111111111111111111111'
      const fake=(n:number)=>Array.from({length:n},()=>{const k=Keypair.generate().publicKey; return {asset:k,pda:k}})
      let maxN=0; for(let n=1;n<=64;n++){ const tx=new Transaction().add(ixPoolClaim(fake(n))); tx.feePayer=alice.publicKey; tx.recentBlockhash=bh
        try{ tx.serialize({requireAllSignatures:false,verifySignatures:false}); maxN=n }catch{ break } }
      rec('P.30','a legacy claim transaction carries a measured number of vaults (the PACKET stops it, not the probe)','true',String(maxN>1&&maxN<64),`${maxN} vaults per claim`)
      const p=await pool(); await top(11n*p.w)
      await send([ixDistribute(burnBy(alice))],[alice])
      const live=[C1,ex,...picks.filter(v=>v!==Rv&&v!==Qv),ex1].filter(Boolean)
      for(const v of live){ const r=(await recOf(v.asset))!; if(!r[OFF_REC_ACTIVE]) await send([ixActivate(v)],[deployer]) }
      const sig=await send([ixPoolClaim(live)],[alice])
      const cu=await cuOf(sig)
      rec('P.31',`a real claim paying ${live.length} vaults stays under the regression ceiling`,'true',String(cu<CU_CEILING),`${cu} CU`)
      const q=await pool()
      rec('P.32','THE INVARIANT: the pool always holds at least what it owes','true',String(q.bal>=q.owedCeil),`${q.bal} held, ${q.owedCeil} owed`)
      await ck('P','P.31')
    }
    // ── THE CRANK BOUND, ON ITS TIGHTEST CARRIER ──
    {
      const bh='11111111111111111111111111111111'
      const fits=(ix:TransactionInstruction)=>{const tx=new Transaction().add(ix); tx.feePayer=alice.publicKey; tx.recentBlockhash=bh
        try{ return tx.serialize({requireAllSignatures:false,verifySignatures:false}).length }catch{ return 99999 }}
      const four=Array.from({length:4},()=>Keypair.generate().publicKey)
      const depth8=Array.from({length:8},()=>Buffer.alloc(32,9))
      const ch=fits(ixClaim(Keypair.generate().publicKey,alice.publicKey,alice.publicKey,POB[0],depth8,{crank:four}))
      const mi=fits(ixMint(Keypair.generate().publicKey,alice.publicKey,alice.publicKey,{crank:four}))
      const ac=fits(ixActivate(C1,{crank:four})), cl=fits(ixPoolClaim([C1],{crank:four}))
      rec('P.33','the full crank (4) rides on a CHARTER CLAIM with a mainnet-depth (240-leaf) proof, and on mint, activate and claim','true',
        String(Math.max(ch,mi,ac,cl)<=1232),`charter ${ch}B, mint ${mi}B, activate ${ac}B, claim ${cl}B`)
      // RED-TEAM 3 #7: the claim page's worst real shape. Rule: when the Moments
      // collection needs a pass-through account, the page sends NO crank.
      const ixW=ixClaim(Keypair.generate().publicKey,alice.publicKey,alice.publicKey,POB[0],depth8,{extra:[ORACLE_OK]})
      ixW.keys=ixW.keys.map((k,i)=>i===5?{...k,pubkey:Keypair.generate().publicKey}:k)
      const tx=new Transaction().add(
        new TransactionInstruction({programId:new W('ComputeBudget111111111111111111111111111111'),keys:[],data:Buffer.from([2,0x40,0x0d,0x03,0x00])}),
        new TransactionInstruction({programId:new W('ComputeBudget111111111111111111111111111111'),keys:[],data:Buffer.from([3,1,0,0,0,0,0,0,0])}),ixW)
      tx.feePayer=alice.publicKey; tx.recentBlockhash=bh
      let wb=99999; try{ wb=tx.serialize({requireAllSignatures:false,verifySignatures:false}).length }catch{}
      rec('3c.P1','a charter claim with an Oracle pass-through, a SEPARATE payer, compute-budget ixs and a depth-8 proof (no crank) fits','true',
        String(wb<=1232),`${wb} bytes of 1232`)
    }
    // ── THE FREE PATH, ONCE THE PERIOD HAS RUN ("we do monthly no matter what") ──
    {
      await waitDue()
      const p=await pool(); await top(p.w)
      const s0=await garySupply(); let sig=''
      const fr=await att(async()=>{ sig=await send([ixDistribute()],[alice]) })
      rec('PG.8','the FREE path once the period has run: no burn, anyone','ALLOW',fr.ok?'ALLOW':'REJECT',fr.err)
      const ll=fr.ok?await sigLogs(sig):[]
      rec('PG.8a','...logged path=monthly, and no $GARY moved','true,true',`${ll.length===1&&ll[0].includes('path=monthly')},${s0===await garySupply()}`)
      await ck('P','PG.8')
      await top(p.w)
      const fr2=await att(()=>send([ixDistribute()],[alice]))
      rec('PG.9','...and a second free distribution right after it is refused (one per period)','REJECT',fr2.ok?'ALLOW':'REJECT',fr2.err)
    }
    // ROUND 25 (round-24 C9): THE BOOKS OUTSIDE SECTION BO. Every label below is
    // pushed only if `ledger()` balanced right after that money operation, so a
    // check that failed OR was deleted shows here as a missing label.
    const BKT='the books (weights, boost totals, ring, pool >= owed, owed == the sum of every share) balance after EVERY money operation in section'
    rec('BK.IN',`${BKT} IN`,'IN.0,IN.1,IN.4,IN.5',BK.IN.join(','))
    rec('BK.3c',`${BKT} 3c`,'3c.A4,3c.A5,3c.A6,3c.A6a,3c.F2',BK['3c'].join(','))
    rec('BK.P',`${BKT} P (and the sweep helper's redemptions)`,'P.9,P.10,P.12,P.13,PG.1,P.17b,F21.1,P.18,P.18c,P.22,SR.4,SR.13,P.27,P.31,PG.8',BK.P.join(','))
    // ═══ BO. THE $CBOB BOOST (Gary, 2026-10-04: "Yes you can upgrade by burning
    // CBOB. We just don't know exactly what yet.") A temporary boost, outside the
    // census, its terms set by a Governor vote and OFF until the first one. ═══
    console.log('\n─── BO. the $CBOB boost: burn $CBOB, weigh more for N distributions, then exactly back ───')
    {
      const BW=2, BE=2, PRICE_CBOB=2_000_000_000n
      // The buyer's terms (round 23 F11): permissive unless an arm says otherwise.
      const ixBoost=(v:V,burner:Keypair,o:any={})=>new TransactionInstruction({programId:MINT_PROG,
        data:Buffer.concat([d('boost_vault'),u64(o.maxPrice??18446744073709551615n),u8b(o.minW??0),u16(o.minE??0)]),
        keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:vrec(v.asset),isSigner:false,isWritable:true},
          {pubkey:v.asset,isSigner:false,isWritable:false},{pubkey:burner.publicKey,isSigner:true,isWritable:false},
          {pubkey:o.from??cbobAta(burner.publicKey),isSigner:false,isWritable:true},{pubkey:o.cmint??cbobMint,isSigner:false,isWritable:true},
          {pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},POOLK]})
      const ixExpire=(vs:V[])=>new TransactionInstruction({programId:MINT_PROG,data:d('expire_boosts'),
        keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},...vs.map(v=>({pubkey:vrec(v.asset),isSigner:false,isWritable:true}))]})
      const recB=async(v:V)=>{const r=(await recOf(v.asset))!
        return {w:r[OFF_REC_BOOST_W],end:r.readBigUInt64LE(OFF_REC_BOOST_END),carry:u128le(r,OFF_REC_CARRY),base:WEIGHTS[r[OFF_REC_LEVEL]-1]}}
      const bc=async()=>{const c=await cfg()
        let ring=0; for(let i=0;i<BOOST_RING;i++) ring+=c.readUInt32LE(OFF_BOOST_RING+4*i)
        return {price:c.readBigUInt64LE(OFF_BOOST_PRICE),w:c[OFF_BOOST_W],e:c.readUInt16LE(OFF_BOOST_E),
          active:c.readUInt32LE(OFF_BOOSTS_ACTIVE),due:c.readUInt32LE(OFF_BOOSTS_DUE),wt:c.readBigUInt64LE(OFF_BOOST_W_TOTAL),
          burned:c.readBigUInt64LE(OFF_CBOB_BURNED),ring,epoch:c.readBigUInt64LE(OFF_DIST_EPOCH),last:c.readBigInt64LE(OFF_LAST_DIST)}}
      const isLive=async(v:V)=>{const r=await recOf(v.asset); return !!r&&!!r[OFF_REC_ACTIVE]&&!r[OFF_REC_RETIRED]}
      const LIVE:V[]=[]; for(const v of VAULTS) if(await isLive(v)) LIVE.push(v)
      const claimAll=async(vs:V[])=>{for(let i=0;i<vs.length;i+=6) await send([ixPoolClaim(vs.slice(i,i+6))],[alice])}
      /** THE BOOKS, recomputed from every record: the denominator is the sum of
       *  every live vault's weight NOW, the boost totals and the schedule agree,
       *  and the pool holds what it owes. */
      const books=async()=>{const c=await bc(); const p=await pool(); let w=0n, bw=0n, n=0
        for(const v of VAULTS){const r=await recOf(v.asset); if(!r||!r[OFF_REC_ACTIVE]||r[OFF_REC_RETIRED]) continue
          w+=WEIGHTS[r[OFF_REC_LEVEL]-1]+BigInt(r[OFF_REC_BOOST_W]); bw+=BigInt(r[OFF_REC_BOOST_W]); if(r[OFF_REC_BOOST_W]) n++}
        return `${p.w===w},${c.wt===bw},${c.active===n},${c.ring+c.due===c.active},${p.bal>=p.owedCeil}`}
      const BOOKS='true,true,true,true,true'
      /** One exact distribution (a whole number of sats per weight unit) and the
       *  share per unit it paid. */
      // Earlier sections leave vaults waiting to join; the program refuses a
      // distribution while one is eligible (JoinWaitingFirst), so join them first,
      // exactly as the crank does.
      const joinWaiting=async()=>{const e=(await cfg()).readBigUInt64LE(OFF_DIST_EPOCH)
        for(const v of VAULTS){const r=await recOf(v.asset)
          if(r&&r[OFF_REC_PENDING]&&!r[OFF_REC_RETIRED]&&r.readBigUInt64LE(OFF_REC_REQ_EPOCH)<e) await send([ixPoolClaim([v])],[alice])}}
      const exactDist=async(k:bigint)=>{await joinWaiting(); const p=await pool(); await top(k*p.w+(p.w-(p.avail%p.w))%p.w)
        const q=await pool(); await send([ixDistribute(burnBy(alice))],[alice]); return q.avail/q.w}
      const mine:V[]=[]; for(const v of LIVE) if(await isAlice(v)) mine.push(v)
      rec('BO.pre','(precondition) at least four live, joined vaults alice owns, for four boosts','true',String(mine.length>=4),`${mine.length}`)
      const [X,Y,Z,Q]=mine
      // ── OFF until a vote ──
      const off=await att(()=>send([ixBoost(X,alice)],[alice]))
      rec('BO.2','boost a vault before any vote has set the terms','REJECT',off.ok?'ALLOW':'REJECT',off.err)
      const vt=await propose(actBoost(PRICE_CBOB,BW,BE)); await waitEnds(vt.ends)
      const ex=await exec(vt.id)
      { const c=await bc()
        rec('BO.3','a Governor vote sets the terms: price, extra weight, distributions','ALLOW,'+`${PRICE_CBOB},${BW},${BE}`,
          `${ex.ok?'ALLOW':'REJECT'},${c.price},${c.w},${c.e}`,ex.err) }
      // ── the refusals ──
      const gone=await att(()=>send([ixBoost(H,alice)],[alice]))
      rec('BO.4','boost a REDEEMED vault (only an activated vault earns, so only one can be boosted)','REJECT',gone.ok?'ALLOW':'REJECT',gone.err)
      const wm=await att(()=>send([ixBoost(X,alice,{cmint:mint,from:ata(alice.publicKey)})],[alice]))
      rec('BO.5','boost "burning" cbBTC instead of THE $CBOB mint','REJECT',wm.ok?'ALLOW':'REJECT',wm.err)
      // NO GIFTS (Gary 2026-10-04): only the vault's current owner may boost it.
      await mintTo(conn,deployer,cbobMint,cbobAta(bob.publicKey),deployer,PRICE_CBOB,[],{commitment:CM})
      const gift=await att(()=>send([ixBoost(X,bob)],[bob]))
      rec('BO.6','a STRANGER (holding enough $CBOB) boosts a vault alice owns: no gifted boosts','REJECT,true',
        `${gift.ok?'ALLOW':'REJECT'},${(await tokBal(cbobAta(bob.publicKey)))>=PRICE_CBOB}`,gift.err)
      const emptyAcct=await createAccount(conn,deployer,cbobMint,alice.publicKey,Keypair.generate(),{commitment:CM})
      const poor=await att(()=>send([ixBoost(X,alice,{from:emptyAcct})],[alice]))
      rec('BO.6b','the OWNER boosts from a $CBOB account holding nothing','REJECT',poor.ok?'ALLOW':'REJECT',poor.err)
      // ── A BOOST CARRIES WHAT THE VAULT IS ALREADY OWED ──
      await claimAll(LIVE)
      const k0=await exactDist(10n)
      await claimAll(LIVE.filter(v=>v!==X))
      const owedX=await pendingOf(X.asset), p0=await pool()
      const s0=await cbobSupply(), a0=await tokBal(cbobAta(alice.publicKey)), e0=(await bc()).epoch
      const bx=await att(()=>send([ixBoost(X,alice)],[alice]))
      const bX=await recB(X), p1=await pool()
      rec('BO.7','the OWNER burns $CBOB to boost its activated vault','ALLOW',bx.ok?'ALLOW':'REJECT',bx.err)
      rec('BO.7a','...the $CBOB SUPPLY fell by exactly the price, all from the burner',`${PRICE_CBOB},${PRICE_CBOB}`,
        `${s0-await cbobSupply()},${a0-await tokBal(cbobAta(alice.publicKey))}`)
      rec('BO.7b','...it weighs BW more until BE distributions from now, and the denominator moved by exactly BW',
        `${BW},${e0+BigInt(BE)},${p0.w+BigInt(BW)}`,`${bX.w},${bX.end},${p1.w}`)
      // owedX is this distribution's share plus any sub-sat dust from earlier ones.
      rec('BO.7c','...and what it was ALREADY owed is carried whole (nothing gained, nothing lost, nothing owed anew)',
        `${bX.base*k0},${owedX},${p0.owed}`,`${owedX/ACC_SCALE},${await pendingOf(X.asset)},${p1.owed}`)
      const twice=await att(()=>send([ixBoost(X,alice)],[alice]))
      rec('BO.8','boost the same vault again while its boost runs','REJECT',twice.ok?'ALLOW':'REJECT',twice.err)
      const second=await att(()=>send([ixBoost(Y,alice)],[alice]))
      rec('BO.9','the owner boosts a SECOND vault of hers (one boost per vault, not per owner)','ALLOW',second.ok?'ALLOW':'REJECT',second.err)
      rec('BO.9a','...and the books balance with two boosts live',BOOKS,await books())
      // ── TWO DISTRIBUTIONS AT THE BOOSTED WEIGHT ──
      const paid=async(k:bigint,extra:Map<V,bigint>)=>{const before=await Promise.all(LIVE.map(v=>tokBal(ata(v.pda))))
        await claimAll(LIVE); const got=await Promise.all(LIVE.map(async(v,i)=>(await tokBal(ata(v.pda)))-before[i]))
        const want=await Promise.all(LIVE.map(async v=>{const r=(await recOf(v.asset))!; return WEIGHTS[r[OFF_REC_LEVEL]-1]*k+(extra.get(v)??0n)}))
        return [want.join(','),got.join(',')]}
      const k1=await exactDist(10n)
      { const [w,g]=await paid(k1,new Map([[X,BigInt(BW)*k1+bX.base*k0],[Y,BigInt(BW)*k1]]))
        rec('BO.10','distribution 1 of 2: the boosted vaults are paid at their boosted weight (X also gets what it carried)',w,g) }
      rec('BO.10a','...after the first of two, nothing is due yet','0,2',`${(await bc()).due},${(await bc()).active}`)
      const early=await att(()=>send([ixExpire([X])],[alice]))
      rec('BO.10b','expire_boosts on a boost NOT yet due lands and changes nothing (it is skipped, never cut short)',
        `ALLOW,${BW},2`,`${early.ok?'ALLOW':'REJECT'},${(await recB(X)).w},${(await bc()).active}`,early.err)
      const k2=await exactDist(10n)
      { const before=await Promise.all(LIVE.map(v=>tokBal(ata(v.pda))))
        // Claim only the UNBOOSTED vaults: the boosted ones are claimed (and so
        // expired) below, after the gate has been tried.
        await claimAll(LIVE.filter(v=>v!==X&&v!==Y))
        const c=await bc()
        rec('BO.11','distribution 2 of 2 makes both boosts DUE (they have had every distribution they bought)','2,2',`${c.due},${c.active}`)
        // ── THE GATE: nothing distributes past a due boost ──
        const pw=(await pool()).w; await top(pw)
        const g0=await garySupply()
        const gate=await att(()=>send([ixDistribute(burnBy(alice))],[alice]))
        rec('BO.12','a distribution while a boost is DUE (and it burns no $GARY)','REJECT,true',
          `${gate.ok?'ALLOW':'REJECT'},${g0===await garySupply()}`,gate.err)
        // ...and the monthly in-line run waits too, on a host that expires nothing.
        await waitDue()
        const l0=(await bc()).last
        let sig=''; await send([ixPoolClaim([Z])],[alice]).then(x=>{sig=x})
        const lg=(await logsOf(sig)).logs.filter(l=>l.includes('CBOB_MONTHLY_WAITS_FOR_BOOSTS'))
        rec('BO.13','...and the MONTHLY in-line run waits for it too (logged, nothing credited)','1,true',
          `${lg.length},${l0===(await bc()).last}`)
        // ── EXPIRY, TWO WAYS: expire_boosts (records only) and claim ──
        const eb=await att(()=>send([ixExpire([Y,Z])],[alice]))
        rec('BO.13a','ANYONE expires a due boost with expire_boosts, records only (an unboosted record in the batch is skipped)',
          'ALLOW,0,1',`${eb.ok?'ALLOW':'REJECT'},${(await recB(Y)).w},${(await bc()).due}`,eb.err)
        const ce=await att(()=>send([ixPoolClaim([X,Y])],[alice]))
        const gotX=(await tokBal(ata(X.pda)))-before[LIVE.indexOf(X)], gotY=(await tokBal(ata(Y.pda)))-before[LIVE.indexOf(Y)]
        const rX=await recB(X), rY=await recB(Y), c2=await bc()
        rec('BO.14','the claim pays both for distribution 2 at the boosted weight (Y\'s carried, X expired inside the claim)',
          `ALLOW,${(rX.base+BigInt(BW))*k2},${(rY.base+BigInt(BW))*k2},0,0,0,0`,
          `${ce.ok?'ALLOW':'REJECT'},${gotX},${gotY},${rX.w},${rY.w},${c2.due},${c2.active}`,ce.err)
        rec('BO.14a','...and the books balance with every boost gone',BOOKS,await books())
      }
      const k3=await exactDist(10n)
      { const [w,g]=await paid(k3,new Map())
        rec('BO.15','the next distribution pays the expired vaults their LEVEL weight again, exactly',w,g) }
      // ── A BOOSTED VAULT RETIRED, before its boost is due and after ──
      await mintTo(conn,deployer,cbobMint,cbobAta(alice.publicKey),deployer,4n*PRICE_CBOB,[],{commitment:CM})
      const col=await fetchCollection(umi,coll.publicKey)
      const bare=async(v:V)=>{ await burn(umi,{asset:await fetchAsset(umi,v.umiAsset),collection:col,authority:aliceU}).sendAndConfirm(umi,{confirm:{commitment:CM}})
        return att(()=>send([ixRetireBurned(v.asset,v.asset)],[alice])) }
      await send([ixBoost(Z,alice)],[alice])
      const rz=await bare(Z)
      const cz=await bc()
      rec('BO.16','a boosted vault bare-burned and retired BEFORE its boost is due leaves the schedule whole','ALLOW,0,0,0',
        `${rz.ok?'ALLOW':'REJECT'},${cz.active},${cz.ring},${cz.due}`,rz.err)
      rec('BO.16a','...and the books balance',BOOKS,await books())
      const LIVE2=LIVE.filter(v=>v!==Z)
      await send([ixBoost(Q,alice)],[alice])
      for(let i=0;i<BE;i++){ await exactDist(3n); await claimAll(LIVE2.filter(v=>v!==Q)) }
      const dueQ=(await bc()).due
      const rq=await bare(Q)
      const cq=await bc()
      rec('BO.17','a boosted vault retired AFTER its boost is DUE clears the gate','1,ALLOW,0,0',
        `${dueQ},${rq.ok?'ALLOW':'REJECT'},${cq.due},${cq.active}`,rq.err)
      { await joinWaiting(); const pw=(await pool()).w; await top(pw)
        const after=await att(()=>send([ixDistribute(burnBy(alice))],[alice]))
        rec('BO.17a','...so the next distribution runs','ALLOW',after.ok?'ALLOW':'REJECT',after.err)
        await claimAll(LIVE2.filter(v=>v!==Q)) }
      rec('BO.17b','...and the books balance',BOOKS,await books())
      rec('BO.18','every $CBOB burned for a boost is counted on chain',String(4n*PRICE_CBOB),String((await bc()).burned))
      { const fake=Array.from({length:20},()=>({asset:Keypair.generate().publicKey} as any as V))
        const tx=new Transaction().add(ixExpire(fake)); tx.feePayer=alice.publicKey; tx.recentBlockhash='11111111111111111111111111111111'
        let B=99999; try{ B=tx.serialize({requireAllSignatures:false,verifySignatures:false}).length }catch{}
        rec('BO.18a','the crank\'s expire batch (20 records) fits a legacy transaction','true',String(B<=1232),`${B} bytes`) }
      // ═══ ROUND 23 (F7): THE ORDERINGS NOBODY HAD RUN ═══
      // (f) a vault that has REQUESTED activation but not joined cannot be boosted.
      { let cand:V|null=null
        for(const v of VAULTS){const r=await recOf(v.asset); if(!r||!r[OFF_REC_LEVEL]||r[OFF_REC_ACTIVE]||r[OFF_REC_PENDING]||r[OFF_REC_RETIRED]) continue
          const a=await conn.getAccountInfo(v.asset,CM); if(a&&a.data[0]===1&&await isAlice(v)){cand=v;break}}
        let res:any={ok:false,err:'NO CANDIDATE: no live, revealed, unactivated vault alice owns'}
        if(cand){ await fund(cand,ACTIVATION); await send([ixActivate(cand)],[deployer]); res=await att(()=>send([ixBoost(cand!,alice)],[alice])) }
        rec('BO.20','boost a vault that has only REQUESTED activation (not joined, earns nothing yet)','REJECT',res.ok?'ALLOW':(cand?'REJECT':'NO-CANDIDATE'),res.err) }
      // (a) a boost and a distribution in ONE transaction: that distribution is the first of its N.
      { await joinWaiting(); const p=await pool(); await top(p.w+(p.w-(p.avail%p.w))%p.w)
        const e0=(await bc()).epoch
        const one=await att(()=>send([ixBoost(X,alice),ixDistribute(burnBy(alice))],[alice]))
        const rx=await recB(X), c1=await bc()
        rec('BO.21','a boost and a distribution in ONE transaction land; the boost ends N distributions after the epoch it was bought in',
          `ALLOW,${e0+BigInt(BE)},${e0+1n}`,`${one.ok?'ALLOW':'REJECT'},${rx.end},${c1.epoch}`,one.err)
        await exactDist(3n)
        rec('BO.21a','...and ONE more makes it due: it earned exactly N (the one it rode in on counts), not N+1','1',String((await bc()).due))
        await send([ixExpire([X])],[alice]); await claimAll(LIVE2.filter(v=>v!==Q)) }
      // ROUND 24 SHIP-GATE-5 PIN (W10): the REVERSE order, [distribute, boost], in ONE
      // transaction. The distribution closes epoch e first, so the boost is bought in
      // e+1 and ends at e+1+N: it does NOT count the distribution before it.
      { await joinWaiting(); const p=await pool(); await top(p.w+(p.w-(p.avail%p.w))%p.w)
        const e0=(await bc()).epoch
        const rev=await att(()=>send([ixDistribute(burnBy(alice)),ixBoost(X,alice)],[alice]))
        const rx=await recB(X), c1=await bc()
        rec('BO.35','[distribute, boost] in ONE transaction land: the boost is bought in the NEW epoch and ends at e+1+N',
          `ALLOW,${e0+1n+BigInt(BE)},${e0+1n}`,`${rev.ok?'ALLOW':'REJECT'},${rx.end},${c1.epoch}`,rev.err)
        for(let i=0;i<BE;i++) await exactDist(3n)
        rec('BO.35a','...and N MORE distributions make it due, at exactly e+1+N',`1,${e0+1n+BigInt(BE)}`,`${(await bc()).due},${(await bc()).epoch}`)
        await send([ixExpire([X])],[alice]); await claimAll(LIVE2.filter(v=>v!==Q)) }
      // (b) a boost while the month is DUE: the month is credited first, at the OLD weight.
      { await joinWaiting(); await claimAll(LIVE2.filter(v=>v!==Q))
        const p=await pool(); await top(5n*p.w+(p.w-(p.avail%p.w))%p.w); const q=await pool(); const k=q.avail/q.w
        await waitDue()
        const o0=await pendingOf(Y.asset), l0=(await bc()).last, base=(await recB(Y)).base
        const by=await att(()=>send([ixBoost(Y,alice)],[alice]))
        const o1=await pendingOf(Y.asset)
        rec('BO.22','a boost while the month is DUE: the month runs first (stamped), crediting Y at its LEVEL weight, then the boost lands',
          `ALLOW,true,${base*k}`,`${by.ok?'ALLOW':'REJECT'},${(await bc()).last!==l0},${(o1-o0)/ACC_SCALE}`,by.err) }
      // (c)(d) and F11: two terms votes, executed newest first; a live boost keeps its own terms.
      { const OLD=[3_000_000_000n,2,2] as const, NEW=[4_000_000_000n,3,3] as const
        const pOld=await propose(actBoost(OLD[0],OLD[1],OLD[2])), pNew=await propose(actBoost(NEW[0],NEW[1],NEW[2]))
        await waitEnds(Math.max(pOld.ends,pNew.ends))
        const yBefore=await recB(Y)
        const xn=await exec(pNew.id); const c=await bc()
        rec('BO.23','the NEWER terms vote executes first and its terms are live',`ALLOW,${NEW.join(',')}`,`${xn.ok?'ALLOW':'REJECT'},${c.price},${c.w},${c.e}`,xn.err)
        const yAfter=await recB(Y)
        rec('BO.24','...and a boost bought under the OLD terms keeps its weight and its end (terms never reach a live boost)',
          `${yBefore.w},${yBefore.end}`,`${yAfter.w},${yAfter.end}`)
        let sig=''; const xo=await att(async()=>{sig=await send([ixExec(propId(pOld.id))],[deployer])})
        const skipped=xo.ok?(await logsOf(sig)).logs.some(l=>l.includes('CBOB_ACTION_SKIPPED')&&l.includes('set_boost_terms')&&l.includes('superseded')):false
        const c2=await bc()
        rec('BO.25','the OLDER vote executed after it is a logged skip (superseded) and changes nothing',`ALLOW,true,${NEW.join(',')}`,
          `${xo.ok?'ALLOW':'REJECT'},${skipped},${c2.price},${c2.w},${c2.e}`,xo.err)
        const s0=await cbobSupply()
        const moved=await att(()=>send([ixBoost(X,alice,{maxPrice:OLD[0],minW:OLD[1],minE:OLD[2]})],[alice]))
        rec('BO.26','F11: a boost signed at the OLD price after the vote moved it is refused, and burns nothing','REJECT,0',
          `${moved.ok?'ALLOW':'REJECT'},${s0-await cbobSupply()}`,moved.err)
        const ok=await att(()=>send([ixBoost(X,alice,{maxPrice:NEW[0],minW:NEW[1],minE:NEW[2]})],[alice]))
        rec('BO.26a','...signed at the terms actually live, it lands at those terms',`ALLOW,${NEW[1]},${NEW[0]}`,
          `${ok.ok?'ALLOW':'REJECT'},${(await recB(X)).w},${s0-await cbobSupply()}`,ok.err) }
      // (g) set_boost_terms is GOV's alone.
      { const ixSet=new TransactionInstruction({programId:MINT_PROG,data:Buffer.concat([d('set_boost_terms'),u64(1n),u8b(1),u16(1)]),
          keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:alice.publicKey,isSigner:true,isWritable:false}]})
        const direct=await att(()=>send([ixSet],[alice]))
        rec('BO.27','a holder calls set_boost_terms DIRECTLY, signing as "governance"','REJECT',direct.ok?'ALLOW':'REJECT',direct.err) }
      // (h) one action of EACH of the five kinds is a legal proposal.
      { const live=(await cfg()).readBigUInt64LE(OFF_MAX_SWEEP)
        const five=await propose([actRound(),actBrakes({sales:true}),actTighten({maxSweep:live-1n}),actArm(Keypair.generate().publicKey),actBoost(1n,1,1)],{votes:'none'})
        rec('BO.28','a proposal carrying one action of each of the FIVE kinds is created (MAX_ACTIONS = 5)','ALLOW',five.ok?'ALLOW':'REJECT',five.err) }
      // (i) GOV's pinned discriminator for set_boost_terms is the derivation.
      rec('BO.29','GOV pins set_boost_terms\' discriminator as sha256("global:set_boost_terms")[..8]',[...d('set_boost_terms')].join(','),pinned(GOV_SRC,'IX_SET_BOOST_TERMS'))
      rec('BO.29a','...and the books balance after all of it',BOOKS,await books())
      // ═══ ROUND 24 (C1, C2, C4, C9): the evidence round 23's repairs left out ═══
      // Free alice's boosted vaults first: a few distributions, expiring as they fall due.
      const expireDue=async()=>{const e=(await bc()).epoch, due:V[]=[]
        for(const v of VAULTS){const r=await recOf(v.asset); if(r&&r[OFF_REC_ACTIVE]&&!r[OFF_REC_RETIRED]&&r[OFF_REC_BOOST_W]&&r.readBigUInt64LE(OFF_REC_BOOST_END)<=e) due.push(v)}
        for(let i=0;i<due.length;i+=20) await send([ixExpire(due.slice(i,i+20))],[alice]); return due.length}
      const step=async(k=2n)=>{await expireDue(); const kk=await exactDist(k); await expireDue(); return kk}
      await mintTo(conn,deployer,GARY_MINT,garyAta(alice.publicKey),deployer,200n*DIST_BURN,[],{commitment:CM})
      for(let i=0;i<4;i++) await step()
      await claimAll(LIVE2.filter(v=>v!==Q))
      const freeV=async(not:V[]=[])=>{for(const v of VAULTS){if(not.includes(v)) continue; const r=await recOf(v.asset)
          if(!r||!r[OFF_REC_ACTIVE]||r[OFF_REC_RETIRED]||r[OFF_REC_PENDING]||r[OFF_REC_BOOST_W]) continue; if(await isAlice(v)) return v}; return null}
      // C9: one claim naming the same vault twice pays it ONCE.
      { const D=(await freeV())!; await step(); const due0=await pendingOf(D.asset), b0=await tokBal(ata(D.pda)), o0=(await pool()).owed
        await send([ixPoolClaim([D,D])],[alice])
        rec('BO.32','C9: a claim naming the same vault TWICE pays it once, and owed falls once',`${due0/ACC_SCALE},${(due0/ACC_SCALE)*ACC_SCALE}`,
          `${(await tokBal(ata(D.pda)))-b0},${o0-(await pool()).owed}`) }
      // C9 (round 25 N2): the CRANK and the PAIRS name the same DRAWN, active record.
      // The crank skips a drawn record (it writes only level-0 ones); the claim pays it once.
      { const D=(await freeV())!; await step(); const due0=await pendingOf(D.asset), b0=await tokBal(ata(D.pda)), o0=(await pool()).owed
        const e0=Buffer.from((await recOf(D.asset))!.subarray(OFF_REC_ENTROPY,OFF_REC_ENTROPY+32)).toString('hex')
        const x=await att(()=>send([...crankCU({crank:[1]}),ixPoolClaim([D],{crank:[D.asset]})],[alice]))
        const e1=Buffer.from((await recOf(D.asset))!.subarray(OFF_REC_ENTROPY,OFF_REC_ENTROPY+32)).toString('hex')
        rec('BO.36','C9: a claim whose CRANK and PAIR both name one drawn, active vault: the crank leaves it alone, the claim pays it once and owed falls once',
          `ALLOW,${due0/ACC_SCALE},${(due0/ACC_SCALE)*ACC_SCALE},true`,`${x.ok?'ALLOW':'REJECT'},${(await tokBal(ata(D.pda)))-b0},${o0-(await pool()).owed},${e0===e1}`,x.err) }
      await claimAll(LIVE2.filter(v=>v!==Q))
      // C1: each leg of BoostTermsMoved, and a FAVOURABLE move lands.
      { const v1=await propose(actBoost(3_000_000_000n,2,3)); await waitEnds(v1.ends); await exec(v1.id)
        const F1=(await freeV())!, s0=await cbobSupply()
        const wDown=await att(()=>send([ixBoost(F1,alice,{maxPrice:4_000_000_000n,minW:3,minE:3})],[alice]))
        rec('BO.30','C1: a vote LOWERED the weight: a boost signed for the old weight is refused, nothing burned','REJECT,0',
          `${wDown.ok?'ALLOW':'REJECT'},${s0-await cbobSupply()}`,wDown.err)
        const fav=await att(()=>send([ixBoost(F1,alice,{maxPrice:4_000_000_000n,minW:2,minE:3})],[alice]))
        rec('BO.30a','...the same vote LOWERED the price: signed at the old (higher) ceiling, the boost lands and burns the NEW price',
          'ALLOW,3000000000',`${fav.ok?'ALLOW':'REJECT'},${s0-await cbobSupply()}`,fav.err)
        const v2=await propose(actBoost(3_000_000_000n,2,2)); await waitEnds(v2.ends); await exec(v2.id)
        const F2=(await freeV([F1]))!, s1=await cbobSupply()
        const eDown=await att(()=>send([ixBoost(F2,alice,{maxPrice:3_000_000_000n,minW:2,minE:3})],[alice]))
        rec('BO.31','C1: a vote SHORTENED the boost: a boost signed for the old length is refused, nothing burned','REJECT,0',
          `${eDown.ok?'ALLOW':'REJECT'},${s1-await cbobSupply()}`,eDown.err)
        // C4: sold, the vault boosts for its NEW owner only.
        await transfer(umi,{asset:{publicKey:F2.umiAsset,owner:aliceU.publicKey} as any,collection:{publicKey:coll.publicKey} as any,
          newOwner:pk(bob.publicKey.toBase58()),authority:aliceU}).sendAndConfirm(umi,{confirm:{commitment:CM}})
        await mintTo(conn,deployer,cbobMint,cbobAta(bob.publicKey),deployer,3_000_000_000n,[],{commitment:CM})
        const old=await att(()=>send([ixBoost(F2,alice)],[alice]))
        rec('BO.33','C4: after the vault is SOLD, its old owner cannot boost it','REJECT',old.ok?'ALLOW':'REJECT',old.err)
        const nu=await att(()=>send([ixBoost(F2,bob)],[bob]))
        rec('BO.33a','...and its NEW owner can','ALLOW',nu.ok?'ALLOW':'REJECT',nu.err)
        // C9 (round 25 N2): a DUE boost expired INSIDE a claim whose destination is
        // FROZEN. The claim expires it first, then defers the payment: the vault is
        // owed the whole BOOSTED share, logged, and paid exactly once when thawed.
        { const endF2=(await recB(F2)).end
          const expireOthers=async()=>{const e=(await bc()).epoch, due:V[]=[]
            for(const v of VAULTS){ if(v===F2) continue; const r=await recOf(v.asset)
              if(r&&r[OFF_REC_ACTIVE]&&!r[OFF_REC_RETIRED]&&r[OFF_REC_BOOST_W]&&r.readBigUInt64LE(OFF_REC_BOOST_END)<=e) due.push(v)}
            if(due.length) await send([ixExpire(due)],[alice]) }
          for(let g=0;(await bc()).epoch<endF2&&g<6;g++){ await expireOthers(); await exactDist(3n) }
          const rB=await recB(F2), c0=await bc(), owedB=await pendingOf(F2.asset)
          await send([createFreezeAccountInstruction(ata(F2.pda),mint,deployer.publicKey)],[deployer])
          const b0=await tokBal(ata(F2.pda)); let sigZ=''
          const cz=await att(async()=>{ sigZ=await send([ixPoolClaim([F2])],[alice]) })
          const rA=await recB(F2), c1=await bc(), lz=cz.ok?(await logsOf(sigZ)).logs:[]
          rec('BO.37','C9: a claim EXPIRES a due boost on a vault whose cbBTC account is FROZEN: it lands, the boost is gone, nothing is paid, the whole BOOSTED share stays owed and is logged deferred',
            `ALLOW,${BigInt(rB.w)>0n?rB.w:'boosted'},0,${c0.due-1},0,${owedB},true`,
            `${cz.ok?'ALLOW':'REJECT'},${rB.w},${rA.w},${c1.due},${(await tokBal(ata(F2.pda)))-b0},${await pendingOf(F2.asset)},${lz.some(x=>x.includes(`CBOB_CLAIM_DEFERRED_FROZEN asset=${F2.asset.toBase58()} owed_sats=${owedB/ACC_SCALE}`))}`,
            `${cz.err} owed ${owedB/ACC_SCALE} sats at epoch ${c0.epoch} (boost end ${endF2})`)
          await send([createThawAccountInstruction(ata(F2.pda),mint,deployer.publicKey)],[deployer])
          await send([ixPoolClaim([F2])],[alice])
          rec('BO.37a','...thawed, the next claim pays exactly that boosted share, once, and the books balance',`${owedB/ACC_SCALE},${BOOKS}`,
            `${(await tokBal(ata(F2.pda)))-b0},${await books()}`) } }
      // C2: THE RING WRAP, driven through the program itself. Terms of 10
      // distributions; buy when (epoch % 64) >= 55 so the end slot WRAPS.
      { const v3=await propose(actBoost(1_000_000_000n,2,MAX_BOOST_E)); await waitEnds(v3.ends); await exec(v3.id)
        let guard=0
        while(Number((await bc()).epoch % BigInt(BOOST_RING))<BOOST_RING-MAX_BOOST_E+1 && guard++<80) await step(1n)
        const Wv=(await freeV())!, e0=(await bc()).epoch
        await send([ixBoost(Wv,alice,{minE:MAX_BOOST_E})],[alice])
        const end=(await recB(Wv)).end
        rec('BO.34','C2: a boost bought at epoch '+e0+' (ring slot '+(e0%64n)+') ends at a slot that WRAPS past 64',
          'true',String(end%64n<e0%64n),`end ${end}, slot ${end%64n}`)
        // ROUND 25 (N1): a SECOND boost bought in the same epoch (so its end slot wraps
        // too), bare-burned and retired three distributions later, BEFORE it is due:
        // unschedule_boost's not-yet-due branch, on chain, at a WRAPPED ring index.
        const W2=(await freeV([Wv,LIVE2.filter(v=>v!==Q)[0]]))!
        await send([ixBoost(W2,alice,{minE:MAX_BOOST_E})],[alice])
        const end2=(await recB(W2)).end, slot2=Number(end2%BigInt(BOOST_RING))
        const ringAt=async(i:number)=>(await cfg()).readUInt32LE(OFF_BOOST_RING+4*i)
        for(let i=1;i<MAX_BOOST_E;i++){ await step(1n)
          if(i===3){ const c0=await bc(), s0=await ringAt(slot2)
            const rr=await bare(W2)
            const c1=await bc(), s1=await ringAt(slot2)
            rec('BO.38','N1: that second wrapped boost (end '+end2+', ring slot '+slot2+'), bare-burned and retired at epoch '+c0.epoch+', BEFORE it is due: ITS slot falls by exactly one, due is untouched',
              `true,true,ALLOW,${s0-1},${c0.active-1},${c0.due}`,`${end2===end},${c0.epoch<end2},${rr.ok?'ALLOW':'REJECT'},${s1},${c1.active},${c1.due}`,rr.err)
            rec('BO.38a','...and the books balance, the ring included',BOOKS,await books()) } }
        const before=await recB(Wv)
        rec('BO.34a','...after N-1 distributions it is still live and not due','true',String(before.w===2&&(await bc()).epoch===end-1n))
        await expireDue(); await exactDist(1n)
        const c=await bc()
        rec('BO.34b','...the Nth makes it DUE, at exactly its end epoch','true',String(c.epoch===end&&c.due>=1))
        await expireDue()
        rec('BO.34c','...and once expired the books balance, the ring included',BOOKS,await books()) }
      // ── A VOTE SWITCHES THEM OFF AGAIN ──
      const vo=await propose(actBoost(0n,0,0)); await waitEnds(vo.ends)
      const exo=await exec(vo.id)
      const R0=LIVE2.filter(v=>v!==Q)[0]
      const offAgain=await att(()=>send([ixBoost(R0,alice)],[alice]))
      rec('BO.19','a vote sets the price to 0 and boosts are OFF again','ALLOW,0,REJECT',
        `${exo.ok?'ALLOW':'REJECT'},${(await bc()).price},${offAgain.ok?'ALLOW':'REJECT'}`,`${exo.err} ${offAgain.err}`)
    }
  }
  rec('R.9','...and at the end of everything, the royalty is still 10%','1000',
    String(((await fetchCollection(umi,coll.publicKey)) as any).royalties?.basisPoints))
  // ═══ RL.7 THE CAP, REPLAYED FROM THE CHAIN'S OWN RECORD (red-team 2 #4) ═══
  // Every redemption time BURN remembers, checked against the claim "no rolling
  // window ever held more than the cap". ROUND 25 (round-24 C7): each against ITS
  // OWN cap. The ring slot of a redemption is its ordinal (head == burned_total
  // mod 64). `sendNow` certifies that all supply interleavings allowed by its
  // coherent snapshots give the same cap; ambiguity fails the run.
  {
    const k=await bucket(), total=Number((await conn.getAccountInfo(BURN_CFG,CM))!.data.readBigUInt64LE(OFF_BURNED_TOTAL))
    const first=Math.max(0,total-RATE_RING), viol:string[]=[]; let unstamped=0, worst=0, capsSeen=new Set<string>()
    for(let j=first;j<total;j++){
      const t=k.ring[j%RATE_RING], cap=CAP_STAMPS.get(j)
      if(cap===undefined){ unstamped++; continue }
      capsSeen.add(String(cap))
      let inWin=0; for(let i=first;i<=j;i++) if(k.ring[i%RATE_RING]>t-k.win) inWin++
      if(inWin>worst) worst=inWin
      if(BigInt(inWin)>cap) viol.push(`#${j}: ${inWin} in the window ending at it, cap ${cap}`) }
    rec('RL.7','replaying every redemption BURN remembers, EACH against the exact cap certified across its snapshot interval: no window ending at a redemption held more than that redemption\'s cap',
      'true,0,0',`${total>=10&&total<=RATE_RING},${unstamped},${viol.length}`,
      `${total} redemptions, all in the ring; fullest window ${worst}; caps in force ${[...capsSeen].join('/')}${viol.length?'; '+viol.join('; '):''}`)
  }
  // ═══ 3c.K5 THE ARMED OPERATOR LANDS, after its notice (G3 armed it) ═══
  {
    await waitNotice(OFF_PENDING_OP_AT)
    const ap=await att(()=>send([ixApply('swap_operator')],[alice]))
    rec('3c.K5','ANYONE lands the armed swap operator once its notice has run','ALLOW|'+newOp2.publicKey.toBase58(),
      `${ap.ok?'ALLOW':'REJECT'}|${new W((await cfg()).subarray(OFF_SWAP_OPERATOR,OFF_SWAP_OPERATOR+32)).toBase58()}`,ap.err)
    const oldOp=await att(()=>send([sweepTo(1_000n,swapOp.publicKey)],[alice,swapOp]))
    rec('3c.K5a','...and the operator it replaced can no longer sweep','REJECT',oldOp.ok?'ALLOW':'REJECT',oldOp.err)
  }
  // ═══ ROUND 24 (C3): ONE OF EACH OF THE FIVE KINDS, EXECUTED ═══
  // BO.28 only CREATED such a proposal. Here it is voted (the operator arm makes
  // it a key change: half of all live vaults) and executed, last, where arming a
  // new operator disturbs nothing after it.
  {
    const c0=await cfg(), live=c0.readBigUInt64LE(OFF_MAX_SWEEP), newer=Keypair.generate()
    const five=await propose([actRound(PRICE,10),actBrakes({sales:true}),actTighten({maxSweep:live-1n}),actArm(newer.publicKey),actBoost(5n,1,1)])
    await waitEnds(five.ends)
    let sig=''; const x=await att(async()=>{ sig=await send([ixExec(propId(five.id))],[deployer]) })
    const c=await cfg(), cu=x.ok?(await cuOf(sig)):0
    rec('E.7','a proposal carrying one action of EACH of the five kinds is voted and EXECUTED: all five land in one transaction',
      `ALLOW,${live-1n},${newer.publicKey.toBase58()},5`,
      `${x.ok?'ALLOW':'REJECT'},${c.readBigUInt64LE(OFF_MAX_SWEEP)},${new W(c.subarray(OFF_PENDING_OP,OFF_PENDING_OP+32)).toBase58()},${c.readBigUInt64LE(OFF_BOOST_PRICE)}`,
      `${x.err} | ${cu} CU`)
    rec('E.7a','...under the 400,000 CU regression ceiling','true',String(cu>0&&cu<400_000),`${cu} CU`)
  }

  // ═══ THE NEGATIVES, REJECTED FOR THE RIGHT REASON ═══
  // ── X. THE OFF-CHAIN READERS, AGAINST THE REAL PROGRAMS (v6 stage 4) ──────
  // bank/selftest.mjs proves layout.mjs's field lists equal the Rust SOURCE. This
  // proves the same readers against the BYTES these programs actually wrote, and
  // that the crank reads a vault's minted attributes off real Core exactly as the
  // program hashed them — the one thing the crank must get right to reveal.
  {
    const LY:any=await import('../bank/layout.mjs')
    const CR:any=await import('../bank/crank.mjs')
    const ci=(await conn.getAccountInfo(MINT_CFG,CM))!
    const mc=LY.decode('MintConfig',ci.data)
    rec('X.1','layout.mjs decodes the live MINT config: minted_total equals the pinned raw offset','true',
      String(mc.minted_total===ci.data.readBigUInt64LE(OFF_MINTED_TOTAL)&&mc.revealed_total===ci.data.readBigUInt64LE(OFF_REVEALED)))
    rec('X.2','...and governance is the GOV PDA, the guardian and operator match their offsets','true',
      String(mc.governance===GOV_PDA.toBase58()&&mc.guardian===new W(ci.data.subarray(OFF_GUARDIAN,OFF_GUARDIAN+32)).toBase58()
        &&mc.swap_operator===new W(ci.data.subarray(OFF_SWAP_OPERATOR,OFF_SWAP_OPERATOR+32)).toBase58()))
    let decodedAll=false, n=0
    const recs=await conn.getProgramAccounts(MINT_PROG,{commitment:CM,filters:[{memcmp:{offset:0,bytes:(await import('bs58')).default.encode(acctDisc('VaultRecord'))}}]})
    const decoded:any[]=[]
    try{ for(const {pubkey,account} of recs){decoded.push({address:pubkey.toBase58(),...LY.decode('VaultRecord',account.data)}); n++}; decodedAll=n>0 }catch{ decodedAll=false }
    rec('X.3',`every VaultRecord on chain decodes under the pinned layout (${recs.length})`,'true',String(decodedAll&&n===recs.length))
    let hashOk='none', perturbed='none'
    for(const r of decoded){
      if(!(r.level>0)) continue
      const a=await conn.getAccountInfo(new W(r.asset),CM)
      if(!a||a.data.length<2||a.data[0]!==1) continue
      const minted=(await CR.mintedAttributes(conn,new W(r.asset))).filter((x:any)=>x.key!=='level')
      hashOk=String(CR.attrsHash(minted)===r.attrs_hash)
      perturbed=String(CR.attrsHash([...minted,{key:'x',value:'y'}])===r.attrs_hash)
      break
    }
    rec('X.4','the crank reads a revealed vault\'s minted attributes off Core and they hash to what the program stored','true',hashOk)
    rec('X.5','...and one extra attribute does NOT hash to it (the check can fail)','false',perturbed)
    let others='false'
    try{ const b=LY.decode('BurnConfig',(await conn.getAccountInfo(BURN_CFG,CM))!.data)
      const g=LY.decode('GovConfig',(await conn.getAccountInfo(GOV_CFG,CM))!.data)
      const sc=LY.decode('SealConfig',(await conn.getAccountInfo(SEAL_CFG,CM))!.data)
      others=String(b.collection===mc.collection&&g.collection===mc.collection&&sc.collection===mc.collection&&sc.reserve_mints.length>=1) }catch(e:any){ others='threw: '+e.message }
    rec('X.6','BURN, GOV and SEAL configs decode under the pinned layouts and name one collection','true',others)
    // THE PLANNER AGAINST REAL STATE: whatever it plans to reveal starts at the
    // program's own `revealed_total` and runs in mint order.
    const plan=CR.planCrank({cfg:mc,records:decoded,assets:{},tokens:{},pool:null,slot:await conn.getSlot(CM),nowSec:Math.floor(Date.now()/1000)})
    const ord=plan.reveal.map((a:string)=>decoded.find((r:any)=>r.address===a).mint_index)
    // Round 22 (F20): the census is exhausted by now, so the plan is EMPTY and an
    // ordering check over it cannot fail. Say what this actually shows; the
    // ordering itself is proven both ways in bank/selftest.mjs.
    rec('X.7','with every level drawn, the crank plans NO reveal on the live chain (the queue it reads is empty)','0,true',
      `${ord.length},${mc.revealed_total===mc.minted_total}`)
  }

  const because=(id:string,code:string)=>{const r=R.find(x=>x.id===id)
    const hit=(r?.n||'').includes(code); R.push({id:id+'!',t:`  ↳ rejected because ${code}`,want:'true',got:String(hit),ok:hit,n:r?.n})
    console.log(`  ${hit?'ok  ':'XX  '}${id}!  rejected because ${code}  [got ${hit}]${hit?'':`\n        ACTUAL: ${(r?.n||'(no error recorded)').slice(0,300)}`}`)}
  console.log('\n─── the negatives, rejected for the RIGHT reason ───')
  because('R28.F1',`Program ${TOKEN_PROGRAM_ID.toBase58()} failed: custom program error: 0x11`)
  because('0.1','NotTheInitAuthority'); because('0.1e','BadCharterWindow'); because('0.1f','BadPobRoot')
  because('0.1g','CollectionNotClean'); because('0.1h','CollectionNotOurs'); because('0.1i',`Program 11111111111111111111111111111111 failed: custom program error: 0x0 | Program ${MINT_PROG.toBase58()} failed`)
  because('0.2','NotTheInitAuthority'); because('0.3','NotTheInitAuthority'); because('7.0','NotTheInitAuthority')
  because('7.12e','BadThreshold'); because('6.13','ReserveMintNotClassicSpl')
  for(const id of ['0.4','0.4a','0.4b','0.4c','0.4d','0.4e','0.4f','0.4g','0.4h','0.4i']) because(id,'InstructionFallbackNotFound')
  because('C.1','CharterNotOpen'); because('1.1','ConstraintHasOne'); because('C.1a','NoRound')
  because('C.7','NotAProofOfBurn'); because('C.8','NotInPobSet'); because('C.9','NotThePobOwner')
  because('C.10','NotAProofOfBurn'); because('C.11','ReservedAttribute'); because('C.12','NotInPobSet')
  because('C.15','CharterClosed')
  because('OR.2','CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d failed'); because('OR.3','BadPobExtra')
  because('6c.1','NotTheGuardian'); because('6c.5','SalesStopped'); because('6c.7','SweepStopped')
  because('6c.8','ConstraintHasOne'); because('6c.10','ConstraintHasOne'); because('6c.10b','ConstraintHasOne')
  because('6c.18','NotTheGuardian'); because('6c.21','NotTheGuardian'); because('8.12','SalesStopped'); because('8.13b','ConstraintHasOne')
  because('2.5','custom program error: 0x1a'); because('R.8','custom program error: 0x1a')
  // Core's own refusals of the immutable royalty: 0x9 is InvalidAuthority (read
  // from the SDK's generated error map). R.6a must also be Core, not our client.
  because('R.6','CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d failed'); because('R.6','0x9')
  because('R.6a','CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d failed')
  because('L.1','RevealTooEarly'); because('L.2','RevealOutOfOrder'); because('L.3b','AlreadyCaptured')
  because('L.4','AttributesMismatch'); because('L.9','AlreadyRevealed'); because('L.15','RevealWindowExpired')
  because('L.14','TooManyAttributes'); because('L.12a','AttributesTooLarge'); because('L.20','LevelCapReached')
  because('7.4','NotTheOwner'); because('7.5','NotTheOwner'); because('7.11','VotingOpen')
  because('7.7',`Program 11111111111111111111111111111111 failed: custom program error: 0x0 | Program ${GOV_PROG.toBase58()} failed`); because('7.9',`Program 11111111111111111111111111111111 failed: custom program error: 0x0 | Program ${GOV_PROG.toBase58()} failed`); because('G.3','BadVaultRecord')
  because('G.1','PriceBelowFloor'); because('6.1','BadWindow'); because('6.2','BadWindow'); because('6.31','BadWindow')
  because('7.27','EmptyAction'); because('7.27a','EmptyAction'); because('7.18','AccountNotSigner')
  because('7.13','QuorumNotMet'); because('7.17','AlreadyExecuted')
  because('6.18a','Loosening'); because('6.20i','Loosening'); because('6.34','Loosening')
  because('6.23d','EmptyAction'); because('6.23e','TightenOutOfBounds')
  because('G.6','VaultTooNew')
  // v6 STAGE 3b: governance reaches only what may change; redemptions are rate-limited.
  because('RT1.1','CharterNotClosed'); because('E.4','EmptyAction')
  because('E.5','TooManyActions'); because('E.6','DuplicateAction'); because('E.6b','DuplicateAction')
  because('BO.1a','BoostTermsOutOfBounds'); because('BO.1b','BoostTermsOutOfBounds'); because('BO.1c','BoostTermsOutOfBounds')
  because('BO.1d','BoostTermsOutOfBounds'); because('BO.2','BoostsOff'); because('BO.4','BoostNeedsActiveVault')
  because('BO.5','WrongCbobMint'); because('BO.6','BoostNotTheOwner'); because('BO.6b','InsufficientCbob'); because('BO.8','BoostActive')
  because('BO.12','BoostsExpireFirst'); because('BO.19','BoostsOff'); because('BO.20','BoostNeedsActiveVault')
  because('BO.26','BoostTermsMoved'); because('BO.27','ConstraintHasOne')
  because('WR.1','NotFromBurn'); because('WR.2','NoTerminalBurn'); because('WR.3','NoPrecedingOpen')
  because('BO.30','BoostTermsMoved'); because('BO.31','BoostTermsMoved'); because('BO.33','BoostNotTheOwner')
  because('SR.1','missing required signature'); because('SR.2','CBOB_SWEEP refused: destination'); because('SR.3','Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0xb') // NonNativeHasBalance: the old sweep cannot even close the account the dust landed in
  for(const id of ['0.1o','0.1p','0.1q','0.1r','0.1s','0.1t','0.1u','0.1v']) because(id,'BadBoostSetup'); because('W.1','InstructionDidNotDeserialize')
  because('6.20g','OperatorNoticeNotElapsed'); because('D.1','TurnoutTooLow')
  because('RL.0','BadRedeemWindow'); because('RL.3','RateLimited'); because('4.9','RateLimited'); because('4.10a','RateLimited')
  because('6.12','PriceAboveMax'); because('G.4','WrongPaymentMint'); because('G.5','WrongTreasury')
  because('11.3','ReservedAttribute'); because('11.4','DuplicateAttribute')
  because('6.10','ConstraintHasOne'); because('6.21','ConstraintHasOne'); because('5.2','AccountNotSigner')
  because('6.15','SweepAboveCap'); because('6.23f','WrongTreasury'); because('6.17','SweepTooSoon'); because('6.17a','AccountNotSigner')
  because('6.17b','SweepAboveCap'); because('6.19b','SweepTooSoon')
  because('8.6','NothingToSplit'); because('8.7','ReserveWouldBreach')
  because('8.2a','WrongTreasury'); because('8.2b','WrongTreasury'); because('8.2c','WrongTreasury'); because('8.10','WrongTreasury')
  because('3.1','NotTheOwner'); because('3.6','NoTerminalBurn'); because('3.7','custom program error: 0x9')
  because('3.8','NoPrecedingOpen'); because('3.9','NoTerminalBurn'); because('3.10','NoTerminalBurn'); because('4.10','NoTerminalBurn')
  because('3.11','VaultNotEmpty'); because('3.3','ReserveDelegated'); because('4.1','VaultNotEmpty')
  because('5.1','DeclarationMismatch'); because('5.3','BadSealConfig'); because('9.0','NoPrecedingOpen'); because('9.3','NotTheOwner')
  because('9.4','VaultStillHoldsAVault'); because('9.8','VaultNotEmpty'); because('9.10','VaultNotEmpty')
  // 11.13/11.14: Core 0x1a is NoApprovals — the instruction was well formed and
  // was turned away at the authority check, not for being malformed.
  because('11.13','0x1a'); because('11.14','0x1a')
  // 9.13: the record PDA for that address already exists (system 0x0), so the
  // re-mint dies before Core is asked; Core's own refusal was measured in v5 and
  // is now behind a second wall.
  because('9.13',`Program 11111111111111111111111111111111 failed: custom program error: 0x0 | Program ${MINT_PROG.toBase58()} failed`)
  // v6 STAGE 3: the pool, the crank, and the reschedule.
  because('L.16','NeedsReschedule'); because('L.16a','RevealOutOfOrder'); because('L.16b','RescheduleTooEarly')
  because('K.4','TooManyCranked'); because('P.0a','BadMonthlyPeriod'); because('P.0d','WrongPaymentMint')
  because('P.1','NotRevealed'); because('P.3','BelowActivation'); because('P.5','ActivationPending'); because('P.6','VaultRetired')
  because('P.7','WrongVaultAccount'); because('PG.2','InsufficientGary'); because('PG.3','WrongGaryMint')
  because('PG.4','WrongGaryMint'); because('PG.5','MonthNotElapsed'); because('PG.6','MonthNotElapsed'); because('PG.7','NothingToDistribute')
  because('PG.9','MonthNotElapsed')
  because('P.19','WrongVaultAccount'); because('P.19a','BadClaimList'); because('P.19b','WrongPool'); because('P.19c','WrongPool')
  because('P.20','ClaimBeforeBurn'); because('P.21','VaultAccountMissing'); because('P.23','NotFromBurn')
  because('P.24','NotBurned'); because('P.26','WrongAsset'); because('P.28','AlreadyRetired')
  because('F18.1','ThresholdNotMet')
  // v6 STAGE 3c: red-team 2.
  because('0.1j','WrongTreasury'); because('0.1k','PaymentMintNotAReserve'); because('0.1l','BadSweepBound')
  because('0.1m','BadSweepBound'); because('0.1n','BadNotice'); because('0.3b','WiringDiverged'); because('7.0a','ForeignVault')
  because('3c.B1','TightenOutOfBounds'); because('3c.B2','TightenOutOfBounds'); because('3c.B3','TightenOutOfBounds')
  because('3c.K0','NoPendingOperator'); because('3c.K1','KeyChangesBundled'); because('3c.K2','KeyChangeNeedsHalf')
  because('3c.K3','NotTheGuardian'); because('3c.K4a','NoPendingOperator'); because('3c.K5a','WrongTreasury')
  because('3c.G1','GuardianNoticeNotElapsed'); because('3c.A3','NoActiveVaults'); because('3c.A4b','JoinWaitingFirst')
  because('3c.A6c','JoinWaitingFirst'); because('3c.F1','0x11')
  because('3c.A7','AlreadyActive'); because('6c.9','ConstraintHasOne')
  // ROUND 25: the helper's refusals, Core's Execute rule on a thawed vault, and the
  // round-24 ship-gate-5 pins. Every text below was MEASURED on this Core binary
  // and this helper (a scratch probe, 2026-10-05) before it was written here.
  { const SW='EB2uVvsaThLp4PWt3LwAWveTCa9ZynPVbWzZfUhMf2aa', CO=CORE.toBase58()
    because('R24.1',`Program ${CO} failed: custom program error: 0x1a`)
    because('R24.1a',`Program ${CO} failed: missing required signature for instruction`); because('R24.1c',`Program ${CO} failed: missing required signature for instruction`)
    because('R24.5','NotRevealed')
    because('SR.5',`Program ${CO} failed: custom program error: 0x1a`); because('SR.5a',`Program ${CO} failed: custom program error: 0x1a`)
    because('SR.5c',`Program ${CO} failed: custom program error: 0x1a`)
    because('SR.6',`Program ${SW} failed: invalid instruction data`); because('SR.7',`Program ${SW} failed: insufficient account keys for instruction`)
    because('SR.8',`Program ${SW} failed: incorrect program id for instruction`); because('SR.9',`Program ${SW} failed: incorrect program id for instruction`)
    because('SR.10',`Program ${SW} failed: invalid program argument`)
    because('SR.11',`CBOB_SWEEP refused: source ${ata(alice.publicKey).toBase58()} is not the vault's`); because('SR.11',`Program ${SW} failed: Provided owner is not allowed`)
    because('SR.12',`CBOB_SWEEP refused: destination ${ata(alice.publicKey,otherMint).toBase58()} is not the wallet's account for that mint`)
    because('SR.12',`Program ${SW} failed: invalid account data for instruction`)
    because('SR.12a',`Program ${SW} failed: Provided owner is not allowed`)
    rec('SR.12b','duplicate-source refusal reached the second, closed source, not the first source-owner guard','false',String(R.find(x=>x.id==='SR.12a')?.n?.includes('CBOB_SWEEP refused: source')))
    because('SR.14','Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0x11'); because('SR.14',`Program ${SW} failed: custom program error: 0x11`) }
  // ROUND 23: a REUSED id made a reason pin read ANOTHER arm's error (two arms
  // were named W.1). \`because\` finds the first arm with its id, so every id
  // must be unique or a pin can pass or fail for the wrong arm, silently.
  { const seen=new Map<string,number>(); for(const r of R) if(!r.id.endsWith('!')) seen.set(r.id,(seen.get(r.id)??0)+1)
    rec('ID.1','every assertion id in this suite is unique (a reason pin can only ever read its own arm)','[]',
      JSON.stringify([...seen].filter(([,n])=>n>1).map(([k])=>k))) }

  const bad=R.filter(r=>!r.ok)
  console.log(`\n${'═'.repeat(78)}`)
  for(const r of R) console.log(`| ${r.id.padEnd(5)} | ${r.t.slice(0,54).padEnd(54)} | ${r.ok?'ok      ':'MISMATCH'} |`)
  console.log(`${'═'.repeat(78)}\n${R.length-bad.length}/${R.length} as predicted (4 PROGRAMS + the sweep helper, real Core, REAL TOKENS)`)
  process.exit(bad.length?1:0)
}
main().catch(e=>{console.error('FATAL',e?.message||e,'\n',(e?.logs||[]).join('\n'));process.exit(2)})
