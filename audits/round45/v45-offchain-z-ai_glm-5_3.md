# Round 45, OFF-CHAIN pass: independent audit of the whole tree

## R0. Round 44's verdict and its repairs

I independently verified all five confirmed findings' repairs against this tree, at every site of their shape I could find.

**V44o-1 (poster's per-signature unreadable count).** The repair is in `bank/redemption-poster.mjs`: counts are kept per signature (`st.unread[s.signature]`), only the just-read signature's count is deleted (`delete st.unread[s.signature]`), and the state (including any backlog) is persisted through `writeLedger` before the throw. The selftest's `twoSig` arm drives the real extracted walk with two signatures (an unreadable X newer than a readable A) in both the draining and gapped cases, and shows X reaching run 3 and being queued REJECTED in both. I traced the backlog persistence: `st` carries `backlog` through the throw (it is part of the state object written by `writeLedger`), so a draining backlog survives the throw. A NEW gap's backlog is not written before the throw, but the per-signature counts make that irrelevant to the wedge the fix targets — the counts persist regardless. **Repair holds.**

**V44o-2 (revenue split-recovery scan).** `splitsSince` now catches a refused read per signature (`catch (e) { refused.push(...); continue }`), collects it, and keeps scanning. The recovery block closes cycles on readable splits first (`closesCycle`), then the provably-empty path, and only throws naming the refused signatures when a cycle is still open after both. The selftest arms run the real extracted `splitsSince` and the real recovery block, both directions. **Repair holds.**

**V44o-3 (alarm balance baseline with null SEAL config).** `alarm.mjs` now takes the reserve list from the carried config baseline (`D.carryConfigBaseline(prev?.config, cfg)['seal.reserve_mints']`), and any stored balance leg not built this pass is carried forward and paged as `balance_unreadable` HIGH. The selftest's three scenarios (carried config, no carried config, control) each show the $GARY fall paged. **Repair holds.**

**V44o-4 (runner exit status).** Both skip branches now use `if [ "${CBOB_SHIP_GATE:-0}" = "1" ]; then die ...; fi`. The selftest runs the extracted tail with the network check stubbed and shows exit 0 unset, exit 1 with a FATAL set. **Repair holds.**

**V44o-5 (rehearsal notices).** `rehearsalNotice` is applied at all three notify sites in `crank.mjs` and the one in `revenue.mjs`'s `publishRevenueNotices`. The selftest verifies the label rewriting (`-rehearsal` suffix), the REHEARSAL text prefix, and that production notices are unchanged. The rehearsal value set (`launch/rehearsal-init.json`) says the swap operator key goes to the rehearsal tree's `bank/keys/swap-operator.json`, which the root map makes `revenue.mjs`'s path resolve to. **Repair holds.**

I also re-tested claims round 44 disproved: the wSOL close with a pre-existing balance (the pinned Token program's "Non-native account" message applies only to non-native accounts; a wSOL close unwraps the remainder), and the `paged`-on-undelivered behaviour (the alarm's comment explains why a level stream may be owed its recovery; the mechanism is accurate and the direction is loud). I do not re-file either.

## R1. The crank (`bank/crank.mjs`)

I traced `planCrank` against MINT's arithmetic for the boost cases, the join cases, the retire cases, and the frozen-pool cases. The weight arithmetic (`preJoinWeight`, `retiringWeight`, `expiringWeight`) correctly predicts the distribution's denominator. The owed arithmetic for pre-expired boosts (`atExpiry + level_weight * (acc - old_acc)`) exactly mirrors `expire_boost`'s `reweigh` at the old accumulator plus the distribution's delta at level weight. The owed arithmetic for post-expired boosts (the `else` branch with the boost still in `pendingSats`) is correct because `reweigh` preserves owed across the expiry (carry = owed, debt = new_weight * acc, so owed is invariant). The pre-joined vault's owed (`debt = weight * old_acc`, earning `weight * delta`) matches the program's `join` at the pre-distribution accumulator.

I looked for a plan the program will refuse: the only refusals beyond the benign races are the ones the plan already avoids (frozen pool → no credit distribution, no paying claims; unreadable eligible vault → no distribution; burned asset → never joined or paid, retired first). The in-line monthly running inside a preJoin claim before the crank's own distribute is handled: the distribute fails `MonthNotElapsed`, which `judgeDistributeRefusal` classifies as benign (the epoch moved), and the program computes the actual owed at claim time, so the plan's owed prediction being wrong costs a wasted batch slot, never a miscredit.

I looked for a plan that pays or joins a dead vault: the claims loop skips `assets[r.asset] === 'burned'`, the preJoins loop skips it, and `retireBurned` includes every unretired burned vault, sent first. The residual race (a bare burn between plan and send) is limit 27's accepted behaviour.

I looked for a reveal sent out of order: the reveal loop starts at `revealed_total` and stops at the first vault without entropy. No out-of-order sends.

I looked for anything that moves value anywhere the program does not pin: the selftest's instruction-name enumeration (`activate`, `capture_entropy`, `claim`, `distribute`, `expire_boosts`, `reschedule_reveal`, `rescue_nested`, `retire_burned`, `reveal_level`, `split_revenue`) and the no-transfer/no-foreign-program checks cover this. The rescue's destination is pinned by MINT (`WrongRescueDestination`).

**No new finding in the crank.**

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

I looked for a dangerous on-chain state read as quiet. The specific case I traced hardest: a bare-burned vault that is still ACTIVE (dead weight in the payout denominator). The alarm does not read VaultRecords, so it does not know the vault's active status. But `detectVaultSetChange` pages `vault_burned` CRITICAL for the burn itself, and `crank_silent` pages if the crank (which retires burned vaults every pass) is down. The combination is detected; the specific "this burned vault is still diluting" fact is not stated, but the underlying condition (the crank not running) is paged by its own detector. This is within limit 27's accepted scope.

I looked for a routine state paged every pass. `joins_stalled` and `boosts_stalled` both require the condition to persist past a 6-hour grace after the last distribution, which the crank's hourly pass keeps clear in normal operation. `revenue_unsplit` has a 6-hour grace against a crank that splits hourly. `royalties_unswept` has a 24-hour grace (or the cooldown plus overhead) against a job that sweeps hourly. `detectRedemptionRate` is quiet on an idle window. I found no detector that pages on normal operation.

I traced `detectSweepState`'s baseline: a fresh sweep defers judgment (baseline unmoved), a stale one is judged once (baseline advances), and the baseline rolls back on an undelivered pass. A sweep is never skipped by a newer one because the cooldown (≥ 1 hour at the alarm's minimum) exceeds the grace (15 minutes).

