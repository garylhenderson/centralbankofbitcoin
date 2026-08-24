# Independent Audit — Round 20 (Levels-at-Mint, the Deck, and the Self-Audit)

Calibration note before findings: nothing has minted, so every "CRITICAL" below is pre-launch-blocking, not live exploitation. I have independently re-derived every arithmetic claim I could (see R7) and I flag where I could **not** find a defect as clearly as where I could — a clean check is reported as a clean check, not upgraded into a finding.

---

## R1 — `bank/deck.mjs`

### R1-1. CRITICAL — The commit-reveal protocol that makes the deck "binding" has ZERO on-chain representation

`commit_deck(ctx, root)` accepts an arbitrary 32-byte value and checks only that it is non-zero and that no root is already set. There is no instruction, account field, or event anywhere in `programs/cbob-vault-mint` that records `sha256(bank_salt)`, records the announced slot `X`, or timestamps anything. The entire "the Bank publishes `sha256(bank_salt)` and names slot X **before minting opens**" story is a comment in `bank/deck.mjs`, not a mechanism.

**What this means concretely:** the claim "a Bank that shuffled from a salt it chose after seeing the blockhash cannot produce a salt whose hash matches what it published" is true only if the publication genuinely happened first and is checkable. Nothing here lets anyone check that. The Bank can:
- pick any past, already-known blockhash and call it "slot X",
- grind arbitrarily many `bank_salt` values against it until `buildDeck` produces a favorable placement at a chosen index,
- commit that root,
- and optionally "publish `sha256(bank_salt)`" only *after* doing all of the above, since nothing anchors that publication to a time before the deck was known.

There is no artifact a holder can point to and say "the commitment predates the outcome." The only enforcement is that the *revealed* salt, if ever revealed, must hash to whatever was "published" — but "published" itself is undefined by this codebase.

**Evidence that would exist if this is right:** grep `programs/cbob-vault-mint/src/lib.rs` and `bank/deck.mjs` for any instruction/event named around "salt" or a hash-of-salt — there is none; `commit_deck`'s only inputs are the root itself.

**Fix:** add an on-chain `commit_salt_hash(hash)` (and, ideally, a slot number) instruction that must be called and confirmed **before** `commit_deck`, with `commit_deck` required to reference it, and `reveal_salt` checked against it at close. Without this, "the deck cannot be gamed" is a promise, not a property.

### R1-2. CRITICAL — Nothing ties the committed deck's per-level census to `level_caps`

`commit_deck` never sees the deck, only its Merkle root — by design, since the root hides the leaves. But nothing else checks that the deck actually being committed has, e.g., exactly 105 Level-V cards to match `level_caps[4]=105`. `buildDeck(census, seed)` in `bank/deck.mjs` will happily build a deck for *any* `census` array, and there is no on-chain assertion binding the committed root's implied distribution to `level_caps`.

**Consequence, traced precisely:** `mint_vault` checks `level_minted[li] < level_caps[li]` (quota) **before** it checks the deck proof (`BadDeckProof`). Since `minted_total` is a single shared, monotonically increasing counter used as the deck index for every mint, and mints must proceed strictly in index order (there is no way to skip an index — a successful mint at index N is required before index N+1 exists), a mismatched deck breaks catastrophically: if the actually-committed deck front-loads more Level-V cards than `level_caps[4]` allows (e.g. by mistake, or by design, since nothing forbids it), then the moment `level_minted[4]` hits its cap while `deck[minted_total]` is *still* Level V, **every future mint attempt fails forever** — `level=5` fails `LevelCapReached`, and any other `level` fails `BadDeckProof` (the deck disagrees). `minted_total` can never advance past that index because no successful mint can occur there, and no later index is reachable without it. This is a **permanent, global halt on all future minting, for every level, triggered by a single administrative mismatch that nothing on-chain can detect before it happens or repair after.**

