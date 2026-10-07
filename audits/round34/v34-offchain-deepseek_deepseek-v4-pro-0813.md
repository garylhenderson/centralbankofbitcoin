# Independent Security Audit: CBOB Vaults v6 Off-Chain Pipeline

## R0. Round 33's Verdict and Repairs

Round 33's verdict is **NOT CLEAN** with four confirmed findings (one LOW, three INFO). I have independently verified each repair in the current tree:

**L1 (LOW): Clock domain mixing in `detectSweepState`.** The repair at `bank/detectors.mjs` lines 996-1016 now uses a symmetric window `|t - st| <= cooldown/2`. I verified the repair is correct: the window is now symmetric, and the selftest arms at lines 2373-2392 test both directions with skew values. The repair holds.

**D1 (INFO): Uncertain send explaining a sweep.** The repair requires `landed.has(c.pendingSweepSig)` for a pending sweep to explain a state sweep. I verified this in `detectSweepState` and the alarm's direct lookup at `bank/alarm.mjs` lines 759-765. The repair holds.

**D2 (INFO): `mint.last_sweep_at` missing from `WATCHED_KEYS`.** I verified it is now present at `bank/detectors.mjs` line 421. The repair holds.

**D3 (INFO): Launch count reader.** I verified the regex now matches "47 launch" at `bank/selftest.mjs` line 1021. The repair holds.

**Gate-5 obligation (pre-existing wSOL balance):** The verdict required a suite or fork arm for a native account with a balance closing. I verified `tests/3prog.test.ts` now has R33.G4 which tests exactly this. The obligation is discharged.

**Round 33's measurement limitations:** The verdict correctly notes that L1's skew was a stub clock, not measured box/chain drift. This limitation remains valid but the repair is sound.

**New defects introduced by round 33 repairs:** None found. The repairs are minimal and correctly scoped.

## R1. The Crank (`bank/crank.mjs`)

### Finding R1-1: MEDIUM — `planCrank` can plan a distribution that the program will refuse due to `JoinWaitingFirst` when a pre-join vault's asset reads as `'other'` but is actually live

**Construct:** `planCrank` at `bank/crank.mjs` lines 370-380. When an eligible vault's asset reads as `'other'` (null RPC answer), the code sets `unreadableEligible++` and pushes a problem, which prevents the distribution. However, if the asset read fails for a vault that is actually live and eligible, the crank skips the join and the distribution, but the program's `JoinWaitingFirst` check would still refuse any distribution sent by anyone else. This means the crank's own refusal to distribute is correct, but it also means the vault stays unjoined indefinitely if the RPC keeps failing for that specific asset.

**Evidence:** A test run with a mocked RPC that returns null for one specific asset while returning valid data for all others would show the crank repeatedly reporting "eligible to join but its asset reads as other" and never distributing, even though the vault is live and the program would accept a join if the crank could read the asset.

**Fix:** The crank should retry reading the asset a few times before giving up, or use a different RPC endpoint for the retry. Alternatively, the alarm should page on repeated `crank_problem` for the same vault, which it already does after 3 passes.

### Finding R1-2: LOW — `planCrank` can plan a claim for a vault whose asset was burned between planning and sending

**Construct:** `planCrank` checks `assets[r.asset] === 'burned'` at planning time, but the asset could be burned between planning and sending. The claim would then pay into a dead account (accepted limit 27). This is a race condition that the crank cannot fully prevent, but it could reduce the window by re-reading the asset state just before sending.

**Evidence:** A test with a mock that changes the asset state between `planCrank` and the send loop would show the claim being sent to a burned vault.

