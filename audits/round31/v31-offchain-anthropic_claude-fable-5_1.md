# Round 31, OFF-CHAIN pass — independent audit of HEAD (the tree bundled above)

**Verdict: no CRITICAL, no HIGH. Four LOW, several INFO, one accepted-limit item that is worse than its text if an unmeasured DAS behaviour goes the wrong way.** Every round-30 repair holds at the sites I could read; one repair (L1) closes the shape round 30 measured but not the class, and the SPEC sentence written for it over-claims. Nothing I found moves value, and nothing I found makes an immutable program wrong. The pipeline's remaining risk is where the SPEC already says it is: it has never run against a live cluster.

For every claim below I say what would exist on chain, in a log, or in a test run if I am right, so it can be checked before anyone spends engineering time on it.

---

## R0. Round 30's verdict and its repairs

I re-derived each confirmed finding and each rejected claim against this tree rather than taking the verdict's word.

**M1 (scan backlog) — repair holds.** `bank/sigwalk.mjs` takes `startBefore`; `bank/alarm.mjs` keeps `backlogs[id] = { head, before }`, resumes from `before`, and moves the cursor to `head` only when a resumed walk comes back short (`else if (sigs.length) { cursors[id] = backlog?.head ?? sigs[0].signature; delete backlogs[id] }`) or empty with positive proof (`below[0].signature === cursors[id]`, else `scan_backlog_unproven` CRITICAL). The undelivered-page branch restores both `cursors` and `backlogs`. I traced three edge orderings by hand: (a) a second gap while draining extends `before` and keeps `head`; (b) `unread > 0` freezes both and re-walks the same window next pass, which is loud (`tx_unreadable`) and never skips; (c) a cleared cursor with a backlog walks to the end of history and proves drain by `getSignatureStatuses(before)` plus an empty `below`. The poster mirrors the same three branches. The selftest's R30 M1 arms drive the real extracted loop and the real `signaturesSince` through a 25,000-signature stub; they are real arms (the stub implements newest-first `before`/`until` semantics, which `scripts/probe-mainnet-facts.mjs` asserts against a live program). I found no regression.

**L1 (truncated-log paging) — repair is correct for the shape measured and incomplete for the class.** See LOW-1 below.

**L2 (crank floor) — repair holds.** `budgetPlan`: the base plan is judged with `floor: 0n`; reveals are budgeted from `lamports − planCost(base) − floor`; `low` warns when the key is already under the floor. The review-30 fix (a key covering the whole plan by one lamport no longer ends at zero) is present: `room` subtracts the floor on every path. Arm `R30 L2` asserts `planCost(small)+1 − spent ≥ FEE_FLOOR`.

**L3 (dust) — repair holds.** `sweepAmount` returns `0n` below `MIN_SWEEP_LAMPORTS`; `revenue.mjs` returns before `market()`. `oracleFloor(0.01 SOL)` is `'ok'` in the arm.

