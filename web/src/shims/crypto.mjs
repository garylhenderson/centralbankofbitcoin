// The one node `crypto` call the shared modules make: createHash('sha256').
import { sha256 } from '@noble/hashes/sha2'
import { Buffer } from 'buffer'
export function createHash(alg) {
  if (alg !== 'sha256') throw new Error(`createHash(${alg}) is not available in the browser`)
  const parts = []
  const h = {
    update(d) { parts.push(typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d)); return h },
    digest(enc) {
      const n = parts.reduce((a, p) => a + p.length, 0), all = new Uint8Array(n)
      let o = 0; for (const p of parts) { all.set(p, o); o += p.length }
      const out = Buffer.from(sha256(all))
      return enc ? out.toString(enc) : out
    },
  }
  return h
}
export default { createHash }
