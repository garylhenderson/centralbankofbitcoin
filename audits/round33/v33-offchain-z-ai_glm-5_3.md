# Round 33, off-chain pass — independent audit of the whole tree

Audited: HEAD `18dbff6` (round-32 repair code `ec4a0e1` plus round-32 documentation). Read whole: `bank/crank.mjs`, `bank/detectors.mjs`, `bank/alarm.mjs`, `bank/layout.mjs`, `bank/accrual.mjs`, `bank/swap.mjs`, `bank/revenue.mjs`, `bank/selftest.mjs`, `bank/lock.mjs`, `bank/sigwalk.mjs`, `bank/spl.mjs`, `bank/anchor.mjs`, `bank/txread.mjs`, `bank/redemption-poster.mjs`, `sim/swap-fork.mjs`/`.sh`, `tests/expiry-budget.mjs`, `tests/fixtures/mainnet-v1.json`, `scripts/*` as bundled, `launch/*` as bundled, MINT `lib.rs`, the sweep helper, SPEC, HOLDER-GUIDE, DESIGN-v6, RT3, the round-32 verdict and validation. Nothing was executed against a live cluster, no key was read, no validator booted; every claim below is reading plus recomputation, and each finding names the test that would confirm or refute it. Where I rely on a recorded measurement (the fork runs, the suite logs), I say so.

**Verdict up front: I found nothing above LOW. Five LOW findings, four of them in or around the round-32 repairs.** Each is stated with its check. I also answer every target's specific question, including the ones whose answer is "I could not construct one, and here is what I tried."

---

## R0 — Round 32's verdict and its repairs

The verdict was **NOT CLEAN; QUORUM MET**, six LOW/INFO confirmed. I verified each repair at its site in this tree:

- **L1 → `detectSweepState`** (`bank/detectors.mjs`): present, called from `main()` with the pinned arguments (selftest I4 arm), persisted (`sweepJudgedThrough: sweepState.judged`), rolled back on non-delivery. The one-sided window `[startedAt − 120, startedAt + min(1h, cooldown/2)]` is correct against the *confirmed*-row case: the program's cooldown serializes sweeps, so an honest cycle's row cannot explain a *later legal* sweep (a full cooldown exceeds the window at every cooldown ≥ 2 s). **Two residuals survive in this repair — findings 1 and 2 below — neither disclosed in SPEC's limit-10 text.**
- **L2 → per-item `tx_unreadable`**: present for both the throwing read and the throwing listing; the cursor and backlog hold when `unread > 0`; all four programs are still visited. **The verdict's own specified second arm — "a pre-walk CRITICAL is still delivered" — is not in the shipped selftest (finding 5).**
- **L3 → `detectLogGaps`**: unreviewed gaps are never evicted (only the reviewed prefix is trimmed, watermark always kept), the Set dedupe removed the O(n²), >2,000 unreviewed escalates to CRITICAL with its own text, the instruction says "the LAST signature listed". The positional (not chronological) watermark semantics are internally consistent because the reviewer is told to inspect *every* unreviewed entry and write the last element. Holds.
- **L4 → the coverage gate**: `first_line_quorate` requires the label to name the credited focus; a combined `VERDICT.md` headline credits only that focus; a FOCUS-dependent TARGETS header in an unrecognised form fails closed. Holds. (VALIDATION.md says "13 both-ways cases"; the gate runs 14 and the selftest pins 14/14 — finding 4.)
- **D1/D2**: the expiry count is now in the RX map and cross-checked against `EXPIRY_FLOOR`; the review instruction says "LAST signature listed". Hold.

The round-32 validation's numbers (907/907 detector, 861/861 on-chain, full runner, build-mainnet, rehearsal tree refreshed at `ec4a0e1`) are consistent with the floors in this tree (`FLOOR = 907`, `MIN_ASSERTIONS = 861`, `DET_FLOOR = 907`, `EXPIRY_FLOOR = 4`, `SWAP_FLOOR = 16`). I could not re-execute them; the counts and floors agree everywhere I compared, including every SPEC stated-count occurrence the RX map covers.

