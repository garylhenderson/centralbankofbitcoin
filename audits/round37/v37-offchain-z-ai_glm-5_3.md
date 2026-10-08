# Round 37, off-chain pass: findings

I read the whole tree as given. I verified every round-36 repair at its site, re-tested the claims the verdict disproved, and audited the crank, alarm, layouts, accrual, swap, revenue cycle and gates from first principles. I found one LOW defect and no CRITICAL, HIGH or MEDIUM. I state my measurement limits honestly at the end.

## R0. Round 36's verdict and repairs

**All five LOW repairs hold in this tree.** I verified each at its site and its selftest arm:

- **L1 (SPEC C5 text):** the "Known limits" C5 bullet now says "The sweep helper cannot handle it at all, because it always closes what it sweeps and the close reverts the whole call (round 36 L1)" and describes the page's plain-transfer fallback. The old false sentence ("can move the token out but cannot close") is gone.
- **L2 (SPEC rescue text):** item 58 now reads "always to the CBOBTC Squads (whether the host lives, is burned, or is the vault itself; review 35 M1)". Limit 44's heading reads "a nested vault is not (round 36 L2: it is rescued, item 58)". The rejected "to the host's owner while the host lives" text is gone.
- **L3 (`unredeemable_owner` text):** `detectNestedVaults`' off-curve branch now names the host-owner execute and the burned-host `rescue_nested`, and does not say "sealed for good". The selftest arm (`R36 L3:`) checks both the presence of the remedy words and the absence of the old phrase.
- **L4 (`ACKABLE_KINDS`):** the set is now `new Set(['unredeemable_owner'])`. The selftest arms (`R36: nested_vault can NO LONGER be acked`) check that `nested_vault` and `vault_owns_itself` acks are refused at full severity while `unredeemable_owner` still acks. The old "still acks" arm is replaced.
- **L5 (SPEC C10 text):** the limit now reads "any lag seen by a pass pages once, however short, and is followed by an ALL CLEAR when the next pass reads a complete index." The selftest arm (`R36 L5:`) checks the alarm's 30-minute interval exceeds the router's 25-minute grace, which is the fact that makes the new text true.

**The verdict's rejected claims:** I re-tested C06 (the sweep's `isSigner: false` key list). The selftest's `R36 C06` arm extracts `revenue.mjs`'s actual sweep builder, compiles it with a fresh operator keypair, and asserts the operator is account 0, a signer, and the only required signature. This is correct: web3.js 1.98 makes the first signer the fee payer, and `compileMessage` marks the fee payer as a signer in the header; the runtime's `is_signer` comes from the header, not the instruction's flag. C07 (HOST_FLOOR=6 including `test_id`) is consistent with Anchor 0.31.1's `declare_id!` generating a `#[test]`. C08 (the crank skips the free launch tick on a frozen pool) is correct behaviour, not a defect: a tick during a freeze would only create eligible vaults that cannot join (a frozen pool refuses every claim), and `launch_tick_overdue` pages during the freeze. C17 (a nested vault's weight is not "dilution") is correct: payouts accrue in the vault's own wallet and travel with it.

**No regressions from the repairs.** The `ACKABLE_KINDS` narrowing does not affect any other detector. The `unredeemable_owner` text change is display-only. The SPEC text changes are documentation.

## R1. The crank

I could not find a plan the program will refuse, a plan that pays or joins a dead vault, a reveal sent out of order, or value moved anywhere the program does not pin.

- **Joins and claims check asset liveness positively.** `planCrank` skips `'burned'` assets for both preJoins and claims, reports `'other'` (unreadable) as a problem and excludes it from every batch, and retires burned vaults before joining anything. A burned pending vault is retired, never joined.
- **The reveal lane is strictly ordered and hash-checked.** The loop breaks on the first skip, mismatch, failure, or benign race. `revealAttrSource` sends `[]` only for a positively burned asset. `judgeRevealAttrs` distinguishes send / revealed-elsewhere / mismatch, and a tampered list carrying `level` is still a mismatch.
- **The distribution plan is conservative.** The tick is planned only when `waitingThisEpoch` survives subtracting this pass's retires; the credit only when the pool is readable, unfrozen, due, and has weight and available balance; the owed computation for pre-joined and pre-expired vaults matches the program's join and expiry arithmetic exactly (I recomputed both).
- **The fee budget never strands the key.** `budgetPlan` runs the base plan whenever the key covers it, keeps the floor in reserve on every branch, and drops reveals in mint order with a page for the dropped ones.
- **Only MINT permissionless instructions are sent**, pinned by the selftest's instruction-name and program-id gates.

## R2. The alarm

I could not find a dangerous on-chain state it reads as quiet, or a routine state it pages on every pass.

