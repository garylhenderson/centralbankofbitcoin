# R1 — Commitment scheme

## CRITICAL — The program still accepts an arbitrary deck root unrelated to the committed seed

**Construct**

`commit_deck` derives and stores `deck_seed`, but stores the caller-supplied `root` without proving any relationship between them:

```rust
let seed = hashv(&[&salt, &bh]).to_bytes();
c.deck_seed = seed;
c.deck_root = root;
```

The Merkle verifier in `mint_vault` verifies only against `cfg.deck_root`. It never reads `cfg.deck_seed` or proves that the root represents `buildDeck(level_caps, deck_seed)`.

**What the Bank gains**

The Bank can choose every level at every mint index, construct a Merkle tree over that hand-picked sequence, and commit its root while presenting a valid salt. All on-chain mint proofs then succeed. The newly derived seed is decorative from the program's perspective.

No validator collusion, blockhash manipulation, salt grinding, reinitialization, or pause abuse is required.

The claim that an off-seed root is “provably wrong” merely permits detection after the Bank has committed it. It does not prevent minting against it, and the supplied tests do not demonstrate an enforced production gate between detecting the mismatch and opening minting.

**Evidence if correct**

A local-validator test can:

1. Call `commit_seed(H(salt))`.
2. Wait for `deck_slot`.
3. Construct an arbitrary deck that differs from `buildDeck(level_caps, seed)`.
4. Call `commit_deck(arbitrary_root, salt)`.
5. Mint using a proof from the arbitrary tree.

Steps 4 and 5 will succeed. On-chain state will show:

```text
deck_seed = seed derived by the program
deck_root != deckRoot(buildDeck(level_caps, deck_seed))
```

No existing `because()` assertion tests this mismatch.

**Fix**

Do not open minting merely because `deck_root != 0`.

At minimum, add a separate activation state that can be set only after an independently verifiable root/seed check. That is still weaker than prevention if the same Bank controls the verifier.

The robust choices are:

- implement a seed-to-deck construction that can be verified incrementally on-chain;
- commit all leaves/chunks through an on-chain construction process whose final root is program-derived;
- or use a publicly verifiable randomness/allocation mechanism where the root is not supplied by the Bank.

Until then, describe this accurately as an **auditable Bank commitment**, not an enforced fair deck.

---

## CRITICAL — Even an honest seed-derived deck does not prevent the Bank assigning favourable cards to chosen recipients

**Construct**

The public seed reveals the entire deck before the first mint. `mint_vault` uses the program-owned `minted_total` as the card index, but every mint also requires the Bank's signature.

**What the Bank gains**

The Bank cannot change which level appears at index `i`, but it controls which customer's transaction becomes successful mint `i`.

It can:

- delay one customer until a desirable index passes;
- approve an affiliated customer at a Level V index;
- mint its own or affiliated vaults through favourable positions;
- refuse all transactions at unfavourable positions until it chooses a sacrificial recipient.

The commitment prevents changing the sequence, not allocating the known sequence among recipients. This directly contradicts the stated objective that the Bank cannot “hand the good cards to whoever it liked.”

Again, no validator control is required.

**Evidence if correct**

After `commit_deck`, recompute the public deck. Submit two valid mint requests around a known high-level index and have the Bank sign only its preferred recipient's request. The preferred recipient receives that card, with every proof and on-chain cap valid.

On production history, evidence would be a statistically implausible correlation between valuable indices and Bank-associated owners, despite a root perfectly matching the seed.

**Fix**

The recipient must become irrevocably bound to an index before the level for that index is knowable or before the Bank can choose ordering. Examples:

- a permissionless on-chain queue committed before randomness;
- a two-phase mint where the owner reserves an index first and the level is derived from later entropy;
- a batch commitment to recipients followed by later randomness;
- or removal of the Bank's discretionary signature from ordering, replacing it with narrowly enforceable on-chain eligibility.

