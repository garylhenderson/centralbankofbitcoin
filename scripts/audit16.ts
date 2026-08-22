/** Round 16 — ROUND 15'S REPAIRS, and the two files that have never been read.
 *  Round 15 accepted twelve findings and fixed all twelve, including a CRITICAL
 *  in which the Bank's co-signer signed a theft. Every one of those fixes is
 *  unaudited code. FIVE ROUNDS RUNNING have found their worst defect in the
 *  previous round's repairs, and round 15's headline was a file written
 *  specifically to end a defect class that shipped carrying four of them.
 *  ALSO: `Cargo.toml` and `Anchor.toml` have never been in any audit prompt in
 *  sixteen rounds. `Cargo.toml` carries `overflow-checks = true` — quoted to
 *  every auditor in every round as measured fact 6, in a file none of them has
 *  ever seen. */
import * as fs from 'fs'
import { execSync } from 'child_process'
const K=(fs.readFileSync('/opt/gary-club/.env.local','utf8').match(/^OPENROUTER_API_KEY=(.*)$/m)||[])[1]
/** ⚠️ ROSTER CHANGED FROM ROUND 15. qwen died mid-stream last round and minimax
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
const OUT=process.env.OUTDIR||'/opt/cbob-vaults/audits/round16'
const R='/opt/cbob-vaults'
const f=(p:string)=>fs.readFileSync(`${R}/${p}`,'utf8')
/** THE DIFF IS THE SUBJECT OF THIS ROUND, so it is IN the prompt rather than left
 *  for the auditor to reconstruct from two versions of a file they never saw. */
const DIFF=execSync(`cd ${R} && git diff 2f84b40..HEAD -- programs bank scripts tests`,
  {maxBuffer:64*1024*1024}).toString()

