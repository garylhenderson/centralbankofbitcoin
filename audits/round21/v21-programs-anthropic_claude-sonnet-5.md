# Audit Round 21 — Findings on 045fcc0..HEAD

Calibration note up front: two of the findings below (R1, R3) are the load-bearing ones and I've tried to separate what is *deterministic reasoning from public Solana facts* (leader schedules are public; this isn't in dispute) from what would need a live measurement to size precisely (how much grinding room a colluding leader actually gets from tx-ordering). I say which is which. Several other sections (R2, most of R4/R5/R7) come back clean — I looked hard and did not manufacture findings to fill space.

---

## R1 — The commitment scheme

**CRITICAL — "the caller does not name the slot" does not stop the party who controls timing from naming it anyway.**

`commit_seed` sets `deck_slot = current_slot + DECK_SLOT_LEAD (32)`. The comment's whole argument is "an input the Bank chooses is an input the Bank can grind," and the fix is framed as removing that input. It doesn't remove it — it moves it one level up.

- `deck_slot` is a deterministic function of the slot at which `commit_seed` *executes*. The caller (on-chain: `config.admin`, not `config.bank` — see note below) fully controls **when** to submit that transaction.
- Solana's leader schedule for an entire epoch is public and deterministic, known well before any of it happens.
- Therefore a caller who is, or colludes with, a validator can simply wait until `current_slot + 32` lands on a slot their own (or a colluding) validator leads, then submit `commit_seed`. This requires no retries and no "grinding by resubmission" (which the one-shot check does block) — it only requires *choosing the moment*, which is never restricted.
- Once `deck_slot` is a slot they lead, they have the classic Solana blockhash-grinding surface: some (bounded, not literally unlimited) control over the resulting bank hash via which pending transactions they include and in what order, before producing that slot's block. This is a known, general property of leader-controlled slots, not something specific to this program — I have not measured how many candidate orderings are practically available in ~400ms of block-production time, so I'm stating the *qualitative* power (nonzero, plannable in advance) rather than a number I haven't run.
- 32 slots (~13s) of "notice" is irrelevant to this attack — the attacker doesn't need 13 seconds of reaction time, they need the (much larger, already-known) planning horizon of the epoch's leader schedule, which they have.

**What a cheating admin/Bank must now control, precisely:** either be a validator, or have a standing arrangement with one, such that at least one of their upcoming leader slots is reachable by submitting `commit_seed` at the right moment. That is a real and much higher bar than "any 32 bytes" (the pre-round-20 state), but it directly contradicts the comment's claim that "there is nothing left to choose" and that "non-revelation is not mitigated but impossible" — the *seed* is unforgeable and public, which is true and valuable, but the *distribution of results a validator-admin can steer toward* is not eliminated, only raised in cost.

Evidence that would exist if this is right: correlate `getLeaderSchedule` for the relevant epoch against the `deck_slot` chosen by a live `commit_seed`/`commit_deck` pair; if the Bank/admin operates or contracts with a validator, the chosen slot would fall on that validator's leader slot more often than a uniform 1/(validator count) base rate would predict. That's a testable, falsifiable claim, not something I can run from here.

**Clarifying correction to the prompt's framing (LOW):** `commit_seed`/`commit_deck` are gated on `has_one = admin`, not on `config.bank`. The narrative in `bank/deck.mjs`'s header and in the R1 prompt calls this party "the Bank," but on-chain it is whoever holds `config.admin` (initially the Squads multisig per fact 8). This *raises* the practical bar for the R1 attack from "one hot key" to "a quorum of Squads signers," which is worth stating plainly rather than leaving it implicit, because it changes who has to be compromised.

