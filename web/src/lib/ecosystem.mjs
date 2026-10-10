/** Public statements use measured state only. Value change includes deposits. */
export function chairmanStatement(index, now = Math.floor(Date.now() / 1000)) {
  if (!index || !Number.isFinite(index.generated_at) || now - index.generated_at > 1800) return 'The current return is unavailable. The Bank will not substitute an estimate.'
  const n = index.totals.minted, opened = index.totals.opened
  if (!index.collection) return 'The register is prepared. No vault has been issued. The Bank will record each issuance when it occurs.'
  if (opened) return `${opened.toLocaleString('en-US')} vault${opened === 1 ? ' has' : 's have'} been retired. ${index.bank?.released ? 'The released reserves are recorded below.' : 'The reserve record remains under review.'} An opening cannot be reversed.`
  const full = index.levels?.find(l => l.minted === l.cap && l.cap > 0)
  if (full) return `Level ${['I', 'II', 'III', 'IV', 'V'][full.level - 1]} has reached its issuance limit. The limit has not been revised. The remaining register is shown below.`
  if (n === 1) return 'The first vault has been entered in the register. Its reserves may be inspected. They may not be removed while it remains sealed.'
  if (n) return `${n.toLocaleString('en-US')} vault${n === 1 ? ' is' : 's are'} on the register. The Bank reports what they hold. It makes no representation about tomorrow.`
  if (index.charter_opens_at && now >= index.charter_opens_at && now < index.charter_opens_at + 604800) return 'The charter window is open. One eligible Proof of Burn may be exchanged for one vault. The window lasts seven days.'
  return 'No vault has been issued. The register remains open to inspection.'
}

export function historyWindow(points, days, now = Date.now() / 1000) {
  return (points || []).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] <= now && p[0] >= now - days * 86400)
}

export const validAsset = value => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value || '')
export const vaultLink = asset => validAsset(asset) ? `/market/?a=${encodeURIComponent(asset)}` : '/market/'

export function bankTotals(vaults, config = null, poolSats = null) {
  const held = { cbBTC: 0n, GARY: 0n, GIRAFFISH: 0n }
  const stranded = { cbBTC: 0n, GARY: 0n, GIRAFFISH: 0n }
  const paid = { cbBTC: 0n, GARY: 0n, GIRAFFISH: 0n }
  let missing = 0
  for (const v of vaults) {
    for (const k of Object.keys(stranded)) stranded[k] += BigInt(v.stranded?.[k] || 0)
    if (v.status === 'opened' && (!v.opened || v.opened.coverage === 'unavailable')) { missing++; continue }
    const amounts = v.status === 'opened' ? v.opened.paid : v.reserves
    for (const s of Object.keys(held)) (v.status === 'opened' ? paid : held)[s] += BigInt(amounts?.[s] ?? 0)
  }
  const strings = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]))
  const owed = config ? (BigInt(config.owed_scaled ?? 0) + 999999999999n) / 1000000000000n : null
  return { stranded: strings(stranded), held: strings(held), released: missing ? null : strings(paid), release_gaps: missing,
    pool_sats: poolSats === null ? null : String(poolSats), owed_sats: owed === null ? null : String(owed),
    available_sats: poolSats === null || owed === null ? null : String(BigInt(poolSats) > owed ? BigInt(poolSats) - owed : 0n),
    active: config ? Number(config.active_count ?? 0) : 0, joining: config ? Number(config.pending_count ?? 0) : 0,
    bare_burns: config ? Number(config.bare_burns_retired ?? 0) : 0,
    last_sweep_at: config ? Number(config.last_sweep_at) : null,
    last_distribution_at: config ? Number(config.last_distribute_at) : null }
}
