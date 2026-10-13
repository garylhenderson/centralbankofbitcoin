// Only the confirmed MintConfig supplies counts. Opened vaults never replenish supply.
export function roundSnapshot(c) {
  if (!c || !Array.isArray(c.level_caps)) return null
  return { id: Number(c.round_id), opens_at: Number(c.opens_at), closes_at: Number(c.closes_at), price_sats: String(c.price), cap: Number(c.cap), minted: Number(c.minted_this_round), minted_total: Number(c.minted_total), max_supply: Number(c.max_supply), level_supply: c.level_caps.reduce((n, v) => n + Number(v), 0), stopped: c.sales_stopped }
}
