# Round 31, PROGRAMS pass: NOT CLEAN; QUORUM MET

**Final verdict against frozen HEAD `425111ddce55c5595671b998bb7ed3c42a979207` (round-30 repairs `0d13b03`, docs `aa2b521`, preflight fixes `425111d`). Eight substantive, completed, current-tree auditors are counted: five from the first run and three from a same-commit rerun of the three failed seats. Six are required, so quorum is met. Independently confirmed findings survive, so the pass is not clean.**

The clean-round counter remains **0/2**.

**30 deduplicated claim groups: three confirmed topics (0 CRITICAL, 0 HIGH, 0 MEDIUM, one LOW, two INFO; one INFO was found by this triage) and 27 other dispositions (16 accepted, covered or optional, 11 refuted).** Every CRITICAL, HIGH and MEDIUM an auditor filed was refuted, three of them by new measurements. No program defect is confirmed. The LOW is in the certification gate (`scripts/audit-coverage.sh`). One INFO is in the round's own prompt and is shared with the off-chain pass, which receives the same text. Count it once in the combined round.

## Auditor dispositions

Two manifests describe this pass. `MANIFEST-programs.first-run.json` records 5/8 (head `425111d`, `dirty=[]`, prompt 1,220,761 characters). `MANIFEST-programs.json` records the rerun of the three failed seats: 3/3, same head, `dirty=[]`, same prompt length. This follows the round-24 precedent: same commit, same script, same prompt. Every counted report was read in full.

The rerun manifest's own `required` is 3. It therefore says nothing about the pass's quorum. This verdict is the only record of it (see L1).

| Auditor | Run | Disposition |
|---|---|---|
| anthropic/claude-fable-5.1 | first | **Counted.** `stop`, 28,846 characters. Full current-tree review with every offset and space recomputed. Raised F1 (HIGH, conditional on measurement; refuted, W1), F2 (A2), F3 (part D2, part A5, part W8), F4 (W6), F5 (A3) and F6 (A4). |
| anthropic/claude-sonnet-5.5 | first | **Counted.** `stop`, 15,282 characters. Current-tree review. Raised F1 (HIGH, conditional on measurement; refuted, W1), F2 (MEDIUM; refuted as stated, W5), F3 (A5), F4 (W1) and F5 (A6). It also noticed the prompt's round-number inconsistency (D1). |
| qwen/qwen3.8-max-0902 | first | **Counted.** `stop`, 22,757 characters. Current-tree review with offsets and pool, ring and rate algebra. L-1 is confirmed (L1). L-2 is covered (A1). It says it "imported this module read-only against mainnet". Auditors in this process cannot execute anything, so that is not treated as evidence. Its substance matches round 30's W3 measurement. |
| qwen/qwen3.8-2.4t-a95b | first | **Counted.** `stop`, 24,985 characters. Current-tree review. Its header names `c5aab17` but cites the round-30 repairs. F2 is confirmed (L1). Its "MINT_CONFIG_SPACE sums to 1253" is wrong (W9). |
| z-ai/glm-5.3 | first | **Counted.** `stop`, 26,461 characters. Current-tree review with all spaces and discriminators. F1 is confirmed (L1). F2 is covered (A1). F3 is accepted (A3). |
| meta/muse-spark-1.3 | rerun | **Counted.** `stop`, 14,371 characters. Its R0 heading says "Round 29" because the prompt does (D1), but the section describes round 30's verdict and checks the round-30 repairs in this tree. R1 to R8 are analysed against the current code. Its CRITICAL C1 is refuted by measurement (W2). Its R1s(c) claim that a below-rent credit to a missing account "does not fail" is wrong (W10). |
| meituan/longcat-2.0 | rerun | **Counted.** `stop`, 18,257 characters. Its header names `c5aab17`, but it verifies D1, D2 and T1 as present, which is the current tree. It makes no finding. Its MINT space figure of 1253 is wrong (W9). |
| xiaomi/mimo-v2.6-pro | rerun | **Counted.** `stop`, 16,232 characters, current tree (`425111d`). F1 (MEDIUM) is refuted by source (W3). F2 (LOW) is not a defect (W4). |
| meta/muse-spark-1.3 | first | **Not counted:** HTTP 503 `service_overloaded`, 398 characters (`failed/`). |
| meituan/longcat-2.0 | first | **Not counted:** `FETCH FAILED terminated`, 23 characters (`failed/`). |
| xiaomi/mimo-v2.6-pro | first | **Not counted:** `finish_reason: error`, 407,685 characters of `[reasoning only]` that ends in a repetition loop. It reached no verdict. Its one concrete lead, that lamports cannot be credited to a token-owned destination, was checked and is covered (A14). |

