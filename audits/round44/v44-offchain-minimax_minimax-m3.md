# Round 44 — OFF-CHAIN PASS

**Audited tree:** the tree as bundled (commits through `2e8c979`), including `web/test/*`, `bank/`, `scripts/`, `sim/`, `launch/`, MINT + sweep-helper source, SPEC, HOLDER-GUIDE, DESIGN-v6, RT3, and round 43's two verdicts + VALIDATION.

**Method.** I read the whole tree before writing, cross-checked every claim I could against the code rather than the comments, re-derived the cross-program offsets and struct lengths from the bundled MINT source, re-derived the swap floor algebra and the Pyth offsets, and ran no validator, fork, alarm pass, crank pass, or router delivery. Every finding below states the evidence that would exist on chain or in a test run if it were true, and I have discarded claims whose premise I could not substantiate.

**Verdict.** I found **no CRITICAL, no HIGH, no MEDIUM**. I found a small number of **LOW/INFO** items, all in the fixable layer, none of which moves or miscredits value, stops or wrongly refuses a crack, or touches the five programs. Under Gary's launch gate of 2026-10-08 this pass is **LAUNCH-CLEAN**. I am not confirming the prior work; I am reporting what survived my own reading. Where I could not falsify a claim I say so rather than manufacturing severity.

---

## Repairs verified at their sites (R0)

I re-derived each round-43 repair from the code, not from the verdict.

