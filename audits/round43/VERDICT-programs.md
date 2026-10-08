# Round 43, PROGRAMS pass: LAUNCH-CLEAN; QUORUM MET

**Independent triage verdict against audited HEAD `542bd3fe3cec2718c6894db001c4280f69a90247` (`542bd3f`). It differs from round 42's repair commit `79b4076` only in `audits/` (the round-42 validation record, `f350e1d`) and in `scripts/audit43.ts`'s context margin (`542bd3f`): `git diff --stat 79b4076 542bd3f` names `audits/FREEZE.md`, `audits/round42/VALIDATION.md` and `scripts/audit43.ts` and nothing else. The programs equal `RELEASE_COMMIT` `0b3ddb3` (`git diff --quiet 0b3ddb3 -- programs Cargo.toml Cargo.lock`) and are unchanged since round 39's tree (`git diff 21f36e1 542bd3f -- programs` is empty). `git status --porcelain` showed only `?? audits/round43/` throughout. Eight seats were requested and all eight returned `finish: stop` on the first run; there were no re-runs and `audits/round43/failed/` does not exist. I count six of the eight against a required six. Quorum is met, with no margin. Two findings are confirmed: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW, 1 INFO. Neither is in the five programs. Neither is a value path, a refused crack, or HIGH/MEDIUM. Both are in the fixable layer (holder guide, SPEC, crank, a test comment). Under SPEC ship gate 3's launch gate (RULING, Gary 2026-10-08) the pass is LAUNCH-CLEAN.**

**One condition attaches to that result, and it must be met before step 11.** V43-1 (below) rests on Core behaviour that no arm has executed: a thawed vault's owner using Core `ExecuteV1` to run Core `TransferV1` on a vault nested in its wallet. I confirm it from Core's source, from the pinned binary's embedded source references, and from the project's own long-standing premise. I grade it LOW and outside (a)-(d) for one reason: the program behaviour is the one round 35's rescue review took as given when Gary ruled on the rescue's destination. If Gary reads that ruling as "a vault sent into another vault must never reach the host's owner", the same facts become a MEDIUM value-credit finding (classes b and d) that only a SEAL change can close, and a SEAL change is possible only before step 11. Gate-5 item 1 is therefore REQUIRED and blocking for step 11, together with that ruling.

Under the older clean-round rule this pass is NOT CLEAN. V43-1 is about holder money and V43-2 is in a test file, so neither qualifies for the documentation exception. The clean-round counter remains **0/2**. The launch gate does not use that counter.

**24 deduplicated claim groups: 2 confirmed (1 LOW, 1 INFO), 0 under the documentation exception, 9 already stated, 0 uncertain, 13 disproved.** Round 42's two repairs hold at every site: V42-1 at `web/deploy/ceremony-local.mjs:33` and `:43-55`, V42-2 at `web/src/lib/ceremony-reads.mjs:102-119`. Its gate-5 closures (C12 measured and turned into limit 59, C8, C7, C13, C10, C14, C26) are present in the tree.

## Auditor dispositions

**Manifests.** `MANIFEST-programs.json` and `MANIFEST-programs.first-run.json` are byte-identical (`cmp`).
- Each records head `542bd3f…`, `dirty: []`, `promptChars` 1,718,397, requested 8, auditors 8, required 6.
- Every seat ends `finish: stop` with `disqualified: null`.
- There are no `MANIFEST-programs.rerun-*.json` files and no `failed/` directory, so there is no re-run to verify.

I read all eight reports in full and did not take the runner's count on trust. The programs bundle (`scripts/audit43.ts:68-150`) carries:
- the five programs and their manifests;
- the suite, the simulation and the runners;
- SPEC, DESIGN-v6 and the holder guide;
- all of `web/src`, `web/meta` and `web/deploy`, plus `web/test/e2e-localnet.mjs`;
- round 42's `VERDICT-programs.md` and `VALIDATION.md`.

`bank/alarm.mjs`, `bank/selftest.mjs` and the other `web/test/*` files are in the off-chain pass. A seat that says it cannot see them is correct.

