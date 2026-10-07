/**
 * THE LAUNCH CEREMONY (SPEC road step 10), as pure functions:
 *   valuesFrom(launch json)   -> the initialize arguments, typed;
 *   judgeRehearsal(values)    -> the initialize BOUNDS only (local and rehearsal
 *                                profiles; mainnet uses check-launch-params'
 *                                judgeLaunch itself, see pages/ceremony.mjs);
 *   STEPS                     -> each step's transaction and, after it lands,
 *                                the exact on-chain state it must have produced.
 *
 * A step is DONE when its account exists AND every field equals the ruled value.
 * It is BROKEN when the account exists and any ruled field differs: nothing can
 * ever rewrite these accounts, so the page stops for good and says which field.
 */
import { Keypair, PublicKey } from '@solana/web3.js'
import { SITE } from '../config.js'
import bs58 from 'bs58'
import { Buffer } from './enc.mjs'
import { ata } from './ids.mjs'
import * as IX from './ix.mjs'

const SOL = 1_000_000_000

/** The initialize arguments, from launch/mainnet-init.json's shape. */
export function valuesFrom(p) {
  const v = k => p?.[k]?.value
  const opens = Number(v('charter_opens_at'))
  return {
    initAuthority: v('init_authority'), guardian: v('guardian'), bankTreasury: v('bank_treasury'),
    paymentMint: v('payment_mint'), reserveMints: v('reserve_mints'), pobCollection: v('pob_collection'),
    pobRootHex: v('pob_root'), pobRoot: v('pob_root') ? Buffer.from(v('pob_root'), 'hex') : null,
    maxSupply: v('max_supply'), levelCaps: v('level_caps'), charterSecs: v('charter_secs'),
    charterOpensAt: opens, charterClosesAt: opens + Number(v('charter_secs')),
    monthlySecs: v('monthly_secs'), noticeSecs: v('notice_secs'), sweepFloorLamports: v('sweep_floor_lamports'),
    cooldownCeilingSecs: v('cooldown_ceiling_secs'), reserveCeilingLamports: v('reserve_ceiling_lamports'),
    solReserveLamports: v('sol_reserve_lamports'), maxSweepLamports: v('max_sweep_lamports'),
    sweepCooldownSecs: v('sweep_cooldown_secs'), swapOperator: v('swap_operator'),
    vaultCollection: v('vault_collection'), redeemWindowSecs: v('redeem_window_secs'), quorumBps: v('quorum_bps'), thresholdBps: v('threshold_bps'),
    minVotingSecs: v('min_voting_secs'), lockDeadline: v('lock_deadline'), cbobMint: v('cbob_mint'),
    maxBoostWeight: v('max_boost_weight'), maxBoostEpochs: v('max_boost_epochs'),
  }
}

const isKey = k => { try { return typeof k === 'string' && bs58.decode(k).length === 32 && k !== '11111111111111111111111111111111' } catch { return false } }
const onCurve = k => { try { return PublicKey.isOnCurve(new PublicKey(k).toBytes()) } catch { return false } }

/**
 * THE ONE VALUE THE CEREMONY ITSELF CREATES. launch/mainnet-init.json carries
 * `vault_collection` OPEN until step 0 has made the collection, and
 * scripts/check-launch-params.mjs refuses any OPEN value. So the ceremony judges a
 * COPY in which that one field holds the collection this ceremony is using (or,
 * before step 0, a throwaway address standing in for it) and nothing else
 * changes: the page refuses exactly when the checker would refuse the file once
 * Gary records the address. A value already in the file must BE that collection.
 */
export function launchWithCollection(json, collection) {
  const copy = JSON.parse(JSON.stringify(json))
  const cur = copy.vault_collection?.value
  if (cur && collection && cur !== collection) return { json: null, conflict: `launch/mainnet-init.json names the vault collection ${cur}, but this ceremony is using ${collection}` }
  if (!cur && collection) copy.vault_collection = { value: collection, status: 'RULED', source: 'the collection this ceremony created (step 0); record it in launch/mainnet-init.json' }
  return { json: copy, conflict: null }
}

/** NOT the mainnet gate. The bounds each initialize enforces, so a local or
 *  rehearsal run fails here rather than on chain. SPEC item 53's rehearsal mode
 *  of check-launch-params.mjs is not built; this is not it. */