- **V43o-1 (`release_gate`, rehearsal-aware).** `scripts/run-tests.sh`'s `release_gate` reads `RELEASE_COMMIT` from `web/src/config.js`, and where `REHEARSAL-RECORD.txt` stands, replaces the bare `git diff` with a Python proof: the recorded map is the five programs + root, the recorded files still hash to the recorded sha, the four keyed programs appear in `git diff REL`, every changed file is recorded, and the reverse map recreates `RELEASE_COMMIT`'s bytes. The selftest runs the real gate on a fixture made by `rehearsal-tree.sh`'s own substitution engine, in both directions (marker+patch passes; marker-less patched tree dies; forged sha dies on the reverse map; unpatched tree with a copied marker dies). The mechanism holds. **I re-tested the claim round 43 disproved** (LongCat's "mainnet unit mismatch"): `orcaSpot`/`meteoraSpot` both reduce to sats-per-lamport, and the fork's SW.7–SW.9 read both venues as usable and both execute within 7.7 bps of the oracle; a 10× error would read ~90,000 bps and fail. Disproved as filed, mechanism accurate.
- **V43o-2 (unreadable-signature skip).** `alarm.mjs` counts a signature's consecutive read failures, and at `UNREADABLE_SKIP_PASSES = 3` adds it to `looked.unreadSkips` **without** incrementing `unread`, so the `if (!unread)` cursor-advance gate opens and the backlog drains past it; `detectUnreadSkips` keeps the signature on a level page until a human watermark. The poster does the same (two runs hold the cursor, the third queues REJECTED). The four selftest arms run the extracted real walk with a permanent fault and with a control that recovers; the `X`-frozen-cursor failure at `c08c576` is now `n4,n3` read and the cursor at `n4`. Holds.
- **V43-1 (crank rescues every nested vault).** `planRescues` is built on `detectNestedVaults`, plans only hosts that are self / live vault / positively burned, and `main()` wires it on a full pass from the asset owners already read. `NotNested` is in `BENIGN`. The eight selftest arms run the planner, the send block, and `main()`'s wiring as written and are shown red with the destination swapped. Holds.
- **V43o-3 (reveal-run arm).** The reveal loop is extracted and run with an `'other'` asset (nothing sent) and a burned asset (sent). Shown red with only the `break` deleted. Holds.
- **Core re-pin.** Four copies of `CORE_SHA256_EXPECTED` (run-tests, e2e-localnet, run-sim, build-mainnet's `local want`) are compared by the selftest with a drifted-copy control. `probe-mainnet-facts.mjs` reads the pin from run-tests and hashes the deployed Core's ProgramData body; `run-tests.sh` and `build-mainnet.sh` both hard-gate on the deployed bytes. The four scripts' token-program pins are enforced by `token-programs.sh`. Holds. **Caveat, not a finding:** these are source checks; the live probe must actually *run* under the ship gate, which `run-tests.sh` already enforces via `CBOB_SHIP_GATE`.

## The rehearsal value set (round 43/44 addition)

`judgeRehearsal` and `launch/rehearsal-init.json` are consistent: the rehearsal file carries every mainnet key (31) and no extra; `payment_mint`/`reserve_mints` are the real three (so item 22.3 swaps real SOL into real cbBTC); the eight keys that could touch a real holder or real money (`guardian`, `bank_treasury`, `pob_root`, `pob_collection`, `swap_operator`, `cbob_mint`, `cbob_release_wallet`, `vault_collection`) are `REHEARSAL-OPEN` and checked against a NEVER-real list; `init_authority` is restricted to the two compiled keys; `lock_deadline` is `REHEARSAL-NA` so `--final` is never run in rehearsal; every initialize bound is enforced. The mainnet path refuses the rehearsal file by `_rehearsal` before anything else. The 19 selftest arms each go red when their guard is removed. Holds.

---

## Findings

### F1 — LOW — crank: a dropped reveal that is *not* the fee budget's is not recorded as a problem (R1)

**Construct.** `bank/crank.mjs` main() reveal loop: when `revealAttrSource(assetState)` returns `'skip'` (a null/other RPC read of the asset) the loop `break`s and logs to console, but pushes nothing onto `failures` and nothing onto `plan.problems`. Only the fee-budget path (`if (fee.dropped) failures.push(...)`) and the attribute-mismatch path (`failures.push(...)`) record anything.

**What it costs.** One reveal cycle is lost and retried next minute. It is not silent *forever*: `reveal_queue_stalled` (HIGH) fires after 30 minutes if `revealed_total` does not move. But a transient inconsistency on the head record can cost up to 30 minutes of latency with no page at the moment it happens, and the heartbeat carries no trace of it.

**Evidence if true.** On the box: a live crank log showing `skip reveal #N` with a `failures.length` of 0 in the same pass's heartbeat and no `crank_problem`/`crank_failing` until `reveal_queue_stalled` fires. On the suite: with `assets` for the head record set to `'other'` and the rest live, the planner produces a reveal, the send block sends nothing, and the heartbeat has `failures: 0, problems: []`.

**Fix.** Push a `plan.problems` entry naming the asset and the skipped index (it is not an action failure, it is a coverage gap), so `detectCrankHealth` escalates after three passes and the heartbeat is honest.

### F2 — LOW — crank: the fee-budget floor is the test-validator rent rate, and the comment says so backwards (R1/R4)

**Construct.** `bank/crank.mjs`: `REVEAL_RENT_LAMPORTS = 16n * 6960n`. 6,960 lamports/byte is the **test validator's** rent. SPEC fact 9 states mainnet rent is **5,080** lamports/byte. The per-reveal reserve is therefore *larger* than mainnet's real cost (16 × 5,080 = 81,280 < 111,360).

**What it costs.** Nothing directly — over-reserving is the safe direction. But the SPEC sentence it replaced and the code comment (`about 0.0001 SOL each`) describe a mainnet-sized figure that is 37% high. A future editor "correcting" the budget to the mainnet rate (to make the comment true) would be reasoning from a wrong constant, and the code's own header (`REVEAL_RENT_LAMPORTS` described as Core's rent) does not say which cluster it is from.

**Evidence.** `grep REVEAL_RENT_LAMPORTS bank/crank.mjs` returns `16n * 6960n`; SPEC fact 9 says 5,080/byte mainnet. A fork run shows a real mainnet-rent validator charging 81,280 per reveal, so the crank keeps ~30,000 lamports per reveal it never spends — harmless but a standing discrepancy between the budget and the thing it budgets.

**Fix.** State the cluster the constant is for (it is the conservative upper bound and should stay that way), or compute `16n * <max(mainnet,test)>` and say so.

### F3 — INFO — alarm: the unread-skip and log-gap sets survive an undelivered pass by design, but a delivery failure can leave a standing page whose signature has already become readable (R0/R2)

