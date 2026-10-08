# Round 41 off-chain audit

I read the tree as delivered. I ran nothing: no selftest, no mutation, no validator. Every "would pass" below is a source-level prediction. Each says what a person would run to check it.

**Result: no CRITICAL, HIGH or MEDIUM defect found.** Two LOW gate defects, one LOW coverage gap, and three INFO items. I did not find a defect in `crank.mjs`, `swap.mjs`, `revenue.mjs` or the detectors that could move holder money wrongly.

## R0: round 40's verdict and repairs

I checked the round-40 repairs against the source.

- **C01 repair.** The M2 arm in `ceremony.test.mjs` now requires `at >= 0` before comparing order. It fails closed if either `indexOf` anchor is missing, so the repair holds. The mArr residue the verdict records is real. The `\]` branch of the C04 `uses` regex is allowed anywhere in the page. The only arms I found that would catch such a leak are the `secretKey` greps and the "persists only the address" arm. They cover the natural breakages but not a constructed one.
- **C02 repair, arithmetic.** Verified by hand. 2 SOL × 12045355552 / (8592910904675 × 10) floors to 280,355. 280,355 × 9,850 / 10,000 is 276,149.675, which floors to 276,149. The pinned vector is correct.
- **C10, C05 and C03 rejections.** All three agree with the source. `setComputeUnitLimit` is byte 2 and `setComputeUnitPrice` is byte 3. The C04 regex is anchored at both ends.

### Finding L1 (LOW): the oracle age bound is not pinned, the same shape as C02

- **What.** C02 repaired the 150 bps tolerance by pinning a literal vector. The age bound `MAX_ORACLE_AGE_SECS = 180` has the shape C02 describes and was not repaired.
  - SPEC states 180 as a number ("at most 180 s old").
  - `selftest.mjs` M1 tests `NOW - SW.MAX_ORACLE_AGE_SECS - 1` and `NOW - SW.MAX_ORACLE_AGE_SECS`. Those are relative to the constant, so they cannot fail when it moves.
  - `sim/swap-fork.mjs` SW.7a uses `S.MAX_ORACLE_AGE_SECS + 1`, also relative.
  - The only absolute arm is L2, which feeds `market()` a price 400 s old and expects refusal. That catches any bound above 399 s. It does not catch 181 to 399.
- **Gain.** A change to, say, 300 s would pass every gate shown. That would let the swap floor rest on a 5-minute-old Pyth price.
- **Evidence if I am right.** Set `MAX_ORACLE_AGE_SECS = 300` in `bank/swap.mjs`. The detector selftest stays at 933/933 and the fork stays 16/16.
- **Fix.** Add `SW.MAX_ORACLE_AGE_SECS === 180` to the C02 arm, and one literal arm at 180 and 181 seconds through `market()`.
- **Not LOW:** `MAX_POOL_DEVIATION_BPS` is pinned by the 99 and 101 bps arms through `market()`, and `MAX_ORACLE_FUTURE_SECS` by T+30 and T+31. The confidence bound is pinned at 30 by a literal. So the age bound is the only unpinned oracle constant I found.

### Finding L2 (LOW): the web test suites are not a gate in `run-tests.sh`

- **What.** `scripts/run-tests.sh` never invokes `web/test/run-all.mjs` (657 offline assertions) or the e2e run (127). `CBOB_SHIP_GATE=1` certifies without them.
- **Why it matters.** Round 40's only MEDIUM, V40-1, was a holder-page defect. The pages are an OPEN AND BLOCKING item and a precondition of the lock (item 50). No floor ties the page tests to the release commit.
- **Evidence if I am right.** `grep -n web scripts/run-tests.sh` returns nothing.
- **Fix.** Run `web/test/run-all.mjs` in the runner behind a floor equal to 657. The e2e needs its own validator, so make its floor a ship-gate checklist item.

### Finding L3 (INFO): the redemption poster wedges on an undrawn vault

- **What.** `redemption-poster.mjs` main loop calls `draftPost(... level: rec.level ...)` for each REDEEMED event. `draftPost` throws for level 0, and nothing catches it. Because the cursor is saved only at the end, the run exits 3 and every later run re-reads the same signature.
- **When it happens.** A vault redeemed before its level is drawn (a stalled queue, limit 25) blocks drafting for every later redemption until the crank draws it. The crank does draw burned assets.
- **Impact.** The poster is hand-run and drafts only. It is a delay, not a loss.
- **Fix.** Catch the throw and queue a rejected hand-draft entry for that signature, as the truncated-log path does, then continue.

### Finding I1 (INFO): the SPEC control-table crank row is stale

