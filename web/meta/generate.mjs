#!/usr/bin/env node
/**
 * PER-VAULT METADATA (Gary, 2026-10-07). Every vault is minted by the claim and
 * buy pages with the on-chain name "CBOB Vault" and the link
 * https://centralbankofbitcoin.com/v/<asset>.json. This writes those files (and
 * collection.json) from CHAIN STATE, in the Metaplex token-metadata JSON shape.
 *
 *   CBOB_META_RPC=https://... node web/meta/generate.mjs --out /path/to/site/v --state /var/lib/cbob/meta-state.json [--dry-run]
 *
 * NOT INSTALLED. It is meant to run from cron (README.md, "Vault metadata"); it
 * needs an RPC that allows getProgramAccounts on MINT (it lists every vault
 * record), so give it the operator's provider URL in its environment, never the
 * site's public proxy.
 *
 * FAIL CLOSED, per vault: a vault whose record, NFT or cbBTC account cannot be
 * read, or whose picture does not answer 200 right now, KEEPS ITS PREVIOUS FILE.
 * A file is only ever replaced by one built from a complete read. Nothing is
 * ever deleted. If the vault list itself cannot be read, nothing is written.
 * Exit 0: every vault written or unchanged. 1: some vaults kept their previous
 * file (named). 2: nothing could be read, nothing written.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Connection, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { decode } from '../../bank/layout.mjs'
import { PROFILES, SITE } from '../src/config.js'
import { makeIds, ata } from '../src/lib/ids.mjs'
import { acctDisc } from '../src/lib/enc.mjs'
import { parseCoreAsset, parseTokenAccount } from '../src/lib/decode.mjs'

/**
 * THE PICTURES. The ratified level shells (cbob-vault-art LOG.md, "PROMOTED v1,
 * 2026-08-21"; the record page https://cdn.gary.club/cbob/vaults/v1/index.html
 * links exactly these), each checked to answer 200 image/png on 2026-10-07, and
 * checked again by every run before it is used.
 */
export const LEVEL_IMAGES = {
  1: 'https://cdn.gary.club/cbob/vaults/v1/level-1/master.png',
  2: 'https://cdn.gary.club/cbob/vaults/v1/level-2/master.png',
  3: 'https://cdn.gary.club/cbob/vaults/v1/level-3/master.png',
  4: 'https://cdn.gary.club/cbob/vaults/v1/level-4/master.png',
  5: 'https://cdn.gary.club/cbob/vaults/v1/level-5/master.png',
}
/** TODO(Gary): there is NO picture for a vault whose level is not drawn yet. The
 *  v1 record holds only the five level shells, the size ladder and lamp crops
 *  (undrawn.png, unrevealed.png and level-0/master.png all answer 404). Until one
 *  is made and recorded here, an undrawn vault's JSON carries no image. */
export const UNDRAWN_IMAGE = null
/** The collection's picture: the Bank's seal, as the site uses it (answered 200,
 *  2026-10-07). A choice made here, not a ruling: replace if Gary picks another. */
export const COLLECTION_IMAGE = 'https://centralbankofbitcoin.com/seal.png'

const LEVELS = ['I', 'II', 'III', 'IV', 'V']
const btc = sats => { const s = BigInt(sats); return `${s / 100_000_000n}.${(s % 100_000_000n).toString().padStart(8, '0')}` }

/** The JSON for one vault, from a complete read. Pure. */
export function vaultJson({ asset, record, burned, cbbtcSats }) {
  const drawn = record.level >= 1 && record.level <= 5
  const level = drawn ? LEVELS[record.level - 1] : null
  const image = drawn ? LEVEL_IMAGES[record.level] : UNDRAWN_IMAGE
  const activated = burned || record.retired ? 'Gone' : record.active ? 'Yes' : record.pending ? 'Joining' : 'No'
  const status = activated === 'Gone' ? 'It no longer exists: it was either opened on the Bank\'s redeem page, which gives everything in it to its owner, or burned some other way, which destroys its contents.'
    : `It holds ${btc(cbbtcSats)} cbBTC${activated === 'Yes' ? ' and earns from every payout' : activated === 'Joining' ? ' and joins the payouts at the next one' : ', and starts earning once it holds 21,000 sats'}.`
  const j = {
    // Gary 2026-10-07: people count from one. mint_index stays 0-based on chain.
    name: `CBOB Vault #${BigInt(record.mint_index) + 1n}`,
    symbol: 'CBOB',
    description: `A vault of the Central Bank of Bitcoin. ${drawn ? `Level ${level}, drawn on chain.` : 'Its level has not been drawn yet.'} ${status} Its level and contents are read from the chain at ${SITE.origin}/vault/?a=${asset}; this file is a convenience and can lag.`,
    external_url: `${SITE.origin}/vault/?a=${asset}`,
    attributes: [
      { trait_type: 'Level', value: level || 'Not drawn yet' },
      { trait_type: 'Charter', value: record.charter ? 'Yes' : 'No' },
      { trait_type: 'Activated', value: activated },
      { trait_type: 'cbBTC', value: btc(cbbtcSats) },
    ],
    properties: { category: 'image', files: [] },
  }
  if (image) { j.image = image; j.properties.files.push({ uri: image, type: 'image/png' }) }
  return j
}

