

## R1 — `bank/deck.mjs`

### R1-1. CRITICAL — the deck commitment is not enforceable; the Bank can still choose a favorable root/seed

**Construct.** `seedFrom(bankSalt, blockhash)` is off-chain. `commit_deck` stores only `root: [u8; 32]` on-chain. Nothing on-chain or in this repository commits to `sha256(bank_salt)`, to slot `X`, to the time/order of publication, or to the census used to build the deck.

**What an attacker or a dishonest Bank gains.** The level is a permanent money multiplier. If the Bank can choose the effective seed after knowing the blockhash, or can simply generate many candidate salts/decks and commit one that places Level V at indices it expects to control, it can allocate the highest-paying vaults to itself or favored customers. The on-chain Merkle proof only proves “this level is in the committed deck at this index”; it does **not** prove the deck was generated fairly.

**Precisely what a cheating Bank has to do.**

1. If `sha256(bank_salt)` is not published before the blockhash for slot X is knowable, the Bank can wait until it knows the blockhash, then choose `bank_salt` (or choose among many precomputed salts) until the resulting deck is favorable.
2. If slot X can be named after the blockhash is known, the Bank can name a past or otherwise known slot and grind salts against that known blockhash.
3. Even without grinding, the Bank can construct arbitrary roots directly and hand one to `commit_deck`; the program cannot distinguish a fair root from an arbitrary root.

**Evidence if this is right.**

- `commit_deck` accepts any non-zero 32-byte root: `require!(root != [0u8;32], BadDeckRoot); c.deck_root = root;`
- There is no instruction storing `sha256(bank_salt)`, slot X, reveal deadline, or deck census.
- A local test can generate 10,000 roots from arbitrary seeds, select one that assigns Level V to early indices, and `commit_deck` will accept it.

**Fix.**

- Make the commitment protocol enforceable: commit `sha256(bank_salt)` and slot X on-chain **before** the blockhash is knowable; later reveal `bank_salt` on-chain or in a publicly verifiable artifact tied to the committed root.
- Prefer a VRF or multi-party randomness ceremony where the Bank alone does not know the final seed.
- At minimum, before mainnet, require an independent, timestamped public reconstruction of the deck from the published salt and blockhash, and document the exact procedure as a ship gate.

---

### R1-2. HIGH — even a fairly generated deck can be gamed by Bank-controlled mint ordering

**Construct.** `mint_vault` requires `bank: Signer`. The deck index is `minted_total`, which the program owns, but the Bank decides which customer mints get co-signed and in what order.

**What an attacker or a dishonest Bank gains.** If the Bank knows the deck — and it does if it generated the salt/seed — it can let favored customers mint at indices that carry Level V and delay or refuse others. The proof stops the Bank from dealing off-deck, but it does not stop the Bank from assigning known deck positions through co-signature timing.

**Evidence if this is right.**

- `mint_vault` cannot proceed without the Bank signature: `require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, NotTheBank);`
- No on-chain mechanism binds a customer address, nonce, or mint slot to a deck index before the Bank signs.
- A simulation where the Bank signs only when `minted_total` is at a Level V index would mint Level V to the chosen owner.

**Fix.**

- Treat this as an explicit accepted limit if the Bank is trusted with allocation, and rewrite the “NO WAY TO GAME IT” claims accordingly.
- If the intent is to remove Bank discretion, introduce a customer-commitment or batch-ordering mechanism so the Bank cannot select which customer receives which index after seeing the deck.

---

### R1-3. HIGH — if the Bank never reveals the salt, the fairness claim is unfalsifiable

**Construct.** The file says: “At close the Bank reveals the salt and anyone recomputes the entire shuffle.” Nothing forces reveal.

**What an accident or dishonest Bank gains.** If the salt is never revealed, holders can verify individual Merkle proofs against the root only if they have the transactions and proofs, but they cannot verify that the root was produced from the claimed seed, blockhash, and census. “Assigned by fate” remains the Bank’s word.

**Evidence if this is right.**

- No on-chain reveal instruction exists.
- No off-chain gate in this tree fails if the salt is not published.
- The deck root alone does not reveal census or seed.

