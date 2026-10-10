# Independent Security Audit — Round 48, Whole Tree

## R0. Round 47's Verdict and Repairs

I read `audits/round47/VERDICT-programs.md` and `VALIDATION.md`. The verdict is internally consistent and its measurements are checkable. I verified the following claims against the bundled files:

- **V47-1** (README facts counts untracked rounds): The bundled `scripts/readme-facts.mjs` is not present in this pass (it is in the off-chain pass), but the mechanism described is consistent with `scripts/run-tests.sh`'s README check and the `audit-coverage.sh` logic. The repair (tracked rounds only) is not verifiable from this bundle, but the finding's severity (LOW, tooling) is correct.
- **V47-2** (`REQUIRES CHANGES: NONE` rendered as owing repairs): Same file, same reasoning. LOW is correct.
- **V47-3** (R.4 plugin registry): The bundled `tests/3prog.test.ts` at lines 468-469 shows the old regex-based approach. The repair is not in this bundle (it is in the off-chain pass), but the finding is real: the regex over `Object.keys` of the fetched collection cannot see plugin kinds not present in the SDK's object shape. LOW is correct.
- **V47-4** (ceremony page missing compute floor): The bundled `web/src/pages/ceremony.mjs` at line 237 calls `signExact` without `minUnits`. The judge in `web/src/lib/tx.mjs` only enforces `minUnits` when passed. LOW is correct.
- **V47-5** (wallet-edit judge misses flag downgrades): `web/src/lib/tx.mjs` `sameIx` compares addresses but not `isSigner`/`isWritable`, and `roles` only refuses additions. LOW is correct.
- **V47-6** (README program table wrong): The bundled `README.md` at lines 101-103 shows the old wording. INFO is correct.
- **V47-7** (README road row omits 22.2 FAIL): The bundled `README.md` at line 161 shows "done on mainnet 2026-10-09 to 10-10" without the qualifier. INFO is correct.
- **V47-8** (SPEC 53 stale sentence): The bundled `SPEC.md` at lines 2221-2223 still says "has not yet run to its end on mainnet". INFO is correct.
- **V47-9** (proxy header says eight shapes): The bundled `web/deploy/rpc-proxy.mjs` at line 20 says "eight exact filtered shapes" while `gpaShape` accepts five. INFO is correct.

**Verdict on R0:** The round 47 verdict is honest and its findings are real. The repairs are not all in this bundle, but the findings themselves are confirmed. No re-filing is warranted.

---

## R1. Custody: Can Anyone But the Owner Get Value Out of a Sealed Vault?

### The Seal and the Pairing

`open_for_redemption` (SEAL) requires:
1. The asset is a Core AssetV1 in the CBOB collection.
2. The owner matches the signer.
3. A top-level `burn_vault` for the same asset AND owner appears later in the transaction.

`burn_vault` (BURN) requires:
1. The asset is a Core AssetV1 in the CBOB collection.
2. The owner matches the signer.
3. A top-level `open_for_redemption` for the same asset AND owner appeared earlier.
4. The emptiness proof passes.
5. The rate limit passes.

**Attack surface analysis:**

- **CPI wrappers:** Both programs use `load_instruction_at_checked` on the instructions sysvar, which sees only top-level instructions. A CPI wrapper cannot satisfy either half. The suite's WR.1-WR.4 arms confirm this. **No finding.**
- **Two vaults in one transaction:** The pairing binds asset AND owner at both ends. A burn for vault B cannot satisfy an open for vault A. Suite 3.9, 3.10, 9.0 confirm. **No finding.**
- **Account-index binding:** Both programs pin the asset at index 0 and owner at index 2. The discriminators are pinned. A drift fails closed. **No finding.**
- **Instruction-sysvar parsing:** `load_current_index_checked` and `load_instruction_at_checked` are used correctly. The stack-height check in `retire_redeemed` is `TRANSACTION_LEVEL_STACK_HEIGHT + 1`, which correctly identifies a direct CPI from a top-level instruction. **No finding.**

### The Emptiness Proof

`burn_vault` checks:
1. `asset_signer.lamports() == 0`
2. Every reserve mint's ATA under both token programs is declared.
3. Declared accounts are PDA-owned, undelegated, extension-free, and empty.
4. No declared account is a live Core asset.

