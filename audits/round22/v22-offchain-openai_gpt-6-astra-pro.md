## Scope and verdict

**Do not launch this artifact yet.** The supplied code contains payout-liveness failures, alarm blind spots and false positives, and a swap-signing boundary that does not enforce the restrictions its comments suggest.

This is a **source review, not an executed audit**. Every reproduction below is an expected result to measure, not a claim that I ran it.

The bundle includes MINT’s Rust source, but **not SEAL, BURN, or GOV’s Rust source**, `tests/3prog.test.ts`, `HOLDER-GUIDE.md`, or the launch checker implementation. I cannot certify those files, their measured assertions, or all four programs from this bundle. References to their behavior below are identified where they depend on the supplied specification.

No CRITICAL finding is asserted.

---

# R1 — The crank

## R1-1 — MEDIUM: The plan uses accounting that its own retire instructions invalidate

**Evidence to expect:** Create a state with one active, revealed vault, bare-burn it, leave an undistributed pool balance, and make the month due. `planCrank` produces both `retireBurned` and a credit distribution. Execute that plan without any competing traffic: retirement succeeds, then distribution refuses with `NoActiveVaults` if no activation requests remain.

**Construct:** `bank/crank.mjs`, `planCrank`, especially:

```js
const w = BigInt(cfg.total_active_weight) + preJoinWeight
const avail = available(pool.amount, cfg.owed_scaled)
```

The sender retires burned vaults **before** distributing, but planning does not subtract their active weight, return their pending entitlement, or remove their activation requests from the config projection.

Consequences include:

- A distribution planned against weight that no longer exists.
- A tick planned against pending requests retirement just removed.
- An incorrect projected accumulator, affecting which claims are selected.
- False failure pages caused by the crank’s own deterministic ordering—not an RPC race.

**Gain/impact:** Wasted submissions, potentially paid failure fees, delayed delivery, and misleading incident pages. This is not a payout diversion: MINT uses its actual state.

**Fix:** Either project `retire` and `join` faithfully into a working copy of the config and records, or use staged execution with a config/pool refresh after retirements and pre-joins. Test entire plan execution, not only the arrays returned by the planner.

---

## R1-2 — MEDIUM: Anyone can deliberately disable both crank lanes by funding the fee payer

**Evidence to expect:** Fund the publicly identifiable crank payer to `250_000_001` lamports. Both live invocations refuse in `judgeFeePayer` before sending any capture, reveal, retirement, activation, or claim. The attacker needs no protocol authority.

**Construct:** `bank/crank.mjs`, `judgeFeePayer` and `main`.

The upper-balance refusal is an externally triggerable availability switch. The maximum deposit necessary is slightly over 0.25 SOL; less is needed when the payer already holds funds.

This matters particularly for capture: disabling the crank can open accepted limit 25’s reroll opportunity. The claimed traffic fallback is not unconditional:

- MINT’s `crank` returns immediately for empty remaining accounts.
- This crank sends `claim` with `crank_n = 0`.
- Its `activate` instructions carry no opportunistic capture accounts.
- Other clients are free to omit those optional accounts too.

Therefore, **a capture lapse does not require “no protocol traffic.”** It requires no successful capture of that record.

**Gain/impact:** A stranger can buy an automation outage and potentially enable rerolls during it. They do not steal the deposited SOL.

**Fix:** Bound what the signer may spend and which instructions it signs, rather than treating unsolicited incoming SOL as grounds to stop time-sensitive work. If the balance quarantine is retained, use an independently operated capture service with a different funding/failure domain. Do **not** automatically refund excess SOL to an inferred sender.

---

## R1-3 — LOW: Readiness is guessed from slots without checking the hashes the program needs

**Evidence to expect:** Use a fork/fixture where slot 1000 was skipped and A first exists at slot 1004. At current slot 1017, `readySlot(1000)` returns 1016, so the planner schedules capture and reveal. MINT instead needs B at or after 1012 and C at or after 1020 and returns `RevealTooEarly`.

**Construct:** `bank/crank.mjs`, `readySlot`, `planCrank`, and the capture/reveal send loops.

The comment calls `NotYet` harmless, but the I/O classifies a refused capture as a failure. It then tries the reveal planned on the assumption that capture succeeded, producing another refusal and stopping that reveal loop.

