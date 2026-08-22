/** Round 17 — THE FIRST PROGRAM CHANGE SINCE v5, AND A NEW MONEY PATH.
 *
 *  Round 16 ended with the tree frozen and the four programs untouched for three
 *  rounds. Since then, deliberately and with the owner's sign-off, the freeze was
 *  broken twice:
 *
 *   1. SEAL gained an ON-CHAIN check. `open_for_redemption` now walks EVERY
 *      top-level instruction and refuses if the Bank's key appears outside the
 *      open/burn pair. That is the round-15 theft moved from a policy a key
 *      holder could skip into a program that cannot be skipped. It is the first
 *      change to `programs/` since a single constant in round 13, and NO AUDITOR
 *      HAS READ IT.
 *   2. `bank/distribute.mjs` was rewritten from equal-per-vault to WEIGHTED by a
 *      five-level schedule, with a new emission cadence. It moves real cbBTC to
 *      real customers and it is brand new.
 *
 *  Plus `scripts/bank-sign.sh`, which has never been in any audit prompt.
 *
 *  SIX ROUNDS RUNNING have found their worst defect in the previous round's
 *  repairs. Two of these three subjects were written in the last few hours. */
import * as fs from 'fs'
import { execSync } from 'child_process'
const K=(fs.readFileSync('/opt/gary-club/.env.local','utf8').match(/^OPENROUTER_API_KEY=(.*)$/m)||[])[1]
/** ⚠️ SAME ROSTER AS ROUND 16, AND EVERY ID WAS RE-VERIFIED AGAINST
 *  `GET /api/v1/models` BEFORE THIS RAN — all eight are present in the live list
 *  of 421. The SHIP GATE only requires the SECOND of two clean rounds to change
 *  roster, so this one repeats round 16's; round 18 must differ.
 *
 *  Kept from round 16's note because it cost two auditors: qwen died mid-stream last round and minimax
 *  returned reasoning rather than a report, so both are dropped; deepseek-v4-pro
 *  and gemini-3.1-pro come in. The SHIP GATE requires the second of two clean
 *  rounds to use a different roster, and there is no reason to wait for that to
 *  start varying who reads — eight models re-reading their own repairs is the
 *  weaker arrangement of the two.
 *
 *  ⚠️ AND THE IDS ARE REAL ONES, LOOKED UP. The first attempt at this roster
 *  invented `deepseek/deepseek-v4` and `mistralai/mistral-large-3`; OpenRouter
 *  returned `not a valid model ID` for both and two of eight auditors were
 *  silently missing from the round. A model id is a name, and a guessed name is
 *  a fabricated one — `GET /api/v1/models` is the list. */
const MODELS=(process.env.MODELS||[
  'openai/gpt-5.6-terra-pro',
  'x-ai/grok-4.6',
  'anthropic/claude-opus-5',
  'moonshotai/kimi-k3',
  'z-ai/glm-5.3',
  'deepseek/deepseek-v4-pro',
  'google/gemini-3.1-pro-preview',
  'openai/gpt-5.6-luna-pro',
].join(',')).split(',')
const OUT=process.env.OUTDIR||'/opt/cbob-vaults/audits/round17'
const R='/opt/cbob-vaults'
const f=(p:string)=>fs.readFileSync(`${R}/${p}`,'utf8')
/** THE DIFF IS THE SUBJECT OF THIS ROUND, so it is IN the prompt rather than left
 *  for the auditor to reconstruct from two versions of a file they never saw. */
const DIFF=execSync(`cd ${R} && git diff ab07526..HEAD -- programs bank scripts tests`,
  {maxBuffer:64*1024*1024}).toString()

