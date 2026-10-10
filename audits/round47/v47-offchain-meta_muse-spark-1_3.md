Order is by target, then the four accepted-limits questions, then other. Severity is true severity; launch-gate class (a)-(d) is stated per confirmed finding.

No CRITICAL confirmed. One MEDIUM, three LOW, two INFO confirmed. All measurements are described so they can be re-run.

---

## R0. Round 46 verdict and its repairs, and everything after it

Round 46 off-chain verdict (`audits/round46/VERDICT-offchain.md`) was LAUNCH-CLEAN 6/8, REQUIRES CHANGES V46o-1..V46o-5, V46-7, V46-8. Programs verdict LAUNCH-CLEAN 6/8, V46-1..V46-8. Product tree at `63a92b2` equalled `e7c192a` outside `audits/`. This tree is `487a8b4` plus the stripped-build, README, core-watch and batch-B changes listed in VALIDATION.md. Five programs equal `0b3ddb3` in source, bytes now stripped at `d2ae5fc`.

Verified in this tree:

* **V46o-1 repaired.** `bank/selftest.mjs` now drives `unredeemable_owner` asset-less with a well-formed ack keyed `unredeemable_owner:undefined` and asserts CRITICAL, no `acked`. The old `scan_gap`-with-`'x'` arm is kept beside it with `ackRefused==false`. Removing `if (!f.asset||!f.kind) return f` in `detectors.mjs:1118` turns the new arm red and leaves the old green, as V46o-1 required.
* **V46o-2 repaired.** `bank/alarm.mjs` `!delivered` block now has `next.unreadPasses = prev?.unreadPasses ?? {}` and `next.unreadSkips = prev?.unreadSkips ?? []` alongside cursors/backlogs. `logGaps`/`seenSplits`/`seenSweeps` are still written un-rolled-back; they re-observe on re-scan and state no false skip.
* **V46o-3 repaired.** `bank/rehearsal-env.mjs:refuseStrayOverridesAtLoad` pages once through the literal `/opt/scripts/notify-gary-sms.sh` on the job's own stream, writes its marker, exits 3. `bank/revenue.mjs:58-66` and `bank/alarm.mjs:64-65` call it before any `rehearsalOnly` read. Crank refuses inside `main()` and pages from its own path. Source order checked.
* **V46o-4 repaired.** `web/test/ceremony.test.mjs:167,174` read `web/test/fixtures/placeholder/{cbob_placeholder.so,src/lib.rs}`. Test pins 20,920 bytes, sha256 `94f75099…`, source `Custom(0)` + `CBOB placeholder`, and `SHA256SUMS`. No `.cache` read remains.
* **V46-5, V46-6, V46-8 in `rehearsal-run.mjs` as bundled.** `initKeyFor`, `judgeInitAccount`, `judgeCeremonyMode`, `judgePageUrl`, `judgeValuesFresh`, `recheckAction`, `judgeUpgradeTarget` present and armed in selftest. `sendWithInit` refuses on mainnet/page before building.
* **Batch B present.** `web/src/lib/my-vaults.mjs` (other pass) exercised by `web/test/mine.test.mjs` here; `getTokenAccountsByOwner` per program; wallet-edit judge + own compute budget; `scripts/core-watch.mjs` + `core-watch-suite.sh`; `README.md` + `scripts/readme-facts.mjs`; strip via `scripts/sbf-strip.sh`; `RELEASE_COMMIT=d2ae5fc`.

Not verifiable in this pass, by its own file list: `scripts/rehearsal-steps.mjs`, `rehearsal-recover.mjs`, `rehearsal-refresh.mjs`, `web/src/config.js`, `web/src/lib/*`, `web/deploy/rpc-proxy.mjs`, `web/gen-errors.mjs`, `web/meta/generate.mjs` are explicitly **not carried**. Any claim turning on them is a claim about a file not given. That includes V46-1 (multi-send resumable), V46-2 (re-fill before step 10), V46-3 (nest recorded), V46-4 (hand recovery after landed swap), the refresh key-preservation, and the page/relay judges. The selftest arms them, but the arms run code this pass did not receive. V46o-5 (“instrument computes what each pass carries”) is also not carried: `scripts/audit47.ts` is not in the tree given.

