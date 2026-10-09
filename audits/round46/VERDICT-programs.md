# Round 46, PROGRAMS pass: LAUNCH-CLEAN; QUORUM MET
REQUIRES CHANGES: V46-1, V46-2, V46-3, V46-4, V46-5, V46-6, V46-7, V46-8

**Independent triage verdict against audited head `63a92b2d39e105d5a8004d875efac8557412d1de` (`63a92b2`). HEAD is `63a92b2`. `git diff --name-only e7c192a 63a92b2` names only `audits/FREEZE.md`, `audits/round45/VALIDATION.md` and `scripts/audit46.ts`, so the product tree is round 45's validated repairs. The programs equal `RELEASE_COMMIT` `0b3ddb3` (`git diff --quiet 0b3ddb3 63a92b2 -- programs Cargo.toml Cargo.lock` exits 0). `git status --porcelain` was `?? .cache`, `?? audits/round46/`, `?? cache-keypairs-backup-20261008.tar.gz` before and after this triage. Eight seats were requested and all eight returned `finish: stop` on the first run; there is no `failed/` directory and no re-run manifest. I count six of eight against a required six. Quorum is met with no margin, and it depends on counting DeepSeek narrowly (reasons below).**

**Eight findings are confirmed: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 4 LOW, 4 INFO.** None is in the five programs. None moves value out of a vault, the pool or the revenue address, none credits value wrongly, none stops or wrongly refuses a crack, and none is HIGH or MEDIUM. Under SPEC ship gate 3's launch gate (RULING, Gary 2026-10-08) the pass is **LAUNCH-CLEAN**.

**It is not a no-change round.** Every confirmed finding needs a change to the driver, the web build, the ceremony page or SPEC text, so Gary's 2026-10-09 test ("a clean round where we make NO changes") is not met by this pass. None of the eight is an accepted limit already stated in SPEC.

**The most urgent one is this triage's own, and it is live now.** V46-8: the mainnet dress rehearsal cannot initialize anything. Its init key (the localnet `INIT_AUTHORITY`, `Keypair.fromSeed([7;32])` = `GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB`) is, on mainnet, an account owned by program `7DiXsBWmwJ8WQZdgoyyic1wh5FGtib3Xe8vtfugSwhXG` with 9 bytes of data, and every `initialize` pays from it. The rehearsal running now from `/home/ubuntu/cbob-rehearsal` (made from `63a92b2`) deployed its five throwaway programs and then stopped at `ceremony-collection` with exactly that refusal ("Transfer: `from` must not carry data"), nothing sent. It needs a fix before it can go on (details at V46-8).

## Auditor dispositions

**Manifest.** `MANIFEST-programs.json` records head `63a92b2…`, `dirty: []`, `promptChars` 1,962,611, requested 8, auditors 8, required 6. All eight entries are `ok: true`, `finish: stop`, `disqualified: null`, 14,033 to 38,763 characters. The eight files on disk match those sizes within a few bytes of trailing text. No seat was re-run, so there is nothing in `failed/` to exclude.

I read all eight reports in full and did not take the runner's count on trust. `bank/*.mjs` other than `rehearsal-env.mjs`, `txread.mjs` and `sigwalk.mjs` is in the off-chain pass, so a seat that says it cannot see `alarm.mjs`, `crank.mjs`, `revenue.mjs` or `selftest.mjs` is correct.

| Auditor | Disposition |
|---|---|
| anthropic/claude-opus-5.5 | **Counted.** 16,575 characters. The only seat that attacked the round-45 repairs as repairs rather than listing them. Its R0 table judges each of V45-1 to V45-11 against named constructs (`judgeForcedFailureAlarm`, `solanaArgv`, `judgeDeployKey`, `nextAction`'s `resumable` gate, `requiresVerified`, `sendRecorded`, `checkNewAddress`), and it re-derives the pool invariant, the rate-limit ring and every pinned MINT/BURN/VaultRecord offset correctly.<br>**Confirmed:** F46-1 (V46-1), F46-2 (V46-2), F46-3 (V46-3), F46-4 (V46-4), and its accepted-limits point on SPEC 53 (V46-7).<br>**Not confirmed:** its item-22 scale point is already stated (C14); its 22.2 caveat is the safe direction (C15). |
| deepseek/deepseek-v4-pro-0813 | **Counted, narrowly.** 27,056 characters. Opens "Of course. Here is my…" and R1 to R8 are mostly a restatement of the design. But its R0 checks each round-45 repair against this tree's own constructs, and every one I checked is right: `ALARM_GRACE_MS`, `judgeForcedFailureAlarm` by kind, `judgeDas`, `judgeAlarmPass`, `solanaArgv` with `--config`, `judgeArgv`, `judgeDeployKey`, `bufferCloseArgv`, `rescue`'s `resumable: true`, `closedCycles().length >= n`, `requiresVerified`, `rpcResolved`, "PASS at 5 vaults (scale not exercised)", `sendRecorded` before the send, `checkNewAddress`. Its run-tests claim is true (`DET_FLOOR` 1004 to 1032 with the round-45 arms). R1's BURN reads (`d[72..76]`, `d[129..133]`, `d.len() == 165`) are right.<br>Against it: its R0 conclusion "repaired at all sites of their shape" is wrong (V46-1). Its R1s(b) has reasoning errors about real constructs: a delegate does not stop the owner's transfer, and "destination twice" does not close the destination. Its limit-47 nuance is already in SPEC (C24). These are errors about real code, not invented contents, which is round 45's line for MiMo. It files no finding. **Without it, quorum fails (5 of 6).** |
| fireworks/ember-1 | **Counted.** 16,693 characters. Engaged: it walks every repair at its site, re-derives the boost ring's no-collision argument, the full MintConfig sum (1,261) and the VaultRecord offsets, and it checks the pages' builders against the programs' account structs. Its one finding, W46-1, quotes the real `named` set verbatim but misreads the order in which it is built. That is disproved (C9), a reasoning error about a real construct. |
| minimax/minimax-m3 | **Not counted.** 15,866 characters. It audits "the working tree at `0d58d4e`", round 45's head, and its CRITICAL is invented contents. It says `apply_swap_operator` uses `require_keys_eq!` and that the suite never calls apply. The code is `require_keys_neq!` (`mint/src/lib.rs:841`), and arm 3c.K5 calls `apply_swap_operator` after the notice and checks the new key is live (`tests/3prog.test.ts:3813-3818`). Its other items are triaged (C10 to C13). |
| qwen/qwen3.8-max-prime | **Counted.** 14,033 characters. Shallow, but its claims are specific and true, and it states its method honestly (source only, nothing run). It gives a site per repair, notes that `token-programs.sh`'s URL is the public no-key one, recomputes the MintConfig offsets correctly, and checks the four accepted-limit questions against named items. Its OBS-1 and OBS-3 are verification gaps of the bundle, not defects. I settled both by measurement (C16). |
| sakana/fugu-max | **Counted.** 38,763 characters. The widest read: every account space recomputed (MINT 1,261, VaultRecord 221, BurnConfig 827, GovConfig 350, SEAL 398), the proxy's `mint-boosts` slice, and the build's both-builds key proof.<br>**Confirmed:** F1 (V46-5, measured on a copy) and F2 (V46-6, narrowed).<br>**Not confirmed:** its operational blocker is already stated (C18). Its weak arms, limit-40 fourth consequence, limit-2 qualification and item-11/limit-54 notes are self-dismissed or not defects (C19 to C22). |
| x-ai/grok-4.20 | **Not counted.** 15,335 characters. A summary.<br>• Its R0 names none of round 45's repair constructs. It repeats round 45's triage as its own ("measured on a copy of the detector and full local proof at 0d58d4e").<br>• Every section says "re-tested on current tree" from a seat that ran nothing.<br>• Its R1s(b) credits the helper with refusals the code does not make: a native wSOL source, a non-ATA destination and another vault's signer are all accepted (`sweep/src/lib.rs:54-60` checks the destination's owner and mint only, and only `signer == dest` is refused) (C25).<br>• Its R8 example is wrong (C26).<br>Its R7 offset list is correct at all 46 offsets (I recomputed every one from the structs), but one correct table inside a summary that invents behaviour is not an audit of this tree. Counting it would make quorum 7 of 8. |
| z-ai/glm-5.3-prime | **Counted.** 16,708 characters. Specific and engaged: `alarmCriticalKinds`, `judgeRpcArg` requiring `box` on mainnet, `judgeRevenueCycles`' PARTIAL with cause, sweep-back's roles including `pob-authority`, `cbob-release` and the INIT dust, and `refuseStrayOverrides` (true: `alarm.mjs:65`, `revenue.mjs:64`, `crank.mjs:613`). It checks the pages' transactions against SPEC 50. Its W46-1 is disproved (C9, same as Ember's). Its limit-40 point is self-judged wording (C20). |

