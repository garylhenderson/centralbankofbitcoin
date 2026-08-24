## R1 — commitment scheme

### CRITICAL — `deck_root` is still a bank/admin-chosen money schedule, not an on-chain commitment to `deck_seed`

**Construct:** `commit_deck(ctx, root, salt)` derives and stores `deck_seed`, but stores caller-supplied `root` without checking `root == deckRoot(buildDeck(level_caps, deck_seed))`.

**Gain:** the dealer can commit an arbitrary deck, prove mints against that arbitrary root, and permanently assign favored levels. The new seed makes the fraud detectable after the fact; it does not stop it. This is especially bad because `commit_deck` and a first `mint_vault` can be put close together operationally before an off-chain watcher reacts.

**Evidence if true:** after `DeckCommitted`, read config:
- `deck_seed` at offset 601;
- `level_caps`;
- `deck_root` at offset 529.

Recompute `expected = deckRoot(buildDeck(level_caps, deck_seed))`. If `expected != deck_root` but mints verify against `deck_root`, the on-chain program accepted an unfair deck. A direct test can commit a random valid nonzero root with the correct salt; the instruction will accept it.

**Fix:** do not open minting unless the root/seed relationship is enforced by a mechanism that cannot be skipped. Options:
- store the whole 2,100-card deck on chain and have `mint_vault` read its own card;
- add an on-chain multi-transaction deck-build verifier that deterministically constructs and commits the root;
- or make this an explicit OPEN/BLOCKING limit and require a non-skippable pause/challenge gate before unpausing minting. A same-repo alarm is not enough unless minting is mechanically impossible until the alarm’s root check has passed.

---

### CRITICAL — publishing `deck_seed` before minting plus Bank-controlled ordering still lets the Bank hand good cards to chosen minters

**Construct:** the seed is stored publicly in config before any mint. `mint_vault` takes `level` and `deck_proof` in the transaction. The Bank co-signs every mint and can delay/refuse/sequence mints.

**Gain:** even if the root were correctly bound to the seed, the Bank and any sophisticated buyer can know the next card before paying. The Bank does not need to bias the blockhash: it can simply co-sign favored wallets when `DECK[minted_total]` is V/IV and delay others on low cards. Buyers can also refuse to submit low-level mints after inspecting the transaction. That breaks “assigned by fate, no way to game it.”

**Evidence if true:** after `DeckCommitted`, any client can:
1. read `minted_total` at offset 205;
2. read `deck_seed`;
3. compute `DECK[minted_total]`;
4. decide whether to submit or whom to co-sign.

On-chain abuse evidence would be high-level cards statistically concentrated among Bank-related or early-informed wallets, and stalls at low-level indices.

**Fix:** bind mint order before the deck/seed is knowable. For example:
- an on-chain reservation queue with deposits/signatures created before seed publication, where reservation order fixes `minted_total`;
- or delayed randomness after an irreversible buyer commitment;
- or accept this as a buyer-facing limit. The current text says the opposite.

---

### HIGH — the entropy slot can be targeted, skipped, or used as an abort lever

**Construct:** `commit_seed` sets `deck_slot = current_slot + 32`. The caller cannot pass a slot, but the caller still chooses when to submit `commit_seed`.

**Gain:** a cheating Bank/admin with validator influence can time `commit_seed` so `deck_slot` is a slot it leads or can bribe. With the salt known to the Bank, a colluding leader has 32 slots of notice and can influence block contents, transaction ordering, or skip the slot. If the draw is bad, the Bank can simply never call `commit_deck`; if the slot is skipped, this config is permanently bricked. On-chain one-shot prevents re-rolling the same config, but it does not prevent visible aborted launches or redeployment under a new program ID.

**Evidence if true:**
- `DeckSeedCommitted { slot }` names a slot whose leader is controlled by or connected to the Bank.
- `getBlock(slot)` is null/skipped, or `commit_deck` returns `DeckSlotUnavailable` immediately after the slot should have existed.
- multiple abandoned deployments/configs show `DeckSeedCommitted` but no valid `DeckCommitted`.