export function collectionJson() {
  return {
    name: SITE.collectionName,
    symbol: 'CBOB',
    description: 'The vaults of the Central Bank of Bitcoin. Each vault holds cbBTC, $GARY and $GIRAFFISH, earns a share of every sale and resale by its level, and can be opened once, by its owner, on the Bank\'s redeem page.',
    image: COLLECTION_IMAGE,
    external_url: SITE.origin,
    properties: { category: 'image', files: [{ uri: COLLECTION_IMAGE, type: 'image/png' }] },
  }
}

/** Does `url` answer 200 with an image right now? */
export async function imageOk(url, fetchImpl = fetch) {
  try {
    let r = await fetchImpl(url, { method: 'HEAD', redirect: 'follow' })
    if (r.status === 405) r = await fetchImpl(url, { method: 'GET', headers: { range: 'bytes=0-0' } })
    return (r.status === 200 || r.status === 206) && /^image\//.test(r.headers.get('content-type') || '')
  } catch { return false }
}

const writeIfChanged = (file, obj, dry) => {
  const text = JSON.stringify(obj, null, 1) + '\n'
  let prev = null; try { prev = fs.readFileSync(file, 'utf8') } catch { prev = null }
  if (prev === text) return 'unchanged'
  if (!dry) { const tmp = `${file}.tmp-${process.pid}`; fs.writeFileSync(tmp, text, { mode: 0o644 }); fs.renameSync(tmp, file) }
  return prev === null ? 'created' : 'updated'
}

/**
 * One pass. `conn` needs getProgramAccounts and getMultipleAccountsInfo (a web3
 * Connection, or a test double). Returns { written, unchanged, kept: [{asset, why}], fatal }.
 */
