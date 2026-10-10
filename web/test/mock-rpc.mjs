/**
 * A MOCK JSON-RPC for driving the BUILT redeem and vault pages in a real browser
 * without any validator (a page-wiring test, not a program test).
 *
 *   node web/test/mock-rpc.mjs            # listens on 127.0.0.1:8977
 *   node web/build.mjs --profile localnet --collection <printed> --rpc http://127.0.0.1:8977
 *
 * It serves one synthetic vault, owned by Keypair.fromSeed(32 x 1), holding cbBTC
 * and $GARY (its $GIRAFFISH account and every owner account missing, so the page
 * must send a PRIOR transaction), plus a round 35 C5 account (a stranger kept its
 * close authority). getProgramAccounts on Core and MINT is REFUSED, as a public RPC
 * refuses it, so the page must fall back to DAS (answered here from the mock's own Core accounts: nothing nested, and the owner's vault and Proof of Burn for round 46's show my vaults); the
 * bounded token reads are answered: getTokenAccountsByOwner per token program, as the
 * pages list a vault's token accounts since round 46 (round 47, V47o-8: the mock still
 * answered only the older getProgramAccounts listing, so every offline read through it
 * ran with both listings refused), and getProgramAccounts on the token programs (round 37 V1).
 *
 * MOCK_ADVERSARY=1 (round 38 V38-2): every classic listing of the deposit address's token
 * accounts (getTokenAccountsByOwner since round 47, V47o-8) lands one more account of a
 * mint a stranger can freeze, so each re-plan sees something new; the redemption must
 * still be sent.
 *
 * MOCK_DUST=1 (round 40 V40-1): a stranger's lamports sit at the vault's missing $GIRAFFISH
 * account address and at the owner's missing $GARY account address.
 *
 * Extra endpoints: POST /sign signs a message as the owner (the browser's test
 * wallet, accepted only by a localnet build); GET /report says whether the
 * redemption the page SENT is byte-identical to the one planRedemption builds
 * from the same state.
 */
import http from 'http'
import fs from 'fs'
import bs58 from 'bs58'
import { Keypair, PublicKey, Transaction } from '@solana/web3.js'
import * as spl from '@solana/spl-token'
import { ed25519 } from '@noble/curves/ed25519'
import { encode } from '../../bank/layout.mjs'
import { PROFILES } from '../src/config.js'
import { makeIds, ata, TOKEN_PROGRAM, ATA_PROGRAM } from '../src/lib/ids.mjs'
import { readRedemptionSnapshot } from '../src/lib/reads.mjs'
import { planRedemption } from '../src/lib/plan-redeem.mjs'
import { planClaim, planBuy, readPobs } from '../src/lib/plan-get.mjs'
import { readConfigs, chainNow, accounts, account } from '../src/lib/reads.mjs'
import { parseCoreAsset, parseCoreCollection } from '../src/lib/decode.mjs'
import { disc } from '../src/lib/enc.mjs'
import { SITE } from '../src/config.js'

const PORT = Number(process.env.MOCK_PORT || 8977)
const kp = n => Keypair.fromSeed(Buffer.alloc(32, n))
const OWNER = kp(1), COLL = kp(41).publicKey, ASSET = kp(3).publicKey, STRANGER = kp(5).publicKey
const P = { ...PROFILES.localnet, collection: COLL.toBase58(), rpc: `http://127.0.0.1:${PORT}` }
const ids = makeIds(P)
const PDA = ids.depositAddress(ASSET)
const CBBTC = new PublicKey('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'), GARY = new PublicKey('8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk'), GIRAFFISH = new PublicKey('Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump')
const M2 = kp(71).publicKey, C5 = kp(70).publicKey
const D = '11111111111111111111111111111111'
const NOW = Math.floor(Date.now() / 1000)
const SET = JSON.parse(fs.readFileSync(new URL('../../scripts/pob-set.json', import.meta.url), 'utf8'))
const B = 10n ** 12n

const ADVERSARY = process.env.MOCK_ADVERSARY === '1', MF = kp(74).publicKey
const acct = new Map()   // base58 -> { owner, data, lamports, executable }
const put = (a, owner, data, lamports = 2_039_280) => acct.set(new PublicKey(a).toBase58(), { owner: new PublicKey(owner).toBase58(), data: Buffer.from(data), lamports, executable: false })
const tokenData = (mint, owner, amount, closeAuthority = null) => { const b = Buffer.alloc(165)
  spl.AccountLayout.encode({ mint: new PublicKey(mint), owner: new PublicKey(owner), amount: BigInt(amount), delegateOption: 0, delegate: PublicKey.default, state: 1,
    isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: closeAuthority ? 1 : 0, closeAuthority: closeAuthority ? new PublicKey(closeAuthority) : PublicKey.default }, b); return b }
