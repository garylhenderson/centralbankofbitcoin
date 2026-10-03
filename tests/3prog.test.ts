/**
 * v6 (Gary, 2026-10-03): THERE IS NO BANK AND NO ADMIN. Every redemption below is
 * the OWNER's signature plus the programs' rules; `deployer` is the localnet
 * INIT_AUTHORITY test key (Gary's wallet on mainnet), which signs the one-time
 * initializes and the deck commits, and is otherwise just a funder. The guardian
 * can only STOP; governance alone restarts.
 *
 * THREE-PROGRAM END-TO-END: mint (governable) -> seal (redemption) -> burn.
 * Each program has its own upgrade authority; the collection's update authority is
 * the MINT program's PDA, so the seal program has no minting power at all.
 * Every vault holds a real SPL token balance.
 */
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { Connection, Keypair, PublicKey as W, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL, SYSVAR_INSTRUCTIONS_PUBKEY,
  ComputeBudgetProgram } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createMint, getAssociatedTokenAddressSync, mintTo,
  createTransferInstruction, createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction, createApproveInstruction } from '@solana/spl-token'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { keypairIdentity, createNoopSigner, createSignerFromKeypair, generateSigner,
  transactionBuilder, publicKey as pk } from '@metaplex-foundation/umi'
