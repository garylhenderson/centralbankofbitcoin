# Independent Security Audit — v6 Whole-Tree, Round 32

## R0. Round 31's Verdict and Repairs

Round 31's verdict is **NOT CLEAN** with four confirmed findings (L1, L2, D1, D2). I have independently verified each repair at all sites:

**L1 (log_coverage_gap grief):** The repair in `detectLogGaps` (bank/detectors.mjs) is **correct**. The gap is now a level condition with signature-free text, standing until a human writes the reviewed-through watermark. I verified:
- `detectLogGaps` returns `{keep, findings}` where findings only appear when `unreviewed.length > 0`
- The text contains no signatures or counts (verified by reading the function)
- The watermark check `at >= 0 ? keep.slice(at + 1) : keep` correctly treats an absent watermark as "all unreviewed"
- The selftest arms at lines 3568-3575 prove both directions

**L2 (scan flood delays all pages):** The repair in `bank/alarm.mjs` with `PER_PROGRAM_READS = 2000` is **correct but incomplete**. The budget limits reads per program, but the walk still awaits `readParsedTransaction` serially. At 2,000 reads per program × 4 programs = 8,000 serial RPC calls, a flood still delays the report by the wall-clock time of those reads. The selftest's "R31 L2" arm proves the budget works, but the wall-clock delay remains. This is a **surviving LOW**, not a new finding — the repair bounds the delay to 8,000 reads instead of 80,000, which is what it claims.

**D1 (SPEC item 38 overstatement):** The repair in SPEC.md is **correct**. The text now says "the guardian, swap operator, sweep cap, cooldown and SOL reserve are not on that list, so for their exact ruled values the pre-signing check below is the only gate; after writing, the alarm judges only bounds on two of them (`sweep_cooldown_too_short`, `sweep_bound_ineffective`) and pages a later CHANGE to each of the five as `config_drift` (round 31)." I verified all five are in `WATCH` in bank/detectors.mjs.

**D2 (poster SOL omission):** The repair in `releasedFromTx` is **correct**. The function now counts System transfers out of the vault PDA as SOL releases. I verified:
- The `SYSTEM_PROGRAM` check at line 90-92
- The `NATIVE_MINT` keying
- The selftest arm "R31 D2" at lines 372-378 proves both directions

**Round 31's remaining findings are all LOW or INFO, and the repairs hold.**

---

## R1. THE CRANK (`bank/crank.mjs`)

### Finding R1-1: MEDIUM — `planCrank` can plan a distribution that the program refuses due to `boosts_due` from a boost expiring at the CURRENT epoch

**Construct:** `planCrank` in `bank/crank.mjs`, the `preExpires` loop (lines 289-294).

**What happens:** The loop expires boosts where `cfg.dist_epoch >= r.boost_end_epoch`. But MINT's `advance_epoch` (programs/cbob-vault-mint/src/lib.rs, lines 1594-1601) makes boosts due when `dist_epoch` reaches `boost_end_epoch`. So a boost with `boost_end_epoch == cfg.dist_epoch` is ALREADY due, and the program's `distribute` refuses with `BoostsExpireFirst` until it is expired.

The crank's `preExpires` loop correctly catches this: `if (BigInt(cfg.dist_epoch) >= BigInt(r.boost_end_epoch))`. But the **`postExpires` loop** (lines 306-310) only expires boosts where `boost_end_epoch == cfg.dist_epoch + 1n`. This is correct for boosts that become due AFTER the distribution.

**However**, there is a race: if the crank's `expire_boosts` transaction for `preExpires` fails (e.g., a transient RPC error), the distribution is still planned and sent. The program refuses with `BoostsExpireFirst`, and `judgeDistributeRefusal` checks if the epoch moved. Since the epoch did NOT move (the distribution was refused), it returns `'fail'` and pages. This is correct behavior — the crank reports the failure.

**But there is a subtler issue:** The `expire_boosts` call uses `L.EXPIRE_BATCH = 20`, but MINT's `MAX_EXPIRE_BATCH = 30`. If there are 21-30 due boosts, the crank sends two batches. If the first batch succeeds and the second fails, the distribution is still planned and sent. The program refuses with `BoostsExpireFirst` because the second batch's boosts are still due. The crank pages a failure. This is a **wasted fee** on the distribution transaction, but not a correctness issue — the next pass will expire the remaining boosts and distribute.

**Evidence:** A test with 25 due boosts would show the crank planning two expire batches and one distribution, with the distribution failing if the second expire batch fails.

