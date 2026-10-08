# Round 39, Off-Chain Pass — Independent Audit

## R0. Round 38 Verdict Verification

I independently verified all four confirmed findings from round 38 and their repairs.

**C01 (LOW): Frozen-pool joins planned but never sent.** VERIFIED REPAIRED. The fix is at `bank/crank.mjs` lines ~530-535: the `else if (poolOk && pool.frozen && plan.joins.length)` branch now batches `plan.joins` into `plan.claims`. The selftest arm `R38 C01` asserts `p.claims.length === 1`, `p.claims[0]` contains the vault record, and `Object.keys(p.owed).length === 0` — verifying what is SENT, not just what is planned. I confirmed `main()` sends `plan.claims` unconditionally. The preJoins (eligible vaults from prior epochs) are sent before distribute regardless of pool state, which is correct since join-only claims don't touch the pool. The postExpires are sent after the tick, which is correct since `expire_boosts` doesn't touch the pool either.

**C02 (INFO): `detectSweepState` JSDoc contradicted code.** VERIFIED REPAIRED. The comment at `bank/detectors.mjs` now reads "within half a cooldown" and "There is no baseline-only first pass: a missing `judgedThrough` is 0 (review 32), so the first pass judges too." Both match the code: `half = Math.floor(cooldownSecs / 2)` with `|t - st| <= half`, and `judgedThrough ?? 0`. The comment even carries a "(Round 38 C02: ...)" note acknowledging the fix.

**C03 (INFO, doc exception): SPEC limit 10 deviation check wording.** VERIFIED REPAIRED. SPEC now reads "A pool whose spot price is more than 1% from the oracle at the read the swap is built from is skipped; the earlier read only decides whether to sweep at all (round 38 C03)." This matches the code: `m1.venues` gates the sweep decision; `m2.venues` gates the actual swap.

**C04 (INFO, doc exception): Limit 7 omitted the reconcile lane.** VERIFIED REPAIRED. SPEC limit 7 now reads "(the crank, the reveal lane, revenue, and the daily `--reconcile`; round 38 C04: the reconcile lane has no deadman, so its stall is silent, which costs only the daily undeclared-account report, never a payout)."

**Round 38 measurement limits acknowledged.** The verdict states it ran no validator, no `run-tests.sh`, no crank/alarm/revenue execution. Its C01 verification was by planner probe and source reading, not by running the crank against a chain. I note this limitation but found no reason to doubt the source-level analysis.

## R1. The Crank (`bank/crank.mjs`)

**No new defects found.** Specific verifications:

- `planCostLamports` correctly counts `p.claims.length` (batches, not individual claims), `ceil(p.preJoins.length / CLAIM_BATCH)`, and `ceil(p.preExpires.length / EXPIRE_BATCH)`. The frozen-pool join batches are included in `p.claims.length`.
- `budgetPlan` correctly runs the base plan (everything except reveals) whenever the key covers it, and budgets reveals from remaining room above the floor. The floor is preserved on every branch.
- `judgeDistributeRefusal` correctly treats `PoolShort` as always-fail, BENIGN errors as benign, and race errors (`NothingToDistribute`, `BoostsExpireFirst`, `JoinWaitingFirst`) as benign only when `dist_epoch` or `last_distribute_at` moved.
- The reveal loop correctly stops at the first failure or benign result, maintaining strict mint order.
- `judgeRevealAttrs` correctly distinguishes 'send' (hash matches), 'revealed' (hash matches without `level` key), and 'mismatch'.
- `attrsBorsh` matches MINT's Borsh serialization of `Vec<VaultAttribute>`: u32 count, then per attribute u32 key length + key bytes + u32 value length + value bytes.
- `readySlot` correctly computes two 4-slot leader group strides: `(floor(a/4) + 2) * 4` applied twice.
- The `destOf` function correctly uses `r.vault_ata` for pending vaults and `tokens[r.asset]?.address` for others.

**One observation (INFO):** The crank's `planCrank` does not populate `plan.owed` when the pool is frozen (the claims section is skipped). This means the heartbeat's `problems` won't include owed-vault information during a freeze. This is acceptable: the alarm's `distribution_overdue` and `joins_stalled` detectors cover the liveness gap, and a frozen pool can't pay anyway.

