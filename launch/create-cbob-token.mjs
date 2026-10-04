#!/usr/bin/env node
/**
 * CREATE $CBOB, ONCE (Gary, 2026-10-04).
 *
 * The rulings this script is the whole of:
 *   * name "Central Bank of Bitcoin", ticker CBOB, 6 decimals, classic SPL Token;
 *   * the icon is the bank mark (cbob-site/favicon-512.png), pinned by sha256;
 *   * the FULL fixed supply, 2,100,000,000 CBOB, is minted once into a dedicated
 *     release wallet, then the MINT AUTHORITY IS REVOKED: "it cannot print"
 *     becomes a chain fact anyone can check;
 *   * NO freeze authority, ever;
 *   * the metadata stays MUTABLE and its update authority is RETAINED (`--update-authority`),
 *     so the icon and links can be corrected later.
 *
 * ONE TRANSACTION: create the mint, create the release wallet's account, mint the
 * supply, write the metadata, revoke the mint authority. It lands whole or not at
 * all, so there is never a moment where the supply is partly minted or the mint
 * authority is live with tokens out. Then every fact is READ BACK from the chain.
 *
 *   node launch/create-cbob-token.mjs --cluster local   [--execute]   # a local validator
 *       with mainnet's Token Metadata program cloned in (the devnet faucet
 *       refuses this box), on port 8999
 *   node launch/create-cbob-token.mjs --cluster devnet  [--execute]
 *   node launch/create-cbob-token.mjs --cluster mainnet [--execute] [--upload]
 *
 * Without --execute it only plans and prints. --upload writes the icon and the
 * metadata JSON to R2 (content-hashed keys, immutable), which must exist before a
 * mainnet --execute: the URI is written on chain and a wallet fetches it.
 * Never prints a secret.
 */
import fs from 'fs'
import crypto from 'crypto'
import { createRequire } from 'module'
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID, MINT_SIZE, AuthorityType, createInitializeMint2Instruction, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction, createMintToInstruction, createSetAuthorityInstruction, getMint,
} from '@solana/spl-token'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { createNoopSigner, publicKey as umiPk, none } from '@metaplex-foundation/umi'
import { createMetadataAccountV3, fetchMetadataFromSeeds, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata'
import { toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters'

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d }
const has = k => process.argv.includes(k)
const CLUSTER = arg('--cluster', 'devnet')
const EXECUTE = has('--execute'), UPLOAD = has('--upload')
const RPC = { local: 'http://127.0.0.1:8999', devnet: 'https://api.devnet.solana.com', mainnet: 'https://api.mainnet-beta.solana.com' }[CLUSTER]
if (!RPC) { console.error('--cluster local|devnet|mainnet'); process.exit(2) }

// ── THE RULED VALUES ──
const NAME = 'Central Bank of Bitcoin', SYMBOL = 'CBOB', DECIMALS = 6
const SUPPLY = 2_100_000_000n * 10n ** BigInt(DECIMALS)
const ICON_PATH = '/home/ubuntu/cbob-site/favicon-512.png'
const ICON_SHA256 = '75a6cb3fc08ad2cbd9f8c81f5f20413d9be32e960d3bf0d46a9794a38a87baee'
const EXTERNAL_URL = 'https://centralbankofbitcoin.com'      // verified 200, 2026-10-04
// Retained update authority. Default: Gary's wallet (the guardian). A box key
// would let a box compromise repoint the icon at a scam; his wallet cannot be
// taken from here, and it does not need to sign this creation.
const UPDATE_AUTHORITY = new PublicKey(arg('--update-authority', 'Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb'))
const KEYS = CLUSTER === 'mainnet' ? '/opt/cbob-vaults/bank/keys' : `/opt/cbob-vaults/.cache/${CLUSTER}-cbob`
const RELEASE_KEY = `${KEYS}/cbob-release.json`, MINT_KEY = `${KEYS}/cbob-mint.json`

const die = m => { console.error(`FATAL: ${m}`); process.exit(1) }
const loadOrMake = (p, make) => {
  if (fs.existsSync(p)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))))
  if (!make) die(`${p} does not exist`)
  fs.mkdirSync(KEYS, { recursive: true, mode: 0o700 })
  const k = Keypair.generate(); fs.writeFileSync(p, JSON.stringify([...k.secretKey]), { mode: 0o600 }); return k
}

