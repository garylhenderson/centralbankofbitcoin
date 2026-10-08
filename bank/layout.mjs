/**
 * THE v6 ACCOUNT LAYOUTS, DECLARED ONCE, AND PROVEN AGAINST THE RUST.
 *
 * v5's off-chain code read every config by hand-typed byte offsets, in four
 * files, each with its own copy of the map (`revenue.mjs` read `subarray(137,169)`
 * for a field that v6 moved). Every copy was a place the next layout change could
 * be misread silently. Here the FIELD LIST is the single fact: offsets are
 * COMPUTED from it, the decoder walks it, and `bank/selftest.mjs` parses the
 * actual `pub struct` out of `programs/*` and requires this list to equal it,
 * name for name and type for type. It also requires every raw offset the
 * PROGRAMS themselves pin across program boundaries (GOV reads MINT's
 * `minted_total` at 141, BURN reads `bare_burns_retired` at 454, ...) to equal the
 * offset computed here. So a struct edit that is not mirrored here turns the
 * build red, rather than turning a reader quietly wrong.
 *
 * Pure: no RPC, no web3. Pubkeys decode to base58 strings, 64/128-bit integers
 * to BigInt, `bool` to a boolean (a byte that is neither 0 nor 1 is refused —
 * Borsh would refuse it too, and reading it as truthy is how a corrupt flag
 * becomes a confident answer).
 */
import { createHash } from 'crypto'
import bs58 from 'bs58'
import { pinnedAccountData } from './anchor.mjs'

export const PROGRAM_IDS = {
  seal: '9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273',
  mint: 'Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo',
  burn: '8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8',
  gov: '2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2',
  // Round 24 (A3): the stateless sweep helper the redeem page calls through Core
  // ExecuteV1. It holds no accounts, so no layout below names it.
  sweep: 'EB2uVvsaThLp4PWt3LwAWveTCa9ZynPVbWzZfUhMf2aa',
}
/** PDA seeds, as the programs declare them. Asserted against each program's
 *  `*_SEED` constant in bank/selftest.mjs since round 24 (D6): this comment said
 *  "asserted against the Rust" for rounds before any assertion existed. */
export const SEEDS = {
  sealConfig: 'config', seal: 'seal',
  mintConfig: 'mint-config', mintAuthority: 'mint', vault: 'vault', revenue: 'revenue', rescue: 'rescue',
  burnConfig: 'burn-config',
  govConfig: 'gov-config', gov: 'gov', proposal: 'proposal', vote: 'vote',
}

/**
 * Each struct: the program that owns it, its Rust name (the account
 * discriminator preimage), the layout version this file reads, its source file,
 * and the fields IN ORDER with their Rust types.
 */
