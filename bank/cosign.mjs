#!/usr/bin/env node
/**
 * THE BANK'S CO-SIGNER — inspect a redemption, scan the vault, then sign.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE EVERY OTHER FILE CLAIMED IT ALREADY DID.
 * SPEC, SEAL's header, SEAL's Config doc, BURN's header and five audit rounds all
 * leaned on "the Bank sees the whole transaction and must refuse". That is true
 * of a Solana signature and was false of this repository: NOTHING SIGNED A
 * REDEMPTION, so nothing scanned before signing. Round 13 found the claim, round
 * 14 found it surviving in three more comments after the repair. This is the tool
 * that makes the sentence true.
 *
 * WHAT IT IS, AND WHAT IT CAN NEVER BE
 * ------------------------------------
 * A MITIGATION. Not a proof, and the difference has to stay written down:
 *
 *   * The scan reads what the asset-signer PDA owns at a slot BEFORE the
 *     transaction lands. A third party can fund a PDA-owned token account in
 *     between — for free, needing nobody's cooperation — and that holding is then
 *     destroyed by a burn this tool blessed. There is no transaction-level read
 *     lock over "everything this PDA owns", and Core has no enumeration primitive
 *     to move the check on-chain. THE AIRDROP RACE DOES NOT CLOSE.
 *   * It DOES close the nested-vault case in practice, because nesting requires
 *     the owner's own cooperation and does not happen between two slots by
 *     accident.
 *
 * So the honest claim is: it refuses everything it can see, and what it can see
 * is one slot old.
 *
 * DEFAULT IS INSPECT-ONLY. `--live` is what signs, and it is a decision, the same
 * way `revenue.mjs` is installed without it. Inspecting needs no key at all.
 *
 *   node bank/cosign.mjs --tx <base64>            # verdict only
 *   node bank/cosign.mjs --tx <base64> --live     # verdict, then sign if clean
 *   node bank/cosign.mjs --selftest               # the judgement, both ways
 */
import fs from 'fs'
import { PublicKey, Connection, Transaction, Keypair } from '/opt/gary-club/node_modules/@solana/web3.js/lib/index.cjs.js'
import * as D from './detectors.mjs'
import { pinnedAccountData } from './anchor.mjs'
import { createHash } from 'crypto'

const SEAL = new PublicKey('9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273')
const BURN = new PublicKey('8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8')
const CORE = new PublicKey(D.CORE_ID)
const TOK = new PublicKey(D.TOKEN_ID)
const TOK22 = new PublicKey(D.TOKEN22_ID)
const KEYFILE = process.env.CBOB_BANK_KEY || '/opt/cbob-vaults/bank/keys/bank.json'
/** BURN's `BurnVault` fixed accounts, before `remaining_accounts` begins.
 *  vault_asset, collection, owner, bank, asset_signer, payer, config,
 *  seal_config, instructions, mpl_core, system_program. ⚠️ If BURN's account list
 *  changes, this changes with it — and SEAL's forward match would break first,
 *  which fails closed. Asserted against the suite's own builder in 3.1c-3.1f. */
const BURN_FIXED_ACCOUNTS = 11
const disc = n => [...createHash('sha256').update(`global:${n}`).digest().subarray(0, 8)]

function rpcUrl() {
  const m = fs.readFileSync('/opt/gary-club/.env.local', 'utf8').match(/^HELIUS_RPC_URL=(.*)$/m)
  if (!m) throw new Error('HELIUS_RPC_URL not found in /opt/gary-club/.env.local')
  return m[1].trim()
}

/** Everything the asset-signer PDA owns, by STATE rather than by history — the
 *  only instrument that can answer this, because creating a token account for a
 *  PDA needs no signature from it and touches none of our programs. */
async function scanPda(conn, pda) {
  const owned = []
  for (const programId of [TOK, TOK22]) {
    const r = await conn.getTokenAccountsByOwner(pda, { programId }, 'confirmed')
    for (const { pubkey, account } of r.value) {
      const amount = account.data.readBigUInt64LE(64).toString()
      if (amount !== '0') owned.push({ address: pubkey.toBase58(), amount, kind: 'token' })
    }
  }
  // NESTED CORE ASSETS. `getTokenAccountsByOwner` is structurally blind to these,
  // which is exactly the gap round 13 measured (9.5: undeclared, the burn ALLOWS
  // and the inner vault is orphaned forever) and round 14 found still unclosed.
  const r = await fetch(rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'c', method: 'getAssetsByOwner',
      params: { ownerAddress: pda.toBase58(), page: 1, limit: 1000 } }) })
  const j = await r.json()
  if (j.error) throw new Error(`DAS getAssetsByOwner: ${JSON.stringify(j.error)}`)
  for (const it of (j.result?.items || [])) {
    if (it.burnt) continue
    owned.push({ address: it.id, kind: 'asset' })
  }
  // A REFUSAL TO ANSWER IS NOT AN ANSWER. If DAS paged out we do not know what
  // this vault holds, and signing on a partial list is the whole failure mode.
  if ((j.result?.items || []).length >= 1000) throw new Error('DAS returned a full page for one PDA — refusing to judge a truncated list')
  return owned
}