**Fix.**

- Make reveal a documented, dated, independently checked ship gate.
- Publish the full deck after reveal and run an automated checker that recomputes seed → deck → root and verifies every minted level against the deck.

---

### R1-4. MEDIUM — JS/Rust agreement is only proven for the suite’s deck shape, not the production deck

**Construct.** `bank/deck.mjs` builds proofs; `programs/cbob-vault-mint` verifies them. The suite proves agreement using a 90-card deck and only the indices actually minted in the test.

**What can go wrong.** A divergence or bug that only manifests for the 2,100-card tree, for indices not exercised, or for a promotion pattern not hit in the suite would not be caught by the current suite. This is not an active exploit by itself, but it is exactly the “two implementations of one hash scheme” hazard the prompt names.

**Evidence if this is right.**

- The suite deck is `[50,20,10,5,5]`, length 90.
- Production census is `[945,525,315,210,105]`, length 2,100 and max proof length 12.
- The on-chain suite does not commit the production root or verify boundary proofs for the production tree.

**Fix.**

- Add a local-validator arm that builds the 2,100-card production deck, commits its root, and verifies proofs for boundary cases: index 0, last index, indices with odd-layer promotions, and at least one index per level.
- Keep the off-chain `deck.mjs` selftest, but make its internal floor equality strict and cross-checked against `DECK_FLOOR` (see R5/R8).

---

### R1-5. LOW/INFO — Merkle construction itself appears sound against the named attacks

I did not find an exploitable second-preimage, promotion, duplicate-leaf, or wrong-index proof in the construction as written.

- Leaf tag `0x00` and node tag `0x01` domain-separate leaf and internal hashes.
- Leaf input is `tag || u32le(index) || level`, so leaves at different indices differ.
- Odd-node promotion is consistent between proof generation and verification.
- Sorted pairs remove direction bits but do not remove index binding because the index is inside the leaf.

This is not a confirmation of the overall fairness mechanism; it is only a negative result on the narrow Merkle mechanics.

---

## R2 — `programs/cbob-vault-mint/src/lib.rs`

### R2-1. HIGH — `commit_deck` does not bind deck length or census to `level_caps`/`max_supply`

**Construct.** `commit_deck(root)` stores only the Merkle root. `level_caps` are checked at mint, but nothing proves the committed deck contains exactly the capped census, or any census at all.

**What an attacker or an accident gains.**

- If the deck contains more of a level than `level_caps`, minting will permanently halt when the cap is reached but the deck still deals that level at a later index.
- If the deck contains fewer of a level than the cap, the remaining cap is unusable under the deck proof.
- If the deck is shorter than `max_supply`, minting halts when valid proofs stop existing.
- If `max_supply` is later ratcheted down below the remaining deck, minting halts early.

**Evidence if this is right.**

- `commit_deck` has no `census`, `deck_length`, or `seed_hash` argument.
- `mint_vault` checks `level_minted[li] < level_caps[li]` and then verifies the proof for `deck_index = minted_total`.
- There is no check that `level_caps` matches the deck’s level counts.
- A test can initialize caps `[5,5,5,5,5]`, commit a root for a deck with ten Level V cards, and observe `LevelCapReached` once five Level V mints have occurred.

**Fix.**

- Store `deck_length` and a committed census hash at `commit_deck`, or require the census as an argument and check it against `level_caps` and `max_supply`.
- Refuse `commit_deck` if the declared census does not equal `level_caps` or does not fit `max_supply`.
- If the design intentionally allows mismatch, document that a mismatch can permanently halt minting.

---

### R2-2. MEDIUM — `max_supply` can be ratcheted down without regard to `level_caps` or the committed deck

**Construct.** `initialize` requires `sum(level_caps) <= max_supply`. `update_wiring` allows `max_supply` to ratchet down, requiring only `x >= minted_total`. It does not require `x >= sum(level_caps)` or preserve the committed deck.

**What an attacker or an accident gains.** Admin can halt remaining mints or starve levels after the deck is committed. This may be intended as an emergency power, but it silently overrides the level-census invariant.

**Evidence if this is right.**

