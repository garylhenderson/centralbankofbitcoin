# Round 45 Independent Audit — Off-Chain Pass

## R0. Round 44 Verdict Verification

I independently verified all five V44o repairs against the code at the audited head.

**V44o-1 (poster per-signature unreadable count):** Verified in `bank/redemption-poster.mjs`. The count is stored per-signature (`st.unread[s.signature]`), and readable signatures only delete their own count (`delete st.unread[s.signature]`). The backlog/gap scenario is handled because the cursor doesn't advance past the unreadable signature, and the count persists across re-walks. **Repair holds.**

**V44o-2 (revenue split recovery refused-read collection):** Verified in `bank/revenue.mjs` `splitsSince`. Refused reads are caught per-signature and collected in `refused[]`, the scan continues, and a readable split beside a refused one still closes the cycle. The recovery stage names refused signatures when a returned cycle remains open. **Repair holds.**

**V44o-3 (alarm balance baseline with null SEAL config):** Verified in `bank/alarm.mjs`. The reserve list falls back through `D.carryConfigBaseline(prev?.config, cfg)['seal.reserve_mints']`, and unbuilt legs are carried forward with a `balance_unreadable` HIGH finding. **Repair holds.**

**V44o-4 (runner tail exit status):** Verified in `scripts/run-tests.sh`. The swap-fork skip uses `if`/`else` form, so the script exits 0 when the DNS check fails and `CBOB_SHIP_GATE` is unset. **Repair holds.**

**V44o-5 (rehearsal notices for crank/revenue):** Verified in `bank/detectors.mjs` `rehearsalNotice`, `bank/crank.mjs`, and `bank/revenue.mjs`. Both jobs check `REHEARSAL_MARKER` and route notices through `rehearsalNotice`, which appends `-rehearsal` to the label and `(REHEARSAL)` to the text. **Repair holds.**

**Verdict on R0:** All five repairs are correctly implemented. The round 44 LAUNCH-CLEAN verdict is confirmed.

## R1. The Crank

I traced `planCrank`, `planRescues`, `budgetPlan`, `planCostLamports`, `mintFailureCode`, `judgeDistributeRefusal`, `judgeRevealAttrs`, `revealAttrSource`, and the send loop.

**No plan the program will refuse:** The crank checks asset liveness before joining or paying (round 23 L2), retires bare burns before distributing, expires due boosts before distributing, joins eligible vaults before distributing, and handles all benign race codes. The `BENIGN` regex covers all expected race outcomes. The `judgeDistributeRefusal` function correctly distinguishes races (epoch moved) from faults (epoch unmoved, `PoolShort`).

**No plan that pays or joins a dead vault:** The crank checks `assets[r.asset] === 'burned'` and skips burned vaults for joins, claims, and expiry. Burned vaults are retired first.

**No reveal sent out of order:** Reveals are planned strictly from `revealed_total` in mint order, and the send loop stops at the first failure or benign outcome.

**No value movement beyond the program's rules:** The crank only sends permissionless MINT instructions. The selftest asserts the exact instruction set. No SPL transfers, no System transfers, no other programs.

**Budget logic:** `budgetPlan` correctly computes the base cost (without reveals), keeps the floor in reserve, and slices reveals from the front (mint order). The `planCostLamports` function correctly accounts for all transaction types including rescues, joins, expires, and claims.

**Rescue logic:** `planRescues` correctly filters for `nested_vault` and `vault_owns_itself` findings, checks that the nested vault is live (matching MINT's `require_live_vault`), and checks that the host is live, burned, or the vault itself (matching MINT's `rescue_nested` logic).

**No findings.**

## R2. The Alarm

I traced all detectors in `bank/detectors.mjs` and the alarm's main loop in `bank/alarm.mjs`.

**Config drift:** The `WATCH` list covers all fixed-forever values, voted values, guardian stops, program bytes, and third-party programs. The `detectConfigDrift` function correctly handles first-pass (absent program), third-party program entry, and carried baselines.

**Standing risks:** The production value checks match the alarm's production list. The tighten bounds, governance numbers, and boost ceilings are all checked.

**Sweep state detection:** `detectSweepState` uses a symmetric window (`|t - st| <= cooldown/2`), which correctly prevents a thief's sweep from being explained by an honest cycle (the thief must wait a full cooldown, which exceeds `cooldown/2`). The `cooldownSeen` is the minimum ever seen, capped at 21600, which is the conservative direction.

**Balance drops:** The `detectBalanceDrops` function correctly handles vaults that leave the collection (skipped, handled by `detectVaultSetChange`), and the `correlateBurns` function correctly downgrades redemption-related drops.

