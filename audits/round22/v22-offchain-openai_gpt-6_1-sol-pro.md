## Scope and evidentiary status

This is a **source review, not an executed audit**. I did not run the supplied tests or query a cluster. The reproductions below describe evidence to obtain; they are not claimed measurements.

The bundle includes MINT, but **not SEAL, BURN, GOV, `tests/3prog.test.ts`, `sigwalk.mjs`, the launch checker, DESIGN-v6.md, or HOLDER-GUIDE.md**. Consequently, I cannot certify all four programs, the actual 645 assertions, signature pagination, launch-check enforcement, or holder-guide correspondence. Assertions that read those absent files are visible; their inputs are not.

**The supplied code contains launch-blocking pipeline defects. No new CRITICAL is justified by this review.**

# R1. The crank

## R1-1 — HIGH: Mint-price cbBTC has no automatic route into the pool

**Construct:** `bank/crank.mjs::main` and `planCrank`; `bank/revenue.mjs::main`; MINT `mint_vault` and `split_revenue`.

**Evidence to obtain first:** With the SOL revenue balance at or below its reserve, execute a paid mint, then run both jobs live. The revenue cbBTC ATA should retain the mint payment, the pool should receive nothing, and neither job should submit `split_revenue`. Repeat after the monthly deadline.

**Fault:** Paid mints transfer cbBTC into the revenue ATA. Only `split_revenue` sends that cbBTC to the pool and Squads.

The crank never calls `split_revenue`. The revenue job calls it only after completing a SOL sweep, swap, and return. It returns without splitting when:

- there is no SOL to sweep;
- the sweep cooldown has not elapsed;
- the guardian has stopped SOL sweeping.

Thus, mint prices—which expressly do not require the trusted swap hop—depend operationally on a successful royalty-SOL cycle or an unimplemented third-party caller.

**Gain / consequence:** No theft is required. Mint income can remain undistributed indefinitely while the pool is empty and the distribution-overdue detector is quiet. A sweep stop also stops this script from splitting unrelated mint-price cbBTC.

**Fix:** Add an independent permissionless cbBTC-splitting job, preferably a crank stage before pool distribution. It must run irrespective of SOL balance, sweep cooldown, sweep stop, and open swap cycles. Test a paid-mint-only lifecycle with **zero royalty SOL**.

---

## R1-2 — MEDIUM: Frozen destinations are deliberately skipped, suppressing the event the alarm relies on

**Construct:** `bank/crank.mjs::planCrank`, `describePlan`, and `main`; `bank/alarm.mjs` balance reads; `detectors.mjs::detectProgramEvents`.

**Evidence to obtain first:** Freeze an active vault’s cbBTC ATA while it is owed at least one sat. Run the crank followed by the alarm. The crank should record `deferredFrozen` but omit the vault from claims. There should be no new `CBOB_CLAIM_DEFERRED_FROZEN` event and no corresponding alarm finding.

**Fault:** The crank avoids submitting frozen destinations. That means the program does not emit the frozen-deferral event. The alarm reads each vault’s amount, but does not inspect its frozen state; its frozen-vault alert depends on that program event.

`describePlan` prints only the number deferred. `main` does not turn `deferredFrozen` into a notification or failure.

**Gain / consequence:** A holder’s delivery can stop indefinitely without the promised frozen-claim page. The pool can remain solvent and distributions can continue, so neither pool health nor distribution lateness necessarily exposes it.

**Fix:** Have the alarm detect frozen recorded destinations directly, with the vault’s owed amount. Keep the crank’s fee-saving skip, but notify on new or persistent deferred conditions. Add an integration test using the **actual crank skip**, not only a synthetic program event.

---

## R1-3 — LOW: The planner does not apply its planned retirements or joins to its payout model

**Construct:** `bank/crank.mjs::planCrank`, the calculations of `w`, `avail`, `acc`, and the active-record claim loop.

**Evidence to obtain first:**

1. Set the only active vault to positively burned, with undistributed pool funds and a due month.
2. The plan should contain both retirement and a credit distribution.
3. After retirement lands, distribution should fail `NoActiveVaults`.

Separately, pre-join a live pending vault before a due distribution. The plan should count its weight but omit its new entitlement from this pass’s delivery list.

