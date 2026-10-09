# Round 45, PROGRAMS pass: LAUNCH-CLEAN; QUORUM MET

**Independent triage verdict against audited head `0d58d4efc9e18878a256de6271731d9f7d43a88c` (`0d58d4e`). HEAD is `0d58d4e`. The working tree is clean apart from untracked `audits/round45/` (this pass's reports and manifests, and the off-chain pass's reports, which another session is writing now), the `.cache` symlink and `cache-keypairs-backup-20261008.tar.gz`. The programs equal `RELEASE_COMMIT` `0b3ddb3` (`git diff --quiet 0b3ddb3 0d58d4e -- programs Cargo.toml Cargo.lock` exits 0), so the program bytes are the ones rounds 41-44 audited. Eight seats were requested. GLM 5.3 and MiMo v2.6 hit provider output limits on the first run (`finish: length`). Both were re-run at the same head with the same prompt size, and their cut-off first outputs in `failed/` are not counted. I count six of the eight against a required six. Quorum is met with no margin, and it depends on counting two seats narrowly (Qwen max-0902 and MiMo; reasons below).**

**Eleven findings are confirmed: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 5 LOW, 6 INFO.** Every one is in the new box-signed dress-rehearsal driver or its SPEC text. None is in the five programs. None moves value out of a vault, the pool or the revenue address. None credits value wrongly, none stops or wrongly refuses a crack, and none is HIGH or MEDIUM. Under SPEC ship gate 3's launch gate (RULING, Gary 2026-10-08), the pass is **LAUNCH-CLEAN**.

**Three of the LOWs bear on running the driver on mainnet, and should be repaired before road step 8.**
- **V45-3:** the driver signs every deploy with the upgrade authority of the five REAL program ids. It never checks that the program keypair it deploys with is the throwaway id it judged. The real keypairs sit on this box under the same filenames.
- **V45-1:** item 22.4's alarm check runs inside the alarm's own 60-minute grace. It cannot pass for the reason it names, and it can pass for an unrelated one. That is measured below. Item 22.5 records PASS even when the DAS read fails.
- **V45-2:** `--rpc box`, which exists to keep the provider key out of process argv, puts it in the argv of every `solana` CLI call.

Under the older clean-round rule the pass is NOT CLEAN: V45-1 to V45-5, V45-7, V45-10 and V45-11 are code. The launch gate does not use that counter.

**30 deduplicated claim groups: 11 confirmed (5 LOW, 6 INFO; two of them found or extended by this triage and marked so), 0 uncertain, 9 already stated, 10 disproved or not a defect.** Every claim filed against the five programs is disproved or not a defect: MiMo's BURN offset, and Qwen max-0902's three LOWs and three INFOs. Round 44's twelve repairs are in place at every site I checked. The one gap is that V44-2's repair did not tie the id map to the keypair files, which is the opening V45-3 describes.

## Auditor dispositions

**Manifests.** `MANIFEST-programs.json` and `MANIFEST-programs.first-run.json` are byte-identical (`cmp`). Each records head `0d58d4e…`, `dirty: []`, `promptChars` 1,910,788, requested 8, auditors 6, required 6. GLM 5.3 (`finish: length`, 4,799 output tokens) and MiMo v2.6 (`finish: length`, 65,536) are marked `disqualified: "output cut off mid-report"`. Both failed files end mid-sentence. `MANIFEST-programs.rerun-z-ai_glm-5_3.json` and `…rerun-xiaomi_mimo-v2_6-pro.json` each record the same head and the same `promptChars` 1,910,788, `finish: stop`, `disqualified: null`, with 31,684 and 23,830 characters. Every other seat ends `finish: stop`.

I read all eight counted-or-candidate reports in full, and did not take the runner's count on trust. `bank/*.mjs` other than `rehearsal-env.mjs` is in the off-chain pass, so a seat that says it cannot see `alarm.mjs`, `crank.mjs` or `revenue.mjs` is correct.

| Auditor | Disposition |
|---|---|
| anthropic/claude-fable-5.1 | **Counted.** 27,547 characters. The deepest read of the driver. It names the exact guards (`judgeNoMainnetKeys`'s deploy-wallet requirement, `close --buffers` before every deploy, `profile()`'s `rpc: ctx.A.rpc`, `revenueCycle(1)`'s venue-order done-check, `writeRecord`'s 22.2 PASS). It also re-derives the pool invariant and every MintConfig/VaultRecord/BurnConfig offset, correctly.<br>**Confirmed:** F-1 in part (V45-3), F-2 second half (V45-1), F-3 (V45-8), F-4(i) and F-4(iii) (V45-7), F-4(ii) (V45-5).<br>**Not confirmed:** F-2 first half is disproved as a stream leak and survives only as SPEC text (V45-9). F-5 is not a defect (C21). F-6 is already stated; its claim that "the esbuild path is new" is false (C22). F-4(iv) is not a defect (C23). Its limit notes are already stated (C26). |
| anthropic/claude-sonnet-5.5 | **Counted.** 11,994 characters. Short, but every claim is checkable and engages this tree: `solanaCli`'s `--url ctx.A.rpcResolved`, `judgeSigs`' any-landed rule, the 22.4 regex quoted verbatim, `item(5,'PASS', st.das)`, `handRecover`'s delta, and `MAX_EXPIRE_BATCH` 30 against the crank's 20.<br>**Confirmed:** F1 (V45-2), F2 (V45-3), F3 (V45-4), F4 (V45-1), F5 (V45-6).<br>**Not confirmed:** F6 is not a defect today, measured (C18). F7 is disproved for the knobs and not a defect for the residue (C16, C21). F8 is disproved (C19). F9 is already stated (C20). |
| meituan/longcat-2.0 | **Not counted.** 19,981 characters. Its R0 marks with ✓ repairs that are not in the code:<br>• It says the release gate requires each right-side id to "equal `solana-keygen pubkey target/deploy/<crate>-keypair.json`" and runs `git ls-files --others --exclude-standard -- programs Cargo.toml .cargo`. Those are round 44's *recommended* wording. The actual gate (`run-tests.sh:302`, `:355-356`) checks key shape and not-mainnet only, omits `--exclude-standard`, and lists `Cargo.lock`, `Anchor.toml` and `**/build.rs`.<br>• It says the page's `judgeRehearsal` "still treats every null as OPEN (line 69)", which is the pre-repair rule. `plan-ceremony.mjs:74` skips REHEARSAL-NA.<br>• It says the programs are closed "largest-first". They are closed smallest-first (`rehearsal-steps.mjs:584`, `i = 4 … 0`).<br>It files no findings, and calls the driver "sound" without engaging a single line that the counted seats found wrong. Describing recommended text as verified code is invented contents. Its statements are still triaged (C25). |
| meta/muse-spark-1.3 | **Counted.** 14,333 characters. Specific and engaged: `sendWithInit`'s 0.1-SOL probe and its `simulateTransaction(probe, undefined, [INIT.publicKey])` call, the `/simulation failed/i` preflight rule, `das-shim`'s `seen` map, and a full VaultRecord offset list (41/49/57-59/60/125-129/161/177/178/186/187/195). Its LOW V45-1 is disproved by the code and by the local proof's costs (C14). Its V45-2 is not a defect, and its fix would be unsafe (C15). V45-3 is disproved (C16). V45-4 is not a defect (C17). Its headline's "QUORUM of one" is a label slip, not a claim about this tree. |
| qwen/qwen3.8-2.4t-a95b | **Not counted.** 12,097 characters. It is not an audit. It is a triage VERDICT for this round, built from round 44's: its "Auditor dispositions" table counts round 44's seats (Opus 5, Opus 5.5, DeepSeek, Ember, MiniMax, Qwen max-prime, Fugu, GLM-prime) with round 44's reasons. It claims "mutation and measurement on a copy" that are round 44's measurements word for word. It reports "682/682", where this tree measures 695. Its single finding is triaged and disproved (C24). |
| qwen/qwen3.8-max-0902 | **Counted, narrowly.** 20,526 characters. Mostly a line-by-line restatement, but its claims engage this tree and check out:<br>• R0 names `launchJudge === 'rehearsal-file'`, `judgeRehearsalFile`, and the untracked list including `Anchor.toml` and `**/build.rs`.<br>• R7 is a complete field-by-field MintConfig map that matches the struct. Its total "8 + 1005 + 256 = 1269" double-counts the discriminator; the real figure is 1,261.<br>• Its program LOWs cite real lines: `monthly_inline`'s second `waiting_to_join` at `mint/src/lib.rs:2063`, `crank_n` at `:1677`, `split_revenue`'s `d.len() >= 72` at `:1013`, `rescue_nested`'s `.is_ok()` at `:1845`.<br>It overclaims method ("Measured: `judgeRehearsal` … returns `[]`" from a seat that ran nothing). Its six program items are all not defects (C13). **Without it, quorum fails (5 of 6).** |
| xiaomi/mimo-v2.6-pro (re-run) | **Counted, narrowly.** 23,830 characters. It engages real code: BURN's `d[129..133]` at `burn/src/lib.rs:344,376`, `probe-round5.test.ts`'s `subarray(129,133)` (at `:128`, not the `:232` it cites), the driver's guards (`judgeCore` at offset 45, `rehearsal-env` throwing outside a tree), the R7 offsets, and SR.10/SR.12a/SR.13/SR.14.<br>Its headline LOW is wrong. It rests on an SPL layout that puts the close-authority tag at 130 and its key at 133, which overlap. The real tag is at 129 (C12). That is a reasoning error about a real construct, not invented contents. F3 is merged into V45-6. **Without it, quorum fails (5 of 6).** |
| z-ai/glm-5.3 (re-run) | **Counted.** 31,684 characters. The strongest driver walk after Fable: the rescue step's unrecorded `sendAndConfirm` and `st.rescued` ordering, `revenueCycle(1)`'s hard-coded venue order, the collection create's bare existence check, and the alarm's notice path against SPEC 53. It re-derives the account orders of the redemption shape and the consent splice, and it chases the delegate-on-a-sealed-vault case to ground correctly.<br>**Confirmed:** V45-1 (V45-4), V45-2 (V45-5), V45-4 (V45-11).<br>**Not confirmed:** V45-3 is disproved as a stream leak and survives as SPEC text (V45-9). |

