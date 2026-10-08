I have completed my independent audit of the entire v6 tree. Below is my report, organized by target, then the four questions on the accepted limits, then the launch recommendation.

---

## R0. Round 38 Verdict Verification

I independently verified every confirmed finding in round 38's two verdicts against the current tree.

**C01 (frozen-pool joins not sent): CONFIRMED AND REPAIRED.** The round-37 repair filled `plan.joins` from a frozen pool but only the `if (poolOk && !pool.frozen)` block batched them into `plan.claims`. The round-38 repair adds an `else if (poolOk && pool.frozen && plan.joins.length)` branch that batches the joins into their own claim batches. A join-only `claim` moves no tokens (MINT's `r.pending` branch), so the frozen pool cannot refuse it. Selftest arm `R38 C01` asserts the batch is sent. **Repair verified at all sites.**

**C02 (detectSweepState JSDoc): CONFIRMED AND REPAIRED.** The JSDoc said "within an hour" and "the first pass only takes the baseline"; the code judges from `judgedThrough ?? 0` with a half-cooldown window. The comment now matches the code. **Verified.**

**C03 (SPEC oracle-filter text): CONFIRMED AND REPAIRED.** SPEC limit 10 said "at either market read"; the code filters each read independently, and the first read only decides whether to sweep. The SPEC sentence now reads "at the read the swap is built from." **Verified.**

**C04 (limit 7 reconcile lane): CONFIRMED AND REPAIRED.** Limit 7 named three `flock -n` jobs and claimed the stall was "survivable rather than silent." The daily `--reconcile` lane also takes `flock -n` but has no deadman and its state is written but never read. The limit now names the reconcile lane. **Verified.**

The round-38 repairs are sound. The selftest passes 926/926 at the repair commit.

---

## R1. THE CRANK (`bank/crank.mjs`)

### F1. [LOW] One RPC blip on one vault's Core account aborts the entire reveal run for that pass

**Construct:** `main()` reveal loop, after `revealAttrSource(assets[r.asset])` returns `'skip'` (asset reads as neither live nor burned — a null RPC answer), the code does `break`, stopping the whole reveal run at that vault.

**Cost:** A single transient RPC error on one vault delays every vault behind it in the FIFO by one full pass (one minute). No value is lost; the next pass re-reads.

**Evidence that you are right:** Run the crank against a validator, then temporarily block or rate-limit the RPC's `getAccountInfo` for one Core asset. The log will show `skip reveal #N` and the reveal run stops. The next minute's run reveals it.

**Fix:** `continue` instead of `break`, and push a problem naming the unreadable vault. The program's own `reveal_level` will also fail on that vault, so the problem is information, not a fix.

### F2. [LOW] Stale accumulator used for delivery planning when another distribution lands between plan and send

**Construct:** `planCrank` computes `acc = cfg.acc_scaled + avail * ACC_SCALE / w` for deciding which vaults are owed ≥ 1 sat. If a stranger's distribution (or a host's in-line monthly run) lands between the plan and the crank's `distribute` send, the on-chain `cfg.acc_scaled` has advanced, and the planned `acc` is stale.

**Cost:** A vault that crosses the 1-sat threshold only after the other distribution's credit may be left out of this pass's batches. It is picked up on the next pass. No value is lost; a one-pass delay.

**Evidence:** In a test run, have a stranger send a `distribute` (or a host trigger the in-line month) a few seconds after the crank plans but before it sends its own `distribute`. Compare the crank's planned batches to the landed `claim` transactions.

**Fix:** Re-read `cfg.acc_scaled` immediately before building the claim batches, or accept the one-pass delay as a benign race (the `judgeDistributeRefusal` path already handles a moved epoch).

### F3. [LOW] `distribute` is sent before `activate`, but an activate's in-line monthly run can consume the period — handled correctly

**Construct:** `main()` sends `distribute` before `activate`. If an activate's `monthly_inline` lands first, the crank's `distribute` finds `MonthNotElapsed`. `judgeDistributeRefusal` re-reads the config; if `dist_epoch` moved, it returns `'benign'`. **No defect.** Verified by reading the code path.

---

## R2. THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

### F4. [MEDIUM] `logGaps` grows without bound — a disk-exhaustion attack at one fee per entry

