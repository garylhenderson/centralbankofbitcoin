/**
 * Round-5 adjudication probe. Settles two disputed auditor claims by MEASUREMENT.
 *
 * D5 (qwen, unresolved): are vaults born FROZEN? mint_vault hand-encodes the
 *     PermanentFreezeExecute plugin. If the `frozen` byte lands in the wrong
 *     place the asset is created UNSEALED and the owner can Execute the contents
 *     out with no Bank co-signature at all. Nothing in the suite asserted it.
 *     Tested twice: by decoding the plugin, and FUNCTIONALLY by having the owner
 *     attempt a bare Execute with no open_for_redemption anywhere in the tx.
 *
 * D2 (deepseek, HIGH): "SPL Token's COption tag is 1 byte and the 32 payload
 *     bytes are not zeroed on revoke, so d[72..76]==[0,0,0,0] can spuriously
 *     fail and trap a vault." Dumped from a real account after approve+revoke.
 */
import { createHash } from 'crypto'
import { Connection, Keypair, PublicKey as W, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { createMint, getAssociatedTokenAddressSync, mintTo, createTransferInstruction,
  createAssociatedTokenAccountIdempotentInstruction, createApproveInstruction,
  createRevokeInstruction } from '@solana/spl-token'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { keypairIdentity, createNoopSigner, createSignerFromKeypair, generateSigner, publicKey as pk } from '@metaplex-foundation/umi'
import { toWeb3JsPublicKey, fromWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters'
import { mplCore, createCollection, execute, fetchAsset, findAssetSignerPda } from '@metaplex-foundation/mpl-core'
const RPC='http://127.0.0.1:8999'; const CM='confirmed' as const
const conn=new Connection(RPC,CM)
const SEAL_PROG=new W('9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273')
const MINT_PROG=new W('Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo')
const [SEAL]=W.findProgramAddressSync([Buffer.from('seal')],SEAL_PROG)
const [SEAL_CFG]=W.findProgramAddressSync([Buffer.from('config')],SEAL_PROG)
const [MINT_AUTH]=W.findProgramAddressSync([Buffer.from('mint')],MINT_PROG)
const [MINT_CFG]=W.findProgramAddressSync([Buffer.from('mint-config')],MINT_PROG)
const d=(n:string)=>createHash('sha256').update(`global:${n}`).digest().subarray(0,8)
const u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b}
const i64=(n:number)=>{const b=Buffer.alloc(8);b.writeBigInt64LE(BigInt(n));return b}
const u64=(n:number|bigint)=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b}
const str=(v:string)=>Buffer.concat([u32(Buffer.byteLength(v)),Buffer.from(v)])
const R:{id:string,t:string,want:string,got:string,ok:boolean,n?:string}[]=[]
const rec=(id:string,t:string,want:string,got:string,n?:string)=>{const ok=want===got;R.push({id,t,want,got,ok,n})
  console.log(`  ${ok?'ok  ':'XX  '}${id}  ${t}  [want ${want}, got ${got}]${n?`\n         ↳ ${n}`:''}`)}

