/**
 * THE TEST VAULT SIMULATION (Gary, 2026-10-03): one vault's whole life, on a
 * local validator carrying the REAL things wherever a real thing can be had:
 *   * Metaplex Core: the pinned mainnet build (scripts/run-tests.sh's dump);
 *   * cbBTC, $GARY, $GIRAFFISH: the mainnet mint accounts, cloned, with only the
 *     mint authority patched so this run can fund a vault (sim/fixtures.mjs);
 *   * the Giraffish Moments collection and two real Proof of Burn assets, cloned,
 *     with only the PoB owner patched (sim/clone-pob.mjs), claimed against the
 *     real 240-address root in scripts/pob-set.json;
 *   * the production census (945/525/315/210/105 = 2,100), the 85/15 split, the
 *     21,000-sat floor, and Gary's governance ratios (21% quorum, 51% threshold).
 * Only the clocks are short (vote, month, window), because a validator cannot
 * wait a week; the mainnet values are asserted by the alarm, not here.
 *
 * The life: claim it with a Proof of Burn, draw its level, load it with all three
 * reserve assets, request activation, vote the first round, attack it every way
 * the design names, fill the pool from real sales, join and get paid, redeem it
 * whole, and prove its address can never hold a vault again. Then a burst of
 * redemptions at a cap of TWO, which the main suite's census is too small to reach.
 */
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { Connection, Keypair, PublicKey as W, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, mintTo, createMint,
  createTransferInstruction, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction } from '@solana/spl-token'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { keypairIdentity, createNoopSigner, createSignerFromKeypair, generateSigner, publicKey as pk } from '@metaplex-foundation/umi'
import { toWeb3JsPublicKey, fromWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters'
import { mplCore, createCollection, execute, fetchAsset, fetchCollection, findAssetSignerPda, transfer, burn } from '@metaplex-foundation/mpl-core'
import { proofOf as pobProof, rootOf as pobRoot } from '../scripts/pob-merkle.mjs'

const RPC = 'http://127.0.0.1:8999'; const CM = 'confirmed' as const
const conn = new Connection(RPC, CM)
const SEAL_PROG = new W('9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273')
const MINT_PROG = new W('Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo')
const BURN_PROG = new W('8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8')
const GOV_PROG = new W('2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2')
const CORE = new W('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d')
const PDA = (s: (string | Buffer)[], p: W) => W.findProgramAddressSync(s.map(x => typeof x === 'string' ? Buffer.from(x) : x), p)[0]
const [SEAL_CFG, SEAL] = [PDA(['config'], SEAL_PROG), PDA(['seal'], SEAL_PROG)]
const [MINT_CFG, MINT_AUTH, REVENUE] = [PDA(['mint-config'], MINT_PROG), PDA(['mint'], MINT_PROG), PDA(['revenue'], MINT_PROG)]
const BURN_CFG = PDA(['burn-config'], BURN_PROG)
const [GOV_CFG, GOV_PDA] = [PDA(['gov-config'], GOV_PROG), PDA(['gov'], GOV_PROG)]
const SLOT_HASHES = new W('SysvarS1otHashes111111111111111111111111111')
const vrec = (a: W) => PDA(['vault', a.toBuffer()], MINT_PROG)
const d = (n: string) => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8)
const u8b = (n: number) => Buffer.from([n])
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
const i64 = (n: number | bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b }
const u64 = (n: number | bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
const str = (v: string) => Buffer.concat([u32(Buffer.byteLength(v)), Buffer.from(v)])
const SOME = (b: Buffer) => Buffer.concat([u8b(1), b])
const attrs = (l: [string, string][]) => Buffer.concat([u32(l.length), ...l.flatMap(([k, v]) => [str(k), str(v)])])
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const now = () => Math.floor(Date.now() / 1000)

// ── THE REAL THINGS ──
const CBBTC = new W('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij')
const GARY = new W('8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk')
const GIRAFFISH = new W('Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump')
const SET = JSON.parse(readFileSync('/opt/cbob-vaults/scripts/pob-set.json', 'utf8'))
const MOMENTS = new W(SET.collection)
const PICKS: { edition: number, address: string }[] = JSON.parse(readFileSync('/opt/cbob-vaults/sim/.fixtures/pob-picks.json', 'utf8'))
const key = (f: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`/opt/cbob-vaults/sim/.fixtures/${f}`, 'utf8'))))
// THE PRODUCTION CENSUS AND RATIOS.
const CENSUS = [945, 525, 315, 210, 105], MAX_SUPPLY = 2100n
const FLOOR_SATS = 21_000n
const VOTE_SECS = 60, MONTHLY = 120, NOTICE = 60, WINDOW = 20

const R: { id: string, t: string, want: string, got: string, ok: boolean, n?: string }[] = []
const rec = (id: string, t: string, want: string, got: string, n?: string) => { const ok = want === got; R.push({ id, t, want, got, ok, n })
  console.log(`  ${ok ? 'ok  ' : 'XX  '}${id}  ${t}  [want ${want}, got ${got}]${n ? `\n         ↳ ${n}` : ''}`) }
const att = async (f: () => Promise<unknown>) => { try { await f(); return { ok: true, err: '' } } catch (e: any) {
  const l = (e?.logs || e?.transactionLogs || []).filter((x: string) => /Error Code|custom program error|panicked/.test(x))
  return { ok: false, err: (l.join(' | ') || String(e?.message || e)).replace(/\s+/g, ' ').slice(0, 260) } } }
const RA = (r: { ok: boolean }) => r.ok ? 'ALLOW' : 'REJECT'