- `initialize`: `require!(cap_total > 0 && cap_total <= max_supply, BadLevelCaps);`
- `update_wiring`: `require!(x > 0 && x <= c.max_supply, BadSupplyCap); require!(x >= c.minted_total, BadSupplyCap);`
- No check compares the new `max_supply` to `level_caps` or deck length.

**Fix.**

- If the deck is committed, require `max_supply` updates to preserve the remaining committed supply, or make the operation governance-gated with an explicit warning.
- At minimum, emit an event or alarm condition when `max_supply` falls below `sum(level_caps)`.

---

### R2-3. LOW — caller cannot inject a fake `level` attribute through the checked paths

I did not find a bypass of the reserved/duplicate attribute checks:

- `level` is refused as a caller attribute by exact byte equality.
- Duplicate caller keys are refused.
- Empty keys are refused.
- The program appends exactly one `level` attribute and writes `attributes.len() + 1`.
- `level` must be `1..=5`, so zero and >5 are refused.

Case variants, Unicode lookalikes, or empty keys cannot affect `distribute.mjs`, because `levelFromAttributes` only accepts exact key `'level'` and exact values `I..V`.

---

### R2-4. LOW — documentation mismatch on 2,100-vault depth

The prompt says 2,100 vaults is depth 11. The Rust comment says depth 12. The actual maximum proof length for 2,100 leaves is 12:

`2100 → 1050 → 525 → 263 → 132 → 66 → 33 → 17 → 9 → 5 → 3 → 2 → 1`

This matters for the packet budget in R4.

**Fix.** Correct the documentation and use the measured proof length, not an assumed depth.

---

## R3 — `bank/distribute.mjs`

### R3-1. HIGH — a burned vault between DAS snapshot and level read can halt the whole distribution; this reopens the “unlevelled vault” DoS

**Construct.** `distribute.mjs` lists live vaults via DAS `getAssetsByGroup`, then for every live id calls `fetchAsset` to read the level **before** checking whether the asset account is still a live Core asset.

```js
try {
  const asset = await fetchAsset(umi, umiPk(v))
  const lv = levelFromAttributes(asset?.attributes?.attributeList)
  if (lv) levels[v] = lv
  else unreadableLevels.push([v, 'no single valid `level` attribute on the asset'])
} catch (e) {
  unreadableLevels.push([v, `could not read the asset: ...`])
}
```

Later, `allocateWeighted` refuses the entire distribution if any listed vault has no readable level.

**What an ordinary customer action gains.** A vault owner can bare-burn their own Core asset at any time; this is measured fact 1. If the burn lands after DAS returns the vault as live but before `fetchAsset` reads it, the asset may no longer decode as a live asset with attributes. The code then treats this as an unreadable level and halts all payouts.

This is reachable by:

- a malicious holder burning a funded vault during the distribution run;
- a legitimate redemption whose burn is not yet reflected in DAS;
- an ordinary bare burn of an unfunded vault if DAS still lists it live.

This contradicts the discharged limit 19 claim that the halt “can no longer be reached by an ordinary customer action.”

**Evidence if this is right.**

- The code order is: DAS live list → per-vault `fetchAsset` → balance read → allocation.
- The later “burned mid-run” check happens only in the transfer loop, after allocation:
  ```js
  const stillThere = await conn.getAccountInfo(new PublicKey(v), 'confirmed')
  if (!stillThere || stillThere.data.length < 1 || stillThere.data[0] !== 1) { ... }
  ```
- A local test can mint/fund a vault, force a stale DAS live list or mock the list, burn the asset via bare Core `BurnV1`, then run the level-read loop and observe `unreadableLevels` and refusal.

**Fix.**

- Before reading levels, batch-read raw asset accounts and exclude accounts that are not live Core `AssetV1` accounts (`data[0] !== 1`), recording them as burned/foreign rather than unlevelled.
- If `fetchAsset` throws, check the raw account state before adding to `unreadableLevels`.
- Keep fail-closed for accounts that are live but unreadable; do not fail-closed for accounts that are provably burned.

---

### R3-2. HIGH — accepted limit 22 is worse than stated: one transient RPC failure can halt all payouts; no retry, batching, or rate-limit handling is present