**Quorum: 6 counted of 8 seats, 6 required. MET, with no margin.**
- **Excluded:** Longcat, which marks recommended repairs as verified code, and Qwen 2.4t, which wrote a copy of round 44's triage instead of an audit.
- **Counted narrowly:** Qwen max-0902 (accurate but shallow, and it overclaims method) and MiMo (engaged, but its main finding rests on a wrong token layout). Excluding either makes the pass QUORUM NOT MET. I count both because what they say about this tree is specific and checkable, and mostly true. I say so plainly so the margin is not mistaken for comfort.

## Method and evidence

- **Records read:** this brief (`.cache/TRIAGE-BRIEF-r45.md`), the eight counted-or-candidate reports and both failed first outputs (only enough to confirm truncation), the four manifests, round 44's `VERDICT-programs.md`, `VERDICT-offchain.md` and `VALIDATION.md`, round 41-43's confirmed findings as round 44 tabled them, SPEC item 22 (`:1897-1923`), item 53 (`:2172-2251`), ship gate 3, road steps 8-9 (`:2634-2635`), and the limits cited below. Source read at `0d58d4e`: all of `scripts/rehearsal-run.mjs`, `scripts/rehearsal-steps.mjs`, `scripts/rehearsal-recover.mjs`, `bank/rehearsal-env.mjs` and `scripts/rehearsal-tree.sh`, `release_gate` (`run-tests.sh:294-380`), and every consumer of `rehearsal-env` in `bank/`.
- **Allowed runs at `0d58d4e`** (logs in `/tmp/claude-1000/triage45p/`):
  - `node web/test/run-all.mjs`: **695/695** in 10 files at their floors (`bundle` 83/83, `ceremony` 141/141). Exit 0.
  - `node bank/selftest.mjs`: **1004/1004**. Exit 0.
  - `node scripts/check-launch-params.mjs --selftest`: **68/68**. Exit 0.
  - `node bank/redemption-poster.mjs --selftest`: **24/24**. Exit 0.
  - `node bank/accrual.mjs --selftest`: **39/39**. Exit 0.
- **Measurement on a copy (V45-1).** `bank/detectors.mjs` has no imports. I copied it alone to `/tmp/claude-1000/triage45p/c0/bank/` and rewrote its two absolute `/opt/cbob-vaults` paths inside the copy to the copy's root. I then called `detectUnreconciledRevenue` with the exact ledger state `revenue.mjs` leaves under `CBOB_REHEARSAL_FAIL_AFTER_SWEEP` (sweep landed, no swap, no return; `revenue.mjs:388-399`), using the options `alarm.mjs:781` passes (no `graceMinutes`):

  | Sweep age at the alarm pass | Findings |
  |---|---|
  | 1, 5 and 59 minutes | `[]` |
  | 61 minutes | `[["unreconciled_swap","CRITICAL"]]` |

  The driver's 22.4 regex, applied to a report holding an unrelated CRITICAL and an INFO naming the sweep, returns `true`. Log: `grace.log`.
- **Measurement of keys (V45-3), public keys only, no secret printed.**

  | Keypair files | `solana-keygen pubkey` |
  |---|---|
  | `/opt/cbob-vaults/target/deploy/{cbob_vaults,cbob_vault_mint,cbob_vault_burn,cbob_vault_gov,cbob_vault_sweep}-keypair.json` | the five MAINNET ids (`9YKV…`, `Gsb7…`, `8DGi…`, `2pj5…`, `EB2u…`) |
  | `/home/ubuntu/cbob-rehearsal/.rehearsal-keys/` (same five filenames) | throwaway ids, equal to that tree's `.rehearsal-map` |
- **Records outside the repository, read only:**
  - `/tmp/claude-1000/rtree/.rehearsal-run/local-state.json.record.md`, the local proof at `63bb723`. Every step done. Items 22.1/22.2 PASS, 22.3-22.5 NOT-RUN-HERE. Ceremony-step funding deltas: collection 1,803,720; seal 3,670,960; mint 10,157,680; burn 6,656,800; gov 3,336,880 lamports.
  - `/home/ubuntu/cbob-rehearsal/.rehearsal-run/`, the proof at `0d58d4e`, still running; listed only.
