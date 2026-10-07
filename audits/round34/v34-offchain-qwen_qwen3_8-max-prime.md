# Round 34, OFF-CHAIN pass — independent audit

I read the full tree at HEAD `90a05ff` (round-33 repair code `82bb3ef` plus the round-33 record documents). I treated the round-33 verdict as a claim to verify, not a conclusion to inherit, and re-derived each repair from the current source. I did not run the validator, the crank, the revenue job, the alarm, or any transaction; everything below is source-level reasoning against the bundled files, and I say so where a claim needs an executed arm I could not run.

---

## R0 — Round 33's verdict and repairs

**Verdict: the four confirmed round-33 findings are genuinely repaired. I found no surviving defect from them and no regression they introduced.**

**L1 / D1 (sweep-state window + uncertain send).** `bank/detectors.mjs` `detectSweepState` now matches a sweep at chain time `t` against a ledger cycle whose `startedAt` is within `|t − start| ≤ cooldown/2`, and a `pendingSweepSig` explains a sweep only when the caller's direct `getSignatureStatuses` lookup (`landed`) confirms it. I re-derived the skew argument: an honest sweep lands within clock-skew of its cycle start, and skew below `cooldown/2` (≤ 3 h at the ruled 6 h cooldown) is absorbed. A thief's next legal sweep is a full cooldown after the honest one, so it sits outside the half-cooldown window. The `landed` gate closes D1's uncertain-send hole: an honest send that never landed no longer explains a stranger's sweep. The overstated comment is gone and SPEC limit 10 now states the symmetric window, the landed-only rule, and the smallest-ever-cooldown rule. **Holds.**

**D2 (`mint.last_sweep_at` watched).** `WATCHED_KEYS` now includes `'mint.last_sweep_at'` with a comment naming it as the round-32 backstop's only chain input. A reader that dropped it would now be reported by `missingWatchedKeys`. **Holds.**

**D3 (launch count reader).** The `RX.launch` pattern is now `/(\d+) launch\b/g`, which matches the Running-the-tests phrasing "47 launch and 33 live-mainnet". The selftest arm `R33 D3` plants a stale "48 launch" and requires it to fail against `LAUNCH_FLOOR`. **Holds.**

**Gate-5 obligation (pre-existing wSOL balance).** Round 33 required an on-chain or fork arm pinning the round-31 measurement. VALIDATION records R33.G4 as that arm and the on-chain floor moving 861→866, which `run-tests.sh` `MIN_ASSERTIONS=866` now enforces. **I could not read the R33.G4 arm itself** (the suite body `tests/3prog.test.ts` is not in my bundle), so I confirm the floor moved by five and the runner pins it, but I cannot independently confirm the arm exercises a *native* account with a balance rather than only the non-native refusal. I record this as a verification gap, not a defect: the floor equality is checkable, the arm body is not from here.

**Round-33 claim dispositions I re-checked and confirmed as sound:** the `cooldownSeen` smallest-ever/21600-cap logic in `bank/alarm.mjs`, the `landedSigs` confirmation filter (confirmed/finalized and error-free only), and the rollback of `sweepJudgedThrough`/`sweepCooldownSeen` when a page is not delivered. All match the described behaviour.

---

## R1 — The crank (`bank/crank.mjs`)

I found no plan the program would refuse, no plan that pays or joins a dead vault, and no out-of-order reveal.

- **Reveal order** is strictly from `revealed_total` and stops at the first not-ready vault; a capture planned this pass counts as ready. A burned asset reveals with `[]`, a live asset is read and hash-checked, an unreadable asset is skipped (not sent with `[]`). `judgeRevealAttrs` distinguishes send / already-revealed / mismatch correctly, and a tampered list that also carries `level` still reads `mismatch`.
- **Dead vaults:** burned vaults are retired, never joined or paid; an unreadable eligible vault blocks the distribution (correct, since the program refuses `JoinWaitingFirst` while one waits) and is reported.
- **Boost expiry:** due boosts are expired before the distribution (`dist_epoch ≥ boost_end_epoch`) and the boosts a distribution makes due are expired after (`boost_end_epoch == dist_epoch + 1`). This matches MINT's `BoostsExpireFirst` gate.
- **Fee budgeting:** `budgetPlan` keeps the floor in reserve, runs the base plan whenever it is covered, and drops reveals (in mint order) only when the key cannot pay for them. The round-24 L6a/L6b and round-30 L2 repairs are all present and consistent.
- **Value movement:** the crank sends only permissionless MINT instructions (`activate`, `capture_entropy`, `claim`, `distribute`, `expire_boosts`, `reschedule_reveal`, `retire_burned`, `reveal_level`, `split_revenue`) and builds no token or SOL transfer of its own. Its key signs only as fee payer.

