/** Round 20 — THE LEVEL IS A NUMBER THAT DECIDES MONEY, AND NOBODY HAS READ IT.
 *
 *  Five commits are the subject and no auditor has seen any of them:
 *    d7775d4  compute units MEASURED — accepted limit 17 discharged
 *    d927cb6  levels at mint, stage 1 — the PROGRAM owns the level
 *    c664e3c  levels at mint, stage 2 — the committed deck, and the packet bound
 *    7ce5bf3  levels at mint, stage 3 — levels.json deleted, level read off chain
 *    PHASE 1  audits/FREEZE.md — the accepted limits written down, plus the four
 *             defects that writing them down uncovered
 *
 *  ⚠️ `bank/deck.mjs` HAS NEVER BEEN SENT TO AN AUDITOR IN TWENTY ROUNDS.
 *  `scripts/audit-coverage.sh` names it as the ONE uncovered file in the tree. It
 *  is 182 lines that decide which vault gets which payout weight forever, and it
 *  is most of the reason this round exists.
 *
 *  WHAT CHANGED ABOUT THE SYSTEM, not merely about the code: until d927cb6 the
 *  `attributes` map on a vault held provenance — a Notice serial, a Governor
 *  standing — and nothing read it for a number. It now carries `level`, which
 *  multiplies every payout that vault will ever receive. A map that was
 *  decoration is now a money oracle, and every property that was merely tidy
 *  about it is now load-bearing.
 *
 *  ROUND 19 WAS NOT CLEAN: sixteen findings, and the counter is still zero.
 *  Rounds 17, 18 and 19 all audited a MOVING tree. Phase 1 is now executed and
 *  Phase 2 (the freeze) is the commit this round reads, so IF THIS ROUND IS CLEAN
 *  IT IS THE FIRST OF THE TWO. Round 21 must then use a roster different from
 *  this one against the same untouched tree. */

import * as fs from 'fs'
import { execSync } from 'child_process'
const K=(fs.readFileSync('/opt/gary-club/.env.local','utf8').match(/^OPENROUTER_API_KEY=(.*)$/m)||[])[1]
/** ROUND 20'S ROSTER. Every id was verified against `GET /api/v1/models` (419
 *  models) on 2026-08-24 and is verified AGAIN at runtime below, before a token
 *  is spent — a guessed model id is a fabricated one, and round 18 ran two
 *  auditors short on two invented names nobody checked.
 *
 *  ⚠️ NONE OF THESE EIGHT APPEARS IN ROUND 19'S ROSTER (opus-5, gpt-5.6-luna-pro,
 *  gpt-5.6-terra-pro, grok-4.6, grok-4.5, deepseek-v4-pro, minimax-m3,
 *  opus-4.8). Eight models re-reading a tree they have just read is one round run
 *  twice, and agreement with yourself is not independence.
 *
 *  AND FOUR MODELS ARE EXCLUDED FOR MEASURED, STRUCTURAL REASONS rather than for
 *  taste — round 19 paid for each of these once:
 *    claude-fable-5     REFUSES BY POLICY. finish_reason content_filter,
 *                       "violative cyber content". A security audit of our own
 *                       code reads as offensive tooling to it. It can never
 *                       audit this project.
 *    kimi-k3            returns reasoning and no content, on both passes.
 *    gemini-3.1-pro     finish_reason `length` on both, 63,996 of 64,000 output
 *                       tokens spent on reasoning before the report began.
 *    glm-5.3            the same, on both passes.
 *  Raising MAX_OUT from 64,000 to 128,000 may well have fixed the last two. They
 *  are still left out of THIS round, because a certification round is not the
 *  place to test that.
 *
 *  Every id below states a context window of at least 1,000,000 tokens and an
 *  output ceiling of at least MAX_OUT or none at all, both checked below. */

const MODELS=(process.env.MODELS||[
  'anthropic/claude-opus-4.7',
  'anthropic/claude-sonnet-5',
  'x-ai/grok-4.20',
  'openai/gpt-5.6-sol-pro',
  'openai/gpt-5.5-pro',
  'deepseek/deepseek-v4-flash',
  'meituan/longcat-2.0',
  'qwen/qwen3.8-2.4t-a95b',
].join(',')).split(',')
const OUT=process.env.OUTDIR||'/opt/cbob-vaults/audits/round20'
const R='/opt/cbob-vaults'
/** 'programs' or 'offchain'. Two focused rounds every model RECEIVES beat one
 *  round nobody does — see the bundle note in the prompt. */
const FOCUS=process.env.FOCUS||'programs'
const f=(p:string)=>fs.readFileSync(`${R}/${p}`,'utf8')
/** THE DIFF IS THE SUBJECT OF THIS ROUND, so it is IN the prompt rather than left
 *  for the auditor to reconstruct from two versions of a file they never saw. */
const DIFF=execSync(`cd ${R} && git diff acce0c1..HEAD -- programs bank scripts tests`,
  {maxBuffer:64*1024*1024}).toString()

/** ⚠️ READ THE FLOORS, DO NOT TYPE THEM. Round 18 measured this prompt telling
 *  every auditor the suite holds 279/388/45 assertions when the real floors were
 *  284/395/56, and describing the payout as "daily equal" months after it became
 *  weighted by level. Auditors were handed the wrong architecture while auditing
 *  the allocator that implements the right one. A number duplicated into a
 *  document is a number that drifts — this repository's most repeated defect,
 *  committed inside the instrument that certifies it. So they are read from the
 *  files that enforce them, and can never disagree again. */
