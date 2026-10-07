/**
 * EVERY ON-CHAIN READ the pages make. Each one either returns what is there or
 * THROWS with a plain-English reason. Nothing here substitutes a default for a
 * read that failed: a page that cannot read stops (fail closed).
 */
import { Connection, PublicKey } from '@solana/web3.js'
import { Buffer } from './enc.mjs'
import bs58 from 'bs58'
import { decode } from '../../../bank/layout.mjs'
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM, ata } from './ids.mjs'
import { parseTokenAccount, parseCoreAsset, parseMint } from './decode.mjs'
import { acctDisc } from './enc.mjs'

export class ReadError extends Error {}

export function connect(profile) {
  if (!profile.rpc) throw new ReadError('This page has no network connection configured yet (web/src/config.js rpc is a TODO). It will not guess one.')
  // `same-origin:/rpc` = the server that served this page (local ceremony mode)
  const url = profile.rpc.startsWith('same-origin:') ? `${globalThis.location.origin}${profile.rpc.slice('same-origin:'.length)}` : profile.rpc
  return new Connection(url, { commitment: 'confirmed', disableRetryOnRateLimit: false })
}

const wrap = async (what, f) => {
  try { return await f() } catch (e) {
    if (e instanceof ReadError) throw e
    throw new ReadError(`Could not read ${what} from the network (${String(e?.message || e).slice(0, 160)}). Nothing was done; try again.`)
  }
}

export const account = (conn, addr, what = addr.toString()) =>
  wrap(what, () => conn.getAccountInfo(new PublicKey(addr), 'confirmed'))

export async function accounts(conn, addrs, what = 'accounts') {
  const out = []
  for (let i = 0; i < addrs.length; i += 100)
    out.push(...await wrap(what, () => conn.getMultipleAccountsInfo(addrs.slice(i, i + 100).map(a => new PublicKey(a)), 'confirmed')))
  return out
}

/** A CBOB config or record, pinned by owner program, discriminator and version
 *  (bank/layout.mjs decode). Absent -> null; present but wrong -> throws. */
const PLAIN = { SealConfig: 'the Bank\'s SEAL settings', MintConfig: 'the Bank\'s MINT settings', BurnConfig: 'the Bank\'s BURN settings',
  GovConfig: 'the Bank\'s voting settings', VaultRecord: 'the Bank\'s record of this vault' }
export async function anchorAccount(conn, name, addr, program) {
  const a = await account(conn, addr, PLAIN[name] || name)
  if (!a) return null
  if (!a.owner.equals(program)) throw new ReadError(`${name} at ${addr} is not owned by its program.`)
  try { return decode(name, a.data) } catch (e) { throw new ReadError(`${name} could not be read: ${e.message}`) }
}

/** The cluster's clock as the programs see it: the Clock sysvar's unix_timestamp
 *  (offset 32), read with getAccountInfo, not an RPC's block-time estimate. */
export const CLOCK_SYSVAR = new PublicKey('SysvarC1ock11111111111111111111111111111111')
export async function chainNow(conn) {
  const a = await account(conn, CLOCK_SYSVAR, 'the cluster clock')
  if (!a || a.data.length < 40) throw new ReadError('The network did not report its clock.')
  return Number(Buffer.from(a.data).readBigInt64LE(32))
}

export const genesisHash = conn => wrap('the cluster identity', () => conn.getGenesisHash())

/** Every token account (both programs) a wallet owns, raw. */
export async function tokenAccountsOf(conn, owner) {
  const out = []
  for (const [program, id] of [['token', TOKEN_PROGRAM], ['token2022', TOKEN_2022_PROGRAM]]) {
    const r = await wrap('the vault wallet\'s token accounts', () => conn.getTokenAccountsByOwner(new PublicKey(owner), { programId: id }, 'confirmed'))
    for (const { pubkey, account: a } of r.value) {
      let parsed = null
      try { parsed = parseTokenAccount(a.data) } catch { parsed = null }
      out.push({ address: pubkey.toBase58(), program, dataLen: a.data.length, lamports: a.lamports, parsed })
    }
  }
  return out
}

async function das(profile, method, params) {
  const base = profile.dasRpc || profile.rpc
  const url = base.startsWith('same-origin:') ? `${globalThis.location.origin}${base.slice('same-origin:'.length)}` : base
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'cbob', method, params }) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = await r.json()
  if (j.error || !j.result || !Array.isArray(j.result.items)) throw new Error(j.error?.message || 'no DAS result')
  return j.result
}

/**
 * Every Core asset owned by `owner` (a vault's deposit address). getProgramAccounts
 * on Core first (authoritative: the chain itself); DAS getAssetsByOwner second
 * (an index, which can lag). Each hit is re-read from its own account. If NEITHER
 * method works the read FAILS: "we could not look" is never "there is nothing".
 */
