# Round 24, PROGRAMS pass: NOT CLEAN (no CRITICAL, no HIGH; no program defect confirmed)

Audited tree `6e521db`. `git diff --stat 6e521db -- programs tests sim` is empty, so every citation below is to `6e521db`. The working tree's uncommitted changes are off-chain only (bank/, scripts/, SPEC, HOLDER-GUIDE). I checked whether any of them fixes a document item below: none does. The only HOLDER-GUIDE change is the limit-55 wording.

**Counted auditors (8):**
- First run (`MANIFEST-programs.first-run.json`): claude-opus-5.5, deepseek-v4-pro-0813, grok-4.7, qwen3.8-max-prime, mimo-v2.6-pro.
- Rerun (`MANIFEST-programs.json`): glm-5.3-prime, claude-opus-5, grok-4.20.
- Both manifests record head `6e521db` with an empty `dirty` list.
- **Not counted:** the two OpenAI models refused (`audits/round24/refused/`), and glm's first-run attempt failed (it is counted from the rerun).
- grok-4.20 reads in part as if it audited the round-23 tree. It reports the boost slippage guard and the `IX_SET_BOOST_TERMS` pin as missing, and both are present at `6e521db`.

**Method.** I deduplicated the eight reports and checked every distinct claim against the code at `6e521db`.
- **Host tests.** I ran `cargo test -p cbob-vault-mint --features localnet --lib`: **5 passed**. The fifth is Anchor's `declare_id!`-generated `test_id`.
- **Arithmetic in node:**
  - the level-draw selection odds (best-of-k against the 945/525/315/210/105 census);
  - the governance concentration thresholds;
  - mainnet rent (0-byte 650,240; ATA 1,488,440).
