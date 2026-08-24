## REPORT: ROUND 20 REPAIRS (045fcc0..HEAD)

### R1. THE COMMITMENT SCHEME

**Finding: Permanent failure if `commit_deck` is not called within 512 slots of `commit_seed` (MEDIUM)**  
The program deliberately provides no re-seed instruction. If the operator misses the window (e.g., due to network congestion, a bug, or a validator stall), minting is irreversibly blocked. The only recovery is a program upgrade or re-initialization, which loses all state. This is a design choice, but it is a single point of failure that AI audit structurally cannot evaluate operationally.  
*Evidence:* The code at `SLOT_HASHES_MAX = 512` and `DeckSlotUnavailable` exit. A test that delays `commit_deck` beyond 512 slots would produce the error.  
*Fix:* Add a governance-gated re-seed instruction (e.g., via a vote) that allows a new seed to be committed, resetting the deck. This would require a corresponding change in the alarm to detect the re-seed.

**Finding: The `blockhash_of_slot` function does not verify the owner of the sysvar account (LOW)**  
The function checks `require_keys_eq!(acct.key(), slot_hashes::ID, ...)` but does not verify that the account is owned by the Sysvar program. While the address is a well-known built-in, the lack of owner check is a minor deviation from defensive programming. A future Solana upgrade could theoretically change the ownership, causing a silent misread.  
*Evidence:* The code omits `require_keys_eq!(acct.owner, sysvar::ID, ...)`.  
*Fix:* Add an owner check similar to the other pinned reads in the codebase.

**The scheme is otherwise sound.** The Bank cannot influence the seed because the salt is committed before the blockhash is known, and the slot is fixed by the program. Collusion with a validator to grind the blockhash is infeasible within 13 seconds.

---

### R2. `blockhash_of_slot` — RAW PARSE

**The layout, endianness, and ordering are correct.**  
- `u64 count` at offset 0 (little-endian), then `count` entries of `(u64 slot, [u8;32] hash)` (total 40 bytes each).  
- The stride is 40 bytes, and the program uses `u64::from_le_bytes` for both count and slot.  
- The ordering assumption (newest first) is documented and matches the sysvar.  

**All failure modes fail closed:**  
- Truncated account → `data.len() < 8` → `BadSlotHashes`.  
- Count of zero → loop never runs → `DeckSlotUnavailable`.  
- Count > 512 → `BadSlotHashes`.  
- Malformed sysvar (wrong key) → `BadSlotHashes`.  
- Slot present twice → first occurrence (newest) is returned; no issue.  
- All-zero hash → `BadSlotHashes`.  

**The 512‑slot bound is enforced correctly.** The trade-off (permanent failure vs. unlimited draws) is a deliberate design choice. The risk is covered in R1.

---

### R3. THE HALT IN `bank/distribute.mjs`

**The tombstone test is correct and complete.**  
- `data[0] !== 1` correctly identifies a non‑AssetV1 account (burned, absent, or corrupted).  
- Absent accounts (`!raw`) are treated as burned.  
- The inner catch sets `tomb = false`, so an RPC failure halts (fail‑closed to the safe direction).  

**No third route to this halt has been introduced.** The only remaining halts are:  
- A vault with an unreadable level (genuine disagreement).  
- A poisoned ATA (already reported).  
- An RPC failure that prevents reading either the asset or the raw account.  

**No audit of `distribute.mjs` since the change** means the new code is untested by human review. The suite’s 330 assertions cover the on‑chain logic, but the off‑chain distribution path is not exercised on a live chain (see OPEN AND BLOCKING limit 22).

---

### R4. TWO DEFECTS ALREADY FOUND + OTHER UNFAILABLE ARMS

**The ordering fix in `commit_deck` is correct.** The one‑shot check now runs first, so a re‑deal is refused with the right error (`DeckAlreadyCommitted`) instead of `DeckSlotUnavailable`.

**The probe ceiling fix (7 → 64) now correctly identifies that the packet bound is being reached.** The test asserts that `maxAttrs < PROBE_CEILING` and that deeper decks yield fewer attributes. Both are proven by the measurements.

**No other unfailable assertions were found in this diff.** All new assertions are either positive (and can fail) or negative with a `because()` pinning the error code.

---

### R5. THE SUITE’S NEW ARMS (2.0c–2.0i, 11.11)

**Each negative test exercises the correct check.**  
- 2.0c: `commit_deck` before any seed → `SeedNotCommitted` (pinned).  
- 2.0d: all‑zero salt hash → `BadSaltHash` (pinned).  
- 2.0e: positive test, no `because()` needed.  
- 2.0f: second seed → `SeedAlreadyCommitted` (pinned).  
- 2.0g: positive test, verifies entropy slot exists.  
- 2.0h: cross‑implementation seed comparison. Could both be wrong the same way? Yes, but the test is designed to catch drift, not absolute correctness. The probability of both implementations sharing the same bug is low.  
- 2.0i: wrong salt → `BadSalt` (pinned).  

**11.11 now correctly measures the packet bound.** The ceiling of 64 ensures the probe can fail, and the assertions `at7 > at11 > at13` are verified by the printed numbers (29, 18, 13). The test is no longer vacuously true.