import { toWeb3JsPublicKey, fromWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters'
import { mplCore, createCollection, execute, fetchAsset, fetchCollection, findAssetSignerPda, create, transfer } from '@metaplex-foundation/mpl-core'
// THE SAME DECK CODE PRODUCTION USES. Importing it rather than re-implementing it
// is the point: the only thing that can prove bank/deck.mjs and the Rust agree is
// the PROGRAM verifying a proof this file built.
import { buildDeck, deckRoot, deckProof, seedFrom } from '../bank/deck.mjs'
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
const u8b=(n:number)=>Buffer.from([n])
// LEVELS AT MINT. Caps deliberately TINY here — the charter census is
// [108,60,36,24,12] and a test that must mint 108 vaults to reach a ceiling is a
// test nobody runs. Level V's cap of 1 is what makes the quota gate REACHABLE,
// and a gate that cannot be reached in the suite is a gate proven in one
// direction only.
const LEVEL_CAPS:[number,number,number,number,number]=[50,20,10,5,5]
// The deck the suite commits. Its census must cover every mint this suite makes
// and must not exceed the caps, or a later mint fails for a reason no assertion
// is about. Seed is fixed so a failing run is reproducible.
const DECK_CENSUS:[number,number,number,number,number]=[50,20,10,5,5]
// ⚠️ ROUND 20. THE SEED IS NO LONGER THE TEST'S TO CHOOSE, AND THAT IS THE FIX.
// It used to be `seedFrom('cbob-suite-salt','cbob-suite-blockhash')` — two string
// literals — which mirrored a production scheme that existed only in a comment.
// The deck is now derived from a salt committed on chain BEFORE the slot it is
// mixed with exists, plus that slot's real blockhash read out of the SlotHashes
// sysvar. So these are assigned in main(), from the chain, and the suite exercises
// the same two-step the Bank will.
const SUITE_SALT=createHash('sha256').update('cbob-suite-salt-v20').digest()
const SLOT_HASHES=new W('SysvarS1otHashes111111111111111111111111111')
let DECK_SEED:Buffer, DECK:number[], DECK_ROOT:Buffer
// The raw offsets of the three commitment fields, appended after `deck_root`.
// ⚠️ ASSERTED, NOT ASSUMED: 2.0h reads `deck_seed` at OFF_DECK_SEED and compares
// it against the seed this file derived independently. If the offsets are wrong
// the comparison fails loudly instead of silently reading adjacent bytes.
// v6 re-laid MintConfig out (version 2); see the offset map in the GOV program.
const OFF_DECK_SLOT=394, OFF_DECK_SEED=402
const OFF_MINTED_TOTAL=141, OFF_GOVERNANCE=41, OFF_ROUND_ID=105, OFF_PRICE=125
const OFF_SALES_STOPPED=191, OFF_SWEEP_STOPPED=192, OFF_GUARDIAN=193, OFF_SWAP_OPERATOR=225
const OFF_SWEEP_COOLDOWN=274
const proofBuf=(pr:Buffer[])=>Buffer.concat([u32(pr.length),...pr])
const caps5=(c:[number,number,number,number,number])=>Buffer.concat(c.map(u32))
const LVL={I:1,II:2,III:3,IV:4,V:5} as const
const LNAME=['I','II','III','IV','V']
const MAX_ATTRS_BORSH=8   // the program's Vec bound. 11.11 measures where the PACKET binds; see the note there.
const u16=(n:number)=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b}
const i64=(n:number|bigint)=>{const b=Buffer.alloc(8);b.writeBigInt64LE(BigInt(n));return b}
const u64=(n:number|bigint)=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b}
const str=(v:string)=>Buffer.concat([u32(Buffer.byteLength(v)),Buffer.from(v)])
const NONE=Buffer.from([0])
const SOME=(b:Buffer)=>Buffer.concat([Buffer.from([1]),b])
// WiringArgs { treasury, bank_treasury, split_bps, swap_operator,
// sol_reserve_lamports, max_sweep_lamports, sweep_cooldown_secs, max_supply }.
// ONE encoder, used both for MINT's `update_wiring` and inside a GOV
// `UpdateWiring` proposal, so the e2e proposal test (8b) proves GOV's copy of
// the struct and MINT's agree byte for byte.
const wiringArgs=(o:any={})=>Buffer.concat([
  o.treasury?SOME(o.treasury.toBuffer()):NONE,
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
const MAX_SUPPLY=2100n
/** The on-chain sweep bound. `revenue.mjs`'s 50-SOL constant bound nobody. */
// ROUND 11: this was 100 SOL, so a green suite certified the system running at
// TWICE the per-cycle exposure the business states everywhere else. The cap is
// now bounded on chain; the tests run at the real one.
const SWEEP_CAP=BigInt(50*LAMPORTS_PER_SOL)
/** The PROGRAM floor. Zero is refused now: two sweeps in one transaction share a
 *  timestamp, so a cooldown of 1 closes the atomic bypass absolutely. Production
 *  must be hours and the alarm asserts it. */
const SWEEP_COOLDOWN=1

async function main(){
  const deployer=Keypair.fromSeed(Buffer.alloc(32,7)), alice=Keypair.generate()
  const gov=Keypair.fromSeed(Buffer.alloc(32,11)), treasury=Keypair.generate()
  const bankTreasury=Keypair.generate(), swapOp=Keypair.generate()
  // THE GUARDIAN. Gary's wallet in production; a fresh key here, deliberately NOT
  // the deployer or governance, so every refusal below is about the role.
  const guardian=Keypair.generate(), guardian2=Keypair.generate()
  for(const k of [deployer,alice,gov,guardian,guardian2]){ const s=await conn.requestAirdrop(k.publicKey,50*LAMPORTS_PER_SOL)
    await conn.confirmTransaction({signature:s,...(await conn.getLatestBlockhash())},CM) }
  const umi=createUmi(RPC,{commitment:CM}).use(mplCore())
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(deployer.secretKey)))
  const aliceU=createSignerFromKeypair(umi,umi.eddsa.createKeypairFromSecretKey(alice.secretKey))

  // collection update authority = the MINT program's PDA
  const coll=generateSigner(umi)
  await createCollection(umi,{collection:coll,name:'CBOBTC Vaults',uri:'https://cdn.gary.club/cbob/c.json',
    updateAuthority:pk(MINT_AUTH.toBase58())}).sendAndConfirm(umi,{confirm:{commitment:CM}})
  const COLL=toWeb3JsPublicKey(coll.publicKey)
  const mint=await createMint(conn,deployer,deployer.publicKey,null,8)
  const ata=(o:W)=>getAssociatedTokenAddressSync(mint,o,true)
  const declare=(p:W)=>[getAssociatedTokenAddressSync(mint,p,true),getAssociatedTokenAddressSync(mint,p,true,TOKEN_2022_PROGRAM_ID)]
  await sendAndConfirmTransaction(conn,new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,ata(deployer.publicKey),deployer.publicKey,mint),
    createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,ata(alice.publicKey),alice.publicKey,mint)),[deployer],{commitment:CM})
  await mintTo(conn,deployer,mint,ata(deployer.publicKey),deployer,10_000_000_000n,[],{commitment:CM})
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

  // ---- init: ONE write per config, by INIT_AUTHORITY, and never another ----
  // v6 has no admin, no update_config and no rotation in any program, so these
  // initializes are the whole of the configuration. Each program must refuse a
  // stranger, and must refuse for THAT reason (NotTheInitAuthority).
  const stranger=Keypair.generate()
  await conn.confirmTransaction({signature:await conn.requestAirdrop(stranger.publicKey,5*LAMPORTS_PER_SOL),
    ...(await conn.getLatestBlockhash())},CM)
  const ixMintInit=(signer:Keypair)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('initialize'),COLL.toBuffer(),gov.publicKey.toBuffer(),treasury.publicKey.toBuffer(),
      bankTreasury.publicKey.toBuffer(),swapOp.publicKey.toBuffer(),SOME(guardian.publicKey.toBuffer()),
      u64(BigInt(0.05*LAMPORTS_PER_SOL)),u64(MAX_SUPPLY),u64(SWEEP_CAP),i64(SWEEP_COOLDOWN),caps5(LEVEL_CAPS)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const mi0=await att(()=>send([ixMintInit(stranger)],[stranger]))
  rec('0.1','MINT: a stranger initializes the config','REJECT',mi0.ok?'ALLOW':'REJECT',mi0.err)
  const mi=await att(()=>send([ixMintInit(deployer)],[deployer]))
  rec('0.1a','MINT: INIT_AUTHORITY initializes it, with a guardian','ALLOW',mi.ok?'ALLOW':'REJECT',mi.err)
  if(!mi.ok){ console.log('  MINT config already exists — use a FRESH validator'); }
  {
    const c=(await conn.getAccountInfo(MINT_CFG,CM))!
    rec('0.1b','MINT: the guardian is on chain at its fixed offset',guardian.publicKey.toBase58(),
      new W(c.data.subarray(OFF_GUARDIAN,OFF_GUARDIAN+32)).toBase58())
    rec('0.1c','MINT: governance is on chain at its fixed offset (GOV reads it there)',gov.publicKey.toBase58(),
      new W(c.data.subarray(OFF_GOVERNANCE,OFF_GOVERNANCE+32)).toBase58())
    rec('0.1d','MINT: both stops start CLEAR','0,0',`${c.data[OFF_SALES_STOPPED]},${c.data[OFF_SWEEP_STOPPED]}`)
  }
  // COMMIT THE DECK BEFORE ANY MINT. `mint_vault` refuses while `deck_root` is
  // zero, deliberately: a vault minted with no committed deck carries a level
  // nobody can ever check against a prior commitment, which is the property
  // being bought.
  const commitDeck=(root:Buffer,salt:Buffer=SUITE_SALT,signer=deployer)=>send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('commit_deck'),root,salt]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false},
      {pubkey:SLOT_HASHES,isSigner:false,isWritable:false}]})],[signer])
  const commitSeed=(saltHash:Buffer,signer=deployer)=>send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('commit_seed'),saltHash]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false}]})],[signer])

  // ═══ THE COMMITMENT, IN THE ORDER IT IS ONLY EVER REACHABLE ═══
  //
  // ⚠️ ORDER IS THE WHOLE TEST DESIGN HERE, for the reason the zero-root comment
  // below already gave and which now applies to three more arms: every one of
  // these negatives is reachable in exactly one window, because each of the
  // instructions is ONE-SHOT. A negative placed after the state it needs has
  // passed does not fail — it passes for the wrong reason, which is a false pass.
  const noSeedYet=await att(()=>commitDeck(Buffer.alloc(32,7)))
  rec('2.0c','a deck committed before any SEED is REFUSED','REJECT',noSeedYet.ok?'ALLOW':'REJECT',noSeedYet.err)
  const zeroSalt=await att(()=>commitSeed(Buffer.alloc(32)))
  rec('2.0d','the all-zero salt hash, the not-committed sentinel, is REFUSED','REJECT',zeroSalt.ok?'ALLOW':'REJECT',zeroSalt.err)
  const saltHash=createHash('sha256').update(SUITE_SALT).digest()
  const strangerSeed=await att(()=>commitSeed(saltHash,stranger))
  rec('2.0l','a STRANGER commits the seed (v6: INIT_AUTHORITY only, no admin)','REJECT',strangerSeed.ok?'ALLOW':'REJECT',strangerSeed.err)
  const cs=await att(()=>commitSeed(saltHash))
  rec('2.0e','the salt hash is committed, BEFORE the slot it will be mixed with exists','ALLOW',cs.ok?'ALLOW':'REJECT',cs.err)
  const reSeed=await att(()=>commitSeed(createHash('sha256').update('other').digest()))
  rec('2.0f','...and a SECOND salt is REFUSED — a salt that can be replaced is a draw that can be repeated',
    'REJECT',reSeed.ok?'ALLOW':'REJECT',reSeed.err)

  // THE PROGRAM CHOSE THE SLOT, NOT US. Read it back and wait for it to happen.
  const cfgNow=await conn.getAccountInfo(MINT_CFG,CM)
  const deckSlot=Number(cfgNow!.data.readBigUInt64LE(OFF_DECK_SLOT))
  console.log(`  entropy slot ${deckSlot} (chosen by the program, not by this test) — waiting for it`)
  for(let i=0;i<200 && await conn.getSlot(CM)<=deckSlot;i++) await new Promise(r=>setTimeout(r,300))
  // Read the blockhash the PROGRAM will read, from the same sysvar, with the same
  // layout. Two parsers of one account, and 2.0h is what proves they agree.
  const shAcct=await conn.getAccountInfo(SLOT_HASHES,CM)
  const shN=Number(shAcct!.data.readBigUInt64LE(0))
  let entropy:Buffer|null=null
  for(let i=0;i<shN;i++){const off=8+i*40
    if(Number(shAcct!.data.readBigUInt64LE(off))===deckSlot){entropy=shAcct!.data.subarray(off+8,off+40);break}}
  rec('2.0g','the entropy slot is present in SlotHashes and carries a real blockhash',
    'true',String(!!entropy&&!entropy.equals(Buffer.alloc(32))))
  DECK_SEED=seedFrom(SUITE_SALT,entropy!)
  DECK=buildDeck(DECK_CENSUS,DECK_SEED)
  DECK_ROOT=deckRoot(DECK)

  // THE ZERO ROOT IS TESTED HERE AND NOT IN SECTION 11, because it is only
  // REACHABLE here. Once a deck is committed the one-shot check fires first and
  // the zero-root arm can never run — a negative test placed after the commit
  // passes for the wrong reason, which is a false pass.
  const zeroRoot=await att(()=>commitDeck(Buffer.alloc(32)))
  rec('2.0a','the all-zero root, the not-committed sentinel, is REFUSED','REJECT',zeroRoot.ok?'ALLOW':'REJECT',zeroRoot.err)
  // ⚠️ THE ARM THE WHOLE ROUND-20 FIX EXISTS FOR. Before this, `commit_deck` took
  // a root and stored it — any 32 bytes, from any deck, with no salt at all. A
  // Bank could hand-build a favourable deck and commit it, and because it
  // co-signs every mint it controls who arrives at which index. This is the arm
  // that says the salt must be the one whose hash was committed first.
  const wrongSalt=await att(()=>commitDeck(DECK_ROOT,createHash('sha256').update('not-the-salt').digest()))
  rec('2.0i','a deck committed with a salt that is NOT the committed one is REFUSED',
    'REJECT',wrongSalt.ok?'ALLOW':'REJECT',wrongSalt.err)
  const dc=await att(()=>commitDeck(DECK_ROOT))
  rec('2.0b','...and the real deck root is committed before any mint','ALLOW',dc.ok?'ALLOW':'REJECT',dc.err)
  // ⚠️ TWO IMPLEMENTATIONS OF ONE HASH SCHEME, AND THIS IS THE ONLY CHECK THAT
  // CAN FAIL IF THEY DRIFT. The program derived the seed in Rust from the salt
  // and the sysvar; this file derived it in JavaScript from the same two inputs.
  // Reading them side by side proves nothing. Comparing the bytes does.
  const cfgSeeded=await conn.getAccountInfo(MINT_CFG,CM)
  rec('2.0h','the seed the PROGRAM stored is byte-identical to the one bank/deck.mjs derives',
    DECK_SEED.toString('hex'),cfgSeeded!.data.subarray(OFF_DECK_SEED,OFF_DECK_SEED+32).toString('hex'))
  // ⚠️ THE SLOT ACTUALLY USED. Round 21: demanding the EXACT aimed slot could brick
  // a launch, because Solana SKIPS slots and a skipped one never gets a hash. The
  // program now takes the smallest PRODUCED slot in [aimed, aimed+64] and stores
  // THAT, so a verifier recomputing the deal reads the slot the seed was really
  // built from rather than the one that was aimed at.
  //
  // ⚠️ AND SAY WHAT THIS DOES NOT PROVE. A local validator does not skip slots on
  // demand, so on this run `used === aimed` and the SKIP BRANCH IS NOT EXERCISED.
  // What these arms pin is the invariant that survives either way — the stored
  // slot is inside the window, and it is the slot whose hash produced the stored
  // seed (2.0h). The branch itself is reasoned, not measured, and that is stated
  // here rather than left for a reader to infer from a green suite.
  const usedSlot=Number(cfgSeeded!.data.readBigUInt64LE(OFF_DECK_SLOT))
  rec('2.0j','the stored entropy slot is inside the skip window [aimed, aimed+64]',
    'true',String(usedSlot>=deckSlot&&usedSlot<=deckSlot+64))
  rec('2.0k','...and on a validator that skipped nothing it is exactly the slot aimed at',
    String(deckSlot),String(usedSlot))

  /** THE DECK INDEX IS READ OFF THE CHAIN, never tracked locally. `minted_total`
   *  advances only on a SUCCESSFUL mint, and this suite makes many mints that are
   *  meant to fail — a local counter would drift the moment one did, and every
   *  later proof would fail for a reason no assertion is about. Same reasoning as
   *  `nextProp` reading `proposal_count`. `OFF_MINTED_TOTAL` is the same fixed
   *  offset GOV reads it at. */
  const deckIdx=async()=>{const c=await conn.getAccountInfo(MINT_CFG,CM)
    return Number(c!.data.readBigUInt64LE(OFF_MINTED_TOTAL))}
  const deckArgs=async(over?:number)=>{const i=await deckIdx()
    return{lvl:over??DECK[i],pf:proofBuf(deckProof(DECK,i)),idx:i}}
  /** The `level` + `deck_proof` tail of a mint_vault blob, in ONE chain read. */
  const deckTail=async(over?:number)=>{const {lvl,pf}=await deckArgs(over); return Buffer.concat([u8b(lvl),pf])}
  // SEAL. Its reserve list is written HERE and nowhere else, so the Token-2022
  // landmine (a T22 reserve seals every vault forever) is refused at the one write
  // there is. This was 6.13, against `update_config`, which v6 deleted.
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
  if(!seal1.ok){ console.log('  SEAL config already exists — collection is immutable by design, use a FRESH validator'); }
  const ixBurnInit=(signer:Keypair)=>new TransactionInstruction({programId:BURN_PROG,
    data:Buffer.concat([d('initialize'),COLL.toBuffer()]),
    keys:[{pubkey:BURN_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const b0=await att(()=>send([ixBurnInit(stranger)],[stranger]))
  rec('0.3','BURN: a stranger initializes the config','REJECT',b0.ok?'ALLOW':'REJECT',b0.err)
  const burn1=await att(()=>send([ixBurnInit(deployer)],[deployer]))
  rec('0.3a','BURN: INIT_AUTHORITY initializes it','ALLOW',burn1.ok?'ALLOW':'REJECT',burn1.err)
  if(!burn1.ok){ console.log('  BURN config already exists — use a FRESH validator'); }

  // THE ADMIN PATHS ARE GONE, NOT MERELY GATED. Each v5 admin instruction is
  // called by its old name: an Anchor program answers an unknown discriminator
  // with InstructionFallbackNotFound, which is the proof the handler no longer
  // exists at all (a gated handler would answer with a constraint error).
  const gone=(prog:W,name:string,keys:W[])=>att(()=>send([new TransactionInstruction({programId:prog,
    data:d(name),keys:keys.map(k=>({pubkey:k,isSigner:k.equals(deployer.publicKey),isWritable:!k.equals(deployer.publicKey)}))})],[deployer]))
  const g1s=await gone(SEAL_PROG,'update_config',[SEAL_CFG,deployer.publicKey])
  rec('0.4','SEAL has NO update_config (no admin, no Bank rotation)','REJECT',g1s.ok?'ALLOW':'REJECT',g1s.err)
  const g1b=await gone(BURN_PROG,'update_config',[BURN_CFG,deployer.publicKey])
  rec('0.4a','BURN has NO update_config','REJECT',g1b.ok?'ALLOW':'REJECT',g1b.err)
  const g1m=await gone(MINT_PROG,'set_paused',[MINT_CFG,deployer.publicKey])
  rec('0.4b','MINT has NO set_paused (only the guardian\'s one-way stops)','REJECT',g1m.ok?'ALLOW':'REJECT',g1m.err)
  const g1w=await gone(MINT_PROG,'apply_pending_governance',[MINT_CFG])
  rec('0.4c','MINT has NO governance rotation','REJECT',g1w.ok?'ALLOW':'REJECT',g1w.err)
  const g1g=await gone(GOV_PROG,'update_gov_config',[GOV_CFG,deployer.publicKey])
  rec('0.4d','GOV has NO update_gov_config','REJECT',g1g.ok?'ALLOW':'REJECT',g1g.err)

  // ---- 1. governance sets the round ----
  console.log('─── 1. governance: the ONLY two fields a vote can set ───')
  const now=Math.floor(Date.now()/1000)
  const setRound=(o:number|bigint,c:number|bigint,price:bigint,cap:number,signer:Keypair)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('set_round'),i64(o),i64(c),u64(price),u32(cap)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false}]})
  const g1=await att(()=>send([setRound(now-60,now+3600,BigInt(0.05*LAMPORTS_PER_SOL),100,deployer)],[deployer]))
  rec('1.1','a NON-governor sets the round','REJECT',g1.ok?'ALLOW':'REJECT',g1.err)
  const g2=await att(()=>send([setRound(now-60,now+3600,BigInt(0.05*LAMPORTS_PER_SOL),100,gov)],[gov]))
  rec('1.2','the governance authority sets the round','ALLOW',g2.ok?'ALLOW':'REJECT',g2.err)

  // ---- 2. mint through the mint program ----
  console.log('\n─── 2. mint program ───')
  const mkVault=async(tokens=SATS,prov:[string,string][]=[],lvlOver?:number)=>{
    const asset=Keypair.generate()
    const {lvl,pf}=await deckArgs(lvlOver)
    await send([new TransactionInstruction({programId:MINT_PROG,
      data:Buffer.concat([d('mint_vault'),str('CBOBTC Vault'),str('https://cdn.gary.club/cbob/v.json'),u64(BigInt(LAMPORTS_PER_SOL)),attrs(prov),u8b(lvl),pf]),
      keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:asset.publicKey,isSigner:true,isWritable:true},
        {pubkey:COLL,isSigner:false,isWritable:true},{pubkey:alice.publicKey,isSigner:true,isWritable:false},
        {pubkey:alice.publicKey,isSigner:true,isWritable:true},
        {pubkey:REVENUE,isSigner:false,isWritable:true},
        // v6: no `bank` signer and no instructions sysvar. MINT's v5 Bank-key
        // confinement walk is gone with the Bank.
        {pubkey:SEAL_CFG,isSigner:false,isWritable:false},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
        {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[deployer,asset,alice])
    const [pdaU]=findAssetSignerPda(umi,{asset:pk(asset.publicKey.toBase58())})
    const pda=toWeb3JsPublicKey(pdaU)
    if(tokens>0n) await sendAndConfirmTransaction(conn,new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,ata(pda),pda,mint),
      createTransferInstruction(ata(deployer.publicKey),ata(pda),deployer.publicKey,tokens)),[deployer],{commitment:CM})
    return {asset:asset.publicKey,kp:asset,umiAsset:pk(asset.publicKey.toBase58()),pdaU,pda}
  }
  const tBefore=await conn.getBalance(REVENUE,CM)
  const V=await mkVault()
  rec('2.1','vault minted via the mint program','true',String(!!V.asset))
  rec('2.2','the whole mint price landed in the ONE revenue address',String(0.05*LAMPORTS_PER_SOL),String(await conn.getBalance(REVENUE,CM)-tBefore))
  const a:any=await fetchAsset(umi,V.umiAsset)
  rec('2.3','seal plugin authority is the SEAL program PDA',SEAL.toBase58().slice(0,14),String(a.permanentFreezeExecute?.authority?.address).slice(0,14))
  // ROUND 11. THE SEAL ITSELF WAS NEVER ASSERTED. 2.3 above reads the plugin's
  // AUTHORITY; nothing read its STATE. Flip `data.push(1) // frozen` to 0 in
  // `mint_vault` and every one of these assertions still passed — the one
  // property a customer's Bitcoin actually rests on was the one property a
  // green run did not test.
  rec('2.3a','the seal plugin decodes FROZEN, not merely present','true',String(a.permanentFreezeExecute?.frozen===true))
  rec('2.4','no permanent transfer delegate','true',String(!a.permanentTransferDelegate))
  const rogue=generateSigner(umi)
  const r=await att(()=>create(umi,{asset:rogue,name:'ROGUE',uri:'u',owner:aliceU.publicKey,
    collection:{publicKey:coll.publicKey,oracles:[],lifecycleHooks:[]} as any,plugins:[]}).sendAndConfirm(umi,{confirm:{commitment:CM}}))
  rec('2.5','a direct mint into the collection','REJECT',r.ok?'ALLOW':'REJECT',r.err)

  // ---- 3. seal program: redemption, the OWNER plus the programs' rules ----
  console.log('\n─── 3. seal program (v6: no Bank — the owner signs, the programs are the second party) ───')
  // `payer` defaults to the OWNER: in v6 there is no other party to pay, and a
  // redemption a member composes alone is the shape every test below must take.
  const ixOpen=(v:any,o:W,payer:W=o)=>new TransactionInstruction({programId:SEAL_PROG,data:Buffer.from(d('open_for_redemption')),keys:[
    {pubkey:v.asset,isSigner:false,isWritable:true},{pubkey:COLL,isSigner:false,isWritable:true},
    {pubkey:o,isSigner:true,isWritable:false},
    {pubkey:payer,isSigner:true,isWritable:true},{pubkey:SEAL_CFG,isSigner:false,isWritable:false},
    {pubkey:SEAL,isSigner:false,isWritable:false},{pubkey:CORE,isSigner:false,isWritable:false},
    {pubkey:SYSVAR_INSTRUCTIONS_PUBKEY,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  // v5: THE BURN IS THE TERMINAL INSTRUCTION. `ixClose` is gone with the
  // instruction it drove — SEAL has no close, and there is no way to end a
  // transaction holding a thawed vault.
  const ixBurn=(v:any,o:W,extra:W[]=[],payer:W=o)=>new TransactionInstruction({programId:BURN_PROG,
    data:Buffer.concat([d('burn_vault'),Buffer.from([extra.length])]),keys:[
    {pubkey:v.asset,isSigner:false,isWritable:true},{pubkey:COLL,isSigner:false,isWritable:true},
    {pubkey:o,isSigner:true,isWritable:false},
    {pubkey:v.pda,isSigner:false,isWritable:true},{pubkey:payer,isSigner:true,isWritable:true},
    {pubkey:BURN_CFG,isSigner:false,isWritable:false},{pubkey:SEAL_CFG,isSigner:false,isWritable:false},
    {pubkey:SYSVAR_INSTRUCTIONS_PUBKEY,isSigner:false,isWritable:false},
    {pubkey:CORE,isSigner:false,isWritable:false},
    {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
    ...extra.map(p=>({pubkey:p,isSigner:false,isWritable:true}))]})
  const sweep=(v:any,amt:bigint,lam:number,close=true)=>{
    const ixs:any[]=[]
    if(amt>0n){ ixs.push(fromWeb3JsInstruction(createTransferInstruction(ata(v.pda),ata(alice.publicKey),v.pda,amt)))
      // Closing an account that still holds a balance is Token error 0xb, so a
      // PARTIAL sweep must not attempt it — otherwise the transaction dies in the
      // sweep and says nothing about whether the BURN would have refused.
      if(close) ixs.push(fromWeb3JsInstruction(createCloseAccountInstruction(ata(v.pda),alice.publicKey,v.pda))) }
    if(lam>0) ixs.push(fromWeb3JsInstruction(SystemProgram.transfer({fromPubkey:v.pda,toPubkey:alice.publicKey,lamports:lam})))
    // `payer: aliceU`, NOT umi's identity (the deployer): in production the
    // member composes and pays for their own redemption, and in v6 there is no
    // other party in it at all. (v5 needed this so a sweep did not name the Bank
    // and trip SEAL's on-chain Bank-key confinement; that walk is gone with the
    // Bank, and the shape stays because it is what a real redemption looks like.)
    return execute(umi,{asset:{publicKey:v.umiAsset},collection:{publicKey:coll.publicKey} as any,instructions:ixs,
      signers:[createNoopSigner(v.pdaU)],authority:aliceU,payer:aliceU}).getInstructions().map(i=>new TransactionInstruction({
        programId:toWeb3JsPublicKey(i.programId),data:Buffer.from(i.data),
        keys:i.keys.map(k=>({pubkey:toWeb3JsPublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable}))}))
  }
  // ================= 3/4. THE REDEMPTION, v5: OPEN + SWEEP + BURN, ATOMIC =========
  // Gary's rule: the ONLY way to break open a vault is to burn it. There is no
  // close. The seal refuses to thaw unless this same transaction burns the vault,
  // and the burn refuses unless this same transaction thawed it.
  //
  // v6: THE OWNER IS THE ONLY SIGNER, SO THE OWNER CHECK IS THE WHOLE GATE. v5's
  // 3.1 was "redemption without the Bank's co-signature"; with no Bank, the arm
  // that matters is a stranger signing as the owner of a vault that is not theirs.
  const impostor=Keypair.generate()
  const c1=await att(()=>send([ixOpen(V,impostor.publicKey,alice.publicKey),
    ixBurn(V,impostor.publicKey,declare(V.pda),alice.publicKey)],[alice,impostor]))
  rec('3.1','a STRANGER signs as owner and redeems someone else\'s vault','REJECT',c1.ok?'ALLOW':'REJECT',c1.err)
  // THE TWO PINS THAT HOLD THE PAIRING TOGETHER. Each program carries the OTHER's
  // discriminator as a hardcoded constant — a second copy of a fact, which is the
  // class of defect round 5 found in BURN's reserve list. Assert both against the
  // Anchor derivation, or a rename silently unhooks the whole invariant.
  const SEAL_SRC=readFileSync('/opt/cbob-vaults/programs/cbob-vaults/src/lib.rs','utf8')
  const BURN_SRC=readFileSync('/opt/cbob-vaults/programs/cbob-vault-burn/src/lib.rs','utf8')
  const pinned=(src:string,name:string)=>{const i=src.indexOf(name+': [u8; 8] = [')
    if(i<0) return 'NOT FOUND'
    const at=i+name.length+13
    const body=src.slice(at,src.indexOf(']',at))
    return body.split(',').map(x=>Number(x.trim())).join(',')}
  rec('3.1a','SEAL pins the real burn_vault discriminator',[...d('burn_vault')].join(','),pinned(SEAL_SRC,'IX_BURN_VAULT_DISC'))
  rec('3.1b','BURN pins the real open_for_redemption discriminator',[...d('open_for_redemption')].join(','),pinned(BURN_SRC,'IX_OPEN_FOR_REDEMPTION_DISC'))
  // v6: SEAL's own copy of the open discriminator (3.1b2) and MINT's mint_vault
  // discriminator (3.1b3) existed only for the Bank-key confinement walks and
  // were deleted with them. GOV now carries FOUR MINT discriminators, one per
  // proposal action, and each is a second copy of a fact pinned to its derivation.
  const MINT_SRC=readFileSync('/opt/cbob-vaults/programs/cbob-vault-mint/src/lib.rs','utf8')
  const GOV_SRC=readFileSync('/opt/cbob-vaults/programs/cbob-vault-gov/src/lib.rs','utf8')
  rec('3.1j','GOV pins the real set_round discriminator',[...d('set_round')].join(','),pinned(GOV_SRC,'IX_SET_ROUND'))
  rec('3.1k','GOV pins the real restart discriminator',[...d('restart')].join(','),pinned(GOV_SRC,'IX_RESTART'))
  rec('3.1l','GOV pins the real set_guardian discriminator',[...d('set_guardian')].join(','),pinned(GOV_SRC,'IX_SET_GUARDIAN'))
  rec('3.1m','GOV pins the real update_wiring discriminator',[...d('update_wiring')].join(','),pinned(GOV_SRC,'IX_UPDATE_WIRING'))
  // ...and the ACCOUNT POSITIONS each one binds. The discriminator is derived from
  // the instruction NAME, not its account list, so a reorder keeps the same
  // discriminator and silently breaks the owner binding. These read the position
  // constants out of the source beside the "MUST stay account N" comments.
  const idx=(src:string,name:string)=>{const i=src.indexOf(name+': usize = ')
    return i<0?'NOT FOUND':src.slice(i+name.length+10,src.indexOf(';',i)).trim()}
  rec('3.1c','SEAL binds the burn asset at account 0','0',idx(SEAL_SRC,'BURN_IX_ASSET_IDX'))
  rec('3.1d','SEAL binds the burn owner at account 2','2',idx(SEAL_SRC,'BURN_IX_OWNER_IDX'))
  rec('3.1e','BURN binds the open asset at account 0','0',idx(BURN_SRC,'SEAL_IX_ASSET_IDX'))
  rec('3.1f','BURN binds the open owner at account 2','2',idx(BURN_SRC,'SEAL_IX_OWNER_IDX'))
  // v6: 3.1g/3.1h/3.1i asserted properties of `bank/cosign.mjs`, the Bank's
  // pre-signature co-signer. There is no Bank to sign, so the co-signer is being
  // retired (DESIGN-v6 build order, step 3) and its scan moves to the redeem
  // client as a warning. Its BURN_FIXED_ACCOUNTS constant is now stale (BurnVault
  // lost `bank`); listed in the stage-1 report, deliberately not edited here.

  // A HANGING OPEN. If a transaction may end with the vault thawed, the whole
  // rule is decoration.
  const o1=await att(()=>send([ixOpen(V,alice.publicKey)],[alice]))
  rec('3.6','the OWNER ALONE opens with no terminal burn in the same transaction','REJECT',o1.ok?'ALLOW':'REJECT',o1.err)
  // THE BARE EXECUTE. The seal itself, tested, with the owner as the only signer
  // and fee payer — which in v6 is every redemption's shape.
  const bare=await att(()=>send([...sweep(V,SATS,0)],[alice]))
  rec('3.7','a BARE owner Execute with no open at all (the seal, tested)','REJECT',bare.ok?'ALLOW':'REJECT',bare.err)
  // A BURN WITH NO THAW. The mirror of 3.6, and the reason every burn has one
  // recognisable shape: a burn without a paired open is a bare Core BurnV1, which
  // is the one thing this program cannot prevent and the alarm's job to see.
  const o2=await att(()=>send([ixBurn(V,alice.publicKey,declare(V.pda))],[alice]))
  rec('3.8','a BURN with no preceding open in the same transaction','REJECT',o2.ok?'ALLOW':'REJECT',o2.err)
  // THE PAIRING MUST BIND THE ASSET. A thaw of a full vault paired with the burn
  // of a DIFFERENT, already-empty one would be the whole rule defeated.
  // NOTHING IS MINTED HERE ON PURPOSE. A fresh vault moves `minted_total`, which
  // section 7 measures quorum against — round 11 lost six assertions to exactly
  // that. The decoy is a pubkey the burn instruction NAMES; `open` refuses at
  // instruction 0, so the burn never runs and the decoy never has to exist.
  const decoyKey=Keypair.generate().publicKey
  const [decoyPda]=W.findProgramAddressSync([Buffer.from('mpl-core-execute'),decoyKey.toBuffer()],CORE)
  const DECOY={asset:decoyKey,pda:decoyPda}
  const o3=await att(()=>send([ixOpen(V,alice.publicKey),...sweep(V,SATS,0),
    ixBurn(DECOY,alice.publicKey,declare(DECOY.pda))],[alice]))
  rec('3.9','thaw a FULL vault, pair it with a burn naming a DIFFERENT asset','REJECT',o3.ok?'ALLOW':'REJECT',o3.err)
  // ...AND THE OWNER. `bob` owns nothing; the burn names him where the open named
  // alice, so the two halves are not one redemption.
  const bob=Keypair.generate()
  const o4=await att(()=>send([ixOpen(V,alice.publicKey),...sweep(V,SATS,0),
    ixBurn(V,bob.publicKey,declare(V.pda))],[alice,bob]))
  rec('3.10','open names alice, burn names a different owner','REJECT',o4.ok?'ALLOW':'REJECT',o4.err)
  // ALL OR NOTHING. This is the property the close-terminated design did NOT have:
  // an owner could take half, re-seal, and resell a half-empty vault whose buyer's
  // whole basis was "it still contains its reserve". The burn refuses on any
  // balance it can see, so a partial sweep takes the thaw down with it.
  const o5=await att(()=>send([ixOpen(V,alice.publicKey),...sweep(V,SATS/2n,0,false),
    ixBurn(V,alice.publicKey,declare(V.pda))],[alice]))
  rec('3.11','a PARTIAL sweep (take half, burn the rest away)','REJECT',o5.ok?'ALLOW':'REJECT',o5.err)
  rec('3.11a','...and the vault still holds every sat',String(SATS),
    String(BigInt((await conn.getTokenAccountBalance(ata(V.pda),CM)).value.amount)))
  // A DELEGATE PLANTED DURING THE THAW would survive the vault if the vault
  // survived. It does not any more — but the check still has to fire, because a
  // delegate approved and then swept-around is a live authority at burn time.
  const dele=execute(umi,{asset:{publicKey:V.umiAsset},collection:{publicKey:coll.publicKey} as any,
    instructions:[fromWeb3JsInstruction(createApproveInstruction(ata(V.pda),gov.publicKey,V.pda,SATS))],
    signers:[createNoopSigner(V.pdaU)],authority:aliceU,payer:aliceU}).getInstructions().map(i=>new TransactionInstruction({
      programId:toWeb3JsPublicKey(i.programId),data:Buffer.from(i.data),
      keys:i.keys.map(k=>({pubkey:toWeb3JsPublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable}))}))
  // A DELEGATE IS ONLY DANGEROUS ON AN ACCOUNT THAT OUTLIVES THE VAULT, and a
  // delegate needs no Core Execute — it transfers on its own signature, so it
  // would still work after the asset is burned and the PDA is unsignable.
  // The shape that matters is therefore: plant the delegate, move the balance out
  // with the OWNER's authority (which does NOT clear the delegate), and leave the
  // token account OPEN. The burn must refuse.
  const drain=execute(umi,{asset:{publicKey:V.umiAsset},collection:{publicKey:coll.publicKey} as any,
    instructions:[fromWeb3JsInstruction(createTransferInstruction(ata(V.pda),ata(alice.publicKey),V.pda,SATS))],
    signers:[createNoopSigner(V.pdaU)],authority:aliceU,payer:aliceU}).getInstructions().map(i=>new TransactionInstruction({
      programId:toWeb3JsPublicKey(i.programId),data:Buffer.from(i.data),
      keys:i.keys.map(k=>({pubkey:toWeb3JsPublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable}))}))
  const c3=await att(()=>send([ixOpen(V,alice.publicKey),...dele,...drain,
    ixBurn(V,alice.publicKey,declare(V.pda))],[alice]))
  rec('3.3','delegate planted during the thaw, reserve ATA left OPEN','REJECT',c3.ok?'ALLOW':'REJECT',c3.err)
  // ...AND THE BENIGN SHAPE, MEASURED RATHER THAN ASSUMED. If the same redemption
  // CLOSES the token account, the reserve loop skips it (it is no longer a token
  // account) and the burn is allowed. That is correct: a delegate on an account
  // that no longer exists can do nothing, a re-created ATA is fresh with no
  // delegate, and the PDA can never sign again. Recorded as an ALLOW so nobody
  // reads 3.3 as "a delegate always stops a burn" — it stops one only while the
  // account it sits on is still there.
  const c3b=await att(()=>send([ixOpen(V,alice.publicKey),...dele,...sweep(V,SATS,0),
    ixBurn(V,alice.publicKey,declare(V.pda))],[alice]))
  rec('3.3a','...the same delegate, but the ATA is CLOSED by the sweep','ALLOW',c3b.ok?'ALLOW':'REJECT',
    `the delegated account no longer exists, so there is nothing left for it to authorise. ${c3b.err}`)

  console.log('\n─── 4. the happy path, and what it leaves behind ───')
  const H=await mkVault()
  const b1=await att(()=>send([ixOpen(H,alice.publicKey),
    ixBurn(H,alice.publicKey,declare(H.pda))],[alice]))
  rec('4.1','open + burn with the BTC still inside','REJECT',b1.ok?'ALLOW':'REJECT',b1.err)
  const before=await conn.getTokenAccountBalance(ata(alice.publicKey),CM)
  // THE ONE TRANSACTION THE WHOLE PRODUCT RESTS ON.
  const redeem=[ixOpen(H,alice.publicKey),...sweep(H,SATS,0),
    ixBurn(H,alice.publicKey,declare(H.pda))]
  // v6: THE OWNER ALONE. One signer, one fee payer, no Bank: the programs are the
  // second party, and this is the transaction every member will actually send.
  const h1=await att(()=>send(redeem,[alice]))
  rec('4.2','full redemption by the OWNER ALONE: open + sweep + burn, ONE transaction','ALLOW',h1.ok?'ALLOW':'REJECT',h1.err)
  rec('4.3','owner received the BTC','100000000',String(BigInt((await conn.getTokenAccountBalance(ata(alice.publicKey),CM)).value.amount)-BigInt(before.value.amount)))
  const hinf=await conn.getAccountInfo(H.asset,CM)
  rec('4.4','...and the vault is GONE in the same transaction','gone',(hinf&&hinf.data.length>=33&&hinf.data[0]===1)?'still live':'gone')
  rec('4.5','no vault survives emptied: its asset-signer PDA holds nothing','0',String(await conn.getBalance(H.pda,CM)))
  // v5 MADE REDEMPTION ONE TRANSACTION, SO TRANSACTION SIZE IS NOW A HARD LIMIT
  // ON THE PRODUCT — and the reserve list is additive-only, so an ordinary future
  // config change can push a redemption past it and strand every vault at once.
  // Measure it rather than assume it. This suite runs ONE reserve mint; each
  // further mint adds two declared accounts to the burn plus its own sweep.
  const sizer=new Transaction().add(...redeem)
  sizer.feePayer=alice.publicKey; sizer.recentBlockhash=(await conn.getLatestBlockhash()).blockhash
  const REDEEM_BYTES=sizer.serialize({requireAllSignatures:false,verifySignatures:false}).length
  const REDEEM_ACCTS=new Set(redeem.flatMap(i=>[i.programId.toBase58(),...i.keys.map(k=>k.pubkey.toBase58())])).size
  rec('4.6','a 1-reserve-mint redemption fits a legacy transaction (1232 bytes)','true',String(REDEEM_BYTES<=1232),
    `serialized ${REDEEM_BYTES} bytes across ${REDEEM_ACCTS} distinct accounts; headroom ${1232-REDEEM_BYTES}`)


  console.log('\n─── 5. round-4 fixes ───')
  const N=await mkVault()
  // v5: there is no close to call standalone. The property that test protected —
  // a terminal half reachable on its own — is now 3.8, and this slot tests the
  // thing that replaced it: a redemption whose halves are for the same asset but
  // whose OPEN was never authorised, i.e. a burn paired against ANOTHER vault's
  // legitimate thaw sharing the transaction.
  // NOTHING IS MINTED IN THIS SECTION. A fresh vault moves `minted_total`, which
  // section 7 measures quorum against; one extra mint here cost four governance
  // assertions on the first run of this rewrite, which is round 11's lesson
  // arriving on schedule. The cross-vault burn binding is 9.0, after governance.
  const miscount=new TransactionInstruction({...ixBurn(N,alice.publicKey,declare(N.pda)),
    data:Buffer.concat([d('burn_vault'),Buffer.from([declare(N.pda).length+1])])})
  const n1=await att(()=>send([ixOpen(N,alice.publicKey),...sweep(N,SATS,0),miscount],[alice]))
  rec('5.1','a burn declaring MORE accounts than it passes','REJECT',n1.ok?'ALLOW':'REJECT',n1.err)
  const [nPda]=W.findProgramAddressSync([Buffer.from('mpl-core-execute'),N.asset.toBuffer()],CORE)
  const brickAsset=Keypair.generate()
  const [bPda]=W.findProgramAddressSync([Buffer.from('mpl-core-execute'),brickAsset.publicKey.toBuffer()],CORE)
  const dtBrick=await deckTail()
  const n2=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('mint_vault'),str('BRICK'),str('u'),u64(BigInt(LAMPORTS_PER_SOL)),attrs([]),dtBrick]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:brickAsset.publicKey,isSigner:true,isWritable:true},
      {pubkey:COLL,isSigner:false,isWritable:true},{pubkey:bPda,isSigner:false,isWritable:false},
      {pubkey:alice.publicKey,isSigner:true,isWritable:true},
      {pubkey:REVENUE,isSigner:false,isWritable:true},{pubkey:SEAL_CFG,isSigner:false,isWritable:false},
      {pubkey:MINT_AUTH,isSigner:false,isWritable:false},{pubkey:CORE,isSigner:false,isWritable:false},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[deployer,brickAsset,alice]))
  // ⚠️ ROUND 18 RE-CREATED THE ROUND-12 DEFECT DIRECTLY BELOW, IN THIS TEST.
  // Narrowing MINT's confinement meant the Bank may no longer be a mint's PAYER,
  // so every mint site had its payer moved from `bank` to `alice` — with a blanket
  // replace. This site's signer list was `[deployer, brickAsset]` and did not include
  // her, so the transaction stopped serializing and 5.2 began failing on "Missing
  // signature" instead of reaching the program. That is EXACTLY what the comment
  // below warns about, re-introduced by the edit made underneath it. The
  // `because('5.2','AccountNotSigner')` check is the only reason it surfaced.
  // ROUND 12: this passed `bPda` with `isSigner:true`, and web3.js refuses to
  // serialize a transaction missing a required signature — so the PROGRAM WAS
  // NEVER INVOKED and the assertion would have passed identically if the owner
  // check did not exist. Sent with `isSigner:false` it reaches the program and
  // is refused by the owner-must-sign rule, which is the thing under test.
  rec('5.2','mint a vault owned by a PDA that can never sign','REJECT',n2.ok?'ALLOW':'REJECT',n2.err)
  // A REJECT FOR THE WRONG REASON IS A FALSE PASS: this now needs a REAL preceding
  // open, or `NoPrecedingOpen` fires first and the seal_config check is never
  // reached. `because('5.3','BadSealConfig')` is what proves it got there.
  const n3=await att(()=>send([ixOpen(N,alice.publicKey),...sweep(N,SATS,0),
    new TransactionInstruction({programId:BURN_PROG,
    data:Buffer.concat([d('burn_vault'),Buffer.from([2])]),keys:[
    {pubkey:N.asset,isSigner:false,isWritable:true},{pubkey:COLL,isSigner:false,isWritable:true},
    {pubkey:alice.publicKey,isSigner:true,isWritable:false},
    {pubkey:N.pda,isSigner:false,isWritable:true},{pubkey:alice.publicKey,isSigner:true,isWritable:true},
    {pubkey:BURN_CFG,isSigner:false,isWritable:false},{pubkey:MINT_CFG,isSigner:false,isWritable:false},
    {pubkey:SYSVAR_INSTRUCTIONS_PUBKEY,isSigner:false,isWritable:false},
    {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
    ...declare(N.pda).map(p=>({pubkey:p,isSigner:false,isWritable:true}))]})],[alice]))
  rec('5.3','burn with a BOGUS seal_config account','REJECT',n3.ok?'ALLOW':'REJECT',n3.err)

  // ================= 6. round-5 fixes =================
  console.log('\n─── 6. round-5 fixes ───')

  // 6.1/6.2 — set_round can no longer express "unlimited, forever"
  const g3=await att(()=>send([setRound(now-60,now+3600,BigInt(0.05*LAMPORTS_PER_SOL),0,gov)],[gov]))
  rec('6.1','set_round with cap=0 (used to mean UNLIMITED)','REJECT',g3.ok?'ALLOW':'REJECT',g3.err)
  const g4=await att(()=>send([setRound(now-60,8640000000000000,BigInt(0),100,gov)],[gov]))
  rec('6.2','set_round with a window that never closes','REJECT',g4.ok?'ALLOW':'REJECT',g4.err)

  // 6.3 — provenance stamped at mint, and what v5 does to it
  const P=await mkVault(SATS,[['charter','0042'],['notice','CBOB-NOTICE-0042']])
  const pa:any=await fetchAsset(umi,P.umiAsset)
  const asMap=(x:any)=>Object.fromEntries((x?.attributes?.attributeList||[]).map((e:any)=>[e.key,e.value]))
  const m0=asMap(pa)
  rec('6.3','provenance is stamped at mint','0042',String(m0.charter))
  rec('6.3a','...and the notice serial too','CBOB-NOTICE-0042',String(m0.notice))
  const p1=await att(()=>send([ixOpen(P,alice.publicKey),...sweep(P,SATS,0),
    ixBurn(P,alice.publicKey,declare(P.pda))],[alice]))
  rec('6.4','redeem the charter vault','ALLOW',p1.ok?'ALLOW':'REJECT',p1.err)
  // ⚠️ A BUSINESS CONSEQUENCE OF GARY'S RULE, MEASURED RATHER THAN ASSUMED.
  // Round 5 fixed `mark_opened` so a redemption PRESERVED charter provenance,
  // because the vault was stated to be the only surviving record of charter
  // membership once the Proof-of-Burn token and the Notice are destroyed. Under
  // v5 a redemption DESTROYS the vault, so it destroys that record too. The
  // on-chain history (the mint transaction, and DAS's burnt entry) is what is
  // left. That is a real trade, and it is Gary's to take — it is asserted here so
  // it can never be discovered by a charter member instead.
  const pinf=await conn.getAccountInfo(P.asset,CM)
  rec('6.5','a redeemed charter vault no longer exists','gone',(pinf&&pinf.data.length>=33&&pinf.data[0]===1)?'still live':'gone')
  const gonePa=await fetchAsset(umi,P.umiAsset).then(x=>asMap(x)).catch(()=>({} as any))
  rec('6.6','...so its stamped provenance is unreadable','undefined',String(gonePa.charter),
    `the asset account is left at key byte ${pinf?pinf.data[0]:'n/a'} (${pinf?pinf.data.length:0} bytes) and no longer decodes as an AssetV1; the mint transaction and the DAS burnt record are the only surviving charter evidence`)

  // ═══ GOVERNANCE-ONLY WIRING. v6 has no admin, so every one of these is a vote. ═══
  // While governance is still a keypair (it hands itself to the GOV program in
  // section 7), the MINT gate can be exercised directly. 8b proves the same
  // instruction reached through a ratified GOV proposal.
  const govWiring=(o:any,signer:Keypair=gov)=>new TransactionInstruction({programId:MINT_PROG,data:wiring(o),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false}]})
  // 6.8 — the lifetime supply cap actually gates, and ratchets DOWN only
  const lowered=await att(()=>send([govWiring({maxSupply:1n})],[gov]))
  rec('6.8','ratchet max_supply DOWN below what is minted','REJECT',lowered.ok?'ALLOW':'REJECT',lowered.err)
  const raised=await att(()=>send([govWiring({maxSupply:999999n})],[gov]))
  rec('6.9','RAISE max_supply above its initial value','REJECT',raised.ok?'ALLOW':'REJECT',raised.err)

  // 6.10 — who gets paid is a vote, and nobody else's to change
  const t1=await att(()=>send([govWiring({treasury:alice.publicKey},deployer)],[deployer]))
  rec('6.10','the DEPLOYER (INIT_AUTHORITY) redirects the treasury (the 85%)','REJECT',t1.ok?'ALLOW':'REJECT',t1.err)
  const t1g=await att(()=>send([govWiring({treasury:alice.publicKey},guardian)],[guardian]))
  rec('6.10a','the GUARDIAN redirects the treasury','REJECT',t1g.ok?'ALLOW':'REJECT',t1g.err)
  const t2=await att(()=>send([govWiring({treasury:treasury.publicKey})],[gov]))
  rec('6.11','governance rotates the treasury','ALLOW',t2.ok?'ALLOW':'REJECT',t2.err)
  const tEmpty=await att(()=>send([govWiring({})],[gov]))
  rec('6.11a','a wiring change that changes nothing','REJECT',tEmpty.ok?'ALLOW':'REJECT',tEmpty.err)

  // 6.12 — the payer's slippage guard
  const slipAsset=Keypair.generate()
  const dtSlip=await deckTail()
  const s1=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('mint_vault'),str('SLIP'),str('u'),u64(1n),attrs([]),dtSlip]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:slipAsset.publicKey,isSigner:true,isWritable:true},
      {pubkey:COLL,isSigner:false,isWritable:true},{pubkey:alice.publicKey,isSigner:true,isWritable:false},
      {pubkey:alice.publicKey,isSigner:true,isWritable:true},
      {pubkey:REVENUE,isSigner:false,isWritable:true},{pubkey:SEAL_CFG,isSigner:false,isWritable:false},
      {pubkey:MINT_AUTH,isSigner:false,isWritable:false},{pubkey:CORE,isSigner:false,isWritable:false},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[deployer,slipAsset,alice]))
  rec('6.12','price rose above the payer\'s stated maximum','REJECT',s1.ok?'ALLOW':'REJECT',s1.err)

  // ================= 6b. the revenue path's on-chain bounds =========
  console.log('\n─── 6b. the sweep bound, the operator, and the royalty plugin ───')
  // THE OPERATOR SIGNS as of round 7. With a cooldown in place an unsigned sweep
  // is a permanent grief handle: anyone could sweep ZERO once per window, stamp
  // last_sweep_at, and starve the real cycle for a transaction fee.
  const sweepTo=(amt:bigint,dest:W)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('sweep_sol_for_swap'),u64(amt)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},
      {pubkey:REVENUE,isSigner:false,isWritable:true},{pubkey:dest,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  await send([SystemProgram.transfer({fromPubkey:deployer.publicKey,toPubkey:REVENUE,lamports:3*LAMPORTS_PER_SOL})],[deployer])

  // THE CAP. `bank/revenue.mjs` held a 50-SOL constant and a comment claiming a
  // compromised operator key "is capped at one cycle's worth rather than the
  // whole treasury". The instruction is permissionless, so that constant bound
  // nobody: anyone could push the entire balance above reserve in one call.
  const capLow=await att(()=>send([govWiring({maxSweep:1_000_000n})],[gov]))
  rec('6.14','lower the on-chain sweep cap (governance)','ALLOW',capLow.ok?'ALLOW':'REJECT',capLow.err)
  const overCap=await att(()=>send([sweepTo(2_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('6.15','sweep MORE than the on-chain cap','REJECT',overCap.ok?'ALLOW':'REJECT',overCap.err)
  const underCap=await att(()=>send([sweepTo(1_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('6.16','sweep exactly the cap','ALLOW',underCap.ok?'ALLOW':'REJECT',underCap.err)

  // A CAP WITH NO COOLDOWN IS NOT A CAP. TWO SWEEPS IN ONE TRANSACTION SHARE A
  // TIMESTAMP, so even the 1-second floor refuses the second.
  const loop3=[sweepTo(1_000_000n,swapOp.publicKey),sweepTo(1_000_000n,swapOp.publicKey),
    sweepTo(1_000_000n,swapOp.publicKey)]
  const loopShut=await att(()=>send(loop3,[alice,swapOp]))
  rec('6.17','three sweeps in ONE transaction, each under the cap','REJECT',loopShut.ok?'ALLOW':'REJECT',loopShut.err)
  // A stranger cannot burn the window either: the destination has to sign.
  const strangerSweep=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('sweep_sol_for_swap'),u64(1_000_000n)]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:REVENUE,isSigner:false,isWritable:true},
      {pubkey:swapOp.publicKey,isSigner:false,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[alice]))
  rec('6.17a','a stranger sweeps without the operator signing','REJECT',strangerSweep.ok?'ALLOW':'REJECT',strangerSweep.err)
  const zeroSweep=await att(()=>send([sweepTo(0n,swapOp.publicKey)],[alice,swapOp]))
  rec('6.17b','a ZERO sweep, which moves nothing and burns the whole cooldown','REJECT',zeroSweep.ok?'ALLOW':'REJECT',zeroSweep.err)
  const coolUp=await att(()=>send([govWiring({sweepCooldown:3600})],[gov]))
  rec('6.18','raise the sweep cooldown to an hour','ALLOW',coolUp.ok?'ALLOW':'REJECT',coolUp.err)
  const coolZero=await att(()=>send([govWiring({sweepCooldown:0})],[gov]))
  rec('6.18a','set the cooldown to ZERO (the state the alarm calls CRITICAL)','REJECT',coolZero.ok?'ALLOW':'REJECT',coolZero.err)
  const tooSoon=await att(()=>send([sweepTo(1_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('6.19b','a single sweep inside the cooldown','REJECT',tooSoon.ok?'ALLOW':'REJECT',tooSoon.err)
  await send([govWiring({sweepCooldown:SWEEP_COOLDOWN,maxSweep:SWEEP_CAP})],[gov])

  // THE OPERATOR IS REPLACED BY A VOTE, AND IT TAKES EFFECT IMMEDIATELY.
  // v5 armed it behind a notice period because ADMIN could do it alone, and the
  // operator address is WHERE THE SWEPT SOL GOES. v6 has no admin: only a
  // ratified vote reaches this, and the vote's own voting period is the notice.
  // The emergency half is the guardian's `emergency_stop_sweep` (6c), not a
  // rotation.
  const newOp=Keypair.generate()
  const rotOp=await att(()=>send([govWiring({swapOperator:newOp.publicKey})],[gov]))
  rec('6.20','governance replaces the swap operator','ALLOW',rotOp.ok?'ALLOW':'REJECT',rotOp.err)
  {
    const c=(await conn.getAccountInfo(MINT_CFG,CM))!
    rec('6.20e','...and the new operator is live at once (no pending slot exists)',newOp.publicKey.toBase58(),
      new W(c.data.subarray(OFF_SWAP_OPERATOR,OFF_SWAP_OPERATOR+32)).toBase58())
  }
  const rotOpG=await att(()=>send([govWiring({swapOperator:alice.publicKey},guardian)],[guardian]))
  rec('6.20a','the GUARDIAN replaces the swap operator','REJECT',rotOpG.ok?'ALLOW':'REJECT',rotOpG.err)
  const overCeil=await att(()=>send([govWiring({maxSweep:BigInt(51*LAMPORTS_PER_SOL)})],[gov]))
  rec('6.20i','even GOVERNANCE cannot raise the cap past the stated 50 SOL','REJECT',overCeil.ok?'ALLOW':'REJECT',overCeil.err)
  const payMe=await att(()=>send([govWiring({treasury:alice.publicKey},alice)],[alice]))
  rec('6.21','a STRANGER redirects who gets paid','REJECT',payMe.ok?'ALLOW':'REJECT',payMe.err)
  await new Promise(r=>setTimeout(r,2500))
  const oldOpSweep=await att(()=>send([sweepTo(1_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('6.23f','sweep to the OLD operator afterwards','REJECT',oldOpSweep.ok?'ALLOW':'REJECT',oldOpSweep.err)
  const newOpSweep=await att(()=>send([sweepTo(1_000_000n,newOp.publicKey)],[alice,newOp]))
  rec('6.23g','sweep to the NEW operator','ALLOW',newOpSweep.ok?'ALLOW':'REJECT',newOpSweep.err)
  // put it back for the rest of the suite
  await send([govWiring({swapOperator:swapOp.publicKey})],[gov])
  const opNull=await att(()=>send([govWiring({swapOperator:new W('11111111111111111111111111111111')})],[gov]))
  rec('6.23d','point the swap operator at the default pubkey','REJECT',opNull.ok?'ALLOW':'REJECT',opNull.err)
  const capZero=await att(()=>send([govWiring({maxSweep:0n})],[gov]))
  rec('6.23e','set the sweep cap to zero','REJECT',capZero.ok?'ALLOW':'REJECT',capZero.err)

  // THE ROYALTY CPI. Hand-built, and until round 9 the ONLY Core opcode in the
  // codebase never executed against real Core. v6: governance alone (no admin
  // half). TODO(stage 2): a GOV proposal action for it; until then it must be
  // done before `handover_governance`, which is the order this suite uses.
  const ixRoy=(bps:number,add:boolean,g:Keypair)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('set_collection_royalties'),u16(bps),Buffer.from([add?1:0])]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:false},
      {pubkey:g.publicKey,isSigner:true,isWritable:false},{pubkey:COLL,isSigner:false,isWritable:true},
      {pubkey:g.publicKey,isSigner:true,isWritable:true},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
      {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const royHigh=await att(()=>send([ixRoy(10_000,true,gov)],[gov]))
  rec('6.24','a 100% royalty (legal in the plugin, fatal to resale)','REJECT',royHigh.ok?'ALLOW':'REJECT',royHigh.err)
  const royNoGov=await att(()=>send([ixRoy(500,true,deployer)],[deployer]))
  rec('6.25','royalties set by the DEPLOYER, not governance','REJECT',royNoGov.ok?'ALLOW':'REJECT',royNoGov.err)
  const royAdd=await att(()=>send([ixRoy(500,true,gov)],[gov]))
  rec('6.26','ADD the Royalties plugin to the collection (real Core CPI)','ALLOW',royAdd.ok?'ALLOW':'REJECT',royAdd.err)
  {
    const c=await fetchCollection(umi,coll.publicKey)
    const r:any=(c as any).royalties
    rec('6.27','Core decoded the basis points we wrote','500',String(r?.basisPoints ?? 'none'))
    // Every lamport of royalty goes through the same swap and the same enforced split.
    rec('6.28','the sole creator is THE revenue address at 100%',`${REVENUE.toBase58()}:100`,
      r?.creators?.length===1?`${r.creators[0].address}:${r.creators[0].percentage}`:'none')
  }
  const royUpd=await att(()=>send([ixRoy(750,false,gov)],[gov]))
  rec('6.29','UPDATE the existing Royalties plugin (the other opcode)','ALLOW',royUpd.ok?'ALLOW':'REJECT',royUpd.err)
  {
    const c=await fetchCollection(umi,coll.publicKey)
    rec('6.30','...and Core decoded the new value','750',String((c as any).royalties?.basisPoints ?? 'none'))
  }

  // The one-year round bound is computed on caller-supplied timestamps that can
  // straddle the whole i64 range; `checked_sub` makes the refusal the program's own.
  const ovf=await att(()=>send([setRound(-1,9223372036854775807n,0n,10,gov)],[gov]))
  rec('6.31','set_round with opens_at=-1 and closes_at=i64::MAX','REJECT',ovf.ok?'ALLOW':'REJECT',ovf.err)

  // THE ALARM'S APPROVE DETECTOR keys on `parsed.info.owner`. Measure it against
  // the REAL parser rather than assuming.
  {
    const probeAta=ata(alice.publicKey)
    const sig=await send([createApproveInstruction(probeAta,deployer.publicKey,alice.publicKey,1n)],[alice])
    const tx=await conn.getParsedTransaction(sig,{commitment:CM,maxSupportedTransactionVersion:0})
    const ix:any=(tx!.transaction.message.instructions as any[]).find(i=>i.parsed?.type==='approve')
    rec('6.32','a REAL jsonParsed approve carries info.owner','true',String(!!ix?.parsed?.info?.owner))
  }

  // A reserve between zero and rent exemption wedges every sweep forever: the
  // transfer would leave a rent-paying account and the runtime refuses it.
  const badReserve=await att(()=>send([govWiring({solReserve:1000n})],[gov]))
  rec('6.34','a SOL reserve between zero and rent exemption','REJECT',badReserve.ok?'ALLOW':'REJECT',badReserve.err)
  const okReserve=await att(()=>send([govWiring({solReserve:BigInt(0.05*LAMPORTS_PER_SOL)})],[gov]))
  rec('6.34a','a reserve above rent exemption','ALLOW',okReserve.ok?'ALLOW':'REJECT',okReserve.err)

  // ═══ 6c. THE GUARDIAN: it can STOP, and that is ALL it can do ═══
  //
  // Gary, 2026-10-03: "my wallet keep the privileges to stop a sell in an
  // emergency but that's all. It can't turn back on without a vote. But it CAN
  // stop if there's an emergency." Every arm below is one clause of that
  // sentence, proven in both directions. NOTHING IS MINTED HERE (a refused mint
  // does not move `minted_total`), because section 7's quorum is measured
  // against it.
  console.log('\n─── 6c. the guardian: one-way stops, and only a vote restarts ───')
  const ixStop=(what:'sales'|'sweep',signer:Keypair)=>new TransactionInstruction({programId:MINT_PROG,
    data:d(what==='sales'?'emergency_stop_sales':'emergency_stop_sweep'),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false}]})
  const ixRestart=(sales:boolean,sweep:boolean,signer:Keypair)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('restart'),Buffer.from([sales?1:0,sweep?1:0])]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false}]})
  const ixSetGuardian=(g:W|null,signer:Keypair)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('set_guardian'),g?SOME(g.toBuffer()):NONE]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false}]})
  const stops=async()=>{const c=(await conn.getAccountInfo(MINT_CFG,CM))!
    return `${c.data[OFF_SALES_STOPPED]},${c.data[OFF_SWEEP_STOPPED]}`}
  const guardianNow=async()=>new W((await conn.getAccountInfo(MINT_CFG,CM))!.data.subarray(OFF_GUARDIAN,OFF_GUARDIAN+32)).toBase58()
  const tryMint=async()=>{try{ await mkVault(0n); return {ok:true,err:''} }catch(e:any){
    return {ok:false,err:((e?.logs||[]).filter((x:string)=>/Error Code/.test(x)).join(' | ')||String(e?.message||e)).slice(0,220)}}}

  const gs0=await att(()=>send([ixStop('sales',alice)],[alice]))
  rec('6c.1','a STRANGER pulls the sales brake','REJECT',gs0.ok?'ALLOW':'REJECT',gs0.err)
  const gs0g=await att(()=>send([ixStop('sales',gov)],[gov]))
  rec('6c.2','GOVERNANCE pulls the sales brake (the brake is the guardian\'s, not a vote\'s)','REJECT',gs0g.ok?'ALLOW':'REJECT',gs0g.err)
  const gs1=await att(()=>send([ixStop('sales',guardian)],[guardian]))
  rec('6c.3','the GUARDIAN stops sales, immediately, alone','ALLOW',gs1.ok?'ALLOW':'REJECT',gs1.err)
  rec('6c.4','...and the sales flag is set, the sweep flag is not','1,0',await stops())
  const gm=await tryMint()
  rec('6c.5','a mint while sales are stopped','REJECT',gm.ok?'ALLOW':'REJECT',gm.err)
  const gs2=await att(()=>send([ixStop('sweep',guardian)],[guardian]))
  rec('6c.6','the GUARDIAN stops the SOL sweep (the stolen-operator-key answer)','ALLOW',gs2.ok?'ALLOW':'REJECT',gs2.err)
  await new Promise(r=>setTimeout(r,2500))
  const gsw=await att(()=>send([sweepTo(1_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('6c.7','a sweep while the sweep is stopped','REJECT',gsw.ok?'ALLOW':'REJECT',gsw.err)
  // "IT CAN'T TURN BACK ON WITHOUT A VOTE." The guardian holds no other door.
  const gr0=await att(()=>send([ixRestart(true,true,guardian)],[guardian]))
  rec('6c.8','the GUARDIAN tries to restart (it cannot turn anything back on)','REJECT',gr0.ok?'ALLOW':'REJECT',gr0.err)
  const gg0=await att(()=>send([ixSetGuardian(alice.publicKey,guardian)],[guardian]))
  rec('6c.9','the GUARDIAN tries to hand the brake to someone else','REJECT',gg0.ok?'ALLOW':'REJECT',gg0.err)
  const gw0=await att(()=>send([govWiring({sweepCooldown:7200},guardian)],[guardian]))
  rec('6c.10','the GUARDIAN tries to change the wiring','REJECT',gw0.ok?'ALLOW':'REJECT',gw0.err)
  rec('6c.10a','...and after all of that both stops are still set','1,1',await stops())
  // "IT TOUCHES NOTHING A HOLDER OWNS." With BOTH stops set, the owner alone
  // still redeems — N has held a full Bitcoin since section 5.
  const nBefore=BigInt((await conn.getTokenAccountBalance(ata(alice.publicKey),CM)).value.amount)
  const gRedeem=await att(()=>send([ixOpen(N,alice.publicKey),...sweep(N,SATS,0),
    ixBurn(N,alice.publicKey,declare(N.pda))],[alice]))
  rec('6c.11','REDEMPTION by the owner alone while BOTH stops are set','ALLOW',gRedeem.ok?'ALLOW':'REJECT',gRedeem.err)
  rec('6c.11a','...and the owner got the whole Bitcoin out',String(SATS),
    String(BigInt((await conn.getTokenAccountBalance(ata(alice.publicKey),CM)).value.amount)-nBefore))
  // ONLY A VOTE RESTARTS, and it restarts exactly what it names.
  const gr1=await att(()=>send([ixRestart(false,false,gov)],[gov]))
  rec('6c.12','governance "restarts" nothing','REJECT',gr1.ok?'ALLOW':'REJECT',gr1.err)
  const gr2=await att(()=>send([ixRestart(true,false,gov)],[gov]))
  rec('6c.13','GOVERNANCE restarts sales','ALLOW',gr2.ok?'ALLOW':'REJECT',gr2.err)
  rec('6c.14','...and only sales: the sweep is still stopped','0,1',await stops())
  const gr3=await att(()=>send([ixRestart(false,true,gov)],[gov]))
  rec('6c.15','GOVERNANCE restarts the sweep','ALLOW',gr3.ok?'ALLOW':'REJECT',gr3.err)
  rec('6c.15a','...and both are clear','0,0',await stops())
  await new Promise(r=>setTimeout(r,2500))
  const gsw2=await att(()=>send([sweepTo(1_000_000n,swapOp.publicKey)],[alice,swapOp]))
  rec('6c.16','...and the sweep works again','ALLOW',gsw2.ok?'ALLOW':'REJECT',gsw2.err)
  // THE CURE FOR A STOLEN GUARDIAN KEY: a vote replaces it.
  const gg1=await att(()=>send([ixSetGuardian(guardian2.publicKey,gov)],[gov]))
  rec('6c.17','GOVERNANCE replaces the guardian','ALLOW',gg1.ok?'ALLOW':'REJECT',gg1.err)
  rec('6c.17a','...and the new guardian is on chain',guardian2.publicKey.toBase58(),await guardianNow())
  const gs3=await att(()=>send([ixStop('sales',guardian)],[guardian]))
  rec('6c.18','the OLD guardian pulls the brake','REJECT',gs3.ok?'ALLOW':'REJECT',gs3.err)
  const gs4=await att(()=>send([ixStop('sales',guardian2)],[guardian2]))
  rec('6c.19','the NEW guardian pulls the brake','ALLOW',gs4.ok?'ALLOW':'REJECT',gs4.err)
  // ...AND A VOTE CAN RETIRE THE BRAKE ENTIRELY.
  const gg2=await att(()=>send([ixSetGuardian(null,gov)],[gov]))
  rec('6c.20','GOVERNANCE retires the brake (guardian = None)','ALLOW',gg2.ok?'ALLOW':'REJECT',gg2.err)
  rec('6c.20a','...and no guardian is on chain','11111111111111111111111111111111',await guardianNow())
  const gs5=await att(()=>send([ixStop('sweep',guardian2)],[guardian2]))
  rec('6c.21','...after which NOBODY can pull it, not even the last guardian','REJECT',gs5.ok?'ALLOW':'REJECT',gs5.err)
  // Restore for the rest of the suite: sales running, the original guardian back.
  await send([ixRestart(true,false,gov),ixSetGuardian(guardian.publicKey,gov)],[gov])
  rec('6c.22','...and the suite continues with sales running and the original guardian','0,0|'+guardian.publicKey.toBase58(),
    `${await stops()}|${await guardianNow()}`)

  // A REJECT for the wrong reason is a FALSE PASS. 6.8/6.9/6.10 originally
  // "passed" on AccountNotEnoughKeys — Anchor bouncing a short account list
  // before the handler ran — so they proved nothing about the supply cap.
  const because=(id:string,code:string)=>{const r=R.find(x=>x.id===id)
    const hit=(r?.n||'').includes(code); R.push({id:id+'!',t:`  ↳ rejected because ${code}`,want:'true',got:String(hit),ok:hit,n:r?.n})
    // A FAILING `because` THAT DOES NOT SAY WHAT THE REASON WAS is a dead end:
    // it tells you the assertion is wrong and nothing about which way. Print the
    // actual rejection so the next person does not have to re-run the suite.
    console.log(`  ${hit?'ok  ':'XX  '}${id}!  rejected because ${code}  [got ${hit}]${hit?'':`\n        ACTUAL: ${(r?.n||'(no error recorded)').slice(0,300)}`}`)}
  console.log('\n─── 6d. the negative tests rejected for the RIGHT reason ───')
  // Init and the deleted admin paths.
  because('0.1','NotTheInitAuthority'); because('0.2','NotTheInitAuthority'); because('0.3','NotTheInitAuthority')
  because('0.4','InstructionFallbackNotFound'); because('0.4a','InstructionFallbackNotFound')
  because('0.4b','InstructionFallbackNotFound'); because('0.4c','InstructionFallbackNotFound')
  because('0.4d','InstructionFallbackNotFound'); because('2.0l','NotTheInitAuthority')
  because('6.1','BadCap'); because('6.2','BadWindow')
  because('6.8','BadSupplyCap'); because('6.9','BadSupplyCap')
  because('6.10','ConstraintHasOne'); because('6.10a','ConstraintHasOne'); because('6.11a','NothingToDo')
  because('6.12','PriceAboveMax')
  because('6.15','SweepAboveCap'); because('6.17','SweepTooSoon'); because('6.19b','SweepTooSoon')
  because('6.17a','AccountNotSigner'); because('6.17b','SweepAboveCap')
  because('6.18a','BadSweepBound'); because('6.20a','ConstraintHasOne'); because('6.20i','BadSweepBound')
  because('3.7','custom program error: 0x9'); because('5.2','AccountNotSigner')
  because('1.1','ConstraintHasOne'); because('2.5','custom program error: 0x1a')
  because('6.21','ConstraintHasOne'); because('6.23f','WrongTreasury')
  because('6.23d','WrongTreasury'); because('6.23e','BadSweepBound')
  because('6.34','BadSweepBound')
  because('6.24','BadRoyalty'); because('6.25','ConstraintHasOne')
  because('6.31','BadWindow')
  because('6.13','ReserveMintNotClassicSpl'); because('5.3','BadSealConfig')
  // The guardian, clause by clause.
  because('6c.1','NotTheGuardian'); because('6c.2','NotTheGuardian'); because('6c.5','SalesStopped')
  because('6c.7','SweepStopped'); because('6c.8','ConstraintHasOne'); because('6c.9','ConstraintHasOne')
  because('6c.10','ConstraintHasOne'); because('6c.12','NothingToDo')
  because('6c.18','NotTheGuardian'); because('6c.21','NotTheGuardian')


  // ================= 7. GOVERNANCE: one vault, one vote =================
  console.log('\n─── 7. governance program (per-vault voting, vote bound to the ASSET) ───')
  const VOTE_SECS=60
  const ixGovInit=(signer:Keypair,quorum:number)=>new TransactionInstruction({programId:GOV_PROG,
    data:Buffer.concat([d('initialize'),COLL.toBuffer(),u16(quorum),u16(6000),i64(VOTE_SECS)]),
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const gi0=await att(()=>send([ixGovInit(stranger,3000)],[stranger]))
  rec('7.0','GOV: a stranger initializes the config','REJECT',gi0.ok?'ALLOW':'REJECT',gi0.err)
  // A QUORUM THAT ROUNDS DOWN TO NOTHING IS NOT A QUORUM. v5 refused 1bp on the
  // admin's update path; v6 has no update path, so the floor binds at the one
  // write there is.
  const qFloor=await att(()=>send([ixGovInit(deployer,1)],[deployer]))
  rec('7.12e','GOV: initialize with quorum at 1 basis point (arithmetic, not policy)','REJECT',qFloor.ok?'ALLOW':'REJECT',qFloor.err)
  const gi=await att(()=>send([ixGovInit(deployer,3000)],[deployer]))
  rec('7.1','governance program initialised','ALLOW',gi.ok?'ALLOW':'REJECT',gi.err)

  const A=await mkVault(0n), B=await mkVault(0n)
  const propId=(n:number)=>W.findProgramAddressSync([Buffer.from('proposal'),u64(n)],GOV_PROG)[0]
  const nowG=Math.floor(Date.now()/1000)
  /** The next proposal id, read off the config. Hardcoding it breaks the moment
   *  a create fails, because `proposal_count` only advances on success. v6
   *  GovConfig: version[8] collection[9..41] quorum[41..43] threshold[43..45]
   *  min_voting[45..53] proposal_count[53..61]. */
  const nextProp=async()=>{const c=await conn.getAccountInfo(GOV_CFG,CM)
    return Number(c!.data.readBigUInt64LE(53))+1}
  const propNow=()=>Math.floor(Date.now()/1000)
  // ProposalAction, Borsh: tag 0 SetRound | 1 Brakes | 2 UpdateWiring.
  // ⚠️ THE ROUND OPENS IN THE PAST ON PURPOSE: section 9 mints against the round
  // this proposal installs, and v5's suite only got away with a future opens_at
  // because it spent two minutes waiting out rotation timelocks v6 deleted.
  const actRound=(price=BigInt(0.02*LAMPORTS_PER_SOL),cap=50,o=nowG-60,c=nowG+7200)=>
    Buffer.concat([u8b(0),i64(o),i64(c),u64(price),u32(cap)])
  const actBrakes=(o:{sales?:boolean,sweep?:boolean,guardian?:W|null})=>Buffer.concat([u8b(1),
    u8b(o.sales?1:0),u8b(o.sweep?1:0),u8b(o.guardian!==undefined?1:0),o.guardian?SOME(o.guardian.toBuffer()):NONE])
  const actWiring=(o:any)=>Buffer.concat([u8b(2),wiringArgs(o)])
  const ixPropA=(id:number,asset:W,who:Keypair,ends:number,action:Buffer)=>new TransactionInstruction({programId:GOV_PROG,
    data:Buffer.concat([d('create_proposal'),action,i64(ends)]),
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:true},{pubkey:propId(id),isSigner:false,isWritable:true},
      {pubkey:MINT_CFG,isSigner:false,isWritable:false},
      {pubkey:asset,isSigner:false,isWritable:false},{pubkey:who.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const ixProp=(id:number,asset:W,who:Keypair,ends:number,cap=50)=>ixPropA(id,asset,who,ends,actRound(BigInt(0.02*LAMPORTS_PER_SOL),cap))
  const gp1=await att(()=>send([ixProp(1,A.asset,alice,nowG+VOTE_SECS+5)],[alice]))
  rec('7.3','a vault holder creates a proposal','ALLOW',gp1.ok?'ALLOW':'REJECT',gp1.err)
  const gp2=await att(()=>send([ixProp(2,A.asset,deployer,nowG+VOTE_SECS+5)],[deployer]))
  rec('7.4','a NON-holder creates a proposal','REJECT',gp2.ok?'ALLOW':'REJECT',gp2.err)

  const voteRec=(prop:W,asset:W)=>W.findProgramAddressSync([Buffer.from('vote'),prop.toBuffer(),asset.toBuffer()],GOV_PROG)[0]
  const ixVote=(prop:W,v:any,who:Keypair,support:boolean)=>new TransactionInstruction({programId:GOV_PROG,
    data:Buffer.concat([d('cast_vote'),Buffer.from([support?1:0])]),
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:false},{pubkey:prop,isSigner:false,isWritable:true},
      {pubkey:voteRec(prop,v.asset),isSigner:false,isWritable:true},{pubkey:v.asset,isSigner:false,isWritable:false},
      {pubkey:who.publicKey,isSigner:true,isWritable:false},{pubkey:deployer.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})
  const P1=propId(1)
  const v0=await att(()=>send([ixVote(P1,A,deployer,true)],[deployer]))
  rec('7.5','a NON-owner votes with someone else\'s vault','REJECT',v0.ok?'ALLOW':'REJECT',v0.err)
  const v1=await att(()=>send([ixVote(P1,A,alice,true)],[deployer,alice]))
  rec('7.6','the owner votes','ALLOW',v1.ok?'ALLOW':'REJECT',v1.err)
  const v2=await att(()=>send([ixVote(P1,A,alice,true)],[deployer,alice]))
  rec('7.7','the SAME vault votes twice','REJECT',v2.ok?'ALLOW':'REJECT',v2.err)

  // THE BINDING: transfer the voted vault, then have the NEW owner vote again.
  const carol=Keypair.generate()
  await conn.confirmTransaction({signature:await conn.requestAirdrop(carol.publicKey,5*LAMPORTS_PER_SOL),
    ...(await conn.getLatestBlockhash())},CM)
  const xfer=await att(()=>transfer(umi,{asset:{publicKey:A.umiAsset,owner:aliceU.publicKey} as any,
    collection:{publicKey:coll.publicKey} as any,newOwner:pk(carol.publicKey.toBase58()),authority:aliceU})
    .sendAndConfirm(umi,{confirm:{commitment:CM}}))
  rec('7.8','transfer the already-voted vault to a new owner','ALLOW',xfer.ok?'ALLOW':'REJECT',xfer.err)
  const v3=await att(()=>send([ixVote(P1,A,carol,true)],[deployer,carol]))
  rec('7.9','NEW owner votes again with the same vault (double-vote by transfer)','REJECT',v3.ok?'ALLOW':'REJECT',v3.err)

  const v4=await att(()=>send([ixVote(P1,B,alice,true)],[deployer,alice]))
  rec('7.10','a DIFFERENT vault votes on the same proposal','ALLOW',v4.ok?'ALLOW':'REJECT',v4.err)

  const ixExec=(prop:W)=>new TransactionInstruction({programId:GOV_PROG,data:Buffer.from(d('execute_proposal')),
    keys:[{pubkey:GOV_CFG,isSigner:false,isWritable:true},{pubkey:prop,isSigner:false,isWritable:true},
      {pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:GOV_PDA,isSigner:false,isWritable:false},
      {pubkey:MINT_PROG,isSigner:false,isWritable:false}]})
  const e0=await att(()=>send([ixExec(P1)],[deployer]))
  rec('7.11','execute while voting is still open','REJECT',e0.ok?'ALLOW':'REJECT',e0.err)

  const gp3=await att(()=>send([ixProp(2,B.asset,alice,nowG+VOTE_SECS+5)],[alice]))
  rec('7.12','a second proposal, which nobody will vote on','ALLOW',gp3.ok?'ALLOW':'REJECT',gp3.err)

  // A PROPOSAL WHOSE ROUND IS ALREADY OVER. `set_round` only checks
  // `closes_at > opens_at`, so a ratified proposal could install a window that
  // had already expired — wiping the live round and stopping the sale on a
  // technicality.
  const gp4=await att(()=>send([ixPropA(3,A.asset,carol,nowG+VOTE_SECS+5,actRound(0n,10,nowG-600,nowG-300))],[carol]))
  rec('7.12a','a proposal for a round that has ALREADY closed can be created','ALLOW',gp4.ok?'ALLOW':'REJECT',gp4.err)
  const P3=propId(3)
  await att(()=>send([ixVote(P3,A,carol,true)],[deployer,carol]))
  await att(()=>send([ixVote(P3,B,alice,true)],[deployer,alice]))

  // TWO MORE RATIFIED PROPOSALS, so execution order can be tested. Each set_round
  // resets minted_this_round, so an older proposal executed after a newer one both
  // reinstates a superseded decision and hands the round its cap again.
  const idP4=await nextProp()
  await att(()=>send([ixProp(idP4,A.asset,carol,propNow()+VOTE_SECS+5)],[carol]))
  const idP5=await nextProp()
  await att(()=>send([ixProp(idP5,A.asset,carol,propNow()+VOTE_SECS+5)],[carol]))
  for(const id of [idP4,idP5]){
    await att(()=>send([ixVote(propId(id),A,carol,true)],[deployer,carol]))
    await att(()=>send([ixVote(propId(id),B,alice,true)],[deployer,alice]))
  }

  // A PRE-FUNDED PDA. Round 7 was told this bricks proposal creation forever,
  // because Anchor `init` cannot allocate an account that already holds lamports.
  // Settle it by DOING it rather than by reasoning about Anchor.
  const idP7=await nextProp()
  await send([SystemProgram.transfer({fromPubkey:deployer.publicKey,toPubkey:propId(idP7),lamports:2_000_000})],[deployer])
  const gp7=await att(()=>send([ixProp(idP7,A.asset,carol,propNow()+VOTE_SECS+5)],[carol]))
  rec('7.12d','create a proposal at a PDA a griefer pre-funded','ALLOW',gp7.ok?'ALLOW':'REJECT',gp7.err)

  // ═══ THE v6 ACTIONS. Three ratified proposals that section 8b executes, in id
  // order, AFTER the guardian has stopped things: the only way back is a vote, so
  // the vote has to be shown to work end to end through the GOV PDA, not only
  // against a keypair standing in for governance (6c). ═══
  const idE1=await nextProp()
  const emptyBrakes=await att(()=>send([ixPropA(idE1,A.asset,carol,propNow()+VOTE_SECS+5,actBrakes({}))],[carol]))
  rec('7.27','a Brakes proposal that restarts nothing and replaces nobody','REJECT',emptyBrakes.ok?'ALLOW':'REJECT',emptyBrakes.err)
  const idE2=await nextProp()
  const emptyWiring=await att(()=>send([ixPropA(idE2,A.asset,carol,propNow()+VOTE_SECS+5,actWiring({}))],[carol]))
  rec('7.27a','an UpdateWiring proposal that changes nothing','REJECT',emptyWiring.ok?'ALLOW':'REJECT',emptyWiring.err)
  const idPW=await nextProp()
  const gpW=await att(()=>send([ixPropA(idPW,A.asset,carol,propNow()+VOTE_SECS+5,actWiring({sweepCooldown:2}))],[carol]))
  rec('7.28','an UpdateWiring proposal (sweep cooldown -> 2s)','ALLOW',gpW.ok?'ALLOW':'REJECT',gpW.err)
  // THE STOLEN-GUARDIAN CURE, ONE PROPOSAL: replace the guardian AND restart both.
  const idPB1=await nextProp()
  const gpB1=await att(()=>send([ixPropA(idPB1,A.asset,carol,propNow()+VOTE_SECS+5,
    actBrakes({sales:true,sweep:true,guardian:guardian2.publicKey}))],[carol]))
  rec('7.29','a Brakes proposal: replace the guardian AND restart sales and sweep','ALLOW',gpB1.ok?'ALLOW':'REJECT',gpB1.err)
  // ...and RETIRING the brake, with sales restarted, so section 9 can mint.
  const idPB2=await nextProp()
  const gpB2=await att(()=>send([ixPropA(idPB2,A.asset,carol,propNow()+VOTE_SECS+5,
    actBrakes({sales:true,guardian:null}))],[carol]))
  rec('7.30','a Brakes proposal: retire the guardian (None) and restart sales','ALLOW',gpB2.ok?'ALLOW':'REJECT',gpB2.err)
  for(const id of [idPW,idPB1,idPB2]){
    await att(()=>send([ixVote(propId(id),A,carol,true)],[deployer,carol]))
    await att(()=>send([ixVote(propId(id),B,alice,true)],[deployer,alice]))
  }
  const lastEnds=propNow()+VOTE_SECS+5

  // ═══ THE HANDOVER: governance gives itself to the vault-holder vote, ONE WAY ═══
  // Stage-1 scaffolding (see MINT `initialize`): the first round needs a signer
  // before any vault, and so any voter, exists. The only value this can write is
  // the GOV PDA, and once it lands the keypair is never governance again.
  const ixHandover=(signer:Keypair)=>new TransactionInstruction({programId:MINT_PROG,data:d('handover_governance'),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false}]})
  const ho0=await att(()=>send([ixHandover(deployer)],[deployer]))
  rec('7.2','a NON-governance key hands governance over','REJECT',ho0.ok?'ALLOW':'REJECT',ho0.err)
  const ho0g=await att(()=>send([ixHandover(guardian)],[guardian]))
  rec('7.2a','the GUARDIAN hands governance over','REJECT',ho0g.ok?'ALLOW':'REJECT',ho0g.err)
  const ho1=await att(()=>send([ixHandover(gov)],[gov]))
  rec('7.2b','governance hands itself to the GOV program, one way','ALLOW',ho1.ok?'ALLOW':'REJECT',ho1.err)
  {
    const c=(await conn.getAccountInfo(MINT_CFG,CM))!
    rec('7.2c','governance is now the GOV program PDA',GOV_PDA.toBase58(),
      new W(c.data.subarray(OFF_GOVERNANCE,OFF_GOVERNANCE+32)).toBase58())
  }
  const oldGov=await att(()=>send([setRound(nowG-60,nowG+3600,0n,10,gov)],[gov]))
  rec('7.2d','the OLD governance key can no longer set a round','REJECT',oldGov.ok?'ALLOW':'REJECT',oldGov.err)
  const ho2=await att(()=>send([ixHandover(gov)],[gov]))
  rec('7.2e','...nor hand over again','REJECT',ho2.ok?'ALLOW':'REJECT',ho2.err)

  const waitMs=(nowG+VOTE_SECS+8)*1000-Date.now()
  console.log(`  (waiting ${Math.max(0,Math.round(waitMs/1000))}s for the voting window to close — the execute path is worth actually running)`)
  if(waitMs>0) await new Promise(r=>setTimeout(r,waitMs))

  const cfgBefore=await conn.getAccountInfo(MINT_CFG,CM)
  const roundBefore=cfgBefore!.data.readUInt32LE(OFF_ROUND_ID)
  const e1=await att(()=>send([ixExec(propId(2))],[deployer]))
  rec('7.13','execute a proposal with ZERO votes','REJECT',e1.ok?'ALLOW':'REJECT',e1.err)
  const e1b=await att(()=>send([ixExec(P3)],[deployer]))
  rec('7.13a','execute a RATIFIED proposal whose round already closed','REJECT',e1b.ok?'ALLOW':'REJECT',e1b.err)

  // A PDA HAS NO KEY. Once governance IS the GOV program's PDA, a top-level
  // `update_wiring` naming it can never be signed — the only route is a ratified
  // proposal's CPI (8b proves that route).
  const afterRot=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:wiring({treasury:alice.publicKey}),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:GOV_PDA,isSigner:false,isWritable:false}]})],[deployer]))
  rec('7.18','rotate the treasury by naming the GOV PDA, which cannot sign','REJECT',
    afterRot.ok?'ALLOW':'REJECT',afterRot.err)
  const e2=await att(()=>send([ixExec(P1)],[deployer]))
  rec('7.14','execute a ratified proposal','ALLOW',e2.ok?'ALLOW':'REJECT',e2.err)
  const cfgAfter=await conn.getAccountInfo(MINT_CFG,CM)
  rec('7.15','MINT round_id advanced (the vote actually set the round)',String(roundBefore+1),
      String(cfgAfter!.data.readUInt32LE(OFF_ROUND_ID)))
  rec('7.16','MINT price is now the proposal price',String(0.02*LAMPORTS_PER_SOL),
      String(Number(cfgAfter!.data.readBigUInt64LE(OFF_PRICE))))
  const e3=await att(()=>send([ixExec(P1)],[deployer]))
  rec('7.17','execute the same proposal twice','REJECT',e3.ok?'ALLOW':'REJECT',e3.err)

  // EXECUTION ONLY MOVES FORWARD. Two proposals passed; the later one is the
  // decision, and the earlier one must not be able to reinstate itself later.
  // ⚠️ WAIT FOR THEIR WINDOWS. idP4/idP5 were opened after `nowG`, so they close
  // after the wait above. v5's suite never saw this because it spent ~120s waiting
  // out a governance-rotation timelock here; v6 deleted the timelock, and the
  // first v6 run failed 7.25 on VotingOpen — a reject for a reason the test is
  // not about.
  while(Math.floor(Date.now()/1000)<=lastEnds+1) await new Promise(r=>setTimeout(r,1000))
  const e5=await att(()=>send([ixExec(propId(idP5))],[deployer]))
  rec('7.25','execute the NEWER of two ratified proposals','ALLOW',e5.ok?'ALLOW':'REJECT',e5.err)
  const e4=await att(()=>send([ixExec(propId(idP4))],[deployer]))
  rec('7.26','then execute the OLDER one','REJECT',e4.ok?'ALLOW':'REJECT',e4.err)

  // ================= 8. REVENUE: one address in, 85/15 out =================
  console.log('\n─── 8. revenue: one address in, enforced 85/15 out ───')
  const holdersAta=getAssociatedTokenAddressSync(mint,treasury.publicKey,true)
  const bankAta=getAssociatedTokenAddressSync(mint,bankTreasury.publicKey,true)
  const revAta=getAssociatedTokenAddressSync(mint,REVENUE,true)
  await send([createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,revAta,REVENUE,mint),
              createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,holdersAta,treasury.publicKey,mint),
              createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,bankAta,bankTreasury.publicKey,mint)],[deployer])
  const INCOME=1_000_000_000n   // stands in for swapped cbBTC arriving from any source
  await send([createTransferInstruction(ata(deployer.publicKey),revAta,deployer.publicKey,INCOME)],[deployer])
  const bal=async(x:W)=>BigInt((await conn.getTokenAccountBalance(x,CM)).value.amount)
  rec('8.1','income arrived at the revenue address',String(INCOME),String(await bal(revAta)))
  const ixSplit=new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('split_revenue'),Buffer.from([8])]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:false},{pubkey:REVENUE,isSigner:false,isWritable:true},
      {pubkey:mint,isSigner:false,isWritable:false},{pubkey:revAta,isSigner:false,isWritable:true},
      {pubkey:holdersAta,isSigner:false,isWritable:true},{pubkey:bankAta,isSigner:false,isWritable:true},
      {pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false}]})
  // ROUND 12: NOT ONE NEGATIVE ASSERTION EXISTED ON THIS INSTRUCTION'S ACCOUNT
  // PINNING, and it is the only instruction that can move cbBTC out of the
  // revenue PDA. "Destinations are pinned" was a claim 8.2's own title made and
  // the suite never tested. These run BEFORE the honest split, because that one
  // drains the ATA and a second funding round would double 8.3/8.4's expected
  // balances — a test that MOVES MONEY has a side effect on every later test
  // that counts it, which is the same trap round 11 hit with minted_total.
  const splitTo=(rev:W,hold:W,bnk:W)=>new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('split_revenue'),Buffer.from([8])]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:false},{pubkey:REVENUE,isSigner:false,isWritable:true},
      {pubkey:mint,isSigner:false,isWritable:false},{pubkey:rev,isSigner:false,isWritable:true},
      {pubkey:hold,isSigner:false,isWritable:true},{pubkey:bnk,isSigner:false,isWritable:true},
      {pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false}]})
  const thief=getAssociatedTokenAddressSync(mint,alice.publicKey)
  await send([createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,thief,alice.publicKey,mint)],[deployer])
  const spA=await att(()=>send([splitTo(revAta,thief,bankAta)],[alice]))
  rec('8.2a',"split with the caller's own account as the HOLDERS destination",'REJECT',spA.ok?'ALLOW':'REJECT',spA.err)
  const spB=await att(()=>send([splitTo(revAta,holdersAta,thief)],[alice]))
  rec('8.2b',"split with the caller's own account as the 15% destination",'REJECT',spB.ok?'ALLOW':'REJECT',spB.err)
  const spC=await att(()=>send([splitTo(thief,holdersAta,bankAta)],[alice]))
  rec('8.2c','split reading a SOURCE the caller supplies','REJECT',spC.ok?'ALLOW':'REJECT',spC.err)
  rec('8.2e','the revenue balance is UNTOUCHED by the three refusals',String(INCOME),String(await bal(revAta)))
  // permissionless on purpose: alice has no role here at all
  const sp=await att(()=>send([ixSplit],[alice]))
  rec('8.2','ANYONE can trigger the split (destinations are pinned)','ALLOW',sp.ok?'ALLOW':'REJECT',sp.err)
  rec('8.3','holders received exactly 85%',String(INCOME*85n/100n),String(await bal(holdersAta)))
  rec('8.4','the project treasury (bank_treasury) received exactly 15%',String(INCOME*15n/100n),String(await bal(bankAta)))
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
    await send([createTransferInstruction(ata(deployer.publicKey),revAta,deployer.publicKey,7n)],[deployer])
    const spr=await att(()=>send([ixSplit],[alice]))
    rec('8.6a','split an amount that does NOT divide evenly','ALLOW',spr.ok?'ALLOW':'REJECT',spr.err)
    // 7 * 1500/10000 = 1.05 -> Bank floors to 1, holders take the remaining 6.
    rec('8.6b','the 15% side takes the FLOOR of its share','1',String(await bal(bankAta)-before.b))
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
  const w1=await att(()=>send([ixSweep(revSol,deployer)],[deployer,swapOp]))
  rec('8.7','sweeping SOL that would breach the fee reserve','REJECT',w1.ok?'ALLOW':'REJECT',w1.err)
  const safe=revSol-BigInt(0.05*LAMPORTS_PER_SOL)
  await new Promise(r=>setTimeout(r,2500))
  const opBefore=BigInt(await conn.getBalance(swapOp.publicKey,CM))
  const w2=await att(()=>send([ixSweep(safe>0n?safe:0n,deployer)],[deployer,swapOp]))
  rec('8.8','sweeping what the reserve allows','ALLOW',w2.ok?'ALLOW':'REJECT',w2.err)
  rec('8.9','the operator received it',String(safe>0n?safe:0n),
    String(BigInt(await conn.getBalance(swapOp.publicKey,CM))-opBefore))
  // permissionless BY DESIGN, so the property to prove is that the DESTINATION
  // cannot be chosen: a stranger sweeping can only move our SOL to our operator.
  const w3=await att(()=>send([ixSweep(1n,alice,alice.publicKey)],[alice]))
  rec('8.10','sweeping SOL to an address of the caller\'s choosing','REJECT',w3.ok?'ALLOW':'REJECT',w3.err)
  // 8.8 already swept down to the reserve, so top the address up first: otherwise
  // this rejects with ReserveWouldBreach and proves nothing about permissionlessness.
  await send([SystemProgram.transfer({fromPubkey:deployer.publicKey,toPubkey:REVENUE,lamports:1_000_000})],[deployer])
  // The cooldown is real now, so a consecutive sweep has to wait it out.
  await new Promise(r=>setTimeout(r,2500))
  const w4=await att(()=>send([ixSweep(1_000_000n,alice)],[alice,swapOp]))
  rec('8.10b','a stranger PAYS while the operator signs (the cron needs this)','ALLOW',w4.ok?'ALLOW':'REJECT',w4.err)

  // ═══ 8b. THE BRAKE AGAINST THE REAL GOVERNANCE: stop, then a VOTE restarts ═══
  //
  // 6c proved the MINT gates with a keypair standing in for governance. This is
  // the production shape: governance IS the GOV PDA now, so the only way to undo
  // the guardian is a ratified proposal executing a CPI. If GOV's copy of a MINT
  // discriminator or of `WiringArgs` were wrong, these executes would fail.
  console.log('\n─── 8b. the guardian against the real governance (the GOV PDA) ───')
  const gb1=await att(()=>send([ixStop('sales',guardian),ixStop('sweep',guardian)],[guardian]))
  rec('8.11','the GUARDIAN stops sales AND the sweep in one transaction','ALLOW',gb1.ok?'ALLOW':'REJECT',gb1.err)
  rec('8.11a','...both flags set','1,1',await stops())
  const gbm=await tryMint()
  rec('8.12','minting while stopped','REJECT',gbm.ok?'ALLOW':'REJECT',gbm.err)
  // B was minted empty, so the redemption is open + burn with nothing to sweep —
  // which is also the only shape a never-funded mis-mint can be destroyed in.
  // B's votes are already cast on every open proposal, so burning it costs no
  // quorum below (the tally counts votes cast, not live vaults).
  const R2=await att(()=>send([ixOpen(B,alice.publicKey),
    ixBurn(B,alice.publicKey,declare(B.pda))],[alice]))
  rec('8.13','REDEMPTION still works while both stops are set','ALLOW',R2.ok?'ALLOW':'REJECT',R2.err)
  {
    await send([createTransferInstruction(ata(deployer.publicKey),revAta,deployer.publicKey,100n)],[deployer])
    const sps=await att(()=>send([ixSplit],[alice]))
    rec('8.13a','...and so does the 85/15 SPLIT: the holders keep being paid','ALLOW',sps.ok?'ALLOW':'REJECT',sps.err)
  }
  const gbG=await att(()=>send([ixRestart(true,true,guardian)],[guardian]))
  rec('8.13b','the GUARDIAN tries to restart against the real governance','REJECT',gbG.ok?'ALLOW':'REJECT',gbG.err)

  // The voting windows opened in section 7 must have closed.
  while(Math.floor(Date.now()/1000)<=lastEnds+1) await new Promise(r=>setTimeout(r,1000))
  const xW=await att(()=>send([ixExec(propId(idPW))],[deployer]))
  rec('8.14','a ratified UpdateWiring proposal executes through the GOV PDA','ALLOW',xW.ok?'ALLOW':'REJECT',xW.err)
  rec('8.14a','...and MINT took GOV\'s WiringArgs byte for byte (cooldown is now 2)','2',
    String(Number((await conn.getAccountInfo(MINT_CFG,CM))!.data.readBigInt64LE(OFF_SWEEP_COOLDOWN))))
  rec('8.14b','...and a wiring vote did NOT lift either stop','1,1',await stops())
  const xB1=await att(()=>send([ixExec(propId(idPB1))],[deployer]))
  rec('8.15','a ratified Brakes proposal (new guardian + restart both) executes','ALLOW',xB1.ok?'ALLOW':'REJECT',xB1.err)
  rec('8.15a','...both stops are lifted','0,0',await stops())
  rec('8.15b','...and the guardian is the one the vote named',guardian2.publicKey.toBase58(),await guardianNow())
  const gbOld=await att(()=>send([ixStop('sales',guardian)],[guardian]))
  rec('8.15c','the REPLACED guardian pulls the brake','REJECT',gbOld.ok?'ALLOW':'REJECT',gbOld.err)
  const gbNew=await att(()=>send([ixStop('sales',guardian2)],[guardian2]))
  rec('8.15d','the NEW guardian pulls it','ALLOW',gbNew.ok?'ALLOW':'REJECT',gbNew.err)
  const xB2=await att(()=>send([ixExec(propId(idPB2))],[deployer]))
  rec('8.16','a ratified Brakes proposal (retire the guardian + restart sales) executes','ALLOW',xB2.ok?'ALLOW':'REJECT',xB2.err)
  rec('8.16a','...sales are running again and the brake is retired',
    '0,0|11111111111111111111111111111111',`${await stops()}|${await guardianNow()}`)
  const gbNone=await att(()=>send([ixStop('sales',guardian2)],[guardian2]))
  rec('8.16b','...and the retired guardian can no longer pull it','REJECT',gbNone.ok?'ALLOW':'REJECT',gbNone.err)

  // ================= 9. NESTING AND AIRDROPS — CHARACTERISED, NOT ASSUMED =========
  // Gary, 2026-08-22: "NO nest but we've tested vaults in their operation — if we
  // send 1 vault into another vault, and what happens during airdrops, unbreaking."
  //
  // Nesting is not a feature. It is something a holder can DO whether or not we
  // support it, and Core exposes no way to enumerate either the Core assets or the
  // token accounts a PDA owns — so `burn_vault` can only refuse what it is SHOWN.
  // Under v5 every redemption ends in a burn, so an UNDECLARED holding is no longer
  // stranded, it is DESTROYED. These assertions state exactly where that line is.
  // Everything here runs LAST, after the governance section, because each mint
  // moves `minted_total` and section 7 measures quorum against it.
  console.log('\n─── 9. nesting + airdrops (the hazard, measured) ───')
  const OUTER=await mkVault(SATS), INNER=await mkVault(SATS)
  // 9.0 — THE BURN SIDE OF THE ASSET BINDING. 3.9 proved a thaw cannot be paired
  // with a burn naming another asset. This is its mirror: a burn cannot ride on a
  // DIFFERENT vault's legitimate thaw sharing the transaction. Both halves have a
  // real counterpart here, so only the asset binding can reject it.
  const x0=await att(()=>send([ixOpen(OUTER,alice.publicKey),...sweep(OUTER,SATS,0),
    ixBurn(INNER,alice.publicKey,declare(INNER.pda)),
    ixBurn(OUTER,alice.publicKey,declare(OUTER.pda))],[alice]))
  rec('9.0','burn vault INNER off the back of vault OUTER\'s thaw','REJECT',x0.ok?'ALLOW':'REJECT',x0.err)
  const nest=await att(()=>transfer(umi,{asset:{publicKey:INNER.umiAsset,owner:aliceU.publicKey} as any,
    collection:{publicKey:coll.publicKey} as any,newOwner:pk(OUTER.pda.toBase58()),authority:aliceU})
    .sendAndConfirm(umi,{confirm:{commitment:CM}}))
  rec('9.1','Core PERMITS sending one vault into another','ALLOW',nest.ok?'ALLOW':'REJECT',nest.err)
  const innerNow:any=nest.ok?await fetchAsset(umi,INNER.umiAsset):null
  rec('9.2','the inner vault is now owned by the outer vault\'s asset-signer PDA',
    OUTER.pda.toBase58(),String(innerNow?.owner||'n/a'))
  // UNBREAKING THE INNER VAULT WHILE NESTED. Its owner is a PDA, and Core's Execute
  // and our open both demand the OWNER'S SIGNATURE. A PDA cannot sign a top-level
  // instruction, so the inner vault's Bitcoin is unreachable by anyone, forever —
  // the same shape as proven-impossibility #3, one level out.
  const inner1=await att(()=>send([ixOpen({...INNER,asset:INNER.asset},alice.publicKey),
    ...sweep(INNER,SATS,0),ixBurn(INNER,alice.publicKey,declare(INNER.pda))],[alice]))
  rec('9.3','redeem a NESTED vault (alice no longer owns it)','REJECT',inner1.ok?'ALLOW':'REJECT',inner1.err)
  // UNBREAKING THE OUTER VAULT, WITH THE INNER ONE DECLARED. This is the check
  // working: a declared live Core asset owned by the PDA refuses the burn.
  const out1=await att(()=>send([ixOpen(OUTER,alice.publicKey),...sweep(OUTER,SATS,0),
    ixBurn(OUTER,alice.publicKey,[...declare(OUTER.pda),INNER.asset])],[alice]))
  rec('9.4','burn the outer vault with the nested one DECLARED','REJECT',out1.ok?'ALLOW':'REJECT',out1.err)
  // ⚠️ AND WITH IT NOT DECLARED. THIS IS THE GAP, AND IT ALLOWS.
  // Nothing on chain can enumerate a nested Core asset, so nothing here can refuse
  // it. The outer vault burns, its asset-signer PDA becomes permanently unsignable,
  // and the inner vault — a whole Bitcoin — goes with it. v6 has no Bank to scan
  // before signing, so the ONLY controls are the redeem client's warning (it must
  // run the DAS + getTokenAccountsByOwner scan BEFORE the owner signs) and the
  // off-chain reconcile. Asserted as ALLOW so the suite goes red the day anyone
  // believes the chain is catching this.
  const out2=await att(()=>send([ixOpen(OUTER,alice.publicKey),...sweep(OUTER,SATS,0),
    ixBurn(OUTER,alice.publicKey,declare(OUTER.pda))],[alice]))
  rec('9.5','burn the outer vault with the nested one UNDECLARED','ALLOW',out2.ok?'ALLOW':'REJECT',
    `THE GAP: on-chain enumeration of nested Core assets does not exist, so the redeem client must scan BEFORE the owner signs. ${out2.err}`)
  const orphan:any=await fetchAsset(umi,INNER.umiAsset).catch(()=>null)
  rec('9.6','...and the inner vault is orphaned behind a burned asset\'s PDA',
    OUTER.pda.toBase58(),String(orphan?.owner||'n/a'),
    'nobody can ever produce Core\'s Execute signature for a burned asset')

  // ---- "BURNED AND NEVER EXISTS AGAIN" — is the ADDRESS reusable? ----
  // A round-13 auditor stated that Core's BurnV1 CLOSES the asset account (0
  // lamports, 0 data, System-owned) and that CreateV2 therefore succeeds again at
  // the same address, so a client who kept the keypair can re-mint a vault where
  // a burned one stood — falsifying the invariant's "never exists again" and
  // replacing DAS's burnt entry. That is a claim about Core's behaviour, and this
  // suite runs against real mainnet Core, so it is measurable rather than
  // arguable. MEASURE IT, both the account state and the re-mint.
  const Z=await mkVault(SATS)
  await send([ixOpen(Z,alice.publicKey),...sweep(Z,SATS,0),
    ixBurn(Z,alice.publicKey,declare(Z.pda))],[alice])
  const zinf=await conn.getAccountInfo(Z.asset,CM)
  rec('9.12','after BurnV1 the asset account still EXISTS','true',String(!!zinf),
    zinf?`owner=${zinf.owner.toBase58().slice(0,8)} lamports=${zinf.lamports} bytes=${zinf.data.length} key=${zinf.data[0]}`:'account is gone')
  const dtRemint=await deckTail()
  const remint=await att(()=>send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('mint_vault'),str('RESURRECTED'),str('u'),u64(BigInt(LAMPORTS_PER_SOL)),attrs([]),dtRemint]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:Z.asset,isSigner:true,isWritable:true},
      {pubkey:COLL,isSigner:false,isWritable:true},{pubkey:alice.publicKey,isSigner:true,isWritable:false},
      {pubkey:alice.publicKey,isSigner:true,isWritable:true},
      {pubkey:REVENUE,isSigner:false,isWritable:true},{pubkey:SEAL_CFG,isSigner:false,isWritable:false},
      {pubkey:MINT_AUTH,isSigner:false,isWritable:false},{pubkey:CORE,isSigner:false,isWritable:false},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[deployer,Z.kp,alice]))
  rec('9.13','re-mint a vault at a BURNED asset address, holding its keypair','REJECT',remint.ok?'ALLOW':'REJECT',remint.err)

  // ---- THE REDEMPTION CEILING, MEASURED PER RESERVE MINT ----
  // Three round-13 auditors independently called this the live kill switch: a
  // redemption is ONE transaction now, the reserve list is ADDITIVE-ONLY, and
  // MAX_RESERVE_MINTS is 8 — a Borsh bound, not a packet bound. If N mints push
  // the redemption past 1232 bytes, an ordinary admin config write seals every
  // vault that exists, forever. 4.6 measured N=1 at 802 bytes. Guessing the
  // slope from that is exactly the arithmetic this repo does not accept, so
  // BUILD THE REAL TRANSACTION for each N and serialize it.
  const CEIL=await mkVault(SATS)
  const extraMints:any[]=[mint]
  for(let i=1;i<8;i++) extraMints.push(await createMint(conn,deployer,deployer.publicKey,null,8))
  for(const m of extraMints.slice(1)){
    const a=getAssociatedTokenAddressSync(m,CEIL.pda,true)
    await sendAndConfirmTransaction(conn,new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,a,CEIL.pda,m)),[deployer],{commitment:CM})
    await mintTo(conn,deployer,m,a,deployer,1_000n,[],{commitment:CM})
  }
  const sizeFor=(n:number,createDest=false)=>{
    const ms=extraMints.slice(0,n)
    const inner=ms.flatMap(m=>{
      const src=getAssociatedTokenAddressSync(m,CEIL.pda,true)
      const dst=getAssociatedTokenAddressSync(m,alice.publicKey,true)
      return [fromWeb3JsInstruction(createTransferInstruction(src,dst,CEIL.pda,1n)),
              fromWeb3JsInstruction(createCloseAccountInstruction(src,alice.publicKey,CEIL.pda))]})
    // THE WORST CASE INCLUDES THE LAMPORT SWEEP. The first version of this
    // harness measured transfer+close per mint and no SOL, so it was measuring a
    // redemption of a vault nobody had ever sent a lamport to — and 9.10/9.11
    // prove a stranger can put lamports in a vault for free, and that the burn
    // then REFUSES until the same transaction sweeps them. A ceiling measured
    // without it is a ceiling for a vault that has never been griefed.
    inner.push(fromWeb3JsInstruction(SystemProgram.transfer(
      {fromPubkey:CEIL.pda,toPubkey:alice.publicKey,lamports:1})))
    const sw=execute(umi,{asset:{publicKey:CEIL.umiAsset},collection:{publicKey:coll.publicKey} as any,
      instructions:inner,signers:[createNoopSigner(CEIL.pdaU)],authority:aliceU,payer:aliceU})
      .getInstructions().map(i=>new TransactionInstruction({programId:toWeb3JsPublicKey(i.programId),
        data:Buffer.from(i.data),keys:i.keys.map(k=>({pubkey:toWeb3JsPublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable}))}))
    // burn_vault demands BOTH token-program ATA derivations for every reserve mint
    const decl=ms.flatMap(m=>[getAssociatedTokenAddressSync(m,CEIL.pda,true),
                              getAssociatedTokenAddressSync(m,CEIL.pda,true,TOKEN_2022_PROGRAM_ID)])
    // A round-14 auditor found this harness assumes the redeemer ALREADY holds a
    // destination ATA for every reserve mint. `createDest` measures the other
    // case, and the difference is the operational requirement below.
    const mk=createDest?ms.map(m=>createAssociatedTokenAccountIdempotentInstruction(
      alice.publicKey,getAssociatedTokenAddressSync(m,alice.publicKey,true),alice.publicKey,m)):[]
    const tx=new Transaction().add(...mk,ixOpen(CEIL,alice.publicKey),...sw,
      ixBurn(CEIL,alice.publicKey,decl))
    // v6: THE OWNER IS THE ONLY SIGNER AND THE FEE PAYER. v5 measured with the
    // Bank as fee payer and co-signer, which is one more account and one more
    // 64-byte signature than a v6 redemption carries.
    tx.feePayer=alice.publicKey; tx.recentBlockhash='11111111111111111111111111111111'
    return tx.serialize({requireAllSignatures:false,verifySignatures:false}).length
  }
  const sizes:number[]=[]
  for(let n=1;n<=8;n++){ try{ sizes.push(sizeFor(n)) }catch(e:any){ sizes.push(99999) } }
  const fits=sizes.filter(b=>b<=1232).length
  // AND THE MEASUREMENT'S OWN FOUNDATION, PINNED. Every number above is a
  // serialization with `requireAllSignatures:false`, which is only a wire size if
  // it already reserves the 64 bytes per signature. It does — but that is a
  // web3.js behaviour, not a law, and if it ever changed, every ceiling here
  // would silently overstate by 192 bytes and 3 mints would NOT fit.
  {
    const probe=new Transaction().add(SystemProgram.transfer(
      {fromPubkey:alice.publicKey,toPubkey:deployer.publicKey,lamports:1}))
    probe.feePayer=deployer.publicKey; probe.recentBlockhash='11111111111111111111111111111111'
    const unsigned=probe.serialize({requireAllSignatures:false,verifySignatures:false}).length
    probe.sign(deployer,alice)
    rec('9.13a','an UNSIGNED serialization already reserves the signature bytes','true',
      String(unsigned===probe.serialize().length),
      `unsigned ${unsigned} vs signed ${probe.serialize().length} — the ceilings below are real wire sizes`)
  }
  // ⚠️ THIS ASSERTION USED TO COMPARE `String(fits)` TO `String(fits)`.
  // A round-14 auditor caught it: it could never go red. It printed a real
  // measurement and dressed it as a gate, which is the "a gate that flatters its
  // own margin" class this project has a rule about — and I wrote it while
  // fixing exactly that class somewhere else. The ceiling is now pinned to a
  // LITERAL, so a change in the sweep shape, the declared-account rule, web3.js
  // serialization or Core's account list moves the number and turns this red.
  // If the ceiling legitimately moves, change this deliberately and say why.
  // ⚠️ v6 MOVED THIS FROM 3 TO 4, MEASURED (first v6 run, 2026-10-03). A v6
  // redemption carries no Bank account and no second signature: the owner is the
  // only signer and the fee payer, so the 3-mint worst case fell 98 bytes, from
  // 1119 to 1021, and a FOURTH reserve mint now fits (1165). That changes what
  // 9.15/9.16 can claim — see there.
  const EXPECTED_CEILING=4
  rec('9.14','the LARGEST reserve-mint count whose redemption fits a legacy transaction',
    String(EXPECTED_CEILING),String(fits),`bytes by N = ${sizes.map((b,i)=>`${i+1}:${b>=99999?'too big to build':b}`).join('  ')}  (limit 1232)`)
  // ...and the BYTES themselves, not just the count they imply. The count is a
  // step function: 144 bytes per mint could grow by 100 and `fits` would not
  // budge until it crossed a boundary. Pin the number that actually moves.
  rec('9.14a','a 3-mint worst-case redemption is 1021 bytes (v5, with the Bank: 1119)','1021',String(sizes[2]),
    'if this moved, something changed the shape of a redemption — find out what before touching EXPECTED_CEILING')
  // ⚠️ AND THE ASSUMPTION UNDER ALL OF IT, MEASURED. Every number above assumes
  // the redeemer ALREADY OWNS a destination ATA for every reserve mint. A
  // first-time redeemer does not. Creating them is NOT required to be atomic with
  // the burn — unlike the sweep — so it can be a prior transaction, and that is
  // now a written operational requirement rather than a silent assumption. A
  // client that naively folds the creation into the redemption gets this instead:
  const withMk:number[]=[]
  for(let n=1;n<=8;n++){ try{ withMk.push(sizeFor(n,true)) }catch(e:any){ withMk.push(99999) } }
  const fitsMk=withMk.filter(b=>b<=1232).length
  // v6: THREE now fit with the destination ATAs created in the same transaction
  // (3 mints: 1179 bytes), so the "prior transaction" requirement v5 wrote down
  // no longer binds at the real reserve count. It is kept as advice because the
  // margin is 53 bytes.
  rec('9.14b','...and THREE even if the redeemer creates their destination ATAs in the same transaction','3',String(fitsMk),
    `bytes by N = ${withMk.map((b,i)=>`${i+1}:${b>=99999?'too big':b}`).join('  ')}`)
  // THE CAP MUST NEVER EXCEED A MEASURED NUMBER. Nothing may configure more
  // reserve mints than a redemption can actually carry, or the vaults that exist
  // are sealed forever.
  //
  // ⚠️ v6: THIS WAS AN EQUALITY AND IS NOW A BOUND, DELIBERATELY. In v5 the cap
  // (3) equalled the measured ceiling (3). v6 freed 98 bytes, so the ceiling is
  // 4 while the cap stays 3: the business has exactly three reserve assets, and
  // v6 writes the list ONCE, in `initialize`, so there is no future append for
  // headroom to serve. Raising the cap to match would buy nothing and spend the
  // margin. The two numbers are now pinned SEPARATELY — the cap to the three
  // assets, the ceiling to the measurement (9.14) — and this arm asserts the
  // relation that protects a vault: cap <= ceiling.
  const capInSeal=idx(SEAL_SRC,'MAX_RESERVE_MINTS'), capInBurn=idx(BURN_SRC,'MAX_RESERVE_MINTS')
  rec('9.15','SEAL caps reserve mints at the three reserve assets','3',capInSeal)
  rec('9.15a','...which does not exceed the count a redemption has been MEASURED to carry',
    'true',String(Number(capInSeal)<=fits))
  rec('9.16','...and BURN agrees, so the two cannot drift',capInSeal,capInBurn)

  // ---- AIRDROPS: a token nobody declared, and a token nobody wanted ----
  const AIR=await mkVault(SATS)
  const junk=await createMint(conn,deployer,deployer.publicKey,null,0)
  const junkAta=getAssociatedTokenAddressSync(junk,AIR.pda,true)
  await sendAndConfirmTransaction(conn,new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey,junkAta,AIR.pda,junk)),[deployer],{commitment:CM})
  await mintTo(conn,deployer,junk,junkAta,deployer,7_000n,[],{commitment:CM})
  rec('9.7','a stranger can airdrop an undeclared token into a sealed vault','7000',
    String((await conn.getTokenAccountBalance(junkAta,CM)).value.amount))
  // DECLARED, the second loop catches it: any PDA-owned token account with a
  // balance refuses the burn, reserve mint or not.
  const air1=await att(()=>send([ixOpen(AIR,alice.publicKey),...sweep(AIR,SATS,0),
    ixBurn(AIR,alice.publicKey,[...declare(AIR.pda),junkAta])],[alice]))
  rec('9.8','burn with the airdropped token DECLARED','REJECT',air1.ok?'ALLOW':'REJECT',air1.err)
  // ⚠️ UNDECLARED, it allows — the same gap as 9.5, in its commonest form. An
  // airdrop needs no cooperation from us or from the holder, so this is the most
  // likely way "everything stays in the vault" is ever broken.
  const air2=await att(()=>send([ixOpen(AIR,alice.publicKey),...sweep(AIR,SATS,0),
    ixBurn(AIR,alice.publicKey,declare(AIR.pda))],[alice]))
  rec('9.9','burn with the airdropped token UNDECLARED','ALLOW',air2.ok?'ALLOW':'REJECT',
    `THE GAP again: 7,000 airdropped units destroyed by a burn nothing on chain could refuse. ${air2.err}`)
  // AIRDROPPED SOL IS DIFFERENT, AND BENIGN. Anyone can send lamports to a derived
  // address; the burn refuses on a non-zero PDA balance, which reads as a griefing
  // vector — but the thaw lets the owner sweep the PDA's own lamports in the same
  // transaction, so it costs the griefer their lamports and costs us nothing.
  const G=await mkVault(SATS)
  await send([SystemProgram.transfer({fromPubkey:gov.publicKey,toPubkey:G.pda,lamports:1_000_000})],[gov])
  const grief=await att(()=>send([ixOpen(G,alice.publicKey),...sweep(G,SATS,0),
    ixBurn(G,alice.publicKey,declare(G.pda))],[alice]))
  rec('9.10','a stranger\'s SOL sitting in the PDA blocks the burn','REJECT',grief.ok?'ALLOW':'REJECT',grief.err)
  const ok9=await att(()=>send([ixOpen(G,alice.publicKey),...sweep(G,SATS,1_000_000),
    ixBurn(G,alice.publicKey,declare(G.pda))],[alice]))
  rec('9.11','...and the same redemption sweeping it too','ALLOW',ok9.ok?'ALLOW':'REJECT',ok9.err)

  console.log('\n─── 9c. v6: there is no privileged signature in a redemption to spend ───')
  // v5's section here proved the Bank's key was CONFINED to the open/burn pair
  // (4.7, 4.10) and to the `bank` slot of a mint (9d.1-9d.4), because the
  // customer composes the transaction and a Solana signature covers all of it.
  // v6 deletes the Bank, so there is nothing to confine and those arms are gone
  // with it. What survives is the half that mattered for MEMBERS: a redemption
  // may carry the member's own unrelated instructions, and two redemptions may
  // share a transaction. The pairing binds asset AND owner either way (3.9, 3.10,
  // 9.0), so neither shape can borrow another vault's half.
  const bystander=Keypair.generate()
  const T2=await mkVault()
  const donate=await att(()=>send([ixOpen(T2,alice.publicKey),
    // RENT-EXEMPT, NOT 1 LAMPORT: a bare `1` to a fresh key leaves an account below
    // the rent floor and the runtime refuses the whole transaction.
    SystemProgram.transfer({fromPubkey:alice.publicKey,toPubkey:bystander.publicKey,lamports:LAMPORTS_PER_SOL/100}),
    ...sweep(T2,SATS,0),
    ixBurn(T2,alice.publicKey,declare(T2.pda))],[alice]))
  rec('4.8','a redemption carrying the OWNER\'s own unrelated transfer','ALLOW',
    donate.ok?'ALLOW':'REJECT',donate.err||'the programs bound the pair, not the rest of the member\'s transaction')
  const RA=await mkVault(0n), RB=await mkVault(0n)
  const two=await att(()=>send([
    ixOpen(RA,alice.publicKey),ixBurn(RA,alice.publicKey,declare(RA.pda)),
    ixOpen(RB,alice.publicKey),ixBurn(RB,alice.publicKey,declare(RB.pda))],[alice]))
  rec('4.9','TWO redemptions in ONE transaction, owner alone','ALLOW',
    two.ok?'ALLOW':'REJECT',two.err)
  // AND AN INTERLEAVED PAIR CANNOT CROSS-SATISFY. Open A, open B, burn B, burn A
  // is legal (each open finds its own burn later); open A then burn B alone must
  // not be, which is 9.0's property seen from the multi-redemption side.
  const XA=await mkVault(0n), XB=await mkVault(0n)
  const cross=await att(()=>send([ixOpen(XA,alice.publicKey),ixBurn(XB,alice.publicKey,declare(XB.pda))],[alice]))
  rec('4.10','open vault A, burn vault B, nothing else','REJECT',cross.ok?'ALLOW':'REJECT',cross.err)
  const nest2=await att(()=>send([ixOpen(XA,alice.publicKey),ixOpen(XB,alice.publicKey),
    ixBurn(XB,alice.publicKey,declare(XB.pda)),ixBurn(XA,alice.publicKey,declare(XA.pda))],[alice]))
  rec('4.10a','...but open A, open B, burn B, burn A is two honest redemptions','ALLOW',nest2.ok?'ALLOW':'REJECT',nest2.err)

  console.log('\n─── 7b. the governance negatives rejected for the RIGHT reason ───')
  because('7.0','NotTheInitAuthority'); because('7.12e','BadThreshold')
  because('7.4','NotTheOwner'); because('7.5','NotTheOwner'); because('7.11','VotingOpen')
  because('7.13','QuorumNotMet'); because('7.13a','RoundAlreadyOver'); because('7.17','AlreadyExecuted')
  // 7.7/7.9 must fail because the VoteRecord PDA ALREADY EXISTS (system program
  // 0x0, "account already in use") — that IS the asset binding. Any other reason
  // would mean the double-vote was stopped by something incidental.
  because('7.7','custom program error: 0x0'); because('7.9','custom program error: 0x0')
  because('8.6','NothingToSplit'); because('8.7','ReserveWouldBreach')
  because('8.2a','WrongTreasury'); because('8.2b','WrongTreasury'); because('8.2c','WrongTreasury')
  because('8.10','WrongTreasury')
  because('7.2','ConstraintHasOne'); because('7.2a','ConstraintHasOne')
  because('7.2d','ConstraintHasOne'); because('7.2e','ConstraintHasOne')
  // AccountNotSigner: Anchor rejects the PDA as a Signer before the handler runs.
  because('7.18','AccountNotSigner')
  because('7.26','ProposalSuperseded')
  because('7.27','EmptyAction'); because('7.27a','EmptyAction')
  // 8b: the guardian against the real governance.
  because('8.12','SalesStopped'); because('8.13b','ConstraintHasOne')
  because('8.15c','NotTheGuardian'); because('8.16b','NotTheGuardian')

  console.log('\n─── 3b/9b. the redemption negatives, rejected for the RIGHT reason ───')
  // EVERY ONE OF THESE IS THE WHOLE PRODUCT. A reject for the wrong reason here
  // means the pairing is being enforced by something incidental — a missing
  // signature, an account count — and would pass identically with the rule gone.
  because('3.1','NotTheOwner')         // v6: the owner IS the gate, with no Bank beside it
  because('3.6','NoTerminalBurn')      // a thaw may not end a transaction
  because('3.8','NoPrecedingOpen')     // a burn may not begin one
  because('3.9','NoTerminalBurn')      // the pairing binds the ASSET
  because('3.10','NoTerminalBurn')     // ...and the OWNER
  because('4.10','NoTerminalBurn')     // ...even among several redemptions
  because('3.11','VaultNotEmpty')      // all or nothing
  because('3.3','ReserveDelegated')    // a delegate on an account that survives
  because('4.1','VaultNotEmpty')
  because('5.1','DeclarationMismatch') // the declared count is not decoration
  because('5.3','BadSealConfig')       // reached the config check, not stopped short
  because('9.0','NoPrecedingOpen')     // a burn cannot ride another vault's thaw
  because('9.3','NotTheOwner')         // a nested vault's owner cannot sign
  because('9.4','VaultStillHoldsAVault')
  because('9.8','VaultNotEmpty')
  because('9.10','VaultNotEmpty')

  // ═══ 11. LEVELS AT MINT — the draw is the program's, not the caller's ═══
  //
  // Gary's ruling 2026-08-23: a vault's level is assigned AT MINT, at random,
  // respecting the per-level quantity, with NO WAY TO GAME IT, and written to the
  // NFT. The randomness itself is dealt off-chain from a pre-committed deck (a
  // minter who submits the transaction and chooses the asset keypair can simulate
  // and grind anything derived on-chain), so what the PROGRAM must guarantee is
  // narrower and is exactly what these arms prove: the caller cannot choose, and
  // the quota is a ceiling rather than a promise.
  console.log('\n─── 11. levels at mint ───')
  const attrMap=(x:any)=>Object.fromEntries((x?.attributes?.attributeList||[]).map((e:any)=>[e.key,e.value]))

  // THE LEVEL IS THE DECK'S CARD, NOT THE TEST'S CHOICE — which is the whole
  // point of the change. Read the index the program is about to use, mint, then
  // assert the vault carries exactly the card the committed deck put there.
  const idxBefore=await deckIdx()
  const L3=await mkVault(0n,[['notice','7']])
  const l3a=attrMap(await fetchAsset(umi,L3.umiAsset))
  rec('11.1','a minted vault CARRIES the level the COMMITTED DECK dealt it',
    LNAME[DECK[idxBefore]-1],String(l3a.level))
  rec('11.2','...alongside the provenance it was minted with, not instead of it','7',String(l3a.notice))

  // THE LOAD-BEARING ONE. `attributes` is caller-supplied; if `level` is not
  // reserved the minter types their own and the whole draw is decoration.
  const lFake=await att(()=>mkVault(0n,[['level','V']],LVL.I))
  rec('11.3','a caller that writes its OWN level attribute is REFUSED','REJECT',lFake.ok?'ALLOW':'REJECT',lFake.err)

  // Accepted limit 14, closed because the level made it load-bearing.
  const lDup=await att(()=>mkVault(0n,[['notice','1'],['notice','2']],LVL.I))
  rec('11.4','two attributes sharing a key are REFUSED','REJECT',lDup.ok?'ALLOW':'REJECT',lDup.err)

  // Zero is what a forgotten argument looks like.
  const lZero=await att(()=>mkVault(0n,[],0))
  rec('11.5','level 0 is REFUSED','REJECT',lZero.ok?'ALLOW':'REJECT',lZero.err)
  const lSix=await att(()=>mkVault(0n,[],6))
  rec('11.6','a level above V is REFUSED','REJECT',lSix.ok?'ALLOW':'REJECT',lSix.err)

  // ═══ THE DECK PROOF — what stops the BANK hand-picking ═══
  //
  // ⚠️ v6 STAGE 1: there is no Bank, so the MINTER builds this proof, from a
  // seed that is public on chain. The arms below still prove the card cannot be
  // forged; they no longer prove anything about WHO reaches a Level V index (a
  // minter can see the deck and time their mint). Stage 2 replaces the deck with
  // a two-step reveal from a future slot hash. Do not mint against stage 1.
  //
  // The cap bounds how many Level V can EXIST. It says nothing about who gets
  // them, so on its own the Bank both deals the cards and certifies the deal.
  // These arms are the other half: the level must be the one the pre-committed
  // deck already assigned to this mint INDEX, and the index is `minted_total`,
  // which the program owns and no caller can choose.
  //
  // ⚠️ THEY ALSO PROVE bank/deck.mjs AND THE RUST AGREE. Two implementations of
  // one hash scheme is this repository's most repeated defect wearing a new hat,
  // and reading them side by side proves nothing. The proof below is built by the
  // PRODUCTION deck module and verified by the PROGRAM; if the tagging, the
  // sorting or the promotion rule drifted by one byte, 11.1 stops passing.
  const wrongLvl=await deckArgs()
  const notMyCard=await att(()=>mkVault(0n,[],wrongLvl.lvl===1?2:1))
  rec('11.7','a level that is NOT this index\'s card is REFUSED','REJECT',notMyCard.ok?'ALLOW':'REJECT',notMyCard.err)

  const tampered=await att(async()=>{
    const a=Keypair.generate()
    const i=await deckIdx()
    const pr=deckProof(DECK,i).map(x=>Buffer.from(x))
    pr[0][0]^=0xff                                  // one flipped byte, one level up the tree
    return send([new TransactionInstruction({programId:MINT_PROG,
      data:Buffer.concat([d('mint_vault'),str('TAMPER'),str('u'),u64(BigInt(LAMPORTS_PER_SOL)),attrs([]),u8b(DECK[i]),proofBuf(pr)]),
      keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:a.publicKey,isSigner:true,isWritable:true},
        {pubkey:COLL,isSigner:false,isWritable:true},{pubkey:alice.publicKey,isSigner:true,isWritable:false},
        {pubkey:alice.publicKey,isSigner:true,isWritable:true},
        {pubkey:REVENUE,isSigner:false,isWritable:true},
        
        {pubkey:SEAL_CFG,isSigner:false,isWritable:false},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
        {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[deployer,a,alice])})
  rec('11.8','a proof with ONE flipped byte is REFUSED','REJECT',tampered.ok?'ALLOW':'REJECT',tampered.err)

  // ONE-SHOT IS THE CONTROL. A root that can be replaced is a deck that can be
  // re-dealt after seeing who showed up.
  const reDeal=await att(()=>commitDeck(deckRoot(buildDeck(DECK_CENSUS,seedFrom(Buffer.from('other'),Buffer.from('other'))))))
  rec('11.9','committing a SECOND deck is REFUSED','REJECT',reDeal.ok?'ALLOW':'REJECT',reDeal.err)

  // ═══ THE ATTRIBUTE BUDGET IS A PACKET BOUND NOW, NOT A BORSH BOUND ═══
  //
  // ⚠️ ROUND 13'S LESSON, RECURRING. `MAX_RESERVE_MINTS = 8` was a Borsh bound
  // where a PACKET bound was needed, and it was measured by building the real
  // transaction rather than reasoning about it. The same thing has just happened
  // here: MAX_ATTRS is 8 in the program, and the deck proof now shares the
  // 1,232-byte transaction with the attributes, so the number that actually
  // binds is smaller and DEPENDS ON DECK DEPTH — deeper deck, fewer attributes.
  // Measured here rather than assumed, exactly as round 13 measured the reserve
  // list at 1 mint 802 bytes / 2 -> 946 / 3 -> 1090 / 4 -> cannot serialize.
  // ⚠️ `depth` IS A PARAMETER NOW, AND THAT IS THE ROUND-20 FIX. See 11.11.
  const attrFit=async(n:number,depth?:number)=>{
    const dt=depth===undefined?await deckTail()
      :Buffer.concat([u8b(1),proofBuf(Array.from({length:depth},()=>Buffer.alloc(32,0xab)))])
    const list:[string,string][]=Array.from({length:n},(_,i)=>[`k${i}`,'v'])
    // ⚠️ A Transaction with no feePayer and no recentBlockhash THROWS on
    // serialize for reasons that have nothing to do with size. The first version
    // of this probe omitted both, reported that even ZERO attributes did not fit,
    // and would have been read as a catastrophic finding. Check the instrument.
    const bh=(await conn.getLatestBlockhash()).blockhash
    try{ const tx=new Transaction(); tx.feePayer=alice.publicKey; tx.recentBlockhash=bh
      tx.add(new TransactionInstruction({programId:MINT_PROG,
      data:Buffer.concat([d('mint_vault'),str('FIT'),str('u'),u64(1n),attrs(list),dt]),
      keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:Keypair.generate().publicKey,isSigner:true,isWritable:true},
        {pubkey:COLL,isSigner:false,isWritable:true},{pubkey:alice.publicKey,isSigner:true,isWritable:false},
        {pubkey:alice.publicKey,isSigner:true,isWritable:true},
        {pubkey:REVENUE,isSigner:false,isWritable:true},
        
        {pubkey:SEAL_CFG,isSigner:false,isWritable:false},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
        {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]}))
      tx.serialize({requireAllSignatures:false,verifySignatures:false})
      return true }catch{ return false }
  }
  // ⚠️ ROUND 20 FOUND THIS ARM UNFAILABLE, AND IT WAS MINE.
  //
  // It read `for(let n=0;n<=7;n++)` and asserted `maxAttrs < MAX_ATTRS_BORSH`.
  // The program refuses `attributes.len() >= 8`, so 7 is the most a caller can
  // ever pass, so the loop's own ceiling was 7 and the assertion was `7 < 8` —
  // TRUE BY CONSTRUCTION, incapable of failing. At the suite's depth the answer
  // came back 7, which does not mean "the packet allows exactly 7": it means the
  // loop ran out of iterations before the packet ran out of bytes. The packet
  // never bound at all, and SPEC and the freeze log both say it did.
  //
  // A gate that has only ever said OK is untested; this one could only ever say
  // OK. It probes PAST the program's ceiling now, so a run where the packet
  // genuinely binds first is distinguishable from one where it does not.
  // ⚠️ AND THE FIRST VERSION OF THIS FIX REPRODUCED THE DEFECT IT WAS FIXING.
  // It raised the ceiling from 7 to MAX_ATTRS_BORSH+4 = 12 and the answer came
  // back 12 — at depth 7, at depth 11 AND at depth 13, three different geometries
  // giving one identical number, which is the signature of a loop ceiling rather
  // than a measurement. `PROBE_CEILING` is now far above any plausible budget and
  // the arms below ASSERT the packet actually bound, so "the loop ran out" can
  // never again be reported as "this many fit".
  const PROBE_CEILING=64
  let maxAttrs=-1
  for(let n=0;n<=PROBE_CEILING;n++){ if(await attrFit(n)) maxAttrs=n; else break }
  const proofDepth=deckProof(DECK,await deckIdx()).length
  const packetBinds=maxAttrs<MAX_ATTRS_BORSH-1
  console.log(`  deck depth ${proofDepth} (${DECK.length}-card deck) -> the PACKET holds ${maxAttrs} caller attributes`
    +` (the PROGRAM allows ${MAX_ATTRS_BORSH-1}); the binding constraint here is the ${packetBinds?'PACKET':'PROGRAM'}`)
  rec('11.11','the PACKET bound is actually reached, not the probe ceiling',
    'true',String(maxAttrs>=0&&maxAttrs<PROBE_CEILING))

  // ═══ AND AT THE REAL CENSUS, WHICH IS THE NUMBER THAT DECIDES THE PRODUCT ═══
  //
  // The suite's deck is 90 cards (depth 7). The charter census is 240 and the
  // full build is ~2,100, which is depth 11 — four more 32-byte proof elements,
  // 128 more bytes out of the same 1,232. A round-20 auditor filed a CRITICAL
  // saying not even ZERO attributes fit at that depth. Measured rather than
  // argued, because the deck root COMMITS ONCE and this cannot be fixed after
  // minting opens.
  const fitAt=async(depth:number)=>{let m=-1
    for(let n=0;n<=PROBE_CEILING;n++){ if(await attrFit(n,depth)) m=n; else break }
    return m}
  const at7=await fitAt(7), at11=await fitAt(11), at13=await fitAt(13)
  console.log(`  synthetic depth 7 -> ${at7} attributes; PRODUCTION depth 11 (~2,100 vaults) -> ${at11}; depth 13 (~8,192) -> ${at13}`)
  // A round-20 auditor filed a CRITICAL saying not even ZERO attributes fit at
  // depth 11. Refuted by measurement — but the refutation is only worth
  // something if the probe can fail, hence the ceiling assertion above.
  rec('11.11a','a mint at the PRODUCTION deck depth of 11 still serializes','true',String(at11>=0&&at11<PROBE_CEILING))
  // DEPTH COSTS BYTES, so a deeper deck MUST leave room for fewer attributes. If
  // three depths ever agree again, the probe has stopped measuring geometry.
  rec('11.11b','...and a deeper deck buys fewer attributes, which is what makes this a measurement',
    'true',String(at7>at11&&at11>at13))
  // THE PRODUCT QUESTION, ASSERTED RATHER THAN PRINTED: the charter provenance is
  // a Notice serial and a Governor standing. If depth 11 cannot hold two caller
  // attributes beside the level, the deck size and the provenance set are in
  // conflict and that must be decided BEFORE the root commits, not discovered.
  rec('11.11c','...and depth 11 still holds the provenance the charter round needs','true',String(at11>=2))
  // ...and the program's own bound still refuses one past it, IF the packet
  // allows the attempt to be built at all. When the packet binds first the
  // program never sees it, which is the finding, not a pass.
  const oneMore=await att(()=>mkVault(0n,Array.from({length:maxAttrs+1},(_,i)=>[`k${i}`,'v'] as [string,string])))
  rec('11.12','...and one past the measured budget does not mint','REJECT',oneMore.ok?'ALLOW':'REJECT',oneMore.err)

  // ═══ THE LEVEL MUST SURVIVE THE MINT ═══
  //
  // Every arm above proves what happens AT mint. NOTHING, in nineteen rounds or
  // in the three commits that built levels-at-mint, asserted that the level
  // cannot be REWRITTEN afterwards — and "assigned by fate, never gamed" is a
  // claim about the vault's whole life, not about one instruction. The level now
  // decides how much a holder is paid every single day, so its immutability is
  // load-bearing in exactly the way the provenance attributes never were.
  //
  // The Attributes plugin carrying it is authority = SEAL PDA, and a PDA signs
  // only by CPI from its own program, which has no instruction that writes
  // attributes. So the two parties a holder would actually worry about — the
  // OWNER of the vault, and the INIT_AUTHORITY that committed the deck (v5: the
  // Bank that dealt the card) — must both be refused
  // by Core itself, not by our code.
  //
  // ⚠️ A REJECT FOR THE WRONG REASON IS A FALSE PASS, and here the wrong reason
  // is overwhelmingly likely: a hand-built Core instruction with one byte off
  // deserializes to nothing and is refused for being malformed, which looks
  // identical to being refused for lacking authority. That is what the `because`
  // arms below are for, and why 11.15 reads the level back afterwards rather than
  // trusting two REJECTs.
  const upLevel=(signer:Keypair,asset:W,to:string)=>new TransactionInstruction({programId:CORE,
    // UpdatePluginV1 = 6, Plugin::Attributes = 6, then the attribute list.
    data:Buffer.concat([Buffer.from([6,6]),attrs([['level',to]])]),
    keys:[{pubkey:asset,isSigner:false,isWritable:true},
      {pubkey:COLL,isSigner:false,isWritable:true},
      {pubkey:signer.publicKey,isSigner:true,isWritable:true},
      {pubkey:signer.publicKey,isSigner:true,isWritable:false},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
      {pubkey:CORE,isSigner:false,isWritable:false}]})
  const dealt=String(attrMap(await fetchAsset(umi,L3.umiAsset)).level)
  const ownerRewrite=await att(()=>send([upLevel(alice,L3.asset,'V')],[alice]))
  rec('11.13','the vault OWNER cannot rewrite its level','REJECT',ownerRewrite.ok?'ALLOW':'REJECT',ownerRewrite.err)
  const bankRewrite=await att(()=>send([upLevel(deployer,L3.asset,'V')],[deployer]))
  rec('11.14','...and neither can the INIT_AUTHORITY that committed the deck','REJECT',bankRewrite.ok?'ALLOW':'REJECT',bankRewrite.err)
  // THE POSITIVE HALF. Two refusals prove two transactions failed; this proves
  // the thing they were aimed at is still what the deck dealt.
  rec('11.15','...and the level on chain is still the one the deck dealt',
    dealt,String(attrMap(await fetchAsset(umi,L3.umiAsset)).level))


  // ═══ 10. COMPUTE UNITS. NEVER MEASURED IN NINETEEN ROUNDS. ═══
  //
  // Accepted limit 17, and the only one on the list marked MUST BE MEASURED
  // rather than accepted: five auditors across rounds 18 and 19 argued it should
  // block a release. In v5 both Bank-signature paths walked EVERY top-level
  // instruction (O(ix x accts)); v6 deletes MINT's walk entirely and SEAL's is
  // forward-only to the first matching burn. Nothing bounds what a caller may pad
  // into the transaction, so it is still measured, not assumed. The
  // 1,232-BYTE ceiling is measured and known; the CU ceiling was not, and a CU
  // wall BELOW the byte wall would mean some transactions can be built, signed
  // and never land.
  //
  // The measurement is on the ARTIFACT: `meta.computeUnitsConsumed` off a landed
  // transaction, not an estimate and not a simulation.
  console.log('\n─── 10. compute units (limit 17) ───')
  const cuOf=async(sig:string)=>{
    // A confirmed signature is not necessarily FETCHABLE yet.
    for(let i=0;i<20;i++){
      const t=await conn.getTransaction(sig,{commitment:CM,maxSupportedTransactionVersion:0})
      if(t?.meta?.computeUnitsConsumed!=null) return t.meta.computeUnitsConsumed
      await new Promise(r=>setTimeout(r,250))
    }
    throw new Error(`could not read computeUnitsConsumed for ${sig} — refusing to report a CU number I did not measure`)
  }
  // A mint carrying N harmless extra top-level instructions, to find what padding
  // costs, now that MINT reads no instructions at all.
  const mintCU=async(pad:number)=>{
    const asset=Keypair.generate()
    const ixs:TransactionInstruction[]=[]
    // ⚠️ NOT ComputeBudget INSTRUCTIONS. Solana rejects a transaction carrying a
    // DUPLICATE instruction, and there is only one legal setComputeUnitPrice, so
    // padding that way fails at simulation and measures nothing. Distinct 1-lamport
    // transfers are valid, carry two accounts each for the confinement walk to
    // compare, and are the shape a real attacker would actually use. The amount
    // varies so no two instructions are byte-identical.
    for(let i=0;i<pad;i++) ixs.push(SystemProgram.transfer(
      {fromPubkey:alice.publicKey,toPubkey:carol.publicKey,lamports:i+1}))
    ixs.push(new TransactionInstruction({programId:MINT_PROG,
      data:Buffer.concat([d('mint_vault'),str('CU'),str('u'),u64(BigInt(LAMPORTS_PER_SOL)),attrs([]),await deckTail()]),
      keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:asset.publicKey,isSigner:true,isWritable:true},
        {pubkey:COLL,isSigner:false,isWritable:true},{pubkey:alice.publicKey,isSigner:true,isWritable:false},
        {pubkey:alice.publicKey,isSigner:true,isWritable:true},
        {pubkey:REVENUE,isSigner:false,isWritable:true},
        
        {pubkey:SEAL_CFG,isSigner:false,isWritable:false},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
        {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]}))
    const tx=new Transaction().add(...ixs)
    const sig=await sendAndConfirmTransaction(conn,tx,[deployer,asset,alice],{commitment:CM})
    const bytes=tx.serialize().length
    return {cu:await cuOf(sig),bytes}
  }
  const mintCUDry=async(pad:number)=>{
    const bh=(await conn.getLatestBlockhash()).blockhash
    const dt=await deckTail()
    const tx=new Transaction(); tx.feePayer=alice.publicKey; tx.recentBlockhash=bh
    for(let i=0;i<pad;i++) tx.add(SystemProgram.transfer({fromPubkey:alice.publicKey,toPubkey:carol.publicKey,lamports:i+1}))
    tx.add(new TransactionInstruction({programId:MINT_PROG,
      data:Buffer.concat([d('mint_vault'),str('CU'),str('u'),u64(BigInt(LAMPORTS_PER_SOL)),attrs([]),dt]),
      keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:Keypair.generate().publicKey,isSigner:true,isWritable:true},
        {pubkey:COLL,isSigner:false,isWritable:true},{pubkey:alice.publicKey,isSigner:true,isWritable:false},
        {pubkey:alice.publicKey,isSigner:true,isWritable:true},
        {pubkey:REVENUE,isSigner:false,isWritable:true},
        
        {pubkey:SEAL_CFG,isSigner:false,isWritable:false},{pubkey:MINT_AUTH,isSigner:false,isWritable:false},
        {pubkey:CORE,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]}))
    tx.serialize({requireAllSignatures:false,verifySignatures:false})
    return true }
  const CU_LIMIT=1_400_000          // Solana's per-transaction default cap
  // ⚠️ THE PAD IS FOUND, NOT FIXED. The deck proof now shares the 1,232-byte
  // transaction, so the 20-instruction pad this probe used before the deck landed
  // no longer serializes at all — measured, it dies at "Transaction too large:
  // 1262 > 1232". A hardcoded pad measures the budget the author last remembered;
  // this measures the one that exists.
  let maxPad=0
  for(let n=1;n<=20;n++){ try{ await mintCUDry(n); maxPad=n }catch{ break } }
  const cuPlain=await mintCU(0)
  const cuPad8=await mintCU(Math.min(4,maxPad))
  const cuPad20=await mintCU(maxPad)
  console.log(`  widest pad that still fits the packet: ${maxPad} instructions`)
  console.log(`  mint_vault, no padding      : ${String(cuPlain.cu).padStart(7)} CU   ${String(cuPlain.bytes).padStart(4)} bytes`)
  console.log(`  mint_vault + small pad      : ${String(cuPad8.cu).padStart(7)} CU   ${String(cuPad8.bytes).padStart(4)} bytes`)
  console.log(`  mint_vault + widest pad     : ${String(cuPad20.cu).padStart(7)} CU   ${String(cuPad20.bytes).padStart(4)} bytes`)
  const perIx=maxPad>0?(cuPad20.cu-cuPlain.cu)/maxPad:0
  console.log(`  marginal cost of one padded instruction: ${perIx.toFixed(1)} CU`)
  console.log(`  headroom at the widest pad the PACKET allows: ${(CU_LIMIT-cuPad20.cu).toLocaleString()} CU of ${CU_LIMIT.toLocaleString()}`)

  rec('10.1','a plain mint lands and its compute units are MEASURED, not estimated',
    'true',String(cuPlain.cu>0))
  // THE QUESTION LIMIT 17 ACTUALLY ASKS: is there a CU wall BELOW the byte wall?
  // The byte ceiling is 1,232. If a transaction that still FITS in bytes can
  // exhaust compute, then a signable transaction is an unlandable one.
  rec('10.2','a mint padded to near the BYTE ceiling still fits the COMPUTE ceiling',
    'true',String(cuPad20.cu<CU_LIMIT&&cuPad20.bytes<=1232))
  // A REGRESSION GATE WITH EXPLICIT HEADROOM, which is what the auditors asked
  // for. Deliberately generous: it exists to catch an ORDER-OF-MAGNITUDE change
  // from a future edit to the confinement walk, not to pin today's number.
  const CU_CEILING=400_000
  rec('10.3',`a plain mint stays under the ${CU_CEILING.toLocaleString()} CU regression ceiling`,
    'true',String(cuPlain.cu<CU_CEILING))
  rec('10.4','padding does not cost more per instruction than the mint itself',
    'true',String(perIx<cuPlain.cu))

  // ⚠️ THESE SIT HERE, NOT IN THE BLOCK ABOVE, AND THE SUITE IS WHY.
  // `because(id)` reads a record by id out of `R`, so it can only run AFTER the
  // section that pushes it. Placed with its siblings at 6b — which is where they
  // read naturally — all six reported "(no error recorded)" and failed, because
  // that block executes before sections 10 and 11 do. The right-reason mechanism
  // is order-dependent by construction, and it caught its own misplacement.
  because('11.3','ReservedAttribute')   // refused as RESERVED, not as too-many
  because('11.4','DuplicateAttribute')
  because('11.5','BadLevel')
  because('11.6','BadLevel')
  because('11.7','BadDeckProof')        // the DECK stopped it, not the level range
  because('11.8','BadDeckProof')
  // ⚠️ THE INSTRUMENT CHECK, AND IT IS THE WHOLE VALUE OF 11.13/11.14. A
  // hand-built Core instruction with one byte wrong is refused for being
  // malformed, which is indistinguishable from being refused for lacking
  // authority if all you read is REJECT. Core's `0x1a` is `NoApprovals` — read
  // out of the generated error map in @metaplex-foundation/mpl-core, not guessed
  // — so the instruction was well formed, reached the authority check, and was
  // turned away there. `0x1` and `0x2` are Deserialization and Serialization; if
  // either of those ever appears here, the arms above are proving nothing and
  // these two lines are what says so.
  because('11.13','0x1a')
  because('11.14','0x1a')
  because('11.9','DeckAlreadyCommitted')
  because('2.0a','BadDeckRoot')
  because('2.0c','SeedNotCommitted')
  because('2.0d','BadSaltHash')
  because('2.0f','SeedAlreadyCommitted')
  because('2.0i','BadSalt')
  // 11.12 is deliberately NOT given a `because`: past the measured packet bound
  // the client refuses to serialize and the program never runs, so there is no
  // program error to name. Asserting one would be asserting a gate that no
  // longer fires.

  const bad=R.filter(r=>!r.ok)
  console.log(`\n${'═'.repeat(78)}`)
  for(const r of R) console.log(`| ${r.id.padEnd(4)} | ${r.t.slice(0,54).padEnd(54)} | ${r.ok?'ok      ':'MISMATCH'} |`)
  console.log(`${'═'.repeat(78)}\n${R.length-bad.length}/${R.length} as predicted (4 PROGRAMS, real Core, REAL TOKENS)`)
  process.exit(bad.length?1:0)
}
main().catch(e=>{console.error('FATAL',e?.message||e,'\n',(e?.logs||[]).join('\n'));process.exit(2)})