export const STRUCTS = {
  SealConfig: {
    program: 'seal', struct: 'Config', version: 2, src: 'programs/cbob-vaults/src/lib.rs',
    fields: [['version', 'u8'], ['collection', 'Pubkey'], ['reserve_mints', 'Vec<Pubkey>'], ['bump', 'u8']],
  },
  MintConfig: {
    program: 'mint', struct: 'MintConfig', version: 6, src: 'programs/cbob-vault-mint/src/lib.rs',
    fields: [
      ['version', 'u8'], ['collection', 'Pubkey'], ['governance', 'Pubkey'], ['pool_ata', 'Pubkey'],
      ['round_id', 'u32'], ['opens_at', 'i64'], ['closes_at', 'i64'], ['price', 'u64'], ['cap', 'u32'],
      ['minted_this_round', 'u32'], ['minted_total', 'u64'], ['max_supply', 'u64'],
      ['bank_treasury', 'Pubkey'], ['split_bps', 'u16'], ['sales_stopped', 'bool'], ['sweep_stopped', 'bool'],
      ['guardian', 'Pubkey'], ['swap_operator', 'Pubkey'], ['sol_reserve_lamports', 'u64'], ['bump', 'u8'],
      ['max_sweep_lamports', 'u64'], ['sweep_cooldown_secs', 'i64'], ['last_sweep_at', 'i64'],
      ['level_caps', '[u32; 5]'], ['level_minted', '[u32; 5]'], ['revealed_total', 'u64'],
      ['payment_mint', 'Pubkey'], ['pob_collection', 'Pubkey'], ['pob_root', '[u8; 32]'],
      ['charter_opens_at', 'i64'], ['charter_closes_at', 'i64'], ['charter_claimed', 'u32'],
      ['bare_burns_retired', 'u64'], ['total_active_weight', 'u64'], ['active_count', 'u64'],
      ['acc_scaled', 'u128'], ['owed_scaled', 'u128'], ['last_distribute_at', 'i64'],
      ['sales_stopped_at', 'i64'], ['sweep_stopped_at', 'i64'],
      ['pending_swap_operator', 'Pubkey'], ['pending_swap_operator_at', 'i64'], ['monthly_secs', 'i64'],
      // stage 3c (version 5)
      ['pending_guardian', 'Pubkey'], ['pending_guardian_set', 'bool'], ['pending_guardian_at', 'i64'],
      ['notice_secs', 'i64'], ['sweep_floor_lamports', 'u64'], ['cooldown_ceiling_secs', 'i64'],
      ['reserve_ceiling_lamports', 'u64'], ['dist_epoch', 'u64'], ['pending_count', 'u64'], ['pending_this_epoch', 'u64'],
      // the $CBOB boost (version 6)
      ['cbob_mint', 'Pubkey'], ['max_boost_weight', 'u8'], ['max_boost_epochs', 'u16'],
      ['boost_price', 'u64'], ['boost_weight', 'u8'], ['boost_epochs', 'u16'],
      ['boosts_active', 'u32'], ['boosts_due', 'u32'], ['boost_weight_total', 'u64'], ['cbob_burned_total', 'u64'],
      ['boost_expiring', '[u32; BOOST_RING]'],
    ],
  },
  VaultRecord: {
    program: 'mint', struct: 'VaultRecord', version: 4, src: 'programs/cbob-vault-mint/src/lib.rs',
    fields: [
      ['version', 'u8'], ['asset', 'Pubkey'], ['mint_index', 'u64'], ['reveal_slot', 'u64'], ['level', 'u8'],
      ['charter', 'bool'], ['entropy_set', 'bool'], ['entropy', '[u8; 32]'], ['attrs_hash', '[u8; 32]'],
      ['bump', 'u8'], ['active', 'bool'], ['retired', 'bool'], ['reschedules', 'u16'],
      ['vault_ata', 'Pubkey'], ['debt_scaled', 'u128'],
      // stage 3c (version 3)
      ['pending', 'bool'], ['request_epoch', 'u64'],
      // the $CBOB boost (version 4)
      ['boost_weight', 'u8'], ['boost_end_epoch', 'u64'], ['carry_scaled', 'u128'],
    ],
  },
  BurnConfig: {
    program: 'burn', struct: 'BurnConfig', version: 4, src: 'programs/cbob-vault-burn/src/lib.rs',
    fields: [['version', 'u8'], ['collection', 'Pubkey'], ['bump', 'u8'], ['burned_total', 'u64'],
      ['redeem_window_secs', 'i64'], ['rate_head', 'u8'], ['rate_ring', '[i64; 64]']],
  },
  GovConfig: {
    program: 'gov', struct: 'GovConfig', version: 4, src: 'programs/cbob-vault-gov/src/lib.rs',
    fields: [['version', 'u8'], ['collection', 'Pubkey'], ['quorum_bps', 'u16'], ['threshold_bps', 'u16'],
      ['min_voting_secs', 'i64'], ['proposal_count', 'u64'], ['bump', 'u8'],
      ['last_round_id', 'u64'], ['last_guardian_id', 'u64'], ['last_arm_id', 'u64'], ['last_boost_id', 'u64']],
  },
}

const FIXED = { u8: 1, bool: 1, u16: 2, u32: 4, u64: 8, i64: 8, u128: 16, Pubkey: 32, '[u32; 5]': 20, '[u8; 32]': 32, '[i64; 64]': 512,
  '[u32; BOOST_RING]': 256 }
export const fixedSize = t => FIXED[t]

/** Byte offset of every field that sits at a FIXED position (everything up to
 *  and including the first variable-length field). After a Vec the position
 *  depends on the data, so those fields have no static offset and are absent. */
export function offsets(name) {
  const s = STRUCTS[name]
  if (!s) throw new Error(`unknown struct ${name}`)
  const out = {}
  let o = 8
  for (const [f, t] of s.fields) {
    out[f] = o
    const n = FIXED[t]
    if (n === undefined) break
    o += n
  }
  return out
}

/** Bytes the fixed part occupies (discriminator included). */
export function fixedLength(name) {
  const s = STRUCTS[name]
  let o = 8
  for (const [, t] of s.fields) { const n = FIXED[t]; if (n === undefined) return null; o += n }
  return o
}

