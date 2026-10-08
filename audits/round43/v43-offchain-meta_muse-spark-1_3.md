# Off-chain pass — independent audit of the final tree

**Tree:** `4a67d00` + round-42 repairs (`79b4076`, `f350e1d`, `542bd3f`). Scope-frozen.
**Verdict on this tree: CLEAN — QUORUM MET (independent). No CRITICAL / HIGH / MEDIUM. No value path. No holder-crack block. No program finding.**

Round 42 off-chain was NOT CLEAN on one LOW (C01). That repair is verified below at all sites of its shape. All round-41 repairs and R42 A1-A3 dust arms still hold. No surviving defect was found by measurement or by source.

Evidence rule followed throughout: every rejected claim names what a run would show if it were true.

---

## R0. Round 42's verdict and every repair

### C01 (LOW) — REPAIRED, VERIFIED, RED UNDER MUTATION

**Construct:** `bank/alarm.mjs` balance baseline vs `detectVaultSetChange.trustCurrent`.

Round-42 claim: after a `vault_index_shrank` pass the alarm stored `next.balances` only for the short DAS list, so a fall in an omitted vault was never compared and became the new baseline permanently.

**Repair in this tree — holds:**
- `alarm.mjs` ~543: `judged = setChange.trustCurrent ? vaults : [...new Set([...vaults, ...(prev?.vaults||[]).filter(v=>!burntSet.has(v))])]`
- `legs` built from `judged`, `pdaOf` backfilled for stored vaults, `balances` filled from those legs, `detectBalanceDrops(prev?.balances, balances)` compared.
- Undelivered branch keeps `prev.balances`; delivered branch now keeps stored vaults.
- `bank/selftest.mjs` R42 C01 arms extract the whole balance block and run full → shrunk → full-with-fall: omitted-vault fall pages `reserve_fell`; fall during shrunk pass pages in that pass. VALIDATION records both arms red with `for (const v of vaults)` restored.

I re-ran the logic shape: shrink-then-fall gives `[]` on the old code, `reserve_fell:V5` on this code. No regression: short-list vaults still compare, `vault_index_shrank` still CRITICAL, `vaults` carry line (`setChange.trustCurrent ? vaults : prev.vaults`) unchanged.

**No re-file.** No surviving defect.

### Round-41 C01/C02/C04/C06, R42 A1-A3, C06/C08/C09/C10/C12/C13/V42-1/V42-2 — HOLD

- `draftKey` per-redemption (`redemption-poster.mjs`), R41 C02 180s literals (`swap.mjs` `MAX_ORACLE_AGE_SECS`, `oracleFloor`), R41 C04 level-0 refusal, R41 C06 `MIN_SWEEP_LAMPORTS` literal, R42 A1 `isSystemDust`, A2/A3 dust-as-absent (`spl.mjs`, `anchor.mjs`), C06 `PYTH_EXPO_MIN/MAX` in `readPyth` + `oracleFloor`, C08 fee labels derived from `crank.mjs` template, C09 `OPERATOR_FLOOR` read from source, C10 `git diff RELEASE_COMMIT -- programs Cargo.toml Cargo.lock` in `run-tests.sh`, C12 `checkNewAddress` call sites, C13 inline-capture reveal, V42-1 `staticFile`/`localListener`, V42-2 oldest-successful-create.
- Floors equal counts: `DET_FLOOR=945`, `ALLOC 39`, `POSTER 24`, `LAUNCH 49`, `MAINNET 33`, `EXPIRY 4`, `SWAP 16`, `WEB 682`, `E2E 132`. A deleted assertion fails the build; an exit-code-only pass does not satisfy a floor.

**Gate-3 (a)-(d):** no confirmed program finding, no value path, no crack block, no HIGH/MEDIUM. Round-41 C03 exception condition remains met (SPEC crank sentence matches `budgetPlan`).

---

## R1. The crank (`bank/crank.mjs`)

**No plan the program refuses, no dead-vault pay/join, no out-of-order reveal, no value move.**

