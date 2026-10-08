/**
 * /redeem/ : OPEN A VAULT. The owner connects Phantom, names the vault, and the
 * page reads everything, plans the opening (lib/plan-redeem.mjs), runs the
 * coverage check BEFORE anything is offered for signature, creates any missing
 * accounts in a prior transaction, then sends ONE redemption transaction after a
 * dry run whose result it shows.
 *
 * Before the opening the page re-reads the chain and re-plans from scratch, so
 * what is signed is planned from the state of a moment ago, never from the state
 * when the page was first loaded. The sweep helper moves balances AS THEY ARE
 * when it runs, so a deposit landing in between cannot block the opening.
 *
 * Optional, before opening: trigger a payout (burns exactly 100 $GARY of the
 * owner's) so the vault takes its share of what the Bank holds undistributed,
 * expiring every due boost and joining every waiting vault first, as MINT requires.
 */
import { PublicKey } from '@solana/web3.js'
import { activeProfile } from '../config.js'
import { makeIds, ata } from '../lib/ids.mjs'
import { connect, readRedemptionSnapshot, readConfigs, mintDecimals, account, waitingVaults, dueBoostRecords, ReadError } from '../lib/reads.mjs'
import { planRedemption, planPayout } from '../lib/plan-redeem.mjs'
import { parseTokenAccount } from '../lib/decode.mjs'
import { buildTx, simulate, signExact, sendSigned, setProgramNames } from '../lib/tx.mjs'
import { connectWallet, provider, isPhone, openInPhantomLink } from '../lib/wallet.mjs'
import { $, el, clear, addr, box, amount, action, getParam } from '../lib/ui.mjs'

const P = activeProfile()
const out = $('#result')
let wallet = null, ids = null

const parseKey = s => { try { const k = new PublicKey(s); return k.toBase58() === s ? k : null } catch { return null } }
const name = m => P.tokenNames?.[m] || `token ${m}`
const GARY_BURN = 100_000_000_000n            // 100 $GARY (9 decimals), MINT's DIST_BURN

function boot() {
  const q = getParam('a'); if (q) $('#asset').value = q
  $('#connect').addEventListener('click', onConnect)
  $('#check').addEventListener('submit', e => { e.preventDefault(); check() })
  if (!provider(P)) {
    $('#wallet').append(isPhone()
      ? box('note', 'To sign on a phone, open this page inside the Phantom app. ', el('a', { class: 'btn', href: openInPhantomLink() }, 'Open in Phantom'))
      : box('note', 'This page signs with the Phantom wallet. Install the Phantom browser extension, or open this page inside the Phantom app on your phone.'))
  }
}

async function onConnect() {
  try {
    wallet = await connectWallet(P)
    $('#who').textContent = ''
    $('#who').append('Connected: ', addr(wallet.publicKey.toBase58()))
  } catch (e) { $('#wallet').append(box('refuse', String(e?.message || e))) }
}

async function freshPlan(asset, noPrior = false, dropStrays = false) {
  const conn = connect(P)
  const s = await readRedemptionSnapshot(P, conn, ids, wallet.publicKey, asset)
  s.noPrior = noPrior; s.dropStrays = dropStrays
  return { conn, s, plan: planRedemption(ids, s) }
}

async function check() {
  clear(out)
  try {
    try { ids = makeIds(P) } catch (e) { throw new ReadError(e.message) }
    if (!ids.COLL) throw new ReadError('This page is not configured yet: the vault collection is a TODO in web/src/config.js.')
    setProgramNames(P.programs)
    if (!wallet) throw new ReadError('Connect your wallet first. Only a vault\'s owner can open it.')
    const asset = parseKey($('#asset').value.trim())
    if (!asset) throw new ReadError('That is not a Solana address. Paste the vault NFT\'s address.')
    out.append(box('note', 'Reading your vault and everything in it...'))
    const { conn, s, plan } = await freshPlan(asset)
    clear(out)
    await show(conn, s, plan, asset)
  } catch (e) { clear(out); out.append(box('refuse', e instanceof ReadError ? e.message : `Could not check this vault: ${String(e?.message || e)}`)) }
}