I traced `detectCrankHealth`'s problem-streak logic: counts are per-problem-key across heartbeats, covered freeze texts are pruned even on duplicate heartbeats, and a thaw does not resurrect old streaks. The `coveredFreezes` are computed from the current pass's findings before `detectCrankHealth` runs, which I verified in `main()`'s ordering.

**No new finding in the alarm.**

## R3. The layouts (`bank/layout.mjs`)

The SEEDS assertion exists (round 24 D6): the selftest scrapes each seed constant from the declaring program's source and requires all 12 to match. The cross-program offsets are scraped (`OFF_*` constants from GOV, BURN, MINT) and compared against the layout's computed offsets, with an arm that catches an unchecked constant. I spot-checked `bare_burns_retired` at offset 454 and `minted_total` at 141 against the field list; both are correct. A struct change that is not mirrored here turns the build red via `parseRustStruct`'s strict field-by-field comparison and the offset assertions. **No new finding.**

## R4. The money arithmetic (`bank/accrual.mjs`)

I compared every function against the Rust: `credit` (delta = avail * ACC_SCALE / w; owed += delta * w), `owed_of`/`pendingScaled` (weight * acc + carry - debt), `reweigh` (carry = owed, debt = new_weight * acc), `ceil_sats`/`ceilSats`. All match exactly, in BigInt. The crank expires every DUE boost before it distributes (`preExpires`, gated by `BoostsExpireFirst`) and every boost its own distribution makes due right after (`postExpires`, `boost_end_epoch === dist_epoch + 1`). The alarm pages `boosts_stalled` and watches `cbob_mint`, `max_boost_weight`, and `max_boost_epochs` as fixed-forever CRITICAL drift. **No divergence.**

## R5. The swap and the revenue cycle

