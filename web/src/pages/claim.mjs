import { mountCharterStatus } from '../lib/charter-status.mjs'
import { mountClubAction } from '../lib/club-actions.mjs'
/**
 * /claim/ : THE CHARTER CLAIM. One Proof of Burn the wallet holds is burned and
 * one vault is created, in one transaction, inside the 7-day charter window.
 *
 * Reads: MINT config (window, supply, PoB collection and root, pool); every one of
 * the 240 Proofs of Burn in scripts/pob-set.json (getMultipleAccounts, no index
 * needed); the Proof of Burn collection; the cluster clock.
 * Writes: MINT claim_charter_vault, NO crank, NO pass-through accounts (a Proof of
 * Burn or collection carrying an external plugin is refused, SPEC item 46), signed
 * by the wallet (owner and payer) and by the new vault's address, made here.
 */
import { Keypair } from '@solana/web3.js'
import POB_SET from '../generated/pob-set.json' with { type: 'json' }
import { activeProfile, SITE } from '../config.js'
import { makeIds } from '../lib/ids.mjs'
import { connect, readConfigs, accounts, account, chainNow, ReadError, checkNewAddress, TAKEN_NOTE } from '../lib/reads.mjs'
import { parseCoreAsset, parseCoreCollection } from '../lib/decode.mjs'
import { planClaim, readPobs } from '../lib/plan-get.mjs'
import { buildForWallet, signExact, sendSigned, setProgramNames } from '../lib/tx.mjs'
import { connectWallet, provider, isPhone, openInPhantomLink } from '../lib/holder-wallet.mjs'
import { $, el, clear, addr, box, action, amount } from '../lib/ui.mjs'
import { showNewVault } from './draw.mjs'

const P = activeProfile()
const out = $('#result')
let wallet = null, ids = null

function boot() {
  mountCharterStatus()
  if (mountClubAction('claim', P)) return
  $('#connect').addEventListener('click', go)
  if (!provider(P)) $('#wallet').append(isPhone()
    ? box('note', 'To sign on a phone, open this page in your wallet app. Phantom is one option. ', el('a', { class: 'btn', href: openInPhantomLink() }, 'Open in Phantom'))
    : box('note', 'Connect a compatible Solana wallet extension, or open this page inside your wallet app.'))
}

async function go() {
  clear(out)
  try {
    try { ids = makeIds(P) } catch (e) { throw new ReadError(e.message) }
    if (!ids.COLL) throw new ReadError('The Bank is not open yet: its vault collection does not exist.')
    setProgramNames(P.programs)
    wallet = await connectWallet(P)
    out.append(el('p', {}, 'Connected: ', addr(wallet.publicKey.toBase58())))
    out.append(box('note', 'Looking for your Proofs of Burn...'))
    await show()
  } catch (e) { out.append(box('refuse', e instanceof ReadError ? e.message : String(e?.message || e))) }
}

async function read(conn) {
  const [cfg, nowSec, pobs, pc] = await Promise.all([readConfigs(conn, ids), chainNow(conn),
    readPobs(conn, accounts, ids, POB_SET, parseCoreAsset), account(conn, POB_SET.collection, 'the Proof of Burn collection')])
  let pobCollection = null
  if (pc && pc.owner.equals(ids.CORE)) { try { pobCollection = parseCoreCollection(pc.data) } catch { pobCollection = null } }
  return { mintConfig: cfg.mint, nowSec, owner: wallet.publicKey.toBase58(), pobSet: POB_SET, pobs, pobCollection }
}

async function show() {
  const conn = connect(P)
  const s = await read(conn)
  let kp = Keypair.generate()
  let plan = planClaim(ids, SITE, s, kp.publicKey)
  clear(out)
  out.append(el('p', {}, 'Connected: ', addr(wallet.publicKey.toBase58())))
  if (!plan.ok) { for (const r of plan.refuse) out.append(box('refuse', r)); return }
  out.append(el('h2', {}, 'Your Proofs of Burn'))
  let chosen = plan.pick.address
  const list = el('div', {})
  for (const p of plan.mine) {
    const r = el('input', { type: 'radio', name: 'pob', id: `pob-${p.address}`, value: p.address })
    if (p.address === chosen) r.checked = true
    r.addEventListener('change', () => { chosen = p.address })
    list.append(el('div', { class: 'ack' }, r, el('label', { for: `pob-${p.address}` }, `Proof of Burn #${p.edition}`, el('br'), el('code', {}, p.address))))
  }
  out.append(list, el('p', {}, `Each Proof of Burn can be exchanged for one vault, once. The window closes ${new Date(Number(s.mintConfig.charter_closes_at) * 1000).toLocaleString('en-US', { timeZone: 'America/Chicago' }) + ' Austin time'}.`))
  const area = el('div', {})
  out.append(area)
  area.append(action('Prepare my claim', async () => {
    clear(area)
    // Round 42 (C12): reuse the key unless it landed or a stranger funded it first.
    const na = await checkNewAddress(conn, ids, kp, () => Keypair.generate())
    if (na.state === 'landed') { area.append(box('note', 'Your earlier claim already landed; it is not repeated.')); showNewVault(area, { conn, ids, asset: kp.publicKey, getWallet: async () => wallet }, '(an earlier transaction)'); return }
    if (na.state === 'taken') { kp = na.kp; area.append(box('note', TAKEN_NOTE(na.was))) }
    const fresh = await read(conn)
    plan = planClaim(ids, SITE, fresh, kp.publicKey, chosen)
    if (!plan.ok) { for (const r of plan.refuse) area.append(box('refuse', r)); return }
    const before = await account(conn, wallet.publicKey)
    const { tx, blockhash, lastValidBlockHeight, size, sim, minUnits } = await buildForWallet(conn, [plan.ix], wallet.publicKey, [wallet.publicKey])
    if (sim.err) { area.append(box('refuse', `The network's dry run refused this claim, so nothing was signed: ${sim.explained}`), el('pre', { class: 'logs' }, sim.logs.join('\n'))); return }
    const cost = before && sim.accounts[0] ? BigInt(before.lamports) - BigInt(sim.accounts[0].lamports) : null
    area.append(el('h2', {}, 'What you sign'), el('dl', { class: 'facts' },
      el('dt', {}, 'Burned'), el('dd', {}, `Proof of Burn #${plan.pick.edition}`, el('br'), el('code', {}, plan.pick.address)),
      el('dt', {}, 'Created'), el('dd', {}, `A new vault named "${plan.name}"`, el('br'), el('code', {}, kp.publicKey.toBase58())),
      el('dt', {}, 'Its details'), el('dd', {}, el('code', {}, plan.uri)),
      el('dt', {}, 'Cost'), el('dd', {}, cost === null ? 'the network fee and the rent of the new accounts' : `about ${amount(cost, 9)} SOL (network fee and the rent of the new accounts)`)),
      box('note', `Dry run passed (${size} bytes, ${sim.unitsConsumed ?? '?'} compute units). The Proof of Burn and the vault change hands in one all-or-nothing step: if anything fails, nothing is burned.`))
    area.append(action('Sign and claim my vault', async () => {
      const signed = await signExact(wallet, tx, [kp], { minUnits })
      const sig = await sendSigned(conn, signed, blockhash, lastValidBlockHeight)
      clear(area)
      showNewVault(area, { conn, ids, asset: kp.publicKey, getWallet: async () => wallet }, sig)
    }, { out: area }))
  }, { out: area }))
}

document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot()
