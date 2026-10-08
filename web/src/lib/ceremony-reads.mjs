/**
 * What each ceremony step has left on chain, shared by the ceremony page and
 * web/test/e2e-localnet.mjs (so the local test exercises the page's own check).
 *   null      the step has not run (nothing there yet);
 *   []        done: every field equals the ruled value;
 *   [..]      BROKEN: the named fields differ (these accounts are never rewritable).
 * `ctx` = { ids, conn, v, squads }; the cbBTC step records ctx.existing and the
 * funding step ctx.rent0 / ctx.shortfall for the step's builder.
 */
import { PublicKey } from '@solana/web3.js'
import { ata, TOKEN_PROGRAM } from './ids.mjs'
import { account, anchorAccount, wrap } from './reads.mjs'
import { parseCoreCollection, parseTokenAccount, absentIfDust } from './decode.mjs'
import { expectSeal, expectMint, expectBurn, expectGov, compare, checkCollectionAfterMint, checkCollectionBeforeMint, checkCollectionIdentity, checkTokenAccount } from './plan-ceremony.mjs'
import { makeIds } from './ids.mjs'
import { decode } from '../../../bank/layout.mjs'

export async function readStep(ctx, id) {
  const { ids, conn, v } = ctx
  const pm = v.paymentMint
  switch (id) {
    case 'collection': {
      if (!ids.COLL) return null
      const a = await account(conn, ids.COLL, 'the vault collection')
      if (!a) return [`the collection ${ids.COLL} does not exist`]
      if (!a.owner.equals(ids.CORE)) return [`${ids.COLL} is not a Metaplex Core account`]
      const c = parseCoreCollection(a.data)
      const mintDone = await account(conn, ids.MINT_CFG, 'the MINT settings')
      return [...checkCollectionIdentity(ids, c), ...(mintDone ? [] : checkCollectionBeforeMint(ids, c))]
    }
    case 'seal': { const a = await anchorAccount(conn, 'SealConfig', ids.SEAL_CFG, ids.SEAL_PROG); return a && compare(a, expectSeal(ids, v)) }
    case 'mint': {
      const a = await anchorAccount(conn, 'MintConfig', ids.MINT_CFG, ids.MINT_PROG); if (!a) return null
      const c = await account(conn, ids.COLL, 'the collection')
      return [...compare(a, expectMint(ids, v)), ...checkCollectionAfterMint(ids, parseCoreCollection(c.data))]
    }
    case 'burn': { const a = await anchorAccount(conn, 'BurnConfig', ids.BURN_CFG, ids.BURN_PROG); return a && compare(a, expectBurn(ids, v)) }
    case 'gov': { const a = await anchorAccount(conn, 'GovConfig', ids.GOV_CFG, ids.GOV_PROG); return a && compare(a, expectGov(ids, v)) }
    case 'atas': {
      const owners = [ids.MINT_CFG, ids.REVENUE, new PublicKey(ctx.squads)]
      const bad = [], existing = new Set()
      for (const o of owners) {
        // round 40 V40-2: a stranger's lamports at the address are absent (step 5 creates it), never "broken"
        const x = ata(o, pm), a = absentIfDust(await account(conn, x, 'a cbBTC account'))
        if (!a) continue
        existing.add(x.toBase58())
        if (!a.owner.equals(TOKEN_PROGRAM)) { bad.push(`${x}: not a token account`); continue }
        bad.push(...checkTokenAccount(parseTokenAccount(a.data), pm, o.toBase58()).map(b => `${x}: ${b}`))
      }
      ctx.existing = existing
      return existing.size === 3 ? bad : (bad.length ? bad : null)
    }
    case 'fund': {
      const rent0 = await conn.getMinimumBalanceForRentExemption(0)
      const a = await account(conn, ids.REVENUE, 'the revenue address')
      const have = a?.lamports ?? 0
      ctx.rent0 = rent0; ctx.shortfall = Math.max(0, rent0 - have)
      return ctx.shortfall === 0 ? [] : null
    }
  }
}


/** How far back the page reads a candidate collection's history to find the
 *  transaction that created it (round 37 V2). Anyone can name an address in a
 *  transaction, so a history can be padded; past this the candidate is never adopted;
 *  it is named in a warning (round 39 B4: never a stop). */
export const HISTORY_PAGE = 1000, HISTORY_PAGES = 5
const CREATE_COLLECTION_V2 = 21

/**
 * Who created a Core collection: the FIRST transaction naming its address is the
 * one that created it (a fresh keypair's address is unknown to anyone before then).
 * It is ours only if that transaction succeeded, its fee payer AND signer is the
 * launch key (INIT_AUTHORITY), and it holds Core CreateCollectionV2 for exactly this
 * address. Returns { by: 'launch' | 'other' | 'unverifiable', why, signature? };
 * a network failure throws (ReadError), which is a retry, not a verdict.
 */
