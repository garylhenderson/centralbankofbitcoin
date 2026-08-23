/** Round 19 — EVERYTHING SINCE ROUND 17'S FIXES, AND NONE OF IT HAS BEEN READ.
 *
 *  Three commits are the subject and no auditor has seen any of them:
 *    982e5ef  round 18 programs — the mint_vault payer-slot CRITICAL's fix
 *    6368a11  round 18 off-chain — fourteen repairs
 *    7f2f5a7  the SELF-AUDIT of those repairs — four more, two of which were
 *             the exact defect class the repairs were written to close
 *
 *  THE OFF-CHAIN PASS OF ROUND 18 REPORTED EIGHT AUDITORS AND HAD SIX. One
 *  returned a 41-byte fetch error and one degenerated into a repetition loop
 *  (4,149 lines, 163 unique, zero findings); both were written to disk as
 *  reports and the runner exited 0. Fixed here — see disqualify() — and this
 *  round REFUSES to exit 0 below quorum. Read MANIFEST-<focus>.json before
 *  believing any claim about how many models actually read this.
 *
 *  AND THE SELF-AUDIT IS THE POINT. The builder audited its own repairs and
 *  found four more defects, one of which shipped an escaped interpolation as
 *  LITERAL TEXT because tsc cannot see inside a template literal. A builder
 *  auditing itself is the weakest arrangement available. THIS round is the
 *  independent one. */
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
/** EVERY ID VERIFIED AGAINST `GET /api/v1/models` (422 models) ON 2026-08-23,
 *  and verified AGAIN at runtime below before a single token is spent. A guessed
 *  model id is a FABRICATED one: round 18's first roster invented
 *  `deepseek/deepseek-v4` and `mistralai/mistral-large-3`, OpenRouter refused
 *  both, and two of eight auditors were silently missing from that round.
 *
 *  NONE OF THESE EIGHT WAS USED IN ROUND 18 — the ship gate requires the second
 *  of two clean rounds to change roster. Round 18 used grok-4.20, sonnet-5,
 *  gpt-5.6-sol-pro, gpt-5.5-pro, deepseek-v4-flash-0731, qwen3-max,
 *  mistral-large-2512 and command-a. `claude-fable-5` has never audited this
 *  project at all; the other seven last read it at round 17, before any of the
 *  code this round is about existed. IF ROUND 20 IS THE SECOND CLEAN ROUND IT
 *  MUST DIFFER FROM THIS LIST. */
const MODELS=(process.env.MODELS||[
  'anthropic/claude-opus-5',
  'anthropic/claude-fable-5',
  'openai/gpt-5.6-luna-pro',
  'openai/gpt-5.6-terra-pro',
  'google/gemini-3.1-pro-preview',
  'moonshotai/kimi-k3',
  'z-ai/glm-5.3',
  'x-ai/grok-4.6',
].join(',')).split(',')
const OUT=process.env.OUTDIR||'/opt/cbob-vaults/audits/round19'
const R='/opt/cbob-vaults'
/** 'programs' or 'offchain'. Two focused rounds every model RECEIVES beat one
 *  round nobody does — see the bundle note in the prompt. */
const FOCUS=process.env.FOCUS||'programs'
const f=(p:string)=>fs.readFileSync(`${R}/${p}`,'utf8')
/** THE DIFF IS THE SUBJECT OF THIS ROUND, so it is IN the prompt rather than left
 *  for the auditor to reconstruct from two versions of a file they never saw. */