**Construct:** `detectLogGaps` never drops unreviewed entries. A stranger can cause runtime log truncation by padding any transaction that names one of our programs (or the revenue address) as an unused account — the alarm records the signature in `logGaps` and pages `log_coverage_gap`. Each entry is a base58 signature (~88 bytes). The alarm walks at most 8,000 transactions per pass; a sustained flood adds up to 8,000 entries per pass, ~34 MB/day, ~1 GB/month.

**Cost:** Disk exhaustion on the box. The alarm's state file grows until a human reviews the gaps and writes the watermark. No holder value is lost; the alarm is the victim.

**Evidence:** In a test run, have a stranger send 2,000 transactions that name MINT as an unused account with enough instructions to truncate the logs. After one alarm pass, `bank/state.json`'s `logGaps` will hold ~2,000 entries. Repeat daily.

**Fix:** Cap `logGaps` (e.g., 50,000 entries) and page a separate `log_gaps_overflow` when the cap is hit, pruning the oldest unreviewed entries. The reviewed prefix is already trimmed; extend the cap to the unreviewed tail.

### F5. [LOW] `detectBalanceDrops` keys non-cbBTC reserves by `<vault>:<mint>`, but `correlateBurns` matches on `f.asset` (the vault id) — verified: the match works because `asset` is the vault id in both cases. **No defect.**

### F6. [LOW] `detectSweepState`'s `cooldownSeen` defaults to 21600 when `sweep_cooldown_secs` is uninitialized — the safe direction (a narrower window pages more readily). **No defect.**

---

## R3. THE LAYOUTS (`bank/layout.mjs`)

### F7. [INFO] Round 24 D6 (SEEDS assertion) is now armed — verified

The selftest (`bank/selftest.mjs` "D6" arm) scrapes every `*_SEED` constant from the four programs and compares each to `layout.mjs`'s `SEEDS`. All eleven matched when measured; a mistyped seed turns the build red. **No defect.**

---

## R4. THE MONEY ARITHMETIC (`bank/accrual.mjs`)

### F8. [LOW] `pendingScaled` throws "debt above entitlement" only if `debt > weight * acc + carry` — this cannot happen because `acc` only increases and `debt` is set to `weight * acc` at activation/claim time. The throw is a defensive abort that is unreachable in correct operation. **No defect.**

### F9. [INFO] `credit`'s integer division loses a sub-sat remainder per distribution — this remainder stays in the pool (not in `owed_scaled`), so `pool.balance ≥ ceil(owed_scaled / ACC_SCALE)` always holds. This is the stated dust rule, not a defect.

---

## R5. THE SWAP (`bank/swap.mjs`) AND THE REVENUE CYCLE (`bank/revenue.mjs`)

### F10. [LOW] `oracleFloor` returns a floating-point `satsPerLamport` used only for logging and the deviation filter — the actual on-chain floor is the integer `minSats`. No value moves on the float. **No defect in the money path.**

### F11. [LOW] `revenue.mjs` reads `opBefore` (the operator's cbBTC ATA balance) after creating the ATA but before the swap. If a previous cycle's return landed but the row was not saved (crash between return and save), `opBefore` includes the old return and `delta` under-reports. The recovery path (`closesCycle` + the open-cycle guard) resolves this on the next run. No permanent loss.

### F12. [INFO] `judgeSwapInstructions` checks the ComputeBudget instruction anywhere in the transaction, not just first — a priority fee appended after the swap is still caught. **No defect.**

### F13. [LOW] `revenue.mjs` does not verify the operator's wSOL ATA balance after the swap. If the swap fails, the close instruction fails (the wSOL ATA holds a balance), and the whole transaction reverts. The operator's SOL stays in the wSOL ATA, which the operator can close manually. **No defect.**

---

## R6. THE GATES (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

### F14. [INFO] The selftest floor (926) must EQUAL the count, and the selftest enforces this. `scripts/run-tests.sh` enforces the same equality for every sub-suite. **No defect.**

### F15. [LOW] `scripts/cron-install.sh` `ours()` matches `$TAG $1[[:space:]]*\$` — a commented-out line is excluded by the `grep -v '^[[:space:]]*#'` pipe. Verified by reading the installer. **No defect.**

---

## The Four Questions on the Accepted Limits

### 1. Is any limit WORSE than stated?

**Limit 10 (swap throughput):** The limit's "about 34 SOL a day" is the honest reading. The ruled cap is 10 SOL per 6-hour cooldown. With the hourly job, the effective rate is 24/7 × 10 = 240 SOL/day *if* the cooldown were judged on the box clock. But it is judged on the chain Clock, and the round-37 C05 note corrects this to ~34 SOL/day because the hourly run reads the chain a few seconds before the sweep lands and the next run finds the cooldown a few seconds short. **The limit is accurate; no under-statement.**

