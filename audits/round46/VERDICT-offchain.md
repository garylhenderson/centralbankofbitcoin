# Round 46, OFF-CHAIN pass: LAUNCH-CLEAN; QUORUM MET
REQUIRES CHANGES: V46o-1, V46o-2, V46o-3, V46o-4, V46o-5, V46-7, V46-8

**Independent triage verdict against audited head `63a92b2d39e105d5a8004d875efac8557412d1de` (`63a92b2`). HEAD is `255edd7`. `git diff --name-only 63a92b2 255edd7` names 19 files, all under `audits/round46/` (both manifests, the sixteen reports and the programs verdict), and `git diff --quiet 63a92b2 255edd7 -- bank scripts sim web launch programs tests SPEC.md HOLDER-GUIDE.md DESIGN-v6.md` exits 0. The product tree is round 45's validated repairs: `git diff --quiet e7c192a 63a92b2 -- bank web launch programs tests sim SPEC.md HOLDER-GUIDE.md DESIGN-v6.md` exits 0, and `git diff --name-only e7c192a 63a92b2` names only `audits/FREEZE.md`, `audits/round45/VALIDATION.md` and `scripts/audit46.ts`. The programs equal `RELEASE_COMMIT` `0b3ddb3` (`git diff --quiet 0b3ddb3 63a92b2 -- programs Cargo.toml Cargo.lock`). Six of the eight seats are counted against a required six. Quorum is met with no margin, and it depends on counting DeepSeek narrowly (reasons below).**

