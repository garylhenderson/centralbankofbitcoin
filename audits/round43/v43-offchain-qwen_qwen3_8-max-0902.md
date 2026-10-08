# Round 43 Independent Security Audit — Off-Chain Pipeline, Sweep Helper, and Web Tests

## R0. Round 42 Verdict Verification

### C01 (LOW): Alarm reserve baseline shrinks with untrusted DAS list — REPAIR VERIFIED

**Confirmed finding.** Round 42 correctly identified that after a `vault_index_shrank` pass, `alarm.mjs` built the reserve-balance read list (`legs`) from only the current (short) vault list, so any vault omitted by the shrunken index lost its baseline and a subsequent fall in its reserve would never page.

**Repair verified at the single site of its shape.** The fix in `bank/alarm.mjs`:

```javascript
const burntSet = new Set(burnt)
const judged = setChange.trustCurrent ? vaults : [...new Set([...vaults, ...(prev?.vaults || []).filter(v => !burntSet.has(v))])]
```

When `trustCurrent` is false (index shrank), `judged` is the union of the current list and all previously known non-burnt vaults. I traced every downstream use of `judged`:

1. `pdaOf` is populated for all vaults in `judged` (line: `for (const v of judged) if (!pdaOf[v]) pdaOf[v] = ...`).
2. `legs` is built from `judged`, so all previously known vaults' reserves are read.
3. On RPC failure for a chunk, previous balances are carried forward (`balances[l.key] = prev.balances[l.key]`).
4. On individual account read failure, `judgeReserveRead` carries forward the previous balance.
5. `next.balances = balances` stores the full baseline.

There is no other site in `alarm.mjs` where a vault list is built from `vaults` alone when `trustCurrent` is false. The `vaults` field itself is correctly preserved: `vaults: setChange.trustCurrent ? vaults : (prev?.vaults || vaults)`.

**Regression check:** The two selftest arms (`R42 C01`) extract the real balance block and run three passes (full → shrunk → full-with-fall), confirming the fall in an omitted vault is paged. Both arms are present and exercise the exact code path.

**Evidence if I were wrong:** If the repair were incomplete, a three-pass simulation (full list, shrunk list, full list with a reserve drop in a vault absent from the shrunk list) would show `reserve_fell` missing for the omitted vault. The selftest arms perform exactly this simulation and pass.

### V42-1 and V42-2 (INFO, web/) — Cannot independently verify

`web/deploy/ceremony-local.mjs` and `web/src/lib/ceremony-reads.mjs` are not in this bundle. The VALIDATION record describes the fixes and their tests. I cannot independently confirm or deny these repairs from the bundled files. This is a measurement limit, not a finding.

### Round 42 rejected claims — Not re-filed

I did not re-file any claim that Round 42 disproved. I verified the key measurements independently where the code was available (oracle math, Pyth offsets, tick array derivation, bin array derivation, layout offsets, accrual arithmetic).

---

## R1. The Crank (`bank/crank.mjs`)

### Verified correct

**Reveal ordering.** The reveal loop iterates from `revealed_total` upward, stopping at the first vault without entropy. This matches the program's `RevealOutOfOrder` enforcement. A vault burned before reveal still takes its draw (the program increments `revealed_total` for burned vaults), so no gap can form.

**Join-before-distribute.** `preJoins` are sent before `distribute`, matching the program's `JoinWaitingFirst` gate. The join eligibility check (`request_epoch < dist_epoch`) matches the program's `ActivationPending` logic.

**Boost expiry ordering.** `preExpires` are sent before `distribute`, matching `BoostsExpireFirst`. `postExpires` are sent after, catching boosts that the current distribution makes due. The owed computation for `preExpired` vaults correctly computes the carry at the current accumulator plus level-weight earnings from the distribution.

**Weight adjustment.** `w = total_active_weight + preJoinWeight - retiringWeight - expiringWeight` correctly adjusts for vaults joining, retiring, and boosts expiring in this pass.

**Fee budgeting.** `budgetPlan` runs the base plan whenever the key covers it, then adds reveals in mint order as the balance allows, keeping the floor in reserve. The `judgeFeePayer` minimum-first fix (Round 24 L6a) is present.

**Race handling.** `judgeDistributeRefusal` re-reads the config on refusal and treats race codes as benign only if the epoch moved. `PoolShort` is never benign. The `BENIGN` regex covers all expected race codes.

### No faults found

I checked for: plans the program would refuse, plans that pay or join a dead vault, reveals sent out of order, and value movement outside the program's pinning. All are correctly handled.

---

## R2. The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

### Verified correct

