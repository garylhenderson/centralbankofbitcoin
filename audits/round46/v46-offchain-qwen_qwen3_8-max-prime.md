# Round 46, OFF-CHAIN pass: LAUNCH-CLEAN; QUORUM MET

**Independent triage against audited head `e7c192a` (code identical at HEAD `63a92b2`; `git diff --quiet e7c192a 63a92b2 -- bank scripts sim web launch programs tests SPEC.md HOLDER-GUIDE.md DESIGN-v6.md` exits 0). Programs equal RELEASE_COMMIT `0b3ddb3`. This is a confirmation round on the final tree. I verified every round-45 repair at its site, re-tested the claims round 45 disproved, and independently audited the crank, alarm, layouts, arithmetic, swap, revenue cycle, gates, and web tests from first principles.**

**Result: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW confirmed. 3 INFO observations (none in the five programs, none moving value, none stopping a crack). All seven round-45 repairs verified in place. All round-45 disproved claims remain disproved. The tree is launch-clean under SPEC gate 3.**

---

## R0. Round 45 repairs — verified

**V45o-1 (null SEAL reserve read).** Verified at all three sites. `alarm.mjs:526` builds `ataMints` via `cfg['seal.reserve_mints'] || D.carryConfigBaseline(prev?.config, cfg)['seal.reserve_mints'] || D.RESERVE_MINTS`. `alarm.mjs:338` (reconcile) carries from `readState()?.config` and throws if nothing is available. The per-pass ATA maps, the `atas` set, and the reconcile `expected` set all use the carried list. Measured logic: a null SEAL read on one pass produces no false `non_ata_token_account` or `undeclared_token_account` findings. **Repair holds.**

**V45o-2 (rehearsal switches at load).** Verified. `revenue.mjs` calls `refuseStrayOverrides()` at module scope, before `main()`, before any read or send. `FAIL_AFTER_SWEEP` and `FORCE_ORCA_REFUSAL` are read via `rehearsalFlag()` at module scope. `alarm.mjs` and `crank.mjs` also call `refuseStrayOverrides()` at load. A stray override outside a recorded tree kills the job before any SOL moves. **Repair holds.**

**V45o-3 (frozen-pool overdue text).** Verified. `detectors.mjs` `detectDistributionOverdue` emits a distinct detail when `poolFrozen` is true: "because the community pool's cbBTC account is FROZEN (see pool_frozen). The crank and the in-line monthly run decline to credit from a frozen pool by design; the distribution waits for the thaw. There is nothing to run by hand." The non-frozen path still says "all failed to happen." `detectCrankHealth`'s `coveredFreezes` filter suppresses the matching crank problem text when `pool_frozen` is already paged. **Repair holds.**

**V45o-4 (unreadable retry count survives a flood).** Verified. `alarm.mjs:815` writes `unreadPasses: D.carryUnreadPasses(prev?.unreadPasses, looked.unreadNow, looked.attempted)`. `carryUnreadPasses` carries entries for signatures not in `attempted`, so a flood that pushes an unreadable signature past the budget preserves its count. `looked.attempted` is populated for every signature processed. **Repair holds.**

**V45o-5 (coverage selftest ordering).** Verified. `audit-coverage.sh` parses `--selftest` before the `never` check: `SELFTEST=0; [ "${1:-}" = "--selftest" ] && SELFTEST=1` precedes `if [ -n "$never" ] && [ $SELFTEST = 0 ]`. The freeze check still fails closed. **Repair holds.**

**V45o-6 (crank floor wording).** Verified. `crank.mjs` `budgetPlan` low-key message reads "this pass ran its base plan, sent no reveals, and is below the floor. Top it up." No claim of keeping the floor. **Repair holds.**

**V45o-7 (prompt repetition, pass split).** Carried to the next round's script per round 45 verdict. Not a code defect. No action needed this round.

---

## R1. THE CRANK (`bank/crank.mjs`)

I traced every instruction the crank builds against the MINT program's Anchor contexts, field by field.

