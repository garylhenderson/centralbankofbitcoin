

## R1 — THE COMMITMENT SCHEME

What a cheating Bank must control, stated precisely:

1. **To bias the seed itself**: it must control `config.admin` (the signer of `commit_seed` / `commit_deck`) **and** either the leader of slot `deck_slot` or a validator/leader it can bribe/coerce. The program fixes the slot as `commit_seed_slot + 32`, but the leader schedule is public, and 32 slots is enough notice to target a colluding leader. A Bank that is only the Bank key cannot call these instructions.
2. **To bias allocation of an honest deck**: it only needs control of the **Bank co-signature pipeline / mint ordering**. `mint_vault` requires the Bank signature and uses `minted_total` as the deck index. Once the seed is public, the deck is public. The Bank can therefore reserve high-level indices for favoured minters.
3. **To bypass the entropy entirely**: it must control `config.admin` (or the upgrade authority). `commit_deck` stores `root` without verifying that `root` is the Merkle root of the deck derived from `deck_seed`. A malicious root can be committed after the seed is known.

Nothing in this diff stops (2). Nothing on-chain stops (3); the only mitigation claimed is off-chain verification, and that verification is not present in the supplied alarm/selftest code (see R8-1).

### R1-1 — CRITICAL — `deck_root` is not bound to `deck_seed`; the “publicly verifiable” property is not enforced anywhere in the shipped pipeline

**Exact construct**

`programs/cbob-vault-mint/src/lib.rs`, `commit_deck`:

```rust
let bh = blockhash_of_slot(&ctx.accounts.slot_hashes, want)?;
let c = &mut ctx.accounts.config;
let seed = hashv(&[&salt, &bh]).to_bytes();
c.deck_seed = seed;
c.deck_root = root;
```

There is no check that `root` is the Merkle root of the deck produced by `buildDeck(level_caps, seed)`.

`mint_vault` then enforces only:

```rust
require!(cfg.deck_root != [0u8; 32], MintError::DeckNotCommitted);
...
require!(
    deck_root_from(deck_leaf(deck_index, level), &deck_proof) == cfg.deck_root,
    MintError::BadDeckProof
);
```

It never uses `cfg.deck_seed`.

**What an attacker or accident gains**

An admin/Bank coalition can:

- commit a salt hash,
- wait for the entropy slot,
- compute the public seed,
- then commit **any Merkle root** for a deck with the same level caps but arranged so that favoured mint indices receive Level IV/V,
- use the Bank’s control of mint co-signature/ordering to give those indices to chosen customers.

The on-chain quota still bounds how many Level V exist, but not who receives them. The stated property “no way to game it” is not enforced.

**Evidence that would exist if this is right**

- On-chain config after `commit_deck` would contain a non-zero `deck_seed` and a non-zero `deck_root`.
- Any independent verifier recomputing `deckRoot(buildDeck(level_caps, deck_seed))` would get a different root.
- A local-validator test can commit a root for a custom deck not derived from the stored seed and still mint successfully with proofs for that custom deck.

**Fix**

Short of rebuilding the whole deck in BPF:

- Do not allow minting to open until multiple independent verifiers attest `deck_root == deckRoot(buildDeck(level_caps, deck_seed))`.
- Add this check to `bank/selftest.mjs`, the alarm, the Bank co-signer policy for mints, and `bank/distribute.mjs` before paying.
- Longer term, move level assignment to a mechanism that does not depend on an unverified root, or verify the deck on-chain (even if expensive) before mainnet money.

If this is not fixed, it must be written as a buyer-facing accepted limit, not treated as closed by the seed publication.

---

### R1-2 — HIGH — Bank-ordering favoritism remains even if the root is honest

**Exact construct**

`mint_vault`:

```rust
require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, MintError::NotTheBank);
...
let deck_index: u32 = u32::try_from(cfg.minted_total)...
```

The deck index is the global mint counter. The Bank must co-sign every mint. After `commit_deck`, `deck_seed` is public, so the deck order is public.

**What an attacker or accident gains**

A Bank that controls signing order can:

- delay or refuse customers approaching high-level indices,
- co-sign favoured customers exactly when `minted_total` is at a high-level index.

This does not require a malicious root, a malicious admin, or validator collusion. It only requires discretionary control over which mint transactions are co-signed and when.

**Evidence**

- `mint_vault` requires `bank: Signer`.
- There is no queue, commit-reveal, or per-minter index assignment.
- The suite itself reads `minted_total` to know the next deck card; the Bank can do the same.

**Fix**

Either:

- remove the Bank signature from the mint path during an open round and make minting permissionless, or
- redesign minting as a two-phase commit/reveal after the round closes so that index assignment is not controlled by transaction ordering.