## R2. The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

**No new defects found.** Specific verifications:

- `detectSweepState` correctly uses the smallest-ever-seen cooldown (capped at 21600) for the half-cooldown window, per SPEC's "a vote can only LENGTHEN it" reasoning.
- `carryConfigBaseline` correctly carries forward last-known values, skipping `_missing` flags. This works with `detectConfigDrift`'s L11 skip (program appearing for the first time) and L5 fix (change across a failed read is detected).
- `detectLogGaps` correctly never drops unreviewed gaps, trims only the reviewed prefix, and escalates to CRITICAL above 2000 unreviewed.
- `detectDistributionOverdue` correctly checks `joins_stalled`, `boosts_stalled`, `launch_tick_overdue`, and `distribution_overdue` with appropriate conditions.
- `redemptionCapacity` correctly computes `ceil(live * 210 / 10000)` with floor 1 and cap 64, and counts in-window redemptions from the rate ring.
- `detectPoolHealth` correctly computes `ceil(owed_scaled / ACC_SCALE)` for the solvency check.
- `detectConfigDrift` correctly handles the L11 skip (program appearing) and the THIRD_PARTY_KEYS baseline skip.
- The `ALARM_KINDS` classification table correctly classifies all finding kinds as 'once', 'level', or 'info'.
- `planAlarmNotices` correctly sends one notice per kind, marks one-shot kinds as urgent, and sends RECOVERY for level kinds that clear.

## R3. The Layouts (`bank/layout.mjs`)

**No new defects found.** I verified field-by-field that all four layout definitions match the Rust structs:

- `MintConfig` (version 6): 68 fields, all matching the Rust struct including the stage-3c and boost fields.
- `VaultRecord` (version 4): 20 fields, matching including `pending`, `request_epoch`, `boost_weight`, `boost_end_epoch`, `carry_scaled`.
- `BurnConfig` (version 4): 7 fields including the 64-slot rate ring.
- `GovConfig` (version 4): 11 fields.
- `SealConfig` (version 2): 4 fields with `Vec<Pubkey>` for reserve_mints.

The `offsets` function correctly stops at the first variable-length field (`Vec<Pubkey>` in SealConfig). The `decode` function correctly checks discriminator, version, and field types. The `encode` function correctly round-trips.

The SEEDS constant matches the programs' seed constants (verified by the selftest's D6 arm, which scrapes each program's `pub const *_SEED` declarations).

## R4. The Money Arithmetic (`bank/accrual.mjs`)

**No new defects found.** I verified each function against MINT's Rust:

- `credit`: `delta = avail * ACC_SCALE / w` (integer division), matching Rust's `checked_mul(ACC_SCALE) / w`.
- `pendingScaled`: `(weight + boost) * acc + carry - debt`, matching Rust's `owed_of`.
- `reweigh`: `carry = owed`, `debt = (weight + boost) * acc`, matching Rust's `reweigh`.
- `ceilSats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE`, matching Rust's `ceil_sats`.
- `available`: `balance - ceilSats(owed)`, clamped to 0, matching the planning logic.
- `debtAtActivation`: `weight * acc`, matching the join-time debt.

The selftest's 39 assertions cover weights, distributions, dust carrying, timing, pool arithmetic, frozen/retired vaults, and the boost mechanism.

## R5. The Swap and Revenue Cycle

**No new defects found.** Specific verifications:

- `oracleFloor`: The formula `expectedSats = lamportsIn * sol.price / (btc.price * 10)` is correct for converting lamports to sats via USD prices. The exponent handling (`e = sol.expo - btc.expo`) correctly adjusts for different exponents. With both at -8, no adjustment is needed. The `satsPerLamport` float is correct for the deviation check.
- `readPyth`: The PriceUpdateV2 layout is correctly parsed: 8-byte discriminator, 32-byte write_authority, 1-byte verification_level (must be 1 = Full), 32-byte feed_id, then price/conf/expo/publishTime. The minimum length check of 101 bytes is correct.
- `orcaSpot` and `meteoraSpot`: Both return prices in sats per lamport directly, because wSOL base units are lamports and cbBTC base units are sats. No decimal adjustment is needed. I initially suspected a factor-of-10 error but verified this is correct.
- `judgeSwapInstructions`: Thoroughly checks all 7 instructions, amounts, floor, direction, accounts, and signer. The Orca key positions (input at 3, output at 5, signer at 1) and Meteora key positions (input at 4, output at 5, signer at 10) are correct.
- `sweepAmount`: Correctly computes `balance - reserve`, capped by `maxPerCycle` and `chainCap`, returning 0 below `MIN_SWEEP_LAMPORTS`.
- The revenue cycle flow correctly handles: cooldown check, open-cycle recovery, operator balance, market reads (m1 for sweep decision, m2 for swap), re-quote drift check, swap with fallback, return with delta check, and split with `splitByOther` recovery.
- `classifySendFailure` correctly distinguishes refused (preflight or on-chain failure), landed (confirmation succeeded), and unknown (status unavailable).

**One observation (INFO, already noted as round 38 C12):** The judge does not pin Meteora's `host_fee_in` account. This is a protocol fee account, not a value-moving account for the operator. The floor binds the operator's output. Acceptable.

## R6. The Gates

**No new defects found.** Specific verifications:

- `scripts/run-tests.sh`: All floors match their sources. MIN_ASSERTIONS=895, DET_FLOOR=926, ALLOC_FLOOR=39, POSTER_FLOOR=24, MAINNET_FLOOR=33, HOST_FLOOR=6 (5 written tests + 1 Anchor-generated `test_id`), LAUNCH_FLOOR=49, POB_FLOOR=14, EXPIRY_FLOOR=4, SWAP_FLOOR=16. The `floor()` function enforces equality, not just lower bound.
- `scripts/build-mainnet.sh`: Correctly builds both mainnet and localnet, deploys each to a validator, verifies mainnet REJECTS the test key and localnet ACCEPTS it, and checks the sweep helper's byte identity across all three locations (dist/, target/deploy/, localnet build).
- `scripts/check-launch-params.mjs`: Correctly refuses OPEN values, checks ruled values against the alarm's production list, verifies initialize bounds, and recomputes the PoB root.
- `scripts/rehearsal-tree.sh`: Correctly creates a detached worktree, generates throwaway keypairs, applies the 6 substitutions, and proves the patch reverses to HEAD byte-for-byte.
- `scripts/cron-install.sh`: Correctly sets up 6 cron jobs with `flock -n`, preserves existing `--live` flags, and refuses rehearsal trees.
- `scripts/audit-coverage.sh`: Correctly checks that every tracked file's current content was in a completed, quorate round's bundle.

## Accepted Limits — Four Questions

**1. Is any limit WORSE than stated?** No. I verified the key limits against the code:
- Limit 10 (swap operator): The cap × cooldown × guardian-stop bound is correctly enforced on-chain.
- Limit 28 (Coinbase freeze): The frozen-pool forfeiture and frozen-account deferral are correctly implemented.
- Limit 32 (rate limit): The rolling window with 64-slot ring is correctly implemented.
- Limit 40 (Core upgradeable): The alarm correctly watches Core's upgrade authority and hash.
- Limit 46 (PoB collection hot key): The alarm correctly watches the collection's plugins and update authority.

**2. Is anything listed as a limit not actually a limit?** No. All listed limits correspond to real code behavior.

**3. Is any DISCHARGED item not actually discharged?** No. The discharged items (51, 54, 12/17, 14, 19, 30, 31, 33) are all correctly discharged by code changes or measurements.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?** No. Items 22, 38, 50, 52, and 53 are all clearly listed as OPEN AND BLOCKING. The launch values file (`launch/mainnet-init.json`) correctly marks `vault_collection`, `charter_opens_at`, and `lock_deadline` as OPEN. The `check-launch-params.mjs` script refuses to pass while any value is OPEN.

## Web Tests (`web/test/`)

**The tests are non-vacuous.** I verified that each test can fail when the property it names is broken:

- `plan.test.mjs` R38 C01 arm: Checks `p.claims.length`, `p.claims[0]` contents, and `Object.keys(p.owed).length`. Removing the frozen-pool branch would make `p.claims.length === 0`, failing the test.
- `plan.test.mjs` V38-2 arms: Check that late arrivals don't stop the send, known strays are still swept, and late deliverable strays are NOT delivered. Removing the standing consent would cause new ack ids not in the consented set, failing the test.
- `ceremony.test.mjs` B4 arms: Check that padded decoys don't stop the ceremony. Removing the B4 fix would cause `r.conflict` to be non-null, failing the test.
- `bundle.test.mjs`: Checks that the browser-settings bundle builds, the bundled `judgeLaunch` matches node's, and the layout decoder works with shimmed sha256.
- `proxy.test.mjs`: Checks the RPC proxy's method allowlist, request validation, and security properties.
- `meta.test.mjs`: Checks the metadata generator's output and fail-closed behavior.

**One observation (INFO):** The `web/test/run-all.mjs` floors total 618 assertions across 10 test files. I verified the floor values are present but did not independently count each file's assertions. The floors are enforced by the runner, which checks `m[1] === m[2]` (passed equals total) and `Number(m[2]) === floor`.

## FINDINGS

No CRITICAL, HIGH, or MEDIUM findings.

**INFO-1: `judgeSwapInstructions` does not pin Meteora's `host_fee_in` account.** Already noted as round 38 C12. The `host_fee_in` is passed as `opt(null, false)` (the program ID, Anchor's "None"). This is a protocol fee account, not a value-moving account for the operator. The on-chain floor binds the operator's output. No action needed unless the Meteora program changes its fee handling.

**INFO-2: The `orcaSpot` and `meteoraSpot` functions return raw pool prices that happen to be in sats per lamport.** This is correct because wSOL base units are lamports and cbBTC base units are sats, so no decimal adjustment is needed. However, this alignment is not documented in the code, which could confuse a future reader into thinking a decimal adjustment is missing. A comment noting the base-unit alignment would prevent a well-meaning "fix" that introduces a factor-of-10 error.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **Run the dress rehearsal (item 22) with real Sol before removing any upgrade authority.** The crank, alarm, and revenue cycle have never run against a live cluster. The rehearsal must include: one full revenue cycle through BOTH pools (Orca forced to refuse once), one forced post-sweep failure walked through hand recovery, and the crank running against the rehearsal deployment with real vaults. The rehearsal tree script exists but has not been executed at the release commit.

2. **Have a human read the four `initialize` transactions byte-by-byte against `launch/mainnet-init.json` before signing.** The `check-launch-params.mjs` script validates the JSON, not the signed transactions. Whoever builds the four `initialize` transactions must build them FROM that file, and a human should verify the mapping. The programs check less than the checker does (SEAL reads only owners; off-curve keys are accepted; `redeem_window_secs` may be anything from 10 s to 24 h).

3. **Verify the deployed bytes match `dist/` before removing upgrade authority, and dump-and-check again after removal.** Round 35 C1 added this to the road steps, but it must actually be done. The sweep helper's byte identity across dist/, target/deploy/, and the localnet build should be verified one final time.

4. **Fund the operator wallet above the 0.02 SOL floor and verify the revenue address holds rent before the first paid mint.** Item 52 requires the pool's, revenue address's, and Squads' cbBTC accounts to exist before the first split. Road step 10 creates them, but this must be verified.

5. **Test the alert delivery path end-to-end before launch.** The alarm sends notifications via `/opt/scripts/notify-gary-sms.sh`. Run the alarm with a deliberate finding (e.g., a config drift) and verify the notification arrives. The router's stream isolation, urgent breakthrough, and recovery paths should all be exercised.

6. **Publish the holder pages (item 50) before any vault is minted.** The redeem page's `judgeRedemptionCoverage` is the only pre-signature check for undeclared holdings. Without it, items 9 and 44 have no preventive control. The claim and buy pages are also needed for anyone to get a vault.

7. **Establish a human procedure for the CBOBTC Squads to return rescued vaults.** The `rescue_nested` instruction sends vaults to the Squads, but the return is a person's act. The procedure should be documented and tested before any vault is minted.