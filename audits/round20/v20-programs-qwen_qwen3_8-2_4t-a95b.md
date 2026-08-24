

# Round 20 independent audit — faults in `acce0c1..HEAD`

Scope: the five commits under audit, especially `bank/deck.mjs`, the MINT program’s deck/level machinery, `bank/distribute.mjs` level reads, the packet-bound tests, and Phase-1 self-audit repairs. I am not confirming any of this is safe. Where I did not find a defect I say what I checked and what evidence would disprove it.

---

## R1 — `bank/deck.mjs` and the seed/deck commitment

### R1-1. CRITICAL — The “publicly verifiable” deck is not enforceable; a Bank that never reveals the salt has shipped an unfalsifiable money oracle

**Exact construct**

- `bank/deck.mjs` says:

  ```js
  seed = sha256( bank_salt || blockhash(slot X) )
  ```

  and says the Bank publishes `sha256(bank_salt)` and names slot X before minting opens, then reveals the salt at close.
- On-chain, `programs/cbob-vault-mint/src/lib.rs` stores only:

  ```rust
  pub deck_root: [u8; 32],
  ```

  `commit_deck` accepts a root and refuses a second root. It does **not** store:
  - `sha256(bank_salt)`,
  - slot X,
  - the census used to build the deck,
  - a reveal deadline,
  - or any proof that the root was derived from the claimed seed.

**What an attacker or accident gains**

A malicious or compromised Bank can:

1. Build any deck it wants, respecting only the on-chain `level_caps`, and commit its Merkle root.
2. Provide valid proofs at mint time for every level it chose.
3. Never reveal `bank_salt`, or reveal it only after levels have already been assigned and paid against.
4. Leave holders with no technical way to prove the deck was not handcrafted.

This defeats the stated purpose in the file header: “Neither stops the BANK dealing itself the good cards. That is what this file is for.” The file does not stop that. It only stops a Bank from lying about a level at a given index **relative to a root it chose**. If the root itself was chosen arbitrarily, the deck proof is a proof of nothing except internal consistency.

**Evidence that would exist if this is right**

- Inspect `MintConfig`: there is no `salt_hash`, no `slot`, no `census_hash`, no reveal state.
- Run a local test: generate a secret “deck” manually assigning Level V to chosen indices, compute its Merkle root using `bank/deck.mjs`, call `commit_deck`, then mint with those proofs. The program accepts them. Nothing on-chain asks for the seed.
- If the Bank never publishes the salt, no external verifier can recompute `seed`, `buildDeck`, or `deckRoot`. The claim “anyone recomputes the entire shuffle” is conditional on the Bank cooperating.

**Fix**

Do not treat this as a solved property. Minimum:

1. Publish, in an immutable timestamped medium, all of the following before slot X occurs:
   - `sha256(bank_salt)`,
   - slot X,
   - census,
   - the eventual `deck_root` derivation procedure.
2. Reveal `bank_salt` and the blockhash for slot X before the first level-based payout.
3. Ship an independent verifier script that:
   - recomputes the seed,
   - rebuilds the deck,
   - recomputes the Merkle root,
   - checks every minted vault’s on-chain `level` against its `minted_total` index.
4. Make the operational rule explicit: if the salt is not revealed by a deadline, distributions are halted and the deck is treated as unverified.
5. Better, but larger: put the salt-hash and slot commitment on-chain and require a reveal before payouts, or use a randomness source the Bank cannot choose.

Until then, “the deck was not chosen after the fact” is not a system property. It is a promise.

---

### R1-2. HIGH — Even with a perfect commit-reveal, the Bank can still allocate good cards to chosen minters by controlling index assignment

**Exact construct**

- The deck assigns a level to each mint index.
- The index is `minted_total`, owned by the program.
- Every mint requires `bank: Signer` and `require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, ...)`.
- The Bank knows `bank_salt`. Once slot X’s blockhash exists, the Bank can compute the full deck before minting opens.

**What an attacker gains**

The Bank cannot change the level at index `i`, but it can choose **which customer mints at index `i`** by controlling co-signature timing and transaction submission order.

If the Bank knows indices that carry Level V, it can:

- refuse to co-sign other customers while a Level V index is next,
- co-sign a friendly mint at that index,
- repeat for Level IV, etc.

The on-chain deck proof prevents minting an undealt level at a given index. It does not prevent the Bank from mapping users to indices.

**Evidence**

This is not something a local validator test will flag, because the suite uses a trusted test Bank. The evidence is structural:

- `mint_vault` cannot be executed without the Bank signature.
- The Bank can compute the deck from `seed`.
- There is no on-chain queue, user commitment, or index assignment independent of the Bank.

A concrete operational test would be: with a known seed, have the Bank sign mints only when the next `minted_total` index corresponds to Level V. The resulting Level V vaults all land on Bank-chosen addresses. The program cannot distinguish this from fairness.

**Fix**

Either:

1. Accept this as a written, buyer-facing limit: “The Bank can sequence minters to known deck indices.”
2. Or redesign assignment so the Bank does not know the deck before user-to-index commitments are fixed, e.g. user commit-reveal, public VRF, or post-mint random assignment not controlled by the co-signer.

The current documentation phrase “NO WAY TO GAME IT” is too strong.

---

### R1-3. HIGH — The slot is not bound by the program; a Bank can grind slots unless the publication procedure is much stricter than stated

**Exact construct**

The seed uses `blockhash(slot X)`. The code does not record slot X. The prompt says the Bank publishes `sha256(bank_salt)` and names slot X before minting opens.

**What an attacker gains**

If the Bank publishes `sha256(bank_salt)` but does not immutably commit to slot X before slot X occurs, it can:

1. Keep the salt fixed.
2. Observe many blockhashes.
3. For each candidate slot, compute `seed = sha256(salt || blockhash(slot))` and the resulting deck.
4. Choose the slot whose deck is most favorable.
5. Announce that slot as if it had been chosen in advance.

