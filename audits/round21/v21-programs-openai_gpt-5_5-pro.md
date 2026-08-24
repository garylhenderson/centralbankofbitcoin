## R1 — Commitment scheme

### HIGH — Public pre-mint deck plus Bank co-signature still lets the Bank allocate good cards by ordering mints

**Construct:** `mint_vault` checks the supplied `level`/`deck_proof` against `cfg.deck_root` at `deck_index = cfg.minted_total`. The seed/root are public before any mint, and the Bank signature is mandatory for every mint.

**Gain:** Even if the seed is unbiased, the Bank can give Level V / IV indices to preferred wallets by controlling who receives a co-signed mint when a favorable `minted_total` index is next. The new scheme randomizes positions; it does not make assignment to people fair if the Bank can sequence or withhold signatures.

**Evidence to check:** On a local validator, after `commit_deck`, compute the deck. Prepare two otherwise valid mints for the next favorable index. The first landed transaction gets that card; the second fails once `minted_total` advances. A malicious Bank can sign/submit preferred users at favorable indices and delay others. On mainnet evidence would be a statistically implausible concentration of high levels among Bank-associated wallets at known high-card indices.

**Fix:** Do not reveal usable card positions before the order is fixed. Options:
- require a pre-seed immutable queue of mint intents, then assign levels after the queue/order is fixed;
- assign levels after mint close to a sorted list of already-minted assets;
- use a VRF/randomness source at mint that the Bank and minter cannot know before the transaction is ordered;
- bind deck leaves to precommitted buyer/asset commitments, not only to index.

---

### HIGH — `commit_deck` still accepts an arbitrary root unrelated to the stored seed

**Construct:** `commit_deck(root, salt)` checks `root != 0`, validates `sha256(salt) == deck_salt_hash`, reads the slot hash, stores `deck_seed`, and stores caller-supplied `root`. `mint_vault` later verifies proofs only against `cfg.deck_root`; it never uses `cfg.deck_seed`.

```rust
require!(hashv(&[&salt]).to_bytes() == committed, MintError::BadSalt);
let bh = blockhash_of_slot(&ctx.accounts.slot_hashes, want)?;
let seed = hashv(&[&salt, &bh]).to_bytes();
c.deck_seed = seed;
c.deck_root = root;
```

**Gain:** The admin can commit a root for a hand-built deck while storing an honest-looking seed. Mints then succeed against the arbitrary root. This is detectable off-chain, but not prevented on-chain.

**Evidence to check:** After a valid `commit_seed`, derive the real seed from SlotHashes, but call `commit_deck` with `root = deckRoot(buildDeck(census, different_seed))` and the correct salt. The program should accept. Then mint with proofs against the wrong-root deck. On-chain evidence is `config.deck_root != deckRoot(buildDeck(config.level_caps, config.deck_seed))`.

**Fix:** Make root/seed consistency a release-blocking on-chain or mechanically enforced condition. If full BPF derivation is too costly, use an incremental deck-commit process that verifies chunks and counts before finalizing, or move to a level assignment mechanism whose fairness can be checked per mint without trusting an arbitrary root. At minimum, the alarm/selftest must be a hard pre-mint gate that pauses/refuses opening if root != seed-derived root.

---

### MEDIUM — Single future slot entropy is biasable by timing plus validator/leader influence

**Construct:** `commit_seed` fixes `deck_slot = Clock::get()?.slot + 32`, but the caller controls when `commit_seed` is submitted/lands. The leader schedule is public.

**What a cheating Bank/admin must control now:**
- To bias only by normal user permissions: it controls salt and submission timing, but cannot replace the salt after one successful `commit_seed`.
- To bias the entropy slot: it must also control or bribe the leader for `deck_slot`, or time `commit_seed` so `current_slot + 32` lands on a controlled leader slot.
- To turn bad entropy into a re-roll: it needs ability to abandon the deployment/config, or to make the entropy slot unavailable and restart socially/off-chain.
- `paused` does not stop `commit_seed` or `commit_deck`; it lets the operator keep the sale closed after seeing the seed/deck.

**Gain:** A colluding leader with 32 slots’ notice can influence the slot hash by block contents and can at least skip/withhold a bad slot, causing permanent failure. If the project can abandon/redeploy before opening mint, skipped/bad draws become rejection sampling.

**Evidence to check:** Compare `DeckSeedCommitted.slot` to the leader schedule. A suspicious draw would have entropy slots led by Bank-controlled validators, skipped entropy slots causing `DeckSlotUnavailable`, or repeated abandoned deployments before mint opens.

**Fix:** Do not use one chosen future slot as the only entropy source. Hash a range of future slots with enough independent leaders, use an external VRF/randomness beacon, or make the entropy event occur after the participant order is fixed. Treat any abandoned committed seed as a public launch failure.

