# Audit: CBOB ceremony comparison follow-up (N-1 to N-4) and the October 12 rulings record

**Commit:** `/opt/cbob-vaults` is on `refs/heads/v6` at `2d55ca563aa0f882af82b5a4e7860b4d16699293`. It is the only commit after `60d670e6` (reflog line 296: "Record owner rulings and require independent ceremony step checks").

**What I read:**
- `scripts/ceremony-compare.mjs`, `scripts/ceremony-compare.test.mjs` (the scope calls it `compare.test.mjs`) and `scripts/verify-ceremony.mjs`
- `audits/rulings-2026-10-11/COUNTER-CLOSURE-REVIEW.md` and `launch/RULINGS-2026-10-12.md`
- For the N-2 and N-4 checks: `readStep` and `stepVerdict` in `web/src/lib/ceremony-reads.mjs`, the `expect*` functions and `STEPS` in `plan-ceremony.mjs`, `PROGRAM_IDS` and `STRUCTS` in `bank/layout.mjs`, and `account` / `anchorAccount` in `reads.mjs`
- For the HTML check: the voting text in `web/src/html/governance.html` and the vote path in `club-engine.mjs:60-115`

**Limits:**
- I used only Read, Glob and Grep, and ran nothing.
- I could not see the list of files the commit changed or confirm the working tree is clean.
- **`ruled-preparation-committed.log` does not exist** in `/opt/cbob-vaults`, and no Glob under `/opt` found it. So no test result is verified by this review, and N-5 (tying the test log to a commit) is still open.

---

## Verdict

- **N-1 is closed.** One labelling weakness remains (F-3).
- **N-2 is closed.** Two LOW gaps remain (F-1, F-2).
- **N-3 is only partly closed** (F-4).
- **N-4 is closed.**
- **Source checkpoint:** no code blocker. Every finding below fails closed. Before the checkpoint is recorded, the test log must be produced and tied to `2d55ca56` with a clean tree. Until then the checkpoint rests on code reading alone.
- **Not approved:** the artifact, pins, publication and signing.
- **The rulings record has one MEDIUM issue (D-1):** it treats an interpretation of the owner's answer as settled, and that interpretation decides how far the server may sign votes.

---

## Closure check

**N-1 (reads at different slots): closed.**
- `compareSetupSnapshots` (`ceremony-compare.mjs:52-56`) sorts each comparison into three outcomes: `agreement`, `disagreement` (a mismatch at the same slot) or `unstable` (a mismatch at different slots).
- `verify-ceremony.mjs:91-97` retries at most 3 times, and only on `unstable`. Every attempt is recorded in `result.setup_observations` with both slots.
- `:98` uses a separate refusal message for `unstable` and includes the slots.
- No comparison was relaxed. Test 69-74 covers all three outcomes.

**N-2 (both providers judged on their own): closed.**
- `:101` runs `readStep` against each provider separately. `:102` with `ceremony-compare.mjs:60-64` requires exactly two verdicts, each in the allowed set.
- The expectations include every activity counter at its starting value. That covers all MintConfig counters, with `last_distribute_at = charterClosesAt` (`plan-ceremony.mjs:170-185`), plus `burned_total`, `rate_head` and `rate_ring` (`:189-190`) and every GovConfig `last_*` id and `proposal_count` (`:194-195`). `expectMint` lists every field in the layout.
- Funding is judged per provider from REVENUE lamports against each provider's own rent figure (`ceremony-reads.mjs:68-73`). After signing it must be `done` on both (tests 88-92).
- Spreading `{...ctx, conn: second}` keeps the second read's writes to `existing`, `rent0` and `shortfall` off the shared `ctx`, so the two concurrent reads do not interfere.

**N-3 (tests for pinned fields): partly closed.** See F-4.

**N-4 (program IDs): closed.** `verify-ceremony.mjs:85` checks that every `PROGRAM_IDS` entry (seal, mint, burn, gov, sweep) equals `p.programs[name]` before masking is used. The check is one-way, which is enough here: masking only reads `PROGRAM_IDS`.

---

## Findings

### F-1. LOW: the per-provider step checks read at `confirmed`, not `finalized`, and are not tied to the snapshot slot
**Where:** `verify-ceremony.mjs:101`, `reads.mjs:33`, `anchorAccount` at `reads.mjs:67`

