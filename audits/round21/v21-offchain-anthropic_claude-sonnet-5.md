# Round 21 Audit — Independent Review of 045fcc0..HEAD

Calibration note up front: every CRITICAL/HIGH below states what evidence on-chain or in a test run would confirm it, per the instructions. Several things I checked came back **clean** — I say so explicitly rather than manufacturing findings to fill the format, because a wrong CRITICAL is exactly the failure mode this round exists to avoid.

---

## R1 — The commitment scheme

### R1-A (HIGH) — The scheme prevents the Bank from *choosing* a favorable deck, but not from *vetoing* an unfavorable one

**Construct.** `commit_seed` is one-shot (`SeedAlreadyCommitted`). There is no re-seed instruction anywhere, by design ("a Bank that could re-seed by deliberately missing the window would get an unlimited number of draws"). But the deterrent this relies on — "a missed window means minting never opens, loud, total" — assumes a bricked program is *costly to the Bank*. It isn't, for the one party who can see the outcome before it's locked in.

Walk the sequence: the Bank knows `bank_salt` (it's their own secret). Once `deck_slot` has passed, `SlotHashes` is a public sysvar — anyone, including the Bank, can read `blockhash(deck_slot)` with a plain RPC call, off-chain, with zero on-chain footprint. The Bank can therefore compute `seed = sha256(salt||blockhash)` and the **entire resulting deck** for itself, privately, *before ever calling `commit_deck`*. If the deck is unfavorable (e.g. it doesn't hand levels the way the Bank wants), the Bank's only action is to **do nothing**. `commit_deck` is never called, the 512-slot window lapses, `DeckSlotUnavailable` becomes permanent, and minting is dead — recoverable only by a program upgrade, which the Bank (via the Squads authority it operates under) controls. A "loud, total, permanent" failure is not a deterrent to the one party who can trigger it deliberately and route around it on their own schedule.

**What an attacker gains:** the ability to discard any draw it dislikes and force a do-over via redeployment, which is functionally an unlimited-retry grinding attack, just moved from "one instruction" to "one redeploy" — precisely the capability this round's fix was built to remove.

**Evidence that would exist if this is true:** no instruction in `programs/cbob-vault-mint/src/lib.rs` clears or resets `deck_salt_hash`/`deck_root`/`deck_slot` outside `initialize`; `blockhash_of_slot` and `commit_deck` can be called freely (permissionlessly *readable*, at least) any number of times before landing, with no on-chain penalty for not landing. This is verifiable by static reading of the enum of instructions (`commit_seed`, `commit_deck`, and nothing else touches these fields) — no live run needed.

**Fix:** this is a genuinely hard problem for a commit scheme with no verifiable-random-function and no third party. Two directions that actually help: (a) require `commit_deck` to be called by a fixed deadline enforced against a *separate*, earlier-committed clock (doesn't change the veto option, but at least makes non-compliance visible faster and unambiguous); (b) more substantively, make non-delivery costly — e.g. require `commit_seed` to post a bond that is forfeited/burned if `commit_deck` doesn't land within the window. Neither is a small change days before a freeze; at minimum this should be written into the record as a real, current limitation rather than described as closed by "loud and total" failure.

### R1-B (MEDIUM-HIGH) — a Bank that is (or bribes) the leader of `deck_slot` gets bounded grinding power

`deck_slot = current_slot_at_commit_seed + 32`, and the caller chooses *when* to submit `commit_seed`. The leader schedule for an epoch is public well in advance. A Bank can therefore submit `commit_seed` at exactly the moment such that `deck_slot` lands on a slot it (or a colluding/bribed validator) will lead. A leader has some — not unlimited, but real — influence over the exact blockhash their own slot produces, through choice and ordering of the entries/transactions they include. That gives a leader-Bank the ability to enumerate several candidate blockhashes for its own slot, compute the resulting deck for each off-chain, and pick whichever block construction it prefers, before it ever finalizes that slot.

This doesn't hand the Bank arbitrary control (SHA-256 avalanches, so nudging the hash doesn't let them target a *specific* card at a *specific* index), but it is a real bias/grinding capability against the design's own claim ("It cannot know a future blockhash" — true only if the Bank is not, and cannot become, the leader of `deck_slot`).

**Fix:** none available without a VRF or a committee of block producers, which the design deliberately avoided. This should be written down as an accepted, structural limit of SlotHashes-based entropy rather than left as an unstated assumption of the "cannot know a future blockhash" claim.