const PROMPT=`You are an independent security auditor. These four Solana programs and the off-chain pipeline beside them will hold and move real Bitcoin (cbBTC) belonging to real customers. FIND FAULTS. Assume the author is wrong until proven otherwise. Do NOT confirm their work and do not praise it.

=====================================================================
READ THIS FIRST. IT CHANGES YOUR JOB.
=====================================================================
**THERE IS NO HUMAN AUDIT FIRM. THIS PROCESS IS THE CERTIFICATION.**

Every round before the last was written as if a professional firm would eventually review a frozen version and catch what the models missed. The owner ruled on 2026-08-22 that there will be no such firm: this system will be audited by AI or not at all. So calibrate accordingly — a finding you decline to write because "someone else will catch it" is a finding nobody writes, and the money is real.

That cuts BOTH ways, and the second half matters as much as the first. Fifteen rounds have produced roughly a third of "CRITICAL" findings that were WRONG on measurement — a headline its own body refuted, invented sysvar mechanics, a Borsh claim contradicted by mints that demonstrably work on a validator, one recommendation that would have DESTROYED customer SOL, and a confident claim that Core's BurnV1 closes the asset account (it does not; measured). With no firm downstream to sort the real from the imagined, a wrong CRITICAL costs real engineering time and can push a correct design into a wrong change. So: before you write a finding, ask what evidence would exist on-chain, or in a test run, if your claim were true — and SAY what that evidence is, so it can be checked.

All four programs pass a 279-assertion suite on a local validator running REAL Metaplex Core cloned from mainnet, minting real vaults and moving real SPL tokens; plus 388 off-chain detector assertions proven in both directions, 45 allocation, and 19 against live mainnet. Every one of those numbers sits behind a FLOOR, so a suite that stops early fails rather than passing what it reached. A claim that contradicts a measured run is a claim about your own reasoning.

=====================================================================
THE PRIMARY TARGET: ROUND 15'S REPAIRS. NONE OF THEM HAS BEEN AUDITED.
=====================================================================
Round 16 ran against commit ab07526. The complete diff ab07526..HEAD is at the end and is the subject of this round. SIX ROUNDS RUNNING have found their worst defect in the previous round's repairs. Attack these in order.

**R1. SEAL'S NEW ON-CHAIN CHECK — THE FIRST PROGRAM CHANGE SINCE v5, AND THE HIGHEST-VALUE TARGET IN THIS ROUND.**
\`open_for_redemption\` used to scan the instruction sysvar FORWARD from its own index and BREAK at the matching \`burn_vault\`. It now walks from index 0, never breaks, and does two jobs in one pass: find the terminal burn, AND require that \`config.bank\` appears in NO top-level instruction other than an \`open_for_redemption\` (this program, that discriminator) or a \`burn_vault\` (BURN, that discriminator). New error \`BankKeyOutsidePair\`. New constant \`IX_OPEN_FOR_REDEMPTION_DISC\` in SEAL.
  - **The exemption is the attack surface.** Any instruction wearing the open or burn discriminator is skipped by the confinement check. Is there a way to construct an instruction that MATCHES one of those two shapes, is therefore exempt, and does something else with the Bank's key? Consider: the check reads \`ix.program_id\` and the first 8 data bytes only. It does NOT check the instruction is well-formed, or that it will succeed.
  - **Does the rewrite preserve the OLD invariant exactly?** The burn must still be found only at \`i > current\`. Walk it again for: a burn BEFORE the open; two redemptions sharing a transaction; an open reached by CPI (the sysvar reports the OUTER index).
  - **What does it NOT see?** The author states two gaps deliberately: the FEE PAYER (not in any instruction's account list, so the sysvar cannot see it) and the program allowlist (deliberately NOT moved on-chain, because System must stay permitted for rent and the SOL sweep, so an allowlist would not have stopped the theft anyway). Is that reasoning right? Name a concrete transaction that exploits either gap.
  - **The author claims BURN needs no copy of this check**, because \`burn_vault\` refuses without a matching preceding \`open_for_redemption\` (BurnError::NoPrecedingOpen), so every burn that can execute sits in a transaction this scan already covered. **That is a dependency on another program's behaviour, which makes it a claim. Is it true?** Find a transaction containing a burn whose confinement was never checked.
  - **COMPUTE UNITS.** The loop now deserializes EVERY top-level instruction instead of stopping at the burn, and CU is unmeasured anywhere in this project. A redemption is already near the 1232-byte ceiling. Is there a CU ceiling below it now?

**R2. THE NEW MONEY PATH: WEIGHTED DISTRIBUTION AND THE EMISSION CADENCE (\`bank/distribute.mjs\`).**
Rewritten today from equal-per-vault to a five-level weighted schedule. Weights I 2 / II 3 / III 4 / IV 5 / V 6. \`vault_share = drop * weight / sum(weights of activated vaults)\`. This sends real cbBTC to real customers.
  - \`allocateWeighted\`: integer BigInt arithmetic. Can it over-distribute — can \`total\` ever exceed \`available\`? Can it pay a vault that is not activated, or miss one that is? Is the \`smallest\` computation correct when \`activated\` is empty, or when the first element is not the smallest?
  - **The dust carries forward and is never split** (owner's ruling: same level must always mean the same number). Can the dust grow without bound? Can a change in the activated set between drops make a holder worse off than if it had been split?
  - **An activated vault carrying NO level stops the WHOLE distribution.** Fail-closed by design. Is that the right call, or is it a griefing surface — can anyone cause a vault to be activated-but-unlevelled and thereby halt every payout?
  - **The cadence.** One threshold: pay when the SMALLEST activated holder would receive at least \`EMISSION_MIN_PER_VAULT\`, else hold, else force at \`MAX_HOLD_DAYS\`=31. \`holdDays\` is DERIVED from the ledger rather than stored. Walk it: a ledger whose only paid day is today; a run that crashes mid-distribution; a day with a plan but no payments; clock skew across UTC midnight; a ledger with days out of lexical order.
  - **The plan is fixed once and reused on RESUME, and the cadence gate is deliberately SKIPPED on resume.** Is that right? What happens if the pool SHRANK between the plan and the resume?
  - **The level register is OFF-CHAIN** (\`bank/levels.json\`), by ruling. The author writes down that this makes "assigned by fate, cannot be appealed" our word rather than a proof, and proposes an unbuilt commit-reveal. **Is anything WORSE than that stated?** Who can write that file, and what does the blast radius look like?
  - The equal-split \`allocate()\` was DELETED rather than left dead, on the grounds that two allocators is a live hazard. Was anything else still depending on it?

**R3. \`scripts/bank-sign.sh\` — NEVER AUDITED, IN ANY ROUND.**
The one sanctioned path to a Bank signature. Holds no key, contains no judgement, refuses any argument it does not recognise, reads the transaction from a file or stdin, and rejects non-base64 bytes because \`Buffer.from(s,'base64')\` silently ignores them. It reads the file BEFORE \`cd\`-ing to the repo (an earlier version did the reverse and fed the co-signer a DIFFERENT file than the operator named — fail-open, found by running it).
  - Shell-injection, quoting, symlinks, \`\$0\` under a symlink, a file that is a FIFO or a device, TOCTOU between the \`-f\` test and the read, argv length limits on a 1232-byte transaction.
  - Does the base64 filter actually fail closed? Is there input it accepts that decodes to something other than what the operator pasted?
  - Does it swallow or alter \`cosign.mjs\`'s exit code in any path?

**R4. THE GATES WRITTEN THIS ROUND, which are unaudited code like everything else.**
  - SPEC's control table now has a fourth column with THREE values (ON-CHAIN / AUTOMATIC / PROCEDURE) and \`bank/selftest.mjs\` parses those rows and checks them against the RUST and against \`cron-install.sh\`. Can the parser be fooled? What does it do with a row it cannot read — and is that fail-open or fail-closed in EACH direction?
  - The ON-CHAIN arm requires BOTH \`pub bank: Signer<'info>\` AND a \`require_keys_eq!\` on \`ctx.accounts.bank.key()\`. Is matching on SOURCE TEXT sound? Name a program that would pass this check without enforcing a 2-of-2.
  - The signer-set arm pins every file that calls \`fromSecretKey\` to the key it reads. The one-reader arm was widened from \`bank/\` to the whole tree. Is there a way to sign with the Bank key that neither sees?
  - The self-match arm asserts no searched-for string is spelled out in \`selftest.mjs\`. Is that arm itself defeatable?
  - The suite's \`sweep()\` helper was changed to pass \`payer: aliceU\` to Core's \`ExecuteV1\` — before, umi filled it with the BANK's identity, which made every sweep in the suite an instruction naming the Bank. Was that the right fix, or does it now test a shape production will not use?
  - The new on-chain tests 4.7-4.10a were MOVED to the end of the file because minting vaults raised MINT's monotonic \`minted_total\` and broke GOVERNANCE quorum six assertions later. Is that coupling fully understood, or does it bite somewhere else?

**R5. THE COMMENTS. EIGHT ROUNDS RUNNING.**
Round 16's headline was a comment claiming a control that does not run. THIS round's headline was the same defect RUNNING BACKWARDS: the control table said the co-signer was "PROCEDURE. Nothing forces a redemption through it, and nothing can" — true of the POLICY, and read as though the Bank's SIGNATURE were optional. It is not; both SEAL and BURN pin \`bank: Signer\` to their config. **The owner caught that, not any gate, because every gate here checks that a claim is not too STRONG.** Read every comment in the diff for BOTH directions. Name each one you find.

**R6. THE ARITHMETIC ON A PUBLISHED CARD.** The schedule's figures (census 108/60/36/24/12 -> denominator 732; 945/525/315/210/105 -> 6,405; ten per-\$1,000 figures; five shares summing to 100.0%) are asserted in the selftest by RE-DERIVING them from the weights. Check them independently. A wrong number on a customer-facing card is the most expensive defect available here.

=====================================================================
THIRD TARGET: THE OWNER FOUND THIS ROUND'S WORST DEFECT. WHAT ELSE IS OF THAT SHAPE?
=====================================================================
Every gate in this repository checks that a claim is not too STRONG — that a comment does not assert a control which does not run. Eight rounds trained it that way. The worst defect since the last round was the INVERSE: SPEC's control table said the Bank's co-signer was "PROCEDURE. Nothing forces a redemption through it, and nothing can." True of the POLICY. Read as a description of the co-signer, it says the Bank can be skipped — and it cannot, because SEAL and BURN each take \`bank: Signer\` pinned to their own config. **The table UNDERSTATED the guarantee the customer is buying, no gate could see it, and the owner caught it by reading.**

Look for more of exactly that: a place where this system is SAFER or STRONGER than its own documentation says. An under-claim is as much a defect as an over-claim, and it is the direction nothing here is instrumented to catch.

=====================================================================
KNOWN AND OPEN — ACCEPTED LIMITS. DO NOT RE-REPORT AS NEW.
=====================================================================
These are written down BEFORE this round, deliberately, so that re-reporting them does not reset a counter. **DO tell us if any is worse than stated, or if something listed as a limit is actually exploitable — that is the most valuable thing this section can produce.**

1a. The PROGRAM ALLOWLIST and the FEE-PAYER check are off-chain, in \`judgeRedemptionTx\`. Only the bank-pubkey confinement was moved on-chain. A redemption signed with a tool other than \`scripts/bank-sign.sh\` gets neither.
1b. The Bank's POLICY is procedure. Its SIGNATURE is mandatory and on-chain; which transactions it agrees to sign is a tool a human runs.
2. A coverage refusal in \`cosign.mjs\` has no override flag. "A human can sign by hand" is rhetorical.
3. The Bank may still be named \`payer\` INSIDE the pair itself; the confinement exempts both approved instructions entirely.
4. The allowlist permits a bare Core \`BurnV1\` of a SECOND vault beside a real redemption.
5. The judge never looks at where the swept money goes.
6. An aborted \`flock\` run is indistinguishable in the log from one that never fired.
7. A wedged-but-alive holder is a permanent silent skip under \`flock -n\`.
8. Cross-pass correlation lag: a CRITICAL that already went out is never retracted.
9. \`detectNestedVaults\` cannot see a FOREIGN Core asset nested in a vault.
10. No fresh per-cycle swap operator wallet; one trusted hop in \`revenue.mjs\`.
11. Distribution reconciles against a ledger the payer wrote.
12. COMPUTE UNITS are unmeasured anywhere. **This one got worse this round — see R1.**
13. MINT carries a dead \`redemption\` attribute stamp and an Attributes plugin delegated to a SEAL PDA that no longer writes attributes.
14. Duplicate attribute keys are not rejected at mint.
15. A vault minted during an open proposal may vote.
16. The LEVEL REGISTER IS OFF-CHAIN and there is no commitment scheme yet, so "assigned by fate, cannot be appealed" is the Bank's word rather than something a holder can verify. The proposed fix (publish a hash of the sealed assignment before activation, reveal after) is NOT BUILT.
17. \`EMISSION_MIN_PER_VAULT\` is PROVISIONAL at 21 sats and has not been ratified by the owner.
18. The randomness source for level assignment, the \$CBOB upgrade cost ladder, and whether upgrades open only after the first FOMC are ALL still open and are deliberately absent from the code. Do not treat their absence as an oversight; DO tell us if the code has accidentally assumed one of them.

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

REPORT FORMAT. Order by target: R1-R6, then the carry-over list, then the verdict challenges, then anything else. Findings CRITICAL / HIGH / MEDIUM / LOW. For each: the exact construct, what an attacker or an accident gains, the evidence that would exist if you are right, and the fix. End with one section: GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that sixteen rounds of AI audit structurally cannot? Be concrete and do not repeat the answers already in SPEC.md's THE SHIP GATE.

=====================================================================
THE DIFF UNDER AUDIT (2f84b40..HEAD) — every repair round 15 and 16 made, in one place
=====================================================================
${DIFF}

=====================================================================
THE AUTHOR'S OWN VERDICT ON ROUND 15 — attack it
=====================================================================
${f('audits/round16/VERDICT.md')}

=====================================================================
THE FULL TREE AS IT STANDS
=====================================================================
=== ⚠️ NEVER AUDITED IN SIXTEEN ROUNDS: Cargo.toml — THE BUILD CONFIGURATION ===
This file carries \`overflow-checks = true\`, which has been quoted to every auditor
in every round as MEASURED FACT 6 — in a file no auditor has ever been shown. Read
it as the thing the arithmetic argument actually rests on, and check the profile
it applies to, the release profile the deploy uses, the dependency versions and
anything else that changes what the compiled program does.
${f('Cargo.toml')}

=== ⚠️ NEVER AUDITED IN SIXTEEN ROUNDS: Anchor.toml — TOOLCHAIN AND CLUSTER PINS ===
${f('Anchor.toml')}

=== bank/cosign.mjs — THE BANK'S CO-SIGNER (round 15 rewrote its judgement) ===
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

=== ⚠️ NEVER AUDITED IN SEVENTEEN ROUNDS: scripts/bank-sign.sh — THE ONE SANCTIONED PATH TO A BANK SIGNATURE ===
${f('scripts/bank-sign.sh')}

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
  fs.writeFileSync(`${OUT}/${process.env.TAG||'v17'}-${o.model.replace(/[\/.]/g,'_')}.md`,o.text)
  console.log(`${o.model.padEnd(30)} ${o.ok?`${o.secs}s ${o.usage}`:`FAILED after ${o.secs}s`} chars=${o.text.length}`)
}
async function main(){
  console.log(`prompt chars=${PROMPT.length}  models=${MODELS.length}`)
  await Promise.all(MODELS.map(m=>ask(m).then(land)))
}
main().catch(e=>console.error('FATAL',e?.message||e))