**The round's own warning.** Both runs printed "THE WORKING TREE CHANGED DURING THE ROUND". The cause was the main session creating the untracked `scripts/audit32.ts` while the rounds ran. My judgement is that this does not affect what the auditors were shown:

- **No untracked file can enter the prompt.** `scripts/audit31.ts` builds the prompt at module scope from the 42 `TARGETS` (all tracked), three floor files, SPEC's ACCEPTED LIMITS section and `git log`. It has no directory listing and does not read `audit32.ts`.
- **The tree was clean when it mattered.** Both manifests sampled `git status` over every watched path just after building the prompt, and both recorded `dirty=[]`.
- **The prompt re-renders identically.** `RENDER_ONLY=1 FOCUS=programs` at the clean HEAD gives 1,220,761 characters, which matches both manifests exactly.
- **Every bundled file is byte-identical to `425111d`.** I compared each of the 42 bundled file bodies against `git show 425111d:<path>`: 42/42 identical (`.cache/triage31p/bundlecheck.log`).
- **The file is gone.** `scripts/audit32.ts` is no longer on disk, and `git status` shows only `audits/round31/`.

## Method and evidence

The method was as follows:

- I read all eight counted reports in full and the three failed outputs.
- I checked every claim against source at `425111d`, against the round-30 verdict and validation, and against the retained logs.
- I made four new bounded measurements (below).
- The prompt was rendered offline from the cached `tsx`, with `npx --no-install`, so nothing was installed.

**What was not touched.** No tracked file was changed. No `bank/` entrypoint was imported. No crank, revenue, alarm, notification, mainnet send, deploy or lock was run. No mainnet RPC was used.

**The validator window.** I used one isolated validator window under `.cache/VALIDATOR.lock`.

- **Lock and ports.** The lock was created atomically with `noclobber` after confirming that no lock existed and that ports 8999 and 9900 were free.
- **Programs loaded.** The validator ran pinned Core (dumped and `cmp`-identical to the cache, whose sha256 is the pin `f03e7537…`). It also ran the pinned classic Token, Token-2022 and ATA, the suite's test CPI wrapper (`3231e0a1…`, the same hash as the r30 suite log), and SEAL's tested localnet build (`92df3c8a…`, the same hash as the r30 suite log). It used the suite's two feature deactivations.
- **Cleanup.** Afterwards the validator had exited, both ports were free, and the lock, the scratch ledger and the scratch clone were removed.

**Round-30 repairs, verified present:**

- **M1:** `bank/sigwalk.mjs` takes `startBefore`. `bank/alarm.mjs:557-677` keeps `backlogs[id] = {head, before}`, advances the cursor only on drain, requires positive proof before declaring an empty resumed walk drained (`scan_backlog_unproven`, CRITICAL), and pages an unresolvable cursor (`scan_cursor_unresolvable`, CRITICAL).
- **L1:** the gate compares current git blobs against a completed round's head, and reads bundles from the script at that commit. A residual survives as this round's L1.
- **D1:** SPEC 672-673, item 49 and `DESIGN-v6.md:191-194` now state 1,772,920 lamports on mainnet and 2,429,040 on the test validator.
- **D2:** `DESIGN-v6.md:380` gives about 209 hours (8.7 days).
- **T1:** `build-mainnet.sh:191-196` attaches "reaching a check below" to the localnet acceptance.
- **Programs unchanged.** `programs/`, the wrapper crate and the workspace manifests are unchanged since `c5aab17`.