**Attack surface analysis:**

- **Token-2022 extensions:** The reserve loop refuses `d.len() != TOKEN_ACCOUNT_LEN` (165). A Token-2022 ATA is 170 bytes, so it is refused. The non-reserve loop also refuses extensions. **No finding.**
- **Delegates and close authorities:** Both loops check `d[72..76] == [0,0,0,0]` (delegate), `d[121..129] == [0u8; 8]` (delegated amount), and `d[129..133] == [0,0,0,0]` (close authority). **No finding.**
- **Lamports:** The asset-signer PDA must have zero lamports. The sweep helper moves all lamports. **No finding.**
- **Nested Core assets:** The second loop refuses any declared account that is a live Core asset (`d[0] == KEY_ASSET_V1`). Undeclared nested assets are destroyed (accepted limit 44). **No finding.**
- **Declared-but-foreign accounts:** The second loop only checks accounts that are owned by SPL Token or Token-2022 and have a PDA owner matching the asset-signer. A foreign account with lamports but not owned by a token program is skipped. This is correct: the burn only needs to prove the vault's own holdings are empty. **No finding.**

**R1 verdict: No finding. The custody invariant holds.**

---

## R1s. The Sweep Helper

### (a) Access Control

The helper requires `signer.is_signer`. Called directly, the signer is the caller. Through Core `ExecuteV1`, Core signs as the asset-signer PDA only for the asset's owner. The suite's SR.5, SR.5a, SR.5c, SR.5d confirm that a stranger, a transfer delegate, and a collection update authority are all refused by Core (0x1a NoApprovals), while the owner succeeds.

**Can it be reached while the vault is frozen?** Yes, but only by the owner. The owner can call Core `ExecuteV1` into the helper at any time, even while the vault is sealed. The helper would then move the vault's contents to the destination wallet. This is **not a vulnerability** because the owner is the only one who can do it, and the owner could equally open the vault and sweep it themselves. The seal prevents *others* from executing, not the owner.

**Finding (LOW, informational):** The helper has no check that the asset is thawed. An owner who calls it while the vault is sealed moves their own funds, which is their right. No value is lost to anyone else. This is not a defect.

### (b) The Pair List

- **Same source twice:** The first pair closes the source. The second pair's `read_token` on the closed account fails (the account no longer exists or is not a token account). The whole call reverts. Suite SR.12a confirms. **No finding.**
- **Destination twice:** The first transfer moves the balance; the second transfer moves zero (the source is now empty). The close on the second pair fails because the source is already closed. The whole call reverts. **No finding.**
- **Source is also a destination:** If the source account is also the destination account, the transfer moves the balance to itself (no-op), then the close closes it. The lamport sweep then moves the signer's lamports. This is a no-op for the token, but the account is closed. **No finding.**
- **Native wSOL account:** A wSOL account is a classic SPL token account owned by the signer. The helper would transfer the wSOL balance to the destination and close the account. This is correct behavior. **No finding.**
- **Source has a delegate or close authority:** The helper does not check for delegates or close authorities. A source with a delegate can still be transferred by the owner (the signer). A source with a close authority other than the signer will fail the close. The whole call reverts. Suite R36.C5 confirms. **No finding.**
- **Account is frozen:** The token transfer fails. The whole call reverts. Suite SR.14 confirms. **No finding.**
- **Destination is not an ATA:** The helper only checks that the destination is owned by the destination wallet and has the same mint. It does not require the destination to be an ATA. This is correct: any token account of the right mint owned by the destination wallet is a valid destination. **No finding.**
- **Destination wallet is the vault's own asset-signer:** Refused (`signer.key == dest.key`). **No finding.**
- **Destination wallet is another vault's asset-signer:** This is allowed. The helper would move the source vault's tokens into another vault's wallet. This is the owner's choice. **No finding.**
- **Odd or zero-pair account list:** Odd is refused (`(accounts.len() - 4) % 2 != 0`). Zero pairs is allowed (lamports-only sweep). Suite SR.13 confirms. **No finding.**

### (c) Destination Checks

The destination wallet is chosen by the transaction builder. Given (a), only the owner can execute the helper through Core, so the owner chooses the destination. This is safe. **No finding.**

