# Round 41 audit: independent read of the whole current tree (v6)

**Verdict: I found no CRITICAL, HIGH or MEDIUM defect in the five programs, and no path that moves value out of a sealed vault, the pool or the revenue address.** I found six LOW/INFO items and several points where the accepted limits are understated. Everything below is from reading the files; I ran no validator and no tests. Where a claim needs a run, I say what evidence would settle it.

---

## R0. Round 40's verdicts and repairs

- **V40-1, the dusted-ATA refusal.** I traced `absentIfDust` through every site that reads an account at a derived token-account address.
  - **Covered:** `reads.mjs` `vaultWalletAccounts` (the reserve and promised addresses), `readRedemptionSnapshot` (`ownerAtaExists` and `ownerAtaFrozen` are token-owned only), `buy.mjs`, `redeem.mjs` (payout `$GARY`, the pre-balance read), `ceremony-reads.mjs` step `atas`, and `meta/generate.mjs`.
  - **Not covered, and fine:** the pool read in `readRedemptionSnapshot` is not wrapped. Step 5 creates the pool before any vault exists and nothing in our programs can close it, so a dusted pool address is unreachable after launch.
  - **Disproved claims:** W1 (Ember: a frozen zero-balance vault account while owed) is unreachable, and I agree. Activation needs at least 21,000 sats read in that account. Nothing can lower the balance while the vault is sealed, because the PDA is the only token authority and Core refuses Execute on a frozen vault.
- **Also covered:** the fix for V40-4 (SPEC discharged item 2) and the gate-5 additions (R40.U1 and the dusted-address e2e arms) read consistently with the code.

I re-derived the on-chain layouts: the MintConfig, VaultRecord, BurnConfig and SealConfig offsets and space formulas, including the GOV, BURN and web offsets (141, 442, 454, 518/526, 631-655, 711/712, 749; VaultRecord 177/178/186/187/195/221). All match the struct definitions.

## R1. Custody

- **Pairing (SEAL and BURN).**
  - SEAL scans forward over top-level instructions for `burn_vault` with the same asset at account 0 and the same owner at account 2.
  - BURN scans backward for `open_for_redemption` with the same asset and owner. A CPI-wrapped open or burn is invisible to the top-level scan.
  - `retire_redeemed` requires stack height 2, and its top-level instruction must be BURN's `burn_vault` for the same asset. BURN itself CPIs only Core and MINT, so no other program can sit at height 2 under a BURN top-level instruction.
  - The open-then-transfer-then-burn variant fails on `asset_owner == owner`, and the whole transaction reverts.
- **Emptiness proof.** Both Token-2022 and classic derivations are checked. A System-owned or short account is skipped, a Core asset must not be live, and lamports must be 0.
- **A stranger creating a reserve account in the race window.**
  - The prior transaction creates all three reserve accounts, and only the PDA can close them, so none can reappear.
  - A Token-2022 ATA for a classic mint cannot be created (measured, probe-round5b F4.2).
  - A non-ATA token account is simply undeclared and destroyed. That is accepted limit 44, not a refusal.
- **R1s(c): the sweep helper does not bind its destination wallet to the owner.** On chain this is safe, because only the owner can make Core sign. The residue is off chain. Wallets do not decode an inner `ExecuteV1` instruction, so a holder cannot see where the sweep goes. A tampered or phished redeem page that sets `dest` to the attacker is signed as readily as a correct one. That is the largest practical theft vector left, and no program change can close it now. See the final section.
- **R1s(a), (b), (d), (e).** I found nothing:
  - Duplicate sources are refused when the second read hits a closed account (SR.12a).
  - A destination must be owned by the one wallet and have the same mint.
  - The lamport sweep reads live and the owner controls the transaction, so nothing can land between the sweep and the burn.

## R2 and R2b. The pool and the boost

I checked these invariants by hand and found no violation:

- `owed_scaled` equals the sum of `owed_of` over live records. This holds across credit, join, claim, reweigh, retire and forfeit.
- `credit`: `owed += delta·w ≤ avail·S`, so `ceil(owed_new) ≤ pool_balance`.
- The boost ring: end epochs lie in `(e, e+63]`, so slots never collide. `advance_epoch` zeroes a slot as it moves it to `boosts_due`. The `unschedule_boost` branch on `dist_epoch >= end` matches that.
- `expire_boosts` and `claim` use the same due predicate.
- `pending_count` and `pending_this_epoch` are consistent under retire. Liveness holds: `expire_boosts` needs only records, and `claim` joins without reading the token account.

**One observation (INFO): sub-sat forfeit.**
- `retire(redeemed=true, forfeit=false)` returns any carry under 1 sat to the pool. P.12a shows such dust exists.
- HOLDER-GUIDE says "Anything credited to you stays yours until it is delivered (the one exception is … pool is frozen)". This is the one other exception.
- The amount is under 1 sat per redemption. It is a literal misstatement about holder money, so under gate 3 it does not qualify for the documentation exception.

## R3. The level draw

The SlotHashes parse is bounded and fails closed. The A/B/C selection, the FIFO, and burned-head handling are consistent. Reveal re-supplies attributes under the stored hash. I found nothing new.

**Fact 12 reliance (needs a run to settle).**
- SPEC and the prompt rely on "Core never CPIs into lifecycle hooks".
- `claim_charter_vault` passes up to 8 writable accounts into Core's burn, while the owner and the payer are both signers on that CPI.
- If a LifecycleHook adapter on the Proof of Burn collection is invoked by CPI, a hostile hook receives accounts and signer privileges of the claimant. Only the OR arms use an Oracle, which is read-only data.
- Evidence that would settle it: a suite arm with a real LifecycleHook adapter whose hook program tries to transfer SOL from the signer.
- The claim page does not use `pob_extra`, so the exposure is limited to non-page callers. Disclose it or measure it.

## R4. Governance

I found nothing that lets a minority carry what it should not.

- The snapshot and key-change threshold (half of the snapshotted live supply) are enforced.
- The GOV restart skip rule (`>=`) mirrors MINT's `StopIsNewer` (`<`), and both read the same state in one transaction.
- Skipped actions do not revert the bundle.
- `ACTIONS_SPACE` covers the largest encodings.

**Limit 47 (stolen guardian key) is worse than stated with time.** The replacement needs YES from half of all live vaults. Lost-key, orphaned and dormant vaults count in `quorum_supply` forever. With immutable programs and no admin, the bar rises as holders disengage, so "permanent while fewer than half vote" gets easier to reach each year. SPEC 47 frames this as a turnout accident, not a decay.

## R5. The charter claim

Merkle domain separation and the sorted-pair rule match the JS (`node <= *sib`). Short proofs cannot forge a leaf, because leaf and node tags differ. Identity is by address. The window is by clock only. I found nothing beyond the fact-12 question above.

## R6. One-time configuration

- `initialize` checks line up with SPEC item 38. As SPEC says, the programs accept more than the checker does (off-curve guardian or operator, a SEAL reserve list of duplicates). Only the checker and the ceremony page stand between a wrong value and permanence.
- The rolling window is exactly a 64-entry ring. `kth = ring[head−k]` is the k-th most recent entry, and `k = min(cap, 64)`.
- Royalty authority None, re-delegation (0x1b), removal and asset-level override are all pinned by suite arms.

## R7. Raw reads

I recomputed everything; see R0. One practical note: the SEAL reserve Vec at offset 41 is parsed identically in MINT and BURN with the same 3-key bound.

## R8. Suite, simulation and build

- `web/test/run-all.mjs` is still not in `run-tests.sh` (round 36 A8, already stated). Item 50 stays OPEN, so this is not a defect yet.
- `rehearsal-tree.sh` does not patch or scan `web/`, so the pages still carry the mainnet ids (already stated; item 53 is OPEN).
- Round 39's seven arms without `because()` pins (A9) remain unchanged.

## Questions about the accepted limits

