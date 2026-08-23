# Round 19 Audit Report

## R1. THE SELF-AUDIT'S OWN REPAIRS

### R1-1 [LOW] `cron-install.sh` `ours()` could match the TAG inside a quoted string
**Construct:** `ours() { grep -F "$TAG" <<<"$CUR" | grep -v '^[[:space:]]*#'; }`
**Issue:** The function greps the whole crontab for the TAG, then strips lines starting with `#`. A line like `41 */6 * * * cd /opt/cbob-vaults && echo "#cbob-vault-cron" && node bank/revenue.mjs --live` would match the TAG inside the echo string and survive the comment filter. The `REV_LIVE`/`DIST_DRY` preservation would then read a non-cron line as evidence of operator intent.
**Evidence:** `grep -F "#cbob-vault-cron" <<<"41 */6 * * * cd /opt/cbob-vaults && echo \"#cbob-vault-cron\" && node bank/revenue.mjs --live"` returns the line.
**Fix:** Anchor the grep to the end of the line, or require the TAG to be preceded by whitespace and followed by a known job name.

### R1-2 [INFO] `supersede()` is called even when there is no prior verdict
**Construct:** `const sup = supersede(st.days[day], new Date().toISOString()); st.days[day] = sup.rec`
**Issue:** When `was.length === 0`, `supersede()` returns the original record unchanged, but the assignment `st.days[day] = sup.rec` still runs. Harmless, but the `if (sup.superseded)` guard around the log message is the only signal that nothing happened.
**Evidence:** Trace through `supersede({startedAt: 'x'}, 'now')` — returns `{rec: <same object>, superseded: false, ...}`.
**Fix:** None needed; the guard is correct.

### R1-3 [INFO] `isTableRow` regex is greedy and could match a classification in the middle of a row
**Construct:** `const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)`
**Issue:** The `.*` is greedy. If a row's content contains `**ON-CHAIN.**` before the final column (e.g., in a code span or footnote), the regex still matches. In practice the classification is always in the last column, so this is theoretical.
**Evidence:** `/^\| .*\| \*\*ON-CHAIN.\*\*/.test('| foo **ON-CHAIN.** bar | baz | **ON-CHAIN.** |')` returns `true`.
**Fix:** None needed for current SPEC.md; document the assumption.

## R2. THE ROUND-18 OFF-CHAIN REPAIRS

### R2-1 [LOW] The refusal paging is a griefing surface that pages on every daily run
**Construct:** `if (plan.refusal) { ... if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} } process.exitCode = 1 }`
**Issue:** A refusal happens when an activated vault has no level. The Bank's co-signature is supposed to prevent this, but the level is assigned off-chain *after* mint. If the Bank co-signs a mint and the level assignment fails or is delayed, every daily run pages a human until the level is added. The exit code is also not suppressed under `--dry-run`, so a CI health check goes red.
**Evidence:** The comment acknowledges this: "A halt any stranger can trigger now pages a human on every daily run."
**Fix:** Consider rate-limiting the page (e.g., once per day per refusal reason), or suppress the exit code under `--dry-run` for the refusal case.

### R2-2 [INFO] `settledAsPayout` direction is correct
**Construct:** `export function settledAsPayout(row) { if (paymentState(row) === 'paid') return true; return paymentState(row) === 'resolved' && row?.resolvedAs === 'paid' }`
**Issue:** None. Not resetting the clock makes `holdDays` larger, which crosses the 31-day ceiling sooner. The direction is correct.
**Evidence:** The selftest pins both directions: `holdDays(led({}), d) === 52` and `holdDays(led({resolvedAs: 'paid'}), d) === 2`, and `decideEmission` returns `pay: true` for the larger value.

### R2-3 [INFO] Dust bound `dust < activated.length` holds in all reachable cases
**Construct:** `t('...and the dust is under ONE SAT PER PAID VAULT, not merely under the denominator', ...)`
**Issue:** None. The bound is attained at `available = denominator - 1` (measured 2,099 at the 2,100-vault census). The selftest pins this.
**Evidence:** `dustAt(6404n) === 2099n` and `dustAt(6404n) === activated - 1`.