**Gates at this code, not rerun here:** 855 on-chain, 898 detector, 39 allocation, 22 poster, 14 PoB, 47 launch, 6 host, 33 mainnet, 4 expiry and 16 swap-fork (`.cache/r30-full-pass.log`), plus 71 simulation (`.cache/r28-sim.log`). I spot-checked the log lines.

## Confirmed findings

| ID | Severity | Independent disposition and minimal repair |
|---|---|---|
| **L1**: Qwen-max L-1, GLM F1, Qwen-2.4t F2 | **LOW** | **The coverage gate credits a round when its verdict's first five lines lack three exact phrases. SPEC says the verdict must record a met quorum, so the gate is weaker than its documented contract.** SPEC 2212 and 2220 say a file's current content must have been "in the bundle of a completed round whose independent verdict records a met quorum". VALIDATION and the script's own comment say the verdict must not "record a failed quorum". The code (`scripts/audit-coverage.sh:136-143`) does something narrower. It requires the runner manifest's `auditors >= required`, then skips the round only if `INCOMPLETE QUORUM\|QUORUM NOT MET\|QUORUM IS NOT MET` appears in the verdict's first five lines.<br><br>**Measured in a scratch clone of `425111d`** with the real round-31 rerun manifests (programs 3/3, off-chain 2/2), varying only the round-31 verdict text (`.cache/triage31p/gate-demo.log`):<br>• "QUORUM NOT MET" on line 1: not credited, exit 1, 26 files stale.<br>• "QUORUM FAILED": credited, strict gate exits 0. This is round 20's own wording (`audits/round20/VERDICT.md:6`).<br>• A plain-words statement that 5 of 8 is not verdict-bearing: credited, exit 0.<br>• "QUORUM NOT MET" on line 6: credited, exit 0.<br>• No verdict (control): exit 1.<br><br>**Why the manifest check does not cover this.** After a rerun, `MANIFEST-<focus>.json` is the rerun's (round 24 and round 31 programs: 3/3), so the runner-count condition holds automatically. The verdict text is then the only quorum guard.<br><br>**No current misclassification.** Every round credited at HEAD records a met quorum, so this is a gap in ship-gate condition 1, not a false certification today.<br><br>**Repair:** have triage write a structured quorum record (for example `audits/roundN/QUORUM-<focus>.json` with counted, required and met), and have the gate require it. Failing that, require a positive `QUORUM MET` on line 1, and reject any negative or ambiguous quorum statement anywhere in the file. Add a both-ways selftest built from these five cases. |
| **D1**: triage; Sonnet R0 noticed the inconsistency | **INFO** | **The round-31 prompt names the wrong prior round, and the runner's own check enforces the stale number.** `scripts/audit31.ts:253` sends "**ROUND 29 READ THIS TREE BEFORE YOU, AND ITS VERDICT IS YOUR FIRST TARGET**". Lines 185 and 216 send "**R0. ROUND 29'S VERDICT AND ANY REPAIRS**" to both passes. The bundled prior verdict is round 30's (`TARGETS`, line 109).<br><br>No round has read `425111d` before this one, and round 29 audited `76753e8`. `proseChecks()` (lines 653-654) refuses any prompt that does not say "ROUND 29 READ THIS TREE". That is the stale-label defect its own comment describes (audit24 shipping "ROUND 22"), now enforced by the check meant to prevent it.<br><br>**Effect, measured on the reports.** Muse titled its R0 "Round 29's verdict" while describing round 30's. The counted reports all engaged with the bundled round-30 verdict, so no auditor was given the wrong content.<br><br>**Repair:** in the next round's script, derive the prior round number from the bundled verdict path, and have the prose check assert that derived number. |
| **D2**: Fable F3 (fifth bullet) | **INFO** | **`scripts/probe-mainnet-facts.mjs:28` tells the reader to run `node scripts/probe-signature-paging.mjs`.** That file was deleted in round 10 (`2ba635c`). The probe is run as `node scripts/probe-mainnet-facts.mjs` (`run-tests.sh:297`, SPEC 2310). The command as written fails. **Repair:** correct the usage line. |

