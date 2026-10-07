/**
 * Readers for the non-Anchor accounts the pages look at: SPL token accounts and
 * mints, Metaplex Core assets and collections (with their plugin registry), and
 * upgradeable-loader ProgramData. The four CBOB configs and the VaultRecord are
 * read with bank/layout.mjs `decode`, the Bank's own reader, which
 * bank/selftest.mjs proves against the Rust structs.
 *
 * Every reader THROWS on bytes it cannot account for. A page that cannot read
 * an account says so and stops; it never fills in a default.
 */
import bs58 from 'bs58'
import { Buffer } from './enc.mjs'

const pk = (d, o) => bs58.encode(d.subarray(o, o + 32))
const need = (d, n, what) => { if (d.length < n) throw new Error(`${what}: ${d.length} bytes, need ${n}`) }

// ── SPL Token ──
export const TOKEN_ACCOUNT_LEN = 165
export const TOKEN_STATE = { 0: 'uninitialized', 1: 'initialized', 2: 'frozen' }

/** A classic (165 byte) or Token-2022 (165+) token account's BASE layout. */
export function parseTokenAccount(data) {
  const d = Buffer.from(data)
  need(d, TOKEN_ACCOUNT_LEN, 'token account')
  const delegateTag = d.readUInt32LE(72), closeTag = d.readUInt32LE(129)
  if (delegateTag > 1 || closeTag > 1 || d.readUInt32LE(109) > 1) throw new Error('token account: malformed option tag')
  return {
    mint: pk(d, 0), owner: pk(d, 32), amount: d.readBigUInt64LE(64),
    delegate: delegateTag ? pk(d, 76) : null, state: d[108],
    isNative: d.readUInt32LE(109) === 1, delegatedAmount: d.readBigUInt64LE(121),
    closeAuthority: closeTag ? pk(d, 133) : null, dataLen: d.length,
  }
}

/** Classic SPL mint: decimals at 44, initialized at 45. */
export function parseMint(data) {
  const d = Buffer.from(data)
  need(d, 82, 'mint')
  const ft = d.readUInt32LE(46)
  if (ft > 1) throw new Error('mint: malformed freeze authority option')
  return { supply: d.readBigUInt64LE(36), decimals: d[44], initialized: d[45] === 1, freezeAuthority: ft ? pk(d, 50) : null }
}

// ── Metaplex Core ──
export const CORE_KEY = { Uninitialized: 0, AssetV1: 1, HashedAssetV1: 2, PluginHeaderV1: 3, PluginRegistryV1: 4, CollectionV1: 5 }
/** Plugin enum / PluginType order (mpl-core). SEAL writes 17 (PermanentFreezeExecute). */
export const PLUGIN = ['Royalties', 'FreezeDelegate', 'BurnDelegate', 'TransferDelegate', 'UpdateDelegate',
  'PermanentFreezeDelegate', 'Attributes', 'PermanentTransferDelegate', 'PermanentBurnDelegate', 'Edition',
  'MasterEdition', 'AddBlocker', 'ImmutableMetadata', 'VerifiedCreators', 'Autograph', 'BubblegumV2',
  'FreezeExecute', 'PermanentFreezeExecute', 'Groups']
const AUTH = ['None', 'Owner', 'UpdateAuthority', 'Address']

function str(d, o) { need(d, o + 4, 'string'); const n = d.readUInt32LE(o); need(d, o + 4 + n, 'string'); return [d.subarray(o + 4, o + 4 + n).toString('utf8'), 4 + n] }
function authority(d, o) {
  const t = d[o]; if (t === undefined || t > 3) throw new Error(`core: bad plugin authority ${t} at ${o}`)
  return t === 3 ? [{ type: 'Address', address: pk(d, o + 1) }, 33] : [{ type: AUTH[t] }, 1]
}

/** Plugins after the base fields, if a plugin header is present. Parses the
 *  registry and the few plugin bodies the pages need; every other plugin, known or
 *  NOT (a newer Core may add types), is listed by its number and never parsed, so an
 *  unknown plugin can never make the account unreadable. Throws only when the
 *  registry itself does not hold together (callers then treat plugins as unknown). */
function plugins(d, o) {
  if (o === d.length) return Object.assign([], { externalCount: 0 })
  need(d, o + 9, 'plugin header')
  if (d[o] !== CORE_KEY.PluginHeaderV1) throw new Error(`core: expected a plugin header at ${o}, found key ${d[o]}`)
  const reg = Number(d.readBigUInt64LE(o + 1))
  need(d, reg + 5, 'plugin registry')
  if (d[reg] !== CORE_KEY.PluginRegistryV1) throw new Error('core: plugin registry key mismatch')
  const n = d.readUInt32LE(reg + 1)
  if (n > 64) throw new Error(`core: ${n} plugins is not credible`)
  let p = reg + 5
  const out = []
  for (let i = 0; i < n; i++) {
    need(d, p + 1, 'registry record')
    const type = d[p]
    const [auth, al] = authority(d, p + 1)
    need(d, p + 1 + al + 8, 'registry record')
    const offset = Number(d.readBigUInt64LE(p + 1 + al))
    p += 1 + al + 8
    let body = null
    try { body = pluginBody(d, offset, type) } catch { body = null }
    out.push({ type: PLUGIN[type] || `Plugin${type}`, typeId: type, authority: auth, offset, body })
  }
  need(d, p + 4, 'external registry')
  return Object.assign(out, { externalCount: d.readUInt32LE(p) })
}

