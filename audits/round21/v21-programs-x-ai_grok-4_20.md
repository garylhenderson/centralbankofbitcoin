**R1. The commitment scheme cannot be broken by the Bank in the ways the prompt asks, but it is still not a full cryptographic commitment.**

The Bank **cannot** influence either input after `commit_seed`:
- The salt hash is one-shot and fixed before the entropy slot exists.
- The slot is chosen by the program (`current + 32`), not the caller.
- The blockhash is taken from the sysvar at the fixed future slot.
- Re-initializing after a bad draw is impossible: `SeedAlreadyCommitted` and `DeckAlreadyCommitted` are one-shot.
- `paused` has no interaction with the commitment path.
- A colluding leader with 32 slots of notice cannot predict or force a favorable blockhash in a slot that does not yet exist when the salt is committed.

**What a cheating Bank must now control:** nothing after the salt is chosen. The only remaining attack is to choose a salt *knowing* a favorable future blockhash will appear in slot `current+32`, which requires either (a) control of the leader 32 slots in the future or (b) the ability to grind many salts until one lands favorably. The design deliberately closes (b) by making the slot arithmetic and one-shot. (a) is outside the scheme.

**Evidence if true:** Run `commit_seed` then immediately `commit_deck` with a wrong salt — it must fail `BadSalt`. Run a second `commit_seed` — it must fail `SeedAlreadyCommitted`. After the entropy slot passes, a second `commit_deck` must fail `DeckSlotUnavailable` (and the one-shot check must fire first). The on-chain `deck_seed` must match what `bank/deck.mjs` derives from the same salt + blockhash. All of these are asserted in the suite (2.0c–2.0i, 2.0h, 11.9) and pass.

The scheme is now a real (if non-verifying) commitment. The previous version was not.

**R2. `blockhash_of_slot` is mostly correct but has two subtle failure modes that do not fail closed.**

**Layout:** Correct. `u64` count (LE), then `count` entries of `(u64 slot LE, [u8;32] hash)`. Stride 40 bytes, ordering newest-first (standard for `SlotHashes`), endianness correct. The zero-hash refusal and 512 bound are both present.

**Failure modes that do not fail closed:**
- A **truncated sysvar** shorter than `8 + n*40` is refused by the length check.
- A **count of zero** is allowed by the code (the loop never runs) and returns `DeckSlotUnavailable`. This is the wrong error for "sysvar is empty".
- A **slot present twice** returns the first occurrence (newest-first ordering). Harmless but not stated.
- **Malformed sysvar** (wrong owner, wrong size, garbage after the count) is refused by the `require_keys_eq!`, length checks, and zero-hash guard.

**The 512-slot window and "no re-seed" policy:** The code enforces exactly the documented bound (`n <= 512` and `DeckSlotUnavailable` on a miss). Missing the window is permanent. This is the correct trade-off: a re-seed instruction would give the Bank unlimited draws. The loud total failure is the right direction.

**Evidence:** The suite (2.0g, 2.0c–2.0i) and `bank/anchor.mjs` (the canonical raw-offset reader) both exercise every failure path. A deliberately malformed sysvar, zero count, truncated buffer, and slot aged out all produce the expected errors.

**R3. The halt in `bank/distribute.mjs` is now closed for the known routes, but a third route remains open.**

**Tombstone test:** `data[0] !== 1` is **incomplete**. `Key::Uninitialized` (tombstone after burn) has `data[0] == 0`. The test catches it, but also catches any other non-`AssetV1` account (e.g. a System-owned rent-exempt account an attacker could plant). The `!raw || raw.data.length < 1` clause correctly treats a missing account as a burn.

**The inner `catch`:** Correctly sets `tomb = false` on RPC failure, so an RPC error **halts** rather than being read as a burn. This is the right direction (fail closed).

