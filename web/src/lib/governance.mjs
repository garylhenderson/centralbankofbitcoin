/** Public GOV records and vote instructions. Mirrors the deployed v6 layout. */
import { PublicKey, TransactionInstruction, SystemProgram } from '@solana/web3.js'
import { Buffer, acctDisc, disc, u64 } from './enc.mjs'
export const proposalAddress = (ids, id) => PublicKey.findProgramAddressSync([Buffer.from('proposal'), u64(id)], ids.GOV_PROG)[0]
export const voteAddress = (ids, proposal, asset) => PublicKey.findProgramAddressSync([Buffer.from('vote'), new PublicKey(proposal).toBuffer(), new PublicKey(asset).toBuffer()], ids.GOV_PROG)[0]
function reader(raw, name) {
  const d = Buffer.from(raw); let i = 8
  if (!d.subarray(0, 8).equals(acctDisc(name))) throw new Error('Unrecognized governance record.')
  const take = n => { if (i + n > d.length) throw new Error('Incomplete governance record.'); const b = d.subarray(i, i += n); return b }
  const r = { byte: () => take(1)[0], word: () => take(2).readUInt16LE(), count: () => take(4).readUInt32LE(), uint: () => take(8).readBigUInt64LE(), int: () => take(8).readBigInt64LE(), key: () => new PublicKey(take(32)).toBase58() }
  r.bool = () => { const v = r.byte(); if (v > 1) throw new Error('Invalid governance flag.'); return v === 1 }
  r.option = read => { const tag = r.byte(); if (tag > 1) throw new Error('Invalid governance option.'); return tag ? read() : null }
  return r
}
export function readProposal(raw) {
  const r = reader(raw, 'Proposal'), id = r.uint().toString(), n = r.count()
  if (n < 1 || n > 5) throw new Error('Invalid proposal action count.')
  const actions = []
  for (let i = 0; i < n; i++) {
    const kind = r.byte(); let a
    if (kind === 0) a = { kind: 'SetRound', opens_at: r.int().toString(), closes_at: r.int().toString(), price: r.uint().toString(), cap: r.count() }
    else if (kind === 1) a = { kind: 'Brakes', restart_sales: r.bool(), restart_sweep: r.bool(), set_guardian: r.bool(), guardian: r.option(r.key) }
    else if (kind === 2) a = { kind: 'TightenSweep', sol_reserve_lamports: r.option(r.uint)?.toString() ?? null, max_sweep_lamports: r.option(r.uint)?.toString() ?? null, sweep_cooldown_secs: r.option(r.int)?.toString() ?? null }
    else if (kind === 3) a = { kind: 'ArmSwapOperator', operator: r.key() }
    else if (kind === 4) a = { kind: 'SetBoostTerms', price: r.uint().toString(), weight: r.byte(), epochs: r.word() }
    else throw new Error('Unknown proposal action.')
    actions.push(a)
  }
  return { id, actions, voting_ends_at: r.int().toString(), yes: r.uint().toString(), no: r.uint().toString(), executed: r.bool(), bump: r.byte(), quorum_supply: r.uint().toString(), quorum_bps: r.word(), threshold_bps: r.word(), index_snapshot: r.uint().toString(), created_at: r.int().toString() }
}
export function readVote(raw) { const r = reader(raw, 'VoteRecord'); return { proposal: r.key(), asset: r.key(), support: r.bool(), bump: r.byte() } }
export function tally(p, now) {
  const yes = BigInt(p.yes), no = BigInt(p.no), supply = BigInt(p.quorum_supply), cast = yes + no
  const ceil = (n, d) => (n + d - 1n) / d
  const quorum = ceil(supply * BigInt(p.quorum_bps), 10000n), minimumYes = ceil(supply, 10n)
  const keyChange = p.actions.some(a => a.kind === 'ArmSwapOperator' || (a.kind === 'Brakes' && a.set_guardian))
  const requiredYes = keyChange ? ceil(supply, 2n) : minimumYes
  const passes = quorum > 0n && minimumYes > 0n && cast > 0n && cast >= quorum && yes * 10000n >= cast * BigInt(p.threshold_bps) && yes >= requiredYes
  const status = p.executed ? 'Executed' : now < Number(p.voting_ends_at) ? 'Voting open' : !passes ? 'Did not pass' : now > Number(p.voting_ends_at) + 604800 ? 'Expired unexecuted' : 'Ready to execute'
  return { status, passes, cast: String(cast), quorum: String(quorum), requiredYes: String(requiredYes), keyChange }
}
export const actionTitle = a => ({ SetRound: 'Set a sale round', Brakes: 'Change the brakes', TightenSweep: 'Tighten swap limits', ArmSwapOperator: 'Replace the swap operator', SetBoostTerms: 'Set boost terms' })[a.kind] || 'Unknown action'
export function castVoteIx(ids, proposal, asset, owner, support) {
  if (typeof support !== 'boolean') throw new Error('Choose Yes or No.')
  const k = (pubkey, isSigner = false, isWritable = false) => ({ pubkey: new PublicKey(pubkey), isSigner, isWritable })
  return new TransactionInstruction({ programId: ids.GOV_PROG, data: Buffer.concat([disc('cast_vote'), Buffer.from([support ? 1 : 0])]), keys: [k(ids.GOV_CFG), k(proposal, false, true), k(voteAddress(ids, proposal, asset), false, true), k(asset), k(ids.vaultRecord(asset)), k(owner, true), k(owner, true, true), k(SystemProgram.programId)] })
}