| Auditor | Disposition |
|---|---|
| anthropic/claude-fable-5.1 | **Counted.** 32,312 characters. The widest walk. It re-derives both round-42 repairs from the current code and the C12/limit-59 page fix (`checkNewAddress` at all three call sites). It recomputes the full MintConfig map, giving `MINT_CONFIG_SPACE` 1,005 + 256 = 1,261, which is correct. It also recomputes VaultRecord, BurnConfig and SEAL, the pool invariant, the boost ring and the helper's pair table. **F1 is confirmed at LOW (V43-1). F4 is confirmed at INFO (V43-2).** F2 is already stated (C2). F3 is disproved as a defect (C4). F5 is already stated (C3). F6 is already stated (C6). One peripheral error: its quotation of limit 58 ("a sealed host cannot execute, so even a deliberate nest is stuck") is not in SPEC. |
| anthropic/claude-sonnet-5.5 | **Counted.** 10,910 characters, the thinnest counted seat. It engages this tree: the V42-2 repair's `CREATOR_FETCH_MAX` (25, `ceremony-reads.mjs:71`), limit 59's funding argument, `reveal_level`'s `WrongAsset`, the `dueBoostRecords` slice (125, 70; weight at +61, end at +62), and the offsets 141/454/442/257/266/274/518/526/631/639/647/711/712, all correct. F1 is disproved at the pinned Core (C3). F3 and F4 are already stated (C18, C19). F5 is already stated, with one wrong item (C20). Its limit 47 and limit 44 claims are disproved (C17, C22). One peripheral error: it lists a pre-funded charter claim as never exercised, but R42.C12b measures it. |
| meituan/longcat-2.0 | **Not counted.** 20,066 characters. It is mostly summary, and its verification of round 42 rests on contents that do not exist. It says round 42's `e1.log` "confirms … stranger's failed transfer first → `launch` (was `other`)", but that log is round 42's red state, where the result was `other`. It says `.cache/r42-suite.log` "shows the proxy test … passing at 107/107, including the V42-1 arms", but that log has no per-file line, and the proxy file now holds 109 arms. It quotes `plan-get.mjs:118` as `?.body?.body.attributeList`; the real code is `:121-122`. Its sweep-helper table cites `:22`, `:23`, `:25`, `:26`, `:33`, `:37` and `:47`, but those checks are at `programs/cbob-vault-sweep/src/lib.rs:45-60`. It raises no finding. Round 42 excluded MiniMax for invented contents on the same basis. |
| meta/muse-spark-1.3 | **Counted.** 22,153 characters. It engages this tree: the repair code of both V42 items; R42.C12a–d, C8 and C13 (182,355 CU); `RELEASE_COMMIT` `0b3ddb3` (`web/src/config.js:39`); and "`staticFile` is the only `decodeURIComponent` in `web/deploy/`" (true, `:33`). It gives a 50-entry MintConfig offset list and the VaultRecord list, all correct. Its INFO-1 is disproved as a misstatement (C12). |
| qwen/qwen3.8-2.4t-a95b | **Counted.** 34,420 characters. It quotes the current listener's catch verbatim (`ceremony-local.mjs:53`), `collectionCreator`'s two failure skips and its 25-transaction bound, and `keys[0]` as the creator test (`:115`). It recomputes VaultRecord as 211 + 10 = 221 and MintConfig as 1,005 + 256, both correct. OBS-1 is disproved as a defect (C13). OBS-2 is already stated (C14). OBS-3 is not a defect (C15). OBS-4 is already stated (C16). |
| qwen/qwen3.8-max-0902 | **Not counted.** 22,393 characters. It describes the older tree as the current one. It is titled "HEAD `4a67d00`" and "re-derives" V42-1 as live: "`staticFile` calls `decodeURIComponent` with no guard (`ceremony-local.mjs:30`) … This is real". The bundled code at `:33` is guarded. It does the same for V42-2 at the old line numbers. Its INFO-3 says the C12 pre-funded create "is assumed, not measured", although the bundled SPEC carries limit 59 and the bundled suite carries R42.C12a–d (909/909 in `.cache/r42-suite.log`). Its offset list is correct but is the round-42 list. Its claims are still triaged (C23). |
| xiaomi/mimo-v2.6-pro | **Counted.** 13,488 characters. It quotes `MINT_CONFIG_SPACE`'s last line (`lib.rs:2551`) and BURN's `VaultStillHoldsAVault` check (`burn/src/lib.rs:351-354`) verbatim. It recomputes 26 cross-program offsets, all correct, and describes both V42 repairs accurately. Its LOW is disproved by arithmetic and by measurement (C7). Its coverage gap is disproved at the pinned Core (C3). A disproved finding does not disqualify a seat: round 42 counted MiniMax with a disproved CRITICAL. |
| z-ai/glm-5.3 | **Counted.** 34,767 characters. It quotes `plan-get.mjs`'s new `attrPlugin && !attrPlugin.body` guard (`:121`), the ceremony's `checkNewAddress(…, { publicKey }, () => null)` (`ceremony.mjs:206`) and the press's re-plan inputs (`noPrior`, `known`, `consented`). It recomputes the full MintConfig, VaultRecord, BurnConfig and SEAL layouts, all correct. LOW-1 is disproved by an existing arm (C8). LOW-2 is disproved by the code (C9). INFO-1 is already stated (C10). INFO-2 is disproved as a misstatement (C11). |

**Quorum: 6 counted of 8 seats, 6 required. MET, with no margin.** Each of the six engages the current tree with specific claims that I checked, and their peripheral errors are of the kind round 42 accepted. If either excluded seat were counted instead, quorum would still hold. If any one of the six were excluded, it would not.