function readField(t, d, o) {
  const need = FIXED[t]
  if (need !== undefined && o + need > d.length) throw new Error(`truncated: ${t} at ${o} needs ${need} bytes, account is ${d.length}`)
  switch (t) {
    case 'u8': return [d[o], 1]
    case 'bool': {
      if (d[o] !== 0 && d[o] !== 1) throw new Error(`bool at ${o} is ${d[o]}, neither 0 nor 1`)
      return [d[o] === 1, 1]
    }
    case 'u16': return [d.readUInt16LE(o), 2]
    case 'u32': return [d.readUInt32LE(o), 4]
    case 'u64': return [d.readBigUInt64LE(o), 8]
    case 'i64': return [d.readBigInt64LE(o), 8]
    case 'u128': return [d.readBigUInt64LE(o) + (d.readBigUInt64LE(o + 8) << 64n), 16]
    case 'Pubkey': return [bs58.encode(d.subarray(o, o + 32)), 32]
    case '[u32; 5]': return [[0, 1, 2, 3, 4].map(i => d.readUInt32LE(o + 4 * i)), 20]
    case '[u8; 32]': return [Buffer.from(d.subarray(o, o + 32)).toString('hex'), 32]
    case '[i64; 64]': return [[...Array(64)].map((_, i) => d.readBigInt64LE(o + 8 * i)), 512]
    case '[u32; BOOST_RING]': return [[...Array(64)].map((_, i) => d.readUInt32LE(o + 4 * i)), 256]
    case 'Vec<Pubkey>': {
      if (o + 4 > d.length) throw new Error(`truncated Vec length at ${o}`)
      const n = d.readUInt32LE(o)
      if (n > 64) throw new Error(`Vec<Pubkey> length ${n} at ${o} is not credible`)
      if (o + 4 + 32 * n > d.length) throw new Error(`truncated Vec<Pubkey> of ${n} at ${o}`)
      return [[...Array(n)].map((_, i) => bs58.encode(d.subarray(o + 4 + 32 * i, o + 36 + 32 * i))), 4 + 32 * n]
    }
    default: throw new Error(`no reader for ${t}`)
  }
}

/** Decode the raw account BYTES (discriminator included) of `name`. Checks
 *  the discriminator and version itself, so it is safe on bytes from anywhere. */
export function decode(name, data) {
  const s = STRUCTS[name]
  const d = Buffer.from(data)
  const want = createHash('sha256').update(`account:${s.struct}`).digest().subarray(0, 8)
  if (d.length < 9 || !d.subarray(0, 8).equals(want)) throw new Error(`${name}: wrong discriminator`)
  if (d[8] !== s.version) throw new Error(`${name}: layout version ${d[8]}, this code reads ${s.version}`)
  const out = {}
  let o = 8
  for (const [f, t] of s.fields) { const [v, n] = readField(t, d, o); out[f] = v; o += n }
  return out
}

/** Pin owner + discriminator + version (bank/anchor.mjs), then decode. `acc` is
 *  a web3 AccountInfo-like ({owner: {toBase58()}, data}). Absent -> null. */
export function readPinned(name, acc, PublicKeyCtor) {
  const s = STRUCTS[name]
  const data = pinnedAccountData(acc, { program: new PublicKeyCtor(PROGRAM_IDS[s.program]), struct: s.struct,
    version: s.version, what: `${s.program} ${s.struct}` })
  return data ? decode(name, data) : null
}

/** Encode a decoded object back to bytes (the selftest's round-trip, and the
 *  way it builds synthetic accounts). Variable fields are supported. */
export function encode(name, obj) {
  const s = STRUCTS[name]
  const parts = [createHash('sha256').update(`account:${s.struct}`).digest().subarray(0, 8)]
  for (const [f, t] of s.fields) {
    const v = obj[f]
    let b
    switch (t) {
      case 'u8': b = Buffer.from([v]); break
      case 'bool': b = Buffer.from([v ? 1 : 0]); break
      case 'u16': b = Buffer.alloc(2); b.writeUInt16LE(v); break
      case 'u32': b = Buffer.alloc(4); b.writeUInt32LE(v); break
      case 'u64': b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); break
      case 'i64': b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); break
      case 'u128': { b = Buffer.alloc(16); const x = BigInt(v)
        b.writeBigUInt64LE(x & ((1n << 64n) - 1n)); b.writeBigUInt64LE(x >> 64n, 8); break }
      case 'Pubkey': b = Buffer.from(bs58.decode(v)); break
      case '[u32; 5]': b = Buffer.alloc(20); v.forEach((x, i) => b.writeUInt32LE(x, 4 * i)); break
      case '[u8; 32]': b = Buffer.from(v, 'hex'); break
      case '[i64; 64]': { if (v.length !== 64) throw new Error('[i64; 64] needs 64 values')
        b = Buffer.alloc(512); v.forEach((x, i) => b.writeBigInt64LE(BigInt(x), 8 * i)); break }
      case '[u32; BOOST_RING]': { if (v.length !== 64) throw new Error('[u32; BOOST_RING] needs 64 values')
        b = Buffer.alloc(256); v.forEach((x, i) => b.writeUInt32LE(x, 4 * i)); break }
      case 'Vec<Pubkey>': { const n = Buffer.alloc(4); n.writeUInt32LE(v.length)
        b = Buffer.concat([n, ...v.map(k => Buffer.from(bs58.decode(k)))]); break }
      default: throw new Error(`no writer for ${t}`)
    }
    parts.push(b)
  }
  return Buffer.concat(parts)
}