- **Core.** I read Metaplex Core source at HEAD `e72d63e` (a scratch clone left by an earlier session):
  - `processor/add_external_plugin_adapter.rs`, `state/asset.rs:342-354` and `state/collection.rs:304-316` (who may add an adapter);
  - `utils/mod.rs:230-316` (`NoApprovals`);
  - `utils/account.rs:10-35` (the burn tombstone);
  - `plugins/external/*` (lifecycle hooks are never CPI'd; `invoke` appears only in `execute.rs` and the noop wrap).

  This source is not proven identical to the pinned binary (sha `f03e75…`).
- **Files read:** the suite, the sim, `run-tests.sh` and `check-launch-params.mjs` were read at `6e521db`.
- Nothing was written to the repo. Cargo's own `target/` build output is the only artifact.

**41 distinct findings: 10 CONFIRMED (all evidence or test gaps, 0 program defects: 6 LOW, 4 INFO), 6 ACCEPTED-LIMIT (4 worse than stated), 9 DOC-ONLY, 16 WRONG.**
- **No finding needs a program change.** Every program repair from round 23 holds at its site:
  - `BoostNotTheOwner` (MINT:1481-1487), after `require_live_vault` and before the burn;
  - `BoostTermsMoved` (MINT:1473), before the burn;
  - GOV `TooManyActions` now says five;
  - the WR.0-WR.4 wrapper arms, the ID.1 guard and the program-named reason pins.
- **Held under every auditor's attack:** pool solvency, the boost carry and `reweigh`, ring exclusivity (epochs ≤ 63 < 64), every cross-program offset, and the open↔burn pairing.
- **What makes it NOT CLEAN:**
  - **Three holder-guide sentences are false:** "nudge slightly" (A1), "one attempt… trying again works" (A3), and "Not Gary Club" for custodial wallets (D2).
  - **A fourth is false in the harmless direction:** the boost-terms refusal (D1).
  - **The charter-window hot wallet's consequence is understated and missing from the guide** (A2).
  - **Round-23 repairs left evidence gaps** (C1-C5).

| id | finding | raised by (their severity) | verdict |
|---|---|---|---|
| A1 | The leader of C's slot does not "nudge" the draw; it **chooses** among many results. | opus-5.5 R3-1 (MEDIUM); deepseek "limit 26 worse"; mimo F-3 (MEDIUM). Contra: grok-4.7, qwen, glm, opus-5 | **ACCEPTED-LIMIT 26, WORSE than the holder guide states → DOC, FALSE TO HOLDERS.**<br>• **How C's leader chooses.** C is the smallest produced slot in `[want, want+64]` (MINT:2127-2150, 234), so the leader can skip its own first slot(s) and move C within its own 4-slot group. Skipping alone gives best-of-4: P(Level V) goes from 5.0% to **18.6%**, and E[weight] from 3.05 to **4.38** (node). Varying its block's content adds more: 64 tries reach 96%. So for its own vault, or a cohort's, it is selection, not bias.<br>• **What SPEC 26 already says** (SPEC:1058-1074): "being C's leader is chosen", plus the cohort effect. Its "can bias the draw" understates.<br>• **False to holders:** HOLDER-GUIDE:38 ("nudge a draw slightly") and :129-131 ("nudge").<br>• **Also stale:** DESIGN:89 ("two outcomes, not many"), and the MINT:163-166 comment ("roughly its stake share", "hands C to the next leader"), which SPEC 26 already corrected. |
| A2 | The Giraffish Moments hot wallet can **end the whole project**, or **capture governance**, not just harm charter members. | opus-5.5 R5-1 (HIGH by consequence); deepseek, glm, grok-4.20 restate 46 | **ACCEPTED-LIMIT 46 (ruling RT2-1), WORSE than stated → DOC, false to holders by omission.**<br>• **Why it reaches the whole project.** The charter claim is the only way to create a vault without a vote. `create_proposal` needs a live vault owned by the proposer (GOV:311-313), and `mint_vault` needs `round_id > 0` (MINT:1084), which only GOV can set.<br>• **End:** a rejecting Oracle held through the window means zero claims, so no proposal and no round, ever.<br>• **Capture:** the hot wallet can approve only its own Proofs of Burn. It can use an asset-level adapter, or flip the oracle between transactions. Its vaults are then the whole electorate: key changes (guardian, swap operator and with it royalty SOL), rounds at the floor price, and boost terms.<br>• **What the docs say:** SPEC 46 says "*Who:* every charter member" (SPEC:1229-1252, tagged BUYER-FACING). HOLDER-GUIDE never carries it, and its :117 row ("Gary Club … cannot: anything the rules do not allow anyone") hides it. |
| A3 | The accepted redemption grief is described as "one attempt". | opus-5 R1-1 (MEDIUM); opus-5.5 (Q1 note) | **ACCEPTED (Gary 2026-10-04) + DOC, FALSE TO HOLDERS.**<br>• HOLDER-GUIDE:137-138 says "Someone could make **one attempt** … fail … **trying again works**".<br>• SPEC itself (:824-826) prices persistent targeting at about 0.045 SOL/h. A spammer landing 1 base unit every slot defeats any sweep built from pre-read amounts, so retrying does not work while it lasts. The only defeat is an execution-time sweep helper, which item 50 does not require (SPEC:826 says only "re-read and retry").<br>• **Nit:** SPEC:820's 890,880 lamports is the test-validator figure. Mainnet's 0-byte minimum is **650,240** (`sim/clone-pob.mjs:12`, measured). |
| A4 | A stolen guardian key's stop can be **permanent**, not "a vote plus a week". | opus-5.5 R4-1 (MEDIUM) | **ACCEPTED-LIMIT 47, WORSE than stated → DOC.** The cure needs YES from ⌈50% of all live vaults⌉ (GOV:483-490). At turnout below that, the thief re-stops after every restart forever. No funds are lost. Not in the holder guide; :116 is accurate. Operational note: the guardian is also `INIT_AUTHORITY`. |
| A5 | Core dependencies: (a) `is_burned` needs Core's exact 1-byte tombstone; (b) no path advances `revealed_total` without a successful Core `UpdatePluginV1`; (c) "if an owner can add an adapter, this is CRITICAL". | opus-5.5 R1-1 (MEDIUM, conditional); opus-5 R3-2 (MEDIUM / conditional CRITICAL) | **ACCEPTED-LIMIT 40, not materially worse; the CRITICAL branch is WRONG** (Core `e72d63e`).<br>• **No owner adapters:** for a collection-authority asset, an owner's `AddExternalPluginAdapterV1` gets no approval. The asset approves only `UpdateAuthority::Address == signer` (asset.rs:342-354) and the collection only its own update authority (collection.rs:304-316), so the add fails `NoApprovals` (utils/mod.rs:315-316).<br>• **Tombstone:** `close_program_account` leaves 1 byte, `Key::Uninitialized` (utils/account.rs:31-32), which is exactly MINT:2040-2043.<br>• **What remains:** a hypothetical Core upgrade, which limit 40 already covers. One DOC line could name the two consequences (the level queue halts; redemption refuses `NotBurned`). |
| A6 | `initialize` validates too little:<br>• SEAL accepts any SPL-owned account as a "mint", 1-3 entries, duplicates, and an unchecked collection pubkey;<br>• `cbob_mint` authorities are not read;<br>• `redeem_window` 10 s to 24 h;<br>• `charter_opens_at` may be in the past;<br>• `payment_mint` may be any reserve;<br>• off-curve keys are accepted;<br>• nothing checks the decoded live configs before step 11. | grok-4.7 (LOW); mimo F-5 (MEDIUM); opus-5 R5-1, R6-1 (LOW); opus-5.5 R6-1 (LOW); deepseek O4 (LOW); grok-4.20 | **ACCEPTED-LIMIT 38 / item 38 OPEN, not worse.**<br>• **Behaviour confirmed:** SEAL:162-166 and :273-279 check only the owner.<br>• **The ruled control exists:** `check-launch-params.mjs@6e521db` pins `reserve_mints` to exactly the three ruled mints (:55, :91-92), `cbob_mint` (:66, :84), `redeem_window_secs` 3600 (:57), a future charter (:120) and lock-before-charter (:80-81).<br>• A wrong collection is refused by MINT/BURN (`WiringDiverged`) before step 11.<br>• `cbob_mint`: round 23 F6 already ruled this WRONG; the mint `GMm2…` has no authorities.<br>• **Residual DOC:** the SEAL:105-107 comment says `assert_classic_spl` "reads the MINT"; it reads the owner only. The checker validates the JSON, not the signed transaction. |
| C1 | `BoostTermsMoved`'s weight and epochs legs are never exercised. | grok-4.7 (LOW) | **CONFIRMED, LOW (evidence).** BO.26 is refused on **price** (4e9 > 3e9) while weight and epochs moved favourably (3prog:2713-2719). `ixBoost` defaults to `minW = 0, minE = 0, maxPrice = u64::MAX` (:2514). Deleting `extra >= min_weight && epochs >= min_epochs` at MINT:1473 would stay green. |
| C2 | The boost ring wrap past 64 is never driven through the program's own index. | opus-5.5 R2b-1(e) (LOW); mimo F-4 (LOW) | **CONFIRMED, LOW (evidence; round-23 F7(e) repair partial).** The host test writes `boost_expiring[end % 64]` itself and expires by editing totals (MINT:3022-3032), so it tests `advance_epoch` only. `boost_vault`'s inline index (MINT:1509-1511), `unschedule_boost` and `expire_boost` never run past epoch 64, and BO runs at BE = 2. |
| C3 | The five-kind proposal is created but never executed, and the GOV comment claims "measured … six CPIs". | opus-5.5 R2b-1(h), R4-2 (LOW/INFO) | **CONFIRMED, LOW (evidence) + comment false.** BO.28 uses `votes:'none'` (3prog:2727-2728). E.3c measured four actions. GOV:196-198's "six CPIs" is impossible: a guardian change and an operator arm cannot share a proposal (GOV:336), so the maximum is five. |
| C4 | Post-transfer ownership (new owner allowed, old owner refused) is not exercised. | opus-5 R2b-1 (LOW) | **CONFIRMED, LOW (evidence; asked for in round-23 F4).** Only a stranger is tested (BO.6). |
| C5 | The Test Vault simulation contains no boost, and its `$CBOB` comment is stale. | glm (LOW + INFO); opus-5 R2b-2 (LOW); opus-5.5 (j); grok-4.20 (INFO) | **CONFIRMED, LOW (round-23 F7(j) not built).** No `boost_vault`, `expire_boosts` or `SetBoostTerms` in `sim/test-vault.ts`. :127 says "$CBOB does not exist on mainnet yet". |
| C6 | 10.6 and 10.6a cannot show that the four captures ran. | opus-5.5 R8-1 (LOW) | **CONFIRMED, LOW (evidence).** `unset` reads records after a *simulation*, so it is trivially 0 (3prog:2081-2085). Nothing asserts that `wide.cu` exceeds the base by the captures' cost, and SPEC 54's 518,929 figure binds item 50. |
| C7 | RL.7 bounds by the largest live supply, not each redemption's own cap. | grok-4.7, qwen, mimo F-6 (LOW), opus-5 | **CONFIRMED, INFO (carried from round-23 F22; disclosed in the arm text, 3prog:2751).** |
| C8 | Weak or vacuous arms:<br>• P.11a passes vacuously with no picks;<br>• 10.2 is a measurement, not a refusal;<br>• X.7 plans against an empty queue;<br>• 5.2's title outruns its `AccountNotSigner` pin;<br>• 3.7 is pinned to `0x9`, which is Core `InvalidAuthority`, shared with R.6;<br>• S7.2! accepts either error;<br>• S7.4 accepts any `0 < paid ≤ avail`;<br>• SEAL `Config` has no `acctDisc` arm. | opus-5 R8-2, R8-4, R7; qwen INFO-1; opus-5.5 R8-3; grok-4.7 | **CONFIRMED, INFO (evidence quality).** Most are self-labelled. The seal itself rests on 2.3a and 4.2. |
| C9 | Correct by reading but unexercised:<br>• `books()` runs only in section BO;<br>• BURN's rate ring never runs near or past 64;<br>• duplicate `(record, dest)` pairs, and crank/pair overlap, in `claim`;<br>• a boost expired in the same claim that defers a frozen destination;<br>• two redemptions landing in one transaction at cap ≥ 2;<br>• an older `TightenSweep` executed after a newer one. | opus-5.5 R8-2, R8-4; opus-5 R2-3, R8-3; qwen LOW-2 | **CONFIRMED, INFO (evidence).** I traced each and each holds:<br>• `load_record` re-reads, so a duplicate pays 0;<br>• the crank writes only level-0 records, which the pair path never stores;<br>• `tighten_sweep` is `max`/`min` (MINT:771-791). |
| C10 | `CBOB_CACHE` moves the wrapper build, but the suite reads a hard-coded keypair path. | opus-5 R8-5 (INFO) | **CONFIRMED, INFO.** `run-tests.sh:48, 112-113, 197` against `3prog:2382`. It fails red (WR.0 / WR pins), never false green. |
| D1 | The guide says a boost is "refused" if a vote changes the terms. | grok-4.7 (LOW) | **DOC-ONLY, false to holders in the harmless direction.** The code refuses only price↑, weight↓ or epochs↓ (MINT:1473), as ruled. A favourable move lands at the new terms, including a longer slot lock. HOLDER-GUIDE:85-86 and SPEC:1363-1365 say any change refuses. |
| D2 | "Only you can open it. Not Gary Club." | opus-5.5 (doc) | **DOC-ONLY, false to custodial holders.** HOLDER-GUIDE:27 contradicts :107 (the "Gary Club wallet" is custodial) and limit 41. |
| D3 | The royalty's trusted hop is not disclosed to holders. | opus-5.5 R6-2 (MEDIUM, doc) | **DOC-ONLY (omission, not a false sentence).** HOLDER-GUIDE:44-46 says 85/15 "fixed forever". Royalty SOL passes the swap operator and Jupiter (limit 10, SPEC:995-1013, not tagged BUYER-FACING). |
| D4 | A frozen pool reverts a mixed claim, so "joins still go through" holds only for a claim that pays nothing. | qwen LOW-1 (LOW) | **DOC-ONLY.**<br>• **Mechanism:** the join (MINT:1688) is reverted by the pool `Transfer` (:1724-1735), and `claim` never checks pool freeze.<br>• **The crank already sends join-only batches** (`crank.mjs@6e521db:231-248`).<br>• **What to fix:** SPEC 28 (:1095). The REDEEMING step 2 "claim first" (SPEC:232) must drop `claim` while the pool is frozen, as 3c.F2 does (3prog:2420). |
| D5 | Governance concentration:<br>• the snapshot at charter close (opus-5 HIGH, "2,100 disenfranchised");<br>• a sell-out at the floor (opus-5 MEDIUM). | opus-5 R4-1 (HIGH), R4-2 (MEDIUM) | **DOC-ONLY (precision), not false to holders.**<br>• **Why it is not a defect:** "half of all live vaults" at creation *is* the whole electorate. No paid vault can exist before a round vote executes (MINT:1084), and the snapshot rule is documented (GOV:69).<br>• **What to add:** SPEC:1617-1619 and DESIGN §10 analyse only the largest holder. The top three (91) carry a key change if **≥ 58 of 240 (24.2%)** go unclaimed, and an ordinary majority of voters can open a 2,100-cap round at 21,000 sats. Add both sentences.<br>• The proposed `max(snapshot, minted_total)` change is not needed. |
| D6 | Stale design and spec text. | opus-5.5 (doc), glm | **DOC-ONLY, not holder-facing:**<br>• DESIGN:56 (PoB mint "OPEN"), :72 (`sha256(slot_hash‖asset)`), :81 (~512 slots), :89 (two outcomes);<br>• SPEC's MINT table (:276-294) omits `boost_vault`, `expire_boosts` and `set_boost_terms`;<br>• SPEC's `initialize` row (:278) omits `max_boost_weight`, `max_boost_epochs` and `cbob_mint`;<br>• SPEC:1581 says "results are pending" against the road table's 60/60. |
| D7 | Integrity of the blocker list. | mimo F-9 (LOW), opus-5.5 Q4, grok-4.7 Q4 | **DOC-ONLY.**<br>• Items 51 and 53 read as done, and 54 as measured, yet all three sit in OPEN AND BLOCKING. 54's live half binds item 50.<br>• Item 50 ends "Gary may rule otherwise".<br>• Item 50 does not list the execution-time sweep (A3), dropping `claim` while the pool is frozen (D4), or closing the swept accounts (D8). |
| D8 | Client and launch contracts not written down: an emptied but **unclosed** reserve account strands its rent, and `distribute` needs the pool account even for the empty tick. | mimo F-1 (LOW); opus-5 R2-2 (LOW) | **DOC-ONLY.**<br>• **Rent:** BURN checks `amount == 0`, not closure, and nothing can sign for the PDA after the burn. About 1,488,440 lamports per account on mainnet; the redeemer's own loss. Add to SPEC REDEEMING.<br>• **Pool account:** MINT:1588 runs `read_token` before the `w == 0` branch, while `monthly_inline` degrades gracefully. Add to item 52. |
| D9 | "5 host" tests. | (from W1) | **DOC-ONLY.** One of the five is Anchor's generated `test_id`. FREEZE:513's "5 host" should say 4 + `test_id`. |
| W1 | `HOST_FLOOR=5` against four `#[test]`s, so `run-tests.sh` "cannot pass". | glm (MEDIUM), opus-5 R8-1 (MEDIUM) | **WRONG (measured).** `cargo test … --lib` prints `running 5 tests … test_id … ok … 5 passed`. Anchor's `declare_id!` emits `test_id`. |
| W2 | Limit 25 is worse: the minter "guarantees" a re-roll, and the FIFO-head owner can stall the queue at will. | deepseek (worse-than-stated), opus-5 R3-1 (MEDIUM) | **WRONG.** Capture is permissionless: `capture_entropy` (MINT:1255), the crank (:2099) and the inline capture in `reveal_level` (:1308-1318). Nobody can withhold anyone else's capture. A reschedule needs the window to have lapsed (:1279-1280), which needs total silence: exactly limit 25. The FIFO wait is stated (MINT:183; SPEC 25 `reveal_queue_stalled`). |
| W3 | A hot-wallet lifecycle hook could use the claim's owner signature. | grok-4.7 (unmeasured) | **WRONG (Core `e72d63e`).** Core never CPIs into lifecycle hooks: `invoke` appears only in `execute.rs:103` and the noop wrap (`traits.rs:64`). Pass-through accounts are non-signers (MINT:1229-1233). |
| W4 | A guardian of `Some(Pubkey::default())` silently retires the brake. | opus-5 R4-3 (LOW) | **WRONG as a defect.** `unwrap_or_default` (MINT:925) makes it identical to `None`, a ruled and legal outcome behind the same half-of-all gate (GOV:483-490). The emitted log line is identical too. INFO for the vote page: render a default key as "retire the brake". |
| W5 | A v0 transaction with lookup-table keys breaks the pairing. | qwen INFO-2 | **WRONG (reasoned from Agave, not measured).** The instructions sysvar is built from the sanitized message's *resolved* keys, so the pubkeys compared are the real ones. It fails closed in any case. |
| W6 | `pob_extra` hands our writable records to Core. | opus-5 R1-2 (INFO) | **WRONG.** They are non-signer (MINT:1229-1233), and the runtime forbids Core writing accounts it does not own. |
| W7 | Grok-4.20's stale-tree claims. | grok-4.20 | **WRONG at `6e521db`:**<br>• "no slippage guard": MINT:1473 has it;<br>• "pin missing": BO.29 is there;<br>• "old terms undocumented": HOLDER-GUIDE:76 states it;<br>• "JoinWaitingFirst looser": `monthly_inline` refuses while a vault waits (MINT:1994-1999), so a joiner gets nothing from the claim that joins it;<br>• the "9-decimal" comment is MINT's `$GARY` check and is accurate;<br>• `TightenSweep` is documented as unordered (GOV:529-530);<br>• "many pins name the wrong program" is unsubstantiated (9.13 is pinned to the System program then MINT, 3prog:2877);<br>• "monthly waits for a due boost" is already in SPEC 36 (:1151-1154);<br>• undeclared holdings are limits 9 and 44 plus item 50;<br>• the revenue account is item 52;<br>• the on-curve guardian is limit 38. |
| W8 | The `$CBOB` mint's authorities are unchecked. | deepseek O4 (LOW), grok-4.7 | **WRONG (superseded, round-23 F6).** The mint exists with no authorities and is pinned. |
| W9 | Boost burn-through is understated to holders. | deepseek B2 (MEDIUM) | **WRONG / ACCEPTED (ruling).** HOLDER-GUIDE:82-84 says "Anyone can trigger an extra payout … a boost can run out sooner". |
| W10 | `[distribute, boost]` in one transaction is unexercised. | opus-5.5 (a) | **WRONG as a gap.** The only shared state between the two is config, so it equals two transactions, the path BO.7 → BO.10 covers. |
| W11 | "No vault is paid for revenue that arrived before it joined" is false. | opus-5.5 R2-1, grok-4.7, mimo F-2, opus-5 R2-1 | **WRONG as a finding.** That is the brief's wording. SPEC:581-585 states the true, weaker rule, and no document makes the strong claim. |
| W12 | `boost_vault` does not require `boosts_due == 0` or no waiting joins. | qwen INFO-3 | **WRONG.** Harmless, as qwen itself shows. |
| W13 | Limit 46 should add "moving a PoB out of the collection". | deepseek | **WRONG.** It is already there (SPEC:1244-1245). |
| W14 | `activate`'s crank could lose an update "by coincidence". | opus-5 R2-3(iii) | **WRONG.** It cannot happen by construction. The crank writes only level-0 records (MINT:2108), and `activate` on a level-0 record always errors `NotRevealed` (:1422), so the transaction reverts. |
| W15 | Undeclared holdings are destroyed "worse than stated". | grok-4.20 (MEDIUM) | **WRONG as new.** Limits 9 and 44, and item 50 is OPEN AND BLOCKING (round-23 F23). |
| W16 | Init: the revenue account and on-curve guardian or operator. | grok-4.20 (MEDIUM / LOW) | **WRONG as new.** Item 52 and limit 38 (round-23 F27). |

## CONFIRMED: the smallest fix and the arm each needs

None needs a program change. Every fix is in `tests/` or `sim/`, which the freeze covers, so landing any of them resets the counter. Batch them.

**C1. Fix and arm.** After a terms vote that keeps the price and lowers the weight, a boost signed with the old `minW` is refused `BoostTermsMoved`, and the `$CBOB` supply is unchanged. Repeat for epochs. Then show a favourable move (a lower price) is ALLOW at the new terms; that arm pins the one-sided rule D1 documents.

**C2. Fix:**
- **Host test.** Drive `unschedule_boost`, `expire_boost` and `advance_epoch`, all free functions, on `blank_config()` with records over 200+ epochs at N = 63, and stop writing the ring index by hand.
- **On-chain arm.** Run cheap burn-path distributions until `dist_epoch > 64`, buy a boost whose `end % 64` wraps, and assert it is due exactly at `end` and that `books()` holds.

**C3. Fix:**
- **Arm.** Vote and execute BO.28's five-kind proposal. Assert all five land and record CU, with a compute-budget instruction if needed.
- **Comment.** Change the GOV:196-198 text to "five CPIs, unmeasured until <arm>". Do this only with some other program edit.

**C4. Arm.** Transfer a vault from alice to bob. Alice's boost is refused `BoostNotTheOwner` and the supply is unchanged; bob's is ALLOW.

**C5. Fix.**
- Add to the sim: a terms vote at 12/24 (epochs reduced for runtime), one boost on the Test Vault, two distributions at the boosted weight, expiry, one at the level weight, and `books()`.
- Fix the :127 comment.

**C6. Fix.** Assert `wide.cu ≥ base.cu + 4 × 100,000`, and drop the `unset` clause.

**C7. Fix.** Stamp the live supply at each ring write in the replay and assert the per-redemption cap.

**C8. Fix:**
- P.11a fails when fewer than 5 picks;
- pin 3.7 to the frozen-plugin rejection, or add the decoded-state read to its note;
- S7.4: `paid ∈ {avail−1, avail}` with only the Test Vault joined;
- add a `3.1y` `acctDisc('Config')` pin;
- reword the 5.2 and 10.2 titles.

**C9. One arm each:**
- a duplicate pair pays once and `owed` falls once;
- crank and pairs naming the same record;
- an expiry plus a frozen destination gives `ClaimDeferred` at the boosted amount;
- `[open A, sweep, burn A, open B, sweep, burn B]` at cap ≥ 2 lands and `burned_total` rises by 2;
- execute an older `TightenSweep` after a newer one and the values are unchanged;
- call `books()` after every money operation in sections P, IN and 3c.

**C10. Fix.** Have `run-tests.sh` refuse a non-default `CBOB_CACHE`, as it does `CBOB_TEST_FILE`, or pass the wrapper path through an env var the suite reads.

## Document fixes, with the holder-facing ones first

1. **HOLDER-GUIDE:38 and :129-131 (A1).** Say that the validator producing the last of those blocks can pick among several results, enough to choose the level of a vault created in the same moment, within the levels still left, and that nobody else can. Change SPEC 26 from "bias" to "choose among many draws". Also fix DESIGN:89 and MINT:163-166.
2. **HOLDER-GUIDE:137-138 (A3).** Either Gary rules that the redeem page sweeps at execution time (round-23 F1 helper), or the guide says someone willing to keep paying fees can keep delaying an opening, with nothing lost. Fix the rent figure at SPEC:820.
3. **SPEC 46 and HOLDER-GUIDE (A2).** The hot wallet can stop every claim, which leaves no vaults and so no votes or sales ever. It can also admit only Proofs of Burn it holds and so control every vote. Put it in the honest list; it is tagged BUYER-FACING. Whether to hold the Moments update authority cold or in a multisig through the window is Gary's call. Optional arm: keep `ORACLE_NO` through the close and show `create_proposal` is impossible and `mint_vault` refuses `NoRound`.
4. **HOLDER-GUIDE:85-86 and SPEC:1363-1365 (D1).** A vote that moves the terms against you before your boost lands refuses it and burns nothing. A move in your favour lands.
5. **HOLDER-GUIDE:27 (D2).** Add "unless Gary Club holds your wallet's key", or point to limit 41. **HOLDER-GUIDE:44-46 (D3):** one line on the swap operator.
6. **Not holder-facing:**
   - SPEC 47 (A4) and SPEC 28 / REDEEMING (D4);
   - SPEC:1617-1619 and DESIGN §10 (D5);
   - D6 and D7 as listed;
   - item 50 gains the three client obligations, item 52 gains the empty-tick dependency (D8);
   - FREEZE's "5 host" (D9);
   - the SEAL:105-107 comment (A6);
   - one line in limit 40 naming the reveal-queue and redemption consequences (A5).

**Rejected-but-measurable claims to pin (ship gate 5):**
- an asset owner's `AddExternalPluginAdapterV1` (an Oracle with update `CAN_REJECT`) on a vault is refused `NoApprovals` (A5, W3);
- `Brakes{guardian: Some(default)}` leaves the same state as `None` (W4);
- a v0 redemption with an address lookup table lands (W5);
- `[distribute, boost]` ends at e + 1 + N (W10);
- `activate` with its own record in the crank list is refused `NotRevealed` (W14).

**Verdict: NOT CLEAN.** No program defect survived measurement, and no finding is CRITICAL or HIGH. It is not clean because:
- **Holder-facing sentences are false:** A1 and A3; D2 for custodial holders; D1 in the harmless direction.
- **The hot wallet's consequence is understated and missing from the guide** (A2).
- **The round-23 evidence repairs are incomplete** (C1-C5).

The two-round counter stays at 0 of 2.