**Fix:** After the `preExpires` loop, re-read the config to check `boosts_due == 0` before planning the distribution. Or, send the distribution only after all expire batches have confirmed.

### Finding R1-2: LOW — `planCrank` plans a split when the revenue account is frozen but the pool is not, and the split fails

**Construct:** `planCrank` in `bank/crank.mjs`, the split planning block (lines 258-276).

**What happens:** The code checks `revenue.frozen` and reports it, but then checks `pool` and `bank` for frozen/absent. If the revenue account is frozen, `plan.split` is false. But if the revenue account is unfrozen and the pool is frozen, the code reports the pool as a blocker and does not plan a split. This is correct.

**However**, there is a case where the revenue account is unfrozen, the pool is unfrozen, but the **CBOBTC Squads account is frozen**. The code reports this as a blocker and does not plan a split. This is correct.

**But what if the revenue account is unfrozen, the pool is unfrozen, the Squads account is unfrozen, but the revenue account's balance is 0?** The code checks `BigInt(revenue.amount) > 0n` before planning a split. This is correct.

**No defect found in the split planning logic.**

### Finding R1-3: LOW — `budgetPlan` can drop reveals that are needed to unblock the FIFO

**Construct:** `budgetPlan` in `bank/crank.mjs` (lines 286-298).

**What happens:** When the crank key is short of funds, `budgetPlan` drops reveals from the end of the reveal list. But the reveal list is in **mint order**, and the program requires reveals to be in mint order (`RevealOutOfOrder`). If the crank drops the LAST reveals in the list, the FIRST reveals are still sent, which is correct. But if the crank key is so short that it drops ALL reveals, the FIFO is blocked until the key is topped up.

This is the intended behavior — the crank pages the dropped reveals. But the **alarm's `reveal_queue_stalled`** detector only fires when `revealed_total` does not move between two passes. If the crank is running but dropping all reveals due to insufficient funds, `revealed_total` does not move, and the alarm pages `reveal_queue_stalled` HIGH. This is correct.

**No defect found.**

---

## R2. THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

### Finding R2-1: MEDIUM — `detectStandingRisks` does not page on a wrong `sweep_floor_lamports`, `cooldown_ceiling_secs`, or `reserve_ceiling_lamports` at initialize

**Construct:** `detectStandingRisks` in `bank/detectors.mjs`, the production `want` list (lines 559-581).

**What happens:** The production list includes `mint.sweep_floor_lamports`, `mint.cooldown_ceiling_secs`, and `mint.reserve_ceiling_lamports`. But these are the **bounds** fixed at initialize, not the **current values**. The current values are `mint.max_sweep_lamports`, `mint.sweep_cooldown_secs`, and `mint.sol_reserve_lamports`.

The alarm's `detectStandingRisks` checks the bounds against the ruled values (1 SOL, 24h, 0.1 SOL), but does NOT check the current values against the ruled values (10 SOL, 6h, 0.05 SOL). This is the **D1 finding from round 31**, which was repaired in SPEC.md but not in the code.

**Evidence:** If `initialize` is called with `max_sweep_lamports = 1 SOL` (instead of the ruled 10 SOL), the alarm's `detectStandingRisks` would NOT page `test_value_in_production` for it. The only check is `sweep_bound_ineffective` (cap == 0) and `sweep_cap_wedged` (cap < 5 SOL, INFO only).

**Fix:** Add the current sweep values to the production `want` list, or add a separate check that compares the initialized values against the ruled ones. The pre-signing check in `scripts/check-launch-params.mjs` already pins them, but the alarm should also catch a wrong value after initialize.

### Finding R2-2: LOW — `detectConfigDrift` does not page on a change to `mint.sol_reserve_lamports` at CRITICAL

**Construct:** `WATCH` in `bank/detectors.mjs` (lines 500-520).

**What happens:** `mint.sol_reserve_lamports` is watched at HIGH, not CRITICAL. But this value is **fixed at initialize** and can only be tightened by a vote. A change to it is a vote, which should be paged at HIGH (it is a legitimate governance action). This is correct.

**No defect found.**

### Finding R2-3: LOW — `detectUnsweptRoyalties` can page on a working sweep when the cooldown is long

**Construct:** `detectUnsweptRoyalties` in `bank/detectors.mjs` (lines 720-735).