If the business keeps Bank-controlled mint ordering, write this explicitly as an accepted buyer-facing limit: “The Bank can influence which mint index a customer receives.”

---

### R1-3 — HIGH — `mint_vault` does not require `deck_seed` to be non-zero

**Exact construct**

`mint_vault` checks only:

```rust
require!(cfg.deck_root != [0u8; 32], MintError::DeckNotCommitted);
```

It does not check:

```rust
cfg.deck_seed != [0u8; 32]
cfg.deck_salt_hash != [0u8; 32]
```

**What an attacker or accident gains**

If a config is migrated from an older program version where `deck_root` was already set but the new fields are zero, or if an upgrade authority manually writes a root without a seed, minting can proceed with **no public seed at all**. The entire round-20 property is silently absent while the program still says a deck is committed.

**Evidence**

- The new fields are appended in padding and default to zero on old accounts.
- `mint_vault` contains no seed/salt-hash check.
- A config with `deck_root != 0`, `deck_seed == 0` would pass the current mint gate.

**Fix**

In `mint_vault`, require:

```rust
require!(cfg.deck_seed != [0u8; 32], MintError::SeedNotCommitted);
require!(cfg.deck_salt_hash != [0u8; 32], MintError::SeedNotCommitted);
```

Also add a suite arm that mints against a root-only config and expects rejection.

---

### R1-4 — MEDIUM — `commit_seed` can be timed against the leader schedule; a colluding leader with 32 slots’ notice is not prevented

**Exact construct**

`commit_seed`:

```rust
let now = Clock::get()?.slot;
...
c.deck_slot = now.checked_add(DECK_SLOT_LEAD)...
```

The caller does not choose the slot, but the caller chooses **when** to submit, can retry dropped transactions, and can observe the leader schedule.

**What an attacker gains**

An admin/Bank that can bribe or be the leader at slot `deck_slot` may influence the blockhash. The scheme reduces predictability but does not make the entropy unbiased under validator collusion.

**Evidence**

- Leader schedule is public for the epoch.
- `DECK_SLOT_LEAD = 32` is about 13 seconds.
- A failed `commit_seed` can be resubmitted; only a successful one is one-shot.

**Fix**

If this is accepted, state it. If not, consider mixing several future blockhashes, a longer lead, or a verifiable delay function / external randomness beacon. At minimum, require a multisig/timelock around `commit_seed` so the timing choice is public.

---

### R1-5 — MEDIUM — abandoning a bad draw bricks the config; the only escape is program upgrade

**Exact construct**

`commit_seed` is one-shot on `deck_salt_hash`. `commit_deck` is one-shot on `deck_root`. There is no instruction to clear `deck_salt_hash`, `deck_slot`, or `deck_root`.

If the entropy slot is missed, or the draw is unfavourable, the admin can simply refuse to call `commit_deck`. Minting then never opens for this config.

**What an attacker or accident gains**

A permanent availability failure from one missed 3.4-minute window or one malicious admin decision. Recovery requires upgrading/replacing the program, which is itself a trust event.

**Evidence**

- No re-seed instruction exists.
- `commit_seed` refuses if `deck_salt_hash != [0;32]`.
- `commit_deck` refuses if `deck_root != [0;32]`.
- `blockhash_of_slot` returns `DeckSlotUnavailable` once the slot ages out.

**Fix**

Either accept this explicitly as a blocking operational limit, or add a heavily gated emergency reseed instruction requiring admin + governance + timelock, usable only while `minted_total == 0` and no deck root is committed.

---

### R1-6 — MEDIUM — `commit_seed` does not require `deck_root == [0;32]`

**Exact construct**

`commit_seed` checks only:

```rust
require!(c.deck_salt_hash == [0u8; 32], MintError::SeedAlreadyCommitted);
```

It does not check that no deck root has already been committed.

**What an accident gains**

In a migrated or corrupted state where `deck_root` is already non-zero but `deck_salt_hash` is zero, `commit_seed` can still run. `commit_deck` will then refuse, but minting may already be possible against the old root with no seed (see R1-3).

**Fix**

Add:

```rust
require!(c.deck_root == [0u8; 32], MintError::DeckAlreadyCommitted);
```

in `commit_seed`.

---

## R2 — `blockhash_of_slot`

### Layout and failure direction

The parse matches the expected SlotHashes layout:

- `u64` little-endian count at offset 0.
- `count` entries of 40 bytes: `u64 slot` LE + 32-byte hash.
- Bound `count <= 512`.
- Buffer length check `8 + count * 40`.
- All-zero hash rejected.
- Missing slot returns `DeckSlotUnavailable`.

