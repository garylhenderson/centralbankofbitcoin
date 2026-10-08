# Round 44, OFF-CHAIN pass — Independent Audit

## R0. Round 43's Verdict and Repairs

**V43o-1 (release gate in rehearsal tree).** Verified. `scripts/run-tests.sh` `release_gate()` now branches on `REHEARSAL-RECORD.txt`. Outside the rehearsal tree it runs `git diff --quiet $REL -- programs Cargo.toml Cargo.lock`. Inside, a Python block verifies: the id map has exactly 6 entries (5 programs + root), no id is unchanged, the recorded files still hash to the recorded patch sha, the four keyed `programs/*/src/lib.rs` are patched, every differing program file is a recorded one, and the reverse map recreates RELEASE_COMMIT's bytes. The web offline gate is skipped with a printed reason. I confirmed the `sed` extraction of `RELEASE_COMMIT` from `web/src/config.js` uses a 40-hex-char pattern. The repair is structurally sound. **No surviving defect.**

**V43o-2 (permanently unreadable signature).** Verified. `bank/alarm.mjs` tracks `unreadPasses[s.signature]` and after `UNREADABLE_SKIP_PASSES` (3) consecutive failures, pushes the signature to `looked.unreadSkips` and continues. `detectUnreadSkips` in `bank/detectors.mjs` reuses `detectLogGaps` to manage the skip list with a reviewed-through watermark (`bank/unreadable-reviewed`). The poster (`bank/redemption-poster.mjs`) does the same: after 3 runs it queues the signature as REJECTED and advances the cursor. Both the alarm and poster paths are covered. **No surviving defect.**

**V43o-3 (reveal-run arm).** The selftest floor moved from 945 to 966 (+21 arms) then +2 for the Core pin check, giving 968. The round 43 verdict states the reveal loop is extracted and run with an unreadable asset (nothing sent) and a burned one (sent). The floor count is consistent with the claimed arms. I cannot independently execute the selftest from this bundle, but the floor arithmetic is internally consistent and the described extraction approach (running the actual loop body, not checking string order) addresses the original defect. **No surviving defect found by reading.**

**Round 43's rejected claims.** I re-checked C05 (unit mismatch in deviation filter): `orcaSpot` returns `(sqrtPrice / 2^64)^2` in raw units (sats per lamport), and `meteoraSpot` returns `1 / (1 + binStep/10000)^activeId` (sats per lamport). Both are in the same unit as `satsPerLamport`. The rejection stands. C06 (bitmap dust): the bitmap PDA can only be created by the Meteora program, so a stranger cannot replace it. The rejection stands, though the recommended owner check was not applied (see INFO below). C07 (BigInt-to-Number precision): the exponent range is bounded [-18, 0], and the deviation check tolerance is 1% (100 bps), far larger than double-precision rounding error. The rejection stands.

## R1. The Crank (`bank/crank.mjs`)

I traced every planning path and every send path.

**Reveal ordering.** The reveal loop iterates from `cfg.revealed_total` upward, stopping at the first vault that is not ready (level != 0, not entropy_set, not captured this pass). This enforces strict mint order. A reveal for vault N+1 cannot be sent before vault N. **No out-of-order reveal is possible.**

**Dead vault filtering.** Claims skip `assets[r.asset] === 'burned'` and `assets[r.asset] !== 'live'`. Joins skip burned vaults and report non-live vaults as problems. Activations skip burned and non-live vaults. Retires only target positively burned vaults. **No plan pays or joins a dead vault.**

**Value movement.** The crank only calls permissionless MINT instructions: `reschedule_reveal`, `capture_entropy`, `reveal_level`, `rescue_nested`, `retire_burned`, `activate`, `distribute`, `claim`, `split_revenue`, `expire_boosts`. All destinations are pinned by the program. The crank's key signs only as fee payer. The selftest arm confirms the instruction allowlist: `['activate', 'capture_entropy', 'claim', 'distribute', 'expire_boosts', 'reschedule_reveal', 'rescue_nested', 'retire_burned', 'reveal_level', 'split_revenue']`. No transfer instructions are constructed. **The crank cannot move value anywhere the program does not pin.**

