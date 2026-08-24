## R1 — `bank/deck.mjs`

### CRITICAL — the committed deck fixes the sequence, not who receives each index

**Construct:** `mint_vault` binds the level proof to `cfg.minted_total`; the Bank is still a required signer on every mint, and the transaction data contains `level` and `deck_proof` before the customer submits/signs.

**What a cheating Bank gains:** it can allocate high cards to favored wallets while every on-chain proof remains valid. The root only proves “index *i* has level *L*”; it does not prove that the Bank assigned index *i* to the next eligible customer fairly.

A cheating Bank can:

1. compute the full deck after it knows salt/blockhash,
2. see the Level V indices,
3. co-sign its own/friends’ mints at those `minted_total` values,
4. co-sign public/throwaway mints for low indices, or simply stall low-card indices.

A sophisticated customer can also refuse to submit a transaction after seeing it contains a low `level`; `minted_total` does not advance unless someone accepts that card. That creates either selective minting or sale stalls at unwanted indices.

**Evidence if this is true:** on-chain, everything still looks valid: every minted vault’s `level` matches the committed root, caps are respected, and all proofs verify. The only evidence would be statistical/off-chain: favored wallets disproportionately occupy high-level deck indices, while the chain has no FIFO queue or rejected-offer record to compare against.

A local test can demonstrate it: build a deck with a known V at index `k`, mint `k` prior vaults to throwaways/public wallets, then mint the favored wallet at index `k`. All current proof/cap checks pass.

**Fix:** the index must be assigned to an on-chain, non-cancellable commitment before the Bank knows or can act on the card. Practical options:

- on-chain FIFO reservation: customer locks payment/eligibility first; reservation number, not successful mint order, receives the deck card;
- commit all eligible buyers before entropy is known, then map deck indices to commitments;
- use a VRF/callback flow where payment/reservation is irrevocable before level reveal.

Without one of these, “no way to game it” is false.

---

### HIGH — the entropy commitment is not enforced by anything on-chain

**Construct:** `commit_deck(ctx, root)` stores only `deck_root`. There is no on-chain `salt_hash`, slot, census, deck length, or reveal state. `bank/deck.mjs` only comments that `sha256(bank_salt)` and slot X are published first.

**What the Bank gains:** unless an external, timestamped publication process is rigorously followed and archived, the Bank can choose the salt/slot/root after seeing outcomes and later claim it was precommitted. It can also publish many salt hashes or choose among slots unless the rules prohibit and record that.

Preimage resistance only helps if there is a real, independently timestamped `sha256(bank_salt)` commitment made before the blockhash is known.

**Evidence if true:** the Mint config account and `DeckCommitted` event contain only the root. A verifier inspecting chain state cannot recover or verify:

- which salt hash was committed,
- when it was committed,
- which slot was named,
- whether the slot was in the future at commitment time,
- whether the root corresponds to the revealed seed.

**Fix:** add an explicit precommit artifact, preferably on-chain:

```text
commit_entropy(salt_hash, slot, level_caps, max_supply, deck_len)
```

called before slot X. Then require a reveal file/transaction after the slot. If on-chain blockhash verification is impractical because old blockhashes expire, publish a signed, immutable, timestamped precommit artifact and make the pre-mint checklist fail without it. Better: use an external VRF/randomness oracle.

---

### MEDIUM — if the Bank never reveals the salt, fairness is unfalsifiable

**Construct:** the protocol depends on later salt reveal, but no code requires reveal before payouts/minting continue.

**What happens:** holders can verify their individual mint proof only if they retain/parse it, but they cannot recompute the whole shuffle or prove the root came from the declared census and entropy. The root becomes a naked commitment to an unknown sequence.

**Evidence if true:** chain shows valid `mint_vault` proofs against `deck_root`, but no salt reveal artifact exists. There is no program state saying “revealed” or “not revealed.”

**Fix:** make reveal a hard operational gate: no distribution, no next sale phase, or no final certification until salt reveal is posted and independently recomputed. If this is only social, say so explicitly.

---

### Merkle construction assessment

I did not find a practical Merkle second-preimage issue in the leaf/node hashing as written:

- leaf input is `0x00 || u32le(index) || level`;
- node input is `0x01 || 32 bytes || 32 bytes`;
- fixed lengths plus different first byte separate the domains;
- duplicate leaves are prevented by including `index`;
- sorted pairs remove direction bits, but replaying a proof at another index changes the leaf hash.