export function judgeRehearsal(p, nowSec) {
  const out = []
  const need = (ok, why) => { if (!ok) out.push(why) }
  for (const [k, e] of Object.entries(p || {})) if (!k.startsWith('_') && (e?.value === null || e?.value === undefined)) out.push(`${k} is OPEN`)
  if (out.length) return out
  const v = valuesFrom(p)
  for (const k of ['initAuthority', 'guardian', 'bankTreasury', 'paymentMint', 'pobCollection', 'swapOperator', 'cbobMint'])
    need(isKey(v[k]), `${k} is not a real public key`)
  for (const k of ['initAuthority', 'guardian', 'swapOperator']) need(onCurve(v[k]), `${k} is off-curve: it could never sign`)
  need(Array.isArray(v.reserveMints) && v.reserveMints.length >= 1 && v.reserveMints.length <= 3 && v.reserveMints.every(isKey), 'reserve_mints must be 1 to 3 keys')
  need(v.reserveMints?.includes(v.paymentMint), 'payment_mint must be a reserve mint')
  need(v.cbobMint !== v.paymentMint, 'cbob_mint must not be the payment mint')
  need(Number(v.maxSupply) > 0, 'max_supply must be non-zero')
  need(Array.isArray(v.levelCaps) && v.levelCaps.length === 5 && v.levelCaps.every(c => Number.isInteger(c) && c > 0)
    && v.levelCaps.reduce((a, b) => a + b, 0) <= Number(v.maxSupply), 'level_caps: five non-zero counts summing to at most max_supply')
  need(/^[0-9a-f]{64}$/.test(v.pobRootHex || '') && !/^0+$/.test(v.pobRootHex), 'pob_root must be 32 non-zero bytes of hex')
  need(v.charterClosesAt > v.charterOpensAt && Number(v.charterSecs) <= 90 * 86400, 'the charter window must be 1 s to 90 days')
  need(v.charterClosesAt > nowSec, 'the charter window would already be over at initialize')
  need(v.monthlySecs >= 60 && v.monthlySecs <= 30 * 86400, 'monthly_secs must be 60 s to 30 days')
  need(v.noticeSecs >= 60 && v.noticeSecs <= 30 * 86400, 'notice_secs must be 60 s to 30 days')
  need(v.maxSweepLamports >= 1 * SOL && v.maxSweepLamports <= 50 * SOL, 'max_sweep_lamports must be 1-50 SOL')
  need(v.sweepCooldownSecs >= 1 && v.sweepCooldownSecs <= 86400, 'sweep_cooldown_secs must be 1 s to 24 h')
  need(v.solReserveLamports === 0 || v.solReserveLamports >= 890_880, 'sol_reserve_lamports must be 0 or at least 890,880')
  need(v.sweepFloorLamports >= 0.1 * SOL && v.sweepFloorLamports <= v.maxSweepLamports, 'sweep_floor_lamports must be 0.1 SOL to the per-sweep cap')
  need(v.cooldownCeilingSecs >= v.sweepCooldownSecs && v.cooldownCeilingSecs <= 7 * 86400, 'cooldown_ceiling_secs out of range')
  need(v.reserveCeilingLamports >= v.solReserveLamports && v.reserveCeilingLamports >= 890_880 && v.reserveCeilingLamports <= 10 * SOL, 'reserve_ceiling_lamports out of range')
  need(Number.isInteger(v.maxBoostWeight) && v.maxBoostWeight >= 1 && v.maxBoostWeight <= 12, 'max_boost_weight must be 1-12')
  need(Number.isInteger(v.maxBoostEpochs) && v.maxBoostEpochs >= 1 && v.maxBoostEpochs <= 63, 'max_boost_epochs must be 1-63')
  need(v.redeemWindowSecs >= 10 && v.redeemWindowSecs <= 86400, 'redeem_window_secs must be 10 s to 24 h')
  need(v.quorumBps >= 500 && v.quorumBps <= 10000, 'quorum_bps must be 500-10,000')
  need(v.thresholdBps > 5000 && v.thresholdBps <= 7500, 'threshold_bps must be above 5,000 and at most 7,500')
  need(v.minVotingSecs >= 60 && v.minVotingSecs <= 30 * 86400, 'min_voting_secs must be 60 s to 30 days')
  return out
}

// ── what each account must hold after its step ──

const eq = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => eq(x, b[i]))
  return String(a) === String(b)
}
const compare = (got, want) => Object.entries(want).filter(([k, w]) => !eq(got?.[k], w))
  .map(([k, w]) => `${k} is ${JSON.stringify(Array.isArray(got?.[k]) ? got[k].map(String) : String(got?.[k]))}, the ruled value is ${JSON.stringify(Array.isArray(w) ? w.map(String) : String(w))}`)
