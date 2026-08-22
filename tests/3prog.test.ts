/**
 * THREE-PROGRAM END-TO-END: mint (governable) -> seal (redemption) -> burn.
 * Each program has its own upgrade authority; the collection's update authority is
 * the MINT program's PDA, so the seal program has no minting power at all.
 * Every vault holds a real SPL token balance.
 */
import { createHash } from 'crypto'
import { Connection, Keypair, PublicKey as W, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createMint, getAssociatedTokenAddressSync, mintTo,
  createTransferInstruction, createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction, createApproveInstruction } from '@solana/spl-token'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { keypairIdentity, createNoopSigner, createSignerFromKeypair, generateSigner,
  transactionBuilder, publicKey as pk } from '@metaplex-foundation/umi'
import { toWeb3JsPublicKey, fromWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters'
import { mplCore, createCollection, execute, fetchAsset, fetchCollection, findAssetSignerPda, create, transfer } from '@metaplex-foundation/mpl-core'
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
const d=(n:string)=>createHash('sha256').update(`global:${n}`).digest().subarray(0,8)
const R:{id:string;t:string;want:string;got:string;ok:boolean;n?:string}[]=[]
const rec=(id:string,t:string,want:string,got:string,n?:string)=>{const ok=want===got;R.push({id,t,want,got,ok,n})
  console.log(`  ${ok?'ok  ':'XX  '}${id}  ${t}  [want ${want}, got ${got}]${n?`\n         ↳ ${n}`:''}`)}
const u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b}
const u16=(n:number)=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b}
const i64=(n:number|bigint)=>{const b=Buffer.alloc(8);b.writeBigInt64LE(BigInt(n));return b}
const u64=(n:number|bigint)=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b}
const str=(v:string)=>Buffer.concat([u32(Buffer.byteLength(v)),Buffer.from(v)])
const NONE=Buffer.from([0])
const SOME=(b:Buffer)=>Buffer.concat([Buffer.from([1]),b])
// update_wiring(bank, governance, treasury, admin, max_supply, bank_treasury, split_bps)
const wiring=(o:any={})=>Buffer.concat([d('update_wiring'),
  o.bank?SOME(o.bank.toBuffer()):NONE, o.governance?SOME(o.governance.toBuffer()):NONE,
  o.treasury?SOME(o.treasury.toBuffer()):NONE, o.admin?SOME(o.admin.toBuffer()):NONE,
  o.maxSupply!==undefined?SOME(u64(o.maxSupply)):NONE,
  o.bankTreasury?SOME(o.bankTreasury.toBuffer()):NONE,
  o.splitBps!==undefined?SOME(u16(o.splitBps)):NONE,
  o.swapOperator?SOME(o.swapOperator.toBuffer()):NONE,
  o.solReserve!==undefined?SOME(u64(o.solReserve)):NONE,
  o.maxSweep!==undefined?SOME(u64(o.maxSweep)):NONE,
  o.sweepCooldown!==undefined?SOME(i64(o.sweepCooldown)):NONE,
  o.govTimelock!==undefined?SOME(i64(o.govTimelock)):NONE])
const attrs=(list:[string,string][])=>Buffer.concat([u32(list.length),
  ...list.flatMap(([k,v])=>[str(k),str(v)])])
const SATS=100_000_000n
const MAX_SUPPLY=2100n
/** The on-chain sweep bound. `revenue.mjs`'s 50-SOL constant bound nobody. */
const SWEEP_CAP=BigInt(100*LAMPORTS_PER_SOL)
/** The PROGRAM floor. Zero is refused now: two sweeps in one transaction share a
 *  timestamp, so a cooldown of 1 closes the atomic bypass absolutely. Production
 *  must be hours and the alarm asserts it. */
const SWEEP_COOLDOWN=1
/** The notice period on a governance rotation. 60 is the FLOOR, which exists
 *  only so the apply path can be exercised; production must be days. */
const GOV_TIMELOCK=60
/** The program's quorum floor: below this a quorum is arithmetic, not policy. */
const MIN_QUORUM=500

