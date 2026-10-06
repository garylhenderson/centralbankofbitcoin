# Round 27 independent off-chain audit — source-only review

**Method and its limits, stated first.** I read the bundled tree at the audited commit and reasoned from source. I did **not** run the validator, the suite, the fork, or a live crank/alarm/revenue pass; every "measured" number I cite below is attributed to the round-26 validation record (`audits/round26/VALIDATION.md`) or to arithmetic I recomputed by hand from the source. Where I claim a defect, I state what evidence would confirm or refute it on a real run. I found no new CRITICAL or HIGH. I independently verified that all nine round-26 repairs are present and armed, and I report the residual observations that survived my review, ordered by target.

---

## R0 — Round 26's verdict and repairs

I re-derived each round-26 finding against the bundled source rather than trusting the verdict. All six LOW repairs and all three INFO repairs are present and have two-way selftest arms.

| R26 ID | Repair present? | Independent check |
|---|---|---|
| L1 (candidate sigs lost) | **Yes.** `revenue.mjs` `rememberAttempt` writes `pending{Sweep,Swap,Return,Split}Sig` + `pendingSwapVenue` before rethrowing; all four catch sites call it (`revenue.mjs`: sweep `outcome!=='landed'`, swap `outcome!=='refused'`, return `.catch`, split `.catch`). Selftest arms extract the real handler and assert a known-signature/unknown-status send saves the candidate and does not set `sweepSig`/`sendRejected`. | I traced each of the four `rememberAttempt(cycle, '<Hop>', e, led[, venue])` call sites and confirmed none of them sets a confirmed-value field on the unknown path. `--audit` prints the candidates. Holds. |
| L2 (`splitByOther` anchor) | **Yes.** `detectSplitClaims` now routes both explicit and anonymous claims through `closesCycle`, which anchors on `returnBlockTime` when present. Selftest arms R26 assert an early split is refused for both branches and one split cannot anchor two rows. | Holds. |
| L3 (revenue one shared stream) | **Yes.** `REVENUE_STAGES` + per-stage `cbob-revenue:<stage>` labels + durable markers under the lock; `revenueNotices` only recovers a stage that both has a marker and passed this run, and never recovers the currently failing stage. | Holds. One operational nuance below (INFO-2). |
| L4 (reconcile memory/recovery) | **Yes.** `reconcile()` persists `paged`, sends scoped recoveries on a complete census, and preserves prior kinds when the census is incomplete. Selftest harness proves dirty→clean recovery, incomplete-census preservation, and failed-delivery retention. | Holds. |
| L5 (launch gate bypassed imported detector) | **Yes.** `judgeLaunch` now routes supply/census/mints/treasury/reserves/PoB root/collection/cbob mint/boost ceilings/charter through `D.detectStandingRisks(cur,{production:true})` and rejects any non-underscore field with no rule. Selftest arms mutate each imported pin and assert refusal. | Holds. |
| L6 (rehearsal cron overwrites production) | **Yes.** `cron-install.sh` refuses when `$R/REHEARSAL-RECORD.txt` exists, before reading crontab or logrotate. Selftest runs the real prelude with a synthetic marker and asserts exit 1. | Holds. |
| D1 (rehearsal header counts) | **Yes.** Header now says "five fresh program keypairs" and "exactly six substitutions … the five mainnet ids, and the repo root path", matching `PROGS` (5 entries) + root. | Fixed. |
| D2 (judge helper-independence claim) | **Yes.** The judge comment now reads "Both share pure ATA/discriminator/byte primitives; the venue program validates its pool-owned liquidity accounts", which is accurate. | Fixed. |
| D3 (SPEC gate omitted swap floor) | **Yes.** `selftest.mjs` `RX` includes `'swap'` and the floor map reads `SWAP_FLOOR` from `sim/swap-fork.sh`; SPEC states "16 swap-fork assertions". | Fixed. |

**Conclusion for R0:** I found no surviving round-26 defect. The consecutive-clean counter is a process question, not something I can award from a source-only pass; my review is consistent with the repairs holding.

---

## R1 — `bank/crank.mjs`

I checked the four things the prompt names: a plan the program will refuse, a plan that pays/joins a dead vault, an out-of-order reveal, and value moved somewhere the program doesn't pin.