## Accepted limits, covered, bounded or optional

| ID / reports | Disposition |
|---|---|
| A1: Qwen-max L-2, GLM F2, Qwen-2.4t F1, Sonnet/Fable/Muse scope notes | The `sigwalk` consumers are in the off-chain bundle (W4 of round 30). The empty-result ambiguity is handled there. A pruned resume point is held by `scan_backlog_unproven` (CRITICAL, `alarm.mjs:660-677`, which requires the cluster to prove the next signature below `before`). A pruned cursor is `scan_cursor_unresolvable` (CRITICAL, `alarm.mjs:574-590`). Referred to the off-chain verdict. |
| A2: Fable F2 (LOW) | Limits 10 and 47 combine: a stolen operator key plus a stolen or absent guardian means royalty SOL drains at cap × cooldown until two half-of-live votes land. Both sentences are true as written. SPEC 10 conditions its bound on "until the guardian pulls `emergency_stop_sweep`", and 47 states that a stolen guardian cancels any operator a vote arms and that the stop can be permanent at low turnout. It is a double-key compromise, bounded by "never more than the revenue PDA holds above the reserve". Optional: one sentence in 10. |
| A3: Fable F5, GLM F3 | SPEC 26 says C's leader can "CHOOSE AMONG MANY DRAWS", that "a validator can time a mint (or a reschedule)", and that "*Who:* the census". Skipping all four slots hands C to an unknown next leader: a pass, not a known choice, and dominated by content grinding (64 tries reach 96%). Rescheduling another holder's lapsed vault is census-wide influence, which 25 and 26 already state. Optional wording only. |
| A4: Fable F6 | Core's `BurnV1` refunds to the forwarded `payer`. This is round 30 A4. No document says otherwise (grep: the only refund sentences concern the never-refunded record). Optional page-contract note. |
| A5: Fable F3 (evidence gaps), Sonnet F3 | The following have no suite arm and are verified at source: an empty pre-created reserve ATA through the helper (the `amount > 0` guard skips the transfer, then `CloseAccount` runs); a non-ATA stray classic account through the helper (it checks owner, mint and length only, never ATA-ness); `pob_extra = 8`; and a 30-record `expire_boosts` (round 30 A6/A7). SPEC 44's "a frozen one holding zero is only closed, measured round 30" is true: `.cache/triage30o/close-frozen-mainnet-token.*`, round 30 off-chain D2. Optional arms. |
| A6: Sonnet F5 | Four keyed programs' tested and shipped bytes differ by the `localnet` feature. This is round 30 A10/A11, and the stated boundary is `build-mainnet.sh:200` "NOT PROVEN". Optional: run the suite against `dist/` on a local validator with the real key. |
| A7: Qwen-max INFO-1 | The excluded round-30 seat's raw output is retained (`audits/round30/v30-programs-x-ai_grok-4_20.md`), so the count is replayable. Process note. |
| A8: Qwen-max INFO-2, Muse §6, Sonnet F2's repair | `retire_orphaned`, refusing off-curve owners, the tombstone relaxation, and decoupling the reveal from Core are owner decisions before the lock (round 30 A13). |
| A9: Qwen-max INFO-3 | v1 transactions are not certified for the pairing. This is the stated transaction-format boundary, and no v1 writer is shipped. |
| A10: all eight, launch sections | The live rehearsal (22), launch values (38), holder surfaces (50), cbBTC accounts (52), the rehearsal re-proof (53), independent rebuilds, the ceremony, key custody, a bounty and human reads are open ship-gate work, not new defects. |
| A11: Qwen-2.4t F4/F5, LongCat, MiMo, GLM, Muse R0 | Round 30's D1 and T1 are repaired at HEAD (sites above). |
| A12: MiMo "anything else" | HOLDER-GUIDE's present tense for unbuilt pages is held by its DRAFT label and item 50's publication ban. |
| A13: Fable R1s(f), Sonnet R1s(f) | A fourth pair does not fit the padded legacy shape. This is round 30 A2, and SPEC 50 states it. |
| A14: MiMo first-run partial | "A System transfer to a token-owned destination fails" is wrong. Only the source must be System-owned, and R27.S1 measures a non-System destination credited. |
| A15: Fable R8 | The gate credits bundling, not engagement. That is its stated intrinsic limit (SPEC 2212). |
| A16: Muse R6 (operational squat check) | After W2, an operational "abort if any config/pool address holds lamports" is unnecessary. A pre-init read-back remains item 38's. |

