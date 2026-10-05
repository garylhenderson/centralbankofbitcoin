## Scope and verdict

**Do not treat this review as launch certification.** The supplied material contains the off-chain pipeline and MINT’s Rust source, but not the Rust sources of SEAL, BURN, or GOV, nor `tests/3prog.test.ts`, the mainnet probe, or the mainnet build verifier. I cannot independently certify those implementations or reproduce their reported measurements from this bundle.

I did not execute code or query a cluster. Below, **“evidence” means the specific expected result of a reproduction, not a test I ran**. Findings based on JavaScript control flow are distinguished from cases requiring validator execution.

I found defects in the repaired fee gate, retirement planning, heartbeat reporting, cron arming, and swap reconciliation. **None below establishes a new on-chain theft vulnerability in MINT. Several defeat operational controls that the stated loss bounds depend on.**

# R1 — The crank

## R1-1 — MEDIUM: The plan-sized fee repair prevents affordable entropy captures

**Construct:** `bank/crank.mjs`, `main()`’s call to `judgeFeePayer(..., { need: planCostLamports(plan) })`, before any transaction is sent.

**Evidence to obtain first:**

Build a reveal-only plan containing 60 uncaptured records whose hashes are ready, with sufficient window remaining:

- `capture.length = 60`
- `reveal.length = 60`
- Estimated total cost:
  ```
  120 × 5,000 + 60 × 111,360 = 7,281,600 lamports
  ```
- Give the fee payer 6,000,000 lamports.

The fee gate should refuse the entire pass. **Zero captures will be sent**, although all 60 captures cost only 300,000 lamports and the balance exceeds the ordinary 5,000,000 floor.

On a validator, let this persist beyond the capture window. The records should remain uncaptured and become reschedulable.

**Fault and consequence:** The L14 repair coupled a time-critical, cheap operation—capture—to the rent budget for a non-time-critical operation—reveal. A wallet that can preserve every draw instead preserves none.

This is not merely the accepted serial-throughput limitation in item 25. It introduces a new cause of deliberate non-capture: **the script refuses to do affordable urgent work because later work is unaffordable**. Both lanes use this gate. Rescheduling can then repeat without ever capturing the new draw.

**Fix:** Budget and execute phases independently:

1. Preserve entropy first, within a bounded transaction-fee budget.
2. Perform affordable reveals afterward.
3. Report the unrevealed remainder and required rent.

Do not require funding for an entire reveal backlog before allowing captures.

### Adjacent LOW defect: the ceiling bypasses the calculated floor

`judgeFeePayer` returns `ok: true` for an over-ceiling balance **before** checking `l < min`.

A direct reproduction is:

```js
judgeFeePayer(251_000_000n, { need: 260_000_000n })
```

It returns permission to run despite insufficient funds.

The supplied maximum supply can produce a capture-plus-reveal estimate above the ceiling: 2,100 such records cost 254,856,000 lamports.

**Fix:** Insufficient-funds refusal must take precedence; an over-ceiling warning is an independent result.

---

## R1-2 — LOW: Retirement planning updates weight but not liabilities; it can miss a distribution and leave a boost due

**Construct:** `bank/crank.mjs`, `planCrank()`’s `retiringWeight`, distribution `available(...)`, and `postExpires`; MINT’s `retire`, `claim`, and `monthly_inline`.

**Evidence to obtain first:**

Use this consistent state, with `S = ACC_SCALE`:

| Record | State | Weight | Debt | Carry | Owed at `acc = 5S` |
|---|---|---:|---:|---:|---:|
| C | Bare-burned, active | 2 | 0 | 0 | 10 sats |
| A | Live, active | 2 | 0 | 0 | 10 sats |
| B | Live, boosted +2 | 4 | `20S` | 0 | 0 |

Further state:

- `total_active_weight = 8`
- `owed_scaled = 20S`
- Pool balance = 20 sats
- Monthly distribution is due
- B’s boost ends at `dist_epoch + 1`

Expected planner result:

- Retire C.
- No explicit distribution: it computes availability using the **old** `20S` liability.
- Claim A only.
- No post-expiries.

Expected execution:

1. Retiring C reduces liabilities to `10S` and weight to 6.
2. A’s claim runs `monthly_inline`.
3. That distributes the newly available 10 sats and advances the epoch.
4. B’s boost becomes due.
5. B is neither claimed nor expired by this plan.

The pass ends with `boosts_due = 1`; A’s actual payment also differs from `plan.owed`.

**Fault and consequence:** The prior differential report already acknowledged conservative misses after retirement. The supplied planner still contains that divergence. With boosts, the consequence extends beyond an underestimated payment: **an unplanned inline distribution can leave an expiry gate engaged after a nominally completed pass**.

Funds remain program-pinned. Delivery and expiry wait for another caller/pass.

**Fix:** Subtract each retiring active record’s exact `pendingScaled` entitlement from projected `owed_scaled`, as well as removing its weight. Test the complete send order, including inline distributions, against the actual Rust implementation.

---

## R1-3 — LOW: The frozen-revenue repair does not cover frozen split destinations

**Construct:** `bank/crank.mjs`, `planCrank()`’s split branch and `main()`’s account reads.

**Evidence to obtain first:**

- Set revenue to readable, unfrozen, positive balance.
- Set the pool to frozen.

`planCrank` still sets `split = true`, although it separately reports that the pool is frozen.

On a validator, the SPL transfer into the frozen pool should refuse. Separately freeze the Squads cbBTC ATA: the crank never reads that account’s state and should repeatedly attempt a split that refuses when its bank cut is nonzero.

**Fault and consequence:** L9 checks the source account only. The same transaction requires usable destinations. The accepted issuer-freeze risk is not the finding; **predictably submitting the known-refused plan on every pass is**.

**Fix:** Read and validate both split destinations before planning a split. Gate the Squads leg on its calculated nonzero cut, matching MINT. Distinguish “split blocked” from “distribution/claims blocked.”

# R2 — The alarm

## R2-1 — MEDIUM: A fresh heartbeat can certify a pass that silently omitted owed vaults

**Construct:** `bank/crank.mjs`, `plan.problems`, `describePlan()`, and heartbeat write; `bank/detectors.mjs`, `detectCrankSilent()`.

**Evidence to obtain first:**

Use a live, active, owed vault whose asset read is `'other'`, while its recorded token account remains readable.

Expected behavior:

- `planCrank` excludes its claim and appends a problem.
- `main()` prints that problem.
- The problem is never added to `failures`.
- A live full pass writes a fresh heartbeat with `failures: 0`.
- No crank notification is sent.

Repeat this while DAS and the alarm’s reserve-account reads remain healthy. The alarm should see neither a stale heartbeat nor an overdue distribution attributable to these unpaid liabilities.

**Fault and consequence:** The heartbeat’s documented blind spot says unsuccessful useful work is covered because “its failures page from the crank itself.” **Planning problems do not page.** The L2 live-only repair therefore introduced an omission path that the M3 heartbeat repair can read as healthy.

This requires an inconsistent/unreadable asset response, not an attacker’s ability to rewrite a real Core account. It is nevertheless the RPC-failure case these repairs explicitly target.

**Fix:** Separate:

- Process heartbeat: the pass finished.
- Work-health status: obligations omitted, unresolved reads, failed actions.
- Progress: claims delivered and oldest outstanding work.

Persist and page unresolved planning problems. Do not label such a pass failure-free.

---

## R2-2 — MEDIUM: A crontab read failure disables the crank watchdog and erases its arming history

**Construct:** `bank/alarm.mjs`, `main()`:

```js
try { crankLive = D.crankArmed(execFileSync(...)) }
catch { crankLive = false }

const crankArmedSince =
  crankLive ? (prev?.crankArmedSince ?? nowSec) : null
```

**Evidence to obtain first:**

1. Persist an armed crank with an old heartbeat.
2. Make `crontab -l` fail for one alarm pass.
3. Let the alarm write state.
4. Restore the crontab read.

Expected results:

- The failed-read pass emits no crank-watchdog-read failure.
- It stores `crankArmedSince: null`.
- The next successful read starts a new three-hour grace period.

Persistent read failure disables `crank_silent` indefinitely.

**Fault and consequence:** “Could not determine whether automation is armed” is interpreted as “automation is intentionally dormant.” This contradicts the pipeline’s fail-loud read policy and weakens item 7’s repaired detection claim.