This is not a SHA-256 break. It is a missing commitment to the public randomness half.

**What stops the Bank choosing the salt after seeing the blockhash?**

Only a prior, immutable publication of `sha256(bank_salt)`. If that publication is genuinely before the blockhash is known, finding another salt with the same hash is preimage resistance. But if the publication time is not provable, or if the Bank can rewrite history, this control does not exist.

**What stops the Bank choosing the slot?**

Nothing in the repository. Only an external procedure can stop it.

**Evidence**

- There is no on-chain slot commitment.
- A simulation can demonstrate it: fix one salt, iterate over many historical blockhashes, compute decks, and select a slot that moves a desired index to Level V.

**Fix**

The publication must include, in one timestamped artifact:

- `sha256(bank_salt)`,
- slot X,
- census,
- derivation rules.

Slot X must be in the future at publication time. The artifact should be published in at least one place the Bank cannot later edit.

---

### R1-4. MEDIUM — The Merkle root is not bound to deck length or census; an inconsistent root can permanently wedge minting

**Exact construct**

- `initialize` accepts `level_caps` and requires only:

  ```rust
  require!(level_caps.iter().all(|c| *c > 0), MintError::BadLevelCaps);
  require!(cap_total > 0 && cap_total <= max_supply, MintError::BadLevelCaps);
  ```

- `commit_deck` accepts any nonzero 32-byte root.
- `mint_vault` verifies only that `leaf(minted_total, level)` proves against that root.
- Nothing proves the root corresponds to:
  - a deck of length `cap_total`,
  - a deck of length `max_supply`,
  - the same census as `level_caps`,
  - or any census at all.

**What an accident gains**

If the committed root is built from a deck whose per-level counts do not match `level_caps`, minting can permanently halt.

Example:

- `level_caps[I] = 1`
- committed deck index 0: I
- committed deck index 1: I

Mint index 0 succeeds and exhausts Level I cap. Mint index 1 now requires Level I again, but `level_minted[I] == level_caps[I]`, so `LevelCapReached` fires. Because the deck index cannot skip, all minting halts. The root is one-shot, so this cannot be repaired without program redeploy or state migration.

**Evidence**

A local validator test can prove this:

1. Initialize with tiny caps.
2. Commit a root built from a deck whose census exceeds one cap.
3. Mint until the cap is exhausted.
4. Observe `LevelCapReached` at the next index even though `minted_total < max_supply`.

**Fix**

Before committing the production root:

1. Generate the deck from the exact production census.
2. Verify `census == level_caps`.
3. Verify deck length equals intended supply.
4. Publish the deck root only after that check.
5. Ideally, store a `deck_length` or `census_hash` commitment and gate minting on a revealed deck matching it.

---

### R1-5. MEDIUM — The JS/Rust Merkle agreement is proven only for the suite’s small deck and limited indices; production tree shapes are not exercised on-chain

**Exact construct**

- `bank/deck.mjs` builds proofs.
- `programs/cbob-vault-mint/src/lib.rs` verifies proofs.
- The on-chain suite imports `bank/deck.mjs` and uses a 90-card deck:

  ```ts
  const DECK_CENSUS:[number,number,number,number,number]=[50,20,10,5,5]
  ```

- The suite mints some vaults, but it does not mint all 90 indices and does not use the production 2,100-card deck.

**What would have to be true for the two implementations to disagree in a way the suite would not catch?**

A divergence would need to depend on a tree shape or proof shape not exercised by the suite, for example:

- 2,100 leaves rather than 90,
- proof length 11 or 12 rather than 7,
- high indices such as 2099,
- multiple odd-node promotions across higher layers,
- a promoted node being combined after several omitted siblings.

The current code appears byte-compatible on inspection, but inspection is exactly what the file’s own comment says is insufficient.

**Evidence**

If such a disagreement existed, the following test would fail while the current suite could still pass:

- Build a 2,100-card deck in `bank/deck.mjs`.
- Compute proofs for all indices, or at least high/promotion-heavy indices.
- Verify those proofs against the Rust `deck_root_from` in a Rust unit test or an on-chain instruction.

Currently no such on-chain/Rust-side production-size proof test exists.

**Fix**

Add a non-transactional Rust unit test that verifies JS-generated proofs for the production census, including indices 0, 1, 1049, 2099 and any odd-promotion paths. Better: add a test-only program instruction or harness that verifies arbitrary deck proofs without minting, and run it against the full 2,100 proof set.

---

### R1-6. LOW — Seed encoding is not canonically specified

**Exact construct**

```js
export const seedFrom = (bankSalt, blockhash) => sha(Buffer.from(bankSalt), Buffer.from(blockhash))
```

`Buffer.from(string)` defaults to UTF-8. The repository does not specify whether `bankSalt` and `blockhash` are:

- raw bytes,
- hex,
- base58,
- UTF-8 strings,
- normalized Unicode.

**What can go wrong**

A reveal can be technically correct under one encoding and unverifiable under another. This is an operational ambiguity, not an exploitable cryptographic break.

**Fix**

Specify exact byte encoding in the deck file and in the public verifier. Prefer hex or base64 with explicit decoding, not default UTF-8.

---

### R1-7. Merkle construction attacks considered and not found

I checked the following and did not find a practical defect in the Merkle scheme itself:

- **Second-preimage across leaf/internal domains:** leaf input begins `0x00`, internal node input begins `0x01`; leaf preimage is 6 bytes, node preimage is 65 bytes. This is adequate domain separation.
- **Odd-node promotion:** promotion without self-hashing avoids the duplicate-leaf/self-pairing issue. Leaf indices make duplicate leaves impossible except by SHA-256 collision.
- **Duplicate leaves:** leaves include `index_le`, so equal levels at different indices produce different leaves.
- **Proof for wrong index:** leaf includes index; replay at another index changes the leaf hash.
- **Depth ambiguity:** proof length is variable, but the leaf hash and SHA-256 collision resistance prevent a truncated proof from validating unless the omitted path was genuinely promoted. This is standard for this shape.
- **Tag separation:** tags are one byte and consistent in JS and Rust.

