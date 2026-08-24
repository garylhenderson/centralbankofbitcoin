## R1. The Commitment Scheme

**FINDING: MEDIUM** – The program’s `commit_seed` uses `Clock::get()?.slot` at execution time, not submission time. A Bank that controls the validator (or can bribe the leader) could strategically delay the transaction until a slot that, when added DECK_SLOT_LEAD, lands on a future slot whose leader the Bank controls.  

**What an attacker gains:** If the Bank is the leader of the entropy slot, it can influence the blockhash (by choosing which transactions to include) and thus the seed. The Bank cannot choose the slot arbitrarily, but it can choose *when* to submit the `commit_seed` transaction to influence which slot the validator picks. The 32‑slot lead (~13 seconds) is short enough that the leader schedule is known.  

**Evidence that would exist:** The leader schedule is public. If the Bank’s address appears as the leader for the entropy slot, and the **same** entity controls the Bank key, the seed is partially controllable. The suite does not test this scenario because the test validator runs with a fixed leader schedule.  

**Fix:** The program should derive the entropy slot from a **blockhash that is already committed** (e.g., the blockhash of the slot *before* `commit_seed`), not from a future slot whose leader could be the Bank. Alternatively, use a VRF oracle that neither party controls.  

**Note:** The current design *does* prevent the Bank from grinding the salt or the slot directly, but the residual risk of a validator‑Bank collusion is not addressed. Given the cost of such an attack (the Bank would need to be a validator or bribe one), the finding is MEDIUM, not CRITICAL.

---

## R2. Raw Parse of SlotHashes

**FINDING: LOW** – The `blockhash_of_slot` function uses `unchecked` arithmetic when reading the `count` field: `u64::from_le_bytes(data[0..8].try_into().unwrap())`. Although `try_into()` from a slice of known length cannot panic, the `unwrap()` is a code‑style issue that could hide a future bug if the slice length changes.  

**What an attacker gains:** Nothing directly; the parse is safe.  

**Fix:** Replace with `data[..8].try_into().expect("slice length is 8")` or use `read_u64_le` from a helper.  

**No other issue:** The layout, endianness, ordering, and failure‑closed behaviour are correct. The 512‑slot window is enforced and the missing window is fatal by design – this is a correct trade‑off.

---

## R3. The Halt in `bank/distribute.mjs`

**FINDING: MEDIUM** – The tombstone test `data[0] !== 1` correctly identifies a burned Core asset. However, the code **does not persist** the `burnedSinceIndex` list to the distribution ledger. If the alarm runs between the distribution pass and the next index update, the burned vaults are silently omitted from the current day’s payout, but the operator has no record of which vaults were skipped (only a console log).  

**What an attacker or accident gains:** A vault that is burned between the index build and the level loop is skipped, but the day’s `paid` record does not contain a row for it. The next day’s run will not see it (because the index will list it as burnt), so the owner is never paid. The console log is ephemeral; the operator cannot reconcile against it later.  

**Evidence:** The `burnedSinceIndex` list is printed but never saved to `st.days[day]`. The existing `paid` record for that vault is not created. If the vault was activated, its share is redistributed to the others, which is correct – but the fact that it was skipped is lost.  

**Fix:** Write a `skipped` entry for each burned vault into `st.days[day].paid`, exactly as done for `burnedMidRun` in the payment loop:  
```js
done[v] = { amount: '0', sig: null, skipped: 'vault was burned after the index was built' }
```
Then save the ledger.

---

## R4. Defects Already Found Inside This Diff

**FINDING: LOW** – The ordering fix in `commit_deck` is correct. The unfailable‑probe fix is correct. No other assertion in this diff is vacuously true.  

**But:** The `rec('2.0h')` assertion compares the seed stored by the program against the seed derived in JavaScript. This is a strong cross‑implementation check, but it **only** proves that the program’s internal `hashv` matches the JS `sha256`. It does **not** prove that the program read the correct blockhash from the SlotHashes sysvar – that is validated by the fact that the test waits for the same slot and reads the same sysvar. If the program’s `blockhash_of_slot` had an off‑by‑one in the loop, the test would still pass because both sides read the same incorrect hash.  

**Evidence:** The test reads the blockhash from the same sysvar using the same layout. If `blockhash_of_slot` had a bug (e.g., skipping the first entry), both sides would skip it and agree. The test does not independently verify the blockhash against a third source.  

**Fix:** The test should also read the blockhash via a different method (e.g., `getBlock` RPC) to confirm the program’s choice.  

---

## R5. Suite’s New Arms

**FINDING: LOW** – The `because('2.0c')` through `2.0i` tests are correctly ordered and pin the right error codes. The `2.0h` cross‑implementation check is valid but limited (see R4).  

**Offsets are correct:** `OFF_DECK_SLOT=593` and `OFF_DECK_SEED=601` match the struct layout computed from the Rust source.  

**No vacuously true assertions:** The `11.11` series now asserts that the packet bound is actually reached and that deeper decks yield fewer attributes. The loop ceiling is 64, so the only way to get a false positive is if the packet never binds (unlikely with 64 iterations).  

---

## R6. Accepted Limits Corrections

