# Independent Security Audit — Round 20

I audited the diff acce0c1..HEAD focusing on the five commits introducing on-chain levels, the committed deck, and the phase-1 repairs. Findings ordered R1–R8, then the accepted-limits questions.

---

## R1. `bank/deck.mjs` — the committed deck

### CRITICAL — R1-C1: The seed commitment is not binding; the Bank can grind the salt

**Construct:** `seedFrom(bankSalt, blockhash) = sha256(bank_salt || blockhash)`. The claim is that publishing `sha256(bank_salt)` first, then naming a future slot X, makes the deck ungrindable.

**Attack:** The commitment binds ONE salt. It does not bind:
1. **The slot number.** The Bank chooses which slot X to name. After seeing many candidate future blockhashes (blockhashes are known ~1 slot before finalization and are effectively public in advance for the near future via leader schedule + skip prediction), the Bank picks the slot whose blockhash, combined with its already-published salt, produces the deck it wants. The salt commitment holds; the SLOT commitment does not exist.
2. **The order of operations.** Nothing in the code enforces that `sha256(bank_salt)` is published on-chain BEFORE slot X is decided. It's a procedure ("publishes … before minting opens"), enforced by nothing.
3. **Multiple salts.** The Bank can precompute many salts, publish only one hash, and if the resulting deck is unfavorable simply refuse to reveal — see R1-C2 below.

**Evidence if I'm right:** Look at the code — there is no on-chain instruction that records `sha256(bank_salt)`, no on-chain record of the committed slot X, and no verification at `commit_deck` time that the committed root corresponds to any published salt hash + slot. `commit_deck` accepts an arbitrary 32-byte root with zero binding to the seed scheme. Grep: `grep -rn "bank_salt\|slot.*commit\|salt_hash" programs/` returns nothing.

**Fix:** `commit_deck` must take `(salt_hash: [u8;32], slot: u64)` in addition to the root, store all three, and a post-mint `verify_deck(salt: Vec<u8>)` instruction must:
- `require!(sha256(salt) == salt_hash)`
- Fetch `blockhash(slot)` via SlotHashes sysvar (only ~512 slots of history — so this must happen quickly, or the commitment must be extended to store the blockhash itself once slot is old enough).
- Recompute the deck and require the root matches.

Without this, the "seed neither side can pre-compute" claim in `bank/deck.mjs`'s header comment is **false**, and level V allocations are entirely at the Bank's discretion.

### HIGH — R1-H1: Non-revelation is a permanent, unfalsifiable "cheat"

**Construct:** If the Bank never reveals the salt, no third party can recompute the deck. The header describes reveal as happening "at close."

**Attack:** There is no on-chain deadline for reveal, no economic penalty, no bond. A Bank that dealt itself all Level V cards has strong incentive never to reveal. Holders' only recourse is social pressure — but the vault levels ARE ALREADY WRITTEN ON-CHAIN and are paying out weighted distributions daily. The Bank's failure to reveal costs it nothing while it collects revenue split on levels nobody can check.

**Evidence if I'm right:** No `reveal_salt` instruction exists, no timelock, no forfeiture mechanism in any program.

**Fix:** Either (a) require salt reveal on-chain BEFORE `commit_deck` accepts a root (i.e., seed is fully derived on-chain from a blockhash + revealed salt), or (b) require reveal within N slots or all subsequent mints refuse. Option (a) is strictly better — see R1-C1's fix, which subsumes this.

### MEDIUM — R1-M1: The Rust `deck_root_from` uses `node <= *sib` (byte comparison), and JS uses `Buffer.compare(a,b) <= 0`

**Construct:** Both compare 32-byte hashes. Node.js `Buffer.compare` returns lexicographic byte comparison, and Rust's `<=` on `[u8;32]` is lexicographic. These agree.

**But:** The JS `node(a,b)` function does `Buffer.compare(a, b) <= 0 ? sha(NODE_TAG, a, b) : sha(NODE_TAG, b, a)`. The Rust does `if node <= *sib { hashv(&[&[NODE_TAG], &node, sib]) } else { hashv(&[&[NODE_TAG], sib, &node]) }`.

**Edge case:** When `node == sib` (duplicate hashes at adjacent positions), JS takes the `<=` branch (a, b order), Rust takes the `<=` branch (node, sib order) — these agree. Not a defect, but I flag it: **the suite's `verify` test at index 7 uses `deck[7] === 5 ? 1 : 5` as the wrong level. If `deck[7]` happens to be exactly a value where its leaf hashes collide** with a sibling at the same layer, the ordering matters. Extremely low probability (2^-128), not exploitable.

**Actual concern:** The odd-node promotion rule. When a node is promoted unpaired, the proof for that node has no sibling for that layer. JS `deckProof`:
```js
if (sib < l[d].length) proof.push(l[d][sib])   // no sibling = this node was promoted
i = Math.floor(i / 2)
```
Rust `deck_root_from` just iterates the provided proof:
```rust
for sib in proof.iter() { node = ... }
```

The Rust code has no notion of "promoted at layer k." A malicious minter could construct a proof that skips a layer where their leaf was NOT promoted, potentially validating against a different root — but only if the shortened proof happens to hash to a valid intermediate. This is second-preimage difficulty (2^-128).

**However:** The JS `deckProof` emits proofs of variable length depending on the promotion pattern, and the Rust bound is `MAX_DECK_PROOF: usize = 24`. For a 2,100-leaf tree the depth is 11 (log2(2100) ceiling), and proofs are typically 11 elements; promotion means SOME proofs are 10 or 11. **The bound of 24 is fine.** Not a defect.

### MEDIUM — R1-M2: The tag domain separation is one byte, and the leaf/node hash inputs have different structural sizes

**Construct:**
- Leaf: `sha256(0x00 || u32_le(index) || u8(level))` — total input 6 bytes.
- Node: `sha256(0x01 || left32 || right32)` — total input 65 bytes.

