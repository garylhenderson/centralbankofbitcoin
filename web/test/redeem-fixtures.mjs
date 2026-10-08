/**
 * Synthetic redemption snapshots, the same construction as plan.test.mjs's (round 39
 * C03: the bundle test runs the BUNDLED planRedemption on these and compares it with
 * node's, byte for byte). Plain data only, so one snapshot feeds both builds.
 */
import * as web3 from '@solana/web3.js'
import { encode, decode } from '../../bank/layout.mjs'
import { profile } from '../src/config.js'
import { makeIds, ata } from '../src/lib/ids.mjs'

const W = web3.PublicKey
const kp = n => web3.Keypair.fromSeed(Buffer.alloc(32, n)).publicKey
export const COLL = kp(41)
export const P = { ...profile('mainnet'), collection: COLL.toBase58() }
const ids = makeIds(P)
export const CBBTC = new W('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'), GARY = new W('8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk'), GIRAFFISH = new W('Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump')
const RES = [CBBTC, GARY, GIRAFFISH]
export const owner = kp(1), asset = kp(3), stranger = kp(5)
export const pda = ids.depositAddress(asset)
const POOL = ata(ids.MINT_CFG, CBBTC)
const D = '11111111111111111111111111111111'
const B = 10n ** 12n
export { kp }
export const mintCfg = (o = {}) => decode('MintConfig', encode('MintConfig', {
  version: 6, collection: COLL.toBase58(), governance: ids.GOV_PDA.toBase58(), pool_ata: POOL.toBase58(), round_id: 1, opens_at: 0, closes_at: 0,
  price: 21000, cap: 10, minted_this_round: 0, minted_total: 100, max_supply: 2100, bank_treasury: P.squads, split_bps: 8500,
  sales_stopped: false, sweep_stopped: false, guardian: P.initAuthority, swap_operator: kp(9).toBase58(), sol_reserve_lamports: 50000000, bump: 255,
  max_sweep_lamports: 10000000000, sweep_cooldown_secs: 21600, last_sweep_at: 0, level_caps: [945, 525, 315, 210, 105], level_minted: [10, 0, 0, 0, 0],
  revealed_total: 10, payment_mint: CBBTC.toBase58(), pob_collection: kp(8).toBase58(), pob_root: 'ab'.repeat(32), charter_opens_at: 1, charter_closes_at: 2,
  charter_claimed: 10, bare_burns_retired: 0, total_active_weight: 20, active_count: 10, acc_scaled: 5n * B, owed_scaled: 0, last_distribute_at: 0,
  sales_stopped_at: 0, sweep_stopped_at: 0, pending_swap_operator: D, pending_swap_operator_at: 0, monthly_secs: 2592000, pending_guardian: D,
  pending_guardian_set: false, pending_guardian_at: 0, notice_secs: 604800, sweep_floor_lamports: 1000000000, cooldown_ceiling_secs: 86400,
  reserve_ceiling_lamports: 100000000, dist_epoch: 3, pending_count: 0, pending_this_epoch: 0, cbob_mint: kp(7).toBase58(), max_boost_weight: 12,
  max_boost_epochs: 24, boost_price: 0, boost_weight: 0, boost_epochs: 0, boosts_active: 0, boosts_due: 0, boost_weight_total: 0, cbob_burned_total: 0,
  boost_expiring: Array(64).fill(0), ...o }))
export const record = (o = {}) => decode('VaultRecord', encode('VaultRecord', {
  version: 4, asset: asset.toBase58(), mint_index: 7, reveal_slot: 1, level: 3, charter: true, entropy_set: true, entropy: '00'.repeat(32),
  attrs_hash: '00'.repeat(32), bump: 254, active: true, retired: false, reschedules: 0, vault_ata: ata(pda, CBBTC).toBase58(), debt_scaled: 4n * 5n * B,
  pending: false, request_epoch: 1, boost_weight: 0, boost_end_epoch: 0, carry_scaled: 0, ...o }))
export const sealCfg = decode('SealConfig', encode('SealConfig', { version: 2, collection: COLL.toBase58(), reserve_mints: RES.map(String), bump: 255 }))
export const burnCfg = (o = {}) => decode('BurnConfig', encode('BurnConfig', { version: 4, collection: COLL.toBase58(), bump: 255, burned_total: 0,
  redeem_window_secs: 3600, rate_head: 0, rate_ring: Array(64).fill(0), ...o }))
export const tok = (address, mint, amount, o = {}) => ({ address: address.toString(), program: o.program || 'token', dataLen: o.dataLen || 165, lamports: 2039280,
  parsed: { mint: mint.toString(), owner: (o.owner || pda).toString(), amount: BigInt(amount), delegate: null, state: o.state ?? 1, isNative: false,
    delegatedAmount: 0n, closeAuthority: o.closeAuthority ? o.closeAuthority.toString() : null, dataLen: o.dataLen || 165 } })
export const snap = (o = {}) => ({
  owner: owner.toBase58(), asset: asset.toBase58(), assetInfo: { burned: false, owner: owner.toBase58(), collection: COLL.toBase58() },
  record: record(), mintConfig: mintCfg(), sealConfig: sealCfg, burnConfig: burnCfg(),
  pool: { state: 1, amount: 1000n }, pdaLamports: 0n,
  pdaTokens: RES.map((m, i) => tok(ata(pda, m), m, 1000 * (i + 1))),
  nested: [], ownerAtaExists: new Set(RES.map(m => ata(owner, m).toBase58())), nowSec: 1_900_000_000,
  // every mint readable, none freezable unless a test says so (cbBTC's real freeze authority is set below)
  ownerAtaFrozen: new Set(), mintFreeze: new Proxy({ [CBBTC.toBase58()]: kp(190).toBase58() }, { get: (t, k) => k in t ? t[k] : null }),
  tokenNames: P.tokenNames, ...o })
