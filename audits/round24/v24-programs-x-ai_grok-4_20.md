**R1. CUSTODY: CAN ANYONE BUT THE OWNER GET VALUE OUT OF A SEALED VAULT, OR AN EMPTIED VAULT SURVIVE?**

**Finding (MEDIUM).** `open_for_redemption` (SEAL lib.rs:140) and `burn_vault` (BURN lib.rs:254) bind asset+owner by walking the instructions sysvar for a matching top-level pair. The walk is correct and fails-closed. However, the emptiness proof (BURN 327-378) only checks *declared* accounts. A nested Core asset or undeclared Token-2022 account with extensions is invisible. Core `BurnV1` does not sweep the asset-signer PDA (measured). A redemption therefore destroys undeclared holdings (9.5/9.9). The redeem page's `judgeRedemptionCoverage` (item 50) is not built, so the only control is post-hoc alarm (`detectNestedVaults`, `detectUndeclaredTokenAccounts`). This is worse than stated in SPEC 9/44 and HOLDER-GUIDE:86-88, which claim the page will warn before the owner signs. Evidence that would exist: a redemption of a vault containing an undeclared nested vault or Token-2022 confidential account succeeds, the inner asset is orphaned or the confidential balance is lost, and the alarm pages only after the fact. The fix is to build the page (item 50) and make it mandatory for redemptions.

**Finding (LOW).** `retire_redeemed` (MINT lib.rs:1758) is reachable only from inside BURN's `burn_vault` (stack-height + discriminator + asset binding, 1760-1772). However, the wrapper test in the suite (tests/cpi-wrapper, used in 3prog.test.ts WR.1-WR.4) shows that a genuine top-level open + wrapped burn is refused by stack height, and a wrapped open + genuine burn is refused by the open walk. The pairing is therefore sound, but the test harness itself is test-only and not in the shipped code. Evidence that would exist: a redemption through a real wrapper program (not the test harness) would succeed if the checks were broken; none does. The fix is to keep the test harness in the rehearsal tree only (already done) and add a comment that the pairing is proven by both the on-chain checks and the wrapper test.

**Finding (INFO).** The emptiness proof refuses Token-2022 extensions (BURN 370) because a confidential balance reads zero in the base `amount` field. This is correct, but the comment (BURN 312-318) says "a Token-2022 lookalike or any other 9-decimal mint is refused before a CPI" — the 9-decimal check is only on the $GARY burn path (1599), not the reserve loop. Evidence that would exist: a 9-decimal non-reserve Token-2022 account would pass the reserve loop if it had amount=0. The fix is a comment clarification only.

**R2. THE COMMUNITY POOL**

**Finding (MEDIUM).** `monthly_inline` (MINT lib.rs:1661) runs *before* the pair loop in `claim` (1686). A due boost is expired only in the loop (1688). Therefore a host that sees a due boost but no claim for that vault will skip the month (logged `CBOB_MONTHLY_WAITS_FOR_BOOSTS`). The next host runs it. SPEC 36 and HOLDER-GUIDE:21-23 say the monthly run "never fails its host" and "runs itself"; both are false when a due boost blocks it. Evidence that would exist: a due boost + a host that does not name the boosted vault → month not run, `last_distribute_at` unchanged, alarm does not page on `distribution_overdue` until the next pass. The fix is to run `expire_boosts` (free, records only) before the monthly check in every host, or document the wait.

**Finding (LOW).** `JoinWaitingFirst` (1594) refuses a distribution while any vault that requested in an earlier epoch is still unjoined. However, a vault that requested in the *current* epoch can be joined by the same `claim` that would have run the distribution (the pair loop joins before paying). The gate is therefore slightly looser than the comment claims. Evidence that would exist: a vault requests, the month becomes due, a claim joins it and distributes in one transaction → the vault gets the distribution it just became eligible for. The fix is a comment clarification only (already partially addressed in round 22).

**Finding (INFO).** `retire_redeemed` (1758) is called by CPI from BURN only. The stack-height check (1760) and the top-level-instruction check (1763-1772) are both present and correct. However, the test harness that proves the wrapper attacks (tests/cpi-wrapper) is test-only and not in the shipped binary. Evidence that would exist: a redemption through a real wrapper would succeed if either check were missing. The fix is to keep the harness in the rehearsal tree only (already done).