A public precomputed deck plus a discretionary co-signer cannot provide allocation fairness.

---

## HIGH — An exact future slot can be skipped, permanently bricking minting

**Construct**

```rust
c.deck_slot = now + 32;
```

`blockhash_of_slot` requires an entry for that exact numerical slot. SlotHashes retains hashes for produced slots; it does not guarantee every scheduled slot receives a blockhash entry.

There is no reseed or recovery instruction.

**What an accident or colluding validator gains**

An ordinary skipped slot at `deck_slot` permanently prevents `commit_deck`, even if the Bank submits immediately afterward.

A leader controlling the target slot can at least force the same permanent abort by not producing that slot. Biasing the hash itself would additionally require the leader to possess multiple valid blockhash outcomes and choose among them; that stronger capability should be measured before being claimed. The skip/withhold denial does not require that assumption.

The Bank can also selectively abandon an unfavourable draw. It cannot reroll the same config without an upgrade, but nothing in this program forces it to continue operating, and before a canonical deployment is irrevocably fixed it can select a new program/config deployment.

`paused` does not stop or constrain either commitment instruction. That is not itself a bug—the sale pause is documented as sale-only—but pausing supplies no protection against commitment abandonment.

**Evidence if correct**

On a validator configured to skip the exact target slot:

- `commit_seed` succeeds;
- later slots progress beyond `deck_slot`;
- SlotHashes never contains `deck_slot`;
- every `commit_deck` returns `DeckSlotUnavailable`;
- `deck_root` remains zero forever.

The test suite's wait loop does not force the target slot to be produced; it merely fails if entropy is absent.

**Fix**

Commit to the first produced blockhash at or after a threshold, with an unambiguous bounded selection rule that the Bank cannot choose. For example, use a protocol-provided future entropy source designed for this purpose, or store a future epoch/slot threshold and deterministically select the first available hash after it.

Recovery must not be a discretionary reroll. If recovery is allowed, bind it to the same original salt and a deterministic fallback sequence, with all skipped candidates and the final selection verifiable.

---

## MEDIUM — A colluding target-slot leader receives the salt commitment with enough notice to attempt entropy influence

**Construct**

The salt hash and exact target slot are public 32 slots before the target. At `commit_deck`, the salt is revealed and the target blockhash is mixed into the seed.

**What must be controlled**

To bias rather than merely abort, a cheating Bank must:

1. know the salt—which it does;
2. collaborate with the leader responsible for the target slot or enough validators to influence the accepted target block;
3. have more than one valid candidate target blockhash or parent/fork outcome;
4. evaluate the resulting decks and publish only the preferred valid outcome.

The current code does not prevent this. It prevents the Bank alone from changing the committed salt and target slot after commitment.

Whether a Solana leader can practically generate enough independently valid target blockhash candidates to make this economically useful is a measurement question, not established by this diff.

**Evidence if correct**

On a controlled validator, hold the parent state fixed, produce multiple valid variants of the target slot by varying admissible entries/order/fork publication, and observe distinct SlotHashes values and resulting decks. If only one valid target hash is possible, the bias claim is refuted, while the skip/abort finding above remains.

**Fix**

Use an entropy source whose manipulation cost and bias bounds are documented for Solana, preferably aggregated across multiple future producers rather than one exact leader slot. Publish the measured adversarial model instead of claiming that arithmetic slot selection removes all caller influence.

---

# R2 — `blockhash_of_slot`

## Layout assessment

The parser's stated layout is consistent with Solana's bincode representation of `SlotHashes`:

```text
u64 little-endian vector length
repeated:
    u64 little-endian slot
    [u8; 32] hash
```

The 40-byte stride and little-endian slot/count reads are correct. The parser does not actually depend on newest-first ordering because it scans every entry.

The key pin, minimum length check, count ceiling, claimed-buffer-length check, and all-zero hash rejection fail closed.

## LOW — Duplicate target entries are accepted without checking consistency

