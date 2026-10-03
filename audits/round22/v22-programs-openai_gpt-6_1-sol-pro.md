# v6 audit report

**Disposition: do not launch or remove upgrade authorities yet.** The supplied code does not establish several properties claimed by the documents and tests.

This is a **source review, not an executed certification**. I did not run the validator, reproduce the reported counts, or inspect deployed artifacts. The off-chain implementation files—including `bank/crank.mjs`, `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/layout.mjs`, and the launch checker—were not supplied. Their behavior cannot be independently certified from their descriptions or assertion counts.

No CRITICAL theft finding is justified by the supplied evidence. The findings below distinguish executable counterexamples from documentation and test deficiencies.

---

## R1. Custody

### MEDIUM — Repeated SOL deposits can defeat successive redemption attempts, not merely require one extra sweep

**Construct:** `programs/cbob-vault-burn/src/lib.rs::burn_vault`, the `asset_signer.lamports() == 0` requirement; redemption clients in both supplied TypeScript files encode a fixed lamport transfer amount.

**Evidence that would exist if correct**

1. Fund a vault’s asset-signer PDA with a rent-valid SOL balance.
2. Build a redemption sweeping that balance.
3. Before the redemption executes, send additional lamports to the PDA.
4. The redemption reaches BURN and fails `VaultNotEmpty`; the owner’s sweep and thaw revert.
5. Repeat against the rebuilt redemption. Each successful intervening deposit again causes failure.

Account for rent rules when constructing the initial deposit; do not assume an absent account can be funded with one lamport.

**Impact**

The existing “one extra instruction” description understates the operational hazard. A bot watching redemption submissions can repeatedly invalidate the amount being swept. Its deposits remain in the vault after failed redemptions, while the holder pays transaction fees and retries.

This is conditional transaction-ordering grief, **not proof that the attacker can permanently prevent every possible submission**. It nevertheless matters for the promised redemption surface.

**Fix**

Make the SOL-sweep leg read and transfer the PDA’s **execution-time balance**, through a narrowly scoped helper called by Core Execute with the PDA signing. Measure the complete three-reserve redemption with this helper.

Do **not** remove the zero-lamport check or assume Core Burn sweeps the PDA.

### Pairing assessment

I did not identify a source-supported way to end a successful transaction with a thawed, surviving vault. The forward and backward scans bind asset and owner, and MINT’s retirement requires the top-level BURN instruction at the expected CPI depth.

That is not an executed wrapper test. The supplied suite does not exercise actual malicious CPI wrappers.

---

## R2. Community pool

### MEDIUM — The literal “no revenue from before joining” invariant is false at zero-weight bootstrap

**Construct:** MINT `distribute`, `monthly_inline`, `tick`, and `join`.

**Evidence that would exist if correct**

Use the following sequence:

1. No vault is joined: `total_active_weight == 0`.
2. Deposit revenue into the pool.
3. Request activation for one funded, revealed vault.
4. Once monthly distribution is due, run the zero-weight epoch tick.
5. Join the requester.
6. Burn 100 $GARY to distribute.
7. Claim.

The requester receives the pool’s historical backlog, although that revenue arrived before it joined. With one joined vault, its whole-sat payout is effectively the backlog, subject to accumulator rounding.

The Test Vault simulation already follows substantially this shape: sales fund the pool before the Test Vault joins, and its subsequent burn distribution pays that revenue to it.

**Impact**

Two-step activation prevents the specific `activate → distribute` immediate-backlog attack while existing members are active. It does **not** establish the stronger invariant requested in this audit.

At bootstrap—or after all active members leave—the free tick does not allocate or segregate historical revenue. It merely permits subsequent entrants to divide it. If only one requester exists, the month’s delay does not stop that requester taking the backlog.

**Fix**

Resolve the specification before changing accounting:

- If bootstrap backlog is deliberately assigned to the first post-tick cohort, state that exception explicitly and remove the universal invariant.
- If the universal invariant is required, historical revenue must be segregated from revenue eligible for new entrants. A distribution-epoch delay alone cannot identify revenue arrival time.

Add the exact sequence above as an assertion with an explicit expected economic outcome.

### Pool-solvency invariant: source argument, not a suite-wide proof

For the supplied accounting transitions, let `S = ACC_SCALE`, `O = owed_scaled`, and `B = pool balance`.

- Credit chooses `A = B − ceil(O/S)` and adds at most `A × S` to `O`.
- Paying `p` whole sats reduces both `B` and `O/S` by exactly `p`.
- Joining adds weight with debt equal to that weight times the current accumulator, adding no liability.
- Retirement subtracts the retiring record’s outstanding liability.