**No finding.**

---

## R2 — The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

I looked for a dangerous on-chain state it reads as quiet and a routine state it pages on every pass.

- **Sweep backstop** (`detectSweepState`): verified above. It pages `sweep_unledgered_state` once per unexplained sweep and advances the baseline, which is correct for a one-shot kind; the transaction walk is the continuing control.
- **Log gaps** (`detectLogGaps`): unreviewed gaps are never evicted; the reviewed prefix is trimmed keeping the watermark; >2000 unreviewed escalates to CRITICAL; the finding text is signature-free so a stranger's extra gaps do not send new email. A watermark not among the kept gaps leaves everything unreviewed (loud). **Correct.**
- **Config drift / watched keys / standing risks / production values:** the WATCH list, WATCHED_KEYS, and the production pin list are mutually consistent; `missingWatchedKeys` exempts only genuinely absent programs; `carryConfigBaseline` carries the last non-null value across a one-pass read failure so a change behind a blip is still compared. I found no watched key that nothing populates and no routine state that pages forever.
- **Crank health / posture / silence:** the heartbeat carries failures and problems; three failing passes page `crank_failing`, a repeating problem pages `crank_problem`, an unreadable crontab pages `crank_posture_unreadable` and keeps the armed-since clock. Freeze-covered problems are pruned so a known pool/revenue freeze is not double-reported.
- **Revenue reconciliation** (`detectUnreconciledRevenue`, `detectSplitClaims`, `detectUnledgeredSweeps`, `detectDeferredSweeps`): the chain-anchored split anchor (`closesCycle`), the refused-row detection, the amount-in-instruction read, and the deferred-sweep carry are all consistent and fail loud.

**No finding.**

---

## R3 — The layouts (`bank/layout.mjs`)

The field lists for `SealConfig`, `MintConfig`, `VaultRecord`, `BurnConfig`, `GovConfig` match the Rust structs field-for-field (I compared `MintConfig` and `VaultRecord` against `programs/cbob-vault-mint/src/lib.rs` directly). The selftest parses the Rust and asserts equality both ways, asserts every cross-program `OFF_*` constant equals the computed offset, and asserts the SEEDS against each program's declared seed (the round-24 D6 repair). The `MINT_CONFIG_SPACE` arithmetic evaluates to 1261 (1005 fixed + 256 padding), matching the layout's `fixedLength('MintConfig') = 1005`.

**No finding.**

---

## R4 — The money arithmetic (`bank/accrual.mjs`)

`credit`, `pendingScaled`/`pendingSats`, `reweigh`, `ceilSats`, and `available` match MINT's `credit`, `owed_of` (with `boost_weight` and `carry_scaled`), `reweigh`, and the pool-available computation. The level weights (2/3/4/5/6), `ACC_SCALE` (1e12), and the dust-carry behaviour are consistent between the JS mirror and the Rust. The crank's owed computation for pre-joined, pre-expired, and plain vaults uses the same formulas.

**No finding.**

---

## R5 — The swap and the revenue cycle

**(a) Oracle math.** `oracleFloor` computes `sats = lamports × sol_price × 10^(sol_expo − btc_expo) / (btc_price × 10)` with correct sign handling on the exponent, integer floor on `expectedSats`, and a further floor on `minSats` (×9850/10000, floored). The `satsPerLamport` float is only used for the 100 bps deviation gate, where double precision (~2⁻⁵² relative) is far tighter than the 1% threshold. **Correct.**

