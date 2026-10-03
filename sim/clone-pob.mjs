// Test Vault simulation: clone the REAL Giraffish Moments collection and two REAL
// Proof of Burn assets off mainnet, so the charter claim in the simulation burns
// a genuine mainnet PoB account, proven against the genuine 240-address root.
//
// ONE field changes, on the two assets only: the owner (bytes 1..33 of a Core
// AssetV1) becomes a local key, because nobody here can sign for the real
// holders. The collection is copied byte for byte, plugins and all, so any hook
// on the real collection is exercised exactly as mainnet would run it. Every
// patch is asserted to touch nothing else.
//
// AND ONE NON-DATA FIELD, ON EVERY CLONED ACCOUNT: lamports. Measured 2026-10-03:
// mainnet's rent rate has FALLEN (rent-exempt for 0 bytes is 650,240 lamports
// there) while solana-test-validator still charges the default 6,960 per byte per
// two years (890,880 for 0 bytes). Each mainnet PoB holds exactly its MAINNET
// rent-exempt minimum, so cloned as-is it is underfunded locally and the first
// write to it fails "insufficient funds for rent". The first simulation run
// failed exactly so. Each clone is therefore topped up to the LOCAL minimum, and
// the mainnet balance is asserted to have been rent-exempt on mainnet first, so
// the top-up can never hide a real underfunded account.
//
// Output: sim/.fixtures/<address>.json (solana-test-validator --account format)
//         sim/.fixtures/pob-owner.json  (the throwaway local owner key)
//         sim/.fixtures/pob-picks.json  (which two editions were cloned)
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '.fixtures')
const CORE = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
const SET = JSON.parse(readFileSync(join(HERE, '../scripts/pob-set.json'), 'utf8'))
// Two editions from the pinned set: the first and the last, so the Merkle proof
// is exercised at both ends of the tree.
const PICKS = [SET.assets[0], SET.assets[SET.assets.length - 1]]

function rpcUrl() {
  const env = readFileSync('/opt/gary-club/.env.local', 'utf8')
  const m = env.match(/^HELIUS_RPC_URL=(.*)$/m)
  if (!m) throw new Error('HELIUS_RPC_URL not found')
  return m[1].trim()
}
const localRent = len => (len + 128) * 6960
const fixture = (addr, info, data) => JSON.stringify({ pubkey: addr, account: { lamports: Math.max(info.lamports, localRent(data.length)),
  data: [Buffer.from(data).toString('base64'), 'base64'], owner: info.owner.toBase58(), executable: false,
  rentEpoch: 0, space: data.length } })

mkdirSync(OUT, { recursive: true })
const ownerPath = join(OUT, 'pob-owner.json')
let owner
if (existsSync(ownerPath)) owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(ownerPath, 'utf8'))))
else { owner = Keypair.generate(); writeFileSync(ownerPath, JSON.stringify([...owner.secretKey]), { mode: 0o600 }) }

const conn = new Connection(rpcUrl(), 'confirmed')
let fail = 0
const col = await conn.getAccountInfo(new PublicKey(SET.collection))
if (!col || col.owner.toBase58() !== CORE || col.data[0] !== 5) { console.log('FAIL the Moments collection is not a live Core CollectionV1'); process.exit(1) }
const exemptOnMainnet = async (name, info) => {
  const need = await conn.getMinimumBalanceForRentExemption(info.data.length)
  if (info.lamports < need) { console.log(`FAIL ${name} is BELOW rent exemption ON MAINNET (${info.lamports} < ${need}): a real underfunded account, not a fixture artifact`); return false }
  return true }
if (!(await exemptOnMainnet('the Moments collection', col))) process.exit(1)
writeFileSync(join(OUT, `${SET.collection}.json`), fixture(SET.collection, col, col.data))
console.log(`OK   Giraffish Moments collection ${SET.collection}  ${col.data.length} bytes, copied unchanged`)

for (const p of PICKS) {
  const info = await conn.getAccountInfo(new PublicKey(p.address))
  if (!info || info.owner.toBase58() !== CORE || info.data[0] !== 1) { console.log(`FAIL PoB #${p.edition} is not a live Core AssetV1`); fail++; continue }
  if (!(await exemptOnMainnet(`PoB #${p.edition}`, info))) { fail++; continue }
  const d = Buffer.from(info.data), orig = Buffer.from(d)
  // It must still sit in the Moments collection (update authority = Collection).
  if (d[33] !== 2 || new PublicKey(d.subarray(34, 66)).toBase58() !== SET.collection) { console.log(`FAIL PoB #${p.edition} is not in the Moments collection`); fail++; continue }
  owner.publicKey.toBuffer().copy(d, 1)
  const changed = [...d.keys()].filter(i => d[i] !== orig[i])
  if (changed.some(i => i < 1 || i >= 33)) { console.log(`FAIL PoB #${p.edition}: patch reached byte ${changed.find(i => i < 1 || i >= 33)}`); fail++; continue }
  writeFileSync(join(OUT, `${p.address}.json`), fixture(p.address, info, d))
  console.log(`OK   Proof of Burn #${p.edition} ${p.address}  owner patched to the local key, nothing else`)
}
writeFileSync(join(OUT, 'pob-picks.json'), JSON.stringify(PICKS))
console.log(`local PoB owner: ${owner.publicKey.toBase58()}`)
process.exit(fail ? 1 : 0)