- **What.** The row says the crank's key "is refused below what the pass's plan costs". `budgetPlan`, from rounds 24 L6b and 30 L2, runs the base plan whenever the key covers it and drops only the reveals it cannot pay for.
- **Impact.** Documentation only. It misstates nothing about holder money.

### Finding I2 (INFO): the alarm pages predictably before launch

- **Today.** The alarm defaults to production. The five ids hold an upgradeable placeholder, and `lock_deadline` and `charter_opens_at` are unset. So `detectUpgradeAuthorityAfterLock` returns `lock_deadline_unset` at CRITICAL on every pass. This is by design, but it is routine noise.
- **At step 9.** The upgrade from the placeholder changes `prog.*.hash` for all five programs. That is one urgent CRITICAL `config_drift` each.
- **The gap.** SPEC says baselines are "re-taken", but I found no mechanism that does so selectively. Deleting `state.json` needs `--first-run` and discards the cursors.
- **Fix.** Write the re-baseline procedure down, or add a tool that clears only the `prog.*` keys.

## R1: the crank

- **Plans the program would refuse.** I found none.
  - Joins precede the distribution.
  - Expiries run before and after it.
  - A burned asset is retired rather than joined or paid, and only a positively live asset is paid.
  - A frozen pool still ticks and joins, and `claims` includes the join-only batches.
- **Order of the claim math.** The owed math matches `owed_of` on all three branches (plain, joined-now, pre-expired). I recomputed the preExpired branch: carry plus level weight times the accumulator delta.
- **Reveals.** They are not sent out of order. A rescheduled vault is excluded from the reveal run, and the loop breaks at the first vault that is not ready.
- **Value movement.** The crank moves value nowhere the program has not already pinned. `crank.mjs` builds no transfers, and its only program is MINT.
- **Residue.** When a distribution lands and times out, `lastFailure` is `''`, so `judgeDistributeRefusal` returns `'fail'`. The result is a false page, which is the loud direction. This is the round-40 Opus R1-2 INFO and I agree with the verdict's disposition.

## R2: the alarm

- **Watch list.** I checked the fixed-forever values, the pending guardian and operator, the PoB collection plugins and update authority, `prog.sweep`, and the third-party programs against `WATCH` and `readConfigs`. Nothing is missing.
- **Production list.** The production list matches Gary's values (21% / 51% / 3 days, 7-day notice, tighten bounds, 30-day month, one-hour window). It deliberately omits sweep cap, cooldown and reserve, per limit 38.
- **Dangerous state read as quiet.** None found. A frozen pool, an insolvent pool, an overdue distribution and the redemption window nearly full all page.
- **Pages every pass.** Only the pre-launch case in I2.
- **Hardcoded Squads.** `detectNestedVaults` hardcodes `CBOBTC_SQUADS`. Production pins `mint.bank_treasury` to the same value, so it is consistent. A rehearsal with another treasury would page falsely (verdict C13, already noted).

## R3: layouts

I recomputed `MintConfig` (1005 bytes) and `VaultRecord` (211 bytes) from the Rust struct text provided. They match `layout.mjs` field for field. The Rust-struct parser throws on any line it cannot read, so a struct change cannot slip past it. The seed assertion exists now (D6, 11 of 11). `layout.mjs` SEEDS lacks `rescue`. That is harmless, because no `bank/` code derives it and the web `ids` test covers it.

## R4: accrual

`credit`, `claim`, `reweigh`, `ceilSats` and `owedOf` mirror MINT line for line. I found no divergence. `retire` returns the pending share exactly as the crank's `retiringOwed` computes. The `boosts_stalled` page and the boost bounds as fixed-forever are present.

## R5: the swap and revenue cycle

- **(a) Oracle math.** The exponent handling is correct for every sign. Rounding is conservative, flooring both `expectedSats` and `minSats`. `satsPerLamport` is the ratio of the two USD prices divided by 10 (the lamport/sat unit scale), which checks out against the numbers.
- **(b) Pyth.** The offsets are right: 40 for the level, 41 for the feed id, 73 price, 81 confidence, 89 exponent, 93 publish time. A Partial update is refused. The receiver owns the derived account and the push program accepts only newer verified updates. The attacker's room is the choice of a real price within 180 s, not a forged one. The clock is the Clock sysvar read through the one trusted RPC.
- **(c) Deviation filter.** The Orca spot is (√P/2⁶⁴)² in raw sats per lamport. The Meteora spot is the inverse of (1+step)^id. I sanity-checked Meteora: 8,592,910,904,675 against 12,045,355,552 gives about 7,134 lamports per sat, so ln(7134)/ln(1.0015) is about 5,920, which equals the `active_id` in the fixture. Floating-point error is about 1e-16 against a 1e-2 gate.
- **(d) Minimum out.** The same `minSats` rides in Orca's `other_amount_threshold` (data offset 16) and Meteora's `min_amount_out`. Both are in sats, as each program expects.
- **(e) The judge.** It pins the exact seven-instruction sequence, signer slots, the output account, amount, floor, direction and price limit.
  - **Unchecked:** the pool-side accounts (vaults, tick arrays, oracle, bin arrays, mints, `host_fee_in`) and extra trailing keys. The pool programs validate the pool-side accounts against the pinned pool.
  - **`host_fee_in`** is the only slot a tampered builder could aim at a stranger. It is paid from the protocol fee, not the input, and the output floor still binds. This is INFO.