**Fix:** do not rely on one future slot controlled by one leader. Use multiple future slots across independent leaders, a public randomness beacon/VRF, or an order/reservation scheme where aborting a draw has a real penalty. Also document that a skipped entropy slot bricks the deployment; the current text frames `DeckSlotUnavailable` mainly as an aging-window miss.

---

## R2 — `blockhash_of_slot`

No raw-layout defect found from the supplied code: `u64 count` + `(u64 slot, [u8;32]) * count`, 40-byte stride, little endian, and key pinning to `slot_hashes::ID` match Solana’s `SlotHashes` sysvar shape.

But the failure semantics are harsher than the comments state:

### HIGH — `DeckSlotUnavailable` also means “the entropy slot was skipped,” not only “the operator missed 512 slots”

**Construct:** `blockhash_of_slot` only succeeds if the exact `deck_slot` appears in SlotHashes.

**Gain:** one skipped slot, whether accidental or malicious, permanently prevents minting. That is a single-leader availability dependency.

**Evidence if true:** `DeckSeedCommitted.slot = S`, `getBlock(S)` returns null / skipped, and every `commit_deck` fails `DeckSlotUnavailable` even immediately after S.

**Fix:** either explicitly accept and document “a skipped entropy slot kills the launch,” or change the entropy rule to a bounded set of future produced slots. If using fallback slots, account for the new grinding surface: a colluding leader can skip to move to the next entropy candidate.

Other failure modes:
- truncated account: `BadSlotHashes`, closed.
- count >512: `BadSlotHashes`, closed.
- count zero: miss -> `DeckSlotUnavailable`, closed but not distinguished.
- duplicate slot: first matching entry wins; real sysvar should not contain duplicates.

---

## R3 — `bank/distribute.mjs` tombstone handling

### HIGH — the tombstone predicate treats “absent/malformed/not Core AssetV1” as burned and silently drops a holder

**Construct:**
```js
const raw = await conn.getAccountInfo(new PublicKey(v), 'confirmed')
tomb = !raw || raw.data.length < 1 || raw.data[0] !== 1
if (tomb) { burnedSinceIndex.push(v); continue }
```

**Gain:** if RPC returns `null`, an empty/malformed account, or an indexer/RPC inconsistency, the vault is skipped as “burned after index” instead of halting. That removes the holder from that day’s denominator/payment with no ledger row. The payment loop has the same predicate for `burnedMidRun`, so the one-of-N version exists too.

A real Core burn leaves a Core-owned tombstone. Absence is not the measured burn state.

**Evidence if true:** mock `fetchAsset` to throw and `getAccountInfo(v)` to return `null`; the script logs `vault(s) were burned after the index was built`, does not add `unreadableLevels`, and proceeds. On mainnet evidence would be a distribution log claiming a burn while the asset account is absent or later reappears live.

**Fix:**
```js
const raw = await conn.getAccountInfo(new PublicKey(v), 'confirmed')
const tomb =
  raw &&
  raw.owner.equals(CORE) &&
  raw.data.length >= 1 &&
  raw.data[0] !== 1
```
Anything else should halt as unreadable/index disagreement. Apply the same stricter predicate in the payment loop.

---

### MEDIUM — a normal mint/index lag can still halt the whole distribution before the level loop

**Construct:** distribution requires:
```js
uniqLive.length + uniqBurnt.size === mintedTotal
```
where `mintedTotal` is read from chain and live/burnt are read from DAS.

**Gain:** if a customer mints shortly before distribution and DAS has not indexed the new asset yet, the job refuses the entire payout. That is fail-closed for overpayment, but it is still a customer-triggerable temporary halt while minting is open.

**Evidence if true:** `minted_total` increments on chain; `getAssetsByGroup` returns the previous collection set; script throws:
```
index returned X live + Y burnt but chain says Z were minted
```

