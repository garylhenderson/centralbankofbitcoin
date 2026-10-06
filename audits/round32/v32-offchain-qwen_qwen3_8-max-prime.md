# Round 32, OFF-CHAIN pass: independent audit

Audited HEAD `dee953e` (round 31 documentation commit atop `4ae79d6` repair commit). Read every bundled file in full. No live alarm, crank, revenue job, notification, crontab operation, deployment, or mainnet transaction was executed. All analysis is source-read against the bundled tree.

---

## R0 — Round 31 verdict and repairs

I verified each round-31 repair at its actual sites.

**L1 (log-gap griefing).** `detectLogGaps` (`bank/detectors.mjs`) now returns a single `log_coverage_gap` finding with no signatures or counts in its text. `ALARM_KINDS` classifies it as `'level'`. The finding stands every pass while any kept gap is newer than the reviewed-through watermark read from `bank/log-gaps-reviewed`. The selftest arm at the `R31 L1` block exercises: standing across passes, identical notice text, clearing at the watermark, reopening on a newer gap, and a lost watermark leaving all gaps unreviewed. **Repair holds.** A stranger calling a no-op permissionless instruction in a truncated transaction still adds to `logGaps`, but cannot buy a new email or an urgent page. The residual cost (a second genuine gap inside an already-open stream adds to `logGaps` without a new email) is stated in SPEC's reader-coverage boundary.

**L2 (scan flood).** `PER_PROGRAM_READS` defaults to 2000 (`bank/alarm.mjs`). The walk trims `walked.sigs.slice(0, PER_PROGRAM_READS)` and sets `gap` when the walk returned more. The backlog mechanism persists `{ head, before }` and resumes. The selftest's `R31 L2` arm drives a 25,000-transaction flood under a 2,000 budget across 13 passes, verifies the buried transaction is read, and exercises a 1,500 budget that is not a whole number of pages. **Repair holds.** One residual: see finding F1 below.

**D1 (SPEC item 38 overclaim).** SPEC item 38 now reads: *"the guardian, swap operator, sweep cap, cooldown and SOL reserve are not on that list, so for their exact ruled values the pre-signing check below is the only gate; after writing, the alarm judges only bounds on two of them … and pages a later CHANGE to each of the five as `config_drift` (round 31)."* I verified all five are in the `WATCH` array (`mint.guardian`, `mint.swap_operator`, `mint.sol_reserve_lamports`, `mint.max_sweep_lamports`, `mint.sweep_cooldown_secs`), so a post-initialize CHANGE is detected. The initial value is not checked against the ruled value by the alarm. **SPEC correction is accurate.**

**D2 (poster omits SOL).** `releasedFromTx` (`bank/redemption-poster.mjs`) now counts System transfers where `info.source === vaultPda` and attributes them to the native mint. `ASSETS` includes `So11111111111111111111111111111111111111112` with 9 decimals. The selftest arm `R31 D2` verifies SOL swept from the vault wallet is released and named, and SOL sent TO it is not. The pinned R27 reader value moved by 1,000 lamports because the fixture's System transfer is now counted. **Repair holds.**

**Quorum and integrity.** The round-31 verdict's quorum disposition (8/8 substantive, two seats re-run) and the working-tree-change analysis (untracked `scripts/audit32.ts`, not in any TARGET) are consistent with the manifests and the re-render check described. I cannot independently re-run the renderer, but the described sha256 match and the `git status` check are the correct evidence.

---

## R1 — The Crank (`bank/crank.mjs`)

I traced every planning path in `planCrank` and every send path in `main()`.

**Reveal FIFO.** The loop iterates from `revealed_total` upward, breaking on the first record that is missing, already revealed (`level !== 0`), or not ready (no entropy and not captured this pass). A retired-but-unrevealed vault at the FIFO head does not break the loop on `level !== 0` (its level is 0), but breaks on the entropy check if it has no entropy. The capture/reschedule planning earlier in `planCrank` includes retired vaults (no `r.retired` filter), so the crank would capture or reschedule it. `reveal_level` in MINT handles burned vaults by skipping the Core write. The crank's `revealAttrSource` returns `'empty'` for burned assets, sending `[]` as attributes. This is correct.

