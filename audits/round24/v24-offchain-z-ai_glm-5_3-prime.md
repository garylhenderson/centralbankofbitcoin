# Round 24 — off-chain whole-tree audit

I read every file in the bundle against the four programs' source. Where I claim a defect, I state what a run or a chain read would show if I am right, so it can be checked. Where the prompt asks for a specific fault (a refused plan, a dead-vault payment, an out-of-order reveal) and I did not find one, I say so and give the reasoning, because a silent "not found" is indistinguishable from "not looked".

---

## R1 — `bank/crank.mjs`

### R1-1 (LOW) — a race the widened `BENIGN` still pages as "our plan is wrong": `BoostsExpireFirst` on the crank's own distribute

**Construct:** `crank.mjs` `BENIGN` (deliberately excludes `BoostsExpireFirst`, per the L1 comment "a refusal that means OUR plan is wrong"), and the send order in `main()`: `expire('before', plan.preExpires)` → `split` → `distribute`.

**What happens:** the crank expires every boost that is due *at plan time*, then sends its distribute. Between the expire step and the distribute step (seconds — the split confirmation sits between them), any external distribution lands: a stranger's 100 $GARY burn-path distribution (which has **no monthly gate** — `distribute(burn=true)` is legal at any moment `avail > 0`), or traffic's in-line monthly. That distribution advances `dist_epoch`, which makes every boost with `boost_end_epoch == new epoch` due. The crank's own `distribute` then hits `require!(boosts_due == 0, BoostsExpireFirst)` — which is checked **before** `MonthNotElapsed` in the program — so the failure code is `BoostsExpireFirst`, not the benign `MonthNotElapsed`. The crank records `'fail'`, pushes it to `failures`, and sends an SMS saying an action failed. The next pass self-heals (preExpires catches the newly-due boosts), so the page is false and transient.

**Gain:** one false "action failed" page per occurrence, plus the claim batches sent after the failed distribute pay at the pre-distribution accumulator (the program computes real owed, so no money is mis-paid — only a possibly-zero claim batch whose fee is wasted).

**Evidence if I am right:** on a validator, buy a boost ending at epoch E+1, let the crank plan a pass whose distribute is due, and land a burn-path distribution between the crank's `expire_boosts` and its `distribute`. The crank log shows `FAIL distribute (monthly, free) … BoostsExpireFirst` and pages. The selftest's L1 arm asserts `BoostsExpireFirst` is *not* benign — that assertion is correct for a genuine plan fault and wrong for this race, and nothing distinguishes the two.

**Fix:** after a `BoostsExpireFirst` refusal on the distribute, re-read the config, expire the newly-due boosts, and retry the distribute once; or treat `BoostsExpireFirst` on the *distribute only* as benign (it is never a plan fault there, because the crank's expire step provably ran first — the plan fault version is unreachable given the plan's preExpires loop covers every `dist_epoch >= boost_end_epoch` record).

### R1-2 (INFO) — during a frozen pool the crank also stops JOINING, though the program accepts joins

`planCrank` gates the entire claims section — including `plan.preJoins` delivery — on `!pool.frozen` ("claims would all refuse"). Joins do not refuse: the program's `claim` join path never touches the pool balance, and limit 28 itself says "joins still go through". Cost: eligible vaults wait out the freeze (delay only; `joins_stalled` pages after 6 h). Not a money fault; worth a line in the plan's problems so an operator reading a dry run knows the crank is more conservative than the program.

### R1-3 — the four asked targets, checked

* **A plan the program will refuse:** R1-1 above. I looked for others and found none: the tick's `retiringThisEpoch` discount (L3) matches the program's `pending_this_epoch` at execution; the pre-join batches precede the distribute and their in-line `monthly_inline` provably waits for joins; activations are sent after the distribute so their in-line run is never due; the reveal/capture/reschedule window arithmetic matches `try_capture`/`reschedule_reveal` slot-for-slot.
* **A plan that pays or joins a dead vault:** not found. `assets !== 'live'` excludes pay, join and activate (L2); the program's `claim` skips `!r.active` (retired) at execution, so even a plan stale against a mid-pass redemption pays nothing.
* **A reveal sent out of order:** not found. The plan walks `revealed_total` upward and breaks at the first not-ready record; every reachable race resolves as `AlreadyRevealed`/`RevealTooEarly` (benign), and the send loop breaks on the first non-ok, so it cannot skip a head.
* **Moving value anywhere unpinned:** not found. Every instruction is a permissionless MINT call whose destinations the program pins; the selftest's no-transfer/no-other-program gate holds against the source; the key signs as fee payer and pays Core's attribute rent only.

