# R1 — `bank/deck.mjs`

## HIGH — The commitment does not prevent the Bank from choosing a favorable deck

**Exact construct**

`commit_deck` commits only an arbitrary 32-byte root:

```rust
pub fn commit_deck(ctx: Context<CommitDeck>, root: [u8; 32]) -> Result<()> {
    require!(c.deck_root == [0u8; 32], ...);
    require!(root != [0u8; 32], ...);
    c.deck_root = root;
}
```

Neither the salt commitment, slot number, blockhash, deck length, census, nor seed is recorded or checked on-chain. `bank/deck.mjs` merely documents an external publication procedure.

**Impact**

The Bank can:

1. wait for any blockhash;
2. choose any slot it likes;
3. grind salts until desired indices contain Level V;
4. build and commit that favorable root;
5. claim afterward that some salt commitment and slot had previously been published.

The root proves only that later mint proofs are consistent with the root. It does not prove that the root came from the advertised randomness ceremony.

This is not a SHA-256 break. It is the absence of a binding protocol around the hash.

Even if an external salt commitment really is published, the Bank can grind many salts before publication and select the best commitment unless the protocol specifies a genuinely unpredictable future slot after the commitment becomes immutable. If the slot is not independently timestamped before it occurs, the Bank can choose both inputs after the fact.

**Evidence if correct**

On a fresh deployment:

- choose arbitrary seed inputs after observing a slot;
- build a favorable deck;
- call `commit_deck`;
- mint successfully.

No program account or event will contain the purported `H(bank_salt)`, slot, or blockhash, and no instruction will reject this sequence.

**Fix**

Commit a structured ceremony record before the selected slot:

- `salt_commitment`;
- fixed future slot;
- expected deck length;
- expected census or a hash of a canonical census manifest;
- protocol/version domain tag.

Require the root commitment only after the selected slot, and publish an independently timestamped transaction containing the precommitment. Better, remove Bank-controlled entropy entirely and derive the seed from an external unpredictable beacon plus a precommitted fixed context.

---

## HIGH — A random deck does not randomly assign levels to customers

**Exact construct**

The level is bound to `minted_total`, but the Bank is a mandatory mint signer and learns the entire deck before minting. The customer must also see and sign a transaction containing the level and proof.

**Impact**

The Bank can decide which customer receives each index by:

- delaying or refusing a customer's mint;
- submitting favored customers when a high card is next;
- allowing ordinary customers only when low cards are next;
- ordering several pending mints.

Customers can also decline a disclosed low-level transaction and wait for another buyer to consume that index. Sybils and transaction ordering turn the deck into a queue, not a random assignment to a customer.

`minted_total` prevents a customer from changing the card at the current index. It does not prevent the Bank or customers from choosing who consumes that index.

**Evidence if correct**

Prepare two valid prospective minters while the next two cards differ:

1. submit the favored minter first when the next card is V;
2. submit the other minter afterward;
3. reverse the submission order in a separate run.

Both runs satisfy every proof, but the Level V follows the Bank's ordering decision.

**Fix**

Bind an application or buyer commitment to an index before the level becomes knowable. For example:

- collect immutable buyer commitments first;
- fix their ordering independently of the Bank;
- only then reveal the randomness;
- map committed buyer positions to cards.

A post-randomness Bank co-signature cannot provide fair assignment while the Bank controls ordering.

---

## MEDIUM — Non-revelation makes the randomness claim permanently unverifiable

**Exact construct**

```js
seed = sha256(bank_salt || blockhash)
```

The salt is to be revealed “at close,” but there is no deadline, enforcement, fallback, bond, or holder remedy.

**Impact**

The Bank can commit and use a root, then never reveal the salt. Mint proofs still show consistency with that root, but nobody can establish that the root came from the promised seed.

This converts “publicly verifiable randomness” into an optional claim controlled by the party being verified.

**Evidence if correct**

Complete mints without publishing the salt. All on-chain operations continue to validate, and no instruction or alarm reports the missing reveal.