**Construct**

The parser returns the first matching slot:

```rust
if slot == want {
    ...
    return Ok(h);
}
```

A malformed buffer containing the same target slot twice with different hashes is treated as valid.

**Gain**

This is not currently an attacker-supplied-account exploit because the account is pinned to the runtime SlotHashes sysvar. It is nevertheless inconsistent with the stated “malformed sysvar fails closed” rule.

**Evidence if correct**

Extract the parser into a unit-testable function and pass a synthetic buffer containing two equal slot numbers and distinct nonzero hashes. It returns the first hash.

**Fix**

Continue scanning after the first match and reject a duplicate target entry, or deserialize through the SDK type and rely on its canonical representation.

---

## MEDIUM — The documented expiry is “512 entries,” not reliably “512 numerical slots”

`SLOT_HASHES_MAX` bounds the encoded entry count. It does not impose a numerical condition such as:

```text
current_slot - deck_slot <= 512
```

Skipped slots mean 512 retained entries need not correspond to exactly 512 numerical slots. More importantly, a skipped target slot is never available at all, as described under R1.

The comments should say “the most recent 512 produced SlotHashes entries,” not promise a precise 512-slot/~3.4-minute window.

---

# R3 — Distribution halt and tombstones

## HIGH — `data[0] !== 1` treats absence and malformed/non-Asset accounts as burns, silently dropping a live holder

**Construct**

```js
const raw = await conn.getAccountInfo(new PublicKey(v), 'confirmed')
tomb = !raw || raw.data.length < 1 || raw.data[0] !== 1
```

The comment says only a tombstone is skipped and “anything else still halts.” The code does the opposite for three cases:

- account absent;
- zero-length data;
- any key byte other than `AssetV1`.

It also does not pin `raw.owner` to Metaplex Core.

Measured fact 9 says a genuine Core burn leaves a surviving Core-owned account at `Key::Uninitialized`. Therefore an absent account is specifically **not** the measured normal burn representation.

**What an accident gains**

If `fetchAsset` fails transiently and the follow-up RPC returns `null` because of node inconsistency, pruning behavior, or an RPC fault, the vault is classified as burned and excluded from the denominator. Other holders are then overpaid and the omitted holder receives nothing.

A malformed Core account or unexpected future Core key variant is likewise silently treated as burned instead of halting.

**Evidence if correct**

Fault-inject the two reads:

1. make `fetchAsset` throw;
2. make `getAccountInfo` return `null`, `{data: Buffer.alloc(0)}`, a System-owned account, or a Core-owned account beginning with a nonzero/non-Asset key other than `Uninitialized`.

The job adds the vault to `burnedSinceIndex`, does not add `unreadableLevels`, and continues allocation without it.

**Fix**

Recognize only the measured tombstone:

```js
const isTombstone =
  raw !== null &&
  raw.owner.equals(CORE) &&
  raw.data.length >= 1 &&
  raw.data[0] === 0 // Key::Uninitialized
```

Everything else must remain unreadable and halt.

Pin any additional tombstone length/layout facts against real Core and add fault-injection tests for absent, wrong-owner, empty, live, and tombstone accounts.

---

## HIGH — The same overbroad tombstone test remains in the payment loop

**Construct**

```js
if (!stillThere || stillThere.data.length < 1 || stillThere.data[0] !== 1) {
    done[v] = { ... skipped: 'vault is no longer a live Core asset' }
}
```

This is the same classification defect at the second site.

**Gain**

A transient `null` immediately before a holder's turn records that holder as deliberately skipped in the durable money ledger. The detector treats a `skipped` row as resolved, so it does not become an unresolved-transfer alert.

That is worse than a temporary halt: it can become a durable nonpayment.

**Evidence if correct**

Inject `null` for one `getAccountInfo` call in the payment loop. The ledger receives:

```json
{
  "sig": null,
  "skipped": "vault is no longer a live Core asset"
}
```

