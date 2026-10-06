# Round 26 Off-Chain Audit Findings

## R1. THE CRANK (`bank/crank.mjs`)

### CRITICAL: A plan that pays or joins a dead vault

**Construct:** `planCrank` in `bank/crank.mrank.mjs` lines 195-205. The `preJoins` array is populated for vaults where `r.pending` is true and `r.request_epoch < cfg.dist_epoch`, but the check `assets[r.asset] !== 'live'` only skips vaults that read as something OTHER than 'live'. A vault that reads as 'live' but is actually burned (asset state is 'burned') would still be joined.

**Evidence if true:** A vault whose asset is positively burned would appear in `plan.preJoins` and be joined by the crank, adding dead weight to the payout denominator. The crank's `retireBurned` loop runs BEFORE the join loop, but only for vaults where `!r.retired && assets[r.asset] === 'burned'`. If a vault is burned between the asset read and the join planning, it could be joined.

**Fix:** The `preJoins` loop should explicitly check `assets[r.asset] === 'live'` and skip burned vaults, matching the pattern used in the `retireBurned` loop.

### HIGH: A reveal sent out of order

**Construct:** `planCrank` reveal loop (lines 130-137). The loop iterates from `cfg.revealed_total` upward, but breaks at the first vault that is not ready (`!(r.entropy_set || capturedThisPass.has(r.address))`). However, if a vault at index `i` is ready but vault `i+1` is not, and vault `i+2` becomes ready later, the loop would stop at `i+1` and never reach `i+2` even if it becomes ready.

**Evidence if true:** Vaults would be stuck in the reveal queue indefinitely if an earlier vault is not ready, even if later vaults are ready. The program's `RevealOutOfOrder` check would prevent out-of-order reveals, but the crank would never attempt them.

**Fix:** The reveal loop should continue past non-ready vaults to find ready ones later in the sequence, or the crank should handle this case explicitly.

### LOW: A plan the program will refuse (wasted fees)

**Construct:** `planCrank` distribution logic (lines 230-245). The `distribute` flag is set when `joinable && poolOk && !pool.frozen && due && w > 0n`, but the `avail` calculation uses `available(BigInt(pool.amount) + splitToPool, owedAfterRetire)`. If `splitToPool` is 0 (no revenue to split), the distribution might still be planned even if the pool has nothing to distribute.

**Evidence if true:** The crank would send a `distribute` instruction that the program refuses with `NothingToDistribute`, wasting a transaction fee.

**Fix:** Add a check that `avail > 0n` before setting `plan.distribute = true`.

## R2. THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

### HIGH: A dangerous on-chain state it reads as quiet

**Construct:** `detectUnsweptRoyalties` in `bank/detectors.mjs` (lines 680-710). The function checks if `excess < BigInt(floor)` and returns early, but it does not account for the case where `lamports` is exactly equal to `reserve`. In this case, `excess` would be 0, which is less than `floor`, so it returns early. However, if `lamports` is exactly `reserve + floor`, `excess` equals `floor`, which is NOT less than `floor`, so it proceeds. But if `lamports` is `reserve + floor - 1`, `excess` is `floor - 1`, which IS less than `floor`, so it returns early. This means a balance that is exactly at the floor threshold is treated differently depending on whether it's exactly at the boundary.

**Evidence if true:** A revenue address with exactly `reserve + floor - 1` lamports would not page `royalties_unswept`, even though it has sweepable funds. This is a boundary condition issue.

**Fix:** Change the comparison from `excess < BigInt(floor)` to `excess <= 0n` to only return early when there's truly nothing to sweep.

### HIGH: A routine state it pages on every pass

**Construct:** `detectCrankHealth` in `bank/detectors.mjs` (lines 470-490). The function tracks `failStreak` and `problems`, but the `problems` object is rebuilt every pass with `problems[key] = { n: (next.problems[key]?.n ?? 0) + 1, text: p }`. This means that if a problem persists across passes, its count increments. However, the `next` object is only updated when `beat && beat.atSec !== next.lastAt`, meaning if the heartbeat hasn't changed, the problems are not re-evaluated.

**Evidence if true:** If the crank's heartbeat file is not updated (e.g., due to a file system issue), the alarm would continue to page `crank_problem` for the same problem every pass, even if the problem has been resolved.

**Fix:** The alarm should re-evaluate problems even when the heartbeat hasn't changed, or it should clear problems that are no longer present.

## R3. THE LAYOUTS (`bank/layout.mjs`)

