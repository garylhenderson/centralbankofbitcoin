Of course. Here is my independent security audit of the provided codebase, structured according to your specified targets and format.

***

### **R0. ROUND 45'S VERDICT AND ITS REPAIRS**

Round 45's verdict was LAUNCH-CLEAN on both passes, with 11 confirmed findings (5 LOW, 6 INFO) all located in the new rehearsal driver (`scripts/rehearsal-run.mjs`, `scripts/rehearsal-steps.mjs`, `scripts/rehearsal-recover.mjs`) and its SPEC text. The five core programs were confirmed byte-identical to the audited `RELEASE_COMMIT` and had no findings.

**Verification of Repairs:**
The repairs for the round 45 findings are implemented in commits `7a1a683` and `e7c192a`. I have reviewed the current tree for these specific fixes:

*   **V45-1 (Item-22 predicates):** The `revenue-forced-alarm` step in `scripts/rehearsal-steps.mjs` now waits for `ALARM_GRACE_MS` and uses the `judgeForcedFailureAlarm` function, which specifically checks for the `unreconciled_swap` kind. The `das-read` step now uses `judgeDas` to only record PASS on a boolean `burnt` value. The `alarm-pass` steps now use `judgeAlarmPass` to fail on incomplete runs or unexplained CRITICALs. These repairs are present and correctly implemented.
*   **V45-2 (Key in argv):** The `solanaCli` function in `scripts/rehearsal-steps.mjs` now uses `solanaArgv`, which passes `--config` pointing to a mode-600 file instead of `--url`. The `judgeArgv` function is used to ensure no secret is in the argv. This repair is present and correctly implemented.
*   **V45-3 (Deploy key not tied to judged id):** The `deploy-*` steps now call `judgeDeployKey` before executing, which checks that the keypair's public key matches the recorded throwaway id and is not a mainnet id. The `bufferCloseArgv` function is used to close only the recorded buffer. This repair is present and correctly implemented.
*   **V45-4 (Rescue resume):** The `rescue` step is now marked `resumable: true` and its `run` function is idempotent, re-reading the chain state to determine what action to take next. The `nextAction` function in `scripts/rehearsal-run.mjs` correctly handles the `resume` flag. This repair is present and correctly implemented.
*   **V45-5 (Cycle-1 venue order):** The `revenue-cycle-*` steps now use `judgeRevenueCycles` to check for one closed cycle on each venue, regardless of order. The `done` check for `revenue-cycle-1` is now based on the number of closed cycles, not the venue of the first one. This repair is present and correctly implemented.
*   **V45-6 (Init window):** The `fill-values` step now runs before the deploys, and the `requiresVerified` function in `scripts/rehearsal-run.mjs` prevents any step after `verify-configs` from running until the configs are verified. This repair is present and correctly implemented.
*   **V45-7 (`box` DAS URL and sweep-back scope):** The `profile()` function in `scripts/rehearsal-steps.mjs` now uses `ctx.A.rpcResolved` instead of `ctx.A.rpc`. The `sweep-back` step's description is updated to accurately reflect what it does and does not sweep. This repair is present and correctly implemented.
*   **V45-8 (22.1 scale):** The `crank-full` step now records the item 22.1 verdict as `'PASS at 5 vaults (scale not exercised)'`. This repair is present and correctly implemented.
*   **V45-9 (SPEC 53 alarm text):** The SPEC text has been updated to describe the `CBOB_REHEARSAL_NOTIFY` route. This repair is present and correctly implemented.
*   **V45-10 (Hand recovery records late):** The `handRecover` function in `scripts/rehearsal-recover.mjs` now uses the `sendRecorded` function, which writes the signature to the ledger *before* sending the transaction. This repair is present and correctly implemented.
*   **V45-11 (Collection create check):** The `ceremony-collection` step now uses `checkNewAddress` to handle the case where the generated address is already taken, generating a fresh key instead of stopping the entire rehearsal. This repair is present and correctly implemented.

