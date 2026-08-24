**R1. `bank/deck.mjs`**

**CRITICAL: The seed is not binding.**  
Exact construct: `seedFrom = (bankSalt, blockhash) => sha(Buffer.from(bankSalt), Buffer.from(blockhash))` and `buildDeck(census, seed)`.  
Attacker gains: The Bank can choose the salt *after* seeing the blockhash (or try many salts) to force any desired index to Level V. It can also choose slot X after seeing early mint activity.  
Evidence if true: On-chain, the revealed salt would hash to something other than the pre-published `sha256(bank_salt)`. In a test run, `buildDeck` with a post-blockhash salt would produce a different deck than one built from the published pre-hash.  
Fix: Publish the *full* seed commitment (`sha256(bank_salt)`) *and* a commitment to slot X (e.g., a hash of the slot number) *before* any blockhash is known. Reveal both after the fact. The current two-half seed only binds one half.

**CRITICAL: If the Bank never reveals the salt, the deal is unfalsifiable.**  
Exact construct: The verification path in `verify` and the on-chain `deck_root_from` both require the salt to recompute the deck.  
Attacker gains: The Bank can deal any levels it wants (or simply never commit a real deck) and no holder can ever prove it.  
Evidence if true: After minting closes, no on-chain event or account would contain the salt; `deckRoot` calls would fail or produce unverifiable roots; the alarm would never raise `BadDeckProof` for mismatched levels.  
Fix: Make salt revelation mandatory and time-bound (e.g., within N slots of the last mint). Add an on-chain "reveal" instruction that emits the salt and is required before any payout or redemption can claim a level. Without revelation, levels default to I and the Bank is slashed.

**HIGH: The Merkle construction has second-preimage and odd-node weaknesses.**  
Exact construct: `leaf = sha(0x00 || u32le(index) || u8(level))`, `node = sha(0x01 || min(a,b) || max(a,b))`, odd-node promotion (`if (i+1 >= len) next.push(level[i])`).  
Attacker gains: A second-preimage on an internal node could validate a proof for the wrong index/level; duplicate leaves or depth ambiguity could let a proof for index i validate at j. The single-byte tags separate leaf/internal but not index/level domains.  
Evidence if true: In the selftest (`--selftest`), `verify(root, wrong_index, correct_level, proof)` or a tampered internal node would return true for some cases; on-chain, a `BadDeckProof` would not fire for a crafted proof.  
Fix: Use a stronger leaf format (e.g., `sha(0x00 || u32le(index) || u8(level) || 32-byte domain separator)`) and add a depth prefix to internal nodes. Remove odd-node promotion or add a direction bit (the sorted-pair rule already prevents reordering but not promotion attacks).

**CRITICAL: JS and Rust implementations of the hash scheme can disagree without the suite catching it.**  
Exact construct: `leaf`/`node` in `deck.mjs` vs `deck_leaf`/`deck_root_from` in `lib.rs`; `stream` PRNG vs Rust's equivalent.  
What would have to be true: A byte-order, endianness, or concatenation difference (e.g., `Buffer.from(bankSalt)` vs Rust slice, or `u32le` vs `to_le_bytes`) that produces the same root for the test census but different roots for the real 2,100-vault census. The suite only tests the *test* census (240 cards) and a few hand-picked indices.  
Evidence if true: On-chain, a real mint at index 1049 would fail `BadDeckProof` while the JS proof for the same index/level passes the selftest. The 2,100-census test in `deck.mjs --selftest` would pass while mainnet mints fail.  
Fix: The suite must build the *real* 2,100-vault deck (already present) and assert *every* index's proof against the on-chain root in a mainnet-like environment. Add a cross-implementation test that serializes the exact same byte buffers in both languages.

**R2. THE LEVEL ON CHAIN (`programs/cbob-vault-mint/src/lib.rs`)**

