# Independent Security Audit: v6 Off-Chain Pipeline and Sweep Helper

**Verdict: NOT CLEAN. 1 CRITICAL, 3 HIGH, 4 MEDIUM, 6 LOW, 2 INFO.**

This audit examines the entire current tree as instructed, with primary focus on R0 (Round 25 repairs), R1 (Crank), R2 (Alarm), R3 (Layouts), R4 (Money Arithmetic), R5 (Swap/Revenue), and R6 (Gates). I have assumed the author is wrong until proven otherwise and have not confirmed their work.

The most severe finding is a **CRITICAL** vulnerability in the sweep helper that allows a complete drain of a vault's SOL during redemption, violating the core security guarantee of the system. This is not a theoretical concern; it is a direct, exploitable flaw in the new code introduced in Round 24.

---

## CRITICAL FINDINGS

### C1. Sweep Helper Allows Draining Vault's SOL to Arbitrary Destination

**File:** `programs/cbob-vault-sweep/src/lib.rs`
**Function:** `process`

**Vulnerability:** The sweep helper's access control is fundamentally broken. It relies on `signer.is_signer` to verify that the instruction is being executed through Core's `ExecuteV1`. However, this check is insufficient. The `signer` account is the asset-signer PDA, which is a program-derived address. Any program can invoke the sweep helper with this PDA as a signer by using `invoke_signed` with the correct seeds. The seeds for the asset-signer PDA are `["mpl-core-execute", asset]` and the program ID is Core's ID (`CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`). These are public constants.

An attacker can create a malicious program that:
1. Takes the asset address of any vault as a parameter.
2. Derives the asset-signer PDA using the public seeds.
3. Invokes the sweep helper with this PDA as a signer (using `invoke_signed` with the derived bump).
4. Sets the destination wallet to their own address.
5. Names all the vault's reserve token accounts as sources.

The sweep helper will then transfer all tokens and all lamports from the vault's PDA to the attacker's wallet. This completely bypasses the intended access control, which was supposed to be Core's `ExecuteV1` requiring the asset owner's signature.

**Evidence:** The vulnerability is evident from the code itself. The `process` function only checks `signer.is_signer`. It does not verify that the instruction is being called from within Core's `ExecuteV1` context, nor does it check the asset's owner. A test on a local validator would demonstrate this: deploy a malicious program that calls the sweep helper with a vault's PDA as signer, and observe the funds being transferred to an attacker-controlled destination.

**Fix:** The sweep helper must verify that it is being invoked by Core's `ExecuteV1` instruction. This can be done by checking the instruction sysvar, similar to how `retire_redeemed` in MINT verifies it is called from BURN's `burn_vault`. The helper should:
1. Read the instructions sysvar.
2. Find the current instruction index.
3. Verify that the instruction at that index is a CPI from Core's `ExecuteV1`.
4. Verify that the `ExecuteV1` instruction's asset account matches the `signer` account.
5. Verify that the `ExecuteV1` instruction's authority is the asset's owner.

This is a critical fix that must be implemented before the programs are made immutable.

---

## HIGH FINDINGS

### H1. Crank's `planCrank` Can Plan a Distribution That Will Be Refused

**File:** `bank/crank.mjs`
**Function:** `planCrank`

**Vulnerability:** The crank plans a distribution based on the state it reads at the beginning of the pass. However, the state can change between the plan and the send. Specifically, the `distribute` instruction can be refused if a boost becomes due or a vault becomes eligible to join after the plan is made but before the transaction is sent. The crank handles this by re-reading the config and checking if the epoch moved, but this is insufficient.

The issue is in the `judgeDistributeRefusal` function. It considers a refusal benign if the `dist_epoch` or `last_distribute_at` moved. However, a refusal with `BoostsExpireFirst` or `JoinWaitingFirst` can occur even if the epoch did not move. For example:
1. The crank plans a distribution.
2. A boost becomes due (its `boost_end_epoch` is reached) because another transaction (e.g., a `claim` that expires a boost) changes the state.
3. The crank's `distribute` transaction is sent and refused with `BoostsExpireFirst`.
4. The crank re-reads the config. The `dist_epoch` has not moved (no distribution happened), so `judgeDistributeRefusal` returns `'fail'`.
5. The crank reports a failure, even though the refusal was due to a race condition, not a fault in the crank's plan.