- Order sent is reschedule → capture → reveal → retire → pre-join → pre-expire → split → distribute → post-expire → activate → claim. Matches red-team-3 order; `MonthNotElapsed` on own distribute is not sent as `run()`, stranger `NothingToSplit` is `BENIGN`, refused distribute is re-judged by `judgeDistributeRefusal` against a fresh config read (`PoolShort` never benign).
- Reveal strictly from `revealed_total`, stops at first not-ready; capture-this-pass counts as ready; `[]` only for positively `burned`, `skip` (break, no send) for `other`/null. Hash checked by `judgeRevealAttrs` before a fee is spent.
- Only positively `live` joined/paid; `burned` waiting vaults retired, never joined; burned active never paid. Eligible-but-unreadable blocks distribution (`JoinWaitingFirst`) and pages.
- `retiringOwed` freed before `available`; `w` counts `+preJoin -retiring -expiring`; expired-then-paid math uses `pendingScaled` + level-weight delta — equals MINT `owed_of`/`reweigh`.
- Split needs live unfrozen revenue + pool + Squads, correct decimals byte or refusal; frozen pool still ticks + join-only batches (R37 C02/R38 C01: `plan.claims` carries them, sender sends `plan.claims`).
- Fee payer: refused only below base-plan cost, budgeted reveals keep `FEE_FLOOR`, over-ceiling runs + warns once/day per kind. Key signs fee-payer only; instruction set is `activate/capture_entropy/claim/distribute/expire_boosts/reschedule_reveal/retire_burned/reveal_level/split_revenue`, no SPL/System transfer built, free `distribute(false)` only.
- If this were wrong, the suite/selftest arms (L1-L6, I1/I2, H1, R30 L2, R39 C01 send-order extraction) would fail. They pass.

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

**No dangerous quiet, no routine page.**

- Fixed-forever drift (85/15, destinations, supply, census, charter, periods, notice, tighten bounds, boost mint/bounds, GOV numbers), pending guardian/operator, brakes (transition once URGENT, standing INFO), `vault_index_shrank` vs `vault_burned`, pool frozen/short/unreadable, `distribution_overdue` + `joins_stalled`/`boosts_stalled`/`launch_tick_overdue`, `redemptions_near_cap` (idle window quiet), `reveal_queue_stalled`, `revenue_unsplit` (clock restarts at last seen split), `royalties_unswept` (cooldown-aware grace, fall restarts), `crank_silent`/`crank_posture_unreadable`/`crank_failing`/`crank_problem`, PoB plugins + update authority, five program upgrade authorities + bytes (sweep included), third-party HIGH drift, `test_value_in_production` + lock deadline (`lockDeadlineOf`).
- `missingWatchedKeys`, `carryConfigBaseline`, `judgeReserveRead`, `applyFrozenTransitions`, per-kind streams + URGENT one-shots + recoveries, resumable backlogs with unproven-backlog CRITICAL, `tx_unreadable` without aborting pass, `detectLogGaps` never evicting unreviewed, `detectSweepState` from account state with symmetric half-cooldown window + direct-status `landed` set + smallest-seen cooldown.
- If a detector were unwired, the derived wiring gate (`V6_WIRED`, L13b consumed-result check) fails. If a kind were unclassified, the H1 arm fails.

## R3. Layouts (`bank/layout.mjs`)

**Assertions are real; a struct change cannot slip past.**

- `STRUCTS` equals `pub struct` field-for-field (strict parser throws on private/`pub(crate)`/multiline); type change caught; every `OFF_*` scraped from GOV/BURN/MINT compared, none scraped-and-ignored (L2); `LEVEL_WEIGHTS`/`ACC_SCALE`/`REVEAL_WINDOW_SLOTS`/`readySlot(1000/1003/1004)=1016` scraped (L3, not self-computed); 11/11 `SEEDS` scraped (D6 — the comment now true); versions + `BOOST_RING=64` scraped; `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` evaluated less padding; suite `OFF_*` compared; round-trip + bool/disc/truncation/Vec refusals; `collectionPluginsHash` blind to counters, sensitive to royalty.
- If this were false, `selftest.mjs` layout block fails.

## R4. Money arithmetic (`bank/accrual.mjs` vs MINT)

**Divergence: none.**

