I've finished the review, read-only. I ran no tests, so everything below comes from reading the source.

**Bottom line:** F2's skip and supersession logic now matches the frozen Rust, and a changed outcome forces a fresh review on both signing paths. Not having the "horizon" check is defensible because the remaining gap is short. Two cheap disclosure fixes are still worth making, plus a few display defects (D2–D4).

## Provenance
- **Bank:** `.git/refs/heads/v6` = `e1679b3e…`, and HEAD is on `v6`. I couldn't check for uncommitted changes.
- **Gary:** `2c8fcace` comes only from the session's git snapshot. The ballot-release script and its test have uncommitted edits and are out of scope.
- **Adapter:** the generated `src/lib/cbob/generated/club-engine.cjs:3017` (`executionEffects`) and `:3068` (consent text) match Bank `sale-proposal.mjs:49-99` word for word. I did not hash it, so a rebuild plus hash check is still needed.

## F2: per-action results vs `lib.rs:515-590`
Checked line by line in `web/src/lib/sale-proposal.mjs:49-71`. All of these match the Rust:
- **SetRound:** an older-or-equal ID is skipped as superseded and moves nothing. A round that has already closed is skipped but still moves `last_round_id` (`advances_round_id`). Otherwise it applies, shows the live round being replaced (`replaces_round`) and says the mint count resets.
- **Guardian:** a superseded guardian change does not skip the restarts (`:61` vs Rust `:536`, which has no `continue`).
- **Restarts:** sales and reserve swaps are judged separately. A stop wins if it is set and `stopped_at >= created_at`, so a same-second tie goes to the stop (`:63` vs `:551-555`).
- **Swap operator and boost terms:** the superseded rules match `:571` and `:580`.
- **Reserve-swap limits:** always shown as sent, with the current values next to the proposed ones.
- **Field names:** the MINT fields read here match the names used in fixtures and by `plan-get.mjs`.

**Binding a changed outcome:**
- `details.execution` goes into `effectHash` (`web/server/club-engine.mjs:146`).
- **Gary path:** confirm re-plans and refuses on any mismatch (Gary `src/lib/cbob/portal-market.ts:316-317`).
- **External path:** it re-plans and compares the whole plan, consent text included (`external-proposal.mjs:68-69`).
- A sale closing, a sale opening (`opens_immediately`), a change to the live round or to stop state all change the hash. Mint count is not in the hash, which is correct.

**Display and consent:** both review screens render `executionDetails` (`club-actions.mjs:45`, `external-proposal.mjs:49`). The consent text (`sale-proposal.mjs:99`) and the banner (`governance-view.mjs:15`) say the chain decides at landing, that a sale closing before then is skipped but still supersedes older rounds, and that a proposal where every action is skipped is still recorded as executed.

## The horizon question
The triage's proposed refusal assumes a gap of unbounded length. The actual gap is bounded:
- **Gary path:** the plan is rebuilt at confirm with a fresh blockhash and sent at once (`portal-market.ts:316-345`, 35-second budget). What's left is roughly confirm to landing, capped by blockhash life (about 60–90 seconds).
- **External path:** it re-plans right before `signExact`, so the gap is wallet-approval time plus blockhash life.

So the author's choice to treat the slot time as an estimate rather than a guarantee, and to disclose it, fits how the protocol actually behaves. I'd keep it without the horizon refusal.

What still matters: if a round closes inside that gap, the outcome flips from "replaces the live round and resets the count" to "skipped, live round continues, older rounds blocked for good". The proposal can't be executed again. The generic consent doesn't tell the holder when this is actually close.

**Recommended fix (display only, no protocol or economics change):**
1. In `executionEffects`, when the result is `applies` and `closes_at − now` is under a fixed conservative margin (say 10 minutes), add a `closes_soon` flag. Show a specific warning and require a separate consent: "This sale closes at X. If execution lands after that, it is skipped, the current round stays, and older rounds become unexecutable."
2. Do the same for the end of the execution window (`voting_ends_at + 7d − now` under the margin). In that case the transaction fails with ProposalExpired: nothing changes except the fee.
3. Add one clause to the generic note: a newer stop, or another proposal executed first, can also cause skips at landing. Today the text only names a sale closing.

## Concrete findings
| # | Severity | Where | Issue |
|---|---|---|---|
| D1 | Low–Med | `sale-proposal.mjs:55-59`, `:99` | No warning when the round closes within minutes, as described above. The generic consent covers it only in general terms. |
| D2 | Low | `sale-proposal.mjs:58`, `governance-view.mjs:19` | With no live round (`round_id` 0), the screen says "Current round 0, replaced by this decision" with dates in 1969. If the live round has already closed, it is still called "replaced". Show "No round is currently set" or "The current round has ended" instead. |
| D3 | Low | `external-proposal.mjs:84` with `:55` | The "Other tab" fix works in `resolvePendingProposal` (`:36`) and in the desk's recovery (`proposal-desk.mjs:63`), with a test at `proposal-recovery.test.mjs:31`. But in the "Check transaction" handler, a `busy_elsewhere` result makes `finish` return false, so it still shows "Still awaiting confirmation. Do not sign another copy." That happens when another tab has already settled and removed the receipt. It needs its own message. |
| D4 | Low | `sale-proposal.mjs:61-64` vs `governance-view.mjs:15` | The stop-wins skip at landing (a guardian pulls a stop after confirm) is only covered by "chain decides at landing". The suggested extra clause fixes this. |

## Bank tests (author tests, not run by me)
`web/test/sale-proposal.test.mjs:63-75` covers:
- a round that has already closed, still advancing the round marker
- a superseded round
- the live round being replaced
- crossing the close time changing the details
- the guardian and restarts judged separately
- the same-second tie going to the stop
- an older stop being restartable
- operator and boost supersession
- the consent wording

`governance-engine.test.mjs:51-52` checks that supersession and notice-period changes alter the hash.

**Gaps:**
- No engine-level test that crossing `closes_at` changes `effectHash`. Line 68 compares raw details only.
- No test that the external path refuses on a flipped outcome.
- No display test for "no live round".
- No test of the `busy_elsewhere` message after a check.

## Still open, not reviewed as fixed
- Showing the current mint count
- A warning at creation when the proposed round closes inside the execution window
- The external rent estimate
- The page checking the royalty destination

Live acceptance hasn't happened: no wallet or Phantom rehearsal, no live database or row-security check, no real-member test. This review doesn't approve any fingerprints or the release.
