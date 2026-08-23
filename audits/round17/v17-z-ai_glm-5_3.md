# ROUND 17 — INDEPENDENT AUDIT

I attacked R1–R6 in order, tried to break the round-16 verdict's two headline claims, and hunted the under-claim direction the owner named. The worst things I found are **not in the Rust** — the on-chain check held up under everything I threw at it — but in the documentation that denies a control this diff created, and in a payout-halt path that is permissionless to trigger and silent to the only watcher.

---

## R1 — SEAL's on-chain confinement

### What I tried, and what held

**The exemption is not exploitable.** I walked every account position of both exempt shapes looking for a placement of the Bank's key that does work:

- An instruction to SEAL wearing `IX_OPEN_FOR_REDEMPTION_DISC` is dispatched by Anchor to `open_for_redemption` (a no-arg instruction; Borsh ignores trailing bytes, so trailing garbage does not divert dispatch). It then either fails account validation, or fails the terminal-burn requirement, or *is* a real open — which independently demands `bank: Signer == config.bank` and a paired burn. There is no fourth outcome.
- An instruction to BURN wearing `IX_BURN_VAULT_DISC` likewise reaches `burn_vault`, which demands the Bank signer, a preceding open for the same asset and owner, and the emptiness proof. Placing the Bank at `payer` (receives the asset's rent — money *toward* the Bank) or in `remaining_accounts` (a funded system-owned wallet is skipped by every loop) gains nothing.
- The Bank as `payer` inside the pair is known limit 3 and, on inspection, is close to harmless: UpdatePluginV1 allocates nothing and BurnV1's payer *receives* lamports.

**The old invariant is preserved.** Burn before the open: `i > current` excludes it, exactly as `current + 1` did. Two redemptions sharing a transaction: each open's job-1 match is still strictly after itself and binds asset+owner; each open's job-2 exempts the sibling's open and burn, which is the documented capability. Open reached by CPI: `current` is the outer index; job 1 is unchanged, and job 2 now rejects the *wrapper* instruction — which must name the Bank to pass the bank signer through CPI — so a CPI open fails earlier and for a different reason than before, but it failed before too (BURN's `NoPrecedingOpen` could never be satisfied by an inner open). Both directions refuse.

**The BURN-needs-no-copy claim is true.** Any transaction in which a burn can execute contains a top-level open that executed first, and that open's scan reads the *static* instruction list — all of it, including instructions after the burn — from the sysvar. So every executing burn sits in a transaction the confinement already covered. The dependency is real but gated by 3.8 and 9.0, both of which exist and both of which pin the reason. The stated caveat (a future BURN upgrade allowing an unpaired burn silently un-covers those transactions) is correct and correctly written down.

**The two stated gaps are correctly reasoned.** The fee payer is genuinely invisible to the instructions sysvar, and the concrete exploit is: `[ComputeBudget::SetComputeUnitLimit(1_400_000), ComputeBudget::SetComputeUnitPrice(<arbitrary>), open, sweep, burn]` with `feePayer = Bank` — the Bank's mandatory signature on the pair authorises an unbounded priority fee, and no instruction names the Bank. The allowlist reasoning is also right: the round-15 theft *was* a System transfer, which any sweep-permitting allowlist must permit; the confinement, not the allowlist, closes it. One thing worth adding to the record: the confinement **sees through address lookup tables** — `load_instruction_at` resolves ALT keys, so hiding the Bank behind an ALT does not bypass the check. That is a strength nothing documents.

### R1-a — MEDIUM — Compute units: the walk is O(K²), now over the whole transaction, and has never executed above ~6 instructions

**Construct.** `load_instruction_at_checked` deserialises the *entire* `Vec<CompiledInstruction>` from the sysvar on every call. The old loop made `K − current` calls; the new one makes `K + 1` per open — and BURN's own `0..current` walk stacks on top, and the two-redemption case pays for the full walk twice. A 3-reserve worst-case redemption (9.14's shape: open + 3 transfers + 3 closes + lamport sweep + burn ≈ 10 top-level instructions) has never been *sent* — 9.14 only serialises it for bytes, and 4.7–4.10a all run against 1-reserve vaults in 4-instruction transactions.

