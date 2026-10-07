/**
 * Byte encoders and Anchor discriminators. Pure; runs in node and the browser
 * (esbuild resolves `buffer` to the npm package there, node to its builtin).
 */
import { Buffer } from 'buffer'
import { sha256 } from '@noble/hashes/sha2'

const te = new TextEncoder()
export const sha256Bytes = b => Buffer.from(sha256(typeof b === 'string' ? te.encode(b) : b))
export const sha256Hex = b => sha256Bytes(b).toString('hex')

/** Anchor instruction discriminator: sha256("global:<name>")[0..8]. */
export const disc = n => sha256Bytes(`global:${n}`).subarray(0, 8)
/** Anchor account discriminator: sha256("account:<Struct>")[0..8]. */
export const acctDisc = n => sha256Bytes(`account:${n}`).subarray(0, 8)

export const u8 = n => Buffer.from([n])
export const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
export const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
export const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
export const i64 = n => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b }
export const borshStr = s => Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)])
export const NONE = Buffer.from([0])
export const SOME = b => Buffer.concat([Buffer.from([1]), b])
export { Buffer }