const grab=(f:string,re:RegExp,what:string)=>{const m=f.match(re); if(!m) throw new Error('could not read '+what+' — the floor moved or was renamed; fix this before running a round'); return Number(m[1])}
const RT=f('scripts/run-tests.sh')
const FLOORS={
  onchain: grab(RT,/^MIN_ASSERTIONS=(\d+)/m,'MIN_ASSERTIONS'),
  detector: grab(RT,/^DET_FLOOR=(\d+)/m,'DET_FLOOR'),
  alloc: grab(RT,/^ALLOC_FLOOR=(\d+)/m,'ALLOC_FLOOR'),
  mainnet: grab(RT,/^MAINNET_FLOOR=(\d+)/m,'MAINNET_FLOOR'),
}
/** ⚠️ ROUND 19: THE PROMPT ASKED ABOUT FILES IT DID NOT DELIVER, and an auditor
 *  measured it. R5 is entirely about `bank/selftest.mjs`; R1's whole question
 *  turns on `bank/detectors.mjs`; the third target is about SPEC's control
 *  table. **None of the three was in either bundle**, and the last two are not
 *  in the diff either — `SPEC.md` because the diff pathspec excludes it. On the
 *  programs pass, R2/R3/R4 asked about `distribute.mjs`, `bank-sign.sh` and
 *  `cron-install.sh`, none of which were delivered.
 *
 *  So four of seven numbered targets were answered from diff hunks, which is
 *  exactly how a confident wrong finding gets written — and this round produced
 *  two of those (a `pinnedAccountData` claim refuted by a default parameter in a
 *  file that was not bundled, and a "documented nowhere" claim about a
 *  constraint SPEC documents in bold).
 *
 *  ONE LIST now drives both the bundle and the check, so they cannot drift. */
const TARGETS: [string,string][] = FOCUS === 'programs' ? [
  ['programs/cbob-vault-mint/src/lib.rs','MINT — the level, the quota, the deck proof, the confinement. THE SUBJECT.'],
  ['bank/deck.mjs',                      'THE DECK — 182 lines NO AUDITOR HAS EVER SEEN, and they decide payout weights'],
  ['programs/cbob-vaults/src/lib.rs',    'SEAL — holds the Attributes plugin authority the level lives under'],
  ['programs/cbob-vault-burn/src/lib.rs','BURN — the other half of the redemption pair'],
  ['tests/3prog.test.ts',                'THE SUITE — sections 10 and 11 are this round\'s new assertions'],
  ['bank/selftest.mjs',                  'THE GATES — R5 is entirely about this file'],
  ['bank/distribute.mjs',                'R3 — where the level becomes money'],
  ['bank/detectors.mjs',                 'R6 — the under-claim corrected in Phase 1 lives here'],
  ['bank/cosign.mjs',                    "the Bank's pre-signature policy, and the control R6 says was under-claimed"],
  ['scripts/run-tests.sh',               'R7 asks you to verify the floors AGAINST THIS FILE'],
  ['scripts/bank-sign.sh',               'the one sanctioned path to a Bank signature'],
  ['scripts/cron-install.sh',            'what actually runs unattended'],
  ['scripts/audit-coverage.sh',          'R1 — the gate that names bank/deck.mjs as never audited'],
  ['SPEC.md',                            'ACCEPTED LIMITS and the control table — the diff pathspec cannot see this file'],
] : [
  ['bank/distribute.mjs',                'THE MONEY PATH — the level is now read off the chain here. THE SUBJECT.'],
  ['bank/deck.mjs',                      'THE DECK — 182 lines NO AUDITOR HAS EVER SEEN, and they decide payout weights'],
  ['programs/cbob-vault-mint/src/lib.rs','MINT — where the level is written, and the only thing that can write it'],
  ['bank/detectors.mjs',                 'R6 — the under-claim corrected in Phase 1 lives here'],
  ['bank/cosign.mjs',                    "the Bank's pre-signature policy, and the control R6 says was under-claimed"],
  ['bank/selftest.mjs',                  'THE GATES — R5 is entirely about this file'],
  ['scripts/bank-sign.sh',               'the one sanctioned path to a Bank signature'],
  ['scripts/cron-install.sh',            'what actually runs unattended'],
  ['tests/3prog.test.ts',                'THE SUITE — sections 10 and 11 are this round\'s new assertions'],
  ['programs/cbob-vaults/src/lib.rs',    'SEAL — holds the Attributes plugin authority the level lives under'],
  ['programs/cbob-vault-burn/src/lib.rs','BURN — the other half of the redemption pair'],
  ['scripts/run-tests.sh',               'R7 asks you to verify the floors AGAINST THIS FILE'],
  ['scripts/audit-coverage.sh',          'R1 — the gate that names bank/deck.mjs as never audited'],
  ['SPEC.md',                            'ACCEPTED LIMITS and the control table — the diff pathspec cannot see this file'],
]
/** REFUSE TO SPEND ON A BUNDLE THAT DOES NOT CONTAIN ITS OWN TARGETS. Same shape
 *  as verifyRoster(): a fabricated model id and an undelivered target file are
 *  both "the round did not do what it says it did", caught before any tokens. */
for(const [path] of TARGETS){
  if(!fs.existsSync(`${R}/${path}`)) throw new Error(`target ${path} does not exist — refusing to ask auditors about a file the bundle cannot contain`)
  if(fs.statSync(`${R}/${path}`).size===0) throw new Error(`target ${path} is empty`)
}
/** ⚠️ THE ACCEPTED LIMITS ARE READ FROM SPEC.md, NEVER TYPED HERE.
 *
 *  Round 19's prompt carried its own hand-written copy of the list, and Phase 1
 *  measured what that costs: the prompt's item 16 was "the level register is
 *  off-chain" while `audits/FREEZE.md`'s item 16 was the Bank-as-fee-payer gap on
 *  the mint path. TWO DOCUMENTS, TWO DIFFERENT LISTS, THE SAME NUMBERS — in the
 *  one artifact whose entire purpose is to stop a limit being re-reported as new.
 *  A number duplicated into a document is a number that drifts, which is this
 *  repository's most repeated defect, and it had been committed inside the
 *  instrument that certifies it. Exactly the same reasoning as the floors above.
 *
 *  So SPEC.md is the single source and this throws if the section is missing or
 *  implausibly short, rather than quietly shipping a round with no limits list —
 *  which would make every one of them a fresh finding and reset the counter. */