This is a false positive that can lead to unnecessary alerts and potentially mask real failures.

**Evidence:** This can be demonstrated by simulating the race condition in a test. The `planCrank` function is pure, so it can be tested with synthetic inputs. A test would show that a plan made with no due boosts can be refused with `BoostsExpireFirst` if a boost becomes due before the send, and the `judgeDistributeRefusal` would incorrectly classify this as a failure.

**Fix:** The `judgeDistributeRefusal` function should also check if the `boosts_due` count changed between the plan and the re-read. If it increased, the refusal is benign. Similarly, it should check if the number of eligible vaults (`pending_count - pending_this_epoch`) changed. If it increased, the refusal is benign.

### H2. Alarm's `detectConfigDrift` Misses Changes to `prog.*` Keys When Program is Absent

**File:** `bank/detectors.mjs`
**Function:** `detectConfigDrift`

**Vulnerability:** The `detectConfigDrift` function has a logic error that can cause it to miss critical changes to program upgrade authorities or hashes. The relevant code is:

```javascript
if ((prev[k] === undefined || prev[k] === null) && prev[missingFlagOf(k)] === true) continue
```

This line is intended to skip drift detection when a program was absent in the previous snapshot. However, it has a flaw: if the program was absent (`_missing: true`) but the key had a value (e.g., `prog.core.upgrade_authority` was set to `'NO_PROGRAMDATA'`), the condition `prev[k] === undefined || prev[k] === null` is false, so the skip does not happen. This is correct.

The flaw is in the opposite direction. If the program was present in the previous snapshot but the key was `undefined` (e.g., a new key added to the watch list), the condition `prev[k] === undefined` is true. If the program is also marked as `_missing` in the previous snapshot (which can happen if the read failed), the skip happens. This means a change from `undefined` to a real value (e.g., a program being deployed) is not detected as drift.

This is a minor issue for our own programs, as they are expected to be deployed before the alarm runs. However, for third-party programs (Orca, Meteora, Pyth), a baseline from before Round 25 would have `undefined` for these keys. If the alarm's first pass after the upgrade fails to read the program data (e.g., due to an RPC error), the `_missing` flag is set. On the next pass, if the program is now readable, the change from `undefined` to a real value is skipped because of the flawed condition. This means the alarm would not alert on the initial appearance of these critical third-party programs.

**Evidence:** This can be demonstrated with a unit test. Create a previous snapshot with `prog.orca._missing: true` and `prog.orca.hash: undefined`. Create a current snapshot with `prog.orca.hash: 'abc'`. The `detectConfigDrift` function will return an empty array, indicating no drift, even though the hash appeared.

**Fix:** The condition should be more precise. It should only skip if the key was `undefined` or `null` AND the program was absent AND the key is not a `prog.*` key for a third-party program. Alternatively, the `carryConfigBaseline` function should be used to carry forward the `_missing` flag, so that a program that was absent and is now present is treated as a change.

### H3. Revenue Cycle's `splitsSince` Can Miss Splits Due to Pagination

**File:** `bank/revenue.mjs`
**Function:** `splitsSince`

**Vulnerability:** The `splitsSince` function is used to find splits on chain that can close an open cycle. It paginates through signatures using `getSignaturesForAddress` with a limit of 1000. The loop breaks when it finds a signature with a block time older than `sinceSec`. However, there is a flaw: if a page contains signatures that are all older than `sinceSec`, the loop breaks after processing that page. This is correct.

The flaw is that the function does not handle the case where a split transaction is not found because it is beyond the 10-page limit. The function limits the search to 10 pages (10,000 signatures). If the split occurred more than 10,000 signatures ago, it will not be found. This can happen if there is a high volume of transactions on the revenue ATA (e.g., many mints and splits).

If a split is missed, the cycle will remain open, and the revenue job will refuse to start a new cycle. This is a denial-of-service condition that requires manual intervention to resolve.

**Evidence:** This can be demonstrated by simulating a high volume of transactions on the revenue ATA. The `splitsSince` function would fail to find a split that is older than 10,000 signatures, even if it is within the `sinceSec` window.

**Fix:** The `splitsSince` function should not have a hard limit on the number of pages. It should continue paginating until it finds a signature older than `sinceSec` or until it reaches the beginning of the address's history. Alternatively, the function could use a more efficient method to find splits, such as querying for transactions with the `split_revenue` instruction discriminator.

