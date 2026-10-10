# Round 49, PROGRAMS pass: LAUNCH-CLEAN; QUORUM MET
REQUIRES CHANGES: V49-1, V49-2, V49-3, V49-4
HOLDS THE DEPLOY: V49-2

**Independent triage verdict against audited head `617504d5a1ccfcd5805e182d5e7008c22468eb9c` (`617504d`), which is HEAD.**
- `git status --porcelain` showed only `?? audits/round49/` before and after this triage. Nothing was written to the repository except this file.
- The program source equals `RELEASE_COMMIT` `d2ae5fc`: `git diff --quiet d2ae5fc HEAD -- programs Cargo.toml Cargo.lock` exits 0.
- `git diff --stat 128d84d HEAD` names only `README.md` (one line, the round-48 row), `audits/FREEZE.md`, `audits/round48/VALIDATION.md` and `scripts/audit49.ts`. So the canonical `128d84d` runs are runs of this tree's programs, pages, suite and simulation.
- `dist/` passes `sha256sum -c SHA256SUMS` (five OK). Its hashes equal `web/src/config.js:51-55`, and `dist/MANIFEST.txt` names `d2ae5fc`, `dirty no`.

**Quorum is met: four of four seats count, against a required three.** There were no re-runs: `audits/round49/failed/` does not exist, and the only manifest is `MANIFEST-programs.json` (head `617504d…`, `dirty: []`, requested 4, required 3). Its `briefChars` 162,827 is the brief's size in bytes; `wc -m` gives 162,637 characters. Each report says it read the repository at that head, and each one's specific claims check out against it, with the errors listed per seat below.

**Four findings are confirmed: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW, 3 INFO.**
- None is in the five programs.
- None moves value out of a vault, the pool or the revenue address, or credits value wrongly.
- None stops or wrongly refuses a crack.
- None is HIGH or MEDIUM.

Under SPEC ship gate 3's launch gate (RULING, Gary 2026-10-08), the pass is **LAUNCH-CLEAN**.

**It is not a no-change round, and one change falls inside the deploy scope.** V49-2 is a sentence shown to holders on the vault page (`web/src/pages/vault.mjs:104`): "Sealed: Yes. Nothing can leave it until it is opened." The program's own `rescue_nested` contradicts it, and so does the same page further down. That makes it a required change in `web/src`. Under Gary's 2026-10-10 ruling ("if it requires no change THERE"), it holds the deploy. It is one sentence of copy. It changes no instruction, no account and no transaction any page builds. The other three changes are outside the scope:
- V49-1: the validator lock, tooling;
- V49-3: an audit record;
- V49-4: a README line and a source comment.

None of them holds the deploy. My reasons are given for each one below.

## Auditor dispositions

I read all four reports in full. Every report's `wc -m` equals what the listing printed (29,461 / 59,451 / 34,143 / 39,066).

| Seat | Disposition |
|---|---|
| **opus** (Opus 5.5) | **Counted.** It names its read set and its not-read set, and runs the four allowed checks: 806, 1089, 69, 39, which equal mine. Its R0 checks each round-48 repair at the construct: `plan-redeem.mjs:97`, MINT `claim`'s pending branch at `:1695-1703`, `retire` at `:1882`, and the lock at both runners. Its R7 offsets are right: `bare_burns_retired` 454, `sweep_floor_lamports` 631, the ring 749..1005, and VaultRecord `pending` 177, `request_epoch` 178, `carry_scaled` 195, total 221. It MEASURED F49-1 by applying the rehearsal map to `validator-lock.sh`, and I reproduced that.<br>**Confirmed:** F49-1 (V49-1), F49-2 (V49-2).<br>**Not a defect:** F49-3 (C3), F49-4 (C4).<br>**Already stated:** F49-5 (C5). |
| **fable-a** (Fable 5.1) | **Counted.** It runs the allowed checks with equal results. It recomputes the discriminators and the offsets by encoding the structs through `bank/layout.mjs`, and it models the page's opening sizes: 1,061 bytes, and 1,113 with the compute-budget pair. Its V48-1 citation is exact (`plan-redeem.mjs:97`).<br>**Confirmed:** INFO-3 (V49-3), measured by `git log -- programs/`.<br>**Already stated:** INFO-1 (C6, round 45 C26).<br>**Not a defect:** INFO-2 (C7).<br>**Against it, two errors in the reassuring direction:**<br>• R1s(c): "a destination below rent exemption receives lamports". The runtime refuses that, as R41.C8a-c measure (C18).<br>• R2: "retiring a pending vault in … a later one adjusts the right counter (3c arms)". No arm does: F21.1 is same-epoch only (C9). |
| **fable-b** (Fable 5.1, reverse order) | **Counted.** The deepest walk. It quotes the floors and the `-eq` floor checks, ties the suite log's deployed sweep hash `5c6739…` to `target/deploy/` and `dist/`, models BURN's ring against a brute-force oracle, and matches every `ix.mjs` builder against the Rust `Accounts` structs. Its F-1 facts are true (C9).<br>**Against it:**<br>• F-2 is disproved. It read the `because()` list and missed the pin on `R42.C12a` (C10).<br>• Its V48-2 citation `validate-core-gate.sh:525-526,540` cannot be right, because that file has 61 lines; the lock is at `:30` and the boot at `:42`. Its conclusion is right (C18). |
| **sonnet** (Sonnet 5.5) | **Counted.** It is honest about a partial read (`reads.mjs` to 200, `decode.mjs` to 140, and `vault.mjs`, `draw.mjs` and `run-tests.sh` unread). Its claims are specific and check out:<br>• `txRefusal`'s early return at `rpc-proxy.mjs:163`;<br>• MINT `claim`'s pending branch;<br>• the 240-address `pob_root` `522ac90e…` recomputed and equal to `launch/mainnet-init.json:43`;<br>• the `INIT_AUTHORITY` bytes absent from `dist/`;<br>• the three `luna-remotion` require lines.<br>Its I3 mechanism is true in source (C16). All its filed items are already stated or not defects (C13-C16).<br>**Against it:** "resolved from the untracked `/opt/cbob-vaults/node_modules`" is false. `node_modules` is a tracked symlink (`git ls-files -s`: mode 120000) to `/opt/gary-club/node_modules`, which is exactly the boundary rounds 27, 34, 36 and 42 recorded (C13). |