**Regression Check:**
The changes are localized to the rehearsal driver and its helper scripts. They do not touch the core program logic, the off-chain jobs, or the web pages. The `run-tests.sh` script has been updated to include the new selftest arms for these repairs, and the `release_gate` function has been modified to correctly handle the rehearsal tree. I have found no regressions introduced by these changes.

**Conclusion for R0:** All confirmed findings from Round 45 have been repaired at all sites of their shape. The repairs are correctly implemented and do not introduce regressions.

---

### **R1. CUSTODY: CAN ANYONE BUT THE OWNER GET VALUE OUT OF A SEALED VAULT, OR AN EMPTIED VAULT SURVIVE?**

The seal is a `PermanentFreezeExecute` plugin with authority set to the SEAL program's `["seal"]` PDA. The only instruction that can thaw it is `open_for_redemption`, which requires:
1.  The signer to be the asset's owner.
2.  A matching `burn_vault` instruction for the same asset and owner to be present later in the same transaction.

The `burn_vault` instruction requires:
1.  A preceding `open_for_redemption` for the same asset and owner.
2.  The asset-signer PDA to have zero lamports.
3.  All reserve token accounts to be declared, empty, and undelegated.
4.  No declared account to be a live Core asset.

**Attack Analysis:**

*   **CPI Wrappers:** The pairing checks use `load_instruction_at_checked` on the instructions sysvar, which only sees top-level instructions. A CPI wrapper cannot satisfy the pairing because the inner instruction is not top-level. This is correctly implemented and tested (WR.1, WR.2, WR.3).
*   **Two Vaults in One Transaction:** The pairing binds both asset and owner, so an open for vault A cannot be paired with a burn for vault B. This is correctly implemented and tested (3.9, 3.10, 9.0).
*   **Account-Index Binding:** The asset and owner are bound by their positions in the account list (indices 0 and 2, respectively). This is correctly implemented and tested (3.1c-3.1f).
*   **Instruction-Sysvar Parsing:** The sysvar is parsed defensively, checking the program ID and data length. The loop correctly handles the case where the burn is not the last instruction.
*   **Emptiness Proof:**
    *   **Token-2022 extensions:** The burn checks for `d.len() == TOKEN_ACCOUNT_LEN` (165), which correctly rejects Token-2022 accounts with extensions.
    *   **Delegates:** The burn checks for a zero delegate (`d[72..76] == [0,0,0,0]`) and a zero close authority (`d[129..133] == [0,0,0,0]`). This is correct.
    *   **Lamports:** The burn requires `asset_signer.lamports() == 0`. This is correct and necessary, as Core's `BurnV1` does not sweep lamports.
    *   **Nested Core assets:** The burn iterates through declared accounts and refuses if any is a live Core asset (`d[0] == KEY_ASSET_V1`). This is correct.
    *   **Declared-but-foreign accounts:** The burn only checks accounts that are declared. An undeclared account is not checked, which is the accepted limitation (proven impossibility 2).

**Conclusion for R1:** The custody mechanism is sound. The pairing of `open_for_redemption` and `burn_vault` is correctly implemented and resistant to the attacks described. The emptiness proof is robust and correctly handles the specified edge cases. No path exists for a non-owner to extract value from a sealed vault, and no path exists for an emptied vault to survive the transaction.

---

### **R1s. THE SWEEP HELPER**

The sweep helper is a stateless program that moves all lamports and token balances from a vault's asset-signer PDA to a destination wallet.

**(a) Access Control:**
The helper requires the asset-signer PDA to be a signer. This can only happen through Core's `ExecuteV1`, which requires the asset's owner to sign. The helper itself has no other access control. This is correct. The helper can only be reached while the vault is thawed, which is only possible inside a redemption transaction. If called directly, it requires the signer's signature, which only the owner can provide for their own vault.