**Fix:** Use a tri-state arming result. On unreadable configuration, page and retain the previous arming state/time. Treat deliberate disarming as a separately observable transition, not as indistinguishable from a read failure.

---

## R2-3 — MEDIUM: Findings are consumed after sending only one detail; drift also lacks the one-shot delivery flag

**Construct:** `bank/alarm.mjs`, `report()` and subsequent state advancement; `bank/detectors.mjs`, `detectConfigDrift()`.

**Evidence to obtain first:**

Generate two independent config changes in one pass. Capture the notifier’s arguments.

Expected outgoing message:

- Counts for both findings.
- The detail of only `crit[0]` or `high[0]`.

After the notifier exits successfully, run another pass with the same chain state. Both changes should disappear from drift detection because the baseline advanced.

Also test a pass containing **only** config drift: the notifier environment should lack `ALERT_URGENT=1`.

**Fault and consequence:**

1. A second permanent-value change is not delivered by detail, only represented in a count and local logs, before its baseline is consumed.
2. The source explicitly says the alert router buffers messages unless `ALERT_URGENT` is set for one-shot findings. Config drift is one-shot but is not marked urgent.

The router itself was not supplied, so I cannot establish its actual buffering behavior. The missing flag and truncated notification payload are directly visible.

**Fix:** Deliver all finding identities/details, possibly in bounded chunks or a durable report link. Persist a pending-notification outbox and acknowledge individual delivery. Mark drift and other baseline-consumed findings as one-shot/urgent. A successful notifier process exit is insufficient if it means only “accepted into a buffer.”

---

## R2-4 — LOW: The all-reserve repair broke redemption correlation for $GARY and $GIRAFFISH

**Construct:** `bank/alarm.mjs`, reserve balance keys; `bank/detectors.mjs`, `detectBalanceDrops()` and `correlateBurns()`.

**Evidence to obtain first:**

```js
const drops = detectBalanceDrops(
  { 'VAULT:GARY_MINT': '100' },
  { 'VAULT:GARY_MINT': '0' }
)

correlateBurns([
  ...drops,
  { kind: 'burn_via_program', severity: 'INFO', asset: 'VAULT' }
])
```

The reserve drop remains HIGH because its `asset` is `VAULT:GARY_MINT`, not `VAULT`.

**Fault and consequence:** During ordinary redemption with DAS lag, cbBTC drops can correlate correctly, but the other reserve drops cannot—even when the redemption is scanned in the same pass. This is **not** accepted limit 8’s cross-pass correlation lag.

**Fix:** Store vault identity and mint separately. Preserve `asset: vault` on every reserve finding; put the mint in its own field. Add a three-reserve redemption-correlation test.

---

## R2-5 — LOW: Successful RPC calls containing unreadable accounts overwrite balances with invented zeros

**Construct:** `bank/alarm.mjs`, reserve-account `chunk.forEach`; `bank/spl.mjs`, `readTokenAccount()`.

**Evidence to obtain first:**

Start with a positive prior reserve balance. Return a successful `getMultipleAccountsInfo` response containing a foreign-owned or malformed account for that leg.

Expected behavior:

```js
balances[l.key] = String(r.amount)
```

writes `"0"` despite `r.state !== 'ok'`. No `balance_unreadable` finding is produced. The exception handler—which carries balances forward—is never entered.

**Fault and consequence:** The code handles transport failure differently from invalid account data. It can produce a false balance-drop page and then adopt zero as the next baseline. Subsequent actual loss can be obscured by that adopted baseline.

**Fix:** Branch on the reader’s state, not merely whether the RPC threw. Preserve prior balances for malformed/foreign responses and emit a named unreadable finding. Handle an absent account explicitly, including legitimate redemption correlation.

# R3 — Layouts

## R3-1 — LOW: The offset completeness check only covers constants that its narrow regex recognizes

**Construct:** `bank/selftest.mjs`, `pinned()` and the “every OFF_ constant” assertion.

**Evidence to obtain first:**

Add a cross-program offset using either legal Rust form:

```rust
const OFF_NEW: usize = 1_000;
pub const OFF_NEW: usize = 1000;
```

The scrape:

```js
/^const OFF_(\w+): usize = (\d+);/gm
```