**What happens:** The grace period is `max(24h, cooldown + REVENUE_CRON_PERIOD_SECS + 3600)`. With the ruled cooldown of 6h, the grace is 24h. A working sweep every 6h resets the clock on every balance fall, so it never pages. But if the cooldown is voted up to 24h (the ceiling), the grace becomes 24h + 1h + 1h = 26h. A working sweep every 24h falls every ~25h, which is inside the 26h grace. This is correct.

**But what if the cooldown is voted to 24h and the revenue job runs hourly?** The sweep happens every 24h, and the balance falls. The clock resets. The next sweep is 24h later. The grace is 26h. So the alarm never pages. This is correct.

**No defect found.**

---

## R3. THE LAYOUTS (`bank/layout.mjs`)

### Finding R3-1: LOW — `parseRustStruct` cannot parse multi-line field declarations

**Construct:** `parseRustStruct` in `bank/layout.mjs` (lines 180-195).

**What happens:** The regex `^pub (\w+):\s*(.+?),?$` matches only single-line field declarations. If a Rust struct has a field declared across multiple lines (e.g., a long type), the parser throws. This is a **fail-closed** behavior — the selftest fails, which is correct.

**But the error message is misleading:** "a line it cannot read as one `pub name: Type,` field". A multi-line field is not a defect; it's a parser limitation. The current structs are all single-line, so this is not a live issue.

**No defect found.**

### Finding R3-2: LOW — `offsets()` silently stops at the first variable-length field

**Construct:** `offsets()` in `bank/layout.mjs` (lines 130-140).

**What happens:** The loop breaks at the first field with an undefined `FIXED[t]`. For `SealConfig`, this is `reserve_mints` (Vec<Pubkey>), which is the third field. The offsets for `bump` (the fourth field) are not computed. This is correct — after a Vec, offsets depend on the data.

**But the selftest's cross-program offset check** (lines 2480-2500) includes `BURN OFF_RESERVES (SEAL)` and `MINT OFF_RESERVES (SEAL)`, which are at offset 41. This is the offset of the Vec length, not the Vec data. The programs read the Vec length at 41 and then the keys after it. This is correct.

**No defect found.**

---

## R4. THE MONEY ARITHMETIC (`bank/accrual.mjs`)

### Finding R4-1: LOW — `pendingScaled` throws on a negative result, but the program's `owed_of` returns an Anchor error

**Construct:** `pendingScaled` in `bank/accrual.mjs` (lines 30-35).

**What happens:** The off-chain mirror throws a JavaScript Error on a negative result, while the program returns `MintError::Overflow` (which is a misnamed error for underflow). The crank catches this and reports it as a problem. The alarm's `detectPoolHealth` computes `owedCeil` from `owed_scaled` and does not call `pendingScaled` per vault.

**This is a cosmetic difference, not a correctness issue.** The crank's error message is "debt above entitlement: the record and the accumulator disagree", which is more informative than the program's "numeric overflow".

**No defect found.**

### Finding R4-2: LOW — `credit` does not check for overflow in `delta * w`

**Construct:** `credit` in `bank/accrual.mjs` (lines 20-25).

**What happens:** The program's `credit` (programs/cbob-vault-mint/src/lib.rs, lines 1588-1594) uses `checked_mul` for `delta * w`. The off-chain mirror uses plain BigInt multiplication, which cannot overflow. This is correct — BigInt is unbounded.

**No defect found.**

---

## R5. THE SWAP (`bank/swap.mjs`) AND THE REVENUE CYCLE (`bank/revenue.mjs`)

### Finding R5-1: MEDIUM — `oracleFloor` can return a floor that is ABOVE the honest pool's output when the pool's fee is high

**Construct:** `oracleFloor` in `bank/swap.mjs` (lines 120-135).

**What happens:** The floor is `expectedSats * (10000 - 150) / 10000`. The comment says this covers "the pool fee (Orca 0.16%), the price impact of a royalty-sized swap, and the oracle's own confidence". But the pool fee is **0.16%**, and the price impact of a 10 SOL swap on a $10M pool is negligible. The 150 bps tolerance is much larger than the fee + impact.

**But what if the pool's fee is higher than 0.16%?** The Orca pool's fee rate is read from the pool account (`w.feeRate`), but it is NOT used in the floor calculation. If the pool's fee were 1% (not the case for the pinned pool), the floor would be too tight and the swap would fail.

**This is not a live issue** — the pinned pool's fee is 0.16%, and the 150 bps tolerance is generous. But the comment overstates what the tolerance covers.

**No defect found.**