- The WATCH list covers every fixed-forever initialize value at CRITICAL, every vote-reachable value, both brakes' transitions (paged once, standing at INFO), all five programs' upgrade authorities and bytes, Core, the four third-party swap programs, both collections' plugins, and the PoB collection's authority. `missingWatchedKeys` fails the pass if the reader stops producing any of them.
- Routine states (supply growth, accumulator movement, epoch advancement, sweep timestamps, rate-ring entries) are status, not alerts, and are deliberately excluded from the drift list.
- The pool health, distribution overdue, redemption rate, reveal stall, crank silence/posture/health, revenue account, unswept royalties, sweep state, log gaps, and scan backlogs are all driven both ways in the selftest.

## R3. The layouts

The assertions are real. `parseRustStruct` compares field names AND types against the Rust source, and throws on any line it cannot parse as one `pub name: Type,` field (so a private or multi-line field cannot slip through as "equal"). The cross-program offset gate scrapes every `OFF_` constant from all three programs and compares each against the layout's computed offset, with an explicit "none scraped and ignored" check. The seed gate (round 24 D6) scrapes every `pub const *_SEED` from the Rust and compares it to `L.SEEDS`, both ways. The version gate and the space gate (round 24 L13c, scraped and evaluated) close the remaining routes. A struct change that adds, removes, retypes, renames, reseeds, re-versions, or resizes a field fails the build.

## R4. The accrual

I recomputed `credit`, `pendingScaled`, `reweigh`, `ceilSats`, and `available` against the Rust. They are identical, including the truncation direction (BigInt and Rust integer division both truncate toward zero for positives) and the refusal on debt-above-entitlement. The crank expires due boosts before the distribution and post-distribution-due boosts after it, matching `BoostsExpireFirst`. The alarm pages `boosts_stalled` and watches `cbob_mint` and both boost bounds as fixed forever.

## R5. The swap and revenue cycle

**(a) Oracle math.** `sats = lamports × SOL_USD × 10^(es−eb) / (BTC_USD × 10)` is dimensionally correct for both feeds at expo −8 and for any sign of `es−eb`. Integer division floors both `expectedSats` and `minSats` (conservative). `Number(price)` for Pyth i64 prices at expo −8 is within safe-integer range; a corrupted huge price produces an absurd `satsPerLamport` that the deviation filter rejects on both pools, failing closed.

**(b) Pyth verification.** The `PriceUpdateV2` offsets (disc 8, write_authority 32, verification_level tag at 40, feed_id at 41, price at 73, conf at 81, expo at 89, publish_time at 93) are consistent between `readPyth`, the selftest fixture, and the fork sim's rewriter. The account is a PDA of the push-oracle program (shard 0, feed id), owned by the receiver program; only the receiver can write it, and the receiver verifies Wormhole VAAs. The age is judged against the Clock sysvar (the chain's clock), with a 30-second future bound. The residual (a Wormhole-guardian-signed stale or manipulated price within 180 s and 30 bps confidence) is the accepted, stated limit.

**(c) Deviation filter.** `orcaSpot` = (sqrt_price/2^64)² in raw cbBTC-per-lamport units; `meteoraSpot` = 1/(1+bin_step/10⁴)^active_id in the same units (X = cbBTC, Y = wSOL, reversed from Orca, and the code reverses correctly). Both compare against `satsPerLamport` in the same units. Float error is ~14 orders of magnitude below the 100 bps threshold.

**(d) Minimum out.** The floor rides at data offset 16 on both venues (after disc 8 + amount 8), in each program's expected output units (cbBTC base units). It is the same oracle-derived floor the deviation filter assumed (both from the same `oracleFloor` call), with the stated caveat that the read-time filter does not bind execution.

**(e) The judge.** It requires the exact seven-instruction sequence with positional destructuring, checks the CU limit (400k, no price instruction anywhere), both ATA creations' exact keys, the wrap's exact amount and destination, SyncNative, the swap's program/pool/input/output/signer/amount/floor/direction, and the single close. Within its threat model (our own defects, not a tampered tree), I could not construct a misrouting that passes it: the output account, floor, amount, direction, and both ATA owners are all pinned by position and value. The unpinned Orca tick arrays and Meteora bin arrays are validated by the pool programs themselves (they are PDAs of the pool), and a wrong derivation fails on chain with nothing moved.

**(f) Account derivation.** Orca tick arrays: `["tick_array", pool, String(start)]` with starts [current, −span, −2span] for a_to_b. Meteora bin arrays: `["bin_array", pool, i64 LE index]` with indexes [floor(id/70), +1, +2] for Y→X. Both match the programs' published derivations. The bitmap extension and `host_fee_in` are passed as the program id (Anchor's None). At a boundary or uninitialised array, the pool program refuses; nothing is lost.