**Fee budgeting.** `budgetPlan` runs the base plan (everything except reveals) whenever the key covers it, then allocates remaining funds to reveals while keeping the floor (0.005 SOL) in reserve. `planCostLamports` correctly counts transactions and reveal rent. The `judgeFeePayer` function checks `need` before `ceiling` (round 24 L6a fix verified). **No wasted-fee scenario found.**

**Rescue planning.** `planRescues` calls `detectNestedVaults` with `isOnCurve = () => true` (intentional: only `nested_vault` and `vault_owns_itself` kinds are needed). It filters to live nested vaults and live/burned hosts. The rescue instruction passes `cfg.bank_treasury` as `new_owner`, matching the program's `require_keys_eq!(a.new_owner.key(), dest, MintError::WrongRescueDestination)` where `dest = a.config.bank_treasury`. **Correct.**

**Race handling.** `BENIGN` covers all expected race codes. `DISTRIBUTE_RACE` codes are re-judged against a fresh config read. `MonthNotElapsed` is benign (someone else distributed). `PoolShort` is never benign. **Correct.**

**No findings.**

## R2. The Alarm (`bank/alarm.mjs`, `bank/detectors.mjs`)

I traced every detector and the alarm's main loop.

**Config drift.** `detectConfigDrift` compares all WATCH entries. The `missingFlagOf` function correctly handles program absence. The `carryConfigBaseline` function preserves the last non-null value across failed reads. **No dangerous state reads as quiet.**

**Standing risks.** `detectStandingRisks` checks all production values when `opts.production` is true. The `charter_secs` is computed from `charter_closes_at - charter_opens_at`. All ruled values are pinned. **Correct.**

**Sweep state detection.** `detectSweepState` uses a symmetric window `|t - st| <= cooldown/2` to account for clock skew. The `judged` baseline advances past each sweep, whether explained or not. Unexplained sweeps page CRITICAL once (one-shot kind). **Correct behavior for an event detector.**

**Transaction walk.** The alarm walks SEAL, MINT, BURN, GOV (not SWEEP, which is stateless and called through Core ExecuteV1 within BURN transactions). The SWEEP program's bytes and upgrade authority are watched via ProgramData reads. The walk handles backlogs, unreadable transactions (3-pass skip), and truncated logs. **No silent gap found.**

**Crank health.** `detectCrankHealth` tracks failure streaks and persistent problems over 3 passes. The `coveredFreezes` parameter suppresses problems already covered by freeze findings. **Correct.**

**Pool health.** `detectPoolHealth` checks readability, freeze, and solvency. The `owedCeil` calculation matches the program's `ceil_sats`. **Correct.**

**Redemption rate.** `redemptionCapacity` correctly computes `ceil(live * 210 / 10000)` with floor 1 and ceiling 64. The ring filter excludes zero timestamps. **Correct.**

**No findings.**

## R3. The Layouts (`bank/layout.mjs`)

I verified every struct's field list against the Rust source (as provided in the bundle).

**MintConfig.** 67 fields, version 6. All fixed-size fields have correct offsets. The `Vec<Pubkey>` in SealConfig is handled with a length check (max 64). The `[u32; BOOST_RING]` array is 64 elements (256 bytes). **Correct.**

**VaultRecord.** 21 fields, version 4. All fixed-size. **Correct.**

**BurnConfig.** 7 fields, version 4. The `[i64; 64]` rate ring is 512 bytes. **Correct.**

**GovConfig.** 11 fields, version 4. **Correct.**

**Cross-program offsets.** The selftest scrapes `OFF_*` constants from all four programs and compares against `offsets()`. The SEEDS are scraped from `pub const *_SEED` declarations. **The round 24 D6 assertion exists and is verified.**

**`parseRustStruct`.** Throws on unparseable lines (private fields, `pub(crate)`, multi-line). This prevents silent drift. **Correct.**

**`collectionPluginsHash`.** Skips key (1), update_authority (32), name (String), uri (String), num_minted (4), current_size (4), then hashes the plugin region. **Correct.**

**No findings.**

## R4. The Money Arithmetic (`bank/accrual.mjs`)

I verified each function against the MINT program's Rust code.

**`credit`.** `delta = avail * ACC_SCALE / w`. `acc += delta`. `owed += delta * w`. Matches the program. **Correct.**

**`pendingScaled`.** `(weight + boost) * acc + carry - debt`. Matches `owed_of`. **Correct.**

