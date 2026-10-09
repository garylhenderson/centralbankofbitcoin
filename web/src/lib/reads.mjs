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
import { parseTokenAccount, parseCoreAsset, parseMint, absentIfDust } from './decode.mjs'
import { acctDisc } from './enc.mjs'

export class ReadError extends Error {}

export function connect(profile) {
  if (!profile.rpc) throw new ReadError('This page has no network connection configured yet (web/src/config.js rpc is a TODO). It will not guess one.')
  // `same-origin:/rpc` = the server that served this page (local ceremony mode)
  const url = profile.rpc.startsWith('same-origin:') ? `${globalThis.location.origin}${profile.rpc.slice('same-origin:'.length)}` : profile.rpc
  return new Connection(url, { commitment: 'confirmed', disableRetryOnRateLimit: false })
}

export const wrap = async (what, f) => {
  try { return await f() } catch (e) {
    if (e instanceof ReadError) throw e
    throw new ReadError(`Could not read ${what} from the network (${String(e?.message || e).slice(0, 160)}). Nothing was done; try again.`)
  }
}

export const account = (conn, addr, what = addr.toString()) =>
  wrap(what, () => conn.getAccountInfo(new PublicKey(addr), 'confirmed'))

/**
 * ROUND 42 (C12, measured): Core's CreateV2 and CreateCollectionV2 create the new
 * account with System create_account, which REFUSES an address that already holds
 * lamports. So whoever sees an attempt in flight (a slot leader, an RPC upstream)
 * can make it fail by funding the new address first. Nothing is lost (the whole
 * transaction reverts), but a page that retried with the SAME key would stay
 * blocked. Before every attempt:
 *   'fresh'  - nothing there: keep the key (a retry after an unknown outcome stays
 *              idempotent; a second create of a landed address cannot happen);
 *   'landed' - Core owns it with data: the earlier attempt landed, do not repeat it;
 *   'taken'  - anything else (a stranger's lamports): a NEW key, from makeKey().
 */
export async function checkNewAddress(conn, ids, kp, makeKey) {
  const a = await account(conn, kp.publicKey, 'the new address')
  if (!a) return { kp, state: 'fresh' }
  if (a.owner.equals(ids.CORE) && a.data.length > 0) return { kp, state: 'landed' }
  return { kp: makeKey(), state: 'taken', was: kp.publicKey.toBase58() }
}
export const TAKEN_NOTE = (was, what = 'your new vault') => `The address prepared for ${what} (${was}) was funded by someone else before it could be created, which the network then refuses to create over. Nothing was lost. A fresh address is used.`

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
  const a = absentIfDust(await account(conn, addr, PLAIN[name] || name))   // round 41 V41-1: a stranger's lamports = not created yet
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

/** Bounds on reading a vault wallet's token accounts (round 37 V1): no single read
 *  may grow with what a stranger puts there. */
export const STRAY_FULL_READ_MAX = 200   // accounts read in full (balance-holding classic strays; Token-2022 accounts)
const fullAccount = (address, program, a) => {
  let parsed = null
  try { parsed = parseTokenAccount(a.data) } catch { parsed = null }
  return { address, program, dataLen: a.data.length, lamports: a.lamports, parsed }
}

/**
 * What a vault wallet (`owner`, a deposit address) holds in token accounts, read in
 * BOUNDED pieces, never as one unbounded listing (round 37 V1: about 18,700 parked
 * accounts pushed that listing past the RPC proxy's 8 MB cap and blocked the page):
 *   * the vault's own reserve ATAs, by address (getMultipleAccounts), always, so a
 *     failed listing can never hide them;
 *   * classic accounts it owns: address, size and BALANCE only (an 8-byte slice),
 *     one getTokenAccountsByOwner;
 *   * Token-2022 accounts it owns: the same, a second getTokenAccountsByOwner (round
 *     46: our RPC refuses getProgramAccounts on Token-2022 outright); each listing
 *     stands alone, so a refused one is named and never hides the other;
 *   * then, in full, only the classic ones HOLDING a balance and the Token-2022 ones
 *     that are not provably empty plain accounts (an empty 165-byte one holds and
 *     hides nothing: W10), at most STRAY_FULL_READ_MAX, 100 a call.
 * Empty classic accounts are not read (nothing in them to lose). Whatever could not
 * be listed or examined is reported in `incomplete`, never thrown, so the planner
 * names it in ONE box instead of refusing the opening.
 */
