/**
 * The vault page's two actions, as pure functions of what was read:
 *   * RESCUE (MINT rescue_nested): a vault inside a vault's deposit address (its
 *     own, a burned vault's, or a live vault's) is moved by anyone to MINT config
 *     bank_treasury, the CBOBTC Squads, which returns it to whoever sent it in.
 *   * ACTIVATE (MINT activate): the first call asks to join (level drawn, live,
 *     its own cbBTC account holds at least 21,000 sats); the second call joins,
 *     once a distribution has run since the request.
 * Each returns { ok, why, ... } and never guesses a destination.
 */
import { PublicKey } from '@solana/web3.js'
import { ata } from './ids.mjs'
import * as IX from './ix.mjs'

export const ACTIVATION_SATS = 21_000n

/**
 * RESCUE, exactly as MINT `rescue_nested` decides it (Gary's ruling, 2026-10-07):
 * the vault always goes to MINT config bank_treasury (the CBOBTC Squads, which
 * returns it to whoever sent it in), and only when the address holding it is the
 * deposit address of the vault ITSELF, of a burned NFT (a Core tombstone), or of a
 * LIVE vault of our collection. Any other holder (a foreign NFT, a collection, an
 * address that never existed) is refused, as MINT refuses it (HostUnresolved).
 *
 * @param vaultInfo         parseCoreAsset of the vault
 * @param host              candidate holder address (the vault itself is tried first)
 * @param hostInfo          parseCoreAsset of the holder, or null when it is absent or unreadable
 * @param hostOwnerProgram  the holder account's owner program (base58), or null
 */
export function planRescue(ids, mintConfig, vault, vaultInfo, host, hostInfo, hostOwnerProgram, payer) {
  const v = new PublicKey(vault)
  if (!vaultInfo || vaultInfo.burned) return { ok: false, why: 'This vault no longer exists.' }
  if (vaultInfo.collection !== ids.COLL.toBase58()) return { ok: false, why: 'This NFT is not a vault of the Bank collection.' }
  const self = ids.depositAddress(v).toBase58()
  let h = host ? new PublicKey(host) : null
  if (vaultInfo.owner === self) h = v
  if (!h) return { ok: false, why: 'This vault is held by an address that is not its own deposit address. Paste the vault whose deposit address holds it.' }
  if (ids.depositAddress(h).toBase58() !== vaultInfo.owner)
    return { ok: false, why: `That NFT's deposit address is ${ids.depositAddress(h).toBase58()}, not the address that holds this vault (${vaultInfo.owner}).` }
  let kind
  if (h.equals(v)) kind = 'self'
  else if (hostOwnerProgram === ids.CORE.toBase58() && hostInfo?.burned) kind = 'burned-host'
  else if (hostOwnerProgram === ids.CORE.toBase58() && hostInfo && !hostInfo.burned && hostInfo.collection === ids.COLL.toBase58()) kind = 'live-host'
  else return { ok: false, why: 'This vault is held by the wallet of something that is not a vault of the Bank (or no longer readable). The program only rescues a vault from a vault, so it cannot move this one.' }
  const dest = mintConfig.bank_treasury
  return { ok: true, kind, host: h.toBase58(), dest, ix: IX.rescueNested(ids, v, h, new PublicKey(dest), new PublicKey(payer)) }
}

/** @param vaultToken parsed classic token account of the vault's cbBTC ATA, or null */
export function planActivate(ids, mintConfig, vault, vaultInfo, record, vaultToken) {
  const v = new PublicKey(vault)
  const pool = new PublicKey(mintConfig.pool_ata)
  const token = ata(ids.depositAddress(v), mintConfig.payment_mint)
  const build = () => IX.activate(ids, v, token, pool)
  if (!record) return { ok: false, why: 'The Bank has no record for this vault.' }
  if (record.retired) return { ok: false, why: 'This vault is retired.' }
  if (record.active) return { ok: false, why: 'This vault is already activated and earning.' }
  if (!vaultInfo || vaultInfo.burned || vaultInfo.collection !== ids.COLL.toBase58()) return { ok: false, why: 'This vault is not live.' }
  if (record.pending) {
    if (BigInt(mintConfig.dist_epoch) > BigInt(record.request_epoch)) return { ok: true, step: 'join', ix: build() }
    return { ok: false, why: 'This vault has asked to join and joins at the next payout. Nothing to do until then (anyone can also join it then).' }
  }
  if (!(record.level >= 1 && record.level <= 5)) return { ok: false, why: 'This vault\'s level has not been drawn yet. The draw is recorded automatically, usually within minutes.' }
  const bal = vaultToken ? vaultToken.amount : 0n
  if (vaultToken && vaultToken.state === 2) return { ok: false, why: 'This vault\'s cbBTC account is frozen by Coinbase, so it cannot activate until Coinbase unfreezes it.' }
  if (!vaultToken || vaultToken.state !== 1) return { ok: false, why: 'This vault does not hold any cbBTC yet. It activates at 21,000 sats.' }
  if (bal < ACTIVATION_SATS) return { ok: false, why: `This vault holds ${bal} sats of cbBTC. It activates at 21,000 sats.` }
  return { ok: true, step: 'request', ix: build() }
}