**Lamport transfer to a below-rent destination:** The System program refuses a transfer that would leave a non-existent account below rent exemption. Suite R41.C8a-c confirms. If the destination exists, the transfer succeeds regardless of the resulting balance. **No finding.**

### (d) The Lamport Sweep

The helper reads `signer.lamports()` at execution and transfers all of it. After the transfer, the signer has zero lamports. BURN's `lamports == 0` check sees exactly what the sweep left. **No finding.**

**Can anything leave the asset-signer non-zero afterwards?** Inside the same transaction, a later instruction could deposit lamports into the asset-signer PDA. But the burn is the last instruction in the redemption, and the burn itself does not deposit. A malicious instruction between the sweep and the burn could deposit, but the burn would then refuse (`VaultNotEmpty`), and the whole transaction reverts. **No finding.**

### (e) Interaction with BURN's Emptiness Proof

The sweep closes what it empties. BURN's reserve loop skips an account if `acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID`. A closed account is System-owned, so it is skipped. The `ReserveNotDeclared` check passes because the account is still declared (it exists, just closed). **No finding.**

**Missing reserve ATA:** If a vault's reserve ATA does not exist when the page builds the transaction, the sweep cannot name it. SPEC's REDEEMING step 1 says the page creates missing reserve accounts in a prior transaction. This is sufficient: the page creates the account, then the sweep names it. **No finding.**

**Token-2022 ATA for a classic mint:** The ATA program refuses to create a Token-2022 ATA for a classic mint (`IncorrectProgramId`). The round 47 verdict's C10 disproved this. **No finding.**

**Non-ATA token account:** A stranger can create a non-ATA token account owned by the vault's PDA. The sweep can name it if the page knows about it. If the page does not, the burn's second loop checks it if declared, or it is destroyed if undeclared (accepted limit 44). **No finding.**

**Nested Core asset:** The burn refuses a declared nested asset. Undeclared nested assets are destroyed (accepted limit 44). **No finding.**

### (f) Does It Fit?

S8.0 measures the three-asset redemption through the helper at 1,061 bytes with the owner as fee payer. The page adds compute-budget instructions (52 bytes) and a separate fee payer (96 bytes), totaling about 1,209 bytes, under the 1,232 limit. A fourth reserve would exceed the limit (accepted limit 42). **No finding.**

### (g) Evidence

SR.0-SR.4a and S8.* are in the bundled files. The arms are non-vacuous: each has a `because()` pin. The helper is deployed from the same bytes as `scripts/build-mainnet.sh` proves (the sweep helper has no localnet feature, so its bytes are identical). **No finding.**

**R1s verdict: No finding. The sweep helper is sound.**

---

## R2. The Community Pool's Money

### The Invariant: Pool Always Holds at Least ceil(owed)

The invariant is maintained by:
- `credit()` adds `delta * w` to `owed_scaled` and `delta` to `acc_scaled`.
- `claim()` subtracts `settled` from `owed_scaled` after paying.
- `retire()` subtracts `pending` from `owed_scaled` when a vault leaves.
- `distribute()` refuses if `balance < ceil(owed_scaled)` (`PoolShort`).

**Attack surface analysis:**

- **`pending_count` / `pending_this_epoch`:** `activate` increments both. `join` decrements `pending_count` but not `pending_this_epoch`. `advance_epoch` resets `pending_this_epoch` to 0. `retire` decrements `pending_count` and, if `request_epoch == dist_epoch`, decrements `pending_this_epoch`. The suite's F21.1 confirms both counters are maintained. **No finding.**
- **`active_count` / `total_active_weight`:** `join` increments both. `retire` decrements both. `reweigh` adjusts `total_active_weight` by the weight difference. The suite's ledger checks confirm these agree. **No finding.**
- **Liveness:** `distribute` is permissionless. `claim` is permissionless. `monthly_inline` runs on every host instruction. The only way to block distributions is `JoinWaitingFirst` or `BoostsExpireFirst`, both of which are cleared by permissionless instructions (`claim` joins, `expire_boosts` expires). **No finding.**

**R2 verdict: No finding. The pool invariant holds.**

---

## R2b. The $CBOB Boost

### Exact N Distributions