Truncation, zero count, malformed count, and absent slot all fail closed. Duplicate slots return the first match; if the first match has an all-zero hash, it returns `BadSlotHashes` rather than continuing. That is fail-closed.

### R2-1 — MEDIUM — the 512-slot window is enforced only by absence, and failure is permanent

**Exact construct**

There is no explicit check like `current_slot <= deck_slot + 512`. The code relies on the slot being absent from SlotHashes. Once absent, `commit_deck` fails forever because `deck_salt_hash` is already set and there is no reseed.

**What an accident gains**

A missed window permanently prevents minting on this program instance.

**Evidence**

- `blockhash_of_slot` returns `DeckSlotUnavailable` on miss.
- No instruction clears `deck_salt_hash` or `deck_slot`.

**Fix**

Same as R1-5: document as blocking operational risk or add a gated reseed path before any mint.

---

### R2-2 — LOW — hardcoded `SLOT_HASHES_MAX = 512` fails closed against future sysvar changes

**Exact construct**

```rust
require!(n <= SLOT_HASHES_MAX, MintError::BadSlotHashes);
```

If the cluster ever exposes more than 512 entries, this instruction will refuse even valid slots.

**What an accident gains**

A liveness failure after a cluster/sysvar change.

**Evidence**

The bound is a constant, not derived from the account or runtime.

**Fix**

Accept it as fail-closed, but add a mainnet probe/assertion that the live SlotHashes count is still ≤ 512 before committing the deck.

---

### R2-3 — LOW — no suite arm exercises `BadSlotHashes` or `DeckSlotUnavailable`

**Exact construct**

The suite only exercises the happy path where the sysvar contains the slot. There is no negative test passing a wrong account, malformed data, or an aged-out slot.

**What this costs**

The defensive parse is unproven by execution in the shipped suite.

**Evidence**

`tests/3prog.test.ts` section 2.0 does not include a wrong `slot_hashes` account or an expired-slot arm.

**Fix**

Add at least:

- `commit_deck` with a non-sysvar account passed as `slot_hashes`, expecting `BadSlotHashes`.
- a synthetic/unit test for `blockhash_of_slot` over malformed buffers.

---

## R3 — `bank/distribute.mjs`

### R3-1 — HIGH — tombstone test is overbroad: absent accounts and any `data[0] !== 1` are treated as burned

**Exact construct**

Level loop:

```js
const raw = await conn.getAccountInfo(new PublicKey(v), 'confirmed')
tomb = !raw || raw.data.length < 1 || raw.data[0] !== 1
...
if (tomb) { burnedSinceIndex.push(v); continue }
```

Payment loop:

```js
const stillThere = await conn.getAccountInfo(new PublicKey(v), 'confirmed')
if (!stillThere || stillThere.data.length < 1 || stillThere.data[0] !== 1) {
  done[v] = { ..., skipped: 'vault is no longer a live Core asset' }
  ...
}
```

This treats the following as “burned”:

- account absent (`raw == null`),
- account data empty,
- any first byte other than `1`, including future Core key variants or foreign data,
- RPC returning null for a live account.

It does **not** check that the account is owned by Core or that the key byte is specifically Core’s `Key::Uninitialized` (`0`).

**What an attacker or accident gains**

A faulty, lagging, or hostile RPC can make one or many live vaults appear burned. The distribution then silently skips them. If enough vaults are skipped, the day can finish as “no activated vaults” or pay everyone else without halting.

This contradicts the measured fact that a burned Core asset account **survives** as a Core-owned tombstone. Absence is not a burn.

**Evidence that would exist if this is right**

A unit/integration test with a mock RPC:

- DAS lists vault live,
- `fetchAsset` throws,
- `getAccountInfo(v)` returns `null`,
- distribute logs `burnedSinceIndex`, continues, and pays others.

No refusal occurs unless the vault would have been activated and the balance read still marked it activated; but the skip happens before balance read, so the vault is removed from the denominator entirely.

**Fix**

Require a positive tombstone:

```js
tomb =
  raw &&
  raw.owner.equals(CORE) &&
  raw.data.length >= 1 &&
  raw.data[0] === 0   // Key::Uninitialized
```

Treat `raw == null`, wrong owner, or unknown key byte as unreadable/halt or ambiguous, not as burned. Apply the same fix to the payment loop.

---

### R3-2 — MEDIUM — `burnedSinceIndex` is only a console line; it is not persisted and has no detector

**Exact construct**

```js
if (burnedSinceIndex.length) {
  console.log(...)
}
```

There is no ledger field, no `detectDistribution` kind, and no paging for a large or unexpected burned-since-index set.

**What an accident gains**

A mass misclassification (see R3-1) can disappear into stdout. The alarm will not fire from the distribution ledger itself.

**Evidence**