const DIFF=execSync(`cd ${R} && git diff ec7d17e..HEAD -- programs bank scripts tests`,
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
const PROMPT=`You are an independent security auditor. These four Solana programs and the off-chain pipeline beside them will hold and move real Bitcoin (cbBTC) belonging to real customers. FIND FAULTS. Assume the author is wrong until proven otherwise. Do NOT confirm their work and do not praise it.

=====================================================================
READ THIS FIRST. IT CHANGES YOUR JOB.
=====================================================================
**THERE IS NO HUMAN AUDIT FIRM. THIS PROCESS IS THE CERTIFICATION.**

Every round before the last was written as if a professional firm would eventually review a frozen version and catch what the models missed. The owner ruled on 2026-08-22 that there will be no such firm: this system will be audited by AI or not at all. So calibrate accordingly — a finding you decline to write because "someone else will catch it" is a finding nobody writes, and the money is real.

That cuts BOTH ways, and the second half matters as much as the first. Fifteen rounds have produced roughly a third of "CRITICAL" findings that were WRONG on measurement — a headline its own body refuted, invented sysvar mechanics, a Borsh claim contradicted by mints that demonstrably work on a validator, one recommendation that would have DESTROYED customer SOL, and a confident claim that Core's BurnV1 closes the asset account (it does not; measured). With no firm downstream to sort the real from the imagined, a wrong CRITICAL costs real engineering time and can push a correct design into a wrong change. So: before you write a finding, ask what evidence would exist on-chain, or in a test run, if your claim were true — and SAY what that evidence is, so it can be checked.

All four programs pass a ${FLOORS.onchain}-assertion suite on a local validator running REAL Metaplex Core cloned from mainnet, minting real vaults and moving real SPL tokens; plus ${FLOORS.detector} off-chain detector assertions proven in both directions, ${FLOORS.alloc} allocation, and ${FLOORS.mainnet} against live mainnet. Every one of those numbers sits behind a FLOOR, so a suite that stops early fails rather than passing what it reached. A claim that contradicts a measured run is a claim about your own reasoning.

=====================================================================
THE PRIMARY TARGET: THREE COMMITS NO AUDITOR HAS SEEN.
=====================================================================
The complete diff ec7d17e..HEAD is at the end and IS the subject of this round. It carries round 18's programs fix, round 18's fourteen off-chain fixes, and the builder's SELF-AUDIT of those fixes. EIGHT ROUNDS RUNNING have found their worst defect in the previous round's repairs, and the self-audit already found four inside this very code. Assume there are more. Attack these in order.

**R1. THE SELF-AUDIT'S OWN REPAIRS. NEWEST CODE, LEAST READ, HIGHEST PRIOR.**
The builder audited its own round-18 repairs and found four defects. Every fix for those four is unaudited, and a source auditing itself is the weakest review arrangement that exists.
  - \${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT in the audit prompt: a backslash-escaped \${ renders as the placeholder, not the value, and tsc passes because it is valid TypeScript. It was caught only by RENDERING the prompt and reading the output. **Are there other template-literal or escaping defects in this diff that reading the source cannot see? Render it, do not read it.**
  - isTableRow was hoisted because the repair had added TWO more copies of the same predicate to the very gate that exists to stop documents drifting apart. **Is one definition now genuinely used everywhere it should be, and is the hoisted predicate itself correct?**
  - bank/distribute.mjs now clears BOTH refused and nothingToDo when a plan proceeds, because nothingToDo's only reader SUPPRESSES distribution_unfinished. **Is clearing both correct in EVERY ordering — quiet then pay, refuse then pay, pay then crash then resume, two runs in one day, a --dry-run in between? Can a day now lose a flag it needed?**
  - The manifest stopped trimming git porcelain output. **Check the record it writes is well-formed.**

**R2. THE ROUND-18 OFF-CHAIN REPAIRS (bank/distribute.mjs).**
  - settledAsPayout() was added because holdDays accepted ONE of paymentState's five answers, so a HAND-PAID day was invisible to the cadence (measured 52 where 2 was right). New rule: a bare resolvedBy does NOT reset the clock; only resolvedAs: 'paid' does. **That default was chosen on the argument that not resetting pays people SOONER. VERIFY THAT DIRECTION.** Trace what a LARGER holdDays does through decideEmission and the 31-day ceiling and say whether it pays earlier or later. If the builder had the direction backwards, the default is backwards and holders wait.
  - **paymentState was deliberately left unchanged so a resolved row is never re-sent.** Is that still true for every caller now that a second function reads the same rows?
  - The refusal branch now calls NOTIFY and sets process.exitCode = 1. **A halt any stranger can trigger now pages a human on every daily run. Is that right, or has a griefing surface become a paging surface?** The exit code is NOT suppressed under --dry-run.
  - census() returns a spread of a null-prototype object and denominator() uses Object.hasOwn. **Does the census still serialise into the ledger and back? Is there a consumer that needed a normal prototype?**
  - The dust bound was corrected from "up to denominator-1 (6,404)" to "under one sat per paid vault (2,099 max)". **Re-derive it. Is dust < activated.length ALWAYS true, including when available is smaller than the vault count, and when some vaults are skipped?**

**R3. scripts/bank-sign.sh — THE CANONICAL BASE64 ROUND TRIP.**
The alphabet + padding + length checks were measured to accept ====, A===, AB==, AAB= and AAAA====, all decoding to bytes that re-encode differently. It now decodes and re-encodes with coreutils and demands equality.
  - **Find an input it accepts that still decodes to something other than what was pasted.** Consider embedded whitespace, very long inputs, locale, base64 -w0 availability, and what set -euo pipefail does to a failing pipeline inside a command substitution.
  - **Does it reject anything LEGITIMATE?** A real 1232-byte transaction is 1644 base64 characters.
  - The comment claiming the transaction "is not in ps" was corrected, because it IS: the last line is exec node bank/cosign.mjs --tx "$TX". **Is the corrected comment now true?**

**R4. scripts/cron-install.sh — THE MONEY CLAIM.**
The header used to say NOTHING HERE MOVES MONEY UNTIL --live. False: revenue.mjs is opt-IN (--live) but distribute.mjs is opt-OUT (--dry-run) and is installed WITHOUT it, so installing the crontab arms a live cbBTC sender from the next 09:07. The header now states both jobs separately.
  - **Is the new header true, completely?** Enumerate every job the script installs and say for each whether it can move money as installed. Read the crontab lines; do not take the header's word for it.

**R5. THE GATES ADDED OR CHANGED (bank/selftest.mjs).**
  - The BankKeyOutside* arm now checks the CONTROL TABLE rows rather than the whole SPEC. **Is isTableRow a sound definition of a row? What table shape does it miss, and can a real control row fail to match it?**
  - A new arm parses the MintVault account struct and asserts MINT_IX_BANK_IDX is the real index of bank. **Is the struct-body regex sound?** It is non-greedy to the first newline-brace. What inside an Anchor account struct could terminate it early, and would that fail closed or open?
  - The exec-scraping arm now strips comment lines first, because a comment ABOUT the exec line broke it. **Is codeOnly correct for shell? What is a # that is not a comment?**
  - Two new arms assert that a stale nothingToDo suppresses distribution_unfinished. **Do they prove what they claim?**

**R6. THE COUNTS AND THE ARITHMETIC, INDEPENDENTLY.**
The assertion floors quoted above are now READ from scripts/run-tests.sh rather than typed. **Verify them against the files.** Then independently re-derive the schedule's published figures: census 108/60/36/24/12 -> 732; 945/525/315/210/105 -> 6,405; the ten per-1,000-dollar figures; five shares summing to 100.0%. A wrong number on a customer-facing card is the most expensive defect available here.

**R7. WHAT THE SELF-AUDIT MISSED.**
The builder found four defects in its own repairs and then declared, after a sweep, that settledAsPayout is the ONLY site asking the cadence question and that no other paymentState caller conflates the same thing. **Check that claim.** More generally: for EVERY fix in this diff, ask whether it was applied to all the sites of its own shape. One-of-N-sites is this project's single most repeated defect and it has now recurred INSIDE the fix for a one-of-N-sites round.

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
- Money: income -> the MINT ["revenue"] PDA -> sweep_sol_for_swap (on-chain, permissionless, destination PINNED) -> a Jupiter swap OFF-CHAIN, the one trusted hop -> cbBTC back to the revenue PDA -> split_revenue (on-chain, enforced 85/15) -> daily payout WEIGHTED BY LEVEL (I-V, weights 2/3/4/5/6) to vaults holding at least 21,000 sats; whether a given day PAYS is volume-driven, and the dust carries to the next drop rather than being split.

REPORT FORMAT. Order by target: R1-R6, then the carry-over list, then the verdict challenges, then anything else. Findings CRITICAL / HIGH / MEDIUM / LOW. For each: the exact construct, what an attacker or an accident gains, the evidence that would exist if you are right, and the fix. End with one section: GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that sixteen rounds of AI audit structurally cannot? Be concrete and do not repeat the answers already in SPEC.md's THE SHIP GATE.

=====================================================================
THE DIFF UNDER AUDIT (2c8cd9b..HEAD) — every repair round 17 made, in one place
=====================================================================
${DIFF}

=====================================================================
THE AUTHOR'S OWN VERDICT ON ROUND 15 — attack it
=====================================================================
(round 17's verdict is being written; its findings are summarised above)

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

${FOCUS === 'programs' ? `
=== SEAL: programs/cbob-vaults/src/lib.rs — the confinement and its seen_self guard ===
${f('programs/cbob-vaults/src/lib.rs')}

=== MINT: programs/cbob-vault-mint/src/lib.rs — ROUND 17'S CRITICAL WAS HERE ===
${f('programs/cbob-vault-mint/src/lib.rs')}

=== BURN: programs/cbob-vault-burn/src/lib.rs — the reciprocal preceding-open check R1 leans on ===
${f('programs/cbob-vault-burn/src/lib.rs')}
` : `
=== bank/distribute.mjs — THE MONEY PATH: weights, cadence, holdDays, refusals ===
${f('bank/distribute.mjs')}

=== bank/cosign.mjs — the Bank's pre-signature policy ===
${f('bank/cosign.mjs')}

=== scripts/bank-sign.sh — the one sanctioned path to a Bank signature ===
${f('scripts/bank-sign.sh')}

=== scripts/cron-install.sh — what actually runs unattended ===
${f('scripts/cron-install.sh')}
`}
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
    return {model,ok:true,text,inTok:u.prompt_tokens||0,outTok:u.completion_tokens||0,finish:j.choices?.[0]?.finish_reason,secs:Math.round((Date.now()-t0)/1000),usage:`in=${u.prompt_tokens} out=${u.completion_tokens} finish=${j.choices?.[0]?.finish_reason}`}
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
const MIN_AUDITORS=Number(process.env.MIN_AUDITORS||Math.ceil(MODELS.length*0.75))
const RESULTS:any[]=[]
/** WHAT DISQUALIFIES A READER. Each of these was observed, not imagined. */
function disqualify(o:any):string|null{
  if(!o.ok) return 'request failed'
  if(o.finish==='length') return 'output cut off mid-report'
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
  fs.writeFileSync(`${OUT}/${process.env.TAG||('v19-'+FOCUS)}-${o.model.replace(/[\/.]/g,'_')}.md`,o.text)
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
}
async function main(){
  fs.mkdirSync(OUT,{recursive:true})
  await verifyRoster()
  console.log(`prompt chars=${PROMPT.length}  focus=${FOCUS}  models=${MODELS.length}`)
  const head=execSync('cd '+R+' && git rev-parse HEAD').toString().trim()
  // NOT .trim(): git status --porcelain prefixes every line with a two-char
  // status field, so trimming the BLOB eats the first line's leading space and
  // misaligns it against every other row of the record.
  const dirty=execSync('cd '+R+' && git status --porcelain -- programs bank scripts tests').toString()
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
  if(dirty) console.log('  ⚠️ programs/bank/scripts/tests are DIRTY — this round did not audit a fixed tree')
  if(good.length<MIN_AUDITORS){
    console.error(`\nROUND FAILED: ${good.length} usable reports, ${MIN_AUDITORS} required. Do not write a verdict from this.`)
    process.exitCode=1
  }
}
main().catch(e=>{console.error('FATAL',e?.message||e);process.exitCode=1})
