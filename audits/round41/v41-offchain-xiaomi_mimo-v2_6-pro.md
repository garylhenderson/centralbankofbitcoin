# Round 41 — Off-Chain Audit

## R0 — ROUND 40'S VERDICT AND REPAIRS

**C01 (LOW — ceremony test M2 arm vacuous under deleted `remember` call): REPAIRED.** `web/test/ceremony.test.mjs` now binds the index and requires presence: `(at => at >= 0 && at < pageSrc.indexOf(…))(pageSrc.indexOf(…))`. Under mRem (deleting the call), `indexOf` returns −1, `−1 ≥ 0` is false, and the arm fails. Verified by reading; the pattern is the round-40 verdict's prescribed fix.

**C02 (LOW — swap floor's tolerance unpinned): REPAIRED.** `bank/selftest.mjs` pins hand-computed literals at the 2026-10-05 fixture prices: `expectedSats = 280_355n`, `minSats = 276_149n`, `SWAP_TOLERANCE_BPS = 150`. Independently recomputed: 2 SOL × 120.45355552 / 85,929.10904675 × 1e8 = 280,355.65 floor→280,355; × 9,850/10,000 = 276,149.67 floor→276,149. Matches. The mTol9000 mutation (tolerance at 9000) would change `minSats` to 28,035 and turn the arm red.

**C10 (crank attribute reader on unusual Core shapes): ARMED** at `selftest.mjs` ("R40 C10"). Builds a rich vault (seal, attributes, five owner plugins, 20-signature autograph) and vaults with unknown plugin types 77 and 40, feeds them to `CR.mintedAttributes`, asserts the Attributes list reads `[level III]`. A future SDK bump that breaks either turns the suite red.

**C05 (ComputeBudget encodings):** Already pinned by existing arms ("M1: the judge passes the … swap we built" and the appended `setComputeUnitPrice` tamper refused with /priority fee/). Dispositioned correctly.

No round-40 confirmed finding survives unrepaired in this tree.

---

## R1 — THE CRANK (`bank/crank.mjs`)

**No confirmed defect.** What was checked:

**Wasted fees / false pages.** `BENIGN` covers every race code (`AlreadyRetired`, `AlreadyActive`, `VaultRetired`, `ActivationPending`, `RevealWindowExpired`, `NeedsReschedule`, `AlreadyRevealed`, `MonthNotElapsed`, `NothingToSplit`). `judgeDistributeRefusal` re-reads the config and treats a refused distribute as benign only when `dist_epoch` or `last_distribute_at` moved; `PoolShort` is always a failure. `mintFailureCode` attributes an Anchor error to MINT by invoke-stack depth (measured selftest R27 L3: a foreign same-named code is not swallowed; nested CPI errors retain attribution). The selftest pins both directions for each.

**Paying or joining a dead vault.** `planCrank` never pays or joins a vault whose asset reads as `'burned'` or `'other'`. `retireBurned` fires at any level (round 23 I1). The send order is retire → join → expire → distribute → expire → activate → claim (round 39 C01 extracts and runs the actual send block; red under mA).

**Reveal order.** The reveal loop starts at `cfg.revealed_total` and breaks at the first record that is missing, already levelled, or lacks entropy. One failure stops the run (strict FIFO). The selftest's "reveals run STRICTLY in mint order… and stop at the first not ready" arm proves it both ways.

**Value movement.** The selftest asserts `crank.mjs` builds no token or SOL transfer of its own and calls no program but MINT, and that its `distribute` is the free path (`Buffer.from([0])`), never a $GARY burn. `planCostLamports` counts exactly the transactions `main()` sends (verified by enumerating every `run`/`send` call against the plan's batch ceilings).

**One observation, not a defect (mechanism accurate):** if the RPC consistently returns `'other'` for a positively burned asset (null answer), the crank neither retires nor pays it, so its weight sits in `total_active_weight` until a human or a good RPC read retires it. The SPEC's limit 27 says "The crank never pays or joins a positively burned vault and retires it first"—the retirement fires only on a *positive* identification, which is the stated rule. The alarm's `crank_problem` streak (three passes) would surface it.

---

## R2 — THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

**No confirmed defect.** What was checked:

**Fixed-forever values.** `WATCH` lists every value written once by `initialize` (collection keys, split_bps, pool_ata, bank_treasury, max_supply, payment_mint, level_caps, pob_root, charter dates, monthly_secs, notice_secs, redeem_window_secs, the three tighten bounds, cbob_mint, max_boost_weight, max_boost_epochs, quorum/threshold/min_voting) at CRITICAL. `detectConfigDrift` pages any change. `missingWatchedKeys` ensures the reader produces every watched key.

**Pending guardian / swap operator.** `detectStandingRisks` pages `swap_operator_armed` and `guardian_armed` at CRITICAL every pass while pending.

**PoB collection plugins / update authority.** Both in `WATCH` at CRITICAL (`pob_collection.plugins_hash`, `pob_collection.update_authority`).

**Redemption window nearly full.** `detectRedemptionRate` pages `redemptions_near_cap` at HIGH when remaining ≤ 20% of cap.

**Frozen or insolvent pool.** `detectPoolHealth` pages `pool_frozen` (urgent) and `pool_insolvent` (CRITICAL) on any balance.

**Distribution overdue.** `detectDistributionOverdue` pages `distribution_overdue` at CRITICAL, plus `joins_stalled`, `boosts_stalled`, and `launch_tick_overdue`.

**Upgrade authority past lock date for all FIVE programs.** `detectUpgradeAuthorityAfterLock` iterates `['seal','mint','burn','gov','sweep']`. The selftest round-24 (A3) pins the sweep helper both ways.

**Production values (21%/51%/3 days, 7-day notice, tighten bounds, 30-day month, 1-hour window).** `detectStandingRisks` with `production: true` pins all of them as `test_value_in_production`. The selftest asserts each one fires and that the ruled values are quiet.

**Dangerous state read as quiet:** none found. The one gap the SPEC acknowledges is limit 38: the exact values of `max_sweep_lamports`, `sweep_cooldown_secs`, `sol_reserve_lamports`, the guardian, and the swap operator are not on the production list; only `scripts/check-launch-params.mjs` gates them before signing, and the alarm judges bounds (`sweep_cooldown_too_short`, `sweep_bound_ineffective`) and later changes (`config_drift`). Stated, not hidden.

**Routine state paged every pass:** none found. `sweep_cooldown_wedged` and `sweep_cap_wedged` are INFO (a legal vote tightening). `sales_stopped` / `sweep_stopped` are INFO standing status.

---

## R3 — THE LAYOUTS (`bank/layout.mjs`)

**No confirmed defect.** The round-24 D6 gap (SEEDS comment claimed an assertion that did not exist) is closed: `selftest.mjs` scrapes each program's `*_SEED` constant and compares all eleven to `layout.mjs`, and the two both-ways arms ("a mistyped seed, or one no program declares, is CAUGHT") prove the gate can fail.

**Struct changes cannot slip past.** `parseRustStruct` refuses any line it cannot read as one `pub name: Type,` field (round 22 L1). The selftest asserts every `STRUCTS[name].fields` equals the Rust struct field-for-field, including type changes under the same name (round 22 L2). Cross-program `OFF_*` constants are scraped from GOV/BURN/MINT and compared to `L.offsets()`; round 22 L2's "none scraped and ignored" arm ensures no constant escapes comparison. Layout versions and `BOOST_RING` are scraped and compared (round 23 L6). `MINT_CONFIG_SPACE` and `VAULT_RECORD_SPACE` are scraped and evaluated against `fixedLength()` (round 24 L13c). The suite's own `OFF_*` copies in `tests/3prog.test.ts` are compared too.

The `rescue` seed is not in `layout.mjs`'s SEEDS (it lives in `web/src/lib/ids.mjs`), but `ids.test.mjs` checks it against the Rust (`RESCUE_SEED`). Not a gap.

---

## R4 — THE MONEY ARITHMETIC (`bank/accrual.mjs` vs `programs/cbob-vault-mint/src/lib.rs`)

**No divergence found.** Line-by-line:

| Rust | JS mirror | Match |
|---|---|---|
| `credit`: `delta = avail*ACC_SCALE/w; acc += delta; owed += delta*w` | `credit({acc,owed},avail,w)` | ✓ |
| `owed_of`: `(weight_of(r) as u128)*acc + carry_scaled - debt_scaled` | `pendingScaled({level,debt,boost,carry},acc)` | ✓ |
| `weight_of`: `LEVEL_WEIGHTS[level-1] + boost_weight` | `weightOf(level) + BigInt(boost)` | ✓ |
| `reweigh`: `carry=owed; debt=(w+boost)*acc` | `reweigh(v,acc,boost)` | ✓ |
| `ceil_sats(scaled)`: `(scaled + ACC_SCALE - 1)/ACC_SCALE` | `ceilSats(scaled)` | ✓ |
| `expire_boost` → `unschedule_boost` → `reweigh(r,0)` | `pendingSats` with boost=0, carry=owed_old | ✓ (verified by the selftest's "BOOST: the expired boost and the plain vault are each owed EXACTLY 20 sats" arm) |

**Boost expiry before/after distribution.** `planCrank` pushes `preExpires` (every boost with `dist_epoch >= boost_end_epoch`) and sends `expire_boosts` before `split` and `distribute`. After `distribute`, it pushes `postExpires` (every boost with `boost_end_epoch === dist_epoch + 1n`) and sends them. The selftest's "BOOST: a DUE boost is expired before the distribution" and "a boost THIS distribution makes due is expired right after it" arms pin both.

**Alarm `boosts_stalled` and fixed-forever boost bounds.** `detectDistributionOverdue` pages `boosts_stalled` at HIGH. `cbob_mint`, `max_boost_weight`, `max_boost_epochs` are in `WATCH` at CRITICAL.

---

## R5 — THE SWAP AND THE REVENUE CYCLE

### (a) Oracle math — correct

`oracleFloor` computes `sats = lamportsIn × sol.price × 10^(es−eb) / (btc.price × 10)`. Integer floor at `num/den` (BigInt division truncates toward zero; both operands positive). `minSats = expected × (10000−150)/10000`, also floored. Exponent handling correct for both signs (the `if (e >= 0) num *= 10^e; else den *= 10^(-e)` branch).

`satsPerLamport: Number(sol.price) * 10**sol.expo / (Number(btc.price) * 10**btc.expo) / 10` — BigInt→Number loses no precision at realistic Pyth prices (both ≈10¹⁰ with expo −8; result ≈0.0014, well inside float64). The deviation filter computes both sides in the same floating-point form, so the rounding is symmetric and the 100 bps threshold is 70× the float error.

### (b) Pyth account verification — sufficient for what it claims

Offsets verified against `selftest.mjs`'s `pythAcc` fixture and the real `PriceUpdateV2` layout: disc(8) + write_authority(32) + verification_level(1 at offset 40) + feed_id(32 at 41) + price(8 at 73) + conf(8 at 81) + expo(4 at 89) + publishTime(8 at 93). Minimum length 101 bytes (code checks `8+32+1+32+8+8+4+8`).

Ownership is pinned to the Pyth receiver; the address is derived (shard 0 PDA under the push oracle). Only the push-oracle program can write to it. An attacker cannot write a chosen price into a derived PDA owned by the receiver without a signature from an authorized writer. `publishTime` is self-reported but bounded: staleness ≤ 180 s, future ≤ 30 s, against the chain Clock sysvar. The confidence check (`conf × 10000 > price × 30` refuses) bounds self-reported uncertainty to 30 bps per feed. The SPEC already states: "These checks do not establish a hard bound on deviation from the true SOL/cbBTC market price." That is honest.

### (c) Deviation filter — correct direction and units

`orcaSpot = (sqrtPrice / 2^64)²` in raw cbBTC-per-lamport. `meteoraSpot = 1 / (1 + binStep/10000)^activeId` in the same units (the pair prices X=cbBTC in Y=wSOL; the inverse gives sats per lamport). Both are compared to `satsPerLamport` from the oracle in `deviationBps`. Floating point cannot pass a pool it should refuse: the float error (≈1e-15 relative) is 10 orders below the 100 bps threshold. The selftest's L6 arms prove both directions through `market()` at 99 and 101 bps on both venues.

### (d) Minimum out — same floor, correct units

`minSats = expectedSats × 9850/10000`. This is the SAME number that goes into Orca's `other_amount_threshold` and Meteora's `min_amount_out` (selftest: `data.readBigUInt64LE(16)` at both venues). The deviation filter (100 bps) is tighter than the floor (150 bps), so a pool passing the filter is above the floor at read time. The floor is in cbBTC sats (8 decimals), which is the output token's base units for both venues.

### (e) Judge — thorough on value-moving roles; one gap

The judge requires the exact seven-instruction sequence, pins the compute-unit limit (400,000), refuses a priority fee (`d[0] === 3`), pins both ATA creations to the operator's own accounts, pins the wrap amount, pins SyncNative, pins the swap data (discriminator, amount at offset 8, threshold at 16, Orca's direction at 40–41 and price limit at 24), pins the output account at key 5, pins the signer, and pins the close. The selftest's round-25 L1 arms refuse each of the eight tampers on both venues.

**FINDING R5-e (LOW): `judgeSwapInstructions` does not pin every key position in the venue instruction.** For Orca, keys 0 (TOKEN program), 4 (vaultA), 6 (vaultB), 7–9 (tick arrays), 10 (oracle PDA) are not checked. For Meteora, keys 1 (bitmap), 2–3 (reserves), 6–7 (mints), 8 (oracle), 9 (host_fee_in), 11–12 (TOKEN), 13 (event authority), 14 (program), 15–17 (bin arrays) are not checked. A tampered builder could substitute any of these and the judge would pass.

*What an attacker gains:* nothing today, because the pool programs validate their own account lists (Orca pins vaults and tick arrays to the pool; Meteora pins reserves, mints, and bin arrays). But the judge is documented as "the last line before the operator key signs." If a third-party pool program were upgraded to relax its validation (accepted limit 10), this gap would become live. Defense-in-depth.

*Evidence:* `bank/swap.mjs` `judgeSwapInstructions`, key checks at `keyAt(sw, orca ? 2 : 0)`, `keyAt(sw, orca ? 3 : 4)`, `keyAt(sw, 5)`, `sw.keys[orca ? 1 : 10]`. No check on the other positions.

*Fix:* pin every key in the venue instruction to its derived/pinned address, or at minimum the value-carrying ones (vaults, reserves, mints). This is one `keysAre` call per venue.

### (f) Account derivation — correct

Orca tick arrays: `orcaTickArrayStarts(tickCurrent, tickSpacing)` returns `[s0, s0−span, s0−2×span]` where `span = 88 × tickSpacing`. At a boundary (tickCurrent exactly at an array start), `s0 = tickCurrent`; the two below are the next arrays. An uninitialised array makes Orca's swap fail on-chain (the pool program validates).

Meteora bin arrays: `meteoraBinArrayIndexes(activeId)` returns `[i, i+1, i+2]` where `i = floor(activeId/70)`. Y→X moves the active bin up, so the active array is first and the two above follow. The bitmap extension is passed as `METEORA.program` when absent (Anchor's None). `host_fee_in` is passed as `METEORA.program` (None). Event authority is the `__event_authority` PDA. Two TOKEN entries, then the program itself.

All seeds re-derived: `orcaTickArray` = PDA(["tick_array", pool, String(start)]); `oracle` = PDA(["oracle", pool]); Meteora `bin_array` = PDA(["bin_array", pool, i64le(index)]); `bitmap` = PDA(["bitmap", pool]).

### (g) wSOL handling — correct

Wrap is exactly `lamportsIn` (the judge pins it). `SyncNative` syncs. `CloseAccount(ownWsol → owner, signed by owner)` returns everything remaining. If the operator's wSOL ATA already holds a balance, the transfer adds to it and the close returns all of it; the cycle's `returnedSats` counts only `delta = after − opBefore` (the cbBTC delta), so pre-existing wSOL is returned but not counted. If the ATA is frozen (impossible for wSOL, the native mint), the transfer fails and the whole transaction reverts. A delegate is irrelevant (the transfer is from the operator's SOL, not their wSOL). If someone else created the ATA, the operator still owns it (ATAs derive from owner + mint).

### (h) Failure and retry — correct

Orca first; Meteora only when `classifySendFailure` returns `'refused'` (preflight error, landed-and-failed, or expired-and-absent). A confirmation timeout that later lands returns `'landed'` (the chain status is checked with `searchTransactionHistory: true`); the swap is recorded and the next venue is not tried. `'unknown'` (processed-only, no status, failed lookup) stops the cycle open and loud. The ledger stays open until `returnedSats > 0` and a split is proven (`cycleIsOpen` checks `returnedSats === 0n || !(splitSig || splitByOther)`).

### (i) Adversary bound — material at current cycle sizes

The binding constraint is the on-chain floor: 150 bps below the oracle's expected output. The 100 bps deviation filter is read-time only. Maximum extraction per cycle is 150 bps of the swap amount.

At the ruled cap (10 SOL ≈ $2,000) and the throughput ceiling (34 SOL/day ≈ $6,800/day):
- Per cycle: **$30** (1.5% of $2,000)
- Per month: **$3,060** (1.5% × $6,800 × 30)

A sandwich that pushes the pool to 100 bps at read time and 150 bps at execution extracts the full 150 bps. A stale-but-accepted oracle (up to 180 s) can add the price move in that window; the confidence check bounds the self-reported uncertainty to 30 bps per feed but not the true error. A manipulated Meteora pool (10× thinner) is easier to push but bounded by the same on-chain floor.

**The cycle size makes this material.** 1.5% of every royalty swap is a recurring cost to the 85% pool share. Over a year at current rates: ≈$36,700. This is stated in the SPEC ("These checks do not establish a hard bound on deviation from the true SOL/cbBTC market price") and in the holder guide ("Even an honest swap can come in up to 1.5% below Pyth's price, and further if Pyth's own price is off"), so it is not worse than stated—but it is a real number the operator should know.

**Operator key worst case:** the key can keep up to `max_sweep_lamports` (10 SOL) per cooldown until the guardian pulls `emergency_stop_sweep`. At 34 SOL/day throughput, that is 34 SOL/day until the stop. The alarm's `unledgered_sweep` (walk-based) and `sweep_unledgered_state` (account-state-based) page within 30 minutes; the guardian stop is instant. Practical worst case: one sweep (10 SOL) before the stop lands. The SPEC states this correctly.

**Ledger:** `cycleIsOpen` returns true for any cycle with `sweptLamports > 0` and no proven split. A failed cycle stays open and loud. Verified both ways in the selftest.

---

## R6 — THE GATES

**FINDING R6-1 (LOW): the ceremony test's C04 "uses" regex allows `newCollection]` — the `]` branch is unanchored.**

*Construct:* `web/test/ceremony.test.mjs`, the C04 arm:
```js
uses.every(u => /^newCollection(\.publicKey\.toBase58\(\)\)*|\])$/.test(u))
```
The `|` binds at the top level of the regex, splitting it into `^newCollection(\.publicKey\.toBase58\(\)\)*` and `\])$`. The second branch matches any string *ending with* `]`, and `RegExp.test()` does not require a full match. So `newCollection]` passes.

*What it means:* the arm is supposed to verify the page uses `ctx.newCollection` only for signing (`signExact` extra) and for its public address. A regression that stores the key in an array literal (`const leak = [ctx.newCollection]`) produces `newCollection]`, which passes. Round 40 measured this (mArr: 108/108) and recommended binding the `]` branch to the `signExact` call. Not done.

*Evidence:* round 40 verdict, C03 residue row; the regex is in `web/test/ceremony.test.mjs` (the `C04` block).

*Fix:* require the `]` to appear inside a `signExact(…[…ctx.newCollection]…)` call, or drop the `]` branch and match only the two legal forms (`newCollection` and `newCollection.publicKey.toBase58()`).

**All other gates verified non-vacuous:**

- `floor()` in `run-tests.sh` requires exact equality (`-eq`), not `>=`. Deleting assertions turns the build red. The regex patterns are specificity-anchored (e.g., `[0-9]+/[0-9]+ detector assertions as predicted`).
- `selftest.mjs`'s `FLOOR = 933` must equal `R.length`. Deleting assertions causes a mismatch.
- `run-all.mjs`'s per-file floors must equal each file's count.
- The round-24 section of the selftest arms every repair in both directions. I checked H1, L4, L5, L7, L8, L9, L10/L11, I3, I5, and D5: each has a "fires when it should" arm and a "quiet when it should" arm. **I could not find one that is not armed in both directions.** The closest is the M1 "confidence wider than the bound is REFUSED" arm, which tests only the refusal direction in its own assertion; the acceptance direction is covered by the main `oracleFloor` computation at 1 bps confidence. That is the round-25 I3 repair, not a round-24 one.
- `scripts/build-mainnet.sh` deploys all five programs (four keyed + sweep), asks each keyed one whether it trusts the test key (mainnet must REJECT, localnet must ACCEPT), and proves the sweep helper's mainnet bytes == tested localnet bytes == `target/deploy` bytes. Verified by reading.
- `scripts/cron-install.sh` arms nothing unexpected: six tagged jobs, `--live` preserved only from an uncommented tagged line, posture computed from the written crontab.

---

## THE ACCEPTED LIMITS — FOUR QUESTIONS

**1. Is any limit WORSE than stated?**

No. Every limit's stated cost matches the code. Limit 10's "150 bps below the oracle" is correctly qualified ("These checks do not establish a hard bound on deviation from the true SOL/cbBTC market price"). Limit 27's crank mitigation is correctly scoped ("positively burned"). Limit 46's charter-window exposure is stated in full. Limit 56's $CBOB custody is stated with its exact blast radius.

**2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?**

No. Limit 27's mitigation (the crank retires burned vaults first) is narrower than it might appear—it fires only on a positive `Key::Uninitialized` identification—but the limit text says "positively burned," which is accurate. No limit is already closed.

**3. Is any DISCHARGED item not actually discharged?**

No. Items 14, 19, 30, 31, 33, 51, and 54 are each discharged by a named on-chain refusal, a deleted mechanism, or a measurement. Verified against the current code.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

No. Items 22, 38, 50, 52, and 53 are all open. `launch/mainnet-init.json` keeps `charter_opens_at`, `lock_deadline`, and `vault_collection` as OPEN/null. The launch selftest (49/49) includes the refusal arms. Item 22's dress rehearsal has not been run. Item 50's pages are built and staged, not published. Item 53's rehearsal proof is stale (it is of `d57ee3a`, not the release commit).

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE: WHAT THIS PROJECT SHOULD DO BEFORE LAUNCH THAT AI AUDIT STRUCTURALLY CANNOT

AI reasons; it never signs, never receives a page, never watches a balance move. The following are concrete, ordered, and each one produces an artifact a later reader can check:

1. **Sign the four `initialize` transactions from `launch/mainnet-init.json` at a human terminal, then dump each config account and diff it field-by-field against the JSON.** The checker validates the JSON, not the signed bytes (item 38). A human must confirm the *on-chain* account equals the ruled values. Record the four signatures and the four dumps.

2. **Run the full dress rehearsal (item 22) at throwaway ids with real SOL and real cbBTC, and record every named item's transaction signatures:** the crank's live passes at ~2,100 vaults, the alarm's live passes, one full revenue cycle through Orca *and* one with Orca forced to refuse (so Meteora runs), and one forced post-sweep failure walked through hand recovery to `--audit` clean. A human must watch the pages arrive.

3. **Run `sim/swap-fork.sh` at the release commit and record the 16/16 output.** Then run it again with the 10 SOL cap and confirm the executed price against the oracle is within 150 bps on both venues.

4. **Publish the redeem page to a real browser, open a real vault with a real wallet, and complete one full redemption end-to-end.** Confirm the sweep helper moves every reserve, closes every account, the burn lands, and the public post drafts. This exercises item 50's client contract (prior transaction, claim-before-sweep, helper sweep, burn) against real wallet signing and real packet sizes.

5. **Run the alert drill: pull the guardian's sales stop on the rehearsal deployment and confirm a human's phone receives `brake_pulled` within one alarm pass.** Then let it stand for two passes and confirm it degrades to INFO. Then restart via a vote and confirm `brake_released` arrives. Do the same for `pool_frozen`, `distribution_overdue`, and `unledgered_sweep`. A notification that the code sends but nobody receives is a notification that does not exist.

6. **Verify the three key custodies by hand and record the evidence:** `bank/keys/swap-operator.json` (mode 600, in the nightly backup), `bank/keys/cbob-release.json` (mode 600, in the backup), `bank/keys/deploy-authority.json` (mode 600, in the backup). Confirm the backup restores to a scratch directory and the keys parse. AI cannot open a backup.

7. **At road step 11 (remove the upgrade authority), dump all five programs before and after `set-upgrade-authority --final`, confirm the prefix hash and zero tail match `dist/`'s sha256, and record the five signatures.** Then let the alarm run three passes and confirm `program_not_locked` is quiet.

8. **Read the holder guide aloud to a person who has never seen the project, and ask them to restate what they think happens when they open a vault.** If their answer differs from the code, the guide is wrong. This is the only test of the document that matters, and no model can perform it.