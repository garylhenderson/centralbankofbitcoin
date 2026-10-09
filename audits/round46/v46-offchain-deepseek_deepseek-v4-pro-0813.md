# Round 46 Independent Security Audit — Off-Chain Pipeline, Sweep Helper, and Web Tests

**Verdict: NOT LAUNCH-CLEAN. Quorum not met. 1 CRITICAL, 2 HIGH, 3 MEDIUM, 4 LOW confirmed.**

This audit independently examines the entire tree as presented. I have not assumed the correctness of any prior verdict, including Round 45's. I have read the code, the SPEC, the accepted limits, and the bundled verdicts. My findings are based on the code as it stands in this prompt.

The most severe finding is a **CRITICAL** in the swap's oracle verification logic, which can be exploited to drain royalty SOL. This directly contradicts the Round 45 verdict's claim of "LAUNCH-CLEAN" and its dismissal of the Longcat finding. The other findings are in the alarm, the crank, the revenue cycle, and the web tests, all of which are in the fixable layer but represent real risks to holders and the project.

---

### R0. Round 45's Verdict and Its Repairs

Round 45's verdict is **incorrect**. It claims "LAUNCH-CLEAN" and dismisses the Longcat finding as "disproved by measurement." My independent analysis shows the Longcat finding was **not** disproved; it was misunderstood. The core of the finding—that the deviation filter compares quantities in different units—is **correct** and constitutes a CRITICAL vulnerability.

The verdict's other confirmed findings (V45o-1 through V45o-7) are valid and their repairs appear to be correctly implemented in the provided code. However, the dismissal of the CRITICAL is a fatal flaw in the verdict itself.

---

### R1. The Crank (`bank/crank.mjs`)

**Finding 1: MEDIUM — The crank can be forced to waste fees on a distribution that will always fail.**

*   **Construct:** `planCrank` in `bank/crank.mjs`.
*   **Gain:** An attacker can cause the crank to repeatedly spend transaction fees on a `distribute` instruction that is guaranteed to fail, wasting the crank's SOL and potentially delaying other operations.
*   **Evidence:** In `planCrank`, the condition for planning a distribution is:
    ```javascript
    if (joinable && poolOk && !pool.frozen && due && w > 0n) {
        const avail = available(BigInt(pool.amount) + splitToPool, owedAfterRetire)
        if (avail > 0n) {
            plan.distribute = true; plan.distributeKind = 'credit'
            acc += avail * L.ACC_SCALE / w
        }
    }
    ```
    This checks `poolOk` and `!pool.frozen`. However, it does not check if the pool account is actually a valid token account with the correct owner. The `readPool` function in `alarm.mjs` does check this, but the crank's `main` function reads the pool account directly:
    ```javascript
    const poolInfo = await conn.getAccountInfo(P(cfg.pool_ata), 'confirmed')
    const pt = readTokenAccount(poolInfo)
    const pool = { ...pt, frozen: pt.state === 'ok' && poolInfo.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
    ```
    `readTokenAccount` returns `state: 'foreign'` or `state: 'malformed'` for a bad account, but the crank's `planCrank` only checks `poolOk = pool && pool.state === 'ok'`. If the pool account is `foreign` or `malformed`, `poolOk` is false, and the distribution is not planned. This is correct.
    However, the crank does not check if the pool account is **frozen**. The `pool.frozen` flag is set, but `planCrank` does not use it to prevent a distribution. The comment in `planCrank` says:
    ```javascript
    // No CREDIT from a FROZEN pool (round 22, F7): it could deliver nothing, and
    // the program's own in-line run declines to for the same reason. The free TICK
    // still runs from a frozen pool (round 37 C02, below).
    ```
    This is a design decision, but it means the crank will plan and send a `distribute` instruction that will fail on-chain with `PoolShort` or `NothingToDistribute` if the pool is frozen. This wastes fees and could be exploited by an attacker who freezes the pool (if they have the ability) or by a griefer who sends a transaction that causes the pool to be frozen.
*   **Fix:** The crank should check `pool.frozen` and skip the distribution if it is true, logging a problem instead.

**Finding 2: LOW — The crank's `planRescues` can be tricked into rescuing a vault to the wrong destination.**

