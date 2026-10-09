/**
 * Shared UI: what a holder sees after getting a vault, and the level draw.
 * Used by /claim/, /buy/ and /vault/.
 */
import { PublicKey } from '@solana/web3.js'
import { readConfigs, readVault } from '../lib/reads.mjs'
import { planDraw } from '../lib/plan-get.mjs'
import { buildForWallet, signExact, sendSigned } from '../lib/tx.mjs'
import { el, addr, box, action } from '../lib/ui.mjs'

export const DRAW_EXPLAINED = 'Your level is drawn after your vault is created, from blocks that did not exist when you got it, and written onto the vault. The Bank\'s draw job does this every minute, and anyone can do it: if it is due, the button below does it now. Vaults are drawn in the order they were created.'

/** A box that reads the vault's draw state on demand and offers the one useful action. */
export function drawBlock(where, { conn, ids, getWallet, asset }) {
  const area = el('div', {})
  const refresh = async () => {
    area.textContent = ''
    const [cfg, v, slot] = await Promise.all([readConfigs(conn, ids), readVault(conn, ids, asset), conn.getSlot('confirmed')])
    const d = planDraw(ids, cfg.mint, asset, v.info, v.record, slot, (await getWallet().catch(() => null))?.publicKey || new PublicKey(asset))
    area.append(box(d.state === 'drawn' ? 'ok' : 'note', d.text))
    if (d.ix) {
      const label = d.state === 'reveal' ? 'Draw my level' : d.state === 'capture' ? 'Record my draw now' : 'Draw it again from fresh blocks'
      area.append(action(label, async () => {
        const w = await getWallet()
        const fresh = planDraw(ids, (await readConfigs(conn, ids)).mint, asset, (await readVault(conn, ids, asset)).info,
          (await readVault(conn, ids, asset)).record, await conn.getSlot('confirmed'), w.publicKey)
        if (!fresh.ix) { await refresh(); return }
        const { tx, blockhash, lastValidBlockHeight, sim, minUnits } = await buildForWallet(conn, [fresh.ix], w.publicKey)
        if (sim.err) { area.append(box('refuse', `Not possible right now, so nothing was sent: ${sim.explained}. Try again in a minute; the Bank's draw job may already be doing it.`)); return }
        const sig = await sendSigned(conn, await signExact(w, tx, [], { minUnits }), blockhash, lastValidBlockHeight)
        area.append(box('ok', 'Done. Transaction: ', el('code', {}, sig)))
        setTimeout(() => refresh().catch(() => {}), 1500)
      }, { out: area }))
    }
    area.append(action('Check again', refresh, { kind: 'secondary', out: area }))
  }
  where.append(el('h3', {}, 'Your level'), el('p', {}, DRAW_EXPLAINED), area)
  refresh().catch(e => area.append(box('refuse', String(e?.message || e))))
}

/** After a claim or a purchase lands. */
export function showNewVault(where, ctx, sig) {
  const { ids, asset } = ctx
  where.append(box('ok', el('p', {}, el('strong', {}, 'Your vault exists. '), 'Transaction: ', el('code', {}, sig)),
    el('p', {}, 'Vault: ', addr(new PublicKey(asset).toBase58())),
    el('p', {}, el('a', { href: `../vault/?a=${new PublicKey(asset).toBase58()}` }, 'Look it up (level, deposit address, what it holds)'))))
  where.append(box('deposit', el('p', {}, 'Its deposit address, where cbBTC, $GARY or $GIRAFFISH go to fill it:'), addr(ids.depositAddress(asset).toBase58()),
    el('p', {}, el('strong', {}, 'This is NOT the vault NFT\'s own address. '), 'Never send the vault NFT itself, or any other NFT, to a deposit address. It activates and starts earning once it holds 21,000 sats of cbBTC.')))
  drawBlock(where, ctx)
}