### New code audited here

`scripts/core-watch.mjs`, `scripts/core-watch-suite.sh`, `scripts/readme-facts.mjs`, `scripts/sbf-strip.sh`, `README.md`, `web/test/mine.test.mjs`, `audits/rehearsal-2026-10-09/RECORD.md` audited whole. `.github/workflows/verifiable-build.yml` is **not carried**; no claim about it is made.

**Finding R0-1 / LOW — `scripts/core-watch.mjs` never runs: no cron installs it.** Class: none — fixable tooling, no value path, no crack.

Construct: the file header says “every run (cron, every 10 minutes)”. `scripts/cron-install.sh` installs exactly six jobs (`watcher, crank, crank-reveal, revenue, reconcile, deadman`, `:148-151`, asserted in selftest). No line mentions `core-watch`. `grep -r core-watch scripts/cron-install.sh` is empty.

Gain: none directly. Cost: the “runs the whole suite against the new Core as soon as the validator is free” half of the Core story never happens unless a human runs it. Detection still rests on the alarm’s `prog.core.hash` drift, which is level/CRITICAL and does run. So a Core upgrade pages, but the diagnostic suite the watch promises does not start.

Evidence if true: `crontab -l | grep core-watch` empty on a box installed by this script; `.cache/core-watch/suite-*.json` never appears after a Core change while alarm `config_drift prog.core.hash` does.

Fix: install it in `cron-install.sh` under its own `flock -n` lock with its own tag, or delete the “cron, every 10 minutes” claim and state it is run by hand. Add a selftest arm that the installer’s six-plus-one list contains it.

**Finding R0-2 / INFO — `core-watch-suite.sh` shares `.cache` with the certifying runner without a shared lock.** Class: none.

Construct: it swaps `.cache/core-mainnet.so` for the new bytes while holding `.cache/VALIDATOR.lock` and `pgrep` absence. `scripts/run-tests.sh` never checks that lock; it kills whoever holds the ports and boots with whatever `.cache/core-mainnet.so` holds, then refuses because the hash is not the pin. A concurrent certifying run therefore dies spuriously after every gate passed, rather than waiting. No corruption: the pin check fails closed. Fix: make `run-tests.sh` wait on the same lock file, or document that the watch suite and a certifying run must not overlap.

## R1. The crank

`planCrank`, `budgetPlan`, `judgeFeePayer`, `BENIGN`/`DISTRIBUTE_RACE`, `planRescues`, `revealAttrSource`, `splitDecimalsByte`, `clockUnixTimestamp`, send order retire→join→expire→split→distribute→expire→activate→claim, heartbeat with failures+problems, per-lane streams. Re-checked against MINT gates `JoinWaitingFirst`, `BoostsExpireFirst`, `NothingToSplit`, frozen-pool tick (R37 C02) and join-only batches (R38 C01).

No defect that sends a plan the program refuses, pays/joins a dead vault, reveals out of order, or moves value off-program was found. The frozen-pool paths batch `preJoins` separately and `joins` only when `distribute` (tick) is true; `[]` only for positively burned reveals; split only into live unfrozen pool+Squads; `retiringOwed` freed before `available`; `postExpires` only when this pass distributes.

One residual is as stated: `detectCrankHealth`’s frozen-pool cover matches two exact strings; a mixed pool+Squads blocker does not match and stays visible. That is the loud direction.

## R2. The alarm

`detectConfigDrift` + `carryConfigBaseline`, `detectStandingRisks` production list, `detectSweepState` half-cooldown symmetric window with direct-lookup `landed`, `detectLogGaps`/`detectUnreadSkips` never-evict-unreviewed, `carryUnreadPasses`, `detectCrankPosture`/`detectCrankSilent`/`detectCrankHealth`, `detectRevenueAccount`/`detectUnsplitRevenue`, `detectUnsweptRoyalties`, `detectPoolHealth`, `detectRedemptionRate`, `detectRevealStall`, `detectBrakeTransitions`, `detectUpgradeAuthorityAfterLock`, `applyFrozenTransitions`, `alarmProduction`, `planAlarmNotices` per-kind streams.

