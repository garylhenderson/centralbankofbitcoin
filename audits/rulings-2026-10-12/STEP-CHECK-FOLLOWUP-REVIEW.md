# Audit: CBOB ceremony step-check follow-up (F-1 to F-6)

**Scope:** I read these files in full:
- `scripts/ceremony-compare.mjs`, `scripts/ceremony-compare.test.mjs`, `scripts/verify-ceremony.mjs` and `launch/PRELOCK-R1.md`
- The F-1 to F-6 findings in `audits/rulings-2026-10-12/STEP-CHECK-REVIEW.md`
- The dependencies: `readStep` and `stepVerdict` (`web/src/lib/ceremony-reads.mjs`), `account`, `anchorAccount` and `chainNow` (`web/src/lib/reads.mjs`), `readConnection` and `readFetch` (`bank/live-programs.mjs`), `offsets`, `fixedLength` and `decode` (`bank/layout.mjs`), the `expect*` functions (`plan-ceremony.mjs:163-196`), and `sweep_sol_for_swap` (`programs/cbob-vault-mint/src/lib.rs:1055-1078`, read only)

I only read files and ran nothing. D1 and D2 are not revisited.

## Verdict

- **No blocker in the assigned scope.** Every remaining issue fails closed.
- **Closed:** F-1, F-2, F-3 and F-5.
- **F-4 is closed for today's list, but not for the risk it was raised for** (G-1).
- **F-6 is closed for public activity after charter opening.** Our own operators can still act earlier and trigger the old misleading label (G-2).
- **"22/22 passed" has no evidence on disk** (see Missing verification).

## Closure check

**F-1 (step reads at `confirmed`, not tied to the snapshot): closed.**
- `finalizedStepConnection` (`ceremony-compare.mjs:84-99`) ignores the `'confirmed'` argument that `account()` passes (`reads.mjs:33`). It reads at `finalized` with `minContextSlot`, refuses a response whose slot is missing or older than the snapshot, and records the address and slot of each read.
- `readStep` only calls `getAccountInfo` and `getMinimumBalanceForRentExemption` (`ceremony-reads.mjs:33-75`). So no step read can get around the adapter; any other call would throw, which fails closed.
- `minSlot` is the larger of the two agreeing snapshot slots (`verify-ceremony.mjs:97`).
- `readFetch` retries error `-32016` (minimum slot not yet reached) and keeps `minContextSlot` (`live-programs.mjs:23-27`). So normal provider lag does not cause a spurious refusal.
- The browser path is unchanged: `account()` still reads at `'confirmed'`.

**F-2 (providers may disagree before signing): closed.**
- `independentStepVerdicts` (`:103-108`) now requires `verdicts[0]===verdicts[1]` in both modes.
- `checkStepsWithRetry` (`:110-120`) retries once after 700 ms, only when the providers disagree, and refuses with "provider step disagreement" (`verify-ceremony.mjs:106`).
- So a funding split between the providers can no longer pass `--preflight`. Tests at lines 142-153 cover a recovery, a persistent split, and two matching broken results (which do not retry).

**F-3 (persistent disagreement labelled "unstable"): closed.**
- Each attempt records `differingIndices` (`:52-59`).
- Three unstable attempts with the same indices are reported as "persistent cross-slot disagreement" (`:72-73`).
- Each retry moves provider A to at least provider B's previous slot (`verify-ceremony.mjs:90`).

**F-5 (retry loop and program IDs untested): closed at the function level.**
- `compareSetupWithRetry` and `setupProgramIdentity` are extracted and tested: at most 3 attempts, two 700 ms pauses, an immediate stop on a same-slot result, a missing or wrong ID, and `null`.
- The code in `verify-ceremony.mjs` that calls them is still untested (G-6).

**F-4 and F-6:** see G-1 and G-2.

## Findings

### G-1. LOW: the F-4 test takes its list from `activityFields`, so the original risk is still open
**Where:** `ceremony-compare.test.mjs:60`, `ceremony-compare.mjs:9-13`

**Failure path:**
- The loop tests `STRUCTS[kind].fields` minus `activityFields[kind]`.
- Suppose someone adds `round_id`, `price`, `sales_stopped` or `pending_guardian` to `activityFields` to quiet an "unstable" result. That field leaves the tested set automatically, and all 22 tests still pass.
- This is exactly the case `COUNTER-CLOSURE-REVIEW.md:105` raised: "A future edit that adds one of them to `activityFields` would pass every current test."
- The loop only shows that the current list is applied correctly. It does not stop the list from growing.
- What limits the risk: per-provider `expect*` would still catch a wrongly masked field before activity starts, because each provider is judged on its own.

