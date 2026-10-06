# Independent Security Audit — Off-Chain Pipeline (v6, round 31)

I read the tree whole, then tested every claim against the code. I checked each prior repair at its sites, re-derived the swap math independently, walked the crank's plan/send ordering, traced the revenue ledger's every close path, and looked for states the alarm reads as quiet. I treated round 30's verdict as evidence to verify, not to accept.

The pipeline is unusually well-defended. The most common historical defect — a fix applied to one of N identical sites — is now mechanically caught at most of its former habitats. The selftest at 898 assertions is not padding. What follows is what survives measurement.

---

## R0. Round 30's verdict and repairs

Round 30 (the latest off-chain verdict in the bundle) found one MEDIUM (scan-backlog permanence), four LOW and two INFO. I verified every repair in the current tree:

**M1 (scan backlog)** — `bank/sigwalk.mjs` now takes `startBefore`; the alarm persists `backlogs[program] = { head, before }` and drains 20,000 per pass; the empty-resume drain-proof requires positive cursor evidence (`scan_backlog_unproven` CRITICAL otherwise); the poster mirrors the same logic. Selftest R30 M1 drives 25,000 stub signatures through the real `signaturesSince` and the extracted walk in both directions, plus the ghost-resume and cleared-cursor controls. **Repaired.**

**L1 (truncation grief)** — `log_coverage_gap` pages only when one of our five programs executed in the transaction (round 30 L1); the stranger shape is `log_truncated_foreign`, INFO. Selftest arms: stranger shape INFO and unpaged, invoked shape HIGH. **Repaired.**

**L2 (budget below floor)** — `budgetPlan` now keeps the floor in reserve on every branch (round 30 L2 review), and the base plan runs whenever the key covers it. Selftest arms at and under the floor. **Repaired.**

**L3 (dust failure)** — `sweepAmount` returns 0 below `MIN_SWEEP_LAMPORTS` (0.01 SOL). Selftest arms. **Repaired.**

**D1 (rehearsal tags)** — `planAlarmNotices` tags RECOVERED with `(REHEARSAL)`; the alarm's FAILED TO RUN / DID NOT RUN / RECONCILE FAILED texts carry the tag. Selftest R30 D1. **Repaired.**

**D2 (frozen zero stray)** — SPEC item 44 now says "holding a balance". **Repaired.**

No round-30 finding survives in the current tree.

---

## R1. The crank (`bank/crank.mjs`)

**Plan ordering is correct.** `planCrank` produces: reschedule → capture → reveal (strictly in mint order, stopping at first not-ready) → retire bare burns → pre-JOIN eligible vaults → expire due boosts → split → distribute → post-EXPIRE boosts the distribute made due → post-JOINs → activate → claim batches. The send loop follows this exactly. The program's `JoinWaitingFirst` and `BoostsExpireFirst` gates are respected: preJoins are sent as claim batches before `distribute`, preExpires before it, postExpires after it.

**No plan the program will refuse (that is not benign).** Every race code in `BENIGN` is a genuine "done elsewhere" or "not yet"; `judgeDistributeRefusal` distinguishes a moved-epoch race from a wrong plan, and `PoolShort` is always a fault. The selftest proves all of this in both directions.

**The crank never pays or joins a dead vault** (positively burned assets are excluded from `preJoins` and `claims`, and are retired first). It never moves value anywhere the program does not already pin: every instruction is a permissionless MINT call whose destination is the program's own.

**Reveal order** is strictly `revealed_total` onward; the loop breaks at the first vault that is not ready (neither captured nor capturable this pass). The `capturedThisPass` set reflects the *plan's* captures, not confirmed ones, but a failed capture causes the reveal to be refused `RevealTooEarly` (benign) and the run stops — the next pass re-plans.

**No finding.** The crank is correct at every site I checked.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

**Coverage of the required alarm conditions** is complete: fixed-forever values (WATCH), pending guardian/operator, PoB collection plugins and update authority, redemption rate, frozen/insolvent pool, distribution overdue, upgrade authority past lock for all five programs, boost bounds as fixed-forever, `boosts_stalled`, and Gary's production values.

