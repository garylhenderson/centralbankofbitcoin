# Round 47 Independent Audit — Programs Pass

## R0. Round 46 Verdict and Repairs

I verified each V46 repair against the code at this head. All eight program-pass findings and all five off-chain findings appear repaired. The post-round-46 mainnet rehearsal faults also appear fixed.

**V46-1 (multi-send steps resumable):** Repaired. `rehearsal-steps.mjs` now defaults `resumable: !isSingleSend(name)` via the `SINGLE_SEND_STEPS` list. Steps not in that list (sale-round, deposit-activate, revenue-cycle-n, ceremony-collection, crack, sweep-back, close-n, upgrade-n) are resumable. The collection step's `done()` calls `findCollection()` and `readStep()`, both chain reads.

**V46-2 (values re-filled before step 10):** Repaired. The `ceremony-values` step re-fills `charter_opens_at` and `init_authority` right before road step 10, re-judges with `judgeRehearsal`, and carries `{ recheck: true }`. The main loop's recheck logic re-runs the step if its read-back no longer holds.

**V46-3 (rescue records nest):** Repaired. The rescue step sets `st.nestedSent = true` when vault-3 is found at the nest PDA or the treasury, before any send.

**V46-4 (hand recovery after landed swap):** Repaired. `rehearsal-recover.mjs` checks `handClosed()` first, and when `pendingSwapSig` landed, continues with the return and split (each skipped if already landed).

**V46-5 (mainnet-local refuses overrides):** Repaired. `web/build.mjs` and `web/src/config.js` both key the refusal on `takesOverrides(P)` which returns false when `launchJudge === 'mainnet'`. Since `mainnet-local` inherits `launchJudge: 'mainnet'`, overrides are refused.

**V46-6 (NOT READY on refused values):** Repaired. `ceremony.mjs` preflight returns null after the value checks if `fails.length > 0`, before reaching the mint reads.

**V46-7 (SPEC 53 records re-proof):** Repaired. SPEC item 53 now records the `e7c192a` re-proof and states what keeps it open.