**(g) wSOL handling.** Wrap exactly `lamportsIn`, sync, swap exact-input, close. A pre-existing wSOL balance survives (the close returns all lamports to the operator). A frozen or delegated ATA fails on chain. Nothing is left wrapped.

**(h) Failure and retry.** Orca first; Meteora only on a refusal (preflight or on-chain failure, distinguished by `classifySendFailure` asking the chain). An unconfirmed send throws and the cycle stays open; a landed-and-succeeded send is recorded; a landed-and-failed send is a refusal (nothing moved) and the next venue is tried. No path double-swaps. Every path leaves the ledger open until the return is proven (the cycle closes only on `splitSig` or `splitByOther`).

**(i) Adversary extraction within tolerance.** The binding constraint is the 150 bps on-chain floor below the oracle's expected output. A sandwich on a 10 SOL swap in the $10M Orca pool moves the price by roughly 2×1700/10⁷ ≈ 3.4 bps per leg; in the $0.9M Meteora pool, roughly 76 bps for both legs. A pool pushed to the edge of the 100 bps read-time gate plus impact could approach but not exceed the 150 bps floor before the pool program refuses. The bound is 150 bps of 10 SOL ≈ 0.15 SOL per cycle, ≈ 18 SOL per month at the maximum 4 cycles/day, and only if every swap is adversarially executed to exactly the floor. This matches the SPEC's stated bound.

**Operator key worst case:** the sweep cap (10 SOL per 6 h) until the guardian stops it. The alarm pages within 30 minutes (`sweep_unledgered_state` is flood-immune). The ledger cannot read a failed cycle as closed: `cycleIsOpen` treats a moved-swept-no-return cycle as open, a returned-no-split cycle as open, a refused cycle as closed, and a never-moved cycle as closed; the `rejected_row_has_sweep` and `sweep_on_rejected_row` checks catch contradictory rows.

## R6. The gates

- **Floors must EQUAL counts.** `run-tests.sh`'s `floor()` and the suite's `MIN_ASSERTIONS` check use `-eq`, not `-ge`. Deleting work drops the count below the floor and fails. The selftest's `FLOOR = 920` requires `R.length === FLOOR` exactly.
- **The SPEC's stated counts are checked at every occurrence** by the selftest's regex map, with a non-empty requirement (zero occurrences is a failure).
- **The round-24 both-direction arms.** I checked the specific repairs: the distribute race codes (moved/unmoved epoch, PoolShort never benign), `revealAttrSource` (burned/live/other/undefined), the split destination blockers (frozen pool/bank/absent), the fee payer minimum-first, `budgetPlan` (floor preserved on every branch), the retiring-frees-owed plan, the chain clock, the crank lane notices, the alarm's kind classification, the crank posture, the carried baseline, the reserve-read judgement, the index race, the ledger-held-to-chain checks, the forfeit event, the freeze transitions, and the rehearsal seam. Each has a both-direction arm. I could not find one that is not armed both ways.
- **`build-mainnet.sh`** proves what it says for all five programs: the four keyed programs are behaviourally asked (mainnet rejects the test key, localnet accepts), and the sweep helper's byte identity is proven against both the script's own rebuild and `target/deploy` (what the suite deployed). The `NOT PROVEN` section honestly states the limits.
- **`cron-install.sh`** arms nothing it should not: the preservation logic reads only tagged, uncommented, correctly-suffixed lines; a commented line, prose, or another project's line arms nothing. The selftest runs the actual preservation block.

## Finding

**LOW-1: the reconcile cron lane has no liveness detector.** The alarm watches the crank (`crank_silent`, `crank_posture_unreadable`), the watcher (the deadman switch on the alarm state file), and the revenue lane (`royalties_unswept`). The reconcile lane (`19 4 * * * ... alarm.mjs --reconcile`) has nothing. If its crontab line is removed, commented out, or never installed, the daily completeness reconcile silently stops: `state.json.reconcile` goes stale and nothing reads it for freshness, and no detector notices the lane's absence. A wedged reconcile holder is caught (the next day's run gets `ELOCKED` and pages `reconcile_failed`), but a *missing* lane is not. Until the redeem page is published (item 50), the reconcile is the only detector for token accounts created in transactions that touch none of our programs, which `detectPdaTokenAccounts` structurally cannot see. *Evidence if I am right:* remove the reconcile line from the crontab and run the alarm; no finding of any kind is produced, on any pass, indefinitely. *Fix:* read the reconcile state file's `at` timestamp in the 30-minute pass (it already exists) and page a `reconcile_stale` HIGH when it is older than, say, 48 hours, exactly as `crank_silent` does for the crank's heartbeat; or extend `crankPosture` to check for the reconcile line's presence in the crontab it already reads.

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?** I could not find one. I specifically re-derived the operator key's worst case (cap × windows, bounded by the guardian stop and the alarm's 30-minute cadence), the Coinbase freeze consequences (a frozen pool forfeits rather than locks; a frozen revenue ATA halts splits and paid mints, both stated), the redemption rate limit's ring bound (64 covers live supply to 3,047; max_supply is 2,100), the PoB hot wallet's per-asset alarm blind spot (stated), and the rescue's Squads-return custody rule (stated). Each matches its stated bound.