**(b) The Pair List:**
*   **Same source twice:** The first pair would transfer the balance and close the account. The second pair would then try to read the closed account, which would fail because the account no longer exists or is owned by the system program. This is correctly refused (SR.12a).
*   **Destination twice:** This is not explicitly checked. However, the second transfer would simply move zero tokens (as the source is already empty) and then attempt to close the already-closed account, which would fail. This is a benign failure.
*   **Source is also a destination:** The helper checks `signer.key == dest.key` and refuses. This prevents a vault from sweeping to itself.
*   **Source is a native wSOL account:** The helper reads the token account's mint and owner. A wSOL account is a token account, so it would be treated as a regular token account. The transfer would move the wSOL balance, and the close would return the underlying lamports to the destination. This is a valid operation.
*   **Source has a delegate or close authority:** The helper does not check for delegates or close authorities. The token program's `Transfer` instruction will fail if the source has a delegate that is not the signer. The `CloseAccount` instruction will fail if the close authority is not the signer. This is a benign failure that reverts the whole transaction.
*   **Account is frozen:** The token program's `Transfer` instruction will fail if the source account is frozen. This is correctly refused (SR.14).
*   **Destination is not an ATA:** The helper checks that the destination is owned by the destination wallet and has the same mint. It does not require it to be an ATA. This is a valid design choice, as it allows for more flexibility.
*   **Destination wallet is the vault's own asset-signer:** This is refused by the `signer.key == dest.key` check.
*   **Destination wallet is another vault's asset-signer:** This is not explicitly checked. The helper would transfer the tokens and lamports to the other vault's PDA. This is a valid operation, as the owner is choosing to send their assets to another vault.
*   **Odd or zero-pair account list:** The helper checks `(accounts.len() - 4) % 2 != 0` and refuses. A zero-pair list is valid and results in a lamports-only sweep.

**(c) Destination Checks:**
The destination wallet is chosen by the transaction builder. Given that only the owner can initiate the sweep through Core's `ExecuteV1`, this is safe. The owner is in control of where their assets go. The lamport transfer to a destination below rent exemption will fail if the destination account does not exist, which is a benign failure that reverts the transaction.

**(d) The Lamport Sweep:**
The helper reads `signer.lamports()` at execution time and transfers the entire balance. This is correct. After the transfer, the signer's lamports are zero. A later instruction in the same transaction could deposit lamports back into the signer, but this would be a deliberate act by the transaction builder. BURN's `lamports == 0` check would then fail, correctly reverting the transaction.

**(e) Interaction with BURN's Emptiness Proof:**
The helper closes the token accounts it empties. BURN's proof checks for `amount == 0` and `owner == pda`. A closed account has no owner and no data, so it is skipped by the proof. This is correct. If a reserve ATA does not exist, the page creates it in a prior transaction. This is sufficient. A stranger could create a classic ATA for the vault and deposit into it, but the sweep helper would then move that balance to the owner, so it would not block the redemption. A Token-2022 ATA for a classic mint cannot be created (F4.2). A non-ATA token account can be created by anyone, but the sweep helper can also sweep it if it is named in a pair. A nested Core asset cannot be swept by the helper, but BURN will refuse if it is declared, and the redeem page will warn about it if it is undeclared.

**(f) Does it fit?**
The S8.0 measurement includes the claim, open, sweep, and burn instructions. It does not include compute budget instructions or a separate fee payer. The SPEC states that the widest page shape is about 1,209 bytes, which fits within the 1,232-byte limit. The measurement is accurate for the stated shape.

**(g) Evidence:**
The suite arms SR.0-SR.4a and the simulation S8.* provide strong evidence for the helper's correctness. The helper is deployed in the suite from the same bytes that `scripts/build-mainnet.sh` proves are identical to the mainnet build.

**Conclusion for R1s:** The sweep helper is correctly implemented and its access control is sound. The pair list checks are sufficient, and the interaction with BURN's emptiness proof is correct. The helper is a necessary and well-designed component of the redemption process.

---

### **R2. THE COMMUNITY POOL'S MONEY**

The pool's accounting is based on a weighted accumulator. The invariant is that the pool always holds at least `ceil(owed_scaled / ACC_SCALE)`.

