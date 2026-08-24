**R1. `bank/deck.mjs`**

**CRITICAL: The seed is not binding; the Bank can choose the salt after seeing the blockhash (or choose the slot).**

Exact construct: `seedFrom = (bankSalt, blockhash) => sha(Buffer.from(bankSalt), Buffer.from(blockhash))` and `buildDeck(census, seed)` in `deck.mjs`; the Rust mirror in `programs/cbob-vault-mint/src/lib.rs:deck_leaf` / `deck_root_from` and the `commit_deck` / `mint_vault` path.

A cheating Bank publishes `sha256(bank_salt)` and a slot X first. It then waits for the blockhash of slot X, tries many salts until the resulting deck puts a desired index on Level V (or any preferred level), and reveals a salt whose preimage hash matches the published commitment. Nothing prevents choosing the slot itself (the published slot can be any future slot the Bank controls via MEV or timing). The published `sha256(bank_salt)` binds only the salt's hash, not the salt's choice after the blockhash is known.

Evidence that would exist if true: on-chain, the committed `deck_root` would be reproducible from the revealed salt + observed blockhash only for the *published* salt, but a Bank-chosen post-blockhash salt would produce a different deck that still validates all mint proofs (the suite would pass because the on-chain verifier only checks the presented proof). In a test run, `deck.mjs --selftest` with a post-blockhash-chosen salt would still pass all `verify` assertions while the published `sha256(bank_salt)` would not match the salt used for the deck that actually minted the levels. (The suite currently cannot catch this because it never simulates the Bank's choice after the blockhash.)

Fix: Commit the *full* seed (or a commitment to the *entire* shuffle) before the slot, or use a VRF/commit-reveal where the Bank cannot choose after the randomness is revealed. The current two-phase salt + future-blockhash is insufficient.

**HIGH: If the Bank never reveals the salt, the deal is unfalsifiable and holders have no recourse.**

Exact construct: The comment in `deck.mjs` ("At close the Bank reveals the salt and anyone recomputes...") and the lack of any on-chain or off-chain enforcement that the salt *must* be revealed (no deadline, no slashing, no forced reveal in `mint_vault` or the alarm).

If the Bank never reveals, no one can recompute the deck or prove any vault's level was off-deck. The on-chain `deck_root` and proofs are consistent with *some* salt, but the published `sha256(bank_salt)` cannot be checked against a never-revealed salt. Holders' recourse is only off-chain social pressure on the Bank key.

Evidence that would exist if true: On-chain, after the final mint, `deck_root` would remain but no transaction or event would ever reveal a salt matching the pre-published hash (the alarm would never emit a "salt revealed" event or equivalent). In a test run, running the full pipeline to mint completion with no `reveal` step would leave the alarm's `detectStandingRisks` or `correlateBurns` silent on the unrevealed salt, while the comment claims verifiability. (The suite currently has no assertion that a salt *must* be revealed by a deadline.)

This is a limit (the design relies on the Bank's honesty for the reveal), but the comment presents it as a proof. It is therefore also a defect in the documentation.

**MEDIUM: The Merkle construction has several attack surfaces (odd-node promotion, duplicate leaves, proof replay, depth ambiguity, tag separation).**

Exact construct: `leaf = sha(LEAF_TAG, u32le(index), Buffer.from([level]))`, `node = sorted sha(NODE_TAG, a, b)`, odd-node promotion in `layers` and `deckProof` (`if (sib < l[d].length)`), and the Rust mirror in `deck_leaf` / `deck_root_from`.

- Odd-node promotion allows a proof for a duplicated leaf to validate at the wrong index (self-hashing a leaf as a node is possible without the tag).
- Duplicate leaves are possible if the census has repeated levels at the same index after shuffle; the sorted node does not prevent it.
- A proof for index i can be replayed at j if the sibling path collides under the promotion rule.
- Depth ambiguity: a proof of length d validates against any tree of depth >= d if the root matches (no length check in `verify` beyond the provided proof).
- The tags separate leaf vs node, but a 64-byte leaf could theoretically be replayed as two internal nodes if the tag check is bypassed in a future edit (the Rust and JS must stay identical).

The suite tests several of these (`verify` with wrong level, wrong index, tampered node, truncated, empty, odd-sized deck), but not all combinations of duplicate leaves + promotion + depth.

Evidence that would exist if true: On-chain, a mint proof for a "bad" index would succeed against the committed root while the on-chain `level_minted` count for the *dealt* level would be inconsistent with the deck (the alarm's `detectStandingRisks` or a future `deckProof` verification would show mismatch). In a test run, `deck.mjs --selftest` with a crafted deck containing duplicates + odd promotion would pass `verify` for the wrong index while the Rust `deck_root_from` on the same proof would produce a different root (or the suite would need an assertion that `deckProof(deck, i)` never validates at j != i for duplicate leaves).

The tag does separate the domains (0x00 leaf vs 0x01 node), and the Rust/JS implementations match byte-for-byte on the tested cases. The suite catching a mismatch between JS and Rust is the *only* thing that would fail if they drifted (as the comment correctly states).

**HIGH: Two implementations of one hash scheme (JS `deck.mjs` and Rust `deck_leaf`/`deck_root_from`).**

Exact construct: The leaf/node tagging, sorting, u32le index, and odd-node promotion are duplicated in `bank/deck.mjs` and `programs/cbob-vault-mint/src/lib.rs`. The suite builds a proof in JS and has the program verify it, which catches byte-level drift. But the *specification* of the scheme (tag values, sort order, promotion rule, counter-mode PRNG with rejection sampling) lives in two places with no mechanical equivalence check.

What would have to be true for them to disagree in a way the suite would *not* catch: A change to the *specification* (e.g., changing the node tag from 0x01 to 0x02, or the sort from `<= 0` to `< 0`, or the rejection sampling limit calculation) that is applied to only one file. The suite would still pass because it only exercises the *current* JS proof against the *current* Rust verifier. A future edit that changes only the Rust (or only the JS) would produce a valid-looking proof that fails on-chain (or vice versa), and the selftest would not catch it because it never re-derives the spec from a single source.

Evidence that would exist if true: On-chain, a mint with a proof built from the "old" JS spec would fail `BadDeckProof` while the on-chain `deck_root` was computed with the new Rust spec (the alarm would raise on `BadDeckProof` volume). In a test run, changing only the Rust tag and re-running the full suite + `deck.mjs --selftest` would pass all assertions (the JS proof still validates against the old root), but a production mint would fail.

The current implementations match on all tested cases (the suite's 16 deck assertions + the on-chain mint suite). The hazard is exactly the "one fact, two readers" defect this project has shipped repeatedly.

**R2. THE LEVEL ON CHAIN (`programs/cbob-vault-mint/src/lib.rs`)**

**MEDIUM: A caller can get a level it was not dealt (reserved-key check, duplicate-key check, hand-built `CreateV2`, attribute count `attributes.len() + 1`).**

Exact construct: In `mint_vault`:
- `require!(a.key != ATTR_LEVEL, MintError::ReservedAttribute)`
- duplicate check: `!attributes[..i].iter().any(|b| b.key == a.key)`
- hand-built `CreateV2` blob: `data.extend_from_slice(&((attributes.len() + 1) as u32).to_le_bytes())` then appends the level *last*.
- `level` is appended *after* the caller attributes, and the plugin data is assembled by hand.

A caller can bypass the reserved-key check with:
- Case/unicode/empty-key variants (the check is exact `== "level"`; a key like "Level" or a Unicode lookalike would pass).
- The duplicate check is only against *previous* caller attributes; if the caller puts two identical keys, the second passes the `..i` check.
- The hand-built blob writes `attributes.len() + 1` but the level is appended *after* the loop; a caller that supplies `MAX_ATTRS-1` attributes + a duplicate or reserved key could push the total over what SEAL's `mark_opened` expects, or cause the level to be overwritten by a later attribute.

The `level` argument is still checked (`require!(level >= 1 && level <= 5)`) and the proof is mandatory, so the caller cannot *choose* an arbitrary level — but they can force a mint with a *duplicate* level attribute or a malformed attribute list that the payout side (`levelFromAttributes`) treats as `null`, halting the distribution.

Evidence that would exist if true: On-chain, a minted vault would have two `level` attributes (or a non-I..V level) when read by `fetchAsset` (the alarm's `unreadableLevels` or `levelFromAttributes` would trigger the halt). In a test run, the suite's 11.3/11.4/11.13 arms would fail if the duplicate/reserved checks were removed, but the hand-built blob + `attributes.len() + 1` allows a caller to push the count over the SEAL parsing limit without tripping the Borsh `TooManyAttributes` (the packet bound is the real limit, measured in 11.11).

The reserved-key check, duplicate check, and `level` argument + proof make "get a level it was not dealt" hard, but the hand-built plugin data and lack of canonical attribute-list validation on the payout side leave a window for a malformed vault that halts distribution. The `levelFromAttributes` "exactly one" requirement is the control that makes this load-bearing.

**HIGH: The quota can be overrun or a level starved; minting halts for everybody when one level's cap is exhausted but the deck still deals that card.**

Exact construct: `level_caps` / `level_minted` in `MintConfig`, the check `cfg.level_minted[li] < cfg.level_caps[li]` in `mint_vault`, and the deck proof using `minted_total` as the index. The caps are set at `initialize` and never changed. The deck is built from the census and committed once.

If the deck (shuffled from the census) deals a level whose `level_minted` has already hit `level_caps`, the mint fails with `LevelCapReached` and **halts for everybody**. Conversely, if the deck under-deals a level, that level is starved even though its cap is not reached. The on-chain quota is a ceiling on *supply*, not allocation; the Bank can still deal all good cards to itself/friends as long as it stays under the cap.

Evidence that would exist if true: On-chain, after minting the full census, `level_minted` for some level would be < `level_caps` while the deck still had remaining cards of that level (the alarm's `detectStandingRisks` or a future `deckProof` check would show mismatch). In a test run, building a deck that exhausts one level's cap early while still having cards of that level left would cause later `mint_vault` calls to fail with `LevelCapReached` while the suite's quota assertions (11.x) would show the cap was not reached for that level. The current suite tests the quota gate but not the starvation/halt interaction with the deck.

This is the intended behaviour (the deck is the fairness control; the on-chain cap is the hard ceiling), but the halt-for-everybody when one level is exhausted is a DoS vector if the deck is poorly chosen. The deck commitment + proof is supposed to prevent gaming, but the quota exhaustion still stops the entire mint.

**MEDIUM: The deck proof and the confinement now share one instruction (`mint_vault`). Any check can be skipped by ordering, account substitution, or an untested transaction shape.**

Exact construct: The Bank-key confinement walk, the `deck_root != [0; 32]` check, the `level` quota, the reserved/duplicate attribute checks, and the proof verification are *all* in `mint_vault`. The confinement walk is after the attribute checks but before the proof in the current ordering.

A caller can:
- Substitute accounts to bypass the Bank check (the walk uses the instructions sysvar; a malicious CPI or reordered instruction list can make the Bank appear only in the approved slot).
- Order the transaction so the proof is checked before the confinement (the walk is not guaranteed to reach the current instruction if an earlier instruction fails the load).
- Use a transaction shape the suite never tried (e.g., multiple `mint_vault` in one tx, or a versioned tx with lookup tables that changes the account indices the walk sees).

The suite tests many shapes, but not all possible orderings or account substitutions that could skip the confinement while still passing the proof.

Evidence that would exist if true: On-chain, a mint that passed the proof but used the Bank as payer (or in another instruction) would succeed while the alarm's `detectStandingRisks` or the co-signer would have refused it (the `BankKeyOutsideMint` error would not fire). In a test run, a crafted transaction that reorders the instructions or substitutes accounts would pass the suite's 11.x arms while the confinement walk is skipped (the `BankKeyOutsideMint` assertion in 9d.4 would fail to fire for the new shape).

The current ordering and the instructions-sysvar walk make most substitutions hard, but the shared instruction increases the attack surface. The suite's 10.x compute-unit and 11.x level/deck arms do not test every possible transaction shape that could bypass one check while satisfying another.

**R3. THE LEVEL AT PAYOUT (`bank/distribute.mjs`)**

**HIGH: NOTHING HAS EVER RUN THIS AGAINST A LIVE CHAIN (accepted limit 22, OPEN AND BLOCKING). Assume it runs tomorrow over ~2,100 vaults: rate limits, paging, partial failure, a transient RPC error on vault 1,900 of 2,100, cost.**

Exact construct: The loop in `main()` that does `fetchAsset(umi, umiPk(v))` for every vault in the index, then `levelFromAttributes(asset?.attributes?.attributeList)`. No paging, no retry, no rate-limit backoff, no partial-failure handling beyond catching and collecting `unreadableLevels`. `fetchAsset` is called sequentially in a single process.

What breaks:
- Rate limits on the RPC (Helius or other) for 2,100 sequential `getAccountInfo` / asset fetches.
- Paging behaviour of the underlying RPC (a single call can return only a page; the code assumes one call per vault).
- Partial failure: a transient error on vault 1,900 halts the *whole* distribution (the `unreadableLevels` path still refuses the day).
- Cost: 2,100 RPC calls per day is expensive at scale; the code has no batching or caching.
- A single RPC error on any vault turns the day into a refusal (the halt is deliberate, but the error on vault 1,900 should not stop payment to the first 1,899).

Evidence that would exist if true: In a test run against a live chain with 2,100 vaults, the job would either hit rate limits (the RPC would return 429 or timeout), produce a partial `unreadableLevels` list that still halts the distribution, or exhaust the process's RPC budget. The current suite never exercises this at production scale (it uses tiny test decks). The alarm's `distribution_vault_unreadable` would fire on every transient error.

This is accepted limit 22 and is explicitly OPEN AND BLOCKING. It must be exercised before it pays anyone. The code is correct for the happy path; the I/O at scale is untested.

**MEDIUM: A vault whose level cannot be read HALTS THE WHOLE DISTRIBUTION rather than being excluded. Is that reachable by an ordinary customer action? The claim is that it is not (level written at mint, no activated-but-unlevelled window).**

Exact construct: In `main()`, the `try { fetchAsset...; lv = levelFromAttributes(...) } catch { unreadableLevels.push(...) }` path, then `if (unreadableLevels.length) { console.error... }` and the allocator refuses if any activated vault has no readable level. `levelFromAttributes` requires *exactly one* `level` attribute.

The claim is that `mint_vault` writes the level, reserves the key, appends exactly one, and the quota + proof guarantee it. So there should be no window where a vault is activated but unlevelled.

Try to find one:
- A mint that succeeds but the level attribute is malformed (e.g., the hand-built `CreateV2` blob has an off-by-one on the count, or the level name is not in `LEVEL_NAMES`).
- A Core upgrade that changes how `attributes` are stored or deserialized.
- A vault minted before the level change landed (the migration path is "the level is immutable in practice because no shipped instruction can rewrite it" — but the first vaults were minted without levels).
- A transient RPC error on `fetchAsset` for a real vault (the `catch` treats it as unreadable).
- A vault whose level was rewritten by the SEAL PDA (accepted limit 13: the plugin authority is the SEAL PDA, which could ship a new instruction to rewrite attributes).

The halt is reachable by ordinary customer action only if the customer can force a mint with a bad level (the reserved-key and duplicate checks + the proof make that hard). But a transient RPC error on any vault, or a Core change, or a pre-level vault, or a SEAL upgrade that rewrites a level, *does* trigger the halt. The refusal is deliberate (excluding one holder silently overpays everyone else permanently), but the claim "not reachable by an ordinary customer action" is only true if the level write is perfect and the RPC is perfect. It is not.

The arithmetic in `allocateWeighted` and `levelFromAttributes` is correct (weights 2/3/4/5/6, census, denominator, dust carries, same-level vaults get the same amount). Two vaults at the same level always receive the same amount (the weight is the same and the division is deterministic).

**R4. THE PACKET BOUND IS A PRODUCT CONSTRAINT (`tests/3prog.test.ts`, section 11).**

**HIGH: At the real census (2,100 vaults, depth 11), the attribute budget may not fit the provenance the product needs. The deck root is committed ONCE, so this cannot be fixed after minting opens.**

Exact construct: The deck proof length is `floor(log2(N))` (depth 11 for 2,100). Each proof node is 32 bytes. The transaction has a fixed 1,232-byte limit. The caller's attributes + the level attribute + the proof share that budget. The suite measures at depth 7 (90-card test deck): 7 caller attributes fit, the 8th does not serialize. At depth 11 the budget is smaller.

The product needs provenance attributes (notice serial, governor standing, etc.). If the real provenance requires > (MAX_ATTRS - 1 - proof nodes) slots, minting will fail for the packet size even if Borsh allows it. The deck root is committed once; the depth cannot be reduced later.

Evidence that would exist if true: In a test run with the real 2,100-vault census, the `attrFit` probe in section 11 would show maxAttrs < the number of provenance attributes the product needs. On-chain, minting would fail to serialize for later vaults while the suite's 11.11/11.12 would pass for the test deck. The deck commitment is permanent, so this is a product constraint, not a code bug that can be fixed.

The code and suite assert the relationship only by measurement in a test that prints it (`deck depth X -> at most Y caller attributes fit`). There is no compile-time or runtime assertion that the real provenance fits the budget left by the real deck depth. That is the defect.

**R5. PHASE 1'S OWN CHANGES — NEWEST CODE, LEAST READ, HIGHEST PRIOR.**

**MEDIUM: The stated-count gate in `bank/selftest.mjs` (now using `matchAll` over five floors) is sound, but a floor SPEC stops mentioning would silently pass.**

Exact construct: The `RX` map with `g` flags, `statedIn = [...src.matchAll(RX[what])]`, `everywhere = (what, want) => { const found = statedIn(spec, what); t(..., found.length > 0 && found.every(n => n === want), true) }`.

The five regexes match everything they should (the word "assertions", "detector", "allocation", "deck", "live-mainnet" with the number immediately before). A floor SPEC stops mentioning *would fail* because `found.length > 0` is required. A stale number at a later occurrence is caught by the poisoned-spec test that plants 63 at the *last* occurrence of the allocation regex.

The new gate is sound. It does not silently pass a floor SPEC stops mentioning.

**MEDIUM: The three new suite arms (11.13/11.14/11.15) assert that neither OWNER nor BANK can rewrite a minted level, and that the value survives. They rest on Core rejecting with `0x1a` (`NoApprovals`). Do those arms prove what they claim? What ELSE could produce `0x1a` here, and is there an actor the two arms do not cover?**

Exact construct: The `upLevel` CPI to Core's `UpdatePluginV1` (discriminator 6, Plugin::Attributes = 6), the `ownerRewrite` and `bankRewrite` tests, and the `because('11.13','0x1a')` / `because('11.14','0x1a')` that check the error code.

Core's `0x1a` is `NoApprovals` (from the generated error map in `@metaplex-foundation/mpl-core`). The arms prove that the *owner* and the *Bank* cannot rewrite the level (the plugin authority is the SEAL PDA, and neither the owner nor the Bank is that authority).

What else could produce `0x1a`? 
- A malformed `UpdatePluginV1` instruction (wrong discriminator, wrong plugin type, wrong attribute list format) would fail deserialization or validation before the approval check, producing a different error (`0x1` or `0x2` for deserialization, or a different plugin error).
- The SEAL PDA itself (or a future instruction the SEAL program ships) could rewrite the level — that is accepted limit 13.
- A different actor that controls the plugin authority (if the SEAL program is upgraded to add a new instruction that rewrites attributes).

The two arms cover the *owner* and the *Bank*. They do not cover the SEAL PDA (the actual authority) or a future upgrade of the SEAL program. The positive half (11.15) reads the level back after the two failed rewrites, which proves the value survived *those two attempts*. It does not prove that *no one* can rewrite it (the SEAL upgrade authority can).

The arms prove what they claim for the owner and the Bank. They do not prove the level is immutable against the SEAL PDA or a SEAL upgrade. That is exactly accepted limit 13.

**LOW: The corrected comment in `bank/detectors.mjs` ("the gap is timing, not capability") is true.**

Exact construct: The updated comment on `detectNestedVaults` / the foreign-nested-vault case, stating that `bank/cosign.mjs` *does* detect it via `scanPda` + DAS `getAssetsByOwner` on the vault's asset-signer PDA, keeps non-burnt assets regardless of collection, refuses on DAS error, and refuses a full page.

The comment is accurate. The co-signer *does* see foreign nested assets and fails closed on them. The gap is that there is no *continuous* warning (the alarm's `detectNestedVaults` walks only our collection). The holder learns at redemption time. That is accepted limit 9. The corrected comment is true.

**R6. THE UNDER-CLAIM DIRECTION, WHICH NOTHING HERE IS INSTRUMENTED TO CATCH.**

**MEDIUM: Under-claim in `bank/alarm.mjs` / the deadman cron: the comment says the deadman "fires on a MISSING file as well as a stale one", but the implementation uses `find $ALARM_STATE -mmin +120` which prints nothing (and therefore does not page) if the file is absent. The test for "missing" is inverted.**

Exact construct: The deadman cron line in `scripts/cron-install.sh`:
```
9 */2 * * * { [ ! -f $ALARM_STATE ] || [ -n "$(find $ALARM_STATE -mmin +120 2>/dev/null)" ]; } && /opt/scripts/notify-gary-sms.sh "CBOB vault alarm state is missing or over 2 hours old..." ...
```

The `{ [ ! -f ... ] || [ -n "$(find ...)" ] }` is true if the file is missing *or* if `find` returns a non-empty line. But `find` on a non-existent path prints nothing, so the `||` branch is never taken for a missing file. The deadman is silent on a missing state file — exactly the case it is supposed to catch.

Evidence that would exist if true: On a box with the state file deleted, the deadman cron would produce no SMS. The test in `bank/selftest.mjs` that checks the deadman logic would pass the "missing" case because the test constructs a synthetic state file. The real cron never pages on a missing file.

This is an under-claim (the comment says it catches missing, the code does not). It is the inverse of the over-claim defect the repository has shipped six times. The corrected comment in `detectors.mjs` (R5) is an example of the same class being fixed; this one was missed.

**R7. THE COUNTS AND THE ARITHMETIC, INDEPENDENTLY.**

The floors quoted in the prompt are read from `scripts/run-tests.sh` (and the self-test files) rather than typed. They match the real floors in the current tree:
- on-chain: 316
- detector: 439
- allocation: 103
- deck: 17
- mainnet: 19

The schedule's published figures re-derive correctly from the weights and census:
- 108/60/36/24/12 → 732 denominator, shares 29.5/24.6/19.7/16.4/9.8%
- 945/525/315/210/105 → 6,405 denominator, shares identical to the card
- per-$1,000 figures and the 3x Level V vs Level I all match.

No wrong number on a customer-facing card. The arithmetic is correct.

**R8. ONE-OF-N-SITES.**

For every fix in this diff:
- The `matchAll` gate in `selftest.mjs` was applied to *all* floors and *all* occurrences (the previous version read only one occurrence of each of three floors; the second allocation count, the deck floor, the mainnet floor, and the "thirteen rounds" text were all invisible). The poisoned-spec test specifically targets a *later* occurrence. All sites of the "stated count" shape are now covered.
- The three new suite arms (11.13/11.14/11.15) test both the OWNER and the BANK rewriting a level, and the positive survival check. The `because` checks for `0x1a` are on both. The actor not covered (the SEAL PDA / SEAL upgrade authority) is explicitly called out in accepted limit 13. The one-of-N defect (testing only the owner, not the Bank) was fixed in this diff.
- The comment correction in `detectors.mjs` (under-claim → timing gap, and the co-signer *does* detect foreign nested assets) is accurate and applied to the only site of that comment.
- The `supersede` function in `distribute.mjs` now clears *all three* suppressors of `distribution_unfinished` (`finishedAt`, `nothingToDo`, `resolvedBy`) and records both prior verdicts. The previous version cleared only two. All sites of the "no-pay verdict" shape are now handled.
- The `deckProof` and `deck_root_from` implementations were made to match exactly (tag, sort, promotion, u32le). The suite's 11.x arms test the JS proof against the Rust verifier. The one-of-N hash-scheme defect was fixed in this diff (both files were changed together).
- The `levelFromAttributes` function requires *exactly one* level and is used in the payout path. The mint path's reserved-key + duplicate checks + hand-built blob were updated in the same diff. All sites of the "attribute map for a money decision" shape are now consistent.
- The `allocateWeighted` refusal on any unlevelled vault is applied to the only call site in `main()`. The previous `levels.json` path had the same refusal but was customer-triggerable; the new path is not. The one-of-N "unlevelled halt" defect was fixed in this diff.

The project's single most repeated defect (one-of-N-sites) has *not* recurred inside the fixes for it in this diff. Every changed site of each shape was updated.

**THE ACCEPTED LIMITS — the four questions**

1. **Is any limit WORSE than stated?** No. The most important one (22: nothing has ever run a distribution against a live chain) is exactly as bad as stated — it is OPEN AND BLOCKING and must be exercised before it pays anyone. The under-claim in the `detectors.mjs` comment was corrected in this diff. The bank-pubkey confinement on the mint path (16) is now on-chain in MINT as well as in SEAL. No accepted limit is exploitable in a way the text does not already describe.

2. **Is anything listed as an accepted limit not actually a limit — already closed, or closed by something the author did not notice?** Yes — item 19 ("the unlevelled-vault halt as a customer-triggerable payout DoS") is now CLOSED BY CONSTRUCTION. The level is written at mint, the quota + proof + reserved key prevent a customer from creating an activated-but-unlevelled vault, and the halt now means "the chain and this code disagree about a vault". The REFUSAL remains (excluding one holder silently overpays everyone else permanently), but the customer-triggerable DoS is gone. The honest statement is narrower and stronger than the one the list carried. This should be moved to DISCHARGED with the measurement (the on-chain suite's 11.x arms + the `levelFromAttributes` tests + the `allocateWeighted` refusal on any unlevelled vault).

3. **Is any DISCHARGED item not actually discharged?** No. The measurements named (the 316-assertion suite, the detector selftest with both directions, the compute-unit measurement on landed transactions, the on-chain `DuplicateAttribute` refusal, the construction that eliminates the unlevelled-vault window) all hold in the current tree. The compute-unit fear was the wrong way round (the byte wall binds first); the discharged items are correct.

4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?** Yes — item 22 (distribution against a live chain) is still treated as blocking in the code and the prompt, but the `distribute.mjs` changes (reading levels off-chain with `fetchAsset`, the `unreadableLevels` path, the refusal on any unreadable level) are written as if the I/O at production scale is a solved problem. It is not exercised. The code is correct for the happy path; the failure modes (rate limits, paging, transient RPC error on vault 1,900, cost) are untested. It must remain OPEN AND BLOCKING and must be exercised before it pays anyone. It is not being quietly demoted.

**GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that nineteen rounds of AI audit structurally cannot?**

**Run the full pipeline (including the distribution and the swap) in a shadow mode on a real testnet with real (small) amounts of cbBTC for at least two full cycles, with a human operator manually reviewing every alarm and every distribution report, before any mainnet mint.** 

AI audit cannot execute the system end-to-end with real economic value, real RPC rate limits, real paging behaviour, real transient failures, or real operator judgement. It cannot tell whether the alarm pages on the right things at 3 a.m., whether the distribution actually pays the right amounts when the RPC is flaky, or whether the swap operator's manual process is sustainable. The only way to close the "the models have never seen the real system under load" gap is to run the real system under load with real money at risk, with a human in the loop who can close the alarms and resolve the ambiguities the detectors cannot. The freeze should not happen until that shadow run has succeeded for at least two full payout cycles with no undetected loss and no silent failure.

That is the one thing nineteen rounds of AI audit structurally cannot do. Do it.