**Quorum: 6 counted of 8 seats, 6 required. MET, with no margin.**
- **Excluded:** MiniMax, which audits round 45's head and invents the code behind its CRITICAL, and Grok, a summary that invents helper behaviour.
- **Counted narrowly:** DeepSeek. Its R0 is a true check of this tree's repairs; the rest is restatement with reasoning errors. Excluding it makes the pass QUORUM NOT MET. I count it because what it says about the round-45 record and this tree is specific, checkable and true, and I say so plainly so the margin is not mistaken for comfort.

## Method and evidence

- **Records read:** this brief (`.cache/TRIAGE-BRIEF-r46.md`), all eight reports, the manifest, round 45's `VERDICT-programs.md`, `VERDICT-offchain.md` and `VALIDATION.md`, SPEC item 22 (`:1897-1923`), item 53 (`:2176-2262`), limit 47 (`:1741-1750`).
- **Source read at `63a92b2`:** all of `scripts/rehearsal-run.mjs` (the judges, `nextAction`, the main loop), `scripts/rehearsal-steps.mjs` and `scripts/rehearsal-recover.mjs`; `web/build.mjs`, `web/src/config.js` (profiles, `activeProfile`), `web/src/pages/ceremony.mjs` (`run`, `preflight`), `web/src/lib/plan-redeem.mjs` (the cross-check and `groupAcks`), `web/src/lib/reads.mjs` (`wrap`, `account`). In the programs: `apply_swap_operator` and its siblings, `set_round`, MINT's `initialize` checks, `boost_vault`'s burn, every `payer =` in the four Anchor programs, BURN's emptiness checks, and the sweep helper's destination check.
- **Allowed runs at `63a92b2`** (logs in `/tmp/claude-1000/triage46p/`):
  - `node web/test/run-all.mjs`: **695/695** in 10 files at their floors (`bundle` 83/83). Exit 0.
  - `node bank/selftest.mjs`: **1032/1032**. Exit 0.
  - `node scripts/check-launch-params.mjs --selftest`: **68/68**. Exit 0.
  - `node bank/redemption-poster.mjs --selftest`: **24/24**. Exit 0.
  - `node bank/accrual.mjs --selftest`: **39/39**. Exit 0.
- **Canonical logs, read:**
  - `.cache/e7c192a-suite.log`: RC 0, on-chain **912/912**, probe 35/35, fork 16/16.
  - `.cache/e7c192a-web-e2e.log`: **132/132**, RC 0.
  - `.cache/e7c192a-sim.log`: **71/71**, RC 0.
  - `/tmp/claude-1000/rehearsal-proof-e7c192a.log` (item 53): RC 0, 16/16.
  - `/tmp/claude-1000/driver-local-e7c192a.log`: RC 0, every step through `sweep-deployer`.

  Unlike round 45's, all three canonical `e7c192a` logs are green.
- **Measurement on a copy (V46-5).** I rsynced the repository (without `target`, `.git`, `.cache`, `web/dist*` and `web/test/.out`) to `/tmp/claude-1000/triage46p/c0`. I rewrote every absolute `/opt/cbob-vaults` path inside the copy to the copy's root; 63 files are listed in `rewritten.txt`, and in `web/build.mjs` and `web/src/config.js` they were comments. Then (`f1.log`):

  | Build | Result |
  |---|---|
  | `--profile mainnet --rpc https://example.invalid` | exit 1, "build refused" |
  | `--profile mainnet-local --rpc https://example.invalid` | **exit 0**. `BUILD.txt`: `profile mainnet-local + overrides ["rpc"]`, `rpc https://example.invalid`; the URL is in the ceremony bundle |
  | `--profile mainnet-local`, no flag, for control | exit 0; its ceremony `app.js` hash differs from the overridden one |