**Account lists verified.** `reschedule_reveal` sends `[vault_record]`. `capture_entropy` sends `[vault_record, slot_hashes]`. `reveal_level` sends `[config, vault_record, asset, collection, payer, mint_authority, slot_hashes, mpl_core, system_program]`. `rescue_nested` sends `[config, vault, collection, host, new_owner, payer, rescue_authority, mpl_core, system_program]`. `retire_burned` sends `[config, vault_record, asset]`. Pre-join claims send `[config, pool_token, token_program, ...(record, vault_ata) pairs]`. `expire_boosts` sends `[config, ...records]`. `split_revenue` sends `[config, revenue, mint, revenue_ata, holders_ata, bank_ata, token_program]`. `distribute` sends `[config, pool_token]` with `burn=0`. `activate` sends `[config, vault_record, asset, vault_token, pool_token]`. Post-distribution claims send the same shape as pre-join claims. All match the program's `#[derive(Accounts)]` structs.

**Order verified.** Retire → pre-join → pre-expire → distribute → post-expire → activate → claims. Pre-joins run before the distribution (the program refuses `JoinWaitingFirst` otherwise). Pre-expires run before the distribution (`BoostsExpireFirst`). Post-expires run after. Activations run after the distribution (red-team 3 finding 6). This order is correct.

**Dead vaults.** Burned assets are retired, never joined or paid (`assets[r.asset] === 'burned'` filters them from preJoins, claims, and activate). Unreadable assets (`'other'`) are skipped with a problem, never joined or paid. **No plan pays or joins a dead vault.**

**Reveal order.** The reveal loop iterates from `revealed_total` upward and stops at the first record without entropy. The MINT program enforces `RevealOutOfOrder`. The crank cannot send a reveal out of order. **No out-of-order reveal.**

**Value movement.** Every instruction the crank sends is permissionless and pins its own destination. The crank's key signs only as fee payer. `split_revenue` sends to the pool and the Squads (both pinned in config). `claim` pays into the vault's recorded ATA. `rescue_nested` sends to `bank_treasury`. The crank builds no token transfers, no system transfers, no instructions to programs other than MINT. **The crank moves value nowhere the program does not already pin.**

**Budget.** `budgetPlan` runs the base plan whenever the key covers it, sends reveals only above the floor, and pages dropped reveals. `planCostLamports` counts one signature per transaction plus reveal rent. The `judgeFeePayer` minimum check precedes the ceiling check (round 24 L6a). **No wasted-fee plan.**

**Race handling.** `BENIGN` covers `AlreadyCaptured`, `AlreadyRevealed`, `RevealOutOfOrder`, `MonthNotElapsed`, `AlreadyRetired`, `AlreadyActive`, `VaultRetired`, `ActivationPending`, `RevealWindowExpired`, `NeedsReschedule`, `NothingToSplit`, `NotNested`. `judgeDistributeRefusal` re-reads the config on `DISTRIBUTE_RACE` codes and checks whether the epoch moved. `PoolShort` is always a failure. `mintFailureCode` parses the invoke stack and only accepts MINT's error codes. **No false pages from races.**

---

## R2. THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

**WATCH list.** All fixed-forever values are covered: collection keys (4 programs), reserve mints, governance, pool_ata, bank_treasury, split_bps, max_supply, payment_mint, level_caps, pob_collection, pob_root, charter window, monthly_secs, redeem_window_secs, notice_secs, tighten bounds, cbob_mint, boost ceilings, quorum, threshold, voting period, guardian, swap operator, pending keys, sweep bounds, round fields, proposal count, boost terms, program upgrade authorities and hashes (all five programs plus Core and four third-party programs), collection plugin hash, PoB collection plugin hash and update authority. `WATCHED_KEYS` includes all WATCH keys plus operational keys. `missingWatchedKeys` throws if any watched key is not produced by `readConfigs`. **No dangerous state reads as quiet due to a missing watch.**

