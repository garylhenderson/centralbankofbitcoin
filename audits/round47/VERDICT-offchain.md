# Round 47, OFF-CHAIN pass: LAUNCH-CLEAN; QUORUM MET
REQUIRES CHANGES: V47o-1, V47o-2, V47o-3, V47o-4, V47o-5, V47o-6, V47o-7, V47o-8, V47o-9

**Independent triage verdict against audited head `487a8b4736757dc4e912d283b171caf0347f11bc` (`487a8b4`), which is HEAD.** `git status --porcelain` showed only `?? audits/round47/` before and after every run in this triage, and nothing else was written to the repository except this file. The product tree is round 46's validated repairs plus the post-46 commits named in the prompt's R0. `git diff --name-only d2ae5fc 487a8b4` names only `.github/workflows/verifiable-build.yml`, `README.md`, `SPEC.md`, `audits/round46/VALIDATION.md`, `scripts/audit47.ts`, `web/README.md`, `web/src/config.js` and `web/test/ids.test.mjs`. `git diff --quiet d2ae5fc 487a8b4 -- programs bank scripts/run-tests.sh sim tests launch` exits 0. The five programs equal round 35's `0b3ddb3` (`git diff --quiet 0b3ddb3 487a8b4 -- programs Cargo.toml Cargo.lock` exits 0). Since round 46's audited head (`63a92b2`), `bank/` changed only in `alarm.mjs`, `revenue.mjs`, `rehearsal-env.mjs` (the V46o-2 and V46o-3 repairs) and `selftest.mjs`. `swap.mjs`, `crank.mjs`, `detectors.mjs` and `accrual.mjs` are byte-identical to round 46's.

**Seven of the eight seats are counted against a required six. Quorum is met with a margin of one.** The one excluded seat (Longcat) describes round 46's tree for its only finding and invents crank constructs (reasons below).

**Nine findings are confirmed in this pass: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 3 LOW, 6 INFO.** All of them are in tooling, tests and documents written or changed after round 46: the new Core watch and its diagnostic suite runner, the new README facts generator, the README, SPEC's rehearsal items and the offline web mock. None is in the five programs. None moves value out of a vault, the pool or the revenue address, and none credits value wrongly. None stops or wrongly refuses a crack, and none is HIGH or MEDIUM. Under SPEC ship gate 3's launch gate (RULING, Gary 2026-10-08), the pass is **LAUNCH-CLEAN**.

**It is not a no-change round.** Each confirmed finding needs a change to a script, a test fixture, SPEC or the README. None is an accepted limit already stated in SPEC. Gary's 2026-10-09 test ("a clean round where we make NO changes") is not met by this pass, independently of the programs pass.

**The most consequential finding is a measured one in code no earlier round saw.** When the Core watch's diagnostic suite PASSES, `scripts/core-watch-suite.sh` writes its result as invalid JSON (`grep -c … || echo 0` yields `"0\n0"`, which `printf` embeds raw in a JSON string). `scripts/core-watch.mjs` then reads no result, never sends the PASSED email, and starts the multi-hour suite again on every tick until someone re-pins. A failing run that prints no `XX` line (a build or boot failure) also produces invalid JSON, and the URGENT FAILED email is never sent either (V47o-1, LOW, measured).

**The claim from the session that wrote the code is confirmed** (V47o-4, INFO, measured). `scripts/readme-facts.mjs` counts every `audits/roundN` directory on disk, tracked or not. While an audit round's untracked output exists, `run-tests.sh`'s `--check` fails, and the suite stops before its on-chain arms (`.cache/487a8b4-suite.log`). Measuring it turned up a sibling defect in the same generator, filed by this triage: a verdict reading `REQUIRES CHANGES: NONE` is published on the README as "yes, repairs not yet validated" (V47o-5, INFO, measured). That is the one result the launch gate is waiting for.

**The one filed MEDIUM does not stand.** Muse's MEDIUM says the swap judge does not pin Meteora's `host_fee_in`. The mechanism is accurate. But this claim has been filed and settled six times (rounds 29, 33, 36, 38, 43 and 44). On its own figures, the value at stake is a share of Meteora's protocol fee. The on-chain floor binds the output. It needs a changed builder in our own tree, which is accepted limit 10(c). It is ALREADY STATED.

**25 deduplicated claim groups: 9 confirmed (3 LOW, 6 INFO; one filed by this triage), 3 already stated (C10, C23, C24), 2 agreements with round 46 (C20, C25), 1 with no claim (C21), the rest disproved or not a defect.**

The programs pass is triaged separately (`audits/round47/VERDICT-programs.md`, which I did not open). The workflow file, the driver steps, `web/src/` and `web/build.mjs` ride in that pass (`scripts/audit47.ts:150-176`). I judged this pass's claims about them only where I could read the file in the repository.

## Quorum and the integrity of what was audited

**Manifests.** `MANIFEST-offchain.first-run.json` records head `487a8b4…`, `dirty: []`, `promptChars` 1,955,866, requested 8, auditors 5, required 6. Its eight entries:
- **Three were disqualified:**
  - `meta/muse-spark-1.3` and `qwen/qwen3.8-2.4t-a95b`: "request failed". Each failed file in `failed/` is 41 bytes, `FETCH FAILED Unexpected end of JSON input`.
  - `xiaomi/mimo-v2.6-pro`: "output cut off mid-report", `finish: length`, 65,536 output tokens. Its failed file is 14,902 bytes and ends mid-sentence ("The crank's claim batches,").
- **The re-runs.** The three re-run manifests (`MANIFEST-offchain.rerun-*.json`) each record the **same head** `487a8b4…`, `dirty: []` and the **same `promptChars` 1,955,866**. Each re-run is `ok: true`, `finish: stop`, `disqualified: null`.
- **The prompt.** `RENDER_ONLY=1 FOCUS=offchain TAG=v47tro npx tsx scripts/audit47.ts` reproduces it at exactly 1,955,866 characters.
- **The reports on disk** equal the manifests' character counts exactly (`wc -m`):
  - first runs: Fable 29,106, Sonnet 12,724, Longcat 14,800, Qwen max 26,786, GLM 25,481;
  - re-runs: Muse 22,622, Qwen 2.4T 29,403, MiMo 21,194.

The three failed first outputs are not counted.

**What the bundle carries.** Rendered prompt `:1605-25830`:
- crank, detectors, alarm, layout, accrual, swap, rehearsal-env, revenue, the swap fork, poster, selftest, spl, anchor, lock, sigwalk and txread;
- cron-install, check-launch-params, build-mainnet, rehearsal-tree, token-programs and run-tests;
- the three launch JSONs and ten `web/test` files;
- round 46's off-chain verdict and VALIDATION;
- `scripts/rehearsal-run.mjs` (the round-46 V46o-5 repair: it travels with the selftest that imports it);
- MINT and SWEEP;
- SPEC, HOLDER-GUIDE, DESIGN-v6 and RT3;
- the new `core-watch.mjs`, `core-watch-suite.sh`, `readme-facts.mjs`, `sbf-strip.sh`, `mine.test.mjs`, README and the rehearsal RECORD.