**`reweigh`.** `carry = owed_of(v, acc)`. `debt = (weight + boost) * acc`. Matches the program. **Correct.**

**`available`.** `poolBalance - ceilSats(owedScaled)`, floored at 0. Matches the program's `distribute` logic. **Correct.**

**`ceilSats`.** `(scaled + ACC_SCALE - 1) / ACC_SCALE`. Matches. **Correct.**

**`debtAtActivation`.** `weight * acc`. Matches. **Correct.**

**The selftest covers:** level weight ratios, dust carrying, timing (activation after distribution), pool solvency, frozen/retired vaults, and the $CBOB boost (reweigh, carry, expiry). All properties are tested in both directions. **No divergence found.**

## R5. The Swap and Revenue Cycle

**Oracle math (`oracleFloor`).** I traced the exponent algebra:
- `sats = lamportsIn * sol.price * 10^(sol.expo - btc.expo) / (btc.price * 10)`
- With both exponents at -8, `e = 0`, so no adjustment. Verified with the selftest's pinned values: 2 SOL at $120.45355552 / $85,929.10904675 = 280,355 sats expected, 276,149 floor (150 bps under). **Correct.**
- Exponent range is bounded [-18, 0] by `PYTH_EXPO_MIN`/`PYTH_EXPO_MAX`. Both `readPyth` and `oracleFloor` enforce this. **No overflow path.**
- The `satsPerLamport` floating-point value is used only for the deviation check (1% tolerance). The actual swap floor is BigInt. **Precision is sufficient.**

**Pyth account verification (`readPyth`).** Offsets verified: discriminator (8) + write_authority (32) + verification_level (1) + feed_id (32) + price (8) + conf (8) + expo (4) + publish_time (8) = 101 bytes minimum. The verification level must be 1 (Full). The feed ID must match. The owner must be the Pyth receiver. **Correct.**

**Deviation filter.** `orcaSpot` = `(sqrtPrice / 2^64)^2` (sats per lamport). `meteoraSpot` = `1 / (1 + binStep/10000)^activeId` (sats per lamport). Both are compared against `satsPerLamport` with a 100 bps tolerance. **Correct units and direction.**

**Minimum out.** The swap instruction carries `minSats` as `other_amount_threshold` (Orca) or `min_amount_out` (Meteora). The judge verifies this matches the floor passed to `swapInstructions`. **Same floor, correct units.**

**Judge (`judgeSwapInstructions`).** I verified all checks:
- Exactly 7 instructions.
- Instruction 0: `SetComputeUnitLimit(400,000)`, no priority fee.
- Instructions 1, 4: ATA CreateIdempotent for the operator's own wSOL and cbBTC accounts.
- Instruction 2: System Transfer of exactly `lamportsIn`.
- Instruction 3: SyncNative.
- Instruction 5: Venue swap with correct amount, floor, direction, and pool.
- Instruction 6: CloseAccount for wSOL back to operator.
- No foreign programs, no second signers, no Token instructions except SyncNative and CloseAccount.
- The output account (swap key 5) is checked against the operator's cbBTC ATA.
- The swap's minimum-out bytes are checked.
- The direction byte is checked (Orca: `d[40] === 1, d[41] === 1` for exact-input a_to_b).
- The amount is checked.
**The judge is complete for the stated threat model (same-tree tamper). No gap found.**

**Account derivation.** Orca tick arrays: `[s0, s0-span, s0-2*span]` for a_to_b (price decreasing). Meteora bin arrays: `[i, i+1, i+2]` for Y-to-X (active bin increasing). Both match the swap direction. **Correct.**

