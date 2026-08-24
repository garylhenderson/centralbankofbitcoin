# Independent Security Audit — Round 20

I'll go through the targets in order, then the accepted limits, then anything else. I'll try to say what evidence would exist if I'm right so the claims are checkable.

---

## R1. `bank/deck.mjs` — the committed deck

### FINDING R1-1 (HIGH): The Bank can grind the SALT after seeing the blockhash — the commitment is not binding.

**Construct.** The seed is `sha256(bank_salt ‖ blockhash(slot X))`. The stated protocol: publish `sha256(bank_salt)` and slot `X` before minting opens; reveal `bank_salt` after.

**What the commitment actually binds.** `sha256(bank_salt)` binds a *specific* 32-byte salt. The Bank must reveal exactly that preimage or the deal is not verifiable. So the salt *cannot* be re-chosen after the blockhash is known. **This part is sound.**

**What it does NOT bind:** the *choice* of that pre-image. Before publishing `H(salt)`, the Bank has unlimited freedom. If the Bank publishes `H(salt)` at slot `Y` and names slot `X > Y`, blockhash(X) is not yet known — so no grinding on `X` is possible. Good.

**However, look at `seedFrom`:**
```
export const seedFrom = (bankSalt, blockhash) => sha(Buffer.from(bankSalt), Buffer.from(blockhash))
```
`bankSalt` is a *string* passed to `Buffer.from(bankSalt)` (default utf-8). Two problems flow from this:

1. **Nothing in this file bounds the salt length or format.** A 32-byte salt was implied by "publish `sha256(bank_salt)`" but never enforced anywhere. A Bank that publishes `H("hello")` and later reveals `bankSalt="hello world"` cannot be distinguished from one that revealed correctly, because there is no shape-check on the salt.
2. **More importantly: does the on-chain commitment to `slot X` exist?** I searched `programs/cbob-vault-mint/src/lib.rs` for any storage of `bank_salt_hash` or `commit_slot`. There is `deck_root: [u8;32]` and `commit_deck(root)` — that's it. **The seed inputs (`H(bank_salt)`, `slot X`) are NEVER committed on chain.** Only the *derived Merkle root* is.

**This is the actual defect.** The security argument in the header ("The Bank publishes `sha256(bank_salt)` and names slot X BEFORE minting opens") describes a protocol that has no on-chain enforcement. The Bank publishes… somewhere off-chain? A tweet? A file? Whoever controls that channel controls the audit.

**Attack:**
- Bank generates 10,000 candidate salts.
- For each, computes deck against blockhash of slot X (already known if Bank waited).
- Picks the deck that puts favored addresses at Level V indices.
- Publishes `H(salt)` for that salt and "names slot X" retroactively.
- Since nothing on chain records when `H(salt)` was published or which slot was named, this claim is unfalsifiable.

**Evidence if I'm right:** Search `programs/cbob-vault-mint/src/lib.rs`:
```
$ grep -E "bank_salt|commit_slot|salt_hash|reveal" programs/cbob-vault-mint/src/lib.rs
```
Nothing. Only `deck_root` is stored. `commit_deck` takes just `root: [u8;32]`.

**Fix.** Store `bank_salt_hash: [u8;32]` and `commit_slot: u64` in `MintConfig`, populated in `commit_deck` alongside `root`, at a slot **before** the commit slot. Then add a permissionless `verify_deck(bank_salt: [u8;32])` that:
- fetches the SlotHashes sysvar and confirms `commit_slot` blockhash
- recomputes `H(bank_salt ‖ blockhash(commit_slot))` and re-derives root
- refuses if it disagrees
- emits a verified event

Otherwise this is a claim, not a proof.

### FINDING R1-2 (HIGH): Bank can refuse to reveal the salt; there is no on-chain penalty or recourse.

**Construct.** Header says: "At close the Bank reveals the salt and anyone recomputes the entire shuffle."

**What happens if the Bank never reveals.** Every vault has a level. Every vault has a Merkle proof against `deck_root`. But nobody can check whether `deck_root` was honestly derived from `H(H(salt) ‖ blockhash(X))`. So the entire fairness argument reduces to trusting the Bank not to have gamed the seed.

**Evidence if I'm right:** No instruction in `cbob-vault-mint` reveals or verifies salt. No time-locked penalty. No slashing. No permissionless verify. Just the root sitting there forever.

**Fix.** Combined with R1-1: require the Bank to publish the salt within some window; if not, mark the deck disputed on chain (via a permissionless `mark_deck_unverified` after a deadline).

Or accept this as a limit and write it down honestly: "The deck's fairness rests on the Bank publishing salt off-chain. This is a limit."

### FINDING R1-3 (MEDIUM): The `stream` PRNG discards partial hash bytes — reproducibility is fine, but note the comment lies about "no partial hash".

**Construct.**
```js
function* stream(seed) {
  for (let ctr = 0; ; ctr++) {
    const h = sha(seed, u32le(ctr))
    for (let i = 0; i + 4 <= h.length; i += 4) yield h.readUInt32LE(i)
  }
}
```
Comment: "it never consumes a partial hash: a shuffle that depends on how many bytes an earlier draw happened to use is a shuffle nobody can reproduce from the seed alone."

**Reality.** SHA-256 gives 32 bytes; `i+4<=32` yields 8 full u32s per counter, no partial hash consumed. The reproducibility argument holds. But nothing in the code checks it; if someone later "optimizes" this to yield bytes/nibbles, the comment's promise silently breaks. Minor.

### FINDING R1-4 (LOW): Rejection-sampling correctness noted; bias math is right.

`limit = Math.floor(0x100000000 / n) * n` and `while (r >= limit) redraw` — correct. Just verifying: at n=5 (worst case for Level V), limit = 4294967295 (floor(2^32/5)*5 = 858993459 * 5 = 4294967295). Modulo bias eliminated. Good.

### FINDING R1-5 (HIGH): Merkle construction — sorted-pair verification enables a specific forgery when combined with the odd-node promotion rule.

**Construct.** JS:
```js
export const node = (a, b) => Buffer.compare(a, b) <= 0 ? sha(NODE_TAG, a, b) : sha(NODE_TAG, b, a)
```

Rust:
```rust
node = if node <= *sib {
    hashv(&[&[DECK_NODE_TAG], &node, sib]).to_bytes()
} else {
    hashv(&[&[DECK_NODE_TAG], sib, &node]).to_bytes()
};
```

Both sort. Fine, they agree.

**But sorted-pair with promotion has a known issue.** Consider:
- Layer 0: `[L0, L1, L2]` (odd, so L2 gets promoted)
- Layer 1: `[node(L0,L1), L2]`
- Root: `node(node(L0,L1), L2)`