**Reveal attribute hash check.** `judgeRevealAttrs` correctly distinguishes `'send'` (hash matches), `'revealed'` (hash matches after removing the `level` key), and `'mismatch'`. The `'revealed'` case handles the race where another lane or traffic revealed the vault between plan and read. The `'mismatch'` case is a fault. Both directions are tested in the selftest.

**Join ordering.** `preJoins` are sent before the distribution. The MINT program's `claim` handler runs `monthly_inline` before processing pairs, and `monthly_inline` returns early when `waiting_to_join > 0`. So the in-line monthly run does not fire while vaults are waiting. After the preJoins land, the crank's separate `distribute` runs. If the in-line monthly run fires during a claim batch (because no vaults are waiting), the crank's separate distribute fails `MonthNotElapsed`, which is in `BENIGN`. Correct.

**Boost expiry ordering.** `preExpires` are sent before the distribution (the program refuses `BoostsExpireFirst`). `postExpires` are sent after (boosts this distribution makes due). The `owed` calculation for pre-expired vaults correctly computes the owed at the pre-distribution accumulator with boost, then adds the distribution delta at level weight only. I verified this matches MINT's `expire_boost` + `reweigh` + `credit` sequence.

**Budget.** `budgetPlan` correctly separates the base plan (non-reveal transactions) from reveals. The base plan runs whenever the key covers it (floor 0 for the base check). Reveals are budgeted to keep the `FEE_FLOOR_LAMPORTS` reserve. The `planCostLamports` function correctly counts batches for `preJoins`, `preExpires`, and `postExpires` using ceiling division. I found no undercount.

**Fee payer.** `judgeFeePayer` checks the minimum first (round 24 L6a fix), then the ceiling. Above the ceiling, the crank runs and warns. The warning is rate-limited to once per day per kind (floor vs ceiling) via separate marker files. Correct.

**No value movement.** The selftest arm verifies `crank.mjs` builds no token or SOL transfer and calls no program but MINT. The instruction set is `['activate', 'capture_entropy', 'claim', 'distribute', 'expire_boosts', 'reschedule_reveal', 'retire_burned', 'reveal_level', 'split_revenue']`. All permissionless. The key signs only as fee payer. **Confirmed: the crank cannot move value anywhere the program does not already pin.**

**No finding.** I did not find a plan the program would refuse (beyond the handled races), a plan that pays or joins a dead vault, a reveal sent out of order, or any value movement outside the program's pinned destinations.

---

## R2 — The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

**Production value checks.** The `detectStandingRisks` production list checks 20 values. I verified it does NOT check `mint.guardian`, `mint.swap_operator`, `mint.sol_reserve_lamports`, `mint.max_sweep_lamports`, or `mint.sweep_cooldown_secs` against their ruled values. These five are in the `WATCH` list for drift detection. SPEC item 38 correctly states this boundary. No false quiet on a dangerous state: a wrong initialized value for these five would be caught by `check-launch-params.mjs` before signing, and a subsequent change would be caught by `config_drift`.

**Boost bounds.** `mint.cbob_mint`, `mint.max_boost_weight`, and `mint.max_boost_epochs` are in the `WATCH` list at CRITICAL and in the production `want` list. `boosts_stalled` is detected in `detectDistributionOverdue`. **Confirmed: the alarm treats `cbob_mint` and the boost bounds as fixed forever.**

**Sweep helper watch.** `prog.sweep.upgrade_authority` and `prog.sweep.hash` are in the `WATCH` list at CRITICAL. `detectUpgradeAuthorityAfterLock` includes `'sweep'` in its program list. **Confirmed: the sweep helper is watched for upgrade authority and bytes.**

**No false pages on routine state.** I traced the `detectConfigDrift` first-pass exemption (L11: a program appearing is not drift), the third-party program baseline exemption (I2: `undefined` keys for third-party programs are not drift), and the `carryConfigBaseline` mechanism (L5: a one-pass failed read carries the last non-null value). All correct. A routine sale (minted_total increasing) is not in the `WATCH` list and does not drift. A routine distribution updates `last_distribute_at` and `acc_scaled`, which are in `WATCHED_KEYS` but not in `WATCH`, so they don't drift. Correct.

**No finding.** I did not find a dangerous on-chain state the alarm reads as quiet, or a routine state it pages on every pass.

---