**Fix:** either do not run distribution while minting is open, add a retry/backoff window for fresh `minted_total` changes, or derive the payout census from a chain source with consistent finality. This overlaps with OPEN item 22 and should be exercised live.

The inner `catch { tomb = false }` direction is correct: RPC exceptions halt instead of being treated as burns.

---

## R4 — repair-shape / check ordering

`commit_deck`’s current guard order is mostly sane: one-shot root check first, then nonzero root, then committed seed, salt check, SlotHashes lookup, state write.

### LOW — `commit_seed` can be applied to a legacy already-committed root state

**Construct:** `commit_seed` checks only `deck_salt_hash == 0`, not `deck_root == 0`.

**Gain:** on a migrated/legacy config where `deck_root` was already set by the old instruction and `deck_salt_hash` is zero, `commit_seed` succeeds and creates a seed commitment that can never be paired with `commit_deck` because `deck_root` is already nonzero. Not reachable on a fresh deployment under the new code, but it is bad migration hygiene.

**Evidence if true:** initialize under old layout or manually create state with nonzero `deck_root`, zero salt hash; call `commit_seed`; config now has root + seed commitment with no valid relationship.

**Fix:** add:
```rust
require!(c.deck_root == [0u8; 32], MintError::DeckAlreadyCommitted);
```
to `commit_seed`, before writing `deck_salt_hash`.

---

### LOW — deck selftest has the old “lower bound floor” shape

**Construct:** `bank/deck.mjs`:
```js
const FLOOR = 16
if (R.length < FLOOR) ...
```
but the selftest currently runs 17 assertions, and `run-tests.sh` expects `DECK_FLOOR=17`.

**Gain:** direct `node bank/deck.mjs --selftest` can lose one assertion and still pass. The runner catches the current count, but the file’s own gate is stale.

**Evidence if true:** delete one assertion from `bank/deck.mjs`; direct selftest still exits 0 at 16 assertions.

**Fix:** set `FLOOR = 17` and require equality, same as the detector/allocation selftests.

---

## R5 — suite arms

### MEDIUM — production deck depth is measured one proof node too shallow

**Construct:** section 11.11 treats production ~2,100 vaults as synthetic proof depth 11:
```js
const at11 = await fitAt(11)
```
and SPEC repeats “depth 11 (~2,100).”

For 2,100 leaves, the maximum Merkle proof length is 12. The Rust comment even says “2,100 vaults is depth 12.”

**Gain:** the published measurement table is not the worst-case production packet geometry. The product conclusion probably survives because depth 13 still has more than the program’s 7-attribute cap, but the measurement as written is wrong.

**Evidence if true:**
```js
const d = buildDeck([945,525,315,210,105], seed)
Math.max(...d.map((_, i) => deckProof(d, i).length)) // 12
```

**Fix:** compute `prodDepth` from the actual production deck and measure that. Update SPEC’s table. Add an assertion:
```ts
rec('11.11prod-depth', 'production max proof depth', '12', String(prodDepth))
```

---

### LOW — exact 11.11 published numbers are printed, not pinned

**Construct:** 11.11 asserts “below ceiling” and monotonicity, but does not assert the published values 29 / 18 / 13.

**Gain:** transaction shape can change, SPEC can keep publishing stale numbers, and the suite still passes as long as the product still fits.

**Evidence if true:** change a constant/account list so depth-11 fit changes from 18 to 17; 11.11a/b/c can still pass, while SPEC is stale.

**Fix:** either assert exact values if they are going to be published, or stop publishing exact values and publish only the enforced inequalities.

---

Other R5 checks:
- 2.0c/d/f/i are pinned by `because()` and reach the named checks.
- 2.0e/g/b/h are not negative error-code checks; no `because()` is needed.
- Offsets are correct: `deck_slot` at 593 and `deck_seed` at 601.

---

## R6 — accepted-limit rewrites / under-claims

### MEDIUM — SPEC and `distribute.mjs` still contain stale statements contradicting the rewritten limits