**Routine states read as quiet** — a clean pass with no findings produces the all-clear text and no page. A routine crank pass with no failures produces no heartbeat problem and no page.

**No dangerous state reads as quiet that I can construct** within the program's rules. The `detectConfigDrift` baseline carries forward last-non-null values (L5), so a one-pass blip cannot hide a change. The `missingWatchedKeys` gate forces the reader to produce every watched key or throw.

**One gap (LOW, new):**

### F1 — LOW: The daily `--reconcile` has no liveness detector.

**Construct:** `bank/alarm.mjs` `reconcile()`, and the `deadman` cron line in `scripts/cron-install.sh`.

**What an attacker or accident gains:** The `--reconcile` job is the only instrument that sees undeclared token accounts a vault PDA owns (the signature walk is structurally blind to their creation). If its crontab line is removed, its process wedges under `flock -n` (accepted limit 7), or its state file is deleted while the main alarm's state survives, the daily completeness check silently stops. Nothing pages: the deadman watches `ALARM_STATE` (the 30-minute watch's state file), not `RECONCILE_STATE`; `detectCrankPosture` watches the crank's line, not the reconcile's. The post-hoc control table lists `detectUndeclaredTokenAccounts` as AUTOMATIC, so a reader would believe it runs.

**Evidence if true:** `crontab -l | grep reconcile` returns nothing (or the line is commented); `bank/state.json.reconcile` is stale by days; `bank/selftest.mjs` has no arm asserting a reconcile-staleness detector exists.

**Fix:** Add a reconcile-liveness check to the alarm's 30-minute pass: if `RECONCILE_STATE`'s `at` is more than 25 hours old (or the file is absent after the first run), page `reconcile_silent` HIGH. Alternatively, add a second deadman line for `RECONCILE_STATE`. Add a selftest arm in both directions.

**Why LOW, not MEDIUM:** The reconcile is post-hoc detection; the on-chain checks still fire on every redemption. Its loss widens the window for an undeclared-account surprise from "daily" to "never", which is real but not a value loss.

---

## R3. The layouts (`bank/layout.mjs`)

**The assertions are real.** `parseRustStruct` throws on any line it cannot read (private, `pub(crate)`, multi-line). Every struct is compared field-for-field against the Rust. Every cross-program `OFF_*` constant the programs pin is scraped and compared. Every PDA seed is scraped from its program's `*_SEED` constant and compared (11 of 11, round 24 D6). Layout versions, `BOOST_RING`, `MINT_CONFIG_SPACE` and `VAULT_RECORD_SPACE` are scraped and evaluated. The suite's own `OFF_*` constants in `tests/3prog.test.ts` are compared too.

**A struct change cannot slip past.** A new field makes `parseRustStruct` produce a different list; a type change is caught; a version bump is caught; a size change is caught.

**No finding.**

---

## R4. The money arithmetic (`bank/accrual.mjs` vs MINT)

**`credit`** — accrual: `delta = avail * ACC_SCALE / w; acc += delta; owed += delta * w`. MINT: identical. ✓

**`owed_of` / `pendingScaled`** — both compute `weight * acc + carry - debt`. The distributive forms are equivalent. ✓

**`ceil_sats` / `ceilSats`** — both `(x + ACC_SCALE - 1) / ACC_SCALE`. ✓

**`reweigh`** — both move owed to carry and reset debt to `new_weight * acc`. ✓

**`available`** — both `balance - ceil(owed)`. ✓

**Boost expiry before/after distribution** — the crank's `preExpires` are sent before `distribute`, `postExpires` after it. The selftest asserts both directions. ✓

**`boosts_stalled`** and the fixed-forever boost bounds are armed. ✓

**No divergence found.**

---

## R5. The swap (`bank/swap.mjs`) and the revenue cycle (`bank/revenue.mjs`)

### (a) Oracle math