### CRITICAL: The SEEDS comment claimed an assertion that did not exist

**Construct:** `bank/layout.mjs` line 35: "PDA seeds, as the programs declare them. Asserted against each program's `*_SEED` constant in bank/selftest.mjs since round 24 (D6): this comment said 'asserted against the Rust' for rounds before any assertion existed."

**Evidence if true:** The selftest at lines 587-595 does assert that every seed in `L.SEEDS` matches the Rust source. However, the assertion only checks that the seed VALUE matches, not that the seed is actually USED correctly in the program. A seed could be correctly declared but incorrectly used in a PDA derivation.

**Fix:** Add assertions that verify the PDA derivations using the seeds match the expected addresses, not just that the seed strings match.

## R4. THE MONEY ARITHMETIC (`bank/accrual.mjs`)

### HIGH: Divergence in the `credit` function

**Construct:** `credit` function in `bank/accrual.mjs` (lines 43-48). The function calculates `delta = avail * ACC_SCALE / w` and returns `{ acc: BigInt(acc) + delta, owed: BigInt(owed) + delta * w }`. However, the program's `credit` function in `programs/cbob-vault-mint/src/lib.rs` (lines 1037-1043) calculates `delta = (avail as u128).checked_mul(ACC_SCALE).ok_or(MintError::Overflow)? / (w as u128)` and updates `c.acc_scaled` and `c.owed_scaled`.

**Evidence if true:** The off-chain `credit` function uses JavaScript BigInt division which truncates toward zero, while the Rust code uses integer division which also truncates toward zero. However, the off-chain function does not check for overflow, while the Rust code does. If `avail * ACC_SCALE` overflows in the off-chain code, it would produce a different result.

**Fix:** Add overflow checking to the off-chain `credit` function to match the Rust behavior.

### MEDIUM: The crank must expire every DUE boost before it distributes

**Construct:** `planCrank` in `bank/crank.mjs` (lines 215-222). The `preExpires` array is populated for vaults where `BigInt(cfg.dist_epoch) >= BigInt(r.boost_end_epoch)`, but the check `r.boost_weight > 0` is used. However, the program's `BoostsExpireFirst` check in `distribute` (line 1596) checks `ctx.accounts.config.boosts_due > 0`, not individual vault boost weights.

**Evidence if true:** If a vault's boost is due but `boosts_due` is 0 (because the boost was already expired by another call), the crank would still try to expire it, which would be a no-op. But if `boosts_due` is > 0 but the crank doesn't expire all due boosts, the program would refuse the distribution.

**Fix:** The crank should check `cfg.boosts_due > 0` before planning a distribution, not just individual vault boost weights.

## R5. THE SWAP (`bank/swap.mjs`)

### CRITICAL: The oracle math - BigInt-to-Number conversion overflow

**Construct:** `oracleFloor` in `bank/swap.mjs` (lines 108-115). The function calculates `satsPerLamport: Number(sol.price) * 10 ** sol.expo / (Number(btc.price) * 10 ** btc.expo) / 10`. The `sol.price` and `btc.price` are BigInt values, and converting them to Number can lose precision for large values.

**Evidence if true:** If `sol.price` is larger than `Number.MAX_SAFE_INTEGER` (2^53 - 1), the conversion to Number would lose precision, leading to an incorrect `satsPerLamport` calculation. This could cause the oracle floor to be set too high or too low, allowing a bad swap or rejecting a good one.

**Fix:** Use BigInt arithmetic throughout the `satsPerLamport` calculation, or add a check that the prices are within the safe Number range.

### HIGH: Pyth account verification - ownership plus derived address

**Construct:** `readPyth` in `bank/swap.mjs` (lines 82-95). The function checks that the account is owned by the Pyth receiver and that the feed ID matches. However, it does not verify that the account is actually the derived PDA for the given feed.

**Evidence if true:** An attacker could create a fake Pyth account with the correct owner and feed ID but at a different address, and the function would accept it. The derived address check is missing.

**Fix:** Add a check that the account's public key matches the derived PDA for the given feed ID.

### MEDIUM: The deviation filter - floating point precision

**Construct:** `deviationBps` in `bank/swap.mjs` (line 117). The function calculates `Math.abs(pool - oracle) / oracle * 10_000`. This uses floating-point arithmetic, which can introduce precision errors.

**Evidence if true:** For very small differences between `pool` and `oracle`, floating-point precision could cause the deviation to be calculated as 0 when it should be slightly above 0, or vice versa. This could allow a pool that should be rejected to pass the filter.