**Constructs:**
- `bank/distribute.mjs` still says:
  > “THE LEVEL LIVES OFF-CHAIN … no program change, no Core attribute … This is not built.”
- SPEC’s “level is ON-CHAIN” section still says:
  > `sha256(bank_salt)` published first, salt revealed at close
  and
  > “Measured at depth 7: seven caller attributes fit, the eighth does not serialize.”

These contradict the new on-chain level/deck scheme and the rewritten accepted limit 23.

**Gain:** operators/auditors/buyers can read the wrong control model from the main spec and money job. This is the same defect class as prior over-claims, but in the under-claim/stale direction.

**Evidence if true:** grep those quoted strings in the supplied files.

**Fix:** update every occurrence, not just ACCEPTED LIMITS. Add selftest regexes for:
- “LEVEL LIVES OFF-CHAIN”
- “salt revealed at close”
- “seven caller attributes fit”
- old assertion counts like “69 assertions”.

Limit 1a’s rewritten accepted text matches the supplied Rust: SEAL emits `BankKeyOutsidePair` and MINT emits `BankKeyOutsideMint`. The remaining off-chain pieces are fee payer and program allowlist.

---

## R7 — counts and arithmetic

Floors in `scripts/run-tests.sh`:
- `MIN_ASSERTIONS=330`
- `DECK_FLOOR=17`
- `DET_FLOOR=439`
- `ALLOC_FLOOR=103`
- `MAINNET_FLOOR=19`

The prompt quoted 330 / 439 / 103 / 19; it omits the deck floor even though the runner enforces it.

Schedule arithmetic:
- 240 census: `108*2 + 60*3 + 36*4 + 24*5 + 12*6 = 732`
- 2,100 census: `945*2 + 525*3 + 315*4 + 210*5 + 105*6 = 6,405`
- per $1,000 at 240: `2.73, 4.10, 5.46, 6.83, 8.20`
- per $1,000 at 2,100: `0.31, 0.47, 0.62, 0.78, 0.94`
- shares at 2,100: `29.5%, 24.6%, 19.7%, 16.4%, 9.8%`, summing to `100.0%`.

No arithmetic defect found there.

---

## R8 — one-of-N-sites

Repeated missed sites in this diff:

1. **Tombstone predicate copied from payment loop into level loop.** Both sites now share the same overbroad `!raw || len<1 || data[0]!==1` bug. Fix both.

2. **SPEC/headers not updated with accepted-limit rewrites.** ACCEPTED LIMITS says one thing; earlier SPEC and `distribute.mjs` say old off-chain/old-measurement things.

3. **Deck selftest floor missed the equality-floor repair.** Runner has exact `DECK_FLOOR=17`; `bank/deck.mjs` direct selftest still has lower-bound `16`.

4. **`scripts/audit21.ts` calls the diff “complete” but excludes SPEC.**
   ```ts
   git diff 045fcc0..HEAD -- programs bank scripts tests
   ```
   R6 asks auditors to review SPEC rewrites, but the rendered diff omits SPEC changes. The full SPEC is bundled, but auditors cannot see what changed. Add `SPEC.md` to the diff pathspec.

5. **The claimed root/seed production monitor is not evidenced in the supplied selftest.** `bank/deck.mjs` and Rust comments say `bank/selftest.mjs` checks the root/seed relationship and the alarm watches it. The supplied `bank/selftest.mjs` contains no such deck-root check. If `alarm.mjs` has it, it was not bundled here; if it does not, the compensating control for arbitrary roots is missing.

---

# Accepted limits questions

## 1. Is any accepted limit worse than stated?

- **Item 23 is still misstated in surrounding SPEC text.** The accepted-limit rewrite says the old packet measurement was wrong, but earlier SPEC still repeats the old “seven attributes” claim. Also production depth is 12, not 11.
- **The root-not-bound-to-seed issue is worse than a mere accepted limit because it is not listed as accepted.** It lets an arbitrary unfair deck be used on chain unless an off-chain process stops minting.