**Construct.** For each of ~2,100 vaults, the loop performs at least:

1. `fetchAsset(umi, umiPk(v))`
2. `conn.getAccountInfo(a, 'confirmed')`

sequentially, with no retry/backoff and no batching.

**What an accident gains.** A transient RPC error on vault 1,900 of 2,100 pushes that vault into `unreadableLevels`, then `allocateWeighted` refuses the entire distribution. At production scale, rate limits, timeouts, or one bad RPC response are likely without explicit handling.

**Evidence if this is right.**

- The loop has a `try/catch` around `fetchAsset`, but the catch records an unreadable level rather than retrying.
- There is no `setTimeout`, backoff, concurrency limiter, or batch RPC call.
- `allocateWeighted` returns `refusal: true` if any activated vault lacks a level; but because level reading happens before activation filtering, even an unactivated vault with a failed read can halt the run.

**Fix.**

- Use batch reads (`getMultipleAccountsInfo` or equivalent) for asset accounts and token accounts.
- Add bounded retries with backoff for transient RPC errors.
- Separate “RPC unreadable” from “on-chain state invalid,” and retry the former before refusing.
- Run a full-scale rehearsal per open limit 22 before any live payout.

---

### R3-3. LOW — weighted arithmetic is correct as written

I independently checked the allocator:

- Weights are `I:2, II:3, III:4, IV:5, V:6`.
- Denominator is the sum of weights of activated vaults only.
- `amt = available * weight / denominator` floors per vault.
- Dust is `available - total`, carried forward.
- Two vaults at the same level receive exactly the same amount because the formula depends only on level weight and denominator.

No arithmetic finding is filed for the allocation itself.

---

## R4 — packet bound at production deck depth

### R4-1. HIGH — the production attribute budget is not asserted; the deck root is one-shot and the current suite does not gate the 2,100-vault case

**Construct.** The deck proof is in the same 1,232-byte transaction as caller attributes. The suite measures a 90-card deck, not the 2,100-card production deck. No code or assertion pins the relationship between production proof depth and the provenance attributes the product needs.

**Re-derivation.**

The discharged CU measurement states a plain mint at the suite’s proof depth is 890 bytes. The 2,100-card deck has max proof length 12, not 11. The suite’s 90-card deck has max proof length 7. Each additional proof sibling costs 32 bytes.

Approximate zero-attribute production mint size:

`890 + (12 - 7) * 32 = 890 + 160 = 1,050 bytes`

Remaining packet budget:

`1,232 - 1,050 = 182 bytes`

If one uses the prompt’s “depth 11” number instead, the base is about 1,018 bytes and the remaining budget is 214 bytes. Either way, the margin is small.

Seven minimal test attributes of the form `k0..k6` / `v` cost:

- per attribute: `4 + 2 + 4 + 1 = 11` bytes
- seven attributes: `77` bytes
- plus the vec count already included in the base estimate

So minimal attributes fit. But any real provenance set using longer keys/values may not. With `MAX_ATTR_STR = 128`, worst-case attributes cannot fit. The product’s actual provenance attribute sizes are not pinned by any assertion.

**What an accident gains.** If the deck root is committed for the 2,100-card deck and the production provenance attributes are too large, `mint_vault` transactions may fail to serialize. Because the root is one-shot, this cannot be fixed after minting opens.

**Evidence if this is right.**

- `tests/3prog.test.ts` section 11 measures only the 90-card suite deck.
- The loop `for(let n=0;n<=7;n++)` cannot produce `maxAttrs > 7`; it does not independently prove the eighth attribute fails by packet size.
- Test 11.12 with eight attributes may fail due to the program’s `attributes.len() < MAX_ATTRS` bound, not the packet bound.
- There is no assertion using a 2,100-card deck and the exact production attribute set.

**Fix.**

- Before `commit_deck`, run a gate that builds a real `mint_vault` transaction using:
  - the production 2,100-card deck proof at maximum depth,
  - the exact maximum provenance attribute set,
  - the production name/URI lengths,
  and asserts serialized size ≤ 1,232.
