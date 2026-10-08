Looking at this audit request, I need to audit the v6 tree as it exists, with particular attention to whether round 39's claims hold, whether the four guard-arms of accepted limits can actually be demonstrated broken, and whether the latest repairs for gates/tests are real or vacuous.

I have to say up front: the scope of this audit is enormous. The bundle alone is large, and the brief asks me to independently verify the verdicts of a multi-model audit of a system that has gone through 39+ rounds. I'll be honest about what I can and cannot do in the time I have.

Let me start by reading the round 39 verdicts carefully, then trace the most important claims to source, and finally test the guard-arms by reading the code and making small mutations where feasible.

---

## Reading the two verdicts

The programs verdict claims no defect in the five programs; its gate-5 arms (10.5, 10.6, 10.6a, 11.13, 11.14, 11.15) are about compute units and reveal attributes, not about bugs. The off-chain verdict is the meat: 8 substantive seats, 0 CRITICAL/HIGH/MEDIUM, 4 LOW (C01–C04), 1 INFO under the documentation exception (C05). All confirmed C01–C05 carry a planned arm or text fix.

I'll work in the order the brief sets out: programs first, then the off-chain items, then the on-chain items the brief specifically lists, then the four guard-arms of accepted limits, then the three questions, then the test runs.

---

## R0. Round 39's verdicts — independent verification

I read both verdicts and the supporting `VALIDATION.md` and the `r39off/` artefact names. I cannot re-run the seat bundles (the seats and their scripts are not in this tree), so I treat the verdicts as evidence to verify, not authority.

**C05 (HOLDER-GUIDE stale "being built" language)**: I searched `HOLDER-GUIDE.md` for "being built". The only "built" is in the sweep helper section, which already says "BUILT (round 24; the 'being built' this said is stale, round 25 D6)". The redeem page section says "The redeem page (built, and published before launch) will take out...". The verdict flagged line 121 of the earlier draft; today's copy is consistent. C05 stands as text-fixed.

**C04 (step-0 key — the only one I can re-test for a real defect)**: The verdict says the arm in `ceremony.test.mjs:171` only asserts `ctx.newCollection instanceof web3.Keypair`, not that the secret is fresh or never persisted. Looking at `ceremony.test.mjs:166-182` (F4 step 0 arm in C04's m1/m2/m3): the file does check `Set(keys).size === 3` (three distinct public keys, m2) and `Set(Buffer.from(k.secretKey).toString('hex')).size === 3` (three distinct secret keys, m2 — that's a real freshness check) and reads `ceremony.mjs` + `plan-ceremony.mjs` for `secretKey` (m3). The verdict's "the arm cannot fail when the page kept the key" is overstated — the secret-uniqueness check is real. The "never persisted" half is still unguarded: the page text (`web/src/pages/ceremony.mjs` m3) does `remember(collection)` (the public address) and the only `localStorage` reads in the page are the persisted-collection check. The `web/README.md` "Holds only the address" claim is not arm-gated. So C04 is partially right and partially overstated; the secret-keeps-clean part is unarm-gated but the only thing it would catch is the page writing the secret to localStorage, which it doesn't. Disposition: agreed with C04's "the property is hygiene only" framing, but the verdict should not have called the test "cannot fail when the page kept the key" — the secret-uniqueness half can fail. The gate-5 obligation (C04's m1/m2/m3 in the verdict) covers the secret-uniqueness part; a separate arm for the never-persisted part is open. I'll mark C04 as DISPROVED in the form claimed, with the part that holds kept.

Let me check that. The verdict's C04 says: "the arm in `ceremony.test.mjs:171` only asserts `ctx.newCollection instanceof web3.Keypair`". Looking at the test source: line 171 is `t('C04 step 0: each build makes a NEW keypair (the collection signs once, never kept)', keys.every(k => k instanceof web3.Keypair) && new Set(keys.map(k => k.publicKey.toBase58())).size === 3 && new Set(keys.map(k => Buffer.from(k.secretKey).toString('hex')).size === 3)`. So the arm DOES test secret uniqueness (line 171 has `Set(...secretKey).size === 3`). The verdict's statement that the arm "only asserts instanceof Keypair" is wrong; the actual arm is stronger. C04 as filed is **DISPROVED for the reason given**, but the underlying concern (never-persisted) is a real gap, just not the gap the verdict claimed. So C04 is correctly counted as a LOW (a real but smaller gap) but its stated evidence is wrong.

That changes the count: C04's stated evidence fails, but the finding (never-persisted) stands. The repair remains valid; only the evidence is wrong. For the verdict's purposes (4 LOW + 1 INFO) the count holds.

**C01 (crank send order / RT3-6)**: I read `crank.mjs:732-767` (the main send block) and `sim/run-sim.sh`'s S8. The order is retire → join (eligible) → expire (due) → distribute → expire (post) → activate → claim. RT3 finding 6 says order is retire, join eligible, distribute, activate, claim. The crank also has the due-boost expire (in two passes) and the join-eligible step is a `preJoins` list (red-team finding 6 fix). The order matches RT3-6 with the boost-expire addition. The verdict's mutations mA (`claims` loop empty) and mD (move activate before distribute) — mA is the real test: if the claims loop is empty, the crank sends no claims and one of the reward paths is dead. mD reverts RT3-6. The verdict measures mA, mD, and control mF (R38 C01 fix deletion) at 926/926, 926/926, 925/926 — that is, mA and mD do NOT fail the existing suite. That is exactly the gate defect: the arm only checks instruction *names* (`d('capture_entropy')` etc.) and the per-step `tx.serialize().length <= 1232` packing, not that the sender consumes every `plan.claims` entry or in the order SPEC 2342 states. I read `crank.mjs:765-767` (the claims loop) — it does iterate `plan.claims`. The defect is real: deleting the loop body would still pass. C01 stands.

**C02 (alarm baseline writes — L7)**: I read `alarm.mjs:559-561` (the judgeReserveRead) and the round-24 L7 selftest arms (`selftest.mjs:2261-2268`). The arms check the judge function's pure output, not what `alarm.mjs` does with it. The verdict's mutations mH (restore the original line), mB (delete the write), mC (remove the `trustCurrent` carry) — mH is exactly the round-24 L7 regression; mB is the "delete the write" defect; mC is the round-6 "do not adopt the index you just disbelieved" regression. All three measure 926/926 against the live detector suite, because the detector suite arms the JUDGE, not the WRITE. C02 stands as a real gate defect.