// ── THE OFF-CHAIN HALF: icon + JSON, content-addressed on our CDN ──
const icon = fs.readFileSync(ICON_PATH)
const iconSha = crypto.createHash('sha256').update(icon).digest('hex')
if (iconSha !== ICON_SHA256) die(`the icon is not the ruled bank mark (sha256 ${iconSha})`)
const ICON_KEY = `cbob/token/icon-${iconSha.slice(0, 16)}.png`
const IMAGE = `https://cdn.gary.club/${ICON_KEY}`
// No em dashes; every claim here is a chain fact once the transaction lands.
const JSON_BODY = Buffer.from(JSON.stringify({
  name: NAME, symbol: SYMBOL,
  description: 'The note of the Central Bank of Bitcoin, a Gary Club institution. A fixed supply of 2,100,000,000 CBOB, with no mint authority and no freeze authority. It cannot print. So it stacks.',
  image: IMAGE, external_url: EXTERNAL_URL,
  properties: { files: [{ uri: IMAGE, type: 'image/png' }], category: 'image' },
}, null, 1))
const jsonSha = crypto.createHash('sha256').update(JSON_BODY).digest('hex')
const JSON_KEY = `cbob/token/cbob-${jsonSha.slice(0, 16)}.json`
const URI = `https://cdn.gary.club/${JSON_KEY}`

async function upload() {
  const require = createRequire('/opt/gary-club/package.json')
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
  const env = Object.fromEntries(fs.readFileSync('/opt/gary-club/.env.local', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
  const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } })
  const Bucket = env.R2_BUCKET_NAME || 'garyclub'
  for (const [Key, Body, ContentType] of [[ICON_KEY, icon, 'image/png'], [JSON_KEY, JSON_BODY, 'application/json']])
    await s3.send(new PutObjectCommand({ Bucket, Key, Body, ContentType, CacheControl: 'public, max-age=31536000, immutable' }))
  console.log(`uploaded ${IMAGE}\nuploaded ${URI}`)
}
/** AFTER upload only (probing first caches the 404). GET, byte-for-byte. */
async function verifyHosted() {
  for (const [u, want] of [[IMAGE, iconSha], [URI, jsonSha]]) {
    const r = await fetch(u)
    const got = crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex')
    if (r.status !== 200 || got !== want) die(`${u}: HTTP ${r.status}, sha256 ${got.slice(0, 16)}, want ${want.slice(0, 16)}`)
    console.log(`  hosted ok  ${u}`)
  }
}