export async function coreAssetsOwnedBy(profile, conn, ids, owner) {
  const o = new PublicKey(owner)
  let addrs = null, how = null
  for (let attempt = 0; attempt < 3 && !addrs; attempt++) {
    try {
      const r = await conn.getProgramAccounts(ids.CORE, { commitment: 'confirmed', dataSlice: { offset: 0, length: 0 },
        filters: [{ memcmp: { offset: 0, bytes: bs58.encode([1]) } }, { memcmp: { offset: 1, bytes: o.toBase58() } }] })
      addrs = r.map(x => x.pubkey.toBase58()); how = 'chain'
    } catch { if (attempt < 2) await new Promise(res => setTimeout(res, 700 * (attempt + 1))) }
  }
  // DAS too, for what has no account: COMPRESSED NFTs (Bubblegum) owned by the address
  let dasItems = null
  try {
    dasItems = []
    for (let page = 1; page <= 20; page++) {
      const res = await das(profile, 'getAssetsByOwner', { ownerAddress: o.toBase58(), page, limit: 1000 })
      dasItems.push(...res.items); if (res.items.length < 1000) break
      if (page === 20) throw new Error('more than 20,000 assets')
    }
  } catch { dasItems = null }
  if (!addrs && dasItems) { addrs = dasItems.filter(i => !i.compression?.compressed).map(i => i.id); how = 'index' }
  if (!addrs) throw new ReadError('This network connection cannot list the NFTs inside a vault (it refuses both getProgramAccounts on Metaplex Core and the DAS index). Without that the page cannot tell whether opening would destroy an NFT inside, so it will not continue. This is a setting of the site, not something you did.')
  const infos = await accounts(conn, addrs, 'the NFTs in the vault')
  const out = []
  infos.forEach((a, i) => {
    if (!a || !a.owner.equals(ids.CORE)) return
    let p; try { p = parseCoreAsset(a.data) } catch { out.push({ address: addrs[i], unreadable: true, ourVault: false }); return }
    if (p.burned || p.owner !== o.toBase58()) return
    out.push({ address: addrs[i], ourVault: p.collection === ids.COLL.toBase58(), name: p.name })
  })
  const compressed = dasItems ? dasItems.filter(i => i.compression?.compressed).map(i => ({ address: i.id, compressed: true, ourVault: false })) : null
  return { assets: out, how, compressed, compressedChecked: !!dasItems }
}

/** Which vault's deposit address is `owner`? Walks our collection (chain, then index). */
export async function findHostOf(profile, conn, ids, owner) {
  let addrs = null
  try {
    const r = await conn.getProgramAccounts(ids.CORE, { commitment: 'confirmed', dataSlice: { offset: 0, length: 0 },
      filters: [{ memcmp: { offset: 0, bytes: bs58.encode([1]) } }, { memcmp: { offset: 33, bytes: bs58.encode([2]) } }, { memcmp: { offset: 34, bytes: ids.COLL.toBase58() } }] })
    addrs = r.map(x => x.pubkey.toBase58())
  } catch { /* fall through */ }
  if (!addrs) {
    try {
      addrs = []
      for (let page = 1; page <= 5; page++) {
        const res = await das(profile, 'getAssetsByGroup', { groupKey: 'collection', groupValue: ids.COLL.toBase58(), page, limit: 1000 })
        addrs.push(...res.items.map(i => i.id)); if (res.items.length < 1000) break
      }
    } catch { addrs = null }
  }
  if (!addrs) return null
  return addrs.find(a => ids.depositAddress(a).toBase58() === owner) || null
}

export async function mintDecimals(conn, mints) {
  const infos = await accounts(conn, mints, 'token details')
  const out = {}
  infos.forEach((a, i) => { if (a) { try { out[mints[i]] = parseMint(a.data).decimals } catch { /* unknown */ } } })
  return out
}

/** The configs every page needs. */
export async function readConfigs(conn, ids) {
  const [seal, mint, burn] = await Promise.all([
    anchorAccount(conn, 'SealConfig', ids.SEAL_CFG, ids.SEAL_PROG),
    anchorAccount(conn, 'MintConfig', ids.MINT_CFG, ids.MINT_PROG),
    anchorAccount(conn, 'BurnConfig', ids.BURN_CFG, ids.BURN_PROG)])
  if (!seal || !mint || !burn) throw new ReadError('The Bank\'s programs are not set up on this network yet.')
  if (seal.collection !== ids.COLL.toBase58() || mint.collection !== ids.COLL.toBase58())
    throw new ReadError('The Bank\'s programs on this network name a different vault collection from this page. Nothing was done.')
  return { seal, mint, burn }
}

/** A vault's asset and record. */
export async function readVault(conn, ids, asset) {
  const a = await account(conn, asset, 'the vault')
  let info = null
  if (a) {
    if (!a.owner.equals(ids.CORE)) throw new ReadError('That address is not a Metaplex Core NFT.')
    try { info = parseCoreAsset(a.data) } catch (e) { throw new ReadError(`That NFT could not be read: ${e.message}`) }
  }
  const record = await anchorAccount(conn, 'VaultRecord', ids.vaultRecord(asset), ids.MINT_PROG)
  return { info, record }
}