**Fault:** The planner adds pre-join weight but does not subtract retired active weight, release retired liabilities, or mark pre-joined records active for subsequent claim planning.

**Gain / consequence:** Predictable refused instructions, false failure pages, and an additional pass before newly joined vaults receive the distribution just credited to them.

**Fix:** Plan against a mutable projected state, applying each successful stage’s effects. For live execution, stop or refresh dependent stages when an earlier retirement or join fails.

**Boundary:** I found no single-lane reveal plan that intentionally sends a later index before the head. Failed reveal sends stop that lane. Simultaneous full and reveal lanes can nevertheless produce stale-read refusals; ordering enforcement remains on chain.

# R2. The alarm

## R2-1 — MEDIUM: Every scanned ordinary redemption can be classified as a bare Core burn

**Construct:** `bank/alarm.mjs::normalise`; `detectors.mjs::detectBurns` and `correlateBurns`.

**Evidence to obtain first:** Feed a successful real redemption transaction through the actual normalizer. It contains:

- top-level BURN `burn_vault`;
- inner Core `BurnV1` for that same asset.

The resulting findings should include both `burn_via_program: INFO` and `bare_core_burn: CRITICAL`. `correlateBurns` leaves the latter CRITICAL.

**Fault:** `normalise` flattens top-level and inner instructions without retaining their ancestry. `detectBurns` treats **every** Core `BurnV1` against a known asset as bare, including the CPI that implements normal redemption.

`REDEMPTION_NOISE` does not include `bare_core_burn`.

**Gain / consequence:** Routine customer exits page CRITICAL. This buries the genuinely bare burns the alarm exists to distinguish.

**Fix:** Preserve instruction ancestry and distinguish BURN’s Core burn CPI from a separate owner-submitted Core burn. Alternatively, correlate this finding only against the successful, same-transaction BURN invocation for the exact asset. Test a genuine normalized redemption alongside a separate bare burn in the same transaction.

---

## R2-2 — MEDIUM: Launch activation can stall indefinitely without an overdue-distribution finding

**Construct:** `detectors.mjs::detectDistributionOverdue`; MINT `tick`, `monthly_inline`, and `distribute`.

**Evidence to obtain first:** Set:

- `total_active_weight = 0`;
- `pending_this_epoch > 0`;
- the monthly deadline plus grace in the past;
- a healthy pool.

`detectDistributionOverdue` returns `[]`, even though the epoch tick needed to admit the waiting vaults is overdue.

**Fault:** The detector unconditionally returns quiet at zero active weight. In stage 3c, zero weight does **not** always mean there is no work: an overdue epoch tick is necessary to let activation requests join.

At launch, a stopped crank and no successful host traffic can leave every request waiting indefinitely. The standing `joins_waiting` finding also does not fire for requests in the current epoch.

**Gain / consequence:** The payout schedule never starts, without the liveness page cited as mitigation for accepted limit 7.

**Fix:** Detect overdue epoch advancement separately when zero weight and current-epoch requests exist. This branch must not depend on available pool funds: the tick is valid even with an empty pool.

---

## R2-3 — MEDIUM: A fully unused one-redemption window pages as “nearly full”

**Construct:** `detectors.mjs::detectRedemptionRate`.

**Evidence to obtain first:** Use one through 47 live vaults, an empty ring, and current Unix time. Capacity is one, remaining capacity is one, and the detector returns `redemptions_near_cap`.

**Fault:**
```js
const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
if (c.remaining > near) return []
```

For `cap = 1`, `near = 1`. An entirely unused window therefore satisfies the alert condition.

**Gain / consequence:** Routine low-supply operation pages every pass, including early launch and the final holders’ exits.

**Fix:** Require actual usage. Define the threshold using consumed capacity or a fractional comparison that distinguishes one remaining out of one from zero remaining out of one. Add quiet tests for small supplies.

---

## R2-4 — MEDIUM: The post-lock control silently disables itself when its deadline is absent or malformed

**Construct:** `bank/alarm.mjs::main`; `detectors.mjs::detectUpgradeAuthorityAfterLock`.

**Evidence to obtain first:** Supply an upgradeable production program, but omit `CBOB_LOCK_DEADLINE` or set it to a nonnumeric string. The standing lock detector returns no finding.