`bank/detectors.mjs` `detectDistribution` has no branch for `burnedSinceIndex`. The distribution state only persists `unreadableAtas`, plan, paid rows, etc.

**Fix**

Persist `burnedSinceIndex` into the day record and add a detector, e.g. `distribution_burned_since_index`, at HIGH if non-empty and CRITICAL if above a small threshold.

---

### R3-3 — MEDIUM — inner `catch` direction is correct for exceptions, but RPC `null` is fail-open

**Exact construct**

```js
} catch { tomb = false }   // could not ask ⇒ do NOT assume burnt ⇒ halt
```

This is the right direction for thrown RPC errors. But `getAccountInfo` returning `null` does not throw; it sets `tomb = true`.

**What an accident gains**

A “could not read” condition that happens to return null is read as a burn instead of a halt.

**Fix**

Separate three states:

1. positive live asset (`data[0] === 1`),
2. positive Core tombstone (`owner == Core && data[0] === 0`),
3. everything else = unreadable/disagreement → halt or ambiguous.

---

### R3-4 — MEDIUM — payment-loop RPC errors are not caught; the level loop was fixed, the payment loop was not

**Exact construct**

Level loop wraps the tombstone probe in `try/catch`. Payment loop does not:

```js
const stillThere = await conn.getAccountInfo(new PublicKey(v), 'confirmed')
```

If this throws mid-payment, `main()` aborts after some transfers may have been sent.

**What an accident gains**

A transient RPC failure during the payment loop leaves the day unfinished and may trigger `distribution_unfinished`, but the run dies instead of recording a per-vault ambiguous/unreadable state.

**Evidence**

The diff added exception handling around the level-loop probe only.

**Fix**

Wrap the payment-loop liveness probe in try/catch and treat failure as ambiguous/unpaid for that vault, or halt before sending if liveness cannot be established. Do not let an exception erase the remaining loop.

---

### R3-5 — LOW — burned-mid-run skipped amounts are not accounted in `plan.total` or dust

**Exact construct**

If a vault is skipped in the payment loop:

```js
done[v] = { amount: String(plan.per[v]), sig: null, skipped: ... }
```

`plan.total` still includes `plan.per[v]`, and the final print says:

```js
`${plan.total ?? ''} sats out, dust ${plan.dust ?? 0n} carried`
```

But those sats were not sent.

**What an accident gains**

The settlement log overstates the amount paid. The unspent amount remains in the distributor ATA and will be included in the next run’s `available`, but the day’s published accounting is inconsistent.

**Fix**

Track `skippedTotal` and print/persist `paidTotal = plan.total - skippedTotal`, or record the skipped amount as explicit carry.

---

### R3-6 — LOW — third halt route remains: transient `fetchAsset` failure on a live vault halts the whole distribution

**Exact construct**

If `fetchAsset` throws and the account is still live (`data[0] === 1`), the code pushes `unreadableLevels` and later `allocateWeighted` refuses if the vault is activated.

**What an accident gains**

RPC rate limits, umi deserialization errors, or a Core upgrade can halt all payouts. This is the intended fail-closed behaviour, but it is still untested at production scale (limit 22).

**Fix**

Exercise this at scale with multiple RPC providers and explicit rate-limit backoff. Consider retrying transient read errors before declaring a halt.

---

## R4 — THE TWO DEFECTS ALREADY FOUND, AND OTHERS OF THAT SHAPE

### R4-1 — MEDIUM — one-shot ordering was fixed in `commit_deck`, but sibling one-shot state checks are incomplete

Already detailed as R1-3 and R1-6:

- `commit_seed` does not require `deck_root == [0;32]`.
- `mint_vault` does not require `deck_seed != [0;32]`.

These are the same “reject for the wrong reason / allow for the wrong state” shape.

**Fix**

Make the one-shot sequence explicit and enforce it at every entry point:

```text
initialize -> commit_seed -> commit_deck -> mint_vault
```

with each stage refusing out-of-order state.

---

### R4-2 — LOW — CU pad probe still has a fixed ceiling that can mask a measurement

**Exact construct**

Section 10:

```ts
let maxPad=0
for(let n=1;n<=20;n++){ try{ await mintCUDry(n); maxPad=n }catch{ break } }
```

If 20 instructions all fit, the probe reports 20 as the maximum without proving that 21 does not fit.

**What this costs**

A future change that increases packet headroom could silently under-measure the widest pad.

**Fix**

Use the same shape as the attribute probe: raise the ceiling and assert that the ceiling was not reached, or that a deeper pad fails.

---

### R4-3 — LOW — `packetBinds` is computed but not asserted

**Exact construct**

```ts
const packetBinds=maxAttrs<MAX_ATTRS_BORSH-1
```