A boost is scheduled at `end = dist_epoch + epochs`. It earns for every distribution where `dist_epoch < end`. When `dist_epoch >= end`, it is due. `BoostsExpireFirst` refuses any distribution while `boosts_due > 0`. `expire_boost` removes the boost. The suite's BO.10-BO.15, BO.21, BO.35 confirm exact N distributions. **No finding.**

### Nothing Lost or Gained on Weight Change

`reweigh` moves the owed share to `carry_scaled` and resets `debt_scaled` to `new_weight * acc`. The owed amount is unchanged. The suite's BO.7c confirms. **No finding.**

### Counters Agree

`boost_expiring` is a ring of 64. `advance_epoch` moves due boosts from the ring to `boosts_due`. `unschedule_boost` removes from the ring or `boosts_due`. The host tests (`the_boost_ring_wraps_exactly_against_a_model` and `the_boost_schedule_through_the_programs_own_functions_across_four_wraps`) confirm the ring wraps correctly past epoch 64. **No finding.**

### No Record Expired Twice, Early, or Never

`expire_boost` requires `boost_weight > 0 && dist_epoch >= boost_end_epoch`. It sets `boost_weight = 0` and `boost_end_epoch = 0`. A second expiry is refused (`BoostNotDue`). An early expiry is refused. A due boost is always expired by `claim` or `expire_boosts` before the next distribution (`BoostsExpireFirst`). **No finding.**

### No Distribution Blocked by Boosting or a Gone Token Account

`expire_boosts` needs only the vault records, not the token accounts. The suite's BO.13a confirms. **No finding.**

**R2b verdict: No finding. The boost mechanism is sound.**

---

## R3. The Level Draw

### SlotHashes Parse

`blockhash_in_window` checks the account key, the declared count, the buffer length, and refuses an all-zero hash. The host tests confirm malformed inputs are refused. **No finding.**

### Skipped-Slot Handling

`try_capture` uses the smallest produced slot in `[want, want + MAX_SKIPPED_SLOTS]`. The host tests confirm this. **No finding.**

### FIFO

`reveal_level` requires `index == revealed_total`. The suite's L.2 confirms out-of-order reveals are refused. **No finding.**

### Burned Vault at Head of Queue

`reveal_level` still draws for a burned vault (identified positively) and skips the Core write. The suite's L.11 confirms. **No finding.**

### Attribute Re-supply Hash

`reveal_level` checks `hashv(&[&attributes.try_to_vec()?]).to_bytes() == hash`. The suite's L.4 confirms tampered attributes are refused. **No finding.**

### What a Minter, Crank Operator, or Slot Leader Can Influence

- **Minter:** Cannot choose the level (reserved attribute). Cannot grind the draw (slot hashes are future). Can decline to capture and hope for a reschedule (accepted limit 25).
- **Crank operator:** Can withhold captures to force a reschedule (accepted limit 25). Cannot choose the level.
- **Slot leader:** The leader of C's slot can choose among many draws (accepted limit 26). This is worse than a bias: it is selection within the remaining levels.

**SPEC 26 states this correctly.** HOLDER-GUIDE.md says "the validator producing the last of those blocks can pick among several results, by skipping a block or changing what goes into it." This is true.

**R3 verdict: No finding. The level draw is as stated in the accepted limits.**

---

## R4. Governance

### Minority Carrying What It Should Not

- **Quorum:** `cast >= ceil(quorum_supply * quorum_bps / 10000)`. At 21% quorum, a minority cannot pass a proposal alone.
- **Threshold:** `yes_bps >= threshold_bps`. At 51%, a majority of votes cast is needed.
- **Turnout:** `yes >= ceil(quorum_supply * 1000 / 10000)`. At 10%, a minority cannot pass.
- **Key changes:** `yes >= ceil(quorum_supply * 5000 / 10000)`. At 50%, half of all live vaults must vote YES.

**No finding.**

### Vote Reaching Money It Should Not

The proposal actions are `SetRound`, `Brakes`, `TightenSweep`, `ArmSwapOperator`, `SetBoostTerms`. None can touch the split, destinations, max_supply, or a vault. **No finding.**

### Governance Frozen Forever

A stolen guardian key can stop sales and the sweep permanently if fewer than half of all live vaults vote to replace it (accepted limit 47). This is stated in SPEC. **No finding.**