**Offsets 593 and 601 are verified against the struct layout.**  
Calculated:  
- After discriminator (8), version (1), admin (32), collection (32), bank (32), governance (32), treasury (32), round_id (4), opens_at (8), closes_at (8), price_lamports (8), cap (4), minted_this_round (4), minted_total (8), max_supply (8), bank_treasury (32), split_bps (2), paused (1), swap_operator (32), sol_reserve_lamports (8), bump (1), max_sweep_lamports (8), sweep_cooldown_secs (8), last_sweep_at (8), pending_governance (32), pending_governance_at (8), governance_timelock_secs (8), pending_admin (32), pending_admin_at (8), pending_bank (32), pending_bank_at (8), pending_operator (32), pending_operator_at (8), level_caps (20), level_minted (20), deck_root (32) → offset 561.  
- deck_salt_hash: 561+32 = 593.  
- deck_slot: 593+8 = 601.  
- deck_seed: 601+32 = 633.  

The test’s constants match.

---

### R6. ACCEPTED LIMITS REWRITES

**Limit 1a** now correctly states that the Bank‑pubkey confinement is on‑chain in both programs. The under‑claim is fixed.  
**Limit 23** now includes the measured table (depth 7 → 29 attributes, depth 11 → 18, depth 13 → 13) and acknowledges that the program is the binding constraint. The rewrite is accurate.

---

### R7. FLOORS AND ARITHMETIC

**Floors from `scripts/run-tests.sh`:**  
- `MIN_ASSERTIONS=330` (on‑chain)  
- `DET_FLOOR=439` (detector)  
- `ALLOC_FLOOR=103` (allocation)  
- `DECK_FLOOR=17` (deck)  
- `MAINNET_FLOOR=19` (mainnet probe)  

All are verified against the file. The schedule’s arithmetic (census 108/60/36/24/12 → 732 denominator, 945/525/315/210/105 → 6,405, per‑$1,000 figures, and shares summing to 100.0%) is correct.

---

### R8. ONE‑OF‑N‑SITES

**Every fix in this diff was applied to all sites of its own shape.**  
- The tombstone check in `distribute.mjs` now matches the payment loop’s existing check.  
- The commitment scheme is implemented only in the mint program, which is the only program that needs it.  
- No other one‑of‑N defects were introduced.

---

## ACCEPTED LIMITS — FOUR QUESTIONS

1. **Is any limit WORSE than stated?**  
   No. Every limit accurately describes the remaining risk. In particular, the new tombstone check in `distribute.mjs` does not close limit 20 (poisoned ATA) because that is a separate mechanism.

2. **Is anything listed as a limit not actually a limit?**  
   No. All items are genuine, unrepaired defects or design consequences.

3. **Is any DISCHARGED item not actually discharged?**  
   No. Item 19 (unlevelled‑vault halt) is discharged by the on‑chain level and the new tombstone skip. The measurement that discharged items 12/17 (compute units) and 14 (duplicate attributes) is still valid.

4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?**  
   No. Items 22 and 23 remain open and are explicitly stated as blocking.

---

## ADDITIONAL FINDINGS

### `bank/deck.mjs` — Cross‑implementation drift risk (LOW)
The deck seed derivation is implemented in both Rust (`hashv`) and JavaScript (`sha`). While the suite proves they agree for the test salt and blockhash, a future change to either implementation could silently diverge. The test (2.0h) compares the stored seed against the JavaScript derivation, which catches drift. However, the test is performed only once per run.  
*Evidence:* The test at 2.0h.  
*Fix:* Add a regression test that runs the deck derivation for multiple random inputs and compares the program’s output against the JavaScript output.

### `scripts/run-tests.sh` — No guard against a stale `CBOB_CORE_SHA256` (LOW)
The Core hash is pinned in the script, but the script does not verify that the pinned hash is still the current mainnet Core. If Metaplex upgrades Core, the script will fail to build (because the cache will not match), but the failure is a silent exit (the `die` stops the test). An operator might not notice the mismatch.  
*Evidence:* The `CORE_SHA256_EXPECTED` is hardcoded.  
*Fix:* Add a warning or a mechanism to fetch the latest Core hash from a trusted source and compare before running.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

AI audit structurally cannot:
- **Execute long‑running, state‑dependent operations** (e.g., a full distribution run against a live chain).  
- **Reason about operational risk** (e.g., the permanent failure window in R1).  
- **Validate the correctness of external dependencies** (e.g., Metaplex Core’s behavior, the SlotHashes sysvar layout).  

**What the project should do:**

1. **Run a dry‑run distribution against a testnet with 2,100 simulated vaults** to exercise the I/O path, rate limits, and failure modes. This is OPEN AND BLOCKING limit 22.  
2. **Implement a fallback for the commitment scheme** – a governance‑gated re‑seed instruction that allows the operator to recover from a missed window without a program upgrade.  
3. **Add a continuous integration job that confirms the Core binary hash against a threshold signature** from a trusted party (e.g., the Squads multisig), so that a Core upgrade is detected before minting.  
4. **Formally verify the core redemption logic** (the `open_for_redemption` + `burn_vault` pairing) using a tool like SMT‑based verification, because AI can miss subtle instruction‑ordering bugs.  
5. **Write a runbook for every failure mode** listed in the accepted limits, and test the runbook in a dry‑run environment. The AI audit cannot predict operational surprises.