Now consider a claimed leaf `X` at index 3 (which doesn't exist — only 3 leaves at indices 0,1,2). The verifier is given `X` and proof `[L2, node(L0,L1)]` (or similar). It computes:
1. `n = leaf(3, level)` — some hash
2. `n = node(n, L2)` — sorted
3. `n = node(n, node(L0,L1))` — sorted

Does this equal the root? Only if `n` at step 2 happens to equal `node(node(L0,L1), L2)` after sorting. Second-preimage-hard, so no.

**However**, consider the more subtle attack: because the on-chain verify has NO index check (`deck_root_from` in the Rust doesn't take `index`; it just reduces from a leaf hash):

```rust
fn deck_root_from(mut node: [u8; 32], proof: &[[u8; 32]]) -> [u8; 32] {
    for sib in proof.iter() {
        node = if node <= *sib { ... } else { ... };
    }
    node
}
```

And the caller only checks:
```rust
require!(deck_root_from(deck_leaf(deck_index, level), &deck_proof) == cfg.deck_root, ...);
```

The leaf DOES encode `index` and `level`. So the leaf is unique per (index, level). Good.

**BUT**: with sorted pairs and no direction bits, a proof of length `k` proves that *some* leaf-shape node reaches the root by hashing with `k` sibling nodes in sorted order. It doesn't prove that leaf is at any particular *position* in the tree — position is implicit in the leaf preimage.

Since `deck_index = minted_total` is program-controlled and the leaf includes it, this should be safe. But if `MAX_DECK_PROOF = 24` allows proof lengths that don't match the tree depth, could you validate against a shorter path?

Test: With census=2100 (depth 12), a legit proof is 12 hashes. Could a *shorter* proof (say length 3) validate for some leaf? It would need `leaf ⊕ 3 hashes = root`. For a random attacker with control of the leaf (index,level) — no, they can't choose either. For the Bank grinding? They'd need to find a preimage of the root as a chain of 3 sibling hashes with a valid (index,level) leaf. Second-preimage-hard.

**Verdict:** The Merkle construction itself looks OK. The domain separation (`0x00` / `0x01`) is correct — leaves are 34 bytes (1 tag + 4 index + 1 level = 6, but hashed with `hashv(&[&[tag], &index, &level])` = 6 input bytes into SHA), and internal nodes are 65 bytes (1 tag + 32 + 32). No cross-domain collision.

Wait — the JS uses `sha(LEAF_TAG, u32le(index), Buffer.from([level]))` which concatenates: `[0x00, i0, i1, i2, i3, level]` = 6 bytes hashed. The Rust uses `hashv(&[&[DECK_LEAF_TAG], &index.to_le_bytes(), &[level]])` = also 6 bytes. Same. ✓

Internal: JS `sha(NODE_TAG, a, b)` = 65 bytes. Rust `hashv(&[&[DECK_NODE_TAG], &node, sib])` = 65 bytes. Same. ✓

**One subtle concern:** what if `deck_proof.len() == 0`? Then `deck_root_from(leaf, &[])` returns `leaf` unchanged. So a "proof" for index 0 in a 1-card deck is valid (empty proof, root = leaf). Both implementations agree on this. Good.

**But:** if the deck is committed with root = `leaf(0, level_X)`, then only index 0 can mint. When `minted_total = 1`, `deck_root_from(leaf(1, anything), &[])` = `leaf(1, anything)` ≠ `root`. Refused. Good.

Actually, this raises a real issue: **the empty-proof case is legal by the code, but MAX_DECK_PROOF has no lower bound.** If someone commits a 1-card deck by mistake, the second mint always fails. That's the intended behavior (level cap or supply cap reached), but see R2 below on cap-vs-deck starvation.

### FINDING R1-6 (MEDIUM): The Rust `deck_root_from` doesn't verify proof length matches expected depth.

**Construct.** For a deck of N cards, depth is `ceil(log2(N))`. A proof for index i should have exactly that length (or one less if the leaf is on the promoted path). Neither Rust nor JS checks this.

**Attack.** For a 2100-card deck (depth 12), someone submits a proof of length 5 for a level they weren't dealt. If the honest leaf hash happens to match some depth-5 chain to the root… second-preimage-hard, so this is not practically exploitable.

**But** it's belt-and-braces missing. `MAX_DECK_PROOF=24` bounds compute, but doesn't bound to depth of committed deck.

**Fix.** Store `deck_len: u32` alongside `deck_root`. Then require `deck_proof.len() == ceil_log2(deck_len)` (or that minus 1 for promoted paths, which the Rust could compute).

Actually this is subtle because the promotion rule allows some indices to have shorter proofs. Fine — but a MAXIMUM check based on `deck_len` would be a real bound. Right now the deck size is not stored on chain at all, which means:

### FINDING R1-7 (HIGH): The deck length is not committed on chain.

**Construct.** `commit_deck(root)` takes only the root. No length. No census. Nothing about what the deck contains.

**Consequence.** The Bank could later claim any deck length, any census, any per-level count. As long as it produces valid Merkle proofs and doesn't overrun `level_caps`, nobody knows what the *actual* off-chain deck looks like until the salt is revealed (which is not enforced — R1-1, R1-2).

**Attack scenario.** The Bank commits root R for a deck it privately builds with census [200, 40, 0, 0, 0] instead of [108, 60, 36, 24, 12]. Level_caps are set to allow the honest census. Mints proceed. Only Level I and II ever get dealt. Nobody notices until the Bank refuses to reveal salt.

The `level_caps` gate refuses to *overrun* a level, but doesn't require the deck to *contain* that level's cards. So a Bank that mints only Level I/II vaults for all 240 mints has satisfied every on-chain check, and its refusal to reveal salt means nobody can prove the deck didn't have all those V cards it just chose not to use.

**Evidence if I'm right.** Grep the Rust: `deck_root` is stored, `level_caps` are the only quantities. No `deck_len`, no `deck_census`.

**Fix.** Store `deck_len: u32` and `deck_census: [u32;5]` in `MintConfig`, populated in `commit_deck`, and require `deck_census.sum() == deck_len` and `deck_census[k] == level_caps[k]`. Also add a permissionless post-mint verification that all `deck_len` cards were minted (or that the round closed with unminted cards, which needs a separate accounting).

### FINDING R1-8 (MEDIUM): JS/Rust byte-for-byte agreement rests on `u32.to_le_bytes()` vs `u32le(n)`.

**JS:** `writeUInt32LE` — 4 bytes little-endian.
**Rust:** `index.to_le_bytes()` on `u32` — 4 bytes little-endian.

Agree. Level is `u8` in both. Good.

**BUT:** `deck_index` in Rust is `u32::try_from(cfg.minted_total)`. `minted_total` is `u64`. So decks larger than `u32::MAX` = 4.29B won't be reachable, but well within bounds. Fine.

If they disagreed by one byte, the on-chain test suite would catch it. So this is not an unaudited risk *per se*, but the header claim "They are proven by the on-chain suite building a proof HERE and having the PROGRAM verify it" is only true if the test suite ACTUALLY builds and verifies proofs for multiple depths. Looking at `tests/3prog.test.ts`:

```
const DECK_CENSUS:[number,number,number,number,number]=[50,20,10,5,5]
```

Total = 90. Depth = 7. **The suite tests depth 7 only.** It never tests depth 11 (2100), depth 12, or edge cases like depth 24 (MAX_DECK_PROOF). The deck.mjs `--selftest` does verify a 2100 deck at 4 indices, but that's JS-only, not JS↔Rust cross-verification.

**So the header claim overstates.** JS↔Rust agreement is proven at ONE depth (7), against ONE deck census. If either implementation had a depth-dependent bug (say, promotion rule difference at odd layer widths), the suite would not catch it.

**Fix.** Run the on-chain suite with 2-3 more deck sizes: [1,0,0,0,0] (depth 0), [2,1,1,1,1] (depth 3, odd internal layer), [945,525,315,210,105] (depth 12). The deck.mjs selftest covers these off-chain; the on-chain suite covers exactly one.

---

## R2. The level on chain — `programs/cbob-vault-mint/src/lib.rs`

### FINDING R2-1 (HIGH): Level cap exhaustion vs. deck deal creates a permanent minting halt.

**Construct.** The mint flow:
```rust
require!(cfg.level_minted[li] < cfg.level_caps[li], MintError::LevelCapReached);
require!(deck_root_from(deck_leaf(deck_index, level), &deck_proof) == cfg.deck_root, MintError::BadDeckProof);
```

`level_caps` and the deck are TWO INDEPENDENT sources of the census.

**The prompt asks:** "What happens when one level's cap is exhausted but the deck still deals that card at the next index — does minting halt for everybody?"

**Answer.** YES. If `deck_index` = N and `DECK[N] = 5` (Level V) but `level_minted[4] = level_caps[4]`, then `LevelCapReached` fires. `minted_total` does not advance. The next mint attempt uses the same `deck_index`. Same failure. **Minting is halted permanently until the level cap is raised (which requires… wait, is there any instruction to change `level_caps`?)**

Searching `programs/cbob-vault-mint/src/lib.rs`:
- `initialize` sets `level_caps`.
- `update_wiring` does NOT touch `level_caps`.
- Nothing else touches them.

**`level_caps` is IMMUTABLE after initialize.** So a mismatch between the committed deck's census and `level_caps` is a permanent brick.

**Attack / accident.** Bank commits deck with census [50, 20, 10, 5, 5] but initializes with caps [50, 20, 10, 5, 4]. As soon as `deck_index` lands on the 5th Level V (probabilistically after ~half the mints), all future mints revert. `LevelCapReached` for every mint from that index forward.

This is EXACTLY the same defect class as MAX_RESERVE_MINTS (round 13) — a Borsh bound where a MEASURED bound was needed. The prompt itself warns about this in R4.

**Is it prevented?** `initialize` requires `cap_total <= max_supply`. It does NOT require caps to match the deck (deck isn't committed at initialize time).

**Fix.** Either:
(a) Store deck_census in config at `commit_deck` time, require caps == deck_census.
(b) Make level_caps derivable from deck_census (no separate storage).
(c) Order the commits: force `commit_deck` to be called before `set_round` opens the first round, and check consistency.

Currently: `initialize` → `commit_deck` → `set_round` is the intended order but nothing enforces it.

**Evidence if I'm right.** In the local suite, `LEVEL_CAPS=[50,20,10,5,5]` and `DECK_CENSUS=[50,20,10,5,5]`. They match by convention. Change one to [50,20,10,5,4] and try to mint 5 Level V vaults — the fifth reverts with LevelCapReached even though the deck legitimately dealt it.

### FINDING R2-2 (MEDIUM): Duplicate attribute check is O(n²) but bounded; case-sensitivity may confuse callers.

**Construct.**
```rust
require!(a.key != ATTR_REDEMPTION, MintError::ReservedAttribute);
require!(a.key != ATTR_LEVEL, MintError::ReservedAttribute);
require!(!attributes[..i].iter().any(|b| b.key == a.key), MintError::DuplicateAttribute);
```

Case-sensitive string comparison. So a caller could pass `"Level"` (capital L) and it would be accepted. Does Core's attribute plugin do case-insensitive lookups? If so, then a caller-supplied `"Level"` and the program-appended `"level"` might both be present but the deserializer treats them as duplicates.

**Evidence if I'm right.** Test: mint with `attributes=[{key:"Level", value:"V"}]`. If it succeeds, then `attributeList` contains both `"Level":"V"` and `"level":"III"` (whatever the deck dealt). Then `fetchAsset(..).attributes.attributeList.filter(a => a.key === 'level')` returns 1 (case-sensitive JS), and `levelFromAttributes` returns the real dealt level. Good.

But — what does DAS return? DAS may or may not preserve case. If DAS normalizes to lowercase, then a caller-planted `"Level"` becomes indistinguishable from the program's `"level"`, and `levelFromAttributes` (which requires exactly one) returns `null`, halting distribution for that vault.

This is speculation — I'd want to test on DAS. But since `distribute.mjs` uses `fetchAsset` (not DAS), and `fetchAsset` reads the account bytes verbatim, this shouldn't matter for payouts.

However: the alarm and other tools use DAS. If DAS normalizes case, then a caller-planted `"Level":"V"` might show up as a "second level attribute" in a DAS view even though on-chain data is fine.

**Impact:** low. `distribute.mjs` reads via `fetchAsset`, not DAS. But `bank/alarm.mjs`'s standing-risks and drift detection might see a phantom.

**Fix.** Reject any attribute key that lowercases to `"level"` or `"redemption"`. Cheap:
```rust
require!(!a.key.eq_ignore_ascii_case(ATTR_LEVEL), MintError::ReservedAttribute);
```

### FINDING R2-3 (HIGH): The `attributes.len() + 1` bookkeeping trusts a `< MAX_ATTRS` gate that doesn't account for the packet bound.

**Construct.**
```rust
require!(attributes.len() < MAX_ATTRS, MintError::TooManyAttributes);
// ...
data.extend_from_slice(&((attributes.len() + 1) as u32).to_le_bytes());
```

`MAX_ATTRS = 8`. So caller supplies up to 7, program appends 1 more = 8 total. Fits in the Borsh bound.

**But R4 (see below) says the real bound is a PACKET bound, and at depth 11 it's much smaller than 7.** So this check is meaningless at production scale.

**More importantly:** what if `attributes.len() + 1` overflows? `attributes.len()` is `usize` which is 64-bit on the wasm target, but here we're checking against MAX_ATTRS=8, so no overflow risk. Fine.

**What about the encoding?** The attributes plugin data is written as:
```
count: u32 LE
for each attr: key_len: u32, key: bytes, value_len: u32, value: bytes
```
Then trailing bytes for other plugins. All keys and values are ≤ MAX_ATTR_STR = 128 bytes. So max attribute plugin size = 4 + 8*(4+128+4+128) = 4 + 8*264 = 2116 bytes. Fine for CreateV2's account-data.

But this data is CPI'd through to Core, so Core has to parse it. If Core's own attribute limit is lower, we'd fail there. Presumably tested at depth 7 with 7 attrs — works.

Not a defect per se, just worth noting that `MAX_ATTRS` and Core's actual capability might diverge and only one is enforced.

### FINDING R2-4 (CRITICAL): The check on `bank` position doesn't cover an attacker who names the bank in an OWNER position.

**Construct.**
```rust
if is_mint {
    for (n, a) in ix.accounts.iter().enumerate() {
        require!(a.pubkey != bank || n == MINT_IX_BANK_IDX,
            MintError::BankKeyOutsideMint);
    }
}
```

`MINT_IX_BANK_IDX = 4`. `bank` at position 4 is exempt.

But wait — what if the transaction is:
```
mint_vault(bank at position 4, owner at position 3 = ATTACKER, payer at position 5 = ATTACKER)
```
Then `MINT_IX_BANK_IDX = 4` is fine. But the `owner` slot (index 3) can be the attacker signing. That's normal for a mint.

The problem the confinement solves is: Bank's key is used to authorize a *foreign* instruction. So the confinement is: for each top-level instruction, if it's `mint_vault`, then bank may only be at position 4; if it's anything else, bank must be absent.

Let me trace this more carefully. Suppose transaction has:
1. `mint_vault` (bank at position 4)
2. `SystemProgram.transfer(from=bank, to=attacker)` — bank at position 0

The scan iterates both instructions. For (1), `is_mint=true`, bank at position 4 ≤ MINT_IX_BANK_IDX, OK. For (2), `is_mint=false`, so the `else` branch fires: `require!(!ix.accounts.iter().any(|a| a.pubkey == bank), ...)`. Bank present → refused. ✓

**But**: what if there are TWO `mint_vault` instructions in the same transaction, one legitimate and one where bank is at position 3 (the owner slot)?
1. `mint_vault(bank at 4, owner=alice)` — normal, bank pays 0 SOL because `pay = price_lamports`... actually payer is at slot 5, not bank.
2. `mint_vault(bank at 3, bank at 4, owner=bank, payer=attacker)` — bank as owner

In (2), scan for that instruction: `is_mint=true`, iterate accounts. Position 3 has `pubkey == bank`. `MINT_IX_BANK_IDX = 4`. `n == 4`? No, `n=3`. So `require!(a.pubkey != bank || n == MINT_IX_BANK_IDX)` fires as `require!(false || false)` = `require!(false)` = refused. ✓

**What about the fee payer?** Not in account list, invisible to the scan. Bank can be fee payer of a mint_vault-only transaction, and would pay whatever the price is *plus* the fee. Actually price is paid by `payer` (slot 5), not by fee-payer. But fee-payer pays *the transaction fee*. Bank as fee payer of a mint drains ~5000 lamports plus priority fee. Confirmed limit 16 in ACCEPTED LIMITS.

**Wait, one more attack.** Consider:
1. `mint_vault(bank at 4, owner=BANK, payer=alice)` — bank as owner (position 3)

`is_mint=true`. Iterate accounts. At position 3, `bank`. `n=3`, `MINT_IX_BANK_IDX=4`. `n == 4`? No. Refused. ✓

**And:**
1. `mint_vault(bank at 4, owner=alice, payer=BANK)` — bank as payer

Position 5 = bank. `n=5 ≠ 4`. Refused with `BankKeyOutsideMint`. ✓ (This is the round-18 fix at work.)

OK the confinement seems tight in the mint case. What about SEAL's?

Actually wait — I was tracing MINT correctly. Let me check the `else` branch again:
```rust
} else {
    require!(
        !ix.accounts.iter().any(|a| a.pubkey == bank),
        MintError::BankKeyOutsideMint
    );
}
```

This means for a NON-mint_vault instruction, bank cannot appear at any position. But what about `open_for_redemption` or `burn_vault`? They *do* name the bank. If the transaction bundles `[open_for_redemption, mint_vault]` for the same asset (impossible since mint_vault takes asset as init), we'd refuse. But could someone bundle:

1. `mint_vault(bank at 4, ...)` — legitimate mint
2. `open_for_redemption(bank at position ?)` — bank named here

For (2), `is_mint=false`, so `else` branch: bank cannot appear. Refused.

But wait — in a legitimate redemption bundled with a mint (bizarre but…), you'd need SEAL's `open_for_redemption` and BURN's `burn_vault`. Both name bank. The MINT program's introspection would refuse the redemption's bank presence.

Is that the intended behavior? Probably — you can't do a mint+redemption in one transaction. The redemption confinement in SEAL already handles the case of two redemptions in one transaction (see SEAL code allowing `is_open || is_burn`). Similarly MINT should tolerate SEAL/BURN instructions.

Actually looking at MINT's confinement code more carefully:
```rust
let is_mint = ix.program_id == crate::ID && ...
```

It only exempts MINT's own mint_vault. It refuses ANY other instruction that names bank, including SEAL's open_for_redemption and BURN's burn_vault.

**So a transaction that combines mint + open_for_redemption for two different vaults would be refused by MINT's introspection, even though it's benign.**

Is this an actual attack surface? Probably not — mints and redemptions are separate customer flows. But it's a minor coupling.

**More concerning:** if MINT and SEAL were both scanning the same transaction:
- SEAL exempts SEAL's open and BURN's burn.
- MINT exempts MINT's mint_vault only.

So if you did:
1. `mint_vault (bank at 4)`
2. `open_for_redemption (bank at ?)` — bundled

SEAL's scan (in ix 2): sees ix 1 (mint_vault). `is_open` = false (wrong program), `is_burn` = false (wrong program). So the else branch: bank cannot appear in ix 1. But ix 1 is a mint_vault which has bank in it. **SEAL would refuse this bundle**, even though ix 1's mint_vault is legitimate.

Is this a bug? Depends on whether such bundles are supposed to be legal. I don't think anyone bundles mints with redemptions, so probably not exploitable. But **the confinements are not composable**: SEAL doesn't know about MINT's legitimate use of bank, and vice versa.

Nothing shows this is broken today. Filing as informational.

### FINDING R2-5 (LOW): The `seen_self` check in MINT's confinement mimics SEAL's, but is it necessary?

`load_instruction_at_checked` returns Err for indices past the actual count. So the `while let Ok` loop stops naturally. The concern is whether it stops BEFORE reaching `current`. It shouldn't, since `current` is a valid instruction index (this instruction is executing). But defensive coding is fine — `require!(seen_self, ...)` fails closed if for some reason the sysvar-reading fails between index 0 and `current`. Correct.

---

## R3. The level at payout — `bank/distribute.mjs`

### FINDING R3-1 (CRITICAL): No paging, no rate limiting, no partial-failure handling for 2,100 `fetchAsset` calls.

**Construct.**
```js
for (const v of vaults) {
  const pda = ...
  try {
    const asset = await fetchAsset(umi, umiPk(v))
    // ...
  } catch (e) {
    unreadableLevels.push([v, `could not read the asset: ${...}`])
  }
  const info = await conn.getAccountInfo(a, 'confirmed')
  // ...
}
```

Sequential. No batching. No retry.

**At 2100 vaults:**
- `fetchAsset` uses `getAccountInfo` under the hood. Say ~50-100ms per call round-trip with a good RPC.
- 2100 * 100ms = 210 seconds = 3.5 minutes. Plus another 2100 for the ATA reads.
- **Total: 7-14 minutes on a good day. Longer on a bad one.**

**Rate limits.** Helius free tier: 10 credits/sec. Growth tier: 100/sec. `getAccountInfo` = 1 credit each. So 4200 credits, at 100 cps = 42 seconds. At 10 cps = 420 seconds = 7 minutes. Likely OK on paid tier, likely fails on free tier.

**Transient failure on vault 1900:**
```js
} catch (e) {
  unreadableLevels.push([v, `could not read the asset: ${...}`])
}
```
Vault 1900 goes to `unreadableLevels`. Then `allocateWeighted` sees an activated vault (if it happens to have ≥21000 sats and its balance was readable) with no level → **HALTS EVERYTHING**.

**One transient RPC hiccup on any of ~2100 vaults halts the entire distribution.**

The prompt calls this out as accepted limit 22 (OPEN AND BLOCKING). It's real.

**But there's a subtlety: the halt is only triggered if the vault ALSO has ≥21000 sats AND its ATA was readable.** If the ATA read also failed, the vault is in `poisoned` (routed via `readTokenAccount`), balance is `'0'`, so it's below activation and not in `activated`. The refusal in `allocateWeighted` only checks:
```js
const unlevelled = activated.filter(v => !Object.hasOwn(LEVEL_WEIGHTS, levels[v] ?? ''))
```
For a vault to be in `activated`, its balance must be ≥21000. If fetchAsset failed but the ATA is fine and shows ≥21000 sats, then `levels[v]` is undefined, and the refusal fires.

**Fix.**
1. Retry `fetchAsset` per vault with exponential backoff.
2. If persistently unreadable, distinguish "asset was minted before commit_deck" (should never happen) from "RPC error" (retry).
3. Consider caching level per vault in a local file (writes only, never used as source of truth on read — but avoids re-fetching each day).
4. Batch: use `getMultipleAccounts` for asset accounts, then decode in-process (which requires importing Core's decoder — feasible via `mpl-core`'s deserializer).
5. Rate-limit-aware retries.

**Fix (short-term).** Add a retry loop with exponential backoff around each `fetchAsset` call. Cache successful reads in-memory. Don't halt on the first failure — collect all failures, retry, then halt only if some vault is truly unreadable after N attempts.

### FINDING R3-2 (HIGH): `levelFromAttributes` requires exactly one `level`, but does the mint program guarantee only one is written?

**Construct.**
```js
const hits = attributeList.filter(a => a && a.key === 'level')
if (hits.length !== 1) return null
```

The mint program:
```rust
require!(a.key != ATTR_LEVEL, MintError::ReservedAttribute);
// ... then appends exactly one level attribute
```

So on a *freshly minted* vault, exactly one `level` attribute exists. Good.

**Can it be changed later?** The Attributes plugin's authority is the SEAL PDA (per the mint code). No SEAL instruction writes attributes. So no legitimate flow adds a second `level`.

**But** — accepted limit 13 says "whoever controls the SEAL program's upgrade authority could, by shipping a new instruction, rewrite any vault's level." Confirmed. And limit 13 correctly names this.

**Test 11.13 / 11.14** assert that owner and bank cannot rewrite via Core's UpdatePluginV1 → refused with `0x1a` (NoApprovals). 11.15 confirms the value survives.

But: is `0x1a` really "no approvals" specifically? Looking at Metaplex Core error code map, `0x1a` = 26 = `NoApprovals`. Also:
- 0x1 = Deserialization
- 0x2 = Serialization
- 0x1a = NoApprovals

So the test correctly identifies that the refusal is authority-based. If Core's error map changes in an upgrade, the test still validates that the REWRITE fails (via 11.15 reading the level back).

**Actor coverage:** Owner and bank. What about:
- **Payer** (owner is signer, but Core's UpdatePluginV1 authority can be someone else): Test 11.13/11.14 pass alice (owner) or bank as signer/payer. What if we passed a *third* signer as authority? The Attributes plugin's authority is the SEAL PDA. Any non-SEAL-PDA signer is refused by Core. So no other actor can rewrite. ✓
- **Attributes plugin re-DELEGATION**: Does the plugin authority ever transfer? Core allows delegation. In the CreateV2 blob:
```rust
data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend_from_slice(seal_pda.as_ref());
```
The authority is set to `PLUGIN_AUTHORITY_ADDRESS` (variant 3) = a specific pubkey (SEAL PDA). Not `UpdateAuthority` (variant 1) or `Owner` (variant 2). Could someone call UpdatePluginV1 authority-change with SEAL PDA as authority? SEAL PDA can only sign via CPI, and SEAL has no instruction that CPIs to Core's authority-change. So no. ✓

**Verdict:** the level is effectively immutable given (a) SEAL not being upgraded maliciously, (b) SEAL PDA not being reachable by any other route. The tests cover this reasonably well.

### FINDING R3-3 (MEDIUM): `allocateWeighted` arithmetic — verified.

Testing the math manually:
- Census 108/60/36/24/12 → weights sum = 108*2 + 60*3 + 36*4 + 24*5 + 12*6 = 216 + 180 + 144 + 120 + 72 = **732** ✓
- Census 945/525/315/210/105 → 945*2 + 525*3 + 315*4 + 210*5 + 105*6 = 1890 + 1575 + 1260 + 1050 + 630 = **6405** ✓
- Total vaults sum: 108+60+36+24+12 = 240 ✓; 945+525+315+210+105 = 2100 ✓
- Per $1000 at 2100 for Level I: 1000 * 2 / 6405 = 0.312... ≈ **0.31** ✓ (spec agrees)
- Per $1000 at 240 for Level I: 1000 * 2 / 732 = 2.732 ≈ **2.73** ✓
- Shares at 2100: I: 945*2/6405 = 29.5%, II: 525*3/6405 = 24.6%, III: 315*4/6405 = 19.7%, IV: 210*5/6405 = 16.4%, V: 105*6/6405 = 9.8%. Sum: 29.5 + 24.6 + 19.7 + 16.4 + 9.8 = **100.0%** ✓
- Level V receives 3x Level I: weight 6/2 = **3** ✓

**All published figures verify.** Two vaults at the same level: `per[v] = available * weight(v) / den`. If two vaults are at the same level, `weight` is the same for both → same `per[v]`. ✓

**Dust bound.** For `available = den - 1`: `per[v] = (den-1) * weight / den = weight - weight/den`, floored to `weight - 1` for each vault. Sum: 2100 * (weight-1) ... wait that's not quite right. Actually per Level I vault: (den-1)*2/den = 2 - 2/den, floored to 1. Per Level V: (den-1)*6/den = 6 - 6/den, floored to 5. Sum of per-vault: 945*1 + 525*2 + 315*3 + 210*4 + 105*5 = 945 + 1050 + 945 + 840 + 525 = 4305. den-1 = 6404. Dust = 6404 - 4305 = 2099. So at available=6404, dust=2099 = activated_count - 1. ✓

The SPEC says "up to 2,099 sats a settlement — one satoshi short of one per paid vault." Correct.

---

## R4. The packet bound is a product constraint

### FINDING R4-1 (CRITICAL): The 2,100-vault deck's proof depth (11) leaves fewer caller-attribute slots than the product needs, and the deck root is committed ONCE.

**Construct.** Test 11.11 measures maxAttrs at depth 7 (90-card deck): "at most X caller attributes fit the 1,232-byte packet". Let's compute for depth 11 (2100 cards, 12 levels of Merkle proof if odd sibling handled).

Deck proof at depth N is up to N hashes = 32N bytes plus a u32 length prefix = 4 + 32N.
- Depth 7: 4 + 224 = 228 bytes for proof
- Depth 11: 4 + 352 = 356 bytes
- Depth 12: 4 + 384 = 388 bytes (needed if 2100 doesn't fit in 11)

Wait: 2^11 = 2048 < 2100 < 4096 = 2^12. So depth 12 is needed.

Additional cost per extra proof depth: 32 bytes per level. From depth 7 to depth 12: +160 bytes.

If depth 7 fit 7 attributes with headroom, then depth 12 leaves… let's estimate.

Each attribute is `key_len(4) + key + val_len(4) + val`. Say average 20 bytes per attribute (name=8, val=8, plus 8 for length prefixes) → 20 bytes. But the actual attributes in test 11.11 use `k0,k1,...` = 2 bytes each, and `v` = 1 byte. So test attributes are 4+2+4+1 = 11 bytes each.

Test measured 7 attributes fit at depth 7. Adjusting: at depth 12, we lose 160 bytes. 7 * 11 = 77 bytes of attribute space. So at depth 12: 77 - 160 = negative. **Zero caller attributes fit at depth 12.**

Even with LARGER attributes (say 40 bytes each — more realistic for `notice`, `charter`, `governor` strings), we go from 7 attributes at depth 7 → maybe 3-4 attributes at depth 12.

**What does the product need?** From SPEC and MINT code:
- `redemption` — reserved, never set at mint.
- `level` — reserved, appended by program.
- `notice` — the Notice serial (charter membership).
- `governor` — standing (charter membership).
- `charter` — the charter round.

That's 3 provenance attributes minimum for charter vaults. Plus potentially more for later rounds.

**At 2100 vaults (depth 12), the packet budget for caller attributes may be 3 or 4 — barely enough for provenance.** The suite tests at depth 7. It doesn't test depth 12. The deck root is committed once at `commit_deck` and cannot be replaced.

**Attack / accident.** Bank commits a 2100-card deck. Mint round opens. First charter customer tries to mint with `[('notice','CBOB-NOTICE-0042'), ('charter','0042'), ('governor','name')]` = 3 attributes. Suppose this fits at depth 12. Then a later round wants to add a 4th attribute like `('bonus_tier','gold')`. It doesn't serialize. **The product can never add another attribute after minting opens.**

**Fix.** Test 11.11 must run at production depth (12). If the budget is <3, either shrink the deck (limits scale) or move attributes into a separate account.

More concerning: the SPEC says this must be decided before minting opens, and calls it OPEN AND BLOCKING (limit 23). But **there is no on-chain enforcement** that the deck matches the eventual product. Someone commits a 2100-card deck and then discovers only 3 attributes fit. The commit is one-shot.

**Evidence if I'm right.** Add to `tests/3prog.test.ts` an `attrFit` test at depth 12 (or the target production depth). Report the actual budget. Compare against product needs.

Also: is there anything in the code or suite that asserts the relationship? Test 11.11 just prints and records. It's a MEASUREMENT, not a bound. It doesn't fail if maxAttrs is too small for the product.

**Fix.** Add an assertion:
```js
rec('11.11', 'at production deck depth, at least N caller attributes fit', ..., maxAttrs >= 3)
```
where N is derived from product needs.

### FINDING R4-2 (HIGH): MAX_DECK_PROOF = 24 permits far more depth than reasonable.

Depth 24 = deck of 2^24 = 16.7M cards. Nobody will ever commit this. But `commit_deck` doesn't validate root length or expected depth. If someone commits a nonsense root that's a MAC of an unrelated tree with different structure, the proof-verification will fail for every mint — permanent brick.

The one-shot design means this needs to be right the first time.

**Fix.** Have `commit_deck` also commit `expected_depth: u8` and require proofs to be `expected_depth ± 1` (the ±1 for the promoted-odd-node case).

---

## R5. Phase 1's own changes

### FINDING R5-1 (HIGH): The new stated-count gate's regexes are FRAGILE and could accidentally match unrelated numbers.

**Construct.**
```js
const RX = {
  'on-chain':   /(\d+) assertions, real cloned Core/g,
  'detector':   /(\d+) detector\b/g,
  'allocation': /(\d+) allocation\b/g,
  'deck':       /(\d+) deck\b/g,
  'mainnet':    /(\d+) live-mainnet\b/g,
}
```

These are pattern-based and anchored to prose. What if SPEC.md says something innocuous like "the 439 detector assertions..." somewhere out of context? All 439-detector mentions are checked. Good.

But what about a phrase like "at 5 deck rounds it may... "? `/5 deck\b/` matches. Now it demands `5 == deck_floor`. If deck_floor = 17, this fails. So a passing prose sentence that happens to include "N deck" (like "the 24 deck proof positions") would fail the gate.

**Look for false-positives in SPEC.md:**
```
$ grep -oE '[0-9]+ deck' SPEC.md
```

Scanning the diff, I see "17 deck" in the "Running the tests" block. Consistent. But if someone writes "the 8-card deck", `/8 deck/` matches. If deck_floor is 17, this fails.

**Also:** the `matchAll` approach means EVERY occurrence must equal the floor. If a paragraph legitimately says "the 90-card deck used in testing", that would need to also be 90. But if `deck_floor` is 17, mismatch → fail.

**Fix.** Restrict the regexes to more specific phrasings or anchor them to the "assertions" pattern:
```js
'deck': /(\d+) deck assertions/g
'allocation': /(\d+) allocation assertions/g
```

Actually looking again at the diff, the intended pattern is "N-assertion floor" style. Let me look at how SPEC states it now:

SPEC.md excerpt:
```
./scripts/run-tests.sh          # 316 assertions, real cloned Core, real SPL tokens
                                # (+ 439 detector, 103 allocation, 17 deck and
                                #  19 live-mainnet
```

So SPEC writes "N detector", "N allocation", "N deck", "N live-mainnet" as bare phrasings. These are the intended sites. The regexes with `\b` boundary catch these. Any other occurrence would false-positive.

**Search SPEC for accidents.** Scanning the file for `\d+ deck`, `\d+ detector`, etc. that AREN'T the intended count:

- "at 24 deck proof positions" — hypothetical. If it existed, it would false-fire.
- "the 16 assertion selftest" for the deck — the deck selftest uses `FLOOR = 16` (from the diff), not 17. So `deck_floor` reads 17 from run-tests.sh, but the internal floor in bank/deck.mjs is 16. Different meaning. If SPEC ever mentions "16 deck assertions" (the internal floor), the gate fails.

**Fix.** Tighten the regex to match the specific format SPEC uses. `/(\d+) deck and \d+ live-mainnet\b/` or similar sentence-anchored.

Otherwise: **the gate is over-eager and will false-fire on any incidental number+keyword pair**. It's more likely to fail on a false positive than to catch a real drift.

### FINDING R5-2 (MEDIUM): Zero-match failure mode: correct but unaesthetic.

```js
const everywhere = (what, want) => {
  const found = statedIn(spec, what)
  t(`SPEC states the ${what} floor correctly EVERYWHERE it states it (${JSON.stringify(found)} vs ${want})`,
    found.length > 0 && found.every(n => n === want), true)
}
```

Correct: zero matches → fail. Good.

But this creates a coupling: SPEC.md MUST mention each of the five floors at least once, at the exact correct value, everywhere it's mentioned. If someone chooses to describe the process without naming a specific floor, the gate goes red. That's on purpose (limit 22 style), but it's very tight.

### FINDING R5-3 (HIGH): The `0x1a` check in 11.13/11.14 confirms authority, but is `0x1a` the ONLY Core error for that path?

**Construct.** From the test:
```js
because('11.13','0x1a')
because('11.14','0x1a')
```

The comment says: "0x1 and 0x2 are Deserialization and Serialization; if either of those ever appears here, the arms above are proving nothing."

**Question:** what other Core errors could an UpdatePluginV1 with bad authority produce?

Metaplex Core's error enum (from `@metaplex-foundation/mpl-core/errors.ts`):
- 0x00 InvalidSystemProgram
- 0x01 DeserializationError
- 0x02 SerializationError
- 0x03 PluginsNotInitialized
- 0x04 PluginNotFound
- 0x05 NumericalOverflow
- 0x06 IncorrectAccount
- 0x07 IncorrectAssetHash
- 0x08 InvalidPlugin
- 0x09 InvalidAuthority
- 0x0a AssetIsFrozen
- 0x0b MissingSigner
- 0x0c InvalidTransferAuthority
- 0x0d InvalidBurnAuthority
- 0x0e InvalidUpdateAuthority
- 0x0f AssetIsBurnt
- 0x10 InvalidAssetOwner
- ...
- 0x1a NoApprovals

The check `because('11.13', '0x1a')` verifies the error code is 0x1a exactly. If Core ever renumbered errors in an upgrade, the check would fail. That's fine — it goes red and someone investigates.

But **is 0x1a really the correct error for "wrong authority on UpdatePluginV1"?** The Attributes plugin has authority `PLUGIN_AUTHORITY_ADDRESS = SEAL_PDA`. Trying to call UpdatePluginV1 signed by alice or bank should produce... `InvalidAuthority` (0x09)? Or `NoApprovals` (0x1a)?

Given the test asserts 0x1a, that's what Core actually returns. Good — measured, not assumed.

**But** — the test that MEASURES this uses `upLevel` which is a hand-built instruction. If the byte layout is off, Core might return 0x01 (Deserialization) instead of 0x1a. The test would pass (because it says `because('11.13','0x1a')` and the actual error is 0x01), but for the wrong reason: **the instruction was refused not because of authority but because it was malformed**.

Wait, `because()` asserts the error code CONTAINS `0x1a`. Let me re-read:
```js
const because=(id:string,code:string)=>{const r=R.find(x=>x.id===id)
  const hit=(r?.n||'').includes(code); ...}
```

So `because('11.13','0x1a')` requires the error string to contain the substring "0x1a". If actual error is "0x1", the substring "0x1a" is NOT in "custom program error: 0x1", so the check fails.

Actually wait: "0x1a" as a substring — is it in "custom program error: 0x1a" (which is what a raw Core error 0x1a would show)? Yes.

Is it in "custom program error: 0x1"? No.

So the check is discriminating between 0x1a and 0x1 correctly. Good.

But what if the error is "custom program error: 0x1abc" (for a hypothetical error 0x1abc)? Then "0x1a" is a substring. But Core errors are u32 and small (in the tens), so this is not realistic.

**Verdict:** 11.13/11.14 arms + `because` verification are sound. They prove refusal is authority-based, and 11.15 confirms value survives.

**Missing actor:** what if a *Squads multisig proposal* attempted to write the level via UpdatePluginV1? The Squads vault is the SEAL upgrade authority. But SEAL doesn't have an instruction to write attributes; only a program upgrade could add one. That's captured as accepted limit 13.

**What about**: Core's UpdateV2 (an entirely different instruction)? It updates the asset's URI, name, etc. Does it touch attributes? Let me think… Core's UpdateV2 changes asset-level fields (name, uri, update_authority). It doesn't rewrite plugins. So the level is safe.

Actually the *update authority* is `MINT_AUTH` (the mint program's PDA). Can MINT's UpdateAuthority CPI rewrite the level? MINT has no instruction that does this. Fine.

### FINDING R5-4 (LOW): The `detectors.mjs` comment about "gap is timing, not capability" — is it true?

**Construct.** The corrected comment claims:
> `bank/cosign.mjs` DOES see it: `scanPda` calls DAS `getAssetsByOwner` on the vault's asset-signer PDA...

Let me verify against `bank/cosign.mjs`:
```js
async function scanPda(conn, pda) {
  // ...
  const r = await fetch(rpcUrl(), { method: 'POST', ...
      body: JSON.stringify({ jsonrpc: '2.0', id: 'c', method: 'getAssetsByOwner',
        params: { ownerAddress: pda.toBase58(), page: 1, limit: 1000 } }) })
  const env = D.judgeDasEnvelope(...)
  if (env.problem) throw new Error(`DAS getAssetsByOwner: ${env.problem}...`)
  const items = env.items
  for (const it of items) {
    if (it.burnt) continue
    owned.push({ address: it.id, kind: 'asset' })
  }
  if (items.length >= 1000) throw new Error('DAS returned a full page for one PDA — refusing to judge a truncated list')
  return owned
}
```

Confirmed: it calls DAS on the PDA, keeps every non-burnt asset regardless of collection, refuses on error, refuses a full page. ✓

**Does judgeRedemptionCoverage refuse an undeclared foreign asset?**
```js
export function judgeRedemptionCoverage(owned, declared) {
  const bad = []
  const seen = new Set(declared)
  for (const h of owned) {
    if (h.undeclarable) { ... }
    if (seen.has(h.address)) continue
    bad.push(`... at ${h.address} is owned by this vault and is NOT declared in the burn — it would be DESTROYED`)
  }
  return { ok: bad.length === 0, reasons: bad }
}
```

So yes: any foreign asset in `owned` that's not `declared` → refused. ✓

**The corrected comment is TRUE.**

But there's still a subtle issue: `getAssetsByOwner` — is this reliable? DAS is an indexer. It has known lag. If a foreign asset was transferred INTO the PDA seconds ago, DAS might not have indexed it yet. The comment already acknowledges this ("also blind to anything DAS has not indexed yet").

**Fix?** Cross-check against `getAsset` for each declared account? That doesn't scale, and the co-signer is a mitigation, not a proof (as SPEC states).

### FINDING R5-5 (LOW): The comment says the co-signer "fails closed" but the failure mode is a refusal, not a halt. What if operator overrides?

The default is `--live` off (inspect-only). To sign, the operator runs with `--live`. If the co-signer refuses, the operator can... not sign. Or bypass via another tool.

This is accepted limit 1b: "the Bank's POLICY is procedure". Correctly named.

---

## R6. The under-claim direction

### FINDING R6-1 (INFO): Another under-claim: the confinement in SEAL claims to catch the Bank as fee payer only via cosign.mjs, but it also blocks a `SetComputeUnitPrice`-based DoS.

Reading SEAL's confinement:
```rust
for (n, a) in ix.accounts.iter().enumerate() {
    require!(a.pubkey != bank || n == MINT_IX_BANK_IDX, MintError::BankKeyOutsideMint);
}
```

Wait, that's MINT. SEAL's is:
```rust
} else {
    require!(
        !ix.accounts.iter().any(|a| a.pubkey == bank),
        VaultError::BankKeyOutsidePair
    );
}
```

Any non-open, non-burn instruction that names bank is refused. This includes:
- SystemProgram.transfer(from=bank, ...)
- ATA program creating an ATA where bank is a signer/payer
- Any other program

What about ComputeBudget? ComputeBudget instructions don't take accounts (they're pure config). So bank can't appear in them. So ComputeBudget instructions pass through fine. ✓

But wait — under-claim direction: what does the ACCEPTED LIMITS section say the co-signer protects against?

Limit 1a says: "Nothing in any program bounds what else a redemption transaction contains; `open_for_redemption` scans forward only as far as its matching burn."

**This is wrong.** The confinement in `open_for_redemption` scans EVERY top-level instruction (via `i` iterating from 0 while `load_instruction_at_checked` succeeds), not just up to the burn. Round 17 explicitly rewrote it to scan from 0. Look:

```rust
let mut i = 0usize;
let mut seen_self = false;
while let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
    let is_open = ...
    let is_burn = ...
    if !found && i > current && is_burn && ...
    if i == current { seen_self = true; }
    if !is_open && !is_burn {
        require!(
            !ix.accounts.iter().any(|a| a.pubkey == bank),
            VaultError::BankKeyOutsidePair
        );
    }
    i += 1;
}
```

The scan iterates ALL top-level instructions, and for each non-open/non-burn instruction, refuses if bank appears. **So limit 1a's statement "scans forward only as far as its matching burn" is WRONG — that was pre-round-17.**

**This is an under-claim.** The on-chain confinement is stronger than the SPEC's accepted limits list credits it for.

**Fix.** Update limit 1a to reflect that the program allowlist and fee payer are the actual off-chain remnants; the "what else a redemption transaction contains" is now bounded on-chain to "the Bank's key can't appear elsewhere". The program allowlist and fee payer are the specific gaps.

Actually re-reading, the SPEC text (Buyer-facing paragraph):
> ⚠️ **THE BANK-PUBKEY CONFINEMENT IS ON-CHAIN NOW, IN BOTH PROGRAMS...**

So SPEC already knows this. But the ACCEPTED LIMITS section still says:
> **1a. The program allowlist and the Bank-pubkey confinement are OFF-CHAIN.**

This is directly contradicted by the SPEC prose two paragraphs earlier. **The ACCEPTED LIMITS heading and body of 1a are stale.**

The body of 1a should say: "The program allowlist is OFF-CHAIN. The Bank-pubkey confinement is on-chain in SEAL and MINT; the fee payer is off-chain."

This is the exact under-claim class from the prompt. Filing.

---

## R7. The counts and the arithmetic

### FINDING R7-1 (verified): The floors read correctly.

From `scripts/run-tests.sh`:
```
DECK_FLOOR=17
DET_FLOOR=439
ALLOC_FLOOR=103
MAINNET_FLOOR=19
```
And:
```
MIN_ASSERTIONS=316
```

The prompt states 316/439/103/19 (and 17 for deck). All consistent with the file. ✓

### FINDING R7-2 (verified): The published census figures reproduce.

108/60/36/24/12 → 240 total, 732 denominator. ✓
945/525/315/210/105 → 2100 total, 6405 denominator. ✓

Per-$1000 figures:
- 240 vaults: 2.73 / 4.10 / 5.46 / 6.83 / 8.20 ✓
- 2100 vaults: 0.31 / 0.47 / 0.62 / 0.78 / 0.94 ✓

Shares at 2100: 29.5 / 24.6 / 19.7 / 16.4 / 9.8 → sum = 100.0% ✓

Level V / Level I = 6/2 = 3.0. ✓

**All arithmetic checks out.**

### FINDING R7-3 (LOW): The floors are correct, but the equality-only check accumulates fragility.

Round 19's fix changed `≥` to `==`. Now if you add an assertion, you MUST bump the floor. This is intentional — but a common failure mode is: add assertions in `bank/selftest.mjs` locally, forget to update run-tests.sh's DET_FLOOR, get "must be EQUAL — the file stopped early". So the fix isn't "the file stopped early" (that's misleading), it's "the file made MORE assertions than the floor allows".

The error message conflates these. Minor.

---

## R8. One-of-N sites

### FINDING R8-1 (MEDIUM): The `commit_deck` fix is one-of-one — but is there anywhere else this pattern applies?

`commit_deck` refuses to overwrite a non-zero root. This is a one-shot pattern. Are there other one-shot patterns in the codebase?

- `initialize` in all programs: guarded by Anchor's `init` — refuses if account exists.
- `set_round`: NOT one-shot. Governance can call multiple times. Different mechanism.

Nothing else has one-shot semantics. ✓

### FINDING R8-2 (MEDIUM): The BANK-pubkey confinement was added to MINT (round 17). Are there other Bank-signature-taking instructions that lack it?

Bank signs in:
- SEAL: `open_for_redemption` — HAS confinement (updated round 17)
- BURN: `burn_vault` — does it have confinement?
- MINT: `mint_vault` — HAS confinement (added round 17)

Let me check BURN:

```rust
pub fn burn_vault(ctx: Context<BurnVault>, declared: u8) -> Result<()> {
    // ...
    let sysvar = ctx.accounts.instructions.to_account_info();
    let current = load_current_index_checked(&sysvar)? as usize;
    let asset = ctx.accounts.vault_asset.key();
    let owner = ctx.accounts.owner.key();
    let mut found = false;
    for i in 0..current {
        if let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
            if ix.program_id == SEAL_PROGRAM_ID
                && ix.data.len() >= IX_OPEN_FOR_REDEMPTION_DISC.len()
                && ix.data[..IX_OPEN_FOR_REDEMPTION_DISC.len()] == IX_OPEN_FOR_REDEMPTION_DISC
                && ix.accounts.get(SEAL_IX_ASSET_IDX).map(|a| a.pubkey) == Some(asset)
                && ix.accounts.get(SEAL_IX_OWNER_IDX).map(|a| a.pubkey) == Some(owner)
            { found = true; break; }
        }
    }
    require!(found, BurnError::NoPrecedingOpen);
    // ...
```

**BURN does NOT have a Bank-pubkey confinement.** It only checks the preceding open.

**Attack.** Transaction:
1. `open_for_redemption` (SEAL) — bank at legitimate slot; SEAL's confinement scans everything.
2. `burn_vault` (BURN) — bank at legitimate slot; BURN checks (1) exists, then executes.

But (1)'s confinement scan sees all instructions in the transaction. If instruction (3) exists that names bank illegitimately, SEAL's confinement catches it.

**Wait, is this always the case?** Let me check the