async function show(conn, s, plan, asset) {
  const dec = await mintDecimals(conn, [...new Set([...s.sealConfig.reserve_mints, ...s.pdaTokens.filter(t => t.parsed).map(t => t.parsed.mint)])])
  out.append(el('h2', {}, 'What opening this vault does'))
  const gets = el('dl', { class: 'facts' })
  for (const m of s.sealConfig.reserve_mints) {
    const t = s.pdaTokens.find(x => x.address === ata(plan.depositAddress, m).toBase58())
    gets.append(el('dt', {}, name(m)), el('dd', {}, amount(t?.parsed?.amount ?? 0n, dec[m])))
  }
  if (plan.claim && plan.owedSats > 0n) gets.append(el('dt', {}, 'Payout owed'), el('dd', {}, `about ${plan.owedSats} sats of cbBTC, collected in the same step`))
  out.append(el('p', {}, 'Everything in the vault comes to your wallet, and the vault is destroyed, in one all-or-nothing step. You will receive at least:'), gets,
    el('p', {}, 'plus the SOL in the vault and the rent of its token accounts. Any cbBTC, $GARY, $GIRAFFISH or SOL that lands in the vault before the step runs comes to you too.'))
  for (const r of plan.refuse) out.append(box('refuse', r))
  for (const n of plan.note) out.append(box('note', n))
  if (s.nestedHow === 'index') out.append(box('note', 'The NFTs inside this vault were listed with an index, which can lag the chain by a little. Anything sent in the last minute may not show.'))
  if (plan.refuse.length) { out.append(box('refuse', 'This vault cannot be opened on this page right now. Nothing was sent.')); return }

  // ── payout first (optional) ──
  if (s.record?.active && !plan.poolFrozen) payoutBlock(conn, s)

  // ── acknowledgements ──
  const ackArea = el('div', {}); out.append(ackArea)
  const boxes = new Map()
  const addAck = a => { if (boxes.has(a.id)) return
    const c = el('input', { type: 'checkbox', id: `ack-${a.id}` })
    const card = el('div', { class: 'ack box warn' }, c, el('label', { for: `ack-${a.id}` }, a.text))
    ackArea.append(card)
    // round 37 V1: a grouped box lists its first items under it, folded
    if (a.list) ackArea.append(el('details', { class: 'ack-list' }, el('summary', {}, `Show the ${a.list.length} listed`),
      el('ul', {}, ...a.list.map(t => el('li', {}, t))), a.more ? el('p', {}, `and ${a.more} more, counted in the box above.`) : null))
    boxes.set(a.id, c) }
  if (plan.ack.length) ackArea.append(el('p', {}, 'Before you open it, read and tick each of these. Each names something that is lost when the vault is opened. The cbBTC, $GARY and $GIRAFFISH in your vault\'s own three accounts come to you in full.'))
  plan.ack.forEach(addAck)
  let priorDone = false, dropStrays = false

  // ── the steps ──
  out.append(el('h2', {}, 'Open it'))
  const steps = el('div', {})
  out.append(steps)
  if (plan.prior.length) steps.append(el('p', {}, `First, ${plan.prior.length === 1 ? 'one transaction sets' : `${plan.prior.length} transactions set`} up the accounts the opening needs:`),
    el('ul', {}, ...plan.prior.flat().map(p => el('li', {}, p.why))))
  steps.append(action(plan.prior.length ? 'Set up, then open' : 'Open this vault', async () => {
    if ([...boxes.values()].some(b => !b.checked)) throw new Error('Tick every box above first: each one names something you lose by opening now.')
    // 1. the prior transaction(s), each simulated first, once
    for (const group of priorDone ? [] : plan.prior) {
      const { tx, blockhash, lastValidBlockHeight } = await buildTx(conn, group.map(x => x.ix), wallet.publicKey)
      const sim = await simulate(conn, tx)
      if (sim.err) throw new Error(`Setting up the accounts would fail, so nothing was sent: ${sim.explained}`)
      steps.append(box('note', 'Setting up accounts: approve it in Phantom.'))
      const sig = await sendSigned(conn, await signExact(wallet, tx), blockhash, lastValidBlockHeight)
      steps.append(box('ok', 'Accounts ready. Transaction: ', el('code', {}, sig)))
    }
    priorDone = true
    // 2. re-read and re-plan NOW, never asking for another set-up transaction: what
    //    arrived since is either moved (if its account exists) or named below
    const fresh = await freshPlan(asset, true, dropStrays)
    if (fresh.plan.refuse.length || fresh.plan.prior.length) {
      steps.append(box('refuse', 'Something changed in the vault since it was checked. Nothing was opened. Check it again.'))
      for (const r of fresh.plan.refuse) steps.append(box('refuse', r))
      return
    }
    const newAcks = fresh.plan.ack.filter(a => !boxes.has(a.id))
    if (newAcks.length) {
      newAcks.forEach(addAck)
      steps.append(box('warn', 'Something new arrived in the vault since it was checked (listed above with the other items). Tick it, then press the button again. Nothing was opened.'))
      return
    }
    // 3. the dry run, showing what arrives
    const watch = [...new Set([...fresh.s.sealConfig.reserve_mints, ...fresh.plan.helperStrays.concat(fresh.plan.transferStrays)
      .map(a => fresh.s.pdaTokens.find(t => t.address === a).parsed.mint)])].map(m => ata(wallet.publicKey, m))
    const { tx, blockhash, lastValidBlockHeight, size } = await buildTx(conn, fresh.plan.redemption, wallet.publicKey)
    const pre = await Promise.all(watch.map(a => account(conn, a)))
    const sim = await simulate(conn, tx, [...watch, asset])
    if (sim.err) {
      // round 36 H1: if the opening carried extra tokens, one of them may be what failed
      // (a stranger can freeze a receiving account). Leave them ALL behind, named, and ask again.
      if (!dropStrays && (fresh.plan.helperStrays.length || fresh.plan.transferStrays.length)) {
        dropStrays = true
        const again = await freshPlan(asset, true, true)
        again.plan.ack.filter(a => !boxes.has(a.id)).forEach(addAck)
        steps.append(box('warn', 'The dry run failed while taking out the extra tokens sent into your vault, so they are now left behind and listed above. Tick them, then press the button again. Nothing was opened.'))
        return
      }
      steps.append(box('refuse', `The network's dry run of the opening failed, so nothing was sent: ${sim.explained}`), el('pre', { class: 'logs' }, sim.logs.join('\n')))
      return
    }
    const res = el('dl', { class: 'facts' })
    watch.forEach((a, i) => {
      const before = pre[i] ? parseTokenAccount(pre[i].data).amount : 0n
      const after = sim.accounts[i] ? parseTokenAccount(sim.accounts[i].data).amount : 0n
      const m = sim.accounts[i] ? parseTokenAccount(sim.accounts[i].data).mint : null
      if (m) res.append(el('dt', {}, name(m)), el('dd', {}, `+${amount(after - before, dec[m])}`))
    })
    const nft = sim.accounts[watch.length]
    const burned = !nft || (nft.data.length === 1 && nft.data[0] === 0)
    steps.append(box(burned ? 'ok' : 'refuse', burned ? `Dry run passed (${size} bytes, ${sim.unitsConsumed ?? '?'} compute units). Your wallet would receive:` : 'The dry run did not burn the vault. Nothing was sent.'), res)
    if (!burned) return
    steps.append(box('note', 'Approve the opening in Phantom. It cannot be undone.'))
    const signed = await signExact(wallet, tx)
    const sig = await sendSigned(conn, signed, blockhash, lastValidBlockHeight)
    steps.append(box('ok', 'Your vault is open: everything in it is in your wallet and the vault is destroyed. Transaction: ', el('code', {}, sig)))
  }, { out: steps }))
}

