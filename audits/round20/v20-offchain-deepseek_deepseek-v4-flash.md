## REPORT: CBOB VAULT SYSTEM — ROUND 20 AUDIT

**Author:** AI Security Auditor  
**Scope:** Diff `acce0c1..HEAD` — the level system, Merkle deck, and Phase 1 self-audit fixes.  
**Assessed:** `bank/deck.mjs`, `programs/cbob-vault-mint/src/lib.rs`, `bank/distribute.mjs`, `tests/3prog.test.ts`, `bank/selftest.mjs`, `bank/detectors.mjs`, `scripts/run-tests.sh`, `scripts/audit-coverage.sh`, `SPEC.md` (as provided).  
**Method:** Static analysis, reasoning about binding, trace attacks, verifying arithmetic, checking one-of-N-sites.  
**Note:** No praise. Each finding is stated with a severity, the exact construct, the attacker/accident gain, the evidence that would exist on-chain or in a test run, and the fix.  

---

## R1. `bank/deck.mjs` — THE COMMITTED DECK

### R1‑A: Seed binding is sound, but salt revelation is unenforced (MEDIUM)

**Construct:** The seed is `sha256(bank_salt || blockhash(slot X))`. The Bank publishes `sha256(bank_salt)` and names slot X BEFORE minting opens. The Bank later reveals the salt.

**Attack/accident:** The Bank can choose the salt freely before publishing its hash. That is fine. The Bank cannot choose a salt after seeing the blockhash because the hash is fixed. The Bank cannot choose the blockhash because it is determined by the network at slot X. So the seed is binding **if the Bank reveals the salt**.  

**What if the Bank never reveals the salt?**  
There is no on-chain mechanism to force the salt to be revealed. The holders cannot verify the deck. The deck root is committed on-chain, but without the salt they cannot recompute the shuffle. The Bank can simply refuse to publish the salt, and nobody can prove cheating. This is a **trust assumption** that is not documented as a limit. The system’s security against a dishonest Bank rests on the assumption that the Bank will reveal the salt after minting closes.  

**Evidence:** The code has no instruction to write the salt onto the chain, no event that emits it, and no deadline for its revelation. The deck verification is entirely off-chain post-hoc.  

**Fix:** Either require the salt to be committed on-chain (e.g., as a second field in the config) and then revealed via a permissionless instruction, or accept this as a stated limit. The current design is a **medium** risk because the Bank could cheat with impunity if it never reveals the salt, and the holders have no recourse.

### R1‑B: Merkle construction is correct — no second‑preimage, odd‑node promotion, domain separation (LOW — no defect)

**Analysis:** The leaf tag is `0x00`, node tag `0x01`. The hash is `sha256(tag || index_le || level)` for leaf, and `sha256(tag || sorted(a) || sorted(b))` for node. The odd node is promoted unpaired, so a proof for a duplicated leaf cannot validate at the wrong index. The index is `minted_total` (u32), which the program owns. The proof length bound is 24 for 2,100 vaults (depth 12). All selftests pass. The JS and Rust implementations are proved to agree by the on‑chain suite building a proof in JS and verifying it in Rust.  

**No finding.** The construction is sound.

### R1‑C: The two implementations could disagree — but only if the test suite fails to catch it (LOW — already closed)

**Construct:** The deck module is written in JavaScript, the proof verification in Rust. The suite tests that the program verifies a proof built by the JS module.  

**Attack/accident:** A drift in either implementation (e.g., a different byte ordering, a different hash function, a different sort order) would cause the proof to fail on chain. The suite would go red immediately. The only way they could disagree in a way the suite would NOT catch is if the drift only affects decks larger than the test deck (90 cards) or specific seeds not used in the test. But the test exercises the same hash function and the same census shape. The Merkle logic is deterministic and independent of deck size. So the risk is negligible.  

**Evidence:** The test `11.1` mints a vault and asserts the level matches the deck’s card. If the implementations disagreed, this test would fail.  

**No finding.** The existing test is sufficient.

---

## R2. THE LEVEL ON CHAIN (`programs/cbob-vault-mint/src/lib.rs`)

### R2‑A: Level attribute reservation is case‑sensitive, but attacker cannot inject a fake level that bypasses the distribution (LOW — no real exploit)