This directly answers R2's own question ("does the deck deal that card at the next index — does minting halt for everybody?") — yes, permanently, and the suite never exercises it: `tests/3prog.test.ts` sets `LEVEL_CAPS = DECK_CENSUS = [50,20,10,5,5]` — identical arrays — so the mismatch this finding depends on is untested by construction.

**Fix:** either (a) have `commit_deck` also take the census and verify a second, separate commitment (e.g., a hash of the census array) that a public verifier can check against the eventual revealed deck, and have the program independently track cumulative level counts against it; or at minimum (b) have the off-chain minting client refuse to construct a mint transaction whose own local recomputation of the deck disagrees with `level_caps`, and treat this as a release gate rather than an assumption.

### R1-3. CRITICAL — The deck-builder always knows the full index→level mapping; sequencing is not protected

The stated threat model is: "a minter... can simulate and retried until it lands on V. They cannot choose which mint number they are." That is true for an ordinary buyer. It is **not** true for whoever builds the deck — which, by the nature of building a Merkle tree, requires possessing every leaf. The Bank (or anyone the Bank shares the array with) knows, from before minting opens until the deck is publicly revealed at close, the *entire* index-to-level mapping.

`minted_total` is a plain public account field (readable by anyone via `getAccountInfo`, as the suite's own `deckIdx()` helper does). So whoever holds the deck array can simply watch the counter and choose *when* to submit their own mint transaction (or a favored buyer's) to land on a known Level-V index — no cryptography needs to be broken, no grinding is required. Because the charter round is explicitly free by design (`price_lamports = 0` is stated as intended), an insider could even mint a sequence of disposable, no-cost vaults purely to advance `minted_total` to a chosen index, then mint the "real" vault there.

This is a structural property of "commit one fixed permutation, then let people mint in arbitrary order": it protects against grinding by someone who does *not* know the deck, and provides no protection at all against the one party who, by construction, always does. This defeats "assigned by fate... with no way to game it" for the party the mechanism exists to constrain.

**Fix:** this needs a design change, not a patch — e.g. derive the index a mint receives from something the minter cannot foresee at submission time (a VRF, or a hash of a future blockhash bound into the mint transaction itself, rather than a public monotonic counter), or publish the full deck (not just the root) before minting opens so the information asymmetry is at least public rather than insider-only.

### R1-4 (ties to R8). MEDIUM — `bank/deck.mjs`'s own selftest floor is looser than its siblings, and undercounted

I counted the `t(...)` calls in the deck selftest block: **17**, not 16. `deck.mjs`'s own gate reads:
```js
const FLOOR = 16
if (R.length < FLOOR) { ... }
```
using `<` (a minimum), not the strict-equality pattern (`!==`) that `bank/selftest.mjs` and `bank/distribute.mjs` both adopted this round specifically to close "floors accumulate slack." Also, unlike those two files, nothing cross-checks `deck.mjs`'s internal `FLOOR` against `run-tests.sh`'s `DECK_FLOOR=17` (that cross-check exists for `selfFloor`/`distFloor` but has no third entry for the deck). `run-tests.sh`'s external `floor()` bash function *does* enforce equality against 17 by parsing the printed count, so the CI gate happens to survive — but a developer running `node bank/deck.mjs --selftest` directly, the way the file's own usage comment invites, would see "16/16 (or 17/17) deck assertions as predicted" and have no internal signal that one assertion could silently disappear. This is the exact one-fact-multiple-readers pattern the round claims to have fixed, recurring in the newest file of the three.

**Fix:** change `deck.mjs`'s check to `R.length !== FLOOR`, set `FLOOR = 17`, and add the missing `deckFloor === DECK_FLOOR` cross-assertion in `bank/selftest.mjs` alongside the existing two.

---

## R2 — the level on chain

The mint-time checks (reserved key, duplicate key, empty key, level range, deck proof, level cap) are individually sound and I could not find an ordering/account-substitution bypass — the confinement walk, the Anchor account constraints (`seeds=...`, `address=...`), and the atomicity of the instruction all hold up. The two structural issues that *do* let a caller effectively "get a level not fairly dealt" are R1-2 and R1-3 above (they are mechanically MINT-side but rooted in the deck).

