# Round 41 Audit Report

## R0. Round 40 Verdict and Repairs

Round 40 was **NOT CLEAN** on both passes (quorum met on both). I independently verified every confirmed finding, repair, and rejected claim against the current tree (`8dba479`).

### Round 40 Repairs Verified

**C01 (LOW, off-chain):** The ceremony test's M2 arm was vacuous because `indexOf` returns `-1` for an absent string, making `-1 < k` true. The repair binds the index and requires presence:
```js
(at => at >= 0 && at < pageSrc.indexOf("const signed = await signExact(wallet, tx, s.id === 'collection'")))(pageSrc.indexOf("remember(ctx.newCollection.publicKey.toBase58())"))
```
This is a real repair. Deleting the `remember` call now fails the assertion. **Holds.**

**C02 (LOW, off-chain):** The swap floor arm recomputed the code's own expression. The repair pins a hand-computed vector:
```js
[f.expectedSats, f.minSats, SWAP_TOLERANCE_BPS], [280_355n, 276_149n, 150]
```
I verified the arithmetic: 2 SOL at the fixture prices (SOL $120.45355552, BTC $85,929.10904675) yields 280,355.6 expected sats, floored to 280,355; 150 bps under is 276,149.675, floored to 276,149. Changing `SWAP_TOLERANCE_BPS` to 9000 makes the test fail. **Holds.**

**V40-1 (MEDIUM, programs):** A stranger's lamports at a missing token-account address (System-owned, 0 bytes) made the redeem page refuse with a false reason. `absentIfDust` now reads such accounts as absent and creatable. The repair is present in `web/src/lib/decode.mjs` and exercised by the e2e test. **Holds.**

**V40-2/V40-3/V40-4/V40-5:** The ceremony step 5, generator, SPEC item 2, and nested-vault note repairs are all present and verified. **Hold.**

### Round 40 Rejected Claims Verified

I spot-checked the rejected claims (C03 regex alternation, C05 ComputeBudget encoding, C06 `detectRevealStall`, C07 `get.test` diffIx, etc.) and confirmed they are correctly rejected. The C04 regex residue (the `]` branch allowed anywhere) is the round 39 C14 / round 38 C09 class — a constructible blind spot in an arm that fails for natural breakages, not a defect.

---

## R1. The Crank (`bank/crank.mjs`)

I traced the full `planCrank` logic and the send sequence. The order is: reschedule, capture, reveal, retire, join (preJoins), expire (preExpires), split, distribute, expire (postExpires), activate, claim. This matches red-team 3 finding 6's recorded order.

**No new defect found.** The weight arithmetic (`preJoinWeight`, `retiringWeight`, `expiringWeight`, `w`) correctly plans against the post-distribution accumulator. The `preJoins` only include vaults with `request_epoch < dist_epoch` (earlier epochs), and the post-distribution `joins` include vaults with `request_epoch == dist_epoch` (current epoch). Both are joined before they can share in a distribution. The `budgetPlan` function correctly reserves the floor for reveals and never spends the key below it.

---

## R2. The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

I verified every detector listed in `ALARM_KINDS` is wired and that the WATCHED_KEYS list matches what `readConfigs` produces. The drift baseline carries the last non-null value of every key across a one-pass failed read (round 24 L5). The frozen-transition logic (`applyFrozenTransitions`) pages a freeze once and lists it at INFO while it stands.

**No new defect found.** The `detectRevealStall` correctly fires on `r0 < m0 && r1 < m1 && r1 === r0`, so it pages whenever vaults wait and the queue has not moved, whether or not minting continues (disproving C06).

---

## R3. The Layouts (`bank/layout.mjs`)

The selftest scrapes every `const OFF_X: usize = Y;` from the Rust source and compares it to the layout's computed offsets. It also scrapes every `pub const *_SEED: &[u8] = b"..."` and every `*_VERSION` constant. All 11 seeds, all cross-program offsets, and all layout versions are asserted equal.

**No new defect found.** The round 24 D6 repair (seed assertions) is armed and real.

---