const bumpOf = (seed, prog) => PublicKey.findProgramAddressSync([Buffer.from(seed)], prog)[1]
const zeros = n => Array(n).fill(0)

export function expectSeal(ids, v) {
  return { version: 2, collection: ids.COLL.toBase58(), reserve_mints: v.reserveMints, bump: bumpOf('config', ids.SEAL_PROG) }
}
export function expectMint(ids, v) {
  const D = '11111111111111111111111111111111'
  return {
    version: 6, collection: ids.COLL.toBase58(), governance: ids.GOV_PDA.toBase58(),
    pool_ata: ata(ids.MINT_CFG, v.paymentMint).toBase58(), round_id: 0, opens_at: 0, closes_at: 0, price: 0, cap: 0,
    minted_this_round: 0, minted_total: 0, max_supply: v.maxSupply, bank_treasury: v.bankTreasury, split_bps: 8500,
    sales_stopped: false, sweep_stopped: false, guardian: v.guardian, swap_operator: v.swapOperator,
    sol_reserve_lamports: v.solReserveLamports, bump: bumpOf('mint-config', ids.MINT_PROG), max_sweep_lamports: v.maxSweepLamports,
    sweep_cooldown_secs: v.sweepCooldownSecs, last_sweep_at: 0, level_caps: v.levelCaps, level_minted: zeros(5),
    revealed_total: 0, payment_mint: v.paymentMint, pob_collection: v.pobCollection, pob_root: v.pobRootHex,
    charter_opens_at: v.charterOpensAt, charter_closes_at: v.charterClosesAt, charter_claimed: 0, bare_burns_retired: 0,
    total_active_weight: 0, active_count: 0, acc_scaled: 0, owed_scaled: 0,
    // max(now, charter_closes_at) at initialize, and initialize refuses unless now < charter_closes_at
    last_distribute_at: v.charterClosesAt, sales_stopped_at: 0, sweep_stopped_at: 0,
    pending_swap_operator: D, pending_swap_operator_at: 0, monthly_secs: v.monthlySecs, pending_guardian: D,
    pending_guardian_set: false, pending_guardian_at: 0, notice_secs: v.noticeSecs, sweep_floor_lamports: v.sweepFloorLamports,
    cooldown_ceiling_secs: v.cooldownCeilingSecs, reserve_ceiling_lamports: v.reserveCeilingLamports, dist_epoch: 0,
    pending_count: 0, pending_this_epoch: 0, cbob_mint: v.cbobMint, max_boost_weight: v.maxBoostWeight,
    max_boost_epochs: v.maxBoostEpochs, boost_price: 0, boost_weight: 0, boost_epochs: 0, boosts_active: 0, boosts_due: 0,
    boost_weight_total: 0, cbob_burned_total: 0, boost_expiring: zeros(64),
  }
}
export function expectBurn(ids, v) {
  return { version: 4, collection: ids.COLL.toBase58(), bump: bumpOf('burn-config', ids.BURN_PROG), burned_total: 0,
    redeem_window_secs: v.redeemWindowSecs, rate_head: 0, rate_ring: zeros(64) }
}
export function expectGov(ids, v) {
  return { version: 4, collection: ids.COLL.toBase58(), quorum_bps: v.quorumBps, threshold_bps: v.thresholdBps,
    min_voting_secs: v.minVotingSecs, proposal_count: 0, bump: bumpOf('gov-config', ids.GOV_PROG),
    last_round_id: 0, last_guardian_id: 0, last_arm_id: 0, last_boost_id: 0 }
}
/** The collection after MINT initialize: ours, and carrying exactly the 10% royalty. */
export function checkCollectionAfterMint(ids, coll) {
  const bad = []
  if (coll.pluginsUnreadable) return ['its plugins could not be read']
  if (coll.updateAuthority !== ids.MINT_AUTH.toBase58()) bad.push('the collection\'s update authority is not MINT\'s PDA')
  const r = coll.plugin('Royalties')
  if (coll.plugins.length !== 1 || !r) bad.push(`the collection carries ${coll.plugins.map(x => x.type).join(', ') || 'no plugin'}, not exactly the royalty`)
  else {
    if (r.authority.type !== 'None') bad.push(`the royalty's authority is ${r.authority.type}, not None (it could be changed)`)
    if (r.body.basisPoints !== 1000) bad.push(`the royalty is ${r.body.basisPoints} basis points, not 1,000`)
    if (r.body.creators.length !== 1 || r.body.creators[0].address !== ids.REVENUE.toBase58() || r.body.creators[0].percentage !== 100)
      bad.push('the royalty\'s creator is not the revenue address at 100%')
    if (r.body.ruleSet !== 0) bad.push('the royalty carries a rule set')
  }
  if (coll.plugins.externalCount) bad.push('the collection carries an external plugin')
  return bad
}
/** The collection is the one step 0 creates: our name, our metadata link, MINT's PDA. */
export function checkCollectionIdentity(ids, coll) {
  const bad = []
  if (coll.pluginsUnreadable) bad.push('its plugins could not be read')
  if (coll.name !== SITE.collectionName) bad.push(`its name is "${coll.name}", not "${SITE.collectionName}"`)
  if (coll.uri !== SITE.collectionUri) bad.push(`its metadata link is ${coll.uri}, not ${SITE.collectionUri}`)
  if (coll.updateAuthority !== ids.MINT_AUTH.toBase58()) bad.push(`its update authority is ${coll.updateAuthority}, not MINT's PDA`)
  return bad
}
/** Before MINT initialize: the collection MINT will accept (clean, ours, unminted). */
export function checkCollectionBeforeMint(ids, coll) {
  const bad = []
  if (coll.updateAuthority !== ids.MINT_AUTH.toBase58()) bad.push(`its update authority is ${coll.updateAuthority}, not MINT's PDA ${ids.MINT_AUTH.toBase58()} (MINT refuses it)`)
  if (coll.hasPluginHeader) bad.push('it already carries plugins (MINT refuses it)')
  if (coll.numMinted !== 0 || coll.currentSize !== 0) bad.push('something has already been minted into it')
  return bad
}
/** A cbBTC account the pool, the revenue address or the Squads needs. */
export function checkTokenAccount(t, mint, owner) {
  const bad = []
  if (t.mint !== mint) bad.push(`its mint is ${t.mint}`)
  if (t.owner !== owner) bad.push(`its owner is ${t.owner}`)
  if (t.state !== 1) bad.push(t.state === 2 ? 'it is FROZEN' : 'it is not initialized')
  if (t.delegate) bad.push('it has a delegate')
  if (t.closeAuthority) bad.push('it has a close authority')
  if (t.dataLen !== 165) bad.push('it is not a classic token account')
  return bad
}