No dangerous-quiet state and no routine-state-every-pass page found. `missingWatchedKeys` correctly exempts only `prog.<p>._missing` for that program; `THIRD_PARTY_KEYS` baseline rule holds; `sweep_unledgered_state` judges from 0 with `|t-start|<=cooldown/2` and smallest-seen cooldown; `poolFrozen` overdue text (V45o-3) names the freeze and offers no hand run.

## R3. The layouts

`bank/layout.mjs` field lists equal `pub struct` for all five structs; `parseRustStruct` throws on private/`pub(crate)`/multi-line; every `OFF_*` scraped from GOV/BURN/MINT compared, none scraped-and-ignored (L2 arm); `LEVEL_WEIGHTS`/`ACC_SCALE`/`REVEAL_WINDOW_SLOTS`/`readySlot(1000,1003,1004)=1016,1016,1020` scraped; 12/12 seeds equal (D6 now real); versions equal in every copy; `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` evaluated less padding equal `fixedLength`; `BOOST_RING=64`; suite `OFF_*` in `tests/3prog.test.ts` equal; `attrsHash` pinned vector `34bea1c8…`; collection plugin hash blind to counters. Round 24 D6 closed.

## R4. The money arithmetic

`bank/accrual.mjs` `credit`/`pendingScaled`/`pendingSats`/`reweigh`/`debtAtActivation`/`ceilSats`/`available` match MINT `credit`/`owed_of`/`reweigh`/`ceil_sats`/`join`. Crank expires due boosts before and newly-due after; alarm `boosts_stalled` + `cbob_mint`/`max_boost_weight`/`max_boost_epochs` as fixed-forever; `owed` asserted in sats (L4). No divergence found.

## R5. The swap and the revenue cycle

**(a) Oracle math holds.** `oracleFloor` exponent branch is `lamports*sol*10^e/(btc*10)` for `e=sol.expo-btc.expo`, floor `*9850/10000` floored, `minSats<=0` refused. `satsPerLamport` `Number` conversion is exact at live magnitudes (1.2e10, 8.5e12 < 2^53). Floor is below honest pool net of Orca 16 bps + royalty-size impact on both venues (fork SW.8/SW.9 18–20 bps under oracle).

**(b) Pyth verification as stated, trusted as stated.** Owner==receiver, `level==1` Full only, feed id, expo `-18..0`, 180 s age + 30 s future against Chain Clock at byte 32, 30 bps confidence per feed. Ownership+derivation+Full is the trust accepted in limit 10(d); no new bypass shown. Clock owner checked, unreadable refused.

**(c) Deviation filter holds.** `orcaSpot=(sqrt/2^64)^2` sats/lamport for wSOL→cbBTC; `meteoraSpot=1/(1+bin_step/1e4)^active_id` for cbBTC/wSOL reversed. `deviationBps` double error ~1e-14 relative, cannot pass a pool 101 bps off as 99.

**(d) Minimum out holds.** Orca bytes 16..24 `other_amount_threshold`, Meteora bytes 16..24 `min_amount_out`, both the same `minSats` in cbBTC sats. Pinned by hand (R40 C02: 280,355→276,149).

**(e) The judge is incomplete — see finding.**

**(f) Derivation holds except as in finding.** Orca tick starts `[s0,s0-span,s0-2span]`, oracle PDA, vaults from pool; Meteora bin indexes `[i,i+1,i+2]` for Y→X, bitmap-or-program-id, `host_fee_in` None, event authority, two token programs. Boundary starts correct; uninitialised array refuses on chain (loud, no theft).

**(g) wSOL handling holds.** Wrap exactly `lamportsIn`, sync, swap exact-input, close to operator. Pre-existing balance only adds to close; frozen refuses loudly; delegate needs operator; leftover impossible on exact-input.

**(h) Failure/retry holds.** Orca first; Meteora only on `refused` (preflight/on-chain-err/expired-absent), never on `unknown`. `classifySendFailure` via `getSignatureStatuses(searchTransactionHistory:true)`. Landed recorded; unknown stays open with `pending*Sig`. Ledger stays open until `returnedSats`+split proven.