/** Expire every due boost (BoostsExpireFirst), join every vault waiting from an
 *  earlier payout (JoinWaitingFirst), then burn 100 $GARY to run one. */
function payoutBlock(conn, s) {
  const c0 = s.mintConfig
  const owedCeil = (BigInt(c0.owed_scaled) + 10n ** 12n - 1n) / 10n ** 12n
  const avail = s.pool ? s.pool.amount - owedCeil : 0n
  if (avail <= 0n) return
  const blk = el('div', {})
  out.append(el('h2', {}, 'Optional: collect a payout first'), blk)
  blk.append(el('p', {}, `The Bank holds ${avail} sats of cbBTC that have not been paid out yet. They are not yours until a payout runs. You can run one now by burning 100 $GARY from your wallet; your vault's share is then collected when you open it.`))
  blk.append(action('Run a payout (burns 100 $GARY)', async () => {
    const gAta = ata(wallet.publicKey, P.garyMint)
    const g = await account(conn, gAta, 'your $GARY')
    if (!g || parseTokenAccount(g.data).amount < GARY_BURN) throw new Error('Your wallet needs at least 100 $GARY for this.')
    const c = (await readConfigs(conn, ids)).mint   // the settings as they are NOW
    const waiting = BigInt(c.pending_count) - BigInt(c.pending_this_epoch) > 0n ? await waitingVaults(conn, ids, c.dist_epoch) : []
    const dueRecords = BigInt(c.boosts_due) > 0n ? await dueBoostRecords(conn, ids, c.dist_epoch) : []
    const pp = planPayout(ids, { mintConfig: c, waiting, dueRecords, burner: wallet.publicKey, garyMint: P.garyMint })
    if (!pp.ok) throw new Error(pp.refuse.join(' '))
    const ixs = pp.groups
    for (const group of ixs) {
      const { tx, blockhash, lastValidBlockHeight } = await buildTx(conn, group, wallet.publicKey)
      const sim = await simulate(conn, tx)
      if (sim.err) throw new Error(`The network's dry run refused it, so nothing more was sent: ${sim.explained}`)
      const sig = await sendSigned(conn, await signExact(wallet, tx), blockhash, lastValidBlockHeight)
      blk.append(box('ok', 'Done. Transaction: ', el('code', {}, sig)))
    }
    blk.append(box('ok', 'The payout ran. Check your vault again to see its share before opening it.'))
  }, { kind: 'secondary', out: blk }))
}

document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot()
