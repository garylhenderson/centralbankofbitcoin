# Round 33 Independent Audit — CBOB Vaults v6

## R0. Round 32 Verdict Verification

I independently verified round 32's two confirmed findings and their repairs against the current tree.

**L1 (coverage gate bundle parser fails open):** The repair in `scripts/audit-coverage.sh` `bundles()` is correctly implemented. The function now: (1) recognizes the `FOCUS === 'programs' ? [...] : [...]` ternary via regex, (2) splits on `]\s*:\s*\[`, (3) raises `SystemExit` if the split cannot be found, and (4) raises `SystemExit` if `FOCUS` appears in the header in an unrecognised form. The selftest covers three split-format variants and two fail-closed cases. I traced the regex against the actual `audit32.ts`/`audit33.ts` TARGETS structure and confirmed correct parsing. **Repair holds.**

**D1 (DESIGN-v6.md false statements):** All three sentences are corrected in the current DESIGN-v6.md: mint index is described as recorded "in its MINT `VaultRecord`", the claim-before-burn language correctly describes the `ClaimBeforeBurn` owed-share check and forfeit, and the stop fields are named `sales_stopped`/`sweep_stopped`. **Repair holds.**

I confirmed round 32's refutations (W1–W6) by reading the relevant source. W1 (stockpiled restarts) is correctly refuted: `restart` clears the flag but preserves `sweep_stopped_at`, and the guardian's re-stop re-stamps it, so `StopIsNewer` blocks pre-stop proposals. W2 (Ember's close-account mechanism) is contradicted by SR.12a/SR.12b. **No round-32 finding was wrongly disposed.**

## R1. Custody

I attacked the pairing, emptiness proof, and thaw-escape paths.

**Pairing.** Both SEAL's `open_for_redemption` and BURN's `burn_vault` bind asset AND owner via account indices 0 and 2, matching the `BurnVault`/`OpenForRedemption` struct layouts. Both walk only top-level instructions (`load_instruction_at_checked`), so CPI-wrapped instructions cannot satisfy either half. `retire_redeemed` enforces `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1` and re-reads the calling top-level instruction from the instructions sysvar, binding the asset. I confirmed the discriminator constants match the Anchor derivations (the suite asserts this at 3.1a–3.1s). Two-vault transactions cannot cross-pair because both halves bind the specific asset and owner. **No pairing bypass found.**

**Emptiness proof.** The reserve loop derives both classic and Token-2022 ATAs per reserve mint, requires declaration, checks PDA ownership, refuses delegates (`d[72..76]`, `d[121..129]`, `d[129..133]`), refuses extensions (`d.len() == 165`), and refuses non-zero balance. The second loop catches declared non-reserve token accounts owned by the PDA and declared Core assets. Token-2022 accounts with extensions are refused in both loops. A thawed vault cannot leave the transaction unburned because any burn failure reverts the entire transaction including the thaw. **No emptiness-proof bypass found.** The completeness gap (undeclared accounts) remains as accepted limit 44.

## R1s. Sweep Helper

**(a) Access control.** The helper requires `signer.is_signer`. Direct calls cannot sign for the asset-signer PDA. Through Core `ExecuteV1`, only the asset owner can invoke, and Core refuses Execute while the PermanentFreezeExecute plugin is frozen. So the helper is reachable only by the owner during a genuine redemption. Confirmed by SR.1, SR.5, SR.5a, SR.5c, SR.5d. **Sound.**

**(b) Pair list.** Duplicate source: the first iteration closes it; the second `read_token` fails because the closed account is no longer Token-owned (SR.12a/SR.12b confirm). Source-as-destination is impossible because `signer.key != dest.key` is enforced and an account cannot be owned by both. Frozen source reverts the transfer (SR.14). Non-ATA destinations are accepted if they are valid token accounts of the correct mint and owner, which is correct. Destination-as-another-vault's-PDA is the owner's own choice and harmless. Zero pairs produces a lamports-only sweep (SR.13). **No pair-list exploit found.**

**(c) Destination checks.** The destination is chosen by the owner (the only party who can invoke the helper). Not comparing it to the asset owner is safe because the owner is the caller. Lamport transfer to a below-rent nonexistent account would fail, but the canonical destination (the fee-paying owner) always exists. **Safe.**

**(d) Lamport sweep.** `signer.lamports()` is read at execution and fully transferred. No instruction runs between the helper and the burn within the atomic transaction, and Core `BurnV1` does not credit the asset-signer PDA. BURN's `lamports() == 0` check sees exactly what the sweep left. **Sound.**

**(e) BURN interaction.** Closed reserve accounts are skipped by BURN's owner check (system-owned after close). A missing reserve ATA that the page failed to create causes `ReserveNotDeclared`, failing closed. A stranger cannot create a Token-2022 ATA for a classic mint (probe confirms refusal). Non-ATA token accounts and nested Core assets fall under the accepted completeness gap. **Consistent with SPEC.**

**(f) Fit.** S8.0 measures 1,061 bytes for the three-asset helper redemption; with compute-budget (+52) and separate payer (+96) this is ~1,209 of 1,232. The reserve cap is 3, so no fourth reserve exists. **Fits.**

**(g) Evidence.** SR.0–SR.4a and S8.* are present and use `because` reason-pinning. `build-mainnet.sh` `cmp`s the helper's mainnet bytes against both the localnet rebuild and `target/deploy`. **The tested helper is the shipped helper.**

## R2. Community Pool

I traced the accumulator invariant `pool_balance >= ceil(owed_scaled / ACC_SCALE)`.

`distribute` computes `avail = balance - ceil(owed)`, then `credit` adds `delta = floor(avail * ACC_SCALE / weight)` to `acc_scaled` and `delta * weight` to `owed_scaled`. Since `delta * weight <= avail * ACC_SCALE`, the new `ceil(owed)` does not exceed the balance. `claim` pays `floor(pending / ACC_SCALE)` and subtracts `pay * ACC_SCALE` from `owed_scaled`, preserving the invariant. The sub-sat carry stays owed and in the pool. **Invariant holds.**

**Counters.** I traced `pending_count` and `pending_this_epoch` under request, join, retire-while-pending, and epoch-advance orderings. `pending_this_epoch` is incremented on request, reset to 0 on `advance_epoch`, and decremented on retire only when `request_epoch == dist_epoch`. No underflow path exists. `waiting_to_join = pending_count - pending_this_epoch` correctly identifies eligible-but-unjoined vaults. **Counters are consistent.**

**Liveness.** `JoinWaitingFirst` and `BoostsExpireFirst` are both cleared by free, permissionless actions (join via `activate`/`claim`, expire via `expire_boosts`/`claim`). No actor can permanently block distributions or redemptions for others. A vault with a missing destination blocks only its own batch, not the system. **No liveness DoS found.**

## R2b. $CBOB Boost

I traced the boost lifecycle. A boost bought at epoch E with N distributions sets `boost_end_epoch = E + N`. It earns distributions advancing E→E+1 through E+N-1→E+N, which is exactly N. At `advance_epoch` to E+N, the ring slot is moved to `boosts_due`, and `BoostsExpireFirst` blocks further distributions until expiry. **A boost earns exactly N distributions.**

`reweigh` preserves the owed share by moving it to `carry_scaled` and resetting `debt_scaled` to `new_weight * acc`. I verified `owed = weight * acc - debt + carry` is invariant across boost, expiry, claim normalisation, and retire. The ring of 64 cannot collide for two simultaneously-live boosts because the maximum boost length is 63 and a due boost must be expired before the epoch advances far enough to reuse the slot. `unschedule_boost` correctly handles both due and not-due branches. **No boost accounting defect found.** The suite's BO section and the host test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` cover the ring wrap extensively.

## R3. Level Draw

The SlotHashes parse validates the sysvar key, bounds the count to 512, checks buffer length, and refuses all-zero hashes. Skipped slots are handled by finding the smallest produced slot in `[want, want+64]`. The FIFO is enforced by `index == revealed_total`. A burned vault at the head still draws (skipping the Core write), so the queue never stalls. The attribute re-supply is hash-checked against the mint-stored hash.

The residual influence (limit 26) is accurately stated: C's leader can skip slots and vary block contents to choose among many draws. I found no mechanism worse than SPEC 26 describes. HOLDER-GUIDE's draw language matches. **No new draw defect.**

## R4. Governance

The electorate is fixed at creation via `index_snapshot` and `quorum_supply`. Vote binding is per-asset via the VoteRecord PDA. Key changes require `ceil(50% * quorum_supply)` YES and cannot be bundled. Notice periods gate `apply_guardian`/`apply_swap_operator`. The guardian can cancel a pending operator but not its own replacement. `TightenSweep` is monotone and bounded. Overtaken actions are logged no-ops.

I found no minority-carry path for key changes, no money reach beyond the permitted actions, and no governance-freeze worse than limit 47 (permanent stop at low turnout, which is stated). **No governance defect found.**

## R5. Charter Claim

The Merkle scheme is domain-separated (0x00 leaf, 0x01 node), uses sorted pairs, and promotes odd nodes. The JS and Rust implementations match, and the suite verifies program acceptance of JS-built proofs. The PoB is CPI-burned as its owner in the same instruction. The window is clock-gated and cannot reopen. `pob_extra` accounts pass through never as signers.

SPEC 46 correctly describes the hot-wallet exposure: collection-level plugins can brick or capture claims during the window; the positive bound (cannot transfer/burn individual PoBs) was measured in R32.A22 and I confirmed the test exists. The alarm blind spots (per-asset changes, sampling window) are stated. **SPEC 46 is complete for the described threat model.**

## R6. Configuration and Trusted Hop

I recomputed all `initialize` bounds. MINT checks the boost mint, treasury non-default, notice range, sweep bounds consistency, supply/caps, charter window, PoB root, collection cleanliness, and SEAL wiring. Values not checked on-chain (specific production values, off-curve keys, charter date) are correctly delegated to `check-launch-params.mjs` and item 38.

The swap operator's worst case is `max_sweep_lamports` per `sweep_cooldown_secs` until the guardian stops it, which matches limit 10. The royalty plugin is installed with `Some(PluginAuthority::None)`, making it immutable in Core; the suite proves even the update authority cannot change it (R.6). The redemption cap is a true rolling window over the 64-slot ring; I verified the k-th-most-recent indexing arithmetic. **No configuration defect found.**

## R7. Cross-Program Raw Reads

I recomputed every offset from the struct definitions. The MintConfig layout places: governance@41, minted_total@141, bare_burns_retired@454, charter_closes_at@442, sol_reserve@257, max_sweep@266, cooldown@274, sales_stopped@191, sweep_stopped@192, sales_stopped_at@518, sweep_stopped_at@526, sweep_floor@631, cooldown_ceiling@639, reserve_ceiling@647, max_boost_weight@711, max_boost_epochs@712. All match the constants in GOV and BURN. `MINT_CONFIG_SPACE` computes to 1,261. VaultRecord places mint_index@41, matching GOV's read. The sweep helper's token offsets (mint@0, owner@32, amount@64, len 165) match the SPL layout. **All offsets correct.**

## R8. Suite, Simulation, Build

The suite uses `att`/`attP` for error capture and `because` for reason-pinning, with unique-ID enforcement (ID.1). The floors equal the counts (861 on-chain, 907 detector, etc.). `build-mainnet.sh` behaviourally proves the INIT_AUTHORITY swap for all four keyed programs and byte-compares the sweep helper. The known gap (four keyed programs' mainnet bytes are not `cmp`'d to a reference, only key-checked) was noted in round 32 S2 and remains optional hardening, not a false claim. I found no arm that cannot fail and no wrong-reason rejection among those I traced. **The evidence structure is sound.**

## Accepted Limits — The Four Questions

**1. Is any limit worse than stated?** I found none worse. Limit 26's grinding, limit 27's dead-weight dilution (including the round-29-D2 orphan permanence), limit 40's Core-upgrade consequences, and limit 47's permanent-stop scenario are all accurately bounded as written.

**2. Is anything listed as a limit not actually a limit?** No accepted limit appears already closed. Limit 13 is correctly scoped as temporary (until upgrade-authority removal).

**3. Is any DISCHARGED item not actually discharged?** Items 51, 54, 12/17, 14, 19, 30, 31, 33 all appear correctly discharged by measurement or deletion.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** Items 22, 38, 50, 52, 53 remain genuinely open and are not treated as accepted. `charter_opens_at` and `lock_deadline` are still null in `launch/mainnet-init.json`.

## Findings

**No CRITICAL, HIGH, or MEDIUM findings.** After independent recomputation of offsets, tracing of all pairing/emptiness/pool/boost/draw/governance paths, and verification of round 32's repairs, I found no surviving defect that the existing suite and accepted limits do not already cover.

**LOW — none new.**

**INFO — none new.** The round-32 L1 and D1 repairs are confirmed correct; no residual.

## What AI Audit Structurally Cannot Do Before Launch

Given immutability and the absence of a human firm, these concrete steps are outside AI audit's capability and must be performed by people:

1. **Witnessed initialize ceremony.** The four `initialize` transactions and the upgrade-authority removal must be executed from `launch/mainnet-init.json` by a human who visually confirms each signed transaction's parameters against the checker's output, in a session recorded and co-signed by at least one other person. AI can check the JSON but cannot confirm that the human actually signed what the checker approved (item 38's A6 gap).

2. **Physical key custody.** Gary's wallet (`INIT_AUTHORITY`/guardian), the swap operator key, and the $CBOB release wallet key must be generated, stored, and backed up under physical security procedures AI cannot verify or enforce. The hot-key risks in limits 10, 46, and 56 are operational, not code, problems.

3. **Live dress rehearsal with real value.** Item 22's named pass/fail items, including one full revenue cycle through both Orca and Meteora and one forced post-sweep failure walked through hand recovery, require a human to operate against a live cluster and confirm the ledger reconciles. AI cannot substitute for running real SOL through the swap path.

4. **Holder-surface build and publication gate.** Item 50's redeem page, deposit-address page, and `judgeRedemptionCoverage` integration must be built, and the HOLDER-GUIDE must not be published until they ship. This is a product decision and engineering task AI cannot complete.

5. **PoB recipient verification.** The 240 Proof of Burn addresses in `scripts/pob-set.json` must be confirmed by a human to correspond to the intended charter members before the root is final. AI can recompute the root but cannot confirm the addresses belong to the right people.

6. **Governance bootstrap coordination.** The first proposals (round, guardian confirmation, boost terms) require real vault holders to vote. AI cannot solicit, coordinate, or verify human voting intent.

7. **Legal and regulatory review.** The token structure, vault custody model, and 85/15 revenue split may have legal implications AI is not qualified to assess.

8. **Operational runbook drills.** The guardian stop/restart procedure, the swap-cycle hand recovery, and the alarm escalation paths must be rehearsed by the humans who will execute them under incident conditions. AI can document runbooks but cannot build the muscle memory and judgement incidents require.