# Round 48, PROGRAMS pass: NOT LAUNCH-CLEAN; QUORUM NOT MET
REQUIRES CHANGES: V48-1, V48-2, V48-3

**Independent triage verdict against audited head `d0e77e013bee9dc83e895d44419cb39f7e09c5e6` (`d0e77e0`). HEAD is `d0e77e0`; `git status --porcelain` was `?? audits/round48/` before and after this triage. The program source equals `RELEASE_COMMIT` `d2ae5fc` (`git diff --quiet d2ae5fc d0e77e0 -- programs Cargo.toml Cargo.lock` exits 0). `git diff --stat bba189a d0e77e0` names only `README.md` (the round-47 row and road row 8), `SPEC.md` (Gary's 22.2 ruling), `audits/FREEZE.md`, `audits/round47/VALIDATION.md` and `scripts/audit48.ts`, so the canonical `bba189a` runs are runs of this tree's code. `dist/` checks against its `SHA256SUMS`, which equal `web/src/config.js:51-55`.**

**Quorum is NOT met: I count five of eight seats against a required six.** The three seats excluded from the first runs (DeepSeek, MiniMax, Grok) were re-run on the same head and the same prompt (1,951,157 characters, per every manifest), and none of the re-runs is a real audit of this tree:
- **DeepSeek's re-run** is a summary. It writes "Verified" and "None" against each target, cites no file or line, and states that item 22.2 "remains open", which SPEC contradicts.
- **MiniMax's re-run** is reasoning only. It was cut off at 128,000 output tokens and never reaches a report (round 47's LongCat line).
- **Grok's re-run** answers the sweep-helper questions by saying the helper and the suite refuse shapes the helper accepts by design. It names two alarm detectors that do not exist, and it gets BURN's treatment of a closed account wrong.

The first runs are in `failed/` and are not counted. Under the brief a round without quorum cannot be launch-clean, whatever it found.

**Three findings are confirmed: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 2 LOW, 1 INFO.** None is in the five programs, none moves or miscredits value, none stops a crack, none is HIGH or MEDIUM. On its findings alone this pass would have been launch-clean; it is NOT LAUNCH-CLEAN only because quorum failed.

**It is not a no-change round.** Each confirmed finding needs a change:
- V48-1: one condition in the redeem planner.
- V48-2: two validator runners that the round-47 lock (V47o-2) never reached.
- V48-3: two stale sentences in `web/README.md`.

None is an accepted limit already stated in SPEC, and none is a recorded ruling of Gary's.

**Two of the three are round-47 repairs that did not reach every site of their shape.** The validator lock reached five runners but not `sim/rehearsal-local.sh` or `scripts/validate-core-gate.sh` (V48-2). The web floor moved 801 to 805 but `web/README.md` still says 801, and its stray-listing paragraph still describes the `getProgramAccounts` read that round 46 replaced. V47-9 fixed that same staleness in the proxy's header only (V48-3).

**The one finding near class (c) is a one-time, retryable refusal.** A vault that is waiting to join is opened without a `claim`. If the crank or a 100 $GARY burner joins and credits it during the holder's Phantom approval, MINT refuses the opening with `ClaimBeforeBurn`. Preflight is on, so nothing lands. The vault is then active, so the next press includes the claim and opens it. It cannot recur for that vault. I confirm it as LOW in the page and explain below why it does not stop a crack.

## Auditor dispositions

**Manifests.** `MANIFEST-programs.first-run.json` (and `MANIFEST-programs.json`) records head `d0e77e0…`, `dirty: []`, `promptChars` 1,951,157, requested 8, required 6, and eight first runs, all `finish: stop`, `disqualified: null`.
- **Three re-run manifests**, each recording the same head, `dirty: []` and the same `promptChars` 1,951,157:
  - `MANIFEST-programs.rerun-deepseek_deepseek-v4-pro-0813.json`: 13,701 characters, `stop`.
  - `MANIFEST-programs.rerun-x-ai_grok-4_20.json`: 19,619 characters, `stop`.
  - `MANIFEST-programs.rerun-minimax_minimax-m3.json`: 461,985 characters, `length` at 128,000 output tokens, `disqualified: "output cut off mid-report"`.
- The coordinator's note gave the prompt as "1,946,xxx"; every manifest says 1,951,157, which is what I reproduced.
- The three first outputs are in `failed/` (30,366, 27,991 and 6,344 characters, equal to the first-run manifest) and are not counted. `failed/` also holds one off-chain file, which is not this pass's.
- `RENDER_ONLY=1 FOCUS=programs TAG=v48tri npx tsx scripts/audit48.ts` reproduced 1,951,157 characters.
- Every report's character count (`wc -m`) equals its manifest entry.

I read all eight first-run reports in full, the DeepSeek and Grok re-runs in full, and the MiniMax re-run's opening, its close and every passage that names a severity or a finding. This pass carries `web/src/lib/tx.mjs`, `web/src/pages/ceremony.mjs`, `scripts/validator-lock.sh`, `sim/rehearsal-local.sh`, `scripts/validate-core-gate.sh` and `tests/expiry-budget.mjs`. It does not carry `scripts/readme-facts.mjs`, `scripts/core-watch*.{mjs,sh}`, `scripts/cron-install.sh`, `web/test/mock-rpc.mjs` or `bank/*.mjs` except `txread`, `sigwalk` and `rehearsal-env` (checked against the prompt's `=== <path>` headers).

