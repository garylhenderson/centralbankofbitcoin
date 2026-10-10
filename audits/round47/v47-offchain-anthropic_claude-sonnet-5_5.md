# Round 47 audit, off-chain pass: independent read of the tree

**Scope and limits.** I read the bundled files and ran nothing. Every claim below comes from the text, except the shell behaviour in F1, which I derived from `grep -c` semantics and give an exact command to confirm. I did not receive the driver steps, `web/src` or `web/build.mjs`. Nothing below turns on their contents.

**Result: no CRITICAL or HIGH.** I found one LOW (F1), four INFO (F2 to F5), and nothing in the five programs, no value path and no refused crack. This tree does not require no changes. F1 and F2 are in code that was never audited.

## R0. Round 46's repairs, re-verified

I checked each repair at its site.

- **V46o-2 (undelivered-pass rollback).** The `!delivered` block in `alarm.mjs` now restores `unreadPasses` and `unreadSkips` along with the cursors and backlogs. Holds.
- **V46o-3 (load-time refusal pages).** `refuseStrayOverridesAtLoad` runs before any `rehearsalOnly` read in `revenue.mjs` and `alarm.mjs`. It writes the marker, calls the literal production notifier, and exits 3. The crank still refuses inside `main()`. Holds.
- **V46o-1 (ack arm).** The arm drives `unredeemable_owner` with an asset-less finding and a well-formed ack. A mutant without the guard would turn red. Holds.
- **V46-5 and V46-8.** `takesOverrides` is false exactly for the profiles the mainnet gate judges. `judgeRehearsal` takes the init key by genesis. Holds.
- **V45o-4 carry (`carryUnreadPasses`).** Present, and the flood arms pin `[[2,3],[2,5],[2,5]]`. Holds.

The release-commit and rehearsal-tree machinery is as round 45 left it, apart from the stripped-bytes change.

## R1 to R6, independent first-principles checks

These came out clean.

- **Oracle floor.** I re-derived `oracleFloor`:
  - sats = lamports × sol.price × 10^(es−eb) / (btc.price × 10).
  - The rounding is down.
  - `satsPerLamport` is a float used only for the deviation filter.
- **Pyth offsets.** Disc 8, write authority 32, `verification_level` at 40, `feed_id` at 41, price at 73, conf at 81, expo at 89, `publish_time` at 93. All correct.
- **Pool accounts.**
  - The Orca `swap` data is 42 bytes.
  - The Orca account order is right.
  - The tick-array order and seeds are right; for a_to_b, `shift = 0` is right.
  - The Meteora account order is right.
  - The bin-array direction is right for Y→X.
  - `meteoraSpot` correctly inverts DLMM's lamports-per-sat into sats-per-lamport.
- **Judge.** `judgeSwapInstructions` pins the venue, the output account, amount, floor, direction and limit. A flag-only tamper cannot change the compiled message (accepted as round 46 C08).
- **Crank order.** Retire, rescue, pre-joins, expire, split, distribute, expire, activate, claim. This matches MINT's gates (`BoostsExpireFirst`, `JoinWaitingFirst`).
- **Rescue instruction.** The crank's `rescue_nested` key list matches MINT's `RescueNested` account order.
- **`detectSweepState`.** The half-cooldown window cannot explain a thief's sweep, because a thief must wait a full cooldown after any honest one.

## The four questions about accepted limits

1. **Is any limit worse than stated?** No.
   - Limit 25 (the default `Connection` with no request timeout) is still true of crank, alarm and revenue, as stated.
   - New items F2 and F3 below widen limit 7's "survivable" claim to the Core-watch tooling.
2. **Is anything listed as a limit already closed?** No.
3. **Is any DISCHARGED item not discharged?** No new case.
4. **Is an OPEN AND BLOCKING item quietly treated as accepted?** Yes, in the documents only.
   - Item 22.2 is recorded FAIL in `RECORD.md`.
   - Item 22 and item 53 in SPEC still read as if the rehearsal had not run.
   - README says "done" for road step 8.
   - See F4.

## Findings

### F1 (LOW): the Core watch's suite result is written as invalid JSON when the suite passes, so the pass is never emailed and the suite restarts every cycle

**Where:** `scripts/core-watch-suite.sh`, the `FAILS=…` line and `res()`.

