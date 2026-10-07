/**
 * Phantom, on desktop (the extension) and inside Phantom's in-app browser on a
 * phone. The page asks it only to CONNECT and to SIGN; it never asks it to send.
 */
import { PublicKey } from '@solana/web3.js'
import { PHANTOM_BROWSE } from '../config.js'

export function provider(profile) {
  if (typeof window === 'undefined') return null
  if (profile.allowTestWallet && window.cbobTestWallet) return window.cbobTestWallet
  const p = window.phantom?.solana
  if (p?.isPhantom) return p
  if (window.solana?.isPhantom) return window.solana
  return null
}

export const isPhone = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/** Phantom's documented browse link for THIS page (its own address, at run time). */
export const openInPhantomLink = () => `${PHANTOM_BROWSE}${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`

export async function connectWallet(profile) {
  const p = provider(profile)
  if (!p) throw new Error('No Phantom wallet was found in this browser.')
  const r = await p.connect()
  const key = r?.publicKey || p.publicKey
  if (!key) throw new Error('Phantom did not share a wallet address.')
  return { publicKey: new PublicKey(key.toString()), signTransaction: tx => p.signTransaction(tx), provider: p }
}