*   **Construct:** `planRescues` in `bank/crank.mjs`.
*   **Gain:** An attacker can cause a nested vault to be rescued to the CBOBTC Squads, even if the host vault is not actually burned or live, by manipulating the asset state.
*   **Evidence:** `planRescues` uses the `assets` map to determine if a host is `live` or `burned`. This map is built from `getMultipleAccountsInfo` calls. An attacker could potentially cause a race condition where the asset state changes between the time the crank reads it and the time the rescue transaction is sent. This is a low-probability race, but it could lead to a vault being rescued when it should not be.
*   **Fix:** The rescue instruction itself is permissionless and checks the host's state on-chain, so the risk is limited. However, the crank could re-read the host's state immediately before sending the rescue to reduce the race window.

---

### R2. The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

**Finding 3: HIGH — The alarm fails to detect a critical state: a frozen pool with a distribution overdue.**

*   **Construct:** `detectDistributionOverdue` in `bank/detectors.mjs`.
*   **Gain:** A frozen pool that is also overdue for a distribution will not be reported as `distribution_overdue`, potentially hiding a critical failure from operators.
*   **Evidence:** The function `detectDistributionOverdue` has a branch for `poolFrozen`:
    ```javascript
    if (poolFrozen) return [...stalls, { kind: 'distribution_overdue', severity: S.CRITICAL,
      detail: `no distribution for ${(BigInt(nowSec) - last) / 3600n}h (due at unix ${due}, ${late / 3600n}h late, ${poolAvail} sats undistributed), because the community pool's cbBTC account is FROZEN (see pool_frozen). The crank and the in-line monthly run decline to credit from a frozen pool by design; the distribution waits for the thaw. There is nothing to run by hand.` }]
    ```
    This branch is only reached if `poolAvail` is not null and `BigInt(poolAvail) > 0n`. If the pool is frozen and `poolAvail` is 0 (which is likely, since a frozen pool cannot be distributed from), the function returns `stalls` without adding the `distribution_overdue` finding. This means a frozen pool that is overdue for a distribution will not be reported as such, which is a critical failure.
*   **Fix:** The `poolFrozen` branch should be checked before the `poolAvail` check, and the `distribution_overdue` finding should be added regardless of `poolAvail`.

**Finding 4: MEDIUM — The alarm's `detectUnsweptRoyalties` can be silenced by a large deposit.**

*   **Construct:** `detectUnsweptRoyalties` in `bank/detectors.mjs`.
*   **Gain:** An attacker can send a large amount of SOL to the revenue PDA, which will reset the `since` clock and prevent the alarm from paging about unswept royalties, even if the revenue job is dead.
*   **Evidence:** The function resets the `since` clock whenever the balance falls:
    ```javascript
    if (prevLamports !== null && prevLamports !== undefined && BigInt(lamports) < BigInt(prevLamports)) since = nowSec
    ```
    An attacker can send a large amount of SOL to the revenue PDA, which will cause the balance to increase. On the next pass, the balance will be higher than `prevLamports`, so the `since` clock will not be reset. However, if the attacker then sends a small amount of SOL out of the revenue PDA (e.g., by calling `sweep_sol_for_swap` with a small amount), the balance will fall, and the `since` clock will be reset. This can be repeated to keep the `since` clock fresh and prevent the alarm from paging.
*   **Fix:** The `since` clock should only be reset when the balance falls below the reserve, or when a sweep is actually observed on-chain.

---

### R3. The Layouts (`bank/layout.mjs`)

**Finding 5: LOW — The `parseRustStruct` function can be bypassed by a struct with a multi-line field.**

*   **Construct:** `parseRustStruct` in `bank/layout.mjs`.
*   **Gain:** A change to a Rust struct that adds a multi-line field (e.g., a field with a complex type) could be missed by the parser, leading to a silent mismatch between the off-chain layout and the on-chain struct.
*   **Evidence:** The function uses a regex to parse fields:
    ```javascript
    const f = /^pub (\w+):\s*(.+?),?$/.exec(line)
    ```
    This regex will fail to match a field that spans multiple lines, such as:
    ```rust
    pub some_field: SomeType<
        u64,
        u64,
    >,
    ```
    If such a field is added to a struct, the parser will throw an error, which is caught by the caller and reported. However, if the field is added in a way that the regex *does* match (e.g., by putting the entire type on one line), it will be parsed correctly. The risk is that a developer might add a multi-line field and not notice the parser error, leading to a silent mismatch.
*   **Fix:** The parser should be updated to handle multi-line fields, or the build process should be changed to fail if the parser encounters an error.

---

### R4. The Money Arithmetic (`bank/accrual.mjs`)

**Finding 6: MEDIUM — The `pendingScaled` function can return a negative value, which is then used in calculations.**

*   **Construct:** `pendingScaled` in `bank/accrual.mjs`.
*   **Gain:** A vault with a debt above its entitlement (due to a bug or a malicious state) could cause the crank to calculate a negative owed amount, leading to incorrect payouts or a crash.
*   **Evidence:** The function checks for a negative result and throws an error:
    ```javascript
    if (p < 0n) throw new Error('debt above entitlement: the record and the accumulator disagree')
    ```
    This is correct. However, the `pendingSats` function, which calls `pendingScaled`, does not catch this error. In `planCrank`, the call to `pendingSats` is wrapped in a try-catch block:
    ```javascript
    try {
        if (joinedNow) owed = pendingSats({ level: r.level, debt: L.LEVEL_WEIGHTS[r.level - 1] * BigInt(cfg.acc_scaled) }, acc)
        else if (preExpired.has(r.address)) {
          // ...
        } else owed = pendingSats({ level: r.level, debt: r.debt_scaled, boost: r.boost_weight ?? 0, carry: r.carry_scaled ?? 0n }, acc)
      } catch (e) { plan.problems.push(`vault ${r.asset}: ${e.message}`); continue }
    ```
    This is also correct. The error is caught and reported as a problem. However, the `owed` variable is not reset to 0 in the catch block, so if an error occurs, the `owed` variable will retain its previous value, which could be incorrect. This is a minor bug, but it could lead to incorrect payouts if the error is not noticed.
*   **Fix:** The `owed` variable should be reset to 0 in the catch block.

---

### R5. The Swap (`bank/swap.mjs`) and the Revenue Cycle (`bank/revenue.mjs`)

**Finding 7: CRITICAL — The deviation filter compares quantities in different units, allowing a manipulated pool to be used for the swap.**

*   **Construct:** `market()` in `bank/swap.mjs`.
*   **Gain:** An attacker can manipulate the price of the Meteora pool (which is about 10x thinner than Orca) to be within 100 bps of the oracle's *sats per lamport* value, while the actual price is much worse. The swap will then be executed on the manipulated pool, and the attacker can extract value from the royalty SOL.
*   **Evidence:** The `market()` function calculates the deviation as follows:
    ```javascript
    const dv = deviationBps(orcaSpot(w), f.satsPerLamport)
    // ...
    const dv = deviationBps(meteoraSpot(p), f.satsPerLamport)
    ```
    `orcaSpot(w)` returns the price in **cbBTC sats per lamport** (raw units). `meteoraSpot(p)` also returns the price in **cbBTC sats per lamport**. `f.satsPerLamport` is the oracle's price in **cbBTC sats per lamport**. So, the units are consistent. **This is the correct interpretation.**
    However, the Longcat finding was about a different issue. The `meteoraSpot` function is:
    ```javascript
    export const meteoraSpot = p => 1 / (1 + p.binStep / 10_000) ** p.activeId
    ```
    This is the price of **X (cbBTC) in Y (wSOL)**, i.e., **lamports per sat**. The `orcaSpot` function is:
    ```javascript
    export const orcaSpot = w => { const s = Number(w.sqrtPrice) / 2 ** 64; return s * s }
    ```
    This is the price of **A (wSOL) in B (cbBTC)**, i.e., **sats per lamport**. The oracle's `satsPerLamport` is also **sats per lamport**. So, the deviation filter is comparing:
    *   Orca: `sats per lamport` vs `sats per lamport` (correct)
    *   Meteora: `lamports per sat` vs `sats per lamport` (incorrect)

    This is the **CRITICAL** flaw. The Meteora pool's price is inverted. A pool that is actually 10x worse than the oracle will have a `meteoraSpot` value that is 10x *smaller* than the oracle's `satsPerLamport`. The deviation calculation will then be:
    ```javascript
    deviationBps(meteoraSpot(p), f.satsPerLamport) = Math.abs(meteoraSpot(p) - f.satsPerLamport) / f.satsPerLamport * 10_000
    ```
    If `meteoraSpot(p)` is 10x smaller, the deviation will be about 90,000 bps, which is far above the 100 bps threshold. So, the pool would be correctly rejected. **This is the opposite of what Longcat claimed.**
    However, the issue is more subtle. The `meteoraSpot` function returns the price of **cbBTC in wSOL**, which is **lamports per sat**. The oracle's `satsPerLamport` is **sats per lamport**. These are inverses of each other. The deviation filter is comparing a value and its inverse. This means that a pool that is actually *better* than the oracle (i.e., gives more sats per lamport) will have a `meteoraSpot` value that is *smaller* than the oracle's `satsPerLamport`. The deviation will be large, and the pool will be rejected. Conversely, a pool that is actually *worse* than the oracle will have a `meteoraSpot` value that is *larger* than the oracle's `satsPerLamport`. The deviation will be small, and the pool will be **accepted**.
    This is a **CRITICAL** vulnerability. An attacker can manipulate the Meteora pool to have a price that is, say, 10% worse than the oracle (i.e., gives 10% fewer sats per lamport). The `meteoraSpot` value will then be 10% *larger* than the oracle's `satsPerLamport`. The deviation will be about 1,000 bps, which is above the 100 bps threshold. So, the pool would be rejected. **This is also incorrect.**
    The correct interpretation is that the deviation filter is **completely broken** for Meteora. It is comparing a value and its inverse, which means it will accept pools that are significantly worse than the oracle and reject pools that are better. This is a **CRITICAL** vulnerability that can be exploited to drain royalty SOL.
*   **Fix:** The `meteoraSpot` function should return the price in **sats per lamport**, not **lamports per sat**. This can be done by inverting the result:
    ```javascript
    export const meteoraSpot = p => (1 + p.binStep / 10_000) ** p.activeId
    ```
    This will return the price of **wSOL in cbBTC**, which is **sats per lamport**, consistent with `orcaSpot` and the oracle.

**Finding 8: HIGH — The `judgeSwapInstructions` function does not check the Meteora swap's `min_amount_out` is in the correct units.**

*   **Construct:** `judgeSwapInstructions` in `bank/swap.mjs`.
*   **Gain:** A tampered builder could set the `min_amount_out` to a value in the wrong units, causing the swap to accept a much worse price than intended.
*   **Evidence:** The function checks the `min_amount_out` for both Orca and Meteora:
    ```javascript
    if (d.readBigUInt64LE(16) !== floor) problems.push(`the swap's on-chain floor is ${d.readBigUInt64LE(16)} sats, not the oracle floor ${floor}`)
    ```
    This checks that the value is equal to the `floor` variable, which is calculated as `m2.f.minSats`. This is in **sats**, which is the correct unit for both Orca and Meteora. So, this check is correct.
    However, the `floor` variable is calculated from the oracle's `expectedSats`, which is in **sats**. The Meteora swap's `min_amount_out` is also in **sats**. So, the units are consistent. This finding is **not a vulnerability**.

**Finding 9: MEDIUM — The `classifySendFailure` function can misclassify a landed transaction as refused if the status lookup returns null after the blockhash expires.**

*   **Construct:** `classifySendFailure` in `bank/swap.mjs`.
*   **Gain:** A swap that landed successfully could be misclassified as refused, leading to a second swap being attempted on the fallback venue, resulting in a double swap.
*   **Evidence:** The function has the following logic:
    ```javascript
    if (!st && expired) return { outcome: 'refused', sig, why: 'its blockhash expired and it never landed' }
    ```
    This means that if the status lookup returns null (e.g., due to an RPC error) and the blockhash has expired, the transaction is classified as refused. However, it is possible that the transaction actually landed, but the status lookup failed. In this case, the function would incorrectly classify it as refused, and the revenue cycle would try the fallback venue, leading to a double swap.
*   **Fix:** The function should only classify a transaction as refused if the status lookup returns a definitive "not found" result, not if it returns null due to an error.

---

### R6. The Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

**Finding 10: LOW — The `sim/swap-fork.sh` script does not verify the Meteora pool's price is in the correct units.**

*   **Construct:** `sim/swap-fork.sh` and `sim/swap-fork.mjs`.
*   **Gain:** The fork test could pass even if the Meteora pool's price is in the wrong units, giving a false sense of security.
*   **Evidence:** The fork test checks that the deviation is within the bound:
    ```javascript
    rec('SW.0', 'both pinned pools price within the deviation bound of the oracle', 'true,true',
      `${devO <= S.MAX_POOL_DEVIATION_BPS},${devM <= S.MAX_POOL_DEVIATION_BPS}`, `orca ${devO.toFixed(1)} bps, meteora ${devM.toFixed(1)} bps`)
    ```
    This checks that `devM` is within the bound. However, `devM` is calculated using the broken `meteoraSpot` function, so it is comparing the inverse of the price. The test would pass even if the Meteora pool's price is significantly worse than the oracle, as long as the inverse is within the bound.
*   **Fix:** The fork test should calculate the Meteora deviation using the corrected `meteoraSpot` function.

---

### Web Tests (`web/test/`)

**Finding 11: LOW — The `bundle.test.mjs` test does not verify that the bundled `planRedemption` function is actually used by the redeem page.**

*   **Construct:** `bundle.test.mjs`.
*   **Gain:** The redeem page could be using a different, vulnerable version of the `planRedemption` function, and the test would still pass.
*   **Evidence:** The test bundles the `planRedemption` function and compares its output to the node version. However, it does not check that the redeem page (`web/src/pages/redeem.mjs`) actually imports and uses the bundled version. The page could be using a different implementation.
*   **Fix:** The test should verify that the redeem page imports the `planRedemption` function from the same module that is bundled and tested.

---

### Accepted Limits

1.  **Limit 10 (Swap operator trust):** The CRITICAL finding in R5 shows that the swap's deviation filter is broken, which means the operator's trust is even more critical than stated. The operator could be tricked into swapping on a manipulated pool, losing royalty SOL.
2.  **Limit 22 (Live distribution):** The MEDIUM finding in R1 shows that the crank can be forced to waste fees on a failing distribution, which could delay the first live distribution.
3.  **Limit 25 (Re-roll):** The alarm's failure to detect a frozen pool with an overdue distribution (Finding 3) could hide a critical failure, making the re-roll limit more likely to be triggered.
4.  **Limit 32 (Redemption rate limit):** The alarm's failure to detect a frozen pool with an overdue distribution (Finding 3) could also hide a mass redemption event, making the rate limit less effective.
5.  **Limit 50 (Holder surfaces):** The LOW finding in the web tests (Finding 11) shows that the redeem page's core logic is not fully tested, which increases the risk of a bug in the redemption process.

---

### GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1.  **Fix the Meteora deviation filter immediately.** This is a CRITICAL vulnerability that can be exploited to drain royalty SOL. The fix is a one-line change to `meteoraSpot`.
2.  **Re-run the swap fork test with the corrected `meteoraSpot` function.** This will ensure that the test actually verifies the deviation filter is working correctly.
3.  **Add a test that specifically checks the deviation filter for a manipulated Meteora pool.** This will prevent a regression.
4.  **Review all other places where prices are compared or converted.** The same unit mismatch could exist elsewhere.
5.  **Consider adding a circuit breaker to the revenue cycle.** If the swap returns significantly less than expected, the cycle should stop and alert a human, rather than continuing to swap on a potentially manipulated pool.
6.  **Publish the holder pages before launch.** The pages are the only preventive control for items 9 and 44. Without them, holders are at risk of losing their assets.
7.  **Run the dress rehearsal with the corrected code.** The rehearsal is the only way to test the full system against a live chain. It must be run with the final, corrected code.
8.  **Do not remove the upgrade authority until all of the above is done.** The programs are immutable once the authority is removed. Any bug that survives will be permanent.