# Round 31 Off-Chain Audit: Independent Verification

## R0. Round 30 Verdict — Repair Verification

I independently verified each of Round 30's six findings and their repairs:

**M1 (scan backlog)**: REPAIRED. `bank/sigwalk.mjs` now takes `startBefore`; `bank/alarm.mjs` persists `backlogs[program] = { head, before }` and resumes from `backlogs[id]?.before`. The drain requires positive proof. **Sound.**

**L1 (truncation grief)**: REPAIRED. `bank/alarm.mjs` computes `ran = [...new Set(ixs.map(ix => ix.program).filter(p => OURS.has(p)))]`; only `ran.length > 0` pages `log_coverage_gap` HIGH, otherwise `log_truncated_foreign` INFO. **Sound.**

**L2 (floor spend)**: REPAIRED. `budgetPlan` computes `room = lamports - planCostLamports(base) - floor`, keeping the floor in reserve. A base plan runs whenever covered. **Sound.**

**L3 (dust)**: REPAIRED. `sweepAmount` returns `0n` below `MIN_SWEEP_LAMPORTS` (0.01 SOL). **Sound.**

**D1 (rehearsal tags)**: REPAIRED. Run-failure, reconcile-failure messages carry `REHEARSAL` when `!PRODUCTION`. **Sound.**

**D2 (frozen stray)**: CODE IS CORRECT. Sweep helper skips transfer when `amount == 0`, only closes. SPEC text updated to "a frozen stray account holding a balance." **Sound.**

**Round 30 verdict: NOT CLEAN → repairs verified, no surviving defect from that round.**

---

## New Findings

### MEDIUM: Meteora bin array derivation unverified at negative active IDs

**File**: `bank/swap.mjs` `meteoraBinArrayIndexes`, `meteoraBinArray`

**The construct**:
```javascript
const MAX_BIN_PER_ARRAY = 70
const binArrayIndex = id => Math.floor(id / MAX_BIN_PER_ARRAY)
export const meteoraBinArrayIndexes = activeId => { const i = binArrayIndex(activeId); return [i, i + 1, i + 2] }
export const meteoraBinArray = i => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(i)); ... }
```

**What's wrong**: The fork test (`sim/swap-fork.mjs`) swaps through Meteora at `activeId: 5920` (positive). The derivation `Math.floor(5920 / 70) = 84` is correct. But if `activeId` goes negative (a DLMM pool's active bin can go below zero when the price drops below the lowest initialized bin), `Math.floor(-1 / 70) = -1` in JavaScript. The Meteora program's PDA derivation for bin arrays uses `i64` for the index, and the program's own handling of negative indices may not match this JavaScript computation. The fork test never exercises a negative active ID.

**What an attacker or accident gains**: Nothing. A wrong bin array derivation causes the Meteora CPI to fail (`InvalidBinArrayIndex` or similar), the swap reverts, and the operator key keeps its SOL. The cycle stays open and loud. No funds are at risk.

**Evidence that would exist if true**: A fork run with a Meteora pool whose `activeId` is negative (e.g., a SOL/cbBTC pool after a large price drop) would produce a swap that either lands with the wrong arrays or fails. The current fork test only uses `activeId: 5920`.

**Fix**: Add a fork arm that clones a Meteora pool with a negative active ID (or synthesizes one) and verifies the three bin arrays the swap names match the program's expected PDA derivation. Alternatively, read the Meteora program's `BinArray` PDA derivation from its source and assert the JavaScript matches for both positive and negative indices.

**Severity**: MEDIUM. No theft, no loss, but a real pool state (thin Meteora pool after price movement) would make the fallback venue unusable until the operator intervenes. The Orca-first ordering means this only matters when Orca refuses.

---

### LOW: `bank/crank.mjs` reveal loop has no defensive bound on `revealed_total` vs `minted_total`

**File**: `bank/crank.mjs` `planCrank`

**The construct**:
```javascript
for (let i = BigInt(cfg.revealed_total); ; i++) {
  const r = byIndex.get(i)
  if (!r || r.level !== 0) break
  if (!(r.entropy_set || capturedThisPass.has(r.address))) break
  plan.reveal.push(r.address)
}
```

**What's wrong**: If `revealed_total > minted_total` (which cannot happen in correct operation, but the code does not assert it), `byIndex.get(i)` returns `undefined` and the loop breaks silently. This masks a state inconsistency that should be loud.

**What an attacker or accident gains**: None. The loop breaks, no reveal is planned, and the next pass re-plans from the same `revealed_total`.

**Fix**: Add `if (i >= cfg.minted_total) break` as the first check, or assert `revealed_total <= minted_total` in the selftest.

**Severity**: LOW. Defensive coding only; no reachable defect.

---

### LOW: `bank/revenue.mjs` post-swap delta check uses operator's full cbBTC balance, not just the cycle's return

