# Audit: R1 pre-lock preparation and proposed R1 alarm patch

**Scope:** `rulings-prelock.patch` and `r1-alarm.patch`, checked against the live `/opt/cbob-vaults` sources they call (`check-launch-params.mjs`, `alarm.mjs`, `detectors.mjs`, `validator-lock.sh`, `run-tests.sh`, `run-sim.sh`, `e2e-localnet.sh`, `verify-ceremony.mjs`, `.gitignore`). This was read-only, with nothing run.

## Blockers

### B1. `--verify` checks only `result.json`, so a run that failed or never happened can still verify
`prelock-receipt.mjs` patch lines 282–295.

**What happens:** every check for an incomplete or failed run happens only during `--seal`: the per-suite `.status` files, the floor strings, `core-before` matching `core-after`, and both reads being on-pin. `--verify` just parses `result.json` (line 295) and runs `judgeReceipt`. The log-hash check compares the log files against hashes stored in that same directory, written by the same user. So "refuses altered logs" only protects against accidents, not edits.

**How it fails:** suppose someone hand-writes or partly writes a `result.json` with `status:'passed'`, the current HEAD, a `started` inside the window, the live Core fields, and hashes of whatever logs are present. `--verify` passes it, even if the suites failed or never ran. On a box where several automated sessions share the uid, someone "fixing" a failed seal this way is a realistic risk.

**Fix:**
1. Move every seal-time check into a shared function and call it from `--verify` too.
2. At seal, print one sha256 covering `result.json` and every evidence file. The owner records it outside the box, and `--verify` requires `--expect <hash>`.
3. After sealing, make the directory read-only and owned by root. This is consistent with D2's root-owned artifact.

### B2. The alarm patch doesn't contain the six tests it claims
`r1-alarm.patch` holds only the `alarm.mjs` hunk. The six checks BATCH-4 describes (no override, later/earlier/invalid override, rehearsal kept) aren't in the reviewed diff, so I can't confirm they test the real `lockDeadline()` rather than a copy. Don't apply the patch until the tests are in the same reviewed diff.

## Does the alarm cap close F3?

**Yes, the logic does, and rehearsal is untouched:**
- In production the deadline becomes `min(RULED_DATES.lock_deadline, env>0 ? env : Infinity)`, then `lockDeadlineOf` takes the minimum with on-chain `charter_opens_at`.
- The editable `mainnet-init.json` is no longer read in production, and the environment can only move the deadline earlier.
- Bad override values (`NaN`, negative, `0`) fall back to the ruled value.
- In rehearsal (`CBOB_ALARM_REHEARSAL=1`) the code path is the same as before. `detectUpgradeAuthorityAfterLock` and `detectMissingComponents` return nothing when production is off.
- `RULED_DATES.lock_deadline` = 1792170000 = 2026-10-16 17:00 UTC (noon CDT). `charter_opens_at` = 1792429200 (19 Oct, noon CDT), which leaves a 72-hour margin.

Residual issues are S1 and S2.

## Should-fix

### S1. The alarm now depends on the launch checker at import time
`alarm.mjs` now imports `scripts/check-launch-params.mjs`, which pulls in `bs58`, `pob-merkle.mjs`, `Keypair` and `layout`. If any of them throws on import, the alarm process dies before `main().catch` sets up its "ALARM FAILED TO RUN" notice, so a broken import makes the alarm go silent.

**Fix:** define `RULED_DATES` in `bank/detectors.mjs`, which both files already treat as the shared pin module, and re-export it from `check-launch-params.mjs`.

### S2. Editing one line in the working tree still postpones the alarm
`RULED_DATES` is in an editable file in the tree the alarm runs from. An uncommitted edit to `check-launch-params.mjs` moves the deadline later without any notice.

**Fix:** in production, the alarm should report any difference between the running `RULED_DATES` and a second pin (or the committed blob hash). Also document that postponing the lock means a reviewed commit to `RULED_DATES`. Until that commit lands, `program_not_locked` will page CRITICAL on every pass after 16 Oct 17:00 UTC. That is correct behaviour, but put it in the runbook.

### S3. The "independent final live read" isn't independent
`prelock-core.mjs` line 224 uses the same Helius URL for the before read, the after read, the seal's third read and the final verify read. One faulty or stale provider would pass all four.

**Fix:** also read the second provider the watcher already uses, and refuse unless both agree on programdata address, upgrade slot, byte length and sha256. Record the Core upgrade authority as well; a change of authority is an early warning.