**D1, D2 — present** (`(REHEARSAL)` in the alarm's run-failure, reconcile-failure and RECOVERED texts; SPEC 44 now says "holding a balance").

**Rejected claims re-checked.** C03: `meta.logMessages.includes('Log truncated')` is `Array.prototype.includes`, whole-element; a program's `Program log: Log truncated` cannot match. Correct rejection. C04: an ATA address is a PDA of the ATA program and is created only with the derived mint and owner; MINT's `read_token` pins length, mint and owner. Correct. C01: I also walked every `need()` in `txread.mjs` and found no stranger-reachable refusal on a transaction that lands today (fee payer is always signer+writable; duplicate resolved keys cannot land; `source` is only `transaction|lookupTable`; the money-program `info` fields are always emitted by the RPC parser for the listed types). C09 and C10 I accept as measured.

**The counts.** `DET_FLOOR=898`, `const FLOOR = 898`, SPEC "898 detector"; `MIN_ASSERTIONS=855`, SPEC "855 assertions, real cloned Core"; `SWAP_FLOOR=16` and I count 16 `rec()` calls in `sim/swap-fork.mjs`; `HOST_FLOOR=6` = five `#[test]` + Anchor's `test_id`, and `--lib` runs no doc-tests so the `tail -1` of `[0-9]+ passed` is the unit count. `EXPIRY_FLOOR=4` matches `assert.equal(count, 4)`. Consistent.

---

## R1. The crank (`bank/crank.mjs`)

I traced `planCrank` instruction by instruction against MINT's handlers.

| crank step | program gate it must satisfy | match |
|---|---|---|
| reschedule when `slot > reveal_slot + 300` | `now > reveal_slot + REVEAL_WINDOW_SLOTS` | equal; plan slot ≤ execution slot, so never early |
| capture when `slot > readySlot` | `try_capture` needs A, B, C in SlotHashes; readySlot = C's target with no skips | a skip pushes C later → `RevealTooEarly`, BENIGN, and preflight means no fee |
| reveal from `revealed_total`, stop at first not-ready | `RevealOutOfOrder` | the on-chain FIFO is the authority; the crank cannot send out of order except as a race, which is BENIGN |
| retire `!retired && burned` at any level | `is_burned` tombstone; `retire` needs a level only if active | correct |
| activate: level, live, not pending/active/retired, canonical ATA ≥ 21,000 | `activate` first call | correct; frozen ignored on both sides |
| preJoins: pending, `request_epoch < dist_epoch`, live | `claim` pending path, `dist_epoch > request_epoch` | correct, and the join-only `claim`'s in-line `monthly_inline` returns early on `waiting_to_join > 0` so no month runs before the explicit distribute |
| preExpires: active, boost>0, `dist_epoch ≥ boost_end_epoch` | `expire_boosts` skip rule is the exact complement | correct |
| `w = total + preJoinW − retiringW − expiringW`; `avail = balance+splitToPool − ceil(owed − retiringOwed)`; `acc += avail·1e12/w` | `retire` subtracts `owed_of`; `reweigh` leaves `owed_scaled`; `credit` | correct |
| tick when `w == 0 && pending_this_epoch − retiringThisEpoch > 0` | `distribute` tick branch; `retire` decrements `pending_this_epoch` only for same-epoch requests | correct |
| postExpires at `boost_end_epoch == dist_epoch+1` | `advance_epoch` makes them due | correct; if the distribute raced or failed, `expire_boosts` skips not-due records and lands |
| claim `owed` for joinedNow / preExpired / plain | `join` debt = `w·acc_old`; `expire_boost` carry = owed at `acc_old`, debt = `w·acc_old`; `owed_of` | all three formulas equal the program's, verified by hand (the preExpired case: `atExpiry + w·(acc_new − acc_old)` = `w·acc_new + carry − w·acc_old`) |

Account lists for all nine instructions match MINT's `#[derive(Accounts)]` order. `mintFailureCode` attributes an Anchor error to MINT only when MINT is on top of the invoke stack. `judgeDistributeRefusal` is only consulted after a fresh config read.

**No plan the program refuses for a planning reason, no payment or join of a positively burned vault, no value path.** Two things to know, neither new:

- Refusals cost nothing because `sendAndConfirmTransaction` preflights; a race landing between preflight and execution is the only fee a BENIGN refusal can cost.
- `NoActiveVaults` on the tick (the only this-epoch requester retired by someone else between plan and send) is neither BENIGN nor a race code, so it pages once as a failure. Rare and harmless; mention only.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

### LOW-1. The round-30 L1 repair closes the measured shape, not the grief; SPEC's new sentence over-claims.
**Construct:** `bank/alarm.mjs`, the walk loop: `const ran = [...new Set(ixs.map(ix => ix.program).filter(p => OURS.has(p)))]`; `log_coverage_gap` is a one-shot kind in `ALARM_KINDS`, so `planAlarmNotices` sends it `ALERT_URGENT` with the pass stamp, and every new signature is new text that breaks through the router.
**What a stranger gains:** the same 48-urgent-emails-a-day grief round 30 priced at 0.00024 SOL, by adding one cheap, side-effect-free, *successful* MINT instruction to the padded transaction so that "one of our programs RAN" is true: `expire_boosts(config, <any vault record>)` succeeds and expires nothing when the record carries no due boost; `claim(crank_n=0)` with one `(inactive record, any key)` pair succeeds (`!r.active → continue`). Both are permissionless and take two or three accounts, so they fit beside ~60 memo instructions in a legacy packet.
**Evidence if I am right:** a confirmed transaction with `meta.err === null`, `logMessages` ending in `Log truncated`, a top-level MINT instruction whose discriminator is `expire_boosts` and whose `CBOB_BOOSTS_EXPIRED n=0` line was truncated away; the next alarm pass pages `log_coverage_gap` HIGH URGENT for it. Repeat every pass.
**Why not closable by filtering on discriminator:** the event-emitting MINT instructions (`claim`, `activate`, `mint_vault` via the crank slot, `distribute`) are themselves permissionless, and `claim` is the cheapest of all.
**Fix:** accept the grief and say so, or make `log_coverage_gap` a *level*-shaped stream (one page, 12 h suppression, daily reminder) at the cost of delaying a genuine lost-line page behind a griefer's; or page urgently only once per `logGaps` growth per day. Correct SPEC's "a stranger's padded transaction that merely names one cannot have lost a CBOB line" to add that running one is free. Add a both-ways arm with an `expire_boosts` top-level instruction in the fixture.

### LOW-2. A stranger can create a permanent, unackable daily CRITICAL on any vault for 0.002 SOL, and the ack design's premise excludes it on purpose.
**Construct:** `detectUndeclaredTokenAccounts` (CRITICAL, level, daily `--reconcile`), `ACKABLE_KINDS` excludes `undeclared_token_account` ("every other finding has something an operator can do about it"), and `detectPdaTokenAccounts` (`non_ata_token_account`, CRITICAL, one-shot urgent) when the creating transaction also touches one of our programs (the same two-account MINT call as above makes it scanned).
**What a stranger gains:** a token account for any mint (their own junk mint is cheapest) owned by a vault's asset-signer PDA. Nothing but that vault's redemption can remove it (the sweep helper can sweep a classic one *then*; a Token-2022 one with extensions cannot be declared at all). Until then: one urgent CRITICAL at creation and a CRITICAL in every daily reconcile, forever, on a stream the operator cannot close or acknowledge. The operator genuinely has nothing to do about it, which is the ackable premise.
**Evidence:** a vault PDA owning a 165-byte Tokenkeg account at a non-ATA address (or a 170-byte Token-2022 ATA for a foreign mint); `bank/alarm.mjs --reconcile` output listing it under CRITICAL every day; `acks.json` containing `undeclared_token_account:<asset>` producing "AN ACK FOR THIS FINDING EXISTS AND WAS REFUSED".
**Fix:** either make `undeclared_token_account` ackable with the mandatory expiry (the operator's reason: "stranger dust, sweepable at redemption"), or report it as a transition like freezes (page once, then INFO). The post-hoc nature of this detector means no protection is lost either way.

### INFO-1. A persistently unreadable transaction discards the whole pass's findings, not only the walk's.
`main()` collects `pool_insolvent`, `brake_pulled`, `config_drift`, `distribution_overdue` before the walk and reports after it. A throw from `readParsedTransaction` (an unknown version, a malformed envelope, a provider that omits `logMessages` for an old slot) leaves them unreported except as "ALARM FAILED TO RUN: unreadable parsed transaction: …". SPEC's reader boundary says "the alarm reports a failed pass", so this is disclosed; but the consequence that a brake pull or a pool freeze is then never paged until the walk is unwedged is not. Cheap hardening: call `report()` on the pre-walk findings in the catch, with `fullPass: false`, before rethrowing.

### INFO-2. Two governance outcomes the alarm reads as "armed", not as "broken".
`swap_operator_armed` and `guardian_armed` print the key but never test it. An off-curve pending operator can never sign `sweep_sol_for_swap` (royalty SOL stuck until a new vote); an off-curve pending guardian is a brake nobody can pull. Both need half of all live vaults, so this is a captured-electorate grief, recoverable by vote; but the alarm could say "this key cannot sign" using the `isOnCurve` it already injects into `detectNestedVaults`. One line.

### INFO-3. The revenue ledger and `detectUnledgeredSweeps` are bound to *this box's* operator key.
If a vote installs an operator whose key is not `bank/keys/swap-operator.json`, every honest sweep by that operator is `unledgered_sweep` CRITICAL (no ledger row), `revenue.mjs` dies at the `key` stage every hour, and `royalties_unswept`'s clock resets normally so nothing says "the box is no longer the operator". Worth one sentence in limit 10: the detection half assumes the operator is this box.

**Dangerous states read as quiet — none found beyond the accepted list.** I specifically checked: a frozen pool / vault / revenue account (paged as transitions), insolvency (`owed_scaled` read in the same batch as the pool), reveal stall, armed keys, all five programs past the lock date, PoB collection plugin/authority, Core and the four third-party programs, the brakes, and production values. The one gap that remains is item 22(5), treated below because its consequence is larger than its text.

**Routine states that page every pass:** the ones SPEC already names (`royalties_unswept` under a throughput-capped backlog, `scan_gap` during a drain, `lock_deadline_unset` between deploy and setting the date). No new one.

---

## R3. Layouts (`bank/layout.mjs`, `bank/selftest.mjs`)

The field lists are compared against the Rust by `parseRustStruct` (strict: any unconsumed line throws; `///` doc lines and `#[` attributes are stripped; the suite proves an added field and a retyped field both turn it red). Every `OFF_` constant any program pins is scraped and compared, and the "nothing scraped goes uncompared" arm closes the hand-typed-list defect. The round-24 D6 SEEDS assertion **exists now**: `judgeSeeds` scrapes `pub const X_SEED: &[u8] = b"..."` from each program and compares all eleven, with a mistyped and an unmapped seed proven red. Versions (`L6`), `BOOST_RING`, and `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are scraped and evaluated against `fixedLength`. I recomputed `offsets('VaultRecord').level` = 57 (the crank's memcmp) and `TOKEN_STATE_OFF` = 108; both right. A struct change cannot slip past these.

One minor weakness, not a defect: the comparison uses the *file's* `pub struct` text, so a field whose type alias changes meaning (none exist today) would pass. Record, not fix.

---

## R4. Money arithmetic (`bank/accrual.mjs`)

`credit`, `pendingScaled`/`owed_of`, `reweigh`, `ceilSats`, `available`, `debtAtActivation` are the Rust formulas line for line, including the carry-before-debt order. The crank expires every due boost before it distributes (`preExpires`) and every boost its distribution makes due right after (`postExpires`); the alarm has `boosts_stalled` and treats `cbob_mint`, `max_boost_weight`, `max_boost_epochs` as fixed forever (CRITICAL drift). No divergence found.

---

## R5. The swap and the revenue cycle

**(a) Oracle math.** `sats = lamports · sol · 10^(es−eb) / (btc · 10)` is the correct derivation of lamports/1e9 × (sol·10^es)/(btc·10^eb) × 1e8; the exponent branch handles every sign; both divisions floor (conservative for a minimum). `satsPerLamport`'s `Number()` conversions are far below 2^53 at any plausible price with expo −8. At Orca's 16 bps fee and negligible impact for 10 SOL in ~$10M, and Meteora's measured 16.5 bps under oracle at 10 SOL, the 150 bps floor is comfortably below an honest fill.

**(b) Pyth.** Offsets 40 (level tag), 41 (feed), 73/81/89/93 (price, conf, expo, publish_time) match `PriceUpdateV2` and are consistent with the fork: the real cloned accounts pass the level and feed checks and price within 100 bps of both pools (SW.0), which pins the price and exponent reads independently of the fork's own rewriting of byte 93. Ownership by the receiver plus the derived sponsored PDA is sufficient *given the receiver program*: only Wormhole-verified VAAs are written and only newer `publish_time` is accepted, so an attacker can at most leave the account stale within the 180 s bound. The age is judged on the Clock sysvar, read in the same `getMultipleAccountsInfo` as the prices, from the one trusted RPC (limit 10b).

**(c) Deviation filter.** `orcaSpot = (sqrt_price/2^64)^2` is token-B raw per token-A raw = sats per lamport, the right direction. `meteoraSpot = 1/(1+bin_step/1e4)^active_id` inverts Y-per-X (lamports per sat) to sats per lamport, the right direction for the reversed pair. Float error is ~1e−15 relative against a 1e−2 gate; it cannot pass a pool it should refuse.

**(d) Minimum out.** Orca `other_amount_threshold` with `amount_specified_is_input=true, a_to_b=true` is a minimum on token B raw (sats); Meteora `min_amount_out` is token-out raw (X = cbBTC sats). Both carry `f.minSats`, the same object the deviation filter was computed from.

**(e) The judge.** It checks the output account at key 5, the input account at 3/4, the pinned pool, the signer slot, the exact amount and floor bytes, Orca's two flag bytes and the MIN sqrt-price limit, the ATA creations' six keys, the wrap's keys and amount, SyncNative, exactly one close back to the operator, seven instructions, no priority fee, no second signer. It does not check the swap's key *count* or the vault/tick/bin keys; Orca and Meteora `has_one` those, and an appended Meteora bin array only adds a crossable array. An honest builder defect that survives this is caught after signing by `delta < guaranteed`. As SPEC says, a tampered module in the same tree bypasses nothing by being judged.

**(f) Derivation.** Orca tick arrays: `floor(tick/(88·spacing))·span`, then −span, −2·span, which is correct for a_to_b and for negative ticks via `Math.floor` (−88733/1408 → −64 → −90112, matching the mainnet-pinned arm). `oracle` seeds correct. Meteora: `div_euclid(70)` semantics via `Math.floor`, arrays `i, i+1, i+2` for Y→X (active id rises), `bitmap`/`oracle`/`__event_authority` seeds and the fifteen-account order match `lb_clmm`. An uninitialised array at the boundary makes the venue *refuse* (Orca v1 requires loaded `TickArray`s; Meteora errors on a missing array), which is the loud direction: Meteora fallback, or an open cycle.

**(g) wSOL.** Wrap exactly `lamportsIn`, sync, exact-input swap, close. A pre-existing balance is swept back by the close; wSOL has no freeze authority; a delegate does not block an owner transfer; a stranger-created ATA is the same address. A partial fill is impossible with exact input and the MIN limit, and `delta < guaranteed` would refuse to record it anyway.

**(h) Failure and retry.** Sweep: refused/landed/unknown via the chain's status; an unknown keeps `intendedLamports` and `pendingSweepSig`, the cycle open. Swap: Meteora only on `refused`; `unknown` throws with `pendingSwapSig` and the cycle open. Return and split: `rememberAttempt` and throw; `cycleIsOpen` stays true until `returnedSats` *and* a split anchor exist. The one path that can double-swap is the trusted-RPC boundary round 30 named (C07): "expired and no status" read as refused while the RPC lags, and only when the sweep is within the 0.02 SOL float. I find nothing new.

**(i) Adversary within tolerance, bounded.**
- *Sandwich:* execution is bounded only by the 150 bps floor (the 100 bps gate is read-time). Extraction ≤ (150 bps − venue fee − impact) ≈ 1.3% of the swap: ≤ 0.13 SOL per 10 SOL cycle, ≤ 0.52 SOL/day at the 4-cycles/day ceiling. Pushing Orca's ~$10M pool 1.3% costs the attacker two legs of 16 bps on a trade of order $50–130k (concentration-dependent): ≥ $160 to extract ~$15. On Meteora (~$0.9M, 15 bps base plus a volatility fee), ~$36 to extract ~$15. Uneconomic on both; thinner than Meteora would flip it.
- *Pool pushed to the edge of the gate before our read:* irrelevant to execution; the oracle floor still binds. Same ≤ 1.5% bound.
- *Stale-but-accepted oracle (≤180 s):* the floor follows the stale price, so the bound widens by SOL/BTC's 3-minute move: worst realistic ≈ 2.5% → ≤ 0.25 SOL per cycle. Only a sandwicher realises it.
- *Per month:* at full throughput and an adversary on every cycle, 15–30 SOL theoretical; proportionally 1.5–2.5% of whatever royalty SOL actually flows. Not material against the stated 1.5% tolerance, and the holder guide already says "up to 1.5% … and further if Pyth's own price is off".

**Operator key worst case, restated:** 10 SOL per 6 h until `emergency_stop_sweep` (alarm cadence 30 min plus a human), never more than the revenue PDA holds above 0.05 SOL, plus the 0.02 SOL float. What it trusts: the two pool programs, the Pyth receiver/push programs, the one RPC, and this box. The ledger cannot read a failed cycle as closed: `cycleIsOpen` needs `returnedSats > 0` and a split, `rejected_row_has_sweep` and `sweep_on_rejected_row` catch a refused row that hides a sweep, and `unledgered_sweep` catches a sweep with no row at all.

A fork gap worth closing (recommendation, not a defect): the fork proves refusal at +5% and acceptance at honest prices, but never *executes at the floor* against a pushed pool. One arm that trades $50k through the cloned Orca pool first, then runs our swap and asserts `got ≥ minSats` and `got < expectedSats·0.99`, would make the (i) bound measured rather than argued.

---

## R6. The gates

- `run-tests.sh`: every floor is equality; failing sub-selftests print their tail before `die`; the mainnet probe and the fork may not be skipped under `CBOB_SHIP_GATE=1`. No vacuous floor found.
- `bank/selftest.mjs`: the round-24 section's arms are two-directional where they can be (H1 via a mutated kinds table; L1 via a verbatim round-24 judge that passes all eight tampers; L10a–d, L11, I5 with quiet controls). Three arms are textual regexes only (`/nowSec: chainSec,/`, `/plan\.split && payDecimals === null/`, `/ALERT_URGENT: '1'/`); round 28 added an extracted-fragment arm for the crank clock, and the other two guard one-liners. Acceptable, recorded.
- `sim/swap-fork.mjs` SW.6b is a near-tautology (Orca instructions judged as Meteora trivially fail). Cosmetic.
- `scripts/build-mainnet.sh` proves what it says for the four (behavioural reject/accept) and for the sweep helper (byte identity with both the localnet rebuild and `target/deploy`); it refuses a dirty tree and records the commit. It does not and cannot prove the compiled constant *is* Gary's key; its banner says so.
- `scripts/cron-install.sh` arms nothing new; the rehearsal marker refuses installation; the preserve logic is the one tested.

### INFO-4. The crank's once-a-day fee warning marks itself as sent even when delivery fails.
`try { execFileSync(NOTIFY, …) } catch {}` then `fs.writeFileSync(WARNED, …)` unconditionally. A failed notify silences the honeypot or low-floor warning for 24 h. The alarm and revenue both keep their marker on failed delivery; this is the one notifier that does not. Evidence: a notify exit ≠ 0 in the crank log with `.crank-fee-warned-floor` freshly stamped. Fix: write the marker only on success.

### INFO-5. Rehearsal streams for the crank and revenue are not isolated by SPEC's instruction.
Item 53 tells the rehearsal to redirect `ALERT_STATE_DIR`/`ALERT_LOG` *for the alarm*; the crank's `cbob-vault-crank:*` and revenue's `cbob-revenue:*` streams go to the same router untouched (`rehearsal-tree.sh` only prints "tell Gary"). A rehearsal lane failure that is not followed by a rehearsal recovery leaves a production-named stream open, and production's first failure on that label after launch would be suppressed for 12 h. Fix: state the redirection for all three jobs, and add REHEARSAL to the crank's and revenue's texts the way D1 did for the alarm.

### INFO-6. The poster halts permanently on a `null` `getTransaction`.
`if (!tx) throw` with the cursor unsaved. A signature the RPC lists but whose transaction it returns as null (provider inconsistency) wedges every later hand run at that signature, where the alarm's equivalent (`unread++`) re-tries and pages. Hand-run and documented as "not advancing past it"; recording and skipping after N consecutive nulls would be kinder.

### INFO-7. Round-30 M1's own cost disclosure is incomplete.
"It costs US up to 20,000 `getTransaction` reads per flooded program per pass" — at 48 passes/day that is ~1M reads/day per flooded program against the one Helius key every job shares. Quota exhaustion turns into `tx_unreadable`/`run_failed` across the alarm *and* fetch failures in the crank and revenue, which the sentence does not say. A flooder spending 0.1 SOL a pass can thus degrade the money jobs' RPC, not only delay detection. Mitigation is provider-side (a dedicated key or rate class for the alarm) and belongs in the dress-rehearsal checklist.

---

## The accepted limits — the four questions

**1. Worse than stated.**

- **Item 22(5) (OPEN): the DAS `burnt` question carries more than the labelling of one finding.** `listVaults` sorts by `i.burnt`; if Helius *omits* burned Core assets from `getAssetsByGroup` instead of flagging them, then (a) `detectIndexShortfall` sees `live + burnt < minted_total` after the first redemption and pages `index_disagrees_with_chain` CRITICAL (level, unackable) on every pass, forever; (b) every honest redemption appears as `vault_left_index`, which `correlateBurns` deliberately does **not** downgrade ("a burn does NOT quiet vault_left_index"), so the one detector that exists to see a bare burn fires CRITICAL on every exit. SPEC's item 22(5) reads as settling a label; the dependency is the completeness check and the bare-burn discriminator themselves. **Evidence that settles it:** one `getAssetsByGroup` against a collection known to hold a burned Core asset; if the burned id is absent rather than `burnt: true`, both consequences follow from the code as written. Do this before any other rehearsal item.
- **Limit 25:** the default web3.js `Connection` (no `fetch` timeout, no `confirmTransactionInitialTimeout`) is still what `crank.mjs`, `revenue.mjs` and `alarm.mjs` construct; round 25 A1's 300 s hang stands exactly as measured. Not worse than stated, but the text's "(the crank's and revenue's at `2b67fb1`)" could be read as fixed. It is not.
- **Limit 10:** the SPEC's "pages only when one of our five programs actually RAN" (reader coverage boundary) is the over-claim in LOW-1.

**2. Not actually a limit / already closed.** None found. Items 29, 35, 36, 37, 49 are accurate as written. Item 44's round-30 correction is right (the helper closes a frozen zero-balance account).

**3. Discharged items not discharged.** None. Item 51 is built in MINT and mirrored; item 54's measurements are cited by arm; 30, 31, 33 are discharged by `initialize` parameters the suite exercises.

**4. OPEN AND BLOCKING quietly accepted.** None. `charter_opens_at` and `lock_deadline` are `null`/OPEN in `launch/mainnet-init.json` and the checker refuses; item 50's page does not exist; item 53's `rehearsal-init.json` is named as not built; item 22 has never run. The holder guide is still marked DRAFT.

---

## Holder promises against the code

Every sentence I checked is true of this tree. Two imprecisions, both in the holder's favour and not findings: "If Coinbase freezes your vault's cbBTC, you cannot open it at all" is true for a *funded* frozen account (a frozen empty one is closed by the helper, round 30 D2); "Activation is picked up automatically" assumes the crank is armed, which is a launch step. The guide's 1.5% swap statement, the 2.1%/hour wording ("vaults still sealed" = live supply), the boost ceilings, the first-payout timing, and the honest list match the programs and `bank/`.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

What an AI round structurally cannot do is *run the real system against the real world and the real adversary*. Concretely, before the authority is removed:

1. **Settle item 22(5) first, with one RPC call,** because two detectors' semantics depend on it (above). If DAS omits burned assets, change `listVaults` to derive `burnt` from the MINT `VaultRecord` set (`retired` or BURN's count) before the rehearsal, not after.
2. **Run the dress rehearsal with an adversarial day scripted in advance:** the two griefs in LOW-1 and LOW-2, a 20,001-transaction flood against the throwaway MINT id, a stranger's deposit during a redemption, a bare burn, a vault transferred to its own PDA, a forced Orca refusal (Meteora path), a forced post-sweep failure and its hand recovery under a clock, an RPC that accepts and never answers (round 25 A1) during a mint burst. Record every signature and every page the router actually delivered, and compare against what SPEC says should page. The gap between those two lists is the audit no model can perform.
3. **Build the artifacts on a second machine from the release commit** and compare `dist/SHA256SUMS`; verify the deployed bytes from a *different* RPC provider than Helius. The key proof in `build-mainnet.sh` is as good as it can be; only reproducibility bridges "rejects the test key" to "is Gary's key".
4. **Put a witness alarm off this box** (another host, another RPC key, read-only, the same `bank/detectors.mjs`), because limit 10's residue is that whoever owns this box owns the ledger, the crank, the alarm and two hot keys at once. Even a dumb witness that only runs `detectUnledgeredSweeps` and `detectPoolHealth` breaks the single point of silence.
5. **Make the `set-upgrade-authority --final` ceremony witnessed and verified from outside:** two people, the five program ids read aloud, `solana program show` from a second RPC afterwards, and the alarm's `prog.*.upgrade_authority == IMMUTABLE` snapshot archived. After this step every finding in every future round is permanent.
6. **Fix the measurable small things in this report in one commit before the freeze round that counts,** since any `bank/` change resets the counter anyway: LOW-1's SPEC sentence and a decision on urgency, LOW-2's ack scope, INFO-4's marker, INFO-5's rehearsal isolation. Then two clean rounds with different rosters, as the gate says.