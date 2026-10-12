#!/usr/bin/env node
// Independent box-side reads. Never signs, sends, or opens a key file.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { PublicKey, Keypair } from '@solana/web3.js'
import { profile } from '../web/src/config.js'
import { makeIds, ata } from '../web/src/lib/ids.mjs'
import { account, chainNow, collectionsOfMint } from '../web/src/lib/reads.mjs'
import { parseProgramAccount, parseProgramData, parseMint } from '../web/src/lib/decode.mjs'
import { sha256Hex } from '../web/src/lib/enc.mjs'
import { judgeLaunch } from './check-launch-params.mjs'
import { launchWithCollection, valuesFrom, judgeProgramBytes, judgeProbe, STEPS } from '../web/src/lib/plan-ceremony.mjs'
import { resolveCollection, readStep, collectionCreator, collectionFromReceipt } from '../web/src/lib/ceremony-reads.mjs'
import { buildTx, simulate } from '../web/src/lib/tx.mjs'
import * as IX from '../web/src/lib/ix.mjs'
import {providerRpc,readConnection,independentPrograms} from '../bank/live-programs.mjs'
import {stableSetupAccount,programFailureCheck,compareSetupWithRetry,checkStepsWithRetry,finalizedStepConnection,setupProgramIdentity,beforePublicActivity} from './ceremony-compare.mjs'

