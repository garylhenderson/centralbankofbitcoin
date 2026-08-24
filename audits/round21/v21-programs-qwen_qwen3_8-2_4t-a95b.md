# ROUND 21 AUDIT — the 045fcc0..HEAD repairs

I read the diff as the subject and the bundled files as the evidence base. Where a question has a yes/no answer I give it; everything else is a fault or a stated limit. I found no CRITICAL in the diff itself, but I found one HIGH that strikes at the guarantee the whole round exists to buy, and several places where the fail-closed posture leaks open on the money path.

---

## R1 — the commitment scheme

**What a cheating Bank must now control, stated precisely:**

| to cheat this way | it must control | does anything here stop it? |
|---|---|---|
| rig the deck *undetectably* | — | yes — the seed is public, so a rigged root is provably wrong |
| rig the deck *detectably* | only the `root` it passes to `commit_deck` | **no, not on-chain, and not off-chain either (finding A1)** |
| bias the seed via entropy | the leader of slot `deck_slot` | no; bounded only by how far a leader can move a blockhash |
| hand good indices to friends | co-signature ordering against the now-public deck | **no (finding A2)** |

The scheme genuinely closes "choose the deck after seeing who showed up" and "replace the salt" (both one-shot, verified). It does **not** close the three rows below.

### A1 — HIGH — the program enforces a root it never checks against the seed, and the compensating detector does not exist
`commit_deck` derives `seed = sha256(salt ‖ blockhash)` and stores it, then stores the caller's `root` with **no `require!` relating the two**. `mint_vault` verifies proofs against `cfg.deck_root` and never reads `cfg.deck_seed`. So a Bank (admin) can commit a root for a rigged deck; every mint then verifies happily against the rigged root; the stored seed merely *describes a different, fair deck*. The author acknowledges the on-chain gap ("the program does not verify that `root` is the deck of that seed"). What is **not** acknowledged is that the stated compensation is absent:

- `bank/detectors.mjs` (bundled, read) contains no detector comparing `deck_root` to `merkleRoot(buildDeck(level_caps, deck_seed))`.
- `bank/selftest.mjs` (bundled, read) proves every detector in both directions and has no such arm.
- `WATCHED_KEYS` / `WATCH` in `detectors.mjs` include **none** of `mint.deck_root`, `mint.deck_seed`, `mint.deck_salt_hash`, `mint.deck_slot` — so even `detectConfigDrift` will not fire when a rigged root is committed. The commitment fields are entirely outside the alarm's vision.

Yet `bank/deck.mjs` and `programs/cbob-vault-mint/src/lib.rs` both assert "`bank/selftest.mjs` checks the relationship and the alarm watches it in production." That is the "comment asserting a control that does not run" class this project has shipped more than any other, now sitting on the one mechanism the round was written to create.

**What is gained:** the Bank deals itself/friends Level V vaults. Mints proceed against the rigged root for the entire detection window, and minted levels are irreversible — detection, when it finally comes from a manual holder recompute, proves the cheat but cannot unwind a single vault. The guarantee "assigned by fate, no way to game it" is, on-chain, `commit_deck` accepting any 32 non-zero bytes.

**Evidence if I am right:** `grep -n "deck_seed\|deck_root" bank/detectors.mjs bank/selftest.mjs` returns no verification logic; `deck_root`/`deck_seed` are absent from `WATCHED_KEYS`. Runnable proof: commit `salt_hash`, let the slot pass, call `commit_deck` with a root that is *not* `deckRoot(buildDeck(caps, seed))` — it succeeds, `mint_vault` succeeds against it, and no detector in `selftest.mjs` has an arm that would fire.

**Fix:** build the detector (read `deck_seed`, `deck_root`, `level_caps` from the config via the pinned reader, rebuild `buildDeck`, compare `deckRoot`, fail loud on mismatch), prove it in both directions in `selftest.mjs`, and add the four deck fields to `WATCHED_KEYS`. Until that exists, record an ACCEPTED LIMIT stating exactly: "a root that does not match the seed is accepted on-chain, minted against, and irreversible; detection is manual holder recompute only." Do not ship the comments claiming an alarm that is not there.