**R2b. THE $CBOB BOOST**

**Finding (MEDIUM).** `boost_vault` (1457) has no slippage guard. The terms (`boost_price`, `boost_weight`, `boost_epochs`) are read at execution time (1462). A vote landing between signing and execution burns the *new* price for the *new* terms. Evidence that would exist: a vote raises the price, a boost carrying the old `max_price` succeeds and burns the higher amount. The fix is to take buyer terms (`max_price`, `min_weight`, `min_epochs`) and refuse `BoostTermsMoved` before the burn (already in the working tree, uncommitted). This is the same pattern as `mint_vault`'s `max_price`.

**Finding (LOW).** A boost bought under old terms keeps those terms even after a vote changes them (1465-1466). This is intended, but SPEC 51:1304 and HOLDER-GUIDE:81 do not state it clearly. Evidence that would exist: a boost is bought, a vote changes the terms, the next distribution still pays the old weight. The fix is documentation only.

**Finding (INFO).** `set_boost_terms` is pinned in GOV (484) but the discriminator pin in the suite (3.1x) is missing. The call is exercised (BO.3), but the exact 8-byte value is not asserted against the Rust constant. Evidence that would exist: a mismatch would still execute but the suite would not catch it. The fix is to add the pin (already in the working tree).

**R3. THE LEVEL DRAW**

**Finding (LOW, evidence gap).** The skipped-slot path in `blockhash_in_window` and `try_capture` is exercised only in host unit tests (`host_tests::the_lookup_takes_the_smallest_produced_slot_in_the_window`). The local validator never skips slots, so the main suite never hits `Capture::NotYet` on a produced slot inside the window or the reschedule path on a fully expired window. Evidence that would exist: a test with a synthetic SlotHashes buffer containing gaps at the A/B/C targets would fail if the logic were wrong. The fix is to keep the host unit tests (already present) and run them in CI.

**Finding (INFO).** The FIFO is enforced (`reveal_level` refuses `RevealOutOfOrder` if `mint_index != revealed_total`). However, a burned vault at the head of the queue still takes its draw (L.11), which is correct but undocumented in SPEC 25. Evidence that would exist: the queue would stall at a burned vault if it refused to draw it. The fix is a comment.

**R4. GOVERNANCE**

**Finding (INFO).** `execute_proposal` (GOV lib.rs:520) lands an overtaken action as a logged no-op (`CBOB_ACTION_SKIPPED`). The comment (534) says this prevents the bundle from reverting. However, the skip is implemented only for `SetRound`, guardian changes, and operator arms; a `TightenSweep` that is now looser is still executed (it takes the min of live and voted). This is harmless but the comment is imprecise. Evidence that would exist: a tighten that became looser would still land. The fix is a comment clarification.

**Finding (INFO).** The 10% turnout rule (D.1) is never binding at the ruled numbers (quorum 21% + threshold 51% already requires >10.71% YES). It exists only for other `initialize` values. SPEC 35 states this correctly; HOLDER-GUIDE:35 does not. The fix is documentation only.

**R5. THE CHARTER CLAIM**

**Finding (LOW).** The PoB collection's update authority is a hot wallet (kept by ruling). It can add an Oracle that rejects burns. The claim passes up to 8 extra accounts (stage 3c), so a benign hook cannot brick it. However, a *rejecting* hook still refuses every claim, and the window never reopens. The alarm pages on any plugin change to the *collection*, not each of the 240 assets. Evidence that would exist: a plugin added to a single PoB asset would not page. The fix is to watch individual assets or accept the limit (already in SPEC 46).

**R6. THE ONE-TIME CONFIGURATION AND THE TRUSTED HOP**

**Finding (MEDIUM).** `initialize` in MINT (lib.rs:312) refuses a default 15% destination, a payment mint not in SEAL's reserves, and a SEAL config naming another collection. However, it does *not* check that the revenue address's own cbBTC ATA exists or that the revenue address holds rent. The first paid mint and the first split would fail if either is missing (item 52). Evidence that would exist: a first royalty < rent exemption fails `split_revenue` with `NothingToSplit` after the transfer. The fix is to create and fund the three cbBTC accounts (pool, revenue, Squads) in road step 10, idempotently, before the first paid mint (already documented in accepted limit 52).