- Add this to the suite as a permanent assertion, like the reserve-mint ceiling.
- Correct the depth documentation to 12 for 2,100 leaves.

---

### R4-2. LOW — the suite’s “packet bound” measurement is weaker than the prose claims

**Construct.** `attrFit` tests only `n = 0..7`. If all seven fit, `maxAttrs` becomes 7. That does not prove eight fails to serialize. The subsequent `oneMore` test uses `mkVault`, which has longer name/URI and is also subject to the program’s `attributes.len() < MAX_ATTRS` refusal.

**Evidence if this is right.**

- `for(let n=0;n<=7;n++){ if(await attrFit(n)) maxAttrs=n; else break }`
- `rec('11.11', ..., String(maxAttrs>=0&&maxAttrs<MAX_ATTRS_BORSH))`
- `oneMore` expects REJECT but has no `because()` because the rejection may be client-side or program-side.

**Fix.**

- Extend `attrFit` beyond 7 and distinguish “transaction too large” from program rejection.
- Assert the exact maximum attribute count for the production deck depth.

---

## R5 — Phase 1’s own changes

### R5-1. MEDIUM — the new stated-count gate is better, but still not sound against all phrasings; stale SPEC counts already pass it

**Construct.** The gate uses five regexes:

```js
'on-chain':   /(\d+) assertions, real cloned Core/g,
'detector':   /(\d+) detector\b/g,
'allocation': /(\d+) allocation\b/g,
'deck':       /(\d+) deck\b/g,
'mainnet':    /(\d+) live-mainnet\b/g,
```

It requires at least one match and all matches to equal the runner floor.

**What is wrong.**

1. It only checks those exact phrasings. A stale count written as “69 assertions”, “316-assertion suite”, “detector assertions: 439”, or “deck floor 17” may pass unchecked.
2. It can over-match non-floor phrases such as “7 deck” in prose, causing false failures.
3. It already misses at least two stale numbers in SPEC:
   - SPEC still says: `Every detector is proven in BOTH directions by bank/selftest.mjs (69 assertions).` The real detector floor is 439.
   - SPEC still says: `Thirteen AI audit rounds...` while elsewhere it says nineteen.

**Evidence if this is right.**

- `grep -n "69 assertions" SPEC.md` should show the stale detector count.
- The detector regex requires a number immediately before the word `detector`; “(69 assertions)” does not match.
- `grep -n "Thirteen AI audit rounds" SPEC.md` should show the stale round count; no regex checks round counts.

**Fix.**

- Do not rely on prose regexes for critical counts. Generate a machine-readable floor manifest from `scripts/run-tests.sh` and require SPEC to include it verbatim.
- If prose regexes are kept, add negative tests for alternate phrasings and explicitly gate the audit-round count.

---

### R5-2. LOW — `bank/deck.mjs` internal floor is still a lower bound, not equality

**Construct.** `bank/deck.mjs`:

```js
const FLOOR = 16
if (R.length < FLOOR) { ... }
```

But the selftest currently has 17 assertions and `run-tests.sh` expects `DECK_FLOOR=17`.

**What this gains.** The external runner floor catches a count mismatch today, but the internal file violates the project’s own “equality, not lower bound” rule. If someone lowers `DECK_FLOOR` and the SPEC count together, the internal floor would not resist deletion of one assertion.

**Fix.**

- Make `deck.mjs` require `R.length === FLOOR`.
- Add a selftest arm comparing `deck.mjs`’s internal floor to `run-tests.sh`’s `DECK_FLOOR`, as done for detector/allocation floors.

---

### R5-3. LOW — 11.13/11.14 prove a Core refusal, but not every actor or every future mechanism

**Construct.** The arms expect Core error `0x1a`, identified as `NoApprovals`. This shows the hand-built `UpdatePluginV1` reached an approval check and was refused, rather than failing deserialization.

**Limitations.**

- `0x1a` proves missing approval, not specifically “level immutability is permanent by design.”
- The arms test owner and Bank. They do not test the SEAL PDA itself, because the SEAL program has no instruction that signs for it. That is accepted limit 13: a future SEAL upgrade could add such an instruction.
- A Metaplex Core upgrade could also change plugin authority semantics; this is covered by the general Core-upgrade limit, not by these arms.