- **(f) Derivation.** The tick-array start uses `Math.floor`, so negative ticks are right, and the a_to_b order is current, then two below. The bin arrays are the active one then two above, floored for negative ids. The event authority and the bitmap "None" convention are correct.
- **(g) wSOL.** A pre-existing balance or a stranger's sync is harmless, because the whole account is closed back to the operator. Frozen is impossible for wSOL.
- **(h) Retry.** Meteora runs only after a refusal. A timeout with no signature leaves the cycle open with no candidate signature, so hand recovery must find the transaction from the operator's history. This is already limit 10's hand-recovery path.
- **(i) Extraction bound.** The most one cycle gives up to a sandwich or a pool pushed to the gate is the 150 bps floor against the oracle, about 0.15 SOL on a 10 SOL cycle. At the 34 SOL per day ceiling that is at most about 15 SOL a month if every cycle is hit, before the 30 bps confidence slack. An attacker can steer to Meteora by pushing Orca past the gate, but the floor is identical, so the bound does not change. That is not material.
- **Operator key.** The worst case is unchanged: cap × cooldown windows until the guardian stops it, plus the 0.02 SOL float.

## R6: gates

- Floors match across the shown files: 933, 39, 24, 14, 49, 6, 33, 4, 16, 896, and the web floors total 657 (41+47+16+169+49+113+7+107+25+83).
- The only remaining `indexOf(...) < indexOf(...)` arm that lacks a presence check is the M3 heartbeat arm's `if (!LIVE) {`. It is covered by the separate regex beside it. That is fine.
- `build-mainnet.sh` proves the sweep helper byte-identical to the localnet build and to `target/deploy`.
- `cron-install.sh` arms nothing it should not.
- See L2 for the missing web gate.

## The four questions on the accepted limits

1. **Any limit worse than stated?** No. Limit 10's 34 SOL a day matches the hourly-cron arithmetic.
2. **Any listed limit not actually a limit?** No.
3. **Any DISCHARGED item not discharged?** No. Item 2's rewrite is accurate.
4. **Any OPEN AND BLOCKING item treated as accepted?** No. Item 22.5 (one DAS read of a collection holding a burned asset) is still open, and the answer feeds an arm pinned at `selftest.mjs` 1269-1271. A "no `burnt`" result therefore forces a `bank/` commit and resets the freeze, so it should be settled before the freeze.

## What to do before launch that AI audit cannot do

1. **Run the real thing under real conditions.** Do the mainnet dress rehearsal of item 22: one live Orca cycle, one live Meteora cycle, one forced post-sweep failure walked through hand recovery, and the crank against about 2,100 vaults. Measure capture latency and swap inclusion in a high-priority-fee hour. No reading of source can show that.
2. **Check what is actually on the chain.** Re-dump all five programs at step 10 and again at 11, and compare each program's first bytes to `dist/SHA256SUMS` with a zero tail. Build `dist/` independently on a second machine. Have a person read the four signed `initialize` transactions against `launch/mainnet-init.json`. The checker validates the file, not the signed transaction (item 38, A6).
3. **Test with the hardware and wallets holders will use.** Run the redeem, claim and buy pages with a real Phantom and a real Ledger. Check that the wallet does not alter the transaction (the `signExact` guard), that a redemption with a stray token behaves as the boxes say, and that the page's published `/rpc` proxy behaves under real browser CORS.
4. **Run the alert drill.** Cause each page kind on purpose and confirm a person receives it, the recovery arrives, and the deadman fires. The router's behaviour was measured only in a throwaway state directory.
5. **Move the keys.** The swap operator, the crank key, the $CBOB release wallet (all 2.1B tokens) and the deploy authority share one box with the alarm and its ledger. Move at least the release wallet and the deploy authority off the box before launch, and keep the deploy authority until step 11, because losing it strands the five ids.
6. **Keep the step-11 irreversibility human.** A person must confirm the redeem page is live and the Orca, Meteora and Pyth upgrade keys are as recorded, then pull the trigger.