**Gain/impact:** Ordinary skipped slots can cause false incident pages and unnecessary submissions. No out-of-order reveal can land because MINT enforces FIFO.

**Fix:** Read SlotHashes and calculate the actual three candidate slots, or classify `RevealTooEarly` as a normal retry condition and re-evaluate reveals after captures. Do not treat “capture planned” as equivalent to “entropy obtained.”

### Dead-vault boundary

The supplied planner skips a **positively identified** burned asset. That does not establish “the crank never pays a dead vault”:

- Claims and joins accept assets classified as `other`, or absent from the map.
- Assets are read well before the eventual claim transactions.
- A bare burn between those operations reaches accepted limit 27.

This is not a new on-chain finding beyond item 27. It does mean the crank mitigation is best-effort, not an atomic guarantee. Rechecking before submission narrows the window; only an on-chain live-asset check closes it.

---

# R2 — The alarm

## R2-1 — MEDIUM: A successful normal redemption is also reported as a bare Core burn

**Evidence to expect:** Feed the detector a normalized successful redemption containing:

1. BURN’s top-level `burn_vault` for asset A.
2. Its inner Core `BurnV1` CPI for A.

`detectBurns` returns both `burn_via_program: INFO` and `bare_core_burn: CRITICAL`. `correlateBurns` leaves the latter CRITICAL.

**Construct:**

- `bank/alarm.mjs`, `normalise`: flattens top-level and inner instructions.
- `bank/detectors.mjs`, `detectBurns`: classifies every matching Core burn as bare.
- `correlateBurns`: does not reconcile `bare_core_burn`.

The normalization discards the invocation relationship needed to distinguish BURN’s own CPI from a separate bare burn.

**Gain/impact:** Routine customer exits generate CRITICALs, potentially duplicated across program signature walks. That undermines the detector intended to distinguish destructive bare burns.

**Fix:** Preserve instruction ancestry and classify BURN’s own Core burn CPI as the sanctioned path. Alternatively, reconcile the same asset’s Core burn against a verified successful `burn_vault`, while retaining a separate bare burn of another asset at full severity.

Add an integration fixture containing real `innerInstructions`; the existing tests exercise these routes separately.

---

## R2-2 — MEDIUM: Non-atomic config and pool reads can invent pool insolvency

**Evidence to expect:**

1. Alarm reads `owed_scaled = 100 * ACC_SCALE`.
2. A legitimate claim pays 100 sats and reduces both the pool and owed amount by 100.
3. Alarm reads the now-empty pool.
4. `detectPoolHealth` reports `pool_insolvent`, despite the current on-chain owed amount being zero.

**Construct:** `bank/alarm.mjs`, `readConfigs`, followed later by `readPool`; `bank/detectors.mjs`, `detectPoolHealth`.

The config read and pool read are separate confirmed RPC operations. A later read of the pool is compared against earlier accounting.

**Gain/impact:** Ordinary payouts can trigger a CRITICAL asserting that value escaped by an impossible path.

**Fix:** Fetch MINT config and its already-derived pool together in a single context-bearing account request. Revalidate a suspected insolvency against a coherent snapshot before paging. `minContextSlot` alone does not make two separate reads atomic.

---

## R2-3 — MEDIUM: With 0–47 live vaults, an untouched redemption window always pages

**Evidence to expect:** Supply a valid empty rate ring, current Unix time, and three live vaults. `redemptionCapacity` returns `{ cap: 1n, remaining: 1n }`. `detectRedemptionRate` nevertheless returns `redemptions_near_cap`.

**Construct:** `bank/detectors.mjs`, `detectRedemptionRate`:

```js
const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
if (c.remaining > near) return []
```

At cap one, the minimum threshold is also one. A completely unused window qualifies as nearly full. The same happens at zero live vaults.

**Gain/impact:** An ordinary early-launch or low-supply state pages every pass without a single redemption.

**Fix:** Require actual window consumption, and return quiet when live supply is zero. Add tests for idle and exhausted cap-one windows, not just `redemptionCapacity`’s cap calculation.

---

## R2-4 — HIGH: The liveness alarm misses stalled launch joins and a stalled reveal queue

**Evidence to expect:**