**(a) The oracle math.** I verified the exponent handling for both signs (`e >= 0` scales the numerator, `e < 0` scales the denominator), the integer floor rounding (`num / den` is BigInt floor division, always at or below the true value), and the `satsPerLamport` float conversion (the values involved, ~1.2e10 and ~8.6e12, are within Number's safe integer range; the expo bound [-18, 0] and the confidence bound prevent absurd values from reaching the float conversion). The floor is below what an honest pool returns after its fee and impact, by construction (150 bps margin).

**(b) Pyth account verification.** I recomputed the `PriceUpdateV2` offsets: discriminator (8) + write_authority (32) = 40, verification_level tag at 40 (Full = 1 byte), feed_id at 41 (32 bytes), price at 73 (i64), conf at 81 (u64), expo at 89 (i32), publish_time at 93 (i64). The minimum length check (101) is correct. The account is derived (shard-0 PDA under the push oracle) and must be owned by the receiver. Ownership plus derivation means only Pyth's receiver can write the account; a stale or chosen price is bounded by the 180 s age (judged against the chain's Clock sysvar, which `market()` verifies is owned by the Sysvar program), the 30 bps confidence, and the 100 bps pool-agreement filter. The clock is the chain's, not the box's.

**(c) The deviation filter.** `orcaSpot` is (sqrt_price / 2^64)^2 in raw units, which for wSOL (9 decimals) per cbBTC (8 decimals) is exactly sats per lamport. `meteoraSpot` is the inverse of (1 + bin_step/10000)^active_id, which for X = cbBTC, Y = wSOL is sats per lamport. Both are the right quantities in the right direction. Floating-point precision (~1e-16 relative) cannot move a result across the 100 bps (1e-4) boundary.

**(d) The minimum out.** Orca's `other_amount_threshold` and Meteora's `min_amount_out` both carry `m2.f.minSats`, the oracle floor at 150 bps below the second quote's expected output. This is the SAME floor the deviation filter assumed (both derive from `oracleFloor`'s output at the same read), and it is in the units each program expects (cbBTC base units = sats, since cbBTC has 8 decimals).

**(e) The judge.** I walked the judge against the builder's exact seven-instruction sequence. It checks: the allowed program set, no second signer, no priority fee, Token instructions limited to SyncNative (17) and CloseAccount (9), exactly 7 instructions, exactly 1 swap, exactly 1 System transfer, position 0 is SetComputeUnitLimit(400000) with 5 data bytes and no keys, positions 1 and 4 are idempotent ATA creates for the operator's own wSOL and cbBTC accounts (payer, account, owner, mint, system, token — all checked), position 2 is a System transfer (discriminator 2, 12 data bytes) of exactly `lamportsIn` from the operator to its own wSOL ATA, position 3 is SyncNative of that ATA, position 5 is the venue's swap with the amount, floor, and (for Orca) the direction and price limit pinned, the pool at the pinned key position, the input and output accounts at the pinned key positions, and the signer in the authority slot, and position 6 is CloseAccount of the wSOL ATA back to the operator. What it does not check (Orca vaultA/vaultB, tick arrays, Meteora bin arrays, bitmap, host_fee_in) is validated by the venue programs themselves (the pool program derives/checks its own vaults and arrays), and the on-chain floor binds the output regardless. A tampered builder with write access to the tree is outside the judge's threat model (limit 10(3), stated).