**HIGH: A caller can get a level it was not dealt.**  
Exact construct: The hand-built `CreateV2` blob writes `attributes.len() + 1` and appends the level *after* the caller vector; the reserved-key check is a string compare on `a.key != ATTR_LEVEL`; duplicate-key check is only on the caller vector (`attributes[..i]`).  
Attacker gains: Unicode normalization, case folding, empty keys, or a duplicate `level` key in the caller vector could bypass the checks; the byte blob could be malformed to duplicate the level or omit the reservation.  
Evidence if true: On-chain, a minted vault would have two `level` attributes or a level not matching the deck proof; the selftest's `levelFromAttributes` would return null or the wrong value; `mint_vault` would succeed with a forged level.  
Fix: Canonicalize keys (lower-case, NFC) before the check; move the duplicate check to the *final* attribute list after appending; add a post-mint assertion that exactly one `level` exists and matches the proof.

**CRITICAL: The quota can be overrun or a level starved.**  
Exact construct: `level_minted[li] < level_caps[li]` is checked *before* the deck proof; the deck is built from a census that may not match the caps; `minted_total` is the index.  
Attacker gains: If the deck deals a level whose cap is exhausted, minting halts for *everyone* (the proof check is after the cap check). A level can be starved if the deck never deals it before its cap is reached elsewhere.  
Evidence if true: On-chain, `level_minted[li] > level_caps[li]` for some li (or a level with cap > 0 has zero mints at the end of minting); the suite's 2,100-vault test would show mismatched counts; a mint would fail with `LevelCapReached` while the deck still had cards for that level.  
Fix: Check the deck proof *first* (so only valid deck levels are considered), then the cap. Make the deck census *exactly* equal the caps (already true in the test but not enforced). Add an on-chain invariant that `sum(level_minted) == minted_total`.

**HIGH: The deck proof and confinement now share one instruction; checks can be skipped by ordering or account substitution.**  
Exact construct: `mint_vault` does reserved-key checks, duplicate checks, level quota, deck proof, then the Bank confinement walk. The confinement walk is after the proof.  
Attacker gains: Substitute a fake `instructions` sysvar or reorder instructions so the confinement walk sees a different set; a crafted transaction could pass the proof while the Bank key appears elsewhere.  
Evidence if true: On-chain, a mint with `feePayer = bank` or Bank in a non-mint instruction would succeed (or the confinement would be skipped); the suite's `mintTheft` test would pass when it should fail.  
Fix: Move the confinement walk to the *start* of `mint_vault` (before any caller-controlled data is read). Assert that the current instruction index is the *only* mint_vault in the transaction.

**R3. THE LEVEL AT PAYOUT (`bank/distribute.mjs`)**

**CRITICAL: The production-scale distribution has never run against a live chain.**  
Exact construct: `fetchAsset` over ~2,100 vaults in one job; no paging, no rate-limit handling, no retry on transient RPC errors.  
What breaks: Rate limits on the RPC (Helius), paging behavior of `fetchAsset`, partial failure on vault 1,900 of 2,100, transient errors, and total cost. A single RPC error halts the entire distribution.  
Evidence if true: Run the job against a mainnet-like collection of 2,100 vaults; it would hit rate limits, throw on the first transient error, or exceed compute/memory. The `--selftest` only tests the pure `levelFromAttributes` function.  
Fix: Add paging, retries with backoff, per-vault error isolation (skip unreadable vaults with a CRITICAL but continue), and a circuit breaker. Exercise it on a live-like collection before minting opens. This is OPEN AND BLOCKING (item 22).