async function main(){
  const bank=Keypair.fromSeed(Buffer.alloc(32,7)), alice=Keypair.generate()
  const gov=Keypair.fromSeed(Buffer.alloc(32,11)), treasury=Keypair.generate()
  const bankTreasury=Keypair.generate(), swapOp=Keypair.generate()
  for(const k of [bank,alice,gov]){ const s=await conn.requestAirdrop(k.publicKey,50*LAMPORTS_PER_SOL)
    await conn.confirmTransaction({signature:s,...(await conn.getLatestBlockhash())},CM) }
  const umi=createUmi(RPC,{commitment:CM}).use(mplCore())
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(bank.secretKey)))
  const aliceU=createSignerFromKeypair(umi,umi.eddsa.createKeypairFromSecretKey(alice.secretKey))

  // collection update authority = the MINT program's PDA
  const coll=generateSigner(umi)
  await createCollection(umi,{collection:coll,name:'CBOBTC Vaults',uri:'https://cdn.gary.club/cbob/c.json',
    updateAuthority:pk(MINT_AUTH.toBase58())}).sendAndConfirm(umi,{confirm:{commitment:CM}})
  const COLL=toWeb3JsPublicKey(coll.publicKey)
  const mint=await createMint(conn,bank,bank.publicKey,null,8)
  const ata=(o:W)=>getAssociatedTokenAddressSync(mint,o,true)
  const declare=(p:W)=>[getAssociatedTokenAddressSync(mint,p,true),getAssociatedTokenAddressSync(mint,p,true,TOKEN_2022_PROGRAM_ID)]
  await sendAndConfirmTransaction(conn,new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(bank.publicKey,ata(bank.publicKey),bank.publicKey,mint),
    createAssociatedTokenAccountIdempotentInstruction(bank.publicKey,ata(alice.publicKey),alice.publicKey,mint)),[bank],{commitment:CM})
  await mintTo(conn,bank,mint,ata(bank.publicKey),bank,10_000_000_000n,[],{commitment:CM})
  console.log(`collection ${COLL.toBase58()}\n  update authority = MINT program PDA ${MINT_AUTH.toBase58()}\n`)

  const send=(ixs:TransactionInstruction[],s:Keypair[])=>sendAndConfirmTransaction(conn,new Transaction().add(...ixs),s,{commitment:CM})
  // A REJECT FOR THE WRONG REASON IS A FALSE PASS, so the reason has to survive
  // intact: `slice(0,110)` used to cut error codes in half ("GovernanceTimelockActi")
  // and `because()` then failed on a test that was in fact correct. `panicked`
  // matters too — an arithmetic overflow abort prints no "Error Code" line at all,
  // so a suite that only looked for those recorded the useless outer message.
  const att=async(f:()=>Promise<unknown>)=>{try{await f();return{ok:true,err:''}}catch(e:any){
    const l=(e?.logs||[]).filter((x:string)=>/Error Code|custom program error|panicked/.test(x))
    return{ok:false,err:(l.join(' | ')||String(e?.message||e)).replace(/\s+/g,' ').slice(0,220)}}}

  // ---- init all three ----
  const someB=(b:Buffer)=>Buffer.concat([Buffer.from([1]),b])
  const mi=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('initialize'),COLL.toBuffer(),bank.publicKey.toBuffer(),gov.publicKey.toBuffer(),treasury.publicKey.toBuffer(),bankTreasury.publicKey.toBuffer(),swapOp.publicKey.toBuffer(),u64(BigInt(0.05*LAMPORTS_PER_SOL)),u64(MAX_SUPPLY),u64(SWEEP_CAP),i64(SWEEP_COOLDOWN),i64(GOV_TIMELOCK)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[bank]))
  if(!mi.ok){ console.log('  MINT config already exists — use a FRESH validator'); }
  if(false){
    const up=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
      data:Buffer.concat([d('update_wiring'),someB(COLL.toBuffer()),someB(bank.publicKey.toBuffer()),
        someB(gov.publicKey.toBuffer()),someB(treasury.publicKey.toBuffer()),someB(bank.publicKey.toBuffer()),Buffer.from([0]),Buffer.from([0])]),
      keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false}]})],[bank]))
    console.log(`  (mint config re-pointed: ${up.ok?'ok':'FAILED '+up.err})`)
  }
  // config PDAs persist across validator runs; re-point them or every check fails
  // with ForeignVault against a stale collection.
  const some=(b:Buffer)=>Buffer.concat([Buffer.from([1]),b])
  const seal1=await att(()=>send([new TransactionInstruction({programId:SEAL_PROG,
    data:Buffer.concat([d('initialize'),COLL.toBuffer(),bank.publicKey.toBuffer(),u32(1),mint.toBuffer()]),
    keys:[{pubkey:SEAL_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
      {pubkey:mint,isSigner:false,isWritable:false}]})],[bank]))
  if(!seal1.ok){ console.log('  SEAL config already exists — collection is immutable by design, use a FRESH validator'); }
  if(false){
    const up=await att(()=>send([new TransactionInstruction({programId:SEAL_PROG,
      data:Buffer.concat([d('update_config'),some(COLL.toBuffer()),some(bank.publicKey.toBuffer()),
        some(bank.publicKey.toBuffer()),some(Buffer.concat([u32(1),mint.toBuffer()]))]),
      keys:[{pubkey:SEAL_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false}]})],[bank]))
    console.log(`  (seal config re-pointed: ${up.ok?'ok':'FAILED '+up.err})`)
  }
  const burn1=await att(()=>send([new TransactionInstruction({programId:BURN_PROG,
    data:Buffer.concat([d('initialize'),COLL.toBuffer(),bank.publicKey.toBuffer()]),
    keys:[{pubkey:BURN_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[bank]))
  if(!burn1.ok){ console.log('  BURN config already exists — use a FRESH validator'); }
  if(false){
    const up=await att(()=>send([new TransactionInstruction({programId:BURN_PROG,
      data:Buffer.concat([d('update_config'),some(COLL.toBuffer()),some(bank.publicKey.toBuffer()),
        some(bank.publicKey.toBuffer()),some(Buffer.concat([u32(1),mint.toBuffer()]))]),
      keys:[{pubkey:BURN_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false}]})],[bank]))
    console.log(`  (burn config re-pointed: ${up.ok?'ok':'FAILED '+up.err})`)
  }

  // ---- 1. governance sets the round ----
  console.log('─── 1. governance: the ONLY two fields a vote can set ───')
  const now=Math.floor(Date.now()/1000)
  const setRound=(o:number|bigint,c:number|bigint,price:bigint,cap:number,signer:Keypair)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('set_round'),i64(o),i64(c),u64(price),u32(cap)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false}]})
  const g1=await att(()=>send([setRound(now-60,now+3600,BigInt(0.05*LAMPORTS_PER_SOL),100,bank)],[bank]))
  rec('1.1','a NON-governor sets the round','REJECT',g1.ok?'ALLOW':'REJECT',g1.err)
  const g2=await att(()=>send([setRound(now-60,now+3600,BigInt(0.05*LAMPORTS_PER_SOL),100,gov)],[gov]))
  rec('1.2','the governance authority sets the round','ALLOW',g2.ok?'ALLOW':'REJECT',g2.err)

  // ---- 2. mint through the mint program ----
  console.log('\n─── 2. mint program ───')
  const mkVault=async(tokens=SATS,prov:[string,string][]=[])=>{
    const asset=Keypair.generate()
    await send([new TransactionInstruction({programId:MINT_PROG,
      data:Buffer.concat([d('mint_vault'),str('CBOBTC Vault'),str('https://cdn.gary.club/cbob/v.json'),u64(BigInt(LAMPORTS_PER_SOL)),attrs(prov)]),
      keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:asset.publicKey,isSigner:true,isWritable:true},
        {pubkey:COLL,isSigner:false,isWritable:true},{pubkey:alice.publicKey,isSigner:true,isWritable:false},
        {pubkey:bank.publicKey,isSigner:true,isWritable:false},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
        {pubkey:REVENUE,isSigner:false,isWritable:true},
        {pubkey:SEAL_CFG,isSigner:false,isWritable:false},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
        {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[bank,asset,alice])
    const [pdaU]=findAssetSignerPda(umi,{asset:pk(asset.publicKey.toBase58())})
    const pda=toWeb3JsPublicKey(pdaU)
    if(tokens>0n) await sendAndConfirmTransaction(conn,new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(bank.publicKey,ata(pda),pda,mint),
      createTransferInstruction(ata(bank.publicKey),ata(pda),bank.publicKey,tokens)),[bank],{commitment:CM})
    return {asset:asset.publicKey,umiAsset:pk(asset.publicKey.toBase58()),pdaU,pda}
  }
  const tBefore=await conn.getBalance(REVENUE,CM)
  const V=await mkVault()
  rec('2.1','vault minted via the mint program','true',String(!!V.asset))
  rec('2.2','the whole mint price landed in the ONE revenue address',String(0.05*LAMPORTS_PER_SOL),String(await conn.getBalance(REVENUE,CM)-tBefore))
  const a:any=await fetchAsset(umi,V.umiAsset)
  rec('2.3','seal plugin authority is the SEAL program PDA',SEAL.toBase58().slice(0,14),String(a.permanentFreezeExecute?.authority?.address).slice(0,14))
  rec('2.4','no permanent transfer delegate','true',String(!a.permanentTransferDelegate))
  const rogue=generateSigner(umi)
  const r=await att(()=>create(umi,{asset:rogue,name:'ROGUE',uri:'u',owner:aliceU.publicKey,
    collection:{publicKey:coll.publicKey,oracles:[],lifecycleHooks:[]} as any,plugins:[]}).sendAndConfirm(umi,{confirm:{commitment:CM}}))
  rec('2.5','a direct mint into the collection','REJECT',r.ok?'ALLOW':'REJECT',r.err)

  // ---- 3. seal program: redemption, Bank co-signs BOTH halves ----
  console.log('\n─── 3. seal program (round-3 fix: Bank co-signs CLOSE too) ───')
  const ixOpen=(v:any,o:W,b:W)=>new TransactionInstruction({programId:SEAL_PROG,data:Buffer.from(d('open_for_redemption')),keys:[
    {pubkey:v.asset,isSigner:false,isWritable:true},{pubkey:COLL,isSigner:false,isWritable:true},
    {pubkey:o,isSigner:true,isWritable:false},{pubkey:b,isSigner:true,isWritable:false},
    {pubkey:bank.publicKey,isSigner:true,isWritable:true},{pubkey:SEAL_CFG,isSigner:false,isWritable:false},
    {pubkey:SEAL,isSigner:false,isWritable:false},{pubkey:CORE,isSigner:false,isWritable:false},
    {pubkey:SYSVAR_INSTRUCTIONS_PUBKEY,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const ixClose=(v:any,o:W,b:W,extra:W[]=[])=>new TransactionInstruction({programId:SEAL_PROG,data:Buffer.from(d('close_redemption')),keys:[
    {pubkey:v.asset,isSigner:false,isWritable:true},{pubkey:COLL,isSigner:false,isWritable:true},
    {pubkey:o,isSigner:true,isWritable:false},{pubkey:b,isSigner:true,isWritable:false},
    {pubkey:SYSVAR_INSTRUCTIONS_PUBKEY,isSigner:false,isWritable:false},
    {pubkey:v.pda,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
    {pubkey:SEAL_CFG,isSigner:false,isWritable:false},{pubkey:SEAL,isSigner:false,isWritable:false},
    {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
    ...extra.map(p=>({pubkey:p,isSigner:false,isWritable:true}))]})
  const sweep=(v:any,amt:bigint,lam:number)=>{
    const ixs:any[]=[]
    if(amt>0n){ ixs.push(fromWeb3JsInstruction(createTransferInstruction(ata(v.pda),ata(alice.publicKey),v.pda,amt)))
      ixs.push(fromWeb3JsInstruction(createCloseAccountInstruction(ata(v.pda),alice.publicKey,v.pda))) }
    if(lam>0) ixs.push(fromWeb3JsInstruction(SystemProgram.transfer({fromPubkey:v.pda,toPubkey:alice.publicKey,lamports:lam})))
    return execute(umi,{asset:{publicKey:v.umiAsset},collection:{publicKey:coll.publicKey} as any,instructions:ixs,
      signers:[createNoopSigner(v.pdaU)],authority:aliceU}).getInstructions().map(i=>new TransactionInstruction({
        programId:toWeb3JsPublicKey(i.programId),data:Buffer.from(i.data),
        keys:i.keys.map(k=>({pubkey:toWeb3JsPublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable}))}))
  }
  const c1=await att(()=>send([ixOpen(V,alice.publicKey,bank.publicKey),ixClose(V,alice.publicKey,alice.publicKey,declare(V.pda))],[bank,alice]))
  rec('3.1','close WITHOUT the Bank co-signing','REJECT',c1.ok?'ALLOW':'REJECT',c1.err)
  const c2=await att(()=>send([ixOpen(V,alice.publicKey,bank.publicKey),ixClose(V,alice.publicKey,bank.publicKey,declare(V.pda))],[bank,alice]))
  rec('3.2','Bank co-signs both halves','ALLOW',c2.ok?'ALLOW':'REJECT',c2.err)
  const dele=execute(umi,{asset:{publicKey:V.umiAsset},collection:{publicKey:coll.publicKey} as any,
    instructions:[fromWeb3JsInstruction(createApproveInstruction(ata(V.pda),gov.publicKey,V.pda,SATS))],
    signers:[createNoopSigner(V.pdaU)],authority:aliceU}).getInstructions().map(i=>new TransactionInstruction({
      programId:toWeb3JsPublicKey(i.programId),data:Buffer.from(i.data),
      keys:i.keys.map(k=>({pubkey:toWeb3JsPublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable}))}))
  const c3=await att(()=>send([ixOpen(V,alice.publicKey,bank.publicKey),...dele,ixClose(V,alice.publicKey,bank.publicKey,declare(V.pda))],[bank,alice]))
  rec('3.3','delegate planted on the reserve ATA during the thaw','REJECT',c3.ok?'ALLOW':'REJECT',c3.err)

  // ---- 4. burn program ----
  console.log('\n─── 4. burn program (separate, Bank co-signs every destruction) ───')
  const ixBurn=(v:any,o:W,b:W,extra:W[]=[])=>new TransactionInstruction({programId:BURN_PROG,
    data:Buffer.concat([d('burn_vault'),Buffer.from([extra.length])]),keys:[
    {pubkey:v.asset,isSigner:false,isWritable:true},{pubkey:COLL,isSigner:false,isWritable:true},
    {pubkey:o,isSigner:true,isWritable:false},{pubkey:b,isSigner:true,isWritable:false},
    {pubkey:v.pda,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
    {pubkey:BURN_CFG,isSigner:false,isWritable:false},{pubkey:SEAL_CFG,isSigner:false,isWritable:false},
    {pubkey:CORE,isSigner:false,isWritable:false},
    {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
    ...extra.map(p=>({pubkey:p,isSigner:false,isWritable:true}))]})
  const b1=await att(()=>send([ixBurn(V,alice.publicKey,bank.publicKey,declare(V.pda))],[bank,alice]))
  rec('4.1','burn while the BTC is still inside','REJECT',b1.ok?'ALLOW':'REJECT',b1.err)
  const H=await mkVault()
  const before=await conn.getTokenAccountBalance(ata(alice.publicKey),CM)
  const h1=await att(()=>send([ixOpen(H,alice.publicKey,bank.publicKey),...sweep(H,SATS,0),
    ixClose(H,alice.publicKey,bank.publicKey,declare(H.pda))],[bank,alice]))
  rec('4.2','full redemption: open + sweep + close','ALLOW',h1.ok?'ALLOW':'REJECT',h1.err)
  rec('4.3','owner received the BTC','100000000',String(BigInt((await conn.getTokenAccountBalance(ata(alice.publicKey),CM)).value.amount)-BigInt(before.value.amount)))
  const b2=await att(()=>send([ixBurn(H,alice.publicKey,alice.publicKey,declare(H.pda))],[bank,alice]))
  rec('4.4','burn WITHOUT the Bank co-signing','REJECT',b2.ok?'ALLOW':'REJECT',b2.err)
  const b3=await att(()=>send([ixBurn(H,alice.publicKey,bank.publicKey,declare(H.pda))],[bank,alice]))
  rec('4.5','burn an emptied vault, Bank co-signing','ALLOW',b3.ok?'ALLOW':'REJECT',b3.err)
  const inf=await conn.getAccountInfo(H.asset,CM)
  rec('4.6','vault destroyed','gone',(inf&&inf.data.length>=33&&inf.data[0]===1)?'still live':'gone')

  console.log('\n─── 5. round-4 fixes ───')
  const N=await mkVault()
  const n1=await att(()=>send([ixClose(N,alice.publicKey,bank.publicKey,declare(N.pda))],[bank,alice]))
  rec('5.1','close with NO preceding open (defaces provenance)','REJECT',n1.ok?'ALLOW':'REJECT',n1.err)
  const [nPda]=W.findProgramAddressSync([Buffer.from('mpl-core-execute'),N.asset.toBuffer()],CORE)
  const brickAsset=Keypair.generate()
  const [bPda]=W.findProgramAddressSync([Buffer.from('mpl-core-execute'),brickAsset.publicKey.toBuffer()],CORE)
  const n2=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('mint_vault'),str('BRICK'),str('u'),u64(BigInt(LAMPORTS_PER_SOL)),attrs([])]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:brickAsset.publicKey,isSigner:true,isWritable:true},
      {pubkey:COLL,isSigner:false,isWritable:true},{pubkey:bPda,isSigner:true,isWritable:false},
      {pubkey:bank.publicKey,isSigner:true,isWritable:false},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
      {pubkey:REVENUE,isSigner:false,isWritable:true},{pubkey:SEAL_CFG,isSigner:false,isWritable:false},
      {pubkey:MINT_AUTH,isSigner:false,isWritable:false},{pubkey:CORE,isSigner:false,isWritable:false},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[bank,brickAsset]))
  rec('5.2','mint a vault owned by a PDA that can never sign','REJECT',n2.ok?'ALLOW':'REJECT',n2.err)
  const n3=await att(()=>send([new TransactionInstruction({programId:BURN_PROG,
    data:Buffer.concat([d('burn_vault'),Buffer.from([2])]),keys:[
    {pubkey:N.asset,isSigner:false,isWritable:true},{pubkey:COLL,isSigner:false,isWritable:true},
    {pubkey:alice.publicKey,isSigner:true,isWritable:false},{pubkey:bank.publicKey,isSigner:true,isWritable:false},
    {pubkey:N.pda,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
    {pubkey:BURN_CFG,isSigner:false,isWritable:false},{pubkey:MINT_CFG,isSigner:false,isWritable:false},
    {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
    ...declare(N.pda).map(p=>({pubkey:p,isSigner:false,isWritable:true}))]})],[bank,alice]))
  rec('5.3','burn with a BOGUS seal_config account','REJECT',n3.ok?'ALLOW':'REJECT',n3.err)

  // ================= 6. round-5 fixes =================
  console.log('\n─── 6. round-5 fixes ───')

  // 6.1/6.2 — set_round can no longer express "unlimited, forever"
  const g3=await att(()=>send([setRound(now-60,now+3600,BigInt(0.05*LAMPORTS_PER_SOL),0,gov)],[gov]))
  rec('6.1','set_round with cap=0 (used to mean UNLIMITED)','REJECT',g3.ok?'ALLOW':'REJECT',g3.err)
  const g4=await att(()=>send([setRound(now-60,8640000000000000,BigInt(0),100,gov)],[gov]))
  rec('6.2','set_round with a window that never closes','REJECT',g4.ok?'ALLOW':'REJECT',g4.err)

  // 6.3 — provenance stamped at mint SURVIVES a redemption
  const P=await mkVault(SATS,[['charter','0042'],['notice','CBOB-NOTICE-0042']])
  const pa:any=await fetchAsset(umi,P.umiAsset)
  const asMap=(x:any)=>Object.fromEntries((x?.attributes?.attributeList||[]).map((e:any)=>[e.key,e.value]))
  const m0=asMap(pa)
  rec('6.3','provenance is stamped at mint','0042',String(m0.charter))
  const p1=await att(()=>send([ixOpen(P,alice.publicKey,bank.publicKey),...sweep(P,SATS,0),
    ixClose(P,alice.publicKey,bank.publicKey,declare(P.pda))],[bank,alice]))
  rec('6.4','redeem the charter vault','ALLOW',p1.ok?'ALLOW':'REJECT',p1.err)
  const m1=asMap(await fetchAsset(umi,P.umiAsset))
  rec('6.5','charter provenance SURVIVED the redemption','0042',String(m1.charter),
      `attributes now = ${JSON.stringify(m1)}`)
  rec('6.6','...and the notice serial too','CBOB-NOTICE-0042',String(m1.notice))
  rec('6.7','...and the redemption stamp was added','opened',String(m1.redemption))

  // 6.8 — the lifetime supply cap actually gates
  const lowered=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:wiring({maxSupply:1n}),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false},
      {pubkey:MINT_PROG,isSigner:false,isWritable:false}]})],[bank]))
  rec('6.8','ratchet max_supply DOWN below what is minted','REJECT',lowered.ok?'ALLOW':'REJECT',lowered.err)
  const raised=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:wiring({maxSupply:999999n}),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false},
      {pubkey:MINT_PROG,isSigner:false,isWritable:false}]})],[bank]))
  rec('6.9','RAISE max_supply above its initial value','REJECT',raised.ok?'ALLOW':'REJECT',raised.err)

  // 6.10 — treasury rotation needs governance, not admin alone
  const t1=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:wiring({treasury:alice.publicKey}),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false},
      {pubkey:MINT_PROG,isSigner:false,isWritable:false}]})],[bank]))
  rec('6.10','admin alone redirects the treasury (the 85%)','REJECT',t1.ok?'ALLOW':'REJECT',t1.err)
  const t2=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:wiring({treasury:treasury.publicKey}),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false},
      {pubkey:gov.publicKey,isSigner:true,isWritable:false}]})],[bank,gov]))
  rec('6.11','admin + governance rotate the treasury','ALLOW',t2.ok?'ALLOW':'REJECT',t2.err)

  // 6.12 — the payer's slippage guard
  const slipAsset=Keypair.generate()
  const s1=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('mint_vault'),str('SLIP'),str('u'),u64(1n),attrs([])]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:slipAsset.publicKey,isSigner:true,isWritable:true},
      {pubkey:COLL,isSigner:false,isWritable:true},{pubkey:alice.publicKey,isSigner:true,isWritable:false},
      {pubkey:bank.publicKey,isSigner:true,isWritable:false},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
      {pubkey:REVENUE,isSigner:false,isWritable:true},{pubkey:SEAL_CFG,isSigner:false,isWritable:false},
      {pubkey:MINT_AUTH,isSigner:false,isWritable:false},{pubkey:CORE,isSigner:false,isWritable:false},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[bank,slipAsset,alice]))
  rec('6.12','price rose above the payer\'s stated maximum','REJECT',s1.ok?'ALLOW':'REJECT',s1.err)

  // 6.13 — a Token-2022 reserve mint can never enter the config
  const t22=await createMint(conn,bank,bank.publicKey,null,6,undefined,{commitment:CM},TOKEN_2022_PROGRAM_ID)
  const r22=await att(()=>send([new TransactionInstruction({programId:SEAL_PROG,
    data:Buffer.concat([d('update_config'),Buffer.from([0]),Buffer.from([0]),
      Buffer.concat([Buffer.from([1]),u32(2),mint.toBuffer(),t22.toBuffer()])]),
    keys:[{pubkey:SEAL_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false},
      {pubkey:mint,isSigner:false,isWritable:false},{pubkey:t22,isSigner:false,isWritable:false}]})],[bank]))
  rec('6.13','add a Token-2022 reserve mint (would seal every vault)','REJECT',r22.ok?'ALLOW':'REJECT',r22.err)

  // ================= 6b. ROUND 6: the revenue path's on-chain bounds =========
  // Everything here is gated on the GOVERNANCE SIGNATURE, so it has to happen
  // while governance is still a keypair. Once section 7 hands governance to the
  // GOV program's PDA these become unreachable — which is itself asserted, at 7.18.
  console.log('\n─── 6b. the sweep bound, the operator, and the royalty plugin ───')
  const govWiring=(o:any)=>new TransactionInstruction({programId:MINT_PROG,data:wiring(o),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false},
      {pubkey:gov.publicKey,isSigner:true,isWritable:false}]})
  // THE OPERATOR SIGNS as of round 7. With a cooldown in place an unsigned sweep
  // is a permanent grief handle: anyone could sweep ZERO once per window, stamp
  // last_sweep_at, and starve the real cycle for a transaction fee.
  const sweepTo=(amt:bigint,dest:W)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('sweep_sol_for_swap'),u64(amt)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},
      {pubkey:REVENUE,isSigner:false,isWritable:true},{pubkey:dest,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  await send([SystemProgram.transfer({fromPubkey:bank.publicKey,toPubkey:REVENUE,lamports:3*LAMPORTS_PER_SOL})],[bank])

  // THE CAP. `bank/revenue.mjs` held a 50-SOL constant and a comment claiming a
  // compromised operator key "is capped at one cycle's worth rather than the
  // whole treasury". The instruction is permissionless, so that constant bound
  // nobody: anyone could push the entire balance above reserve in one call.
  const capLow=await att(()=>send([govWiring({maxSweep:1_000_000n})],[bank,gov]))
  rec('6.14','lower the on-chain sweep cap (admin + governance)','ALLOW',capLow.ok?'ALLOW':'REJECT',capLow.err)
  const overCap=await att(()=>send([sweepTo(2_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('6.15','sweep MORE than the on-chain cap','REJECT',overCap.ok?'ALLOW':'REJECT',overCap.err)
  const underCap=await att(()=>send([sweepTo(1_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('6.16','sweep exactly the cap','ALLOW',underCap.ok?'ALLOW':'REJECT',underCap.err)

  // A CAP WITH NO COOLDOWN IS NOT A CAP: the same caller just puts N sweeps in
  // one transaction and the cap becomes a step size. Proven in BOTH directions —
  // with the cooldown at zero this SUCCEEDS, which is the whole argument.
  // TWO SWEEPS IN ONE TRANSACTION SHARE A TIMESTAMP, so even the 1-second floor
  // refuses the second. That is the whole reason zero is no longer expressible:
  // a cap with no rate limit is a step size, and this is the step.
  const loop3=[sweepTo(1_000_000n,swapOp.publicKey),sweepTo(1_000_000n,swapOp.publicKey),
    sweepTo(1_000_000n,swapOp.publicKey)]
  const loopShut=await att(()=>send(loop3,[alice,swapOp]))
  rec('6.17','three sweeps in ONE transaction, each under the cap','REJECT',loopShut.ok?'ALLOW':'REJECT',loopShut.err)
  // A stranger cannot burn the window either: the destination has to sign.
  const stranger=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('sweep_sol_for_swap'),u64(1_000_000n)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:REVENUE,isSigner:false,isWritable:true},
      {pubkey:swapOp.publicKey,isSigner:false,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[alice]))
  rec('6.17a','a stranger sweeps without the operator signing','REJECT',stranger.ok?'ALLOW':'REJECT',stranger.err)
  const zeroSweep=await att(()=>send([sweepTo(0n,swapOp.publicKey)],[alice,swapOp]))
  rec('6.17b','a ZERO sweep, which moves nothing and burns the whole cooldown','REJECT',zeroSweep.ok?'ALLOW':'REJECT',zeroSweep.err)
  const coolUp=await att(()=>send([govWiring({sweepCooldown:3600})],[bank,gov]))
  rec('6.18','raise the sweep cooldown to an hour','ALLOW',coolUp.ok?'ALLOW':'REJECT',coolUp.err)
  const coolZero=await att(()=>send([govWiring({sweepCooldown:0})],[bank,gov]))
  rec('6.18a','set the cooldown to ZERO (the state the alarm calls CRITICAL)','REJECT',coolZero.ok?'ALLOW':'REJECT',coolZero.err)
  const tooSoon=await att(()=>send([sweepTo(1_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('6.19b','a single sweep inside the cooldown','REJECT',tooSoon.ok?'ALLOW':'REJECT',tooSoon.err)
  await send([govWiring({sweepCooldown:SWEEP_COOLDOWN,maxSweep:SWEEP_CAP})],[bank,gov])

  // THE GOVERNANCE GATE SPLITS BY DIRECTION, not by field.
  //
  // Round 6 made the operator rotatable and put it behind governance — and the
  // production wiring makes that signature unobtainable, because governance is a
  // PDA that can only sign a set_round. So the emergency response to a
  // compromised operator key was seven days away, while the attacker kept taking
  // max_sweep_lamports every cooldown. Replacing the operator cannot redirect
  // anyone's money (the SOL comes back to the same revenue address and is split
  // by the same rule), so it is admin's to do today. LOOSENING a bound is not.
  const adminOnly=(o:any)=>new TransactionInstruction({programId:MINT_PROG,data:wiring(o),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false},
      {pubkey:MINT_PROG,isSigner:false,isWritable:false}]})
  // THE OPERATOR ROTATION WAITS. Round 8 made it admin-only and immediate under
  // the argument that it "cannot redirect anyone's money". The operator address
  // is WHERE THE SWEPT SOL GOES, so that was plainly false: one signature plus a
  // permissionless sweep is the treasury. The immediate emergency response is
  // `set_paused`, which stops sweeps in the same transaction (8.12b).
  const newOp=Keypair.generate()
  const armedOpAt=Date.now()
  const rotOp=await att(()=>send([adminOnly({swapOperator:newOp.publicKey})],[bank]))
  rec('6.20','admin ARMS a swap-operator rotation','ALLOW',rotOp.ok?'ALLOW':'REJECT',rotOp.err)
  {
    const c=(await conn.getAccountInfo(MINT_CFG,CM))!
    rec('6.20e','the operator is UNCHANGED after arming',swapOp.publicKey.toBase58(),
      new W(c.data.subarray(256,288)).toBase58())
    rec('6.20f','the pending operator is on chain',newOp.publicKey.toBase58(),
      new W(c.data.subarray(449,481)).toBase58())
  }
  const tighten=await att(()=>send([adminOnly({maxSweep:500_000n})],[bank]))
  rec('6.20a','admin ALONE tightens the sweep cap','ALLOW',tighten.ok?'ALLOW':'REJECT',tighten.err)
  const loosen=await att(()=>send([adminOnly({maxSweep:SWEEP_CAP})],[bank]))
  rec('6.20b','admin ALONE LOOSENS the sweep cap','REJECT',loosen.ok?'ALLOW':'REJECT',loosen.err)
  const lengthen=await att(()=>send([adminOnly({sweepCooldown:600})],[bank]))
  rec('6.20c','admin ALONE LENGTHENS the cooldown','ALLOW',lengthen.ok?'ALLOW':'REJECT',lengthen.err)
  const shorten=await att(()=>send([adminOnly({sweepCooldown:SWEEP_COOLDOWN})],[bank]))
  rec('6.20d','admin ALONE SHORTENS it again','REJECT',shorten.ok?'ALLOW':'REJECT',shorten.err)
  await send([govWiring({sweepCooldown:SWEEP_COOLDOWN})],[bank,gov])
  const payMe=await att(()=>send([adminOnly({treasury:alice.publicKey})],[bank]))
  rec('6.21','admin ALONE redirects who gets paid','REJECT',payMe.ok?'ALLOW':'REJECT',payMe.err)
  await send([govWiring({maxSweep:SWEEP_CAP})],[bank,gov])
  const earlyNew=await att(()=>send([sweepTo(1_000_000n,newOp.publicKey)],[alice,newOp]))
  rec('6.22','sweep to the PENDING operator before the notice period','REJECT',earlyNew.ok?'ALLOW':'REJECT',earlyNew.err)
  // Wait the notice period out and land it. GOV_TIMELOCK is the floor and exists
  // only so this path can be exercised; production must be days.
  while(Date.now()-armedOpAt < (GOV_TIMELOCK+2)*1000) await new Promise(r=>setTimeout(r,1000))
  const applyOp=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:d('apply_pending_operator'),keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true}]})],[bank]))
  rec('6.23','apply the operator rotation once the notice period has elapsed','ALLOW',applyOp.ok?'ALLOW':'REJECT',applyOp.err)
  const oldOpSweep=await att(()=>send([sweepTo(1_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('6.23f','sweep to the OLD operator afterwards','REJECT',oldOpSweep.ok?'ALLOW':'REJECT',oldOpSweep.err)
  await new Promise(r=>setTimeout(r,2500))
  const newOpSweep=await att(()=>send([sweepTo(1_000_000n,newOp.publicKey)],[alice,newOp]))
  rec('6.23g','sweep to the NEW operator','ALLOW',newOpSweep.ok?'ALLOW':'REJECT',newOpSweep.err)
  // put it back for the rest of the suite
  await send([adminOnly({swapOperator:swapOp.publicKey})],[bank])
  await new Promise(r=>setTimeout(r,(GOV_TIMELOCK+2)*1000))
  await send([new TransactionInstruction({programId:MINT_PROG,
    data:d('apply_pending_operator'),keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true}]})],[bank])

  // The notice period on a governance rotation RATCHETS UP. Admin lowering its
  // own notice period would undo the point of having one; raising it is both a
  // hardening step and the repair for a launch value set at the testing floor.
  const tlUp=await att(()=>send([govWiring({govTimelock:GOV_TIMELOCK*2})],[bank,gov]))
  rec('6.23a','raise the governance notice period','ALLOW',tlUp.ok?'ALLOW':'REJECT',tlUp.err)
  const tlDown=await att(()=>send([govWiring({govTimelock:GOV_TIMELOCK})],[bank,gov]))
  rec('6.23b','LOWER the governance notice period','REJECT',tlDown.ok?'ALLOW':'REJECT',tlDown.err)
  const tlHuge=await att(()=>send([govWiring({govTimelock:400*24*3600})],[bank,gov]))
  rec('6.23c','...or set it so long it is its own denial of service','REJECT',tlHuge.ok?'ALLOW':'REJECT',tlHuge.err)
  const opNull=await att(()=>send([govWiring({swapOperator:new W('11111111111111111111111111111111')})],[bank,gov]))
  rec('6.23d','point the swap operator at the default pubkey','REJECT',opNull.ok?'ALLOW':'REJECT',opNull.err)
  const capZero=await att(()=>send([govWiring({maxSweep:0n})],[bank,gov]))
  rec('6.23e','set the sweep cap to zero','REJECT',capZero.ok?'ALLOW':'REJECT',capZero.err)

  // THE ROYALTY CPI. Hand-built, and until now the ONLY Core opcode in the
  // codebase never executed against real Core (CreateV2=20, BurnV1=12,
  // UpdatePluginV1=6 all are). An untested path is not a path.
  const ixRoy=(bps:number,add:boolean,admin:Keypair,g:Keypair)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('set_collection_royalties'),u16(bps),Buffer.from([add?1:0])]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:false},{pubkey:admin.publicKey,isSigner:true,isWritable:false},
      {pubkey:g.publicKey,isSigner:true,isWritable:false},{pubkey:COLL,isSigner:false,isWritable:true},
      {pubkey:admin.publicKey,isSigner:true,isWritable:true},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
      {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const royHigh=await att(()=>send([ixRoy(10_000,true,bank,gov)],[bank,gov]))
  rec('6.24','a 100% royalty (legal in the plugin, fatal to resale)','REJECT',royHigh.ok?'ALLOW':'REJECT',royHigh.err)
  const royNoGov=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('set_collection_royalties'),u16(500),Buffer.from([1])]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:false},{pubkey:bank.publicKey,isSigner:true,isWritable:false},
      {pubkey:alice.publicKey,isSigner:true,isWritable:false},{pubkey:COLL,isSigner:false,isWritable:true},
      {pubkey:bank.publicKey,isSigner:true,isWritable:true},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
      {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[bank,alice]))
  rec('6.25','royalties set WITHOUT the governance signature','REJECT',royNoGov.ok?'ALLOW':'REJECT',royNoGov.err)
  const royAdd=await att(()=>send([ixRoy(500,true,bank,gov)],[bank,gov]))
  rec('6.26','ADD the Royalties plugin to the collection (real Core CPI)','ALLOW',royAdd.ok?'ALLOW':'REJECT',royAdd.err)
  {
    const c=await fetchCollection(umi,coll.publicKey)
    const r:any=(c as any).royalties
    rec('6.27','Core decoded the basis points we wrote','500',String(r?.basisPoints ?? 'none'))
    // Every lamport of royalty goes through the same swap and the same enforced split.
    rec('6.28','the sole creator is THE revenue address at 100%',`${REVENUE.toBase58()}:100`,
      r?.creators?.length===1?`${r.creators[0].address}:${r.creators[0].percentage}`:'none')
  }
  const royUpd=await att(()=>send([ixRoy(750,false,bank,gov)],[bank,gov]))
  rec('6.29','UPDATE the existing Royalties plugin (the other opcode)','ALLOW',royUpd.ok?'ALLOW':'REJECT',royUpd.err)
  {
    const c=await fetchCollection(umi,coll.publicKey)
    rec('6.30','...and Core decoded the new value','750',String((c as any).royalties?.basisPoints ?? 'none'))
  }

  // The one-year round bound is computed on caller-supplied timestamps that can
  // straddle the whole i64 range. It used to be a plain `-`, safe only because
  // the workspace sets `overflow-checks = true` — a bound resting on a build
  // profile nothing in the program asserts. Now it is `checked_sub`, so the
  // refusal is the program's own and this test names it.
  const ovf=await att(()=>send([setRound(-1,9223372036854775807n,0n,10,gov)],[gov]))
  rec('6.31','set_round with opens_at=-1 and closes_at=i64::MAX','REJECT',ovf.ok?'ALLOW':'REJECT',ovf.err)

  // THE ALARM'S APPROVE DETECTOR keys on `parsed.info.owner`. If a parser version
  // did not emit that field, `pdaSet.has(undefined)` is false and the detector
  // becomes a no-op that still passes its own synthetic selftest. Measure it
  // against the REAL parser rather than assuming.
  {
    const probeAta=ata(alice.publicKey)
    const sig=await send([createApproveInstruction(probeAta,bank.publicKey,alice.publicKey,1n)],[alice])
    const tx=await conn.getParsedTransaction(sig,{commitment:CM,maxSupportedTransactionVersion:0})
    const ix:any=(tx!.transaction.message.instructions as any[]).find(i=>i.parsed?.type==='approve')
    // The alarm resolves the owner from the ACCOUNT as a fallback, but this is
    // the primary path and it should be measured, not assumed.
    rec('6.32','a REAL jsonParsed approve carries info.owner','true',String(!!ix?.parsed?.info?.owner))
  }

  // ROTATIONS WAIT, IN EVERY PROGRAM. Round 7 gave MINT a notice period on its
  // admin and governance and stopped there — and SEAL is the program whose whole
  // claim is TRUE 2-of-2: one admin signature used to set config.bank to an
  // attacker key in a single transaction, and the Bank's refusal is what stops a
  // seller planting a delegate during a thaw and then selling the vault.
  const sealRot=await att(()=>send([new TransactionInstruction({programId:SEAL_PROG,
    data:Buffer.concat([d('update_config'),SOME(alice.publicKey.toBuffer()),NONE,NONE]),
    keys:[{pubkey:SEAL_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false}]})],[bank]))
  rec('6.33','SEAL: arm a Bank rotation','ALLOW',sealRot.ok?'ALLOW':'REJECT',sealRot.err)
  {
    const c=(await conn.getAccountInfo(SEAL_CFG,CM))!
    const n=c.data.readUInt32LE(105), after=109+n*32
    rec('6.33a','SEAL: the Bank is UNCHANGED after arming',bank.publicKey.toBase58(),
      new W(c.data.subarray(73,105)).toBase58())
    rec('6.33b','SEAL: the pending Bank is on chain',alice.publicKey.toBase58(),
      new W(c.data.subarray(after,after+32)).toBase58())
  }
  const sealEarly=await att(()=>send([new TransactionInstruction({programId:SEAL_PROG,
    data:d('apply_pending'),keys:[{pubkey:SEAL_CFG,isSigner:false,isWritable:true}]})],[bank]))
  rec('6.33c','SEAL: apply it before the notice period','REJECT',sealEarly.ok?'ALLOW':'REJECT',sealEarly.err)
  const sealCancel=await att(()=>send([new TransactionInstruction({programId:SEAL_PROG,
    data:d('cancel_pending'),
    keys:[{pubkey:SEAL_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false}]})],[bank]))
  rec('6.33d','SEAL: the current admin cancels it','ALLOW',sealCancel.ok?'ALLOW':'REJECT',sealCancel.err)
  {
    const c=(await conn.getAccountInfo(SEAL_CFG,CM))!
    rec('6.33e','SEAL: the Bank is STILL unchanged',bank.publicKey.toBase58(),
      new W(c.data.subarray(73,105)).toBase58())
  }

  // A reserve between zero and rent exemption wedges every sweep forever: the
  // transfer would leave a rent-paying account and the runtime refuses it.
  const badReserve=await att(()=>send([govWiring({solReserve:1000n})],[bank,gov]))
  rec('6.34','a SOL reserve between zero and rent exemption','REJECT',badReserve.ok?'ALLOW':'REJECT',badReserve.err)
  const okReserve=await att(()=>send([govWiring({solReserve:BigInt(0.05*LAMPORTS_PER_SOL)})],[bank,gov]))
  rec('6.34a','a reserve above rent exemption','ALLOW',okReserve.ok?'ALLOW':'REJECT',okReserve.err)

  // A REJECT for the wrong reason is a FALSE PASS. 6.8/6.9/6.10 originally
  // "passed" on AccountNotEnoughKeys — Anchor bouncing a short account list
  // before the handler ran — so they proved nothing about the supply cap.
  const because=(id:string,code:string)=>{const r=R.find(x=>x.id===id)
    const hit=(r?.n||'').includes(code); R.push({id:id+'!',t:`  ↳ rejected because ${code}`,want:'true',got:String(hit),ok:hit,n:r?.n})
    console.log(`  ${hit?'ok  ':'XX  '}${id}!  rejected because ${code}  [got ${hit}]`)}
  console.log('\n─── 6b. the negative tests rejected for the RIGHT reason ───')
  because('6.1','BadCap'); because('6.2','BadWindow')
  because('6.8','BadSupplyCap'); because('6.9','BadSupplyCap')
  because('6.10','TreasuryNeedsGovernance'); because('6.12','PriceAboveMax')
  because('6.15','SweepAboveCap'); because('6.17','SweepTooSoon'); because('6.19b','SweepTooSoon')
  because('6.17a','AccountNotSigner'); because('6.17b','SweepAboveCap')
  because('6.18a','BadSweepBound')
  because('6.20b','TreasuryNeedsGovernance'); because('6.20d','TreasuryNeedsGovernance')
  because('6.22','WrongTreasury'); because('6.23f','WrongTreasury')
  because('6.21','TreasuryNeedsGovernance')
  because('6.23b','BadGovernanceRotation'); because('6.23c','BadGovernanceRotation')
  because('6.23d','WrongTreasury'); because('6.23e','BadSweepBound')
  because('6.33c','NothingPending'); because('6.34','BadSweepBound')
  because('6.24','BadRoyalty'); because('6.25','TreasuryNeedsGovernance')
  // The one-year bound is only safe because the workspace sets overflow-checks.
  because('6.31','BadWindow')
  because('6.13','ReserveMintNotClassicSpl'); because('5.3','BadSealConfig')


  // ================= 7. GOVERNANCE: one vault, one vote =================
  console.log('\n─── 7. governance program (per-vault voting, vote bound to the ASSET) ───')
  const VOTE_SECS=60
  const gi=await att(()=>send([new TransactionInstruction({programId:GOV_PROG,
    data:Buffer.concat([d('initialize'),COLL.toBuffer(),u16(3000),u16(6000),i64(VOTE_SECS)]),
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[bank]))
  rec('7.1','governance program initialised','ALLOW',gi.ok?'ALLOW':'REJECT',gi.err)

  // MINT must name the GOV program's PDA as its governance authority
  // ---- 7.2 THE GOVERNANCE ROTATION TIMELOCK ----
  // Admin alone used to become governance in ONE instruction and could then
  // co-sign every governance-gated change a moment later, which made "rotating
  // the treasury requires governance" a control over nothing. Arming is admin;
  // applying is a clock.
  const throwaway=Keypair.generate()
  const arm=(target:W)=>new TransactionInstruction({programId:MINT_PROG, data:wiring({governance:target}),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false},
      {pubkey:MINT_PROG,isSigner:false,isWritable:false}]})
  const applyGov=()=>new TransactionInstruction({programId:MINT_PROG, data:d('apply_pending_governance'),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true}]})
  const cancelGov=()=>new TransactionInstruction({programId:MINT_PROG, data:d('cancel_pending_governance'),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false}]})

  const rot=await att(()=>send([arm(throwaway.publicKey)],[bank]))
  rec('7.2','admin ARMS a governance rotation','ALLOW',rot.ok?'ALLOW':'REJECT',rot.err)
  {
    const c=(await conn.getAccountInfo(MINT_CFG,CM))!
    rec('7.2a','governance is UNCHANGED immediately after arming',gov.publicKey.toBase58(),
      new W(c.data.subarray(105,137)).toBase58())
    rec('7.2b','the pending value is on chain for anyone to read',throwaway.publicKey.toBase58(),
      new W(c.data.subarray(321,353)).toBase58())
  }
  const early=await att(()=>send([applyGov()],[bank]))
  rec('7.2c','apply the rotation BEFORE the notice period elapses','REJECT',early.ok?'ALLOW':'REJECT',early.err)
  const cancel=await att(()=>send([cancelGov()],[bank]))
  rec('7.2d','admin cancels an armed rotation','ALLOW',cancel.ok?'ALLOW':'REJECT',cancel.err)
  const cancel2=await att(()=>send([cancelGov()],[bank]))
  rec('7.2e','cancel again with nothing armed','REJECT',cancel2.ok?'ALLOW':'REJECT',cancel2.err)
  const notAdmin=await att(()=>send([new TransactionInstruction({programId:MINT_PROG, data:wiring({governance:GOV_PDA}),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:alice.publicKey,isSigner:true,isWritable:false},
      {pubkey:MINT_PROG,isSigner:false,isWritable:false}]})],[alice]))
  rec('7.2f','a NON-admin arms a governance rotation','REJECT',notAdmin.ok?'ALLOW':'REJECT',notAdmin.err)

  // Arm the real one now; it needs GOV_TIMELOCK seconds, which elapse while the
  // proposal below is being voted on. Applied just before execute_proposal.
  const rot2=await att(()=>send([arm(GOV_PDA)],[bank]))
  rec('7.2g','arm the rotation to the GOV program PDA','ALLOW',rot2.ok?'ALLOW':'REJECT',rot2.err)
  // Read the DEADLINE the program actually wrote, not a constant this file holds.
  // 6.23a raised the notice period, so a local `GOV_TIMELOCK + 2` would have
  // waited less than the program requires and 7.2h would have failed for a
  // reason that had nothing to do with what it tests.
  const effectiveAt=Number((await conn.getAccountInfo(MINT_CFG,CM))!.data.readBigInt64LE(353))

  const ixGovCfg=(o:any,signer:Keypair)=>new TransactionInstruction({programId:GOV_PROG,
    data:Buffer.concat([d('update_gov_config'),
      o.quorum!==undefined?SOME(u16(o.quorum)):NONE, o.threshold!==undefined?SOME(u16(o.threshold)):NONE,
      o.minVoting!==undefined?SOME(i64(o.minVoting)):NONE, o.admin?SOME(o.admin.toBuffer()):NONE]),
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false}]})

  const A=await mkVault(0n), B=await mkVault(0n)
  const propId=(n:number)=>W.findProgramAddressSync([Buffer.from('proposal'),u64(n)],GOV_PROG)[0]
  const nowG=Math.floor(Date.now()/1000)
  /** The next proposal id, read off the config. Hardcoding it breaks the moment
   *  a create fails, because `proposal_count` only advances on success. */
  const nextProp=async()=>{const c=await conn.getAccountInfo(GOV_CFG,CM)
    return Number(c!.data.readBigUInt64LE(85))+1}
  const propNow=()=>Math.floor(Date.now()/1000)
  const ixProp=(id:number,asset:W,who:Keypair,ends:number,cap=50)=>new TransactionInstruction({programId:GOV_PROG,
    data:Buffer.concat([d('create_proposal'),i64(nowG+120),i64(nowG+7200),u64(BigInt(0.02*LAMPORTS_PER_SOL)),u32(cap),i64(ends)]),
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:true},{pubkey:propId(id),isSigner:false,isWritable:true},
      {pubkey:MINT_CFG,isSigner:false,isWritable:false},
      {pubkey:asset,isSigner:false,isWritable:false},{pubkey:who.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const gp1=await att(()=>send([ixProp(1,A.asset,alice,nowG+VOTE_SECS+5)],[alice]))
  rec('7.3','a vault holder creates a proposal','ALLOW',gp1.ok?'ALLOW':'REJECT',gp1.err)
  const gp2=await att(()=>send([ixProp(2,A.asset,bank,nowG+VOTE_SECS+5)],[bank]))
  rec('7.4','a NON-holder creates a proposal','REJECT',gp2.ok?'ALLOW':'REJECT',gp2.err)

  const voteRec=(prop:W,asset:W)=>W.findProgramAddressSync([Buffer.from('vote'),prop.toBuffer(),asset.toBuffer()],GOV_PROG)[0]
  const ixVote=(prop:W,v:any,who:Keypair,support:boolean)=>new TransactionInstruction({programId:GOV_PROG,
    data:Buffer.concat([d('cast_vote'),Buffer.from([support?1:0])]),
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:false},{pubkey:prop,isSigner:false,isWritable:true},
      {pubkey:voteRec(prop,v.asset),isSigner:false,isWritable:true},{pubkey:v.asset,isSigner:false,isWritable:false},
      {pubkey:who.publicKey,isSigner:true,isWritable:false},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const P1=propId(1)
  const v0=await att(()=>send([ixVote(P1,A,bank,true)],[bank]))
  rec('7.5','a NON-owner votes with someone else\'s vault','REJECT',v0.ok?'ALLOW':'REJECT',v0.err)
  const v1=await att(()=>send([ixVote(P1,A,alice,true)],[bank,alice]))
  rec('7.6','the owner votes','ALLOW',v1.ok?'ALLOW':'REJECT',v1.err)
  const v2=await att(()=>send([ixVote(P1,A,alice,true)],[bank,alice]))
  rec('7.7','the SAME vault votes twice','REJECT',v2.ok?'ALLOW':'REJECT',v2.err)

  // THE BINDING: transfer the voted vault, then have the NEW owner vote again.
  const carol=Keypair.generate()
  await conn.confirmTransaction({signature:await conn.requestAirdrop(carol.publicKey,5*LAMPORTS_PER_SOL),
    ...(await conn.getLatestBlockhash())},CM)
  const xfer=await att(()=>transfer(umi,{asset:{publicKey:A.umiAsset,owner:aliceU.publicKey} as any,
    collection:{publicKey:coll.publicKey} as any,newOwner:pk(carol.publicKey.toBase58()),authority:aliceU})
    .sendAndConfirm(umi,{confirm:{commitment:CM}}))
  rec('7.8','transfer the already-voted vault to a new owner','ALLOW',xfer.ok?'ALLOW':'REJECT',xfer.err)
  const v3=await att(()=>send([ixVote(P1,A,carol,true)],[bank,carol]))
  rec('7.9','NEW owner votes again with the same vault (double-vote by transfer)','REJECT',v3.ok?'ALLOW':'REJECT',v3.err)

  const v4=await att(()=>send([ixVote(P1,B,alice,true)],[bank,alice]))
  rec('7.10','a DIFFERENT vault votes on the same proposal','ALLOW',v4.ok?'ALLOW':'REJECT',v4.err)

  const ixExec=(prop:W)=>new TransactionInstruction({programId:GOV_PROG,data:Buffer.from(d('execute_proposal')),
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:true},{pubkey:prop,isSigner:false,isWritable:true},
      {pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:GOV_PDA,isSigner:false,isWritable:false},
      {pubkey:MINT_PROG,isSigner:false,isWritable:false}]})
  const e0=await att(()=>send([ixExec(P1)],[bank]))
  rec('7.11','execute while voting is still open','REJECT',e0.ok?'ALLOW':'REJECT',e0.err)

  const gp3=await att(()=>send([ixProp(2,B.asset,alice,nowG+VOTE_SECS+5)],[alice]))
  rec('7.12','a second proposal, which nobody will vote on','ALLOW',gp3.ok?'ALLOW':'REJECT',gp3.err)

  // A PROPOSAL WHOSE ROUND IS ALREADY OVER. `set_round` only checks
  // `closes_at > opens_at`, so a ratified proposal could install a window that
  // had already expired — wiping the live round and stopping the sale on a
  // technicality. This is the testable half of "a passed proposal is not a
  // bearer instrument"; the 7-day execution deadline is the other half and is
  // NOT exercised here, for the obvious reason.
  const ixPropPast=(id:number,asset:W,who:Keypair,ends:number)=>new TransactionInstruction({programId:GOV_PROG,
    data:Buffer.concat([d('create_proposal'),i64(nowG-600),i64(nowG-300),u64(0n),u32(10),i64(ends)]),
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:true},{pubkey:propId(id),isSigner:false,isWritable:true},
      {pubkey:MINT_CFG,isSigner:false,isWritable:false},
      {pubkey:asset,isSigner:false,isWritable:false},{pubkey:who.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const gp4=await att(()=>send([ixPropPast(3,A.asset,carol,nowG+VOTE_SECS+5)],[carol]))
  rec('7.12a','a proposal for a round that has ALREADY closed can be created','ALLOW',gp4.ok?'ALLOW':'REJECT',gp4.err)
  const P3=propId(3)
  await att(()=>send([ixVote(P3,A,carol,true)],[bank,carol]))
  await att(()=>send([ixVote(P3,B,alice,true)],[bank,alice]))

  // TWO MORE RATIFIED PROPOSALS, so execution order can be tested. Each set_round
  // resets minted_this_round, so an older proposal executed after a newer one both
  // reinstates a superseded decision and hands the round its cap again.
  const idP4=await nextProp()
  await att(()=>send([ixProp(idP4,A.asset,carol,propNow()+VOTE_SECS+5)],[carol]))
  const idP5=await nextProp()
  await att(()=>send([ixProp(idP5,A.asset,carol,propNow()+VOTE_SECS+5)],[carol]))
  for(const id of [idP4,idP5]){
    await att(()=>send([ixVote(propId(id),A,carol,true)],[bank,carol]))
    await att(()=>send([ixVote(propId(id),B,alice,true)],[bank,alice]))
  }

  // THE TALLY RULE TRAVELS WITH THE PROPOSAL. Raise quorum to 100%, open a
  // proposal under it, cast one vote, then lower quorum to almost nothing. If the
  // rule were read at execute — as it was until round 7 — one admin signature and
  // one vault would ratify anything.
  await send([ixGovCfg({quorum:10_000},bank)],[bank])
  const idP6=await nextProp()
  const gp6=await att(()=>send([ixProp(idP6,A.asset,carol,propNow()+VOTE_SECS+5)],[carol]))
  rec('7.12b','a proposal opened while quorum is 100%','ALLOW',gp6.ok?'ALLOW':'REJECT',gp6.err)
  await att(()=>send([ixVote(propId(idP6),A,carol,true)],[bank,carol]))
  const qLower=await att(()=>send([ixGovCfg({quorum:MIN_QUORUM},bank)],[bank]))
  rec('7.12c','admin lowers quorum to the FLOOR after that proposal was voted','ALLOW',qLower.ok?'ALLOW':'REJECT',qLower.err)

  // A PRE-FUNDED PDA. Round 7 was told this bricks proposal creation forever,
  // because Anchor `init` cannot allocate an account that already holds lamports.
  // Settle it by DOING it rather than by reasoning about Anchor.
  const idP7=await nextProp()
  await send([SystemProgram.transfer({fromPubkey:bank.publicKey,toPubkey:propId(idP7),lamports:2_000_000})],[bank])
  const gp7=await att(()=>send([ixProp(idP7,A.asset,carol,propNow()+VOTE_SECS+5)],[carol]))
  rec('7.12d','create a proposal at a PDA a griefer pre-funded','ALLOW',gp7.ok?'ALLOW':'REJECT',gp7.err)

  // A QUORUM THAT ROUNDS DOWN TO NOTHING IS NOT A QUORUM. `supply * bps / 10000`
  // floored, so at 1 basis point against a few hundred vaults `need` was ZERO and
  // `cast > 0` was the only surviving requirement. This proposal is opened at 1bp
  // with NO votes at all: under flooring it would have ratified.
  const qFloor=await att(()=>send([ixGovCfg({quorum:1},bank)],[bank]))
  rec('7.12e','set quorum to 1 basis point (arithmetic, not policy)','REJECT',qFloor.ok?'ALLOW':'REJECT',qFloor.err)
  await send([ixGovCfg({quorum:500},bank)],[bank])
  const idP8=await nextProp()
  const gp8=await att(()=>send([ixProp(idP8,A.asset,carol,propNow()+VOTE_SECS+5)],[carol]))
  rec('7.12f','a proposal opened at the quorum FLOOR','ALLOW',gp8.ok?'ALLOW':'REJECT',gp8.err)
  await send([ixGovCfg({quorum:3000},bank)],[bank])

  const waitMs=(nowG+VOTE_SECS+8)*1000-Date.now()
  console.log(`  (waiting ${Math.max(0,Math.round(waitMs/1000))}s for the voting window to close — the execute path is worth actually running)`)
  if(waitMs>0) await new Promise(r=>setTimeout(r,waitMs))

  // The notice period has been ticking since 7.2g. Land it BEFORE the execute
  // tests: `execute_proposal` confirms MINT still names this program as its
  // governance authority before it looks at quorum, so with the rotation still
  // pending, 7.13 would reject for that reason instead of the one it is testing.
  while(Math.floor(Date.now()/1000) <= effectiveAt+1) await new Promise(r=>setTimeout(r,1000))
  const ap=await att(()=>send([applyGov()],[bank]))
  rec('7.2h','apply the rotation once the notice period HAS elapsed','ALLOW',ap.ok?'ALLOW':'REJECT',ap.err)
  {
    const c=(await conn.getAccountInfo(MINT_CFG,CM))!
    rec('7.2i','governance is now the GOV program PDA',GOV_PDA.toBase58(),
      new W(c.data.subarray(105,137)).toBase58())
    rec('7.2j','...and the pending slot is cleared','11111111111111111111111111111111',
      new W(c.data.subarray(321,353)).toBase58())
  }
  const applyAgain=await att(()=>send([applyGov()],[bank]))
  rec('7.2k','apply again with nothing armed','REJECT',applyAgain.ok?'ALLOW':'REJECT',applyAgain.err)

  // ADMIN IS TIMELOCKED TOO. It holds the CANCEL on a governance rotation, so an
  // instant admin swap would take the remedy away before it was needed — the
  // round-6 timelock was disarmable through the field beside it.
  const armAdmin=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:wiring({admin:alice.publicKey}),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false},
      {pubkey:MINT_PROG,isSigner:false,isWritable:false}]})],[bank]))
  rec('7.2l','admin arms an ADMIN rotation','ALLOW',armAdmin.ok?'ALLOW':'REJECT',armAdmin.err)
  {
    const c=(await conn.getAccountInfo(MINT_CFG,CM))!
    rec('7.2m','admin is UNCHANGED immediately after arming',bank.publicKey.toBase58(),
      new W(c.data.subarray(9,41)).toBase58())
    rec('7.2n','and the pending admin is on chain',alice.publicKey.toBase58(),
      new W(c.data.subarray(369,401)).toBase58())
  }
  const applyAdminEarly=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:d('apply_pending_admin'),keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true}]})],[bank]))
  rec('7.2o','apply the ADMIN rotation before the notice period','REJECT',applyAdminEarly.ok?'ALLOW':'REJECT',applyAdminEarly.err)
  const cancelAdmin=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:d('cancel_pending_admin'),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false}]})],[bank]))
  rec('7.2p','the CURRENT admin cancels it','ALLOW',cancelAdmin.ok?'ALLOW':'REJECT',cancelAdmin.err)

  const cfgBefore=await conn.getAccountInfo(MINT_CFG,CM)
  const roundBefore=cfgBefore!.data.readUInt32LE(169)
  const e1=await att(()=>send([ixExec(propId(2))],[bank]))
  rec('7.13','execute a proposal with ZERO votes','REJECT',e1.ok?'ALLOW':'REJECT',e1.err)
  const e1b=await att(()=>send([ixExec(P3)],[bank]))
  rec('7.13a','execute a RATIFIED proposal whose round already closed','REJECT',e1b.ok?'ALLOW':'REJECT',e1b.err)
  const e6=await att(()=>send([ixExec(propId(idP6))],[bank]))
  rec('7.13b','execute under a quorum lowered AFTER the votes were cast','REJECT',e6.ok?'ALLOW':'REJECT',e6.err)
  const e8=await att(()=>send([ixExec(propId(idP8))],[bank]))
  rec('7.13c','execute a floor-quorum proposal with ZERO votes','REJECT',e8.ok?'ALLOW':'REJECT',e8.err)

  // THE OTHER HALF OF THE SAME FINDING. `update_wiring`'s governance gate takes a
  // top-level Signer, and a PDA has no key — so once governance IS the GOV
  // program's PDA, every governance-gated setter is unreachable and the only
  // route back is the rotation timelock above. That is a real, permanent
  // property of this wiring and it is asserted here rather than discovered.
  const afterRot=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:wiring({treasury:alice.publicKey}),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false},
      {pubkey:GOV_PDA,isSigner:false,isWritable:false}]})],[bank]))
  // The escape hatch is the 7.2 timelock: deliberately slow and deliberately public.
  rec('7.18','rotate the treasury once governance is a PDA that cannot sign','REJECT',
    afterRot.ok?'ALLOW':'REJECT',afterRot.err)

  // GOVERNANCE PARAMETERS WERE FROZEN AT GENESIS. `GovConfig.admin` was written
  // and never read, and nothing could change quorum, threshold or the voting
  // period — so a config initialised at the 60-second testing floor would have
  // been permanently capturable with no remedy short of a program upgrade.
  const gcNotAdmin=await att(()=>send([ixGovCfg({minVoting:86400},alice)],[alice]))
  rec('7.19','a NON-admin changes the governance parameters','REJECT',gcNotAdmin.ok?'ALLOW':'REJECT',gcNotAdmin.err)
  const gcUp=await att(()=>send([ixGovCfg({minVoting:3*86400,threshold:7000},bank)],[bank]))
  rec('7.20','admin RAISES the voting period and the YES threshold','ALLOW',gcUp.ok?'ALLOW':'REJECT',gcUp.err)
  const gcDown=await att(()=>send([ixGovCfg({minVoting:60},bank)],[bank]))
  // A ratchet: it can be repaired upward, never weakened.
  rec('7.21','admin LOWERS the voting period back to the floor','REJECT',gcDown.ok?'ALLOW':'REJECT',gcDown.err)
  const thDown=await att(()=>send([ixGovCfg({threshold:5100},bank)],[bank]))
  rec('7.22','admin LOWERS the YES threshold','REJECT',thDown.ok?'ALLOW':'REJECT',thDown.err)
  // Quorum is the deliberate exception: the divisor is supply ever MINTED, which
  // never falls, while burns remove voters — so a quorum that could only ratchet
  // up is a governance system with an expiry date.
  const qDown=await att(()=>send([ixGovCfg({quorum:1000},bank)],[bank]))
  rec('7.23','admin LOWERS the quorum (the documented exception)','ALLOW',qDown.ok?'ALLOW':'REJECT',qDown.err)
  const qZero=await att(()=>send([ixGovCfg({quorum:0},bank)],[bank]))
  rec('7.24','...but not below the floor','REJECT',qZero.ok?'ALLOW':'REJECT',qZero.err)
  // Maximum safety is deadlock: at 100% one NO vote ends governance for good,
  // and set_round has no caller but a ratified proposal.
  const thMax=await att(()=>send([ixGovCfg({threshold:10_000},bank)],[bank]))
  rec('7.24a','admin ratchets the YES threshold to unanimity','REJECT',thMax.ok?'ALLOW':'REJECT',thMax.err)
  await send([ixGovCfg({quorum:3000},bank)],[bank])
  const e2=await att(()=>send([ixExec(P1)],[bank]))
  rec('7.14','execute a ratified proposal','ALLOW',e2.ok?'ALLOW':'REJECT',e2.err)
  const cfgAfter=await conn.getAccountInfo(MINT_CFG,CM)
  rec('7.15','MINT round_id advanced (the vote actually set the round)',String(roundBefore+1),
      String(cfgAfter!.data.readUInt32LE(169)))
  rec('7.16','MINT price is now the proposal price',String(0.02*LAMPORTS_PER_SOL),
      String(Number(cfgAfter!.data.readBigUInt64LE(189))))
  const e3=await att(()=>send([ixExec(P1)],[bank]))
  rec('7.17','execute the same proposal twice','REJECT',e3.ok?'ALLOW':'REJECT',e3.err)

  // EXECUTION ONLY MOVES FORWARD. Two proposals passed; the later one is the
  // decision, and the earlier one must not be able to reinstate itself later —
  // each set_round resets minted_this_round, so replaying an old ratification
  // both revives a superseded price and hands the round its cap again.
  const e5=await att(()=>send([ixExec(propId(idP5))],[bank]))
  rec('7.25','execute the NEWER of two ratified proposals','ALLOW',e5.ok?'ALLOW':'REJECT',e5.err)
  const e4=await att(()=>send([ixExec(propId(idP4))],[bank]))
  rec('7.26','then execute the OLDER one','REJECT',e4.ok?'ALLOW':'REJECT',e4.err)

  // ================= 8. REVENUE: one address in, 85/15 out =================
  console.log('\n─── 8. revenue: one address in, enforced 85/15 out ───')
  const holdersAta=getAssociatedTokenAddressSync(mint,treasury.publicKey,true)
  const bankAta=getAssociatedTokenAddressSync(mint,bankTreasury.publicKey,true)
  const revAta=getAssociatedTokenAddressSync(mint,REVENUE,true)
  await send([createAssociatedTokenAccountIdempotentInstruction(bank.publicKey,revAta,REVENUE,mint),
              createAssociatedTokenAccountIdempotentInstruction(bank.publicKey,holdersAta,treasury.publicKey,mint),
              createAssociatedTokenAccountIdempotentInstruction(bank.publicKey,bankAta,bankTreasury.publicKey,mint)],[bank])
  const INCOME=1_000_000_000n   // stands in for swapped cbBTC arriving from any source
  await send([createTransferInstruction(ata(bank.publicKey),revAta,bank.publicKey,INCOME)],[bank])
  const bal=async(x:W)=>BigInt((await conn.getTokenAccountBalance(x,CM)).value.amount)
  rec('8.1','income arrived at the revenue address',String(INCOME),String(await bal(revAta)))
  const ixSplit=new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('split_revenue'),Buffer.from([8])]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:false},{pubkey:REVENUE,isSigner:false,isWritable:true},
      {pubkey:mint,isSigner:false,isWritable:false},{pubkey:revAta,isSigner:false,isWritable:true},
      {pubkey:holdersAta,isSigner:false,isWritable:true},{pubkey:bankAta,isSigner:false,isWritable:true},
      {pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false}]})
  // permissionless on purpose: alice has no role here at all
  const sp=await att(()=>send([ixSplit],[alice]))
  rec('8.2','ANYONE can trigger the split (destinations are pinned)','ALLOW',sp.ok?'ALLOW':'REJECT',sp.err)
  rec('8.3','holders received exactly 85%',String(INCOME*85n/100n),String(await bal(holdersAta)))
  rec('8.4','the Bank received exactly 15%',String(INCOME*15n/100n),String(await bal(bankAta)))
  rec('8.5','nothing was left behind or created','0',String(await bal(revAta)))
  const sp2=await att(()=>send([ixSplit],[alice]))
  rec('8.6','splitting an empty revenue address','REJECT',sp2.ok?'ALLOW':'REJECT',sp2.err)

  // THE ROUNDING GOES TO THE HOLDERS. The comment on split_revenue said integer
  // division "can never round in the Bank's favour" while the code computed the
  // holders' share first and handed the Bank the REMAINDER — i.e. the Bank
  // collected every rounding remainder, and at a balance of 1 it collected all
  // of it. Dust either way; a rule stated backwards is worth correcting anyway.
  {
    const before={h:await bal(holdersAta),b:await bal(bankAta)}
    await send([createTransferInstruction(ata(bank.publicKey),revAta,bank.publicKey,7n)],[bank])
    const spr=await att(()=>send([ixSplit],[alice]))
    rec('8.6a','split an amount that does NOT divide evenly','ALLOW',spr.ok?'ALLOW':'REJECT',spr.err)
    // 7 * 1500/10000 = 1.05 -> Bank floors to 1, holders take the remaining 6.
    rec('8.6b','the Bank takes the FLOOR of its 15%','1',String(await bal(bankAta)-before.b))
    rec('8.6c','the holders take the remainder, including the rounding','6',
      String(await bal(holdersAta)-before.h))
    rec('8.6d','and the two still sum to the whole balance','7',
      String((await bal(bankAta)-before.b)+(await bal(holdersAta)-before.h)))
  }

  // the SOL reserve must survive a sweep
  const ixSweep=(amt:bigint,_s?:Keypair,dest:W=swapOp.publicKey)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('sweep_sol_for_swap'),u64(amt)]),
    // WRITABLE: the cooldown is stamped into config. A rate limit that is not
    // written down is not a rate limit. And the destination SIGNS.
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},
      {pubkey:REVENUE,isSigner:false,isWritable:true},{pubkey:dest,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  await new Promise(r=>setTimeout(r,2500))
  const revSol=BigInt(await conn.getBalance(REVENUE,CM))
  const w1=await att(()=>send([ixSweep(revSol,bank)],[bank,swapOp]))
  rec('8.7','sweeping SOL that would breach the fee reserve','REJECT',w1.ok?'ALLOW':'REJECT',w1.err)
  const safe=revSol-BigInt(0.05*LAMPORTS_PER_SOL)
  await new Promise(r=>setTimeout(r,2500))
  const opBefore=BigInt(await conn.getBalance(swapOp.publicKey,CM))
  const w2=await att(()=>send([ixSweep(safe>0n?safe:0n,bank)],[bank,swapOp]))
  rec('8.8','sweeping what the reserve allows','ALLOW',w2.ok?'ALLOW':'REJECT',w2.err)
  rec('8.9','the operator received it',String(safe>0n?safe:0n),
    String(BigInt(await conn.getBalance(swapOp.publicKey,CM))-opBefore))
  // permissionless BY DESIGN, so the property to prove is that the DESTINATION
  // cannot be chosen: a stranger sweeping can only move our SOL to our operator.
  const w3=await att(()=>send([ixSweep(1n,alice,alice.publicKey)],[alice]))
  rec('8.10','sweeping SOL to an address of the caller\'s choosing','REJECT',w3.ok?'ALLOW':'REJECT',w3.err)
  // 8.8 already swept down to the reserve, so top the address up first: otherwise
  // this rejects with ReserveWouldBreach and proves nothing about permissionlessness.
  await send([SystemProgram.transfer({fromPubkey:bank.publicKey,toPubkey:REVENUE,lamports:1_000_000})],[bank])
  // The cooldown is real now, so a consecutive sweep has to wait it out.
  await new Promise(r=>setTimeout(r,2500))
  const w4=await att(()=>send([ixSweep(1_000_000n,alice)],[alice,swapOp]))
  rec('8.10b','a stranger PAYS while the operator signs (the cron needs this)','ALLOW',w4.ok?'ALLOW':'REJECT',w4.err)

  // the pause switch
  const ixPause=(v:boolean,signer:Keypair)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('set_paused'),Buffer.from([v?1:0])]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false}]})
  const pz=await att(()=>send([ixPause(true,alice)],[alice]))
  rec('8.11','a NON-admin pauses minting','REJECT',pz.ok?'ALLOW':'REJECT',pz.err)
  await send([ixPause(true,bank)],[bank])
  let pausedMint='ALLOW'; let pausedErr=''
  try { await mkVault(0n) } catch(e:any){ pausedMint='REJECT'
    pausedErr=((e?.logs||[]).find((x:string)=>/Error Code/.test(x))||String(e?.message||e)).slice(0,110) }
  rec('8.12','minting while paused','REJECT',pausedMint,pausedErr)
  const R2=await att(()=>send([ixOpen(B,alice.publicKey,bank.publicKey),
    ixClose(B,alice.publicKey,bank.publicKey,declare(B.pda))],[bank,alice]))
  rec('8.13','REDEMPTION still works while the sale is paused','ALLOW',R2.ok?'ALLOW':'REJECT',R2.err)
  await send([ixPause(false,bank)],[bank])

  console.log('\n─── 7b. the governance negatives rejected for the RIGHT reason ───')
  because('7.4','NotTheOwner'); because('7.5','NotTheOwner'); because('7.11','VotingOpen')
  because('7.13','QuorumNotMet'); because('7.13a','RoundAlreadyOver'); because('7.17','AlreadyExecuted')
  // 7.7/7.9 must fail because the VoteRecord PDA ALREADY EXISTS (system program
  // 0x0, "account already in use") — that IS the asset binding. Any other reason
  // would mean the double-vote was stopped by something incidental.
  because('7.7','custom program error: 0x0'); because('7.9','custom program error: 0x0')
  because('8.6','NothingToSplit'); because('8.7','ReserveWouldBreach')
  because('8.10','WrongTreasury'); because('8.11','ConstraintHasOne')
  because('7.2c','GovernanceTimelockActive'); because('7.2e','NoPendingGovernance')
  because('7.2f','ConstraintHasOne'); because('7.2k','NoPendingGovernance')
  // AccountNotSigner, not TreasuryNeedsGovernance: Anchor rejects the PDA as a
  // Signer before the handler runs. Same conclusion, and this is the reason.
  because('7.18','AccountNotSigner')
  because('7.19','ConstraintHasOne'); because('7.21','BadWindow'); because('7.22','BadThreshold')
  because('7.24','BadThreshold'); because('7.24a','BadThreshold'); because('7.12e','BadThreshold')
  because('7.13b','QuorumNotMet'); because('7.13c','QuorumNotMet')
  because('7.2o','GovernanceTimelockActive'); because('7.26','ProposalSuperseded')

  const bad=R.filter(r=>!r.ok)
  console.log(`\n${'═'.repeat(78)}`)
  for(const r of R) console.log(`| ${r.id.padEnd(4)} | ${r.t.slice(0,54).padEnd(54)} | ${r.ok?'ok      ':'MISMATCH'} |`)
  console.log(`${'═'.repeat(78)}\n${R.length-bad.length}/${R.length} as predicted (4 PROGRAMS, real Core, REAL TOKENS)`)
  process.exit(bad.length?1:0)
}
main().catch(e=>{console.error('FATAL',e?.message||e,'\n',(e?.logs||[]).join('\n'));process.exit(2)})