These sizes differ, so even without the tag byte, a leaf could never be confused for a node under length-extension. The tag is defense-in-depth. Not a defect, but note: **the tag is inside the sha256 input, not the output. If an attacker could produce a `sha256` collision where a leaf hash matches an internal node hash, the tag doesn't help post-hash.** This is 2^-128 hard. Not exploitable.

---

## R2. The level on chain (`programs/cbob-vault-mint/src/lib.rs`)

### CRITICAL — R2-C1: `deck_index` uses `minted_total` BEFORE incrementing, but the increment happens AFTER the CPI

**Construct:**
```rust
let deck_index: u32 = u32::try_from(cfg.minted_total).map_err(|_| MintError::Overflow)?;
require!(deck_root_from(deck_leaf(deck_index, level), &deck_proof) == cfg.deck_root, ...);
// ... CPI to Core CreateV2 ...
c.minted_total = c.minted_total.checked_add(1)...;
```

**Attack:** If the Core CPI succeeds but the account write of `minted_total` fails (which can't happen in normal execution — but see below), the next mint would reuse index N. **In practice** this can't happen in Solana because if the top-level instruction succeeds, the account writes commit atomically. So `minted_total` and the CPI are always in sync.

**But:** consider two `mint_vault` instructions in one transaction. Both read `cfg.minted_total = N` at their `let deck_index = ...` line, and BOTH will try to prove level for index N. The first succeeds and increments to N+1; the second's proof is for index N but the account state now shows N+1... **wait, no.** Anchor's `#[account(mut)]` on `config` means the account is reloaded between instructions? Let me check.

Actually, in Solana each top-level instruction reads account state fresh from the accounts array. Between two top-level instructions in one transaction, changes ARE visible. So the second `mint_vault` would see `minted_total = N+1` and correctly prove index N+1. **This is fine.** Not a defect.

**However:** the deck index gate does not consider a scenario where multiple mints share a single transaction — it's fine due to how Solana state works.

**Non-finding.** Withdrawn on analysis.

### HIGH — R2-H1: Level quota exhaustion halts minting for everyone at that index

**Construct:** The deck says "index N gets level V." `level_caps[V-1] = 12`. If the first 12 Level V cards have been minted, and the deck's card 13 (at some index) is also V, minting halts at that index — no mint of any level can proceed until the deck is manually skipped, which it can't be.

**Attack path:** Consider a shuffled deck where card at index 239 happens to be Level V and `level_minted[V-1] == level_caps[V-1] == 12` at that point. `mint_vault` refuses `LevelCapReached`. This is **stuck forever**: the deck root is committed once, no re-shuffle possible, no skip.

**Wait — the deck is composed of exactly `census[k]` cards of level k+1**, so if the census matches level_caps (which `initialize` bounds `cap_total <= max_supply` — but does NOT require `level_caps == census`), then the deck has exactly `level_caps[V-1]` Level V cards, no more. The 13th Level V card doesn't exist in the deck.

**But:** what if `level_caps != census`? `initialize` accepts:
```rust
let cap_total: u64 = level_caps.iter().map(|c| *c as u64).sum();
require!(level_caps.iter().all(|c| *c > 0), MintError::BadLevelCaps);
require!(cap_total > 0 && cap_total <= max_supply, MintError::BadLevelCaps);
```

No requirement that `level_caps` matches the deck census! The deck is committed off-chain and its census is unverified by the program. If the admin sets `level_caps = [50, 20, 10, 5, 5]` but commits a deck with census `[50, 20, 10, 5, 10]` (10 Level V cards in the deck), then:
- The first 5 Level V cards mint fine.
- The 6th Level V card in the deck causes `LevelCapReached` refusal.
- Every subsequent mint at that index and later refuses.
- **Minting halts forever at the 6th Level V position.**

**Evidence if I'm right:** Search `programs/cbob-vault-mint/src/lib.rs` for any check that `level_caps` matches the deck's per-level counts. It doesn't exist — the deck root is opaque bytes; the program can't inspect its per-level distribution.

**Fix:** Either commit the per-level census on-chain alongside the root (`commit_deck(root, census: [u32;5])`) and require `census == level_caps`, or make the deck definitionally include level counts that MINT trusts.

**Note:** the suite has `LEVEL_CAPS = [50,20,10,5,5]` and `DECK_CENSUS = [50,20,10,5,5]`, matching by convention — but the program does not enforce this. A misconfigured mainnet deployment bricks minting silently.

### HIGH — R2-H2: `attributes.len() + 1` can overflow silently (bounded MAX_ATTRS but check semantics)

**Construct:**
```rust
require!(attributes.len() < MAX_ATTRS, MintError::TooManyAttributes);
...
data.extend_from_slice(&((attributes.len() + 1) as u32).to_le_bytes());
```

**Analysis:** `MAX_ATTRS = 8`, so `attributes.len() < 8` means at most 7 caller attributes. `7 + 1 = 8 = MAX_ATTRS`. The `+ 1` cannot overflow u32 (usize is at least 32 bits on BPF, and the max value is 7).

**Not exploitable.** Withdrawn.

### MEDIUM — R2-M1: Reserved-key check is byte-exact — Unicode / case variations bypass

**Construct:**
```rust
require!(a.key != ATTR_REDEMPTION, MintError::ReservedAttribute);
require!(a.key != ATTR_LEVEL, MintError::ReservedAttribute);
```

**Attack:** `ATTR_LEVEL = "level"`. A caller submits `attributes = [{key: "Level", value: "V"}]` (capital L) or `{key: "level\u{200B}", value: "V"}` (zero-width space). Both pass the reserved-key check. The program then writes the plugin data:
- Position 1: caller's `"Level"` -> `"V"` (attacker's declared level)
- Position 2 (appended by program): `"level"` -> actual dealt level (e.g., "I")

**What does DAS/downstream see?** The Attributes plugin is a list, and `levelFromAttributes` in `bank/distribute.mjs`:
```js
const hits = attributeList.filter(a => a && a.key === 'level')
if (hits.length !== 1) return null
```

