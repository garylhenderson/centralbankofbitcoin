/** Round 23: the SECOND v6 round, against the tree that fixed round 22.
 *
 *  Round 22 (audits/round22/VERDICT-programs.md, VERDICT-offchain.md) found NO
 *  CRITICAL and NO HIGH in either pass, and was NOT clean: one LOW program edge
 *  (unsplit revenue around activation), one INFO tie, evidence gaps in the suite,
 *  and 27 confirmed off-chain defects (7 MEDIUM). Every one is fixed or recorded;
 *  the repairs are this round's highest-prior subject, because nine v5 rounds
 *  running found their worst defect in the previous round's repairs.
 *
 *  ROSTER: eight models, NONE of them in round 22's roster, from eight families,
 *  each re-verified at runtime against the live list, context and output ceiling.
 *  Same structural exclusions as round 22 (claude-fable-*, kimi-k3, gemini flash). */

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
  'anthropic/claude-sonnet-5.5',
  'openai/gpt-6-sol-pro',
  'openai/gpt-6-luna-pro',
  'x-ai/grok-4.6',
  'qwen/qwen3.8-max-0902',
  'z-ai/glm-5.3',
  'deepseek/deepseek-v4.1-flash',
  'minimax/minimax-m3',
].join(',')).split(',')
const OUT=process.env.OUTDIR||'/opt/cbob-vaults/audits/round23'
const R='/opt/cbob-vaults'
/** 'programs' or 'offchain'. Two focused rounds every model RECEIVES beat one
 *  round nobody does — see the bundle note in the prompt. */
const FOCUS=process.env.FOCUS||'programs'
const f=(p:string)=>fs.readFileSync(`${R}/${p}`,'utf8')
/** v6 HAS NO "PREVIOUS ROUND" TO DIFF AGAINST: the whole tree is the subject.
 *  The auditors get the commit list since v6 began, and the files whole. */