**Construct:** The program checks `a.key != ATTR_LEVEL` where `ATTR_LEVEL = "level"`. The distribution code reads `attributeList.filter(a => a.key === 'level')` exactly.  

**Attack/accident:** A caller could use a key like `"Level"` (capital L) or unicode homoglyph. That would not be caught by the reserved-key check, so the vault would have two attributes: the attacker’s fake (e.g., `"Level" : "V"`) and the program’s real `"level" : "I"`. The distribution code filters for the exact string `"level"`, so it reads the real one. The attacker cannot affect the payout.  

**Evidence:** The on‑chain suite test `11.3` tests the exact key `"level"` and is rejected. It does not test a case‑variant. A test with `"Level"` would show that the vault is minted but the distribution reads the correct level.  

**Fix:** None needed. The behavior is correct: the program only appends lowercase `"level"`, and the reader only reads that. However, for defense in depth, the program could also reject any key that is equal to `"level"` ignoring case (or any key that matches `/(?i)^level$/`). This is a minor hardening, not a vulnerability.

### R2‑B: Level cap can be overrun if the deck census exceeds the cap (HIGH — design flaw)

**Construct:** `level_caps` is set at initialization. The deck census (number of cards per level) is determined by the shuffle. The program enforces `level_minted[li] < level_caps[li]` at mint. The deck is committed independently.  

**Attack/accident:** If the Bank sets `level_caps` lower than the corresponding census in the deck, then when the deck reaches a card for a level that is already full, minting will fail with `LevelCapReached`. This effectively burns the remaining mint slots. The Bank could deliberately set caps low to prevent certain levels from being minted, or could accidentally set them too low due to a miscalculation. The system has no check that the deck census does not exceed the caps.  

**Evidence:** The deck is committed with a specific census (e.g., [945,525,315,210,105]). The caps are set in `initialize` and can be different. The test suite sets caps equal to the deck census, but production could diverge. The code in `initialize` requires caps sum to <= max_supply and each > 0, but does not compare to the deck.  

**Fix:** Either require that `commit_deck` is called before `initialize` (or that the caps are checked against the deck before committing), or add a check that the deck census is <= caps. The safest is to have the deck census be part of the `commit_deck` instruction and verify that it does not exceed the caps. Alternatively, the caps could be derived from the deck census automatically. **HIGH** because it can cause a permanent denial of minting for legitimate holders.

### R2‑C: The deck proof is verified after the level cap, but the cap check is correct (LOW — no issue)

**Construct:** The order of checks in `mint_vault`: attribute validation, level range, pause, bank key confinement, collection, treasury, round, round cap, supply cap, level cap, deck proof, price, payment, CPI, counters.  

**Attack/accident:** Could an attacker skip the deck proof by causing the mint to fail before it? No, because the mint succeeds only if all checks pass. The level cap is checked before the deck proof, so if the cap is full, the mint fails before the proof is verified. That is correct: the cap is a hard ceiling, and the deck proof is only relevant if the level is within the cap.  

**Evidence:** The suite test `11.7` proves that a wrong level (not the deck’s card) is rejected with `BadDeckProof`, not `LevelCapReached`. The order is correct.  

**No finding.**

---

## R3. THE LEVEL AT PAYOUT (`bank/distribute.mjs`)

### R3‑A: Distribution makes 2,100 individual RPC calls to fetchAsset — severe performance and reliability risk (CRITICAL)

**Construct:** The distribution loop calls `fetchAsset(umi, umiPk(v))` for every vault. This is a single‑account RPC call per vault. For 2,100 vaults, that is 2,100 sequential RPC calls.  

**Attack/accident/risk:**  
- **Rate limits:** Most RPC providers throttle at ~100–200 requests per second. 2,100 calls could take tens of seconds or minutes, and may hit rate limits, causing timeouts.  
- **Partial failure:** If any single `fetchAsset` fails (network error, RPC error, time‑out), the entire distribution halts with an exception, and no one is paid. The error is caught and logged, but the distribution is aborted.  
- **Cost:** Each RPC call incurs cost (pay‑per‑request).  

