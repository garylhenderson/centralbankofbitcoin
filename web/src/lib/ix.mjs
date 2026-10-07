/**
 * EVERY INSTRUCTION THE PAGES BUILD, hand-built from bytes.
 *
 * Each builder mirrors one builder in tests/3prog.test.ts or sim/test-vault.ts
 * (named beside it) and web/test/ix.test.mjs extracts THAT builder's source from
 * the suite and requires byte-for-byte equality: data, every account meta, its
 * order and its signer/writable flags. Core's ExecuteV1 is compared against
 * mpl-core's own `execute`, the SPL instructions against @solana/spl-token.
 */
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import { Buffer, disc, u8, u16, u32, u64, i64, SOME, borshStr } from './enc.mjs'
import { TOKEN_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM, SYSVAR_INSTRUCTIONS, SLOT_HASHES } from './ids.mjs'

const K = (pubkey, isSigner, isWritable) => ({ pubkey: new PublicKey(pubkey), isSigner, isWritable })
const R = k => K(k, false, false), W = k => K(k, false, true)

// ── the four initializes (tests/3prog.test.ts ixSealInit, ixMintInit, ixBurnInit, ixGovInit) ──

export const sealInit = (ids, authority, collection, mints) => new TransactionInstruction({ programId: ids.SEAL_PROG,
  data: Buffer.concat([disc('initialize'), new PublicKey(collection).toBuffer(), u32(mints.length), ...mints.map(m => new PublicKey(m).toBuffer())]),
  keys: [W(ids.SEAL_CFG), K(authority, true, true), R(SYSTEM_PROGRAM), ...mints.map(m => R(m))] })

/** `v` carries every MINT initialize argument, in the program's order. */
export const mintInit = (ids, authority, v) => new TransactionInstruction({ programId: ids.MINT_PROG,
  data: Buffer.concat([disc('initialize'), new PublicKey(v.bankTreasury).toBuffer(), new PublicKey(v.swapOperator).toBuffer(),
    SOME(new PublicKey(v.guardian).toBuffer()), u64(v.solReserveLamports), u64(v.maxSupply), u64(v.maxSweepLamports),
    i64(v.sweepCooldownSecs), Buffer.concat(v.levelCaps.map(u32)), new PublicKey(v.paymentMint).toBuffer(),
    new PublicKey(v.pobCollection).toBuffer(), Buffer.from(v.pobRoot), i64(v.charterOpensAt), i64(v.charterClosesAt),
    i64(v.monthlySecs), i64(v.noticeSecs), u64(v.sweepFloorLamports), i64(v.cooldownCeilingSecs), u64(v.reserveCeilingLamports),
    u8(v.maxBoostWeight), u16(v.maxBoostEpochs)]),
  keys: [W(ids.MINT_CFG), K(authority, true, true), W(v.collection), R(ids.MINT_AUTH), R(ids.CORE), R(SYSTEM_PROGRAM),
    R(ids.SEAL_CFG), R(v.cbobMint)] })

export const burnInit = (ids, authority, collection, redeemWindowSecs) => new TransactionInstruction({ programId: ids.BURN_PROG,
  data: Buffer.concat([disc('initialize'), new PublicKey(collection).toBuffer(), i64(redeemWindowSecs)]),
  keys: [W(ids.BURN_CFG), K(authority, true, true), R(SYSTEM_PROGRAM), R(ids.SEAL_CFG)] })

export const govInit = (ids, authority, collection, quorumBps, thresholdBps, minVotingSecs) => new TransactionInstruction({ programId: ids.GOV_PROG,
  data: Buffer.concat([disc('initialize'), new PublicKey(collection).toBuffer(), u16(quorumBps), u16(thresholdBps), i64(minVotingSecs)]),
  keys: [W(ids.GOV_CFG), K(authority, true, true), R(SYSTEM_PROGRAM), R(ids.MINT_CFG)] })

// ── the redemption (sim/test-vault.ts S8: ixOpen, ixPoolClaim, the helper through Core, ixBurn) ──

/** SEAL open_for_redemption. Account 0 (asset) and 2 (owner) are what BURN matches. */
export const openForRedemption = (ids, asset, owner, payer = owner) => new TransactionInstruction({ programId: ids.SEAL_PROG,
  data: Buffer.from(disc('open_for_redemption')),
  keys: [W(asset), W(ids.COLL), K(owner, true, false), K(payer, true, true), R(ids.SEAL_CFG), R(ids.SEAL), R(ids.CORE),
    R(SYSVAR_INSTRUCTIONS), R(SYSTEM_PROGRAM)] })

/** BURN burn_vault. `declared` are the accounts BURN inspects (every reserve
 *  mint's ATA under both token programs, at minimum). */