**Rejected claims I independently spot-checked and agree with:** C02 (the crank sends no compute-budget instruction — true; the suite's L.5 reveal of the 10,198-byte Autograph vault with no limit is the recorded counter-evidence, and the residual is limit 40's stated boundary); C03 (`readLbPair` stores `status` and nothing judges it — true; the consequence is the loud hand-swap path, round 30 C06 class); C05 (a false `scan_gap` at exactly 2,000 — the alarm passes `Math.min(20, ceil(2000/1000)) = 2` pages, so two full pages with the sentinel unreached pages one `scan_gap` and the next pass proves the drain; fail-closed, not a skip); C14 (returning the whole ATA while recording the delta is documented in `revenue.mjs` itself).

---

## R1 — The crank

**"A plan the program will refuse":** I could not construct one beyond benign races. Checked: reschedule's `slot > reveal_slot + 300` matches the program's strict `>`; `readySlot` is a lower bound so `RevealTooEarly` is BENIGN; the split's destinations are derived exactly as the program derives them; `judgeDistributeRefusal` re-reads the config and treats `PoolShort` as always-fault. One theoretical edge: `bank/spl.mjs readTokenAccount` accepts `len >= 72` while the program demands `len == 165`, so a 72–164-byte Tokenkeg-owned account at a derived ATA would plan an activation/claim the program refuses — but the canonical ATA address is derivation-pinned (owner, token program and mint are all fixed by the address), so no such account is constructible there by a stranger. Not filed.

**"A plan that pays or joins a dead vault":** none. PreJoins skip `assets[asset] === 'burned'` and the retire loop runs first; claims skip burned assets and report unreadable ones as problems; the retire identifies "burned" positively exactly as `is_burned` does (Core-owned, 1 byte, `Key::Uninitialized`).

**"A reveal out of order":** none. Reveals run strictly from `revealed_total` and break at the first record without entropy (captured this pass or before); a missing record breaks the run rather than skipping it.

**"Value anywhere the program does not pin":** none. The discriminator list is asserted to be exactly the nine permissionless MINT instructions, no token or system transfer is built, and `distribute` is always the free path (`Buffer.from([0])`).

The budgeting (`budgetPlan`) is correct on every branch I traced: the base plan runs whenever covered even below the floor, reveals never spend the key below the floor, and the dropped reveals page. The send order (reschedule, capture, reveal, retire, preJoin, pre-expire, split, distribute, post-expire, activate, claims) is consistent with the plan's weight arithmetic (`total_active_weight + preJoinWeight − retiringWeight − expiringWeight`), including the retire-frees-owed correction (round 24 I1) and the joined-now debt at the pre-distribution accumulator.

---

## R2 — The alarm

**"A dangerous on-chain state it reads as quiet":** I could not construct one. I walked the standing risks, the pool health (unreadable/frozen/insolvent), the distribution stalls (`joins_stalled`, `boosts_stalled`, `launch_tick_overdue`), the sweep state, the revenue account (frozen/unreadable/unsplit), the crank health and posture, the redemption rate, the brakes, the pending keys, the program bytes and authorities for all five of ours plus Core and the four swap third parties, the collection plugin hashes, and the PoB collection's plugins and update authority. The nearest miss is **finding 3** — the one detector input that sits outside the wired-to-nothing guard that protects every other one.

**"A routine state it pages on every pass":** none found. `joins_waiting`, `sales_stopped`, `sweep_stopped`, `guardian_retired`, the wedged sweep bounds and the frozen-while-standing freezes are all INFO by design; the level kinds that do re-assert (`log_coverage_gap`, `scan_gap`, `tx_unreadable`, `crank_problem`) are the disclosed human-clearable conditions.

Clock pairing is consistent everywhere I checked: `detectDistributionOverdue`, `detectRedemptionRate` and `detectSweepState` use the chain clock against chain values; `detectUnsweptRoyalties`, `detectCrankSilent` and the heartbeat use the box clock against box values; `cycleStartMs` translates a chain block time into the caller's wall-clock domain rather than comparing the two.