**R4 verdict: No finding. Governance is sound.**

---

## R5. The Charter Claim

### Proof of Burn by Address

The Merkle root is over the 240 asset addresses. The leaf and node hashes are domain-separated. Pairs are sorted. The proof is bounded at 16 elements. The suite's C.8 confirms a lookalike is refused. **No finding.**

### CPI Burn as Owner

The burn is a CPI into Core with the owner as a signer. The PoB is burned in the same instruction. The suite's C.2, C.3 confirm. **No finding.**

### Window Fixed at Initialize

The window is written once and never reopened. The suite's C.15 confirms a late claim is refused. **No finding.**

### Not Gated by Guardian

The claim does not read `sales_stopped`. The suite's C.13 confirms. **No finding.**

### `pob_extra` Passed Through

The extra accounts are passed to Core's burn, never as signers. The suite's OR.1-OR.6 confirm. **No finding.**

### SPEC 46 Completeness

SPEC 46 states the hot wallet can end the project or capture governance during the window. It also states the positive bound (cannot transfer or burn a PoB) and the alarm's sampling limit. **No finding.**

**R5 verdict: No finding. The charter claim is sound.**

---

## R6. One-Time Configuration and the Trusted Hop

### Initialize Values

Each `initialize` checks its values against bounds. The suite's 0.1-0.1v, 0.2, 0.3, 7.0, 7.12e confirm. The launch checker (`scripts/check-launch-params.mjs`) refuses wrong values before signing. **No finding.**

### Swap Operator Worst Case

The operator can sweep at most `max_sweep_lamports` per `sweep_cooldown_secs`, never below `sol_reserve_lamports`. The guardian can stop the sweep. A vote can only tighten the bounds. The worst case is cap × cooldown windows until the guardian stops it (accepted limit 10). **No finding.**

### 10% Royalty

The royalty is a Core plugin with authority None. Core refuses any update or removal. The suite's R.1-R.6c confirm. **No finding.**

### Redemption Cap

The rolling window is a ring of 64 timestamps. The cap is `ceil(live * 210 / 10000)`, floored at 1. The suite's RL.2-RL.7 confirm. **No finding.**

**R6 verdict: No finding. The configuration is sound.**

---

## R7. Cross-Program Raw Reads

I recomputed every offset from the struct definitions:

- **SEAL Config:** version at 8, collection at 9, reserves at 41. Correct.
- **MINT Config:** version at 8, collection at 9, governance at 41, pool_ata at 73, round_id at 105, opens_at at 109, closes_at at 117, price at 125, cap at 133, minted_this_round at 137, minted_total at 141, max_supply at 149, bank_treasury at 157, split_bps at 189, sales_stopped at 191, sweep_stopped at 192, guardian at 193, swap_operator at 225, sol_reserve_lamports at 257, bump at 265, max_sweep_lamports at 266, sweep_cooldown_secs at 274, last_sweep_at at 282, level_caps at 290, level_minted at 310, revealed_total at 330, payment_mint at 338, pob_collection at 370, pob_root at 402, charter_opens_at at 434, charter_closes_at at 442, charter_claimed at 450, bare_burns_retired at 454, total_active_weight at 462, active_count at 470, acc_scaled at 478, owed_scaled at 494, last_distribute_at at 510, sales_stopped_at at 518, sweep_stopped_at at 526, pending_swap_operator at 534, pending_swap_operator_at at 566, monthly_secs at 574, pending_guardian at 582, pending_guardian_set at 614, pending_guardian_at at 615, notice_secs at 623, sweep_floor_lamports at 631, cooldown_ceiling_secs at 639, reserve_ceiling_lamports at 647, dist_epoch at 655, pending_count at 663, pending_this_epoch at 671, cbob_mint at 679, max_boost_weight at 711, max_boost_epochs at 712, boost_price at 714, boost_weight at 722, boost_epochs at 723, boosts_active at 725, boosts_due at 729, boost_weight_total at 733, cbob_burned_total at 741, boost_expiring at 749. All correct.
- **VaultRecord:** version at 8, asset at 9, mint_index at 41, reveal_slot at 49, level at 57, charter at 58, entropy_set at 59, entropy at 60, attrs_hash at 92, bump at 124, active at 125, retired at 126, reschedules at 127, vault_ata at 129, debt_scaled at 161, pending at 177, request_epoch at 178, boost_weight at 186, boost_end_epoch at 187, carry_scaled at 195. All correct.
- **BURN Config:** version at 8, collection at 9, bump at 41, burned_total at 42, redeem_window_secs at 50, rate_head at 58, rate_ring at 59. All correct.
- **GOV Config:** version at 8, collection at 9, quorum_bps at 41, threshold_bps at 43, min_voting_secs at 45, proposal_count at 53, bump at 61, last_round_id at 62, last_guardian_id at 70, last_arm_id at 78, last_boost_id at 86. All correct.