- **Launch case:** Set `total_active_weight = 0`, nonzero pending activation requests, a healthy funded pool, and a date months after the first tick was due. `detectDistributionOverdue` returns `[]`.
- **Reveal case:** Mint an unrevealed vault, stop capture/reschedule execution, and let its window expire. Repeated alarm passes produce no `reveal_rescheduled` finding because no reschedule transaction occurred.

**Construct:**

- `bank/detectors.mjs`, `detectDistributionOverdue`: unconditional `if (w === 0n) return []`.
- `bank/alarm.mjs`, `main`: no VaultRecord deadline/queue inspection.
- `detectProgramEvents`: observes executed reschedules, not missed capture deadlines.

With eligible-but-unjoined launch vaults, the only standing signal can be `joins_waiting` at INFO. For current-epoch requests, even that signal is absent.

**Gain/impact:** The automation can stop indefinitely at launch while the alarm remains non-paging. A reveal outage is reported only after some actor resumes work and reschedules. This is worse than accepted limits 7 and 36’s stated detection.

**Fix:** Add independent state-based deadlines for:

- Pending requests awaiting a due zero-weight epoch tick.
- Eligible requests not joined within an operational SLA.
- Uncaptured records approaching or beyond their window.
- Captured FIFO heads not revealed within an SLA.

The alarm must measure unfinished work, not merely logs emitted when somebody eventually does that work.

---

## R2-5 — MEDIUM: The crank suppresses the event the alarm relies on for frozen vault payouts

**Evidence to expect:** Freeze an active vault’s cbBTC account and credit it a whole-sat entitlement. Run the crank and alarm repeatedly with no other claimant:

- Crank adds it to `deferredFrozen` and sends no claim.
- No `CBOB_CLAIM_DEFERRED_FROZEN` log is emitted.
- Alarm’s per-vault balance read does not inspect the frozen state.
- No frozen-vault payout page occurs.

**Construct:**

- `bank/crank.mjs`, `planCrank` frozen-destination branch.
- `describePlan`: prints only the deferred count.
- `main`: pages only `failures`, not these deferrals.
- `bank/alarm.mjs`: frozen state is checked for the pool, not individual vault accounts.

**Gain/impact:** A holder can remain unpaid indefinitely without the advertised `claim_deferred_frozen` alarm. The entitlement survives on chain.

**Fix:** Detect frozen recorded payout accounts directly in the alarm, or send deduplicated, asset-specific alerts for the crank’s deferred list. Do not spend fees on claims merely to manufacture an event.

---

## R2-6 — MEDIUM: A missing or malformed lock deadline silently disables the immutability check

**Evidence to expect:** Start production alarm with all four authorities present and either omit `CBOB_LOCK_DEADLINE` or set it to a nonnumeric value. No `program_not_locked` finding is produced.

**Construct:**

```js
lockDeadlineSec: Number(process.env.CBOB_LOCK_DEADLINE || 0) || null
```

and `detectUpgradeAuthorityAfterLock`’s early return for a falsy deadline.

The selftest explicitly certifies silence when no deadline is configured.

**Gain/impact:** An operational configuration omission disables a launch-critical standing control while ordinary alarm passes continue.

**Fix:** Make launch/production monitoring require a valid positive deadline, preferably from the checked launch manifest. Report an invalid or absent deadline as a monitoring configuration failure, rather than interpreting it as “not due.”

---

# R3 — Layouts

## R3-1 — MEDIUM: The Rust-layout assertion ignores serializable private fields, and offset coverage is incomplete

**Evidence to expect:**

1. Insert a private field such as `hidden: u64,` into `MintConfig`, without changing its existing public fields.
2. `parseRustStruct` returns the same public-field list as before.
3. The field-for-field comparison still passes, although derived Borsh serialization includes the new field and shifts subsequent bytes.

Separately, change MINT’s `OFF_COLLECTION` constant: the supplied cross-program `want` list contains MINT’s `OFF_RESERVES`, but **not MINT’s `OFF_COLLECTION`**.

**Construct:**

- `bank/layout.mjs`, `parseRustStruct`:

  ```js
  /^pub (\w+):\s*(.+?),?$/
  ```

- `bank/selftest.mjs`, manually enumerated cross-program offset assertions.

The assertions are real for the fields and constants listed. They do not prove that every serialized field or every pinned offset is covered.