**Quorum: 4 counted of 4, 3 required. MET.** All four engage the real code at this head. None of them restates an older tree or invents a construct that bears on its conclusions. Their errors are confined to the sub-claims named above.

## Method and evidence

- **Records read:**
  - the triage brief (`.cache/TRIAGE-BRIEF-r49.md`);
  - `audits/round49/BRIEF-programs.md` (head and scope) and the manifest;
  - round 48's `VERDICT-programs.md`, `VERDICT-offchain.md` and `VALIDATION.md`;
  - the headers and confirmed lists of rounds 44-47's verdicts;
  - the precedents cited below (round 36 A10, round 40 A3, round 42 C02/C21/C9, round 41 C14, round 43 C20, round 44 V44-6, round 45 C22/C26, round 37 W6);
  - SPEC limits 10 and 47 (`:1206-1220`, `:1741-1757`), items 22 and 53 (`:1892-1936`, `:2202-2240`) and the error note at `:2598`.
- **Source read at `617504d`:**
  - MINT: `activate` (`:1413-1452`), `sweep_sol_for_swap` (`:1055-1068`), `claim` (`:1675-1712`), `rescue_nested` (`:1825-1869`), `retire` (`:1875-1910`), `credit` and `advance_epoch` (`:1914-1933`), `waiting_to_join` (`:2003-2005`), `join` (`:2021-2034`), and host test N1 (`:3168-3225`);
  - the pages and libraries: `plan-redeem.mjs` (`:1-30`, `:85-105`, `:196-207`), `redeem.mjs` (`:96-102`, `:203-232`), `vault.mjs` (`:96-177`), `plan-vault.mjs:55-66`, `plan-get.mjs:64-67`, `rpc-proxy.mjs:140-170`;
  - the scripts and tests: `validator-lock.sh` whole, `rehearsal-tree.sh:25-90`, `core-watch-suite.sh:35-48`, and every lock and kill site in the seven shell runners;
  - `tests/3prog.test.ts`: `ledger()` `:834-844`, F21 `:3064-3090`, R42.C12a `:2826-2850`, `because()` `:3910-3923`, and the rec labels for pending/waiting;
  - `sim/test-vault.ts:335-365`, `web/test/e2e-localnet.mjs:285-390`;
  - `HOLDER-GUIDE.md:30-50, 185-200, 215-228`, `README.md:8-16, 101`, `web/README.md:68-93, 436-440`.
- **Allowed runs at `617504d`** (logs in `/tmp/claude-1000/triage49p/`), all exit 0:
  - `node web/test/run-all.mjs`: **806/806** in 11 files;
  - `node bank/selftest.mjs`: **1089/1089**;
  - `node scripts/check-launch-params.mjs --selftest`: **69/69**;
  - `node bank/redemption-poster.mjs --selftest`: **24/24**;
  - `node bank/accrual.mjs --selftest`: **39/39**.