**Finding (LOW).** The swap operator and guardian are not checked for being on-curve at `initialize`. A PDA could be set, which could never sign a sweep or stop. Evidence that would exist: `initialize` with a PDA as guardian or operator succeeds, and the stop/sweep later fails with `NotTheGuardian` or `WrongTreasury`. The fix is to add `require!(is_on_curve, ...)` (but `is_on_curve` panics on BPF, so the check must be in the client or the launch script). Accepted as limit 38 (every initialize value is permanent).

**Finding (INFO).** The 10% royalty is set by Core with authority NONE. However, the collection's update authority (a hot wallet) could have added a plugin at creation that affects royalties. The live collection was read 2026-10-04 and carries only the royalties plugin. The fix is documentation (already in SPEC 46).

**R7. CROSS-PROGRAM RAW READS**

**Finding (INFO).** Every raw offset and account size was recomputed from the structs. All match the pinned constants in `bank/layout.mjs`. No silent misread found. The version bytes are first in every struct, so a layout change fails loudly.

**R8. THE SUITE AND THE SIMULATION AS EVIDENCE**

**Finding (LOW).** The suite arm for a charter claim with a pass-through Oracle account, separate payer, compute-budget instructions and a depth-8 proof (3c.P1) is measured offline but not exercised in the on-chain suite. The on-chain suite uses a crank, which does not fit with the extra accounts. Evidence that would exist: the packet would exceed 1232 bytes with 5 extra accounts. The fix is to keep the offline measurement and document the client rule (claim page sends no crank when `pob_extra > 0`).

**Finding (INFO).** Several "because" lists in the suite are incomplete or point to the wrong error. Example: 9.13 is pinned to System "already in use" but the suite comment says Core. The actual refusal is the record PDA's `init`. Many arms for `RateLimited`, `NoTerminalBurn`, `NotFromBurn` are pinned to the wrong program id. The fix is to update the `because()` lists to name the exact log line or program+code.

**Finding (INFO).** The Test Vault simulation (sim/test-vault.ts) has no boost arms. It therefore never exercises the boost carry, expiry, or the `BoostsExpireFirst` gate. Evidence that would exist: a boosted vault in the sim would show the carry and exact N distributions. The fix is to add boost steps to the simulation (already partially in the working tree).

**GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?**

Be concrete.

1. **Run the full mainnet dress rehearsal with throwaway program IDs** (item 53, already scripted). The rehearsal tree must pass `run-tests.sh` *and* the crank and alarm against a live cluster with ~2,100 vaults. This is the only way to prove liveness, paging, RPC error handling, and that the crank keeps up with the reveal lane. AI cannot do this.

2. **Build and ship the redeem page that runs `judgeRedemptionCoverage` before the holder signs** (item 50). This is the only preventive control on undeclared airdrops and nested vaults (limits 9 and 44). The page must also create destination ATAs in a prior transaction (item 42) and put `claim` before the sweep. AI cannot build or test a UI.

3. **Get Gary's explicit ruling on the $CBOB boost economics** (F2 and F3 above). A 24-distribution boost can be run out in a few transactions for ~2,400 $GARY. Is that acceptable? If not, add a minimum interval to the burn path. AI cannot make product rulings.

4. **Fund the three cbBTC accounts (pool, revenue, Squads) and the revenue address above rent exemption in road step 10** (item 52). Then run a full end-to-end test with real small amounts: mint, activate, distribute, claim, redeem. AI cannot move real money or verify the resulting ledger.

5. **Remove the upgrade authority from all four programs on mainnet, after the dress rehearsal passes.** Then the programs are immutable. AI cannot do the final on-chain action.

6. **Publish the exact deployed bytecode hashes and the git commit they were built from.** The audit is the certification; the hashes are the proof that what was audited is what is running. AI cannot sign a transaction.

Do these six things and the risk that remains is only what the code structurally cannot prevent (Core upgrades, Coinbase freezes, the last slot-hash contributor, off-curve owners, and the fact that a burned vault's provenance is gone). Everything else is either fixed or explicitly accepted in the control table.