const PROMPT=`You are an independent security auditor. These four Solana programs and the off-chain pipeline beside them will hold and move real Bitcoin (cbBTC) belonging to real customers. FIND FAULTS. Assume the author is wrong until proven otherwise. Do NOT confirm their work and do not praise it.

=====================================================================
READ THIS FIRST. IT CHANGES YOUR JOB.
=====================================================================
**THERE IS NO HUMAN AUDIT FIRM. THIS PROCESS IS THE CERTIFICATION.**

Every round before the last was written as if a professional firm would eventually review a frozen version and catch what the models missed. The owner ruled on 2026-08-22 that there will be no such firm: this system will be audited by AI or not at all. So calibrate accordingly — a finding you decline to write because "someone else will catch it" is a finding nobody writes, and the money is real.

That cuts BOTH ways, and the second half matters as much as the first. Fifteen rounds have produced roughly a third of "CRITICAL" findings that were WRONG on measurement — a headline its own body refuted, invented sysvar mechanics, a Borsh claim contradicted by mints that demonstrably work on a validator, one recommendation that would have DESTROYED customer SOL, and a confident claim that Core's BurnV1 closes the asset account (it does not; measured). With no firm downstream to sort the real from the imagined, a wrong CRITICAL costs real engineering time and can push a correct design into a wrong change. So: before you write a finding, ask what evidence would exist on-chain, or in a test run, if your claim were true — and SAY what that evidence is, so it can be checked.

All four programs pass a 270-assertion suite on a local validator running REAL Metaplex Core cloned from mainnet, minting real vaults and moving real SPL tokens; plus 328 off-chain detector assertions proven in both directions, 17 allocation, and 11 against live mainnet. A claim that contradicts a measured run is a claim about your own reasoning.

=====================================================================
THE PRIMARY TARGET: ROUND 15'S REPAIRS. NONE OF THEM HAS BEEN AUDITED.
=====================================================================
Round 15 ran against commit 2f84b40, accepted TWELVE findings and fixed all twelve. The complete diff 2f84b40..HEAD is at the end and is the subject of this round. FIVE ROUNDS RUNNING have found their worst defect in the previous round's repairs, and round 15's own headline was a file written specifically to END a defect class that shipped carrying four of them. Assume that again. Attack these in order.

**R1. THE CO-SIGNER'S NEW REFUSALS (\`judgeRedemptionTx\` in bank/detectors.mjs, wired in bank/cosign.mjs).**
Round 15 measured this, on a real serialized legacy transaction: \`[open_for_redemption, SystemProgram.transfer(from=BANK, to=attacker), burn_vault]\` returned \`ok:true\` with an EMPTY reasons array, and \`--live\` would have partial-signed it. A Solana signature authorises the whole message and the judge inspected only the pair. Four arms were added:
  1. the Bank's pubkey may appear ONLY in the two approved instructions;
  2. a program ALLOWLIST (Core, both token programs, ATA, ComputeBudget, System) that FAILS CLOSED when \`cfg.allowedPrograms\` is absent;
  3. the Bank may not be the fee payer;
  4. a durable-nonce transaction is refused outright.
  - **IS ARM 1 ACTUALLY COMPLETE?** It tests PRESENCE of the Bank's pubkey in an instruction's account list, not \`isSigner\`. Name a way to exercise the Bank's authority from an instruction that does NOT list the Bank. Address lookup tables, duplicate account metas, nested CPI, a program that reads the signer set from the instructions sysvar — take each seriously and say which are real.
  - The allowlist still permits **System, Core, both token programs, the ATA program and ComputeBudget** for any instruction that does not name the Bank. What can a customer do with those, in the same transaction, that the Bank should not put its name on? Consider: an in-transaction deposit into an undeclared PDA-owned account (the author states this defeats the coverage scan DETERMINISTICALLY rather than by luck, and carries it — is it worse than that?), a sweep whose destination is not the owner, a \`CloseAccount\` sending rent somewhere unexpected, Core instructions on OTHER assets.
  - The author declined to build a full redemption grammar and said so in the code. Is the line drawn in the right place, or does one of the permitted programs make the confinement moot?
  - \`classifyPdaTokenAccount\` now refuses any PDA-owned token account that is not exactly 165 bytes. The author states this is a GRIEFING SURFACE — anyone can create such an account for a vault's PDA for dust and block its clean redemption — and chose a visible block over an invisible loss. Is that the right call, and is the 165-byte test the right discriminator?
  - The DAS scan now fails closed on HTTP status and on response shape. Any remaining way for it to answer "owns nothing" when it does not know?

**R2. \`bank/lock.mjs\`'s RESTORE, AND THE \`flock\` THAT IS NOW LOAD-BEARING.**
Round 15 MEASURED a third runner claiming the pathname inside the restore window while the true holder was paying, and the old \`wx\`-and-swallow restore then DESTROYED the true holder's lock. The restore is now an atomic \`rename\` back and a failure to restore THROWS. \`releaseLock\` no longer returns true on ENOENT.
  - Walk the interleavings again, for TWO, THREE and FOUR racers. Is the true holder's lock now always preserved?
  - The author states plainly that this is a NARROWING and that no arrangement of \`rename\`, \`link\` and \`unlink\` is a compare-and-swap. **Is that claim true?** If there is a pure-filesystem exclusion algorithm that closes it without a native module, that is a real finding.
  - **The durable answer was installed in \`scripts/cron-install.sh\`: every money job now runs under \`flock -n\`.** Is that correct? Consider: the lock directory and its permissions, what \`-n\` does when the lock is held, whether an aborted run is distinguishable from a failed one in the log, what happens if \`/var/lock/cbob\` is not writable, and whether \`cd $R && $FLOCK ... node ...\` composes the way the author thinks under \`sh -c\` from cron.
  - Does \`judgeCronTemplate\` actually gate what it claims? It reads the TEMPLATE, not the installed crontab.

**R3. THE ACK ALLOWLIST.** \`applyAcks\` would downgrade ANY asset-scoped finding, so \`vault_burned:<asset>\` in \`bank/acks.json\` silenced the paging for a real bare Core BurnV1. It is now scoped to \`ACKABLE_KINDS\` = {vault_owns_itself, nested_vault, unredeemable_owner}, and an ack on any other kind is itself REPORTED at full severity.
  - Is that set right? Name a kind that belongs in it and is missing, or one in it that an operator can actually act on.
  - Can the refusal path itself be abused — e.g. by flooding the report with refused acks?

**R4. ROUND 16'S OWN REPAIRS, written today and unaudited by anyone:**
  - \`readProgramData\`: the drift watch hashed \`data.subarray(45)\` unconditionally, but an IMMUTABLE program's ELF starts at 13, so 32 bytes — including the ELF ENTRY POINT — were outside the fingerprint. Is 13/45 right? Is the \`Option\` tag really at byte 12?
  - \`BANK_KEYS\` + \`banks_disagree\`: three programs keep their own \`bank\` and rotate independently; nothing compared them and two of the three were not even watched. Is CRITICAL right, can it false-positive during a legitimate staged rotation, and does adding two keys to \`WATCH\` create noise?
  - The assertion that \`bank/alarm.mjs\` still contains \`if (s.err) continue\`. That guard, in a DIFFERENT file, is the only reason \`burn_via_program\`'s caller-supplied key cannot be borrowed to launder a bare burn. Is the reasoning sound — can a SUCCESSFUL transaction produce a \`burn_via_program\` finding for an asset that was not actually burned through our program?
  - The assertion that exactly one file in \`bank/\` reads the Bank key.
  - MINT's "strictly stronger" comment was corrected to say \`is_signer\` is TRUE for a PDA passed as a CPI signer. Is the corrected text now right?

**R5. THE COMMENTS, AGAIN.** SEVEN rounds running. Round 15 found three comments DENYING a control that now runs (SEAL's header, BURN's header, and SPEC's proven impossibility 2 contradicting SPEC's own control table two sections above it). The rule is that every such claim POINTS AT the control table in SPEC.md and never restates it. Read every header in the diff against what executes. Name each drift you find, in EITHER direction.

**R6. THE GATES THEMSELVES.** Round 15 fixed an assertion that could never fail — \`fsx.readdirSync(fsx.existsSync(L) ? '.' : '.')\`, a ternary whose two branches are the same string, scanning a directory the litter can never appear in. There are now 328 detector assertions, 270 on-chain, 17 allocation, 11 mainnet. **Find another assertion that cannot fail, or a floor that can be defeated.** Consider in particular the assertions added this round that read SOURCE FILES with regexes: what happens when the regex stops matching for a reason unrelated to the property?

=====================================================================
SECOND TARGET: THE CARRY-OVER LIST
=====================================================================
Round 15 accepted these and did NOT fix them. Tell us if any is worse than stated, or if a stated limit is actually exploitable:
  1. **NOTHING IS WIRED TO THE CO-SIGNER.** No cron, no service and no client calls \`bank/cosign.mjs\`, so nothing FORCES a redemption through it and a separate signer implementation bypasses every check in R1. It is a tool, not yet a control. The author added an assertion that exactly one file reads the Bank key; is that meaningful, and what is the smallest thing that would actually make this a control?
  2. The lock's three-way hole is not closed in-process; \`flock -n\` covers unattended runs only.
  3. Cross-pass correlation lag: a CRITICAL that already went out is never retracted.
  4. Compute units are unmeasured anywhere. Is there a CU ceiling below the measured 1232-byte ceiling?
  5. \`detectNestedVaults\` cannot see a FOREIGN Core asset nested in a vault.
  6. MINT still carries a dead redemption stamp and delegates the Attributes plugin to a SEAL PDA that no longer writes attributes.
  7. Distribution reconciles against a ledger the payer wrote; no fresh per-cycle swap operator wallet.
  8. Duplicate attribute keys at mint; a vault minted during a proposal may vote; a buyer cannot verify reserve continuity atomically.

=====================================================================
THIRD TARGET: ATTACK THE AUTHOR'S OWN VERDICT
=====================================================================
audits/round15/VERDICT.md is included below — what was accepted, what was rejected, and what was confirmed CORRECT by last round's auditors. Challenge all three. Attacking the verdict has produced a real finding twice. In particular:
  * REJECTED: "the co-signer never checks the vault's collection or its on-chain owner". The author's reason: SEAL and BURN both refuse a foreign asset (ForeignVault) and a non-owner (NotTheOwner) on chain, so a Bank signature on such a transaction buys nothing — it reverts. Is that complete? Is there a state in which a signature on a REVERTING transaction is itself worth something to an attacker?
  * REJECTED: "legacy-only parsing is a HIGH availability failure". The author kept the limitation because the direction it fails in is the correct one for a signer, and converted it to assertion 3.1i. Is fail-closed the right trade, given the project's own claim that a fourth reserve mint would need a v0 transaction?
  * REJECTED: "declare-everything bricks a vault". The author calls a coverage refusal a refusal to bless DESTRUCTION, states the griefing surface in SPEC, and points at the human escape. Is that defensible, or does it hand an attacker a cheap permanent denial of service?
  * REJECTED: "the judge does not verify owner and bank are actual signers" — Anchor's Signer constraints are the control. Confirm or refute.
  * If one of round 15's TWELVE fixes is wrong, or fixes the wrong thing, that is the highest-value finding in this round.

=====================================================================
KNOWN AND OPEN. DO NOT RE-REPORT AS NEW; DO tell us if any is worse than stated.
=====================================================================
  * **NOTHING IS WIRED TO THE CO-SIGNER** — it is a CLI nobody calls. Stated above as carry-over 1; report it only if it is worse than stated.
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

REPORT FORMAT. Order by target: R1-R6, then the carry-over list, then the verdict challenges, then anything else. Findings CRITICAL / HIGH / MEDIUM / LOW. For each: the exact construct, what an attacker or an accident gains, the evidence that would exist if you are right, and the fix. End with one section: GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that sixteen rounds of AI audit structurally cannot? Be concrete and do not repeat the answers already in SPEC.md's THE SHIP GATE.

=====================================================================
THE DIFF UNDER AUDIT (2f84b40..HEAD) — every repair round 15 and 16 made, in one place
=====================================================================
${DIFF}

=====================================================================
THE AUTHOR'S OWN VERDICT ON ROUND 15 — attack it
=====================================================================
${f('audits/round15/VERDICT.md')}

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
  fs.writeFileSync(`${OUT}/${process.env.TAG||'v16'}-${o.model.replace(/[\/.]/g,'_')}.md`,o.text)
  console.log(`${o.model.padEnd(30)} ${o.ok?`${o.secs}s ${o.usage}`:`FAILED after ${o.secs}s`} chars=${o.text.length}`)
}
async function main(){
  console.log(`prompt chars=${PROMPT.length}  models=${MODELS.length}`)
  await Promise.all(MODELS.map(m=>ask(m).then(land)))
}
main().catch(e=>console.error('FATAL',e?.message||e))
