# Audit result

**This tree still has defects in the off-chain repairs.** The most consequential are silent omission of claims, reserve-read failures being adopted as zero balances, and incomplete chain anchoring of swap-cycle closure.

This is a **read-only review of the supplied source**, not an executed certification. The evidence below specifies reproducible tests and expected artifacts; I did not run them. Only MINT’s Rust source was supplied—not SEAL, BURN, GOV, the on-chain test file, or the mainnet probe. Consequently, this report cannot certify all four programs or independently validate the stated assertion counts.

I have not established a new CRITICAL or HIGH vulnerability from the supplied code. That is not a launch verdict.

---

## R1 — The crank

### R1-1 — MEDIUM: Planning problems can permanently omit payments without either liveness monitor paging

**Construct:** `bank/crank.mjs`, `planCrank()` and `main()`; `bank/detectors.mjs`, `detectCrankSilent()`.

**Evidence if true:** Give the planner a live active vault with a whole-sat entitlement, but an unreadable recorded token account. It returns:
- no claim for that vault;
- a diagnostic in `plan.problems`.

Run repeated LIVE full passes with that same read failure. Each pass prints the problem, sends no claim for the affected vault, and writes a fresh heartbeat with `failures: 0`. The crank sends no failure notification. `detectCrankSilent()` remains quiet.

**Fault:** `describePlan()` prints `plan.problems`, but `main()` never adds them to `failures` or otherwise notifies about them. The heartbeat only establishes that the pass reached its end.

This leaves a hole in round 23’s M3 repair: its stated blind spot says unsuccessful useful work is covered by the crank’s own failure pages, but **planning omissions are not send failures and do not page**.

An unreadable eligible requester eventually produces `joins_stalled`. An already-active vault whose claim is repeatedly omitted has no equivalent coverage. Ordinary traffic can keep distributions current, the pool can remain solvent, and the heartbeat can remain fresh.

**Gain/cost:** Persistent RPC/account-read trouble can leave a holder’s credited share undelivered indefinitely, without the promised operational warning. No destination changes; this is payout liveness failure.

**Fix:** Classify planning problems and notify on actionable omissions, with deduplication or persistence grace. Also monitor actual delivery backlog/progress independently of whether a process completed. A fresh heartbeat must not substitute for evidence that payable claims were attempted.

---

### R1-2 — LOW: The over-ceiling branch bypasses the new plan-sized minimum

**Construct:** `bank/crank.mjs`, `judgeFeePayer()`.

**Evidence if true:**
```js
judgeFeePayer(250_000_001n, { need: 254_856_000n })
```
returns `ok: true`, despite the balance being below `need`.

A plan with 2,100 captures and 2,100 reveals costs, under this file’s own constants:
```text
4,200 × 5,000 + 2,100 × 111,360 = 254,856,000 lamports
```

**Fault:** The function computes the raised minimum correctly, then checks `l > ceiling` and returns success **before checking `l < min`**.

The round-22 decision to run above the ceiling and the round-23 requirement to refuse below plan cost are compatible. This implementation makes the former override the latter.

**Gain/cost:** A large pass can start without its estimated funding requirement, then fail partway through. The resulting outage and pages are exactly what the plan-sized floor was introduced to prevent. Burst throughput limitations do not eliminate this independent predicate defect.

**Fix:** Check the minimum first. For a sufficiently funded balance above the ceiling, return success with a warning. Test all four combinations of sufficient/insufficient funding and above/below ceiling.

---

### R1-3 — LOW: The frozen-revenue repair does not cover the other frozen split destinations

**Construct:** `bank/crank.mjs`, `main()` account reads and `planCrank()` split planning.

**Evidence if true:** Freeze the Squads’ cbBTC ATA, leave revenue unfrozen and funded, and leave the pool healthy. The planner still sets `split = true` and includes the prospective 85% in `splitToPool`.

On execution:
1. `split_revenue` fails atomically on the frozen Squads destination.
2. If the pool previously had no available funds, the anticipated distribution fails with `NothingToDistribute`.
3. Subsequent passes repeat the refused split.

