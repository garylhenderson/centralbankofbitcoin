# Audit: CBOB R1 dates source batch (BATCH-2)

**Verdict:** The source batch is sound. I approve accepting the pin from clean fresh builds and publishing the public pages and data. Two verification gaps (F1, F2) must be closed before anyone signs step 10, but they don't block publication. Hosted delivery and signing are outside this review and are **not** approved.

I made 10 targeted reads and executed nothing, so I have not reproduced the "69 launch selftests pass" claim or the stand-in-collection judge run.

## What I verified

- **The values are correct.**
  - `1792170000` is 2026-10-16 17:00Z, which is Friday 12:00 CDT.
  - `1792429200` is 2026-10-19 17:00Z, which is Monday 12:00 CDT.
  - US DST ends 2026-11-01, so CDT (UTC-5) is the right offset.
  - The gap between the two is 259,200 s (72 h). That clears the 24 h margin in `check-launch-params.mjs:98`.
  - The charter closes at 1793034000 (2026-10-26 17:00Z), which is still in the future.
  - Both values match `launch/RULINGS-2026-10-11.md:17` exactly.
- **Status and provenance are correct.** Both entries are `RULED`, and each source cites `launch/RULINGS-2026-10-11.md` and quotes R1's conditions accurately (the three checks, "Failure means no lock", and that the deadline is off-chain and not an initialize argument).
- **The generated snapshot matches.** `web/src/generated/launch.json` carries the same value and status pairs as `launch/mainnet-init.json`.
- **The README is generated from the source.** The README rows come from `readme-facts.mjs:52` rather than being hand-typed.
- **Negative coverage for an OPEN charter date is kept.** `check-launch-params.mjs:341` now builds an explicit OPEN charter fixture on top of an otherwise launchable value set and asserts it is refused. That is as strong as the old test it replaces.
- **The ceremony test asserts exactly the remaining OPEN set.** `ceremony.test.mjs:39` checks that only `['vault_collection']` is OPEN, which is stricter than the old `.some()`.
- **Nothing outside scope changed.** No program, validator or initialize code is touched.

## Findings

**F1. Medium. The ruled dates are not pinned by the judge, and step 10 writes the charter date permanently.**
- `judgeLaunch` (`check-launch-params.mjs:61-82`) pins every other ruled value from constants rather than from the file being judged (round 22, A7). The two dates are only checked against each other (`:94-98`).
- **Failure path:** a typo or unreviewed edit to either date that still keeps the order and the 24 h margin (for example `1792429200` becoming `1792515600`) passes the gate. MINT initialize would then write the wrong charter date permanently.
- **Fix:** add both R1 constants to PINS, or a dedicated `RULED_DATES` check. Have the selftest pass `nowSec` before `1792170000` instead of overwriting the dates, and add a test proving a different date is refused, naming the ruled value.
- **Land before step 10 signing.**

**F2. Medium (missing verification). No committed test judges the committed dates.**
- The selftest's `good` fixture (`:329,:332`) and the ceremony test's `filled` (`ceremony.test.mjs:41-42`) both overwrite the dates with synthetic values relative to now.
- `judgeLaunch` returns early on any OPEN value (`:55`). While `vault_collection` is OPEN, the ordering, margin and "in the future" checks never run against the real file.
- So the batch's claim that "the ceremony's exact launchWithCollection/judgeLaunch check passes with a stand-in collection" is not what `ceremony.test.mjs:47` exercises. That line runs on the synthetic dates. The pass was either run by hand or not run on the real values.
- **Fix:** add `judgeLaunch(launchWithCollection(launch, kp(42)).json, { nowSec: 1792108800, pobSet })` and expect `[]` (an empty list means launchable). Add a second case at `nowSec: 1792170000` that expects `lock_deadline must be in the future`. Use a fixed `nowSec`, never `Date.now()`, so the test does not break by itself on 10-16.
- **Land before step 10 signing.**

**F3. Low. The alarm reads the editing checkout, not the pinned build.**
- `bank/alarm.mjs:125` reads `/opt/cbob-vaults/launch/mainnet-init.json` directly. So the alarm's lock deadline came into force when the working copy was written, whatever happens with the pin.
- The effect is correct: `lock_deadline_unset` clears, and `program_not_locked` pages CRITICAL from `1792170000` if anything is still upgradeable.
- The risk: until initialize, there is no on-chain `charter_opens_at` to bound `lockDeadlineOf` (`detectors.mjs:2284`). Any unreviewed edit to the checkout silently moves the alarm's deadline.
- **Fix:** read the deadline from the pinned or committed source, or check it against the same constant F1 adds.

**F4. Low (docs).** The new `lock_deadline` source text dropped the old note that the alarm pages CRITICAL past the deadline, and in production if it is unset. That behaviour is still live. Restore one sentence so the alarm coupling stays discoverable from the value file.

**F5. Process risk. Must go to Gary before step 10; this widens the batch's own warning.**
- Step 10 is targeted for 10-13 or 10-14. It writes `charter_opens_at` permanently about 2–3 days before the R1 Core suite can run (within the 24 h before 10-16).
- If R1 fails, the on-chain charter window still opens 10-19 while the programs are upgradeable.
- "Do not enable claims" only controls Gary Club's switch. It does not stop holders claiming directly on-chain with any client.
- I grepped the charter instruction files under `programs/` and found no pause gate. This is not conclusive within my read budget.
- **Before step 10:**
  1. Confirm whether any guardian brake covers charter claims and deposits.
  2. If none does, tell Gary plainly that a failed R1 means value can arrive under upgradeable programs from 10-19, with no off-switch.
  3. Consider running a full live-Core suite before step 10 as well, to narrow that exposure.
- No program change is implied.

**F6. Info.** `ceremony.test.mjs:38-39` uses `Date.now()`. It is safe today because of the early return. Once the collection is recorded it will start failing after 10-16 noon. That is acceptable as a forcing function, but expect it.

## Conditions on approval

1. **Pin and publication.** Accept the pin only from a clean, fresh build of the reviewed commit, with the 69 selftests and the ceremony test re-run on that build, and the generated snapshot regenerated there and identical to the reviewed one.
2. **Step 10.** F1 and F2 must be fixed and independently triaged, and F5 stated to Gary, before step 10 is signed.
3. **Hosted delivery** (Cloudflare-proxied signing, a root-owned pinned build, preflight and read-back, teardown, Gary's D2 decision) remains separate and is not approved here.