**Standing risks.** `detectStandingRisks` checks the production values (30-day month, 3600s window, 7-day notice, 21%/51%/3-day governance, tighten bounds, 2100 supply, census, cbBTC mint, Squads treasury, reserve mints, PoB root, PoB collection, charter length, boost ceilings). A wrong value pages `test_value_in_production` at CRITICAL. **No routine state pages on every pass due to a wrong production check.**

**Drift detection.** `detectConfigDrift` skips keys that were missing in the previous snapshot (program not deployed) and third-party keys never recorded. `carryConfigBaseline` carries the last non-null value. A one-pass RPC blip does not lose the baseline. **No drift missed across a blip.**

**Pool health.** `detectPoolHealth` checks for unreadable, frozen, and insolvent pool. `poolAvailable` computes `balance - ceil(owed)`. **Correct.**

**Distribution overdue.** V45o-3 verified. The frozen-pool text is distinct. The non-frozen text names all three layers. Stalls (joins, boosts, launch tick) are checked. **Correct.**

**Sweep state.** `detectSweepState` uses the symmetric window `|t - st| <= cooldown/2`. The cooldown is the smallest ever seen, capped at 21600. Uncertain sends explain only when a direct status lookup confirms they landed. **Correct.**

**Revenue reconciliation.** `cycleIsOpen`, `cycleStartMs`, `closesCycle`, `detectUnreconciledRevenue`, `detectSplitClaims` all verified. The `sendRejected` check, the split anchor, the shortfall tolerance, the grace period, the chain-time anchoring — all correct. **No cycle reads as closed when it shouldn't.**

**Crank health.** `detectCrankHealth` tracks consecutive failures and recurring problems. `coveredFreezes` prevents double-reporting. `problemKey` normalizes numbers. **Correct.**

**Alarm notices.** `planAlarmNotices` groups by kind, one notice per kind, urgent for one-shots, recovery for cleared level kinds, `NOTICE_MAX_CHARS` limit, `defangForRouter` for non-urgent text. `ALARM_KINDS` covers every finding kind generated by any detector. **No finding kind is unclassified.**

---

## R3. THE LAYOUTS (`bank/layout.mjs`)

**Struct assertions.** The selftest parses each Rust struct via `parseRustStruct` and compares field-by-field against `STRUCTS`. It checks both directions: a field added to Rust and not in the layout is caught, and a type change under the same name is caught. The parser throws on private fields, `pub(crate)` fields, and multi-line fields. **A struct change cannot slip past.**

**Cross-program offsets.** The selftest scrapes every `OFF_*` constant from GOV, BURN, and MINT source and compares against `offsets()`. All 30+ offsets are checked. The scrape found every constant (none undefined). **No offset drift.**

**Seeds.** The selftest scrapes every `*_SEED` constant from the four programs and compares against `SEEDS`. All 12 seeds are checked. **No seed drift.** (Round 24 D6 repair verified.)

**Versions.** The selftest scrapes every `*VERSION` constant and compares against `STRUCTS[*].version`. All five struct versions are checked. **No version drift.**

**Decode/encode.** Round-trip tested for all structs. Bool bytes that are neither 0 nor 1 are refused. Truncated accounts are refused. Wrong discriminators are refused. Wrong versions are refused. Incredible Vec lengths are refused. **Correct.**

---

## R4. THE MONEY ARITHMETIC (`bank/accrual.mjs`)

I compared each function against the MINT program line by line.

- `credit`: `delta = avail * ACC_SCALE / w`, `acc += delta`, `owed += delta * w`. Matches MINT's `credit`. ✓
- `pendingScaled`: `(weight + boost) * acc + carry - debt`. Matches MINT's `owed_of` with `weight_of` including boost. ✓
- `pendingSats`: `pendingScaled / ACC_SCALE`. Matches MINT's claim settlement. ✓
- `reweigh`: `carry = owed`, `debt = (weight + boost) * acc`. Matches MINT's `reweigh`. ✓
- `ceilSats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE`. Matches MINT's ceiling. ✓
- `available`: `balance - ceilSats(owed)`, floored at 0. Matches MINT's `distribute`. ✓
- `debtAtActivation`: `weight * acc`. Matches MINT's join debt. ✓