recognizes neither. Consequently, the “none scraped and ignored” assertion has no knowledge that the new offset exists.

An existing mandatory offset changed into such a form would fail because its expected entry becomes undefined. **A new offset of an unsupported shape is the uncovered case.**

**Fault and consequence:** The repair proves completeness relative to the regex’s output, not relative to all offset declarations or cross-program reads. A new raw offset can escape the asserted map without changing assertion counts.

The supplied selftest also contains no Rust comparison for `SEEDS`, despite `layout.mjs` saying those seeds are asserted.

**Fix:** Discover all candidate offset declarations first and reject unsupported syntax. Compare the complete discovered set with the mapped set. Add explicit seed parity checks. Prefer generated layout metadata where feasible.

# R4 — Money arithmetic

The supplied `accrual.mjs` formulas do not establish a new arithmetic divergence from MINT for valid reachable states:

- `pendingScaled` includes both boost weight and carry.
- `reweigh` preserves accrued entitlement.
- `credit` uses the same truncating division.
- `available` deliberately clamps insolvency to zero, whereas explicit MINT distribution refuses it; this difference is disclosed.

**The demonstrated money-planning divergence is R1-2:** `planCrank` projects retirement’s denominator change but not its liability change. That also means `plan.owed` is not an exact prediction for every pass.

The allocation selftests do not independently establish Rust parity merely by restating these formulas in JavaScript; see R6.

# R4c — Other round-23 repairs

## R4c-1 — MEDIUM: Reinstalling cron can arm the full crank from a reveal-only line

**Construct:** `scripts/cron-install.sh`, `ours()` and the `CRANK_LIVE` preservation branch.

**Evidence to obtain first:**

Supply this existing line, with the full-pass crank dormant:

```cron
* * * * * cd /opt/cbob-vaults && node bank/crank.mjs --live --reveal-only #cbob-vault-cron crank-reveal
```

Expected installer behavior:

- `ours crank` matches `#cbob-vault-cron crank-reveal` because it uses substring matching.
- The command matches `crank\.mjs --live`.
- `CRANK_LIVE` becomes ` --live`.
- The reinstall arms the full hourly crank as well.

The existing test uses the opposite argument order, `--reveal-only --live`, which avoids the vulnerable match.

**Fault and consequence:** A deliberate decision to arm only the reveal lane is promoted into authorization for joins, distributions, activation requests, and claims. These remain permissionless and program-pinned, but the installer violates its explicit opt-in boundary.

`crankArmed()` uses an anchored full-pass tag and therefore disagrees with the installer on this input.

**Fix:** Anchor the exact job tag at end of line and exclude `--reveal-only` independently of argument order. Use equivalent parsing rules in the installer and alarm. Test both argument orders.

# R4b — Boosts and $CBOB creation

The missed post-distribution boost expiry is covered by **R1-2**.

For the supplied token-creation transaction, I do **not** find a basis to claim that transaction success can leave a partial supply, live mint authority, or freeze authority:

- Initialization specifies no freeze authority.
- Full minting and mint-authority revocation are in the same transaction.
- A transaction failure does not establish a partially committed mint.

This is a source-level conclusion about the transaction construction, **not independent verification of the mainnet mint or creation receipt**. Those require the actual chain reads and transaction artifact.

# R5 — The swap hop

## R5-1 — MEDIUM: A matching on-chain sweep can be hidden by a forged `sendRejected` flag

**Construct:** `bank/detectors.mjs`, `cycleIsOpen()`, `detectUnreconciledRevenue()`, `detectUnledgeredSweeps()`, and `detectDeferredSweeps()`.

**Evidence to obtain first:**

For an actual successful sweep, write:

```js
{
  sweepSig: ACTUAL_SUCCESSFUL_SWEEP,
  sweptLamports: ACTUAL_AMOUNT,
  intendedLamports: ACTUAL_AMOUNT,
  startedAt: OLD_TIME,
  sendRejected: true
}
```

Expected results:

- `cycleIsOpen` returns false.
- `detectUnreconciledRevenue` skips it because returned sats are zero and the cycle is considered closed.
- `detectUnledgeredSweeps` accepts the matching signature and amount.
- `detectSplitClaims` has no split claim to challenge.

The combined detectors produce no missing-return finding.