export { compare }

/** The ordered steps. `r` = what reads.mjs found for this step. */
export const STEPS = [
  { id: 'collection', title: 'Create the vault collection (step 0)',
    describe: (ids) => [`Name: ${SITE.collectionName}`, `Metadata: ${SITE.collectionUri}`,
      `Update authority: MINT's PDA ${ids.MINT_AUTH.toBase58()} (no wallet ever holds it)`,
      'No plugins: MINT initialize installs the 10% royalty, and refuses a collection that arrives with any plugin',
      'A new address is generated in this browser and signs once, here; its key is never needed again and is not kept',
      'You pay the rent'],
    /** Generates the collection's keypair; the caller signs with ctx.newCollection too. */
    build: (ids, a, v, ctx) => { ctx.newCollection = Keypair.generate()
      return [IX.coreCreateCollection(ids, ctx.newCollection.publicKey, ids.MINT_AUTH, a, SITE.collectionName, SITE.collectionUri)] } },
  { id: 'seal', title: 'Initialize SEAL',
    describe: (ids, v) => [`Vault collection: ${ids.COLL.toBase58()}`, `The three reserve assets, fixed forever: ${v.reserveMints.join(', ')}`],
    build: (ids, a, v) => [IX.sealInit(ids, a, ids.COLL, v.reserveMints)] },
  { id: 'mint', title: 'Initialize MINT',
    describe: (ids, v) => [
      `The 15% goes to ${v.bankTreasury}, the 85% to the pool ${ata(ids.MINT_CFG, v.paymentMint).toBase58()}`,
      `Guardian ${v.guardian}; swap bot key ${v.swapOperator}`,
      `Swap bot: at most ${v.maxSweepLamports / SOL} SOL per sweep, every ${v.sweepCooldownSecs / 3600} hours, keeping ${v.solReserveLamports / SOL} SOL; a vote may only tighten, to no less than ${v.sweepFloorLamports / SOL} SOL, ${v.cooldownCeilingSecs / 3600} hours, ${v.reserveCeilingLamports / SOL} SOL`,
      `${v.maxSupply} vaults at most; levels I to V capped at ${v.levelCaps.join(' / ')}`,
      `Paid in ${v.paymentMint}; Proof of Burn collection ${v.pobCollection}, root ${v.pobRootHex}`,
      `Charter window ${new Date(v.charterOpensAt * 1000).toISOString()} to ${new Date(v.charterClosesAt * 1000).toISOString()}`,
      `A payout every ${v.monthlySecs / 86400} days; ${v.noticeSecs / 86400} days of notice before a new guardian or swap bot key`,
      `$CBOB mint ${v.cbobMint}; a boost at most +${v.maxBoostWeight} weight for at most ${v.maxBoostEpochs} payouts`,
      'The collection royalty is fixed at 10% to the revenue address, for ever'],
    build: (ids, a, v) => [IX.mintInit(ids, a, { ...v, collection: ids.COLL })] },
  { id: 'burn', title: 'Initialize BURN',
    describe: (ids, v) => [`Openings limited to 2.1% of sealed vaults per ${v.redeemWindowSecs / 60} minutes`],
    build: (ids, a, v) => [IX.burnInit(ids, a, ids.COLL, v.redeemWindowSecs)] },
  { id: 'gov', title: 'Initialize GOV',
    describe: (ids, v) => [`Quorum ${v.quorumBps / 100}%, threshold ${v.thresholdBps / 100}%, votes open at least ${v.minVotingSecs / 86400} days`],
    build: (ids, a, v) => [IX.govInit(ids, a, ids.COLL, v.quorumBps, v.thresholdBps, v.minVotingSecs)] },
  { id: 'atas', title: 'Create the three cbBTC accounts (SPEC item 52)',
    describe: (ids, v, ctx) => [`The pool: ${ata(ids.MINT_CFG, v.paymentMint).toBase58()} (owner MINT config ${ids.MINT_CFG.toBase58()})`,
      `The revenue address's own: ${ata(ids.REVENUE, v.paymentMint).toBase58()} (owner ${ids.REVENUE.toBase58()})`,
      `The CBOBTC Squads': ${ata(ctx.squads, v.paymentMint).toBase58()} (owner ${ctx.squads})`],
    build: (ids, a, v, ctx) => [[ids.MINT_CFG], [ids.REVENUE], [new PublicKey(ctx.squads)]]
      .filter(([o]) => !ctx.existing?.has(ata(o, v.paymentMint).toBase58()))
      .map(([o]) => IX.createAtaIdempotent(a, ata(o, v.paymentMint), o, v.paymentMint)) },
  { id: 'fund', title: 'Fund the revenue address above rent exemption',
    describe: (ids, v, ctx) => [`Send ${ctx.shortfall ?? '?'} lamports to ${ids.REVENUE.toBase58()} so it holds at least ${ctx.rent0 ?? '?'} (rent exemption for a 0-byte account on this cluster)`],
    build: (ids, a, v, ctx) => ctx.shortfall > 0 ? [IX.systemTransfer(a, ids.REVENUE, ctx.shortfall)] : [] },
]