**Fix**

Require reveal before minting, or use public entropy that needs no secret reveal. If concealment is essential, add:

- an on-chain reveal deadline;
- a meaningful bonded penalty;
- an objective failure state;
- a documented holder remedy.

---

## LOW — The Merkle primitive itself does not show an immediate wrong-index exploit

The leaf binds fixed-width `index_le` and `level` under tag `0x00`; nodes use tag `0x01` and two fixed 32-byte children. A wrong index therefore requires a SHA-256 collision/second preimage. Duplicate logical levels do not create duplicate leaves because the index differs.

Odd-node promotion and variable proof lengths are nonstandard but do not by themselves let a proof for one honest leaf validate at another index. The leaf's index remains in the hash.

The comment saying domain separation prevents a “64-byte leaf” replay is inaccurate: the leaf preimage is six bytes, not 64. The separation still works because the complete tagged input formats differ.

What remains unbound is tree metadata: deck length and census. That causes the R2 defect below rather than a direct SHA-256 attack.

---

## MEDIUM — The JS/Rust differential test covers one generated family, not the whole wire contract

The validator suite proves that proofs produced by the current JS module are accepted by current Rust for the tested decks. It would not detect disagreements on inputs the JS generator never emits, such as:

- malformed or noncanonical proof vectors;
- unusual deck sizes;
- maximum-depth proofs;
- every 2,100-card index;
- future changes in seed encoding that leave Merkle encoding unchanged;
- production tooling that does not import this exact module.

**Evidence if correct**

Introduce a disagreement reachable only at a proof depth or odd-promotion path not encountered by the suite's successful mint index. The existing successful cross-language mint can remain green.

**Fix**

Generate canonical test vectors containing root and proof for every index of representative sizes, especially 2,100, and verify them independently in:

- JS;
- Rust host tests;
- the deployed BPF program.

Also reject or explicitly define noncanonical proof forms if canonicality matters.

# R2 — Level on chain

## HIGH — The on-chain quotas do not enforce the published census or even a full mintable supply

**Exact constructs**

Initialization requires only:

```rust
cap_total <= max_supply
```

It does not require equality. The committed root is not tied to `level_caps`, `max_supply`, or a deck length.

The local suite itself initializes:

```ts
MAX_SUPPLY = 2100
LEVEL_CAPS = [50,20,10,5,5] // sum 90
DECK_CENSUS = [50,20,10,5,5]
```

**Impact**

The Bank can commit a deck that:

- underrepresents a level, starving it while remaining under its cap;
- overrepresents a level, causing minting to halt when that level's quota is reached;
- contains fewer cards than `max_supply`;
- has a census unrelated to the advertised 45/25/15/10/5 schedule.

Caps enforce “no more than.” They do not enforce “exactly this census.”

If an exhausted level appears at the next index, nobody can skip that card because the proof is bound to `minted_total`. Minting halts globally at that index.

**Evidence if correct**

Initialize with:

- `max_supply = 2100`;
- caps summing to 90;
- a 90-card committed root.

The first 90 mints can succeed. Mint 91 has no valid honest proof despite 2,010 units of apparent `max_supply` remaining.

Alternatively, commit a deck with too many Level V entries early. After `level_minted[V]` reaches its cap, the next V card permanently blocks the index.

**Fix**

At minimum require:

```rust
sum(level_caps) == max_supply
```

But that alone cannot prove the committed root has the same census. The deck manifest must be published and checked before commitment, or the commitment scheme must bind a verifiable census. Add a release gate that reconstructs the root from the exact configured caps and exact deck length.

---

## LOW — Caller-supplied attribute aliases do not alter the payout level

The reserved-key and duplicate checks are exact byte comparisons. A caller can add `Level`, Unicode lookalikes, or other visually confusing keys, but `levelFromAttributes` reads exactly lowercase ASCII `level`. Those aliases do not affect payouts.

The program appends exactly one canonical `level`, and the real-Core mint/readback test is evidence that the hand-built current `CreateV2` blob is accepted and decoded as intended.

