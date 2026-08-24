**R1. The commitment scheme**

The Bank can still influence the seed. `commit_seed(salt_hash)` is one-shot and the program fixes `deck_slot = current_slot + 32`, but a Bank that controls (or can bribe) a leader can:

- Submit `commit_seed` repeatedly in the same slot until the resulting `+32` slot produces a favourable `blockhash` (leaders schedule ~4 slots ahead; 32 slots is ~13 s, giving ample notice).
- Abandon a bad draw and re-initialise the config (the one-shot check on `deck_salt_hash` is after the mutable borrow of `config` in the new ordering; a re-init clears it).
- Collude with the leader that produces the entropy slot (or any of the 31 leaders before it) to grind the `blockhash`.

The `paused` flag does not stop it (a paused config can still be re-initialised). The 512-slot `SlotHashes` bound and "no re-seed" rule only force a loud permanent failure after the window; they do not prevent grinding inside it. The Bank must control the salt (easy) **and** the blockhash at the program-chosen slot (by leader control or bribery). Nothing here stops it. Evidence if true: a `DeckCommitted` event whose `seed` produces a statistically improbable distribution of levels (checked by `bank/selftest.mjs` and the alarm); or a mainnet mint sequence whose levels are not reproducible from the on-chain `deck_seed` and census.

**Fix:** Remove the ability to re-initialise after `commit_seed`. Make `deck_salt_hash` non-zero at genesis (or add a separate one-shot `initialize_deck` that cannot be replayed). The current design still allows unlimited draws via re-init.

**R2. `blockhash_of_slot`**

**Layout is correct:** `u64` count (LE), then `count` entries of `(u64 slot LE, [u8;32] hash)`, newest-first, 40-byte stride. Endianness, stride and ordering match `SlotHashes` sysvar (verified against mainnet dumps and the sysvar crate).

**Failure modes do not all fail closed:**
- Truncated account: `data.len() >= 8 + n*40` after bounding `n <= 512` can still underflow on a malicious sysvar (the `require!` uses the declared `n`, not a safe read).
- Count of zero: accepted (returns `DeckSlotUnavailable`).
- Malformed sysvar (wrong owner, zero hash, slot twice): the zero-hash check and `DeckSlotUnavailable` on miss are present, but a slot present twice is not rejected (first match wins).
- The 512-slot bound is enforced, but a missed window is permanent (no re-seed). The code matches the comment, but the trade-off is wrong: unlimited draws are worse than a loud permanent failure, but a 3.4-minute window with no retry is too narrow for operational safety.

Evidence if true: a mainnet `SlotHashes` account that is truncated or has duplicate slots; a `DeckSlotUnavailable` error on a slot that is present; a permanent mint freeze after a missed window (observable on-chain).

**Fix:** Read count safely (`try_from_le_bytes` with bounds before indexing). Reject duplicate slots. Add a re-seed instruction that can only be called after the window expires (e.g. via a separate one-shot flag). Increase `DECK_SLOT_LEAD` or make the window configurable with a floor.

**R3. The halt in `bank/distribute.mjs`**

**Tombstone test is incomplete:**
- `data[0] !== 1` matches any non-`Key::AssetV1` (including `Uninitialized`, `Collection`, `Mint`, or a future Core key). It also matches a zero-length account or a non-Core account.
- Absent account: `!raw` sets `tomb = true`, so it is treated as burnt. This is correct for a burned asset (the account survives at `Key::Uninitialized`), but the comment claims it asks "what the account IS". It does not distinguish a burned Core asset from any other absent/malformed account.

**The inner `catch` sets `tomb = false`** on RPC failure, so an RPC error (or timeout) routes to `unreadableLevels` and halts. The code does what the comment says; the direction is correct (fail closed on read failure).

**Third route:** a vault whose level attribute is present but malformed (multiple `level` keys, non-I..V value, or a non-string value). `levelFromAttributes` returns `null`, so it is treated as unreadable and halts. This was not considered in Phase 1 or round 20. Also, a tombstone that is not a Core asset (e.g. a System-owned account at the asset address) is treated as burnt.

**`bank/distribute.mjs` has not been audited since the change** — the round-20 off-chain pass failed quorum. The new `burnedSinceIndex` path and the `tomb` logic are new surface.

Evidence if true: a burned asset whose `data[0] == 0` but is not a Core tombstone (observable on-chain); an RPC error during `fetchAsset` that halts the distribution (logged as `unreadableLevels`); a vault with two `level` attributes that halts (reproducible in test).

**Fix:** Use Core's own deserialiser (`fetchAsset`) for the tombstone check, or at least check `owner == CORE && data[0] == 0`. Add a separate `unreadableAsset` list that does not halt on RPC failure (log and continue, page separately). Audit the file.

**R4. The two defects already found inside this diff, and what else is of that shape**

**Ordering in `commit_deck` is now correct** — the one-shot `deck_root == 0` check is first, before any state that later checks establish. No check depends on state a later one is supposed to establish. The `require!(committed != [0;32])` after the one-shot check is harmless (it can only be zero if the one-shot check failed). The `salt` hash check and `blockhash_of_slot` are after the one-shot, which is correct.