**Construct.** `alarm.mjs`: the `if (!delivered)` rollback restores `cursors`, `backlogs`, `sweepJudgedThrough`, `sweepCooldownSeen`, `revenueSince`, `vaults`, `deferredSweeps`, `frozen`, `paged`, `config`, `balances` — but **not** `unreadSkips`, `logGaps`, `unreadPasses`, `seenSplits`, `seenSweeps`, `crankHealth`. This is deliberate for the gaps/skips (they stand until a human reviews), but it means a skip recorded in a pass whose notice failed to deliver survives even after the cursor is rolled back and the signature re-read cleanly, and pages until a watermark is written.

**What it costs.** A false-standing `tx_skipped_unreadable` / `log_coverage_gap` page that the operator must clear by hand. No money moves; the finding is loud, not silent.

**Evidence.** A delivered=false pass that skipped signature X; next pass the cursor is rolled back, X re-reads cleanly (`looked.unreadSkips` empty), yet `skips.keep = prev.unreadSkips = [X]` and `tx_skipped_unreadable` still pages.

**Fix.** Acceptable as-is (the hand-clear is the documented remedy), but note it in the reader-boundary text so the operator knows a delivery failure is one reason a gap can stand on a now-readable signature.

---

## Accepted limits — the four questions

**1. Is any limit WORSE than stated?** I re-derived the ones that are checkable from the bundled source and found none worse than stated. Specifically:
- **Limit 10 (operator key).** The bound is still *cap × windows before the guardian stops*. `sweep_sol_for_swap` enforces `amount <= max_sweep_lamports`, `now >= last_sweep_at + sweep_cooldown_secs`, and `bal >= reserve + amount`, and requires the operator's signature — so a stolen operator key can only take what one capped, cooled sweep leaves it per window, from revenue above the reserve, and the alarm's `sweep_unledgered_state` (state-derived, flood-immune) pages within one pass of any sweep it cannot explain. The cycle guard (`cycleIsOpen`) and the `--audit` hand-recovery path are exactly as written. Not worse.
- **Limit 46 (PoB hot key).** The alarm still watches only the collection's plugin hash and update authority, not per-asset plugins, and the 7-day window exposure stands exactly as stated. `claim_charter_vault`'s `pob_extra ≤ 8` pass-through and the packet bound are as measured. Not worse.
- **Limit 27 (dead-vault claim/join).** Still open on chain: `claim` does not check the asset, so a bare-burned vault between burn and `retire_burned` can still be paid/joined by a stranger. The crank now retires first and never pays/joins a burned vault, but the program-side grief remains, exactly as accepted. Not worse.
- **Limit 58 (nested vault).** The host-owner race (R43.V1) is real, disclosed, and ruled; the crank sends the rescue every full pass. Exactly as stated. Not worse.

**2. Is anything listed as a limit actually closed?** No. I checked each ACCEPTED item's mechanism against the code and each is still open:
- 9/44 (undeclared holding destroyed): the only pre-signature control is the redeem page's `judgeRedemptionCoverage`, which is built and **not published** (item 50 OPEN). In production today nothing prevents an owner from destroying an undeclared holding.
- 27, 28, 39, 40, 41, 43, 46, 49, 55, 56, 57, 59: each mechanism is present and unchanged.
No limit is quietly closed.

**3. Is any DISCHARGED item not actually discharged?** I checked the DISCHARGED set (51, 54, 12/17, 14, 19, 30, 31, 33, and the v5 items that went with the Bank). Each is genuinely closed:
- 51 (boost) is built and exercised; the ring wraps correctly (host unit tests, 260 epochs, four wraps, every slot cross-checked against a model rebuilt from the records).
- 54/12/17 (compute) are measured on the artifact.
- 14 (duplicate attributes) is refused on chain.
- 19 (unlevelled payout halt) is closed by construction (`activate` requires `level ∈ 1..=5`).
- 30 (split bps) and 33 (operator notice) are discharged: the notice is an `initialize` value exercised in the suite, and its *value* is separately gated by the launch checker (item 38), which is correctly still OPEN.
No DISCHARGED item is overstated.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22 (no live distribution/revenue cycle ever run), 38 (launch values), 50 (holder surfaces not published), 52 (pool/Squads/revenue accounts must exist), 53 (dress rehearsal) are all correctly listed OPEN AND BLOCKING, and `check-launch-params.mjs` still refuses while `charter_opens_at`, `lock_deadline` and `vault_collection` are null. The HOLDER-GUIDE is marked DRAFT and item 50 explicitly forbids publishing it before the pages ship — so the guide's promises ("published before launch", "announced on X and the website") are tracked promises, not false claims. Nothing is being demoted.