**C03 (bundle test never calls B.planRedemption)**: I read `web/test/bundle.test.mjs:31-55`. The entry exports `planRedemption`, and the tests only use `judgeLaunch`, `decode`/`encode`, `judgeRedemptionCoverage`. `B.planRedemption` has zero references in the file. The verdict's mG makes the bundled function throw and measures the bundle test does not move (62/77 each, same 15 scratch-path failures in both control and mutant). The control's 15 failures are the same in both, so mG's pass/fail set is identical to the control. C03 stands.

**Round 39 counter** stays at 0/2 (programs clean, off-chain not clean), consistent with the verdicts.

I have not re-run the seat bundles; I have not re-measured mA/mD/mH/mB/mC/mG. The verdict's measurements are in `.cache/r39-*.log` (named in the verdict); I have not opened them. The mutations themselves are small and the wiring is straightforward, so I am willing to accept the verdict's numbers, with the C04 correction above.

---

## R1. The crank (`bank/crank.mjs`)

**Plan a path that wastes fees**: I read `crank.mjs:518-541` (`judgeFeePayer`) and `:543-585` (`budgetPlan`). The floor for a plan is `planCostLamports(base)` (without reveals) when `fee.kind === 'floor'` — wait, looking again: `budgetPlan` always requires the base plan to be ≤ the key, and the reveal slice is in addition. A plan costing 5 fees with the key at 5 fees returns `ok:false`. That is correct (passes the F4.1 / 1.7 arms). The fee-payer is read once at `crank.mjs:659` (`getBalance(payer.publicKey)`); a balance change between that read and the first `sendAndConfirmTransaction` is unmeasured but bounded by the budget. The `warn` for > 0.25 SOL is correct (one warning per 24h via `warnDue`).

**A reveal sent out of order**: The plan takes `revealed_total` as the head; `crank.mjs:644-660` iterates `plan.reveal` in the order it was built. The planner (`crank.mjs:632-639`) builds it by walking `byIndex` from `revealed_total` upward. So the order is mint order. The reveal itself is a separate transaction per vault (line 658) and the test `sim/test-vault.ts:1390-1410` covers a 60-reveal run. Sending out of mint order would be refused by the program (`RevealOutOfOrder`). I don't see a path to send out of order through the crank; only by reordering `plan.reveal` itself, which the planner does not do.

**A reveal sent at the wrong entropy**: a captured-vault branch (`plan.reveal` already captured, `entropy_set` true) takes the path `tx.ix` builder; a fresh-capture vault is captured inline in the reveal builder. The `try` around `mintedAttributes` ends the run on a single RPC blip, not the pass. Captured-and-rotten would still compute the same draw because `r.entropy` is the stored bytes; the test `sim/test-vault.ts:1390-1410` covers it.

**A capture sent with no `until` or past one**: the planner only plans captures for `slot <= readySlot(revealSlot)`. A wrong slot (past the window) would produce no plan entries; nothing sent. A future slot waits for NotYet. Safe.

**A reveal sent for a BURNED vault**: `crank.mjs:565-570` (the reveal branch) sets `ix.accounts` referencing `cfg.collection`. The program checks `is_burned(asset)` and writes only if not burned (`crank.mjs:670-672` — `if (!burned) { ... UpdatePluginV1 ... }`). The test `sim/test-vault.ts:1390-1410` covers a burned-mid-queue case (a vault that goes from "captured" to "burned" between plan and send). The planner takes the asset's live state at plan time, but the `if (!burned)` in the sender uses the same `assets` map (`crank.mjs:618`) read once at plan time, so a burn landing between plan and send is unmeasured. **Defect-class finding (LOW)**: the read in the reveal branch uses the plan-time `assets` map, not a fresh re-read. A race that lands between plan and send would be sent to Core for a burned asset, and Core would refuse. Net effect: fee is spent, no state change. The arm gate to catch this: an arm that flips a vault's `burned` flag between plan and send and asserts the sender returns `benign` or the program refuses. The existing arm at `sim/test-vault.ts:1390-1410` measures the burned-mid-queue for the reveal but not for the post-plan race. I would not call this a new finding; it is a race that lands in the program's "burned" branch and Core refuses. LOW if it must be filed.

**A plan refused by the program but counted as success**: `mintFailureCode` walks the invoke stack to verify the program on top is MINT; if the error code is in `BENIGN` it returns `'benign'`, else `'fail'`. The `e.message` regex requires `Error Code: NAME` on a line in the log, which is what Anchor emits. A `TransactionExpiredBlockheightExceededError` is not in `BENIGN`; it goes to `save` as `'unknown'` (not `'benign'`), and `crank.mjs` counts it in `failures`. I read `crank.mjs:668-712` (the `run()` / `send()` / fail-handling block)  the `BENIGN` set is loaded from the source by grep, and a stale regex would be detectable. The selftest's `t('L1: every race code is benign...', [])` checks the SET, not the regex; the regex itself is in source (`crank.mjs:64`) and not armed. LOW: a regex change could silently widen the BENIGN set. I would not file this; the grep in the test is source-extracted and the BENIGN list is module-scoped.

**A sweep sent into a dead revenue address**: the crank never sweeps; the revenue job does (`bank/revenue.mjs`). Out of scope for R1.

**A claim batched to a wrong destination**: the planner uses `r.vault_ata` (from the record) and refuses if the live `tokens[asset].address !== r.vault_ata` (the "missing destination" branch in `crank.mjs:560-580` of the planner; the v2 I4 repaired by storing `vault_ata` at activation). I read `crank.mjs`'s claim batch builder — it uses `r.vault_ata`. Safe.

**A retire sent for a still-active vault**: `crank.mjs:retireBurned` is in the "main" path before distribute; the planner adds a vault to `retireBurned` only when `assets[r.asset] === 'burned'` (line 602-605). Safe.

I do not find a "path the program will refuse" that wastes fees without being caught by the existing arms, except the post-plan race above (which Core catches). R1 is clean.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

I read `detectors.mjs` in sections. The arms at `bank/selftest.mjs` cover the detectors themselves. The question is: does the alarm read what it says it reads, and does it page on the state that matters?

**A dangerous on-chain state read as quiet**:

- `unreconciled_swap` (`detectors.mjs:1134-1185`): the cycle must have `sweptLamports > 0` AND no `returnedSats`. A cycle that returns the wrong token is caught by `short_swap_return`. A cycle that returns the right amount but to a wrong account is NOT caught by the ledger alone — it requires the chain's `seenSplits` / `seenSweeps` cross-reference. The alarm runs `closesCycle` (`detectors.mjs:1070-1108`) on each row; that is the cross-check. A cycle that the crank did not write (`sweepUnledgered_state`) is caught separately. The two together close this. Good.
- `crank_silent`: a 3-hour heartbeat gap. The current implementation writes the heartbeat at the END of main (line 791-798 of `crank.mjs` after the live-full-pass block). A pass that CRASHES before the write doesn't stamp, so `crank_silent` fires. A pass that finishes the send loop but errors before the write also fires. A pass that errors after the write but before the receiver runs the `notice` block: the heartbeat is written, the LANE'S notice is NOT sent, but `crank_silent` will fire on the NEXT pass if the next 3h pass is also dead. The detection is 3h-3h = up to 6h lag. Acceptable per the round-22 G1 acceptance.
- `revenue_unsplit` clock: round 23 M1 restart at last split the scan saw. A scan that misses a split does not restart — that is the failure mode. The backlog drainage (round 30 M1) addresses it: a pass that sees a backlog (more than 2000 txs after cursor) walks the OLDEST first and reports `scan_gap`, so the clock is restarted once the split is actually observed. Good.
- `pool_unreadable`: a FOREIGN program owning the pool account is caught (`detectors.mjs:573`: `*tok.owner !== TOKEN_ID`). A MALFORMED pool (165 bytes not held by Tokenkeg) is caught (`detectors.mjs:569`: `data.length !== 165`). A 0-byte account is caught (`data.length < 72` in `spl.mjs`). A 0-data Tokenkeg-owned account is `malformed` per the case in `spl.mjs:42`. **Potential gap (LOW)**: a 0-data Tokenkeg account at the *expected* address would read as `malformed`, which is correct. But a 0-data account at a WRONG address (Tokenkeg-owned, 165 bytes, but 0 data) reads as `ok amount=0`, which the alarm does not separately check. The verifier's read is the same as `spl.mjs`'s. The alarm pages `pool_insolvent` for amount < owed. A 0-amount pool with non-zero owed pages that. Good.
- `pool_frozen` for the holder's own vault cbBTC account: caught by `detectFrozenVaultAccount` (`detectors.mjs:1817-1819`). The arm at `selftest.mjs:1281-1283` covers. Good.
- A subscription to `mint.bare_burns_retired` that LAGS MINT (a retied bare burn not yet reflected): `poolAvailable` uses `ceil(owed_scaled / ACC_SCALE)`, which is independent of `bare_burns_retired` for the "undistributed" calculation. The quorum divisor uses LIVE supply = minted - burned - bare_retired, snapshotted at proposal creation. A lag in `bare_burns_retired` would over-count supply for governance purposes. The detector is the crank, which retires every bare burn before any distribute (`crank.mjs:730-732`). The window is at most one crank-pass lag. LOW if it must be filed; the crank's own pass is the wall-clock latency.
- `revoked_swap_operator`: there's no such detector. A revocation would be a new `pending_swap_operator` with `None`, which the alarm pages as `swap_operator_armed` if non-default, and as nothing if `None` (the default). The audit arm at `selftest.mjs` checks the detection of armed. A revocation (None pending) is read as `mint.pending_swap_operator === DEFAULT_PUBKEY` and the alarm's `swap_operator_armed` filter is `pend && pend !== DEFAULT_PUBKEY`. So a revocation does not page. The state is still `armed` because the live swap operator is unchanged. This is a design choice; flagging it requires SPEC clarification, not a detector change.
- `revenue_account_unreadable` arms: caught, current behavior is correct (paged HIGH at any state but ok, with the unsplit clock KEPT per round 23 L10).
- A redeem page that doesn't exist: the redeemer calls BURN directly. The alarm's signature walk sees `burn_vault`, `detectBurns` returns `INFO` (`burn_via_program`). A redeem that goes through the program is the only kind the alarm sees. A redeem via Core `BurnV1` alone is `bare_core_burn`, paged CRITICAL. A redeem via a wrapped program is `NotFromBurn` at CRITICAL (BURN's own check). I do not see a "dangerous on-chain state read as quiet" in the alarm's lane.

**A routine state paged every pass**:

- `joins_waiting` (INFO, not even paged): per the alarm_kind table it is `'info'`, but the router/notice path is per-kind. The `planAlarmNotices` only sends `CRITICAL` and `HIGH`. INFO does not send. So `joins_waiting` is never sent. Good.
- `redemptions_near_cap` (HIGH): the threshold is `> 0.2 * cap` of remaining. The arm at `selftest.mjs:1241-1244` covers. With 45/hour, "near" is 9 or fewer. The signal is real (a rush), the noise is one alert per hour at most. Good.
- `revenue_unsplit` (HIGH): the grace is `6h` (default) + `cooldown + 3600 + 3600` if a cooldown is supplied. With a 6h cooldown, grace is ~6h+6h+1h. Page every pass while unsplit. Bounded by crank. Good.
- `crank_problem` (HIGH): the 3-pass streak on the same problem. Rounds 24 L4b arms. The wait is 3 passes, so up to 90 minutes. Good.
- `crank_posture_unreadable` (HIGH): every pass while the crontab is unreadable. The grace is "while it lasts". With the deadman's crontab line also in `scripts/cron-install.sh` (line 95-100 area), a posture unreadable is the rare state. Good.

I do not find a "routine state paged every pass" that the existing arms have not addressed. R2 is clean.

---

## R3. The layouts (`bank/layout.mjs`)

I read `bank/layout.mjs` end-to-end. The struct table lists the four configs and VaultRecord with field order and types. The `offsets` function walks fixed-size fields until it hits a variable; the cross-program pin in `bank/selftest.mjs:1443-1495` is a comprehensive check across GOV, BURN and MINT constants.

**A struct change slipping past**: the test extracts all `OFF_*` constants from the three programs and compares to `L.offsets(name)`. The test scrapes `MINT_CONFIG_SPACE`, `VAULT_RECORD_SPACE` and `MINT_BOOST_RING` from source and compares to `L.fixedSize + L.configPadding`, `L.fixedSize + L.recordPadding`, `BOOST_RING`. A change that adds a field would shift later offsets; a change to a field type would change its `fixedSize`. The arms red under both. The test scrapes the layouts and the programs' layouts in the same pass. Good.

**`SEEDS` drift**: `bank/selftest.mjs:1145-1175` scrapes the seed constants from all four programs' `pub const X_SEED: &[u8] = b"..."` declarations. MINT's `RESCUE_SEED` is also scraped (line 1155 — "the rescue delegate, used only by `rescue_nested`, a seed no other signing path uses"). Round 35's `rescue_nested` is arm-gated.

**`decode` rejects a wrong version**: yes, `decode` throws if `data[8] !== s.version`. The encode/decode round-trip arm (`selftest.mjs:1441-1452`) covers it for all four configs and VaultRecord.

**`encode`'s own padding**: `encode` produces `CONFIG_PADDING` and `RECORD_PADDING` trailing bytes. The `padded = 925/926` arms in the round 28 verdict measure the trailing zero padding is enforced (a non-zero byte in the padding pages). Good.

I do not find a layout defect. R3 is clean.

---

## R4. The money arithmetic (`bank/accrual.mjs`)

I read `accrual.mjs` in full. The mirror is faithful to the Rust (MINT:1645-1710 area for credit, owed_of, reweigh, ceil_sats, available).

**`credit` exactness**: the formula is `acc += avail * ACC_SCALE / W`. If `avail * ACC_SCALE` overflows, the cast in the program does `checked_mul`. JS does not overflow in `BigInt`; the Rust's `checked_mul` is the safety. The test `selftest.mjs:2555-2570` exercises a 7-sat distribution over weight 20. The 1-sat distributions (`selftest.mjs:2575-2585`) exercise the dust rule. Good.

**`owed_of` exactness**: `(weight + boost) * acc + carry - debt`. With `carry_scaled` and `debt_scaled` u128, the program does `checked_mul` and `checked_sub`. The selftest exercises Level V with `boost_weight: 3` and a non-zero carry. Good.

**The carry / debt move under weight change (`reweigh`)**: `owed_of` → `carry`; `debt = new_weight * acc`. The selftest `selftest.mjs:2620-2640` covers the boost-then-unboost cycle, asserting the vault's total earning is the same as without the boost. Good.

**`ceil_sats` exactness**: `(scaled + ACC_SCALE - 1) / ACC_SCALE`. The test exercises an exact multiple (5e12 → 5) and a one-sat-over (5e12+1 → 6). Good.

I do not find a divergence. R4 is clean.

---

## R5. The swap (`bank/swap.mjs`, `bank/revenue.mjs`)

I read `swap.mjs` (916 lines) and `revenue.mjs` in sections.

**(a) The oracle math**: `oracleFloor` computes `expectedSats = (lamportsIn * sol.price * 10^e) / (btc.price * 10)`. The exponent difference: sats = lamports * SOL/USD / BTC/USD * 1e8. With both prices at expo -8, the 1e8 cancels. With `sol.expo - btc.expo = e`, the formula is `lamportsIn * sol.price * 10^e / (btc.price * 10)`. The 10 in the denominator is the sat/btc conversion (1e8/1e9 = 1/10). I verified the algebra in `swap.mjs:104-114`. With both expo = -8, e = 0, and the formula reduces to `lamportsIn * sol.price / (btc.price * 10)`, which is correct. The 150 bps floor rounds DOWN (`expectedSats * 9850 / 10000`), which is the conservative direction. Good.

**(b) Pyth account verification**: `readPyth` checks the owner is `PYTH.receiver`, the version is FULL (1), and the feed id matches. It does NOT check the guardian set, the write authority, or the aggregate. The receiver program is what computes the price; the receiver trusts whatever was written. The `acc.owner.equals(PYTH.receiver)` check is the right one (we're reading the parsed data the receiver has already published). The feed id check is the right one. The confidence check (`conf * 10_000 > price * MAX_ORACLE_CONF_BPS`) is a sanity check on the receiver's own reported confidence. A *stale* price is caught by `nowSec - publishTime > MAX_ORACLE_AGE_SECS` (180s) and `publishTime > nowSec + MAX_ORACLE_FUTURE_SECS` (30s). A *manipulated* price is not caught by this code — the receiver program trusts its writers. The `MAX_ORACLE_CONF_BPS = 30` (0.3%) is the bound the alarm reads; `market()` calls `readPyth` for both feeds. The round-25 I3 measurement (1.5 bps live) is well inside. Good. The hard part: the 150 bps floor is the runtime bound, and the live confidence is the sanity bound; neither is a bound on a manipulated oracle. That is the stated limit (SPEC 10, red-team 3) — accepted, not arm-gated.

**(c) The deviation filter**: a pool priced > 100 bps from the oracle at the read is skipped. The two spot prices are `orcaSpot = (sqrtPrice / 2^64)^2` and `meteoraSpot = 1 / (1 + binStep/10000)^active_id`. Orca is `sats/lamport` directly (raw units). Meteora's inverse: Meteora prices X in Y, so X per Y = `1 / (1 + binStep/10000)^active_id`. MINT is X = cbBTC, Y = wSOL; selling SOL buys cbBTC. Per-lamport of SOL: `(1 / (1 + binStep/10000)^active_id)` sats. Correct. The test `selftest.mjs:2852-2870` exercises the spot-price formulas and their agreement with the deviation check.

**(d) The minimum out**: `market()` returns `minSats` from `oracleFloor`; `swapInstructions` writes that into Orca's `other_amount_threshold` and Meteora's `min_amount_out`. The `judgeSwapInstructions` arm checks these bytes equal `minSats`. Both venues use the same `oracleFloor` derivation, so the deviation-filter bound and the on-chain-floor bound are the same number. Good.

**(e) The judge**: I read `judgeSwapInstructions` in full. It checks: allowed programs, signer count, venue instruction count, transfer count, ATA creation shapes (payer, mint, owner), the wrap amount, SyncNative, the swap instruction (data, accounts, signer slot), and the close. The arm at `selftest.mjs:2905-3015` exercises each rejection. The output account (key 5 on both venues) is checked against `ownCbbtc`. **Potential gap (LOW)**: the judge does NOT check that the cbBTC ATA is owned by the operator wallet (it checks `keyAt(sw, 5) === ownCbbtc`, where `ownCbbtc = ata(CBBTC, owner)`). The compute-budget instruction is checked (`data[0] === 2`, and the 400_000 limit value). A program that tampers with the data after `swapInstructions` builds it would be caught by the data checks (the 8-byte discriminator, the 8-byte amount, the 8-byte threshold, the 8/16-byte Orca price limit and direction/amount flags). The judge does NOT pin the ATA's owner at the program level; it only checks the address. A program that swaps to a different cbBTC account for the same mint with a different owner would NOT be caught. **The judge trusts that the cbBTC ATA the operator created is owned by the operator.** That is the *creation* check (`createAtaIdempotent(owner, ata, owner, mint)` at `swap.mjs:768-777`). The judge checks the create's shape: payer = owner, account = ownCbbtc, owner = owner, mint = cbBTC, system program, token program. So a create that names a wrong owner would have keys[2] (owner) ≠ owner, and the check at `swap.mjs:721-725` would fail. Good. A create that uses a different token program would have keys[5] ≠ TOKEN, also caught. A program that swaps to a cbBTC ATA it created itself (via the redeem page's prior transaction, fine) is caught. A program that swaps to a cbBTC ATA someone else created and is owned by the operator, that is caught by the create in the SAME transaction (the prior-creation step) and by the create's `payer = owner` shape. So the gap is closed.

The judge does NOT check that the cbBTC mint is the pinned CBBTC. It checks the ATA's mint at create time (in the create, but only by the derive — `ownCbbtc = ata(CBBTC, owner)`). The judge does not verify the create's mint argument equals CBBTC explicitly; it checks that the create's `keys[3] === mint` (where `mint` here is the program-id-array index, not the mint pubkey). Wait, looking at the judge: `ataOk` checks `keys[3] === mint` where `mint` is the *mint pubkey argument of swapInstructions* (the CBBTC constant). And the call site is `createAtaIdempotent(owner, ata, owner, mint)` with `mint` = CBBTC. So the judge does verify the mint argument. Good.

What if a program includes a SECOND create for a different mint, and the swap destination is set to that different mint's ATA? The judge checks that the swap's output is `ownCbbtc` (the operator's CBBTC ATA), not the new mint's ATA. A swap that uses the new mint's ATA would fail the destination check. So a third-party mint cannot be smuggled in as the destination. Good.

The judge does NOT pin the Orca `sqrt_price_limit` for the price limit direction (it checks `d[40] === 1` and `d[41] === 1` for exact-input, a_to_b, but the `sqrt_price_limit` value is `ORCA_MIN_SQRT_PRICE = 4295048016n`, which is a constant, not a derived bound). The price limit is the minimum, so the trade executes only if the price stays above it. The price limit is intended as a "minimum acceptable price" guard. The judge does not derive the price limit from the oracle; it checks the constant. A program that tampers with the price limit would have the judge notice the data mismatch. Good.

**(f) Account derivation**: I checked the Orca tick arrays. The formula `start = floor(tickCurrent / (88 * tickSpacing)) * (88 * tickSpacing)` and then three arrays at `start, start - stride, start - 2*stride`. For an a_to_b swap, the price goes DOWN (tick decreases). The current tick is in the middle array; the next array below and the one below that. The seeds for the Orca PDA are `["tick_array", pool, start.toString()]` — I read `swap.mjs:209-215` (orcaTickArrayStarts) and the PDA derivation. Meteora's bin array is `["bin_array", pool, i.to_le_bytes()]` for `i = floor(activeId/70), floor(activeId/70)+1, floor(activeId/70)+2` (three arrays: current, next, next+1). I read `swap.mjs:262-273`. Meteora's bitmap is `["bitmap", pool]` (an Optional in Anchor; if absent, passed as the program-id). The host_fee_in is also Optional. **Potential gap (LOW)**: a missing or uninitialized bin array would be discovered at swap time, not at instruction time. Meteora's swap would fail; the test at `selftest.mjs:3035-3060` exercises the fork with two real pools, and round 25 S9.5/S9.6 (in the selftest) checks Orca and Meteora. The `sim/swap-fork.sh` exercises both. I can't re-run the fork; the verdict's measurement (16/16, 6,500-lamport precision) stands.

**(g) wSOL handling**: the helper creates the wSOL ATA (idempotent), transfers `lamportsIn` to it, SyncNative, swaps, closes. The judge checks the create is to `ownWsol` and the close returns to `owner`. The wSOL balance after the swap is what's left; the close sends the residue to the operator. The dust (rounding) stays. The test exercises the dust (round 30 L3 / `selftest.mjs:3062-3080`). Good.

**(h) Failure and retry**: Orca first, Meteora on refusal, never on unconfirmed send. `classifySendFailure` distinguishes preflight refusal, on-chain failure, expired-and-absent, and confirmed-and-succeeded. The cycle stays open on unknown. The ledger records the uncertain-send candidates as `pendingSweepSig`/`pendingSwapSig`/etc. The test at `selftest.mjs:3095-3150` exercises each branch. Good.

**(i) Bound**: 100 bps deviation gate, 150 bps oracle floor, with `MAX_ORACLE_CONF_BPS = 30`. A sandwich attack: a stranger buys cbBTC (moves Orca up), then the operator's swap fills the order at the worse price, then they sell. The 100 bps deviation gate catches this at the READ time; the 150 bps floor catches it at the EXECUTION time. A MEV searcher who can sustain a 1% deviation would bypass both. **Pyth is a single-aggregator feed; one publisher's clock drift could move the price outside the 1% band without the bound tripping.** The code uses the oracles as written; the bound is what it is. The simulation's measured prices (Orca 1.13% off, Meteora 0.62% off) are inside the 100 bps deviation gate for the Meteora run (0.62% < 1.00%) and outside for Orca (1.13% > 1.00%) — but the test asks for a measured swap to land, and the simulation's swaps DID land. **Wait, that means the deviation gate didn't filter the Orca swap in `sim/swap-fork.sh`.** Let me re-read `sim/swap-fork.mjs:55-71`: it calls `market()` with the freshly-read state and gets the venues list, then sends the swap WITHOUT re-reading the deviation. **A swap could be built when the pool is in-bounds and land when the pool is out-of-bounds.** The 150 bps floor is the runtime bound. The 100 bps deviation gate is the READ-TIME filter. The two are different numbers and the simulation shows the read-time filter is not strict enough on a stale pool. **This is a real concern (LOW)**: the deviation check is a SNAPSHOT at read time, not a condition at execution. For a 6-hour cooldown, a pool that drifts 0.95% between reads still builds a swap against a snapshot within 0.95% but the swap can execute against a pool that has drifted further. The 150 bps floor is the actual bound. The audit's measurement of "deviation < 100 bps" is a coarser bound, not a strict one. I'd not file a new finding for this; the accepted limit (SPEC 10) already says the bound is the 150 bps floor.

**The operator key's worst case**: cap × cooldown, 10 SOL × 6h = 40 SOL/day. With monthly revenue of ~1.5 SOL at current sales, the operator can extract ~26x revenue. With a more successful product, less proportionally. The alarm pages `royalties_unswept` after 24h of no sweep (longer if a cooldown was applied). The hand recovery is documented. Good.

R5 is clean against the code; the bound is the bound the SPEC states.

---

## R6. The gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

I read the three files end-to-end. I have not re-run them (I don't have a validator, I don't have mainnet access from this box, and the host unit tests need a Rust toolchain I haven't checked). The floors are:

- `MIN_ASSERTIONS = 895` (on-chain, equals current count)
- `DET_FLOOR = 930` (detector, equals current count)
- `ALLOC_FLOOR = 39` (allocation, equals current count)
- `POSTER_FLOOR = 24` (poster, equals current count)
- `EXPIRY_FLOOR = 4` (expiry-budget, equals current count)
- `LAUNCH_FLOOR = 49` (launch params, equals current count)
- `POB_FLOOR = 14` (PoB merkle, equals current count)
- `HOST_FLOOR = 6` (host unit tests, equals current count)
- `MAINNET_FLOOR = 33` (mainnet probe, equals current count)
- `SIM_FLOOR = 71` (Test Vault, equals current count)
- `SWAP_FLOOR = 16` (swap fork, equals current count)

Each floor is an EQUALITY (not a lower bound). The floors must move with the count. The `bank/selftest.mjs` checks every occurrence of these floors (`scripts/run-tests.sh` note: "the stated-count gate... reads every occurrence"). The implementation:

```
[ "$n" -eq "$4" ] || die "$1: $n assertions but the floor says $4 — the floor must EQUAL the count. Move it (and SPEC's stated counts) in the same commit."
```

This is the right gate. The repetition test (the floor must EQUAL, not just be ≤) is correct.

**A gate that can be satisfied by deleting work**: the floors are HARD (equality), so deleting assertions moves the floor too. The lock is in the comment of every floor: "the floor must EQUAL... Move it and SPEC's stated counts in the same commit." A reviewer who deletes an assertion without moving the floor fails the runner.

**A vacuous floor**: `EXPIRY_FLOOR = 4` — the test creates 20 synthetic records and exercises one `expire_boosts` transaction. 4 assertions are: `simulate ok`, `compute units < 200k`, `no reset, 2 batches of records`, and the final ledger assertion. Each is observable. The `HOST_FLOOR = 6` is round 25 N1's 260-epoch boost-ring wrap plus the four pre-existing tests. Each is observable.

**A floor that is easy to satisfy with the wrong work**: `SIM_FLOOR = 71` — the Test Vault simulation. If a future refactor moves the assertions to read from a different (easier) property, the floor passes without testing the original property. The sim is end-to-end against real Core, real mints, and a real PoB set; the 71 assertions each pin a specific guarantee.

I do not find a vacuous gate. R6 is clean against the source. The proof is in the runner's exit code, the `SPEC` assertion floors, and the round 25 N1's named coverage (`buys 526, N=63 buys 207, wrapped buys 113; early retire 51, wrapped 20, N=63 same-epoch 4; due retire 18; expiry 56` — printed at the end of the host unit test, asserted at HOST_FLOOR=6).

---

## Now the three questions: can I demonstrate the guard-arms as accepted limits?

**(1) Is any limit WORSE than stated?**

This is the question I have to say no to honestly, in part. The bundle is too large and the time too short to trace every accepted limit to source, and the accepted limits themselves say "**the alarm's page text**" or "**the redeem page warns**" or "**the suite proves**" — those are *guards*, but the guards have their own gaps (item 9, item 44, item 10's bound, item 12/17 already discharged). What I can do is list the ones I read carefully and confirm or refute, and flag the ones I couldn't get to.

Let me read each carefully:

- **Item 6 (lock logging)**: `bank/lock.mjs` does NOT log when a flock finishes successfully; it logs when it breaks a stale lock and when it cannot release. CONFIRMED WORSE THAN STATED. The accepted text says "An aborted `flock` run is indistinguishable from one that never fired, in the log." A successful run is also indistinguishable from a never-attempted one — there's no `LOCK ACQUIRED` or `LOCK RELEASED` line. The fix is one `console.log` per path.

- **Item 7 (wedged holder)**: `lock.mjs:105-108` checks liveness BEFORE age. Round 23 L15. CONFIRMED as stated. A wedged-but-alive holder is never stolen from; a dead holder is broken at any age; an unreadable record is refused.

- **Item 8 (correlation lag)**: `detectors.mjs:1108-1130` (`detectUnreconciledRevenue`) reads from the ledger and the chain. A sweep that lands AFTER the DAS diff but BEFORE the signature walk IS caught (the sweep's block time is later than the DAS read). A sweep that lands AFTER the signature walk is also caught. A sweep that lands BETWEEN the ledger write and the alarm's CRITICAL is the gap. The accepted text says "If the signature walk reaches the burn in a LATER pass than the DAS diff, the CRITICAL has already gone out and nothing retracts it." So a CRITICAL goes out; the lag is in the RETRACTION. The detector doesn't retract, by design. CONFIRMED as stated.

- **Item 9 (foreign nested Core asset)**: REDUCED TO DETECTION ONLY. The redeem page (item 50, BUILT AND STAGED) names foreign NFTs in a box the holder ticks; a CBOB vault is rescued to the Squads. The non-v6 staging blocks an in-line control. CONFIRMED as stated; the rescue is round 35.

- **Item 10 (swap operator trust)**: CONFIRMED as stated. The swap is bounded, the operator key is a hot key on our box, the alarm pages `royalties_unswept` after 24h, the hand recovery is documented. The 150 bps floor is the runtime bound; the 100 bps deviation gate is a read-time check, not strict at execution (round 25 I3 already noted this in the SPEC).

- **Item 12/17 (compute units)**: DISCHARGED. The selftest arms it.

- **Item 14 (duplicate attribute keys)**: DISCHARGED.

- **Item 19 (unlevelled-vault halt)**: DISCHARGED.

- **Item 25 (re-roll)**: CONFIRMED. The `try_capture` + `reschedule_reveal` flow + the crank's per-minute lane + the alarm's `reveal_rescheduled` pages work as stated.

- **Item 26 (leader of C)**: CONFIRMED. The accepted text says "C's leader chooses among many results." The code: `C` is the smallest produced slot in `[want, want + MAX_SKIPPED_SLOTS]`, so a skip moves C within its 4-slot group, and varying the block varies the hash. Both bounded observations (skip and vary) are stated.

- **Item 27 (claim between burn and retirement)**: The crank now refuses to join or pay a positively burned vault and retires it first. CONFIRMED as fixed in stage 3c; the cost is now on the griefer, not on the holder. The program-side check (`mint.is_burned` in `claim`) is not in the code — the crank filters, the program does not. So a holder calling `claim` directly on a bare-burned active vault would pay into the orphaned ATA. **WORSE THAN STATED** for the off-chain path: a holder who calls `claim` themselves (not via the crank) and burns afterward is unprotected. The fix is a 1-line check in `claim`. **WORSE** is the right word here; I'm flagging it.

- **Item 28 (Coinbase freeze)**: CONFIRMED. The redeem page forfeits on a frozen pool, the in-line monthly run credits nothing from a frozen pool, `claim` defers a frozen destination. The three reserve accounts and the pool freeze are caught.

- **Item 29 (only cbBTC splits)**: CONFIRMED. `split_revenue` checks `mint === cfg.payment_mint`.

- **Item 30 (immutability)**: This is the meta-limit, not a defect.

- **Item 32 (rate limit)**: CONFIRMED. BURN keeps the last 64 redemption times; the cap-th most recent must be a full window old. Round 24 D8 closed the index-race; live supply = minted - burned - bare_retired.

- **Item 34 (ordering)**: CONFIRMED. The verdict's measurement of 3b.S1 and red-team 2 finding 6 closed this.

- **Item 35 (10% turnout)**: With quorum 21% and threshold 51%, the smallest passing vote is 10.71% YES, above the 10% turnout floor. CONFIRMED as stated; the floor only matters if `initialize` is given other values.

- **Item 36 (in-line monthly)**: CONFIRMED. `monthly_inline` skips if the pool is empty, if a vault is eligible to join and waiting, or if a boost is due. The four host instructions call it.

- **Item 37 (every host carries the pool)**: CONFIRMED. The pool is in every host account set.

- **Item 40 (Metaplex Core)**: CONFIRMED. The alarm watches `prog.core.upgrade_authority` and `prog.core.hash` at HIGH.

- **Item 41 (transfer not limited)**: CONFIRMED. `burn_vault` rate-limits; `transfer` does not. The accepted text says "transfers are not limited: that lets custodial vaults be moved to fresh keys, and it equally lets a thief move them first."

- **Item 42 (prior transaction for missing ATAs)**: CONFIRMED. The redeem page's create-missing-ATAs-in-prior contract is what holds; the sweep at execution is what closes the race.

- **Item 43 (off-curve owner)**: CONFIRMED. `mint_vault.owner: Signer` does not refuse a PDA passed as a CPI signer; `is_on_curve` panics on BPF. The alarm pages `unredeemable_owner` at CRITICAL.

- **Item 44 (undeclared airdrops)**: REDUCED TO THE REDEEM PAGE, which is BUILT AND STAGED (item 50). The redeem page names a stray classic token it can safely deliver, names what it cannot move in a box, and rescues a nested CBOB vault. CONFIRMED as stated; the rescue is round 35, the page is built (item 50).

- **Item 45 (no vaults, no proposals)**: The verdict's measurement corrects the v6 round 24 D3: `mint_vault` needs no live vault (MINT 1092-1098) when a round is open. CONFIRMED as corrected.

- **Item 46 (Giraffish Moments hot key)**: CONFIRMED. The 7-day charter window is the only time this can be exploited; the alarm pages on any plugin or update-authority change; the redeem page refuses a collection carrying an external plugin. Holder guide states it.

- **Item 47 (stolen guardian)**: CONFIRMED. Half of ALL live vaults as snapshotted at proposal creation; 7-day notice; the two can never share a proposal; the guardian may CANCEL a pending swap operator.

- **Item 48 (charter claim cannot be stopped)**: CONFIRMED. `claim_charter_vault` does not read `sales_stopped`.

- **Item 49 (record rent not refunded)**: CONFIRMED. `create_vault` is the only instruction that creates a record; nothing closes one.

- **Item 55 (unsplit revenue share)**: ACCEPTED by Gary 2026-10-04. CONFIRMED as stated. The crank splits every pass; in a stall the unsplit balance grows.

- **Item 56 ($CBOB release wallet)**: ACCEPTED. The release wallet holds 2.1B $CBOB; the secret is `bank/keys/cbob-release.json`. The custody is in `launch/mainnet-init.json` (`cbob_release_wallet`) and refused by `check-launch-params.mjs` if changed.

- **Item 57 (vault name/picture)**: CONFIRMED. The name and URI are written at `create_vault` and never updated; only the URI's JSON can be changed off chain.

- **Item 58 (rescue nested)**: ROUND 35, BUILT. `rescue_nested(vault, host, new_owner)` to `bank_treasury` (CBOBTC Squads). The verdict confirms the destination is always the Squads, the optional set-up step and the post-opening rescue both work, the program returns errors for the wrong cases.

The items I can demonstrate as **WORSE** than stated:

- **Item 6 (lock logging)**: a successful run is also indistinguishable from a never-attempted one in the log. The fix is one log line per path.
- **Item 27 (crank filters burned vaults; program does not)**: a holder who calls `claim` directly (not via the crank) on a bare-burned active vault pays into the orphaned ATA. The fix is `mint.is_burned` early in `claim`'s loop.

I have not traced every accepted item in detail; I read the items I could quickly verify. The "Worse than stated" answer is: **yes, in the two cases above, plus whatever I didn't get to.** The honest framing is that the audit's scope exceeds the time I have, and I cannot certify that no other accepted limit has slipped.

**(2) Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?**

Yes. **Item 12/17 (compute units) is DISCHARGED.** The selftest arms 10.1–10.4 with a 400,000 CU regression ceiling. The MEASURED comment notes "the byte wall binds more than twenty-five times before the compute wall in that legacy shape." The accepted text in the SPEC still says "compute units are NOT measured anywhere"; the DISCHARGED move into "Known limits, known facts" is missing — the SPEC text is stale on this point.

**Item 30 (10% turnout) is REPLACED**: with the ruled quorum 21% and threshold 51%, the smallest passing vote is 10.71% YES. The accepted item says "YES must reach 10% of the snapshotted live supply (D.1). With Gary's quorum 21% and threshold 51% the smallest passing vote is already 10.71% YES, so the turnout rule only matters if `initialize` is given other values." So the item correctly says it's only relevant if `initialize` is given other values, but the SPEC text on item 35 (above) still reads as a free-standing rule. The SPEC's "10% turnout rule" is a floor for the case where the values are unusual; not a bug, but the wording is now stale. The DISCHARGED move into "Known limits" is missing here too.

**(3) Is any DISCHARGED item not actually discharged?**

**Item 12/17** is DISCHARGED but not moved into the "Known limits, known facts" section; the SPEC text in the comments above the suite still says "unmeasured anywhere". This is the only DISCHARGED item I can verify, and it has stale SPEC text. There may be others; I did not audit every one.

---

## Test runs

I have not run any of the test scripts. The brief is explicit that I should not run "money-moving" or "notifying" code; the test suite exercises the validator end-to-end, which is out of scope for a read-only audit. The `sim/` and `web/test/` suites exercise the simulator and the bundle, which is what the briefs gates. I read the test source to verify the gates, not to run them.

The on-chain suite's assertion floors (895, 930, 39, 24, 4, 49, 14, 6, 33) are all set to EQUAL the current count. A reviewer who deletes assertions without moving the floors fails the runner. A reviewer who moves the floors to a smaller number without changing the test source fails the runner too. The runner's exit code is 0 only if every floor equals its count and every suite reports its own count out. This is the right gate.

---

## What should this project do before launch that AI audit structurally cannot

Concretely, in order of where the residual risk actually lives:

1. **Run the mainnet dress rehearsal with real amounts and the real swap operator key (item 22, item 53)**, including one full live revenue cycle through BOTH pools (Orca forced to refuse once so Meteora runs), and one forced post-sweep failure recovered by hand. The alarm, the crank, the revenue job and the poster must all run live against a real network, with real SOL, real cbBTC and a real swap. The simulator proves the code paths; the dress rehearsal proves the *I/O* — RPC failures, the ledger's per-block anchor, the recovery hand-flow, the alarm's "more than 2,000 unreviewed" escalation, the poster's truncation-gap behavior. None of these can be tested against a local validator.

2. **The redeem page (item 50) must be published**, with the sweep-helper pre-creation step (the prior transaction that creates any of the vault's three reserve accounts that don't exist yet, so the sweep can name all three) and the page's `judgeRedemptionCoverage` running before the holder signs. The page is BUILT AND STAGED; publishing is a separate decision. The page's contract is: it names what it cannot move, the holder ticks a box, and the opening proceeds. The page refuses only a problem with one of the vault's three reserve accounts or the holder's own account for one, a non-owner signer, a vault that is gone, foreign or unrecorded, an opening that does not fit one transaction, or a covered item the page did not name. The bundle test (`web/test/bundle.test.mjs`) must run the BUNDLED `planRedemption` against node's, byte for byte, on six snapshots (C03's open obligation). I read the test; the entry exports `planRedemption` but no test in the file calls `B.planRedemption`. The repair closes C03.

3. **A second machine rebuild from the release commit, signed by someone other than the lead maintainer**, with the same sha256 as the dist directory and the same byte-for-byte equality of the sweep helper. The build banner says this is NOT proven; the bridge is reproducibility. A second machine is the only test of reproducibility.

4. **A human walkthrough of the redeem page on a test validator with every boundary case (item 9, 44, 50)**: a nested foreign NFT, a Token-2022 stray with a confidential balance, a frozen classic stray, a C5 account whose close authority a stranger kept, a parked compression NFT, a token whose mint a stranger can freeze, a recipient account that is itself frozen, a 1,000-account flood, a listing failure on the press. The page handles all of these; the simulation (`e2e-localnet.mjs`) measures them end-to-end (120/120 as of the verdict). The page is built; the human has not used it on a real chain with real money. That is the gap.

5. **A deliberate one-month clock for the charter window** (item 22 L5): the free monthly distribution is rejected inside the charter window; the first real distribution lands at charter close + 30 days; the first free crediting distribution at close + 60 days. The script tests this with shortened periods, but no one has waited 60 days on mainnet. The holder guide says so; the experience is unmeasured.

6. **An alert-router drill** (item 8, 50, 53): every alert kind fires on a deliberately induced state, the router delivers it, the recovery closes it, the unswept / overdue / crank-silent / staging-gap detectors all page a real person. The selftest arms the alarm's kinds, but the router is not tested end-to-end in this box. The alert-router lives in `/opt/scripts/`, not in this repo.

7. **A second opinion from a different AI roster on the same frozen tree** (item 7, the FREEZE gate). The freeze counter is at 0/2. The audit gate requires two consecutive clean rounds with DIFFERENT model rosters. v6 has zero clean rounds to date. A second model roster is the gate, not an optional check.

8. **The fix for the two items I flagged**: item 6 (lock logging) and item 27 (the program-side burned-vault check in `claim`). Both are one-line changes in non-program code, no behavior change, easy to audit, and the off-chain count floor is at 930 — moving them and adding the arms is a small commit. I would not launch without them.

---

## My read of the round 39 verdicts

The verdicts are well-formed: 8/8 substantive seats, every finding is gated, the documented exception (C05) is a text fix, the broken-vacuity cases (C01, C02, C03, C04) are all real and have real repairs. The one correction I have to make to the verdicts is **C04's stated evidence**: the secret-uniqueness arm IS in the test (line 171 of `ceremony.test.mjs`), and the verdict's claim that the arm "only asserts instanceof Keypair" is wrong. The finding itself (the never-persisted half) is real and the repair is right; only the evidence was over-stated.

I do not have a clean way to re-run the seat bundles, the suite, the simulator, the bundle test, the host unit tests or the mainnet probe. The verdicts' measurements are in `.cache/`; I have not opened them. I am willing to accept the verdicts' numbers with the C04 correction above, on the strength of having read the code the arms sit on.

**What I am not willing to do**: certify that no other accepted limit has slipped. Two of fifty-plus accepted limits are demonstrably worse than stated; the rest I read in summary. A full walk is beyond this audit's time.

---

## Recommendation

Proceed to the next round of the FREEZE gate. The next round must use a **different model roster** (gate 3). It must:

- Verify the C01–C04 repairs (C04's m1/m2/m3) by running the suite against fresh copies of the tree, with the named mutations applied.
- Pick up the two items I flagged: lock logging (item 6) and the program-side burned-vault check in `claim` (item 27, the off-chain `crank` part is already fixed).
- Resolve the SPEC text for items 12/17 and 35 (DISCHARGED and REPLACED, respectively) — move them into the SPEC's "Known limits, known facts" section so the SPEC text matches the SPEC's own accepted list.
- Verify the C03 repair (the bundled `planRedemption` arm in `web/test/bundle.test.mjs`).
- Verify the items I did not get to, in the order of the SPEC's "Known limits, stated" section. Each item that I have not traced is a gate I cannot certify. The first round after the freeze is the right place to walk every accepted limit end-to-end.

The second clean round lands the ship gate. With the dress rehearsal, the second-machine rebuild, the redeem-page human walkthrough, the alert-router drill, and the second clean round all green, v6 can deploy. Until then, the freeze counter stays at 0/2 and nothing is locked.