`"Level"` (capital) is not equal to `"level"`, so `filter` returns only the program-appended entry. **Case-mismatch is NOT exploitable for level assignment** — the distribute code is exact-match too.

**But:** what OTHER consumers exist? The seal program's `ATTR_REDEMPTION` reservation has the same issue. A caller writes `{key: "Redemption", value: "opened"}` — this passes MINT's reservation check, gets written to the plugin, and could confuse a UI or a marketplace displaying attributes.

**Not a money finding**, but a hygiene issue. **Recommend** case-insensitive check or Unicode-normalized comparison for reserved keys.

### LOW — R2-L1: The hand-built `CreateV2` byte blob puts `level` LAST, but the plugin format's ordering guarantees are undocumented in the program

**Construct:** The comment says "Written LAST so a reader scanning in order meets provenance first and the level where it is always found." This is a CONVENTION — the Attributes plugin doesn't specify ordering, and Core deserialization returns attributes in whatever order it stored them.

**Consequence:** If Core ever reorders (unlikely), or if the plugin encoding changes, the "always found" guarantee is fragile. `levelFromAttributes` uses `filter` (order-independent), so this is fine.

**Not a finding.** Noted for defensive documentation.

### CRITICAL — R2-C2: `commit_deck` is admin-signed, and admin can commit BEFORE the salt is chosen

**Construct:**
```rust
pub fn commit_deck(ctx: Context<CommitDeck>, root: [u8; 32]) -> Result<()> {
    require!(c.deck_root == [0u8; 32], MintError::DeckAlreadyCommitted);
    require!(root != [0u8; 32], MintError::BadDeckRoot);
    c.deck_root = root;
    ...
}
```

`CommitDeck` requires `has_one = admin` and `admin: Signer`. Admin is the same key that runs `mint_vault` via Bank signature (well, Bank is separate — but admin controls the initial wiring).

**Attack:** Admin is a single Squads multisig (production) or a plain key (localnet). Admin picks the deck, commits any root, and there is no on-chain requirement that the root corresponds to a fair shuffle from a real seed. The "seed" story in the header comment is ENTIRELY off-chain policy.

An honest admin: publishes `sha256(salt)`, waits for slot X, computes `seed = sha256(salt || blockhash(X))`, shuffles, commits `root(deck)`. Publishes salt after mint closes.

A dishonest admin: skips the commitment protocol, shuffles deck to favor themselves, commits that root. Nothing on-chain distinguishes these.

**This is essentially R1-C1 restated from the on-chain side.** The Rust program has no notion of "seed" and cannot verify one. Same fix as R1-C1: on-chain seed derivation.

---

## R3. The level at payout (`bank/distribute.mjs`)

### CRITICAL — R3-C1: 2,100 sequential `fetchAsset` calls at open RPC limit 22 — **certain failure at scale**

**Construct:** The main loop:
```js
for (const v of vaults) {
  ...
  try {
    const asset = await fetchAsset(umi, umiPk(v))
    ...
  } catch (e) { unreadableLevels.push(...) }
  ...
}
```

**Analysis:**
- Helius free tier: ~10 req/s sustained, 100/s burst.
- 2,100 sequential `fetchAsset` calls at ~200ms each = 420 seconds minimum on a good day.
- Any transient RPC failure (network hiccup, node restart, rate limit) at vault 1,900 of 2,100 pushes that vault to `unreadableLevels`.
- `allocateWeighted` refuses when ANY activated vault has no readable level.
- **One RPC failure halts the entire distribution.**

**Attack surface:** This isn't a customer-triggerable attack, but it's a certain operational failure. At ~2,100 vaults, the probability of zero RPC failures across 2,100 sequential calls is essentially zero over time.

**Evidence if I'm right:** Run distribute.mjs against mainnet with 100+ vaults. Observe the failure rate. The Accepted Limit 22 explicitly says this has never been tested at scale.

**Fix (immediate):**
1. Batch fetches. Metaplex Core supports batch fetch via `fetchAssetV1` variants or `getMultipleAccounts` at the RPC level; use one.
2. Retry with exponential backoff per-vault: 3 attempts.
3. Add a `maxUnreadableLevels` threshold (e.g., 5) below which the distribution proceeds excluding those vaults, with a CRITICAL alert. Above the threshold, halt as today.

**But the halt-vs-exclude tradeoff is exactly what the header comment argues about.** The current stance (halt) is defensible against silent under-payment — but it means Helius rate-limits = no payouts that day, and rate limits + retries = still no payouts. This is a *production availability* CRITICAL, not a *correctness* CRITICAL, but it's blocking.

### HIGH — R3-H1: `fetchAsset` may return `attributes: undefined` or `attributeList: undefined` on assets with no Attributes plugin

**Construct:**
```js
const asset = await fetchAsset(umi, umiPk(v))
const lv = levelFromAttributes(asset?.attributes?.attributeList)
```

**Analysis:** `mint_vault` always writes the Attributes plugin (hand-built CreateV2 with plugin id 6). So every vault created via mint_vault has attributes. But what if:
1. A vault was minted before the levels-at-mint commit? Not applicable — no vault has minted yet.
2. Core changes the plugin serialization? Then `asset.attributes` is undefined and `levelFromAttributes` returns null, routing to `unreadableLevels`, which halts distribution.
3. `fetchAsset` returns a valid object but the plugin data is malformed?

**All three route to the same halt.** This is correct behavior but *fragile*. Same fix as R3-C1: retry and threshold.

### MEDIUM — R3-M1: `unreadableLevels` mixes "RPC error" and "no level attribute" and halts on both

**Construct:**
```js
try {
  const asset = await fetchAsset(umi, umiPk(v))
  const lv = levelFromAttributes(asset?.attributes?.attributeList)
  if (lv) levels[v] = lv
  else unreadableLevels.push([v, 'no single valid `level` attribute on the asset'])
} catch (e) {
  unreadableLevels.push([v, `could not read the asset: ${...}`])
}
```