const mintData = dec => { const b = Buffer.alloc(82); b[44] = dec; b[45] = 1; return b }
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
const s = v => Buffer.concat([u32(Buffer.byteLength(v)), Buffer.from(v)])
function assetData() {
  const base = Buffer.concat([Buffer.from([1]), OWNER.publicKey.toBuffer(), Buffer.from([2]), COLL.toBuffer(), s('CBOBTC Charter Vault'), s('local'), Buffer.from([0])])
  const p1At = base.length + 9, p1 = Buffer.from([17, 1])
  const p2At = p1At + 2, p2 = Buffer.concat([Buffer.from([6]), u32(1), s('level'), s('III')])
  const regAt = p2At + p2.length
  return Buffer.concat([base, Buffer.from([3]), u64(regAt), p1, p2, Buffer.from([4]), u32(2), Buffer.from([17, 3]), ids.SEAL.toBuffer(), u64(p1At), Buffer.from([6, 2]), u64(p2At), u32(0)])
}
put(ids.SEAL_CFG, ids.SEAL_PROG, encode('SealConfig', { version: 2, collection: COLL.toBase58(), reserve_mints: [CBBTC, GARY, GIRAFFISH].map(String), bump: 255 }))
put(ids.MINT_CFG, ids.MINT_PROG, encode('MintConfig', {
  version: 6, collection: COLL.toBase58(), governance: ids.GOV_PDA.toBase58(), pool_ata: ata(ids.MINT_CFG, CBBTC).toBase58(), round_id: 1, opens_at: NOW - 100, closes_at: NOW + 86400,
  price: 21000, cap: 10, minted_this_round: 0, minted_total: 100, max_supply: 2100, bank_treasury: P.squads, split_bps: 8500, sales_stopped: false, sweep_stopped: false,
  guardian: P.initAuthority, swap_operator: kp(9).publicKey.toBase58(), sol_reserve_lamports: 50000000, bump: 255, max_sweep_lamports: 10000000000, sweep_cooldown_secs: 21600,
  last_sweep_at: 0, level_caps: [945, 525, 315, 210, 105], level_minted: [10, 0, 0, 0, 0], revealed_total: 10, payment_mint: CBBTC.toBase58(), pob_collection: SET.collection,
  pob_root: SET.root, charter_opens_at: NOW - 100, charter_closes_at: NOW + 600000, charter_claimed: 10, bare_burns_retired: 0, total_active_weight: 20, active_count: 10,
  acc_scaled: 5n * B, owed_scaled: 30n * B, last_distribute_at: 0, sales_stopped_at: 0, sweep_stopped_at: 0, pending_swap_operator: D, pending_swap_operator_at: 0,
  monthly_secs: 2592000, pending_guardian: D, pending_guardian_set: false, pending_guardian_at: 0, notice_secs: 604800, sweep_floor_lamports: 1000000000,
  cooldown_ceiling_secs: 86400, reserve_ceiling_lamports: 100000000, dist_epoch: 3, pending_count: 0, pending_this_epoch: 0, cbob_mint: kp(7).publicKey.toBase58(),
  max_boost_weight: 12, max_boost_epochs: 24, boost_price: 0, boost_weight: 0, boost_epochs: 0, boosts_active: 0, boosts_due: 0, boost_weight_total: 0,
  cbob_burned_total: 0, boost_expiring: Array(64).fill(0) }))
put(ids.BURN_CFG, ids.BURN_PROG, encode('BurnConfig', { version: 4, collection: COLL.toBase58(), bump: 255, burned_total: 0, redeem_window_secs: 3600, rate_head: 0, rate_ring: Array(64).fill(0) }))
put(ids.vaultRecord(ASSET), ids.MINT_PROG, encode('VaultRecord', { version: 4, asset: ASSET.toBase58(), mint_index: 7, reveal_slot: 1, level: 3, charter: true, entropy_set: true,
  entropy: '00'.repeat(32), attrs_hash: '00'.repeat(32), bump: 254, active: true, retired: false, reschedules: 0, vault_ata: ata(PDA, CBBTC).toBase58(),
  debt_scaled: 10n * B, pending: false, request_epoch: 1, boost_weight: 0, boost_end_epoch: 0, carry_scaled: 0 }))   // owes (4 x 5 - 10) = 10 sats