**Crank health:** The `detectCrankHealth` function correctly tracks failure streaks and problem streaks, handles covered freezes, and prunes stale problems.

**Unreadable signatures:** The `detectUnreadSkips` function correctly skips signatures after 3 consecutive unreadable passes, keeps them in `unreadSkips`, and pages until a person clears them.

**Log gaps:** The `detectLogGaps` function correctly handles the truncation gap as a level condition, never drops unreviewed gaps, and escalates at 2000+ unreviewed.

**No dangerous state reads as quiet, no routine state pages every pass.**

**No findings.**

## R3. The Layouts

I verified the layout field lists against the Rust structs in `programs/cbob-vault-mint/src/lib.rs`.

**MintConfig:** 64 fields, matching the Rust struct exactly. The selftest asserts this with `parseRustStruct`.

**VaultRecord:** 20 fields, matching. **BurnConfig:** 7 fields, matching. **GovConfig:** 11 fields, matching. **SealConfig:** 4 fields, matching.

**SEEDS:** 12 seeds, all asserted against the Rust `*_SEED` constants. The round 24 D6 assertion now exists and checks all 12.

**Cross-program offsets:** All pinned offsets (GOV reading MINT's `minted_total`, `bare_burns_retired`, etc.; BURN reading SEAL's `collection`, `reserve_mints`) are asserted against the layout's computed offsets.

**No findings.**

## R4. The Money Arithmetic

I compared `bank/accrual.mjs` against the MINT program's `credit`, `owed_of`, `reweigh`, and `ceil_sats`.

**credit:** `delta = avail * ACC_SCALE / w; acc += delta; owed += delta * w`. Matches.

**owed_of/pendingScaled:** `(weight + boost) * acc + carry - debt`. Matches. The JS checks for negative (underflow), the Rust uses checked arithmetic.

**reweigh:** Moves owed to carry, resets debt at new weight. Matches.

**ceil_sats:** `(scaled + ACC_SCALE - 1) / ACC_SCALE`. Matches.

**Crank boost expiry:** Pre-expiry checks `dist_epoch >= boost_end_epoch` (due). Post-expiry checks `boost_end_epoch === dist_epoch + 1` (will be due after this distribution). Both correct.

**No divergence found.**

## R5. The Swap and Revenue Cycle

**(a) Oracle math:** The formula `sats = lamports * sol_price * 10^(sol_expo - btc_expo) / (btc_price * 10)` is correct. BigInt division truncates toward zero (floor for positive values). The `satsPerLamport` uses floating point but only for the deviation check (1% threshold), where floating point errors are negligible. The exponent range is bounded (-18 to 0). **Correct.**

**(b) Pyth verification:** The account is a PDA of the push oracle program, owned by the receiver program, with full verification (level 1) and feed ID check. The `publishTime` is checked against the chain Clock (180s staleness, 30s future). Only the push oracle program can write to these accounts, and it verifies Wormhole attestations. **Correct.**

**(c) Deviation filter:** `orcaSpot` computes `(sqrt_price / 2^64)^2` (sats per lamport). `meteoraSpot` computes `1 / (1 + binStep/10000)^activeId` (sats per lamport). Both match the pool's token ordering. The deviation check uses floating point with a 1% threshold, where floating point errors are negligible. **Correct.**

**(d) Minimum out:** The floor is `expectedSats * 9850 / 10000`, consistent with the deviation filter's `satsPerLamport`. The floor is passed as `other_amount_threshold` (Orca) or `min_amount_out` (Meteora). **Correct.**

**(e) The judge:** `judgeSwapInstructions` checks all 7 instructions at their expected positions, verifies the program IDs, account keys, data bytes, amounts, floor, direction, and signer. It rejects extra instructions, wrong programs, wrong accounts, wrong amounts, wrong floor, priority fees, and unauthorized Token instructions. **Comprehensive.**

**(f) Account derivation:** Orca tick arrays use `floor(tickCurrent / span) * span` for the current array, then two below. Meteora bin arrays use `floor(activeId / 70)` for the active array, then two above. Both match the swap direction. The bitmap extension is handled with the Anchor optional-account convention. **Correct.**

**(g) wSOL handling:** The swap wraps exactly `lamportsIn`, syncs, swaps, and closes. Existing wSOL balance is returned via CloseAccount (native unwrap). Frozen wSOL ATA causes SyncNative to fail. Delegate doesn't affect the swap. **Correct.**

