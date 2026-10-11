/** Read-only public governance register. Retain the previous file on any failed read. */
import fs from 'node:fs'
import { Connection } from '@solana/web3.js'
import { decode } from './layout.mjs'
import { PROFILES } from '../web/src/config.js'
import { makeIds } from '../web/src/lib/ids.mjs'
import { acctDisc } from '../web/src/lib/enc.mjs'
import { readProposal, readVote, proposalAddress, voteAddress } from '../web/src/lib/governance.mjs'
export async function governanceIndex(conn, profile = PROFILES.mainnet) {
  const ids = makeIds(profile), generated_at = Math.floor(Date.now() / 1000)
  if (!ids.COLL) return { generated_at, initialized: false, config: null, proposals: [], votes: [], charter_closes_at: null }
  if (await conn.getGenesisHash() !== profile.expectedGenesisHash) throw new Error('Wrong governance network')
  const configs = await conn.getMultipleAccountsInfo([ids.GOV_CFG, ids.MINT_CFG], 'confirmed')
  if (!configs[0]?.owner.equals(ids.GOV_PROG) || !configs[1]?.owner.equals(ids.MINT_PROG)) throw new Error('Governance configuration unavailable')
  const g = decode('GovConfig', configs[0].data), m = decode('MintConfig', configs[1].data)
  if (g.collection !== ids.COLL.toBase58() || m.collection !== g.collection || m.governance !== ids.GOV_PDA.toBase58()) throw new Error('Governance collection mismatch')
  const rows = await conn.getProgramAccounts(ids.GOV_PROG, { commitment: 'confirmed' }), proposals = [], votes = []
  for (const { pubkey, account } of rows) {
    if (!account.owner.equals(ids.GOV_PROG)) throw new Error('Governance account owner mismatch')
    if (account.data.subarray(0, 8).equals(acctDisc('Proposal'))) {
      const p = readProposal(account.data)
      if (!pubkey.equals(proposalAddress(ids, p.id))) throw new Error('Proposal address mismatch')
      proposals.push({ ...p, address: pubkey.toBase58() })
    } else if (account.data.subarray(0, 8).equals(acctDisc('VoteRecord'))) {
      const v = readVote(account.data)
      if (!pubkey.equals(voteAddress(ids, v.proposal, v.asset))) throw new Error('Vote address mismatch')
      votes.push({ ...v, address: pubkey.toBase58() })
    }
  }
  // A non-atomic read may observe a new proposal after its count. Retry next run.
  if (BigInt(proposals.length) !== g.proposal_count) throw new Error('Governance register changed during reading')
  const counts = new Map(proposals.map(p => [p.address, { yes: 0n, no: 0n }]))
  for (const v of votes) {
    const count = counts.get(v.proposal)
    if (!count) throw new Error('Vote proposal is missing')
    count[v.support ? 'yes' : 'no']++
  }
  for (const p of proposals) {
    const count = counts.get(p.address)
    if (count.yes !== BigInt(p.yes) || count.no !== BigInt(p.no)) throw new Error('Governance tally changed during reading')
  }
  return { generated_at: Math.floor(Date.now() / 1000), initialized: true, charter_closes_at: String(m.charter_closes_at), config: { quorum_bps: g.quorum_bps, threshold_bps: g.threshold_bps, min_voting_secs: String(g.min_voting_secs) }, proposals: proposals.sort((a,b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1), votes }
}
export async function publishGovernance(site) {
  let conn = null
  if (PROFILES.mainnet.collection) {
    const rpc = fs.readFileSync('/opt/gary-club/.env.local','utf8').match(/^HELIUS_RPC_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g,'')
    if (!rpc) throw new Error('Governance RPC is not configured')
    conn = new Connection(rpc, 'confirmed')
  }
  const data = await governanceIndex(conn), file = `${site}/data/governance.json`, tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file)
  console.log(`Governance register: ${data.proposals.length} proposals; ${data.votes.length} votes`)
}
