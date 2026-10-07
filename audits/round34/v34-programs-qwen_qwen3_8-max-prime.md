# Round 34 Independent Audit — CBOB Vaults v6

## R0. ROUND 33 VERDICT VERIFICATION

I independently verified round 33's four confirmed findings against the current tree. All four repairs are present and correct:

**L1 (pre-funded program id):** Road step 9 now includes the pre-deploy read and measured recovery path. Verified in SPEC.

**D1 (SPEC REDEEMING step 1):** Now states limit 42's measured sizes correctly. Verified.

**D2 (DESIGN MIN_ROUND_PRICE_SATS):** Now says "fixed in the program" (compile-time constant at `lib.rs:477`). Verified.

**D3 (suite arm 2.1):** Now records `vMint.ok?'ALLOW':'REJECT'` against `'ALLOW'`. Verified.

**Gate-5 obligations:** R33.G1 (worst single-signature reveal), R33.G2a/G2b (many-signer autograph), R33.G3 (None-authority re-delegation), R33.G4 (pre-filled wSOL) are all present in the suite. Floor moved 861→866. Verified.

**Round 33's refutations (W1, W2):** I independently confirmed the many-signer autograph heap boundary and the None-authority Royalties re-delegation refusal by reading the suite arms R33.G1/G2a/G2b/G3 and the cpi-wrapper's `SIGSPDA!` mode. The logic is sound: Core's fixed 32 KiB heap exhausts on the signers' own update before MINT's reveal CPI data cap is reached, and the reveal lands at every tested maximum.

No round 33 finding was incorrectly disposed.

---

## R1. CUSTODY

I verified the open↔burn pairing, the emptiness proof, and the instruction-sysvar walks.

**Pairing:** Both `open_for_redemption` and `burn_vault` walk the instructions sysvar using `load_current_index_checked` and `load_instruction_at_checked`, which see only top-level instructions. Each binds asset AND owner at the correct account indices (0 and 2). CPI-wrapped instructions are invisible to the sysvar walk. Suite arms WR.1–WR.4 confirm the wrapper attacks are refused. I verified the discriminator constants match the Anchor derivations (suite arms 3.1a–3.1s).

**Emptiness proof:** BURN checks PDA lamports == 0, every reserve mint's ATA under both token programs is declared, PDA-owned, undelegated, extension-free, and empty. The second loop checks all declared accounts for PDA-owned token accounts. The sweep helper closes every account it empties. I verified the token account field offsets (mint 0, owner 32, amount 64, delegate COption 72, state 108, delegated_amount 121, close_authority 129) against the SPL Token layout.

**No surviving thawed vault:** The open requires a burn later in the transaction. The burn requires an open earlier. If the burn fails, the open reverts with it (atomic transaction). If the open succeeds but the burn fails for any reason (emptiness, rate limit, etc.), the whole transaction reverts. There is no path where a thawed vault survives the transaction.

No new findings.

---

## R1s. SWEEP HELPER

I verified the sweep helper's access control, pair validation, and lamport sweep.