This remains a UI/provenance ambiguity, not a payout escalation.

---

## LOW — Quota counters appear atomic and cannot be overrun by concurrent transactions

`config` is writable, Solana serializes conflicting writes, and all counter updates are part of the same atomic transaction as the Core CPI. A failed CPI or failed counter update reverts the mint. No quota-overrun path is apparent from instruction ordering.

The substantive failure is starvation/global halt from a mismatched root, not concurrent overrun.

---

## LOW — The confinement loop's early-stop pattern is not currently shown exploitable

`seen_self` only proves the loop reached the current instruction, not that it reached the transaction end. In a valid instructions sysvar, however, indexed loads should succeed for every valid top-level instruction and then fail out-of-range. Account substitution is prevented by the sysvar address constraint.

A regression test should still place a Bank-naming instruction after the mint and verify it is rejected, because that is the exact property trailing coverage is meant to establish.

# R3 — Level at payout

## HIGH — An ordinary owner can transiently reach the supposedly unreachable unlevelled halt

**Exact sequence**

1. DAS lists a vault as live.
2. The owner performs a bare Core `BurnV1` after the list is fetched but before `fetchAsset`.
3. Core leaves the account as a non-AssetV1 tombstone.
4. `fetchAsset` fails, leaving `levels[v]` unset.
5. Core BurnV1 does not sweep the asset-signer PDA or its token account, so its balance may still meet activation.
6. `allocateWeighted` sees an activated vault with no level and refuses the whole distribution.

**Impact**

An ordinary owner can temporarily halt a distribution by timing a bare burn against the DAS/account-read race. The halt clears after DAS marks the asset burnt, but “cannot be reached by an ordinary customer action” is too strong.

No special attribute authority or SEAL upgrade is required.

**Evidence if correct**

On a test RPC with controllable DAS state:

- return the asset as live from `getAssetsByGroup`;
- burn it before `fetchAsset`;
- leave at least 21,000 sats in its PDA-owned ATA;
- run distribution.

Expected evidence: `fetchAsset` reports the tombstone as unreadable and the allocator returns the “activated vault carries no level” refusal.

**Fix**

Use one consistent chain snapshot if the RPC supports it, or explicitly recheck an unreadable asset account and classify Core tombstones as burnt rather than unlevelled. Before halting for a missing level, directly inspect the account key/state and distinguish:

- live AssetV1 with bad/missing level — halt;
- Core burnt tombstone — exclude as burnt, subject to the existing count reconciliation;
- transient RPC failure — retry, then halt.

This does not justify silently excluding a live unlevelled vault.

---

## HIGH — Production-scale I/O is sequential, unbounded by retry policy, and likely to be operationally brittle

**Exact construct**

For each of approximately 2,100 live vaults, the job sequentially performs:

- one `fetchAsset`;
- one `getAccountInfo` for the ATA.

That is roughly 4,200 account calls after DAS enumeration, with no batching, bounded concurrency, retry/backoff, or minimum-context-slot consistency.

**Impact**

Rate limiting or one transient error can make a daily money job take a long time or abort:

- asset errors are accumulated and later halt allocation;
- ATA `getAccountInfo` errors escape immediately and abort the run;
- different reads can observe different slots;
- RPC cost is multiplied by daily full-census execution.

No payment happens before planning, so this is primarily availability rather than partial overpayment. It is nevertheless worse than merely “paging behavior untested”: the code deliberately chooses an O(N) sequential RPC pattern.

**Evidence if correct**

Run against a rate-limited RPC proxy with 2,100 cloned asset accounts. Record:

- total calls and elapsed time;
- HTTP 429 frequency;
- behavior when call 1,900 fails once;
- whether the next run starts from a clean pre-payment state.

**Fix**

Before launch:

- use `getMultipleAccountsInfo` batching for asset and ATA accounts where possible;
- apply bounded concurrency;
- retry transient failures with capped exponential backoff;
- record a minimum context slot or otherwise enforce snapshot consistency;
- distinguish permanent decode failures from transport failures.