This is not a certification; it is a statement that the specific Merkle attacks asked about did not produce a finding.

---

## R2 — The level on chain in `programs/cbob-vault-mint/src/lib.rs`

### R2-1. MEDIUM — Level-cap exhaustion with an inconsistent deck halts all minting; this is fail-closed but can be permanent

**Exact construct**

```rust
require!(cfg.level_minted[li] < cfg.level_caps[li], MintError::LevelCapReached);
...
require!(
    deck_root_from(deck_leaf(deck_index, level), &deck_proof) == cfg.deck_root,
    MintError::BadDeckProof
);
```

If the next deck index is a level whose cap is already full, minting fails for everyone.

**What an attacker or accident gains**

A Bank/admin that commits the wrong root, or initializes caps inconsistent with the deck census, can permanently wedge the sale. There is no instruction to clear or replace `deck_root`.

**Evidence**

Same as R1-4: construct a caps/deck mismatch and observe `LevelCapReached` blocking the next index.

**Fix**

This is intended as a hard ceiling, but the absence of a recovery path makes pre-commit verification load-bearing. Require a scripted pre-commit check that the deck census equals `level_caps`, and record the check output in the launch artifacts.

---

### R2-2. LOW — `max_supply` can be ratcheted below the sum of `level_caps` after initialization

**Exact construct**

`initialize` requires:

```rust
cap_total <= max_supply
```

`update_wiring` allows `max_supply` to ratchet down, but only checks:

```rust
require!(x > 0 && x <= c.max_supply, MintError::BadSupplyCap);
require!(x >= c.minted_total, MintError::BadSupplyCap);
```

It does not check `x >= sum(level_caps)`.

**Consequence**

If `max_supply` is lowered below the level-cap total, the global supply cap will bind before all level caps can be used. This is not an overrun, but it can make part of the census permanently unusable.

**Evidence**

Initialize with caps summing 100 and `max_supply` 100. Lower `max_supply` to 50 after no mints. The program allows it. Level caps still say 100 total, but supply cap prevents using them.

**Fix**

Either forbid lowering `max_supply` below `sum(level_caps)`, or document that supply ratchet can intentionally strand unused level caps.

---

### R2-3. LOW — Reserved-key check is exact-byte only; lookalike keys are allowed

**Exact construct**

```rust
require!(a.key != ATTR_LEVEL, MintError::ReservedAttribute);
```

This rejects exactly `"level"`. It does not reject:

- `"Level"`,
- `"level "`,
- `"level\u{200b}"`,
- Unicode confusables.

**Consequence**

Today this does not affect payout because `levelFromAttributes` also matches exactly `'level'`. But it means a vault can carry a confusing fake level-like attribute alongside the real one. Any future reader that normalizes keys could be misled.

**Evidence**

Mint with attribute key `"Level"`; program accepts. `levelFromAttributes` ignores it.

**Fix**

Either reject keys that normalize to `level` under a defined normalization, or document that attribute keys are exact-byte and all readers must remain exact-byte.

---

### R2-4. Checks I did not find a bypass for

I traced `mint_vault` and did not find a way for a caller to obtain an undealt level through the specific constructs asked about:

- The caller cannot set the exact `level` attribute; it is reserved.
- The program appends exactly one `level` attribute.
- Duplicate caller attribute keys are rejected.
- The level argument is range-checked `1..=5`.
- The deck proof is checked against `minted_total`, not caller-controlled data.
- The Bank confinement loop checks all top-level instructions and fails if the Bank key appears outside the `bank` slot of a `mint_vault`.
- Account substitution is constrained by PDAs, `has_one`, address checks, and signer requirements.
- Multiple `mint_vault` instructions in one transaction consume sequential indices; they do not allow skipping the deck index.

This is not a proof of absence of all bypasses; it is the result of the trace requested.

---

## R3 — The level at payout in `bank/distribute.mjs`

### R3-1. HIGH — A bare Core `BurnV1` plus DAS lag creates a customer-triggerable temporary payout halt

**Exact construct**

`distribute.mjs` builds the vault list from DAS:

```js
method: 'getAssetsByGroup'
```

It separates `live` and `burnt` based on DAS. Then for every DAS-live vault it does:

```js
const asset = await fetchAsset(umi, umiPk(v))
const lv = levelFromAttributes(asset?.attributes?.attributeList)
```

If the level is unreadable and the vault’s ATA balance is at least 21,000 sats, `allocateWeighted` refuses the whole distribution.

**The window**

Measured fact 1 says a bare Core `BurnV1` by the owner cannot be prevented. Measured fact 4 says Core `BurnV1` does not sweep the asset-signer PDA. It also does not close token accounts owned by the PDA.

So a customer can:

1. Hold an activated vault, or fund a vault’s ATA to activation.
2. Call Core `BurnV1` directly.
3. Leave the cbBTC ATA still funded.
4. Do this shortly before the daily distribution.

If DAS has not yet marked the asset as burnt, `getAssetsByGroup` still returns it as live. `fetchAsset` then fails or returns no readable Attributes plugin because the on-chain account is a tombstone. The ATA balance is still >= 21,000. The vault is therefore “activated” but has no readable level. `allocateWeighted` refuses.

**What an attacker gains**

A self-destructive holder can halt payouts for all other holders until DAS catches up or an operator reruns the job. The attacker loses their own vault and possibly their own cbBTC, but can delay everyone else.

This contradicts the discharged wording for limit 19: “there is no window in which a vault is activated but unlevelled” and “it can no longer be reached by an ordinary customer action.” There is a window created by DAS lag after a bare burn.