The same planning problem exists when the pool is frozen: the planner suppresses distributions and claims, but still plans a split into that frozen pool.

**Fault:** The new freeze guard examines only the **revenue source**. It does not check the Squads destination, and does not use the already-read pool freeze state to suppress the split.

**Gain/cost:** Repeated refused transactions and secondary false failure pages. The underlying issuer-freeze exposure is already accepted in limit 28; **the crank repeatedly planning known-impossible transfers is the new finding**.

**Fix:** Read and classify all split accounts before planning. Suppress the split when any required nonzero transfer cannot execute, report the specific obstruction, and do not include unexecutable split proceeds in distribution projections.

---

## R2 — The alarm

### R2-1 — MEDIUM: A failed individual reserve read becomes a zero balance and then the new baseline

**Construct:** `bank/alarm.mjs`, `main()`, the batched reserve-read callback:
```js
const info = infos[j], r = readTokenAccount(info)
balances[l.key] = String(r.amount)
```

**Evidence if true:** Start with a stored balance of 50,000 units. Have `getMultipleAccountsInfo()` successfully return an array containing `null` for that account.

Expected sequence:
1. `readTokenAccount(null)` yields `state: 'absent', amount: 0n`.
2. The alarm reports `reserve_fell`, not `balance_unreadable`.
3. After notification succeeds, it stores zero.
4. Repeated null answers produce no further reserve finding.
5. Recovery at 40,000 units reads as an increase from zero; the actual 10,000-unit decline is no longer compared with the last valid reading.

**Fault:** The repair handles a **thrown batch RPC call**, but not an unsuccessful account classification inside an otherwise successful batch. `foreign` and `malformed` are also stored as zero.

That contradicts the file’s promise to carry forward the last known value rather than invent zero.

An absent never-funded ATA is routine and must remain distinguishable from a previously observed valid account becoming unreadable.

**Gain/cost:** Read failures create false drain alarms, erase trustworthy history, and can mask a later real decline. Subsequent reports can claim no reserve fell while the account is still not being read successfully.

**Fix:** Judge `r.state` before adopting its amount. For a previously valid reserve account, preserve the last valid balance and issue an explicit read-health finding. Handle expected never-created ATAs separately. Test thrown RPC failures **and null/foreign/malformed elements in successful RPC responses**.

---

### R2-2 — MEDIUM: Honest $GARY and $GIRAFFISH redemptions cannot correlate with their burn

**Construct:** `bank/alarm.mjs`, reserve `legs`; `bank/detectors.mjs`, `detectBalanceDrops()` and `correlateBurns()`.

**Evidence if true:** An honest redemption is seen in the signature walk while DAS still lists its asset as live. The previous balance map contains:
```text
<asset>:<$GARY mint>     → positive balance
<asset>:<$GIRAFFISH mint> → positive balance
```

The closed accounts read as zero. `detectBalanceDrops()` emits `reserve_fell` findings with:
```js
asset: "<asset>:<mint>"
```
while `burn_via_program.asset` is only `"<asset>"`.

`correlateBurns()` therefore leaves the two reserve findings at HIGH. The cbBTC finding, keyed by the asset alone, can be downgraded.

**Fault:** Round 22 widened balance monitoring to every reserve but did not carry the real asset identity through the new composite keys. The prior redemption-noise repair was applied to cbBTC’s key shape, not to all reserve legs.

This is **not accepted limit 8**: the burn can be present in the **same pass**, and correlation still fails.

**Gain/cost:** Routine holder exits generate false HIGH pages, obscuring unexplained reserve declines and burns.

**Fix:** Represent balance identity and vault identity separately. For example, pass `{asset, mint, amount}` records to the detector, or provide a key-to-asset map. Test an honest redemption containing all three reserves with same-pass burn correlation and DAS lag.

---

### R2-3 — MEDIUM: Failure to read the installed crontab silently disables the crank heartbeat monitor