- **Dead vaults.** `planCrank` filters `assets[r.asset] === 'burned'` out of `preJoins`, `joins`, `activate`, and the claim loop; burned vaults are only retired. A vault reading `'other'` (null RPC) is excluded from joins/claims and reported, never paid. I found no path that pays or joins a positively burned vault.
- **Reveal order.** The reveal loop walks from `cfg.revealed_total` and stops at the first not-ready record; a failure/skip `break`s, so nothing behind it is sent out of order. `judgeRevealAttrs` distinguishes send/revealed/mismatch and the hash is checked before a fee is spent.
- **Value movement.** Every instruction is a permissionless MINT instruction (`activate, capture_entropy, claim, distribute, expire_boosts, reschedule_reveal, retire_burned, reveal_level, split_revenue`); the selftest asserts no token/SOL transfer is built and no program but MINT is called. The key signs only as fee payer.
- **Cost model.** `planCostLamports` counts every transaction the sender actually emits (including `claims.length` batches and the pre/post-join and pre/post-expire batches) plus per-reveal attribute rent; `budgetPlan` keeps the FIFO reveal prefix under a short balance and pages the dropped reveals. I recomputed the reveal cost (`SIG_FEE + REVEAL_RENT`) and it matches.

**One benign-race nuance, not a defect:** if `distribute` is refused `JoinWaitingFirst` and a competing process joins the waiting vaults *without* distributing, `judgeDistributeRefusal` sees an unmoved epoch and reports `fail`. That is a real refusal that resolves on the next pass, and `crank_failing` requires three consecutive failing passes before paging, so a single transient does not alarm. I do not file it.

**Finding R1-1 — LOW (fee-payer ceiling can be tripped by a full-census reveal burst, by design, but the warning cadence hides it).** `FEE_CEILING_LAMPORTS` is 0.25 SOL; a full-census reveal (~2,100 reveals × ~116,360 lamports ≈ 0.244 SOL) sits just under it, and any captures alongside push the *plan cost* above the ceiling while the key is still below the floor-needed amount. `judgeFeePayer` checks the minimum first (round-24 L6a repair), so this refuses correctly rather than running underfunded. The residual is only that the once-a-day honeypot warning (`warnDue`) can mask a second same-day shortfall on the reveal lane. Evidence if I am right: two reveal-lane shortfalls within one 24h window produce one notification. This is cosmetic; I record it so it is not mistaken for a funding bug. No fix required beyond awareness.

---

## R2 — `bank/alarm.mjs` / `bank/detectors.mjs`

I looked for a dangerous state read as quiet and a routine state paged every pass.

- **Config drift across failed reads.** `carryConfigBaseline` carries the last non-null value, so old→missing→new is compared (the round-24 L5 repair). A *permanently* failing read would carry the old value forever and hide a change, but a config account that stops reading is surfaced as `config_vanished` (MINT) or a thrown `readConfigs`, so the silence path is loud. I found no dangerous-quiet case.
- **Routine-page check.** Third-party program hash/authority is drift-only (pages once per upgrade, then baseline updates); `joins_waiting`, stopped brakes, and wedged sweep bounds are INFO; level findings are re-asserted but router-suppressed after the first. I found no steady-state every-pass page.
- **Pyth/Clock trust.** `market()` judges oracle age against the Clock sysvar and refuses an unreadable Clock; `readPyth` requires receiver ownership, full verification, and the exact feed id. This is the one-RPC + third-party trust already in accepted limit 10; I did not re-file it.

**Finding R2-1 — INFO.** `detectUnsweptRoyalties` restarts its clock only when the balance *falls*. Accepted limit 10 states "a working sweep that is capped never pages." That is true while royalty inflow per cooldown is below the per-sweep cap (the balance falls each sweep). If royalty inflow ever exceeds the cap per cooldown (>~40 SOL/day at the ruled 10 SOL/6h), the balance stops falling and the detector pages even though the sweep is working — which is actually the correct signal that the throughput ceiling is being hit, but it is a slight over-statement of "never pages." Not a defect; the limit's wording could note the high-volume exception. No code change warranted.

---

## R3 — `bank/layout.mjs`

I recomputed the cross-program offsets the programs pin and checked the assertion machinery.