**The construct.**
- `FAILS=$(grep -c '^  XX' $C/suite.log 2>/dev/null || echo 0)`.
- When the log has no failing lines, `grep -c` prints `0` and exits 1. The `|| echo 0` then prints a second `0`, so `FAILS` is `"0\n0"`.
- `res` embeds it with `printf '"summary":"%s"'`. The result is a raw newline inside a JSON string.
- In `core-watch.mjs`, `suiteStatus` does `JSON.parse` in a try and returns `undefined` on failure.
- `decide` then takes the `!suite` branch and emits `{kind:'suite'}` on every tick.
- The old run's `running-<hash>` marker is already removed by the trap, so a full suite starts again.

**What happens.** The case that matters most is a Core upgrade the suite passes. That case never sends the "PASSED" email, and it re-runs the multi-hour suite every 10 minutes indefinitely. A failing suite writes valid JSON, because `grep -c` then exits 0 with N > 0.

**Evidence to check.**
- `x=$(grep -c '^  XX' /dev/null || echo 0); printf '%s' "$x" | od -c` shows `0 \n 0`.
- Feeding `printf '{"s":"%s"}' "$x"` to `node -e 'JSON.parse(...)'` throws.
- With a real passing run, `.cache/core-watch/suite-<hash>.json` fails `JSON.parse`. A repeated log of `suite started for` on the same hash would appear in `watch.log`.

**Why LOW.**
- Nothing moves value, and the urgent "Core changed" email goes out before the suite starts.
- It is a defect in code that was never audited.
- `core-watch.mjs --selftest` tests `decide` only, never the shell's output contract.
- Round 37's precedent (tooling that cannot deliver its own result) is LOW.

**Fix.**
- `FAILS=$(grep -c … || true); FAILS=${FAILS:-0}`.
- Build the JSON with `node -e` or `jq -n`, not `printf`.
- Add a selftest arm that runs `res` and parses its output both ways.
- Treat an unparseable file as "status unknown, do not restart".

### F2 (LOW): the Core watch's private validator lock is honoured by no other runner, and it swaps the cache that the certifying runs read

**Where:** `scripts/core-watch-suite.sh`.

**The construct.**
- The script takes `.cache/VALIDATOR.lock` and checks `pgrep -x solana-test-val`.
- `scripts/run-tests.sh` as bundled never mentions that lock.
- `run-tests.sh` verifies the pin at [2/7], builds for minutes at [3/7], and only boots the validator at [4/7] from `$CACHE/core-mainnet.so`.
- Its hard gate then compares the on-chain Core with that same file. As its own comment says, that gate is a tautology against the cache, not against the pin.

**The window.** If the watch fires in the build window, it sees no validator and no lock, and copies the new Core over `.cache/core-mainnet.so`. The "certifying" run then boots and passes against the unpinned Core.

**Other ways it breaks.**
- The generated runner's name (`runner-<hash>.sh`) matches neither `pgrep -f "run-tests.sh|…"` in `swap-fork.sh` nor, presumably, in the sim runner.
- A SIGKILL or reboot skips the trap. That leaves the swapped cache, `VALIDATOR.lock` and `running-<hash>` behind.
- The next watch run then refuses to swap, and the status file stays `running` forever.
- The email path keeps saying "Suite: running".

**Why LOW.** It needs a Core upgrade landing during a human run. It fails closed in some orders (a pin mismatch kills `run-tests.sh` at [2/7]). The dangerous order silently validates the wrong Core.

**Fix.**
- Have `run-tests.sh`, `build-mainnet.sh`, `sim/run-sim.sh` and `e2e-localnet.sh` all take or refuse on `VALIDATOR.lock`.
- Re-hash the cache immediately before the validator boots.
- Have the watch use its own cache directory instead of swapping the shared one.
- Add a stale-lock rule (pid and start time, as `bank/lock.mjs` does).

### F3 (INFO): the Core watch is outside the cron installer, its flock and its deadman

- `scripts/cron-install.sh` installs exactly six tagged jobs. The selftest pins that set.
- `core-watch.mjs` is described as cron but is not among them.
- `judgeCronTemplate` only inspects `node bank/` lines, so a hand-added watch line has no `flock -n` check and no deadman.
- This is a third-party-change detector that exists because Metaplex's feed missed an upgrade, yet its own death is silent.
- The alarm's `prog.core.hash` drift (CRITICAL, with a deadman) already covers the first-sight alert, so this is INFO.
- **Fix.** Install it from `cron-install.sh` with `flock -n` and a staleness deadman on `.cache/core-watch/watch.log`.