The important gap is not a hash collision; it is metadata/fairness: the verifier does not know deck length/census from the root, and the root does not enforce fair allocation of indices to buyers.

---

## R2 — on-chain level in `programs/cbob-vault-mint/src/lib.rs`

### HIGH — `level_caps`, `max_supply`, and the committed root can disagree permanently

**Constructs:**

```rust
require!(cap_total > 0 && cap_total <= max_supply, MintError::BadLevelCaps);
```

and:

```rust
pub fn commit_deck(ctx, root: [u8; 32])
```

which stores only a root, with no deck length or census.

**What goes wrong:** the program allows `sum(level_caps) < max_supply`, and the root is not tied to either `level_caps` or `max_supply`. If the committed deck and caps do not exactly match, minting can halt forever at some index even though `max_supply` is not reached.

The test suite itself initializes with `MAX_SUPPLY = 2100` and test caps summing to 90, proving the program accepts this shape.

**Evidence if true:**

- initialize with `max_supply = 2100`, `level_caps = [50,20,10,5,5]` succeeds;
- after those 90 cards, further mints fail `LevelCapReached` before `SupplyCapReached`;
- or commit a root for a shorter deck and observe later indices fail `BadDeckProof`;
- no on-chain state explains “deck length is only N.”

**Fix:**

- in production builds, require `sum(level_caps) == max_supply`;
- store `deck_len` and declared census with the root;
- make the deck-generation script derive census from the on-chain caps, not from a hand-entered second copy;
- add a pre-commit test that builds the real production deck and proves every index `0..max_supply-1`.

The chain cannot cheaply prove the root’s full census, but the system can at least prevent obvious cap/supply mismatch and make the generation artifact auditable.

---

### Attribute-reservation assessment

The exact `level` key is reserved and appended once. A caller cannot get an arbitrary paid level merely by passing caller attributes:

- `a.key != "level"` rejects exact key;
- duplicates of caller keys are rejected;
- the program writes the Core Attributes count as `attributes.len() + 1`;
- payout reads exactly one exact key `level`.

Case variants, unicode homoglyphs, and empty-ish lookalikes are not money-relevant because `distribute.mjs` reads only exact ASCII `level`. They may be ugly provenance keys, but they do not override the payout level.

---

## R3 — payout level in `bank/distribute.mjs`

### MEDIUM — discharged item 19 is narrower than stated if a holder bare-burns their own vault

**Constructs:**

- `distribute.mjs` fetches the live list from DAS;
- then reads each live asset with `fetchAsset`;
- then `allocateWeighted` refuses if an activated vault has no level.

**Reachable path:** an owner can call Core `BurnV1` directly; that is already a measured impossibility to prevent. Core leaves the asset-signer PDA and token accounts behind. If DAS still reports the asset as live for one pass, `fetchAsset` can fail because the asset account is now a Core tombstone/uninitialized, while the PDA’s cbBTC ATA can still hold ≥21,000 sats. That creates an activated-but-unreadable-level vault and halts the distribution.

This is not the old `levels.json` window, but it is an ordinary owner action if “ordinary” includes burning their own vault.

**Evidence if true:**

1. mint and fund a vault;
2. owner submits a bare Core `BurnV1`;
3. asset account no longer decodes as `AssetV1`;
4. asset-signer ATA still holds cbBTC;
5. if DAS live list still includes it, `unreadableLevels` records it and `allocateWeighted` refuses.

**Fix:** before treating “no readable level” as a distribution-wide data corruption, distinguish a Core tombstone from an RPC read failure:

- if `getAccountInfo(v)` shows the asset is no longer live, exclude it as burned/skipped and raise the existing burn alarm path;
- if the account is live but Core deserialization/attributes are invalid, halt;
- if RPC failed, halt as today.

---

### Arithmetic assessment

The weighted allocator arithmetic is internally consistent:

- weights: I/II/III/IV/V = 2/3/4/5/6;
- 240 census denominator: `108*2 + 60*3 + 36*4 + 24*5 + 12*6 = 732`;
- 2,100 census denominator: `945*2 + 525*3 + 315*4 + 210*5 + 105*6 = 6,405`;
- same-level vaults receive exactly the same amount because amount depends only on weight and denominator;
- dust carries via `available - total`; it is not redistributed by largest remainder.

I did not find a payout arithmetic error.

---

## R4 — packet bound / transaction size

### HIGH — the suite does not actually assert the real production packet budget

**Constructs in `tests/3prog.test.ts`:**

```ts
for(let n=0;n<=7;n++){ if(await attrFit(n)) maxAttrs=n; else break }
...
const oneMore=await att(()=>mkVault(... length:maxAttrs+1 ...))
```