**LOW — case-sensitive reservation of `level`.** `require!(a.key != ATTR_LEVEL, ...)` is an exact byte comparison against the lowercase string `"level"`. A caller can set an attribute keyed `"Level"`, `"LEVEL"`, or a Unicode-confusable spelling; it will not be picked up by `levelFromAttributes` (also exact-match) and so has no payout effect, but it can sit on the NFT next to the real attribute and confuse a marketplace UI or a buyer about which value is authoritative. Cosmetic, not a money defect — worth a one-line fix (case-fold or reject any key that case-insensitively matches a reserved name) since the cost of doing so is near zero.

---

## R3 — the level at payout

**HIGH — the level-read loop has no retry/backoff, is fully sequential, and one transient failure halts the whole day's distribution.**

```js
for (const v of vaults) {
  ...
  try { const asset = await fetchAsset(umi, umiPk(v)); ... }
  catch (e) { unreadableLevels.push([v, ...]) }
  const info = await conn.getAccountInfo(a, 'confirmed')
  ...
}
```
This is ~2 sequential RPC round-trips per vault, run with no concurrency and no retry, for ~2,100 vaults (~4,200 calls per run, every day). `allocateWeighted` refuses the **entire** distribution the moment even one activated vault's level can't be read. There is no distinction in the refusal path between "the chain and the code disagree" (worth stopping for, as the design intends) and "the RPC hiccuped on vault 1,900 of 2,100" (an environmental fact that will recur). With zero retry logic, the probability that at least one of ~4,200 sequential calls transiently fails over a full run is not a tail case — over enough days it becomes close to the *default* outcome, not the exception.

This doesn't contradict item 22's "OPEN AND BLOCKING" status; it sharpens it. Per the accepted-limits instructions ("is any limit worse than stated?") — **I believe #22 is understated**: it reads as "untested, cost/behavior unknown," when the code as written has an identifiable, specific failure mode (no retry, refusal on first error) that is very likely to manifest as *frequent* refused distributions once run at scale, not merely "unknown behavior."

**Fix:** wrap `fetchAsset` (and the ATA read) in bounded retry-with-backoff before treating a vault as unreadable; batch/parallelize with a concurrency cap tuned to the RPC provider's rate limit; and, given #22 is explicitly open-and-blocking, this must be exercised against a real 2,100-vault set before anyone is paid — which is already the item's own stated remedy, but the specific failure mode above should be the acceptance criterion, not just "it ran once."

**Second sub-bullet (customer-triggerable halt):** I tried to construct one and could not. Because `mint_vault` writes the level atomically at creation, and the burn path always empties the vault's ATA before/while burning (so a redeemed vault drops below the 21,000-sat activation floor and is excluded from `allocateWeighted`'s `activated` set regardless of whether its level is still readable), I could not find a customer action that produces an *activated* vault with an unreadable level. This supports item 19's "closed by construction" claim on the customer-action axis specifically. The residual risk is the operational one above (R3), which is a different axis.

**Arithmetic (third sub-bullet):** independently re-derived — weights 2/3/4/5/6, census 108/60/36/24/12 → 732, census 945/525/315/210/105 → 6,405, per-$1,000 figures, and the five shares summing to 100.0% all check out exactly (see R7). No error found.

---

## R4 — the packet bound

**MEDIUM — assertion 11.11 is close to vacuous at the depth it's measured, and the production depth is never measured.**

`maxAttrs` is measured only up to `n=7` (`for(let n=0;n<=7;n++)`), and the comment states the result is exactly 7 — which equals `MAX_ATTRS_BORSH - 1 = 7`, i.e. the on-chain Borsh cap. The assertion `rec('11.11', ..., maxAttrs>=0 && maxAttrs<MAX_ATTRS_BORSH)` therefore passes trivially whenever the packet allows *at least* the Borsh-permitted maximum — which is what's measured — rather than demonstrating that the packet bound is the *actual* binding constraint below the Borsh cap. At the test deck's shallow depth (7, from a 90-card deck), the deck proof simply hasn't grown large enough yet to bite.

