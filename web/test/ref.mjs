/**
 * THE REFERENCE BUILDERS, taken from the suite's own source.
 *
 * The page's builders must equal the instruction builders the suite and the
 * Test Vault simulation actually SEND (tests/3prog.test.ts, sim/test-vault.ts).
 * Copying them here would test a copy, so this file EXTRACTS each builder's
 * source text from those files (read only), strips the TypeScript with esbuild,
 * and evaluates it with the suite's own helper definitions in scope. If a suite
 * builder changes, the comparison runs against the change.
 */
import fs from 'fs'
import { createRequire } from 'module'
import { createHash } from 'crypto'
import * as web3 from '@solana/web3.js'
import * as spl from '@solana/spl-token'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { createNoopSigner, publicKey as umiPk } from '@metaplex-foundation/umi'
import { toWeb3JsPublicKey, fromWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters'
import { mplCore, execute, findAssetSignerPda } from '@metaplex-foundation/mpl-core'

const require = createRequire(import.meta.url)
const esbuild = require('/home/ubuntu/luna-remotion/node_modules/esbuild')
export const ROOT = '/opt/cbob-vaults'
export const SUITE = fs.readFileSync(`${ROOT}/tests/3prog.test.ts`, 'utf8')
export const SIM = fs.readFileSync(`${ROOT}/sim/test-vault.ts`, 'utf8')

/** From `start`, the shortest balanced expression ending at depth 0 before a newline. */
function balanced(src, start) {
  let depth = 0, i = start, inStr = null, seenOpen = false
  for (; i < src.length; i++) {
    const c = src[i]
    if (inStr) { if (c === '\\') { i++; continue } if (c === inStr) inStr = null; continue }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if ('([{'.includes(c)) { depth++; seenOpen = true }
    else if (')]}'.includes(c)) { depth--; if (depth < 0) return i }
    else if (c === '\n' && depth === 0 && seenOpen) {
      // a chained call on the next line (`\n    .getInstructions()`) continues the expression
      if (/^\s*\./.test(src.slice(i + 1, i + 200))) continue
      return i
    }
  }
  return i
}

/** `const NAME=...` (or `const NAME = ...`) as JS source. Throws if absent or ambiguous. */
export function extractConst(src, name) {
  const re = new RegExp(`\\bconst ${name}\\s*=`, 'g')
  const hits = [...src.matchAll(re)]
  if (hits.length !== 1) throw new Error(`expected exactly one \`const ${name}=\`, found ${hits.length}`)
  const s = hits[0].index
  return src.slice(s, balanced(src, s))
}

/** The `new TransactionInstruction(...)` that contains `marker` (the first one after it starts). */
export function extractIxAround(src, marker) {
  const at = src.indexOf(marker)
  if (at < 0 || src.indexOf(marker, at + 1) >= 0) throw new Error(`marker must occur exactly once: ${marker}`)
  const s = src.lastIndexOf('new TransactionInstruction(', at)
  let depth = 0, i = s
  for (; i < src.length; i++) { const c = src[i]; if (c === '(') depth++; else if (c === ')') { depth--; if (depth === 0) break } }
  return src.slice(s, i + 1)
}

export const ts2js = code => esbuild.transformSync(code, { loader: 'ts' }).code

/** Evaluate JS with `scope` as its free variables; returns `expr`'s value. */
export function evalWith(code, scope, expr) {
  const f = new Function(...Object.keys(scope), `${code}\nreturn (${expr})`)
  return f(...Object.values(scope))
}

/** The suite's shared helpers, verbatim semantics (sim/test-vault.ts header). */
export const d = n => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8)
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
const i64 = n => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b }
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
const u8b = n => Buffer.from([n])
const str = v => Buffer.concat([u32(Buffer.byteLength(v)), Buffer.from(v)])

/** The scope both files' builders close over, wired to `ids` (the page's own
 *  derivation, which ids.test.mjs checks against the suite's). */