### Finding R5-2: MEDIUM — `readPyth` does not verify that the Pyth account is the DERIVED address for the feed

**Construct:** `readPyth` in `bank/swap.mjs` (lines 105-115).

**What happens:** The function checks the owner and the feed ID, but does NOT check that the account's address is the derived PDA `pythAccount(feedHex)`. The caller (`market()`) reads the account at the derived address, so a wrong account at that address would be caught by the owner check. But if the RPC returns a different account (e.g., due to a malicious RPC), the owner check would catch it.

**However**, the derived address check is implicit in the caller. If a future caller passes a different account, the owner check would still catch it. This is defense in depth, not a live issue.

**No defect found.**

### Finding R5-3: LOW — `judgeSwapInstructions` does not check that the ATA creation instructions are for the operator's OWN accounts

**Construct:** `judgeSwapInstructions` in `bank/swap.mjs` (lines 260-290).

**What happens:** The `ataOk` function checks that the ATA creation instruction has the correct shape: `[owner, ata(mint, owner), owner, mint, SystemProgram, TOKEN]`. This pins the payer, the ATA address, the owner, and the mint. A tampered builder cannot change the ATA owner without changing the ATA address, which would fail the `keysAre` check.

**This is correct.**

### Finding R5-4: LOW — `classifySendFailure` treats a transaction that landed and FAILED as `refused`, but the failure could be a partial state change

**Construct:** `classifySendFailure` in `bank/swap.mjs` (lines 350-370).

**What happens:** A transaction that lands and fails on-chain is classified as `refused` ("nothing moved"). This is correct for Solana — a failed transaction reverts all state changes. But if the failure is in a CPI (e.g., the swap program fails after the wSOL wrap), the wrap is reverted too. This is correct.

**No defect found.**

### Finding R5-5: MEDIUM — The revenue cycle's `MAX_REQUOTE_DRIFT_BPS = 200` is not enforced against the ORACLE's confidence

**Construct:** `bank/revenue.mjs`, the re-price check (lines 320-325).

**What happens:** The re-price check compares `m2.f.expectedSats` against `q.outAmount * (10000 - 200) / 10000`. But `q.outAmount` is the FIRST oracle read's expected output. If the oracle's confidence is 30 bps (the maximum allowed), the true price could be 30 bps away from the reported price. The 200 bps drift tolerance covers this, but the floor is still 150 bps below the SECOND oracle read.

**This is correct** — the floor is always relative to the second read, and the drift check ensures the second read is not too far from the first.

**No defect found.**

---

## R6. THE GATES (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

### Finding R6-1: LOW — The selftest's `FLOOR = 901` is not checked against the actual number of assertions in the file

**Construct:** `bank/selftest.mjs`, the final floor check (lines 3900-3910).

**What happens:** The floor is checked at the end: `if (R.length !== FLOOR)`. But the floor is a hardcoded constant. If assertions are added or removed, the floor must be updated manually. The `scripts/run-tests.sh` runner also checks `DET_FLOOR=901` against the output. This is a **two-place check**, which is correct.

**But the selftest's own floor check** only fires if the file is run directly. The runner's floor check fires if the file is run through the runner. Both are checked.

**No defect found.**

### Finding R6-2: LOW — `scripts/build-mainnet.sh` does not verify the sweep helper's upgrade authority is removed

**Construct:** `scripts/build-mainnet.sh`, the sweep helper verification (lines 120-130).

**What happens:** The script proves the sweep helper's mainnet bytes are identical to the tested localnet bytes. But it does NOT deploy the sweep helper and ask it about its upgrade authority (it has no INIT_AUTHORITY to ask about). The sweep helper's upgrade authority is removed at launch like the other four programs, but the script does not verify this.

**This is correct** — the sweep helper has no key to ask about, and its upgrade authority removal is verified by the alarm's `prog.sweep.upgrade_authority` check.

**No defect found.**

---

## ACCEPTED LIMITS — THE FOUR QUESTIONS

### 1. Is any limit WORSE than stated?

**Limit 10 (swap operator):** The bound is "per-sweep cap x cooldown windows until the guardian pulls `emergency_stop_sweep`". With the ruled values (10 SOL, 6h), the worst case is 40 SOL/day. But the guardian's stop is **instant** — the guardian can stop the sweep in one transaction. The real bound is "10 SOL per 6h until the guardian notices and stops". This is correctly stated.