**Evidence that would exist if this is right**

- On a cluster with DAS, bare-burn a funded vault.
- Immediately run `distribute.mjs` before DAS marks it burnt.
- Expected log: `N vault(s) have no readable level` followed by allocation refusal.
- If DAS cannot be made to lag deterministically, simulate it: make `getAssetsByGroup` return a burnt asset as live and make `fetchAsset` throw. The code path refuses.

**Fix**

Do not treat DAS as the final authority for liveness when the chain can answer directly.

For each DAS-live vault, before treating it as activated:

1. `getAccountInfo(asset)`.
2. If account exists and `data[0] != 1` (`Key::Uninitialized` tombstone), treat it as burnt locally and exclude it from payout.
3. If the RPC read fails, halt; do not guess.

This preserves fail-closed behavior for RPC errors while closing the bare-burn DAS-lag DoS.

---

### R3-2. MEDIUM — The level-read loop has no retry, no batching, no backoff, and one uncaught RPC failure class

**Exact construct**

For every vault:

```js
try {
  const asset = await fetchAsset(umi, umiPk(v))
  ...
} catch (e) {
  unreadableLevels.push(...)
}
const info = await conn.getAccountInfo(a, 'confirmed')
```

**Problems**

1. `fetchAsset` failures are collected, but a transient RPC error on one vault becomes a whole-distribution refusal if that vault is activated.
2. `conn.getAccountInfo(a, 'confirmed')` is outside the try/catch. A transient RPC failure there aborts `main()` entirely.
3. There is no retry/backoff for 429 or 5xx.
4. There is no batching. At 2,100 vaults this is roughly:
   - 2,100 asset reads,
   - 2,100 ATA reads,
   - plus DAS pages.
5. The reads are sequential. A slow RPC makes the job long; a rate-limited RPC makes it fail.

**What an accident gains**

A normal RPC hiccup can halt payouts. A rate-limit storm can make every level read appear unreadable, causing a refusal. The job has no checkpoint for level reads, so a failure near vault 1,900 restarts from zero next run.

**Evidence**

- Inject a mock RPC that returns 429 on the 1,900th `fetchAsset`. Current code will mark that vault unreadable and, if activated, refuse the distribution.
- Inject a 429 on `getAccountInfo` for an ATA. Current code throws out of `main()` and exits via the `withLock` catch path.

**Fix**

Before production:

1. Wrap ATA reads in the same per-vault failure handling.
2. Add bounded retries with exponential backoff for transient RPC errors.
3. Batch account reads with `getMultipleAccountsInfo` in chunks.
4. Consider caching levels after first successful read, because levels are intended to be immutable. If caching is added, include a deliberate re-verification policy for suspected upgrades or incident response.
5. Record level-read failures in the ledger with reasons, not just the allocator’s generic refusal string.

This is part of open limit 22, but the specific uncaught `getAccountInfo` path is a code defect, not merely “untested live.”

---

### R3-3. LOW — `unreadableLevels` reasons are printed but not persisted in the refusal record

**Exact construct**

```js
if (unreadableLevels.length) {
  console.error(...)
}
```

Later, if allocation refuses, the ledger stores:

```js
st.days[day].refused = plan.skip
```

`plan.skip` comes from `allocateWeighted` and says only:

```js
`${unlevelled.length} activated vault(s) carry no level: ...`
```

It does not preserve whether the cause was:

- no level attribute,
- two level attributes,
- invalid level value,
- fetch threw due RPC,
- fetch threw due tombstone account.

**Consequence**

An operator debugging a halt sees the console only if they have the log. The ledger itself loses the diagnostic distinction.

**Fix**

Persist `unreadableLevels` into the day record alongside `refused`.

---

### R3-4. Allocation arithmetic checked

I re-derived the allocator behavior:

- Weights are `I:2, II:3, III:4, IV:5, V:6`.
- Denominator is sum of weights of activated vaults only.
- Each vault gets `floor(available * weight / denominator)`.
- Two vaults at the same level receive exactly the same amount because the formula depends only on level weight and denominator.
- Dust is `available - total`, and `total <= available`.
- Dust is carried, not split.
- The tight dust bound is less than one satoshi per paid vault, not per denominator unit.

I did not find an arithmetic defect in `allocateWeighted` itself.

---

## R4 — Packet bound at production deck size

### R4-1. CRITICAL — At the real 2,100-vault deck depth, a legacy mint transaction cannot fit even zero caller attributes

**Exact construct**

The suite measures at a 90-card deck, proof depth 7:

- seven caller attributes fit,
- the eighth does not serialize.

The production census is 2,100. A 2,100-leaf tree has proof length up to 12 by the layer count:

```text
2100 -> 1050 -> 525 -> 263 -> 132 -> 66 -> 33 -> 17 -> 9 -> 5 -> 3 -> 2 -> 1
```

Even if one uses “depth 11” as the prompt does, the proof is 4 or 5 nodes longer than the depth-7 test proof.

Each additional proof node costs 32 bytes. The minimal test attribute used in `attrFit` costs 11 bytes:

```js
key: "k0" => 4-byte length + 2 bytes
value: "v" => 4-byte length + 1 byte
```

From the suite measurement:

- with 7 attributes, size <= 1232;
- with 8 attributes, size > 1232;
- therefore the 7-attribute transaction size is > 1221.

Now remove all seven attributes, saving at most 77 bytes, and add the production proof growth:

- if proof grows by 4 nodes: +128 bytes, net +51 bytes;
- if proof grows by 5 nodes: +160 bytes, net +83 bytes.

So a zero-attribute mint transaction at production depth is still at least roughly 1273 to 1316 bytes under the same transaction shape, i.e. over the 1,232-byte limit.

**What an accident gains**

