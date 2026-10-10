/**
 * Every address the pages derive equals the suite's derivation, the programs'
 * seed constants, mpl-core's asset-signer PDA, spl-token's ATA, and the Bank's
 * program-id table. The config's three profiles are checked for shape.
 */
import fs from 'fs'
import * as web3 from '@solana/web3.js'
import * as spl from '@solana/spl-token'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey as umiPk } from '@metaplex-foundation/umi'
import { mplCore, findAssetSignerPda } from '@metaplex-foundation/mpl-core'
import { PROGRAM_IDS } from '../../bank/layout.mjs'
import { PROFILES, CEREMONY_SLUG, RELEASE_COMMIT } from '../src/config.js'
import { makeIds, ata, SEEDS, TOKEN_2022_PROGRAM } from '../src/lib/ids.mjs'
import { harness, SUITE, ROOT } from './ref.mjs'

const H = harness('ids')
const W = web3.PublicKey
const ids = makeIds({ ...PROFILES.mainnet, collection: web3.Keypair.fromSeed(Buffer.alloc(32, 41)).publicKey.toBase58() })

H.eq('config mainnet program ids == bank/layout.mjs PROGRAM_IDS', PROFILES.mainnet.programs, PROGRAM_IDS)
H.eq('config localnet uses the same ids (the localnet build differs only by INIT_AUTHORITY)', PROFILES.localnet.programs, PROGRAM_IDS)
// the Rust: declare_id! in each program equals the config
const rs = { seal: 'programs/cbob-vaults/src/lib.rs', mint: 'programs/cbob-vault-mint/src/lib.rs', burn: 'programs/cbob-vault-burn/src/lib.rs', gov: 'programs/cbob-vault-gov/src/lib.rs' }
for (const [k, f] of Object.entries(rs)) {
  const src = fs.readFileSync(`${ROOT}/${f}`, 'utf8')
  H.eq(`${k}: declare_id! == config`, /declare_id!\("(\w+)"\)/.exec(src)[1], PROFILES.mainnet.programs[k])
  const ia = [...src.matchAll(/pub const INIT_AUTHORITY: Pubkey = pubkey!\("(\w+)"\)/g)].map(m => m[1])
  H.eq(`${k}: INIT_AUTHORITY (mainnet, localnet) == config mainnet, localnet`, ia, [PROFILES.mainnet.initAuthority, PROFILES.localnet.initAuthority])
}
H.eq('the localnet INIT_AUTHORITY is the suite\'s deployer, Keypair.fromSeed(32 x 7)',
  web3.Keypair.fromSeed(Buffer.alloc(32, 7)).publicKey.toBase58(), PROFILES.localnet.initAuthority)
const mintSrc = fs.readFileSync(`${ROOT}/programs/cbob-vault-mint/src/lib.rs`, 'utf8')
const seed = (src, n) => new RegExp(`pub const ${n}: &\\[u8\\] = b"([^"]+)"`).exec(src)?.[1]
H.eq('seeds == the programs\' *_SEED constants', {
  sealConfig: seed(fs.readFileSync(`${ROOT}/${rs.seal}`, 'utf8'), 'CONFIG_SEED'), seal: seed(fs.readFileSync(`${ROOT}/${rs.seal}`, 'utf8'), 'SEAL_SEED'),
  mintConfig: seed(mintSrc, 'CONFIG_SEED'), mintAuthority: seed(mintSrc, 'MINT_SEED'), vault: seed(mintSrc, 'VAULT_SEED'),
  revenue: seed(mintSrc, 'REVENUE_SEED'), rescue: seed(mintSrc, 'RESCUE_SEED'),
  burnConfig: seed(fs.readFileSync(`${ROOT}/${rs.burn}`, 'utf8'), 'CONFIG_SEED'),
  govConfig: seed(fs.readFileSync(`${ROOT}/${rs.gov}`, 'utf8'), 'CONFIG_SEED'), gov: seed(fs.readFileSync(`${ROOT}/${rs.gov}`, 'utf8'), 'GOV_SEED'),
  coreExecute: /EXECUTE_PREFIX: &\[u8\] = b"([^"]+)"/.exec(mintSrc)?.[1] },
  SEEDS)