### S4. The receipt isn't tied to the five Bank programs that the lock freezes
The receipt pins Core, not the bytes or upgrade authorities of seal/mint/burn/gov/sweep. `verify-ceremony.mjs --after` (line 56, `judgeProgramBytes` against profile pins) is a separate manual step.

**Fix:** have `prelock-core` (or a sibling script) record the live programdata hash and authority of all five programs before and after the run. `judgeReceipt` should require them to equal the profile `programBytes` at the receipt commit, and verify should re-read them.

### S5. The "clean pushed source" check is weak
`prelock-check.sh` line 183: `git merge-base --is-ancestor "$commit" origin/v6` uses a remote-tracking ref that hasn't been fetched. It accepts any older ancestor, not the reviewed tip. Under `set -e` it also exits without any message.

**Fix:** require `--commit <reviewed sha>` and check `HEAD == that sha == origin/v6` after a fetch (or record the remote tip explicitly), and print why it refused.

### S6. Seal-path tests are missing
The 12 tests cover only `judgeReceipt`. Nothing tests refusal when:
- a `.status` is nonzero,
- a floor line is missing or wrong,
- `core-before` ≠ `core-after`, or `core-after` is off-pin,
- the tree is dirty at seal,
- the directory is outside `.cache/prelock`,
- a `wx` collision occurs.

The test "Core upgraded then reverted" changes the receipt at verify time; a change *during* the run is caught only by the untested seal comparison. `core-after` is also compared only on sha256 and slot (line 284); add `program`, `programdata` and `bytes`. Add tests for each case.

### S7. The full runner has never run, and the first real run is the 24-hour window
`prelock-check.sh` has never run end to end. Any plumbing fault (dirty-tree check after the suites, log markers, receipt path) will only surface inside the window and push the lock back.

**Fix:** add a `--rehearse` mode now. It skips the window check and writes to `.cache/prelock-rehearse/`, which seal and verify refuse by path. Also confirm what the Core watcher cron does when its diagnostic run hits `flock -n` during the multi-hour certification. If it emails a false "DID NOT RUN/FAILED", either suppress that or schedule around it. If the diagnostic is running when certification starts, certification refuses.

### S8. The X draft drops the conditional wording its own gate requires
In DRAFTS.md the statement keeps "The launch remains subject to the final lock and readiness checks". The proposed X text states the date with no condition, although the gate says "An announcement before lock must retain its conditional wording." Add the condition or hold the X text.

### S9. The holder guide overstates the post-lock re-test and leaves out the consequence
HOLDER-GUIDE.md still says "Each time a new Core goes live, our whole test suite runs again." PRELOCK-R1 says the watcher runs a diagnostic that bypasses the mainnet probe, which is not the certifying full suite. The new sentence also doesn't say that once the Bank's programs are locked, the Bank cannot adapt to an incompatible Core change.

**Fix:** describe the post-lock run as a diagnostic, and add the consequence sentence.

## Minor

- **The lock happens after verify with nothing tying them together.** Verify needs a live read no older than 60 s, but the lock is a separate step. The lock script should call `--verify` itself as its first step, and ideally re-read Core between the five authority removals.
- **An outdated message.** `detectors.mjs:2346` still points at "launch/mainnet-init.json lock_deadline", and in production that branch can no longer be reached.

## Confirmed by reading (not run)

- **Lock sharing:** child runners take the inherited fd 9, so they get the same lock rather than refusing (`validator-lock.sh`:19–35), and the validators close it (`9>&-`).
- **Floor strings:** the seal's exact-floor strings match what the suites print (`run-tests.sh`:542 and 443, `run-sim.sh`:86, `e2e-localnet.sh`:79), and each suite also requires its count to equal its floor.
- **No silent network skips:** under `CBOB_SHIP_GATE=1` the mainnet probe and the swap fork die rather than skip (`run-tests.sh`:482, 563). The web offline skip happens only in the rehearsal tree, and the seal requires the web line anyway. The sim and e2e suites have no skip path.
- **Core bytes:** all three suites hash `core-mainnet.so` against the same pin. `run-tests.sh`:198 and `run-sim.sh`:66 also dump Core back off the validator and compare it.
- **Clean-tree check:** `.cache/` is gitignored, so the receipt directory doesn't trip it.
- **Financial switches:** neither patch touches any trading, issuance or opening switch. I didn't read the live switch state.