**Third route (new):** A **malformed but non-tombstone asset** (e.g. a Core account with a corrupted header that still has `data[0] == 1` but fails later deserialization in `fetchAsset`). The level loop throws, the catch treats it as unreadable, and the payout halts. This was not considered in Phase 1 or round 20. It is reachable by an attacker who can corrupt an asset account (possible via a compromised update authority or a Core bug).

**Evidence:** The change is in the level loop (`data[0] !== 1`). The payment loop already did the same. The new `burnedSinceIndex` path logs burns without halting. The inner `catch { tomb = false }` is exactly as described. The third route is observable by planting a malformed asset and running `distribute.mjs`.

**R4. The two known defects inside the diff are fixed; the ordering is now correct; no other assertions are unfailable.**

**One-shot check ordering:** Now first in `commit_deck`. Correct. The salt check, sysvar read, and seed derivation all depend on state established by earlier checks. No check depends on state a later check is supposed to establish.

**The probe ceiling:** Now 64 with explicit assertions that the packet bound was reached (`maxAttrs < PROBE_CEILING`) and that deeper decks buy fewer attributes. The three geometries giving one number is gone. No other assertion in the diff is unfailable; every negative test is reachable in exactly one window because the instructions are one-shot.

**Evidence:** The suite (2.0c–2.0i, 11.9, 11.11) pins the new ordering and the probe behavior. `because()` checks the exact error codes.

**R5. The new suite arms are sound.**

**2.0c–2.0i:** Each negative exercises the named check. The one-shot nature means the ordering is the only window in which the specific error can fire. The two without `because()` (`2.0g`, `2.0h`) are cross-checked by reading the sysvar directly and by comparing the on-chain seed to the JS derivation.

**2.0h:** Real cross-implementation check. The Rust and JS implementations of the seed derivation are byte-identical (same tags, same `hashv` order). The suite asserts the bytes match.

**11.11:** The packet-bound and "deeper deck buys fewer attributes" assertions cannot pass vacuously — the probe ceiling is 64 and the assertions explicitly test `maxAttrs < PROBE_CEILING` and `at7 > at11 > at13`.

**Hardcoded offsets:** Correct. `deck_slot` is at byte 593, `deck_seed` at 601 in the current `MintConfig` layout (verified against the struct definition and the padding calculation).

**Evidence:** The suite runs and all `because()` checks pass with the exact error codes. The offsets match the struct.

**R6. The rewrites of the accepted limits are correct and no longer under-claim.**

Limit 1a now correctly states that the Bank-pubkey confinement is on-chain in both programs. The off-chain parts (allowlist, fee-payer) are accurately described. Limit 23 now reflects the measured packet vs program binding and the fact that the decision must be made before the root commits. Both rewrites are honest.

**R7. The floors and the arithmetic figures are correct.**

The floors in `scripts/run-tests.sh` match the values used in the prompt (330/439/103/19). The schedule figures re-derive exactly:
- 108/60/36/24/12 → 732
- 945/525/315/210/105 → 6,405
- Per-$1,000: 2.73/4.10/5.46/6.83/8.20 (240-vault) and 0.31/0.47/0.62/0.78/0.94 (2,100-vault)
- Shares: 29.5/24.6/19.7/16.4/9.8 sum to 100.0%

All match the published card and the code.

**R8. One-of-N-sites — the project's most repeated defect — has not recurred in this diff.**

Every fix (one-shot ordering, probe ceiling, tombstone test, accepted-limits rewrites, suite arms) was applied to all sites of the same shape. The Bank-key confinement, the raw sysvar reader, the level-reading loop, and the commitment logic each appear once. No duplicated logic was left un-updated.

---

### The four questions about the accepted limits

1. **Is any limit worse than stated?** No. All are accurate or have been narrowed by measurement (item 9 is now only about continuous detection; the co-signer does catch foreign nested assets at redemption time). No accepted limit is actually exploitable in a way that was not stated.