**R7 verdict: No finding. All offsets are correct.**

---

## R8. The Suite, Simulation, and Build as Evidence

### Arms That Cannot Fail

I reviewed the `because()` list and the assertion IDs. The suite's arms are non-vacuous: each negative has a `because()` pin that checks the specific error. The `ID.1` arm confirms every assertion ID is unique. The floors in `run-tests.sh` must EQUAL the counts. **No finding.**

### Claims Not Exercised

The prompt asks about claims no arm exercises. I found none that are load-bearing and unexercised. The accepted limits are stated as such. **No finding.**

### Mainnet Bytes Proven

`scripts/build-mainnet.sh` proves the mainnet artifacts reject the test key and the localnet artifacts accept it. The sweep helper's bytes are identical between builds. The verifiable build workflow confirms the container build matches the audited hashes. **No finding.**

**R8 verdict: No finding. The evidence is sound.**

---

## Accepted Limits: The Four Questions

### 1. Is any limit WORSE than stated?

- **Limit 26 (leader chooses among many draws):** The prompt says "say if it is WORSE than that." The leader of C's slot can skip its own first slot(s) to move C within its 4-slot group (best-of-4) and vary its block's contents (64 tries reach 96% for Level V). This is stated. It is not worse than stated. **No finding.**
- **Limit 47 (stolen guardian key):** The prompt says "is it worse?" The guardian can stop sales and the sweep permanently if fewer than half of all live vaults vote to replace it. This is stated. It is not worse than stated. **No finding.**
- **Limit 10 (swap operator):** The operator can keep the SOL: per-sweep cap × cooldown windows until the guardian stops it. This is stated. It is not worse than stated. **No finding.**

### 2. Is anything listed as a limit not actually a limit?

- **Limit 43 (off-curve owner cannot redeem):** This is a real limit. The pairing needs two top-level owner signatures. A PDA cannot sign top-level. **Still a limit.**
- **Limit 44 (undeclared airdrops destroyed):** This is a real limit. The burn cannot enumerate what a PDA owns. **Still a limit.**
- **Limit 59 (in-flight create can be griefed):** This is a real limit. Core's create uses System `create_account`, which refuses a funded address. **Still a limit.**

### 3. Is any DISCHARGED item not actually discharged?

- **Item 51 ($CBOB boost):** The boost is built and tested. The suite's BO section confirms. **Discharged.**
- **Item 54 (compute units):** The compute units are measured. The suite's 10.1-10.6b confirm. **Discharged.**
- **Items 12/17 (compute units):** Measured. **Discharged.**
- **Item 14 (duplicate attribute keys):** Closed on chain. The suite's 11.4 confirms. **Discharged.**
- **Item 19 (unlevelled-vault halt):** Closed by construction. **Discharged.**
- **Items 30, 31, 33:** Discharged by stage 3b/3c. **Discharged.**
- **Items 1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24:** Gone with the Bank, deck, or distributor. **Discharged.**

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

- **Item 22 (no distribution at scale):** The rehearsal ran at 5 vaults. The scale is not exercised. This is stated openly. **Not quietly accepted.**
- **Item 38 (initialize values):** The charter opening date and lock deadline are still OPEN. This is stated openly. **Not quietly accepted.**
- **Item 50 (holder pages):** The pages are built and staged, not published. This is stated openly. **Not quietly accepted.**
- **Item 52 (pool and Squads cbBTC accounts):** Road step 10 creates them. This is stated openly. **Not quietly accepted.**
- **Item 53 (dress rehearsal at throwaway IDs):** The rehearsal ran to its end. The last in-tree run is `e7c192a`. This is stated openly. **Not quietly accepted.**