**Gain.** None for an attacker directly. The risk is liveness: if the open's sysvar walk exceeds the default 200k CU per instruction, every redemption at that shape fails with `ComputeBudgetExceeded` until the customer adds a `SetComputeUnitLimit` — which the confinement permits (ComputeBudget instructions carry no accounts) and the co-signer's allowlist permits, but which no client documentation tells anyone to add, and which the 831/975/1119 byte table does not budget for.

**Evidence if I am right.** Send the 9.14 three-mint worst case and read `meta.computeUnitConsumed` per instruction; no such measurement exists anywhere in the repository. My honest calibration: at K≈10–20 the cost is *probably* tens of thousands of CU, not a hard failure — but "probably" is the word this project has learned to distrust, and known limit 12 explicitly got worse this round.

**Fix.** Measure it: add a suite assertion that sends the 9.14 shape and pins the open instruction's consumed CU. If it is anywhere near 200k, document the compute-budget instruction as a client requirement and add its bytes to the ceiling table.

### R1-b — LOW — Every umi-default redemption client is now refused

The suite itself discovered that umi fills `ExecuteV1.payer` with the identity key — and any client that composes the redemption with the Bank as identity (the natural shape for a Bank-operated redemption service) puts the Bank in a sweep instruction and gets `BankKeyOutsidePair`. The fix in the test was right and production customers (who hold their own identity) are unaffected, but "the redemption client must set the Execute payer to the owner" is now a hard client requirement that exists only in a test comment. Put it beside the 9.14b destination-ATA requirement in SPEC.

---

## R2 — Weighted distribution and the cadence

### R2-a — HIGH — A stranger's ~$20 airdrop silently halts every payout, indefinitely, and the alarm reads each halted day as a quiet one

**Construct.** Anyone can create a cbBTC ATA for any vault's asset-signer PDA (permissionless) and transfer 21,000 sats into it (permissionless). That vault is now *activated*. If it has no entry in `levels.json` — and nothing in the repository ever writes `levels.json`; the header says "this job only READS it" — `allocateWeighted` returns `skip: "N activated vault(s) carry no level"`. In `main()`, the skip branch writes `st.days[day].nothingToDo = plan.skip` and `finishedAt`, and returns. In `detectDistribution`, `nothingToDo` suppresses the `distribution_unfinished` finding and nothing else in the alarm reads the marker's *content* — the selftest asserts a `nothingToDo` day is QUIET. The 31-day force cannot rescue this: the cadence gate sits behind `if (!plan.skip)`, so an allocator refusal short-circuits `decideEmission` entirely. Every subsequent day repeats. No detector fires. Ever.