- **Canonical logs at `128d84d`, read:**
  - `.cache/128d84d-suite.log`: RC 0; program source equals `RELEASE_COMMIT` `d2ae5fc`; web 806/806; detectors 1089; allocation 39; probe **35/35**; on-chain **913/913** (floor 913); expiry budget 4/4; swap fork 16/16.
  - `.cache/128d84d-web-e2e.log`: **154/154**, RC 0. Both V48-1 arms are `ok`, and the widest openings landed at 1,218 and 1,201 bytes.
  - `.cache/128d84d-sim.log`: **71/71**, RC 0.
- **Measurements** (scratch only):
  - **The rehearsal map applied to `validator-lock.sh`.** Python, the same `str.replace` as `rehearsal-tree.sh`'s map, with ROOT `/opt/cbob-vaults` and DEST `/home/ubuntu/cbob-rehearsal`. It yields `VALIDATOR_FLOCK=/home/ubuntu/cbob-rehearsal/.cache/VALIDATOR.flock`.
  - **The rehearsal tree exists at `/home/ubuntu/cbob-rehearsal`, at `1650336`.** I only listed it.
  - **`git log -- programs/`.** The last change is `0b3ddb3` ("v6 round 35: rescue_nested"), after `1281ab4` (round 34) and `de3d56f` (round 28).
  - **Lock coverage.** I ran `git grep` for `solana-test-validator|pkill -x solana-test-val` and counted lock sites. Every tracked shell runner takes the lock (`run-tests`, `build-mainnet`, `run-sim`, `swap-fork`, `e2e-localnet`, `rehearsal-local`, `validate-core-gate`; lock 1, `9>&-` 1 each). `tests/expiry-budget.mjs` runs only under `run-tests.sh:546`. Every other hit is a string in `scripts/audit*.ts` or a comment.
- **Not run:**
  - no validator, `scripts/run-tests.sh`, sim, e2e, swap fork, `build-mainnet.sh` or rehearsal script;
  - no `bank/alarm.mjs`, crank, revenue job or Core watch;
  - no transaction and no notification.

  `dist/`, `.cache/core-watch/` and `.cache/VALIDATOR.flock` were untouched.

## Distinct claims

Class column: (a) a finding in the five programs; (b) a value path, or a wrong credit; (c) a stopped or wrongly refused crack; (d) HIGH or MEDIUM anywhere. "None" means outside all four.