The `oracleFloor` formula is correct for every sign of `e = sol.expo - btc.expo`: positive multiplies the numerator, negative the denominator. Integer division rounds down (`num / den`), which is the safe direction for a floor. `satsPerLamport` uses `Number(sol.price) * 10 ** sol.expo / (Number(btc.price) * 10 ** btc.expo) / 10` — for realistic Pyth prices (~10^10) and exponents (-8), the intermediate values are ~10^18, within Number's safe range; for extreme prices the float is used only for the deviation comparison (a 100 bps filter), not for the floor. **No overflow, no wrong rounding.**

The floor is `expectedSats * (10000 - 150) / 10000` — 150 bps below the oracle's expected output. After the pool's fee (Orca 16 bps) and the impact of a royalty-sized swap (~10 SOL against ~$10M liquidity, sub-bps), an honest pool returns well above this floor. ✓

### (b) Pyth account verification

The account is derived (shard 0 PDA under the push-oracle program), owned by the receiver program, fully verified (`level == 1`), and carries the expected feed id. The `PriceUpdateV2` offsets are correct: disc(8) + write_authority(32) = 40, then verification_level(1), feed_id(32), price(8), conf(8), expo(4), publish_time(8). ✓

Ownership + derived address + full verification + feed id is sufficient: the push oracle validates Wormhole VAA signatures before writing, so only Pyth's guardian set can produce a valid update. A stale `publish_time` is caught by the 180 s age check and the 30 s future check, both against the chain's Clock sysvar. **The residual — a compromised Pyth guardian set — is accepted limit 10(d) and correctly stated.**

### (c) Deviation filter

`orcaSpot`: `(sqrt_price / 2^64)^2` — the Q64.64 encoding is correct; for cbBTC/wSOL (~0.0116 sats/lamport), `sqrt_price` is ~2^58, and `Number()` conversion loses < 1 ULP at 2^52. `meteoraSpot`: `1 / (1 + bin_step/10000)^active_id` — the bin pricing formula is correct; the direction (X=cbBTC, Y=wSOL, reversed from Orca) gives sats/lamport as needed. `deviationBps` is symmetric. ✓

Floating point cannot pass a pool it should refuse: the deviation values at the 100 bps boundary differ from exact by << 1 bps.

### (d) Minimum out

