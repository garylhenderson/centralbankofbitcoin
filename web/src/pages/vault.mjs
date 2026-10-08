/**
 * /vault/ : VAULT LOOKUP. Read-only until the holder presses Activate or Rescue.
 *
 * Reads: SEAL, MINT and BURN configs; the vault NFT (Core AssetV1); its record
 * (MINT ["vault", asset]); every token account its deposit address owns (both
 * token programs); the deposit address's SOL; the Core NFTs inside it; and, for
 * a vault held by another vault's deposit address, that host.
 * Writes (each signed and paid by any connected wallet): MINT activate, MINT
 * rescue_nested.
 */
import { PublicKey } from '@solana/web3.js'
import { activeProfile } from '../config.js'
import { makeIds, ata } from '../lib/ids.mjs'
import { connect, readConfigs, readVault, vaultWalletAccounts, coreAssetsOwnedBy, findHostOf, account, mintDecimals, ReadError } from '../lib/reads.mjs'
import { parseCoreAsset } from '../lib/decode.mjs'
import { owedSats } from '../lib/plan-redeem.mjs'
import { planRescue, planActivate } from '../lib/plan-vault.mjs'
import { buildTx, simulate, signExact, sendSigned, setProgramNames } from '../lib/tx.mjs'
import { connectWallet, provider, isPhone, openInPhantomLink } from '../lib/wallet.mjs'
import { $, el, clear, addr, box, amount, LEVELS, action, getParam } from '../lib/ui.mjs'
import { drawBlock } from './draw.mjs'

const P = activeProfile()
const out = $('#result')
let wallet = null

function boot() {
  const input = $('#asset')
  const q = getParam('a')
  if (q) input.value = q
  $('#lookup').addEventListener('submit', e => { e.preventDefault(); lookup(input.value.trim()) })
  if (q) lookup(q)
}

const parseKey = s => { try { const k = new PublicKey(s); return k.toBase58() === s ? k : null } catch { return null } }

async function lookup(s) {
  clear(out)
  const asset = parseKey(s)
  if (!asset) { out.append(box('refuse', 'That is not a Solana address. Paste the vault NFT\'s address (its mint address on a marketplace).')); return }
  try { history.replaceState(null, '', `?a=${asset.toBase58()}`) } catch { /* not fatal */ }
  out.append(box('note', 'Reading the vault from the network...'))
  try { render(await read(asset)) } catch (e) {
    clear(out); out.append(box('refuse', e instanceof ReadError ? e.message : `Could not read this vault: ${String(e?.message || e)}`))
  }
}

async function read(asset) {
  let ids
  try { ids = makeIds(P) } catch (e) { throw new ReadError(e.message) }
  if (!ids.COLL) throw new ReadError('This page is not configured yet: the vault collection is a TODO in web/src/config.js. It will not guess one.')
  setProgramNames(P.programs)
  const conn = connect(P)
  const cfg = await readConfigs(conn, ids)
  const { info, record } = await readVault(conn, ids, asset)
  if (!info) throw new ReadError('There is no NFT at that address on this network.')
  if (info.burned) return { ids, conn, cfg, asset, info, record, burned: true }
  if (info.collection !== ids.COLL.toBase58()) throw new ReadError('That NFT is not a vault of the Central Bank of Bitcoin. Check the address.')
  const pda = ids.depositAddress(asset)
  const [wallet, pdaAcct] = await Promise.all([vaultWalletAccounts(conn, pda, cfg.seal.reserve_mints), account(conn, pda, 'the deposit address')])
  const tokens = wallet.tokens, tokensIncomplete = wallet.incomplete
  let nested = null, nestedErr = null
  try { nested = await coreAssetsOwnedBy(P, conn, ids, pda) } catch (e) { nestedErr = e.message }
  const decimals = await mintDecimals(conn, cfg.seal.reserve_mints)
  // who holds it?
  const owner = info.owner, self = owner === pda.toBase58()
  let host = null, hostInfo = null, hostOwnerProgram = null, ownerKind = 'wallet'
  if (self) { ownerKind = 'self'; host = asset.toBase58() }
  else if (owner === cfg.mint.bank_treasury) ownerKind = 'treasury'
  else if (!PublicKey.isOnCurve(new PublicKey(owner).toBytes())) {
    ownerKind = 'offcurve'
    host = await findHostOf(P, conn, ids, owner).catch(() => null)
    if (host) ownerKind = 'nested'
  }
  if (host && !self) {
    const h = await account(conn, host, 'the vault that holds this one')
    hostOwnerProgram = h ? h.owner.toBase58() : null
    if (h && h.owner.equals(ids.CORE)) { try { hostInfo = parseCoreAsset(h.data) } catch { hostInfo = null } }
  }
  return { ids, conn, cfg, asset, info, record, pda, tokens, tokensIncomplete, lamports: pdaAcct?.lamports ?? 0, nested, nestedErr, decimals, ownerKind, host, hostInfo, hostOwnerProgram }
}

