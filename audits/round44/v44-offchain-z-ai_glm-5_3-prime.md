# Round 44, Off-Chain Pass: Independent Audit Report

## R0. Round 43's Verdict and Its Repairs

I independently verified each of round 43's confirmed findings and their repairs against this tree.

### V43o-1 (release gate in the rehearsal tree) — REPAIR HOLDS

The `release_gate()` function in `scripts/run-tests.sh` now handles both cases: outside the rehearsal tree it checks `git diff --quiet "$rel" -- programs Cargo.toml Cargo.lock`; inside it (marker `REHEARSAL-RECORD.txt` present) it runs a Python proof that the program difference from `RELEASE_COMMIT` is exactly the recorded id substitution (map, patch sha, the four keyed programs patched, the reverse map recreating RELEASE_COMMIT's bytes). The selftest's V43o-1 arms run the extracted gate on a disposable git fixture patched by `rehearsal-tree.sh`'s own substitution engine, and verify all six cases: the audited tree passes, the recorded rehearsal passes, the same patched programs without the marker die, an unrecorded program-side edit dies, a forged sha still fails on the reverse map, and a marker copied into an unpatched tree dies. Each arm can fail when its property breaks. The web offline gate is skipped only where the marker stands, and the skip is printed.

### V43o-2 (permanently unreadable signature) — REPAIR HOLDS

`bank/alarm.mjs` now tracks `unreadPasses` per signature. A signature unreadable on `UNREADABLE_SKIP_PASSES` (3) consecutive passes is skipped: the walk moves past it, it is kept in the alarm state's `unreadSkips`, and `tx_skipped_unreadable` (HIGH, level) stands on every pass until a person writes the watermark to `bank/unreadable-reviewed`. The `detectUnreadSkips` function reuses `detectLogGaps`'s keeping rule (an unreviewed entry is never dropped). The poster does the same: two runs stop with the cursor held, the third queues the signature REJECTED for a hand read and moves on. The selftest's R43 V43o-2 arms run the real extracted walk with a permanently unreadable signature and verify the backlog drains and newer signatures are read; the control verifies a transient fault holds the cursor and is then read. Both directions are armed.

One observation on state rollback: when an alarm pass fails to deliver its findings, `unreadPasses` and `unreadSkips` are not rolled back (unlike `cursors`, `backlogs`, `config`, etc.). This is arguably correct — the skip counter counts attempts, not delivered reports, and a delivery failure should not reset the count of times a signature was genuinely unreadable. The cursor IS rolled back, so the same window is re-read; if the signature is now readable, it is processed normally. I judge this a design choice, not a defect.

### V43-1 (crank rescues nested vaults) — REPAIR HOLDS

`planRescues` in `bank/crank.mjs` is a pure function that uses `detectNestedVaults` to find nested vaults, then filters for those whose host is the vault itself, a live vault, or a burned asset. Foreign hosts are never planned (MINT refuses `HostUnresolved`). The send block constructs `rescue_nested(vault, host)` with the CBOBTC Squads as `new_owner` and the crank key only as fee payer. `NotNested` is in `BENIGN` (a race: rescued by someone else, or taken out since the plan). The selftest's eight R43 V43-1 arms verify the planner, the send block run as written, the `main()` wiring (full pass only, before the fee budget), the budget cost, and the `BENIGN` classification. The wiring arm verifies the rescue is planned from the vaults' own asset reads and that none is planned on the reveal lane.

### V43o-3 (reveal-skip arm) — REPAIR HOLDS

The selftest now extracts the reveal send loop from `crank.mjs` and runs it with recording stubs. It verifies that an asset reading as 'other' (neither live nor burned) ends the reveal run with nothing sent, that an unread asset does the same, and that a burned asset is revealed (with `[]`) and the run continues to the next record. The extraction's end anchor stops before the new rescue block (the interaction the VALIDATION.md notes was fixed). The arm can fail when the `break` is deleted.

### Core re-pin — HOLDS

`CORE_SHA256_EXPECTED=30dce56b…` is pinned in `scripts/run-tests.sh`. The selftest's R43 arm checks all four copies (run-tests, e2e-localnet, run-sim, build-mainnet) pin the same value and catches a drifted one. The mainnet probe (`scripts/probe-mainnet-facts.mjs`) asserts the deployed Core hashes to the pin and is not the August pin it replaced. The probe's floor is 35 (raised from 33).

### Rehearsal value set — HOLDS

`launch/rehearsal-init.json` exists with the described structure (MAINNET, PROPOSED, REHEARSAL-OPEN, REHEARSAL-NA statuses). `check-launch-params.mjs --rehearsal` judges it via `judgeRehearsal`, which checks the bounds, the never-mainnet keys, the compiled-in signer, and the rehearsal alarm's band. The mainnet check refuses the file by name (`_rehearsal`). The selftest's 19 R43 REHEARSAL arms each verify a refusal. I counted the REHEARSAL-OPEN keys in the committed file: guardian, bank_treasury, pob_collection, vault_collection, pob_root, charter_opens_at, swap_operator, cbob_mint, cbob_release_wallet — 9, matching the selftest's expected count.

### Round 43's rejected claims — I re-tested the key ones

- **LongCat's MEDIUM (unit mismatch in the deviation filter)**: `orcaSpot` is `(sqrt_price/2^64)^2` in raw units (cbBTC base units per wSOL base unit = sats per lamport). `meteoraSpot` is the inverse of the DLMM's lamports-per-sat. Both are sats per lamport, the unit of `satsPerLamport`. The fork's SW.7-SW.9 arms prove both venues price within the bound against the real cloned pools. Disproved correctly.
- **Sonnet's bitmap dust**: the bitmap PDA is `PDA(['bitmap', pool], METEORA.program)`. A PDA is off-curve, so no private key exists for it and no stranger can create an account at that address via `create_account`. Only the Meteora program can create accounts there (via CPI with `invoke_signed`). The existence-only check is safe against strangers. Disproved correctly.
- **MiMo's precision LOW**: `Number(BigInt)` relative error is at most 2^-53 ≈ 1.1e-16, against a 1 bps (1e-4) granularity. The floor is BigInt. Disproved correctly.

**Verdict on R0: Round 43's repairs all hold. No regression found.**

---

## R1. The Crank (`bank/crank.mjs`)

I verified the crank's planning and sending against the program's rules:

**Plan ordering**: reschedule, capture, reveal, rescue, retire, join (preJoins), expire (preExpires), split, distribute, expire (postExpires), activate, claim. This matches the documented order and the program's gates (`JoinWaitingFirst`, `BoostsExpireFirst` checked before the split/distribute).

**Fee budgeting**: `planCostLamports` counts transactions (not instructions), matching the actual sending pattern. `budgetPlan` runs the base plan whenever the key covers it, and as many reveals (in mint order) as keep the key at or above the floor. The selftest's R30 L2 arms verify both directions.

**Owed arithmetic**: I traced the owed calculation for pre-joined vaults (F5: they share this pass's distribution at `debt = weight * acc_pre`), pre-expired boosts (owed at expiry plus level-weight share of the distribution), and live boosts (weight + boost at the post-distribution accumulator). All match the program's `owed_of` formula.

**Retirement planning**: `retiringOwed` correctly computes what retiring vaults are owed at the pre-distribution accumulator, and `owedAfterRetire` subtracts it from `owed_scaled` before computing the distribution's available amount. The `retiringWeight` includes boosts (via `wOf`), and retiring vaults are excluded from `preExpires` (their boosts are removed by `retire`, not `expire_boost`). No double-subtraction.

**Boost expiry**: `preExpires` catches `dist_epoch >= boost_end_epoch` (already due). `postExpires` catches `boost_end_epoch === dist_epoch + 1` (the distribution makes it due). No integer exists between `dist_epoch` and `dist_epoch + 1`, so no case is missed.

**Instruction allowlist**: the crank sends only permissionless MINT instructions. The selftest verifies no token or SOL transfer is built and no program but MINT is called.

**Finding R1-1 (LOW, already known as round 43 C18)**: A split refused for a null decimals read still leaves `plan.distribute` set. The distribute then fails (the pool doesn't have the split amount) and is paged as a fault. Nothing moves. This is the loud direction and was already dispositioned as "NOT A DEFECT." I concur.

**No new defect found in the crank.**

---

## R2. The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

I verified the alarm's detectors against dangerous and routine states:

**`detectSweepState`**: The half-cooldown window (`|t - cycle_start| <= cooldown/2`) is sound. A thief's sweep must wait a full cooldown after an honest one, so the gap exceeds `cooldown/2`. The cooldown used is the smallest ever seen (never above the ruled 6 h), which is a sound bound since a vote can only lengthen it.

**`detectUnreconciledRevenue`**: The `short_swap_return` tolerance (2%) is wider than the swap's on-chain floor (1.5%), so returns at the floor don't page. Correct.

**`detectDistributionOverdue`**: The `launch_tick_overdue` condition (w=0, pt>0, month+grace passed) is correct. The `distribution_overdue` condition correctly requires someone to pay (w>0) and something to pay (poolAvail>0).

**`detectCrankHealth`**: The covered-freeze string matching is fragile but tested (the selftest drives the real planner). A text change would be caught.

**`detectApprovals` fallback**: The `ataOwner` map is built from the DAS list. If a vault is not in the DAS list, its PDA is not in the map. This is the round 43 C04 finding, disproved as a defect (approves need a thaw, which burns the vault). I concur.

**`readConfigs` dust handling**: A System-owned, 0-data account at a config address reads as `_missing` (not created yet). A System-owned account WITH data still throws (foreign owner). Correct.

**Finding R2-1 (INFO)**: The `unreadPasses`/`unreadSkips` state fields are not rolled back when a pass fails to deliver. This means the skip counter advances on failed-delivery passes. I judge this correct behavior (the counter counts attempts, not delivered reports), but it creates an asymmetry with the cursor rollback that is worth documenting. Not a defect.

**No new defect found in the alarm.**

---

## R3. The Layouts (`bank/layout.mjs`)

The selftest asserts:
- Every struct's field list equals the Rust struct (parsed from source, strict: private/pub(crate) fields throw)
- Every cross-program offset equals the layout's computed offset (all `OFF_*` constants scraped and compared)
- Every PDA seed equals the program's declared seed (12 of 12, the D6 repair)
- Layout versions match across all programs
- `BOOST_RING` matches between MINT, the layout, and the suite
- Account spaces (minus padding) equal the layout's fixed lengths
- Round-trip encode/decode works
- Various refusals (wrong discriminator, version, truncated, non-credible Vec length, etc.)

The D6 repair (SEEDS assertion) is now a real gate: it scrapes `pub const <NAME>: &[u8] = b"..."` from each program's source and compares with `L.SEEDS`. A mistyped seed or an unmapped one is caught.

**No defect found in the layouts.**

---

## R4. The Money Arithmetic (`bank/accrual.mjs`)

I verified each function against the program:

- `credit`: `delta = avail * ACC_SCALE / w`, `acc += delta`, `owed += delta * w`. Identical to MINT's `credit`.
- `pendingScaled` (owed_of): `weight * acc + carry - debt`. Identical to MINT's `owed_of`.
- `reweigh`: moves owed to carry, restarts debt at new weight. Identical to MINT's `reweigh`.
- `ceilSats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE`. Identical.
- `available`: `balance - ceil(owed)`, clamped to 0. The program refuses with `PoolShort` instead; the alarm reports it. Documented difference.

The crank's expiry ordering (before and after distribution) matches the program's `BoostsExpireFirst` gate. The alarm's `boosts_stalled` pages when due boosts persist past the grace.

**No defect found in the arithmetic.**

---

## R5. The Swap (`bank/swap.mjs`) and Revenue Cycle (`bank/revenue.mjs`)

### (a) Oracle math

I verified the formula with the pinned vector: 2 SOL at $120.45355552 / $85,929.10904675 gives 280,355 expected sats (floor), 276,149 minimum (150 bps under). The exponent handling for every sign is correct (`e >= 0` scales the numerator, `e < 0` scales the denominator). The `satsPerLamport` float is used only for the deviation filter, never for the floor. The floor is BigInt throughout.

### (b) Pyth account verification

The `PriceUpdateV2` layout is: disc(8) + write_authority(32) + verification_level(1 for Full) + feed_id(32) + price(8) + conf(8) + expo(4) + publish_time(8). The code reads at offsets 40, 41, 73, 81, 89, 93 — all correct. The account is derived as `PDA([2 zero bytes, feed_id], pyth_push)` (shard 0), and ownership by the receiver program is checked. Only Full verification and the expected feed id are accepted. The age is judged against the Clock sysvar (never the box clock), and a `publishTime` more than 30 s ahead is refused.

Can anyone write a fully-verified update with an old `publishTime` into that account? No — the account is a PDA of the push-oracle program, so only that program can write to it. The push-oracle program writes only what the Wormhole-verified Wormhole VAA says. A compromised Pyth/Wormhole could write a bad price, but that's the acknowledged third-party trust (limit 10(d)).

### (c) Deviation filter

`orcaSpot` is `(sqrt_price/2^64)^2` in raw units (sats per lamport). `meteoraSpot` is the inverse of `(1 + bin_step/10^000)^active_id` (sats per lamport). Both are compared against `satsPerLamport` from the oracle. The selftest's L6 arms verify 99 bps passes and 101 bps fails on both sides, through `market()`. Floating-point cannot pass a pool it should refuse because the comparison is `dv <= MAX_POOL_DEVIATION_BPS` with `dv` computed as `Math.abs(pool - oracle) / oracle * 10_000` — a float with ~1e-16 relative error against a 1 bps granularity.

### (d) Minimum out

Both venues carry the same `minSats` (the oracle floor) at data offset 16. The deviation filter uses `satsPerLamport` (float), the floor uses `minSats` (BigInt) — both derive from the same Pyth reads. The units are correct for each program (Orca's `other_amount_threshold`, Meteora's `min_amount_out`).

### (e) The judge

The judge requires the exact seven-instruction sequence. It checks: allowed programs, no second signer, no priority fee, only SyncNative and CloseAccount Token instructions, exactly 7 instructions, exactly 1 swap, exactly 1 System transfer, the compute-unit limit (400,000), both ATA creations (operator's own wallet and mint), the wrap amount, SyncNative, the swap's program/amount/floor/direction (Orca)/accounts (pool, input, output, signer), and the close (operator's wSOL back to the operator).

What it does NOT check: Meteora key 9 (`host_fee_in`). The builder sets it to the program id (Anchor's "None"), but the judge doesn't verify it. A tampered builder could set it to a real account, diverting part of the fee. The output is still bounded by `min_amount_out`, so the holder's cbBTC is guaranteed. This is the round 43 C14 recommendation, unapplied. **I concur it is a hardening item, not a defect.**

### (f) Account derivation

Orca tick arrays: current, then the two below (a_to_b pushes the price down). Verified: `orcaTickArrayStarts(-88733, 16)` = `[-90112, -91520, -92928]`. A tick exactly on a boundary starts that array. Correct.

Meteora bin arrays: current, then the two above (Y→X pushes the active bin up). Verified: `meteoraBinArrayIndexes(5920)` = `[84, 85, 86]`. A negative id floors down. Correct.

At a tick-array boundary or an uninitialized array: the swap would fail (the program can't find the tick/bin it needs). This is a loud failure, caught by the venue loop (try the next venue). Correct.

### (g) wSOL handling

Wrap exactly `lamportsIn`, sync, swap, close. A pre-existing balance is returned on close (the close returns ALL lamports). A delegate would cause the swap to fail (the Token program checks authority). An account created by someone else is the same address (ATA derivation). Nothing is left wrapped (the close returns everything). Correct.

### (h) Failure and retry

`classifySendFailure` distinguishes refused (nothing moved), landed (succeeded), and unknown. The revenue job:
- Sweep refused → `sendRejected`, cycle closed
- Sweep unknown → `pendingSweepSig`, cycle open, throw
- Swap refused → try next venue
- Swap unknown → `pendingSwapSig`, cycle open, throw
- Return/Split failure → `pendingSig`, cycle open, throw

A confirmation timeout on a swap that later lands: the cycle stays open (loud), the next run refuses at the open-cycle guard, and hand recovery is required. The automatic path never double-swaps. Every path leaves the ledger open until a cbBTC return is proven on chain (the `cycleIsOpen` predicate requires `returnedSats > 0` AND a split for closure).

### (i) Adversary extraction within tolerance

With a 100 bps deviation gate and a 150 bps floor:
- A sandwich pushing the pool to exactly 100 bps from the oracle extracts ~100 bps per cycle (10 SOL cap → ~0.1 SOL ≈ $12). Per month at the ruled cadence (~34 SOL/day): ~$1,440. Material but bounded.
- A stale-but-accepted oracle (up to 180 s): if SOL moved 2% in 180 s, the pool at the true price would be 200 bps from the oracle and SKIPPED. The swap wouldn't happen. If the attacker pushes the pool to within 100 bps of the stale oracle, the floor (150 bps below the stale expected) may be above or below the true expected depending on direction. The worst case is ~3% extraction per cycle, requiring a 2% oracle staleness AND a sandwich. Rare and bounded.
- A manipulated Meteora pool (10x thinner): the deviation gate still applies. The pool must be within 100 bps of the oracle to be used.

The cycle size (10 SOL cap) makes the per-cycle extraction small. The monthly extraction is bounded by the cap × cadence. This is the accepted residual in limit 10: "These checks do not establish a hard bound on deviation from the true SOL/cbBTC market price."

### Operator key's worst case

The operator key can sweep up to 10 SOL per cooldown until the guardian stops it. The alarm pages on a sweep with no matching return (`unreconciled_swap` CRITICAL, `sweep_unledgered_state` CRITICAL from account state). The ledger cannot read a failed cycle as closed (`cycleIsOpen` requires a return AND a split). The detection half does not survive a box compromise (limit 10 D2 item 3), which is stated.

**No new defect found in the swap or revenue cycle.**

---

## R6. The Gates

### `bank/selftest.mjs`

The FLOOR is 968 and must EQUAL the count. I looked for arms that cannot fail:

- The V43o-3 repair (reveal-skip arm) now extracts and runs the reveal loop. It can fail when the `break` is deleted.
- The V43o-1 repair (release gate) runs the gate on a fixture. It can fail when the gate is broken.
- The V43o-2 repair (unreadable skip) runs the real walk. It can fail when the skip logic is broken.
- The I4 arm (detector call arguments) extracts actual calls from alarm.mjs's source and compares to a pinned list. It can fail when arguments change.
- The L7 arm (program ids) checks all copies across multiple files. It can fail when a copy drifts.
- The D6 arm (PDA seeds) scrapes the Rust source. It can fail when a seed changes.
- The L13c arm (account spaces) scrapes and evaluates the Rust's space expressions. It can fail when a space changes.

I found no arm that cannot fail when its property is broken.

### `scripts/run-tests.sh`

The floors must EQUAL the counts. The release gate is new and verified above. The web offline tests are skipped only in the rehearsal tree (with a printed reason). The mainnet probe may not be skipped under `CBOB_SHIP_GATE=1`.

### `sim/swap-fork.sh`

The SWAP_FLOOR is 16 and must equal the count. I counted the assertions in `swap-fork.mjs`: 6 (per-venue swap/floor/spent) + 4 (judge arms) + 3 (market clock arms) + 2 (10 SOL cap) + 1 (deviation bound) = 16. Correct.

### `scripts/build-mainnet.sh`

I verified it proves what it says for all five programs:
- All four keyed programs are asked (mainnet rejects the test key, localnet accepts it)
- The sweep helper's mainnet bytes are byte-identical to the localnet bytes AND to `target/deploy` (the build the suite deployed)
- The source names Gary's wallet as the non-localnet INIT_AUTHORITY in all four programs
- The tree must be clean (or `CBOB_ALLOW_DIRTY=1`)
- The Core pin is checked against the cache

### `scripts/cron-install.sh`

The selftest's installer arms run the actual preservation logic. The six v6 jobs are installed (watcher, crank, crank-reveal, revenue, reconcile, deadman). No retired job is installed. The reveal lane runs every minute. The revenue line runs hourly. The `-n` flag is on every money job. The rehearsal marker refuses installation.

**No defect found in the gates.**

---

## web/test/ Analysis

I judged each test file for vacuity:

- **`bundle.test.mjs`**: The browser bundle comparison (bundled `planRedemption` vs node's, byte for byte, on 6 synthetic snapshots) can fail when the bundle differs. The static checks (CSP, viewport, no em dash, SRI) can fail when the built pages change. The L4 gate (release commit binding) runs the build and checks refusals. The README hash table check compares fresh builds. **All non-vacuous.**

- **`ceremony.test.mjs`**: The launch gate tests (judgeLaunch refuses/passes) can fail when the gate changes. The step comparisons against the suite's builders can fail when a step changes. The post-step checks (config fields) can fail when a field is wrong or unchecked. The collection checks can fail when a royalty or authority is wrong. **All non-vacuous.**

- **`decode.test.mjs`**: Compares the page's Core and SPL readers against official deserializers on bytes laid out as Core and Token write them. Can fail when a reader misparses. **Non-vacuous.**

- **`get.test.mjs`**: The claim refusals (13 named cases) each check a specific refusal message. The purchase refusals (10 named cases) likewise. The draw states check specific transitions. The buy page's read with dusted addresses verifies the reader's behavior. **All non-vacuous.**

- **`ids.test.mjs`**: Every address derivation is compared against the suite's, mpl-core's, spl-token's. The config shape and program bytes are checked against `dist/`. **All non-vacuous.**

- **`meta.test.mjs`**: The metadata generator tests verify file contents, fail-closed behavior, and never-older views. Each test can fail when the generator's behavior changes. **All non-vacuous.**

- **`plan.test.mjs`**: The redemption plan is compared as a whole legacy message against the Test Vault's S8 builders. Every rule of SPEC item 50 and round 35 C5 is driven both ways. The `prepareOpening` tests (V38-2, V39-1) drive the press with mock replans and dry runs, verifying that new arrivals don't stop the opening and that missing promised accounts do stop it. **All non-vacuous.**

- **`tx.test.mjs`**: The signing guard tests (honest wallet, adder, forger) can fail when the guard is removed. The error name tests check against the program's own list. **All non-vacuous.**

- **`run-all.mjs`**: Runs each file and checks the count equals the floor. **Non-vacuous.**

**No vacuous test found.**

---

## The Four Questions About Accepted Limits

### 1. Is any limit WORSE than stated?

**No.** I checked the key limits:

- **Limit 10 (swap operator)**: The stated bound (cap × windows until the guardian stops) is accurate. The detection gap on box compromise is stated. The oracle residual is stated ("does not establish a hard bound on deviation from the true market price"). The throughput ceiling (~34 SOL/day) is stated with the round 37 C05 qualification.
- **Limit 56 ($CBOB supply)**: The stated cost (anyone who reads the file can move every unreleased $CBOB) is accurate. The boost consequence (+12 weight for 24 distributions) is stated.
- **Limit 46 (Giraffish Moments hot wallet)**: The stated exposure (end the project or capture governance during the 7-day window) is accurate and complete.
- **Limit 28 (Coinbase freeze)**: The stated consequences (frozen vault blocks redemption, frozen pool stops claims, frozen revenue account blocks splits and mints) are accurate. The stage 3c fix (redemption forfeits undelivered share) is stated.

### 2. Is anything listed as a limit not actually a limit?

**No.** I checked:

- **Limit 42 (prior transaction for destination ATAs)**: The narrow owner-payer shape fits (1,219 bytes), but the page's contract requires the padded shape. The limit is correctly stated as "the current client contract, not an impossibility across all formats."
- **Limit 25 (re-roll)**: The mechanism (compute the draw, decline to capture, hope nobody else does) is real. The control (permissionless capture, crank every minute, alarm on reschedule) is real.

### 3. Is any DISCHARGED item not actually discharged?

**No.** I checked:

- **Item 54 (compute)**: Discharged by real measurements from landed transactions. The numbers are pinned in the suite.
- **Item 19 (unlevelled-vault halt)**: Discharged by construction (`activate` refuses `NotRevealed`). No state exists where a vault is activated but unlevelled.
- **Item 51 ($CBOB boost)**: Built and measured. The suite section BO and the host unit tests prove the ring's wrap.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**No.** I checked:

- **Item 22 (live chain)**: OPEN. The dress rehearsal is "not started." The named pass/fail items are listed. Not treated as accepted.
- **Item 38 (launch values)**: OPEN. Three values remain OPEN (charter date, lock deadline, vault collection). The checker refuses while any is OPEN. Not treated as accepted.
- **Item 50 (holder surfaces)**: OPEN. Pages are built and staged, not published. The holder guide is DRAFT. Not treated as accepted.
- **Item 53 (dress rehearsal)**: OPEN. The value set is built but the rehearsal hasn't run. Not treated as accepted.

---

## Findings

After this thorough review, I found **no new CRITICAL, HIGH, or MEDIUM findings**. The repairs from round 43 all hold. The tests are non-vacuous. The arithmetic mirrors are correct. The swap's oracle math, account derivations, and judge are correct.

### Confirmed findings

| ID | Severity | Class | Finding |
|---|---|---|---|
| (none) | — | — | — |

### Observations (not findings)

| ID | Severity | Observation |
|---|---|---|
| OBS-1 | INFO | The `unreadPasses`/`unreadSkips` state is not rolled back on delivery failure. The skip counter counts attempts, not delivered reports. Arguably correct (a delivery failure shouldn't reset the count of genuine unreadability). The cursor IS rolled back, so the window is re-read. Design choice, not a defect. |
| OBS-2 | INFO | Meteora key 9 (`host_fee_in`) is not pinned by the judge. The output is still bounded by `min_amount_out`. Round 43 C14 recommendation, unapplied. Hardening item. |
| OBS-3 | INFO | `bitmapExists` is an existence-only check. A stranger cannot create the PDA (off-curve). Round 43 C06 recommendation, unapplied. Hardening item. |

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

**1. Run the dress rehearsal with a human who watches real money move.**
The rehearsal (item 22, road step 8) is the only thing that exercises the crank, the alarm, and the revenue cycle against a live cluster with real (small) amounts. An AI audit can read the code and verify the tests, but it cannot observe a real sweep landing, a real swap executing against a real pool, a real alarm page arriving on a phone, and judge whether the behavior matches what a human would expect. The named pass/fail items in item 22 (one full revenue cycle through each pool, one forced post-swap failure walked through hand recovery) require a human to walk the runbook and confirm it works.

**2. Verify the box's security posture by physical inspection.**
The detection half does not survive a box compromise (limit 10 D2 item 3). The revenue ledger, the crontab, the alarm, the swap operator key, the $CBOB release key, and the deploy authority all live on one box under one user. An AI audit cannot verify: who has SSH access, what the backup procedures are, whether the R2 backup's include list is correct, whether the keys are actually mode 600, whether the box's kernel is patched, whether there's a hardware firewall, or whether the alert router's state directory is on the same filesystem. A human must inspect these.

**3. Verify the alert delivery path end to end.**
The alarm pages through `/opt/scripts/notify-gary-sms.sh` to a router to SMS/email. An AI audit can verify the router's logic (the selftest does), but it cannot verify that a page actually arrives on Gary's phone, that the SMS gateway is not silently dropping messages, that the email is not in a spam folder, or that Gary reads them at 3 AM. A human must send a test page and confirm receipt.

**4. Verify key custody by physical act.**
The guardian wallet (Gary's Phantom), the swap operator key, the $CBOB release wallet, and the deploy authority are all hot keys. An AI audit cannot verify that the Phantom seed phrase is not in a text file, that the swap operator key is not in a world-readable backup, or that the deploy authority key is actually in the encrypted offsite backup. A human must physically verify each key's custody.

**5. Exercise the guardian's brake under real conditions.**
The guardian can stop sales and the sweep. An AI audit can verify the program refuses correctly. It cannot verify that Gary can actually find his Phantom wallet, sign the `emergency_stop_sales` transaction, and confirm it landed — under the stress of a real incident. A human must practice this before launch.

**6. Verify the charter window's operational plan.**
The 7-day charter window is a one-time event. An AI audit can verify the program's clock checks. It cannot verify that the announcements go out, that the personal reminders are sent, that the claim page is published and reachable, or that the support channel is staffed. A human must walk through the plan.

**7. Have a human read the holder guide to a non-technical person.**
The holder guide promises specific things (deposit address, redeem page, coverage check, public posts). An AI audit can verify each promise against the code. It cannot verify that a real holder understands "the hourly limit slows how fast vaults can be opened, not how fast they can be moved" or "anything else in it may be destroyed with the vault." A human must read it aloud to someone who has never seen the project and ask them to explain it back.

**8. Run a real adversarial test over time.**
The scan floods, the sandwich attacks, the oracle manipulations, and the grief vectors are bounded by analysis. An AI audit can compute the bounds. It cannot run a real adversary for weeks, watching what actually happens to the alarm's state, the crank's fee key, and the operator's wallet. A human should pay a red team to try.

**9. Verify the Metaplex Core pin against the deployed binary at launch.**
The suite pins Core's hash and the probe checks it. But between the last audit and launch day, Metaplex could upgrade again. A human must run `solana program dump` on launch day and compare the hash to the pin before the ceremony starts. This is a 30-second check that no AI can perform because it requires acting at a specific moment.

**10. Have a human make the final go/no-go decision with full knowledge of what they are accepting.**
The launch gate is met. The accepted limits are stated. But the decision to remove the upgrade authority — making every surviving bug permanent — is a human decision that requires weighing the stated limits against the promised benefits. An AI audit can enumerate the risks. It cannot decide whether they are worth taking.