**(i) Within-tolerance bound.** 100 bps gate + 150 bps floor ≈ up to ~250 bps under oracle if pool sits at gate edge, plus 30 bps confidence and 180 s staleness. At 10 SOL (~$1,200) ≈ $3–$15/cycle; at 40 SOL/day ≈ $100–600/day while a pool is held at the edge. Sandwich cannot breach the on-chain floor; it can only force a refusal. Cycle size makes it nuisance, not ruin, and every landing is delta-checked (`delta<guaranteed` throws, cycle stays open).

**Finding R5-1 / MEDIUM — `judgeSwapInstructions` does not pin Meteora `host_fee_in` (or any non-value key), so a builder defect that pays a host fee passes the last line before signing.** Class: **(b)** — a path that miscredits royalty value; small, bounded, but a value path. Also (d) by severity.

Construct: `bank/swap.mjs:meteoraSwapIx` sets key 9 `host_fee_in` to `METEORA.program` (None). `judgeSwapInstructions` checks programs, signers, length 7, pool/input/output/signer, amount/threshold/direction, budget, two ATAs, wrap, sync, close — never keys 1–4,6–9,11+. Changing key 9 to any non-signer token account keeps length 7, keeps every checked key, keeps data, so `judgeSwapInstructions` still returns `[]`.

Gain: host-fee share of the swap to the named account. Meteora host fee is a cut of the protocol fee (order 10% of ~25 bps ≈ single bps). At 10 SOL it is ~0.001–0.01 SOL, well inside the 150 bps floor, so `revenue.mjs`’s `delta<guaranteed` does **not** catch it and the cycle closes. Repeated every cycle until noticed.

Evidence if true: build honest Meteora ixs via `swapInstructions`, replace `ixs[5].keys[9].pubkey` with a stranger’s wSOL/cbBTC account, run `judgeSwapInstructions(ixs,owner,'meteora',{lamportsIn,minSats})` → `[]`; land it on the fork → operator delta short by the host fee but `>=minSats`, cycle closed.

Fix: require Meteora key 9 `equals(METEORA.program)` non-writable non-signer; require bitmap key 1 equals `mPda('bitmap')` iff `bitmapExists` else program id; require reserves/mints/oracle/token-programs/event-authority/program-id and three bin arrays equal the derived values passed in (`p`, `bitmapExists`). Thread `p`+`bitmapExists` into the judge (already threaded into the builder) and assert equality. Show red without it (mutate key 9, judge must name it) and green with it. Same-shape audit for Orca vaults/ticks/oracle (DoS-only today, but pin them so a future fee-bearing upgrade cannot hide there).

Note: limit 10 already states the judge catches *our* defects, never a box-owner tamper. This is an *our-defect* miss: a wrong `opt()` in the builder would ship a fee-paying swap the judge was built to stop.

Operator worst case restated correctly: cap × windows until `emergency_stop_sweep`, bounded also by revenue balance above reserve; trusts two pool programs + oracle + one RPC + this tree’s integrity + third-party upgrade keys (watched at HIGH). Ledger cannot read a failed cycle closed: `cycleIsOpen` needs `splitSig||splitByOther` after a non-zero return; `closesCycle` anchored on `returnBlockTime` else legacy slack; `split_claim_unanchored`/`split_by_other_unanchored` enforce size+time+exclusion.

## R6. The gates

* `bank/selftest.mjs` FLOOR 1072 equality, `run-tests.sh` floors equality, `web/test/run-all.mjs` 801 equality across 11 files, `sim/swap-fork.sh` 16, `tests/expiry-budget.mjs` 4, launch 69, host 6, mainnet 35 — all equality, all move-with-suite. No deletable-work floor found. Round-24 both-directions claim holds on sampled arms; L1/L2/L4/I1/I2/I4/H1/router arms drive real code.
* `scripts/build-mainnet.sh` proves all five including sweep: stripped `dist/` 5/5, sweep mainnet==localnet==`target/deploy`, four programs reject test key while localnet accepts, source names Gary’s key, dirty-tree refused. Holds.
* `scripts/cron-install.sh` installs exactly six jobs, `flock -n`, revenue/crank opt-in preserved only from tagged uncommented `--live`, rehearsal tree refused, posture print computed. Arms nothing it should not.