### A2 — MEDIUM — the commitment closes deck *choice*, not minter *ordering* against a now-public deck
`commit_deck` must precede the first mint and publishes `deck_seed`, so the full index→level map is computable **before minting opens**. The Bank co-signs every mint and therefore decides which minter lands on which `minted_total`. The deck comments frame the closed threat as "hand the good cards to whoever it liked," but that is still reachable: hold co-signatures until a friend's mint lands on a publicly-known Level V index, refusing strangers in between. Nothing in this diff touches it. It is partly accepted-limit-1b territory (Bank policy is procedure), but the deck prose overstates what was closed. State it, or add an ordering commitment (e.g. co-sign in a publicly verifiable sequence).

### A3 — LOW — blockhash bias by the `deck_slot` leader is an unstated limit
The seed's entropy half is a SlotHashes blockhash. A Bank that is, or bribes, the leader of `deck_slot` can bias that hash within the narrow range a leader controls, and it has 32 slots of notice to arrange it. The bound is small (a leader cannot grind a blockhash freely) but it is real, and it is nowhere in the carry list. Add it as an accepted limit: "the seed inherits Solana blockhash bias; a colluding leader of `deck_slot` can skew, not choose, the deal."

`commit_seed`-grinding and abandon-and-re-init are genuinely closed (one-shot + no re-seed + non-reinitializable PDA). `paused` does not gate either commit instruction, which is fine — committing is not minting — but note that staying paused through the window bricks the commitment (A4).

---

## R2 — `blockhash_of_slot`

The layout is right and the failure modes fail closed. SlotHashes is **bincode**, not Borsh, so the Vec length is a **u64** (8 bytes) — the 8-byte count read is correct (a Borsh assumption would have made it u32 and broken). Stride 40 (u64 slot + [u8;32] hash), little-endian, newest-first; the search scans all entries so ordering is not load-bearing. Truncated account, `n > 512`, `data.len() < 8+n*40`, and all-zero hash all refuse; `n == 0` and "slot not present" return `DeckSlotUnavailable` (closed). A duplicated slot returns the first match — deterministic, not exploitable.

### A4 — LOW — the "~3.4 min then permanent brick" is enforced, but is not in the carry list
The window is `[deck_slot, deck_slot+512]`: before `deck_slot` the hash is not yet in the sysvar (`DeckSlotUnavailable`, retryable), after `deck_slot+512` it has aged out and `commit_deck` can never succeed again — no re-seed, config PDA not re-initializable, recovery only by program upgrade. That is what the code enforces and the comment states it, but it is a permanent-brick consequence of a single missed operational window and it is **not** in ACCEPTED LIMITS. It belongs there, beside the blockhash-bias limit (A3).

### A5 — LOW — the suite's sysvar parse and the program's share a circularity (also R5)
Both `blockhash_of_slot` (Rust) and the test's inline parser read the same account with the same assumed layout. They agree with each other, but nothing compares the extracted hash to an independent source. A shared layout error would pass 2.0h and silently break public verifiability. The layout is in fact correct, so this is a test-strength gap, not a live bug. Add one arm: parsed blockhash of `deck_slot` equals `getBlock(deck_slot).blockhash`.

---

## R3 — the halt in `bank/distribute.mjs` (treated as unread, per the prompt)

The inner `catch { tomb = false }` does what it says: an RPC failure while asking "is this a tombstone" leaves `tomb` false, routes to `unreadableLevels`, and halts. That is the correct direction and I verified it.

### A6 — MEDIUM — an ABSENT account is classified as a burn, but a burn never removes the account
`tomb = !raw || raw.data.length < 1 || raw.data[0] !== 1`. The `!raw` branch treats a *missing* account as a burned vault and skips it. Measured fact 9 is explicit: a burned asset's account **survives** as a Core-owned 1-byte tombstone. So an absent account is not a burn — it is a DAS/chain contradiction or an account that was closed, and the stated design is "anything else still halts." As written, an anomalously-absent vault is silently dropped and its share redistributed to everyone else — precisely the silent-drop the refusal exists to prevent. It also never checks `raw.owner === CORE`.
**Evidence:** on a validator, arrange a live-listed id whose `getAccountInfo` returns null (or stub it); it lands in `burnedSinceIndex`, not `unreadableLevels`, and the day pays out short one vault with only a `console.log`.
**Fix:** treat `!raw` as unreadable (halt); accept as a burn only `raw.owner === CORE && raw.data.length >= 1 && raw.data[0] === 0`.