- **Mainnet reads (V46-8), read-only, public endpoint (`api.mainnet-beta.solana.com`), no key, nothing sent:**

  | Read | Result |
  |---|---|
  | `getAccountInfo` of `GmaDrpp…` (= `Keypair.fromSeed([7;32])`, derived) | owner `7DiXsBWmwJ8WQZdgoyyic1wh5FGtib3Xe8vtfugSwhXG`, `space` 9, 523,014,522 lamports |
  | the owner | an executable upgradeable-loader program |
  | `getSignaturesForAddress` of `GmaDrpp…` | 82 signatures, 2024-08-02 to 2026-10-01; none today |
  | `getAccountInfo` of `Hc6WGt2k…`, the real mainnet `INIT_AUTHORITY` | System-owned, `space` 0 |
- **The live rehearsal, read-only** (`/home/ubuntu/cbob-rehearsal`; no process found running; nothing written):
  - `REHEARSAL-RECORD.txt` names source commit `63a92b2`.
  - `.rehearsal-run/mainnet-state.json`, step names, statuses and times only:
    - `keys` through `deploy-5` are done, from 12:09:59 to 12:12:26 UTC.
    - `deploy-4` failed once and was retried.
    - `fill-values` is done at 12:10:55.
    - `ceremony-collection` is `unknown`, with 0 signatures and the error `simulation refused: {"InstructionError":[1,"InvalidArgument"]} … CreateCollectionV2 | … Transfer: \`from\` must not carry data`.
  - The filled file's `charter_opens_at` is 1791549654 (12:40:54 UTC), and `charter_secs` is 1800.
- **Not run:** no validator, `scripts/run-tests.sh`, `web/test/e2e-localnet.sh`, sim, the rehearsal driver, `bank/alarm.mjs`, crank, revenue job, or any live, money or notification job. Nothing under `/opt` or `/home/ubuntu/cbob-rehearsal` was written except this verdict.

## Distinct claims

Class column: (a) a finding in the five programs; (b) a value path, or a wrong credit; (c) a stopped or wrongly refused crack; (d) HIGH or MEDIUM anywhere; "none" means outside all four.