**Construct:** `bank/alarm.mjs`, `main()`:
```js
try {
  crankLive = D.crankArmed(execFileSync('crontab', ['-l'], ...))
} catch {
  crankLive = false
}
```

**Evidence if true:** Keep an armed crank’s previous state and a heartbeat older than four hours, but make `crontab -l` fail. The alarm:
- sets `crankLive = false`;
- produces no `crank_silent`;
- stores `crankArmedSince: null`;
- produces no finding about failing to establish cron posture.

Restore crontab reads later. The alarm starts a fresh three-hour arming grace period.

**Fault:** “Could not read whether the job is armed” is treated as “the job is deliberately unarmed.” This is another failed-read-as-quiet path introduced in M3’s wiring.

**Gain/cost:** A permissions, environment, or cron-service failure can suppress the only monitor for credited-but-undelivered claims. Repeated posture-read failures keep it suppressed.

**Fix:** Use three states: armed, unarmed, unknown. Page on unknown posture and preserve the last established arming state and timestamp. Do not reset its grace period because a read failed.

---

### R2-4 — LOW: Config-versus-DAS completeness comparisons are not taken from a coherent observation

**Construct:** `bank/alarm.mjs`, `readConfigs()`, later `listVaults()`, and calls to `detectIndexShortfall()`.

**Evidence if true:** Read `mint.minted_total = N`, then land a successful mint before DAS is queried. If DAS has indexed it by the query, the alarm receives `N + 1` unique IDs and reports `index_disagrees_with_chain` at CRITICAL.

No malformed index or impossible collection membership is required.

**Fault:** The exact-count assertion compares an earlier chain snapshot with a later index snapshot. During sales, ordinary progress can create the supposedly impossible “more assets than mints” result.

The pool insolvency reader was repaired to obtain paired observations. This sibling count comparison still lacks a race reconciliation.

**Gain/cost:** False CRITICAL pages during routine sales.

**Fix:** On disagreement, re-read the chain count and distinguish concurrent chain progress from a persistent indexing defect. Preserve fail-loud behavior for unresolved disagreements. Add a mocked I/O test with a mint between the two reads.

---

## R3 — Layouts

I am not filing a present field-order mismatch in the supplied MINT layouts. However, the claim that **every account** is declared and asserted cannot be independently established here: GOV’s source and its proposal/vote layouts were not supplied, and `STRUCTS` contains only the five listed layouts.

The source checks remain syntactic checks rather than a general Rust-layout proof. The executable-wiring weakness below is a separate R6 finding, not evidence that the current computed offsets are wrong.

---

## R4 — Money arithmetic

I have not identified a payout-formula divergence for valid, reachable MINT records in the supplied code. I did not execute the reported differential test or the validator suite.

There is still no retirement mirror function in `accrual.mjs`; the file now expressly acknowledges that limitation. I am not re-filing the corrected header as a defect.

### Round-23 repairs

The findings above specifically attack:
- **M3:** heartbeat completion does not cover planning omissions; unknown cron posture disables monitoring.
- **L9:** freeze-aware split planning covers the source, not every destination.
- **L14:** the plan-sized minimum is bypassed above the ceiling.
- **L16:** the counterpart branch below still accepts inadequately anchored cycle closure.

---

## R4b — Boosts and $CBOB creation

I have not established a path in the supplied creation transaction that leaves a partially minted supply or a surviving mint/freeze authority **if that transaction succeeds as constructed**. I did not verify the mainnet mint or execute creation.

The boost formulas and explicit pre/post-expiry planner paths do not yield a new finding in this review. This does not establish operational throughput, account-read coherence, or expiry liveness under a real crank run.

---

## R5 — The swap hop

### R5-1 — MEDIUM: Amount-and-time anchoring was repaired only for `splitByOther`, not for explicit `splitSig`

**Construct:** `bank/detectors.mjs`, `detectSplitClaims()`.