Independently recomputing the real deck depth for the stated 2,100-vault census ([945,525,315,210,105]): repeatedly halving 2100 with the odd-node-promoted rule gives 12 rounds (2100→1050→525→263→132→66→33→17→9→5→3→2→1), matching the Rust comment ("2,100 vaults is depth 12") — **not** "depth 11" as the audit prompt's own R4 text states. (Noted for accuracy; this is a discrepancy in the prompt, not in the code.)

Nothing in the suite or the program computes/asserts a *formula* relating deck depth to caller-attribute budget; it is measured once, at a shallow depth, and the gap to the real depth (12 vs 7 — five more Merkle layers, roughly 160 more proof bytes) is never quantified anywhere in this codebase. This is exactly what OPEN AND BLOCKING item 23 already flags, and I'm reinforcing it with a specific critique: the *existing* assertion (11.11) gives false comfort, because it would pass identically even if the packet bound at depth 7 provided zero additional constraint beyond the Borsh cap.

**Fix:** before deciding the production deck size, run the identical `attrFit` probe against a deck actually built at depth 12 (or whatever the final census implies), and change 11.11 to assert `maxAttrs < MAX_ATTRS_BORSH - 1` or an explicit numeric floor, not merely `< MAX_ATTRS_BORSH`, so a future regression at shallow test depth can't hide behind the Borsh ceiling again.

---

## R5 — Phase 1's own changes

**HIGH — the new "every occurrence" gate still misses a stale count, because it is anchored to specific phrasing, not to the fact.**

SPEC.md's Bank-alarm-pipeline section states: *"Every detector is proven in BOTH directions by `bank/selftest.mjs` (**69 assertions**)."* The real floor for that file (per its own `const FLOOR = 439` and `run-tests.sh`'s `DET_FLOOR=439`) is 439, not 69 — off by a factor of >6. None of the five regexes added this round catch it, because they are anchored on the literal words "detector", "allocation", "deck", "live-mainnet", and "assertions, real cloned Core" appearing immediately after the digits — and this occurrence is phrased as "(69 assertions)" with no adjacent keyword the regex looks for. The gate's own stated purpose ("Each phrasing is anchored on the WORD the number describes, so a new sentence in SPEC stating a count is caught by the phrasing") assumes every restatement of the same fact uses the same trigger word; this one doesn't, and it slips through — the exact "one fact, several readers, only one checked" pattern the round claims to have closed, reproduced a fourth time, inside the gate built specifically to end it.

**Fix:** either add a sixth regex anchored on `(\d+) assertions\)` appearing near "selftest.mjs"/"detector" context, or — better — replace all five phrasing-anchored regexes with a single check that greps for every numeral adjacent to any of a small set of nouns ("assertion", "detector", "allocation", "deck", "mainnet") and demands each equals its known-correct floor, so a new *sentence* can't invent a new escape shape.

**MEDIUM — 11.13/11.14 prove one Core instruction is refused, not that the level is un-rewritable by any Core instruction.** Both arms attempt `UpdatePluginV1` (variant 6) as owner and as Bank and correctly get `0x1a` (`NoApprovals`), which the suite carefully distinguishes from `0x1`/`0x2` (malformation) to rule out a false pass. That is real and good work. What it does *not* test is whether a *different* Core instruction touching the Attributes plugin (e.g. a plugin-removal instruction, if one exists with different authority semantics than an update) might behave differently for the same non-authorized signer. I can't verify this from the given bundle (mpl-core's full instruction/error surface isn't included), so I flag it as a coverage gap to close by measurement rather than asserting it is exploitable: add an identical owner/Bank negative test against Core's plugin-removal instruction (whatever its opcode is) before relying on 11.13/11.14 as proof of full immutability.

