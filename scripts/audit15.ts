/** Round 15 — THE NEWEST CODE, which is the code round 14 could not see.
 *  Round 14's eight auditors read the tree at e16c5e2. Everything in
 *  e16c5e2..2f84b40 landed after their reports — including `bank/cosign.mjs`,
 *  a file that has never been in ANY audit prompt in fifteen rounds, and the
 *  rewrite of `bank/lock.mjs`'s break. Rounds 11, 12, 13 and 14 each found their
 *  worst defect in the PREVIOUS round's repairs or in a file nobody had read. */
import * as fs from 'fs'
import { execSync } from 'child_process'
const K=(fs.readFileSync('/opt/gary-club/.env.local','utf8').match(/^OPENROUTER_API_KEY=(.*)$/m)||[])[1]
const MODELS=(process.env.MODELS||[
  'openai/gpt-5.6-terra-pro',
  'x-ai/grok-4.6',
  'anthropic/claude-opus-5',
  'moonshotai/kimi-k3',
  'z-ai/glm-5.3',
  'qwen/qwen3.8-2.4t-a95b',
  'minimax/minimax-m3',
  'openai/gpt-5.6-luna-pro',
].join(',')).split(',')
const OUT=process.env.OUTDIR||'/opt/cbob-vaults/audits/round15'
const R='/opt/cbob-vaults'
const f=(p:string)=>fs.readFileSync(`${R}/${p}`,'utf8')
/** THE DIFF IS THE SUBJECT OF THIS ROUND, so it is IN the prompt rather than left
 *  for the auditor to reconstruct from two versions of a file they never saw. */
const DIFF=execSync(`cd ${R} && git diff e16c5e2..2f84b40 -- programs bank scripts tests`,
  {maxBuffer:64*1024*1024}).toString()

