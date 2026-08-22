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
 * DO NOT RUN THIS DIRECTLY. `scripts/bank-sign.sh` is the one sanctioned path and
 * is the only file permitted to invoke this one — asserted in bank/selftest.mjs,
 * both ways. It exists so there is a single command to document and a single
 * string to grep, and so no flag this author never reviewed can be forwarded in.
 *
 *   ./scripts/bank-sign.sh tx.b64                 # verdict only
 *   ./scripts/bank-sign.sh tx.b64 --live          # verdict, then sign if clean
 *   node bank/cosign.mjs --selftest               # the judgement, both ways
 *
 * ⚠️ WHAT THIS FILE IS, IN ONE LINE: the Bank is the second key in a 2-of-2, and
 * this is the policy it applies to its half. Gary, 2026-08-22: it "signs the
 * project to make it a multi-sig and keep them from doing anything with other
 * programs". The two arms that do that second job are the PROGRAM ALLOWLIST and
 * the BANK-PUBKEY CONFINEMENT in `judgeRedemptionTx`; everything else here is
 * support.
 *
 * ⚠️ AND KEEP THESE TWO APART, BECAUSE A DRAFT OF THIS COMMENT DID NOT:
 *   * THE BANK'S SIGNATURE IS MANDATORY AND ON-CHAIN. SEAL and BURN each take
 *     `bank: Signer` and `require_keys_eq!` it against the Bank in their own
 *     config. No vault opens or burns without it. That is the multi-sig and
 *     nobody can route around it, us included.
 *   * THE POLICY IS THIS FILE, AND IT IS SKIPPABLE. A key holder can sign with
 *     something else; only key CUSTODY changes that, and custody is an ops
 *     property of the machine, not of this repository.
 * An earlier version of this header said only the second half, under the words
 * "PROCEDURE, NOT ENFORCEMENT" — true of the policy and read as though the Bank
 * could be skipped. Seven rounds of over-claiming trained this project to watch
 * for controls that do not run; UNDER-claiming one that does is the same defect,
 * and here it understates the guarantee a member is buying.
 *
 * ⚠️ AND THE PROGRAMS DO NOT BOUND WHAT ELSE IS IN THE TRANSACTION.
 * `open_for_redemption` walks the instruction sysvar forward only as far as its
 * matching `burn_vault` and never enumerates the rest, so "the customer cannot
 * spend the Bank's signature on something that is not their redemption" rests
 * ENTIRELY on the two arms named above. That is the round-15 theft. Moving them
 * on-chain is possible and is not done; it is an accepted limit, not an oversight.
 *
 * The control table in SPEC.md ("THE SHIP GATE") is the one place that states
 * which half is which, and `bank/selftest.mjs` checks it against the Rust and
 * against cron rather than taking its word.
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
 *  seal_config, instructions, mpl_core, system_program.
 *
 *  ⚠️ ROUND 15 CORRECTED THIS COMMENT. It said "Asserted against the suite's own
 *  builder in 3.1c-3.1f", and 3.1c-3.1f assert the four INDEX constants inside
 *  the Rust; `grep -rn BURN_FIXED_ACCOUNTS tests/` returned nothing. A comment
 *  naming a control that does not run — the SEVENTH round of that class, in the
 *  newest file, in the commit written to end it.
 *
 *  It is asserted NOW, in 3.1g: the suite counts `BurnVault<'info>`'s fields in
 *  BURN's source and pins this constant to them. If BURN's account list changes,
 *  the suite goes red rather than this drifting quietly. */
const BURN_FIXED_ACCOUNTS = 11
const SYSTEM_ID = '11111111111111111111111111111111'
const COMPUTE_BUDGET_ID = 'ComputeBudget111111111111111111111111111111'
/** THE ONLY PROGRAMS A REDEMPTION NEEDS BESIDE THE PAIR. Core signs the sweeps
 *  out of the asset-signer PDA, the two token programs and the ATA program move
 *  and create the destinations, ComputeBudget sets the unit price, System pays
 *  rent. Anything else is refused by DEFAULT — the inverse of `revenue.mjs`'s
 *  FORBIDDEN list, which has to be a denylist because Jupiter routes through
 *  programs nobody can enumerate. Here they CAN be enumerated, so the safe
 *  default is available and is taken. */
const ALLOWED_PROGRAMS = [D.CORE_ID, D.TOKEN_ID, D.TOKEN22_ID, D.ATA_ID, SYSTEM_ID, COMPUTE_BUDGET_ID]
/** `SystemInstruction::AdvanceNonceAccount`, a u32 discriminant. A transaction
 *  whose first instruction is this one is a DURABLE NONCE transaction: its
 *  `recentBlockhash` is the nonce value and **the signature never expires**. The
 *  co-signer's honest claim is that its scan is one slot old; a durable nonce
 *  turns "one slot" into "whenever the customer feels like submitting", which is
 *  the airdrop race with the clock removed. A redemption has no legitimate use
 *  for advancing a nonce, so the instruction is refused outright rather than
 *  positionally. */