**Gain.** A griefing attacker converts ~$20 (donated to a stranger's vault, or to their own and recovered on redemption) into a permanent, silent stop of the system's core money movement — the daily cbBTC payout to every customer — until a human happens to read a log line. The MAX_HOLD_DAYS promise ("no holder ever waits longer than a month") is dead in this state.

**Evidence if I am right.** Run `distribute.mjs --dry-run` against a levels.json missing one activated vault: output contains `SKIP: ... carry no level`. Feed the resulting ledger shape (`{startedAt, nothingToDo: "...", finishedAt, paid: {}}`) to `detectDistribution` → zero findings. `grep -n nothingToDo bank/detectors.mjs` shows it used only as a suppressor. `grep -rn "levels.json" bank/ scripts/` shows one reader and no writer.

**Fix.** Three parts, cheapest first: (1) split the skip taxonomy — an empty pool and an empty activated set are legitimately quiet; a *refusal* (unlevelled, bad register) is a halt and must be its own ledger marker that `detectDistribution` reports at HIGH; (2) notify on the refusal path the way the SOL-floor abort does; (3) operationally, pre-register a level for every minted vault at mint and add `levels.json`'s hash to the alarm's watch (see R2-c).

### R2-b — verified — The arithmetic itself is sound

`total ≤ available` always (sum of floors ≤ floor of sum, and the denominator is exactly the sum of activated weights). No unactivated vault is paid; no activated, levelled vault is missed. `smallest` is guarded on the empty set and the reduce is a correct min. Dust is `< denominator` per settlement, is *not* retained (it stays in the distributor ATA and re-enters the next `available`), so it cannot grow without bound. The "worse off than if split" question: yes, mechanically — dust carried from a settlement at denominator D₁ is diluted if the activated set grows to D₂ before the next payout — but the bound is (D₂/D₁ − 1) × ≤6,404 sats ≈ single sats per holder. Trivial; the ruling stands.

### R2-c — MEDIUM — The level register is worse than the stated limit: no creator, no watcher, no odds anywhere, and a missing entry is a full halt

The stated limit (16) covers *verifiability* — "assigned by fate is our word." What is additionally true: (a) nothing creates or maintains `levels.json` — the 45/25/15/10/5 odds appear in no executable code and no documented procedure, so the card's odds are not merely unenforced, they are unimplemented in any form; (b) the alarm watches config accounts, program hashes, the collection hash — and not the one file that decides who gets paid 3× whom, so a silent edit to it changes every future payout with zero signal; (c) per R2-a, a *missing* entry is a total silent halt. The blast radius of write access to that file (same uid as the signing keys) is: redirect up to ~3× the fair share to chosen vaults, permanently, invisibly. **Fix:** hash `levels.json` into the alarm state exactly as `collection.hash` is; pre-assign levels at mint; build the commitment scheme before the first activation, not after.

### R2-d — LOW — Three cadence edges, none load-bearing

- `holdDays` anchors on any day with a *row*, including days whose only rows are `skipped` or `rejected` — the comment says "actually paid somebody." A day that paid nobody can advance the anchor. Reachable only in contrived states, and the all-refused case raises `distribution_refused` anyway.
- The 31-day force cannot override an allocator *dust* skip (pool < denominator/2 ≈ 3,200 sats carries indefinitely). Magnitude is cents; the sentence "no holder ever waits longer than a month" has a floor it doesn't mention.
- The resume path performs no shape check on the stored plan. A plan written by the *old* equal-split code (`per` as a bare string) would be resumed via `Object.entries("150")` into `{0:1n, 1:5n, 2:0n}` and garbage rows. Unreachable today (nothing has run live), but this repository has twice already accepted both shapes for exactly this reason (`seenSplits`, the acks file) and did not here.

---

## R3 — `scripts/bank-sign.sh`

Substantively clean. I checked: argument handling is closed (count, `--live` only, `--*` refused as the first argument); every expansion is quoted; `cat --` protects dash-named files; `-f` excludes FIFOs and devices (fail-closed); the base64 filter is correct bash negated-class globbing and fails closed in every mangle case I could construct — interior padding makes Node decode a strict *prefix*, and a truncated legacy transaction cannot parse, so there is no input it accepts that decodes to a *different valid* transaction; `exec` preserves cosign's exit code exactly; argv size is a non-issue (~1.7KB base64 against a 128KB single-arg limit); the read-before-`cd` order is real and the gate for it fails red on a missing half.

Three LOWs:

1. **The header's "not in `ps`" claim is false.** The transaction is read from a file — and then passed to node as **argv** (`exec ... cosign.mjs --tx "$TX"`), so the full base64 sits in the process list for the duration of the inspection. The file-based design protects shell history, not `ps`. An unsigned transaction is not a secret, but the stated rationale is wrong one line after it is made. Fix the comment or pass via stdin.
2. **`/usr/bin/env node` resolves the interpreter from PATH**, while every cron pins `/usr/bin/node`. A PATH shadow in the operator's environment runs the co-signer under a different binary — the one sanctioned signing path is the only one that doesn't pin its node. Use the same absolute path the crons use.
3. **`dirname "$0"` under a symlink** resolves to the symlink's directory; invoking via a PATH symlink fails closed (node can't find `cosign.mjs`) but breaks the sanctioned path. `readlink -f "$0"` fixes it.

TOCTOU between `-f` and `cat`, and the two-run inspect-then-sign gap, both require local write access at which point the box is lost; noted, not filed.

---

## R4 — The gates

### R4-a — HIGH — The signer-set gate is blind to two keypair constructors, both already in the scanned tree

**Construct.** `sigPat = /fromSecretKey/` — case-sensitive, one spelling. The tree already contains `Keypair.fromSeed(...)` (tests/3prog.test.ts, initauth.test.ts) and `umi.eddsa.createKeypairFromSecretKey(bank.secretKey)` (3prog.test.ts, probe-round5.test.ts — capital F, no match). Neither appears in `signerSet`. SPEC claims: *"every file anywhere in the repository that can turn bytes into a keypair is enumerated with the key it reads."* That is false: a future second signer reading the Bank seed via `fromSeed`, or the key bytes via the umi constructor, passes C1 (no key path) and C2 (no `fromSecretKey`) and signs freely. The both-ways impostor test only proves the arm catches the exact lowercase spelling.