- `credit`: `delta=avail*1e12/w; acc+=delta; owed+=delta*w` — MINT `credit`.
- `pendingScaled`: `(weight+boost)*acc+carry-debt` — MINT `owed_of`; `pendingSats` floors; `ceilSats` ceils; `available` saturates (alarm reports short); `reweigh` carries owed and restarts debt; `debtAtActivation=weight*acc`.
- Crank expires pre + post, alarm pages `boosts_stalled`, `cbob_mint`/`max_boost_weight`/`max_boost_epochs` are CRITICAL drift. If diverged, accrual selftest + crank BOOST arms fail.

## R5. Swap (`bank/swap.mjs`) + revenue cycle (`bank/revenue.mjs`)

Proven, not re-argued. Fork (`sim/swap-fork.sh`, 16) lands real swaps through both real programs with floor held and 5%-high floor refused.

- **(a) Oracle:** `sats=lamports*sol*10^(es-eb)/(btc*10)`, floored twice; expo bounded `-18..0` at read and floor; stale/future/non-positive/wide refused on chain Clock; `satsPerLamport` only for filter, double error ~1e-12 vs 100bps gate. If wrong, R40 C02 pinned vector (280,355/276,149) fails.
- **(b) Pyth:** derived shard-0 PDA, owner==receiver, `level==1` (Full), feed id match, min length 101, offsets 40/41/73/81/89/93 verified against `PriceUpdateV2`. Ownership+derivation sufficient because only push program can write receiver-owned account; age/conf/future bound the rest. Clock owner-checked in `market()`; fixed sysvar address elsewhere. If offsets wrong, fork SW.7 arms fail.
- **(c) Filter:** `orcaSpot=(sqrt/2^64)^2`, `meteoraSpot=1/(1+step/1e4)^id`, `deviationBps` symmetric; Orca wSOL/cbBTC order, Meteora cbBTC/wSOL order refused otherwise; 99bps used / 101bps skipped both sides through `market()`. Decimals correct by fork SW.0 landing.
- **(d) Floor:** same oracle expectation, `other_amount_threshold`/`min_amount_out` bytes equal `minSats`, units sats. If mismatched, judge + fork refuse.
- **(e) Judge:** exact 7-instruction sequence, CU 400k only, no price, both ATAs ours, wrap exactly `lamportsIn` to own wSOL, SyncNative, venue swap with own wSOL in (Orca 3/Meteora 4) / own cbBTC out (5) / amount / threshold / Orca exact-input+a_to_b+min-price, close once last, no other Token ix. Eight round-25 tampers refused by name on both venues. Vault A/B not pinned — pool program enforces; mismatch only refuses, post-swap `delta<guaranteed` throws and cycle stays open. No silent steal past it.
- **(f) Derivation:** Orca `[s0,s0-span,s0-2span]`, `tick_array`+pool+decimal-string; Meteora `[i,i+1,i+2]`, `bin_array`+pool+i64-LE; bitmap/`host_fee_in` as program-id None, event authority, two Token programs. Boundary/uninitialised → program refusal → Meteora fallback, logged, never silent double-swap.
- **(g) wSOL:** wrap exactly, sync, swap, close. Pre-existing balance only adds returned SOL to operator (no loss); frozen/delegate only refuses (loud open cycle); exact-input consumes all.
- **(h) Retry:** Orca-first, Meteora-only-on-`refused`, unknown stays open with `pending*Sig`, open-cycle guard blocks auto double-swap, hand runbook + `--audit` required. Every path stays open until `returnedSats>0` + split (`cycleIsOpen` shared predicate).
- **(i) Tolerance bound:** 100bps gate + 150bps floor on ~10 SOL (~$1.2k, ~280k sats) ≈ $18/cycle, ~$60/day at 34 SOL/day throughput; Meteora impact of royalty size <0.2% on ~$0.9M. Not material; pool-push to gate edge still needs to beat on-chain floor. Operator worst case remains cap×windows until `emergency_stop_sweep` (never vault/pool/sale cbBTC); trusts now two pool programs + oracle + one RPC + this tree's integrity (stated limit 10), not HTTP. Ledger cannot read failed as closed (`sendRejected` without `sweepSig`, `rejected_row_has_sweep` CRITICAL, `unledgered_sweep` backstop).

## R6. Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

**No vacuous arm, no deletable floor, no empty-input pass.**