**Gain/impact:** A source change can pass this advertised synchronization gate while readers use the wrong layout. Other behavioral tests might catch it; this gate does not establish that they will.

**Fix:**

- Generate serialization fixtures or layouts from Rust/IDL rather than accepting a partial textual parse.
- If parsing remains, reject unrecognized field declarations instead of silently omitting them.
- Assert equality between the **set of discovered offset constants** and the set covered by assertions, with explicit documented exclusions.
- Add the missing MINT collection offset check.

---

## R3-2 — LOW: `encode` cannot encode the declared BurnConfig layout

**Evidence to expect:** Call `L.encode('BurnConfig', validObject)` with a 64-element `rate_ring`. It throws:

```text
no writer for [i64; 64]
```

**Construct:** `bank/layout.mjs`, `encode`. `readField` supports `[i64; 64]`; the encoder does not.

**Gain/impact:** No production decoding loss is established. The claimed all-layout round-trip/fixture facility is incomplete, and the existing tests do not exercise it.

**Fix:** Implement the array writer and round-trip every declared layout with distinguishable field values, including the complete ring.

---

# R4 — Money arithmetic

I found **no reachable payout-formula divergence** between the supplied MINT arithmetic and the supplied JavaScript functions, for valid protocol states within the intended supply/token bounds.

There are important limits to that conclusion:

- `available` deliberately clamps insolvency to zero; explicit Rust `distribute` refuses with `PoolShort`. This difference is documented, not a new bug.
- JavaScript BigInt is unbounded, while Rust checks arithmetic and performs integer casts. Equivalence is therefore conditional on valid bounded inputs, not all arbitrary integers.
- `accrual.mjs` does not implement the complete `join`, claim settlement, retirement, or epoch state machine. Its tests manually demonstrate fragments of those transitions.
- The crank’s incorrect state projection in **R1-1** is a divergence in transaction planning even though the individual formulas match.

The tests under R6 do not establish general Rust/JavaScript equivalence.

---

# R5 — The swap hop

## R5-1 — HIGH: Ordinary cbBTC mint revenue has no independent automatic split path

**Evidence to expect:**

1. Complete a paid mint, placing cbBTC in the revenue ATA.
2. Leave the revenue PDA with no sweepable SOL.
3. Run both live jobs through a due distribution period.

`revenue.mjs` returns at “nothing to sweep”; crank never calls `split_revenue`; the cbBTC remains in revenue. If the pool is empty, `distribution_overdue` also stays quiet.

The same omission occurs while the SOL sweep is stopped or in cooldown.

**Construct:**

- `bank/revenue.mjs`, `main`: stop/cooldown/zero-SOL early returns occur before step 4.
- `bank/crank.mjs`: no split action.
- `bank/alarm.mjs`: distribution availability is measured at the pool, not at the revenue ATA.

v6 moved mint prices to cbBTC, but the automatic splitter remains conditional on completing a **royalty-SOL swap**.

**Gain/impact:** Mint proceeds can remain undistributed indefinitely, withholding both the holders’ 85% and the Squads’ 15%. Permissionless manual splitting exists, but it is not the promised automatic pipeline.

**Fix:** Add an independent permissionless cbBTC split job, with destination ATA preparation, before distribution planning. It must run regardless of sweep stop, cooldown, royalty balance, or an unresolved swap cycle. Monitor aged unsplit revenue directly.

---

## R5-2 — HIGH: A substituted swap response can make the bot sign an arbitrary transfer

**Evidence to expect:** Replace the `/swap` response with a valid transaction containing a System Program transfer from the operator to an attacker, using the operator as the only signer and neither forbidden static key. The current checks accept and sign it. The later cbBTC delta check fails **after the transfer lands**.

**Construct:** `bank/revenue.mjs`, validation preceding `vtx.sign([operator])`.

The checks establish:

- One required signer.
- Absence of two keys from the static-key list.
- At most four address lookup tables.

They do not establish a swap, an input amount, an output mint, an output destination, a minimum output, or a fee ceiling.

Lookup-table contents are not inspected either. A denylist of static accounts is not a complete account restriction.

**Gain/impact:** Compromise or substitution at the transaction-producing API can drain the operator’s currently spendable funds without stealing its private key. That includes swept SOL, fee float, and operator-held tokens if included in the malicious transaction.