export function scopeFor(ids, extra = {}) {
  const W = web3.PublicKey
  const umi = createUmi('http://127.0.0.1:1').use(mplCore())
  const crankKeys = assets => assets && assets.length ? [{ pubkey: new W('SysvarS1otHashes111111111111111111111111111'), isSigner: false, isWritable: false },
    ...assets.map(a => ({ pubkey: ids.vaultRecord(a), isSigner: false, isWritable: true }))] : []
  return {
    W, PublicKey: W, Buffer, TransactionInstruction: web3.TransactionInstruction, SystemProgram: web3.SystemProgram,
    SYSVAR_INSTRUCTIONS_PUBKEY: web3.SYSVAR_INSTRUCTIONS_PUBKEY, LAMPORTS_PER_SOL: web3.LAMPORTS_PER_SOL,
    TOKEN_PROGRAM_ID: spl.TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID: spl.TOKEN_2022_PROGRAM_ID,
    getAssociatedTokenAddressSync: spl.getAssociatedTokenAddressSync, createTransferInstruction: spl.createTransferInstruction,
    createCloseAccountInstruction: spl.createCloseAccountInstruction,
    SEAL_PROG: ids.SEAL_PROG, MINT_PROG: ids.MINT_PROG, BURN_PROG: ids.BURN_PROG, GOV_PROG: ids.GOV_PROG, CORE: ids.CORE,
    SEAL_CFG: ids.SEAL_CFG, SEAL: ids.SEAL, MINT_CFG: ids.MINT_CFG, MINT_AUTH: ids.MINT_AUTH, REVENUE: ids.REVENUE,
    SWEEP: ids.SWEEP, RESCUE: ids.RESCUE, BURN_CFG: ids.BURN_CFG, GOV_CFG: ids.GOV_CFG, GOV_PDA: ids.GOV_PDA, COLL: ids.COLL,
    vrec: a => ids.vaultRecord(a), d, u32, u16, i64, u64, u8b, str, NONE: Buffer.from([0]), SOME: b => Buffer.concat([Buffer.from([1]), b]),
    caps5: c => Buffer.concat(c.map(u32)), crankKeys,
    // tests/3prog.test.ts: attrs(list), proofBuf(proof)
    attrs: list => Buffer.concat([u32(list.length), ...list.flatMap(([k, v]) => [str(k), str(v)])]),
    proofBuf: pr => Buffer.concat([u32(pr.length), ...pr]), SLOT_HASHES: new W('SysvarS1otHashes111111111111111111111111111'),
    umi, execute, createNoopSigner, pk: umiPk, toWeb3JsPublicKey, fromWeb3JsInstruction, findAssetSignerPda,
    coll: { publicKey: umiPk(ids.COLL.toBase58()) },
    // sim/test-vault.ts: `ata(owner, mint)`
    ata: (o, m) => spl.getAssociatedTokenAddressSync(m, o, true),
    // a signer object that carries only an address (the bytes do not depend on keys)
    U: k => createNoopSigner(umiPk(k.publicKey.toBase58())),
    ...extra,
  }
}

/** Compare two instructions field by field; returns [] or the differences. */
export function diffIx(a, b) {
  const out = []
  if (!a.programId.equals(b.programId)) out.push(`programId ${a.programId.toBase58()} != ${b.programId.toBase58()}`)
  if (!Buffer.from(a.data).equals(Buffer.from(b.data))) out.push(`data ${Buffer.from(a.data).toString('hex')} != ${Buffer.from(b.data).toString('hex')}`)
  if (a.keys.length !== b.keys.length) out.push(`${a.keys.length} accounts != ${b.keys.length}`)
  for (let i = 0; i < Math.min(a.keys.length, b.keys.length); i++) {
    const x = a.keys[i], y = b.keys[i]
    if (!x.pubkey.equals(y.pubkey) || x.isSigner !== y.isSigner || x.isWritable !== y.isWritable)
      out.push(`account ${i}: ${x.pubkey.toBase58()} s${+x.isSigner} w${+x.isWritable} != ${y.pubkey.toBase58()} s${+y.isSigner} w${+y.isWritable}`)
  }
  return out
}

/** Serialized legacy MESSAGE of `ixs` (fixed blockhash), for whole-transaction equality. */
export function messageBytes(ixs, feePayer) {
  const t = new web3.Transaction().add(...ixs)
  t.feePayer = new web3.PublicKey(feePayer); t.recentBlockhash = '11111111111111111111111111111111'
  return Buffer.from(t.serializeMessage())
}
export function wireSize(ixs, feePayer) {
  const t = new web3.Transaction().add(...ixs)
  t.feePayer = new web3.PublicKey(feePayer); t.recentBlockhash = '11111111111111111111111111111111'
  return t.serialize({ requireAllSignatures: false, verifySignatures: false }).length
}

/** A tiny assertion recorder with a printed summary. */
export function harness(title) {
  const R = []
  const t = (name, ok, detail = '') => { R.push(!!ok); console.log(`  ${ok ? 'ok  ' : 'XX  '}${name}${!ok && detail ? `\n        ${detail}` : ''}`) }
  const eq = (name, got, want) => { const g = JSON.stringify(got, (k, v) => typeof v === 'bigint' ? v.toString() : v), w = JSON.stringify(want, (k, v) => typeof v === 'bigint' ? v.toString() : v)
    t(name, g === w, `got  ${g}\n        want ${w}`) }
  const done = () => { const ok = R.filter(Boolean).length; console.log(`${title}: ${ok}/${R.length} passed`); return { ok, total: R.length } }
  return { t, eq, done }
}