## R3 — The Layouts (`bank/layout.mjs`)

**SEEDS assertion.** Round 24 D6 noted the SEEDS comment claimed an assertion that did not exist. I verified the assertion now exists in `bank/selftest.mjs` at the `D6` block. It scrapes each program's `pub const *_SEED` declarations and compares them to `L.SEEDS`. The selftest verifies all 11 seeds match and that a mistyped seed or an unmapped seed is caught. **The assertion exists and is correct.**

**Struct parity.** The selftest's layout section compares every `STRUCTS` entry against `parseRustStruct` output from the actual Rust source. It also verifies that a field added to the Rust and not mirrored in the layout is caught, and that a type change under the same name is caught. The `parseRustStruct` function throws on any line it cannot parse as `pub name: Type,`, preventing silent drops of private or `pub(crate)` fields.

**Cross-program offsets.** The selftest scrapes every `OFF_*` constant from GOV, BURN, and MINT Rust sources and compares each to `L.offsets()`. The `L2` arm verifies no scraped constant goes un-compared. I verified the `want` array covers all scraped constants.

**Collection plugin hash.** `collectionPluginsHash` skips the base fields (key, update_authority, name, uri, num_minted, current_size) and hashes only the plugin region. The selftest verifies that `num_minted` moving does not change the hash, but a plugin byte change does. Correct.

**No finding.** The layout assertions are real and a struct change could not slip past them.

---

## R4 — The Money Arithmetic (`bank/accrual.mjs`)

I compared every function against MINT's Rust source line by line.

| `accrual.mjs` | MINT `lib.rs` | Match? |
|---|---|---|
| `credit`: `delta = avail * ACC_SCALE / w; acc += delta; owed += delta * w` | `credit`: identical | ✓ |
| `pendingScaled`: `(weight + boost) * acc + carry - debt` | `owed_of`: identical | ✓ |
| `ceilSats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE` | `ceil_sats`: identical | ✓ |
| `available`: `poolBalance - ceilSats(owed)`, floored at 0 | `distribute`: `balance - ceil_sats(owed)`, errors on underflow | ✓ (off-chain floors at 0 instead of erroring; alarm detects insolvency) |
| `reweigh`: `carry = owed; debt = newWeight * acc` | `reweigh`: identical | ✓ |
| `debtAtActivation`: `weight * acc` | `join`: `debt = w * acc` | ✓ |

The `weightOf` function uses `LEVEL_WEIGHTS = [2n, 3n, 4n, 5n, 6n]`, matching MINT's `const LEVEL_WEIGHTS: [u64; 5] = [2, 3, 4, 5, 6]`. The selftest's `L3` arm scrapes the Rust constant and compares. `ACC_SCALE` is `1_000_000_000_000n` in both.

The crank's `planCrank` uses `pendingSats` and `pendingScaled` from `accrual.mjs` for claim planning. The `owed` calculation for pre-expired boosts, joined vaults, and normal vaults all match the program's arithmetic. I verified the pre-expired boost case: `atExpiry` at the pre-distribution accumulator with boost, plus `LEVEL_WEIGHTS[level-1] * (acc - cfg.acc_scaled)` for the distribution delta at level weight. This matches the program's `expire_boost` (which calls `reweigh`, setting `carry = owed` and `debt = levelWeight * acc`) followed by `credit` (which adds `delta` to `acc`).

**Crank boost expiry.** The crank expires every DUE boost before distributing (`preExpires`: `dist_epoch >= boost_end_epoch`) and every boost its own distribution makes due right after (`postExpires`: `boost_end_epoch === dist_epoch + 1`). Both are sent as `expire_boosts` instructions. The program refuses `BoostsExpireFirst` while any boost is due. **Confirmed: the crank handles both directions.**

**No finding.** The off-chain arithmetic matches the program's.

---

## R5 — The Swap (`bank/swap.mjs`) and Revenue Cycle (`bank/revenue.mjs`)

### (a) Oracle math

`oracleFloor`: `sats = lamports * sol.price * 10^(sol.expo - btc.expo) / (btc.price * 10)`. For both feeds at expo −8, the exponent factor is 1, giving `sats = lamports * sol.price / (btc.price * 10)`. This is `lamports * 1e-9 * SOL_USD / BTC_USD * 1e8`, which is correct. The BigInt arithmetic is exact. The `minSats` is `expectedSats * 9850 / 10000` (150 bps tolerance), floored by integer division. Correct.