If the 2,100-card root is committed, ordinary legacy mint transactions with provenance attributes may become impossible. If even zero attributes do not fit, the product cannot stamp the provenance it says it needs. The root is one-shot, so this cannot be fixed after minting opens.

**Evidence**

This can be checked directly:

1. Build a 2,100-card deck with `bank/deck.mjs`.
2. Commit its root locally.
3. Construct the same `mint_vault` transaction used in `attrFit`, with `attributes = []`.
4. Serialize as legacy.
5. Expected result: `Transaction too large`.

The current suite does not perform this production-size measurement. It measures only the 90-card deck.

**Fix**

Before committing the production root:

1. Measure the exact production mint transaction with the real deck proof, real attribute set, and real client path.
2. If legacy cannot fit, implement and test versioned transactions with address lookup tables, or reduce account/data overhead, or change the deck commitment scheme.
3. Add a hard gate that refuses to commit a production root unless the production packet budget has been measured and passes.

This is open limit 23, but the limit as written understates the problem. It says the attribute budget falls. At 2,100 cards, the legacy budget appears to be negative.

---

### R4-2. MEDIUM — Nothing asserts the production packet relationship; 11.11 only asserts the test-deck relationship

**Exact construct**

Test 11.11:

```ts
rec('11.11','the caller attribute budget is a MEASURED packet bound, not the Borsh 8','true',
  String(maxAttrs>=0&&maxAttrs<MAX_ATTRS_BORSH))
```

This asserts that, for the current test deck, the packet bound is below Borsh. It does not assert:

- the production deck depth,
- the production attribute requirement,
- that zero attributes fit,
- that the production root can be used at all.

**Evidence**

The test prints the depth and max attributes but does not gate on a production census.

**Fix**

Add a suite arm that builds the production deck, or at least a deck with the production proof length, and asserts the required provenance attribute count fits under the intended transaction format.

---

## R5 — Phase 1’s own changes

### R5-1. MEDIUM — `bank/deck.mjs` has a slack floor and uses `<`, not equality; direct execution can pass with a deleted assertion

**Exact construct**

`bank/deck.mjs` selftest:

```js
const FLOOR = 16
if (R.length < FLOOR) { ... }
```

But it actually has 17 assertions, and `scripts/run-tests.sh` has:

```bash
DECK_FLOOR=17
```

The runner’s `floor()` now demands equality. The deck module itself does not.

**What an accident gains**

If someone deletes one deck assertion, `node bank/deck.mjs --selftest` can still exit 0 as long as 16 remain. `run-tests.sh` would catch it because the external floor is 17, but the file’s own gate is slack and violates the project’s equality rule.

This is also a one-of-N-sites recurrence: equality floors were applied to `selftest.mjs`, `distribute.mjs`, and `run-tests.sh`, but not to the new `deck.mjs`.

**Evidence**

Delete one assertion from `bank/deck.mjs` selftest. Direct execution exits 0 if 16 assertions remain. `scripts/run-tests.sh` fails only because of the external floor.

**Fix**

In `bank/deck.mjs`:

```js
const FLOOR = 17
if (R.length !== FLOOR) { ... }
```

Also add a `bank/selftest.mjs` arm comparing `deck.mjs`’s internal floor to `DECK_FLOOR`, like the detector and allocation floors.

---

### R5-2. LOW — The new SPEC count gate checks only five exact phrasings; stale counts in other phrasings can still pass

**Exact construct**

```js
const RX = {
  'on-chain':   /(\d+) assertions, real cloned Core/g,
  'detector':   /(\d+) detector\b/g,
  'allocation': /(\d+) allocation\b/g,
  'deck':       /(\d+) deck\b/g,
  'mainnet':    /(\d+) live-mainnet\b/g,
}
```

This is better than one occurrence, but it is still phrasing-bound.

**What can pass**

A stale sentence such as:

```text
the 270-assertion suite
```

or:

```text
400 detector assertions
```

may not match the exact tracked regexes if the tracked phrases remain correct elsewhere. The gate would pass while a reader sees a stale number.

**Evidence**

Insert a hyphenated stale count into SPEC while leaving the tracked phrase correct. The `matchAll` gate does not see it.

**Fix**

Either:

1. Add regexes for known alternate phrasings, including hyphenated forms like `(\d+)-assertion suite`.
2. Or lint SPEC for any numeric claim near the words “assertion”, “detector”, “allocation”, “deck”, “mainnet”, and require explicit allowlisting.

This is low severity because the tracked phrases are the load-bearing ones, but the gate’s comment says it catches “a new sentence in SPEC stating a count.” It does not catch every such sentence.

---

### R5-3. LOW — The 11.13/11.14 level-rewrite arms prove a Core refusal, but `0x1a` is a generic approval failure and the actor set is incomplete

**Exact construct**

Tests 11.13 and 11.14 build a hand-rolled Core `UpdatePluginV1` with signer `alice` or `bank` and expect rejection containing `0x1a`, identified as `NoApprovals`.

**What else could produce `0x1a`**

`NoApprovals` is an approval/authority failure, not a deserialization failure. That is useful. But it can still be produced by more than one missing approval condition, depending on Core version and plugin semantics, including:

- signer is not the plugin authority,
- signer is not an approved delegate for the requested operation,
- collection-level approval is missing,
- plugin update is blocked by another approval rule.

The test therefore proves “Core rejected this non-authority update attempt,” not necessarily “the Attributes plugin authority is the only possible path in all cases.”

**Actors not covered**

The arms cover:

- owner,
- Bank.

They do not cover:

- the MINT program’s collection-update-authority PDA,
- the SEAL PDA itself,
- a future SEAL instruction,
- a future MINT instruction,
- Core upgrade authority behavior.

Some of these are impossible without program upgrade, and accepted limit 13 covers upgrade authority risk. But the suite does not prove that the collection update authority cannot rewrite the level if it could sign via CPI after a program change.