The selftest asserts: Level V = 3× Level I, shares sum to distributed amount, dust carries, late activation earns nothing from prior distribution, frozen vault stays owed, boost carry and reweigh are exact, debt-only formula goes negative at expiry (why carry exists). **No divergence.**

---

## R5. THE SWAP (`bank/swap.mjs`) AND REVENUE CYCLE (`bank/revenue.mjs`)

**(a) Oracle math.** `oracleFloor` computes `sats = lamports * sol.price * 10^(sol.expo - btc.expo) / (btc.price * 10)`. With both exponents at -8, the exponent factor is 1. The floor is `expectedSats * 9850 / 10000` (150 bps below). `satsPerLamport` is a float approximation for the deviation check. The exponent range is bounded to [-18, 0] (round 42 C06). Integer division floors. **Correct.**

**(b) Pyth verification.** `readPyth` checks: owner is the Pyth receiver, verification level is 1 (Full), feed id matches, exponent in range. The PriceUpdateV2 offsets (8+32=40 for level, 41 for feed, 73 for price, 81 for conf, 89 for expo, 93 for publishTime) match the layout. The account is a PDA derived under the push-oracle program. Ownership by the receiver plus the derivation plus full verification plus feed-id match is sufficient: only the Pyth receiver can write to that PDA, and the receiver only writes verified updates for the correct feed. A stale `publishTime` is caught by the age check. A future `publishTime` is caught by the future check (30s). **Correct.**

**(c) Deviation filter.** `orcaSpot` computes `(sqrt_price / 2^64)^2` in raw units (sats per lamport). `meteoraSpot` computes `1 / (1 + binStep/10000)^activeId` (sats per lamport, inverse of lamports per sat). `deviationBps` computes `|pool - oracle| / oracle * 10000`. Pools more than 100 bps from the oracle are skipped. The fork test (SW.7) verified both venues are usable with real cloned pools. **Correct.**

**(d) Minimum out.** The swap instruction carries `minSats` as `other_amount_threshold` (Orca) or `min_amount_out` (Meteora). The judge verifies this matches the `minSats` passed to `swapInstructions`. The deviation filter and the minimum out both use the same `oracleFloor` output. **Correct.**

**(e) The judge.** `judgeSwapInstructions` requires the exact 7-instruction sequence. It checks: allowed programs only, no second signers, no priority fees, only SyncNative and CloseAccount for Token, exactly 7 instructions, SetComputeUnitLimit(400000), ATA creates for the operator's own accounts, System transfer of exactly `lamportsIn`, SyncNative, the venue swap with correct accounts/amount/floor/direction, CloseAccount back to the operator. The round 25 L1 arms verified all eight tampers are refused on both venues. **Complete.**