function render(r) {
  clear(out)
  const { ids, cfg, info, record } = r
  if (r.burned) { out.append(box('note', 'This vault has been opened (or burned). It no longer exists.')); return }
  const name = m => P.tokenNames?.[m] || m
  const lvl = record && record.level >= 1 && record.level <= 5 ? `Level ${LEVELS[record.level - 1]}` : 'Not drawn yet'
  const sealed = info.plugin('PermanentFreezeExecute')
  const status = !record ? 'No record (not a Bank vault?)' : record.retired ? 'Retired' : record.active ? 'Activated: earning from every payout'
    : record.pending ? 'Asked to join: it joins at the next payout' : 'Not activated yet (it activates at 21,000 sats of cbBTC)'
  const facts = el('dl', { class: 'facts' },
    el('dt', {}, 'Vault'), el('dd', {}, addr(r.asset.toBase58())),
    el('dt', {}, 'Level'), el('dd', {}, lvl, el('br'), el('small', {}, 'Read from the Bank\'s own record for this vault (the MINT program\'s vault record), not from the NFT\'s name, picture or traits, which whoever minted it chose.')),
    el('dt', {}, 'Owner'), el('dd', {}, addr(info.owner)),
    el('dt', {}, 'Sealed'), el('dd', {}, info.pluginsUnreadable ? 'Could not be read from this NFT just now.' : sealed?.body ? (sealed.body.frozen ? 'Yes. Nothing can leave it until it is opened.' : 'NO. The seal is off, which should never happen outside an opening.') : 'No seal found on this NFT.'),
    el('dt', {}, 'Payouts'), el('dd', {}, status),
  )
  out.append(facts)
  if (record?.active) {
    const owed = owedSats(record, cfg.mint)
    out.append(box('note', `Credited to this vault and not yet delivered: about ${owed.toLocaleString('en-US')} sats of cbBTC. A payout due right now, or a boost ending, can change this; it is delivered into the vault by the next claim, and the redeem page collects it when you open the vault.`))
  }

  // ── the deposit address ──
  out.append(el('h2', {}, 'Deposit address'))
  out.append(box('deposit',
    el('p', {}, 'Send cbBTC, $GARY or $GIRAFFISH to this address to fill the vault:'),
    addr(r.pda.toBase58()),
    el('p', {}, el('strong', {}, 'This is NOT the NFT\'s own address. '), 'It is the vault\'s wallet (Metaplex Core\'s signer address for this NFT). Tokens sent to the NFT\'s own address are not in the vault.'),
    el('p', {}, el('strong', {}, 'Never send the vault NFT itself, or any other NFT or vault, to a deposit address. '), 'Other tokens and NFTs can be lost when the vault is opened: the redeem page takes out what it can (with the SOL) and names, before you sign, everything there that it cannot; anything that arrives after that check is lost. If a vault has been sent into a deposit address by mistake, the Rescue button on its own page moves it to the Bank\'s multisig, which returns it to whoever sent it in.')))

  // ── what it holds ──
  out.append(el('h2', {}, 'What it holds'))
  const list = el('dl', { class: 'facts' })
  for (const m of cfg.seal.reserve_mints) {
    const a = ata(r.pda, m).toBase58()
    const t = r.tokens.find(x => x.address === a)
    const bal = t?.parsed ? t.parsed.amount : 0n
    list.append(el('dt', {}, name(m)), el('dd', {}, `${amount(bal, r.decimals[m])}${t?.parsed?.state === 2 ? ' (FROZEN by the token issuer)' : ''}`))
  }
  list.append(el('dt', {}, 'SOL'), el('dd', {}, amount(r.lamports, 9)))
  out.append(list)
  const others = r.tokens.filter(t => !cfg.seal.reserve_mints.some(m => ata(r.pda, m).toBase58() === t.address) && (!t.parsed || t.parsed.amount > 0n || t.dataLen !== 165))
  if (others.length) out.append(box('warn', `This vault also owns ${others.length} other token account(s). Only cbBTC, $GARY and $GIRAFFISH belong in a vault. The redeem page shows what it can take out for you and what would be destroyed.`))
  if (r.tokensIncomplete) out.append(box('warn', r.tokensIncomplete.unlisted ? 'Could not list the other token accounts this vault wallet owns just now. The three balances above were read directly.'
    : `This vault wallet owns ${r.tokensIncomplete.unexamined} more token account(s) than this page examines. The three balances above were read directly.`))
  if (r.nestedErr) out.append(box('warn', `Could not check for NFTs inside this vault: ${r.nestedErr}`))
  else if (r.nested?.incomplete?.unlisted) out.append(box('warn', 'Could not check for NFTs inside this vault just now (the network did not list them in full).'))
  if (r.nested?.incomplete?.unexamined) out.append(box('warn', `The deposit address holds ${r.nested.incomplete.unexamined} more NFT(s) than this page examines.`))
  if (!r.nestedErr && r.nested?.assets.length) out.append(box('warn', `The deposit address holds ${r.nested.assets.length} NFT(s): ${r.nested.assets.map(a => a.address).join(', ')}. ${r.nested.how === 'index' ? '(Found with an index, which can lag the chain.)' : ''} A vault inside can be rescued from its own page; any other NFT is destroyed when this vault is opened.`))

  // ── actions ──
  const actions = el('div', {})
  out.append(el('h2', {}, 'Actions'), actions)
  const act = planActivate(ids, cfg.mint, r.asset, info, record, (() => { const t = r.tokens.find(x => x.address === ata(r.pda, cfg.mint.payment_mint).toBase58()); return t?.parsed || null })())
  if (act.ok) actions.append(el('p', {}, act.step === 'join' ? 'A payout has run since this vault asked to join. Anyone can now join it (free apart from the network fee).' : 'This vault holds enough cbBTC to activate. Anyone can ask for it to join the payouts (free apart from the network fee).'),
    act.note ? box('warn', act.note) : null,
    action(act.step === 'join' ? 'Join the payouts' : 'Activate', () => send([act.ix], 'Activation', actions), { out: actions }))
  else actions.append(box('note', act.why))

  if (record && !(record.level >= 1 && record.level <= 5)) drawBlock(actions, { conn: r.conn, ids, getWallet, asset: r.asset })
  if (r.ownerKind === 'treasury') actions.append(box('note', 'This vault is with the Bank\'s multisig, the CBOBTC treasury, after a rescue. The multisig returns it to whoever sent it in. Its level, its seal and everything it holds stay with it.'))
  if (r.ownerKind === 'self' || r.ownerKind === 'nested' || r.ownerKind === 'offcurve') rescueBlock(r, actions)
  actions.append(el('p', {}, el('a', { href: `../redeem/?a=${r.asset.toBase58()}` }, 'Open this vault (owner only)')))
}