**Evidence**

The current tests cannot invoke a PDA signer top-level, so they cannot directly test MINT or SEAL PDAs. The gap is structural. If Core ever permits collection update authority to override plugin authority, these two arms would not detect it.

**Fix**

At minimum, document that 11.13/11.14 cover only top-level non-authority keypairs. If feasible, add a CPI-based test through a dummy program or through MINT/SEAL if any future instruction gains attribute-writing capability. Until then, do not describe these arms as proving full level immutability; they prove two important non-authority refusals.

---

### R5-4. The corrected `detectors.mjs` comment about foreign nested assets is accurate

The corrected comment says `bank/cosign.mjs` fails closed on foreign nested Core assets, but continuous detection is missing.

I checked `scanPda` in `bank/cosign.mjs`:

- It queries `getTokenAccountsByOwner` for both token programs.
- It throws on accounts shorter than 165 bytes.
- It classifies non-165-byte Token-2022 accounts as undeclarable.
- It queries DAS `getAssetsByOwner` for the vault PDA.
- It uses `judgeDasEnvelope`, refusing on DAS errors.
- It pushes every non-burnt asset regardless of collection.
- It refuses a full page of 1,000 items.

So the corrected comment is true: redemption fails closed on foreign nested assets, but the alarm does not continuously detect them.

---

## R6 — Under-claim direction

### R6-1. MEDIUM — `bank/distribute.mjs` still contains a large stale header claiming the level is off-chain and the commitment is not built

**Exact construct**

The file now contains the new block:

```js
/** ═══ THE LEVEL COMES OFF THE CHAIN NOW. `levels.json` IS GONE. ═══
```

But earlier in the same file, the header still says:

```js
 * ⚠️ THE LEVEL LIVES OFF-CHAIN. Gary, 2026-08-22: "we can keep this offchain if
 * we want as we will gamify it with $CBOB to alter emissions." So there is no
 * program change, no Core attribute and no on-chain VRF on the critical path —
 * this job reads a level, it never assigns one, and the odds are deliberately NOT
 * in this file.
```

and later:

```js
 * The cheap fix is not on-chain storage, it is a COMMITMENT ...
 * **This is not built. It is an open item for Gary, and until it exists
 * "cannot be appealed" is a promise rather than a proof.**
```

These statements are now false or stale:

- There is a program change.
- There is a Core attribute.
- The level is written on-chain at mint.
- A commitment scheme, the deck root, is built, even if its reveal procedure has gaps.

**Why this matters**

This is the under-claim defect class: the system is now stronger than the file says, but a stale under-claim can cause someone to build a duplicate control, ignore the real control, or misunderstand the money path during an incident.

**Evidence**

`grep -n "THE LEVEL LIVES OFF-CHAIN" bank/distribute.mjs` still succeeds.

**Fix**

Rewrite the header to match the current design:

- level is on-chain,
- written once by `mint_vault`,
- verified against a committed deck root,
- read by `fetchAsset`,
- reveal/verification limitations stated accurately.

---

## R7 — Counts and arithmetic

### R7-1. Floors in `scripts/run-tests.sh` match the prompt, except the deck internal floor issue

From `scripts/run-tests.sh`:

```bash
DECK_FLOOR=17
DET_FLOOR=439
ALLOC_FLOOR=103
MAINNET_FLOOR=19
MIN_ASSERTIONS=316
```

The prompt’s numbers:

- 316 on-chain assertions,
- 439 detector assertions,
- 103 allocation assertions,
- 19 live-mainnet assertions,

match the runner. The deck floor is 17 in the runner, but `bank/deck.mjs` internally says 16; see R5-1.

### R7-2. Schedule arithmetic is correct

Charter 240 census:

```text
108*2 + 60*3 + 36*4 + 24*5 + 12*6
= 216 + 180 + 144 + 120 + 72
= 732
```

Full 2,100 census:

```text
945*2 + 525*3 + 315*4 + 210*5 + 105*6
= 1890 + 1575 + 1260 + 1050 + 630
= 6405
```

Odds:

```text
108/240 = 45%
60/240 = 25%
36/240 = 15%
24/240 = 10%
12/240 = 5%
```

and same percentages for 945/525/315/210/105 over 2,100.

Per $1,000 at 240:

```text
I: 2000/732  = 2.73
II: 3000/732 = 4.10
III: 4000/732= 5.46
IV: 5000/732 = 6.83
V: 6000/732  = 8.20
```

Per $1,000 at 2,100:

```text
I: 2000/6405  = 0.31
II: 3000/6405 = 0.47
III: 4000/6405= 0.62
IV: 5000/6405 = 0.78
V: 6000/6405  = 0.94
```

Shares at 2,100:

```text
I: 1890/6405 = 29.5%
II: 1575/6405= 24.6%
III:1260/6405= 19.7%
IV:1050/6405 = 16.4%
V: 630/6405  = 9.8%
```

These sum to 100.0% at one decimal place. I did not find a wrong customer-facing arithmetic figure in the schedule itself.

---

## R8 — One-of-N-sites

### R8-1. MEDIUM — Floor equality was applied to detector/allocation/runner, but not to `bank/deck.mjs`

See R5-1. This is the same defect class the floor repairs were meant to end: one site fixed, the new sibling shipped with the old slack.

---

### R8-2. MEDIUM — The alarm’s “watch every config value” discipline was not extended to the new level/deck config fields

**Exact construct**

`bank/detectors.mjs` has a large `WATCH` list and `WATCHED_KEYS`. It includes many `mint.*` fields, including:

```js
['mint.minted_total', S.CRITICAL, 'VAULTS HAVE BEEN MINTED'],
```

It does not include:

- `mint.deck_root`,
- `mint.level_caps`,
- `mint.level_minted`.

**What an accident gains**

These fields are now money parameters:

- `deck_root` is the level commitment.
- `level_caps` bounds how many of each payout tier can exist.
- `level_minted` shows how many of each tier have been minted.

If any of these were wrong at init, changed by a program upgrade, or misread by a future layout change, the alarm’s config-drift/standing-risk machinery would not see them.

**Evidence**

`grep -n "deck_root\|level_caps\|level_minted" bank/detectors.mjs` returns no watched key entries.

**Fix**

Add these to the watched config reader and `WATCH` list:

- `mint.deck_root`, CRITICAL on change from zero to nonzero and on any later change;
- `mint.level_caps`, CRITICAL on drift;
- `mint.level_minted`, HIGH/CRITICAL on unexpected movement, at least as a derivative of minting.

Also add a standing risk if `sum(level_caps) != max_supply` or if `deck_root` remains zero when minting is open.

---

### R8-3. LOW — `bank/selftest.mjs` compares detector and allocation internal floors to the runner, but not the deck internal floor

**Exact construct**

```js
t("selftest.mjs's own FLOOR equals run-tests.sh's DET_FLOOR", selfFloor, det)
t("distribute.mjs's own FLOOR equals run-tests.sh's ALLOC_FLOOR", distFloor, alloc)
```

There is no equivalent:

```js
t("deck.mjs's own FLOOR equals run-tests.sh's DECK_FLOOR", deckInternalFloor, deck)
```

**Fix**

Add it after fixing `deck.mjs` to equality.

---

### R8-4. LOW — `scripts/audit-coverage.sh` target parsing is shape-bound to the current `TARGETS` literal style

**Exact construct**

```bash
targets=$(grep -ohE "^[[:space:]]*\['[^']+'" scripts/audit*.ts ...)
```

This fixes the round-19/20 blindness to `TARGETS` arrays. But if a future audit script changes shape again — for example, builds targets from a variable, uses double quotes, splits the array across lines, or generates paths programmatically — the coverage gate can silently regress.

**Evidence**

A future audit script using:

```ts
const TARGETS = makeTargets()
```

would not be parsed, and the gate could still pass based on stale older rounds.

**Fix**

Add a selftest for `audit-coverage.sh` itself: feed it a synthetic audit script with a known target list and assert it reports exactly those files. This is the same “gate must fail both ways” discipline used elsewhere.

---

## Accepted limits — the four questions

### 1. Is any limit WORSE than stated?

Yes.

#### Limit 19 — discharged as “no longer customer-reachable” is worse than stated

Limit 19 says the unlevelled-vault halt is no longer reachable by ordinary customer action. The bare-burn/DAS-lag path in R3-1 is an ordinary customer action, albeit self-destructive. It can temporarily halt distributions. The discharge should not be treated as complete until distribute verifies on-chain asset liveness independently of DAS.

#### Limit 22 — live distribution is not merely untested; it has specific failure paths

Limit 22 already says no live distribution has run. The worse part is that the current code has:

- no retry/backoff,
- no batching,
- an uncaught `getAccountInfo` failure path,
- no checkpoint for level reads,
- and a DAS-lag bare-burn halt path.

These are not just “scale unknown”; they are concrete failure constructs.

#### Limit 23 — the packet bound is worse than stated

Limit 23 says the attribute budget falls as deck depth rises. At the stated 2,100 census, the legacy budget does not merely fall; it appears to disappear entirely, including for zero caller attributes. See R4-1.

---

### 2. Is anything listed as an accepted limit not actually a limit?

Yes.

#### Accepted limit 1a is stale with respect to Bank-pubkey confinement

Limit 1a says:

> The program allowlist and the Bank-pubkey confinement are OFF-CHAIN. Nothing in any program bounds what else a redemption transaction contains; `open_for_redemption` scans forward only as far as its matching burn.

That is no longer true for the Bank-pubkey confinement.

Current SEAL `open_for_redemption` walks every top-level instruction and refuses `BankKeyOutsidePair` if the Bank key appears outside the open/burn pair. Current MINT `mint_vault` walks every top-level instruction and refuses `BankKeyOutsideMint` if the Bank key appears outside the `bank` slot of a `mint_vault`.

The program allowlist remains off-chain. The fee-payer gap remains. But the Bank-pubkey confinement is on-chain for both redemption and mint.

Limit 1a should be split:

- program allowlist: still accepted off-chain;
- fee payer: still accepted off-chain;
- Bank-pubkey confinement: discharged/on-chain, with suite arms 4.7, 4.10, 9d.1, 9d.4.

---

### 3. Is any DISCHARGED item not actually discharged?

Yes, partially.

#### Discharged 19 is not fully discharged

See R3-1 and limit 19 above. The original `levels.json` DoS is gone, but the replacement halt can still be reached through bare burn plus DAS lag.

#### Discharged 12/17 appears discharged for the measured suite, but not for the production packet shape

The CU measurement itself looks valid for the test shape: it measures landed transactions and compares against the byte wall. However, the production deck-depth packet problem in R4-1 means the measured “widest pad” and transaction shape are not the production shape. The CU conclusion “byte wall binds first” remains true for any transaction that fits, but the more important issue is that the production mint may not fit at all.

#### Discharged 14 appears discharged

Duplicate attribute keys are rejected by `DuplicateAttribute`, and test 11.4 asserts it. I did not find a bypass.

---

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

Risk yes.

#### Limit 22

The code still lacks live-run hardening. If the team commits the production deck and starts minting without a live distribution rehearsal, limit 22 is being quietly treated as accepted.

#### Limit 23

If the team commits a 2,100-card root without measuring the production packet, limit 23 is being quietly treated as accepted. R4-1 says that measurement will likely fail for legacy transactions.

#### Missing limit: deck reveal/verification

There is no open limit stating that the Bank can refuse to reveal the salt and make the deck unverifiable. That should either be fixed or explicitly written as an accepted buyer-facing limit. Currently it is neither fixed nor listed.