The MINT sweep cap still bounds withdrawals from the revenue PDA. **It does not bound all assets already held by the operator**, nor pin where an externally supplied signed transaction sends them.

**Fix:** Replace blind transaction signing with a constrained construction/validation path:

- Resolve all lookup tables.
- Bind exact input/output assets and accounts.
- Bound SOL spending, priority fees, and token authority changes.
- Use a tightly scoped supported route set or an atomic, enforced postcondition design.
- Keep operator holdings minimal and monitor them independently.

Simulation is useful but is not, by itself, an authorization boundary.

---

## R5-3 — MEDIUM: A ledger row can label a successful on-chain sweep “rejected” and silence reconciliation

**Evidence to expect:** For a real successful sweep signature S and amount A, put this in the ledger:

```json
{
  "sweepSig": "S",
  "sweptLamports": "A",
  "sendRejected": true,
  "returnedSats": "0"
}
```

Then:

- `detectUnledgeredSweeps` accepts the matching signature and amount.
- `cycleIsOpen` returns false.
- `detectUnreconciledRevenue` skips the zero return.
- `detectSplitClaims` has no claimed split to check.

The scan has witnessed success but never invalidates the contradictory `sendRejected` flag.

**Construct:** `bank/detectors.mjs`, those four functions.

**Gain/impact:** A false or corrupted row closes a genuinely missing return in the alarm. This weakens the independent detection used to bound how long accepted limit 10’s theft can continue.

**Fix:** Chain-observed successful sweeps must override—and report contradictions with—ledger rejection claims. Validate the ledger schema and lifecycle. A rejected cycle should require evidence tied to the exact attempted transaction, and must not be accepted as rejected when its sweep succeeded.

---

## R5-4 — MEDIUM: The return floor rejects swaps that satisfy both configured drift and slippage tolerances

**Evidence to expect:**

- First quote: 100,000 sats.
- Second quote: 98,000 sats, permitted by the 2% requote tolerance.
- Actual output: 97,100 sats, within the 1% execution slippage of the second quote.

The swap is valid under those two settings, but the script compares `delta` against `minOut = 98,000`, throws before return, and leaves the purchased cbBTC on the operator. Every later cycle is blocked.

**Construct:** `bank/revenue.mjs`, `minOut`, post-swap `delta < minOut`.

The requote floor is reused as the execution-output floor without allowing the slippage advertised to Jupiter.

**Gain/impact:** Ordinary market movement strands an otherwise successful swap and requires manual recovery.

**Fix:** Define separate requote and executable-output limits. If the final required floor is 98% of the first quote, enforce that floor in the swap itself. If two tolerances are intentionally cumulative, calculate and record the corresponding execution floor explicitly.

---

# R6 — Gates and assertion coverage

## R6-1 — MEDIUM: Several gates test textual presence, not the property named by the assertion

**Evidence to expect:**

- Add a signer using ordinary `Keypair.fromSeed(secret32)`. The signer inventory does not discover it because it searches only for `fromSecretKey`.
- Change Rust’s `LEVEL_WEIGHTS`; the supplied “crank and the program use the same weights” assertion still compares `AC.WEIGHTS` only against a JavaScript literal.
- Add a new `OFF_*` constant. The offset gate does not fail merely because the new constant is absent from its manually enumerated list.
- Change an enforcement function while retaining its error variant. An ON-CHAIN control-table row can still pass because the gate checks that a named variant exists, not that the stated path enforces it.

**Construct:** `bank/selftest.mjs`, signer inventory, payout arithmetic block, layout offset block, and `judgeRow`.

These are not all assertions that “cannot fail.” They are assertions that can fail for a narrower reason than their names claim. Negative string-mutation tests prove the regex detects the tested spelling; they do not prove the security property.

**Gain/impact:** Changes can invalidate advertised controls without invalidating these gates. Assertion-count equality does not repair that mismatch.

**Fix:**

- Inventory signer construction through parsed code and supported signing APIs, not one method name.
- Compare independent Rust-produced fixtures/state transitions with JavaScript results.
- Require exhaustive offset coverage.
- Treat the control-table test as a documentation-reference check, and require behavioral evidence separately.

### Runner assessment