### A7 — LOW — `data[0] !== 1` is broader than "tombstone"
A tombstone is specifically `Key::Uninitialized == 0`. `!== 1` skips *any* non-AssetV1 byte as burned, which fails open on any future Core key value. Both the level loop and the payment loop (`burnedMidRun`) use `!== 1`, so a correction must hit **both sites** — the one-of-N shape. Prefer `=== 0` (halt otherwise).

**Third route:** a transient `fetchAsset` failure followed by a successful `getAccountInfo` showing a *live* asset (`data[0] === 1`) halts the whole distribution. That is fail-closed and correct, but it makes the job fragile to one RPC hiccup over ~2,100 reads; a bounded retry of `fetchAsset` before the tombstone probe would reduce spurious halts without weakening the posture.

---

## R4 — the two known defects, and others of that shape

The one-shot ordering in `commit_deck` is now correct: `DeckAlreadyCommitted` is first, and no later check depends on state it establishes (`SeedNotCommitted` guards the `deck_slot` read because `commit_seed` sets salt-hash and slot together). I found no remaining "reject for the wrong reason" in the instruction.

### A8 — LOW — the equality-floor discipline missed `bank/deck.mjs` (one-of-N)
Round 19 moved `selftest.mjs`, `distribute.mjs`, and `run-tests.sh` to **equality** floors (`R.length !== FLOOR`). `bank/deck.mjs --selftest` still uses the old lower bound `if (R.length < FLOOR)` with `FLOOR = 16`, while it actually runs 17 assertions and `run-tests.sh` demands equality at `DECK_FLOOR = 17`. The runner catches a deletion, but a direct `node bank/deck.mjs --selftest` run would tolerate dropping one assertion. Same-site defect, fourth selftest left on the old style.

No other unfailable arm found: 11.11 (`maxAttrs < PROBE_CEILING`), 11.11a, 11.11b (`at7>at11>at13`), and 11.11c can all fail; the 64 ceiling is above any plausible budget, so "loop ran out" can no longer masquerade as a measurement.

---

## R5 — the suite's new arms

- 2.0c–2.0i each exercise the check they name; I traced the guard order so no earlier require fires first (2.0c reaches `SeedNotCommitted` because `committed == 0` precedes the salt compare; 2.0a reaches `BadDeckRoot`; 2.0i reaches `BadSalt`). `because()` pins 2.0a/2.0c/2.0d/2.0f/2.0i. The two **un**pinned arms are 2.0g (entropy present/non-zero) and 2.0h (seed compare) — neither is a rejection and both can fail, so they are not false passes; 2.0h's weakness is A5.
- 11.11/11.11a/b/c are not vacuous (see R4).
- **Offsets verified against the struct:** walking the Borsh layout from the 8-byte discriminator, `deck_salt_hash` lands at 561, `deck_slot` at **593**, `deck_seed` at **601**. `OFF_DECK_SLOT=593` and `OFF_DECK_SEED=601` are correct; this is also consistent with the suite's known-good offsets (`minted_total` 205, `governance` 105, `treasury` 137, `swap_operator` 256, `pending_operator` 449). The `Initialize` space added `32+8+32` and `CONFIG_PADDING` dropped 184→112, so the account size is unchanged. No finding.

---

## R6 — the accepted-limits rewrites

- **Limit 1a** now reads correctly: the Bank-pubkey confinement is on-chain in both programs (SEAL `BankKeyOutsidePair`, MINT `BankKeyOutsideMint` — both present in the bundled source), and only the allowlist + fee-payer checks remain off-chain. The under-claim is fixed.
- **Limit 23** is now backed by a failable measurement (11.11 asserts the packet bound is reached; 11.11b asserts depth variation), and the conclusion (program binds at 7, packet holds 18 at depth 11) is internally consistent. It stays OPEN AND BLOCKING legitimately.
- The rewrite process did **not** add the limits this diff itself creates (A1, A3, A4). An under-claim by omission: the fairness mechanism's residual risk and its brick window are described only in code comments, not in the list a freeze locks in.

---

## R7 — counts and arithmetic