## R3. scripts/bank-sign.sh — THE CANONICAL BASE64 ROUND TRIP

### R3-1 [LOW] `base64 -w0` is GNU-specific; non-GNU hosts fail closed
**Construct:** `CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true`
**Issue:** On macOS/BSD, `base64` does not support `-w0`. The pipeline fails, `CANON` is empty, and the check `CANON != TX` fires. This is fail-closed (correct), but means the script does not work on non-GNU hosts without modification.
**Evidence:** The selftest pins this: `t('with base64 unavailable the gate REFUSES rather than accepting', run(legit, fake), 'refused-by-base64-gate')`.
**Fix:** None needed; fail-closed is correct. Document the GNU dependency.

### R3-2 [INFO] The corrected comment about `ps` is now true
**Construct:** `⚠️ ROUND 18 CORRECTION ... this line used to end "so it is not in `ps`". It IS in `ps` ...`
**Issue:** None. The comment correctly states that the transaction is not an argv blob of `bank-sign.sh` itself, but is an argv blob of `node bank/cosign.mjs`.
**Evidence:** The last line of the script is `exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ${LIVE[@]+"${LIVE[@]}"`, which puts the base64 into `node`'s argv.

## R4. scripts/cron-install.sh — THE MONEY CLAIM

### R4-1 [INFO] The header is accurate for a fresh install and a re-run
**Construct:** The header enumerates both money jobs and the summary computes the posture from the actual crontab.
**Issue:** None. The header correctly states that `revenue.mjs` is opt-IN (installed without `--live`) and `distribute.mjs` is opt-OUT (installed without `--dry-run`). The summary at the end computes the posture from the lines actually written.
**Evidence:** The `ours()` function correctly filters commented lines, and the `DIST_DRY`/`REV_LIVE` preservation is tested in the selftest.

## R5. THE GATES ADDED OR CHANGED

### R5-1 [LOW] `MintVault` struct regex could be fooled by a comment with `}` on its own line
**Construct:** `const body = (src.match(/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/) || [])[1] || ''`
**Issue:** The non-greedy match stops at the first `\n}`. A comment like `// closing brace: }` on its own line would terminate the match early, causing the parser to miss fields after that line. The selftest checks the first 6 fields, so a comment after `payer` would not be caught.
**Evidence:** Inject `// }\n` after `pub collection:` and the parser returns only `['config', 'asset', 'collection']`.
**Fix:** Strip comments before parsing, or match the closing brace at column zero (not preceded by whitespace).

### R5-2 [INFO] `codeOnly` correctly strips shell comment lines
**Construct:** `const codeOnly = src => src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')`
**Issue:** None. Lines starting with `#` (after optional whitespace) are comments in shell. The regex correctly identifies them.
**Evidence:** The selftest pins this: `t('there is exactly ONE exec-of-the-co-signer line in the code', ...)`.

### R5-3 [INFO] The `nothingToDo` suppression arms prove what they claim
**Construct:** Two arms that show a half-finished day raises the alarm, and a stale `nothingToDo` silences it.
**Issue:** None. Together with the `supersede` arms, they prove the end-to-end behavior.
**Evidence:** The arms are in the selftest and pass.

## R6. THE COUNTS AND THE ARITHMETIC