**Problem:**
- `readStep` reads through `account()`, which is fixed at `'confirmed'` and passes no `minContextSlot`.
- After masking, N-2 makes these reads the only check of the counters and of REVENUE funding. So the `--after` evidence for those values is confirmed-commitment, at a slot that is not recorded.
- That evidence comes from a different moment than the finalized snapshot it sits beside.
- It fails closed when a provider lags. The risk is evidence quality, not acceptance of bad state.

**Fix:**
- Add an optional `ctx.commitment` and `ctx.minContextSlot` to `account` and `anchorAccount`. Leave the browser default as is.
- In `verify-ceremony`, pass `finalized` and the slot of the last agreeing snapshot.
- Record the slot each step read used in `result`.

### F-2. LOW: before signing, the two providers may disagree on whether a step has run
**Where:** `ceremony-compare.mjs:62`

**Problem:**
- With a collection present, `--preflight` allows `['next','done']` for each provider separately. So provider A reporting `done` while B reports `next` (`null`) passes.
- For the config accounts the snapshot comparison catches this in practice, because whether an account exists changes its hash.
- For `fund` it does not. REVENUE lamports are left out of the snapshot hash (`ceremony-compare.mjs:39`), so a funding split between the providers passes preflight.

**Fix:** in preflight, also require `verdicts[0] === verdicts[1]`. Re-read once on a mismatch, and refuse with a "provider step disagreement" label.

### F-3. LOW: a real disagreement that persists across slots is labelled "unstable; retry verification"
**Where:** `verify-ceremony.mjs:91-98`

**Problem:**
- Two separate providers rarely land on the same finalized slot, so almost every mismatch is classed `unstable`.
- A lying or misconfigured second provider therefore produces `unstable` three times. The operator is told to retry, and does so indefinitely, when the real cause is a disagreement.
- `setup_observations` records slots but not which accounts differed, so the run gives no way to tell the two cases apart.

**Fix:**
- Record the indices that differ in each attempt.
- If the same indices differ in all attempts, report "persistent cross-slot disagreement", not "unstable".
- Optionally, on `unstable`, re-read provider A with `minContextSlot` set to B's slot. A match then is real agreement at closer slots.

### F-4. INFO: N-3 used a hand-written field list, not the complement loop the review asked for
**Where:** `ceremony-compare.test.mjs:60`

**Problem:**
- The list covers the fields the review named, but about 30 pinned MintConfig fields still have no "a change must fail" test.
- They are: `pool_ata`, `round_id`, `opens_at`, `closes_at`, `price`, `cap`, `max_supply`, `sales_stopped`, `sweep_stopped`, `sales_stopped_at`, `sweep_stopped_at`, `sol_reserve_lamports`, `max_sweep_lamports`, `sweep_cooldown_secs`, `cooldown_ceiling_secs`, `reserve_ceiling_lamports`, `sweep_floor_lamports`, `notice_secs`, `monthly_secs`, `level_caps`, `payment_mint`, `pob_collection`, `pob_root`, `cbob_mint`, `max_boost_*`, `boost_price`, `boost_weight`, `boost_epochs` and `bump`. BurnConfig and GovConfig `bump` are also untested.
- These include exactly the fields (`round_id`, `opens_at`, `closes_at`, `price`, `cap`, `sales_stopped*`) that someone would be tempted to mask to quiet N-1.
- **What limits the risk:** F-2 aside, N-2's complete `expect*` checks would still catch a wrongly masked field, on each provider separately.
- **Where the risk is real:** the snapshot is the only finalized, same-moment cross-check, and its pinning is still not fully tested.

**Fix:** for each struct, loop over `STRUCTS[kind].fields` minus `activityFields[kind]` (and minus `version`, which is tested by the throw) and assert that flipping one byte fails. This needs `activityFields` exported or mirrored in the test.

### F-5. INFO: the retry loop and the N-4 check have no tests
**Where:** `verify-ceremony.mjs:85` and `:91-98`

**Problem:**
- Both sit in top-level script code, so no test checks that there are at most 3 attempts, that the loop stops on `disagreement`, or which message is used.
- The attempts also run back to back with no pause, so a slow public RPC makes all three attempts likely to land on different slots.

**Fix:** move the loop into `ceremony-compare.mjs` as a function that takes a read callback, and test it. Add a short pause between attempts.

### F-6. INFO: `--after` only passes before any public activity, and fails afterwards with a misleading label
**Where:** `ceremony-compare.mjs:58-63` with `plan-ceremony.mjs:170-195`