**FINDING: NONE** – The rewrites of limit 1a and 23 are accurate. Limit 1a now correctly states that the Bank‑pubkey confinement is on‑chain in both programs. Limit 23’s measurement is now taken and the table is correct. No under‑claim or over‑claim remains.

---

## R7. Counts and Arithmetic

**FINDING: NONE** – The floors read from `scripts/run-tests.sh` are verified:  
- MIN_ASSERTIONS=330  
- DET_FLOOR=439  
- ALLOC_FLOOR=103  
- DECK_FLOOR=17  
- MAINNET_FLOOR=19  

The schedule arithmetic is correct:  
- 240 vault census: 108+60+36+24+12 = 240, denominator 732  
- 2100 vault census: 945+525+315+210+105 = 2100, denominator 6405  
- per‑$1,000 figures and shares sum to 100.0%  

---

## R8. One‑of‑N‑Sites

**FINDING: NONE** – Every fix in this diff is applied to all sites of its shape:
- The one‑shot check ordering was fixed only in `commit_deck`; no other function had a similar ordering issue.  
- The unfailable‑probe fix was applied to the only probe that existed.  
- The tombstone fix in `distribute.mjs` was applied to the level loop; the payment loop already had the same check.  
- The accepted‑limit rewrites are applied to the only copy of the limits (SPEC.md).  

No recurrence of the signature defect.

---

## Questions About Accepted Limits

**1. Is any limit WORSE than stated?**  
No. All accepted limits are accurately described. The most concerning is limit 2 (coverage refusal has no override) – but it is stated as buyer‑facing and the escape is a human signing by hand, which is documented.

**2. Is anything listed as a limit not actually a limit?**  
No. All items under ACCEPTED are genuine unrepaired findings.

**3. Is any DISCHARGED item not actually discharged?**  
The three discharged items (12/17 compute units, 14 duplicate attributes, 19 unlevelled‑vault halt) are all closed by measurement or on‑chain enforcement. The compute‑unit measurement is on the artifact and gated by assertions. The duplicate‑attribute check is on‑chain. The unlevelled‑vault halt is closed by construction (level written at mint). All are correctly discharged.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**  
No. Items 22 and 23 are still open. Item 23’s measurement was taken, but the item remains open because the root commits once. The suite now asserts the constraint, but the decision of deck size is still before minting opens. The item is correctly treated as blocking.

---

## Other Findings

**FINDING: MEDIUM – `distribute.mjs` does not handle the case where `fetchAsset` returns a valid asset with a **missing** `attributeList`.**  
`levelFromAttributes` checks `Array.isArray(attributeList)` and returns `null` if not. If the asset’s plugin data is corrupted or empty, the vault is added to `unreadableLevels` and the distribution halts. This is the correct behaviour – but a single corrupted vault can halt the entire day’s payout.  

**What an attacker gains:** If the attacker can cause a vault’s attribute list to become unreadable (e.g., by a data‑corruption attack on the Core account), they can stop the distribution. The cost is the transaction fee.  

**Evidence:** The code does not distinguish between a missing attribute list and a valid one; both result in a halt.  

**Fix:** Consider logging the attribute list that was read to help diagnose the cause. The halt itself is a design choice (accepted limit 19), but the diagnosis cost is high. No code change is required; the finding is MEDIUM because the halt is intended.

---

**FINAL: GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that nineteen rounds of AI audit structurally cannot?**

1. **Run a live dry‑run distribution against a test ledger with real‑scale data.** The suite runs against a local validator with a handful of vaults. The production scale (~2,100 vaults) introduces I/O, rate limits, and paging issues that no AI audit can simulate. A full dry‑run (with `--dry-run`) on a testnet with the real collection size would reveal bottlenecks, RPC timeouts, and `fetchAsset` failure patterns.  
2. **Deploy to a testnet with a small number of real customers and monitor the alarm for one week.** The off‑chain pipeline’s interaction with the actual cluster (DAS, signature walks, ledger persistence) cannot be fully validated offline. A week‑long test with real transactions (minting, redeeming, distributing) would surface edge cases in the alarm’s correlation logic and the lock’s OS‑lease behaviour.  
3. **Write a formal specification for the commitment scheme that can be symbolically verified.** The two‑step seed commitment is the most critical new logic. An AI round can review the code, but it cannot prove that the Bank cannot influence the seed under any validator behaviour. A formal model (e.g., TLA+ or a Coq proof) would provide the certainty that the design is sound against all possible validator strategies.  
4. **Create a “chaos monkey” test that injects random RPC failures, account deletions, and sysvar mutations.** The code’s failure‑closed behaviour is asserted in the suite, but the number of failure modes is large. A fuzzer that runs against a modified validator (or a mock) would catch a missing `require!` or a silent fallback.  
5. **Publish the Bank’s operational policy as a signed document with a version.** The policy (which transactions the co‑signer will sign) is currently only in the code. A human‑readable, signed policy that holders can verify against the deployed co‑signer’s behaviour would be the strongest guarantee that the Bank’s half is predictable. AI cannot produce a legally binding document, but it can generate the content. Have a human with signing authority publish it.