`detectDistribution` excludes it from `unresolved`.

**Fix**

Apply the strict Core-owned `Key::Uninitialized` check at both sites through one shared helper. Any RPC failure, absence, wrong owner, short data, or unknown key must halt before writing a `skipped` verdict.

This is the required R8 one-of-N repair.

---

## Inner catch direction

The inner catch does set `tomb = false`, so a thrown RPC request is not interpreted as a burn. That direction is correct.

It does not fix successful-but-null or successful-but-malformed responses, which are currently interpreted as burns.

## Third halt route

No additional ordinary-customer route to the original unreadable-level halt was established from the supplied code. Remaining routes include:

- RPC or Core-deserializer failure while the raw account remains live;
- malformed/changed asset plugin layout;
- a SEAL upgrade rewriting or corrupting attributes.

Those halt intentionally. The more immediate new defect is the inverse: several unreadable states are now incorrectly skipped instead of halting.

---

# R4 — Guard ordering and unfailable assertions

## `commit_deck` ordering

The current handler ordering is internally coherent:

1. already committed;
2. zero root;
3. seed exists;
4. salt matches;
5. target hash exists;
6. write seed and root.

No write occurs before all checks complete. The root check does not depend on state established later.

One consequence is deliberate but should be understood: before a seed exists, `commit_deck(zero_root, ...)` returns `BadDeckRoot`, not `SeedNotCommitted`. The suite avoids that collision by using a nonzero root for 2.0c.

## No new tautological assertion in this diff was proven

The revised packet assertions are capable of failing:

- `maxAttrs < PROBE_CEILING` detects ceiling exhaustion;
- `at7 > at11 && at11 > at13` detects geometry-insensitive results;
- `at11 >= 2` tests the product requirement.

However, the production-depth label is wrong, discussed under R5.

---

# R5 — New suite arms

## Negative-arm reachability

The pinned negative paths are ordered correctly:

- 2.0c reaches `SeedNotCommitted` because the root is nonzero;
- 2.0d reaches `BadSaltHash` before any successful seed commitment;
- 2.0f reaches `SeedAlreadyCommitted`;
- 2.0i reaches `BadSalt` while `deck_root` is still zero;
- 2.0a reaches `BadDeckRoot` after the seed exists but before the real root is committed;
- 11.9 reaches `DeckAlreadyCommitted` because the one-shot guard is first.

2.0e is a positive arm. 2.0g and 2.0h compare explicit values rather than generic rejection, so the absence of `because()` on them is not a false-pass issue.

## Offsets

The hardcoded offsets are correct for the shown struct, including the Anchor discriminator:

```text
deck_root       529..560
deck_salt_hash  561..592
deck_slot       593..600
deck_seed       601..632
```

Thus:

```ts
OFF_DECK_SLOT = 593
OFF_DECK_SEED = 601
```

are correct.

---

## MEDIUM — The “production depth 11” measurement is not a production 2,100-card proof

**Construct**

The test labels synthetic proof length 11 as production:

```ts
const at11 = await fitAt(11)
rec('11.11a', '...PRODUCTION deck depth of 11...', ...)
```

But:

```text
2^11 = 2048 < 2100
```

A 2,100-leaf Merkle tree requires a maximum proof depth of 12. The Rust comment near `MAX_DECK_PROOF` correctly says:

```rust
/// 2,100 vaults is depth 12
```

The SPEC/table and test use depth 11.

**Gain/cost**

The production packet number “18 attributes” was not measured at the maximum production proof depth. The actual result should be measured at depth 12 and may vary by index because odd nodes are promoted.

The conclusion that the program's seven-attribute limit binds is probably still true because synthetic depth 13 reportedly holds 13 attributes. But the published production measurement is false.

**Evidence if correct**

Run:

```ts
fitAt(12)
```

and build actual proofs for all relevant 2,100 deck indices. At least some proofs will have length 12, and their packet capacity will differ from the published depth-11 value.