**wSOL handling.** Wrap exactly `lamportsIn`, sync, swap, close. The close returns all remaining lamports. If the swap consumes less than the input (which shouldn't happen for exact-input), the close returns the remainder. **Correct.**

**Failure and retry.** Orca first, Meteora only on definite refusal. `classifySendFailure` distinguishes refused (preflight or on-chain error), landed (confirmed success), and unknown. Unknown outcomes throw, keeping the cycle open. **No double-swap path.**

**Revenue cycle.** The open-cycle guard prevents starting a new cycle while one is open. The sweep amount is bounded by `sweepAmount`. The post-sweep re-quote checks for drift. The return sends the full operator ATA balance but records only the delta. The split handles front-running via `isProvablyEmpty`. **Correct.**

**INFO observation:** `market()` checks `bitmapExists: !!bm` without verifying the bitmap account's owner. Round 43 C06 recommended `!!bm && bm.owner.equals(METEORA.program)`. This was not applied. However, the bitmap PDA is derived by the Meteora program and can only be created by it, so a stranger cannot substitute a fake bitmap account. This is not exploitable. **INFO only.**

## R6. The Gates

**`scripts/run-tests.sh`.** All floors use equality checks (`-eq`), not lower bounds. The `floor` function explicitly checks `$n -eq $4`. The MIN_ASSERTIONS (912), DET_FLOOR (968), ALLOC_FLOOR (39), POSTER_FLOOR (24), MAINNET_FLOOR (35), LAUNCH_FLOOR (68), POB_FLOOR (14), HOST_FLOOR (6), WEB_FLOOR (682), EXPIRY_FLOOR (4) are all hardcoded and not overridable. The `release_gate` function is correctly implemented. **No floor can be satisfied by deleting work.**

**`scripts/build-mainnet.sh`.** Builds both mainnet and localnet, deploys both to a validator, and asks each whether it trusts the test key. The mainnet build must REJECT, the localnet must ACCEPT. The sweep helper's bytes are compared across mainnet, localnet, and `target/deploy`. The Core pin is checked against a hardcoded sha256. **Correct.**

**`scripts/cron-install.sh`.** Uses `flock -n` for all money jobs. Preserves existing `--live` flags. Refuses rehearsal trees. The selftest verifies the preservation logic by running the actual shell code. **Correct.**

**`scripts/check-launch-params.mjs`.** Checks all values against the alarm's production list (imported, not duplicated). The `--rehearsal` mode checks the rehearsal value set. The mainnet mode refuses the rehearsal file by name. **Correct.**

**`bank/selftest.mjs`.** I checked the selftest structure. Every detector is tested in both directions (fires when it should, quiet when it should). The layout selftest parses Rust structs and compares field-by-field. The cross-program offset selftest scrapes constants from all four programs. The SEEDS selftest scrapes seed declarations. **No arm found that cannot fail.**

**`scripts/audit-coverage.sh`.** Checks that every tracked file's current content was in a completed round's bundle. The `--prepared` mode additionally credits the next round. The quorum headline check uses an exact anchored regex. **Correct.**

**No findings.**

## Accepted Limits — Four Questions

**1. Is any limit WORSE than stated?**
I re-read every accepted limit against the code. I found no limit that is worse than stated. Each limit accurately describes the residual risk and the reason it is not fixed.

**2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?**
No. All listed limits are real and unclosed. The discharged items are correctly discharged.

**3. Is any DISCHARGED item not actually discharged?**
I checked the discharged items. Items 1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24 were about the Bank key, co-signer, deck, or distributor, all deleted in v6. Items 12/17 (compute units), 14 (duplicate attributes), 19 (unlevelled vault halt), 30 (85/15 vote), 31 (31-day cadence), 33 (swap operator notice), 51 ($CBOB boost), 54 (compute at widest shapes) are correctly discharged with measurements. **No discharged item is actually still open.**

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**
Items 22, 38, 50, 52, 53 are all still OPEN. Item 38 has three OPEN values in `launch/mainnet-init.json` (`charter_opens_at`, `lock_deadline`, `vault_collection`). Item 50's pages are built but not published. Item 53's rehearsal has not been run. **None are being quietly treated as accepted.**

## web/test Assessment

I examined each test file for vacuity.

**`bundle.test.mjs`.** Tests the browser bundle against the node version. The `judgeLaunch` comparison would fail if the bundle's crypto shim produced different hashes. The `planRedemption` comparison runs 6 synthetic snapshots and compares byte-for-byte. The static checks (no external scripts, CSP, viewport, no em dashes) are all verifiable. **Non-vacuous.**

**`ceremony.test.mjs`.** Tests the launch gate, value mapping, collection creation, and program deployment. The `judgeLaunch` tests check both acceptance and refusal. The value mapping tests compare against the suite's builders. **Non-vacuous.**

**`decode.test.mjs`.** Tests Core asset/collection parsing against the official mpl-core deserializers. The token account parsing is tested against spl-token's AccountLayout. **Non-vacuous.**

**`get.test.mjs`.** Tests the charter claim and purchase flows. The claim tests use the real 240-address PoB set and verify proofs. The purchase tests check max_price and round state. **Non-vacuous.**

**`ids.test.mjs`.** Tests every address derivation against the suite's derivations, the programs' seed constants, mpl-core's asset-signer PDA, and spl-token's ATA. The config profiles are checked for shape. **Non-vacuous.**

**`meta.test.mjs`.** Tests the metadata generator. The drawn/undrawn vault metadata is checked against expected values. The fail-closed behavior (keeping previous file on error) is tested. **Non-vacuous.**

**`plan.test.mjs`.** Tests the redemption plan extensively: plain case, missing accounts, frozen pool, strays, C5 accounts, nested vaults, rate limit, off-curve owners, grouped boxes, standing consent, press-time re-reads. Each test compares against expected values and would fail if the property were broken. **Non-vacuous.**

**`tx.test.mjs`.** Tests the signing guard: honest wallet accepted, instruction-adding wallet rejected, forged signature rejected. Error names are checked against the program's error list. **Non-vacuous.**

**`run-all.mjs`.** Runs all test files and checks counts against floors. The total (682) matches WEB_FLOOR. **Non-vacuous.**

**`mock-rpc.mjs`.** Test helper, not a test itself. Provides a mock RPC server. **Not applicable.**

**No vacuous tests found.**

## Findings Summary

**CRITICAL: 0**
**HIGH: 0**
**MEDIUM: 0**
**LOW: 0**

**INFO: 1**

**INFO-1: `market()` bitmap owner check not applied.** `bank/swap.mjs` `market()` checks `bitmapExists: !!bm` without verifying the bitmap account's owner against `METEORA.program`. Round 43 C06 recommended `!!bm && bm.owner.equals(METEORA.program)`. This was not applied. However, the bitmap PDA is derived by the Meteora program and can only be created by it, so this is not exploitable. The Meteora program would reject a swap if the bitmap account were invalid. This is a defense-in-depth recommendation, not a vulnerability.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **Run the dress rehearsal (item 53) before anything else.** The rehearsal tree script exists, the rehearsal value set exists, and the check-launch-params `--rehearsal` mode exists. But the rehearsal has not been run. This is the single most important remaining step. It must include all five named items from item 22: crank live passes, alarm live passes, one full revenue cycle through each pool, one forced post-sweep failure with hand recovery, and one DAS read of a burned Core asset.

2. **Fill the three OPEN launch values.** `charter_opens_at`, `lock_deadline`, and `vault_collection` must be set before `initialize` is signed. The check-launch-params script will refuse until they are filled. The lock deadline must be at least 24 hours before `charter_opens_at` and must be set so that the upgrade authority is removed before any value is at risk.

3. **Publish the holder pages (item 50) before the redeem page is needed.** The pages are built but not published. The redeem page is the only pre-signature check for undeclared holdings. Until it is published, items 9 and 44 have no preventive control.

4. **Create the pool, revenue, and Squads cbBTC accounts (item 52) before the first paid mint.** Road step 10 handles this, but it must happen before any mint that pays into the revenue address.

5. **Verify the deployed bytes match `dist/` after deployment.** The build-mainnet script produces sha256 sums. After deploying, dump each program and verify the prefix hash and zero tail. This is step 9's responsibility.

6. **Remove the upgrade authority from all five programs (step 11) only after the redeem page is published and all other preconditions are met.** This is the point of no return. Once done, every surviving bug is permanent.

7. **Run the mainnet probe with DNS available.** The certifying run must show the probe RAN (its floor line printed), not SKIPPED. A skipped probe does not count toward the ship gate.

8. **Independently verify the Core pin.** The Core sha256 pin was re-pinned in round 43 after Metaplex upgraded Core twice. The mainnet probe now fails if the pin doesn't match the deployed Core. But the pin itself should be verified against a fresh dump from an independent RPC endpoint before the dress rehearsal.

9. **The AI audit process cannot verify its own blind spots.** The audit coverage gate (`scripts/audit-coverage.sh`) ensures every file is bundled, but it cannot ensure the auditor understood the file. The two-clean-round requirement with different rosters mitigates this, but cannot eliminate it. The dress rehearsal against a live cluster is the only test that exercises the full stack end-to-end, and it is the one thing no amount of code reading can replace.