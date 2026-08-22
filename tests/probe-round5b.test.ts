/**
 * Round-5 adjudication probe #2. Two mechanical claims that decide real fixes.
 *
 * D4 (grok UPHELD, gpt-5.6 + kimi REJECTED): "drop burn's lamports==0 check and
 *     let Core's BurnV1 sweep the PDA's lamports to the payer." If Core does NOT
 *     sweep, taking grok's advice would permanently destroy customer SOL.
 *
 * F4 (opus, unique): "every Token-2022 ATA carries ImmutableOwner, so len != 165,
 *     so require!(d.len()==165) makes any Token-2022 reserve mint permanently
 *     unredeemable." Also: can a T22 ATA even exist for a CLASSIC mint?
 */
import { Connection, Keypair, PublicKey as W, SystemProgram, Transaction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createMint, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { keypairIdentity, createSignerFromKeypair, generateSigner, publicKey as pk } from '@metaplex-foundation/umi'
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters'
import { mplCore, create, burn, findAssetSignerPda } from '@metaplex-foundation/mpl-core'
const RPC='http://127.0.0.1:8999'; const CM='confirmed' as const
const conn=new Connection(RPC,CM)
const R:{id:string,t:string,want:string,got:string,ok:boolean,n?:string}[]=[]
const rec=(id:string,t:string,want:string,got:string,n?:string)=>{const ok=want===got;R.push({id,t,want,got,ok,n})
  console.log(`  ${ok?'ok  ':'XX  '}${id}  ${t}  [want ${want}, got ${got}]${n?`\n         ↳ ${n}`:''}`)}

async function main(){
  const payer=Keypair.generate(), owner=Keypair.generate()
  for(const k of [payer,owner]){const s=await conn.requestAirdrop(k.publicKey,50*LAMPORTS_PER_SOL)
    await conn.confirmTransaction({signature:s,...(await conn.getLatestBlockhash())},CM)}
  const umi=createUmi(RPC,{commitment:CM}).use(mplCore())
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(payer.secretKey)))
  const ownerU=createSignerFromKeypair(umi,umi.eddsa.createKeypairFromSecretKey(owner.secretKey))

  console.log('─── D4: does Core BurnV1 sweep the asset-signer PDA lamports? ───')
  const asset=generateSigner(umi)
  await create(umi,{asset,name:'probe',uri:'x',owner:pk(owner.publicKey.toBase58())})
    .sendAndConfirm(umi,{confirm:{commitment:CM}})
  const pda=toWeb3JsPublicKey(findAssetSignerPda(umi,{asset:asset.publicKey})[0])
  const DUST=5_000_000
  await sendAndConfirmTransaction(conn,new Transaction().add(
    SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:pda,lamports:DUST})),[payer],{commitment:CM})
  rec('D4.1','PDA funded with lamports',String(DUST),String((await conn.getBalance(pda,CM))))
  const before=await conn.getBalance(payer.publicKey,CM)
  await burn(umi,{asset:{publicKey:asset.publicKey,owner:ownerU.publicKey} as any,authority:ownerU})
    .sendAndConfirm(umi,{confirm:{commitment:CM}})
  const after=await conn.getBalance(payer.publicKey,CM)
  const pdaAfter=await conn.getBalance(pda,CM)
  rec('D4.2','after BurnV1 the PDA STILL holds its lamports',String(DUST),String(pdaAfter),
      `payer delta ${after-before} lamports (asset rent refund minus fees; NOT the PDA's ${DUST})`)
  rec('D4.3','Core did NOT sweep the PDA -> grok\'s "let BurnV1 sweep it" is FALSE','true',String(pdaAfter===DUST))

  console.log('\n─── F4: Token-2022 ATA length, and T22 ATA for a CLASSIC mint ───')
  const t22mint=await createMint(conn,payer,payer.publicKey,null,6,undefined,{commitment:CM},TOKEN_2022_PROGRAM_ID)
  const t22ata=getAssociatedTokenAddressSync(t22mint,owner.publicKey,true,TOKEN_2022_PROGRAM_ID)
  await sendAndConfirmTransaction(conn,new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey,t22ata,owner.publicKey,t22mint,TOKEN_2022_PROGRAM_ID)),
    [payer],{commitment:CM})
  const t22len=(await conn.getAccountInfo(t22ata,CM))!.data.length
  console.log(`  Token-2022 ATA data length = ${t22len} (classic base is 165)`)
  rec('F4.1','a Token-2022 ATA is LONGER than 165 (ImmutableOwner)','true',String(t22len>165),
      `len=${t22len} -> require!(d.len()==165) would REJECT it`)

  const classicMint=await createMint(conn,payer,payer.publicKey,null,8,undefined,{commitment:CM},TOKEN_PROGRAM_ID)
  const classicAsT22=getAssociatedTokenAddressSync(classicMint,owner.publicKey,true,TOKEN_2022_PROGRAM_ID)
  let t22OnClassic='ALLOW'
  try{
    await sendAndConfirmTransaction(conn,new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey,classicAsT22,owner.publicKey,classicMint,TOKEN_2022_PROGRAM_ID)),
      [payer],{commitment:CM})
  }catch(e:any){ t22OnClassic='REJECT' }
  rec('F4.2','creating a T22 ATA for a CLASSIC mint','REJECT',t22OnClassic,
      'if REJECT, the T22 derivation can never hold value for our classic reserve mints')
  const classicAta=getAssociatedTokenAddressSync(classicMint,owner.publicKey,true,TOKEN_PROGRAM_ID)
  await sendAndConfirmTransaction(conn,new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey,classicAta,owner.publicKey,classicMint)),[payer],{commitment:CM})
  rec('F4.3','a CLASSIC ATA is exactly 165','165',String((await conn.getAccountInfo(classicAta,CM))!.data.length))

  console.log('\n'+'='.repeat(78))
  for(const r of R) console.log(`| ${r.id.padEnd(6)}| ${r.t.slice(0,56).padEnd(56)}| ${(r.ok?'ok':'XX').padEnd(5)}|`)
  console.log('='.repeat(78)); console.log(`${R.filter(r=>r.ok).length}/${R.length} as predicted`)
  if(R.some(r=>!r.ok)) process.exit(1)
}
main().catch(e=>{console.error('FATAL',e?.message||e); process.exit(1)})