const PARSED = ['Attributes', 'FreezeDelegate', 'PermanentFreezeDelegate', 'FreezeExecute', 'PermanentFreezeExecute', 'Royalties']
function pluginBody(d, o, type) {
  if (!PARSED.includes(PLUGIN[type])) return null
  need(d, o + 1, 'plugin')
  if (d[o] !== type) throw new Error(`core: plugin at ${o} is ${d[o]}, registry says ${type}`)
  const b = o + 1
  switch (PLUGIN[type]) {
    case 'Attributes': {
      need(d, b + 4, 'attributes'); const n = d.readUInt32LE(b); let q = b + 4; const list = []
      if (n > 64) throw new Error('core: too many attributes')
      for (let i = 0; i < n; i++) { const [k, kl] = str(d, q); q += kl; const [v, vl] = str(d, q); q += vl; list.push({ key: k, value: v }) }
      return { attributeList: list }
    }
    case 'Royalties': {
      need(d, b + 6, 'royalties'); const bps = d.readUInt16LE(b); const n = d.readUInt32LE(b + 2); let q = b + 6; const creators = []
      if (n > 16) throw new Error('core: too many creators')
      for (let i = 0; i < n; i++) { need(d, q + 33, 'creator'); creators.push({ address: pk(d, q), percentage: d[q + 32] }); q += 33 }
      need(d, q + 1, 'rule set')
      return { basisPoints: bps, creators, ruleSet: d[q] }
    }
    default:
      need(d, b + 1, 'frozen flag'); if (d[b] > 1) throw new Error('core: frozen flag is not a bool')
      return { frozen: d[b] === 1 }
  }
}

/** AssetV1: key | owner | update authority (None / Address / Collection) | name | uri | seq | plugins. */
export function parseCoreAsset(data) {
  const d = Buffer.from(data)
  if (d.length === 1 && d[0] === CORE_KEY.Uninitialized) return { burned: true }
  need(d, 34, 'core asset')
  if (d[0] !== CORE_KEY.AssetV1) throw new Error(`core: account key ${d[0]} is not an AssetV1`)
  const owner = pk(d, 1)
  const uaType = d[33]
  let o = 34, updateAuthority
  if (uaType === 0) updateAuthority = { type: 'None' }
  else if (uaType === 1 || uaType === 2) { need(d, 66, 'core asset'); updateAuthority = { type: uaType === 2 ? 'Collection' : 'Address', address: pk(d, 34) }; o = 66 }
  else throw new Error(`core: bad update authority ${uaType}`)
  const [name, nl] = str(d, o); o += nl
  const [uri, ul] = str(d, o); o += ul
  need(d, o + 1, 'seq'); let seq = null
  if (d[o] === 1) { need(d, o + 9, 'seq'); seq = d.readBigUInt64LE(o + 1); o += 9 } else if (d[o] === 0) o += 1
  else throw new Error('core: bad seq option')
  let pl, pluginsUnreadable = false
  try { pl = plugins(d, o) } catch { pl = Object.assign([], { externalCount: 0 }); pluginsUnreadable = true }
  return { burned: false, owner, updateAuthority, pluginsUnreadable, collection: updateAuthority.type === 'Collection' ? updateAuthority.address : null,
    name, uri, seq, plugins: pl, plugin: t => pl.find(x => x.type === t) || null }
}

/** CollectionV1: key | update authority | name | uri | num_minted | current_size | plugins. */
export function parseCoreCollection(data) {
  const d = Buffer.from(data)
  need(d, 41, 'core collection')
  if (d[0] !== CORE_KEY.CollectionV1) throw new Error(`core: account key ${d[0]} is not a CollectionV1`)
  let o = 33
  const [name, nl] = str(d, o); o += nl
  const [uri, ul] = str(d, o); o += ul
  need(d, o + 8, 'collection counts')
  const numMinted = d.readUInt32LE(o), currentSize = d.readUInt32LE(o + 4); o += 8
  let pl, pluginsUnreadable = false
  try { pl = plugins(d, o) } catch { pl = Object.assign([], { externalCount: 0 }); pluginsUnreadable = true }
  return { updateAuthority: pk(d, 1), name, uri, numMinted, currentSize, hasPluginHeader: o < d.length, plugins: pl, pluginsUnreadable,
    plugin: t => pl.find(x => x.type === t) || null }
}

// ── BPF upgradeable loader ──

/** Program account: enum 2 + ProgramData address. */
export function parseProgramAccount(data) {
  const d = Buffer.from(data); need(d, 36, 'program account')
  if (d.readUInt32LE(0) !== 2) throw new Error('not an upgradeable Program account')
  return { programData: pk(d, 4) }
}
/** ProgramData: enum 3 | slot u64 | Option<authority> | ELF from byte 45. */
export const PROGRAMDATA_HEADER = 45
export function parseProgramData(data) {
  const d = Buffer.from(data); need(d, PROGRAMDATA_HEADER, 'program data')
  if (d.readUInt32LE(0) !== 3) throw new Error('not a ProgramData account')
  const tag = d[12]; if (tag > 1) throw new Error('program data: bad authority option')
  return { slot: d.readBigUInt64LE(4), upgradeAuthority: tag ? pk(d, 13) : null, elf: d.subarray(PROGRAMDATA_HEADER) }
}
