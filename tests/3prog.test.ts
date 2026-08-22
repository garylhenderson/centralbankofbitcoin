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
import { mplCore, createCollection, execute, fetchAsset, findAssetSignerPda, create, transfer } from '@metaplex-foundation/mpl-core'
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
const i64=(n:number)=>{const b=Buffer.alloc(8);b.writeBigInt64LE(BigInt(n));return b}
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
  o.splitBps!==undefined?SOME(u16(o.splitBps)):NONE])
const attrs=(list:[string,string][])=>Buffer.concat([u32(list.length),
  ...list.flatMap(([k,v])=>[str(k),str(v)])])
const SATS=100_000_000n
const MAX_SUPPLY=2100n

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
  const att=async(f:()=>Promise<unknown>)=>{try{await f();return{ok:true,err:''}}catch(e:any){
    const l=(e?.logs||[]).filter((x:string)=>/Error Code|custom program error/.test(x))
    return{ok:false,err:(l[0]||String(e?.message||e)).replace(/\s+/g,' ').slice(0,110)}}}

  // ---- init all three ----
  const someB=(b:Buffer)=>Buffer.concat([Buffer.from([1]),b])
  const mi=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('initialize'),COLL.toBuffer(),bank.publicKey.toBuffer(),gov.publicKey.toBuffer(),treasury.publicKey.toBuffer(),bankTreasury.publicKey.toBuffer(),swapOp.publicKey.toBuffer(),u64(BigInt(0.05*LAMPORTS_PER_SOL)),u64(MAX_SUPPLY)]),
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
  const setRound=(o:number,c:number,price:bigint,cap:number,signer:Keypair)=>new TransactionInstruction({programId:MINT_PROG,
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
  const rot=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:wiring({governance:GOV_PDA}),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false},
      {pubkey:MINT_PROG,isSigner:false,isWritable:false}]})],[bank]))
  rec('7.2','MINT governance rotated to the GOV program PDA','ALLOW',rot.ok?'ALLOW':'REJECT',rot.err)

  const A=await mkVault(0n), B=await mkVault(0n)
  const propId=(n:number)=>W.findProgramAddressSync([Buffer.from('proposal'),u64(n)],GOV_PROG)[0]
  const nowG=Math.floor(Date.now()/1000)
  const ixProp=(id:number,asset:W,who:Keypair,ends:number,cap=50)=>new TransactionInstruction({programId:GOV_PROG,
    data:Buffer.concat([d('create_proposal'),i64(nowG+120),i64(nowG+7200),u64(BigInt(0.02*LAMPORTS_PER_SOL)),u32(cap),i64(ends)]),
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:true},{pubkey:propId(id),isSigner:false,isWritable:true},
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
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:false},{pubkey:prop,isSigner:false,isWritable:true},
      {pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:GOV_PDA,isSigner:false,isWritable:false},
      {pubkey:MINT_PROG,isSigner:false,isWritable:false}]})
  const e0=await att(()=>send([ixExec(P1)],[bank]))
  rec('7.11','execute while voting is still open','REJECT',e0.ok?'ALLOW':'REJECT',e0.err)

  const gp3=await att(()=>send([ixProp(2,B.asset,alice,nowG+VOTE_SECS+5)],[alice]))
  rec('7.12','a second proposal, which nobody will vote on','ALLOW',gp3.ok?'ALLOW':'REJECT',gp3.err)

  const waitMs=(nowG+VOTE_SECS+8)*1000-Date.now()
  console.log(`  (waiting ${Math.max(0,Math.round(waitMs/1000))}s for the voting window to close — the execute path is worth actually running)`)
  if(waitMs>0) await new Promise(r=>setTimeout(r,waitMs))

  const cfgBefore=await conn.getAccountInfo(MINT_CFG,CM)
  const roundBefore=cfgBefore!.data.readUInt32LE(169)
  const e1=await att(()=>send([ixExec(propId(2))],[bank]))
  rec('7.13','execute a proposal with ZERO votes','REJECT',e1.ok?'ALLOW':'REJECT',e1.err)
  const e2=await att(()=>send([ixExec(P1)],[bank]))
  rec('7.14','execute a ratified proposal','ALLOW',e2.ok?'ALLOW':'REJECT',e2.err)
  const cfgAfter=await conn.getAccountInfo(MINT_CFG,CM)
  rec('7.15','MINT round_id advanced (the vote actually set the round)',String(roundBefore+1),
      String(cfgAfter!.data.readUInt32LE(169)))
  rec('7.16','MINT price is now the proposal price',String(0.02*LAMPORTS_PER_SOL),
      String(Number(cfgAfter!.data.readBigUInt64LE(189))))
  const e3=await att(()=>send([ixExec(P1)],[bank]))
  rec('7.17','execute the same proposal twice','REJECT',e3.ok?'ALLOW':'REJECT',e3.err)

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

  // the SOL reserve must survive a sweep
  const ixSweep=(amt:bigint,_s?:Keypair,dest:W=swapOp.publicKey)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('sweep_sol_for_swap'),u64(amt)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:false},
      {pubkey:REVENUE,isSigner:false,isWritable:true},{pubkey:dest,isSigner:false,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const revSol=BigInt(await conn.getBalance(REVENUE,CM))
  const w1=await att(()=>send([ixSweep(revSol,bank)],[bank]))
  rec('8.7','sweeping SOL that would breach the fee reserve','REJECT',w1.ok?'ALLOW':'REJECT',w1.err)
  const safe=revSol-BigInt(0.05*LAMPORTS_PER_SOL)
  const w2=await att(()=>send([ixSweep(safe>0n?safe:0n,bank)],[bank]))
  rec('8.8','sweeping what the reserve allows','ALLOW',w2.ok?'ALLOW':'REJECT',w2.err)
  rec('8.9','the operator received it',String(safe>0n?safe:0n),String(await conn.getBalance(swapOp.publicKey,CM)))
  // permissionless BY DESIGN, so the property to prove is that the DESTINATION
  // cannot be chosen: a stranger sweeping can only move our SOL to our operator.
  const w3=await att(()=>send([ixSweep(1n,alice,alice.publicKey)],[alice]))
  rec('8.10','sweeping SOL to an address of the caller\'s choosing','REJECT',w3.ok?'ALLOW':'REJECT',w3.err)
  // 8.8 already swept down to the reserve, so top the address up first: otherwise
  // this rejects with ReserveWouldBreach and proves nothing about permissionlessness.
  await send([SystemProgram.transfer({fromPubkey:bank.publicKey,toPubkey:REVENUE,lamports:1_000_000})],[bank])
  const w4=await att(()=>send([ixSweep(1_000_000n,alice)],[alice]))
  rec('8.10b','a stranger sweeps to the PINNED operator (automation needs this)','ALLOW',w4.ok?'ALLOW':'REJECT',w4.err)

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
  because('7.13','QuorumNotMet'); because('7.17','AlreadyExecuted')
  // 7.7/7.9 must fail because the VoteRecord PDA ALREADY EXISTS (system program
  // 0x0, "account already in use") — that IS the asset binding. Any other reason
  // would mean the double-vote was stopped by something incidental.
  because('7.7','custom program error: 0x0'); because('7.9','custom program error: 0x0')
  because('8.6','NothingToSplit'); because('8.7','ReserveWouldBreach')
  because('8.10','WrongTreasury'); because('8.11','ConstraintHasOne')

  const bad=R.filter(r=>!r.ok)
  console.log(`\n${'═'.repeat(78)}`)
  for(const r of R) console.log(`| ${r.id.padEnd(4)} | ${r.t.slice(0,54).padEnd(54)} | ${r.ok?'ok      ':'MISMATCH'} |`)
  console.log(`${'═'.repeat(78)}\n${R.length-bad.length}/${R.length} as predicted (4 PROGRAMS, real Core, REAL TOKENS)`)
  process.exit(bad.length?1:0)
}
main().catch(e=>{console.error('FATAL',e?.message||e,'\n',(e?.logs||[]).join('\n'));process.exit(2)})