This remains part of blocking item 22.

---

## LOW — Weighted arithmetic is internally consistent

The denominators are:

- `108×2 + 60×3 + 36×4 + 24×5 + 12×6 = 732`;
- `945×2 + 525×3 + 315×4 + 210×5 + 105×6 = 6,405`.

Each vault gets:

```text
floor(available × level_weight / denominator)
```

Therefore same-level vaults receive the same amount. Dust is `available - sum(per-vault floors)` and remains in the source account. The bound `dust < activated vault count` is valid, and 2,099 is attained for the stated 2,100 census at `available = 6,404`.

# R4 — Packet bound

## HIGH — The stated 2,100-card depth is wrong, and the test does not measure the claimed boundary

**Exact constructs**

For 2,100 leaves:

```text
2^11 = 2,048 < 2,100
```

Therefore the maximum Merkle path has 12 sibling hashes, not 11. The Rust comment correctly says “2,100 vaults is depth 12,” while the audit target and blocking analysis call it depth 11.

The depth-7 probe contains:

```ts
for (let n=0; n<=7; n++)
```

It never calls `attrFit(8)`. It then asserts only:

```ts
maxAttrs >= 0 && maxAttrs < MAX_ATTRS_BORSH
```

Since the loop cannot produce more than seven, the `< 8` half is true by construction. `11.12` calls the program with eight attributes, but does not prove packet serialization failed and deliberately has no reason assertion. It can reject on the program's `attributes.len() < MAX_ATTRS` bound instead.

**Impact**

The claimed measurement “seven fit and the eighth does not serialize” is unsupported. The real 2,100-card maximum proof adds five hashes over depth 7:

```text
5 × 32 = 160 bytes
```

not four hashes/128 bytes.

Proof lengths also vary under odd-node promotion, so transaction capacity may vary by mint index. A test at one current index is not a worst-case product bound.

**Evidence if correct**

Run `attrFit(8)` and log the actual serialization exception, if any. Then generate every proof for a 2,100-card deck and measure:

- minimum and maximum proof length;
- serialized mint size for every index;
- the actual required production name, URI, and provenance attributes.

The current suite will not fail merely because `attrFit(8)` serializes.

**Fix**

Replace 11.11 with literal expectations derived from the production deck:

- assert maximum proof length is 12;
- find the worst-sized proof over all 2,100 indices;
- build the exact production mint transaction;
- assert the required provenance set serializes;
- assert one additional required-size attribute does not, if that boundary matters.

Do not describe the current depth-7 test as a packet ceiling measurement.

# R5 — Phase 1 changes

## MEDIUM — The stated-count gate still misses stale count phrasings

**Exact construct**

The on-chain regex is:

```js
/(\d+) assertions, real cloned Core/g
```

It does not match phrasings such as:

- `316-assertion suite`;
- `270-assertion suite`;
- `311 assertions` without the exact suffix;
- stale round counts such as “Thirteen AI audit rounds.”

SPEC currently contains several count statements outside these five exact regex forms. The change claims to catch THE SHIP GATE's stale suite and round text, but no regex checks round counts at all.

**Impact**

A customer-facing or certification-facing stale count can remain green as long as it uses a different grammatical form.

**Evidence if correct**

Change `316-assertion suite` to `270-assertion suite` while leaving exact `316 assertions, real cloned Core` occurrences untouched. `bank/selftest.mjs` will continue to pass this block.

**Fix**

Do not scrape prose by five loose number-word regexes. Generate a canonical machine-readable counts block in SPEC from one source, or delimit an explicit metadata block and verify exact fields. If prose counts remain elsewhere, lint all count-bearing patterns, including hyphenated forms and stated round count.

---

## LOW — The deck's internal floor was omitted from the cross-file floor comparison

`run-tests.sh` has:

```sh
DECK_FLOOR=17
```

but `bank/deck.mjs` has:

```js
const FLOOR = 16
```

