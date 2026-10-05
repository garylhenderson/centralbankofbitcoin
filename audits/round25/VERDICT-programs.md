# Round 25, PROGRAMS pass: NOT CLEAN (no CRITICAL, no HIGH; no program defect confirmed)

Audited tree `2b67fb1` (`MANIFEST-programs.json`: head `2b67fb1b…`, `dirty: []`). The working tree differs from HEAD only by the untracked `audits/round25/`. Every citation below is to `2b67fb1`.

**Counted auditors (7 of 8; quorum 6 met):**
- claude-opus-4.8, meta muse-spark-1.3, glm-5.3, claude-sonnet-5.5, qwen3.8-2.4t-a95b, qwen3.8-max-0902, sakana fugu-ultra-v2.
- **Not counted: grok-4.3.** The report is 5,815 chars (2,281 output tokens against 259k in). Its R0 section re-files round 24's own findings as open: C1, C2, C3 and C5 "no such arm", plus the three holder-guide sentences "nudge slightly", "one attempt… trying again works" and "Not Gary Club". All of these are repaired at `2b67fb1`: BO.30-34c, E.7/E.7a and S7b.0-4 exist and ran green (`.cache/suite.log:874-891`, `c25-sim.log`), and HOLDER-GUIDE:27-30, :37-40 and :159-165 carry the new text. It also says the pairing "remains intact at `6e521db`". Every other section is a one-line restatement. It did not audit this tree, so it does not count. Without it the pass still has 7, so the quorum holds.

**Method.**
- **Deduplication.** I deduplicated the eight reports into 39 distinct claims and checked each against `2b67fb1`.
- **Mainnet measurements** (read-only `simulateTransaction` / `getAccountInfo` against `api.mainnet-beta.solana.com`, scratch `triage25p/`):
  - **Token-2022 ATA test.** Creating a Token-2022 ATA for each of the three classic reserve mints, owned by an off-curve PDA, fails `IncorrectProgramId` all three times. The classic ATA control succeeds all three times.
  - **Mint authorities.** The freeze and mint authorities of the four mints were read directly from the mint bytes.
- **Sources read in scratch clones:**
  - Token-2022 `e27c3ad`: `processor.rs:1512-1524` (GetAccountDataSize) and `:178-179` (InitializeAccount, `check_program_account(mint_info.owner)`).
  - The ATA program `6ead6cb`: `processor.rs:117-150`.
  - Metaplex Core at `e72d63e`, the same commit round 24 read: `processor/execute.rs`, `state/asset.rs:328-337`, `state/collection.rs:294-301`, `plugins/external/agent_identity.rs:127-138` and `plugins/lifecycle.rs:204-210`. As in round 24, this source is not proven identical to the pinned binary `f03e75…`. The suite runs that binary (`c25-suite.log:7`).