## Method and evidence

- **Records read:**
  - all eight reports in full, and both manifests;
  - the brief `.cache/TRIAGE-BRIEF-r43.md`;
  - round 42's `VERDICT-programs.md`, `VERDICT-offchain.md` and `VALIDATION.md`;
  - round 41's `VERDICT-programs.md` and `VERDICT-offchain.md`;
  - round 35's `REVIEW-rescue.md`, and round 30's and 36's verdicts where cited;
  - SPEC's ship gate (`SPEC.md:2468-2537`) and the limits cited below;
  - `scripts/audit43.ts`'s target list, and the source at `542bd3f`.
- **Allowed runs at HEAD** (logs outside the repository, in `/tmp/claude-1000/triage43p/`):
  - `node web/test/run-all.mjs`: **682/682** in 10 files, each at its floor (`plan` 169, `get` 57, `ceremony` 128, `proxy` 109). Exit 0.
  - `node bank/selftest.mjs`: **945/945**. Exit 0. Lines 414-415 are L13c, which evaluates `MINT_CONFIG_SPACE` from the Rust.
  - `node scripts/check-launch-params.mjs --selftest`: **49/49**. Exit 0.
  - `node bank/redemption-poster.mjs --selftest`: **24/24**. Exit 0.
  - `node bank/accrual.mjs --selftest`: **39/39**. Exit 0.
  - `git status --porcelain` afterwards: only `?? audits/round43/`.
- **The canonical logs of this tree, read** (programs and `web/` are unchanged since `79b4076`):
  - `.cache/r42-suite.log`: EXIT 0. On-chain 909/909 at floor 909, detectors 945/945, web 682/682, allocation 39/39, mainnet walk 33/33, expiry 4/4, swap fork 16/16.
  - `.cache/r42-web-e2e.log`: e2e 132/132 at floor 132, RC=0.
- **Read-only checks of third-party code:**
  - Metaplex Core at `e72d63e`, the commit SPEC limit 40 cites. A checkout from an earlier triage exists at `.cache/triage26p-core` (HEAD `e72d63e4…`). I read it; nothing was changed. Files: `processor/execute.rs`, `processor/compress.rs`, `processor/transfer.rs`, `utils/mod.rs`, and the permanent plugins.
  - `strings` on the pinned `.cache/core-mainnet.so`. It embeds source-path:line references that match `e72d63e` exactly:
    - `permanent_freeze_execute.rs:49/64/78`;
    - `asset.rs:155/177/199/227/248/265/279`;
    - `lifecycle.rs:257/292/358/361/733/739/741/806/822`.

    It also contains "Error: Compression currently not available" and "Error: Decompression currently not available".
- **Not run:** no validator, `scripts/run-tests.sh`, `web/test/e2e-localnet.sh`, `bank/alarm.mjs`, crank, revenue job, or any live, money or notification job. No mutation test was needed. No tracked file was touched. The only file this triage adds to the tree is this verdict.

## Distinct claims

Class column: (a) a finding in the five programs; (b) a value path, or a wrong credit; (c) a stopped or wrongly refused crack; (d) HIGH or MEDIUM anywhere; "none" means outside all four.