put(ASSET, ids.CORE, assetData(), 3_000_000)
put(ata(ids.MINT_CFG, CBBTC), TOKEN_PROGRAM, tokenData(CBBTC, ids.MINT_CFG, 500))
put(ata(PDA, CBBTC), TOKEN_PROGRAM, tokenData(CBBTC, PDA, 50_000))
put(ata(PDA, GARY), TOKEN_PROGRAM, tokenData(GARY, PDA, 7_000_000_000n))
put(C5, TOKEN_PROGRAM, tokenData(M2, PDA, 1, STRANGER))
for (const [m, d] of [[CBBTC, 8], [GARY, 9], [GIRAFFISH, 6], [M2, 0]]) put(m, TOKEN_PROGRAM, mintData(d), 1_461_600)
{ const b = mintData(0); b.writeUInt32LE(1, 46); STRANGER.toBuffer().copy(b, 50); put(MF, TOKEN_PROGRAM, b, 1_461_600) }   // the adversary's freezable mint
// ROUND 40 V40-1 (MOCK_DUST=1): a stranger's lamports at the vault's missing $GIRAFFISH account and at the
// owner's missing $GARY account: System-owned, 0 bytes, 650,240 lamports (mainnet's 0-byte rent floor)
if (process.env.MOCK_DUST === '1') for (const a of [ata(PDA, GIRAFFISH), ata(OWNER.publicKey, GARY)]) put(a, '11111111111111111111111111111111', Buffer.alloc(0), 650_240)
put(OWNER.publicKey, '11111111111111111111111111111111', Buffer.alloc(0), 5_000_000_000)
// the cluster clock (the pages read the Clock sysvar, not getBlockTime)
{ const c = Buffer.alloc(40); c.writeBigInt64LE(BigInt(NOW), 32); put('SysvarC1ock11111111111111111111111111111111', 'Sysvar1111111111111111111111111111111111111', c, 1_169_280) }
// review H1: a stranger's EMPTY Token-2022 ATA at the deposit address (170 bytes, ImmutableOwner)
{ const t = Buffer.alloc(170); kp(72).publicKey.toBuffer().copy(t, 0); PDA.toBuffer().copy(t, 32); t[108] = 1; t[165] = 2; t.writeUInt16LE(7, 166); t.writeUInt16LE(0, 168)
  put(kp(73).publicKey, 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', t) }
// the claim and buy pages: the owner holds Proof of Burn #<first in the set> and 100,000 sats of cbBTC
const POB = new PublicKey(SET.assets[0].address)
put(POB, ids.CORE, Buffer.concat([Buffer.from([1]), OWNER.publicKey.toBuffer(), Buffer.from([2]), new PublicKey(SET.collection).toBuffer(), s('Proof of Burn #1'), s('local'), Buffer.from([0])]), 3_000_000)
put(SET.collection, ids.CORE, Buffer.concat([Buffer.from([5]), kp(88).publicKey.toBuffer(), s('Giraffish Moments'), s('local'), u32(240), u32(240)]), 3_000_000)
put(ata(OWNER.publicKey, CBBTC), TOKEN_PROGRAM, tokenData(CBBTC, OWNER.publicKey, 100_000))
put(ata(ids.REVENUE, CBBTC), TOKEN_PROGRAM, tokenData(CBBTC, ids.REVENUE, 0))

const sent = [], report = { prior: 0, redemption: null, minted: [], adversaryLanded: 0 }
let height = 100
const wire = a => a ? { data: [a.data.toString('base64'), 'base64'], executable: a.executable, lamports: a.lamports, owner: a.owner, rentEpoch: 0, space: a.data.length } : null
const ctx = () => ({ context: { slot: 1000, apiVersion: '2.0.0' } })

async function handle(method, params) {
  switch (method) {
    case 'getAccountInfo': return { ...ctx(), value: wire(acct.get(params[0])) }
    case 'getMultipleAccounts': return { ...ctx(), value: params[0].map(a => wire(acct.get(a))) }
    case 'getProgramAccounts': {
      // round 37 V1: the token reads (owner at 32, balances or addresses only); Core and MINT
      // listings stay unavailable, as on a public RPC (the pages fall back to DAS)
      const [prog, cfg] = params
      if (!['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'].includes(prog))
        throw Object.assign(new Error('getProgramAccounts is not available on this endpoint (mock: as a public RPC)'), { code: -32601 })
      const own = cfg.filters.find(f => f.memcmp)?.memcmp.bytes, size = cfg.filters.find(f => f.dataSize)?.dataSize, ds = cfg.dataSlice
      return [...acct.entries()].filter(([, a]) => a.owner === prog && a.data.length >= 165 && (!size || a.data.length === size) && new PublicKey(a.data.subarray(32, 64)).toBase58() === own)
        .map(([k, a]) => ({ pubkey: k, account: wire({ ...a, data: a.data.subarray(ds.offset, ds.offset + ds.length) }) }))
    }
    case 'getTokenAccountsByOwner': {
      // round 47, V47o-8: how the pages list a vault's token accounts since round 46, one call
      // per token program, each with an 8-byte balance slice; `space` is the FULL size
      const [own, { programId: prog }, cfg = {}] = params, ds = cfg.dataSlice
      if (!['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'].includes(prog)) throw Object.assign(new Error('mock: not a token program'), { code: -32602 })
      // ROUND 38 V38-2 (MOCK_ADVERSARY=1): a stranger lands one more account of a mint they
      // can freeze at the deposit address every time the page lists it
      if (ADVERSARY && prog === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && own === PDA.toBase58()) { report.adversaryLanded++; put(Keypair.generate().publicKey, TOKEN_PROGRAM, tokenData(MF, PDA, 1)) }
      return { ...ctx(), value: [...acct.entries()].filter(([, a]) => a.owner === prog && a.data.length >= 165 && new PublicKey(a.data.subarray(32, 64)).toBase58() === own)
        .map(([k, a]) => ({ pubkey: k, account: { ...wire({ ...a, data: ds ? a.data.subarray(ds.offset, ds.offset + ds.length) : a.data }), space: a.data.length } })) }
    }
    case 'getSignaturesForAddress': return []
    case 'getTransaction': return null
    case 'getAssetsByOwner': {
      // round 46 (show my vaults): the Core assets this owner holds, as an index would list them
      const items = [...acct.entries()].filter(([, a]) => a.owner === ids.CORE.toBase58() && a.data.length > 33 && a.data[0] === 1 && new PublicKey(a.data.subarray(1, 33)).toBase58() === params.ownerAddress)
        .map(([k]) => ({ id: k, interface: 'MplCoreAsset', compression: { compressed: false } }))
      return { total: items.length, limit: 1000, page: 1, items } }
    case 'getSlot': return 1000
    case 'getBlockTime': return Math.floor(Date.now() / 1000)
    case 'getBlockHeight': return height
    case 'getGenesisHash': return 'mockGenesis1111111111111111111111111111111'
    case 'getLatestBlockhash': return { ...ctx(), value: { blockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N', lastValidBlockHeight: height + 150 } }
    case 'getMinimumBalanceForRentExemption': return 890880
    case 'simulateTransaction': {
      const want = params[1]?.accounts?.addresses || []
      const vaultBal = m => { const a = acct.get(ata(PDA, m).toBase58()); return a ? spl.AccountLayout.decode(a.data).amount : 0n }
      return { ...ctx(), value: { err: null, logs: ['Program log: mock simulation'], unitsConsumed: 168343, accounts: want.map(addr => {
        if (addr === ASSET.toBase58()) return wire({ owner: ids.CORE.toBase58(), data: Buffer.from([0]), lamports: 897840, executable: false })
        const a = acct.get(addr); if (!a) return null
        if (a.data.length !== 165) return wire({ ...a, lamports: a.lamports - 4_000_000 })   // a wallet: fee and rent
        const t = spl.AccountLayout.decode(a.data)
        const extra = t.mint.equals(CBBTC) ? vaultBal(CBBTC) + 10n : t.mint.equals(GARY) ? vaultBal(GARY) : t.mint.equals(M2) ? 1n : 0n
        return wire({ ...a, data: tokenData(t.mint, t.owner, t.amount + extra) })
      }) } }
    }
    case 'sendTransaction': {
      const raw = Buffer.from(params[0], 'base64'), tx = Transaction.from(raw)
      if (!tx.verifySignatures()) throw new Error('signature verification failed')
      const isRedemption = tx.instructions.some(i => i.programId.equals(ids.BURN_PROG))
      const mintIx = tx.instructions.find(i => i.programId.equals(ids.MINT_PROG) && ['claim_charter_vault', 'mint_vault'].some(n => Buffer.from(i.data).subarray(0, 8).equals(disc(n))))
      if (mintIx) {
        const asset = mintIx.keys[2].pubkey, kind = Buffer.from(mintIx.data).subarray(0, 8).equals(disc('claim_charter_vault')) ? 'claim' : 'buy'
        const snap = kind === 'claim' ? await claimSnap() : await buySnap()
        const plan = kind === 'claim' ? planClaim(ids, SITE, snap, asset) : planBuy(ids, SITE, snap, asset)
        report.minted.push({ kind, asset: asset.toBase58(), signedByOwnerAndAsset: tx.signatures.length === 2, matchesPlan: !!plan.ix &&
          Buffer.from(msgOf(plan.ix, tx)).equals(Buffer.from(msgOf(mintIx, tx))) })
        put(asset, ids.CORE, Buffer.concat([Buffer.from([1]), OWNER.publicKey.toBuffer(), Buffer.from([2]), COLL.toBuffer(), s('CBOB Vault'), s('local'), Buffer.from([0])]), 3_000_000)
        put(ids.vaultRecord(asset), ids.MINT_PROG, encode('VaultRecord', { version: 4, asset: asset.toBase58(), mint_index: 100, reveal_slot: 990, level: 0, charter: kind === 'claim',
          entropy_set: false, entropy: '00'.repeat(32), attrs_hash: '00'.repeat(32), bump: 254, active: false, retired: false, reschedules: 0, vault_ata: D, debt_scaled: 0,
          pending: false, request_epoch: 0, boost_weight: 0, boost_end_epoch: 0, carry_scaled: 0 }))
      } else if (isRedemption) {
        const expected = planRedemption(ids, await snapshotHere())
        const t = new Transaction().add(...expected.redemption); t.feePayer = OWNER.publicKey; t.recentBlockhash = tx.recentBlockhash
        report.redemption = { sentBytes: raw.length, matchesPlan: Buffer.from(t.serializeMessage()).equals(Buffer.from(tx.serializeMessage())), instructions: tx.instructions.map(i => i.programId.toBase58()) }
        put(ASSET, ids.CORE, Buffer.from([0]), 897840)
      } else {
        for (const i of tx.instructions) if (i.programId.equals(ATA_PROGRAM)) put(i.keys[1].pubkey, TOKEN_PROGRAM, tokenData(i.keys[3].pubkey, i.keys[2].pubkey, 0))
        report.prior++
      }
      sent.push(tx.signature); height++
      return bs58.encode(tx.signature)
    }
    case 'getSignatureStatuses': return { ...ctx(), value: params[0].map(() => ({ slot: 1000, confirmations: null, err: null, confirmationStatus: 'confirmed' })) }
    default: throw new Error(`mock: ${method} not implemented`)
  }
}
const msgOf = (ix, tx) => { const t = new Transaction().add(ix); t.feePayer = tx.feePayer; t.recentBlockhash = tx.recentBlockhash; return t.serializeMessage() }
const selfConn = async () => { const { Connection } = await import('@solana/web3.js'); return new Connection(P.rpc, 'confirmed') }
async function claimSnap() { const c = await selfConn(); const [cfg, nowSec, pobs, pc] = await Promise.all([readConfigs(c, ids), chainNow(c), readPobs(c, accounts, ids, SET, parseCoreAsset), account(c, SET.collection)])
  return { mintConfig: cfg.mint, nowSec, owner: OWNER.publicKey.toBase58(), pobSet: SET, pobs, pobCollection: parseCoreCollection(pc.data) } }
async function buySnap() { const c = await selfConn(); const cfg = await readConfigs(c, ids)
  return { mintConfig: cfg.mint, nowSec: await chainNow(c), owner: OWNER.publicKey.toBase58(), payerToken: spl.AccountLayout.decode(acct.get(ata(OWNER.publicKey, CBBTC).toBase58()).data) && { state: 1, amount: 100_000n }, revenueTokenExists: true } }
/** The same snapshot the page reads, built from this mock's state through the page's own reader. */
async function snapshotHere() {
  const { Connection } = await import('@solana/web3.js')
  return readRedemptionSnapshot(P, new Connection(P.rpc, 'confirmed'), ids, OWNER.publicKey, ASSET)
}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type, solana-client'); res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  if (req.method === 'OPTIONS') { res.end(); return }
  if (req.method === 'GET' && req.url === '/report') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(report)); return }
  let body = ''
  req.on('data', c => { body += c })
  req.on('end', async () => {
    if (req.url === '/sign') { res.end(Buffer.from(ed25519.sign(Buffer.from(body, 'base64'), OWNER.secretKey.subarray(0, 32))).toString('base64')); return }
    let j; try { j = JSON.parse(body) } catch { res.statusCode = 400; res.end(); return }
    const one = async r => { try { return { jsonrpc: '2.0', id: r.id, result: await handle(r.method, r.params || []) } } catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: e.code || -32000, message: e.message } } } }
    const out = Array.isArray(j) ? await Promise.all(j.map(one)) : await one(j)
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out))
  })
}).listen(PORT, '127.0.0.1', () => console.log(`mock RPC on ${P.rpc}; collection ${COLL.toBase58()}; vault ${ASSET.toBase58()}; owner ${OWNER.publicKey.toBase58()}`))
