#!/usr/bin/env node
// Fresh live-Core evidence; provider credentials never leave this process.
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { Connection, PublicKey } from '@solana/web3.js'
import { profile } from '../web/src/config.js'
try {
  const p = profile('mainnet')
  const rpc = fs.readFileSync('/opt/gary-club/.env.local', 'utf8').match(/^HELIUS_RPC_URL=(.*)$/m)?.[1]?.trim()
  if (!rpc) throw new Error('provider')
  const c = new Connection(rpc, 'finalized')
  if (await c.getGenesisHash() !== p.expectedGenesisHash) throw new Error('genesis')
  const loader = 'BPFLoaderUpgradeab1e11111111111111111111111'
  const program = await c.getAccountInfo(new PublicKey(p.core), 'finalized')
  if (!program?.executable || program.owner.toBase58() !== loader || program.data.readUInt32LE(0) !== 2) throw new Error('program')
  const address = new PublicKey(program.data.subarray(4,36))
  const pd = await c.getAccountInfo(address, 'finalized')
  if (!pd || pd.owner.toBase58() !== loader || pd.data.readUInt32LE(0) !== 3 || pd.data.subarray(45,49).toString('hex') !== '7f454c46') throw new Error('programdata')
  const bytes = pd.data.subarray(45), hash = createHash('sha256').update(bytes).digest('hex')
  const pin = fs.readFileSync(new URL('./run-tests.sh', import.meta.url), 'utf8').match(/^CORE_SHA256_EXPECTED=([a-f0-9]{64})$/m)?.[1]
  const evidence = { checked_at: Math.floor(Date.now()/1000), genesis: p.expectedGenesisHash, program: p.core, programdata: address.toBase58(), upgrade_slot: Number(pd.data.readBigUInt64LE(4)), bytes: bytes.length, sha256: hash, pinned_sha256: pin, matches: hash === pin }
  console.log(JSON.stringify(evidence, null, 2))
  if (!evidence.matches) process.exitCode = 1
} catch {
  console.error('Live Core could not be verified. No lock; inspect RPC and retry.'); process.exitCode = 1
}