const ACCEPTED_LIMITS=(()=>{
  const spec=f('SPEC.md')
  const start=spec.indexOf('## ACCEPTED LIMITS')
  if(start<0) throw new Error('SPEC.md has no "## ACCEPTED LIMITS" section — Phase 1 of audits/FREEZE.md is what writes it, and a round run without it re-reports every limit as new')
  const rest=spec.slice(start)
  const nextHeading=rest.slice(3).search(/\n## /)
  const section=nextHeading<0?rest:rest.slice(0,nextHeading+4)
  if(section.length<4000) throw new Error(`the ACCEPTED LIMITS section is only ${section.length} chars — that is not the list, refusing to run a round against a truncated one`)
  return section
})()
const BUNDLE = TARGETS.map(([path,why]) => `\n=== ${path} — ${why} ===\n${f(path)}`).join('\n')

const PROMPT=`You are an independent security auditor. These four Solana programs and the off-chain pipeline beside them will hold and move real Bitcoin (cbBTC) belonging to real customers. FIND FAULTS. Assume the author is wrong until proven otherwise. Do NOT confirm their work and do not praise it.

=====================================================================
READ THIS FIRST. IT CHANGES YOUR JOB.
=====================================================================
**THERE IS NO HUMAN AUDIT FIRM. THIS PROCESS IS THE CERTIFICATION.**

Every round before the last was written as if a professional firm would eventually review a frozen version and catch what the models missed. The owner ruled on 2026-08-22 that there will be no such firm: this system will be audited by AI or not at all. So calibrate accordingly — a finding you decline to write because "someone else will catch it" is a finding nobody writes, and the money is real.

That cuts BOTH ways, and the second half matters as much as the first. Fifteen rounds have produced roughly a third of "CRITICAL" findings that were WRONG on measurement — a headline its own body refuted, invented sysvar mechanics, a Borsh claim contradicted by mints that demonstrably work on a validator, one recommendation that would have DESTROYED customer SOL, and a confident claim that Core's BurnV1 closes the asset account (it does not; measured). With no firm downstream to sort the real from the imagined, a wrong CRITICAL costs real engineering time and can push a correct design into a wrong change. So: before you write a finding, ask what evidence would exist on-chain, or in a test run, if your claim were true — and SAY what that evidence is, so it can be checked.

All four programs pass a ${FLOORS.onchain}-assertion suite on a local validator running REAL Metaplex Core cloned from mainnet, minting real vaults and moving real SPL tokens; plus ${FLOORS.detector} off-chain detector assertions proven in both directions, ${FLOORS.alloc} allocation, and ${FLOORS.mainnet} against live mainnet. Every one of those numbers sits behind a FLOOR, so a suite that stops early fails rather than passing what it reached. A claim that contradicts a measured run is a claim about your own reasoning.

=====================================================================
THE PRIMARY TARGET: FIVE COMMITS NO AUDITOR HAS SEEN, AND A NEW MONEY ORACLE.
=====================================================================
The complete diff acce0c1..HEAD is at the end and IS the subject of this round. Until these commits, a vault's \`attributes\` map held provenance and NOTHING READ IT FOR A NUMBER. It now carries \`level\`, which multiplies every payout that vault will ever receive. A map that was decoration is now a money oracle, so every property that was merely tidy about it is load-bearing.

EIGHT ROUNDS RUNNING have found their worst defect in the PREVIOUS round's repairs. Attack these in order.

**R1. \`bank/deck.mjs\` — 182 LINES NO AUDITOR HAS READ IN TWENTY ROUNDS.**
\`scripts/audit-coverage.sh\` names it as the single uncovered file in this tree. It builds the committed deck that decides which vault gets which weight, forever, and the root is committed ONCE and can never be replaced.
  - The seed is \`sha256(bank_salt ‖ blockhash(slot X))\` with \`sha256(bank_salt)\` published first. **Is that binding?** What stops the Bank choosing a salt AFTER seeing the blockhash, or choosing among many salts to move a particular index to Level V? What stops it choosing the SLOT? Say precisely what a cheating Bank has to do and whether anything here prevents it.
  - **What happens if the Bank never reveals the salt at all?** Who can check the deal then, and what is the holder's recourse? Is that a limit, a defect, or an unfalsifiable claim?
  - The leaf is \`sha256(tag ‖ index_le ‖ level)\` and the index is \`minted_total\`, which the program owns. **Attack the Merkle construction itself**: second-preimage across leaf and internal nodes, an odd-node promotion rule, duplicate leaves, a proof that validates against the wrong index, depth ambiguity, and whether the tag actually separates the two hash domains.
  - **TWO IMPLEMENTATIONS OF ONE HASH SCHEME.** This file is JavaScript and \`programs/cbob-vault-mint/src/lib.rs\` verifies its proofs in Rust. This project's most repeated defect is one fact with two readers. Reading them side by side proves nothing — say what would have to be true for them to disagree in a way the suite would NOT catch.

**R2. THE LEVEL ON CHAIN (\`programs/cbob-vault-mint/src/lib.rs\`).**
  - \`level\` is a RESERVED attribute key, refused from callers, and the program appends exactly one. **Can a caller get a level it was not dealt?** Consider the reserved-key check, the duplicate-key check, case, unicode, empty keys, and the hand-built \`CreateV2\` byte blob — the attribute count is written as \`attributes.len() + 1\` and the plugin data is assembled by hand.
  - \`level_caps\` is a per-level on-chain quota and \`level_minted\` counts up. **Can the quota be overrun, or a level be starved?** What happens when one level's cap is exhausted but the deck still deals that card at the next index — does minting halt for everybody, and is that the intended behaviour?
  - **The deck proof and the confinement now share one instruction.** Trace \`mint_vault\` start to finish and say whether any check can be skipped by ordering, by an account substitution, or by a transaction shape nobody tried.

**R3. THE LEVEL AT PAYOUT (\`bank/distribute.mjs\`).**
\`levels.json\` is deleted. The level is now read per vault with Core's own \`fetchAsset\` — deliberately NOT DAS, because DAS fail-open has cost this project three defects — and \`levelFromAttributes\` requires EXACTLY ONE \`level\` attribute.
  - **NOTHING HAS EVER RUN THIS AGAINST A LIVE CHAIN.** It is accepted limit 22, OPEN AND BLOCKING. Assume it runs tomorrow over ~2,100 vaults: what breaks? Rate limits, paging, partial failure, a transient RPC error on vault 1,900 of 2,100, cost.
  - A vault whose level cannot be read HALTS THE WHOLE DISTRIBUTION rather than being excluded. **Is that reachable by an ordinary customer action?** The claim is that it is not, because the level is written at mint and there is no activated-but-unlevelled window. **Try to find one.**
  - \`allocateWeighted\` refuses when any activated vault carries no level. **Verify the arithmetic**: weights 2/3/4/5/6, the census, the denominator, the dust that carries rather than being split, and whether two vaults at the same level can ever receive different amounts.

**R4. THE PACKET BOUND IS A PRODUCT CONSTRAINT (\`tests/3prog.test.ts\`, section 11).**
The deck proof shares the 1,232-byte transaction with the caller's attributes, so the attribute budget FALLS as deck depth rises. It is a PACKET bound, not the Borsh \`MAX_ATTRS\`. Measured in the suite at depth 7 (a 90-card test deck): seven caller attributes fit and the eighth does not serialize.
  - **The real census is 2,100 vaults, which is depth 11.** Re-derive the budget at that depth. Does the number of provenance attributes the product actually needs still fit? The deck root is committed ONCE, so this cannot be fixed after minting opens.
  - Does anything in the code or the suite ASSERT the relationship, or is it only measured in a test that prints it?

**R5. PHASE 1'S OWN CHANGES — NEWEST CODE, LEAST READ, HIGHEST PRIOR.**
Writing the accepted limits down uncovered four defects and each fix is unaudited.
  - The stated-count gate in \`bank/selftest.mjs\` read ONE occurrence of each of three floors while SPEC states them more than once, so a second allocation count sat at 63 against a real 103 and THE SHIP GATE section said "thirteen rounds" six rounds late. It now uses \`matchAll\` over five floors. **Is the new gate sound? Do the five regexes match everything they should and nothing they should not? Does a floor SPEC stops mentioning fail, or silently pass?**
  - Three new suite arms assert that neither the OWNER nor the BANK can rewrite a minted level, and that the value survives. They rest on Core rejecting with \`0x1a\`, which is \`NoApprovals\` read out of the generated error map — NOT a deserialization failure. **Do those arms prove what they claim?** What ELSE could produce \`0x1a\` here, and is there an actor the two arms do not cover?
  - A comment in \`bank/detectors.mjs\` said NOTHING detects a foreign Core asset nested in a vault. That was an UNDER-claim: \`bank/cosign.mjs\` scans the asset-signer PDA and fails closed. The comment now says the gap is timing, not capability. **Is the corrected comment true?**

**R6. THE UNDER-CLAIM DIRECTION, WHICH NOTHING HERE IS INSTRUMENTED TO CATCH.**
Every gate in this repository checks that a claim is not too STRONG. The owner has twice caught the INVERSE — a place where the system is SAFER than its own documentation says — and Phase 1 caught a third in \`detectors.mjs\`. An under-claim is as much a defect as an over-claim and it invites somebody to build a control that already exists. **Find another.**

**R7. THE COUNTS AND THE ARITHMETIC, INDEPENDENTLY.**
The floors quoted above are READ from \`scripts/run-tests.sh\` rather than typed. **Verify them against the file.** Then independently re-derive the schedule's published figures: census 108/60/36/24/12 -> 732; 945/525/315/210/105 -> 6,405; the ten per-1,000-dollar figures; five shares summing to 100.0%. A wrong number on a customer-facing card is the most expensive defect available here.

**R8. ONE-OF-N-SITES.** For EVERY fix in this diff, ask whether it was applied to all the sites of its own shape. This is the project's single most repeated defect and it has already recurred inside the fix for a one-of-N-sites round.

=====================================================================
THE ACCEPTED LIMITS ARE THE MOST VALUABLE THING YOU CAN ATTACK
=====================================================================
The list below was written into SPEC.md BEFORE this round, deliberately, so that re-reporting a known limit does not reset a counter. It is reproduced here VERBATIM FROM SPEC.md — it is not a second copy maintained by hand, because a hand-maintained copy is how the previous round's prompt came to disagree with \`audits/FREEZE.md\` about what item 16 even was.

**Do not re-report these as new findings. DO tell us, and this is the single most valuable thing this round can produce:**
  1. **Is any limit WORSE than stated?** An accepted limit that is actually exploitable is the one thing a freeze would lock in.
  2. **Is anything listed as an accepted limit not actually a limit** — already closed, or closed by something the author did not notice?
  3. **Is any DISCHARGED item not actually discharged?** Each names the measurement that closed it. Check the measurement, not the claim.
  4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?**


${ACCEPTED_LIMITS}

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
- Money: income -> the MINT ["revenue"] PDA -> sweep_sol_for_swap (on-chain, permissionless, destination PINNED) -> a Jupiter swap OFF-CHAIN, the one trusted hop -> cbBTC back to the revenue PDA -> split_revenue (on-chain, enforced 85/15) -> daily payout WEIGHTED BY LEVEL (I-V, weights 2/3/4/5/6) to vaults holding at least 21,000 sats, where the level is written ON CHAIN at mint from a pre-committed deck and read back per vault with Core's own deserialiser; whether a given day PAYS is volume-driven, and the dust carries to the next drop rather than being split.

REPORT FORMAT. Order by target: R1-R8, then the four questions about the accepted limits, then anything else. Findings CRITICAL / HIGH / MEDIUM / LOW. For each: the exact construct, what an attacker or an accident gains, the evidence that would exist if you are right, and the fix. End with one section: GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that nineteen rounds of AI audit structurally cannot? Be concrete and do not repeat the answers already in SPEC.md's THE SHIP GATE.

=====================================================================
THE DIFF UNDER AUDIT (acce0c1..HEAD) — rounds 17 and 18's repairs and the self-audit, in one place
=====================================================================
${DIFF}

=====================================================================
THE FILES THIS ROUND IS ABOUT — AND WHY THIS BUNDLE IS SHORT ON PURPOSE
=====================================================================
⚠️ THIS BUNDLE IS FOCUSED ON PURPOSE, and the reason is worth one paragraph
because it is a correction. Round 17 shipped the ENTIRE tree — 909,000 characters
— and the author then concluded from \`usage.prompt_tokens\` that six of eight
auditors had been truncated. **That was wrong**: the chars-to-tokens ratio behind
it was assumed, never measured. Measured since, across two bundle sizes, it is
3.7-4.0 for grok-class, 3.5-3.8 for qwen-class and 2.3 for Anthropic-class — so
round 17's reported 250k-397k figures were FULL deliveries in different
tokenizers. A confident conclusion from an unverified constant, in the process
whose whole job is to catch exactly that.

The focus is kept anyway, for a better reason: a shorter bundle aimed at the diff
means every model spends its attention on the code that CHANGED rather than
re-reading 700k characters it has seen in earlier rounds. What is genuinely
measured now is OUTPUT truncation (\`finish_reason === 'length'\`), which really did
degrade gemini's round-17 report.

Everything omitted has been in at least one prompt across rounds 1-17;
\`scripts/audit-coverage.sh\` gates that and passes at 27 of 27 files. What is here
is the diff that IS this round's subject, plus the files it touches.

${BUNDLE}
`
/** ⚠️ A PROMPT MAY NOT ASK ABOUT A FILE IT DOES NOT DELIVER.
 *
 *  Round 19 measured this and it cost two confident wrong findings: R5 is entirely
 *  about `bank/selftest.mjs`, R1 turns on `bank/detectors.mjs`, the third target is
 *  about SPEC's control table — and NONE of the three was in either bundle. An
 *  auditor filed a `pinnedAccountData` defect refuted by a default parameter in a
 *  file it was never given, and a "documented nowhere" claim about a constraint
 *  SPEC states in bold.
 *
 *  The first repair added the three files and stopped there. A re-run auditor then
 *  showed the PROGRAMS pass still named FIVE files it did not deliver — R2, R3 and
 *  R4 are off-chain questions asked of both passes — with `bank/cosign.mjs` in
 *  neither the bundle nor the diff. One fix, one of two passes: the house defect,
 *  inside the repair for the house defect.
 *
 *  So it is mechanical now. Every `dir/file.ext` the numbered targets name must be
 *  bundled, and this throws BEFORE a single token is spent — the same shape as
 *  verifyRoster(). A question the auditor cannot answer from evidence is a question
 *  that gets answered from the diff hunk, which is how a wrong CRITICAL is born. */
{
  const targetSection=PROMPT.slice(PROMPT.indexOf('**R1.'),PROMPT.indexOf('THE ACCEPTED LIMITS ARE THE MOST VALUABLE'))
  const named=[...new Set([...targetSection.matchAll(/\b((?:programs|bank|scripts|tests)\/[\w./-]+\.(?:rs|mjs|sh|ts))\b/g)].map(m=>m[1]))]
  const delivered=new Set(TARGETS.map(([f])=>f))
  const undelivered=named.filter(f=>!delivered.has(f))
  if(undelivered.length) throw new Error(
    `the ${FOCUS} prompt asks about files it does not deliver: ${undelivered.join(', ')} — add them to TARGETS or stop asking. `+
    `An auditor answering from a diff hunk writes confident wrong findings, which round 19 paid for twice.`)
}

/** ONE HUNG MODEL MUST NOT LOSE THE ROUND. Rounds 6 and 7 both ran under a bare
 *  Promise.all with no deadline and no incremental write, so nothing at all
 *  reached disk until the slowest of eight returned. */
const DEADLINE_MS=Number(process.env.MODEL_TIMEOUT_MS||45*60_000)
/** ONE definition, used by the request AND by the capacity pre-flight.
 *
 *  ⚠️ RAISED 64,000 -> 128,000 BECAUSE THE CAP WAS BINDING ON THE BEST AUDITOR.
 *  Round 19's re-run lost `anthropic/claude-opus-5` to `finish_reason: length` at
 *  EXACTLY 64,000 output tokens — its first-run report had already spent 60,502,
 *  so the margin was one bundle-growth away from gone, and growing the bundle to
 *  fix the delivery gap consumed it. Two earlier models died the same way
 *  (gemini-3.1-pro and glm-5.3 each burned 63,996 of 64,000 on reasoning).
 *  A truncated report is correctly disqualified, so the cap did not corrupt a
 *  round — it silently made the round shorter, which is the same cost.
 *  Every model on the roster states support for at least this, checked below. */
const MAX_OUT=128000
async function ask(model:string){
  const t0=Date.now()
  const ctl=new AbortController()
  const timer=setTimeout(()=>ctl.abort(),DEADLINE_MS)
  try{
    const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',signal:ctl.signal,
      headers:{'Authorization':`Bearer ${K}`,'Content-Type':'application/json'},
      body:JSON.stringify({model,messages:[{role:'user',content:PROMPT}],max_tokens:MAX_OUT,temperature:0.2})})
    const j:any=await r.json()
    if(j.error) return {model,ok:false,text:`ERROR ${JSON.stringify(j.error).slice(0,600)}`,secs:0,usage:''}
    const m=j.choices?.[0]?.message
    // ROUND 19: carry the provider's own refusal text. Without it a policy block
    // reaches disk as an anonymous JSON blob and reads as a short report.
    const refusal=m?.refusal||j.choices?.[0]?.native_finish_reason==='refusal'&&'refused'||null
    const text=(m?.content&&m.content.trim())?m.content:(m?.reasoning?'[reasoning only]\n'+m.reasoning:JSON.stringify(j).slice(0,800))
    const u=j.usage||{}
    return {model,ok:true,text,refusal,inTok:u.prompt_tokens||0,outTok:u.completion_tokens||0,finish:j.choices?.[0]?.finish_reason,secs:Math.round((Date.now()-t0)/1000),usage:`in=${u.prompt_tokens} out=${u.completion_tokens} finish=${j.choices?.[0]?.finish_reason}`}
  }catch(e:any){ return {model,ok:false,text:`FETCH FAILED ${e.message}`,secs:Math.round((Date.now()-t0)/1000),usage:''} }
  finally{ clearTimeout(timer) }
}
/** Write as each one lands, not after all of them. */
/** ⚠️ REPORT THE RECEIPT, DO NOT JUDGE IT AGAINST A GUESSED RATIO.
 *
 *  A first version of this file declared any model under 95% of an ASSUMED
 *  chars-to-tokens ratio "NOT AN AUDITOR", and on that basis I told the owner six
 *  of round 17's eight auditors had been blind. It was wrong, and it was wrong in
 *  the most embarrassing available way: the ratio was never measured. Measured
 *  since, across two bundle sizes — grok 3.7-4.0 chars/token, qwen 3.5-3.8,
 *  Anthropic 2.3. Round 17's 909k-char prompt therefore SHOULD report ~250k for
 *  grok-class and ~390k for Anthropic-class, and it did. All eight received it.
 *  The outlier was the gpt-5.6 pair reporting 1.02M — about 0.9 chars per token,
 *  which is not a plausible text ratio — so they count something extra.
 *
 *  A confident conclusion from an unverified constant is the exact defect this
 *  process exists to catch, committed by the process itself. So: print the raw
 *  number, print tokens-per-char so a human can see the tokenizer, and flag only
 *  what is genuinely measurable — `finish_reason === 'length'`, which means the
 *  model ran out of OUTPUT and its report is cut off. That happened to gemini in
 *  round 17 (64k output tokens spent, 9k chars produced) and it is real. */
