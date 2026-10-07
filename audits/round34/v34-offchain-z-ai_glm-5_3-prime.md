# Round 34, OFF-CHAIN pass — independent audit of the whole tree

**Verdict: NOT CLEAN.** One MEDIUM, two LOW, all new (none is a re-file of a carry item). Round 33's four repairs verified present and holding at their sites; one leaves a stated-but-unbounded residual (my L1). Everything else I attacked — the crank's plan, the alarm's detectors, the layouts, the mirrored arithmetic, the swap's oracle/judge/derivation, the gates — I could not break, and I say so with the checks I ran rather than as a compliment.

I read; I did not execute. Where I claim a defect, I state the run that would show it. Where I claim a repair holds, I state the trace I followed.

---

## Findings summary

| ID | Sev | Construct | One line |
|---|---|---|---|
| M1 | MEDIUM | `bank/redemption-poster.mjs` `main()` → `draftPost` | The poster wedges permanently on the first redemption of a never-revealed vault; every later redemption goes undrafted, forever. |
| L1 | LOW | `bank/detectors.mjs` `detectSweepState` | The round-33 clock repair widened the window instead of translating domains; a box/chain clock off by more than half the smallest cooldown seen (3 h at the ruled 6 h) still false-pages CRITICAL on every honest sweep. |
| L2 | LOW | `bank/selftest.mjs`, round-24 block | The round-24 claim "every repair armed in BOTH directions" is false for the source-regex-only arms; the reveal-try arm stays green if the catch is changed to rethrow. |

---

## R0 — Round 33's verdict and its repairs

Round 33 was **NOT CLEAN** (1 LOW, 3 INFO, one Gate-5 obligation). I verified each repair against this tree:

- **L1/D1 (sweep window + uncertain sends):** `detectSweepState` now uses `|t − st| ≤ cooldown/2` with `cooldownSecs` = the smallest ever seen (persisted as `sweepCooldownSeen`, rolled back on undelivered pages, capped at 21,600), and a `pendingSweepSig` explains only when the alarm's direct `getSignatureStatuses` lookup (`landedSigs`, built in `alarm.mjs` main) shows it confirmed/finalized and error-free. I traced the thief-exclusion argument: a thief's sweep must sit a full current cooldown after the honest one, and `revenue.mjs` writes a row only after its own cooldown gate, so `t_thief − st_honest ≥ cooldown − ε > cooldown/2` for any honest row shape (confirmed, refused, or uncertain-landed). The selftest arms the boundary both ways at ±10,800 and ±10,801 and at a 3,600 s cooldown, plus the row-offset equivalents of +300/−3,700 s skew. **The repair holds.** Its residual is my L1 below.
- **D2:** `'mint.last_sweep_at'` is in `WATCHED_KEYS` with a membership arm. The verdict asked for "named by `missingWatchedKeys`"; the implemented arm checks list membership, and the general `missingWatchedKeys` behavior is separately armed both ways. Substance met; the specific behavioral arm is a nit, not a finding.
- **D3:** the launch-count reader now matches "47 launch" and the R33 D3 arm plants a stale 48. Verified against SPEC's Running-the-tests block and `LAUNCH_FLOOR=47`.
- **Gate-5 (pre-filled wSOL close):** described as R33.G4 with the on-chain floor moved 861→866. `tests/3prog.test.ts` is not in my bundle, so this is read-only verification against VALIDATION's record and the runner's floor-equality gate. Boundary stated.

Round 33's own measurement limits (stub clock, no validator) are recorded in its verdict; my L1 lives exactly in the gap it left.

---

## R1 — The crank

I hunted specifically for the four asked failures and did not find them. What I verified:

- **A plan the program will refuse.** I checked every instruction shape against MINT's `Accounts` contexts field-by-field (`reschedule_reveal`, `capture_entropy`, `reveal_level`, `retire_burned`, `claim` with `crank_n=0`, `expire_boosts`, `split_revenue`, `distribute(false)`, `activate`) — all match, including writable/signer flags and the `split_revenue` config being read-only. The only refusals the plan can produce are the disclosed benign races (`BENIGN`, `judgeDistributeRefusal` with the fresh-config re-read, `PoolShort` never benign), plus the disclosed wasted-fee case of a capture sent when skipped slots pushed the real A/B/C past `readySlot` (classified `RevealTooEarly`, benign, no page — disclosed in the crank's own comment).
- **A plan that pays or joins a dead vault.** `assets[r.asset] === 'burned'` is skipped in claims and preJoins; `'other'` (null RPC) is reported as a problem and, for an eligible waiter, suppresses the whole distribution (matching the program's `JoinWaitingFirst`). Retire runs first, at any level.
- **A reveal out of order.** The plan walks `revealed_total` upward and breaks at the first not-ready; the send loop breaks on fail, benign, skip, `revealed` and `mismatch`. A stale `revealed_total` (traffic revealed between the config read and the record read) breaks at a `level !== 0` record before anything is sent.
- **Unpinned value movement.** Every instruction is `programId: MINT`; no transfer of any kind is built; the selftest pins the discriminator name set and the absence of any token/SOL transfer. The split's 85% is hardcoded (`splitToPool = total − total*1500n/10000n`) — round 32 C12, covered, `split_bps` is CRITICAL-watched.
- The arithmetic mirrors (`pendingScaled` with boost/carry, the preExpiry at-the-old-accumulator owed, the `joinedNow` debt at `weight × cfg.acc_scaled`, `retiringOwed` freeing the retiring share before the distribution, the tick planned against this pass's same-epoch retirements) all match MINT's `owed_of`/`reweigh`/`retire`/`join`/`tick` line for line. `budgetPlan` keeps the floor in reserve on every branch (round 30 L2 holds).

**No new finding in the crank.**

---

## R2 — The alarm

- The round-32/33 sweep backstop, log-gap watermark machinery, backlog draining with positive proof, per-transaction `tx_unreadable` handling, and the undelivered-page rollback of every baseline (including `sweepJudgedThrough` and `sweepCooldownSeen`) all trace correctly.
- Dangerous-read-as-quiet: the remaining quiet holes I could construct are the disclosed ones (foreign nested assets, per-asset PoB plugin changes, DAS 30-minute sampling, only-latest `last_sweep_at`, `royalties_unswept` quiet while the sweep brake is deliberately on). Nothing new.
- Routine-pages-every-pass: `joins_waiting`, `sweep_cooldown_wedged`, `sales_stopped` are INFO by design; the freeze transitions page once and stand at INFO; the `revenue_age_unknown` migration fires once and its rollback re-fires only while undelivered. Nothing new.
- The poster is the alarm family's public channel, and it is where my MEDIUM lives (filed under "anything else" below, since it is not one of the numbered targets).

---

## R3 — The layouts

The assertions are real: `parseRustStruct` is strict (a private or `pub(crate)` line throws), the field lists are compared name-and-type, every cross-program `OFF_*` constant any program pins is scraped and compared (with the "none scraped and ignored" gate), the eleven PDA seeds are scraped from the Rust (round 24 D6's missing assertion now exists and is armed both ways), layout versions, `BOOST_RING`, and the space constants are all gated. A struct edit that slipped past all of that would have to change neither a field, nor a type, nor a seed, nor a version, nor a space — I cannot construct one.

**No new finding.**

---

## R4 — The money arithmetic

`credit`, `ceilSats`, `available`, `pendingScaled` (boost and carry), `reweigh`, `debtAtActivation` are the Rust formulas exactly, including truncation directions (both divisions floor, both in the conservative direction). The crank expires every due boost before distributing (`dist_epoch >= boost_end_epoch`) and every boost the distribution itself makes due (`boost_end_epoch == dist_epoch + 1`) right after; a refused distribute leaves those post-expires as on-chain no-ops (the program skips not-yet-due records), so no harm. The alarm pages `boosts_stalled` and watches `mint.cbob_mint`, `max_boost_weight`, `max_boost_epochs` as CRITICAL-fixed-forever.

**No new finding.**

---

## R5 — The swap and the revenue cycle

**(a) Oracle math.** Recomputed for equal and unequal exponents, both signs: `sats = lamports × sol.price × 10^es / (btc.price × 10^eb × 10)` holds in every branch of the `e ≥ 0` split. Both divisions floor (conservative). `satsPerLamport` is a float used only for the 100 bps gate; its operands are ≤ ~9e12, exact in double, relative error ~1e-16 against a 1e-2 gate. No overflow path.

**(b) Pyth verification.** The `PriceUpdateV2` offsets (tag at 40, feed 41–73, price 73, conf 81, expo 89, publish_time 93) are consistent across `readPyth`, the selftest stubs, and the fork's clock-stamping stub; the length floor (101) matches. Derived address + receiver ownership + Full-only + expected feed id + 180 s age against the Clock sysvar + 30 s future bound + 30 bps confidence: an attacker cannot plant an account at the derived address (it exists, Pyth-created), and a stale or future `publish_time` is refused. The unusual combination (PDA under the push program, owned by the receiver) is corroborated by the fork test reading real cloned mainnet accounts through this exact check — if the owner or derivation were wrong, every fork run would throw. Within limit 10's stated trust.

**(c) Deviation filter.** `orcaSpot` = (sqrt/2^64)² is sats-per-lamport for a wSOL(A)/cbBTC(B) pool; `meteoraSpot` = 1/(1+bs)^id is sats-per-lamport for X=cbBTC/Y=wSOL. Both compare against `satsPerLamport`, same quantity, right direction. Float error cannot bridge the 99/101 bps arms.

**(d) Minimum out.** Both venues carry `guaranteed = m2.f.minSats` at data offset 16, in each program's output token (cbBTC sats), from the same oracle read the deviation filter used. The read-time/execution-time distinction is disclosed in SPEC.

**(e) The judge.** I attacked it as a tampered builder: the exact seven-position sequence, the pinned amount/threshold/direction/price-limit, the pinned input/output/signer slots, the ATA key lists, the wrap amount, the SyncNative/CloseAccount-only Token set, the CU-limit pin with a price-fee refusal, and the length-7 cap leave no instruction slot for anything else. The unpinned venue-internal accounts (tick arrays, vaults, bitmap, `host_fee_in`) are validated by the venue programs against the pinned pool, and any value they could divert is on the input/fee side, which the on-chain output floor bounds — round 32 C14's disposition, which I re-derived and agree with. Extra keys appended to the venue instruction are either rejected by the venue or irrelevant to the floored output.

**(f) Derivation.** Tick arrays (current + two below, string-seeded PDAs), bin arrays (active + two above, i64-LE-seeded, negative ids floor down), bitmap-as-program-id when absent, `host_fee_in` None, event authority — all match the published interfaces, and the fork proves them against the real programs. Boundary and uninitialised-array cases fail the swap → refused → fallback, which is the handled path.

**(g) wSOL.** Exact wrap, sync, exact-input debit, close returning rent plus any pre-existing balance; the round-31 measurement and R33.G4 pin the pre-funded-native close; a delegate does not revoke the owner's transfer; a frozen account fails the swap (refused → fallback).

**(h) Failure and retry.** Only a refusal (preflight, landed-with-err, or expired-unlanded — all via `classifySendFailure`'s status lookup) advances to the next venue; an unconfirmed send throws with `pendingSwapSig` preserved and the cycle open. Every path leaves the row open until a return is proven (`delta < guaranteed` throws; the split closes it only on `splitSig`/`splitByOther`/chain-anchored `closesCycle`). No double-count or closed-read-of-failed path found.

**(i) The bound.** Per cycle: realized output ≥ oracle × 0.985, and the read-time pool-agreement gate bounds the oracle to ~100 bps of the pool (≈ the true price) at read time; a market move between read and landing is converted by the floor into a refusal, not a loss. Worst case ≈ 250 bps of the swapped amount vs true spot: ≤ ~0.025 SOL on the 10-SOL cap. At the absolute ceiling throughput (40 SOL/day ≈ 1,200 SOL/month) that is ≤ ~30 SOL/month; at any realistic royalty run rate it is the disclosed ~1.5–2.5%, which the holder guide states honestly. A manipulated Meteora pool is either refused at read time (>100 bps) or floor-bounded at execution; the manipulator's extraction is bounded by the same 150 bps minus their cost of moving the pool. **Not material relative to what it protects, and disclosed.** The operator key's worst case is unchanged from limit 10: cap × windows until the guardian stops, with the flood-immune `sweep_unledgered_state` paging within roughly one alarm pass plus grace of a thief's sweep.

**No new finding in the swap.** (I considered and discarded a "stale Meteora pool read at the fallback" finding: a failed Orca swap is atomic and moves nothing, and the Meteora build's three bin arrays span 210 bins ≈ 31% of price — not reachable in the seconds between `m2` and the fallback attempt.)

---

## R6 — The gates

- Floors equal counts everywhere I cross-checked (866/909/39/23/4/14/47/33/6/16/71 against SPEC's Running-the-tests block and the runners' constants). The `everywhere` reader requires non-zero occurrences, so no vacuous pass. The coverage gate's 14-case selftest is present.
- `build-mainnet.sh` proves what it claims for all five: both builds, four behavioural key proofs (mainnet rejects / localnet accepts the test key), the sweep helper's three-way byte identity, exactly five artifacts, dirty-tree refusal.
- `cron-install.sh` arms nothing extra: the preserve logic is tag-anchored and job-anchored to end-of-line (L12), and the selftest executes the extracted preservation block against adversarial crontabs.

**L2 (LOW) — the round-24 "armed in BOTH directions" claim is false for the source-regex-only arms.**
Construct: `bank/selftest.mjs`, round-24 block, e.g. `t('L2: crank.mjs reads a reveal's attributes inside a try, so one RPC blip ends the reveal run, not the pass', /try \{ list = await mintedAttributes\(/.test(cs), true)`. The regex proves a `try` token exists; it does not prove the catch *breaks the reveal run* rather than aborting the pass. If a future edit changed the catch to rethrow (or removed the `break`), the arm stays green and the round-23 L1 defect — one RPC blip aborting the whole crank pass — returns with the gate quiet. Same shape: `'L6b: crank.mjs budgets the plan and pages the reveals it dropped'` and `'L10/L11: alarm.mjs feeds both ledger detectors the chain's sweeps and splits'` are regex-only with no mutation arm. The round-24 block's headline arms (L13b's deleted-call/comment/thrown-result arms, the router sequence, the cron resolver) *are* two-directional; these are not.
Gain: a regression in the crank's and alarm's failure containment ships with a green selftest.
Evidence: mutate `crank.mjs`'s reveal catch to `catch (e) { throw e }` and run `node bank/selftest.mjs` — the L2 arm passes; then drive the reveal loop with a throwing attribute read and the pass aborts.
Fix: for each such arm, add the mutation arm (the mutated source must turn it red) or a behavioural arm (the R27 block already extracts and runs the `send` helper with a throwing connection; do the same for the reveal loop's attribute read).

---

## Anything else

**M1 (MEDIUM) — the redemption poster wedges permanently on the first redemption of a never-revealed vault.**
Construct: `bank/redemption-poster.mjs`, `main()`'s event loop. For each `CBOB_REDEEMED` event it decodes the vault's `VaultRecord` and calls `draftPost({ ..., level: rec.level, ... })`. `draftPost` throws on `level < 1 || level > 5` — and `level 0` is a real, reachable state: nothing in SEAL's `open_for_redemption`, BURN's `burn_vault`, or MINT's `retire_redeemed` requires the level to be drawn (`retire` only reads `weight_of` for an *active* vault; an unrevealed vault was never activatable). So a vault redeemed before its reveal — which the owner can do at any time, and which a thief can do deliberately within the seconds-to-minutes between mint and reveal, or during any reveal-lane stall (limit 25's own lapse scenarios) — lands on chain, logs `CBOB_REDEEMED`, and the poster throws. The throw escapes `main()` before `st.cursor` is advanced past that signature and before `writeLedger(STATE, st)`; the entrypoint catches it, prints `CBOB REDEMPTION POSTER FAILED: level 0 is not I..V`, exits 3. The next run re-reads the same signature (the cursor is an exclusive `until` and never moved) and throws again. **Every redemption after the wedging one goes undrafted, forever, until the code is changed** — and a code change is a commit to `bank/`, which resets the clean-round counter.
Gain: an attacker sacrifices one vault (≥ 21,000 sats, or one charter Proof of Burn) and permanently blinds the public per-redemption channel — the exact mitigation the design names for a leaked-key mass redemption ("a thief emptying vaults through leaked keys does it in public, one post at a time") — before beginning the quiet drain. The operator's alarm still pages (`redemptions_near_cap`, the vault-set diff), so this is a blinding of the *holder-facing* promise ("Every opening is public"), not of the operator's detection. It is also reachable without any adversary: any holder who redeems a fresh, unfunded, unrevealed vault wedges it by accident.
Evidence: the poster's own selftest proves `draftPost` refuses level 0 (`'an undrawn level is refused, not posted as Level undefined'`) while nothing tests the loop's handling of that refusal — the project knows the throw exists and never handled it at the call site. A run showing it: extract the poster's loop (as the R27 block does for the alarm's walk), feed it a transaction whose logs are `Program <BURN> invoke [1]` / `Program log: CBOB_REDEEMED <asset>` / `Program <BURN> success` with the record for `<asset>` carrying `level = 0` (byte 58 of the `VaultRecord`), and assert: exit 3, cursor unchanged, second run identical. On chain: the redemption transaction exists and the record still reads level 0 at drafting time.
Fix: handle the per-event refusal the way the truncated-logs path three lines up already does — queue a REJECTED entry (`status: 'rejected'`, reason "the vault was redeemed before its level was drawn; draft by hand") and continue, advancing the cursor. While there, wrap the per-signature `readParsedTransaction`/`L.decode` calls the same way: the alarm received exactly this repair in round 32 (L2, `tx_unreadable` without aborting the pass) and the poster did not — one of N sites. Arm both ways: a level-0 redemption must queue REJECTED and advance; a valid one must still draft.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?** No item I could measure reads worse than its entry. I specifically re-derived limit 10's round-33 paragraph (the symmetric window's thief-exclusion argument holds for every honest row shape: confirmed, refused, and uncertain-landed; an uncertain-never-landed row explains nothing since the D1 repair) and limit 10's throughput and hand-recovery text (all accurate). The one *unstated* residual is L1 above: "ordinary clock skew cannot page an honest sweep" is true, but the boundary is half the smallest cooldown ever seen (3 h), not stated anywhere, and the verdict's own suggested repair (domain translation, which `cycleStartMs` already implements three functions away) would remove the boundary entirely.

**2. Is anything listed as a limit not actually a limit?** Nothing found. The v6 discharge family (1a–5, 11, 15, 16, 18, 20, 21, 23, 24) is genuinely gone with the Bank/deck/distributor; I checked the retired files are absent and nothing imports them (the selftest gates this).

**3. Is any DISCHARGED item not actually discharged?** 51 (boost: built in MINT/GOV, mirrored in accrual/crank/alarm, ceilings ruled and pinned), 54 (compute: measured; the crank sends each capture as its own transaction), 33/31/30 (exercised at short initialize values) — all hold by reading. 14 and 19 hold by construction as stated.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. 22, 38, 50, 52 and 53 are all stated open; `charter_opens_at` and `lock_deadline` are still OPEN in `launch/mainnet-init.json` and the checker refuses the file while they are; item 53's "still to write" rehearsal value set and checker mode are genuinely absent (no `launch/rehearsal-init.json`, no rehearsal mode in `check-launch-params.mjs`) and are named as not-built inside the open item, not assumed.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

What this process structurally cannot do, and what to do about each, concretely:

1. **Run the dress rehearsal (item 22's named list) and treat it as the certification, not a formality.** Every AI round, including this one, reads. The crank's live I/O against ~2,100 records (rate limits, a transient RPC error on vault 1,900, the every-minute lane keeping up), the alarm's live passes in rehearsal mode, one full revenue cycle through *each* pool with Orca forced to refuse once, and one forced post-swap failure walked through the hand recovery — these are the only evidence that `classifySendFailure` matches real RPC error shapes, that the open-cycle guard behaves under a real confirmation timeout, and that the cooldown gate on the chain clock works at real landing latency. Record the signatures.
2. **Build and run the suite on a second machine.** An AI reading this tree cannot detect a compromised toolchain, a doctored local validator, or a poisoned `.cache`. `build-mainnet.sh`'s own honesty ("the bridge is reproducibility: rebuild from COMMIT and confirm these sha256 values") requires someone to actually do it from a clean checkout on different hardware, and to run `run-tests.sh` there end to end, including the mainnet probe (not "SKIPPED").
3. **Run an adversarial operational day on the rehearsal deployment.** Deliberately: skew the box clock past 3 hours (my L1 fires — decide whether the translation fix goes in before the freeze, because after the lock a commit to `bank/` still resets the counter but a false-CITICAL regime is permanent operationally); break NTP; kill the alarm mid-pass and confirm the deadman; wedge the crank's lock with a live holder; flood MINT's signature list with 0.1 SOL of naming transactions and measure the detection delay against the state-derived sweep check. These are host behaviours, not code behaviours; no reading pass can substitute.
4. **Do a timed guardian drill.** Actually pull `emergency_stop_sweep` and `emergency_stop_sales` on the rehearsal deployment and measure wall-clock from a thief's sweep to the page to the stop. Limit 10's honest bound is "cap × windows until the guardian pulls the stop" — the multiplier in that product has never been measured.
5. **Make the human rulings that are not audits.** The charter opening date and lock deadline (item 38); moving the $CBOB release wallet and the Giraffish Moments hot key cold through the 7-day window (limits 56 and 46 — the two keys whose worst cases are stated as buyer-facing and are Gary's alone to retire); the X-posting authorization and website surface (item 50). No AI pass can decide these, and the immutable programs will enforce whatever is chosen.
6. **Commission an external review of the box itself.** The single-uid trust (ledger, crontab, alarm, and every signing key on one user, one machine, one backup) is limit 10's stated residue and limit 56's; an AI reading the tree cannot audit the host, the R2 backup, or the notifier path. A third party with host access, or moving the detection half off-box, is the only control that bounds it.
7. **Before the lock, fix M1.** It is a one-line-class repair inside a file the freeze already covers; after the lock, a wedged poster is a permanent hole in the "every opening is public" promise during exactly the incident it exists for.