// ── is each program the real build? (the ceremony's first screen) ──

/** The deployed ProgramData against the audited bytes: the first `len` bytes of
 *  the program hash to `sha256` and every byte after them is zero (SPEC road
 *  step 9's `solana program dump` check). */
export function judgeProgramBytes(pd, expected, sha256Hex) {
  if (!expected) return ['no audited sha256 is configured for this program on this profile, so its bytes were NOT checked']
  const bad = []
  if (pd.elf.length < expected.len) bad.push(`the deployed program is ${pd.elf.length} bytes, shorter than the audited ${expected.len}`)
  else {
    const h = sha256Hex(pd.elf.subarray(0, expected.len))
    if (h !== expected.sha256) bad.push(`the deployed program hashes to ${h}, not the audited ${expected.sha256}`)
    for (let i = expected.len; i < pd.elf.length; i++) if (pd.elf[i] !== 0) { bad.push(`the deployed program has non-zero bytes after the audited ${expected.len}`); break }
  }
  return bad
}

/** A probe instruction's simulated answer: a real CBOB Anchor program refuses an
 *  unknown instruction with InstructionFallbackNotFound (101); the sweep helper
 *  refuses data other than [0] with InvalidInstructionData; the launch
 *  placeholder refuses EVERYTHING with Custom(0) and logs "CBOB placeholder". */
export function judgeProbe(kind, sim) {
  const logs = sim.logs || []
  if (logs.some(l => /CBOB placeholder/.test(l))) return ['it is still the launch PLACEHOLDER (road step 9 not done)']
  const e = sim.err?.InstructionError?.[1]
  if (kind === 'anchor') return e && typeof e === 'object' && e.Custom === 101 ? [] : [`it did not answer like the CBOB program (got ${JSON.stringify(sim.err)})`]
  return e === 'InvalidInstructionData' ? [] : [`it did not answer like the sweep helper (got ${JSON.stringify(sim.err)})`]
}