---

### LOW — Docs say “Bank” commits the salt, but the program authorizes `admin`

**Construct:** `CommitSeed` and `CommitDeck` require `has_one = admin`, not `has_one = bank`.

**Gain:** If governance/admin and Bank are separate roles, the party controlling randomness is not the party described in the protocol text.

**Evidence to check:** A transaction signed by `config.bank` but not `config.admin` rejects; `config.admin` succeeds.

**Fix:** Either rename the protocol actor to admin/Squads everywhere, or require the intended signer(s), e.g. admin + Bank, depending on the trust model.

---

## R2 — `blockhash_of_slot`

The raw layout parse appears consistent with Solana SlotHashes: little-endian `u64 count`, then `count` entries of `(u64 slot, [u8;32] hash)`, stride 40. The code does not rely on ordering.

### MEDIUM — The stated “512-slot / 3.4-minute window” is an upper bound, not a guarantee

**Construct:** `blockhash_of_slot` succeeds only if the exact `deck_slot` appears in SlotHashes. Skipped/non-rooted/missing slots are permanent failure just like aged-out slots.

**Gain:** A skipped entropy slot, RPC/runtime anomaly, or leader withholding can permanently prevent minting. This is fail-closed for fairness, but it is a sharper availability risk than “missed the 512-slot window.”

**Evidence to check:** If `DeckSeedCommitted.slot` never appears in SlotHashes, every `commit_deck` returns `DeckSlotUnavailable` even immediately after that slot. A skipped-slot entropy event has no on-chain recovery.

**Fix:** State the bound as “must appear in SlotHashes,” not “512 slots guaranteed.” If availability matters, derive entropy from a range of future produced slots, not one exact slot.

---

## R3 — `bank/distribute.mjs`

### MEDIUM — Tombstone test treats absent/non-Core/malformed accounts as burns and skips payment

**Construct:**

```js
const raw = await conn.getAccountInfo(new PublicKey(v), 'confirmed')
tomb = !raw || raw.data.length < 1 || raw.data[0] !== 1
if (tomb) { burnedSinceIndex.push(v); continue }
```

A real Core burn tombstone is measured as an existing Core-owned account with key byte `0` / uninitialized. The code also treats `null`, zero-length data, wrong owner, and any non-AssetV1 account as a burn.

**Gain:** An RPC/index inconsistency can silently remove a live holder from that day’s distribution instead of halting. The payment loop has the same shape for `burnedMidRun`.

**Evidence to check:** Stub or force `fetchAsset` to throw and `getAccountInfo(v)` to return `null` for a live indexed vault. The code appends to `burnedSinceIndex`, not `unreadableLevels`, and proceeds to pay others. In ledger/logs, the vault is reported as “burned after the index” without a Core tombstone account proving it.

**Fix:** Only classify as tombstone when:
- `raw` exists;
- `raw.owner == CORE`;
- `raw.data.length >= 1`;
- `raw.data[0] !== 1` or, better, specifically `raw.data[0] == 0`.

Treat `null`, wrong owner, and unreadable/malformed data as halt/refusal, not burn.

---

### MEDIUM — Non-atomic `minted_total` + DAS snapshot can halt payouts during ordinary mint/index lag

**Construct:** `distribute.mjs` reads `mintedTotal` from MINT config, then fetches DAS pages, then requires:

```js
BigInt(uniqLive.length + uniqBurnt.size) === mintedTotal
```

**Gain:** A normal mint occurring between the config read and DAS fetch, or DAS lag in either direction, can produce `index returned X ... but chain says Y` and halt all payouts. The round-20 burn/tombstone fix handles burns after the index but not concurrent mints or index lag around minting.

**Evidence to check:** Mock DAS to return one extra or one fewer unique asset than the `mintedTotal` read at job start. The job throws before per-vault handling. On live logs this would appear as index/count disagreement during an open mint window.

**Fix:** Use a consistent snapshot strategy: read config after DAS and retry on mismatch, require two stable reads, or run distributions only when minting is closed/paused. If mismatch persists, halt; but transient mismatch should trigger retry before paging.

---

### Third halt route

Besides unlevelled vaults and bare-burn tombstones, the practical third route is the non-atomic chain/DAS count mismatch above. Another non-attacker route is RPC/rate-limit failure over ~2,100 `fetchAsset` calls, which is already close to accepted limit 22.

---

## R4 — Defects of the same shape as the repair defects

### LOW — `bank/deck.mjs --selftest` has a stale internal floor and lower-bound check

**Construct:** The deck selftest runs 17 assertions but contains:

```js
const FLOOR = 16
if (R.length < FLOOR) ...
```