---

## Other findings

### O-1. MEDIUM — `commit_deck` is admin-only, one-shot, and not alarm-watched

**Exact construct**

```rust
pub fn commit_deck(ctx: Context<CommitDeck>, root: [u8; 32]) -> Result<()>
```

`CommitDeck` requires `admin`. It emits `DeckCommitted`, but `bank/detectors.mjs` does not watch `mint.deck_root`.

**What an accident gains**

A wrong root committed by an admin mistake or compromised admin is permanent. The alarm will not flag the drift because the key is not watched.

**Fix**

Add `mint.deck_root` to the alarm watch list. Treat first commitment as a CRITICAL event and any later change as impossible-but-alarmable.

---

### O-2. LOW — `VaultMinted` event does not include the level

**Exact construct**

```rust
emit!(VaultMinted {
    asset: ctx.accounts.asset.key(),
    owner: ctx.accounts.owner.key(),
    round_id: c.round_id,
    price_lamports: c.price_lamports,
});
```

The level is written to the asset but not emitted.

**Consequence**

Off-chain monitors must fetch the asset to learn the level. This is not a vulnerability, but it makes independent verification and alerting harder.

**Fix**

Add `level: u8` or `level_name: String` to `VaultMinted`.

---

### O-3. LOW — `mint_vault` comment justifies `MAX_ATTRS` using `mark_opened`, which no longer exists

**Exact construct**

The comment says:

```rust
// MINT must never write more attributes than SEAL's `mark_opened` can parse and rewrite
```

But accepted limit 13 says `mark_opened` does not exist in v5.

**Consequence**

The bound may still be sensible, but the justification is stale. Stale justifications are how wrong constraints survive or get deleted accidentally.

**Fix**

Rewrite the justification in terms of the actual constraint: Core/Attributes plugin limits, packet limits, and reader limits.

---

### O-4. LOW — `distribute.mjs` does not verify that the fetched asset belongs to the expected collection

**Exact construct**

`distribute.mjs` gets vault IDs from DAS `getAssetsByGroup`, then calls `fetchAsset` and reads attributes. It does not independently verify that the fetched on-chain asset’s collection matches the configured collection.

**Consequence**

If DAS returns a wrong or foreign asset ID, and that asset happens to have a valid `level` attribute and a funded ATA, the distributor could pay it. This requires DAS to be wrong about collection membership, so it is low likelihood.

**Fix**

When reading the asset, also verify the collection field against the configured collection, or verify the asset-signer PDA derivation and ownership in a way that does not rely only on DAS.

---

### O-5. LOW — Solana blockhash availability for later verification is not addressed

The seed uses `blockhash(slot X)`. If slot X is old, ordinary RPC nodes may not serve that blockhash indefinitely. Verifiers may need an archive node or a published blockhash artifact.

**Fix**

When revealing the salt, also publish the exact blockhash used, signed by the Bank, and have the verifier check both the blockhash and the seed. Do not assume every verifier can retrieve arbitrary historical blockhashes.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that AI audit structurally cannot?

Nineteen/ twenty rounds of AI audit can read code, generate tests, and disprove claims by local execution. They cannot provide the following, and these are the remaining load-bearing gaps.

### 1. Run a full-scale production rehearsal against real RPC/DAS, not a local validator

Before committing the 2,100 deck root:

- build the exact 2,100-card deck;
- measure the exact mint transaction size with the exact production client;
- if legacy fails, build and measure versioned transactions with address lookup tables;
- mint a representative number of vaults, or all 2,100 on a shadow cluster;
- run `distribute.mjs` against real RPC and real DAS with that population;
- record:
  - RPC request count,
  - wall-clock time,
  - rate-limit behavior,
  - partial-failure behavior,
  - DAS lag behavior,
  - cost.

AI rounds cannot access the production RPC environment or certify operational behavior. This rehearsal must produce artifacts that later rounds can inspect.

### 2. Create a deck commitment ceremony with external timestamps

The deck fairness property currently depends on publication and reveal. That is a ceremony, not code.

Before minting:

1. Publish `sha256(bank_salt)`, slot X, census, and derivation rules in at least two externally timestamped places the Bank cannot later edit.
2. Ensure slot X is future at publication.
3. Commit the deck root on-chain only after the publication artifact exists.
4. Reveal the salt and blockhash promptly.
5. Run a public verifier that checks every minted vault against the revealed deck.

AI audit cannot make a timestamped external publication trustworthy. Humans and third-party channels must carry that.

### 3. Decide and document the fairness limit: the Bank can sequence users to deck indices

If the design keeps Bank co-signature and Bank-generated salt, the Bank can allocate favorable indices to chosen users. Either:

- accept that as a buyer-facing limit, or
- change the randomness/assignment design.

AI rounds can identify the limit, but only the owner can decide whether the product’s “no way to game it” claim must be weakened or the design must be changed.

### 4. Establish key custody and incident response, not just code gates

The largest remaining trusted hops are human/key custody:

- Bank key,
- distributor key,
- swap operator key,
- program upgrade authorities.

AI audit cannot inspect:

- hardware custody,
- operator access control,
- backup security,
- social recovery,
- who can physically sign,
- whether the Bank key holder can be compelled or phished.

Before mainnet money, the project needs a written incident plan:

- who can pause,
- who can rotate,
- how a compromised key is contained,
- how a wrong deck root is handled,
- how a halted distribution is communicated,
- how customer funds are reconciled after an incident.

### 5. Make the production packet budget a launch artifact, not an audit argument

The root is one-shot. The transaction-size problem in R4-1 is not something another AI round can resolve by reading. It requires a measured artifact:

- “At deck size N, proof depth D, transaction format F, attribute set A, the serialized mint transaction is B bytes.”

If B > 1232, do not commit the root. If versioned transactions are required, ship and measure them before the root commitment.

---

End of findings.