**Fix:**
- In the test, assert `assert.deepEqual(activityFields, {MintConfig:[...20 literal names], BurnConfig:[...3], GovConfig:[...5]})`.
- Also assert that a named list of fields that must never be masked is disjoint from `activityFields`: authorities, `pending_*`, round settings, stop flags, `split_bps`, the charter dates and the limits.
- Optionally, flip every byte of the account, not just the first byte of each field, so the discriminator and any trailing bytes are covered too.

### G-2. INFO: actions by our own operators before charter opening still produce the misleading "broken" label
**Where:** `verify-ceremony.mjs:60`, `ceremony-compare.mjs:122`, `PRELOCK-R1.md:71-79`

**Failure path:**
- The new gate only refuses at or after `charter_opens_at` (2026-10-19 17:00 UTC per `mainnet-init.json:69`).
- Before that, `sweep_sol_for_swap` needs only the swap operator's signature, the 6 h cooldown and a REVENUE balance above the 0.05 SOL reserve (`lib.rs:1055-1075`). Anyone can send SOL to REVENUE.
- If the swap bot runs between signing and `--after`, it sets `last_sweep_at`. A guardian stop or pending-authority proposal would likewise change pinned fields.
- `--after` then returns `broken`. `stepVerdict` describes that as "an account that can never be rewritten holds the wrong values", which points the operator at the wrong cause.
- PRELOCK says "or other activity", but the code and its refusal label only cover charter opening.

**Fix:**
- In `PRELOCK-R1.md`, state that the swap bot and guardian actions must stay off until `--after` passes.
- In `--after`, when the only `expectMint`/`expectBurn`/`expectGov` differences are fields in `activityFields`, report "post-activity counters changed; use operational read-backs", not plain `broken`.

### G-3. LOW: the step retry does not move a lagging provider forward
**Where:** `ceremony-compare.mjs:110-118`, `verify-ceremony.mjs:100-104`

**Problem:**
- Both attempts use the same `minSlot`.
- REVENUE lamports are not in the snapshot. If funding lands near the snapshot slot, a provider whose finalized slot trails by more than 700 ms disagrees again and the run refuses.
- This fails closed, but it is noisy right after signing.

**Fix:** on retry, raise `minContextSlot` to the highest slot recorded in the first attempt's `reads`.

### G-4. INFO: refused step reads are not recorded and are labelled as network failures
**Where:** `ceremony-compare.mjs:89`, `reads.mjs:25-29`, `verify-ceremony.mjs:113`

**Problem:**
- "Step read precedes snapshot" is turned into a generic read error by `wrap`. It escapes the step retry and is reported as "network read or decoding failed".
- The refused slot is never pushed to `observations`, so the evidence cannot tell stale-provider data from an outage.

**Fix:** before throwing, push `{address, slot, refused:'precedes snapshot'}`, which contains no URL. Have `checkStepsWithRetry` report a distinct label.

### G-5. INFO: the time-window gate trusts one provider's `confirmed` clock
**Where:** `verify-ceremony.mjs:59-60`

**Problem:**
- `chainNow(conn)` reads only the dedicated provider, at `confirmed`.
- If that provider's clock is wrong, the gate can be passed after opening. The initial-counter checks would then still fail closed with the G-2 label.

**Fix:** read the Clock sysvar through the finalized adapter on both providers, and require both to be before `charterOpensAt`.

### G-6. INFO: how `verify-ceremony.mjs` connects these pieces is untested
**Where:** `verify-ceremony.mjs:85-107`

Nothing tests that:
- provider A's `minContextSlot` is chained from B's previous slot (`:90`);
- `minSlot` is the larger of the two slots (`:97`);
- both providers use the adapter (`:102`);
- the window gate applies only in `--after` (`:60`);
- the `need` labels carry the `reason` value.

**Fix:** move lines 86-107 into a function that takes two connections, and test it with two fake providers for every `STEPS` id. Include a provider that serves a stale slot and a REVENUE split.

## Missing verification

1. **No test log for the "22/22 passed" claim.** No log under `audits/` is tied to the current commit with a clean tree; the only results there are named for `2d55ca5`. The 22 tests in the file match the count, but the pass is unverified. N-5 is still open for this change.
2. **No live two-provider `--preflight` run on the current code.** `preflight-2d55ca5.json` comes from the commit before these changes.
3. **"Browser source and signing bundle unchanged" is not verified at the byte level.** Without git or bundle hashes I could only check the source: the new adapter lives only in `scripts/`, and `account()` still reads at `'confirmed'`.
4. **G-1:** nothing yet stops a pinned field from being moved onto the masked list.