**Problems:**

1. The serialization probe never tries 8 attributes. It stops at `n <= 7`, so it cannot prove “the eighth does not serialize.”
2. `11.12` sends a real mint with `maxAttrs + 1`; if `maxAttrs` is 7, that is 8 caller attributes, which the program rejects via `TooManyAttributes`. That does not prove a packet-size failure.
3. The real 2,100-vault tree has worst-case proof length 12, not 11. Layer sizes for 2,100 are:

```text
2100 -> 1050 -> 525 -> 263 -> 132 -> 66 -> 33 -> 17 -> 9 -> 5 -> 3 -> 2 -> 1
```

An index near the front has a sibling at every layer: 12 proof nodes.

4. Proof length varies under the odd-node promotion rule. Measuring only `deckProof(DECK, await deckIdx()).length` does not measure the worst-case index.

**Budget re-derivation from the measured suite numbers:**

The suite reports a plain mint around 890 bytes at test depth 7. A worst-case production proof at depth 12 adds five extra 32-byte siblings, about 160 bytes, giving roughly 1,050 bytes before caller provenance attributes. That leaves about 182 bytes under the 1,232-byte packet limit.

Short product provenance such as `notice`/`charter` likely fits. Seven tiny `kN="v"` attributes likely fit. Seven max-size 128-byte key/value attributes will not. But this must be measured, not inferred.

**Evidence if true:**

- modify `attrFit` to try `n <= 8`;
- inspect `oneMore.err`; it should show program rejection, not necessarily transaction serialization failure;
- build a 2,100-card deck and serialize mints for the worst proof index with the exact production provenance attributes.

**Fix:**

Add a release-blocking test:

```ts
const realDeck = buildDeck([945,525,315,210,105], seed)
const worst = maxByIndex(i => deckProof(realDeck, i).length)
assert(worst.proof.length === 12)
serializeMintWith(realProductionAttributes, worst.proof)
assert(bytes <= 1232)
assert(productRequiredAttrCount <= measuredBudget)
```

Also assert the measured byte count, not just “some count below 8.”

---

## R5 — Phase 1’s own changes

### MEDIUM — the stated-count gate still misses stale count statements

**Construct:** `bank/selftest.mjs` checks these regexes:

```js
'on-chain':   /(\d+) assertions, real cloned Core/g,
'detector':   /(\d+) detector\b/g,
'allocation': /(\d+) allocation\b/g,
'deck':       /(\d+) deck\b/g,
'mainnet':    /(\d+) live-mainnet\b/g,
```

**What it misses in the bundled `SPEC.md`:**

- `bank/selftest.mjs` is still described as “(69 assertions)” in the Bank alarm section, while the real detector floor is 439.
- the top of SPEC still says “Thirteen AI audit rounds…” while the document elsewhere talks about nineteen.

Those statements are not caught because they do not match the five narrow floor phrasings.

**Evidence if true:** grep the bundled SPEC for `69 assertions` and `Thirteen AI audit rounds`; the selftest regexes do not match either.

**Fix:**

- remove all duplicate assertion-count prose except the canonical Running Tests block; or
- make the gate parse all numeric assertion claims near `bank/selftest.mjs`, `bank/distribute.mjs`, `tests/3prog.test.ts`, and `bank/deck.mjs`;
- add a round-count gate or remove round counts from prose entirely.

---

### LOW — `bank/deck.mjs` has its own stale floor

**Construct:**

- `scripts/run-tests.sh`: `DECK_FLOOR=17`
- `bank/deck.mjs`: `const FLOOR = 16`

The deck selftest currently runs 17 assertions, but its direct selftest floor permits 16.

**What it gains/costs:** if someone runs `node bank/deck.mjs --selftest` directly, one deck assertion can disappear and the file still exits 0. The full runner catches it, but the file’s own floor is stale.

**Evidence:** delete one deck assertion and run `node bank/deck.mjs --selftest`; the internal floor will not fail until the count drops below 16.

**Fix:** set `FLOOR = 17` in `bank/deck.mjs` and extend `bank/selftest.mjs`’s floor cross-check to include the deck selftest’s own floor.

---

### Assessment of 11.13/11.14 level-rewrite tests

Those tests prove a narrow property: the owner and the Bank cannot rewrite the Attributes plugin through the hand-built Core `UpdatePluginV1` instruction, and the level remains afterward. The `0x1a` check is useful because it means the instruction reached Core’s approval/authority logic rather than failing deserialization.