export async function inspect(b64) {
  const tx = Transaction.from(Buffer.from(b64, 'base64'))
  const ixs = tx.instructions.map(ix => ({
    programId: ix.programId.toBase58(),
    accounts: ix.keys.map(k => k.pubkey.toBase58()),
    data: [...ix.data],
  }))
  const conn = new Connection(rpcUrl(), 'confirmed')
  // The Bank we compare against is the one ON CHAIN, never a constant here: a
  // rotation waits out a seven-day notice and this must follow it automatically.
  const sealCfg = PublicKey.findProgramAddressSync([Buffer.from('config')], SEAL)[0]
  const acc = await conn.getAccountInfo(sealCfg, 'confirmed')
  if (!acc) throw new Error('the SEAL config is not deployed — there is nothing to co-sign against')
  // PIN BEFORE READING A RAW OFFSET. `bank/anchor.mjs` exists because two money
  // jobs took byte offsets with nothing but `if (!acc)` in front of them, and a
  // SEAL upgrade that reorders Config would make this read the wrong 32 bytes and
  // co-sign against a Bank that is not the Bank — quietly. A pinned reader
  // refuses instead. This is the newest raw-offset reader in the repository and
  // it is not going to repeat that.
  const data = pinnedAccountData(acc, { program: SEAL, struct: 'Config', version: 1, what: 'the SEAL config' })
  const bank = new PublicKey(data.subarray(73, 105)).toBase58()

  const shape = D.judgeRedemptionTx(ixs, {
    sealProgram: SEAL.toBase58(), burnProgram: BURN.toBase58(), bank,
    openDisc: disc('open_for_redemption'), burnDisc: disc('burn_vault'),
    burnFixedAccounts: BURN_FIXED_ACCOUNTS,
  }, k => { try { return PublicKey.isOnCurve(new PublicKey(k).toBytes()) } catch { return null } })

  if (!shape.ok) return { ok: false, stage: 'shape', reasons: shape.reasons, bank }
  const pda = PublicKey.findProgramAddressSync(
    [Buffer.from('mpl-core-execute'), new PublicKey(shape.asset).toBuffer()], CORE)[0]
  const owned = await scanPda(conn, pda)
  const cover = D.judgeRedemptionCoverage(owned, shape.declared)
  return { ok: cover.ok, stage: cover.ok ? 'clean' : 'coverage', reasons: cover.reasons,
    bank, asset: shape.asset, owner: shape.owner, pda: pda.toBase58(), owned, declared: shape.declared }
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--selftest')) {
    // The judgement is proven in bank/selftest.mjs, both directions, 20
    // assertions. This flag exists so the file is runnable and says so.
    console.log('the judgement lives in detectors.mjs and is proven in bank/selftest.mjs')
    console.log('  judgeRedemptionTx        — shape: the pair, the binding, the Bank, the owner')
    console.log('  judgeRedemptionCoverage  — every holding declared, or the burn destroys it')
    return
  }
  const i = argv.indexOf('--tx')
  if (i < 0 || !argv[i + 1]) { console.error('usage: cosign.mjs --tx <base64> [--live]'); process.exit(2) }
  const v = await inspect(argv[i + 1])
  console.log(`bank on chain: ${v.bank}`)
  if (v.asset) console.log(`redemption: asset ${v.asset}  owner ${v.owner}\n  vault PDA ${v.pda}\n  holds ${v.owned.length} thing(s), declares ${v.declared.length}`)
  if (!v.ok) {
    console.error(`\nREFUSED at the ${v.stage} check:`)
    for (const r of v.reasons) console.error(`  * ${r}`)
    process.exit(1)
  }
  console.log('\nevery holding this scan can see is declared in the burn.')
  console.log('⚠️ THIS IS ONE SLOT OLD. An airdrop landing between now and execution is')
  console.log('   destroyed by this burn and no scan can prevent it.')
  if (!argv.includes('--live')) { console.log('\ninspect-only. --live signs.'); return }
  if (!fs.existsSync(KEYFILE)) { console.error(`\nno Bank key at ${KEYFILE} — cannot sign`); process.exit(3) }
  const bank = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYFILE, 'utf8'))))
  if (bank.publicKey.toBase58() !== v.bank) {
    console.error(`\nthe key at ${KEYFILE} is ${bank.publicKey.toBase58()}, but the chain says the Bank is ${v.bank}`)
    process.exit(4)
  }
  const tx = Transaction.from(Buffer.from(argv[i + 1], 'base64'))
  tx.partialSign(bank)
  console.log(`\nSIGNED.\n${tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')}`)
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error('FATAL', e.message); process.exit(9) })