export async function collectionCreator(conn, baseIds, collection, initAuthority) {
  const key = new PublicKey(collection)
  let before, oldest = null, n = 0, complete = false
  for (let page = 0; page < HISTORY_PAGES; page++) {
    const sigs = await wrap(`the history of ${collection}`, () => conn.getSignaturesForAddress(key, before ? { limit: HISTORY_PAGE, before } : { limit: HISTORY_PAGE }, 'confirmed'))
    n += sigs.length
    if (sigs.length) { oldest = sigs[sigs.length - 1]; before = oldest.signature }
    if (sigs.length < HISTORY_PAGE) { complete = true; break }
  }
  if (!complete) return { by: 'unverifiable', why: `more than ${n} transactions name it, so this page cannot reach the one that created it` }
  if (!oldest) return { by: 'unverifiable', why: 'the network reports no transaction for it' }
  const tx = await wrap(`the transaction that created ${collection}`, () => conn.getTransaction(oldest.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }))
  if (!tx) return { by: 'unverifiable', why: 'the network no longer serves the transaction that created it' }
  const msg = tx.transaction.message
  const keys = msg.staticAccountKeys.map(k => k.toBase58())
  const creates = msg.compiledInstructions.some(ix => keys[ix.programIdIndex] === baseIds.CORE.toBase58()
    && ix.data.length && ix.data[0] === CREATE_COLLECTION_V2 && keys[ix.accountKeyIndexes[0]] === collection)
  const signer = msg.header.numRequiredSignatures > 0 && keys[0] === initAuthority
  if (tx.meta?.err) return { by: 'other', why: 'the first transaction naming it failed', signature: oldest.signature }
  if (!creates) return { by: 'other', why: 'the first transaction naming it is not a collection create', signature: oldest.signature }
  if (!signer) return { by: 'other', why: `it was created by ${keys[0]}, not the launch key`, signature: oldest.signature }
  return { by: 'launch', why: 'created by the launch key', signature: oldest.signature }
}

/**
 * WHICH COLLECTION (review M2; round 37 V2: a stranger can create a decoy naming
 * MINT's PDA, for one collection's rent, so the chain scan is never authoritative).
 *   * PINS: config.js; the collection SEAL was initialized with; launch/mainnet-init.json's
 *     vault_collection; the address this browser remembered when it sent step 0 (the
 *     page checks it exists on chain); the one created in this session. Two pins that
 *     differ are a STOP (they are ours, and they disagree). One pin wins, and every
 *     other collection on chain naming MINT's PDA is IGNORED, named in a warning.
 *   * NO PIN (a reload after step 0 with this browser's memory gone): each chain
 *     candidate (`discovered`, from collectionsOfMint) is adopted only if the launch
 *     key created it (collectionCreator). Exactly one: adopted, with a note saying
 *     how it was found. None: step 0 is next. Two or more created by the launch key:
 *     STOP (both are ours; config.js must name one). One whose creator cannot be
 *     checked (a padded or pruned history) is ignored, named, when exactly one other
 *     IS verified as ours; with none verified it is listed in `unverified` for a
 *     prominent warning ("if one of these is yours, pin it") and step 0 is still
 *     offered (round 39 B4). Only pins that disagree, or two verified, stop the page.
 * Returns { collection|null, conflict|null, source, ignored: [{ address, why }], unverified? }.
 */
export async function resolveCollection(conn, profile, baseIds, { created = null, fromLaunch = null, remembered = null, discovered = [], creatorOf = null } = {}) {
  let seal = null
  const a = await account(conn, baseIds.SEAL_CFG, 'the SEAL settings')
  if (a) { if (!a.owner.equals(baseIds.SEAL_PROG)) return { collection: null, conflict: 'the SEAL settings account is not owned by SEAL', source: '', ignored: [] }
    seal = decode('SealConfig', a.data).collection }
  const named = { 'config.js': profile.collection, SEAL: seal, 'launch/mainnet-init.json': fromLaunch, 'this browser': remembered, 'this session': created }
  const values = Object.entries(named).filter(([, v]) => v)
  if (new Set(values.map(([, v]) => v)).size > 1) return { collection: null, conflict: `the vault collection is named differently by ${values.map(([k, v]) => `${k} (${v})`).join(', ')}`, source: '', ignored: [] }
  if (values.length) {
    const pin = values[0][1]
    return { collection: pin, conflict: null, source: values.map(([k]) => k).join(', '),
      ignored: [...new Set(discovered)].filter(d => d !== pin).map(d => ({ address: d, why: `not the collection named by ${values.map(([k]) => k).join(', ')}` })) }
  }
  const check = creatorOf || (c => collectionCreator(conn, baseIds, c, profile.initAuthority))
  const ours = [], ignored = []
  for (const d of [...new Set(discovered)]) {
    const r = await check(d)
    if (r.by === 'launch') ours.push({ address: d, signature: r.signature })
    else ignored.push({ address: d, why: r.why, unverifiable: r.by === 'unverifiable' })
  }
  if (ours.length > 1) return { collection: null, conflict: `the launch key created ${ours.length} collections naming MINT's PDA (${ours.map(o => o.address).join(', ')}); write the one to use in web/src/config.js and rebuild`, source: '', ignored }
  if (ours.length === 1) return { collection: ours[0].address, conflict: null, source: `the chain (created by the launch key in transaction ${ours[0].signature})`, ignored }
  // ROUND 39 B4 (replaces round 38 V38-3's STOP): with nothing pinned and NONE verified,
  // a candidate whose creator cannot be checked may be the real one, or a stranger's
  // padded decoy (about 0.025 SOL), and before step 0 there is nothing to pin. So the page
  // lists each one prominently ("if one of these is the collection you created, pin it")
  // and STILL offers step 0; a stranger can never stop the ceremony this way.
  const unverified = ignored.filter(i => i.unverifiable)
  return { collection: null, conflict: null, source: '', ignored, unverified }
}

/** ctx.ids with the collection set (makeIds is pure). */
export const withCollection = (profile, collection) => makeIds({ ...profile, collection })