---

## R3 — The layouts

The struct-vs-Rust comparison is real and fails both ways (a field added to the Rust, a type changed under the same name, a private/pub(crate) line throwing). Every cross-program `OFF_` constant scraped from BURN, GOV and MINT is compared, and the "nothing scraped goes uncompared" check closes the hand-typed-list hole. The suite's own `OFF_` copies are compared too. **Round 24 D6: the SEEDS assertion now exists** — `judgeSeeds` scrapes each program's `pub const …: &[u8] = b"…"` and the arm proves a mistyped or unmapped seed is caught (11 of 11 at HEAD).

`MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` scraped and evaluated less padding equal the layout's fixed lengths (1005 / 211), and the encoder's output length is cross-checked. `collectionPluginsHash` is blind to the mint counters and sensitive to a plugin byte. No defect found.

---

## R4 — The money arithmetic

`credit`, `pendingScaled`/`owed_of`, `reweigh`, `ceil_sats`, `join`'s debt, `debtAtActivation`, and the crank's joined-now and pre-expiry owed formulas all match the Rust line for line, including the carry-before-debt ordering and the JS refusing a negative where the Rust returns `Overflow`. The crank expires every due boost before the distribution and every boost the distribution makes due right after (`preExpires`/`postExpires`); the alarm pages `boosts_stalled` and watches `mint.cbob_mint`, `mint.max_boost_weight` and `mint.max_boost_epochs` as fixed forever at CRITICAL. No divergence found.

---

## R5 — The swap and the revenue cycle

**(a) Oracle math.** Recomputed for both exponent signs: `num/den = lamports × sol.price × 10^(es−eb) / (btc.price × 10)` is dimensionally sats-per-lamport; both divisions truncate downward, so the floor is at or below the expected. `satsPerLamport`'s float path carries ~1e-16 relative error against a 1e-2 gate. The fork's recorded executions (Orca 1,413,681 vs expectation 1,416,848 and floor 1,395,595) put the honest pool ~23 bps under the oracle, well inside the 150 bps floor — the floor is genuinely below an honest return at the ruled cap.

**(b) Pyth verification.** Offsets recomputed: disc 8 + write_authority 32 = 40, verification level 1 byte (Full = 1) at 40, feed id 32 at 41, price i64 at 73, conf u64 at 81, expo i32 at 89, publish_time i64 at 93 — total 101, matching the length check and the fixtures. Ownership by the receiver program plus the derived address means only the push-oracle program can write the account, which itself verifies Wormhole messages from Pyth governance; the residual (Pyth, the guardian set, the RPC serving a fake sysvar or fake accounts) is exactly limit 10's named trust. The age is judged against the Clock sysvar, with a 30 s future bound.

**(c) Deviation filter.** `orcaSpot` is raw cbBTC-per-lamport (Q64.64 squared) and `meteoraSpot` is the inverse bin power in the same units; both compare against `satsPerLamport` in the same quantity. Float error is ~14 orders below the 100 bps gate. The fork's SW.0 measured both pools inside the bound.

**(d) Minimum out.** The same oracle read produces both the gate's `satsPerLamport` and the floor `expectedSats × 0.985`; the threshold bytes ride at offset 16 on both venues in cbBTC raw units, which is what both programs expect (Orca's `other_amount_threshold` is token B; Meteora's `min_amount_out` is token X — both cbBTC).

**(e) The judge.** It checks the output account (key 5 on both venues), the minimum-out bytes, the amount, Orca's direction and price limit and exact-input flag, the exact seven-instruction sequence, the CU limit of 400,000 with no price instruction anywhere, both ATA creations' payer/account/owner/mint, the wrap's exact keys and amount, the close's keys, and the signer slots. What a tampered builder routes past it: nothing within the judge's own boundary — the residue is whoever can edit `bank/swap.mjs` can edit the judge and `revenue.mjs`, which is limit 10's disclosed box-owner trust. The unpinned Meteora optional keys (bitmap, `host_fee_in`) are venue-validated, and a `host_fee_in` diversion is taken from the fee in the input token and cannot touch the floored output.