- Floors read from `scripts/run-tests.sh`: `MIN_ASSERTIONS=330`, `DET_FLOOR=439`, `ALLOC_FLOOR=103`, `MAINNET_FLOOR=19`, `DECK_FLOOR=17`. These match the intro's quoted figures (330/439/103/19). The only wrinkle is A8 (deck.mjs's internal 16).
- Re-derived independently: 108/60/36/24/12 → 240, denominator 732; 945/525/315/210/105 → 2,100, denominator 6,405. Per-$1,000 at 240 = 2.73/4.10/5.46/6.83/8.20; at 2,100 = 0.31/0.47/0.62/0.78/0.94. Shares at 2,100 = 29.5/24.6/19.7/16.4/9.8, summing to 100.0%. All reproduce from the weights; no discrepancy.

---

## R8 — one-of-N-sites

- Tombstone check: applied to the level loop; the payment loop already had it. Both sites covered, but both use the over-broad `!== 1` (A7) — a fix must land on both.
- Equality floors: applied to three selftests, missed `deck.mjs` (A8).
- Deck verification: claimed for both `selftest.mjs` and "the alarm," present in neither (A1).

---

## The accepted limits — the four questions

1. **Worse than stated?** Yes, in one place. The deck-fairness guarantee (the reason levels-at-mint exists) rests on a compensating detector that does not run and on config fields the alarm does not watch (A1). As frozen, the list would lock in a fairness guarantee whose only enforcement is manual holder recompute. That is an accepted limit that is effectively exploitable by the trusted party until the detector is built.
2. **Listed but not actually a limit?** None found fully closed. Item 9 was correctly narrowed (cosign's `scanPda` does keep every non-burnt asset regardless of collection and fails closed on DAS error/full page — verified in the bundled `cosign.mjs`).
3. **Discharged but not actually discharged?** Item 19's discharge holds for the *unlevelled* window (level is written at mint; no activation-but-no-level gap). But its "cannot omit a holder without halting everyone" claim does not survive A6: an anomalously-absent account is skipped as burned, silently dropping that vault and redistributing its share. Do not overturn the discharge; narrow its wording and fix A6.
4. **OPEN AND BLOCKING quietly treated as accepted?** Not 22 or 23 themselves, but this diff adds a new live-read path (per-vault `getAccountInfo` tombstone probe over ~2,100 vaults) that rides entirely on item 22's "never run against a live chain" status. Item 22 should explicitly name the tombstone-read path before it pays anyone.

---

## Anything else

- **Admin vs Bank framing:** `commit_seed`/`commit_deck` are `admin`-gated (`has_one = admin`), while the prose frames the actor as "the Bank." In practice the Bank supplies `salt` and `root` off-chain and admin (the multisig) signs. Since the program does not verify root-vs-seed and no detector does either, an admin that does not independently recompute is rubber-stamping the Bank's values. State who is expected to verify, and give them the standalone verifier below.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Nineteen rounds of AI audit share three structural blind spots that no further AI round closes, and each has a concrete answer:

1. **Every round consumes the same measurements, so a systematically wrong measurement is inherited by all of them.** The suite runs on a local validator with Core cloned at a point in time; nothing compares it to the live network. Break the circularity: run the commitment, redemption, and tombstone paths against a long-lived devnet/testnet (or a mainnet fork) with real DAS and real SlotHashes, and add the ground-truth arm of A5 (parsed blockhash vs `getBlock`). One independent data source is worth more than another eight readers of the same one.

2. **AI cannot hold keys or exercise time-dependent operational failure.** The failures that actually brick or steal here are operational, not code-readable: missing the 3.4-minute commit window (A4), a wedged lock mid-distribution, an RPC outage between index-build and the level loop, a burned vault landing in the wrong branch. Run a human-operated drill of each — deliberately miss the commit window, kill the distributor mid-run, burn a vault between index and loop — and write the runbook from what happened. No bundle contains the machine the keys live on; that is a physical/ops review.

3. **The scheme's whole guarantee is "any holder can recompute," but the only recomputation tooling is the Bank's own.** Ship a **standalone, dependency-free deck verifier** that reads `deck_seed`/`deck_root`/`level_caps` from a public RPC, rebuilds the deck, and compares — importing nothing from `bank/`, so it cannot share a bug with `deck.mjs`, and runnable by any holder. This is the thing that converts A1 from "trusted party can cheat undetected" into "trusted party can cheat and any holder catches it," which is the property the commitment was built to claim.

These are not in THE SHIP GATE (which governs coverage, freeze, and clean rounds); they govern whether the artifact the rounds certify is connected to reality and independently checkable.