**(f) Account derivation.** I recomputed the Orca tick-array starts (current array, then the two below for a_to_b) and the Meteora bin-array indexes (active, then the two above for Y-to-X). The PDA seeds match the published interfaces (tick_array with the string start index; bin_array with the i64 LE index). At a boundary, the current array starts exactly at the boundary tick. An uninitialised array: Orca accepts them (interpolated as zeroed, per the verdict's C01 measurement); Meteora is unmeasured and remains gate-5 item 6's open obligation.

**(g) wSOL handling.** The wrap is exactly `lamportsIn`; SyncNative follows the transfer; the close unwraps any remainder (including a pre-existing balance) to the operator. A frozen or delegated wSOL ATA would make the swap fail (loud, open cycle). An exact-input swap consumes the entire input, so nothing is left wrapped beyond any pre-existing balance, which the close returns.

**(h) Failure and retry.** Orca is tried first (m2.venues order); Meteora only on a refusal (preflight or on-chain failure, per `classifySendFailure`). An unconfirmed send throws and stops the cycle (never tries the next venue). A confirmation timeout that later lands is caught by the status lookup ('landed') and recorded; one that stays unknown leaves the cycle open with `pendingSwapSig`. Every path leaves the ledger open until the split is proven (`splitSig` or `splitByOther` after the provably-empty check). The ledger cannot read a failed cycle as closed: `cycleIsOpen` requires the split, not the return.

**(i) Adversary extraction within tolerance.** With the 100 bps gate and 150 bps floor, a sandwich or a pool pushed to the gate's edge can extract at most ~150 bps per cycle relative to the oracle's price, plus the oracle's own deviation from truth (unbounded by design, limit 10). At the ruled 10 SOL cap and 6-hour cooldown (~40 SOL/day), the ceiling is ~0.06 SOL/day of extraction within the tolerance, plus whatever the oracle's deviation from truth adds. A manipulated Meteora pool (10x thinner) is only reached when Orca refuses, and the floor still binds. This is within limit 10's stated bound ("do not establish a hard bound on deviation from the true market price").

**The operator key's worst case**: cap × cooldown windows until the guardian stops the sweep, bounded by the revenue PDA's balance above the reserve. The alarm's `sweep_unledgered_state` (account-state derived, unfloodable) detects a thief's sweep within one pass plus the 15-minute grace. The ledger cannot read a failed cycle as closed (`cycleIsOpen` requires the split).

**No new finding in the swap or revenue cycle.**

## R6. The gates

I looked for assertions that cannot fail. The selftest's FLOOR (1004) equals the runner's DET_FLOOR, enforced with `-eq` (equality, not a lower bound). The web floors are per-file (run-all.mjs) and total (WEB_FLOOR 695), both equality-checked. The `audit-coverage.sh` selftest's 19 cases include both positive and negative examples, and the negative cases can fail (a wrong headline credits nothing).

I looked for a floor satisfied by deleting work: the equality requirement means deleting an assertion makes the count fall below the floor, turning the build red. Deleting an entire test file makes run-all.mjs report "did not finish" (the file's count is unreadable), failing the floor.

I looked for vacuous checks: the `release_gate`'s rehearsal branch requires the map to be exactly the five mainnet ids plus the root (read from `web/src/config.js`, not literals), the recorded files to hash to the recorded sha, the reverse map to recreate RELEASE_COMMIT's bytes, and no untracked files in the build paths. The selftest drives each refusal on a disposable git fixture. The `cron-install.sh` preservation logic is extracted and executed in the selftest with both arming and non-arming inputs.

**One gap found (see findings below).**

## web/test/ — can each test fail when its property is broken?

I walked each bundled test file asking the round-37 question. The `plan.test.mjs` arms drive the real `planRedemption` against synthetic snapshots and compare whole serialized messages against the sim's builders — these fail if the plan changes a byte. The `get.test.mjs` refusal arms each check a specific refusal text. The `ceremony.test.mjs` compares each step's instruction against the suite's builder via `diffIx` (full data comparison for SEAL, MINT, BURN; data-with-ruled-threshold for GOV). The `decode.test.mjs` compares the page's parsers against mpl-core's and spl-token's official deserializers. The `meta.test.mjs` drives the generator against a mock connection and checks fail-closed behaviour. The `tx.test.mjs` drives the signing guard with honest, adding, and forging wallets. The `ids.test.mjs` compares every derivation against the suite's, mpl-core's, and spl-token's. The `bundle.test.mjs` builds with the page's browser settings and compares the bundled `judgeLaunch` and `planRedemption` against node's, byte for byte.

## Findings

### INFO-1: The claim test's instruction-data comparison is vacuous; the discriminator is not checked against the suite's builder

**Construct.** `web/test/get.test.mjs`, the claim-instruction comparison:
```js
H.eq('claim: every account, order and flag == the suite\'s ixClaim', diffIx({ ...ref, data: p.ix.data }, p.ix), [])
```
`diffIx` compares programId, data, and keys. Here `a = { ...ref, data: p.ix.data }` — the suite's data is REPLACED by the page's data before comparison, so the data comparison is `p.ix.data.equals(p.ix.data)`, always true. The test's comment explains why (the suite's builder hardcodes its own name/uri; the page's are the ruled ones), and the name/uri and the proof tail are checked in separate arms. But the instruction DISCRIMINATOR (the first 8 bytes, `sha256("global:claim_charter_vault")[..8]`) is compared against nothing. If the page's `planClaim` called `disc('claim_charter')` (a typo), this arm would pass, the tail arm would pass (the proof is at the end), and the name/uri arms would pass.

**What an accident gains.** Nothing moves — a wrong discriminator means the on-chain program refuses the instruction (`InstructionFallbackNotFound`), the claim fails, nothing is burned and no vault is created. The cost is a broken claim page, caught the first time anyone tries to use it.

**Evidence if I am right.** Change `disc('claim_charter_vault')` to `disc('claim_charter')` in `web/src/lib/plan-get.mjs` and run `web/test/get.test.mjs`: every claim arm still passes (the accounts match, the tail matches, the name/uri match). Only the e2e test (programs pass, 132/132) would catch it, by the on-chain refusal.

**Why INFO.** The e2e test sends real claim transactions through the real program on a real validator, and a wrong discriminator is refused on chain. The offline gap is real but covered by a stronger gate. The fix is one line: compare `p.ix.data.subarray(0, 8)` against `ref.data.subarray(0, 8)` in the same arm.

**Class: none** (a test gap, not a code defect; nothing in (a)-(d)).

### INFO-2: The crank's `splitToPool` hardcodes the 15% share rather than reading `cfg.split_bps`

**Construct.** `bank/crank.mjs`, `planCrank`:
```js
splitToPool = total - total * 1500n / 10000n
```
The program's `split_revenue` computes `bank_cut = total * (BPS - cfg.split_bps) / BPS` and `holders = total - bank_cut`. The crank hardcodes `1500n` (10000 - 8500). If `split_bps` were not 8500, the crank's prediction of the pool's post-split balance would be wrong.

**What an accident gains.** Nothing — the prediction only affects the crank's `avail` estimate for planning the distribution. A wrong estimate leads to a planned distribute that the program refuses (`PoolShort` or `NothingToDistribute`, both handled: PoolShort is a failure, NothingToDistribute is a race) or an unplanned distribute that the program would have run (missed, picked up next pass). The program computes the actual split and the actual available; no value is miscredited.

**Evidence if I am right.** Initialize with `split_bps = 8000` (which the alarm pages as `split_not_85_15` CRITICAL and the launch checker refuses) and run the crank: the `avail` prediction is wrong by the 5% difference. The distribute either fails or is missed.

**Why INFO.** `split_bps` is written once at `initialize`, no instruction can change it, the launch checker pins it to 8500, and the alarm pages CRITICAL if it is anything else. The hardcode is safe in every reachable state. The fix is `total - total * BigInt(10000 - Number(cfg.split_bps)) / 10000n`.

**Class: none.**

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?** I re-read the key buyer-facing limits against the code. Limit 10's swap bound is correctly stated (no hard bound on true market deviation; the 150 bps floor is relative to the oracle only). Limit 27's dead-weight cost is correctly stated and correctly scoped to the window between a bare burn and its retirement. Limit 28's freeze consequences are correctly stated (a paying claim reverts whole at the frozen pool; a redemption sends no claim and forfeits). Limit 32's rate limit is correctly stated (the ring bounds the cap at 64, stricter above 3,047 live). Limit 41's transfer-not-limited is correctly stated. Limit 44's destruction is correctly stated (the helper narrows it for classic SPL; the page names what it cannot move). Limit 46's hot-wallet exposure is correctly stated in full (both the end-the-project and capture-governance readings). Limit 47's guardian replacement is correctly stated (half of ALL live vaults at creation, permanent below that turnout). Limit 55's unsplit edge is correctly stated (about an hour of sales while the crank runs). Limit 56's hot $CBOB key is correctly stated. Limit 58's rescue is correctly stated (the live-host-owner window before the rescue lands is disclosed). **None is worse than stated.**

**2. Is anything listed as a limit not actually a limit?** No. Every limit I checked describes a real property of the code.

**3. Is any DISCHARGED item not actually discharged?** I checked items 14 (DuplicateAttribute refused on chain), 19 (activate refuses NotRevealed; no off-chain allocator exists), 30 (split_bps written once; update_wiring deleted), 51 (the boost built in MINT and GOV, mirrored off chain), and 54 (compute measured; the crank sends each capture as its own transaction). **All are genuinely discharged.**

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?** Items 22 (the dress rehearsal, including the revenue cycle through both pools and the forced post-sweep failure), 38 (the three OPEN launch values), 50 (the unpublished holder surfaces), 52 (the pool/Squads/revenue accounts), and 53 (the rehearsal re-run at the release commit) are all still OPEN, all still blocking, and none has been demoted. **No.**

## Verdict

**LAUNCH-CLEAN under SPEC gate 3's launch gate.** Zero CRITICAL, zero HIGH, zero MEDIUM, two INFO (INFO-1 the claim test's vacuous data comparison, INFO-2 the crank's hardcoded split share). Both are in the fixable layer (tests, crank planning), neither is in the five programs, neither moves or miscredits value, neither stops or wrongly refuses a crack, and neither is HIGH or MEDIUM. Both are outside (a)-(d).

The two INFO findings should be fixed and pinned (INFO-1 with a one-line discriminator comparison; INFO-2 by reading `cfg.split_bps`), but neither blocks anything.

---

## What this project should do before launch that AI audit structurally cannot

**1. Witness the deployment ceremony in person, with a second person reading every value aloud.** The four `initialize` calls write values that can never be corrected (limit 38). `check-launch-params.mjs` validates the JSON, but the signed transactions are built from it by a human process (round 24 A6: "whoever builds the four initialize transactions must build them FROM that file"). AI cannot be present at the signing to verify that the transaction's arguments are the file's values. Two people, one reading the file, one reading the transaction preview in Phantom, checking each of the ~20 arguments character by character, is the only control that closes the gap between "the checker passed the file" and "the chain got the file's values."

**2. Run the system, not the tests, for at least two weeks before the lock.** Every AI audit, the suite, the simulation, and the fork are point-in-time. What none of them can find: a state file that grows until the alarm's pass slows past its own interval; an RPC provider that rate-limits the box's `getProgramAccounts` at 2,100 records; the reveal lane's every-minute cadence drifting under disk pressure; the alert router's state directory filling; a cron job's log rotation failing silently. Run the crank, alarm, revenue job, and poster against the rehearsal deployment continuously for two weeks, with the alarm in rehearsal mode, and read every page it sends. A page that arrives at 3 a.m. and is handled correctly is worth more than any assertion.

**3. Physically verify the key custody that the code cannot see.** The $CBOB release wallet's secret is a file on this box (limit 56). The swap operator's key is a file on this box (limit 10). The deploy authority's key is a file on this box (road step 9). AI audit can verify the file permissions (600) but cannot verify: who else has root on this box; whether the nightly backup's encryption key is stored separately from the backups; whether the box's disk is encrypted; whether the provider's support staff can access the volume. Before the lock, one person should physically verify each of these, write down what they found, and have a second person check the list.

**4. Rehearse the failure runbooks by actually doing them, not reading them.** Limit 10's hand recovery ("look up every recorded signature, read the operator's balances, record the hand return, re-run --audit") and the guardian's emergency stops are procedures. AI cannot determine whether a tired human at 2 a.m. can follow them. During the dress rehearsal, deliberately trigger the forced post-sweep failure (item 22.4) and have the person who would be on call actually walk the recovery, end to end, with the real tools, on the rehearsal tree. If they cannot, the runbook is wrong, and that is a finding no audit can produce.

**5. Have a human who was not involved in writing the code read HOLDER-GUIDE.md and try to do the four things.** The guide promises surfaces that are staged, not published (item 50). AI can verify every sentence is true of the code. AI cannot verify that a person who has never seen the repo can find the deposit address, understand the level draw, complete a redemption, and understand what "opening is all or nothing" means. Before the guide is published, give it to someone outside the project with a test vault and watch them try. Every place they hesitate is a place the guide fails a holder, and no assertion catches that.