- `governance` at 41 and `minted_total` at 141 in `MintConfig` recompute correctly from the field list (8 + 1 + 32 = 41; … + minted_this_round ends at 141). These match the SPEC's stated pins.
- The round-24 D6 gap (SEEDS claimed asserted but weren't) is closed: `selftest.mjs` scrapes each program's `*_SEED` constant and asserts all 11 seeds match, with a both-ways arm. I confirmed the arm exists and is not vacuous (it fails on a mistyped seed and on an unmapped seed).
- The struct-equality arm parses the real `pub struct` and compares field-for-field and type-for-type; a added/retyped field fails it. `BOOST_RING` maps to 256 bytes (64×4), consistent with the Rust `BOOST_RING = 64`.

No defect found.

---

## R4 — `bank/accrual.mjs`

I compared each mirror against the MINT source line-for-line.

- `pendingScaled` = `(weight + boost) * acc + carry − debt`, matching `owed_of` (carry added before debt subtracted). 
- `credit` = `delta = avail*SCALE/w; acc += delta; owed += delta*w`, matching `credit`. The dust residue (`avail*SCALE − delta*w`) stays undistributed, matching the program.
- The crank's pre-expiry owed formula (`atExpiry + level_weight*(acc_new − acc_old)`) matches what `expire_boosts`→`reweigh`→distribute produces (debt restarts at level weight at the old acc, carry holds the boosted owed). 
- `reweigh` moves owed to carry and restarts debt at the new weight, matching the program.

No divergence found. The allocation selftest (39 assertions) covers the 1:1.5:2:2.5:3 ratio, dust carry, late-activation, and boost carry.

---

## R5 — `bank/swap.mjs` and `bank/revenue.mjs`

I went through (a)–(i).

**(a) Oracle math.** `oracleFloor` computes `sats = lamports·sol·10^e / (btc·10)` with `e = sol.expo − btc.expo`, moving the power to numerator or denominator by sign. I recomputed with the fork's numbers (10 SOL, sol≈1.2045e10@−8, btc≈8.5929e10@−8 → e=0) and get ≈1.40e6 sats, consistent with the recorded fork expectation (1,407,003 at slightly different prices). `expectedSats` and `minSats` both floor (BigInt division), so the on-chain floor is ≤ the exact 150-bps-under value by <1 sat — the stated "rounded down" behavior. `satsPerLamport` is a float used only for the 100-bps deviation gate; the values involved (price ≈ 1e10, well under 2^53) give ~1e-16 relative error, negligible against a 1e-2 gate. No overflow or rounding defect.

**(b) Pyth verification.** `readPyth` requires the account be owned by the receiver, be *fully* verified (`level==1`), and carry the exact feed id; staleness 180s and confidence 30bps are enforced in `oracleFloor` against the chain Clock, with a +30s future bound. The account is a PDA derived under the push oracle and owned by the receiver, so only the receiver writes it; an attacker cannot inject a chosen price or old `publish_time` without compromising the receiver/push programs, which are watched (`THIRD_PARTY_PROGRAMS`). This is the accepted third-party trust; I did not re-file it.

**(c) Deviation filter.** `orcaSpot = (sqrtPrice/2^64)^2` gives sats-per-lamport directly (both legs already in base units; confirmed against the pool's tick −88733 → 1.0001^−88733 ≈ 1.4e-4). `meteoraSpot = 1/(1+binStep/10000)^activeId` is the correct inverse for X=cbBTC/Y=wSOL. Directions are correct for both venues. Float error is far below the gate. No defect.

**(d) Minimum out.** Both venues carry the same `guaranteed = m2.f.minSats` (Orca `other_amount_threshold`, Meteora `min_amount_out`), in each program's expected units (sats of cbBTC out). The deviation gate and the floor derive from the same `m2.f` oracle read. Consistent.

**(e) The judge.** It enforces the exact 7-instruction sequence, the single signer, no priority fee, the exact wrap amount, the output account = the operator's own cbBTC ATA, the amount and floor in the swap data, and (for Orca) exact-input/a_to_b/price-limit. I confirmed it checks the swap's output account (position 5 both venues), the min-out bytes, the direction byte (Orca), and the amount, and that both ATA creations are for the operator's own wallet/mint. 

**Finding R5-1 — LOW (defense-in-depth, within accepted limit 10).** The judge does **not** validate the venue's liquidity/fee accounts inside the swap instruction: Orca `vaultA/vaultB` (positions 4,6), tick arrays (7–9), oracle (10); Meteora reserves (2,3), bin arrays (15+), and **`host_fee_in` (position 9)**. The venue programs validate their pool-owned vaults/reserves, and the fork test (SW.1/SW.4/SW.8/SW.9) proves the honest accounts land, so this is not a live theft path. But a *builder defect* (not a tamper) that set Meteora `host_fee_in` to a funded account would divert part of the input as host fee and reduce the operator's output; the on-chain floor catches it only if the reduction pushes output below `minSats`. The builder hardcodes `host_fee_in` to None and a tampered module is out of scope by limit 10, so this is a hardening gap, not a surviving exploit. Evidence if I am right: `judgeSwapInstructions` returns `[]` for a Meteora build whose position 9 is a real ATA, and the operator receives less than `expectedSats` while still above `minSats`. Fix: assert position 9 equals the program id (None) and, for both venues, assert the liquidity accounts equal the pool's stored/derived accounts.

**(f) Account derivation.** Orca tick-array starts use `Math.floor` on possibly-negative ticks (correct toward −∞; confirmed by the −88733→−90112 arm and the boundary arm). Meteora bin arrays `[i,i+1,i+2]` for Y→X (active bin moves up). The bitmap is passed as the real PDA when it exists, else the program id (Anchor "None"). An uninitialized tick/bin array would make the venue refuse (loud, cycle stays open), not silently misroute; the fork proves current arrays exist. No defect.

**(g) wSOL handling.** Wrap exactly `lamportsIn`, SyncNative, swap exact-input `lamportsIn`, close back to owner. A pre-existing wSOL balance is returned by the close (the swap consumes exactly `lamportsIn`); nothing is left wrapped. A frozen/delegated wSOL ATA belongs to the operator and would fail the swap loudly. No defect.

**(h) Failure and retry.** Meteora is tried only on a *refused* Orca outcome; an `unknown` (unconfirmed) outcome rethrows without trying the next venue, so a confirmation timeout on a swap that later lands cannot double-swap. `classifySendFailure` returns `refused` for preflight, landed-with-error, and expired-and-absent; `landed` for settled-success; `unknown` otherwise. The cycle closes only when `returnedSats>0` and a split is recorded/anchored. I found no path that reads a failed cycle as closed.

**(i) Extraction bound.** The floor guarantees ≥ 98.5% of the oracle expectation per swap; the deviation gate keeps the pool within 100 bps of the oracle before trading. Worst guaranteed execution loss is therefore ~1.5% per cycle if the floor binds: on the ruled 10 SOL cap (~$1,200 at $120/SOL) that is ~0.15 SOL/cycle. At the ~40 SOL/day throughput ceiling that is an upper bound of ~18 SOL/month *only if the floor binds every cycle*, which normal execution does not approach (the fork recorded 10-SOL outputs within a few bps of oracle, well above the floor). A sandwich is bounded by the same floor plus the capital cost of moving a ~$10M Orca pool. This is the accepted tolerance in limit 10; I state the bound rather than re-file it. The operator key now trusts two pool programs + Pyth (all watched) instead of an HTTP reply — an improvement over the Jupiter design, with the residual third-party-upgrade trust already documented.

---

## R6 — gates

I looked for arms that cannot fail and vacuous checks.

- The detector/alloc/poster/launch/host floors all require **equality** (`==`), not a lower bound, so deleting assertions fails the gate and the floor must move in the same commit (the round-19 repair). I confirmed `selftest.mjs` exits 1 when `R.length !== FLOOR`.
- The wiring gate (`wiringGate`) fails when a detector call is deleted, commented, or its result dropped (the L13b arms prove all three). `consumed` requires a `...D.x(` spread or a bound variable whose `.findings`/`.events` is read.
- The control-table gate mechanically checks ON-CHAIN rows against real error enums and AUTOMATIC rows against the cron template, both ways.
- The program-id gate checks 14 named copies plus the deploy keypairs' public keys and catches a 4-char-prefix lookalike.
- The swap-fork floor (16) is now in the SPEC-count gate (D3 repair).

I found no assertion that cannot fail and no check that passes vacuously on empty input in a way that hides a defect (`judgeDasEnvelope` returns a refusal, not an empty pass, on a malformed envelope; an empty-but-valid collection is caught downstream by `detectIndexShortfall`).

---

## The four accepted-limit questions

**1. Is any limit WORSE than stated?** I found none worse. Limit 10's "a capped sweep never pages" holds under realistic inflow (see R2-1 for the high-volume nuance, which pages *correctly*). Limit 42's packet claim was already corrected in round 26 (D4) and the corrected statement (narrow 1,219-byte variant fits; padded 1,367-byte shape needs prior preparation) is consistent with the measured sizes.

**2. Is anything listed as a limit not actually a limit?** No. The discharged compute items (12/17, 54) hold: the crank sends captures/reveals/claim-batches each under the 200k default budget, so it needs no compute-budget instruction; the byte wall binds before the compute wall on the padded path.

**3. Is any DISCHARGED item not actually discharged?** I checked the boost (51), compute (54, 12/17), and the Bank-era discharges. The boost's owner-only + buyer's-terms + carry arithmetic are mirrored off-chain and armed; the `BoostsExpireFirst`/`JoinWaitingFirst` gates are exercised. I found no discharged item that is actually still open.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22 (no live distribution/revenue run), 38 (charter date + lock deadline still null in `mainnet-init.json`), 50 (holder surfaces unbuilt), 52 (pool/Squads/revenue accounts), and 53 (rehearsal re-run at release commit) are all genuinely unmet in this tree. `check-launch-params.mjs` still refuses the committed file because `charter_opens_at` and `lock_deadline` are OPEN. Nothing is being smuggled into "accepted."

**HOLDER-GUIDE check.** Every present-tense surface promise ("the Bank's pages show…", "the redeem page checks…", "Every opening is public… announced on X and the website") is not yet true in code — the pages and the poster's sender do not exist. This is fully captured by OPEN item 50 and by the guide's own DRAFT marker plus the poster's "THIS FILE CANNOT POST ANYWHERE" header, so I do not file it as new; I note it because the guide must not be published until item 50 ships, which the tree already enforces as a stated rule.

---

## Anything else

**INFO-1 (swap judge liquidity accounts)** — see R5-1.

**INFO-2 (revenue recovery can lag a hand-resolved cycle).** If a stage fails (marker written) and the cycle is then resolved by hand, a subsequent automatic run that returns early (nothing to sweep) never re-attempts that stage, so its recovery notice is never sent and the marker persists until the next real cycle completes that stage. This is cosmetic (the failure was already alerted; the stream is per-stage so nothing else is suppressed), and it self-heals on the next full cycle. No change required; worth knowing operationally.

---

## Given that no human firm will ever see this and the programs will be immutable, what should this project do before launch that AI audit structurally cannot?

1. **Run the live dress rehearsal and treat it as the gate it is (item 22).** No amount of source review substitutes for the crank, alarm, and revenue cycle running against a live cluster at ~2,100 vaults, including one full revenue cycle through *both* pools and one forced post-sweep failure walked through hand recovery. AI can reason about the code; it cannot observe RPC rate limits, confirmation latency, DAS lag, or a transient error on vault 1,900. This must produce real transaction signatures before anything mints.

2. **Execute the launch ceremony as a human-attested, offline-verifiable event.** The `initialize` values must be built from `launch/mainnet-init.json`, the deployed bytes compared to `scripts/build-mainnet.sh`'s sha256s, and the upgrade authority removed only after the Test Vault simulation, dress rehearsal, and build proof all pass. The INIT_AUTHORITY acceptance (Gary's key) cannot be proven on this box (the box does not hold the private key), so the bridge is reproducibility: an independent party should rebuild from the release commit and confirm the hashes. AI cannot hold or witness that key ceremony.

3. **Establish the operational human loop the alarm depends on.** The alarm pages, but a human must receive, triage, and act (pull the guardian brake, move a honeypot, hand-recover an open cycle, re-pin Core if Metaplex upgrades it). Concretely before launch: a tested paging path end-to-end (not just the router in isolation), a written runbook for each CRITICAL kind, and a named person reachable for the charter window. AI cannot be on call.

4. **Build the holder-facing surfaces (item 50) before the guide is published.** The redeem page's `judgeRedemptionCoverage` preflight and the sweep-helper integration are the only preventive control for undeclared airdrops and nested assets (limits 9 and 44). Until it exists, holders can destroy their own undeclared holdings with no warning. This is a product/build task, not an audit task.

5. **Decide the charter-window custody question with a human owner (limit 46).** The Giraffish Moments update authority is a hot wallet that can end the project or capture governance during the 7-day charter window. That is a custody/policy decision (hold it cold or in a multisig through the window, or accept the risk) that only Gary can make and a human process must enforce; AI can only flag it, which the tree already does.

6. **Get a second, disjoint AI roster for the clean-round requirement, and run it against the frozen tree.** The ship gate requires two consecutive clean rounds with different rosters. My pass is one read of one tree; agreement across independent model families against the *same frozen bytes* is the closest available substitute for a human firm, and it must happen after the freeze, not before.