async function main(){
  const bank=Keypair.fromSeed(Buffer.alloc(32,7)), alice=Keypair.generate(), gov=Keypair.fromSeed(Buffer.alloc(32,11))
  const treasury=Keypair.generate()
  for(const k of [bank,alice,gov]){const s=await conn.requestAirdrop(k.publicKey,50*LAMPORTS_PER_SOL)
    await conn.confirmTransaction({signature:s,...(await conn.getLatestBlockhash())},CM)}
  const umi=createUmi(RPC,{commitment:CM}).use(mplCore())
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(bank.secretKey)))
  const aliceU=createSignerFromKeypair(umi,umi.eddsa.createKeypairFromSecretKey(alice.secretKey))
  const coll=generateSigner(umi)
  await createCollection(umi,{collection:coll,name:'CBOBTC Vaults',uri:'https://cdn.gary.club/cbob/c.json',
    updateAuthority:pk(MINT_AUTH.toBase58())}).sendAndConfirm(umi,{confirm:{commitment:CM}})
  const COLL=toWeb3JsPublicKey(coll.publicKey)
  const mint=await createMint(conn,bank,bank.publicKey,null,8)
  const send=(ixs:TransactionInstruction[],s:Keypair[])=>sendAndConfirmTransaction(conn,new Transaction().add(...ixs),s,{commitment:CM})
  const att=async(f:()=>Promise<unknown>)=>{try{await f();return{ok:true,err:''}}catch(e:any){
    const l=(e?.logs||[]).filter((x:string)=>/Error Code|custom program error|Neither|Invalid/.test(x))
    return{ok:false,err:(l[0]||String(e?.message||e)).replace(/\s+/g,' ').slice(0,120)}}}

  await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('initialize'),COLL.toBuffer(),bank.publicKey.toBuffer(),gov.publicKey.toBuffer(),treasury.publicKey.toBuffer()]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[bank]))
  await att(()=>send([new TransactionInstruction({programId:SEAL_PROG,
    data:Buffer.concat([d('initialize'),COLL.toBuffer(),bank.publicKey.toBuffer(),u32(1),mint.toBuffer()]),
    keys:[{pubkey:SEAL_CFG,isSigner:false,isWritable:true},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[bank]))
  const now=Math.floor(Date.now()/1000)
  await send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('set_round'),i64(now-60),i64(now+3600),u64(BigInt(0.05*LAMPORTS_PER_SOL)),u32(100)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:gov.publicKey,isSigner:true,isWritable:false}]})],[gov])

  console.log('─── D5: is a vault BORN FROZEN? ───')
  const asset=Keypair.generate()
  await send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('mint_vault'),str('CBOBTC Vault'),str('https://cdn.gary.club/cbob/v.json')]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:asset.publicKey,isSigner:true,isWritable:true},
      {pubkey:COLL,isSigner:false,isWritable:true},{pubkey:alice.publicKey,isSigner:false,isWritable:false},
      {pubkey:bank.publicKey,isSigner:true,isWritable:false},{pubkey:bank.publicKey,isSigner:true,isWritable:true},
      {pubkey:treasury.publicKey,isSigner:false,isWritable:true},
      {pubkey:SEAL_CFG,isSigner:false,isWritable:false},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
      {pubkey:new W('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'),isSigner:false,isWritable:false},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[bank,asset])
  const umiAsset=pk(asset.publicKey.toBase58())
  const a:any=await fetchAsset(umi,umiAsset)
  rec('D5.1','plugin decodes as frozen','true',String(a.permanentFreezeExecute?.frozen===true),
      `permanentFreezeExecute=${JSON.stringify(a.permanentFreezeExecute,(_k,v)=>typeof v==="bigint"?String(v):v)}`)

  // FUNCTIONAL: fund the vault, then have the OWNER try a bare Execute with no
  // open_for_redemption in the transaction. This is the property that matters —
  // the plugin read only proves a byte, this proves the seal actually holds.
  const pda=toWeb3JsPublicKey(findAssetSignerPda(umi,{asset:umiAsset})[0])
  const pdaAta=getAssociatedTokenAddressSync(mint,pda,true)
  const bankAta=getAssociatedTokenAddressSync(mint,bank.publicKey)
  await send([createAssociatedTokenAccountIdempotentInstruction(bank.publicKey,bankAta,bank.publicKey,mint),
              createAssociatedTokenAccountIdempotentInstruction(bank.publicKey,pdaAta,pda,mint)],[bank])
  await mintTo(conn,bank,mint,bankAta,bank,1_000_000_000n,[],{commitment:CM})
  await send([createTransferInstruction(bankAta,pdaAta,bank.publicKey,100_000_000n)],[bank])
  const bal=async(x:W)=>BigInt((await conn.getTokenAccountBalance(x,CM)).value.amount)
  rec('D5.2','vault funded','100000000',String(await bal(pdaAta)))

  const aliceAta=getAssociatedTokenAddressSync(mint,alice.publicKey)
  await send([createAssociatedTokenAccountIdempotentInstruction(bank.publicKey,aliceAta,alice.publicKey,mint)],[bank])
  // Build the Execute exactly as the main suite does for a SUCCESSFUL sweep, and
  // send it through web3 so any rejection is genuinely ON-CHAIN. A first attempt
  // used a different umi call shape and failed CLIENT-SIDE with "No builder or
  // instructions provided" — a REJECT for the wrong reason is a false pass.
  const sweepIxs=execute(umi,{asset:{publicKey:umiAsset},collection:{publicKey:coll.publicKey} as any,
    instructions:[fromWeb3JsInstruction(createTransferInstruction(pdaAta,aliceAta,pda,100_000_000n))],
    signers:[createNoopSigner(pk(pda.toBase58()))],authority:aliceU}).getInstructions()
    .map(i=>new TransactionInstruction({programId:toWeb3JsPublicKey(i.programId),data:Buffer.from(i.data),
      keys:i.keys.map(k=>({pubkey:toWeb3JsPublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable}))}))
  const bare=await att(()=>send(sweepIxs,[alice,bank]))
  rec('D5.3','OWNER bare-Executes with NO open (the real test)','REJECT',bare.ok?'ALLOW':'REJECT',bare.err)
  rec('D5.3b','...and the rejection is ON-CHAIN, not client-side','true',
      String(/Invalid Authority|custom program error|Neither/.test(bare.err)),bare.err)
  rec('D5.4','contents still in the vault','100000000',String(await bal(pdaAta)))

  console.log('\n─── D2: SPL Token COption tag width, after approve+revoke ───')
  const probeAta=getAssociatedTokenAddressSync(mint,alice.publicKey)
  await send([createApproveInstruction(probeAta,bank.publicKey,alice.publicKey,12345n)],[alice])
  const withDel=Buffer.from((await conn.getAccountInfo(probeAta,CM))!.data)
  await send([createRevokeInstruction(probeAta,alice.publicKey)],[alice])
  const afterRev=Buffer.from((await conn.getAccountInfo(probeAta,CM))!.data)
  console.log(`  delegate slot WHILE APPROVED  [72..76]=${[...withDel.subarray(72,76)]}  payload[76..108] nonzero=${withDel.subarray(76,108).some(b=>b!==0)}`)
  console.log(`  delegate slot AFTER REVOKE    [72..76]=${[...afterRev.subarray(72,76)]}  payload[76..108] nonzero=${afterRev.subarray(76,108).some(b=>b!==0)}`)
  console.log(`  delegated_amount [121..129]=${[...afterRev.subarray(121,129)]}`)
  console.log(`  close_authority  [129..133]=${[...afterRev.subarray(129,133)]}`)
  rec('D2.1','COption tag is 4 bytes (Some=[1,0,0,0])','[1,0,0,0]',JSON.stringify([...withDel.subarray(72,76)]))
  rec('D2.2','after revoke the 4-byte tag reads None','[0,0,0,0]',JSON.stringify([...afterRev.subarray(72,76)]))
  rec('D2.3','the code\'s check d[72..76]==[0,0,0,0] PASSES a revoked account','pass',
      afterRev.subarray(72,76).every(b=>b===0)?'pass':'FAIL')

  console.log('\n'+'='.repeat(78))
  for(const r of R) console.log(`| ${r.id.padEnd(5)}| ${r.t.padEnd(52)}| ${(r.ok?'ok':'XX').padEnd(8)}|`)
  console.log('='.repeat(78))
  console.log(`${R.filter(r=>r.ok).length}/${R.length} as predicted`)
  if(R.some(r=>!r.ok)) process.exit(1)
}
main().catch(e=>{console.error('FATAL',e?.message||e); process.exit(1)})