**MEDIUM — the scheme's unforgeability rests on immutable bytecode, and the bytecode isn't immutable.** `commit_seed`/`commit_deck`'s one-shot guarantee is only as strong as the deployed program. Since all four programs are upgradeable (Squads multisig authority, per SPEC and fact 8), a quorum of Squads signers could ship an upgrade that adds an instruction resetting `deck_salt_hash`/`deck_root`/`deck_slot` directly, after seeing an unfavourable draw, before minting opens. This is not new in kind — SPEC's "Known limits" already flags upgrade authority generally — but it is a new instance worth naming specifically here, because the new comment's language ("non-revelation is not mitigated but impossible") reads as a stronger guarantee than "impossible assuming the currently-deployed bytecode is what stays deployed."

**LOW — missing-window failure mode is more severe than the accepted-limits framing suggests, and it's not written down anywhere as a named risk.** If `commit_deck` fails to land within 512 slots (~3.4 min) of `deck_slot` for any reason (RPC hiccup, congestion, a typo in the salt causing repeated `BadSalt` retries that burn the window), the *entire program* can never mint a single vault, permanently, with no on-chain recovery path (no reseed instruction, and `MintConfig` uses `init` with no `close`). This is stated in the code comments as deliberate, but it is not listed anywhere in SPEC's ACCEPTED LIMITS or OPEN AND BLOCKING sections as an operational risk with a ~3-minute blast radius. I'd suggest at minimum a written runbook step ("commit_seed and commit_deck must be submitted back-to-back by a script, not by two separate manual actions") — not a code fix, a documentation gap.

---

## R2 — `blockhash_of_slot`

**No finding — this is correctly implemented, and I want to say that plainly rather than invent a defect.**