## 2. Is anything listed as a limit not actually a limit?

- The rewritten 1a correctly removes Bank-pubkey confinement from the off-chain bucket. The supplied code enforces it on-chain in SEAL and MINT.
- Item 23’s “deck size squeezes provenance” is not a binding packet limit at the program’s 7 caller attributes, but the item remains a real pre-mint decision because the root is one-shot.

## 3. Is any discharged item not discharged?

- 12/17 compute: no contrary evidence in supplied code.
- 14 duplicate attribute keys: closed in `mint_vault`.
- 19 unlevelled-vault halt: closed for the original “activated before levels.json entry exists” route. But the distribution job still has silent-drop paths around tombstone/absent account handling; that is a different defect, not a reopening of the exact unlevelled JSON window.

## 4. Is any OPEN AND BLOCKING item being treated as accepted?

- **Item 22 is not mechanically enforced.** `scripts/cron-install.sh` installs `bank/distribute.mjs` live by default unless an existing tagged line has `--dry-run`. That means the live-chain distribution rehearsal can be bypassed by installing cron. Evidence: fresh crontab line lacks `--dry-run`.
  - Fix: install distribute as dry-run by default until an explicit marker or `--arm-distribute-live` flag is set after the live-scale rehearsal.
- **Item 23 is verbally still confused elsewhere in SPEC.** The accepted-limit section keeps it open, but earlier sections sound as if the old measurement is settled.

---

# Anything else

### HIGH — the stated off-chain root/seed alarm is not auditable from this bundle

The diff repeatedly relies on “alarm watches it in production” for the fact that `root` is not verified on chain. `bank/alarm.mjs` is not in the supplied files, and `bank/selftest.mjs` does not contain a root/seed mismatch detector. If the root check is the only thing standing between arbitrary levels and minting, it needs to be in a delivered file and proven both ways.

**Evidence:** grep supplied `bank/selftest.mjs` / `bank/detectors.mjs` for `deck_seed`, `deck_root`, `buildDeck`, or root recomputation.

**Fix:** add a pure detector:
```js
expectedRoot = deckRoot(buildDeck(level_caps, deck_seed))
finding if expectedRoot != deck_root
```
Then add both-way selftests and make minting/unpause procedurally or mechanically wait for it.

---

# Given no human firm will ever see this

Do these things that model rounds structurally do not replace:

1. **Run an adversarial mint-order simulation.** Model a Bank that can choose order, buyers who can decode the next level, and friends waiting for high cards. Quantify how fast the “random” distribution collapses under public seed/selective minting.

2. **Add an independent watcher outside this repo.** Same checks, different codebase, different machine, read-only keys. It should compute deck root from seed/caps, watch level distribution, watch pending rotations, and publish signed reports.

3. **Do a public randomness/deck ceremony before minting.** Freeze program IDs first. Commit seed. Wait entropy. Commit deck. Publish independent recomputations. Hold a challenge window before any mint can land.

4. **Run a full production-scale distribution rehearsal on a real RPC/DAS path.** 2,100 vaults, real fetchAsset calls, provider rate limits, retries, null accounts, stale DAS pages, burned tombstones, poisoned ATAs. Inject failures; do not just run happy path.

5. **Make Bank signing observable.** Every Bank signature should be logged with the transaction hash, decoded verdict, operator identity, and policy version. A mandatory hardware/HSM workflow with exportable audit logs is more relevant than another code comment saying “policy.”

6. **Chaos-test the off-chain jobs.** Kill RPC mid-loop, return null for live accounts, lag DAS behind chain, corrupt ledgers, hold locks, restart during half-paid days. Record expected ledger/alarm outcomes before mainnet.

7. **Use a canary payout with tiny funds before real balances.** Run the whole revenue→split→distribution loop against live infrastructure with negligible cbBTC and reconcile from chain, not from the payer’s ledger.