`satsPerLamport` uses `Number` arithmetic: `Number(sol.price) * 10 ** sol.expo / (Number(btc.price) * 10 ** btc.expo) / 10`. For typical prices (SOL ~$120, BTC ~$85,000, both expo −8), the intermediate values are within `Number.MAX_SAFE_INTEGER`. The relative precision loss is at most ~2⁻⁵³, negligible against the 100 bps deviation tolerance. Not a practical issue.

### (b) Pyth account verification

`readPyth` checks: account exists, owned by `PYTH.receiver`, verification level is 1 (Full), feed ID matches, then reads price/conf/expo/publishTime at the correct offsets (40, 41, 73, 81, 89, 93). The ownership check prevents a non-receiver account from being read. The PDA derivation (`pythAccount`) ensures the read is at the canonical address. A fully-verified update with an old `publishTime` would be caught by the age check in `oracleFloor`. A chosen price would require compromising the Pyth receiver program or the push oracle, covered by the third-party program watch. The clock is the chain's Clock sysvar, read in the same `getMultipleAccountsInfo` call. **Correct.**

### (c) Deviation filter

`orcaSpot`: `(Number(sqrtPrice) / 2^64)^2`. This is the raw price in token-B-per-token-A units. For the wSOL/cbBTC pool, this is cbBTC sats per lamport. Correct.

`meteoraSpot`: `1 / (1 + binStep/10000)^activeId`. The Meteora DLMM pair prices X in Y as `(1 + binStep/10000)^activeId` lamports per sat. The inverse gives sats per lamport. For X = cbBTC, Y = wSOL, selling SOL is Y→X. Correct.

`deviationBps`: `|pool - oracle| / oracle * 10000`. Symmetric. The 100 bps threshold is checked in `market()`. Floating-point error in the spot calculations is negligible against 100 bps. **Correct.**

### (d) Minimum out

Both venues use `minSats` from `oracleFloor`. For Orca, it's `other_amount_threshold` at data offset 16. For Meteora, it's `min_amount_out` at data offset 16. The judge verifies both. The deviation filter and the minimum out both use the same `oracleFloor` result from the same `market()` call. **Same floor, correct units.**

### (e) The judge (`judgeSwapInstructions`)

The judge requires the exact 7-instruction sequence. I verified each check:

- Instruction 0: `SetComputeUnitLimit(400,000)`, no keys, no priority fee (index 3 rejected in the per-instruction loop).
- Instruction 1: ATA `CreateIdempotent` for wSOL, payer = owner, account = ATA(wSOL, owner), owner = owner, mint = wSOL.
- Instruction 2: System transfer of exactly `lamportsIn` from owner to ATA(wSOL, owner).
- Instruction 3: SyncNative of ATA(wSOL, owner).
- Instruction 4: ATA `CreateIdempotent` for cbBTC, same structure.
- Instruction 5: Venue swap with correct program, pool, input/output accounts, amount, floor, and (for Orca) direction and price limit.
- Instruction 6: CloseAccount of ATA(wSOL, owner) to owner, signed by owner.

The judge checks the swap's output account is the operator's own cbBTC ATA (key 5 for both venues). It checks the minimum-out bytes, the direction byte (Orca `a_to_b = 1`), the amount, and that no ComputeBudget instruction sets a priority fee. It checks both ATA creations create accounts for the operator. Token instructions are limited to SyncNative and CloseAccount.

**What a tampered builder could still do:** The judge lives in the same file tree as the builder and the signing key. Whoever can edit `bank/swap.mjs` can edit the judge. This is stated in accepted limit 10. The post-swap delta check in `revenue.mjs` (`delta < guaranteed` throws) provides a second layer. **No new finding beyond the stated limit.**

### (f) Account derivation

Orca tick arrays: `orcaTickArrayStarts` computes the current array and the two below (a_to_b pushes price down). The selftest verifies against mainnet values including a tick on an array boundary. The oracle PDA is derived as `["oracle", pool]`. Vault A/B are read from the pool account. Correct.