| ID | Reporters | Claimed | Verdict | Class | Evidence (file:line) |
|---|---|---|---|---|---|
| C1 | Opus F46-1 | LOW | **CONFIRMED, LOW (V46-1)** | none | `rehearsal-run.mjs:234-246` (`landed` and not done is `stop` unless `--resume`), `:395`, `:415`; only `rescue` and `revenue-forced-failure` carry `{ resumable: true }` (`rehearsal-steps.mjs:560,610`); same shape at `sale-round` (`:414-439`), `deposit-activate` (`:462-475`), `revenue-cycle-n` (`:525-540`), `ceremony-collection` (`:310-329`, `done` needs `st.collection`, set after the send), `crack` (`:615-631`), `sweep-back` (`:650-667`) |
| C2 | Opus F46-2 | LOW | **CONFIRMED, LOW (V46-2)** | none | `rehearsal-steps.mjs:273` (`charter_opens_at = now + 1800`, before `fund-deployer` and `deploy-1..5`), `:263` (`done()`'s re-fill predicate), `rehearsal-run.mjs:401,235` (`done` status never consults `done()`); `launch/rehearsal-init.json` `charter_secs` 1800; MINT `initialize` `charter_closes_at > Clock` (`mint/src/lib.rs:615`); claim refuses outside the window (`:1165-1191`) |
| C3 | Opus F46-3 | INFO | **CONFIRMED, INFO (V46-3)** | none | `rehearsal-steps.mjs:597-600` (`nestedSent` set only on the sending branch), `:592` (`done` needs `nestedSent`) |
| C4 | Opus F46-4 | INFO | **CONFIRMED, INFO (V46-4)** | none | `rehearsal-recover.mjs:56` (a landed `pendingSwapSig` throws "finish the return by hand"), `:52` (any closed cycle makes the next call throw); `rehearsal-steps.mjs:579-588` (`handRecovered` only through `handRecover`) |
| C5 | Fugu F1 | LOW | **CONFIRMED, LOW (V46-5)**, measured | none | `web/build.mjs:58` (refuses overrides only for `'mainnet'`), `web/src/config.js:168` (`mainnet-local` = mainnet plus same-origin RPC), `:200` (applies overrides for any profile not named `'mainnet'`); `f1.log` |
| C6 | Fugu F2 | INFO | **CONFIRMED, INFO (V46-6)**, narrowed | none | `ceremony.mjs:113-117` (a refused value box is appended, then the pass continues), `:139-143` (`account(conn, null)`), `reads.mjs:23-31` (`new PublicKey(null)` becomes "Could not read a mint from the network … try again"), `ceremony.mjs:38` (shown as a refuse box; "NOT READY" at `:77` never prints). The refusal list IS shown, contrary to the claim |
| C7 | Opus (accepted-limits Q4) | INFO | **CONFIRMED, INFO (V46-7)** | none | SPEC `:2197-2202` ("that proof is of `d57ee3a` and is STALE; it must be re-run at the release commit, which is why this item stays OPEN") against `audits/round45/VALIDATION.md` ("Item 53, re-proven at the release commit", `e7c192a`, log RC 0) |
| C8 | **triage only** | - | **CONFIRMED, LOW (V46-8)**, measured on mainnet and observed live | none | `rehearsal-steps.mjs:43` (`INIT = Keypair.fromSeed(Buffer.alloc(32, 7))`), `:323` (collection create pays from INIT), `:98-111` (`sendWithInit`); `payer = authority` at SEAL `cbob-vaults/src/lib.rs:365`, MINT `:2557`, BURN `:486`, GOV `:815`; mainnet reads above; live `ceremony-collection` error |
| C9 | Ember W46-1; GLM W46-1 (same text) | LOW | **DISPROVED** | none | `plan-redeem.mjs:240` builds `named` before `unlisted:*`/`nfts:*` are pushed (`:245-253`) and before `groupAcks` (`:263`, `:352-363`); the only non-address id present then is `forfeit` (`:95`), which yields `''`, skipped by `a &&` (`:242`). Every other id there is `left:`/`lost:`/`asset:`/`cnft:<address>` (`:214-234`) |
| C10 | MiniMax CRITICAL (`apply_swap_operator` inverted) | CRITICAL, (a) | **DISPROVED** (invented contents) | none | `mint/src/lib.rs:841` is `require_keys_neq!`; 3c.K5 (`tests/3prog.test.ts:3813-3818`) waits the notice, calls apply, and requires the new operator live; 3c.K5a the old one refused; both in 912/912 |
| C11 | MiniMax LOW ($CBOB decimals unchecked) | LOW, (a) | **NOT A DEFECT** | none | `boost_price` is stored and burned in base units (`mint/src/lib.rs:1499-1514`, SPL Burn of `price`); nothing converts by decimals, so nothing can convert wrongly; the mint is pinned once (`:573-578`). Its own text says decimals are ruled and it is not a mainnet defect |
| C12 | MiniMax LOW (`SetRound.cap` not bounded by remaining supply) | LOW, (a) | **NOT A DEFECT** | none | A round cap is a per-round ceiling; supply is enforced at mint by `check_supply` and the level caps. GOV pre-checks what MINT checks (`gov/src/lib.rs:345-350`; `mint/src/lib.rs:966-987`). A large cap mints nothing extra |
| C13 | MiniMax INFOs (charter double-claim by tombstone; small-supply rate cap; boost ring; `try_capture` offsets; no `migrate`) | INFO | **NOT A DEFECT / ALREADY-STATED** | none | Self-dismissed. Its "fewer than 10 vaults" is wrong arithmetic: `ceil(live·210/10000)` is 1 up to live 47 (SPEC limit 32). No `migrate` is item 38 |
| C14 | Opus (item 22's 2,100-vault scale has no exit) | INFO | **ALREADY-STATED** | none | SPEC `:1906-1909` ("the ~2,100-vault scale stays open after it"); item 22 is OPEN AND BLOCKING ("must be exercised … before it pays anyone") |
| C15 | Opus (22.2's explained list may FAIL pass 2 by design) | (caveat) | **NOT A DEFECT** | none | `rehearsal-steps.mjs:495-497`; the direction is FAIL, never a false PASS |
| C16 | Qwen OBS-1, OBS-3 (off-chain repairs and gate-5 arms not visible) | INFO | **NOT A DEFECT**; settled by measurement | none | `refuseStrayOverrides()` at load in `alarm.mjs:65`, `revenue.mjs:64`, at the top of `crank.mjs` main `:613`; `bank/selftest.mjs` carries V45-1 ×5, V45-2 ×3, V45-3 ×7, V45-4 ×3 … and V45o arms, in today's 1032/1032 |
| C17 | Qwen OBS-2 | (epistemic) | not a claim about the tree | none | - |
| C18 | Fugu (`.cache` and the key tarball make `build-mainnet.sh` refuse) | (operational) | **ALREADY-STATED** (round 45 limits); still true today | none | `git status --porcelain` above |
| C19 | Fugu (adjacent-log-line pins, SR.12b, L.12 shape-only) | (weak, not wrong) | **NOT A DEFECT** | none | Self-labelled; none can pass falsely today |
| C20 | Fugu (a fourth Core-upgrade consequence); GLM (limit 40 omits the 30-minute sampling gap) | (wording) | **NOT A DEFECT** | none | Both self-judged the same "a Core change can halt everything; the alarm detects, cannot prevent" statement |
| C21 | Fugu (limit 2 discharged only as far as the page's naming is a superset) | (reading) | **NOT A DEFECT here** | none | The cross-check's inputs are off-chain-pass files; C9 shows the cross-check's `named` set is address-only |
| C22 | Fugu (item 11 wording; limit 54 vacuous for the current pages) | (wording) | **NOT A DEFECT** | none | Self-dismissed |
| C23 | DeepSeek R1s(b) (delegate blocks the transfer; "destination twice" closes the destination) | (statements) | **DISPROVED** as statements; no finding filed | none | `sweep/src/lib.rs:54-70` transfers as owner and closes the SOURCE |
| C24 | DeepSeek (limit 47 omits "cancel a pending operator"; limit 46 selective admission) | (nuance) | **ALREADY-STATED** | none | SPEC `:1744` ("and cancel any…"), `:92`, `:354`; SPEC 46 |
| C25 | Grok R1s(b) (wSOL, non-ATA destination, another vault's signer refused) | (statements) | **DISPROVED** | none | `sweep/src/lib.rs:45-60`: data `[0]`, the destination's owner and mint, `signer != dest`; nothing else |
| C26 | Grok R8 (3.3 can pass on `ReserveHasExtensions`) | (statement) | **DISPROVED** | none | `burn/src/lib.rs:342-345` (delegate checks precede the length check); `because('3.3','ReserveDelegated')` (`tests/3prog.test.ts:3947`) |
| C27 | Ember, GLM, Qwen, Opus, Fugu, DeepSeek (round 45's disproofs re-tested: BURN `[129..133]`, Muse's 0.1 SOL, Qwen's MINT items) | (agree) | **ALREADY SETTLED** (round 45 C12-C14) | none | Re-read at `63a92b2`; unchanged |

## Confirmed findings

**V46-1: LOW.** Reporter: Opus F46-1.

**Round 45's V45-4 repair gave two steps a resume. Its general case, "every multi-transaction step needs a documented resume", is unrepaired.**
- **The rule.** `nextAction` returns `stop` for any step whose recorded signature landed while `done()` is false, and `run` only under `--resume` for a step marked `resumable` (`rehearsal-run.mjs:234-246`, `:395`). Two steps carry the mark.
- **The same shape elsewhere.** Six more steps send through `send()`, which records the signature first, and decide `done()` from something that finishes later:
  - `sale-round`: create, three votes, then execute after the vote ends;
  - `deposit-activate`: the deposit, then activation;
  - `revenue-cycle-n`: a landed top-up, then the job;
  - `ceremony-collection`: `done` needs `st.collection`, written after `sendWithInit` returns;
  - `crack`: prior transactions, then the redemption;
  - `sweep-back`: about nine sends.
- **The trigger.** Any lost confirmation, or any interruption between sends, leaves a landed signature. The votes wait out `min_voting_secs`, and the revenue job can fail after the top-up landed. Every rerun then STOPs with "Never edit the state file by hand", and `--resume` is refused as "no RESUMABLE step". The run bodies already re-read the chain (proposal and vote PDAs, top-up to target, re-plan, balances), so the mark is all that is missing.
- **Why it matters on mainnet.** A wedge after value has moved: tokens in vault-1's deposit address, SOL on throwaway keys. It invites the hand edit the driver forbids.

**LOW:** an incomplete repair of a confirmed LOW, of the same severity. Fails closed. **Class: none.** Rehearsal tooling; no program, no production value, no crack.

**Repair:** mark every step whose run is idempotent on read-back as `resumable`, and make `ceremony-collection`'s `done` chain-based (`st.collectionKey`'s address Core-owned and passing `readStep`). Add a selftest arm that enumerates the steps that send more than once, or whose `done` reads state written after a send, and requires `resumable`.

**V46-2: LOW.** Reporter: Opus F46-2.

**V45-6's reorder starts the charter clock before the five deploys, and the step's own re-fill guard is dead code.**
- **The clock.** `fill-values` sets `charter_opens_at = now + 1800` with `charter_secs` 1800 (`rehearsal-steps.mjs:273`), and now runs before `fund-deployer` and `deploy-1..5`. MINT `initialize` requires `charter_closes_at > Clock` (`mint/src/lib.rs:615`), and a claim refuses outside the window. So deploys, the ceremony and three claims must all land within about 3,600 s of `fill-values`.
- **The dead guard.** `fill-values`' `done()` returns false when MINT is not yet initialized and the window is under 240 s away (`:263`), which is a re-fill. But a step recorded `done` is skipped without consulting `done()` (`rehearsal-run.mjs:401`, `nextAction`'s first line), so the re-fill can never happen. `--step fill-values` skips it the same way.
- **What happens past the budget.**
  - `ceremony-mint`'s simulation refuses `BadCharterWindow` before any signature is recorded, so `none-landed` reruns it into the same refusal, forever.
  - Or the window closes before `claim-3`.

  Recovery is a hand edit or a new tree.
- **Today's numbers.** The live mainnet run's deploys took about 90 s. Its `fill-values` landed at 12:10:55, so its window closes at 13:10:54. It stopped at 12:12:26 (V46-8). Any operator pause to investigate a STOP for about an hour exhausts the budget, independently of V46-8.

**LOW:** a liveness wedge of the rehearsal, fail-closed, costing a redeploy. **Class: none.**

**Repair:** fill the keys before the deploys but set the date in a separate step immediately before `ceremony-collection`. Or let the runner consult `fill-values`' `done()` while MINT's config is absent. One selftest arm either way.

**V46-3: INFO.** Reporter: Opus F46-3.

**`rescue` repeats a whole cycle after a lost nesting confirmation.** `st.nestedSent` is set only on the branch that sends the nest (`rehearsal-steps.mjs:597-600`).
1. If that transfer lands and its confirmation is lost, `--resume rescue` sees vault-3 already at the nest PDA, has the crank rescue it, returns it, and records `rescued`.
2. `done()` still needs `nestedSent` (`:592`), so the runner stops with "read-back does not show it done".
3. A second `--resume` nests vault-3 again and repeats the rescue.

That is not a brick, but it costs a cycle and leaves confusing evidence. **Class: none.** **Repair:** set `nestedSent` whenever vault-3's owner is the nest PDA or the treasury.

**V46-4: INFO.** Reporter: Opus F46-4.

**The scripted hand recovery cannot finish after a landed but unconfirmed hand swap, and the driver can then never record item 22.4.**
- `handRecover` correctly refuses to swap again when `pendingSwapSig` landed, and tells the operator to "finish the return by hand" (`rehearsal-recover.mjs:56`).
- `revenue-hand-recovery` has no signatures of its own and sets `handRecovered` only through `handRecover` (`rehearsal-steps.mjs:579-588`).
- Once the operator closes the cycle by hand, `handRecover` throws "expected exactly one open cycle, found 0" (`:52`).

So 22.4 ends NOT RUN whatever was done. **Class: none.** **Repair:** when `pendingSwapSig` landed and no return is recorded, read the operator's cbBTC against `operatorSatsBefore` and continue with the return and split (each through `sendRecorded`). Accept an already-closed hand-recovered cycle as done.

**V46-5: LOW.** Reporter: Fugu F1. Measured.

**The build's override refusal is keyed on the profile NAME `mainnet`, so `mainnet-local`, the profile of the ceremony's recommended local mode, accepts `--rpc`, `--collection` and `--launch-json`.**
- **The two guards.** `web/build.mjs:58` and `web/src/config.js:200` both compare against `'mainnet'`.
- **What the README promises.** `mainnet-local` is "mainnet values; RPC = the server that served the page" (`web/README.md:331`).
- **Measured.** `--profile mainnet-local --rpc https://example.invalid` exits 0, and the URL is in the ceremony bundle; the same flag on `mainnet` is refused.
- **Contained by other checks:**
  - `--launch-json` changes nothing signed, because `mainnet-local` keeps `launchJudge: 'mainnet'`, and the ceremony uses the bundled `LAUNCH` (`ceremony.mjs:40`).
  - `--collection` is held by the page's own pin and conflict checks.
- **Not contained.** `--rpc` makes every read-back, every simulation and the genesis check come from that endpoint, which defeats the property local mode exists for: "the page trusts only the server that served it".
- **Detection.** The footer's `app.js` hash, compared with the README table, would differ.

**LOW:** a guard whose stated property is not enforced on the one profile that most needs it, reachable by an operator's flag; no holder value. Same grade as Fugu's and as round 45's V45-3 shape. **Class: none.**

**Repair:** refuse overrides on every profile with `launchJudge === 'mainnet'` (or a `published` flag), in both places. Add one bundle-test arm on `mainnet-local --rpc`.

**V46-6: INFO.** Reporter: Fugu F2. Narrowed.

**With a null mint in the value file, the ceremony's preflight ends in a misleading network error instead of NOT READY.**
- `preflight` appends the refused-values box and continues (`ceremony.mjs:113-117`).
- Then `account(conn, null)` throws inside `wrap`, which reports "Could not read a mint from the network (…). Nothing was done; try again." (`reads.mjs:23-31`).
- The top-level handler shows that as a refuse box (`:38`). The NOT READY line and the mint and step-9 lines are not shown.

The claim that the list of OPEN values is lost is wrong: it is already on the page. The mainnet file has `cbob_mint` and `reserve_mints` RULED, and the documented rehearsal build passes a filled file (`web/README.md:375-381`), so the trigger is an unfilled file on a non-mainnet profile. **Class: none.** **Repair:** `if (fails.length) return null` after the value checks, or skip a null mint.

**V46-7: INFO.** Reporter: Opus.

**SPEC item 53 still says its in-tree proof is stale and is "why this item stays OPEN".** SPEC `:2197-2202` dates the proof at `d57ee3a` and says it must be re-run at the release commit. Round 45's VALIDATION records it re-proven at `e7c192a` (`rehearsal-proof-e7c192a.log`, RC 0, read), and `63a92b2` differs only in audit files. The text is behind the record, in the conservative direction. Item 53 may stay OPEN for the dress rehearsal itself, but not for this reason. Round 45 V45-9 (SPEC 53 alarm text) is the precedent. **Class: none.** **Repair:** record the `e7c192a` re-proof and state what still keeps item 53 open.

**V46-8: LOW.** This triage only. Measured on mainnet, and observed in the live run.

**The box-signed mainnet dress rehearsal cannot initialize any program: on mainnet, its init key cannot pay, and every `initialize` makes it pay.**
- **The key.** The rehearsal's `INIT` is `Keypair.fromSeed([7;32])` (`rehearsal-steps.mjs:43`), the localnet `INIT_AUTHORITY` the rehearsal build compiles in (RULED 2026-10-08). On mainnet, that address is owned by program `7DiXsBWm…`, carries 9 bytes of data and holds 0.523 SOL. It has had 82 transactions since 2024-08-02, none today: a widely used test seed that someone assigned to a program before this rehearsal existed.
- **Why it cannot pay.** The System program refuses a transfer from an account that carries data.
- **What makes it pay.** All four Anchor `initialize` contexts say `payer = authority` (SEAL `:365`, MINT `:2557`, BURN `:486`, GOV `:815`), and the driver's Core collection create names INIT as payer (`:323`).
- **What it costs.** The ceremony cannot proceed with this key at all. The local proof could not see this, because a fresh validator's seed-7 account is an empty System account.
- **Observed.** The run in `/home/ubuntu/cbob-rehearsal`, made from `63a92b2`, funded its roles, filled values, deployed all five throwaway programs, then stopped at `ceremony-collection`: `simulation refused: … CreateCollectionV2 | … Transfer: \`from\` must not carry data`, 0 signatures.
- **Nothing preflights it.** No driver check looks at INIT's mainnet account before the deploys spend rent.
- **What it does NOT touch:**
  - The real launch key `Hc6WGt2k…` is a plain System account (read).
  - No program changes behaviour.
  - Nobody can initialize the stranded throwaway programs either, because the payer must be that same key. They are inert, and the deployer can close them for their rent.

**LOW:** a certain, fail-closed blocker of road step 8 as ruled, with no holder value at risk. Round 44's V44-1 (the rehearsal ceremony could not consume its value file) is the precedent. **Class: none.**

**Repair (tooling, plus Gary's ruling, since it changes the RULED rehearsal design):**
- Extend `rehearsal-tree.sh`'s recorded substitution to swap the localnet `INIT_AUTHORITY` for a fresh throwaway key generated with the tree, alongside the program ids. The audited source and the mainnet build stay untouched, and the public-seed exposure V45-6 worked around disappears.
- Make the driver refuse, before `fund-deployer`, unless INIT's account is absent or System-owned with empty data.
- For the run now stopped: close its five programs (rent returns) and make a new tree.

### The documentation exception (SPEC gate 3, ruling of 2026-10-07)

- V46-1 to V46-6 and V46-8 change code. **Not eligible.**
- V46-7 is text and misstates nothing about holders' money. It would qualify if corrected and re-verified, but cannot make the round a no-change round alone.

## Rounds 41 to 45 re-check, per confirmed finding

I re-read each verdict's mechanism against `63a92b2` and classified it again. The programs are byte-identical to the release every round judged.

| Finding | Severity | (a) programs | (b) value | (c) crack | (d) H/M | Outside (a)-(d)? |
|---|---|---|---|---|---|---|
| R41 **V41-1** dusting a config PDA made the ceremony refuse | LOW | No (page reads) | No | No (ceremony) | No | **Yes** |
| R41o **C01** poster drafted per transaction | LOW | No | No (drafts) | No | No | **Yes** |
| R41o **C02** oracle-age arm pinned only by its constant | LOW | No (`selftest.mjs`) | No (SW.7a, 912/912) | No | No | **Yes** |
| R41o **C03** SPEC crank fee-budget sentence | INFO | No | No | No | No | **Yes** |
| R42 **V42-1** malformed path crashed the local ceremony server | INFO | No | No | No | No | **Yes** |
| R42 **V42-2** an earlier transaction hid the collection create | INFO | No | No | No | No | **Yes** |
| R42o **C01** omitted vaults lost their alarm baseline | LOW | No (`alarm.mjs`) | No (detection) | No | No | **Yes** |
| R43 **V43-1** a host's owner keeps a nested vault by Executing it out in their own opening | LOW | No program defect against the ruled design (SPEC limit 58) | No (an owner takes from their own wallet in their own crack) | No | No | **Yes** |
| R43 **V43-2** e2e header described the old rescue rule | INFO | No | No | No | No | **Yes** |
| R43o **V43o-1** release check died in the rehearsal tree | LOW | No (`run-tests.sh`) | No | No | No | **Yes** |
| R43o **V43o-2** one unreadable signature froze a scan | LOW | No | No | No | No | **Yes** |
| R43o **V43o-3** reveal-skip arm could not fail | LOW | No | No | No | No | **Yes** |
| R44 **V44-1** rehearsal ceremony could not consume the value file | LOW | No | No | No | No | **Yes** |
| R44 **V44-2** `release_gate` accepted any reversible swap | LOW | No | No | No | No | **Yes** |
| R44 **V44-3** coverage gate could not credit LAUNCH-CLEAN | LOW | No | No | No | No | **Yes** |
| R44 **V44-4** RULED missing from the legend; "redeploy" remedy | INFO | No | No | No | No | **Yes** |
| R44 **V44-5** limit 59 cited the test validator's rent | INFO | No | No | No | No | **Yes** |
| R44 **V44-6** "the one exception" omitted the bare burn | INFO | No (programs credit as SPEC states) | No | No | No | **Yes** |
| R44 **V44-7** absent pinned collection shown as BROKEN | INFO | No | No | No | No | **Yes** |
| R44o **V44o-1** poster skip never fired while a backlog drained | LOW | No | No | No | No | **Yes** |
| R44o **V44o-2** split-recovery scan died on one refused signature | LOW | No (`revenue.mjs`) | No (the job stops; balances stay) | No | No | **Yes** |
| R44o **V44o-3** null SEAL read dropped reserve baselines | LOW | No | No (detection) | No | No | **Yes** |
| R44o **V44o-4** no-network runner exit 1 | INFO | No | No | No | No | **Yes** |
| R44o **V44o-5** runbook did not cover the off-chain jobs | INFO | No | No | No | No | **Yes** |
| R45 **V45-1** item-22 predicates could pass without their evidence | LOW | No (driver) | No | No | No | **Yes**. Repaired (`rehearsal-run.mjs` judges; `revenue-forced-alarm` waits the grace) |
| R45 **V45-2** `--rpc box` put the key in argv | LOW | No | No | No | No | **Yes**. Repaired (`solanaArgv`, `judgeArgv`) |
| R45 **V45-3** deploy key not tied to the judged id | LOW | No | No (no real program touched) | No | No | **Yes**. Repaired (`judgeDeployKey`, throwaway `deployer`, recorded buffers only; the live run's `deployed()` read the deployer as upgrade authority) |
| R45 **V45-4** rescue bricked on a lost confirmation | LOW | No | No | No | No | **Yes**. Repaired for `rescue` and the forced failure only; the general case is V46-1 |
| R45 **V45-5** cycle 1 judged by venue order | LOW | No | No | No | No | **Yes**. Repaired (`closedCycles().length`, `judgeRevenueCycles`) |
| R45 **V45-6** init window not "at once" | INFO | No | No | No | No | **Yes**. Repaired (prep first, `requiresVerified`); the reorder introduced V46-2 |
| R45 **V45-7** `'box'` as DAS URL; sweep-back scope | INFO | No | No | No | No | **Yes**. Repaired |
| R45 **V45-8** 22.1 PASS at 5 vaults | INFO | No | No | No | No | **Yes**. Repaired (label and SPEC 22 text) |
| R45 **V45-9** SPEC 53 alarm text stale | INFO | No | No | No | No | **Yes**. Repaired |
| R45 **V45-10** hand recovery recorded signatures late | INFO | No | No | No | No | **Yes**. Repaired (`sendRecorded`); V46-4 is the remaining manual edge |
| R45 **V45-11** collection create lacked the taken check | INFO | No | No | No | No | **Yes**. Repaired (`checkNewAddress`) |
| R45o **V45o-1** null SEAL invented "no reserve mints" in two places | LOW | No (`alarm.mjs`) | No (detection) | No | No | **Yes** |
| R45o **V45o-2** forced-failure switches read after the sweep | LOW | No (`revenue.mjs`) | No (the ordinary capped sweep to the Bank's own operator key, limit 10's open-cycle state) | No | No | **Yes**. Repaired (`refuseStrayOverrides()` at `revenue.mjs:64`) |
| R45o **V45o-3** frozen-pool overdue text blamed the crank | INFO | No | No | No | No | **Yes** |
| R45o **V45o-4** a flood could reset the unreadable count | INFO | No | No | No | No | **Yes** |
| R45o **V45o-5** coverage selftest red on a never-bundled file | INFO | No | No | No | No | **Yes** |
| R45o **V45o-6** `budgetPlan` low-key wording | INFO | No | No | No | No | **Yes** |
| R45o **V45o-7** prompt described the wrong round; split bundles | INFO | No | No | No | No | **Yes** |

**All forty-two are outside (a)-(d).** Rounds 41 and 42 stand as the two launch-clean rounds on their confirmed findings. Rounds 43 to 45 confirmed the trees their predecessors' repairs changed. Round 45's repairs hold at every site I checked. The two gaps are V45-4's general case (V46-1) and the new wedge V45-6's reorder made (V46-2).

## Gate-5 obligations

SPEC ship gate 5: every confirmed defect's repair becomes a suite or selftest assertion, and so does every rejected finding that could be measured. These are requirements, not findings.

1. **V46-1:** a selftest arm that every step which sends more than once, or whose `done` reads state written after a send, is `resumable`. Plus a `nextAction` arm for one of them (landed, `--resume`, `run`).
2. **V46-2:** with `fill-values` recorded done, MINT absent and the window under 240 s away, the runner re-fills (or the date step runs right before `ceremony-collection`). Shown red on today's code.
3. **V46-3:** a `rescue` resume with vault-3 at the nest PDA and `nestedSent` unset records done without a second nest.
4. **V46-4:** `handRecover` with a landed `pendingSwapSig` and no return completes the return and split; an already hand-closed cycle reads done.
5. **V46-5:** a bundle-test arm: `--profile mainnet-local --rpc <x>` is refused, and so is every other override on that profile.
6. **V46-6:** a ceremony preflight with a null `cbob_mint` returns NOT READY, not a read error.
7. **V46-7:** text; re-verify against VALIDATION.
8. **V46-8:**
   - a driver arm: refuse before `fund-deployer` when the INIT account is not absent-or-System-and-empty (fixture: a program-owned 9-byte account);
   - a `rehearsal-tree.sh` arm: the INIT substitution is in the recorded map and its reverse recreates HEAD byte for byte.
9. **Measurable rejections:**
   - **C9:** an arm that `planRedemption` with `strayReadIncomplete.unexamined` set and a coverage reason containing that number still refuses an unnamed stray. It pins the build order at `:240`.
   - **C10:** already measured (3c.K5, 3c.K5a; arm at `tests/3prog.test.ts:1462`).
   - **C26:** already pinned (`because('3.3', …)`).
   - **C11, C12, C13, C23, C25:** settled by reading; no arm.
10. **Carried from round 45, not re-measured here:**
    - C12's close-authority twin of arm 3.3 (recommended);
    - C14's cost-versus-estimate arm;
    - round 44's C9, C11 and C18;
    - round 43's heap-shape ruling, the round 42 C9 / round 43 C20 coverage, the A9 reason pins, and Gary's ruling on limit 59.

    (C18's `MAINNET_ONLY` arm now exists, `bank/selftest.mjs:4710`.)
11. **Item 53 and item 22:** the full suite inside a rehearsal tree from the final commit (proven at `e7c192a`; any repair commit needs it again), and the mainnet rehearsal itself, which V46-8 now blocks.

## Measurements

| Measurement | Result | Evidence |
|---|---|---|
| Allowed selftests at `63a92b2` | web 695/695; detectors 1032/1032; launch 68/68; poster 24/24; allocation 39/39; all exit 0 | `/tmp/claude-1000/triage46p/{web,det,launch,poster,accrual}.log` |
| Program source against the release | equal to `0b3ddb3` | `git diff --quiet` |
| `e7c192a` canonical runs | suite 912/912, probe 35/35, fork 16/16; e2e 132/132; sim 71/71; all RC 0 | `.cache/e7c192a-*.log` |
| `mainnet-local` with `--rpc` | built, exit 0, URL in the bundle; `mainnet` with `--rpc` refused | `f1.log` (copy, paths rewritten) |
| Struct offsets | MintConfig 46 checked fields match (body 1,005 + 256 padding = 1,261); VaultRecord fields match (body 211) | Python over the struct definitions |
| Seed-7 key on mainnet | owned by `7DiXsBWm…`, 9 bytes, 0.523 SOL; 82 signatures 2024-08-02 to 2026-10-01 | public RPC, read-only |
| Real `INIT_AUTHORITY` on mainnet | System-owned, empty | public RPC, read-only |
| Live rehearsal (`63a92b2` tree) | deploys done 12:11:00 to 12:12:26 UTC; `ceremony-collection` refused at simulation, 0 signatures; charter window 12:40:54 to 13:10:54 UTC | state file and filled value file, read-only |

## Measurement limits

- **No validator was run and the driver was not run.** V46-1 to V46-4 are source readings. V46-2's wedge is predicted from code and the live run's timings, not observed.
- **V46-5 was measured on a copy without `.git`**, so the copy's builds stamp `commit unknown`, and their hashes are not the README table's. Only the difference between the overridden and plain builds is meaningful.
- **V46-8 rests on the mainnet account state at about 12:15 UTC today and on the live run's own error.** I did not identify program `7DiXsBWm…` or why it owns the seed-7 key. That it predates the rehearsal is read from the signature history.
- **The live rehearsal:** I read its record, state and filled-value file only. I found no driver process running, and I did not resume, close or alter anything there.
- **The quorum has no margin and depends on one narrow seat** (DeepSeek). A stricter reading makes the pass QUORUM NOT MET. A looser one (counting Grok) makes it 7 of 8.
- **Untracked state, recorded, not a seat's claim:** `?? .cache` and `?? cache-keypairs-backup-20261008.tar.gz` remain in the repository root (C18). `build-mainnet.sh` refuses a dirty tree, so both must be gone or ignored before step 9.
- **Unmeasured here, as rounds 36 to 45 also stated:** a real Phantom, a real Squads v4 return, the live proxy behind Cloudflare, DAS on mainnet, and whether a holder understands any page sentence.

## Remaining requirements

- **Before the mainnet dress rehearsal can continue (road step 8):** V46-8 (a throwaway INIT key in the tree, and a preflight). Then V46-2 (the charter clock) and V46-1 (resume coverage), so a pause or a lost confirmation does not wedge a mainnet run. V46-3 and V46-4 with them.
- **Before the ceremony's local mode is used for road step 10:** V46-5.
- **Under gate 5, before launch:** every repair and arm above.
- **Unchanged:** items 22, 38, 50, 52 and 53 remain OPEN AND BLOCKING. `charter_opens_at`, `lock_deadline` and `vault_collection` remain OPEN in `launch/mainnet-init.json`. Gary's rulings on the heap-shape arm and on limit 59 are still outstanding. No deployment, initialization, lock, ceremony, cron installation, rehearsal or publication follows from this audit.

**Result:** QUORUM MET (6 counted of 8; six required; no re-runs).

LAUNCH-CLEAN under SPEC gate 3's launch gate: 0 CRITICAL, 0 HIGH, 0 MEDIUM; nothing in the five programs, no value path, no refused crack.

REQUIRES CHANGES: V46-1 to V46-8. This is not a no-change round.

---

**Reply (under 300 words).** Round 46 programs pass: **LAUNCH-CLEAN; QUORUM MET. REQUIRES CHANGES: V46-1 to V46-8.**

**Counted, 6 of 8 (6 needed, no margin):** Opus 5.5, Ember, Fugu, GLM-prime, Qwen max-prime, and narrowly DeepSeek (its R0 is a true check of this tree's repairs; the rest is restatement). **Not counted:**
- MiniMax audits round 45's head and invents its CRITICAL: the code is `require_keys_neq!`, and arm 3c.K5 calls apply.
- Grok is a summary that invents helper refusals.

Programs equal release `0b3ddb3`. Selftests green: 695, 1032, 68, 24, 39.

**Confirmed, all outside (a)-(d), none in the programs:**
- **V46-8, LOW (this triage, measured):** the mainnet rehearsal cannot initialize. Its seed-7 INIT key is program-owned with data on mainnet, and every `initialize` pays from it. The live run (`63a92b2` tree) deployed five programs and stopped at `ceremony-collection` ("`from` must not carry data"), with nothing sent. It needs a throwaway INIT key in the tree, a preflight, and a new tree.
- **V46-1, LOW:** V45-4's resume covers 2 steps. Six more wedge on a lost confirmation.
- **V46-2, LOW:** the charter clock starts before the deploys, and `fill-values`' re-fill guard is dead code. About an hour's pause wedges `ceremony-mint`.
- **V46-5, LOW (measured):** `mainnet-local` accepts `--rpc` and the other overrides.
- **V46-3, INFO:** the rescue repeats a cycle.
- **V46-4, INFO:** the hand recovery cannot finish after a landed hand swap.
- **V46-6, INFO:** the ceremony shows a misleading error on a null mint.
- **V46-7, INFO:** SPEC 53 still calls its proof stale.

**Disproved:** Ember/GLM W46-1 (the `named` set is built before the non-address acks exist), MiniMax's three program items, and Grok's helper and 3.3 claims. Rounds 41-45: all 42 findings are outside (a)-(d).
