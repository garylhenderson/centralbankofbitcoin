# D6 UI final delta audit (read-only)

**Files read in full:**
- `d6-ui-claude.md`
- `/scratch/cbob-d6-ui/web/src/lib/club-actions.mjs`
- `web/test/club-controls-browser.cjs`
- `d6-ui-browser.log`

**Read for context only:**
- `ui.mjs`: the `action` and `clear` helpers.
- `portal-market.ts:58-96`: the order quote shape.

I ran nothing, edited nothing and made no external calls.

## Verdict

**Nothing blocks committing the branch.** Enabling it is a separate gate and is still blocked by the missing verification listed at the end.

**Previous findings, checked against the new code:**
- **U1 and U2 hold.**
  - Order rows and Cancel / Request cancellation are drawn at `:153-158`, before any flag check or ownership read.
  - The holder section depends only on `mine && holder` (`:163`) and comes before `if (!trading) return` (`:166`).
  - `mountClubAction` refuses when `holderActionsEnabled !== true` (`:106-109`).
- **F1 sequencing works for its stated case.**
  - Both `reviewAction` (`:19-22`) and the order quote (`:175-178`) use the same `WeakMap` token on `messages`. A late prepare or quote response is dropped.
  - The old review's Confirm button is removed by the synchronous `clear` (`:20`, `:176`), so a stale Confirm can't stay clickable.
- **The labels are now distinct.** "Make an offer" is at `:174` and "Review this offer" at `:170`.
- **The ready marker is in place.** `panel.dataset.state = 'ready'` is set in `finally` (`:193`), and the test waits on it (`test:40`).
- **The browser log matches the test file.** All 20 PASS lines are present, one for each `console.log` in the test.

## Findings (all Low, none money-moving)

**N1: A stale rejection still lands in the current review.**
- **Where:** `club-actions.mjs:21` and `:177`.
- **Cause:** `currentReview()` is only checked after `await` resolves. If a superseded prepare or quote *rejects*, the error goes to the `action` helper. That helper appends a `refuse` alert (`role="alert"`) into the shared `messages` node (`ui.mjs:52-54`), which now holds the newer review.
- **Failure path:**
  1. The member clicks "Review purchase".
  2. They then click "Activate vault".
  3. The activation review renders.
  4. The purchase prepare then fails, for example "listing no longer active". A red alert appears under the activation review.
- **Effect:** the member is confused, but nothing is signed.
- **Fix:** wrap each await:
  ```js
  let quote
  try { quote = await clubRequest(...) }
  catch (e) { if (!currentReview()) return; throw e }
  ```
  Do this at both sites.

**N2: Confirm outcomes are not sequenced.**
- **Where:** `:62-69` (the `finish` and `catch` in `reviewAction`) and `:188-189` (order confirm).
- **Cause:** in the trade panel there is no `.task-counter`, so `:60-61` disables nothing. Every other panel button stays live while a confirm is in flight.
- **Failure path:**
  1. The member confirms activation.
  2. While that request is in flight, they click "Review purchase", and the purchase review renders.
  3. The activation response arrives. `clear(out)` replaces the purchase review with "Confirmed on chain." and its signature.
  4. The member can read that as the purchase having gone through.
- **Same problem, other paths:**
  - An "Offer recorded" result can wipe a newer review.
  - A confirm error's "Check this action" recovery view can also wipe a newer review.
- **Why it's low:** no wrong signature can result, because the newer Confirm button is removed. Server-side replay is bounded by single-use review tokens and order state.
- **Fix:**
  - Capture `beginReview` at confirm time.
  - If the review is stale when the confirm returns, append a labelled note such as "An earlier activation finished: …" instead of calling `clear`.
  - Or disable every `.trade-panel button` while a confirm is in flight.

**N3: The order quote is not checked against what the member asked for.**
- **Where:** `:177-181`.
- **Cause:** the server returns `kind`, `asset`, `seller_lamports` and `royalty_lamports` (`portal-market.ts:83`), but the UI renders them without checking. The trade review does check its numbers (`:32-33`).
- **Fix:** refuse to render the quote unless all of these hold:
  - `quote.kind === (mine ? 'listing' : 'offer')`
  - `quote.asset === v.asset`
  - `seller + royalty === price`
  - `royalty === price / 10n`

  This is defense in depth only. The sealed review token already binds the input on the server.

## Test gaps (`club-controls-browser.cjs`)

1. **The race test covers only one path.** `:60` tests `reviewAction` against `reviewAction`. Untested:
   - Order quote against order quote.
   - The cross-path case: a slow quote against a fast review, and the reverse.
   - A stale *rejection* (N1).
2. **The check at `:58` only asserts absences, with no positive check.**
   - The ready marker is set in `finally` even when loading fails.
   - So if the vault read regressed to throwing, `controls follow fresh ownership` would still pass.
   - **Fix:** assert that `.trade-panel .box.refuse` is absent. Also pair each absence with a presence check: "Review purchase" when `mine=false`, and "Activate vault" when `mine=true`.
3. **Legacy and string flags are only tested on `tradePanel`.** They are not tested on `mountClubAction`, for example a session with `{actionsEnabled:true}` and no `holderActionsEnabled`. The code is correct (`:106`), but nothing tests it.
4. **"Make an offer" is not asserted absent when `mine=true`** in the four-combination loop (`:44`).
5. **The harness still needs a pre-launched Chrome on :9223**, plus `ws` and `esbuild` loaded by absolute path from other projects (`:3-4`). It isn't a reproducible CI gate yet.

## Already documented, not blockers for the commit

- F2: some of a member's own orders still have no cancel control.
- F3: turning trading off pauses standing orders but doesn't cancel them.
- F4: governance still reads `actionsEnabled`. That is correct today, through the alias at `route.ts:99`.

## Verification still missing before enabling either flag

1. **HTTP checks against a built app.** `prepare`, `confirm`, `order` (both quote and token) and `cancel` should return the expected status for every lane, under all four flag combinations.
2. **A browser run of this UI against the real a97feac6 backend.** The fixtures stub the session and market shapes, so a field rename on either side would not be caught.
3. **A deployed-environment check** that both flags are absent or off until the independent triage pass is done.
4. **Ordering at enablement time.** An old UI talking to the new backend brings back the U1/U2 coupling, so the new UI must be deployed before either flag is turned on.
