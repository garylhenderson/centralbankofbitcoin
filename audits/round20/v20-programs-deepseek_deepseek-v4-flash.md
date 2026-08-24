I’ve read the entire diff and the full context. I will follow the required format: R1–R8, then the four questions about the accepted limits, then anything else. I will not praise the work. I will assume the author is wrong until proven otherwise.

---

## R1. `bank/deck.mjs` — 182 lines no auditor has read in twenty rounds

### CRITICAL: The seed is NOT binding. The Bank can choose the salt after seeing the blockhash.

**The construct:**  
`seed = sha256(bank_salt ‖ blockhash(slot X))`  
`sha256(bank_salt)` is published first. The Bank names slot X before minting opens.

**The attack:**  
The Bank can generate many candidate salts, compute `sha256(candidate)` for each, and choose the one whose published hash matches a preimage they already know. This is a **second-preimage search** on SHA-256, which costs ~2^128 work — infeasible. So that specific attack is closed.

**But the Bank can choose the salt AFTER seeing the blockhash, by grinding the salt space for a favourable deck.**  
The Bank publishes `sha256(bank_salt)` before slot X. At slot X, the blockhash is fixed. The Bank then chooses `bank_salt` from a large set of candidates, each producing a different deck. The Bank picks the salt that gives the most Level V cards to addresses it controls. This costs one SHA-256 per candidate, which is trivial for a few billion candidates — a few CPU-hours. The published hash binds the Bank to *some* salt, but not to a *fair* one.

**The evidence that would exist if this claim is true:**  
A Bank that grinds salts will produce a deck whose Level V distribution is skewed toward addresses the Bank controls. This is detectable post-hoc by anyone who recomputes the deck from the revealed salt. But the detection is after the fact, not a prevention.

**The fix:**  
The salt must be committed BEFORE the blockhash is known, not merely hashed. The Bank should publish the full salt (not its hash) before slot X, or use a commit-reveal where the salt is committed before slot X and revealed after. The current scheme commits only to the hash, which leaves the salt free to be chosen after the blockhash.

**Severity: CRITICAL** — the entire fairness guarantee of the deck rests on this binding. It does not bind.

---

### HIGH: If the Bank never reveals the salt, no holder can verify the deal.

**The construct:**  
The Bank publishes `sha256(bank_salt)` before minting. After minting, the Bank is supposed to reveal `bank_salt` so anyone can recompute the deck and verify every vault's level.

**The attack:**  
The Bank simply never reveals the salt. There is no on-chain mechanism to force revelation. The Merkle root is on chain, the proofs are on chain, but the salt that seeds the shuffle is held by the Bank. Without it, no holder can verify that their level was honestly dealt. The Bank could have used any salt, including one chosen after the blockhash (see above).

**The evidence that would exist if this claim is true:**  
The salt is never published. The project's documentation says "at close the Bank reveals the salt", but there is no deadline, no penalty, no on-chain commitment to reveal. The salt could remain secret forever.

**Is this a limit, a defect, or an unfalsifiable claim?**  
It is a **defect**. The system's fairness is unfalsifiable without the salt. The Bank's promise to reveal is not enforced.

**The fix:**  
The salt must be committed on-chain (not just its hash published off-chain) with a timelock that automatically reveals it after minting closes. Or use a VRF that produces a verifiable random output on-chain, eliminating the need for a secret salt entirely.

**Severity: HIGH** — the deck is the only thing preventing the Bank from hand-picking levels. If the salt is never revealed, the deck is unverifiable.

---

### MEDIUM: Merkle construction — second-preimage across leaf and internal nodes is correctly prevented by domain separation.

**The construct:**  
Leaf tag = `0x00`, node tag = `0x01`. Both are single bytes prepended to the hash input.

**Analysis:**  
This is correct. A leaf is `sha256(0x00 ‖ index_le ‖ level)`. An internal node is `sha256(0x01 ‖ left ‖ right)`. The tags are different, so a 64-byte leaf cannot be replayed as an internal node. The classic second-preimage attack on a Merkle tree that hashes both the same way is prevented.

**No finding here.**

---

### MEDIUM: Odd-node promotion rule is correct — self-pairing would allow a proof for a duplicated leaf to validate at the wrong index.

**The construct:**  
When a layer has an odd number of nodes, the last node is promoted unpaired rather than being hashed with itself.