**Fault and consequence:** The watcher’s own chain evidence does not override a contradictory lifecycle flag written by the audited process. This defeats the very threat model documented beside `detectUnledgeredSweeps`: an operator/key compromise accompanied by ledger manipulation.

The on-chain sweep cap and cooldown remain enforced. **The detection needed to prompt the guardian can disappear.**

**Fix:** A successful on-chain sweep must establish a chain-derived obligation regardless of ledger flags. `sendRejected` must be checked against the submitted transaction’s actual status, not accepted as an unconditional exemption.

A related bypass exists through a far-future `startedAt`: the ledger-controlled grace clock can suppress return reconciliation indefinitely. Anchor sweep age to verified block time and reject contradictory timestamps.

---

## R5-2 — MEDIUM: Split anchoring still permits a fabricated return to be reported as reconciled

**Construct:** `bank/detectors.mjs`, `detectSplitClaims()` and `detectUnreconciledRevenue()`; `bank/alarm.mjs`, split observations.

**Evidence to obtain first:**

### Explicit-signature branch

Use:

- A real, uniquely claimed split signature that moved one sat, before the revenue cycle.
- A ledger row claiming a 5,000-sat return and naming that signature as `splitSig`.
- A matching quote of 5,000 sats.
- A correctly recorded actual sweep.

Expected result: no split-total or ordering finding. The explicit-signature branch checks existence and reuse, **not total or relation to the return**.

### `splitByOther` branch

Use a real later split of at least 5,000 sats funded entirely by paid mints, with **no actual operator return**. Give the cycle fabricated `returnedSats` and `returnedAt`.

Expected result: that unrelated split can anchor the cycle.

**Fault and consequence:** L16 added a size check only to one branch, and neither branch proves that the claimed return happened. Since mint revenue and swap returns share the account, a sufficiently large mint-revenue split cannot establish that royalty SOL was converted and returned.

**Fix:** Verify the return transaction itself:

- Successful chain status.
- Correct cbBTC mint.
- Transfer into the pinned revenue ATA.
- Verified amount and ordering.
- No reused attribution across cycles.

Then establish that the verified deposit was split. Apply equivalent amount/order rules to explicit and inferred split claims.

---

## R5-3 — MEDIUM: The documented 0.02 SOL float fails the next ordinary cycle

**Construct:** `bank/revenue.mjs`, `OPERATOR_FLOOR`, operator ATA creation, and the cycle’s fee payments.

**Evidence to obtain first:**

1. Fund a fresh operator with exactly 20,000,000 lamports.
2. Ensure its cbBTC ATA does not exist.
3. Run a successful revenue cycle.
4. After cooldown, fund the revenue PDA for another cycle and run again.

Expected result:

- The first run passes the floor.
- It pays for its permanent cbBTC ATA and transaction fees.
- The swept amount is swapped, not retained to restore the float.
- The operator ends below 20,000,000 lamports.
- The next run refuses before sweeping.

This does not depend on the operator holding unrelated assets.

**Fault and consequence:** The accepted-limit justification repeatedly describes a cycle’s funds plus a **0.02 SOL float**, but the code uses 0.02 SOL as a **minimum starting balance on every cycle**, with no replenishment mechanism. A normally funded job can stop after its first successful cycle.

**Fix:** Define separately:

- Target float.
- Minimum budget to finish a cycle.
- Refill threshold and authorized refill procedure.

Measure worst-case rent and fees, monitor the float independently, and update the stated custody bound to the actual operational target.

---

## R5-4 — LOW: Crash recovery still relies on sampling a zero revenue balance

**Construct:** `bank/revenue.mjs`, `returnedUnsplit` recovery before the open-cycle guard.

**Evidence to obtain first:**

1. Return cbBTC and successfully split it.
2. Crash before saving the split result.
3. Deposit fresh mint revenue before the next revenue-job run.
4. Keep fresh mint revenue arriving between the hourly crank split and the six-hourly revenue run.

Expected result:

- The old cycle is economically complete.
- Recovery never sees an empty ATA.
- The open-cycle guard refuses every subsequent revenue cycle.
- `cycle_unsplit` can continue alleging that the old return remains unsplit.