**File**: `bank/revenue.mjs` (return step)

**The construct**:
```javascript
const after = requireTokenAmount(...)
const delta = after > opBefore ? after - opBefore : 0n
if (delta < guaranteed) throw new Error(...)
const got = after  // sends everything
cycle.returnedSats = String(delta)  // records only the delta
```

**What's correct**: The code sends `got` (the full balance) back to revenue but records only `delta` as the cycle's return. This is intentional: "leftovers from a previous cycle belong to the project too." The delta check holds the return to the floor.

**What's wrong**: Nothing. This is correct and documented.

**Severity**: Not a defect. The code is sound.

---

## Accepted Limits — Four-Question Check

1. **Is any limit WORSE than stated?**
   - **Limit 10 (swap hop)**: The statement says "the output floor is the oracle-derived expected output less 150 bps." This is true for the Orca path. For Meteora, the same `minSats` is enforced via `min_amount_out`, but the Meteora pool's price impact can be larger than Orca's due to thinner liquidity (~0.9M vs ~$10M). The 150 bps floor is relative to the oracle, not the pool's own price, so the bound holds. **No change.**
   - **Limit 27 (dead weight)**: The crank now retires bare burns before paying or joining. The program-side acceptance (a claim between bare burn and retirement pays into a dead account) is still true, but the crank never triggers it. **Effectively closed by the crank, but the program-side limit remains.** Not worse.
   - **Limit 44 (undeclared airdrops destroyed)**: The sweep helper now sweeps classic SPL tokens when the page names them. The limit still holds for Token-2022 accounts and nested Core assets. **No change.**

2. **Is anything listed as a limit not actually a limit?**
   - **Limit 55 (unsplit revenue)**: The crank splits every pass, bounding the unsplit balance to about an hour of sales. This is still true. **No change.**
   - **Limit 56 ($CBOB hot key)**: The release wallet is still hot. **No change.**

3. **Is any DISCHARGED item not actually discharged?**
   - **Item 51 ($CBOB boost)**: Built and measured. The host unit test (`the_boost_schedule_through_the_programs_own_functions_across_four_wraps`) drives 260 epochs through the program's own functions. **Discharged.**
   - **Item 54 (compute units)**: Measured at 855 on-chain assertions. **Discharged.**

4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?**
   - **Item 22 (live distribution)**: Still open. The crank is installed dry-run. **Not quietly demoted.**
   - **Item 38 (launch values)**: Still open (charter_opens_at, lock_deadline). **Not quietly demoted.**
   - **Item 50 (holder surfaces)**: Still open. The redeem page is not built. **Not quietly demoted.**
   - **Item 52 (pool/Squads accounts)**: Still open. Road step 10 creates them. **Not quietly demoted.**
   - **Item 53 (dress rehearsal)**: Still open. The rehearsal tree is proven at throwaway ids. **Not quietly demoted.**

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

**What this project must do before launch that AI audit structurally cannot:**

1. **Deploy the sweep helper and run one live redemption through it on mainnet.** The fork test proves the swap; no test proves the sweep helper's `ExecuteV1` CPI through real Core with a real thawed vault. The helper is stateless and cannot be tested locally without a real Core asset. A mainnet dress rehearsal with a throwaway vault is the only proof.

2. **Run the crank against a live cluster with ~2,100 vaults for at least one full month.** The local validator has no 2,100-vault history, no DAS, no real signature backlog. The crank's paging, batching, and fee-budgeting under load are unmeasured. Item 22 states this; it must be done.

3. **Run one full revenue cycle through each pool on mainnet, with Orca forced to refuse.** The fork test proves the swap math; it does not prove the ledger's recovery path when a sweep lands and a swap fails. The hand-recovery runbook is written but unexercised.

4. **Resolve the Meteora bin array derivation for negative active IDs.** The fork test uses `activeId: 5920`. A real Meteora pool after a price drop could have a negative active ID, and the swap's bin array derivation is unverified in that state. This is the one new code defect I found.

5. **Publish the holder guide only after item 50 ships.** The guide promises a redeem page, deposit addresses, and public posts. None exist. Publishing the guide now would be a false promise to holders.

6. **Fund the revenue address above rent exemption before the first paid mint.** Road step 10 does this, but it is not automated. A missed step means the first mint fails.

7. **Remove the upgrade authority from all five programs in one witnessed ceremony.** The alarm watches for this, but the act itself is manual and irreversible. A missed program (the sweep helper is easy to forget) leaves a permanent upgrade path.

---

## Verdict

**Round 31: NOT CLEAN.**

One new MEDIUM finding (Meteora bin array derivation at negative active IDs) and one new LOW finding (defensive bound on reveal loop). Round 30's repairs are sound. The accepted limits are accurately stated. The open items remain open.

The consecutive-clean counter remains **0/2**.