**Analysis:**  
This is correct. Self-pairing would let a proof for a leaf at index `i` validate at index `i+1` if the leaf at `i+1` is identical (duplicate leaf). The promotion rule prevents this.

**No finding here.**

---

### MEDIUM: Duplicate leaves are not possible because the deck is a permutation of a multiset with distinct indices.

**The construct:**  
The deck is built from `census[k]` cards of level `k+1`. The leaf is `sha256(0x00 ‖ index_le ‖ level)`. The index is `minted_total`, which is unique per mint.

**Analysis:**  
Two leaves with the same level but different indices produce different hashes. Duplicate leaves are impossible because the index is always unique.

**No finding here.**

---

### MEDIUM: A proof that validates against the wrong index is prevented by the leaf including the index.

**The construct:**  
The leaf is `sha256(0x00 ‖ index_le ‖ level)`. The index is part of the leaf hash.

**Analysis:**  
A proof for index 7 cannot validate at index 8 because the leaf hash would be different. This is correct.

**No finding here.**

---

### MEDIUM: Depth ambiguity is prevented by the proof length being bounded by `MAX_DECK_PROOF = 24`.

**The construct:**  
The program checks `deck_proof.len() <= MAX_DECK_PROOF`. The maximum depth for 2,100 vaults is 12, which is well under 24.

**Analysis:**  
A proof that is too short or too long would fail the length check. Depth ambiguity is not a concern.

**No finding here.**

---

### CRITICAL: Two implementations of one hash scheme — the suite does NOT prove they agree for all inputs.

**The construct:**  
`bank/deck.mjs` implements `leaf`, `node`, `deck_root_from` in JavaScript.  
`programs/cbob-vault-mint/src/lib.rs` implements `deck_leaf`, `deck_root_from` in Rust.

**The claim:**  
The suite proves they agree because the test builds a proof in JS and the program verifies it.

**The attack:**  
The suite tests a **single deck** with a **single seed** and a **single set of indices**. It does not test:
- All possible index values (0 to 2^32-1)
- All possible level values (1 to 5)
- All possible proof lengths (0 to 24)
- Edge cases like index = 0, index = 2^32-1, level = 0 (invalid), level = 6 (invalid)
- The case where the proof is empty (one-card deck)
- The case where the proof has the maximum length (24)

If the two implementations disagree on any input, the suite would catch it **only if that input is exercised**. The suite exercises exactly one deck of 90 cards (the test deck) and a handful of indices. It does not exercise the full 2,100-card deck, nor does it exercise every possible index.

**The evidence that would exist if this claim is true:**  
A disagreement would manifest as a `BadDeckProof` error on a mint that should succeed. This would be a hard failure, not a silent one. But the disagreement could be on an input that never occurs in practice — for example, a hash collision in SHA-256 is astronomically unlikely, but a bug in the byte ordering of `u32le` would affect every index.

**The specific risk:**  
The JS implementation uses `Buffer.writeUInt32LE(n)` and the Rust implementation uses `index.to_le_bytes()`. These must produce identical byte sequences for all 32-bit values. They do for the test values (0, 1, 7, 1049, 2099), but are they identical for all 2^32 values? Yes, because both are standard little-endian encoding. This is not a risk.

The real risk is a **logic error** in one implementation that the suite does not exercise. For example, if the JS implementation has an off-by-one in the loop that builds the proof, it would produce a wrong proof for some indices. The suite tests indices 0, 1, 1049, 2099 for the 2,100-card deck. If the bug is at index 1500, the suite would not catch it.

**The fix:**  
The suite must test every index of the production deck, or at least a statistically significant sample. Better: the two implementations should be proven equivalent by a formal method, or one should be generated from the other.

**Severity: CRITICAL** — a disagreement between the two implementations would cause minting to fail for some indices, or worse, accept a wrong level for some indices. The suite does not prove agreement for all inputs.

---

## R2. The level on chain (`programs/cbob-vault-mint/src/lib.rs`)

### HIGH: A caller can get a level it was not dealt by exploiting the reserved-key check.

**The construct:**  
The program checks `a.key != ATTR_LEVEL` for each caller-supplied attribute. The program then appends the level attribute itself.

**The attack:**  
The check is case-sensitive. If the caller supplies an attribute with key `"Level"` (capital L), it passes the reserved-key check because `"Level" != "level"`. The program then appends `"level"` as a second attribute. The vault now has two attributes: `"Level": "V"` and `"level": "I"`. The distribution code (`levelFromAttributes`) reads the first `"level"` attribute (lowercase), which is the one the program wrote. So the caller's `"Level"` attribute is ignored.

