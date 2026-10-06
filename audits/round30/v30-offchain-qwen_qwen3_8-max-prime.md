# Round 30 Independent Audit — Off-Chain Pipeline and Programs

## R0: Round 29 Verdict Verification

I independently verified the three round-29 findings and their repairs against the current tree.

**M1 (log truncation halting scanners):** The repair holds. `bank/txread.mjs` `validateParsedTransaction` now accepts `{ truncatedLogs: 'flag' }` and returns the transaction marked `logsTruncated: true` while still validating every other field. All three walking scanners (`bank/alarm.mjs`, `bank/revenue.mjs` `splitsSince`, `bank/redemption-poster.mjs`) pass `{ truncatedLogs: 'flag' }`. The alarm pages `log_coverage_gap`, skips event parsing for that transaction, still runs instruction detectors, and advances the cursor. Revenue reads outflow from instructions, not logs. The poster queues a REJECTED hand-draft only for top-level BURN calls. The selftest arms at lines tagged "R29 M1" prove all three consumers handle the flagged shape and still refuse every other defect. **Repair confirmed.**

**L1 (coverage gate scope):** The repair holds. `scripts/audit-coverage.sh` now enumerates `git ls-files 'programs/*' 'bank/*' 'scripts/*' 'sim/*' 'launch/*' 'tests/*' SPEC.md DESIGN-v6.md HOLDER-GUIDE.md Cargo.toml Anchor.toml`, which includes `sim/fixtures.mjs` and the program manifests. It exits 2 if git cannot list files and refuses an empty listing. **Repair confirmed.**

**D1 (selftest source-scan labels):** The repair holds. `bank/selftest.mjs` `srcFiles` now includes `tests/*.mjs` alongside `tests/*.ts`. The assertion labels match the scanned scope. **Repair confirmed.**

I also verified the round-29 claim that the detector selftest produces 891 assertions. The `FLOOR` constant in `bank/selftest.mjs` is 891, and `DET_FLOOR` in `scripts/run-tests.sh` is 891. The floor-equality check (`[ "$n" -eq "$4" ]`) ensures they must match. **Consistent.**

## R1: The Crank (`bank/crank.mjs`)

I traced every instruction the crank constructs against the MINT program's account structures and instruction signatures.

**Instruction construction verified correct for all nine MINT instructions the crank sends:**
- `reschedule_reveal`: 1 account (vault_record). Matches `RescheduleReveal`. ✓
- `capture_entropy`: 2 accounts (vault_record, slot_hashes). Matches `CaptureEntropy`. ✓
- `reveal_level`: 9 accounts, data = disc + Borsh `Vec<VaultAttribute>`. Matches `RevealLevel`. The `attrsBorsh` serialization matches Anchor's Borsh for `Vec<VaultAttribute { key: String, value: String }>`. ✓
- `retire_burned`: 3 accounts. Matches `RetireBurned`. ✓
- `activate`: 5 accounts. Matches `Activate`. ✓
- `claim` (for joins and deliveries): config + pool + token_program + pairs. `crank_n = 0`. Matches `Claim`. ✓
- `expire_boosts`: config + records. Matches `ExpireBoosts`. Batch size 20 ≤ `MAX_EXPIRE_BATCH` (30). ✓
- `split_revenue`: 7 accounts, data = disc + decimals byte. Matches `SplitRevenue`. ✓
- `distribute`: config + pool, data = disc + `[0]` (free path). Matches `Distribute`. ✓

**Order verified correct:** reschedule → capture → reveal (strict mint order) → retire → preJoins → preExpires → split → distribute → postExpires → activates → claims. This matches the requirement that joins happen before distribute (red-team 3 finding 6), activates happen after distribute, and due boosts are expired before distribute.

