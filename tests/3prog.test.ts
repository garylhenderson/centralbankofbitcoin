/**
 * THREE-PROGRAM END-TO-END: mint (governable) -> seal (redemption) -> burn.
 * Each program has its own upgrade authority; the collection's update authority is
 * the MINT program's PDA, so the seal program has no minting power at all.
 * Every vault holds a real SPL token balance.
 */
import { createHash } from 'crypto'
import { Connection, Keypair, PublicKey as W, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, createMint, getAssociatedTokenAddressSync, mintTo,
  createTransferInstruction, createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction, createApproveInstruction } from '@solana/spl-token'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { keypairIdentity, createNoopSigner, createSignerFromKeypair, generateSigner,
  transactionBuilder, publicKey as pk } from '@metaplex-foundation/umi'
import { toWeb3JsPublicKey, fromWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters'
import { mplCore, createCollection, execute, fetchAsset, findAssetSignerPda, create } from '@metaplex-foundation/mpl-core'
const RPC='http://127.0.0.1:8999'; const CM='confirmed' as const
const conn=new Connection(RPC,CM)
const SEAL_PROG=new W('9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273')
const MINT_PROG=new W('Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo')
const BURN_PROG=new W('8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8')
const CORE=new W('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d')
const [SEAL]=W.findProgramAddressSync([Buffer.from('seal')],SEAL_PROG)
const [SEAL_CFG]=W.findProgramAddressSync([Buffer.from('config')],SEAL_PROG)
const [MINT_AUTH]=W.findProgramAddressSync([Buffer.from('mint')],MINT_PROG)
const [MINT_CFG]=W.findProgramAddressSync([Buffer.from('mint-config')],MINT_PROG)
const [BURN_CFG]=W.findProgramAddressSync([Buffer.from('burn-config')],BURN_PROG)
const d=(n:string)=>createHash('sha256').update(`global:${n}`).digest().subarray(0,8)
const R:{id:string;t:string;want:string;got:string;ok:boolean;n?:string}[]=[]
const rec=(id:string,t:string,want:string,got:string,n?:string)=>{const ok=want===got;R.push({id,t,want,got,ok,n})
  console.log(`  ${ok?'ok  ':'XX  '}${id}  ${t}  [want ${want}, got ${got}]${n?`\n         ↳ ${n}`:''}`)}
const u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b}
const i64=(n:number)=>{const b=Buffer.alloc(8);b.writeBigInt64LE(BigInt(n));return b}
const u64=(n:number|bigint)=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b}
const str=(v:string)=>Buffer.concat([u32(Buffer.byteLength(v)),Buffer.from(v)])
const SATS=100_000_000n