const V6_LOG=execSync(`cd ${R} && git log --oneline 3e564f2^..HEAD`,{maxBuffer:4*1024*1024}).toString()

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
  ['programs/cbob-vault-mint/src/lib.rs','MINT: mint, charter claim, level draw, the community pool, the guardian, every governed action. THE LARGEST SUBJECT.'],
  ['programs/cbob-vaults/src/lib.rs',    'SEAL: the seal, and the thaw that only exists on the way to a burn'],
  ['programs/cbob-vault-burn/src/lib.rs','BURN: the emptiness proof, the rolling-hour redemption cap, the retire CPI'],
  ['programs/cbob-vault-gov/src/lib.rs', 'GOV: one vault one vote, snapshots, the supermajority for key changes, logged skips'],
  ['tests/3prog.test.ts',                'THE SUITE: every claim above is an arm here; find the ones that cannot fail'],
  ['sim/test-vault.ts',                  'THE TEST VAULT SIMULATION: real Core, real mints, real Proof of Burn assets'],
  ['sim/clone-pob.mjs',                  'how the simulation clones the real Proof of Burn accounts, and the one field it changes'],
  ['scripts/run-tests.sh',               'the runner and its floors'],
  ['DESIGN-v6.md',                       "Gary's rulings: product decisions, NOT to be re-litigated, only checked against the code"],
  ['HOLDER-GUIDE.md',                    'the plain-English promises to holders: every sentence must be true of the code'],
  ['SPEC.md',                            'ACCEPTED LIMITS, the control table, the proven impossibilities'],
  ['audits/v6-redteam/RT3-stage3c.md',   'the last red-team pass and what it found'],
  ['audits/round22/VERDICT-programs.md',  'what round 22 found in these programs and what was done about each'],
  ['launch/mainnet-init.json',            'every value the four initialize calls will write ONCE, with its ruling'],
] : [
  ['bank/crank.mjs',                     'THE CRANK: layer one of everything automatic. THE SUBJECT.'],
  ['bank/detectors.mjs',                 "THE ALARM'S JUDGEMENT: every detector, both directions"],
  ['bank/alarm.mjs',                     "THE ALARM'S READS: what it fetches and what it pages on"],
  ['bank/layout.mjs',                    'every v6 account layout, declared once and asserted against the Rust'],
  ['bank/accrual.mjs',                   "the program's payout arithmetic, mirrored"],
  ['bank/revenue.mjs',                   'the swap hop: royalty SOL to cbBTC, the one trusted key'],
  ['bank/redemption-poster.mjs',         'the public redemption post (drafts only, no sender)'],
  ['bank/selftest.mjs',                  'THE GATES: find the arms that cannot fail'],
  ['bank/spl.mjs',                       'token account reads'],
  ['bank/anchor.mjs',                    'the pinned raw-offset reader'],
  ['bank/lock.mjs',                      'the run lock (round 22 changed it: confirmSole)'],
  ['bank/sigwalk.mjs',                   'the signature walk every scanner pages through (round 22 left it out)'],
  ['scripts/cron-install.sh',            'what actually runs unattended (round 22 left it out)'],
  ['scripts/check-launch-params.mjs',    'the gate on every launch value before it is signed (round 22 left it out)'],
  ['launch/mainnet-init.json',           'the launch values that gate judges'],
  ['launch/create-cbob-token.mjs',       'creates the $CBOB mint ONCE: one transaction, mint authority revoked, no freeze authority (new)'],
  ['audits/round22/VERDICT-offchain.md', 'what round 22 found off chain and what was done about each'],
  ['programs/cbob-vault-mint/src/lib.rs','MINT: what the crank and the alarm must agree with'],
  ['scripts/run-tests.sh',               'the runner and its floors'],
  ['SPEC.md',                            'ACCEPTED LIMITS and the control table'],
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

const PROG_TARGETS=`**R1. CUSTODY: CAN ANYONE BUT THE OWNER GET VALUE OUT OF A SEALED VAULT, OR AN EMPTIED VAULT SURVIVE?**
The seal (\`programs/cbob-vaults/src/lib.rs\`, \`open_for_redemption\`) thaws only when a top-level \`burn_vault\` for the same asset AND owner follows in the same transaction; \`programs/cbob-vault-burn/src/lib.rs\` burns only after a matching top-level open and an emptiness proof. In v6 there is NO Bank co-signature: the owner's signature plus these rules are the whole gate. Attack the pairing (CPI wrappers, two vaults in one transaction, account-index binding, instruction-sysvar parsing), the emptiness proof (Token-2022 extensions, delegates, close authorities, lamports, nested Core assets, declared-but-foreign accounts), and anything that lets a thawed vault leave a transaction unburned.

**R2. THE COMMUNITY POOL'S MONEY (\`programs/cbob-vault-mint/src/lib.rs\`).**
\`split_revenue\` 85/15 into a program-owned pool; a weighted accumulator (\`acc_scaled\`, \`owed_scaled\`, per-vault \`debt_scaled\`); TWO-STEP activation (\`activate\` requests; a vault JOINS only once \`dist_epoch\` has passed its request); \`JoinWaitingFirst\`: no distribution while any eligible-but-unjoined vault waits; \`distribute\` by a 100 $GARY burn or a free monthly path; \`monthly_inline\` riding inside mint, charter claim, activate, claim and the redemption's \`retire_redeemed\`; \`claim\` paying only into each vault's own recorded cbBTC account; \`retire_redeemed\` (refuses while a whole sat is owed, EXCEPT when the pool is frozen, where the share is forfeited to the pool) and \`retire_burned\`. **Prove or break the invariant "the pool always holds at least ceil(owed)", and "no vault is ever paid for revenue that arrived before it joined".** Look hard at every counter (\`pending_count\`, \`pending_this_epoch\`, \`active_count\`, \`total_active_weight\`) under every ordering of the host instructions, and at liveness: can anyone make distributions or redemptions impossible for others?

**R2b. THE $CBOB BOOST (NEW SINCE ROUND 22, built 2026-10-04 on the owner's ruling; the least-audited code here).** \`boost_vault\` (anyone burns \`boost_price\` of THE \`cbob_mint\` pinned at initialize for an ACTIVATED vault, which then weighs \`boost_weight\` more for the next \`boost_epochs\` distributions), \`expire_boosts\` (records only), \`set_boost_terms\` (GOV only, inside \`max_boost_weight\` / \`max_boost_epochs\` fixed at initialize), the per-record \`carry_scaled\` that \`reweigh\` moves what a vault is owed into, the \`boost_expiring\` ring of 64 and \`boosts_due\`, and the \`BoostsExpireFirst\` gate on \`distribute\` and \`monthly_inline\`. **Prove or break: a boost earns EXACTLY its N distributions and not one more; nothing a vault earned is lost or gained when its weight changes (by boost, expiry, claim normalisation, or retire); \`total_active_weight\`, \`boost_weight_total\`, \`boosts_active\`, \`boosts_due\` and the ring always agree; no record can be expired twice, early, or never; and nobody can make distributions impossible by boosting, by gifting a boost, or by a vault whose token account is gone.** Look at a boost bought in the same transaction as a distribution, a retire of a boosted vault in either state, and GOV's SetBoostTerms ordering.

**R3. THE LEVEL DRAW.** \`capture_entropy\` / \`reveal_level\` / \`reschedule_reveal\` and the crank that rides on four host instructions: three slot hashes from three leader groups after the mint, drawn WITHOUT REPLACEMENT from the remaining census, strictly in mint order (FIFO), a missed window rescheduled to a future slot, never defaulted. Check the SlotHashes parse, the skipped-slot handling, the FIFO, a burned vault at the head of the queue, the attribute re-supply hash, and what a minter, a crank operator or a slot leader can actually influence. The DESIGN states the residual grind as an accepted limit; say if it is WORSE than stated.

**R4. GOVERNANCE (\`programs/cbob-vault-gov/src/lib.rs\`).** One vault one vote bound to the ASSET; electorate fixed at creation (\`index_snapshot\`, live \`quorum_supply\`); no proposal before the charter window closes; quorum, threshold and a 10% YES turnout; a guardian change or a new swap operator needs YES from half of ALL live vaults, never in the same proposal, and lands only after a notice via a permissionless apply; the guardian may cancel a pending swap operator; \`TightenSweep\` only tighter and only inside bounds fixed at initialize; an overtaken action is a logged no-op (\`CBOB_ACTION_SKIPPED\`), not a revert. Find any way a minority carries what it should not, any way a vote reaches money it should not, and any way governance can be frozen forever.

**R5. THE CHARTER CLAIM.** \`claim_charter_vault\`: the Proof of Burn identified by ADDRESS against a Merkle root of 240 addresses (domain-separated, sorted pairs), CPI-burned as its owner in the same instruction, inside a window fixed at initialize that can never reopen, not gated by the guardian, and \`pob_extra\` accounts passed through to Core's burn never as signers. The Proof of Burn collection's update authority is a hot wallet we do not control (kept by ruling, alarmed). What can that wallet, a PoB holder or a third party do to a claim?

**R6. THE ONE-TIME CONFIGURATION AND THE TRUSTED HOP.** Every \`initialize\` across the four programs: what it accepts, what it refuses, and what a wrong-but-accepted value would lock in FOREVER once the upgrade authority is removed. The swap operator (\`sweep_sol_for_swap\`) is the one trusted key: bound its worst case. The 10% royalty is a Core plugin with authority None: confirm nothing in our programs or in Core lets anyone change it. The redemption cap (\`programs/cbob-vault-burn/src/lib.rs\`) is a rolling window over a 64-slot ring of timestamps: check it is exactly that.

**R7. CROSS-PROGRAM RAW READS.** GOV and BURN read MINT's config, GOV reads MINT's vault record and BURN's config, MINT and BURN read SEAL's config, all by raw offset pinned by discriminator and layout version. Recompute every offset and every account space from the struct definitions. A wrong offset here is a silent misread that the type system cannot see.

**R8. THE SUITE AND THE SIMULATION AS EVIDENCE.** \`tests/3prog.test.ts\` and the Test Vault simulation are what the claims above rest on. Find arms that cannot fail, arms whose negative fires for a different reason than the one named (the \`because()\` list pins many), and claims in this prompt that NO arm exercises.`

const OFF_TARGETS=`**R1. THE CRANK (\`bank/crank.mjs\`).** It plans and sends every permissionless job: reschedule, capture, reveal in mint order (re-sending each vault's minted attributes read off Core, hash-checked first), retire bare burns, join eligible vaults BEFORE distributing (the program refuses otherwise), the free monthly distribution, activation requests, and claim batches of 14. It signs only as fee payer with a key it refuses to use above 0.25 SOL. Find a plan the program will refuse (wasted fees, false pages), a plan that pays or joins a dead vault, a reveal it would send out of order, and anything that makes it move value anywhere the program does not already pin.

**R2. THE ALARM (\`bank/detectors.mjs\`, \`bank/alarm.mjs\`).** It must page on every change to a value that is fixed forever, on a pending guardian or swap operator, on the Proof of Burn collection's plugins or update authority, on the redemption window nearly full, on a frozen or insolvent pool, on a distribution overdue, and on upgrade authority past the lock date; and assert Gary's production values (21% / 51% / 3 days, 7-day notice, the tighten bounds, 30-day month, one-hour window). Find a dangerous on-chain state it reads as quiet, and a routine state it pages on every pass.

**R3. THE LAYOUTS (\`bank/layout.mjs\`).** Every account is declared once and asserted against the Rust struct; every cross-program pinned offset is asserted against it. Check the assertions are real (\`bank/selftest.mjs\`), and that a struct change could not slip past them.

**R4. THE MONEY ARITHMETIC (\`bank/accrual.mjs\`)** must equal the program's (\`programs/cbob-vault-mint/src/lib.rs\`: \`credit\`, \`claim\`, \`retire\`, \`ceil_sats\`, \`join\`). Find any divergence.

**R4b. THE BOOST OFF CHAIN (new).** The crank must expire every DUE boost before it distributes (or the program refuses) and every boost its own distribution makes due right after; its owed math must include \`boost_weight\` and \`carry_scaled\` exactly as MINT's \`owed_of\`; the alarm must page \`boosts_stalled\` and treat \`cbob_mint\` and the boost bounds as fixed forever. \`launch/create-cbob-token.mjs\` creates the \$CBOB mint in one transaction and revokes its mint authority: check it cannot leave a live mint authority, a freeze authority, or a partial supply.

**R5. THE SWAP HOP (\`bank/revenue.mjs\`).** Royalty SOL to cbBTC through the one trusted key. Bound its worst case, check the ledger cannot read a failed cycle as closed, and that nothing here can send value anywhere the program does not pin.

**R6. THE GATES (\`bank/selftest.mjs\`, \`scripts/run-tests.sh\`).** Find assertions that cannot fail, floors that can be satisfied by deleting work, and checks that pass vacuously when their input is empty.`

const PROMPT=`You are an independent security auditor. Four Solana programs and the off-chain pipeline beside them will hold real Bitcoin (cbBTC) and two other tokens for real holders, and once launched the programs will be IMMUTABLE: no upgrade authority will exist, so every surviving bug is permanent. FIND FAULTS. Assume the author is wrong until proven otherwise. Do not confirm their work and do not praise it.

=====================================================================
READ THIS FIRST. IT CHANGES YOUR JOB.
=====================================================================
**THERE IS NO HUMAN AUDIT FIRM. THIS PROCESS IS THE CERTIFICATION.** The owner ruled that this system will be audited by AI or not at all. A finding you decline to write because "someone else will catch it" is a finding nobody writes.

That cuts BOTH ways. Across 21 earlier rounds on the previous design, about a third of "CRITICAL" findings were WRONG on measurement: invented sysvar mechanics, a Borsh claim contradicted by working mints, a recommendation that would have destroyed customer SOL. With nobody downstream to sort real from imagined, a wrong CRITICAL costs real engineering time and can push a correct design into a wrong change. So before you write a finding, say what evidence would exist on chain or in a test run if your claim were true, so it can be checked.

The four programs pass a ${FLOORS.onchain}-assertion suite on a local validator running REAL Metaplex Core cloned from mainnet, minting real vaults and moving real SPL tokens; plus ${FLOORS.detector} off-chain detector assertions proven in both directions, ${FLOORS.alloc} allocation and ${FLOORS.mainnet} against live mainnet, every number behind a floor that must EQUAL the count. A Test Vault simulation runs one vault's whole life against real Core, the real cbBTC / $GARY / $GIRAFFISH mint accounts and two real mainnet Proof of Burn assets. A claim that contradicts a measured run is a claim about your own reasoning, unless you show the run is not measuring what it says.

THIS IS v6, A REDESIGN, AND THIS ROUND READS IT WHOLE. Nothing below is a diff: every line of the four programs is new to you. Three independent read-only red-team passes have read it (the last is bundled); none of them ran code.

**ROUND 22 READ THIS TREE BEFORE YOU, AND ITS REPAIRS ARE YOUR FIRST TARGET.** It found no CRITICAL and no HIGH, confirmed one LOW program edge (unsplit revenue around activation, put to the owner), one INFO tie (a stop and a restart in the same second), several suite arms that could not fail, and 27 off-chain defects, 7 of them MEDIUM. Its verdicts are bundled, finding by finding, with what was done. Across 21 earlier rounds the worst defect of a round was usually in the previous round's repairs. Check every repair: does it fix the finding, at every site of its shape, without breaking something next to it?

**THE OWNER'S RULINGS ARE NOT FINDINGS.** DESIGN-v6.md records product decisions (no Bank key, no admin, a guardian that can only stop, immutability, a 7-day charter window, 10% royalties forever, 85/15 forever, the 2.1%-per-hour redemption cap, 21% quorum / 51% threshold / 3-day votes, the Proof of Burn collection authority staying a hot wallet). Do not argue them. DO report where the code fails a ruling, where a ruling opens a hole the documents do not already accept, and where HOLDER-GUIDE.md promises something the code does not do.

=====================================================================
THE TARGETS, IN ORDER
=====================================================================
${FOCUS==='programs'?PROG_TARGETS:OFF_TARGETS}

=====================================================================
THE ACCEPTED LIMITS ARE THE MOST VALUABLE THING YOU CAN ATTACK
=====================================================================
Reproduced VERBATIM from SPEC.md. **Do not re-report these as new findings. DO tell us:**
  1. **Is any limit WORSE than stated?** An accepted limit that is actually exploitable is the one thing immutability locks in.
  2. **Is anything listed as a limit not actually a limit**, already closed, or closed by something the author did not notice?
  3. **Is any DISCHARGED item not actually discharged?**
  4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

${ACCEPTED_LIMITS}

=====================================================================
MEASURED FACTS. DO NOT RE-FILE THESE AS BUGS.
=====================================================================
1. A bare Core BurnV1 by the owner cannot be prevented while the vault stays freely transferable. There is no burn-only lock. \`retire_burned\` exists for exactly this.
2. Token accounts owned by a PDA cannot be enumerated on chain, and neither can nested Core assets. Undeclared airdrops and nested vaults are destroyed by a redemption; the redeem client warns before the owner signs.
3. A vault transferred to its own asset-signer PDA (or into another vault's) is bricked forever, and Core permits it.
4. Core BurnV1 does NOT sweep the asset-signer PDA's lamports (measured); dropping the lamports==0 check would destroy customer SOL.
5. Pubkey::is_on_curve is host-only and panics on BPF; an off-curve owner (a DAO, a multisig) cannot redeem.
6. overflow-checks = true, so arithmetic overflow ABORTS.
7. A burned asset's address is NOT re-mintable: the account survives, Core-owned, one byte, Key::Uninitialized, and a re-mint is refused (measured in the suite and the simulation).
8. INIT_AUTHORITY on mainnet is Gary's wallet Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb; \`--features localnet\` swaps in a test key; scripts/build-mainnet.sh proves which binary carries which key by behaviour.
9. Mainnet's rent rate is LOWER than solana-test-validator's default (650,240 vs 890,880 lamports for 0 bytes, measured 2026-10-03). The programs' constant \`RENT_EXEMPT_0_BYTES = 890_880\` is therefore stricter than mainnet needs, never looser.
10. cbBTC has a live freeze authority (Coinbase). A frozen vault account defers that vault's claim; a frozen POOL stops all claims, and a redemption then forfeits its undelivered share rather than locking the vault (by design, stated to holders).

=====================================================================
ARCHITECTURE (v6)
=====================================================================
- A vault is a Metaplex Core asset (CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d) in the CBOB collection, minted only by MINT. Contents live in Core's asset-signer PDA ["mpl-core-execute", asset]; ExecuteV1 makes that PDA sign and requires the owner. A PermanentFreezeExecute plugin, authority SEAL's ["seal"] PDA, keeps it sealed. Permanent plugins are create-only.
- FOUR programs: SEAL (seal, thaw-on-the-way-to-a-burn), MINT (config, rounds, mint, charter claim, level draw, pool, guardian stops, governed setters), BURN (burn, emptiness proof, rate limit, retire CPI into MINT), GOV (proposals, votes, execution by CPI into MINT signed by the ["gov"] PDA). Core is a fifth program we do not control. All four of ours become immutable at launch.
- Redemption: one transaction, owner alone: open_for_redemption (SEAL) ... claim (MINT, if owed) ... Execute sweeps (Core) ... burn_vault (BURN, which CPIs MINT retire_redeemed). No path leaves a surviving emptied vault; a partial sweep reverts the thaw.
- Money: mint prices are paid in cbBTC into MINT's ["revenue"] PDA; royalty SOL is swept by the one trusted swap operator off chain and returned as cbBTC; split_revenue sends 85% to the program pool and 15% to the CBOBTC Squads (permanent); distributions credit activated (joined) vaults by level weight 2/3/4/5/6; claims pay into each vault's own cbBTC account.

REPORT FORMAT. Order by target, then the four questions about the accepted limits, then anything else. Findings CRITICAL / HIGH / MEDIUM / LOW. For each: the exact construct (file and function), what an attacker or an accident gains, the evidence that would exist if you are right, and the fix. End with one section: GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot? Be concrete.

=====================================================================
THE v6 COMMITS, so you can see what each stage claimed
=====================================================================
${V6_LOG}

=====================================================================
THE FILES UNDER AUDIT, WHOLE
=====================================================================
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
  fs.writeFileSync(`${OUT}/${process.env.TAG||'v23'}-${FOCUS}-${o.model.replace(/[\/.]/g,'_')}.md`,o.text)
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
  // NOT a hardcoded round number: audit21 writing `audit20-prompt-*.txt` is a
  // stale label on an artifact, which is how a reader ends up reading the wrong
  // round's prompt and believing it.
  const out=`/tmp/${process.env.TAG||'v23'}-prompt-${FOCUS}.txt`
  fs.writeFileSync(out,PROMPT)
  console.log(`rendered ${PROMPT.length} chars to ${out}`)
  // ⚠️ SCOPE IT TO THE AUTHORED PROSE. The first version scanned the WHOLE prompt
  // and reported ~300 "unresolved placeholders" — every one of them a real
  // template literal inside a bundled .ts/.mjs/.sh file, which is source we are
  // deliberately showing the auditors. A check that fires on its own payload is
  // noise, and noise is what gets scrolled past. The prose is everything before
  // the diff marker, and it is the only part this script actually assembles.
  const prose=PROMPT.slice(0,PROMPT.indexOf('THE FILES UNDER AUDIT, WHOLE'))
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