**`web/test/` — each file can fail when its property breaks:**

* `bundle`: browser bundle builds, no node imports, `judgeLaunch`/layout/`planRedemption` byte-identical to node on six snapshots (C03, `>200` chars), dist static (one script, CSP, SRI, no dash, no leak). Honest-pass + tamper arms.
* `ceremony`: gate refuses today, `launchWithCollection` only touches collection, seven steps as Phantom returns them pass page+relay, additions-alone/stranger-ride refused, collection/decoy/creator arms, V44-7 `stepVerdict`. Both directions.
* `decode`: page readers vs `mpl-core`/`spl-token` official deserializers, burned/truncated/unknown-plugin/program-data arms.
* `ids`: config==layout==`declare_id!`==keypairs, seeds, suite derivations, `findAssetSignerPda`/ATA/ProgramData, `programBytes==dist` + control mutation, `RELEASE_COMMIT=d2ae5fc`.
* `meta`: list-fail FATAL, three files+collection, numbering, L4 never-older/never-undraw/never-zero/never-back, V40-3 dust==absent.
* `plan`: whole-message S8 1,061 bytes equality, prior/pool-frozen/stray/C5/H1/grouped/rate/rescue/payout/press-consent arms, V40-1 dust via mock RPC. Both directions throughout.
* `tx`: honest accept, adder/forger refused, R47 Phantom wrap accept + 15 refusal shapes + own-budget/fee caps + `buildForWallet` re-sim, R46 lagging-node bounded resend, errors table current.
* `mine` (new): chain+DAS every-lie-lists-nothing, relay shapes, pick-list wording, paste box kept. Each lie has its own `nothing listed` arm; honest two-list arm guards vacuity.
* `run-all`: builds then holds each file to its exact floor; missing file or short count fails.

No vacuous ack-style arm found; V46o-1 class is closed by the new `unredeemable_owner:undefined` arm.

---

## The four accepted-limits questions

1. **Worse than stated?** No limit found exploitable beyond its text, except R5-1 which is *not* a listed limit: the judge’s completeness was claimed in code comments, not carried as a limit. Limits 10 (extraction = cap×windows, confidence not a hard bound), 25/26 (re-roll + grind), 27 (dead-share cost on others, R38 V38-4), 28 (freeze forfeit), 32 (cap + transfers unlimited), 40 (Core heap/autograph boundary as bounded observation), 44 (Token-2022/frozen/close-authority/nested gaps), 46 (hot-key end/capture), 47 (stop until half vote), 55 (unsplit edge ~hour), 58 (rescue window + Squads custody), 59 (fund-the-address grief costs griefer more) all read true of the code.

2. **Listed but not a limit / already closed?** None found closed without being moved to DISCHARGED. D6 seed assertion now exists; 12/17 compute now measured; 19 unlevelled-halt closed by construction — all already in DISCHARGED.

3. **DISCHARGED not discharged?** No. Bank/co-signer/deck/distributor family gone with the code; 51 boost, 54 compute, 12/17 compute all measured.

4. **OPEN treated as accepted?** Yes — two process items:

* **Item 22.2 recorded FAIL but road step 8 reads “done”.** `audits/rehearsal-2026-10-09/RECORD.md` marks 22.2 FAIL (pass 2 raised true `prog.core.hash` drift + `watchdog_gap` after the real 2026-10-09 Core upgrade). SPEC road step 8 reads “done on mainnet 2026-10-09 to 10-10”. The record correctly refuses to edit the driver’s FAIL, and proves live detection within one pass, but it does **not** prove “a pass 2 with nothing to report”, which no live pass after that Core change could produce without re-baselining. Treating the road as done without a clean re-baselined pass 2 (or an explicit ruling that true-detection FAIL satisfies 22.2) quietly demotes OPEN to accepted. **LOW (docs/process), outside (a)-(d).** Fix: either re-run pass 2 re-baselined to the new Core and record PASS, or rule in SPEC that a true-detection FAIL satisfies 22.2 and why.

