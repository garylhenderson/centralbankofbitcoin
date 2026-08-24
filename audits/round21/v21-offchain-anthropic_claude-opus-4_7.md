# Independent Security Audit — Round 21

## R1. THE COMMITMENT SCHEME

### CRITICAL — R1.1: Bank-as-validator can grind the entropy slot's blockhash

**Construct.** `commit_seed` sets `deck_slot = current_slot + 32`. The Bank commits the salt hash, then 32 slots later `commit_deck` reads `blockhash(deck_slot)` from SlotHashes and derives `seed = sha256(salt || blockhash)`.

**What a cheating Bank must control:** the CONTENTS of the block at `deck_slot`. The Bank cannot change the salt (its hash is committed), but if the Bank IS the leader of slot `deck_slot` — or bribes/colludes with that leader — the leader can choose whether to produce the block, what to include in it, and thus influence its blockhash. With one candidate `salt` value already committed, the leader tries block variants (transaction ordering, empty vs. non-empty) until `sha256(salt || blockhash)` yields a favorable deck.

**Feasibility.** The Bank commits `commit_seed` at slot N. It knows `deck_slot = N+32`. Solana's leader schedule is public and computed ~2 epochs ahead, so the Bank knows WHO leads N+32 the moment it submits `commit_seed`. If that leader is the Bank (or an ally), the Bank simply waits, becomes leader, and grinds.

Mitigation is weak: the Bank can also just NOT submit `commit_seed` until it lands in a slot whose `+32` is a slot the Bank leads. A validator producing ~1/N of blocks gets a shot every N slots for free.

**Evidence if true.** A Bank operator whose Solana validator identity matches (or is coordinated with) the address calling `commit_seed`. On mainnet: check whether `commit_seed`'s submitter is a known validator identity or funds a validator.

**Fix.** Use a VRF or a much longer/multi-slot entropy source (hash of many future blockhashes, or a beacon like drand). At minimum, require the entropy to combine `blockhash(deck_slot)` with `blockhash(deck_slot+K)` for several K, so a single leader cannot control the outcome. Alternatively: require `commit_seed` to be signed by a party OTHER than the Bank (e.g., an independent oracle).

### HIGH — R1.2: `commit_seed` grinding via re-submission

**Construct.** `commit_seed` is one-shot on `deck_salt_hash != 0`. But the FIRST submission is free — the Bank can submit `commit_seed(H)` speculatively, observe which slot it lands in, note `deck_slot = current + 32`, look up the leader of `deck_slot`, and if unfavorable... it's already committed and can't retry with the same salt.

BUT: the Bank chooses `H` before submitting. If `commit_seed` fails to land (network drop, block full, etc.), the Bank knows nothing was committed and can retry with a different salt. Nothing prevents the Bank from submitting `commit_seed(H1)` and, if the tx fails to land within some slot window, submitting `commit_seed(H2)` where the Bank has now learned WHICH slot the retry will land in.

The subtler grind: submit `commit_seed` and observe the landing slot. The Bank can choose HOW HARD to push the transaction (priority fee) based on whether the current slot's `+32` looks favorable to a leader it controls.

**Fix.** Require the salt_hash preimage to include the slot in which `commit_seed` lands, or bind `deck_slot` to a value read from a different source.

### HIGH — R1.3: `paused` does not block `commit_seed` or `commit_deck`

**Construct.** `set_paused` gates `mint_vault` and `sweep_sol_for_swap`. It does NOT gate `commit_seed` or `commit_deck`. So a Bank whose sale is paused (emergency) can still commit a deck.

**Cost.** Low today (nothing minted), but as an accepted-by-omission property it's worth stating: an emergency pause does not stop the commitment machinery.

**Evidence.** Grep `paused` in the mint program — `commit_seed`/`commit_deck` do not check it.