export async function generate({ conn, profile, out, stateFile, dry = false, fetchImpl = fetch }) {
  if (!stateFile) return { fatal: 'no state file given (--state): it records the slot each file was written from, outside the public directory' }
  const ids = makeIds(profile)
  if (!ids.COLL) return { fatal: 'the vault collection is not set in web/src/config.js' }
  let cfgAcct, list
  try {
    cfgAcct = (await conn.getMultipleAccountsInfo([ids.MINT_CFG]))[0]
    list = await conn.getProgramAccounts(ids.MINT_PROG, { filters: [{ memcmp: { offset: 0, bytes: bs58.encode(acctDisc('VaultRecord')) } }] })
  } catch (e) { return { fatal: `could not list the vaults: ${String(e?.message || e).slice(0, 120)}` } }
  if (!cfgAcct || !cfgAcct.owner.equals(ids.MINT_PROG)) return { fatal: 'MINT\'s settings are missing' }
  let cfg; try { cfg = decode('MintConfig', cfgAcct.data) } catch (e) { return { fatal: `MINT's settings could not be read: ${e.message}` } }
  if (cfg.collection !== ids.COLL.toBase58()) return { fatal: 'MINT names a different collection from web/src/config.js' }
  fs.mkdirSync(out, { recursive: true })
  const res = { written: [], unchanged: 0, kept: [], fatal: null }
  // the pictures, checked now
  const imgOk = {}
  for (const [lvl, u] of Object.entries(LEVEL_IMAGES)) imgOk[lvl] = await imageOk(u, fetchImpl)
  if (UNDRAWN_IMAGE) imgOk[0] = await imageOk(UNDRAWN_IMAGE, fetchImpl)
  // the records
  const recs = []
  for (const { pubkey, account } of list) {
    try { recs.push(decode('VaultRecord', account.data)) } catch { res.kept.push({ asset: `(record ${pubkey.toBase58()})`, why: 'its record could not be read' }) }
  }
  // every read carries the slot it was answered at; a file is never replaced by an
  // OLDER view than the one it was written from, and never moves backwards (review L4)
  const batch = async keys => { const outA = []; let slot = Infinity
    for (let i = 0; i < keys.length; i += 100) {
      if (conn.getMultipleAccountsInfoAndContext) { const r = await conn.getMultipleAccountsInfoAndContext(keys.slice(i, i + 100)); outA.push(...r.value); slot = Math.min(slot, r.context.slot) }
      else throw new Error('the connection cannot report the slot of its answers')
    }
    return { accounts: outA, slot: slot === Infinity ? 0 : slot } }
  let assets, tokens, readSlot
  try {
    const a = await batch(recs.map(r => new PublicKey(r.asset)))
    const t = await batch(recs.map(r => ata(ids.depositAddress(r.asset), cfg.payment_mint)))
    assets = a.accounts; tokens = t.accounts; readSlot = Math.min(a.slot, t.slot)
  } catch {
    for (const r of recs) res.kept.push({ asset: r.asset, why: 'the NFTs or their cbBTC accounts could not be read' })
    return res
  }
  let state = {}
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) } catch { state = {} }
  recs.forEach((record, i) => {
    const a = assets[i], t = tokens[i], prev = state[record.asset]
    let burned = false
    try {
      if (prev && readSlot < prev.slot) throw new Error(`this read (slot ${readSlot}) is older than the file's (slot ${prev.slot})`)
      if (!a) throw new Error('its NFT account is missing')
      if (!a.owner.equals(ids.CORE)) throw new Error('its NFT is not a Core account')
      const p = parseCoreAsset(a.data)
      if (p.burned) burned = true
      else if (p.collection !== ids.COLL.toBase58()) throw new Error('its NFT is not in the vault collection')
      const drawn = record.level >= 1 && record.level <= 5
      const gone = burned || record.retired
      if (prev?.level && !drawn) throw new Error('its level read as undrawn after it was drawn (a lagging read)')
      if (prev?.gone && !gone) throw new Error('it read as existing after it was gone (a lagging read)')
      let sats = 0n
      if (!gone) {
        if (!t) {
          // a sealed vault's cbBTC account cannot be closed, so "missing" after a balance, or for an earning vault, is a bad read
          if ((prev && BigInt(prev.cbbtc || '0') > 0n) || record.active || record.pending) throw new Error('its cbBTC account read as missing')
        } else {
          if (!t.owner.equals(new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'))) throw new Error('its cbBTC account is not a token account')
          sats = parseTokenAccount(t.data).amount
        }
      }
      if (drawn && !imgOk[record.level]) throw new Error(`the Level ${LEVELS[record.level - 1]} picture did not answer 200 just now`)
      if (!drawn && UNDRAWN_IMAGE && !imgOk[0]) throw new Error('the undrawn picture did not answer 200 just now')
      const r = writeIfChanged(path.join(out, `${record.asset}.json`), vaultJson({ asset: record.asset, record, burned, cbbtcSats: sats }), dry)
      state[record.asset] = { slot: readSlot, level: drawn ? record.level : 0, gone, cbbtc: sats.toString() }
      if (r === 'unchanged') res.unchanged++; else res.written.push(record.asset)
    } catch (e) { res.kept.push({ asset: record.asset, why: e.message }) }
  })
  if (!dry) { const tmp = `${stateFile}.tmp-${process.pid}`; fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, stateFile) }
  if (await imageOk(COLLECTION_IMAGE, fetchImpl)) { const r = writeIfChanged(path.join(out, 'collection.json'), collectionJson(), dry); if (r !== 'unchanged') res.written.push('collection') }
  else res.kept.push({ asset: 'collection', why: 'the collection picture did not answer 200 just now' })
  return res
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null }
  const rpc = process.env.CBOB_META_RPC, out = arg('--out'), stateFile = arg('--state')
  if (!rpc || !out || !stateFile) { console.error('usage: CBOB_META_RPC=<url> node web/meta/generate.mjs --out <public dir> --state <private file> [--profile mainnet] [--dry-run]'); process.exit(2) }
  const r = await generate({ conn: new Connection(rpc, 'confirmed'), profile: PROFILES[arg('--profile') || 'mainnet'], out, stateFile, dry: process.argv.includes('--dry-run') })
  if (r.fatal) { console.error(`NOTHING WRITTEN: ${r.fatal}`); process.exit(2) }
  console.log(`written ${r.written.length}, unchanged ${r.unchanged}, kept previous ${r.kept.length}`)
  for (const k of r.kept) console.log(`  kept ${k.asset}: ${k.why}`)
  process.exit(r.kept.length ? 1 : 0)
}
