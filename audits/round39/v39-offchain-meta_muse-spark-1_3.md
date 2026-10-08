# Off-chain pass (R0–R6) — independent audit of the current tree

Audited tree: `21f36e1` (round-39 bundle commit). All line numbers below are that tree. No file was executed against mainnet; every “would exist” is a file, log line or assertion that a re-run can check.

## R0. Round 38’s verdict and its repairs

Round 38 off-chain was **NOT CLEAN, QUORUM MET** (6/8, no margin): C01 LOW, C02 INFO breaking cleanliness; C03/C04 INFO under the SPEC gate-3 documentation exception. `VALIDATION.md` in this bundle records all four as repaired.

Verified independently against this tree:

* **C01 — frozen-pool joins planned but never sent — REPAIRED, holds.** `bank/crank.mjs:503-541` batches claims only when `!pool.frozen`; `552-556` (the R38 repair) batches `plan.joins` as join-only claims when `poolOk && pool.frozen`. `plan.joins` is only filled when `plan.distribute` is set (`490-498`), and the tick branch (`470`) now runs from a frozen pool. The gate-5 arm `R38 C01` (`bank/selftest.mjs`, frozen pool, `claims[0]==['Rec0']`, `owed=={}`) asserts what `main()` sends (`plan.claims`, consumed at `759`), not `plan.joins`. The R37 arm it replaces asserted only `joins.length`. No regression: the unfrozen path is unchanged, paying pairs stay behind `!pool.frozen`, and `planCostLamports` counts `claims.length` so the join-only batch is budgeted.
* **C02 — `detectSweepState` JSDoc contradicted code — REPAIRED.** `bank/detectors.mjs:1025-1056` now says judged from `0`, half-cooldown window, first pass judges. SPEC `1320-1322` and the R32/R33 selftest arms follow the code.
* **C03 — SPEC “at either market read” — REPAIRED as text.** SPEC limit 10 now reads “at the read the swap is built from … the earlier read only decides whether to sweep at all (round 38 C03)”. `bank/revenue.mjs:287-291` (`m1`, sweep gate) vs `410` (`m2.venues` loop) and `bank/swap.mjs:407-422` confirm the text now describes the code. No `bank/` change, as the verdict required.
* **C04 — limit 7 omitted the daily `--reconcile` — REPAIRED as text.** SPEC `1129-1141` now names “the crank, the reveal lane, revenue, and the daily `--reconcile`; round 38 C04: the reconcile lane has no deadman, so its stall is silent, which costs only the daily undeclared-account report, never a payout”. `scripts/cron-install.sh:152` installs the reconcile lane with its own `flock -n`; `bank/alarm.mjs` writes `RECONCILE_STATE.at` and never reads it; the deadman (`153`) watches only `$ALARM_STATE`. The text is now true.

No surviving C01/C02 defect was found. The selftest is `926/926` (`FLOOR=926`), launch `49/49`, poster `24/24`, matching `scripts/run-tests.sh:DET_FLOOR/ALLOC_FLOOR/POSTER_FLOOR/LAUNCH_FLOOR`. Do not re-file C01–C04.

## R1. The crank (`bank/crank.mjs`)

No plan the program will refuse, no dead-vault payment, no out-of-order reveal was found. Checked:

* Reveal strictly from `revealed_total`, stops at first not-ready; `capturedThisPass` counts for its own reveal; `revealAttrSource` sends `[]` only for positively burned, `skip` for `other`; hash judged by `judgeRevealAttrs` before any fee.
* Retire at any level, never joins/pays a positively burned vault; only positively `live` joined/paid; eligible-but-unreadable blocks distribution with a `problems` entry (the `JoinWaitingFirst` exactness).
* Split only into live, unfrozen revenue source, pool and Squads destinations; frozen revenue/pool/Squads each name one problem and withhold the split and its counting toward `avail`.
* `retiringOwed` freed before `avail`; tick even from a frozen pool with joins batched join-only; `preExpires`/`postExpires` around distribution; `owed` asserted in sats (`plan.owed`).
* `judgeDistributeRefusal` benign only on epoch movement, `PoolShort` always fail; `budgetPlan` keeps the floor for reveals and still runs captures below it; per-lane streams with recovery; heartbeat carries failures/problems.

One residual, not a defect: a key below the floor still sends the base plan (deliberate, R30 L2, to prevent draw lapses). It drains further below the floor by design; the floor warning (`fee_floor` stream, once/day) is the control.

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

No quiet dangerous state and no routine-state pager was found. Checked both directions in `bank/selftest.mjs`:

* Fixed-forever drift (85/15, destinations, supply, census, charter, periods, notice, tighten bounds, boost mint/bounds, quorum/threshold/voting, collection hashes, PoB plugins/authority, five program authorities/hashes, third-party HIGHs), `test_value_in_production`, lock-deadline (earlier of file and `charter_opens_at`), `lock_deadline_unset`, `component_missing`, brakes (transition URGENT once, standing INFO), `swap_operator_armed`/`guardian_armed`, pool health/insolvency/availability, distribution overdue + `joins_stalled`/`boosts_stalled`/`launch_tick_overdue`, redemption capacity, unsplit clock restarting at last seen split, unswept royalties with cooldown-following grace, crank posture/silent/failing/problem, reveal stall, frozen transitions (once URGENT, then INFO), sweep state from `last_sweep_at` with symmetric half-cooldown window and direct-lookup `landed`, log gaps as a person-cleared level, backlogs draining with unproven-backlog CRITICAL, split anchoring by time+total+exclusion.
* `missingWatchedKeys`, `carryConfigBaseline`, `judgeReserveRead`, `alarmProduction` exact-`1`, per-kind labels ≤40 chars with URGENT one-shots and recoveries — all armed both ways, including against the live router in a throwaway state dir.

## R3. The layouts (`bank/layout.mjs`)

Holds. `STRUCTS` equals each `pub struct` field-for-field and type-for-type; every `OFF_*` the programs pin (GOV/BURN/MINT plus suite copies) equals `offsets()`; every `*_SEED` (11) equals the Rust constant; versions and `BOOST_RING=64` scraped; `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` scraped less padding equal `fixedLength`; `LEVEL_WEIGHTS`/`ACC_SCALE`/`REVEAL_WINDOW_SLOTS`/`readySlot` scraped (1000→1016, 1004→1020); `parseRustStruct` throws on private/`pub(crate)` lines; round-trip and every refusal (bool, version, discriminator, truncation, Vec credibility, owner pin, plugin-hash mint-invariance) armed. Round 24 D6’s missing SEEDS assertion now exists.

## R4. The money arithmetic (`bank/accrual.mjs`)

Holds. `credit` (`delta=avail*1e12/w`), `pendingScaled` (`(weight+boost)*acc+carry-debt`), `reweigh` (owed→carry, debt restarts), `ceilSats`, `available`, `debtAtActivation` are the Rust formulas line-for-line, in `BigInt`, with `weightOf` refusing 0/6/non-integer. The crank expires every DUE boost before distribution and every boost its distribution makes due right after; the alarm pages `boosts_stalled` and watches `cbob_mint`/`max_boost_weight`/`max_boost_epochs` as fixed-forever CRITICAL. The selftest asserts sats, not batch counts (R23 L4).

## R5. The swap (`bank/swap.mjs`) and revenue cycle (`bank/revenue.mjs`)

Re-verified repair-by-repair against the fork (`sim/swap-fork.sh`, `SWAP_FLOOR=16`):