**Evidence.**

- The positive arm 11.15 reads the level back after the refusals, which is the strongest part of the test.
- The `because('11.13','0x1a')` and `because('11.14','0x1a')` arms guard against malformed-instruction false passes.

**Fix.** No code fix required beyond maintaining accepted limit 13. Do not describe these arms as proving more than “owner and Bank cannot rewrite via this Core instruction today.”

---

### R5-4. The corrected `detectors.mjs` comment about foreign nested assets is accurate

`bank/cosign.mjs` `scanPda` does:

- DAS `getAssetsByOwner` on the vault asset-signer PDA.
- Keeps every non-burnt asset regardless of collection.
- Refuses on DAS envelope problems via `judgeDasEnvelope`.
- Refuses a full page rather than judging a truncated list.

So the corrected statement — the gap is continuous advance warning, not redemption-time capability — is true.

---

## R6 — under-claim direction

### R6-1. MEDIUM — accepted limit 1a under-claims an existing on-chain control

**Construct.** Accepted limit 1a still says:

> “The program allowlist and the Bank-pubkey confinement are OFF-CHAIN. Nothing in any program bounds what else a redemption transaction contains; `open_for_redemption` scans forward only as far as its matching burn.”

That is no longer true for the Bank-pubkey confinement.

**What is actually true.**

- SEAL `open_for_redemption` walks all top-level instructions and refuses `BankKeyOutsidePair` if the Bank key appears outside the open/burn pair.
- MINT `mint_vault` walks all top-level instructions and refuses `BankKeyOutsideMint` if the Bank key appears outside the permitted mint slot.
- The control table in SPEC already describes these as ON-CHAIN.

**Why this matters.** An under-claim invites duplicate controls or incorrect incident response. It also leaves the accepted-limits list contradicting the code and the control table.

**Fix.** Rewrite limit 1a to separate:

- still off-chain/policy: program allowlist, fee-payer judgment, custody;
- closed on-chain: Bank-pubkey confinement in SEAL and MINT.

---

### R6-2. LOW/MEDIUM — `bank/distribute.mjs` still contains stale off-chain level comments that under-claim the current control

**Construct.** `distribute.mjs` still contains comments such as:

- “THE LEVEL LIVES OFF-CHAIN.”
- “The cheap fix is not on-chain storage, it is a COMMITMENT … This is not built.”

Those are contradicted by the levels-at-mint work in the same file and in MINT.

**Why this matters.** This is the same defect class: documentation saying a control does not exist when it now does. It can cause someone to build a redundant commitment or distrust the on-chain level.

**Fix.** Remove or rewrite the stale off-chain-level commentary.

---

## R7 — counts and arithmetic

### R7-1. Floors in `scripts/run-tests.sh` match the prompt for the four main suites; deck floor is 17

Verified in `scripts/run-tests.sh`:

```sh
DECK_FLOOR=17
DET_FLOOR=439
ALLOC_FLOOR=103
MAINNET_FLOOR=19
MIN_ASSERTIONS=316
```

The prompt’s quoted floors for on-chain, detector, allocation, and mainnet match. The deck floor is present but was not quoted in the opening prompt sentence.

---

### R7-2. Schedule arithmetic reproduces correctly

240-vault census:

```
108*2 + 60*3 + 36*4 + 24*5 + 12*6
= 216 + 180 + 144 + 120 + 72
= 732
```

2,100-vault census:

```
945*2 + 525*3 + 315*4 + 210*5 + 105*6
= 1890 + 1575 + 1260 + 1050 + 630
= 6405
```

Per $1,000 at 240 vaults:

```
I:  2000/732 = 2.73
II: 3000/732 = 4.10
III:4000/732 = 5.46
IV: 5000/732 = 6.83
V:  6000/732 = 8.20
```

Per $1,000 at 2,100 vaults:

```
I:  2000/6405 = 0.31
II: 3000/6405 = 0.47
III:4000/6405 = 0.62
IV: 5000/6405 = 0.78
V:  6000/6405 = 0.94
```

Shares at 2,100 vaults:

```
I:  1890/6405 = 29.5%
II: 1575/6405 = 24.6%
III:1260/6405 = 19.7%
IV: 1050/6405 = 16.4%
V:   630/6405 = 9.8%
```

Rounded to one decimal, these sum to 100.0%.

No arithmetic finding is filed for these card figures.

---

### R7-3. MEDIUM/LOW — stale customer-facing numbers remain in SPEC

These are not floor numbers, but they are wrong counts in the same document the gates are supposed to protect:

1. `Every detector is proven in BOTH directions by bank/selftest.mjs (69 assertions).`  
   Real detector floor: 439.

2. `Thirteen AI audit rounds have each found something real...`  
   Elsewhere SPEC says nineteen rounds.

**Fix.** Correct both. Add a gate for the audit-round count if it is customer-facing.

---

## R8 — one-of-N-sites

### R8-1. MEDIUM — equality-floor discipline was not applied to `bank/deck.mjs`

The project repaired lower-bound floors in `run-tests.sh`, `bank/selftest.mjs`, and `bank/distribute.mjs`. `bank/deck.mjs` still uses `R.length < FLOOR`. This is the same one-of-N defect shape.

**Fix.** Apply equality and cross-check the deck floor in `bank/selftest.mjs`.

---

### R8-2. MEDIUM — the audit-prompt interpolation gate still checks `audit19.ts`, not the current `audit20.ts`

`bank/selftest.mjs` has a round-19 arm that reads `/opt/cbob-vaults/scripts/audit19.ts` and checks escaped interpolations/floor lines. The new round script is `scripts/audit20.ts`. If `audit20.ts` shipped a literal `${FLOORS.onchain}` or an escaped floor that should interpolate, the existing gate would not see it.

**Evidence if this is right.**

- The arm explicitly reads `audit19.ts`.
- `audit20.ts` now contains the live prompt floor interpolations.

**Fix.** Generalize the gate to all current audit runner scripts, or at least to the newest one, and make it fail if no current script is checked.

---

### R8-3. MEDIUM — new MintConfig money fields are not in the alarm’s watched key set

`MintConfig` now contains:

- `level_caps`
- `level_minted`
- `deck_root`

`bank/detectors.mjs` WATCH does not include `mint.level_caps`, `mint.level_minted`, or `mint.deck_root`.

**What an accident gains.** If a program upgrade or bug changes these fields, config drift detection will not fire unless the program bytes/upgrade authority also change. `deck_root` in particular should be immutable after commitment; any change should be CRITICAL.

**Fix.**

- Add `mint.deck_root`, `mint.level_caps`, and `mint.level_minted` to WATCH.
- Ensure the config reader populates them.
- Treat any post-commit change to `mint.deck_root` as CRITICAL.

---

### R8-4. LOW — stale-comment repairs were not applied to all sites

Examples:

- Accepted limit 1a still says Bank-pubkey confinement is off-chain.
- `distribute.mjs` still says the level lives off-chain and the commitment is not built.
- `MintError::BadSplit` message still says the multiple-of-100 rule is “so the royalty plugin can express it,” while the code comment says that justification is false.

**Fix.** Sweep all documents and error messages for claims contradicted by the levels-at-mint and confinement work.

---

## Accepted limits — the four questions

### 1. Is any limit WORSE than stated?

Yes.

- **Limit 22** is worse than stated: beyond being untested at scale, the current code has no retry/batching and can halt all payouts on one transient read. It also reads levels before filtering burned/unusable assets, creating the R3-1 halt path.
- **Limit 23** is worse than stated: the production packet budget is not asserted, the 2,100 proof depth is 12 rather than 11 in some prose, and the deck root/census/caps relationship is not enforced.
- **Discharged limit 19** is not fully discharged: the burned/DAS race in R3-1 is an ordinary customer-reachable halt path.

### 2. Is anything listed as an accepted limit not actually a limit?

Yes.

- **Limit 1a** is partially obsolete. The Bank-pubkey confinement is now on-chain in SEAL and MINT. The remaining off-chain parts are the program allowlist, fee-payer judgment, and custody. The item should be rewritten, not re-filed as a new defect.