/** Flatten a decoded struct into the alarm's `prefix.field` snapshot, with
 *  JSON-safe values (BigInt -> decimal string). */
export function flatten(prefix, obj) {
  const out = {}
  // Arrays of BigInt too (BURN's rate ring): a snapshot is JSON, and JSON has no BigInt.
  const str = v => typeof v === 'bigint' ? v.toString() : v
  for (const [k, v] of Object.entries(obj || {})) out[`${prefix}.${k}`] = Array.isArray(v) ? v.map(str) : str(v)
  return out
}

/** Parse a `pub struct NAME { ... }` out of Rust source into [[field, type]].
 *  Comment lines and attributes are skipped; nested generics are kept whole. */
export function parseRustStruct(src, name) {
  const m = new RegExp(`pub struct ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src)
  if (!m) return null
  const out = []
  for (const raw of m[1].split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim()
    if (!line || line.startsWith('#[')) continue
    const f = /^pub (\w+):\s*(.+?),?$/.exec(line)
    // STRICT (round 22, L1): a private, `pub(crate)` or multi-line field used to
    // be dropped silently, so the field list stayed "equal" to the Rust while a
    // field the program writes was invisible here. Any line not consumed throws.
    if (!f) throw new Error(`parseRustStruct(${name}): a line it cannot read as one \`pub name: Type,\` field: ${JSON.stringify(line)}`)
    out.push([f[1], f[2].replace(/,$/, '').trim()])
  }
  return out
}

/**
 * A Core CollectionV1 is `key(1)=5 | update_authority(32) | name(String) |
 * uri(String) | num_minted(u32) | current_size(u32)` followed by the plugin
 * header and registry. The base fields move with every mint, so the drift watch
 * hashes ONLY what follows them: the plugins, where the fixed 10% royalty lives.
 */
export function collectionPluginsHash(data) {
  const d = Buffer.from(data)
  if (d.length < 41 || d[0] !== 5) return 'NOT_A_COLLECTION'
  let o = 33
  for (let i = 0; i < 2; i++) {
    if (o + 4 > d.length) return 'TRUNCATED'
    const n = d.readUInt32LE(o); o += 4 + n
  }
  o += 8
  if (o > d.length) return 'TRUNCATED'
  return createHash('sha256').update(d.subarray(o)).digest('hex').slice(0, 32)
}

/** The u8 discriminator values and constants the programs use that this side
 *  must agree with. */
export const ACTIVATION_SATS = 21000n
export const LEVEL_WEIGHTS = [2n, 3n, 4n, 5n, 6n]
export const ACC_SCALE = 1_000_000_000_000n
export const REDEEM_RATE_BPS = 210n
export const MONTHLY_SECS_MAINNET = 30n * 24n * 3600n
export const REDEEM_WINDOW_SECS_MAINNET = 3600n
export const REVEAL_LEAD_SLOTS = 16
export const REVEAL_WINDOW_SLOTS = 300
export const MAX_CRANK = 4
/** Pairs per legacy `claim`, MEASURED by the stage-3 suite (14 fit). */
export const CLAIM_BATCH = 14
/** Records per `expire_boosts` (MINT's MAX_EXPIRE_BATCH is 30; the suite
 *  measures that this many fit a legacy transaction). */
export const EXPIRE_BATCH = 20
export const GARY_MINT = '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk'
export const CBBTC_MINT = 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'
export const TOKEN_STATE_OFF = 108
export const TOKEN_STATE_FROZEN = 2
export const TOKEN_STATE_INITIALIZED = 1