* **(a) Oracle math.** `sats=lamports*sol*10^(es-eb)/(btc*10)`, floor `*9850/10000` rounded down. Exponent sign handled; `minSats<=0` refused. `satsPerLamport` is display-only. Live `sol≈1.2e10`, `btc≈8.6e12` fit exactly in `Number`; a future 100× price still fits — no overflow today. The 150 bps floor covers the 0.16% Orca fee plus royalty-size impact on both pools (10 SOL ≈0.01% on Orca ~$10M, ≈0.1% on Meteora ~$0.9M), proven by SW.1/SW.4/SW.8/SW.9 landing and SW.1b/SW.4b refusing +5%.
* **(b) Pyth.** Owner must be receiver, `level==1` (Full), feed id must match, age ≤180 s, future ≤30 s, confidence ≤30 bps per feed, all judged on the Clock sysvar (`clockUnixTimestamp` at byte 32, refused if unreadable). Offsets `40/41/73/81/89/93` recomputed correct for `PriceUpdateV2`. Addresses are the derived sponsored feeds (`pythAccount`), read by `market()` — ownership plus derivation is sufficient because only Wormhole-verified updates become Full, and a stale-but-Full update is refused by age. No box clock anywhere on this path.
* **(c) Deviation filter.** `orcaSpot=(sqrt/2^64)^2` (wSOL→cbBTC, A→B) and `meteoraSpot=1/(1+step/1e4)^id` (X in Y, inverted) are the right quantities in the right direction. `deviationBps` float error (~1e-12 relative) cannot move the 100 bps decision except within a hair of the line, which is the safe direction to be wrong in (a refusal, one fee).
* **(d) Minimum out.** The same `minSats` rides at bytes 16..24 in both venues’ `swap` data (Orca `other_amount_threshold`, Meteora `min_amount_out`), in cbBTC sats, asserted byte-equal in selftest and enforced on chain by the pool programs.
* **(e) Judge — INCOMPLETE, see finding F1 (LOW).**
* **(f) Derivation.** Orca tick starts `[s0,s0-span,s0-2*span]` for `a_to_b`, Meteora bin indexes `[i,i+1,i+2]` for Y→X, seeds (`tick_array`/pool/string-start; `bin_array`/pool/i64-LE) and order correct. At a boundary an uninitialised array refuses on chain — safe (falls to the other venue or a loud open cycle), never a misprice. `host_fee_in` as program-id None, bitmap present-or-program-id, event authority and two Token programs correct per IDLs.
* **(g) wSOL.** Wraps exactly `lamportsIn`, `SyncNative`, swaps, closes back to the operator. A pre-existing balance is not lost (it unwraps to the operator on close); a frozen wSOL ATA or a missing close authority refuses loudly before any swap. A delegate on the operator’s wSOL ATA needs the operator’s signature — box-owner trust, already stated in limit 10(3).
* **(h) Failure/retry.** Orca first; Meteora only on `refused` (preflight or landed-failed or expired-absent via `classifySendFailure` with `searchTransactionHistory:true`). `unknown` (timeout with no status, failed lookup, no signature) never tries another venue; it records `pendingSwapSig`+venue and stays open. Every path stays open until a proven cbBTC return and split (`cycleIsOpen`, `--audit`, alarm `cycle_unsplit`/`unreconciled_swap`).
* **(i) Tolerance bound.** Worst honest execution ≈1% (gate edge) +1.5% (floor) +0.3% (confidence) + age drift, ≈2.5–3% of a cycle. At 10 SOL/cycle (~$1,200) ≈$30/cycle; at ~34 SOL/day throughput ≈$1k–3k/month — immaterial against pool holdings, and the floor (not the gate) is what binds execution. Operator worst case remains cap×windows until `emergency_stop_sweep`, never vaults/pool/sale cbBTC; the ledger cannot read a refused sweep as closed (`sendRejected`+`refusedSig`, never `sweepSig`; `rejected_row_has_sweep`/`sweep_on_rejected_row`/`unledgered_sweep` cover a wrong refusal).

### F1 (LOW) — `judgeSwapInstructions` does not pin the pool-owned liquidity accounts

**Construct:** `bank/swap.mjs:judgeSwapInstructions`.
It pins programs, signer, seven-instruction shape, 400k CU with no price, both ATAs (operator/mint/payer), exact wrap amount/destination, `SyncNative`, swap amount/floor/direction/price-limit, pool name, input/output accounts and authority slot, and the single close. It does **not** pin Orca’s `vaultA`/`vaultB`, tick arrays `t0/t1/t2` or oracle, nor Meteora’s `reserveX`/`reserveY`, bin arrays, bitmap, oracle or `host_fee_in`.

**Gain:** none today beyond a loud failure — the venue programs validate their pool-owned accounts, and `revenue.mjs` throws if `delta<guaranteed` with the cycle open. It is defense-in-depth, not a bypass: a tampered builder that swaps a vault or tick/bin array past the judge still faces the pool program and the post-swap delta check.

**Evidence if true:** take the honest `swapInstructions` output for either venue, replace `ixs[5].keys[4]` (Orca vaultA) or any tick/bin array key with another valid pubkey, call `judgeSwapInstructions` with the true `{lamportsIn,minSats}` — it returns `[]`. The L1 tamper table (eight tampers) stays green because none mutates those keys.

**Fix:** re-derive each venue’s vaults/reserves, tick/bin arrays, oracle/bitmap from the `w`/`p` the swap was built with and require exact keys; pin Meteora `host_fee_in` to the program id. Add the two mutated-key arms to the L1 table (they must be red).

### F2 (INFO) — no arm pins the Orca fee rate the tolerance assumes

**Construct:** `bank/swap.mjs:readWhirlpool` reads `feeRate` but `market()`/`oracleFloor` never checks it. The 150 bps floor assumes ~16 bps fees. A pool upgrade that raises the fee 10× still passes the 100 bps deviation gate and then refuses on chain (floor breach) — safe but loud, every hour, until a human notices.

**Evidence:** set `feeRate` to 2000 bps in a stub pool with spot at oracle; `market()` lists the venue usable.

**Fix:** refuse (or page) a pinned pool whose `feeRate` exceeds the assumed bound; or state the assumption in SPEC limit 10.

## R6. The gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