### 3. Is any DISCHARGED item not actually discharged?

Yes.

- **Limit 19** should be reopened or narrowed. The level is written at mint, but a burned vault can still appear live in DAS during distribution and cause a whole-payout halt because the level read happens before the live-account check.

The CU discharge for **12/17** appears sound for the measured suite. I would add a production-depth byte/CU measurement before freeze, but the existing measurement is not refuted.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

There is a risk.

- **Limit 22**: nothing in the diff shows a live-chain distribution rehearsal. The code still lacks retry/batching, so it should remain hard-blocking.
- **Limit 23**: nothing prevents `commit_deck` from being called without a production packet-budget measurement. Unless a gate or ceremony enforces that measurement, this open item can be quietly ignored.

---

## Anything else

### A-1. MEDIUM — `bank/deck.mjs` seed concatenation has no domain/length separation

`seedFrom` computes:

```js
sha(Buffer.from(bankSalt), Buffer.from(blockhash))
```

This is plain concatenation. If `bankSalt` and `blockhash` are variable-length strings, different `(salt, blockhash)` pairs can produce the same concatenated input. Solana blockhashes are usually a known base58 shape, which reduces the risk, but the construction should still be length-prefixed or domain-separated.

**Fix.** Use `sha256(len(salt) || salt || len(blockhash) || blockhash)` or a tagged hash.

---

### A-2. LOW — `DeckCommitted` and `VaultMinted` events omit useful verification data

`DeckCommitted` emits only `root`. `VaultMinted` does not emit `level` or `deck_index`. This makes independent post-hoc verification harder.

**Fix.** Emit `level` and `deck_index` in `VaultMinted`; consider emitting a salt-hash/slot commitment if that becomes on-chain.

---

### A-3. LOW — `audit20.ts` reads HEAD after prompt construction

The prompt is built at module scope. `main()` reads `HEAD` afterward. If a commit lands between prompt construction and the first `HEAD` read, the manifest can name a commit the auditors did not see. The later `headAfter` check does not catch a commit that landed before the initial `HEAD` read.

**Fix.** Read `HEAD` and dirty state before constructing the prompt, then compare again after.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

The following are things the project should do that repeated AI audit rounds structurally cannot do:

1. **Run a full-scale operational rehearsal, not a test suite.**  
   Mint or simulate all 2,100 vaults on a staging cluster with a real RPC provider and real DAS behavior. Run `distribute.mjs` repeatedly under:
   - transient RPC failures,
   - rate limits,
   - a burn landing during the run,
   - poisoned ATAs,
   - concurrent mints,
   - ambiguous transfer timeouts.
   The pass criterion is not “no error”; it is “no double payment, no silent skip, and a documented recovery path for each halt.”

2. **Run an adversarial griefing window with real participants.**  
   AI rounds can reason about attacks, but they do not produce the timing diversity of real users. Before mainnet, invite controlled participants to attempt:
   - burning during distribution,
   - airdusting vault PDAs,
   - nesting assets,
   - creating Token-2022 accounts,
   - racing mint order,
   - spamming RPC reads during payout.
   Record every halt and decide which are accepted limits.

3. **Make the deck ceremony physically verifiable.**  
   The AI process cannot witness a salt-generation ceremony. Use offline randomness, a timestamped public commitment, and at least one independent party that can later reconstruct the deck. If the Bank refuses reveal, the system should treat that as a public, buyer-facing limit before minting opens.

4. **Separate operational key custody from code.**  
   The Bank, distributor, and swap-operator keys need hardware or controlled-signer custody. The Bank must remain a plain keypair for redemption pairing, but that does not mean it should be a file readable by every cron context. A signer service with policy checks and audit logs is an operational control no source repository can provide.

5. **Operate an independent watcher outside this repository.**  
   The current alarm is thorough but self-referential. Run a second, minimal monitor from a different codebase or account that independently checks:
   - `deck_root` has not changed,
   - `level_caps` and `max_supply` have not moved,
   - distribution refusals occur,
   - large level-V mint concentration occurs,
   - Bank key rotation is armed.
   This is not another audit; it is a runtime check that the audited code remains the deployed code.