**Fault and consequence:** This is the same zero-sampling assumption repaired in `detectRevenueAccount`, left in the money job’s S6 recovery. A busy sale makes a completed cycle harder to recover than a quiet one.

**Fix:** Recover from verified transaction history, not the current balance being exactly zero. Alternatively, after verifying the return, safely split the current positive balance and record that successful completion. Do not infer historical non-completion from newly deposited revenue.

# R6 — Gates and evidence quality

## R6-1 — LOW: Detector “wiring” tests do not prove findings reach the report

**Construct:** `bank/selftest.mjs`, `V6_WIRED` and `calls()`.

**Evidence to obtain first:**

In a scratch copy, replace:

```js
findings.push(...D.detectPoolHealth(cfgAtPool, pool))
```

with:

```js
D.detectPoolHealth(cfgAtPool, pool)
```

Expected result:

- The source-search wiring checks still pass.
- Pure detector tests still pass.
- Assertion count remains unchanged.
- A runtime frozen-pool finding is discarded.

**Fault and consequence:** Deriving the export list repaired missing names, but the gate still proves only textual call presence. It does not prove invocation on the production path or consumption of the result.

**Fix:** Add an executable alarm integration harness with injected RPC, filesystem, clock, and notifier dependencies. Feed each dangerous state through `main()` and assert the resulting notification/state behavior. Retain the source check only as a supplementary check.

---

## R6-2 — LOW: The account-allocation assertion compares the layout to itself, not to Rust allocation

**Construct:** `bank/selftest.mjs`:

```js
t('...its fixed part is the length the program allocates before padding',
  enc.length, L.fixedLength('MintConfig'))
```

**Evidence to obtain first:**

Change `MINT_CONFIG_SPACE` in a scratch Rust source without changing the fields.

This assertion remains unchanged because:

- `encode()` derives length from `STRUCTS.MintConfig.fields`.
- `fixedLength()` derives length from the same list.
- Neither reads `MINT_CONFIG_SPACE`.

**Fault and consequence:** The assertion’s description claims a Rust allocation check it does not perform. A validator initialization test may independently catch an undersized allocation; that does not make this assertion independent evidence.

**Fix:** Test serialized Rust length and allocated account length directly, including padding, or rename this assertion to its actual property: JavaScript encoder length agrees with the JavaScript layout.

The same limitation applies to the arithmetic test labeled “equals the Rust formula”: it compares JavaScript against another expression of the formula, not against execution of Rust.

---

### Floors

I do not find a basis to claim that simply deleting one of the counted JavaScript assertions leaves the shown equality floors satisfied. They require exact counts.

However, **a fixed count does not prove retained coverage**: R6-1 and R6-2 demonstrate unchanged counts with missing integration behavior or non-independent evidence. Count gates must not be represented as coverage gates.

# The four questions about accepted limits

## 1. Is any limit worse than stated?

### Item 7: “Survivable rather than silent” remains incomplete

R2-1 and R2-2 provide concrete quiet-stall paths despite the heartbeat repair:

- A completed pass omits work through `plan.problems` without paging.
- An unreadable crontab disables the watchdog and resets its grace history.

### Item 10: The detection component of the loss bound is weaker than represented

R5-1 and R5-2 allow successful sweeps without actual returns to evade the claimed reconciliation controls when the ledger is manipulated.

This does **not** remove the cap or cooldown. It removes the assumed prompt to use the guardian. Consequently, the number of loss windows is not bounded by the alarm cadence in these cases.

R5-3 also contradicts the operational description of the 0.02 SOL float.

### Item 25: The new fee gate creates additional reroll opportunities

R1-1 can refuse every capture despite sufficient funds to preserve the draws. This is distinct from the already accepted serial throughput problem.

### Item 55: 200 $GARY is not a universal minimum cost

The stated two-burn sequence costs 200 $GARY. A requester can instead:

1. Request activation before the monthly deadline.
2. At the deadline, run `distribute(false)`.
3. Join.
4. Split the accumulated revenue.
5. Run `distribute(true)`.

The unsplit balance is then shared after **one 100-$GARY burn**, not two.

**Evidence:** Execute that sequence with at least one existing active vault and a positive available pool balance for the first distribution; verify the requester misses that distribution but shares the subsequent split revenue.

This does not change the accepted timing edge. It means its advertised cost must be conditional rather than treated as an economic floor.