| Auditor | Disposition |
|---|---|
| anthropic/claude-opus-5.5 | **Counted.** 14,367 characters. Source-only, said so. Its R0 checks each repair at its construct and finds the two unreached sites. R7's offsets are right (`bare_burns_retired` 454, `sweep_floor_lamports` 631, ring 749..1005).<br>**Confirmed:** F-1 (V48-1), F-3 (V48-2), F-4 (V48-3).<br>**Not confirmed:** F-2 is disproved by measurement (C5); F-5 and the 22.2 note are not defects (C6, C7). |
| fireworks/ember-1 | **Counted.** 19,446 characters. States its bundle boundary correctly (`readme-facts.mjs`, `core-watch.mjs`, `cron-install.sh` and `mock-rpc.mjs` are absent and not confirmed). Its R0 is right at every site I checked: `registryOf`/`deserializePluginRegistryV1` with the AppData control R.4b; `{ minUnits: sim.unitsConsumed \|\| null }`; the two-direction role check; the README, SPEC and proxy text. Its offset table is right, and so is the GOV restart-skip complement (`stop_at >= created_at` against MINT's `StopIsNewer`).<br>**Confirmed:** V48-1 as filed (V48-3's first half).<br>It calls V47o-2 "sound" without seeing the two runners outside it (V48-2). |
| z-ai/glm-5.3-prime | **Counted.** 24,867 characters. Its R0 table is right at every row I checked. It re-tests round 47's disproofs, and its offsets are right (its "body 997" excludes the 8-byte discriminator: 8 + 997 + 256 = 1,261).<br>**F48-1:** its three facts are true as measured (C10), but they are round 47's listed gate-5 obligations, not a new defect.<br>**Not a defect:** its vault-page sub-claim (C11). |
| qwen/qwen3.8-max-prime | **Counted.** 18,849 characters. Shallow and files nothing, but its claims are specific and true:<br>• R.4's `registryOf` and R.4b, the README program table, road row 8, SPEC 53's new text ("ran to its end", last in-tree run `e7c192a`) and the proxy's five `gpaShape` results;<br>• the pool invariant derived step by step;<br>• `max_boost_epochs ≤ 63 < 64`;<br>• cap ≤ 45 < 64 at 2,100 vaults;<br>• the MintConfig offsets.<br>**Against it:** it says `web/src/lib/tx.mjs` is not in its bundle (false: the prompt carries it, C12), so it declined to verify V47-4 and V47-5. That is an error in the declining direction, not invented contents. This is round 46's and round 47's line for Qwen max. |
| sakana/fugu-max | **Counted, narrowly.** 22,798 characters. Its two findings quote the tree exactly (`validator-lock.sh:21-23`, `plan-get.mjs:66`), and I measured the first mechanism. Its MintConfig, SealConfig, BurnConfig and VaultRecord offsets are right. It has the ruled boost ceilings right (12, 24; `launch/mainnet-init.json:153-162`).<br>**Against it:** its R0 says V47-1 and V47-2 were "Verified" in `readme-facts.mjs`, which is not in its bundle; the text matches `VALIDATION.md` and round 47's verdict. Neither of its findings is confirmed (C8, C9).<br>Quorum fails with or without it. |
| deepseek/deepseek-v4-pro-0813 (re-run) | **Not counted.** 13,701 characters, 3,250 output tokens. A summary of the prompt's targets with each answered "Verified" or "Finding: None". It cites no file, line, offset or arm figure of its own; R7 is one sentence ("I have recomputed every offset … All are correct") with no figure.<br>**Its R0 claims verification it could not make:** "The selftest arm shows an untracked `audits/roundN` leaves `--check` green", for `readme-facts.mjs`, which is not in its bundle; its text tracks `VALIDATION.md`.<br>**Its specific statements are generic or wrong:**<br>• item 22.2 "The ruling is recorded, but the item remains open" (SPEC `:1932-1936`: 22.2 is accepted, and item 22 stays open only for scale, C26);<br>• "the arms that cannot fail are … the control arms" (R.4b is a control that fails unless it reads `Royalties\|1`, C27).<br>A template answered "none", not an audit. |
| deepseek/deepseek-v4-pro-0813 (first run, in `failed/`) | **Not counted.** 30,366 characters. Its R0 says "I verified the following claims against the bundled files". It then reports the bundle as the pre-repair tree, and every one of those claims is false of the prompt it received:<br>• `ceremony.mjs` "at line 237 calls `signExact` without `minUnits`" (the bundle passes it, prompt line 20403);<br>• README:101-103 "shows the old wording" (prompt line 26324 has the new);<br>• `tests/3prog.test.ts` "shows the old regex-based approach" (the bundle's `registryOf` uses `deserializePluginRegistryV1`, prompt line 8468);<br>• SPEC 53 "still says has not yet run to its end" (the phrase appears in the prompt only inside round 47's verdict);<br>• the proxy header "says eight" (prompt line 16892 says "the five").<br>Its "Additional Findings" 1-7 then confirm V47-3 to V47-9 as present in this tree. A report whose R0 and every finding describe the older tree, presented as a verification, is the brief's "description of an older tree" (round 47 off-chain's LongCat line). Its program sections are generic and carry two errors (C15, C16). |
| minimax/minimax-m3 (re-run) | **Not counted.** 461,985 characters, `finish: length` at 128,000 output tokens, disqualified by the runner as "output cut off mid-report". The file begins `[reasoning only]` and is a reasoning trace throughout: 2,903 blank lines, 305 ```` ```rust ```` blocks of pasted source, and the same tentative conclusion restated at least six times ("No CRITICAL, HIGH, or MEDIUM findings", line 8770; "No CRITICAL or HIGH bugs found", 9123; and at 8926, 8970, 9419, 9451). It ends mid-sentence ("The page reads accounts by address (the reserve AT") with no report. It files no finding. Round 47's line for LongCat ("reasoning only, no report"). |
| minimax/minimax-m3 (first run, in `failed/`) | **Not counted.** 27,991 characters.<br>• It says V47-4 and V47-5 are still open: "`ceremony.mjs:237` … does not pass a `minUnits`", and `roles` "refuses added signers / writables, not removed ones". Both are false of the bundle (C18).<br>• It invents a program line: "`programs/cbob-vault-mint/src/lib.rs:607` … `require!(amount < ACTIVATION_SATS, MintError::BelowActivation)`". The source and the prompt have `amount >= ACTIVATION_SATS` (`mint/src/lib.rs:1440`; C17).<br>• It cites constructs that do not exist (`SEAL/src/lib.rs:civ_held_together`).<br>• It closes as a verdict ("Seven of eight counted (two re-runs on the same head)").<br>• It lists `sim/rehearsal-local.sh` among files it lacks, though the prompt carries it.<br>That is invented contents. |
| x-ai/grok-4.20 (re-run) | **Not counted, after weighing it against round 47's narrow Muse.** 19,619 characters, 4,874 output tokens. A real walk of R0-R8, and parts are right:<br>• its full MintConfig, BurnConfig, VaultRecord and SealConfig offset tables (I recomputed VaultRecord and BurnConfig from the structs; MintConfig matches round 47's recomputation);<br>• S8.0's 1,061 bytes plus 52 plus 96, giving 1,209;<br>• the stack-height check;<br>• arm names SR.5e, SR.12a, SR.13 and R41.C8a-c, which exist.<br>**But where the prompt's R1s asks what the helper does, it reports refusals and suite measurements that do not exist.** "Same source twice, destination twice, source==destination, native wSOL, delegate/close authority, frozen account, non-ATA destination, or destination wallet == asset-signer (or another vault's) are all refused" and "Odd/zero-pair list is refused", with "suite SR.6–12a … refuse each by named reason". In fact the helper accepts a non-ATA destination, a wSOL source (closed), another vault's wallet and a repeated destination; zero pairs is the lamports-only sweep its own (d) cites as SR.13 (`sweep/src/lib.rs:45-60`, `3prog.test.ts:3335`; C22).<br>**Other errors:**<br>• R1s(e): "the closed account passes because BURN checks `amount == 0` (not closure)". BURN skips it because it is System-owned, and a Token-2022 ATA for a classic mint is refused by the ATA program, not "by length/extension" (C23).<br>• It cites alarm detectors `pool_short` and `boost_terms_out_of_bounds`, which exist neither in the source nor in the prompt (C25).<br>• It attributes round 47's ignored-files disproof to `audit-coverage.sh` (it was `rehearsal-refresh.mjs:66`, C24).<br>A measurement it did not make, reported as made, about the target it was asked about, is invented contents (round 47's LongCat). Muse was counted narrowly because its errors were misreadings of real constructs; Grok's (b) list attributes behaviour to the code and to suite arms that neither has. |
| x-ai/grok-4.20 (first run, in `failed/`) | **Not counted.** 6,344 characters, 1,620 output tokens. Its body is round 47's own confirmed list, V47-1 to V47-9, restated nearly verbatim as this round's findings, with "Measured on a copy" and "Measured: limit 1 accepted". Those are round 47's measurements, not its own, and of the pre-repair tree. It closes with "Quorum met (7/8 counted, 6 required)" and "REQUIRES CHANGES: V47-1..9". Its "repairs hold … verified at all sites" contradicts its own findings and names no site. That is a summary of an older verdict, not an audit. |

**Quorum: 5 counted of 8, 6 required. NOT MET.**
- **Counted:** Opus 5.5, Ember, GLM 5.3 prime, Qwen max prime, and narrowly Sakana fugu-max.
- **Excluded:**
  - DeepSeek v4 pro: its re-run is a summary; its first run described the older tree.
  - MiniMax m3: its re-run is reasoning only and was cut off; its first run invented contents.
  - Grok 4.20: its re-run reports helper refusals and suite measurements that do not exist; its first run was round 47's verdict restated.
- **Re-runs:** three, each on the first run's head and prompt size; the failed first outputs are not counted.
- **What would decide it:** Grok's re-run is the nearest to counting, and the headline turns on it. Counted narrowly, as Sakana is, it would make six: a met quorum with no margin, resting on two narrow seats. I do not count it, for the reason in its row. A further same-prompt re-run, or a replacement model, is needed for a sixth real seat.

## Method and evidence

- **Records read:**
  - this brief (`.cache/TRIAGE-BRIEF-r48.md`);
  - all eight first-run reports, the three re-runs and all five programs manifests;
  - round 47's `VERDICT-programs.md`, `VERDICT-offchain.md` and `VALIDATION.md`;
  - round 38's W5 and round 33's A15 (the precedents for retryable `ClaimBeforeBurn` reverts);
  - SPEC ship gate 3 and 5 (`:2602-2675`), OPEN AND BLOCKING and item 22 (`:1892-1936`) and item 53 (`:2202-2240`);
  - README's "Reproducing the tests" (`:192-216`).
- **Source read at `d0e77e0`:**
  - `plan-redeem.mjs` (`planRedemption`, `prepareOpening`);
  - `redeem.mjs` (`:118-200`, the press);
  - MINT's `claim` (`:1675-1765`), `retire_redeemed` (`:1772-1796`), `retire` (`:1875-1910`), `join` (`:2021-2034`) and `distribute`'s gates (`:1601-1634`);
  - `bank/crank.mjs` (`:405`, `:504-517`);
  - `tx.mjs` (`:60-160`), `ceremony.mjs` (`:225-245`), `reads.mjs` (`vaultWalletAccounts`, `:90-155`), `plan-get.mjs:60-70`, `vault.mjs:97-104` and `decode.mjs` (plugins);
  - `scripts/validator-lock.sh` whole, and every `solana-test-validator` boot in the tree (`run-tests.sh:173`, `build-mainnet.sh:50`, `run-sim.sh:58`, `swap-fork.sh:36`, `e2e-localnet.sh:56`, `rehearsal-local.sh:42`, `validate-core-gate.sh:40`, `tests/expiry-budget.mjs:65`);
  - `run-tests.sh:48-67, 131-137, 419, 538`;
  - `bank/selftest.mjs:5200-5235` (the V47o-2 arms);
  - `scripts/readme-facts.mjs` (`:82-111`), `rpc-proxy.mjs` (`gpaShape`), `tests/3prog.test.ts:455-500` (R.4, R.4b) and `web/README.md:80-95, 275-285, 430-440`.
- **Allowed runs at `d0e77e0`** (logs in `/tmp/claude-1000/triage48p/`), all exit 0:
  - `node web/test/run-all.mjs`: **805/805** in 11 files.
  - `node bank/selftest.mjs`: **1081/1081**.
  - `node scripts/check-launch-params.mjs --selftest`: **69/69**.
  - `node bank/redemption-poster.mjs --selftest`: **24/24**.
  - `node bank/accrual.mjs --selftest`: **39/39**.
- **Canonical logs, read:**
  - `.cache/bba189a-suite.log`: RC 0, with web offline 805, detectors 1081, allocation 39, mainnet probe **35/35**, on-chain **913/913**, expiry budget 4/4 and swap fork 16/16.
  - `.cache/bba189a-web-e2e.log`: **152/152**, RC 0.
  - `.cache/bba189a-sim.log`: **71/71**, RC 0.
- **Measurements** (scratch only; nothing under `/opt` written but this file):
  - `readme-check.log`: `node scripts/readme-facts.mjs --check` at `d0e77e0` with `audits/round48/` untracked exits 0 ("README facts current"). V47-1's repair holds on the live tree; `:101` excludes `NONE` (V47-2).
  - `fd.log`: a bash holding `flock` on fd 9 (opened with `exec 9>>`, no close-on-exec) runs Node v20.20.2, the box's `node`. Node inherits fd 9. A child it `spawn`s with `stdio: ['ignore', log, log]` has only fds 0-2. With the bash SIGKILLed and the spawned child still alive, a fresh `flock -n` on the file succeeds.
  - `vl-nocache.log`: `validator-lock.sh` copied with its path rewritten to a directory without `.cache`. `validator_lock` fails "No such file or directory", rc 1. With the directory present it takes the lock.
- **Not run:** no validator, `scripts/run-tests.sh`, `web/test/e2e-localnet.sh`, sim, swap fork, `build-mainnet.sh`, the rehearsal driver, `rehearsal-local.sh`, `validate-core-gate.sh`, `bank/alarm.mjs`, crank, revenue job, Core watch, or any live, money or notification job. `dist/`, `.cache/core-watch/` and `.cache/VALIDATOR.flock` untouched.

## Distinct claims

Class column: (a) a finding in the five programs; (b) a value path, or a wrong credit; (c) a stopped or wrongly refused crack; (d) HIGH or MEDIUM anywhere. "None" means outside all four.

| ID | Reporters | Claimed | Verdict | Class | Evidence (file:line) |
|---|---|---|---|---|---|
| C1 | Opus F-1 (a waiting vault's opening carries no claim; join + credit in the approval window refuses it) | LOW, "adjacent to (c)" | **CONFIRMED, LOW (V48-1)**, source | none (see V48-1) | `plan-redeem.mjs:93` (`claim = record.active && !poolFrozen`), `:96`, `:196`; MINT `claim` joins a waiting vault (`mint/src/lib.rs:1695-1703`); `retire` refuses `ClaimBeforeBurn` when active and owed ≥ 1 sat (`:1882`); `redeem.mjs:154-198` (dry run, then the wallet, then send, no re-read); crank joins then distributes (`crank.mjs:405`, `:504-507`) |
| C2 | Opus F-3 (`sim/rehearsal-local.sh` takes no validator lock); **triage**: `scripts/validate-core-gate.sh` likewise | LOW | **CONFIRMED, LOW (V48-2)**, source | none | `rehearsal-local.sh:25-26, 33, 42-44` (start-time guards only, no `validator_lock`, no `9>&-`); `validate-core-gate.sh:31` (`kill_v` = `pkill -x solana-test-val` + `fuser -k`), `:40-50` (kills, then boots, no lock); `run-tests.sh:62-67, 131-132` ([4/7] kills every validator and frees 8999/9900); `validator-lock.sh:10-11` (six runners listed); `bank/selftest.mjs:5221` (the arm checks five) |
| C3 | Opus F-4(1); Ember V48-1 (`web/README.md` says 801 offline assertions) | INFO; LOW | **CONFIRMED, INFO (V48-3)** | none | `web/README.md:438` ("801 offline assertions in 11 files") against `run-tests.sh:419` (`WEB_FLOOR=805`) and the measured 805/805 |
| C4 | Opus F-4(2) (`web/README.md` says strays are listed by `getProgramAccounts`) | INFO | **CONFIRMED, INFO (V48-3)** | none | `web/README.md:87-90` against `reads.mjs:96-100, 126-131` (one `getTokenAccountsByOwner` per program, 8-byte slice; then empty 165-byte Token-2022 accounts skipped); V47-9's shape, unswept |
| C5 | Opus F-2 (the expiry-budget validator inherits the runner's lock) | LOW | **DISPROVED**, measured | none | `fd.log`: Node v20.20.2's `spawn` child holds only fds 0-2; an orphaned child does not hold the lease. `tests/expiry-budget.mjs:65` |
| C6 | Opus F-5 (the ceremony floor is the bare measurement, not plus Lighthouse) | INFO | **NOT A DEFECT** | none | `ceremony.mjs:237-241` documents the choice: the measured need, so Phantom's fixed 200,000 is not falsely refused (`pageUnits` would refuse it above about 163,600 measured CU). The judge's contract is "at least what the page measured" (`tx.mjs:72-73`), which holds. A limit in the gap fails at preflight and lands nothing, and it would fail under either floor; only the wording of the refusal differs. Phantom's 200,000 landed every step on mainnet (`RECORD.md`) |
| C7 | Opus limits Q4 (22.2 left OPEN AND BLOCKING by ruling, not measurement) | INFO | **NOT A DEFECT**: a ruling of Gary's recorded in SPEC | none | SPEC `:1928-1936` ("RULING, Gary 2026-10-10: 22.2 is accepted as passed"; item 22 stays OPEN for scale). 22.2 was measured: the FAIL is a recorded true detection, and the ruling reads that measurement. Opus's recommendation (one quiet production-mode pass after step 10) is noted |
| C8 | Sakana V48-1 (`validator_lock` fails on a clone with no `.cache`) | LOW | **NOT A DEFECT**; mechanism measured | none | `vl-nocache.log`. README's documented order runs `run-tests.sh` first (`README.md:211-216`), which creates `.cache` (`run-tests.sh:55`). Every other runner needs that run's cached Core anyway (`run-sim.sh:37-38`, `e2e-localnet.sh:39`, `build-mainnet.sh:36-37`) and refused before the lock existed; it fails closed, now with a shell error instead of the named one. Recommendation: `mkdir -p` in `validator_lock` |
| C9 | Sakana V48-2; GLM F48-1 (C26 part) (`planClaim`'s `?.body.frozen`) | INFO/LOW | **ALREADY SETTLED**: round 47 C26, round 42 C7 | none | `plan-get.mjs:66`. Unreachable because Core wrote the bytes, and nothing is signed. A gate-5 obligation (below) |
| C10 | GLM F48-1 (round 47's gate-5 arms for C11, C16, C26 were not done) | LOW | Facts **TRUE** (read); **ALREADY-STATED** as round 47's gate-5 obligations ("requirements, not findings"), so not a new defect | none | `plan-get.mjs:66` unchanged; `tx.mjs:130-136` (a second limit or price overwrites the first); `scripts/rehearsal-refresh.mjs` has no selftest; `VALIDATION.md` lists only V47/V47o arms. Carried into this verdict's gate-5 list |
| C11 | GLM (the vault page's "Sealed" row says "No seal found" on a null body) | (in F48-1) | **NOT A DEFECT** | none | `vault.mjs:104`; display only, nothing signed, and the same unreachable null-body shape as C9 |
| C12 | Qwen (`tx.mjs` is not in its bundle) | (scope) | **DISPROVED** | none | Prompt header at line 19778 (`=== web/src/lib/tx.mjs`) |
| C13 | Qwen, GLM, Ember, Sakana (`readme-facts.mjs` not in the programs bundle) | (scope) | **TRUE**; the repairs are measured here instead | none | No `=== scripts/readme-facts.mjs` header in the programs prompt; `readme-check.log` rc 0 with `audits/round48/` untracked; `readme-facts.mjs:101` |
| C14 | DeepSeek R0 and Additional Findings 1-7; Grok (V47-1..V47-9 restated as present). Both first runs, now in `failed/` | LOW/INFO | **DISPROVED** | none | Repaired text at prompt lines 8468, 16892, 20403, 26324; `ceremony.mjs:241`; `tx.mjs:128-129`; `README.md:101-103`; `rpc-proxy.mjs` header; `readme-check.log` |
| C15 | DeepSeek (first run) R1s(a) (the owner can run the helper while the vault is sealed) | "LOW, informational" | **DISPROVED** | none | Core refuses Execute on a frozen PermanentFreezeExecute vault (suite 3.7, pinned to Core 0x9, as GLM and Ember state); the helper is reached only inside a redemption |
| C16 | DeepSeek (first run) R1s(b) (a source can also be the destination) | (none) | **DISPROVED** | none | `sweep/src/lib.rs`: the source must be owned by the signer, the destination by `dest`, and `signer != dest` |
| C17 | MiniMax (first run) (`activate` requires `amount < ACTIVATION_SATS`) | (observation) | **DISPROVED** | none | `mint/src/lib.rs:1440` (`amount >= ACTIVATION_SATS`); prompt line 3669 |
| C18 | MiniMax (first run) (V47-4 and V47-5 still open) | LOW ×2 | **DISPROVED** | none | `ceremony.mjs:241`; `tx.mjs:128-129` |
| C19 | Opus, Ember, GLM, Qwen, Sakana (round 47's disproofs re-tested: Muse's Token-2022 ATA HIGH, MiMo's two MEDIUMs, the ignored-files claim) | (agree) | **ALREADY SETTLED** | none | Re-read at `d0e77e0`: SEAL `assert_classic_spl`; `tx.mjs:72-74, 137`; `rehearsal-refresh.mjs` `ls-files --others` without exclude. Programs unchanged since `d2ae5fc` |
| C20 | Ember, Qwen, GLM, Opus (item 53 needs the in-tree run at the final commit; item 22 scale; item 50 real Phantom) | (limits Q4 / closing) | **ALREADY-STATED** | none | SPEC `:2231-2234` (last in-tree run `e7c192a`); `:1936`; item 50 |
| C22 | Grok re-run R1s(b) (the helper refuses a repeated destination, a wSOL source, a delegated source, a non-ATA destination, another vault's wallet and a zero-pair list, "suite SR.6–12a … refuse each") | (no finding; a reassurance) | **DISPROVED** | none | `sweep/src/lib.rs:50-80`: a pair is refused only for a source not owned by the signer, a destination not owned by `dest` or of another mint, or a non-token or non-165-byte account; the transfer and close revert a frozen source or a kept close authority. Zero pairs is the lamports-only sweep (`3prog.test.ts:3335`, SR.13). Wrong in the reassuring direction, so it creates no finding |
| C23 | Grok re-run R1s(e) (a closed account passes BURN "because BURN checks `amount == 0` (not closure)"; a Token-2022 ATA for a classic mint "refused by length/extension") | (none) | **DISPROVED** | none | A closed account is System-owned and BURN's reserve loop skips it (as Ember, GLM and Qwen state). The ATA program refuses to create that account (`IncorrectProgramId`, round 47 C10) |
| C24 | Grok re-run R0 (round 47's ignored-files disproof rests on `audit-coverage.sh`) | (none) | **DISPROVED** attribution | none | The disproof was of `rehearsal-refresh.mjs:66` (round 47 C11) |
| C25 | Grok re-run (alarm detectors `pool_short` and `boost_terms_out_of_bounds`) | (none) | **DISPROVED**: neither exists | none | `grep` over `bank/`, `programs/` and the prompt: zero hits for both; its other cited detector names exist |
| C26 | DeepSeek re-run (item 22.2 "remains open") | (closing) | **DISPROVED** | none | SPEC `:1932-1936` (22.2 accepted by Gary's ruling; item 22 stays OPEN only for scale) |
| C27 | DeepSeek re-run R8 ("the arms that cannot fail are … the control arms") | (none) | **DISPROVED** | none | R.4b is a control that must read `Royalties\|1` and fails otherwise (`3prog.test.ts:498`) |
| C28 | MiniMax re-run | (none filed) | No claim to triage: a reasoning trace that never reaches a report | none | The file begins `[reasoning only]` and ends mid-sentence |
| C21 | Every seat's "before launch" list (clean-machine reproduction, bounty, fuzzing, real wallets, custody proofs, a Core-change runbook, PoB-set confirmation) | (recommendations) | **NOT FINDINGS** | none | Recommendations to Gary, recorded for him; none is a defect in the tree |

## Confirmed findings

**V48-1: LOW.** Reporter: Opus 5.5 F-1. Source.

**An opening of a vault that is waiting to join carries no `claim`, so a join and a credit landing during the holder's approval make MINT refuse it.**
- **The mechanism:**
  - `planRedemption` adds `claim` only when `record.active && !poolFrozen` (`plan-redeem.mjs:93`, `:196`) and tells the holder of a waiting vault that "it is owed nothing. Opening it simply takes it out of the queue" (`:96`).
  - The page dry-runs, then hands the transaction to the wallet, then sends it, with no re-read after approval (`redeem.mjs:154-198`).
  - If, in that interval, a `claim` naming the vault joins it (`mint/src/lib.rs:1695-1703`, anyone may) and a distribution then credits it at least one sat, the vault is active and owed ≥ 1 sat at execution. `retire` then refuses `ClaimBeforeBurn` (`:1882`).
  - The crank's own order is joins, then the distribution (`crank.mjs:405`, `:504-507`), and a holder can force a distribution by burning 100 $GARY.
- **Why it does not stop a crack (class none):**
  - Preflight is on, so nothing lands and nothing moves.
  - After the join the vault is active, so the next press re-plans with the claim (`prepareOpening`) and opens. A vault joins once, so this happens at most once per vault.
  - Nobody can see the holder's unsent transaction to aim at its window, so a deliberate griefer can only hope to hit it.
  - Rounds 38 (W5) and 33 (A15) classed retryable `ClaimBeforeBurn` reverts the same way.
- **Why I confirm it, unlike round 38's W5:**
  - W5 could be caused only by Coinbase and had no page-side fix.
  - Here ordinary crank traffic causes it, and the page can close the window for free. MINT's `claim` joins a waiting vault and owes it nothing, or delivers what it was credited, and the claim's accounts are already in the opening.
  - The page's own sentence to the holder then becomes untrue.
- **Repair:** include `claim` whenever the record is pending or active and the pool is not frozen. Add one e2e arm: plan a waiting vault's opening; land `claim([vault])` and a distribution; send the planned opening; it must open, and show red on today's planner (`ClaimBeforeBurn`).

**V48-2: LOW.** Reporters: Opus 5.5 F-3 (`rehearsal-local.sh`); this triage (`validate-core-gate.sh`). Source.

**Round 47's one-validator lock (V47o-2) did not reach two validator runners.** The repair's claim is "a kernel flock every runner takes before its exit trap" (commit `bba189a`). `validator-lock.sh:10-11` lists six runners and the selftest arm checks five (`bank/selftest.mjs:5221`).
- **`sim/rehearsal-local.sh`** boots a validator on 8999 for an hours-long local dress rehearsal with only start-time guards (`:25-26`): `pgrep` of three runners, and ports. It never takes the lock, and it boots without `9>&-` (`:42-44`). A `run-tests.sh` started after it takes the free lock, and its `[4/7]` cleanup kills every `solana-test-val` and frees 8999/9900 (`run-tests.sh:62-67, 131-132`), destroying the rehearsal's ledger mid-run. `run-sim.sh`'s `pgrep` guard does not see it either.
- **`scripts/validate-core-gate.sh`** (bundled in this pass) takes no lock. Each arm begins with `kill_v` (`:31`, `:49-50`), so run by hand beside any certifying run it kills that run's validator at once. This is the exact failure V47o-2 was written to remove.

Both fail closed (a refused or broken run, never a false pass). Both are local, and no value moves. **LOW:** V47o-2's own shape and grade, at sites its repair did not reach. **Class: none.** Tooling. **Repair:** source `validator-lock.sh` and call `validator_lock` before each script's trap; boot with `9>&-`; add both to the header list and to the selftest's `runners` (and make the arm enumerate every file that boots `solana-test-validator`, so a future runner cannot be missed).

**V48-3: INFO.** Reporters: Opus 5.5 F-4 (both halves), Ember V48-1 (the count).

**`web/README.md` carries two stale facts.**
1. **The count.** `:438` says `run-all.mjs` runs "801 offline assertions in 11 files". The floor is 805 (`run-tests.sh:419`), the root README says 805, and the run prints 805/805. Round 47's repair moved the floor and not this sentence.
2. **The stray listing.** `:87-90` says the page lists the vault wallet's other token accounts with "`getProgramAccounts` with an owner filter: an 8-byte balance slice for classic and 165-byte Token-2022 accounts, a 0-byte slice for every Token-2022 address". Since round 46 it is one `getTokenAccountsByOwner` per program with an 8-byte slice, then empty plain 165-byte Token-2022 accounts are skipped (`reads.mjs:96-100, 126-131`). V47-9 fixed the same staleness in the proxy's header; this paragraph was not swept. The same file's proxy section (`:280`) is already right.

Neither misstates a holder's money, rights or what the programs do, and SPEC gate 3's drift sweep names `web/README.md`. **Class: none.** Docs. **Repair:** update both sentences; consider generating the web count, as `readme-facts.mjs` does for the root README.

### The documentation exception (SPEC gate 3, ruling of 2026-10-07)

- V48-1 and V48-2 change code. **Not eligible.**
- V48-3 is text that misstates nothing about holders' money and could qualify, but it is still a change.

So this pass cannot be a no-change round, independently of quorum.

## Rounds 43 to 47 re-check, per confirmed finding

I re-read each verdict's mechanism against `d0e77e0`. The five programs are byte-identical in source to the release every round judged (`d2ae5fc`, `0b3ddb3`), so no finding can have moved into the programs.

| Finding | Severity | (a) programs | (b) value | (c) crack | (d) H/M | Outside (a)-(d)? |
|---|---|---|---|---|---|---|
| R43 **V43-1** a host's owner keeps a nested vault by Executing it out | LOW | No defect against the ruled design (limit 58) | No (the owner's own vault wallet) | No | No | **Yes** |
| R43 **V43-2** e2e header described the old rescue rule | INFO | No | No | No | No | **Yes** |
| R43o **V43o-1** release check died in the rehearsal tree | LOW | No | No | No | No | **Yes** |
| R43o **V43o-2** one unreadable signature froze a scan | LOW | No (`alarm.mjs`) | No (detection) | No | No | **Yes** |
| R43o **V43o-3** reveal-skip arm could not fail | LOW | No | No | No | No | **Yes** |
| R44 **V44-1** to **V44-7** (rehearsal value file, `release_gate`, coverage credit, legend, limit 59 rent, "the one exception", absent collection label) | LOW ×3, INFO ×4 | No | No | No | No | **Yes** |
| R44o **V44o-1** to **V44o-5** (poster skip, split-recovery scan, null SEAL baselines, no-network exit, runbook) | LOW ×3, INFO ×2 | No | No (the revenue job stops; balances stay) | No | No | **Yes** |
| R45 **V45-1** to **V45-11** (driver predicates, keys, rescue, cycle order, text) | LOW ×5, INFO ×6 | No (driver, docs) | No (throwaway keys only) | No | No | **Yes** |
| R45o **V45o-1** to **V45o-7** (null SEAL reserve mints, forced-failure switches, text, coverage selftest, prompt) | LOW ×2, INFO ×5 | No | No (V45o-2: the capped sweep to the Bank's own operator key, limit 10) | No | No | **Yes** |
| R46 **V46-1** to **V46-8** (resumable steps, charter clock, rescue cycle, hand recovery, overrides, null mint, SPEC 53, seed-7 init key) | LOW ×4, INFO ×4 | No | No | No | No | **Yes** |
| R46o **V46o-1** to **V46o-5** (ack arm, unreadable counts, load-time notice, placeholder fixture, bundle claims) | LOW, INFO ×4 | No | No | No | No | **Yes** |
| R47 **V47-1** README facts counted untracked rounds | LOW | No | No | No | No | **Yes**. Holds: `readme-facts.mjs:111` (`git ls-files`); `--check` rc 0 with round 48 untracked |
| R47 **V47-2** NONE rendered as owing repairs | LOW | No | No | No | No | **Yes**. Holds: `readme-facts.mjs:101` |
| R47 **V47-3** R.4 blind to seven plugin kinds | LOW | No (a test) | No | No | No | **Yes**. Holds: `3prog.test.ts:460-498` (raw registry, R.4b control); 913/913 at `bba189a`. No other arm lists plugins by key regex |
| R47 **V47-4** ceremony gave the judge no floor | LOW | No (page) | No | No | No | **Yes**. Holds: `ceremony.mjs:241`; every other `signExact` call passes `minUnits` (grep: none without) |
| R47 **V47-5** judge passed a removed writable or signer | LOW | No (page) | No | No | No | **Yes**. Holds: `tx.mjs:128-129` |
| R47 **V47-6** README said SEAL holds, BURN pays out | INFO | No | No | No | No | **Yes**. Holds: `README.md:101-103` |
| R47 **V47-7** road row 8 omitted 22.2 | INFO | No | No | No | No | **Yes**. Holds: `README.md:161` (and Gary's ruling since) |
| R47 **V47-8** SPEC 53 stale sentence | INFO | No | No | No | No | **Yes**. Holds: SPEC `:2232-2234` |
| R47 **V47-9** proxy header said eight shapes | INFO | No | No | No | No | **Yes**. Holds at the header (`rpc-proxy.mjs`, "the five"); **not swept** to `web/README.md:87-90` (V48-3) |
| R47o **V47o-1** Core watch never reported a PASS | LOW | No (`core-watch*`) | No | No | No | **Yes**. Off-chain file; per `VALIDATION.md` and detectors 1081 |
| R47o **V47o-2** private validator lock | LOW | No (tooling) | No | No | No | **Yes**. Holds at five runners; **not at** `rehearsal-local.sh` or `validate-core-gate.sh` (V48-2) |
| R47o **V47o-3** SPEC and README did not state the rehearsal's result | LOW | No | No | No | No | **Yes**. Holds: SPEC `:1928-1936`, README `:161` |
| R47o **V47o-4**, **V47o-5** (= V47-1, V47-2 off-chain) | INFO ×2 | No | No | No | No | **Yes**. Hold (above) |
| R47o **V47o-6** Core watch installed by hand | INFO | No | No | No | No | **Yes** (off-chain; not re-measured here) |
| R47o **V47o-7** a second Core change dropped the first result | INFO | No | No | No | No | **Yes** (off-chain; not re-measured here) |
| R47o **V47o-8** mock RPC did not model the stray listing | INFO | No (test) | No | No | No | **Yes**. Web offline 805/805 |
| R47o **V47o-9** clean clone could not follow the README | INFO | No | No | No | No | **Yes**. Holds: `run-tests.sh:426`, `README.md:207-216` |

**All are outside (a)-(d).** None is in the five programs; none moves or miscredits value; none stops a crack; none is HIGH or MEDIUM. Round 47's repairs hold at their own sites. Two did not reach every site of their shape (V47o-2, V47-9), and the floor change left one stale count (V48-2, V48-3).

## Gate-5 obligations

SPEC ship gate 5: every confirmed defect's repair becomes a suite or selftest assertion, and so does every rejected finding that could be measured. These are requirements, not findings.

1. **V48-1:** the e2e arm above (waiting vault, join + credit after planning, the planned opening must open), red on today's planner.
2. **V48-2:** the selftest's runner list derived from every file that boots `solana-test-validator`, each taking `validator_lock` before its trap and booting with `9>&-`, red with `rehearsal-local.sh` and `validate-core-gate.sh` as they are.
3. **V48-3:** text; optionally a generated web count checked by `--check`.
4. **Measurable rejections:**
   - **C5:** an arm proving that a validator spawned from Node under the runner's lock does not hold it. It passes today (`fd.log`), which is the point: it pins the Node behaviour the lock relies on.
   - **C6:** a `ceremony.test.mjs` arm pinning the chosen floor, so that Phantom's 200,000 is accepted at a measured 190,000 and a limit below the measured need is refused.
   - **C8:** an arm that `validator_lock` creates its directory or names it.
   - **C17:** already pinned (P.4, an activation at exactly 21,000 sats requests).
   - **C22, C23:** already pinned (SR.13, the zero-pair sweep; SR.4, a closed reserve account passing BURN; SR.12a/b, the duplicate-source refusal reason).
5. **Carried from round 47, verified NOT yet done (C10):**
   - C26: `?.body?.frozen` in `planClaim` with a null-body arm.
   - C16: the judge refusing a second compute limit or price.
   - C11: a `rehearsal-refresh` selftest arm with an ignored fixture.
   - Also carried: round 46's C9 build-order arm and earlier carried recommendations, not re-measured here.
6. **Item 53 and item 22:** the full suite inside a rehearsal tree at the final commit (last proven `e7c192a`), and item 22's ~2,100-vault scale.

## Measurements

| Measurement | Result | Evidence |
|---|---|---|
| Allowed selftests at `d0e77e0` | web 805/805; detectors 1081/1081; launch 69/69; poster 24/24; allocation 39/39; all exit 0 | `/tmp/claude-1000/triage48p/{web,det,launch,poster,accrual}.log` |
| Program source against the release | equal to `d2ae5fc` | `git diff --quiet` |
| `bba189a` to `d0e77e0` | README, SPEC, FREEZE, VALIDATION, `audit48.ts` only | `git diff --stat` |
| `dist/` | five files OK against `SHA256SUMS`, equal to `config.js:51-55` | `sha256sum -c` |
| `bba189a` canonical runs | suite RC 0 (probe 35/35, on-chain 913/913, expiry 4/4, fork 16/16); e2e 152/152; sim 71/71 | `.cache/bba189a-*.log` |
| Prompt | 1,951,157 characters, equal to the manifest | `/tmp/v48tri-prompt-programs.txt` |
| README facts check, round 48 untracked | rc 0 | `readme-check.log` |
| fd 9 through Node `spawn` | not inherited by the child; an orphan does not hold the lease | `fd.log` |
| `validator_lock` without `.cache` | fails closed, rc 1, "No such file or directory" | `vl-nocache.log` |
| Re-run manifests | head `d0e77e0`, `dirty: []`, `promptChars` 1,951,157 on all three, equal to the first run; report sizes equal their manifests | `MANIFEST-programs.rerun-*.json`, `wc -m` |
| Grok re-run's detector names | `pool_short`, `boost_terms_out_of_bounds`: 0 hits in `bank/`, `programs/` and the prompt; the others exist | `grep` |
| VaultRecord and BurnConfig layouts | VaultRecord: `pending` 177, `request_epoch` 178, `carry_scaled` 195, padding 10 to 221. BurnConfig: `rate_head` 58, `rate_ring` 59 (512 bytes). Recomputed from the structs | `mint/src/lib.rs:2478-2512, 2552`; `burn/src/lib.rs:463-486` |

## Measurement limits

- **No validator was run.** V48-1 is established from source:
  - the planner's condition;
  - MINT's `claim`, `join` and `retire`;
  - the press's order;
  - the crank's order.
  
  It was not reproduced on a chain, and I have not observed the race land. That the refused opening lands nothing rests on `sendSigned` sending with preflight on, which is reasoned, as round 47 also stated.
- V48-2 is established from the scripts. I did not start `rehearsal-local.sh` or `validate-core-gate.sh` beside a runner.
- C5 was measured with `sleep` standing in for `solana-test-validator`, on this box's Node v20.20.2. A different Node or libuv could behave differently.
- Off-chain files (`readme-facts.mjs`, `core-watch*`, `cron-install.sh`, `mock-rpc.mjs`, `bank/*`) were read only where a programs-pass claim turned on them. Their audit is the off-chain pass's, which I did not read.
- **Unmeasured here, as rounds 36 to 47 also stated:** a real Phantom on the widest openings and on a page-budgeted opening, a real Squads v4 return, the live proxy behind Cloudflare, DAS on mainnet, the crank at ~2,100 vaults, and whether a holder understands any page sentence.

## Remaining requirements

- **This pass:** at least one more real seat on the same head and prompt, then a fresh triage. The re-runs of DeepSeek, MiniMax and Grok did not supply one. Options are a second re-run of those seats or a replacement model. Without six counted seats this pass cannot be launch-clean.
- **Repairs:** V48-1 to V48-3 and their arms. Round 48 therefore cannot be the no-change round Gary asked for (2026-10-09).
- **Unchanged:**
  - Items 22 (scale), 38, 50, 52 and 53 remain OPEN AND BLOCKING.
  - `charter_opens_at`, `lock_deadline` and `vault_collection` remain OPEN in `launch/mainnet-init.json`.
  - No deployment, initialization, lock, ceremony, cron installation, rehearsal or publication follows from this audit.

**Result:** QUORUM NOT MET (5 counted of 8; six required; three re-runs on the first run's head and prompt, none counted).

NOT LAUNCH-CLEAN, for quorum alone. On its confirmed findings: 0 CRITICAL, 0 HIGH, 0 MEDIUM; nothing in the five programs, no value path, no refused crack.

REQUIRES CHANGES: V48-1, V48-2, V48-3. This is not a no-change round.

---

**Reply (under 300 words).** Round 48 programs pass: **NOT LAUNCH-CLEAN; QUORUM NOT MET. REQUIRES CHANGES: V48-1, V48-2, V48-3.**

**Counted, 5 of 8 (6 needed):** Opus 5.5, Ember, GLM 5.3 prime, Qwen max prime (errs that `tx.mjs` was not bundled), and narrowly Sakana. **Not counted**, re-runs included (same head, same 1,951,157-character prompt; first runs in `failed/`):
- DeepSeek: the re-run is a "Verified/None" summary with no file, line or figure; the first run described the pre-repair tree.
- MiniMax: the re-run is reasoning only, cut off at 128,000 tokens with no report; the first run invented `amount < ACTIVATION_SATS`.
- Grok: the re-run says the sweep helper and suite refuse shapes the helper accepts and cites two nonexistent detectors; the first run restated round 47's verdict.

Programs equal release `d2ae5fc`. Selftests green: 805, 1081, 69, 24, 39. `bba189a` canonical runs: 913, 152, 71, probe 35, fork 16.

**Confirmed, all outside (a)-(d), none in the programs:**
- **V48-1, LOW (Opus):** a waiting vault's opening carries no `claim`. A join plus a credit during Phantom approval makes MINT refuse it (`ClaimBeforeBurn`). Nothing lands, and the re-press opens it, at most once per vault, so it is not class (c). Fix: claim when pending.
- **V48-2, LOW (Opus + triage):** the V47o-2 validator lock never reached `sim/rehearsal-local.sh` or `scripts/validate-core-gate.sh`; either can kill or be killed by a certifying run.
- **V48-3, INFO (Opus, Ember):** `web/README.md` says 801 offline assertions (floor 805) and describes the pre-round-46 `getProgramAccounts` stray listing.

**Disproved or not defects:** Opus's fd-inheritance claim (measured), the ceremony-floor and 22.2 notes, Sakana's missing-`.cache` lock, and `?.body.frozen` (settled). GLM's undone round-47 gate-5 arms are true and carried as obligations.

Rounds 43-47: every confirmed finding is outside (a)-(d). The re-runs add no confirmed finding. Action: obtain a sixth real seat, then re-triage.