---

## What this pass could not decide, and what I will not claim

- I ran nothing live. The mainnet probe and swap fork must actually run under the ship gate; `run-tests.sh` enforces this, but it is a procedure check, not something I performed.
- Item 22.5 (whether DAS sets `burnt` on a burned Core asset) remains genuinely open; nothing in the tree settles it.
- The backstop questions (Core upgrade reaching every vault; cbBTC freeze) are unchanged and correctly accepted.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

These are the concrete, ordered things this project must do that an AI audit structurally cannot do for it, before the upgrade authority is removed:

1. **Complete the open items in order and do not skip the ceremony step.** Fill `charter_opens_at`, the `lock_deadline` it follows, and record `vault_collection`; run `node scripts/check-launch-params.mjs` and get `[]`. Then walk road steps 9 → 10 → 11 exactly as written: deploy all five ids to the claimed placeholders, dump each and check the prefix hash **and zero tail**, create the vault collection and the three cbBTC accounts, fund the revenue address above rent, `initialize` with the ruled values, re-read every config back, and only then `--final`. Each of these is a one-way door; none of them is something a model can perform.

2. **Re-run item 53 at the release commit, in the recorded rehearsal tree, with the named pass/fail items.** This is the single most valuable thing left. It must include, with signatures recorded: the crank's live passes against ~2,100 vaults (including a transient RPC error mid-pass); the alarm's live passes in `CBOB_ALARM_REHEARSAL=1` mode against a rehearsal state dir; **one full revenue cycle through Orca and one with Orca forced to refuse so Meteora genuinely runs**, each ending with the ledger row closed and `--audit` clean; **one forced post-sweep failure walked through the hand recovery** and back to a clean `--audit`; and one DAS read of a burned Core asset (item 22.5). Round 43's V43o-1 repair made this runnable in the rehearsal tree for the first time; it has not been executed.

3. **Publish the holder surfaces (item 50) before the guide.** Build and serve `/vault/`, `/redeem/`, `/claim/`, `/buy/` and the ceremony from the committed release build, pin the deployed `app.js` hashes to the README table, and only then publish HOLDER-GUIDE. Until the redeem page is live, items 9 and 44 have no preventive control and every redemption that skips it can destroy an undeclared holding.

4. **Verify the Core pin on the morning of the lock, not on the day of the audit.** Metaplex moved Core twice under the suite in five weeks. Run `probe-mainnet-facts.mjs` (not `--selftest`) and `sim/swap-fork.sh` immediately before deploying, and re-run `scripts/build-mainnet.sh` to reproduce the five sha256 values from the release commit. A Core change between the audit and the lock is not a finding; it is a reason to stop and re-audit.

5. **Verify the five deployed programs by dump, then remove the upgrade authority, then verify again.** For each of the five ids: `program dump`, confirm the first `len(dist)` bytes hash to `dist/` and every byte after is zero, `set-upgrade-authority --final`, dump again, confirm identical. Record the five signatures and the `program_not_locked` all-clear from the alarm before the charter window opens.

6. **Fund and staff the two hot keys deliberately.** The swap operator needs more than the 0.02 SOL float and must hold nothing else (limit 10's operational clause). The $CBOB release wallet should be moved off this box before launch (limit 56) — that is Gary's call, but leaving it on the box is the single largest avoidable key exposure.

7. **Write the alert drill down.** The alarm pages per-kind streams with recoveries; nobody has ever watched a real one fire end-to-end. Before launch, deliberately provoke one freeze, one overdue distribution, one unledgered sweep and one unclaimed operator key, and confirm the operator reaches the right stream, can recover, and does not suppress a second kind. An untested alert path is an unverified control.

8. **Do not remove the upgrade authority until items 22, 38, 50, 52 and 53 are discharged in fact, not in the file.** Every one of them is a one-way consequence of a missed step, and no AI round can substitute for the human executing and recording them.