**Fault:** Missing or invalid configuration becomes `null`, and the detector deliberately returns quiet. There is no visible production configuration alarm for the disabled control. `missingWatchedKeys` also excludes program keys.

**Gain / consequence:** An accidentally unremoved upgrade authority can remain unreported indefinitely when no drift occurs.

**Fix:** Require a valid production lock deadline before arming the alarm. After launch, require all four ProgramData reads and immutable authorities, independent of an optional environment variable. Test missing configuration as a refusal, not a quiet case.

# R3. Layouts

## R3-1 — MEDIUM: The Rust comparison can silently ignore serialized fields

**Construct:** `bank/layout.mjs::parseRustStruct`; `bank/selftest.mjs`, “the layouts ARE the Rust structs”.

**Evidence to obtain first:** Insert a private serialized field into `MintConfig`, for example after `version`:
```rust
hidden: u64,
```
Leave `layout.mjs` unchanged. `parseRustStruct` ignores that line, and its equality comparison still passes even though every later serialized field moves.

A multiline field declaration provides another parser-boundary test.

**Fault:** The parser recognizes only a complete, single-line `pub field: type` declaration. Unrecognized struct contents are silently discarded rather than rejected.

The current positive and negative tests cover only declarations that fit this grammar.

**Gain / consequence:** A future struct edit can pass the advertised field-for-field gate while off-chain readers and cross-program offsets remain stale.

**Fix:** Use compiler-derived account schemas or a proper Rust parser. At minimum, fail on every noncomment/nonattribute body fragment the parser cannot consume. Test private, multiline, and same-line declarations.

---

## R3-2 — LOW: “Every cross-program offset” is a selected list, not an exhaustive comparison

**Construct:** `bank/selftest.mjs`, the `pinned` scrape and hardcoded `want` array.

**Evidence to obtain first:** Add a new `OFF_*` constant to a program without adding it to `want`. The offset assertion has no entry to compare and still passes. MINT’s existing `OFF_COLLECTION` is also absent from the MINT comparisons.

**Fault:** The scrape discovers constants, but the test does not require the discovered set to equal the tested set. The “none undefined” assertion checks only the manually selected entries.

**Gain / consequence:** A new or omitted raw cross-program read can escape the gate.

**Fix:** Require exhaustive set equality, with an explicit, justified classification for constants that are not cross-program field offsets.

# R4. Money arithmetic

**No reachable arithmetic divergence established in the supplied formulas.** The JS credit, pending whole-sat calculation, and activation debt formula correspond to the displayed Rust credit, claim, and join arithmetic.

That is narrower than the claimed proof:

- JS BigInt does not reproduce Rust integer overflow or narrowing behavior outside valid state ranges.
- The arithmetic tests compare JS against another expression of the same JS formula, not against executed Rust.
- Retirement is not implemented as an exported JS operation; its selftest manually subtracts the pending amount.

The integration divergence affecting this arithmetic is **R1-3**, where the crank evaluates correct formulas against the wrong projected state.

# R5. The swap hop

## R5-1 — HIGH: A successful sweep can be ledgered as rejected and every reconciliation detector accepts it

**Construct:** `detectors.mjs::cycleIsOpen`, `detectUnreconciledRevenue`, `detectUnledgeredSweeps`, `detectDeferredSweeps`, and `detectSplitClaims`.

**Evidence to obtain first:** For an actual successful sweep of amount `X`, write:
```json
{
  "cycles": [{
    "startedAt": "an old valid timestamp",
    "sweepSig": "the actual successful signature",
    "sweptLamports": "X",
    "sendRejected": true,
    "returnedSats": "0"
  }]
}
```

Expected results:

- `cycleIsOpen` returns false;
- unreconciled-revenue detection returns no finding;
- sweep detection accepts the matching signature and amount;
- split verification asks nothing because no split is claimed.

This is reproducible entirely through the supplied pure functions.

**Fault:** `sendRejected` is trusted unconditionally, even when successful on-chain sweep evidence contradicts it.

**Gain / consequence:** A compromised operator host can keep swept SOL and make the only watcher read the cycle as closed. This is not merely the accepted ability to steal within the sweep rate: it removes the detection relied upon to get the guardian to stop subsequent sweeps.

