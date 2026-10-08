# Round 40 Independent Audit — Off-Chain Pass

## R0. Round 39 Verdict Verification

I verified the four confirmed findings (C01–C04) and the INFO exception (C05) from the round 39 off-chain verdict. The repairs for C01 (crank send-block gate), C02 (alarm baseline write gates), C03 (bundled `planRedemption` assertion), and C04 (ceremony key freshness) are present in the selftest and appear structurally sound. C05's text fix in HOLDER-GUIDE.md ("built, and published before launch") is in place. I did not re-file any of these.

However, my independent review of the current tree found a new defect in the swap judge that was not caught by round 39.

---

## R5. The Swap — `bank/swap.mjs`

### Finding 1 — HIGH: `judgeSwapInstructions` uses the wrong ComputeBudget instruction type for `SetComputeUnitLimit`, causing it to reject every valid swap

**File:** `bank/swap.mjs`, function `judgeSwapInstructions`, instruction-0 check.

**The defect.** The judge validates instruction 0 with:

```javascript
if (!cu?.programId.equals(ComputeBudgetProgram.programId) || data(cu).length !== 5 || data(cu)[0] !== 2
    || data(cu).readUInt32LE(1) !== SWAP_CU_LIMIT || cu.keys.length)
  problems.push(`instruction 0 is not SetComputeUnitLimit(${SWAP_CU_LIMIT})`)
```

The check `data(cu)[0] !== 2` expects the first data byte to be **2**. But `ComputeBudgetProgram.setComputeUnitLimit` (from `@solana/web3.js`, used in `swapInstructions`) produces instruction type **1**, not 2. The Solana compute budget instruction encoding is:

| Type byte | Instruction |
|---|---|
| 0 | `RequestHeapFrame` |
| **1** | **`SetComputeUnitLimit`** |
| 2 | `SetComputeUnitPrice` (priority fee) |
| 3 | `SetLoadedAccountsDataSizeLimit` |

The builder (`swapInstructions`) creates instruction 0 as `ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })`, which serializes to `[1, 0x40, 0x0D, 0x03, 0x00]` (type 1, units 400000 LE). The judge then checks `data(cu)[0] !== 2`, which evaluates to `1 !== 2` → **true**, so the OR condition fires and the judge pushes a problem.

**Impact.** The judge would reject every valid swap transaction. In `revenue.mjs`, the judge is called after the sweep has already landed:

```javascript
const bad = SW.judgeSwapInstructions(ixs, operator.publicKey, venue, { lamportsIn: amount, minSats: guaranteed })
if (bad.length) throw new Error(`refusing to sign the ${venue} swap we built: ${bad.join('; ')}`)
```

This means: (1) SOL is swept to the operator, (2) the swap is refused by the judge, (3) the cycle stays open with SOL on the operator key, (4) the alarm pages `unreconciled_swap`. The revenue cycle is completely broken. No money is lost (the SOL stays on the operator), but royalty SOL accumulates unswept indefinitely.

**Evidence that would confirm this.** Run `SW.judgeSwapInstructions(SW.swapInstructions({venue:'orca', owner: someKey, lamportsIn: 1000000000n, minSats: 1000n, w: mockWhirlpool, p: null, bitmapExists: true}), someKey, 'orca', {lamportsIn: 1000000000n, minSats: 1000n})`. It will return a non-empty array containing "instruction 0 is not SetComputeUnitLimit(400000)". The selftest arm `M1: the judge passes the ${venue} swap we built` should fail if run against this code.

**Fix.** Change `data(cu)[0] !== 2` to `data(cu)[0] !== 1` in the instruction-0 check.

### Finding 2 — HIGH: `judgeSwapInstructions` priority-fee detection uses the wrong instruction type

**File:** `bank/swap.mjs`, function `judgeSwapInstructions`, the per-instruction loop.

**The defect.** The priority-fee check is:

```javascript
if (ix.programId.equals(ComputeBudgetProgram.programId) && d[0] === 3)
  problems.push('a priority fee (setComputeUnitPrice): the swap pays the base fee only')
```

This checks for type **3** (`SetLoadedAccountsDataSizeLimit`) but labels it "setComputeUnitPrice". The actual priority-fee instruction is type **2** (`SetComputeUnitPrice`). A tampered builder that appends a `SetComputeUnitPrice` instruction (type 2) would **not** be caught by this check.

**Impact.** If Finding 1 is fixed (so the judge no longer rejects valid swaps), a tampered builder could append a priority fee instruction that drains the operator key's lamports via inflated compute-unit pricing, and the judge would not flag it. The `SetLoadedAccountsDataSizeLimit` instruction (type 3) would be incorrectly flagged as a priority fee.

