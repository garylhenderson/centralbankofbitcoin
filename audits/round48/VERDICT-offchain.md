# Round 48, OFF-CHAIN pass: LAUNCH-CLEAN; QUORUM MET
REQUIRES CHANGES: V48o-1, V48o-2, V48o-3, V48o-4, V48o-5, V48o-6, V48o-7

**Independent triage verdict against audited head `d0e77e013bee9dc83e895d44419cb39f7e09c5e6` (`d0e77e0`), which is HEAD.** `git status --porcelain` showed only `?? audits/round48/` before and after every command in this triage, and nothing was written to the repository except this file. `git diff --stat bba189a d0e77e0` names exactly `README.md` (2 lines), `SPEC.md` (9 lines), `audits/FREEZE.md`, `audits/round47/VALIDATION.md` and `scripts/audit48.ts`: the head is round 47's validated repairs (`bba189a`) plus Gary's 22.2 ruling, the road row that records it, round 47's records and the round-48 driver. `git diff --name-only d2ae5fc d0e77e0 -- programs bank sim tests launch scripts/run-tests.sh` names `bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/run-sim.sh`, `sim/swap-fork.sh` and `tests/3prog.test.ts` (round 47's repairs) and nothing under `programs/`. I did not open `audits/round48/VERDICT-programs.md`, `dist/` or `.cache/core-watch/`.

**Six of the eight seats are counted against a required six. Quorum is met with no margin.** Two seats are excluded: Grok's report is round 47's own verdict reply, copied, and MiniMax's re-run invents the code its three findings rest on (reasons below).

**Seven findings are confirmed: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 4 LOW, 3 INFO.** Every one is in the fixable layer: the Core watch and its diagnostic runner, a test runner that skips the shared validator lock, the alarm's token-account detector, the shared transaction reader and the cron installer. None is in the five programs. None moves value out of a vault, the pool or the revenue address, or credits value wrongly. None stops or wrongly refuses a crack, and none is HIGH or MEDIUM. Under SPEC ship gate 3's launch gate (RULING, Gary 2026-10-08), the pass is **LAUNCH-CLEAN**.

**It is not the no-change round Gary asked for (RULING 2026-10-09).** Each of the seven needs a change to a script, a test, `bank/` or the installer. None is an accepted limit already stated in SPEC, and none is covered by a ruling of Gary's.

**The pattern is round 47's own repairs.** Four of the seven are residues of round 47's off-chain repairs:
- V48o-1: a diagnostic killed by SIGKILL, OOM or a reboot never reports and cannot be restarted. This is V47o-1's class (a monitor that cannot deliver its result) through a different exit, and the stale `running-$H` marker that round 47's V47o-2 (iii) named.
- V48o-2: the arms that pin V47o-1, V47o-7 and C19 live in a selftest no gate runs, with no floor.
- V48o-4: one runner on the tree kills validators without V47o-2's lease.
- V48o-7: V47o-6's flocked Core-watch line, installed on this box, runs beside the unflocked hand-added line it was meant to replace.

V48o-3 (Ember) is older code: the alarm pages CRITICAL, with false text, on any token account created for a burnt vault's address. V48o-5 and V48o-6 are small reporting defects.

**Disproved by measurement:**
- Opus's LOW that the new cron `flock` would be inherited by the multi-hour diagnostic (Node closes the lock fd in its spawned child; measured, with a bash control that does inherit it).
- GLM's LOW that the README road row is cut mid-number (the generator cuts at `". "`, not `"."`; `--check` is current).
- All four of MiniMax's claims.

**29 deduplicated claim groups:**
- 7 confirmed (4 LOW, 3 INFO; one filed by this triage);
- 3 already stated (C12, C20, C27);
- 1 agreement with round 47 (C26);
- 1 group of withdrawn non-claims (C28);
- the rest disproved or not a defect.

## Quorum and the integrity of what was audited

**Manifests.** `MANIFEST-offchain.first-run.json` (byte-identical to `MANIFEST-offchain.json`) records head `d0e77e0…`, `dirty: []`, `promptChars` 1,958,826, requested 8, auditors 7, required 6.
- **One seat was disqualified by the runner:** `minimax/minimax-m3`, "report is 533 chars — too short to be one" (`finish: stop`, 133 output tokens). The failed file in `failed/` is 533 bytes: a preamble about round 47 that ends before any audit. It is not counted.
- **The re-run.** `MANIFEST-offchain.rerun-minimax_minimax-m3.json` records the **same head** `d0e77e0…`, `dirty: []` and the **same `promptChars` 1,958,826**, `ok: true`, `finish: stop`, 13,699 chars, `disqualified: null`.
- **The prompt.** `RENDER_ONLY=1 FOCUS=offchain TAG=v48tro npx tsx scripts/audit48.ts` reproduces it at exactly 1,958,826 characters ("no unresolved placeholders", "the ACCEPTED LIMITS section reached the artifact, all three states present").
- **The reports on disk** equal the manifests' character counts exactly (`wc -m`): Opus 18,509; DeepSeek 34,225; Ember 27,341; Qwen 18,368; GLM 26,565; Fugu 29,741; Grok 3,522; MiniMax (re-run) 13,699.

The runner counted all eight as audits. My count follows.