| ID | Reporters | Claimed | Verdict | Class | Evidence (file:line) |
|---|---|---|---|---|---|
| C1 | Opus F49-1 (the validator lock is per tree; the rehearsal tree's runners and production's do not exclude each other, and both kill every validator on the machine) | LOW | **CONFIRMED, LOW (V49-1)**, measured | none | `validator-lock.sh:24` (path literal under the repo root); `rehearsal-tree.sh:63` (`$ROOT $DEST root` in the map), `:75` (applied to every tracked file under `scripts/`); the measured mapped path; `run-tests.sh:60-66` and `validate-core-gate.sh:30-33` (lock, then `pkill -x solana-test-val` and `fuser -k` 8999/9900, no `pgrep` guard); `core-watch-suite.sh:43` (the same per-tree file) |
| C2 | Opus F49-2 ("nothing can leave it while it is closed" is untrue of `rescue_nested` and of a permanent-delegate token) | INFO | **CONFIRMED, INFO (V49-2)** | none | `mint/src/lib.rs:1836-1869` (moves a CBOB vault out of a LIVE, sealed host's wallet to `bank_treasury`, with no signature from the host's owner; landed in e2e "rescue (its own wallet)" / "rescue (from a burned host)" and R35.N*). Sites: `web/src/pages/vault.mjs:104`; `HOLDER-GUIDE.md:40-41`; `README.md:12-13`; `README.md:101` (generated from `scripts/readme-facts.mjs:30`). Contradicted on the same page (`vault.mjs:139`) and in the same guide (`HOLDER-GUIDE.md:191-197`) |
| C3 | Opus F49-3 (the V48-1 e2e arms are narrower than their titles; round 48's gate-5 race arm was not built) | INFO | Facts **TRUE**. **NOT A DEFECT** as a test that cannot fail. Race arm **carried** as an obligation | none | `e2e-localnet.mjs:380-381` asserts `!err` and the `Instruction: Claim` log only, so "(it joins it, owing nothing)" is unasserted. The arm's property for V48-1 (the claim never fails a waiting vault) does fail if it breaks. The join itself is measured on chain by 3c.A6b (`3prog.test.ts:2954`) and P.17b (`:3063`). Round 48's own line for undone gate-5 arms is C10 ("requirements, not findings") |
| C4 | Opus F49-4 ("Run a payout" shows the pool's backlog, not this vault's share) | INFO | **NOT A DEFECT** | none | `redeem.mjs:212` says the sats "are not yours until a payout runs" and "your vault's share is then collected". The block is shown only for an ACTIVE vault with an unfrozen pool (`:102`). Showing an estimate is optional |
| C5 | Opus F49-5 (item 22's scale cannot be met on mainnet before the first mint; item 53's in-tree run is stale) | INFO | **ALREADY-STATED**; a decision for Gary, not a defect | none | SPEC `:1892-1936` (22 OPEN AND BLOCKING for ~2,100-vault scale, "before anything mints"); `:2231-2233` (53: last in-tree run `e7c192a`, every repair commit needs it again). Neither is written as accepted |
| C6 | Fable-a INFO-1 (limits 10 and 47 do not bound a thief holding BOTH the guardian and the operator key) | INFO | **ALREADY-STATED** | none | Round 45 C26 ("Fable limits 10/47 compound … ALREADY-STATED in substance; optional wording"). SPEC limit 47 states the guardian can cancel any armed operator; limit 10 states the tighten-only vote |
| C7 | Fable-a INFO-2; Fable-b R8 list (no arm for a wSOL source, a destination named twice, a source that is also a destination, another vault's signer as destination) | INFO | **NOT A DEFECT** (coverage) | none | Round 41 C14, round 42 C9, round 43 C20, round 48 C22. `sweep/src/lib.rs:44-81` accepts each by construction, or it is impossible (`signer != dest`, `:50`) |
| C8 | Fable-a INFO-3 (`VALIDATION.md` says "the five programs are unchanged since round 27") | INFO | **CONFIRMED, INFO (V49-3)**, measured | none | `audits/round48/VALIDATION.md:74-75`; the same sentence is at `round47/VALIDATION.md:74`, `round46:56` and `round45:58`. `git log -- programs/`: `de3d56f` (round 28), `1281ab4` (round 34) and `0b3ddb3` (round 35, `rescue_nested`, +106 lines) all changed program source after round 27 |
| C9 | Fable-b F-1 (no arm retires a WAITING vault whose request epoch has passed) | LOW | Facts **TRUE** (searched). **NOT A DEFECT**: coverage; the branch is correct by inspection | none | `mint/src/lib.rs:1898-1903`. The invariant `pending_this_epoch` = #{pending r : r.request_epoch == dist_epoch} holds: `activate` `:1444-1448` (+1, `request_epoch = dist_epoch`), `advance_epoch` `:1928` (zeroed), `join` `:2026` (`pending_count` only, needs `dist_epoch > request_epoch`). No arm: F21.1 is same-epoch (`3prog.test.ts:3067-3083`); `ledger()` does not read the counters (`:834-842`); N1 retires active records only (`:3199-3215`); the sim's bare burn and the e2e retire no waiting vault. Fable-a's "3c arms" claim is false. Recommended arm in gate 5 |
| C10 | Fable-b F-2 (`R42.C12a` reads `REJECT,none` if its loop never runs) | INFO | **DISPROVED** | none | `3prog.test.ts:3923` pins `because('R42.C12a', 'Program 1111…1111 failed: custom program error: 0x0')`. With `pf` null the arm records no error, `hit` is false, and `R42.C12a!` fails (`:3910-3912`). `.cache/suite.log`: `ok R42.C12a!  rejected because … 0x0` |
| C11 | Fable-b observation (`sweep_sol_for_swap` refuses a zero amount with `SweepAboveCap`) | (observation) | **ALREADY-STATED**; not a class-(a) finding | none | `mint/src/lib.rs:1059`; SPEC `:2598` ("`SweepAboveCap` also rejects a zero sweep"); 6.17b pinned (`3prog.test.ts:3963`) |
| C12 | Fable-b observation (`HOLDER-GUIDE.md:152` "announced on X" while the poster has no sender) | (observation) | **ALREADY-STATED** | none | Item 50; the guide is DRAFT and barred from publication until item 50 ships |
| C13 | Sonnet F1 (the pages' build inputs are not pinned; esbuild comes from `/home/ubuntu/luna-remotion`) | LOW | **ALREADY-STATED**; one premise false | none | Round 36 A10, round 40 A3, round 42 C21/C02, round 45 C22 ("Optional: pin it in-tree"). `web/build.mjs:31`. `node_modules` is TRACKED (mode 120000 → `/opt/gary-club/node_modules`), not untracked. SPEC limit 10(c)/D2(3) (the same user's tree is trusted). Not a required change |
| C14 | Sonnet I1 (the build cannot prove the mainnet `INIT_AUTHORITY` constant) | INFO | **ALREADY-STATED** | none | `build-mainnet.sh:204-208` says so itself; round 41 C5. Its runbook point (lock no program before its `initialize` has landed and been read back) is the road's own order, steps 10 then 11. Recorded for Gary |
| C15 | Sonnet I2 (the proxy relays a transfer bundled with one CBOB instruction) | INFO | **ALREADY-STATED**, tested | none | Round 37 W6; `web/README.md:299` ("a stranger's transfer IS relayed, round 37 W6, tested"). The header's claim is about a *plain* transfer, which `rpc-proxy.mjs:163-168` does refuse |
| C16 | Sonnet I3 (V48-1's shape one state earlier: a funded, never-requested vault requested, joined and credited during approval) | INFO | Mechanism **TRUE** (source). **NOT A DEFECT** under round 38 W5 / round 33 A15, as round 48 applied them | none (not (c): one preflight refusal, nothing lands, at most once per vault) | `activate` is permissionless and runs `monthly_inline` BEFORE the request (`:1414-1418`, `:1442-1449`), so the crank cannot request and credit in one pass. It needs a request, an epoch advance, a join and a second credit with fresh pool revenue, all inside one approval window. A blind adversary pays 100 $GARY per burn distribution. Unlike V48-1, ordinary traffic cannot produce it. Optional: claim for any non-retired record, since MINT's `claim` skips a record that is neither pending nor active without reading `dest` (`:1694-1704`) |
| C17 | **triage**: V48-1's rule was not swept to its prose ("claim only for an activated vault") | INFO | **CONFIRMED, INFO (V49-4)**, source | none | `web/README.md:72` ("`claim` (only activated, never while the pool is frozen)"); `web/src/lib/plan-redeem.mjs:9` (header: "[claim] (only for an activated vault, …)"), against `:97` (`active || pending`). The same staleness shape as V47-9 and V48-3 |
| C18 | Seat errors: Fable-a R1s(c) (a below-rent destination "receives lamports"); Fable-b's `validate-core-gate.sh:525-526,540`; Sonnet's "untracked node_modules" | (none) | **DISPROVED** | none | R41.C8a-c (the runtime refuses, as Opus, Fable-b and Sonnet state); `wc -l validate-core-gate.sh` = 61 (lock `:30`, boot `:42`); `git ls-files -s node_modules` |
| C19 | Every seat (round 48's repairs hold; round 48's disproofs stand) | (agree) | **AGREE**, independently re-checked, with residues V49-1 (a new cross-tree site) and V49-4 (V48-1's text) | none | See the re-check below |
| C20 | Every seat's "before launch" list (clean-machine rebuild and hash comparison, a second RPC, real Phantom/Ledger on the widest openings, canary vaults, key custody for the guardian and the Moments update authority, a Core-upgrade runbook, a bounty, a scale run, a legal opinion) | (recommendations) | **NOT FINDINGS** | none | Recorded for Gary. None is a defect in the tree |

## Confirmed findings

**V49-1: LOW.** Reporter: Opus 5.5 F49-1. Tooling. Measured.

**The one-validator lock is one file per TREE, but the ports and the kill-all are per MACHINE.**
- **The lock path.** It is the literal `/opt/cbob-vaults/.cache/VALIDATOR.flock` (`validator-lock.sh:24`; `core-watch-suite.sh:43` uses `$C/VALIDATOR.flock`).
- **The rehearsal map rewrites it.** `rehearsal-tree.sh` adds `$ROOT $DEST root` to its substitution map (`:63`) and applies the map to every tracked file under `scripts/` (`:75`). Inside the rehearsal tree the lock is therefore `<tree>/.cache/VALIDATOR.flock` (measured: `/home/ubuntu/cbob-rehearsal/.cache/VALIDATOR.flock`).
- **The two trees' runners do not exclude each other.** Both trees' runners boot on 8999/9900. `run-tests.sh` (`:60-66`) and `validate-core-gate.sh` (`:30-33`) take only the lock, then kill every `solana-test-val` and free those ports. Neither has a `pgrep` guard; `run-sim.sh`, `e2e-localnet.sh` and `rehearsal-local.sh` do, and theirs match across trees.
- **Why that is a live risk.** SPEC 53 requires the full suite inside the rehearsal tree at each repair commit. The Core watch starts the production suite on its own after any Core upgrade. So the two can run at once, and either kills the other's validator. That is V47o-2's failure mode, across trees.
- **Why it is not HIGH, and not in (a)-(d).** It fails closed. The victim's arms then address programs absent from the other tree's validator (throwaway ids, `--reset` ledger), so they fail; there is no false pass. No value moves.
- **Not in (a)-(d).** **Class: none.**
- **Does not hold the deploy.** This is the lock between runners, not the suite's evidence. A collision produces a failed run, never a passing one, so the 913/71/154 evidence is unaffected.
- **A note on SPEC 53.** SPEC 53 says the root-path substitution exists so "the rehearsal's keys, locks and caches never touch production's". That intent predates the V47o-2 lock and is right for the job locks. For the machine-wide validator it defeats the lock's own purpose ("ONE TEST VALIDATOR AT A TIME", `:1`).
- **Repair:** put the lease at a machine path outside any repo root (for example `/run/lock/cbob-validator.flock`, or under `$HOME/.cache/cbob/`), which the map cannot rewrite. Add a selftest arm: the rehearsal-mapped `validator-lock.sh` must name the same lock file as production's. It is red today.

**V49-2: INFO.** Reporter: Opus 5.5 F49-2. Page copy and documentation.

**"Nothing can leave it while it is closed" is false as written.**
- **The code.** MINT's permissionless `rescue_nested` moves a CBOB vault out of a LIVE, sealed host's wallet to `bank_treasury`, without the host's owner (`mint/src/lib.rs:1836-1869`; landed in the e2e and in R35.N*). A token whose issuer kept a permanent delegate can also be moved out of a sealed wallet by that delegate.
- **The sites.** The absolute sentence stands at:
  - `web/src/pages/vault.mjs:104` ("Sealed: Yes. Nothing can leave it until it is opened.");
  - `HOLDER-GUIDE.md:40-41` ("What goes in stays in until the day you open it");
  - `README.md:12-13`;
  - `README.md:101`, generated from `scripts/readme-facts.mjs:30`.
- **The texts contradict themselves.** The same page says "A vault inside can be rescued from its own page" (`vault.mjs:139`), and the same guide describes the rescue (`HOLDER-GUIDE.md:191-197`).
- **The precedent.** Round 44 confirmed this exact shape at INFO (V44-6: an absolute holder sentence, "credited stays yours", with an exception stated elsewhere).
- **Not in (a)-(d).** Nothing is misstated about the three reserves or about any payout. **Class: none.**
- **Repair:** one wording at all four sites, for example: "Nothing you or anyone can sign for leaves it while it is closed, except another vault sent into it (the rescue returns it to its sender) and a token whose issuer kept the power to move it." Pin the vault page's sentence in a page test.
- **Holds the deploy, for its `vault.mjs:104` half only.** The guide and README halves are documentation and would not hold it. The vault page is a page holders sign through (Activate, Rescue), and its text is what they read about their vault. A required change there is a change "THERE" under the ruling. The change alters no instruction, account or transaction that any page builds.

**V49-3: INFO.** Reporter: Fable-a INFO-3. Audit records.

**`audits/round48/VALIDATION.md:74-75` says "The five programs are unchanged since round 27".**
- **The history.** Program source changed in `de3d56f` (round 28), `1281ab4` (round 34, the sweep helper) and `0b3ddb3` (round 35, `rescue_nested`, +106 lines). The release build `d2ae5fc` has the same source as `0b3ddb3`.
- **The same sentence elsewhere.** It recurs in rounds 45, 46 and 47's `VALIDATION.md`.
- **What is still true.** The substantive claim (HEAD's programs equal the release build's) is true and measured.
- **The cost.** A reader would date the last program change, and so the rounds that have read the current `rescue_nested`, wrongly.
- **Class: none.** Does not hold the deploy (a record).
- **Repair:** say "unchanged since round 35 (`0b3ddb3`); the release build is `d2ae5fc`" in round 49's record, and correct forward. Do not rewrite the old records.

**V49-4: INFO.** Reporter: this triage.

**V48-1's rule did not reach its prose.** The planner now claims for an active OR waiting vault (`plan-redeem.mjs:97`). Two places still state the old rule:
- `web/README.md:72`: "`claim` (only activated, never while the pool is frozen)";
- the planner's own header, `web/src/lib/plan-redeem.mjs:9`: "[claim] (only for an activated vault, and never while the pool is frozen)".

This is the same not-swept shape as V47-9 and V48-3. The holder-facing note (`plan-redeem.mjs:99`) and the redeem page are right.
- **Class: none.**
- **Does not hold the deploy.** The `web/src` half is a source comment. It changes nothing a holder or Gary sees or signs, and it is documentation by substance even though it sits inside the scope's directory.
- **Repair:** update both lines.

### The documentation exception (SPEC gate 3, ruling of 2026-10-07)

- **V49-1** changes code. **Not eligible.**
- **V49-2, V49-3 and V49-4** are text. V49-3 and V49-4 misstate nothing about holders' money. V49-2's page half misstates what can leave a sealed wallet, though not anything about the reserves.

The pass is therefore not a no-change round. Under the 2026-10-10 ruling, only V49-2's page sentence is in the deploy's scope.

## Rounds 44 to 48 re-check, per confirmed finding

The five programs are byte-identical in source to `d2ae5fc`, the release every one of these rounds judged. So no finding can have moved into the programs.

| Finding | Severity | (a) programs | (b) value | (c) crack | (d) H/M | Outside (a)-(d)? |
|---|---|---|---|---|---|---|
| R44 **V44-1** to **V44-7** (rehearsal value file, `release_gate`, coverage credit, legend, limit 59 rent, "the one exception", absent collection label) | LOW ×3, INFO ×4 | No | No | No | No | **Yes** |
| R44o **V44o-1** to **V44o-5** (poster skip, split-recovery scan, null SEAL baselines, no-network exit, runbook) | LOW ×3, INFO ×2 | No | No (the revenue job stops; balances stay) | No | No | **Yes** |
| R45 **V45-1** to **V45-11** (driver predicates, keys, rescue, cycle order, text) | LOW ×5, INFO ×6 | No (driver, docs) | No (throwaway keys only) | No | No | **Yes** |
| R45o **V45o-1** to **V45o-7** | LOW ×2, INFO ×5 | No | No (V45o-2: the capped sweep to the Bank's own operator key, limit 10) | No | No | **Yes** |
| R46 **V46-1** to **V46-8**; R46o **V46o-1** to **V46o-5** | LOW ×5, INFO ×8 | No | No | No | No | **Yes** |
| R47 **V47-1** to **V47-9** (README facts, a suite arm, the judge's floor and roles, text) | LOW ×5, INFO ×4 | No (V47-4/5: page judge) | No | No | No | **Yes** |
| R47o **V47o-1** to **V47o-9** (Core watch, validator lock, records, installer, mock) | LOW ×3, INFO ×6 | No | No | No | No | **Yes** |
| R48 **V48-1** waiting vault's opening carried no claim | LOW | No (page) | No (preflight, nothing lands) | No (retryable once per vault) | No | **Yes**. **Holds** in code at `plan-redeem.mjs:97` (the only opening builder; `:200` builds the claim, `:206` the burn). Its prose did not follow (V49-4) |
| R48 **V48-2** two runners missed the lock | LOW | No | No | No | No | **Yes**. **Holds** at all seven shell runners and the one node runner (measured). A new cross-tree site is V49-1 |
| R48 **V48-3** `web/README.md` stale count and listing | INFO | No | No | No | No | **Yes**. **Holds**: `:438` says 806 (= `WEB_FLOOR`), and `:87-92` say one `getTokenAccountsByOwner` per program; no other "801" or "owner filter" remains |
| R48o **V48o-1** to **V48o-7** (Core-watch DIED state, floor gating, a burnt vault's account paged CRITICAL, lock in `validate-core-gate.sh`, diagnostic count, reader System transfer, installer) | LOW ×4, INFO ×3 | No (`core-watch*`, `run-tests.sh`, `alarm.mjs`, `txread.mjs`, `cron-install.sh`) | No (V48o-3 is a detection error; V48o-6 tightens a reader) | No | No | **Yes**. V48o-4 holds (`validate-core-gate.sh:30`); the others are off-chain and were not re-measured here beyond detectors 1089/1089 |

**All are outside (a)-(d).**

## Gate-5 obligations

SPEC ship gate 5 requires that every confirmed defect's repair becomes a suite or selftest assertion, and so does every rejected finding that could be measured. These are requirements, not findings.

1. **V49-1:** a selftest arm: the rehearsal-mapped `validator-lock.sh` must name the same lock file as production's. It is red today.
2. **V49-2:** a page test pinning the corrected vault-page sentence. The README line is pinned by `readme-facts.mjs --check` once its source changes.
3. **V49-3, V49-4:** text.
4. **Measurable rejections:**
   - **C9:** request activation, advance the epoch, then (i) redeem with the pool frozen (no claim) and (ii) bare-burn and `retire_burned` another. `pending_count` must fall by one each time, `pending_this_epoch` must be unchanged, and the next `distribute` must not be refused `Overflow`.
   - **C3:** assert the join in the e2e arm (the `VaultActivated` event, or the record read back). Then either build round 48's race arm (plan a waiting vault's opening, land a join and a credit, send the planned opening; it must open, and it must be red on the pre-V48-1 planner), or record why 3c.A6b plus W2 replace it.
   - **C16:** if the claim is widened to every non-retired record, a plan arm and an e2e arm for a funded, never-requested vault.
   - **C7:** the four pair-list arms (wSOL source, a repeated destination, a source also a destination, another vault's signer as destination).
   - **C10, C11, C15:** already pinned (`because('R42.C12a')`, 6.17b, round 37 W6's proxy arm).
5. **Carried from rounds 47 and 48, still NOT done** (verified):
   - C26: `plan-get.mjs:66` still reads `?.body.frozen`;
   - C11: `scripts/rehearsal-refresh.mjs` has no selftest;
   - round 48 C8: `validator_lock` still does not create or name its directory;
   - round 48 C5/C6 arms;
   - round 47 C16, the judge refusing a second limit or price (not re-measured).
6. **Items 22 and 53** (C5): the ~2,100-vault scale (a synthetic local run, or Gary's ruling) before anything mints, and the full suite inside the rehearsal tree at the final commit (last proven `e7c192a`).

## Measurement limits

- **No validator was run.**
  - V49-1 is established by applying the map to the file and reading the runners. I did not start two runners side by side.
  - V49-2's rescue is established from source, plus the recorded e2e and suite landings at `128d84d`.
  - C9's correctness is established by reading. C16 is reasoned from source; I did not land the four-step race.
- **C9's "no arm" rests on searches.** I searched rec labels, `ledger()`, F21, N1, the sim and the e2e. A retire of an earlier-epoch waiting vault buried inside an arm with another label could have escaped it. The counter fields are read only at the four sites listed (`OFF_PENDING_*` grep).
- **Off-chain files** (`core-watch*`, `alarm.mjs`, `cron-install.sh`) were read only where a claim here turned on them. Their audit belongs to the off-chain pass, which this round did not run.
- **The canonical runs are at `128d84d`, not `617504d`.** The difference is records, one README line and `scripts/audit49.ts` (measured by `git diff --stat`). No certifying run was made at this head.
- **Unmeasured here, as rounds 36 to 48 also stated:**
  - a real Phantom on the widest openings;
  - a real Squads v4 return;
  - the live proxy behind Cloudflare;
  - DAS on mainnet;
  - the crank at ~2,100 vaults;
  - whether a holder understands any page sentence.

## Remaining requirements

- **This pass:** V49-2's vault-page sentence. That is the one in-scope change, and under the 2026-10-10 ruling it holds the deploy until it is made. Then V49-1, V49-3 and V49-4 and their arms, which do not hold it.
- **Unchanged:**
  - Items 22 (scale), 38, 50, 52 and 53 remain OPEN AND BLOCKING ("before anything mints").
  - `charter_opens_at`, `lock_deadline` and `vault_collection` remain OPEN in `launch/mainnet-init.json`.
  - No deployment, initialization, lock, ceremony, cron installation, rehearsal or publication follows from this audit by itself.

**Result:** QUORUM MET (4 counted of 4; 3 required; no re-runs). LAUNCH-CLEAN: 0 CRITICAL, 0 HIGH, 0 MEDIUM. Nothing in the five programs, no value path, no refused crack.

REQUIRES CHANGES: V49-1, V49-2, V49-3, V49-4. HOLDS THE DEPLOY: V49-2 (its `web/src/pages/vault.mjs:104` sentence).

---

**Reply (under 300 words).**

# Round 49, PROGRAMS pass: LAUNCH-CLEAN; QUORUM MET
REQUIRES CHANGES: V49-1, V49-2, V49-3, V49-4
HOLDS THE DEPLOY: V49-2

**Counted, 4 of 4 (3 needed), no re-runs:** Opus 5.5, Fable-a, Fable-b (its F-2 is disproved: the `because('R42.C12a')` pin catches a loop that never ran), and Sonnet (partial read, stated; its "untracked node_modules" is false). All four engage `617504d`. The programs equal `d2ae5fc`. Selftests: 806, 1089, 69, 24, 39. Canonical runs at `128d84d`: 913, 154, 71.

**Confirmed, all outside (a)-(d), none in the programs:**
- **V49-1, LOW (Opus):** the rehearsal map rewrites the validator-lock path per tree, while both trees' runners kill every validator on the machine. It fails closed. Tooling; does not hold.
- **V49-2, INFO (Opus):** "Nothing can leave it while it is closed" is false, because `rescue_nested` moves a nested vault out of a sealed host (`vault.mjs:104`, `HOLDER-GUIDE.md:40`, `README.md:12`, `:101`). **It holds the deploy for the vault-page sentence only,** a one-line copy edit with no transaction effect.
- **V49-3, INFO (Fable-a):** `VALIDATION.md` says the programs are "unchanged since round 27"; the right date is round 35. A record; does not hold.
- **V49-4, INFO (triage):** V48-1's rule is not reflected in `web/README.md:72` or the comment at `plan-redeem.mjs:9`. Documentation; does not hold.

**Not defects, or already stated:**
- Fable-b's untested earlier-epoch waiting retire: true, coverage only; the code is correct, and the arm goes on gate 5.
- Sonnet's earlier-state race: true in source, but ordinary traffic cannot produce it.
- Opus's e2e-arm and payout notes.
- The compound key, esbuild, proxy, `INIT_AUTHORITY`, item 22/53 and zero-sweep points.

Rounds 44-48: every finding is outside (a)-(d); V48-1 to V48-3 hold in code.
