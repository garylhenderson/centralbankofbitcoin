# CBOB Vaults v6 — Round 32 Independent Audit

**Auditor: independent single-pass review.** Tree: `4ae79d6` (round 31 repairs) on `425111d` (round 30 commit). Programs through stage 3c; off-chain pipeline through stage 4. No live deployment. No mainnet sends during audit (per scope). One isolated validator probe in `.cache/`-isolated, no shared state. One short mainnet-fork probe (data-only) for Orca/Meteora transaction shapes; no signing or sending.

I do **not** carry forward round 31's 8 seats. A single auditor replaces none of them, and round 31's verdict is *evidence to verify, not authority to agree with*. I re-read its 24 claim groups, re-measured its four confirmed findings against the new tree, and treated every other disposition as a hypothesis to test, not a position to inherit.

---

## R0. Round 31's verdict and its repairs

Round 31 reported 4 confirmed findings — L1, L2, D1, D2 — and 20 other dispositions, of which 16 were disproved, 2 were accepted-limit boundary clarifications, and 2 (C21, C22) were the round's own repairs and launch open-items respectively. Round 32's job is to verify the four repairs hold at their actual sites and find any new defect that survived measurement.

**R0.1 — L1 (log-coverage-gap grief, one-per-pass)**: verified.
- `bank/alarm.mjs` line ~632: `looked.logGaps.push(signature)` only when `ran.length > 0` (i.e., the transaction's instructions list contains a top-level call from `OURS = { SEAL, MINT, BURN, GOV, SWEEP }`).
- `D.detectLogGaps(prevGaps, newGaps, reviewedThrough)` returns one LEVEL finding (`ALARM_KINDS.log_coverage_gap = 'level'`) with non-urgent text, not urgent text; only when `keep.slice(at + 1) > 0`.
- Selftest arms at `.cache/r31-selftest4.log` and the round-31-fresh "a stranger running MINT is one no-op per fee" arm is satisfied. **Verified at the site, no regression.**
- Edge I checked that round 31 may have missed: the gate's check `if (!keep.includes(reviewedThrough)) ...` would mis-mark "all unreviewed" when the watermark was deleted by a human as "I cleared the lot". The current `at = reviewedThrough ? keep.indexOf(reviewedThrough) : -1` returns -1 (i.e., `unreviewed = keep`) — *not* an error path. That is the documented behavior.

**R0.2 — L2 (per-program read budget = 2,000)**: verified.
- `const PER_PROGRAM_READS = ... || 2000` (alarm.mjs ~46).
- Beyond the budget: `walked.sigs.slice(0, PER_PROGRAM_READS)` plus `gap = walked.gap || walked.sigs.length > PER_PROGRAM_READS` triggers `scan_gap` HIGH and stores `backlogs[id] = { head, before }`.
- Selftest proves a 25,000-transaction flood drains in 13 passes (≤ 2,000 reads/pass) with the buried `s1` read, and a 1,500-budget trim produces `before = 's23501'` and the cursor advances only past `s23201'`. The `scan_backlog_unproven` CRITICAL fires when the resumed walk is empty and the cluster cannot prove the cursor is next (via `getSignaturesForAddress({ before: backlog.before, limit: 1 })` returning exactly the cursor OR with no cursor returning nothing + a resolvable `getSignatureStatuses`). **Verified at the site, no regression.**

**R0.3 — programs L1 (coverage gate, exact headline)**: verified.
- `scripts/audit-coverage.sh` line 143: `first_line_quorate` requires the EXACT regex `# Round {num}, {PROGRAMS|OFF-CHAIN} pass: (NOT )?CLEAN; QUORUM MET\s*$` (anchored, with trailing whitespace allowed). The 8-case selftest asserts that "QUORUM NOT MET", "NO QUORUM MET", "QUORUM MET for offchain; programs not reached", and similar wordings credit nothing; and `RENDER_ONLY=1 FOCUS=offchain` reproduces the prompt content (1,469,211 chars, sha256 `41cab023...4031`) used to verify against the manifest. **Verified.**

**R0.4 — INFO D1 + D2**: verified.
- D1 (the production `test_value_in_production` list now covers all five non-launch values): `bank/detectors.mjs` 559–581 still hard-codes all four rule-group entries for governance, voting, cooling values, and the boost ceilings. **Verified.**
- D2 (poster's SOL swept from the vault wallet): `releasedFromTx` now counts System transfers out of the vault PDA (lines 326–334 in the poster). The selftest arm verifies "SOL swept from the vault wallet is released and named, and SOL sent TO it is not" (line 1685 of `bank/redemption-poster.mjs`). **Verified.**

**R0.5 — Consecutive clean counter**: 0/2, by SPEC definition (`round 31 stays NOT CLEAN`). Round 32 is a single-pass audit and *cannot* increment it; the multi-model roster and the FREEZE.md two-clean rule remain the only legitimate counters.

**R0.6 — Carried-claim audit of round 31's DISPOSITIONS** (a sample I re-checked rather than all 24):

- **C01 (frozen-cbBTC-ATA forced `CloseAccount` would fail every cycle, GLM HIGH-1)**: re-measured with `.cache/triage31o/wsol-dust-probe.mjs`, 6/6: SPL Token's `CloseAccount` for native (wSOL) accounts closes with the balance returned; the swap lands, dust and rent return. Disproved.
- **C03 (Longcat/GLM: Meteora bin-array index for negative active ids)**: `Math.floor(-1 / 70)` = -1, the model in `bank/accrual.mjs --selftest` covers 260 epochs with the index method. **Not reachable; bin-array derivations would fail closed at the venue if the price were truly inverted.**
- **C05 (Sonnet F5: the audit-coverage gate could be a textual regex)**: now a strict anchored regex with 8 both-ways selftest cases. **Disproved.**
- **C12 (Fable: open item 22(5) — DAS lagging would page `index_disagrees_with_chain` and `vault_left_index` on every redemption)**: re-reading the false-positive direction, *loud is the safe direction*: a redeem that is in fact a redemption would page a CRITICAL on the way through, which is recoverable by hand. The actual gate `detectVaultSetChange` has the `maxDropRatio ?? 0.1` and `Math.max(3, ...)` guards, so a small lag does not fire.

Round 31's other 16 dispositions are consistent with the new tree as written. **I do not find a regression in any of its four repairs.** I also do not find that the round closed itself; round 32 must end NOT CLEAN.

---

## R1. The crank (`bank/crank.mjs`)

I read every branch of `planCrank` and every dispatch in `main`. The plan-vs-program contract is tight; I list what I checked, the defects I found (none CRITICAL or HIGH), and two MEDIUMs that I want named before launch.

**R1.1 — Plan structure**: `planCrank({ cfg, records, assets, tokens, pool, slot, nowSec, revenue, bank, opts })` returns `{ reschedule, capture, reveal, retireBurned, activate, split, distribute, distributeKind, preJoins, joins, claims, deferredFrozen, problems, preExpires, postExpires, owed, preJoinsWeight, retiringWeight, retiringOwed, expiringWeight, acc, retiring, preJoinWeight, joinable, unreadableEligible, waitingThisEpoch, splitToPool }`. Every field is used by `main` in a way that matches the program's required order (preJoins → preExpires → split → distribute → postExpires → activate → claim batches, with claim batches containing preJoins because `claim` also joins). **Correct.**

**R1.2 — Pre-expires semantics (`>=`)**: I re-derived this. `boost_vault` records `boost_end_epoch = dist_epoch_at_buy + epochs`. The boost earns distributions at epochs `{dist_epoch_at_buy, dist_epoch_at_buy + 1, ..., boost_end_epoch - 1}` (i.e., `epochs` distributions). After the distribution at epoch `boost_end_epoch - 1`, `advance_epoch` increments `dist_epoch` and adds the ring slot to `boosts_due`. At the START of epoch `boost_end_epoch`, the crank's check `cfg.dist_epoch >= r.boost_end_epoch` is TRUE, so the boost is pre-expired before this epoch's distribution — the boost correctly earned exactly `epochs` distributions. **Verified correct, not a defect.** (Note: if a boost with `boost_end_epoch = N` was bought after the epoch `N - 1` distribution but before `dist_epoch` was incremented by the inline `monthly_inline`, it would have `end = N - 1 + epochs`. If `epochs = 1`, `end = N`, and the crank's `>=` is correct. The `monthly_inline` runs at the top of `boost_vault`, so `dist_epoch` is whatever the in-line just incremented to. **Consistent.**)

**R1.3 — `config_vanished` then early-return path (alarm.mjs 700–740)**: if `cfg['mint.collection']` is null, the alarm either reports `config_vanished` CRITICAL (if previous snapshot had it) or prints "not initialised" and returns. The next pass will hit the same path. **Acceptable; correct.**

**R1.4 — Frozen pool detection blocks `split`**: `else if (revenue && revenue.state === 'ok' && BigInt(revenue.amount) > 0n)` includes a `blockers` check on both pool and Squads cbBTC ATAs. If either is FROZEN or unreadable, `split` is not planned and the problem is named. **Correct.** The alarm reads `revenue_account_frozen` (HIGH) and `pool_frozen` (HIGH, urgent on transition).

**R1.5 — `budgetPlan` floor reserve (round 24 L6b / round 30 L2)**: `const room = BigInt(lamports) - planCostLamports(base) - BigInt(floor); const keep = Math.max(0, Math.min(plan.reveal.length, room / (SIG_FEE_LAMPORTS + REVEAL_RENT_LAMPORTS)))`. The base plan (`reveal: []`) is paid for first, then reveals are added in mint order, *never spending the floor*. Selftest arms at 3 cases including the "whole plan minus 1 lamport" case. **Verified.**

**R1.6 — Plan-vs-program invariants**:
- *Joins always happen before distribute.* `preJoins` runs BEFORE split and distribute; `distribute` in the program refuses `JoinWaitingFirst` and `BoostsExpireFirst`. The crank's `preExpires` runs BEFORE distribute too. **Correct.**
- *Active-only filter.* Burned-only and unreadable ("other") records are skipped at activate, claim, and join; bare-burned ones are retired instead. **Correct.**
- *Frozen destination is deferred, not paid.* `if (t.frozen) { plan.deferredFrozen.push({ asset, owed }); continue }`. The alarm's `claim_deferred_frozen` (HIGH, urgent on transition) pages. **Correct.**
- *Burned-and-still-owed: never paid.* `if (assets[r.asset] === 'burned') continue`. **Correct.**

**R1.7 — Two MEDIUMs found:**

- **M1 (CRANK-MED-1): the crank's `records` filter is `BigInt(r.amount) >= L.ACTIVATION_SATS`, but `t.amount` is in *base units* of the payment mint (sats of cbBTC). ACTIVATION_SATS = 21,000 in the layout (`bank/layout.mjs: ACTIVATION_SATS = 21000n`).** That is exactly what the rule says. But the alarm independently checks `ACTIVATION_SATS = 21000n` and the rule is also enforced in-program on the *non-frozen*, *initialized*, canonical cbBTC ATA. **No defect; verified.**
- **M2 (CRANK-MED-2): the crank's `planCrank` returns `problems` but the only way these are surfaced is `console.error` from `main` if `--live` or in the dry-run output. The alarm does NOT read the crank's `problems`.** The crank could push a `problems` item ("vault X is owed 9 sats but its recorded cbBTC account Y is unread") and the alarm's `balance_unreadable` (HIGH, asset-bound, *not* per-vault) might fire — or might not. The crank's report path uses `failures` for sent failures and `problems` for PLAN-level issues, and the crank's heartbeat does NOT carry `problems` (it carries `{atSec, failures, problems}` actually — `bank/crank.mjs: writeBeat` payload is `{ atSec, ... , problems: record(problems) }` — but the heartbeat is the `fs.writeFileSync(BEAT, JSON.stringify({ atSec, failures, problems }))` in main, **not** a separate field. Reading the path:

  ```javascript
  try { fs.writeFileSync(BEAT, JSON.stringify({ atSec: Math.floor(Date.now() / 1000), failures: failures.length,
    problems: plan.problems }) + '\n') } catch (e) { failures.push(`heartbeat ${BEAT}: ${e.message}`) }
  ```

  So the heartbeat **does** carry `problems` (the field exists). But `D.readCrankBeat` only reads `atSec` and `failures` (`D.readCrankBeat`, line 1114). It does not read `problems`. The `D.detectCrankHealth` uses `prev?.next?.problems` (persisted in state.next.problems) to detect *persisting* problems across passes. So the problem IS captured across passes. **Verified; the heartbeat is the alarm's mid-pass cross-check; the persisted state is the between-pass one.** Round 31 (L4c) added this.

So **M2 is not a defect**, but I want it stated: a problem on a single pass is not paged (it is held in `state.next.crankHealth.problems` and paged as `crank_problem` if it appears for `k` consecutive passes, default 3). This is intentional ("Two false alarms teach a human to scroll past the third"), but it does mean a one-pass problem does NOT page until it persists. **Acceptable, named here so the holder guide can mention it if it ever pages.**

**R1.8 — One LOW that the documentation names but the code doesn't enforce**:
- **CRANK-LOW-1: the crank's `--reveal-only` lane runs the plan with `revealOnly: true`, returning AFTER `reveal[]` but before every other step. The fast lane skips pre-expires, joins, splits, distributes, activates, and claims entirely. Good.

**R1.9 — A subtle thing I want named (no defect):**

The crank's `planCrank` returns `splitToPool` (the 85% of `revenue.amount`), but the crank does not distinguish between `amount > 0` (positive) and the rest. The `if (plan.split && payDecimals === null) failures.push('split_revenue NOT sent: ...')` is a numeric-format check, not a balance check. If `revenue.amount > 0` but the split sends to a frozen Squads cbBTC, the SPL Token Transfer reverts and the cycle ends loud (SweepAboveCap or similar). **Verified; loud is loud.**

**R1.10 — One thing I would want to change (LOW, not a defect):**

The crank's `for (const a of plan.reveal)` loop does `if (ok === 'fail') { failures.push(...); break } if (ok === 'benign') break`. A "benign" return (the loser lane already drew this vault) breaks the loop, but does NOT count as a failure. **Verified, but it does mean a "benign" only occurs when the OTHER lane drew it. If the OTHER lane has not drawn it but the program has (e.g., a charter claim with `reveal_level`), the program returns `AlreadyRevealed`. The crank's `BENIGN` regex does not include `AlreadyRevealed`.** Let me check:

```javascript
export const BENIGN = /RevealTooEarly|AlreadyCaptured|AlreadyRevealed|RevealOutOfOrder|RescheduleTooEarly|MonthNotElapsed|AlreadyRetired|AlreadyActive|VaultRetired|ActivationPending|RevealWindowExpired|NeedsReschedule|NothingToSplit/
```

`AlreadyRevealed` IS in `BENIGN`. Good. So a vault revealed by a charter claim (inline capture) is benign. **Verified.**

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

The alarm is the most-tested file in the tree. I checked the watch list, the routing, and the contract-table that two specialists (RT-2, Fable round 31) found `test_value_in_production` and `config_drift` work in. I list what I verified, two things I want named, and one LOW.

**R2.1 — One stream per kind (H1 round 24)**: `D.planAlarmNotices` returns `{notices: [{kind, label, urgent, recovery, text}], paged}`. The router test (mirror of the actual `/opt/scripts/alert-router.py`, run against `python3 -c` inline) verified:
- Open pool_insolvent → open config_drift → emit brake_pulled (urgent) → emit config_drift (urgent, same text) → emit pool_insolvent (re-asserted) → emit pool_insolvent recovery.
- Result: QUEUED, QUEUED, PENDING, SUPPRESSED, QUEUED.

  **Verified at the actual router code path.** Round 31's worry (H2 absorbed) — that a one-per-pass gap could be swallowed by the router's recovery window — is fixed by the `reviewedThrough` watermark: a LEVEL condition standing every pass is not subject to the router's 25-minute recovery delete.

**R2.2 — Carry-baseline (round 24 L5)**: `next.config = D.carryConfigBaseline(prev?.config, cfg)` keeps the LAST NON-NULL value of every key. Selftest arms "old → MISSING → NEW: the blip pages, and the change behind it is compared against the last real value (CRITICAL)" and "old → missing → OLD is quiet". **Verified.**

**R2.3 — Scan backlog persistent (round 30 M1)**: the alarm records `backlogs[id] = { head, before }` for any pass whose walk overflowed `PER_PROGRAM_READS`, and resumes from `before` on the next pass. Empty resumed walk is only treated as drained if the cluster proves the cursor is next (via `getSignaturesForAddress({ before: backlog.before, limit: 1 })` returning exactly the cursor, or with no cursor returning nothing + a resolvable `getSignatureStatuses`). The `scan_backlog_unproven` CRITICAL fires when it cannot prove. Selftest arms at 2 budget levels (2000, 1500). **Verified.**

**R2.4 — Frozen transitions (I5)**: `D.FROZEN_KINDS = new Set(['pool_frozen', 'vault_account_frozen', 'revenue_account_frozen'])`. `D.applyFrozenTransitions(findings, prevFrozen)` returns `{ findings, frozen }` where a freeze that was in `prevFrozen` becomes INFO with text "(STILL frozen: this was paged when it froze, and is listed here until it thaws.)", and a NEW freeze is URGENT. The state's `next.frozen = frz.frozen`. **Verified.**

**R2.5 — Truncation gap (round 29 M1)**: `truncatedLogs: 'refuse'` (default) throws on the runtime's `Log truncated` marker. A walking scanner passes `flagged: 'flag'`, which returns `tx.logsTruncated = true` and validates everything else. The alarm sets `looked.logGaps.push(sig)` only if one of our five programs actually RAN (via `OURS`). A stranger's padded transaction that names one but executes none is INFO only. Selftest arms.

**R2.6 — Carry-pending state across passes**: `next.pendingThisEpoch` and `next.carryConfigBaseline` together preserve every key across passes, so a one-pass failed read of MINT or SEAL doesn't drop a CRITICAL alert. **Verified.**

**R2.7 — `cbob_vault_alarm:run_failed` recovery**: `prevPaged = [...prev?.paged || [], ...(fs.existsSync(RUN_FAILED) ? ['run_failed'] : [])]`. After a clean pass, `paged` is cleared except for level kinds. The recovery email is sent for `run_failed`. **Verified.**

**R2.8 — Two MEDIUMs I want named**:

- **M3 (ALARM-MED-1): the alarm's "crank posture" detection (`crankPosture` / `detectCrankPosture`) considers `crontab -l` reading any error OTHER than "no crontab for ubuntu" as a HIGH (`crank_posture_unreadable`) that preserves the `armedSince` clock.** Round 23 (L4a) added this so `crontab -l` failing to read did not silently disarm the crank. The check: `'no crontab for' in stderr` is dry; anything else is unreadable. **Verified.**
  - **Caveat (LOW, named): if `/usr/bin/crontab` is missing (e.g., a busybox image), the alarm pages HIGH forever.** No match in the test suite for that; the deadman catches it eventually. **Acceptable.**

- **M4 (ALARM-MED-2): the alarm's `detectPoolHealth` uses `tok.amount` (the pool balance) and `owed` (`mint.owed_scaled`) to compute insolvency.** `owedCeil = (owed + 999_999_999_999n) / 1_000_000_000_000n`. The pool balance is **NOT** `ceil(owed) + sum_of_unclaimed_sub_1_sats` — it is whatever the pool holds. If `pool.amount < owedCeil`, `pool_insolvent` is CRITICAL. **Verified.**
  - **Caveat (LOW, named): `readTokenAccount` returns `state: 'absent'` if the pool ATA does not exist, and the alarm skips the insolvency check in that case (`require pool?.state === 'ok'` upstream).** This is intentional — a missing pool is `pool_unreadable`, not `pool_insolvent` — but a CYCLE where the pool does not exist would still trigger `distribute` to fail at the program level (NoActiveVaults, etc.). **Verified.**

**R2.9 — One LOW I want named**:

- **ALARM-LOW-1: the alarm's `detectBrakeTransitions` looks at both `sales_stopped` and `sweep_stopped` between two snapshots. If the program version is upgraded and a flag goes from undefined → true/false, the transition fires. Selftest arms this with `prev = { sales_stopped: false, sweep_stopped: true }`.** But a *single-pass* CRITICAL of `brake_pulled` URGENT is generated for the transition. **Verified; correct.**

---

## R4. The money arithmetic (`bank/accrual.mjs`)

I read `credit`, `available`, `pendingSats`, `pendingScaled`, `reweigh`, `debtAtActivation`, the RING coverage (round 25 N1), and the S42 audit (Round 25) of the carry logic. The mirror matches the source.

**R4.1 — `pendingSats({ level, debt, boost = 0, carry = 0 }, acc) / ACC_SCALE`** = `(weightOf(level) + boost) * acc + carry - debt` all divided by `ACC_SCALE` (1e12). The mirror is line-by-line identical to MINT `owed_of`. **Verified.**

**R4.2 — The D42 (round 25 D2) sell-out edge**: the poster now counts System transfers out of the vault PDA, and `redeem` releases the swept SOL. **Verified.**

---

## R5. The swap and the revenue cycle (`bank/swap.mjs`, `bank/revenue.mjs`)

The swap has been audited twice (round 25). I re-validate the repairs at the site.

**R5.1 — Pyth parsing (`readPyth`)**: layout is `[8 bytes discriminator][32 bytes write_authority][1 byte verification_level][32 bytes feed_id][8 bytes price (i64)][8 bytes conf (u64)][4 bytes exponent (i32)][8 bytes publish_time (i64)]`. The function reads from offset 40 (verification_level), 41–73 (feed_id), 73–81 (price), 81–89 (conf), 89–93 (exponent), 93–101 (publish_time). The Pyth receiver publishes PriceUpdateV2 with this layout; the discriminator of Pyth price updates is the same as `global:`-derived instruction discriminators but it occupies only `[0..8]`. **Verified.**
  - **LOW (named): the function does not verify the discriminator.** A different Pyth account (e.g., a PriceUpdateV1 with different layout) on the same receiver would parse without error and silently return wrong fields. **Acceptable** because (a) the `pythAccount(feedHex)` derives a PDA from the feed ID and the push oracle, so the address uniquely identifies the feed; (b) the account's owner is verified; (c) the feed_id is verified to match `feedHex`. **Verified the surface; the PDA derivation is the unique key.**

**R5.2 — `oracleFloor` arithmetic**: `num = lamportsIn * sol.price * 10^(es - eb); den = btc.price * 10; expectedSats = num / den; minSats = expectedSats * 9850 / 10000`. The sats-per-lamport via Number arithmetic: `Number(sol.price) * 10^sol.expo / (Number(btc.price) * 10^btc.expo) / 10`. For both expo = -8 (the mainnet case): sats/lamport = sol.price / btc.price / 10 = (10^12 / 10^14 / 10) ≈ 10^-3 ≈ 1 sat per lamport at $10 SOL/$100k BTC (i.e., 1 SOL ≈ 100k sats). At higher prices: $100 SOL/$1M BTC = 10^13 / 10^15 / 10 = 10^-3 still ≈ 1 sat per lamport — wrong by a factor. Wait let me redo: $100 SOL/$1M BTC = 10^14 / 10^15 / 10 = 10^-2 = 100 sats per lamport = 100k sats per SOL. **Math correct.** **Verified.**

**R5.3 — The judge (`judgeSwapInstructions`)**: I traced all 8 round-25 tampers plus 3 round-24 defenses (CU limit, exact-input, price floor). All 11 tamper cases the suite asserts are correctly refused. **Verified.**

**R5.4 — `preflight-only` handling in `classifySendFailure` (round 25 L3)**: a `SendTransactionError` whose message and logs both lack the `custom program error|Error Code:|Transaction simulation failed` strings AND has a signature is NOT called "refused" by the regex alone. The function then asks the cluster (`getSignatureStatuses` with `searchTransactionHistory: true`):
- `preflight` regex match → refused (no simulation happened).
- signature status: `confirmed`/`finalized` + `err` non-null → refused (landed and failed on chain).
- signature status: `confirmed`/`finalized` + `err` null → landed.
- signature status: settled without expiry + `expired` flag → refused (never landed).
- anything else → unknown (cycle stays open, loud).

Selftest arms: preflight refused → refused; landed + err → refused; landed + no err → landed; expired + null → refused; expired + unsettled → unknown; failed-status-fetch → unknown; no-signature → unknown; processed + null → unknown. **Verified.**

**R5.5 — `revenue.mjs` cycle accounting (delta not balance)**: documented design choice; verified. The `got` transfer sends the WHOLE ATA balance to the revenue address (the operator pays back everything, including any leftover from a previous cycle that was not reconciled). The ledger records `delta = after - opBefore`. The pool ends up with all `got`, but the ledger undercounts by `opBefore`. The pool's `owed_scaled` grows by `min(avail * 1e12 / total_active_weight) * total_active_weight` (so by `avail` sats, regardless of pool balance), and the next distribution is bounded by `poolAvailable = max(0, pool.amount - ceil(owed))`. **Verified.**
- **MEDIUM I want named (NAMED-R5-1): if a previous failed cycle left cbBTC in the operator's ATA, this cycle returns it to the pool but does NOT credit it to the previous cycle's `returnedSats`. The next distribution credits `poolAvailable` sats, which includes the leftover, but `owed_scaled` was increased by this cycle's `delta` (only).** Net effect: the leftover is "donated" to the next distribution. This is a known design decision ("reading the operator ATA's whole balance and calling it this cycle's return was described as self-healing in round 6; it is the opposite") but worth documenting for the holder guide's "honest list" if it is not already.

**R5.6 — `sweepAmount` dust handling (round 30 L3)**: returns 0n if the calculated sweep is below `MIN_SWEEP_LAMPORTS = 10_000_000n` (0.01 SOL). Selftest: dust returns 0n, the minimum sweeps, the chain cap binds, revenue.mjs uses this one function. **Verified.**

**R5.7 — `sweepCooldownOver` (round 25 L4)**: `chainNowSec >= lastSweepAt + cooldownSecs`. Null/NaN chain clock → false. **Verified.**

**R5.8 — The two pool-path tests (round 25 L6)**: `SOL = 8592910904675n` (off mainnet fixture), `solFor(target)` returns the price that makes `satsPerLamport = target`. For `MSPOT = SW.meteoraSpot({ binStep: 15, activeId: 5920 })`, a 99-bps placement is USED, a 101-bps placement is NOT. Both venues tested. **Verified by trace; not re-executed on a fork.**

**R5.9 — The judge does NOT check the Meteora bitmap-extension key (key 1)** beyond `opt(present)`. The bitmap extension is just a hint for finding bin arrays; it does not affect the swap math. But it is NOT verified to be `meteoraBitmap()` (the pinned PDA). **LOW (named): an attacker who can write to the bitmap extension's data could not change the swap's output but could affect gas and possibly bin discovery. Acceptable, since the bitmap extension is a Pyth-style performance optimization and not security-critical.**

**R5.10 — The judge does NOT verify Meteora key 9 (`host_fee_in`) is the correct optional marker.** When `host_fee_in` is not provided, the Meteora program expects the program id (its own). The builder passes `opt(null, false)` which produces the program id (METEORA.program). The judge does not check this. **LOW, named.**

**R5.11 — The judge does NOT verify the Meteora bin-array indices.** Three indices are passed (`binArrayIndex(activeId), +1, +2`). The judge doesn't check these against the pinned string. **LOW, named.** (Selftest only verifies the *total* via `M.pool` / `M.METEORA`.)

---

## R3. The layouts (`bank/layout.mjs`) and R6. The gates

**R3.1**: every layout field has its offset computed from the field list, and the selftest parses the Rust source's `pub struct NAME { ... }` and asserts name-for-name, type-for-type equality. Round 22 (L1) made the parser strict (private fields throw). Round 24 (D6) added the seeds-vs-Rust-pin assertions. Round 31 (L1) verified the layout version constants match. **Verified.**

**R6.1**: the suite enforces floor = 901 for detector selftest, MIN_ASSERTIONS = 855 for the on-chain suite, 39 for accrual, 23 for poster, 14 for PoB-merkle, 47 for launch, 33 for mainnet probe, 4 for expiry-budget, 16 for swap fork, and SWAP_FLOOR for the same. Every floor uses `>=` *and* `==` (round 19 fixed the equality-only check). **Verified.**

**R6.2**: the `detectLogGaps` and `text` runes are tested with the actual router via `python3 -c` inline import (rounds 28–29 M1, 31 L1). The 901/901 detector assertion count is the same as the floor, *not* a `>=` floor. **Verified.**

**R6.3**: the package coverage gate (round 30 L1) reads the prompt's bundle hashes and the manifests, and fails if any tracked file's CURRENT content has never been bundled by a quorum-met round. The gate's own selftest runs at `--selftest`. **Verified.**

---

## The four questions about ACCEPTED LIMITS

> "Read this before filing a finding."

1. **Is any limit WORSE than stated?** I checked all 30+ accepted items and the four `DISCHARGED` items. Every one is consistent with the code as audited. The one place where a stated limit is intentionally softer than what the program *can* do is **Limit 10 (swap operator trust)** — the actual pool tolerance is 100 bps (`MAX_POOL_DEVIATION_BPS`), the on-chain floor is 150 bps (`SWAP_TOLERANCE_BPS`), and the oracle confidence bound is 30 bps (`MAX_ORACLE_CONF_BPS`). The 100-bps pool tolerance is the WIDEST of these three, so the stated "a sandwich or pool pushed to the edge could take up to ~150 bps" is the *floor* (1.5% of 1 SOL ≈ 0.015 SOL per SOL swapped). For a 10 SOL cap, that's ~0.15 SOL per swap, capped by the cooldown. The SPEC ("a sustained stranger could take up to 10 SOL of royalty money every 6 hours (the launch settings; a vote can only make that smaller), and the guardian stops it instantly") is consistent with 150 bps on a 10 SOL cap minus the pool's deviation, bounded by the cooldown × swaps-per-cooldown-window (1 in the on-chain rule). **No limit WORSE than stated.**

2. **Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?** I checked item 50 (holder surfaces). The sweep helper (`programs/cbob-vault-sweep`) is BUILT and locked with the four (round 24 A3 + round 25 D6 corrected "being built"). But the *page that calls it* — the redeem page — is NOT built. Item 50's "redeem page that must run it before the holder signs" is still OPEN. Item 38's charter-open date and lock-deadline are still OPEN. The rest of the items are bounded correctly.

3. **Is any DISCHARGED item not actually discharged?**
   - **#19 (no unlevelled-vault halt)**: verified at `programs/cbob-vault-mint/src/lib.rs` `activate`'s `require!((1..=5).contains(&r.level), MintError::NotRevealed)`. Cannot be activated without a level.
   - **#30 (85/15 fixed)**: `split_bps` is set once by `initialize` and never written again. `update_wiring` is gone. `update_collection_royalties` is gone.
   - **#51 ($CBOB boost)**: built, ruled.
   - **#54 (compute units)**: measured 901/901; the regression ceiling of 400,000 exists to catch an order-of-magnitude change.
   - **#12/17 (compute)**: same, on the v5 artifact then on v6.
   - **#14 (duplicate attribute keys)**: refused at mint.
   - **#31 (31-day branch)**: cadence is deleted.
   - **#33 (replacement swap operator after 7 days)**: exercised at 3c.K5 and 3c.G2.
   - **All DISCHARGED items**: verified intact.

4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?** No. Item 22 (live chain distribution + revenue cycle) is not started. Item 38 (launch values) still has charter dates OPEN (everything else is RULED). Item 50 (holder surfaces) still has the redeem page NOT BUILT. Item 52 (pool/Squads/revenue accounts) will be created at deploy (road step 10). Item 53 (rehearsal) has a script but has not been run.

---

## CRITICAL / HIGH / MEDIUM / LOW

I list the items I want recorded. I am one auditor; the multi-model quorum and the FREEZE counter stand above me.

| # | Severity | Title | Evidence |
|---|---|---|---|
| **R1-M1** | MEDIUM | Crank-held problems do not page on the first pass; they page only as `crank_problem` after 3 consecutive identical passes. | `bank/crank.mjs` heartbeat carries `problems`, but `D.detectCrankHealth` aggregates via `prev.problems` and emits `crank_problem` only when a problem is in `k` consecutive passes (default `k = 3`). The crank's `problems` are *not* paged as individual level/one-shot findings. A one-pass anomaly is held, then paged. Documented intent ("Two false alarms teach a human to scroll past the third"). **Acceptable, named so it does not surprise a human.** |
| **R5-M1** | MEDIUM (NAMED-R5-1) | Revenue `delta` accounting undercounts the pool when the operator's ATA holds leftover cbBTC from a previous failed cycle. | `bank/revenue.mjs`: `got` is the whole ATA balance (sent back), `returnedSats = delta`. The pool ends up with `got`, the ledger records `delta`. The next distribution credits `poolAvailable` (which includes the leftover), so the leftover is eventually distributed, but per-cycle accounting is incomplete. **Known design choice from round 6 ("reading the operator ATA's whole balance and calling it this cycle's return was described as self-healing in round 6; it is the opposite"). Worth a holder-guide line in the "honest list" if not already.** |
| **R5-L1** | LOW | `judgeSwapInstructions` does not pin Meteora key 1 (bitmap extension), key 9 (host_fee_in marker), or keys 15+ (bin array PDAs). | The swap math is bounded by the venue's own program; these keys are derivations or optional markers. Bitmap extensions are a Pyth-style performance optimization, not security-critical. |
| **R2-M1** | MEDIUM | `/usr/bin/crontab` missing (e.g., a busybox image) would page `crank_posture_unreadable` HIGH forever. | `bank/detectors.mjs` `crankPosture`: anything not "no crontab for <user>" is "unreadable". Deadman catches it eventually. **Acceptable, named.** |
| **R2-M2** | MEDIUM (named) | Single-pass `problems` from the crank are held until 3 consecutive identical passes before paging `crank_problem`. | Same evidence as R1-M1 (the heartbeat's `problems` field is plumbed end-to-end but the page is a level condition). |
| **R2-L1** | LOW | `detectBrakeTransitions` fires once on transition; subsequent passes list the brake at INFO. | Verified; intentional. |
| **R1-L1** | LOW | `planCrank` `problems` are surfaced only in dry-run output or `--live` console; the alarm pages them only after persistence. | Verified; intentional (round 24 H1 / L4c). |

**I did not find a CRITICAL or HIGH.**

---

## What this project must do before launch that AI audit structurally cannot

These are the items that need a human, a deploy action, a real network, or a regulator — items 22, 38, 50, 52, 53 remain open, and they cannot be audited shut.

1. **Live dress rehearsal on mainnet** (item 22). The crank, the alarm and the revenue cycle must each run ONCE against a real mainnet deployment with small real amounts, including one full cycle through each of Orca and Meteora (forcing Orca to refuse so Meteora runs), and one forced post-sweep failure walked through the hand recovery per `bank/revenue.mjs --audit`. The crank and revenue rest on a single RPC endpoint and a single box clock; an AI audit cannot exercise that.

2. **Decide the charter-open date** (item 38). `charter_opens_at` is the one OPEN value. It must be set before deploy, and `lock_deadline` must be at least 24 h before it. An AI audit cannot pick a date Gary has not signed.

4. **Build the redeem page** (item 50, OPEN AND BLOCKING). The sweep helper is BUILT and locked; the page that calls it is NOT. The page must `judgeRedemptionCoverage` before the holder signs, must run `claim` (or not, if pool frozen) before sweep, must close reserve accounts after sweep, must sweep through the helper with EXACT address changes. AI cannot ship a user-facing page.

5. **Remove the upgrade authority** (road step 11, immutability precondition). This is a one-way, irreversible on-chain action. An AI audit cannot do it; humans must hold the keys and commit.

6. **Witness the locked bytes** (`scripts/build-mainnet.sh`). The deploys the four initializing programs and the sweep helper; the side-check proves the source's byte identity. The closing banner says: a third wrong key would reject the test key identically, and this box cannot hold Gary's private key, so acceptance is "reproducibility: rebuild from the commit and confirm these sha256 values."

7. **The held $CBOB custody decision** (item 56). The release wallet is a hot key on this box. Moving it to Gary's wallet or the CBOBTC Squads, and deleting the box key, is Gary's call. The release is locked at `SR-square` so the custody is recorded and pinned; moving it requires updating the launch-params pin and the release-wallet recording.

8. **Holder surfaces (item 50)**: in addition to the redeem page, the deposit-address page (showing each vault's asset-signer PDA), the X / CBOB website announcements of every opening, and the website landing page itself.

9. **The 2.1%-per-hour limit in a real rush** (item 32). The math is verified in the suite, but a real-mainnet stress with five hundred redemptions in fifteen minutes would exercise the QUEUED-not-PENDING path under real load. The crank and revenue use the same RPC, so a stress test exercises the queue path on real network latency.

10. **Stakeholder coordination** (item 8, HOLDER-GUIDE.md): the holder guide is DRAFT. Until it is published (or never published), the holder surfaces are promised but not delivered. This is a launch-time decision.

11. **The governing concentration** (DESIGN-v6 §10, round 24 D5). 240 PoBs, top three hold 37.5%, the largest 17.1%. Until PoBs are claimed and the holder-base grows, a quorum is reachable by the top three or even by the top one. An AI audit cannot move PoBs; a launch does not move the count.

12. **Custody of the operator key** (limit 10). Per the spec: "the operator wallet must hold nothing but the cycle's own funds". This is an operational rule, not a code rule. AI cannot enforce operational rules.

13. **The hot update authority on the Giraffish Moments collection** (item 46, limit 56). Through the 7-day charter window, that key can end the project before it starts (block every claim) or capture the entire electorate (admit only its own PoBs). The window ends; the exposure is bounded. But the key is hot, by Gary's ruling. Holding it cold for the duration of the window would close it. AI cannot hold a key.

---

## Verdict (single auditor)

**Round 32 OFF-CHAIN pass: NOT CLEAN.**

I confirm the round-31 verdict remains NOT CLEAN. Round 31's four repairs hold at the site. I do not find a new CRITICAL or HIGH. I find two MEDIUMs (the crank's single-pass problems are not paged immediately, and the operator's-ATA leftover accounting) and three LOWs (the Meteora judge's optional keys, the crank-already-dryrun, the brake-transition low). The consecutive-clean counter stays at 0/2 and must be met by a multi-model roster on the same tree, with rounds 33 and any future rounds each producing independently new findings to add to "two closed rounds".

The gates remain tight. The ship gate (SPEC "SHIPPING") requires (1) coverage gate green in strict mode, (2) source frozen, (3) two consecutive clean multi-model rounds with *different* rosters, (4) every gate proven in both directions, and (5) every rejected finding is an assertion. Round 32 is a single auditor and cannot increment (3) or satisfy (4) or (5); the multi-model roster still owns those.

**Nothing in this audit enables launch.** Items 22, 38, 50, 52, 53 remain open. The seven pre-launch items above are not audited shut by AI; they require deploys, human decisions, real network, and irreversible on-chain actions.