These transitions preserve `B ≥ ceil(O/S)` **provided the recorded aggregate liabilities match the records and the pool has no independent withdrawal path**.

The supplied P.32 checks only one endpoint. It does not prove this invariant across arbitrary instruction orderings.

---

## R3. Level draw

### MEDIUM — Accepted limit 26 understates the last leader’s choices and the number of affected vaults

**Construct:** MINT `try_capture` and `blockhash_in_window`.

**Evidence that would exist if correct**

Construct a SlotHashes fixture where C’s target begins early in a four-slot leader group:

- If that slot is skipped, the next produced slot in the **same group** becomes C.
- If it too is skipped, a later slot in that same group becomes C.
- All candidates remain within `MAX_SKIPPED_SLOTS`.

Also mint multiple vaults in the same slot. Their records receive the same `reveal_slot`; therefore they select the same A/B/C slot hashes, although the asset key diversifies the final digest.

A controlled multi-leader validator can demonstrate the actual behavior; a pure fixture test can demonstrate the selection arithmetic first.

**Impact**

The statement that skipping “hands C to the next leader” is false unless the skipped slot is the last slot controlled by that leader, or the leader skips the remainder of its rotation.

The residual is therefore not necessarily:

- one slot’s opportunity; or
- influence over only one vault.

A C leader may retain the opportunity over subsequent slots of its rotation and influence a batch sharing its entropy slots. FIFO does not remove that influence.

**Fix**

Correct the accepted-limit bound and test skipped slots within a leader group. If retaining this scheme, assess the residual as **multi-slot, potentially multi-vault last-contributor influence**, including validators holding multiple scheduled groups.

A different entropy mechanism is necessary if that broader residual is unacceptable.

### LOW — Reroll suppression does not require absence of protocol traffic

**Construct:** MINT `crank`; optional remaining-account crank lists in `mint_vault`, `claim_charter_vault`, `activate`, and `claim`.

**Evidence that would exist if correct**

While the independent reveal crank is stopped:

1. Continue sending successful host instructions with empty crank lists, or lists omitting a selected pending vault.
2. Let that vault’s capture window expire.
3. Reschedule it successfully.

Protocol traffic occurred throughout, but the selected record was never captured.

**Impact**

Accepted limit 25’s fundamental condition—**nobody captures the selected vault**—is accurate. Its additional claim that a lapse requires “no protocol traffic” is not.

Ordinary traffic helps only when its transaction builder supplies the relevant queued records. An adversarial client can deliberately omit them.

**Fix**

Replace “no protocol traffic” with “no successful capture of this record.” Test omission during continuing traffic. Do not describe opportunistic cranking as an unavoidable consequence of a host instruction.

---

## R4. Governance

I did not find a demonstrated threshold bypass in the supplied GOV code. However, the claimed threshold behavior lacks a meaningful negative integration test; see R8.

The electorate is fixed by mint index and the divisor is snapshotted. Consequently, “half of ALL live vaults” means **half of the snapshotted live supply**, not half of the supply existing when execution or application occurs. The detailed SPEC explains this; abbreviated holder-facing statements should retain that qualification.

---

## R5. Charter claim

The address-based Merkle proof and owner check do not provide a source-supported third-party claim theft path.

The hot collection authority’s rejecting-hook power is already accepted. However, “a benign or approving hook cannot brick the claim” is broader than the tested mitigation: the program supports **at most eight extra accounts**, and the packet tests exercise one Oracle account. Passing one working Oracle is not evidence that every benign external-plugin configuration fits those bounds.

This is a qualification to limit 46, not a new claim that its tested Oracle path fails. Document the supported account and packet budget rather than promising compatibility with arbitrary approving hooks.

---

## R6. Configuration, trusted hop, royalty and redemption cap

### MEDIUM — Unretired bare burns inflate the redemption denominator, making the actual-live cap looser than stated

**Construct:** BURN `read_mint_supply` and `burn_vault`; MINT `retire_burned`.

**Evidence that would exist if correct**

1. Mint enough vaults to produce a substantial redemption cap.
2. Bare-burn many through Core.
3. Do not retire their MINT records.
4. Compare:
   - actual surviving Core assets;
   - BURN’s computed `live`;
   - accepted redemptions in one rolling window.

For example, after minting 2,100 and bare-burning 2,000 without retirement, only 100 assets survive, but BURN initially calculates `live = 2,100`, rather than 100. Its cap starts at 45 rather than 3 and decreases according to counted redemptions, not according to the already-destroyed assets.

**Impact**

GOV’s documentation correctly observes that unretired bare burns make a proposal harder to pass. **The same accounting lag has the opposite security effect in BURN:** it increases permitted redemptions relative to actual surviving supply.