**V46-8 (mainnet rehearsal init key):** Repaired. `initKeyFor` returns `INIT_SHIPPING` (Gary's wallet) on mainnet. `judgeInitAccount` preflights that the init key can pay. The driver refuses before `fund-deployer` if the check fails.

**Post-round-46 fixes:** The REHEARSAL-OPEN status preservation, Lighthouse/compute-budget judge, per-program token listing, show-my-vaults, and Core watch all appear in the code. The stripped bytes and verifiable build workflow are new and appear correct.

**No confirmed defect in the five programs.** Program source equals `RELEASE_COMMIT` `d2ae5fc` (round 35's `0b3ddb3` source, stripped build).

---

## R1. Custody

I traced the full redemption path: SEAL `open_for_redemption` → Core `ExecuteV1` → sweep helper → BURN `burn_vault` → MINT `retire_redeemed`.

**Pairing:** Both SEAL and BURN walk the instructions sysvar using `load_current_index_checked` / `load_instruction_at_checked`, which see only top-level instructions. SEAL requires a matching `burn_vault` (same asset at index 0, same owner at index 2) later in the transaction. BURN requires a matching `open_for_redemption` (same asset at index 0, same owner at index 2) earlier. CPI-wrapped instructions are invisible to these walks, tested in suite arms WR.1–WR.4. Two vaults in one transaction can't borrow each other's open/burn because both asset and owner are bound.

**Thaw-without-burn:** Impossible. If the burn fails or is absent, the whole transaction reverts, including the thaw. The asset stays frozen.

**Burn-without-thaw:** Impossible. BURN refuses `NoPrecedingOpen` if no matching open is found. The asset must be thawed for the sweep to work, and thawing requires the open.

**Emptiness proof:** BURN checks PDA lamports == 0, all reserve ATAs declared and empty (both token programs), no delegates, no Token-2022 extensions, no live Core assets. The sweep helper closes what it empties, so closed accounts pass the owner check (not owned by a token program → skipped).

**No issues found.** The custody model is sound.

---

## R1s. Sweep Helper

**(a) Access control:** The helper requires `signer.is_signer`. The signer is the asset-signer PDA, which can only sign through Core's `ExecuteV1`. Core's `ExecuteV1` requires the asset owner's signature and checks the `PermanentFreezeExecute` plugin. The asset is only thawed by `open_for_redemption`, which requires a matching burn. So only the owner, during a redemption, can invoke the helper. Suite arms SR.5/SR.5a confirm strangers and delegates are refused by Core (`NoApprovals`, 0x1a).

**(b) Pair list:** Duplicate sources fail on the second read (closed account → `InvalidAccountData`). A source that's also a destination fails the owner check (`signer.key != dest.key`). Native wSOL accounts are treated as regular token accounts (safe). Frozen sources cause the SPL transfer to fail, reverting the transaction (SR.14). Zero pairs means lamports-only sweep (SR.13).

**(c) Destination:** The destination wallet is chosen by the transaction builder, but only the owner can sign `ExecuteV1`. The owner chooses where their own funds go. Safe.

**(d) Lamport sweep:** The helper transfers all lamports from the signer to the destination. BURN then checks `asset_signer.lamports() == 0`. Since instructions execute sequentially in a transaction, nothing can add lamports between the sweep and the burn. Safe.

**(e) BURN interaction:** Closed accounts pass BURN's check because they're no longer owned by a token program (skipped). Non-ATA accounts can be swept if named, but BURN only checks ATAs — this is the known completeness gap (accepted limit).

**(f) Fits:** Suite S8.0 measures the three-asset redemption at 1,061 bytes, with room for compute-budget and separate fee payer.

**(g) Evidence:** Suite arms SR.0–SR.14 and sim S8.0–S8.3 cover the helper. The helper is byte-identical between mainnet and localnet builds (no INIT_AUTHORITY).

**No issues found.**

---

## R2. Community Pool

I verified the pool invariant `pool_balance >= ceil(owed_scaled / ACC_SCALE)`:

- `split_revenue` increases pool balance without changing `owed_scaled`. Invariant holds.
- `distribute` increases `owed_scaled` by at most `avail = balance - ceil(owed_scaled_before)`. After distribute, `ceil(owed_scaled_new) = balance`. Invariant holds.
- `claim` decreases both pool balance and `owed_scaled` by the paid amount. Invariant holds.
- `retire` decreases `owed_scaled` by the vault's pending amount without changing pool balance. Invariant holds.

**JoinWaitingFirst:** No distribution while a vault eligible to join is waiting. Prevents first-activator attack. Suite 3c.A4b.

**Two-step activation:** Request → join after next distribution. Prevents activate-then-distribute-in-one-transaction. Suite 3c.A6.

**Frozen pool:** `retire_redeemed` forfeits the undelivered share when the pool is frozen. Suite 3c.F0–F3.

**No issues found.**

---

## R2b. $CBOB Boost

**Exactly N distributions:** A boost ends at `dist_epoch + epochs`. The distribution reaching `boost_end_epoch` makes it due. `BoostsExpireFirst` refuses the next distribution until expiry. So the boost earns exactly N distributions.

**No loss/gain on weight change:** `reweigh` moves the owed share to `carry_scaled` and resets `debt_scaled`. Total owed is preserved. Verified algebraically.

**No double expiry:** `expire_boost` requires `boost_weight > 0`. After expiry, `boost_weight = 0`. Second expiry fails.

**Ring wrap:** Boost max duration is 63 (BOOST_RING - 1), so two live boosts can't end at the same epoch. Host unit test tests the ring wrap across 260 epochs.

**Counters:** Suite BO section and host unit tests verify `boosts_active`, `boosts_due`, `boost_weight_total`, and the ring agree.

**No issues found.**

---

## R3. Level Draw

The draw uses `sha256(hA || hB || hC || asset)` where A, B, C are slot hashes from three different leader groups. The minter can't choose their level (slot hashes don't exist at mint time). The FIFO prevents order manipulation. Missed windows are rescheduled, never defaulted.

The last-contributor residual (C's leader can grind) is accepted limit 26. The re-roll-on-lapse is accepted limit 25.

**No issues found.**

---

## R4. Governance

One vault one vote via `VoteRecord` PDA at `["vote", proposal, asset]`. Electorate fixed at creation. Quorum (21%), threshold (51%), and 10% YES turnout all checked. Key changes need 50% of all live vaults. Guardian and swap operator can't share a proposal. Overtaken actions are skipped, not reverted.

Governance freeze via stolen guardian key is accepted limit 47.

**No issues found.**

---

## R5. Charter Claim

Merkle proof is domain-separated (0x00 leaf, 0x01 node) and sorted. JS and Rust implementations match. PoB must be owned by the signer, in the Merkle tree, and is burned by CPI. Window is checked by clock. Not gated by guardian's stop.

The hot collection key risk is accepted limit 46.

**No issues found.**

---

## R6. One-Time Configuration

All four `initialize` functions check `INIT_AUTHORITY`, enforce bounds, and write to `init` PDAs (one-time). Key bounds verified:
- `max_supply > 0`, `level_caps` each > 0 and sum ≤ max_supply
- `monthly_secs` 60s–30d, `notice_secs` 60s–30d, `redeem_window_secs` 10s–24h
- `max_sweep_lamports` 1–50 SOL, `sweep_cooldown_secs` 1s–24h
- `sweep_floor_lamports` ≥ 0.1 SOL, `reserve_ceiling_lamports` ≤ 10 SOL
- `max_boost_weight` 1–12, `max_boost_epochs` 1–63

The royalty plugin is installed with `PLUGIN_AUTHORITY_NONE`, making it immutable in Core.

**No issues found.**

---

## R7. Cross-Program Raw Reads

I recomputed every offset from the struct definitions:

**MintConfig (46 fields, 1,261 bytes with padding):** All offsets match. Key reads: governance@41, minted_total@141, bare_burns_retired@454, charter_closes_at@442, sales_stopped@191, sweep_stopped@192, sales_stopped_at@518, sweep_stopped_at@526, sweep_floor@631, cooldown_ceiling@639, reserve_ceiling@647, max_boost_weight@711, max_boost_epochs@712.

**VaultRecord (221 bytes):** version@8, asset@9, mint_index@41, level@57, active@125, retired@126, pending@177, boost_weight@186, boost_end_epoch@187, carry_scaled@195.

**BurnConfig (827 bytes):** version@8, collection@9, bump@41, burned_total@42, redeem_window_secs@50, rate_head@58, rate_ring@59.

**SealConfig (398 bytes):** version@8, collection@9, reserve_mints@41 (u32 length + keys).

**GovConfig (350 bytes):** version@8, collection@9, quorum_bps@41, threshold_bps@43, min_voting_secs@45, proposal_count@53, bump@61, last_round_id@62, last_guardian_id@70, last_arm_id@78, last_boost_id@86.

**Sweep helper token reads:** mint@0, owner@32, amount@64, length 165. Matches SPL Token layout.

All discriminators are pinned and asserted in the suite. All versions are pinned.

**No issues found.**

---

## R8. Suite, Simulation, and Build

The suite has 912 assertions, all with `because()` reason pins. The simulation has 71 assertions. The build proves which INIT_AUTHORITY each binary carries by deploying both builds and testing behavior.

The sweep helper is proven byte-identical between mainnet and localnet builds. The stripped bytes are proven identical to solana-verify's container output.

I reviewed the suite for vacuous arms and wrong-reason rejections. The `because()` pins, the `att()`/`attP()` error capture, and the explicit precondition checks (`rec('...p', ...)`) provide strong evidence that arms fire for the right reasons.

**No issues found.**

---

## Accepted Limits — Four Questions

**1. Is any limit WORSE than stated?**

I reviewed all accepted limits against the code. None appears worse than stated. The key ones:

- Limit 40 (Core upgradeable): The three named consequences (redemption refuse, level queue halt, ExecuteV1 authority widening) are all accurate. The sweep helper's access control does rest on Core's `ExecuteV1` authority rule, as stated.
- Limit 47 (stolen guardian): The "permanent at low turnout" statement is accurate. Replacing the guardian needs 50% of all live vaults snapshotted at creation.
- Limit 32 (rate limit): The rolling window implementation matches the description. The ring bounds the cap at 64, which is stricter than intended for live supply > 3,047, never looser.

**2. Is anything listed as a limit not actually a limit?**

No. All accepted limits correspond to real code behavior or real external dependencies.

**3. Is any DISCHARGED item not actually discharged?**

I spot-checked the discharged items. The Bank-related items (1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24) are discharged because the Bank no longer exists. The compute-related items (12/17, 54) are discharged by measurement. Item 51 ($CBOB boost) is discharged by implementation.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

Items 22, 38, 50, 52, 53 are all still marked OPEN AND BLOCKING. The mainnet dress rehearsal (item 22) has run (RECORD.md exists), but item 22.2 is recorded FAIL due to the Core upgrade during the rehearsal. This is honest reporting, not quiet acceptance.

---

## Anything Else

**Stripped bytes and verifiable build:** The change to stripped bytes (d2ae5fc) is a build-process change, not a program-logic change. Stripping removes the symbol table only; instructions are unchanged. The verifiable build workflow provides reproducibility evidence. No security impact.

**README facts generator:** The README's facts block is generated and checked by `run-tests.sh`. The facts match the code. No issues.

**Core watch:** `scripts/core-watch.mjs` is mentioned but not in this bundle. I note this as a verification gap for the off-chain pass.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **Run the full certifying suite one final time at the exact commit that will be deployed.** The suite, simulation, swap fork, and all selftests must pass at the deployment commit, not a nearby commit. The `run-tests.sh` floors enforce this, but the commit must be exact.

2. **Verify the deployed bytes match `dist/SHA256SUMS` after deployment.** Use `solana program dump` for each of the five programs and compare the first `len` bytes against the corresponding `dist/` file's hash, with all remaining bytes zero. Do this before removing the upgrade authority.

3. **Complete the remote verification submission.** Upload the verification parameters with `solana-verify` for each program, signed by the upgrade authority, before `--final`. Confirm the remote job reproduces the deployed bytes. This provides third-party reproducibility evidence that doesn't depend on this repository's CI.

4. **Resolve item 22.2.** The alarm pass 2 FAIL due to the Core upgrade is a true detection, but it means the rehearsal didn't complete item 22.2 cleanly. Either re-run the alarm passes after re-baselining to the new Core, or document why the FAIL is acceptable evidence. The current RECORD.md is honest but incomplete.

5. **Confirm the charter window timing.** The rehearsal showed that the charter clock starts before the deploys. Ensure the mainnet ceremony fills `charter_opens_at` with enough lead time for all steps, and that the `ceremony-values` recheck fires if the window gets too close.

6. **Do not remove the upgrade authority until all five programs are verified, the remote verification is confirmed, and the ceremony has completed.** The upgrade authority is the only recovery path if a deployment goes wrong. Once removed, there is no recovery.

7. **Keep the Core watch running from the moment of deployment.** Metaplex upgraded Core three times in five weeks before launch. The watch must be live before any vault holds value, not after.