**Fix:** Use BigInt arithmetic for the deviation calculation to avoid floating-point precision issues.

### LOW: The minimum out - units mismatch

**Construct:** `orcaSwapIx` and `meteoraSwapIx` in `bank/swap.mjs`. The `minSats` parameter is passed as a u64 in the instruction data. However, the `oracleFloor` function returns `minSats` as a BigInt, and the `swapInstructions` function passes it directly.

**Evidence if true:** If `minSats` is larger than `u64::MAX`, the conversion would overflow. However, since `minSats` is derived from the oracle floor which is based on lamports (max ~10^18), this is unlikely to be an issue in practice.

**Fix:** Add a check that `minSats` fits in a u64 before passing it to the swap instruction.

### CRITICAL: The judge (`judgeSwapInstructions`) - incomplete checks

**Construct:** `judgeSwapInstructions` in `bank/swap.mjs` (lines 200-280). The function checks the instruction sequence, but it does NOT check:
1. That the swap's OUTPUT account is the operator's own cbBTC account (it checks the input account but not the output)
2. The swap's direction byte for Meteora
3. That the two ATA creations create the accounts they claim (it checks the keys but not that the accounts are actually created)

**Evidence if true:** A tampered builder could route the swap output to a different account, or change the direction of the Meteora swap, and the judge would not catch it.

**Fix:** Add checks for the output account, the Meteora direction byte, and verify that ATA creations match the expected accounts.

### HIGH: Account derivation - tick-array boundary

**Construct:** `orcaTickArrayStarts` in `bank/swap.mjs` (lines 130-133). The function calculates tick array starts as `[s0, s0 - span, s0 - 2 * span]`. However, if `tickCurrent` is exactly on a tick array boundary, `s0` would be the start of the current array, and `s0 - span` would be the start of the previous array. But if `tickCurrent` is at the very beginning of an array, `s0 - span` might not be the correct previous array.

**Evidence if true:** At a tick-array boundary, the wrong tick arrays might be selected, causing the swap to fail or use incorrect liquidity.

**Fix:** Verify the tick array derivation against the Orca IDL and add boundary condition tests.

### MEDIUM: wSOL handling - existing balance

**Construct:** `swapInstructions` in `bank/swap.mjs` (lines 175-185). The function creates a wSOL ATA, transfers lamports to it, syncs it, and then closes it. However, if the operator's wSOL ATA already exists and holds a balance, the `createAtaIdempotent` instruction would be a no-op, but the `SystemProgram.transfer` would add to the existing balance, and the `closeAccount` would close the account and send all lamports to the owner.

**Evidence if true:** If the operator's wSOL ATA already has a balance, the swap would use more lamports than intended, and the close would return more than expected.

**Fix:** The function should check the wSOL ATA balance before and after the swap to ensure only the intended amount is used.

### HIGH: Failure and retry - double count

**Construct:** `revenue.mjs` swap loop (lines 230-250). The function tries Orca first, then Meteora if Orca refuses. However, if a swap's confirmation times out but later lands, the function would try Meteora, which would fail because the SOL has already been swapped.

**Evidence if true:** A confirmation timeout on a swap that later lands could lead to a second swap attempt, resulting in a double swap or a failed Meteora swap.

**Fix:** The function should check the operator's cbBTC balance before attempting a swap to detect if a previous swap has already completed.

## R6. THE GATES (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

### CRITICAL: Assertions that cannot fail

**Construct:** `bank/selftest.mjs` line 789: `t('the suite\'s own copies. tests/3prog.test.ts reads the same accounts by its own OFF_ constants; a drifted copy there certifies against the wrong byte.', suite.filter(([k, v]) => testOff[k] !== v).map(([k, v]) => `${k}: suite ${testOff[k]}, layout ${v}`), [])`.

**Evidence if true:** The `suite` array is hardcoded in the selftest, and the `testOff` object is scraped from `tests/3prog.test.ts`. If the scraping fails (e.g., due to a regex change), `testOff` would be empty, and the assertion would pass vacuously.

**Fix:** Add a check that `testOff` is not empty before comparing, and add a test that verifies the scraping works correctly.

### HIGH: Floors that can be satisfied by deleting work

**Construct:** `scripts/run-tests.sh` line 155: `floor "mainnet probe" "$MAIN_OUT" '[0-9]+/[0-9]+ as predicted' "$MAINNET_FLOOR"`.

**Evidence if true:** The `floor` function checks that the count is >= the floor, but the round 19 fix changed it to check equality. However, if the mainnet probe is skipped (no network), the floor is not checked at all, and the build passes.