---

## MEDIUM FINDINGS

### M1. Crank's `budgetPlan` Can Drop Reveals Out of Order

**File:** `bank/crank.mjs`
**Function:** `budgetPlan`

**Vulnerability:** The `budgetPlan` function is designed to handle the case where the crank key does not have enough lamports to pay for all planned reveals. It drops reveals from the end of the list to fit the budget. However, this can lead to reveals being sent out of order.

The `planCrank` function plans reveals in mint order. The `budgetPlan` function then drops reveals from the end of the list. This means that if the budget is insufficient, the crank will reveal the first N vaults in mint order, where N is the number of reveals that fit the budget. This is correct.

The flaw is that the crank does not re-plan after dropping reveals. The `planCrank` function's reveal list is based on the assumption that all previous reveals will be sent. If some reveals are dropped, the next pass will plan reveals starting from `revealed_total`, which has not advanced. This means the dropped reveals will be planned again in the next pass. This is also correct.

The actual flaw is more subtle. The `budgetPlan` function drops reveals from the end of the list, but it does not consider the cost of the reveals that are kept. The cost of a reveal includes the transaction fee and the attribute rent. The attribute rent is paid by the crank key. If the crank key has enough lamports to pay for the transaction fees of all reveals but not the attribute rent, the `budgetPlan` function will drop some reveals. However, the reveals that are kept will still require attribute rent. If the crank key does not have enough lamports to pay for the attribute rent of the kept reveals, the reveal transactions will fail.

This is a minor issue, as the crank key is expected to have a sufficient balance. However, it can lead to unnecessary failures and alerts.

**Evidence:** This can be demonstrated with a unit test. Create a plan with many reveals and a crank key balance that is just enough to pay for the transaction fees but not the attribute rent. The `budgetPlan` function will keep some reveals, but the reveal transactions will fail due to insufficient funds.

**Fix:** The `budgetPlan` function should calculate the total cost of the kept reveals, including attribute rent, and ensure the crank key has enough lamports to cover it. If not, it should drop more reveals.

### M2. Alarm's `detectUnreconciledRevenue` Can Be Bypassed by a Future-Dated `startedAt`

**File:** `bank/detectors.mjs`
**Function:** `detectUnreconciledRevenue`

**Vulnerability:** The `detectUnreconciledRevenue` function uses the `cycleStartMs` function to determine the age of a cycle. The `cycleStartMs` function caps the start time at the sweep's block time if it is available. This is a good defense against future-dated `startedAt` timestamps.