## Refuted or unsupported premises

| ID / reports | Independent disposition |
|---|---|
| W1: Fable F1 (HIGH if measured), Sonnet F1 (HIGH pending measurement), Sonnet F4, Fable's F1-shape evidence gap | **Refuted by measurement.** The claim: an owner shapes an unrevealed vault so that the reveal's Core `UpdatePluginV1(Attributes)` exhausts Core's heap, which would halt the FIFO.<br><br>**Calibration.** I rebuilt MINT's exact Core shape: `create_vault`'s plugin order (PermanentFreezeExecute frozen, then Attributes), a collection with the Royalties plugin under authority None, the owner's five plugins in the suite's R26 order, the suite's `PADTAIL!` autograph construction, and the reveal's attribute replacement sent by CPI. A keypair stands in for MINT's PDA as the collection and Attributes authority. Core checks only the signer, and MINT reads only `data[0]` and the length of the asset before its CPI. This reproduced the suite both ways:<br>• R28.A1: a 10,150-byte write, then the reveal: both ALLOW.<br>• R28.A2: shrinking the autograph: REJECT with `memory allocation failed`.<br><br>**The largest autograph an owner can write is 10,198 bytes.** That is Core data of exactly 10,240 bytes, the runtime's `MAX_CPI_INSTRUCTION_DATA_LEN`. One more byte is refused. An Autograph update carries the whole list, so growth cannot be spread over several instructions or signers: a second signer sending only his own signature is refused (Core `0x28`), and the list stays at its old size.<br><br>**The worst reachable shape lands.** That shape has the full 640-byte stored list (7 pairs, and the suite's 5-pair `exact()`), a 64-character name, a 200-character URI, a 64/200 collection, all five owner plugins and the 10,198-byte autograph (asset 11,383 bytes). The reveal-equivalent lands at 47,971 and 41,223 CU, writes the level, and keeps the autograph.<br><br>So no reachable owner shape blocks the reveal on the pinned Core. The "20–30 KB from several keypairs" premise is impossible, and DISCHARGED item 19 stands. The HOLDER-GUIDE autograph paragraph (131-137) is consistent with this. A Core upgrade remains limit 40. Optional: pin this shape as a suite arm (`.cache/triage31p/heap.mjs`, `heap.log`). |
| W2: Muse C1 (CRITICAL) | **Refuted by source and measurement.** Anchor 0.31.1's `init` (`anchor-syn` `generate_create_account`) handles a pre-funded address: it tops up the rent, then calls `allocate` and `assign` with the PDA seeds. The ATA program does the same.<br><br>**Measured.** A stranger sent 1,000,000 lamports to SEAL's config PDA. SEAL `initialize` then **landed**, leaving the PDA owned by SEAL, 398 bytes, version 2. A stranger dusted an off-curve owner's ATA address. A non-idempotent ATA `create` on the pinned mainnet ATA program then **landed** (a 165-byte classic account). All four `initialize`s and the record `init` use the same generated code. Evidence: `.cache/triage31p/squat.mjs`, `squat.log`. |
| W3: MiMo F1 (MEDIUM) | **Refuted by source.** BURN's second loop iterates only `ctx.remaining_accounts`, whose length must equal the caller's `declared` (`burn/lib.rs:328,350`). A stranger's Token-2022 account that the owner does not declare is never read. That is limit 44 (destroyed, arms 9.7-9.9), not a refusal. Reserve mints are classic only (SEAL `assert_classic_spl`, `ReserveMintNotClassicSpl`), and a Token-2022 ATA for a classic mint cannot be created (probe F4.2), so no extension account can sit at a required address. Declaring an extension account is refused on purpose, because a confidential balance reads zero. |
| W4: MiMo F2 (LOW) | **Not a defect.** For `[[A,B],[C,A]]`, pair 2 refuses either way: a closed `A` gives `IllegalOwner`, and a live `A` is owned by the signer, not `dest`, giving `InvalidAccountData`. No document promises a named aliasing error. |
| W5: Sonnet F2 (MEDIUM) | **"Unbounded leverage" refuted.** The diverted share is the orphans' weight over total active weight. Each orphan is a whole vault plus at least 21,000 activation sats, which the attacker also loses forever, so the cost is linear in the share. SPEC "What got worse" (170-183) states the per-orphan permanent cost on every other vault, boosts included, "far larger while few vaults are active", and that a fix is possible only before the lock as an owner decision (round 29 D2, round 30 A13). No false sentence. |
| W6: Fable F4 (INFO) | **Not false.** `activate` runs `monthly_inline` before recording the request (`mint/lib.rs:1405-1409`, commented as deliberate). A request that lands in the instruction that performs the tick is therefore made after the tick, and it joins at "the next distribution" (HOLDER-GUIDE 14-15). "Activated by then" (27-28) is accurate. |
| W7: Qwen-2.4t F3 (INFO) | **Not a defect.** The runtime enforces writability. A non-writable pair fails in the runtime, atomically. No document says otherwise. |
| W8: Fable F3 (`C.2`, `2.1` "cannot fail") | If either precondition fails, the helper throws and the suite exits non-zero. `run-tests.sh:344-354` then fails on the exit code or the floor. The property is enforced, not vacuous. |
| W9: Qwen-2.4t R7, LongCat R7 | "`MINT_CONFIG_SPACE` = 1253 (997 + 256)" is wrong: `mint/lib.rs:2475-2480` sums to 1,005 + 256 = **1,261**, as Fable and GLM state. No finding depended on it. |
| W10: Muse R1s(c) | "A System transfer to a non-existent destination creates it below rent and does not fail" is wrong, because the runtime refuses an under-rent new account. SPEC 50's client contract (the destination must exist, and the canonical one is the fee-paying owner) is the correct statement. No finding depended on it. |
| W11: Qwen-max R0 | Its "I imported this module read-only against mainnet" cannot have happened, so I do not count it as evidence. The conclusion it supports was measured in round 30 (W3). |