**Six findings are confirmed in this pass: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW, 5 INFO.** Five are new to this pass (V46o-1 to V46o-5). The sixth is the programs pass's V46-7, which an off-chain seat filed independently and I confirm independently. One more off-chain site belongs to the programs pass's V46-8 (the launch checker's rehearsal list names the seed-7 key). All are in the fixable layer: a selftest arm, the alarm's undelivered-pass state, the revenue job's and the alarm's load-time refusal, the offline web suite's untracked fixture, the audit instrument, and SPEC text. None is in the five programs. None moves value out of a vault, the pool or the revenue address, and none credits value wrongly. None stops or wrongly refuses a crack, and none is HIGH or MEDIUM. Under SPEC ship gate 3's launch gate (RULING, Gary 2026-10-08) the pass is **LAUNCH-CLEAN**.

**It is not a no-change round.** Each confirmed finding needs a change to a test, the alarm, the revenue job, the web test fixtures, the next audit script or SPEC text. None is an accepted limit already stated in SPEC. Gary's 2026-10-09 test ("a clean round where we make NO changes") is therefore not met by this pass, independently of the programs pass.

**The one LOW is a gate that cannot fail, and the grade is the brief's rule, not the reporter's.** Fugu filed it at INFO. The arm "a finding with no asset is never acked" drives an UNACKABLE kind. With the asset guard deleted from `applyAcks`, the selftest stays at its control result (identical failure set). On the one ackable kind, an asset-less finding with a well-formed ack is then downgraded to INFO. That is round 37 C01's exact shape, which was LOW.

**Two filed claims that would have mattered are disproved by measurement.** Fugu's LOW says the swap judge ignores per-instruction writable and signer flags. The mechanism is true, but every such shape compiles to a message byte-identical to the honest one, because Solana merges flags into one message header. So there is nothing for the judge to catch. Fugu's other INFO says `release_gate` cannot see an ignored file. `git ls-files --others` without `--exclude-standard` does list ignored files (measured in a scratch repository).

**28 deduplicated claim groups: 6 confirmed (1 LOW, 5 INFO; one INFO extended by this triage), 1 sibling site of a programs-pass finding, 0 uncertain, 4 already stated, the rest disproved or not a defect.**

Audited tree. `MANIFEST-offchain.json` records head `63a92b2…`, `dirty: []`, `promptChars` 1,958,748, requested 8, auditors 8, required 6. All eight entries are `ok: true`, `finish: stop`, `disqualified: null`. There is no `MANIFEST-offchain.first-run.json`, no re-run manifest and no `failed/` directory, so every seat is a first run and nothing is excluded for that reason. The eight files on disk match the manifest's character counts within the bytes of multi-byte characters (Grok 5,131 chars / 5,133 bytes; Ember 27,262 / 27,437).

Throughout this triage, `git status --porcelain` showed only `?? .cache` and `?? cache-keypairs-backup-20261008.tar.gz` (both predate it), plus this verdict once written. No tracked file was touched.
- **The only file this triage adds** to the repository is this verdict.
- **Mutation and harness runs** used an `rsync` copy at `/tmp/claude-1000/triage46o/c0` (`.cache`, `target`, `web/dist*`, `web/test/.out` and the key archive excluded; the tracked `node_modules` symlink copied as a symlink, inside `/tmp`). In that copy, every absolute `/opt/cbob-vaults` path in `bank/`, `scripts/`, `sim/`, `web/test/`, `web/src/` and `web/build.mjs` (64 files, `rewritten.txt`) was rewritten to the copy. The mutant `m1` is a second copy, rewritten to itself.
- **Nothing was created** under `/opt` (other than this verdict) or under `/home/ubuntu/cbob-rehearsal`, which I did not open.

**The programs pass** was triaged separately (`audits/round46/VERDICT-programs.md`, LAUNCH-CLEAN, 6/8, REQUIRES CHANGES V46-1 to V46-8, all in the rehearsal driver and recovery, the web build, the ceremony page and SPEC text). I read it only to deduplicate and did not adopt its conclusions. Overlaps:
- **Opus INFO-5 is V46-7** (SPEC item 53's stale-proof sentence). I re-read SPEC `:2197-2202` and round 45's VALIDATION myself and confirm it here as V46-7, not under a new id.
- **Qwen INFO-2 touches V46-8.** It names `REHEARSAL_INIT_AUTHORITIES` in `scripts/check-launch-params.mjs:183`, which lists the seed-7 key `GmaDrpp…` that V46-8 measured as program-owned with data on mainnet. That list is an off-chain-bundle site of V46-8's repair: if the rehearsal tree swaps in a fresh INIT key, this judge must accept it and must stop accepting the seed-7 key. I record it under V46-8 rather than as a new id.
- **No off-chain seat filed anything else from V46-1 to V46-6**, because the off-chain bundle does not carry the driver, `web/build.mjs` or `web/src/` (`scripts/audit46.ts:152-157` lists the driver in the programs branch only).

The repair patch outside the repository is not part of the audited tree. I judged the tree as audited.

## Quorum and the integrity of what was audited

**The bundle** (`scripts/audit46.ts:166-219`, the off-chain branch) carries the following:
- `bank/`: crank, detectors, alarm, layout, accrual, swap, **`rehearsal-env.mjs`** (new to this pass, `:177`), revenue, poster, selftest, spl, anchor, lock, sigwalk, txread and the v1 fixture.
- `scripts/`: rehearsal-tree, token-programs, audit-coverage, cron-install, check-launch-params, build-mainnet, probe, run-tests.
- `sim/swap-fork.*` and `tests/expiry-budget.mjs`.
- `launch/`.
- Ten `web/test` files.
- MINT and SWEEP source.
- SPEC, HOLDER-GUIDE, DESIGN-v6 and RT3.
- Round 45's **off-chain** verdict and VALIDATION.

It does not carry:
- round 45's programs verdict;
- the rehearsal driver (`scripts/rehearsal-run.mjs`, `-steps`, `-recover`), which `bank/selftest.mjs:4682` imports;
- `web/src/`, `web/build.mjs`, or `web/test/{ix,get,proxy}.test.mjs`.

**The prompt's R0 is now round 45's** (V45o-7's first half is repaired). Two statements in it are still wrong for this pass. It says "Both verdicts and VALIDATION are bundled", but the off-chain pass carries only the off-chain verdict. It asks each seat to verify the driver repairs "at all sites of their shape", and the driver is not bundled and the gap is not named (`:281`). This is V46o-5. GLM and Opus noticed the gap themselves. GLM believed the prompt named it; it does not.

**Substantive quorum: 6 counted of 8, required 6. MET, with no margin.** Excluding DeepSeek makes it 5 of 8, QUORUM NOT MET.

| Auditor | Disposition |
|---|---|
| anthropic/claude-opus-5.5 | **Counted.** 19,320 chars. The most precise seat. Its R0 walks each V45o repair to its construct: the three `seal.reserve_mints` readers (`alarm.mjs:343,534,563`); the top-level `FAIL_AFTER_SWEEP`/`FORCE_ORCA_REFUSAL` consts (`revenue.mjs:64-66`); `poolFrozen: !!pool?.frozen`; `carryUnreadPasses` from the real state-write line; `--selftest` before the NEVER-SENT exit. It re-derives the units from Q64.64 and DLMM's price convention, and the owed math for pre-joined and pre-expired vaults.<br>**Confirmed:** INFO-1 (V46o-2, measured), INFO-3 (V46o-3), INFO-4 (V46o-4, measured), and INFO-5 (V46-7).<br>**Not confirmed:** INFO-2 is not a defect (C11). Its limit-wording notes are C24. |
| fireworks/ember-1 | **Counted.** 27,262 chars. Engaged and correct about this tree:<br>• the flood arms' shapes and results ("flood at pass 0/2/3 … skip at pass 3/5/5", `selftest.mjs:3989-4000`, `[[2,3],[2,5],[2,5]]`);<br>• `refuseStrayOverrides` order in all three jobs;<br>• the crank's send order against MINT's gates;<br>• `grep -c AT2qf412` over the alarm (0, verified).<br>**Not confirmed:** its one INFO (C10). |
| sakana/fugu-max | **Counted.** 31,675 chars. The widest off-chain read. It quotes `keysAre` verbatim, the `!delivered` rollback list exactly, `release_gate`'s `ls-files` line, and the ack arm's exact text.<br>**Confirmed:** INFO-3, regraded to **LOW** (V46o-1, measured). INFO-1's mechanism (V46o-2); its stated consequence is wrong, measured.<br>**Not confirmed:** LOW-1 is disproved by measurement (C08). INFO-2 is disproved by measurement (C09). Its two observations and its limit notes are C23 and C24. |
| z-ai/glm-5.3-prime | **Counted.** 37,708 chars. It re-derives the PriceUpdateV2 offsets and the oracle identity, traces every round-24 arm family, and judges each web test file. It found the undelivered-pass residual itself and judged it safe (folded into V46o-2).<br>**Confirmed:** INFO-2 in part (V46o-5).<br>**Not confirmed:** INFO-1 is already stated (C12). INFO-3 is self-dismissed (C13).<br>**Peripheral error:** "the round-46 prompt names the gap". |
| qwen/qwen3.8-max-prime | **Counted.** 27,784 chars. Its constructs check out at this tree:<br>• `SELFTEST=0; [ "${1:-}" = "--selftest" ] && SELFTEST=1` before `if [ -n "$never" ] && [ $SELFTEST = 0 ]` (`audit-coverage.sh:83-84`);<br>• `carryUnreadPasses(prev?.unreadPasses, looked.unreadNow, looked.attempted)` (`alarm.mjs:829`);<br>• the cron minutes `23,53` / `37` / `*` / `41` (`cron-install.sh:148-151`);<br>• `REHEARSAL_INIT_AUTHORITIES` (`check-launch-params.mjs:183`).<br>Its INFOs are not defects (C07, C14); INFO-2 is a sibling site of V46-8.<br>**Peripheral errors:** its `BENIGN` list omits `RevealTooEarly`/`RescheduleTooEarly`; "per month (~34 SOL swept)" (that is per day). |
| deepseek/deepseek-v4-pro-0813 | **Counted, narrowly.** 21,908 chars. Every code excerpt it quotes is this tree's, verbatim:<br>• `planCrank`'s `if (joinable && poolOk && !pool.frozen && due && w > 0n)` (`crank.mjs:504`);<br>• the crank's frozen read (`:668`);<br>• the V45o-3 frozen-branch text, which exists only after round 45's repair (`detectors.mjs:2048-2049`);<br>• the royalty clock reset (`:2221`), the `parseRustStruct` regex (`layout.mjs:241`), the claim loop's `catch … continue` (`crank.mjs:566`) and `SW.0` (`swap-fork.mjs:77`).<br>Its mechanism readings of `detectDistributionOverdue`'s `poolAvail` guard and `classifySendFailure`'s `!st && expired` branch are right. Its conclusions are almost all wrong: its CRITICAL reverses its own derivation, and its MEDIUM about frozen pools is refuted by the line it quotes (C15 to C21). Its R0 checks no repair construct. Errors about real code are not invented contents, round 45's line for MiMo. **Without it, quorum fails (5 of 8).** I count it because its quoted code and two mechanism readings are specific, checkable and true of this tree, and I say so plainly so the margin is not mistaken for comfort. |
| minimax/minimax-m3 | **Not counted.** 14,484 chars. Titled "Round 45 confirmation".<br>• **Invented contents.** Its one finding says `readState` "is not defined in `bank/alarm.mjs`. There is no import, no local function". It is defined at `alarm.mjs:116` (`const readState = () => readLedger(STATE_FILE, null)`). It also says the per-pass `ataMints` reads `readState()`; it reads `prev?.config` (`:534`).<br>• **An older tree.** It reports V45o-4 at round 45's pre-repair numbers ("2 / 3 / 4 attempts … falls short by one pass").<br>• **Invented record.** Its rounds 41-44 table invents findings (V44-8 to V44-11, "V44-1 poster drain/gap").<br>Its claim is still triaged (C22). |
| x-ai/grok-4.20 | **Not counted.** 5,131 chars. Its first 23 lines reproduce round 45's off-chain verdict reply and result paragraph (seat list, V45o-1 to V45o-7, "Rounds 41-44: all 24"), not an audit of `63a92b2`. The rest is a generic list of pre-launch steps. No claim about this tree to triage. |

## Distinct claims and dispositions

Class column: (a) a finding in the five programs; (b) a path that moves value out of a vault, the pool or the revenue address, or credits value wrongly; (c) a stopped or wrongly refused crack; (d) HIGH or MEDIUM anywhere. "none" means outside all four. Following rounds 40-45, a claim whose mechanism is accurate but which violates no stated property, promise or accepted gate is DISPROVED *as a defect*, "mechanism accurate".

| ID | Reporters | Claimed | Verdict | Class | Evidence (file:line) |
|---|---|---|---|---|---|
| C01 | Fugu INFO-3 (the ack arm "a finding with no asset is never acked" cannot fail) | INFO | **CONFIRMED, LOW (V46o-1)**, measured; regraded by the round 37 precedent | none | `selftest.mjs:1239-1240` (drives `scan_gap`, unackable); `detectors.mjs:1118` (`if (!f.asset \|\| !f.kind) return f`), `:1023` (`ACKABLE_KINDS = {unredeemable_owner}`), `:1123-1126`, `:1133-1137` (unackable or malformed → `ackRefused`, severity kept). m1 (guard removed): selftest **1030/1032**, failure set identical to the copy's control (`diff` empty), the arm `ok`. `h/ackprobe.log`: under m1 an asset-less `unredeemable_owner` with a well-formed ack becomes **INFO (acked)**; unmutated, CRITICAL. |
| C02 | Opus INFO-1; Fugu INFO-1; GLM (residual, not filed) (the `!delivered` rollback keeps `unreadPasses` and `unreadSkips` from the undelivered pass) | INFO | **CONFIRMED, INFO (V46o-2)**, measured; Fugu's consequence disproved | none | `alarm.mjs:829` (written from this pass), `:855-873` (rollback restores cursors and backlogs, not these), `:856` ("Keep EVERY baseline … so an undelivered finding survives into the next pass whole"); `detectors.mjs:2461-2465`, `:1109-1113`. `h/undelivered.log`. |
| C03 | Opus INFO-3 (a load-time refusal in `revenue.mjs` and `alarm.mjs` sends no notice) | INFO | **CONFIRMED, INFO (V46o-3)**, source order | none | `revenue.mjs:58,64-66` (top-level throws) precede `withLock(…).catch` and `publishRevenueNotices` (`:635-648`), whose first stage is `'config'` (`:69`, `detectors.mjs:2610`). `alarm.mjs:64-65` precede `:985-998` (`RUN_FAILED` marker and notice; comment `:986` "must NEVER look like a quiet one"; H1 `:67-70`). The crank refuses inside `main()` (`crank.mjs:612-613`) and pages. Backstops: deadman `cron-install.sh:153` (2 h), `royalties_unswept` (≥ 24 h). |
| C04 | Opus INFO-4 (the offline web suite needs the untracked `.cache/placeholder`) | INFO | **CONFIRMED, INFO (V46o-4)**, measured | none | `web/test/ceremony.test.mjs:167,174` read `${ROOT}/.cache/placeholder/{out/cbob_placeholder.so,src/lib.rs}`; `.cache` is an untracked symlink to `/scratch/cbob-vaults-cache`; `git ls-files` names no placeholder file. Copy without `.cache`: `XX ceremony.test.mjs did not finish (floor 141)` (`c0-web.log:21`). `run-tests.sh:393-399` makes this suite a canonical gate. |
| C05 | GLM INFO-2 (the off-chain roster cannot see the driver the selftest imports); **triage** (the prompt says both verdicts are bundled) | INFO | **CONFIRMED, INFO (V46o-5)**: V45o-7's repair is incomplete | none | `scripts/audit46.ts:281` (OFF R0: "Both verdicts and VALIDATION are bundled"; asks for the driver repairs to be verified "at all sites of their shape"); `:204-205` (off-chain carries only `VERDICT-offchain.md` and `VALIDATION.md`); `:152-157` (driver in the programs list only); `bank/selftest.mjs:4682` (`await import('../scripts/rehearsal-run.mjs')`). No sentence of the off-chain prompt names the driver gap. |
| C06 | Opus INFO-5 (SPEC item 53 still calls its proof stale) | INFO | **CONFIRMED, INFO = V46-7** (programs pass), independently | none | SPEC `:2197-2202` (`d57ee3a` "is STALE; it must be re-run at the release commit, which is why this item stays OPEN") against `audits/round45/VALIDATION.md:43-46` (re-proven at `e7c192a`) and `/tmp/claude-1000/rehearsal-proof-e7c192a.log` (RC 0, read). |
| C07 | Qwen INFO-2 (`REHEARSAL_INIT_AUTHORITIES` accepts both Gary's wallet and the localnet key) | INFO | **NOT A DEFECT as filed** (both are keys a build can compile in, `:202`); its seed-7 entry is **a sibling site of V46-8** | none | `check-launch-params.mjs:183` (`'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB'`), `:202`, `:278-280` (arm passes both). V46-8 measured that key program-owned with 9 bytes of data on mainnet. |
| C08 | Fugu LOW-1 (`judgeSwapInstructions` ignores `isWritable`/`isSigner` on six instructions) | LOW | **DISPROVED** (measured): mechanism accurate, consequence impossible | none | `swap.mjs:352` (`keysAre` compares pubkeys only). `h/flags.log`: every cleared flag returns `[]` on both venues (the authority-slot control is caught). `h/flags-compiled.log`: each mutation, and all six at once, compiles to a message **byte-identical** to the honest one on both venues. Flags merge into the message header, and each key keeps its privilege from the fee payer or another instruction. A flag cleared on a key's every occurrence would be refused on chain. That is round 45 C21's loud class, and `sim/swap-fork` (16/16, `e7c192a`) lands the builder's real output. |
| C09 | Fugu INFO-2 (`release_gate`'s `ls-files --others` cannot see an ignored file) | INFO | **DISPROVED** (measured) | none | `run-tests.sh:304` (no `--exclude-standard`). Scratch repository: an untracked `build.rs` is listed, **and still listed after `echo build.rs >> .gitignore`**; only `--exclude-standard` hides it. The comment at `:300-302` ("untracked (or ignored)") is accurate. The arm covers the untracked case (`selftest.mjs:4599-4604`); an ignored-case arm is a recommendation. |
| C10 | Ember INFO (the $CBOB release wallet `AT2qf412…` is not watched) | INFO | **NOT A DEFECT; recommendation** | none | `grep -c AT2qf412 bank/alarm.mjs bank/detectors.mjs` = 0 (verified). Limit 56 (SPEC `:1874-1890`, BUYER-FACING; guide `:223-227`) states the theft and its costs. No document says the alarm would see it, and the alarm's stated list (SPEC `:2478`) does not name it. A cheap per-pass outflow read is worth adding. |
| C11 | Opus INFO-2 (`unreadPasses` is never pruned) | INFO | **NOT A DEFECT** | none | `detectors.mjs:2463`. An entry strands only if its signature is never attempted again, which needs a hand-edited cursor (a counted signature has `!s.err`, `alarm.mjs:658`, and an `err` is stable). Not stranger-driven; no stated bound. |
| C12 | GLM INFO-1 (the guide's bare-burn sentence omits limit 27's case) | INFO | **ALREADY STATED (limit 27)**; not a defect in the guide | none | `HOLDER-GUIDE.md:83-84`; SPEC `:1441-1457` (not BUYER-FACING: the burner's own outcome, the sentence's subject, is the same). GLM self-judged it a wording choice. |
| C13 | GLM INFO-3 (`gap: true` at exactly `maxPages` full pages) | INFO | **NOT A DEFECT** (self-dismissed; the loud direction) | none | One false `scan_gap` HIGH; the next pass proves the drain. |
| C14 | Qwen INFO-1, INFO-3 (`records.find` is O(n²); `preExpires.includes` redundant) | INFO | **NOT A DEFECT** | none | Hourly, 2,100 records; no correctness effect (Qwen's own words). |
| C15 | DeepSeek F7, F10 (`meteoraSpot` is inverted; the deviation filter and SW.0 are broken) | CRITICAL / LOW | **DISPROVED** | none | Its own first paragraph derives both spots in sats per lamport, then reverses without a step. `swap.mjs:223` inverts DLMM's lamports-per-sat into sats per lamport. Round 45 C01: SW.7 both usable, SW.8/SW.9 18.1 and 20.1 bps under the oracle (`.cache/c9a811d-suite.log`); `e7c192a` fork 16/16. Five counted seats re-derive the units independently. |
| C16 | DeepSeek F3 (a frozen pool with `poolAvail` 0 gets no `distribution_overdue`) | HIGH | **DISPROVED as a defect; mechanism accurate** | none | `detectors.mjs:2041` returns before the frozen branch when nothing is undistributed, by design: `selftest.mjs:1830` "QUIET with nothing undistributed (nothing to pay)". A frozen pool pages `pool_frozen` CRITICAL anyway, and the stalls above `:2041` still report. |
| C17 | DeepSeek F1 (the crank plans a credit from a frozen pool) | MEDIUM | **DISPROVED** | none | `crank.mjs:504` (`… && !pool.frozen && …`), the line it quotes. |
| C18 | DeepSeek F4 (an attacker keeps the royalty clock fresh by moving SOL out of the revenue PDA) | MEDIUM | **DISPROVED** | none | Only `sweep_sol_for_swap` moves SOL out, and it needs the swap operator's signature (`mint/src/lib.rs:2630-2631,1060`). A stranger's deposit raises the balance and never resets the clock (`detectors.mjs:2221`). |
| C19 | DeepSeek F6 (`owed` keeps a stale value after a caught error) | MEDIUM | **DISPROVED** | none | `crank.mjs:556` `let owed` per iteration; `:566` `catch … continue`. |
| C20 | DeepSeek F9 (`!st && expired` can misread a landed swap) | MEDIUM | **ALREADY STATED** (round 45 C10, limit 10(b)) | none | `swap.mjs:484`; SPEC `:1275-1276`. |
| C21 | DeepSeek F2, F5, F8, F11 (rescue race; multi-line field; min-out units; the page may not use the bundled planner) | LOW / - | **NOT A DEFECT / DISPROVED** | none | MINT pins the rescue destination and checks the host on chain. `parseRustStruct` throws (`layout.mjs:241`), failing the gate. F8 is self-dismissed. `web/src/pages/redeem.mjs:21` imports the same `plan-redeem.mjs` the bundle test runs. |
| C22 | MiniMax (V45o-1's repair calls an undefined `readState()`) | LOW | **DISPROVED** (invented contents) | none | `alarm.mjs:116` defines it; `:343` uses it in `reconcile()`, which has no `prev`; `:534` uses `prev?.config`. R45 V45o-1 arms pass in today's 1032/1032. |
| C23 | Fugu observations (`confirmSole` with a corrupt lower generation; `detectSplitClaims` throws on a hand-edited ledger row) | (obs.) | **NOT A DEFECT** | none | `place()` writes a complete record before linking, so a live claim cannot be unreadable. The ledger throw is loud and needs a hand edit (limit 10's box residue). |
| C24 | Limit and wording notes: Fugu (limits 6, 7, 27 "stronger than stated"); Opus (limit 8 narrower; a per-month limit-10 figure; first-pass SEAL-null fallbacks differ; `CBOB_ALARM_REHEARSAL` not gated) | (obs.) | **NOT A DEFECT / ALREADY STATED** | none | All are in the safe direction or already recorded. `CBOB_ALARM_REHEARSAL` is round 45's recommendation; a null SEAL on a first pass has no balance to drop. |
| C25 | Every counted seat (round 45's disproofs re-tested: C01 units, C02 bitmap, C24 `split_bps`) | (agree) | **STILL DISPROVED**; round 43's gate-5 item 5 still open | none | `swap.mjs:223,428` unchanged since `c9a811d`; `bitmapExists: !!bm` still has no owner check. |

Also already stated, and not re-counted:
- limit 10's extraction arithmetic, re-derived by every counted seat;
- limit 25's missing request timeout (Opus);
- the bundle split recorded by round 45 (programs C18, `.cache` and the key archive making `build-mainnet.sh` refuse; still true, `git status` above).

## Confirmed findings

| ID | Severity | Independent disposition and minimal repair |
|---|---|---|
| **V46o-1**: Fugu INFO-3 (filed INFO) | **LOW** | **The arm "a finding with no asset is never acked" cannot fail when the guard it names is removed.**<br><br>**The construct.** `applyAcks` returns an asset-less finding untouched (`detectors.mjs:1118`). The arm (`selftest.mjs:1239-1240`) drives `scan_gap` with the bare value `'x'` and asserts only the severity. Two later paths keep the severity anyway: `scan_gap` is not in `ACKABLE_KINDS` (`:1133`), and a bare value is a malformed ack (`:1123`).<br><br>**Measured** (copy `m1`, the guard reduced to `if (!f.kind) return f`):<br>• The selftest gives 1030/1032, the same two scratch-path failures as the unmutated copy (L7 `target/deploy` keypairs, R28 rehearsal). `diff` of the failure lists is empty, and the arm reads `ok`.<br>• Probe (`h/ackprobe.log`): on the one ackable kind, an asset-less `unredeemable_owner` with a well-formed ack keyed `unredeemable_owner:undefined` becomes **INFO, acked**, against CRITICAL unmutated.<br><br>**What it contradicts.** The arm's own name, and the round 37 C01 repair, which moved the ack arms onto `unredeemable_owner` for exactly this reason.<br><br>**Severity and class.** **LOW** by the round 37 precedent the brief names (round 37 C01 was this exact shape). Today the one emitter always sets `asset` (`detectors.mjs:1356`), so nothing is muted now. The guard is defence in depth that nothing pins.<br>• (a) No: `bank/selftest.mjs`.<br>• (b) No.<br>• (c) No.<br>• (d) No.<br><br>**Repair (`bank/selftest.mjs`).** Drive the arm on `unredeemable_owner` with no asset and a well-formed, unexpired ack keyed `unredeemable_owner:undefined`, and assert CRITICAL and no `acked`. Keep the `scan_gap` case beside it with `ackRefused` false asserted. Show it red under m1. Gate-5 item 1. |
| **V46o-2**: Opus INFO-1; Fugu INFO-1; GLM residual | **INFO** | **An undelivered pass rolls back the cursors but writes its unreadable counts and skip list. The alarm then pages a skip that has not happened, beside a restarted count for the same signature.**<br><br>**The construct.** `alarm.mjs:829` writes `unreadPasses` and `unreadSkips` from this pass. The `!delivered` block (`:855-873`) restores the config, balances, cursors, backlogs and seven other fields, but not these two. That is contrary to its own rule (`:856`, "Keep EVERY baseline, cursors included").<br><br>**Measured** (`h/undelivered.mjs` / `.log`). The real extracted walk, run with round 45's flood-harness anchors (each anchor and the rollback lines must occur verbatim, or it throws). Budget 2, X permanently unreadable, main()'s write and rollback applied as written.<br>• **Control, all delivered:** X held passes 1-2; on pass 3 it is skipped, the cursor moves to `b`, and `tx_skipped_unreadable` pages.<br>• **Delivery failing on passes 1-3:** on pass 3, X goes into `unreadSkips` while the written cursor stays at `c`. On passes 4 and 5, both delivered, the alarm pages `tx_skipped_unreadable`, whose text says the scan "moved past them". In the same notices it pages `tx_unreadable` "pass 1 of 3", then "pass 2 of 3", for the same X. X is really skipped on pass 6.<br><br>**What is NOT true** of Fugu's consequence: the skip is not earlier in delivered terms (it is the third delivered pass, as in the control), and no "pass N of 3" page is lost (the count restarts and re-pages). Opus's description is exact.<br><br>**Severity and class.** **INFO.** For two passes after a delivery failure, the record and one HIGH page say a signature was moved past while the walk is still held on it. The pages contradict each other and nothing goes quiet. **Class: none** (detection bookkeeping).<br><br>**Repair (`bank/alarm.mjs`).** In the `!delivered` block, `next.unreadPasses = prev?.unreadPasses ?? {}` and `next.unreadSkips = prev?.unreadSkips ?? []`. `logGaps`, `seenSplits` and `seenSweeps` are also written un-rolled-back, but they record facts the re-scan re-observes, and I found no false statement from them. Gate-5 item 2. |
| **V46o-3**: Opus INFO-3 | **INFO** | **A stray rehearsal override refuses the revenue job and the alarm at module load, before their failure-notice paths exist. The crank, which refuses inside `main()`, pages.**<br><br>**The construct.**<br>• `revenue.mjs:58` (`NOTIFY`) and `:64-66` (`refuseStrayOverrides()` and both switches) throw at load, before `withLock(…).catch` (`:635-648`). That handler is the only caller of `publishRevenueNotices`, whose stage list starts at `'config'` (`detectors.mjs:2610`; `revenueStage = 'config'`, `:69`).<br>• `alarm.mjs:64-65` throw before `:985-998`, which writes the `RUN_FAILED` marker and sends `run_failed` ("A pipeline that cannot read must NEVER look like a quiet one", `:986`; round 24 H1 at `:67-70`, "a run that died is a condition with its own stream").<br>• The crank calls `refuseStrayOverrides()` at `crank.mjs:613`, inside `main()`, and its failure path keeps the production notifier (round 45, `:890-892`).<br><br>**Not run:** the brief forbids running the revenue job and the alarm. This is source order, and an uncaught top-level throw in an ES module exits before any later statement runs.<br><br>**What it costs.** A stray `CBOB_REHEARSAL_RPC`, `…_FAIL_AFTER_SWEEP` or `…_FORCE_ORCA_REFUSAL` in an environment only the revenue job inherits stops every cycle silently. `royalties_unswept` pages after ≥ 24 h. In the alarm's environment, the deadman pages within 2 h (`cron-install.sh:153`). Shared by all three jobs, the crank pages at once. It needs a human misconfiguration, as V45o-2 did.<br><br>**Severity and class.** **INFO.** Fail-closed: nothing is read or sent. The silence is bounded by the deadman and `royalties_unswept`. V45o-2's repair (refuse at load, which round 45 asked for) is correct and is not reversed by this. **Class: none.**<br><br>**Repair (`bank/revenue.mjs`, `bank/alarm.mjs`).** Wrap the load-time refusal and, before exiting, call the literal production notifier once with a `config`/`run_failed` label, as the crank does. Or state the deadman and `royalties_unswept` bound beside limit 25's statement. Gate-5 item 3. |
| **V46o-4**: Opus INFO-4 | **INFO** | **The offline web suite cannot run from the repository: `ceremony.test.mjs` reads the placeholder program's bytes and source from the untracked `.cache`.**<br><br>**The construct.** `web/test/ceremony.test.mjs:167,174` read `.cache/placeholder/out/cbob_placeholder.so` and `.cache/placeholder/src/lib.rs`. `.cache` is an untracked symlink (`.cache -> /scratch/cbob-vaults-cache`, created 2026-10-08), and no placeholder file is tracked. `run-tests.sh:393-399` holds the suite at exactly 695 as part of every canonical run.<br><br>**Measured.** In the copy without `.cache`: `XX ceremony.test.mjs did not finish (floor 141)`, run-all exit 1 (`c0-web.log:21`). The live tree, with `.cache`, gives 695/695.<br><br>**Why it matters beyond the test.** That placeholder is what the five mainnet ids hold today (SPEC road step 9, `:2653`, "`.cache/placeholder`, 20,920 bytes, sha256 `94f75099…`"). Its source and the test's fixture live only in a scratch directory outside the repository and its history.<br><br>**Severity and class.** **INFO.** It fails closed and hides nothing, round 44 V44o-4's and round 45 V45o-5's class (a gate red in a legitimate configuration). **Class: none.**<br><br>**Repair.** Track the placeholder's source and its sha256 (and the 20,920-byte binary, or a test that rebuilds it), and point the test there. Gate-5 item 4. |
| **V46o-5**: GLM INFO-2; triage | **INFO** | **V45o-7's repair is half done. The off-chain prompt's R0 is round 45's now, and `rehearsal-env.mjs` is bundled. But the prompt still tells this pass that "Both verdicts and VALIDATION are bundled", and it asks for the driver repairs to be verified at all sites, while carrying neither round 45's programs verdict nor the driver that `bank/selftest.mjs:4682` imports. The gap is named nowhere.**<br><br>**Evidence.** `scripts/audit46.ts:281` (OFF R0), `:204-205` (the off-chain bundle's two round-45 records), `:152-157` (driver, programs list only), `:316` (the scope sentence names only SEAL, BURN and GOV as absent). V45o-7's repair: "bundle every module a pass's targets import (or name the gap in the prompt)".<br><br>**Effect.** No product file changes. Three counted seats spent text on the gap, and GLM believed the prompt had named it. **Class: none.**<br><br>**Repair (`scripts/audit<N>.ts`).** Make the bundle claims of each pass's R0 computed from that pass's file list. Bundle `scripts/rehearsal-run.mjs` with the selftest that imports it, or name the gap. Gate-5 item 5. |
| **V46-7** (programs pass; Opus INFO-5 here) | **INFO** | Confirmed independently, as the programs triage states it: SPEC `:2197-2202` still gives the stale `d57ee3a` proof as the reason item 53 stays OPEN, where round 45's VALIDATION records the re-proof at `e7c192a` (log RC 0, read). **Class: none.** The repair is the programs verdict's. |
| **V46-8** (programs pass; sibling site from Qwen INFO-2) | (LOW, as graded there) | Not re-graded here. **The off-chain-bundle site:** `check-launch-params.mjs:183` accepts the seed-7 key `GmaDrpp…` as a rehearsal `init_authority`, and the R43 arm (`:278-280`) pins that acceptance. V46-8's repair (a fresh throwaway INIT key substituted into the tree) must change this list and arm with it, or the rehearsal judge will refuse the repaired tree's value file. **Class: none.** |

### The documentation exception (SPEC gate 3, ruling of 2026-10-07)

- V46o-1 to V46o-4 change a test, the alarm, the revenue job or the fixtures. **Not eligible.**
- V46o-5 is the audit instrument. **Not eligible.**
- V46-7 is text and would qualify alone. It cannot make this a no-change round while the others stand.

## Rounds 41 to 45 re-check, per confirmed finding

I re-read each verdict's mechanism against `63a92b2`, checked the repaired sites named below and classified each finding again. The programs are byte-identical to the release every round judged.

| Finding | Severity | (a) programs | (b) value | (c) crack | (d) H/M | Outside (a)-(d)? |
|---|---|---|---|---|---|---|
| R41 **V41-1** dusting a config PDA made the ceremony pages refuse | LOW | No (page reads) | No (refusal before launch) | No (ceremony) | No | **Yes** |
| R41o **C01** the poster drafted per transaction | LOW | No (`redemption-poster.mjs`) | No (drafts, no sender) | No (the redemption had landed) | No | **Yes** |
| R41o **C02** the oracle-age arm moved with its constant | LOW | No (`selftest.mjs`) | No (on-chain floor binds; SW.7a-9) | No | No | **Yes** |
| R41o **C03** SPEC's crank fee-budget sentence | INFO | No | No | No | No | **Yes** |
| R42 **V42-1** a malformed path killed the local ceremony server | INFO | No | No | No | No | **Yes** |
| R42 **V42-2** an earlier transaction could hide the collection create | INFO | No | No | No | No | **Yes** |
| R42o **C01** omitted vaults lost their reserve baseline after a shrunk pass | LOW | No (`alarm.mjs`, `judged`) | No (detection) | No | No | **Yes** |
| R43 **V43-1** a host's owner keeps a nested vault by Executing it out during their own opening | LOW | No program defect against the ruled design (SPEC limit 58; 912/912 at `e7c192a`) | No (an owner takes from their own vault's wallet in their own crack) | No | No | **Yes** |
| R43 **V43-2** the e2e header described the old rescue rule | INFO | No | No | No | No | **Yes** |
| R43o **V43o-1** the release check died in the rehearsal tree | LOW | No (`run-tests.sh`) | No | No | No | **Yes** |
| R43o **V43o-2** one unreadable signature froze a scan | LOW | No (`alarm.mjs:666-683`) | No (detection) | No | No | **Yes**. Its skip record can run ahead of an undelivered pass's rollback (V46o-2, INFO, outside) |
| R43o **V43o-3** the reveal-skip arm could not fail | LOW | No (`selftest.mjs`) | No | No | No | **Yes** |
| R44 **V44-1** the rehearsal ceremony could not consume the value file | LOW | No | No | No | No | **Yes** |
| R44 **V44-2** `release_gate` accepted any reversible swap and ignored untracked files | LOW | No (`run-tests.sh:300-305`, `:321-341`) | No | No | No | **Yes**. The untracked check covers ignored files too (measured, C09) |
| R44 **V44-3** the coverage gate could not credit LAUNCH-CLEAN | LOW | No | No | No | No | **Yes** |
| R44 **V44-4** RULED missing from the status legend | INFO | No | No | No | No | **Yes** |
| R44 **V44-5** limit 59 cited the test validator's rent | INFO | No | No | No | No | **Yes** |
| R44 **V44-6** "the one exception" omitted the bare burn | INFO | No (programs credit as SPEC states; `HOLDER-GUIDE.md:81-84`) | No | No | No | **Yes** |
| R44 **V44-7** an absent pinned collection shown as BROKEN | INFO | No (ceremony page) | No | No | No | **Yes** |
| R44o **V44o-1** the poster's skip never fired while a backlog drained | LOW | No (drafts only) | No | No | No | **Yes**. Repaired; in today's 24/24 |
| R44o **V44o-2** the split-recovery scan died on one refused signature | LOW | No (`revenue.mjs`) | No (the job stops; balances stay) | No (cracks never touch the revenue job) | No | **Yes**. Repaired |
| R44o **V44o-3** a null SEAL read dropped reserve baselines | LOW | No (`alarm.mjs:563`) | No (detection) | No | No | **Yes**. Repaired, completed by V45o-1 |
| R44o **V44o-4** the no-network runner exited 1 | INFO | No | No | No | No | **Yes** |
| R44o **V44o-5** the rehearsal runbook did not cover the off-chain jobs | INFO | No | No | No | No | **Yes** |
| R45 **V45-1** item-22 predicates could pass without their evidence | LOW | No (driver) | No | No | No | **Yes** |
| R45 **V45-2** `--rpc box` put the key in argv | LOW | No (driver) | No | No | No | **Yes** |
| R45 **V45-3** deploy key not tied to the judged id | LOW | No (driver; no real program touched) | No | No | No | **Yes** |
| R45 **V45-4** rescue bricked on a lost confirmation | LOW | No (driver) | No | No | No | **Yes**. General case is the programs pass's V46-1 (outside) |
| R45 **V45-5** cycle 1 judged by venue order | LOW | No (driver) | No | No | No | **Yes** |
| R45 **V45-6** the init window was not "at once" | INFO | No | No | No | No | **Yes**. The reorder's clock is V46-2 (outside) |
| R45 **V45-7** `'box'` as DAS URL; sweep-back scope | INFO | No | No | No | No | **Yes** |
| R45 **V45-8** 22.1 PASS at 5 vaults | INFO | No | No | No | No | **Yes** |
| R45 **V45-9** SPEC 53 alarm text stale | INFO | No | No | No | No | **Yes** |
| R45 **V45-10** hand recovery recorded signatures late | INFO | No | No | No | No | **Yes** |
| R45 **V45-11** collection create lacked the taken check | INFO | No | No | No | No | **Yes** |
| R45o **V45o-1** null SEAL invented "no reserve mints" at two more sites | LOW | No (`alarm.mjs:343,534`) | No (detection) | No | No | **Yes**. Repaired at all three readers; R45 V45o-1 arms ×2 in 1032/1032 |
| R45o **V45o-2** forced-failure switches read after the sweep | LOW | No (`revenue.mjs:64-66`) | No (the ordinary capped sweep to the Bank's own operator key) | No | No | **Yes**. Repaired; the load-time refusal is silent (V46o-3, INFO, outside) |
| R45o **V45o-3** frozen-pool overdue text blamed every layer | INFO | No (`detectors.mjs:2048`) | No | No | No | **Yes**. Repaired |
| R45o **V45o-4** a flood reset the unreadable count | INFO | No (`detectors.mjs:2461`, `alarm.mjs:829`) | No | No | No | **Yes**. Repaired on delivered passes (`selftest.mjs:3999`, `[[2,3],[2,5],[2,5]]`); the undelivered pass is V46o-2 |
| R45o **V45o-5** coverage selftest red on a never-bundled file | INFO | No (`audit-coverage.sh:83-84`) | No | No | No | **Yes**. Repaired |
| R45o **V45o-6** `budgetPlan` low-key wording | INFO | No (`crank.mjs:333`) | No | No | No | **Yes**. Repaired |
| R45o **V45o-7** prompt described the wrong round; split bundles | INFO | No (`scripts/audit46.ts`) | No | No | No | **Yes**. Half repaired (V46o-5) |

**All forty-two are outside (a)-(d).** Rounds 41 and 42 stand as the two launch-clean rounds on their confirmed findings. Rounds 43 to 45 confirmed the trees their predecessors' repairs changed, and round 45's off-chain repairs hold at every site I checked. They fall short only at V45o-4's undelivered branch (V46o-2) and V45o-7's prompt (V46o-5).

## Gate-5 obligations

SPEC ship gate 4 requires every accepted finding to have a gate that fails the build in both directions. Gate 5 requires every measurable rejected finding to become an assertion. These are obligations, not findings.

1. **V46o-1:** the asset-less `unredeemable_owner` arm with a well-formed ack (CRITICAL, not `acked`). It must be shown red under m1 (`!f.asset ||` removed). Measured today: under m1 that input becomes INFO, and the existing arm stays green.
2. **V46o-2:** an extract-and-run arm in `h/undelivered.mjs`'s shape. Delivery fails for three passes, then succeeds. It expects no `tx_skipped_unreadable` while the written cursor has not moved past X, and the skip on the third delivered pass. Shown red at `63a92b2` (measured: skip paged on passes 4-5 beside "pass 1 of 3" and "pass 2 of 3").
3. **V46o-3:** with a stub notifier path, a set override outside a tree makes `revenue.mjs` and `alarm.mjs` reach the notifier once before exiting. Or, if SPEC states the bound instead, no arm.
4. **V46o-4:** `run-all.mjs` from a `git archive` of the release commit (no `.cache`) reaches 695, or the fixture's sha256 is pinned in a tracked file.
5. **V46o-5:** no arm. The next instrument's R0 claims only files its pass carries.
6. **V46-8, off-chain site:** the launch selftest's R43 arm (`check-launch-params.mjs:278-280`) moves with the INIT substitution, and a rehearsal value file naming the seed-7 key is refused once the tree compiles a fresh key.
7. **Measurable rejections:**
   - **C08:** an arm that each flag-cleared build compiles to the honest message, or that the judge refuses a key whose every occurrence lost its flag. Recommended.
   - **C09:** a `release_gate` fixture arm with an ignored `build.rs` (`echo build.rs >> .gitignore`), still refused. Recommended; it pins the comment at `run-tests.sh:300-302`.
   - **C16:** already pinned (`selftest.mjs:1830`).
   - **C10:** a release-wallet outflow detector with both-ways arms, if adopted.
   - **C15, C17-C22:** settled by reading or already pinned; no arm.
8. **Carried, still OPEN:**
   - Round 43's gate-5 items 4 (the `pdas`/`atas`/`assets` block on a shrunk pass) and 5 (the bitmap's owner, `swap.mjs:428` still `!!bm`).
   - Round 44's gate-5 item 6.
   - Item 22.5's DAS read.
   - Round 44's recommendations C11, C12, C15, C22, C25 and C27.
   - Round 45's recommendations: C10's status re-read, C11-C14, and gating `CBOB_ALARM_REHEARSAL` through `rehearsalOnly`.
   - Round 45's off-chain gate-5 items 1 to 5 are DISCHARGED: R45 V45o-1 ×2, V45o-2 ×3, V45o-3, V45o-4 ×2 and V45o-5, all in today's 1032/1032.

## Independent measurements

All artefacts are in `/tmp/claude-1000/triage46o/`.

| Measurement | Result | Evidence |
|---|---|---|
| Detector selftest, live tree | **1032/1032**, exit 0 | `det.log` |
| Web offline (`run-all.mjs`), live tree | **695/695** in 10 files at their floors, exit 0 | `web.log` |
| Launch / poster / allocation selftests, live tree | **68/68**, **24/24**, **39/39**, exit 0 each | `launch.log`, `poster.log`, `accrual.log`, `rc.txt` |
| Copy control (no `.cache`, no `target`) | detectors 1030/1032: L7 (`target/deploy` keypairs) and R28 rehearsal, scratch artefacts; web: `ceremony.test` did not finish (V46o-4), plus `bundle.test` 68/83 (copy artefacts of the rewritten `web/src` paths and the missing `dist`; not used for any finding) | `c0-det.log`, `c0-web.log` |
| V46o-1, m1 (`!f.asset \|\|` removed) | 1030/1032, failure set identical to control; the arm `ok`; asset-less `unredeemable_owner` + well-formed ack → INFO (acked), unmutated CRITICAL | `m1-det.log`, `c0-xx.txt`/`m1-xx.txt`, `h/ackprobe.log` |
| V46o-2, delivery failing passes 1-3 | skip recorded on pass 3 with the cursor rolled back; passes 4-5 page `tx_skipped_unreadable` beside "pass 1/2 of 3"; skipped on pass 6; control skips on pass 3 | `h/undelivered.log` |
| C08, swap-judge flags | the judge returns `[]` on every cleared flag (the authority-slot control is caught); every mutation and all six together compile to a byte-identical message, both venues | `h/flags.log`, `h/flags-compiled.log` |
| C09, `ls-files --others` | an ignored `build.rs` is still listed; only `--exclude-standard` hides it | `gitprobe/` (scratch repository) |
| Canonical runs, read | `e7c192a` suite RC 0 (912/912, fork 16/16), web e2e 132/132 RC 0, sim 71/71 RC 0; rehearsal proof (item 53) RC 0, 16/16; driver local RC 0 | `.cache/e7c192a-*.log`, `/tmp/claude-1000/{rehearsal-proof,driver-local}-e7c192a.log` |
| HEAD against the audited head; product against `e7c192a`; programs against the release | code equal; only `audits/round46/` differs; product equal to `e7c192a`; programs equal `0b3ddb3` | `git diff --quiet` (session) |

## Measurement limits

- **Nothing live was run.** No validator, `run-tests.sh`, `e2e-localnet.sh`, fork, sim, crank, alarm pass, revenue job, poster against an RPC, the rehearsal driver or router delivery. Nothing money-moving or notifying ran. No mainnet read was made, and `/home/ubuntu/cbob-rehearsal` was not opened.
- **V46o-2** was measured on the extracted walk with main()'s write and rollback applied by the harness, not through `main()`. The harness asserts the write line and both rollback lines occur verbatim, and refuses to run if the rollback ever restores the unread fields.
- **V46o-3** is source order. Running the revenue job or the alarm is outside the brief, even to watch them refuse.
- **V46o-1's** severity is the brief's round 37 rule. Today nothing emits an asset-less ackable finding, so no ack is wrongly honoured now.
- **C08** compiled legacy messages with web3.js `Transaction.compileMessage()`. The merge rule is the same for the v0 messages a send might use; I did not compile v0.
- **The copy's web artefacts** (`bundle.test` 68/83) come from rewriting paths inside `web/src` and the excluded `dist`. No finding rests on them. The live tree's 695/695 is the gate result.
- **Seat decisions are judgments.** Quorum has no margin and depends on DeepSeek, whose quotes are this tree's and whose conclusions are mostly wrong. A stricter reading makes the pass QUORUM NOT MET. The two excluded seats are clear-cut: MiniMax invents the code behind its one finding, and Grok reproduces round 45's verdict.
- **What no measurement here shows:** whether the dress rehearsal will pass, whether the router delivers at 3 am, or whether a person acts correctly on a page.

## Remaining requirements

- **Before the next confirmation round:** V46o-1 to V46o-5 with gate-5 arms 1 to 4, each shown red at `63a92b2`. Then V46-7 and V46-8 (with the off-chain site above), from the programs verdict. V46o-2 and V46o-3 touch `bank/`, so a launch-clean confirmation of the changed tree follows the rule rounds 41-45's repairs followed.
- **Before the freeze ends:** round 43's gate-5 items 4 and 5, round 44's item 6, and item 22.5's DAS read.
- **Unchanged:** items 22, 38, 50, 52 and 53 remain OPEN AND BLOCKING. `charter_opens_at`, `lock_deadline` and `vault_collection` remain OPEN in `launch/mainnet-init.json`. No deployment, initialization, lock, ceremony, cron installation, rehearsal or publication follows from this audit.

**Result: QUORUM MET (6 counted of 8; six required; no re-runs; DeepSeek counted narrowly). LAUNCH-CLEAN under SPEC gate 3's launch gate: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW (V46o-1 an ack arm that cannot fail), 5 INFO (V46o-2 the undelivered-pass skip record, V46o-3 the silent load-time refusal, V46o-4 the untracked web fixture, V46o-5 the audit prompt's bundle claims, V46-7 SPEC 53's stale sentence), plus V46-8's site in the launch checker; nothing in the five programs; no value path; no refused crack. REQUIRES CHANGES: not a no-change round.**

---

## Reply (under 300 words)

**Round 46, off-chain pass: LAUNCH-CLEAN; QUORUM MET. REQUIRES CHANGES: V46o-1, V46o-2, V46o-3, V46o-4, V46o-5, V46-7, V46-8.**

**Seats counted: 6 of 8 (6 needed, no margin):** Opus 5.5, Ember, Fugu, GLM-prime, Qwen max-prime, and DeepSeek narrowly (its quotes are this tree's; its conclusions mostly wrong). **Not counted:** MiniMax invents its finding (`readState` is defined at `alarm.mjs:116`) and describes round 45's tree. Grok reproduces round 45's verdict.

**Confirmed, all outside (a)-(d):**
- **V46o-1, LOW (selftest):** "a finding with no asset is never acked" survives deleting its guard. Measured; round 37 precedent.
- **V46o-2, INFO (alarm):** an undelivered pass keeps its unreadable counts, so the alarm pages a skip that has not happened. Measured.
- **V46o-3, INFO (revenue, alarm):** a stray rehearsal override refuses at load with no notice; the deadman or `royalties_unswept` catches it.
- **V46o-4, INFO:** the offline web suite needs the untracked `.cache/placeholder`. Measured.
- **V46o-5, INFO:** the off-chain prompt says both verdicts are bundled and never names the driver gap (V45o-7 half done).
- **V46-7, INFO:** SPEC item 53 still calls its proof stale (confirmed independently).
- **V46-8:** `check-launch-params.mjs:183` accepts the seed-7 key; it must move with that repair.

**Disproved:**
- Fugu's swap-judge-flags LOW: every case compiles to a byte-identical message.
- Fugu's ignored-file INFO: `ls-files --others` lists ignored files.
- DeepSeek's CRITICAL, HIGH and four MEDIUMs.
- MiniMax's typo.

**Rounds 41-45:** all 42 confirmed findings remain outside (a)-(d).

Selftests: 1032, 695, 68, 24, 39, all green.