**R5 bullet 3 (the detectors.mjs under-claim correction):** I checked the corrected comment against `bank/cosign.mjs`'s actual `scanPda`/`judgeRedemptionCoverage` code and it holds up — the DAS owner-search does run before signing, does keep non-burnt assets regardless of collection, does fail closed on a DAS error, and does refuse a full page. No finding here; the correction appears accurate.

---

## R6 — an under-claim nothing here is instrumented to catch

**HIGH — Accepted Limit 1a is stale and self-contradictory within the same document.**

SPEC.md's own Accepted Limit 1a states: *"The program allowlist and the Bank-pubkey confinement are OFF-CHAIN. Nothing in any program bounds what else a redemption transaction contains; `open_for_redemption` scans forward only as far as its matching burn."*

That was true before round 17. It is not true now, and the contradiction is visible **inside the same file**: SPEC's own control table, two sections earlier, states plainly:

> "**THE BANK'S KEY IS CONFINED TO THE INSTRUCTION IT SIGNS FOR** ... `programs/cbob-vaults/src/lib.rs` walks every top-level instruction and refuses `BankKeyOutsidePair`... | every mint, every redemption | **ON-CHAIN.**"

And the Rust source (unchanged, provided in this exact bundle) confirms it directly:
```rust
// JOB 2 — no break, no early exit: every instruction is checked
if !is_open && !is_burn {
    require!(!ix.accounts.iter().any(|a| a.pubkey == bank), VaultError::BankKeyOutsidePair);
}
```
The loop starts at `i = 0` and never breaks early; it is not bounded to "as far as the matching burn." A consequence follows that limit 1a also gets wrong: it says "*Costs:* the round-15 theft is mitigated, not eliminated," implying the protection depends on which tool produced the signature. But the transaction is refused **by the program itself**, unconditionally, regardless of which tool assembled or signed it — test `4.7` confirms this rejects with `BankKeyOutsidePair` specifically. The round-15 theft (a `SystemProgram.transfer(from=Bank)` bolted onto a legitimate redemption) is therefore **eliminated on-chain**, not merely mitigated by `bank/cosign.mjs`'s policy.