- Layout: `u64 count` (LE) then `count × (u64 slot LE, [u8;32] hash)`, stride 40 — this is exactly bincode's serialization of `Vec<(Slot, Hash)>`, which is what `SlotHashes` actually is. Verified by hand against the account layout other parts of this codebase already rely on (nothing contradicts it).
- Every bound is checked before use: `data.len() >= 8`, `n <= 512`, `data.len() >= 8 + n*40` before any indexed read — no out-of-bounds slice access is reachable.
- Zero-hash refusal is defensive (a real zero hash has probability ~2⁻²⁵⁶) and correctly gates the *found* branch, not the miss branch.
- Miss (slot aged out or not yet produced) correctly returns `Err(DeckSlotUnavailable)` — fails closed.
- "A slot present twice" cannot happen here in a way that matters: the account is pinned by key to the real sysvar (`slot_hashes::ID`), which is runtime-maintained and cannot contain attacker-controlled duplicate entries; the code takes the first match, which is a non-issue against a trusted account.
- The stated 512-slot (~3.4 min) bound is exactly what the code enforces (`SLOT_HASHES_MAX = 512`, matching the real sysvar's `MAX_ENTRIES`).

**LOW — one diagnosability gap, not a security bug.** `DeckSlotUnavailable` fires identically whether `commit_deck` is called *too early* (before `deck_slot` has even happened, so it isn't in `SlotHashes` yet) or *too late* (aged out past 512 slots). The error message ("the entropy slot has aged out") is misleading in the first case. Worth a distinct error code or a check against `Clock::get()?.slot < want` for a clearer message; not worth more than LOW since it doesn't change the security property.

---

## R3 — The tombstone halt (`bank/distribute.mjs`) — CRITICAL, and untestable as shipped

**The `!raw` branch of the tombstone test is wrong, and it is wrong in both the new code and the pre-existing code it was modeled on.**

```js
tomb = !raw || raw.data.length < 1 || raw.data[0] !== 1
```

Per this project's own measured fact 9: *"a burned asset's address is NOT re-mintable: the account survives, still Core-owned, at Key::Uninitialized."* A genuinely burned vault is **not absent**. It is a live account, still allocated, with `data[0] == 0` (Uninitialized). `!raw` (a fully-null `getAccountInfo` result) is therefore never what a real burn looks like — it's what a transient RPC inconsistency, a load-balanced-endpoint staleness, or some other anomaly looks like. The code's own stated intent ("Anything else — an RPC error, a malformed asset, a genuine disagreement between chain and code — still halts") is exactly what should apply here, but doesn't: a *successful* `getAccountInfo` call that returns `null` does not throw, so it never reaches the `catch { tomb = false }` fail-closed branch. It sails straight through as `tomb = true`, and the vault is silently excluded from that day's payment with **no ledger entry, no detector, no alarm** — `burnedSinceIndex` is only `console.log`'d, never persisted to `st.days[day]`.

Compare this to Accepted Limit 20 (poisoned ATA): that path is worse-behaved in one dimension (it's a targeted, cheap griefing vector) but *is* logged (`unreadableAtas`) and *is* caught by `detectDistribution`'s `distribution_vault_unreadable` at HIGH within 30 minutes. This new path has neither.

**This directly falsifies Accepted Limit 19's discharge.** The discharge text says: *"`allocateWeighted` refuses the entire distribution when any activated vault has no readable level... It can mis-assign a level at mint; it cannot omit a holder without halting everyone. The halt IS the control that makes the register honest."* The `burnedSinceIndex` bucket is a third path that bypasses `allocateWeighted` entirely (the vault never gets a `balances[v]` entry, so it never enters the halt-or-pay-everyone decision at all) — it is a way to omit a holder *without* halting everyone, exactly the thing the discharge claims is now closed. See "accepted limits" section below, this is a direct answer to question 3.

**Same bug, second site, in the code this diff explicitly cites as the model.** The payment loop's `burnedMidRun` check, quoted in this diff's own comment as "the payment loop already knew better," has the identical shape:
```js
if (!stillThere || stillThere.data.length < 1 || stillThere.data[0] !== 1) { ... skipped: '...' }
```
`!stillThere` is treated as "no longer a live Core asset" here too, and once written, `paymentState`'s `done[v]?.skipped` check means that vault is **never retried, ever, for that day** (and since there's no persisted distinction between "genuinely burned" and "RPC returned null," an operator reading the ledger the next morning has no way to tell). This is exactly the R8 "one-of-N-sites" shape the round is fishing for: the new fix didn't avoid the defect, it *copied* it into a second location while leaving the original uncorrected.

**This is completely untested.** I checked: neither `bank/selftest.mjs` (69→439 assertions, unchanged by this diff) nor `bank/distribute.mjs --selftest` (103 assertions, unchanged by this diff) contains a single assertion touching this classification logic, because it's inline in `main()` using live `conn.getAccountInfo` calls rather than extracted into a pure function. Every one of the four assertion floors this round certifies (330/439/103/19) can pass while this bug ships. This is the concrete, checkable form of Accepted Limit 22's warning ("nothing has ever run a distribution against a live chain... failure modes are untested end to end") — this round's diff is a specific instance of exactly that warning materializing.

*Fix sketch:* extract `classifyAccountAtRedemptionTime(rawOrNull)` as a pure function so it's unit-testable; treat `!raw` as its own case (persist it, and route it to the halt path, not the silent-skip path) rather than folding it into "tombstone." At minimum, persist whatever bucket a vault lands in (`burnedSinceIndex`, `burnedMidRun`) to the ledger the same way `poisoned`/`unreadableAtas` already are, so `detectDistribution` (or a new detector) has something to alarm on.

**Third route to the halt, distinct from Phase 1's and round 20's:** a Metaplex Core / Umi SDK schema mismatch. If Core ships a plugin or account-layout change that a not-yet-updated `@metaplex-foundation/mpl-core` `fetchAsset` can't parse, that throws for a *live, unburned* vault. The tombstone check would then correctly find `data[0] === 1` (still a live AssetV1) → `tomb = false` → the vault correctly lands in `unreadableLevels` → the whole distribution halts (correctly, per design) — but for every vault, on every run, until the SDK is patched. Given SPEC's own admission that "METAPLEX CORE IS THE FIFTH PROGRAM AND WE DO NOT CONTROL IT," this is a real, named third route, distinct from the mint-time-unlevelled route (closed) and the mid-run-burn route (this diff's target).

---

## R4 — The two known defects, and "what else is of that shape"

**The one-shot-reorder fix is correct.** I traced `commit_deck`'s check order by hand: `DeckAlreadyCommitted` fires first regardless of clock state, before any dependency on `deck_slot`/SlotHashes freshness, so a re-deal attempt after the window has aged out now correctly reports the one-shot violation rather than a stale-blockhash error. No later check establishes state an earlier one depends on.

**The probe-ceiling fix (11.11, PROBE_CEILING=64) is correctly de-vacuated.** I checked the arithmetic: at the suite's actual depth (~7, 90-card deck), the packet bound should land near 29 (matching the separately-measured accepted-limits table), well under 64, so the assertion `maxAttrs < PROBE_CEILING` is capable of failing if the packet ever stopped binding before 64 — it is not "true by construction" the way the old `n<=7` loop was.

**What else is of that shape: the R3 finding above is exactly this shape, and it's the one that matters.** I did not find a third instance of "an assertion that cannot fail" in this diff beyond the two already self-reported. I looked specifically at `11.11a/b/c` (real headroom before `PROBE_CEILING`, not vacuous), `2.0g`/`2.0h` (real cross-checks, discussed under R5), and the byte-offset math (verified below under R7/R5) — none of those are vacuous.

---

## R5 — The suite's new arms

**Rejections are correctly attributed.** I traced all five REJECT arms in section 2.0 (`2.0a`, `2.0c`, `2.0d`, `2.0f`, `2.0i`) against the actual on-chain check order and confirmed each fires for the reason its `because()` names, not for an earlier guard. `because()` covers all five, not "four of five" — I looked hard for a sixth unattributed rejection and didn't find one; if the prompt intended a specific missing pair, I couldn't locate it, and I'd rather say that than invent one.

**MEDIUM — 2.0h is a real cross-implementation check, but with a specific, nameable blind spot.** It compares the seed the program stored against `bank/deck.mjs`'s independent derivation. This *is* meaningful (it's not `x === x`; it's two independently-fetched SlotHashes reads compared to two independent derivations). But both sides hard-code the *same* layout assumption (`u64 count` + stride-40 `(slot, hash)` pairs) when parsing `SlotHashes`. If that shared assumption were wrong, both implementations would compute the same offsets and, given identical inputs, derive the same (wrong) seed — the test would still pass. Since I independently verified the layout is actually correct (matches bincode `Vec<(u64,[u8;32])>`, R2 above), this isn't live today, but the test's *power* to catch a shared-assumption error is genuinely zero, and that's worth stating rather than leaving implied.

**Offsets 593 (`deck_slot`) and 601 (`deck_seed`) are correct.** I hand-computed `MintConfig`'s byte layout field-by-field from the `#[account]` struct (8-byte disc + fields in declared order): `version`(1)@8, `admin`(32)@9, `collection`(32)@41, `bank`(32)@73, `governance`(32)@105, `treasury`(32)@137, `round_id`(4)@169, `opens_at`(8)@173, `closes_at`(8)@181, `price_lamports`(8)@189, `cap`(4)@197, `minted_this_round`(4)@201, `minted_total`(8)@205, `max_supply`(8)@213, `bank_treasury`(32)@221, `split_bps`(2)@253, `paused`(1)@255, `swap_operator`(32)@256, `sol_reserve_lamports`(8)@288, `bump`(1)@296, `max_sweep_lamports`(8)@297, `sweep_cooldown_secs`(8)@305, `last_sweep_at`(8)@313, `pending_governance`(32)@321, `pending_governance_at`(8)@353, `governance_timelock_secs`(8)@361, `pending_admin`(32)@369, `pending_admin_at`(8)@401, `pending_bank`(32)@409, `pending_bank_at`(8)@441, `pending_operator`(32)@449, `pending_operator_at`(8)@481, `level_caps`(20)@489, `level_minted`(20)@509, `deck_root`(32)@529, `deck_salt_hash`(32)@561, **`deck_slot`(8)@593**, **`deck_seed`(32)@601**. This matches every other hardcoded offset already in the suite (e.g. `minted_total`@205, `governance`@105, `pending_governance`@321, `pending_admin`@369, `swap_operator`@256, `pending_operator`@449 — all independently cross-checked and consistent), and it matches the `CONFIG_PADDING` arithmetic (256→184→112, a net −72 each time three 32/8/32-byte fields moved from padding into real storage, holding total account size constant). No bug here.

---

## R6 — The accepted-limits rewrites

**Limit 1a's rewrite is accurate** — I verified `open_for_redemption`'s `BankKeyOutsidePair` and `mint_vault`'s `BankKeyOutsideMint` checks both exist and match the description.

**Limit 23's rewrite is accurate, but it wasn't propagated — HIGH, and this is a clean R8 instance.** SPEC.md's own "Known limits, stated rather than papered over" section (a *different* section from ACCEPTED LIMITS, above it in the document) still reads:

> *"Measured at depth 7: seven caller attributes fit, the eighth does not serialize. A deeper deck leaves less room for provenance. Decide the deck size before minting opens."*

This is the exact debunked claim the corrected ACCEPTED LIMITS item 23 spends four paragraphs refuting ("the eighth is refused by the PROGRAM... not by the packet," and measured: at production depth 11 the packet holds **18** while the program permits only **7** — the program binds, not the packet). The fix landed in one of two places describing the same fact and left the other internally contradicting it, in the same document, one section apart.

**Also stale, same section: the "salt revealed at close" description.** The same "Known limits" section's table still says:

> *"seed = sha256(bank_salt ‖ blockhash(slot X))`, `sha256(bank_salt)` published first, salt revealed at close"*

This describes the scheme that "nothing implemented" before round 20 — the Bank *naming* a future slot X, and revealing the salt *at close*. Under the actual `commit_seed`/`commit_deck` mechanism, the program (not the Bank) fixes the slot, and the salt is revealed immediately in `commit_deck` (near the start of minting), never "at close." This table row was never updated when the real mechanism landed.

**Answering the four accepted-limits questions directly:**

1. **Worse than stated?** Yes — Limit 19 (see next point) and, arguably, the deck commitment scheme's residual grinding surface (R1) is worse than the "nothing left to choose" framing in `bank/deck.mjs`'s header suggests, though that header is a design comment rather than a formally accepted limit.
2. **Anything listed that's already closed?** I did not find one; nothing in this diff closes an ACCEPTED item.
3. **Any DISCHARGED item not actually discharged? Yes — Limit 19.** The discharge's central claim ("cannot omit a holder without halting everyone") is falsified by the `!raw`-as-tombstone bug in R3: a holder *can* be omitted without halting, via the new `burnedSinceIndex` path, with zero logging. This needs to be either re-opened or the discharge text corrected to acknowledge the new bypass.
4. **Anything OPEN AND BLOCKING quietly treated as accepted?** No — but Limit 22 deserves to be read as *more* urgent given R3: it now has a concrete, named bug (not just an abstract "untested at scale" risk) sitting in the exact code path it warns about.

---

## R7 — Counts and arithmetic

**All verified correct; no drift found.**

- `MIN_ASSERTIONS`: 316→330 in `scripts/run-tests.sh`. I hand-counted every new `rec()`/`because()` call added in the `tests/3prog.test.ts` diff hunks: 7 new `rec()` in section 2.0 (`2.0c,d,e,f,g,i,h`) + 4 new `because()` (`2.0c,d,f,i`) + 3 new `rec()` (`11.11a,b,c`) = **14**, and 330−316 = **14**. Exact match.
- `DET_FLOOR=439`, `ALLOC_FLOOR=103`, `MAINNET_FLOOR=19`, `DECK_FLOOR=17` — all unchanged by this diff (confirmed: `bank/selftest.mjs`, `bank/distribute.mjs`'s `--selftest` block, and `scripts/probe-mainnet-facts.mjs` are not touched by 045fcc0..HEAD), consistent with the prompt's introductory numbers.
- Census 240: 108·2+60·3+36·4+24·5+12·6 = 216+180+144+120+72 = **732** ✓.
- Census 2,100: 945·2+525·3+315·4+210·5+105·6 = 1890+1575+1260+1050+630 = **6,405** ✓.
- Per-$1,000 at 732: [2.73, 4.10, 5.46, 6.83, 8.20] — all reproduce exactly.
- Per-$1,000 at 6,405: [0.31, 0.47, 0.62, 0.78, 0.94] — all reproduce exactly.
- Shares at 2,100/6,405: [29.5, 24.6, 19.7, 16.4, 9.8], summing to **100.0** exactly.

No arithmetic finding here.

---

## R8 — One-of-N-sites

Two clean instances found, both already detailed above; cross-referencing rather than repeating:

1. **`!raw`-as-tombstone** exists identically in the new level-read loop *and* the pre-existing payment loop it's explicitly modeled on (R3). The "fix" cites the second site as the correct model while that model shares the exact defect.
2. **Stale deck-scheme prose** in SPEC.md's "Known limits" section duplicates two claims that were corrected only in the ACCEPTED LIMITS section: the depth-7/eighth-attribute claim, and the "salt revealed at close" mechanism description (R6).

I looked for a third instance across the Rust diff specifically (checking whether any other instruction has a similarly-shaped ordering bug, or whether any other raw byte-offset reader lacks `blockhash_of_slot`'s defensive bounds) and didn't find one — `mint_vault`'s check ordering and the SEAL/BURN introspection loops are unaffected by this diff and were already reviewed in prior rounds.

---

## Anything else

- **Minor, R2-adjacent:** `blockhash_of_slot`'s single error code (`DeckSlotUnavailable`) can't distinguish "too early" (target slot hasn't happened yet) from "too late" (aged out past 512 slots). Pure diagnosability, LOW.
- **Not flagged as a finding, but worth a sentence:** `scripts/audit21.ts` (the meta-tooling that generated this very round) looks internally consistent on inspection (roster verification, undelivered-target refusal, floor-reading-not-typing) — I did not find a defect in it worth the space, and given it doesn't touch money or custody, I deprioritized deeper review of it relative to the program/bank code.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Three concrete things this project's structure has not yet done, distinct from what THE SHIP GATE already commits to (coverage / freeze / two clean rounds / gated findings):

1. **Make "this is exactly like site X" a build-time claim, not a comment.** The R3 finding exists because a comment said "exactly as the payment loop already does" and nobody — human or AI — checked whether the payment loop's own logic was actually correct before citing it as the standard to copy. Whenever new code is written with a comment of that shape, require (mechanically, via a lint or a paired-assertion convention) that the two sites share a *single* extracted, unit-tested function, so "copy this pattern" cannot silently copy a latent bug. This is the single most repeated defect class in nineteen rounds, and citing a sibling site by comment, rather than by shared code, is exactly how it keeps recurring.
2. **Extract every money-deciding branch that currently lives inside an I/O function into a pure function, as a policy enforced by grep, not by memory.** `bank/distribute.mjs`'s tombstone classification is exactly the kind of logic that decides who gets paid, and it is unreachable by any of the 439+103 off-chain assertions specifically *because* it's inline in `main()` next to `conn.getAccountInfo` calls. A one-line CI check ("any function containing both a `conn.` call and an `if` that touches `balances`/`levels`/`done` fails the build unless it delegates the branching to something imported and covered by `--selftest`") would have caught this before a human or an AI had to read 900 lines to find it.
3. **Get one specific piece of expertise this process cannot substitute for: an actual Solana validator operator's opinion on the grinding surface of `commit_seed`/`commit_deck`.** I can reason from public facts (leader schedules are known in advance) to a qualitative conclusion (a validator-admin can align `deck_slot` with their own leadership), but I cannot bound how many candidate blockhashes a leader can realistically produce for one slot under real network conditions, and neither can any other LLM reading source code — that number comes from operating a validator, not from reading Rust. This is the one place in this round where the honest answer is "the code review is done; the remaining question needs a different kind of evidence than a text audit produces," and it should be sourced as such rather than estimated.