**But what if the caller supplies `"level"` with a Unicode homoglyph?**  
The check is `a.key != ATTR_LEVEL`. In Rust, `String` comparison is byte-by-byte. A Unicode homoglyph like `"ⅼevel"` (U+217C, small Roman numeral fifty) is a different byte sequence and passes the check. The program then appends `"level"` as a second attribute. The distribution code reads the first `"level"` attribute, which is the program's. So the caller's homoglyph attribute is ignored.

**The evidence that would exist if this claim is true:**  
A vault with a homoglyph `"level"` attribute would have two attributes that look identical to a human but are different byte sequences. The distribution code would read the program's attribute and ignore the caller's. This is not exploitable for level manipulation.

**No finding here** — the reserved-key check is sound for the intended purpose. The caller cannot overwrite the program's level attribute because the program appends it after the caller's attributes, and `levelFromAttributes` reads the first `"level"` attribute, which is the program's.

---

### HIGH: The quota can be overrun if `level_caps` sum to more than `max_supply`.

**The construct:**  
`initialize` checks `cap_total <= max_supply`. But `level_caps` are `[u32; 5]` and `max_supply` is `u64`. The sum of `level_caps` could overflow `u32` but not `u64`.

**The attack:**  
If `level_caps = [u32::MAX, u32::MAX, u32::MAX, u32::MAX, u32::MAX]`, the sum is `5 * u32::MAX = 21474836475`, which fits in `u64`. The check `cap_total <= max_supply` passes if `max_supply` is at least that large. But `max_supply` is `u64`, so it can be. The level caps are then effectively unlimited.

**But this is not an attack** — the admin sets these values at initialization. If the admin sets caps that sum to more than `max_supply`, the check fails. If the admin sets caps that sum to exactly `max_supply`, then the total number of vaults is bounded by `max_supply`, and each level's cap is a sub-limit. This is correct.

**No finding here.**

---

### HIGH: When one level's cap is exhausted but the deck still deals that card, minting halts for everybody.

**The construct:**  
The deck is a fixed permutation. If level V's cap is exhausted but the deck still has level V cards at future indices, `mint_vault` will refuse with `LevelCapReached`. This halts minting for **everyone**, not just for level V.

**Is this the intended behaviour?**  
The comment says "the census is a hard on-chain ceiling, not a target". The deck must be built so that the caps are never exhausted before the deck's supply of that level is exhausted. If the caps are set correctly (e.g., `level_caps` = census), this never happens.

**But what if the caps are set incorrectly?**  
If `level_caps[4] = 10` but the deck has 12 level V cards, minting halts at the 11th level V attempt. The remaining level V cards in the deck are unreachable. This is a configuration error, not a code defect.

**No finding here** — the behaviour is correct by design. The deck must be built to match the caps.

---

### MEDIUM: The deck proof and the confinement share one instruction — ordering cannot skip checks.

**The construct:**  
`mint_vault` checks:
1. Name/URI length
2. Attributes (reserved keys, duplicates, count)
3. Level range (1..=5)
4. Paused
5. Bank key
6. Collection
7. Revenue address
8. Round timing
9. Round cap
10. Supply cap
11. Level cap
12. Deck proof
13. Price
14. Payment
15. SEAL config
16. CreateV2 CPI
17. Increment counters

**Analysis:**  
All checks are sequential. No check can be skipped by ordering because they are all in the same function. Account substitution is prevented by Anchor's `#[derive(Accounts)]` constraints and the in-handler `require_keys_eq!` checks.

**No finding here.**

---

## R3. The level at payout (`bank/distribute.mjs`)

### OPEN AND BLOCKING (accepted limit 22): Nothing has ever run this against a live chain.

**The construct:**  
`distribute.mjs` now reads each vault's level with `fetchAsset` over ~2,100 vaults. This is a loop of 2,100 sequential RPC calls to Core's account deserializer.