const PROMPT=`You are an independent security auditor. These four Solana programs and the off-chain pipeline beside them will hold and move real Bitcoin (cbBTC) belonging to real customers. FIND FAULTS. Assume the author is wrong until proven otherwise. Do NOT confirm their work and do not praise it.

=====================================================================
READ THIS FIRST. IT CHANGES YOUR JOB.
=====================================================================
**THERE IS NO HUMAN AUDIT FIRM. THIS PROCESS IS THE CERTIFICATION.**

Every round before the last was written as if a professional firm would eventually review a frozen version and catch what the models missed. The owner ruled on 2026-08-22 that there will be no such firm: this system will be audited by AI or not at all. So calibrate accordingly — a finding you decline to write because "someone else will catch it" is a finding nobody writes, and the money is real.

That cuts BOTH ways, and the second half matters as much as the first. Fourteen rounds have produced roughly a third of "CRITICAL" findings that were WRONG on measurement — a headline its own body refuted, invented sysvar mechanics, a Borsh claim contradicted by mints that demonstrably work on a validator, one recommendation that would have DESTROYED customer SOL, and a confident claim that Core's BurnV1 closes the asset account (it does not; measured). With no firm downstream to sort the real from the imagined, a wrong CRITICAL costs real engineering time and can push a correct design into a wrong change. So: before you write a finding, ask what evidence would exist on-chain, or in a test run, if your claim were true — and SAY what that evidence is, so it can be checked.

All four programs pass a 267-assertion suite on a local validator running REAL Metaplex Core cloned from mainnet, minting real vaults and moving real SPL tokens; plus 275 off-chain detector assertions proven in both directions, 17 allocation, and 11 against live mainnet. A claim that contradicts a measured run is a claim about your own reasoning.

=====================================================================
THE PRIMARY TARGET: TWO THINGS THAT DID NOT EXIST LAST ROUND
=====================================================================
Round 14 ran against commit e16c5e2. The complete diff e16c5e2..2f84b40 is at the end. NONE of it has been audited. Attack these in order.

**R1. \`bank/cosign.mjs\` IS BRAND NEW AND HAS NEVER BEEN IN AN AUDIT PROMPT.**
This is the Bank's pre-signature co-signer. For five rounds SPEC, SEAL's header, SEAL's Config doc and BURN's header all leaned on "the Bank sees the whole transaction and must refuse" — which is true of a Solana signature and was false of this repository, because NOTHING SIGNED A REDEMPTION. This file is the author's attempt to make that sentence true. It takes a base64 transaction FROM THE CUSTOMER, judges it, and with \`--live\` puts the Bank's key on it.

  - **THE INPUT IS HOSTILE. The customer composes the transaction.** A Solana signature authorises EVERY instruction in the transaction it signs. Enumerate exactly what this tool will and will not put the Bank's name on. What can a redeeming customer add to a well-formed redemption that this tool blesses? Be concrete and exhaustive: instructions, accounts, signer sets, fee payer, address tables, the transaction version.
  - \`judgeRedemptionTx\` (in bank/detectors.mjs) is the shape judgement and \`judgeRedemptionCoverage\` is the completeness judgement. Both are pure and both are asserted in bank/selftest.mjs. What do the assertions NOT cover?
  - \`scanPda\` reads what the asset-signer PDA owns: \`getTokenAccountsByOwner\` on both token programs, plus DAS \`getAssetsByOwner\`. **What value can a PDA hold that this scan does not see?** The author knows about the airdrop race (stated below, do not re-file it). Ask a different question: given a response the scan DOES get back, what does it mis-read or discard?
  - The DAS full-page refusal at limit 1000. Is it the right guard, and is it the ONLY way that call can fail to answer?
  - Is refusing two redemptions in one transaction correct, or does it break something legitimate?
  - \`BURN_FIXED_ACCOUNTS = 11\` and the account indices 0 / 2 / 3 are hard-coded mirrors of two programs' account lists. What happens if they drift, and does it fail open or closed?
  - It reads the Bank from the SEAL config on chain through \`pinnedAccountData\`. BURN keeps its OWN copy of \`bank\`. Can those disagree, and what happens if they do?

**R2. \`bank/lock.mjs\`'s BREAK WAS REWRITTEN.** Three round-14 auditors independently wrote out the interleaving where two runners each broke the same stale lock and both held — the double payment this file exists to prevent. The break is now a single atomic \`rename\` to a name only that process knows, plus a branch that RESTORES the lock when the rename turns out to have taken a replacement rather than the stale lock.
  - Is the new break actually exclusive? Write out the interleavings. TWO racers, and then THREE.
  - **The restore path.** It re-creates the lock with an exclusive \`wx\` open and swallows the failure. What is true of the filesystem between the rename and the restore, and what can another process do in that interval?
  - \`releaseLock\`, \`readLedger\`, \`writeLedger\`, the marker, and \`withLock\`'s finally. Anything that can lose or double a payment.
  - The author's header says the durable answer is "an OS lease on an open fd" and that it was recorded as the next step rather than half-built. Is what is built here a narrowing or a fix, and does the code claim more than it delivers?

**R3. ROUND 14'S OTHER REPAIRS, all unaudited:**
  - \`applyAcks\` / \`parseAcks\` and \`bank/acks.json\`: an ack DOWNGRADES a finding to INFO and keeps it printed with its reason; the reason is mandatory. Can an ack silence something it should not, or fail to silence what it should? Is \`<kind>:<asset>\` the right key?
  - \`unredeemable_owner\` in \`detectNestedVaults\`: any vault owned by an OFF-CURVE address can never be redeemed, because v5 needs two TOP-LEVEL owner signatures. False positives? False negatives? Marketplace escrows?
  - The \`REDEMPTION_NOISE\` allowlist in \`correlateBurns\`: four finding kinds are downgraded when a \`burn_vault\` for the same asset was seen. Is the allowlist too wide? Can a bare Core BurnV1, an approve by the vault's PDA, a nested vault, or an undeclared account be laundered into INFO?
  - The rewritten \`scripts/validate-core-gate.sh\` — the script that proves the gate that proves the test environment that certifies everything else.
  - The ceiling harness 9.14 / 9.14a / 9.14b and \`MAX_RESERVE_MINTS = 3\`. 9.14 previously compared a value to itself and could never go red.
  - \`bank/selftest.mjs\`'s own internal \`FLOOR\`, and the floors in \`scripts/run-tests.sh\`. Can a floor be defeated, or can an assertion be deleted while the count stays?

**R4. THE COMMENTS.** A comment claiming a control that does not run is a defect in this project and has appeared in SIX SEPARATE ROUNDS, each time inside the repair for the previous one. The rule now is that every such claim POINTS AT the control table in SPEC.md's "THE SHIP GATE" section rather than restating it. **Now that \`bank/cosign.mjs\` exists, the drift can also run the other way — a comment DENYING a control that now does run is the same defect.** Read every header in the diff and in the four programs against what actually executes. Name each one you find.

=====================================================================
SECOND TARGET: THE CARRY-OVER LIST
=====================================================================
Round 14 accepted these and did NOT fix them. Tell us if any is worse than stated, or if a stated limit is actually exploitable:
  1. Cross-pass correlation lag: if the signature walk reaches the burn in a LATER pass than the DAS diff, the CRITICAL already went out and nothing retracts it.
  2. Compute units are unmeasured anywhere. Is there a CU ceiling below the byte ceiling?
  3. \`prog.*.hash\` slices at a fixed offset 45, which is wrong when a program's upgrade authority is absent (the ELF starts at 13 then). Now applies to Core too.
  4. \`detectNestedVaults\` cannot see a FOREIGN Core asset nested in a vault.
  5. \`burn_via_program\` does not verify the asset is one of ours, so the correlation key is caller-supplied.
  6. SPEC contradicts the implementation on sweep authorisation and carries stale counts.
  7. MINT carries a dead redemption stamp and a "strictly stronger" comment now known to be false.
  8. Distribution reconciles against a ledger the payer wrote. A fresh per-cycle swap operator wallet is not implemented.
  9. Duplicate attribute keys are not rejected at mint. A vault minted during a proposal may vote. A buyer cannot verify reserve continuity atomically.

=====================================================================
THIRD TARGET: ATTACK THE AUTHOR'S OWN VERDICT
=====================================================================
audits/round14/VERDICT.md is included below — what was accepted, what was rejected, and what was confirmed CORRECT by last round's auditors. Challenge all three. Attacking the verdict has produced a real finding twice. In particular:
  * The admin EXEMPTION from \`detectBankIsNotSignable\` was confirmed correct by three models. Name an admin instruction in any of the four programs that breaks under a PDA admin, or confirm none does.
  * The closed-ATA delegate ALLOW (3.3a) was confirmed safe.
  * "Only TWO reserve mints fit if the redeemer must create their destination ATAs" — so ATA creation MUST be a prior transaction. Is that written requirement sufficient, and what happens if a client ignores it?
  * If one of round 14's SEVEN fixes is wrong, or fixes the wrong thing, that is the highest-value finding in this round.

=====================================================================
KNOWN AND OPEN. DO NOT RE-REPORT AS NEW; DO tell us if any is worse than stated.
=====================================================================
  * **THE CO-SIGNER COULD NEVER BE A PROOF.** A third party can fund a PDA-owned token account after the scan and before the transaction lands. No transaction-level read lock over "everything this PDA owns" exists, and Core has no enumeration primitive to move the check on-chain. THE AIRDROP RACE DOES NOT CLOSE. It does close the nested-vault case in practice, because nesting needs the owner's own cooperation.
  * Distribution reconciles against a ledger the payer wrote.
  * A fresh per-cycle swap operator wallet is not implemented.
  * Duplicate attribute keys are not rejected at mint.
  * MINT still delegates the Attributes plugin to a SEAL PDA that no longer writes attributes, and still reserves the "redemption" key for a stamp that no longer exists.
  * A vault minted during a proposal may vote. A buyer cannot verify reserve continuity atomically at purchase.
  * Nesting and airdrops: an UNDECLARED holding is DESTROYED by a burn, not stranded. Measured and asserted as ALLOW on purpose. There is no on-chain fix; Core cannot enumerate.

=====================================================================
MEASURED FACTS. DO NOT RE-FILE THESE AS BUGS.
=====================================================================
1. A bare Core BurnV1 by the owner cannot be prevented while the vault stays freely transferable. There is no burn-only lock.
2. Token accounts owned by a PDA cannot be enumerated on-chain, and neither can nested Core assets.
3. A vault transferred to its own asset-signer PDA is bricked forever, and Core permits it. So is one transferred into ANOTHER vault's asset-signer PDA (measured, 9.1/9.3).
4. Core BurnV1 does NOT sweep the asset-signer PDA. After a burn the PDA still held all 5,000,000 lamports. An auditor once recommended dropping the lamports==0 check on the theory that Core sweeps it; that would DESTROY customer SOL on every burn.
5. Pubkey::is_on_curve is host-only and panics on BPF.
6. overflow-checks = true, so arithmetic overflow ABORTS.
7. The charter round is free by design; price_lamports = 0 is legal and intended.
8. INIT_AUTHORITY is a Squads multisig vault (off-curve, signs by CPI). --features localnet swaps a test key in; scripts/build-mainnet.sh proves the shipped binary carries the Squads key by BEHAVIOUR.
9. A burned asset's address is NOT re-mintable: the account survives, still Core-owned, at Key::Uninitialized, and a re-mint is refused by the System program with "account already in use" (measured 9.12/9.13).
10. The measured redemption byte ceiling is 831 / 975 / 1119 bytes for 1 / 2 / 3 reserve mints against a 1232 limit, WITH the PDA's lamports swept. MAX_RESERVE_MINTS is 3.

=====================================================================
ARCHITECTURE
=====================================================================
- A vault is a Metaplex Core NFT (CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d). Contents live in Core's asset-signer PDA ["mpl-core-execute", asset]. Core ExecuteV1 makes that PDA sign arbitrary CPIs and REQUIRES the asset owner's signature.
- A PermanentFreezeExecute plugin gates whether ExecuteV1 is allowed. The SEAL program's ["seal"] PDA holds that plugin's authority. Permanent plugins are CREATE-ONLY.
- FOUR programs, four separate upgrade authorities: SEAL (the seal and the thaw), MINT (rounds, mint_vault, revenue), BURN (burn_vault), GOV (proposals and votes). Core is a FIFTH program we do not control.
- v5 REDEMPTION, the mechanic this all exists for: open_for_redemption refuses to thaw unless burn_vault for the SAME asset and owner appears later in the same TOP-LEVEL transaction; burn_vault refuses unless that open appeared earlier. There is no close. No path leaves a surviving emptied vault, and a partial sweep reverts the thaw with it. DO NOT REDESIGN THIS — it has now survived two full rounds against eight models each.
- Money: income -> the MINT ["revenue"] PDA -> sweep_sol_for_swap (on-chain, permissionless, destination PINNED) -> a Jupiter swap OFF-CHAIN, the one trusted hop -> cbBTC back to the revenue PDA -> split_revenue (on-chain, enforced 85/15) -> daily equal payout to vaults holding at least 21,000 sats.

REPORT FORMAT. Order by target: R1-R4, then the carry-over list, then the verdict challenges, then anything else. Findings CRITICAL / HIGH / MEDIUM / LOW. For each: the exact construct, what an attacker or an accident gains, the evidence that would exist if you are right, and the fix. End with one section: GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that fifteen rounds of AI audit structurally cannot?

=====================================================================
THE DIFF UNDER AUDIT (e16c5e2..2f84b40) — everything written since round 14 read the tree
=====================================================================
${DIFF}

=====================================================================
THE AUTHOR'S OWN VERDICT ON ROUND 14 — attack it
=====================================================================
${f('audits/round14/VERDICT.md')}

=====================================================================
THE FULL TREE AS IT STANDS
=====================================================================
=== ⚠️ NEVER AUDITED IN FIFTEEN ROUNDS: bank/cosign.mjs — THE BANK'S CO-SIGNER ===
${f('bank/cosign.mjs')}

=== OFF-CHAIN: bank/lock.mjs (the break was rewritten — R2) ===
${f('bank/lock.mjs')}

=== OFF-CHAIN: bank/detectors.mjs (judgeRedemptionTx, judgeRedemptionCoverage, parseAcks, applyAcks are NEW) ===
${f('bank/detectors.mjs')}

=== OFF-CHAIN: bank/selftest.mjs ===
${f('bank/selftest.mjs')}

=== OFF-CHAIN: bank/alarm.mjs ===
${f('bank/alarm.mjs')}

=== OFF-CHAIN: bank/anchor.mjs ===
${f('bank/anchor.mjs')}

=== OFF-CHAIN: bank/spl.mjs ===
${f('bank/spl.mjs')}

=== OFF-CHAIN: bank/sigwalk.mjs ===
${f('bank/sigwalk.mjs')}

=== OFF-CHAIN: bank/revenue.mjs ===
${f('bank/revenue.mjs')}

=== OFF-CHAIN: bank/distribute.mjs ===
${f('bank/distribute.mjs')}

=== SEAL: programs/cbob-vaults/src/lib.rs ===
${f('programs/cbob-vaults/src/lib.rs')}

=== BURN: programs/cbob-vault-burn/src/lib.rs ===
${f('programs/cbob-vault-burn/src/lib.rs')}

=== MINT: programs/cbob-vault-mint/src/lib.rs ===
${f('programs/cbob-vault-mint/src/lib.rs')}

=== GOV: programs/cbob-vault-gov/src/lib.rs ===
${f('programs/cbob-vault-gov/src/lib.rs')}

=== SPEC.md ===
${f('SPEC.md')}

=== OPS: scripts/run-tests.sh ===
${f('scripts/run-tests.sh')}

=== OPS: scripts/validate-core-gate.sh ===
${f('scripts/validate-core-gate.sh')}

=== OPS: scripts/audit-coverage.sh ===
${f('scripts/audit-coverage.sh')}

=== OPS: scripts/build-mainnet.sh ===
${f('scripts/build-mainnet.sh')}

=== OPS: scripts/cron-install.sh ===
${f('scripts/cron-install.sh')}

=== OPS: scripts/probe-mainnet-facts.mjs ===
${f('scripts/probe-mainnet-facts.mjs')}

=== THE SUITE: tests/3prog.test.ts ===
${f('tests/3prog.test.ts')}

=== tests/initauth.test.ts ===
${f('tests/initauth.test.ts')}

=== tests/probe-round5.test.ts ===
${f('tests/probe-round5.test.ts')}

=== tests/probe-round5b.test.ts ===
${f('tests/probe-round5b.test.ts')}
`
/** ONE HUNG MODEL MUST NOT LOSE THE ROUND. Rounds 6 and 7 both ran under a bare
 *  Promise.all with no deadline and no incremental write, so nothing at all
 *  reached disk until the slowest of eight returned. */