**2. Is anything listed as a limit not actually a limit?** No. I checked the candidates: limit 9 (foreign nested assets undetected continuously) holds because the redeem page is unpublished; limit 27 (a claim between a bare burn and its retirement) holds because the program's `claim` join path does not check asset liveness; limit 25 (the re-roll) holds because capture is optional on host instructions.

**3. Is any DISCHARGED item not actually discharged?** No. Items 51 (the boost), 54 (compute), 12/17 (compute units), 14 (duplicate attributes), 19 (the unlevelled-vault halt), 30/31/33 (the vote-reachable cadence and notice), and the fourteen v5 Bank/deck/distributor items are all genuinely gone or closed by the stated mechanism.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22 (the live-chain rehearsal), 38 (the launch values, with `charter_opens_at`, `lock_deadline` and `vault_collection` still OPEN in `mainnet-init.json`), 50 (the holder surfaces, built and staged, not published), 52 (the pool/Squads/revenue accounts), and 53 (the rehearsal tree, with the rehearsal value set still to write) all remain open and are not demoted anywhere in this tree.

## Measurement limits

- I did not run the suite, the simulation, the fork, the alarm, the crank, the revenue job, or the poster. My verification of the round-36 repairs is against the source as given, plus the selftest arms' presence and shape.
- My check of the Pyth `PriceUpdateV2` offsets is against the code's internal consistency (reader, fixture, and fork rewriter all agree) and my recall of the Pyth layout; I did not read a live Pyth account.
- My verification of the Orca and Meteora account derivations is against the published IDLs as I recall them; the fork test (16/16, a `run-tests.sh` gate) is the executable proof and I did not re-run it.
- The `collectionPluginsHash` and PoB-collection-authority offsets (key at byte 0, 32 raw authority bytes at 1-32, strings from 33) are consistent with MINT's own `initialize` reads (`d[1..33]`, `o = 33`) and with the suite passing against real cloned mainnet Core; I could not independently re-derive Core's serialized layout from memory and did not attempt to refute the suite's evidence.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Run the dress rehearsal with the named pass/fail items, and have a second human witness it.** Item 22's five named items (the crank's live passes, the alarm's rehearsal passes, one full revenue cycle through each pool, one forced post-swap failure walked through hand recovery, one DAS read of a burned collection) are the only tests of the operational pipeline against a live chain. An AI audit can read the code; it cannot experience the RPC timeouts, the rate limits, and the hand recovery under pressure. Record every transaction signature.

2. **Test the alert delivery path end-to-end with a real page to a real phone, before launch.** The entire detection story ends at `/opt/scripts/notify-gary-sms.sh`. If Gary's phone is dead, the number changed, or the email goes to spam, every CRITICAL in this system is silent. Send one real urgent alert and one real recovery, and confirm a human reads them. Add a second recipient on a different device and carrier.

3. **Move the $CBOB release wallet off the box before anything mints.** Limit 56 states the exposure: 2.1 billion $CBOB on a hot key in `bank/keys/cbob-release.json`, in the nightly backup. The fix is Gary's call and is named in the limit. Make the call before launch, not after the first boost vote switches on.

4. **Have a non-technical person read HOLDER-GUIDE.md and explain it back.** The guide's plain-English promises are checked against the code by the audit process, but whether a holder *understands* "the validator producing the last of those blocks can pick among several results" is a human question. If they cannot paraphrase the honest list back, the disclosure is not working.

5. **Rehearse the lock.** Removing the upgrade authority is a one-way, irreversible act performed by a human at a terminal. Rehearse it on the rehearsal tree (the deploy rehearsal already exists; extend it to the `set-upgrade-authority --final` step), and have a second person verify each program's prefix hash and zero tail immediately before and after.

6. **Subscribe to Metaplex, Orca, Meteora, and Pyth upgrade notifications, and write the response runbook now.** The alarm detects a third-party program change at HIGH; what a human does in the following hour is not written anywhere. For Core specifically: a change to `BurnV1`'s tombstone or `ExecuteV1`'s authority rule reaches every vault and cannot be adapted to. Write down, before launch, what the guardian stops and what the Squads does in each scenario.

7. **Monitor the slow-moving operational facts the alarm cannot see: the box's disk (the alarm state, the seenSplits list, and the log gaps grow), the crank key's balance, and the operator key's float.** Each has a stated bound; none has a page for its own exhaustion. A weekly human check of disk usage and key balances closes what the detectors structurally cannot.