/**
 * THE PROOF OF BURN SET, AS A MERKLE TREE OVER ASSET ADDRESSES.
 *
 * ONE implementation, imported by the on-chain suite (which has the PROGRAM verify
 * a proof built here) and by the mainnet probe (which rebuilds the committed root
 * from mainnet). Two implementations of one hash scheme is this repository's most
 * repeated defect; the program accepting a proof this file built is the only check
 * that can fail if they drift.
 *
 * Must match MINT's `merkle_leaf` / `merkle_root_from` byte for byte:
 *   leaf = sha256(0x00 || asset_pubkey)
 *   node = sha256(0x01 || min(a,b) || max(a,b))      (sorted, so no direction bits)
 *   an odd node at the end of a layer is PROMOTED unchanged (its proof gains nothing)
 */
import { createHash } from 'crypto'

const H = (...b) => createHash('sha256').update(Buffer.concat(b)).digest()
export const leafOf = (pubkeyBytes) => H(Buffer.from([0x00]), Buffer.from(pubkeyBytes))
const nodeOf = (a, b) => Buffer.compare(a, b) <= 0
  ? H(Buffer.from([0x01]), a, b) : H(Buffer.from([0x01]), b, a)

/** layers[0] = leaves ... layers[last] = [root] */
export function layersOf(pubkeys) {
  if (!pubkeys.length) throw new Error('empty set')
  const layers = [pubkeys.map(leafOf)]
  while (layers[layers.length - 1].length > 1) {
    const cur = layers[layers.length - 1], next = []
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? nodeOf(cur[i], cur[i + 1]) : cur[i])
    layers.push(next)
  }
  return layers
}
export const rootOf = (pubkeys) => { const l = layersOf(pubkeys); return l[l.length - 1][0] }
export function proofOf(pubkeys, index) {
  const layers = layersOf(pubkeys), proof = []
  let i = index
  for (let d = 0; d < layers.length - 1; d++) {
    const sib = i ^ 1
    if (sib < layers[d].length) proof.push(layers[d][sib])
    i >>= 1
  }
  return proof
}
export function verify(pubkeyBytes, proof, root) {
  let n = leafOf(pubkeyBytes)
  for (const s of proof) n = nodeOf(n, s)
  return n.equals(root)
}

if (process.argv[2] === '--selftest') {
  let ok = 0, n = 0
  const t = (name, c) => { n++; if (c) ok++; console.log(`  ${c ? 'ok  ' : 'XX  '}${name}`) }
  for (const size of [1, 2, 3, 7, 8, 240]) {
    const keys = Array.from({ length: size }, (_, i) => H(Buffer.from(`k${size}-${i}`)))
    const root = rootOf(keys)
    t(`every leaf of a ${size}-set proves against its root`, keys.every((k, i) => verify(k, proofOf(keys, i), root)))
    t(`a key NOT in the ${size}-set does not prove with any member's proof`,
      keys.every((_, i) => !verify(H(Buffer.from('outsider')), proofOf(keys, i), root)))
  }
  const keys = Array.from({ length: 240 }, (_, i) => H(Buffer.from(`x${i}`)))
  t('a 240-set proof is at most 8 elements (MAX_POB_PROOF is 16)', Math.max(...keys.map((_, i) => proofOf(keys, i).length)) <= 8)
  // A leaf may never be replayed as a node: the tags differ.
  t('a leaf hash is never equal to the node hash of the same bytes',
    !leafOf(keys[0]).equals(H(Buffer.from([0x01]), keys[0])))
  console.log(`${ok}/${n} pob-merkle assertions`)
  process.exit(ok === n ? 0 : 1)
}