**What breaks at scale:**
1. **Rate limits:** Helius (the RPC) has a rate limit. 2,100 sequential calls at ~10ms each = 21 seconds. If the rate limit is 100 req/s, this is fine. If it's 10 req/s, it takes 210 seconds and may hit timeouts.
2. **Paging:** The vault list is fetched from DAS with `getAssetsByGroup`. The test uses a 90-card deck; production uses 2,100. The DAS call may need multiple pages (limit 1000). The code handles this with a loop up to 50 pages.
3. **Partial failure:** If the RPC fails on vault 1,900 of 2,100, the entire distribution halts. The error is caught and added to `unreadableLevels`, which halts the distribution. This is correct behaviour (fail closed), but it means a single transient RPC error stops all payouts.
4. **Cost:** 2,100 `fetchAsset` calls at ~0.00001 SOL each = 0.021 SOL. This is negligible.

**The evidence that would exist if this claim is true:**  
The first live run will either succeed or fail. If it fails, the error will be in the logs. The accepted limit says "this must be exercised before it pays anyone."

**No fix needed** — this is an accepted limit. But the severity is **OPEN AND BLOCKING**.

---

### HIGH: A vault whose level cannot be read halts the whole distribution — reachable by an ordinary customer action.

**The construct:**  
`levelFromAttributes` returns `null` if:
- The attribute list is not an array
- There is not exactly one `"level"` attribute
- The level value is not in `LEVEL_WEIGHTS`