### R1-C — "an unlimited number of draws" claim about the missing re-seed is otherwise correctly reasoned

Re-checked the ordinary (non-Bank-as-leader, non-veto) case: a Bank that is *not* the leader genuinely cannot predict `blockhash(deck_slot)` at `commit_seed` time, and once `deck_salt_hash` is set it cannot be replaced. Absent R1-A/B, the scheme does what it claims. This part of the design is sound.

---

## R2 — `blockhash_of_slot`

**Layout.** `u64 count` (8 bytes LE) then `count` entries of `(u64 slot, [u8;32] hash)` = 40-byte stride, matches the real `SlotHashes` sysvar layout (`MAX_ENTRIES = 512`, which the code correctly mirrors as `SLOT_HASHES_MAX`). Endianness (`from_le_bytes`) is correct for this account. I did **not** find a layout defect.

**Failure modes — checked, fail closed:**
- Truncated account (`data.len() < 8`) → `BadSlotHashes`. ✓
- `n` bound-checked (`<= 512`) *before* the `8 + n*40` computation, so no overflow risk from an oversized `n`. ✓
- Buffer shorter than `8 + n*40` → `BadSlotHashes`. ✓
- `n == 0` → loop doesn't run, falls to `DeckSlotUnavailable`. ✓
- All-zero hash → explicitly refused rather than fed to the seed. ✓
- Duplicate slot in the table isn't exploitable — the account is pinned to the real sysvar (`require_keys_eq!(acct.key(), slot_hashes::ID, ...)`), so its contents are runtime-maintained, not attacker-supplied.

I found **no defect** in the parsing logic itself.

**The stated bound vs. what the code enforces.** The 512-slot / no-re-seed trade is exactly what R1-A undermines: it's not "unlimited draws vs. total permanent failure" — it's "unlimited draws vs. a failure the *Bank itself* can trigger on demand and later recover from via an upgrade it controls." That should be re-examined together with R1-A rather than treated as settled.