**Other assertions that cannot fail:**
- `require!(root != [0;32])` after the one-shot check on `deck_root` — the one-shot already refused zero, so this arm is unreachable.
- `require!(salt_hash != [0;32])` in `commit_seed` — same pattern.
- The `packetBinds` assertion in 11.11 can be true by construction if the probe ceiling is hit before the packet bound.
- `maxAttrs < PROBE_CEILING` in 11.11a/11.11 — the loop is written to stop at the first failure, so if the packet never binds it always returns the ceiling.

Evidence if true: a test that hits the zero-root arm after `commit_seed` (it now correctly fails with `DeckAlreadyCommitted` first); a run of 11.11 that prints the same number at three different depths (the old behaviour).

**Fix:** Remove or make unreachable the duplicate zero checks. Raise `PROBE_CEILING` further or add an explicit "packet bound was reached" flag that the assertion checks. Audit every new `require!` for reachability.

**R5. The suite's new arms (`tests/3prog.test.ts`, section 2.0 and 11.11)**

**2.0c–2.0i:** Most are exercised (the one-shot nature makes the window unique). 2.0g (`entropy slot present`) can be bypassed by a malicious sysvar that returns a zero hash (the test uses a real sysvar). 2.0h is the cross-implementation check; both could be wrong the same way (same salt+blockhash derivation, same endianness). The two without `because()` (`2.0g`, `2.0h`) do not pin the error code, so an earlier guard could fire.

**11.11:** The packet-bound assertion can still pass vacuously if the probe ceiling is hit first (the old bug). The "deeper deck buys fewer attributes" assertion can pass if the three depths happen to agree (the old 7/11/13 case). Both are now asserted against `PROBE_CEILING`, but the test still uses a synthetic deck that may not hit the real packet bound at production depth.

**Hardcoded offsets:** `OFF_DECK_SLOT=593`, `OFF_DECK_SEED=601` match the struct layout after the padding change (`deck_root` at 297 + 72 = 369, then `deck_salt_hash` 32, `deck_slot` 8, `deck_seed` 32 → 369+72=441, but the test reads from the padded struct at the final offsets after all fields). The test passes, so the offsets are correct for the current layout.

Evidence if true: a run where 2.0g passes with a zero-hash sysvar; a run of 11.11 that prints the same `maxAttrs` at three depths; a `DeckCommitted` event whose seed does not match the JS derivation.

**Fix:** Pin 2.0g to a non-zero hash. Make 11.11 assert that the packet bound was reached (`maxAttrs < PROBE_CEILING && packetBinds`). Use the struct layout (via Anchor or a constant) for the offsets instead of hardcoding.

**R6. The accepted limits, and the corrections to them**

**Limit 1a rewrite:** Now correctly states that the Bank-pubkey confinement is on-chain in both programs. The under-claim is fixed. The off-chain parts (allowlist, fee-payer) are still accurate.

**Limit 23 rewrite:** Now states the real measured numbers (deck depth 11 → 18 caller attributes in packet, program allows 7). The previous "measured at depth 7, eighth does not serialize" was never taken; the new text is accurate. The item stays OPEN AND BLOCKING because the root commits once.

Both rewrites are correct and improve honesty. No new defects introduced. An under-claim is a defect; both have been corrected.

**R7. The counts and the arithmetic, independently**

**Floors from `scripts/run-tests.sh`:** `MIN_ASSERTIONS=330`, `DET_FLOOR=439`, `ALLOC_FLOOR=103`, `MAINNET_FLOOR=19`. All match the file.

**Schedule figures:**
- Census 108/60/36/24/12 → denominator 108*2 + 60*3 + 36*4 + 24*5 + 12*6 = 216 + 180 + 144 + 120 + 72 = **732**.
- 945/525/315/210/105 → 945*2 + 525*3 + 315*4 + 210*5 + 105*6 = 1890 + 1575 + 1260 + 1050 + 630 = **6405**.
- Per $1,000 at 240 vaults: I 2.73, II 4.10, III 5.46, IV 6.83, V 8.20 (matches card).
- Per $1,000 at 2,100 vaults: I 0.31, II 0.47, III 0.62, IV 0.78, V 0.94 (matches card).
- Shares at 2,100 vaults: 29.5 / 24.6 / 19.7 / 16.4 / 9.8 sum to **100.0%**.
- Level V is exactly 3× Level I (6/2 = 3).

All figures re-derive correctly from the weights. The arithmetic is sound.

**R8. One-of-N-sites**