export const burnVault = (ids, asset, owner, depositAddress, pool, declared, payer = owner) => new TransactionInstruction({ programId: ids.BURN_PROG,
  data: Buffer.concat([disc('burn_vault'), Buffer.from([declared.length])]),
  keys: [W(asset), W(ids.COLL), K(owner, true, false), W(depositAddress), K(payer, true, true), W(ids.BURN_CFG), R(ids.SEAL_CFG),
    R(SYSVAR_INSTRUCTIONS), R(ids.CORE), R(SYSTEM_PROGRAM), R(ids.MINT_PROG), W(ids.MINT_CFG), W(ids.vaultRecord(asset)), R(pool),
    ...declared.map(p => W(p))] })

/** MINT claim with no crank: pairs of (vault record, the vault's own cbBTC ATA). */
export const poolClaim = (ids, pool, pairs) => new TransactionInstruction({ programId: ids.MINT_PROG,
  data: Buffer.concat([disc('claim'), u8(0)]),
  keys: [W(ids.MINT_CFG), W(pool), R(TOKEN_PROGRAM), ...pairs.flatMap(p => [W(ids.vaultRecord(p.asset)), W(p.dest)])] })

/** The sweep helper's own instruction (programs/cbob-vault-sweep): asset signer,
 *  destination wallet, Token, System, then (source, destination) pairs. */
export const sweepHelper = (ids, depositAddress, dest, pairs) => new TransactionInstruction({ programId: ids.SWEEP,
  data: Buffer.from([0]),
  keys: [K(depositAddress, true, true), W(dest), R(TOKEN_PROGRAM), R(SYSTEM_PROGRAM), ...pairs.flatMap(([a, b]) => [W(a), W(b)])] })

/** Metaplex Core ExecuteV1 (discriminator 31): Core signs as the asset-signer
 *  PDA and invokes `inner`. Mirrors mpl-core's `execute` helper: the inner keys
 *  follow as remaining accounts, with the asset signer's signer flag cleared. */
export const IX_CORE_EXECUTE_V1 = 31
export function coreExecute(ids, { asset, collection, assetSigner, payer, authority, inner }) {
  const signer = new PublicKey(assetSigner)
  return new TransactionInstruction({ programId: ids.CORE,
    data: Buffer.concat([Buffer.from([IX_CORE_EXECUTE_V1]), u32(inner.data.length), Buffer.from(inner.data)]),
    keys: [W(asset), collection ? W(collection) : R(ids.CORE), R(signer), K(payer, true, true),
      authority ? K(authority, true, false) : R(ids.CORE), R(SYSTEM_PROGRAM), R(inner.programId),
      ...inner.keys.map(k => k.pubkey.equals(signer) ? { pubkey: k.pubkey, isSigner: false, isWritable: k.isWritable } : { ...k })] })
}

// ── vault upkeep (tests/3prog.test.ts ixActivate, ixRescue, ixDistribute) ──

export const activate = (ids, asset, vaultToken, pool) => new TransactionInstruction({ programId: ids.MINT_PROG,
  data: Buffer.from(disc('activate')),
  keys: [W(ids.MINT_CFG), W(ids.vaultRecord(asset)), R(asset), R(vaultToken), R(pool)] })

/** ROUND 35: move a vault out of a vault wallet (nested, or in its own). */
export const rescueNested = (ids, vault, host, to, payer) => new TransactionInstruction({ programId: ids.MINT_PROG,
  data: Buffer.from(disc('rescue_nested')),
  keys: [R(ids.MINT_CFG), W(vault), R(ids.COLL), R(host), R(to), K(payer, true, true), R(ids.RESCUE), R(ids.CORE), R(SYSTEM_PROGRAM)] })

/** distribute: burn exactly 100 $GARY (burner signs), or the free monthly run. */
export const distribute = (ids, pool, burner = null, garyMint = null) => new TransactionInstruction({ programId: ids.MINT_PROG,
  data: Buffer.concat([disc('distribute'), u8(burner ? 1 : 0)]),
  keys: [W(ids.MINT_CFG), R(pool), ...(burner ? [K(burner, true, false), W(ataOf(burner, garyMint)), W(garyMint), R(TOKEN_PROGRAM)] : [])] })

// ── SPL and System (compared against @solana/spl-token) ──

const ataOf = (owner, mint) => PublicKey.findProgramAddressSync(
  [new PublicKey(owner).toBuffer(), TOKEN_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()], ATA_PROGRAM)[0]

/** CreateIdempotent (ATA program instruction 1). */
export const createAtaIdempotent = (payer, ataAddr, owner, mint, tokenProgram = TOKEN_PROGRAM) => new TransactionInstruction({ programId: ATA_PROGRAM,
  data: Buffer.from([1]),
  keys: [K(payer, true, true), W(ataAddr), R(owner), R(mint), R(SYSTEM_PROGRAM), R(tokenProgram)] })

/** SPL Token Transfer (3). Used only inside a Core Execute, for an account the
 *  helper cannot close (round 35 C5). */
export const tokenTransfer = (src, dst, authority, amount) => new TransactionInstruction({ programId: TOKEN_PROGRAM,
  data: Buffer.concat([Buffer.from([3]), u64(amount)]),
  keys: [W(src), W(dst), K(authority, true, false)] })