**Weight arithmetic verified:** `w = total_active_weight + preJoinWeight - retiringWeight - expiringWeight`. The `retiringWeight` includes level + boost weight (matching MINT's `weight_of`). The `expiringWeight` is boost weight only. Vaults being retired are excluded from `preExpires` (the `retiring.has(r.address)` check), preventing double-subtraction. The `pendingScaled` formula matches MINT's `owed_of`: `(level_weight + boost) * acc + carry - debt`. ✓

**Fee budgeting verified:** `planCostLamports` counts one signature fee per transaction plus reveal attribute rent. `budgetPlan` drops reveals from the end (latest first) when the key can't afford all, preserving mint order. The `judgeFeePayer` function checks the minimum before the ceiling (round 24 L6a fix confirmed). ✓

**Race handling verified:** `BENIGN` covers all expected race codes. `judgeDistributeRefusal` re-reads the config and checks if the epoch moved. `PoolShort` is never benign. The `mintFailureCode` function correctly tracks the invoke stack and only attributes AnchorErrors to MINT when MINT is on top. ✓

**No defects found in the crank.**

## R2: The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

I verified the detector logic against the MINT program's semantics.

**`detectDistributionOverdue`:** Correctly checks `last_distribute_at + monthly_secs` against the chain clock. The `joins_stalled`, `boosts_stalled`, and `launch_tick_overdue` sub-checks use appropriate grace periods. The `w === 0` early return prevents false positives when no vaults are active. ✓

**`detectPoolHealth`:** The `owedCeil` calculation `(owed + 999_999_999_999n) / 1_000_000_000_000n` matches MINT's `ceil_sats`. The insolvency check `pool_amount < owedCeil` is correct. ✓

**`detectRedemptionRate`:** The `redemptionCapacity` function mirrors BURN's rolling-window arithmetic: `cap = max(1, ceil(live * 210 / 10000))`, bounded by the 64-slot ring. The `inWindow` count uses the ring times. ✓

**`detectUnsweptRoyalties`:** The grace period adjusts based on the on-chain cooldown. The clock restarts on balance fall. The `sweepStopped` check prevents false positives during a guardian stop. ✓

**`detectConfigDrift`:** The `WATCH` list covers all fixed-forever fields, vote-reachable fields, guardian stops, and program bytes. The `carryConfigBaseline` function (round 24 L5) preserves the last non-null value across failed reads, preventing drift from being hidden by a one-pass blip. ✓

**`detectUpgradeAuthorityAfterLock`:** The `lockDeadlineOf` function takes the earlier of the box file and MINT's `charter_opens_at`. The production check covers all five programs (seal, mint, burn, gov, sweep). ✓

**`readConfigs`:** Reads all four config accounts through `L.readPinned`, which checks owner, discriminator, and version. A missing account sets `_missing`. A malformed account throws (failing the pass). The `missingWatchedKeys` check ensures every watched key is produced. ✓

**Log truncation handling (round 29 M1 repair):** The alarm passes `{ truncatedLogs: 'flag' }`, pages `log_coverage_gap` for truncated transactions, skips event parsing but still runs instruction detectors, records the gap in state, and advances the cursor. The `logGaps` state is capped at 500 entries. ✓

**No defects found in the alarm.**

## R3: The Layouts (`bank/layout.mjs`)

I verified the layout definitions against the Rust structs.

**Struct field lists:** The `STRUCTS` definitions for `SealConfig`, `MintConfig`, `VaultRecord`, `BurnConfig`, and `GovConfig` match the Rust source. The selftest's `parseRustStruct` comparison (which parses the actual `pub struct` from the `.rs` files) enforces this. ✓

**Cross-program offsets:** The selftest scrapes all `OFF_*` constants from the four program source files and compares them against `L.offsets()`. The check includes all offsets pinned by GOV, BURN, and MINT. The "L2" arm ensures no scraped offset goes un-compared. ✓

**PDA seeds:** The `SEEDS` object is compared against the `pub const *_SEED` declarations in each program. The "D6" arm enforces this. ✓

**Layout versions:** The selftest scrapes all `*VERSION` constants from the program source and compares them against `STRUCTS[*].version`. The "L6" arm enforces this. ✓

**Account sizes:** The selftest scrapes `MINT_CONFIG_SPACE` and `VAULT_RECORD_SPACE` from the MINT source, evaluates the expressions, subtracts padding, and compares against `L.fixedLength()`. The "L13c" arm enforces this. ✓

**`collectionPluginsHash`:** Correctly skips the base fields (key, update_authority, name, uri, num_minted, current_size) and hashes only the plugin region. The selftest verifies that changing `num_minted` doesn't change the hash but changing a plugin byte does. ✓

**No defects found in the layouts.**

## R4: The Money Arithmetic (`bank/accrual.mjs`)

I verified each function against the MINT program.

- `ceilSats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE`. Matches MINT's `ceil_sats`. ✓
- `available`: `poolBalance - ceilSats(owedScaled)`, floored at 0. Matches MINT's `distribute` logic. ✓
- `credit`: `delta = avail * ACC_SCALE / w; acc += delta; owed += delta * w`. Matches MINT's `credit`. ✓
- `pendingScaled`: `(weight + boost) * acc + carry - debt`. Matches MINT's `owed_of`. ✓
- `reweigh`: `carry = owed; debt = new_weight * acc`. Matches MINT's `reweigh`. ✓
- `debtAtActivation`: `weight * acc`. Matches MINT's `join` (debt = weight * acc at join time). ✓

The selftest's 39 assertions cover weights, distributions, dust, timing, pool arithmetic, frozen/retired vaults, and the $CBOB boost. The floor is 39 and the equality check enforces it. ✓

**No defects found in the arithmetic.**

## R5: The Swap and Revenue Cycle

### Oracle math (`bank/swap.mjs` `oracleFloor`)

The formula `sats = lamports * sol.price * 10^(sol.expo - btc.expo) / (btc.price * 10)` is correct. For typical Pyth feeds (both expo = -8), this simplifies to `lamports * sol.price / (btc.price * 10)`. The BigInt arithmetic avoids floating-point errors. The `minSats` is `expectedSats * 8500 / 10000` (150 bps tolerance). ✓

The `satsPerLamport` float is used only for the deviation check, not for the on-chain floor. The precision loss is acceptable for a ratio comparison. ✓

### Pyth verification (`readPyth`)

The function checks: account exists, owned by the Pyth receiver, verification level is Full (byte = 1), feed ID matches, and reads price/conf/expo/publishTime at the correct offsets (73, 81, 89, 93 after the 8-byte discriminator and 32-byte write_authority). The minimum length check (101 bytes) covers all read fields. ✓

The `oracleFloor` function checks: price > 0, age ≤ 180s, future stamp ≤ 30s, confidence ≤ 30 bps of price. All checks use the chain clock. ✓

### Deviation filter

`orcaSpot`: `(sqrtPrice / 2^64)^2` gives raw token B per raw token A, which is sats per lamport for the wSOL/cbBTC pool. ✓

`meteoraSpot`: `1 / (1 + binStep/10000)^activeId` gives the inverse of lamports per sat, which is sats per lamport. ✓

The 100 bps deviation gate is applied to both venues. ✓

### Minimum out

Both venues use `minSats` from `oracleFloor`. For Orca, it's `other_amount_threshold` at data offset 16. For Meteora, it's `min_amount_out` at data offset 16. The judge verifies both. ✓

### The judge (`judgeSwapInstructions`)

The judge requires the exact 7-instruction sequence:
0. SetComputeUnitLimit(400,000), no priority fee
1. ATA CreateIdempotent for wSOL
2. System Transfer of exactly `lamportsIn` to own wSOL ATA
3. SyncNative
4. ATA CreateIdempotent for cbBTC
5. Venue swap with correct amount, floor, direction, pool, input/output accounts, signer
6. CloseAccount of wSOL back to owner

I verified all key indices for both venues:
- Orca: pool at 2, wSOL at 3, cbBTC at 5, signer at 1. Data: 42 bytes, amount at 8, floor at 16, sqrt_price_limit at 24, exact-input at 40, a_to_b at 41. ✓
- Meteora: pool at 0, wSOL at 4, cbBTC at 5, signer at 10. Data: 24 bytes, amount at 8, floor at 16. ✓

The selftest's round-25 L1 arms verify that all eight tamper scenarios from the round-25 verdict are refused. ✓

### Account derivation

Orca tick arrays: `orcaTickArrayStarts` computes the current array and two below for a_to_b swaps. The seed is `["tick_array", pool, start_index]`. ✓

Meteora bin arrays: `meteoraBinArrayIndexes` computes the current array and two above for Y-to-X swaps. The seed is `["bin_array", pool, index_as_i64]`. ✓

### wSOL handling

The swap wraps exactly `lamportsIn`, syncs, swaps, and closes. The close returns any remaining lamports to the operator. If the swap consumes less than the input (which shouldn't happen with exact-input), the close returns the excess. ✓

### Failure and retry (`classifySendFailure`)

The classification is correct:
- Preflight refusal → refused (nothing moved)
- Landed with error → refused (nothing moved)
- Landed successfully → landed (record it)
- Expired with no status → refused (never landed)
- Unknown → unknown (cycle stays open, loud direction)

The revenue cycle only tries the next venue on a refusal, never on an unknown send. This prevents double-swapping. ✓

### Revenue cycle ledger

The intent is written before the sweep. The `cycleIsOpen` predicate correctly requires both a return and a split. The `closesCycle` function anchors splits to the return's block time. The `detectSplitClaims` function verifies splits against the chain and checks for reuse, anchoring, and the verification window. ✓

**No defects found in the swap or revenue cycle.**

## R6: The Gates

### `bank/selftest.mjs`

The selftest has 891 assertions behind a floor that must EQUAL the count. The floor-equality check prevents slack accumulation. Every detector is proven in both directions (fires when it should, quiet when it should). The selftest includes:
- Layout comparisons against Rust source
- Cross-program offset checks
- Seed and version checks
- Account size checks
- All detector both-ways arms
- Lock mechanism race tests
- Revenue cycle predicate tests
- Swap judge tamper tests
- Router integration tests

The "L13b" arms verify that the wiring gate catches deleted, commented-out, and result-discarded detector calls. The "H1" arms verify the alert router behavior. ✓

### `scripts/run-tests.sh`

The runner has floors for all test suites:
- MIN_ASSERTIONS = 855 (on-chain)
- DET_FLOOR = 891 (detector)
- ALLOC_FLOOR = 39 (allocation)
- POSTER_FLOOR = 22 (poster)
- POB_FLOOR = 14 (Proof-of-Burn)
- LAUNCH_FLOOR = 47 (launch params)
- MAINNET_FLOOR = 33 (mainnet probe)
- HOST_FLOOR = 6 (host unit tests)
- EXPIRY_FLOOR = 4 (expiry budget)
- SWAP_FLOOR = 16 (swap fork)

All floors use equality checks. The Core hash is pinned and non-overridable. The runner refuses to certify against a validator without real Core. ✓

### `sim/swap-fork.sh`

The swap fork has SWAP_FLOOR = 16 and runs against cloned mainnet pool state. It tests both venues, the oracle floor, the deviation gate, and the judge. ✓

### `scripts/build-mainnet.sh`

The build script proves which INIT_AUTHORITY each program carries by deploying both mainnet and localnet builds and checking that mainnet rejects the test key while localnet accepts it. It also verifies the sweep helper's byte identity across mainnet, localnet, and target/deploy builds. ✓

### `scripts/cron-install.sh`

The installer uses `flock -n` for all money jobs. The preservation logic only arms `--live` from tagged, uncommented lines. The selftest verifies this with the actual shell logic. The installer refuses rehearsal trees. ✓

**No defects found in the gates.**

## Accepted Limits: The Four Questions

### 1. Is any limit WORSE than stated?

I checked each accepted limit against the code. **No limit is worse than stated.** Specifically:

- Limit 10 (swap operator): The cap × cooldown × guardian-stop-time bound is accurate. The guardian can only stop, not help a thief. The round-25 D1 correction (half of live vaults at proposal creation, not at execution) is correctly stated.
- Limit 28 (Coinbase freeze): The frozen-pool redemption forfeit (stage 3c) is correctly described. The in-line monthly run correctly skips frozen pools.
- Limit 40 (Core upgradeable): The three concrete consequences (tombstone, UpdatePluginV1, ExecuteV1 authority) are accurately stated. The round-28 Autograph boundary is correctly described as bounded observations, not a proof.
- Limit 46 (PoB hot wallet): The charter-window exposure is accurately bounded. The post-window exposure correctly ends.
- Limit 56 ($CBOB hot key): The custody risk is accurately stated. The mint itself is safe (no mint/freeze authority).

### 2. Is anything listed as a limit not actually a limit?

**No.** Each accepted limit describes a real constraint. Limit 55 (unsplit revenue) is bounded by the crank's hourly split, but it's still a real edge case. Limit 32 (rate limit queues) is a real constraint on honest holders.

### 3. Is any DISCHARGED item not actually discharged?

**No.** I checked each discharged item:
- Item 51 ($CBOB boost): Built, tested, and mirrored off-chain. The `BoostsExpireFirst` gate and the carry arithmetic are verified.
- Item 54 (compute): Measured with real CU counts. The holder-page obligations are correctly stated.
- Items 12/17 (compute units): Measured on the v5 artifact. The byte-wall-binds-first conclusion is correct.
- Item 14 (duplicate attributes): Closed on-chain with `DuplicateAttribute`.
- Item 19 (unlevelled vault halt): Closed by construction (activate requires a drawn level).
- Items 30, 31, 33: Superseded by stage 3b/3c changes.
- The v5 items (1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24): Gone with the Bank/deck/distributor.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**No.** All five OPEN AND BLOCKING items (22, 38, 50, 52, 53) are explicitly marked as open in the code and documentation. The launch checker (`check-launch-params.mjs`) refuses to pass while `charter_opens_at` and `lock_deadline` are null. The holder guide is marked DRAFT and cannot be published before item 50 ships.

## Findings

**I found no CRITICAL, HIGH, or MEDIUM defects.** After tracing every instruction the crank constructs, every detector's logic, every layout offset, every arithmetic formula, every swap instruction, and every gate, the code is consistent with the programs it mirrors and the specifications it claims to implement.

I note the following LOW-severity observations, none of which represent a surviving defect:

**LOW-1: The alarm's `logGaps` state is capped at 500 entries.** If more than 500 truncated-log transactions accumulate, the oldest are dropped from the state record. This does not affect paging (each gap is paged when it occurs) or cursor advancement. It only affects the historical record. The cap prevents unbounded state growth. *Evidence:* `bank/alarm.mjs` line writing `logGaps: [...].slice(-500)`. *Impact:* None on detection or paging. Cosmetic only. *Fix:* None needed; the cap is reasonable.

**LOW-2: The crank's `planCrank` uses `records.find()` in several reduce loops, giving O(n²) behavior.** With 2,100 records, this is ~4.4M comparisons per pass. At the hourly full-pass cadence, this is negligible. *Evidence:* `planCrank` lines using `records.find(x => x.address === addr)` inside `reduce` calls. *Impact:* None at current scale. Would matter only at 10x+ scale. *Fix:* None needed before launch.

**LOW-3: The `mintFailureCode` function's regex for AnchorError (`/^Program log: AnchorError\b.*\bError Code: (\w+)\./`) assumes a specific log format.** If a future Anchor version changes the format, the regex would fail to match, and the error would be treated as a non-benign failure. The selftest pins the current format. *Evidence:* `bank/crank.mjs` `mintFailureCode` regex; selftest arms using `AnchorError thrown. Error Code: <code>.` format. *Impact:* A future Anchor upgrade could cause false failures (loud, not silent). *Fix:* None needed; the suite would catch a format change.

## What This Project Should Do Before Launch That AI Audit Structurally Cannot

1. **Complete the mainnet dress rehearsal (item 22) with all five named items.** The crank's live I/O against a real cluster, the alarm's live passes in rehearsal mode, one full revenue cycle through each pool, one forced post-sweep failure walked through hand recovery, and one DAS read of a burned Core asset. These exercise network conditions, RPC rate limits, and real transaction confirmation that no local validator can replicate. Record every transaction signature.

2. **Build the holder surfaces (item 50) before publishing the holder guide.** The deposit-address page, the redeem page with `judgeRedemptionCoverage`, and the redemption poster's sender mechanism are all promised to holders. The guide is DRAFT and must not ship without them. The redeem page is the only pre-signature check for undeclared airdrops and nested vaults (items 9 and 44).

3. **Set the charter opening date and lock deadline (item 38).** These are the two remaining OPEN values in `launch/mainnet-init.json`. The lock deadline must be at least 24 hours before the charter opening (enforced by `check-launch-params.mjs`). Both must be RULED before the initialize transactions are signed.

4. **Create the three cbBTC accounts and fund the revenue address (item 52).** The pool's ATA (MINT config PDA), the revenue address's own ATA, and the CBOBTC Squads' ATA must all exist before the first split. The revenue address must hold rent exemption. Road step 10 does this idempotently.

5. **Run the rehearsal at throwaway IDs (item 53) at the release commit.** The round-24 D4 proof is stale (it's from `d57ee3a`). The full `run-tests.sh` must pass inside the rehearsal tree at the actual release commit. The rehearsal alarm must run with `CBOB_ALARM_REHEARSAL=1` and its notices must go to a separate alert directory.

6. **Perform the initialize ceremony with independent witnesses.** The four `initialize` transactions write every permanent value. Each must be built from `launch/mainnet-init.json` (not typed by hand). The checker validates the JSON, not the signed transaction. At least two independent parties should verify the transaction contents before signing. The SEAL initialize must go first (MINT and BURN refuse without it).

7. **Set up monitoring that survives the operator's box.** The alarm, the revenue ledger, and the crontab all run under one user on one box (accepted limit 10, point 3). An independent monitoring system (a separate box, a separate user, or a third-party service) should watch the alarm's state file and the on-chain config accounts. The dead-man's switch in `cron-install.sh` helps, but it runs on the same box.

8. **Verify the deployed bytes against `build-mainnet.sh`'s sha256 after deployment.** The build script produces the artifacts and proves which INIT_AUTHORITY they carry. After deploying, dump each program's bytes from the chain and compare against the `dist/SHA256SUMS` file. Then remove the upgrade authority from all five programs (four vault programs + sweep helper) in a single, witnessed ceremony.

9. **Have a concrete plan for the first 72 hours after launch.** This is when issues are most likely. The plan should include: who monitors the alarm, who holds the guardian key, who can sign the swap operator key, how to contact Gary, and what to do if the alarm pages CRITICAL. The first charter window (7 days) is the highest-risk period because the PoB hot wallet is exposed (limit 46).

10. **Do not treat this audit as a clean round.** I found no defects, but I am one model reading the code statically. The ship gate requires two consecutive clean rounds with different model rosters. This round should count toward that requirement only if the project's quorum rules accept it. The next round must use a different roster.