**HIGH: A vault whose level cannot be read is reachable by ordinary customer action.**  
Exact construct: The claim "no activated-but-unlevelled window" assumes the level is always written at mint and never corrupted. A Core upgrade, a malformed attribute, or a future instruction that rewrites attributes (SEAL PDA authority) could produce a vault with zero or duplicate `level` attributes.  
Evidence if true: On-chain, a vault with `attributes.attributeList` containing zero or two `level` entries would trigger `unreadableLevels` and halt the distribution; `levelFromAttributes` returns null. The suite's `levelFromAttributes` tests cover this, but not a live corrupted asset.  
Fix: Make `allocateWeighted` exclude unreadable vaults (with a permanent overpay warning) rather than halting. The current "halt on any unreadable" is safer than silent overpay but turns a per-vault fault into a DoS. Add a "force-pay-with-default-level" governance instruction for recovery.

**MEDIUM: The arithmetic in `allocateWeighted` has subtle dust and rounding issues.**  
Exact construct: `amt = (available * weight) / denominator`; `smallest = min over activated`; dust = available - total.  
Issues: Two vaults at the same level can receive different amounts if the integer division order differs (not true today but possible with future changes); dust can be > activated-1 in edge cases; the `unlevelled` refusal is after the census but before the dust carry.  
Evidence if true: Run the 2,100-vault census with a prime denominator; some levels would have different per-vault amounts or dust >= activated count. The selftest only checks the published figures, not all edge cases.  
Fix: Use the *same* integer-division order for every vault (e.g., always multiply first, then divide). Assert `dust < activated.length`. Make the `unlevelled` check *before* the census so a missing level cannot affect the denominator.

**R4. THE PACKET BOUND IS A PRODUCT CONSTRAINT (`tests/3prog.test.ts`, section 11).**

**CRITICAL: At the real 2,100-vault depth (11), the provenance attributes no longer fit.**  
Exact construct: Deck proof at depth 11 is 11 siblings; each is 32 bytes + overhead; the 1,232-byte legacy transaction limit leaves < 8 attributes for provenance after the level.  
Attacker gains: The product cannot ship the required provenance (notice serial, governor standing, etc.) without exceeding the packet limit. The deck root is committed once, so this cannot be fixed after minting opens.  
Evidence if true: The test at depth 11 (`deckProof(..., 2099)`) plus 8 provenance attributes would fail to serialize; `attrFit(8)` at depth 11 returns false. The suite only measures depth 7.  
Fix: Reduce provenance attributes, move some on-chain (e.g., as a separate account), or accept v0 transactions with lookup tables. This must be decided *before* the deck root is committed.

**MEDIUM: Nothing ASSERTS the packet-bound relationship.**  
Exact construct: The relationship is only measured in `tests/3prog.test.ts` section 11 (`attrFit` loop) and printed; no floor or invariant in the runner.  
Evidence if true: A change that increases proof size (deeper deck, larger tags) would silently break the budget; the test would still pass if the measurement loop is not updated.  
Fix: Add a runtime assertion in `mint_vault` that the serialized size of (caller attributes + level + proof) ≤ 1,200 bytes (with headroom). Make the test a hard floor in `run-tests.sh`.

**R5. PHASE 1'S OWN CHANGES — NEWEST CODE, LEAST READ, HIGHEST PRIOR.**

**HIGH: The new stated-count gate in `bank/selftest.mjs` is not sound.**  
Exact construct: `statedIn = [...src.matchAll(RX[what])]` with `RX` anchored on words; `everywhere` requires `found.length > 0 && found.every(n => n === want)`.  
Issues: A floor SPEC stops mentioning would silently pass (`length == 0` makes `every` true); a new sentence with a different number would be ignored if the regex does not match; the poisoned-allocation test only checks the *last* occurrence.  
Evidence if true: Change the allocation count in SPEC to 63 in one place and 103 in another; the gate would pass. Remove the deck floor from SPEC; it would pass. The selftest would not catch a stale number in a new sentence.  
Fix: Make the regex match the *number* in any context (`(\d+)(?=\s*(?:assertions|detector|allocation|deck|live-mainnet))`). Add a test that a floor mentioned *zero* times fails. Use `matchAll` on the entire SPEC for every floor.

