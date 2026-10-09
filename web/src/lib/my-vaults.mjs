/**
 * "SHOW ME MY VAULTS" (round 46; Gary: "It should show me my vaults and let me pick").
 * The list comes from reads.mjs vaultsOwnedBy, which verifies every vault on chain.
 * A pick only fills the address box the holder could have pasted into; the page then
 * reads that vault in full exactly as before. The paste box always stays.
 */
import { el, clear, box, LEVELS } from './ui.mjs'
import { vaultsOwnedBy } from './reads.mjs'

/** Pure: what the pick list says for a vaultsOwnedBy result (tested offline). */
export function myVaultsView(r) {
  if (!r || r.unlisted) return { kind: 'note', text: 'This page could not list the vaults in your wallet just now. Paste your vault\'s address below instead.', items: [], more: null }
  const items = r.vaults.map(v => ({ address: v.address,
    label: `${v.name || 'Vault'}, ${v.level >= 1 && v.level <= 5 ? `Level ${LEVELS[v.level - 1]}` : 'not drawn yet'}${v.active ? ', active' : ''}` }))
  const more = r.more ? 'This wallet holds more NFTs than the page reads at once. A vault not listed here can still be pasted below.' : null
  if (!items.length) return { kind: 'note', text: 'No vaults were found in this wallet. If you hold one, paste its address below.', items, more }
  return { kind: 'pick', text: items.length === 1 ? 'Your vault (pick it, or paste another address below):' : `Your ${items.length} vaults (pick one, or paste another address below):`, items, more }
}

export async function showMyVaults(container, { profile, conn, ids, owner, onPick }) {
  clear(container)
  container.append(box('note', 'Looking for the vaults in your wallet...'))
  let r = null
  try { r = await vaultsOwnedBy(profile, conn, ids, owner) } catch { r = null }
  const v = myVaultsView(r)
  clear(container)
  const kids = [el('p', {}, v.text)]
  for (const it of v.items) kids.push(el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', onclick: () => onPick(it.address) }, it.label), el('code', {}, it.address)))
  if (v.more) kids.push(el('p', {}, v.more))
  container.append(box(v.kind === 'pick' ? 'ok' : 'note', ...kids))
  return v
}