`run-tests.sh` has `DECK_FLOOR=17` and equality, so the full runner catches this; direct `node bank/deck.mjs --selftest` does not.

**Gain:** A direct deck selftest can lose one assertion and still exit 0. This is the exact “floor below real count” class fixed elsewhere.

**Evidence to check:** Count the `t(...)` calls in `bank/deck.mjs` selftest: 17. Delete or skip one assertion and run the file directly; it still clears `FLOOR=16`.

**Fix:** Set `FLOOR = 17` and require equality, matching `selftest.mjs` and `distribute.mjs`.

---

## R5 — New suite arms

### LOW — 2.0h is cross-language for hashing, but not independent for SlotHashes layout

**Construct:** The test derives `entropy` by manually parsing SlotHashes with the same `(u64, [u8;32])` layout as the Rust, then compares `DECK_SEED` to the program’s stored seed.

**Gain:** This catches Rust-vs-JS hash/salt drift, but both implementations could share the same wrong sysvar layout assumption.

**Evidence to check:** If both parsers read the same wrong 32 bytes from SlotHashes, 2.0h still passes. It is not an independent sysvar-layout oracle.

**Fix:** Add one independent check using a known-good SlotHashes decoder or a separate fixture generated from Solana’s sysvar type. Also rename “blockhash” to “slot hash” unless the intended value is explicitly the SlotHashes hash.

**Other checks:** The hardcoded offsets are correct: `deck_salt_hash` at 561, `deck_slot` at 593, `deck_seed` at 601 including the Anchor discriminator. The 2.0 negative arms appear ordered to hit their named guards.

---

## R6 / R8 — Accepted-limit rewrites and one-of-N-site failures

### MEDIUM — SPEC and `distribute.mjs` still contain the old off-chain-level / old packet-bound protocol text

**Constructs:**
- `bank/distribute.mjs` still says: “THE LEVEL LIVES OFF-CHAIN… no program change, no Core attribute… commitment not built,” before later saying levels come from the asset.
- SPEC’s “level is ON-CHAIN” section still says the deck was `sha256(bank_salt ‖ blockhash(slot X))`, salt “revealed at close,” and “Measured at depth 7: seven caller attributes fit, the eighth does not serialize.”
- The accepted-limit item 23 later corrects this to 29/18/13 packet attributes and “program allows 7.”

**Gain:** Operators and future auditors can follow stale protocol text: expecting a reveal at close, believing the packet binds at 7 attributes, or believing the old off-chain register still exists. This is under-claim and over-claim in different places.

**Evidence to check:** Grep the provided files for:
- `THE LEVEL LIVES OFF-CHAIN`
- `salt revealed at close`
- `seven caller attributes fit`
All are still present outside the corrected accepted-limit text.

**Fix:** Delete or replace the stale sections. Keep one source of truth for:
- seed committed/stored immediately;
- no reveal phase;
- level written on-chain at mint;
- packet holds 18 at production depth, program allows 7;
- root/seed consistency is not enforced on-chain.

---

### HIGH — SPEC overstates “Bank cannot deal off-deck” as on-chain prevention

**Construct:** SPEC says:

> “the Bank cannot deal off-deck … Merkle proof against a pre-committed `deck_root`, bound to `minted_total` — prevented on-chain”

But the program does not verify `deck_root` is derived from `deck_seed`; it only verifies proofs against whatever root was committed.

**Gain:** The accepted public document states a stronger guarantee than the program enforces.

**Evidence to check:** Same as R1 arbitrary-root test: commit a wrong root with correct salt; mints against wrong root succeed.

**Fix:** Change the claim to “off-deck relative to the committed root is prevented; root fairness is externally verified,” or enforce root/seed consistency.

---

## R7 — Counts and arithmetic

### Verified arithmetic

- Floors in `scripts/run-tests.sh`: `MIN_ASSERTIONS=330`, `DET_FLOOR=439`, `ALLOC_FLOOR=103`, `MAINNET_FLOOR=19`, plus `DECK_FLOOR=17`.
- 240 census: `108*2 + 60*3 + 36*4 + 24*5 + 12*6 = 732`.
- 2,100 census: `945*2 + 525*3 + 315*4 + 210*5 + 105*6 = 6,405`.
- Per $1,000:
  - 240: `2.73, 4.10, 5.46, 6.83, 8.20`.
  - 2,100: `0.31, 0.47, 0.62, 0.78, 0.94`.
- Shares at 2,100: `29.5%, 24.6%, 19.7%, 16.4%, 9.8%`, summing to `100.0%`.

### LOW — SPEC still says detector selftest has 69 assertions

**Construct:** SPEC’s Bank alarm section says `bank/selftest.mjs` proves detectors with “69 assertions,” while the real floor is 439.