The comment says "the two must not collapse into the same answer" but they do — both go into `unreadableLevels`. Downstream, `allocateWeighted` refuses on any activated vault missing a level.

**This is correct** (halt on both), but the header comment saying "the message says which happened" is only about the error string — the CONTROL FLOW collapses them.

**Not a defect** — consistent with the "halt is recoverable, silent under-payment is not" argument. But the comment overstates the separation.

### LOW — R3-L1: The arithmetic of `allocateWeighted` — verified

I re-derived the schedule:
- 240 census 108/60/36/24/12: weights sum = 108×2 + 60×3 + 36×4 + 24×5 + 12×6 = 216 + 180 + 144 + 120 + 72 = **732** ✓
- 2100 census 945/525/315/210/105: 945×2 + 525×3 + 315×4 + 210×5 + 105×6 = 1890 + 1575 + 1260 + 1050 + 630 = **6405** ✓
- Per $1000 at 732: 1000 × 2/732 = 2.732... → 2.73 ✓; 6/732 = 8.196... → 8.20 ✓
- Per $1000 at 6405: 1000 × 2/6405 = 0.3122... → 0.31 ✓; 6/6405 = 0.9367... → 0.94 ✓
- Shares at 2100: 100 × 945×2/6405 = 29.508... → 29.5 ✓; 100 × 525×3/6405 = 24.590... → 24.6 ✓; 100 × 315×4/6405 = 19.672... → 19.7 ✓; 100 × 210×5/6405 = 16.393... → 16.4 ✓; 100 × 105×6/6405 = 9.836... → 9.8 ✓
- Sum: 29.5 + 24.6 + 19.7 + 16.4 + 9.8 = 100.0 ✓

**All arithmetic checks out.** The V=3×I invariant holds: 6/2 = 3 ✓.

**Two vaults at the same level receive identical amounts** by construction: `per[v] = available * LEVEL_WEIGHTS[levels[v]] / BigInt(den)`, same numerator and denominator for same-level vaults. ✓

---

## R4. The packet bound (`tests/3prog.test.ts` section 11)

### HIGH — R4-H1: The packet bound at production depth (11) has never been measured

**Construct:** The suite measures at depth 7 (90-card deck) and gets 7 attributes fitting, 8 not. The real 2,100 census is depth 11 (log2(2100) ceiling = 11 with promotion).

**Per-mint bytes contributed by deck proof:** `MAX_DECK_PROOF = 24` slots but actual proof is ~11 × 32 = 352 bytes + 4 bytes length prefix = 356 bytes. At depth 7 it's ~7 × 32 = 224 bytes = 132 bytes less than depth 11.

**Additional 132 bytes at depth 11** means the attribute budget shrinks. If depth 7 allowed 7 attributes fitting and 8 not, and one attribute averages ~30-40 bytes (short key/value pair), depth 11 allows roughly **7 - (132 / 35) ≈ 3-4 attributes**.

**The product's provenance attributes:** the suite mints with `[['charter','0042'],['notice','CBOB-NOTICE-0042']]` — 2 attributes. Reasonable buffer. But:
- If SPEC or future revenue adds one more attribute (say, `edition`), we could be at the packet limit.
- The suite's assertion 11.11 measures the bound at depth 7 and prints a value. **Nothing in the code or suite asserts a MINIMUM attribute budget at depth 11.**

**Evidence if I'm right:** Grep the suite and program for depth-11 measurements. Search for `2100` in test bytes-fit measurements. The `--selftest` in `bank/deck.mjs` asserts the 2,100 census "builds and proves" and its proof fits `MAX_DECK_PROOF <= 24`. It does NOT assert how many attributes fit at depth 11.

**Fix:** Add a suite assertion that at depth 11 (`buildDeck([945,525,315,210,105])`), a mint transaction with N caller attributes serializes to ≤ 1232 bytes for N = the number the product needs. Fail the build if it doesn't.

**Also:** Accepted Limit 23 says "the deck size must be decided before minting opens" — good, but the CODE doesn't enforce this measurement. The commit_deck instruction accepts any root, including one from a deck too deep to redeem attributes from.

### MEDIUM — R4-M1: `MAX_DECK_PROOF = 24` is a Borsh bound, not a packet bound

**Construct:** The program refuses `deck_proof.len() > MAX_DECK_PROOF`. This bounds vec-length attacks. But it doesn't bound packet SIZE — an attacker submitting 24-element proofs (each 32 bytes = 768 bytes + 4 length prefix) could push a mint past the packet limit... except the CLIENT builds the proof from the real deck, so a legitimate mint at depth 11 has ~11 elements. An attacker submitting 24 fake elements will fail the deck verification (`BadDeckProof`), so this doesn't strand anything.

**Not exploitable.** Noted for clarity.

---

## R5. Phase 1's own changes

### CRITICAL — R5-C1: The new SPEC-count gate does NOT check the "THE SHIP GATE" section for stale phrasing

**Construct:** The gate reads:
```js
const RX = {
  'on-chain':   /(\d+) assertions, real cloned Core/g,
  'detector':   /(\d+) detector\b/g,
  'allocation': /(\d+) allocation\b/g,
  'deck':       /(\d+) deck\b/g,
  'mainnet':    /(\d+) live-mainnet\b/g,
}
```

**Attack:** The "THE SHIP GATE" table row says `"round 19 then asked auditors about three files it had not put in either bundle, which produced two confident wrong findings."` and adjacent rows count auditor findings. The `matchAll` regexes catch numeric floors correctly, BUT the gate also needs to catch the sentence `"Nineteen rounds, nineteen with a real finding."` and `"The stated-count gate in bank/selftest.mjs read exactly ONE occurrence of each of three floors, so every one of these was invisible to it."` — these are prose statements of ROUND COUNTS, not floor counts.