| Auditor | Disposition |
|---|---|
| anthropic/claude-opus-5.5 | **Counted.** 18,509 chars. The sharpest seat on the new code.<br>• R0 checks each round-47 repair at its construct: `node -e … process.argv.slice(1)`, the `9>&-` boots, inherited fd 9 sharing one open file description.<br>• N1 traces `noclobber running-$H` and the pre-trap `waiting` write into `decide()`'s `if (!suite)` branch. Measured true (V48o-1).<br>• N5 is V48o-5 and N6 is V48o-7.<br>• N2 is a precise, falsifiable mechanism claim, which it says how to refute. Measured false (C08).<br>• N3 and N4 are accurate mechanisms that are not defects (C09, C10).<br>• R1 walks every crank instruction's account list against MINT's structs. R5 re-derives the swap bounds. |
| fireworks/ember-1 | **Counted.** 27,341 chars. Quotes the alarm's asymmetric `[...vaults, ...burnt]` / `vaults` loops exactly (`alarm.mjs:538-546`) and the detector's text. Its LOW is measured true (V48o-3).<br>• It re-derives the Pyth offsets, the Orca/Meteora orientations and the 280,355 / 276,149 hand-pinned floor.<br>• It checks `readme-facts.mjs`'s `short()` against row 8 and gets it right, the cut falling after "scale not exercised".<br>• Its R0 table names each repair's arm. |
| sakana/fugu-max | **Counted.** 29,741 chars.<br>• F1 is V48o-2. Its `grep` evidence is exact: no runner invokes `core-watch.mjs --selftest`, and the selftest ends `process.exit(bad ? 1 : 0)` with no floor. Its second half, the `queued` wedge, is part of V48o-1.<br>• F2 and F3 are accurate mechanisms that are not defects (C14, C15).<br>• It walks every vacuous-when-empty arm by name, finds the 16 × 6,960 reveal-rent constant (safe direction) and states what it could not read. |
| z-ai/glm-5.3-prime | **Counted.** 26,565 chars.<br>• F2 is V48o-2, citing the certifying log's missing line (true: `grep -c core-watch .cache/bba189a-suite.log` = 0).<br>• F3 is V48o-6, measured.<br>• F4 is ALREADY STATED (C12) and F5 is latent (C13).<br>• F1 misreads the generator's regex as `/:|\./`. It is `/:|\. /` (`readme-facts.mjs:126`). That is a real error in a counted seat (C11). Its other constructs check out: the `isSystemDust` contrast at the ProgramData loop and the V44o-5 site-count arm. |
| deepseek/deepseek-v4-pro-0813 | **Counted.** 34,225 chars. Weaker, but it engages this tree:<br>• `BENIGN` quoted verbatim (`crank.mjs:110`);<br>• `parseRustStruct`'s regex verbatim (`layout.mjs:235`);<br>• `build-mainnet.sh`'s two `cmp -s` lines and its die text (`:149,156-157`);<br>• the `1 sat over weight 3` arm (`accrual.mjs:125`);<br>• the accepted-limit numbers 6, 7, 10, 25-28, 32, 40, 46-48, 55-59, which match SPEC.<br>Most of its "findings" withdraw themselves ("Fix: none needed"). The five that stand are judged at C16-C20. One quote is paraphrased (`detectUnsweptRoyalties`'s text, `detectors.mjs:2224`). |
| qwen/qwen3.8-max-prime | **Counted, with its errors stated.** 18,368 chars.<br>**Engages this tree:** its R0 quotes constructs that exist only at this tree, each verified:<br>• `validator_lock <label> \|\| exit 1` in all five runners;<br>• the `readlink -f /proc/self/fd/9` re-entry check;<br>• `[ -s "$ROOT/dist/SHA256SUMS" ] \|\| die "dist/ is absent: …"` (`run-tests.sh:426`);<br>• the `getTokenAccountsByOwner` case in `mock-rpc.mjs:136`;<br>• `(?!NONE\b)`.<br>**Peripheral errors:**<br>• Its header claims `bank/`, `sim/`, `tests/` and `run-tests.sh` "equal `d2ae5fc`", presented as a measurement it cannot have made. Five of those files changed in `bba189a`; the sentence is round 47's header carried over.<br>• It labels round 43's gate-5 item 5 "the `meteoraSpot` inversion" (it is `!!bm`).<br>• It puts the swap's worst case at 100 bps where the floor is 150.<br>It files no finding, so nothing rests on these errors. |
| x-ai/grok-4.20 | **Not counted.** 3,522 chars. Its first 28 lines are round 47's off-chain verdict reply, word for word: "Round 47, off-chain pass … REQUIRES CHANGES: V47o-1 to V47o-9", round 47's seat list, and "Selftests: 1072, 801, … core-watch 18". At this head those are 1081, 805 and 25. It then calls round 47's gate-5 obligations "all discharged" and adds three generic recommendations. It makes no claim about this tree's code. |
| minimax/minimax-m3 (re-run) | **Not counted.** 13,699 chars. **Invented contents**, at every finding:<br>• **V48-1:** it quotes a `correlateBurns` clause `f.signer && viaProgram.has(f.signer)` that does not exist (`grep -n "f.signer" bank/detectors.mjs`: none). It asserts `node bank/selftest.mjs` "exits non-zero with two XX lines": measured **1081/1081, exit 0**.<br>• **V48-2:** it quotes `joinedNow = r.pending && !r.active`. The line is `const joinedNow = preJoined.has(r.address)` (`crank.mjs:550`).<br>• **V48-3:** it quotes a `closeAccount` with three `pubkey:` keys in one object literal. `swap.mjs:267-269` builds three separate AccountMetas.<br>• **"TDZ":** it says `FLOOR` is used before its declaration. `const FLOOR = 1081` is `selftest.mjs:5249`, and the check is `:5255`.<br>Its claims are still triaged (C21-C24). |

## Distinct claims and dispositions

Class column: (a) a finding in the five programs; (b) a path that moves value out of a vault, the pool or the revenue address, or credits value wrongly; (c) a stopped or wrongly refused crack; (d) HIGH or MEDIUM anywhere. "none" means outside all four. As in rounds 40-47, a claim whose mechanism is accurate but which violates no stated property, promise or accepted gate is **NOT A DEFECT, mechanism accurate**.

| ID | Reporters | Claimed | Verdict | Class | Evidence (file:line) |
|---|---|---|---|---|---|
| C01 | Opus N1; Fugu F1 (ii) (a diagnostic that dies outside its trap never reports, and is never restarted) | LOW / (part of LOW) | **CONFIRMED, LOW (V48o-1)**, measured | none | `core-watch-suite.sh:27` (noclobber `running-$H`), `:28` (`waiting`), `:33` (12 h flock wait), `:43` (trap installed only here; SIGKILL skips it anyway), `:67` (`running`); `core-watch.mjs:85` (`if (!suite)` only when no file), `:86`, `:89-92` (re-assertion "Suite: waiting"), `:117`, `:183-187`, `:209` (`queued` written before `spawn`). `n1/`: kill -9 while waiting → `suite-H.json` stays `waiting`, `running-H` stays; manual restart prints "already running", rc 0; six `decide()` ticks: `save,email!` then `email:unpinned` ×5, `resultSentAt` never set. |
| C02 | Fugu F1 (i); GLM F2 (the Core watch's selftest is run by no gate and has no floor) | LOW / LOW | **CONFIRMED, LOW (V48o-2)**, measured | none | `run-tests.sh` `sub_selftest` calls `:281,285,291,298,427,538` (poster, pob-merkle, launch, host, web, expiry) plus the detector, allocation, README and fork steps; no `core-watch` call anywhere (`grep -rn core-watch` over the tree: only the comment `run-tests.sh:91`, the installer and `bank/selftest.mjs:925-929,5227`, which read source). `core-watch.mjs:287-288` (exit on `bad` only, no floor). `cwsel/`: V47o-1 branch reverted → `XX … UNREADABLE …`, 24/25, rc 1; one arm deleted → "24/24", rc 0. `.cache/bba189a-suite.log`: 0 `core-watch` lines. |
| C03 | Ember R2 (burnt vaults' PDAs page `non_ata_token_account` CRITICAL) | LOW | **CONFIRMED, LOW (V48o-3)**, measured | none | `alarm.mjs:538-541` (`pdas` from `[...vaults, ...burnt]`), `:542-546` (`atas` from `vaults` only); `detectors.mjs:96-104`. `burnt/probe.mjs` (the alarm's block, the real detector): live canonical ATA → `reserve_ata_created:INFO`; **burnt vault's canonical ATA → `non_ata_token_account:CRITICAL`, "NON-CANONICAL … invisible to burn_vault unless declared"**; live non-canonical (control) → CRITICAL. Noted in passing by a round-32 seat ("not worth a finding"), never triaged. |
| C04 | **triage** (`validate-core-gate.sh` kills and boots validators without the shared lease) | - | **CONFIRMED, LOW (V48o-4)**, source | none | `validate-core-gate.sh:31` (`kill_v`: `pkill -x solana-test-val`, `fuser -k -TERM 8999/tcp 9900/tcp`), `:40` (boots on 8999), `:47` (`kill_v` first); `grep -c validator_lock scripts/validate-core-gate.sh` = 0. Listed as a command to run in SPEC `:2741`. `validator-lock.sh:10-11` and the arm `selftest.mjs:5221` name five runners, a fixed list. `sim/rehearsal-local.sh:26,42` also boots without the lease (it refuses busy ports and kills nothing, so it is only ever the victim). |
| C05 | Opus N5 (the diagnostic's failure count reads the shared `suite.log`) | INFO | **CONFIRMED, INFO (V48o-5)**, source | none | `core-watch-suite.sh:70` (`grep -c '^  XX' "$C/suite.log"`); `run-tests.sh:516-517` (`suite.log` is written only by `tee` in [7/7]); every earlier `die` (build, boot, the [4/7] re-hash `:199`, deploy, any [6/7] selftest) leaves the previous run's file. `:71` emails that count beside the correct `rc`. |
| C06 | GLM F3 (the reader validates System transfers by shape only) | LOW | **CONFIRMED, INFO (V48o-6)**, measured; regraded | none | `txread.mjs:50-54` (System: `object(info)` only), `:57-66` (token: accounts and digit amounts); `redemption-poster.mjs:103` (`BigInt(p.info.lamports ?? 0)`). `txr/probe.mjs` on the real v1 fixture: System transfer with no `lamports` → ACCEPTED; `info {}` → ACCEPTED; token transfer with no amount → refused ("token movement amount"); `releasedFromTx` → `{So111…, amount 0}`. `selftest.mjs:3803-3826` mutations cover token shapes only. |
| C07 | Opus N6 (the installer leaves the untagged CBOB jobs it does not own running beside the tagged ones) | INFO | **CONFIRMED, INFO (V48o-7)**, source + read-only `crontab -l` | none | `cron-install.sh:149` (`grep -v "$TAG"` keeps every untagged line), `:157` (the new flocked watch at `4-59/10`). The box crontab carries untagged lines in the pre-round-6 installer's format (`cron-install.sh:28-29,10`): `23,53 … node bank/alarm.mjs` (no flock), `7 9 … bank/distribute.mjs` (file deleted), `41 */6 … bank/revenue.mjs` (dry), and the hand-added `*/10 … scripts/core-watch.mjs` (no flock). After an install: two alarms start at :23/:53, and the loser of `withLock` sends "ALARM DID NOT RUN" (`alarm.mjs:995-1003`); two Core watches, one unflocked. |
| C08 | Opus N2 (the cron `flock` fd is inherited by the detached diagnostic, so later ticks are skipped and the deadman pages) | LOW | **DISPROVED by measurement** | none | `n2/`: `flock -n cw.flock node -e "spawn('setsid', …, {detached:true, stdio:'ignore'})"`. Node holds fd 3 → `cw.flock`, its child's `/proc/<pid>/fd` holds only 0-2, and a second `flock -n` succeeds at once (rc 0). Control: the same through a bash-spawned grandchild → rc 1 (inherited). So the measurement can detect the mechanism, and Node (v20.20.2) does not pass the fd on. |
| C09 | Opus N3 (`build-mainnet.sh` calls any untracked file dirty) | INFO | **NOT A DEFECT, mechanism accurate** | none | `build-mainnet.sh:103-107`. It fails closed with a named override, and the stated property is "refuses a dirty tree" (SPEC `:2736`). README's bootstrap (`:207-217`) is for a fresh clone. No run here leaves untracked files: `git status` after every canonical run shows only the audit directory. |
| C10 | Opus N4 ("a killed run frees the lock" holds only once every child exits) | INFO | **NOT A DEFECT** | none | The children holding fd 9 are the run's own live tests still using the validator. The lease follows whoever still uses it, which is the property wanted, and the refusal names the holder (`validator-lock.sh:25`). The validator itself never holds it (`9>&-`). |
| C11 | GLM F1 (README road row 8 cut mid-number to "… 10-10; 22") | LOW | **DISPROVED by measurement** | none | `readme-facts.mjs:126` (`t.search(/:\|\. /)`, a period followed by a space); `README.md:161` reads "done on mainnet 2026-10-09 to 10-10; 22.2 FAIL accepted by Gary (a true detection); scale not exercised"; `node scripts/readme-facts.mjs --check` → "README facts current", rc 0, **with `audits/round48/` untracked**, which is also the V47o-4 repair measured holding. |
| C12 | GLM F4 (the alarm's rehearsal notices keep production labels) | LOW | **ALREADY STATED** | none | SPEC `:2256-2266`: the alarm in a rehearsal runs with `CBOB_REHEARSAL_NOTIFY` (the router is never invoked) and "Run by hand instead, use `--dry-run`". The crank and revenue job's automatic `-rehearsal` labels are SPEC `:2266-2269`. The asymmetry is the documented design. Recommended (round 45/46's `rehearsalOnly` note): route the alarm through `rehearsalNotice` too. |
| C13 | GLM F5 (a dusted ProgramData address throws the alarm pass) | INFO | **NOT A DEFECT today; mechanism accurate, latent** | none | `alarm.mjs:252-264`. Every watched program's ProgramData exists at this tree: our five were claimed with the placeholder, and the third parties are deployed. The failure would be loud (`run_failed`), never quiet. Recommended: `isSystemDust` at that branch. |
| C14 | Fugu F2 (`revenue.mjs` never checks whether the operator's cbBTC ATA is frozen before sweeping) | INFO | **NOT A DEFECT, mechanism accurate** | none | It is a loud, recoverable stop: the swap is refused, one open cycle exists, `revenue.mjs:276-279` refuses every later cycle, and `unreconciled_swap` pages. The swept SOL sits on the operator key inside limit 10's bound and runbook. It is the same end state as an issuer freeze landing mid-cycle, which no pre-check can prevent. Recommended: a pre-sweep frozen check beside the funding check (`:281-290`). |
| C15 | Fugu F3 (item 53 sits outside the (a)-(d) launch gate) | INFO | **NOT A DEFECT** (the open state is recorded) | none | SPEC gate 3 defines a round's LAUNCH-CLEAN. OPEN AND BLOCKING items "must be done before anything mints" on their own terms (`:1121-1125`), and item 53's text names `e7c192a` as its last in-tree run. Nothing treats it as accepted. Agreed as process (C27). |
| C16 | DeepSeek R1-1 (a due boost on an unreadable record is missed, so `distribute` is refused) | LOW | **NOT A DEFECT** | none | `crank.mjs:642` decodes every record with `L.decode`, which throws on a wrong discriminator, version or short buffer (`layout.mjs:172-176`), so the pass fails loudly. A decoded record always has `boost_end_epoch`. A record missing from `getProgramAccounts` is an RPC fault, and the unmoved-epoch page (`:156-160`) is the correct outcome. |
| C17 | DeepSeek R1-5 (`mintFailureCode` returns null on unbalanced logs) | LOW | **NOT A DEFECT** (fail-closed by design) | none | `crank.mjs:112-114` ("CPI errors and unavailable logs remain failures"), `:131`. A null is a page, never a silent race. |
| C18 | DeepSeek R3-1 (`parseRustStruct` stops at a doc-comment `}`) | LOW | **DISPROVED** | none | `layout.mjs:235` needs `\n}` at column 0. A doc line starts with `///`, and any line it cannot read throws (`:245`). |
| C19 | DeepSeek R5-2 (`readPyth` does not check the account's address) | LOW | **NOT A DEFECT** | none | The caller reads the derived addresses (`swap.mjs:415`). An RPC that lied about the address could lie about the owner too. The seat concedes the PDA point itself. |
| C20 | DeepSeek R5-3; Ember R5(e); Opus R5(e); Qwen; GLM; Fugu (recommendation) (the judge leaves Meteora key 9 and the venues' pool-owned accounts unpinned) | LOW / (rec.) | **ALREADY STATED** (limit 10(c); round 47 C10 and rounds 36-44) | none | Reaching any of them needs a changed builder in this tree. The on-chain floor and the post-swap delta bound the output. Fugu's fork arm (swap the two vault keys, assert the program refuses) is a good gate-5 recommendation. |
| C21 | MiniMax V48-1 (`correlateBurns` downgrade unreachable; selftest fails) | LOW | **DISPROVED by measurement** | none | No `f.signer` in `detectors.mjs`; selftest **1081/1081**, exit 0 (`det.log`). |
| C22 | MiniMax V48-2 (crank plans positive `owed` for vaults the program gives 0) | LOW | **DISPROVED** | none | `crank.mjs:550` (`joinedNow = preJoined.has(r.address)`: joined BEFORE the distribution, so owed `w × Δacc` is exact), `:559`. Opus, Ember, Fugu and GLM each re-derive it equal. |
| C23 | MiniMax V48-3 (`closeAccount` collapses to one key) | LOW | **DISPROVED** | none | `swap.mjs:267-269`, three AccountMetas; the fork's 16/16 at `bba189a` closes the wSOL account on both venues. |
| C24 | MiniMax ("TDZ": `FLOOR` used before declaration) | - | **DISPROVED** | none | `selftest.mjs:5249` declares it, `:5255` uses it. |
| C25 | Observations: Opus (a `rescue_nested` refused `NotALiveVault` pages one action failure; `readme-facts` reads the working-tree copy of a tracked verdict); Fugu (`REVEAL_RENT_LAMPORTS` at the test validator's rate; the V44-1 arm's name says "the box signs"; two loose web arms) | (obs.) | **NOT DEFECTS / not filed** | none | Each is loud, in the safe direction, or a label. The rent constant over-reserves. The rescue race pages once with one fee, like round 47's C14. `--check` in the certifying suite compares what is committed. |
| C26 | Every counted seat (round 47's off-chain repairs hold) | (agree) | **AGREE**, independently measured, with residues V48o-1, V48o-2, V48o-4, V48o-7 | none | See the re-check below. |
| C27 | Opus, Ember, GLM, Fugu, DeepSeek, Qwen (item 53's last in-tree run is `e7c192a`; item 22 open only for scale; the 22.2 waiver; the swap extraction bound) | (obs.) | **ALREADY STATED** (SPEC items 22 and 53; limit 10; the 22.2 RULING, Gary 2026-10-10) | none | The 22.2 ruling is recorded, not a change. Extraction figures differ only in assumed cadence (Opus ~1.2%/cycle, Ember 0.15 SOL/cycle; Qwen's 100 bps understates the 150 bps floor). |
| C28 | DeepSeek R1-2, R1-3, R1-4, R2-1, R2-2, R2-3, R4-1, R4-2, R5-1, R5-4, R5-5, R6-1, R6-2, R6-3 | (LOW labels) | **NO CLAIM** (each withdrawn in its own text: "Fix: None needed") | none | - |
| C29 | Grok (round 47's reply, copied) | - | **NO CLAIM about this tree** | none | - |

## Confirmed findings

| ID | Severity | Independent disposition and minimal repair |
|---|---|---|
| **V48o-1**: Opus N1; Fugu F1 (ii) | **LOW** | **A Core-watch diagnostic that dies outside its trap never reports, and it cannot be restarted.**<br><br>**The mechanism.**<br>• The diagnostic writes `running-$H` (noclobber, `core-watch-suite.sh:27`) and `waiting` (`:28`), then waits up to 12 hours for the validator (`:33`) and runs a multi-hour suite (`:67-68`).<br>• A SIGKILL, an OOM or a reboot at any point leaves a non-terminal result (`queued`, `waiting` or `running`) and the marker.<br>• `decide()` starts a suite only when NO result file exists (`core-watch.mjs:85`). It reports only `done` or `unreadable` (`:86,117`). Anything else is the non-urgent "Suite: waiting" re-assertion, forever (`:89-92`).<br>• A hand restart exits "already running" with rc 0 on the stale marker (`:27`).<br><br>**Measured** (`n1/`, scratch copies with ROOT rewritten): kill -9 during the wait → `waiting` and `running-H` remain; the restart prints "already running", rc 0; six ticks give one URGENT "changed" email, then five "unpinned" re-assertions; `resultSentAt` is never set.<br><br>**What it costs.** The PASS or FAIL that the URGENT email promised ("its result follows by email") never arrives for that Core build, and nothing says the run died. The alarm's `prog.core.hash` CRITICAL drift still fires, so the change itself is not missed. It is V47o-1's class (the watch cannot deliver its result) through another exit, and the marker is the one round 47's V47o-2 (iii) named, which its repair did not clear.<br><br>**Severity and class.** **LOW**, V47o-1's precedent. No value path. **Class: none.**<br><br>**Repair.**<br>• Record the pid and boot id in the result and the marker.<br>• `suiteStatus` reads a non-terminal result whose pid is dead, or whose boot id differs, as `unreadable`, which gives one URGENT "unknown, treat as failed" email.<br>• The script breaks a marker whose pid is dead.<br>Gate-5 item 1. |
| **V48o-2**: Fugu F1 (i); GLM F2 | **LOW** | **The arms that pin round 47's Core-watch repairs are run by no gate and have no floor.**<br><br>**The construct.** V47o-1's unreadable-result decision, V47o-7's earlier-build result and C19's probe literal are proven only inside `core-watch.mjs --selftest` (25 arms). `run-tests.sh` runs every other selftest under an equality floor and never runs this one. `bank/selftest.mjs` only reads the installer line and the suite script's source. Its exit (`:287-288`) checks failures, not a count.<br><br>**Measured** (`cwsel/`):<br>• with V47o-1's `finished()` branch reverted, the arm goes red (`XX … UNREADABLE …`, 24/25, rc 1);<br>• with an arm deleted, it prints 24/24 and exits 0;<br>• the certifying `.cache/bba189a-suite.log` carries no `core-watch` line.<br>Round 47's VALIDATION ran it by hand ("Core watch 25/25").<br><br>**Severity and class.** **LOW**: a gate that cannot fail the build when its property breaks. That is the round 37 precedent and gate 4's "a gate that FAILS THE BUILD". **Class: none.**<br><br>**Repair.** `CORE_WATCH_FLOOR=25`, then `sub_selftest core-watch node scripts/core-watch.mjs --selftest` with `floor … "$CORE_WATCH_FLOOR"` in [6/7]. A `FLOOR` equality inside the selftest. The selftest-floor pairing arm extended to it. Gate-5 item 2. |
| **V48o-3**: Ember R2 | **LOW** | **The alarm pages CRITICAL, with false text, on any token account created for a burnt vault's PDA.**<br><br>**The construct.** `alarm.mjs:538-541` puts every burnt vault's PDA in `pdas`. `:542-546` puts only live vaults' canonical ATAs in `atas`. `detectPdaTokenAccounts` (`detectors.mjs:96-104`) therefore reads even the CANONICAL reserve ATA of a burnt vault as "NON-CANONICAL token account … invisible to burn_vault unless declared", at CRITICAL. Both halves of that sentence are false for a tombstone: the account is canonical, and `burn_vault` can never run again.<br><br>**Measured** (`burnt/probe.mjs`, the alarm's block fed to the real detector): live canonical → INFO; burnt canonical → CRITICAL with that text; live non-canonical (control) → CRITICAL.<br><br>**Reach.** Anyone can create an ATA for any owner. Bundled with a succeeding permissionless MINT call, it lands in the alarm's walk and pages CRITICAL, for one fee plus about 0.002 SOL of rent stranded each time. Each page names a fresh account, so it breaks through an open stream. It also fires without an adversary when a vault's ATA creation and its crack fall in the same pass window, or in a drained backlog.<br><br>**Severity and class.** **LOW**: a false CRITICAL, round 45's V45o-1 precedent. Detection only; nothing moves, nothing can be saved there. **Class: none.**<br><br>**Repair.** Judge creations for burnt PDAs separately: an INFO "token account created for a burnt vault; anything sent there is unrecoverable", or `pdas` from live vaults for this detector only. Keep the live+burnt set for `detectApprovals` and `assets` for `detectBurns`. Gate-5 item 3. |
| **V48o-4**: triage | **LOW** | **One runner on the tree still kills and boots test validators without the shared lease, so V47o-2's repair does not hold at every site of its shape.**<br><br>**The construct.** `scripts/validate-core-gate.sh` runs `pkill -x solana-test-val` and `fuser -k -TERM 8999/tcp 9900/tcp` before each arm and at the end (`:31,47,50,57`), and boots its own validator on 8999 (`:40`). It never sources `validator-lock.sh`. SPEC lists it among the commands to run (`:2741`).<br><br>**The effect.** Run beside a Core-watch diagnostic, it kills that diagnostic's validator. The next tick then emails **URGENT "FAILED … Do not move any CBOB program toward lock"** for a Core that may be fine, which is exactly V47o-2 (i). Run beside a certifying run, it fails that run (closed).<br><br>**Why the gate missed it.** The repair's arm hard-codes five runner names (`selftest.mjs:5221`; `validator-lock.sh:10-11`) instead of finding every script that kills or boots a validator. `sim/rehearsal-local.sh` also boots without the lease; it refuses busy ports and kills nothing, so it can only be the victim.<br><br>**Severity and class.** **LOW**, V47o-2's consequence at a sibling site (round 45's V45o-1 precedent for a repair that missed a site). It is manual-only, like V47o-2 (i). **Class: none.**<br><br>**Repair.** `source scripts/validator-lock.sh; validator_lock validate-core-gate \|\| exit 1` before the first `kill_v`, and the same for `rehearsal-local.sh`. Make the arm discover runners by content (`solana-test-validator` or `pkill -x solana-test-val` in a tracked `*.sh`/`*.mjs`). Gate-5 item 4. |
| **V48o-5**: Opus N5 | **INFO** | **The diagnostic's emailed failure count can come from someone else's run.** `core-watch-suite.sh:70` counts `XX` lines in the shared `.cache/suite.log`, which `run-tests.sh` writes only in [7/7] (`:516-517`). A diagnostic that dies at the build, the boot, the [4/7] re-hash or any [6/7] selftest reports "rc N: no summary line; K failing assertions", with K from the previous run. `rc` and the FAILED decision are correct; only the figure misleads. **Class: none.**<br><br>**Repair.** Count in `$LOGF`, or remove `$C/suite.log` before the run. |
| **V48o-6**: GLM F3 | **INFO** (GLM: LOW) | **The shared transaction reader accepts a System transfer with no `lamports`.**<br><br>**The construct.** `txread.mjs:50-54` requires only an `info` object for the System program. The token block beside it pins accounts and digit amounts (`:57-66`). The reader's own comment says money payloads "must carry their structured info rather than vanish".<br><br>**Measured** (`txr/probe.mjs`, the real v1 fixture): no `lamports` → accepted; `info {}` → accepted; token transfer with no amount → refused. The poster then drafts `amount 0` SOL released (`redemption-poster.mjs:103`).<br><br>**Why INFO, not LOW.** It needs an RPC answer that omits a field the RPC always sends. The only consumer is a local draft queue that cannot post. No money decision reads it. **Class: none.**<br><br>**Repair.** For System `transfer`, require `key(info.source)`, `key(info.destination)` and a non-negative integer `lamports`. Two mutation arms. Gate-5 item 6. |
| **V48o-7**: Opus N6 | **INFO** | **On the one box it targets, the installer leaves the pre-round-6 installer's untagged jobs running beside the tagged ones, so V47o-6's flocked Core watch would run alongside the unflocked hand-added one.**<br><br>**The construct.** `cron-install.sh:149` keeps every untagged line. This box's crontab still carries untagged `bank/alarm.mjs` (23,53, no flock), `bank/distribute.mjs` (deleted file), `bank/revenue.mjs` (dry, the old `41 */6`) and the hand-added `*/10 scripts/core-watch.mjs` (no flock). Read-only `crontab -l`; these are the v5 lines the installer's own comments describe (`:10,28-29`).<br><br>**The effect, after an install.**<br>• Two alarm passes start each :23 and :53, and the loser of `withLock` notifies "ALARM DID NOT RUN" (`alarm.mjs:995-1003`).<br>• Two Core watches tick, one unflocked on the `*/10` minute the installer avoids.<br>• Nothing moves money: the old revenue line is dry, and distribute is gone.<br>Round 47 recorded these lines as host state. Its V47o-6 repair, which adds a second watch, makes their removal part of that repair holding.<br><br>**Class: none.**<br><br>**Repair.** The installer refuses, or lists and asks about, any untagged uncommented line that runs `/opt/cbob-vaults/bank/*.mjs` or `scripts/core-watch*.mjs`. Remove the four lines from the box when the tagged set is installed. Gate-5 item 7. |

### The documentation exception (SPEC gate 3, ruling of 2026-10-07)

All seven change code, a test or the installer. **None is eligible**, so none could make this a clean or a no-change round.

## Rounds 43 to 47 re-check, per confirmed finding

The five programs are byte-identical to the release every one of these rounds judged (`git diff --name-only d2ae5fc d0e77e0 -- programs` is empty; `d2ae5fc` strips `0b3ddb3`'s source build). I re-read each verdict's mechanism and classified it again against `d0e77e0`.

**Round 47's off-chain repairs, at their sites:**
- **V47o-1:** `res()` uses `JSON.stringify` (`core-watch-suite.sh:25`). `FAILS` cannot emit `"0\n0"` (`:70`). An unreadable result is one URGENT email and no restart (`core-watch.mjs:86,117,120-121`).
  - Holds for the parse path.
  - The kill path is V48o-1; the count source is V48o-5; the arms are V48o-2.
- **V47o-2:** All five named runners take the lease before their trap and boot with `9>&-` (arm `selftest.mjs:5221-5226`, green in 1081). `run-tests.sh:197-199` re-hashes the booted Core.
  - Holds at those five.
  - `validate-core-gate.sh` is V48o-4.
  - Opus's inheritance worry for the new cron lease is disproved (C08).
- **V47o-3 / V47-7 / V47-8:** SPEC 22 and 53 are restated, Gary's ruling is recorded (`SPEC.md:1932-1936`), and the README row reads the FAIL as accepted. `--check` is current. **Holds.**
- **V47o-4 / V47-1:** `--check` passes with `audits/round48/` untracked (measured). **Holds.**
- **V47o-5 / V47-2:** `(?!NONE\b)` (`readme-facts.mjs`), with arms in 1081. **Holds.**
- **V47o-6:** The installer line and its deadman are present and armed (`selftest.mjs:925-929`). On this box it is V48o-7.
- **V47o-7 / C19:** `decide()`'s `prior` loop (`:97-102`) and `MF` from `MAINNET_FLOOR` (`core-watch-suite.sh:58`). **Hold**, but their arms are V48o-2.
- **V47o-8:** `mock-rpc.mjs:136` serves `getTokenAccountsByOwner`; plan 172/172 in 805. **Holds.**
- **V47o-9:** `run-tests.sh:426`, after [3/7] and before the web step (arm green). **Holds.**
- **V47-4, V47-5, V47-6:** ceremony 161, tx 37 and the README wording arms are green. V47-3 and V47-9 belong to the programs pass. V47-3's R.4/R.4b ran 913/913 in `.cache/bba189a-suite.log`.

| Finding | Severity | (a) programs | (b) value | (c) crack | (d) H/M | Outside (a)-(d)? |
|---|---|---|---|---|---|---|
| R43 **V43-1** a host's owner keeps a nested vault by Executing it out in their own opening | LOW | No defect against the ruled design (limit 58; the crank's rescue) | No (the owner's own vault, in their own crack) | No | No | **Yes** |
| R43 **V43-2** the e2e header described the old rescue rule | INFO | No | No | No | No | **Yes** |
| R43o **V43o-1** the release check died in the rehearsal tree | LOW | No (`run-tests.sh`) | No | No | No | **Yes** |
| R43o **V43o-2** one unreadable signature froze a scan | LOW | No (`alarm.mjs`) | No (detection) | No | No | **Yes** |
| R43o **V43o-3** the reveal-skip arm could not fail | LOW | No (`selftest.mjs`) | No | No | No | **Yes** |
| R44 **V44-1** the rehearsal ceremony could not consume the value file | LOW | No | No | No | No | **Yes** |
| R44 **V44-2** `release_gate` accepted a reversible swap, ignored untracked files | LOW | No (`run-tests.sh`) | No | No | No | **Yes** |
| R44 **V44-3** the coverage gate could not credit LAUNCH-CLEAN | LOW | No | No | No | No | **Yes** |
| R44 **V44-4** RULED missing from the status legend | INFO | No | No | No | No | **Yes** |
| R44 **V44-5** limit 59 cited the test validator's rent | INFO | No | No | No | No | **Yes** |
| R44 **V44-6** "the one exception" omitted the bare burn | INFO | No (programs credit as SPEC states) | No | No | No | **Yes** |
| R44 **V44-7** an absent pinned collection shown as BROKEN | INFO | No (ceremony page) | No | No | No | **Yes** |
| R44o **V44o-1** the poster's skip never fired while a backlog drained | LOW | No (drafts only) | No | No | No | **Yes** |
| R44o **V44o-2** the split-recovery scan died on one refused signature | LOW | No (`revenue.mjs`) | No (the job stops; balances stay) | No | No | **Yes** |
| R44o **V44o-3** a null SEAL read dropped reserve baselines | LOW | No (`alarm.mjs`) | No (detection) | No | No | **Yes** |
| R44o **V44o-4** the no-network runner exited 1 | INFO | No | No | No | No | **Yes** |
| R44o **V44o-5** the rehearsal runbook did not cover the off-chain jobs | INFO | No | No | No | No | **Yes**. Its alarm half is SPEC's stated design (C12) |
| R45 **V45-1** item-22 predicates could pass without evidence | LOW | No (driver) | No | No | No | **Yes** |
| R45 **V45-2** `--rpc box` put the key in argv | LOW | No (driver) | No | No | No | **Yes** |
| R45 **V45-3** deploy key not tied to the judged id | LOW | No (driver) | No | No | No | **Yes** |
| R45 **V45-4** rescue bricked on a lost confirmation | LOW | No (driver) | No | No | No | **Yes** |
| R45 **V45-5** cycle 1 judged by venue order | LOW | No (driver) | No | No | No | **Yes** |
| R45 **V45-6** the init window was not "at once" | INFO | No | No | No | No | **Yes** |
| R45 **V45-7** `'box'` as DAS URL; sweep-back scope | INFO | No | No | No | No | **Yes** |
| R45 **V45-8** 22.1 PASS at 5 vaults | INFO | No | No | No | No | **Yes** |
| R45 **V45-9** SPEC 53 alarm text stale | INFO | No | No | No | No | **Yes** |
| R45 **V45-10** hand recovery recorded signatures late | INFO | No | No | No | No | **Yes** |
| R45 **V45-11** collection create lacked the taken check | INFO | No | No | No | No | **Yes** |
| R45o **V45o-1** null SEAL invented "no reserve mints" at two more sites | LOW | No (`alarm.mjs`) | No (detection) | No | No | **Yes** |
| R45o **V45o-2** forced-failure switches read after the sweep | LOW | No (`revenue.mjs`) | No (the capped sweep to the Bank's own operator key) | No | No | **Yes** |
| R45o **V45o-3** frozen-pool overdue text blamed every layer | INFO | No | No | No | No | **Yes** |
| R45o **V45o-4** a flood reset the unreadable count | INFO | No | No | No | No | **Yes** |
| R45o **V45o-5** coverage selftest red on a never-bundled file | INFO | No | No | No | No | **Yes** |
| R45o **V45o-6** `budgetPlan` low-key wording | INFO | No | No | No | No | **Yes** |
| R45o **V45o-7** prompt described the wrong round; split bundles | INFO | No (audit script) | No | No | No | **Yes** |
| R46 **V46-1** multi-send rehearsal steps not resumable | LOW | No (driver) | No | No | No | **Yes** |
| R46 **V46-2** rehearsal values could expire before step 10 | LOW | No (driver) | No | No | No | **Yes** |
| R46 **V46-3** the rescue step could nest twice on resume | INFO | No (driver) | No | No | No | **Yes** |
| R46 **V46-4** hand recovery after a landed swap | INFO | No (driver) | No (rehearsal funds, recovered) | No | No | **Yes** |
| R46 **V46-5** `mainnet-local` accepted overrides | LOW | No (web build) | No | No | No | **Yes** |
| R46 **V46-6** refused values did not end the ceremony preflight | INFO | No (ceremony page) | No | No | No | **Yes** |
| R46 **V46-7** SPEC 53 stale-proof sentence | INFO | No | No | No | No | **Yes** |
| R46 **V46-8** the seed-7 init key could not pay on mainnet | LOW | No (rehearsal values and driver) | No | No | No | **Yes** |
| R46o **V46o-1** the asset-less ack arm could not fail | LOW | No (`selftest.mjs`) | No | No | No | **Yes** |
| R46o **V46o-2** an undelivered pass kept its unreadable counts | INFO | No (`alarm.mjs`) | No (detection) | No | No | **Yes** |
| R46o **V46o-3** the load-time refusal paged nothing | INFO | No | No | No | No | **Yes** |
| R46o **V46o-4** the web suite needed the untracked placeholder | INFO | No | No | No | No | **Yes** |
| R46o **V46o-5** the prompt's bundle claims | INFO | No (audit script) | No | No | No | **Yes** |
| R47 **V47-1** README facts counted untracked rounds | LOW | No (`readme-facts.mjs`) | No | No | No | **Yes**. Repaired, measured holding (C11) |
| R47 **V47-2** NONE read as owed | LOW | No | No | No | No | **Yes**. Repaired |
| R47 **V47-3** suite arm R.4 blind to seven plugin kinds | LOW | No (a suite arm, not program code) | No | No | No | **Yes**. Repaired (913 with R.4b) |
| R47 **V47-4** ceremony gave the wallet judge no compute floor | LOW | No (ceremony page) | No | No (initialize tooling, not a crack) | No | **Yes**. Repaired (ceremony 161) |
| R47 **V47-5** the judge passed a writable-to-readonly downgrade | LOW | No (page judge) | No (it refuses more now; the wallet cannot add a transfer) | No | No | **Yes**. Repaired (tx 37) |
| R47 **V47-6** README said SEAL holds and BURN pays reserves | INFO | No | No | No | No | **Yes**. Repaired |
| R47 **V47-7** README showed step 8 "done" without 22.2 | INFO | No | No | No | No | **Yes**. Repaired, ruling recorded |
| R47 **V47-8** SPEC 53 said the rehearsal had not run to its end | INFO | No | No | No | No | **Yes**. Repaired |
| R47 **V47-9** the proxy comment said eight shapes | INFO | No (comment) | No | No | No | **Yes**. Repaired |
| R47o **V47o-1** a passing diagnostic wrote invalid JSON | LOW | No (Core watch) | No | No | No | **Yes**. Parse path repaired; V48o-1, V48o-2, V48o-5 |
| R47o **V47o-2** the private validator lock | LOW | No (runners) | No | No | No | **Yes**. Five runners repaired; V48o-4 |
| R47o **V47o-3** SPEC and README silent on the rehearsal | LOW | No | No | No | No | **Yes**. Repaired, ruling recorded |
| R47o **V47o-4** untracked rounds failed the README check | INFO | No | No | No | No | **Yes**. Repaired, measured |
| R47o **V47o-5** NONE published as changes owed | INFO | No | No | No | No | **Yes**. Repaired |
| R47o **V47o-6** the Core watch outside the installer | INFO | No | No | No | No | **Yes**. Repaired in the tree; V48o-7 on the box |
| R47o **V47o-7** a second Core change dropped the first result | INFO | No | No | No | No | **Yes**. Repaired; arms in V48o-2 |
| R47o **V47o-8** the stale mock | INFO | No (test mock) | No | No | No | **Yes**. Repaired |
| R47o **V47o-9** the reproduce order | INFO | No | No | No | No | **Yes**. Repaired |

**All sixty-six are outside (a)-(d).** None of round 48's seven reopens one of them inside (a)-(d) either: each residue is in the Core watch, a runner, the alarm, the reader or the installer.

## Gate-5 obligations

SPEC ship gate 4 requires every accepted finding to have a gate that fails the build in both directions. Gate 5 requires every measurable rejected finding to become an assertion. These are obligations, not findings.

1. **V48o-1:** a `decide()` + `suiteStatus` arm. A result `{status:'running', pid:<dead>}` (and one with a different boot id) yields one URGENT "unknown" email and no restart; a live pid keeps the re-assertion. A shell arm: a stale `running-$H` with a dead pid is broken, and a live one is respected. Show it red at `d0e77e0` (measured: no result and no restart, ever).
2. **V48o-2:** `run-tests.sh` runs `core-watch.mjs --selftest` under `CORE_WATCH_FLOOR` equality. The selftest-floor pairing arm covers it. Shown red by deleting one arm (measured today: 24/24, rc 0).
3. **V48o-3:** a detector arm. A burnt vault's canonical ATA creation is not CRITICAL; a live vault's non-canonical one still is. Run over the alarm's real set-building block, extracted. Red at `d0e77e0` (measured CRITICAL).
4. **V48o-4:** the runner arm discovers every tracked script that boots or kills a test validator and requires the lease before its first kill. Red today on `validate-core-gate.sh`.
5. **V48o-5:** a result-writer arm whose `.cache/suite.log` holds a stale `XX` line while `$LOGF` holds a build failure; the emailed count must not include it.
6. **V48o-6:** two `txread` mutation arms, a System transfer with no `lamports` and one with a non-integer `lamports`, both refused. Red at `d0e77e0` (measured accepted).
7. **V48o-7:** an installer arm. A crontab carrying an untagged `cd /opt/cbob-vaults && … node bank/alarm.mjs` or `scripts/core-watch.mjs` line is refused or named, run on the extracted shell like the round-19 preserve arms.
8. **Measurable rejections:**
   - **C08:** an arm that a tick's spawned diagnostic does not hold `core-watch.flock`, so a later Node upgrade that changes fd handling turns it red. Recommended.
   - **C11:** a `short()` arm on the current row-8 cell keeping "22.2". Recommended.
   - **C13:** `isSystemDust` at the ProgramData branch, with an arm. Recommended.
   - **C14:** a pre-sweep frozen check on the operator's cbBTC ATA, with an arm. Recommended.
   - **C20:** Fugu's fork arm (swap Orca's two vault keys; the program must refuse). Recommended, as since round 38.
9. **Carried, still OPEN:** round 43's gate-5 items 4 and 5 (`alarm.mjs` sets from `judged`; `swap.mjs` `bitmapExists: !!bm`), round 44's item 6, and round 46's recommendations (C08 and C09 arms, the release-wallet outflow watch, `CBOB_ALARM_REHEARSAL` through `rehearsalOnly`, now also C12).
10. **Round 47's off-chain gate-5 items:**
    - **Discharged:** items 1, 3, 4, 5, 6, 8 and 9, all in today's 1081/805 or the [6/7] guard.
    - **Items 1 and 7 are discharged only by hand:** their arms are in the ungated selftest. V48o-2 closes them.
    - **Item 2:** discharged for five runners. V48o-4 is the sixth.

## Independent measurements

All artefacts are in `/tmp/claude-1000/triage48o/`.

| Measurement | Result | Evidence |
|---|---|---|
| Detector selftest, live tree | **1081/1081**, exit 0 | `det.log`, `rc.txt` |
| Web offline (`run-all.mjs`), live tree | **805/805** in 11 files at their floors (plan 172, ceremony 161, tx 37), exit 0 | `web.log` |
| Launch / poster / allocation selftests | **69/69**, **24/24**, **39/39**, exit 0 each | `launch.log`, `poster.log`, `accrual.log` |
| Core watch `--selftest` (read-only: `decide()`, `suiteStatus` on a `/tmp` dir, the extracted `res()`, `readPin()`) | **25/25**, exit 0 | `corewatch.log` |
| README facts `--check`, with `audits/round48/` untracked | current, rc 0 | session |
| V48o-1, kill -9 of a waiting diagnostic | `waiting` and `running-H` left; restart "already running" rc 0; `decide()` never starts or reports | `n1/` (both scripts copied, ROOT rewritten to `/tmp`; nothing under `/opt` touched) |
| V48o-2, arm mutation and deletion | reverted branch → 24/25 rc 1; deleted arm → 24/24 rc 0; no gate runs it | `cwsel/` |
| V48o-3, burnt-PDA creation | canonical ATA of a burnt vault → `non_ata_token_account:CRITICAL` | `burnt/probe.mjs` |
| V48o-6, System transfer shape | no `lamports` and `{}` accepted; token control refused; poster drafts 0 | `txr/probe.mjs` |
| C08, cron lease inheritance | Node child holds no fd → second `flock -n` rc 0; bash control rc 1 | `n2/` |
| Canonical runs, read | `bba189a` suite RC 0 (913/913, 1081, 805, 39, probe 35, expiry 4, fork 16/16, README current); e2e 152/152 RC 0; sim 71/71 RC 0 | `.cache/bba189a-*.log` |
| The prompt | 1,958,826 chars, equal to every manifest | `/tmp/v48tro-prompt-offchain.txt` |
| Trees | HEAD = audited head; programs unchanged since `d2ae5fc`; `git status` unchanged by this triage | `git diff`, session |

## Measurement limits

- **Nothing live was run.** I ran no validator, `run-tests.sh`, sim, fork, e2e, crank, alarm pass, revenue job, `validate-core-gate.sh` or router delivery. I ran no `core-watch.mjs` tick and no `core-watch-suite.sh` against `/opt`. Nothing that sends a transaction or a notification ran. I did not open `.cache/core-watch/`, `dist/` or `audits/round48/VERDICT-programs.md`.
- **V48o-1** was measured on scratch copies with their root moved to `/tmp`, during the 12-hour wait. The same outcome after the trap is installed follows from SIGKILL semantics; I did not kill a real multi-hour run.
- **V48o-4** is source order. Its interleaving needs two validators, which the brief forbids. I filed it from a sibling-site search the seats could not make, because the file rides in the programs pass's bundle, not this one.
- **V48o-7** rests on a read-only `crontab -l` filtered to CBOB lines. That is host state; the installer has not been run on this box since its round-6 tag existed. The two-alarm consequence follows from the identical minutes and `withLock` (`lock.mjs:340-344`); I did not run two alarms.
- **C08** was measured with Node v20.20.2 and util-linux 2.37.2, the box's versions. Another Node's fd handling could differ, hence the recommended arm.
- **Seat decisions are judgments, and quorum has no margin.** Excluding Qwen (whose header carries a fabricated measurement) would leave five and the quorum unmet. I count it because every construct its body names exists only at this tree and checks out, and it rests no finding on its errors. Grok's and MiniMax's exclusions are clear-cut.
- **What no measurement here shows:** whether the next Core change is diagnosed and reported end to end, whether the router delivers at 3 am, anything at 2,100 vaults.

## Remaining requirements

- **Before the next confirmation round:** V48o-1 to V48o-7 with gate-5 arms 1-7, each shown red at `d0e77e0`.
  - V48o-3 and V48o-6 touch `bank/` (`alarm.mjs`/`detectors.mjs`, `txread.mjs`).
  - The rest touch `scripts/` and the box crontab.
  - Under gate 2, those commits reset the freeze, and the next round confirms a changed tree.
- **Unchanged:**
  - Items 22 (scale), 38, 50, 52 and 53 remain OPEN AND BLOCKING.
  - `charter_opens_at`, `lock_deadline` and `vault_collection` remain OPEN in `launch/mainnet-init.json`.
  - No deployment, initialization, lock, ceremony, cron installation, rehearsal or publication follows from this audit.

**Result: QUORUM MET (6 counted of 8; six required; one same-prompt re-run, verified against the first run's head and prompt size, and not counted on its merits). LAUNCH-CLEAN under SPEC gate 3's launch gate: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 4 LOW, 3 INFO.**
- **LOW:** V48o-1 a killed diagnostic never reports; V48o-2 the Core watch's selftest is ungated; V48o-3 false CRITICAL on burnt PDAs; V48o-4 `validate-core-gate.sh` ignores the validator lease.
- **INFO:** V48o-5 stale failure count; V48o-6 System transfers unvalidated; V48o-7 legacy cron lines beside the tagged set.

Nothing is in the five programs, no value path, no refused crack. **REQUIRES CHANGES: V48o-1 to V48o-7. Not a no-change round.**

---

## Reply (under 300 words)

**Round 48, off-chain pass: LAUNCH-CLEAN; QUORUM MET. REQUIRES CHANGES: V48o-1 to V48o-7. Not the no-change round.**

**Seats counted: 6 of 8 (6 needed, no margin):** Opus 5.5, Ember, Fugu, GLM, DeepSeek, and Qwen (counted despite a copied header claim).

**Not counted:**
- **Grok:** its report is round 47's verdict reply, copied.
- **MiniMax** (re-run, same head and prompt): it invents `f.signer`, `joinedNow` and `closeAccount` code, and claims a failing selftest that measures 1081/1081.

**Confirmed, all outside (a)-(d):**
- **V48o-1, LOW (Core watch):** a diagnostic killed by SIGKILL, OOM or a reboot leaves `waiting`/`running` plus a stale marker. No result ever arrives, and a restart is refused. Measured.
- **V48o-2, LOW (gates):** `core-watch.mjs --selftest`, the only proof of V47o-1/V47o-7/C19, is run by no gate and has no floor. Measured: a deleted arm still exits 0.
- **V48o-3, LOW (alarm):** a burnt vault's canonical ATA pages `non_ata_token_account` CRITICAL with false text. Measured.
- **V48o-4, LOW (filed by triage):** `validate-core-gate.sh` kills and boots validators without V47o-2's lease.
- **V48o-5, INFO:** the diagnostic emails a failure count from the shared `suite.log`.
- **V48o-6, INFO:** the transaction reader accepts a System transfer with no `lamports`; the poster drafts 0. Measured.
- **V48o-7, INFO:** the installer leaves this box's untagged legacy alarm and Core-watch lines running beside the tagged ones.

**Disproved or already stated:**
- Opus's cron-flock inheritance (measured);
- GLM's garbled road row (README current);
- GLM's alarm rehearsal labels (SPEC item 53);
- Fugu's frozen operator ATA and item-53 gate points;
- DeepSeek's five;
- `host_fee_in` (limit 10(c)).

**Rounds 43-47:** all 66 confirmed findings remain outside (a)-(d). Round 47's repairs hold, with residues V48o-1, V48o-2, V48o-4 and V48o-7.

**Selftests:** 1081, 805, 69, 24, 39 and core-watch 25, all green.