**Config drift.** The `WATCH` list covers all fixed-forever values, voted values, guardian stops, program bytes, third-party programs, and collection plugins. The `carryConfigBaseline` function preserves the last non-null value across failed reads, preventing a one-pass blip from hiding a change.

**Sweep state detection.** `detectSweepState` uses a symmetric window of `cooldown/2` around the cycle start time. The on-chain cooldown prevents an attacker from sweeping within `cooldown` of the last sweep, so the `cooldown/2` window cannot be exploited. The `landed` set requires a direct `getSignatureStatuses` lookup, not the floodable walk.

**Revenue reconciliation.** `detectUnreconciledRevenue` checks for sweeps with no return, returns well below quote, and cycles that returned but were never split. The `cycleIsOpen` predicate is shared across all readers. The `closesCycle` function uses a sorted, deduplicated split list with binary search.

**Log gap handling.** Truncated logs are flagged, not refused. The gap is a level condition cleared only by a human watermark. Unreviewed gaps are never evicted.

### No faults found

I checked for: dangerous on-chain states read as quiet, routine states paged every pass, and baseline asymmetries. The C01 repair addresses the one baseline asymmetry that existed.

---

## R3. The Layouts (`bank/layout.mjs`)

### Verified correct

**Field lists match Rust.** The selftest parses each `pub struct` from the Rust source and compares field names and types. I manually verified the MintConfig field list against the Rust struct: all 64 fields match in name, type, and order.

**Cross-program offsets.** I computed the MintConfig offsets manually:
- `governance` at 41, `minted_total` at 141, `bare_burns_retired` at 454, `charter_closes_at` at 442, `sol_reserve_lamports` at 257, `max_sweep_lamports` at 266, `sweep_cooldown_secs` at 274. These match the GOV and BURN `OFF_*` constants asserted in the selftest.

**Account spaces.** The selftest scrapes `MINT_CONFIG_SPACE` and `VAULT_RECORD_SPACE` from the Rust, evaluates them, subtracts padding, and checks they equal `fixedLength`. I verified: MintConfig fields sum to 997 bytes + 8 discriminator = 1005, matching the expected value.

**SEEDS assertion.** Round 24 D6 noted the SEEDS comment claimed an assertion that didn't exist. The selftest now scrapes each seed from the program source and compares. All 11 seeds are checked.

### No faults found

---

## R4. The Money Arithmetic (`bank/accrual.mjs`)

### Verified correct

I compared each function against the MINT program:

- `pendingScaled`: `(weight + boost) * acc + carry - debt` matches `owed_of`.
- `credit`: `delta = avail * ACC_SCALE / w` matches the program's `credit`.
- `ceilSats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE` matches the program's ceiling.
- `available`: `balance - ceil(owed)` matches the program's `avail` computation.
- `reweigh`: moves owed to carry, restarts debt at new weight, matches the program's `reweigh`.
- `debtAtActivation`: `weight * acc` matches the program's join debt.

The selftest verifies: Level V = 3× Level I, dust carries, late activation gets nothing, frozen vault stays owed, boost carry is exact.

### No faults found

---

## R5. The Swap and Revenue Cycle

### Oracle math verified

`oracleFloor` computes `sats = lamports * sol.price * 10^(sol.expo - btc.expo) / (btc.price * 10)`. With both exponents at -8, this simplifies to `lamports * sol.price / (btc.price * 10)`. I verified with the test values: 2 SOL at $120.45355552 / $85929.10904675 = 280,355 sats expected, 276,149 floor (150 bps under). Both match.

The exponent handling is correct: `e = sol.expo - btc.expo`; if `e >= 0`, multiply numerator by `10^e`; otherwise multiply denominator by `10^(-e)`. The Round 42 C06 exponent bound (`PYTH_EXPO_MIN = -18`, `PYTH_EXPO_MAX = 0`) prevents pathological exponent values.

### Pyth account verification verified

The `readPyth` offsets are correct for PriceUpdateV2:
- Discriminator: 0-7
- write_authority: 8-39
- verification_level: 40 (must be 1 = Full)
- feed_id: 41-72
- price: 73-80 (i64)
- conf: 81-88 (u64)
- exponent: 89-92 (i32)
- publish_time: 93-100 (i64)

The minimum length check of 101 bytes covers all fields read. The ownership check (`acc.owner.equals(PYTH.receiver)`) and feed-id check are present. The account is derived from the push oracle program, so only the Pyth receiver can write to it.

### Deviation filter verified

`orcaSpot` computes `(sqrtPrice / 2^64)^2`, which gives sats per lamport for the wSOL/cbBTC pool. `meteoraSpot` computes `1 / (1 + binStep/10000)^activeId`, which gives sats per lamport for the cbBTC/wSOL pool. Both are compared to `satsPerLamport` via `deviationBps`. The 100 bps threshold is applied symmetrically.

