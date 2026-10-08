/**
 * /buy/ : A VAULT IN AN OPEN SALE ROUND. The round, its price and its size are
 * set by a community vote; this page reads them and never chooses them.
 *
 * Reads: MINT config (round, price, cap, sold, stop flag, supply, payment mint,
 * pool); the wallet's cbBTC account; the Bank's revenue cbBTC account; the clock.
 * Writes: MINT mint_vault, NO crank, max_price = the price read on chain (a vote
 * that raises it before this lands makes the mint fail instead of charging more),
 * signed by the wallet (owner and payer) and by the new vault's address, made here.
 */
import { Keypair } from '@solana/web3.js'
import { activeProfile, SITE } from '../config.js'
import { makeIds } from '../lib/ids.mjs'
import { connect, readBuySnapshot, ReadError, checkNewAddress, TAKEN_NOTE } from '../lib/reads.mjs'
import { planBuy } from '../lib/plan-get.mjs'
import { buildTx, simulate, signExact, sendSigned, setProgramNames } from '../lib/tx.mjs'
import { connectWallet, provider, isPhone, openInPhantomLink } from '../lib/wallet.mjs'
import { $, el, clear, addr, box, action, amount } from '../lib/ui.mjs'
import { showNewVault } from './draw.mjs'

const P = activeProfile()
const out = $('#result')
let wallet = null, ids = null

function boot() {
  $('#connect').addEventListener('click', go)
  if (!provider(P)) $('#wallet').append(isPhone()
    ? box('note', 'To sign on a phone, open this page inside the Phantom app. ', el('a', { class: 'btn', href: openInPhantomLink() }, 'Open in Phantom'))
    : box('note', 'This page signs with the Phantom wallet. Install the Phantom browser extension, or open this page inside the Phantom app on your phone.'))
}

const read = conn => readBuySnapshot(conn, ids, wallet.publicKey)   // round 41 C2: the read lives in lib/reads.mjs

async function go() {
  clear(out)
  try {
    try { ids = makeIds(P) } catch (e) { throw new ReadError(e.message) }
    if (!ids.COLL) throw new ReadError('The Bank is not open yet: its vault collection does not exist.')
    setProgramNames(P.programs)
    wallet = await connectWallet(P)
    out.append(el('p', {}, 'Connected: ', addr(wallet.publicKey.toBase58())))
    const conn = connect(P)
    let kp = Keypair.generate()
    let s = await read(conn)
    let plan = planBuy(ids, SITE, s, kp.publicKey)
    const c = s.mintConfig
    if (Number(c.round_id) > 0) out.append(el('dl', { class: 'facts' },
      el('dt', {}, 'Round'), el('dd', {}, `#${c.round_id}, voted by the vault holders`),
      el('dt', {}, 'Price'), el('dd', {}, `${amount(c.price, 8)} cbBTC (${BigInt(c.price).toLocaleString('en-US')} sats)`),
      el('dt', {}, 'Left in this round'), el('dd', {}, `${Math.max(0, Number(c.cap) - Number(c.minted_this_round))} of ${c.cap}`)))
    if (!plan.ok) { for (const r of plan.refuse) out.append(box('refuse', r)); return }
    const area = el('div', {}); out.append(area)
    area.append(action('Prepare my purchase', async () => {
      clear(area)
      // Round 42 (C12): reuse the key unless it landed or a stranger funded it first.
      const na = await checkNewAddress(conn, ids, kp, () => Keypair.generate())
      if (na.state === 'landed') { area.append(box('note', 'Your earlier purchase already landed; it is not repeated.')); showNewVault(area, { conn, ids, asset: kp.publicKey, getWallet: async () => wallet }, '(an earlier transaction)'); return }
      if (na.state === 'taken') { kp = na.kp; area.append(box('note', TAKEN_NOTE(na.was))) }
      s = await read(conn)
      plan = planBuy(ids, SITE, s, kp.publicKey)
      if (!plan.ok) { for (const r of plan.refuse) area.append(box('refuse', r)); return }
      const { tx, blockhash, lastValidBlockHeight, size } = await buildTx(conn, [plan.ix], wallet.publicKey)
      const sim = await simulate(conn, tx)
      if (sim.err) { area.append(box('refuse', `The network's dry run refused this purchase, so nothing was signed: ${sim.explained}`), el('pre', { class: 'logs' }, sim.logs.join('\n'))); return }
      area.append(el('h2', {}, 'What you sign'), el('dl', { class: 'facts' },
        el('dt', {}, 'You pay'), el('dd', {}, `the round price, ${amount(plan.price, 8)} cbBTC (${plan.price.toLocaleString('en-US')} sats), into the Bank's revenue address. That is the most you can pay: if a vote lowers the price before this lands you pay the lower price, and if a vote raises it the purchase is refused and nothing is paid.`),
        el('dt', {}, 'You receive'), el('dd', {}, `A new vault named "${plan.name}"`, el('br'), el('code', {}, kp.publicKey.toBase58())),
        el('dt', {}, 'Its details'), el('dd', {}, el('code', {}, plan.uri)),
        el('dt', {}, 'Also'), el('dd', {}, 'the network fee and the rent of the new accounts, in SOL')),
        box('note', `Dry run passed (${size} bytes, ${sim.unitsConsumed ?? '?'} compute units). Of every sale, 85% goes to the activated vaults and 15% to the CBOBTC treasury, fixed forever.`))
      area.append(action('Sign and buy my vault', async () => {
        const sig = await sendSigned(conn, await signExact(wallet, tx, [kp]), blockhash, lastValidBlockHeight)
        clear(area)
        showNewVault(area, { conn, ids, asset: kp.publicKey, getWallet: async () => wallet }, sig)
      }, { out: area }))
    }, { out: area }))
  } catch (e) { out.append(box('refuse', e instanceof ReadError ? e.message : String(e?.message || e))) }
}

document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot()
