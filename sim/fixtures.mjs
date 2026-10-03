// Test Vault simulation fixtures: copy the REAL mainnet mint accounts for cbBTC,
// $GARY and $GIRAFFISH onto a local validator, with ONE field changed: the mint
// authority becomes a local key, so the simulation can fund a vault with the
// real mint addresses, decimals, token program and freeze authority. Nothing
// else is altered, and the patch is asserted byte-for-byte below.
//
// Output: sim/.fixtures/<mint>.json (solana-test-validator --account format)
//         sim/.fixtures/mint-authority.json (a throwaway local keypair)
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '.fixtures')
const TOKENKEG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
// The same three the mainnet probe pins (scripts/probe-mainnet-facts.mjs).
const MINTS = [
  ['cbBTC', 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'],
  ['$GARY', '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk'],
  ['$GIRAFFISH', 'Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump'],
]

function rpcUrl() {
  const env = readFileSync('/opt/gary-club/.env.local', 'utf8')
  const m = env.match(/^HELIUS_RPC_URL=(.*)$/m)
  if (!m) throw new Error('HELIUS_RPC_URL not found')
  return m[1].trim()
}

mkdirSync(OUT, { recursive: true })
const authPath = join(OUT, 'mint-authority.json')
let auth
if (existsSync(authPath)) auth = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(authPath, 'utf8'))))
else { auth = Keypair.generate(); writeFileSync(authPath, JSON.stringify([...auth.secretKey]), { mode: 0o600 }) }

const conn = new Connection(rpcUrl(), 'confirmed')
let fail = 0
for (const [name, addr] of MINTS) {
  const info = await conn.getAccountInfo(new PublicKey(addr))
  if (!info) { console.log(`FAIL ${name}: not found on mainnet`); fail++; continue }
  if (info.owner.toBase58() !== TOKENKEG) { console.log(`FAIL ${name}: owner ${info.owner} is not classic SPL`); fail++; continue }
  if (info.data.length !== 82) { console.log(`FAIL ${name}: ${info.data.length} bytes, a classic mint is 82`); fail++; continue }
  const d = Buffer.from(info.data)
  const orig = Buffer.from(d)
  // SPL Mint layout: mint_authority COption<Pubkey> (4+32) | supply u64 | decimals u8
  //                  | is_initialized u8 | freeze_authority COption<Pubkey> (4+32)
  const hadAuth = d.readUInt32LE(0) === 1
  const decimals = d[44], init = d[45]
  const freeze = d.readUInt32LE(46) === 1 ? new PublicKey(d.subarray(50, 82)).toBase58() : 'none'
  d.writeUInt32LE(1, 0)
  auth.publicKey.toBuffer().copy(d, 4)
  // Prove the patch touched ONLY the mint-authority field.
  const changed = [...d.keys()].filter(i => d[i] !== orig[i])
  if (changed.some(i => i >= 36)) { console.log(`FAIL ${name}: patch reached byte ${Math.max(...changed)}`); fail++; continue }
  if (init !== 1) { console.log(`FAIL ${name}: not initialized`); fail++; continue }
  writeFileSync(join(OUT, `${addr}.json`), JSON.stringify({
    pubkey: addr,
    account: { lamports: info.lamports, data: [d.toString('base64'), 'base64'], owner: TOKENKEG,
               executable: false, rentEpoch: 0, space: 82 },
  }))
  console.log(`OK   ${name.padEnd(11)} ${addr}  decimals=${decimals}  mainnet mint authority=${hadAuth ? 'set' : 'none'}  freeze=${freeze}`)
}
console.log(`local mint authority: ${auth.publicKey.toBase58()}`)
process.exit(fail ? 1 : 0)
