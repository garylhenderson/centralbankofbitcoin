/** Round 29: independent whole-tree audit following round 28. */
import * as fs from 'fs'
import { execSync } from 'child_process'
const K=(fs.readFileSync('/opt/gary-club/.env.local','utf8').match(/^OPENROUTER_API_KEY=(.*)$/m)||[])[1]
/** Round 29 has no model ID in common with round 28. Eight IDs in six
 * model families per pass; Anthropic and Qwen each have two seats. Runtime preflight
 * verifies availability, context and output limits. Round 27's stale Laguna and failed Fugu seats are replaced; independent triage must
 * reject non-substantive reports and validate the six-auditor quorum. */
const PROG_MODELS=['anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-4.8', 'qwen/qwen3.8-max-0902', 'qwen/qwen3.8-2.4t-a95b', 'z-ai/glm-5.3', 'meta/muse-spark-1.3', 'meituan/longcat-2.0', 'deepseek/deepseek-v4.1-flash']
const OFF_MODELS=[...PROG_MODELS]
const OUT=process.env.OUTDIR||'/opt/cbob-vaults/audits/round29'
const R='/opt/cbob-vaults'
/** 'programs' or 'offchain'. Two focused rounds every model RECEIVES beat one
 *  round nobody does — see the bundle note in the prompt. */
const FOCUS=process.env.FOCUS||'programs'
if(FOCUS!=='programs'&&FOCUS!=='offchain') throw new Error(`FOCUS=${JSON.stringify(FOCUS)} is neither 'programs' nor 'offchain'`)
const MODELS=(process.env.MODELS||(FOCUS==='programs'?PROG_MODELS:OFF_MODELS).join(',')).split(',')
// ROUND 24: BOTH OpenAI seats refused the programs pass (403 cyber_policy), which
// cost the round a rerun. A MODELS= override must not walk them back onto it.
if(FOCUS==='programs'&&MODELS.some(m=>m.startsWith('openai/')))
  throw new Error('an OpenAI model is on the programs roster; both refused that pass in round 24 (audits/round24/refused/). Remove it.')
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
 *  files that enforce them, and can never disagree again.
 *
 *  Round 25 adds the three floors round 24's prompt left out: the simulation's
 *  (sim/run-sim.sh), the swap fork's (sim/swap-fork.sh, new) and the launch
 *  gate's. The prompt states each, so each is read. */
