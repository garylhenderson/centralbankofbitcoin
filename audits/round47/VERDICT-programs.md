# Round 47, PROGRAMS pass: LAUNCH-CLEAN; QUORUM MET
REQUIRES CHANGES: V47-1, V47-2, V47-3, V47-4, V47-5, V47-6, V47-7, V47-8, V47-9

**Independent triage verdict against audited head `487a8b4736757dc4e912d283b171caf0347f11bc` (`487a8b4`). HEAD is `487a8b4`; `git status --porcelain` was `?? audits/round47/` before and after this triage (`.cache/`, `dist/` and the key tarball are now ignored). The program source equals `RELEASE_COMMIT` `d2ae5fc` and round 35's `0b3ddb3` (`git diff --quiet 63a92b2 487a8b4 -- programs Cargo.toml Cargo.lock` exits 0). `git diff --stat d2ae5fc 487a8b4 -- tests sim scripts bank programs Cargo.toml Cargo.lock launch` names only `scripts/audit47.ts`, so the on-chain suite, the simulation and the jobs are the certified `d2ae5fc` bytes. `dist/` checks against its `SHA256SUMS`, which equal `web/src/config.js`'s pins. I count seven of eight seats against a required six.**

**Nine findings are confirmed: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 5 LOW, 4 INFO.** None is in the five programs. None moves value out of a vault, the pool or the revenue address, none credits value wrongly, none stops or wrongly refuses a crack, and none is HIGH or MEDIUM. Under SPEC ship gate 3's launch gate (RULING, Gary 2026-10-08) the pass is **LAUNCH-CLEAN**.

**It is not a no-change round.** Every confirmed finding needs a change: the README facts generator (V47-1, V47-2, V47-6), one suite arm (V47-3), the wallet-edit judge and the ceremony page (V47-4, V47-5), and text in README, SPEC and one code comment (V47-6 to V47-9). None is an accepted limit already stated in SPEC. Gary's 2026-10-09 test ("a clean round where we make NO changes") is not met by this pass.

**The three claims that would have blocked launch are disproved.** Muse's HIGH (an empty Token-2022 reserve ATA bricks any crack) rests on the ATA program creating a Token-2022 account for a classic mint; it refuses, measured today on mainnet for all three reserve mints by unsigned simulation (`IncorrectProgramId`), and SEAL's `initialize` refuses a non-classic reserve mint anyway. MiMo's two MEDIUMs describe `judgeWalletEdits` accurately (both measured) but are its documented, tested design, fail closed, and the shape W47-2 names cannot fit the packet.

**The session's own claim is confirmed, and it has a sibling.** `scripts/readme-facts.mjs` counts every `audits/roundN` directory on disk, so while this round's untracked output exists `run-tests.sh` stops at the README check before its detector floors, the mainnet probe and the 912 on-chain arms (V47-1, measured on a copy). Reading the same function, I found that it also renders a verdict saying `REQUIRES CHANGES: NONE` as "yes, repairs not yet validated" (V47-2, measured): the README would misreport exactly the no-change round Gary is asking for.

## Auditor dispositions

**Manifest.** `MANIFEST-programs.first-run.json` (and the identical `MANIFEST-programs.json`) records head `487a8b4…`, `dirty: []`, `promptChars` 1,942,726, requested 8, required 6. Two first-run entries are disqualified: `qwen/qwen3.8-2.4t-a95b` ("request failed", 41 characters: `FETCH FAILED Unexpected end of JSON input`) and `meituan/longcat-2.0` ("reasoning only, no report", 98,239 characters beginning `[reasoning only]`). Both outputs are in `failed/` and are not counted. Each re-run manifest (`MANIFEST-programs.rerun-*.json`) records the same head and the same `promptChars` 1,942,726, `finish: stop`, `disqualified: null`. `RENDER_ONLY=1 FOCUS=programs TAG=v47tri npx tsx scripts/audit47.ts` reproduced 1,942,726 characters. Every report on disk matches its manifest's character count exactly.