The supplied runner’s equality checks do prevent simply deleting counted assertions while leaving its expected counts unchanged. I did not find a basis to claim otherwise.

However:

- The mainnet probe is deliberately skipped on DNS failure while the runner can still succeed. A release certification must distinguish **passed** from **not performed**.
- `run-tests.sh` invokes the launch checker’s **selftest**, not validation of the actual launch manifest.
- Passing this runner does not discharge items 22, 38, or 50.
- The direct accrual selftest has no independent count floor; the runner supplies that protection only when the runner is used.

---

# The four questions about accepted limits

## 1. Is any accepted limit worse than stated?

**Yes.**

### Limits 7 and 36 — the fallback can remain silent

R2-4 shows that stalled zero-weight launch activation and an expired reveal queue are not necessarily paged. A reschedule log is evidence of a reschedule, not an autonomous expiration alarm.

### Limit 25 — “no protocol traffic” is too strong a prerequisite

Capture accounts are optional. Protocol traffic can continue without carrying the affected record. R1-2 also identifies an external way to disable the project’s capture payer.

Correct wording: reroll exposure requires **no successful capture of that vault during its window**, not no traffic.

### Limit 26 — “ONE vault’s draw” is not a valid bound

**Evidence to expect:** Mint two or more vaults in the same slot. They receive the same reveal slot and, on the same fork, the same A/B/C hash triple. Changing C’s candidate block hash changes the derived entropy for every one of those asset addresses.

**Construct:** MINT `write_record` and `try_capture`.

The asset key domain-separates each resulting hash; it does not restrict the leader’s influence to one vault. A last-slot leader can evaluate candidate blocks against a **batch objective**, although it cannot independently select arbitrary outcomes for every vault.

**Severity: MEDIUM — accepted-limit understatement.**

**Fix:** Correct the exposure description and measure batch grinding against FIFO census depletion. This does not require changing the owner’s chosen randomness architecture to acknowledge the true bound.

### Limits 10 and 27 — distinguish the chain bound from the automation mitigation

- R5-2 does not defeat the on-chain sweep cap, but expands the practical signing trust boundary to the external transaction supplier.
- R5-3 undermines the detector relied on to prompt guardian intervention.
- Item 27’s dead-vault interval remains reachable through the crank’s stale snapshot; its mitigation is not an on-chain prohibition.

---

## 2. Is anything listed as a limit already closed, or not actually a limit?

Two statements need narrowing:

- **Item 28:** “A frozen POOL stops every claim” is literally too broad. `claim` can join pending vaults or process zero-pay records without performing a token transfer. Positive payouts from the frozen pool fail. This distinction matters for recovering launch joins.
- **The `flock -n` rationale:** In v6, a queued second permissionless claim does not inherently pay the same entitlement twice; debt is recorded on chain. A second sweep also faces the on-chain cooldown. Mutual exclusion still protects off-chain ledger integrity, but v5’s “a queued runner necessarily double-pays” rationale is no longer the correct general explanation.

Neither observation justifies removing locks.

---

## 3. Is any DISCHARGED item not actually discharged?

**Item 20’s replacement alarm is incomplete.** The original v5 poisoned-ATA allocator is gone, but the stated replacement—frozen accounts are deferred and the alarm reports them—is not achieved when the crank skips the frozen destination before an event can exist. See R2-5.

I do not overturn the measured compute-unit discharge. Its measurements establish the tested instruction shapes, not a theorem that every byte-fitting transaction, arbitrary CPI composition, or future Core version cannot exhaust compute.

The supplied code supports the closures concerning MINT duplicate attributes and fixed split wiring. The absent program sources and test artifacts prevent me from independently verifying every other discharge.

---

## 4. Is an OPEN AND BLOCKING item being quietly treated as accepted?

The supplied SPEC still labels 22, 38, and 50 blocking. I found no explicit reclassification to ACCEPTED.

**But the test runner is not a release interlock for them.** It can pass while:

- No live crank rehearsal has occurred.
- Actual launch values remain OPEN.
- The redemption page and posting sender remain absent.

Require a separate launch gate that refuses signing or finalization without artifact-bound evidence for each blocking item. A successful checker selftest is not validation of the manifest that will actually be signed.

---

# Other findings