This is printed, not recorded. The suite asserts the packet bound was reached and that deeper decks buy fewer attributes, but it does not assert whether the packet or the program is the binding constraint.

**What this costs**

The published conclusion “the PROGRAM is the binding constraint” is not pinned by an assertion.

**Fix**

Add a `rec()` that pins the expected binding constraint for the production depth, e.g. at depth 11 `at11 >= MAX_ATTRS_BORSH - 1` if the program is supposed to bind.

---

## R5 — THE SUITE’S NEW ARMS

### R5-1 — Negative arms and `because()` coverage

The four new pinned negative arms are correctly ordered:

- `2.0c` before seed: reaches `SeedNotCommitted`.
- `2.0d` zero salt hash: reaches `BadSaltHash`.
- `2.0f` second salt: reaches `SeedAlreadyCommitted`.
- `2.0i` wrong salt: reaches `BadSalt`.

The other pinned arms are also reachable:

- `2.0a` zero root after seed: reaches `BadDeckRoot`.
- `11.9` second deck after root: reaches `DeckAlreadyCommitted` because the root check is now first.

The substantive unpinned checks in the 2.0 sequence are `2.0g` and `2.0h`. They can fail by value, not by error code. `2.0e` and `2.0b` are positive allow checks.

No false pass was found in the ordering of these arms.

---

### R5-2 — LOW — `2.0h` is a cross-implementation check for the seed, but not for the SlotHashes parse or the root/seed relationship

**Exact construct**

`2.0h` compares:

- seed stored by the Rust program at offset 601,
- seed derived in JS by `bank/deck.mjs` from the same salt and the same sysvar entry.

This proves Rust and JS agree on `sha256(salt || blockhash)` **if both parse SlotHashes the same way**. It does not prove either parser is correct, and it does not prove `deck_root` matches the deck derived from that seed.

**Evidence**

The JS parser and Rust parser both assume the same 40-byte stride and little-endian slots. If both were wrong identically, `2.0h` could still pass.

**Fix**

Add an independent check of the entropy blockhash, e.g. compare the SlotHashes entry for `deckSlot` against an RPC block query or a known test vector. Add a separate check that `deck_root` equals `deckRoot(buildDeck(level_caps, deck_seed))` off-chain.

---

### R5-3 — LOW — `2.0g`/`2.0h` can crash the suite instead of failing cleanly if entropy is absent

**Exact construct**

```ts
rec('2.0g', ..., String(!!entropy && !entropy.equals(Buffer.alloc(32))))
DECK_SEED=seedFrom(SUITE_SALT,entropy!)
```

If `entropy` is null, `2.0g` records a mismatch, then `entropy!` is passed into `seedFrom`, likely throwing a TypeError and aborting the suite.

**Fix**

Guard:

```ts
if (!entropy) throw new Error('entropy slot not found')
```

or return early with a clean failure.

---

### R5-4 — Hardcoded offsets 593 and 601

I recomputed the Borsh offsets from `MintConfig`:

| field | offset |
|---|---:|
| discriminator | 0..7 |
| version | 8 |
| admin | 9 |
| collection | 41 |
| bank | 73 |
| governance | 105 |
| treasury | 137 |
| round_id | 169 |
| opens_at | 173 |
| closes_at | 181 |
| price_lamports | 189 |
| cap | 197 |
| minted_this_round | 201 |
| minted_total | 205 |
| max_supply | 213 |
| bank_treasury | 221 |
| split_bps | 253 |
| paused | 255 |
| swap_operator | 256 |
| sol_reserve_lamports | 288 |
| bump | 296 |
| max_sweep_lamports | 297 |
| sweep_cooldown_secs | 305 |
| last_sweep_at | 313 |
| pending_governance | 321 |
| pending_governance_at | 353 |
| governance_timelock_secs | 361 |
| pending_admin | 369 |
| pending_admin_at | 401 |
| pending_bank | 409 |
| pending_bank_at | 441 |
| pending_operator | 449 |
| pending_operator_at | 481 |
| level_caps | 489 |
| level_minted | 509 |
| deck_root | 529 |
| deck_salt_hash | 561 |
| deck_slot | 593 |
| deck_seed | 601 |

`OFF_DECK_SLOT = 593` and `OFF_DECK_SEED = 601` match the struct.

---

### R5-5 — 11.11 arms are no longer vacuous, with one caveat

The new arms:

```ts
rec('11.11', ..., String(maxAttrs>=0 && maxAttrs<PROBE_CEILING))
rec('11.11a', ..., String(at11>=0 && at11<PROBE_CEILING))
rec('11.11b', ..., String(at7>at11 && at11>at13))
rec('11.11c', ..., String(at11>=2))
```