**Fix**

Measure:

- minimum, maximum, and distribution of proof lengths for the actual 2,100-card deck;
- packet capacity at the maximum actual proof length;
- the exact production transaction, not only a synthetic proof.

Replace all “2,100 = depth 11” claims with the measured result.

---

## LOW — 2.0h is not independent of the hand-written SlotHashes layout

The Rust program and the test independently hash the selected bytes, but both select entropy using the same assumed raw layout and 40-byte stride.

Therefore 2.0h catches Rust/JavaScript hashing or offset drift, but both implementations could agree on the same wrong interpretation of SlotHashes.

**Evidence**

Mutate both parsers to the same incorrect offset and run them against a correspondingly selected byte slice; the equality can still pass.

**Fix**

Add a third oracle using an SDK deserializer or a validator/RPC query that identifies the canonical hash for the target slot. Compare both raw parsers to that oracle.

---

# R6 — Accepted-limit rewrites and documentation

## MEDIUM — The main SPEC still describes the superseded reveal protocol and the disproven packet measurement

**Construct**

Outside the accepted-limit section, SPEC still says:

```text
sha256(bank_salt) published first, salt revealed at close
```

There is no close-time reveal in the implementation.

It also still says:

```text
Measured at depth 7: seven caller attributes fit, the eighth does not serialize.
```

The rewritten limit 23 explicitly says that measurement was false and that the packet holds 29 at depth 7.

`bank/distribute.mjs` also retains a large header claiming levels are off-chain and the commitment “is not built,” contradicting its own implementation below.

**Gain/cost**

Operators and future engineers are given mutually exclusive protocols in the same artifacts:

- reveal later versus seed published immediately;
- packet binds at seven versus program binds at seven;
- levels off-chain versus levels on-chain.

This is operationally dangerous around a one-shot root. A launch runbook derived from the stale section could wait for a reveal that does not exist or make the deck-size decision from a measurement the suite disproved.

**Evidence if correct**

A repository search finds all three stale claims in the supplied current files. They contradict the later accepted-limit text and current Rust.

**Fix**

Update every protocol description in the same commit:

- SPEC's main level/deck section;
- `bank/distribute.mjs` header;
- any runbook or card using depth 11 or “reveal at close.”

Add source-text gates for the obsolete phrases, because the existing count gates do not cover semantic contradictions.

---

## Limit 1a rewrite

The rewrite is materially correct:

- Bank signature requirements and pubkey confinement are on-chain;
- program allowlist and fee-payer checks remain off-chain;
- the policy can be bypassed by a key holder using another signing tool.

One wording issue remains in accepted limit 3: naming the Bank as an instruction-level `payer` is not what pays transaction priority fees. Transaction priority fees are charged to the transaction fee payer, which is already limit 1a. An instruction-level payer may fund Core/system rent or reallocations, depending on the CPI. The cost description should distinguish those mechanisms.

---

# R7 — Counts and arithmetic

## Floors

The supplied `scripts/run-tests.sh` contains:

```text
MIN_ASSERTIONS = 330
DET_FLOOR      = 439
ALLOC_FLOOR    = 103
MAINNET_FLOOR  = 19
DECK_FLOOR     = 17
```

The four figures quoted in the prompt match the file. The deck suite is an additional 17-assertion floor.

## Census denominators

For 240 vaults:

```text
108×2 + 60×3 + 36×4 + 24×5 + 12×6
= 216 + 180 + 144 + 120 + 72
= 732
```

For 2,100 vaults:

```text
945×2 + 525×3 + 315×4 + 210×5 + 105×6
= 1890 + 1575 + 1260 + 1050 + 630
= 6405
```

The census counts sum to 240 and 2,100 respectively.

## Per-$1,000 figures

At denominator 732:

```text
I    1000×2/732 = 2.73
II   1000×3/732 = 4.10
III  1000×4/732 = 5.46
IV   1000×5/732 = 6.83
V    1000×6/732 = 8.20
```

At denominator 6,405:

```text
I    0.31
II   0.47
III  0.62
IV   0.78
V    0.94
```

## Level shares at 2,100

```text
I    1890/6405 = 29.5%
II   1575/6405 = 24.6%
III  1260/6405 = 19.7%
IV   1050/6405 = 16.4%
V     630/6405 =  9.8%
```

The displayed one-decimal shares sum to 100.0%.

---

# R8 — One-of-N sites

The following incomplete applications remain:

1. **Tombstone classification:** both the level-reading loop and payment loop use the same overbroad `absent || short || key != 1` test. Both must be replaced by one strict helper.
2. **Production proof depth:** Rust correctly says 2,100 requires depth 12, while the tests, accepted-limit measurement, and main SPEC use depth 11.
3. **Commitment documentation:** the accepted-limit section was updated, but the main SPEC and `distribute.mjs` header retain the superseded protocol.
4. **Seed/root verification:** the program derives a seed, but the enforcement site—`mint_vault`—uses only the caller-selected root. The fix reached seed publication but not the money-deciding verification.
5. **Monitoring claim:** the supplied suite proves an honest root can mint but contains no negative arm showing that a root inconsistent with the stored seed is rejected or even blocks mint opening.

---

# Accepted limits — four required questions

## 1. Is any accepted limit worse than stated?

### MEDIUM — Limit 13 omits the customer-facing consequence that promised level upgrades do not exist

The product text says a level “is raised one step at a time by burning $CBOB.” Accepted limit 13 correctly says no shipped instruction can rewrite attributes and the level is immutable in practice.

Those statements cannot both be true. The accepted limit discusses upgrade-authority trust but does not explicitly carry the missing advertised level-up mechanism as a product defect.

**Evidence**

Search all four programs for an instruction that changes the `level` attribute or consumes `$CBOB` for a level increase. None exists. Tests 11.13–11.15 prove immutability instead.

**Fix**

Either remove the level-up promise everywhere or classify implementation of the level-up mechanism as open and blocking. Do not leave it implied as a future SEAL upgrade while describing current levels as permanent and load-bearing.

### Limit 3 is mischaracterized, not necessarily worse

Instruction-level `payer` and transaction fee payer are distinct. Priority fees belong under the fee-payer gap. Rewrite limit 3 around the actual Core/system expenses the approved pair can charge to its payer account.

## 2. Is anything listed as a limit already closed?

No additional accepted item was proven fully closed from the supplied code.

Limit 1a was correctly narrowed: pubkey confinement is already closed on-chain, while allowlisting and fee-payer policy are not.

## 3. Is any discharged item not actually discharged?

### MEDIUM — Compute-unit item 12/17 was measured with cheap padding, not worst-case account-meta density

The confinement walk's cost is proportional to instructions and account metas:

```rust
for ix ...
    for a in ix.accounts ...
```

The measurement padded with System transfers carrying two accounts each. That does not maximize account references per transaction byte. A compact compiled instruction can carry many one-byte account indices, potentially repeated, while the static account keys are reused.

The universal conclusion that “a transaction that fits cannot run out of compute on this path” is therefore stronger than the measurement supports.

**Evidence if correct**

Construct a harmless executable instruction carrying as many repeated non-Bank account metas as fit beside `mint_vault`, land it, and read `computeUnitsConsumed`. Compare it with the 18-transfer case. If duplicate compiled indices are rejected, use the densest valid unique/reused account arrangement and document that runtime constraint.

**Fix**

Reopen the measurement until the suite maximizes:

- top-level instruction count;
- total account-meta count seen through the instructions sysvar;
- account repetitions;
- and transaction bytes,

while still landing successfully. The current result proves one padding shape, not the byte-wall theorem.

Discharged item 14 remains closed by the on-chain duplicate-key rejection.