### F4 (INFO, docs and process): README and SPEC are inconsistent with the rehearsal record on an OPEN AND BLOCKING item

- `RECORD.md` says item 22.2 is FAIL, and item 22.1 PASS is "at 5 vaults (scale not exercised)".
- SPEC's road step 8 correctly says "22.2 recorded FAIL".
- README's generated road table reads "done on mainnet 2026-10-09 to 10-10". `readme-facts.mjs` `short()` truncates the SPEC cell at the first colon, so the FAIL is cut from the public front page.
- SPEC item 53 still says the dress rehearsal "has not yet run to its end on mainnet".
- SPEC item 22's header still says nothing has ever run a distribution on a live chain, though 22.1 passed.
- Item 22.2's own criterion ("alarm's live passes in rehearsal mode") was not met by a clean second pass. The FAIL is a true detection of Core's real upgrade. Nothing shows a clean second pass exists.
- Nothing is hidden in the underlying record, but a reader of the front page is told "done".
- **Fix.**
  - Make `short()` carry "22.2 FAIL (true Core-upgrade detection)" through, or emit two cells.
  - Update SPEC items 22 and 53.
  - Have Gary record either a waiver of 22.2 or a repeat, which means a second rehearsal, since the programs are closed.

### F5 (INFO): a clean clone cannot follow README's "Reproducing the tests" order

- `web/test/ids.test.mjs` and `bundle.test.mjs` read `dist/SHA256SUMS` and `dist/MANIFEST.txt`. README says `dist/` is not committed.
- `build-mainnet.sh` requires `target/deploy/cbob_vault_sweep.so` from a prior `run-tests.sh`, and `run-tests.sh` runs the web-offline suite, which needs `dist/`.
- The circle resolves only by a deliberately failed first run.
- This is the same class as V46o-4 (a gate that needs an untracked artefact).
- **Fix.** State the bootstrap order, or make the web suite skip with a named reason when `dist/` is absent.

## Things I tried to break and could not

- **Judge and builder.**
  - The `swapInstructions` order matches the judge's seven-instruction check.
  - A pre-existing wSOL balance is closed back to the operator.
- **Crank.**
  - The pre-expired owed arithmetic matches `reweigh`.
  - Pre-joined and pre-expired vaults match MINT's `owed_of`.
- **Alarm.**
  - The frozen-pool text and `detectCrankHealth` freeze coverage behave as stated.
  - `rememberRedemptions` requires a signature.
- **Launch gates.** `judgeLaunch` pins every ruled value except `vault_collection` (no ruling can pin it), and rejects unruled fields.
- **Rehearsal bound.** `rehearsal-tree.sh`'s abbreviated-id sweep is sound.

## What this process cannot do before launch

With immutable programs and no firm, the following need a person or a real run:

1. **Run the Core watch end to end.** Fake a changed hash with a saved copy, let the shell script finish passing, and confirm the PASS email arrives and nothing restarts. F1 shows this was never done.
2. **Dress-rehearse a clean alarm pass.** Item 22.2 has no clean second pass. Either re-run a short rehearsal after Core has settled, or have Gary record an explicit waiver. Also exercise the crank at more than five vaults, which is item 22's open scale part.
3. **Watch a real Phantom mainnet claim and opening on the shipping build.** Do it before step 11, at the 7-day window's timing, with someone who did not write the pages.
4. **Test notification delivery at 3 am.** Pull the plug on the alarm, the crank and the revenue job on purpose, and confirm Gary's phone rings for each of the three load-time and run-time failure paths.
5. **Give the keys a custody drill.** Restore the deploy authority, swap operator, release wallet and crank key from the offsite backup onto a clean machine, and sign once with each.
6. **Check Metaplex's changes outside the box.** Get the new Core's source (or a verified build) diffed by someone, since our suite only samples behaviour. The 2026-10-09 upgrade came from an unpublished build.
7. **Verify the on-chain bytes independently.** A second person dumps each program after step 9 and again after step 11, confirms the sha256 prefix and zero tail, and confirms the upgrade authority reads none.
8. **Decide the launch-time unknowns.** The charter window's date and the lock deadline are set only after the Giraffish Moments key is secured (limit 46's hot-key exposure). Whoever signs step 10 should be someone who has read limit 46 aloud.