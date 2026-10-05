#!/usr/bin/env node
/**
 * THE LAUNCH VALUES, CHECKED BEFORE THEY ARE WRITTEN.
 *
 * Every value the four `initialize` calls take is written ONCE and, once the
 * upgrade authority is removed, can never be corrected (SPEC accepted limits 38
 * and 39). The alarm's `test_value_in_production` only fires AFTER a wrong value
 * is on chain, which is too late. So `launch/mainnet-init.json` is the one place
 * the launch values live, and this refuses it unless:
 *   * nothing is still OPEN (null);
 *   * every value Gary ruled equals the alarm's production list exactly (the SAME
 *     list, imported from bank/detectors.mjs, so the two cannot disagree);
 *   * every value passes the bounds each program's `initialize` enforces, so the
 *     signing ceremony cannot be the first place a refusal is discovered;
 *   * the swap bot's values sit inside the alarm's working band (a value that is
 *     legal but pages every pass is a launch mistake too);
 *   * the Proof of Burn root is recomputed from scripts/pob-set.json, not trusted.
 *
 *   node scripts/check-launch-params.mjs              # judge launch/mainnet-init.json
 *   node scripts/check-launch-params.mjs --selftest   # prove it refuses each bad value
 */
import fs from 'fs'
import { fileURLToPath } from 'url'
import bs58 from 'bs58'
import { PublicKey } from '@solana/web3.js'
import * as D from '../bank/detectors.mjs'
import * as L from '../bank/layout.mjs'
import { rootOf } from './pob-merkle.mjs'

const SOL = 1_000_000_000
const RENT_EXEMPT_0_BYTES = 890_880   // MINT and GOV's constant (stricter than mainnet's rent)
const isKey = k => { try { return typeof k === 'string' && bs58.decode(k).length === 32 } catch { return false } }
/** Round 23 (L8): a key that must SIGN must be a keypair, not a program address. */
const onCurve = k => { try { return PublicKey.isOnCurve(new PublicKey(k).toBytes()) } catch { return false } }
/** Round 23 (L17): the dedicated release wallet holding the whole $CBOB supply. */
export const CBOB_RELEASE_WALLET = 'AT2qf412jXWksizKUYCUVp7D36inN9T13FMG1YfVJLm1'