/** ⚠️ ROUND 18 FOUND THIS FILE GUILTY OF THE DEFECT IT EXISTS TO CATCH, and the
 *  proof is the round it was running at the time. Two auditors said the runner
 *  cannot fail; on the off-chain pass `anthropic/claude-sonnet-5` returned
 *  `FETCH FAILED Unexpected end of JSON input` (41 bytes) and
 *  `deepseek/deepseek-v4-flash-0731` degenerated into a repetition loop — 4,149
 *  lines, 163 of them unique, no findings, no report structure, just
 *  `[reasoning only]` and the same four sentences forever. The round reported
 *  EIGHT AUDITORS and had SIX. Nothing anywhere said so, and the script exited 0.
 *
 *  A certification runner that cannot fail is a gate that flatters its own
 *  margin — the single defect class this whole project is organised around —
 *  and it was sitting in the instrument doing the certifying. So an auditor is
 *  now COUNTED, not assumed, and the round exits non-zero when it did not get
 *  the readers it claims. */
// ⚠️ ROUND 19: THE QUORUM WAS AN UNGUARDED ENV OVERRIDE. Measured:
// `MIN_AUDITORS=0` gives 0, and `MIN_AUDITORS=x` gives NaN — and `good.length <
// NaN` is FALSE, so a round with ZERO usable reports exited 0 and wrote a
// manifest claiming quorum was met. A certification gate that an environment
// variable can switch off is the gate that flatters its own margin, one level up.
// The override may only ever RAISE the bar.
const QUORUM_FLOOR=Math.ceil(MODELS.length*0.75)
const MIN_AUDITORS=(()=>{
  const raw=process.env.MIN_AUDITORS
  if(raw===undefined) return QUORUM_FLOOR
  const n=Number(raw)
  if(!Number.isInteger(n)||n<QUORUM_FLOOR||n>MODELS.length)
    throw new Error(`MIN_AUDITORS=${JSON.stringify(raw)} is not a whole number in [${QUORUM_FLOOR}, ${MODELS.length}]. The quorum may be raised, never lowered.`)
  return n
})()
const RESULTS:any[]=[]
/** WHAT DISQUALIFIES A READER. Each of these was observed, not imagined. */
function disqualify(o:any):string|null{
  if(!o.ok) return 'request failed'
  if(o.finish==='length') return 'output cut off mid-report'
  // ⚠️ ROUND 19 COUNTED A PROVIDER REFUSAL AS AN AUDITOR, ON BOTH PASSES.
  // `anthropic/claude-fable-5` returned HTTP 200 with finish_reason
  // `content_filter`, native_finish_reason `refusal`, content null and reasoning
  // null: "This request triggered restrictions on violative cyber content and was
  // blocked under Anthropic's Usage Policy." The text fallback then wrote
  // `JSON.stringify(j).slice(0,800)` — EXACTLY 800 characters, which clears the
  // 600-char floor below — and every other arm passed it. The manifest recorded
  // `disqualified: null` and the round reported 3 and 5 auditors when it had 2
  // and 4.
  //
  // This is round 18's defect verbatim, inside the function written to end it.
  // The list of failure modes was an enumeration of what was OBSERVED LAST
  // ROUND, and the next round produced a mode not on the list. So it is now a
  // WHITELIST: the only terminal reason a real report ends with is `stop`.
  if(o.finish && o.finish!=='stop') return `provider ended the response as '${o.finish}', not 'stop'`
  if(o.refusal) return `provider refused: ${String(o.refusal).slice(0,120)}`
  // AND THE FALLBACK BLOB IS NOT A REPORT. When a provider returns neither
  // content nor reasoning, `ask()` stores the raw JSON envelope. That is a
  // corpse whatever its length, and it is recognisable: it is the response
  // object, so it starts with `{"` and parses.
  {
    const t0=(o.text||'').trim()
    if(t0.startsWith('{')){
      try{ const j=JSON.parse(t0); if(j&&(j.choices||j.error||j.id)) return 'raw response envelope, not a report' }
      catch{ /* a report may legitimately open with a brace; only a PARSEABLE envelope is a corpse */ }
    }
  }
  const t=(o.text||'').trim()
  if(!t) return 'empty report'
  if(/^(ERROR|FETCH FAILED)\b/.test(t)) return 'error body'
  if(t.startsWith('[reasoning only]')) return 'reasoning only, no report'
  if(t.length<600) return `report is ${t.length} chars — too short to be one`
  // A DEGENERATE LOOP IS NOT A REPORT. deepseek produced 222KB at a 4% unique-line
  // ratio. A real report does not repeat itself 25 times over.
  const lines=t.split('\n').filter((l:string)=>l.trim())
  if(lines.length>=200){
    const uniq=new Set(lines).size/lines.length
    if(uniq<0.35) return `degenerate repetition (${(uniq*100).toFixed(0)}% unique lines)`
  }
  return null
}
function land(o:any){
  fs.mkdirSync(OUT,{recursive:true})   // was absent: a missing OUT threw INTO a catch that only logged
  o.disqualified=disqualify(o)
  RESULTS.push(o)
  fs.writeFileSync(`${OUT}/${process.env.TAG||'v20'}-${FOCUS}-${o.model.replace(/[\/.]/g,'_')}.md`,o.text)
  const cpt = o.inTok ? (PROMPT.length/o.inTok).toFixed(2) : '?'
  const cut = o.disqualified ? `  ⚠️ NOT AN AUDITOR: ${o.disqualified}` : ''
  console.log(`${o.model.padEnd(34)} ${o.ok?`${o.secs}s`:'FAILED'} in=${String(o.inTok||0).padStart(8)} (${cpt} ch/tok) out=${String(o.outTok||0).padStart(6)} chars=${String(o.text.length).padStart(7)}${cut}`)
}
/** VERIFY THE ROSTER BEFORE SPENDING ANYTHING. Round 18's first roster carried
 *  two invented ids; OpenRouter refused them and that round silently ran two
 *  auditors short. This costs one GET and turns a fabricated name into a hard
 *  stop instead of a missing reader nobody counts. */