R0 names the 22 imported modules this pass does not carry, from the file list (`:21`). V46o-5's repair holds.

| Auditor | Disposition |
|---|---|
| anthropic/claude-sonnet-5.5 | **Counted.** 12,724 chars. The sharpest seat on the new code. F1 traces `grep -c` exit semantics through `printf` into `JSON.parse` and `decide()`'s `!suite` branch, and names the exact `od -c` test. Measured true (V47o-1). F2 finds the unconditional "cache is the pinned mainnet build" window and the stale-lock wedge (V47o-2). F3, F4 and F5 are V47o-6, V47o-3 and V47o-9. Its R0 checks each V46o repair at its construct. |
| z-ai/glm-5.3 | **Counted.** 25,481 chars. R0 table at each repair's construct, with the `undeliveredWalk` arm and the exact `refuseStrayOverridesAtLoad` call arguments. R47o-1 (V47o-3) quotes SPEC 53's keep-open sentence against the road row. R47o-2 (V47o-2) names the EXIT-trap kill and the pid-less lock. R47o-3 is V47o-7. R47o-4 makes no claim (C21). |
| anthropic/claude-fable-5.1 | **Counted.** 29,106 chars. The widest read. It recomputes `minted_total` at 141, the Pyth offsets and the 801-assertion web floor sum. It walks every crank send against MINT's gates.<br>**Confirmed:** F1 (V47o-2), F2 (V47o-3), F3 (V47o-6) and F5 (V47o-8, measured; filed as a question, answered here).<br>**Not confirmed:** F4 (C15) and F6 (C14). |
| meta/muse-spark-1.3 (re-run) | **Counted.** 22,622 chars. Specific, checkable claims at this tree: the ack arm and its mutant, the `!delivered` lines, the fixture paths `ceremony.test.mjs:167,174`, the cron jobs at `:148-151`, and the judge's unchecked Meteora key 9.<br>**Confirmed:** R0-2 (V47o-2, filed INFO, graded LOW here) and its 22.2 item (V47o-3).<br>**Narrowed:** R0-1 is V47o-6. Its "never runs" is false: the watch is hand-installed in the box crontab.<br>**Not confirmed:** R5-1 (MEDIUM) is ALREADY STATED (C10). Its item-53-at-`d2ae5fc` note is not a defect (C18). |
| qwen/qwen3.8-2.4t-a95b (re-run) | **Counted.** 29,403 chars. Re-derives the oracle, the Pyth offsets and the reweigh/claim formulas. Cross-checks the four Core-pin copies (`readPin()` reads the pin from `run-tests.sh`). Names what it could not verify. INFO-1 is V47o-6 and INFO-2 is V47o-2. Its sub-claim that the interaction is fail-closed "because run-tests.sh re-hashes the cache" is wrong past step [2/7] (C22). |
| qwen/qwen3.8-max-0902 | **Counted.** 26,786 chars. Its quotes are this tree's: SPEC 53's "so staleness is no longer what keeps this item open", `judgeInitAccount`, `initKeyFor`, and the 18-arm core-watch selftest coverage. It also checks `planCostLamports` batching. F1 is V47o-3. F2 and F3 are not defects (C16, C17).<br>**Peripheral errors:** "run-tests.sh would fail to start the validator… so they can't overlap" (they do, V47o-2); V46o-4 "bundle.test.mjs reads from there" (it is `ceremony.test.mjs`). |
| xiaomi/mimo-v2.6-pro (re-run) | **Counted.** 21,194 chars. Its constructs check out:<br>• `revealAttrSource` → `'skip'` → `break` (`crank.mjs:207-208,755`) and the V43o-3 arm;<br>• the L13b wiring arms and `judgeCronTemplate`'s `flock -n` rule;<br>• `orcaTickArrayStarts(-90112, 16)`;<br>• `detectUnsweptRoyalties` on `nowSec`.<br>Its R0 rows about non-bundled files (`nestedSent`, `alreadyRecovered`) restate what the bundled selftest arms quote, so they are not invented. LOW-1 is not a defect (C12). |
| meituan/longcat-2.0 | **Not counted.** 14,800 chars.<br>• **An older tree.** Its only finding ("SPEC.md lines 2197-2202 say the `d57ee3a` rehearsal proof 'is STALE'") is round 46's V46-7, quoted from round 46's tree. At `487a8b4`, SPEC `:2216-2221` records the `e7c192a` re-proof.<br>• **Invented contents.** "V46-3: `bank/crank.mjs` `planRescues` … the rescue's `nestedSent` flag prevents double-send": `grep -c nestedSent bank/crank.mjs` = 0. The flag lives in the rehearsal driver.<br>• **Wrong offsets.** Pyth "verification_level 1, feed_id 33". The reader uses 40 and 41.<br>• **Unbundled files verified.** It "verifies" `rehearsal-steps.mjs`, `rehearsal-recover.mjs`, `web/build.mjs` and `ceremony.mjs`, none of which it was given.<br>Its claim is still triaged (C11). |

## Distinct claims and dispositions

Class column: (a) a finding in the five programs; (b) a path that moves value out of a vault, the pool or the revenue address, or credits value wrongly; (c) a stopped or wrongly refused crack; (d) HIGH or MEDIUM anywhere. "none" means outside all four. As in rounds 40-46, a claim whose mechanism is accurate but which violates no stated property, promise or accepted gate is **DISPROVED as a defect, mechanism accurate**.