---

## R2 — `bank/detectors.mjs`, `bank/alarm.mjs`

### R2-1 (MEDIUM) — the dangerous quiet state: the crank disarmed (or never armed) while traffic keeps distributing; `owed_scaled` grows undelivered and nothing pages

**Construct:** `detectors.mjs` `detectCrankSilent` — `if (!live) return []`; `alarm.mjs` — `crankLive = D.crankArmed(execFileSync('crontab', ['-l']))`, and `crankArmedSince = crankLive ? … : null`.

**The state:** the ordinary way to disable the crank is to comment out its crontab line or drop `--live`. The moment that happens, `crankLive` is false and `crank_silent` is quiet *by design* ("a dry-run crank is not expected to deliver anything"). But sales traffic keeps running the monthly distribution in-line on every host instruction, so `last_distribute_at` stays fresh and `distribution_overdue` is quiet. `owed_scaled` grows with every in-line distribution; `pool_insolvent` is quiet (the pool holds exactly what it owes — that is the invariant, not the fault); no detector reads `owed_scaled` growth, and no detector counts claim instructions in the scan window. The armed→disarmed **transition** pages nothing — the brakes get `detectBrakeTransitions` (urgent, once each); the crank's arming, which is the same class of operator-visible state change, gets only a silent `crankArmedSince → null` in the state file.

The transient is partially covered: while sales continue, unsplit mint revenue accumulates and `revenue_unsplit` pages after 6 h. The **terminal** state is fully quiet: the pool drains into `owed_scaled`, distributions stop (`avail == 0`), the revenue ATA is empty, and every detector is green while holders' credited shares sit undelivered indefinitely. The only forced delivery left is a redemption's own `claim` (`ClaimBeforeBurn`).

**Evidence if I am right:** feed the alarm a snapshot with `mint.owed_scaled` large, `mint.last_distribute_at` fresh, `mint.total_active_weight > 0`, a solvent unfrozen pool, and a crontab with no tagged crank line: zero findings. Second arm: a state file whose `crankArmedSince` is a timestamp, a current crontab without the tagged line — no detector fires on the difference.

**Fix:** a transition detector on the crank's arming (armed→disarmed pages once, URGENT, exactly like a brake), plus a standing check that `owed_scaled` exceeds some floor (e.g. ≥ 1 sat × `active_count`) with no `claim` instruction seen in the signature walk for N hours.

### R2-2 (LOW) — `pool_frozen` is `urgent: true`, but it is a standing condition, not a once-firing event