**(a) Access control:** The helper requires `signer.is_signer`. Called directly, nobody can sign for the asset-signer PDA (it's a PDA). Through Core's `ExecuteV1`, Core checks the authority. Suite arms SR.5/SR.5a/SR.5c confirm that strangers, transfer delegates, and collection update authorities are refused with `NoApprovals` (0x1a). SR.5b confirms the CBOB collection authority is MINT's off-curve PDA. I verified Core's ExecuteV1 authority rule by reading the suite evidence.

**(b) Pair list:** Source must be owned by the signer (asset-signer PDA). Destination must be owned by the dest wallet and have the same mint. Duplicate sources fail on the second read (closed account has 0 data). Source ≠ destination because they have different owners (signer ≠ dest, checked). I verified all refusal branches against the suite arms SR.6–SR.14.

**(c) Destination checks:** The dest wallet is chosen by the caller. The helper doesn't compare it with the asset's owner. This is safe because the caller IS the owner (through Core's ExecuteV1). The lamport sweep to a non-existent dest below rent exemption fails, which is documented (SPEC item 50, "A lamports-only sweep needs a destination that exists"). Suite arm R27.S1 confirms lamports can be credited to a non-System-owned destination without corrupting its data.

**(d) Lamport sweep:** `signer.lamports()` is read at execution time. The system transfer moves all lamports. Within a single instruction, nothing can change between the read and the transfer. BURN's `lamports == 0` check runs after the sweep, in the same transaction. No instruction can deposit lamports into the PDA between the sweep and the burn (the sweep and burn are in the same atomic transaction).

**(e) BURN interaction:** Closed accounts pass BURN's reserve check because they're system-owned (not token-program-owned), so the `continue` skips them. If a reserve ATA doesn't exist when the page builds the transaction, the page must create it in a prior transaction (item 42). A stranger can create a classic ATA permissionlessly, but the page's prior-transaction creation prevents this race. Non-ATA token accounts and Token-2022 accounts are covered by item 44 (accepted limit).

**(f) Packet size:** S8.0 measures 1,061 bytes for the three-asset redemption through the helper. The suite reserves room for compute-budget instructions and a separate fee payer. Verified.

**(g) Evidence:** All SR arms have pinned refusal reasons. The helper is deployed from the same bytes the suite ran (build-mainnet.sh cmp's the helper's mainnet bytes against the localnet build). Verified.

No new findings.

---

## R2. COMMUNITY POOL

I verified the pool invariant, the two-step activation, the join gate, and the monthly in-line run.

**Pool invariant (balance ≥ ceil(owed)):** I traced the arithmetic through `distribute` (credit), `claim`, `join`, `retire`, and `reweigh`. The key insight: `credit` adds `delta * w` to `owed_scaled` where `delta = floor(avail * ACC_SCALE / w)`, so `delta * w ≤ avail * ACC_SCALE`, preserving the invariant. `claim` pays `pay = pending / ACC_SCALE` and reduces `owed_scaled` by `pay * ACC_SCALE`, preserving the invariant. `retire` subtracts the vault's pending from `owed_scaled`, preserving the invariant. Suite arm P.32 asserts the invariant after every money operation.

**Two-step activation:** `activate` first requests (sets `pending = true`, `request_epoch = dist_epoch`). The vault joins only when `dist_epoch > request_epoch` (checked in the second `activate` call or in `claim`). The `JoinWaitingFirst` gate prevents distributions while any eligible vault waits. I verified the `pending_count` / `pending_this_epoch` arithmetic under all orderings (request, join, retire in same/different epochs). The `waiting_to_join = pending_count - pending_this_epoch` computation cannot underflow because both counters are incremented together and `pending_this_epoch` is reset to 0 in `advance_epoch`.

**Monthly in-line run:** `monthly_inline` is called in every host instruction before the host's main logic. It checks the pool account, frozen state, `boosts_due`, `waiting_to_join`, and `total_active_weight`. It never refuses its host (returns Ok for all "not due" or "blocked" cases). The only refusal is `WrongPool`. I verified the frozen-pool check prevents crediting from a frozen pool.

**Frozen pool forfeit:** `retire_redeemed` checks `pool_is_frozen` and sets `forfeit = true`. The `ClaimBeforeBurn` check is skipped when `forfeit` is true. The pending amount is subtracted from `owed_scaled` (returned to the pool). Suite arms 3c.F0–F3 verify this. I verified the arithmetic preserves the pool invariant.

No new findings.

---

## R2b. $CBOB BOOST

I verified the boost ring, the reweigh carry, the expiry gate, and the BoostsExpireFirst invariant.

**Ring wrap:** The ring has 64 slots. A boost lasts at most 63 distributions (`MAX_BOOST_EPOCHS_BOUND = 63`). Since `end = dist_epoch + epochs` with `epochs ≤ 63`, the end slot `(end % 64)` can never equal the current slot `(dist_epoch % 64)` (that would require `epochs % 64 == 0`, i.e., `epochs = 64`). I verified this arithmetic and confirmed the host test `the_boost_ring_wraps_exactly_against_a_model` covers 1000 epochs with random buys and expiries.

**Reweigh carry:** `reweigh` moves the owed amount to `carry_scaled` and resets `debt_scaled = new_weight * acc`. I verified that `owed_of` returns the same value before and after `reweigh`: `new_weight * acc + owed - new_weight * acc = owed`. The boost's expiry calls `reweigh(c, r, 0)`, which correctly removes the boost weight while preserving the owed amount.

**BoostsExpireFirst:** `distribute` and `monthly_inline` check `boosts_due == 0` before crediting. `claim` and `expire_boosts` expire due boosts. I verified that a due boost is expired at the correct accumulator value (the one its last distribution left), because no distribution runs between the boost becoming due and its expiry.

**Buyer's terms:** `boost_vault` checks `price <= max_price && extra >= min_weight && epochs >= min_epochs`. A vote moving terms against the buyer (price up, weight down, epochs down) refuses with `BoostTermsMoved`. A move in the buyer's favour lands at the new terms. I verified the one-sided rule.

No new findings.

---

## R3. LEVEL DRAW

I verified the entropy capture, the FIFO reveal, the reschedule, and the SlotHashes parsing.

**SlotHashes parsing:** `blockhash_in_window` validates the sysvar account (key, count ≤ 512, data length, non-zero hash). It finds the smallest produced slot in `[want, want + 64]`. I verified the layout parsing (u64 count, then 40-byte entries of slot + hash).

**Three-group entropy:** `try_capture` finds three slot hashes from three different leader groups (stride of 2 groups = 8 slots). The entropy is `sha256(hA || hB || hC || asset)`. I verified the group alignment arithmetic and the host tests covering skips at A, B, and C.

**FIFO:** `reveal_level` checks `index == config.revealed_total`. This ensures reveals happen in mint order. A burned vault still takes its draw (the Core plugin update is skipped, but the record is updated). I verified the burned detection (Core-owned, 1 byte, key 0).

**Reschedule:** `reschedule_reveal` requires the window to have passed (`now > reveal_slot + 300`). The new target is `now + 16` (a future slot). The reschedule is logged with `CBOB_REVEAL_RESCHEDULED`. I verified the crank also reschedules (in `crank()`).

No new findings.

---

## R4. GOVERNANCE

I verified the snapshot, the quorum/threshold/turnout checks, the key-change supermajority, and the per-kind ordering.

**Snapshot:** `create_proposal` snapshots `minted_total` (for `index_snapshot`) and live supply (for `quorum_supply`). Votes are restricted to vaults with `mint_index < index_snapshot`. I verified the `VaultTooNew` check.

**Quorum/threshold/turnout:** `execute_proposal` checks `cast >= ceil(quorum_bps * quorum_supply / 10000)`, `yes_bps >= threshold_bps`, and `yes >= ceil(10% * quorum_supply)`. I verified the ceiling division arithmetic (using `+ 9999` before dividing by 10000).

**Key change:** Guardian changes and swap operator arms require `yes >= ceil(50% * quorum_supply)`. The two can't share a proposal (`KeyChangesBundled`). I verified the `KEY_CHANGE_YES_BPS = 5000` check.

**Per-kind ordering:** `execute_proposal` uses per-kind marks (`last_round_id`, `last_guardian_id`, `last_arm_id`, `last_boost_id`). Overtaken actions are skipped and logged, not reverted. I verified the `CBOB_ACTION_SKIPPED` logic.

**Restart/StopIsNewer:** GOV splits the restart into sales and sweep halves, skipping each half independently if the stop is newer. MINT re-checks with `sales_stopped_at < proposal_created_at`. I verified the `>=` tie-breaking (stop in the same second as the proposal wins).

No new findings.

---

## R5. CHARTER CLAIM

I verified the Merkle proof, the PoB burn, the window check, and the `pob_extra` pass-through.

**Merkle proof:** Leaf = `sha256(0x00 || pubkey)`, node = `sha256(0x01 || min(a,b) || max(a,b))`. Domain separation prevents second-preimage attacks. Sorted pairs eliminate direction bits. I verified the `merkle_root_from` function and the JS implementation in `pob-merkle.mjs`.

**PoB burn:** The PoB is burned by CPI in the same instruction. The owner must sign. The PoB must be a live Core asset in the right collection, owned by the signer, and a leaf of the Merkle root. I verified all checks.

**Window:** `claim_charter_vault` checks `now >= charter_opens_at && now < charter_closes_at`. Not gated by the guardian's sales stop. I verified the clock-only check.

**pob_extra:** Up to 8 extra accounts are passed to Core's `BurnV1`. They're never signers (explicitly set to `false`). I verified the `BadPobExtra` check and the suite arms OR.1–OR.6.

No new findings.

---

## R6. ONE-TIME CONFIGURATION AND TRUSTED HOP

I verified all `initialize` functions and the sweep bounds.

**MINT initialize:** Checks authority, $CBOB mint validity, boost bounds, supply, treasury, notice, sweep bounds, level caps, charter window, PoB root, monthly period, collection cleanliness, SEAL wiring, payment mint as reserve. I verified all checks and the Royalties plugin installation (10%, authority None).

**SEAL initialize:** Checks authority, reserve mints (1–3, classic SPL). I verified the `assert_classic_spl` function (checks owner only, not mint structure — documented as item 38's checker responsibility).

**BURN initialize:** Checks authority, SEAL wiring, redeem window (10s–24h). I verified the `WiringDiverged` check.

**GOV initialize:** Checks authority, MINT wiring, quorum/threshold/voting bounds. I verified the `ForeignVault` check.

**Sweep bounds:** `sweep_sol_for_swap` checks `amount > 0`, `amount <= max_sweep_lamports`, cooldown, reserve. The operator must sign. I verified the `SweepAboveCap`, `SweepTooSoon`, and `ReserveWouldBreach` checks.

**Redemption cap:** Rolling window over 64-slot ring. I verified the `rate_head` arithmetic and the k-th most recent check. The cap is `ceil(live * 210 / 10000)` with floor 1, capped at 64 by the ring.

No new findings.

---

## R7. CROSS-PROGRAM RAW READS

I recomputed every offset from the struct definitions.

**MintConfig (version 6):** I traced all 50+ fields from offset 8 through `boost_expiring` at offset 749. All GOV offsets (41, 9, 141, 454, 442, 191, 192, 518, 526, 631, 639, 647, 711, 712, 257, 266, 274) and BURN offsets (141, 454) match the struct layout. Verified.

**VaultRecord (version 4):** I traced all fields from offset 8 through `carry_scaled` at offset 195. GOV offsets (8, 9, 41) match. Verified.

**Seal Config (version 2):** version at 8, collection at 9, reserves at 41. MINT and BURN offsets match. Verified.

**BurnConfig (version 4):** version at 8, collection at 9, bump at 41, burned_total at 42. GOV offsets (8, 42) match. Verified.

**Sweep helper token reads:** mint at 0, owner at 32, amount at 64, state at 108, length 165. Matches SPL Token layout. Verified.

**Account spaces:** `MINT_CONFIG_SPACE` = 8 + 1 + 32×3 + 4 + 8 + 8 + 8 + 4 + 4 + 8 + 8 + 32 + 2 + 1 + 1 + 32 + 32 + 8 + 1 + 8 + 8 + 8 + 4×5 + 4×5 + 8 + 32 + 32 + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 16 + 16 + 8 + 8 + 8 + 32 + 8 + 8 + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 32 + 1 + 2 + 8 + 1 + 2 + 4 + 4 + 8 + 8 + 4×64 + 256 = 1261. I verified this matches the struct. `VAULT_RECORD_SPACE` = 221. `BurnConfig` space = 827. Verified.

No new findings.

---

## R8. SUITE, SIMULATION, AND BUILD

I verified the suite structure, the simulation, and the build evidence.

**Suite:** 866 assertions with floor equal to count. All refusal arms have pinned reasons (`because()` calls). I verified the `ID.1` uniqueness check. The suite runs against real cloned Core, real SPL tokens, and the pinned token programs.

**Simulation:** 71 assertions with floor 71. Uses real mainnet Core, cloned cbBTC/$GARY/$GIRAFFISH mints, and two real Proof of Burn assets. S8.0 measures the three-asset redemption through the helper at 1,061 bytes. S9b exercises v0 with a lookup table.

**Build:** `build-mainnet.sh` deploys both mainnet and localnet builds, asks each whether it trusts the test key, and cmp's the sweep helper's bytes. The mainnet build must REJECT the test key; the localnet build must ACCEPT. The helper's mainnet bytes must be identical to the tested localnet bytes and the target/deploy bytes.

**Arms that cannot fail:** Round 33's D3 (arm 2.1) has been fixed. I checked for other arms that might be vacuous. The `R31.W2b` arm records `vMint.ok` and `vAta.ok`, which are the actual outcomes. The `R33.G1/G2a/G2b` arms check real on-chain state after reveals. I found no remaining vacuous arms.

No new findings.

---

## ACCEPTED LIMITS — FOUR QUESTIONS

### 1. Is any limit WORSE than stated?

I checked each accepted limit against the code.

**Limit 26 (C's leader grinding):** The SPEC states C's leader can choose among many draws. I verified the `blockhash_in_window` function finds the smallest produced slot in `[want, want + 64]`, which is what the SPEC describes. The leader can skip slots within its 4-slot group and vary block contents. The SPEC's characterization is accurate.

**Limit 28 (Coinbase freeze):** The SPEC states a frozen vault account blocks the whole redemption. I verified BURN requires every reserve account empty, and a frozen account can't be emptied (the token program rejects transfers from frozen accounts). The SPEC's characterization is accurate.

**Limit 40 (Core upgradeable):** The SPEC names three concrete consequences. I verified all three: (1) MINT proves burns by Core's 1-byte tombstone, (2) `revealed_total` requires Core's `UpdatePluginV1`, (3) the sweep helper's access control is Core's `ExecuteV1` rule. The SPEC's characterization is accurate.

**Limit 47 (stolen guardian):** The SPEC states the stop is permanent at low turnout. I verified `KeyChangeNeedsHalf` requires YES from ceil(50% of snapshotted live supply), not votes cast. At turnout below 50%, the replacement can't pass. The SPEC's characterization is accurate.

No limit is worse than stated.

### 2. Is anything listed as a limit not actually a limit?

**Limit 17 (compute units):** DISCHARGED by measurement. I verified the suite arms 10.1–10.6b measure CU on landed transactions. The byte wall binds before the compute wall. Correctly discharged.

**Limit 33 (swap operator notice):** DISCHARGED by stage 3c. I verified suite arms 3c.K5 and 6.20g exercise the apply and early-apply refusal. Correctly discharged.

No incorrectly discharged items found.

### 3. Is any DISCHARGED item not actually discharged?

I checked all DISCHARGED items. Each has a named measurement or removal reason. The Bank-related items (1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24) are correctly discharged because the Bank no longer exists. The compute items (12/17) are correctly discharged by measurement. The boost item (51) is correctly discharged by the suite section BO.

No incorrectly discharged items found.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**Item 22 (dress rehearsal):** Still OPEN. The SPEC correctly states it must be exercised before paying anyone. Not treated as accepted.

**Item 38 (initialize values):** Still OPEN. The SPEC correctly states every value must be ruled before deploy. `charter_opens_at` and `lock_deadline` are still null in `mainnet-init.json`. Not treated as accepted.

**Item 50 (holder surfaces):** Still OPEN. The SPEC correctly states the redeem page must exist before the lock. Not treated as accepted.

**Item 52 (pool/Squads accounts):** Still OPEN. The SPEC correctly states the accounts must exist before the first split. Not treated as accepted.

**Item 53 (rehearsal tree):** Still OPEN. The SPEC correctly states the rehearsal must be re-run at the release commit. Not treated as accepted.

No OPEN items are being quietly treated as accepted.

---

## FINDINGS

**No CRITICAL findings.**

**No HIGH findings.**

**No MEDIUM findings.**

### LOW-1: `expire_boosts` error message reuses `BadClaimList`

**Construct:** `programs/cbob-vault-mint/src/lib.rs`, `expire_boosts`, line ~1534.

**What:** `expire_boosts` uses `MintError::BadClaimList` for its empty/oversized remaining-accounts check, but the error message says "claim takes [SlotHashes, records...] when cranking, then (record, cbBTC account) pairs", which describes `claim`, not `expire_boosts`. A caller who hits this error sees `claim`'s description.

**Evidence:** The error enum at line ~2874 defines `BadClaimList` with the claim message. `expire_boosts` at line ~1534 uses `require!(!rem.is_empty() && rem.len() <= MAX_EXPIRE_BATCH, MintError::BadClaimList)`.

**Impact:** Diagnostic confusion only. The code is correct; only the error message is misleading. No value path.

**Fix:** Add a dedicated error variant (e.g., `BadExpireList`) with a message describing `expire_boosts`'s expected accounts. This is a program change, so it must happen before the lock.

### INFO-1: `split_revenue` `decimals` parameter is caller-supplied

**Construct:** `programs/cbob-vault-mint/src/lib.rs`, `split_revenue`.

**What:** The `decimals` parameter is passed by the caller and used in the `TransferChecked` CPI. The program does not validate it against the mint's actual decimals. The token program's `TransferChecked` instruction verifies decimals, so a wrong value causes the token program to reject the transfer. This is safe but means the error comes from the token program rather than MINT.

**Evidence:** `split_revenue` takes `decimals: u8` and passes it directly to the `TransferChecked` data. No check against `ctx.accounts.mint` data.

**Impact:** None. The token program's check is sufficient. A wrong `decimals` value causes a token program error, not a MINT error. The split fails safely.

**Fix:** Optional. Could read the mint's decimals and validate, but the token program already does this. Not a defect.

### INFO-2: SEAL `assert_classic_spl` checks owner only, not mint structure

**Construct:** `programs/cbob-vaults/src/lib.rs`, `assert_classic_spl`.

**What:** The function checks that each reserve mint account is owned by the SPL Token program but does not verify it is actually a mint (82 bytes, initialized). A token account owned by the SPL Token program could theoretically be passed. This is documented in SPEC item 38 ("SEAL reads only owners") and covered by the launch checker.

**Evidence:** `assert_classic_spl` only does `require_keys_eq!(*acc.owner, SPL_TOKEN_ID, ...)`.

**Impact:** None in production (the launch checker pins the ruled three mints). A wrong account at `initialize` would cause BURN to derive incorrect ATAs, making redemptions fail. But `initialize` is a one-time operation gated by the launch checker.

**Fix:** Not needed. The launch checker covers this. Documented as item 38.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

The AI audit process has been thorough across 34 rounds, three red-team passes, and extensive measurement. The code is well-structured, invariants are maintained, and the suite provides strong evidence. However, the following structural gaps remain that AI audit cannot close:

1. **The dress rehearsal (item 22) has never run against a live chain.** The crank, alarm, and revenue cycle have only been tested on local validators. The interaction with real RPC latency, rate limits, and network conditions is untested. This must be completed before any real value is at risk. The rehearsal must include the named items: live crank passes, alarm passes, one full revenue cycle through each pool, and one forced post-sweep failure with hand recovery.

2. **The holder surfaces (item 50) do not exist.** The redeem page that runs `judgeRedemptionCoverage` before the holder signs is the only preventive control for undeclared airdrops and nested vaults (items 9 and 44). Until it exists, holders who redeem by any other client destroy undeclared holdings with no warning. The deposit-address page is also missing. These must be built and audited before the lock.

3. **The initialize values (item 38) are not all ruled.** `charter_opens_at` and `lock_deadline` are still null. These must be set before deploy. The pre-signing check (`check-launch-params.mjs`) is the only gate for the guardian, swap operator, sweep cap, cooldown, and SOL reserve values. The person building the initialize transactions must build them from `mainnet-init.json` and verify the signed transactions match.

4. **The deploy runbook must be rehearsed.** Round 33's L1 showed that a pre-funded program id blocks the standard deploy. The measured recovery path (allocate/assign/write-buffer/DeployWithMaxDataLen) must be rehearsed at throwaway ids before road step 9. The program keypairs must be kept offline until deploy.

5. **The reproducible build gap remains.** The four keyed programs' shipped bytes are not proven to be the bytes the suite ran. `build-mainnet.sh` proves the test key is rejected and greps the source for the init authority, but it does not prove the compiled constant is the correct key. Independent reproducible builds from the same commit would close this gap. This should be done before the lock.

6. **The off-chain pipeline (bank/) is the weakest link.** It carries what programs structurally cannot do (see, notice absence, watch dependencies), but it has never run against a live deployment. The alarm, crank, and revenue cycle are all untested in production conditions. The box-owner residue (whoever can edit the files can stop the alarm) is an accepted limit but a real one. The dress rehearsal must exercise the full pipeline.

7. **A human should physically verify the initialize transactions before signing.** The AI audit can verify the code and the values, but the actual signing of the four initialize transactions is a human act. The person signing should independently verify that each transaction's accounts and data match `mainnet-init.json`, that the program ids are correct, and that the upgrade authority is set for later removal. This is the one step that cannot be delegated to automation.