const ADVANCE_NONCE = [4, 0, 0, 0]
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
      const d = account.data
      // A TOKEN ACCOUNT IS AT LEAST THE BASE LAYOUT. Anything shorter is not one,
      // and `readBigUInt64LE(64)` on it throws a RangeError out of a money job.
      if (!d || d.length < 165) throw new Error(`${pubkey.toBase58()} came back from getTokenAccountsByOwner at ${d ? d.length : 'no'} bytes — refusing to judge an account this is not`)
      // THE JUDGEMENT IS PURE AND IS PROVEN BOTH WAYS IN bank/selftest.mjs. This
      // used to be `if (amount !== '0')` inline, which is the exact mistake BURN's
      // own second loop was fixed for: a zero in the base `amount` is not an
      // empty account when the account carries Token-2022 extensions.
      const h = D.classifyPdaTokenAccount({ address: pubkey.toBase58(), dataLen: d.length, amount: d.readBigUInt64LE(64) })
      if (h) owned.push(h)
    }
  }
  // NESTED CORE ASSETS. `getTokenAccountsByOwner` is structurally blind to these,
  // which is exactly the gap round 13 measured (9.5: undeclared, the burn ALLOWS
  // and the inner vault is orphaned forever) and round 14 found still unclosed.
  const r = await fetch(rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'c', method: 'getAssetsByOwner',
      params: { ownerAddress: pda.toBase58(), page: 1, limit: 1000 } }) })
  // ONE JUDGEMENT, TWO CALLERS — see `judgeDasEnvelope`. Round 15 wrote this
  // check here and not in alarm.mjs's `listVaults`, which is the one-of-two-sites
  // defect the same commit's verdict named as this project's most repeated.
  const env = D.judgeDasEnvelope({ ok: r.ok, status: r.status, json: await r.json() })
  if (env.problem) throw new Error(`DAS getAssetsByOwner: ${env.problem} — refusing to read that as "owns nothing"`)
  const items = env.items
  for (const it of items) {
    if (it.burnt) continue
    owned.push({ address: it.id, kind: 'asset' })
  }
  // If DAS paged out we do not know what this vault holds, and signing on a
  // partial list is the whole failure mode.
  if (items.length >= 1000) throw new Error('DAS returned a full page for one PDA — refusing to judge a truncated list')
  return owned
}

export async function inspect(b64) {
  const tx = Transaction.from(Buffer.from(b64, 'base64'))
  const ixs = tx.instructions.map(ix => ({
    programId: ix.programId.toBase58(),
    accounts: ix.keys.map(k => k.pubkey.toBase58()),
    data: [...ix.data],
  }))
  for (const ix of ixs) {
    if (ix.programId === SYSTEM_ID && ADVANCE_NONCE.every((b, n) => ix.data[n] === b)) {
      return { ok: false, stage: 'shape', bank: null,
        reasons: ['this is a DURABLE NONCE transaction (SystemProgram.advanceNonceAccount). '
          + "The Bank's signature on one never expires, so the scan below could be arbitrarily old by the "
          + 'time it lands. Refusing.'] }
    }
  }
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
    allowedPrograms: ALLOWED_PROGRAMS,
    // ⚠️ THE FEE PAYER IS NOT IN ANY INSTRUCTION'S ACCOUNT LIST, so the pubkey
    // confinement inside the judgement cannot see it. It is passed separately or
    // a transaction that names the Bank as payer spends the Bank's SOL with no
    // instruction mentioning it. `null` when web3 could not resolve one.
    feePayer: tx.feePayer ? tx.feePayer.toBase58() : null,
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
    // ⚠️ THE REFUSAL IS A GRIEFING SURFACE AND MUST SAY SO. Declare-everything
    // plus the 1232-byte ceiling means anyone can make a vault unredeemable-by-
    // this-tool for the price of a dust airdrop, and a coverage refusal on
    // somebody else's dust is a REFUSAL TO DESTROY IT, not a broken vault. The
    // escape is a human who has looked, which is why the default is inspect-only.
    if (v.stage === 'coverage') {
      console.error(`\nThis is a refusal to bless the DESTRUCTION of what the vault holds, not a `
        + `verdict that the vault is broken. Anyone can create a PDA-owned account for a vault `
        + `for dust, so a refusal here may be griefing rather than a real deposit. Look at what is `
        + `listed above and decide; signing anyway is a deliberate act, by hand.`)
    }
    process.exit(1)
  }
  console.log('\nevery holding this scan can see is declared in the burn.')
  console.log('⚠️ THIS IS ONE SLOT OLD. An airdrop landing between now and execution is')
  console.log('   destroyed by this burn and no scan can prevent it.')
  if (!argv.includes('--live')) { console.log('\ninspect-only. --live signs.'); return }
  if (!fs.existsSync(KEYFILE)) { console.error(`\nno Bank key at ${KEYFILE} — cannot sign`); process.exit(3) }
  // ONE OF THREE IDENTICAL SITES. `revenue.mjs` and `distribute.mjs` both refuse
  // a group- or world-readable signing key; the newest key-holder — the one that
  // co-signs the only instruction in the system that can permanently remove
  // value — did not. Round 15. Same class as everything else in this file.
  const mode = fs.statSync(KEYFILE).mode & 0o777
  if (mode & 0o077) { console.error(`\n${KEYFILE} is mode ${mode.toString(8)} — a signing key readable by anyone but its owner is not a key`); process.exit(5) }
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
