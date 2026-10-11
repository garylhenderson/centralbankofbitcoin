# Follow-up audit: CBOB R1 dates (BATCH-2 follow-up patch)

**Verdict:** **Approved** for fresh pin acceptance and public pages and data publication only. Hosted signing is **not** approved. F1, F2 and F4 are closed. F3 and F5 remain gates before step 10 signing, as the batch itself states.

I made 7 targeted reads/greps and executed nothing. So the "72/72 launch, 161/161 ceremony" and "observed 1006" figures are claims I have not reproduced. Re-running them on the pinned fresh build stays a condition of acceptance.

## What I verified

**F1 is closed.**
- `RULED_DATES` (`check-launch-params.mjs:42`) is frozen and is a source constant, not read from the file being judged.
- Both dates are spread into `PINS` as strings (`:64`). They are compared through `String(v(k)) === want` (`:89`), the same path as every other ruled pin, so any edit to either date is refused, in either direction.
- Arithmetic still holds: `1792170000` is 2026-10-16 17:00Z and `1792429200` is 2026-10-19 17:00Z.
- The "wrong date" negatives (`:342`) look for `not the ruled ${value}`. That only matches the pin message format at `:89`, so they test the pin and not some side effect.

**F2 is closed.**
- The selftest `good` fixture no longer overwrites the dates. It judges the committed values at a fixed `NOW = 1792108800` (`:330`), which is 17 h before the lock, so the fixture never expires.
- The ceremony test now uses a fixed `NOW` (`ceremony.test.mjs:35`) and judges the committed dates unchanged.
- `:45` asserts that `launchWithCollection(filled, kp(42))` with the real dates gives `[]`. That is the check I asked for.
- The boundary case `nowSec = 1792170000` (`:343`) asserts the exact `lock_deadline must be in the future` element. A `>` changed to `>=` would be caught.
- F6 (the dependence on `Date.now()`) is resolved as a side effect.

**The margin test is honest.**
- `:400-401` filters on the margin message specifically. So it proves the 24 h rule independently of the pin, and doesn't claim the off-ruling date "passes".

**F4 is closed.**
- The alarm sentence is restored in `mainnet-init.json:141`.
- The generated snapshot doesn't carry source text (my grep found no copy of it), so this edit doesn't create snapshot drift.

**The floors are consistent.**
- The README rows and `run-tests.sh` (`LAUNCH_FLOOR=72`, `WEB_FLOOR=1006`) were changed together.
- 72 is 69 plus the three new assertions (two wrong-date tests and the boundary test). That fits the claim that nothing was removed.

**Rehearsal is unaffected.**
- The rehearsal fixtures (`ceremony.test.mjs:432,469`) set `charter_opens_at` via the rehearsal judge, which has no date pins. They are unaffected.

## Findings

**G1. Low (missing verification). One existing negative now passes from the pin alone.**
- `:362`, "a charter window already over is refused", asserts only `.length > 0`. Since F1, the date pin alone makes the result non-empty.
- **Failure path:** deleting or breaking the clock checks at `:150` ("already be over") and `:151` ("open in the future") would still pass all 72 tests. No mainnet-judge test names either message (my grep found only the rehearsal one at `:320`).
- **Practical impact is nil for the committed file.** The pin plus `lock_deadline > now` already refuses any signing after 10-16. But the patch's "no assertions weakened" is not quite true.
- **Fix:** assert the specific message, e.g. call `judgeLaunch(good, { nowSec: RULED_DATES.charter_opens_at, pobSet })` and check that it `.includes('the charter window must open in the future …')`.
- **Not blocking publication.**

**G2. Info. The boundary is only proven from one side.**
- Nothing asserts that `nowSec = RULED_DATES.lock_deadline - 1` passes. A future change that tightens the comparison (for example `> nowSec + 3600`) would pass every test, because the pass case sits 17 h earlier.
- **Fix:** add a one-line pass at `deadline - 1`.

**G3. Info (doc hygiene).**
- The `RULED_DATES` lines were inserted between the `/** Round 23 (L17): the dedicated release wallet… */` JSDoc and `CBOB_RELEASE_WALLET` (`:40-43`). The doc comment now attaches to the wrong symbol.
- **Fix:** move the two lines above `:40`.
- The `LAUNCH_FLOOR` and `WEB_FLOOR` bumps also have no provenance comment (`run-tests.sh:292`; the `WEB_FLOOR` history comment stops at 824). Add a line each, e.g. "2026-10-11 R1 follow-up: +3 date pins" and "981→1006 restated to the observed count".

## Still open (unchanged, gates for step 10 signing, not for publication)

- **F3:** the alarm still reads the editable checkout (`bank/alarm.mjs:125`). It should read the pinned build, or be checked against `RULED_DATES`.
- **F5:** Gary still has to be told in writing that a failed R1 means the on-chain charter opens 10-19 under upgradeable programs. It also needs confirming whether any guardian brake can stop charter claims and deposits.
- **Hosted delivery:** Gary's D2 decision, the root-owned pinned build, preflight and read-back, and teardown are still needed. Cloudflare-proxied signing remains unapproved.

## Conditions on this approval

1. Accept the pin only from a clean, fresh build of the commit that contains this patch.
2. Re-run on that build and record the counts: launch 72/72, ceremony 161/161, and the web offline suite at or above 1006.
3. Regenerate the generated snapshot on that build and confirm it is identical to the reviewed one.