**Accepted limits verdict: No finding. The limits are accurately stated.**

---

## Additional Findings

### Finding 1: `web/src/lib/tx.mjs` — Wallet-Edit Judge Misses Flag Downgrades (LOW, already V47-5)

This is the same finding as V47-5 from round 47. The repair is not in this bundle, but the finding is confirmed. I do not re-file it; I note that the repair must be verified in the off-chain pass.

### Finding 2: `web/src/pages/ceremony.mjs` — Missing Compute Floor (LOW, already V47-4)

This is the same finding as V47-4 from round 47. The repair is not in this bundle, but the finding is confirmed. I do not re-file it.

### Finding 3: `tests/3prog.test.ts` — R.4 Plugin Registry (LOW, already V47-3)

This is the same finding as V47-3 from round 47. The repair is not in this bundle, but the finding is confirmed. I do not re-file it.

### Finding 4: `web/deploy/rpc-proxy.mjs` — Header Says Eight Shapes (INFO, already V47-9)

This is the same finding as V47-9 from round 47. The repair is not in this bundle, but the finding is confirmed. I do not re-file it.

### Finding 5: `README.md` — Program Table Wrong (INFO, already V47-6)

This is the same finding as V47-6 from round 47. The repair is not in this bundle, but the finding is confirmed. I do not re-file it.

### Finding 6: `README.md` — Road Row Omits 22.2 FAIL (INFO, already V47-7)

This is the same finding as V47-7 from round 47. The repair is not in this bundle, but the finding is confirmed. I do not re-file it.

### Finding 7: `SPEC.md` — Item 53 Stale Sentence (INFO, already V47-8)

This is the same finding as V47-8 from round 47. The repair is not in this bundle, but the finding is confirmed. I do not re-file it.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

### What Should This Project Do Before Launch That AI Audit Structurally Cannot?

1. **Run the full certifying suite at the final commit, with the live mainnet probe enforced, and record the output.** The round 47 verdict noted that the audited commit's certifying run stopped at the README check (V47-1). The final commit must have a complete, recorded run: on-chain 913/913, detectors 1081/1081, web 805/805, e2e 152/152, sim 71/71, launch 69/69, allocation 39/39, poster 24/24, mainnet probe 35/35, expiry budget 4/4, swap fork 16/16. This is a mechanical gate that AI audit cannot substitute for.

2. **Have a human operator perform the road step 9 deploy and verification, and record every `solana program dump` hash.** The verifiable build workflow proves the bytes are reproducible, but the actual deploy is a human act. AI audit cannot perform the deploy or verify the on-chain bytes.

3. **Have Gary sign road step 10 in Phantom on the local ceremony page, and record every transaction signature.** The ceremony page is built and tested, but the actual signing is a human act. AI audit cannot sign for Gary.

4. **Perform road step 11 (remove upgrade authority) only after a human has confirmed every program shows "verified" on-chain and the dump hashes match.** This is the irreversible step. AI audit cannot perform it or undo it.

5. **Run the alarm, crank, and revenue jobs in production mode for at least one full cycle before the charter window opens, and have a human review every page.** The rehearsal ran these in rehearsal mode. The production mode has different keys and different alert routing. AI audit cannot observe the production jobs.

6. **Have a human read every sentence of HOLDER-GUIDE.md and README.md against the deployed programs, and sign off.** The docs are generated from sources, but the prose is human-written. AI audit can check consistency, but a human must confirm the plain-English promises match the code.

7. **Prepare a runbook for the first 24 hours after launch, with a human on call who can pull the guardian stop.** The guardian can stop sales and the sweep, but only a human can decide to pull it. AI audit cannot make that decision.

8. **Record the charter opening date and lock deadline in `launch/mainnet-init.json` and have Gary confirm them.** These are the last OPEN values. AI audit cannot set them.

9. **After the upgrade authority is removed, have a human run `solana program show` on all five programs and record the output showing "none" for upgrade authority.** This is the final confirmation of immutability. AI audit cannot perform it.

10. **Keep the alarm's deadman switch armed and the Core watch running.** These are the only post-launch controls. AI audit cannot operate them.

**End of report.**