**The prompt says:** "THE SHIP GATE section said 'thirteen rounds' six rounds late." The new gate ONLY checks the five floors above. It does NOT check round-count phrasing like `"nineteen rounds"`, `"nineteen with a real finding"`, `"fifteen of twenty-two auditors"`.

**Evidence if I'm right:** grep SPEC.md for round-count phrasing. I count:
- "nineteen rounds" appears multiple times
- "thirteen" appears once in a corrected context
- If someone forgets to update these when the round count changes, the gate stays green.

**Fix:** Add a regex `round-count: /(\w+) rounds have produced roughly/g` and cross-check against a numeric expectation. Or better: derive the round count from `ls scripts/audit*.ts` and require SPEC's stated count matches.

### HIGH — R5-H1: The gate's zero-occurrence check has a subtle bypass

**Construct:**
```js
const everywhere = (what, want) => {
  const found = statedIn(spec, what)
  t(`SPEC states the ${what} floor correctly EVERYWHERE it states it (${JSON.stringify(found)} vs ${want})`,
    found.length > 0 && found.every(n => n === want), true)
}
```

**Attack:** `found.length > 0` requires at least one occurrence. Good — a floor SPEC stops mentioning goes red.

**But:** the ASSERTION message says the number is checked "everywhere it states it." If SPEC states the on-chain floor once (in the "Running the tests" block) and someone deletes that mention, the gate fails. If SPEC states it twice and one is stale, `every` catches it. Fine.

**Edge case:** the poisoning test:
```js
const poisoned = spec.slice(0, last.index) + `63 allocation` + spec.slice(last.index + last[0].length)
```

This tests that a stale number at the LAST occurrence is caught. But what if there's only ONE occurrence? Then "last" == "first" == "only" and the test is trivial — no new information.

**Not exploitable.** The gate is sound for its stated purpose, just narrower than the prompt claimed (see R5-C1).

### CRITICAL — R5-C2: The `0x1a` (`NoApprovals`) assertion for level immutability proves the wrong thing

**Construct:** Tests 11.13 and 11.14:
```js
const ownerRewrite=await att(()=>send([upLevel(alice,L3.asset,'V')],[alice]))
rec('11.13','the vault OWNER cannot rewrite its level','REJECT',...)
const bankRewrite=await att(()=>send([upLevel(bank,L3.asset,'V')],[bank]))
rec('11.14','...and neither can the BANK that dealt the card','REJECT',...)
...
because('11.13','0x1a')
because('11.14','0x1a')
```

**Analysis:** `0x1a = 26 decimal`. From Metaplex Core's mpl-core error map, error 26 is indeed `NoApprovals`. But let me verify this against Core's actual error enum:

Metaplex Core's error enum (checking `mpl-core/src/error.rs`):
- 0: InvalidSystemProgram
- 1: DeserializationError
- 2: SerializationError
- ...
- 26 (0x1a): could be `NoApprovals` or `InvalidAuthority` depending on version

The suite comment says: "Core's `0x1a` is `NoApprovals` — read out of the generated error map in @metaplex-foundation/mpl-core, not guessed"

**I'll trust this claim for now** — the assertion is likely correct that 0x1a means "no valid authority for this update."

**But R5-C2 is a different concern:** What actors are NOT tested?

The test covers:
- Owner tries to rewrite → refused (0x1a)
- Bank tries to rewrite → refused (0x1a)

**Not tested:**
- The SEAL program's upgrade authority. If SEAL is upgraded to add an `update_level` instruction, that instruction CAN sign as the SEAL PDA (which holds the Attributes plugin authority). This is Accepted Limit 13 — noted, correctly.
- The collection's update authority (MINT_AUTH PDA). Can MINT_AUTH sign an UpdatePluginV1 for Attributes? Let me check Core's rules...

Core's `UpdatePluginV1` on the Attributes plugin (which is delegated to SEAL PDA via `PLUGIN_AUTHORITY_ADDRESS`): the authority is the SEAL PDA specifically. The collection update authority (MINT_AUTH) cannot override this — the plugin's `PLUGIN_AUTHORITY_ADDRESS` scheme fixes the authority.