async function main() {
  const deployer = Keypair.fromSeed(Buffer.alloc(32, 7))        // the localnet INIT_AUTHORITY
  const alice = key('pob-owner.json'), mintAuth = key('mint-authority.json')
  const bob = Keypair.generate(), carol = Keypair.generate(), stranger = Keypair.generate()
  const guardian = Keypair.generate(), swapOp = Keypair.generate(), treasury = Keypair.generate()
  for (const k of [deployer, alice, bob, carol, stranger, guardian, mintAuth]) {
    const s = await conn.requestAirdrop(k.publicKey, 100 * LAMPORTS_PER_SOL)
    await conn.confirmTransaction({ signature: s, ...(await conn.getLatestBlockhash()) }, CM) }
  const umi = createUmi(RPC, { commitment: CM }).use(mplCore())
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(deployer.secretKey)))
  const U = (k: Keypair) => createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(k.secretKey))
  const send = (ixs: TransactionInstruction[], s: Keypair[]) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), s, { commitment: CM })
  const ata = (o: W, m: W) => getAssociatedTokenAddressSync(m, o, true)
  const bal = async (a: W) => { const i = await conn.getAccountInfo(a, CM); return i ? BigInt((await conn.getTokenAccountBalance(a, CM)).value.amount) : 0n }
  const cfg = async () => (await conn.getAccountInfo(MINT_CFG, CM))!.data
  const logsOf = async (sig: string) => { for (let i = 0; i < 20; i++) { const t = await conn.getTransaction(sig, { commitment: CM, maxSupportedTransactionVersion: 0 })
    if (t?.meta) return t.meta.logMessages || []; await sleep(250) } return [] as string[] }

  console.log('─── S0. the real things are on this validator ───')
  {
    const core = await conn.getAccountInfo(CORE, CM)
    const mints = await Promise.all([CBBTC, GARY, GIRAFFISH].map(m => conn.getAccountInfo(m, CM)))
    rec('S0.1', 'real Core, and the three real mints (classic SPL, mint authority patched to the local key)', 'true,3',
      `${!!core?.executable},${mints.filter(m => m && m.owner.equals(TOKEN_PROGRAM_ID) && new W(m.data.subarray(4, 36)).equals(mintAuth.publicKey)).length}`)
    const pobs = await Promise.all(PICKS.map(p => conn.getAccountInfo(new W(p.address), CM)))
    rec('S0.2', 'two REAL mainnet Proof of Burn assets, in the real Moments collection, owned by the local key', '2',
      String(pobs.filter(a => a && a.data[0] === 1 && new W(a.data.subarray(1, 33)).equals(alice.publicKey) && new W(a.data.subarray(34, 66)).equals(MOMENTS)).length))
    rec('S0.3', 'the root this run commits is the real 240-address root, recomputed from the pinned set', SET.root,
      Buffer.from(pobRoot(SET.assets.map((a: any) => new W(a.address).toBytes()))).toString('hex'))
  }
  const DEC: Record<string, number> = {}
  for (const [n, m] of [['cbBTC', CBBTC], ['$GARY', GARY], ['$GIRAFFISH', GIRAFFISH]] as [string, W][]) DEC[n] = (await conn.getAccountInfo(m, CM))!.data[44]
  console.log(`  decimals: cbBTC ${DEC.cbBTC}, $GARY ${DEC.$GARY}, $GIRAFFISH ${DEC.$GIRAFFISH}`)

  // ── the CBOB collection, and the four inits in the order production must use ──
  const coll = generateSigner(umi)
  await createCollection(umi, { collection: coll, name: 'CBOBTC Vaults', uri: 'https://cdn.gary.club/cbob/c.json',
    updateAuthority: pk(MINT_AUTH.toBase58()) }).sendAndConfirm(umi, { confirm: { commitment: CM } })
  const COLL = toWeb3JsPublicKey(coll.publicKey)
  console.log('\n─── S1. initialize: SEAL, MINT, BURN, GOV — production census, ratios and wiring ───')
  const RES = [CBBTC, GARY, GIRAFFISH]
  const si = await att(() => send([new TransactionInstruction({ programId: SEAL_PROG,
    data: Buffer.concat([d('initialize'), COLL.toBuffer(), u32(3), ...RES.map(m => m.toBuffer())]),
    keys: [{ pubkey: SEAL_CFG, isSigner: false, isWritable: true }, { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, ...RES.map(m => ({ pubkey: m, isSigner: false, isWritable: false }))] })], [deployer]))
  rec('S1.1', 'SEAL takes the three REAL reserve mints (each proven classic SPL by its own account)', 'ALLOW', RA(si), si.err)
  const OPENS = now() + 15, CLOSES = OPENS + 75
  const mi = await att(() => send([new TransactionInstruction({ programId: MINT_PROG,
    data: Buffer.concat([d('initialize'), treasury.publicKey.toBuffer(), swapOp.publicKey.toBuffer(), SOME(guardian.publicKey.toBuffer()),
      u64(50_000_000n), u64(MAX_SUPPLY), u64(50n * BigInt(LAMPORTS_PER_SOL)), i64(3600), Buffer.concat(CENSUS.map(u32)),
      CBBTC.toBuffer(), MOMENTS.toBuffer(), Buffer.from(SET.root, 'hex'), i64(OPENS), i64(CLOSES), i64(MONTHLY),
      i64(NOTICE), u64(BigInt(LAMPORTS_PER_SOL)), i64(24 * 3600), u64(100_000_000n)]),
    keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: true }, { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: COLL, isSigner: false, isWritable: true }, { pubkey: MINT_AUTH, isSigner: false, isWritable: false },
      { pubkey: CORE, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SEAL_CFG, isSigner: false, isWritable: false }] })], [deployer]))
  rec('S1.2', 'MINT: real cbBTC as the payment mint, the real Moments collection and root, the 2,100 census', 'ALLOW', RA(mi), mi.err)
  const bi = await att(() => send([new TransactionInstruction({ programId: BURN_PROG, data: Buffer.concat([d('initialize'), COLL.toBuffer(), i64(WINDOW)]),
    keys: [{ pubkey: BURN_CFG, isSigner: false, isWritable: true }, { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: SEAL_CFG, isSigner: false, isWritable: false }] })], [deployer]))
  rec('S1.3', 'BURN', 'ALLOW', RA(bi), bi.err)
  const gi = await att(() => send([new TransactionInstruction({ programId: GOV_PROG,
    data: Buffer.concat([d('initialize'), COLL.toBuffer(), u16(2100), u16(5100), i64(VOTE_SECS)]),
    keys: [{ pubkey: GOV_CFG, isSigner: false, isWritable: true }, { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: MINT_CFG, isSigner: false, isWritable: false }] })], [deployer]))
  rec('S1.4', 'GOV at Gary\'s ratios: 21% quorum, 51% threshold', 'ALLOW', RA(gi), gi.err)

  // ── helpers ──
  const POOL = ata(MINT_CFG, CBBTC), POOLK = { pubkey: POOL, isSigner: false, isWritable: false }
  const revAta = ata(REVENUE, CBBTC)
  await send([createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey, POOL, MINT_CFG, CBBTC),
    createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey, revAta, REVENUE, CBBTC),
    createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey, ata(treasury.publicKey, CBBTC), treasury.publicKey, CBBTC)], [deployer])
  type V = { asset: W, kp: Keypair, pda: W, pdaU: any, owner: Keypair, attrs: [string, string][] }
  const mkV = (kp: Keypair, owner: Keypair, a: [string, string][]): V => { const [pdaU] = findAssetSignerPda(umi, { asset: pk(kp.publicKey.toBase58()) })
    return { asset: kp.publicKey, kp, pda: toWeb3JsPublicKey(pdaU), pdaU, owner, attrs: a } }
  const fundReal = async (to: W, m: W, amt: bigint) => {
    await send([createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey, ata(to, m), to, m)], [deployer])
    await mintTo(conn, deployer, m, ata(to, m), mintAuth, amt, [], { commitment: CM }) }
  const ixClaim = (asset: W, owner: W, pob: W, proof: Buffer[]) => new TransactionInstruction({ programId: MINT_PROG,
    data: Buffer.concat([d('claim_charter_vault'), str('CBOBTC Charter Vault'), str('https://cdn.gary.club/cbob/v.json'), attrs([]),
      u32(proof.length), ...proof, u8b(0)]),
    keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: true }, { pubkey: vrec(asset), isSigner: false, isWritable: true },
      { pubkey: asset, isSigner: true, isWritable: true }, { pubkey: COLL, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false }, { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: pob, isSigner: false, isWritable: true }, { pubkey: MOMENTS, isSigner: false, isWritable: true },
      { pubkey: SEAL_CFG, isSigner: false, isWritable: false }, { pubkey: MINT_AUTH, isSigner: false, isWritable: false },
      { pubkey: CORE, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, POOLK] })
  const ixMint = (asset: W, owner: W, maxPrice: bigint) => new TransactionInstruction({ programId: MINT_PROG,
    data: Buffer.concat([d('mint_vault'), str('CBOBTC Vault'), str('https://cdn.gary.club/cbob/v.json'), u64(maxPrice), attrs([])]),
    keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: true }, { pubkey: vrec(asset), isSigner: false, isWritable: true },
      { pubkey: asset, isSigner: true, isWritable: true }, { pubkey: COLL, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false }, { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: ata(owner, CBBTC), isSigner: false, isWritable: true }, { pubkey: CBBTC, isSigner: false, isWritable: false },
      { pubkey: revAta, isSigner: false, isWritable: true }, { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SEAL_CFG, isSigner: false, isWritable: false }, { pubkey: MINT_AUTH, isSigner: false, isWritable: false },
      { pubkey: CORE, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, POOLK] })
  const ixOpen = (v: V, o: W) => new TransactionInstruction({ programId: SEAL_PROG, data: Buffer.from(d('open_for_redemption')), keys: [
    { pubkey: v.asset, isSigner: false, isWritable: true }, { pubkey: COLL, isSigner: false, isWritable: true }, { pubkey: o, isSigner: true, isWritable: false },
    { pubkey: o, isSigner: true, isWritable: true }, { pubkey: SEAL_CFG, isSigner: false, isWritable: false }, { pubkey: SEAL, isSigner: false, isWritable: false },
    { pubkey: CORE, isSigner: false, isWritable: false }, { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] })
  const declare = (p: W) => RES.flatMap(m => [getAssociatedTokenAddressSync(m, p, true), getAssociatedTokenAddressSync(m, p, true, TOKEN_2022_PROGRAM_ID)])
  const ixBurn = (v: { asset: W, pda: W }, o: W, extra: W[] = declare(v.pda)) => new TransactionInstruction({ programId: BURN_PROG,
    data: Buffer.concat([d('burn_vault'), u8b(extra.length)]), keys: [
    { pubkey: v.asset, isSigner: false, isWritable: true }, { pubkey: COLL, isSigner: false, isWritable: true }, { pubkey: o, isSigner: true, isWritable: false },
    { pubkey: v.pda, isSigner: false, isWritable: true }, { pubkey: o, isSigner: true, isWritable: true },
    { pubkey: BURN_CFG, isSigner: false, isWritable: true }, { pubkey: SEAL_CFG, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false }, { pubkey: CORE, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: MINT_PROG, isSigner: false, isWritable: false },
    { pubkey: MINT_CFG, isSigner: false, isWritable: true }, { pubkey: vrec(v.asset), isSigner: false, isWritable: true }, POOLK,
    ...extra.map(p => ({ pubkey: p, isSigner: false, isWritable: true }))] })
  /** Sweep: per mint [amount to take, close the account]; the owner signs through Core Execute. */
  const sweep = (v: V, legs: [W, bigint, boolean][], to: Keypair = v.owner) => {
    const ixs: any[] = []
    for (const [m, amt, close] of legs) {
      if (amt > 0n) ixs.push(fromWeb3JsInstruction(createTransferInstruction(ata(v.pda, m), ata(to.publicKey, m), v.pda, amt)))
      if (close) ixs.push(fromWeb3JsInstruction(createCloseAccountInstruction(ata(v.pda, m), to.publicKey, v.pda))) }
    return execute(umi, { asset: { publicKey: pk(v.asset.toBase58()) }, collection: { publicKey: coll.publicKey } as any, instructions: ixs,
      signers: [createNoopSigner(v.pdaU)], authority: U(v.owner), payer: U(v.owner) }).getInstructions().map(i => new TransactionInstruction({
        programId: toWeb3JsPublicKey(i.programId), data: Buffer.from(i.data),
        keys: i.keys.map(k => ({ pubkey: toWeb3JsPublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })) })) }
  const ixActivate = (v: V) => new TransactionInstruction({ programId: MINT_PROG, data: d('activate'),
    keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: true }, { pubkey: vrec(v.asset), isSigner: false, isWritable: true },
      { pubkey: v.asset, isSigner: false, isWritable: false }, { pubkey: ata(v.pda, CBBTC), isSigner: false, isWritable: false }, POOLK] })
  const ixDistribute = (burner?: Keypair) => new TransactionInstruction({ programId: MINT_PROG, data: Buffer.concat([d('distribute'), u8b(burner ? 1 : 0)]),
    keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: true }, POOLK, ...(burner ? [{ pubkey: burner.publicKey, isSigner: true, isWritable: false },
      { pubkey: ata(burner.publicKey, GARY), isSigner: false, isWritable: true }, { pubkey: GARY, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }] : [])] })
  const ixPoolClaim = (vs: V[]) => new TransactionInstruction({ programId: MINT_PROG, data: Buffer.concat([d('claim'), u8b(0)]),
    keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: true }, { pubkey: POOL, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ...vs.flatMap(v => [{ pubkey: vrec(v.asset), isSigner: false, isWritable: true }, { pubkey: ata(v.pda, CBBTC), isSigner: false, isWritable: true }])] })
  const recOf = async (a: W) => (await conn.getAccountInfo(vrec(a), CM))!.data
  const readySlot = (rs: number) => { let a = rs; for (let i = 0; i < 2; i++) a = (Math.floor(a / 4) + 2) * 4; return a }
  const reveal = async (v: V) => {
    const rs = Number((await recOf(v.asset)).readBigUInt64LE(49))
    while (await conn.getSlot(CM) <= readySlot(rs)) await sleep(200)
    await send([new TransactionInstruction({ programId: MINT_PROG, data: d('capture_entropy'),
      keys: [{ pubkey: vrec(v.asset), isSigner: false, isWritable: true }, { pubkey: SLOT_HASHES, isSigner: false, isWritable: false }] })], [deployer])
    await send([new TransactionInstruction({ programId: MINT_PROG, data: Buffer.concat([d('reveal_level'), attrs(v.attrs)]),
      keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: true }, { pubkey: vrec(v.asset), isSigner: false, isWritable: true },
        { pubkey: v.asset, isSigner: false, isWritable: true }, { pubkey: COLL, isSigner: false, isWritable: true },
        { pubkey: deployer.publicKey, isSigner: true, isWritable: true }, { pubkey: MINT_AUTH, isSigner: false, isWritable: false },
        { pubkey: SLOT_HASHES, isSigner: false, isWritable: false }, { pubkey: CORE, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] })], [deployer]) }

  // ═══ S2. CLAIM IT WITH A REAL PROOF OF BURN ═══
  console.log('\n─── S2. the Test Vault is claimed by burning a REAL mainnet Proof of Burn ───')
  while (now() <= OPENS + 1) await sleep(500)
  const addrs = SET.assets.map((a: any) => new W(a.address).toBytes())
  const charter: V[] = []
  const size0 = Number(((await fetchCollection(umi, pk(MOMENTS.toBase58()))) as any).currentSize)
  for (const [pi, p] of PICKS.entries()) {
    const i = SET.assets.findIndex((a: any) => a.address === p.address)
    const kp = Keypair.generate(), pob = new W(p.address)
    const r = await att(() => send([ixClaim(kp.publicKey, alice.publicKey, pob, pobProof(addrs, i).map((x: any) => Buffer.from(x)))], [alice, kp]))
    rec(`S2.${pi + 1}`, `claim with real PoB #${p.edition} and its real proof (depth ${pobProof(addrs, i).length})`, 'ALLOW', RA(r), r.err)
    if (r.ok) charter.push(mkV(kp, alice, [['charter', pob.toBase58()]]))
    const a = await conn.getAccountInfo(pob, CM)
    rec(`S2.${pi + 1}b`, `...and PoB #${p.edition} is BURNED on the real collection (Core, 1 byte, key 0)`, '1,0', `${a?.data.length},${a?.data[0]}`)
  }
  const [TV, TV2] = charter
  if (!TV) throw new Error('no Test Vault: the charter claim against the real collection failed (see S2.1)')
  {
    const col: any = await fetchCollection(umi, pk(MOMENTS.toBase58()))
    rec('S2.3', 'the real Moments collection counted both burns (its live size fell by two)', String(size0 - 2), String(Number(col.currentSize)),
      `num_minted ${col.numMinted}`)
  }
  await reveal(TV); await reveal(TV2)
  {
    const r = await recOf(TV.asset)
    const a: any = await fetchAsset(umi, pk(TV.asset.toBase58()))
    const lv = (a.attributes?.attributeList || []).find((x: any) => x.key === 'level')?.value
    rec('S2.4', 'its level is drawn from slot hashes against the 2,100 census and written onto the vault', 'true',
      String(r[57] >= 1 && r[57] <= 5 && lv === ['I', 'II', 'III', 'IV', 'V'][r[57] - 1]), `level ${lv}`)
  }

  // ═══ S3. LOAD IT WITH ALL THREE REAL RESERVE ASSETS ═══
  console.log('\n─── S3. load: real cbBTC, real $GARY, real $GIRAFFISH ───')
  const LOAD = { cbBTC: 50_000n, GARY: 1_000_000n * 10n ** BigInt(DEC.$GARY), GIRAFFISH: 5_000_000n * 10n ** BigInt(DEC.$GIRAFFISH) }
  for (const [m, amt] of [[CBBTC, LOAD.cbBTC], [GARY, LOAD.GARY], [GIRAFFISH, LOAD.GIRAFFISH]] as [W, bigint][]) await fundReal(TV.pda, m, amt)
  rec('S3.1', 'the vault\'s three accounts hold what was sent', `${LOAD.cbBTC},${LOAD.GARY},${LOAD.GIRAFFISH}`,
    `${await bal(ata(TV.pda, CBBTC))},${await bal(ata(TV.pda, GARY))},${await bal(ata(TV.pda, GIRAFFISH))}`)
  const act1 = await att(() => send([ixActivate(TV)], [deployer]))
  const act2 = await att(() => send([ixActivate(TV)], [deployer]))
  rec('S3.2', 'activation REQUESTED (50,000 sats >= 21,000), and a second call before any distribution is refused', 'ALLOW,REJECT',
    `${RA(act1)},${RA(act2)}`, act2.err)
  rec('S3.2!', '  ...refused because ActivationPending', 'true', String(act2.err.includes('ActivationPending')))

  // ═══ S4. THE FIRST VOTE, BY THE CHARTER VAULTS, AT GARY'S RATIOS ═══
  console.log('\n─── S4. the charter vaults vote the first round in (21% quorum, 51%) ───')
  while (now() <= CLOSES + 1) await sleep(500)
  const propId = (n: number) => PDA(['proposal', u64(n)], GOV_PROG)
  const ends = now() + VOTE_SECS + 5
  const act = Buffer.concat([u8b(0), i64(now() - 60), i64(now() + 3600), u64(FLOOR_SATS), u32(100)])
  const cp = await att(() => send([new TransactionInstruction({ programId: GOV_PROG, data: Buffer.concat([d('create_proposal'), u32(1), act, i64(ends)]),
    keys: [{ pubkey: GOV_CFG, isSigner: false, isWritable: true }, { pubkey: propId(1), isSigner: false, isWritable: true },
      { pubkey: MINT_CFG, isSigner: false, isWritable: false }, { pubkey: BURN_CFG, isSigner: false, isWritable: false },
      { pubkey: TV.asset, isSigner: false, isWritable: false }, { pubkey: alice.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] })], [alice]))
  rec('S4.1', 'a round at the 21,000-sat floor is proposed', 'ALLOW', RA(cp), cp.err)
  for (const v of charter) await send([new TransactionInstruction({ programId: GOV_PROG, data: Buffer.concat([d('cast_vote'), u8b(1)]),
    keys: [{ pubkey: GOV_CFG, isSigner: false, isWritable: false }, { pubkey: propId(1), isSigner: false, isWritable: true },
      { pubkey: PDA(['vote', propId(1).toBuffer(), v.asset.toBuffer()], GOV_PROG), isSigner: false, isWritable: true },
      { pubkey: v.asset, isSigner: false, isWritable: false }, { pubkey: vrec(v.asset), isSigner: false, isWritable: false },
      { pubkey: alice.publicKey, isSigner: true, isWritable: false }, { pubkey: alice.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] })], [alice])
  while (now() <= ends + 1) await sleep(500)
  const ex = await att(() => send([new TransactionInstruction({ programId: GOV_PROG, data: Buffer.from(d('execute_proposal')),
    keys: [{ pubkey: GOV_CFG, isSigner: false, isWritable: true }, { pubkey: propId(1), isSigner: false, isWritable: true },
      { pubkey: MINT_CFG, isSigner: false, isWritable: true }, { pubkey: GOV_PDA, isSigner: false, isWritable: false },
      { pubkey: MINT_PROG, isSigner: false, isWritable: false }] })], [deployer]))
  rec('S4.2', '...both charter vaults vote YES and it executes: the round is open, priced in sats', `ALLOW,${FLOOR_SATS}`,
    `${RA(ex)},${(await cfg()).readBigUInt64LE(125)}`, ex.err)

  // ═══ S5. REAL SALES FILL THE REVENUE ADDRESS ═══
  console.log('\n─── S5. paid mints in real cbBTC: bob buys one, carol buys 48 (live supply 51, a redemption cap of TWO) ───')
  await fundReal(bob.publicKey, CBBTC, 10n * FLOOR_SATS); await fundReal(carol.publicKey, CBBTC, 60n * FLOOR_SATS)
  const BV = (() => { const kp = Keypair.generate(); return { kp, v: mkV(kp, bob, []) } })()
  const bm = await att(() => send([ixMint(BV.kp.publicKey, bob.publicKey, FLOOR_SATS)], [bob, BV.kp]))
  rec('S5.1', 'bob mints a vault paying exactly 21,000 sats of real cbBTC into the revenue address', `ALLOW,${FLOOR_SATS}`, `${RA(bm)},${await bal(revAta)}`, bm.err)
  const CV: V[] = []
  for (let i = 0; i < 48; i++) { const kp = Keypair.generate(); await send([ixMint(kp.publicKey, carol.publicKey, FLOOR_SATS)], [carol, kp]); CV.push(mkV(kp, carol, [])) }
  rec('S5.2', '...and carol 48 more: 49 sales, 1,029,000 sats in revenue', `${49n * FLOOR_SATS}`, String(await bal(revAta)))

  // ═══ S6. EVERY ATTACK THE DESIGN NAMES, AGAINST THE LOADED TEST VAULT ═══
  console.log('\n─── S6. attacks on the loaded Test Vault: every one refused, nothing moves ───')
  const all3 = (close: boolean): [W, bigint, boolean][] => [[CBBTC, LOAD.cbBTC, close], [GARY, LOAD.GARY, close], [GIRAFFISH, LOAD.GIRAFFISH, close]]
  for (const m of RES) await send([createAssociatedTokenAccountIdempotentInstruction(alice.publicKey, ata(alice.publicKey, m), alice.publicKey, m)], [alice])
  const attacks: [string, string, () => Promise<unknown>][] = [
    ['S6.1', 'the owner opens it with NO terminal burn (to sweep and keep the vault)', () => send([ixOpen(TV, alice.publicKey), ...sweep(TV, all3(true))], [alice])],
    ['S6.2', 'the owner sweeps through Core Execute with no open at all (the seal)', () => send([...sweep(TV, all3(true))], [alice])],
    ['S6.3', 'a burn with no preceding open', () => send([ixBurn(TV, alice.publicKey)], [alice])],
    ['S6.4', 'a PARTIAL sweep (all the cbBTC, none of the rest) and burn', () => send([ixOpen(TV, alice.publicKey), ...sweep(TV, [[CBBTC, LOAD.cbBTC, true]]), ixBurn(TV, alice.publicKey)], [alice])],
    // One asset swept, not three: the three-asset version is 1,284 bytes and never
    // reaches the programs (measured), which would make this a refusal for the
    // WRONG reason.
    ['S6.5', 'open the Test Vault, sweep its cbBTC, burn BOB\'s vault instead', () => send([ixOpen(TV, alice.publicKey), ...sweep(TV, [[CBBTC, LOAD.cbBTC, true]]), ixBurn(BV.v, alice.publicKey)], [alice])],
    ['S6.6', 'a STRANGER signs as owner', () => send([ixOpen(TV, stranger.publicKey), ixBurn(TV, stranger.publicKey)], [stranger])],
    ['S6.7', 'redeem without declaring the reserve accounts', () => send([ixOpen(TV, alice.publicKey), ...sweep(TV, all3(true)), ixBurn(TV, alice.publicKey, [])], [alice])],
  ]
  for (const [id, t, f] of attacks) { const r = await att(f); rec(id, t, 'REJECT', RA(r), r.err) }
  // OLD OWNER AFTER TRANSFER: TV2 goes to bob; alice can no longer touch it.
  await transfer(umi, { asset: { publicKey: pk(TV2.asset.toBase58()), owner: pk(alice.publicKey.toBase58()) } as any,
    collection: { publicKey: coll.publicKey } as any, newOwner: pk(bob.publicKey.toBase58()), authority: U(alice) }).sendAndConfirm(umi, { confirm: { commitment: CM } })
  const old = await att(() => send([ixOpen(TV2, alice.publicKey), ixBurn(TV2, alice.publicKey)], [alice]))
  rec('S6.8', 'the OLD owner redeems a vault they transferred away', 'REJECT', RA(old), old.err)
  // A NESTED VAULT: carol sends one vault into another; declared, the burn refuses.
  const [OUT, IN] = [CV[0], CV[1]]
  await transfer(umi, { asset: { publicKey: pk(IN.asset.toBase58()), owner: pk(carol.publicKey.toBase58()) } as any,
    collection: { publicKey: coll.publicKey } as any, newOwner: pk(OUT.pda.toBase58()), authority: U(carol) }).sendAndConfirm(umi, { confirm: { commitment: CM } })
  const nest = await att(() => send([ixOpen(OUT, carol.publicKey), ixBurn(OUT, carol.publicKey, [...declare(OUT.pda), IN.asset])], [carol]))
  rec('S6.9', 'redeem a vault holding ANOTHER vault, the inner one declared', 'REJECT', RA(nest), nest.err)
  // AN AIRDROP: a stranger's token in the Test Vault. Declared, the burn refuses;
  // undeclared it would be destroyed, which only the redeem page can warn about.
  const junk = await createMint(conn, stranger, stranger.publicKey, null, 0)
  await send([createAssociatedTokenAccountIdempotentInstruction(stranger.publicKey, ata(TV.pda, junk), TV.pda, junk)], [stranger])
  await mintTo(conn, stranger, junk, ata(TV.pda, junk), stranger, 7_000n, [], { commitment: CM })
  const air = await att(() => send([ixOpen(TV, alice.publicKey), ...sweep(TV, all3(true)), ixBurn(TV, alice.publicKey, [...declare(TV.pda), ata(TV.pda, junk)])], [alice]))
  rec('S6.10', 'redeem with a stranger\'s AIRDROPPED token declared', 'REJECT', RA(air), air.err)
  {
    const D: any = await import('../bank/detectors.mjs')
    const owned = (await conn.getTokenAccountsByOwner(TV.pda, { programId: TOKEN_PROGRAM_ID }, CM)).value
      .map(x => ({ address: x.pubkey.toBase58(), mint: new W(x.account.data.subarray(0, 32)).toBase58(), amount: x.account.data.readBigUInt64LE(64) }))
    const f = D.detectUndeclaredTokenAccounts(TV.asset.toBase58(), declare(TV.pda).map(x => x.toBase58()), owned)
    rec('S6.11', '...and the redeem page\'s check names the airdropped account before the owner signs', 'true',
      String(f.some((x: any) => JSON.stringify(x).includes(ata(TV.pda, junk).toBase58()))), f.map((x: any) => x.kind).join(','))
  }
  // A BARE CORE BURN cannot be prevented (proven impossibility 1); it is retired.
  const BB = CV[2]
  const bare = await att(async () => { const a = await fetchAsset(umi, pk(BB.asset.toBase58())); const c = await fetchCollection(umi, coll.publicKey)
    await burn(umi, { asset: a, collection: c, authority: U(carol) }).sendAndConfirm(umi, { confirm: { commitment: CM } }) })
  const ret = await att(() => send([new TransactionInstruction({ programId: MINT_PROG, data: d('retire_burned'),
    keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: true }, { pubkey: vrec(BB.asset), isSigner: false, isWritable: true },
      { pubkey: BB.asset, isSigner: false, isWritable: false }] })], [deployer]))
  rec('S6.12', 'a bare Core burn goes through (it cannot be stopped) and anyone retires it', 'ALLOW,ALLOW', `${RA(bare)},${RA(ret)}`, `${bare.err} ${ret.err}`)
  rec('S6.13', 'after every attack the Test Vault still holds every unit of all three assets',
    `${LOAD.cbBTC},${LOAD.GARY},${LOAD.GIRAFFISH}`, `${await bal(ata(TV.pda, CBBTC))},${await bal(ata(TV.pda, GARY))},${await bal(ata(TV.pda, GIRAFFISH))}`)

  // ═══ S7. THE POOL: real revenue, 85/15, the door opens, the Test Vault joins and is paid ═══
  console.log('\n─── S7. the pool: 85/15 of real sales, the vault joins, a real 100 $GARY burn pays it ───')
  const total = await bal(revAta)
  await send([new TransactionInstruction({ programId: MINT_PROG, data: Buffer.concat([d('split_revenue'), u8b(DEC.cbBTC)]),
    keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: false }, { pubkey: REVENUE, isSigner: false, isWritable: true },
      { pubkey: CBBTC, isSigner: false, isWritable: false }, { pubkey: revAta, isSigner: false, isWritable: true },
      { pubkey: POOL, isSigner: false, isWritable: true }, { pubkey: ata(treasury.publicKey, CBBTC), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }] })], [deployer])
  const toBank = total * 1500n / 10000n
  rec('S7.1', 'the split: 15% (floored) to the CBOBTC treasury, the rest to the pool', `${toBank},${total - toBank}`,
    `${await bal(ata(treasury.publicKey, CBBTC))},${await bal(POOL)}`)
  await fundReal(alice.publicKey, GARY, 1_000n * 10n ** BigInt(DEC.$GARY))
  const door = await att(() => send([ixDistribute(alice)], [alice]))
  rec('S7.2', 'nobody joined yet: a 100 $GARY burn cannot open the door (the first-activator attack)', 'REJECT', RA(door), door.err)
  rec('S7.2!', '  ...refused as NoActiveVaults, or JoinWaitingFirst if traffic already ticked the door open', 'true',
    String(/NoActiveVaults|JoinWaitingFirst/.test(door.err)))
  // The door: once a month has passed with nobody joined, ANY host (one of the 49
  // sales above, or a free distribute) ticks the epoch, and then a free claim
  // joins the vault. Whichever happened first, the vault must end up joined.
  await send([ixPoolClaim([TV])], [deployer])
  let tick = { ok: true, err: 'ticked in-line by an earlier host' }
  if (!(await recOf(TV.asset))[125]) {
    for (;;) { const c = await cfg(); if (BigInt(now()) >= c.readBigInt64LE(510) + c.readBigInt64LE(574) + 2n) break; await sleep(1000) }
    tick = await att(() => send([ixDistribute()], [deployer]))
    await send([ixPoolClaim([TV])], [deployer])
  }
  rec('S7.3', 'the month runs: the epoch ticks with nobody joined, and a free claim JOINS the Test Vault', 'ALLOW,1,0',
    `${RA(tick)},${(await recOf(TV.asset))[125]},${(await recOf(TV.asset))[177]}`, tick.err)
  const supply = async () => (await conn.getAccountInfo(GARY, CM))!.data.readBigUInt64LE(36)
  const s0 = await supply(), avail = await bal(POOL), tv0 = await bal(ata(TV.pda, CBBTC))
  const dist = await att(() => send([ixDistribute(alice)], [alice]))
  await send([ixPoolClaim([TV])], [deployer])
  const paid = (await bal(ata(TV.pda, CBBTC))) - tv0
  rec('S7.4', 'alice burns 100 REAL $GARY (the supply falls by exactly that) and the pool is paid INTO the vault',
    `ALLOW,${100n * 10n ** BigInt(DEC.$GARY)},true`, `${RA(dist)},${s0 - await supply()},${paid > 0n && paid <= avail}`, `${dist.err} paid ${paid} of ${avail}`)

  // ═══ S8. REDEEM IT WHOLE ═══
  console.log('\n─── S8. the redemption: claim, open, sweep all three, burn — one transaction, the owner alone ───')
  const before = { c: await bal(ata(alice.publicKey, CBBTC)), g: await bal(ata(alice.publicKey, GARY)), f: await bal(ata(alice.publicKey, GIRAFFISH)) }
  const inVault = { c: await bal(ata(TV.pda, CBBTC)), g: await bal(ata(TV.pda, GARY)), f: await bal(ata(TV.pda, GIRAFFISH)) }
  // The airdropped junk is the redeemer's to abandon: undeclared, it is destroyed.
  let sig = ''
  const red = await att(async () => { sig = await send([ixOpen(TV, alice.publicKey), ixPoolClaim([TV]),
    ...sweep(TV, [[CBBTC, inVault.c, true], [GARY, inVault.g, true], [GIRAFFISH, inVault.f, true]]), ixBurn(TV, alice.publicKey)], [alice]) })
  rec('S8.1', 'the owner redeems the Test Vault holding all three assets, alone', 'ALLOW', RA(red), red.err)
  rec('S8.2', '...and receives every unit of every asset, the payout included',
    `${inVault.c},${inVault.g},${inVault.f}`,
    `${(await bal(ata(alice.publicKey, CBBTC))) - before.c},${(await bal(ata(alice.publicKey, GARY))) - before.g},${(await bal(ata(alice.publicKey, GIRAFFISH))) - before.f}`)
  {
    const a = await conn.getAccountInfo(TV.asset, CM); const r = await recOf(TV.asset)
    rec('S8.3', '...the vault is BURNED (Core, 1 byte, key 0), retired, off the schedule, and the redemption is logged for the poster',
      '1,0,1,0,true', `${a?.data.length},${a?.data[0]},${r[126]},${r[125]},${(await logsOf(sig)).some(l => l.includes(`CBOB_REDEEMED ${TV.asset.toBase58()}`))}`)
  }

  // ═══ S9. THE ADDRESS NEVER HOLDS A VAULT AGAIN ═══
  console.log('\n─── S9. its address can never hold a vault again ───')
  const remint = await att(() => send([ixMint(TV.asset, bob.publicKey, FLOOR_SATS)], [bob, TV.kp]))
  rec('S9.1', 'mint a NEW vault at the burned Test Vault\'s address, holding its keypair', 'REJECT', RA(remint), remint.err)
  const direct = await att(async () => { const { create } = await import('@metaplex-foundation/mpl-core')
    await create(umi, { asset: createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(TV.kp.secretKey)), name: 'x', uri: 'u' })
      .sendAndConfirm(umi, { confirm: { commitment: CM } }) })
  rec('S9.2', '...or create ANY Core asset there, outside our programs', 'REJECT', RA(direct), direct.err)

  // ═══ S10. THE ROLLING WINDOW AT A CAP OF TWO ═══
  console.log('\n─── S10. redemptions at a cap of TWO: no window of 20 s ever holds three ───')
  const live = async () => { const c = await cfg(); const b = (await conn.getAccountInfo(BURN_CFG, CM))!.data
    return c.readBigUInt64LE(141) - b.readBigUInt64LE(42) - c.readBigUInt64LE(454) }
  const L = await live(); const cap = (L * 210n + 9999n) / 10000n
  rec('S10.0', '(precondition) live supply gives a cap of two', '2', String(cap), `live ${L}`)
  // Let the window empty first (S8 redeemed).
  await sleep((WINDOW + 2) * 1000)
  const empties = CV.slice(3, 6)
  const res = await Promise.all(empties.map(v => att(() => send([ixOpen(v, carol.publicKey), ixBurn(v, carol.publicKey)], [carol]))))
  rec('S10.1', 'three redemptions at once: exactly TWO land', '2', String(res.filter(r => r.ok).length), res.map(r => r.err).filter(Boolean).join(' | '))
  const left = empties[res.findIndex(r => !r.ok)]
  await sleep(WINDOW * 600)
  const mid = await att(() => send([ixOpen(left, carol.publicKey), ixBurn(left, carol.publicKey)], [carol]))
  rec('S10.2', '60% of a window later: still refused (a stage-3b bucket would have let one through)', 'REJECT', RA(mid), mid.err)
  await sleep(WINDOW * 500)
  const late = await att(() => send([ixOpen(left, carol.publicKey), ixBurn(left, carol.publicKey)], [carol]))
  rec('S10.3', '...and once the window has rolled past, it lands', 'ALLOW', RA(late), late.err)

  // ═══ A REFUSAL FOR THE WRONG REASON IS A FALSE PASS: every negative, pinned ═══
  console.log('\n─── every refusal above, for the RIGHT reason ───')
  const because = (id: string, code: string) => { const r = R.find(x => x.id === id); const hit = (r?.n || '').includes(code)
    R.push({ id: id + '!', t: `  rejected because ${code}`, want: 'true', got: String(hit), ok: hit, n: r?.n })
    console.log(`  ${hit ? 'ok  ' : 'XX  '}${id}!  rejected because ${code}${hit ? '' : `\n        ACTUAL: ${(r?.n || '(no error recorded)').slice(0, 300)}`}`) }
  because('S6.1', 'NoTerminalBurn'); because('S6.3', 'NoPrecedingOpen'); because('S6.4', 'VaultNotEmpty')
  because('S6.5', 'NoTerminalBurn'); because('S6.6', 'NotTheOwner'); because('S6.7', 'ReserveNotDeclared')
  because('S6.8', 'NotTheOwner'); because('S6.9', 'VaultStillHoldsAVault'); because('S6.10', 'VaultNotEmpty')
  because('S9.1', 'custom program error: 0x0'); because('S10.2', 'RateLimited')
  // The seal itself is Core's refusal: ExecuteV1 on a frozen PermanentFreezeExecute.
  because('S6.2', 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d failed')

  const bad = R.filter(r => !r.ok)
  console.log(`\n${R.length - bad.length}/${R.length} test-vault assertions as predicted`)
  process.exit(bad.length ? 1 : 0)
}
main().catch(e => { console.error('FATAL', e?.message || e, '\n', (e?.logs || []).join('\n')); process.exit(2) })