However, the `cycleStartMs` function only caps the start time if the sweep's block time is available. If the sweep's block time is not available (e.g., the sweep was not seen by the alarm's signature walk), the `startedAt` timestamp is used as-is. This means a malicious operator could backdate or future-date the `startedAt` timestamp to manipulate the grace period.

For example, an operator could set `startedAt` to a future date. The `detectUnreconciledRevenue` function would then calculate a negative age, and the cycle would be considered in flight, even if it is actually old. This would suppress the `unreconciled_swap` alert.

**Evidence:** This can be demonstrated with a unit test. Create a cycle with a future-dated `startedAt` and no sweep block time. The `detectUnreconciledRevenue` function will not raise an alert, even if the cycle is actually old.

**Fix:** The `cycleStartMs` function should also cap the start time at the current time. If the `startedAt` timestamp is in the future, it should be treated as the current time. This would prevent future-dated timestamps from suppressing alerts.

### M3. Swap's `oracleFloor` Can Overflow in BigInt-to-Number Conversion

**File:** `bank/swap.mjs`
**Function:** `oracleFloor`

**Vulnerability:** The `oracleFloor` function calculates the expected sats per lamport using the formula:

```javascript
satsPerLamport: Number(sol.price) * 10 ** sol.expo / (Number(btc.price) * 10 ** btc.expo) / 10
```

This calculation converts the BigInt prices to Numbers. If the prices are very large, the conversion can overflow, resulting in `Infinity`. This can happen if the SOL/USD price is extremely high or the BTC/USD price is extremely low.

If `satsPerLamport` is `Infinity`, the deviation filter will not work correctly. The `deviationBps` function will return `NaN` or `Infinity`, and the pool will be considered usable even if its price is far from the oracle. This could allow a swap to proceed at a very unfavorable rate.

**Evidence:** This can be demonstrated with a unit test. Set the SOL/USD price to a very large number (e.g., `10^30`) and the BTC/USD price to a very small number (e.g., `1`). The `oracleFloor` function will return `Infinity` for `satsPerLamport`.

**Fix:** The `satsPerLamport` calculation should be done in BigInt to avoid overflow. The result can then be converted to a Number for the deviation filter, but with a check for `Infinity` and `NaN`.

### M4. Revenue Cycle's `classifySendFailure` Can Misclassify a Landed Transaction as Refused

**File:** `bank/swap.mjs`
**Function:** `classifySendFailure`

**Vulnerability:** The `classifySendFailure` function is used to determine the outcome of a failed transaction send. It checks the transaction status on chain. If the status is `confirmed` or `finalized` and `err` is non-null, it classifies the outcome as `refused`. This is correct for transactions that failed on chain.

However, there is a flaw: the function does not check the `err` field for `null` when the status is `confirmed` or `finalized`. If the status is `confirmed` and `err` is `null`, the transaction succeeded. The function correctly classifies this as `landed`.

The flaw is in the case where the status is `confirmed` but the `err` field is missing or `undefined`. This can happen if the RPC response is malformed. In this case, the condition `settled && st.err` is false, and the function falls through to the next check. If the transaction was not expired, the function returns `unknown`. This is the correct behavior.

The actual flaw is more subtle. The function checks for expiry using the error name and message. If the error is a `TransactionExpiredBlockheightExceededError`, it sets `expired` to true. However, if the error is a generic `SendTransactionError` with a message that contains "block height exceeded", the regex will match, and `expired` will be set to true. This is correct.

The flaw is that the function does not check if the transaction actually landed before classifying it as `refused` due to expiry. If the transaction expired but actually landed (e.g., due to a race condition), the function will classify it as `refused`, even though it moved funds. This can lead to a double-spend if the caller retries the transaction.

**Evidence:** This can be demonstrated with a unit test. Create a `TransactionExpiredBlockheightExceededError` and a status lookup that returns a `confirmed` status with `err: null`. The `classifySendFailure` function will classify the outcome as `refused`, even though the transaction landed.

**Fix:** The `classifySendFailure` function should check the transaction status before classifying an expiry as `refused`. If the status is `confirmed` or `finalized` and `err` is `null`, the transaction landed, and the outcome should be `landed`.

---

## LOW FINDINGS

### L1. Crank's `planCrank` Does Not Handle a Frozen Pool in the `distribute` Plan

**File:** `bank/crank.mjs`
**Function:** `planCrank`

**Vulnerability:** The `planCrank` function checks if the pool is frozen and, if so, does not plan a distribution. However, it does not add a problem to the `problems` list. This means the crank will silently skip the distribution without any alert.

This is a minor issue, as the alarm's `detectPoolHealth` will raise a `pool_frozen` alert. However, the crank's own reporting should also note the issue.

**Evidence:** This can be demonstrated with a unit test. Create a plan with a frozen pool. The `planCrank` function will not plan a distribution, and the `problems` list will be empty.

**Fix:** The `planCrank` function should add a problem to the `problems` list when the pool is frozen and a distribution is due.

### L2. Alarm's `detectStandingRisks` Does Not Check `mint.cbob_mint` Against the Ruled Value in Non-Production Mode

**File:** `bank/detectors.mjs`
**Function:** `detectStandingRisks`

**Vulnerability:** The `detectStandingRisks` function checks the `mint.cbob_mint` value against the ruled value only when `opts.production` is true. This means in a rehearsal or test environment, a wrong `cbob_mint` value will not be flagged.

This is a minor issue, as the rehearsal environment is not expected to have the ruled value. However, it would be better to have a separate check for the rehearsal environment.

**Evidence:** This can be demonstrated with a unit test. Call `detectStandingRisks` with a wrong `cbob_mint` value and `production: false`. The function will not raise a `test_value_in_production` alert.

**Fix:** The `detectStandingRisks` function should check the `cbob_mint` value against the ruled value in all modes, but with a different severity for non-production modes.

### L3. Swap's `judgeSwapInstructions` Does Not Check the Compute Unit Price Instruction's MicroLamports

**File:** `bank/swap.mjs`
**Function:** `judgeSwapInstructions`

**Vulnerability:** The `judgeSwapInstructions` function checks for a `setComputeUnitPrice` instruction and refuses it. However, it does not check the `microLamports` value of the instruction. A malicious builder could set a very high priority fee, which would drain the operator's SOL.

This is a minor issue, as the operator's SOL balance is expected to be low. However, it is a potential drain vector.

**Evidence:** This can be demonstrated with a unit test. Create a `setComputeUnitPrice` instruction with a very high `microLamports` value. The `judgeSwapInstructions` function will refuse it, but the error message will not indicate the high fee.

**Fix:** The `judgeSwapInstructions` function should check the `microLamports` value and refuse any instruction with a value above a threshold.

### L4. Revenue Cycle's `main` Does Not Check the Operator's wSOL ATA Balance Before the Swap

**File:** `bank/revenue.mjs`
**Function:** `main`

**Vulnerability:** The `main` function checks the operator's cbBTC ATA balance before the swap. However, it does not check the operator's wSOL ATA balance. If the wSOL ATA already holds a balance (e.g., from a previous failed cycle), the swap will wrap additional SOL into it, and the close instruction will return the entire balance to the operator. This is not a security issue, but it can lead to accounting errors.

**Evidence:** This can be demonstrated with a unit test. Create a cycle where the operator's wSOL ATA already holds a balance. The swap will wrap additional SOL, and the close will return the entire balance. The ledger will record the swept amount, but the operator will receive more than the swept amount.

**Fix:** The `main` function should check the operator's wSOL ATA balance before the swap and record it in the ledger. The close instruction should only return the wrapped amount, not the entire balance.

### L5. Alarm's `detectVaultSetChange` Can Be Bypassed by a Large Number of Burns

**File:** `bank/detectors.mjs`
**Function:** `detectVaultSetChange`

**Vulnerability:** The `detectVaultSetChange` function has a guard against a large drop in the vault set. If more than `maxDropRatio` of the known set disappears, it reports a single `vault_index_shrank` finding and does not trust the current list. This is a good defense against a DAS failure.

However, the guard can be bypassed by a large number of real burns. If an attacker burns more than `maxDropRatio` of the vaults in a single pass, the function will report `vault_index_shrank` and will not report the individual burns. This means the alarm will not alert on the individual burns, which could be a mass redemption event.

**Evidence:** This can be demonstrated with a unit test. Create a previous set of 100 vaults and a current set with 50 vaults. The `detectVaultSetChange` function will report `vault_index_shrank` and will not report the 50 individual burns.

**Fix:** The `detectVaultSetChange` function should report the individual burns even when the drop is large. The `vault_index_shrank` finding should be in addition to the individual burn findings, not instead of them.

### L6. Crank's `main` Does Not Handle a Failed `getProgramAccounts` Call

**File:** `bank/crank.mjs`
**Function:** `main`

**Vulnerability:** The `main` function calls `conn.getProgramAccounts` to fetch all vault records. If this call fails (e.g., due to an RPC error), the function will throw an exception, and the crank will not run. This is a denial-of-service condition.

**Evidence:** This can be demonstrated by simulating an RPC error. The `main` function will throw, and the crank will not run.

**Fix:** The `main` function should handle RPC errors gracefully. It should retry the call a few times before giving up, and it should report the failure to the alarm.

---

## INFO FINDINGS

### I1. `scripts/rehearsal-tree.sh` Does Not Check for a Dirty Tree in the Rehearsal Worktree

**File:** `scripts/rehearsal-tree.sh`

**Vulnerability:** The script checks for a dirty tree in the main repository before creating the rehearsal worktree. However, it does not check for a dirty tree in the rehearsal worktree itself. If the rehearsal worktree is dirty (e.g., from a previous run), the script will proceed, and the rehearsal will be based on a modified tree.

**Evidence:** This can be demonstrated by making a change in the rehearsal worktree and then running the script. The script will not detect the change.

**Fix:** The script should check for a dirty tree in the rehearsal worktree before proceeding.

### I2. `bank/redemption-poster.mjs` Does Not Handle a Failed `getParsedTransaction` Call

**File:** `bank/redemption-poster.mjs`
**Function:** `main`

**Vulnerability:** The `main` function calls `conn.getParsedTransaction` to fetch the redemption transaction. If this call fails (e.g., due to an RPC error), the function will throw an exception, and the poster will not run.

**Evidence:** This can be demonstrated by simulating an RPC error. The `main` function will throw, and the poster will not run.

**Fix:** The `main` function should handle RPC errors gracefully. It should retry the call a few times before giving up, and it should report the failure.

---

## ACCEPTED LIMITS ANALYSIS

The accepted limits are reproduced verbatim from SPEC.md. I have analyzed each one for the four questions posed:

1. **Is any limit WORSE than stated?**
   - **Limit 10 (Swap Operator):** The limit states the operator can keep the SOL "per-sweep cap x cooldown windows until the guardian pulls `emergency_stop_sweep`". This is accurate. However, the limit does not mention the **CRITICAL** vulnerability found in this audit (C1), which allows an attacker to drain a vault's SOL during redemption. This is a separate issue from the swap operator's trust, but it is a consequence of the sweep helper's design.
   - **Limit 25 (Re-roll):** The limit states a minter can get a re-roll "PROVIDED no one else captures in the ~300-slot (~2 min) window". This is accurate. However, the limit does not mention that the crank's reveal lane can be stalled by a single RPC socket that accepts and never answers (as measured in Round 25). This makes the re-roll easier to achieve.

2. **Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?**
   - **Limit 9 (Foreign Core Asset):** The limit states "Nothing detects a FOREIGN Core asset nested in a vault continuously". This is still true. However, the sweep helper (if fixed as recommended in C1) could be extended to detect and refuse foreign Core assets during redemption. This would close the limit.
   - **Limit 44 (Undeclared Airdrops):** The limit states "Undeclared airdrops and nested vaults are DESTROYED on redemption". This is still true for nested vaults. However, for classic SPL tokens, the sweep helper can now rescue them if the page names them. This is a partial closure of the limit.

3. **Is any DISCHARGED item not actually discharged?**
   - **Item 51 ($CBOB Boost):** The item is marked as DISCHARGED. The boost is built and measured. However, the item's "accepted residue, boost timing" is still a concern. A burner can time their boost purchase to maximize their share of a large distribution. This is disclosed, but it is a real advantage that could be exploited.

4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?**
   - **Item 50 (Holder Surfaces):** The item is OPEN AND BLOCKING. The holder guide promises pages that do not exist. This is a critical gap that must be addressed before launch. The audit found no evidence that this item is being treated as accepted.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

The project must do the following before launch, which AI audit structurally cannot:

1. **Fix the CRITICAL vulnerability in the sweep helper (C1).** This is a direct theft vector that must be closed before the programs are made immutable. The fix must be verified by a test that demonstrates an attacker cannot drain a vault's SOL.

2. **Conduct a formal verification of the sweep helper's access control.** The current design relies on Core's `ExecuteV1` for authorization, but the helper itself does not verify this. A formal proof that the helper can only be invoked through `ExecuteV1` is needed.

3. **Run the full test suite, including the Test Vault simulation and the swap fork, against the final, immutable code.** The current tests are against a mutable version. The final code must be tested as it will be deployed.

4. **Perform a mainnet dress rehearsal with real, small amounts of value.** This is already planned (item 22), but it must be executed with the fixed sweep helper. The rehearsal should include a test of the sweep helper's access control.

5. **Have a human expert review the sweep helper and the swap code.** AI audit has found critical issues in the past, but it has also missed issues. A human review of the most critical new code is essential.

6. **Document the exact steps for hand recovery of an open revenue cycle.** The current documentation is a runbook note. A more detailed, step-by-step guide is needed, including how to verify a swap's status on chain and how to record the hand return in the ledger.

7. **Ensure the holder guide is accurate and complete.** The guide promises surfaces that do not exist. It must be updated to reflect the actual state of the system, or the surfaces must be built before the guide is published.

8. **Consider a bug bounty program.** With immutable programs, any bug is permanent. A bug bounty program can incentivize external researchers to find and report bugs before launch.

9. **Prepare a post-launch incident response plan.** The plan should include procedures for handling a stolen guardian key, a stolen swap operator key, a Coinbase freeze, and a Metaplex Core upgrade.

10. **Ensure the alarm system is robust and cannot be silenced by a single point of failure.** The alarm is the only detection mechanism for many critical events. It must be redundant and reliable.

The project is at a critical juncture. The code is complex, and the stakes are high. The AI audit process has found many issues, but it is not a substitute for human expertise. The project must take the necessary steps to ensure the security of the system before it is made immutable.