const grab=(f:string,re:RegExp,what:string)=>{const m=f.match(re); if(!m) throw new Error('could not read '+what+' — the floor moved or was renamed; fix this before running a round'); return Number(m[1])}
const RT=f('scripts/run-tests.sh')
const FLOORS={
  onchain: grab(RT,/^MIN_ASSERTIONS=(\d+)/m,'MIN_ASSERTIONS'),
  detector: grab(RT,/^DET_FLOOR=(\d+)/m,'DET_FLOOR'),
  alloc: grab(RT,/^ALLOC_FLOOR=(\d+)/m,'ALLOC_FLOOR'),
  mainnet: grab(RT,/^MAINNET_FLOOR=(\d+)/m,'MAINNET_FLOOR'),
  launch: grab(RT,/^LAUNCH_FLOOR=(\d+)/m,'LAUNCH_FLOOR'),
  host: grab(RT,/^HOST_FLOOR=(\d+)/m,'HOST_FLOOR'),
  sim: grab(f('sim/run-sim.sh'),/^SIM_FLOOR=(\d+)/m,'SIM_FLOOR'),
  swap: grab(f('sim/swap-fork.sh'),/^SWAP_FLOOR=(\d+)/m,'SWAP_FLOOR'),
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
  ['scripts/pob-merkle.mjs', 'Proof-of-Burn Merkle proof construction; first delivered in round 26 after the coverage gate identified its omission'],
  ['scripts/rehearsal-tree.sh', 'throwaway-ID rehearsal tree, key preservation and reverse-map proof; first delivered in round 26'],
  ['programs/cbob-vault-mint/src/lib.rs','MINT: mint, charter claim, level draw, the community pool, the guardian, every governed action. THE LARGEST SUBJECT.'],
  ['programs/cbob-vaults/src/lib.rs',    'SEAL: the seal, and the thaw that only exists on the way to a burn'],
  ['programs/cbob-vault-burn/src/lib.rs','BURN: the emptiness proof, the rolling-hour redemption cap, the retire CPI'],
  ['programs/cbob-vault-gov/src/lib.rs', 'GOV: one vault one vote, snapshots, the supermajority for key changes, logged skips'],
  ['programs/cbob-vault-sweep/src/lib.rs','SWEEP (NEW, round 24 A3): the stateless helper every redemption calls through Core ExecuteV1. Audited in round 25; check its repairs.'],
  ['programs/cbob-vault-sweep/Cargo.toml','the sweep helper\'s crate: its features and its one dependency'],
  ['tests/3prog.test.ts',                'THE SUITE: every claim above is an arm here; find the ones that cannot fail'],
  ['sim/test-vault.ts',                  'THE TEST VAULT SIMULATION: real Core, real mints, real Proof of Burn assets'],
  ['sim/clone-pob.mjs',                  'how the simulation clones the real Proof of Burn accounts, and the one field it changes'],
  ['scripts/probe-mainnet-facts.mjs', 'mainnet facts: signature paging, reserve freeze authorities, Token-2022 ATA refusals and classic controls'],
  ['bank/txread.mjs', 'shared legacy/v0/v1 parsed history reader, validation and fail-closed coverage'],
  ['tests/fixtures/mainnet-v1.json', 'captured public successful v1 transaction used by the reader regression tests'],
  ['scripts/run-tests.sh',               'the runner and its floors'],
  ['scripts/build-mainnet.sh',           'builds the mainnet binaries and proves which key each carries; now FIVE programs, the sweep helper\'s bytes proven identical to the tested ones'],
  ['DESIGN-v6.md',                       "Gary's rulings: product decisions, NOT to be re-litigated, only checked against the code"],
  ['HOLDER-GUIDE.md',                    'the plain-English promises to holders: every sentence must be true of the code'],
  ['SPEC.md',                            'ACCEPTED LIMITS, the control table, the proven impossibilities, the REDEEMING steps'],
  ['audits/v6-redteam/RT3-stage3c.md',   'the last red-team pass and what it found'],
  ['audits/round28/VERDICT-programs.md', 'round 28 verdict and measurements; independently verify its findings and claims'],
  ['tests/cpi-wrapper/src/lib.rs',       'TEST-ONLY CPI forwarder the suite uses to attack the redemption path one level down (never deployed beyond the test validator)'],
  ['launch/mainnet-init.json',           'every value the four initialize calls will write ONCE, with its ruling'],
] : [
  ['scripts/rehearsal-tree.sh', 'throwaway-ID rehearsal tree and isolation from production keys; first delivered in round 26'],
  ['bank/crank.mjs',                     'THE CRANK: layer one of everything automatic. THE SUBJECT.'],
  ['bank/detectors.mjs',                 "THE ALARM'S JUDGEMENT: every detector, both directions"],
  ['bank/alarm.mjs',                     "THE ALARM'S READS: what it fetches and what it pages on (round 24 H1 rewrote its notify path)"],
  ['bank/layout.mjs',                    'every v6 account layout, declared once and asserted against the Rust'],
  ['bank/accrual.mjs',                   "the program's payout arithmetic, mirrored"],
  ['bank/swap.mjs',                      'THE SWAP (NEW, round 24 M1): Pyth floor, pinned Orca and Meteora pools, the instruction judge. Audited in round 25; check its repairs.'],
  ['bank/revenue.mjs',                   'the revenue cycle: sweep, swap (now through swap.mjs), return, split; the one trusted key (rewritten)'],
  ['sim/swap-fork.mjs',                  'the mainnet-fork proof of the swap (NEW)'],
  ['sim/swap-fork.sh',                   'the fork runner and its SWAP_FLOOR (NEW)'],
  ['bank/redemption-poster.mjs',         'the public redemption post (drafts only, no sender)'],
  ['bank/selftest.mjs',                  'THE GATES: find the arms that cannot fail'],
  ['bank/spl.mjs',                       'token account reads'],
  ['bank/anchor.mjs',                    'the pinned raw-offset reader'],
  ['bank/lock.mjs',                      'the run lock'],
  ['bank/sigwalk.mjs',                   'the signature walk every scanner pages through'],
  ['scripts/cron-install.sh',            'what actually runs unattended'],
  ['scripts/check-launch-params.mjs',    'the gate on every launch value before it is signed'],
  ['scripts/build-mainnet.sh',           'the mainnet build: five programs, which key each carries, the sweep helper\'s byte identity'],
  ['launch/mainnet-init.json',           'the launch values that gate judges'],
  ['launch/create-cbob-token.mjs',       'created the $CBOB mint ONCE (run 2026-10-04): one transaction, mint authority revoked, no freeze authority'],
  ['audits/round28/VERDICT-offchain.md', 'round 28 verdict and measurements; independently verify its findings and claims'],
  ['programs/cbob-vault-mint/src/lib.rs','MINT: what the crank, the alarm and the revenue cycle must agree with'],
  ['programs/cbob-vault-sweep/src/lib.rs','SWEEP (NEW): the redemption helper the alarm now watches and build-mainnet now builds'],
  ['scripts/probe-mainnet-facts.mjs', 'mainnet facts: signature paging, reserve freeze authorities, Token-2022 ATA refusals and classic controls'],
  ['bank/txread.mjs', 'shared legacy/v0/v1 parsed history reader, validation and fail-closed coverage'],
  ['tests/fixtures/mainnet-v1.json', 'captured public successful v1 transaction used by the reader regression tests'],
  ['scripts/run-tests.sh',               'the runner and its floors'],
  ['SPEC.md',                            'ACCEPTED LIMITS, the control table, the REDEEMING steps'],
  ['HOLDER-GUIDE.md',                    'the plain-English promises to holders: every sentence must be true of the code (round 24\'s confirmed falsehoods were all here)'],
  ['DESIGN-v6.md',                       "Gary's rulings: product decisions, NOT to be re-litigated, only checked against the code"],
  ['audits/v6-redteam/RT3-stage3c.md',   'the last red-team pass and what it found'],
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

const PROG_TARGETS=`**R0. ROUND 28'S VERDICT AND ANY REPAIRS.** The prior pass's full verdict is bundled. Read its actual result rather than assuming it was clean. Independently validate its confirmed findings, measurements, rejected claims, accepted limits and any resulting repairs against this tree. If it was clean, this is a second, independent audit of the unchanged code: test its conclusions from first principles. If it found defects, verify every repair at all sites of its shape and for regressions. Do not re-file an old claim merely because the prior verdict contains it; show a surviving defect. Check the suite, simulation, holder promises and operational gates along with the program logic.

**R1. CUSTODY: CAN ANYONE BUT THE OWNER GET VALUE OUT OF A SEALED VAULT, OR AN EMPTIED VAULT SURVIVE?**
The seal (\`programs/cbob-vaults/src/lib.rs\`, \`open_for_redemption\`) thaws only when a top-level \`burn_vault\` for the same asset AND owner follows in the same transaction; \`programs/cbob-vault-burn/src/lib.rs\` burns only after a matching top-level open and an emptiness proof. In v6 there is NO Bank co-signature: the owner's signature plus these rules are the whole gate. Attack the pairing (CPI wrappers, two vaults in one transaction, account-index binding, instruction-sysvar parsing), the emptiness proof (Token-2022 extensions, delegates, close authorities, lamports, nested Core assets, declared-but-foreign accounts), and anything that lets a thawed vault leave a transaction unburned.

**R1s. THE SWEEP HELPER (\`programs/cbob-vault-sweep/src/lib.rs\`, audited in round 25).** A native, stateless program with no key and no config. The redeem page calls it through Metaplex Core \`ExecuteV1\` between SEAL's open and BURN's burn; Core signs as the vault's asset-signer PDA. For each (source, destination) token-account pair it reads the LIVE balance, transfers all of it, closes the source (rent to the destination wallet), then sends every lamport of the asset-signer to the destination wallet. Prove or break:
  (a) **Nobody but the asset's owner can make it move value.** Called directly it needs the asset-signer's signature; through Core, Core decides who may \`ExecuteV1\`. Is that ONLY the owner (not an update authority, a delegate, a plugin authority such as SEAL's PermanentFreezeExecute PDA, or a collection authority)? Can it be reached while the vault is still frozen, i.e. outside a redemption, and what then?
  (b) **The pair list.** Any pair can be named: a source owned by the asset-signer (checked) and a destination owned by the ONE destination wallet with the same mint (checked). What if the same source appears twice, a destination appears twice, a source is also a destination, a source is a native wSOL account, a source has a delegate or close authority, an account is frozen, the destination is not an ATA, or the destination wallet is the vault's own asset-signer (refused) or another vault's asset-signer? What does an odd or zero-pair account list do?
  (c) **Destination checks.** The destination wallet is chosen by whoever builds the transaction, and the program does not compare it with the asset's owner. Given (a), is that safe? Does the lamport transfer to a destination below rent-exemption, or to a non-system account, fail in a way that blocks redemption?
  (d) **The lamport sweep.** It moves \`signer.lamports()\` read at execution, emptying a system account to zero. Can anything leave the asset-signer non-zero afterwards inside the same transaction (a later instruction depositing, Core itself), and does BURN's \`lamports == 0\` check still see exactly what the sweep left?
  (e) **Interaction with BURN's emptiness proof.** BURN requires every reserve mint's ATA under BOTH token programs to be DECLARED, and skips an account no token program owns. The sweep closes what it empties. Show the closed account passes for the right reason. What remains if a vault's reserve ATA does NOT EXIST when the page builds the transaction: the sweep cannot name it (it refuses a non-token account), but anyone can create a classic ATA for any owner, permissionlessly, and deposit into it before the redemption lands. SPEC's REDEEMING step 1 says the page creates the missing reserve accounts in a PRIOR transaction. Is that sufficient, and is there any account a stranger can create for the vault that neither the sweep can name nor BURN will skip (a Token-2022 ATA for a classic mint, a non-ATA token account, a nested Core asset)?
  (f) **Does it fit?** S8.0 in \`sim/test-vault.ts\` measures the three-asset redemption through the helper, claim included, inside one legacy transaction (1,232 bytes). Check what that measurement includes and what a real page adds (compute budget instructions, a fourth reserve, the in-line monthly run's accounts).
  (g) **Evidence.** SR.0-SR.4a in \`tests/3prog.test.ts\` and S8.* in the simulation. Find an arm that cannot fail, or one refused for a reason other than the one named. Is the helper deployed in the suite from the same bytes \`scripts/build-mainnet.sh\` proves?

**R2. THE COMMUNITY POOL'S MONEY (\`programs/cbob-vault-mint/src/lib.rs\`).**
\`split_revenue\` 85/15 into a program-owned pool; a weighted accumulator (\`acc_scaled\`, \`owed_scaled\`, per-vault \`debt_scaled\`); TWO-STEP activation (\`activate\` requests; a vault JOINS only once \`dist_epoch\` has passed its request); \`JoinWaitingFirst\`: no distribution while any eligible-but-unjoined vault waits; \`distribute\` by a 100 $GARY burn or a free monthly path; \`monthly_inline\` riding inside mint, charter claim, activate, claim and the redemption's \`retire_redeemed\`; \`claim\` paying only into each vault's own recorded cbBTC account; \`retire_redeemed\` (refuses while a whole sat is owed, EXCEPT when the pool is frozen, where the share is forfeited to the pool) and \`retire_burned\`. **Prove or break the invariant "the pool always holds at least ceil(owed)".** (Round 24 W11: the true rule about revenue that arrived before a vault joined is SPEC's weaker one, not the stronger wording; attack SPEC's.) Look hard at every counter (\`pending_count\`, \`pending_this_epoch\`, \`active_count\`, \`total_active_weight\`) under every ordering of the host instructions, and at liveness: can anyone make distributions or redemptions impossible for others?

**R2b. THE $CBOB BOOST.** OWNER-ONLY (\`BoostNotTheOwner\`) with the buyer's terms \`max_price\`/\`min_weight\`/\`min_epochs\` (\`BoostTermsMoved\`, one-sided by ruling). \`boost_vault\` (the owner burns \`boost_price\` of THE \`cbob_mint\` pinned at initialize for an ACTIVATED vault, which then weighs \`boost_weight\` more for the next \`boost_epochs\` distributions), \`expire_boosts\` (records only), \`set_boost_terms\` (GOV only, inside \`max_boost_weight\` / \`max_boost_epochs\` fixed at initialize), the per-record \`carry_scaled\` that \`reweigh\` moves what a vault is owed into, the \`boost_expiring\` ring of 64 and \`boosts_due\`, and the \`BoostsExpireFirst\` gate on \`distribute\` and \`monthly_inline\`. **Prove or break: a boost earns EXACTLY its N distributions and not one more; nothing a vault earned is lost or gained when its weight changes (by boost, expiry, claim normalisation, or retire); \`total_active_weight\`, \`boost_weight_total\`, \`boosts_active\`, \`boosts_due\` and the ring always agree, including past epoch 64; no record can be expired twice, early, or never; and nobody can make distributions impossible by boosting or by a vault whose token account is gone.**

**R3. THE LEVEL DRAW.** \`capture_entropy\` / \`reveal_level\` / \`reschedule_reveal\` and the crank that rides on four host instructions: three slot hashes from three leader groups after the mint, drawn WITHOUT REPLACEMENT from the remaining census, strictly in mint order (FIFO), a missed window rescheduled to a future slot, never defaulted. Check the SlotHashes parse, the skipped-slot handling, the FIFO, a burned vault at the head of the queue, the attribute re-supply hash, and what a minter, a crank operator or a slot leader can actually influence. SPEC 26 now states (round 24 A1) that C's leader CHOOSES among many draws; say if it is WORSE than that, and whether HOLDER-GUIDE.md now says it truly.

**R4. GOVERNANCE (\`programs/cbob-vault-gov/src/lib.rs\`).** One vault one vote bound to the ASSET; electorate fixed at creation (\`index_snapshot\`, live \`quorum_supply\`); no proposal before the charter window closes; quorum, threshold and a 10% YES turnout; a guardian change or a new swap operator needs YES from half of the live vaults snapshotted when the proposal is created, never in the same proposal, and lands only after a notice via a permissionless apply; the guardian may cancel a pending swap operator; \`TightenSweep\` only tighter and only inside bounds fixed at initialize; an overtaken action is a logged no-op (\`CBOB_ACTION_SKIPPED\`), not a revert. Find any way a minority carries what it should not, any way a vote reaches money it should not, and any way governance can be frozen forever (SPEC 47 now states a stolen guardian key's stop can be permanent at low turnout; is it worse?).

**R5. THE CHARTER CLAIM.** \`claim_charter_vault\`: the Proof of Burn identified by ADDRESS against a Merkle root of 240 addresses (domain-separated, sorted pairs), CPI-burned as its owner in the same instruction, inside a window fixed at initialize that can never reopen, not gated by the guardian, and \`pob_extra\` accounts passed through to Core's burn never as signers. The Proof of Burn collection's update authority is a hot wallet we do not control (kept by ruling, alarmed; SPEC 46 now says it can end the project or capture governance). Is SPEC 46 now complete, and is there anything that wallet, a PoB holder or a third party can do that it still omits?

**R6. THE ONE-TIME CONFIGURATION AND THE TRUSTED HOP.** Every \`initialize\` across the four vault programs: what it accepts, what it refuses, and what a wrong-but-accepted value would lock in FOREVER once the upgrade authority is removed (from all five programs, the sweep helper included). The swap operator (\`sweep_sol_for_swap\`) is the one trusted key: bound its worst case. The 10% royalty is a Core plugin with authority None: confirm nothing in our programs or in Core lets anyone change it. The redemption cap (\`programs/cbob-vault-burn/src/lib.rs\`) is a rolling window over a 64-slot ring of timestamps: check it is exactly that.

**R7. CROSS-PROGRAM RAW READS.** GOV and BURN read MINT's config, GOV reads MINT's vault record and BURN's config, MINT and BURN read SEAL's config, all by raw offset pinned by discriminator and layout version. The sweep helper reads classic SPL token accounts by raw offset (mint 0, owner 32, amount 64, length 165). Recompute every offset and every account space from the struct definitions. A wrong offset here is a silent misread that the type system cannot see.

**R8. THE SUITE, THE SIMULATION AND THE BUILD AS EVIDENCE.** \`tests/3prog.test.ts\`, the Test Vault simulation and \`scripts/build-mainnet.sh\` are what the claims above rest on. Find arms that cannot fail, arms whose negative fires for a different reason than the one named (the \`because()\` list pins many), claims in this prompt that NO arm exercises, and any program whose mainnet bytes are not proven to be the bytes the suite ran.`

const OFF_TARGETS=`**R0. ROUND 28'S VERDICT AND ANY REPAIRS.** The prior pass's full verdict is bundled. Read its actual result rather than assuming it was clean. Independently validate its confirmed findings, measurements, rejected claims, accepted limits and any resulting repairs against this tree. If it was clean, this is a second, independent audit of the unchanged code: test its conclusions from first principles. If it found defects, verify every repair at all sites of its shape and for regressions. Do not re-file an old claim merely because the prior verdict contains it; show a surviving defect. Check the suite, simulation, holder promises and operational gates along with the program logic.

**R1. THE CRANK (\`bank/crank.mjs\`).** It plans and sends every permissionless job: reschedule, capture, reveal in mint order (re-sending each vault's minted attributes read off Core, hash-checked first), retire bare burns, join eligible vaults BEFORE distributing (the program refuses otherwise), the free monthly distribution, activation requests, and claim batches of 14. It signs only as fee payer; it refuses a balance below the planned fees/rent and warns above 0.25 SOL while continuing the permissionless work. Find a plan the program will refuse (wasted fees, false pages), a plan that pays or joins a dead vault, a reveal it would send out of order, and anything that makes it move value anywhere the program does not already pin.

**R2. THE ALARM (\`bank/detectors.mjs\`, \`bank/alarm.mjs\`).** It must page on every change to a value that is fixed forever, on a pending guardian or swap operator, on the Proof of Burn collection's plugins or update authority, on the redemption window nearly full, on a frozen or insolvent pool, on a distribution overdue, and on upgrade authority past the lock date for all FIVE programs (the sweep helper \`programs/cbob-vault-sweep/src/lib.rs\` is now watched for its upgrade authority and its bytes); and assert Gary's production values (21% / 51% / 3 days, 7-day notice, the tighten bounds, 30-day month, one-hour window). Find a dangerous on-chain state it reads as quiet, and a routine state it pages on every pass.

**R3. THE LAYOUTS (\`bank/layout.mjs\`).** Every account is declared once and asserted against the Rust struct; every cross-program pinned offset is asserted against it. Check the assertions are real (\`bank/selftest.mjs\`), and that a struct change could not slip past them. Round 24 D6: the SEEDS comment claimed an assertion that did not exist; check whether one does now.

**R4. THE MONEY ARITHMETIC (\`bank/accrual.mjs\`)** must equal the program's (\`programs/cbob-vault-mint/src/lib.rs\`: \`credit\`, \`claim\`, \`retire\`, \`ceil_sats\`, \`join\`, \`owed_of\` with \`boost_weight\` and \`carry_scaled\`). Find any divergence. The crank must expire every DUE boost before it distributes and every boost its own distribution makes due right after; the alarm must page \`boosts_stalled\` and treat \`cbob_mint\` and the boost bounds as fixed forever.

**R5. THE SWAP (\`bank/swap.mjs\`, audited in round 25) AND THE REVENUE CYCLE (\`bank/revenue.mjs\`, rewritten).** Royalty SOL leaves MINT's revenue address through the one trusted operator key (\`sweep_sol_for_swap\`), is swapped to cbBTC in ONE transaction we build ourselves against a pinned Orca Whirlpool (first) or a pinned Meteora DLMM (only if Orca refuses), returned to the revenue ATA and split 85/15. Jupiter is gone. \`sim/swap-fork.mjs\` / \`sim/swap-fork.sh\` prove it against a mainnet fork (${FLOORS.swap} assertions). Prove or break:
  (a) **The oracle math.** \`oracleFloor\`: sats = lamports x SOL/USD / BTC/USD scaled by both exponents. Check the exponent handling for every sign, the integer rounding direction, overflow in BigInt-to-Number conversions (\`satsPerLamport\`), and that the floor really is below what an honest pool returns after its fee and the impact of a royalty-sized swap.
  (b) **Pyth account verification.** \`readPyth\`: the account is DERIVED (sponsored feed PDA, shard 0, under the push-oracle program), must be OWNED by the receiver program, must be FULLY verified, must carry the expected feed id; staleness 180 s, confidence 30 bps. Recompute the \`PriceUpdateV2\` offsets. Is ownership plus a derived address sufficient, or can anyone write a fully-verified update with an old \`publish_time\` or a chosen price into that account? Is the clock the age is measured against trustworthy?
  (c) **The deviation filter.** A pool more than 100 bps from the oracle is skipped. Check \`orcaSpot\` (sqrt_price Q64.64 squared, raw units) and \`meteoraSpot\` (the inverse of (1 + bin_step/10,000)^active_id, X = cbBTC, Y = wSOL, reversed from Orca) are the right quantities in the right direction, and that floating point cannot pass a pool it should refuse.
  (d) **The minimum out.** Orca's \`other_amount_threshold\` and Meteora's \`min_amount_out\` carry the oracle floor (150 bps under the oracle's expected output). Is it the SAME floor the deviation filter assumed, and is it in the units each program expects?
  (e) **The judge (\`judgeSwapInstructions\`).** It is the last line before the operator key signs. Is it complete? It checks programs, signers, one swap naming the pinned pool, one SOL transfer into the operator's own wSOL ATA, one close back to the operator. Does it check the swap's OUTPUT account is the operator's own cbBTC account, the swap's minimum-out bytes, the direction byte, the amount, that ComputeBudget instructions cannot set a fee that drains the key, and that the two ATA creations create the accounts they claim? What could a tampered builder still route past it?
  (f) **Account derivation.** Orca: the three tick arrays for an a_to_b swap (current, then the two below), the oracle PDA, vault A/B read from the pool. Meteora: the bin arrays (active, then the two above for Y to X), the bitmap extension present or passed as the program id, \`host_fee_in\` as None, the event authority, two token programs. Recompute each seed and each order against the programs' published interfaces. What happens at a tick-array boundary or an uninitialised array?
  (g) **wSOL handling.** Wrap exactly \`lamportsIn\`, sync, swap, close back. What if the operator's wSOL ATA already exists holding a balance, is frozen, has a delegate, or was created by someone else? What is left behind if the swap consumes less than the input?
  (h) **Failure and retry.** Orca first; Meteora only if Orca was REFUSED (an on-chain error or a failed preflight), never on an unconfirmed send. Can a confirmation timeout on a swap that later lands lead to a second swap, a double count in the ledger, or a cycle read as closed? Does every path leave the ledger open until a cbBTC return is proven on chain?
  (i) **What an adversary can extract within the tolerance.** With a 100 bps deviation gate and a 150 bps floor, bound what a sandwich, a pool pushed to the edge of the gate, a stale-but-accepted oracle, or a manipulated Meteora pool (about 10x thinner than Orca) can take per cycle and per month, and say whether the cycle size makes that material.
  Also bound the operator key's worst case again (limit 10 has changed: what it trusts is now two pool programs and the oracle, not an HTTP reply), and check the ledger still cannot read a failed cycle as closed.

**R6. THE GATES (\`bank/selftest.mjs\`, \`scripts/run-tests.sh\`, \`sim/swap-fork.sh\`).** Find assertions that cannot fail, floors that can be satisfied by deleting work, and checks that pass vacuously when their input is empty. The round-24 section of the selftest claims every repair above is armed in BOTH directions; find one that is not. Check that \`scripts/build-mainnet.sh\` proves what it says for all five programs, the sweep helper included, and that \`scripts/cron-install.sh\` arms nothing it should not.`

const PROMPT=`You are an independent security auditor. Five Solana programs (four vault programs and a stateless sweep helper) and the off-chain pipeline beside them will hold real Bitcoin (cbBTC) and two other tokens for real holders, and once launched the programs will be IMMUTABLE: no upgrade authority will exist, so every surviving bug is permanent. FIND FAULTS. Assume the author is wrong until proven otherwise. Do not confirm their work and do not praise it.

=====================================================================
READ THIS FIRST. IT CHANGES YOUR JOB.
=====================================================================
**THERE IS NO HUMAN AUDIT FIRM. THIS PROCESS IS THE CERTIFICATION.** The owner ruled that this system will be audited by AI or not at all. A finding you decline to write because "someone else will catch it" is a finding nobody writes.

That cuts BOTH ways. Across 21 earlier rounds on the previous design, about a third of "CRITICAL" findings were WRONG on measurement: invented sysvar mechanics, a Borsh claim contradicted by working mints, a recommendation that would have destroyed customer SOL. Round 24 alone rejected 16 program claims and 16 off-chain claims on measurement. With nobody downstream to sort real from imagined, a wrong CRITICAL costs real engineering time and can push a correct design into a wrong change. So before you write a finding, say what evidence would exist on chain or in a test run if your claim were true, so it can be checked.

The four vault programs and the sweep helper pass a ${FLOORS.onchain}-assertion suite on a local validator running REAL Metaplex Core cloned from mainnet, minting real vaults and moving real SPL tokens; plus ${FLOORS.detector} off-chain detector assertions proven in both directions, ${FLOORS.alloc} allocation, ${FLOORS.launch} launch-value, ${FLOORS.host} host unit tests (one is Anchor's generated \`test_id\`) and ${FLOORS.mainnet} against live mainnet, every number behind a floor that must EQUAL the count. A Test Vault simulation (${FLOORS.sim} assertions) runs one vault's whole life against real Core, the real cbBTC / $GARY / $GIRAFFISH mint accounts and two real mainnet Proof of Burn assets, including a redemption through the sweep helper after a stranger's deposit. A mainnet-fork run (${FLOORS.swap} assertions) swaps SOL to cbBTC through the real pinned pools. A claim that contradicts a measured run is a claim about your own reasoning, unless you show the run is not measuring what it says.

THIS IS v6, A REDESIGN, AND THIS ROUND READS IT WHOLE. Nothing below is a diff: you get the files whole. ${FOCUS==='programs'?'This pass bundles all five programs.':'This pass is the off-chain pipeline; it bundles MINT and the sweep helper (what the off-chain code must agree with), not SEAL, BURN or GOV, which the programs pass reads.'} Three independent read-only red-team passes (the last, \`audits/v6-redteam/RT3-stage3c.md\`, is bundled) and rounds 22 through 27 have read the vault programs. Round 25 was the first audit of the sweep helper and the direct swap; this round examines their repairs and the entire current tree.

**ROUND 28 READ THIS TREE BEFORE YOU, AND ITS VERDICT IS YOUR FIRST TARGET.** The previous verdict is bundled in full. It is evidence to verify, not authority to agree with. Read its result and measurement limitations directly. Independently audit the whole current tree; establish whether every prior repair holds and whether any new defect survives measurement.

**THE OWNER'S RULINGS ARE NOT FINDINGS.** DESIGN-v6.md records product decisions (no Bank key, no admin, a guardian that can only stop, immutability, a 7-day charter window, 10% royalties forever, 85/15 forever, the 2.1%-per-hour redemption cap, 21% quorum / 51% threshold / 3-day votes, the Proof of Burn collection authority staying a hot wallet, the sweep helper, Orca-then-Meteora for the swap). Do not argue them. DO report where the code fails a ruling, where a ruling opens a hole the documents do not already accept, and where HOLDER-GUIDE.md promises something the code does not do.

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
4. Core BurnV1 does NOT sweep the asset-signer PDA's lamports (measured); dropping BURN's lamports==0 check would destroy customer SOL. The sweep helper now moves those lamports to the owner before the burn.
5. Pubkey::is_on_curve is host-only and panics on BPF; an off-curve owner (a DAO, a multisig) cannot redeem.
6. overflow-checks = true, so arithmetic overflow ABORTS.
7. A burned asset's address is NOT re-mintable: the account survives, Core-owned, one byte, Key::Uninitialized, and a re-mint is refused (measured in the suite and the simulation).
8. INIT_AUTHORITY on mainnet is Gary's wallet Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb; \`--features localnet\` swaps in a test key; \`scripts/build-mainnet.sh\` proves which binary carries which key by behaviour, and that the sweep helper (which has no key) is byte-identical between its localnet and mainnet builds.
9. Mainnet's rent rate is LOWER than solana-test-validator's default (650,240 vs 890,880 lamports for 0 bytes, measured 2026-10-03; a classic token account is about 1,488,440 lamports on mainnet, round 24). The programs' constant \`RENT_EXEMPT_0_BYTES = 890_880\` is therefore stricter than mainnet needs, never looser.
10. cbBTC has a live freeze authority (Coinbase). A frozen vault account defers that vault's claim; a frozen POOL stops all claims, a claim that PAYS then reverts the whole transaction (round 24 D4), and a redemption sends no claim and forfeits its undelivered share rather than locking the vault (by design, stated to holders).
11. \`HOST_FLOOR\` counts Anchor's \`declare_id!\`-generated \`test_id\` (read the current floor and host test output; do not carry an old count forward).
12. Core never CPIs into lifecycle hooks, and an asset owner's \`AddExternalPluginAdapterV1\` on a collection-authority asset is refused \`NoApprovals\` (round 24 A5/W3, read in Core source at \`e72d63e\`).

TRANSACTION HISTORY: The shared \`bank/txread.mjs\` reads legacy/v0/v1 through the installed SDK's RPC transport because its parsed-response decoder rejects v1. Independently check its schema, incomplete-coverage refusals and consumer behavior; the public fixture is reader evidence, not execution of a CBOB v1 transaction. Packet/default-CU measurements in SPEC are explicitly legacy/v0. No v1 writer is certified.

=====================================================================
ARCHITECTURE (v6)
=====================================================================
- A vault is a Metaplex Core asset (CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d) in the CBOB collection, minted only by MINT. Contents live in Core's asset-signer PDA ["mpl-core-execute", asset]; ExecuteV1 makes that PDA sign and requires the owner. A PermanentFreezeExecute plugin, authority SEAL's ["seal"] PDA, keeps it sealed. Permanent plugins are create-only.
- FOUR vault programs: SEAL (seal, thaw-on-the-way-to-a-burn), MINT (config, rounds, mint, charter claim, level draw, pool, boosts, guardian stops, governed setters), BURN (burn, emptiness proof, rate limit, retire CPI into MINT), GOV (proposals, votes, execution by CPI into MINT signed by the ["gov"] PDA). PLUS the SWEEP helper (EB2uVvsaThLp4PWt3LwAWveTCa9ZynPVbWzZfUhMf2aa): native, stateless, no key, reached only through Core ExecuteV1. Core is a sixth program we do not control. All five of ours become immutable at launch.
- Redemption (SPEC "REDEEMING"): a PRIOR transaction creates the owner's destination accounts and any of the vault's reserve accounts that do not exist yet; then ONE transaction, owner alone: claim (MINT, if owed and the pool is not frozen) ... open_for_redemption (SEAL) ... Core ExecuteV1 into the sweep helper (moves every named reserve account's LIVE balance and every lamport of the vault wallet to the owner, and closes the reserve accounts) ... burn_vault (BURN, which CPIs MINT retire_redeemed). No path leaves a surviving emptied vault; a partial sweep reverts the thaw.
- Money: mint prices are paid in cbBTC into MINT's ["revenue"] PDA; royalty SOL is swept by the one trusted swap operator off chain, swapped in a transaction we build ourselves against a pinned Orca Whirlpool (Meteora DLMM fallback) with a Pyth-derived minimum out enforced on chain, and returned as cbBTC; split_revenue sends 85% to the program pool and 15% to the CBOBTC Squads (permanent); distributions credit activated (joined) vaults by level weight 2/3/4/5/6 plus any live boost; claims pay into each vault's own cbBTC account.

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
 *  that gets answered from the diff hunk, which is how a wrong CRITICAL is born.
 *
 *  ⚠️ ROUND 25 WIDENED IT, because round 24's version was blind in two ways:
 *  (1) its path pattern covered only programs/ bank/ scripts/ tests/, so a named
 *  `sim/...` or `launch/...` file, or a `.toml`/`.json`, was never checked, and
 *  this round's targets name `sim/swap-fork.mjs`; (2) it scanned only the
 *  numbered targets, while the MEASURED FACTS and ARCHITECTURE prose also name
 *  files (fact 8 names `scripts/build-mainnet.sh`, which round 24's programs pass
 *  did not deliver). It now scans every line of AUTHORED prose, i.e. everything
 *  before the commit log, EXCEPT the accepted-limits block reproduced from SPEC
 *  (SPEC.md itself is delivered, and its own file references are its business). */
const NAMED_FILE=/\b((?:programs|bank|scripts|tests|sim|launch)\/[\w./-]+\.(?:rs|mjs|sh|ts|toml|json))\b/g
/** AND THE DOCUMENTS. Round 24's off-chain prompt told auditors to judge
 *  HOLDER-GUIDE.md and DESIGN-v6.md and delivered neither, and the check above
 *  could not see it: a root-level `NAME.md` has no directory prefix. Round 24's
 *  confirmed holder falsehoods were ALL in HOLDER-GUIDE.md, so a pass that is told
 *  to check it and cannot read it is the round-19 defect on the documents. Root
 *  `.md` names (with or without backticks) and anything under `audits/` count. */
const NAMED_DOC=/(?<![\w\/.-])((?:audits\/[\w./-]+|[\w-]+)\.md)\b/g
{
  const authored=PROMPT.slice(0,PROMPT.indexOf('THE v6 COMMITS, so you can see')).replace(ACCEPTED_LIMITS,'')
  const named=[...new Set([...authored.matchAll(NAMED_FILE),...authored.matchAll(NAMED_DOC)].map(m=>m[1]))]
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
  fs.writeFileSync(`${OUT}/${process.env.TAG||'v29'}-${FOCUS}-${o.model.replace(/[\/.]/g,'_')}.md`,o.text)
  const cpt = o.inTok ? (PROMPT.length/o.inTok).toFixed(2) : '?'
  const cut = o.disqualified ? `  ⚠️ NOT AN AUDITOR: ${o.disqualified}` : ''
  console.log(`${o.model.padEnd(34)} ${o.ok?`${o.secs}s`:'FAILED'} in=${String(o.inTok||0).padStart(8)} (${cpt} ch/tok) out=${String(o.outTok||0).padStart(6)} chars=${String(o.text.length).padStart(7)}${cut}`)
}
/** ⚠️ ROUND 25: THE CAPACITY GUARD USED ONE RATIO FOR EVERY TOKENIZER, AND ONE
 *  FAMILY IS TWICE AS DENSE. The guard below divides by 2.3 chars/token, "the
 *  densest text ratio observed". The manifests say otherwise for OpenAI: round 24
 *  off chain, 920,446 chars reported as 789,753 and 802,354 input tokens (1.15-
 *  1.17 chars/token); round 23, 824,358 chars as 704,610 and 729,648 (1.13-1.17).
 *  At this round's bundle size that is the difference between fitting a
 *  1,050,000 window and being refused at 400. So a family with a MEASURED ratio
 *  below 2.3 uses it, with a 3% margin; every other model keeps 2.3, which is
 *  still a guess for a family never measured (meta, sakana) and says so. */
const MEASURED_CHARS_PER_TOKEN:Record<string,number>={
  'openai/': 1.13,       // rounds 23-24 manifests, the lowest observed
  'anthropic/': 2.22,    // round 24 programs: 853,341 chars / 384,494 tokens
}
const charsPerToken=(m:string)=>{
  const k=Object.keys(MEASURED_CHARS_PER_TOKEN).find(p=>m.startsWith(p))
  return k?Math.min(2.3,MEASURED_CHARS_PER_TOKEN[k]*0.97):2.3
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
  // and it VARIES ENORMOUSLY by tokenizer (see MEASURED_CHARS_PER_TOKEN above).
  // What this catches is a window that is grossly too small, which is what
  // actually happened; it is NOT a proof that a model will fit. The provider's
  // 400 remains the authority, and a model that still gets refused is still
  // disqualified. A guard, not a guarantee.
  const needOf=(m:string)=>Math.ceil(PROMPT.length/charsPerToken(m))+MAX_OUT
  const small=MODELS.filter(m=>(ctx.get(m)||0)<needOf(m))
  // AND THE OUTPUT CEILING, which is a separate published number. A model whose
  // provider caps completions below MAX_OUT cannot finish a report of the length
  // this audit asks for, and it fails as `output cut off mid-report` — an auditor
  // lost to a limit that was knowable before spending.
  const maxOut=new Map<string,number>((j.data||[]).map((m:any)=>[String(m.id),Number(m?.top_provider?.max_completion_tokens||0)]))
  for(const m of MODELS){
    const need=needOf(m), c=ctx.get(m)||0
    console.log(`  ${m.padEnd(32)} context ${c.toLocaleString().padStart(9)}  max out ${(maxOut.get(m)||0).toLocaleString().padStart(7)}  needs ~${need.toLocaleString()} (at ${charsPerToken(m).toFixed(2)} ch/tok)  headroom ${(c-need).toLocaleString()}`)
  }
  const shortOut=MODELS.filter(m=>{const c=maxOut.get(m)||0; return c>0&&c<MAX_OUT})
  if(shortOut.length) throw new Error(`these models cannot emit ${MAX_OUT} output tokens: ${shortOut.map(m=>`${m} (${maxOut.get(m)})`).join(', ')} — they would be truncated and disqualified. Lower MAX_OUT or change the roster.`)
  console.log(`context: this bundle needs about ${needOf('x').toLocaleString()} tokens at 2.3 ch/tok (${Math.ceil(PROMPT.length/2.3).toLocaleString()} in + ${MAX_OUT.toLocaleString()} out)`)
  if(small.length) throw new Error(`these models cannot hold this bundle: ${small.map(m=>`${m} (${ctx.get(m)||0} < ~${needOf(m)})`).join(', ')} — they would be refused at 400 and counted as failures. Shrink the bundle or change the roster; do not pay for a request that cannot be read.`)
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
  // ROUND 25: `sim` joins the code paths — this round bundles three files from it,
  // and an uncommitted change there was otherwise visible only via TARGETS.
  const WATCHED=[...new Set(['programs','bank','scripts','tests','sim',...TARGETS.map(([f])=>f)])].join(' ')
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
/** THE PROSE CHECKS, shared by RENDER_ONLY and DRY so the two cannot disagree.
 *
 *  ⚠️ SCOPE IT TO THE AUTHORED PROSE. The first version scanned the WHOLE prompt
 *  and reported ~300 "unresolved placeholders" — every one of them a real
 *  template literal inside a bundled .ts/.mjs/.sh file, which is source we are
 *  deliberately showing the auditors. A check that fires on its own payload is
 *  noise, and noise is what gets scrolled past. The prose is everything before
 *  the diff marker, and it is the only part this script actually assembles. */
function proseChecks():boolean{
  let ok=true
  const prose=PROMPT.slice(0,PROMPT.indexOf('THE FILES UNDER AUDIT, WHOLE'))
  const bad=[...prose.matchAll(/\$\{[^}\n]{0,60}\}/g)].map(m=>m[0])
  if(bad.length) { console.error(`UNRESOLVED PLACEHOLDERS IN THE RENDERED PROSE: ${[...new Set(bad)].join(', ')}`); ok=false }
  else console.log(`no unresolved \${...} placeholders in the ${prose.length}-char authored prose`)
  // AND THE LIMITS MUST HAVE ARRIVED. An empty interpolation is silent.
  if(!prose.includes('ACCEPTED — will not fix')||!prose.includes('OPEN AND BLOCKING')||!prose.includes('DISCHARGED'))
    { console.error('the ACCEPTED LIMITS section did not reach the rendered prompt'); ok=false }
  else console.log('the ACCEPTED LIMITS section reached the artifact, all three states present')
  // AND A ROUND NUMBER FROM A PREVIOUS ROUND MUST NOT BE THE ONE WE CLAIM TO FIX.
  // audit24.ts shipped "ROUND 22 READ THIS TREE BEFORE YOU" to a round fixing
  // round 23: a stale label copied forward, telling eight auditors the wrong
  // round's findings were their first target.
  if(!prose.includes('ROUND 28 READ THIS TREE BEFORE YOU')||/ROUND 2[0-7] READ THIS TREE/.test(prose))
    { console.error('the prompt does not name round 28 as the prior round'); ok=false }
  return ok
}
/** ⚠️ RENDER THE PROMPT AND READ IT. THE SOURCE IS NOT THE THING THAT SHIPS.
 *
 *  Round 18 shipped `\${FLOORS.onchain}` to eight auditors AS LITERAL TEXT — a
 *  backslash-escaped `${` renders as the placeholder, and `tsc` passes because it
 *  is valid TypeScript. It was found only by rendering the prompt and looking at
 *  the output, and this round interpolates a 250-line section read out of SPEC.md,
 *  which is far more of the prompt than any previous round assembled at runtime.
 *
 *  `RENDER_ONLY=1 npx tsx scripts/audit29.ts` writes the prompt and spends
 *  nothing. Do it for BOTH focuses before launching. */
/** DRY=1: EVERY PRE-FLIGHT, NO MODEL CALL. Builds this FOCUS's prompt (which runs
 *  the target-existence and delivery guards at module scope), runs the prose
 *  checks, prints the bundle file by file, and runs verifyRoster() — one GET of
 *  the public model list, no tokens — then exits. It writes nothing: no OUT dir,
 *  no rendered prompt, no manifest. Run it for BOTH focuses before a round. */
if(process.env.DRY){
  (async()=>{
    console.log(`DRY RUN — focus=${FOCUS}, out would be ${OUT}, tag ${process.env.TAG||'v29'}; no model will be called`)
    console.log(`floors read: ${Object.entries(FLOORS).map(([k,v])=>`${k}=${v}`).join(' ')}`)
    console.log(`delivered (${TARGETS.length} files):`)
    for(const [path] of TARGETS) console.log(`  ${String(fs.statSync(`${R}/${path}`).size).padStart(8)}  ${path}`)
    const prose=PROMPT.indexOf('THE FILES UNDER AUDIT, WHOLE')
    console.log(`bundle chars=${BUNDLE.length}  authored prose chars=${prose}  accepted-limits chars=${ACCEPTED_LIMITS.length}  v6 log chars=${V6_LOG.length}  PROMPT chars=${PROMPT.length}`)
    const ok=proseChecks()
    await verifyRoster()
    console.log(`quorum ${MIN_AUDITORS} of ${MODELS.length}. DRY RUN ${ok?'PASSED':'FAILED'} — nothing was sent to any model.`)
    if(!ok) process.exitCode=1
  })().catch(e=>{console.error('DRY FATAL',e?.message||e);process.exitCode=1})
} else if(process.env.RENDER_ONLY){
  // NOT a hardcoded round number: audit21 writing `audit20-prompt-*.txt` is a
  // stale label on an artifact, which is how a reader ends up reading the wrong
  // round's prompt and believing it.
  const out=`/tmp/${process.env.TAG||'v29'}-prompt-${FOCUS}.txt`
  fs.writeFileSync(out,PROMPT)
  console.log(`rendered ${PROMPT.length} chars to ${out}`)
  if(!proseChecks()) process.exitCode=1
} else {
main().catch(e=>{console.error('FATAL',e?.message||e);process.exitCode=1})
}