**Limit 27 (claim between bare burn and retirement):** The limit says a claim naming a dead vault "takes it from everyone else." This is true for a claim sent by a stranger in the window between a bare Core burn and the crank's `retire_burned`. The crank retires bare burns first every pass, so the window is bounded at one hourly pass. **Accurate.**

### 2. Is anything listed as a limit not actually a limit?

**Limit 54 (compute at widest host shapes):** The limit says a mint carrying 4 captures is "REFUSED under the legacy/v0 default 200,000 budget" and that holder pages "must set the compute-unit limit on ANY transaction carrying a crank." Both statements are true. The crank sends each capture as its own transaction, so it is unaffected. **No gap.**

### 3. Is any DISCHARGED item not actually discharged?

**Limit 19 (unlevelled-vault halt):** Discharged by construction because `activate` refuses `NotRevealed`, so an activated vault always has a level, and `claim` pays from the vault's record. **Correctly discharged.**

**Limit 14 (duplicate attribute keys):** Closed on chain — `mint_vault` and `claim_charter_vault` refuse `DuplicateAttribute`. **Correctly discharged.**

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

**Item 50 (holder pages):** The pages are built and staged in `web/`, not published. The holder guide is DRAFT. The launch road (step 11) makes the programs final only after the redeem page exists. **Correctly open, not demoted.**

**Item 22 (dress rehearsal):** Not started. The crank, alarm, and revenue cycle have not run against a live cluster. **Correctly open.**

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what should this project do before launch that AI audit structurally cannot?

AI reasons; it does not execute. The following are concrete, human-acted steps that no number of audit rounds replaces:

1. **Run the mainnet dress rehearsal (item 22) with real money, on real infrastructure.** The crank, alarm, and revenue cycle have never run against a live cluster with ~2,100 vaults, real RPC errors, real rate limits, and real network congestion. The rehearsal must include, at minimum, the five named pass/fail items in item 22 — including one full live revenue cycle through *both* pools (Orca forced to refuse once, so Meteora really runs) and one forced post-sweep failure walked through by hand. AI cannot simulate the chaos of mainnet; only a live run can.

2. **Independently verify the deployed bytes against the source, by a person who is not the builder.** `scripts/build-mainnet.sh` proves the mainnet build rejects the test key and compares sha256 values. A human should independently reproduce the build from the audited commit, dump the deployed program bytes, and verify that the first `len(dist)` bytes hash to the pinned sha256 *and* that every byte after them is zero. This is the last line of defense against a compromised build pipeline.

3. **Exercise the guardian's emergency stop and a vote to restart, live.** The guardian can stop sales and the sweep. This has never been triggered. A human should verify that the stop works, that the alarm pages it at CRITICAL/URGENT, that a governance vote can restart it, and that the stop does not affect redemption, activation, distribution, or claims.

4. **Run a full $CBOB boost lifecycle by hand.** The boost is the newest money-moving code. A human should buy a boost, let it earn through several distributions, expire it, and verify the accounting (the carry, the weight totals, the ring) against `bank/accrual.mjs`'s independent model.

5. **Manually review the holder pages' transaction building against the program's expected instruction shapes.** The redeem page builds transactions that move real Bitcoin. A human should verify that the serialized transaction matches the program's CPI expectations, that the compute-budget limit is set on any transaction carrying a crank, and that the prior transaction creates all required accounts. The byte measurements in SPEC are offline; a human should confirm the landed shape.

6. **Establish and test key-custody procedures.** The swap operator key, the $CBOB release wallet, and the guardian key are all hot keys on the box. A human should establish, document, and *test* a rotation and recovery procedure for each before launch — including what happens if the box is compromised.

7. **Run a "chaos" test on a live rehearsal cluster.** Flood the system with the attacks the alarm is built to detect: a stranger padding transactions to cause log truncation, a stranger sending dust to vaults during redemptions, a pool freeze during a redemption, a crank outage during a busy sale, a stranger front-running a split. Verify that the alarm pages correctly, that no value is lost, and that the ledger reconciles.

The two most important are **#1 (the dress rehearsal)** and **#2 (independent byte verification)**. AI can read code; it cannot run it against a live cluster with real money, and it cannot independently reproduce a build and verify the bytes that will become permanent.