**(b) Pyth verification.** `readPyth` pins owner to the receiver, requires verification level 1 (Full), checks the feed id, and reads price/conf/expo/publishTime at the correct offsets (40/41/73/81/89/93). Staleness (180 s), future-date (30 s), and confidence (30 bps) are enforced. The account is a derived PDA under the push oracle; writing a fully-verified update with a chosen price or old publish_time requires compromising Pyth's push-oracle authority, which is accepted limit 10(d). The age is judged against the chain Clock, never the box clock. **Correct within the stated trust.**

**(c) Deviation filter.** `orcaSpot` = (sqrt_price/2⁶⁴)² and `meteoraSpot` = 1/(1+bin_step/10000)^active_id are the right quantities in the right direction (sats per lamport) for the two venues' opposite token orders. The pool readers refuse the wrong mint order and wrong owner. **Correct.**

**(d) Minimum out.** Both venues carry `minSats` (the 150 bps oracle floor) in the swap instruction data at offset 16; the judge verifies it equals the told floor. Same floor the deviation filter assumed. **Correct.**

**(e) The judge.** `judgeSwapInstructions` requires the exact seven-instruction sequence, checks the compute-unit limit and refuses a priority fee, both ATA creations for the operator's own wallet and mint, the exact wrap amount, SyncNative, the venue swap's amount/floor/direction/price-limit and the pool/input/output/authority keys, and the single wSOL close back to the operator. It refuses all eight round-25 tampers on both venues. It does not pin the Orca tick arrays or Meteora bin arrays by value, but those are derived from the pinned pool state by the builder, and the judge's role is to catch our builder's defects, not a tampered builder (accepted limit 10(c)). **Correct for its stated scope.**

**(f) Account derivation.** Orca tick arrays (current + two below for a_to_b) and Meteora bin arrays (current + two above for Y→X) are derived correctly; the bitmap extension is passed as present/absent; `host_fee_in` is None. **Correct.**

**(g) wSOL handling.** Wrap exactly `lamportsIn`, SyncNative, swap, close back to the operator. A pre-existing native wSOL balance survives the exact-input debit and is returned to the operator on close (round-31 measurement, now pinned by R33.G4 per VALIDATION — arm body not in my bundle). **Correct within that verification gap.**

**(h) Failure and retry.** Orca first; Meteora only on a *refusal* (preflight, on-chain failure, or expired-unlanded), never on an unknown send. An unknown send stops the cycle open and loud. `classifySendFailure` asks the chain's status and distinguishes refused/landed/unknown correctly for web3.js 1.98 error shapes. The ledger stays open until a cbBTC return and split are proven. **Correct.**

**(i) Extraction bound.** With the 100 bps deviation gate and 150 bps floor, a swap executes no worse than the floor, which is enforced on-chain by the pool program against the oracle. The residual is the oracle's own staleness/confidence and the pool's liquidity, bounded by the accepted limit 10 analysis. Cycle size (≤10 SOL per 6 h) keeps any per-cycle extraction immaterial relative to the treasury. **Consistent with the stated limits.**

**No finding.**

---

## R6 — The gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

- Every floor equals its count: `MIN_ASSERTIONS=866`, `DET_FLOOR=909`, `ALLOC_FLOOR=39`, `POSTER_FLOOR=23`, `POB_FLOOR=14`, `LAUNCH_FLOOR=47`, `HOST_FLOOR=6`, `MAINNET_FLOOR=33`, `EXPIRY_FLOOR=4`, `SWAP_FLOOR=16`, and `selftest.mjs` `FLOOR=909` equals `DET_FLOOR`. The `floor()` helper enforces equality, not a lower bound.
- The SPEC stated-count gate reads every occurrence of every listed floor and fails on a stale number at any position, on a deleted count, and on a zero-occurrence count. The round-19/round-32/round-33 repairs (second-occurrence, launch phrasing, expiry count) are all present.
- The round-24 section arms are two-way: I checked that the detector selftest proves each detector fires and stays quiet, and that the layout/offset/seed/version arms can fail (planted mutations are asserted to be caught).
- `scripts/build-mainnet.sh` builds all five programs, proves the mainnet build rejects the localnet key and the localnet build accepts it, and proves the sweep helper's mainnet bytes are identical to the tested localnet and `target/deploy` bytes.
- `scripts/cron-install.sh` arms revenue and crank only via an explicit `--live` on the tagged line, refuses a rehearsal tree, and preserves a tagged `--live` without arming from comments or other projects' lines.