/** Every reason the values would be refused or regretted. Empty = launchable. */
export function judgeLaunch(p, { nowSec = Math.floor(Date.now() / 1000), pobSet } = {}) {
  const v = k => p?.[k]?.value
  const out = []
  const need = (ok, why) => { if (!ok) out.push(why) }
  for (const [k, e] of Object.entries(p || {})) {
    if (k.startsWith('_')) continue
    if (e?.value === null || e?.value === undefined) out.push(`${k} is OPEN: ${e?.source ?? 'no value'}`)
  }
  if (out.length) return out   // nothing else is judgeable on missing values

  // ── THE RULED VALUES, PINNED HERE, NOT READ FROM THE FILE BEING JUDGED (round
  //    22, A7: the file's own values were only checked for shape, so a census of
  //    900/500/300/200/100 or a foreign treasury passed). Same constants the alarm
  //    pins in production.
  const PINS = [
    ['init_authority', D.GUARDIAN_AT_LAUNCH], ['guardian', D.GUARDIAN_AT_LAUNCH], ['bank_treasury', D.CBOBTC_SQUADS],
    ['payment_mint', D.CBBTC_MINT], ['reserve_mints', D.RESERVE_MINTS.join(',')], ['pob_root', D.POB_ROOT],
    ['pob_collection', D.POB_COLLECTION], ['max_supply', '2100'], ['level_caps', '945,525,315,210,105'],
    ['charter_secs', '604800'], ['monthly_secs', '2592000'], ['notice_secs', '604800'], ['redeem_window_secs', '3600'],
    ['quorum_bps', '2100'], ['threshold_bps', '5100'], ['min_voting_secs', '259200'], ['sweep_floor_lamports', '1000000000'],
    ['cooldown_ceiling_secs', '86400'], ['reserve_ceiling_lamports', '100000000'],
    // Gary 2026-10-03 by text ("2 - yes"): the swap bot's starting values.
    ['max_sweep_lamports', '10000000000'], ['sweep_cooldown_secs', '21600'], ['sol_reserve_lamports', '50000000'],
    // Gary 2026-10-04 (chat): the $CBOB boost's ceilings, which no vote may pass.
    ['max_boost_weight', '12'], ['max_boost_epochs', '24'],
    // Created on mainnet 2026-10-04; mint and freeze authority none. The alarm's
    // production list pins the same constant.
    ['cbob_mint', D.CBOB_MINT],
    // Round 23 (L8): the swap operator was exempt from the RULED check (a leftover
    // from when it was OPEN) and not pinned, so a PROPOSED or foreign key passed.
    // Generated 2026-10-04 and ruled; it is the one hot key, so it is pinned.
    ['swap_operator', 'bipP7uK5aQDsrChYA8hpZ1Thb8BCw7emRGuEkLkHg6G'],
    // Round 23 (L17): custody of the whole $CBOB supply is a ruled fact, pinned
    // so the record cannot drift from the wallet that holds it.
    ['cbob_release_wallet', CBOB_RELEASE_WALLET],
  ]
  for (const [k, want] of PINS) need(String(v(k)) === want, `${k} is ${JSON.stringify(v(k))}, not the ruled ${want}`)
  // Round 24 (I4): NO EXEMPTIONS. The two dates were exempt from RULED (a leftover
  // from when they could only be OPEN), so a date filled in and still marked
  // PROPOSED, or OPEN with a value, passed. Every value is Gary's ruling or nothing.
  for (const [k, e] of Object.entries(p)) if (!k.startsWith('_') && e?.status !== 'RULED')
    out.push(`${k} is marked ${e?.status}, not RULED`)
  // ── the lock: immutable BEFORE the charter opens, so nothing ever holds value
  //    under an upgradeable program ──
  need(Number(v('lock_deadline')) > nowSec, 'lock_deadline must be in the future')
  need(Number(v('lock_deadline')) < Number(v('charter_opens_at')), 'lock_deadline must fall BEFORE the charter window opens: no value is ever held under an upgradeable program')
  // Round 24 (I4): road step 6 says the deadline is 24 h BEFORE the opening, and
  // nothing enforced the margin, so a deadline one second before passed.
  need(Number(v('charter_opens_at')) - Number(v('lock_deadline')) >= 86400, 'lock_deadline must be at least 24 hours before charter_opens_at (road step 6): the lock is verified before anything can mint')

  // ── keys ──
  for (const k of ['init_authority', 'guardian', 'bank_treasury', 'payment_mint', 'pob_collection', 'swap_operator', 'cbob_mint', 'cbob_release_wallet'])
    need(isKey(v(k)) && v(k) !== D.DEFAULT_PUBKEY, `${k} is not a real public key`)
  // Round 23 (L8): the three keys that must SIGN a top-level instruction (the
  // initialize, the brake, the sweep) must be ON CURVE. An off-curve address
  // passed every check above and could never sign anything.
  for (const k of ['init_authority', 'guardian', 'swap_operator'])
    need(onCurve(v(k)), `${k} is OFF-CURVE (a program address): it could never sign`)
  need(Array.isArray(v('reserve_mints')) && v('reserve_mints').length === 3 && v('reserve_mints').every(isKey),
    'reserve_mints must be exactly the three reserve assets')
  need(v('reserve_mints')?.includes(v('payment_mint')), 'payment_mint must be one of the reserve mints (MINT initialize refuses otherwise)')
  need(v('swap_operator') !== v('guardian') && v('swap_operator') !== v('init_authority'),
    'the swap operator must be its own key: it is the one hot key, and the guardian\'s job is to stop it')

  // ── what the alarm calls production, imported so the two cannot disagree ──
  const cur = {
    'mint.split_bps': 8500, 'mint.monthly_secs': v('monthly_secs'), 'burn.redeem_window_secs': v('redeem_window_secs'),
    'mint.notice_secs': v('notice_secs'), 'gov.quorum_bps': v('quorum_bps'), 'gov.threshold_bps': v('threshold_bps'),
    'gov.min_voting_secs': v('min_voting_secs'), 'mint.sweep_floor_lamports': v('sweep_floor_lamports'),
    'mint.cooldown_ceiling_secs': v('cooldown_ceiling_secs'), 'mint.reserve_ceiling_lamports': v('reserve_ceiling_lamports'),
    'mint.max_sweep_lamports': String(v('max_sweep_lamports')), 'mint.sweep_cooldown_secs': v('sweep_cooldown_secs'),
    'mint.guardian': v('guardian'), 'mint.pending_swap_operator': D.DEFAULT_PUBKEY,
  }
  for (const f of D.detectStandingRisks(cur, { production: true })) out.push(`the alarm would page on launch: ${f.kind}: ${f.detail}`)

  // ── MINT initialize's own bounds ──
  const maxSweep = Number(v('max_sweep_lamports')), cool = Number(v('sweep_cooldown_secs')), res = Number(v('sol_reserve_lamports'))
  need(Number(v('max_supply')) > 0, 'max_supply must be non-zero')
  need(maxSweep >= 1 * SOL && maxSweep <= 50 * SOL, 'max_sweep_lamports must be 1-50 SOL')
  need(cool >= 1 && cool <= 24 * 3600, 'sweep_cooldown_secs must be 1 s to 24 h')
  need(res === 0 || res >= RENT_EXEMPT_0_BYTES, 'sol_reserve_lamports must be 0 or at least 890,880')
  const caps = v('level_caps')
  need(Array.isArray(caps) && caps.length === 5 && caps.every(c => Number.isInteger(c) && c > 0)
    && caps.reduce((a, b) => a + b, 0) <= Number(v('max_supply')), 'level_caps must be five non-zero counts summing to at most max_supply')
  const opens = Number(v('charter_opens_at')), closes = opens + Number(v('charter_secs'))
  need(Number(v('charter_secs')) > 0 && Number(v('charter_secs')) <= 90 * 86400, 'the charter window must be 1 s to 90 days')
  need(closes > nowSec, 'the charter window would already be over at initialize')
  need(opens > nowSec, 'the charter window must open in the future (holders are told the date first)')
  need(Number(v('monthly_secs')) >= 60 && Number(v('monthly_secs')) <= 30 * 86400, 'monthly_secs must be 60 s to 30 days')
  need(Number(v('notice_secs')) >= 60 && Number(v('notice_secs')) <= 30 * 86400, 'notice_secs must be 60 s to 30 days')
  const floor = Number(v('sweep_floor_lamports')), ceilCool = Number(v('cooldown_ceiling_secs')), ceilRes = Number(v('reserve_ceiling_lamports'))
  need(floor >= 0.1 * SOL && floor <= maxSweep, 'sweep_floor_lamports must be 0.1 SOL to the per-sweep cap')
  need(ceilCool >= cool && ceilCool <= 7 * 86400, 'cooldown_ceiling_secs must be the cooldown to 7 days')
  need(ceilRes >= res && ceilRes >= RENT_EXEMPT_0_BYTES && ceilRes <= 10 * SOL, 'reserve_ceiling_lamports must be the reserve (and rent) to 10 SOL')
  // ── the $CBOB boost: MINT initialize's own refusals ──
  need(![v('payment_mint'), L.GARY_MINT, ...(v('reserve_mints') || [])].includes(v('cbob_mint')),
    'cbob_mint must be its own mint: never cbBTC, $GARY or a reserve (a burn of those would buy boosts)')
  need(Number.isInteger(v('max_boost_weight')) && v('max_boost_weight') >= 1 && v('max_boost_weight') <= 12, 'max_boost_weight must be 1-12')
  need(Number.isInteger(v('max_boost_epochs')) && v('max_boost_epochs') >= 1 && v('max_boost_epochs') <= 63, 'max_boost_epochs must be 1-63 (the ring holds 63)')
  // ── BURN and GOV ──
  need(Number(v('redeem_window_secs')) >= 10 && Number(v('redeem_window_secs')) <= 86400, 'redeem_window_secs must be 10 s to 24 h')
  need(Number(v('quorum_bps')) >= 500 && Number(v('quorum_bps')) <= 10000, 'quorum_bps must be 500-10,000')
  need(Number(v('threshold_bps')) > 5000 && Number(v('threshold_bps')) <= 7500, 'threshold_bps must be above 5,000 and at most 7,500')
  need(Number(v('min_voting_secs')) >= 60 && Number(v('min_voting_secs')) <= 30 * 86400, 'min_voting_secs must be 60 s to 30 days')
  // ── the Proof of Burn set, recomputed ──
  if (pobSet) {
    need(pobSet.collection === v('pob_collection'), 'pob_collection is not the collection scripts/pob-set.json was read from')
    const root = Buffer.from(rootOf(pobSet.assets.map(a => bs58.decode(a.address)))).toString('hex')
    need(root === v('pob_root'), `pob_root does not equal the root recomputed from scripts/pob-set.json (${root})`)
    need(pobSet.assets.length === 240, 'the Proof of Burn set is not the 240 Gary ruled final')
  }
  return out
}

