/** THE COMMITTED DECK — shuffle, Merkle root, proofs.
 *
 * Gary's ruling 2026-08-23: a vault's level is assigned AT MINT, at random,
 * respecting the per-level quantity, with NO WAY TO GAME IT.
 *
 * The on-chain half (`programs/cbob-vault-mint`) enforces two things: the caller
 * cannot write its own level (reserved attribute), and no level may exceed its
 * census cap. Neither stops the BANK dealing itself the good cards. That is what
 * this file is for: the deck is shuffled here, off-chain, from a seed NEITHER
 * SIDE can pre-compute, committed on-chain as a Merkle root before minting opens,
 * and every mint must then present a proof that the deck really does put that
 * level at that index.
 *
 * ⚠️ THE SEED IS THE WHOLE ARGUMENT AND IT HAS TWO HALVES ON PURPOSE.
 *
 *     seed = sha256( bank_salt || blockhash(slot X) )
 *
 * The Bank publishes `sha256(bank_salt)` and names slot X BEFORE minting opens.
 * It cannot know a future blockhash; nobody else knows the salt. At close the
 * Bank reveals the salt and anyone recomputes the entire shuffle and checks every
 * vault's on-chain level against it. A Bank that dealt off-deck cannot produce a
 * proof at mint time, and a Bank that shuffled from a salt it chose after seeing
 * the blockhash cannot produce a salt whose hash matches what it published.
 *
 * ⚠️ THIS FILE AND THE RUST MUST AGREE BYTE FOR BYTE, and that is the one real
 * hazard here — two implementations of one hash scheme is this repository's most
 * repeated defect wearing a new hat. They are NOT proven to agree by reading
 * them. They are proven by the on-chain suite building a proof HERE and having
 * the PROGRAM verify it, which is the only check that can fail if they drift.
 */
import { createHash } from 'crypto'

const sha = (...bufs) => createHash('sha256').update(Buffer.concat(bufs)).digest()
const LEAF_TAG = Buffer.from([0x00])
const NODE_TAG = Buffer.from([0x01])
export const LEVELS = ['I', 'II', 'III', 'IV', 'V']

const u32le = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }

/** Leaf and node are domain-separated so a 64-byte leaf can never be replayed as
 *  an internal node. Pairs are SORTED, so a proof carries no direction bits and
 *  cannot be re-ordered into a different root. Both choices are mirrored exactly
 *  in `deck_leaf` / `deck_root_from`. */
export const leaf = (index, level) => sha(LEAF_TAG, u32le(index), Buffer.from([level]))
export const node = (a, b) => Buffer.compare(a, b) <= 0 ? sha(NODE_TAG, a, b) : sha(NODE_TAG, b, a)

/** A counter-mode PRNG over sha256. Deterministic, and it never consumes a
 *  partial hash: a shuffle that depends on how many bytes an earlier draw
 *  happened to use is a shuffle nobody can reproduce from the seed alone. */
function* stream(seed) {
  for (let ctr = 0; ; ctr++) {
    const h = sha(seed, u32le(ctr))
    for (let i = 0; i + 4 <= h.length; i += 4) yield h.readUInt32LE(i)
  }
}
/** Rejection-sampled Fisher-Yates. ⚠️ `rand % n` is BIASED toward low indices
 *  and the bias is largest exactly where the deck is smallest, which is the
 *  Level V end — the part anyone would check. Rejection sampling costs one extra
 *  draw occasionally and removes it entirely. */
function shuffle(arr, seed) {
  const g = stream(seed)
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const n = i + 1
    const limit = Math.floor(0x100000000 / n) * n
    let r
    do { r = g.next().value } while (r >= limit)
    const j = r % n
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** The deck: `census[k]` cards of level k+1, shuffled. Index i is the level the
 *  i-th successful mint must present. */
export function buildDeck(census, seed) {
  if (!Array.isArray(census) || census.length !== 5) throw new Error('census must be five numbers, I..V')
  if (census.some(c => !Number.isInteger(c) || c < 0)) throw new Error('census entries must be non-negative integers')
  const flat = []
  census.forEach((count, k) => { for (let i = 0; i < count; i++) flat.push(k + 1) })
  if (!flat.length) throw new Error('an empty deck cannot be committed')
  return shuffle(flat, seed)
}

/** Build every tree level. An odd node is PROMOTED unpaired rather than being
 *  hashed with itself — self-pairing lets a proof for a duplicated leaf validate
 *  at the wrong index. */
function layers(deck) {
  let level = deck.map((lv, i) => leaf(i, lv))
  const all = [level]
  while (level.length > 1) {
    const next = []
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? node(level[i], level[i + 1]) : level[i])
    }
    all.push(next); level = next
  }
  return all
}

export function deckRoot(deck) { const l = layers(deck); return l[l.length - 1][0] }

