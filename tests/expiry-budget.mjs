/** Round 28: execute twenty DISTINCT due boosts under the default legacy CU
 * budget. Synthetic valid-layout/PDA genesis accounts isolate expiry cost;
 * this does not claim twenty complete mint/boost lifecycles were replayed.
 * Owns a fresh local validator, only after the suite's validator has stopped.
 */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, ComputeBudgetProgram } from '@solana/web3.js'
import * as L from '../bank/layout.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = fs.mkdtempSync(path.join(root, '.cache/expiry-budget-'))
const rpc = 'http://127.0.0.1:8999'
for (const port of [8999, 9900]) {
  const busy = await new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(1000)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => { socket.destroy(); resolve(false) })
    socket.once('timeout', () => { socket.destroy(); resolve(true) })
  })
  assert(!busy, `port ${port} is held; refusing to replace another validator`)
}
const tokenArgs = execFileSync('bash', ['-c',
  'source "$1/scripts/token-programs.sh"; token_programs_prepare "$2" || exit 1; printf "%s\\0" "${TOKEN_PROGRAM_ARGS[@]}"',
  '--', root, path.join(root, '.cache')], { encoding: 'utf8' }).split('\0').filter(Boolean)
const mint = new PublicKey(L.PROGRAM_IDS.mint)
const [cfgAddr, bump] = PublicKey.findProgramAddressSync([Buffer.from(L.SEEDS.mintConfig)], mint)
const payer = Keypair.generate()
const defaults = name => Object.fromEntries(L.STRUCTS[name].fields.map(([f, t]) => [f,
  t === 'Pubkey' ? PublicKey.default.toBase58() : t === '[u8; 32]' ? '00'.repeat(32)
    : t.startsWith('[u32;') ? Array(t === '[u32; 5]' ? 5 : 64).fill(0)
      : t === '[i64; 64]' ? Array(64).fill(0n) : t === 'Vec<Pubkey>' ? [] : t === 'bool' ? false : 0]))
const cfg = { ...defaults('MintConfig'), version: 6, bump, dist_epoch: 1n, total_active_weight: 280n,
  active_count: 20n, minted_total: 20n, revealed_total: 20n, max_supply: 2100n,
  acc_scaled: 10n * L.ACC_SCALE, owed_scaled: 2800n * L.ACC_SCALE,
  boosts_due: 20, boosts_active: 20, boost_weight_total: 240n, max_boost_weight: 12, max_boost_epochs: 24 }
const args = ['--quiet', '--reset', '--ledger', path.join(dir, 'ledger'), '--rpc-port', '8999',
  '--deactivate-feature', 'B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g',
  '--deactivate-feature', 'TestFeature11111111111111111111111111111111',
  '--bpf-program', mint.toBase58(), path.join(root, 'target/deploy/cbob_vault_mint.so'), ...tokenArgs]
function add(pub, data, owner = mint.toBase58()) {
  const file = path.join(dir, `${pub}.json`)
  fs.writeFileSync(file, JSON.stringify({ pubkey: pub, account: { lamports: 1e9,
    data: [data.toString('base64'), 'base64'], owner, executable: false, rentEpoch: 0, space: data.length } }))
  args.push('--account', pub, file)
}
add(cfgAddr.toBase58(), L.encode('MintConfig', cfg))
const records = []
for (let i = 0; i < 20; i++) {
  const asset = new PublicKey(createHash('sha256').update(`expiry-budget-${i}`).digest())
  const [rec, b] = PublicKey.findProgramAddressSync([Buffer.from(L.SEEDS.vault), asset.toBuffer()], mint)
  add(rec.toBase58(), L.encode('VaultRecord', { ...defaults('VaultRecord'), version: 4,
    asset: asset.toBase58(), mint_index: BigInt(i), level: 1, active: true, bump: b,
    boost_weight: 12, boost_end_epoch: 1n }))
  records.push(rec)
}
add(payer.publicKey.toBase58(), Buffer.alloc(0), PublicKey.default.toBase58())
const log = fs.openSync(path.join(dir, 'validator.log'), 'w')
const child = spawn('solana-test-validator', args, { stdio: ['ignore', log, log] })
const exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve) })
const conn = new Connection(rpc, 'confirmed')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let count = 0
const check = (name, value) => { assert(value, name); count++; console.log(`ok ${name}`) }
try {
  let ready = false
  for (let i = 0; i < 90; i++) {
    assert(child.exitCode === null && child.pid, 'validator exited during startup')
    try { if (await conn.getSlot('confirmed') >= 3) { ready = true; break } } catch {}
    await sleep(1000)
  }
  assert(ready, 'validator did not become ready')
  execFileSync('bash', ['-c', 'source "$1/scripts/token-programs.sh"; token_programs_verify "$2" "$3"',
    '--', root, path.join(root, '.cache'), rpc], { stdio: ['ignore', 'inherit', 'inherit'] })
  const ix = new TransactionInstruction({ programId: mint,
    keys: [cfgAddr, ...records].map(pubkey => ({ pubkey, isWritable: true, isSigner: false })),
    data: createHash('sha256').update('global:expire_boosts').digest().subarray(0, 8) })
  const make = async raised => {
    const tx = new Transaction()
    if (raised) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 800000 }))
    tx.add(ix); tx.feePayer = payer.publicKey; tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash
    tx.sign(payer); return tx
  }
  for (const raised of [false, true]) {
    const tx = await make(raised), { value } = await conn.simulateTransaction(tx)
    fs.writeFileSync(path.join(dir, `simulation-${raised}.json`), JSON.stringify(value, null, 2))
    check(`${raised ? 'raised control' : 'default'} expires all twenty within budget and packet`,
      value.err === null && value.unitsConsumed > 0 && value.unitsConsumed < (raised ? 800000 : 200000)
      && value.logs?.filter(l => l.includes('CBOB_BOOST_EXPIRED asset=')).length === 20 && tx.serialize().length <= 1232)
    console.log(`  ${value.unitsConsumed} CU, ${tx.serialize().length} bytes`)
  }
  const tx = await make(false), signature = await conn.sendRawTransaction(tx.serialize())
  let confirmed = null
  for (let i = 0; i < 90; i++) {
    const status = (await conn.getSignatureStatuses([signature])).value[0]
    if (status && ['confirmed', 'finalized'].includes(status.confirmationStatus)) { confirmed = status; break }
    await sleep(500)
  }
  assert(confirmed, 'expiry transaction was not confirmed within the bound')
  const landed = await conn.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
  check('default-budget transaction lands below 200000 CU', confirmed.err === null
    && landed?.meta?.err === null && landed.meta.computeUnitsConsumed > 0 && landed.meta.computeUnitsConsumed < 200000)
  const accounts = await conn.getMultipleAccountsInfo([cfgAddr, ...records])
  const after = L.decode('MintConfig', accounts[0].data)
  check('all twenty distinct records expire and global counters conserve base weight',
    after.boosts_due === 0 && after.boosts_active === 0 && after.total_active_weight === 40n
    && after.boost_weight_total === 0n && accounts.slice(1).every(a => L.decode('VaultRecord', a.data).boost_weight === 0))
  assert.equal(count, 4, 'expiry assertion floor')
  console.log(`${count}/${count} expiry-budget assertions as predicted`)
} finally {
  child.kill('SIGTERM')
  await Promise.race([exited, sleep(5000)])
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
  fs.closeSync(log)
}