// the suite's own top-level derivations, evaluated with the config's ids
for (const name of ['GOV_CFG', 'GOV_PDA', 'SEAL', 'SEAL_CFG', 'MINT_AUTH', 'MINT_CFG', 'REVENUE', 'BURN_CFG']) {
  const line = SUITE.split('\n').find(l => l.startsWith(`const [${name}]=`))
  const f = new Function('W', 'Buffer', 'SEAL_PROG', 'MINT_PROG', 'BURN_PROG', 'GOV_PROG', `${line}\nreturn ${name}`)
  H.eq(`suite ${name} == ids.${name}`, f(W, Buffer, ids.SEAL_PROG, ids.MINT_PROG, ids.BURN_PROG, ids.GOV_PROG).toBase58(), ids[name].toBase58())
}
const RESCUE = SUITE.split('\n').find(l => l.includes('const RESCUE=W.findProgramAddressSync'))
H.eq('suite RESCUE == ids.RESCUE', new Function('W', 'Buffer', 'MINT_PROG', `${RESCUE}\nreturn RESCUE`)(W, Buffer, ids.MINT_PROG).toBase58(), ids.RESCUE.toBase58())
const asset = web3.Keypair.fromSeed(Buffer.alloc(32, 3)).publicKey
const umi = createUmi('http://127.0.0.1:1').use(mplCore())
H.eq('depositAddress == mpl-core findAssetSignerPda', ids.depositAddress(asset).toBase58(), findAssetSignerPda(umi, { asset: umiPk(asset.toBase58()) })[0].toString())
H.eq('vaultRecord == suite vrec', ids.vaultRecord(asset).toBase58(), W.findProgramAddressSync([Buffer.from('vault'), asset.toBuffer()], ids.MINT_PROG)[0].toBase58())
const cb = new W('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij')
H.eq('ata (off-curve owner) == spl-token, classic', ata(ids.MINT_CFG, cb).toBase58(), spl.getAssociatedTokenAddressSync(cb, ids.MINT_CFG, true).toBase58())
H.eq('ata (Token-2022) == spl-token', ata(ids.MINT_CFG, cb, TOKEN_2022_PROGRAM).toBase58(), spl.getAssociatedTokenAddressSync(cb, ids.MINT_CFG, true, spl.TOKEN_2022_PROGRAM_ID).toBase58())
H.eq('programData == BPF loader derivation', ids.programData(ids.SEAL_PROG).toBase58(),
  W.findProgramAddressSync([ids.SEAL_PROG.toBuffer()], new W('BPFLoaderUpgradeab1e11111111111111111111111'))[0].toBase58())

// config shape
const launch = JSON.parse(fs.readFileSync(`${ROOT}/launch/mainnet-init.json`, 'utf8'))
H.eq('mainnet initAuthority == launch init_authority', PROFILES.mainnet.initAuthority, launch.init_authority.value)
H.eq('mainnet squads == launch bank_treasury', PROFILES.mainnet.squads, launch.bank_treasury.value)
H.t('the ceremony slug is 16 lowercase hex characters', /^[0-9a-f]{16}$/.test(CEREMONY_SLUG))
H.t('mainnet never accepts a test wallet', PROFILES.mainnet.allowTestWallet === false && PROFILES.rehearsal.allowTestWallet === false)
H.t('mainnet RPC is the same-origin proxy; the collection stays unset until the ceremony creates it', PROFILES.mainnet.rpc === 'https://centralbankofbitcoin.com/rpc' && PROFILES.mainnet.collection === null)
let threw = ''
try { makeIds(PROFILES.rehearsal) } catch (e) { threw = e.message }
H.t('a profile with unset program ids refuses, naming them', /programs\.seal/.test(threw), threw)
// program bytes table == dist/
const sums = Object.fromEntries(fs.readFileSync(`${ROOT}/dist/SHA256SUMS`, 'utf8').trim().split('\n').map(l => l.split(/\s+/)).map(([h, f]) => [f, h]))
const pinDiff = (bytes, sumsMap, size) => Object.entries(bytes).filter(([, v]) => sumsMap[v.file] !== v.sha256 || size(v.file) !== v.len).map(([k]) => k)
const size = f => fs.statSync(`${ROOT}/dist/${f}`).size
for (const [k, v] of Object.entries(PROFILES.mainnet.programBytes))
  H.t(`programBytes.${k} == dist/${v.file} (sha256 and length)`, sums[v.file] === v.sha256 && size(v.file) === v.len)
H.eq('every pinned program equals dist/SHA256SUMS (all five, none missing)', [pinDiff(PROFILES.mainnet.programBytes, sums, size), Object.keys(PROFILES.mainnet.programBytes).length], [[], 5])
H.eq('CONTROL: one changed hash or length in the pins is detected', [pinDiff({ ...PROFILES.mainnet.programBytes, mint: { ...PROFILES.mainnet.programBytes.mint, sha256: '00'.repeat(32) } }, sums, size),
  pinDiff({ ...PROFILES.mainnet.programBytes, sweep: { ...PROFILES.mainnet.programBytes.sweep, len: 1 } }, sums, size)], [['mint'], ['sweep']])
const man = Object.fromEntries(fs.readFileSync(`${ROOT}/dist/MANIFEST.txt`, 'utf8').trim().split('\n').map(l => l.split(/\s+/)).map(([k, ...v]) => [k, v.join(' ')]))
H.eq('dist/ is a CLEAN build of the release commit config.js names (d2ae5fc)', [man.commit, man.dirty, RELEASE_COMMIT.slice(0, 7)], [RELEASE_COMMIT, 'no', 'd2ae5fc'])
H.t('the config comment cites the release commit, not an older one', /commit d2ae5fc/.test(fs.readFileSync(`${ROOT}/web/src/config.js`, 'utf8')) && !/commit 0b3ddb3\)/.test(fs.readFileSync(`${ROOT}/web/src/config.js`, 'utf8')))
export default H.done()
