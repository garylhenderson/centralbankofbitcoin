# Round 34, PROGRAMS pass: NOT CLEAN; QUORUM MET

**Independent triage verdict against frozen HEAD `90a05ff9c203ce8d9b7e8419a2bf8c0a376e32cb` (round-33 repairs `82bb3ef`; HEAD adds round-33 documentation only). Seven substantive, completed, current-tree reports are counted against a required six, so quorum is met. Six independently confirmed findings survive (one MEDIUM, one LOW, four INFO), so the pass is not clean.**

The clean-round counter remains **0/2**.

**About 45 deduplicated claim groups: six confirmed (0 CRITICAL, 0 HIGH, 1 MEDIUM, 1 LOW, 4 INFO), two shared with the off-chain pass, about 22 accepted, covered or optional, and fifteen refuted, three of them by new validator measurement.** No value path out of a vault, the pool or the revenue address is confirmed. The MEDIUM is in the launch procedure: a stranger can pre-fund a program's **ProgramData** address, which round 33's deploy runbook does not cover and which, unlike the program address, has no recovery at the same id (measured). The counted CRITICAL (GLM F1, a stranger claiming a vault's reserve-account address) and MEDIUM (GLM F2, the reader refusing every no-CPI transaction) were both measured and refuted.

## Auditor dispositions

`MANIFEST-programs.first-run.json`: head `90a05ff`, `dirty: []`, prompt 1,255,219 characters, requested 8, runner-counted 6, required 6 (opus-5 `length` at 128,000 output tokens, kimi-k3 `error`). `MANIFEST-programs.json` (same head, same script, round-24/31 precedent): the two failed seats re-run; opus-5 `stop`, kimi-k3 `error` again. A fresh offline render (`RENDER_ONLY=1 FOCUS=programs npx --no-install tsx scripts/audit34.ts`) gives **1,255,219** characters, equal to both manifests, no unresolved placeholders in the authored prose, accepted-limits section present (`.cache/triage34p/render.out`). `git status` shows only untracked `audits/round34/`. Every counted report was read in full; the runner's counts were not taken on trust.

| Auditor | Disposition |
|---|---|
| deepseek/deepseek-v4-pro-0813 | **Counted, thin.** `stop`, 18,397 characters, 4,432 output tokens in 131 s. Not a restatement: it quotes BURN's current second loop, the 866-assertion suite and round 33's deploy-dust rehearsal, and argues its own (mostly wrong) shapes. No R0, R3, R4 or R7 section. C1 (A1-limit 40); C2 refuted (W7); C3 covered (A4); H1, H2, M2, M4, L1, L2 refuted (W8); H3 (A12); M1, M3, L3 and its three "limit worse" notes accepted (A13-A15). |
| anthropic/claude-opus-5.5 | **Counted.** `stop`, 13,171 characters. Short but current-tree and specific: checks each round-33 repair at its site, re-derives the half-cooldown window argument, recomputes all five spaces and the GOV/BURN offsets. **F1 confirmed by measurement (M1)**; **F2 confirmed (D1)**; **F3 confirmed (D2)**; F4 accepted, mechanism true (A2); F5 no finding. |
| qwen/qwen3.8-max-prime | **Counted.** `stop`, 26,115 characters. Current tree (round-33 repairs and R33.G1-G4 named, 866 floor). LOW-1 is round 33 A16 (A9); INFO-1 accepted (A10); INFO-2 covered by item 38 (A11). |
| fireworks/ember-1 | **Counted.** `stop`, 35,472 characters. The widest current-tree walk; R0 traces every repair and the floor arithmetic 861 + 5 = 866. Its one INFO (limit 29 does not name the pool PDA) accepted (A8). |
| sakana/fugu-max | **Counted.** `stop`, 27,395 characters. Current tree (`18dbff6` plus `82bb3ef`), all offsets recomputed. **LOW-1 confirmed, merged into L1**; INFO-1 refuted (W5); INFO-2 and INFO-3 accepted (A6, A9); its boost-ring comment claim refuted (W6); limit 27/28 notes covered (A7). |
| z-ai/glm-5.3-prime | **Counted.** `stop`, 30,929 characters. Current tree. F1 CRITICAL **refuted by measurement** (W1); F2 MEDIUM **refuted by measurement** (W2, shared S1); **F3 confirmed, merged into D2**; F4 accepted (A5). |
| anthropic/claude-opus-5 (re-run) | **Counted.** `stop`, 40,329 characters, same commit and script. Current tree: R0 table of round-33 repairs at their sites, every MintConfig offset listed, R1s answered item by item. Finding 1's documentation half **confirmed by measurement (D3)**, its MEDIUM impact refuted (W3); **Finding 2 confirmed, merged into L1**; Finding 3 refuted (W4); **Finding 4 confirmed (D4)**; Finding 5 accepted (A3). |
| anthropic/claude-opus-5 (first run) | **Not counted.** `length`, cut off at 128,000 output tokens (`failed/`). Read for leads: its F1 (the seal's owner-side plugin-authority refusals are pinned nowhere) was measured and refuted (W9, a gate-5 item); its F2 duplicates D3; F3-F7 were not pursued as findings. |
| moonshotai/kimi-k3 | **Not counted.** Provider `error` on both runs (`failed/`). |

**Quorum: 7 of 8 seats substantive and counted, 6 required. MET.**

## Method and evidence

- Read all seven counted reports in full and the cut-off opus-5 run for leads; round 33's verdict and VALIDATION; source at `90a05ff`. `programs/`, `Cargo.toml` and `Anchor.toml` are unchanged since `18dbff6` (`git diff --stat` empty); `82bb3ef..90a05ff` changes only `audits/`.
- **Round-33 repairs verified present:** SPEC road step 9's pre-deploy read and recovery; SPEC REDEEMING step 1; DESIGN on `MIN_ROUND_PRICE_SATS`; arm 2.1 recording `vMint.ok`; R33.G1, G2a/G2b, G3, G4. `node bank/selftest.mjs` at HEAD: **909/909**, exit 0; `scripts/audit-coverage.sh --selftest`: **14/14** (`.cache/triage34p/selftest.log`).
- **Gates at this code, reused, not rerun:** 866 on-chain, 909 detector, 39 allocation, 23 poster, 14 PoB, 47 launch, 6 host, 33 live mainnet, 4 expiry, 16 swap-fork (`.cache/r33-full-pass.log`, EXIT 0; spot-checked 866/909, and R33.G1/G2a/G2b `ok` in `.cache/r33-onchain-866.log`), plus 71 simulation (`.cache/r28-sim.log`).
- **Two validator windows**, each after creating `.cache/VALIDATOR.lock` atomically with `noclobber` (content `triage34-programs`) and confirming ports 8999 and 9900 free. Window 1: plain `solana-test-validator` 4.2.1 (`.cache/triage34p/m34.mjs`, `m34.log`). Window 2: the pinned Core (dumped and `cmp`-identical to `.cache/core-mainnet.so`) with the suite's two feature deactivations (`seal34.mjs`, `seal34.log`). Each time the validator was stopped, both ports confirmed free, and the ledger, scratch keypairs and lock removed.
- **Not touched:** no tracked file; `bank/alarm.mjs`, `bank/revenue.mjs` and the crank's main path never imported or run; no live job, notification, cron, mainnet send, deployment or lock. The only file added to the tree is this verdict.

## Confirmed findings

| ID | Severity | Independent disposition and minimal repair |
|---|---|---|
| **M1**: Opus-5.5 F1 | **MEDIUM** | **A stranger can permanently block the loader-v3 deploy of any program at its public id by pre-funding the ProgramData PDA, and round 33's runbook covers only the program address.** `DeployWithMaxDataLen` creates `PDA([program_id], BPFLoaderUpgradeable)` with a System `CreateAccount`, which refuses an address holding lamports. **Measured** (`m34.mjs` part A): with the ProgramData address dusted at the rent minimum (890,880 locally) or 0.01 SOL, both `solana program deploy` and a hand-built write-buffer + `DeployWithMaxDataLen` are refused (System `0x0`, AccountAlreadyInUse); the PDA stays System-owned with the dust. Control: the same deploy at an undusted id lands. Nobody can sign for that PDA except the loader, which never drains it, so round 33's allocate/assign recovery cannot apply, and this validator reports `LoaderV4WasAbandoned` (no loader-v4 escape). The five ids are public now (`declare_id!`, SPEC). The only recovery is new ids: every `declare_id!` and cross-pin changes, which is a program change and resets the freeze. No funds at risk. **Repair (owner decision):** deploy all five at their real ids now as upgradeable programs to reserve them (authority retained until step 11), or accept the exposure in writing; either way step 9 must read both addresses per program, and the rehearsal must exercise this case. |
| **L1**: Opus-5 F2; Fugu LOW-1 | **LOW** | **A vault's name, URI and caller attributes are chosen by its minter, are permanent, and no document says so; the reserved keys are reserved only in exact case.** `create_vault` checks only lengths (`MAX_NAME_LEN` 64, `MAX_URI_LEN` 200, `lib.rs:452-453, 2221-2222`); no instruction in any program calls Core `UpdateV1`/`UpdateV2`, and the collection's update authority is MINT's PDA, so nothing can change them. `check_attributes` (`lib.rs:2173`) refuses `level`, `charter` and `redemption` by exact string, so `Level: V` beside the program's `level: I` mints. A seller can permanently stamp a misleading name, image (via the URI JSON, which the minter can also change off-chain after a sale) or level-lookalike trait into the verified collection, for 21,000 sats or free in the charter window. No money decision reads any of it (`VaultRecord.level` and the lowercase attribute are authoritative), and SPEC 799 ("the minter cannot choose their level") stays true; but neither SPEC's known limits nor HOLDER-GUIDE's honest list tells a buyer that only the on-chain record is authoritative. Never raised in 33 rounds. **Repair (pre-lock owner decision):** build the name and pin the URI prefix in MINT and reserve keys case-insensitively, or add a known limit and an honest-list sentence ("the name and picture are the minter's; only the vault's on-chain record and its `level` attribute count"). |
| **D1**: Opus-5.5 F2 | **INFO** | **Road step 9 (SPEC 2311) gives the test validator's rent figures for a mainnet step.** It says a stranger's dust is "at least 890,880 lamports" and to top up to "1,141,440" (36 bytes). SPEC 885-886 and prompt fact 9 record mainnet's measured 0-byte minimum as 650,240 (5,080 per byte), so mainnet dust can be 650,240 and the 36-byte minimum is 833,120. Overpaying the top-up still works; the stated floor is false for mainnet. **Repair:** state both rates, or read `getMinimumBalanceForRentExemption` on the target cluster. |
| **D2**: Opus-5.5 F3; GLM F3 | **INFO** | **R33.G1 is labelled "the worst single-signature shape" and its comment says it is "THE WORST SINGLE-SIGNATURE SHAPE THE OWNER CAN BUILD"; it is not.** `tests/3prog.test.ts:2409-2421, 2482` mints through `ixMint` with the default 12-character name and 33-character URI (`:628-630`) and adds only the Autograph. Round 33's measured W1(a) shape, which gate-5 obligation 1 named, also had a 64/200 name and URI and all five owner plugins (11,383-byte asset). No false pass (triage measured the full shape twice), but the label, the comment and the prompt's "worst single-signature ... reveal shapes" overstate the pin, and obligation 1 remains partly open (Gate-5 item 1). **Repair:** build the full shape, or relabel and keep the obligation open. |
| **D3**: Opus-5 Finding 1 (documentation half) | **INFO** | **"Called by anyone directly it can do nothing" (`programs/cbob-vault-sweep/src/lib.rs:21-23`) and "Called directly it can move nothing" (SPEC 911-912) are false.** The helper confines sources to accounts owned by `accounts[0]`, whoever signs, not to an asset-signer PDA. **Measured** (`m34.mjs` part B): an ordinary keypair calling the helper directly, fee paid by another wallet, had its token account emptied and closed and its lamports taken to 0, all to the named destination. Only the signer's own holdings move, so vault custody is unaffected (W3). **Repair:** "called directly, it can move only the signer's own holdings; a vault's can move only through Core's `ExecuteV1`, which only the owner can sign." |
| **D4**: Opus-5 Finding 4 | **INFO** | **SPEC item 53 (1937) says the rehearsal proves "all five programs plus `bank/layout.mjs` were patched".** `scripts/rehearsal-tree.sh:106` requires four program sources plus `layout.mjs`; the sweep helper's source carries no program id (it is native, no `declare_id!`; its only `pubkey!` is Tokenkeg), so it cannot be patched, and the script is right. Round 25 D6 corrected the map sentence, not this one. **Repair:** "the four keyed programs plus `bank/layout.mjs`". |

## Shared with the off-chain verdict

| ID / reports | Disposition |
|---|---|
| S1: GLM F2 (`bank/txread.mjs` and no-CPI transactions) | Off-chain code, raised only in this pass. Refuted by measurement here (W2); the live pin is Gate-5 item 3, for the off-chain gates. |
| S2: Opus-5 Finding 3; deepseek limit-56 note | The JS dependency set (shared `node_modules` symlink) and custody of the $CBOB key are off-chain topics already covered (round 27 L7, round 30 W6, round 31 C05, round 33 off-chain C18; limit 56). |

## Accepted limits, covered, bounded or optional

| ID / reports | Disposition |
|---|---|
| A1: deepseek C1 | The helper's access control is Core's `ExecuteV1` rule; limit 40 names that dependency; SR.5-SR.5d measure it. A victim signing a hostile Execute is the owner acting. |
| A2: Opus-5.5 F4 (C-leader cohort is a 4-slot group) | **Mechanism true by code** (`try_capture`, `lib.rs:2128-2149`): B and C depend only on A's 4-slot group, so vaults whose A falls in one group share hB and hC, and C's one choice serves them jointly. SPEC 1332-1334 ("every vault minted in the same slot shares ... the same three hashes") and the guide's "created in that moment" are true but not exhaustive. Optional widening sentence. |
| A3: Opus-5 Finding 5 (limit 36 omits frozen pool, non-token pool, zero weight) | Not presented as exclusive; the frozen pool is limit 28. Optional completion. |
| A4: deepseek C3 | SPEC 669-670 states an explicit `distribute` on a frozen pool; round 33 A4. |
| A5: GLM F4 (`boost_vault` missing from SPEC 775's host list) | True (`lib.rs:1468`); the list is not stated as exclusive, and the omission is the harmless direction. Optional clause. |
| A6: Fugu INFO-2 (MINT's `seal_reserves` hardcodes 3) | True; equal to SEAL and BURN today; no document claims 9.15/9.16 cover MINT. Optional. |
| A7: Fugu limit 27/28 notes | Limit 27 already says "until anyone calls `retire_burned`"; fugu agrees limit 28's text is correct. |
| A8: Ember limit-29 INFO | True for the pool PDA too (only cbBTC moves); limit 29 is not wrong. Optional sentence. |
| A9: Qwen LOW-1; Fugu INFO-3 (error text for `expire_boosts`, and `VaultAccountMissing` for a missing pool) | Round 33 A16 class: correct refusals, cosmetic diagnostics. SPEC 2246's "Two MINT error names" is not stated as a complete list. |
| A10: Qwen INFO-1 (`decimals` caller-supplied) | `TransferChecked` verifies it; a wrong value refuses. |
| A11: Qwen INFO-2 (`assert_classic_spl` checks owner only) | Item 38 states it; the launch checker pins the three. |
| A12: deepseek H3 (`pob_extra` writable) | The claimant chooses the metas; a hostile collection plugin is limit 46 and round 33 A12. |
| A13: deepseek M1, M3 | Core refuses a used asset address; a lamports-only sweep to a missing destination is item 50 (round 25 D9). |
| A14: deepseek L3 (unbounded reschedules) | Requires a lapsed window; limit 25. |
| A15: deepseek limit 41/47 notes | Limit 32 states the unretired-bare-burn cap effect (D8); limit 47's operational note names guardian = `INIT_AUTHORITY` (round 33 A6). |
| A16: Opus-5 FreezeExecute sibling; Opus-5 item-50 packet note | Round 33 A1 class (owner-signed); item 50 already says "mind the packet". |
| A17: all, R0 and launch sections | Round 33's repairs present; items 22, 38, 50, 52 and 53 remain OPEN AND BLOCKING; `charter_opens_at` and `lock_deadline` remain null. Untested optional shapes are round 33 A10. |

## Refuted or unsupported premises

| ID / reports | Independent disposition |
|---|---|
| W1: GLM F1 (CRITICAL, a stranger creates an attacker-owned token account at a vault's ATA address) | **Refuted by measurement** (`m34.mjs` part D, off-curve stand-in wallet). System `CreateAccount` and `Allocate` at the ATA address are refused "'to' account ... must sign": only the ATA program can sign for it. A stranger's lamports there followed by `InitializeAccount3(owner = stranger)` is refused (invalid account data); the address stays System-owned. Control: the ATA program's create then lands with the owner field set to the wallet. The Token-2022 derivation for a classic mint is refused by the mainnet probe (`IncorrectProgramId`, per reserve). Round 33 A3's premise stands. |
| W2: GLM F2 (MEDIUM); GLM's limit-25 corollary | **Refuted by measurement** (`m34.mjs` part C): `getTransaction` (jsonParsed) of a no-CPI System transfer returns `meta.innerInstructions: []`, and `readParsedTransaction` parses it (0 inner groups); a CPI-bearing control parses with 1. The reader refuses only null/absent, by design (selftest). |
| W3: Opus-5 Finding 1 (MEDIUM impact: a "project-branded drainer") | The mechanism is true (D3), but it adds no capability: any program a signer invokes inherits that signer's privilege, so a drainer can deploy the same amount-free sweep itself. Vault sources still need Core's owner-only `ExecuteV1`. |
| W4: Opus-5 Finding 3 (coverage gate excludes `package.json`, lockfile, `tsconfig.json`) | **Premise false:** none of them exists in the repository; `node_modules` is a tracked symlink to `/opt/gary-club/node_modules`. The shared-dependency boundary is S2. |
| W5: Fugu INFO-1 (9.16 and 3c.M1 pass vacuously) | 3c.M1's fallbacks differ (`'MINT NOT FOUND'` vs `'GOV NOT FOUND'`, `tests/3prog.test.ts:1599-1601`), so a double rename fails it. 9.16's both-missing case also fails 9.15's literal `'3'`, so the run is red. |
| W6: Fugu ("two live end epochs never share a slot" is false) | The comment (`lib.rs:368-369`) is about distinct end epochs; two boosts with one end epoch share one count. True. |
| W7: deepseek C2 (a 165-byte Token-2022 account with a transfer fee reads zero) | Token-2022 cannot initialize an account for a classic mint (mainnet probe; F4.2); a transfer fee does not zero the base amount; any extension makes the account longer than 165, refused `ReserveHasExtensions`; undeclared non-ATA accounts are limit 44. |
| W8: deepseek H1, H2, M2, M4, L1, L2 | i64 seconds cannot overflow `now - 0` (`checked_sub` regardless); H2 refutes itself; `n <= 512` bounds `n * 40`; `retire` decrements `pending_this_epoch` when `request_epoch == dist_epoch` (`lib.rs:1833-1837`); SEAL checks `len >= 66` before indexing (`cbob-vaults/src/lib.rs:287`); Borsh `String` decoding validates UTF-8. |
| W9: lead, cut-off opus-5 F1 (the owner might remove, re-delegate, revoke or flip the seal) | **Refuted by measurement** on the pinned Core (`seal34.mjs`, 11/11): owner `RemovePluginV1` `0x9`, `ApprovePluginAuthorityV1` to self or Owner `0x1b`, `RevokePluginAuthorityV1` `0x1a`, owner or stranger `UpdatePluginV1(frozen:false)` `0x1a`, seal unchanged; control: the seal's authority thaws it. |

## Gate-5 obligations

SPEC ship gate 5 requires every rejected finding that could be measured to be a suite assertion. These are required before certification; they are not findings.

1. **W1(a) worst single-signature reveal, full shape** (carried from round 33): R33.G1 lacks the 64/200 name and URI and the four other owner plugins (D2).
2. **W1, a stranger cannot create or claim a token account at an ATA address:** unsigned System create/allocate refused, `InitializeAccount3` on a pre-funded address refused, the ATA create control writes the wallet. R31.W2b pins only pre-funded lamports, and the probe only the Token-2022 ATA refusal.
3. **W2, the RPC's no-CPI shape:** a live arm reading a no-CPI transaction through `readParsedTransaction` (`innerInstructions: []`, parsed). The selftest's `[]` fixture is not the RPC's answer. Off-chain gates.
4. **W9, the seal against its owner** (lead): owner remove `0x9`, approve `0x1b`, revoke `0x1a`, thaw `0x1a` on a real vault, with the authority control. No arm sends any of them.

## Measurements

| Measurement | Result | Evidence |
|---|---|---|
| Prompt re-render | 1,255,219 characters, equal to both manifests | `.cache/triage34p/render.out` |
| ProgramData PDA pre-funded (M1) | CLI and hand-built deploy refused (System `0x0`); control lands | `.cache/triage34p/m34.mjs`, `m34.log` part A |
| Helper called directly (D3) | lands; signer's tokens and lamports swept | same, part B |
| No-CPI `innerInstructions` (W2) | `[]`; reader parses | same, part C |
| Stranger at an ATA address (W1) | create/allocate need its signature; init refused; ATA control lands | same, part D |
| Seal against its owner (W9) | 11/11 as expected on pinned Core | `.cache/triage34p/seal34.mjs`, `seal34.log` |
| Detector and gate selftests at HEAD | 909/909, exit 0; 14/14 | `.cache/triage34p/selftest.log` |

## Remaining requirements

- Decide M1 (reserve the five ids by deploying now, or accept in writing) and extend step 9 to both addresses; decide L1 (program change or disclosure); correct D1, D3 and D4; repair or relabel R33.G1 (D2). A change to `tests/` or `scripts/` resets the freeze; repairs cannot retroactively clean round 34.
- Gate 5 is unmet: pin the four items above.
- Items 22, 38, 50, 52 and 53 remain open as SPEC states; `charter_opens_at` and `lock_deadline` remain unset in `launch/mainnet-init.json`. No deployment, initialization, lock, ceremony or cron installation follows from this audit.

**Result: QUORUM MET (7 substantive of 8 seats; six required). NOT CLEAN (0 CRITICAL, 0 HIGH, 1 MEDIUM, 1 LOW, 4 INFO; no value path confirmed). Counter 0/2.**