**Fix:** Derive rejection from chain status and bind it to the exact signed transaction. A successful observed sweep must override—or reject—`sendRejected`. Validate ledger schema and contradictory fields. Keep chain-derived sweep obligations in alarm-owned state until chain-derived return/split evidence resolves them.

**Related boundary:** Split verification still checks signature existence rather than returned value. A matching split transaction does not establish that the cycle’s claimed cbBTC return occurred.

---

## R5-2 — HIGH: The Jupiter transaction guard accepts a plain theft transaction

**Construct:** `bank/revenue.mjs::main`, the block immediately before `vtx.sign([operator])`.

**Evidence to obtain first:** Substitute a valid versioned transaction containing a System Program transfer from the operator to an unrelated wallet. Give it exactly one required signer—the operator—no forbidden keys, and no lookup tables. It passes every displayed guard and can be signed and submitted.

**Fault:** The validator checks signer count, two forbidden static keys, and lookup-table count. It does not establish:

- that a swap occurs;
- the permitted input debit;
- the output mint and destination;
- the minimum output;
- absence of other SOL or token transfers.

The subsequent delta check happens **after** the substituted transaction executes.

**Gain / consequence:** A compromised swap endpoint or response can steal the current cycle’s SOL and any other wallet holdings before the script notices missing output. This is an additional trusted signer boundary, not a destination pinned by MINT.

**Fix:** Decode the transaction with resolved lookup-table accounts, enforce a narrowly supported transaction policy, and verify debit/output constraints before signing. Keep the operator wallet exposure bounded independently. Reject transactions that cannot be fully validated.

**Worst-case bound:** For royalty SOL swept from the PDA, the accepted bound remains:
```text
min(available revenue, cap × successful cooldown opportunities before stopping)
```
But the wallet transaction can also drain preexisting operator SOL, fee funding, and accessible token holdings. Those are not bounded by the sweep cap.

# R6. Gates

## R6-1 — MEDIUM: Several source-text assertions prove presence, not enforcement

**Construct:** `bank/selftest.mjs`, failed-transaction guard, detector wiring, signer-set, and crank instruction assertions.

**Evidence to obtain first:**

- Move `if (s.err) continue` after `normalise(tx)`. The regex assertion still passes.
- Put a detector call in unreachable code. Its wiring assertion still passes.
- Construct a signer using `Keypair.fromSeed`; the `fromSecretKey`-only signer discovery does not find it.
- Add another instruction-construction path without using `d('name')`; the crank instruction-name scrape does not enumerate it.

**Fault:** The negative tests remove the exact text being searched. They do not test the behavioral property described by the assertion’s name.

**Gain / consequence:** A gate can remain green after the property it claims to pin has been removed. This is especially consequential where failed-transaction exclusion supports burn correlation.

**Fix:** Exercise the actual reader/sender functions using injected RPC, signer, and notification dependencies. Add mutation tests that reorder guards, make calls unreachable, change constructors, and alter transaction destinations. Use syntax-aware checks only as supplementary controls.

**Floors:** The displayed equality floors do prevent simply deleting assertions and leaving counts unchanged. I did not establish a deletion-only bypass of those numerical checks. They do **not** establish that 458 assertions cover 458 independent properties.

# The four questions about accepted limits

## 1. Is any limit worse than stated?

**Yes.**

- **7 / 36:** The claimed overdue-distribution mitigation misses the zero-weight activation/tick stall: R2-2.
- **10:** Reconciliation can accept a successful sweep as rejected, so detection does not necessarily bound the time until a guardian response: R5-1.
- **25:** “Crank outage AND no protocol traffic” is too strong. The opportunistic crank accounts are optional. `mint_vault` and other hosts can succeed without supplying the affected record; the supplied crank itself sends claims with `crank_n = 0`. Traffic is not evidence that this vault was captured.  
  **Evidence:** Run successful host transactions throughout a capture window with no crank accounts, then reschedule the uncaptured record.
- **26:** “Bias ONE vault’s draw” is too narrow. Multiple vaults minted in the same slot share a reveal slot and therefore the selected hash triple. Their asset addresses differ, but the same C hash influences every draw in that cohort.  
  **Evidence:** Mint multiple vaults in one slot and replay their draws against candidate C hashes in FIFO order. Record how many outcomes change.