**The attack:**  
A customer can mint a vault with a homoglyph `"level"` attribute (e.g., `"ⅼevel"`). The program's reserved-key check passes (different byte sequence). The program appends `"level"` as a second attribute. The vault now has two attributes: `"ⅼevel": "V"` and `"level": "I"`. The distribution code's `levelFromAttributes` filters for `a.key === 'level'` (exact match), finds exactly one (the program's), and returns `"I"`. So the homoglyph attack does not work.

**But what if the program's `"level"` attribute is somehow missing?**  
The program always appends the level attribute. There is no code path that skips this. The only way the level attribute is missing is if the vault was minted by a different program or before the level feature was added. Since no vaults have been minted yet, this is not a concern.

**The evidence that would exist if this claim is true:**  
A vault with no level attribute would halt the distribution. The error message would say "no single valid `level` attribute on the asset". This is the intended behaviour.

**No finding here** — the halt is deliberate and the claim that it is not reachable by an ordinary customer action is correct, because the program always writes the level attribute.

---

### MEDIUM: `allocateWeighted` arithmetic — weights 2/3/4/5/6, census, denominator, dust.

**The construct:**  
`vault_share = drop * vault_weight / denominator`, integer division. Dust = `available - total`.

**Analysis:**  
- Weights: I=2, II=3, III=4, IV=5, V=6. Correct.
- Census: 108/60/36/24/12 for 240 vaults, 945/525/315/210/105 for 2,100 vaults. Correct.
- Denominator: sum of weights of activated vaults. Correct.
- Dust: carries forward, never split. Correct.
- Two vaults at the same level receive the same amount because they have the same weight and the same denominator. Correct.

**No finding here.**

---

## R4. The packet bound is a product constraint (`tests/3prog.test.ts`, section 11)

### CRITICAL: The real census is 2,100 vaults (depth 11). The attribute budget at that depth is unknown.

**The construct:**  
The deck proof shares the 1,232-byte transaction with the caller's attributes. The test measures the budget at depth 7 (a 90-card test deck) and finds that 7 caller attributes fit.

**The problem:**  
The production deck has 2,100 cards, which is depth 11 (log2(2100) ≈ 11). The proof at depth 11 is 11 hashes × 32 bytes = 352 bytes. The proof at depth 7 is 7 × 32 = 224 bytes. The difference is 128 bytes.

The transaction size is:
- Header: ~100 bytes
- Instructions: variable
  - `mint_vault` discriminator: 8 bytes
  - name: ~30 bytes
  - uri: ~40 bytes
  - max_price: 8 bytes
  - attributes: variable
  - level: 1 byte
  - deck_proof length: 4 bytes
  - deck_proof: 11 × 32 = 352 bytes
- Account keys: 12 × 32 = 384 bytes
- Signatures: 64 bytes each

The deck proof at depth 11 is 352 bytes. At depth 7, it's 224 bytes. The difference is 128 bytes. This means the attribute budget at depth 11 is 128 bytes less than at depth 7.

The test measures 7 caller attributes at depth 7. Each attribute is roughly `key_len + value_len + 8 bytes overhead`. If each attribute is ~20 bytes, 7 attributes = ~140 bytes. At depth 11, the budget is 128 bytes less, so only ~3-4 attributes would fit.

**The evidence that would exist if this claim is true:**  
A mint with 5 provenance attributes would fail to serialize at depth 11. The product needs at least 2 provenance attributes (notice serial, governor standing). If the budget is only 3-4 attributes, this is tight but workable.

**The fix:**  
The deck depth must be measured at the production census (2,100), not at the test census (90). The attribute budget must be verified to accommodate the provenance attributes the product actually needs. If it does not, the deck size must be reduced or the transaction must use versioned transactions with address lookup tables.

**Severity: CRITICAL** — the deck root is committed once and cannot be changed. If the attribute budget at depth 11 is insufficient, the product cannot mint the provenance attributes it needs.

---

### MEDIUM: Nothing in the code or the suite ASSERTs the relationship between deck depth and attribute budget.

**The construct:**  
The test prints the measured budget but does not assert a minimum. The comment says "the real census is 2,100 vaults, which is depth 11. Re-derive the budget at that depth."

**Analysis:**  
The test measures the budget at the test deck depth (7) and asserts that it is less than `MAX_ATTRS_BORSH` (8). It does not assert that the budget at depth 11 is sufficient for the product's needs. This is a documentation gap, not a code defect.

**No finding here** — the test is honest about what it measures. The product must verify the budget at the production depth before minting opens.

---

## R5. Phase 1's own changes — newest code, least read, highest priority

### HIGH: The stated-count gate in `bank/selftest.mjs` — the new `matchAll` gate is sound.

**The construct:**  
The gate now uses `matchAll` over five floors: `on-chain`, `detector`, `allocation`, `deck`, `mainnet`. Each regex is anchored on a word that describes the count.

**Analysis:**  
- `on-chain`: `/(\d+) assertions, real cloned Core/g` — matches "316 assertions, real cloned Core". Correct.
- `detector`: `/(\d+) detector\b/g` — matches "439 detector". Correct.
- `allocation`: `/(\d+) allocation\b/g` — matches "103 allocation". Correct.
- `deck`: `/(\d+) deck\b/g` — matches "17 deck". Correct.
- `mainnet`: `/(\d+) live-mainnet\b/g` — matches "19 live-mainnet". Correct.

**The risk:**  
If a new sentence in SPEC mentions "17 deck" in a different context (e.g., "the deck has 17 cards"), the regex would match it and the gate would pass even if the floor is wrong. But the regex is anchored on the word "deck", not on the phrase "deck assertions". A sentence like "the deck has 17 cards" would match `/(\d+) deck\b/g` and produce a false positive.

**The evidence that would exist if this claim is true:**  
If SPEC says "the deck has 17 cards" and the real floor is 17, the gate passes. If the real floor is 18, the gate fails because `found.every(n => n === want)` would compare 17 to 18. So a false positive is not possible — the gate would fail if the number is wrong, even if it matches the wrong sentence.

**No finding here** — the gate is sound.

---

### MEDIUM: The three new suite arms (11.13, 11.14, 11.15) — they prove what they claim.

**The construct:**  
11.13: the vault owner cannot rewrite its level.  
11.14: the Bank cannot rewrite its level.  
11.15: the level on chain is still the one the deck dealt.

**The evidence:**  
11.13 and 11.14 both reject with `0x1a` (NoApprovals). This is confirmed by the `because` check. 11.15 reads the level back and confirms it matches the deck's card.

**What else could produce `0x1a` here?**  
`0x1a` is Core's `NoApprovals` error. It means the instruction was well-formed but the signer was not authorised. The only way to get `0x1a` is to attempt an operation that requires an authority the signer does not have. The owner and the Bank are both unauthorised to update the Attributes plugin because its authority is the SEAL PDA. So `0x1a` is the correct error for both.

**Is there an actor the two arms do not cover?**  
The SEAL program's upgrade authority could deploy a new instruction that rewrites attributes. This is covered by accepted limit 13: "the level is immutable in practice because no shipped instruction can rewrite it, and immutable in principle only as far as the SEAL program's upgrade authority is trustworthy."

**No finding here.**

---

### MEDIUM: The corrected comment in `bank/detectors.mjs` — the gap is timing, not capability.

**The construct:**  
The comment now says: "the accurate limit is about TIMING, not capability: nothing warns CONTINUOUSLY, so a holder learns at the moment they try to redeem."

**Analysis:**  
This is correct. The co-signer (`bank/cosign.mjs`) scans the asset-signer PDA and fails closed on a foreign nested asset. The alarm (`detectNestedVaults`) does not scan for foreign assets because it walks only our collection. So a foreign nested asset is detected at redemption time, not continuously.

**No finding here.**

---

## R6. The under-claim direction

### HIGH: `bank/cosign.mjs` under-claims its own capability — it says "the program allowlist and the Bank-pubkey confinement are OFF-CHAIN" (accepted limit 1a), but the Bank-pubkey confinement is now ON-CHAIN.

**The construct:**  
Accepted limit 1a says: "The program allowlist and the Bank-pubkey confinement are OFF-CHAIN. Nothing in any program bounds what else a redemption transaction contains."

**The truth:**  
SEAL's `open_for_redemption` now walks every top-level instruction and refuses `BankKeyOutsidePair` if `config.bank` appears outside the open/burn pair. MINT's `mint_vault` refuses `BankKeyOutsideMint`. The Bank-pubkey confinement is ON-CHAIN in both programs.

**The evidence that would exist if this claim is true:**  
The accepted limit document says it's off-chain, but the code says it's on-chain. The control table in SPEC.md correctly lists it as ON-CHAIN. The accepted limit is wrong.

**The fix:**  
Accepted limit 1a must be updated to reflect that the Bank-pubkey confinement is now on-chain. Only the program allowlist remains off-chain.

**Severity: HIGH** — an accepted limit that is wrong about a critical control could lead to incorrect risk assessment.

---

## R7. The counts and the arithmetic, independently

### MEDIUM: The floors are read from `scripts/run-tests.sh` — verified.

**The construct:**  
The prompt says the floors are read from `scripts/run-tests.sh` rather than typed. I verified:
- `DECK_FLOOR=17` — matches the deck selftest's `FLOOR = 16`? No, the deck selftest has `FLOOR = 16`, but `DECK_FLOOR=17`. This is a discrepancy.

**The evidence:**  
`bank/deck.mjs` line 179: `const FLOOR = 16`  
`scripts/run-tests.sh` line 163: `DECK_FLOOR=17`

The deck selftest has 16 assertions. The runner expects 17. If the deck selftest produces exactly 16 assertions, the runner's floor check `[ "$n" -eq "$4" ]` would fail because 16 != 17.

**Is this a bug?**  
The deck selftest's `FLOOR` is 16, but the runner's `DECK_FLOOR` is 17. If the deck selftest produces 16 assertions, the runner would fail. But the deck selftest's `FLOOR` is a minimum, not an exact count. The runner's `-eq` check requires exact equality. So if the deck selftest produces 17 assertions (which it does, because the test at line 176 checks `deckProof(...).length <= 24` and that is one assertion), the runner passes.

**No finding here** — the numbers are consistent. The deck selftest produces 17 assertions, which matches `DECK_FLOOR=17`.

---

### MEDIUM: The schedule's published figures — verified.

**The construct:**  
- Census 108/60/36/24/12 → 732 denominator. Verified: `108*2 + 60*3 + 36*4 + 24*5 + 12*6 = 216 + 180 + 144 + 120 + 72 = 732`. Correct.
- 945/525/315/210/105 → 6,405 denominator. Verified: `945*2 + 525*3 + 315*4 + 210*5 + 105*6 = 1890 + 1575 + 1260 + 1050 + 630 = 6405`. Correct.
- Per-$1,000 figures at 240 vaults: `1000 * weight / 732`. I=2.73, II=4.10, III=5.46, IV=6.83, V=8.20. Correct.
- Per-$1,000 figures at 2,100 vaults: `1000 * weight / 6405`. I=0.31, II=0.47, III=0.62, IV=0.78, V=0.94. Correct.
- Shares at 2,100: `100 * census * weight / 6405`. I=29.5, II=24.6, III=19.7, IV=16.4, V=9.8. Sum = 100.0. Correct.

**No finding here.**

---

## R8. One-of-N-sites

### HIGH: The `commit_deck` instruction is added to MINT but not to the test suite's `initialize` call.

**The construct:**  
The diff adds `commit_deck` to `programs/cbob-vault-mint/src/lib.rs`. The test suite (`tests/3prog.test.ts`) calls `commitDeck` after `initialize`. But the `initialize` instruction now includes `level_caps` as a parameter. The test suite's `initialize` call includes `caps5(LEVEL_CAPS)`.

**The one-of-N-sites check:**  
Is `commit_deck` added to all sites that call `initialize`? The test suite calls `initialize` once. The production deployment script (`scripts/run-tests.sh`) does not call `initialize` — it uses the test suite. So there is only one site.

**But is `commit_deck` callable by anyone other than admin?**  
The `CommitDeck` struct has `has_one = admin`, so only admin can call it. This is correct.

**No finding here.**

---

### HIGH: The `level` attribute is reserved in `mint_vault` but not in any other instruction that writes attributes.

**The construct:**  
`mint_vault` checks `a.key != ATTR_LEVEL` for each caller-supplied attribute. But there is no other instruction that writes attributes. The SEAL program has no `mark_opened` in v5. So there is no other site to check.

**No finding here.**

---

## The four questions about the accepted limits

### 1. Is any limit WORSE than stated?

**Accepted limit 1a: "The program allowlist and the Bank-pubkey confinement are OFF-CHAIN."**

This is **worse than stated** because it is **wrong**. The Bank-pubkey confinement is ON-CHAIN in both SEAL and MINT. The accepted limit says it's off-chain, which understates the protection. But the direction of the error is that the system is **more secure** than the limit states, not less. So this is not a finding that makes the system worse.

**Accepted limit 9: "Nothing detects a FOREIGN Core asset nested in a vault CONTINUOUSLY."**

This is **exactly as stated**. The co-signer detects it at redemption time, but not continuously. The limit is accurate.

**Accepted limit 16: "The Bank-as-fee-payer gap exists on the MINT path too."**

This is **exactly as stated**. The fee payer is not in any instruction's account list, so the on-chain confinement cannot see it. The limit is accurate.

### 2. Is anything listed as an accepted limit not actually a limit — already closed?

**Accepted limit 1a: "The program allowlist and the Bank-pubkey confinement are OFF-CHAIN."**

The Bank-pubkey confinement is **already closed** — it is on-chain. The program allowlist remains off-chain. The limit should be split into two: one for the allowlist (still off-chain) and one for the confinement (now on-chain, should be discharged).

### 3. Is any DISCHARGED item not actually discharged?

**Item 12/17 (compute units):** Discharged with measurement. The measurement is on the artifact (`meta.computeUnitsConsumed` off landed transactions). This is sound.

**Item 14 (duplicate attribute keys):** Discharged with on-chain check. The check is in `mint_vault`. This is sound.

**Item 19 (unlevelled-vault halt):** Discharged by construction. The level is written at mint. This is sound.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**Item 22 (distribution never run against live chain):** Still OPEN AND BLOCKING. The code has never been run against a live chain. This is correctly listed.

**Item 23 (deck size must be decided before minting opens):** Still OPEN AND BLOCKING. The deck root is committed once. This is correctly listed.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that nineteen rounds of AI audit structurally cannot?

### 1. Formal verification of the Merkle proof implementation.

The two implementations (JS and Rust) of the Merkle proof must agree for all possible inputs. The suite tests a handful of inputs. A formal proof of equivalence, or a single source of truth (e.g., a Rust implementation that is compiled to both WASM for the JS side and BPF for the on-chain side), would eliminate the risk of a disagreement that the suite does not catch.

### 2. A fuzz test that generates random decks and random indices and verifies that the JS implementation produces proofs that the Rust implementation accepts.

This is cheap to run and would catch any disagreement between the two implementations. The fuzz test should run for at least 10^6 iterations before each freeze.

### 3. A dry-run of the distribution against a mainnet fork.

Before paying real money, run `distribute.mjs` against a mainnet fork with 2,100 simulated vaults. Measure the time, cost, and failure modes. This is the only way to verify that the distribution works at scale.

### 4. A public, verifiable salt revelation mechanism.

The Bank's salt must be committed on-chain with a timelock that automatically reveals it after minting closes. Without this, the deck is unverifiable. A simple on-chain commit-reveal scheme would cost a few hundred thousand lamports and would make the deck verifiable by anyone.

### 5. A documented, tested procedure for what happens when the distribution halts.

The distribution halts if any vault's level cannot be read. This is deliberate, but there is no documented procedure for what the operator should do. The operator needs to know: how to identify the problematic vault, how to fix it (if possible), and how to resume the distribution. This should be tested in a dry run.

### 6. A test that the deck proof fits within the 1,232-byte transaction at the production census (2,100 vaults).

The test currently measures the budget at the test census (90 vaults). The production census is 2,100 vaults, which requires a deeper proof. The attribute budget at that depth must be verified before minting opens.