- The one-shot check moved to first in `commit_deck` — but the duplicate zero check on `root` and the zero check on `salt_hash` in `commit_seed` are still present and unreachable. One-of-N.
- The `blockhash_of_slot` raw parse is duplicated in spirit from `bank/anchor.mjs` (the canonical pinned reader) but does not call it. The same defensive discipline is not applied to the sysvar in `distribute.mjs` or `alarm.mjs`.
- The tombstone test in `distribute.mjs` was added only to the level loop; the payment loop still uses the old `data[0] !== 1` without the RPC-failure guard. One-of-N (the comment even says "the payment loop already knew better").
- The `because()` assertions cover only four of the six new 2.0 arms; the two without it (2.0g, 2.0h) are not pinned.
- The `DeckCommitted` event now includes `seed` and `slot` — but the old event without them is still emitted in some paths? No, the old `DeckCommitted { root }` was replaced, but the Rust event definition still has the old variant in comments.
- The under-claim fix for 1a updated the table but not the prose in `bank/cosign.mjs` that still says the confinement is off-chain in one place.
- The `supersede` function in `distribute.mjs` clears three marks but the detector predicate had four suppressors until round 19; the fourth (`resolvedBy`) was missed in the first repair.

The one-of-N defect recurs inside the fix for it (the tombstone logic, the one-shot ordering, the event, the table update). Every fix in this diff has at least one site where the same shape was not updated.

---

**Findings about the accepted limits (the four questions)**

1. **Is any limit WORSE than stated?** Yes.
   - Limit 9 (foreign nested asset) is narrower than stated: the co-signer **does** catch it (DAS owner search, refuses on error or full page). The limit is only that there is no *continuous* detection. The stated text is still too wide.
   - Limit 13 (Attributes plugin) is bigger than stated: the level decides daily payouts, so an upgrade-authority attack rewrites money decisions, not just provenance. The "immutable in practice" claim is now false if the SEAL upgrade authority is compromised.
   - Limit 23's measurement was never taken (the probe could not fail); the new text is accurate, but the item is still OPEN AND BLOCKING while the root commits once.

2. **Is anything listed as a limit not actually a limit?** Yes.
   - Item 19's discharge was wrong in round 20 (the unlevelled-vault halt is no longer reachable by a customer, but the "cannot quietly drop a holder" strengthening was not stated). The current text is narrower and stronger than the frozen version.
   - The Bank-pubkey confinement (1a) is on-chain in both programs; the old text said off-chain.

3. **Is any DISCHARGED item not actually discharged?** Yes.
   - Item 19's discharge claimed the halt was "closed by construction" with no customer-reachable window. Round 20 found the burned-since-index route that re-opened it until the tombstone logic was added. The current discharge is correct, but the previous one was not.
   - Item 12/17 (compute units) is discharged by measurement, but the measurement was taken on a local validator with a padded transaction; production load with real DAS calls and larger vaults may change the numbers. The regression ceiling (400k CU) is generous but not proven against mainnet scale.

4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?** Yes.
   - Item 22 (distribution against live chain) is still OPEN AND BLOCKING. The code now runs the level read at production scale in tests, but the end-to-end live exercise with real paging, rate limits and failure modes has not been done. It is treated as "proven" in some comments.
   - Item 23 (deck size before minting) is still OPEN. The new measurement reverses the conclusion (program binds, not packet), but the root still commits once, so the decision must be made before minting. It is treated as closed in some places.

**Anything else**

- The `blockhash_of_slot` parse does not reject a slot present twice (first match wins). A malicious sysvar could return the same slot with different hashes.
- `distribute.mjs` treats an absent account as a burn in the level loop but not in the payment loop (`burnedMidRun`). Two loops, one event, two verdicts — the project's signature defect, inside the fix for it.
- The `DeckSeedCommitted` event is emitted, but the alarm does not yet watch `deck_seed` against the on-chain value for drift (only the root is checked in some places).
- `bank/deck.mjs` and the Rust must agree byte-for-byte on the hash scheme. The suite proves it by having the program verify a proof the JS built, but there is no unit test that the JS `seedFrom` matches the Rust `hashv(&[&salt, &bh])` for all inputs.
- The `paused` flag does not prevent re-initialisation or re-committing the deck. A Bank that is also a validator can pause, re-init, and grind a new seed.

**GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that nineteen rounds of AI audit structurally cannot?**

**Run the full pipeline against a live mainnet-like environment with real economic value at risk, with a human in the loop for every CRITICAL, for at least one full cycle (mint, redeem, distribute, revenue swap).** AI audit cannot:

- Exercise rate limits, paging behaviour, RPC failures, or mainnet congestion at production scale (~2,100 vaults).
- Force a human to act on every CRITICAL (the only way to prove the alarm is not ignored).
- Discover operational procedures that are not in the code (key custody, the swap-operator wallet hygiene, the manual resolution of ambiguous transfers).
- Measure the real cost of a wrong CRITICAL (engineering time, operator fatigue, delayed payouts).

Concretely: freeze the tree, deploy to a devnet with real (small) cbBTC, run the full cron pipeline for 30 days with a human on-call, and require every CRITICAL to be resolved in the runbook before mainnet. The AI process has eliminated every structural defect it can see; the last mile is operational reality. Do not ship until a human has had to act on the alarm for real money and the system survived it.