**Fix:** The floor check should fail if the probe is skipped, not just when it runs and fails.

### MEDIUM: Checks that pass vacuously when their input is empty

**Construct:** `bank/selftest.mjs` line 587-595: The seed assertion checks that every seed in `L.SEEDS` matches the Rust source. However, if `L.SEEDS` is empty, the assertion would pass vacuously.

**Evidence if true:** If someone accidentally empties the `SEEDS` object, the assertion would still pass, and the layout would be broken.

**Fix:** Add a check that `L.SEEDS` has the expected number of entries (11).

## ACCEPTED LIMITS ANALYSIS

### 1. Is any limit WORSE than stated?

**Limit 10 (The swap operator is the one trusted hop):** The limit states that the operator can keep "per-sweep cap x cooldown windows until the guardian pulls emergency_stop_sweep". However, the current implementation has a 10 SOL cap with a 6-hour cooldown, which means the operator could potentially take up to 40 SOL per day (4 sweeps x 10 SOL). The limit does not clearly state this daily maximum, which could be misleading.

**Evidence:** The limit says "per-sweep cap x cooldown windows" but does not specify the daily maximum. A reader might assume the cap is per day, not per sweep.

### 2. Is anything listed as a limit not actually a limit?

**Limit 25 (A minter who dislikes their draw can let it lapse for a re-roll):** The limit states this is only possible "if NOBODY CAPTURES IT FOR THE WHOLE WINDOW". However, the alarm now pages on reschedules (`reveal_rescheduled`), which means the system detects when this happens. The limit is still accurate, but the detection mechanism makes it less of a silent risk.

**Evidence:** The alarm's `detectProgramEvents` function pages on `REVEAL_RESCHEDULED` events, and `detectRevealStall` pages when the level queue doesn't move between passes.

### 3. Is any DISCHARGED item not actually discharged?

**Item 51 (LEVEL-UPS BY BURNING $CBOB):** The item states this is "DECIDED AND BUILT AS THE $CBOB BOOST". However, the boost terms are still set by a Governor vote, and the $CBOB mint was created on mainnet 2026-10-04. The item is discharged in the sense that the mechanism is built, but the terms are not yet set.

**Evidence:** The `set_boost_terms` function exists and is tested, but `boost_price` is 0 at launch, meaning boosts are off until a vote sets the terms.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**Item 22 (NOTHING HAS EVER RUN A DISTRIBUTION AGAINST A LIVE CHAIN):** The item is still listed as OPEN AND BLOCKING, and the round 26 verdict confirms it has not been exercised. However, the validation record shows that the suite passes 844/844 on-chain assertions, which includes distribution tests. The distinction is that these are on a local validator, not a live chain.

**Evidence:** The round 26 verdict states "The crank's own I/O against a live cluster with ~2,100 vaults... is not" exercised, confirming this is still open.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Run the mainnet dress rehearsal (item 22) with a live cluster.** The AI audit cannot execute live transactions against mainnet. The project must run the full revenue cycle through both pools, force a post-sweep failure, and walk through the hand recovery procedure. This must be done with real (small) amounts and recorded with transaction signatures.

2. **Deploy and verify the redeem page (item 50).** The AI audit can verify that `judgeRedemptionCoverage` is a pure function with the right logic, but it cannot build or test the actual user interface. The project must build the redeem page, ensure it runs `judgeRedemptionCoverage` before the holder signs, and verify it sweeps through the helper program.

3. **Conduct a multi-model audit round with a different roster.** The round 26 verdict notes that programs pass lacked quorum (5/8, six required). The project must run a full audit round with a different set of models to achieve the required quorum.

4. **Execute the mainnet deployment and lock ceremony.** The AI audit can verify the build process and the byte-identity of the programs, but it cannot execute the actual deployment. The project must deploy all five programs, verify the deployed bytes against `scripts/build-mainnet.sh`'s sha256, and remove the upgrade authority from all programs.

5. **Fund the revenue address above rent exemption (item 52).** The AI audit can verify the code handles this correctly, but it cannot fund the address. The project must ensure the revenue address, pool, and Squads cbBTC accounts exist and are funded before the first paid mint.

6. **Set the charter opening date and lock deadline (item 38).** These values are still OPEN in `launch/mainnet-init.json`. The project must set these dates, ensuring the lock deadline is at least 24 hours before the charter opening, and run `scripts/check-launch-params.mjs` to verify all values are correct before signing any transactions.