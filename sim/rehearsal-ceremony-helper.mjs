#!/usr/bin/env node
/**
 * THE LOCAL STAND-IN FOR GARY (round 46). On mainnet, road step 10 of the dress
 * rehearsal is Gary's: he signs it on the signing page while scripts/rehearsal-run.mjs
 * (`--ceremony page`) only waits and reads each account back. Phantom cannot run on a
 * local validator, so the LOCAL proof of that path has this helper do what the page
 * does, step by step, from plan-ceremony.mjs's own STEPS and readStep, signed by the
 * localnet build's INIT_AUTHORITY (the public seed-7 key, which only a LOCAL cluster
 * lets pay). It refuses mainnet's genesis outright.
 *
 *   node sim/rehearsal-ceremony-helper.mjs --rpc http://127.0.0.1:8999 --state <driver state file>
 *
 * It waits until the driver has recorded `ceremony-values` done (the programs carry
 * the localnet build and the values are re-filled), then signs whatever step is not
 * yet on chain, in order, and exits when all seven are. The launch key pays each step
 * (the local funding wallet tops it up first, as Gary funds his own wallet).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { PROFILES, SITE } from '../web/src/config.js'
import { makeIds } from '../web/src/lib/ids.mjs'
import * as IX from '../web/src/lib/ix.mjs'
import { STEPS, valuesFrom, launchWithCollection } from '../web/src/lib/plan-ceremony.mjs'
import { readStep } from '../web/src/lib/ceremony-reads.mjs'
import { rehearsalPrograms, MAINNET_GENESIS } from '../scripts/rehearsal-run.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const INIT = Keypair.fromSeed(Buffer.alloc(32, 7))

async function main() {
  const rpc = arg('--rpc'), statePath = arg('--state')
  if (!rpc || !statePath) throw new Error('usage: --rpc <local url> --state <driver state file>')
  const conn = new Connection(rpc, 'confirmed')
  if ((await conn.getGenesisHash()) === MAINNET_GENESIS) throw new Error('REFUSED: this helper stands in for Gary on a LOCAL cluster only')
  const keys = path.join(ROOT, '.rehearsal-keys'), readKey = f => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, 'utf8'))))
  const programs = rehearsalPrograms(ROOT)
  const filledPath = path.join(ROOT, 'launch', 'rehearsal-init.filled.json')
  for (;;) {   // the driver says when road step 10 may start
    const st = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null
    if (st?.steps?.['ceremony-values']?.status === 'done' && fs.existsSync(filledPath)) break
    await sleep(5000)
  }
  const funding = readKey(path.join(keys, 'local-funding.json'))
  const sendTx = async (tx, payer, signers) => {
    tx.feePayer = payer; tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash
    tx.sign(...signers)
    const sig = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' })
    await conn.confirmTransaction(sig, 'confirmed'); return sig
  }
  // The launch key pays each step's fee and rent, as Gary's wallet does on mainnet. On a
  // fresh local cluster it holds nothing, and a fee payer must hold SOL BEFORE its
  // transaction, so the local funding wallet tops it up in a transaction of its own.
  const send = async (ixs, extra = []) => {
    if (await conn.getBalance(INIT.publicKey, 'confirmed') < 0.3 * LAMPORTS_PER_SOL)
      await sendTx(new Transaction().add(SystemProgram.transfer({ fromPubkey: funding.publicKey, toPubkey: INIT.publicKey, lamports: LAMPORTS_PER_SOL })), funding.publicKey, [funding])
    return sendTx(new Transaction().add(...ixs), INIT.publicKey, [INIT, ...extra])
  }
  const filled = JSON.parse(fs.readFileSync(filledPath, 'utf8'))
  if (filled.init_authority?.value !== INIT.publicKey.toBase58()) throw new Error(`the filled init_authority is ${filled.init_authority?.value}, not the localnet key this helper signs with`)
  const profile = c => ({ ...PROFILES.rehearsal, rpc, programs, collection: c, squads: filled.bank_treasury.value, initAuthority: INIT.publicKey.toBase58() })
  // step 0, as the page does it: a fresh collection key, signed by the launch key
  let collection = null
  const collKp = Keypair.generate()
  {
    const pre = makeIds(profile(null))
    console.log('helper: step 0, the vault collection')
    console.log(`  ${await send([IX.coreCreateCollection(pre, collKp.publicKey, pre.MINT_AUTH, INIT.publicKey, SITE.collectionName, SITE.collectionUri)], [collKp])}`)
    collection = collKp.publicKey.toBase58()
  }
  for (const s of STEPS.filter(x => x.id !== 'collection')) {
    const ids = makeIds(profile(collection)), v = valuesFrom(launchWithCollection(filled, collection).json)
    const ctx = { ids, conn, v, squads: filled.bank_treasury.value }
    const before = await readStep(ctx, s.id)
    if (Array.isArray(before) && !before.length) { console.log(`helper: ${s.id} already on chain`); continue }
    if (Array.isArray(before) && before.length) throw new Error(`helper: ${s.id} is on chain with WRONG values: ${before.join('; ')}`)
    const ixs = s.build(ids, INIT.publicKey, v, ctx)
    console.log(`helper: ${s.id}`)
    if (ixs.length) console.log(`  ${await send(ixs)}`)
  }
  console.log('helper: road step 10 signed (the localnet stand-in for Gary)')
}
main().catch(e => { console.error(String(e.stack || e)); process.exit(1) })