| ID | Reporters | Claimed | Verdict | Class | Evidence (file:line) |
|---|---|---|---|---|---|
| C1 | Fable F1 (a host vault's owner takes a vault nested in its wallet during its own redemption, via Core `ExecuteV1` → Core `TransferV1`) | HIGH (conditional) | **CONFIRMED, LOW (V43-1)**, from source; not executed | none, on the record (see V43-1) | SEAL `open_for_redemption` (`programs/cbob-vaults/src/lib.rs:190-249`) walks only for the paired burn and does not restrict instructions in between. BURN refuses only a DECLARED `AssetV1` (`burn/src/lib.rs:350-354`). Core `e72d63e`'s `process_execute` (`execute.rs:134-161`) has no program-id restriction, and the runtime permits direct self-recursion. `PermanentFreezeExecute` validates only execute (`permanent_freeze_execute.rs:43-52`), so a sealed vault is transferable by its owner (9.1, R35.N3a). The project's own premise: `bank/detectors.mjs:969-970`, and round 35 `REVIEW-rescue.md:23-25`. |
| C2 | Fable F2; Sonnet Q3 (item 19 holds only while the FIFO advances) | INFO (process) | ALREADY-STATED | none | Limit 40 (`SPEC.md` "halts the level queue"); round 33 W1; round 42 C6 (recommended gate-5 arm). Fable asks that the arm be made required. That is a ruling, carried below. |
| C3 | Sonnet F1 (owner `CompressV1` halts the FIFO); MiMo coverage gap (BURN does not refuse a declared `HashedAssetV1`); Fable F5 (a Core upgrade enabling compression) | HIGH-if / (gap) / INFO | DISPROVED at the pinned Core; the upgrade case is ALREADY-STATED | none | At `e72d63e`, `compress` computes its proof and then returns `NotAvailable` unconditionally (`compress.rs:79-81`). The pinned binary carries the same message. No `HashedAssetV1` can exist today, and a collection or group is not ownable by a vault's wallet, so MiMo's branch has nothing to admit. A Core change is limit 40, which names the queue halt. |
| C4 | Fable F3 (if nobody has requested activation by the month mark, the first requester joins alone and can take the backlog) | INFO (doc) | DISPROVED as a defect or misstatement; mechanism accurate | none | `mint/src/lib.rs:1603-1612` (tick only with `pending_this_epoch > 0`), `:2009-2014`. The first cohort is whoever requested in epoch 0, by design (`SPEC.md:660-667`). The guide's "Everything the Bank has earned before the first payout is shared by the vaults in it" (`HOLDER-GUIDE.md:29-30`) stays true. Optional sentence, and a recommended arm. |
| C5 | Fable F4 (`e2e-localnet.mjs`'s header contradicts its assertions) | INFO | **CONFIRMED, INFO (V43-2)** | none | Header `web/test/e2e-localnet.mjs:15-17` ("must refuse the host … returns it to the host's owner"). Assertions `:231` ("does NOT refuse") and `:239` ("bank_treasury, never the host's owner"). Stale since `0b3ddb3`, and recorded in no earlier verdict (grep). |
| C6 | Fable F6 (limit 26: A's or B's leader can choose who is C's leader by skipping a whole group) | INFO | ALREADY-STATED | none | Round 36 programs A4, and round 41 programs C12: a blind re-roll. C's leadership is already stated as choosable (`SPEC.md` limit 26). |
| C7 | MiMo LOW (`MINT_CONFIG_SPACE` is 97 bytes short) | LOW | DISPROVED (arithmetic and measurement) | none | `mint/src/lib.rs:2546-2551` sums to 193 + 261 + 64 + 64 + 97 + 582 = **1,261**. Line 2550 is the 97-byte stage-3c block MiMo says is missing. `bank/selftest.mjs` L13c evaluates the Rust: 1,005 less padding, ok (`det.log:414-415`). |
| C8 | GLM LOW-1 (at the press, a promised stray whose receiving account is gone is dropped silently) | LOW | DISPROVED (existing arm) | none | Its premise is false. The `left:` box was never in the first plan, because `canReceive` is always true there (`plan-redeem.mjs:184`). At the press, `aboutKnown` keeps that box un-consented (`:264-267`), and `prepareOpening` stops on `ack` (`:335-336`). Pinned by `plan.test.mjs:499-504` (A2(b)), which passes, 169/169. |
| C9 | GLM LOW-2 (after "taken", ceremony step 0 rebuilds with the same funded key forever) | LOW | DISPROVED (code) | none | The step's `build` generates a fresh `Keypair` on every call (`plan-ceremony.mjs:203`). Each render calls it (`ceremony.mjs:197`), and the "taken" branch re-renders (`:210`; comment `:201-203`). A funded address is never adopted, because adoption requires Core ownership (SPEC limit 59). Recommended arm below. |
| C10 | GLM INFO-1 (an owner-managed freeze delegate on a PoB costs its own claim) | INFO | ALREADY-STATED | none | `SPEC.md:1700-1703`: "owners can also add owner-managed plugins, including a freeze delegate that can block the burn while frozen". |
| C11 | GLM INFO-2 ("the draw job checks every minute" understates FIFO waits) | INFO (doc) | DISPROVED as a misstatement | none | `HOLDER-GUIDE.md:21` already says "busy queues can take longer". The stall cases are paged and stated in limit 25. |
| C12 | Muse INFO-1 (limit 59's "only a program change" omits a client drain); Fable R0 aside (the holder could recover the griefer's lamports) | INFO (doc) | DISPROVED as a misstatement | none | `SPEC.md:1777-1779` describes what MINT could do. A transaction built before the grief cannot drain an amount it does not know, and a retry with a fresh key costs the same as a drain. Fable's aside is a courtesy. Optional wording. |
| C13 | Qwen-2.4T OBS-1 (`collectionCreator` treats the fee payer as the creator) | INFO | DISPROVED as a defect | none | `ceremony-reads.mjs:115` (`keys[0]`). Step 0 is always paid by the launch wallet (`buildTx(…, wallet.publicKey)`, `ceremony.mjs:213`). Not reachable. Optional hardening. |
| C14 | Qwen-2.4T OBS-2 (SEAL validates reserve mints by owner only) | INFO | ALREADY-STATED | none | Round 24 A6; item 38; the checker pins the three ruled mints. |
| C15 | Qwen-2.4T OBS-3 (losing the metadata generator's `--state` can regress one vault's JSON) | INFO | NOT A DEFECT (self-described cosmetic) | none | Informational JSON only. The vault page reads the chain. |
| C16 | Qwen-2.4T OBS-4; Fable Q4; Sonnet Q4 (`web/` outside gate 2's frozen paths) | (process) | ALREADY-STATED | none | Round 36 A8, round 41 C6, round 42 C5. The pages' tests are in the canonical run with exact floors (round 42 C26). The freeze path list is Gary's ruling and is carried. |
| C17 | Sonnet Q1 (limit 47's "no funds are lost" is false: royalty SOL is stranded by a permanent sweep stop, and the half-of-all bar only rises) | (doc) | DISPROVED as a misstatement | none | `SPEC.md:1735-1752`. Nothing leaves the revenue address, and the stop's permanence is stated. The SOL becomes sweepable again if the guardian is replaced. The "half of ALL live vaults" bar is stated, and unvotable vaults are part of it by construction. Optional wording. |
| C18 | Sonnet F3 (`build-mainnet.sh` has no `--locked`; `Cargo.lock` never bundled) | LOW | ALREADY-STATED | none | Round 30 off-chain C23 (optional). `Cargo.lock` is tracked and bound to `RELEASE_COMMIT` (`run-tests.sh:280`). SPEC excludes generated lockfiles from coverage by ruling (`SPEC.md:2481`). |
| C19 | Sonnet F4 (the shipped bytes never run the suite) | INFO | ALREADY-STATED | none | `SPEC.md:1085-1095`: the one tested/shipped difference, proven behaviourally by `build-mainnet.sh`. |
| C20 | Sonnet F5; Fable R1s(b), R8 (unexercised arms: native wSOL source; a destination that is another vault's signer or a non-ATA; the 3,600 s window; a deposit between sweep and burn; the free path with `w == 0` and nothing pending) | INFO | ALREADY-STATED (coverage) | none | Round 42 C9. The 3,600 s window is stated as the same arithmetic. Sonnet's "pre-funded claim never exercised" is wrong: R42.C12b. Carried as recommendations. |
| C21 | Sonnet R0 (25 pre-create successful transactions push V42-2's reader to `unverifiable`) | (not filed) | NOT A DEFECT (agreed with the seat) | none | `ceremony-reads.mjs:102-106` walks oldest-first, so only transactions landing BEFORE the create count, which needs a front-run. A pre-create transfer would itself block the create (limit 59). The result is round 39 B4's warning, with step 0 still offered. |
| C22 | Sonnet Q2 (limit 44's frozen-stray clause is not really a limit) | (doc) | DISPROVED | none | `SPEC.md:1650-1652` states chain behaviour for any client. The page avoiding it does not remove it. |
| C23 | Qwen-max INFO-1/2/3/4 (not counted; V42-1/2 described as live, C12 unmeasured, nginx dependency unnamed) | INFO | DISPROVED (all are repaired or done in this tree) | none | `ceremony-local.mjs:33`, `:43-55`; `ceremony-reads.mjs:102-119`; R42.C12a–d and limit 59 (`SPEC.md:1765`); the dependency is named in `web/deploy/nginx-rpc.conf` (round 42 C14). |
| C24 | LongCat (not counted) | none | no claim | none | Raises no finding. |

## Confirmed findings

| ID | Severity | Independent disposition and minimal repair |
|---|---|---|
| **V43-1**: Fable F1 | **LOW** (claimed HIGH, conditional) | **A vault sent into another vault's deposit address can be kept by the host's owner, who opens their own vault before anyone runs the rescue. SPEC and the holder guide present the rescue as the outcome and never mention this race.**<br><br>**The construct.** `open_for_redemption` thaws the host and requires only a later top-level `burn_vault` for the same asset and owner. Nothing in between is restricted (`programs/cbob-vaults/src/lib.rs:225-248`). The owner may run any Core `ExecuteV1` signed by the host's wallet; the redeem page itself moves undeclared strays this way (`plan-redeem.mjs:200-201`). Core `e72d63e`'s `process_execute` invokes whatever program the caller names (`execute.rs:134-161`), and Solana permits a program to call itself. A nested vault V is owned by the host's wallet (9.2). Its seal rejects only Execute (`permanent_freeze_execute.rs:43-52`), so its owner can transfer it (9.1, R35.N3a). The royalty rule set is `None` (`mint/src/lib.rs:733`). So `[open(H), ExecuteV1(H){Core TransferV1(V → H's owner)}, ExecuteV1(H){sweep}, burn(H)]` with V undeclared satisfies BURN (`burn/src/lib.rs:350-354` refuses only a DECLARED `AssetV1`). V leaves the transaction owned by H's owner, and `rescue_nested` would then refuse it `NotNested`.<br><br>**Why I confirm it without executing it.** The pinned binary embeds `e72d63e`'s source line references exactly (Method), so the source read is of that binary's source. And this reach is the project's own premise:<br>• `bank/detectors.mjs:969-970`: "a `nested_vault` inside a LIVE host is recoverable — its owner can Execute the inner vault straight back out".<br>• Round 35 `REVIEW-rescue.md:23-25`: "the only way they could reach the nested vault was to redeem and destroy their own vault (open, Execute, burn)".<br>No arm executes it (round 30 programs A1 recorded it as unmeasured).<br><br>**What it contradicts.**<br>• `HOLDER-GUIDE.md:184-189`: "anyone can run the rescue, which moves it to the Bank's multisig, and the multisig returns it to whoever sent it".<br>• `SPEC.md:173-176`'s table ("the inner vault is extracted to the CBOBTC Squads by `rescue_nested`").<br>• Limit 58 (`SPEC.md:1793-1822`).<br>Each states the rescue as what happens. An attentive host owner wins any race: the rescue is permissionless but nothing sends it automatically (`grep rescue bank/crank.mjs` finds nothing), while the host owner sees the arrival at once.<br><br>**Severity and class.** LOW, and outside (a)-(d), on the record:<br>• (a) No program defect against the ruled design. During its own crack an owner controls everything in its vault's wallet; the same rule hands a stranger's misdirected cbBTC to the vault's owner. Round 35's review compared the rescue against exactly this reach. It asked Gary not to make the reach free and immediate for anyone, and his ruling governs `rescue_nested`'s destination only.<br>• (b) The value moves to the owner of the wallet it sits in, by that owner's own crack, under the rule every crack follows.<br>• (c) Nobody's crack is stopped.<br>• (d) The loss requires the sender's own act, which the guide forbids in the same paragraph ("Never send a vault NFT to any deposit address", `:189-190`). The sender, or anyone, can run the rescue the moment it is noticed, and the alarm pages `nested_vault` at CRITICAL (`detectors.mjs:1318`). The defect is the missing disclosure.<br><br>**If Gary's ruling is read the other way** ("never to a live host's OWNER", `SPEC.md:1805-1808`, as a rule about the vault rather than about the rescue), it is MEDIUM in classes (b) and (d). Only SEAL could close it, by refusing a top-level Core `ExecuteV1` whose inner program is Core between open and burn. That is a program change, possible only before step 11.<br><br>**Repair (fixable layer).**<br>• The guide and SPEC (the table, impossibility 3, limit 58) say that the host's owner can keep such a vault by opening their own vault before the rescue runs, so a sender should run the rescue from the vault's page at once.<br>• The crank sends `rescue_nested` itself every pass for every nested CBOB vault `detectNestedVaults` finds. It is permissionless and its destination is fixed.<br>• Gate-5 item 1 below. |
| **V43-2**: Fable F4 | **INFO** | **The end-to-end test's header describes the rescue rule that round 39 replaced.** `web/test/e2e-localnet.mjs:15-17` says the redeem plan "must refuse the host and point at the rescue; the rescue returns it to the host's owner". The arms say the opposite: `:231` ("the redeem plan for the HOST does NOT refuse") and `:239` ("the destination is bank_treasury, never the host's owner"). A reader auditing the e2e from its summary is told the rejected round-35 first build. Nothing executes the comment, and the arms pin the right behaviour. **INFO.** **Repair:** make the header say the plan does not refuse the host, its optional set-up step rescues the inner vault to `bank_treasury`, and anything left inside is rescued after the opening (V39-2, item 58). |

### The documentation exception (SPEC gate 3, ruling of 2026-10-07)

- **V43-1** misstates nothing about the programs, but it does concern a holder's money (a misdirected vault), and its repair adds crank code. **Not eligible.**
- **V43-2** is a comment inside a test file, so it "changes … a test". Applied conservatively, it is **not eligible.**
- Every other documentation-only candidate (C4, C11, C12, C17, C22) is disproved or already stated.

**Confirmed under the documentation exception: none.**

## Rounds 41 and 42 re-check, per confirmed finding

Each finding below is in the four VERDICT files. For each I re-read the verdict's mechanism against the code and classified it again.

| Finding | Severity | (a) programs | (b) value | (c) crack | (d) H/M | Outside (a)-(d)? |
|---|---|---|---|---|---|---|
| R41 programs **V41-1**: dusting a config PDA made the ceremony pages refuse | LOW | No. Page code (`web/src/lib/reads.mjs`, `ceremony-reads.mjs`). On chain, `initialize` lands over dust (R31.W2a). | No. A page refusal moves nothing. | No. It is the ceremony, not a redemption. | No | **Yes** |
| R41 off-chain **C01**: the poster drafted one post per transaction, not per redemption | LOW | No (`bank/redemption-poster.mjs`) | No. Drafts only, no sender. It is public reporting, not custody. | No | No | **Yes** |
| R41 off-chain **C02**: the oracle-age test pinned only through its own constant | LOW | No (`bank/selftest.mjs`) | No. The code was correct (`swap.mjs` 180 s), and the on-chain floor still binds. The defect was a test that could not fail. | No | No | **Yes** |
| R41 off-chain **C03**: SPEC's crank fee-budget sentence (documentation exception) | INFO | No. SPEC text about the operator's fee wallet. | No | No | No | **Yes** |
| R42 programs **V42-1**: a malformed path crashed the local ceremony server | INFO | No (`web/deploy/ceremony-local.mjs`) | No. Nothing is signed by the crash. | No | No | **Yes** |
| R42 programs **V42-2**: an earlier transaction hid the real collection create | INFO | No (`web/src/lib/ceremony-reads.mjs`) | No. The worst case is a second collection before anything mints. | No | No | **Yes** |
| R42 off-chain **C01**: after a shrunk index pass, omitted vaults lost their alarm baseline | LOW | No (`bank/alarm.mjs`) | No. A detection miss, not a value path. Nothing moved because of it. | No | No | **Yes** |

**All seven are outside (a)-(d). Rounds 41 and 42 stand as launch-clean on their confirmed findings.**

One item outside the VERDICT files, recorded so it is not lost. Round 42's VALIDATION "reopened" C12 as accepted limit 59: a slot leader or RPC upstream can fund a new vault's or the collection's address so that one attempt fails.
- **(a):** the refusal is System `create_account` inside Core's create. Our programs fail the whole instruction and keep nothing. Only a workaround (draining first) would live in MINT.
- **(b):** nothing moves but the fee.
- **(c):** it touches mint and charter claim, never a crack.
- **(d):** a bounded grief that a fresh key defeats; I would grade it LOW.

It is outside (a)-(d) on my reading. SPEC 59 records no ruling by Gary accepting it, and limit 59's own statement that it can be repeated through the 7-day charter window is worth that ruling.

## Gate-5 obligations

SPEC ship gate 5 requires two things before certification: every confirmed defect's repair becomes a suite assertion, and so does every rejected finding that could be measured. These are requirements, not findings.

1. **V43-1, REQUIRED, and blocking for step 11** (it is the only measurement that decides whether a program change is needed):
   - A suite arm in Fable's shape on the pinned Core. Nest INNER in OUTER as 9.1 does. Then send one transaction `[ixOpen(OUTER), coreExecute(OUTER){Core TransferV1(INNER → OUTER's owner)}, coreExecute(OUTER){sweep}, ixBurn(OUTER, reserves only)]`.
   - Record the outcome either way. If it lands: INNER's owner is OUTER's owner, OUTER is a tombstone, and `rescue_nested(INNER, OUTER)` refuses `NotNested`. If Core refuses: pin the reason with `because()` and withdraw V43-1.
   - Control: the same transaction without the inner transfer lands, and INNER stays nested.
   - A detector or crank arm that `rescue_nested` is sent for every nested vault found.
   - Then Gary's ruling on the reading of review 35 M1 (see V43-1).
2. **V43-2:** the comment repair. The behaviour is already pinned by the e2e arms at `:231`, `:239` and `:418-420`. No new arm is needed.
3. **Measurable rejections:**
   - **C3:** an arm that Core `CompressV1` on a live vault is refused, pinned to "Compression currently not available". The day Core enables compression this arm turns red, which turns limit 40's fourth consequence into a page.
   - **C9:** a `ceremony` arm showing that a re-render after `taken` builds step 0 with a different collection key.
   - **C4:** a suite arm for the dormant month. The first `activate` comes after the period with nothing pending, then the tick, then the join. `active_count == 1`, and a burn distribution credits everything to it. Recommended, with the optional sentence.
   - **C7, C8:** settled by existing arms (`bank/selftest.mjs` L13c; `plan.test.mjs` A2(b)). No new arm is needed.
4. **Carried:**
   - Round 42 C6 / C2 here: the combined heap shape at the FIFO head. Two seats now ask that it be required before step 11, because its only remedy is a program change. I recommend Gary rule on that.
   - Round 42 C9 / C20 here: a native wSOL source, and a destination that is another vault's signer.
   - The A9 reason pins (seven arms) remain recommended.
   - `web/` gating (C16, round 36 A8).
   - esbuild in-tree (round 36 A10) remains optional.

## Measurements

| Measurement | Result | Evidence |
|---|---|---|
| Allowed selftests at HEAD | web 682/682 (10 files at floor); detectors 945/945; launch 49/49; poster 24/24; allocation 39/39; all exit 0 | `/tmp/claude-1000/triage43p/{web,det,launch,poster,accrual}.log` |
| Canonical run of this tree | 909/909 (floor 909), detectors 945, web 682, allocation 39, mainnet walk 33, expiry 4, fork 16, EXIT 0; e2e 132/132 RC=0 | `.cache/r42-suite.log`, `.cache/r42-web-e2e.log` |
| Program source against the release | equal to `0b3ddb3`; unchanged since `21f36e1` | `git diff --quiet` (session) |
| `MINT_CONFIG_SPACE` | 1,261 by hand; L13c evaluates 1,005 less padding | `mint/src/lib.rs:2546-2551`; `det.log:414-415` |
| Core `CompressV1` at `e72d63e` and in the pinned binary | `NotAvailable`, unconditionally; the binary carries the same message | `compress.rs:79-81`; `strings .cache/core-mainnet.so` |
| Pinned binary against `e72d63e` | the embedded source-path:line references match (`permanent_freeze_execute.rs`, `asset.rs`, `lifecycle.rs`) | `strings`, compared against the checkout |
| Core `ExecuteV1` inner program | unrestricted in source; no arm executes Core → Core | `execute.rs:134-161`; `grep` over `tests/`, `sim/` |

## Measurement limits

- **No validator was run.** V43-1 rests on reading:
  - Core's source, which is strongly but not cryptographically tied to the pinned binary (matching line references, not a reproducible build);
  - the runtime's self-recursion rule;
  - the project's own recorded premise.

  It is not executed. That is why gate-5 item 1 is required.
- **The class of V43-1 depends on a reading of round 35's M1 ruling** that only Gary can confirm.
- **The quorum has no margin.** Excluding LongCat and Qwen-max follows round 42's rule on invented and older-tree contents. Counting either would only widen the margin.
- **C4** was read in source and not executed.
- **Unmeasured here, as rounds 36-42 also stated:** a real Phantom, a real Squads v4 return, the live proxy behind Cloudflare, and whether a holder understands any page sentence.

## Remaining requirements

- **Before step 11:**
  - gate-5 item 1 (V43-1's arm), and Gary's ruling on its reading;
  - his ruling on making the combined heap-shape arm required.
- **Before the next round, or before launch, under gate 5:**
  - V43-1's guide, SPEC and crank repair;
  - V43-2's comment.
- **Unchanged:**
  - Items 22, 38, 50, 52 and 53 remain OPEN AND BLOCKING.
  - `charter_opens_at`, `lock_deadline` and `vault_collection` remain OPEN in `launch/mainnet-init.json`.
  - No deployment, initialization, lock, ceremony, cron installation or publication follows from this audit.

**Result: QUORUM MET (6 counted of 8; six required; no re-runs). LAUNCH-CLEAN under SPEC gate 3's launch gate: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW (V43-1, guide/SPEC/crank), 1 INFO (V43-2, a test comment); nothing in the five programs; no value path; no refused crack. Conditional on gate-5 item 1 and Gary's ruling before step 11. NOT CLEAN under the clean-round rule; counter 0/2.**

---

**Reply (under 300 words).** Round 43 programs pass: **LAUNCH-CLEAN; QUORUM MET.**

**Seats counted (6 of 8; 6 needed):** Fable 5.1, Sonnet 5.5, Muse Spark 1.3, Qwen 2.4T, MiMo, and GLM 5.3. Not counted:
- LongCat: summary, with invented log contents and line numbers.
- Qwen max-0902: it audited the older `4a67d00` tree as if it were current.

There were no re-runs, and the manifests are identical.

**Confirmed findings:**
- **V43-1, LOW, outside (a)-(d).** Someone can send a vault into another vault's deposit address by mistake. The owner of the receiving vault can then keep it by opening their own vault before anyone runs the rescue: they use Core Execute to transfer the nested vault out. The holder guide and SPEC present the rescue as the outcome and never mention this race. This is confirmed from Core's source, which matches the pinned binary's line references, and from the project's own premise (round 35's rescue review). It has not been executed. Repair: guide and SPEC wording, and the crank auto-rescuing nested vaults.
- **V43-2, INFO, outside (a)-(d).** The e2e test's header describes the pre-round-39 rescue rule.

**Disproved:** MiMo's config-space LOW, GLM's two LOWs, Sonnet's CompressV1 halt, and the rest. All programs tests rerun green (682, 945, 49, 24, 39).

**Rounds 41-42 re-check:** all seven confirmed findings are outside (a)-(d). The reopened C12 (limit 59) is also outside, but it has no recorded ruling.

**Condition:** before step 11, V43-1 must be measured on a validator (required gate-5 arm), and Gary must rule. If he reads the round-35 ruling as "a misdirected vault must never reach the host's owner", V43-1 becomes a MEDIUM value-credit finding, and only a SEAL change before the lock can close it.