The deck currently runs 17 assertions, so the outer runner catches deletion under normal certification. Direct `node bank/deck.mjs --selftest` has one assertion of slack, unlike the equality gates in the detector and allocator suites.

The new cross-file gate compares detector and allocator internal floors but not the deck internal floor.

**Evidence if correct**

Delete one deck assertion and run `node bank/deck.mjs --selftest` directly: it can still pass 16/16. The outer runner should reject it against 17.

**Fix**

Make the deck's own floor 17 and compare it mechanically to `DECK_FLOOR`, or remove the duplicated internal constant and use a shared generated value.

---

## LOW — The `0x1a` tests prove unauthorized owner/Bank updates, not general immutability

`NoApprovals` is consistent with a well-formed update reaching Core's authority check. It is not evidence that every actor is unable to update the plugin.

The tests omit the actor that actually holds authority: the SEAL PDA, exercisable by a future SEAL upgrade. Accepted item 13 acknowledges this correctly.

The post-rejection readback proves the failed transactions did not alter the asset, but Solana atomicity already implies that. It does not prove the plugin is immutable under its real authority.

**Fix**

Keep the tests narrowly named as owner and Bank refusal tests. Do not use them as evidence of unconditional immutability. Add an SDK-built update instruction test to avoid hand-built account-layout dependence.

---

## LOW — The corrected foreign-asset comment remains qualified by DAS freshness

`scanPda` does include every non-burnt asset returned by `getAssetsByOwner`, regardless of collection, and fails closed on malformed envelopes and full pages. The capability statement is therefore narrower than the old comment.

However, “fails redemption closed” is conditional on DAS having indexed the nested asset. The adjacent “Also blind to anything DAS has not indexed yet” is load-bearing and must remain part of the stated limit.

# R6 — Another under-claim

## MEDIUM — Accepted limit 1a denies an on-chain confinement that already exists

**Exact text**

Accepted limit 1a says:

> “The program allowlist and the Bank-pubkey confinement are OFF-CHAIN. Nothing in any program bounds what else a redemption transaction contains; `open_for_redemption` scans forward only as far as its matching burn.”

That is false for the supplied code. `open_for_redemption` now scans every top-level instruction and rejects `BankKeyOutsidePair`. `mint_vault` similarly rejects `BankKeyOutsideMint`.

**Impact**

The accepted list understates a real on-chain protection and incorrectly treats a closed part of the round-15 theft as accepted. It can drive unnecessary redesign and misinform buyers about the strength of the 2-of-2.

The remaining limits are narrower:

- the program allowlist remains policy;
- the fee payer is invisible on-chain;
- Bank-as-payer inside the approved redemption pair remains accepted item 3;
- key custody can bypass the off-chain judge but cannot bypass the on-chain pubkey confinement.

**Evidence if correct**

Construct a redemption containing a foreign instruction that names the Bank. Even if signed without `bank/cosign.mjs`, SEAL rejects it with `BankKeyOutsidePair`, as the suite already measures.

**Fix**

Rewrite 1a to remove Bank-pubkey confinement from the accepted limitation. Keep only the parts that remain off-chain or structurally invisible.

# R7 — Counts and arithmetic

## Verified floors from `scripts/run-tests.sh`

- on-chain: **316**
- deck: **17**
- detector: **439**
- allocation: **103**
- live-mainnet: **19**

The opening summary omits the deck count, but the runner contains it.

## Schedule arithmetic

### Census 240

```text
108 + 60 + 36 + 24 + 12 = 240
108×2 + 60×3 + 36×4 + 24×5 + 12×6
= 216 + 180 + 144 + 120 + 72
= 732
```

Per $1,000:

- I: `2000 / 732 = 2.73`
- II: `3000 / 732 = 4.10`
- III: `4000 / 732 = 5.46`
- IV: `5000 / 732 = 6.83`
- V: `6000 / 732 = 8.20`

### Census 2,100