async function main(){
  const bank=Keypair.fromSeed(Buffer.alloc(32,7)), alice=Keypair.generate()
  const gov=Keypair.fromSeed(Buffer.alloc(32,11)), treasury=Keypair.generate()
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
    data:Buffer.concat([d('initialize'),COLL.toBuffer(),bank.publicKey.toBuffer(),gov.publicKey.toBuffer(),treasury.publicKey.toBuffer()]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[bank]))
  if(!mi.ok){ console.log('  MINT config already exists — use a FRESH validator'); }
  if(false){
    const up=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
      data:Buffer.concat([d('update_wiring'),someB(COLL.toBuffer()),someB(bank.publicKey.toBuffer()),
        someB(gov.publicKey.toBuffer()),someB(treasury.publicKey.toBuffer()),someB(bank.publicKey.toBuffer())]),
      keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false}]})],[bank]))
    console.log(`  (mint config re-pointed: ${up.ok?'ok':'FAILED '+up.err})`)
  }
  // config PDAs persist across validator runs; re-point them or every check fails
  // with ForeignVault against a stale collection.
  const some=(b:Buffer)=>Buffer.concat([Buffer.from([1]),b])
  const seal1=await att(()=>send([new TransactionInstruction({programId:SEAL_PROG,
    data:Buffer.concat([d('initialize'),COLL.toBuffer(),bank.publicKey.toBuffer(),u32(1),mint.toBuffer()]),
    keys:[{pubkey:SEAL_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[bank]))
  if(!seal1.ok){ console.log('  SEAL config already exists — collection is immutable by design, use a FRESH validator'); }
  if(false){
    const up=await att(()=>send([new TransactionInstruction({programId:SEAL_PROG,
      data:Buffer.concat([d('update_config'),some(COLL.toBuffer()),some(bank.publicKey.toBuffer()),
        some(bank.publicKey.toBuffer()),some(Buffer.concat([u32(1),mint.toBuffer()]))]),
      keys:[{pubkey:SEAL_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:false}]})],[bank]))
    console.log(`  (seal config re-pointed: ${up.ok?'ok':'FAILED '+up.err})`)
  }
  const burn1=await att(()=>send([new TransactionInstruction({programId:BURN_PROG,
    data:Buffer.concat([d('initialize'),COLL.toBuffer(),bank.publicKey.toBuffer(),u32(1),mint.toBuffer()]),
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
  const mkVault=async(tokens=SATS)=>{
    const asset=Keypair.generate()
    await send([new TransactionInstruction({programId:MINT_PROG,
      data:Buffer.concat([d('mint_vault'),str('CBOBTC Vault'),str('https://cdn.gary.club/cbob/v.json')]),
      keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:asset.publicKey,isSigner:true,isWritable:true},
        {pubkey:COLL,isSigner:false,isWritable:true},{pubkey:alice.publicKey,isSigner:false,isWritable:false},
        {pubkey:bank.publicKey,isSigner:true,isWritable:false},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
        {pubkey:treasury.publicKey,isSigner:false,isWritable:true},
        {pubkey:SEAL_CFG,isSigner:false,isWritable:false},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
        {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[bank,asset])
    const [pdaU]=findAssetSignerPda(umi,{asset:pk(asset.publicKey.toBase58())})
    const pda=toWeb3JsPublicKey(pdaU)
    if(tokens>0n) await sendAndConfirmTransaction(conn,new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(bank.publicKey,ata(pda),pda,mint),
      createTransferInstruction(ata(bank.publicKey),ata(pda),bank.publicKey,tokens)),[bank],{commitment:CM})
    return {asset:asset.publicKey,umiAsset:pk(asset.publicKey.toBase58()),pdaU,pda}
  }
  const tBefore=await conn.getBalance(treasury.publicKey,CM)
  const V=await mkVault()
  rec('2.1','vault minted via the mint program','true',String(!!V.asset))
  rec('2.2','round price landed in the treasury',String(0.05*LAMPORTS_PER_SOL),String(await conn.getBalance(treasury.publicKey,CM)-tBefore))
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
    data:Buffer.concat([d('mint_vault'),str('BRICK'),str('u')]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:brickAsset.publicKey,isSigner:true,isWritable:true},
      {pubkey:COLL,isSigner:false,isWritable:true},{pubkey:bPda,isSigner:false,isWritable:false},
      {pubkey:bank.publicKey,isSigner:true,isWritable:false},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
      {pubkey:treasury.publicKey,isSigner:false,isWritable:true},{pubkey:SEAL_CFG,isSigner:false,isWritable:false},
      {pubkey:MINT_AUTH,isSigner:false,isWritable:false},{pubkey:CORE,isSigner:false,isWritable:false},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[bank,brickAsset]))
  rec('5.2','mint a vault OWNED BY ITS OWN PDA (bricked forever)','REJECT',n2.ok?'ALLOW':'REJECT',n2.err)
  const n3=await att(()=>send([new TransactionInstruction({programId:BURN_PROG,
    data:Buffer.concat([d('burn_vault'),Buffer.from([2])]),keys:[
    {pubkey:N.asset,isSigner:false,isWritable:true},{pubkey:COLL,isSigner:false,isWritable:true},
    {pubkey:alice.publicKey,isSigner:true,isWritable:false},{pubkey:bank.publicKey,isSigner:true,isWritable:false},
    {pubkey:N.pda,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
    {pubkey:BURN_CFG,isSigner:false,isWritable:false},{pubkey:MINT_CFG,isSigner:false,isWritable:false},
    {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
    ...declare(N.pda).map(p=>({pubkey:p,isSigner:false,isWritable:true}))]})],[bank,alice]))
  rec('5.3','burn with a BOGUS seal_config account','REJECT',n3.ok?'ALLOW':'REJECT',n3.err)

  const bad=R.filter(r=>!r.ok)
  console.log(`\n${'═'.repeat(78)}`)
  for(const r of R) console.log(`| ${r.id.padEnd(4)} | ${r.t.slice(0,54).padEnd(54)} | ${r.ok?'ok      ':'MISMATCH'} |`)
  console.log(`${'═'.repeat(78)}\n${R.length-bad.length}/${R.length} as predicted (3 PROGRAMS, real Core, REAL TOKENS)`)
  process.exit(bad.length?1:0)
}
main().catch(e=>{console.error('FATAL',e?.message||e,'\n',(e?.logs||[]).join('\n'));process.exit(2)})