* **Item 53 stale again at the stripped commit.** SPEC `:2197-2202` still cites `d57ee3a` stale / `e7c192a` re-proof (V46-7). `RELEASE_COMMIT` is now `d2ae5fc` (same source, stripped bytes). The rehearsal-tree full-suite re-proof has not been recorded at `d2ae5fc`. Source-equal is not byte-equal for the “ids are the whole patch” proof once stripping changes every byte. **INFO, outside (a)-(d).** Fix: re-run the recorded rehearsal-tree suite at `d2ae5fc` and cite it, or state why source-equality suffices.

Items 22 (scale: PASS at 5 only), 38 (dates/collection OPEN), 50 (pages staged not published; guide DRAFT), 52 (pool/Squads/revenue funding at step 10) are still stated OPEN and not demoted.

---

## Other

No other confirmed defect. `bank/txread.mjs` v1/flag/gap/backlog arms hold; `bank/spl.mjs`/`anchor.mjs` dust==absent (R42 A1-A3) holds; `bank/lock.mjs` generations-only-up holds; `bank/sigwalk.mjs` resumable backlog holds; `scripts/check-launch-params.mjs` + `--rehearsal` by-genesis init key holds; `launch/mainnet-init.json` still OPEN on three keys (correctly refused).

## GIVEN NO HUMAN FIRM WILL EVER SEE THIS AND PROGRAMS WILL BE IMMUTABLE, what AI audit structurally cannot do before launch

1. **Run the rehearsal to its written end on mainnet and keep the record honest.** AI can read `RECORD.md`; it cannot wait out Gary signing, a Core upgrade mid-run, or a lagging RPC, nor refuse to edit a FAIL into a PASS. Require: re-baselined alarm pass 2 at the current Core with no unexplained CRITICAL, recorded with signatures, before step 9. Do not launch on a FAIL-even-if-true.

2. **Prove the stripped bytes on someone else’s machine.** AI can compare hashes in this tree; it cannot run GitHub’s container, `solana-verify`, or OtterSec remote verification. Require: `verify-<d2ae5fc>` workflow green (container==per-program rebuild==audited hashes), plus `solana program dump` prefix-hash + zero-tail on mainnet for all five after step 9, plus remote-verified shown, before step 11. The workflow file itself must be audited — it was not in this bundle.

3. **Close the driver gap the bundles keep recreating.** Every round splits `rehearsal-run/steps/recover/refresh`, `web/src`, and the workflow out of one pass. AI in one pass cannot verify what it was not given. Require: one pre-launch instrument run that computes each pass’s file list from imports (V46o-5’s fix) and proves every module imported is carried, or names the gap in R0. Refuse a quorum on a split bundle.

4. **Exercise scale and liveness, not just logic.** 912 + 1072 + 801 + 71 + 16 assertions never sent 2,100 reveals/claims, never ran crank/alarm/revenue for a week against a live cluster, never delivered an X post. Require: a 5-vault rehearsal is not scale proof — record “PASS at 5 (scale not exercised)” as a limit (already done) and cap initial supply/round size so the first real month is the scale test, with `distribution_overdue`/`crank_silent`/`royalties_unswept` paged to a human who must act.

5. **Hold the hot keys and the hot wallet.** AI can pin `swap_operator`, `AT2qf412…`, deploy authority, and the Moments update authority; it cannot keep them. Require before step 11: operator wallet holds only cycle funds + 0.02 float; release wallet moved off the box or Gary signs the custody; deploy authority on box + encrypted offsite with tested restore; Moments key cold or multisig through the charter window or explicit acceptance that one key can end/capture the project. Alarm watches detect; they do not prevent.

6. **Publish what the guide promises.** AI can assert the redeem/vault/claim/buy pages, `judgeRedemptionCoverage`, sweep helper call, `/rpc` proxy, and metadata job are “built and staged”. Holders cannot use staged code. Require road step 11 precondition literally: redeem page live, coverage before signing, helper locked with the four, deposit-address page live, X/website announcement path live (poster has no sender today). Do not publish the DRAFT guide before then.