export function deckProof(deck, index) {
  if (!Number.isInteger(index) || index < 0 || index >= deck.length) throw new Error(`index ${index} is outside a deck of ${deck.length}`)
  const l = layers(deck)
  const proof = []
  let i = index
  for (let d = 0; d < l.length - 1; d++) {
    const sib = i % 2 === 0 ? i + 1 : i - 1
    if (sib < l[d].length) proof.push(l[d][sib])   // no sibling = this node was promoted
    i = Math.floor(i / 2)
  }
  return proof
}

/** Verify off-chain exactly as the program does, so a deck can be checked
 *  without a validator. */
export function verify(root, index, level, proof) {
  let n = leaf(index, level)
  for (const s of proof) n = node(n, s)
  return Buffer.compare(n, root) === 0
}

export const seedFrom = (bankSalt, blockhash) => sha(Buffer.from(bankSalt), Buffer.from(blockhash))

if (process.argv.includes('--selftest')) {
  const R = []
  const t = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    R.push(ok); console.log(`  ${ok ? 'ok  ' : 'XX  '}${name}${ok ? '' : `  [want ${JSON.stringify(want)}, got ${JSON.stringify(got)}]`}`)
  }
  const CENSUS = [108, 60, 36, 24, 12]
  const seed = seedFrom('salt-A', 'blockhash-A')
  const deck = buildDeck(CENSUS, seed)

  t('the deck is exactly the census, no more and no fewer', deck.length, 240)
  t('...and it holds exactly the census of each level',
    [1,2,3,4,5].map(l => deck.filter(x => x === l).length), CENSUS)
  t('the same seed gives the same deck', buildDeck(CENSUS, seed), deck)
  t('a DIFFERENT seed gives a different deck',
    JSON.stringify(buildDeck(CENSUS, seedFrom('salt-B', 'blockhash-A'))) !== JSON.stringify(deck), true)
  t('...and so does the same salt against a different blockhash',
    JSON.stringify(buildDeck(CENSUS, seedFrom('salt-A', 'blockhash-B'))) !== JSON.stringify(deck), true)

  const root = deckRoot(deck)
  t('every index proves against the root', deck.every((lv, i) => verify(root, i, lv, deckProof(deck, i))), true)
  // BOTH DIRECTIONS. A verifier that only ever says yes is not a verifier.
  t('a WRONG LEVEL at a real index does not prove',
    verify(root, 7, deck[7] === 5 ? 1 : 5, deckProof(deck, 7)), false)
  t('a real proof replayed at ANOTHER index does not prove',
    verify(root, 8, deck[7], deckProof(deck, 7)), false)
  t('a TAMPERED proof node does not prove', (() => {
    const p = deckProof(deck, 3); if (!p.length) return false
    const q = p.slice(); q[0] = Buffer.from(q[0]); q[0][0] ^= 0xff
    return verify(root, 3, deck[3], q)
  })(), false)
  t('a TRUNCATED proof does not prove', verify(root, 3, deck[3], deckProof(deck, 3).slice(0, -1)), false)
  t('an empty proof does not prove a 240-deck', verify(root, 3, deck[3], []), false)
  t('a proof for an odd-sized deck still verifies at every index', (() => {
    const d = buildDeck([2, 1, 1, 1, 1], seed)   // 6, and 3 at the second layer
    const r = deckRoot(d)
    return d.every((lv, i) => verify(r, i, lv, deckProof(d, i)))
  })(), true)
  t('a one-card deck has an empty proof and still verifies', (() => {
    const d = buildDeck([1, 0, 0, 0, 0], seed)
    return deckProof(d, 0).length === 0 && verify(deckRoot(d), 0, d[0], [])
  })(), true)
  t('the 2,100 census builds and proves', (() => {
    const d = buildDeck([945, 525, 315, 210, 105], seed)
    const r = deckRoot(d)
    return d.length === 2100 && [0, 1, 1049, 2099].every(i => verify(r, i, d[i], deckProof(d, i)))
  })(), true)
  t('...and its proof fits the on-chain MAX_DECK_PROOF of 24',
    deckProof(buildDeck([945, 525, 315, 210, 105], seed), 2099).length <= 24, true)
  t('an empty deck is refused', (() => { try { buildDeck([0,0,0,0,0], seed); return false } catch { return true } })(), true)
  t('an index past the deck is refused', (() => { try { deckProof(deck, 240); return false } catch { return true } })(), true)

  const FLOOR = 16
  if (R.length < FLOOR) { console.error(`\nONLY ${R.length} assertions ran; the floor is ${FLOOR}.`); process.exit(1) }
  console.log(`\n${R.filter(Boolean).length}/${R.length} deck assertions as predicted`)
  process.exit(R.every(Boolean) ? 0 : 1)
}