async function verifyRoster(){
  const r=await fetch('https://openrouter.ai/api/v1/models',{headers:{'Authorization':`Bearer ${K}`}})
  if(!r.ok) throw new Error(`could not fetch the model list (HTTP ${r.status}) — refusing to launch a round against unverified ids`)
  const j:any=await r.json()
  const live=new Set((j.data||[]).map((m:any)=>m.id))
  if(live.size<50) throw new Error(`the model list returned only ${live.size} entries — that is not the live list, refusing`)
  const bad=MODELS.filter(m=>!live.has(m))
  console.log(`roster: ${MODELS.length - bad.length}/${MODELS.length} ids present in a live list of ${live.size}`)
  if(bad.length) throw new Error(`these model ids DO NOT EXIST: ${bad.join(', ')} — a guessed model id is a fabricated one. Fix the roster; do not run a short round.`)
  // ⚠️ ROUND 19 (SECOND RUN): AND A REAL ID IS NOT A MODEL THAT CAN READ THIS.
  // Fixing the bundle gap grew the prompt, and two auditors were then REFUSED at
  // 400 for exceeding their context window — deepseek-v3.2 caps at 163,840 tokens
  // against ~191,000 requested, glm-4.7 at 204,800 against ~209,000. Both cost a
  // request, both landed on disk as "request failed", and the round went two
  // auditors short for a reason nothing checked. That is the fabricated-model-id
  // defect wearing a different face: the roster names a reader that cannot read.
  // Capacity is published, so it is a pre-flight, not a discovery.
  const ctx=new Map<string,number>((j.data||[]).map((m:any)=>[String(m.id),Number(m.context_length||0)]))
  // ⚠️ THIS IS A COARSE GUARD AND SAYS SO. The chars-per-token ratio is MEASURED
  // and it VARIES ENORMOUSLY by tokenizer — 0.87 for the gpt-5.6 pair (they count
  // something beyond text), 2.3 Anthropic-class, 3.5-3.9 grok/qwen-class. So no
  // single ratio predicts every model, and 2.3 is used only because it is the
  // densest text ratio observed. What this catches is a window that is grossly
  // too small, which is what actually happened; it is NOT a proof that a model
  // will fit. The provider's 400 remains the authority, and a model that still
  // gets refused is still disqualified. A guard, not a guarantee.
  const needIn=Math.ceil(PROMPT.length/2.3), need=needIn+MAX_OUT
  const small=MODELS.filter(m=>(ctx.get(m)||0)<need)
  // AND THE OUTPUT CEILING, which is a separate published number. A model whose
  // provider caps completions below MAX_OUT cannot finish a report of the length
  // this audit asks for, and it fails as `output cut off mid-report` — an auditor
  // lost to a limit that was knowable before spending.
  const maxOut=new Map<string,number>((j.data||[]).map((m:any)=>[String(m.id),Number(m?.top_provider?.max_completion_tokens||0)]))
  const shortOut=MODELS.filter(m=>{const c=maxOut.get(m)||0; return c>0&&c<MAX_OUT})
  if(shortOut.length) throw new Error(`these models cannot emit ${MAX_OUT} output tokens: ${shortOut.map(m=>`${m} (${maxOut.get(m)})`).join(', ')} — they would be truncated and disqualified. Lower MAX_OUT or change the roster.`)
  console.log(`context: this bundle needs about ${need.toLocaleString()} tokens (${needIn.toLocaleString()} in + ${MAX_OUT.toLocaleString()} out)`)
  if(small.length) throw new Error(`these models cannot hold this bundle: ${small.map(m=>`${m} (${ctx.get(m)||0})`).join(', ')} — they would be refused at 400 and counted as failures. Shrink the bundle or change the roster; do not pay for a request that cannot be read.`)
}
async function main(){
  fs.mkdirSync(OUT,{recursive:true})
  await verifyRoster()
  console.log(`prompt chars=${PROMPT.length}  focus=${FOCUS}  models=${MODELS.length}`)
  const head=execSync('cd '+R+' && git rev-parse HEAD').toString().trim()
  // NOT .trim(): git status --porcelain prefixes every line with a two-char
  // status field, so trimming the BLOB eats the first line's leading space and
  // misaligns it against every other row of the record.
  // ⚠️ ROUND 19: THE PATHSPEC COULD NOT SEE SPEC.md — and SPEC's control table is
  // the subject of a whole section of this prompt, so an uncommitted edit to it
  // was invisible to both DIFF and `dirty`.
  //
  // ⚠️ AND THE FIRST REPAIR OF THAT WENT TOO FAR, WHICH IS ITS OWN LESSON. Dropping
  // the pathspec entirely made the check cover `audits/` — which THIS ROUND WRITES
  // AS IT RUNS — so every round would have reported a dirty tree and failed itself.
  // Measured before it shipped. The scope is "everything the auditors are shown",
  // derived from TARGETS so it cannot drift from the bundle, plus the code paths
  // the diff covers. It is deliberately NOT the whole tree.
  const WATCHED=[...new Set(['programs','bank','scripts','tests',...TARGETS.map(([f])=>f)])].join(' ')
  const dirty=execSync('cd '+R+' && git status --porcelain -- '+WATCHED).toString()
  await Promise.all(MODELS.map(m=>ask(m).then(land)))

  // THE RECEIPT. A round's own claim about how many read it must be an artifact,
  // not a sentence in a verdict written afterwards from memory.
  const good=RESULTS.filter(r=>!r.disqualified)
  const bad=RESULTS.filter(r=>r.disqualified)
  fs.writeFileSync(`${OUT}/MANIFEST-${FOCUS}.json`,JSON.stringify({
    focus:FOCUS,head,dirty:dirty.split('\n').filter(Boolean),promptChars:PROMPT.length,
    requested:MODELS.length,auditors:good.length,required:MIN_AUDITORS,
    models:RESULTS.map(r=>({model:r.model,ok:r.ok,inTok:r.inTok||0,outTok:r.outTok||0,
      finish:r.finish||null,chars:(r.text||'').length,disqualified:r.disqualified||null})),
  },null,2))
  console.log(`\n${good.length}/${MODELS.length} real auditors (need ${MIN_AUDITORS})  head=${head.slice(0,7)}${dirty?'  ⚠️ DIRTY TREE':''}`)
  for(const r of bad) console.log(`  NOT COUNTED  ${r.model} — ${r.disqualified}`)
  // ⚠️ THE TREE MUST NOT MOVE UNDER THE ROUND. Round 18's two passes were built
  // from git diffs taken at two different HEADs, so the programs half and the
  // off-chain half audited different trees while being reported as one round.
  // ⚠️ ROUND 19: THIS WAS A console.log AND NOTHING ELSE. The comment above it
  // says "THE TREE MUST NOT MOVE UNDER THE ROUND" and the playbook calls a dirty
  // tree invalidating — while the code printed a warning and exited 0. Fixed for
  // quorum last round, not for the tree. It is a gate now.
  if(dirty){
    console.error('  ⚠️ THE TREE IS DIRTY — this round did not audit a fixed target.')
    process.exitCode=1
  }
  // AND THE TREE MUST NOT HAVE MOVED WHILE THE MODELS READ IT. The prompt is
  // built at module scope, before main() ever reads HEAD, so a commit landing in
  // between produced a manifest naming a commit the auditors never saw.
  const headAfter=execSync('cd '+R+' && git rev-parse HEAD').toString().trim()
  if(headAfter!==head){
    console.error(`  ⚠️ HEAD MOVED DURING THE ROUND: ${head.slice(0,7)} -> ${headAfter.slice(0,7)}. The reports describe the old tree.`)
    process.exitCode=1
  }
  // ⚠️ AND THE WORKING TREE MUST NOT HAVE MOVED EITHER, which is the half the
  // first version of this check missed. HEAD staying put proves nothing if the
  // files changed under the round — and that is not hypothetical: the author
  // edited these very files WHILE round 19's re-run was in flight, so the
  // manifest recorded a clean tree that had stopped being clean an hour earlier.
  // `dirty` is sampled BEFORE the requests, so on its own it is a claim about the
  // start, not about the round.
  const dirtyAfter=execSync('cd '+R+' && git status --porcelain -- '+WATCHED).toString()
  if(dirtyAfter!==dirty){
    console.error('  ⚠️ THE WORKING TREE CHANGED DURING THE ROUND. The reports describe files that no longer exist in that form.')
    process.exitCode=1
  }
  if(good.length<MIN_AUDITORS){
    console.error(`\nROUND FAILED: ${good.length} usable reports, ${MIN_AUDITORS} required. Do not write a verdict from this.`)
    process.exitCode=1
  }
}
/** ⚠️ RENDER THE PROMPT AND READ IT. THE SOURCE IS NOT THE THING THAT SHIPS.
 *
 *  Round 18 shipped `\${FLOORS.onchain}` to eight auditors AS LITERAL TEXT — a
 *  backslash-escaped `${` renders as the placeholder, and `tsc` passes because it
 *  is valid TypeScript. It was found only by rendering the prompt and looking at
 *  the output, and this round interpolates a 250-line section read out of SPEC.md,
 *  which is far more of the prompt than any previous round assembled at runtime.
 *
 *  `RENDER_ONLY=1 npx tsx scripts/audit20.ts` writes the prompt and spends
 *  nothing. Do it for BOTH focuses before launching. */