**(f) Account derivation.** Orca tick arrays: `[s0, s0-span, s0-2*span]` where `span = 88 * tickSpacing`. Meteora bin arrays: `[i, i+1, i+2]` where `i = floor(activeId / 70)`. The bitmap extension is passed as the program id when absent (Anchor's None convention). `host_fee_in` is None. The event authority and two token programs are included. The fork test verified these against real cloned accounts. **Correct.**

**(g) wSOL handling.** The swap wraps exactly `lamportsIn`, syncs, swaps, and closes the wSOL account back to the operator. If the wSOL ATA already exists, `createAtaIdempotent` is a no-op. If the swap consumes less than the input (impossible with exact-input, but the close handles any remainder). The close returns all remaining lamports to the operator. **Correct.**

**(h) Failure and retry.** Orca is tried first. Meteora is tried only if Orca's program refuses (on-chain error or failed preflight). An uncertain send (not refused, not landed) stops the cycle and records the attempt. `classifySendFailure` checks the signature's status: landed-and-failed is refused, expired-and-absent is refused, landed-and-succeeded is landed, anything else is unknown. A confirmation timeout on a swap that later lands is detected by the status check. The cycle stays open until a cbBTC return is proven. **No double-swap, no false close.**

**(i) Extraction bounds.** The 100 bps deviation gate and 150 bps floor bound the price impact. A sandwich within the deviation gate can extract at most the 150 bps floor difference. A stale-but-accepted oracle (up to 180s old, confidence up to 30 bps) adds at most ~30 bps. A manipulated Meteora pool (~10× thinner) is bounded by the same floor. Per cycle (up to 10 SOL), the maximum extraction is ~150 bps of ~$1,700 ≈ $25. Per month (~34 SOL swept), ~$85. **Not material.**

**Operator key worst case.** The operator key can keep up to 10 SOL per 6-hour cooldown until the guardian stops it. It trusts the two pool programs and the Pyth oracle (not an HTTP reply, since round 24). The ledger cannot read a failed cycle as closed: `cycleIsOpen` requires both a return and a split. **Correct.**

---

## R6. THE GATES

**`bank/selftest.mjs`.** 1032 detector assertions, each proven in both directions. The floor uses equality (`R.length !== FLOOR` fails). Every detector has a fire case and a quiet case. The wiring gate checks that every detector's result is consumed in `alarm.mjs`. The layout gate checks every struct, offset, seed, and version. The control table gate checks ON-CHAIN/AUTOMATIC/PROCEDURE classifications. **No assertion that cannot fail.**

**`scripts/run-tests.sh`.** MIN_ASSERTIONS=912 (equality check). DET_FLOOR=1032, ALLOC_FLOOR=39, POSTER_FLOOR=24, MAINNET_FLOOR=35, LAUNCH_FLOOR=68, POB_FLOOR=14, HOST_FLOOR=6, EXPIRY_FLOOR=4, WEB_FLOOR=695, SWAP_FLOOR=16, SIM_FLOOR=71. The `floor` function uses equality. The `release_gate` checks program source against RELEASE_COMMIT (or the recorded rehearsal substitution). The ship gate refuses to skip the mainnet probe or swap fork. **No floor that can be satisfied by deleting work.**

**`scripts/build-mainnet.sh`.** Builds both mainnet and localnet, deploys both, asks each for the test key (mainnet must REJECT, localnet must ACCEPT), checks the sweep helper's bytes are identical. Refuses a dirty tree. Records the commit. **Correct.**

**`scripts/cron-install.sh`.** Installs with `flock -n`. Revenue hourly, crank hourly + every minute, alarm at :23/:53, reconcile daily, deadman every 2 hours. `judgeCronTemplate` checks every money job is wrapped. The rehearsal marker refuses installation. **No job armed that should not be.**

**`scripts/audit-coverage.sh`.** V45o-5 verified. The freeze check fails closed. The selftest runs before the never check. The content check compares current blobs against completed-round bundles. **No vacuous pass.**

---

## web/test/

**`bundle.test.mjs`.** Tests the browser bundle against node's `judgeLaunch`, checks static properties of built pages (no external scripts, CSP, viewport, ceremony noindex, no em dashes), verifies the launch gate refuses a wrong PoB root. The C03 arms run the bundled `planRedemption` on six synthetic snapshots and compare byte-for-byte with node's. **Non-vacuous.**

**`ceremony.test.mjs`.** Tests the ceremony's launch gate, value mapping to the four initializes, post-step checks, the rehearsal judge. **Non-vacuous.**

**`decode.test.mjs`.** Tests Core and SPL readers against official deserializers. **Non-vacuous.**

**`ids.test.mjs`.** Tests every derived address against the suite's derivation, the programs' seed constants, mpl-core's asset-signer PDA, spl-token's ATA, and the Bank's program-id table. **Non-vacuous.**

**`plan.test.mjs`.** Tests the redemption plan against the Test Vault simulation's S8 builders, the sweep helper, the packet limit, the rate limit, the pool frozen case, the stray handling. **Non-vacuous.**

**`tx.test.mjs`.** Tests the signing guard and error names. **Non-vacuous.**

**`meta.test.mjs`.** Tests the metadata generator's fail-closed behavior. **Non-vacuous.**

**`run-all.mjs`.** Floors sum to 695 = WEB_FLOOR. Each file's count must equal its floor. **Correct.**

---

## Accepted limits — the four questions

**1. Is any limit WORSE than stated?** No. I re-read each accepted limit against the code. Limit 10 (swap operator): the rate-limit is cap × cooldown windows, enforced on-chain, stoppable by the guardian. The operator wallet instruction is stated. Limit 25 (re-roll): the reschedule mechanism is correct, the alarm pages reschedules. Limit 26 (last-slot grinding): the three-group stride is implemented, the residual is stated. Limit 28 (frozen pool): the forfeit mechanism is correct, the in-line run doesn't credit from a frozen pool. Limit 32 (rate limit): the rolling window is correct, the ring bounds at 64. Limit 40 (Core upgradeable): the alarm watches Core's upgrade authority and hash. Limit 41 (transfers not limited): stated correctly. Limit 46 (PoB hot wallet): the pass-through and alarm are in place. Limit 47 (stolen guardian): the half-of-all-vaults requirement is correct. Limit 55 (unsplit revenue edge): stated correctly. Limit 56 ($CBOB hot key): stated correctly. Limit 58 (rescue): the rescue mechanism is correct, the crank sends it every full pass. Limit 59 (pre-funded address): the pages handle it. **No limit is worse than stated.**

**2. Is anything listed as a limit not actually a limit?** No. All accepted limits correspond to real code behavior or real architectural constraints. **No phantom limits.**

**3. Is any DISCHARGED item not actually discharged?** No. I checked the discharged items: 51 ($CBOB boost) is built and tested. 54 (compute at widest shapes) is measured. 12/17 (compute units) is measured. 14 (duplicate attributes) is closed on-chain. 19 (unlevelled vault halt) is closed by construction. 30 (85/15 vote) is discharged by stage 3b. 31 (31-day branch) is superseded. 33 (7-day branch) is discharged by stage 3c. The v5 items (1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24) are gone with the Bank/deck/distributor. **All discharged items are genuinely discharged.**

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 remain OPEN AND BLOCKING. The launch values file has three OPEN values (charter_opens_at, lock_deadline, vault_collection). The holder surfaces are built but not published. The dress rehearsal has not run. The pool/Squads/revenue accounts must exist before the first split. The rehearsal tree must be re-proven at the release commit. **No OPEN item is quietly accepted.**

---

## INFO observations (none blocking)

**INFO-1 (triage observation).** The `planCrank` function uses `records.find(x => x.address === addr)` in the `retiringWeight`, `expiringWeight`, and `retiringOwed` loops. With 2,100 records, this is O(n²) per pass. At the hourly cadence this is not a performance concern, but a Map lookup would be cleaner. No correctness impact.

**INFO-2 (triage observation).** The `judgeRehearsal` function's `REHEARSAL_INIT_AUTHORITIES` allows both Gary's wallet and the localnet test key. The rehearsal uses the localnet build, so only the test key is correct. The leniency is harmless (the on-chain initialize would fail with the wrong key), but the check could be tighter. No correctness impact.

**INFO-3 (triage observation).** The `planCrank` function's `preExpires.includes(r.address)` check in the `postExpires` loop is O(n) per record. The check is logically redundant (a vault in `preExpires` has `dist_epoch >= boost_end_epoch`, which is mutually exclusive with `boost_end_epoch === dist_epoch + 1`), but it's a defensive guard. No correctness impact.

---

## Rounds 41–44 re-check

All 24 confirmed findings from rounds 41–44 remain outside (a)–(d). I re-read each mechanism against the code at `e7c192a`:

- **R41 V41-1** (dusting a config PDA): `isSystemDust` in `alarm.mjs` and `reads.mjs` handles System-owned 0-byte accounts as absent. ✓
- **R41 C01** (poster per-transaction): `draftKey` is per signature:vault. ✓
- **R41 C02** (oracle-age arm): literals in the selftest. ✓
- **R41 C03** (crank fee-budget sentence): corrected in HOLDER-GUIDE. ✓
- **R42 V42-1** (ceremony server): fixed. ✓
- **R42 V42-2** (collection create): `checkNewAddress` handles it. ✓
- **R42 C01** (omitted vaults after shrunk pass): `judged` set in `alarm.mjs`. ✓
- **R42 C12** (pre-funded asset/collection): pages handle it, suite arms pin it. ✓
- **R43 V43-1** (host owner takes nested vault): stated, crank rescues every full pass. ✓
- **R43 V43o-1** (release gate in rehearsal): `release_gate` handles rehearsal trees. ✓
- **R43 V43o-2** (unreadable signature skips): `UNREADABLE_SKIP_PASSES`, `detectUnreadSkips`. ✓
- **R43 V43o-3** (reveal-skip arm): extract-and-run arm in selftest. ✓
- **R44 V44-1** (rehearsal ceremony judge): `judgeRehearsal` in `check-launch-params.mjs`. ✓
- **R44 V44-2** (release gate code-token map, untracked files): V44-2 fixes in `release_gate`. ✓
- **R44 V44-3** (coverage gate LAUNCH-CLEAN): `first_line_quorate` handles both vocabularies. ✓
- **R44 V44o-1** (poster two-signature drain): per-signature counts. ✓
- **R44 V44o-2** (split scan refused read): collect-and-continue in `splitsSince`. ✓
- **R44 V44o-3** (SEAL-null baselines): carried config in balance block. ✓
- **R44 V44o-4** (runner tail exit code): `if` not `&&`. ✓
- **R44 V44o-5** (rehearsal notices): `rehearsalNotice` in crank and revenue. ✓

**All stand.**

---

## Remaining requirements (unchanged)

- Items 22, 38, 50, 52, 53 remain OPEN AND BLOCKING.
- `charter_opens_at`, `lock_deadline`, `vault_collection` remain OPEN in `launch/mainnet-init.json`.
- The mainnet dress rehearsal (road step 8) has not run.
- The holder surfaces (item 50) are built but not published.
- The pool, Squads, and revenue cbBTC accounts must exist before the first split (item 52).

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **Run the dress rehearsal before anything else.** Item 22's five named pass/fail items (crank live passes, alarm rehearsal mode, one full revenue cycle through each pool, one forced post-sweep failure, one DAS read of a burned collection) are the only test of the off-chain pipeline against a live chain. The 912-assertion suite and 71-assertion simulation prove the programs; they do not prove the crank's RPC handling, the alarm's DAS reads, or the revenue job's swap execution under real network conditions. The rehearsal is the only gate between "the code is correct" and "the system works."

2. **Verify the five deployed program hashes against `dist/SHA256SUMS` immediately after step 9, and again after step 11.** The `release_gate` checks source, not deployed bytes. A deploy that silently substitutes different bytes would pass the source check. The dump-and-hash after deploy and after `set-upgrade-authority --final` is the only byte-level proof.

3. **Fund the operator wallet above `OPERATOR_FLOOR` (0.02 SOL) and the revenue address above rent exemption before the first royalty arrives.** Nothing refills either. A first cycle that fails for want of fee lamports leaves an open cycle that requires hand recovery.

4. **Test the guardian wallet's ability to sign `emergency_stop_sales` and `emergency_stop_sweep` on a testnet before launch.** The guardian is Gary's Phantom wallet. If the wallet cannot sign (wrong derivation, lost seed, Phantom bug), the brake does not work. A testnet dry run of both stops and a governance restart would prove the brake before it is needed.

5. **Publish the holder surfaces (item 50) before the first mint.** Without the redeem page, items 9 and 44 have no preventive control. A holder who redeems by any other client gets no warning about undeclared holdings. The page is built and staged; publishing it closes the gap.

6. **Monitor the first 48 hours after launch with the alarm running at 30-minute cadence.** The first distribution, the first claim batch, the first revenue cycle, and the first reveal queue are all untested at production scale. The alarm's `distribution_overdue`, `crank_silent`, `royalties_unswept`, and `reveal_queue_stalled` detectors are the only safety net for operational failures that the code cannot prevent.