- `FLOOR=945` equality (not `>=`); SPEC every-occurrence map; `audit-coverage.sh --selftest` 14/14; signer-set scan covers `bank/scripts/tests`; wiring gate derived + comment-stripped + consumed-result; control-table mechanically true; installer preservation executed (commented/prose/foreign lines do not arm, reveal lane does not arm full pass); `cron-install.sh` six jobs, `flock -n`, hourly revenue < ruled cooldown; `build-mainnet.sh` asks all four + sweep byte-identity (dist vs ln vs target/deploy); rehearsal proof forward/reverse + abbreviated-id refusal.
- Round-24 both-directions claim holds; the one presence-only risk (router-label literals) is now derived for fee labels (R42 C08).
- `web/test/`: each file held to exact floor (`run-all.mjs` 682, `e2e-localnet.sh` 132); bundle-vs-node equality + suite-vs-sim byte equality + negative controls (`diffIx` catches flag/byte/account); dust/decoy/flood arms drive the page's own readers. A test that could not fail would fail its mutation (mSigKey/mAge300/mL0/mMin1SOL/mDust/mSplDust all red on the named arm only).

---

## The four accepted-limit questions

1. **Worse than stated? No.** Spot-checked 10 (cap×windows, not one sweep), 25/26 (re-roll + C-grind with best-of-4 numbers), 28 (freeze forfeit + join-only path), 32 (ring, 64-cap, bare-burn lag), 40 (three Core consequences + heap boundary), 46 (hot-key project-kill/capture), 59 (pre-fund grief costs griefer rent floor, victim fee). None exploitable beyond its text.
2. **Listed but not a limit / already closed? No.** Every ACCEPTED item still needs its disclosure; DISCHARGED items name their replacement.
3. **DISCHARGED not discharged? No.** Bank/deck/distributor family gone with the code; compute, duplicate-key, unlevelled-halt, split/round/cadence items measured or superseded as stated.
4. **OPEN treated as accepted? No.** 22 (dress rehearsal incl. both pools + forced failure + DAS read), 38 (three OPEN values, checker refuses), 50 (pages staged not published, guide DRAFT-gated), 52 (three accounts + rent before first split/mint), 53 (rehearsal proof stale, value set + checker mode still to write) remain blocking in SPEC and in code.

---

## GIVEN NO HUMAN FIRM WILL EVER SEE THIS AND PROGRAMS WILL BE IMMUTABLE — what AI audit structurally cannot do

1. **Run the live dress rehearsal (item 22).** Crank at 2,100 vaults, alarm in rehearsal mode, one full revenue cycle through Orca AND one forced through Meteora, one forced post-sweep failure through hand recovery, DAS `burnt` read — each with signatures. No suite, fork or selftest executes `revenue.mjs` live.
2. **Build on a second machine and compare `dist/` sha256.** `build-mainnet.sh` proves key behaviour, not that the constant IS Gary's key. Reproducibility is the only bridge.
3. **Human-read the four `initialize` transactions FROM `launch/mainnet-init.json`.** The checker judges JSON, not signed bytes; SEAL checks owners only; off-curve keys pass programs but cannot sign.
4. **Drill the alert path end-to-end.** Fire each CRITICAL once (sweep without return, bare burn, pool freeze, brake pull, PoB plugin change) and prove a human reaches the guardian wallet in time. A page nobody acts on is not a control.
5. **Take custody off this box.** Swap-operator key (hot, 0.02 float, nothing refills), `$CBOB` release key (whole supply), deploy authority (five ids), PoB hot wallet through charter close. Move release to Gary/Squads and delete box key by his call; keep operator float topped by hand; keep PoB cold-or-multisig after window (hot through window is the ruled risk).
6. **Publish the pages before value moves (item 50).** Redeem (coverage + helper + prior creates + frozen-pool no-claim + C5 transfer + close-what-you-empty), buy/claim (`checkNewAddress`), vault (deposit address), ceremony step 10 (collection + initializes + three ATAs + rent), metadata generator, same-origin proxy. Guide stays DRAFT until then.
7. **Lock in order.** Rehearse placeholder→extend→upgrade→verify at throwaway ids; dump-check prefix + zero tail at steps 9/10/11; remove upgrade authority only after 1-6 pass; re-take alarm baselines at upgrade.

No deployment, initialization, lock, ceremony, cron installation or publication follows from this audit.