export const systemTransfer = (from, to, lamports) => SystemProgram.transfer({
  fromPubkey: new PublicKey(from), toPubkey: new PublicKey(to), lamports })

/** A program probe: an 8-byte discriminator no CBOB program defines. A real
 *  Anchor program answers InstructionFallbackNotFound (custom error 101); the
 *  launch placeholder answers Custom(0) and logs "CBOB placeholder". */
export const PROBE_NAME = 'cbob_web_probe_not_an_instruction'
export const anchorProbe = programId => new TransactionInstruction({ programId: new PublicKey(programId), data: Buffer.from(disc(PROBE_NAME)), keys: [] })
/** The sweep helper refuses any data except [0] with InvalidInstructionData. */
export const sweepProbe = programId => new TransactionInstruction({ programId: new PublicKey(programId), data: Buffer.from([1]), keys: [] })

// ── the vault collection (ceremony step 0) ──

/** Metaplex Core CreateCollectionV2 (discriminator 21) exactly as mpl-core's
 *  `createCollection` helper sends it with no plugins (tests/3prog.test.ts and
 *  sim/test-vault.ts create the collection that way): plugins Some([]) and
 *  external adapters Some([]), update authority a plain (non-signing) address. */
export const IX_CORE_CREATE_COLLECTION_V2 = 21
export const coreCreateCollection = (ids, collection, updateAuthority, payer, name, uri) => new TransactionInstruction({ programId: ids.CORE,
  data: Buffer.concat([Buffer.from([IX_CORE_CREATE_COLLECTION_V2]), borshStr(name), borshStr(uri), Buffer.from([1]), u32(0), Buffer.from([1]), u32(0)]),
  keys: [K(collection, true, true), R(updateAuthority), K(payer, true, true), R(SYSTEM_PROGRAM)] })

// ── getting a vault (tests/3prog.test.ts ixClaim, ixMint; sim/test-vault.ts ixClaim, ixMint) ──

const attrList = list => Buffer.concat([u32(list.length), ...list.flatMap(([k, v]) => [borshStr(k), borshStr(v)])])

/** claim_charter_vault, sent with NO crank. `extra` are the Proof of Burn's
 *  pass-through accounts (pob_extra); this page always sends none. */
export const claimCharterVault = (ids, { asset, owner, payer = owner, pob, pobCollection, pool, proof, name, uri, attributes = [], extra = [] }) =>
  new TransactionInstruction({ programId: ids.MINT_PROG,
    data: Buffer.concat([disc('claim_charter_vault'), borshStr(name), borshStr(uri), attrList(attributes),
      u32(proof.length), ...proof.map(p => Buffer.from(p)), u8(extra.length)]),
    keys: [W(ids.MINT_CFG), W(ids.vaultRecord(asset)), K(asset, true, true), W(ids.COLL), K(owner, true, false), K(payer, true, true),
      W(pob), W(pobCollection), R(ids.SEAL_CFG), R(ids.MINT_AUTH), R(ids.CORE), R(SYSTEM_PROGRAM), R(pool),
      ...extra.map(k => R(k))] })

/** mint_vault in an open round, sent with NO crank; `maxPrice` guards the price. */
export const mintVault = (ids, { asset, owner, payer = owner, payerToken, paymentMint, revenueToken, pool, maxPrice, name, uri, attributes = [] }) =>
  new TransactionInstruction({ programId: ids.MINT_PROG,
    data: Buffer.concat([disc('mint_vault'), borshStr(name), borshStr(uri), u64(maxPrice), attrList(attributes)]),
    keys: [W(ids.MINT_CFG), W(ids.vaultRecord(asset)), K(asset, true, true), W(ids.COLL), K(owner, true, false), K(payer, true, true),
      W(payerToken), R(paymentMint), W(revenueToken), R(TOKEN_PROGRAM), R(ids.SEAL_CFG), R(ids.MINT_AUTH), R(ids.CORE),
      R(SYSTEM_PROGRAM), R(pool)] })

// ── the level draw (tests/3prog.test.ts ixCapture, ixReveal, ixReschedule) ──

export const captureEntropy = (ids, asset) => new TransactionInstruction({ programId: ids.MINT_PROG, data: Buffer.from(disc('capture_entropy')),
  keys: [W(ids.vaultRecord(asset)), R(SLOT_HASHES)] })
/** `attributes` = the list the vault was minted with (checked against its stored hash). */
export const revealLevel = (ids, asset, attributes, payer) => new TransactionInstruction({ programId: ids.MINT_PROG,
  data: Buffer.concat([disc('reveal_level'), attrList(attributes)]),
  keys: [W(ids.MINT_CFG), W(ids.vaultRecord(asset)), W(asset), W(ids.COLL), K(payer, true, true), R(ids.MINT_AUTH), R(SLOT_HASHES),
    R(ids.CORE), R(SYSTEM_PROGRAM)] })
export const rescheduleReveal = (ids, asset) => new TransactionInstruction({ programId: ids.MINT_PROG, data: Buffer.from(disc('reschedule_reveal')),
  keys: [W(ids.vaultRecord(asset))] })
