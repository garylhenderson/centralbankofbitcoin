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
 */
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { Connection, Keypair, PublicKey as W, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL, SYSVAR_INSTRUCTIONS_PUBKEY, AddressLookupTableProgram,
  TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createMint, getAssociatedTokenAddressSync, mintTo,
  createTransferInstruction, createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction, createApproveInstruction, createFreezeAccountInstruction,
  createThawAccountInstruction } from '@solana/spl-token'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { keypairIdentity, createNoopSigner, createSignerFromKeypair, generateSigner,
  publicKey as pk } from '@metaplex-foundation/umi'
import { toWeb3JsPublicKey, fromWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters'
import { mplCore, createCollection, execute, fetchAsset, fetchCollection, findAssetSignerPda, create, transfer, burn,
  updateCollectionPlugin, removeCollectionPlugin, addPlugin, ruleSet, PluginType,
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
const LEVEL_CAPS=[26,12,6,4,2]
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
const OFF_ACC=478, OFF_OWED=494, OFF_LAST_DIST=510, OFF_EMISSION_MIN=518
// VaultRecord (version 2): disc[0..8] version[8] asset[9..41] mint_index[41..49]
// reveal_slot[49..57] level[57] charter[58] entropy_set[59] entropy[60..92]
// attrs_hash[92..124] bump[124] active[125] retired[126] reschedules[127..129]
// vault_ata[129..161] debt_scaled[161..177]
const OFF_REC_INDEX=41, OFF_REC_REVEAL=49, OFF_REC_LEVEL=57, OFF_REC_CHARTER=58, OFF_REC_SET=59, OFF_REC_ENTROPY=60
const OFF_REC_ACTIVE=125, OFF_REC_RETIRED=126, OFF_REC_RESCHED=127, OFF_REC_ATA=129, OFF_REC_DEBT=161
const u128le=(b:Buffer,o:number)=>b.readBigUInt64LE(o)+(b.readBigUInt64LE(o+8)<<64n)
const ACC_SCALE=1_000_000_000_000n
const WEIGHTS=[2n,3n,4n,5n,6n]
const ACTIVATION=21_000n
/** PROVISIONAL: Gary sets the real number before launch. Fixed at initialize. */
const EMISSION_MIN=21n
const OFF_BURNED_TOTAL=42
const REVEAL_LEAD=16, REVEAL_WINDOW=300
// WiringArgs, one encoder for every UpdateWiring proposal.
// v6 stage 3: NO `treasury` field. The 85% goes to the pool and nothing can vote it elsewhere.
const wiringArgs=(o:any={})=>Buffer.concat([
  o.bankTreasury?SOME(o.bankTreasury.toBuffer()):NONE,
  o.splitBps!==undefined?SOME(u16(o.splitBps)):NONE,
  o.swapOperator?SOME(o.swapOperator.toBuffer()):NONE,
  o.solReserve!==undefined?SOME(u64(o.solReserve)):NONE,
  o.maxSweep!==undefined?SOME(u64(o.maxSweep)):NONE,
  o.sweepCooldown!==undefined?SOME(i64(o.sweepCooldown)):NONE,
  o.maxSupply!==undefined?SOME(u64(o.maxSupply)):NONE])
const wiring=(o:any={})=>Buffer.concat([d('update_wiring'),wiringArgs(o)])
const attrs=(list:[string,string][])=>Buffer.concat([u32(list.length),
  ...list.flatMap(([k,v])=>[str(k),str(v)])])
const SATS=100_000_000n
/** The voted round price, in sats of the stand-in cbBTC. Above the 21,000 floor. */
const PRICE=50_000n
const SWEEP_CAP=BigInt(50*LAMPORTS_PER_SOL)
const SWEEP_COOLDOWN=1
const VOTE_SECS=60

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
  const send=(ixs:TransactionInstruction[],s:Keypair[])=>sendAndConfirmTransaction(conn,new Transaction().add(...ixs),s,{commitment:CM})
  // A REJECT FOR THE WRONG REASON IS A FALSE PASS, so the reason has to survive intact.
  const att=async(f:()=>Promise<unknown>)=>{try{await f();return{ok:true,err:''}}catch(e:any){
    const l=(e?.logs||e?.transactionLogs||[]).filter((x:string)=>/Error Code|custom program error|panicked/.test(x))
    return{ok:false,err:(l.join(' | ')||String(e?.message||e)).replace(/\s+/g,' ').slice(0,260)}}}
  const cfg=async()=>(await conn.getAccountInfo(MINT_CFG,CM))!.data
  const stops=async()=>{const c=await cfg(); return `${c[OFF_SALES_STOPPED]},${c[OFF_SWEEP_STOPPED]}`}
  const guardianNow=async()=>new W((await cfg()).subarray(OFF_GUARDIAN,OFF_GUARDIAN+32)).toBase58()
  const attrMap=(x:any)=>Object.fromEntries((x?.attributes?.attributeList||[]).map((e:any)=>[e.key,e.value]))

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
  await send([...[deployer,alice,bob,carol].map(k=>createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,ata(k.publicKey),k.publicKey,mint)),
    createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,revAta,REVENUE,mint)],[deployer])
  await mintTo(conn,deployer,mint,ata(deployer.publicKey),deployer,20_000_000_000n,[],{commitment:CM})
  await mintTo(conn,deployer,mint,ata(alice.publicKey),deployer,5_000_000_000n,[],{commitment:CM})
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
  const CHARTER_OPEN_IN=25, CHARTER_SECS=100
  const t0=Math.floor(Date.now()/1000)
  const CHARTER_OPENS=t0+CHARTER_OPEN_IN, CHARTER_CLOSES=CHARTER_OPENS+CHARTER_SECS
  const ixMintInit=(signer:Keypair,o:any={})=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('initialize'),bankTreasury.publicKey.toBuffer(),
      swapOp.publicKey.toBuffer(),SOME(guardian.publicKey.toBuffer()),
      u64(BigInt(0.05*LAMPORTS_PER_SOL)),u64(MAX_SUPPLY),u64(SWEEP_CAP),i64(SWEEP_COOLDOWN),caps5(LEVEL_CAPS),
      mint.toBuffer(),MOMENTS.toBuffer(),o.root??POB_ROOT,i64(o.opens??CHARTER_OPENS),i64(o.closes??CHARTER_CLOSES),
      u64(o.emissionMin??EMISSION_MIN)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:true},
      {pubkey:o.coll??COLL,isSigner:false,isWritable:true},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
      {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const mi0=await att(()=>send([ixMintInit(stranger)],[stranger]))
  rec('0.1','MINT: a stranger initializes the config','REJECT',mi0.ok?'ALLOW':'REJECT',mi0.err)
  const miOver=await att(()=>send([ixMintInit(deployer,{opens:t0-600,closes:t0-300})],[deployer]))
  rec('0.1e','MINT: a charter window already over at init','REJECT',miOver.ok?'ALLOW':'REJECT',miOver.err)
  const miRoot=await att(()=>send([ixMintInit(deployer,{root:Buffer.alloc(32)})],[deployer]))
  rec('0.1f','MINT: an all-zero Proof of Burn root','REJECT',miRoot.ok?'ALLOW':'REJECT',miRoot.err)
  const miEm=await att(()=>send([ixMintInit(deployer,{emissionMin:0n})],[deployer]))
  rec('P.0a','MINT: an emission minimum of zero','REJECT',miEm.ok?'ALLOW':'REJECT',miEm.err)
  // THE COLLECTION MUST ARRIVE CLEAN. A collection-level PermanentBurnDelegate held
  // by a wallet would let that wallet burn every vault ever minted into it.
  const miDirty=await att(()=>send([ixMintInit(deployer,{coll:toWeb3JsPublicKey(dirty.publicKey)})],[deployer]))
  rec('0.1g','MINT: a collection that already carries a plugin (a wallet-held permanent burn delegate)','REJECT',miDirty.ok?'ALLOW':'REJECT',miDirty.err)
  const miForeign=await att(()=>send([ixMintInit(deployer,{coll:toWeb3JsPublicKey(foreign.publicKey)})],[deployer]))
  rec('0.1h','MINT: a collection whose update authority is not MINT\'s PDA','REJECT',miForeign.ok?'ALLOW':'REJECT',miForeign.err)
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
    rec('P.0c','MINT: the (provisional) emission minimum is on chain',String(EMISSION_MIN),String(c.readBigUInt64LE(OFF_EMISSION_MIN)))
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
  const seal1=await att(()=>send([ixSealInit(deployer,[mint])],[deployer]))
  rec('0.2a','SEAL: INIT_AUTHORITY initializes it','ALLOW',seal1.ok?'ALLOW':'REJECT',seal1.err)
  const ixBurnInit=(signer:Keypair)=>new TransactionInstruction({programId:BURN_PROG,
    data:Buffer.concat([d('initialize'),COLL.toBuffer()]),
    keys:[{pubkey:BURN_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const b0=await att(()=>send([ixBurnInit(stranger)],[stranger]))
  rec('0.3','BURN: a stranger initializes the config','REJECT',b0.ok?'ALLOW':'REJECT',b0.err)
  const burn1=await att(()=>send([ixBurnInit(deployer)],[deployer]))
  rec('0.3a','BURN: INIT_AUTHORITY initializes it','ALLOW',burn1.ok?'ALLOW':'REJECT',burn1.err)
  // GOV, BEFORE ANY VAULT: the charter vaults are its first voters.
  const ixGovInit=(signer:Keypair,quorum:number)=>new TransactionInstruction({programId:GOV_PROG,
    data:Buffer.concat([d('initialize'),COLL.toBuffer(),u16(quorum),u16(6000),i64(VOTE_SECS)]),
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const gi0=await att(()=>send([ixGovInit(stranger,3000)],[stranger]))
  rec('7.0','GOV: a stranger initializes the config','REJECT',gi0.ok?'ALLOW':'REJECT',gi0.err)
  const qFloor=await att(()=>send([ixGovInit(deployer,1)],[deployer]))
  rec('7.12e','GOV: initialize with quorum at 1 basis point (arithmetic, not policy)','REJECT',qFloor.ok?'ALLOW':'REJECT',qFloor.err)
  const gi=await att(()=>send([ixGovInit(deployer,3000)],[deployer]))
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
      ...crankKeys(o.crank)]})
  /** A paid mint: alice pays the round price in cbBTC and owns the vault. */
  const mkVault=async(tokens=SATS,prov:[string,string][]=[])=>{
    const kp=Keypair.generate()
    await send([ixMint(kp.publicKey,alice.publicKey,alice.publicKey,{attrs:prov})],[alice,kp])
    const v=mkV(kp,alice,prov); await fund(v,tokens); return v}
  const ixClaim=(asset:W,owner:W,payer:W,pob:W,proof:Buffer[],o:any={})=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('claim_charter_vault'),str('CBOBTC Charter Vault'),str('https://cdn.gary.club/cbob/v.json'),
      attrs(o.attrs??[]),proofBuf(proof)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:vrec(asset),isSigner:false,isWritable:true},
      {pubkey:asset,isSigner:true,isWritable:true},{pubkey:COLL,isSigner:false,isWritable:true},
      {pubkey:owner,isSigner:true,isWritable:false},{pubkey:payer,isSigner:true,isWritable:true},
      {pubkey:pob,isSigner:false,isWritable:true},{pubkey:o.pobColl??MOMENTS,isSigner:false,isWritable:true},
      {pubkey:SEAL_CFG,isSigner:false,isWritable:false},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
      {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
      ...crankKeys(o.crank)]})
  const claim=async(owner:Keypair,i:number,o:any={})=>{const kp=Keypair.generate()
    await send([ixClaim(kp.publicKey,owner.publicKey,owner.publicKey,o.pob??POB[i],o.proof??pobProofFor(i),o)],[owner,kp])
    return mkV(kp,owner,[...(o.attrs??[]),['charter',(o.pob??POB[i]).toBase58()]],true)}
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
    {pubkey:vrec(v.asset),isSigner:false,isWritable:true},
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
  const POOL=getAssociatedTokenAddressSync(mint,MINT_CFG,true)
  const ixActivate=(v:{asset:W,pda:W},o:any={})=>new TransactionInstruction({programId:MINT_PROG,data:d('activate'),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:vrec(v.asset),isSigner:false,isWritable:true},
      {pubkey:o.asset??v.asset,isSigner:false,isWritable:false},{pubkey:o.token??ata(v.pda),isSigner:false,isWritable:false},
      ...crankKeys(o.crank)]})
  const ixDistribute=(pool:W=POOL)=>new TransactionInstruction({programId:MINT_PROG,data:d('distribute'),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:pool,isSigner:false,isWritable:false}]})
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
    const p=await pool(); return (WEIGHTS[r[OFF_REC_LEVEL]-1]*p.acc-u128le(r,OFF_REC_DEBT))}
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
  const gs0=await att(()=>send([ixStop('sales',alice)],[alice]))
  rec('6c.1','a STRANGER pulls the sales brake','REJECT',gs0.ok?'ALLOW':'REJECT',gs0.err)
  const gs1=await att(()=>send([ixStop('sales',guardian)],[guardian]))
  rec('6c.3','the GUARDIAN stops sales, immediately, alone','ALLOW',gs1.ok?'ALLOW':'REJECT',gs1.err)
  rec('6c.4','...and the sales flag is set, the sweep flag is not','1,0',await stops())
  const gm=await att(()=>mkVault(0n))
  rec('6c.5','a paid mint while sales are stopped','REJECT',gm.ok?'ALLOW':'REJECT',gm.err)
  // THE RULING: the brake cannot cost a charter member their claim.
  const C2=await claim(alice,1)
  rec('C.13','a CHARTER claim while the guardian has stopped sales','true',String(!!C2))
  const gs2=await att(()=>send([ixStop('sweep',guardian)],[guardian]))
  rec('6c.6','the GUARDIAN stops the SOL sweep (the stolen-operator-key answer)','ALLOW',gs2.ok?'ALLOW':'REJECT',gs2.err)
  const gr0=await att(()=>send([ixGovSigned(Buffer.concat([d('restart'),Buffer.from([1,1])]),guardian)],[guardian]))
  rec('6c.8','the GUARDIAN tries to restart (it cannot turn anything back on)','REJECT',gr0.ok?'ALLOW':'REJECT',gr0.err)
  const gg0=await att(()=>send([ixGovSigned(Buffer.concat([d('set_guardian'),SOME(alice.publicKey.toBuffer())]),guardian)],[guardian]))
  rec('6c.9','the GUARDIAN tries to hand the brake to someone else','REJECT',gg0.ok?'ALLOW':'REJECT',gg0.err)
  const gw0=await att(()=>send([ixGovSigned(wiring({sweepCooldown:7200}),guardian)],[guardian]))
  rec('6c.10','the GUARDIAN tries to change the wiring','REJECT',gw0.ok?'ALLOW':'REJECT',gw0.err)
  rec('6c.10a','...and after all of that both stops are still set','1,1',await stops())
  const C3=await claim(alice,2), C4=await claim(alice,3), C5=await claim(bob,4)
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

  // ═══ L. THE DRAW: after the mint, from a slot hash, in mint order ═══
  console.log('\n─── L. levels: drawn by the program from a slot hash that did not exist at signing ───')
  const capEarly=await att(()=>send([ixCapture(C6.asset)],[deployer]))
  rec('L.1','capture a vault\'s entropy before its reveal slot exists','REJECT',capEarly.ok?'ALLOW':'REJECT',capEarly.err)
  const outOfOrder=await att(()=>send([ixReveal(C2.asset,C2.attrs)],[deployer]))
  rec('L.2','reveal vault #1 before vault #0 (FIFO: order is a choice, so nobody gets it)','REJECT',outOfOrder.ok?'ALLOW':'REJECT',outOfOrder.err)
  await waitEntropy(C6.asset)
  const cap3=await att(()=>send([ixCapture(C3.asset)],[deployer]))
  rec('L.3','capture is permissionless and ANY order (vault #2 before #0)','ALLOW',cap3.ok?'ALLOW':'REJECT',cap3.err)
  rec('L.3a','...and the entropy is stored','1',String((await recOf(C3.asset))![OFF_REC_SET]))
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
  console.log('\n─── G1. governance bootstrap: the charter vaults are the first voters ───')
  const propId=(n:number)=>W.findProgramAddressSync([Buffer.from('proposal'),u64(n)],GOV_PROG)[0]
  const nextProp=async()=>Number((await conn.getAccountInfo(GOV_CFG,CM))!.data.readBigUInt64LE(53))+1
  const now=()=>Math.floor(Date.now()/1000)
  const actRound=(price=PRICE,cap=100,o?:number,c?:number)=>Buffer.concat([u8b(0),i64(o??now()-60),i64(c??now()+6*3600),u64(price),u32(cap)])
  const actBrakes=(o:{sales?:boolean,sweep?:boolean,guardian?:W|null})=>Buffer.concat([u8b(1),
    u8b(o.sales?1:0),u8b(o.sweep?1:0),u8b(o.guardian!==undefined?1:0),o.guardian?SOME(o.guardian.toBuffer()):NONE])
  const actWiring=(o:any)=>Buffer.concat([u8b(2),wiringArgs(o)])
  const ixPropA=(id:number,asset:W,who:Keypair,ends:number,action:Buffer)=>new TransactionInstruction({programId:GOV_PROG,
    data:Buffer.concat([d('create_proposal'),action,i64(ends)]),
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
  /** Decode a Proposal: the action is a Borsh enum of variable length, so the
   *  fixed fields after it are found by walking it, never by a constant offset. */
  const readProp=async(id:number)=>{const b=(await conn.getAccountInfo(propId(id),CM))!.data
    let o=16; const tag=b[o++]
    if(tag===0) o+=28
    else if(tag===1){ o+=3; o+=b[o]===1?33:1 }
    // UpdateWiring: bank_treasury, split_bps, swap_operator, then four u64/i64 (stage 3: no treasury).
    else { for(const sz of [32,2,32,8,8,8,8]) o+=b[o]===1?1+sz:1 }
    o+=8; const yes=b.readBigUInt64LE(o); o+=8; const no=b.readBigUInt64LE(o); o+=8; o+=2
    const quorumSupply=Number(b.readBigUInt64LE(o)); o+=8; const qbps=b.readUInt16LE(o); o+=4
    const indexSnapshot=Number(b.readBigUInt64LE(o))
    return {yes,no,quorumSupply,qbps,indexSnapshot,need:Math.ceil(quorumSupply*qbps/10000)}}
  const OWNERS=[alice,bob,carol]
  /** Live vaults our keys own, read OFF THE CHAIN (owner bytes), never assumed. */
  const voters=async(snapshot:number)=>{const out:{v:V,kp:Keypair}[]=[]
    for(const v of VAULTS){const a=await conn.getAccountInfo(v.asset,CM); if(!a||a.data[0]!==1) continue
      const o=new W(a.data.subarray(1,33)); const kp=OWNERS.find(k=>k.publicKey.equals(o)); if(!kp) continue
      const r=await recOf(v.asset); if(!r||Number(r.readBigUInt64LE(OFF_REC_INDEX))>=snapshot) continue
      out.push({v,kp})}
    return out}
  /** Create one proposal and (unless told not to) vote it through with exactly
   *  the votes its quorum needs, plus `extra`. */
  const propose=async(action:Buffer,o:{votes?:'none'|'need'|number,ends?:number}={})=>{
    const id=await nextProp(); const vs=await voters(Number((await cfg()).readBigUInt64LE(OFF_MINTED_TOTAL)))
    const ends=o.ends??now()+VOTE_SECS+5
    const res=await att(()=>send([ixPropA(id,vs[0].v.asset,vs[0].kp,ends,action)],[vs[0].kp]))
    if(res.ok&&o.votes!=='none'){
      const p=await readProp(id); const n=typeof o.votes==='number'?o.votes:p.need
      const elig=await voters(p.indexSnapshot)
      for(const {v,kp} of elig.slice(0,n)) await send([ixVote(propId(id),v,kp,true)],[deployer,kp])
    }
    return {id,ends,...res}}
  const waitEnds=async(ends:number)=>{ const w=ends+2-now()
    if(w>0){ console.log(`  (waiting ${w}s for the voting window to close)`); while(now()<=ends+1) await sleep(500) } }
  const exec=async(id:number)=>att(()=>send([ixExec(propId(id))],[deployer]))

  // Refused at CREATION, so no vote is wasted on a proposal MINT would refuse.
  const ends1=now()+VOTE_SECS+5
  {
    const id=await nextProp()
    const gp2=await att(()=>send([ixPropA(id,C1.asset,deployer,ends1,actRound())],[deployer]))
    rec('7.4','a NON-holder creates a proposal','REJECT',gp2.ok?'ALLOW':'REJECT',gp2.err)
    const mk=async(t:string,rid:string,action:Buffer)=>{const x=await att(()=>send([ixPropA(id,C1.asset,alice,ends1,action)],[alice]))
      rec(rid,t,'REJECT',x.ok?'ALLOW':'REJECT',x.err)}
    await mk('a round priced BELOW the 21,000-sat floor (20,999)','G.1',actRound(20_999n))
    await mk('a round with cap=0 (used to mean UNLIMITED)','6.1',actRound(PRICE,0))
    await mk('a round with a window that never closes','6.2',actRound(PRICE,100,now()-60,8640000000000000))
    await mk('a round with opens_at=-1 and closes_at=i64::MAX','6.31',Buffer.concat([u8b(0),i64(-1),i64(9223372036854775807n),u64(PRICE),u32(10)]))
    await mk('a Brakes proposal that restarts nothing and replaces nobody','7.27',actBrakes({}))
    await mk('an UpdateWiring proposal that changes nothing','7.27a',actWiring({}))
  }
  const newOp=Keypair.generate()
  const B1:Record<string,any>={}
  B1.restartSales=await propose(actBrakes({sales:true}))
  B1.round=await propose(actRound())
  rec('7.3','a charter vault holder creates the FIRST round proposal','ALLOW',B1.round.ok?'ALLOW':'REJECT',B1.round.err)
  B1.zero=await propose(actRound(),{votes:'none'})
  rec('7.12','a proposal nobody will vote on','ALLOW',B1.zero.ok?'ALLOW':'REJECT',B1.zero.err)
  B1.closed=await propose(actRound(PRICE,10,now()-600,now()-300))
  rec('7.12a','a proposal for a round that has ALREADY closed can be created','ALLOW',B1.closed.ok?'ALLOW':'REJECT',B1.closed.err)
  B1.treasury=await propose(actWiring({bankTreasury:bankTreasury.publicKey}))
  B1.supplyLow=await propose(actWiring({maxSupply:1n}))
  B1.supplyHigh=await propose(actWiring({maxSupply:999999n}))
  B1.capLow=await propose(actWiring({maxSweep:1_000_000n}))
  B1.coolZero=await propose(actWiring({sweepCooldown:0}))
  B1.capCeil=await propose(actWiring({maxSweep:BigInt(51*LAMPORTS_PER_SOL)}))
  B1.opNull=await propose(actWiring({swapOperator:new W('11111111111111111111111111111111')}))
  B1.capZero=await propose(actWiring({maxSweep:0n}))
  B1.badReserve=await propose(actWiring({solReserve:1000n}))
  B1.okReserve=await propose(actWiring({solReserve:BigInt(0.05*LAMPORTS_PER_SOL)}))
  B1.badSplit=await propose(actWiring({splitBps:8537}))
  B1.newOp=await propose(actWiring({swapOperator:newOp.publicKey}))
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
  const v1=await att(()=>send([ixVote(P1,C4,alice,true)],[deployer,alice]))
  rec('7.6','the owner votes','ALLOW',v1.ok?'ALLOW':'REJECT',v1.err)
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
  const afterRot=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,data:wiring({bankTreasury:alice.publicKey}),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:GOV_PDA,isSigner:false,isWritable:false}]})],[deployer]))
  rec('7.18','update the wiring by naming the GOV PDA, which cannot sign','REJECT',afterRot.ok?'ALLOW':'REJECT',afterRot.err)

  // THE CHARTER WINDOW CLOSES FOREVER while the vote runs.
  await waitEnds(Math.max(B1.p5.ends,CHARTER_CLOSES))
  const cLate=await att(()=>claim(carol,7))
  rec('C.15','a VALID, unspent, owned Proof of Burn claimed AFTER the window','REJECT',cLate.ok?'ALLOW':'REJECT',cLate.err)
  rec('C.16','...and that PoB survives as what Gary ruled it now is: a collectible','1',
    String((await conn.getAccountInfo(POB[7],CM))?.data[0]))
  // EXECUTE IN ID ORDER. A failing execute reverts and does not advance
  // `last_executed_id`, so the arms that MINT must refuse sit among the passes.
  const roundBefore=(await cfg()).readUInt32LE(OFF_ROUND_ID)
  const x=async(k:string)=>exec(B1[k].id)
  const xr=await x('restartSales'); rec('6c.13','a VOTE restarts sales','ALLOW',xr.ok?'ALLOW':'REJECT',xr.err)
  rec('6c.14','...and only sales: the sweep is still stopped','0,1',await stops())
  const e2=await x('round'); rec('7.14','execute the ratified FIRST round','ALLOW',e2.ok?'ALLOW':'REJECT',e2.err)
  {
    const c=await cfg()
    rec('7.15','MINT round_id advanced (the vote actually set the round)',String(roundBefore+1),String(c.readUInt32LE(OFF_ROUND_ID)))
    rec('7.16','MINT price is the proposal price, in sats',String(PRICE),String(c.readBigUInt64LE(OFF_PRICE)))
  }
  const e1=await x('zero'); rec('7.13','execute a proposal with ZERO votes','REJECT',e1.ok?'ALLOW':'REJECT',e1.err)
  const e1b=await x('closed'); rec('7.13a','execute a RATIFIED proposal whose round already closed','REJECT',e1b.ok?'ALLOW':'REJECT',e1b.err)
  const t2=await x('treasury'); rec('6.11','a vote rotates the 15% destination (the 85% has no field to vote on)','ALLOW',t2.ok?'ALLOW':'REJECT',t2.err)
  const lowered=await x('supplyLow'); rec('6.8','a vote ratchets max_supply DOWN below what is minted','REJECT',lowered.ok?'ALLOW':'REJECT',lowered.err)
  const raised=await x('supplyHigh'); rec('6.9','a vote RAISES max_supply above its initial value','REJECT',raised.ok?'ALLOW':'REJECT',raised.err)
  const capLow=await x('capLow'); rec('6.14','a vote lowers the on-chain sweep cap','ALLOW',capLow.ok?'ALLOW':'REJECT',capLow.err)
  const coolZero=await x('coolZero'); rec('6.18a','a vote sets the cooldown to ZERO (the state the alarm calls CRITICAL)','REJECT',coolZero.ok?'ALLOW':'REJECT',coolZero.err)
  const overCeil=await x('capCeil'); rec('6.20i','even a VOTE cannot raise the cap past the stated 50 SOL','REJECT',overCeil.ok?'ALLOW':'REJECT',overCeil.err)
  const opNull=await x('opNull'); rec('6.23d','a vote points the swap operator at the default pubkey','REJECT',opNull.ok?'ALLOW':'REJECT',opNull.err)
  const capZero=await x('capZero'); rec('6.23e','a vote sets the sweep cap to zero','REJECT',capZero.ok?'ALLOW':'REJECT',capZero.err)
  const badReserve=await x('badReserve'); rec('6.34','a SOL reserve between zero and rent exemption','REJECT',badReserve.ok?'ALLOW':'REJECT',badReserve.err)
  const okReserve=await x('okReserve'); rec('6.34a','a reserve above rent exemption','ALLOW',okReserve.ok?'ALLOW':'REJECT',okReserve.err)
  const badSplit=await x('badSplit'); rec('G.2','a vote sets an 85.37/14.63 split (not whole percent)','REJECT',badSplit.ok?'ALLOW':'REJECT',badSplit.err)
  const rotOp=await x('newOp'); rec('6.20','a vote replaces the swap operator','ALLOW',rotOp.ok?'ALLOW':'REJECT',rotOp.err)
  rec('6.20e','...and the new operator is live at once (no pending slot exists)',newOp.publicKey.toBase58(),
    new W((await cfg()).subarray(OFF_SWAP_OPERATOR,OFF_SWAP_OPERATOR+32)).toBase58())
  const e5=await exec(B1.p5.id); rec('7.25','execute the NEWER of two ratified proposals','ALLOW',e5.ok?'ALLOW':'REJECT',e5.err)
  const e4=await exec(B1.p4.id); rec('7.26','then execute the OLDER one','REJECT',e4.ok?'ALLOW':'REJECT',e4.err)
  const e3=await x('round'); rec('7.17','execute the same proposal twice','REJECT',e3.ok?'ALLOW':'REJECT',e3.err)

  // ════════════════════ 2. THE PAID MINT, IN cbBTC ════════════════════
  console.log('\n─── 2. a voted round: paid in cbBTC, into THE revenue address ───')
  const revBefore=await tokBal(revAta), aliceBefore=await tokBal(ata(alice.publicKey))
  const V=await mkVault()
  rec('2.1','a vault minted in a voted round','true',String(!!V.asset))
  rec('2.2','the whole price landed in the revenue address, in cbBTC',String(PRICE),String(await tokBal(revAta)-revBefore))
  rec('2.2a','...and came out of the payer\'s cbBTC, the price and nothing else',String(PRICE),String(aliceBefore-await tokBal(ata(alice.publicKey))))
  rec('2.2b','its record: NOT charter','0',String((await recOf(V.asset))![OFF_REC_CHARTER]))
  // ── THE CRANK RIDES ON A PAID MINT, AN ACTIVATION AND A CLAIM ──
  const mintWith=async(o:any={})=>{const k=Keypair.generate()
    await send([ixMint(k.publicKey,alice.publicKey,alice.publicKey,o)],[alice,k]); return mkV(k,alice,[])}
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
  await fund(C1,ACTIVATION)
  const aC1=await att(()=>send([ixActivate(C1,{crank:[Q1.asset]})],[deployer]))
  rec('P.2','activate a drawn charter vault holding exactly 21,000 sats','ALLOW',aC1.ok?'ALLOW':'REJECT',aC1.err)
  rec('K.5','...and the ACTIVATION captured a queued vault\'s entropy on its way past','1',String((await recOf(Q1.asset))![OFF_REC_SET]))
  const Q2=await mintWith()
  await waitEntropy(Q2.asset)
  const kClaim=await att(()=>send([ixPoolClaim([C1],{crank:[Q2.asset]})],[deployer]))
  rec('K.6','a CLAIM with nothing owed lands, and captures a queued vault on its way past','ALLOW,1',
    `${kClaim.ok?'ALLOW':'REJECT'},${(await recOf(Q2.asset))![OFF_REC_SET]}`,kClaim.err)
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
  const t1=await att(()=>send([ixGovSigned(wiring({bankTreasury:alice.publicKey}),deployer)],[deployer]))
  rec('6.10','the DEPLOYER (INIT_AUTHORITY) redirects the treasury','REJECT',t1.ok?'ALLOW':'REJECT',t1.err)
  const payMe=await att(()=>send([ixGovSigned(wiring({bankTreasury:alice.publicKey}),alice)],[alice]))
  rec('6.21','a STRANGER redirects who gets paid','REJECT',payMe.ok?'ALLOW':'REJECT',payMe.err)
  const brick=Keypair.generate()
  const [bPda]=W.findProgramAddressSync([Buffer.from('mpl-core-execute'),brick.publicKey.toBuffer()],CORE)
  const n2=await att(()=>send([ixMint(brick.publicKey,bPda,alice.publicKey,{ownerSigns:false})],[alice,brick]))
  rec('5.2','mint a vault owned by a PDA that can never sign','REJECT',n2.ok?'ALLOW':'REJECT',n2.err)

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
  rec('3.1l','GOV pins the real set_guardian discriminator',[...d('set_guardian')].join(','),pinned(GOV_SRC,'IX_SET_GUARDIAN'))
  rec('3.1m','GOV pins the real update_wiring discriminator',[...d('update_wiring')].join(','),pinned(GOV_SRC,'IX_UPDATE_WIRING'))
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
  const bare=await att(()=>send([...sweep(V,SATS,0)],[alice]))
  rec('3.7','a BARE owner Execute with no open at all (the seal, tested)','REJECT',bare.ok?'ALLOW':'REJECT',bare.err)
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
    {pubkey:vrec(N.asset),isSigner:false,isWritable:true},
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
  console.log('\n─── G2. a vote restarts the sweep and replaces the guardian; a NEW vault cannot vote ───')
  // THE MISSED-WINDOW VAULT is minted here, before two voting windows, so its
  // capture window is long gone by the time it reaches the head of the queue
  // (L.15-L.17f). F2 misses its window too, and is rescheduled by a CRANK.
  const E=await mkVault(0n), F2=await mkVault(0n)
  const eRevealSlot=Number((await recOf(E.asset))!.readBigUInt64LE(OFF_REC_REVEAL))
  await send([SystemProgram.transfer({fromPubkey:deployer.publicKey,toPubkey:REVENUE,lamports:3*LAMPORTS_PER_SOL})],[deployer])
  const sweepTo=(amt:bigint,dest:W)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('sweep_sol_for_swap'),u64(amt)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},
      {pubkey:REVENUE,isSigner:false,isWritable:true},{pubkey:dest,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const gsw=await att(()=>send([sweepTo(1_000_000n,newOp.publicKey)],[alice,newOp]))
  rec('6c.7','a sweep while the sweep is stopped','REJECT',gsw.ok?'ALLOW':'REJECT',gsw.err)
  const B2:Record<string,any>={}
  B2.brakes=await propose(actBrakes({sweep:true,guardian:guardian2.publicKey}))
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
  const xb=await exec(B2.brakes.id)
  rec('6c.15','a VOTE restarts the sweep AND replaces the guardian','ALLOW',xb.ok?'ALLOW':'REJECT',xb.err)
  rec('6c.15a','...both are clear, and the guardian is the one the vote named',`0,0|${guardian2.publicKey.toBase58()}`,
    `${await stops()}|${await guardianNow()}`)
  await sleep(1500)
  const overCap=await att(()=>send([sweepTo(2_000_000n,newOp.publicKey)],[alice,newOp]))
  rec('6.15','sweep MORE than the on-chain cap','REJECT',overCap.ok?'ALLOW':'REJECT',overCap.err)
  const oldOpSweep=await att(()=>send([sweepTo(1_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('6.23f','sweep to the OLD operator after a vote replaced it','REJECT',oldOpSweep.ok?'ALLOW':'REJECT',oldOpSweep.err)
  const underCap=await att(()=>send([sweepTo(1_000_000n,newOp.publicKey)],[alice,newOp]))
  rec('6.16','sweep exactly the cap, to the NEW operator','ALLOW',underCap.ok?'ALLOW':'REJECT',underCap.err)
  const loopShut=await att(()=>send([sweepTo(1_000_000n,newOp.publicKey),sweepTo(1_000_000n,newOp.publicKey),
    sweepTo(1_000_000n,newOp.publicKey)],[alice,newOp]))
  rec('6.17','three sweeps in ONE transaction, each under the cap','REJECT',loopShut.ok?'ALLOW':'REJECT',loopShut.err)
  const strangerSweep=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('sweep_sol_for_swap'),u64(1_000_000n)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:REVENUE,isSigner:false,isWritable:true},
      {pubkey:newOp.publicKey,isSigner:false,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[alice]))
  rec('6.17a','a stranger sweeps without the operator signing','REJECT',strangerSweep.ok?'ALLOW':'REJECT',strangerSweep.err)
  const zeroSweep=await att(()=>send([sweepTo(0n,newOp.publicKey)],[alice,newOp]))
  rec('6.17b','a ZERO sweep, which moves nothing and burns the whole cooldown','REJECT',zeroSweep.ok?'ALLOW':'REJECT',zeroSweep.err)
  const gs3=await att(()=>send([ixStop('sales',guardian)],[guardian]))
  rec('6c.18','the OLD guardian pulls the brake','REJECT',gs3.ok?'ALLOW':'REJECT',gs3.err)
  const gs4=await att(()=>send([ixStop('sales',guardian2),ixStop('sweep',guardian2)],[guardian2]))
  rec('6c.19','the NEW guardian stops sales AND the sweep in one transaction','ALLOW',gs4.ok?'ALLOW':'REJECT',gs4.err)
  const gbm=await att(()=>mkVault(0n))
  rec('8.12','minting while stopped','REJECT',gbm.ok?'ALLOW':'REJECT',gbm.err)
  const gbG=await att(()=>send([ixGovSigned(Buffer.concat([d('restart'),Buffer.from([1,1])]),guardian2)],[guardian2]))
  rec('8.13b','the NEW guardian tries to restart','REJECT',gbG.ok?'ALLOW':'REJECT',gbG.err)

  // ════════════ G3. a vote retires the brake and restarts; the cooldown is real ════════════
  console.log('\n─── G3. a vote retires the brake, restarts both, and raises the cooldown ───')
  const B3:Record<string,any>={}
  B3.cool=await propose(actWiring({sweepCooldown:3600}))
  B3.retire=await propose(actBrakes({sales:true,sweep:true,guardian:null}))
  await waitEnds(B3.retire.ends)
  const coolUp=await exec(B3.cool.id); rec('6.18','a vote raises the sweep cooldown to an hour','ALLOW',coolUp.ok?'ALLOW':'REJECT',coolUp.err)
  const gg2=await exec(B3.retire.id); rec('6c.20','a VOTE retires the brake and restarts both','ALLOW',gg2.ok?'ALLOW':'REJECT',gg2.err)
  rec('6c.20a','...both running and no guardian on chain','0,0|11111111111111111111111111111111',`${await stops()}|${await guardianNow()}`)
  const gs5=await att(()=>send([ixStop('sweep',guardian2)],[guardian2]))
  rec('6c.21','...after which NOBODY can pull it, not even the last guardian','REJECT',gs5.ok?'ALLOW':'REJECT',gs5.err)
  const tooSoon=await att(()=>send([sweepTo(1_000_000n,newOp.publicKey)],[alice,newOp]))
  rec('6.19b','a single sweep inside the cooldown','REJECT',tooSoon.ok?'ALLOW':'REJECT',tooSoon.err)

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

  // ════════════ G4. LIVE SUPPLY IS THE DIVISOR, and the wiring comes home ════════════
  console.log('\n─── G4. quorum is measured against the LIVE electorate ───')
  const B4:Record<string,any>={}
  B4.home=await propose(actWiring({sweepCooldown:SWEEP_COOLDOWN,maxSweep:SWEEP_CAP,swapOperator:swapOp.publicKey}))
  B4.guard=await propose(actBrakes({guardian:guardian.publicKey}))
  B4.live=await propose(actRound(),{votes:'none'})
  {
    const c=await cfg(); const minted=Number(c.readBigUInt64LE(OFF_MINTED_TOTAL))
    const burned=Number((await conn.getAccountInfo(BURN_CFG,CM))!.data.readBigUInt64LE(OFF_BURNED_TOTAL))
    const p=await readProp(B4.live.id)
    rec('G.8','a proposal\'s divisor is LIVE supply (minted - burned) when it opens',String(minted-burned),String(p.quorumSupply),
      `${minted} minted, ${burned} burned through our burn path`)
    const needMinted=Math.ceil(minted*p.qbps/10000)
    rec('G.9','...so burns LOWER the bar (stage 1 divided by every vault ever minted)','true',String(p.need<needMinted),
      `needs ${p.need} votes; dividing by supply ever minted would need ${needMinted}`)
    const elig=await voters(p.indexSnapshot)
    for(const {v,kp} of elig.slice(0,p.need)) await send([ixVote(propId(B4.live.id),v,kp,true)],[deployer,kp])
    B4.liveNeed=p.need; B4.liveNeedMinted=needMinted
  }
  await waitEnds(B4.live.ends)
  const xh=await exec(B4.home.id)
  rec('8.14','a ratified UpdateWiring brings the cooldown, cap and operator home','ALLOW',xh.ok?'ALLOW':'REJECT',xh.err)
  rec('8.14a','...and MINT took GOV\'s WiringArgs byte for byte',`${SWEEP_COOLDOWN}|${swapOp.publicKey.toBase58()}`,
    `${(await cfg()).readBigInt64LE(OFF_SWEEP_COOLDOWN)}|${new W((await cfg()).subarray(OFF_SWAP_OPERATOR,OFF_SWAP_OPERATOR+32)).toBase58()}`)
  const xg=await exec(B4.guard.id)
  rec('8.15','a vote installs a guardian again (from None)','ALLOW',xg.ok?'ALLOW':'REJECT',xg.err)
  rec('8.15a','...and it is the one the vote named',guardian.publicKey.toBase58(),await guardianNow())
  const xl=await exec(B4.live.id)
  rec('G.10',`it PASSES with exactly the live quorum (${B4.liveNeed} votes; ${B4.liveNeedMinted} under the old divisor)`,
    'ALLOW',xl.ok?'ALLOW':'REJECT',xl.err)

  // ════════════ 8. REVENUE: one address in, 85/15 out ════════════
  console.log('\n─── 8. revenue: one address in, enforced 85/15 out ───')
  // v6 stage 3: the HOLDERS' side is THE POOL. There is no distributor wallet.
  const holdersAta=POOL, bankAta=ata(bankTreasury.publicKey)
  await send([createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,bankAta,bankTreasury.publicKey,mint)],[deployer])
  // NOTHING CAN VOTE THE 85% ELSEWHERE: neither WiringArgs carries a field for it.
  const structBody=(src:string,name:string)=>{const i=src.indexOf(`pub struct ${name} {`); return i<0?'NOT FOUND':src.slice(i,src.indexOf('}',i))}
  rec('P.0e','no WiringArgs field (MINT\'s or GOV\'s) can redirect the holders\' 85%','false,false',
    `${/pub (treasury|pool\w*):/.test(structBody(MINT_SRC,'WiringArgs'))},${/pub (treasury|pool\w*):/.test(structBody(GOV_SRC,'WiringArgs'))}`)
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
  await sleep(1500)
  const revSol=BigInt(await conn.getBalance(REVENUE,CM))
  const w1=await att(()=>send([sweepTo(revSol,swapOp.publicKey)],[deployer,swapOp]))
  rec('8.7','sweeping SOL that would breach the fee reserve','REJECT',w1.ok?'ALLOW':'REJECT',w1.err)
  const safe=revSol-BigInt(0.05*LAMPORTS_PER_SOL)
  await sleep(1500)
  const opBefore=BigInt(await conn.getBalance(swapOp.publicKey,CM))
  const w2=await att(()=>send([sweepTo(safe,swapOp.publicKey)],[deployer,swapOp]))
  rec('8.8','sweeping what the reserve allows','ALLOW',w2.ok?'ALLOW':'REJECT',w2.err)
  rec('8.9','the operator received it',String(safe),String(BigInt(await conn.getBalance(swapOp.publicKey,CM))-opBefore))
  const w3=await att(()=>send([sweepTo(1n,alice.publicKey)],[alice]))
  rec('8.10','sweeping SOL to an address of the caller\'s choosing','REJECT',w3.ok?'ALLOW':'REJECT',w3.err)
  await send([SystemProgram.transfer({fromPubkey:deployer.publicKey,toPubkey:REVENUE,lamports:1_000_000})],[deployer])
  await sleep(1500)
  const w4=await att(()=>send([sweepTo(1_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('8.10b','a stranger PAYS while the operator signs (the cron needs this)','ALLOW',w4.ok?'ALLOW':'REJECT',w4.err)

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
  rec('9.13','re-mint a vault at a BURNED asset address, holding its keypair','REJECT',remint.ok?'ALLOW':'REJECT',remint.err)

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
  rec('9.14a','a 3-mint worst-case redemption is 1120 bytes (stage 2: 1021; v5, with the Bank: 1119)','1120',String(sizes[2]))
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
  const bystander=Keypair.generate()
  const T2=await mkVault()
  const donate=await att(()=>send([ixOpen(T2,alice.publicKey),
    SystemProgram.transfer({fromPubkey:alice.publicKey,toPubkey:bystander.publicKey,lamports:LAMPORTS_PER_SOL/100}),
    ...sweep(T2,SATS,0),ixBurn(T2,alice.publicKey,declare(T2.pda))],[alice]))
  rec('4.8','a redemption carrying the OWNER\'s own unrelated transfer','ALLOW',donate.ok?'ALLOW':'REJECT',donate.err)
  const RA=await mkVault(0n), RB=await mkVault(0n)
  const two=await att(()=>send([ixOpen(RA,alice.publicKey),ixBurn(RA,alice.publicKey,declare(RA.pda)),
    ixOpen(RB,alice.publicKey),ixBurn(RB,alice.publicKey,declare(RB.pda))],[alice]))
  rec('4.9','TWO redemptions in ONE transaction, owner alone','ALLOW',two.ok?'ALLOW':'REJECT',two.err)
  const XA=await mkVault(0n), XB=await mkVault(0n)
  const cross=await att(()=>send([ixOpen(XA,alice.publicKey),ixBurn(XB,alice.publicKey,declare(XB.pda))],[alice]))
  rec('4.10','open vault A, burn vault B, nothing else','REJECT',cross.ok?'ALLOW':'REJECT',cross.err)
  const nest2=await att(()=>send([ixOpen(XA,alice.publicKey),ixOpen(XB,alice.publicKey),
    ixBurn(XB,alice.publicKey,declare(XB.pda)),ixBurn(XA,alice.publicKey,declare(XA.pda))],[alice]))
  rec('4.10a','...but open A, open B, burn B, burn A is two honest redemptions','ALLOW',nest2.ok?'ALLOW':'REJECT',nest2.err)
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
    // than a reveal), so the bound is only reachable by a v0 transaction with an
    // address lookup table — which anyone may build. Built here, both ways.
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
  rec('10.2','a mint padded to the BYTE ceiling still fits the COMPUTE ceiling','true',String(cuWide.cu<CU_LIMIT&&cuWide.bytes<=1232))
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
    for(const v of VAULTS){const r=await recOf(v.asset); if(!r||r[OFF_REC_ACTIVE]||r[OFF_REC_RETIRED]||!r[OFF_REC_LEVEL]) continue
      if(await isAlice(v)&&await empty(v)) cands.push(v)}
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
    rec('P.4','...one more sat and ANYONE may activate it','ALLOW',aOk.ok?'ALLOW':'REJECT',aOk.err)
    const aTwice=await att(()=>send([ixActivate(ex)],[deployer]))
    rec('P.5','activate the same vault twice','REJECT',aTwice.ok?'ALLOW':'REJECT',aTwice.err)
    const aGone=await att(()=>send([ixActivate(H)],[deployer]))
    rec('P.6','activate a REDEEMED vault (its record is retired)','REJECT',aGone.ok?'ALLOW':'REJECT',aGone.err)
    await fund(ex1,ACTIVATION)
    const aWrong=await att(()=>send([ixActivate(ex1,{token:ata(ex.pda)})],[deployer]))
    rec('P.7','activate a vault by pointing at ANOTHER vault\'s funded account','REJECT',aWrong.ok?'ALLOW':'REJECT',aWrong.err)
    for(const v of picks){ await fund(v,ACTIVATION); await send([ixActivate(v)],[deployer]) }
    const ACT=[C1,ex,...picks]
    {
      const p=await pool(); let want=0n; for(const v of ACT) want+=WEIGHTS[(await lvl(v))-1]
      rec('P.8','the denominator is the sum of the ACTIVATED vaults\' level weights, and nothing else',`${want},${ACT.length}`,`${p.w},${p.active}`)
    }
    // ── ONE DISTRIBUTION, MADE EXACT, SO THE WEIGHTS CAN BE READ OFF THE PAYOUTS ──
    const top=async(n:bigint)=>{ if(n>0n) await send([createTransferInstruction(ata(deployer.publicKey),POOL,deployer.publicKey,n)],[deployer]) }
    {
      const p=await pool(); await top((p.w-(p.avail%p.w))%p.w)
      const q=await pool(); const k=q.avail/q.w
      const dist=await att(()=>send([ixDistribute()],[alice]))
      rec('P.9','ANYONE can distribute the pool (85% of income, already split into it)','ALLOW',dist.ok?'ALLOW':'REJECT',`${dist.err} | ${q.avail} sats over weight ${q.w}`)
      const before=await Promise.all(ACT.map(v=>tokBal(ata(v.pda))))
      const cl=await att(()=>send([ixPoolClaim(ACT)],[alice]))
      rec('P.10','ANYONE can claim for a batch of vaults','ALLOW',cl.ok?'ALLOW':'REJECT',cl.err)
      const got=await Promise.all(ACT.map(async(v,i)=>(await tokBal(ata(v.pda)))-before[i]))
      const want=await Promise.all(ACT.map(async v=>WEIGHTS[(await lvl(v))-1]*k))
      rec('P.11','every vault was paid exactly weight x share, INTO ITS OWN cbBTC ACCOUNT',want.join(','),got.join(','))
      const perLevel=picks.length?await Promise.all(picks.map(async(v,i)=>`${LNAME[(await lvl(v))-1]}:${got[i+2]/(k*2n)}x${(got[i+2]%(k*2n))*2n/(k*2n)?'.5':''}`)):[]
      const wantLevel=await Promise.all(picks.map(async v=>{const w=WEIGHTS[(await lvl(v))-1]; return `${LNAME[(await lvl(v))-1]}:${w/2n}x${w%2n?'.5':''}`}))
      rec('P.11a',`Level I : II : III : IV : V pays 1 : 1.5 : 2 : 2.5 : 3 (levels present: ${picks.length} of 5)`,wantLevel.join(' '),perLevel.join(' '),
        `${picks.length<5?'⚠️ a level had no live unactivated vault left to activate in this run; its weight is still pinned by P.11b':''}`)
      rec('P.11b','MINT\'s weight table is the Schedule of Vaults',`[2, 3, 4, 5, 6]`,(MINT_SRC.match(/LEVEL_WEIGHTS: \[u64; 5\] = (\[[^\]]*\])/)||[])[1]??'NOT FOUND')
      const again=await Promise.all(ACT.map(v=>tokBal(ata(v.pda))))
      await send([ixPoolClaim(ACT)],[alice])
      const zero=await Promise.all(ACT.map(async(v,i)=>(await tokBal(ata(v.pda)))-again[i]))
      rec('P.12','claim the same batch again: nothing more is owed','0',String(zero.reduce((a,b)=>a+b,0n)))
      const e=await pool()
      rec('P.12a','...and the pool owes nothing and holds nothing it is not owed','0,0',`${e.bal},${e.owed}`)
    }
    // ── DUST CARRIES ──
    {
      const p=await pool(); await top(11n*p.w+1n)
      await send([ixDistribute()],[alice]); await send([ixPoolClaim(ACT)],[alice])
      const q=await pool()
      rec('P.13','the odd sat that does not divide stays IN THE POOL, owed to holders (nobody keeps a cut)','1,1,0',`${q.bal},${q.owedCeil},${q.avail}`)
    }
    // ── THE CADENCE, ON CHAIN ──
    {
      const p=await pool(); await top(p.w-1n)
      const g1=await att(()=>send([ixDistribute()],[alice]))
      rec('P.14','distribute less than 1 sat per weight unit','REJECT',g1.ok?'ALLOW':'REJECT',g1.err)
      await top(4n*p.w+1n)
      const g2=await att(()=>send([ixDistribute()],[alice]))
      rec('P.15',`distribute when a Level I vault would get 10 sats (the minimum is ${EMISSION_MIN}, 31 days have not passed)`,'REJECT',g2.ok?'ALLOW':'REJECT',g2.err)
      await top(6n*p.w)
      const g3=await att(()=>send([ixDistribute()],[alice]))
      rec('P.16','...and when it would get 22, it goes','ALLOW',g3.ok?'ALLOW':'REJECT',g3.err)
    }
    // ── A LATECOMER EARNS FROM THE NEXT DISTRIBUTION, NOT THE LAST ──
    const late=rest.shift()!
    {
      await fund(late,ACTIVATION); await send([ixActivate(late)],[deployer])
      const b=await tokBal(ata(late.pda)); await send([ixPoolClaim([late])],[alice])
      const p=await pool(); const r=(await recOf(late.asset))!
      rec('P.17','a vault activated AFTER a distribution gets nothing from it','0',String((await tokBal(ata(late.pda)))-b))
      rec('P.17a','...because it entered at the accumulator as it stood',String(WEIGHTS[r[OFF_REC_LEVEL]-1]*p.acc),String(u128le(r,OFF_REC_DEBT)))
    }
    // ── A FROZEN VAULT ACCOUNT (cbBTC's freeze authority) DEFERS ONE, BLOCKS NONE ──
    const [Y,Z,Rv,Qv]=[picks[0]??rest.shift()!,picks[1]??rest.shift()!,picks[2]??rest.shift()!,picks[3]??rest.shift()!]
    {
      const pY=await pendingOf(Y.asset), pZ=await pendingOf(Z.asset)
      await send([createFreezeAccountInstruction(ata(Y.pda),mint,deployer.publicKey)],[deployer])
      const bY=await tokBal(ata(Y.pda)), bZ=await tokBal(ata(Z.pda))
      const fr=await att(()=>send([ixPoolClaim([Y,Z])],[alice]))
      rec('P.18','a batch where one vault\'s cbBTC account is FROZEN still lands','ALLOW',fr.ok?'ALLOW':'REJECT',fr.err)
      rec('P.18a','...the unfrozen vault is paid in full',String(pZ/ACC_SCALE),String((await tokBal(ata(Z.pda)))-bZ))
      rec('P.18b','...the frozen one is paid nothing and STILL OWED every sat',`0,${pY}`,`${(await tokBal(ata(Y.pda)))-bY},${await pendingOf(Y.asset)}`)
      await send([createThawAccountInstruction(ata(Y.pda),mint,deployer.publicKey)],[deployer])
      await send([ixPoolClaim([Y])],[alice])
      rec('P.18c','thawed, it is paid exactly what it was owed',String(pY/ACC_SCALE),String((await tokBal(ata(Y.pda)))-bY))
      const wrongDest=await att(()=>send([ixPoolClaim([{...Z,dest:ata(Y.pda)}])],[alice]))
      rec('P.19','claim a vault\'s share into ANOTHER account','REJECT',wrongDest.ok?'ALLOW':'REJECT',wrongDest.err)
      const noPairs=await att(()=>send([ixPoolClaim([])],[alice]))
      rec('P.19a','a claim naming no vault','REJECT',noPairs.ok?'ALLOW':'REJECT',noPairs.err)
      const wrongPool=await att(()=>send([ixPoolClaim([Z],{pool:ata(alice.publicKey)})],[alice]))
      rec('P.19b','a claim paying out of an account that is not the pool','REJECT',wrongPool.ok?'ALLOW':'REJECT',wrongPool.err)
      const dWrong=await att(()=>send([ixDistribute(ata(alice.publicKey))],[alice]))
      rec('P.19c','a distribution reading an account that is not the pool','REJECT',dWrong.ok?'ALLOW':'REJECT',dWrong.err)
    }
    // ── A REDEMPTION CLAIMS FIRST, AND BURN TAKES THE VAULT OFF THE SCHEDULE ──
    {
      const pR=await pendingOf(Rv.asset); const held=await tokBal(ata(Rv.pda))
      const noClaim=await att(()=>send([ixOpen(Rv,alice.publicKey),...sweep(Rv,held,0),ixBurn(Rv,alice.publicKey,declare(Rv.pda))],[alice]))
      rec('P.20','redeem an activated vault that is still OWED its share, without claiming','REJECT',noClaim.ok?'ALLOW':'REJECT',`${noClaim.err} | owed ${pR/ACC_SCALE} sats`)
      const closedFirst=await att(()=>send([ixOpen(Rv,alice.publicKey),...sweep(Rv,held,0),ixPoolClaim([Rv]),
        ixBurn(Rv,alice.publicKey,declare(Rv.pda))],[alice]))
      rec('P.21','...claim AFTER the sweep closed its account (a claim never creates one)','REJECT',closedFirst.ok?'ALLOW':'REJECT',closedFirst.err)
      const w0=(await pool()).w, wR=WEIGHTS[(await lvl(Rv))-1], aBefore=await tokBal(ata(alice.publicKey))
      const redeem=[ixOpen(Rv,alice.publicKey),ixPoolClaim([Rv]),...sweep(Rv,held+pR/ACC_SCALE,0),ixBurn(Rv,alice.publicKey,declare(Rv.pda))]
      const ok=await att(()=>send(redeem,[alice]))
      rec('P.22','open + CLAIM + sweep + burn: the share is paid into the vault and swept out with the rest','ALLOW',ok.ok?'ALLOW':'REJECT',ok.err)
      rec('P.22a','...the owner received the vault AND its share',String(held+pR/ACC_SCALE),String((await tokBal(ata(alice.publicKey)))-aBefore))
      rec('P.22b','...its weight left the schedule in the same transaction',String(w0-wR),String((await pool()).w))
      rec('P.22c','...and its record is retired, not active','1,0',`${(await recOf(Rv.asset))![OFF_REC_RETIRED]},${(await recOf(Rv.asset))![OFF_REC_ACTIVE]}`)
      const sz=new Transaction().add(...redeem); sz.feePayer=alice.publicKey; sz.recentBlockhash='11111111111111111111111111111111'
      const B=sz.serialize({requireAllSignatures:false,verifySignatures:false}).length
      rec('P.22d','an activated vault\'s 1-mint redemption, claim included, fits a legacy transaction','true',String(B<=1232),`${B} bytes`)
      const direct=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,data:d('retire_redeemed'),
        keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:vrec(Z.asset),isSigner:false,isWritable:true},
          {pubkey:Z.asset,isSigner:false,isWritable:false},{pubkey:SYSVAR_INSTRUCTIONS_PUBKEY,isSigner:false,isWritable:false}]})],[alice]))
      rec('P.23','call MINT\'s retire_redeemed DIRECTLY to knock a live vault off the schedule','REJECT',direct.ok?'ALLOW':'REJECT',direct.err)
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
      await send([ixDistribute()],[alice])
      const live=[C1,ex,...picks.filter(v=>v!==Rv&&v!==Qv),ex1].filter(Boolean)
      for(const v of live){ const r=(await recOf(v.asset))!; if(!r[OFF_REC_ACTIVE]) await send([ixActivate(v)],[deployer]) }
      const sig=await send([ixPoolClaim(live)],[alice])
      const cu=await cuOf(sig)
      rec('P.31',`a real claim paying ${live.length} vaults stays under the regression ceiling`,'true',String(cu<CU_CEILING),`${cu} CU`)
      const q=await pool()
      rec('P.32','THE INVARIANT: the pool always holds at least what it owes','true',String(q.bal>=q.owedCeil),`${q.bal} held, ${q.owedCeil} owed`)
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
    }
  }
  rec('R.9','...and at the end of everything, the royalty is still 10%','1000',
    String(((await fetchCollection(umi,coll.publicKey)) as any).royalties?.basisPoints))

  // ═══ THE NEGATIVES, REJECTED FOR THE RIGHT REASON ═══
  const because=(id:string,code:string)=>{const r=R.find(x=>x.id===id)
    const hit=(r?.n||'').includes(code); R.push({id:id+'!',t:`  ↳ rejected because ${code}`,want:'true',got:String(hit),ok:hit,n:r?.n})
    console.log(`  ${hit?'ok  ':'XX  '}${id}!  rejected because ${code}  [got ${hit}]${hit?'':`\n        ACTUAL: ${(r?.n||'(no error recorded)').slice(0,300)}`}`)}
  console.log('\n─── the negatives, rejected for the RIGHT reason ───')
  because('0.1','NotTheInitAuthority'); because('0.1e','BadCharterWindow'); because('0.1f','BadPobRoot')
  because('0.1g','CollectionNotClean'); because('0.1h','CollectionNotOurs'); because('0.1i','custom program error: 0x0')
  because('0.2','NotTheInitAuthority'); because('0.3','NotTheInitAuthority'); because('7.0','NotTheInitAuthority')
  because('7.12e','BadThreshold'); because('6.13','ReserveMintNotClassicSpl')
  for(const id of ['0.4','0.4a','0.4b','0.4c','0.4d','0.4e','0.4f','0.4g','0.4h']) because(id,'InstructionFallbackNotFound')
  because('C.1','CharterNotOpen'); because('1.1','ConstraintHasOne'); because('C.1a','NoRound')
  because('C.7','NotAProofOfBurn'); because('C.8','NotInPobSet'); because('C.9','NotThePobOwner')
  because('C.10','NotAProofOfBurn'); because('C.11','ReservedAttribute'); because('C.12','NotInPobSet')
  because('C.15','CharterClosed')
  because('6c.1','NotTheGuardian'); because('6c.5','SalesStopped'); because('6c.7','SweepStopped')
  because('6c.8','ConstraintHasOne'); because('6c.9','ConstraintHasOne'); because('6c.10','ConstraintHasOne')
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
  because('7.7','custom program error: 0x0'); because('7.9','custom program error: 0x0'); because('G.3','BadVaultRecord')
  because('G.1','PriceBelowFloor'); because('6.1','BadWindow'); because('6.2','BadWindow'); because('6.31','BadWindow')
  because('7.27','EmptyAction'); because('7.27a','EmptyAction'); because('7.18','AccountNotSigner')
  because('7.13','QuorumNotMet'); because('7.13a','RoundAlreadyOver'); because('7.26','ProposalSuperseded'); because('7.17','AlreadyExecuted')
  because('6.8','BadSupplyCap'); because('6.9','BadSupplyCap'); because('6.18a','BadSweepBound'); because('6.20i','BadSweepBound')
  because('6.23d','WrongTreasury'); because('6.23e','BadSweepBound'); because('6.34','BadSweepBound'); because('G.2','BadSplit')
  because('G.6','VaultTooNew')
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
  because('9.13','custom program error: 0x0')
  // v6 STAGE 3: the pool, the crank, and the reschedule.
  because('L.16','NeedsReschedule'); because('L.16a','RevealOutOfOrder'); because('L.16b','RescheduleTooEarly')
  because('K.4','TooManyCranked'); because('P.0a','BadEmissionMin'); because('P.0d','WrongPaymentMint')
  because('P.1','NotRevealed'); because('P.3','BelowActivation'); because('P.5','AlreadyActive'); because('P.6','VaultRetired')
  because('P.7','WrongVaultAccount'); because('P.14','BelowOneSatPerWeight'); because('P.15','EmissionBelowThreshold')
  because('P.19','WrongVaultAccount'); because('P.19a','BadClaimList'); because('P.19b','WrongPool'); because('P.19c','WrongPool')
  because('P.20','ClaimBeforeBurn'); because('P.21','VaultAccountMissing'); because('P.23','NotFromBurn')
  because('P.24','NotBurned'); because('P.26','WrongAsset'); because('P.28','AlreadyRetired')

  const bad=R.filter(r=>!r.ok)
  console.log(`\n${'═'.repeat(78)}`)
  for(const r of R) console.log(`| ${r.id.padEnd(5)} | ${r.t.slice(0,54).padEnd(54)} | ${r.ok?'ok      ':'MISMATCH'} |`)
  console.log(`${'═'.repeat(78)}\n${R.length-bad.length}/${R.length} as predicted (4 PROGRAMS, real Core, REAL TOKENS)`)
  process.exit(bad.length?1:0)
}
main().catch(e=>{console.error('FATAL',e?.message||e,'\n',(e?.logs||[]).join('\n'));process.exit(2)})