**Operational gap not currently documented anywhere.** Neither "Known limits" nor "ACCEPTED LIMITS" in SPEC.md records that a *single* missed 512-slot window after `commit_seed` permanently disables minting with **no on-chain recovery path** (`initialize` uses Anchor `init`, so the account can't be re-created; only a program upgrade can add a reset path). This is stated as intentional in code comments but is not in either limits list. Recommend adding it explicitly (MEDIUM).

---

## R3 — the tombstone halt in `bank/distribute.mjs`

### R3-A (HIGH) — a transient `null` from `getAccountInfo` is silently treated as "definitely burned," not as "unreadable"

```js
let tomb = false
try {
  const raw = await conn.getAccountInfo(new PublicKey(v), 'confirmed')
  tomb = !raw || raw.data.length < 1 || raw.data[0] !== 1
} catch { tomb = false }
```

The `catch` branch is correctly designed: an *exception* → `tomb=false` → falls through to `unreadableLevels` → halts, exactly as the comment claims ("could not ask ⇒ do NOT assume burnt ⇒ halt"). I verified this is what the code actually does — no defect there.

But the *successful, non-throwing* branch does the opposite for one specific case: if `getAccountInfo` **resolves with `null`** (not an exception — a normal RPC response saying "I don't have this account right now"), the code sets `tomb = true` unconditionally via `!raw`. Per measured fact 9 in this project's own record, a burned vault's account is *never* actually deleted — it survives, Core-owned, at `Key::Uninitialized`. So for a genuinely-burned vault, `raw` should never be `null`; a `null` response for a vault this code already believes exists (it came from the cross-checked `uniqLive` list) is much more likely an RPC eventual-consistency/replica-lag artifact than a real tombstone. This project's own code elsewhere (the DAS-shortfall and poisoned-ATA handling) explicitly treats exactly this class of RPC inconsistency as a hazard to guard against — this new code doesn't extend that discipline to its own `null` case.

**What this costs:** a transient RPC hiccup on one vault silently removes it from that day's payout (recorded only via `console.log`, no CRITICAL, no page) rather than halting the run the way an unreadable level does everywhere else in this file. Impact is bounded (the vault reappears in the next day's live index and gets paid the following cycle, assuming it wasn't actually burned), so this is not a fund-loss bug, but it is a direct violation of the file's own stated principle — "If any read fails, it stops and says so" — and it is silent.

**Fix:** change the condition to distinguish "account absent" from "account present but not `Key::AssetV1`": `raw.data[0] !== 1` (when `raw` exists) is genuinely a tombstone signal; `!raw` (account not found at all) should route to `unreadableLevels`, not to `burnedSinceIndex`, since a live vault's account is never actually removable per measured fact 9.

### R3-B (HIGH, one-of-N-sites — R8) — the exact same flaw was already present in the reference implementation this fix was modeled on

The comment says "THE PAYMENT LOOP ALREADY KNEW BETTER," pointing at the pre-existing `burnedMidRun` check later in the same file:

```js
const stillThere = await conn.getAccountInfo(new PublicKey(v), 'confirmed')
if (!stillThere || stillThere.data.length < 1 || stillThere.data[0] !== 1) {
  done[v] = { ..., skipped: 'vault is no longer a live Core asset' }
```

This is the **identical** `!stillThere ⇒ treated as burned` pattern, in a pre-existing site the new code explicitly used as its model ("exactly as the payment loop does"). The new fix faithfully copied a latent flaw from the site it was told to imitate, so the defect now exists in **two** places, not fixed in either. This is squarely the shape R8/R4 ask about: a fix modeled on an existing site inherited that site's own bug rather than surfacing it.

**Fix:** apply the R3-A fix to both sites, not just the new one.

### R3-C — no third route found beyond what's already covered

I looked specifically for a customer action, other than a bare burn, that could make `fetchAsset` throw for a live vault (transfer, nesting, config drift, Core upgrade) and did not find one that plausibly reaches this code path — transfers and nesting don't touch the `Key` byte or corrupt attribute data. The assumption "`fetchAsset` throws on a tombstoned account" is not merely asserted — it is already indirectly exercised by existing suite test 6.6 (`fetchAsset` on a redeemed/burned charter vault is caught via `.catch(()=>({}))`), which corroborates the assumption rather than leaving it untested. I did not find a third route.

---

## R4 — ordering and "unfailable probe," what else is of that shape

### Ordering in `commit_deck` — checked, correctly fixed

`DeckAlreadyCommitted` (one-shot gate) → `BadDeckRoot` (root≠0) → `SeedNotCommitted` (dependency) → `BadSalt` (auth on caller input) → `blockhash_of_slot` (may fail on timing). I traced this and found no check that depends on state a later check is supposed to establish, and no check that fires for the wrong reason ahead of the one it's meant to guard. `BadSalt` is checked *before* the (comparatively expensive) sysvar parse, which is a sound minor ordering choice too. **No defect found here.**

### PROBE_CEILING fix (11.11 / 11.11a/b/c) — checked, no longer vacuous

I traced the loop bounds: `maxAttrs` can reach `PROBE_CEILING=64` if the packet genuinely never binds within the tested range, at which point `maxAttrs < PROBE_CEILING` is **false** — the assertion can fail. `11.11b` requires strict monotonic decrease across three real, independently-measured depths (`at7 > at11 > at13`), which is a real geometric property that a broken serializer or an off-by-one would break. These are not vacuous. **This part of the diff is correctly repaired.**

### Other assertions checked for the same "cannot fail" shape

I scanned the diff's new arms for tautologies and found none beyond what's already discussed. `2.0g` (entropy present, non-zero) is computed from a genuinely re-parsed live sysvar read, not a constant. I did not find a third "unfailable" arm.

---

## R5 — the suite's new arms

### 2.0c–2.0i: each reachable exactly once — checked, correctly ordered

I traced the five REJECT arms in this range (`2.0c`, `2.0d`, `2.0f`, `2.0i`, plus the pre-existing `2.0a`) against the actual call order in `main()` and against the on-chain check order established in R4. All five are exercised **before** the state that would make them false-pass exists, and all five have `because()` pins matching the correct error code (`SeedNotCommitted`, `BadSaltHash`, `SeedAlreadyCommitted`, `BadSalt`, `BadDeckRoot` respectively). I did not find an unpinned negative or a false-pass ordering bug in this range — this appears correctly built.

The two arms in the `2.0c`–`2.0i` range with no error code to pin (because they aren't rejections) are `2.0e` (ALLOW) and `2.0h` (value comparison). Neither needs a `because()` pin by construction, but each deserves separate scrutiny:

- **2.0e** (`commitSeed` succeeds): on Solana there is no "silent no-op success" mode — a landed instruction either ran the handler or the transaction failed. Its state is independently re-confirmed by `2.0g`/`2.0h` reading real chain bytes afterward. Low risk of false-pass.

### 2.0h — real cross-implementation check, with a stated limit

`DECK_SEED` (computed by the *test file*, independently parsing `SlotHashes` and calling the exported `bank/deck.mjs` `seedFrom`) is compared byte-for-byte against the on-chain value the *program* stored. Because both sides independently re-derive from the raw inputs (they don't derive one from the other), a divergence in concatenation order, hash function, or byte encoding between the JS and Rust implementations **would** be caught — this is a real check, not decoration.

What it **cannot** catch: if both implementations agree on the *wrong* formula relative to whatever the intended security property actually requires (e.g., if the scheme should also bind `census`/`level_caps` into the seed and neither implementation does), self-consistency between two independent re-implementations of the same simple `sha256(a||b)` proves agreement, not correctness of the formula itself. Given how simple the actual operation is (plain concatenation, no domain separation, no length prefixes), the risk of an identical accidental error in both is low but not provably zero. This is the precise, calibrated answer to the prompt's question — not a defect, a stated limit of the check.

### 11.11 / 11.11a-c — see R4, confirmed non-vacuous.

### Offsets `593` / `601` — independently recomputed, **verified correct**

I reconstructed `MintConfig`'s byte layout field-by-field from the diff (8-byte disc + fields in declared order) and cross-checked it against every offset the test suite and `bank/*.mjs` already read elsewhere (`collection@41`, `bank@73`, `governance@105`, `treasury@137`, `round_id@169`, `price_lamports@189`, `minted_total@205`, `swap_operator@256`, `pending_governance@321`, `pending_admin@369`, `pending_bank@409`, `pending_operator@449`) — every one of those matched my independent recomputation. Continuing the same computation through `level_caps`/`level_minted`/`deck_root`/`deck_salt_hash` lands `deck_slot` at exactly **593** and `deck_seed` at exactly **601**, matching `OFF_DECK_SLOT`/`OFF_DECK_SEED` precisely. I also re-summed the `Initialize` account's `space =` expression and it lands at 633 bytes before padding, exactly matching `deck_seed`'s end offset (601+32), and `CONFIG_PADDING=112` is consistent with the stated arithmetic (256 − 72 − 72). **No defect found; this checks out exactly.**

---

## R6 — the accepted-limits rewrites

**Limit 1a rewrite:** re-verified against the actual Rust — `open_for_redemption` does refuse `BankKeyOutsidePair` and `mint_vault` does refuse `BankKeyOutsideMint`, both confirmed by reading the handlers directly. The rewrite's claim that confinement is on-chain in both programs is **accurate**. Its claim that the program allowlist and fee-payer check remain off-chain (in `judgeRedemptionTx`) is also accurate as delivered. I did not find an error in this rewrite.

**Limit 23 rewrite:** the stated numbers (depth 7→29, depth 11→18, depth 13→13 caller attributes; program allows 7) are internally consistent with each other and with the reasoning that concludes "program is the binding constraint, not the packet." I did not find a flaw in the logic of the rewrite itself.

**A new claim from this round that belongs in this list but isn't in it:** the `commit_seed`/`commit_deck` doc comments assert "`bank/selftest.mjs` checks the relationship and the alarm watches it in production" (i.e., that something verifies the committed `deck_root` actually equals `deckRoot(buildDeck(census, deck_seed))`, catching a Bank that commits an off-deck root). I searched the bundled `bank/detectors.mjs` (the full file, including `WATCH`/`WATCHED_KEYS`) for any function or watched key relating to `deck_root`, `deck_seed`, or deck-vs-seed reconciliation and found **none**. `bank/selftest.mjs`'s deck-related assertions test `bank/deck.mjs`'s internal consistency (shuffle determinism, proof verification) — not a comparison against a live on-chain `deck_root`/`deck_seed` pair. This is an **over-claim of a control that doesn't appear to run**, the exact defect class this project has repeatedly shipped, now inside the diff meant to close it (HIGH — same severity class as R1-A, and it should either be added as an accepted limit with the honest statement "checkable by anyone, watched by nobody automatically," or the missing detector should actually be written).

---

## R7 — counts and arithmetic

**Floors, read from `scripts/run-tests.sh` as delivered:** `MIN_ASSERTIONS=330`, `DET_FLOOR=439`, `ALLOC_FLOOR=103`, `DECK_FLOOR=17`, `MAINNET_FLOOR=19` — matches the prompt's stated floors exactly.

**Independent re-derivation of the +14 delta (316→330):** I counted every new `rec()`/`because()` push introduced by this diff in `tests/3prog.test.ts`: seven new arms in section 2.0 (`2.0c,d,e,f,g,h,i`), four new `because()` pins (`2.0c,d,f,i`), and three new arms replacing the single old `11.11` (`11.11a,b,c`, additive — the original `11.11` id is kept, reworded). That totals **14**, exactly matching `316 → 330`. This checks out precisely — **verified clean**, no padding or unaccounted change found.

**Schedule arithmetic, independently recomputed:**
- 108/60/36/24/12 with weights 2/3/4/5/6: 216+180+144+120+72 = **732** ✓
- 945/525/315/210/105: 1890+1575+1260+1050+630 = **6405** ✓
- Per-$1,000 at 732: 2.73/4.10/5.46/6.83/8.20 ✓ (all recomputed)
- Per-$1,000 at 6,405: 0.31/0.47/0.62/0.78/0.94 ✓
- Shares at 2,100: 29.5/24.6/19.7/16.4/9.8, summing to **100.0** ✓

All of these were already correct and unchanged by this diff; I re-derived them independently per the prompt's instruction and found no discrepancy.

---

## R8 — one-of-N-sites

The primary finding is **R3-B** above (the tombstone-check flaw exists in two sites in `bank/distribute.mjs`, and the new site inherited it from the one it was told to imitate). I checked the rest of the diff (deck.mjs comment-only change, run-tests.sh floor, audit21.ts) for the same shape and did not find another instance — the mint-program changes (`commit_seed`/`commit_deck`) are new capability with no obvious sibling site to have missed.

---

## The four accepted-limits questions

1. **Worse than stated?** Yes — the deck-commitment scheme (R1-A, R1-B) is weaker than "no way to game it" implies: the Bank can veto an unfavorable draw by inaction, and a leader-Bank has bounded grinding power. Neither is currently documented anywhere in "Known limits" or "ACCEPTED LIMITS." Recommend adding both.
2. **Anything listed that's already closed / not actually a limit?** I checked limit 13 (attribute plugin dead / level immutability) against the Rust and the 11.13/11.14 refusals and found it accurately described — not over- or under-claimed.
3. **Any DISCHARGED item not actually discharged?** I re-examined item 19 (unlevelled-vault halt closed by construction) in light of R3-A/B and confirmed my finding is a *different* failure shape (a single vault silently skipped for a day, not a whole-distribution halt triggerable by an ordinary customer action) — it does not undermine item 19's discharge, and I want to be explicit that I checked rather than assumed.
4. **Anything OPEN AND BLOCKING quietly treated as accepted?** No — items 22 and 23 remain explicitly OPEN AND BLOCKING in the delivered SPEC.md, not demoted.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Nineteen-plus rounds of prose review have converged on a residual failure mode this format cannot fix by adding a twentieth round: the worst findings this round (R1-A, R3-A/B) are about **dynamic, timing-dependent, incentive-driven behavior** — what a rational Bank does when it doesn't like an outcome, what an RPC does under load, what a leader can do with its own slot — not about a static shape a text reader can fully verify by staring at source. Concretely, and not already in SPEC's SHIP GATE:

1. **Run the actual attack, don't just reason about it.** Stand up a devnet deployment and have a red-team script *play the Bank*: commit a salt, wait for `deck_slot`, compute the deck off-chain, and if it dislikes the outcome, simply not call `commit_deck` — then measure exactly what state the program is left in and what it actually costs to recover via upgrade. Do the same for the leader-collusion path using a local multi-validator devnet where one validator is scripted to try several block constructions for the target slot. This is checkable *today*, doesn't require mainnet, and directly answers R1-A/B with a measurement instead of an argument.
2. **Inject faults, don't assume RPC behaves.** R3-A exists because nobody simulated an RPC returning `null` for an account that's actually still there. A fault-injection harness (a local RPC proxy that randomly nulls or delays responses under load) run against `bank/distribute.mjs` and `bank/cosign.mjs` would surface this class of bug mechanically, rather than waiting for a chat model to notice the asymmetry between a `catch` block and an `if (!raw)` line by reading it twice.
3. **A canary, not a launch.** Item 22 (never run against a live chain) cannot be closed by more audit rounds — it requires actually running `distribute.mjs` against a small, real, bounded pool of live vaults with a defined rollback, watched by a human, before it runs against all ~2,100. No AI round can substitute for having actually done this once.

None of this needs a firm. It needs someone to run the code adversarially instead of reading it one more time.