can fail:

- if the probe ceiling is reached,
- if deeper decks do not reduce attribute capacity,
- if depth 11 cannot hold two provenance attributes.

The caveat is R4-3: the conclusion “program is the binding constraint” is not itself asserted.

---

## R6 — ACCEPTED LIMITS REWRITES

### R6-1 — MEDIUM — Limit 1a is correct about Bank confinement but incomplete about deck commitment

Limit 1a now correctly says Bank-pubkey confinement is on-chain in SEAL and MINT. But the new deck commitment instructions are **admin-only**, not Bank-only. If the Bank is also the admin, or can influence admin, the confinement narrative does not cover the deck commitment path.

**Fix**

Rewrite 1a or add a sibling limit stating:

> `commit_seed` and `commit_deck` are admin-gated, not Bank-gated. Bank confinement does not apply to deck commitment.

---

### R6-2 — HIGH — Limit 23’s rewrite is accurate about packet budget but omits the two real deck risks

The rewritten limit 23 correctly measures that the packet is not the binding constraint at production depth. But it does not state:

1. `deck_root` is not bound to `deck_seed` on-chain.
2. Bank-controlled mint ordering can allocate high-level indices even with an honest deck.

Because the item says “the root commits ONCE” and then discusses measurement, it can be read as the deck-fairness problem being closed. It is not.

**Fix**

Add both residual risks to limit 23 or create new blocking/accepted items for them. Do not let the packet-budget measurement obscure the allocation problem.

---

### R6-3 — MEDIUM — SPEC’s level table overclaims “prevented on-chain”

SPEC says:

> the Bank cannot deal off-deck | Merkle proof against a pre-committed `deck_root`, bound to `minted_total` | prevented on-chain

This is only true relative to the committed root. Since the root is not bound to the public seed, the Bank/admin can still deal a different deck if they control commitment. The table should say “prevented on-chain only if the committed root is the honest deck root; that binding is not enforced on-chain.”

**Fix**

Correct SPEC, or enforce the binding.

---

## R7 — COUNTS AND ARITHMETIC

### Floors in `scripts/run-tests.sh`

The file contains:

```sh
MIN_ASSERTIONS=330
DECK_FLOOR=17
DET_FLOOR=439
ALLOC_FLOOR=103
MAINNET_FLOOR=19
```

The prompt’s quoted floors match except that it omits the deck floor. The deck floor exists and is 17.

### Census arithmetic

240-vault census:

```text
108 + 60 + 36 + 24 + 12 = 240
108*2 + 60*3 + 36*4 + 24*5 + 12*6
= 216 + 180 + 144 + 120 + 72
= 732
```

2,100-vault census:

```text
945 + 525 + 315 + 210 + 105 = 2100
945*2 + 525*3 + 315*4 + 210*5 + 105*6
= 1890 + 1575 + 1260 + 1050 + 630
= 6405
```

Per $1,000 figures at 240:

```text
I   2000/732  = 2.73
II  3000/732  = 4.10
III 4000/732  = 5.46
IV  5000/732  = 6.83
V   6000/732  = 8.20
```

Per $1,000 figures at 2,100:

```text
I   2000/6405 = 0.31
II  3000/6405 = 0.47
III 4000/6405 = 0.62
IV  5000/6405 = 0.78
V   6000/6405 = 0.94
```

Shares at 2,100:

```text
I   1890/6405 = 29.5%
II  1575/6405 = 24.6%
III 1260/6405 = 19.7%
IV  1050/6405 = 16.4%
V    630/6405 = 9.8%
Sum = 100.0%
```

These reproduce the published figures.

---

### R7-1 — LOW — `bank/deck.mjs` internal floor is stale and uses a lower bound, not equality

**Exact construct**

`bank/deck.mjs`:

```js
const FLOOR = 16
if (R.length < FLOOR) { ... }
```

`scripts/run-tests.sh`:

```sh
DECK_FLOOR=17
```

The deck selftest currently has 17 assertions, but its own internal gate allows deleting one assertion and still passing if run directly. This is the same floor-slack shape fixed elsewhere.

**Fix**

Set `FLOOR = 17` and use equality, matching `run-tests.sh`.

---

## R8 — ONE-OF-N-SITES

### R8-1 — HIGH — the new deck fields are not watched by detectors, despite comments claiming the alarm watches the relationship

**Exact construct**

`bank/detectors.mjs` `WATCH` includes many MINT fields, but not:

- `mint.level_caps`,
- `mint.level_minted`,
- `mint.deck_root`,
- `mint.deck_salt_hash`,
- `mint.deck_slot`,
- `mint.deck_seed`.

`WATCHED_KEYS` also does not include them.