I read all eight reports in full. This pass carries `web/`, the rehearsal driver and `run-tests.sh` but not `bank/*.mjs` (except `rehearsal-env.mjs`, `sigwalk.mjs`, `txread.mjs`), `readme-facts.mjs`, the Core watch or the web offline tests; those are delivered in the off-chain pass (checked against the off-chain prompt's file list).

| Auditor | Disposition |
|---|---|
| meta/muse-spark-1.3 | **Counted, narrowly.** 9,766 characters. Its R0 names this tree's repair constructs correctly (`ceremony-values` re-fill and `recheck`, `nestedSent` on nest or treasury, `handRecover`'s landed-swap continuation and `handClosed`, `walletRefusal`, `judgeInitAccount`, `judgeCeremonyMode`), its raw-read offsets are right, and its accepted-limits Q4 is a true, checkable reading of `RECORD.md` against the road table (C7).<br>Against it: its HIGH rests on a false premise about the ATA program that its own bundle refutes (SEAL's `assert_classic_spl`, the probe's measured `IncorrectProgramId`) (C10), and its R0-1 and R0-2 are wrong (C11, C12). These are errors about real constructs, not invented contents. Quorum does not depend on it. |
| z-ai/glm-5.3 | **Counted.** 17,550 characters. Walks every round-46 repair to its construct (`SINGLE_SEND_STEPS`, `judgeValuesFresh`, `valuesSha` pinned in `st.page` (true: `rehearsal-steps.mjs:436,459`), `takesOverrides`, `handClosed`, `PRODUCTION_NOTIFIER`), re-tests round 46's disproofs, and recomputes the offsets correctly.<br>**Confirmed:** F3's stale sentence (V47-8).<br>**Not confirmed:** F1 is already stated (C15), F2 is disproved (C11), F3's in-tree half is already stated (C34), F4 is not a defect on this host (C35), its scope statement is disproved (C12). |
| qwen/qwen3.8-max-0902 | **Counted.** 15,626 characters. Shallow and files nothing, but its claims are specific and true: `resumable: !isSingleSend(name)` makes `close-n` and `upgrade-n` resumable (true), the collection step's `done()` reads the chain, every MintConfig, VaultRecord, BurnConfig and GovConfig offset it lists is right (GovConfig 53/61/62/70/78/86 included), and its `initialize` bounds match `mint/src/lib.rs:493-517, 580-581`. Round 46's line for Qwen max-prime. |
| meituan/longcat-2.0 (re-run) | **Not counted.** 23,463 characters. It is written as a triage verdict ("Quorum: 1 of 1 (this seat)"). Its R7 says "I recomputed every offset … All correct", but 16 of the MintConfig offsets it lists are wrong (from `monthly_secs` "582" [574] through `boost_weight_total` "741" [733]; `sweep_floor_lamports` "639" where GOV pins 631, `gov/src/lib.rs:152`) and so are four GovConfig ones (`last_round_id` "53" [62]) (C40). It says there are two non-resumable steps; `SINGLE_SEND_STEPS` names nineteen. A measurement it did not make, reported as made, is invented contents (round 46's MiniMax and Grok line). What is true in it restates SPEC. |
| anthropic/claude-sonnet-5.5 | **Counted.** 10,201 characters. Source-only, said so. Specific and true: the helper's semantics (non-ATA destination accepted, wSOL closes, a delegate cannot stop the owner), GOV's offsets, the proxy's `mint-boosts` slice (125, 70) and `waiting` filter (177, `'2'`).<br>**Confirmed:** INFO-1 (V47-7), INFO-2 (V47-9).<br>**Not confirmed:** INFO-3 to INFO-6 and its limit-47 note (C27-C30, C15). |
| qwen/qwen3.8-2.4t-a95b (re-run) | **Counted.** 45,830 characters. Its full MintConfig table is right at every field I recomputed (body 1,005), and it states its source-only method and the files it lacks.<br>**Confirmed:** R0-1 (V47-4), DOC-1 (V47-6), R0-5's README half (C7).<br>**Not confirmed:** R0-2 and R5-1 disproved (C18, C22), R0-3 disproved (C11), R0-4 already settled (C19), R0-6, R1s-1, R8-1, R8-2 not defects (C20, C21, C16, C17), R8-3 already stated (C23). |
| anthropic/claude-fable-5.1 | **Counted.** 29,301 characters. The widest walk: every instruction builder against the account structs, the pool invariant by induction, the boost ring, the rate ring, the full offset map.<br>**Confirmed:** F-1 (V47-6), F-2(i) (V47-7), F-5 (V47-5), F-6 (V47-3, regraded LOW).<br>**Not confirmed:** F-2(ii) is already stated (C34), F-3 is already stated (C24), F-4 and F-7 are not defects (C25, C26). |
| xiaomi/mimo-v2.6-pro | **Counted.** 24,570 characters. Engaged: every floor it lists equals `run-tests.sh`'s, the ring argument is right, and its two MEDIUM mechanisms are accurate (measured).<br>**Confirmed:** W47-3 (V47-5), W47-6's SPEC 53 sentence (V47-8).<br>**Not confirmed:** W47-1 and W47-2 (C13, C14), W47-4 already stated (C31), W47-5 and W47-6's MRPC note (C32, C33). |

**Quorum: 7 counted of 8, 6 required. MET, with one seat of margin** (six even without Muse, the narrow one). **Excluded:** LongCat (C40). **Re-runs:** two, both with the first run's head and prompt size; the failed first outputs are not counted.

## Method and evidence

- **Records read:** this brief (`.cache/TRIAGE-BRIEF-r47.md`), all eight reports and both failed outputs, the four manifests, round 46's `VERDICT-programs.md`, `VERDICT-offchain.md` and `VALIDATION.md`, rounds 42 to 45's verdict headers and confirmed lists, `audits/rehearsal-2026-10-09/RECORD.md`, SPEC limits 28, 40, 47, 57, 58, items 22, 50, 53 and the road table, `web/README.md`'s round-47 wallet note.
- **Source read at `487a8b4`:** BURN's `burn_vault` (`:231-400`), the sweep helper whole, SEAL's `assert_classic_spl` (`cbob-vaults/src/lib.rs:273-278`), the MintConfig struct and GOV's pinned offsets; `web/src/lib/tx.mjs` whole, `plan-redeem.mjs` (reserves and strays), `plan-get.mjs` (`planClaim`, `planDraw`), `decode.mjs` (plugins), `my-vaults.mjs`, `reads.mjs` (`vaultsOwnedBy`), `ceremony.mjs` (`preflight`, the signing step), `plan-ceremony.mjs` (`judgeProgramBytes`), every page's `buildForWallet`/`signExact` call, `rpc-proxy.mjs` (`gpaShape`, IP keying); `scripts/readme-facts.mjs`, `run-tests.sh:405-470`, `rehearsal-refresh.mjs`, `rehearsal-steps.mjs` (`SINGLE_SEND_STEPS`, rescue, page step), `rehearsal-run.mjs` (CLI config, `capAllows`, `judgeInitAccount`), `probe-mainnet-facts.mjs:66-110`, `bank/rehearsal-env.mjs`, `bank/sigwalk.mjs`, and the alarm's `CBOB_ALARM_REHEARSAL` switch.
- **Allowed runs at `487a8b4`** (logs in `/tmp/claude-1000/triage47p/`):
  - `node web/test/run-all.mjs`: **801/801** in 11 files. Exit 0.
  - `node bank/selftest.mjs`: **1072/1072**. Exit 0.
  - `node scripts/check-launch-params.mjs --selftest`: **69/69**. Exit 0.
  - `node bank/redemption-poster.mjs --selftest`: **24/24**. Exit 0.
  - `node bank/accrual.mjs --selftest`: **39/39**. Exit 0.
- **Canonical logs, read:**
  - `.cache/487a8b4-web-e2e.log`: **152/152**, RC 0. `.cache/487a8b4-sim.log`: **71/71**, RC 0.
  - `.cache/487a8b4-suite.log`: toolchain, Core pin, build, validator, deploy, "program source equals RELEASE_COMMIT d2ae5fc", web offline 801/801, then **"README.md is STALE at facts line 45 … RC=1"**. No detector floor, allocation floor, mainnet probe, on-chain suite, expiry budget or swap fork ran (V47-1).
  - `.cache/d2ae5fc-suite.log`: RC 0, mainnet probe 35/35, on-chain **912/912**, swap fork 16/16. `.cache/d2ae5fc-build.log`: RC 0.
  - GitHub runs (public, read): 38058938028 `failure` at `b3f300c`, 38059530380 `success` at `a30924c`, as `VALIDATION.md` records.
- **Measurements** (scratch only; nothing under `/opt` written but this file):
  - `readme-facts.log`: on a `git archive 487a8b4` copy (the script derives its root from its own path, so no rewriting), `--check` exits 0; after `mkdir audits/round47` it exits 1 at facts line 45; with two verdicts whose second line is `REQUIRES CHANGES: NONE`, the generated row is `| [47] | LAUNCH-CLEAN | LAUNCH-CLEAN | yes, repairs not yet validated |`.
  - `judge.log`: `judgeWalletEdits` and `signExact` from the tree, driven in Node with hand-built transactions (no wallet, no RPC).
  - `t22.log`: unsigned `simulateTransaction` on the public mainnet endpoint (slot about 455,312,000), no key, nothing sent. Creating a Token-2022 ATA for cbBTC, $GARY and $GIRAFFISH each fails `IncorrectProgramId`; the classic control succeeds. `getMultipleAccounts`: all three mints are Tokenkeg-owned, 82 bytes.
  - `lsfiles.log`: in a scratch repository, `git ls-files --others` lists ignored `bank/keys/swap-operator.json` and `backup.tar.gz`; only `--exclude-standard` hides them. In this repository the same command lists `bank/keys/*`.
  - `r4.log`: R.4's regex against the plugin and adapter keys in the installed `@metaplex-foundation/mpl-core` 1.10.0 typings.
- **Not run:** no validator, `scripts/run-tests.sh`, `web/test/e2e-localnet.sh`, sim, swap fork, `build-mainnet.sh`, the rehearsal driver, `bank/alarm.mjs`, crank, revenue job, or any live, money or notification job. `dist/` untouched.

## Distinct claims

Class column: (a) a finding in the five programs; (b) a value path, or a wrong credit; (c) a stopped or wrongly refused crack; (d) HIGH or MEDIUM anywhere; "none" means outside all four.

| ID | Reporters | Claimed | Verdict | Class | Evidence (file:line) |
|---|---|---|---|---|---|
| C1 | **the session that wrote the code** (README facts count untracked rounds) | (claim) | **CONFIRMED, LOW (V47-1)**, measured | none | `readme-facts.mjs:96` (`all` = every `roundN` directory on disk); `run-tests.sh:420` (`--check` is fatal, before the probe `:440-446` and `[7/7]` `:458`); `.cache/487a8b4-suite.log`; `readme-facts.log` |
| C2 | **triage only** (`REQUIRES CHANGES: NONE` read as owed) | - | **CONFIRMED, LOW (V47-2)**, measured | none | `readme-facts.mjs:92` (`/^REQUIRES CHANGES: \S/m`; `NONE` matches `\S`); `readme-facts.log` |
| C3 | Fable F-6 | INFO | **CONFIRMED, LOW (V47-3)**, regraded by the round 37 precedent | none | `tests/3prog.test.ts:468-469`; `r4.log`: `agentIdentities`, `appDatas`, `dataSections`, `freezeExecute`, `groups`, `linkedAppDatas`, `permanentFreezeExecute` never match |
| C4 | Qwen-2.4t R0-1 | LOW | **CONFIRMED, LOW (V47-4)**, measured | none | `ceremony.mjs:237` (no `minUnits`; the dry run at `:224` has `unitsConsumed`); `tx.mjs:134` (floor applied only when `opts.minUnits`); `judge.log` (wallet limit 1 accepted); the judge's contract "for every page" (`tx.mjs:70-76`) |
| C5 | Fable F-5; MiMo W47-3 | INFO; LOW | **CONFIRMED, LOW (V47-5)**, measured | none | `tx.mjs:84-85` (`sameIx` compares addresses, not flags), `:126` (only added writables refused); `judge.log` (a writable-to-readonly downgrade passes `judgeWalletEdits` and `signExact`); header promise `tx.mjs:5-7` |
| C6 | Fable F-1; Qwen-2.4t DOC-1 | INFO; INFO | **CONFIRMED, INFO (V47-6)** | none | `README.md:101` (SEAL "holds each vault's reserves"), `:103` (BURN "pays out its reserves to the owner"); source strings `readme-facts.mjs:28,30`; BURN only proves emptiness (`burn/src/lib.rs:325-391`) and the helper moves value (`sweep/src/lib.rs:52-75`) |
| C7 | Sonnet INFO-1; Fable F-2(i); Muse (limits Q4); Qwen-2.4t R0-5 (README half) | INFO; INFO; (Q4); INFO | **CONFIRMED, INFO (V47-7)** for the public README; Muse's "OPEN treated as accepted" framing **DISPROVED** (C36) | none | `README.md:161` ("done on mainnet 2026-10-09 to 10-10"); `readme-facts.mjs:111-113` (`short` cuts at the first colon); SPEC `:2681` (the full row, with "22.2 recorded FAIL"); `RECORD.md` table (22.1 "PASS at 5 vaults (scale not exercised)", 22.2 FAIL) |
| C8 | GLM F3 (stale half); MiMo W47-6(b); Fable F-2(ii) (context) | LOW; INFO; INFO | **CONFIRMED, INFO (V47-8)**; the V46-7 shape | none | SPEC `:2221-2223` ("the dress rehearsal itself … has not yet run to its end on mainnet") against `RECORD.md` (every step done through `sweep-deployer`) and SPEC `:2681` ("done") |
| C9 | Sonnet INFO-2 | INFO | **CONFIRMED, INFO (V47-9)** | none | `rpc-proxy.mjs:20` ("the eight exact filtered shapes") against `:65` ("ONLY the five") and `gpaShape` `:76-104` (five) and `web/README.md:280` |
| C10 | Muse R1s-1 (an empty Token-2022 reserve ATA bricks any crack) | **HIGH, (c)** | **DISPROVED**, measured | none | `t22.log` (`IncorrectProgramId` for all three mints; classic control lands); SEAL `assert_classic_spl` refuses a non-classic reserve mint (`cbob-vaults/src/lib.rs:166,273-276`); the probe asserts both every certifying run (`probe-mainnet-facts.mjs:91-110`; 35/35 in `.cache/d2ae5fc-suite.log`) |
| C11 | Muse R0-1; GLM F2; Qwen-2.4t R0-3 (`rehearsal-refresh` misses ignored files) | LOW; LOW; LOW | **DISPROVED**, measured | none | `rehearsal-refresh.mjs:66` uses `ls-files --others` with no exclude option, which lists ignored files (`lsfiles.log`; this repo lists `bank/keys/*`). Round 46's off-chain verdict disproved the same claim about `release_gate` |
| C12 | Muse R0-2 (`readme-facts.mjs` in neither pass); GLM scope statement | INFO; (scope) | **DISPROVED** | none | The off-chain prompt carries `readme-facts.mjs`, `core-watch.mjs`, `core-watch-suite.sh`, `cron-install.sh`, `bank/*` and all eleven web test files; the programs prompt says so ("delivered in the off-chain pass"). `scripts/pob-set.json` is named as dropped this round and is unchanged since `0b3ddb3` |
| C13 | MiMo W47-1 (a wallet budget on a page-budgeted transaction is refused) | **MEDIUM, (c)** | **NOT A DEFECT**; mechanism accurate (measured) | none | The documented rule (`tx.mjs:70-76`, `web/README.md:499`, SPEC `:2165`) and an arm (`web/test/tx.test.mjs:54`); it fails closed before signing. The premise (Phantom adds a budget to a transaction that has one) contradicts the Phantom documentation SPEC cites and was not seen in the three real Phantom openings on mainnet (`RECORD.md:94-100`). The real-wallet matrix is item 50's (C15) |
| C14 | MiMo W47-2 (`minUnits` is the page's budget, not the measured cost) | **MEDIUM, (c)** | **NOT A DEFECT**; mechanism accurate (measured) | none | `minUnits` is defined as the page budget (`tx.mjs:145`). The shapes it names cannot reach the path: a limit-only instruction costs 40 bytes (the program key 32 plus 8), so the 1,218 and 1,201-byte openings would be 1,258 and 1,241 bytes; Phantom adds limit and price (52 bytes, the page's own size). Refusing a too-tight limit fails closed |
| C15 | GLM F1 (widest openings never signed by real Phantom); Sonnet INFO-5 | MEDIUM (conditional); INFO | **ALREADY-STATED**; not a confirmed defect (GLM says so) | none | SPEC item 50, OPEN AND BLOCKING (`:2157-2171`: "fit neither a budget nor Lighthouse … v0 … recorded as an option, not taken"); `web/README.md:510-514`. A pre-publication measurement (Remaining requirements) |
| C16 | Qwen-2.4t R8-1 (no upper bound, duplicate budgets) | INFO | **NOT A DEFECT** | none | Measured: both pass the judge (`judge.log`). The runtime refuses duplicate compute-budget instructions at sanitization (the page sends with preflight on, `tx.mjs:183`) and clamps a limit above 1,400,000, so the judge's fee bound only over-counts |
| C17 | Qwen-2.4t R8-2 (`pageUnits(null)` = 20,000) | INFO | **NOT A DEFECT** | none | `buildForWallet` dry-runs the budgeted transaction again (`tx.mjs:172-173`) and every page refuses on `sim.err` (`vault.mjs:196`, `redeem.mjs:143,180`, `draw.mjs:29`) |
| C18 | Qwen-2.4t R0-2 (rehearsal bytes shown as checked) | LOW | **DISPROVED** | none | With no hash, `judgeProgramBytes` returns "its bytes were NOT checked" (`plan-ceremony.mjs:305`), and that is the line's text (`ceremony.mjs:133-136`); the driver always passes `--rehearsal-bytes` (`rehearsal-steps.mjs:456`) |
| C19 | Qwen-2.4t R0-4 (`CBOB_ALARM_REHEARSAL` not gated) | LOW | **ALREADY SETTLED** (round 45 off-chain; round 46 off-chain C24, a recommendation); off-chain file | none | `detectors.mjs:2526`, `alarm.mjs:75,901`; it says REHEARSAL in every report |
| C20 | Qwen-2.4t R0-6 (CLI config after SIGKILL; `--max-sol` and top-ups) | INFO | **NOT A DEFECT** | none | `rehearsal-run.mjs:515-519`: mode 600 in a 700 directory beside the run's own keys, a copy of a value already stored the same way on the box; `capAllows` is documented as the funding wallet's drawdown (`:294`), and a top-up is the operator's own act |
| C21 | Qwen-2.4t R1s-1 (a frozen EMPTY reserve account is not named) | INFO (summary LOW) | **NOT A DEFECT** beyond accepted limit 28 | none | `plan-redeem.mjs:114` refuses only frozen with a balance. Whatever Token does on closing a frozen empty account (not measured here), the opening is dry-run first and nothing is sent on a failure (`redeem.mjs:180-183`); limit 28 states a frozen vault account blocks the opening |
| C22 | Qwen-2.4t R5-1 (`planClaim` omits FreezeExecute) | LOW | **DISPROVED** | none | FreezeExecute gates Execute, not burn: every sealed vault carries a frozen PermanentFreezeExecute and stays burnable by a bare BurnV1 (prompt MEASURED FACT 1; SPEC limit 44 family) |
| C23 | Qwen-2.4t R8-3 (`signaturesSince` cannot tell an empty page from a lost cursor) | INFO | **ALREADY-STATED** | none | `sigwalk.mjs:16-22` (sentinel); SPEC Reader coverage boundary (`:2052`, `:2138-2145`); the consumers prove it (`alarm.mjs:652` `scan_cursor_unresolvable`, `:763` `scan_backlog_unproven`) |
| C24 | Fable F-3 (SPEC 40 cites Core source `e72d63e`) | INFO | **ALREADY-STATED** | none | SPEC `:1565` ("the source is not proven identical to the pinned binary") and "MEASURED against the pinned Core binary: SR.5 …" |
| C25 | Fable F-4 (`my-vaults` puts the minter's name first) | INFO | **NOT A DEFECT** (limit 57) | none | `my-vaults.mjs:13-14`: the record's level is on the same label; only the wallet's own verified vaults are listed and nothing is signed from the list (`reads.mjs:230-244`) |
| C26 | Fable F-7 (`planClaim` TypeError on a null FreezeDelegate body) | INFO | **NOT A DEFECT**; mechanism accurate | none | `plan-get.mjs:66` (`?.body.frozen`), `decode.mjs:92-93`. Round 42 C7's exact shape: unreachable because Core wrote the bytes, and nothing is signed. Recommended: `?.body?.frozen` |
| C27 | Sonnet INFO-3 (page budget leaves about 40k headroom) | INFO | **NOT A DEFECT** | none | Self-judged adequate; a shortfall fails on chain with a fee and the retry re-simulates |
| C28 | Sonnet INFO-4 (Lighthouse allowed by program id) | INFO | **NOT A DEFECT** | none | Self-labelled hardening; a Lighthouse write needs a writable account the judge refuses (`tx.mjs:126`) |
| C29 | Sonnet INFO-6 (limit 28 names only the pool as a provocation target) | INFO | **NOT A DEFECT** (wording; recommendation) | none | SPEC `:1459-1485` states the vault-account effect and that anyone could try to provoke a freeze; `HOLDER-GUIDE.md:137-138` states the effect |
| C30 | Sonnet (limit 47 worsens as vaults go dormant) | (limits Q1) | **ALREADY-STATED** | none | SPEC `:1755` ("the stop is then PERMANENT") at low turnout |
| C31 | MiMo W47-4 ("announced on X") | LOW | **ALREADY-STATED** (item 50; round 45 C28 and C22) | none | SPEC `:1967-1972`; the guide's DRAFT banner |
| C32 | MiMo W47-5 (cap + 1 in a closed window) | INFO | **NOT A DEFECT** | none | A window of N whole seconds is N timestamps, half-open; the seat calls the code the standard rule |
| C33 | MiMo W47-6(a) (`MRPC` unset in the e2e) | INFO | **NOT A DEFECT** | none | `e2e-localnet.sh:38-39`: a public program read from the keyless endpoint, then sha256-pinned |
| C34 | GLM F3 (no in-tree run at the final commits); Fable F-2(ii) | LOW; INFO | **ALREADY-STATED** | none | SPEC `:2221-2222`: "every repair commit needs the same in-tree run again (round 46's included)" is what keeps item 53 OPEN. Remaining requirement |
| C35 | GLM F4 (hosted rehearsal nginx example omits the real-IP note) | INFO | **NOT A DEFECT** on this host | none | `/etc/nginx/conf.d/10-cloudflare-realip.conf` sets `real_ip_header CF-Connecting-IP` for every server (`include … conf.d/*.conf` in `http`); the page sat behind basic auth and was removed (`RECORD.md:108-111`) |
| C36 | Muse Q4; Qwen-2.4t R0-5; Qwen-max closing 4 (22.2 FAIL with step 8 "done") | (limits Q4); INFO | **NOT A DEFECT as stated; the open state is recorded openly** | none | SPEC `:2681` and `RECORD.md` say 22.2 FAIL by a true detection; item 22 stays in OPEN AND BLOCKING (`:1897-1906`). A ruling or a clean pass 2 is owed (Remaining requirements). Only the README's omission is a defect (V47-7) |
| C37 | MiMo (the guide is softer than SPEC on limits 26 and 10) | (limits Q1) | **NOT A DEFECT** | none | Self-judged defensible |
| C38 | Qwen-2.4t (half of live vaults can be one; modulo bias; a backwards clock) | (notes) | **NOT A DEFECT** | none | Not filed by the seat; each follows from the ruled design or fails closed |
| C39 | Muse, GLM, Fable, MiMo, Sonnet (round 46's C9, C10, C25, C26 re-tested) | (agree) | **ALREADY SETTLED** | none | Re-read at `487a8b4`: `require_keys_neq!`, the helper's three checks, `named` built before non-address acks, BURN's delegate checks before the length check (`burn/src/lib.rs:342-345`) |
| C40 | LongCat R7 ("All correct") | (statement) | **DISPROVED** | none | `off.py` recomputation from the struct: `monthly_secs` 574, `pending_guardian` 582, `notice_secs` 623, `sweep_floor_lamports` 631 … `cbob_mint` 679, `max_boost_weight` 711, `boost_weight_total` 733; GovConfig `proposal_count` 53, `last_round_id` 62. GOV pins 631/639/647/711/712 (`gov/src/lib.rs:152-157`) |

## Confirmed findings

**V47-1: LOW.** Reporter: the session that wrote the code. Measured.

**The README facts check counts audit rounds from the working tree, so during any audit round the certifying runner stops before its on-chain arms.**
- **The mechanism.** `audits()` counts `all`, every directory named `roundN` on disk, tracked or not, with or without a verdict (`readme-facts.mjs:96`). `run-tests.sh:420` runs `--check` and dies on any difference. That check sits after web offline and before the detector and allocation floors, the mainnet probe and `[7/7]`.
- **Measured** (`readme-facts.log`, a `git archive` copy of `487a8b4`): `--check` exits 0; after an empty `mkdir audits/round47` it exits 1 ("43 audit rounds … rounds 5 to 47").
- **Observed.** `.cache/487a8b4-suite.log` stops there with RC 1. The audited commit therefore has no certifying record of its 912 on-chain arms, its 35-assertion probe, its expiry budget or its swap fork. The gap is small today, because the programs, tests, sim, bank and scripts equal `d2ae5fc`'s except `scripts/audit47.ts`, and `d2ae5fc` passed every arm; I re-ran the detector and allocation selftests (1072, 39).
- **Why it matters.** Gate 3 asks for a launch-clean confirmation round on the final tree. A runner that cannot certify the commit under audit while the audit is open forces either an unrecorded workaround (moving the directory away) or a README commit, which is a change.

**LOW:** a certifying gate that cannot run on the audited tree during its own audit, fail-closed, never a false pass (V43o-1's shape, "the release check died in the rehearsal tree"). **Class: none.** Tooling.

**Repair:** count only tracked rounds (`git ls-files audits/`) or only rounds with both verdicts, and run the README check after the on-chain arms (or as its own non-certifying step). One selftest arm: an untracked empty `audits/roundN` leaves `--check` green.

**V47-2: LOW.** This triage only. Measured.

**The README renders a no-change round as needing changes.** `changes()` marks a round "yes, repairs not yet validated" when either verdict matches `/^REQUIRES CHANGES: \S/m` (`readme-facts.mjs:92`). The brief requires the second line to read exactly `REQUIRES CHANGES: NONE` for a no-change round, and `N` is `\S`. Measured (`readme-facts.log`): two verdicts headed `LAUNCH-CLEAN` with `REQUIRES CHANGES: NONE` generate `| [47] | LAUNCH-CLEAN | LAUNCH-CLEAN | yes, repairs not yet validated |`. The public front page says "The launch gate needs a round whose findings require NO changes", and would then show that round as owing repairs. Because the generator and `--check` agree, no run catches it.

**LOW:** a record that cannot credit the state it exists to show (round 44 V44-3's shape, "the coverage gate could not credit LAUNCH-CLEAN"), in the conservative direction. **Class: none.** Repair: `/^REQUIRES CHANGES: (?!NONE\b)\S/m`, with a selftest arm for NONE, a list, and no line.

**V47-3: LOW** (Fable filed INFO; regraded by the round 37 precedent, as round 46's V46o-1 was).

**Suite arm R.4, "…and it is the ONLY plugin on the collection", cannot fail for seven plugin kinds.** It lists the collection's plugins with a regex over the fetched object's keys (`tests/3prog.test.ts:468`). Against the installed `mpl-core` 1.10.0 typings (`r4.log`), `agentIdentities`, `appDatas`, `dataSections`, `freezeExecute`, `groups`, `linkedAppDatas` and `permanentFreezeExecute` never match, so a collection carrying any of them still reads `royalties`. One of them, the AgentIdentity adapter, is the route SPEC 40 names as widening who may Execute through a vault (`:1565-1576`). It cannot pass falsely today: 0.1g refuses a collection that arrives with a plugin and `initialize` adds only Royalties. But no other arm pins the collection's plugin set, and the Core watch re-runs this suite on every Core change, which is exactly when a new default would appear. **Class: none.** A test. **Repair:** assert on the raw collection account (plugin registry count 1, type Royalties, external adapter count 0), or enumerate every key the SDK can return; show it red with a second plugin of an omitted kind on the control collection.

**V47-4: LOW.** Reporter: Qwen-2.4t R0-1. Measured.

**The ceremony page never gives the wallet-edit judge its compute floor.** The judge's stated rule, "for every page", lets a wallet add a budget only "whose limit is at least what the page measured (`minUnits`)" (`tx.mjs:70-76`), and enforces it only when `opts.minUnits` is set (`:134`). Every holder page passes it; the ceremony dry-runs each step (`ceremony.mjs:224`) but calls `signExact` without it (`:237`). Measured (`judge.log`): with no `minUnits`, a wallet-added limit of 1 passes. **What it costs:** on the page where Gary signs the permanent `initialize` values, a too-low wallet limit is sent and then refused by the RPC's preflight (`sendRaw` sends with preflight on), so nothing lands, but Gary sees an RPC error where the page should name the wallet's edit. Phantom's 200,000 limit landed every step of road step 10 on mainnet (`RECORD.md:94-95`). **LOW:** the judge's stated guard is not applied on the one page that most needs clear refusals (V46-5's shape). **Class: none.** **Repair:** pass `{ minUnits: pageUnits(sim.unitsConsumed) }` from the step's dry run; one `ceremony.test.mjs` arm with a low wallet limit refused.

**V47-5: LOW.** Reporters: MiMo W47-3 (LOW), Fable F-5 (INFO). Measured.

**The wallet-edit judge does not refuse a flag the wallet removed.** `sameIx` compares program, data and account addresses but not `isSigner`/`isWritable` (`tx.mjs:84-85`), and `roles` refuses only signers or writables the wallet ADDED (`:125-126`). Measured (`judge.log`): a transaction whose second account the wallet made read-only is returned by `judgeWalletEdits` with no complaint, and `signExact` hands it back for sending. Unlike round 46's disproved swap-judge flag claim, this shape is a different message (the header changes), so it reaches the judge and the judge passes it. The file's own promise is "the page REFUSES to send unless every instruction it built survives byte for byte" (`:5-7`). **What it costs:** the program's write then fails; with preflight on nothing lands, otherwise a fee. No value moves. **Class: none.** **Repair:** compare the writable and signer sets in both directions (or the page's compiled instructions' flags); one `tx.test.mjs` arm.

**V47-6: INFO.** Reporters: Fable F-1, Qwen-2.4t DOC-1.

**The README's program table says the wrong programs hold and pay out the reserves.** SEAL "holds each vault's reserves" (`README.md:101`) and BURN "pays out its reserves to the owner and burns it" (`:103`). The reserves sit in Core's asset-signer PDA; SEAL holds the seal (the PermanentFreezeExecute authority and the open-only-toward-burn rule); BURN moves nothing and refuses unless the vault is already empty (`burn/src/lib.rs:325-391`); the sweep helper, through Core `ExecuteV1`, moves the value (`sweep/src/lib.rs:52-75`). The README calls itself a page whose every sentence must be true of the code (`scripts/audit47.ts:173`). **Class: none.** Docs. Not eligible for the documentation exception, because it misstates what the programs do. **Repair:** the two strings in `readme-facts.mjs:28,30` ("keeps each vault sealed: nothing leaves its wallet until the owner opens it"; "opening a vault: proves it empty, burns it and retires its record"), then regenerate.

**V47-7: INFO.** Reporters: Sonnet INFO-1, Fable F-2(i), Muse (limits Q4), Qwen-2.4t R0-5.

**The public README shows road step 8 as plainly "done".** SPEC's row says "done on mainnet 2026-10-09 to 10-10: items 22.1, 22.3, 22.4, 22.5 PASS; 22.2 recorded FAIL …" (`SPEC.md:2681`), and `RECORD.md` records 22.1 as "PASS at 5 vaults (scale not exercised)". The generator keeps only the text before the first colon (`readme-facts.mjs:111-113`), so `README.md:161` reads "done on mainnet 2026-10-09 to 10-10". Road step 8 is defined to include item 22's named pass/fail items, one of which failed, and item 22 stays OPEN AND BLOCKING; the front page shows neither. Nothing in the tree acts on the omission. **Class: none.** Docs. **Repair:** carry the qualifier before the colon in SPEC's cell ("done on mainnet …, 22.2 FAIL (a true detection), scale not exercised"), or let `short` keep a marked qualifier.

**V47-8: INFO.** Reporters: GLM F3 (its stale half), MiMo W47-6(b); Fable F-2(ii) cites the same paragraph.

**SPEC item 53 still says the dress rehearsal "has not yet run to its end on mainnet"** (`SPEC.md:2221-2223`). `RECORD.md` records every step done through `sweep-deployer` and SPEC's own road row says done. Round 46's V46-7 is the exact precedent (the same paragraph's previous open reason, INFO). GLM filed its combined F3 at LOW; that grade rests on its other half (no in-tree run at the final commits), which is the reason SPEC already gives for keeping item 53 open (C34). **Class: none.** **Repair:** strike the sentence; keep "every repair commit needs the same in-tree run again", and say the last in-tree run is `e7c192a`.

**V47-9: INFO.** Reporter: Sonnet INFO-2.

**`web/deploy/rpc-proxy.mjs`'s header says `getProgramAccounts` is relayed "only in the eight exact filtered shapes" (`:20`).** `gpaShape` accepts five (`:65`, `:76-104`); round 46 moved the token-account reads to `getTokenAccountsByOwner`. No behaviour changes. Round 43's V43-2 (a stale e2e header) is the precedent. **Class: none.** **Repair:** "five".

### The documentation exception (SPEC gate 3, ruling of 2026-10-07)

- V47-1 to V47-5 change code or a test. **Not eligible.**
- V47-6 misstates what the programs do. **Not eligible.**
- V47-7 and V47-8 are text that misstates nothing about holders' money; V47-9 is a code comment. Even if all three qualified, they cannot make this a no-change round alone.

## Rounds 42 to 46 re-check, per confirmed finding

I re-read each verdict's mechanism against `487a8b4` and classified it again. The five programs are byte-identical in source to the release every round judged (`0b3ddb3`), so no finding there can have moved into the programs.

| Finding | Severity | (a) programs | (b) value | (c) crack | (d) H/M | Outside (a)-(d)? |
|---|---|---|---|---|---|---|
| R42 **V42-1** malformed path crashed the local ceremony server | INFO | No | No | No | No | **Yes** |
| R42 **V42-2** an earlier transaction hid the collection create | INFO | No | No | No | No | **Yes** |
| R42o **C01** omitted vaults lost their alarm baseline | LOW | No (`alarm.mjs`) | No (detection) | No | No | **Yes** |
| R43 **V43-1** a host's owner keeps a nested vault by Executing it out in their own opening | LOW | No defect against the ruled design (limit 58, `SPEC.md:1799`) | No (the owner's own vault wallet, in their own crack) | No | No | **Yes** |
| R43 **V43-2** e2e header described the old rescue rule | INFO | No | No | No | No | **Yes** |
| R43o **V43o-1** release check died in the rehearsal tree | LOW | No (`run-tests.sh`) | No | No | No | **Yes** |
| R43o **V43o-2** one unreadable signature froze a scan | LOW | No (`alarm.mjs`) | No (detection) | No | No | **Yes** |
| R43o **V43o-3** reveal-skip arm could not fail | LOW | No (`selftest.mjs`) | No | No | No | **Yes** |
| R44 **V44-1** rehearsal ceremony could not consume the value file | LOW | No | No | No | No | **Yes** |
| R44 **V44-2** `release_gate` accepted any reversible swap | LOW | No | No | No | No | **Yes** |
| R44 **V44-3** coverage gate could not credit LAUNCH-CLEAN | LOW | No | No | No | No | **Yes** |
| R44 **V44-4** RULED missing from the legend | INFO | No | No | No | No | **Yes** |
| R44 **V44-5** limit 59 cited the test validator's rent | INFO | No | No | No | No | **Yes** |
| R44 **V44-6** "the one exception" omitted the bare burn | INFO | No (programs credit as SPEC states) | No | No | No | **Yes** |
| R44 **V44-7** absent pinned collection shown as BROKEN | INFO | No | No | No | No | **Yes** |
| R44o **V44o-1** poster skip never fired while a backlog drained | LOW | No (drafts only) | No | No | No | **Yes** |
| R44o **V44o-2** split-recovery scan died on one refused signature | LOW | No (`revenue.mjs`) | No (the job stops; balances stay) | No | No | **Yes** |
| R44o **V44o-3** null SEAL read dropped reserve baselines | LOW | No | No (detection) | No | No | **Yes** |
| R44o **V44o-4** no-network runner exit 1 | INFO | No | No | No | No | **Yes** |
| R44o **V44o-5** runbook did not cover the off-chain jobs | INFO | No | No | No | No | **Yes** |
| R45 **V45-1** to **V45-5** (driver predicates, argv key, deploy key, rescue brick, cycle order) | LOW ×5 | No (driver) | No (throwaway keys only) | No | No | **Yes** |
| R45 **V45-6** to **V45-11** (init window, DAS URL, 5-vault label, SPEC 53 text, late signatures, taken check) | INFO ×6 | No | No | No | No | **Yes** |
| R45o **V45o-1** null SEAL invented "no reserve mints" | LOW | No (`alarm.mjs`) | No (detection) | No | No | **Yes** |
| R45o **V45o-2** forced-failure switches read after the sweep | LOW | No (`revenue.mjs`) | No (the capped sweep to the Bank's own operator key, limit 10) | No | No | **Yes** |
| R45o **V45o-3** to **V45o-7** (overdue text, unreadable count, coverage selftest, `budgetPlan` wording, the prompt) | INFO ×5 | No | No | No | No | **Yes** |
| R46 **V46-1** multi-send steps not resumable | LOW | No (driver) | No | No | No | **Yes**. Repaired (`rehearsal-steps.mjs:61-63,166`) |
| R46 **V46-2** charter clock before the deploys | LOW | No (driver) | No | No | No | **Yes**. Repaired (`ceremony-values` `recheck`, `:433,463`) |
| R46 **V46-3** rescue repeated a cycle | INFO | No | No | No | No | **Yes**. Repaired (`:811,814`) |
| R46 **V46-4** hand recovery after a landed swap | INFO | No | No | No | No | **Yes**. Repaired (`rehearsal-recover.mjs:45,55`) |
| R46 **V46-5** `mainnet-local` accepted overrides | LOW | No (page build) | No | No | No | **Yes**. Repaired (`config.js:203,208`, `build.mjs:68`) |
| R46 **V46-6** misleading error on a null mint | INFO | No (ceremony page) | No | No | No | **Yes**. Repaired (`ceremony.mjs:121`) |
| R46 **V46-7** SPEC 53 called its proof stale | INFO | No | No | No | No | **Yes**. Repaired; the paragraph's other open reason is now stale (V47-8) |
| R46 **V46-8** the rehearsal's seed-7 init key could not pay on mainnet | LOW | No (no program changes behaviour) | No | No | No | **Yes**. Repaired (option 1, `judgeInitAccount` `rehearsal-run.mjs:227,478`); the rehearsal ran to its end |
| R46o **V46o-1** asset-less ack arm could not fail | LOW | No (`selftest.mjs`) | No | No | No | **Yes** |
| R46o **V46o-2** undelivered pass kept its unreadable counts | INFO | No (`alarm.mjs`) | No (detection) | No | No | **Yes** |
| R46o **V46o-3** load-time refusal sent no notice | INFO | No (`revenue.mjs`, `alarm.mjs`) | No | No | No | **Yes**. Repaired (`refuseStrayOverridesAtLoad`, `alarm.mjs:69`) |
| R46o **V46o-4** offline web suite needed an untracked placeholder | INFO | No (tests) | No | No | No | **Yes**. Repaired (tracked fixture) |
| R46o **V46o-5** the audit instrument's bundle claims | INFO | No | No | No | No | **Yes** |

**All are outside (a)-(d).** None is in the five programs; none moves or miscredits value; none stops a crack; none is HIGH or MEDIUM. Round 46's programs repairs hold at every site I checked.

## Gate-5 obligations

SPEC ship gate 5: every confirmed defect's repair becomes a suite or selftest assertion, and so does every rejected finding that could be measured. These are requirements, not findings.

1. **V47-1:** an arm that an untracked, verdict-less `audits/roundN` leaves `--check` green, shown red on today's code; and a run at the audited commit that reaches `[7/7]` while the round's directory exists.
2. **V47-2:** `changes()` arms for `REQUIRES CHANGES: NONE` ("none"), a list ("yes, …"), and no such line.
3. **V47-3:** R.4 asserts the raw registry (one plugin, Royalties, zero external adapters), shown red with an omitted kind added to the control collection.
4. **V47-4:** a ceremony step whose wallet-added limit is below the step's measured units is refused before sending.
5. **V47-5:** a wallet that downgrades a writable (and, separately, a signer) account is refused.
6. **V47-6 to V47-9:** text and comment; the regenerated README passes `--check`.
7. **Measurable rejections:**
   - **C10:** already measured every certifying run (the probe's six reserve-mint assertions, 35/35 at `d2ae5fc`) and by `assert_classic_spl`.
   - **C11:** a `rehearsal-refresh` selftest arm with an ignored fixture in the snapshot (it would pass today), so the semantics are pinned.
   - **C13, C14:** `tx.test.mjs:52-54` already pin both rules.
   - **C16:** an arm that the judge refuses a second limit or price (hardening; today the runtime refuses it).
   - **C26:** the one-character `?.body?.frozen` with a `planClaim` arm, as round 42 C7 recommended for `planDraw`.
8. **Carried from round 46, not re-measured here:** C9's `planRedemption` build-order arm, and round 45's and earlier recommendations as round 46 listed them.
9. **Item 53 and item 22:** the full suite inside a rehearsal tree at the final commit (last proven `e7c192a`; every commit since needs it), and item 22.2's resolution (Remaining requirements).

## Measurements

| Measurement | Result | Evidence |
|---|---|---|
| Allowed selftests at `487a8b4` | web 801/801; detectors 1072/1072; launch 69/69; poster 24/24; allocation 39/39; all exit 0 | `/tmp/claude-1000/triage47p/{web,det,launch,poster,accrual}.log` |
| Program source against the release | equal to `d2ae5fc` and `0b3ddb3` | `git diff --quiet` |
| `dist/` | five files OK against `SHA256SUMS`, equal to `config.js:51-55` | `sha256sum -c` |
| `487a8b4` canonical runs | e2e 152/152, sim 71/71; suite stopped at the README check (RC 1) | `.cache/487a8b4-*.log` |
| `d2ae5fc` canonical runs | suite RC 0 (probe 35/35, on-chain 912/912, fork 16/16); build RC 0 | `.cache/d2ae5fc-*.log` |
| README facts on a copy | clean exits 0; an empty round directory exits 1; `NONE` renders "yes, repairs not yet validated" | `readme-facts.log` |
| Wallet-edit judge | downgrade accepted; page-budget plus wallet budget refused; limit-only 200,000 below 234,164 refused; limit 10,000,000 and duplicates accepted; no `minUnits` accepts limit 1; `pageUnits(null)` = 20,000 | `judge.log` |
| Token-2022 ATA for the reserve mints (mainnet, unsigned simulation) | `IncorrectProgramId` ×3; classic control ok ×3; all three mints Tokenkeg, 82 bytes | `t22.log` |
| `git ls-files --others` | lists ignored files unless an exclude option is given | `lsfiles.log` |
| R.4's regex | misses 7 of 26 plugin and adapter keys in mpl-core 1.10.0 | `r4.log` |
| MintConfig offsets | body 1,005 (+256 = 1,261); every field recomputed; Qwen-2.4t's table right, LongCat's wrong at 16 | `off.py` |

## Measurement limits

- **No validator was run and the driver was not run.** V47-3 is measured on the regex and the SDK's type names, not by adding a plugin on a validator. V47-4 and V47-5 are measured on the judge in Node, not with a wallet or a cluster; that the RPC's preflight then refuses the transaction is reasoning from `sendRaw`'s options, not observed.
- **The audited commit's on-chain arms have no certifying run** (V47-1). I rely on `d2ae5fc`'s, whose programs, tests, sim, bank and scripts equal `487a8b4`'s except `scripts/audit47.ts`.
- **C10's simulation** used the public endpoint at slot about 455,312,000 and a funded address only as the unsigned fee payer; nothing was signed or sent.
- **C21:** whether SPL Token refuses to close a frozen account with a zero balance is not measured here; the page fails closed either way.
- **Unmeasured here, as rounds 36 to 46 also stated:** a real Phantom on the widest openings and on a page-budgeted opening (C13, C15), a real Squads v4 return, the live proxy behind Cloudflare, DAS on mainnet, and whether a holder understands any page sentence.
- **Off-chain files** (`readme-facts.mjs`, `alarm.mjs`, `detectors.mjs`, the web tests) were read only where a programs-pass claim turned on them; their own audit is the off-chain pass's.

## Remaining requirements

- **Item 22.2:** recorded FAIL by a true detection. Either a clean pass 2 against the re-baselined Core, recorded, or Gary's ruling that the FAIL is the evidence item 22.2 asks for. Until then item 22 cannot close (its ~2,100-vault scale stays open regardless).
- **Item 53:** the full suite inside a rehearsal tree at the final commit, recorded.
- **Item 50, before the pages are published:** real Phantom on the widest openings (claim-first with strays, W5) and on a page-budgeted opening, or the v0 lookup-table client.
- **This pass:** V47-1 to V47-9 and their arms. Recording round 47 will itself change the README's generated audit rows; with V47-1 repaired that commit is a records change, and V47-2 decides whether it can say "none".
- **Unchanged:** items 22, 38, 50, 52 and 53 remain OPEN AND BLOCKING. `charter_opens_at`, `lock_deadline` and `vault_collection` remain OPEN in `launch/mainnet-init.json`. No deployment, initialization, lock, ceremony, cron installation, rehearsal or publication follows from this audit.

**Result:** QUORUM MET (7 counted of 8; six required; two re-runs, both on the first run's head and prompt).

LAUNCH-CLEAN under SPEC gate 3's launch gate: 0 CRITICAL, 0 HIGH, 0 MEDIUM; nothing in the five programs, no value path, no refused crack.

REQUIRES CHANGES: V47-1 to V47-9. This is not a no-change round.

---

**Reply (under 300 words).** Round 47 programs pass: **LAUNCH-CLEAN; QUORUM MET. REQUIRES CHANGES: V47-1 to V47-9.**

**Counted, 7 of 8 (6 needed):** Sonnet 5.5, Fable 5.1, GLM 5.3, MiMo, Qwen max, Qwen 2.4t (re-run), and narrowly Muse. **Not counted:** LongCat (re-run), which writes itself as a verdict and reports an offset table as "All correct" that is wrong at 20 fields. Programs equal release `d2ae5fc`. Selftests green: 801, 1072, 69, 24, 39.

**Confirmed, all outside (a)-(d), none in the programs:**
- **V47-1, LOW (the session's claim, measured):** `readme-facts.mjs` counts untracked round directories, so the 487a8b4 certifying suite stopped before its on-chain arms.
- **V47-2, LOW (triage, measured):** the README renders `REQUIRES CHANGES: NONE` as "yes, repairs not yet validated".
- **V47-3, LOW:** suite arm R.4 cannot see seven plugin kinds, AgentIdentity included.
- **V47-4, LOW:** the ceremony page gives the wallet judge no compute floor.
- **V47-5, LOW:** the judge passes a wallet's writable-to-readonly downgrade.
- **V47-6, INFO:** README says SEAL holds and BURN pays out the reserves.
- **V47-7, INFO:** README shows road step 8 "done" without 22.2's FAIL.
- **V47-8, INFO:** SPEC 53 says the rehearsal has not run to its end.
- **V47-9, INFO:** the proxy header says eight shapes, not five.

**Disproved:** Muse's HIGH (a Token-2022 reserve ATA cannot be created: `IncorrectProgramId`, measured on mainnet; SEAL refuses non-classic reserves), MiMo's two MEDIUMs (documented, tested, fail-closed design), the ignored-files claim (three seats), Qwen's FreezeExecute and unchecked-bytes claims. GLM's Phantom MEDIUM is already stated in item 50. Rounds 42-46: every confirmed finding is outside (a)-(d).