## 2. Is anything listed as a limit not actually unconditional?

### Item 45: All vaults being redeemed does not necessarily end governance forever

MINT’s `mint_vault` checks the existing round, price, time, stops, round cap, and lifetime supply. It does **not** require another live vault.

If the last vault is redeemed while a previously authorized sale round remains open and has capacity, a new buyer can mint a vault. That removes the stated reason no new proposal can be created.

**Evidence:** Establish an open round with remaining capacity, redeem all existing vaults, then mint through that round. The MINT transaction should succeed.

The permanent dead end requires additional conditions: no live vault **and no remaining route to create one**. GOV’s handling of already-created executable proposals also needs examination before stating the stronger limit; its source was not supplied here.

## 3. Is any DISCHARGED item not actually discharged?

I did not establish a resurrection of a specifically discharged on-chain defect from the supplied MINT source.

That is narrower than validating the entire discharged list. Claims about SEAL/BURN/GOV behavior, packet measurements, and deployed artifacts require their missing source/tests and execution evidence.

R6-2 is an evidence-quality defect, not grounds to declare the compute or allocation measurements false.

## 4. Is anything OPEN AND BLOCKING being quietly treated as accepted?

The supplied road map now explicitly blocks launch on the holder surfaces and requires the mainnet probe to run. I do not have evidence that those items were formally demoted.

They must nevertheless remain blockers:

- **22:** Running the suite in a substituted-ID worktree is not the live crank/alarm dress rehearsal.
- **38:** Checking a JSON file does not prove the signed initialize instructions contain those values. Decode the actual transactions and read back every initialized account before locking.
- **50:** Pure coverage judgment and drafted posts are not deployed holder surfaces.
- **52:** Account derivation is not account creation or proof that an account is currently usable.
- **53:** The documented rehearsal-tree pass is for an earlier commit; it does not establish the current repaired tree’s behavior.
- **54:** The actual final holder transaction shapes need packet and compute measurements, including their compute-budget instructions.

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

## What must happen before launch that this AI review cannot establish

1. **Execute the counterexamples above and retain artifacts.**  
   Preserve input snapshots, planner output, signed transactions, confirmations, program logs, token deltas, and notification arguments. Do not close findings with revised comments or a matching assertion count.

2. **Run the production I/O, not only the pure functions.**  
   At throwaway IDs, exercise the actual crank, alarm, cron installation, locks, notifier, and revenue job. Inject:
   - Missing and malformed account responses.
   - A failed `crontab -l`.
   - A crash after every revenue transaction and before each ledger save.
   - Simultaneous reveal lanes.
   - A funded capture backlog with insufficient reveal rent.
   - Frozen split source and destinations.
   - Retirement-released liabilities immediately before a due monthly run.

3. **Prove end-to-end alert receipt from another failure domain.**  
   Stop the host, not just the Node process. Demonstrate that someone receives an actionable notification. A watchdog and notifier on the same dead machine cannot establish that. Measure time from injected incident to guardian action.

4. **Run a full-scale operational rehearsal.**  
   Use approximately 2,100 records, a sale burst, 14-vault claims, boost expiries, and RPC failure late in the scan. Record completion times, capture-window misses, RPC load, fee/rent spend, and recovery behavior. Small-state success does not establish this workload.

5. **Bind the launch record to the exact deployed artifacts.**  
   From a clean checkout, record source commit, dependency/toolchain versions, ELF hashes, deployment receipts, decoded initialize transactions, and finalized readbacks. Verify through an independent RPC. Repeat authority checks after finalization. No source-only statement proves what is deployed.

6. **Exercise the holder surfaces with real wallets.**  
   The owner must sign the actual destination-account creation and redemption flow, including three reserves, a due payout, dust, foreign holdings, pool freeze, and retry after a competing deposit. A pure preflight function cannot establish what the browser showed or what the wallet signed.

7. **Perform custody and recovery drills.**  
   Demonstrate who can access the swap and release keys, restore backups without running duplicate jobs, and operate the guardian when this host is unavailable. AI inspection cannot establish exclusive key custody, backup confidentiality, or a person’s ability to respond.

**The launch decision must rest on these observed artifacts. Neither another clean prose review nor the existing assertion totals substitute for them.**