`minSats = expectedSats * 8500 / 10000` is the same floor the deviation filter assumes (oracle-derived, 150 bps tolerance). Orca's `other_amount_threshold` and Meteora's `min_amount_out` both carry it in sats (the output token's base units). ✓

### (e) The judge (`judgeSwapInstructions`)

The judge is the most hardened component in the swap. It requires the exact seven-instruction sequence: CU limit 400,000 with no CU price, two ATA idempotent creates for the operator's own accounts, a System transfer of exactly `lamportsIn` to the operator's own wSOL ATA, SyncNative, the venue swap with pinned pool/amount/floor/direction, and one CloseAccount back to the operator. It refuses any second signer, any extra program, any Token instruction but SyncNative and CloseAccount, any priority fee, any changed amount or floor, any misrouted output. The selftest refuses all eight round-25 tampers on both venues and the judge passes the honest build.

**What it cannot catch:** the tick arrays (Orca) or bin arrays (Meteora) passed as remaining accounts are not checked — a tampered builder could pass wrong arrays. But wrong arrays cause the swap to *fail* (the pool program validates them against the pool), not misroute funds. The cycle stays open and loud. The builder/judge/same-tree residue is accepted limit 10(c). **No routing past the judge that moves value.**

### (f) Account derivation

Orca: three tick arrays for a_to_b (current, then two below) — the derivation and seed (`"tick_array"`, pool, i32 LE start) match the Whirlpool IDL. The oracle PDA (`"oracle"`, pool) is derived. Vault A/B are read from the pool and validated against wSOL/cbBTC order. ✓

Meteora: bin arrays (active's array, then two above for Y→X: selling wSOL (Y) for cbBTC (X) pushes the active bin *up*) — I re-derived this from the pricing formula `(1+step)^id` and confirmed: buying X with Y increases the price of X in Y terms, so the active bin moves to higher ids. The bitmap extension is passed as the program id when absent. `host_fee_in` is None. The event authority and two token programs are correct. ✓

At a tick-array boundary, `orcaTickArrayStarts` starts at the boundary's own array (the `Math.floor` is correct for negative ticks too). An uninitialised array causes the swap to fail (the pool program refuses), leaving the cycle open.

### (g) wSOL handling

Wrap exactly `lamportsIn`, sync, swap, close back. If the operator's wSOL ATA already holds a balance, `SyncNative` makes the swap see the total, so it could consume more than `lamportsIn` — but it is the operator's own account and the excess is returned to the operator via `closeAccount`. A frozen wSOL ATA causes `createAtaIdempotent` to fail (the ATA program refuses), the cycle stays open. **No finding.**

### (h) Failure and retry

Orca first; Meteora only on `classifySendFailure` returning `refused` (a preflight refusal, a landed-and-failed, or an expired-and-never-landed). An `unknown` outcome throws and stores a `pendingSwapSig` — the cycle stays open and the open-cycle guard prevents a second swap. Every path leaves the ledger open until a cbBTC return is proven on chain (`cycleIsOpen` requires `returnedSats > 0` and a split). **No double-count, no false close.**

### (i) Adversary extraction

Within the 100 bps deviation gate and 150 bps floor, the worst case is 150 bps of the oracle's expected output: at the ruled 10 SOL cap, ~0.15 SOL per cycle, ~0.6 SOL/day at 40 SOL/day throughput, ~18 SOL/month. A stale-but-accepted oracle (180 s) plus a market move could widen this, but the confidence check (30 bps) and the pool-agreement check bound it. A manipulated Meteora pool (~10x thinner) is only used when Orca refuses, which requires an Orca failure first. **Material but bounded; consistent with the stated limits.**

**Operator key worst case** (limit 10, two pool programs + oracle instead of HTTP): a malicious pool upgrade could steal the swap's input SOL (≤ 10 SOL per cycle) while returning enough cbBTC from another source to pass the post-swap delta check. The exposure is `max_sweep_lamports` × cooldown windows until the guardian stops it, exactly as stated. The ledger correctly refuses to read a failed cycle as closed.

**No finding in the swap or the revenue cycle.**

---

## R6. The gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

**Assertions that cannot fail:** I checked the round-24 section arms specifically. `judgeCronTemplate`'s litter check now reads `os_tmp` (round 15 fix). The round-24 L1 arms drive the real `judgeSwapInstructions` against all eight tampers and the old judge to prove each arm can fail. The L13b wiring gate uses comment-stripped source and consumption analysis, and the selftest proves it catches a deleted call, a comment-only call, and a discarded result. The I4 argument-pinning gate catches swapped arguments and wrong option values. The R30 M1 flood arm drives 25,000 real signatures through the actual extracted walk.

**Floors that can be satisfied by deleting work:** every floor in `run-tests.sh` requires exact equality (`-eq`, not `-ge`), and `selftest.mjs`'s own `FLOOR = 898` must equal `DET_FLOOR`. The SPEC count gate checks every occurrence of every stated count. A deleted assertion turns the floor red.

**Vacuous checks on empty input:** `detectVaultSetChange` with no prior set returns quiet (correctly — first pass). `missingWatchedKeys` with an empty snapshot returns every key (correctly). `detectIndexShortfall` with `undefined` minted_total returns quiet (correctly — unknown chain count). I found no vacuous pass.

**The round-24 "both directions" claim holds** at every arm I checked.

**`scripts/build-mainnet.sh` proves what it says** for all five programs: the four initializing programs are behaviourally tested (mainnet rejects the test key, localnet accepts), the sweep helper's mainnet bytes are compared against both `$CACHE/ln` and `target/deploy`, and the banner says only what was measured ("NOT PROVEN that the compiled constant IS that key" is honest).

**`scripts/cron-install.sh` arms nothing it should not.** The `ours()` function matches the specific tagged job name to end-of-line, not any tagged line. The selftest drives the real preservation logic in both directions (commented-out, prose, other project's, wrong flag order all refused).

**No finding.**

---

## The accepted limits — four questions

### 1. Is any limit WORSE than stated?

**No.** Every limit I checked is at most as bad as its text claims. The operator key's bound (cap × cooldown windows) is enforced on chain. The rev-roll re-roll is exactly as described. The box-owner trust boundary is honestly scoped. The 1.5% swap tolerance is the stated number.

### 2. Is anything listed as a limit not actually a limit?

**No.** Every item in ACCEPTED is a real, unrepaired condition.

### 3. Is any DISCHARGED item not actually discharged?

**No.** The $CBOB boost is built and tested. The compute measurements are real. Duplicate attributes are rejected on chain. The unlevelled-vault halt is closed by construction. The 85/15 is fixed at `initialize`.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**No.** Items 22, 38, 50, 52 and 53 are all genuinely open and blocking. The holder guide is marked DRAFT and may not be published before item 50 ships. `charter_opens_at` and `lock_deadline` are still null in `launch/mainnet-init.json`. The rehearsal value set (item 53) is still not written.

---

## Additional findings

### F2 — LOW: `cycleIsOpen` can close a zero-moved row without checking the split.

**Construct:** `bank/detectors.mjs` `cycleIsOpen`.

**What an attacker gains:** A ledger row with `sweptLamports: '0'` (or `intendedLamports: '0'`) and `sendRejected` absent or false would be read as closed without checking whether a split happened. In practice `revenue.mjs` never writes such a row (it returns early when `amount === 0n`), so this requires a manually edited ledger — the box-owner trust boundary of accepted limit 10. But the function's contract is "a cycle is open until the cbBTC has been split", and this row violates it.

**Evidence if true:** `cycleIsOpen({ sweptLamports: '0' })` returns `false` without inspecting `splitSig` or `splitByOther`.

**Fix:** After the `moved === 0n` early return, require `sendRejected === true` or a split to close. Or document the zero-moved row as "nothing moved, nothing to split" explicitly in the function's contract.

**Why LOW:** Not reachable through the code as shipped; the alarm's chain-evidence checks would catch a fabricated row carrying a real sweep. It is a contract gap in a pure function.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run the mainnet dress rehearsal (item 22) with a real person at the terminal watching, not just recording signatures.** The five named items (live crank passes, live alarm passes, one full revenue cycle through each pool, one forced post-sweep failure walked through hand recovery, one DAS read of a burned collection) must be executed by someone who will look at the results and say "this is right" or "this is wrong" — not by a script that prints pass/fail. The forced-failure recovery in particular exercises a human runbook under stress; rehearsing it cold is how you learn the runbook is wrong.

2. **Have a second person independently rebuild `dist/` from the release commit and compare sha256, on a different machine.** `build-mainnet.sh` proves which key the binary carries by behaviour, and says honestly that it cannot prove the compiled constant is Gary's key. Reproducibility by a second party is the only bridge, and it must be done by someone who did not write the build script.

3. **Run the holder surfaces (item 50) against real wallets — Phantom, Ledger, a Gary Club custodial wallet — with real testnet vaults, by people who are not on the project.** The redemption page's packet shape, the compute-budget instruction placement, the prior-transaction ATA preparation and the `judgeRedemptionCoverage` warning are all measured offline. The first time a real wallet serialises the real redemption will find something the measurements did not.

4. **Write the rehearsal value set (item 53) and run `check-launch-params.mjs --rehearsal` against it.** The rehearsal cannot proceed without this, and it is the only thing standing between "the values are ruled" and "the values are right".

5. **Get Gary to physically hold the guardian wallet and the PoB-collection key in separate hands from the box, through the charter window.** The charter window's exposure (accepted limit 46) is a custody problem, not a code problem. A multisig or a cold key for those seven days closes it; nothing in the code can.

6. **Run one full month of the revenue cycle on mainnet with small amounts BEFORE the upgrade authority is removed, and have a human reconcile the ledger against the chain by hand.** The chain-evidence checks in the alarm catch an off-box thief and honest mistakes, but the box-owner boundary (limit 10) means the only check on the ledger's completeness is a human looking at the chain. Do that check once, deliberately, before the programs become permanent.