A holder—or thief controlling many custodial keys—can destroy low-value or empty vaults and preserve an inflated unlocking budget for more valuable survivors until retirement catches up.

This does not bypass the timestamp ring. It bypasses the claimed meaning of its denominator.

**Fix**

Use an independently verified actual-live count. The canonical Core collection account is already supplied to BURN, and Core maintains `current_size`; investigate using that count, with real-Core tests covering both redemption burns and bare burns.

Until measured, do not substitute a guessed Core offset. Alternatively, explicitly specify the weaker cap over **accounted-live** supply and assess whether that satisfies the ruling.

### LOW — SEAL validates token-program ownership, not that reserves are initialized mint accounts

**Construct:** SEAL `assert_classic_spl`; MINT `initialize`.

**Evidence that would exist if correct**

Pass an ordinary classic-SPL **token account address** as a reserve entry. SEAL checks only its account owner, so initialization accepts it.

Use that address as `payment_mint`, include it in the reserve vector, and initialize MINT. MINT has no payment-mint account to inspect during initialization, so reserve membership passes. A later paid mint fails the 82-byte mint check.

**Impact**

A wrong-but-accepted account type can permanently disable paid minting. This is a specific validation omission within the already-blocking launch-configuration risk, not a new report that arbitrary wrong launch values are dangerous.

**Fix**

Validate reserve accounts using classic SPL Mint deserialization, including initialized state. Validate the payment mint at initialization as well. Reject duplicate reserve entries and test both malformed and wrong-type accounts.

### Trusted hop and royalties

The supplied sweep code bounds outgoing SOL by the configured cap, cooldown and reserve; operator rotation does not reset `last_sweep_at`. It provides no bound on total loss over an unlimited period without intervention, as already accepted.

The royalty plugin is installed with authority None, and these programs expose no later royalty-writing instruction. However, **fixed royalty metadata is not proof that every resale pays royalties**. `RuleSet::None` and a successful plugin immutability test do not establish universal marketplace or private-sale payment enforcement. Qualify HOLDER-GUIDE’s “every resale royalty” wording accordingly; do not imply that every asset transfer necessarily generates income.

---

## R7. Cross-program raw reads and account spaces

I recomputed the supplied Borsh layouts. No offset mismatch was identified.

| Account | Serialized bytes, including discriminator | Allocated bytes |
|---|---:|---:|
| SEAL Config, three reserves | 142 | 398 |
| MintConfig | 679 | 935 |
| VaultRecord | 186 | 221 |
| BurnConfig | 571 | 827 |
| GovConfig | 86 | 342 |
| Proposal, maximum allocated action encoding | 222 | 222 |
| VoteRecord | 74 | 74 |

Important recomputed boundaries:

- **SEAL:** version 8; collection 9; reserve-vector length 41; keys 45 onward; bump `45 + 32n`.
- **MINT:** governance 41; minted total 141; charter close 442; bare retirements 454; weight 462; active count 470; accumulator 478; owed 494; distribution time 510.
- **MINT appended fields:** stop times 518/526; pending operator 534; operator time 566; month 574; pending guardian 582; guardian-set flag 614; guardian time 615; notice 623; sweep bounds 631/639/647; epoch 655; pending counters 663/671.
- **VaultRecord:** asset 9; index 41; reveal slot 49; level 57; entropy 60; attribute hash 92; bump 124; active/retired 125/126; reschedules 127; ATA 129; debt 161; pending 177; request epoch 178.
- **BURN:** burned total 42; window 50; head 58; ring 59–571.

These are source computations. They do not verify that an off-chain reader or deployed binary matches this source.

---

## R8. Suite and simulation evidence

### MEDIUM — Governance threshold rejection is not exercised

**Construct:** `tests/3prog.test.ts` proposal/vote helpers and GOV arms; `sim/test-vault.ts` governance section.

**Evidence that would exist if correct**

Search the supplied tests’ actual voting calls: they cast YES votes. No integration arm creates a nonzero YES/NO tally that meets quorum and turnout but fails `ThresholdNotMet`.

Mutate GOV to remove the `yes_bps >= threshold_bps` requirement. The existing all-YES executions would still satisfy their expected outcomes.

**Impact**

The suite does not establish the 51% threshold’s rejection behavior. Quorum, turnout and key-change rejection tests do not substitute for it.

**Fix**

At production ratios, exercise:

- below-threshold rejection with quorum and turnout satisfied;
- exact-threshold acceptance;
- integer-rounding boundaries;
- a sufficiently large electorate that rounding does not collapse the test into one vote.

Require `ThresholdNotMet` for the intended negative.

### LOW — X.7’s FIFO planner assertion is vacuous in the tested state