Meanwhile `bank/deck.mjs` says:

> `bank/selftest.mjs` checks the relationship and the alarm watches it in production.

and `programs/cbob-vault-mint/src/lib.rs` says:

> `bank/selftest.mjs` and the on-chain suite check the relationship, and the alarm watches it in production.

The supplied `bank/selftest.mjs` contains no deck-root/seed consistency arm, and `detectors.mjs` contains no deck detector.

**What an attacker or accident gains**

A malicious or mistaken deck commitment can occur with no config-drift finding, no standing-risk finding, and no alarm. This is exactly the “comment asserting a control that does not run” defect class.

**Evidence**

- Grep `detectors.mjs` for `deck_root`, `deck_seed`, `level_caps`: no watch entries.
- Grep `selftest.mjs` for a root/seed deck consistency assertion: none.
- `missingWatchedKeys` cannot catch the omission because the keys are not in `WATCHED_KEYS`.

**Fix**

Add to `WATCH` and `WATCHED_KEYS`:

```js
'mint.level_caps',
'mint.level_minted',
'mint.deck_root',
'mint.deck_salt_hash',
'mint.deck_slot',
'mint.deck_seed',
```

Add a detector such as `detectDeckConsistency`:

- if `mint.deck_root` non-zero, require `mint.deck_seed` non-zero,
- recompute `deckRoot(buildDeck(level_caps, deck_seed))` off-chain,
- CRITICAL on mismatch,
- CRITICAL if `mint_vault` is possible while mismatch exists.

Then prove it in both directions in `bank/selftest.mjs`.

---

### R8-2 — MEDIUM — the tombstone fix was applied to the level loop but not normalized with the payment loop

Already described in R3-1/R3-3/R3-4. The level loop has an exception catch that fails closed; the payment loop has no catch. Both loops treat absent accounts as burned. This is the same event handled differently in two places.

**Fix**

Create one helper, e.g. `classifyVaultAccount(raw)`, returning exactly:

- `live`,
- `burned-tombstone`,
- `unreadable/unknown`.

Use it in both loops.

---

### R8-3 — LOW — floor equality discipline was not applied to `bank/deck.mjs`

See R7-1.

---

### R8-4 — LOW — `seedFrom` accepts strings, Buffers, and other encodings without pinning the byte representation

**Exact construct**

`bank/deck.mjs`:

```js
export const seedFrom = (bankSalt, blockhash) => sha(Buffer.from(bankSalt), Buffer.from(blockhash))
```

`Buffer.from('abc')` is UTF-8. `Buffer.from(buffer)` copies bytes. The Rust program expects a 32-byte `salt` and a 32-byte blockhash.

**What an accident gains**

An operator who passes a hex string, base58 string, or passphrase to `seedFrom` will derive a different seed than the program expects. `commit_deck` would fail if the salt bytes do not match the committed hash, but off-chain verification could silently use the wrong encoding.

**Fix**

Require `Uint8Array`/`Buffer` of length 32 for both inputs, and throw otherwise. Update the selftest to use byte arrays, not arbitrary strings.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

### 1. Is any limit WORSE than stated?

Yes.

**Limit 1b — Bank policy is procedure.**  
It is worse than stated because the Bank’s procedural control over mint co-signature translates directly into **level allocation** once the deck is public. This is not merely “which transactions it agrees to sign”; it is which customers receive higher-paying vault indices.

**Limit 11 — distribution reconciles against a payer-written ledger.**  
The new `burnedSinceIndex` path is not even in the ledger. It is stdout-only. This makes reconciliation weaker than the limit describes.

**Limit 20 — poisoned ATA silently removes one holder while a halt pages.**  
The new tombstone logic creates a second quiet route: an absent or unreadable asset account can be treated as burned and skipped without paging. This is not listed in limit 20.

**Limit 13 — Attributes plugin / upgrade authority.**  
The level’s integrity now also depends on the MINT program not being upgraded to allow root-without-seed or unbound roots. Limit 13 focuses on SEAL’s Attributes authority; the deck commitment adds another upgrade-authority dependency.

---

### 2. Is anything listed as a limit not actually a limit?

The packet-budget portion of limit 23 appears closed by measurement: at production depth 11 the packet holds more caller attributes than the program permits, so the program, not the packet, binds. That specific sub-limit is effectively discharged, although the item correctly remains open for the one-shot root decision.

Limit 9 was already narrowed correctly: the co-signer does fail closed on foreign nested assets at redemption time. The remaining limit is advance detection only.

---

### 3. Is any DISCHARGED item not actually discharged?