function selftest() {
  const base = JSON.parse(fs.readFileSync(new URL('../launch/mainnet-init.json', import.meta.url), 'utf8'))
  const pobSet = JSON.parse(fs.readFileSync(new URL('./pob-set.json', import.meta.url), 'utf8'))
  const NOW = 1_800_000_000
  const good = JSON.parse(JSON.stringify(base))
  good.charter_opens_at.value = NOW + 14 * 86400
  // The swap operator is the committed, ruled key (round 23, L8: it used to be
  // filled here with a placeholder, which only passed because nothing pinned it).
  good.lock_deadline.value = NOW + 7 * 86400
  // Filled values are RULED values (round 24, I4: the dates are no longer exempt).
  good.charter_opens_at.status = 'RULED'; good.lock_deadline.status = 'RULED'
  const R = []
  const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); R.push(ok)
    console.log(`  ${ok ? 'ok  ' : 'XX  '}${name}${ok ? '' : `\n        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`) }
  const with_ = (k, val) => { const p = JSON.parse(JSON.stringify(good)); p[k].value = val; return judgeLaunch(p, { nowSec: NOW, pobSet }) }
  t('the committed values with the two OPEN ones filled are launchable', judgeLaunch(good, { nowSec: NOW, pobSet }), [])
  t('the committed file itself is NOT launchable while anything is OPEN', judgeLaunch(base, { nowSec: NOW, pobSet }).some(x => /charter_opens_at is OPEN/.test(x)), true)
  t('BOOST: the committed file is not launchable while the boost bounds are only PROPOSED',
    (() => { const p = JSON.parse(JSON.stringify(good)); p.max_boost_weight.status = 'PROPOSED'; return judgeLaunch(p, { nowSec: NOW, pobSet }).some(x => /max_boost_weight is marked PROPOSED/.test(x)) })(), true)
  t('BOOST: a $CBOB mint that is $GARY is refused', with_('cbob_mint', '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk').some(x => /cbob_mint must be its own/.test(x)), true)
  t('BOOST: ...or cbBTC', with_('cbob_mint', 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij').some(x => /cbob_mint must be its own/.test(x)), true)
  t('BOOST: a boost ceiling other than the ruled 12 / 24 is refused',
    [with_('max_boost_weight', 6).some(x => /max_boost_weight is 6, not the ruled 12/.test(x)), with_('max_boost_epochs', 12).some(x => /not the ruled 24/.test(x))], [true, true])
  t('BOOST: a weight bound of 13 and a length bound of 64 are refused (MINT would refuse them)',
    [with_('max_boost_weight', 13).some(x => /max_boost_weight/.test(x)), with_('max_boost_epochs', 64).some(x => /max_boost_epochs/.test(x))], [true, true])
  t('a quorum other than the ruled 21% is refused', with_('quorum_bps', 2000).some(x => /test_value_in_production/.test(x)), true)
  t('a 14-day notice is refused (7 was ruled)', with_('notice_secs', 1209600).some(x => /notice/.test(x)), true)
  t('a test-length month is refused', with_('monthly_secs', 150).some(x => /monthly/.test(x)), true)
  t('a tighten floor other than the ruled 1 SOL is refused', with_('sweep_floor_lamports', 500000000).length > 0, true)
  t('a per-sweep cap under the floor is refused (MINT would refuse it at initialize)', with_('max_sweep_lamports', 900000000).length > 0, true)
  t('a cooldown above the 24 h ceiling is refused', with_('sweep_cooldown_secs', 90000).length > 0, true)
  t('a SOL reserve between 0 and rent is refused', with_('sol_reserve_lamports', 1000).length > 0, true)
  t('a charter window already over is refused', with_('charter_opens_at', NOW - 30 * 86400).length > 0, true)
  t('a payment mint that is not a reserve is refused', with_('payment_mint', 'So11111111111111111111111111111111111111112').length > 0, true)
  t('a PoB root that is not the pinned set\'s is refused', with_('pob_root', '00'.repeat(32)).some(x => /pob_root/.test(x)), true)
  t('a census that does not sum under the supply is refused', with_('level_caps', [945, 525, 315, 210, 106]).length > 0, true)
  t('the swap operator may not be the guardian', with_('swap_operator', good.guardian.value).some(x => /own key/.test(x)), true)
  t('A7: a supply of 21,000 is refused (it passed every shape check)', with_('max_supply', 21000).some(x => /max_supply/.test(x)), true)
  t('A7: a census of 900/500/300/200/100 is refused', with_('level_caps', [900, 500, 300, 200, 100]).some(x => /level_caps/.test(x)), true)
  t('A7: $GARY as the payment mint is refused', with_('payment_mint', '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk').some(x => /payment_mint/.test(x)), true)
  t('A7: a 15% destination that is not the CBOBTC Squads is refused', with_('bank_treasury', 'So11111111111111111111111111111111111111112').some(x => /bank_treasury/.test(x)), true)
  t('A7: a 14-day charter is refused', with_('charter_secs', 1209600).some(x => /charter_secs/.test(x)), true)
  t('a lock deadline AFTER the charter opens is refused (value would sit under an upgradeable program)',
    with_('lock_deadline', NOW + 30 * 86400).some(x => /BEFORE the charter/.test(x)), true)
  t('a value still marked PROPOSED is refused', (() => { const p = JSON.parse(JSON.stringify(good)); p.max_supply.status = 'PROPOSED'
    return judgeLaunch(p, { nowSec: NOW, pobSet }).some(x => /PROPOSED/.test(x)) })(), true)
  t('a cooldown the alarm would page on every pass (30 s) is refused', with_('sweep_cooldown_secs', 30).some(x => /alarm/.test(x)), true)
  // ── ROUND 23 ──
  // L7: the cbob_mint pin had no arm; removing it kept this selftest green.
  t('L7: USDC as the $CBOB mint is refused, naming the ruled mint',
    with_('cbob_mint', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v').some(x => x.includes(`not the ruled ${D.CBOB_MINT}`)), true)
  // L8: the swap operator was exempt from RULED and unpinned; off-curve keys passed.
  t('L8: a swap operator other than the ruled key is refused',
    with_('swap_operator', 'Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYc').some(x => /swap_operator is .*not the ruled bipP7/.test(x)), true)
  t('L8: ...and a swap operator still marked PROPOSED is refused',
    (() => { const p = JSON.parse(JSON.stringify(good)); p.swap_operator.status = 'PROPOSED'; return judgeLaunch(p, { nowSec: NOW, pobSet }).some(x => /swap_operator is marked PROPOSED/.test(x)) })(), true)
  t('L8: an OFF-CURVE guardian, init authority or swap operator is refused as unable to sign (the Squads vault is a PDA)',
    ['guardian', 'init_authority', 'swap_operator'].map(k => with_(k, D.CBOBTC_SQUADS).some(x => x.startsWith(`${k} is OFF-CURVE`))), [true, true, true])
  t('L8: ...while the committed on-curve keys raise no curve complaint',
    judgeLaunch(good, { nowSec: NOW, pobSet }).filter(x => /OFF-CURVE/.test(x)), [])
  // L17: custody of the whole $CBOB supply is recorded and pinned.
  t('L17: the release wallet on record is pinned (a different one is refused)',
    [with_('cbob_release_wallet', D.GUARDIAN_AT_LAUNCH).some(x => /cbob_release_wallet is .*not the ruled AT2qf412/.test(x)),
     good.cbob_release_wallet?.value === CBOB_RELEASE_WALLET], [true, true])
  // ── ROUND 24 ──
  // I4: the two dates were exempt from RULED, and the 24 h margin was unenforced.
  t('I4: a filled charter date still marked OPEN, or a lock deadline marked PROPOSED, is refused',
    ['charter_opens_at', 'lock_deadline'].map(k => { const p = JSON.parse(JSON.stringify(good)); p[k].status = k === 'lock_deadline' ? 'PROPOSED' : 'OPEN'
      return judgeLaunch(p, { nowSec: NOW, pobSet }).some(x => x.startsWith(`${k} is marked`)) }), [true, true])
  t('I4: a lock deadline under 24 h before the opening is refused; exactly 24 h passes',
    [with_('lock_deadline', good.charter_opens_at.value - 86399).some(x => /at least 24 hours/.test(x)),
     with_('lock_deadline', good.charter_opens_at.value - 86400)], [true, []])
  const ok = R.filter(Boolean).length
  console.log(`\n${ok}/${R.length} launch assertions as predicted`)
  process.exit(ok === R.length ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--selftest')) selftest()
  else {
    const p = JSON.parse(fs.readFileSync(new URL('../launch/mainnet-init.json', import.meta.url), 'utf8'))
    const pobSet = JSON.parse(fs.readFileSync(new URL('./pob-set.json', import.meta.url), 'utf8'))
    const bad = judgeLaunch(p, { pobSet })
    if (bad.length) { console.log(`NOT LAUNCHABLE (${bad.length}):`); for (const b of bad) console.log(`  - ${b}`); process.exit(1) }
    console.log('launch/mainnet-init.json: every value ruled or checked, every initialize bound met, the alarm would stay quiet')
  }
}
