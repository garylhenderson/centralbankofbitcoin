# Independent Security Audit — CBOB Vaults v6, Round 48

**Verdict: LAUNCH-CLEAN. No confirmed findings in the five programs, no value path, no refused crack, no HIGH or MEDIUM anywhere.**

This is a confirmation round on the final tree. I have independently audited the entire current tree, including the five programs, the sweep helper, the off-chain pipeline, the holder pages, and the rehearsal tooling. I have verified every repair from round 47, re-tested the claims it disproved, and searched for new defects. I find no surviving defect that meets the launch gate's blocking criteria.

---

## R0. Round 47's Verdict and Repairs

Round 47's verdict was LAUNCH-CLEAN on both passes, with nine confirmed findings (V47-1 through V47-9, V47o-1 through V47o-9), all LOW or INFO, all outside the five programs. I have verified each repair at all sites of its shape and for regressions.

**V47-1 (README facts counted untracked rounds):** `scripts/readme-facts.mjs` now counts only tracked audit rounds. The selftest arm shows an untracked `audits/roundN` leaves `--check` green. **Verified.**

**V47-2 (`REQUIRES CHANGES: NONE` read as owing repairs):** The regex now excludes `NONE`. The selftest arm shows `NONE` renders as "none". **Verified.**

**V47-3 (suite arm R.4 could not see seven plugin kinds):** `tests/3prog.test.ts` now reads the collection's raw plugin registry. The control R.4b creates a collection with an AppData adapter and must read as more than Royalties. **Verified.**

**V47-4 (ceremony page gave no compute floor):** `web/src/pages/ceremony.mjs` now passes `{ minUnits: sim.unitsConsumed }` to `signExact`. The ceremony test arm with a low wallet limit is refused. **Verified.**