## R4. The Money Arithmetic (`bank/accrual.mjs`)

I compared every function in `accrual.mjs` to its Rust counterpart in `programs/cbob-vault-mint/src/lib.rs`:
- `credit` ↔ `credit`: `delta = avail * ACC_SCALE / w; owed += delta * w` — matches.
- `pendingScaled` ↔ `owed_of`: `(weight + boost) * acc + carry - debt` — matches.
- `ceilSats` ↔ `ceil_sats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE` — matches.
- `available` ↔ the `distribute` avail computation: `balance - ceil_sats(owed_scaled)` — matches.
- `reweigh` ↔ `reweigh`: moves owed to carry, resets debt at new weight — matches.

The crank expires every DUE boost before distributing and every boost its own distribution makes due right after. The alarm pages `boosts_stalled` and treats `cbob_mint` and the boost bounds as fixed forever.

**No new defect found.**

---

## R5. The Swap (`bank/swap.mjs`) and Revenue Cycle (`bank/revenue.mjs`)

### (a) Oracle math
`oracleFloor`: `sats = lamports * sol.price * 10^(sol.expo - btc.expo) / (btc.price * 10)`. I verified the exponent handling for every sign of `e = sol.expo - btc.expo`. The `satsPerLamport` float is only for logging; the integer `expectedSats` and `minSats` are BigInt throughout. No overflow in BigInt-to-Number conversion occurs in the money path.

### (b) Pyth account verification
`readPyth` checks ownership by the Pyth receiver, full verification level, expected feed id, staleness ≤ 180 s, future ≤ 30 s, and confidence ≤ 30 bps. The `PriceUpdateV2` offsets (write_authority at 8, verification level at 40, feed at 41, price at 73, conf at 81, expo at 89, publish_time at 93) are recomputed and correct. The clock is the chain's Clock sysvar, never the box clock.

### (c) Deviation filter
`orcaSpot = (sqrt_price / 2^64)^2` and `meteoraSpot = 1 / (1 + bin_step/10000)^active_id` are the right quantities in the right direction. `deviationBps` is symmetric. A pool more than 100 bps from the oracle is skipped.

### (d) Minimum out
`SWAP_TOLERANCE_BPS = 150` is the same constant in the deviation filter and the on-chain floor. The units are whole sats in both.

### (e) The judge
`judgeSwapInstructions` requires the exact 7-instruction sequence: ComputeBudget limit (no price), two idempotent ATAs, System transfer of exactly `lamportsIn`, SyncNative, the venue's swap with amount and floor pinned, and one close. It checks the output account is the operator's own cbBTC, the input is the operator's own wSOL, the swap names the pinned pool, and no foreign program or extra Token instruction appears. It cannot catch a tampered tick array or oracle account, but the pool program refuses those on chain.

### (f) Account derivation
Orca tick arrays (current, then two below), oracle PDA, and vault A/B are derived correctly. Meteora bin arrays (active, then two above), bitmap extension, and event authority are derived correctly. I verified each seed against the programs' published interfaces.

### (g) wSOL handling
`createAtaIdempotent` creates or no-ops. The transfer adds `lamportsIn`. `syncNative` syncs. The swap uses the entire balance. The close returns any remainder. If the operator's wSOL ATA already held a balance, the swap would swap it too — but the operator is a dedicated wallet, and a pre-existing balance would be from a prior cycle's failed close, which cannot happen because the close is the last instruction and reverts on failure.

### (h) Failure and retry
Orca first; Meteora only if Orca's program refuses (a preflight refusal or an on-chain error read off the signature's status). An unconfirmed send stops the cycle, open and loud. The ledger cannot read a failed cycle as closed (`cycleIsOpen` checks `returnedSats` and `splitSig`/`splitByOther`).

### (i) Adversarial bound
With a 100 bps deviation gate and a 150 bps floor, a pool pushed to the edge of the gate loses at most 100 bps of the swap's value to the pool's price impact, and the floor loses another 150 bps. A stale-but-accepted oracle is bounded by the 30 bps confidence check. A manipulated Meteora pool (thinner) is skipped if it deviates more than 100 bps. The operator key's worst case is the per-sweep cap every cooldown until the guardian stops it.