**Item 19 — unlevelled-vault halt.**  
The original halt is closed for the unlevelled-window claim: levels are written at mint. But the discharge language says the Bank “cannot omit a holder without halting everyone.” The new tombstone logic weakens that: a live vault whose account read returns null or unknown data can be omitted as “burned since index” without halting everyone. Item 19 should be reworded to exclude the misclassification route, or the route should be fixed as in R3-1.

**Items 12/17 — compute units.**  
They discharge the mint/redemption path. They do not measure `commit_deck`’s sysvar walk, but `commit_deck` is not part of the per-mint money path. I would not call the discharge wrong on that basis alone.

**Item 14 — duplicate attribute keys.**  
Still closed by `DuplicateAttribute` and by `levelFromAttributes` refusing two `level` keys.

---

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

Yes, in effect.

**Limit 23** remains open, but the narrative around the new measurement can be read as “the deck problem is solved because the packet is not binding.” The two harder problems — root not bound to seed and Bank ordering — are not in the open/blocking item as written. They should be added, or explicitly accepted as buyer-facing limits.

**Limit 22** remains open and is now larger: `distribute.mjs` has new tombstone logic, new per-vault `fetchAsset` reads, and new RPC failure modes that have not been exercised against a live chain at production scale.

---

## ANYTHING ELSE

### A-1 — LOW — `audit21.ts` omits the deck floor from the prompt’s assertion counts

`scripts/audit21.ts` reads:

```ts
onchain: MIN_ASSERTIONS,
detector: DET_FLOOR,
alloc: ALLOC_FLOOR,
mainnet: MAINNET_FLOOR,
```

It does not read `DECK_FLOOR`. The prompt therefore tells auditors about four floors while the runner enforces five. If the deck floor moves, the audit prompt will drift.

**Fix**

Include `DECK_FLOOR` in `FLOORS` and in the prompt sentence, or state deliberately that deck assertions are excluded.

---

### A-2 — LOW — `BadSplit` error message still contains the disproven royalty-plugin justification

`MintError::BadSplit` says:

```rust
#[msg("split_bps must be <= 10000 and a multiple of 100 so the royalty plugin can express it")]
```

The code comment above `update_wiring` says this justification is false: the royalty plugin does not read `split_bps`.

**Fix**

Correct the message to the real reason: whole-percent expression of the 85/15 split.

---

### A-3 — LOW — `bank/deck.mjs` selftest uses non-32-byte string inputs for a scheme that must be byte-exact

The selftest uses:

```js
seedFrom('salt-A', 'blockhash-A')
```

This is fine as a deterministic unit test, but it normalizes an API that accepts arbitrary strings while the on-chain path requires fixed 32-byte values.

**Fix**

See R8-4.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, WHAT SHOULD THIS PROJECT DO THAT AI AUDIT STRUCTURALLY CANNOT?

1. **Separate the deck-commitment authority from the Bank operationally and cryptographically.**  
   `commit_seed` and `commit_deck` should require a multisig with a different key set from the Bank co-signer, with hardware custody. AI can find code paths; it cannot prevent one person or one machine from holding both roles.

2. **Run a public deck attestation ceremony before minting opens.**  
   Publish `level_caps`, `deck_slot`, `deck_seed`, and `deck_root`. Require multiple independent parties to publish signed attestations that `deck_root == deckRoot(buildDeck(level_caps, deck_seed))`. Without this, the root-unbound gap is only a comment.

3. **Make the fairness limit explicit to buyers if it is not fixed.**  
   If the Bank can order mints, say so in buyer-facing materials: “The Bank can influence which mint index receives which level.” AI audit cannot substitute for disclosure and consent.

4. **Perform a production-scale distribution rehearsal against live RPC/DAS, not local validator.**  
   Limit 22 cannot be closed by reasoning. Run the full 2,100-vault path with failure injection: rate limits, null account responses, burned vaults, poisoned ATAs, and RPC provider failover.

5. **Use multiple independent RPC providers for the money path.**  
   The current tombstone logic makes a single RPC response capable of skipping vaults. A money job should require agreement between at least two independent sources before treating a DAS-live vault as burned.

6. **Create an external bug bounty or insurance fund.**  
   AI rounds can enumerate defects, but they do not carry economic liability. A bounty fund gives human researchers a reason to look after the freeze.

7. **Move all upgrade authorities to a hardware-backed multisig before deployment.**  
   The deck scheme, level immutability, and redemption guarantees are all bypassable by program upgrade. AI cannot secure the upgrade keys; only custody and multisig policy can.

8. **Publish a holder-side verification tool.**  
   Holders should be able to run one command that reads on-chain `deck_seed`, `deck_root`, `level_caps`, and their vault’s `level`, and tells them whether their level is consistent with the committed deck. If verification depends only on the Bank’s alarm, the Bank is still both player and referee.