**Problem:**
- Starting counter values are now required on both providers. After the first charter claim, proposal or distribution, `--after` returns `broken` for good.
- `stepVerdict` describes `broken` as "an account that can never be rewritten holds the wrong values", which points the operator at the wrong cause.
- This is fine if `--after` always runs between signing (October 15) and charter opening (October 19 target), but nothing records that limit.

**Fix:** state the window in `PRELOCK-R1.md` and in the script's usage text. Optionally, refuse with a "post-activity, use the lock read-backs" label when `chainNow` is at or after `charter_opens_at`.

---

## `launch/RULINGS-2026-10-12.md`

I cannot compare the quoted answers with the Codex conversation, which I don't have. They are internally consistent and keep the owner's typo ("ike"), which suggests they were copied verbatim. The weekdays are correct: Thursday October 15, Friday October 16, Monday October 19.

### D-1. MEDIUM: the reading of answer 1 is recorded as decided, and it sets how far the server may sign votes
**Where:** lines 10 and 23-29

**Problem:**
- The owner wrote: "...and NO. Every person must vote their own vaults but they can vote ALL of their vaults or split their vote."
- The question that "NO" answers is not recorded.
- The applied text turns "split their vote" into "split their vaults between Yes and No" with one indivisible vote per vault. That is a reasonable fit with the frozen program, but the owner may have meant splitting one vault's vote, which the program cannot do.
- It also turns "every person must vote their own vaults" into "Gary Club never casts a holder's vote without that holder's explicit instruction". That reading allows the server to sign votes on instruction, and the "NO" could equally mean no voting by anyone but the holder.

**Fix:** quote question 1 verbatim, label both readings as interpretations, and get the owner's explicit confirmation before any vote-signing page ships.

### D-2. LOW: the questions are not recorded, so the mapping from answers to decisions cannot be checked
**Where:** lines 3, 21-57

**Problem:**
- Answers 1-10 are assigned to D1, D2, D6, D7, D10, D13, D8, D9, D11 and D12 with no question text.
- Several decisions carry detail that is not in the answer. D2 adds "outside the Cloudflare proxy", the fingerprint check, removing access, and "the question explicitly disclosed" that signing fixes the charter date. D6 adds that a failed trading gate does not block the holder release.
- None of this can be traced to the owner from this document.

**Fix:** add each question verbatim next to its answer.

### D-3. INFO: statements that do not come from the response and are not checked here
- **Line 4-6:** the Friday lock and Monday charter dates. These come from earlier rulings.
- **Line 43-44 (D13):** that royalty revenue is split 85% to vaults and 15% to the treasury. `checkCollectionAfterMint` only confirms that the royalty goes 100% to REVENUE at 1,000 basis points. The 85/15 split of REVENUE is a claim about the programs that I did not verify.
- **Good:** the document correctly avoids saying the Thursday appointment is booked, and correctly says that no price or proposer was supplied for D11.

---

## Governance page voting text

`governance.html:3` says: "One vault, one vote. You decide how your vaults vote. Each vault votes once, and a transfer does not reset its vote. Gary Club signs only the votes you explicitly approve."

- **It does not claim bulk or split voting exists.** That matches the engine, which only accepts one `asset` per vote request (`club-engine.mjs:62, 105-115`).
- **"A transfer does not reset its vote" is accurate.** The vote record is looked up by proposal and vault (`:112`).
- **INFO:** "Gary Club signs..." is written as if Gary Club vote signing works today. Under D6, the holder switch that enables it is off. Make sure this copy only ships with that switch on, or word it conditionally, so the page doesn't describe a capability members can't use yet.

---

## Missing verification

1. A test log tied to `2d55ca56` with a clean tree (N-5). The log named in the brief was not found.
2. Unit tests for the retry loop and the program-ID check (F-5).
3. A complement-loop test for pinned fields (F-4).
4. A live two-provider `--preflight` run, still not done.
5. Owner confirmation of the reading of answer 1 (D-1) before vote signing ships.

Everything listed as still open in `COUNTER-CLOSURE-REVIEW.md` remains open. That is V2-1 (dependency provenance), real nginx and owner-browser delivery, D6 backend integration, the artifact and pins, and F-1 to F-7. Of the owner rulings that list waits on, the new record now marks D2, D6, D10 and D13 as ruled. Turning them into working code is still unverified.