- **28 / discharged 20’s replacement control:** Frozen-vault paging is not assured when the crank skips the transaction that would emit the event: R1-2.

## 2. Is anything listed as a limit not actually a limit?

No accepted item is established as wholly closed by this review.

One documentation statement is already false in the opposite direction: SPEC says no selftest asserts census denominators 732 and 6,405. `accrual.mjs::selftest` explicitly asserts both. Correct that statement; it is not a security finding.

## 3. Is any DISCHARGED item not actually discharged?

I did not establish a reopened on-chain defect among the discharged items visible here.

However, their **measurement claims cannot be independently confirmed from this bundle**, because the executed on-chain suite and three program sources are absent. The compute measurement is evidence about its measured transaction path, not a universal proof that every fitting transaction path stays below compute limits.

## 4. Is OPEN AND BLOCKING being quietly treated as accepted?

Items **22, 38, and 50 remain explicitly blocking in SPEC**. I found no visible demotion.

The displayed runner does not itself execute the real launch-parameter check against the completed launch file, build the holder surfaces, or conduct the live rehearsal. A green runner therefore cannot discharge these blockers.

Also, the live-mainnet probe can be skipped on DNS failure. That may be acceptable for development, but **not for launch certification**.

# Anything else

## A-1 — HIGH: The deferred level-up ruling cannot be added after immutability

**Construct:** SPEC, “Distribution: THE SCHEDULE OF VAULTS”; MINT `reveal_level`, `VaultRecord.level`, and the MINT instruction surface.

**Evidence to obtain first:** Enumerate deployed MINT instructions and show an instruction that can increase a revealed record’s level, settle entitlement, and adjust active weight. None exists in the supplied source. Confirm that an external program cannot write the MINT-owned record or sign MINT’s attribute-authority PDA.

**Fault:** SPEC says raising a level by burning `$CBOB` is part of the ruling but “not built,” and discusses requirements “when it is.” Once MINT is immutable, that implementation cannot be appended. Core attributes are also controlled by MINT’s PDA.

**Gain / consequence:** The project can permanently make a documented future capability impossible while presenting it as deferred implementation.

**Fix:** Resolve this before locking: either implement and test it before the freeze, or explicitly obtain a ruling removing it from the immutable product and all holder promises. Do not describe it as a later feature.

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Before launch, the project must obtain **execution evidence that a source-reading AI cannot supply**:

1. **Run the actual off-chain entry points against deployed rehearsal programs.** Not only pure planners. Cover paid-mint-only revenue, frozen destinations, normal redemption normalization, zero-weight epoch ticks, pre-joins, and retirement-before-distribution.

2. **Perform destructive fault injection.** Kill revenue after each send and before each ledger save; simulate confirmation timeouts, RPC nulls, notification failure, corrupted ledger shapes, and contradictory rejection flags. Demonstrate recovery without duplicate obligations or false closure.

3. **Run production-scale automation.** Use approximately 2,100 records, concurrent reveal/full lanes, rate-limited RPC, and a fetch failure late in the account list. Measure capture completion before deadlines, fees, rent expenditure, claim packet size, and actual notifications.

4. **Exercise real holder clients with independent wallets.** Complete three-asset redemption, prior ATA creation, payout-before-sweep, frozen-pool forfeiture, foreign token warnings, nested assets, and marketplace ownership changes. Have an operator follow the incident instructions without editing code.

5. **Validate certification gates by mutation.** Keep the assertion count constant while breaking behavior. The build must reject reordered guards, silent serialized fields, omitted splitting, fake rejected sweeps, and ordinary-redemption false CRITICALs.

6. **Use an independently operated observer.** Put chain-derived sweep obligations and alert delivery outside the swap-key host’s write authority. Test that compromising or erasing its local ledger cannot produce a quiet report.

7. **Create a final signed launch evidence package.** Include the frozen commit, complete file inventory, reproducible production-build hashes, decoded initialization transactions, final account reads, completed blocker evidence, and finalized ProgramData reads showing all four authorities removed.

**Do not remove upgrade authorities on the strength of assertion counts or two agreeing source reviews. Remove them only after these concrete failure cases have been exercised against the exact artifacts and operational paths that will hold value.**