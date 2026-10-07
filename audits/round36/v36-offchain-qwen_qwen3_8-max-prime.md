# Round 36 Audit Report

## R0: Round 35 Verdict and Repairs

Round 35 produced no quorum (9/16 seats refused, HTTP 402). The program change (`rescue_nested`, item 58) was reviewed adversarially and validated. I verified the triage findings (C1–C25), the review findings (M1, M2, L1–L6), and the VALIDATION claims against the current tree.

**Verified repairs:**
- M1 (live-host branch sending to host's owner): Fixed. All rescues now go to `bank_treasury`.
- M2 (foreign live host): Fixed. Foreign live hosts are refused (`HostUnresolved`).
- Rescue destination is pinned to `config.bank_treasury` with `require_keys_eq!`. Correct.
- The `RescueNested` accounts struct correctly derives `rescue_authority` from `RESCUE_SEED`.
- The `create_vault` function correctly installs the `PermanentTransferDelegate` with authority `rescue_pda`.
- Suite arms R35.N1–N9, N2a, N8a are present and the VALIDATION records 889/889 on-chain assertions.

**Verified triage items:**
- C1/C2 (road step ordering): SPEC steps 9–11 are rewritten correctly. Step 9 upgrades without `--final`; step 10 re-verifies; step 11 verifies, makes final, verifies again.
- C3 (GOV mirrors MINT constants): The selftest pins `MIN_ROUND_PRICE_SATS` and `MAX_ROUND_SECS`.
- C4 (placeholder upgrade key custody): Stated in SPEC step 9.
- C5 (close-authority grief): Stated as a limit in SPEC "Known limits."
- C9 (crank activates nested vaults): Stated as superseded by item 58. See finding F4 below.
- C10 (index lag): Stated as a limit.
- C18 (seenSplits growth): Stated as a limit.

---

## R1: THE CRANK (`bank/crank.mjs`)

### F1 — CRITICAL: `revenue.mjs` sweep instruction marks operator as `isSigner: false`

**File/function:** `bank/revenue.mjs`, the sweep `TransactionInstruction` inside `main()`.

**The defect:** The sweep instruction passes the operator with `isSigner: false`:

```javascript
keys: [{ pubkey: MINT_CFG, isSigner: false, isWritable: true },
  { pubkey: REVENUE, isSigner: false, isWritable: true },
  { pubkey: operator.publicKey, isSigner: false, isWritable: true },  // ← WRONG
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }]
```

But MINT's `SweepSolForSwap` struct requires `pub swap_operator: Signer<'info>`. Anchor checks `info.is_signer`, which is set from the instruction's `isSigner` flag, not the transaction's signer list. With `isSigner: false`, Anchor will reject the instruction with `AccountNotSigner`.

**What an attacker or accident gains:** The sweep fails on-chain every time. Royalty SOL accumulates in the revenue PDA indefinitely. The revenue cycle is completely non-functional. The alarm would eventually page `royalties_unswept`, but the root cause would be obscure.

**Evidence that would exist if I am right:** Running `node bank/revenue.mjs --live` against a cluster where the cooldown has elapsed and sweepable SOL exists would produce an Anchor error containing `AccountNotSigner` or error code `0x7dc` (Anchor's `AccountNotSigner`). The suite's sweep tests (6.17, 6.17a, 6.17b) pass because they construct the instruction with the correct `isSigner: true` flag; only `revenue.mjs` has the wrong flag. The revenue cycle has never been run against a live cluster (item 22), so this has not been caught.

**Fix:** Change `isSigner: false` to `isSigner: true` for the operator key in the sweep instruction. Add a selftest arm that extracts the sweep instruction from `revenue.mjs` source and asserts the operator key has `isSigner: true`.

---

### F2 — LOW: Crank does not automate `rescue_nested`

**File/function:** `bank/crank.mjs`, `planCrank()` and `main()`.

**The defect:** The crank plans reschedule, capture, reveal, retire, join, distribute, activate, and claim, but does not plan or send `rescue_nested` for vaults detected as nested by the alarm. The rescue is permissionless, so anyone can call it, but the crank is the automation layer and should handle it.

**What an accident gains:** A vault sent to the wrong deposit address sits nested until a human notices the `nested_vault` alarm and manually rescues it. During that window, if the vault was already active, it continues to dilute other vaults (see F3).

**Evidence:** `planCrank()` has no `rescue` array. `main()` has no `rescue_nested` instruction. The alarm pages `nested_vault` but the crank doesn't act on it.

**Fix:** Add a `rescue` step to the crank that reads the DAS vault list, identifies nested vaults (owner is a vault PDA), and sends `rescue_nested` for each. Alternatively, document that rescue is manual-only and add it to the control table as PROCEDURE.

---

## R2: THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

No new defects found. The detectors are comprehensive and the selftest covers them in both directions. The round 32–34 repairs (sweep state detection, log gaps, split history growth, closesCycle optimization) are correctly implemented.

One observation: the alarm's `readConfigs()` correctly produces `mint.last_sweep_at` (added in round 33), and the `WATCHED_KEYS` list includes it. The `missingWatchedKeys` check would catch a reader that drops it.

---

## R3: THE LAYOUTS (`bank/layout.mjs`)

### F3 — LOW: `RESCUE_SEED` not in `L.SEEDS`

**File/function:** `bank/layout.mjs`, `SEEDS` constant.

**The defect:** The MINT program defines `pub const RESCUE_SEED: &[u8] = b"rescue"` and uses it to derive the `rescue_authority` PDA in `RescueNested`. But `L.SEEDS` does not include a `rescue` entry. The round 24 D6 selftest scrapes 11 seeds from the Rust source and verifies them against `L.SEEDS`, but `RESCUE_SEED` is not among them because it was added in round 35 after the seed assertion was written.

**What an accident gains:** If the redeem page (item 50) or any future off-chain code needs to derive the rescue PDA, it would hardcode the seed `"rescue"`, creating a second copy of the fact that could drift. The selftest would not catch a rename of `RESCUE_SEED` in the Rust source.

**Evidence:** `L.SEEDS` has 11 entries. The MINT source has 12 seed constants (including `RESCUE_SEED`). The selftest's `SEED_SRC` map has 11 entries and does not include `rescue`.

**Fix:** Add `rescue: 'rescue'` to `L.SEEDS`. Add `rescue: [MINT_RS, 'RESCUE_SEED']` to the selftest's `SEED_SRC` map. Update the seed count assertion from 11 to 12.

---

## R4: THE MONEY ARITHMETIC (`bank/accrual.mjs`)

No divergence found. I verified:
- `credit()` matches MINT's `credit()`: `delta = avail * ACC_SCALE / w`, `acc += delta`, `owed += delta * w`.
- `pendingScaled()` matches MINT's `owed_of()`: `(weight + boost) * acc + carry - debt`.
- `reweigh()` matches MINT's `reweigh()`: `carry = owed`, `debt = new_weight * acc`.
- `ceilSats()` matches MINT's `ceil_sats()`: `(scaled + ACC_SCALE - 1) / ACC_SCALE`.
- The crank's boost expiry logic (`preExpires` and `postExpires`) correctly mirrors the program's `BoostsExpireFirst` gate and `advance_epoch`.
- The crank's `splitToPool` hardcodes `1500n` (15%), which matches `split_bps = 8500` written once at `initialize`. Fragile but correct since `split_bps` is immutable.

---

## R5: THE SWAP (`bank/swap.mjs`) AND REVENUE CYCLE (`bank/revenue.mjs`)

### F1 (repeated from R1): The sweep `isSigner` bug is the critical finding here.

Beyond F1, I verified:

**(a) Oracle math:** `oracleFloor` correctly computes `sats = lamports * sol.price / (btc.price * 10)` with exponent adjustment. The BigInt arithmetic avoids overflow. The `satsPerLamport` float is used only for the 100 bps deviation heuristic; the on-chain floor uses the BigInt `minSats`. Rounding is down (floor), which is conservative.

**(b) Pyth verification:** `readPyth` checks owner is the receiver program, verification level is 1 (Full), feed ID matches, and the account is not truncated. The offsets are correct: discriminator(8) + write_authority(32) + verification_level(1) + feed_id(32) + price(8) + conf(8) + expo(4) + publish_time(8) = 101 bytes minimum. The age is judged against the chain's Clock sysvar, not the box clock. Future-dated prices beyond 30s are refused.

**(c) Deviation filter:** The `deviationBps` function is symmetric. The `orcaSpot` and `meteoraSpot` functions return prices that are compared with `satsPerLamport`. The fork test (SW.0) verifies both pools are within 100 bps of the oracle on cloned mainnet state. I was unable to independently verify the unit consistency of `orcaSpot` vs `satsPerLamport` by hand (the Q64.64 arithmetic is complex), but the fork test is the ground truth and it passes 16/16.

**(d) Minimum out:** Both venues use the same `minSats` from `oracleFloor`. For Orca, it's `other_amount_threshold` at data offset 16. For Meteora, it's `min_amount_out` at data offset 16. The judge verifies both.

**(e) The judge:** `judgeSwapInstructions` checks all 7 instructions, the exact sequence, amounts, floors, directions, pool addresses, output accounts, signer positions, and rejects priority fees. The round 25 L1 selftest arms verify 8 tampers on both venues. The judge correctly refuses a zeroed floor, a changed output account, a flipped direction, and a priority fee.

**(f) Account derivation:** Orca tick arrays use `["tick_array", pool, start_string]`. Meteora bin arrays use `["bin_array", pool, index_i64]`. The bitmap extension is passed as the program ID when absent (Anchor's "None" convention). The event authority is `["__event_authority"]`. These match the published IDLs.

**(g) wSOL handling:** The swap wraps exactly `lamportsIn`, syncs, swaps, and closes. If the wSOL ATA already exists with a balance, the `createAtaIdempotent` is a no-op and the transfer adds to the existing balance. The `SyncNative` updates the balance. After the swap, the `closeAccount` returns remaining lamports to the owner. If the swap consumes less than the input (which shouldn't happen with exact-input), the close returns the remainder.

**(h) Failure and retry:** Orca is tried first. Meteora is tried only if Orca's program refuses (on-chain error or failed preflight). An unconfirmed send is never retried (`classifySendFailure` returns `unknown`). The ledger stays open until a cbBTC return is proven. The `cycleIsOpen` predicate correctly requires both a return and a split.

**(i) Extraction bounds:** With a 100 bps deviation gate and 150 bps floor, a sandwich attack is bounded by the pool's liquidity and the oracle's confidence. At the ruled 10 SOL cap, the maximum extraction per cycle is approximately 150 bps of the swap amount (the floor), plus the pool fee (0.16% for Orca). Per month at 4 cycles/day, this is bounded. The Meteora pool (~$0.9M) is thinner than Orca (~$10M), so price impact is larger, but the 100 bps deviation gate limits the pool's usability.

---

## R6: THE GATES (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

No vacuous assertions found. The floors require equality, not just a lower bound:
- `MIN_ASSERTIONS=889` equals the suite count.
- `DET_FLOOR=917` equals the detector selftest count.
- `ALLOC_FLOOR=39`, `POSTER_FLOOR=23`, `MAINNET_FLOOR=33`, `LAUNCH_FLOOR=49`, `EXPIRY_FLOOR=4`, `SWAP_FLOOR=16` all match their respective outputs.

The `floor()` function in `run-tests.sh` checks `[ "$n" -eq "$4" ]`, requiring exact equality. Deleting assertions would cause the floor to fail.

The selftest's `FLOOR = 917` check uses `R.length !== FLOOR`, requiring exact equality.

`scripts/build-mainnet.sh` builds all five programs (including the sweep helper), proves the sweep helper's bytes are identical between mainnet and localnet builds, and asks each keyed program whether it trusts the test key. The sweep helper has no key to ask about, so byte identity is the proof.

`scripts/cron-install.sh` correctly refuses rehearsal trees, preserves `--live` flags on tagged lines, and uses `flock -n` for mutual exclusion. The revenue cron runs hourly (`41 * * * *`), matching `REVENUE_CRON_PERIOD_SECS = 3600`.

---

## Accepted Limits Review

### 1. Is any limit WORSE than stated?

**Item 58 (rescue_nested):** The limit states "no other vault is diluted." This is inaccurate for active nested vaults. If a vault was activated before being nested, the crank continues to pay it (its weight remains in `total_active_weight`), diluting other vaults until someone rescues it. The rescue is permissionless, so the window should be short, but the claim "no other vault is diluted" is false during that window.

### 2. Is anything listed as a limit not actually a limit?

No. All stated limits are real.

### 3. Is any DISCHARGED item not actually discharged?

No. All discharged items are correctly discharged.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

No. Items 22, 38, 50, 52, and 53 are correctly open.

---

## Findings Summary

| # | Sev | File | Finding |
|---|---|---|---|
| F1 | **CRITICAL** | `bank/revenue.mjs` | Sweep instruction marks operator `isSigner: false`; program requires `Signer`. Sweep fails on-chain. |
| F2 | LOW | `bank/crank.mjs` | Crank does not automate `rescue_nested` for nested vaults. |
| F3 | LOW | `bank/layout.mjs` | `RESCUE_SEED` not in `L.SEEDS`; selftest seed count is 11, should be 12. |
| F4 | LOW | SPEC item 58 | "No other vault is diluted" is inaccurate for active nested vaults awaiting rescue. |

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **Run the revenue cycle against a live cluster before launch.** F1 (the `isSigner` bug) can only be caught by executing the sweep on-chain. The dress rehearsal (item 22) must include a real sweep, not just a simulation. The fork test tests the swap but not the sweep instruction construction in `revenue.mjs`.

2. **Add a source-extraction test for the sweep instruction.** The selftest should extract the sweep `TransactionInstruction` from `revenue.mjs` source code and assert that the operator key has `isSigner: true`. This is the same pattern used for the judge tampers (round 25 L1) and the crank's instruction list.

3. **Add `RESCUE_SEED` to the layout and selftest before the freeze.** Once the programs are immutable, a seed rename in the Rust source would be undetectable by the off-chain pipeline. The seed assertion gate (round 24 D6) must cover all seeds, including the rescue seed.

4. **Verify the `orcaSpot` unit consistency with a numeric assertion.** The fork test passes, but a pinned numeric assertion (e.g., "for a pool with sqrtPrice X, orcaSpot returns Y sats per lamport, within Z bps of the oracle") would make the unit relationship explicit and catch a future refactor that changes the formula.

5. **Run the full dress rehearsal (item 22) with the corrected `isSigner` flag.** The rehearsal must include: one full revenue cycle through each pool, one forced post-sweep failure walked through hand recovery, and the crank's live passes. The rehearsal must use the corrected `revenue.mjs`, not the current buggy version.