import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import { Buffer } from './enc.mjs'
import { readVault, account } from './reads.mjs'
import { ata, TOKEN_PROGRAM } from './ids.mjs'
import { parseTokenAccount, absentIfDust } from './decode.mjs'

// Core TransferV1, compressionProof=None. SDK parity is tested independently.
export function moveInstruction(ids, asset, owner, recipient) {
  const k = (pubkey, isSigner = false, isWritable = false) => ({ pubkey: new PublicKey(pubkey), isSigner, isWritable })
  return new TransactionInstruction({ programId: ids.CORE, data: Buffer.from([14, 0]), keys: [k(asset, false, true), k(ids.COLL), k(owner, true, true), k(owner, true), k(recipient), k(ids.CORE), k(ids.CORE)] })
}
export function moveInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 || typeof input.asset !== 'string' || typeof input.recipient !== 'string') throw Error('Choose one vault and its receiving wallet.')
  const asset = new PublicKey(input.asset), recipient = new PublicKey(input.recipient)
  if (!PublicKey.isOnCurve(recipient.toBytes()) || recipient.equals(SystemProgram.programId) || asset.equals(recipient)) throw Error('Use a normal Solana wallet address, not a vault or program address.')
  return { asset, recipient }
}
export async function planMove(conn, ids, profile, owner, input) {
  const { asset, recipient } = moveInput(input), from = new PublicKey(owner)
  if (!ids.COLL || await conn.getGenesisHash() !== profile.expectedGenesisHash) throw Error('The initialized Bank on Solana mainnet could not be verified.')
  if (recipient.equals(from)) throw Error('The receiving wallet already owns this vault.')
  const destination = await account(conn, recipient)
  if (destination && (!destination.owner.equals(SystemProgram.programId) || destination.executable || destination.data.length)) throw Error('That address is not an ordinary Solana receiving wallet.')
  const v = await readVault(conn, ids, asset)
  if (!v.info || v.info.burned || v.info.owner !== owner || v.info.collection !== ids.COLL.toBase58() || !v.record || v.record.retired || v.record.asset !== input.asset) throw Error('The connected wallet does not own this live Bank vault.')
  const held = []
  for (const mint of Object.keys(profile.tokenNames)) {
    const a = absentIfDust(await account(conn, ata(ids.depositAddress(asset), mint))), t = a ? parseTokenAccount(a.data) : null
    if (t && (!a.owner.equals(TOKEN_PROGRAM) || t.owner !== ids.depositAddress(asset).toBase58() || t.mint !== mint)) throw Error('The vault reserves could not be verified.')
    held.push({ mint, raw: String(t?.amount || 0) })
  }
  return { ixs: [moveInstruction(ids, asset, from, recipient)], details: { sender: owner, recipient: input.recipient, vault_no: Number(v.record.mint_index) + 1, level: v.record.level, held, active: v.record.active, pending: v.record.pending },
    acks: [{ id: 'move_whole_vault', text: 'I checked the full receiving address and control that wallet. The whole vault and access to its reserves move there. This is not a sale, no payment is received, and recorded votes do not reset. The transfer cannot be reversed by the Bank.' }] }
}