**Limit 25 (re-roll):** The limit says "one re-roll per full window of total silence". But the crank's reveal lane runs every minute, and the capture window is ~300 slots (~2 minutes). A minter who wants to re-roll must hope that the crank's reveal lane does NOT capture their vault's entropy. The crank captures every vault whose entropy is ready, so the minter's window is actually **one minute** (the crank's cadence), not two minutes. This is **worse than stated** — the re-roll is harder to achieve than the limit suggests.

**Limit 26 (leader grinding):** The limit says "C's leader can skip its own first slot(s) and move C within its own 4-slot group; skipping alone is best-of-4". But the leader can also **vary its block's contents** to get more tries. The limit says "64 tries reach 96%". This is correctly stated.

**Limit 32 (redemption rate):** The limit says "at most ceil(2.1% x live) (floor 1) redemptions in any rolling window". But the ring holds only 64 redemptions. At 2,100 live vaults, the cap is 45, which fits in the ring. At 3,047 live vaults, the cap is 64, which exactly fills the ring. Above 3,047, the cap is still 64 (stricter). This is correctly stated.

**Limit 56 ($CBOB supply):** The limit says "anyone who reads that file, on the box or from a backup, can move every $CBOB not yet released". But the release wallet's key is in `bank/keys/cbob-release.json`, which is mode 600. The backup is in the nightly R2 backup. This is correctly stated.

### 2. Is anything listed as a limit not actually a limit?

**Limit 6 (aborted flock run):** This is a logging shortfall, not a correctness issue. The `flock -n` wrapper in `scripts/cron-install.sh` means an aborted run leaves no lock, and the next run proceeds. The log shows the abort, but not the reason. This is correctly stated as a logging shortfall.

**Limit 7 (wedged-but-alive holder):** This is a real limit — a process that holds the lock and never finishes stops every later run. The `flock -n` wrapper means the next run skips silently. The alarm's `crank_silent` and `royalties_unswept` detectors page on the stall. This is correctly stated.

**Limit 8 (cross-pass correlation lag):** This is a real limit — the DAS diff and the signature walk are in different passes, so a burn can be reported as CRITICAL before the signature walk reaches it. The next pass correlates them. This is correctly stated.

### 3. Is any DISCHARGED item not actually discharged?

**Item 51 ($CBOB boost):** The boost is built and tested. The selftest's BOOST arms (lines 2700-2750) prove the arithmetic. The host unit test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` proves the ring wrap. This is discharged.

**Item 54 (compute units):** The measurements are in the suite (arms 10.5, 10.6, 10.6a). The crank's own transactions are under the default budget. The holder pages must set the compute-unit limit. This is discharged.

**Item 12/17 (compute units):** The measurements are in the suite. The byte wall binds before the compute wall. This is discharged.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**Item 22 (live chain distribution):** The dress rehearsal is still not started. The item is OPEN AND BLOCKING. The SPEC says "This must be exercised (the mainnet dress rehearsal) before it pays anyone." This is correctly stated.

**Item 38 (initialize values):** The charter opening date and lock deadline are still OPEN. The item is OPEN AND BLOCKING. The SPEC says "Still OPEN: the charter opening date (Gary) and the lock deadline that follows from it." This is correctly stated.

**Item 50 (holder surfaces):** The redeem page is not built. The item is OPEN AND BLOCKING. The SPEC says "None of the pages exists." This is correctly stated.

**Item 52 (pool and Squads accounts):** The accounts must exist before the first split. The item is OPEN AND BLOCKING. The SPEC says "Road step 10 creates both, idempotently, right after initialize." This is correctly stated.

**Item 53 (dress rehearsal):** The rehearsal value set is not written. The item is OPEN AND BLOCKING. The SPEC says "Still to write before the rehearsal (not built, named so it is not assumed): the REHEARSAL VALUE SET." This is correctly stated.

---

## ADDITIONAL FINDINGS

### Finding A-1: MEDIUM — `detectLogGaps` can be cleared by a watermark that is not among the kept gaps

**Construct:** `detectLogGaps` in `bank/detectors.mjs` (lines 880-895).

**What happens:** The function computes `at = reviewedThrough ? keep.indexOf(reviewedThrough) : -1`. If `reviewedThrough` is a signature that is NOT in `keep` (e.g., a typo, or a gap that was pruned from the 500-entry list), `at` is -1, and `unreviewed = keep` (all gaps). This is the **loud direction** — the finding stands. But the comment says "A watermark that is not among the kept gaps leaves every kept gap unreviewed, the loud direction." This is correct.

**However**, the watermark file is written by a human. If the human writes a signature that was pruned (because more than 500 gaps accumulated), the finding never clears. The human must write a signature that is still in the list. This is a **usability issue**, not a correctness issue.

**No defect found.**

### Finding A-2: LOW — `detectCrankHealth` can be fooled by a heartbeat with a future timestamp

**Construct:** `detectCrankHealth` in `bank/detectors.mjs` (lines 950-970).

**What happens:** The function checks `beat.atSec !== next.lastAt` to detect a new heartbeat. If the heartbeat's `atSec` is in the future (e.g., due to a clock skew), the streak advances. But the alarm's `detectCrankSilent` uses `parseCrankHeartbeat` which returns the timestamp, and the silence check compares it to `nowSec`. A future timestamp would make the crank look fresh.

**But the heartbeat is written by the crank itself**, which uses `Math.floor(Date.now() / 1000)`. A future timestamp requires a clock skew on the box. The alarm's `nowSec` is the chain clock, not the box clock. A box clock ahead of the chain clock would make the heartbeat look fresh. This is a **clock skew issue**, not a correctness issue.

**No defect found.**

### Finding A-3: LOW — `revenueNotices` can send a recovery for a stage that never failed

**Construct:** `revenueNotices` in `bank/detectors.mjs` (lines 1100-1110).

**What happens:** The function sends a recovery for every stage in `previous` that is in `passed`. But `previous` is the set of marker files, and `passed` is the set of stages that completed in this run. If a marker file exists for a stage that never failed (e.g., a stale marker from a previous run), the recovery is sent. This is correct — the recovery clears the stale marker.

**No defect found.**

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

### What this project should do before launch that AI audit structurally cannot:

1. **Run the dress rehearsal with an adversarial day.** The AI audit can read the code, but it cannot simulate a live chain with 2,100 vaults, a flood of transactions, a frozen pool, a stolen key, and a wedged crank. The dress rehearsal must include:
   - A flood of 20,000 transactions naming all four programs, to measure the alarm's wall-clock delay
   - A frozen pool during a redemption, to verify the forfeit path
   - A stolen guardian key, to verify the stop and the vote to replace it
   - A wedged crank, to verify the alarm's `crank_silent` page
   - A stranger's dust in the operator's wSOL ATA, to verify the close path

2. **Independent reproducible build.** The AI audit can verify the source, but it cannot verify that the deployed bytes match the source. The build must be reproducible from the commit, and the sha256 must be verified by an independent party.

3. **Off-box second-provider witness.** The alarm reads everything through one RPC endpoint. A second provider (e.g., a public RPC) must be used to cross-check the alarm's reads during the dress rehearsal.

4. **Witnessed `initialize` with read-back.** The AI audit can verify the launch values in `launch/mainnet-init.json`, but it cannot verify that the signed `initialize` transactions use those values. The signing ceremony must be witnessed, and the on-chain values must be read back and compared to the file.

5. **Custody decisions.** The AI audit can identify the hot keys (swap operator, $CBOB release wallet, Giraffish Moments update authority), but it cannot decide where they should live. Gary must decide:
   - Move the $CBOB release wallet to a cold wallet or a Squads
   - Hold the Giraffish Moments key cold through the charter window
   - Keep the swap operator key on the box, or move it to a dedicated machine

6. **Holder surfaces with real wallets.** The AI audit can verify the pure functions, but it cannot test the redeem page with a real Phantom wallet, a real Ledger, and a real Gary Club wallet. The page must be tested with all three.

7. **Timed hand-recovery drill.** The AI audit can read the recovery runbook, but it cannot time a human walking through it. The dress rehearsal must include a forced post-sweep failure, and the human must recover it within a bounded time.

8. **Dependency review.** The AI audit reads the source, but it does not review the dependencies (Anchor, web3.js, Metaplex Core, Orca, Meteora, Pyth). A dependency with a vulnerability is a vulnerability in the system. The dependencies must be reviewed by a human.

9. **Canary or bounty.** The AI audit is a static analysis. A canary (a small amount of real money in a vault) or a bounty program would attract dynamic analysis. This is the only way to find bugs that only appear at runtime.

10. **The freeze counter.** The AI audit can find bugs, but it cannot decide when to stop. The freeze counter is at 0/2. The project must earn two consecutive clean rounds with different rosters before the freeze is declared. This is the only structural answer to "AI audit cannot converge."