**No new defect found.**

---

## R6. The Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

I verified the floors are real and can fail:
- `DET_FLOOR = 933`: the selftest has exactly 933 assertions, each proven both ways.
- `ALLOC_FLOOR = 39`, `POSTER_FLOOR = 24`, `LAUNCH_FLOOR = 49`, `HOST_FLOOR = 6`, `MAINNET_FLOOR = 33`, `POB_FLOOR = 14`, `MIN_ASSERTIONS = 896`, `EXPIRY_FLOOR = 4`, `SWAP_FLOOR = 16`.
- `scripts/build-mainnet.sh` proves which INIT_AUTHORITY each binary carries by deploying both builds to a real validator and asking each whether it trusts the test key. The sweep helper's mainnet bytes are byte-identical to the tested localnet bytes.
- `scripts/cron-install.sh` arms money only from our uncommented `--live` line; commented lines, prose notes, and other projects' lines never arm it. The `flock -n` prefix is asserted on every money job.

**No new defect found.**

---

## The Four Questions About Accepted Limits

1. **Is any limit WORSE than stated?** No. Every accepted limit is accurately stated and still valid. The costs are as described.

2. **Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?** No. All accepted limits are genuine and still open.

3. **Is any DISCHARGED item not actually discharged?** No. All discharged items are correctly discharged: the $CBOB boost (51) is built and measured; compute (12/17, 54) is measured; duplicate attributes (14) is closed on chain; the unlevelled-vault halt (19) is closed by construction; the 85/15 vote (30) is removed; the 31-day branch (31) is superseded; the operator notice (33) is discharged; and the v5 Bank items are gone.

4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?** No. Items 22, 38, 50, 52, and 53 are still genuinely open and blocking. `launch/mainnet-init.json` still has `charter_opens_at`, `lock_deadline`, and `vault_collection` OPEN.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

**What should this project do before launch that AI audit structurally cannot?**

1. **Run the dress rehearsal (item 22) and record the signatures.** AI can verify the code paths exist; it cannot verify that the crank, alarm, and revenue cycle actually work against a live cluster with ~2,100 vaults, real RPC latency, and real fee markets. The rehearsal must exercise: one full live revenue cycle through both pools (Orca forced to refuse once), one forced post-sweep failure walked through hand recovery, and the crank's live passes. Record every signature.

2. **Set the charter opening date and lock deadline (item 38).** These are product decisions, not code defects. The launch checker refuses while they are OPEN. Gary must set them, and the lock deadline must be at least 24 hours before the charter opens.

3. **Publish the holder surfaces (item 50).** The redeem page, vault page, claim page, buy page, and ceremony are built and staged. They must be published and tested with a real wallet on mainnet before the upgrade authority is removed. The RPC proxy must be enabled.

4. **Create the vault collection and the three cbBTC accounts (items 52 and road step 10).** The pool's cbBTC account, the revenue address's cbBTC account, and the CBOBTC Squads' cbBTC account must exist before the first split. The vault collection must be created with the ruled name, URI, and MINT's PDA as update authority, then recorded in `launch/mainnet-init.json`.

5. **Remove the upgrade authority (road step 11).** This is the point of no return. After this, every surviving bug is permanent. The order must be: deploy, verify the prefix hash and zero tail, set `--final`, verify again.

6. **A human should read the four `initialize` transactions before they are signed.** The launch checker validates the JSON, not the signed transaction. A human must confirm the built transactions match `launch/mainnet-init.json` exactly.

7. **A human should confirm the Proof of Burn set.** `scripts/probe-mainnet-facts.mjs` re-derives the 240-address Merkle root from mainnet raw account data every run, but a human should visually confirm the set matches Gary's intent before the window opens.

---

**Verdict: This tree is ready for the dress rehearsal and the final launch steps. No new defect survives measurement. The round 40 repairs hold. The accepted limits are correctly stated. The clean-round counter stays at 0/2 (round 40 was not clean).**