if(process.env.RENDER_ONLY){
  const out=`/tmp/audit20-prompt-${FOCUS}.txt`
  fs.writeFileSync(out,PROMPT)
  console.log(`rendered ${PROMPT.length} chars to ${out}`)
  // ⚠️ SCOPE IT TO THE AUTHORED PROSE. The first version scanned the WHOLE prompt
  // and reported ~300 "unresolved placeholders" — every one of them a real
  // template literal inside a bundled .ts/.mjs/.sh file, which is source we are
  // deliberately showing the auditors. A check that fires on its own payload is
  // noise, and noise is what gets scrolled past. The prose is everything before
  // the diff marker, and it is the only part this script actually assembles.
  const prose=PROMPT.slice(0,PROMPT.indexOf('THE DIFF UNDER AUDIT'))
  const bad=[...prose.matchAll(/\$\{[^}\n]{0,60}\}/g)].map(m=>m[0])
  if(bad.length) { console.error(`UNRESOLVED PLACEHOLDERS IN THE RENDERED PROSE: ${[...new Set(bad)].join(', ')}`); process.exitCode=1 }
  else console.log(`no unresolved \${...} placeholders in the ${prose.length}-char authored prose`)
  // AND THE LIMITS MUST HAVE ARRIVED. An empty interpolation is silent.
  if(!prose.includes('ACCEPTED — will not fix')||!prose.includes('OPEN AND BLOCKING')||!prose.includes('DISCHARGED'))
    { console.error('the ACCEPTED LIMITS section did not reach the rendered prompt'); process.exitCode=1 }
  else console.log('the ACCEPTED LIMITS section reached the artifact, all three states present')
} else {
main().catch(e=>{console.error('FATAL',e?.message||e);process.exitCode=1})
}