**Evidence if true:** Supply:
```js
seenSplits = [{
  sig: 'real-small-sale-split',
  blockTime: /* a real observed split time */,
  total: '1'
}]
```
and an old-enough ledger cycle with:
```js
sweptLamports: '10000000000',
quotedSats: '5000',
returnedSats: '5000',
splitSig: 'real-small-sale-split'
```

The explicit-signature branch accepts it because the signature was observed and was not reused. It does **not** require the split total to cover 5,000 sats or its time to follow the alleged return.

With a correctly recorded sweep amount, the sweep-matching detector also stays quiet. The return reconciler trusts the claimed positive return and matching quote.

**Fault:** Round 23 L16 introduced split totals and temporal anchoring, but applies them only to `splitByOther`. A ledger writer can use the sibling explicit-signature branch to claim an unrelated permissionless mint-revenue split as closure.

The function’s older comment admits amount blindness, but that admission is not an accepted carry-list limit and conflicts with the repaired reconciliation’s stronger claims.

**Gain/cost:** A compromised operator process can retain a sweep and make the monitoring pipeline read its fabricated cycle as reconciled. This does not increase the already-accepted operator spending authority; it defeats detection of misuse of that authority.

**Fix:** Apply total, ordering, and uniqueness requirements to explicit signatures too. More importantly, verify the actual cbBTC return transaction and destination from chain data. A large later split of sale revenue alone cannot prove a claimed swap return.

Tests should cover:
- unrelated small explicit split;
- explicit split preceding the return;
- fabricated return followed by a sufficiently large sale-revenue split;
- genuine return and genuine split.

---

## R6 — Gates

### R6-1 — LOW: The cron preservation repair can arm the full crank from a reveal-only line

**Construct:** `scripts/cron-install.sh`, `ours()` and the `CRANK_LIVE` preservation branch.

**Evidence if true:** Feed the extracted preservation logic this uncommented line:
```text
* * * * * cd /opt/cbob-vaults && node bank/crank.mjs --live --reveal-only #cbob-vault-cron crank-reveal
```

`ours crank` matches `#cbob-vault-cron crank-reveal` as a substring. The next grep matches `crank.mjs --live`. The installer therefore sets `CRANK_LIVE=' --live'` and arms the **hourly full pass**, despite there being no armed full-pass line.

The existing negative test places `--reveal-only` before `--live`, so it misses this equivalent argument ordering.

**Fault:** The preservation function does not match the exact tagged job. The alarm’s `crankArmed()` is stricter than the installer’s preservation logic.

**Gain/cost:** Reinstalling cron can turn reveal-only authorization into authorization to activate, distribute, claim, and split.

**Fix:** Anchor the exact tag at the line end and explicitly exclude reveal-only invocations. Test both flag orders. Share one posture judgment rather than maintaining different interpretations.

---

### R6-2 — LOW: Derived detector coverage still proves text presence, not executable wiring