**Evidence.** Construct a 7-instruction array where instruction 0 is valid `SetComputeUnitLimit` (type 1) and append an 8th instruction `ComputeBudgetProgram.setComputeUnitPrice({microLamports: 25_000_000_000n})` (type 2). The judge would flag "8 instructions, not the seven a swap is" (catching it by count), but the specific priority-fee message would not appear. If the tampered builder replaces instruction 0 with the priority fee (keeping 7 instructions), the type-3 check would miss it.

**Fix.** Change `d[0] === 3` to `d[0] === 2` in the priority-fee check.

---

## R1. The Crank — `bank/crank.mjs`

I traced the full `planCrank` → `main()` flow. The send order (reschedule, capture, reveal, retire, preJoins, preExpires, split, distribute, postExpires, activate, claims) matches the SPEC and the red-team 3 finding 6 fix. The `budgetPlan` function correctly keeps the floor in reserve and budgets reveals. The `judgeDistributeRefusal` correctly distinguishes races from faults. The frozen-pool join-only path (round 38 C01 repair) is present and sends join batches. I found no new defect in the crank beyond what round 39 already addressed.

## R2. The Alarm — `bank/detectors.mjs`, `bank/alarm.mjs`

I verified `detectSweepState`, `cycleIsOpen`, `closesCycle`, `detectUnreconciledRevenue`, `detectSplitClaims`, and the log-gap/backlog machinery. The `sortedSplits` WeakMap optimization, the binary search in `closesCycle`, and the `detectLogGaps` watermark logic are correct. The `applyFrozenTransitions` and `detectCrankHealth` functions match their round-39 repairs. I found no new defect.

## R3. The Layouts — `bank/layout.mjs`

I verified the field lists against the Rust structs for all five config types and `VaultRecord`. The offsets, the `fixedLength` computation (1005 for MintConfig matching the Rust `MINT_CONFIG_SPACE`), and the cross-program offset assertions are consistent. The `parseRustStruct` strict mode (throwing on unparseable lines) is in place. I found no new defect.

## R4. The Money Arithmetic — `bank/accrual.mjs`

I verified `credit`, `pendingScaled`, `pendingSats`, `reweigh`, `ceilSats`, and `available` against the MINT program's Rust. The formulas match: `delta = avail * ACC_SCALE / w`, `owed += delta * w`, `pending = weight * acc + carry - debt`. The boost carry and reweigh logic is correct. I found no divergence.

## R6. The Gates — `bank/selftest.mjs`, `scripts/run-tests.sh`

The selftest floors (930 detector, 39 allocation, 24 poster, 49 launch, 4 expiry-budget, 14 PoB, 33 mainnet, 16 swap-fork) are enforced with equality checks. The `audit-coverage.sh` gate checks current content against completed quorate rounds. The `build-mainnet.sh` proves the sweep helper's byte identity. I found no vacuous gate beyond what round 39 addressed.

---

## Accepted Limits — Four Questions

**1. Is any limit WORSE than stated?**
Limit 10 (swap operator trust) is accurately stated. The judge bugs (Findings 1–2) do not widen the operator's trust boundary; they break the revenue cycle operationally. No accepted limit is worse than stated.

**2. Is anything listed as a limit not actually a limit?**
No. All stated limits correspond to real code behavior.

**3. Is any DISCHARGED item not actually discharged?**
No. The discharged items (51, 54, 12/17, 14, 19, 30, 31, 33, and the v5 Bank-era items) are genuinely resolved.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**
No. Items 22, 38, 50, 52, and 53 remain correctly listed as OPEN AND BLOCKING.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **Fix the swap judge before any live revenue cycle.** The `SetComputeUnitLimit` type check (byte 1, not 2) and the priority-fee type check (byte 2, not 3) must be corrected and the selftest re-run. This is a one-line fix per check. Without it, the revenue cycle is dead on arrival.

2. **Run the mainnet dress rehearsal (item 22) with the fixed judge.** The rehearsal must include one full live revenue cycle through both pools and one forced post-sweep failure, as specified. The judge bug would have been caught by the first live swap attempt.

3. **Verify the swap fork after the judge fix.** `sim/swap-fork.sh` exercises the judge against real pool state. Re-run it after the fix to confirm the judge passes honest builds and rejects all eight tamper vectors.

4. **Do not remove the upgrade authority until the rehearsal passes with the fixed judge.** The judge bug is off-chain, but it would prevent the revenue cycle from functioning, which is a launch-blocking operational failure.