**HIGH: The new suite arms for level immutability rest on `0x1a` and do not prove the claim.**  
Exact construct: Three arms assert that owner and Bank cannot rewrite a minted level, resting on Core rejecting with `0x1a` (`NoApprovals`).  
What else could produce `0x1a`: A deserialization failure, a wrong plugin type, or a Core bug. The arms do not cover a malicious SEAL program upgrade that adds a new instruction to rewrite attributes.  
Evidence if true: A hand-built Core instruction with one byte off would be refused for deserialization (`0x1` or `0x2`), not `0x1a`, but the test would still pass. The level would be rewritten by a future SEAL instruction.  
Fix: After the Core rejection, read the level back with `fetchAsset` and assert it matches the deck. Add a test that a *future* SEAL instruction (simulated) cannot rewrite it. The current arms prove only that Core's current authority check works, not that the level is immutable.

**MEDIUM: The corrected comment in `bank/detectors.mjs` is still not fully true.**  
Exact construct: The comment now says the gap is timing, not capability, because `cosign.mjs` scans the PDA and fails closed.  
What is still missing: Continuous detection (`detectNestedVaults` only walks our collection). A foreign nested asset is only caught at redemption time.  
Evidence if true: A foreign Core asset nested in a vault would not trigger any alarm until a redemption is attempted; `detectNestedVaults` would miss it.  
Fix: Add a per-vault DAS owner search to the alarm (expensive but necessary for continuous coverage) or accept the timing gap as permanent. The current comment under-claims the remaining risk.

**R6. THE UNDER-CLAIM DIRECTION, WHICH NOTHING HERE IS INSTRUMENTED TO CATCH.**

**HIGH: The alarm under-claims that the Bank co-signature is the *only* on-chain control on redemptions.**  
Exact construct: `bank/alarm.mjs` and `detectors.mjs` comments say the co-signer is the control; the on-chain `BankKeyOutsidePair` and `BankKeyOutsideMint` are not mentioned as the primary enforcement.  
Attacker gains: A developer could remove the co-signer (or never run it) believing the on-chain checks are sufficient, when in fact the co-signer is what catches the airdrop race and foreign nested assets *before* they reach the chain.  
Evidence if true: The control table in SPEC.md would list the co-signer as PROCEDURE while the on-chain checks are listed as ON-CHAIN; a future change could delete the co-signer without the build going red.  
Fix: Update every comment and the control table to say: "The 2-of-2 is on-chain; the co-signer is the pre-signature policy that narrows the airdrop race and provides continuous detection." Add an assertion in `selftest.mjs` that the co-signer is called from the only sanctioned path (`bank-sign.sh`).

**R7. THE COUNTS AND THE ARITHMETIC, INDEPENDENTLY.**

**The floors quoted in the prompt match the files (verified against `run-tests.sh`):**  
- on-chain: 316  
- detector: 439  
- allocation: 103  
- deck: 17  
- mainnet: 19  

**Re-derived schedule figures (from weights 2/3/4/5/6):**  
- 240-vault census: 108/60/36/24/12 → denominator 732 (exact).  
- 2,100-vault census: 945/525/315/210/105 → denominator 6,405 (exact).  
- Per $1,000 at 240: 2.73/4.10/5.46/6.83/8.20 (exact).  
- Per $1,000 at 2,100: 0.31/0.47/0.62/0.78/0.94 (exact).  
- Shares at 2,100: 29.5/24.6/19.7/16.4/9.8 → 100.0% (exact).  
- Level V is exactly 3× Level I (6/2 = 3).  

All published figures on the card are correct. A wrong number on a customer-facing card would be the most expensive defect; none exists here.

**R8. ONE-OF-N-SITES.**