### Minimum out verified

The `minSats` from `oracleFloor` is passed as `other_amount_threshold` (Orca) or `min_amount_out` (Meteora). Both are at byte offset 16 in the swap instruction data. The `judgeSwapInstructions` function verifies this offset matches `minSats`.

### Judge verified

`judgeSwapInstructions` checks:
- Exactly 7 instructions in the correct order (destructured by position).
- Only allowed programs.
- Only the owner as signer.
- No priority fee.
- Only SyncNative and CloseAccount for Token program.
- Correct ATA creates, System transfer amount, swap amount, swap floor, swap direction, and close.

I verified that reordering instructions would cause the destructuring to assign them to wrong variables, failing the checks.

### Revenue cycle verified

The sweep amount is capped by `maxPerCycle` and `chainCap`, with a minimum of `MIN_SWEEP_LAMPORTS`. The re-quote drift check (200 bps) prevents sweeping into a moved market. The return step transfers the full operator ATA balance but records only the delta. The split step handles front-running via the `isProvablyEmpty` check.

### No faults found

---

## R6. The Gates

### Selftest floors verified

`bank/selftest.mjs` uses `FLOOR = 945` and requires `R.length === FLOOR` (equality, not >=). Deleting an assertion would reduce the count below the floor, failing the test.

`scripts/run-tests.sh` uses `MIN_ASSERTIONS = 909` and requires equality. The `floor` helper function also requires equality.

`sim/swap-fork.sh` uses `SWAP_FLOOR = 16` and requires equality.

### No vacuous checks found

I checked for assertions that cannot fail, floors satisfiable by deleting work, and checks that pass vacuously on empty input. All floors use equality checks. The selftest's both-ways testing (fire and quiet cases) prevents vacuous detectors.

### build-mainnet.sh verified

The script builds all five programs, deploys both mainnet and localnet builds to a validator, and asks each whether it trusts the test key. The sweep helper's bytes are compared for identity between mainnet and localnet builds. The script refuses a dirty tree.

### cron-install.sh verified

The installer uses `flock -n` for all money jobs. The selftest verifies the cron template carries the OS lease. The rehearsal marker check prevents installation in a rehearsal tree.

---

## Accepted Limits — Four Questions

### 1. Is any limit WORSE than stated?

**No.** I checked each accepted limit against the code:

- Limit 10 (swap operator): The on-chain cap and cooldown correctly bound the exposure. The guardian can stop instantly.
- Limit 25 (re-roll): The capture window and permissionless capture correctly bound the re-roll opportunity.
- Limit 26 (leader grinding): The three-group entropy correctly limits influence to the last group's leader.
- Limit 28 (Coinbase freeze): The frozen-pool forfeit path is correctly implemented.
- Limit 32 (rate limit): The rolling window with 64-slot ring correctly bounds redemptions.
- Limit 41 (leaked custodial key): The rate limit correctly bounds redemptions but not transfers, as stated.

### 2. Is anything listed as a limit not actually a limit?

**No.** All discharged items (12/17, 14, 19, 30, 31, 33, 51, 54) are correctly discharged by measurement or construction. The v5 items discharged with the Bank (1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24) are correctly gone with the Bank.

### 3. Is any DISCHARGED item not actually discharged?

**No.** Item 51 ($CBOB boost) is built and tested. Item 54 (compute) is measured. Items 12/17 (compute units) are measured. All discharged items have corresponding suite arms or measurements.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**No.** Items 22, 38, 50, 52, 53 are all correctly tracked as open. `launch/mainnet-init.json` still has three OPEN values (charter_opens_at, lock_deadline, vault_collection). The check-launch-params script refuses to pass while any value is OPEN.

---

## Web/Test Verification

### Tests are non-vacuous

I checked each test file for the ability to fail when the named property is broken:

**plan.test.mjs:** Tests compare instruction bytes, program IDs, account keys, and message serialization against expected values. A broken plan would produce different bytes/IDs/keys, failing the comparison. The `diffIx` helper returns a list of differences, so an empty list means exact match.

**ceremony.test.mjs:** Tests compare instructions against the suite's builders, check launch params refusal, and verify the collection creation. The `diffIx` comparisons and `judgeLaunch` refusal checks would fail if the code were broken.

**bundle.test.mjs:** Tests compare the bundled `judgeLaunch` against the node version, check the bundle builds, and verify static HTML properties. A broken bundle would produce different results or fail to build.

**proxy.test.mjs:** Tests check the proxy's method allowlist against web/src calls, verify malicious filters are refused, and check rate limiting. A broken proxy would accept disallowed methods or filters, failing the tests.