1. **Worse than stated:**
   - **Limit 28, targeted freeze.** The "provoke a freeze with tainted cbBTC" language names the pool only.
     - Anyone can deposit any cbBTC into a vault's own ATA, and a sealed vault cannot return it.
     - A freeze of one vault's ATA blocks that holder's entire redemption (including `$GARY` and `$GIRAFFISH`) and their claims.
     - It is a cheap, targeted denial against an individual holder. The holder guide does not say a stranger can cause it.
   - **Limit 32, cost of blocking.** "Costs about 2.1% of live supply in vaults" is overstated. The attacker recovers each vault's contents when redeeming. The real cost is the sale price (of which 85% goes to the other holders) and lost earnings, which is much cheaper.
   - **Limit 47.** See R4.
2. **Closed or not a limit:** nothing found.
3. **Discharged items:** 19, 31, 33 and 51 hold as written. Item 54 is discharged only for the legacy shapes it states.
4. **Quietly treated as accepted:** none found. Items 22, 38, 50, 52 and 53 are still OPEN, and `charter_opens_at`, `lock_deadline` and `vault_collection` are still OPEN in `launch/mainnet-init.json`.

## Findings

| # | Severity | Finding | What would settle it |
|---|---|---|---|
| 1 | LOW (operational) | The step-10 ceremony page is irreversible, and its mainnet-only branches (`judgeLaunch` on the embedded values, `programBytes` against real `dist/` bytes, the genesis check, the real RPC proxy) are exercised only offline with mocks. The `rehearsal` profile refuses (item 53 not built). | A dress rehearsal of the page's mainnet profile against a mainnet-fork validator or throwaway ids, with its output recorded. |
| 2 | LOW (doc) | HOLDER-GUIDE does not warn that a compromised or look-alike redeem page can send the whole sweep anywhere, and that wallets cannot show it (R1s(c)). | Add the warning, publish the page hashes (README's table), and publish a standalone redeem builder (see the final section). |
| 3 | INFO | Sub-sat forfeit on redemption (R2). | One sentence in the guide. |
| 4 | INFO | Targeted tainted-deposit freeze of a single vault (limit 28 text). | Wording in SPEC 28 and the guide. |
| 5 | INFO | Fact-12 reliance for the `pob_extra` pass-through (R3). | The arm described in R3. |
| 6 | INFO | Governance liveness decay (R4). | State it in SPEC 47. |

None of these touches the five programs.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run the full launch on real mainnet at throwaway ids with real money, end to end.** Run step 8 including the page's own mainnet profile. Include a real Phantom signing, a real Squads return of a rescued vault, a real Coinbase-frozen account path, and a real Orca and Meteora cycle. Rehearse step 11 on a throwaway program: set the authority to final, dump, and confirm a second upgrade is refused.
2. **Make redemption independent of the website.** The programs are immutable but the only sanctioned client is a static site (hosting, DNS and CDN are all attack surface). Before launch:
   - Publish a small open-source command-line redemption builder, with a documented hand procedure, so holders never depend on the site.
   - Pin and publish the page hashes where holders can compare them.
   - Prepare a takedown and rotation plan for the domain.
3. **Reproducible build and independent verification.** Produce a verifiable build (for example with `solana-verify`) from the release commit on a second clean machine. Have a second person, not this box, check the on-chain bytes against `dist/SHA256SUMS` before step 11. Store the deploy-authority key offline with a recovery path.
4. **Read Core's source and the plugin-adapter code yourselves, or hire someone to.** Several controls rest on Core behaviours that are measured only against the pinned binary: the Execute authority rule, the tombstone, the lifecycle-hook CPI question, and the heap limits. Have a human who knows Core confirm these.
5. **Property-test the accounting.** Add an independent fuzz or model for the accumulator, ring and join/expire counters. The suite is scenario-driven, and the host model covers only the boost ring.
6. **Legal and compliance review.** A holder-share NFT (85% of sales and royalties by level) may be a security in some jurisdictions. Also get advice on tainted-funds exposure from forced deposits and on Coinbase's freeze policy.
7. **Operational drills.** Run guardian-key theft, swap-operator-key theft, and box compromise (the ledger, crontab and alarm share a user). Time your response against the real alert path.
8. **A bug bounty and a staged opening.** Open with a small first cohort and low values, with the guardian stop armed, before the 2,100 supply is reachable.