**(h) Failure and retry:** Orca first, Meteora only on refusal. `classifySendFailure` distinguishes refused (preflight, on-chain error, expired), landed, and unknown. Unknown outcomes stop the cycle (no double-swap). Confirmation timeout on a landed swap is detected via status lookup. **Correct.**

**(i) Adversary extraction:** The 100 bps deviation gate and 150 bps floor bound extraction. The SPEC correctly states these don't establish a hard bound on deviation from the true market price. The worst case is stated in the SPEC. **No new finding.**

**Revenue cycle:** The open-cycle guard prevents double-swaps. The ledger is held to the chain (sweeps, splits, start times). The hand recovery procedure is documented. **Correct.**

**No findings.**

## R6. The Gates

I checked the selftest for arms that can't fail.

**Wiring gate:** The `wiringGate` function extracts the body of `main()` and `reconcile()`, strips comments (handling strings, line comments, block comments), and checks that each detector is called and its result is used. The `consumed` function checks for spread or assignment followed by usage. **Robust.**

**Layout assertions:** The `parseRustStruct` function parses Rust structs, handles comments and attributes, and throws on unparseable lines. The selftest asserts field-for-field equality. **Robust.**

**Seed assertions:** The D6 assertion checks all 12 seeds against the Rust constants. **Exists and correct.**

**Core pin assertions:** The R43 assertion checks all four Core pin copies match. **Robust.**

**Floor assertions:** All floors (detector, allocation, poster, launch, mainnet, web, swap, expiry) are checked for equality, not just lower bound. **Correct.**

**No vacuous arms found.**

## Accepted Limits Verification

I checked each accepted limit against the code.

1. **No limit is worse than stated.** Each limit's mechanism is correctly implemented.
2. **No limit is already closed.** Each limit's residual is real.
3. **All discharged items are correctly discharged.** Each discharge is verified.
4. **No OPEN AND BLOCKING item is quietly treated as accepted.** Items 22, 38, 50, 52, 53 are correctly open.

## Findings

**No CRITICAL, HIGH, or MEDIUM findings.**

### LOW

**L1: The `oracleFloor` function's `satsPerLamport` field uses `Number()` conversion of BigInt prices, which could lose precision for prices exceeding `Number.MAX_SAFE_INTEGER` (2^53 - 1).** With the bounded exponent range (-18 to 0), this would require a price exceeding ~9×10^15 in base units, which is unrealistic for SOL/USD or BTC/USD. The field is only used for the deviation check (1% threshold), not for the actual floor. **Evidence:** Construct a Pyth price with `price > 2^53` and `expo = 0`; `Number(price)` would lose precision. **Fix:** None needed; the exponent bound and realistic price ranges make this unreachable. Optionally, add a comment noting the precision bound.

### INFO

**I1: The revenue job's `splitsSince` function pages through at most 10 pages of 1000 signatures (10,000 total).** At the expected transaction volume (one split per hour), this covers ~416 days. The function is only called for splits since the return's chain time, so the actual window is much smaller. **Evidence:** Count transactions on the revenue ATA over 416 days at one per hour. **Fix:** None needed; the bound is more than sufficient.

## Given That No Human Firm Will Ever See This

1. **Run the dress rehearsal (item 22) before removing upgrade authorities.** The local validator tests are thorough, but they cannot exercise RPC rate limits, network latency, DAS indexing behavior, or the interaction between the crank, alarm, and revenue job under real load. The rehearsal's named pass/fail items (crank passes, alarm passes, revenue cycles through both pools, forced post-sweep failure recovery) are the minimum viable test.

2. **Verify the Pyth price accounts on mainnet before the first revenue cycle.** The `pythAccount` derivation and `readPyth` parsing are tested against synthetic data, but the actual mainnet accounts should be read once to confirm the layout, ownership, and verification level match expectations.

3. **Confirm the Orca and Meteora pool accounts exist and are initialized before the first revenue cycle.** The fork test clones them, but the mainnet accounts should be verified to exist with the expected mints, vaults, and tick/bin arrays.

4. **Monitor the first 24 hours after arming the crank and revenue job.** The first live pass of each job is the most likely to encounter unexpected RPC behavior, rate limits, or account states. The alarm's `crank_silent` and `royalties_unswept` detectors provide coverage, but a human should watch the logs.

5. **Back up the alarm state file (`bank/state.json`) and revenue ledger (`bank/revenue-ledger.json`) before each major operation.** These files contain the baselines for drift detection and the record of swept SOL. Loss of either file would require manual reconstruction.

6. **Test the hand recovery procedure (SPEC limit 10) at least once before launch.** The procedure is documented but untested. A dry run with a simulated open cycle would confirm the steps are correct and complete.