async function main() {
  const conn = new Connection(RPC, 'confirmed')
  const release = loadOrMake(RELEASE_KEY, CLUSTER !== 'mainnet' || EXECUTE)
  const mint = loadOrMake(MINT_KEY, true)
  const ata = getAssociatedTokenAddressSync(mint.publicKey, release.publicKey)
  console.log(`cluster          ${CLUSTER}`)
  console.log(`name / symbol    ${NAME} / ${SYMBOL}, ${DECIMALS} decimals, supply ${SUPPLY / 10n ** BigInt(DECIMALS)} CBOB`)
  console.log(`mint             ${mint.publicKey.toBase58()}`)
  console.log(`release wallet   ${release.publicKey.toBase58()}  (holds the whole supply)`)
  console.log(`update authority ${UPDATE_AUTHORITY.toBase58()}  (retained; metadata mutable)`)
  console.log(`mint authority   revoked in the same transaction; freeze authority: none`)
  console.log(`icon             ${IMAGE}`)
  console.log(`uri              ${URI}`)
  if (UPLOAD) await upload()
  if (!EXECUTE) { console.log('\nPLAN ONLY. Add --execute to create it.'); return }
  if (await conn.getAccountInfo(mint.publicKey)) die(`the mint ${mint.publicKey.toBase58()} already exists; this runs once`)
  await verifyHosted()
  if (CLUSTER !== 'mainnet' && (await conn.getBalance(release.publicKey)) < 0.1 * LAMPORTS_PER_SOL) {
    const sig = await conn.requestAirdrop(release.publicKey, LAMPORTS_PER_SOL)
    await conn.confirmTransaction({ signature: sig, ...(await conn.getLatestBlockhash()) })
  }
  const rent = await conn.getMinimumBalanceForRentExemption(MINT_SIZE)
  const umi = createUmi(RPC).use(mplTokenMetadata())
  const md = createMetadataAccountV3(umi, {
    mint: umiPk(mint.publicKey.toBase58()), mintAuthority: createNoopSigner(umiPk(release.publicKey.toBase58())),
    payer: createNoopSigner(umiPk(release.publicKey.toBase58())), updateAuthority: umiPk(UPDATE_AUTHORITY.toBase58()),
    data: { name: NAME, symbol: SYMBOL, uri: URI, sellerFeeBasisPoints: 0, creators: none(), collection: none(), uses: none() },
    isMutable: true, collectionDetails: none(),
  }).getInstructions().map(toWeb3JsInstruction)
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: release.publicKey, newAccountPubkey: mint.publicKey, space: MINT_SIZE, lamports: rent, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(mint.publicKey, DECIMALS, release.publicKey, null),
    createAssociatedTokenAccountInstruction(release.publicKey, ata, release.publicKey, mint.publicKey),
    createMintToInstruction(mint.publicKey, ata, release.publicKey, SUPPLY),
    ...md,
    createSetAuthorityInstruction(mint.publicKey, release.publicKey, AuthorityType.MintTokens, null),
  )
  const sig = await sendAndConfirmTransaction(conn, tx, [release, mint], { commitment: 'confirmed' })
  console.log(`\nCREATED in one transaction: ${sig}`)

  // ── READ EVERY FACT BACK ──
  const m = await getMint(conn, mint.publicKey, 'confirmed')
  // Read at the commitment the send confirmed at, and give the RPC a moment:
  // the SDK's default read can trail a just-confirmed transaction.
  let meta
  for (let i = 0; i < 20 && !meta; i++) {
    try { meta = await fetchMetadataFromSeeds(umi, { mint: umiPk(mint.publicKey.toBase58()) }, { commitment: 'confirmed' }) }
    catch (e) { if (i === 19) throw e; await new Promise(r => setTimeout(r, 1000)) }
  }
  const bal = BigInt((await conn.getTokenAccountBalance(ata, 'confirmed')).value.amount)
  const facts = [
    ['supply is exactly 2,100,000,000 CBOB', m.supply === SUPPLY],
    ['decimals 6', m.decimals === DECIMALS],
    ['MINT AUTHORITY: none (it cannot print)', m.mintAuthority === null],
    ['FREEZE AUTHORITY: none', m.freezeAuthority === null],
    ['the release wallet holds the whole supply', bal === SUPPLY],
    ['name and symbol', meta.name.replace(/\0/g, '') === NAME && meta.symbol.replace(/\0/g, '') === SYMBOL],
    ['uri', meta.uri.replace(/\0/g, '') === URI],
    ['update authority retained', meta.updateAuthority.toString() === UPDATE_AUTHORITY.toBase58()],
    ['metadata mutable', meta.isMutable === true],
  ]
  for (const [t, ok] of facts) console.log(`  ${ok ? 'ok  ' : 'XX  '}${t}`)
  const record = { cluster: CLUSTER, mint: mint.publicKey.toBase58(), release_wallet: release.publicKey.toBase58(),
    update_authority: UPDATE_AUTHORITY.toBase58(), tx: sig, uri: URI, image: IMAGE, icon_sha256: iconSha,
    supply_base_units: SUPPLY.toString(), decimals: DECIMALS, verified: facts.every(([, ok]) => ok), at: new Date().toISOString() }
  fs.writeFileSync(`/opt/cbob-vaults/launch/cbob-token.${CLUSTER}.json`, JSON.stringify(record, null, 1) + '\n')
  if (!record.verified) die('a fact did not read back as ruled; see above')
  console.log(`\nrecorded launch/cbob-token.${CLUSTER}.json`)
}
main().catch(e => die(e.message))
