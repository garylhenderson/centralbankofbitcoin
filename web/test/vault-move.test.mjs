import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { Keypair, SystemProgram, Transaction, PublicKey } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey, createNoopSigner } from '@metaplex-foundation/umi'
import { transferV1 } from '@metaplex-foundation/mpl-core'
import { moveInstruction, moveInput } from '../src/lib/vault-move.mjs'
import { txRefusal, refusal, MAINNET_SET } from '../deploy/rpc-proxy.mjs'
import { makeIds, TOKEN_PROGRAM, ata } from '../src/lib/ids.mjs'
import { PROFILES } from '../src/config.js'
const key = () => Keypair.generate().publicKey, owner = key(), recipient = key(), asset = key(), profile = { ...PROFILES.mainnet, collection: key().toBase58() }, ids = makeIds(profile)
const input = { asset: asset.toBase58(), recipient: recipient.toBase58() }, ownerString = owner.toBase58()
const tx = (...ixs) => new Transaction({ feePayer: owner, recentBlockhash: SystemProgram.programId.toBase58() }).add(...ixs).serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
test('Core transfer matches installed Metaplex SDK bytes and every account role', () => {
  const sdk = transferV1(createUmi('http://127.0.0.1:1'), { asset: publicKey(asset), collection: publicKey(ids.COLL), payer: createNoopSigner(publicKey(owner)), authority: createNoopSigner(publicKey(owner)), newOwner: publicKey(recipient) }).getInstructions()[0], ix = moveInstruction(ids, asset, owner, recipient)
  assert.deepEqual([...ix.data], [...sdk.data]); assert.deepEqual(ix.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), sdk.keys.map(k => [k.pubkey, k.isSigner, k.isWritable])); assert.equal(ix.programId.toBase58(), sdk.programId)
})
test('transfer input refuses extras and off-curve/program destinations', () => { assert.doesNotThrow(() => moveInput(input)); for (const i of [{ ...input, price: '1' }, { ...input, recipient: ids.MINT_CFG.toBase58() }, { ...input, recipient: SystemProgram.programId.toBase58() }, { ...input, recipient: input.asset }]) assert.throws(() => moveInput(i)) })
test('RPC permits only exact collection-bound transfer, including fee quotation', () => { const raw = tx(moveInstruction(ids, asset, owner, recipient)); assert.equal(txRefusal([raw], MAINNET_SET, profile.collection), null); assert.ok(txRefusal([raw])); assert.ok(txRefusal([raw], MAINNET_SET, key().toBase58())); const t = Transaction.from(Buffer.from(raw, 'base64')); assert.equal(refusal({ jsonrpc: '2.0', method: 'getFeeForMessage', params: [t.serializeMessage().toString('base64'), { commitment: 'confirmed' }] }, { collection: profile.collection }), null) })
test('RPC refuses added SOL payment, extra Core transfer and malformed transfer proof', () => { const ix = moveInstruction(ids, asset, owner, recipient); assert.ok(txRefusal([tx(ix, SystemProgram.transfer({ fromPubkey: owner, toPubkey: recipient, lamports: 1 }))], MAINNET_SET, profile.collection)); assert.ok(txRefusal([tx(ix, ix)], MAINNET_SET, profile.collection)); ix.data = Buffer.from([14, 1]); assert.ok(txRefusal([tx(ix)], MAINNET_SET, profile.collection)) })
const require = createRequire(import.meta.url), { build } = require('/home/ubuntu/luna-remotion/node_modules/esbuild')
const x = { destination: null, v: null, reserves: new Map() }
globalThis.__move = { account: async (_c, a) => a.equals(recipient) ? x.destination : x.reserves.get(a.toBase58()) || null, readVault: async () => x.v }
const outfile = '/opt/cbob-vaults/web/test/.out/vault-move.cjs'; fs.mkdirSync('web/test/.out', { recursive: true })
await build({ entryPoints: ['web/src/lib/vault-move.mjs'], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'move-reads', setup(b) { b.onResolve({ filter: /^\.\/reads\.mjs$/ }, a => ({ path: a.path, namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const {account,readVault}=globalThis.__move' })); b.onResolve({ filter: /^[^./]/ }, a => ['bs58', 'base-x'].includes(a.path) ? undefined : ({ path: a.path, external: true })) } }] })
const { planMove } = require(outfile), conn = { getGenesisHash: async () => profile.expectedGenesisHash }
const reset = () => { x.destination = null; x.reserves.clear(); x.v = { info: { owner: ownerString, collection: profile.collection }, record: { asset: input.asset, mint_index: 4n, level: 0, active: false, pending: false } } }
test('undrawn whole vault can move, with no SOL sale or reserve withdrawal', async () => { reset(); const p = await planMove(conn, ids, profile, ownerString, input); assert.equal(p.ixs.length, 1); assert.equal(p.details.level, 0); assert.equal(p.details.vault_no, 5); assert.equal(p.details.recipient, input.recipient); assert.equal(p.acks[0].id, 'move_whole_vault') })
test('fresh source ownership, collection and Bank record are mandatory', async () => { for (const mutate of [() => x.v.info.owner = input.recipient, () => x.v.info.collection = input.recipient, () => x.v.info.burned = true, () => x.v.record.retired = true, () => x.v.record.asset = input.recipient]) { reset(); mutate(); await assert.rejects(planMove(conn, ids, profile, ownerString, input)) } })
test('wrong chain, missing collection, same owner and program recipient refuse', async () => { reset(); await assert.rejects(planMove({ getGenesisHash: async () => 'wrong' }, ids, profile, ownerString, input)); await assert.rejects(planMove(conn, { ...ids, COLL: null }, profile, ownerString, input)); await assert.rejects(planMove(conn, ids, profile, ownerString, { ...input, recipient: ownerString })); x.destination = { owner: ids.CORE, data: Buffer.alloc(0) }; await assert.rejects(planMove(conn, ids, profile, ownerString, input)) })
test('reserve balances are exact and wrong token accounts stop preparation', async () => { reset(); const mint = Object.keys(profile.tokenNames)[0], address = ata(ids.depositAddress(asset), mint), data = Buffer.alloc(165); new PublicKey(mint).toBuffer().copy(data); ids.depositAddress(asset).toBuffer().copy(data, 32); data.writeBigUInt64LE(21001n, 64); data[108] = 1; x.reserves.set(address.toBase58(), { owner: TOKEN_PROGRAM, data }); assert.equal((await planMove(conn, ids, profile, ownerString, input)).details.held[0].raw, '21001'); x.reserves.get(address.toBase58()).owner = ids.CORE; await assert.rejects(planMove(conn, ids, profile, ownerString, input)) })
