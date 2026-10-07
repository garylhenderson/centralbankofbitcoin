/**
 * Every address the pages derive, from ONE profile. Seeds are the programs'
 * own constants (asserted against the Rust in web/test/ids.test.mjs).
 */
import { PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js'
import { Buffer } from './enc.mjs'

export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
export const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
export const BPF_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')
export const SYSTEM_PROGRAM = SystemProgram.programId
export const SYSVAR_INSTRUCTIONS = SYSVAR_INSTRUCTIONS_PUBKEY
export const SLOT_HASHES = new PublicKey('SysvarS1otHashes111111111111111111111111111')

export const SEEDS = {
  sealConfig: 'config', seal: 'seal', mintConfig: 'mint-config', mintAuthority: 'mint',
  vault: 'vault', revenue: 'revenue', rescue: 'rescue', burnConfig: 'burn-config',
  govConfig: 'gov-config', gov: 'gov', coreExecute: 'mpl-core-execute',
}

const pda = (seeds, prog) => PublicKey.findProgramAddressSync(seeds.map(s => typeof s === 'string' ? Buffer.from(s) : s), prog)[0]

/** The canonical associated token account (classic or Token-2022). */
export const ata = (owner, mint, tokenProgram = TOKEN_PROGRAM) =>
  pda([new PublicKey(owner).toBuffer(), tokenProgram.toBuffer(), new PublicKey(mint).toBuffer()], ATA_PROGRAM)

/** Throws, naming the missing value, if the profile cannot address the programs. */
export function makeIds(p) {
  const missing = Object.entries(p.programs || {}).filter(([, v]) => !v).map(([k]) => `programs.${k}`)
  if (missing.length) throw new Error(`this page is not configured yet: ${missing.join(', ')} (web/src/config.js)`)
  const P = k => new PublicKey(p.programs[k])
  const SEAL_PROG = P('seal'), MINT_PROG = P('mint'), BURN_PROG = P('burn'), GOV_PROG = P('gov'), SWEEP = P('sweep')
  const CORE = new PublicKey(p.core)
  const ids = {
    SEAL_PROG, MINT_PROG, BURN_PROG, GOV_PROG, SWEEP, CORE,
    COLL: p.collection ? new PublicKey(p.collection) : null,
    SEAL_CFG: pda([SEEDS.sealConfig], SEAL_PROG), SEAL: pda([SEEDS.seal], SEAL_PROG),
    MINT_CFG: pda([SEEDS.mintConfig], MINT_PROG), MINT_AUTH: pda([SEEDS.mintAuthority], MINT_PROG),
    REVENUE: pda([SEEDS.revenue], MINT_PROG), RESCUE: pda([SEEDS.rescue], MINT_PROG),
    BURN_CFG: pda([SEEDS.burnConfig], BURN_PROG),
    GOV_CFG: pda([SEEDS.govConfig], GOV_PROG), GOV_PDA: pda([SEEDS.gov], GOV_PROG),
  }
  ids.vaultRecord = asset => pda([SEEDS.vault, new PublicKey(asset).toBuffer()], MINT_PROG)
  /** A vault's DEPOSIT ADDRESS: Core's asset-signer PDA, not the NFT's address. */
  ids.depositAddress = asset => pda([SEEDS.coreExecute, new PublicKey(asset).toBuffer()], CORE)
  /** ProgramData of an upgradeable program. */
  ids.programData = prog => pda([new PublicKey(prog).toBuffer()], BPF_UPGRADEABLE)
  return ids
}