They do **not** prove universal immutability. Actors not covered include:

- the SEAL PDA if the SEAL program is upgraded to sign an attribute update;
- the MINT/SEAL upgrade authorities;
- any future shipped instruction that signs as the plugin authority.

That is mostly aligned with accepted limit 13, but the suite-arm names should not be read as proving more than owner+Bank refusal.

---

### Assessment of the corrected foreign-nested-asset comment

The corrected comment is accurate as far as the shown code goes: `bank/cosign.mjs` calls DAS `getAssetsByOwner` on the asset-signer PDA, accepts assets regardless of collection, fails closed on malformed DAS responses, and refuses full pages. The remaining gap is timing/DAS freshness and lack of continuous warning, not capability at redemption time.

---

## R6 — under-claim direction

### MEDIUM — accepted limit 1a underclaims an on-chain control that now exists

**Construct:** SPEC’s accepted limit 1a says:

> “The program allowlist and the Bank-pubkey confinement are OFF-CHAIN. Nothing in any program bounds what else a redemption transaction contains; `open_for_redemption` scans forward only as far as its matching burn.”

That is false for the current code. SEAL’s `open_for_redemption` now scans from instruction 0 through the whole transaction and refuses `BankKeyOutsidePair`; MINT’s `mint_vault` refuses `BankKeyOutsideMint`.

**What this costs:** it tells readers the system is weaker than it is, and invites duplicate controls or wrong operational decisions. It also contradicts the control table in the same SPEC.

**Evidence:** in SEAL, the loop starts at `i = 0`, does not break at the burn, and rejects the Bank key outside open/burn. In MINT, the loop rejects the Bank key outside the `bank` slot of `mint_vault`. Suite assertions 4.7 and 9d.1 exercise those paths.

**Fix:** split accepted limit 1a:

- still accepted/off-chain: program allowlist, fee payer, and Bank custody/policy;
- no longer accepted/off-chain: Bank pubkey confinement for SEAL/MINT.

---

## R7 — counts and schedule arithmetic

### Floors from `scripts/run-tests.sh`

The quoted floors match the file:

```text
MIN_ASSERTIONS = 316
DECK_FLOOR    = 17
DET_FLOOR     = 439
ALLOC_FLOOR   = 103
MAINNET_FLOOR = 19
```

The prompt’s top summary omitted the 17 deck assertions, but SPEC’s Running Tests block includes them.

### Schedule arithmetic

I re-derived the published figures:

```text
240 census:
108/60/36/24/12
denominator = 108*2 + 60*3 + 36*4 + 24*5 + 12*6 = 732

2,100 census:
945/525/315/210/105
denominator = 945*2 + 525*3 + 315*4 + 210*5 + 105*6 = 6,405
```

Per $1,000:

```text
240 vaults:
I   1000*2/732 = 2.73
II  1000*3/732 = 4.10
III 1000*4/732 = 5.46
IV  1000*5/732 = 6.83
V   1000*6/732 = 8.20

2,100 vaults:
I   1000*2/6405 = 0.31
II  1000*3/6405 = 0.47
III 1000*4/6405 = 0.62
IV  1000*5/6405 = 0.78
V   1000*6/6405 = 0.94
```

2,100-vault level shares:

```text
I   945*2 / 6405 = 29.5%
II  525*3 / 6405 = 24.6%
III 315*4 / 6405 = 19.7%
IV  210*5 / 6405 = 16.4%
V   105*6 / 6405 = 9.8%
sum = 100.0%
```

I did not find an arithmetic error in the schedule card figures.

---

## R8 — one-of-N-sites

### MEDIUM — the new money-oracle config fields are not in the alarm watch list

**Construct:** `MintConfig` gained:

```rust
level_caps
level_minted
deck_root
```

but `bank/detectors.mjs`’s `WATCH` / `WATCHED_KEYS` do not include `mint.level_caps`, `mint.level_minted`, or `mint.deck_root`.

**What is lost:** the alarm claims to watch config drift and standing risks, but the root and caps that now decide payout weights are invisible to it. A wrong committed root, zero root after supposed launch, or bad caps can be missed except indirectly when minting fails.

`level_minted` changes on every mint, so it may not belong in the same CRITICAL drift category, but `deck_root` and `level_caps` are load-bearing configuration and should be read.

**Evidence:** grep the provided `bank/detectors.mjs` for `deck_root`, `level_caps`, and `level_minted`; they are absent from `WATCH` and `WATCHED_KEYS`.