/** Everything planRedemption needs, read now. */
export async function readRedemptionSnapshot(profile, conn, ids, owner, asset) {
  const cfg = await readConfigs(conn, ids)
  const { info, record } = await readVault(conn, ids, asset)
  const pda = ids.depositAddress(asset)
  const [pdaTokens, nested, poolAcc, nowSec] = await Promise.all([
    tokenAccountsOf(conn, pda), coreAssetsOwnedBy(profile, conn, ids, pda),
    account(conn, cfg.mint.pool_ata, 'the payout pool'), chainNow(conn)])
  const pool = poolAcc ? parseTokenAccount(poolAcc.data) : null
  const mints = new Set(cfg.seal.reserve_mints)
  for (const t of pdaTokens) if (t.parsed && t.program === 'token') mints.add(t.parsed.mint)
  const mintList = [...mints]
  const ownerAtas = mintList.map(m => ata(owner, m).toBase58())
  const infos = await accounts(conn, ownerAtas, 'your token accounts')
  const ownerAtaExists = new Set(ownerAtas.filter((_, i) => !!infos[i]))
  // round 36 H1: the STATE of each receiving account, and who can freeze each mint
  const ownerAtaFrozen = new Set(ownerAtas.filter((_, i) => { if (!infos[i]) return false
    try { return parseTokenAccount(infos[i].data).state === 2 } catch { return true } }))
  const mintInfos = await accounts(conn, mintList, 'the tokens\' details')
  const mintFreeze = {}
  mintList.forEach((m, i) => { let f = 'unknown'
    try { if (mintInfos[i] && mintInfos[i].owner.equals(TOKEN_PROGRAM)) f = parseMint(mintInfos[i].data).freezeAuthority } catch { f = 'unknown' }
    mintFreeze[m] = f })
  return { owner: new PublicKey(owner).toBase58(), asset: new PublicKey(asset).toBase58(), assetInfo: info, record,
    mintConfig: cfg.mint, sealConfig: cfg.seal, burnConfig: cfg.burn, pool, pdaTokens, nested: nested.assets, nestedHow: nested.how,
    compressed: nested.compressed, compressedChecked: nested.compressedChecked,
    ownerAtaExists, ownerAtaFrozen, mintFreeze, nowSec, tokenNames: profile.tokenNames }
}

/** Vault records waiting to join from an EARLIER payout (MINT refuses a payout
 *  until they have: JoinWaitingFirst). One filtered getProgramAccounts on MINT. */
export async function waitingVaults(conn, ids, distEpoch) {
  let res
  try {
    res = await conn.getProgramAccounts(ids.MINT_PROG, { commitment: 'confirmed', filters: [
      { memcmp: { offset: 0, bytes: bs58.encode(acctDisc('VaultRecord')) } }, { memcmp: { offset: 177, bytes: bs58.encode([1]) } }] })
  } catch { throw new ReadError('This network connection will not list the vaults waiting to join, and a payout cannot run until they have. Nothing was sent.') }
  return res.map(x => decode('VaultRecord', x.account.data)).filter(r => r.pending && !r.retired && BigInt(r.request_epoch) < BigInt(distEpoch))
}

/** Every Core COLLECTION whose update authority is MINT's ["mint"] PDA (the
 *  ceremony's step 0 makes exactly one). Addresses only. Throws if it cannot look. */
export async function collectionsOfMint(conn, ids) {
  try {
    const r = await conn.getProgramAccounts(ids.CORE, { commitment: 'confirmed', dataSlice: { offset: 0, length: 0 },
      filters: [{ memcmp: { offset: 0, bytes: bs58.encode([5]) } }, { memcmp: { offset: 1, bytes: ids.MINT_AUTH.toBase58() } }] })
    return r.map(x => x.pubkey.toBase58())
  } catch { throw new ReadError('This network connection will not list Core collections, so the page cannot check that no vault collection was already created. Run the ceremony through an RPC that allows it (README.md, "Local mode").') }
}

/** Records whose $CBOB boost is DUE (MINT refuses a payout until each is expired:
 *  BoostsExpireFirst). One getProgramAccounts on MINT returning only the bytes
 *  125..195 of each vault record (active, retired ... boost_weight, boost_end_epoch). */
export async function dueBoostRecords(conn, ids, distEpoch) {
  let res
  try {
    res = await conn.getProgramAccounts(ids.MINT_PROG, { commitment: 'confirmed', dataSlice: { offset: 125, length: 70 },
      filters: [{ memcmp: { offset: 0, bytes: bs58.encode(acctDisc('VaultRecord')) } }] })
  } catch { throw new ReadError('This network connection will not list the boosts that are due, and a payout cannot run until they are expired. Nothing was sent.') }
  return res.filter(({ account: a }) => { const d = Buffer.from(a.data)
    return d.length === 70 && d[0] === 1 && d[1] === 0 && d[61] > 0 && d.readBigUInt64LE(62) <= BigInt(distEpoch) }).map(x => x.pubkey.toBase58())
}