Holds. Floors must EQUAL counts (`926/49/39/24/14/49/33/4/16`), every SPEC occurrence checked, second-occurrence poisoning armed, `audit-coverage.sh --selftest 14/14`, router arms against the real router in a throwaway dir, `build-mainnet.sh` proves all four keyed programs by behaviour plus sweep byte-identity with `dist/` and `target/deploy/`, `cron-install.sh` installs exactly six tagged jobs with `flock -n` and preserves only tagged uncommented `--live`. The round-24 section is armed both ways; the one arm that could not fail (R37 ack arms driving the now-unackable `nested_vault`) was re-pointed at `unredeemable_owner` (R37 C01) and each guard (empty-`why`, `true`, kind-vs-asset) is shown red by mutation.

`web/test/` (carried in this bundle): each file’s assertions were checked for vacuity — `diffIx`/`messageBytes` controls catch a flipped flag/byte/account; `plan.test.mjs` V38-1/V38-2 press arms assert late-not-delivered plus known-still-moved (not counts); `proxy.test.mjs` refuses 40+ broader shapes and accepts the eight captured page shapes; `ceremony.test.mjs` B4/V2 decoy arms assert adopted/ignored/conflict triples; `e2e-localnet` lands a stranger-raced opening. No ack-style vacuous arm remains.

## The four accepted-limit questions

1. **Worse than stated?** No. C03/C04 are now text-accurate. Limit 28’s “(the crank sends join-only batches)” is now true for the frozen-pool tick (R38 repair). Limit 10’s throughput (“about 34 SOL/day”), dust, hand-recovery, box-owner residue and third-party keys remain as stated.
2. **Listed as a limit but not a limit / already closed?** No new closure. Limit 7’s reconcile sentence now correctly says silent; it does not claim a watch that exists.
3. **DISCHARGED not actually discharged?** No. Items 1a–24 went with the Bank/deck/distributor, which remain deleted; 12/17, 14, 19, 30/31/33, 51, 54 remain measured-closed with suite arms.
4. **OPEN AND BLOCKING quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 stay OPEN; `launch/mainnet-init.json` keeps `charter_opens_at`, `lock_deadline`, `vault_collection` OPEN with the checker refusing; the holder guide stays DRAFT-gated by item 50.

## Anything else

No CRITICAL, HIGH or MEDIUM. F1 (LOW) and F2 (INFO) above are the only new findings. They do not break the gate-3 clean streak (documentation/behavioural LOW/INFO, no holder-money/rights/program-behaviour misstatement), but they are code-adjacent recommendations, not text fixes.

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what AI audit structurally cannot do before launch

1. **Run the dress rehearsal (item 22 + item 53).** No assertion proves the crank’s I/O against 2,100 live vaults, the alarm’s live passes in rehearsal mode, one full revenue cycle through each pool with the ledger closed and `--audit` clean, one forced post-sweep failure walked through hand recovery, or the DAS-burnt read. Do road step 8 at throwaway ids with small real amounts and record every signature. Do not lock before it.
2. **Verify the ceremony by hand, twice.** `check-launch-params.mjs` judges JSON, not the four signed `initialize` transactions. Two people must build those transactions FROM `launch/mainnet-init.json`, compare every field, and confirm the vault collection, pool/Squads/revenue ATAs and revenue rent funding (item 52) before signing. Then remove all five upgrade authorities and re-dump prefix-hash + zero-tail.
3. **Take custody off this box.** The swap-operator key, the $CBOB release wallet (2.1B), the deploy authority (until step 11) and the PoB hot wallet are all single-machine secrets. Move the release supply to Gary’s wallet or a Squads and delete the box key; fund the operator float above 0.02 SOL with a top-up procedure; keep the PoB key cold except through the 7-day window or accept item 46 in writing.
4. **Drill the alert path end-to-end.** AI can run the router in a scratch dir; it cannot prove Gary’s phone receives `cbob-vault-alarm:<kind>`, `cbob-vault-crank:*` and `cbob-revenue:*` pages, that a rehearsal never mutes production (`ALERT_STATE_DIR`/`ALERT_LOG` isolation), or that a human clears `log-gaps-reviewed` and prunes `seenSplits`. Send one of each, recover each, and time the guardian stop.
5. **Publish the pages before promising them (item 50).** The redeem page (coverage + sweep helper + prior-transaction + packet + compute limit), deposit-address page, claim/buy pages, metadata generator + `/rpc` proxy, and the poster sender decision are all OPEN. The guide may not publish before they ship. Walk one real charter claim and one real redemption through the staged pages on the rehearsal deployment.
6. **Reproduce the build on a second machine.** `build-mainnet.sh`’s source check plus sha256 is the whole bridge for `INIT_AUTHORITY`. Rebuild `dist/` from the release commit elsewhere and compare all five hashes before deploying.