- **Canonical logs, read:**

  | Log | Result | Note |
  |---|---|---|
  | `.cache/c9a811d-suite.log` | RC 0, on-chain 912/912 at floor 912, probe 35/35, fork 16/16, expiry 4/4 | |
  | `.cache/c9a811d-web-e2e.log` | **RC 1**, 81/81 then stopped | the clock-lag failure VALIDATION describes |
  | `.cache/c9a811d-sim.log` | **RC 1** | the clock-lag failure VALIDATION describes |
  | `.cache/chainclock-web-e2e.log` | 132/132, RC 0 | written 01:01 UTC |
  | `.cache/chainclock-sim.log` | 71/71, RC 0 | written 01:08 UTC |

  `0d58d4e` was committed at 01:08:32 UTC. The brief calls the three `c9a811d-*` logs canonical, but only the suite log is green; the green e2e and sim runs are the `chainclock-*` ones.
- **Not run:** no validator, `scripts/run-tests.sh`, `web/test/e2e-localnet.sh`, sim, `scripts/audit-coverage.sh`, the rehearsal driver, `bank/alarm.mjs`, crank, revenue job, or any live, money or notification job. Nothing under `/opt` or `/home/ubuntu/cbob-rehearsal` was written except this verdict. `git status --porcelain` was the same before and after: `?? .cache`, `?? audits/round45/`, `?? cache-keypairs-backup-20261008.tar.gz`.

## Can `rehearsal-env` change PRODUCTION behaviour? (the brief's question, answered from source)

**Only by refusing, never by redirecting.**
- **Every override goes through one function.** All three jobs read their notice route and RPC through `rehearsalOnly`/`jobRpc`: `alarm.mjs:64,109`, `crank.mjs:612-616,891`, `revenue.mjs:59,85`. Both forced failures go through `rehearsalFlag` (`revenue.mjs:398,428`), and selftest arm R44 RE pins that `revenue.mjs` has no raw `process.env.CBOB_REHEARSAL` read.
- **Unset, production is unchanged.** `git diff 30b8650 0d58d4e` shows the old inline `HELIUS_RPC_URL` read replaced by `jobRpc()`, which reads the same file and the same key.
- **Set outside a tree, the job refuses.**
  - `alarm.mjs` and `revenue.mjs` evaluate the override at module load, so they die before any notice can be sent. The deadman cron (`cron-install.sh:153`, state over 2 h old) is what pages for the alarm.
  - `crank.mjs` evaluates it inside `main`, and its failure path pages the production route ("CRANK FAILED TO RUN: … rehearsal-only override").
  - That is fail-closed, as `rehearsal-env.mjs:13-16` says.
- **The one switch is a file.** A `REHEARSAL-RECORD.txt` at `/opt/cbob-vaults` would honour the overrides and relabel crank and revenue notices. `rehearsal-tree.sh:29` refuses to write it under the release root, and `cron-install.sh:66` refuses a tree that has one. Creating it by hand is the same-user residue SPEC already accepts (C21).
- **Two raw env reads remain, both older than the driver and not rehearsal knobs:** `CBOB_CRANK_KEY` (`crank.mjs:697`, `f37abb4`) and `CBOB_ALARM_STATE` (`alarm.mjs:57`).
- **No shared state.** No job path outside the substituted root is shared between a rehearsal tree and production: the grep for `/tmp`, `/var` or other `/opt` paths in the jobs found none.

## Distinct claims

Class column: (a) a finding in the five programs; (b) a value path, or a wrong credit; (c) a stopped or wrongly refused crack; (d) HIGH or MEDIUM anywhere; "none" means outside all four.