- **Offline byte arithmetic.** I rebuilt S8's redemption shape with the repo's own `@solana/web3.js`, `spl-token` and `mpl-core` builders. That gives the byte cost of a compute-budget pair (+52) and of a separate fee payer (+96). Those deltas were applied to the sim's measured 1,061 bytes.
- **Artifact hashes.** `cbob_vault_sweep.so` is `9e21cc9c…` in `target/deploy` (what the suite deployed, 19:31), `.cache/ln`, `.cache/mn` and `dist`. The other four programs' `target/deploy` hashes equal `.cache/ln`.
- **Host tests.** I ran `cargo test -p cbob-vault-mint --features localnet --lib`: **5 passed** (4 + Anchor's `test_id`).
- **Last green runs at this commit.** Suite **774/774**, floor 774 (`.cache/suite.log`, `c25-suite.log:85-86`). Sim **67/67** (`c25-sim.log`, 19:37, S7b.0-4 and S8.0-3 ok; S8.0 measured **1,061 bytes**, `:105`). Swap fork 10/10.
- **What I did not run.** I ran no validator, suite or sim myself. Nothing was written except this file and Cargo's `target/` cache.

**39 distinct findings:**

| Verdict | Count | Detail |
|---|---|---|
| CONFIRMED | 6 | 4 LOW, 2 INFO, all evidence gaps; 0 program defects |
| ACCEPTED-LIMIT | 7 | none materially worse than stated |
| DOC-ONLY | 9 | **4 false to holders** |
| WRONG | 17 | including all three HIGHs and the one CRITICAL |

- **No finding needs a program change.** Every round-24 program-adjacent repair holds where it was made:
  - **The sweep helper** is owner-only through Core and moves live balances (SR.4: `ALLOW,21001,0,true`; S8.1-S8.3).
  - **Byte identity.** The helper's mainnet bytes equal the bytes the suite deployed (measured above; the empty `localnet` feature is gone, `Cargo.toml:12-18`).
  - **The round-24 arms** BO.30-34c, E.7/E.7a, 3.1y, 10.6/10.6b and S7b all ran green.
  - **SPEC 54's corrected statement is true.** At `2b67fb1` 10.6b measured a mint plus one capture at **188,594 CU** with 512 slot hashes, a 5.7% margin under the default budget. That is not a dependable margin.
- **Held under every auditor's attack:**
  - the open↔burn pairing;
  - BURN's emptiness proof;
  - pool solvency (`pool ≥ ceil(owed)`) and every counter;
  - the boost's exact-N, carry and ring exclusivity past 64;
  - the level draw's window arithmetic;
  - governance reach;
  - every raw cross-program offset (independently recomputed by four auditors; all agree).
- **What makes it NOT CLEAN:**
  - four holder-guide sentences are false (D1-D4);
  - three BUYER-FACING limits are missing from or stripped in the guide (D5);
  - round 24's evidence repairs were landed in part while the freeze log records "C1-C10" (N1, N2);
  - the helper's single trust dependency, Core's Execute authority on a thawed vault, has no arm (N3).

| id | finding | raised by (their severity) | verdict |
|---|---|---|---|
| N1 | Round 24's C2 repair is half done. The host ring test still writes `boost_expiring[end % 64]` by hand. `unschedule_boost`'s not-due branch (an early retire of a boosted vault) is never driven past a wrap. | glm R0-3 (LOW); qwen-max F-1 (LOW); sakana R2b-L1 (LOW); sonnet R0 | **CONFIRMED, LOW (evidence).**<br>• **Host test:** MINT:3028 still does `c.boost_expiring[i] += 1` itself, and the test calls only `advance_epoch` (:3037).<br>• **Untested branch:** the ring branch MINT:1907-1909 is reached on chain only by BO.16, at an unwrapped epoch. BO.34 (bought at epoch 55, end 65 → slot 1) expires through the due branch only (`suite.log:874-878`).<br>• **Behaviour:** the code reads correctly, and a wrong index would fail closed (`checked_sub` → `Overflow`). |
| N2 | Round 24's evidence repairs are partial, and the record says they are complete. | glm R0-1 (MEDIUM); sakana R0-M1 (MEDIUM); muse R0-2 (LOW); qwen-max F-4 (LOW); qwen-2.4t R8-1 (LOW); sakana R8-L1/L2; qwen-max F-3 | **CONFIRMED, LOW (evidence + record accuracy).** FREEZE:514 says "(3) C1-C10: BO.30-34c …, E.7/E.7a, 3.1y, 10.6 tightened, S7b". The audit prompt says "C8: 3.1y and the weak arms". C1, C4, C6 and C10 landed (`run-tests.sh:330`).<br>**Not landed:**<br>• **C7:** RL.7 still bounds by the largest live supply (3prog:2861).<br>• **C8:** P.11a still passes on `''==''` when `picks` is empty (3prog:2246-2250; it happened to see 5 of 5 this run); 3.7 is still pinned to bare `0x9`; S7.4 still accepts `0 < paid ≤ avail` (test-vault:396-397); the 5.2 and 10.2 titles are unchanged; S7.2! still accepts either error.<br>• **C9:** five of six orderings are still absent: the crank/pair overlap; an expiry plus a frozen destination; two redemptions *landing* at cap ≥ 2; an older `TightenSweep` after a newer one; `books()` outside section BO.<br>• **C3 and C5 comments:** GOV:196-198 "six CPIs" and test-vault:127 "$CBOB does not exist on mainnet yet" are still there.<br>• **Ship-gate-5 pins:** none of round 24's five "rejected-but-measurable" pins exists. Those are: owner `AddExternalPluginAdapterV1` → `NoApprovals`; `Brakes{Some(default)}` ≡ `None`; a v0+LUT redemption; `[distribute, boost]`; and `activate` with its own record in the crank. |
| N3 | The helper's whole access control is Core's `ExecuteV1` authority rule. No arm attacks it on a **thawed** vault, which is the only state where it matters. | sakana R1s-M1 (MEDIUM); qwen-2.4t R1s-1 (MEDIUM); qwen-max F-2 (LOW); sonnet R1s(g) | **CONFIRMED, LOW (evidence).**<br>• **What Core does (`e72d63e`):** the asset approves Execute only for `authority == owner` (asset.rs:334-337), and the collection abstains (collection.rs:294-301). The only plugin route that can *approve* an Execute is the new **AgentIdentity** external adapter with an `ExecutionDelegateRecordV1` (agent_identity.rs:127-138; execute.rs:106-118).<br>• **Why AgentIdentity is unreachable here:** adding it needs the update authority, which is MINT's PDA. Our programs' only Core CPIs are Create, AddCollectionPlugin(Royalties) at init, UpdatePlugin(Attributes) and BurnV1 (MINT:720, :1229, :1355, :2240; BURN:384; SEAL:323).<br>• **Status:** sound today. Nothing pins it against the binary, though; 3.7 proves only the frozen case. The AgentIdentity route belongs in limit 40's list of Core consequences. |
| N4 | The value-moving helper has five arms, and many branches are never exercised. | sakana R1s-M4 (MEDIUM); sonnet R1s(g); muse R1s(g); glm R8 (LOW); opus-4.8 (SR.4a) | **CONFIRMED, LOW (evidence).**<br>• **No arm:** `data != [0]`; an odd account count; a wrong token or system program; `dest == signer`; a source not owned by the signer (SR.1 dies at the signature check first, so sweep:57 is never reached); a mint mismatch; a duplicate source; **zero pairs** (the lamport-only sweep BURN's header relies on); a frozen source.<br>• **SR.4a cannot fail.** It asserts a delta above 500,000, but it measured **4,669,880**, of which 3,669,880 is close rent and asset rent alone. SR.4's `getBalance(T.pda)==0` is what pins the lamport leg.<br>• **SR.2's title overstates.** The refusal is pair consistency (`to_owner != dest`, sweep:58), not a binding to the owner. |
| N5 | The redemption's byte headroom and compute are not asserted. | sakana R1s-M3 (MEDIUM), R1s-L2 (LOW); glm R1-3 (LOW); sonnet R1s(f); qwen-2.4t R1s-2 (LOW); muse R1s(f) (HIGH) | **CONFIRMED, INFO (evidence); muse's HIGH is WRONG (W6).**<br>• **Bytes:** S8.0 asserts only `B ≤ 1232`. The number is in the note, **1,061 bytes** at `2b67fb1` (`c25-sim.log:105`). Measured offline on the same shape, both compute-budget instructions add 52 bytes and a separate fee payer adds 96, so the worst page shape is about **1,209**, leaving 23 bytes of slack. It fits.<br>• **Compute:** never recorded (`cuOf` is never called on a redemption). The default budget for four instructions is ample, but unmeasured. |
| N6 | `build-mainnet.sh` compares the helper's mainnet bytes against its own `$CACHE/ln` rebuild, not against the `target/deploy` file the suite deployed. | sakana R1s-L3 (LOW); sonnet R8 (LOW) | **CONFIRMED, INFO.**<br>• **The code:** build-mainnet.sh:142.<br>• **Today the gap is empty:** all five `target/deploy` hashes equal `.cache/ln`, and the helper's equals `dist` (`9e21cc9c…`).<br>• **What is missing:** no gate records this. |
| D1 | "Replace the guardian or the swap bot's key (only with yes from half of all vaults)". | sakana R4-M1 / HG-M5 (MEDIUM) | **DOC-ONLY, FALSE TO HOLDERS (LOW).**<br>• **What the code counts:** the bar is `ceil(50% × quorum_supply)`, snapshotted at `create_proposal` (GOV:309, :403, :487-489).<br>• **When that differs from "all vaults":** while a sale round is open, vaults minted during the vote cannot vote (`VaultTooNew`) and do not raise the bar. A 240-vault snapshot needs 120 YES, which is **5.71% of 2,100** at execution (node). Round 24 D5 covered only the charter-close case, where snapshot and electorate coincide.<br>• **False sites:** HOLDER-GUIDE:123, SPEC:362 ("i.e. half of ALL live vaults"), SPEC:1394, DESIGN:249 and :344.<br>• **Accurate site:** GOV:69. |
| D2 | The first month: "a payout is due every month… Anyone can speed one up by burning 100 $GARY". | sakana R2-M1 / HG-M6 (MEDIUM); glm R2 (LOW) | **DOC-ONLY, FALSE TO HOLDERS (LOW).**<br>• **Why the burn path refuses:** `last_distribute_at = max(now, charter_closes_at)` (MINT:688). While nobody has joined, `w == 0`, and the burn path refuses `NoActiveVaults` (MINT:1594-1598). The free path also needs the month (:1600-1601).<br>• **Earliest payout:** nothing can be credited until **charter close + 30 days**. Then the empty tick runs, the crank joins the cohort, and a 100 $GARY burn can pay.<br>• **Free-path payout:** the first free crediting payout comes at **close + 60 days**.<br>• **Where it is documented:** SPEC:608-626 states the mechanism; HOLDER-GUIDE:21-23 and :63-64 do not. |
| D3 | "The validator producing the last of those blocks can pick among several results… Nobody else can." | sonnet D-1 (MEDIUM); sakana HG-M3 (MEDIUM) | **DOC-ONLY, FALSE TO HOLDERS (LOW).**<br>• **Who else can:** BUYER-FACING limit 25 (SPEC:1122-1147). A minter can compute its draw from public slot hashes, decline it, and get a re-roll whenever nobody captures for the 300-slot window. Both the minter's client and the crank operator can withhold a capture.<br>• **The guide:** limit 25 appears nowhere in the guide, and HOLDER-GUIDE:142 says the opposite. |
| D4 | "Opening is all or nothing. **Everything comes out**". | muse R0-5 (HIGH/DOC) | **DOC-ONLY, FALSE TO HOLDERS (LOW).**<br>• HOLDER-GUIDE:34 is in the "true about your vault, always" list.<br>• Undeclared tokens, NFTs and nested vaults are destroyed (limit 44; the guide's own :102-103). |
| D5 | BUYER-FACING limits missing from or stripped in the guide; the trusted keys are not described. | sakana HG-M2/M3/L1 (MEDIUM); sonnet D-3 (LOW-MEDIUM) | **DOC-ONLY, holder-facing omissions** (not counted as false sentences).<br>• **Limit 39** (immutability makes every bug permanent and unstoppable): absent. :41-42 present immutability only as a benefit.<br>• **Limit 40:** :134 names Metaplex with no consequence. SPEC:1283-1294 names two: `NotBurned` on every redemption, and a halted level queue. N3 adds Execute.<br>• **Swap bot (round 24 D3's repair):** :49-52 describes the bot's software, not what its key can take (limit 10: cap × cooldown windows until the guardian stops it).<br>• **$CBOB release wallet (limit 56):** :96 does not say it is a single hot key on the box.<br>• **The governing rule** (FREEZE:408): BUYER-FACING limits must be "somewhere a purchaser reads" before the sale opens. |
| D6 | Stale SPEC text and comments after round 24. | sonnet D-4 (LOW), R0 (LOW); qwen-2.4t; sakana R4-L1 (LOW); qwen-max; muse R0-1 (LOW); glm R1-3 | **DOC-ONLY, not holder-facing:**<br>• **The helper is called "being built":** SPEC:863 and :1495. :880-882 says "Not yet measured: its arms, and the byte and compute fit"; SR.0-4a exist, and S8.0 measured 1,061 B.<br>• **"Any of the four":** SPEC:274 and :934 say the alarm watches four programs. It watches five (detectors.mjs:371-372; selftest:2315-2317).<br>• **Rehearsal substitutions:** SPEC:1554 says "five substitutions (the four ids…)". `rehearsal-tree.sh:35-39` maps five ids.<br>• **Line citations:** SPEC:1342 and :1424 cite MINT lines that the A1 edit shifted by one.<br>• **GOV:196-198 "six CPIs":** still false; five is the maximum (W3).<br>• **SPEC 54's figures** are from an earlier run. At `2b67fb1` they are 114,756 / 75,898 / 524,588 / 188,594 (`suite.log:643-652`); the conclusions stand.<br>• **test-vault:127** (C5 comment). |
| D7 | Limit 44 is narrower than stated for classic tokens. | sakana Q2 | **DOC-ONLY (INFO), correct.** The helper sweeps any classic token account the vault PDA owns, of any mint, ATA or not, as long as the page names it with a same-mint destination (sweep:53-61). `judgeRedemptionCoverage`'s output can therefore be a sweep list rather than only a warning. Say so in limit 44 and item 50. |
| D8 | SPEC 46 omits two bounds. | sakana R5-L1 (LOW) | **DOC-ONLY, not holder-facing.**<br>• **Alarm cadence:** a hook added and removed between two alarm passes leaves no diff, and the alarm samples state.<br>• **The positive bound:** that key cannot transfer or burn an individual Proof of Burn. |
| D9 | Item 50 is missing three client facts. | glm, sakana R1s-L1 | **DOC-ONLY:**<br>• **The deposit-address page:** HOLDER-GUIDE:13 says "the Bank's pages show it", and item 50 does not list that surface.<br>• **The measured packet:** 1,061 B; a priority fee plus a separate fee payer still fits at about 1,209.<br>• **Zero-pair destinations:** a zero-pair (lamports-only) sweep needs a destination that already exists, because a sub-rent credit to an empty account is refused. |
| L1 | The guide speaks of the redeem page, the X/website announcement and the payout-first offer in the present tense. | muse R0-5; qwen-2.4t O-1 (MEDIUM); sakana HG-M1, HG-L1 (MEDIUM); glm; qwen-max Q4 | **ACCEPTED: OPEN item 50, not worse.**<br>• **What item 50 says:** SPEC:1488-1500 names exactly these surfaces and is OPEN AND BLOCKING "because the holder guide promises it". The guide is marked DRAFT (:3).<br>• **Rule to keep:** the guide may not be published before item 50 ships. |
| L2 | `initialize` checks little, and the checker validates the JSON, not the signed transaction. | sonnet R6 (LOW); qwen-2.4t R6-1 (LOW); glm R6; sakana R6 | **ACCEPTED-LIMIT 38 / item 38 OPEN (round 24 A6), not worse.** `sol_reserve_lamports`, `redeem_window_secs` and the reserves are pinned in `check-launch-params.mjs:55-61`. |
| L3 | The helper's upgrade authority is a total-loss key until it is removed. | sonnet R1s (MEDIUM) | **ACCEPTED (immutability at launch; limits 13 and 39), not worse.**<br>• **Watched:** the alarm checks `prog.sweep.upgrade_authority` and `prog.sweep.hash` at CRITICAL (detectors.mjs:371-372; selftest A3 arms :2315-2317).<br>• **Rehearsal:** `rehearsal-tree.sh` maps its id.<br>• **Stale text:** SPEC's "four" is D6. |
| L4 | The Core source read is not the pinned binary. | opus-4.8 R5 (HIGH as a flag) | **ACCEPTED-LIMIT 40, not worse.** The suite and sim run the pinned mainnet binary (`f03e75…`, `c25-suite.log:7`). The behaviours that matter should be pinned as arms (N2, N3). |
| L5 | "Activation is picked up automatically" depends on the crank being `--live`. | glm Q4 (LOW) | **ACCEPTED (off-chain posture), not a program finding.**<br>• **How it is armed:** `cron-install.sh:128-139` preserves a hand-armed `--live`.<br>• **What watches it:** the alarm pages `crank_silent` when no LIVE heartbeat arrives (SPEC:1016). This belongs to the off-chain pass and road step 8. |
| L6 | The guardian is also `INIT_AUTHORITY`, a single hot key. | sonnet Q1 | **ACCEPTED-LIMIT 47 (round 24 A4 operational note), not worse.** |
| L7 | A stranger can create a *missing* classic reserve ATA, with dust, between the page's build and its send. | sonnet R1s(e); sakana R1 ("item 50 gives no consequence") | **ACCEPTED (item 50 obligation), not worse.** SPEC:868-873 states both the step (create the missing accounts in the prior transaction) and the consequence ("otherwise a stranger can create a missing one with dust in between and the burn refuses"). |
| W1 | A stranger creates the **Token-2022 ATA** of a classic reserve mint for a vault PDA (170 bytes, `ImmutableOwner`). BURN refuses `ReserveHasExtensions`, the helper cannot close it, and the vault is bricked forever. | opus-4.8 (HIGH); muse R1s-1 (HIGH); glm R1-1 (HIGH). Contra: sonnet, qwen-max, qwen-2.4t, sakana | **WRONG (measured on mainnet).**<br>• **The measurement:** `createAssociatedTokenAccountIdempotent(…, TOKEN_2022)` for cbBTC, $GARY and $GIRAFFISH, owner an off-curve PDA, fails `InstructionError [0, IncorrectProgramId]` all three times ("Program Tokenz… failed: incorrect program id"). The classic control succeeds all three times.<br>• **Why it fails:** Token-2022's `GetAccountDataSize` and `InitializeAccount3` both run `check_program_account(mint.owner)` (t22 processor.rs:1519, :179).<br>• **No other route:** the ATA address is a PDA of the ATA program, so nothing else can create an account there.<br>• **What remains:** BURN's T22 derivation is defence in depth. The measurement should be pinned (below). |
| W2 | The helper never binds `dest` to the asset owner, so a hostile redeem page drains the vault with one owner signature. Also called a "generic drainer". | opus-4.8 (CRITICAL); sakana R1s-M2, HG-M4 (MEDIUM). Contra: muse, glm, qwen-max F-6, qwen-2.4t, sonnet | **WRONG as a defect.**<br>• **The helper adds no capability.** A hostile page that has the owner's signature on a Core `ExecuteV1` can carry plain SPL `Transfer`/`CloseAccount` and a System transfer to any address. That is exactly the pre-helper shape (`sweep()`, test-vault:197-205; arms 9.14), and BURN then passes.<br>• **So the proposed fix protects nothing.** Binding `dest == owner` inside the helper would not stop a hostile page.<br>• **"Comes out to you"** (HOLDER-GUIDE:164) is said of the redeem page and is true of it.<br>• **The "generic drainer"** (any signer's whole balance at execution time) gives a malicious dApp nothing a `SystemProgram.transfer` built a slot earlier does not. INFO. |
| W3 | The maximum proposal is **six** CPIs, and round 24's C3 miscounted. | glm R0-2 (LOW). Contra: muse, sakana R4-L1, qwen-max | **WRONG.**<br>• **The only two-CPI action** is `Brakes` with `set_guardian` and a restart (GOV:534-562).<br>• **The exclusion:** `set_guardian` forbids `ArmSwapOperator` in the same proposal (GOV:334-336).<br>• **So the maximum is five:** with a guardian change, 1 + 2 + 1 + 1 = 5; without one, 5 × 1 = 5.<br>• **Measured:** E.3c, four actions, five CPIs (3prog:1555). |
| W4 | `$GARY` and `$GIRAFFISH` freeze authorities are unchecked and may be live (limit 28 wider). | glm R1-2 (LOW) | **WRONG (measured).**<br>• **On mainnet both are `None`,** and so are their mint authorities. A `None` freeze authority can never be set.<br>• **cbBTC's is live** (`DSFAkPh…`, limit 28).<br>• **The sim's fixture step prints the same** (`c25-sim.log:4-5`). |
| W5 | The A1 line shift left the alarm's MINT hash baseline stale. | opus-4.8, sonnet, muse R0-4, qwen-max F-7, qwen-2.4t R0-1, glm R0-4, sakana (all as "unverifiable") | **WRONG.**<br>• **Where baselines come from:** the program-hash keys are drift keys whose baseline is read from chain (detectors.mjs:367-372; alarm.mjs:627-634). Nothing is deployed yet, so no baseline exists.<br>• **What the repo pins:** only Core's hash (build-mainnet.sh:55, run-tests.sh:92-94).<br>• **Suite pins** are keyed by name, not line. |
| W6 | The shipped redemption shape is unmeasured and exceeds 1,232 bytes with compute-budget instructions and the crank. | muse R1s(f) (HIGH) | **WRONG.**<br>• **S8.0 measures the helper shape:** 1,061 B, plus 52 for the compute-budget pair and 96 for a separate payer, about 1,209.<br>• **A redemption carries no crank:** BURN's instruction has none, and item 54 tells the page to send none. Headroom is N5. |
| W7 | "This round executed nothing, so it cannot count." | sakana E0 (MEDIUM) | **WRONG.** The triage is the measuring step. At `2b67fb1`: suite 774/774, sim 67/67, swap fork 10/10, host 5/5, plus this verdict's mainnet measurements. |
| W8 | `sol_reserve_lamports = 0` lets small royalties bounce. | sakana R6-L1 (LOW) | **WRONG at the ruled value.**<br>• **Pinned:** 50,000,000 (check-launch-params.mjs:61).<br>• **A vote can only raise the reserve.** `TightenSweep` is one-way (MINT:771-791). |
| W9 | A sub-rent or zero-lamport destination makes the lamport sweep fail opaquely. | sakana R1s-L1 (LOW); sonnet R1s(c) | **WRONG as a defect.** In the canonical shape the destination is the owner, who pays the fee and so exists. A zero-pair sweep to an empty account is a page rule (D9). |
| W10 | grok-4.3's R0 (C1-C5 missing; "nudge", "one attempt", "Not Gary Club" still false). | grok-4.3 | **WRONG at `2b67fb1`.** See *Counted auditors*. |
| W11 | "Flows into the Bank" / "the Bank holds all $CBOB" is false because the Bank was deleted. | muse R0-5 | **WRONG as falsehood.** "The Bank" is the guide's name for the revenue, pool and release system. The custody point is D5. |
| W12 | "Drawn a few seconds after"; "about 45 an hour" ignores the charter cohort. | sakana HG-L1 (LOW) | **WRONG as falsehoods (INFO precision).**<br>• **"A few seconds":** the entropy is fixed about 16 slots after `reveal_slot` (`readySlot`, test-vault:216). The written reveal follows the crank lane.<br>• **"About 45 an hour":** the figure is explicitly "at 2,100 vaults" (HOLDER-GUIDE:105-106). |
| W13 | "Goes back to its level's share by itself" is false, and a due boost pauses everyone. | sakana HG-L1, Q3 | **WRONG.** `expire_boosts` is free and permissionless, and the crank runs it. The pause is stated in SPEC 36 (round 24 W7). |
| W14 | SR.3 is refused for a reason other than its title. | sakana R8-L1; sonnet R1s(g) | **WRONG.** The title says the opening fails, and it does. The pin names 0xb `NonNativeHasBalance` deliberately (3prog:2983). |
| W15 | `BadSweepBound` says "7 days" but `initialize` caps the cooldown lower. | sonnet D-5 | **WRONG (INFO).** 7 days is the cooldown *ceiling* bound (MINT:484, :583). The init cap is a separate check (:589). |
| W16 | `claim`'s join branch has no `require_live_vault`; `join` indexes `LEVEL_WEIGHTS` unchecked. | sakana R2-L1, X-3 | **WRONG as defects.**<br>• **The asymmetry is what keeps a bare-burned waiting vault from wedging `JoinWaitingFirst`** (MINT:1689 against :1418).<br>• **`activate` requires a level of 1..=5.**<br>• Optional comments, with the next program edit. |
| W17 | "Anything credited stays yours" omits the sub-sat residue. | sonnet D-5 | **WRONG as falsehood.** The residue is under one sat and was never credited in sats. |

## CONFIRMED: the smallest fix and the arm each needs

None needs a program change. Every fix is in `tests/` or `sim/`, which the freeze covers, so landing any of them resets the counter. Batch them, and correct FREEZE:514's "C1-C10" in the same commit.

**N1. Host test and on-chain arm:**
- **Host test.** Buy *and* `unschedule_boost` before due, and expire, across a wrap at N = 63 over 200+ epochs, against an independent model. Call the program's own free functions instead of writing `boost_expiring` by hand.
- **On-chain arm.** Buy a boost whose end wraps, bare-burn and `retire_burned` it before due, and assert the ring slot fell and `books()` holds.

**N2. Land the rest of round 24's list:**
- **P.11a** fails unless `picks.length === 5`.
- **S7.4:** `paid ∈ {avail−1, avail}` with only the Test Vault joined.
- **3.7:** pin it to the frozen-plugin rejection, or add the decoded-state read.
- **Titles and pins:** reword the 5.2 and 10.2 titles; pin S7.2! to one reason.
- **RL.7:** stamp the live supply at each write.
- **The five C9 arms.**
- **Round 24's five pins:** owner `AddExternalPluginAdapterV1` refused `NoApprovals`, including an **AgentIdentity** adapter; `Brakes{Some(default)}` ≡ `None`; a v0+LUT redemption lands; `[distribute, boost]` ends at e+1+N; `activate` with its own record in the crank is refused `NotRevealed`.
- **Comment fixes:** test-vault:127, and GOV:196-198 (only with some other program edit).

**N3. Arm SR.5.** Inside a genuine `open_for_redemption` for alice's vault, send Core `ExecuteV1` into the helper with `authority = bob`, then with the collection's update authority, then with a Core transfer delegate the owner added. Each must be refused by **Core**, and the vault must still hold everything. Add AgentIdentity / ExecutionDelegate to limit 40's consequences.

**N4. One arm per branch, each pinned to the `CBOB_SWEEP refused` text or the program error:**
- **Refusals:** a data byte not 0; an odd count; a wrong token or system id; `dest == signer`; a source not the vault's; a mint mismatch; a duplicate source.
- **Zero pairs:** lamports-only lands.
- **Frozen source:** reverts.
- **SR.4a:** assert the delta equals exactly the 1,000,000 plus the closes' rent plus the asset rent minus the fee, or assert the PDA→owner System transfer in the logs.
- **SR.2:** retitle it "a destination account not owned by the named wallet".

**N5.**
- **S8.0:** assert `B ≤ 1232 − 52 − 96` and print it.
- **S8.1:** record `meta.computeUnitsConsumed`.
- **SPEC:** move both numbers into item 50.

**N6.**
- **Build check:** `build-mainnet.sh` also runs `cmp "$OUT/cbob_vault_sweep.so" "$ROOT/target/deploy/cbob_vault_sweep.so"`.
- **Suite log:** `run-tests.sh` logs the sha256 of each deployed `.so`.

## Document fixes, holder-facing first

1. **HOLDER-GUIDE:123 (D1):** "yes from half of all vaults **that exist when the vote opens**; vaults sold during the vote cannot vote on it". Make the same qualification at SPEC:362 and :1394, and at DESIGN:249 and :344.
2. **HOLDER-GUIDE:21-23 and :63-64 (D2):** add "The first payout cannot happen until a month after the charter window closes, not even by burning $GARY: until then no vault has joined. Everything earned before it is shared by the vaults in it."
3. **HOLDER-GUIDE:137-142 (D3):** drop "Nobody else can". Add limit 25: "If nobody records your vault's draw within about two minutes, a fresh one is drawn; the minter could use that to turn down a draw they dislike."
4. **HOLDER-GUIDE:34 (D4):** "Everything in it (cbBTC, $GARY, $GIRAFFISH and SOL) comes out".
5. **HOLDER-GUIDE honest list (D5).** Add:
   - **Limit 39:** a bug cannot be fixed or stopped once the programs are locked.
   - **Limit 40's consequences:** Core can change; a change could stop openings (`NotBurned`) or the level draw, or widen who may act through the vault wallet.
   - **The swap bot's key** could take up to the cap every cooldown until the guardian stops it, and never a vault, the pool or cbBTC.
   - **The $CBOB release wallet** is one online key; a thief could boost their own vaults.
6. **Not holder-facing:**
   - D6 as listed: SPEC:274, :863, :880-882, :934, :1342, :1424, :1495, :1554 and SPEC 54's figures; GOV:196-198; test-vault:127.
   - D7: limit 44 and item 50 say the helper can rescue stray classic tokens.
   - D8: SPEC 46's two bounds.
   - D9: item 50 gains the deposit-address surface, the packet numbers and the zero-pair destination rule.

**Rejected-but-measurable claims to pin (ship gate 5):**
- a stranger's Token-2022 ATA for each reserve mint is refused `IncorrectProgramId` (W1);
- the reserve mints' freeze authorities are as recorded: cbBTC `DSFAkPh…`, the other two `None` (W4; a launch-checker or probe line);
- a non-owner Execute on a thawed vault is refused by Core (N3).

**Verdict: NOT CLEAN.** No program defect survived measurement, no finding is CRITICAL or HIGH, and the one CRITICAL and three HIGHs raised were refuted (W1 on mainnet, W2 by construction). It is not clean because:
- **Four holder-guide sentences are false:** D1 (half of all vaults), D2 (the first month), D3 ("Nobody else can"), and D4 ("Everything comes out").
- **BUYER-FACING limits 25, 39 and 40 are absent from or stripped in the guide**, and the two hot keys are undescribed (D5).
- **Round 24's evidence repairs are incomplete** while the freeze log records them as done (N1, N2).
- **The sweep helper's one trust dependency, and most of its branches, have no arm** (N3, N4).

The two-round counter stays at 0 of 2.
