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
import { account, anchorAccount } from './reads.mjs'
import { parseCoreCollection, parseTokenAccount } from './decode.mjs'
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
        const x = ata(o, pm), a = await account(conn, x, 'a cbBTC account')
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


/**
 * WHICH COLLECTION (review M2: a reload between step 0 and SEAL must never offer
 * to create a second one). Candidates, any two of which differing is a STOP:
 *   config.js; the collection SEAL was initialized with; launch/mainnet-init.json's
 *   vault_collection; the address this browser remembered when it sent step 0
 *   (only if it exists on chain); the one created in this session; and EVERY Core
 *   collection on chain whose update authority is MINT's PDA (`discovered`, read
 *   with collectionsOfMint). More than one of those is itself a STOP.
 * Returns { collection|null, conflict|null, source }.
 */
export async function resolveCollection(conn, profile, baseIds, { created = null, fromLaunch = null, remembered = null, discovered = [] } = {}) {
  let seal = null
  const a = await account(conn, baseIds.SEAL_CFG, 'the SEAL settings')
  if (a) { if (!a.owner.equals(baseIds.SEAL_PROG)) return { collection: null, conflict: 'the SEAL settings account is not owned by SEAL' }
    seal = decode('SealConfig', a.data).collection }
  if (discovered.length > 1) return { collection: null, conflict: `${discovered.length} collections on chain name MINT's PDA as their update authority (${discovered.join(', ')}); only one may exist` }
  const named = { 'config.js': profile.collection, SEAL: seal, 'launch/mainnet-init.json': fromLaunch, 'this browser': remembered, 'this session': created, 'the chain': discovered[0] || null }
  const values = Object.entries(named).filter(([, v]) => v)
  if (new Set(values.map(([, v]) => v)).size > 1) return { collection: null, conflict: `the vault collection is named differently by ${values.map(([k, v]) => `${k} (${v})`).join(', ')}` }
  return { collection: values[0]?.[1] || null, conflict: null, source: values.map(([k]) => k).join(', ') }
}

/** ctx.ids with the collection set (makeIds is pure). */
export const withCollection = (profile, collection) => makeIds({ ...profile, collection })