Discharged item 19's original operator-entry window is closed, but its broad statement should not be used to justify the current tombstone skip logic.

## 4. Is an open-and-blocking item being treated as accepted?

Items 22 and 23 remain explicitly marked open, but both are being rhetorically treated as substantially resolved elsewhere:

- Item 22 is still unperformed and must include real RPC failure/rate-limit behavior at production scale.
- Item 23's decision is described as informed by a “production depth 11” measurement that is not actually production depth.

Neither may leave the blocking section based on the current evidence.

---

# Anything else

## HIGH — The commitment design has no on-chain or atomic launch barrier tying monitoring to mint opening

Even if an off-chain alarm exists outside the supplied detector excerpt, `commit_deck` and `mint_vault` do not require an independent verification receipt. The Bank can commit an arbitrary root and immediately mint against it before a periodic alarm can stop anything.

**Evidence**

Put `commit_deck` and the first `mint_vault` in adjacent transactions, using an off-seed root. Both can land before a 30-minute alarm pass.

**Fix**

A root/seed mismatch must prevent mint execution, not merely produce a later alert. If an external verifier is retained, minting must remain programmatically disabled until an independently controlled verifier authorizes the exact `(config, seed, caps, root)` tuple.

---

# Given that no human firm will ever see this

Nineteen AI rounds are structurally weak at discovering failures that require adversarial timing, production infrastructure, or an independent economic interpretation. Add the following controls outside the existing ship gate:

1. **Public adversarial testnet with a funded bounty.** Deploy the exact release binaries, publish program IDs and threat targets, and pay outsiders for reproducible breaks. Models repeatedly share the same assumptions; financially motivated independent operators do not.
2. **Property-based and state-machine testing.** Generate arbitrary instruction sequences, account mutations, skipped slots, burns between every pair of RPC reads, malformed ledger states, and crash points. Assert conservation of cbBTC, no duplicate payment, and no omitted eligible holder.
3. **RPC fault-injection proxy.** Run every money job through a proxy that injects null accounts, stale reads, endpoint disagreement, 429/500 responses, delayed confirmations, forked confirmations, malformed DAS pages, and reordered state changes. The tombstone defect is exactly the kind ordinary happy-path tests miss.
4. **Shadow production distribution.** Before real payouts, run the full 2,100-vault job against live infrastructure using a nonvaluable test mint and production RPC plans for multiple consecutive days. Reconstruct every expected payout independently and compare.
5. **Independent payout implementation.** Build a small separate calculator in a different language that consumes only chain state and settlement inputs. Compare its census, denominator, per-vault amounts, and exclusions against `distribute.mjs` before signing any batch.
6. **Formal launch ceremony for the deck.** Publicly fix the canonical program IDs, config address, caps, salt commitment, entropy rule, derived seed, full deck, and root. Have multiple independent parties reproduce the root before minting can be enabled. Do not permit replacement deployment after seeing entropy.
7. **Transaction-policy key custody.** The Bank key should be held by infrastructure that signs only after independently executing the policy, not stored as a generally usable JSON key. The plain-keypair/top-level-signature constraint does not require leaving unrestricted key bytes available to an operator process.
8. **Canary limits.** Start with low real-value and daily-transfer ceilings that cannot be raised without an observed waiting period. Do not place the full customer balance behind an off-chain pipeline on its first live day.
9. **Incident drills using real artifacts.** Practice ambiguous transfer recovery, skipped entropy slot, DAS truncation, Core upgrade detection, distributor-key loss, frozen ATA, and a bare burn. Require recorded recovery times and ledger evidence, not tabletop answers.
10. **Machine-readable invariants.** State conservation and fairness properties independently of implementation: root must equal seed-derived deck, recipient must be bound before level is knowable, every eligible live vault appears exactly once, total sent plus dust equals input, and every durable skip requires a measured Core tombstone. Run these invariants against archived production settlements.