| ID | Reporters | Claimed | Verdict | Class | Evidence (file:line) |
|---|---|---|---|---|---|
| C01 | Sonnet F1 (a passing diagnostic suite writes invalid JSON; no PASS email; the suite restarts every tick) | LOW | **CONFIRMED, LOW (V47o-1)**, measured; extended to failures with no `XX` line | none | `core-watch-suite.sh:57` (`FAILS=$(grep -c '^  XX' $C/suite.log 2>/dev/null \|\| echo 0)`), `:19` (`printf … "summary":"%s"`), `:58`, `:36` (trap removes `running-$H`); `core-watch.mjs:162-165` (`catch { return undefined }`), `:81` (`if (!suite) acts.push({ kind: 'suite' })`), `:183-187`. `run-tests.sh:48,502` (`$CACHE/suite.log`). `cw/f1.sh`: pass → `JSON.parse THROWS: Bad control character`; fail-with-XX parses; build-fail (no XX) THROWS. `cw/probe.mjs`: 4 ticks → `suite` each, `resultSentAt` never set; control (valid JSON) → one PASSED email. |
| C02 | Sonnet F2; GLM R47o-2; Fable F1 (i)-(iii); Muse R0-2; Qwen 2.4T INFO-2 (the watch's validator lock is honoured by no other runner) | LOW / LOW / LOW / INFO / INFO | **CONFIRMED, LOW (V47o-2)**, source order | none | Only `core-watch-suite.sh:16,26` names `VALIDATOR.lock` (grep over the tree). EXIT traps: `run-tests.sh:60-66` (`pkill -x solana-test-val`, `fuser -k 8999 9900`), `sim/run-sim.sh:31-32`, `sim/swap-fork.sh:21-22`, `build-mainnet.sh:25-26`, `e2e-localnet.sh:34`. Pin checked only at [2/7] (`run-tests.sh:105-107`); [3/7] builds; [4/7] calls `cleanup` (`:128`) and boots from the cache. `:193` echoes "...and the cache is the pinned mainnet build" without re-hashing. The lock holds a label and date, no pid (`core-watch-suite.sh:26`); restore runs only from `trap … EXIT` (`:38`). |
| C03 | GLM R47o-1; Qwen max F1; Sonnet F4; Fable F2; Muse Q4 (SPEC 22 and 53 stale against the rehearsal; 22.2 FAIL with no ruling; README road row drops the FAIL) | LOW / LOW / INFO / INFO / LOW | **CONFIRMED, LOW (V47o-3)** | none | SPEC `:1897` ("NOTHING HAS EVER RUN A DISTRIBUTION AGAINST A LIVE CHAIN"), `:1904` ("This must be exercised… before it pays anyone"), `:1912` ("passes or fails on these NAMED items"), `:2222-2223` ("has not yet run to its end on mainnet"), `:2681` (road 8 "done … 22.2 recorded FAIL"). `RECORD.md` (22.1 PASS at 5 vaults; 22.2 FAIL). README `:161` "done on mainnet 2026-10-09 to 10-10": `readme-facts.mjs:111-116` (`short()` cuts at the first `:`). |
| C04 | **The writing session's claim** (`readme-facts.mjs` counts untracked round directories; `--check` fails mid-audit) | (session) | **CONFIRMED, INFO (V47o-4)**, measured | none | `readme-facts.mjs:96-97` (`all` = every `round\d+` directory, tracked or not), `:80-81`; `run-tests.sh:420`. Live: `--check` exits 1 ("42 … rounds 5 to 46" vs "43 … rounds 5 to 47"). `.cache/487a8b4-suite.log` ends at that FATAL, RC=1, after "web offline 801/801" and before the 912-assertion arm. `.cache/d2ae5fc-suite.log` (13:52, before `audits/round47/` existed at ~14:37) passes the same check. Copy `rf/` (tracked round directories only): exit 0; plus an empty `audits/round47`: exit 1. |
| C05 | **triage** (`readme-facts.mjs` publishes "REQUIRES CHANGES: NONE" as changes owed) | - | **CONFIRMED, INFO (V47o-5)**, measured | none | `readme-facts.mjs:92` (`/^REQUIRES CHANGES: \S/m`, true for `NONE`), `:93`. Copy `rf/` with a NONE/NONE round 47: row `\| [47] \| LAUNCH-CLEAN \| LAUNCH-CLEAN \| yes, repairs not yet validated \|`. The comment `:89` says "one still owed says REQUIRES CHANGES". |
| C06 | Sonnet F3; Fable F3; Muse R0-1; Qwen 2.4T INFO-1 (the Core watch is outside the installer, its flock and its deadman) | INFO / INFO / LOW / INFO | **CONFIRMED, INFO (V47o-6)**, narrowed | none | `core-watch.mjs:12` ("cron, every 10 minutes"); `cron-install.sh` installs six jobs (`selftest.mjs:924`), none of them the watch. The box crontab carries a hand-added `*/10 … node scripts/core-watch.mjs` with no `flock` (read-only `crontab -l`), so Muse's "never runs" is false on this box. Promised in HOLDER-GUIDE `:187-188` ("Each time a new Core goes live, our whole test suite runs again") and README `:77-81`. No deadman reads `.cache/core-watch/`. |
| C07 | GLM R47o-3 (a second Core change orphans the first suite's result) | INFO | **CONFIRMED, INFO (V47o-7)** | none | `core-watch.mjs:173` (`suiteStatus(live.hash)` only), `:78` (the URGENT email promises "its result follows by email"), `:82`. The N1 result file is never read once live is N2. |
| C08 | Fable F5 (the offline mock RPC answers no `getTokenAccountsByOwner`) | INFO (question) | **CONFIRMED, INFO (V47o-8)**, measured | none | `reads.mjs:131` (two `getTokenAccountsByOwner`); `mock-rpc.mjs:122-133` (serves token listings only through `getProgramAccounts`), `:188` (`default: throw … not implemented`), `:11-15,129-131` (the MOCK_ADVERSARY harness fires only inside `getProgramAccounts`). `mock/probe.mjs`, the V40-1 reader path of `plan.test.mjs:548-577` against the plain mock: `unlistedPrograms: ["token","token2022"]`, plan ack `["unlisted:all"]`. The listing is gated on a validator by `e2e-localnet.mjs:275-317` (152/152 at `487a8b4`). |
| C09 | Sonnet F5 (a clean clone cannot follow README's "Reproducing the tests") | INFO | **CONFIRMED, INFO (V47o-9)**, source | none | README `:200-206` (run-tests first, build-mainnet last); `.gitignore:7` (`dist/`); `ids.test.mjs:73,81-82` (reads `dist/SHA256SUMS` unguarded; requires `MANIFEST` commit = `RELEASE_COMMIT` `d2ae5fc`); `run-tests.sh:414-415` (web offline is a hard gate); `build-mainnet.sh:100` (`COMMIT=$(git rev-parse HEAD)`), `:153-154` (needs `target/deploy` from run-tests). At HEAD, build-mainnet writes `487a8b4` into `MANIFEST`, so `ids.test` stays red. V46o-4's class. |
| C10 | Muse R5-1 (the judge does not pin Meteora `host_fee_in`; a builder defect pays a host fee) | MEDIUM, (b) | **ALREADY STATED** (limit 10(c); round 36 C12, round 38 C12, round 43 C14, round 44 C29); MEDIUM and (b) not supported | none | `swap.mjs:248` (builder sets None), `:331-401` (the judge pins what its docblock `:296-324` lists: "the venue program validates its pool-owned liquidity accounts"; it claims nothing about key 9). Muse's own text: "a cut of the protocol fee… well inside the 150 bps floor". The on-chain `min_amount_out` (`:386`) and the post-swap delta check bound our output. Reaching key 9 needs a changed builder in this tree, which is limit 10(c)'s accepted residue. |
| C11 | Longcat LOW-1 (SPEC 53 still calls the `d57ee3a` proof stale) | LOW | **DISPROVED** (repaired by V46-7) | none | SPEC `:2216-2221` ("Round 46 (V46-7): it was re-run at `e7c192a` … so staleness is no longer what keeps this item open"). |
| C12 | MiMo LOW-1 (an `'other'` asset ends the reveal run for every vault behind it) | LOW | **DISPROVED as a defect; mechanism accurate** (design, round 24 L2 / round 43 V43o-3) | none | `crank.mjs:755` (logs "skip reveal #N … next pass", then `break`); MINT's `RevealOutOfOrder` refuses any reveal behind it (MiMo concedes this), so `continue` would only spend fees on refusals. Pinned by the V43o-3 arm (`selftest.mjs:4231`); a lasting stall pages `reveal_queue_stalled`. |
| C13 | MiMo observation (`detectUnsweptRoyalties` ages on the box clock) | (obs.) | **NOT A DEFECT** | none | `detectors.mjs:2212-2222`: a 24-hour-plus grace; box drift of minutes is immaterial; `sweep_unledgered_state` is chain-derived. |
| C14 | Fable F6 (`NoActiveVaults` is not in `DISTRIBUTE_RACE`) | INFO | **NOT A DEFECT** (round 31 C20; round 23 L3) | none | `crank.mjs:156`; MINT `:1605-1607`. Its stated path cannot produce the code: joins make `total_active_weight > 0`, which leaves the `w == 0` branch. The real path (every waiting vault retired inside one round trip) pages once, loud, one fee, with no value effect. |
| C15 | Fable F4 (the verdict regex drops the quorum clause; two README sentences compress holder rules) | INFO | **NOT A DEFECT** | none | `readme-facts.mjs:87`. The three allowed first lines never put `LAUNCH-CLEAN` before `QUORUM NOT MET`, and "NOT LAUNCH-CLEAN" renders true. README `:21-22` matches HOLDER-GUIDE `:13-15` ("activated: it joins the payouts"). README `:52` names the rescue by its purpose; the two-step return is HOLDER-GUIDE `:191-193` and limit 58. Recommended: carry "at the next distribution" and "via the multisig". |
| C16 | Qwen max F2 (`core-watch.mjs` takes no lock; two ticks could overlap) | INFO | **NOT A DEFECT** | none | The worst-case tick is bounded by its timeouts: 2 URLs × 2 reads × 30 s, plus 20 s and 20 s, plus at most 3 emails × 60 s (`core-watch.mjs:125,153,158,191`), about 340 s, under the 600 s period. A duplicate suite start exits on the noclobber `running-$H` marker (`core-watch-suite.sh:21`). |
| C17 | Qwen max F3 (README prose is not machine-checked) | INFO | **NOT A DEFECT** | none | Nothing claims it is. `readme-facts.mjs:6-9` scopes the check to the marked block. |
| C18 | Muse (item 53 "stale again" at `d2ae5fc`); Fable F2's in-tree-run half | INFO | **NOT A DEFECT** | none | SPEC `:2221-2222` keeps item 53 OPEN for exactly this ("every repair commit needs the same in-tree run again"). Stripping changes bytes, not source, and `release_gate` compares source under the map. |
| C19 | Fable F1 (iv) (the diagnostic runner hard-codes `'35/35 as predicted'`) | (part of F1) | **DISPROVED as a defect today; mechanism accurate, latent** | none | `core-watch-suite.sh:49` against `run-tests.sh:243,448` (`MAINNET_FLOOR=35`). It is equal today. A future floor move would make every diagnostic FAILED. Recommended with V47o-2's repair: derive the literal from `MAINNET_FLOOR`. |
| C20 | Every counted seat (round 46's disproofs re-tested: C08 flags, C09 `ls-files`, DeepSeek's `meteoraSpot`) | (agree) | **STILL DISPROVED**; round 43 gate-5 item 5 still open | none | `swap.mjs` unchanged since `63a92b2`; `:223` inversion; `:428` `bitmapExists: !!bm`. Fork 16/16 at `d2ae5fc`. |
| C21 | GLM R47o-4; Muse; Qwen 2.4T; Qwen max V46o-5 (files this pass does not carry) | INFO / - | **NO CLAIM** | none | The prompt names all 22 (`prompt :21`). The workflow rides in the programs pass (`audit47.ts:172`). |
| C22 | Qwen 2.4T INFO-2 sub-claim ("fail-closed: run-tests.sh re-hashes the cache"); Qwen max ("they can't overlap") | - | **DISPROVED** (folded into V47o-2) | none | The re-hash is only at `run-tests.sh:105-107`, before the [3/7] build. Every runner's EXIT trap kills any validator. |
| C23 | Limit and wording notes: GLM (the sweep helper's walk); Fable (`CBOB_ALARM_REHEARSAL` not gated, the 22.2 waiver); Sonnet and Muse (limit 25; `!!bm`) | (obs.) | **ALREADY STATED / recommendations** | none | Round 45's `rehearsalOnly` recommendation; limit 25; round 43 gate-5 item 5. |
| C24 | Longcat, Muse, Qwen 2.4T (extraction bound per month: 3.6, ~18, "bounded" SOL) | (obs.) | **ALREADY STATED** (limit 10) | none | Cap × windows. The figures differ only in their assumed cadence. |
| C25 | Every counted seat (round 46's repairs V46o-1 to V46o-5 hold) | (agree) | **AGREE**, independently measured | none | See the re-check below. V46o-1 under mutation: `m1/probe.mjs`. |

## Confirmed findings

| ID | Severity | Independent disposition and minimal repair |
|---|---|---|
| **V47o-1**: Sonnet F1 | **LOW** | **The Core watch never reports a PASS, and re-runs the whole suite on every tick until a re-pin.**<br><br>**The mechanism.**<br>• `core-watch-suite.sh:57`: when `.cache/suite.log` has no failing line, `grep -c` prints `0` and exits 1, and `\|\| echo 0` prints a second `0`.<br>• `FAILS` is `"0\n0"`, and `res()` (`:19`) embeds it raw in `"summary":"…"`.<br>• `core-watch.mjs:164` swallows the `JSON.parse` error and returns `undefined`.<br>• `decide()` then takes `if (!suite)` (`:81`) and emits `suite` again. The trap has already removed `running-$H` (`:36`), so a fresh full suite starts (`:183-187`).<br><br>**Measured** (scratch `cw/`, the exact lines):<br>• a passing log → `JSON.parse THROWS`; a log with an `XX` line parses; a build failure with no `XX` line → THROWS;<br>• `decide()` on the passing result emits `suite` on 4 of 4 ticks and never sets `resultSentAt`;<br>• control: valid JSON → one "PASSED" email.<br><br>**What it costs.**<br>• The PASS that should prompt a deliberate re-pin never arrives.<br>• A Core whose suite dies before any assertion (a boot or deploy failure) never sends the URGENT FAILED email.<br>• While the loop runs, the shared cache holds the new Core most of the time, so every certifying `run-tests.sh` dies at its pin check (V47o-2).<br>• The initial URGENT "Core changed" email (`:76-78`) and the alarm's `prog.core.hash` CRITICAL drift still fire.<br><br>**Severity and class.** **LOW**: a monitor that cannot deliver its own result, round 37's precedent. Nothing moves value. **Class: none.**<br><br>**Repair (`scripts/core-watch-suite.sh`).** `FAILS=$(grep -c … \|\| true)` with a numeric default. Build the JSON with `node -e`/`JSON.stringify`, not `printf`. Make `core-watch.mjs` treat an unparseable result file as "unknown, do not restart", and page once. Gate-5 item 1. |
| **V47o-2**: Sonnet F2; GLM R47o-2; Fable F1; Muse R0-2; Qwen 2.4T INFO-2 | **LOW** | **The diagnostic suite's validator lock is private, so the watch and every other runner can kill or mislead each other.**<br><br>**The construct.** Only `core-watch-suite.sh` reads or writes `.cache/VALIDATOR.lock`. Every other runner kills any `solana-test-val` and frees 8999/9900 in an EXIT trap: `run-tests.sh:60-66`, `run-sim.sh:31-32`, `swap-fork.sh:21-22`, `build-mainnet.sh:25-26`, `e2e-localnet.sh:34`.<br><br>**Three consequences, from source order.**<br>(i) A `run-tests.sh` started while a diagnostic runs dies at its [2/7] pin check (the cache is the new Core). Its EXIT trap then kills the diagnostic's validator. The diagnostic ends `rc ≠ 0`, and the next tick emails **URGENT "FAILED … Do not move any CBOB program toward lock"** for a Core that may be fine. The same happens from `build-mainnet.sh`, the sim, the fork or the e2e.<br>(ii) A `run-tests.sh` that passed [2/7] can have the cache swapped under it during its [3/7] build. [4/7] boots whatever the cache holds, and `:193` prints "...and the cache is the pinned mainnet build" without re-hashing. That line is an assertion nothing checks. In most interleavings the diagnostic's own EXIT trap later kills that validator (fail-closed), but the certifying log already carries a false line.<br>(iii) A SIGKILL, OOM or reboot skips `trap restore EXIT` (`:38`). It leaves the cache off-pin (fail-closed), a pid-less lock that no rule breaks, and `running-$H`. Every later diagnostic waits 12 h and writes rc 4, which is emailed as URGENT FAILED.<br><br>**Severity and class.** **LOW** (three seats). It produces false URGENT pages in exactly the window when an URGENT must be believed, plus one unverified certifying-log line. No value path. **Class: none.**<br><br>**Repair.** One shared `flock` on `.cache/VALIDATOR.lock` taken by every runner, with the pid in the lock. Re-hash the cache against the pin immediately before the boot at [4/7], so `:193` becomes a check. Let the diagnostic boot its Core from its own path instead of swapping the shared file. Gate-5 item 2. |
| **V47o-3**: GLM R47o-1; Qwen max F1; Sonnet F4; Fable F2; Muse Q4 | **LOW** | **SPEC and the README do not state what the dress rehearsal established.**<br><br>**SPEC.**<br>• Item 22's lede still says nothing has ever run a distribution on a live chain (`:1897`), though 22.1 passed on mainnet.<br>• Item 53's keep-open reason says the rehearsal "has not yet run to its end on mainnet" (`:2222-2223`), while road step 8 says "done" (`:2681`).<br>• Item 22 says the rehearsal "passes or fails on these NAMED items" (`:1912`). 22.2 is recorded FAIL, and no ruling says what that FAIL means for the gate. The record itself says what it does not prove: "a pass 2 with nothing to report".<br><br>**README.** The generated public road row (`README.md:161`) reads "done on mainnet 2026-10-09 to 10-10", because `short()` cuts at the first colon (`readme-facts.mjs:113`). So the front page drops "22.2 recorded FAIL".<br><br>**Severity and class.** **LOW**. Graded above round 46's V46-7 (INFO), because this is not one stale sentence: an OPEN AND BLOCKING item carries an unruled FAIL while the public page says "done". It misstates nothing about holders' money or what the programs do. **Class: none.**<br><br>**Repair.** Restate items 22 and 53 as what remains (2,100-vault scale; the in-tree run at the release commit). Record Gary's ruling on 22.2, or a re-baselined clean pass 2. Make the road row carry the FAIL. Text, plus a readme-facts change. |
| **V47o-4**: the writing session's claim | **INFO** | **The README facts check is red whenever an audit round's output is untracked, which is every audit in progress.**<br><br>**The construct.** `readme-facts.mjs:96` counts every `audits/roundN` directory on disk, and `:80-81` adds any round whose `VERDICT-programs.md` exists, tracked or not. `run-tests.sh:420` dies on a stale block in step [6/7], before the 912-assertion arm.<br><br>**Measured.**<br>• Live `--check` exit 1.<br>• `.cache/487a8b4-suite.log` ends there (RC 1); `d2ae5fc`'s run, made before the directory existed, passed the check.<br>• Copy `rf/`: exit 0 on tracked directories, exit 1 with an empty untracked `audits/round47`.<br><br>**Effect.** The certifying run of the audited commit cannot complete during its own audit. A `--write` during an audit would commit a README naming a round that does not exist in git.<br><br>**Severity and class.** **INFO**: fails closed, hides nothing. The class of V44o-4, V45o-5 and V46o-4 (a gate red in a legitimate configuration). Not a no-change item, because it needs a code change. **Class: none.**<br><br>**Repair.** Count and read only tracked rounds (`git ls-files audits/`), or exclude a round with no committed verdict. Gate-5 item 4. |
| **V47o-5**: triage | **INFO** | **The README would publish a NONE round as "yes, repairs not yet validated".**<br><br>**The construct.** `readme-facts.mjs:92` tests `/^REQUIRES CHANGES: \S/m`, which `NONE` satisfies. Its own comment (`:89`) says only a round "still owed" should read that way.<br><br>**Measured** (copy `rf/`, hypothetical round 47 with both verdicts `REQUIRES CHANGES: NONE`): the row reads `yes, repairs not yet validated`.<br><br>**Effect.** The public front page would misstate the one result the launch gate needs. It under-claims, so the error is in the safe direction. No round has reached NONE yet, so nothing false is published today.<br><br>**Severity and class.** **INFO.** **Class: none.**<br><br>**Repair.** `/^REQUIRES CHANGES: (?!NONE\b)\S/m`, plus an arm. Gate-5 item 5. |
| **V47o-6**: Sonnet F3; Fable F3; Muse R0-1; Qwen 2.4T INFO-1 | **INFO** | **The Core watch HOLDER-GUIDE promises is installed by hand, with no flock and no deadman.**<br><br>**The construct.**<br>• `cron-install.sh` installs exactly six jobs, and the selftest pins that set (`selftest.mjs:924`).<br>• The watch runs on this box from a hand-added crontab line without `flock`.<br>• A box rebuilt from the tree loses it silently, and no detector notices if it stops.<br><br>**The promise.** HOLDER-GUIDE `:187-188` and README `:77-81` promise its behaviour.<br><br>**Effect.** Detection itself survives through the alarm's `prog.core.hash` CRITICAL drift and its deadman. What is lost is only the automatic diagnosis.<br><br>**Severity and class.** **INFO.** **Class: none.**<br><br>**Repair.** A tagged `flock -n` line in `cron-install.sh` (seven jobs, the selftest moved with it), and a staleness deadman on `.cache/core-watch/state.json` `lastReadAt`. Gate-5 item 6. |
| **V47o-7**: GLM R47o-3 | **INFO** | **A second Core change before the first suite ends drops the first result.** `core-watch.mjs:173` reads only `suite-<live hash>.json`. The first URGENT email promised "its result follows by email" (`:78`), and that result is never read once live has moved. The newer bytes are still measured. **Class: none.**<br><br>**Repair.** Also read the previous hash's unsent result, or have the suite script email its own result. Gate-5 item 7. |
| **V47o-8**: Fable F5 | **INFO** | **The offline mock RPC no longer models the page's stray listing.**<br><br>**The construct.** Since `708af02`, `vaultWalletAccounts` lists with `getTokenAccountsByOwner` (`reads.mjs:131`). `mock-rpc.mjs` serves token listings only through `getProgramAccounts` (`:122-133`) and throws on any other method (`:188`).<br><br>**Measured.** Every offline arm that reads through the mock (the V40-1 block, `plan.test.mjs:548-577`) now runs with both listings refused and an `unlisted:all` box in both the plain and the dusted plan (`mock/probe.mjs`). The V40-1 property still holds, because reserves are read by address. But the mock's documented token reads and its MOCK_ADVERSARY harness (`:11-15,129-131`) can no longer fire.<br><br>**Coverage elsewhere.** The listing itself is gated on a validator (`e2e-localnet.mjs:275-317`, 152/152 at `487a8b4`), so no property is ungated. That is why this is INFO, not the round 37 LOW.<br><br>**Class: none.**<br><br>**Repair.** Serve `getTokenAccountsByOwner` from the same data (with `dataSlice`), move the adversary hook there, and assert the V40-1 plans carry no `unlisted` box. Gate-5 item 8. |
| **V47o-9**: Sonnet F5 | **INFO** | **README's "Reproducing the tests" does not reproduce from a clean clone.**<br><br>**The construct.**<br>• `dist/` is gitignored (`.gitignore:7`).<br>• `ids.test.mjs:73,81-82` reads `dist/SHA256SUMS` unguarded and requires `dist/` to be a clean build of `d2ae5fc`.<br>• Web offline is a hard gate in `run-tests.sh` (`:414-415`).<br>• `build-mainnet.sh` needs `target/deploy` from `run-tests.sh` (`:153-154`), and it stamps HEAD (`:100`). At HEAD that is `487a8b4`, not `d2ae5fc`.<br><br>**Effect.** The order README gives (`:200-206`) fails at the first command, and building `dist/` at HEAD keeps it failing.<br><br>**Severity and class.** **INFO**: V46o-4's class, a gate that needs an untracked artefact. README `:194-195` says the runners were written for the Bank's machine, but not this. **Class: none.**<br><br>**Repair.** State the bootstrap (build `dist/` from the release commit first), or have the web suite stop with a named reason when `dist/` is absent. |

### The documentation exception (SPEC gate 3, ruling of 2026-10-07)

- V47o-1, V47o-2, V47o-4, V47o-5, V47o-6, V47o-7 and V47o-8 change scripts, fixtures or the installer. **Not eligible.**
- V47o-3 and V47o-9 are text. V47o-3's README half needs a generator change, and its 22.2 half needs a ruling. Even if both were eligible, they could not make this a no-change round while the others stand.

## Rounds 42 to 46 re-check, per confirmed finding

I re-read each verdict's mechanism and classified each finding again against `487a8b4`. The programs are byte-identical to the release every one of these rounds judged (`0b3ddb3` source; the `d2ae5fc` build strips it). Round 46's off-chain repairs were re-verified at their sites:
- **V46o-1:** the arm is red under the asset-guard mutant (`m1/probe.mjs`: unmutated `["CRITICAL",false]`, m1 `["INFO",true]`).
- **V46o-2:** `alarm.mjs:867-868` restores both fields, and the extracting arm passes in 1072/1072.
- **V46o-3:** `rehearsal-env.mjs:57-70`, called at `revenue.mjs:65` and `alarm.mjs:69` before any `rehearsalOnly` read.
- **V46o-4:** six tracked fixture files; `ceremony.test` 159/159.
- **V46o-5:** the prompt `:21`.

| Finding | Severity | (a) programs | (b) value | (c) crack | (d) H/M | Outside (a)-(d)? |
|---|---|---|---|---|---|---|
| R42 **V42-1** a malformed path killed the local ceremony server | INFO | No | No | No | No | **Yes** |
| R42 **V42-2** an earlier transaction could hide the collection create | INFO | No | No | No | No | **Yes** |
| R42o **C01** omitted vaults lost their reserve baseline after a shrunk pass | LOW | No (`alarm.mjs`) | No (detection) | No | No | **Yes** |
| R43 **V43-1** a host's owner keeps a nested vault by Executing it out in their own opening | LOW | No defect against the ruled design (SPEC limit 58; the repair is the crank's every-pass rescue) | No (the owner takes from their own vault's wallet in their own crack) | No | No | **Yes** |
| R43 **V43-2** the e2e header described the old rescue rule | INFO | No | No | No | No | **Yes** |
| R43o **V43o-1** the release check died in the rehearsal tree | LOW | No (`run-tests.sh`) | No | No | No | **Yes** |
| R43o **V43o-2** one unreadable signature froze a scan | LOW | No (`alarm.mjs`) | No (detection) | No | No | **Yes** |
| R43o **V43o-3** the reveal-skip arm could not fail | LOW | No (`selftest.mjs`) | No | No | No | **Yes**. The design it pins is C12 here |
| R44 **V44-1** the rehearsal ceremony could not consume the value file | LOW | No | No | No | No | **Yes** |
| R44 **V44-2** `release_gate` accepted any reversible swap and ignored untracked files | LOW | No (`run-tests.sh`) | No | No | No | **Yes** |
| R44 **V44-3** the coverage gate could not credit LAUNCH-CLEAN | LOW | No | No | No | No | **Yes** |
| R44 **V44-4** RULED missing from the status legend | INFO | No | No | No | No | **Yes** |
| R44 **V44-5** limit 59 cited the test validator's rent | INFO | No | No | No | No | **Yes** |
| R44 **V44-6** "the one exception" omitted the bare burn | INFO | No (programs credit as SPEC states) | No | No | No | **Yes** |
| R44 **V44-7** an absent pinned collection shown as BROKEN | INFO | No (ceremony page) | No | No | No | **Yes** |
| R44o **V44o-1** the poster's skip never fired while a backlog drained | LOW | No (drafts only) | No | No | No | **Yes** |
| R44o **V44o-2** the split-recovery scan died on one refused signature | LOW | No (`revenue.mjs`) | No (the job stops; balances stay) | No | No | **Yes** |
| R44o **V44o-3** a null SEAL read dropped reserve baselines | LOW | No (`alarm.mjs`) | No (detection) | No | No | **Yes** |
| R44o **V44o-4** the no-network runner exited 1 | INFO | No | No | No | No | **Yes** |
| R44o **V44o-5** the rehearsal runbook did not cover the off-chain jobs | INFO | No | No | No | No | **Yes** |
| R45 **V45-1** item-22 predicates could pass without their evidence | LOW | No (driver) | No | No | No | **Yes** |
| R45 **V45-2** `--rpc box` put the key in argv | LOW | No (driver) | No | No | No | **Yes** |
| R45 **V45-3** deploy key not tied to the judged id | LOW | No (driver) | No | No | No | **Yes** |
| R45 **V45-4** rescue bricked on a lost confirmation | LOW | No (driver) | No | No | No | **Yes** |
| R45 **V45-5** cycle 1 judged by venue order | LOW | No (driver) | No | No | No | **Yes** |
| R45 **V45-6** the init window was not "at once" | INFO | No | No | No | No | **Yes** |
| R45 **V45-7** `'box'` as DAS URL; sweep-back scope | INFO | No | No | No | No | **Yes** |
| R45 **V45-8** 22.1 PASS at 5 vaults | INFO | No | No | No | No | **Yes**. The rehearsal recorded exactly this (V47o-3) |
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
| R46 **V46-2** rehearsal values could expire before road step 10 | LOW | No (driver) | No | No | No | **Yes** |
| R46 **V46-3** the rescue step could nest twice on resume | INFO | No (driver) | No | No | No | **Yes** |
| R46 **V46-4** hand recovery after a landed swap | INFO | No (driver) | No (rehearsal funds, recovered by hand) | No | No | **Yes** |
| R46 **V46-5** `mainnet-local` accepted overrides | LOW | No (web build) | No | No | No | **Yes** |
| R46 **V46-6** refused values did not end the ceremony preflight | INFO | No (ceremony page) | No | No | No | **Yes** |
| R46 **V46-7** SPEC 53 stale-proof sentence | INFO | No | No | No | No | **Yes**. Repaired (C11) |
| R46 **V46-8** the seed-7 init key could not pay on mainnet | LOW | No (rehearsal values and driver; the ruled mainnet key is Gary's wallet) | No | No | No | **Yes**. Off-chain site repaired (`check-launch-params.mjs:188,209-210`; launch 69/69) |
| R46o **V46o-1** the asset-less ack arm could not fail | LOW | No (`selftest.mjs`) | No | No | No | **Yes**. Repaired, measured red under m1 |
| R46o **V46o-2** an undelivered pass kept its unreadable counts | INFO | No (`alarm.mjs`) | No (detection) | No | No | **Yes**. Repaired |
| R46o **V46o-3** the load-time refusal paged nothing | INFO | No | No | No | No | **Yes**. Repaired |
| R46o **V46o-4** the web suite needed the untracked placeholder | INFO | No | No | No | No | **Yes**. Repaired. Its class recurs as V47o-9 |
| R46o **V46o-5** the prompt's bundle claims | INFO | No (audit script) | No | No | No | **Yes**. Repaired |

**All fifty-one are outside (a)-(d).** Round 46's off-chain repairs hold at every site I checked. Round 47's new defects are all in code and text written after round 46: the Core watch, the README and its generator, and SPEC's rehearsal items. One is in the offline mock, made stale by the post-46 listing change.

## Gate-5 obligations

SPEC ship gate 4 requires every accepted finding to have a gate that fails the build in both directions. Gate 5 requires every measurable rejected finding to become an assertion. These are obligations, not findings.

1. **V47o-1:** an arm that runs the suite script's result writer (lines 56-58, extracted) on a passing log, a failing log with an `XX` line and a failing log without one. It `JSON.parse`s each and drives `decide()` to one PASSED and two FAILED emails. Shown red at `487a8b4` (measured: the pass case throws and `decide()` restarts the suite).
2. **V47o-2:**
   - a selftest scan that every validator runner takes the shared lock;
   - a both-ways stale-lock arm (dead pid broken, live pid waited);
   - a run-tests arm that the cache is re-hashed after the build and before the boot;
   - the diagnostic's probe literal derived from `MAINNET_FLOOR` (C19).
3. **V47o-3:** none beyond the text, the ruling and the road row. Recommended: a readme-facts arm that a road cell containing `FAIL` keeps it.
4. **V47o-4:** in a copy, an untracked `audits/roundN` directory (empty, and with a verdict) leaves `--check` green. Shown red at `487a8b4` (measured).
5. **V47o-5:** a NONE/NONE verdict renders `none`; a `REQUIRES CHANGES: V…` verdict renders "not yet validated". Shown red at `487a8b4` (measured).
6. **V47o-6:** the installer's job list includes the watch, under `flock -n`, and a deadman fires on a stale `lastReadAt` (both ways).
7. **V47o-7:** `decide()` with live N2 and an unsent `done` result for N1 emails N1's result once.
8. **V47o-8:** the mock answers `getTokenAccountsByOwner`, and the V40-1 plans carry no `unlisted` box. Shown red today (measured `["unlisted:all"]`).
9. **V47o-9:** none, if README states the bootstrap. Otherwise, a web-suite arm that `dist/` absent stops with a named reason.
10. **Measurable rejections:**
    - **C10:** pin Meteora key 9 to the program id in the judge (recommended since round 38; still not an obligation).
    - **C12:** already pinned (`selftest.mjs:4231`).
    - **C16:** none.
11. **Carried, still OPEN:**
    - round 43's gate-5 items 4 and 5 (`swap.mjs:428` still `!!bm`);
    - round 44's item 6;
    - item 22.5's DAS read (the rehearsal records PASS; SPEC should say so under V47o-3);
    - round 46's recommendations: C08 and C09 arms, C10 release-wallet outflow watch, `CBOB_ALARM_REHEARSAL` through `rehearsalOnly`.
    - **Round 46's off-chain gate-5 items 1-5 are DISCHARGED:** V46o-1 (measured red under m1), V46o-2, V46o-3, V46o-4 and V46o-5, all in today's 1072/1072 and 801/801, or visible in the prompt.

## Independent measurements

All artefacts are in `/tmp/claude-1000/triage47o/`.

| Measurement | Result | Evidence |
|---|---|---|
| Detector selftest, live tree | **1072/1072**, exit 0 | `det.log`, `rc.txt` |
| Web offline (`run-all.mjs`), live tree | **801/801** in 11 files at their floors, exit 0 | `web.log` |
| Launch / poster / allocation selftests, live tree | **69/69**, **24/24**, **39/39**, exit 0 each | `launch.log`, `poster.log`, `accrual.log` |
| Core watch `--selftest` (read-only: `decide()` and `readPin()` only, then exit; no email, no suite) | **18/18**, exit 0. It never exercises the shell's result writer (V47o-1) | `corewatch.log` |
| V47o-1, result writer and `decide()` | pass → JSON.parse throws; fail-with-XX parses; build-fail throws; `decide()` → `suite` on 4/4 ticks, no result email; control → PASSED | `cw/f1.sh`, `cw/probe.mjs` (`core-watch.mjs` copied without its 3 dispatch lines, so nothing reads the network or spawns) |
| V47o-4 / V47o-5, readme-facts | live `--check` exit 1; copy with tracked round directories exit 0, plus an empty `round47` exit 1; NONE/NONE row "yes, repairs not yet validated" | `rf/` (tracked files only) |
| V47o-8, mock listing | `unlistedPrograms ["token","token2022"]`, ack `["unlisted:all"]` | `mock/probe.mjs` (mock on 127.0.0.1:8983, killed after) |
| V46o-1 repair, mutant | unmutated `["CRITICAL",false]`; asset guard removed `["INFO",true]` | `m1/probe.mjs` |
| Canonical runs, read | `d2ae5fc` suite RC 0 (912/912, 1072, 801, fork 16/16, README current); `d2ae5fc` and `487a8b4` e2e 152/152 RC 0 and sim 71/71 RC 0; `487a8b4` suite RC 1 at the README check | `.cache/{d2ae5fc,487a8b4}-*.log` |
| The prompt | 1,955,866 chars, equal to every manifest | `/tmp/v47tro-prompt-offchain.txt`, `prompt.txt` |
| Trees | HEAD = audited head; programs = `0b3ddb3`; `bank`, `sim`, `tests`, `launch`, `run-tests.sh` = `d2ae5fc`; `git status` unchanged by this triage | `git diff --quiet` (session) |

## Measurement limits

- **Nothing live was run.** I ran no validator, `run-tests.sh`, sim, fork, e2e, crank, alarm pass, revenue job or router delivery. I ran no `core-watch.mjs` tick and no `core-watch-suite.sh`. Nothing money-moving or notifying ran. I did not open `.cache/core-watch/`, `dist/` or `audits/round47/VERDICT-programs.md`.
- **V47o-1** was measured on the exact lines in a scratch copy, not on a real diagnostic run. No real diagnostic has run since the watch existed, so `.cache/core-watch/` holds no measured instance.
- **V47o-2** is source order. Its interleavings need two concurrent validator runs, which the brief forbids. (i) and (iii) are deterministic from the traps. (ii) depends on timing.
- **V47o-6:** I read the box crontab with `crontab -l` only. It also carries a hand-written CBOB block that `cron-install.sh` did not write: an unflocked `bank/alarm.mjs`, a dry `bank/revenue.mjs`, and a `bank/distribute.mjs` line whose file no longer exists. That is host state outside the audited tree, not a finding of this pass, recorded so it is not mistaken for the installer's output.
- **C10** relies on Meteora's host fee being a share of its protocol fee, as the reporter itself states and rounds 33-44 recorded. I did not re-read DLMM source; the box has none vendored.
- **Seat decisions are judgments.** Quorum is 7 of 8, so even excluding one more seat (Qwen max, whose errors are peripheral) leaves 6. Longcat's exclusion is clear-cut.
- **What no measurement here shows:** whether the next Core change is diagnosed and reported end to end, whether the router delivers at 3 am, whether a person acts on a page, and anything at 2,100 vaults.

## Remaining requirements

- **Before the next confirmation round:** V47o-1, V47o-2, V47o-4, V47o-5, V47o-6, V47o-7 and V47o-8 with gate-5 arms 1-8, each shown red at `487a8b4`. Then V47o-3 (text, road row and Gary's ruling on 22.2) and V47o-9 (text).
- **Not in this list:** none of these touches `bank/`, the programs or the pages, so the money paths are unchanged. They still change the tree, so the next round confirms a changed tree.
- **Unchanged:**
  - Items 22, 38, 50, 52 and 53 remain OPEN AND BLOCKING.
  - `charter_opens_at`, `lock_deadline` and `vault_collection` remain OPEN in `launch/mainnet-init.json`.
  - No deployment, initialization, lock, ceremony, cron installation, rehearsal or publication follows from this audit.

**Result: QUORUM MET (7 counted of 8; six required; three same-prompt re-runs, each verified against the first run's head and prompt size). LAUNCH-CLEAN under SPEC gate 3's launch gate: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 3 LOW, 6 INFO.**
- **LOW:** V47o-1 the Core watch never reports a PASS; V47o-2 the private validator lock; V47o-3 the rehearsal outcome missing from SPEC and README.
- **INFO:** V47o-4 untracked round directories fail the README check; V47o-5 NONE published as changes owed; V47o-6 the Core watch outside the installer; V47o-7 an orphaned suite result; V47o-8 the stale mock; V47o-9 the reproduce order.

Nothing is in the five programs, no value path, no refused crack. **REQUIRES CHANGES: not a no-change round.**

---

## Reply (under 300 words)

**Round 47, off-chain pass: LAUNCH-CLEAN; QUORUM MET. REQUIRES CHANGES: V47o-1 to V47o-9.**

**Seats counted: 7 of 8 (6 needed):**
- first runs: Sonnet 5.5, GLM 5.3, Fable 5.1, Qwen max;
- re-runs (same head and prompt): Muse, Qwen 2.4T, MiMo.

**Not counted:** Longcat. Its only finding is round 46's already-repaired SPEC sentence, and it invents a `nestedSent` flag in the crank.

**Confirmed, all outside (a)-(d):**
- **V47o-1, LOW (Core watch):** a passing diagnostic suite writes invalid JSON (`"0\n0"`), so no PASS email is sent and the suite restarts every tick. A failure with no `XX` line never sends FAILED. Measured.
- **V47o-2, LOW (runners):** the watch's validator lock is honoured by nothing else. Any runner's EXIT trap kills the diagnostic and triggers a false URGENT FAILED, and `run-tests.sh:193` asserts "pinned" unchecked.
- **V47o-3, LOW (SPEC/README):** items 22 and 53 are stale against the rehearsal, 22.2's FAIL has no ruling, and the README road row reads "done".
- **V47o-4, INFO (session claim):** readme-facts counts untracked round directories, so `run-tests.sh` stops mid-audit. Measured.
- **V47o-5, INFO (triage):** readme-facts would publish "REQUIRES CHANGES: NONE" as "yes, repairs not yet validated". Measured.
- **V47o-6, INFO:** the Core watch is hand-installed, with no flock and no deadman.
- **V47o-7, INFO:** a second Core change drops the first result.
- **V47o-8, INFO:** the offline mock lacks `getTokenAccountsByOwner`. Measured.
- **V47o-9, INFO:** README's reproduce order fails on a clean clone.

**Disproved or already stated:**
- Muse's MEDIUM (`host_fee_in`: limit 10(c), settled since round 36);
- MiMo's reveal-run LOW (design);
- Fable's `NoActiveVaults` race (round 31);
- Longcat's stale-SPEC LOW (repaired).

**Rounds 42-46:** all 51 confirmed findings remain outside (a)-(d). Round 46's off-chain repairs hold; V46o-1's arm is red under its mutant.

**Selftests:** 1072, 801, 69, 24, 39 and core-watch 18, all green.