`detectors.mjs` `detectPoolHealth` pushes `pool_frozen` with `urgent: true`. The urgent flag exists (per `alarm.mjs`'s own comment) for findings that fire **once** — a pulled brake, a reschedule, a frozen *payout* — because the alert router buffers re-asserting watchdogs. A frozen pool re-asserts every pass for the duration of the freeze, which is exactly the case the router's buffer exists for; marking it urgent bypasses the buffer. A Coinbase freeze lasting days produces a page every 30 minutes for its whole duration. The file's own round-13 comment names this failure mode: a channel that cries wolf at volume is one people learn to scroll past, and `vault_left_index` is the finding that gets buried.

**Evidence:** the detector's text itself ("Every claim refuses until it is thawed") describes a persistent condition; compare with `claim_deferred_frozen`, which is per-event and correctly urgent.

**Fix:** drop `urgent` from `pool_frozen` (the router's buffer gives one page plus quiet re-assertion), or state in the detector why a repeated page during a freeze is wanted.

### R2-3 (LOW) — `cycle_unsplit` pages falsely for hours when the crank performed the split after a revenue.mjs crash

`detectors.mjs` `detectUnreconciledRevenue`'s `cycle_unsplit` branch fires on the **ledger's** state (returned, no `splitSig`/`splitByOther`) after a 1 h grace from the return. If `revenue.mjs` crashes between step 3 (return) and step 4 (split) — the exact crash the round-22 S6 recovery exists for — the crank's next hourly pass splits the returned cbBTC (it is permissionless and the crank splits every pass). The money is divided, but the ledger row still says unsplit, and `cycle_unsplit` pages HIGH from 1 h after the return until revenue.mjs's next 6-hourly run marks `splitByOther`. The page's text ("That cbBTC is sitting in the revenue address undivided") is false the whole time. The same alarm pass already reads the revenue ATA (`detectRevenueAccount`) and could apply the same emptiness proof `revenue.mjs` uses.

**Evidence:** a ledger with one cycle `{sweptLamports>0, returnedSats>0, returnedAt: T}` and a chain state where the revenue ATA is provably empty at T+2 h: `cycle_unsplit` fires although nothing is undivided.

**Fix:** suppress `cycle_unsplit` when the revenue ATA is readable, Tokenkeg-owned and zero — the identical proof `revenue.mjs`'s recovery uses, applied on the reading side.

### R2-4 (INFO) — no consistency check that `sum(level_minted) == revealed_total`

`level_minted` is produced (it is in the layout) but nothing checks the census against `revealed_total`. A program defect that drew two levels for one reveal would be invisible to every detector. A one-line standing check would close it.

---

## R3 — `bank/layout.mjs`

I recomputed every offset by hand from the field lists and cross-checked the Rust: `minted_total` at 141, `bare_burns_retired` at 454, `governance` at 41, VaultRecord `mint_index` at 41, `level` at 57 — all match. The field lists match the Rust structs name-for-name and type-for-type for all five structs. The selftest's assertions are real in both directions: the Rust parser throws on unparseable lines (L1), the offset scrape covers every `OFF_` constant with an "none scraped and ignored" arm (L2), the version scrape and `BOOST_RING` comparison are sourced from the Rust (L6), and the round-trip refuses wrong discriminator/version/bool/truncation. `fixedSize('[u32; BOOST_RING]') = 256` is consistent with `BOOST_RING = 64`. I found no way a struct edit slips past these gates short of editing the selftest in the same commit — which is true of every gate here and is what the freeze counter is for.

---

## R4 — `bank/accrual.mjs` vs `programs/cbob-vault-mint/src/lib.rs`

I compared line by line:

* `credit`: `delta = avail·1e12 / w`, `acc += delta`, `owed += delta·w` — identical.
* `owed_of` / `pendingScaled`: `(level weight + boost)·acc + carry − debt` — identical, including the carry-before-debt order.
* `ceil_sats` / `ceilSats`, `available` (clamped off chain, `PoolShort` on chain, documented), `pendingSats` floor division, `reweigh` (carry = owed, debt = new weight × acc, denominator moves by the difference, `owed_scaled` untouched), `join`'s debt = level weight × acc — all identical.
* The crank's post-plan denominator `total_active_weight + preJoinWeight − retiringWeight − expiringWeight` matches the on-chain state at distribute time given the send order (retire → pre-join → pre-expire → split → distribute), with no double-count between retiring and expiring (retiring vaults are excluded from preExpires) and no boost on joining vaults (boost requires active).
* The pre-expired vault's owed (`atExpiry + level·Δacc`) and the post-expiry claim's owed agree with the program's inline `expire_boost`-then-`owed_of` because expiry at a fixed accumulator preserves owed exactly.

No divergence found.

---

## R4c — the round-23 repairs

Checked each: `detectRevenueAccount`'s clock is `max(first sighting, last split)` and the max is over unix times, so an old split cannot move the clock backwards (I initially mis-read this and verified the direction); `judgeRevealAttrs` is sound (only the program can write `level`, so a list carrying it that minus `level` hashes to the stored value is genuinely "done elsewhere"); the heartbeat is written after the dry-run return, full pass only, same env var and path the alarm reads; `detectUnsweptRoyalties`'s fall-restarts-clock is sound (nothing but a sweep moves SOL out of the revenue PDA); live-only joins/payments hold; the L3 tick discount matches; `plan.owed` matches (above); the alarm wiring is derived from `Object.keys(D)` and I verified every `detect*` export is called in `alarm.mjs` (including `detectUndeclaredTokenAccounts` in `reconcile()`); the launch gate's pins, on-curve checks and release-wallet pin are present; the L11 drift suppression suppresses only absent-program→present and still drifts null-with-program-present; `lockDeadlineOf` is min(file, charter) with correct filtering; the plan-sized fee floor and once-a-day warning are wired; the lock's liveness-before-age rule breaks dead/recycled holders at any age and never a live one.

### R4c-1 (MEDIUM) — the split-verification horizon is a position in a file the ledger's writer controls: the round-12 repair's guarantee ("position cannot be forged") is false against appending

**Construct:** `detectors.mjs` `detectSplitClaims` — `const verifyLastN = opts.verifyLastN ?? 200; const recent = new Set(cycles.slice(-verifyLastN)); … if (!recent.has(c)) continue`. The same horizon gates the `splitByOther` anchor path (`inWindow = byOther.filter(c => recent.has(c) …)`).

**What the repair claims and does not do:** the round-12 comment says "Position in the ledger cannot be forged by editing a timestamp, and a backdated row is still one of the most recent entries." True for backdating. **Appending is also an edit.** An adversary who can write `revenue-ledger.json` — which on this box is the same user and the same permission boundary as `bank/keys/swap-operator.json` itself — can:

1. sweep on chain with the operator key (the sweep is real and visible);
2. write the theft cycle closed: `sweptLamports` matching the chain, `returnedSats = quotedSats`, `splitSig` a fabricated signature that never existed;
3. append 200 empty cycles (`{startedAt, sweptLamports: "0"}` — closed, skipped by every detector).

The theft cycle now sits at position −201. `detectSplitClaims` never asks whether its `splitSig` exists on chain. `detectUnreconciledRevenue` sees it closed with a full return (the quote check passes). `detectUnledgeredSweeps` sees a row matching the on-chain sweep and amount. Every detector is quiet while the SOL is gone. The `splitByOther` variant needs no fabrication beyond `returnedAt` placed just before a real, large-enough crank split — but is horizon-gated the same way, so the padding closes it too.

**Why this matters against the carry list:** limit 10's stated bound ends at "until the guardian pulls `emergency_stop_sweep`", and the SPEC says explicitly "Detection is the other half: the alarm reports a sweep with no matching cbBTC return, so the window is the alarm's cadence plus a human reaching the guardian wallet." That detection half is what this defeats. The return side is *structurally* ledger-only (the return transfer touches none of our four programs, so no signature walk sees it); the split side was made chain-derived in round 8 precisely because "the ledger is the audited key's own testimony" — and the horizon re-introduces trust in the ledger's *length*.

**Evidence if I am right:** `detectSplitClaims([], { cycles: [ {startedAt, sweptLamports:'X', returnedSats:'X', quotedSats:'X', splitSig:'fabricated'}, …Array.from({length:200}, () => ({startedAt, sweptLamports:'0'})) ] })` returns zero findings; the identical ledger without the 200 padding returns `split_not_on_chain` CRITICAL. That both-ways arm does not exist in the selftest — every existing arm tests cycles inside the window.

**Fix:** verify `splitSig` against the scan for every cycle whose `sweepSig` the scan has *itself seen on chain* (chain-derived horizon, like the sweep side), regardless of ledger position; or anchor the horizon to the scan's own oldest seen split rather than a ledger slice. Add the padding arm above to the selftest.

### R4c-2 (LOW) — the `BENIGN` widening missed the `BoostsExpireFirst` race

See R1-1. The L1 repair added the races round 22 missed but kept `BoostsExpireFirst` as a plan-fault code, and the crank's own send order makes it reachable as a race.

---

## R4b — the boost off chain

* **Expiry before/after distribution:** the crank's `preExpires` condition (`dist_epoch >= boost_end_epoch`) is exactly `expire_boost`'s require, and "due" is equivalent to it for live boosts (a boost's end epoch is only reached via `advance_epoch`, which also increments `boosts_due`); `postExpires` (`end == dist_epoch + 1`) is exactly what this pass's distribution makes due; retiring vaults are excluded from both, matching `retire`'s `unschedule_boost`. No distribution the crank plans is left held by a due boost.
* **Owed math:** verified in R4 — `boost_weight` and `carry_scaled` enter exactly as `owed_of`, including the pre-expired and post-expiry cases.
* **Alarm:** `boosts_stalled` fires (verified the wiring and the both-ways arms); `mint.cbob_mint`, `max_boost_weight`, `max_boost_epochs` are CRITICAL in `WATCH` and pinned in the production list.
* **`launch/create-cbob-token.mjs`:** the mint creation is one transaction (create account, initialize with freeze authority `null`, ATA, mint full supply, metadata, revoke mint authority) — Solana transactions are atomic, so no partial supply and no live mint authority can survive a failed run; a landed run has all of it, and the read-back verifies every fact including `mintAuthority === null` and `freezeAuthority === null`. The record is written before any read-back can throw (I5), a re-run dies on "already exists", and `--readback` re-reads. I found no path to a live authority or partial supply.

---

## R5 — `bank/revenue.mjs`

* **Worst case:** the Jupiter `/swap` response is signed with only a one-signer and a forbidden-program check — accepted limit 10, round-23 D3, and I agree it is not worse than stated *given the operational constraint* that the operator wallet holds only the cycle's funds plus the 0.02 SOL float. Note that the constraint is operational, not enforced: nothing caps the operator's balance, so the signed-transaction exposure is the wallet's whole contents, whatever they are.
* **A failed cycle read as closed:** `cycleIsOpen` is correct in every case I constructed — rejected send closed, zero-movement closed, returned-without-split open, returned-and-split closed, split-by-other closed. The one hole is R4c-1: a *fabricated* closure beyond the verification horizon.
* **Value anywhere unpinned:** the sweep destination is pinned on chain; the return goes to the revenue ATA; the split destinations are pinned. The only unpinned movement is whatever Jupiter's response makes the operator sign — limit 10.

---

## R6 — the gates

### R6-1 (LOW) — `HOST_FLOOR=5` against four `#[test]` functions in the bundled `lib.rs`

`scripts/run-tests.sh` sets `HOST_FLOOR=5` and `floor()` demands the count **equal** the floor. The bundled `programs/cbob-vault-mint/src/lib.rs` contains exactly four `#[test]` functions in `mod host_tests` (`the_lookup_takes_the_smallest_produced_slot_in_the_window`, `a_full_buffer_reads_and_malformed_ones_are_refused`, `capture_skips_at_a_b_and_c_and_matches_the_model`, `the_boost_ring_wraps_exactly_against_a_model`); the rest are plain helper fns. `cargo test -p cbob-vault-mint --features localnet --lib` reports "4 passed", and the floor dies at `4 -ge 5`.

**Evidence if I am right:** `grep -c '#\[test\]' programs/cbob-vault-mint/src/lib.rs` → 4 on this tree; the runner's step 6 dies before the on-chain suite.

**One of two things is true:** either the bundle is not the tree that produced the green run (in which case the audit is reading a different commit than the one being certified — itself a finding), or a fifth test was deleted and the floor was not moved (the exact defect class the equality floor exists to catch, inside the round-23 commit that added it). Check which, and reconcile the bundle with HEAD.

### R6-2 — vacuous-pass and floor-deletion checks

I looked specifically and found the gates sound: `everywhere()` fails on zero occurrences; the control-table gate fails on an empty block, an unclassified row, and each mismatch class, with both-ways arms; the `V6_WIRED` list is derived and non-empty with named members; the DAS-reader discovery requires `alarm.mjs` to be in the list; the signer-set gate pins exactly two entries and catches impostors; the floors demand equality, and SPEC's counts are checked at every occurrence. The one floor/count mismatch is R6-1.

---

## The four questions about the accepted limits

**1. Is any limit worse than stated?** One, marginally, and it is R4c-1: **limit 10**'s bound ends at the guardian acting, and the mechanism by which a human is supposed to notice (the alarm's sweep/return/split reconciliation) is defeatable by the same adversary it exists to watch, *if* that adversary can write the ledger — which is the same box, same user, as the key file itself. The theft is already accepted; what is worse than stated is that the stated detection window ("the alarm's cadence plus a human") does not exist against a ledger-writing thief. Everything else I re-measured held: limit 32's ring bound (cap 64 at live ≥ 3,048, stricter above), limit 35's arithmetic (0.51 × 0.21 = 10.71% > 10%), limit 25/26/27/28/36/41/44/46/51/55/56 as written.

**2. Is anything listed as a limit not actually a limit?** No. I specifically tried limit 9 (foreign nested asset: the reconcile uses `getTokenAccountsByOwner`, structurally blind to Core assets; `detectNestedVaults` walks only our collection — the limit stands) and limit 42 (the packet measurement stands; nothing off chain creates destination ATAs).

**3. Is any DISCHARGED item not discharged?** No. I re-verified 14 (`DuplicateAttribute` in `check_attributes`), 19 (`activate` requires level 1..5, so no activated-unlevelled state exists), 30/31/33 (the fields are `initialize` values, exercised), and 12/17 as amended by item 54.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** Not demoted — but the inverse problem is present: **items 51, 53 and 54 read as complete** (built and measured; proven at `d57ee3a`; measured 2026-10-04) and sit in OPEN AND BLOCKING without naming what still blocks. Item 53's remaining content *is* item 22; item 54's is a requirement on item 50's pages; item 51 names nothing. The list's own rule is that a reader must be able to see what is actually blocking; three of nine entries are not. Reclassify or name the blocker. The real blockers are 22, 38 (two OPEN values), 50, and 52.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Watch the dress rehearsal (item 22) with human eyes.** Not "it exited 0" — a person watching a full crank pass against a live cluster at ~2,100 synthetic vaults: the fee drain, the serial confirmations, one transient RPC error at vault 1,900, the every-minute reveal lane keeping up, the pages actually arriving. AI rounds reason over code; only a person can attest a run happened and looked like the plan.
2. **Verify the deployed bytes with a second tool in a second shell.** At deploy, compare the on-chain program hash read via `solana program show` in a fresh environment against `build-mainnet.sh`'s printed sha256. The script verifying itself is the tautology the Core-cache gate was fixed for; the deploy moment needs the same fix.
3. **End-to-end the alert path.** Nothing in the repo tests `notify-gary-sms.sh` or the alert router's `ALERT_URGENT` buffering — and the alarm's whole severity design (R2-2) rests on the router's behavior. Trigger one real test CRITICAL and one real test URGENT and confirm both arrive at Gary's phone, before launch.
4. **Chaos-test the automation before the lock.** Kill the crank mid-pass; wedge a lock with a live process; corrupt a *copy* of the revenue ledger; delete the alarm state; comment out the crank cron line (R2-1). The suite proves the detectors fire on synthetic input; only a live chaos run proves the pages arrive and that the disarm is noticed.
5. **Move the $CBOB release key off the box** (limit 56's own remedy) and confirm the crank and swap-operator keys were generated on a machine whose compromise history a human can actually attest to. AI cannot attest to a box's past.
6. **Re-verify the mainnet facts at initialize time with a reader that is not the probe.** The PoB collection's plugins and update authority, the Squads' cbBTC ATA, the three reserve mints — read via CLI or an explorer at the moment of `initialize`. The alarm's plugin watch is drift-only, so its guarantee begins at the alarm's first pass; anything already wrong is adopted as the baseline. The 2026-10-04 read is one snapshot, weeks before the window.
7. **Recompute `pob_root` independently.** The launch gate recomputes it with the same module that produced it. A second implementation (or a human with a spreadsheet and the 240 addresses) closing the same root is the only independent check the one-time, uncorrectable commitment gets.
8. **Be on-call for the first full monthly cycle.** The first real distribution, the first claim batch, the first reveal cohort, the first sweep — a human watching the first month before declaring the system healthy. Item 22 covers the rehearsal; nothing covers the first real one.
9. **Actually run the second clean round with a different model roster and record it.** Gate 3 requires it; nothing in the repo can enforce that the roster differed, only a human running it can.
10. **Reconcile the audit bundle with the certified commit.** R6-1 found a floor/count mismatch between the bundled source and the claimed-green run. Before the freeze counter means anything, prove the tree the rounds read is byte-identical to the tree the suite ran — the rehearsal script already has the machinery (`REHEARSAL-RECORD.txt`'s commit + sha256); apply the same discipline to the audit bundle itself.