## O-1 — MEDIUM: The generation-numbered process lock still has a release/reacquire race

**Evidence to expect:** The existing `_beforeSteal` seam can demonstrate this synchronously:

1. Plant stale generation 0.
2. A evaluates it and enters `_beforeSteal`.
3. Inside that seam, B acquires generation 1 and removes generation 0.
4. B releases generation 1.
5. C acquires the now-empty lock as generation 0 and remains active.
6. Return to A: A creates generation 1 successfully and deletes generation 0.
7. **A and C both hold successful lock results.**

**Construct:** `bank/lock.mjs`, `acquireLock` between its confirming read and `place(G + 1)`, plus generation reset to zero when the directory contains no records.

A successful `link` proves that one pathname was absent. It does not prove that the lock history A evaluated is still current after release and reuse.

**Gain/impact:** Concurrent direct invocations can overwrite each other’s ledgers. The cron’s OS `flock` may prevent this interleaving between correctly wrapped cron invocations, but `withLock` is not independently exclusive.

**Fix:** Use a kernel-held lock for every invocation, including manual runs. Do not add another local reread and claim the race closed. Preserve this exact release/reacquire interleaving as a regression test.

---

## O-2 — LOW: Redemption posts understate proceeds when the transaction claims before sweeping

**Evidence to expect:** Begin a redemption with 21,000 sats in the vault. In that same transaction, claim 1,000 sats, then sweep 22,000 and close the account. `releasedFrom` reports only 21,000 sats because it compares transaction pre/post balances.

**Construct:** `bank/redemption-poster.mjs`, `releasedFrom`.

Net balance decrease is not gross value released when the transaction first credits the vault. The future post also infers “to its holder” from a source-account decrease without examining the recipient.

**Gain/impact:** The promised public accounting can publish an incorrect redemption amount and an unverified destination description.

**Fix:** Derive gross outgoing transfers and destinations from the execution trace, including in-transaction claims. Describe proceeds as going to the owner-selected destination unless the destination is actually verified as the holder’s.

This is separate from accepted/open item 50’s missing sender.

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

A read-only AI report cannot establish what the deployed artifact does, what the production services actually execute, or whether somebody receives and acts on a page. Those require experiments and operational commitments.

Before removing any upgrade authority:

1. **Execute each finding’s reproducer.** Preserve commit, dependency lockfiles, commands, transaction signatures, logs, before/after account bytes, and observed result. Refuted findings need equally explicit evidence.

2. **Run the actual jobs against a controlled validator, not just their pure helpers.** Make RPC, program IDs, key paths, and notification sinks injectable. Execute:
   - Bare burns immediately before retirement and claim.
   - Full and reveal lanes concurrently.
   - Skipped entropy slots.
   - Claims between alarm reads.
   - Frozen destinations the crank skips.
   - Zero-weight pending launch queues.
   - cbBTC revenue with zero royalty SOL.
   - RPC failure partway through 2,100 records.

3. **Perform the live dress rehearsal as an operational exercise.** Use throwaway deployments and bounded funds. Measure total pass duration, capture latency, fee/rent consumption, RPC quotas, restart behavior, and remaining unpaid entitlements—not merely successful transaction counts.

4. **Test alert delivery end to end.** Trigger real conditions and verify receipt on the actual channel. Test one-shot alerts, router buffering, multiple findings, delivery failure, process death, and a live-but-wedged job. Have the designated operator perform the recovery procedure.

5. **Build an independent accounting oracle.** Replay randomized request/tick/join/distribute/claim/retire sequences against the deployed Rust artifact. Compare all state and token deltas after every step. Include duplicate accounts, frozen accounts, zero amounts, and adversarial ordering.

6. **Perform the final artifact and initialization ceremony from a machine-readable checklist.** Validate the actual manifest, serialize the exact instructions to be signed, read back every initialized value, verify deployed program bytes, and then verify removal of all four authorities through independent RPC reads.

7. **Prove the holder’s exit using the real client before inviting deposits.** Exercise destination preparation, coverage warnings, claim-before-sweep, pending joins, frozen-pool behavior, and three-token redemption. Confirm the displayed amount and destination match execution.

**None of these requires a human audit firm. They require somebody to run adversarial experiments, retain the evidence, and refuse launch when the evidence is missing.**