**Fix:** Re-read the asset state for each vault in the claim batch immediately before sending, or accept this as a sub-case of limit 27 (the cost is mainly the burner's own share).

### Finding R1-3: LOW — `budgetPlan` can drop reveals that are needed to unblock the FIFO

**Construct:** `budgetPlan` at `bank/crank.mjs` lines 520-540 drops reveals when the key balance is insufficient. If the dropped reveal is the FIFO head, the entire level queue stalls until the key is topped up. The alarm's `reveal_queue_stalled` would page after 30 minutes, but the crank could prioritize reveals over captures when the balance is low.

**Evidence:** A test with a low balance and a FIFO head that needs revealing would show the crank spending its budget on captures while the reveal queue stalls.

**Fix:** Prioritize reveals over captures in `budgetPlan` when the balance is insufficient, or at least ensure the FIFO head's reveal is always funded.

## R2. The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

### Finding R2-1: MEDIUM — `detectStandingRisks` does not check `mint.swap_operator` against the ruled value in production

**Construct:** `detectStandingRisks` at `bank/detectors.mjs` lines 480-530 checks many production values but does not include `mint.swap_operator` in the `want` list. The swap operator is the one trusted key, and a wrong value at initialize would be permanent. The launch checker (`scripts/check-launch-params.mjs`) does check it, but the alarm should also page if it changes after launch.

**Evidence:** A test with `mint.swap_operator` set to a different key in production mode would show no `test_value_in_production` finding.

**Fix:** Add `['mint.swap_operator', 'bipP7uK5aQDsrChYA8hpZ1Thb8BCw7emRGuEkLkHg6G', 'the swap operator']` to the `want` list in `detectStandingRisks`.

### Finding R2-2: LOW — `detectUnsweptRoyalties` can be silenced by a balance that falls and rises between passes

**Construct:** `detectUnsweptRoyalties` at `bank/detectors.mjs` lines 690-710 restarts the clock when the balance falls between passes. An attacker could sweep a small amount (causing a fall) and then immediately deposit the same amount back, keeping the balance constant while the clock resets. This would delay the `royalties_unswept` page indefinitely.

**Evidence:** A test with alternating sweep/deposit transactions between alarm passes would show the clock never reaching the grace period.

**Fix:** Track the minimum balance seen since the last sweep, not just the previous pass's balance. Or accept this as a sub-case of the documented "incoming royalties can hide a successful sweep" limitation.

### Finding R2-3: LOW — `detectLogGaps` can be flooded with gaps that are never reviewed, growing the state file unboundedly

**Construct:** `detectLogGaps` at `bank/detectors.mjs` lines 1010-1030 keeps all unreviewed gaps. The SPEC says the list grows by at most 8,000 entries per pass, but an attacker can sustain this indefinitely, growing the state file without bound.

**Evidence:** A test with continuous gap generation would show the state file growing linearly with time.

**Fix:** Cap the unreviewed gap list at a fixed size (e.g., 10,000) and escalate to CRITICAL when the cap is reached, or require periodic review as a procedural control.

## R3. The Layouts (`bank/layout.mjs`)

### Finding R3-1: LOW — `parseRustStruct` does not handle multi-line field declarations

**Construct:** `parseRustStruct` at `bank/layout.mjs` lines 180-195 uses a regex that expects `pub name: Type,` on a single line. If a future struct change splits a field declaration across lines, the parser throws, which is the intended fail-closed behavior. However, the error message could be clearer about which line failed.

**Evidence:** A test with a multi-line field declaration would show the parser throwing with the line content.

**Fix:** Improve the error message to include the struct name and line number. This is cosmetic; the fail-closed behavior is correct.

### Finding R3-2: INFO — `offsets()` silently stops at the first variable-length field

**Construct:** `offsets()` at `bank/layout.mjs` lines 60-70 breaks at the first field with no fixed size. If a struct has a `Vec` followed by more fixed-size fields, those later fields have no static offset and are silently absent from the returned map. This is correct for the current structs (all `Vec` fields are last), but a future change could introduce a `Vec` in the middle.

**Evidence:** A test with a struct containing `Vec<Pubkey>` followed by `u64` would show the `u64` missing from the offsets map.

**Fix:** Add an assertion that variable-length fields only appear at the end of the struct, or document this limitation more prominently.

## R4. The Money Arithmetic (`bank/accrual.mjs`)

### Finding R4-1: LOW — `pendingScaled` can throw for a legitimate state when `carry_scaled` is large and `debt_scaled` is small

**Construct:** `pendingScaled` at `bank/accrual.mjs` lines 25-30 throws if `p < 0n`. The program's `owed_of` uses `checked_sub` and returns an error in the same case. However, the crank's `planCrank` catches this and pushes a problem, which means the vault is left out of every claim batch. If this state is reachable (e.g., due to a bug in the program's `reweigh`), the crank would silently skip the vault forever.

**Evidence:** A test with a crafted `VaultRecord` where `carry_scaled` is 0 and `debt_scaled` exceeds `weight * acc` would show the crank reporting a problem and skipping the vault.

**Fix:** The alarm should page on `crank_problem` for this specific error, which it already does after 3 passes. This is acceptable as a fail-loud mechanism.

### Finding R4-2: INFO — `credit()` does not check for `avail` overflow when multiplied by `ACC_SCALE`

**Construct:** `credit()` at `bank/accrual.mjs` lines 15-20 computes `avail * ACC_SCALE / w`. The program uses `checked_mul` and returns `Overflow` if the multiplication overflows. The off-chain mirror uses BigInt, which cannot overflow, so it would compute a value the program would refuse. This means the crank could plan a distribution that the program refuses with `Overflow`.

**Evidence:** A test with `avail` close to `2^64` and `w = 1` would show the off-chain mirror computing a value while the program would refuse.

**Fix:** Add an explicit check in `credit()` that `avail * ACC_SCALE` fits in u128 (i.e., `< 2^128`), matching the program's `checked_mul`.

## R5. The Swap (`bank/swap.mjs`) and Revenue Cycle (`bank/revenue.mjs`)

### Finding R5-1: MEDIUM — `oracleFloor` uses `Number()` for `satsPerLamport`, which can lose precision for large prices

**Construct:** `oracleFloor` at `bank/swap.mjs` lines 130-140 computes `satsPerLamport` as `Number(sol.price) * 10 ** sol.expo / (Number(btc.price) * 10 ** btc.expo) / 10`. The `Number()` conversion can lose precision for prices above `2^53`. Current prices are around `1.2e10` for SOL and `8.6e12` for BTC, which are well below `2^53`, but a future price spike could cause precision loss.

**Evidence:** A test with `sol.price = 2^60` and `btc.price = 2^60` would show `satsPerLamport` losing precision.

**Fix:** Compute `satsPerLamport` using BigInt division and convert to Number only for the deviation check, or use a higher-precision float library.

### Finding R5-2: LOW — `readPyth` does not verify the `write_authority` field

**Construct:** `readPyth` at `bank/swap.mjs` lines 95-110 reads the verification level, feed id, price, confidence, exponent, and publish time, but does not check the `write_authority` field (bytes 8-40). The SPEC says the account must be "fully verified" and "carry the expected feed id", but does not mention write authority. A malicious write authority could theoretically write a chosen price, but the account is a PDA under the push oracle program, so only the push oracle can write to it.

**Evidence:** A test with a crafted account where `write_authority` is a different key would show `readPyth` accepting it.

**Fix:** Add a check that `write_authority` is the expected push oracle program's authority, or document why this is not necessary.

### Finding R5-3: LOW — `judgeSwapInstructions` does not check the Meteora `host_fee_in` account

**Construct:** `judgeSwapInstructions` at `bank/swap.mjs` lines 280-340 checks the swap's input and output accounts, amount, floor, and direction, but does not check the Meteora `host_fee_in` account (key 9). The builder sets it to `None` (the program id), but a tampered builder could set it to a real account that takes a fee from the swap.

**Evidence:** A test with a tampered Meteora swap where `host_fee_in` is set to an attacker's account would show the judge passing it.

**Fix:** Add a check that `host_fee_in` is the Meteora program id (None) in `judgeSwapInstructions`.

### Finding R5-4: LOW — `classifySendFailure` treats an expired transaction with no status as `refused`, but the transaction could still land later

**Construct:** `classifySendFailure` at `bank/swap.mjs` lines 360-380 returns `refused` for an expired transaction with no status. However, Solana transactions can land after their blockhash expires if they are included in a block before the expiry. The `getSignatureStatuses` lookup with `searchTransactionHistory: true` should find it if it landed, but there is a race where the transaction lands after the lookup.

**Evidence:** A test with a mock that returns null for the first status lookup and a confirmed status for a later lookup would show the transaction being classified as `refused` when it actually landed.

**Fix:** For expired transactions, retry the status lookup a few times before classifying as `refused`, or classify as `unknown` and let the cycle stay open.

### Finding R5-5: INFO — `sweepAmount` does not check that `maxPerCycle` is below the program's `max_sweep_lamports`

**Construct:** `sweepAmount` at `bank/swap.mjs` lines 150-160 caps the amount at `maxPerCycle` and `chainCap`, but does not verify that `maxPerCycle <= chainCap`. The revenue job sets `MAX_PER_CYCLE_LAMPORTS = 50 SOL` and the program's cap is 10 SOL, so the program's cap wins. But if the constants drift, the job could plan a sweep above the program's cap, which would be refused.

**Evidence:** A test with `maxPerCycle = 100 SOL` and `chainCap = 10 SOL` would show `sweepAmount` returning 10 SOL, which is correct. The issue is only if `maxPerCycle < chainCap` and the job sweeps less than it could.

**Fix:** Add an assertion that `maxPerCycle <= chainCap` in the revenue job, or document that the program's cap is authoritative.

## R6. The Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

### Finding R6-1: MEDIUM — `scripts/audit-coverage.sh` can be satisfied by a round that bundled a file but whose verdict was not independently triaged

**Construct:** The coverage gate at `scripts/audit-coverage.sh` lines 80-120 checks that each file's current content was in a completed round's bundle with a quorate verdict. However, it reads the verdict's first line and checks for "QUORUM MET", but does not verify that the verdict was independently triaged (as opposed to being written by the runner itself).

**Evidence:** A test with a fabricated `VERDICT-offchain.md` that says "QUORUM MET" but was not independently triaged would show the gate passing.

**Fix:** Add a check that the verdict file was created by a process other than the runner, or require a signature or hash from the triage process.

### Finding R6-2: LOW — `scripts/run-tests.sh` does not verify that the swap fork's assertion count matches the floor when the fork is skipped

**Construct:** The runner at `scripts/run-tests.sh` lines 200-210 skips the swap fork when DNS fails, and only checks the floor when the fork runs. If the fork is skipped, the floor is not checked, and a certifying run could pass without the swap being proven.

**Evidence:** A test with `CBOB_SHIP_GATE=1` and DNS failure would show the runner exiting 0 without the swap fork running.

**Fix:** The ship gate already refuses a skipped mainnet probe, but the swap fork skip is not gated. Add the same `CBOB_SHIP_GATE` check for the swap fork.

### Finding R6-3: LOW — `scripts/build-mainnet.sh` does not verify that the sweep helper's bytes match the source at the current commit

**Construct:** The build script at `scripts/build-mainnet.sh` lines 100-120 checks that the sweep helper's mainnet bytes match the localnet bytes and the target/deploy bytes, but does not verify that the source at the current commit produces those bytes. A malicious or accidental source change could produce different bytes that still match the cached artifacts.

**Evidence:** A test with a modified source that produces different bytes but with the cached artifacts unchanged would show the build passing.

**Fix:** Rebuild the sweep helper from source and compare the hash, or add a source hash check.

## Accepted Limits: Four Questions

### 1. Is any limit WORSE than stated?

**Limit 10 (swap operator):** The bound is stated as "per-sweep cap x cooldown windows until the guardian pulls `emergency_stop_sweep`". The actual bound is worse because the guardian's stop is a transaction that must be signed and confirmed, which takes time. During that time, the thief can continue sweeping. The SPEC says "the window is the alarm's cadence plus a human reaching the guardian wallet", which is accurate but understates the delay. The alarm runs every 30 minutes, and a human must notice the page, access the guardian wallet, and sign the stop transaction. This could be 30-60 minutes, during which the thief can sweep 2-3 times (at 6-hour cooldown, this is actually not possible—the cooldown prevents more than one sweep per 6 hours). So the bound is actually correct: the thief can sweep at most once per cooldown, and the guardian can stop within one cooldown window.

**Limit 25 (re-roll):** The limit says "one re-roll per full window of total silence". This is accurate, but the window is ~2 minutes, and the crank runs every minute. So the practical window for a re-roll is much smaller than stated—the crank will capture within a minute unless it is down.

**Limit 26 (leader grinding):** The limit says the leader can "choose among many draws". The actual number of choices is bounded by the number of block contents the leader can produce in the time available, which is limited by the block production rate. The SPEC says "64 tries reach 96%", which is an upper bound, not a practical number.

### 2. Is anything listed as a limit not actually a limit?

**Limit 35 (10% turnout rule):** The SPEC says this "never binds at the ruled numbers". This is correct: with 21% quorum and 51% threshold, the minimum YES is 10.71%, which exceeds 10%. The rule is dead code at the ruled values.

**Limit 54 (compute units):** The SPEC says this is "DISCHARGED" but the item is still listed under DISCHARGED with a note that it "binds the holder pages". This is not a limit anymore; it is a requirement for the holder pages (item 50).

### 3. Is any DISCHARGED item not actually discharged?

**Item 12/17 (compute units):** The SPEC says this is discharged with measurements on the v5 artifact. However, the v6 programs have different compute characteristics, and the measurements may not apply. The SPEC notes this: "This is not a v1 packet or resource-budget measurement." The discharge is valid for the legacy/v0 shapes but not for v1.

**Item 51 ($CBOB boost):** The SPEC says this is discharged and built. I verified the boost code in MINT and the off-chain mirror in `bank/accrual.mjs`. The discharge is valid.

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

**Item 22 (live chain distribution):** The SPEC says this is OPEN AND BLOCKING and must be exercised before launch. The round 33 verdict says "Items 22, 38, 50, 52 and 53 remain open as SPEC states". This is correct—the item is not being treated as accepted.

**Item 50 (holder surfaces):** The SPEC says this is OPEN AND BLOCKING. The round 33 verdict confirms it remains open. The holder guide is marked DRAFT and says "the redeem page (being built)". This is correct.

**Item 53 (dress rehearsal):** The SPEC says this is OPEN AND BLOCKING. The round 33 verdict confirms it remains open. The rehearsal tree script exists but the rehearsal value set is not built.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

### What should this project do before launch that AI audit structurally cannot?

1. **Run the dress rehearsal with real money and real failures.** The SPEC item 22 requires one full live revenue cycle through each pool and one forced post-sweep failure. This must actually happen, not just be planned. The rehearsal should use small real amounts (e.g., 0.1 SOL) and record every transaction signature.

2. **Have a second, independent operator review the launch values.** The launch checker (`scripts/check-launch-params.mjs`) validates the JSON, but a human must verify that the JSON matches the signed transactions. This is a procedural control that no AI can perform.

3. **Test the guardian's stop in production.** The guardian's `emergency_stop_sweep` and `emergency_stop_sales` must be tested on mainnet before the lock. This requires Gary's wallet to sign a transaction, which is a human action.

4. **Verify the deployed bytes against the source.** The build script proves the bytes match the source at a commit, but a human must verify that the deployed bytes on mainnet match the `dist/` artifacts. This requires reading the program accounts on mainnet and comparing hashes.

5. **Run the alarm in rehearsal mode for at least one full day.** The alarm's detectors must be exercised against real mainnet data, not just synthetic inputs. This will catch any RPC-specific issues that the selftest cannot.

6. **Have a third party review the holder guide.** The holder guide makes promises to holders. A human lawyer or compliance officer should review it for accuracy and completeness, which is outside the scope of AI audit.

7. **Prepare a runbook for the first 24 hours after launch.** The first day will have the highest risk of unexpected issues. A runbook should specify who is on call, what to do if the alarm pages, and how to reach the guardian.

8. **Consider a canary deployment.** Deploy the programs to a test network (e.g., devnet) with the same values and run the full lifecycle before mainnet. This is already partially done with the rehearsal tree, but a devnet deployment with real users would catch issues that the rehearsal cannot.

9. **Document the recovery procedures for every failure mode.** The SPEC documents hand recovery for open revenue cycles, but there are other failure modes (e.g., a stuck reveal queue, a frozen pool) that need documented procedures.

10. **Have a plan for the first Core upgrade.** Metaplex Core is upgradeable, and a Core upgrade could break the vaults. The project should have a monitoring plan and a communication plan for when this happens.