**Construct:** `bank/selftest.mjs`, `V6_WIRED` and:
```js
const calls = (src, n) => new RegExp(`D\\.${n}\\(`).test(src)
```

**Evidence if true:** Remove an executable detector call and leave:
```js
// D.detectPoolHealth(
```
in `alarm.mjs`.

The wiring gate still accepts that detector. The mutation arm replaces every textual occurrence, including comments, so it does not test this failure mode.

**Fault:** Deriving the list of required detectors fixed list incompleteness, but the caller check can still be satisfied by non-executable text or dead code. It cannot support the claim that deleting any operational call turns the build red.

**Gain/cost:** A detector can remain proven in isolation while its actual alarm invocation disappears without this wiring gate failing.

**Fix:** Exercise the alarm orchestration through injected fetch/read dependencies and assert detector invocation and resulting findings. An AST-based check can supplement that test, but a raw substring search is not executable coverage.

---

# The four questions about accepted limits

## 1. Is any limit worse than stated?

**Limit 7’s repaired liveness assurance is still incomplete.** R1-1 and R2-3 show ways claims can remain undelivered without `crank_silent` or a crank failure notification.

**Limit 10’s monetary authority bound is not newly enlarged by R5-1.** Its detection assurance is weaker than the repaired reconciliation implies: unrelated explicit splits can satisfy closure.

**Limit 8 does not encompass R2-2.** That finding persists despite having the redemption and reserve decline in the same pass.

I am not re-filing capture throughput, issuer freezing, operator trust, hot $CBOB custody, or boost exhaustion through paid distributions.

## 2. Is anything listed as a limit not actually a limit?

No additional discharge is established by this review.

Two qualifications matter:
- The operator wallet’s “only cycle funds plus float” condition is an **operational invariant**, not an enforced balance ceiling; `revenue.mjs` checks a minimum.
- The code’s explicit `distribute` path can credit from a frozen pool, as SPEC elsewhere acknowledges. “Frozen pool stops claims” must not be read as “frozen pool prevents every distribution.”

## 3. Is any DISCHARGED item not actually discharged?

I have not established a reopened discharged item from the supplied source.

That is limited evidence: the paired redemption programs, GOV, and the on-chain assertion bodies needed to reassess several discharges were not supplied.

## 4. Is OPEN AND BLOCKING being quietly treated as accepted?

The supplied roadmap still labels items 22, 38, 50, and the launch prerequisites as blocking. I do not find evidence here that the project has actually launched past them.

There is nevertheless a **gate discrepancy**: `judgeLaunch()` exempts `charter_opens_at` and `lock_deadline` from its RULED-status requirement. Its own positive test fills their values while retaining their OPEN status and expects success. Thus “nothing OPEN” currently means “no missing value,” not “every launch decision has been approved.”

Before signing, require explicit approved status for those dates. A filled-in but still OPEN owner decision must not become a launchable decision merely by gaining a number.

---

# Anything else

**Do not treat this bundle as a whole-four-program audit.** Its headings and brief request that scope, but the delivered Rust source contains only MINT. The absent program sources and test bodies prevent independent review of redemption pairing, rate-limit implementation, governance execution, and the assertions claimed to certify them.

Also, a successful source test count establishes neither meaningful coverage nor the truth of its labels. Preserve assertion counts, but add mutation evidence and end-to-end orchestration tests rather than relying on counts as the certification.

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Before launch, do the following—not another prose-only round:

1. **Run the shipped crank and alarm together at realistic scale.** Use approximately 2,100 vaults, overlapping lanes, bursts, eligible joins, boosted records, bare burns, and all three reserves. Record transactions, fees, latency, missed captures, delivered claims, and actual notifications.

2. **Fault-inject the I/O boundaries.** Return null account elements inside successful batches; throw on late batches; fail crontab reads; interrupt processes after sends but before ledger saves; fail notification delivery; delay DAS relative to chain state. Assert what survives into the next pass and what is actually paged.

3. **Prove alerts reach someone outside this machine.** An independent watchdog should notice machine/network failure, stale monitoring, and undelivered alerts. Trigger each condition deliberately and retain delivery receipts.

4. **Verify the launch transaction bytes, not just the JSON.** Decode every proposed initialization transaction and compare its accounts and arguments with approved values. After landing, read every immutable parameter back through an independent RPC before removing authorities.

5. **Build and exercise the promised holder surfaces before lock.** Test actual wallet signing, destination-account preparation, coverage scans, boost expiries and joins before payout, frozen-pool exits, and deposit races. A pure preflight function is not a redemption page.

6. **Reproduce and pin the production artifacts independently.** Record the exact source commit, dependency/toolchain versions, build hashes, deployed bytes, initialized accounts, and finalized authority state. Obtain matching reads from separate providers.

7. **Write a binary launch checklist for every blocking item.** Each item needs an artifact, a pass/fail condition, and an identified person authorized to attest completion. In particular, do not discharge live-chain rehearsal or holder-surface requirements merely because another AI round found no new issue.

AI review can generate hypotheses and inspect supplied code. It cannot substitute for observed execution, working operational response, authentic launch approval, or proof that the bytes locked on chain are the bytes tested.