**Fix:**

- extend the config reader to parse the appended fields by pinned offsets or proper Borsh;
- add `mint.deck_root` and `mint.level_caps` to `WATCH`;
- add standing risks:
  - deck root is zero after minting is opened;
  - cap sum differs from declared `max_supply`;
  - caps differ from the published census;
- decide whether `level_minted` should be informational drift or compared to on-chain `minted_total`.

---

### LOW — SPEC’s MINT API summary is stale

**Construct:** SPEC still summarizes:

```text
initialize(collection, bank, governance, treasury, max_supply)
mint_vault(name, uri, max_price_lamports, attributes)
```

The implementation now requires `level_caps` at initialize and `level, deck_proof` at mint.

**Cost:** integrators reading the SPEC can build the wrong client interface for the most important changed path.

**Evidence:** compare the SPEC MINT bullet list to the Rust function signatures in `programs/cbob-vault-mint/src/lib.rs`.

**Fix:** update the SPEC API bullets or remove argument lists and point to generated IDL.

---

# Accepted limits — four requested checks

## 1. Is any accepted limit worse than stated?

Yes.

- **Limit 19** is closed for the original `levels.json` activation window, but the statement “not reachable by an ordinary customer action” is too broad if a holder bare-burns their own vault and DAS lags. That can create a live-listed, activated, unreadable-level vault until indexing catches up. This is not the same old bug, but the residual should be documented.
- **Limits 22 and 23** are open/blocking but have no mechanical release gate. See item 4 below.

## 2. Is anything listed as accepted not actually a limit?

Yes.

- **Accepted limit 1a is partly obsolete.** Bank-pubkey confinement is no longer off-chain for SEAL/MINT. What remains off-chain is the program allowlist, fee-payer policy, and key custody/policy.

Limit 9 is already narrowed correctly in the text.

## 3. Is any discharged item not actually discharged?

- **12/17 compute units:** still appears discharged. A real 2,100-deck proof increases bytes and reduces padding room, so CU pressure should be lower, not higher.
- **14 duplicate attribute keys:** discharged on-chain for caller attributes.
- **19 unlevelled-vault halt:** discharged for the original `levels.json` race, but the residual bare-burn/DAS-lag path should be separately documented. I would not call the original item reopened, but the wording is too absolute.

## 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

Yes.

- **22 live-chain distribution:** `cron-install.sh` installs `distribute.mjs` live by default unless `--dry-run` is preserved. There is no flag file or code gate requiring the live-scale exercise before real payouts.
- **23 deck-size/packet budget:** `commit_deck` accepts a naked root. There is no precommit gate proving the production deck size, worst-case proof, and actual provenance attributes fit before the irreversible root is committed.

**Fix:** add explicit readiness gates:

```text
.distribution-live-drill-passed
.deck-packet-budget-passed
```

or equivalent signed artifacts, and refuse live cron/mint opening without them.

---

# Anything else

No additional customer-card arithmetic error found. The main risks in this diff are not arithmetic; they are fairness/allocation, missing metadata gates, and tests that do not measure the production shape they claim to measure.

---

# Given no human firm will ever see this

Do not try to replace a human firm with more prose. Add mechanisms that produce falsifiable artifacts:

1. **Public deck ceremony artifact:** signed salt-hash/slot/census precommit, committed root, revealed salt, recomputed deck, and script output. Publish it before minting.
2. **FIFO mint reservation dry run:** run a local adversarial simulation where the Bank tries to reserve all V cards for itself. The protocol should fail that attack mechanically, not socially.
3. **Production-scale distribution rehearsal:** fork/mainnet-read against the real RPC provider over ~2,100 mocked/real vault accounts, record wall-clock time, RPC errors, retry behavior, and cost.
4. **Packet-budget artifact:** a generated report for the real deck and real provenance fields: worst proof index, serialized bytes, remaining headroom.
5. **Chaos tests for RPC/DAS failure:** inject failure at vault 1,900 of 2,100 and prove the ledger state, exit code, and alert are exactly as intended.
6. **Independent verifier script for holders:** given vault mint, index, level, proof, root, salt, slot, and census, it verifies the level. If a holder cannot run it, the fairness claim is not public.
7. **Key-custody runbook test:** before mainnet, rehearse “Bank key lost,” “Bank key suspected compromised,” and “swap operator compromised” with actual rotation transactions on a validator.
8. **Bug bounty before funds:** after freeze, publish the exact commit and pay for breakage reports. AI rounds are not a substitute for adversarial economic incentive.