**Gain.** No compromise today — no file but `cosign.mjs` touches the real key. But the gate whose entire purpose is "a second signer is a build failure" has a named blind spot with live, natural instances of the evading pattern already in the tree.

**Evidence if I am right.** `grep -rn "fromSeed\|createKeypairFromSecretKey" tests/` → hits; run `signerSet` mentally against them → absent from the pinned list.

**Fix.** Widen `sigPat` to a case-insensitive constructor set (`/from(secretkey|seed)/i` plus `createKeypairFromSecretKey`), and pin the umi-identity call sites the same way. Also soften the SPEC sentence to what the gate actually checks, or make the gate match the sentence.

Related, same class: `srcFiles` is three named directories with fixed extensions — "the whole executable tree" is false the day a `lib/` directory, a root-level `.mjs`, or a `package.json` script appears. LOW, but the comment should stop claiming the tree.

### R4-b — MEDIUM — The ON-CHAIN arm verifies text, not behaviour, and is weaker than its own billing

The regex pair `/pub bank: Signer<'info>/` + `/require_keys_eq!\(\s*ctx\.accounts\.bank\.key\(\),/` checks only the **first operand** of the comparison and cannot tell which instruction either pattern lives in. A program that passes without enforcing a 2-of-2: keep `bank: Signer` in `BurnVault` and replace the check with the tautology `require_keys_eq!(ctx.accounts.bank.key(), ctx.accounts.bank.key())` — gate green, any signer accepted. Or compare against a caller-controlled account. Or keep both patterns in an unrelated instruction's struct and handler. The comment calls this "verified against the Rust … programs whose source really does demand the Bank's signature" — a behavioural claim verified textually. The on-chain suite is the real backstop here (3.1 sends alice as the bank and demands `NotTheBank`, which *would* catch the tautology), so this is a gate over-claiming its own verification, not a hole in the guarantee. Fix: say "the source contains both halves" and lean on 3.1 for behaviour, or add a suite negative that sends a burn whose bank account is a *different valid signer* (not merely a missing one).

### R4-c — the parser, answered

Unnamed AUTOMATIC row → red twice (the claim-match filter *and* the NO-FILE filter). Unnamed PROCEDURE row → red once (NO-FILE filter — the claim-match filter alone would have agreed with itself; the dedicated assertion is what closes it). Unparseable/reformatted row → invisible to the row regex, but `rows.length === 4` fails on any net change — fail-closed. A PROCEDURE row whose file appears only in a non-cron line → reads AUTOMATIC → mismatch → red. The residual fragility: `cronLines` matches *any* line starting with a non-space word and containing `$TAG` — the `echo "installed (tagged $TAG):"` and `grep -cF '$TAG'` lines in cron-install.sh both match. Harmless today (none contains a `bank/*.mjs` path), but a future echo line naming a file would flip a PROCEDURE row to "cron says AUTOMATIC" — red, fail-closed, but confusing. LOW.

The self-match arm is sound for its purpose (preventing false positives, not detecting evaders): anything assembled from fragments at runtime also evades the underlying searches, so there is nothing to hide. The `sweep()` payer fix is correct — production shape is customer-identity-as-payer, which is what the test now builds. The 4.7–4.10a relocation is correctly reasoned and does not bite elsewhere: sections 8/9 read no quorum input, the `because` blocks are read-only, and all five minted vaults are burned in place. One stale comment found there — filed under R5.

---

## R5 — The comments, both directions

### R5-a — HIGH — Three live documents deny the on-chain confinement this diff created, and the control table omits it

This is the under-claim direction the owner flagged, in its most expensive form, **systematically**:

1. **SEAL's own module header, added in this diff:** "⚠️ AND THIS FUNCTION DOES NOT BOUND WHAT ELSE IS IN THE TRANSACTION. The forward scan below stops at the matching burn; it never enumerates the rest." — in the same file, above a function that this same diff changed to enumerate everything and refuse `BankKeyOutsidePair`. The module header and the function's own inline comment contradict each other, both written in one commit.
2. **cosign.mjs's header, added in this diff:** "⚠️ AND THE PROGRAMS DO NOT BOUND WHAT ELSE IS IN THE TRANSACTION. `open_for_redemption` walks the instruction sysvar forward only as far as its matching `burn_vault` … Moving them on-chain is possible and is not done; it is an accepted limit." — the Bank's own policy file tells its operator the programs provide no bound, one commit after the bound landed.
3. **SPEC.md, current tree:** "⚠️ AND THE TWO CHECKS THAT MATTER MOST ARE IN THE POLICY HALF. The programs do NOT bound what else a redemption transaction contains … Moving those two on-chain is possible — SEAL already walks the sysvar — and is not done."

