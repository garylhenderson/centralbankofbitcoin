/** Round 14 — THE REPAIRS, and the five files no auditor has ever seen.
 *  Round 13's eight auditors saw v5 (committed 17 minutes before the round
 *  launched) and NOT ONE of the repairs it produced. Rounds 11 and 12 each found
 *  their worst defects in the previous round's repairs. */
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
const OUT=process.env.OUTDIR||'/opt/cbob-vaults/audits/round14'
const R='/opt/cbob-vaults'
const f=(p:string)=>fs.readFileSync(`${R}/${p}`,'utf8')
/** THE DIFF IS THE SUBJECT OF THIS ROUND, so it is IN the prompt rather than left
 *  for the auditor to reconstruct from two versions of a file they never saw. */
const DIFF=execSync(`cd ${R} && git diff bf8d62c..e16c5e2 -- programs bank scripts tests`,
  {maxBuffer:64*1024*1024}).toString()

const PROMPT=`You are an independent security auditor. These four Solana programs and the off-chain pipeline beside them will hold and move real Bitcoin (cbBTC) belonging to real customers. FIND FAULTS. Assume the author is wrong until proven otherwise. Do NOT confirm their work and do not praise it.

=====================================================================
READ THIS FIRST. IT CHANGES YOUR JOB.
=====================================================================
**THERE IS NO HUMAN AUDIT FIRM. THIS PROCESS IS THE CERTIFICATION.**

Every previous round was written as if a professional firm would eventually review a frozen version and catch what the models missed. The owner ruled on 2026-08-22 that there will be no such firm: this system will be audited by AI or not at all. So calibrate accordingly — a finding you decline to write because "someone else will catch it" is a finding nobody writes, and the money is real.

That cuts BOTH ways, and the second half matters as much as the first. Thirteen rounds have produced roughly a third of "CRITICAL" findings that were WRONG on measurement — a headline its own body refuted, invented sysvar mechanics, a Borsh claim contradicted by mints that demonstrably work on a validator, one recommendation that would have DESTROYED customer SOL, and in round 13 a confident claim that Core's BurnV1 closes the asset account (it does not; measured). With no firm downstream to sort the real from the imagined, a wrong CRITICAL costs real engineering time and can push a correct design into a wrong change. So: before you write a finding, ask what evidence would exist on-chain, or in a test run, if your claim were true — and SAY what that evidence is, so it can be checked.

All four programs pass a 264-assertion suite on a local validator running REAL Metaplex Core cloned from mainnet, minting real vaults and moving real SPL tokens; plus 221 off-chain detector assertions proven in both directions, 17 allocation, and 11 against live mainnet. A claim that contradicts a measured run is a claim about your own reasoning.

=====================================================================
THE PRIMARY TARGET: THE REPAIRS. NO AUDITOR HAS SEEN ANY OF THEM.
=====================================================================
Round 13 ran against commit bf8d62c and its eight reports landed while the repairs were being written. Everything below is UNAUDITED CODE, and this project's most reliable pattern is that repairs are where the next defect lives — round 11's repairs produced five of round 12's accepted findings, one strictly WORSE than what it replaced, and one certified correct by a selftest written in the same commit.

The complete diff bf8d62c..e16c5e2 is included at the end. Attack these in order:

**R1. \`correlateBurns\` MAKES AN ALERT QUIETER. Its failure mode is silence.**
Under v5 every customer redemption IS a burn, so each one produced one CRITICAL (\`vault_burned\`) plus two HIGHs (\`burn_via_program\`, twice — the transaction touches SEAL and BURN and is scanned in both programs' signature walks). That buried \`vault_left_index\`, the ONLY detector for the bare Core BurnV1 the programs cannot prevent. \`burn_via_program\` is now INFO, and a new pure post-pass downgrades \`vault_burned\` to INFO when a \`burn_vault\` for the SAME asset was seen in a scanned transaction.
  - Can a bare Core BurnV1 be LAUNDERED into INFO? The author asserts per-asset correlation stops a genuine redemption covering for a bare burn beside it. Is that complete?
  - The DAS diff and the signature walk are two independent instruments with different lag. The author claims an uncorrelated finding stays CRITICAL and that this "fails safe". Is there an ordering in which it fails OPEN?
  - Can an attacker cause a \`burn_via_program\` finding for an asset they are bare-burning — e.g. a transaction that invokes burn_vault and fails, or names the asset in a burn of something else?
  - Was downgrading \`burn_via_program\` from HIGH to INFO correct, or does it now hide something?

**R2. \`MAX_RESERVE_MINTS\` was lowered 8 -> 3, an ON-CHAIN BOUND, on the strength of ONE measurement harness the author wrote.**
Round 13 established (three auditors) that redemption is one transaction, the reserve list is additive-only, and 8 was a Borsh bound where a packet bound was needed. The suite now BUILDS the real transaction: 1 mint 802 bytes, 2 -> 946, 3 -> 1090, 4 -> cannot be serialized, against 1232. Cap set to 3.
  - **IS THE HARNESS RIGHT?** It is test 9.14 in the suite. Does it build the WORST case — every reserve present, every one swept AND closed, both ATA derivations declared, the real signer set, a real blockhash? Or is it measuring something narrower than a production redemption and therefore reporting a ceiling that is too HIGH?
  - The author caught two of his own broken harnesses in the same session (a regex that silently returned 0 for every pinned constant; a selftest that crashed instead of reporting when a detector was stubbed dead). Assume this one is broken too and find how.
  - Is 3 correct, too high, or needlessly low? What does a v0 transaction with an address lookup table actually buy, and does anything in this repository build one?
  - COMPUTE UNITS ARE NOT MEASURED ANYWHERE. Is there a CU ceiling below the byte ceiling?

**R3. \`detectNestedVaults\` is new.** It reads \`ownership.owner\` off the DAS page \`listVaults\` already fetched (previously discarded) and reports a vault owned by another vault's asset-signer PDA, separately from a vault owned by its OWN. \`pdaOf\` is injected so the detector stays free of web3.
  - It sees CBOB vaults only. A FOREIGN Core asset nested in a vault is invisible to it. Is that gap stated honestly and is it the right scope?
  - Burnt hosts are deliberately included. Right or wrong?
  - Can DAS return an owner that makes this fire on a healthy vault, or miss a nested one?

**R4. \`detectBankIsNotSignable\` is new, and it deliberately EXEMPTS admin.**
v5 needs \`open_for_redemption\` and \`burn_vault\` as two TOP-LEVEL instructions signed by the Bank; a Squads execution is one top-level instruction that CPIs its contents, so moving the Bank key into the multisig — the obvious next hardening step, and the one every other authority here has taken — silently halts every redemption. It cannot be guarded on-chain (\`Pubkey::is_on_curve\` is host-only and panics on BPF), so it is checked off-chain at CRITICAL.
  - A round-13 auditor extended the same finding to \`admin\`. The author REJECTED that: admin's instructions are single top-level calls with no introspection, so a Squads vault signs them by CPI and admin-as-PDA is the intended production shape. **IS THE REJECTION CORRECT?** Name an admin instruction that would break under a PDA admin, or confirm none does.
  - Is off-curve the right proxy? An ON-curve key operated through a relayer breaks the pairing identically and looks ordinary from here.

**R5. Metaplex Core was added to the drift watch.** \`prog.core.upgrade_authority\` and \`prog.core.hash\` at CRITICAL, plus a \`NO_PROGRAMDATA\` sentinel so an absent ProgramData account does not leave the watch silently unpopulated.
  - Is the ProgramData derivation right for Core specifically?
  - Does the sentinel create a false alarm, or hide a real one?
  - Hashing \`acc.data.subarray(45)\` — is that the right slice for a program whose upgrade authority may be absent?

**R6. The two off-chain selftests got an assertion FLOOR for the first time** (203/213/221 detector, 17 allocation). \`set -o pipefail\` already made a crash fail the build; deleting assertions kept it green. Is the floor helper correct, and can it be defeated?

**R7. The v5 programs themselves got exactly ONE round.** The pairing survived it. But \`MAX_RESERVE_MINTS\` changed after that round, and it feeds \`Initialize\`'s space allocation in both SEAL and BURN. Check the account sizing.

**R8. COMMENTS WERE CORRECTED, and a wrong comment is a defect in this project.** The author found that his OWN new comment claimed a control that does not exist ("the Bank must scan BEFORE it signs" — there is no Bank co-signing tool in this repository at all). SPEC and both program headers were rewritten to say "detected within thirty minutes, never prevented". Did he over-correct, under-correct, or leave another comment claiming a control that does not run? THAT CLASS OF DEFECT HAS APPEARED IN FIVE SEPARATE ROUNDS.

=====================================================================
SECOND TARGET: FIVE FILES NO AUDITOR HAS EVER SEEN, IN THIRTEEN ROUNDS
=====================================================================
Measured by diffing every audit prompt ever sent against the file tree. Rounds 11 and 12 both produced their WORST findings in files no auditor had seen before, so spend real effort here:

  * **bank/anchor.mjs** — created in ROUND 12 as the fix for a whole class of defect (a raw-offset read of another program's account that could be silently misread after an upgrade). It pins owner + discriminator + layout version before any offset read. **The fix for a defect class has never itself been audited.**
  * **scripts/validate-core-gate.sh** — the gate that decides whether the local Metaplex Core is byte-identical to the pinned mainnet dump. Everything the suite certifies rests on it.
  * **tests/initauth.test.ts**, **tests/probe-round5.test.ts**, **tests/probe-round5b.test.ts** — three test files. A broken test is a FALSE PASS, and this project has shipped three of those (rejections for the wrong reason, a probe whose transaction never reached the program because web3.js refused to serialize it, and an assertion that would have passed identically with the property under test deleted).

=====================================================================
THIRD TARGET: ATTACK THE AUTHOR'S OWN VERDICT
=====================================================================
audits/round13/VERDICT.md is included below. It records what was accepted, what was fixed, and TWO findings that were REJECTED after measurement. Challenge the rejections and the reasoning:

  * REJECTED: "Core's BurnV1 closes the asset account so a burned address is re-mintable." Measured (9.12/9.13): the account survives, still Core-owned, 2,495,280 lamports, one byte at Key::Uninitialized, and a re-mint holding the original keypair is refused by the System program with "account already in use". Is the measurement sound, and does the conclusion generalise — or is there a state in which the tombstone is reclaimable?
  * REJECTED (partially): "the dead Token-2022 derivation halves redemption capacity." Measured at ~32 of 144 bytes per mint, about a quarter. It is UNREACHABLE (the ATA program validates that the mint's owner equals the token program, and the T22 ATA address is off-curve so no raw account can be created there either) but still costs budget because BURN requires the address present. Is "unreachable" actually true?

Also challenge the ACCEPTED ones. If one of the six fixes is wrong, or fixes the wrong thing, that is the highest-value finding in this round.

=====================================================================
WHAT ROUND 13 ALREADY FOUND AND FIXED. DO NOT RE-REPORT.
=====================================================================
  * The reserve list was a kill switch -> capped at a measured 3.
  * Every honest redemption rang the alarm -> correlateBurns.
  * Nothing looked for a vault inside a vault -> detectNestedVaults.
  * Core was unwatched in production -> added to the drift watch.
  * The Bank cannot be a multisig -> detectBankIsNotSignable + stated in SPEC.
  * Two stale comments the rewrite left behind -> corrected.

=====================================================================
KNOWN AND OPEN. DO NOT RE-REPORT AS NEW; DO tell us if any is worse than stated.
=====================================================================
  * **NO BANK CO-SIGNING TOOL EXISTS AT ALL.** Nothing in this repository signs a redemption, so nothing scans before signing. The pre-sign control is a human procedure. Being built next.
  * **AND IT COULD NEVER BE A PROOF ANYWAY** — a third party can fund a PDA-owned token account after the scan and before the transaction lands. No transaction-level read lock over "everything this PDA owns" exists, and Core has no enumeration primitive to move the check on-chain.
  * **bank/lock.mjs is still not exclusive.** Two runners read the same stale lock, A unlinks and re-links, B then unlinks A's FRESH lock and claims its own, and both pay. The fix is flock/fcntl on an open fd. Being built next.
  * Distribution reconciles against a ledger the payer wrote.
  * A fresh per-cycle swap operator wallet is not implemented.
  * Duplicate attribute keys are not rejected at mint.
  * MINT still delegates the Attributes plugin to a SEAL PDA that no longer writes attributes, and still reserves the "redemption" key for a stamp that no longer exists. Judged unreachable by two round-13 auditors; left deliberately rather than making a second risky change in one session.
  * A vault minted during a proposal may vote. A buyer cannot verify reserve continuity atomically at purchase. Both stated limits.
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
8. INIT_AUTHORITY is a Squads multisig vault (off-curve, signs by CPI). --features localnet swaps a test key in; scripts/build-mainnet.sh proves the shipped binary carries the Squads key by BEHAVIOUR, because a byte search cannot tell which pubkey constant a build carries.

=====================================================================
ARCHITECTURE
=====================================================================
- A vault is a Metaplex Core NFT (CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d). Contents live in Core's asset-signer PDA ["mpl-core-execute", asset]. Core ExecuteV1 makes that PDA sign arbitrary CPIs and REQUIRES the asset owner's signature.
- A PermanentFreezeExecute plugin gates whether ExecuteV1 is allowed. The SEAL program's ["seal"] PDA holds that plugin's authority. Permanent plugins are CREATE-ONLY.
- FOUR programs, four separate upgrade authorities: SEAL (the seal and the thaw), MINT (rounds, mint_vault, revenue), BURN (burn_vault), GOV (proposals and votes). Core is a FIFTH program we do not control.
- v5 REDEMPTION, the mechanic this all exists for: open_for_redemption refuses to thaw unless burn_vault for the SAME asset and owner appears later in the same TOP-LEVEL transaction; burn_vault refuses unless that open appeared earlier. There is no close. No path leaves a surviving emptied vault, and a partial sweep reverts the thaw with it.
- Money: income -> the MINT ["revenue"] PDA -> sweep_sol_for_swap (on-chain, permissionless, destination PINNED) -> a Jupiter swap OFF-CHAIN, the one trusted hop -> cbBTC back to the revenue PDA -> split_revenue (on-chain, enforced 85/15) -> daily equal payout to vaults holding at least 21,000 sats.

REPORT FORMAT. Order by target: R1-R8 (the repairs), then the five never-audited files, then the verdict challenges, then anything else. Findings CRITICAL / HIGH / MEDIUM / LOW. For each: the exact construct, what an attacker or an accident gains, the evidence that would exist if you are right, and the fix. End with one section: GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that thirteen rounds of AI audit structurally cannot?

=====================================================================
THE DIFF UNDER AUDIT (bf8d62c..e16c5e2) — every repair, in one place
=====================================================================
${DIFF}

=====================================================================
THE AUTHOR'S OWN VERDICT ON ROUND 13 — attack it
=====================================================================
${f('audits/round13/VERDICT.md')}

=====================================================================
THE FULL TREE AS IT STANDS
=====================================================================
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

=== OFF-CHAIN: bank/detectors.mjs (correlateBurns, detectNestedVaults, detectBankIsNotSignable are NEW) ===
${f('bank/detectors.mjs')}

=== OFF-CHAIN: bank/alarm.mjs (Core added to the drift watch; correlateBurns wired at the end) ===
${f('bank/alarm.mjs')}

=== OFF-CHAIN: bank/anchor.mjs — ⚠️ NEVER AUDITED, IN THIRTEEN ROUNDS ===
${f('bank/anchor.mjs')}

=== OFF-CHAIN: bank/spl.mjs ===
${f('bank/spl.mjs')}

=== OFF-CHAIN: bank/sigwalk.mjs ===
${f('bank/sigwalk.mjs')}

=== OFF-CHAIN: bank/lock.mjs (known broken — see KNOWN AND OPEN) ===
${f('bank/lock.mjs')}

=== OFF-CHAIN: bank/revenue.mjs ===
${f('bank/revenue.mjs')}

=== OFF-CHAIN: bank/distribute.mjs ===
${f('bank/distribute.mjs')}

=== OFF-CHAIN: bank/selftest.mjs ===
${f('bank/selftest.mjs')}

=== OPS: scripts/run-tests.sh (assertion floors are NEW) ===
${f('scripts/run-tests.sh')}

=== OPS: scripts/validate-core-gate.sh — ⚠️ NEVER AUDITED ===
${f('scripts/validate-core-gate.sh')}

=== OPS: scripts/build-mainnet.sh ===
${f('scripts/build-mainnet.sh')}

=== OPS: scripts/cron-install.sh ===
${f('scripts/cron-install.sh')}

=== OPS: scripts/probe-mainnet-facts.mjs ===
${f('scripts/probe-mainnet-facts.mjs')}

=== THE SUITE: tests/3prog.test.ts (sections 3, 4, 5 and 9 are new or rewritten) ===
${f('tests/3prog.test.ts')}

=== tests/initauth.test.ts — ⚠️ NEVER AUDITED ===
${f('tests/initauth.test.ts')}

=== tests/probe-round5.test.ts — ⚠️ NEVER AUDITED ===
${f('tests/probe-round5.test.ts')}

=== tests/probe-round5b.test.ts — ⚠️ NEVER AUDITED ===
${f('tests/probe-round5b.test.ts')}
`
/** ONE HUNG MODEL MUST NOT LOSE THE ROUND. Rounds 6 and 7 both ran under a bare
 *  Promise.all with no deadline and no incremental write, so nothing at all
 *  reached disk until the slowest of eight returned — and a model that never
 *  returned would have cost the entire round. */
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
  fs.writeFileSync(`${OUT}/${process.env.TAG||'v14'}-${o.model.replace(/[\/.]/g,'_')}.md`,o.text)
  console.log(`${o.model.padEnd(30)} ${o.ok?`${o.secs}s ${o.usage}`:`FAILED after ${o.secs}s`} chars=${o.text.length}`)
}
async function main(){
  console.log(`prompt chars=${PROMPT.length}  models=${MODELS.length}`)
  await Promise.all(MODELS.map(m=>ask(m).then(land)))
}
main().catch(e=>console.error('FATAL',e?.message||e))
