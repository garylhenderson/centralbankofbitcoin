**Round 45, off-chain pass: LAUNCH-CLEAN; QUORUM MET.**

**Seats counted: 7 of 8 (6 needed):** Fable 5.1 (re-run), Sonnet 5.5, Muse Spark, Qwen 2.4T (re-run), MiMo, GLM, and Qwen max-0902 narrowly. Quorum holds without it. Longcat is not counted: it quotes code that is not in the tree and marks a recommended repair as done. The failed Fable and Qwen 2.4T first outputs were re-run at the same head and prompt size and are not counted.

**Confirmed, all outside (a)-(d):**
- **V45o-1, LOW (alarm):** V44o-3's repair missed two sites. A null SEAL read makes canonical reserve accounts page `non_ata_token_account` CRITICAL, and the daily reconcile pages about 6,300 false `undeclared_token_account` CRITICALs. Measured.
- **V45o-2, LOW (revenue, found by this triage):** in production, a stray `CBOB_REHEARSAL_FAIL_AFTER_SWEEP` or `…FORCE_ORCA_REFUSAL` is refused only after the sweep lands, stranding a cycle. `rehearsal-env` otherwise changes production only by refusing. Measured.
- **V45o-3, INFO:** during a pool freeze, `distribution_overdue` blames every layer.
- **V45o-4, INFO:** a flood can reset an unreadable signature's count; it holds four passes, not SPEC's three. Measured.
- **V45o-5, INFO:** the detector selftest goes red on any never-bundled file. Measured.
- **V45o-6, INFO:** the crank's below-floor warning says it "kept the floor".
- **V45o-7, INFO:** the off-chain prompt repeats round 44's R0, and the bundle split hid V45o-2.

**Disproved:**
- Longcat's CRITICAL units claim: the fork's SW.7 to SW.9 swapped within 20 bps of the oracle.
- Fable's bitmap-dust LOW: the extension exists on mainnet and SW.9 used it.
- GLM's discriminator and split INFOs.

**Rounds 41-44:** all 24 confirmed findings remain outside (a)-(d).

**Gate 5:** round 43's items 4 and 5 and round 44's item 6 are still open.

**Verdict: QUORUM MET (7 counted of 8; six required; the Fable provider failure and the Qwen 2.4T non-report re-run at the same head and prompt size, the failed outputs not counted). LAUNCH-CLEAN under SPEC gate 3's launch gate: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 2 LOW (V45o-1 alarm SEAL-null sibling sites, V45o-2 revenue rehearsal switches read after the sweep), 5 INFO (V45o-3 overdue text during a freeze, V45o-4 unreadable-skip bound four not three, V45o-5 coverage selftest ordering, V45o-6 crank floor text, V45o-7 audit prompt and coverage split); nothing in the five programs; no value path; no refused crack. NOT CLEAN under the clean-round rule.**

**GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?**

1. **Run the full mainnet dress rehearsal (item 22, including one live revenue cycle through both pools and one forced post-sweep failure recovered by hand).** The 5-vault rehearsal proves the driver and the rehearsal tree; the ~2,100-vault scale and live I/O (crank, alarm, revenue) remain unexercised. This is the only way to surface RPC-rate, paging, transient errors, and crank/revenue interplay at production scale. Do it on mainnet with throwaway ids, small real amounts, and the exact recorded steps.
2. **Publish the holder surfaces (item 50) and run the full ceremony (road step 10) with the real collection.** The redeem page, `/vault/`, `/claim/`, `/buy/`, and ceremony are built and staged but not published; the pages are the only preventive control for undeclared airdrops and nested vaults (items 9 and 44). The ceremony must create the collection, initialize, and lock the programs. Test the full end-to-end flow (including the redemption poster) with real holders before the lock.
3. **Fund and verify the operator wallet, revenue address, pool ATA, and Squads ATA before the first split (item 52).** The revenue address starts at 0 lamports; a first royalty below rent fails. The pool and Squads cbBTC ATAs must exist before `split_revenue`. The operator wallet must hold only cycle funds and its 0.02 SOL float (nothing on chain enforces this). Do this after step 10 and before any paid mint.
4. **Re-run the full suite, e2e, sim, swap-fork, and mainnet probe on the final tree after every change, including the rehearsal driver and any repair.** The current suite is 912/912 on-chain + 1032 detectors + 132 e2e + 71 sim + 16 swap-fork + 4 expiry-budget + 68 launch + 35 live-mainnet. Any change to `programs/`, `bank/`, or `scripts/` resets the freeze counter; the final confirmation round must be launch-clean on the locked tree.
5. **Publish the holder guide only after item 50 ships, and record every accepted limit in it.** The guide is still DRAFT and speaks of the surfaces in the present tense. It must list every accepted limit (9, 10, 13, 25, 26, 27, 28, 32, 36, 39, 40, 41, 43, 44, 45, 46, 47, 48, 49, 55, 56, 57, 58, 59) exactly as stated, with the honest list for buyer-facing risks.

These are the concrete steps AI audit structurally cannot do: live mainnet dress rehearsal at scale, publication of the surfaces, funding/verification of production accounts, and the final ceremony/lock on the real network. Do them before removing the upgrade authority.