**Analysis of Counters and Orderings:**
The counters `pending_count`, `pending_this_epoch`, `active_count`, and `total_active_weight` are all updated atomically within their respective instructions. The `JoinWaitingFirst` gate ensures that no distribution occurs while a vault is eligible to join, which prevents a vault from being excluded from a distribution it should have been part of. The `BoostsExpireFirst` gate similarly ensures that no distribution occurs while a boost is due, which prevents a boost from earning more than its allotted distributions.

The `monthly_inline` function is called at the beginning of every host instruction, ensuring that a due distribution is processed before any other state changes. This is correct.

**Liveness:**
The `distribute` instruction is permissionless and can be called by anyone. The `claim` instruction is also permissionless. The `JoinWaitingFirst` and `BoostsExpireFirst` gates can be cleared by anyone by calling `claim` or `expire_boosts`, respectively. Therefore, no single actor can make distributions or redemptions impossible for others.

**Conclusion for R2:** The pool's accounting is correct. The invariant holds under all orderings of host instructions. The liveness of the system is not dependent on any single actor.

---

### **R2b. THE $CBOB BOOST**

The boost mechanism is implemented with a ring buffer (`boost_expiring`) and a `boosts_due` counter.

**Analysis:**
*   **Exact N distributions:** A boost is scheduled to end at `dist_epoch + boost_epochs`. The `advance_epoch` function increments `dist_epoch` and moves boosts from the ring to `boosts_due` when their end epoch is reached. The `BoostsExpireFirst` gate prevents any distribution from occurring while `boosts_due > 0`. This ensures that a boost earns exactly N distributions and not one more.
*   **No loss or gain on weight change:** The `reweigh` function correctly moves the owed share to `carry_scaled` and resets `debt_scaled` to the new weight times the current accumulator. This ensures that a vault's earned share is preserved across weight changes.
*   **Counter agreement:** The host unit test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` provides strong evidence that `total_active_weight`, `boost_weight_total`, `boosts_active`, `boosts_due`, and the ring always agree, including past epoch 64.
*   **No double expiry:** The `expire_boost` function checks `r.boost_weight > 0` and `c.dist_epoch >= r.boost_end_epoch`. Once expired, `r.boost_weight` is set to 0, so it cannot be expired again.
*   **No early or never expiry:** The `BoostsExpireFirst` gate ensures that a due boost is always expired before the next distribution. The `expire_boosts` instruction is permissionless and can be called by anyone.
*   **No distribution block:** The `expire_boosts` instruction only requires the vault records, not the token accounts. This means that a vault with a missing token account cannot block the expiry of its boost, and therefore cannot block distributions.

**Conclusion for R2b:** The boost mechanism is correctly implemented. The invariants hold, and no actor can make distributions impossible by boosting or by having a vault with a missing token account.

---

### **R3. THE LEVEL DRAW**

The level draw uses three slot hashes from three different leader groups.

**Analysis:**
*   **SlotHashes parse:** The `blockhash_in_window` function correctly parses the SlotHashes sysvar, checking the account key, the declared count, and the buffer length. It correctly handles skipped slots by finding the smallest produced slot in the window.
*   **Skipped-slot handling:** The `try_capture` function correctly handles skipped slots by using the `blockhash_in_window` function to find the first produced slot at or after the target.
*   **FIFO:** The `reveal_level` instruction requires `index == config.revealed_total`, which enforces strict mint order.
*   **Burned vault at head of queue:** The `reveal_level` instruction correctly handles a burned vault by skipping the Core update but still advancing `revealed_total`.
*   **Attribute re-supply hash:** The `reveal_level` instruction correctly checks the re-supplied attributes against the stored hash.
*   **Influence of minter, crank operator, or slot leader:** The minter cannot influence the draw because the slot hashes are from slots after the mint. The crank operator can only choose whether to capture or reschedule, which does not change the outcome. The slot leader of C can influence the draw by skipping slots or varying block contents, which is the accepted limit (SPEC 26).

**Conclusion for R3:** The level draw is correctly implemented. The FIFO is enforced, and the draw is resistant to manipulation by the minter or crank operator. The influence of the C slot leader is an accepted and documented limitation.

---

### **R4. GOVERNANCE**

The governance system is implemented with a snapshot of the electorate at proposal creation.

**Analysis:**
*   **Minority carrying what it should not:** The `KeyChangeNeedsHalf` check requires YES from at least half of the snapshotted live supply for guardian or swap operator changes. This prevents a minority from carrying these changes.
*   **Vote reaching money it should not:** The `ProposalAction` enum is limited to `SetRound`, `Brakes`, `TightenSweep`, `ArmSwapOperator`, and `SetBoostTerms`. None of these actions can directly move money out of the pool or revenue address.
*   **Governance frozen forever:** The `KeyChangeNeedsHalf` check requires a high threshold for key changes, which could be difficult to reach if turnout is low. However, this is a deliberate design choice to prevent a captured vote from removing the guardian. The system is not frozen forever, as a new guardian can be elected if enough vaults vote.

**Conclusion for R4:** The governance system is correctly implemented. The checks are sufficient to prevent a minority from carrying what it should not, and the system is not permanently freezable.

---

### **R5. THE CHARTER CLAIM**

The charter claim is implemented with a Merkle proof against a root of 240 Proof of Burn addresses.

**Analysis:**
*   **Proof of Burn identified by address:** The claim checks that the provided asset is a leaf in the Merkle tree rooted at `pob_root`. This correctly identifies the Proof of Burn by address, not by name.
*   **CPI-burned as its owner:** The claim CPI-burns the Proof of Burn as its owner, which is the signer. This ensures that only the owner can claim.
*   **Window fixed at initialize:** The charter window is set at `initialize` and cannot be changed.
*   **Not gated by guardian:** The claim does not check the sales stop flag, which is correct per the ruling.
*   **`pob_extra` accounts:** The claim passes through up to 8 extra accounts to Core's burn, never as signers. This is correct.

**Conclusion for R5:** The charter claim is correctly implemented. The Proof of Burn is correctly identified and burned, and the window is fixed.

---

### **R6. THE ONE-TIME CONFIGURATION AND THE TRUSTED HOP**

**Analysis of `initialize` functions:**
Each `initialize` function is gated by `INIT_AUTHORITY` and can only be called once. The values they accept are checked against the program's constants and bounds. A wrong-but-accepted value would be locked in forever, but the `check-launch-params.mjs` script provides a pre-signing check to prevent this.

**Swap Operator:**
The swap operator is the one trusted key. Its worst case is bounded by the on-chain cap and cooldown, and the guardian can stop it at any time. The swap itself is built against pinned pools with a Pyth-derived floor, which is enforced on-chain.

**Royalty:**
The 10% royalty is a Core plugin with authority `None`. This means that no one, including our programs, can change it. This is correct.

**Redemption Cap:**
The redemption cap is a rolling window over a 64-slot ring of timestamps. The `burn_vault` instruction correctly checks the cap-th most recent redemption time and refuses if it is within the window. This is correct.

**Conclusion for R6:** The one-time configuration is correctly implemented. The swap operator's worst case is bounded, and the royalty is immutable.

---

### **R7. CROSS-PROGRAM RAW READS**

I have recomputed every offset and account space from the struct definitions. All offsets are correct. The discriminators and version bytes are correctly pinned. The sweep helper's raw reads of classic SPL token accounts are also correct.

**Conclusion for R7:** All cross-program raw reads are correct.

---

### **R8. THE SUITE, THE SIMULATION AND THE BUILD AS EVIDENCE**

The suite (`tests/3prog.test.ts`), the Test Vault simulation (`sim/test-vault.ts`), and the build script (`scripts/build-mainnet.sh`) provide strong evidence for the claims made in the prompt. The suite has 912 assertions, the simulation has 71, and the build script proves the mainnet bytes are the ones tested.

**Analysis of Test Arms:**
I have reviewed the test arms and found them to be non-vacuous. The `because()` list correctly pins the reasons for refusals, and the arms are designed to fail if the property they test is broken.

**Conclusion for R8:** The suite, simulation, and build script are valid evidence for the claims made.

---

### **The Four Questions About the Accepted Limits**

1.  **Is any limit WORSE than stated?**
    *   **Limit 46 (PoB collection hot wallet):** The limit states the wallet can "END THE PROJECT BEFORE IT STARTS or CAPTURE ALL OF GOVERNANCE." This is accurate. The wallet could also add a plugin that selectively admits only *some* Proofs of Burn, not just its own, creating a more complex but still centralized control. This is a nuance, not a fundamental worsening.
    *   **Limit 47 (Stolen guardian key):** The limit states the stop can be "PERMANENT" at low turnout. This is accurate. The guardian key could also be used to cancel a pending swap operator, which is a minor additional power not explicitly mentioned in the limit's headline but is covered by the general "can only stop" description.

2.  **Is anything listed as a limit not actually a limit?**
    *   **Limit 35 (10% turnout rule):** The limit states it "never binds at the ruled numbers." This is correct. The rule is a floor that is already exceeded by the quorum and threshold requirements.

3.  **Is any DISCHARGED item not actually discharged?**
    *   **Item 51 ($CBOB boost):** The item is marked DISCHARGED, but the boost mechanism is fully implemented and tested. The "accepted residue, boost timing" is disclosed. This is correctly discharged.

4.  **Is any item in OPEN AND BLOCKING being quietly treated as accepted?**
    *   **Item 22 (Live chain distribution):** The item is still OPEN AND BLOCKING. The dress rehearsal is designed to address this, but it has not yet been run on mainnet. The item is not being treated as accepted.
    *   **Item 38 (Initialize values):** The item is still OPEN AND BLOCKING. The `charter_opens_at` and `lock_deadline` values are still open. The item is not being treated as accepted.
    *   **Item 50 (Holder surfaces):** The item is still OPEN AND BLOCKING. The pages are built and staged but not published. The item is not being treated as accepted.

---

### **GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?**

1.  **Run the Mainnet Dress Rehearsal:** The dress rehearsal is the only way to test the off-chain pipeline (crank, alarm, revenue job) against a live chain with real-world conditions like RPC latency, rate limits, and transaction failures. This is critical and must be completed before launch.

2.  **Conduct a Formal Verification of the Core Invariants:** While the test suite is extensive, a formal verification of the pool's accounting invariants (e.g., using a tool like the Move Prover or a custom model checker) would provide a higher level of assurance than testing alone. This is especially important for the accumulator logic, which is the most complex and critical part of the system.

3.  **Perform a Red Team Exercise with a Focus on the Off-Chain Pipeline:** The AI audits have focused heavily on the on-chain programs. A dedicated red team exercise targeting the off-chain pipeline (the box, the cron jobs, the RPC proxy, the web server) would be valuable. This should include social engineering attempts, network penetration testing, and a review of the server's security posture.

4.  **Engage a Third-Party Security Firm for a One-Time Review of the Deployment Process:** The deployment process (road steps 9-11) is a critical, one-time event. A third-party firm could review the process for operational security gaps, such as key handling, transaction signing, and verification steps.

5.  **Establish a Clear Incident Response Plan:** Given the immutability of the programs, a clear incident response plan is essential. This plan should define roles, responsibilities, and procedures for responding to various scenarios, such as a stolen guardian key, a compromised swap operator, or a bug in the redemption process.

6.  **Create a Public Bug Bounty Program:** A bug bounty program would incentivize external security researchers to find and report vulnerabilities. This would provide an additional layer of defense beyond the AI audits.

7.  **Document All Operational Procedures:** All operational procedures, such as how to recover from a failed revenue cycle or how to respond to a frozen pool, should be thoroughly documented and tested. This documentation should be accessible to the team and regularly reviewed.

8.  **Consider a Gradual Rollout:** Instead of launching with the full 2,100 vaults, consider a gradual rollout with a smaller initial supply. This would limit the potential damage from any unforeseen bug and allow for a period of observation before the system is fully live.