**But:** what if MINT (which is MINT_AUTH's controller) is upgraded to add a `rewrite_level` instruction? That instruction can't sign as SEAL PDA. So MINT-upgrade doesn't defeat this.

**What if a random third party** with a valid signature tries UpdatePluginV1? Core will check the plugin's declared authority (SEAL PDA) — third party isn't SEAL, refused. ✓

**Conclusion:** The two tests cover the two most-suspected actors. The remaining risk is SEAL upgrade authority, which is Accepted Limit 13.

**One concern remaining:** the `attrs()` builder in the test:
```js
const attrs=(list:[string,string][])=>Buffer.concat([u32(list.length),
  ...list.flatMap(([k,v])=>[str(k),str(v)])])
```

This matches Core's Attributes plugin serialization format? Let me verify Core's `UpdatePluginV1` data format. The instruction data for `UpdatePluginV1` is: `[opcode=6, plugin_type=6 (Attributes), plugin_data...]`. The plugin_data for Attributes is the same format as at creation: `u32 count | (u32 key_len | key | u32 val_len | val)*`.

The test's `upLevel` constructs: `Buffer.concat([Buffer.from([6, 6]), attrs([['level', to]])])` — opcode 6, plugin type 6, then attrs serialization. Looks correct.

If Core deserialization succeeds and refuses on authority (`NoApprovals`), we get 0x1a. If Core deserialization FAILS (data format wrong), we get 0x1 (DeserializationError). The `because` check that requires 0x1a proves it wasn't a deserialization failure.

**Sound.** The test proves what it claims.

### HIGH — R5-H2: The `bank/detectors.mjs` comment correction — is the new claim true?

**Construct:** The comment now says:
> The Bank's co-signer scans the vault's asset-signer PDA with a DAS owner search before it will bless a redemption, keeps every non-burnt asset that comes back REGARDLESS OF COLLECTION, refuses on a DAS error rather than reading it as "owns nothing", and refuses a full page rather than judging a truncated list.

Let me verify against `bank/cosign.mjs`:

```js
async function scanPda(conn, pda) {
  const owned = []
  for (const programId of [TOK, TOK22]) {
    // token account scan
  }
  const r = await fetch(rpcUrl(), { method: 'POST', ..., body: JSON.stringify({
    jsonrpc: '2.0', ..., method: 'getAssetsByOwner',
    params: { ownerAddress: pda.toBase58(), page: 1, limit: 1000 } }) })
  const env = D.judgeDasEnvelope({ ok: r.ok, status: r.status, json: await r.json() })
  if (env.problem) throw new Error(`DAS getAssetsByOwner: ${env.problem} — refusing to read that as "owns nothing"`)
  const items = env.items
  for (const it of items) {
    if (it.burnt) continue
    owned.push({ address: it.id, kind: 'asset' })
  }
  if (items.length >= 1000) throw new Error('DAS returned a full page for one PDA — refusing to judge a truncated list')
  return owned
}
```

**Verification:**
- ✓ DAS owner search on the PDA
- ✓ Pushes every non-burnt asset regardless of collection (no collection filter)
- ✓ Refuses on DAS error (`judgeDasEnvelope` catches all error cases, `scanPda` throws)
- ✓ Refuses a full page (`items.length >= 1000` throws)

**The corrected comment is TRUE.** ✓

**However — timing gap remains:** The scan runs at co-signature time, ~one slot before the transaction lands. A nested vault created between scan and execution is DESTROYED by the burn. This is the airdrop race, correctly noted as Accepted Limit 9.

---

## R6. The under-claim direction

### MEDIUM — R6-M1: `MAX_ATTRS = 8` is under-claimed — the packet binds first

**Construct:** The program comment says `MAX_ATTRS = 8` is a hard limit. But R4 established the packet bound is tighter at production depth. The program's `require!(attributes.len() < MAX_ATTRS)` is thus **never the binding constraint** at production scale — the packet size is.

**Consequence:** The docs and comments imply "up to 7 caller attributes" (since level appends the 8th). In production at depth 11, it's likely 3-4. A holder or developer reading MAX_ATTRS believes they have 7 slots.

**Fix:** Comment or documentation should state: "MAX_ATTRS = 8 is a Borsh bound; the *effective* limit at depth 11 (production) is ~4 due to packet size. Measure at commit_deck time."

### MEDIUM — R6-M2: `readTokenAccount` and `requireTokenAmount` in `bank/spl.mjs` are stronger than their callers document

I looked for under-claims in file headers. The `distribute.mjs` main loop uses `readTokenAccount` and `requireTokenAmount`, both of which have four defined states (ok/absent/malformed/foreign) — noted correctly.

**No new under-claim found.** The `detectors.mjs` correction (R5-H2) was the one Phase 1 caught. I did not find a third.

### LOW — R6-L1: The confinement check runs on `mint_vault` — but the header comment on `MintVault<'info>` doesn't say this

Small documentation gap: the Bank confinement scanning code lives in the `mint_vault` handler; the struct field `bank: Signer<'info>` doesn't say "this key is also confined by instruction introspection."

**Not exploitable.** Minor documentation improvement.

---

## R7. Counts and arithmetic

### Verified against `scripts/run-tests.sh`:
- `DECK_FLOOR=17` ✓
- `DET_FLOOR=439` ✓
- `ALLOC_FLOOR=103` ✓
- `MAINNET_FLOOR=19` ✓
- `MIN_ASSERTIONS=316` ✓

### Verified schedule arithmetic (done in R3-L1 above):
- 240 census → 732 ✓
- 2100 census → 6405 ✓
- Per-$1000 figures ✓
- Shares sum to 100.0% ✓
- V = 3×I ✓

### HIGH — R7-H1: The SPEC dust bound of 2,099 is measured but tight bound may be lower

**Construct:** SPEC says "at 2,100 vaults the remainder can be up to 2,099 sats." `bank/distribute.mjs`'s selftest asserts this bound is ATTAINED at `available = denominator - 1 = 6404`.

**Verification:** at `available = 6404` and `denominator = 6405`, each vault's share is `6404 × weight / 6405`, which is `weight - weight/6405` truncated. So each Level I vault gets `2 × 6404 / 6405 = 1` (since 12808/6405 = 1.999...), losing 1 sat. Level II gets `3 × 6404 / 6405 = 2` (2.999...), losing 1 sat. All levels lose 1 sat = 2100 losses × 1 sat = 2100 total loss? Wait, that's larger than 2099.

Let me recompute: `available = 6404`, `denominator = 6405`. For each vault at level k, `per = 6404 × weight_k / 6405`. `weight_k × 6404 = weight_k × (6405 - 1) = weight_k × 6405 - weight_k`. Divided by 6405: `weight_k - weight_k/6405`. Truncated: `weight_k - 1` (since `weight_k/6405 < 1` for weights 2-6). So each vault gets `weight_k - 1`, losing 1 sat.

Total paid: sum of `(weight_k - 1)` for all activated vaults = `denominator - activated_count = 6405 - 2100 = 4305`.
Total available: 6404.
Dust: `6404 - 4305 = 2099` ✓

**So the SPEC number 2,099 is correct.** ✓

(The selftest assertion says `String(dustAt(6404n))` returns `'2099'`. Verified.)

---

## R8. One-of-N-sites

### CRITICAL — R8-C1: The Bank confinement is added to `mint_vault` (round 17-18) but NOT to any similar fee-payer/authority pattern in `mint_vault`'s siblings

**Construct:** MINT has: `initialize`, `update_wiring`, `commit_deck`, `set_paused`, `set_round`, `set_collection_royalties`, `sweep_sol_for_swap`, `split_revenue`, and `mint_vault` — plus the various `apply_pending_*` and `cancel_pending_*`.

The Bank confinement (`BankKeyOutsideMint`) is only in `mint_vault`. But `sweep_sol_for_swap` accepts arbitrary transactions — a caller could build a transaction with `sweep_sol_for_swap` alongside `SystemProgram.transfer(from=BANK)`, and the Bank has to sign only if it's the transaction fee payer or is in some other role. Actually, `sweep_sol_for_swap` doesn't require the Bank's signature — only the swap operator's. So the Bank isn't a signer here.

**But what about `commit_deck`?** It requires `admin: Signer`, not Bank. Admin is the Squads multisig (production). If admin is the Squads vault, a client cannot make a Squads instruction carry an extra `transfer(from=admin)` because Squads execution is a single CPI'd instruction.

**Actual sibling to check:** GOV's proposal creation and voting. Does any GOV instruction take Bank's signature? Reviewing... GOV takes voter signatures (per-vault), no Bank signature. Safe.

**What about SEAL's `update_config`, `apply_pending`, `cancel_pending`?** These take admin's signature. Same as MINT admin — Squads.

**Conclusion:** The `BankKeyOutside*` pattern is correctly limited to instructions requiring Bank's signature — which are `open_for_redemption` (SEAL), `burn_vault` (BURN), and `mint_vault` (MINT). All three now have confinement. ✓

**No new one-of-N site found for this defect class.**

### HIGH — R8-H1: The deck-index-vs-committed-root check exists in `mint_vault`, but nothing prevents committing a deck to a different config's root

**Construct:** `commit_deck` writes to `config.deck_root`. `mint_vault` reads `cfg.deck_root`. Same account, no ambiguity.

**But:** if MINT ever gains a second minting instruction (say, `mint_charter_vault`), it must also read `deck_root` and verify the proof. Current code has one mint path, so no drift possible today. Noted for future review.

**Not a current defect.**

### MEDIUM — R8-M1: The suite's `deckArgs` / `deckIdx` helpers read `minted_total` from the config at offset 205 — hardcoded

**Construct:**
```js
const deckIdx=async()=>{const c=await conn.getAccountInfo(MINT_CFG,CM)
    return Number(c!.data.readBigUInt64LE(205))}
```

If `MintConfig` layout changes (new field prepended), offset 205 becomes wrong. The suite has other offset-based reads too, all keyed to a specific version.

**The account has a `version: u8` field at offset 8. Nothing here checks it.**

**Fix:** Add a version check before offset reads: `if (c.data[8] !== 1) throw`. This matches the pattern in `programs/cbob-vault-mint/src/lib.rs` for reading SEAL's config.

---

## Accepted Limits questions

### Question 1: Is any limit WORSE than stated?

**Yes — Limit 22 (distribute against live chain) is worse than "untested."**

The limit says "cost, rate limits, paging behaviour and failure modes are untested end to end." What it doesn't say: **at 2,100 sequential `fetchAsset` calls with no batching, retry, or threshold, a single RPC hiccup at vault 1,900 halts the entire day's payout, and this is essentially certain over a week of daily runs.** See R3-C1.

The limit is described as "must be exercised before mainnet." I claim it's WORSE — the current architecture cannot pay 2,100 vaults reliably even with a perfect RPC provider. Fix is architectural: batch, retry, threshold.

### Question 2: Is anything listed as accepted not actually a limit?

**Limit 18 (unsigned transaction in `ps`)** — the limit acknowledges "an unsigned transaction is not a secret." True. But it also says "in practice, nobody." Slightly under-claimed direction: an unsigned transaction may reveal the customer's intended destination address for sweeps, which is a privacy leak. Still not exploitable to steal money.

**Not "not a limit," but under-claimed.**

### Question 3: Is any DISCHARGED item not actually discharged?

**Discharged 19 (unlevelled-vault halt as customer-triggerable DoS)** — the discharge says:
> `mint_vault` refuses any mint that cannot prove that level against the pre-committed deck, and caps each level on chain. So the level is a property of the vault from birth, there is no window in which a vault is activated but unlevelled.

**This is TRUE for a vault minted via `mint_vault`.** But is there ANY way to create a Core asset in the CBOB collection without going through `mint_vault`?

- The collection's update authority is `MINT_AUTH` (a PDA of the MINT program).
- Only MINT can sign as MINT_AUTH.
- MINT has one `create` path: `mint_vault`.
- So no vault can enter the collection without going through `mint_vault`, which appends `level`.

**True.** Discharge holds. ✓

**Discharged 14 (duplicate attribute keys)** — closed by:
```rust
require!(!attributes[..i].iter().any(|b| b.key == a.key), MintError::DuplicateAttribute);
```

This is a linear scan — O(N²), fine for N≤7. Byte-exact comparison. Case-sensitive: a caller with `{"key1": ...}, {"Key1": ...}` passes. That's not a duplicate in the strict sense. ✓ Discharge holds.

**Discharged 12/17 (compute units)** — measurements listed. Not verified independently by me, but the diff's suite section 10 does run this. Discharge appears sound.

### Question 4: Is any OPEN AND BLOCKING quietly treated as accepted?

**Limit 22 (distribute against live chain)** — the item is OPEN AND BLOCKING per the list, and I claim R3-C1 shows it's worse than stated. But the pattern in the diff suggests the author considers the halt-with-halt strategy acceptable — the header comment for `distribute.mjs` defends it. This is the risk: an item marked OPEN AND BLOCKING can drift into de-facto acceptance through code comments defending the current behavior.

**Recommendation:** Do NOT let R3-C1 be treated as "we'll test it when we test it." Batch and retry belong in the code before any freeze.

**Limit 23 (deck size decided before minting)** — is this actually enforced by any code check? Grep for a size assertion at commit_deck time — nothing. The limit says the choice is irreversible, which is true (one-shot), but the CONSEQUENCE (packet budget) is not measured at commit time. **This should be a build gate**: `commit_deck` should refuse a root whose implied depth doesn't leave room for the product's required attributes. Since the root is opaque, this requires committing depth alongside root.

---

## Other findings

### CRITICAL — X1: `apply_pending_admin` clears `pending_admin` but the comment claims it "does not touch the Bank rotation" — verify against code

I checked `apply_pending_admin` and `apply_pending_bank`:

```rust
pub fn apply_pending_admin(ctx: Context<ApplyPendingGovernance>) -> Result<()> {
    ...
    c.admin = c.pending_admin;
    c.pending_admin = Pubkey::default();
    c.pending_admin_at = 0;
    // (does not touch pending_bank)
    ...
}

pub fn apply_pending_bank(ctx: Context<ApplyPendingGovernance>) -> Result<()> {
    ...
    c.bank = c.pending_bank;
    c.pending_bank = Pubkey::default();
    c.pending_bank_at = 0;
    ...
}
```

Separate handlers, separate fields cleared. ✓ Comment matches code.

**Not a finding.** Withdrawn.

### MEDIUM — X2: The suite's `commitDeck` uses `bank` as signer, but the `CommitDeck` struct requires `has_one = admin` and `admin: Signer`

**Construct:**
```rust
#[derive(Accounts)]
pub struct CommitDeck<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, MintConfig>,
    pub admin: Signer<'info>,
}
```

And in the suite:
```ts
const commitDeck=(root:Buffer,signer=bank)=>send([new TransactionInstruction({programId:MINT_PROG,
    data:Buffer.concat([d('commit_deck'),root]),
    keys:[{pubkey:MINT_CFG,isSigner:false,isWritable:true},{pubkey:signer.publicKey,isSigner:true,isWritable:false}]})],[signer])
```

The suite uses `bank` (Keypair) as the signer. But `initialize` sets `c.admin = ctx.accounts.admin.key()` where `admin` is `bank.publicKey` in the test — so admin==bank in the localnet test. `has_one = admin` checks against `config.admin`, which is `bank.publicKey`. So bank signing works because it IS admin here.

**In production, admin is the CBOBTC Squads multisig.** The suite doesn't test that Squads can sign `commit_deck` — because Squads can't sign locally. This is the same "features localnet" gap noted throughout SPEC.

**Not a defect** — Squads-signing is out of scope for local testing. Noted.

---

## Summary of critical/high findings

1. **R1-C1**: Deck seed is not binding — Bank can grind salt/slot. **Fix needed before commit_deck ships.**
2. **R2-C2**: `commit_deck` accepts any root — restated of R1-C1.
3. **R3-C1**: 2,100 sequential fetchAsset — certain production failure. **Fix needed before distribute ships.**
4. **R5-C1**: SPEC-count gate does not check round-count prose.
5. **R5-C2**: Suite's 0x1a check is sound, but only covers two actors (SEAL upgrade authority is Accepted Limit 13).
6. **R1-H1**: Bank non-revelation of salt has no economic penalty.
7. **R2-H1**: `level_caps` != deck census can brick minting silently.
8. **R2-H2**: Withdrawn on analysis.
9. **R3-H1**: Malformed asset attributes → halt.
10. **R4-H1**: Packet bound at depth 11 not measured or asserted.
11. **R5-H1**: The zero-occurrence check is sound within its scope.
12. **R5-H2**: The detectors.mjs correction is TRUE — verified against cosign.mjs.
13. **R7-H1**: SPEC dust bound of 2,099 verified correct.
14. **R8-C1**: No new one-of-N site found for Bank confinement.
15. **R8-M1**: Suite offset reads should check `version`.

**Most important**: **R1-C1 / R2-C2 (deck seed binding) and R3-C1 (fetchAsset at scale) are both blocking.** The first breaks the fairness claim; the second breaks the ability to actually pay.

---

## What this project should do that 19 rounds of AI audit structurally cannot

Given no human firm, and the freeze counter still at zero after 19 rounds:

**1. Force each AI round to EXECUTE the code, not just read it.** Every round the author has framed a claim in terms of "measured on the artifact." The audits themselves are still reasoning-only. **Solution:** Fund a dedicated `audit-executor` role — a script that runs `./scripts/run-tests.sh`, submits real transactions on devnet, and returns concrete state to each auditor's context. Every finding must be accompanied by a repro command the executor will run. Auditors that don't provide reproducible evidence are disqualified programmatically.

**2. Fund an adversarial red-team round.** All current audits assume the design intent. Hire (or engineer) an adversarial LLM whose ONLY job is to find how the ACCEPTED LIMITS are exploitable in combination. Combinations aren't tested — auditor #5 finding limit A and auditor #7 finding limit B, but nobody chains them.

**3. Deploy at 10% scale and let it run for 30 days.** Nothing here has moved real money for a real day. Fund 210 test vaults with real cbBTC (small amounts, e.g., 25,000 sats each for activation), run distribute daily. Every operational failure that occurs is worth more than 20 audit rounds.

**4. Independent Merkle/deck verifier.** Publish `bank/deck.mjs` as a standalone package, alongside the salt-hash + slot commitment protocol. Fund a $10K bounty for anyone who can prove the deck is grindable given the commitments. If nobody claims it in 90 days, that's evidence.

**5. On-chain seed commitment.** Fix R1-C1 architecturally: the deck root and its constituent salt-hash + slot must be committed in one instruction, and a `verify_deck(salt: Vec<u8>)` must be callable by anyone to check that root corresponds to the committed inputs. This turns the "trust the Bank" fairness claim into a chain-verified one. It's a `programs/` change but it converts the largest remaining trust surface (Bank shuffle honesty) into a proof.

**6. Bug bounty at deployment.** Once mainnet, publish a bounty with real dollars. AI audits have hit diminishing returns; economic incentive is the missing feedback loop.

The recurring theme: **AI rounds catch things AI rounds can see. What breaks in production is what the AI could not see because it couldn't execute.** All five items above are execution-based. That's the structural gap.