**(f) Derivation.** Orca's three arrays (current, then the two below) and Meteora's three (active, then the two above) are proven by the fork swaps landing through the real programs, which validate every account; the boundary arm (a tick exactly on an array start) is pinned. An uninitialised array makes the venue refuse → the next venue → the loud hand-swap path if both refuse.

**(g) wSOL.** Wrap-exactly-`lamportsIn`, sync, swap (selling exactly `lamportsIn`, not the balance), close. A pre-existing wSOL balance is unwrapped back to the operator by the close; a pre-existing cbBTC balance is returned with the cycle and only the delta recorded (`sweptAtaTotal`); wSOL cannot be frozen (no freeze authority on the native mint); a delegate does not block the owner's `CloseAccount`; the ATA address is derivation-pinned so "created by someone else" is the same account. Nothing is left wrapped.

**(h) Failure and retry.** Orca first; Meteora only on a refusal (preflight refusal, landed-and-failed, or expired-and-absent — all read off the signature's status with history); an unknown outcome throws and stops the cycle, open and loud. A confirmation timeout that later landed is recorded as landed. Every path leaves the ledger open until a return is proven: `cycleIsOpen` closes only on `splitSig`/`splitByOther`/chain-anchored split evidence; a return without a split is `cycle_unsplit` HIGH after the grace; a rejected row that moved nothing is closed, and one that claims a sweep is itself CRITICAL.

**(i) The bound.** The on-chain floor is the universal bound: no execution can deliver less than oracle × 0.985, whatever the pool, the sandwich, or the gate. Per cycle at the ruled 10 SOL cap: 150 bps ≈ 0.015 SOL (~$1.80 at the pinned prices). Per month at the throughput ceiling (10 SOL per 6 h ≈ 1,200 SOL/month): ≈ 1.8 SOL (~$216), i.e. ≤ 0.15 % of the royalty throughput the ceiling itself allows, and proportionally less at real volumes. On top of the floor: oracle staleness (≤ 180 s of SOL/BTC drift), ≤ 30 bps confidence per feed (~60 bps cross-rate worst case), and the read-to-landing gap in the deviation gate — none a hard bound on true-market deviation, which SPEC says plainly. Meteora manipulation to the gate edge extracts ~100 bps of one cycle (~$12 at the cap) against a manipulation cost on a ~$0.9 M pool that is orders of magnitude higher; not profitable. **The operator key's worst case is unchanged by the redesign:** the key holder never needs the swap at all — `sweep_sol_for_swap` requires only the operator signature, so the bound remains cap × cooldown windows until the guardian stops it, limited by the revenue PDA's balance above the reserve. **The ledger cannot read a failed cycle as closed:** `sendRejected` closes only a row that moved nothing, a refused sweep's signature is kept as `refusedSig` never `sweepSig`, and a landed-but-unrowed sweep still pages `unledgered_sweep` from the walk.

The round-25 repairs all hold at their sites: the exact-sequence judge with the eight tamper arms on both venues, the chain-clock age with the future bound, `classifySendFailure` with the four outcomes, the hourly cron with `REVENUE_CRON_PERIOD_SECS` asserted against the line and against the ruled cooldown, and the 30 bps confidence bound.

---

## R6 — The gates

Floors are equality-enforced everywhere (selftest `FLOOR`, every runner floor, every SPEC stated count through the RX map, which requires a non-empty match). I could not find an arm that cannot fail, a floor satisfiable by deleting work, or a vacuous empty-input pass; the `everywhere` function requires `found.length > 0`, and the DAS judgement's empty-collection arm distinguishes an answer from a refusal.

**"Find one [round-24-section repair] not armed in both directions": finding 5** — the R32 L2 repair's own specified second direction is missing.

`build-mainnet.sh` proves what it says for all five: the four initializing programs are behaviourally asked (mainnet rejects the test key, localnet accepts), the sweep helper's mainnet bytes are proven identical to the localnet build and to `target/deploy` (the build the suite and sim exercised), the tree-clean check and the source key check stand. `cron-install.sh` arms nothing it should not: the preservation logic is the self-tested `ours()` shape (tag, job name, end-of-line anchor, uncommented), one flag arms both crank lanes from the full-pass line only, and the rehearsal marker refuses installation.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?** Not in the sense of an accepted limit being exploitable beyond its text. The closest thing: limit 10's new round-32 paragraph discloses one masking of the state-derived sweep check ("a thief's sweep followed by an honest one while the alarm itself was down for a whole cooldown") and discloses neither of the two window edges I found below (findings 1 and 2). The state check's own residual is slightly wider than the text admits; the detection it displaces is the floodable walk, which is the exact thing the repair exists to backstop.

**2. Is anything listed as a limit not actually a limit?** No. I checked each ACCEPTED item against the code: 6, 7, 8, 9, 10 (including the throughput ceiling, the dust rule, the hand-recovery runbook and the box-owner residue), 13, 25, 26, 27, 28, 29, 32, 34, 35, 36, 37, 39, 40 (including the round-28 heap boundary), 41, 42, 43, 44, 45, 46, 47, 48, 49, 55, 56 — all remain true as written.

**3. Is any DISCHARGED item not actually discharged?** No. 51 (the boost, including the buyer's terms and the one-sided move-in-favour rule), 54 (compute, with the expiry-budget gate now executing twenty due boosts under the default budget and stating its own boundary), 12/17, 14, 19, 30, 31, 33, and the v5 family all verified closed or gone at their sites.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. 22 (nothing has run a distribution or a revenue cycle against a live chain — the rehearsal is not started), 38 (`charter_opens_at` and `lock_deadline` are still `null`/OPEN in `launch/mainnet-init.json`; everything else RULED and pinned), 50 (no deposit-address page, `judgeRedemptionCoverage` still a pure function, the poster still drafts only; the guide is still DRAFT), 52 (road step 10 not started), 53 (the rehearsal value set is still named as not built; the run-tests-inside-the-rehearsal-tree proof at the release commit is still pending — the tree was refreshed at `ec4a0e1` but nothing was built or run at the throwaway ids, which is consistent with the item staying open).

---

## Findings

**Finding 1 — LOW. The state-derived sweep check explains a thief's sweep with an honest cycle whose own send never landed.**
Construct: `bank/detectors.mjs` `detectSweepState` — the `explained` predicate matches a *time window* around a row's `startedAt` (`t >= st − 120 && t <= st + after`) for any row carrying `sweepSig || pendingSweepSig`, not a signature. For a **confirmed** row the program's cooldown makes cross-explanation impossible (the next legal sweep is a full cooldown later, outside `min(1h, cooldown/2)` at every cooldown ≥ 2 s). For an **uncertain** row (`pendingSweepSig`, the send never confirmed and never landed) no sweep landed to serialize the cooldown, so a thief holding the operator key can sweep anywhere inside `[startedAt, startedAt + min(1h, cooldown/2)]` of the honest attempt and be state-explained.
What is gained: the thief's sweep (up to the cap) produces no `sweep_unledgered_state` page; detection falls back to the transaction walk — the flood-delayable path this repair exists to backstop — and to the open-cycle guard's hand recovery, which a human must already be performing.
Evidence if I am right: drive `D.detectSweepState({ judgedThrough: T−7200, lastSweepAt: T, nowSec: T+1000, cooldownSecs: 21600, ledger: { cycles: [{ startedAt: iso(T−60), pendingSweepSig: 'unconfirmed' }] } } })` — it returns `findings: []` although the row's own send never landed and the sweep at T was a different party's transaction. The shipped arm `j({ledger: cyc({pendingSweepSig:'s'})}).findings.length` asserts 0 for the honest-uncertain case; the masking case is the same inputs with a different sweep and is indistinguishable to the function. On chain: a `sweep_sol_for_swap` transaction whose signature is not the row's `pendingSweepSig`, landing inside the window, with `last_sweep_at` moved and no page in that pass's alarm log.
Fix: let an uncertain row explain only until its own signature is resolved — require `sweepSig` for explanation once the grace has passed (or cross-check the signature when the walk has seen the sweep), and add the residual to limit 10's text.

**Finding 2 — LOW. The same window degenerates at a voted cooldown near the program's 1-second floor: every honest sweep pages `sweep_unledgered_state` CRITICAL.**
Construct: `bank/detectors.mjs` `detectSweepState` — `after = Math.min(3600, Math.floor(cooldownSecs / 2))`. At `cooldownSecs ≤ 2`, `after` is 0 or 1 and the window is `[startedAt − 120, startedAt + 0..1]`. An honest row is written (box clock) seconds *before* its sweep lands (chain clock), so `t > st` by the send latency plus any chain-vs-box offset, and the sweep falls outside the window.
What is gained: nothing by an attacker; a false CRITICAL per sweep — one-shot, urgent — for the project, on top of the standing `sweep_cooldown_too_short` CRITICAL that a seconds-long cooldown already is.
Evidence if I am right: `D.detectSweepState({ judgedThrough: 0, lastSweepAt: T, nowSec: T+1000, cooldownSecs: 1, ledger: { cycles: [{ startedAt: iso(T−2), sweepSig: 'honest' }] } })` returns one CRITICAL finding from an honest row. The shipped arms cover only 21,600 and 3,600.
Fix: floor `after` at the observed send latency (e.g. `Math.max(after, 120)`), or refuse to judge while `after` is below it.

**Finding 3 — LOW. `mint.last_sweep_at` is the one detector input outside the wired-to-nothing guard.**
Construct: `bank/detectors.mjs` `WATCHED_KEYS` — every other key the detectors read (`mint.sweep_cooldown_secs`, `mint.sol_reserve_lamports`, `mint.sweep_floor_lamports`, `mint.sweep_stopped`, `mint.dist_epoch`, `mint.pending_count`, `mint.pending_this_epoch`, `mint.boosts_due`, …) is in `WATCHED_KEYS`, so a reader that stopped producing one throws ("a watched key that nothing populates is a control that does not run, and it reads as calm"). `mint.last_sweep_at` is in neither `WATCH` (correctly — it is a status) nor `WATCHED_KEYS`; it is produced today only because `L.flatten` emits every layout field.
What is gained: a future `readConfigs` change that dropped the field would leave `detectSweepState` reading `lastSweepAt: undefined` → `t = 0` → "never swept" → quiet, silently disabling the round-32 L1 flood-immune backstop while every selftest that drives the detector directly still passes — the exact one-of-N shape this project keeps filing.
Evidence if I am right: `D.missingWatchedKeys(Object.fromEntries(D.WATCHED_KEYS.map(k => [k, 'x'])))` returns `[]` with `mint.last_sweep_at` absent from the list, while `D.detectSweepState({ judgedThrough: 1, lastSweepAt: undefined, ledger: { cycles: [] }, nowSec: 100 })` returns no findings.
Fix: add `'mint.last_sweep_at'` to `WATCHED_KEYS` (that is the guard's purpose), with a both-ways arm.

**Finding 4 — LOW. VALIDATION.md states the coverage gate's self-test has 13 both-ways cases; the gate runs 14 and the selftest pins 14/14.**
Construct: `audits/round32/VALIDATION.md` ("Its self-test has 13 both-ways cases") vs `scripts/audit-coverage.sh` (`total = len(cases) + 5` = 14) and `bank/selftest.mjs` (`'14/14 gate assertions as predicted'`). A stale count inside the repair-validation record for the gate whose whole subject is stale counts. No SPEC statement claims 13, so no suite floor is wrong; the code and the suite agree with each other.
Evidence if I am right: run `bash scripts/audit-coverage.sh --selftest` — it prints `14/14`.
Fix: correct VALIDATION.md (or mark it superseded by the post-fix count).

**Finding 5 — LOW. The R32 L2 repair's specified second direction — "a pre-walk CRITICAL is still delivered" — has no arm.**
Construct: `bank/selftest.mjs`, the R32 L2 block. The round-32 verdict's own repair specification says the arms should prove "the cursor holds and a pre-walk CRITICAL is still delivered". The shipped arm proves the throwing read and throwing listing each become `tx_unreadable`, the cursor holds, and all four programs are visited — but the harness ctx is built with `findings: []` and no assertion touches a pre-walk finding's survival. The mechanism itself is sound (the catch is per-transaction, so `main()` reaches `report()` with the full findings list), so this is a gate gap, not a live defect — but it is the one repair of the round-32 set whose own specified both-ways arm is half missing.
Evidence if I am right: read the block — no planted pre-walk finding, no assertion on it.
Fix: plant a pre-walk CRITICAL in the ctx's `findings` and assert it is in the returned findings (and in the planned notices) alongside the `tx_unreadable`.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Run the money against a live cluster.** Item 22's named rehearsal items — the crank's live passes at ~2,100-vault scale with real rate limits and a transient RPC error on vault 1,900, one full revenue cycle through *each* pool with Orca forced to refuse once so Meteora really runs, and one forced post-sweep failure walked through the hand recovery with a stopwatch — involve real latency, real provider behaviour, and a human reading a page and acting. No audit round executes these; the fork is not a live cluster and the revenue job runs in no gate. Until they are run and recorded with signatures, the off-chain money path is unproven against reality.
2. **Witness the initialize ceremony.** The checker validates the JSON, not the transaction (round 24 A6). A human must build the four `initialize` transactions *from* `launch/mainnet-init.json`, sign with INIT_AUTHORITY, and then read every value back from the chain after landing and compare it against the file — on chain, not from build logs.
3. **Verify the deployed bytes and remove the upgrade authority as witnessed acts.** Dump each program's bytes on chain, compare against `build-mainnet.sh`'s SHA256SUMS, confirm all five upgrade authorities read IMMUTABLE, and only then treat item 39 as live. The alarm watches this afterwards; the moment of no return deserves a human checklist with artifacts.
4. **Hold the keys the way the documents say.** Move the $CBOB release wallet off the box or to Gary's own custody (limit 56); keep the Moments hot key cold or in a multisig through the 7-day charter window (limit 46); keep the operator wallet holding nothing but cycle funds and its fee float, funded above `OPERATOR_FLOOR`, with nothing that refills it (limit 10's operational instruction); top up the crank fee key and move its honeypot.
5. **Drill the human procedures once before they matter.** Gary actually signing `emergency_stop_sweep` and the alarm paging it; an open-cycle hand recovery end to end with `--audit` clean; a log-gap review and watermark write to `bank/log-gaps-reviewed`; an ack entry with its mandatory reason and expiry. Each is a runbook step a human should have done once.
6. **Stand up the second watcher.** Limit 10(b) trusts one RPC endpoint for every price, pool account and floor. Before launch: a second provider (ideally a second location) for the alarm, and a decision on whether the swap's market read should ever cross-check a second source. The alarm's own delivery path (the router, the deadman's target) is also single-box.
7. **Read the holder guide as a customer.** Item 50 blocks publication until the surfaces exist; a human should then read the final guide sentence by sentence against the deployed programs — round 24's confirmed falsehoods were all here.
8. **Rebuild on a second machine.** `build-mainnet.sh`'s own "NOT PROVEN" paragraph names the bridge: reproducibility from the release commit with the sha256 values confirmed. AI audit reads pins; it cannot vouch for a toolchain's provenance beyond a second reproduction, which needs a second environment.
9. **Canary and bounty.** Deploy with a small real balance, run the whole pipeline live (crank armed, revenue armed, alarm live) for a defined period *before* removing the upgrade authority, and put a public bounty on the locked programs. Immutability makes every surviving bug permanent; after the lock, disclosure and external scrutiny are the only mitigations left.
10. **Decide the two open dates.** `charter_opens_at` and `lock_deadline` are Gary's; nothing can check them until they exist, and item 38 stays open until they do.