**No finding.**

---

## The four questions about the accepted limits

1. **Is any limit WORSE than stated?** I found none. In particular, limit 10's sweep-window description now matches the code (symmetric window, landed-only uncertain send, smallest-ever cooldown), and limit 28's frozen-pool forfeit matches `retire_redeemed`/`retire`.

2. **Is anything listed as a limit not actually a limit, or already closed?** The round-33 sweep-window repairs closed the D1 uncertain-send hole that limit 10's round-32 paragraph only partially described; the SPEC text is now accurate. I found no limit that is silently already closed.

3. **Is any DISCHARGED item not actually discharged?** I re-checked the discharged items that rest on off-chain code (items 12/17 compute, 14 duplicate attributes, 19 unlevelled halt, 30/31/33 stage-3b discharges, 51 boost, 54 compute). Each is either on-chain (verifiable in the bundled Rust) or measured by a named suite arm. I found no discharged item that is not actually discharged.

4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?** Items 22, 38, 50, 52, 53 remain genuinely open in the text and are not treated as done. Item 50's redeem page and item 22's dress rehearsal are still required before launch. I found no quiet demotion.

---

## Findings

**None at CRITICAL, HIGH, or MEDIUM.**

### LOW / verification-gap

**L-1. The R33.G4 arm body is not independently verifiable from this bundle.** The Gate-5 obligation (pin the pre-existing native wSOL balance measurement) is recorded as discharged by R33.G4, and the on-chain floor moved 861→866 consistently. But `tests/3prog.test.ts` is not in my bundle, so I cannot confirm the arm exercises a *native* account holding a balance (the round-31 measurement) rather than only the non-native refusal that SR.3 already pinned. *Evidence that would confirm it:* reading the R33.G4 arm and seeing it pre-fund the operator's wSOL ATA (native, non-zero) and assert the close lands and returns the stranger's lamports. *Fix if it is missing:* add that arm explicitly. This is a verification gap, not a demonstrated defect.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

The AI audit process has done what it can across 34 rounds: it has found and fixed real defects, pinned refusals as assertions, and enforced floors. But there are things AI audit structurally cannot do, and this project should do them before launch:

1. **Execute the dress rehearsal (item 22) on a live cluster, with real money, through both pools and through a forced post-sweep failure recovered by hand.** No amount of source reading substitutes for running the crank, alarm, and revenue cycle against a live RPC with real latency, real rate limits, and real confirmation failures. The rehearsal must include the named pass/fail items, each recorded with transaction signatures.

2. **Run the full revenue cycle through Orca AND through Meteora (with Orca forced to refuse), on mainnet or a faithful fork, before the lock.** The swap is the one trusted hop, and its correctness rests on the real pool programs accepting the hand-built instructions against real pool state. The fork test does this, but it must be re-run at the release commit, not trusted from an earlier commit.

3. **Verify the deployed bytes against `build-mainnet.sh`'s sha256 for all five programs at the release commit, and remove the upgrade authority only after that verification passes.** The sweep helper must be deployed, verified, and locked with the four.

4. **Confirm the R33.G4 arm (and every Gate-5 arm) by reading the suite body, not just the floor count.** A floor count can move for the wrong reason. The arm bodies should be reviewed to confirm they test what they claim.

5. **Build the redeem page (item 50) before publishing the holder guide.** Until `judgeRedemptionCoverage` runs before the holder signs, items 9 and 44 have no preventive control, and a holder redeeming by any other client can destroy undeclared holdings.

6. **Decide the charter opening date and lock deadline (item 38), and run `check-launch-params.mjs` to refusal-free before signing the initialize transactions.** Every initialize value is written once and can never be corrected.

7. **Fund the revenue address above rent, create the pool/revenue/Squads cbBTC accounts (road step 10), and fund the operator's fee float above 0.02 SOL before the first sweep.** These are operational preconditions that no code enforces.

The process is the certification. The remaining risk is concentrated in the live-run gaps (items 22, 50) and the one trusted hop (limit 10), all of which are named and bounded. The code, as read, is consistent with its claims.