export const PROMISED_MAX = 100
export async function vaultWalletAccounts(conn, owner, reserveMints, promised = []) {
  const o = new PublicKey(owner)
  const reserveAtas = reserveMints.map(m => ata(o, m).toBase58())
  // round 39 V39-1: the accounts the holder was PROMISED at the check are re-read by
  // address with the reserves (bounded), never through the listing; a failure throws
  const byAddress = [...new Set([...reserveAtas, ...promised.slice(0, PROMISED_MAX)])]
  // round 40 V40-1: a stranger's lamports at a missing account's address leave it ABSENT (creatable)
  const res = (await accounts(conn, byAddress, 'your vault\'s own accounts and the ones this page is moving to you')).map(absentIfDust)
  const out = []
  res.forEach((a, i) => { if (!a) return
    const prog = a.owner.equals(TOKEN_2022_PROGRAM) ? 'token2022' : a.owner.equals(TOKEN_PROGRAM) ? 'token' : 'other'
    out.push(prog === 'other' ? { address: byAddress[i], program: prog, dataLen: a.data.length, lamports: a.lamports, parsed: null } : fullAccount(byAddress[i], prog, a)) })
  const incomplete = { unlisted: null, unlistedPrograms: [], unexamined: 0, cap: STRAY_FULL_READ_MAX }
  // Round 46 (Gary's real Phantom crack on mainnet): our RPC (Helius) refuses ANY
  // getProgramAccounts on Token-2022 ("Too many accounts requested"), and one refused
  // listing used to discard the classic listing that had answered, so no stray was ever
  // moved. Now ONE getTokenAccountsByOwner per program (served from the RPC's owner
  // index; measured on Helius: tens of ms), each returning address, `space` and the
  // 8-byte balance only (the same bytes an account as round 37 V1's bounded reads), and
  // each program's listing stands on its own: a failed one is named, never hides the other.
  const amountOf = x => { const d = Buffer.from(x.account.data); return d.length === 8 ? d.readBigUInt64LE(0) : null }
  const listing = prog => conn.getTokenAccountsByOwner(o, { programId: prog }, { commitment: 'confirmed', dataSlice: { offset: 64, length: 8 } })
  const [rc, r22] = await Promise.allSettled([listing(TOKEN_PROGRAM), listing(TOKEN_2022_PROGRAM)])
  const classic = rc.status === 'fulfilled' ? rc.value.value : []
  const t22all = r22.status === 'fulfilled' ? r22.value.value : []
  for (const [r, name] of [[rc, 'token'], [r22, 'token2022']]) if (r.status === 'rejected') {
    incomplete.unlistedPrograms.push(name)
    incomplete.unlisted = `${incomplete.unlisted ? `${incomplete.unlisted}; ` : ''}${name}: ${String(r.reason?.message || r.reason).slice(0, 100)}`
  }
  const seen = new Set(byAddress)
  // an empty PLAIN Token-2022 account (exactly 165 bytes: no extensions) holds and hides
  // nothing (W10); an account whose size the RPC did not report is read in full
  const emptyPlain22 = new Set(t22all.filter(x => x.account.space === 165 && amountOf(x) === 0n).map(x => x.pubkey.toBase58()))
  const want = [
    ...classic.filter(x => !seen.has(x.pubkey.toBase58()) && amountOf(x) !== 0n).map(x => [x.pubkey.toBase58(), 'token']),
    ...t22all.filter(x => !seen.has(x.pubkey.toBase58()) && !emptyPlain22.has(x.pubkey.toBase58())).map(x => [x.pubkey.toBase58(), 'token2022'])]
  const take = want.slice(0, STRAY_FULL_READ_MAX)
  incomplete.unexamined = want.length - take.length
  try {
    const full = await accounts(conn, take.map(([x]) => x), 'the other accounts in the vault wallet')
    full.forEach((x, i) => { if (x) out.push(fullAccount(take[i][0], take[i][1], x)) })
  } catch { incomplete.unexamined += take.length }
  return { tokens: out, incomplete: incomplete.unexamined || incomplete.unlisted ? incomplete : null }
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

/** Bounds on the NFTs read at a deposit address (round 37, coordinator's follow-up to V1). */
export const NFT_FULL_READ_MAX = 200, DAS_PAGE = 1000, DAS_PAGES = 20

/**
 * Every Core asset owned by `owner` (a vault's deposit address). getProgramAccounts
 * on Core first (authoritative: the chain itself, addresses only); DAS getAssetsByOwner
 * second (an index, which can lag), at most DAS_PAGES pages of DAS_PAGE. At most
 * NFT_FULL_READ_MAX are then re-read from their own accounts.
 * "We could not look" is never "there is nothing": when neither listing completes,
 * or there are more than the page reads, it says so in `incomplete` and never throws,
 * so a stranger flooding a deposit address with NFTs (past the proxy's 8 MB cap)
 * cannot block an opening; the planner names the gap in ONE box. A CBOB vault the
 * page finds never refuses (round 39 V39-2: rescued in an optional set-up step, or
 * after the opening).
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
    for (let page = 1; page <= DAS_PAGES; page++) {
      const res = await das(profile, 'getAssetsByOwner', { ownerAddress: o.toBase58(), page, limit: DAS_PAGE })
      dasItems.push(...res.items); if (res.items.length < DAS_PAGE) break
      if (page === DAS_PAGES) throw new Error(`more than ${DAS_PAGE * DAS_PAGES} assets`)
    }
  } catch { dasItems = null }
  if (!addrs && dasItems) { addrs = dasItems.filter(i => !i.compression?.compressed).map(i => i.id); how = 'index' }
  const compressed = dasItems ? dasItems.filter(i => i.compression?.compressed).map(i => ({ address: i.id, compressed: true, ourVault: false })) : null
  const unlisted = { assets: [], how: null, compressed, compressedChecked: !!dasItems, incomplete: { unlisted: true, unexamined: 0, cap: NFT_FULL_READ_MAX } }
  if (!addrs) return unlisted
  const take = addrs.slice(0, NFT_FULL_READ_MAX)
  let infos
  try { infos = await accounts(conn, take, 'the NFTs in the vault') } catch { return unlisted }
  const out = []
  infos.forEach((a, i) => {
    if (!a || !a.owner.equals(ids.CORE)) return
    let p; try { p = parseCoreAsset(a.data) } catch { out.push({ address: take[i], unreadable: true, ourVault: false }); return }
    if (p.burned || p.owner !== o.toBase58()) return
    out.push({ address: take[i], ourVault: p.collection === ids.COLL.toBase58(), name: p.name })
  })
  const unexamined = addrs.length - take.length
  return { assets: out, how, compressed, compressedChecked: !!dasItems, incomplete: unexamined ? { unlisted: false, unexamined, cap: NFT_FULL_READ_MAX } : null }
}

/**
 * THE VAULTS A WALLET OWNS, FOR A PICK LIST (round 46; Gary: "why do I have to put my
 * address in. It should show me my vaults and let me pick"). Listed by coreAssetsOwnedBy
 * (Core's own accounts first, the DAS index only when that cannot be read), then every
 * candidate VERIFIED ON CHAIN from its own accounts: a live Core asset owned by this
 * wallet, in the vault collection, whose VaultRecord exists, is owned by MINT and names
 * this asset. The index can only fail to SUGGEST a vault; it can never list one that is
 * not (DAS has failed open here three times). Nothing is ever signed from this list: the
 * pick fills the same address box the holder could paste into, and the page then reads
 * that vault in full as before.
 */
export async function vaultsOwnedBy(profile, conn, ids, owner) {
  const o = new PublicKey(owner).toBase58()
  const found = await coreAssetsOwnedBy(profile, conn, ids, o)
  const cand = found.assets.filter(a => a.ourVault && !a.unreadable)
  const recs = cand.length ? await accounts(conn, cand.map(a => ids.vaultRecord(a.address).toBase58()), 'the Bank\'s records of your vaults') : []
  const vaults = []
  cand.forEach((a, i) => {
    const r = absentIfDust(recs[i])
    if (!r || !r.owner.equals(ids.MINT_PROG)) return
    let rec; try { rec = decode('VaultRecord', r.data) } catch { return }
    if (String(rec.asset) !== a.address || rec.retired) return
    vaults.push({ address: a.address, name: a.name || null, level: Number(rec.level), active: !!rec.active })
  })
  return { vaults, how: found.how, unlisted: !found.how, more: !!found.incomplete && !found.incomplete.unlisted }
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

/** The buy page's read (round 41 C2: a library function so a test drives the page's OWN read).
 *  The holder's and the revenue address's cbBTC accounts are read by address; a stranger's
 *  lamports at either address (round 40 V40-1) are absent, never "unreadable". */
export async function readBuySnapshot(conn, ids, owner) {
  const [cfg, nowSec] = await Promise.all([readConfigs(conn, ids), chainNow(conn)])
  const pm = cfg.mint.payment_mint, o = new PublicKey(owner)
  const [pt, rt] = (await Promise.all([account(conn, ata(o, pm), 'your cbBTC account'), account(conn, ata(ids.REVENUE, pm), 'the Bank\'s revenue account')])).map(absentIfDust)
  let payerToken = null
  if (pt) { try { payerToken = parseTokenAccount(pt.data) } catch { throw new ReadError('Your cbBTC account could not be read.') } }
  return { mintConfig: cfg.mint, nowSec, owner: o.toBase58(), payerToken, revenueTokenExists: !!rt }
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
export async function readRedemptionSnapshot(profile, conn, ids, owner, asset, promised = []) {
  const cfg = await readConfigs(conn, ids)
  const { info, record } = await readVault(conn, ids, asset)
  const pda = ids.depositAddress(asset)
  const [wallet, nested, poolAcc, nowSec] = await Promise.all([
    vaultWalletAccounts(conn, pda, cfg.seal.reserve_mints, promised), coreAssetsOwnedBy(profile, conn, ids, pda),
    account(conn, cfg.mint.pool_ata, 'the payout pool').then(absentIfDust), chainNow(conn)])
  const pool = poolAcc ? parseTokenAccount(poolAcc.data) : null
  const pdaTokens = wallet.tokens
  const mints = new Set(cfg.seal.reserve_mints)
  for (const t of pdaTokens) if (t.parsed && t.program === 'token') mints.add(t.parsed.mint)
  const mintList = [...mints]
  const ownerAtas = mintList.map(m => ata(owner, m).toBase58())
  // round 40 V40-1: only a TOKEN-owned account exists as a receiving account; a stranger's
  // lamports at the address (System-owned, 0 bytes) are absent, so its create is scheduled
  const isToken = a => !!a && (a.owner.equals(TOKEN_PROGRAM) || a.owner.equals(TOKEN_2022_PROGRAM))
  const infos = (await accounts(conn, ownerAtas, 'your token accounts')).map(absentIfDust)
  const ownerAtaExists = new Set(ownerAtas.filter((_, i) => isToken(infos[i])))
  // round 36 H1: the STATE of each receiving account, and who can freeze each mint
  // (round 40: only a token account can be frozen; one that cannot be parsed stays fail-safe)
  const ownerAtaFrozen = new Set(ownerAtas.filter((_, i) => { if (!isToken(infos[i])) return false
    try { return parseTokenAccount(infos[i].data).state === 2 } catch { return true } }))
  const mintInfos = await accounts(conn, mintList, 'the tokens\' details')
  const mintFreeze = {}
  mintList.forEach((m, i) => { let f = 'unknown'
    try { if (mintInfos[i] && mintInfos[i].owner.equals(TOKEN_PROGRAM)) f = parseMint(mintInfos[i].data).freezeAuthority } catch { f = 'unknown' }
    mintFreeze[m] = f })
  return { owner: new PublicKey(owner).toBase58(), asset: new PublicKey(asset).toBase58(), assetInfo: info, record,
    mintConfig: cfg.mint, sealConfig: cfg.seal, burnConfig: cfg.burn, pool, pdaTokens, nested: nested.assets, nestedHow: nested.how,
    compressed: nested.compressed, compressedChecked: nested.compressedChecked, strayReadIncomplete: wallet.incomplete, nftReadIncomplete: nested.incomplete,
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