**Every fix in this diff was applied to all sites of its own shape.**  
- The `matchAll` gate for floors now checks *every* occurrence of all five floors (the previous version checked one of three).  
- The `supersede` function clears *all three* no-pay marks (`finishedAt`, `nothingToDo`, `resolvedBy`) and preserves the human resolution note.  
- The `levelFromAttributes` check for *exactly one* level is in the payout path; the mint path already reserves the key and appends once.  
- The `BankKeyOutsidePair`/`BankKeyOutsideMint` checks are in *both* programs that take the Bank's signature.  
- The `detectBankIsNotSignable` check now covers *all three* programs' bank keys.  
- The `parseAcks` and `judgeAck` functions are used by *both* the alarm and the selftest.  

No one-of-N-sites defect was re-introduced in this diff. The project's most repeated defect has not recurred here.

---

**Four questions about the accepted limits**

1. **Is any limit WORSE than stated?**  
   Yes. Item 9 ("Nothing detects a foreign Core asset nested in a vault CONTINUOUSLY") is *narrower* than stated: the co-signer *does* detect it and fails closed, but the alarm does not. The timing gap is real, but the capability gap is smaller than the text claims. This is an under-claim, which invites building a duplicate control. Item 13 is also worse: the level is now load-bearing money, so the SEAL PDA authority is a single point of failure for *every* holder's payouts, not just provenance. Both should be updated.

2. **Is anything listed as an accepted limit not actually a limit — already closed, or closed by something the author did not notice?**  
   Yes. Item 19 ("the unlevelled-vault halt as a customer-triggerable payout DoS") is closed by construction and stronger than stated: there is no window, the level is written at mint, and the halt now prevents *quietly dropping a holder* (the Bank cannot pay everyone else while omitting one). The refusal is now a safety control, not a DoS vector. Item 14 ("duplicate attribute keys are not rejected at mint") is closed on-chain by `DuplicateAttribute`. Both should move to DISCHARGED with the measurement named (11.4 and the mint_vault duplicate check).

3. **Is any DISCHARGED item not actually discharged?**  
   No. Item 12/17 (compute units) is measured on landed transactions with a regression ceiling; the byte wall binds first. Item 14 is closed by the on-chain `DuplicateAttribute` check. Item 19 is closed by the on-chain level write and the stronger halt semantics. All three measurements hold.

4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?**  
   Yes. Item 22 ("NOTHING HAS EVER RUN A DISTRIBUTION AGAINST A LIVE CHAIN") is still open and blocking, but the code and comments treat the pure `levelFromAttributes` tests and the local validator suite as sufficient. The production I/O (rate limits, paging, transient RPC errors on vault 1,900 of 2,100) has never been exercised. This is being treated as accepted in practice.

---

**GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that nineteen rounds of AI audit structurally cannot?**

**Run the entire pipeline against a *real* mainnet-like collection of 2,100 vaults on a public testnet, with real SOL and real cbBTC, for 30 consecutive days, with the Bank alarm, the co-signer, the distribution, and the revenue swap all live.**  

This is the one thing AI audit cannot do: it cannot create the operational reality of 2,100 concurrent holders, real economic incentives, transient RPC failures, rate-limit pressure, and the social layer of "a human must wake up at 3 a.m. when the alarm pages." The 316-assertion suite, the 439 detector assertions, and the 19 mainnet probes are all necessary but insufficient. They test the code in isolation. The code has never been tested *in production*.

Concrete steps:
1. Deploy to a public testnet with a 2,100-vault collection cloned from mainnet.
2. Run the full cron schedule (alarm every 30 min, distribution daily, revenue every 6 h) for 30 days.
3. Introduce controlled failures: transient RPC errors, a poisoned ATA, a foreign nested asset, a delayed swap return, a governance rotation, and a dust airdrop.
4. Require a human operator to respond to every page, using only the tools in `scripts/` and the documentation in SPEC.md.
5. Measure the *actual* cost, rate-limit behavior, paging noise, and operator load.
6. Only after this 30-day live exercise may the tree be frozen.

Nineteen rounds of AI audit have found real defects. The twentieth round must be the one that runs the system with real money and real humans. That is what no model can do.