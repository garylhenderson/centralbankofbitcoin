# Round 46, OFF-CHAIN pass — independent audit of the whole tree

**Verdict up front: I could not substantiate a new CRITICAL, HIGH or MEDIUM in the bundled off-chain code. All six round-45 off-chain repairs hold at their sites. I verified them by reading, re-derived the arithmetic and the account lists against MINT's bundled source, and re-tested the two claims round 45 disproved (the deviation-filter units and the hardcoded 1500). What follows is the evidence, the answers to the specific questions, a small number of INFO-level observations, and the honest statement of what I could not check.**

Under the launch gate (SPEC gate 3): no finding in the five programs, no value path, no refused crack, no HIGH or MEDIUM. The findings below are LOW/INFO in the fixable layer.

---

## R0. Round 45's verdict and its repairs — each verified

**V45o-1 (null SEAL reserve read, LOW).** The repair is present at all three sites. `alarm.mjs`'s per-pass maps now take `ataMints = cfg['seal.reserve_mints'] || D.carryConfigBaseline(prev?.config, cfg)['seal.reserve_mints'] || D.RESERVE_MINTS` (the `ataOwner`/`atas` block); the balance block keeps the V44o-3 carried list with the `unbuilt` carry-and-page; and `reconcile()` now reads `reserveList = cfg['seal.reserve_mints'] || D.carryConfigBaseline(readState()?.config, cfg)['seal.reserve_mints']` and **throws** when neither exists, landing in the `reconcile_failed` handler rather than judging. The three fallbacks differ cosmetically (ruled three / cbBTC-only-plus-carried-legs / refuse) but every one is the safe direction: a canonical ATA creation reads INFO, an unbuilt stored leg is carried and paged `balance_unreadable`, and the reconcile refuses. The selftest's R45 V45o-1 arms drive the real extracted blocks both ways. **Repair holds.**

**V45o-2 (rehearsal switches read after the sweep, LOW).** `revenue.mjs` now calls `refuseStrayOverrides()` at module load and reads `FAIL_AFTER_SWEEP` / `FORCE_ORCA_REFUSAL` via `rehearsalFlag` at top level, before `main()` and therefore before the sweep send. The selftest's R45 V45o-2 arm checks source order (top-level statements before `async function main(`) and that `main()` calls `rehearsalFlag` nowhere. I verified the source order directly: the four statements sit between the `NOTIFY` line and `const ARGS`-adjacent module constants, all before `main` is defined. **Repair holds.**

**V45o-3 (frozen-pool overdue text, INFO).** `detectDistributionOverdue` now takes `poolFrozen` and emits the non-blaming text ("because the community pool's cbBTC account is FROZEN... There is nothing to run by hand"); `alarm.mjs` passes `poolFrozen: !!pool?.frozen`. Both selftest arms (frozen vs unfrozen control) are present. **Repair holds.**

**V45o-4 (unreadable retry count survives a flood, INFO).** `carryUnreadPasses(prev, now, attempted)` keeps prev entries for signatures not in `attempted`, takes `now` for those attempted, and drops entries that were read or skipped. `alarm.mjs` populates `looked.attempted` for every signature it actually tried (failed-on-chain signatures are skipped before the read and so never counted — consistent, since they are never attempted and never counted). The state write is `D.carryUnreadPasses(prev?.unreadPasses, looked.unreadNow, looked.attempted)`. The selftest's flood arms (flood before/after X's first and second pass, budget 2) pin the bound at `UNREADABLE_SKIP_PASSES - 1` held passes in every shape. **Repair holds.**

One residual I traced and judged safe: on a pass whose **page is not delivered**, the rollback list (`next.config`, `cursors`, `balances`, etc.) does not include `unreadPasses`, so retry counts advance on undelivered passes. This is defensible: the signatures *were* attempted (a fact about the chain reads, not a finding baseline), and the eventual skip pages as `tx_skipped_unreadable`, a level condition that re-asserts every pass until a human clears it. There is no silent path. Not filed.

**V45o-5 (coverage selftest ordering, INFO).** `audit-coverage.sh` now parses `--selftest` before the `never` check and skips the freeze exit in selftest mode; the python's `GATE_SELFTEST` branch runs the gate's own 19 cases and exits on them. The selftest's R45 V45o-5 arm builds a throwaway git fixture with one never-bundled tracked file and proves `--selftest` still prints 19/19 while the freeze check still exits 1. **Repair holds.**