function rescueBlock(r, actions) {
  const { ids, cfg, info } = r
  const why = r.ownerKind === 'self'
    ? 'This vault has been sent into its OWN deposit address. Nobody can sign for it there, so it can never be opened as it is.'
    : r.ownerKind === 'nested' ? `This vault is inside another vault's deposit address (vault ${r.host}). It cannot be opened from there. Rescue it below to the Bank\'s multisig, which returns it to whoever sent it in; the redeem page also offers the rescue when that vault is opened there (or it can be rescued afterwards).`
    : 'This vault is held by an address that cannot sign (a program, a DAO, a multisig, or a marketplace escrow). A vault held that way cannot be opened. If that address is the deposit address of another vault, or of an opened one, paste that vault below.'
  actions.append(box('warn', why))
  const hostIn = el('input', { type: 'text', id: 'host', placeholder: 'The vault (or Core NFT) whose deposit address holds it', autocomplete: 'off', spellcheck: 'false' })
  if (r.ownerKind === 'offcurve') actions.append(el('label', { for: 'host' }, 'Holding vault'), hostIn)
  actions.append(action('Rescue this vault', async () => {
    const w = await getWallet()
    let host = r.host, hostInfo = r.hostInfo, hostOwnerProgram = r.hostOwnerProgram
    if (r.ownerKind === 'offcurve') {
      const k = parseKey(hostIn.value.trim()); if (!k) throw new Error('Paste the address of the vault that holds this one.')
      host = k.toBase58()
      const h = await account(r.conn, host, 'that vault')
      hostOwnerProgram = h ? h.owner.toBase58() : null
      hostInfo = h && h.owner.equals(ids.CORE) ? parseCoreAsset(h.data) : null
    }
    const plan = planRescue(ids, cfg.mint, r.asset, info, host, hostInfo, hostOwnerProgram, w.publicKey)
    if (!plan.ok) throw new Error(plan.why)
    actions.append(box('note', `The rescue moves this vault to the Bank's multisig, the CBOBTC treasury (${plan.dest}), which returns it to whoever sent it in. Its level, its seal and everything it holds and has earned stay with it. Any wallet may send the rescue; it costs only the network fee.`))
    await send([plan.ix], 'Rescue', actions)
  }, { out: actions }))
}

async function getWallet() {
  if (wallet) return wallet
  if (!provider(P)) {
    if (isPhone()) throw Object.assign(new Error('Open this page inside the Phantom app to sign.'), { link: openInPhantomLink() })
    throw new Error('No Phantom wallet was found. Install the Phantom browser extension, or open this page in the Phantom app.')
  }
  wallet = await connectWallet(P)
  return wallet
}

async function send(ixs, what, where) {
  const w = await getWallet()
  const conn = connect(P)
  const { tx, blockhash, lastValidBlockHeight } = await buildTx(conn, ixs, w.publicKey)
  const sim = await simulate(conn, tx)
  if (sim.err) { where.append(box('refuse', `${what} would fail, so nothing was sent: ${sim.explained}`)); return }
  where.append(box('note', `${what}: the network's dry run passed. Approve it in Phantom.`))
  const signed = await signExact(w, tx)
  const sig = await sendSigned(conn, signed, blockhash, lastValidBlockHeight)
  where.append(box('ok', `${what} done. Transaction: `, el('code', {}, sig)))
}

document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot()