**decode.test.mjs:** Tests compare the page's Core/SPL readers against official deserializers. A broken reader would produce different results, failing the comparison.

**tx.test.mjs:** Tests check the signing guard (honest wallet accepted, instruction-adding wallet refused, forged signature refused) and error name resolution. A broken guard would accept bad wallets or refuse good ones.

**meta.test.mjs:** Tests check the metadata generator's output, including the fail-closed behavior for unreadable vaults. A broken generator would produce wrong output or fail to preserve previous files.

### E2E floor verified

`web/test/e2e-localnet.sh` uses `E2E_FLOOR = 132` and requires the exact count. The e2e test file itself is not in the bundle, but the shell script's floor check ensures the count matches.

---

## Findings

**No CRITICAL, HIGH, or MEDIUM findings.**

After independent verification of the Round 42 repairs, all six target areas (crank, alarm, layouts, arithmetic, swap/revenue, gates), the accepted limits, and the web tests, I found no new defects that survive measurement.

The single LOW finding from Round 42 (C01) is correctly repaired and tested. The repair is present at the only site of its shape, and the selftest arms verify both the shrunk-pass and fall-during-shrunk-pass scenarios.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

The following are things that AI audit structurally cannot do, and that should be done before launch:

1. **Run the mainnet dress rehearsal (item 22) with a human at the terminal.** The rehearsal exercises the crank, alarm, and revenue cycle against a live cluster with real RPC behavior, rate limits, and transient errors. AI can verify the code logic but cannot observe whether the RPC endpoint behaves under load, whether the Helius rate limits are sufficient for the alarm's 30-minute pass with 2,100 vaults, or whether the crank's every-minute reveal lane keeps up during a mint burst. The named pass/fail items in item 22 (including one full revenue cycle through each pool and one forced post-sweep failure) must be executed by a human who can observe the terminal output and intervene.

2. **Physically verify the operator key custody.** The swap operator key (`bank/keys/swap-operator.json`) and the $CBOB release wallet key (`bank/keys/cbob-release.json`) are hot keys on the server. AI can verify the file permissions (600) and the code that reads them, but cannot verify whether the server itself is compromised, whether the keys are in memory dumps, or whether the backup system is secure. A human should verify the server's security posture, consider whether the keys should be on a dedicated machine, and verify the backup encryption.

3. **Verify the Pyth price feeds are the correct ones.** The feed IDs for SOL/USD and BTC/USD are hardcoded. AI can verify the code reads them correctly, but a human should verify on Pyth's website that these feed IDs correspond to the intended price feeds, and that the sponsored accounts are the correct ones. A wrong feed ID would cause the swap to use the wrong price.

4. **Verify the Orca and Meteora pool addresses are correct.** The pool addresses are hardcoded. AI can verify the code reads them correctly, but a human should verify on the DEX interfaces that these are the intended pools with the expected liquidity. A wrong pool address would cause the swap to trade in the wrong pool.

5. **Verify the CBOBTC Squads address is the correct multisig.** The `bank_treasury` address receives the 15% and rescued vaults. AI can verify the code uses it correctly, but a human should verify on-chain that this address is the intended Squads multisig with the expected signers.

6. **Test the redeem page with a real wallet.** The redeem page is built but not published. AI can verify the code logic, but a human should test it with a real wallet (Phantom, Ledger) to verify the transaction signing flow, the compute budget, and the packet size. The page must handle wallet-specific quirks (e.g., Phantom's compute budget handling, Ledger's transaction size limits).

7. **Verify the charter window dates with Gary.** The charter opening date is still OPEN in `launch/mainnet-init.json`. This is a human decision that cannot be made by AI. The lock deadline (24 hours before charter open) must also be set.

8. **Run the launch ceremony with Gary.** The ceremony creates the vault collection and initializes all four programs. This requires Gary's wallet signature and cannot be done by AI. The ceremony's step-by-step flow should be rehearsed before the actual launch.

9. **Establish a human response procedure for alarm pages.** The alarm pages on many conditions (frozen pool, unledgered sweep, config drift, etc.). AI can verify the alarm logic, but a human must be available to respond to pages, investigate the root cause, and take action (e.g., pull the guardian stop, investigate a sweep, verify a config change). The response procedure should be documented and rehearsed.

10. **Verify the alert router is configured correctly.** The alarm sends notifications via `/opt/scripts/notify-gary-sms.sh`. AI can verify the alarm code calls it correctly, but a human should verify the router is configured to deliver notifications to the right recipients, that the SMS/email delivery works, and that the suppression/recovery logic behaves as expected.