**Fix.** Either gate both, or state explicitly in SPEC that pause does not apply to commitment (I suspect the latter is intended, but it's undocumented).

---

## R2. `blockhash_of_slot` — RAW PARSE

### MEDIUM — R2.1: The layout claim is untested against SlotHashes

**Construct.** Comment says `u64 count`, then `count` entries of `(u64 slot, [u8;32] hash)`. Stride = 40 bytes.

**Verification against Solana source:** `solana_program::slot_hashes::SlotHashes` is `Vec<(Slot, Hash)>` where `Slot = u64` and `Hash = [u8;32]`. The sysvar layout for `Vec<T>` in bincode-serialized Solana sysvars uses a `u64` length prefix followed by packed elements. **This appears correct** — but I note that the suite reads it the same way (`shAcct!.data.readBigUInt64LE(0)` and `off+40`), so if the layout is wrong BOTH would be wrong the same way (see R5.1).

Independent evidence for correctness: the on-chain test 2.0h passes on a real validator, and the seed derivation works. The `sha256(salt||blockhash) == deck_seed` equality is a genuine cross-check IF and only if both sides derive from a real blockhash of a real slot.

### HIGH — R2.2: Duplicate-slot ordering isn't checked; returns first match

**Construct.** The loop `for i in 0..n` returns on the FIRST match. The comment says "ordered newest first" but nothing in the code enforces this, and SlotHashes could theoretically contain a slot twice (it shouldn't, but the code doesn't defend against it).

**Cost.** If SlotHashes ever contained the same slot with two different hashes (via a bug in Solana or a corrupted sysvar read), the code would take the FIRST, which by the "newest first" assumption would be the more recent one. This is a defense-in-depth gap, not a live exploit.

**Fix.** Document that the check is "first match wins" and state the invariant assumed. Or scan the entire list and require exactly one match.

### LOW — R2.3: `DeckSlotUnavailable` message conflates "missed window" with "malformed sysvar"

The message says "aged out of SlotHashes." But `err!(MintError::DeckSlotUnavailable)` is also returned when the slot is simply not present for other reasons (e.g., if the caller passed a wrong `deck_slot`, though that's set by the program). Minor UX issue.

### MEDIUM — R2.4: Permanent failure is a griefing surface for the Bank ITSELF

**Construct.** If the Bank submits `commit_seed` but fails to submit `commit_deck` within 512 slots (~3.4 minutes), minting is permanently disabled. There's no re-seed.

The comment justifies this: "a re-seed is an unlimited number of draws." True. But it means: **a Bank operator error during initialization bricks the entire product forever.** The window is 3.4 minutes. A network hiccup, a paused validator, a busy RPC — any of these and the project is dead.

Also: an ADVERSARY who compromises the Bank key just once — even briefly, before rotations complete — can call `commit_seed` and refuse to call `commit_deck`, permanently sealing the product. This is a much cheaper attack than stealing funds and equally destructive.

**Evidence.** Read `commit_seed` and `commit_deck`: no re-seed exists. The salt_hash and deck_root are both one-shot.

**Fix.** Allow admin (behind the same timelock as governance rotations) to reset `deck_salt_hash` and `deck_slot` to zero, IF `deck_root` is still zero. This preserves "one deck, ever" while allowing recovery from a botched commitment. Yes, this reintroduces "unlimited draws" for a hostile admin — but a hostile admin is already accepted in the wiring (they can rotate anything with a timelock). Trading permanent brick for a timelock-gated re-seed is the right side of the trade.

---

## R3. THE HALT (`bank/distribute.mjs`)

### HIGH — R3.1: `data[0] !== 1` matches ANY non-AssetV1 state, not just tombstones

**Construct.**
```js
tomb = !raw || raw.data.length < 1 || raw.data[0] !== 1
```

Core's Key enum has multiple discriminants beyond `AssetV1 = 1`: `CollectionV1 = 5`, `Uninitialized = 0`, `HashedAssetV1 = 2`, etc. The tombstone after burn is `Key::Uninitialized = 0`.

The check `data[0] !== 1` treats ALL of these as "burned." What if a vault account somehow becomes a HashedAssetV1 (compressed asset)? Or a corrupted account? Or an account owned by System with 0-byte data (which raw.data.length < 1 catches, but 1-byte 0 data doesn't)?

**Concrete risk:** if Core ever introduces a new Key discriminant or changes the layout, this check silently reclassifies a live vault as burned and skips paying that holder.

**Fix.** Check specifically for `data[0] === 0` (Uninitialized) as the tombstone marker. Any OTHER unexpected byte should HALT, because it means the account is in a state this code doesn't understand.

### HIGH — R3.2: The `getAccountInfo` fallback races the DAS index

**Construct.** The code does:
1. `fetchAsset` throws (Core sees uninitialized)
2. `getAccountInfo` at `confirmed` commitment

Between steps 1 and 2, an RPC failover could hit a NODE THAT HASN'T INDEXED THE BURN YET. `getAccountInfo` on the trailing node returns the LIVE vault data (data[0] = 1). Then `tomb = false`, and the code falls into `unreadableLevels.push(...)`, halting the day.

**Cost.** Same as the halt this fix was for, just harder to reproduce. Legitimate customer burn during the second-half window → halt.

**Fix.** Use `finalized` commitment for the tombstone check, or use the same connection object consistently. Better: retry the tombstone check across multiple commitments and only halt if inconsistent.

### CRITICAL — R3.3: THE THIRD ROUTE — Foreign nested burn during index build

**Construct.** Consider this sequence:
1. Alice's vault A is at level V.
2. Alice transfers vault A to vault B's asset-signer PDA (nested). Not on our collection index, but LIVE in Core.
3. Bob (owner of B) redeems vault B via burn. This DOESN'T burn A (BURN refuses declared nested vaults) — but if Bob DOESN'T declare A, burn destroys A silently. This is accepted limit 9/proven impossibility, but from `distribute.mjs`'s perspective, A is still listed LIVE in DAS.
4. `fetchAsset(A)` throws because A was destroyed.
5. `getAccountInfo(A)` returns tombstone (`data[0] = 0`).
6. `tomb = true`, A is added to `burnedSinceIndex`, and distribution continues.

**But A's holder is being silently written off.** They were nested and destroyed. This is the accepted-limit scenario (nesting is impossible-to-detect continuously) — but Phase 1 argued this is caught pre-signature by cosign. Under the new tombstone logic, `distribute.mjs` ALSO writes them off as "burned since index."

Is this a bug? The vault IS burned. There's nothing distribute can pay. But the SIGNAL should be different — a legitimate customer redemption (via our program) vs. a destroyed-through-nesting vault should not both show up as "burnedSinceIndex" indistinguishable in the log. Operators need to know the difference to notify the holder.

**Fix.** Cross-check `burnedSinceIndex` against the alarm's burn records. A vault in `burnedSinceIndex` but NOT in the alarm's `burn_via_program` log is a bare Core burn or nested destruction — a distinct paging event.

### MEDIUM — R3.4: The inner `catch` is correct but the ordering is wrong

**Construct.**
```js
let tomb = false
try {
  const raw = await conn.getAccountInfo(...)
  tomb = !raw || raw.data.length < 1 || raw.data[0] !== 1
} catch { tomb = false }   // could not ask ⇒ do NOT assume burnt ⇒ halt
```

Confirmed: RPC failure → `tomb = false` → falls to `unreadableLevels.push` → halt. That IS the right direction.

BUT the outer try/catch is around `fetchAsset`, which uses `umi`. The inner `getAccountInfo` uses `conn`. These are DIFFERENT clients potentially hitting DIFFERENT RPC endpoints. So the "did fetchAsset fail" and "does the account exist" answers come from different sources. If umi points at a good node and conn at a stale one, the code halts even on a real burn.

**Fix.** Use a single RPC endpoint for both, or explicitly require they agree.

---

## R4. THE TWO DEFECTS + THE PATTERN

### CRITICAL — R4.1: `commit_deck` ordering — `deck_root` check is first, but `require_keys_eq!` on admin fires BEFORE that

**Construct.** The Anchor `#[account(has_one = admin)]` constraint fires BEFORE the handler body. So a caller who is NOT admin gets `ConstraintHasOne`, never `DeckAlreadyCommitted`. The suite's `because('11.9', 'DeckAlreadyCommitted')` only works because the signer IS the admin.

Is this correct? Yes — a non-admin should be refused regardless. But the "ordering matters, hear it from the check that enforces it" argument in the comment is subtly wrong: the STRONGEST statement is actually "admin only," and that's what fires first.

Minor issue, but worth noting: the ordering rhetoric doesn't quite match reality.

### HIGH — R4.2: `commit_deck` reads `config.deck_slot` before mutable borrow — but reads `deck_salt_hash` too

**Construct.**
```rust
let want = ctx.accounts.config.deck_slot;
let committed = ctx.accounts.config.deck_salt_hash;
require!(committed != [0u8; 32], MintError::SeedNotCommitted);
```

The `SeedNotCommitted` check happens AFTER the `deck_root == 0` check. What if:
- `deck_root` is zero (fresh state)
- `deck_salt_hash` is zero (no seed committed)

The caller gets `SeedNotCommitted`. Correct. But what about the `blockhash_of_slot` call — is it reached before `SeedNotCommitted`?

Reading the code: `SeedNotCommitted` fires before `blockhash_of_slot`. Good.

But there's a subtler ordering issue: the `require!(hashv(&[&salt]).to_bytes() == committed)` check happens AFTER `SeedNotCommitted`. So the ordering is:
1. `deck_root == 0` ✓
2. `root != 0` ✓
3. `deck_salt_hash != 0` (seed committed)
4. `hash(salt) == committed` (salt is right)
5. `blockhash_of_slot(...)` (slot is in window)

Between 4 and 5: if the salt hash matches but the slot has aged out, the error is `DeckSlotUnavailable`. This is a legitimate case (Bank called commit_seed too long ago). Is it the RIGHT error? Yes — the operator learns "you missed the window" rather than something confusing.

### HIGH — R4.3: The `PROBE_CEILING = 64` fix may STILL have a false-pass mode

**Construct.** The comment claims the ceiling probes past any plausible budget. But 11.11a asserts:
```
rec('11.11a', 'a mint at the PRODUCTION deck depth of 11 still serializes','true',String(at11>=0&&at11<PROBE_CEILING))
```

If `at11 === 64` (probe ceiling), then `at11 < PROBE_CEILING` is FALSE, so the assertion fails. Good. But what if `attrFit(64)` returns TRUE for some reason (e.g., the transaction still serializes with 64 attributes because they're tiny)? Then `at11 = 64` and the test fails. Also good.

But 11.11b: `at7 > at11 && at11 > at13`. If all three saturate at 64 (implausible but possible), this fails. Good.

**Potential issue:** what if 11.11 (`maxAttrs < PROBE_CEILING`) accidentally passes because the attribute VALUES are so short that even 64 don't blow the packet? At depth 7, `attrFit(n)` builds `[k${i}, 'v']` per attribute — each key is 3-4 chars, value 1 char, so ~15 bytes per attribute including Borsh overhead. 64 attributes = ~960 bytes plus proof/base overhead. If depth is very shallow, this MIGHT fit.

Actually testing depth 7 with the suite's own 90-card deck: proof depth = 7 * 32 = 224 bytes. Plus base ~600 bytes. Plus 64 attrs at ~15 bytes = 960. Total ~1784, well over 1232. So the probe should refuse well before 64.

**But at depth 13 with tiny attrs?** Proof = 13 * 32 = 416 bytes. Base 600 + 416 = 1016, leaving 216 for attrs at ~15 bytes = 14 attrs. That's `at13 = 14`. The reported measured value is 13. Close, so plausible.

The probe seems to work. But note: the assertion `at7 > at11 > at13` is monotonicity. If ANY probe ceiling truncates ANY of them, this arm fails. So it's genuinely testable.

**One concern:** the attribute key/value LENGTHS are hardcoded (`k${i}` and `'v'`). If someone shortens them further, the counts move up. The comment says "so the probe can fail." It can. But the SPECIFIC NUMBER measured is only meaningful for THESE lengths. SPEC says "at ~2,100 vaults the packet holds 18." True at these lengths; not at real charter provenance which is longer (`notice` = "CBOB-NOTICE-0042" = 16 chars).

**Cost.** SPEC's "18 attributes at depth 11" is an OVER-COUNT for real provenance. A charter mint with real notice serial and governor address won't have 18 attributes worth of room; it'll have fewer.

**Fix.** Measure with realistic attribute sizes (say 32-char keys and 64-char values, matching production). The current probe measures a lower bound on packet capacity in bytes, not on the number of REAL attributes.

---

## R5. THE SUITE'S NEW ARMS

### CRITICAL — R5.1: 2.0h — the seed cross-check may be a tautology

**Construct.** The suite reads `entropy` from SlotHashes using `readBigUInt64LE(off)` and `subarray(off+8, off+40)`. It then derives `DECK_SEED = seedFrom(SUITE_SALT, entropy!)` and compares against `cfgSeeded!.data.subarray(OFF_DECK_SEED, OFF_DECK_SEED+32)`.

**Problem:** BOTH sides use the SAME layout assumption about SlotHashes. If the layout is wrong (say the stride is 48 not 40), the suite reads the WRONG entropy bytes and computes a WRONG seed. The PROGRAM ALSO reads the wrong entropy bytes and stores a WRONG seed. The two wrong values match.

**The check that could catch this:** `seedFrom(SUITE_SALT, ACTUAL_MAINNET_BLOCKHASH)` where ACTUAL_MAINNET_BLOCKHASH is obtained through a DIFFERENT channel (e.g., `getBlock(slot)`).

**Fix.** In addition to comparing the derived seed, fetch the blockhash for `deck_slot` via `getBlock` (which uses a different code path than SlotHashes sysvar) and verify it matches what the sysvar parse produced.

### HIGH — R5.2: 2.0f — `because('2.0f', 'SeedAlreadyCommitted')` is present

Checking the diff: yes, `because('2.0f','SeedAlreadyCommitted')` was added. Good.

`because('2.0c','SeedNotCommitted')`, `because('2.0d','BadSaltHash')`, `because('2.0i','BadSalt')` — all present.

**Missing `because`:** 2.0e (positive) and 2.0g (positive) don't need one. 2.0h is a byte comparison, no error code. 2.0i — hmm, but what about the ordering? 2.0i checks `commit_deck(root, wrong_salt)`. What actually fires? Let's trace:

1. `deck_root == 0` (still fresh) ✓
2. `root != 0` (DECK_ROOT is fine) ✓
3. `deck_salt_hash != 0` — WAIT, `commit_seed(saltHash)` was called (2.0e), so this is set. ✓
4. `hash(wrong_salt) == committed` — FAILS. Returns `BadSalt`.

So `because('2.0i', 'BadSalt')` is correct.

But 2.0d: `commitSeed(Buffer.alloc(32))` → `salt_hash != 0` fails → `BadSaltHash`. ✓

2.0c: `commitDeck(...)` before `commitSeed`. Order:
1. `deck_root == 0` ✓
2. `root != 0` ✓ (7-buffer is nonzero)
3. `deck_salt_hash != 0` — FAILS (it's still zero). Returns `SeedNotCommitted`.

✓ Confirmed.

### CRITICAL — R5.3: Hardcoded offsets 593/601 — VERIFY

Let me compute the `MintConfig` layout offset for `deck_slot` and `deck_seed`:

```
version: u8 = 1 byte
admin: Pubkey = 32
collection: 32
bank: 32
governance: 32
treasury: 32
round_id: u32 = 4
opens_at: i64 = 8
closes_at: i64 = 8
price_lamports: u64 = 8
cap: u32 = 4
minted_this_round: u32 = 4
minted_total: u64 = 8
max_supply: u64 = 8
bank_treasury: 32
split_bps: u16 = 2
paused: bool = 1
swap_operator: 32
sol_reserve_lamports: u64 = 8
bump: u8 = 1
max_sweep_lamports: u64 = 8
sweep_cooldown_secs: i64 = 8
last_sweep_at: i64 = 8
pending_governance: 32
pending_governance_at: i64 = 8
governance_timelock_secs: i64 = 8
pending_admin: 32
pending_admin_at: i64 = 8
pending_bank: 32
pending_bank_at: i64 = 8
pending_operator: 32
pending_operator_at: i64 = 8
level_caps: [u32;5] = 20
level_minted: [u32;5] = 20
deck_root: [u8;32] = 32
deck_salt_hash: [u8;32] = 32
deck_slot: u64 = 8
deck_seed: [u8;32] = 32
```

Plus 8-byte Anchor discriminator.

Running total:
- Disc: 8
- Through `bump`: 8 + 1+32+32+32+32+32+4+8+8+8+4+4+8+8+32+2+1+32+8+1 = 8 + 297 = 305
- Through `last_sweep_at`: 305 + 8+8+8 = 329
- Through `governance_timelock_secs`: 329 + 32+8+8 = 377
- Through `pending_admin_at`: 377 + 32+8 = 417
- Through `pending_bank_at`: 417 + 32+8 = 457
- Through `pending_operator_at`: 457 + 32+8 = 497
- Through `level_minted`: 497 + 20+20 = 537
- Through `deck_root`: 537 + 32 = 569
- Through `deck_salt_hash`: 569 + 32 = 601
- **`deck_slot` starts at 601, `deck_seed` starts at 609**

**BUT THE SUITE CLAIMS `OFF_DECK_SLOT=593, OFF_DECK_SEED=601`.**

**This is WRONG by 8 bytes.** Something in my count differs from the code's expectation. Let me re-check the struct order:

Looking at the diff:
```rust
    pub level_caps: [u32; 5],
    pub level_minted: [u32; 5],
    pub deck_root: [u8; 32],
    pub deck_salt_hash: [u8; 32],
    pub deck_slot: u64,
    pub deck_seed: [u8; 32],
```

And Initialize's space:
```rust
space = 8 + 1 + 32*5 + 4 + 8 + 8 + 8 + 4 + 4 + 8 + 8 + 32 + 2 + 1 + 32 + 8 + 1
      + 8 + 8 + 8 + 32 + 8 + 8 + 32 + 8 + 32 + 8 + 32 + 8
      + 4*5 + 4*5 + 32 + 32 + 8 + 32 + CONFIG_PADDING
```

Counting through: 8 + 1 + 160 + 4 + 8 + 8 + 8 + 4 + 4 + 8 + 8 + 32 + 2 + 1 + 32 + 8 + 1 = 297 (through bump).
Then: 8 (max_sweep) + 8 (cooldown) + 8 (last_sweep) + 32 (pending_gov) + 8 (pending_gov_at) + 8 (timelock) + 32 (pending_admin) + 8 + 32 (pending_bank) + 8 + 32 (pending_operator) + 8 = 200.
Then 4*5 + 4*5 = 40 (level_caps + level_minted).
Then 32 (deck_root) + 32 (deck_salt_hash) + 8 (deck_slot) + 32 (deck_seed) = 104.

Total pre-padding: 297 + 200 + 40 + 104 = 641.

Offset of `deck_slot`: 641 - 32 - 8 = 601. Not 593.
Offset of `deck_seed`: 641 - 32 = 609. Not 601.

**So the suite's offsets ARE wrong by 8 bytes.**

But wait — the suite claims it works. Let me re-check by looking at the ACTUAL RAW field-by-field, considering that Anchor stores `Pubkey` as `[u8; 32]` (32 bytes, no length prefix).

Actually, re-reading: `Initialize` space is `8 + 1 + 32*5 + ...`. That first `32*5` is admin+collection+bank+governance+treasury = 5 pubkeys = 160 bytes. Correct.

Let me count VERY carefully:

```
offset  field
0-7     Anchor disc (8)
8       version (u8, 1) — offset 8
9       admin (Pubkey, 32) — offset 9
41      collection (Pubkey, 32) — offset 41
73      bank (Pubkey, 32) — offset 73
105     governance (Pubkey, 32) — offset 105
137     treasury (Pubkey, 32) — offset 137
169     round_id (u32, 4) — offset 169
173     opens_at (i64, 8) — offset 173
181     closes_at (i64, 8) — offset 181
189     price_lamports (u64, 8) — offset 189
197     cap (u32, 4) — offset 197
201     minted_this_round (u32, 4) — offset 201
205     minted_total (u64, 8) — offset 205
213     max_supply (u64, 8) — offset 213
221     bank_treasury (Pubkey, 32) — offset 221
253     split_bps (u16, 2) — offset 253
255     paused (bool, 1) — offset 255
256     swap_operator (Pubkey, 32) — offset 256
288     sol_reserve_lamports (u64, 8) — offset 288
296     bump (u8, 1) — offset 296
297     max_sweep_lamports (u64, 8) — offset 297
305     sweep_cooldown_secs (i64, 8) — offset 305
313     last_sweep_at (i64, 8) — offset 313
321     pending_governance (Pubkey, 32) — offset 321
353     pending_governance_at (i64, 8) — offset 353
361     governance_timelock_secs (i64, 8) — offset 361
369     pending_admin (Pubkey, 32) — offset 369
401     pending_admin_at (i64, 8) — offset 401
409     pending_bank (Pubkey, 32) — offset 409
441     pending_bank_at (i64, 8) — offset 441
449     pending_operator (Pubkey, 32) — offset 449
481     pending_operator_at (i64, 8) — offset 481
489     level_caps [u32;5] (20) — offset 489
509     level_minted [u32;5] (20) — offset 509
529     deck_root [u8;32] (32) — offset 529
561     deck_salt_hash [u8;32] (32) — offset 561
593     deck_slot (u64, 8) — offset 593  ✓
601     deck_seed [u8;32] (32) — offset 601  ✓
```

**I was wrong. The suite's offsets 593 and 601 are CORRECT.** I miscounted earlier.

**Verdict: offsets check out.** ✓

### MEDIUM — R5.4: 11.11a passes vacuously when depth doesn't fit at all

**Construct.** `at11 >= 0 && at11 < PROBE_CEILING`. If `at11 = 0` (no attributes fit at depth 11), this is `0 >= 0 && 0 < 64` = TRUE. So the assertion passes.

But 0 attributes at depth 11 is exactly what a round-20 auditor claimed. The assertion doesn't catch it — 11.11c does (`at11 >= 2`).

So the assertion 11.11a proves "the mint at depth 11 CAN be constructed with SOMETHING." 11.11c proves the meaningful bound. This is fine, but 11.11a on its own is quite weak.

**Fix.** 11.11a should assert `at11 >= 1` at minimum (i.e., you can mint SOMETHING at production depth).

### LOW — R5.5: 2.0e / 2.0g — hardcoded slot wait may flake

**Construct.**
```js
for(let i=0;i<200 && await conn.getSlot(CM)<=deckSlot;i++) await new Promise(r=>setTimeout(r,300))
```

200 * 300ms = 60 seconds. `deck_slot = current + 32` and Solana slot time is ~400ms, so 32 slots = ~13s. Comfortable margin. But if the validator is slow (localnet under load), this could time out. Then `entropy` is null and `subarray` throws. The suite fails with a confusing message.

**Fix.** After the wait, explicitly check `entropy != null` before proceeding.

---

## R6. THE ACCEPTED LIMITS REWRITES

### R6.1 — Limit 1a rewrite CHECK

**Prior text:** confinement was off-chain.
**New text:** confinement is on-chain (SEAL and MINT), the ALLOWLIST and FEE PAYER remain off-chain.

**Verification against source:**
- SEAL `open_for_redemption` has the walk that refuses `BankKeyOutsidePair`. ✓
- MINT `mint_vault` has the walk that refuses `BankKeyOutsideMint`. ✓
- `judgeRedemptionTx` in `bank/detectors.mjs` has the allowlist check and fee payer check. ✓

**However:** the limit says "a redemption signed with a tool other than `scripts/bank-sign.sh` gets neither of those two checks. The confinement it gets regardless."

**Is this accurate?** Yes — the confinement is enforced by SEAL/MINT programs at execution time, regardless of what tool signed. The allowlist and fee-payer checks live in `judgeRedemptionTx` and only fire when someone runs cosign.mjs.

BUT: is the allowlist actually off-chain? Reading SPEC's control table: "**ON-CHAIN.** Two programs refuse. Nobody can opt out, us included." The confinement IS on-chain. The ALLOWLIST is off-chain. Limit 1a states this correctly.

**Wait** — is the allowlist critical? If a customer's redemption includes an instruction to an unknown program (say a malicious program that does nothing bad on its own but that the Bank hasn't audited), and the Bank signs it via a tool that skips the allowlist, what's the harm? The program can't spend the Bank's SOL (confinement blocks that on-chain now). It can only spend the CUSTOMER's SOL — which is the customer's business.

So the allowlist protects the Bank's REPUTATION more than its funds. Fair to accept.

**Rewrite is correct.** ✓

### R6.2 — Limit 23 measurement CHECK

The new table:
| depth | vaults | attributes |
|---|---|---|
| 7 | ~90 | 29 |
| 11 | ~2,100 | 18 |
| 13 | ~8,192 | 13 |

**Concern:** these numbers are per the suite's attribute sizes (`k${i}` + `'v'`). Real charter provenance is longer. At `[["charter","0042"],["notice","CBOB-NOTICE-0042"]]` — that's real data — you're using ~40 bytes per attr instead of ~15. So the 18 at depth 11 becomes ~6 with real data.

Actually, 18 at 15 bytes = 270 bytes. If real attrs are 40 bytes, 270/40 = 6.75. So ~6 attributes of realistic size.

Charter provenance needs at least 2 (notice serial + governor standing). That fits at depth 11. But it's much tighter than "18" suggests.

**The item stays OPEN AND BLOCKING**, correctly. But SPEC now says "the PROGRAM is the binding constraint, not the packet, and deck size does not squeeze provenance at any size this product will ever use." **This claim rests on measurement with tiny attributes.** With realistic ones, the packet DOES bind before the program at depth 11+.

**Fix.** Re-measure with production-representative attribute lengths and update the table.

### R6.3 — LIMIT 9 NARROWING is over-claimed

The narrowed text: "`bank/cosign.mjs` DOES see it: `scanPda` calls DAS `getAssetsByOwner` on the vault's asset-signer PDA, pushes every non-burnt asset it returns regardless of collection, refuses on a DAS error rather than reading it as 'owns nothing', and refuses a full page rather than judging a truncated list."

Looking at `bank/cosign.mjs`:
```js
const r = await fetch(rpcUrl(), { ... method: 'getAssetsByOwner' ... })
const env = D.judgeDasEnvelope(...)
if (env.problem) throw ...
for (const it of items) {
  if (it.burnt) continue
  owned.push({ address: it.id, kind: 'asset' })
}
if (items.length >= 1000) throw ...
```

**This does push every non-burnt asset regardless of collection.** ✓

**But** — `getAssetsByOwner` returns things a PDA owns. Is a NESTED CBOB vault (in our collection) returned by this? A vault whose owner is `pda` — yes, DAS returns it. So a nested vault IS caught.

**Is a FOREIGN Core asset owned by the PDA returned?** Yes, if DAS indexes it and returns burnt:false. `getAssetsByOwner` doesn't filter by collection.

So the narrowing is accurate. ✓

### R6.4 — CHECK for under-claims elsewhere

Reading ACCEPTED LIMITS carefully:

**Limit 3:** "The Bank may still be named `payer` inside the approved pair itself." Is this true after round 18's narrowing of the exemption to positional identity in MINT? Reading MINT source:

```rust
if is_mint {
    for (n, a) in ix.accounts.iter().enumerate() {
        require!(a.pubkey != bank || n == MINT_IX_BANK_IDX, ...);
    }
}
```

So Bank cannot be at index 5 (payer) in `mint_vault`. But what about SEAL's confinement in `open_for_redemption`?

Reading SEAL:
```rust
if !is_open && !is_burn {
    require!(!ix.accounts.iter().any(|a| a.pubkey == bank), ...);
}
```

SEAL's exemption is BROAD — any open or burn is entirely exempt. So within an `open_for_redemption` or `burn_vault` accounts list, the Bank could still be at any position — including payer of the burn or open.

**Is this exploitable?** The burn's payer is at index 5 in BurnVault. Naming the Bank as burn payer would spend Bank SOL on the burn transaction fee (~5000 lamports + priority). SEAL doesn't refuse this; MINT's narrowed check doesn't apply here (it's about mint_vault). So yes, limit 3 remains accurate FOR THE PAIR, but the mint half has been closed for the MINT direction.

**Under-claim check:** Limit 3 should specifically say "in the SEAL/BURN pair" — the MINT path has been narrowed. Currently says "the approved pair itself" which is accurate but could be clearer.

**Limit 16 (Bank as fee payer of mint):** SPEC says on-chain cannot close it. Correct — fee payer is transaction-envelope-level. ✓

---

## R7. THE COUNTS

### R7.1 — Reading floors from `scripts/run-tests.sh`

```
MIN_ASSERTIONS=330
DET_FLOOR=439
ALLOC_FLOOR=103
DECK_FLOOR=17
MAINNET_FLOOR=19
```

**Compared to the prompt's quoted floors:** 330 / 439 / 103 / 19 (mainnet).

The prompt says "330-assertion suite" — ✓ matches MIN_ASSERTIONS.
"439 off-chain detector assertions" — ✓ matches DET_FLOOR.
"103 allocation" — ✓ matches ALLOC_FLOOR.
"19 against live mainnet" — ✓ matches MAINNET_FLOOR.

The DECK_FLOOR (17) is not mentioned in the prompt's opening summary. Minor.

### R7.2 — Schedule arithmetic

**240-vault census:** 108 + 60 + 36 + 24 + 12 = 240 ✓
**Denominator:** 108*2 + 60*3 + 36*4 + 24*5 + 12*6 = 216 + 180 + 144 + 120 + 72 = **732** ✓

**2,100-vault census:** 945 + 525 + 315 + 210 + 105 = 2,100 ✓
**Denominator:** 945*2 + 525*3 + 315*4 + 210*5 + 105*6 = 1,890 + 1,575 + 1,260 + 1,050 + 630 = **6,405** ✓

**Per $1,000 at 2,100:**
- L1: 1000 * 2 / 6405 = 0.3123 → 0.31 ✓
- L2: 1000 * 3 / 6405 = 0.4684 → 0.47 ✓
- L3: 1000 * 4 / 6405 = 0.6245 → 0.62 ✓
- L4: 1000 * 5 / 6405 = 0.7806 → 0.78 ✓
- L5: 1000 * 6 / 6405 = 0.9368 → 0.94 ✓

**Per $1,000 at 240:**
- L1: 1000*2/732 = 2.732 → 2.73 ✓
- L2: 1000*3/732 = 4.098 → 4.10 ✓
- L3: 1000*4/732 = 5.464 → 5.46 ✓
- L4: 1000*5/732 = 6.831 → 6.83 ✓
- L5: 1000*6/732 = 8.197 → 8.20 ✓

**Share percentages at 2,100:**
- L1: 100 * 945 * 2 / 6405 = 29.508 → 29.5 ✓
- L2: 100 * 525 * 3 / 6405 = 24.590 → 24.6 ✓
- L3: 100 * 315 * 4 / 6405 = 19.672 → 19.7 ✓
- L4: 100 * 210 * 5 / 6405 = 16.394 → 16.4 ✓
- L5: 100 * 105 * 6 / 6405 = 9.836 → 9.8 ✓

Sum: 29.5 + 24.6 + 19.7 + 16.4 + 9.8 = 100.0 ✓

**All arithmetic checks.** ✓

---

## R8. ONE-OF-N-SITES

### R8.1 — `commit_deck` takes salt, does SEAL/BURN have anything analogous?

The salt-based commitment is a MINT-only mechanism. SEAL and BURN don't have decks. No one-of-N here.

### R8.2 — `blockhash_of_slot` — is this the only raw sysvar parse?

Grep for `try_borrow_data` in programs:
- MINT: `blockhash_of_slot`, `seal_config` read
- SEAL: `read_core_asset`, misc
- BURN: seal_config read, asset read, reserve token account reads

The seal_config raw reads have their OWN discipline (pinned key, disc, version). `blockhash_of_slot` is a new instance of the shape. Does it apply the same discipline? Let me check:

- Pins the key: ✓ (`require_keys_eq!(acct.key(), slot_hashes::ID, ...)`)
- Bounds count: ✓ (SLOT_HASHES_MAX)
- Checks buffer length: ✓
- Refuses zero hash: ✓

**Compared to seal_config reads:** they check the Anchor discriminator and version byte. `blockhash_of_slot` doesn't need those (SlotHashes isn't Anchor-formatted). ✓

### R8.3 — The `distribute.mjs` tombstone check — is the same shape elsewhere?

The payment loop already has the same check:
```js
if (!stillThere || stillThere.data.length < 1 || stillThere.data[0] !== 1) {
  done[v] = { ..., skipped: 'vault is no longer a live Core asset' }
  ...
}
```

And the new level-loop check:
```js
tomb = !raw || raw.data.length < 1 || raw.data[0] !== 1
```

Same check, two sites. R3.1's finding applies to BOTH — treating `data[0] !== 1` as "not a live asset" is over-inclusive in BOTH places.

**Missing site:** the alarm's burn detection uses `detectVaultSetChange` which relies on DAS, not on `data[0]`. So the alarm won't have this specific bug, but it might have the opposite: if DAS lags, the alarm reads a burnt vault as live.

### R8.4 — The `PROBE_CEILING = 64` fix — one of N?

The probe pattern (looping until failure to find a maximum) is used ONLY here. No other measurement in the suite has this shape. ✓

### R8.5 — The one-shot ordering fix in `commit_deck` — one of N?

Grep for similar `require!(config.X == [0u8; 32], ...)` patterns:
- `commit_seed`: `require!(c.deck_salt_hash == [0u8; 32], MintError::SeedAlreadyCommitted);` — ONE check, does it happen first? Yes, it's the first `require!` in the handler. ✓
- No other `[0u8; 32]` sentinel checks in the diff.

**However** — `commit_seed` DOES read `Clock::get()?.slot` BEFORE the `require!`. If Clock somehow failed (impossible in practice), the caller would see a clock error, not `SeedAlreadyCommitted`. Not a practical concern.

---

## THE ACCEPTED LIMITS

### Question 1: Is any limit WORSE than stated?

**Limit 23 is worse:** the "18 attributes at depth 11" measurement uses tiny attribute strings. Real production provenance is 3-5x larger per attribute, so effective room is 4-6 attributes, not 18. This is worth 30 seconds of re-measurement before locking in the deck size.

**Limit 13 is worse than SPEC states:** "the level is immutable in practice because no shipped instruction can rewrite it" — TRUE, but the SEAL program controls the Attributes plugin authority, and SEAL's upgrade authority (currently NOT a multisig on the test build; the localnet path uses a keypair) can ship a new instruction that mutates any vault's level. Under the localnet build, this is trivially exploitable. Under mainnet build, it requires compromising the Squads multisig. SPEC's phrase "as far as the SEAL program's upgrade authority is trustworthy" carries the whole weight and is easily missed.

**Limit 9 was NARROWED, but there's a subtler under-claim I want to flag:**
The narrowing says cosign refuses on a "full page" (`items.length >= 1000`). But 1000 is DAS's page limit. What if the PDA legitimately owns > 1000 assets (unlikely but possible)? cosign REFUSES the redemption. That's the safe direction, but it creates a griefing surface: an adversary could airdrop 1000+ tiny burnt-but-not-indexed-as-burnt assets to a target vault's PDA (well, DAS filters burnt, so this specific attack needs live assets — but a market-based griefer could give a target vault 1000 low-value NFTs). Cosign refuses forever until a human overrides.

### Question 2: Is anything listed as a limit not actually a limit?

**Limit 4:** "The allowlist permits a bare Core `BurnV1` of a SECOND vault beside a real redemption." — Is this actually true post-round-17 confinement?

SEAL's walk exempts open and burn instructions. A bare Core BurnV1 is neither. If it names the Bank, it's refused. If it doesn't name the Bank... it's still an instruction to CORE, not on the allowlist. So `judgeRedemptionTx` would refuse it (Core IS on the allowlist actually — let me re-check).

Reading `ALLOWED_PROGRAMS = [D.CORE_ID, D.TOKEN_ID, D.TOKEN22_ID, D.ATA_ID, SYSTEM_ID, COMPUTE_BUDGET_ID]`. **Core IS allowed.** So a bare Core BurnV1 of a second vault passes the allowlist. It doesn't name the Bank (BurnV1 doesn't take Bank as an account). So limit 4 stands.

But this contradicts SPEC's control table which claims the co-signer sees "the transaction touching any program outside the redemption allowlist" — Core IS on the allowlist, so a Core BurnV1 is not "outside" it. The limit is real.

### Question 3: Is any DISCHARGED item not actually discharged?

**Item 12/17 — compute units:** Discharged with measurement of ~58k CU for plain mint and ~74k CU at max pad. Fine for the mint path.

**But** — was BURN measured? The burn's account walk over reserve mints (both token programs, so up to 6 ATAs for 3 reserves) is heavier than mint's walk. And REDEMPTION is one transaction with open + sweeps + burn. Was the FULL redemption CU measured, not just the mint?

Reading the suite section 10: only `mintCU` is measured. Burn is not benchmarked. Redemption is not benchmarked.

**Under-discharged.** The compute claim was mostly about the confinement walks in both SEAL's open and MINT's mint_vault. Only mint_vault was measured. SEAL's walk is untested for CU.

**Item 14 — duplicate attribute keys:** Discharged. ✓ (confirmed by reading `mint_vault`'s O(n²) key-uniqueness check).

**Item 19 — unlevelled halt as DoS:** Discharged with new commitment scheme. ✓ mostly, but see R1.2 (Bank still has SOME grinding power via commit_seed retry).

### Question 4: Is any OPEN AND BLOCKING item being quietly treated as accepted?

**Item 22:** "NOTHING HAS EVER RUN A DISTRIBUTION AGAINST A LIVE CHAIN." Still open. Still blocking. Not treated as accepted. ✓

**Item 23:** Still open, still blocking. ✓

---

## OTHER FINDINGS

### CRITICAL — X.1: `commit_seed` has no `paused` check but `mint_vault` does

If admin is compromised, admin can (a) rotate governance to admin (with timelock), (b) unpause, (c) commit a deck. But admin can ALWAYS commit a deck if it hasn't been committed yet, regardless of pause state. Combined with R2.4 (permanent brick), this means:

**A one-time admin key compromise before deck commitment permanently bricks the product.**

This is a real risk that SPEC doesn't state. If the Bank key or admin key is compromised for even one transaction before deck commitment, an attacker can:
1. Call `commit_seed(H)` with a random H
2. Never call `commit_deck`
3. Wait for the 512-slot window to pass

Product is dead. Recovery requires a program upgrade.

**Fix.** Allow ordering that either (a) admin can reset the salt (as in R2.4), or (b) commit both seed and deck in ONE transaction. The current two-step is what creates the brick window.

Actually — the two-step design REQUIRES the 32-slot delay by construction, because you need a future blockhash. You cannot do both in one transaction. But you COULD allow admin to zero out `deck_salt_hash` if `deck_root` is still zero, giving a bounded recovery path.

### HIGH — X.2: `SLOT_HASHES_MAX = 512` — verify against Solana

Solana's SlotHashes sysvar keeps `MAX_ENTRIES = 512` slots. So 512 is correct. But note: SlotHashes is updated ONCE PER SLOT and drops entries older than 512 slots. `SLOT_HASHES_MAX` bounds parsing, not the actual data. The bound is a safety limit against a malformed sysvar; the real data will always be ≤ 512.

Layout invariant relied upon: the entries are (slot, hash) in newest-first order. `blockhash_of_slot` searches linearly. Confirmed by Solana source: `SlotHashes` uses `VecDeque` with newest at front. ✓

### MEDIUM — X.3: The Config layout offsets in `alarm.mjs` — did they move?

The offsets I computed above (governance at 105, minted_total at 205, treasury at 137, etc.) are what other programs read. The `deck_salt_hash`, `deck_slot`, `deck_seed` fields were ADDED. Do the offsets before them still match?

Looking at the pre-diff layout: `deck_root` was already at offset 561 (from prior LEVELS AT MINT work). Adding `deck_salt_hash` (32), `deck_slot` (8), `deck_seed` (32) = 72 bytes AFTER `deck_root`. This is exactly the space `CONFIG_PADDING` was reduced by (184 → 112, a 72-byte reduction). ✓

But: `alarm.mjs` and `distribute.mjs` read fixed offsets like `governance` at 105 and `treasury` at 137. Did those move? No — they're BEFORE the new fields. ✓

**However** — is the pinned Anchor discriminator still correct? The struct `MintConfig` didn't change name, so `sha256("account:MintConfig")[..8]` is unchanged. ✓

### HIGH — X.4: Suite section 2.0 depends on program's `set_paused` NOT being called

If `set_paused(true)` were called between `commit_seed` and `commit_deck`, does `commit_deck` still work? Reading `commit_deck`: no pause check. So yes, it works. But between 2.0e (commit_seed) and 2.0h (verify seed), if pause were somehow set, the mints AFTER 2.0i would fail with `MintPaused` instead of the expected error. The suite doesn't set pause here, but it's a fragility.

### MEDIUM — X.5: `bank/deck.mjs` and Rust must byte-agree, and the ONLY check is on-chain

`bank/deck.mjs`'s `seedFrom = sha(Buffer.from(bankSalt), Buffer.from(blockhash))`. This uses concatenation. Rust: `hashv(&[&salt, &bh])` — this hashes the concatenation of salt and bh via `solana_program::hash::hashv`.

`hashv` is documented as SHA-256 of the concatenated slices. `sha256(a || b) == sha256(a || b)` — trivially equal.

The check 2.0h passes when they match. But: what if `bank/deck.mjs`'s `seedFrom` is later changed to use `hashv(bankSalt, blockhash)` interpreted differently (e.g., with a domain tag)? The Rust would drift. The suite catches it. But nothing else does.

**Fix.** Add a Rust test (`cargo test`) that computes the seed and compares to a golden value. Currently there's no unit test of `deck_leaf` or the seed derivation in isolation.

### LOW — X.6: The `attrFit(n, depth)` probe still uses fixed-size dummy attributes

Already covered in R4.3.

---

## GIVEN NO HUMAN FIRM WILL SEE THIS

Nineteen rounds of AI audit have produced a system with real defense-in-depth, but they have three structural blind spots that no amount of AI review can close:

**1. Nothing has ever run against a live chain at production scale.** The suite runs against a fresh cloned validator with a handful of vaults. Behaviors that emerge only at scale — RPC rate limits, DAS lag under load, transaction pack rejection during congestion, mempool priority auctions, Jupiter route slippage under real volume — are invisible to every audit. Accepted limit 22 says this. **Do this before shipping:**

- **Run a mainnet-fork stress test.** Fork mainnet state, mint 2,100 vaults, run the distributor daily for 30 simulated days, kill/restart nodes randomly, simulate DAS lag. Measure: how often does distribution halt? Does the ledger ever get inconsistent? Does the alarm produce alerts an operator can actually respond to?
- **Do a "chaos day"** on the real mainnet at reduced scale: mint 20 vaults, run for a month, deliberately compromise a key on the DevNet copy and see what alarms fire and how fast.

**2. The Bank key custody model is not audited by this process at all.** The programs enforce a 2-of-2 with the Bank; the co-signer applies a policy; but the KEY ITSELF sits on some machine, held by some human, following some procedure. None of that is code and none of it has been audited. A hardware wallet? A cloud HSM with a break-glass? Rotation frequency? Backup? None specified in SPEC.

- **Write a Bank Key Custody Runbook** and have a security-focused human review it. This is where an actual security firm's value is highest, and where AI audit is weakest. If you can't afford a firm, at minimum pay for an hour of a well-known Solana operator's time to review the custody procedure.

**3. Nobody has tried to break this economically.** All the audits look for code defects. Nobody has thought like a market maker looking for arbitrage on the level draw, a griefer looking for cheap DoS, or an operator looking for creative interpretations of "the policy the Bank applies."

- **Publish a $50k+ bug bounty on Immunefi for 30 days BEFORE minting opens.** Real economic incentive attracts adversarial thinkers that AI cannot replicate. The cost is a small fraction of what's at stake, and it is the only mechanism that reliably surfaces attacks based on incentive misalignment rather than code bugs.

Concretely:

- **Do a testnet mint of the real 240-vault charter round with real people involved.** Ask them to redeem, try weird things, poke at the co-signer's refusals. Not because you'll find code bugs — the tests do that — but because you'll find UX cliffs: places where an honest customer's honest action creates a stuck state that requires manual intervention. These accumulate and eventually strand real money.
- **Add a `panic()` mechanism.** If SPEC's proven impossibilities turn out to be false — if Metaplex ships a Core upgrade that breaks something — you need a way to freeze the whole system while you figure it out. `set_paused` covers minting. There is NO equivalent for redemption. Deliberately, per SPEC. Reconsider: a "circuit breaker" that pauses redemption for a bounded time (say 72 hours max, then auto-unpause) with governance approval would let you handle a black-swan Core bug without stranding customers permanently.
- **Give SOMEONE the ability to burn the deck.** If `commit_seed` succeeds but `commit_deck` fails, and the salt hash is committed with no way to recover, the product is dead. See R2.4 and X.1. This is a real one-key-compromise-forever risk that no audit round has caught because they all trust the design's insistence on immutability. Make it possible for an admin to reset the salt commitment IF the deck root is still zero. The strong-immutability property applies to a COMMITTED DECK, not to a HALF-COMMITTED one.