```text
945 + 525 + 315 + 210 + 105 = 2,100
945×2 + 525×3 + 315×4 + 210×5 + 105×6
= 1,890 + 1,575 + 1,260 + 1,050 + 630
= 6,405
```

Per $1,000:

- I: `2000 / 6405 = 0.31`
- II: `3000 / 6405 = 0.47`
- III: `4000 / 6405 = 0.62`
- IV: `5000 / 6405 = 0.78`
- V: `6000 / 6405 = 0.94`

Shares:

- I: `1890 / 6405 = 29.5%`
- II: `1575 / 6405 = 24.6%`
- III: `1260 / 6405 = 19.7%`
- IV: `1050 / 6405 = 16.4%`
- V: `630 / 6405 = 9.8%`

Displayed shares sum to **100.0%**. The underlying exact shares also sum to 100%.

# R8 — One-of-N sites

## MEDIUM — The packet fix was applied to one deck depth and one proof index, not the production family

The suite measures one current proof from a 90-card deck and does not exercise:

- the production 2,100-card deck;
- all proof lengths created by odd promotion;
- the maximum 12-hash path;
- the exact production provenance strings;
- every mint index.

This is the same one-of-N pattern at the input-family level rather than the source-file level.

**Fix**

Enumerate all production indices and assert the worst case, not one representative case.

---

## LOW — Audit coverage parsing can credit array literals that are not actually `TARGETS`

**Exact construct**

```sh
grep -ohE "^[[:space:]]*\['[^']+'" scripts/audit*.ts
```

This matches any line-starting array literal whose first element is a quoted string. It is not scoped to the `TARGETS` declaration or to the array actually used to construct `BUNDLE`.

**Impact**

A path mentioned in an unrelated fixture or array can be counted as delivered even if no auditor received that file.

**Evidence if correct**

Add this outside `TARGETS`:

```ts
['bank/example.mjs', 'fixture only']
```

The coverage script will credit the path.

**Fix**

Have each audit runner emit a machine-readable manifest of files actually concatenated into `BUNDLE`, and make coverage consume those manifests. Do not infer delivered files with source regexes.

---

## LOW — `distribute.mjs` still contains superseded level documentation immediately above the new implementation

The schedule comment still says the level is off-chain, no Core attribute exists, and the commitment is not built. The new implementation below says the opposite. This is a one-of-N documentation repair left in the same file.

**Evidence if correct**

Search `bank/distribute.mjs` for:

- `THE LEVEL LIVES OFF-CHAIN`;
- `no Core attribute`;
- `This is not built`.

All survive above `levelFromAttributes`.

**Fix**

Delete or clearly mark the old block as historical. Do not leave contradictory operational descriptions adjacent to money code.

# Accepted limits review

## 1. Is any accepted limit worse than stated?

### Accepted item 13 is correctly broader than the owner/Bank rewrite tests

The actual Attributes authority is the SEAL PDA. A future SEAL upgrade can add an instruction that signs an Attributes update. The two `0x1a` tests do not constrain that actor. The accepted text recognizes this; it must not be narrowed based on 11.13–11.15.

### Accepted item 7's stall can last until at least the next day's detector evaluation

The external alarm can report an unfinished prior day, but a live process holding `flock` can prevent all future runs indefinitely. The limit is operationally serious but not materially understated beyond what is already written.

## 2. Is an accepted limit already closed or narrower than stated?

Yes: **item 1a is partly closed.**

Bank-pubkey confinement is on-chain in both SEAL and MINT. Only the allowlist, fee payer, key-custody bypass of policy, and approved-pair payer gap remain off-chain or accepted.

Item 9 has already been correctly narrowed from “not detected” to “not continuously detected,” subject to DAS freshness.

## 3. Is any discharged item not actually discharged?

### HIGH — Item 19 is not absolutely discharged as written

The old persistent public activation-before-register attack is closed. But an ordinary owner can transiently recreate the same allocator state by bare-burning after DAS enumeration while the PDA ATA remains activated. The evidence and fix are described under R3.

The discharged statement should be narrowed to:

- no mint-time or activation-time unlevelled window exists;
- a live correctly minted vault cannot lose its level through an ordinary attribute update;
- cross-source races can still transiently present an activated balance for a tombstoned asset.

### MEDIUM — Item 12/17's CU measurement is not a worst-case confinement measurement

The extrapolation uses many two-account System transfers and derives approximately 816.7 CU per padded instruction. The confinement cost is driven by instruction-account entries, not only instruction count.

A compact compiled instruction can repeat the same account index many times, adding approximately one byte per account reference rather than a whole System transfer's wire cost. The current measurement therefore does not establish that byte capacity always binds 25 times before compute for every transaction shape.

**Evidence if correct**

Construct a valid padding instruction with hundreds of repeated account metas, fit it beside `mint_vault`, land it, and compare CU with the existing widest-pad result. Repeat on the SEAL redemption path.

**Fix**

Measure the maximum account-reference density that a 1,232-byte legacy transaction can carry, not only maximum count of System transfer instructions. Until then, discharge the observed padding shape, not the universal CU claim.

### Item 14 is discharged for exact byte-equal duplicate caller keys

The program rejects duplicate caller keys and reserves canonical lowercase `level`. Visual Unicode/case aliases remain possible but do not create multiple payout answers.

## 4. Is an open-and-blocking item being treated as accepted?

Items 22 and 23 remain explicitly labeled blocking, but implementation commentary creates false confidence around item 23:

- the supposed depth-7 boundary does not test eight-attribute serialization;
- 2,100 has maximum depth 12, not 11;
- only one proof index is measured.

Item 23 therefore remains fully blocking and is less measured than its surrounding comments claim.

Item 22 also remains fully blocking. Pure allocator tests and local Core readback do not substitute for a 2,100-vault live or production-faithful RPC exercise.

# Anything else

## MEDIUM — The root commitment event is insufficient for independent reconstruction

`DeckCommitted { root }` does not identify:

- deck format version;
- census;
- deck length;
- salt commitment;
- entropy slot;
- blockhash encoding;
- seed encoding.

Even an honest operator can later create an ambiguous audit record through tooling or documentation drift.

**Fix**

Emit or store a versioned commitment manifest hash and publish the canonical manifest bytes. Include exact encodings and all parameters needed to reproduce the root.

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

The project needs controls that are structurally different from another prose-reading AI round:

1. **Run an adversarial randomness ceremony rehearsal.** Use independent machines to timestamp the salt commitment, select the future slot, reconstruct the deck, and verify every proof. Include deliberate Bank grinding, slot substitution, non-reveal, and customer-order manipulation.

2. **Build a 2,100-vault production-scale shadow deployment.** Use the actual RPC provider and quotas. Execute full distribution discovery, account reads, retries, plan persistence, interruption at vault 1,900, and resume. Record RPC count, latency, cost, and failure classification.

3. **Add state-machine/property tests rather than more hand-selected examples.** Generate arbitrary sequences of mint success/failure, burns during distribution, RPC failures, ledger resumes, and level/census combinations. Assert conservation of cbBTC and that no holder is overpaid or silently omitted.

4. **Differentially test all 2,100 Merkle positions.** Produce a committed vector artifact and verify every leaf/proof through JS, native Rust, and deployed BPF. Measure transaction size for every proof length and the exact production metadata.

5. **Commission an open public bug bounty with executable proofs required.** AI rounds share assumptions and source context. External adversaries bring different tooling and incentives. Require validator transactions or reproducible scripts to control false positives.

6. **Perform incident drills with real operators.** Rehearse Bank-key loss, RPC outage during distribution, non-revealed salt, poisoned ATA, bare burn during planning, and an ambiguous transfer. Measure whether the operator can identify the correct safe action without editing a money ledger by hand.

7. **Publish a machine-verifiable deck manifest and payout verifier.** Customers should be able to independently input a vault address and settlement and verify its index, level, proof, census, denominator, and payment without trusting Bank logs or prose.