Meteora bin arrays: `meteoraBinArrayIndexes` computes the current array and the two above (Y→X pushes active bin up). Negative IDs floor correctly. The bitmap extension is passed as the program ID when absent (Anchor's "None" convention). `host_fee_in` is passed as the program ID (None). The event authority is `["__event_authority"]`. Two token program slots are present (indices 11 and 12). The fork test passes with these derivations. Correct.

### (g) wSOL handling

The transaction wraps exactly `lamportsIn` via System transfer + SyncNative, swaps, and closes the wSOL ATA back to the owner. If the wSOL ATA already exists with a balance, the `CreateIdempotent` is a no-op, the transfer adds `lamportsIn`, SyncNative updates the balance, the swap consumes `lamportsIn`, and the close returns the remainder (including any pre-existing balance) to the owner. The round-31 validator probe (C01) verified that a stranger-created wSOL ATA with dust does not block the close: SPL Token allows closing a native account with any balance, returning it all. **Correct.**

If the wSOL ATA is frozen, the SyncNative or swap would fail. The cycle would be open and loud. This is the frozen-account class (accepted limit 28). If the wSOL ATA has a delegate, the close would fail (Token program refuses to close an account with a delegate). The cycle would be open and loud. **No silent failure.**

### (h) Failure and retry

Orca is tried first. Meteora is tried only if Orca's program refuses (on-chain error or failed preflight). `classifySendFailure` distinguishes `refused` (nothing moved), `landed` (recorded), and `unknown` (cycle stays open). An unconfirmed send is never retried on another venue. A confirmation timeout on a swap that later lands: `classifySendFailure` checks the chain. If the status shows `confirmed`/`finalized` with no error, it's `landed` and recorded. If the status is unavailable, it's `unknown` and the cycle stays open. The open-cycle guard prevents a second cycle. **No double-swap path through the automated code.** The hand-recovery path can double-swap, which is stated in the runbook.

The ledger stays open until `returnedSats > 0` AND (`splitSig` OR `splitByOther`). `cycleIsOpen` is the single predicate. **Confirmed: the ledger cannot read a failed cycle as closed.**

### (i) Adversarial extraction bounds

With a 100 bps deviation gate and a 150 bps floor: a sandwich attack on the swap transaction could extract up to the 150 bps floor slack. At the ruled 10 SOL per sweep, 150 bps of 10 SOL ≈ 0.015 SOL ≈ $1.80 at $120/SOL. At 4 sweeps per day, ≈ $7.20/day. A pool pushed to the edge of the 100 bps gate could give a worse execution price, but the 150 bps floor still bounds the output. A stale-but-accepted oracle (up to 180 s old, confidence ≤ 30 bps) could deviate from the true price by the oracle's own staleness, bounded by the 180 s age and 30 bps confidence. A manipulated Meteora pool (~$0.9M, ~10× thinner than Orca) could be pushed more easily, but the deviation gate would reject it if it's more than 100 bps from the oracle. The 150 bps floor is the binding constraint. **Per cycle: ≤ 150 bps of the swept amount. Per month at 10 SOL/6h: ≤ ~45 SOL × 1.5% ≈ 0.675 SOL ≈ $81.** Not material relative to the revenue being swapped.

**Operator key worst case.** The operator key can sweep up to `max_sweep_lamports` (10 SOL) per `sweep_cooldown_secs` (6 h). It can keep the SOL until the guardian stops the sweep. The alarm detects unledgered sweeps. The bound is 10 SOL × (detection time / 6 h). With the alarm running every 30 minutes and the guardian responding within an hour, the bound is ~2 sweeps = 20 SOL. This matches accepted limit 10.

---

## R6 — The Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

**Floors.** All floors use equality, not lower bounds. `run-tests.sh`'s `floor()` function checks `$n -eq $4`. `MIN_ASSERTIONS` is checked with `-eq`. The selftest's `FLOOR` is checked against `DET_FLOOR` in `run-tests.sh`. The swap fork's `SWAP_FLOOR` is 16, matching the fork's assertion count. The expiry budget's floor is 4. All floors match their stated counts in SPEC.

**Vacuous checks.** I looked for assertions that cannot fail. The detector selftest uses specific inputs and checks specific outputs. The `detectVaultSetChange` test with `null` prevLive returns empty findings (first pass), which is correct. The `detectIndexShortfall` test with `undefined` mintedTotal returns empty, which is correct. I did not find an assertion that passes regardless of the code under test.

**Round-24 section arms.** The selftest's round-24 section has arms for: H1 (per-kind streams, urgent one-shots, recoveries), L4 (crank posture and health), L5 (drift across failed reads), L6 (fee budget), L7 (reserve reads), L8 (three-reserve correlation), L9 (index race), L10/L11 (ledger held to chain), I3 (pool-frozen forfeit), I5 (freeze transitions), D5 (rehearsal mode). Each arm has a both-ways test. I verified the H1 router arms run against the actual router code via a Python subprocess. The `ROUTER_RECOVERY_SRC` is asserted equal to the router's pattern. **Armed in both directions.**

**`build-mainnet.sh`.** Builds all five programs (four with `INIT_AUTHORITY`, sweep without). Deploys both mainnet and localnet builds. Asks each whether it trusts the test key. Mainnet must reject, localnet must accept. The sweep helper's mainnet bytes are compared to the localnet bytes and to `target/deploy/cbob_vault_sweep.so`. The source check verifies all four programs name Gary's key as the non-localnet `INIT_AUTHORITY`. The script refuses a dirty tree. **Proves what it says for all five programs.**

**`cron-install.sh`.** Installs six jobs: watcher, crank, crank-reveal, revenue, reconcile, deadman. All wrapped in `flock -n`. The revenue and crank lines interpolate `$REV_LIVE` and `$CRANK_LIVE`, which are set only from existing tagged, uncommented `--live` lines. The preserve logic is tested in the selftest with the actual shell logic extracted and executed. The rehearsal marker check refuses installation in a rehearsal tree. The deadman watches the alarm state file. **No job is armed that should not be.**

**`audit-coverage.sh`.** The quorum check uses an exact anchored regex on the verdict's first line. The selftest has 8 both-ways cases. The content check compares each file's current blob to its blob at the HEAD of a completed, quorate round. The `--prepared` mode credits the next round's bundle. The strict mode (no `--prepared`) is the freeze gate. **Correct.**

---

## Accepted Limits — the four questions

### 1. Is any limit WORSE than stated?

**Limit 10 (swap operator trust).** The stated bound is "per-sweep cap × cooldown windows until the guardian pulls `emergency_stop_sweep`." I verified the alarm detects unledgered sweeps within one pass (30 min) plus the 15-minute grace. The guardian must then pull the stop. The bound is correctly stated. The residual (the operator wallet must hold nothing but cycle funds, enforced by procedure not code) is stated in the limit. **Not worse than stated.**

**Limit 25 (re-roll).** The stated cost is "one re-roll per full window of total silence." The window is 300 slots (~2 min). The crank's reveal lane runs every minute. Traffic captures ride on four host instructions. The alarm pages `reveal_rescheduled` on every reschedule and `reveal_queue_stalled` if the queue doesn't move between passes. **Not worse than stated.**

**Limit 26 (leader grinding).** The round-24 A1 correction (best-of-4 via skipping, P(Level V) from 5.0% to 18.6%) is correctly stated. The cohort effect (all vaults minted in the same slot share the same hashes) is stated. **Not worse than stated.**

**Limit 40 (Core upgradeable).** Three consequences are stated. I checked for a fourth: `create_vault` calls Core's `CreateV2`. A Core change to `CreateV2` could break mints. This is covered by the general statement "A Core upgrade that changes … the plugin rules reaches every vault." The sweep helper's reliance on Core's `ExecuteV1` authority rule is stated as consequence 3. **Not worse than stated.**

**Limit 46 (PoB hot wallet).** The two attack paths (end the project, capture governance) are stated. The alarm blind spot for per-asset plugins is stated. The sampling blind spot (hook added and removed between passes) is stated. The positive bound (the key cannot transfer or burn individual PoBs) is stated. **Not worse than stated.**

### 2. Is anything listed as a limit not actually a limit?

**Limit 27 (claim between bare burn and retirement).** The crank retires bare burns first, every full pass (hourly). The window is bounded by the crank's frequency. But a manual `claim` during that window would still pay into the dead account. The limit is real. **Still a limit.**

**Limit 35 (10% turnout rule never binds).** With quorum 21% and threshold 51%, the smallest passing vote is 10.71% YES. The 10% floor is indeed never binding at the ruled numbers. **Correctly discharged as a non-binding floor.**

### 3. Is any DISCHARGED item not actually discharged?

**Item 51 ($CBOB boost).** Built in MINT (`boost_vault`, `expire_boosts`, `set_boost_terms`), GOV (`SetBoostTerms`), mirrored in `accrual.mjs`, handled by the crank, watched by the alarm. Suite section BO and init arms 0.1o–0.1v. **Discharged.**

**Item 54 (compute).** Measured figures cited. Suite arms 10.5, 10.6, 10.6a. The 14-vault claim batch is extrapolated, not measured at 14, and SPEC says so. **Discharged with the stated caveat.**

**Items 12/17 (compute units).** Measured on the v5 artifact. The byte wall binds before the compute wall. **Discharged.**

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**Item 22 (nothing against live chain).** Still open. The rehearsal has not run. The named pass/fail items are listed. **Correctly open.**

**Item 38 (initialize values).** `charter_opens_at` and `lock_deadline` are null in `launch/mainnet-init.json`. `check-launch-params.mjs` refuses while any value is OPEN. **Correctly open.**

**Item 50 (holder surfaces).** The redeem page, deposit-address page, and redemption poster sender are not built. `judgeRedemptionCoverage` is a pure function with no page. **Correctly open.**

**Item 52 (pool and Squads accounts).** Launch procedure. **Correctly open.**

**Item 53 (dress rehearsal).** The rehearsal tree script exists and is proven, but the rehearsal itself has not run. The stale proof (round 24 D4) is noted. **Correctly open.**

---

## Findings

### F1 — LOW: Pre-walk alarm findings remain delayed by the transaction walk

**Construct:** `bank/alarm.mjs`, `main()`. The state-derived findings (`detectConfigDrift`, `detectStandingRisks`, `detectBrakeTransitions`, `detectUpgradeAuthorityAfterLock`, `detectMissingComponents`, `detectPoolHealth`, `detectDistributionOverdue`, `detectRedemptionRate`, `detectRevealStall`, `detectUnsweptRoyalties`, `detectCrankPosture`, `detectCrankSilent`) are all computed before the per-program signature walk, but `report()` is called only after the walk completes.

**What an attacker gains:** A flood of transactions naming all four programs (up to 8,000 reads at the 2,000-per-program budget) delays the report of a state-derived CRITICAL (e.g., `pool_insolvent`, `program_not_locked`, `brake_pulled`) by the wall-clock time of the walk. Round 31's L2 repair bounded this (the walk reads at most 8,000 transactions), but did not eliminate the ordering. SPEC states the bound ("16 to 52 minutes" at measured per-read rates). The deadman cron (every 2 hours) is the backstop.

**Evidence:** Read `main()` in `bank/alarm.mjs`: `report(findings, looked, cfg, false, { prevPaged })` appears after the `for (const prog of [SEAL, MINT, BURN, GOV])` walk loop. All state-derived findings are pushed to `findings` before the walk. No intermediate report exists.

**Fix:** Report the state-derived findings on their own labels before starting the walk, or add a wall-clock budget to the walk that triggers an early report. Alternatively, accept and disclose the bounded delay (SPEC already states the bound; this finding notes the ordering was not changed).

### F2 — LOW: The crank's `mintFailureCode` regex for Anchor errors requires the exact format `Program log: AnchorError … Error Code: <Name>.`

**Construct:** `bank/crank.mjs`, `mintFailureCode()`. The regex is `/^Program log: AnchorError\b.*\bError Code: (\w+)\./`.

**What an accident gains:** If a future Anchor version changes the log format (e.g., different spacing, different prefix), the regex would fail to extract the error code. All MINT errors would be treated as failures instead of being checked against `BENIGN`. The crank would page on every race condition (e.g., `AlreadyCaptured`, `AlreadyRevealed`) instead of skipping them. This is loud (pages), not silent. The crank would still function correctly (it would not send incorrect transactions), but the noise would increase.

**Evidence:** The regex is format-dependent. The selftest's `R27 L3` arms exercise the current format via the actual SDK's `SendTransactionError` and a stubbed `getTransaction`. A format change would break the regex without breaking the selftest (which uses the current format).

**Fix:** None required before launch. The format is stable in the pinned Anchor version. If Anchor is upgraded, the regex must be re-verified. The failure mode is loud (false pages), not silent.

### F3 — INFO: The `satsPerLamport` floating-point value in `oracleFloor` is used for the deviation check but not for the on-chain floor

**Construct:** `bank/swap.mjs`, `oracleFloor()`. The `satsPerLamport` field uses `Number` arithmetic. The `expectedSats` and `minSats` fields use exact `BigInt` arithmetic.

**Observation:** The deviation check (`deviationBps(orcaSpot(w), f.satsPerLamport)`) uses the floating-point `satsPerLamport`. The on-chain floor uses the exact `minSats`. The floating-point precision loss is at most ~2⁻⁵³ relative, which is ~10⁻¹⁴ bps. The deviation tolerance is 100 bps. The precision loss is 12 orders of magnitude below the tolerance. Not a practical issue. Noted for completeness.

### F4 — INFO: The revenue cycle's return step sends the full operator ATA balance, not just the cycle's delta

**Construct:** `bank/revenue.mjs`, return step. `const got = after` sends the full balance. `cycle.returnedSats = String(delta)` records only the delta.

**Observation:** If the operator's cbBTC ATA has a pre-existing balance (from a manual transfer or a previous failed cycle's leftover recovered by hand), the full balance is sent to the revenue address. The extra cbBTC is split by `split_revenue` and goes to the pool and the Squads. The ledger records only the delta. The alarm's split checks look for splits at least as large as the cycle's return, so the extra does not cause a false positive. The open-cycle guard prevents automated stacking. A hand-recovery scenario could leave extra cbBTC in the operator's ATA, which the next automated cycle would sweep to the revenue address. This is correct behavior (the extra belongs to the project), but the ledger would not account for it. Not a loss of funds. Noted for the hand-recovery runbook.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **Run the mainnet dress rehearsal (item 22) with adversarial days.** The rehearsal must include: a crank pass where the RPC returns errors for specific vaults mid-batch; a reveal lane pass where the fee payer is one lamport short of the reveal rent; a revenue cycle where Orca refuses and Meteora is the fallback; a forced post-sweep failure walked through hand recovery; and a pass where the alarm's RPC is slow enough to test the walk budget. Each scenario should be scripted, not ad hoc, so it can be re-run after any future change.