const root = new URL('../', import.meta.url)
const mode = process.argv[2]
const args = process.argv.slice(3)
let recordedArg = null, creationSignature = null
if (args.length && !args[0].startsWith('--')) recordedArg = args.shift()
if (args[0] === '--creation-signature' && args.length === 2) { creationSignature = args[1]; args.splice(0) }
if (!['--preflight', '--after'].includes(mode) || args.length || (creationSignature && !recordedArg)) {
  console.error('Usage: node scripts/verify-ceremony.mjs --preflight|--after [recorded-collection] [--creation-signature <signature>]\n--after is only for initial read-backs between signing and first public activity, before charter opening; use operational lock read-backs afterward.'); process.exit(2)
}
const result = { mode, checked_at: new Date().toISOString(), checks: [], ok: false }
const need = (ok, name, detail) => {
  result.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) })
  if (!ok) throw new Error(name)
}
try {
  result.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  need(!execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim(), 'clean source')
  const launch = JSON.parse(fs.readFileSync(new URL('launch/mainnet-init.json', root)))
  const pobSet = JSON.parse(fs.readFileSync(new URL('scripts/pob-set.json', root)))
  const recorded = recordedArg || launch.vault_collection.value
  if (mode === '--after') need(!!recorded, 'recorded collection required after signing')
  if (recorded && launch.vault_collection.value) need(recorded === launch.vault_collection.value, 'recorded collection matches committed value')
  try { result.program_observation = await independentPrograms() } catch (e) { need(false, programFailureCheck(e)) }
  const conn = readConnection(providerRpc()), second = readConnection('https://api.mainnet-beta.solana.com'), p = profile('mainnet'), base = makeIds(p)
  need(await conn.getGenesisHash() === p.expectedGenesisHash, 'mainnet genesis')
  const discovered = await collectionsOfMint(conn, base)
  const found = await resolveCollection(conn, p, base, { fromLaunch: recorded, discovered, receipt: creationSignature ? { collection: recorded, signature: creationSignature } : null })
  need(!found.conflict, 'collection identity', found.conflict || 'consistent')
  need(!found.unverified?.length, 'collection discovery complete', found.unverified?.length || 0)
  result.collection = found.collection
  if (mode === '--after') need(!!found.collection, 'collection exists after ceremony')
  if (found.collection) {
    const creator = c => creationSignature ? collectionFromReceipt(c,base,found.collection,p.initAuthority,creationSignature) : collectionCreator(c,base,found.collection,p.initAuthority)
    const creator1 = await creator(conn), creator2 = await creator(second)
    need(creator1.by==='launch'&&creator2.by==='launch'&&creator1.signature===creator2.signature,'independent collection creator agreement')
    result.collection_creation_signature=creator1.signature
  }
  const selected = found.collection || Keypair.generate().publicKey.toBase58()
  const sub = launchWithCollection(launch, selected)
  need(!sub.conflict, 'collection matches launch')
  const now = await chainNow(conn)
  if(mode==='--after')need(beforePublicActivity(now,valuesFrom(sub.json).charterOpensAt),'initial ceremony read-back window; after charter opening use operational lock read-backs')
  for (const [name, at] of [['local clock', Math.floor(Date.now()/1000)], ['chain clock', now]]) {
    const bad = judgeLaunch(sub.json, { nowSec: at, pobSet })
    need(!bad.length, 'launch values at ' + name, bad)
  }
  const v = valuesFrom(sub.json)
  need(v.initAuthority === p.initAuthority && v.bankTreasury === p.squads, 'authority and treasury match profile')
  for (const [name, address] of Object.entries(p.programs)) {
    const a = await account(conn, address)
    need(a?.executable && a.owner.toBase58() === 'BPFLoaderUpgradeab1e11111111111111111111111', name + ' executable')
    const pd = parseProgramData((await account(conn, parseProgramAccount(a.data).programData)).data)
    const bad = judgeProgramBytes(pd, p.programBytes[name], sha256Hex)
    need(!bad.length, name + ' audited bytes', bad)
    const kind = name === 'sweep' ? 'sweep' : 'anchor'
    const ix = kind === 'sweep' ? IX.sweepProbe(new PublicKey(address)) : IX.anchorProbe(new PublicKey(address))
    const { tx } = await buildTx(conn, [ix], new PublicKey(p.initAuthority))
    const probe = judgeProbe(kind, await simulate(conn, tx))
    need(!probe.length, name + ' harmless unsigned probe', probe)
  }
  for (const mint of [...v.reserveMints, v.cbobMint]) {
    const a = await account(conn, mint)
    need(a?.owner.toBase58() === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && parseMint(a.data).initialized, 'classic initialized mint ' + mint)
  }
  {
    const ctx = { conn, ids: makeIds({ ...p, collection: selected }), v, squads: p.squads }
    need(setupProgramIdentity(p.programs),'profile and setup-layout program identity')
    const setupKeys = [ctx.ids.SEAL_CFG, ctx.ids.MINT_CFG, ctx.ids.BURN_CFG, ctx.ids.GOV_CFG, ctx.ids.REVENUE,...[ctx.ids.MINT_CFG,ctx.ids.REVENUE,new PublicKey(p.squads)].map(o=>ata(o,v.paymentMint)),...[...v.reserveMints,v.cbobMint].map(m=>new PublicKey(m)),...(found.collection?[new PublicKey(found.collection)]:[])]
    const kinds = ['config','MintConfig','BurnConfig','GovConfig','config','token','token','token',...Array(v.reserveMints.length+1).fill('mint'),...(found.collection?['collection']:[])]
    const normalize = (a,i) => stableSetupAccount(a,kinds[i],p.core)
    const {comparison,observations}=await compareSetupWithRetry(async (attempt,previousSlot)=>{
      const firstSetup=await conn.getMultipleAccountsInfoAndContext(setupKeys,{commitment:'finalized',...(previousSlot===undefined?{}:{minContextSlot:previousSlot})})
      const secondSetup=await second.getMultipleAccountsInfoAndContext(setupKeys,{commitment:'finalized',minContextSlot:firstSetup.context.slot})
      return [firstSetup,secondSetup]
    },normalize)
    result.setup_observations=observations
    need(comparison.ok,'independent setup configuration: '+comparison.reason,comparison)
    result.step_observations={}
    const minSlot=Math.max(comparison.slots.first,comparison.slots.second)
    for (const step of STEPS) {
      if (!found.collection && step.id === 'collection') continue
      const {checked,observations}=await checkStepsWithRetry(async ()=>{
        const reads=[[],[]]
        const states=await Promise.all([conn,second].map((provider,i)=>readStep({...ctx,conn:finalizedStepConnection(provider,minSlot,reads[i])},step.id)))
        return {states,reads}
      },{mode,hasCollection:!!found.collection,step:step.id})
      result.step_observations[step.id]=observations
      need(checked.ok,(checked.disagreement?'provider step disagreement: ':'independent step ')+step.id,checked)
    }
  }
  result.ok = true
  result.status = mode === '--after' ? 'all step-10 read-backs match; lock still requires R1 checks' : 'chain preflight passed; delivery and owner signing gates remain'
} catch (e) {
  // Never emit provider errors: they can contain credential-bearing URLs.
  result.status = 'REFUSED: ' + (result.checks.at(-1)?.ok === false ? result.checks.at(-1).name : 'network read or decoding failed')
  process.exitCode = 1
}
console.log(JSON.stringify(result, null, 2))
