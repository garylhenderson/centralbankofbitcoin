import test from 'node:test'
import assert from 'node:assert/strict'
import { saleRound } from '../src/lib/sale-round.mjs'
import { roundSnapshot } from '../../bank/sale-round.mjs'
import { buildIndex } from '../../bank/vault-index.mjs'
const now = 1800000000
const round = { id: 1, opens_at: now - 10, closes_at: now + 60, price_sats: '21001', cap: 20, minted: 3, minted_total: 243, max_supply: 2100, level_supply: 2100, stopped: false }
const data = () => ({ generated_at: now, initialization_observed: true, collection: 'collection', sale_round: { ...round } })
test('public open round reports exact cbBTC base units and counts', () => { const s = saleRound(data(), now); assert.equal(s.state, 'open'); assert.equal(s.remaining, 17); assert.equal(s.round.price_sats, '21001') })
test('open and close boundaries use exact chain timestamps', () => { const d = data(); assert.equal(saleRound(d, round.opens_at - 1).state, 'scheduled'); assert.equal(saleRound(d, round.opens_at).state, 'open'); assert.equal(saleRound(d, round.closes_at).state, 'closed') })
test('guardian stop overrides an otherwise open round', () => { const d = data(); d.sale_round.stopped = true; assert.equal(saleRound(d, now).state, 'paused') })
test('minted cap gives sold out without subtracting opened vaults', () => { const d = data(); d.sale_round.minted = 20; assert.equal(saleRound(d, now).state, 'sold_out'); assert.equal(saleRound(d, now).remaining, 0) })
test('global and level allotments bound remaining round capacity', () => { const d = data(); d.sale_round.minted_total = 2099; assert.equal(saleRound(d, now).remaining, 1); d.sale_round.minted_total = 2100; assert.equal(saleRound(d, now).state, 'sold_out') })
test('uninitialized and unvoted states never invent a price or date', () => { const d = data(); d.sale_round.id = 0; assert.equal(saleRound(d, now).state, 'unvoted'); Object.assign(d, { initialization_observed: false, collection: null, sale_round: null }); assert.equal(saleRound(d, now).state, 'waiting'); assert.equal(saleRound(d, now).round, undefined) })
test('missing, stale, future and inconsistent observations fail closed', () => { for (const patch of [{ generated_at: now - 1801 }, { generated_at: now + 31 }, { sale_round: null }, { collection: null }, { initialization_observed: false }]) assert.equal(saleRound({ ...data(), ...patch }, now).state, 'unavailable') })
test('corrupt counts and prices cannot advertise capacity', () => { for (const patch of [{ minted: 21 }, { minted_total: 2101 }, { cap: -1 }, { minted: 1.1 }, { price_sats: '1e9' }, { price_sats: '20999' }, { price_sats: '18446744073709551616' }, { stopped: 'false' }, { closes_at: now - 20 }]) assert.equal(saleRound({ ...data(), sale_round: { ...round, ...patch } }, now).state, 'unavailable') })
test('publisher uses MintConfig fields and emits no account identifiers', () => { const c = { round_id: 3, opens_at: 1n, closes_at: 2n, price: 9007199254740993n, cap: 4, minted_this_round: 2, minted_total: 200n, max_supply: 2100n, level_caps: [945n, 525n, 315n, 210n, 105n], sales_stopped: false, secret: 'private' }; const r = roundSnapshot(c); assert.equal(r.price_sats, '9007199254740993'); assert.equal(r.minted, 2); assert.equal(r.level_supply, 2100); assert.equal(r.secret, undefined) })
test('uninitialized index explicitly publishes null round', () => { const d = buildIndex({ nowSec: now, collection: null, mintConfig: null, vaults: [], opened: {}, prices: {} }); assert.equal(d.sale_round, null); assert.equal(saleRound(d, now).state, 'waiting') })