**Construct:** `tests/3prog.test.ts`, X.7.

**Evidence that would exist if correct**

At X.7, the suite has exhausted and revealed the census. Log `plan.reveal.length`: it should be zero. JavaScript’s `[].every(...)` returns true.

A planner changed to return no reveals would pass this assertion.

**Impact**

The arm does not demonstrate live-chain FIFO planning despite its label.

**Fix**

Run it against a nonempty pending queue. Require a positive expected reveal count, the exact planned prefix, and a negative fixture that exposes omission or reordering.

### Additional evidence limitations

- **P.32:** one final solvency observation, not an invariant checked after every transition.
- **RL.7:** compares historical windows to a maximum-supply-derived cap, not each redemption’s actual denominator. It cannot establish the stronger dynamic claim.
- **S7.4:** `paid > 0 && paid <= avail` tolerates severe underpayment. For its isolated one-member setup, calculate the exact expected whole-sat payment and residual.
- **OR.5:** has no reason-pinned rejection. Add evidence that the rejecting Oracle—not another missing or malformed account—caused failure.
- The suite does not exercise skipped-slot selection, malicious CPI wrappers, ring wraparound beyond 64 successful redemptions, or the large unretired-bare-burn denominator case.
- The runner can explicitly skip the live-mainnet probe. A green runner exit therefore does not always mean the claimed live-mainnet assertions ran.

Assertion-count equality cannot detect replacing a meaningful assertion with an equally counted vacuous one.

---

# The four accepted-limit questions

## 1. Is any limit worse than stated?

Yes:

- **25:** continuing protocol traffic need not capture the selected record.
- **26:** C can remain with the same leader after a skip, and a shared entropy slot can affect multiple vaults.
- **32/41:** unretired bare burns inflate accounted-live supply and loosen the cap relative to actual surviving assets.
- **SOL grief description:** successive deposits can invalidate successive fixed-amount redemptions.
- **46:** approving-hook compatibility is bounded by extra-account and packet limits, not established universally.

## 2. Is anything listed as a limit already closed?

The supplied source does not justify removing an additional accepted item. Limit 13 ends with verified removal of MINT’s upgrade authority; that launch event has not occurred.

## 3. Is any DISCHARGED item not actually discharged?

The supplied evidence does not justify reopening the narrowly stated discharged items.

However, **12/17 must remain scoped to the measured path**. Cheap System-transfer padding does not prove that every packet-fitting mint with four captures/reschedules, maximum attributes and a due monthly run stays below its applicable compute budget. Measure that real worst-case host separately.

## 4. Is OPEN AND BLOCKING being quietly treated as accepted?

The three items remain explicitly blocking in SPEC. They are not discharged by this review:

- **22:** live crank, alarm and distribution rehearsal;
- **38:** final launch values and their actual signed transactions;
- **50:** functioning holder surfaces.

Simulation S6.11 calls a detector directly but labels it the redeem page’s check. That is **not evidence that the missing page exists or runs the complete pre-signature coverage judgment**.

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Before launch, replace inferred assurance with independently reproducible execution:

1. **Run each counterexample above against the exact frozen artifacts.** Preserve signatures, logs, account snapshots and expected failure reasons.
2. **Build a stateful randomized accounting harness.** Check solvency, aggregate record liabilities, weights and pending counters after every successful transaction and every rollback. Include duplicate claim pairs, retirement, freezes, bootstrap and zero-weight transitions.
3. **Mutation-test the certification suite.** Deliberately disable pairing, owner binding, threshold, join gate, pool destination and retirement restrictions. Certification must fail for each mutation.
4. **Exercise real adversarial runtime shapes.** Deploy a CPI-wrapper attacker; use a controlled multi-leader validator with skipped slots; wrap the timestamp ring; measure the largest crank-carrying hosts.
5. **Complete the live operational rehearsal.** Use real small amounts, the actual cron commands, stale RPC responses, interrupted batches, paging failures and recovery near vault 1,900 of 2,100. Verify delivery to the actual notification recipients.
6. **Decode the exact launch transactions independently before signing.** Verify every argument, account, program ID and destination—not merely the JSON from which the transactions supposedly came.
7. **Verify deployment and authority removal independently.** Compare deployed executable bytes with reproducible build hashes, read back every initialized account, then confirm all four upgrade authorities are absent.
8. **Test the actual holder workflow on hardware and ordinary wallets.** Coverage warnings, payout/join handling, frozen-pool redemption, prior ATA creation, transaction sizing and public posting must work through the shipped interfaces.

AI agreement cannot demonstrate these operational facts. A controlled execution can. **Do not remove the authorities while any blocking item or executable counterexample remains unresolved.**