What remains genuinely off-chain-only (and where limit 1a's *other* half is still correct) is the **program allowlist** — nothing on-chain stops an extra instruction to some arbitrary program that never mentions the Bank's pubkey. That part of 1a should stay. The Bank-pubkey-confinement half should not.

**Fix:** split limit 1a into two entries — keep the allowlist-is-off-chain limit, and either delete the confinement half or replace it with the accurate, narrower residual gap that *does* survive round 17 (arm 3's "Bank may still be `payer` inside the approved pair itself," which is separately and correctly listed as limit 3).

---

## R7 — counts and arithmetic, independently

- `run-tests.sh` floors as read from the file: `DECK_FLOOR=17`, `DET_FLOOR=439`, `ALLOC_FLOOR=103`, `MAINNET_FLOOR=19`, `MIN_ASSERTIONS=316`. These match SPEC's "Running the tests" prose exactly.
- Census 108/60/36/24/12 → 108·2+60·3+36·4+24·5+12·6 = 216+180+144+120+72 = **732**. Correct.
- Census 945/525/315/210/105 → 945·2+525·3+315·4+210·5+105·6 = 1890+1575+1260+1050+630 = **6,405**. Correct.
- Per-$1,000: at 732, weight-6 → 1000·6/732 = 8.1967 → 8.20 ✓; at 6,405, weight-2 → 1000·2/6405 = 0.3123 → 0.31 ✓ (spot-checked all ten, all correct).
- Shares at 2,100: I 29.5089→29.5, II 24.5900→24.6, III 19.6721→19.7, IV 16.3934→16.4, V 9.8360→9.8. Sum = **100.0%** exactly. Correct.
- Dust bound: `dust(6404) = 2,099` (attained at `available = denominator - 1`), matching the corrected SPEC figure (not the superseded 6,404). Recomputed independently, correct.

No arithmetic error found anywhere I could check. I also re-flag here (cross-referencing R5/R8) the two concrete count discrepancies I *did* find: the stale "(69 assertions)" in the Bank-alarm-pipeline prose, and `deck.mjs`'s own internal `FLOOR=16` vs the true count of 17 / `run-tests.sh`'s `DECK_FLOOR=17`.

---

## R8 — one-of-N-sites

Beyond the deck-floor gap already covered in R1-4/R5 (this round's own new instance of the pattern), I did not find an additional distinct one-of-N-sites defect specific to the levels work that isn't already covered above — the reserved-key check, the duplicate-key check, and the confinement walk each exist in exactly one place because there is exactly one place attributes are ever written (`mint_vault`), so there is no sibling site to have missed.

---

## The four questions about the accepted limits

1. **Is any limit worse than stated?** Yes — **item 22** (open and blocking). It is framed as "cost, rate limits, paging behaviour and failure modes are untested end to end." Per R3, the code as written has a specific, identifiable failure mode (no retry/backoff around a ~4,200-call sequential loop feeding an all-or-nothing refusal) that makes routine distribution refusal likely, not merely "unknown." I'd tighten the item's own acceptance criterion to require retry/backoff and batching before the live run that's supposed to close it.

2. **Is anything listed as an accepted limit not actually a limit?** Yes — **1a**, per R6 above: the "Bank-pubkey confinement is off-chain" half is false as of round 17 and contradicts SPEC's own control table and the Rust source in this exact bundle. The round-15 theft it describes as "mitigated, not eliminated" is eliminated on-chain.

3. **Is any discharged item not actually discharged?** I checked **19** (unlevelled-vault halt) specifically for a customer-triggerable path and could not find one — it holds up on the customer-action axis. I have no basis to dispute the **12/17** compute-unit measurement (it's an artifact-level measurement I cannot independently re-run from this bundle, and nothing here contradicts it), so I'm not filing a finding against it, only noting I could not verify it further than trusting the stated methodology.

4. **Is anything open-and-blocking being quietly treated as accepted?** I found no evidence of that in the given text — both 22 and 23 remain clearly labeled throughout. I'd add, as new candidates for this list, the two structural deck findings above (R1-2 census/cap mismatch, R1-3 insider-timing) — they are not currently listed anywhere as limits, accepted or blocking, and they should be, at minimum as OPEN AND BLOCKING, before this ships.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Two of my findings this round (R1-2, R1-3) are the kind of thing nineteen prior AI rounds did not catch, and I think that's not an accident of attention — it's a structural blind spot. Concretely, this project should do the following, which a reasoning-only round cannot substitute for:

1. **Commission an actual mechanism-design/cryptography review of the deck**, separate from code review. R1-1 and R1-3 aren't bugs in the sense of "wrong Rust" — they're properties of the *scheme* (a fixed permutation revealed piecemeal to a public counter, built by a party who necessarily knows the whole thing). That's a known-hard problem class (verifiable fair-random assignment under an informed insider) with existing literature and known fixes (VRFs, delayed/blinded index derivation); a code-reading process will keep re-deriving the same insight or missing it, but won't design the replacement. Get someone who does this for a living to either bless the current design as an acceptable business risk (with the exposure written down explicitly and priced) or specify the fix.

2. **Run an actual multi-day soak test on a persistent devnet fork at production scale (~2,100 vaults) before anyone is paid.** Item 22 says this is required; I'd go further and say it must be run long enough, and against the actual RPC provider that will be used, to surface the R3 failure mode (transient errors during a long sequential scan) empirically — not simulated, not reasoned about, actually run over real wall-clock time with real rate limits. No AI round can wait 20 hours or observe a rate limiter's real behavior; only running it can.

3. **Get an adversarial, financially-incentivized red team** (a bug bounty with a real payout, run before mainnet, not another AI round) specifically targeting the deck and the mint-confinement logic. Nineteen AI rounds sharing a training distribution and a code-reading methodology are correlated in what they miss; a red team paid to find exactly this class of "the operator can win without touching a check" issue is a different search process, and is the only kind of check that can plausibly catch what the *next* structural insider-knowledge gap looks like, once this one is fixed.