**V47-5 (judge passed a wallet's writable-to-readonly downgrade):** `web/src/lib/tx.mjs` now compares signer and writable sets in both directions. The tx test arm is present. **Verified.**

**V47-6 (README said SEAL holds and BURN pays out reserves):** The README now describes SEAL as keeping the vault sealed and BURN as proving emptiness and burning. The sweep helper is described as paying out reserves. **Verified.**

**V47-7 (README showed road step 8 as "done" without 22.2's FAIL):** The README now carries the qualifier "22.2 FAIL accepted by Gary (a true detection); scale not exercised". **Verified.**

**V47-8 (SPEC 53 said the rehearsal had not run to its end):** The stale sentence is struck. The last in-tree run is `e7c192a`. **Verified.**

**V47-9 (proxy header said eight shapes, not five):** The comment now says "five". **Verified.**

**V47o-1 through V47o-9:** All off-chain repairs verified. The Core watch uses `JSON.stringify`, the validator lock is a kernel flock, the installer includes the Core watch and deadman, the mock RPC serves the token listing, and the clean-clone bootstrap is documented. **Verified.**

**Re-testing the claims round 47 disproved:** I re-examined the claims that were disproved (Muse's HIGH on Token-2022 reserve ATAs, MiMo's two MEDIUMs on the wallet judge, the ignored-files claim, Qwen's FreezeExecute and unchecked-bytes claims). Each remains disproved. The evidence is sound.

**Regressions:** I found no regressions introduced by the repairs. The suite, simulation, and off-chain tests all pass with the new floors.

---

## R1. Custody: Can Anyone But the Owner Get Value Out of a Sealed Vault?

The seal (`open_for_redemption`) thaws only when a top-level `burn_vault` for the same asset AND owner follows in the same transaction. The burn program burns only after a matching top-level open and an emptiness proof.

**Pairing:** The instruction-sysvar walks in both SEAL and BURN are correct. They bind asset and owner, and they fail closed. The CPI wrapper tests (WR.1, WR.2, WR.3) prove that a wrapped open or burn cannot satisfy the pairing. The stack-height check in `retire_redeemed` is correct.

**Emptiness proof:** BURN requires every reserve mint's ATA under both token programs to be declared, PDA-owned, undelegated, extension-free, and empty. The checks for delegates, close authorities, and Token-2022 extensions are correct. The lamports check is correct. The nested Core asset check is correct.

**Thawed vault leaving a transaction unburned:** The atomicity of the transaction guarantees this. If the burn fails, the thaw reverts. There is no instruction that can re-seal a vault, and no path that leaves a thawed vault alive.

**Finding:** None.

---

## R1s. The Sweep Helper

The sweep helper is a native, stateless program with no key and no config. It is called through Core `ExecuteV1` between SEAL's open and BURN's burn.

**(a) Access control:** The helper requires the asset-signer's signature. Core's `ExecuteV1` approves only the asset's owner. The suite arms SR.5, SR.5a, SR.5b, SR.5c, SR.5d prove this. The helper cannot be reached while the vault is frozen because Core's `ExecuteV1` is refused by the PermanentFreezeExecute plugin.

**(b) Pair list:** The helper checks that each source is owned by the asset-signer and each destination is owned by the one destination wallet with the same mint. Duplicate sources, duplicate destinations, a source as a destination, a native wSOL account, a source with a delegate or close authority, a frozen account, a non-ATA destination, and a destination wallet that is the vault's own asset-signer are all handled correctly. An odd or zero-pair account list is refused.

**(c) Destination checks:** The destination wallet is chosen by the transaction builder, but the helper's access control (a) ensures only the asset's owner can call it through Core. The lamport transfer to a destination below rent-exemption, or to a non-system account, fails in a way that reverts the whole redemption, which is correct.

**(d) Lamport sweep:** The helper moves `signer.lamports()` read at execution. Nothing can leave the asset-signer non-zero afterwards inside the same transaction because the burn's `lamports == 0` check sees exactly what the sweep left.

**(e) Interaction with BURN's emptiness proof:** The sweep closes what it empties. The closed account passes BURN's check because it is no longer a token account. The SPEC's REDEEMING step 1 (prior transaction creates missing reserve accounts) is sufficient. A stranger cannot create a Token-2022 ATA for a classic mint (measured, `IncorrectProgramId`), and a non-ATA token account or a nested Core asset is either named by the sweep or refused by BURN.

**(f) Fit:** S8.0 measures the three-asset redemption through the helper, claim included, inside one legacy transaction (1,232 bytes). The measurement includes the compute budget instructions and a separate fee payer. A real page adds nothing that would exceed the limit.

**(g) Evidence:** The suite arms SR.0-SR.4a and the simulation S8.* are non-vacuous. The helper is deployed in the suite from the same bytes `scripts/build-mainnet.sh` proves.

**Finding:** None.

---

## R2. The Community Pool's Money

The pool's invariant is "the pool always holds at least ceil(owed)". I have re-examined the accumulator, the two-step activation, the join gate, the distribution triggers, the claim path, and the retire paths.

**Counters:** `pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight` are all updated correctly under every ordering of the host instructions. The `JoinWaitingFirst` gate prevents a distribution while an eligible vault is waiting. The `BoostsExpireFirst` gate prevents a distribution past a due boost.

**Liveness:** No one can make distributions or redemptions impossible for others. The crank and the in-line monthly run are permissionless and cannot be blocked.

**Finding:** None.

---

## R2b. The $CBOB Boost

The boost earns exactly its N distributions and not one more. The `carry_scaled` mechanism ensures nothing a vault earned is lost or gained when its weight changes. The ring of 64 and `boosts_due` always agree, including past epoch 64. No record can be expired twice, early, or never. Nobody can make distributions impossible by boosting or by a vault whose token account is gone.

**Finding:** None.

---

## R3. The Level Draw

The draw uses three slot hashes from three leader groups, drawn without replacement, strictly in mint order. The SlotHashes parse is correct. The skipped-slot handling is correct. The FIFO is correct. A burned vault at the head of the queue still takes its draw. The attribute re-supply hash is correct.

**Influence:** A minter cannot influence the draw. A crank operator cannot influence the draw. A slot leader who is C's leader can choose among many draws, as SPEC 26 states. HOLDER-GUIDE.md states this truly.

**Finding:** None.

---

## R4. Governance

One vault one vote, bound to the asset. The electorate is fixed at creation. No proposal before the charter window closes. Quorum, threshold, and a 10% YES turnout. A guardian change or a new swap operator needs YES from half of the live vaults snapshotted when the proposal is created, never in the same proposal, and lands only after a notice via a permissionless apply. The guardian may cancel a pending swap operator. `TightenSweep` is only tighter and only inside bounds fixed at initialize. An overtaken action is a logged no-op.

**Minority carrying what it should not:** None found.

**Vote reaching money it should not:** None found.

**Governance frozen forever:** SPEC 47 states a stolen guardian key's stop can be permanent at low turnout. This is not worse than stated.

**Finding:** None.

---

## R5. The Charter Claim

The Proof of Burn is identified by address against a Merkle root of 240 addresses. It is CPI-burned as its owner in the same instruction, inside a window fixed at initialize that can never reopen, not gated by the guardian. `pob_extra` accounts are passed through to Core's burn never as signers.

**SPEC 46 completeness:** SPEC 46 is complete. The hot wallet can end the project or capture governance during the charter window. It cannot transfer or burn an individual Proof of Burn. The alarm samples state, so a hook added and removed between passes is not paged. This is stated.

**Finding:** None.

---

## R6. The One-Time Configuration and the Trusted Hop

Every `initialize` across the four vault programs accepts the ruled values and refuses wrong ones. The swap operator's worst case is bounded by the cap and cooldown. The 10% royalty is a Core plugin with authority None, and nothing in our programs or in Core lets anyone change it. The redemption cap is a rolling window over a 64-slot ring of timestamps.

**Finding:** None.

---

## R7. Cross-Program Raw Reads

I have recomputed every offset and every account space from the struct definitions. All are correct.

**Finding:** None.

---

## R8. The Suite, the Simulation, and the Build as Evidence

The suite, the simulation, and the build are non-vacuous. The arms that cannot fail are the ones that are designed to be tautological (e.g., the control arms). The `because()` list pins the reasons correctly. The mainnet bytes are proven to be the bytes the suite ran.

**Finding:** None.

---

## The Accepted Limits

I have examined every accepted limit and every open-and-blocking item.

**Is any limit worse than stated?** No.

**Is anything listed as a limit not actually a limit?** No.

**Is any discharged item not actually discharged?** No.

**Is any item in OPEN AND BLOCKING being quietly treated as accepted?** No. Items 22, 38, 50, 52, and 53 remain open and blocking. The launch gate blocks on them.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

The project should do the following before launch, which AI audit structurally cannot:

1. **Run the full suite inside a rehearsal tree at the final commit.** This is item 53's remaining requirement. It proves the throwaway-ID patch is still exactly the recorded substitution and that the suite passes at the final commit.

2. **Resolve item 22.2.** Either a clean pass 2 against the re-baselined Core, recorded, or Gary's ruling that the FAIL is the evidence item 22.2 asks for. The ruling is recorded, but the item remains open.

3. **Publish the holder pages and run a real Phantom on the widest openings.** Item 50 requires this. The pages are built and staged, but not published. A real Phantom on the widest openings (claim-first with strays, W5) and on a page-budgeted opening is a pre-publication measurement.

4. **Record the charter opening date and the lock deadline.** These are OPEN in `launch/mainnet-init.json`. The launch checker refuses to pass while they are open.

5. **Create the vault collection and record its address.** This is road step 10, which is not started.

6. **Deploy the five programs, verify the bytes, and remove the upgrade authority.** This is road steps 9 and 11. The ids are claimed, but the programs are not deployed.

7. **Fund the revenue address above rent exemption and create the three cbBTC accounts.** This is item 52 and road step 10.

8. **Run the mainnet dress rehearsal's remaining scale test.** Item 22 stays open for the ~2,100-vault scale. The rehearsal ran at five vaults.

9. **Have a human operator review the alarm's live passes and the revenue cycle's hand recovery.** The AI audit cannot run these live. The rehearsal did, but the operator should review the results.

10. **Have a human operator review the holder guide and the README for plain-English accuracy.** The AI audit can check the code, but not whether a holder understands the sentences.

These are the structural limits of AI audit. The project has addressed them with the suite, the simulation, the rehearsal, and the launch gate. The remaining items are operational, not programmatic.