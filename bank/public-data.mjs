#!/usr/bin/env node
/** Read-only public publishing. Run under the public-data flock; no key or signer. */
import fs from 'node:fs'
import { publishGovernance } from './governance-index.mjs'
import { publishMarket } from './market-index.mjs'
import { Connection } from '@solana/web3.js'
import { run } from './vault-index.mjs'
import { generate, collectionJson } from '../web/meta/generate.mjs'
import { PROFILES } from '../web/src/config.js'
const site = process.env.CBOB_SITE_ROOT || '/var/www/centralbankofbitcoin'
await run({ dry: false }).catch(() => { console.error('Vault return not refreshed; previous record retained.'); process.exitCode = 1 })
await publishGovernance(site).catch(() => { console.error('Governance return not refreshed; previous record retained.'); process.exitCode = 1 })
await publishMarket(site).catch(() => { console.error('Market return not refreshed; previous record retained.'); process.exitCode = 1 })
const out = `${site}/v`, stateFile = '/opt/cbob-vaults/.cache/vault-meta-state.json'
fs.mkdirSync(out, {recursive:true})
if (!PROFILES.mainnet.collection) {
  const file = `${out}/collection.json`, tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(collectionJson())); fs.renameSync(tmp,file)
  console.log('Collection metadata published; per-vault metadata awaits initialization.')
} else {
  const raw = fs.readFileSync('/opt/gary-club/.env.local','utf8').match(/^HELIUS_RPC_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g,'')
  if (!raw) throw new Error('Metadata RPC is not configured')
  const result=await generate({conn:new Connection(raw,'confirmed'),profile:PROFILES.mainnet,out,stateFile,dry:false})
  if(result.fatal) throw new Error('Metadata chain read failed; previous files retained')
  console.log(`Metadata written ${result.written.length}, unchanged ${result.unchanged}, retained ${result.kept.length}`)
}