**Gain:** Under-claims the actual gate and teaches readers the counts are stale/decorative.

**Evidence to check:** Grep SPEC for `69 assertions`; compare `DET_FLOOR=439`.

**Fix:** Replace with the real floor or remove inline counts outside the mechanically checked “Running the tests” block.

---

## Accepted limits — four requested questions

### 1. Is any limit worse than stated?

Yes.

- Limit 23 is worse/incomplete because deck-size measurement is fixed, but deck fairness still has two unlisted problems: arbitrary root accepted on-chain and Bank-controlled mint ordering after public deck reveal.
- Limit 22 is reinforced by R3: live distribution I/O can halt or skip incorrectly under null/non-atomic reads.
- Discharged 12/17 may be overbroad: the suite measures CU for the mint path, but I do not see a landed worst-case redemption CU measurement.

### 2. Is anything listed as a limit not actually a limit?

I did not identify a newly closed accepted limit beyond the corrections already recorded for 1a and 9. The fee-payer/program-allowlist gaps remain off-chain; the Bank-payer-inside-approved-pair issue remains real for redemption; foreign nested assets remain not continuously detected.

### 3. Is any discharged item not actually discharged?

Potentially item 12/17.

**Construct:** Test section 10 measures `mint_vault` CU with padding. It does not measure worst-case redemption CU: `open_for_redemption + Core Execute sweeps/closes + burn_vault` with three reserve mints and lamport sweep.

**Evidence to check:** Add `cuOf(sig)` around the landed 3-reserve worst-case redemption transaction used for byte measurement. If it is under 1.4M with margin, discharge is complete. Until then the discharge is proven for mint, not all Bank-signature paths.

**Fix:** Add redemption CU assertions for 1- and 3-reserve redemptions, with and without the widest byte-fitting padding.

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

Yes-risk.

- Limit 22 says no distribution has run against live chain and must be exercised before it pays anyone. `cron-install.sh` installs `distribute.mjs` live by default unless `--dry-run` is already preserved. That is operationally dangerous if mainnet cron is installed before the live-chain exercise.
- Limit 23 remains open, but older SPEC text presents the deck packet measurement as settled in the wrong way.

**Fix:** Make the installer default distribution to `--dry-run` until a deliberate “live distribution exercised” marker or flag is present.

---

## Anything else

### LOW — `scripts/audit21.ts` can ask accepted-limit questions about files it does not deliver

**Construct:** The target-file guard scans only the R1–R8 prose before the accepted-limits section:

```ts
const targetSection = PROMPT.slice(PROMPT.indexOf('**R1.'), PROMPT.indexOf('THE ACCEPTED LIMITS ARE THE MOST VALUABLE'))
```

But the accepted limits and control-table checks discuss `bank/alarm.mjs`; the bundle shown here does not include `bank/alarm.mjs`.

**Gain:** Auditors are asked to verify claims depending on a file they cannot inspect, recreating the round-19 “asked about omitted files” class.

**Evidence to check:** `TARGETS` omit `bank/alarm.mjs`; accepted limits and selftest assertions depend on alarm behavior such as `if (s.err) continue`.

**Fix:** Either include `bank/alarm.mjs` or extend the path-delivery guard to every authored prompt section, including accepted limits and measured-facts references.

---

## GIVEN NO HUMAN FIRM WILL EVER SEE THIS

Do not add another prose audit round as the only answer. Add operational controls that create independent facts:

1. **Run a staged mainnet rehearsal with no customer funds.** Deploy the exact binaries, mint disposable vaults, run DAS/alarm/distribution/revenue crons for several days, force burns/mints during distribution, and record every mismatch.
2. **Make deck finalization a ceremony with artifacts.** Publish salt hash, seed slot, slot leader, derived seed, deck file, root, and independent recomputation logs before minting. Refuse to open if any independent recomputation disagrees.
3. **Add a canary launch.** First production round should have a tiny cap and a capped revenue amount, then freeze changes and observe one full revenue/distribution/redemption cycle.
4. **Separate keys and machines by function.** Bank signer, swap operator, distributor, deploy authority, and audit runner should not share a host or shell history. AI review cannot validate custody.
5. **Create an incident drill before launch.** Practice: RPC/DAS outage during distribution, poisoned ATA, bare burn, stuck lock, wrong deck root, bad cron posture, and lost Bank key. Record exact commands and expected alerts.
6. **Add an external randomness source or remove pre-mint public ordering.** The current deck scheme still lets the Bank allocate known indices. This is not a test-suite issue; it is a mechanism issue.
7. **Use immutable release artifacts.** Store program `.so` hashes, IDLs, SPEC, deck artifact, and test manifests in a public append-only location before any mint. Future “the docs said X” disputes need a timestamped artifact, not memory.