| ID | Reporters | Claimed | Verdict | Class | Evidence (file:line) |
|---|---|---|---|---|---|
| C1 | Sonnet F4; Fable F-2 (second half); **triage measurement** (the grace) | LOW | **CONFIRMED, LOW (V45-1)**, measured | none | `rehearsal-steps.mjs:496` regex; `detectors.mjs:722,753-761` (60-min grace, `alarm.mjs:781` passes none); `rehearsal-steps.mjs:560` (22.5 PASS on any answer); `:606` (22.2 PASS whatever the passes found); `grace.log` |
| C2 | Sonnet F1 | LOW | **CONFIRMED, LOW (V45-2)** | none | `rehearsal-run.mjs:218-219` (`--rpc box` "so a key-bearing URL never sits in a process's argv"); `rehearsal-steps.mjs:158` (`execFileSync('solana', ['--url', ctx.A.rpcResolved, …])`), used at `:178`, `:179`, `:587` |
| C3 | Fable F-1; Sonnet F2; **triage measurement** (keypair identity) | LOW | **CONFIRMED, LOW (V45-3)** | none | `rehearsal-run.mjs:95,264` (mainnet funding must be `FZjLB4…`, the real ids' upgrade authority, SPEC `:2635`); `rehearsal-steps.mjs:178` (closes EVERY buffer of that key), `:179` (deploys with `.rehearsal-keys/<crate>-keypair.json`, never compared with `ctx.programs[k]`); real keypairs at `/opt/cbob-vaults/target/deploy/` under the same names |
| C4 | GLM V45-1; Sonnet F3 | LOW | **CONFIRMED, LOW (V45-4)** | none | `rehearsal-steps.mjs:516-531` (both transfers via `sendAndConfirm`, not `send`; `st.rescued` set after the return); `rehearsal-run.mjs:139-143,304` |
| C5 | GLM V45-2; Fable F-4(ii) | LOW | **CONFIRMED, LOW (V45-5)** | none | `rehearsal-steps.mjs:463` (`closedCycles()[n-1].swapVenue === venueWant`), `:474`, `:484-485` |
| C6 | Sonnet F5; MiMo F3 (its "one transaction's latency" is wrong); Fable (noted) | INFO / LOW | **CONFIRMED, INFO (V45-6)** | none | SPEC `:2247` ("initialize follows the deploy at once") against the step order `deploy-1..5, fund-roles, pob-set, cbob-mint, fill-values, ceremony-*` (`rehearsal-steps.mjs:170-294`); `verify-configs` `:300-303` |
| C7 | Fable F-4(i), F-4(iii) | INFO | **CONFIRMED, INFO (V45-7)** | none | `rehearsal-steps.mjs:68` (`rpc: ctx.A.rpc`, literally `'box'`) into `reads.mjs:148` `das()`; `:566-581` (sweep-back omits `cbob-release`, `pob-authority`, the INIT key) |
| C8 | Fable F-3 | INFO | **CONFIRMED, INFO (V45-8)** | none | SPEC `:1901-1904` ("~2,100 vaults … a transient RPC error on vault 1,900"); `rehearsal-steps.mjs:440` records 22.1 PASS at five vaults |
| C9 | GLM V45-3; Fable F-2 (first half) | LOW | Stream sharing **DISPROVED**; SPEC text **CONFIRMED, INFO (V45-9)** | none | Every alarm notice goes through `NOTIFY` (`alarm.mjs:940,964,982`), which the driver points at `.rehearsal-run/notify.sh` (`rehearsal-steps.mjs:109-111`), so the router is never invoked. SPEC `:2212-2220` still prescribes `--dry-run` or `ALERT_STATE_DIR`/`ALERT_LOG`; `rehearsal-tree.sh:126` still says "Alerts still go to /opt/scripts/notify-gary-sms.sh" |
| C10 | **triage only** | - | **CONFIRMED, INFO (V45-10)** | none | `rehearsal-recover.mjs:32-36` reads only ledger fields; `:52`, `:62`, `:67` send; `:76-78` writes the ledger once, at the end |
| C11 | GLM V45-4 | INFO | **CONFIRMED, INFO (V45-11)** | none | `rehearsal-steps.mjs:280-282` (create skipped on any account at the address, address recorded anyway); `:274` `broken()` remedy; SPEC limit 59 (`:1771`) |
| C12 | MiMo F1, F2 (BURN reads close authority at `[129..133]`, should be `[130..134]`) | LOW, class (a) | **DISPROVED** | none | SPL Account: mint 0-32, owner 32-64, amount 64-72, delegate COption 72-108, state 108, is_native COption 109-121, delegated_amount 121-129, **close_authority COption 129-165** (tag 129-133). BURN checks 121-129 separately (`burn/src/lib.rs:343,375`). `decode.mjs:35,41` and the probe's log line (`probe-round5.test.ts:128`, a `console.log`, not the "D2.3" assertion at `:131`) agree. MiMo's own table overlaps (tag 130-134, key 133-165) |
| C13 | Qwen max-0902 L1-L3, I1-I3 (MINT) | LOW / INFO, class (a) | **NOT A DEFECT / DISPROVED** | none | L1: `waiting_to_join` is pure and is called a second time only for the log line (`mint/src/lib.rs:2003,2060-2063`). L2: `crank_n` over `MAX_CRANK` fails `TooManyCranked`, whose message names `MAX_CRANK` (`:1677`, `:2168`, `:2957`). L3: `revenue_ata` is pinned to the classic ATA address of the revenue PDA (`:1007`), which only the ATA program can create (a 165-byte Token account), and `TransferChecked` validates it (`:1021-1040`). I1-I3 are self-dismissed: the error is by design, the System program refuses a missing `dest`, and Core checks membership |
| C14 | Muse V45-1 (`sendWithInit` funds 0.1 SOL per step because the simulation returns no accounts) | LOW | **DISPROVED** (code and measurement) | none | web3.js 1.98.4 `simulateTransaction(tx, signers, includeAccounts)` turns an array third argument into `accounts.addresses` (`lib/index.cjs.js:7995-8080`). The local proof's ceremony deltas are 1.8M-10.2M lamports, not ~100M |
| C15 | Muse V45-2 (`preflightRefused` set only on "simulation failed") | LOW | **NOT A DEFECT** | none | A send that throws for any other reason (timeout, 429) may already be forwarded; leaving it unmarked so it is waited out is the never-resend rule (`rehearsal-run.mjs:150-162`). Marking it refused, as proposed, could double-send |
| C16 | Muse V45-3; Sonnet F7 (knob consumers unverified) | INFO | **DISPROVED** | none | `revenue.mjs:398,428` use `rehearsalFlag`; selftest "R44 RE … ONLY through rehearsalFlag (never a raw env read)" is in today's 1004/1004 |
| C17 | Muse V45-4 (`das-shim` `seen` unbounded) | INFO | **NOT A DEFECT** | none | Local-only proof tool, five vaults |
| C18 | Sonnet F6 (`MAINNET_ONLY` hand-copied) | INFO | **NOT A DEFECT today** (measured equal); arm recommended | none | All eight non-null own-key values in `launch/mainnet-init.json` are keys of `MAINNET_ONLY` (`rehearsal-run.mjs:48-56`); `vault_collection` is null |
| C19 | Sonnet F8 (`handRecover` transfers the balance, records the delta) | INFO | **DISPROVED** | none | It is the automatic path's deliberate rule, with `sweptAtaTotal` recorded (`revenue.mjs:475-494`; `rehearsal-recover.mjs:76-77`) |
| C20 | Sonnet F9 (`MAX_EXPIRE_BATCH` 30 against 20) | INFO | **ALREADY-STATED** | none | `bank/layout.mjs:283-285` states it; 30 is a ceiling, fails closed |
| C21 | Fable F-5; Sonnet F7 residue (a stray marker relabels production) | INFO | **NOT A DEFECT** (same-user residue); detector optional | none | `rehearsal-tree.sh:29`, `cron-install.sh:66`; SPEC limit 10(c)/D2(3) (round 42 C02) |
| C22 | Fable F-6 (esbuild from `luna-remotion`, "new") | LOW | **ALREADY-STATED** ("new" is false) | none | `web/build.mjs:31` since `0b3ddb3`; round 36 A10, round 40 A3, round 42 C02/C21 |
| C23 | Fable F-4(iv) (`fill-values` re-reads the template) | INFO | **NOT A DEFECT** | none | Self-dismissed; `launchWithCollection` restores `vault_collection` (`rehearsal-steps.mjs:71`) |
| C24 | Qwen 2.4t V45-1 (two `judgeRehearsal` functions can drift) | LOW | **DISPROVED** | none | The driver and the page's `rehearsal-file` profile both use the checker's `judgeRehearsal` (`rehearsal-steps.mjs:33`; `ceremony.mjs:20`; `plan-ceremony.mjs:114`). The page's own is the local `rehearsal` profile's bounds judge, documented as NOT the dress rehearsal's (`plan-ceremony.mjs:66-70`) |
| C25 | Longcat (gate ties ids to keypairs; `--exclude-standard`; page judge still nulls-OPEN; close order) | (statements) | **DISPROVED** | none | `run-tests.sh:302,355-356`; `plan-ceremony.mjs:74`; `rehearsal-steps.mjs:584` |
| C26 | Fable limits 10/47 compound and 32 cost | INFO | **ALREADY-STATED** in substance; optional wording | none | Limit 10 (operator "until the guardian stops it", a vote can only tighten) and limit 47 (stop permanent at low turnout) bound each key. The tighten vote is in SPEC `:357`, `:393-397` |
| C27 | Sonnet residuals (heap-shape arm, SPEC 46 subset censorship, MINT's non-default checks) | INFO | **ALREADY-STATED** | none | Round 43 carried ruling (heap-shape arm); SPEC 46 "selective admission"; SPEC 38 and the checker |
| C28 | GLM ("announced on X" not kept) | (obs.) | **ALREADY-STATED** | none | Item 50; the guide is DRAFT |
| C29 | Fable R8; GLM R8 (in-tree suite last passed at `2e8c979`; arms for `split_revenue` into a frozen pool, `distribute(burn)` with a frozen pool, native wSOL, other-vault destination) | (obs.) | **ALREADY-STATED** | none | VALIDATION ("re-run on the final commit before the rehearsal"); round 44 gate-5 6 (C11, C18) and 7 |
| C30 | Fable R0 (C9 null bodies still unguarded) | (obs.) | **ALREADY-STATED** | none | Round 44 C9 (unreachable at the pin, fails closed) |

## Confirmed findings

**V45-1: LOW.** Reporters: Sonnet F4; Fable F-2 (second half); the grace mechanism is this triage's measurement.

**Three item-22 verdicts can be recorded without the evidence they name, and 22.4's check cannot pass for its own reason.**
- **22.4 (`rehearsal-steps.mjs:495-500`).** The alarm runs seconds after the forced failure. The finding it must see, `unreconciled_swap`, is suppressed for an open cycle younger than 60 minutes (`detectors.mjs:722,753-761`), and the alarm passes no grace override (`alarm.mjs:781`). Measured on a copy: no finding at 1, 5 or 59 minutes, CRITICAL at 61. So `critical` is true only if some OTHER CRITICAL is in the report, because the regex `/CRITICAL/ && /(unreconciled|sweep)/i` accepts any CRITICAL plus the word "sweep" anywhere (measured true for an unrelated CRITICAL beside an INFO `sweep_stopped`). Otherwise the step throws. A rerun then stops on the landed top-up signature, or reruns the forced failure into the open-cycle guard, whose output lacks "REHEARSAL (item 22.4)", and throws again. The step can never reach `done` for the reason item 22.4 states, "the alarm's CRITICAL for a sweep with no matching return raised", and the hand-recovery step behind it never runs.
- **22.5 (`:560`).** `item(5, 'PASS', …)` is recorded whatever the read returned, including `{burnt: null, error: …}`. The question item 22.5 exists to settle is then unanswered, and the record says PASS.
- **22.2 (`:606`).** PASS whenever two passes ran, whatever they found. The findings are kept as evidence, so this part alone would be INFO.

**LOW:** record predicates that cannot fail when their property breaks (round 37 precedent). 22.4 has never run (local NOT-RUN-HERE), so the first execution of the wedge would be on mainnet, after real SOL has been swept onto the rehearsal operator key. It fails closed: the SOL stays on a throwaway key and can be recovered by hand. **Class: none.** The rehearsal's own record; no program, no production value, no crack.

**Repair:**
- 22.4: wait out the grace (or pass the alarm a rehearsal-only grace override through `rehearsalOnly`), and require the report's `[unreconciled_swap]` line for this cycle.
- 22.5: PASS only when `burnt` is a boolean; otherwise FAIL or UNSETTLED with the error.
- 22.2: FAIL on `run_failed` or any CRITICAL not explained by the step.

**V45-2: LOW.** Reporter: Sonnet F1.

**`--rpc box` puts the provider key into argv anyway.** `rehearsal-run.mjs:218-219` introduces `box` "so a key-bearing URL never sits in a process's argv (security.md #67)". `solanaCli` (`rehearsal-steps.mjs:158`) then passes `--url ctx.A.rpcResolved`, which is that URL, to every `solana program close --buffers`, `program deploy` (minutes on mainnet) and `program close`. With `--rpc <url>` instead, the URL is in the driver's own argv. No mode keeps the key out.

**LOW:** a local secret exposure against a stated property. The key is an RPC provider key, not a money key. **Class: none.**

**Repair:** write a mode-600 Solana CLI config under `.rehearsal-run/` with `json_rpc_url` and pass `--config`; or read `--url` from an env var the CLI honours, never argv.

**V45-3: LOW.** Reporters: Fable F-1; Sonnet F2. The keypair-identity part is this triage's measurement.

**On mainnet, the driver deploys with the upgrade authority of the five REAL ids. Its mainnet-id refusal judges the map, not the key the deploy signs with.**
- **The wallet.** `judgeNoMainnetKeys` requires the mainnet funding wallet to be `FZjLB4…` (`rehearsal-run.mjs:95`, re-checked `:264`). Per SPEC road step 9 (`:2635`), that key is the sole upgrade authority of the five claimed placeholder ids, and losing it means new ids.
- **The deploy.** Each deploy step passes that key as `--keypair` and `--upgrade-authority`, with `--program-id .rehearsal-keys/<crate>-keypair.json` (`rehearsal-steps.mjs:179`).
- **What is never checked.** `judgeProgramIds` (`rehearsal-run.mjs:223-225`) and `release_gate` (`run-tests.sh:355-356`, which checks key shape and not-mainnet only) judge `.rehearsal-map`. Nothing compares the keypair file's public key with `ctx.programs[k]` before sending; `deployed(k)` (`:160-169`) reads the map id after the fact. Round 44's V44-2 repair recommended exactly that tie, to `target/deploy`, and the repair did not make it.
- **Why it matters.** The real program keypairs are on this box, at `/opt/cbob-vaults/target/deploy/<crate>-keypair.json`, under the same five filenames (measured: their public keys are the mainnet ids). `rehearsal-tree.sh:58` itself copies between `.rehearsal-keys` and `target/deploy`. One misplaced copy and `solana program deploy` UPGRADES a real placeholder to the `--features localnet` build, whose `initialize` anyone can sign with the public seed-0x07 key. A stranger can then write the real config PDA once, with their values, and the claimed ids are lost (new ids are a program change).
- **The buffers.** `program close --buffers --buffer-authority <deploy key>` (`:178`) closes every buffer that key owns, not the step's own. Rent returns, but any staged step-9 buffer would be destroyed.

**LOW:** a guard whose stated property ("any program id equal to a mainnet id: refuse", `rehearsal-run.mjs:15`) is not enforced on the key that is used. It needs a wrong file in the rehearsal's key directory, nothing writes one today, and nothing has launched, so no holder value is exposed. **Class: none.**

**Repair:**
- Before each deploy, require `solana-keygen pubkey <keypair> == ctx.programs[k]` and not in `MAINNET_PROGRAM_IDS`, with a selftest arm red on a mainnet-pubkey fixture.
- Close only the buffer this step created (`--buffer <recorded keypair>`), or none.
- Consider (Gary's call) a dedicated rehearsal deployer funded from the deploy wallet, so the real upgrade key is never loaded by the driver.

**V45-4: LOW.** Reporters: GLM V45-1; Sonnet F3.

**The rescue step bricks on a lost confirmation, and a stopped multi-transaction step has no documented safe resume.**
- **The send.** In `rescue` (`rehearsal-steps.mjs:516-531`), both Core transfers go through Umi's `sendAndConfirm`, not the driver's `send()`, so neither signature is recorded. `st.rescued` is set only after the treasury's return.
- **The brick.** A confirmation that times out after the return landed (common on mainnet), or a crash between `:529` and `:530`, leaves `unknown` with no signatures. That reads `none-landed`, so `run`. The rerun skips the nesting (`nestedSent`), then asks the crank for `owner === treasury`, which is false forever. That is five real full crank passes, then a throw. The only way out is a hand edit of the state file that the code does not describe.
- **The general case.** For every multi-transaction step, any landed signature means a permanent `stop` (`rehearsal-run.mjs:140-143,304`). That is the safe direction, but the STOP message names no safe edit.

**LOW:** it fails closed, but on mainnet it wedges the rehearsal at a step that has moved value, and invites the hand edit where double sends happen. **Class: none.**

**Repair:** make `rescue`'s run idempotent on read-back (vault with the holder and `nestedSent` set means record `rescued`); send both transfers through `send()`; give each multi-transaction step a documented resume (a `--resume <step>` that re-enters the step's idempotent run after its read-back).

**V45-5: LOW.** Reporters: GLM V45-2; Fable F-4(ii).

**`revenue-cycle-1` can never read done if Orca legitimately refuses.** `done` and the run both require `closedCycles()[0].swapVenue === 'orca'` (`rehearsal-steps.mjs:463,474`). If Orca's pinned-pool or oracle filter refuses for real, `revenue.mjs` correctly closes the cycle on Meteora. The step then throws, its landed top-up signature makes every rerun STOP (or, with no top-up, runs another real cycle), and `done` stays false whatever happens next. Cycle 2's index (`closedCycles()[1]`) is skewed too.

**LOW:** rehearsal-only, fails closed, bounded by `--max-sol`. **Class: none.**

**Repair:** item 22.3 needs one closed cycle on each venue. Judge "a closed Orca cycle and a closed forced-refusal Meteora cycle exist", whatever the order, or record PARTIAL and stop with the cause named.

**V45-6: INFO.** Reporters: Sonnet F5; MiMo F3; Fable (noted).

**The init-key window is not "at once".** SPEC `:2247` says that, because the seed-0x07 key is public, "initialize follows the deploy at once". The driver runs `deploy-2..5`, `fund-roles`, `pob-set`, `cbob-mint` and `fill-values` (whose charter opens at `now+600`) between `deploy-1` and `ceremony-seal`: many minutes with uninitialised programs that anyone can initialise. The containment holds. Every ceremony step and `verify-configs` re-read before any token moves (`:288-303`), and the STOP remedy is new ids. So the cost is a redeploy, not value.

One related note: `--step <name>` runs any single step without its predecessors, so "before any token moves" is an ordering property the flag can bypass.

**Repair:** move `keys`, `fund-roles`, `pob-set`, `cbob-mint` and `fill-values` before the deploys, and initialise each program right after its own deploy. Make token-moving steps require `st.configsVerified`. Or correct SPEC's sentence.

**V45-7: INFO.** Reporters: Fable F-4(i), F-4(iii).

**Two small driver defects.**
1. `profile()` sets `rpc: ctx.A.rpc` (`rehearsal-steps.mjs:68`), which is literally `'box'` under `--rpc box`. `reads.mjs:148` `das()` then fetches `'box'` and throws, so the mainnet crack only ever takes the "could not look for compressed NFTs" branch (`dasItems = null`). Use `rpcResolved`, or better a `dasRpc` that is not the argv value.
2. `sweep-back` (`:566-581`), titled "every token and lamport", skips `cbob-release` (its $CBOB ATA's rent), `pob-authority` and any INIT dust, and cannot reach the rehearsal pool's remainder or the config and record rent once the programs close.

Pennies. Fix, or say what stays behind.

**V45-8: INFO.** Reporter: Fable F-3.

**Item 22.1 is recorded PASS at five vaults.** SPEC item 22 (`:1901-1904`) scopes the crank's live I/O to "~2,100 vaults (cost, rate limits, paging, a transient RPC error on vault 1,900 of 2,100 …)". The ruled rehearsal has five, and `:440` records PASS once vault-1 is active and two epochs have advanced.

**Repair:** record "PASS at 5 vaults; scale not exercised", and either seed synthetic records on the local proof (the expiry-budget pattern) or state in item 22 that scale stays open.

**V45-9: INFO.** Reporters: GLM V45-3; Fable F-2 (first half).

**SPEC 53 tells the rehearsal to run the alarm a way the driver does not.** The risk both seats named (a rehearsal notice muting or closing a production stream) is **disproved**: every alarm notice goes through `NOTIFY` (`alarm.mjs:940,964,982`), the driver points it at `.rehearsal-run/notify.sh` (`rehearsal-steps.mjs:109-111`), and the router is never invoked. That is stronger isolation than SPEC's. But SPEC `:2212-2220` still prescribes `--dry-run` or `ALERT_STATE_DIR`/`ALERT_LOG`, and `rehearsal-tree.sh:126` still says "Alerts still go to /opt/scripts/notify-gary-sms.sh".

**Repair:** name the `CBOB_REHEARSAL_NOTIFY` route in SPEC 53 and correct the echo.

**V45-10: INFO.** This triage only.

**The scripted hand recovery records no signature before sending.** `handRecover` reads its "candidate signatures" from the ledger (`rehearsal-recover.mjs:32-36`). It sends the swap, the return and the split (`:52,62,67`), and writes the ledger once, at the end (`:76-78`). None of them reaches the driver's `rec.sigs`, either.

A crash or lost confirmation after the swap lands loses its signature. A rerun's only guard against a second swap is then `sol < lamports` (`:43`). That holds at the rehearsal's numbers (operator float 0.025 SOL against a ~0.05 SOL sweep), but only incidentally. Its own header promises "a swap that may have landed is NEVER repeated".

**Repair:** write `pendingSwapSig`, `pendingReturnSig` and `pendingSplitSig` to the ledger before each send, as `revenue.mjs` does (`rememberAttempt`).

**V45-11: INFO.** Reporter: GLM V45-4.

**The driver's collection create lacks the page's fresh/landed/taken check, so limit 59's grief gets the heaviest remedy.** `ceremony-collection` skips the create when ANY account sits at the generated address, records the address anyway (`rehearsal-steps.mjs:280-282`), and the read-back then hits `broken()`: "close every rehearsal program … make a NEW rehearsal tree" (`:274`). The right remedy is a fresh collection key. Nothing is lost but a redeploy and time.

**Repair:** mirror `checkNewAddress`, and swap in a fresh key when the address is taken.

### The documentation exception (SPEC gate 3, ruling of 2026-10-07)

- V45-1 to V45-5, V45-7, V45-10 and V45-11 change code. **Not eligible.**
- V45-6, V45-8 and V45-9 are text (or a reorder offered as an alternative to text) and misstate nothing about holders' money. They would qualify if corrected and re-verified, but cannot make the round clean alone.

## Rounds 41, 42, 43 and 44 re-check, per confirmed finding

I re-read each verdict's mechanism against the code at `0d58d4e` and classified it again. The programs are byte-identical to the release all four rounds judged.

| Finding | Severity | (a) programs | (b) value | (c) crack | (d) H/M | Outside (a)-(d)? |
|---|---|---|---|---|---|---|
| R41 programs **V41-1**: dusting a config PDA made the ceremony pages refuse | LOW | No (page reads, `absentIfDust`) | No. A refusal moves nothing | No. Ceremony, not redemption | No | **Yes** |
| R41 off-chain **C01**: poster drafted per transaction | LOW | No (`redemption-poster.mjs`) | No. Drafts only | No | No | **Yes** |
| R41 off-chain **C02**: oracle-age test pinned only through its constant | LOW | No (`bank/selftest.mjs`) | No. The on-chain floor binds (SW.7a in `c9a811d-suite.log`'s 912/912) | No | No | **Yes** |
| R41 off-chain **C03**: SPEC's crank fee-budget sentence | INFO | No | No | No | No | **Yes** |
| R42 programs **V42-1**: malformed path crashed the local ceremony server | INFO | No | No | No | No | **Yes** |
| R42 programs **V42-2**: an earlier transaction hid the collection create | INFO | No (`CREATOR_FETCH_MAX`) | No | No | No | **Yes** |
| R42 off-chain **C01**: omitted vaults lost their alarm baseline | LOW | No (`alarm.mjs`) | No. Detection | No | No | **Yes** |
| R43 programs **V43-1**: a host's owner keeps a nested vault by Core-Executing it out in their own opening | LOW | No program defect against the ruled design (R43.V1/R43.V1a in 912/912; ruled the sender's loss, SPEC limit 58) | No. An owner takes what is in their own wallet during their own crack; the crank plans `rescue_nested` (exercised live by the driver's `rescue` step in the local proof) | No | No | **Yes** |
| R43 programs **V43-2**: e2e header described the old rescue rule | INFO | No | No | No | No | **Yes** |
| R43 off-chain **V43o-1**: release check died in the rehearsal tree | LOW | No (`run-tests.sh`) | No | No | No | **Yes** |
| R43 off-chain **V43o-2**: one unreadable signature froze a scan | LOW | No (`alarm.mjs`) | No | No | No | **Yes** |
| R43 off-chain **V43o-3**: the reveal-skip arm could not fail | LOW | No (`selftest.mjs`) | No | No | No | **Yes** |
| R44 programs **V44-1**: rehearsal ceremony could not consume the value file | LOW | No (page judge and profile) | No | No | No | **Yes**. Repaired: `plan-ceremony.mjs:74,112-116`; `config.js` rehearsal profile `GmaDrpp…`, `squads: null`, `launchJudge: 'rehearsal-file'` |
| R44 programs **V44-2**: `release_gate` accepted any reversible swap and ignored untracked files | LOW | No (`run-tests.sh`) | No | No | No | **Yes**. Repaired (`:302`, `:355-356`; selftest V44-2 arms ×4 in 1004/1004). It does not tie the map to the keypairs, which is the opening V45-3 describes, also outside |
| R44 programs **V44-3**: coverage gate could not credit LAUNCH-CLEAN | LOW | No (`audit-coverage.sh`) | No | No | No | **Yes**. Repaired (`:111`, cases `:149-153`) |
| R44 programs **V44-4**: RULED missing from the status legend; "redeploy" remedy | INFO | No | No | No | No | **Yes**. Repaired (SPEC `:2233`, `:2248`) |
| R44 programs **V44-5**: limit 59 cited the test validator's rent | INFO | No | No | No | No | **Yes**. Repaired (SPEC `:1786-1787`) |
| R44 programs **V44-6**: "the one exception" omitted the bare burn | INFO | No. The program credits as SPEC states | No | No | No | **Yes**. Repaired (`HOLDER-GUIDE.md:81`, "two exceptions") |
| R44 programs **V44-7**: absent pinned collection shown as BROKEN | INFO | No (ceremony page) | No | No | No | **Yes**. Repaired (`ceremony-reads.mjs:7,21-28`) |
| R44 off-chain **V44o-1**: poster's skip never fired while a backlog drained | LOW | No (poster, drafts only) | No | No | No | **Yes** |
| R44 off-chain **V44o-2**: revenue split-recovery scan died on one refused signature | LOW | No (`revenue.mjs`) | No. The job stops itself; nothing moves wrongly, and the pool and revenue address keep their balances | No. Cracks never touch the revenue job | No | **Yes** |
| R44 off-chain **V44o-3**: null SEAL read dropped reserve baselines | LOW | No (`alarm.mjs`) | No. Detection | No | No | **Yes** |
| R44 off-chain **V44o-4**: no-network runner exit 1 | INFO | No | No | No | No | **Yes** |
| R44 off-chain **V44o-5**: rehearsal runbook did not cover the off-chain jobs | INFO | No | No | No | No | **Yes**. Repaired: `SWAP_OPERATOR_KEY` at the tree's `bank/keys` (`rehearsal-steps.mjs:50`); `rehearsalNotice` labels (`crank.mjs:845-846`, `revenue.mjs:608-609`) |

**All twenty-four are outside (a)-(d).** Rounds 41 and 42 stand as the two launch-clean rounds on their confirmed findings. Rounds 43 and 44 confirmed the trees their predecessors' repairs changed, and round 44's repairs hold at every site above. Limit 59 still has no recorded ruling; it is still outside (a)-(d) on my reading (a bounded grief, never a crack).

## Gate-5 obligations

SPEC ship gate 5: every confirmed defect's repair becomes a suite (or selftest) assertion, and so does every rejected finding that could be measured. These are requirements, not findings. None of the driver's item-22 predicates has an arm today; the selftest's 22 driver arms (R44 RR/RE) cover its guards, not its record.

1. **V45-1:**
   - 22.4: a report without `[unreconciled_swap]` (or with only an unrelated CRITICAL and the word "sweep") is NOT a pass, and the step waits out, or overrides, the grace. Shown red on `:496`.
   - 22.5: an error or `burnt: null` answer is not PASS.
   - 22.2: a `run_failed` pass is not PASS.
2. **V45-2:** no `solana` argv under `--rpc box` contains the resolved URL (inspect the `execFileSync` arguments through a stub).
3. **V45-3:** a deploy step given a keypair whose public key is not `ctx.programs[k]`, or is a mainnet id, refuses before sending (fixture: a keypair whose public key is one of the five mainnet ids). The buffer close names only the step's own buffer.
4. **V45-4:** a `rescue` rerun with `nestedSent` and the vault back with the holder records done without a crank pass.
5. **V45-5:** cycle 1 closed on Meteora, then the forced-refusal cycle on Meteora: the step judges by item 22.3's purpose, not venue order.
6. **V45-10:** `handRecover` writes a pending signature before each send; a rerun after a landed swap refuses to swap.
7. **V45-11:** a taken collection address gets a fresh key, not BROKEN.
8. **V45-6, V45-7, V45-8, V45-9:** text, or a small code change with one arm each where code changes (V45-7's `das()` URL).
9. **Measurable rejections:**
   - **C12:** a suite arm, the twin of 3.3, that plants a CLOSE authority on a declared reserve ATA during the thaw and expects `ReserveDelegated` from BURN's `[129..133]` check. Today 3.3 pins the delegate branch only, and R36.C5 is the helper's. Recommended.
   - **C14:** settled by the local proof's costs; one arm asserting each ceremony step's cost is at most its estimate plus rent would also catch V45-1-style estimate drift (MINT's step costs 10,157,680 against a 5,000,000 estimate, absorbed by the drawdown-based cap at the next step).
   - **C18:** an arm that every `REHEARSAL_OWN_KEYS` value in `launch/mainnet-init.json` is a key of `MAINNET_ONLY`.
   - **C13, C15-C17, C19-C25:** settled by reading; no arm.
10. **Carried from round 44:** C9 null-body arms (recommended), C11 (`split_revenue` into a frozen pool), C18 (`distribute(burn)` with the pool frozen); and from round 43: Gary's ruling on making the combined heap-shape arm required before step 11, round 42 C9 / round 43 C20 coverage (native wSOL source, a destination that is another vault's signer), the A9 reason pins, and Gary's ruling on limit 59.
11. **Item 53:** the full suite inside a rehearsal tree made from the final commit (last passed at `2e8c979`; the `0d58d4e` proof is running now).

## Measurements

| Measurement | Result | Evidence |
|---|---|---|
| Allowed selftests at `0d58d4e` | web 695/695 (bundle 83/83, ceremony 141/141); detectors 1004/1004; launch 68/68; poster 24/24; allocation 39/39; all exit 0 | `/tmp/claude-1000/triage45p/{web,det,launch,poster,accrual}.log` |
| Program source against the release | equal to `0b3ddb3` | `git diff --quiet` |
| `unreconciled_swap` for the forced-failure state | none at 1, 5, 59 min; CRITICAL at 61 min | `grace.log` (copy of `detectors.mjs`, paths rewritten) |
| 22.4 regex on an unrelated CRITICAL plus an INFO naming the sweep | `true` | `grace.log` |
| Keypairs named `<crate>-keypair.json` on this box | `/opt/cbob-vaults/target/deploy/` holds the five mainnet ids; the rehearsal tree's `.rehearsal-keys/` holds its map's throwaway ids | `solana-keygen pubkey` (public keys only) |
| `MAINNET_ONLY` against `launch/mainnet-init.json` | all eight non-null own-key values present | read, python |
| web3.js `simulateTransaction` third argument | an array becomes `accounts.addresses` (1.98.4) | `node_modules/@solana/web3.js/lib/index.cjs.js:7995-8080` |
| Local proof at `63bb723` | all steps done; 22.1/22.2 PASS; 22.3-22.5 NOT-RUN-HERE; ceremony costs 1.8M-10.2M lamports | `/tmp/claude-1000/rtree/.rehearsal-run/local-state.json.record.md` |
| Canonical runs | suite `c9a811d` 912/912, RC 0; e2e 132/132 and sim 71/71 RC 0 in `chainclock-*`; the `c9a811d-web-e2e` and `-sim` logs are RC 1 (pre-fix) | `.cache/*.log` |

## Measurement limits

- **No validator was run, and the driver was not run.** Every driver finding is a source reading, except V45-1's grace and regex (measured on a copied detector) and V45-3's key identities (measured). Items 22.3-22.5 have never run anywhere, so V45-1's 22.4 wedge and V45-5 are predicted from code, not observed.
- **V45-3 assumes `solana program deploy --program-id <keypair>` upgrades an existing program when the signer is its upgrade authority.** That is the CLI's documented behaviour, and SPEC road step 9 relies on it. I did not run it.
- **The quorum has no margin and depends on two narrow seats** (Qwen max-0902, MiMo). A stricter reading excludes either, and the pass is QUORUM NOT MET.
- **Canonical logs:** the `chainclock-*` logs carry no commit hash. Their times (01:01, 01:08 UTC) precede `0d58d4e`'s commit (01:08:32), so they ran the clock fix before it was committed. I take VALIDATION's statement that they are that tree. The `c9a811d-web-e2e` and `-sim` logs the brief calls canonical are RC 1.
- **The rehearsal proof at `0d58d4e`** (`/home/ubuntu/cbob-rehearsal`) was still running. I read its directory listing and the map only.
- **Untracked state, recorded, not a seat's claim:** `?? .cache` (a symlink to `/scratch/cbob-vaults-cache`) and `?? cache-keypairs-backup-20261008.tar.gz` (not opened) remain in the repository root. `build-mainnet.sh` refuses a dirty tree, so both must be gone or ignored before step 9's build.
- **Unmeasured here, as rounds 36-44 also stated:** a real Phantom, a real Squads v4 return, the live proxy behind Cloudflare, DAS on mainnet, and whether a holder understands any page sentence.

## Remaining requirements

- **Before road step 8 (the mainnet dress rehearsal):** V45-3 (tie each deploy key to its judged id, and stop the wholesale buffer close), V45-1 (so items 22.4 and 22.5 can only PASS on their evidence), V45-2, and V45-4/V45-5 (so a lost confirmation or a real Orca refusal does not wedge a mainnet run). V45-10 and V45-11 with them.
- **Before the next round, or before launch, under gate 5:** every repair and arm above.
- **Unchanged:** items 22, 38, 50, 52 and 53 remain OPEN AND BLOCKING. `charter_opens_at`, `lock_deadline` and `vault_collection` remain OPEN in `launch/mainnet-init.json`. Gary's rulings on the heap-shape arm and on limit 59 are still outstanding. No deployment, initialization, lock, ceremony, cron installation, rehearsal or publication follows from this audit.

**Result:** QUORUM MET (6 counted of 8; six required; two provider cut-offs re-run at the same head and prompt size).

LAUNCH-CLEAN under SPEC gate 3's launch gate: 0 CRITICAL, 0 HIGH, 0 MEDIUM; nothing in the five programs, no value path, no refused crack.
- **5 LOW:** V45-1 item-22 predicates, V45-2 key in argv, V45-3 deploy key not tied to the judged id, V45-4 rescue resume, V45-5 cycle-1 venue order.
- **6 INFO:** V45-6 init window, V45-7 `box` DAS URL and sweep-back scope, V45-8 22.1 scale, V45-9 SPEC 53 alarm text, V45-10 hand recovery records late, V45-11 collection create check.

NOT CLEAN under the clean-round rule.

---

**Reply (under 300 words).** Round 45 programs pass: **LAUNCH-CLEAN; QUORUM MET.**

**Seats counted (6 of 8; 6 needed, no margin):** Fable 5.1, Sonnet 5.5, Muse Spark, GLM 5.3 (re-run), and narrowly Qwen max-0902 and MiMo (re-run). Not counted:
- Longcat marks round 44's *recommended* repairs as verified code.
- Qwen 2.4t submitted a copy of round 44's triage, not an audit.

The cut-off GLM and MiMo first runs were re-run at the same head and prompt size, and the failed outputs are not counted. The programs equal release `0b3ddb3`.

**Confirmed, all outside (a)-(d), all in the rehearsal driver or its SPEC text:**
- **V45-1, LOW:** item 22.4's alarm check runs inside the alarm's 60-minute grace (measured: no CRITICAL until 61 min), so it can only pass on an unrelated CRITICAL. 22.5 records PASS even when the DAS read fails.
- **V45-2, LOW:** `--rpc box` still puts the provider key in `solana` argv.
- **V45-3, LOW:** mainnet deploys sign with the real ids' upgrade authority, and nothing ties the keypair file to the judged id. The real program keypairs sit on the box under the same names. Every one of that key's buffers is closed.
- **V45-4, LOW:** the rescue step bricks on a lost confirmation.
- **V45-5, LOW:** a real Orca refusal leaves revenue-cycle-1 never done.
- **V45-6 to V45-11, INFO:**
  - the init window is not "at once";
  - `'box'` is used as the DAS URL, and sweep-back's scope is overstated;
  - 22.1 is recorded PASS at 5 vaults;
  - SPEC 53's alarm text is stale;
  - the hand recovery records signatures late;
  - the collection create lacks a taken-address check.

**Disproved:** MiMo's BURN offset (129 is the close-authority tag), Qwen max's six MINT items, Muse's 0.1-SOL funding claim (measured costs) and the knob-bypass worry. `rehearsal-env` changes production only by refusing. Allowed selftests are green (695, 1004, 68, 24, 39). Rounds 41-44: all 24 findings are outside (a)-(d).