const DEADLINE_MS=Number(process.env.MODEL_TIMEOUT_MS||45*60_000)
async function ask(model:string){
  const t0=Date.now()
  const ctl=new AbortController()
  const timer=setTimeout(()=>ctl.abort(),DEADLINE_MS)
  try{
    const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',signal:ctl.signal,
      headers:{'Authorization':`Bearer ${K}`,'Content-Type':'application/json'},
      body:JSON.stringify({model,messages:[{role:'user',content:PROMPT}],max_tokens:64000,temperature:0.2})})
    const j:any=await r.json()
    if(j.error) return {model,ok:false,text:`ERROR ${JSON.stringify(j.error).slice(0,600)}`,secs:0,usage:''}
    const m=j.choices?.[0]?.message
    const text=(m?.content&&m.content.trim())?m.content:(m?.reasoning?'[reasoning only]\n'+m.reasoning:JSON.stringify(j).slice(0,800))
    const u=j.usage||{}
    return {model,ok:true,text,secs:Math.round((Date.now()-t0)/1000),usage:`in=${u.prompt_tokens} out=${u.completion_tokens} finish=${j.choices?.[0]?.finish_reason}`}
  }catch(e:any){ return {model,ok:false,text:`FETCH FAILED ${e.message}`,secs:Math.round((Date.now()-t0)/1000),usage:''} }
  finally{ clearTimeout(timer) }
}
/** Write as each one lands, not after all of them. */
function land(o:any){
  fs.writeFileSync(`${OUT}/${process.env.TAG||'v15'}-${o.model.replace(/[\/.]/g,'_')}.md`,o.text)
  console.log(`${o.model.padEnd(30)} ${o.ok?`${o.secs}s ${o.usage}`:`FAILED after ${o.secs}s`} chars=${o.text.length}`)
}
async function main(){
  console.log(`prompt chars=${PROMPT.length}  models=${MODELS.length}`)
  await Promise.all(MODELS.map(m=>ask(m).then(land)))
}
main().catch(e=>console.error('FATAL',e?.message||e))