**Evidence:** The code has never been run against a live chain (accepted limit #22). The test suite uses a local validator with a few vaults, so the performance is not tested. The accepted limit says it must be exercised before it pays anyone, but the risk is not mitigated.  

**Fix:**  
- Use `getMultipleAccounts` (Solana RPC batch) to fetch many asset accounts in one call. The `fetchAsset` function from mpl-core does not support batching, but you can use `getMultipleAccounts` to fetch the raw account data and then deserialize manually.  
- Alternatively, use DAS (which the author deliberately avoids) but with proper fail‑closed.  
- At minimum, add retries with backoff and a maximum number of failures before aborting.  
- Consider a two‑phase approach: first read all asset accounts, collect levels, then proceed to distribution.  

**CRITICAL** because it will fail in production, potentially halting payouts.

### R3‑B: The halt on unreadable level is correct but overly sensitive to RPC failures (HIGH — consequence of R3‑A)

**Construct:** `levelFromAttributes` returns `null` if the attribute list is missing or has more than one `level` key. The distribution then pushes the vault to `unreadableLevels` and prints the first three, then later throws an error if any unreadable levels exist.  

**Attack/accident:** A transient RPC error on a single vault (e.g., timeout) will cause the entire distribution to halt and pay nobody. This is already a risk from R3‑A. The design choice to halt rather than exclude is deliberate, but the fragility makes it a **HIGH** in combination with the RPC scalability issue.  

**Evidence:** The code catches exceptions from `fetchAsset` and adds to `unreadableLevels`. The distribution then throws an error (exit code 1) because `unreadableLevels` is non‑empty.  

**Fix:** The same as R3‑A: batch the reads and retry.

### R3‑C: Weighted allocation arithmetic is correct — dust bound is verified (LOW — no defect)

**Construct:** `allocateWeighted` uses integer division. The dust is `available - total`. The code asserts that `dust < activated.length` at worst. The test `dustAt(6404n) = 2099` confirms the bound.  

**Evidence:** The selftests in `bank/distribute.mjs` verify the arithmetic for the 2,100‑vault census.  

**No finding.**

---

## R4. THE PACKET BOUND IS A PRODUCT CONSTRAINT

### R4‑A: The real census (2,100 vaults, depth 11) is not measured in the suite — the test only measures depth 7 (HIGH)

**Construct:** The test `11.11` measures the maximum number of caller attributes that fit in a mint transaction for the test deck (90 cards, depth 7). It prints the result but does not assert that the real deck (2,100 cards, depth 11) still allows enough attributes.  

**Attack/accident:** The real deck has depth 11, which adds 4 extra proof elements (128 bytes) compared to depth 7. This reduces the attribute budget by about 4–5 attributes. The product needs only a few provenance attributes (notice serial, governor standing), so it likely still fits, but the margin is unknown. If the deck is later changed to a larger census (e.g., 10,000 vaults, depth 14), the budget could become zero. The code does not enforce any relationship between deck size and attribute budget.  

**Evidence:** The suite prints the max attributes for the test deck. The real deck is not built in the test. The accepted limit #23 says the deck size must be decided before minting, but does not require measuring the budget.  

**Fix:** Add a suite test that builds the 2,100‑card deck, commits it, and measures the attribute budget. If the budget is below the required minimum (say, 2 attributes), the test should fail. This should be a release gate.

### R4‑B: No assertion in the code or suite verifies the relationship at the real census (MEDIUM)

**Construct:** The only measurement is in the test, which prints a value. The code does not assert that the number of attributes the product actually needs fits at the real deck depth.  

**Attack/accident:** If the real deck is later changed (e.g., to a larger census, or to include more levels) without re‑measuring, the attribute budget could become insufficient. The first time someone tries to mint with the required attributes, the transaction will fail to serialize.  

**Fix:** Add a hard assertion in the test that builds the actual production deck and checks that the required number of attributes (e.g., 2) fits.

---

## R5. PHASE 1’S OWN CHANGES

### R5‑A: The selftest gate regex for “deck” matches “17 deck” — but the floor in deck.mjs is 16, creating a stale constant (MEDIUM)

**Construct:** `bank/deck.mjs` has `const FLOOR = 16` while the actual number of assertions in its selftest is 17. The `run-tests.sh` sets `DECK_FLOOR=17` and the floor function uses the output (which says `17/17`). So the external gate passes, but the internal constant is wrong.  

**Attack/accident:** If someone later removes an assertion from deck.mjs, the floor constant would prevent the self-test from failing (because `R.length < FLOOR` would be false as long as R.length >= 16). The constant is supposed to be the exact count, but it is one too low. This is a minor inconsistency that could mask a regression.  

**Fix:** Change `const FLOOR = 16` to `const FLOOR = 17` in `bank/deck.mjs`.

### R5‑B: The suite arms 11.13/11.14 prove that the level cannot be rewritten by owner or bank — but they rely on Core’s error code `0x1a` (NoApprovals). The `because` check is correct (LOW — no defect)

**Construct:** The test sends a hand‑built `UpdatePluginV1` instruction with the `Attributes` plugin and the level attribute. The instruction is signed by the owner or bank but the authority is the SEAL PDA. Core returns `NoApprovals` (error code `0x1a`). The `because` arm checks that the error string contains `0x1a`.  

**Attack/accident:** Could a different error code be returned? If the instruction is malformed, Core might return `0x1` (Deserialization) or `0x2` (Serialization). The test would then fail the `because` check and go red, alerting the developer. So the test is sound.  

**Evidence:** The test passes. The `because` arms are placed after the section 11, where the records exist.  

**No finding.**

### R5‑C: The corrected comment in `detectors.mjs` is accurate — the gap is timing, not capability (LOW — no defect)

**Construct:** The comment now says the co‑signer sees foreign nested assets, but the continuous detector does not.  

**Attack/accident:** The comment is true.  

**No finding.**

---

## R6. UNDER‑CLAIM DIRECTION

### R6‑A: The co‑signer refuses durable nonce transactions, but this is not documented in the accepted limits or the control table (LOW — under‑claim)

**Construct:** In `bank/cosign.mjs`, the `inspect` function checks for `SystemProgram.advanceNonceAccount` and refuses the transaction with a reason. This is a safety measure that prevents the Bank’s signature from being used on a transaction that never expires.  

**Attack/accident:** A malicious actor could create a durable nonce transaction, have the Bank sign it, and then hold it for a long time before submitting it. The scan would be arbitrarily old, and the airdrop race would be wide open. The co‑signer’s refusal closes this.  

**Evidence:** The code has the check. The documentation (SPEC.md) does not mention this as a feature. It is a safety measure that is not documented. This is an under‑claim: the system is safer than the documentation says.  

**Fix:** Document this in the control table or in the co‑signer section of SPEC.md.

---

## R7. COUNTS AND ARITHMETIC

### R7‑A: The deck.mjs floor constant is 16, but the actual count is 17 (MEDIUM — already reported in R5‑A)

**Duplicate:** See R5‑A.  

### R7‑B: The schedule arithmetic is verified and correct (LOW — no defect)

**Evidence:** The selftests in `bank/distribute.mjs` reproduce every figure from the weights. The denominator for 240 is 732, for 2,100 is 6405. Per‑$1,000 figures and shares sum to 100.0%.  

**No finding.**

---

## R8. ONE‑OF‑N‑SITES

### R8‑A: The deck.mjs floor constant was not updated when the deck assertions were added — the run-tests.sh floor is 17, but the code floor is 16 (MEDIUM — same as R5‑A/R7‑A)

**Construct:** The deck.mjs selftest was presumably added or modified in this diff, and the floor constant was set to 16 while the actual count became 17. The `run-tests.sh` floor was correctly set to 17. This is a one‑of‑N‑sites defect: the constant inside the module was not updated to match the external gate.  

**Fix:** Update the internal constant.

### R8‑B: The `pinnedAccountData` default parameter for version is used in the money jobs, but the comment in `bank/anchor.mjs` about the default is not asserted in the suite (LOW — no evidence of drift)

**Construct:** The `pinnedAccountData` function has a default `version = 1`. The money jobs call it without version, relying on the default. The suite test `pinnedAccountData` checks that the version is enforced, but does not assert that the callers use the default.  

**Attack/accident:** If a future editor adds a `version` parameter explicitly in one call site and forgets to update another, they could diverge. The suite does not catch this.  

**Fix:** Add a test that parses the source of all callers and ensures they either omit the version or supply the same value.

---

## ACCEPTED LIMITS — FOUR QUESTIONS

### 1. Is any limit WORSE than stated?

**No.** All accepted limits are accurately described. The cost and who is affected are stated.

### 2. Is anything listed as an accepted limit not actually a limit — already closed?

**No.** The accepted limits are real limits that have not been fixed. The discharged items are correctly closed.

### 3. Is any DISCHARGED item not actually discharged?

**No.**  
- #12/17 (compute units): measured on artifact, 10.1–10.4 pass.  
- #14 (duplicate attributes): test 11.4 passes.  
- #19 (unlevelled halt): the level is written at mint, no window. The distribution still halts, but only on genuine disagreement, not on customer action.

### 4. Is any OPEN AND BLOCKING being quietly treated as accepted?

**No.** #22 and #23 are explicitly marked as OPEN AND BLOCKING in the SPEC.md. The code does not treat them as accepted.

---

## OTHER FINDINGS

### F‑1: The `commit_deck` instruction is gated by `admin: Signer` — but the admin key is the same as the Bank’s? No, admin is separate. However, the admin could be compromised. The deck root is committed once and cannot be changed. If the admin is compromised, they could commit a malicious deck that gives all top levels to the attacker. The Bank’s salt is still in play, but the admin could collude with the Bank. This is a design choice, not a vulnerability. (LOW)

### F‑2: The `level_caps` are stored as `[u32;5]` but the deck index is `u32` (minted_total). The sum of caps must be <= max_supply (u64). No overflow. (LOW — no issue)

### F‑3: The `bank/cosign.mjs` `scanPda` function calls `getAssetsByOwner` with `page: 1, limit: 1000`. If the PDA owns more than 1000 assets, the function throws. This is a safety check. However, the error message says “refusing to judge a truncated list”. This is correct. But the call could be expensive if the PDA owns many assets. Unlikely for a vault PDA. (LOW)

### F‑4: The `levelFromAttributes` function requires exactly one `level` attribute. If the vault somehow has two (e.g., due to a bug in the program that appends a second one), the distribution halts. The program is designed to never produce two, but if a future upgrade introduces a bug, the halt is the safe direction. (LOW)

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS — WHAT SHOULD THE PROJECT DO?

1. **Formal verification of the Merkle‑deck implementation.** The two implementations (JS and Rust) are the single point of failure. A formal proof of equivalence would eliminate the “implementations could drift” risk. Use a tool like `dafny` or `verus` to verify the hash construction and proof verification.

2. **Staging environment with live‑scale distribution testing.** Before any real vaults exist, run a simulated distribution with 2,100 vaults against a test RPC that mimics production rate limits. Measure the time, cost, and failure modes. Implement batching (`getMultipleAccounts` or `getProgramAccounts` with filter) to reduce RPC calls.

3. **On‑chain salt publication.** Add a permissionless instruction to the MINT program that allows anyone to reveal the bank salt after minting closes. This could be a simple `reveal_salt` that writes the salt to a system account or emits an event. This makes the deck verifiable without relying on the Bank’s cooperation.

4. **Automatic check that deck census does not exceed caps.** In `commit_deck`, add a parameter for the census (the number of cards per level) and verify that each level’s cap is at least the census. This prevents the Bank from setting caps that would cause minting to fail.

5. **Assert the attribute budget at the real deck size in the suite.** Modify `tests/3prog.test.ts` to build the production deck (2,100 cards) and measure the maximum number of caller attributes that fit. Assert that it is at least the number the product actually needs (e.g., 2). This becomes a permanent regression gate.

6. **Add a circuit breaker for distribution failures.** If the distribution fails due to RPC errors, after a configurable number of retries, fall back to a manual mode where the operator can provide the level data (e.g., from a DAS snapshot) after verifying it. This is a last resort, but it prevents a total halt of payouts.

7. **Document the durable nonce refusal in the control table.** It is a safety feature that deserves a row.

8. **Fix the stale floor constant in `bank/deck.mjs`** (change `16` to `17`). This is a one‑line fix that prevents future confusion.

---

**END OF REPORT.**