**V45o-6 (crank floor wording, INFO).** `budgetPlan`'s low-key text now reads "this pass ran its base plan, sent no reveals, and is below the floor. Top it up." **Repair holds.**

**Round 45's disproved claims, re-tested:**

- **The deviation-filter units (Longcat C01).** I re-derived them independently. `orcaSpot = (sqrt_price/2^64)^2` is token-B-raw per token-A-raw; the pinned pool has A = wSOL (1e9/SOL), B = cbBTC (1e8/BTC), so the squared Q64.64 ratio is sats per lamport. `meteoraSpot = 1/(1+binStep/10^4)^activeId` inverts the pair's Y-per-X price (lamports per sat) into sats per lamport. `oracleFloor`'s `satsPerLamport = Number(sol.price)·10^es / (Number(btc.price)·10^eb) / 10` is sats per lamport. All three are the same quantity; the comparison is dimensionally correct. The `10_000` divisor in `meteoraSpot` is confirmed in the source. **The disproof holds.**
- **The hardcoded 1500 (GLM C24).** The crank's `splitToPool = total - total * 1500n / 10000n` hardcodes 15%, and MINT's `initialize` writes `DEFAULT_SPLIT_BPS = 8_500` as a constant — it is not an `initialize` argument, so "initialize with 8000" is not expressible. The alarm pins `split_not_85_15` CRITICAL and the launch checker requires 8500. **The disproof holds.**
- **The bitmap-dust claim (Fable C02).** I cannot re-measure mainnet from here. Reading the code: `bitmapExists: !!bm` checks existence, not ownership. If the extension were ever absent and a System-dust account sat at the PDA address, the Meteora swap would name it and DLMM would refuse (wrong owner) — a loud venue refusal handled by the venue loop, not a silent loss. The residual (whether DLMM can ever close the extension) is unmeasured and round 43's gate-5 item 5 stays open, as the verdict said. I concur with the verdict's disposition and its recommendation that an owner check in `market()` is cheap hardening.

**What I could not verify:** the driver files (`scripts/rehearsal-run.mjs`, `rehearsal-steps.mjs`, `rehearsal-recover.mjs`) are not in this bundle — they ride in the programs pass, as round 45's V45o-7 recorded. `bank/selftest.mjs` imports them and tests their pure functions (I read those arms), but no off-chain seat has read the implementation behind them. The round-46 prompt names the gap, which is the "or name the gap" half of V45o-7's repair; the split itself persists by design. Not a new finding; stated as a coverage limit.

---

## R1. The crank

I traced every instruction the crank builds against MINT's bundled `Accounts` structs, field by field:

- **reveal_level**: keys `[config(mut), record(mut), asset(mut), collection(mut), payer(signer,mutable), mint_authority, slot_hashes, mpl_core, system]` — matches `RevealLevel` exactly; data is `disc + Borsh Vec<VaultAttribute>` matching `attrsBorsh`.
- **claim**: `[config(mut), pool(mut), token_program, (record, ata) pairs]` with `crank_n = 0` — matches `Claim`.
- **split_revenue**: `[config(ro), revenue(mut), mint(ro), revenue_ata(mut), holders_ata(mut), bank_ata(mut), token_program]` — matches `SplitRevenue`, config correctly read-only.
- **distribute / activate / retire_burned / expire_boosts / rescue_nested**: all match their structs (the selftest's R43 arm pins the rescue key list including signer/writable flags; I re-checked it against `RescueNested`).

**A plan the program will refuse?** The only systematic case is captures planned at `readySlot`, which is a no-skip lower bound; when slots are skipped the hashes exist later and the capture is refused `RevealTooEarly` — benign, no page, one fee. This is the documented design ("a NotYet answer is harmless"). The distribute race (a host's in-line month landing between plan and send) is handled by `judgeDistributeRefusal` with a fresh config re-read, and `PoolShort` is never a race. I specifically checked the interaction the ordering invites: a join batch's `monthly_inline` cannot fire the month early, because `monthly_inline` returns without crediting while `waiting_to_join > 0` — the program's own `JoinWaitingFirst` gate protects the crank's join-then-distribute order. The last join batch *can* fire the month (all eligible joined), after which the explicit distribute is benignly skipped and the split's 85% waits one period — a one-pass liveness cost, not a correctness issue.

**A plan that pays or joins a dead vault?** No. Claims skip `assets === 'burned'` and report `'other'`; preJoins and post-joins skip burned and report unreadable; the preJoin condition `request_epoch < dist_epoch` matches the program's `dist_epoch > request_epoch` exactly; `preJoinWeight` uses `LEVEL_WEIGHTS` (matching `join`, which cannot include a boost).

**A reveal out of order?** No. The loop runs strictly from `revealed_total`, breaks at the first missing/already-revealed/not-ready record, and the send loop additionally breaks on skip/mismatch/benign — the V43o-3 arms run the real extracted loop and prove a null asset read ends the run before anything is sent.

**Value movement?** The selftest's instruction-name enumeration (`activate, capture_entropy, claim, distribute, expire_boosts, reschedule_reveal, rescue_nested, retire_burned, reveal_level, split_revenue`) and the no-transfer/no-other-program regex both hold; I re-read the source and found no SPL transfer, no System transfer, and no non-MINT `programId` in any send. The fee budget (`planCostLamports`/`budgetPlan`) counts every transaction the send loops emit, including rescues and all batch ceil-divisions, and the reveals keep the floor in reserve on every branch (R30 L2 arms).

The owed math for the three claim shapes (joined-this-pass, pre-expired, normal) matches the program's `join`/`expire_boost`/`owed_of` exactly — I re-derived each (details under R4).

---

## R2. The alarm

**A dangerous state read as quiet?** I walked the watch list, the standing risks, and the detectors against MINT's config fields and could not construct one:

- Every fixed-forever field is in `WATCH` at CRITICAL; the five program upgrade authorities and hashes (sweep included) plus Core and the four third-party programs are watched; the two collection plugin hashes and the PoB update authority are watched.
- `missingWatchedKeys` is asserted to cover every key the watchers read, and the selftest's both-ways arms (a dropped key is named; an absent program is exempt only via `_missing`) hold.
- The pool insolvency check reads `owed_scaled` from the same fresh config read as the pool balance (the round-22 A2 repair is in place).
- The sweep state check (`detectSweepState`) is account-derived, uses the smallest cooldown ever seen capped at 6 h, and an uncertain send explains a sweep only when a direct status lookup confirms it landed.
- The alarm walks SEAL/MINT/BURN/GOV. I checked whether anything dangerous could live only in SWEEP-program transactions: a direct call to the helper moves only the caller's own holdings (measured round 34), and every helper-via-Core call is part of a redemption that also touches SEAL and BURN (the pairing is enforced on chain), so it appears in the BURN walk with the helper's instructions visible as inner instructions. No gap.

**A routine state that pages every pass?** No. `sales_stopped`, `sweep_stopped`, `guardian_retired`, `joins_waiting`, `sweep_cooldown_wedged`, `sweep_cap_wedged` are all INFO (never paged). `joins_stalled`/`boosts_stalled` require 6 h past the last distribution, which the hourly crank prevents. The production value list is quiet at the ruled values (the selftest's "the ruled values are QUIET" arm drives the imported alarm directly).

The V45o-1 repair sites, the heartbeat/problem streak machinery, the frozen-transition once-only paging, and the per-kind router streams are all present and armed both ways in the selftest (I traced the H1 router sequence against the real router harness — it is executed, not regexed).

---

## R3. The layouts

The assertions are real. I verified:

- `parseRustStruct` throws on any line it cannot read as one `pub name: Type,` field (the L1 strictness), so a private, `pub(crate)`, or multi-line field aborts the gate rather than silently dropping out of the comparison.
- The field-list comparison is order-sensitive (`JSON.stringify` of ordered arrays), so a reorder is caught, and the selftest's mutation arms (a field added, a type changed under the same name) are shown able to fail.
- Every cross-program `OFF_` constant scraped from GOV/BURN/MINT is compared against the computed offset, and the L2 arm proves no scraped constant goes uncompared.
- The round-24 D6 seed assertion **does now exist**: 12 seeds scraped from each program's `*_SEED` constants, both ways (a mistyped seed and an undeclared seed are caught).
- `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are scraped from the Rust, evaluated, and held to the layout's fixed lengths minus padding, with a mutation arm.
- The fast-lane `memcmp` filter uses `offsets('VaultRecord').level` = 57, which is a fixed offset (all preceding fields are fixed-size). Valid.

A struct change could not slip past these without also changing the version byte (which `decode` refuses) or failing the field-list equality. I could not construct a bypass.

---

## R4. The money arithmetic

`accrual.mjs` mirrors MINT line for line; I re-derived each:

- `credit`: `delta = avail·1e12 / w` (floor), `acc += delta`, `owed += delta·w` — identical to MINT's `credit`, including the floor division.
- `pendingScaled`: `(weight + boost)·acc + carry − debt` with a negative refusal — identical to `owed_of` (carry added before the debt is subtracted, matching the Rust's `checked_add(carry).checked_sub(debt)`).
- `reweigh`: owed → carry, debt restarts at the new weight — identical.
- `ceilSats`, `available` (clamped at 0 where the program refuses `PoolShort` — the documented, alarm-reported difference), `debtAtActivation` (level weight only, matching `join`).

The crank's expiry ordering is correct and complete: every due boost (including on unreadable-asset vaults, which `expire_boosts` does not need the asset for) is expired before the distribution; every boost the distribution makes due (`end_epoch == dist_epoch + 1`) is expired right after; the program's `BoostsExpireFirst` gate therefore never binds the crank's own next distribution. The alarm pages `boosts_stalled` and watches `mint.cbob_mint` and both boost bounds as fixed-forever CRITICAL drift.

---

## R5. The swap and the revenue cycle

**(a) The oracle math.** Verified: `sats = lamports·sol·10^(es−eb−1)/btc`, correct for every sign of `e = es − eb` (both exponents are range-checked to −18..0 at the read *and* at the floor). BigInt throughout the sats computation — no overflow is possible. `expectedSats` and `minSats` both floor, so the floor is genuinely below the oracle's expectation. The `satsPerLamport` `Number()` conversion can lose precision only above 2^53, unreachable for USD-priced feeds in the −18..0 exponent range, and it feeds only the 100 bps pre-filter where a 1-ulp error is ~10^−14 bps — it cannot pass a pool the filter should refuse. The selftest's hand-pinned vector (280,355 expected / 276,149 floor at 150 bps) is arithmetically correct (I recomputed it).

**(b) Pyth verification.** The `PriceUpdateV2` offsets recompute correctly: disc(8) + write_authority(32) + verification tag(1 for `FullyVerified`) + feed_id(32) = 73, then price/conf/expo/publish_time. The account is a derived PDA (shard-0 u16 LE + feed id) under the push oracle, and ownership by the receiver is checked. Ownership plus derivation is sufficient on Solana's account model: only the owner program can write data, and the receiver verifies Wormhole VAAs before writing. A stranger cannot plant a fully-verified update with a chosen price; a compromised receiver is Pyth's key, watched at HIGH. The clock is the Clock sysvar (owner-checked in `market()`), and both stale and future-dated `publishTime` are refused (180 s / 30 s), with the exponent range refusing any exponent that could inflate the floor arithmetic.

**(c) The deviation filter.** `orcaSpot` and `meteoraSpot` are both sats-per-lamport in the correct direction (verified above under R0). Floating-point error on the 100 bps comparison is ~10^−14 bps — cannot matter. A pool pushed to the gate's edge *below* the oracle passes the filter but fails the on-chain floor (150 bps); the swap refuses on chain and the venue loop handles it loudly. That is the designed layering: the filter is a pre-filter, the floor is the hard bound.

**(d) The minimum out.** Yes — same oracle read, and the units are right on both venues: Orca's `other_amount_threshold` is token-B raw (sats) for a_to_b; Meteora's `min_amount_out` is X raw (sats) for Y→X. The judge verifies the exact threshold bytes on both.

**(e) The judge.** It checks: the output account is the operator's own cbBTC ATA (key 5 on both venues), the minimum-out bytes, the amount, the Orca direction/price-limit/exact-input bytes, the Meteora in/out accounts by position, the authority slot, both ATA creations (payer/account/owner/mint/system/token), the wrap amount and destination, SyncNative, the single close back to the operator, exactly seven instructions in exactly that order, no second signer, and no `setComputeUnitPrice` (disc 3). A ComputeBudget instruction cannot drain the key: any eighth instruction fails the count, and instruction 0 must be exactly `SetComputeUnitLimit(400000)` with 5-byte data. **What a tampered builder can still route past it:** the tick arrays / bin arrays / Orca oracle account / the venue vault accounts — none are position-checked by the judge. This is the stated residue (round 44 C01, round 25 D1): the venue programs validate their own pool-owned accounts and a wrong account fails on chain, loudly, with the floor and the post-swap delta check still binding the output. I concur with the stated disposition; the fork test is the proof that the honest derivations are right.

**(f) Account derivation.** Orca: the three tick arrays for a_to_b are current, one-below, two-below, derived with the start index as a decimal string — matches Orca's published derivation, and the fork's real swaps through the real program prove it. A tick exactly on an array boundary starts that array (selftest arm). Meteora: active, then the two above (Y→X moves the active bin up), index as i64 LE, `Math.floor` for negative ids (selftest arm). At a boundary or an uninitialised array the venue program refuses — loud, handled by the venue loop.

**(g) wSOL handling.** Wrap exactly `lamportsIn`, sync, swap (exact-input consumes exactly the input or fails — there is no "consumes less" case), close. A pre-existing wSOL balance: the swap still consumes exactly `lamportsIn`; the leftover either causes the close to fail (whole transaction reverts, nothing moved, cycle open and loud) or its lamports go to the operator — either way the cycle's own funds are untouched and the delta check binds. Frozen: the swap's transfer refuses, whole transaction reverts. Delegate: the owner can still transfer; and the judge forbids any Token instruction but SyncNative and the close, so an Approve cannot ride along. The round-33 gate-5 arm ("a stranger's pre-filled wSOL account") covers the pre-fill case in the suite. The fork's SW.1a proves the normal case spends exactly the input and leaves nothing wrapped.

**(h) Failure and retry.** Orca first (market() pushes orca before meteora); Meteora only on a REFUSED outcome (preflight refusal, landed-and-failed, or expired-unlanded — `classifySendFailure` reads the signature's status with history). An unconfirmed send throws and never tries the second venue. A confirmation timeout on a swap that later lands: the automatic path records `pendingSwapSig` and stops; the next run refuses at the open-cycle guard; only hand recovery (which checks statuses and balances first) can double-swap — the runbook says so and the ledger's `pending*Sig` fields are evidence, not permission. No path double-counts: `swapSig` is set once from either the confirmation or the landed verdict. No path reads a failed cycle as closed: `cycleIsOpen` requires a split (not just a return); a refused sweep is closed only because nothing moved (and a row carrying both `sendRejected` and a sweep is itself a CRITICAL, `rejected_row_has_sweep`); a swap-landed-return-failed cycle stays open and alarms. A returned-but-unsplit cycle self-heals through the crank's hourly permissionless split plus the recovery block's `closesCycle`/`isProvablyEmpty` — and where the split scan refused a read, the job stops naming the signature (V44o-2, verified present).

**(i) What an adversary can extract within the tolerance.** The on-chain floor is the binding bound: the output is at least 150 bps under the oracle's expected output. A sandwich must keep the pool within 100 bps of the oracle at read time and then push it before execution — but the floor is in the transaction, so a push past 150 bps under the oracle simply fails the swap. The maximum extraction per cycle is therefore ~150 bps of the swept amount plus any staleness gap (the oracle may be up to 180 s old and 30 bps wide; a stale oracle below the true price loosens the floor relative to truth by up to the staleness). At the 10 SOL cap that is ~0.15 SOL (~$18) per cycle, and at the effective ~34 SOL/day throughput (round 37 C05) an absolute ceiling of roughly 0.5 SOL (~$60) per day, ~$1,800/month, **if every cycle were maximally extracted**. The cycle size makes this immaterial in practice: pushing a $10M Orca pool 150 bps and trading back costs more in fees and impact than the entire extraction, and the Meteora fallback (~$0.9M) is reached only when Orca refuses. The residual is the stale-oracle case in a fast market, which the SPEC already states honestly ("These checks do not establish a hard bound on deviation from the true SOL/cbBTC market price").

**The operator key's worst case, re-bounded.** What the key trusts now: the two pool programs and Pyth (each upgradeable by third parties, watched at HIGH — detection, not prevention), the one RPC endpoint (a compromised RPC feeds fake oracle/pool reads, making the floor fake — stated in limit 10(b)), the box, and the tree. The theft bound is unchanged from limit 10: cap × cooldown windows until the guardian stops it, never more than the revenue PDA holds above the reserve — with the new element that a third-party *program* compromise makes the per-cycle theft total rather than 150 bps-bounded, which is exactly why the alarm watches their bytes. The ledger cannot read a failed cycle as closed (verified above).

---

## R6. The gates

**Assertions that cannot fail:** I hunted specifically for these and found none. The floors must EQUAL their counts (round 19's repair, in `floor()`, `MIN_ASSERTIONS`, `FLOORS` in run-all.mjs, and the selftest's own `FLOOR`); a deleted assertion lowers a count and fails the floor; a deleted file fails "did not finish"; `everywhere()` requires a non-empty match set so a floor SPEC stopped mentioning fails; `audit-coverage.sh` exits 2 rather than reporting coverage when git lists nothing.

**The round-24 both-directions claim:** I traced every round-24 arm family — H1 (streams, one-shots, router sequence, defang), L1 (distribute race, three codes × moved/unmoved + PoolShort), L2 (reveal attr source, plus the V43o-3 extracted-loop arms), L3 (split destinations, four cases), L4a/b/c (posture, health, streaks), L5 (drift across a blip, both directions), L6a/b (fee floor, four quadrants plus the R30 reserve arms), L7 (reserve reads with the false-`reserve_fell` control), L8 (three-reserve correlation with the no-redemption control), L9 (index race, four cases), L10a-d (ledger held to chain, each with its honest control), L11 (split anchoring, both directions), I1 (retirement frees owed, with the nothing-retiring control), I2 (chain clock, run as written), I3 (forfeit, both programs), I5 (freeze transitions, new/same/thaw/refreeze), D5 (rehearsal seam, four env values), M1 (the swap: eight tampers × two venues, with the round-24 judge as a control proving each arm can fail). **I could not find one that is armed in only one direction.** I am reporting that honestly rather than manufacturing one.

**build-mainnet.sh for all five:** yes. The four keyed programs are behaviourally probed in both directions (mainnet rejects the test key, localnet accepts it) via `ask`/`ask_seal`; the sweep helper, which has no key, is proven by byte identity — mainnet bytes == the localnet build == `target/deploy` (the build the suite and sim actually deployed), plus the exactly-five-programs check and the dirty-tree refusal. The one thing it cannot prove (the compiled constant *is* Gary's key) is stated in its own output.

**cron-install.sh:** it arms exactly the six tagged jobs; both money jobs are opt-in (`--live` preserved only on our own tagged, uncommented lines, matched to end-of-line so `crank-reveal` cannot arm the full pass — the L12 arms run the real preservation block through bash); the rehearsal marker is refused before anything is touched; the deadman is plain `test`/`find` and fires on a missing state file as well as a stale one.

---

## web/test — can each test fail when its property breaks?

Judged file by file:

- **bundle.test.mjs**: the browser-settings bundle is actually built and imported; `judgeLaunch`'s bundled output is compared to node's on three inputs (refuse, pass, refuse-bad-root); the bundled `planRedemption` is run on six synthetic snapshots and compared to node's byte-for-byte through a canonicalising serialiser — a bundle that diverged in any instruction byte, refusal, ack, or note fails. The static dist checks are regex-based (CSP, viewport, SRI, no external hosts, no em dash) — weak against format drift in the loud direction, but each names a property whose absence fails the regex. The L4 release-binding arms run the real `web/build.mjs` against a faked dist and refuse wrong commit/dirty/sums, with a control. Non-vacuous.
- **ceremony.test.mjs**: the gate is `check-launch-params`' own `judgeLaunch` (refuses today, passes filled); every step's instruction is `diffIx`-compared to the suite's own builders extracted from source (not copies); the post-step checks name every field of every struct and catch each mutated field; the decoy/unverified/creator arms drive `resolveCollection`/`collectionCreator` with synthetic signature histories including failed creates, stranger front-runs, and padded histories, each with a control. Non-vacuous.
- **decode.test.mjs**: the page's parsers are compared against the official `deserializeAssetV1`/`deserializeCollectionV1`/`AccountLayout` on hand-built bytes, including burned, truncated, unknown-plugin, and frozen shapes. Non-vacuous.
- **ids.test.mjs**: every derivation is compared to the suite's, mpl-core's `findAssetSignerPda`, spl-token's ATA (both token programs), and the BPF loader derivation; the program-bytes pins are compared to `dist/SHA256SUMS` with a changed-hash control. Non-vacuous.
- **meta.test.mjs**: the generator is driven against a mock connection; the fail-closed arms (picture down, reads down, wrong collection, no state, older slot, undrawn-after-drawn, missing earning account, gone-after-gone) each assert the previous file is kept byte-for-byte, with fresh-read and absent controls. Non-vacuous.
- **plan.test.mjs** (169 assertions): the plain case is compared as a whole legacy message against the sim's S8 builders; every item-50 rule is driven both ways (I traced the H1 stranger vectors, the C5 close-authority cases, the V38-2 press/consent machinery with its adversary, the V39-1 promised-account re-reads, the rate-limit ring). Non-vacuous.
- **tx.test.mjs**: the signing guard refuses a wallet that adds an instruction and one that forges a signature; the error names come from the programs' own generated list, checked current against the source. Non-vacuous.
- **run-all.mjs**: exact floors per file, "did not finish" on a crash. Non-vacuous.

I could not audit `ix.test.mjs`, `get.test.mjs`, `proxy.test.mjs`, or the e2e runner and fixtures — they ride in the programs pass (round 45's GLM C23 disproof rests on `ix.test.mjs`, which I therefore cannot independently re-verify in this bundle; I note it as unverifiable here, not as disproved).

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?** I attacked each buyer-facing and money-adjacent limit and found none worse than its written form. Specifically re-derived: limit 10's bound (cap × windows, with the third-party program keys and the RPC now named as what is trusted — accurate); limit 32's ring bound (cap 64 covers live supply to 3,047; above that it is stricter, and max_supply 2,100 makes it moot); limit 28's freeze consequences (all four account classes stated, including the split halt and the paid-mint refusal); limit 55's 100-$GARY boundary case; limit 58's rescue window (the crank's hourly full pass plus the permissionless call, with the host-owner window stated); limit 27's cost attribution (every other holder, via the diverted return). The swap tolerance (150 bps + staleness, bounded above under R5(i)) is stated as not a hard bound, which is accurate.

**2. Is anything listed as a limit not actually a limit?** No. I specifically re-checked limit 43 (the CPI-wrapper measurements WR.1–WR.4 pin it), limit 35 (10.71% > 10%, so the turnout rule cannot bind at the ruled numbers), and limit 42 (the narrow 1,219-byte shape is honestly labelled an offline measurement, not the page contract).

**3. Is any DISCHARGED item not actually discharged?** No. Item 54's measurements are cited and its residual (the pages' CU-limit obligation) is correctly parked under item 50; items 51, 19, 14, 12/17 are closed by construction or measurement as stated.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are all still open in the round-45 verdict and VALIDATION ("Unchanged: items 22, 38, 50, 52 and 53 remain OPEN AND BLOCKING"), and the tree is consistent with that: `charter_opens_at`, `lock_deadline`, and `vault_collection` are still OPEN in `launch/mainnet-init.json` and `check-launch-params` refuses while any is OPEN; the rehearsal's mainnet items (22.3–22.5) are recorded NOT-RUN-HERE, not claimed done. Item 53's release-commit re-proof is recorded as done, which discharges the *stale-proof* half of the item; the item itself remains open for the mainnet rehearsal, which is road step 8.

---

## Other findings

**INFO-1 — the guide's bare-burn sentence has an unstated exception (limit 27's grief).** HOLDER-GUIDE.md ("How you get paid") says burning the vault any other way "gives a credited share that has not been delivered back to the pool." That is the default (`retire_burned` returns it), but limit 27's grief — a stranger claiming the dead vault between the bare burn and the crank's retirement — pays that share into the burned vault's own account, destroying it instead of returning it. The burner's outcome is identical either way (they lose it), so the sentence is not false about the holder's own result; but the "back to the pool" clause has an exception the honest list does not carry. Limit 27 is not marked BUYER-FACING, so this is a wording choice, not a broken promise. *Evidence if right:* `claim`'s pending/active branches never check the asset (MINT `claim`), and the crank retires burned vaults hourly — the window is real and stated in SPEC. *Fix:* one clause in the honest list, or mark it accepted as-is.

**INFO-2 — the off-chain bundle still cannot see the rehearsal driver it tests.** `bank/selftest.mjs` imports `scripts/rehearsal-run.mjs` and exercises fourteen of its pure functions; the file itself rides in the programs pass. The round-46 prompt names the split, which satisfies the "or name the gap" half of V45o-7's repair, so this is not a surviving defect against that verdict — but it means the driver that will move real SOL on mainnet during the rehearsal has been read only by the programs roster, and the off-chain roster's only visibility is through arms written by the same author. Carried, stated, not re-filed as new.

**INFO-3 — `signaturesSince` reports `gap: true` when it stops at exactly maxPages of full pages, even if no more signatures exist.** With the alarm's budget (2 pages × 1,000), a window of exactly 2,000 new signatures yields one false `scan_gap` HIGH page; the next pass resumes from the recorded backlog, proves it drained, and clears it. This is the honest answer ("I stopped without knowing whether more exist") and the loud direction by design. Not a defect; recorded so nobody re-files it as one.

---

## Measurement limits of this pass

- Nothing was executed. No validator, no suite, no fork, no alarm pass, no revenue job, no router delivery, no mainnet read. Every claim above is a reading of the bundled source, cross-checked against MINT's bundled source and the recorded constants.
- The rehearsal driver (`rehearsal-run/steps/recover.mjs`), `web/src/` (the pages themselves), `tests/3prog.test.ts`, `sim/test-vault.ts`, `web/test/{ix,get,proxy}.test.mjs`, and the e2e runner/fixtures are not in this bundle; their round-45 validations are taken as recorded, not re-proven. Round 45's GLM C23 disproof rests on `ix.test.mjs` and is therefore unverifiable here.
- The canonical-run logs (`e7c192a-*`, `chainclock-*`), the driver's local-chain record, and the rehearsal-tree proof are cited by the VALIDATION but not bundled; I confirmed the floors they claim match every floor constant in the bundled runners (912 / 1032 / 695 / 68 / 24 / 39 / 4 / 14 / 35 / 16), which is consistency, not execution.
- The bitmap extension's existence on mainnet, the fork's 16/16, and the driver's net-0.105-SOL run are round-45 measurements I could not repeat.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what should this project do before launch that AI audit structurally cannot?

1. **Have a human who did not write this code walk the whole holder journey on the rehearsal deployment with a real wallet.** Buy with Phantom, wait for the draw, fill all three reserves, vote, boost, redeem — and send a stray token and a nested vault first, to see what the page actually shows. The e2e test drives a real browser against a mock, but it asserts what the author thought to assert; a fresh human notices a deposit address that displays wrong, a consent box that does not say what it does, or an error message that names the wrong thing. Forty-six rounds of reading have never once experienced the page.

2. **Re-derive every pinned third-party fact from primary sources, by hand, once.** The two pool addresses and their token order and fee tiers (from Orca's and Meteora's own UIs/docs), the Pyth feed ids and the sponsored-account derivation (from Pyth's docs), the 240 PoB addresses and the Merkle root (from an explorer), the CBOBTC Squads' ATA existence, the five claimed program ids. Every AI check in this tree is *internal* consistency — layout.mjs == web config == Rust == launch JSON — and a wrong value copied into all of those places passes every gate. One human with an explorer closes the one class of error this whole process cannot see.

3. **Hold the launch gate on the rehearsal's recorded transaction signatures, not on the driver's exit code.** The driver was written by the same process that wrote the jobs it rehearses; its PASS measures what it was built to measure. Items 22.1–22.5 should be signed-off by a human who has looked up each recorded signature on an explorer and confirmed it did what the item names — especially 22.3 (both pools) and 22.4 (the forced failure walked through hand recovery, which is the one procedure that can double-swap).

4. **Pay one genuinely independent party to attack the rehearsal deployment.** A bug bounty or a small external pentest against the pages, the sweep helper, and the redemption path, with a budget. Forty-six rounds of adversarial *reading* have never executed an attack; the difference between reasoning about a sandwich and running one is the difference this system's remaining risk lives in.

5. **Physically audit the box's key custody.** The crank key, the swap operator key, the $CBOB release wallet, the deploy authority: a human should verify file modes, backup encryption and restore, that no key material sits in shell history, process environments, logs, or the `.cache` symlink, and that the offline copy of the deploy authority actually exists and restores. No AI round has ever inspected the box; every claim about it is testimony.

6. **Have a fresh human read HOLDER-GUIDE.md against the code, sentence by sentence.** Round 24's confirmed falsehoods were all in that file, and the guide is the buyer-facing contract. A reader who has not seen the sentence forty times catches what a model that has internalised it cannot.

7. **Write down, before the charter opens, who watches the first 48 hours and what triggers pulling the guardian brake.** The alarm pages; only a person can act. The launch gate's (a)–(d) protect the code; nothing in this tree protects the launch itself except a named, awake human with the guardian wallet.