## Measurements

| Measurement | Result | Evidence |
|---|---|---|
| Bundle identity (warning judgement) | 42/42 bundled bodies equal `git show 425111d:<path>`. The render is 1,220,761 characters, equal to both manifests. | `.cache/triage31p/bundlecheck.mjs`, `.log` |
| Coverage gate (L1) | Five verdict variants against the real rerun manifests: one correct refusal, three wrong credits (exit 0, 26 files), and the control. | `.cache/triage31p/gate-demo.log` |
| Reveal heap (W1) | Calibrated to R28.A1 and R28.A2 both ways. Maximum autograph 10,198 (CPI 10,240). No growth by a second signer (0x28). Worst shape (11,383-byte asset) reveals at 41-48k CU. | `.cache/triage31p/heap.mjs`, `heap.log` |
| Address squat (W2) | Dusted SEAL config PDA, then `initialize` landed. Dusted ATA, then non-idempotent create landed. | `.cache/triage31p/squat.mjs`, `squat.log` |

## Remaining requirements

- Repair L1: a structured or positive quorum record, the gate requiring it, and a both-ways selftest. Then re-check that every credited round still qualifies.
- Correct D1 in the next round's script (derive the prior round number), and D2.
- Optional: pin W1's worst shape as a suite arm, together with the evidence-gap arms in A5.
- L1 and D2 touch `scripts/`, so the freeze resets.

Holder surfaces, the live rehearsal, initialization and the lock ceremony remain separate open ship gates.

**Result: QUORUM MET (8 substantive of 8 seats across the first run and the same-commit rerun; six required). NOT CLEAN (0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW, 2 INFO; no program defect confirmed). Counter 0/2.**