### R6-1 [INFO] All floors match and all arithmetic checks out
**Construct:** `DET_FLOOR=434`, `ALLOC_FLOOR=93`, `MIN_ASSERTIONS=286`, and the schedule figures.
**Issue:** None. The selftest checks that `selftest.mjs`'s `FLOOR` equals `DET_FLOOR` and `distribute.mjs`'s `FLOOR` equals `ALLOC_FLOOR`. The arithmetic:
- 240-vault census: 108+60+36+24+12 = 240, denominator = 732 ✓
- 2,100-vault census: 945+525+315+210+105 = 2,100, denominator = 6,405 ✓
- Per $1,000 at 240: 2.73, 4.10, 5.46, 6.83, 8.20 ✓
- Per $1,000 at 2,100: 0.31, 0.47, 0.62, 0.78, 0.94 ✓
- Shares at 2,100: 29.5, 24.6, 19.7, 16.4, 9.8, sum = 100.0 ✓
**Evidence:** The selftest pins all of these.

## R7. WHAT THE SELF-AUDIT MISSED

### R7-1 [INFO] The `settledAsPayout` claim is correct
**Construct:** `settledAsPayout` is used in `holdDays` and `supersede`; `paymentState` is used in the transfer loop and `outstanding` count.
**Issue:** None. The cadence question ("did this day pay?") is asked only by `holdDays` and `supersede`, both of which use `settledAsPayout`. The transfer question ("should I send to this vault?") is asked by the transfer loop and `outstanding` count, both of which use `paymentState`. The questions are different, and the functions are used correctly.
**Evidence:** Search for `paymentState` and `settledAsPayout` in `bank/distribute.mjs`; no caller conflates the two.

## CARRY-OVER LIST

All items in the "KNOWN AND OPEN" list remain valid. No new items to add. The self-audit did not make any of them worse.

## VERDICT CHALLENGES

The self-audit's claims are correct:
1. `settledAsPayout` is the only site asking the cadence question — verified.
2. The DONE_MARKS list is derived from the detector, not hand-kept — verified.
3. The dust bound `dust < activated.length` holds — verified.
4. The settledAsPayout default direction is correct (not resetting pays sooner) — verified.
5. The arithmetic figures are correct — verified.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

The project should:
1. **Continue deriving lists from sources.** DONE_MARKS is parsed from the detector's predicate; the floors are read from `run-tests.sh`; the TARGETS drive the bundle. This pattern prevents the one-of-N-sites defect.
2. **Continue measuring rather than asserting.** The dust bound is measured at `available = denominator - 1`; the roster is chosen from measured performance; the context check uses a measured chars/token ratio. This prevents the "confident conclusion from an unverified constant" defect.
3. **Continue pinning every accepted and rejected finding as an assertion.** The selftest has arms for both directions of every claim. This prevents re-litigation.
4. **Continue running AI audits with different rosters.** The ship gate requires the second of two clean rounds to use a different roster. This prevents agreement-with-yourself.
5. **Continue maintaining the assertion floors as equality, not lower bounds.** The `-ge` check accumulated slack; the `-eq` check does not. This prevents the "floor 26% below reality" defect.
6. **Continue running the round twice (programs + offchain) with the TARGETS driving the bundle.** This prevents the "auditor answering from a diff hunk" defect.
7. **Continue verifying the roster before spending.** The `verifyRoster()` function checks model existence and capacity before any tokens are spent. This prevents the "fabricated model id" defect.
8. **Continue disqualifying readers with a whitelist of finish reasons.** Only `stop` is accepted; everything else is disqualified. This prevents the "provider refusal counted as auditor" defect.
9. **Continue checking that HEAD and the working tree did not move during the round.** This prevents the "reports describe the old tree" defect.
10. **Continue checking that every file named in the prompt is in the bundle.** This prevents the "auditor answering from a diff hunk" defect.

The project is doing all of these. The self-audit found four real defects and fixed them correctly. The one-of-N-sites pattern was avoided by deriving DONE_MARKS from the detector. The arithmetic is correct. The floors match. The gates prove what they claim.

The only structural weakness that remains is the AI process itself: ~1/3 of "CRITICAL" findings across fifteen rounds were wrong on measurement. The project answers this by converting every accepted and rejected finding into a permanent assertion, so nobody re-litigates and a future change that quietly makes a rejected claim TRUE turns the suite red. This is the right answer.