And the control table — "the ONE place that says what actually runs" — has **no row for the confinement at all**. The new C5 gate pins `rows.length === 4`, so the omission is now *enforced*: adding the row requires deliberately editing the gate. A buyer reading SPEC learns the weakest true thing (the policy arms) and not the strongest (the programs refuse any non-pair instruction naming the Bank, nobody can opt out, the Bank included). This is the round-16 co-signer defect exactly, one round later, in three places at once.

**Evidence if I am right.** `grep -rn "BankKeyOutsidePair" SPEC.md bank/` → only `lib.rs` and the test. `grep -n "never enumerates the rest" SPEC.md bank/cosign.mjs programs/cbob-vaults/src/lib.rs` → three hits, each false against the code beneath it.

**Fix.** Add the fifth row (ON-CHAIN, naming `programs/cbob-vaults/src/lib.rs`; the gate's `onChainBankPin` already passes against it), bump the row-count assertion, delete or rewrite all three paragraphs, and state the residual honestly: the *allowlist* and the *fee payer* remain policy; the *Bank-key confinement* is on-chain and cannot be skipped.

### R5-b — HIGH — distribute.mjs's own header still describes the deleted allocator

The file header reads: *"Equal per activated vault, because one vault is one unit and one vote."* The code beneath it pays by weight, the locked schedule's entire premise is that one vault is *not* one unit of payout, and the deletion comment fifty lines down explains exactly that. A reader of the first screen is told the opposite of the product. Same defect in cron-install.sh's ops blurb ("equal per vault") and, stale but harmless, in `detectIndexShortfall`'s comment ("divides the day's cbBTC by the number of ACTIVATED vaults"). Fix all three.

### R5-c — LOW — Assorted

- 3prog.test.ts section 5's comment says "NOTHING IS MINTED IN THIS SECTION" — `const N = await mkVault()` mints a vault two lines above it. The quorum coupling it warns about is real; the claim about its own section is false.
- bank-sign.sh's "not in `ps`" (R3-1).
- `holdDays`'s "actually paid somebody" (R2-d).
- C5's "actually installs" is approximated by "appears in a `$TAG` line" (R4-c).
- C3 counts only `partialSign`; a `tx.sign()` site in cosign.mjs would be invisible to the "no route to a signature that skips the scan" claim.

---

## R6 — The card arithmetic

Independently recomputed: 45/25/15/10/5 % of 240 = 108/60/36/24/12 (sums 240); denominator 216+180+144+120+72 = **732**. Of 2,100 = 945/525/315/210/105 (sums 2,100); denominator 1,890+1,575+1,260+1,050+630 = **6,405**. Per $1,000 at 240: 2.732→2.73, 4.098→4.10, 5.464→5.46, 6.831→6.83, 8.197→8.20. At 2,100: 0.312→0.31, 0.468→0.47, 0.625→0.62, 0.781→0.78, 0.937→0.94. Shares: 29.508→29.5, 24.590→24.6, 19.672→19.7, 16.393→16.4, 9.836→9.8; sum exactly 100.0. V/I = 6/2 = 3 exactly. Dust bound 6,404 correct. **Every figure on the card is right.** No finding.

---

## CARRY-OVERS — worse than stated

- **#12 (CU):** worse, quantified in R1-a — the walk is now full-transaction and O(K²) per introspecting instruction, stacked across two opens and two burns in the multi-redemption case, and has never executed above ~6 instructions.
- **#16 (level register):** substantially worse — R2-a and R2-c. The stated limit covers verifiability; the unstated parts are nonexistence (no writer, no odds anywhere), invisibility (no watcher on the file that decides payouts), and lethality (a missing entry is a silent full halt).
- **#11 (distribution reconciles against a ledger the payer wrote):** marginally worse — this round added a new marker (`nothingToDo`) that the payer writes and the alarm treats as quiet, widening the class of states only the payer's own ledger can describe.
- **#18 (open items):** the code has not accidentally assumed a randomness source or ladder — checked. But note the absence is *total*: the odds on the card exist in no mechanism at all, not even a written manual procedure, while the card is customer-facing.

---

## VERDICT CHALLENGES (round 16)

- **The lock rewrite.** I tried to break the generation scheme and could not: the `.0` create race resolves on pass 2 against the winner's fresh record; two racers on one stale generation reduce to exactly one `link` winner of `G+1` (the loser gets EEXIST and reports `lostRace`); a third runner mid-break sees a fresh highest generation and refuses; the sweep only touches generations strictly below the winner's; release-by-token cannot delete a successor. One benign nit: a crash between `writeFileSync` and `link` leaves a `.claim.PID.rand` file that `scan` correctly ignores forever. The claim holds.
- **ELF offset 45.** A mainnet measurement with a live probe assertion and two named programs. I have no counter-evidence and no way to produce one from here; upheld.
- One bookkeeping challenge: the verdict's "Coverage GREEN — 26 files" and this round's "bank-sign.sh: NEVER AUDITED IN ANY ROUND" are both true only because the file postdates the last coverage run. Fine — but it means the coverage gate's green is a statement about the *last* round's bundle, and this round's new files (bank-sign.sh, the C1–C5 arms) start their audit clock at zero again. That is the freeze gate's job; just don't let "GREEN" in a verdict read as "including this round's additions."

---

## ANYTHING ELSE

- The `bank-sign.sh` stdin branch hangs on a TTY if an operator runs `-` without piping. Fail-closed; a one-line warning would help.
- The resumed-run console line prints an empty `total` and a literal `0n` dust (`plan.total ?? ''`), because the resume path doesn't reconstruct them. Cosmetic.
- Positive verifications worth recording: the confinement sees through address lookup tables (sysvar resolves ALT keys); no instruction can move Bank assets without naming the Bank (CPI accounts must subset the caller's — deepseek's round-16 rejection re-confirmed); the `because('4.7'/'4.10','BankKeyOutsidePair')` reason-pinning is correct and necessary.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Four things sixteen rounds of AI audit structurally cannot do, each buildable from parts this repository already has:

1. **An inverted coverage gate: every enforced refusal must be documented.** Every existing gate checks that a claim isn't too strong. Nothing checks the direction this round's headline lives in. Mechanically: parse every `#[error_code]` variant out of the four programs' Rust and require each name to appear in SPEC.md. `BankKeyOutsidePair` — a control that runs on every redemption — is in no document; this gate fails the build the day that happens, and would have failed it this round. Twenty lines beside C5.

2. **Differential reimplementation of the pure judges.** Have a model reimplement `judgeRedemptionTx`, `allocateWeighted`, `decideEmission`, and `holdDays` from SPEC.md *alone*, then run both implementations over a generated corpus of thousands of synthetic transactions and ledgers. Divergence means the spec or the code is wrong — and spec-code drift is precisely the defect class that produced this round's headline, round 16's headline, and the round-15 comment class before it. A reader catching drift by eye is what failed; a diff catching it mechanically is what's left.

3. **A time-compressed chaos rehearsal of the money pipeline.** Nothing has ever run distribute/revenue/alarm as a *system over time* with injected failures: kill −9 at random points, corrupted ledgers, a reboot (tmpfs loss), clock jumps across UTC midnight, overlapping crons, a stranger-funded activation, a frozen ATA, forty simulated days on a fake clock. Every R2 defect this round — the nothingToDo silence, the dead force, the hold-clock edges — lives in behaviour that only exists across days, which no single-round audit can see and no unit fixture expresses.

4. **Fuzz the transaction-shape space against the on-chain confinement.** Generate random instruction sequences — opens, burns, bank-naming instructions, ALTs, CPI wrappers, ComputeBudget — and assert the accept/reject verdict against a one-line oracle. AI rounds *reason* about the scan; a fuzzer *executes* it, at shapes no hand-written test will ever enumerate. The rule is small enough that the oracle is small.

And one operational note that is not a gate: the host state — key file permissions, the installed crontab versus the template, the hash of `levels.json` — should be snapshotted into the repository by a script on every run. Sixteen rounds have audited a tree; none has ever been able to audit the machine the keys sit on, and this round's worst payout defect is triggered by a state of that machine (a register with a hole in it) that no round can see.