2. **Perform a witnessed `initialize` ceremony with read-back.** After `initialize` all four programs, read back every field of every config account and compare against `launch/mainnet-init.json` field by field, in a script that fails on any mismatch. This closes the gap between `check-launch-params.mjs` (which validates the JSON) and the actual on-chain values (item 38, round 24 A6). The read-back should be run by a different process than the one that built the initialize transactions.

3. **Establish an off-box witness for the alarm state and revenue ledger.** The alarm, the revenue ledger, and the crontab all live under one user on one box (accepted limit 10(3)). Before launch, set up a read-only replication of `bank/state.json` and `bank/revenue-ledger.json` to a second box (even a simple `rsync` cron from a different user). The deadman cron should run on the second box, watching the replicated state file. This does not require code changes, only operational setup.

4. **Run the swap fork test at the release commit, not just at the repair commit.** The fork test clones live pool state. Pool state changes between runs. The fork test should be re-run at the exact commit that will be deployed, and the results recorded in the build manifest. The current `sim/swap-fork.sh` is a `run-tests.sh` gate, but the pool state it clones is time-dependent.

5. **Decide the charter opening date and lock deadline before the next audit round.** Items 38 and 53 are blocked on these values. Every round that audits the tree with these values OPEN is a round that cannot fully verify the launch configuration. Setting them (even provisionally, with a documented change procedure) would allow the next round to verify the complete `initialize` parameter set.

6. **Build the redeem page (item 50) before the lock.** The sweep helper is built and tested, but nothing calls it. The redeem page is the only pre-signature check for undeclared holdings and nested vaults. Without it, items 9 and 44 have no preventive control. The page must run `judgeRedemptionCoverage`, create missing destination ATAs in a prior transaction, sweep through the helper, and handle the frozen-pool case (no `claim` when the pool is frozen). This is the single largest remaining gap between the code and the holder guide's promises.