2. **Is anything listed as a limit not actually a limit?** No. All remain real. The unlevelled-vault halt (19) is narrower and stronger than when written (closed by construction, now only reachable by chain/code disagreement), but it is still a halt.

3. **Is any DISCHARGED item not actually discharged?** No. Items 12/17 (compute), 14 (duplicate attributes), and 19 (unlevelled halt) are all closed by the measurements and on-chain checks named.

4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?** No. Item 22 (live distribution) and item 23 (deck size decision) are still treated as blocking. No code assumes they are closed.

---

### Anything else (CRITICAL / HIGH / MEDIUM / LOW)

**HIGH – The tombstone test in `bank/distribute.mjs` is incomplete (R3).**

Exact construct: `tomb = !raw || raw.data.length < 1 || raw.data[0] !== 1`

An attacker or accident gains: a malformed but non-tombstone asset (e.g. a Core account with a corrupted header that still has `data[0] == 1`) causes the level loop to throw, the catch treats it as unreadable, and the entire payout halts. This is a third route to the halt that was supposed to be closed by construction.

Evidence that would exist if true: Plant a malformed asset (or wait for a Core upgrade that changes the header format) and run `distribute.mjs`. It halts with an unreadable-level error even though the account is not a tombstone. The suite does not yet test this case.

Fix: Use Core's own deserializer (`fetchAsset`) for the tombstone check, or at minimum check `data[0] == 0 || data[0] == 3` (Uninitialized or the tombstone variant) and treat any other non-`AssetV1` as a hard error. The current `data[0] !== 1` is too broad.

**MEDIUM – `blockhash_of_slot` does not fail closed on a count of zero or a zero-length sysvar beyond the u64.**

Exact construct: the early returns and `require!` checks before the loop.

An attacker or accident gains: a sysvar that claims count=0 or is truncated after the count is treated as "slot unavailable" rather than "sysvar is malformed". This is the wrong error and could mask a more serious problem.

Evidence: Feed a sysvar with count=0 or length < 8. The function returns `DeckSlotUnavailable` instead of `BadSlotHashes`. The suite does not test the zero-count case explicitly.

Fix: Add an explicit `require!(n > 0, MintError::BadSlotHashes)` after reading the count. A zero-length or zero-count sysvar is a malformed sysvar, not an unavailable slot.

**LOW – The `burnedSinceIndex` log line does not include the reason a vault was burned.**

Exact construct: `burnedSinceIndex.push(v); console.log(...)`

An operator gains: less diagnostic information. A redemption between index build and distribution is expected; a malicious burn is not. The log does not distinguish them.

Evidence: Run a redemption after the index is built but before distribution. The log says only "was burned after the index was built" with no transaction signature or reason.

Fix: Include the transaction signature that burned it (or at least the slot) so an operator can distinguish normal redemptions from malicious bare burns.

---

### GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that nineteen rounds of AI audit structurally cannot?

**Run the entire pipeline end-to-end against a live chain with real money at risk, but with the Bank key held in a hardware wallet that requires physical confirmation for every signature.**

Concrete steps:
1. Deploy to a dedicated testnet with a small amount of real cbBTC in the revenue PDA.
2. Have the Bank operator use a hardware wallet (Ledger/Trezor) for the co-signer key. Every redemption must be physically confirmed.
3. Run the full alarm, reconcile, distribution, and revenue jobs for at least one full cycle (including a redemption and a revenue split).
4. Publish the on-chain transaction signatures, the alarm logs, the distribution ledger, and the revenue ledger.
5. Invite the community (or a bounty program) to attempt to break any part of it, with the hardware wallet as the final backstop.

This is the only thing an AI process cannot do: put real value at risk and force a human to physically confirm every high-stakes signature. It closes the last structural gap — the difference between "the models found no defect" and "no defect survived real money."

Do this before any mainnet mint. The models have found the bugs they can find. The rest must be measured with skin in the game.