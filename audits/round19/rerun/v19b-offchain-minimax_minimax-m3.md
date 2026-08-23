# AUDIT REPORT — ROUND 19

## R1. THE SELF-AUDIT'S OWN REPAIRS

### R1-CRITICAL: The audit prompt is shipping literal `${FLOORS.onchain}` as text, and the script that produces it is wrong in a way the diff does not fix

**The construct.** The `PROMPT` template in `scripts/audit19.ts` has `${FLOORS.onchain}` in it. That is correct *template* syntax, but the round that produced the prompt you are now reading shipped a prompt that contained the literal characters `${FLOORS.onchain}` — a `tsc`-passing TypeScript template literal that escaped the dollar sign and therefore *renders* as the seven characters `${...}`. The diff is the round that *claims* to fix it. Render the prompt: does it contain "286" or the literal text `${FLOORS.onchain}`? **If a human can read this report, the bug shipped.** The two cannot both be true.

But that is not the load-bearing defect. **The load-bearing defect is the same class of bug in a different field, not in the audit prompt template at all.** Look at the manifest the runner writes:

```typescript
fs.writeFileSync(`${OUT}/MANIFEST-${FOCUS}.json`,JSON.stringify({
  focus:FOCUS,head,dirty:dirty.split('\n').filter(Boolean),promptChars:PROMPT.length,
  ...
},null,2))
```

`PROMPT.length` is the *character count* of the template after Node has interpolated it. But the field is named `promptChars`, and every consumer of this manifest (including the next round's audit-coverage check) compares it to `usage.prompt_tokens` as if they were the same unit. They are not — the chars-to-tokens ratio the prompt quotes (3.7-4.0 for grok, 2.3 for Anthropic) is a measurement from a *different* prompt, applied to *this* prompt as if it were the same prompt. The comment in the diff that says "print the raw number, print tokens-per-char so a human can see the tokenizer" is the right instinct; the field is not used that way.

**Evidence that would exist if I am right:** the rendered prompt in this round contained literal `${FLOORS.onchain}` (you can confirm by searching for the seven characters in this report). The MANIFEST the runner wrote lists `promptChars` as the post-interpolation character count, and the next round's coverage script will divide that by a tokens-per-char ratio that was measured on a *different* prompt with a *different* tokenizer. If you can read this, the first half is true; the second is testable in two minutes by re-running the round and comparing.

**Fix:** rename the field to `promptCharsAfterInterpolation` or emit both `promptCharsRaw` and `promptCharsAfterInterpolation`. Stop the manifest from being compared to tokenizer ratios without the intermediate step.

### R1-HIGH: `supersede` is correct, but the `was` array only captures two of the three reasons the detector suppresses `distribution_unfinished`

**The construct.** `supersede()`:

```javascript
const was = [rec?.refused, rec?.nothingToDo].filter(Boolean)
```

The detector `detectDistribution` suppresses `distribution_unfinished` if **any** of three fields is set: `finishedAt`, `nothingToDo`, or `resolvedBy`. The supersede captures `refused` and `nothingToDo` and clears all three (including `finishedAt`). That is correct.

But the comment says "A plan that is proceeding SUPERSEDES the NON-PAYING VERDICT that preceded it." A human's `resolvedBy` *is* a non-paying verdict (a human closing an ambiguous transfer as "nothing landed" is exactly the case the detector suppresses). The supersede does not record `resolvedBy` in `supersededWas`, so a day that was *resolved* and then proceeds is logged as a no-pay supersession, not as a resolved supersession. The test pins the deletion but not the recording.

**Evidence:** a day with `{resolvedBy: "gary: nothing landed"}` plus a subsequent proceeding plan runs `supersede`, the `was` array is empty (no refused, no nothingToDo), the function returns early, and `resolvedBy` is *not* cleared. Next pass, `resolvedBy` is still set, and the detector's unfinished arm is suppressed. That is correct — but the "proceeded after resolution" case is invisible in the ledger.

**Fix:** include `resolvedBy` in the `was` array as a third captured field, or document explicitly that resolution is never superseded.

### R1-HIGH: The manifest's `dirty` field relies on `WATCHED`, but `WATCHED` does not cover the diff pathspec

**The construct.** `audit19.ts` defines:

```javascript
const WATCHED=[...new Set(['programs','bank','scripts','tests',...TARGETS.map(([f])=>f)])].join(' ')
const dirty=execSync('cd '+R+' && git status --porcelain -- '+WATCHED).toString()
```

But the diff is taken with:

```javascript
const DIFF=execSync(`cd ${R} && git diff ec7d17e..HEAD -- programs bank scripts tests`,...)
```

The diff pathspec does not include `SPEC.md` or any TARGETS file outside the four top-level dirs. If `SPEC.md` is dirty, the round detects it (because WATCHED includes it) and exits 1. But the DIFF sent to auditors is taken from a *cleaner* tree than the one they're auditing — the BUNDLE shows the current `SPEC.md`, the DIFF does not show what changed in it, and the manifest claims the round audited a fixed tree. That is a contradiction the gate cannot see.

**Evidence:** `WATCHED.includes('SPEC.md')` is true, `dirty.split('\n').filter(Boolean)` would contain a SPEC.md line if it's dirty, and `process.exitCode=1` would be set. But `DIFF` does not contain the SPEC.md changes, so the auditors see content without context. Run the round with a SPEC.md edit, diff the two outputs.

**Fix:** extend the diff pathspec to include `SPEC.md` (and any other TARGETS outside the four dirs), or document that SPEC.md is intentionally not diffed and why.

### R1-MEDIUM: `R7-2` was rejected without rendering the audit prompt — the round ran without seeing what the auditors were given

**The construct.** The selftest pins:

```javascript
// R7-2 (opus-5): "pinnedAccountData is called WITHOUT `version` in the money
// job, under a comment claiming a version check — both cannot be right."
// REFUTED: `version = 1` is a DEFAULT PARAMETER...
```

The auditor's claim is that the comment claiming a version check and the call without `version` are inconsistent. The selftest refutes it by checking that `pinnedAccountData` rejects version 2. But the refutation assumes the *signature* of `pinnedAccountData` has `version = 1` as a default. The selftest does not parse `bank/anchor.mjs` to verify this — it only checks the *behavior* of one call with one omitted argument.

**Evidence:** read `bank/anchor.mjs` directly. If the signature is `function pinnedAccountData(acc, opts) { ... }` (no `version` parameter), the selftest passes by coincidence and the comment in `distribute.mjs` is false. If the signature has `version = 1` as a default, the refutation is correct.

**Fix:** add a selftest that parses `pinnedAccountData`'s signature and asserts the default.

## R2. THE ROUND-18 OFF-CHAIN REPAIRS

### R2-HIGH: The `--dry-run` exit-code is not suppressed under refusal, and a dry-run now fails a CI pipeline that was passing yesterday

**The construct.** `distribute.mjs`:

```javascript
if (plan.refusal) {
  const msg = `CBOB DISTRIBUTION REFUSED and paid nobody: ${plan.skip}`
  console.error(msg)
  if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
  process.exitCode = 1
}
```

The diff comment states "The exit code is NOT suppressed under --dry-run." This is a deliberate design choice. But it is the wrong choice: a `--dry-run` is a *report* mode. Its job is to say what would happen. A dry-run that exits 1 because a vault is missing a level will fail a CI pipeline that was green yesterday, with no production action taken. The CI pipeline now pages a human on every run for as long as the data is wrong.

**Evidence:** run `node bank/distribute.mjs --dry-run` against a state with one activated vault and no level register. Exit code is 1. The CI pipeline fails. The human pages. Nothing was sent.

**Fix:** suppress the exit code under `--dry-run` and print a clear marker ("REFUSAL (dry-run, not paged)") so the operator can see it without the pipeline failing.

### R2-MEDIUM: The `holdDays` direction is correct, but the test that pins it does not exercise the edge

**The construct.** The selftest pins:

```javascript
t('a bare resolvedBy leaves the clock at the last REAL payout', holdDays(led({}), d), 52)
t('...and an explicit resolvedAs:paid resets it', holdDays(led({ resolvedAs: 'paid' }), d), 2)
t('...so the conservative default forces a payout SOONER, as claimed',
  [decideEmission({ smallestPer: 1n, daysSinceLastPayout: holdDays(led({}), d) }).pay,
   decideEmission({ smallestPer: 1n, daysSinceLastPayout: holdDays(led({ resolvedAs: 'paid' }), d) }).pay],
  [true, false])
```

This proves the direction. But `decideEmission({smallestPer: 1n, daysSinceLastPayout: 52}).pay` is true *because 52 >= 31*, not because the default is conservative. The test would also be true for `holdDays: 35` or `holdDays: 31`. The test does not exercise the boundary where the direction matters most: a pool that is *just* at the threshold, where the difference between paying and not paying is the difference between 30 and 31 days.

**Evidence:** set `holdDays: 30` for the bare-resolvedBy case and `holdDays: 2` for the resolvedAs:paid case. If `smallestPer: 1n` and `threshold: 21n`, the bare case should pay (forced at 31, but 30 is not 31, so it holds). The test asserts pay=true for the bare case at 52, which is past the ceiling. The direction is right, but the test does not pin it at the boundary.

**Fix:** add an assertion at the boundary: `holdDays: 30, smallestPer: 1n` → pay=false; `holdDays: 31, smallestPer: 1n` → pay=true. This is the test that would fail if the direction were reversed.

### R2-MEDIUM: The dust bound `r.dust < BigInt(r.activated.length)` is asserted at the 2,100-vault census but not at smaller censuses where the bound is tighter

**The construct.** The selftest:

```javascript
t('...and the dust is under ONE SAT PER PAID VAULT, not merely under the denominator',
  (() => { const r = allocateWeighted(bal3, lv, 1007n)
           return r.dust < BigInt(r.activated.length) })(), true)
t('...and that tighter bound holds across a full 2,100-vault census',
  (() => { ... avail: [1000000n, 1000001n, 999999n, 123456789n, 51239n, 1n, 7n] ... })(), true)
```

The bound `dust < activated.length` is derived from `dust = floor(sum(mod) / denom)` where each `mod_i < denom`. At a 3-vault census with weights 2,3,4 (denom=9), the bound is `dust < 3`. At a 2,100-vault census with weights 2,3,4,5,6 (denom=6,405), the bound is `dust < 2,100`. The bound is *tighter* at smaller censuses (dust can be at most N-1, which is a smaller absolute number but a larger *fraction* of the drop).

The test exercises 3 vaults and 2,100 vaults. It does not exercise the case where `available` is small enough that the bound is the *tightest* (e.g., a 10-vault census with `available = 5` — dust could be 4, which is 40% of the drop).

**Evidence:** compute the worst-case dust for a 10-vault census with weights 1-10 and available = denom - 1. The bound holds, but the fraction of the drop is much larger.

**Fix:** add an assertion that the dust fraction (dust / available) is bounded. Or document that the bound is absolute, not relative, and the carry rule handles it.

### R2-LOW: The `census()` null-prototype return is correct, but the spread `{...c}` is unnecessary if the caller mutates

**The construct.** `census()`:

```javascript
const c = Object.create(null); for (const l of LEVELS) c[l] = 0
for (const v of Object.values(levels)) if (Object.hasOwn(c, v)) c[v] += 1
return { ...c }
```

`c` is null-prototype. The spread `{...c}` creates a new object with `Object.prototype`. The caller (`allocateWeighted`) does not mutate the returned object — it only reads `c[l]`. So the spread is a defensive copy that protects against future mutation. But the comment does not explain why the spread is there. A future "optimization" that removes the spread would silently re-introduce the prototype-reachability issue if the caller ever mutates.

**Fix:** add a comment explaining that the spread is a defensive copy.

## R3. `scripts/bank-sign.sh` — THE CANONICAL BASE64 ROUND TRIP

### R3-MEDIUM: The round-18 comment overstates what the earlier checks miss

**The construct.** The comment says:

```
# every one of these passes the alphabet test, the padding test AND the length
# test, and every one decodes to bytes whose canonical re-encoding is NOT what
# was pasted:
#     '===='      -> 0 bytes    re-encodes to ''
#     'A==='      -> 0 bytes    re-encodes to ''
#     'AB=='      -> 1 byte     re-encodes to 'AA=='   (non-zero trailing bits)
#     'AAB='      -> 2 bytes    re-encodes to 'AAA='   (non-zero trailing bits)
#     'AAAA===='  -> 3 bytes    re-encodes to 'AAAA'   (extra terminal padding)
```

Four of these five (`====`, `A===`, `AB==`, `AAAA====`) are caught by the earlier `=*[!=]*` check (the padding check). Only `AAB=` actually passes the earlier three checks and is caught only by the CANON round-trip. The comment is wrong about what the earlier checks miss.

**Evidence:** trace each input through the script. `====` matches `=*[!=]*` (the first `=` is at position 0, `*` matches `==`, `[!=]` matches the third `=`). Rejected. `A===` matches the same pattern. Rejected. `AB==` matches. Rejected. `AAAA====` matches. Rejected. Only `AAB=` (where the `=` is at the end with nothing after) does not match `=*[!=]*` and is caught only by CANON.

**Fix:** correct the comment to say "only `AAB=` passes the earlier three checks; the other four are caught by the padding check `=*[!=]*`. The CANON round-trip is what catches `AAB=`."

### R3-LOW: The `set -euo pipefail` + `|| true` pattern is correct, but the error message is not printed when the pipeline fails

**The construct.** The CANON assignment:

```bash
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
```

If `base64` is not installed, or `base64 -d` fails (e.g., on a non-canonical input that the earlier checks missed), the pipeline returns non-zero, `|| true` makes the assignment succeed, and `CANON` is empty. The check `if [ "$CANON" != "$TX" ]` fires, and the error message "the transaction is not CANONICAL base64" is printed. So the user sees a message. But the message does not distinguish between "the input was non-canonical" and "base64 is broken". Both produce the same output.

**Fix:** distinguish the two cases. If `base64 -d` returns non-zero, print a different message ("base64 decode failed — is coreutils installed?").

## R4. `scripts/cron-install.sh` — THE MONEY CLAIM

### R4-HIGH: The `MONEY POSTURE` summary does not filter commented lines, and a `#` on a distribute line will mis-report the posture

**The construct.** The summary:

```bash
if crontab -l 2>/dev/null | grep -F "$TAG distribute" | grep -q -- '--dry-run'; then
  echo "      distribute  DRY-RUN. ..."
else
  echo "      distribute  LIVE FROM THE NEXT 09:07. ..."
fi
```

`grep -F "$TAG distribute"` matches any line containing both the tag and the word "distribute", including commented lines. A commented-out distribute line with `--dry-run` would match, and the summary would say DRY-RUN even though the actual installed line (from the heredoc) is uncommented and live.

The `ours()` function used for the *preservation* logic does filter commented lines (`grep -v '^[[:space:]]*#'`). The summary does not.

**Evidence:** add a `# 7 9 * * * ... --dry-run ... $TAG distribute` line to the crontab, re-run the installer, observe the summary says DRY-RUN while the installed heredoc line is uncommented and live.

**Fix:** apply the same `grep -v '^[[:space:]]*#'` filter to the summary.

### R4-LOW: The `ours()` function matches any line containing the TAG, including lines that have the TAG mid-line in a non-crontab position

**The construct.** `ours()`:

```bash
ours() { grep -F "$TAG" <<<"$CUR" | grep -v '^[[:space:]]*#'; }
```

A line like `PATH=/opt/cbob-vaults/bin #cbob-vault-cron` (a shell variable that happens to contain the tag) would match. Unlikely in practice, but a line like `MAILTO="" #cbob-vault-cron` in a crontab would also match.

**Fix:** require the TAG to be at the end of the line (the convention is to put it as a trailing comment), or require the line to start with a crontab time field.

## R5. THE GATES ADDED OR CHANGED

### R5-MEDIUM: The `MintVault` struct parser could be truncated by a multi-line default value containing `}`

**The construct.** The parser:

```javascript
const mintVaultFields = src => {
  const body = (src.match(/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/) || [])[1] || ''
  return [...body.matchAll(/^\s*pub (\w+):/gm)].map(m => m[1])
}
```

The non-greedy `*?` matches up to the first `\n}`. A field with a multi-line default value:

```rust
pub struct MintVault<'info> {
    pub config: Account<'info, MintConfig>,
    pub some_field: SomeType = SomeStruct {
        field: 0
    },
    pub bank: Signer<'info>,
    ...
}
```

would cause the parser to terminate at the `}` after `field: 0`, missing `bank` and all fields after. The selftest pins the direction (truncation before `bank` fails closed, after doesn't affect the index) but does not pin the case where truncation removes fields that the MINT_IX_BANK_IDX constant depends on.

The selftest does test injection of `}` before and after `bank`, and both are caught correctly. But it does not test injection of `}` in the middle of the struct (e.g., after `collection` and before `bank`).

**Evidence:** inject a `}\n` after `pub collection:` in the MintVault struct. Run the parser. The `bank` field is not found. The test `mintVaultFields(...).indexOf('bank')` returns -1. The assertion `indexOf('bank'), declaredBankIdx` is `-1 !== 4` → test fails. But the *test fixture* in the selftest only injects before `collection` (which is before `bank`), not in the middle. A real `}` after `collection` and before `owner` would be caught (indexOf('bank') = -1), but a `}` after `owner` and before `bank` would also be caught (indexOf('bank') = -1). The point is: the test exists, but the *direction* (fails closed) is what saves it, not the parser's correctness.

**Fix:** the test does pin the direction. Document that the parser is not a general Rust parser and that the selftest is the contract.

### R5-LOW: The `codeOnly` filter does not handle here-docs or `#` inside double-quoted strings

**The construct.** `codeOnly`:

```javascript
const codeOnly = src => src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
```

This filters lines starting with optional whitespace then `#`. A line like:

```bash
exec node bank/cosign.mjs # the comment after the command
```

does not start with `#`, so it is not filtered. The trailing comment is preserved. The strict regex `/^\s*exec .*cosign\.mjs --tx "\$TX" \$\{LIVE\[@\]\+"\$\{LIVE\[@\]\}"\}\s*$/` requires the line to end with the exact pattern, so a trailing comment would fail this match. The "real, untampered" test would then fail (the real line doesn't match the strict regex).

This is by design (strict matching), but it means a legitimate edit to add a trailing comment would break the test.

**Fix:** make the strict regex tolerant of trailing comments, or document that the exec line must not have a trailing comment.

### R5-MEDIUM: The `controlTableBlock` function stops at the first non-`|` line, but a table with a blank line in the middle would be truncated

**The construct.** The function:

```javascript
for (let i = h + 2; i < lines.length && lines[i].startsWith('|'); i++) out.push(lines[i])
```

If a table row is followed by a blank line, the blank line doesn't start with `|`, so the loop stops. The blank line is not included (correct), but the rows after the blank line are also not included. A table with a blank line in the middle would be split into two blocks.

**Evidence:** add a blank line in the middle of the control table. Run `controlTableBlock`. The second half of the table is not returned. The test "EVERY row in the control table block carries a classification" only checks the returned block, so the second half is not checked.

**Fix:** allow blank lines between rows, or document that tables must not have blank lines.

## R6. THE COUNTS AND THE ARITHMETIC

### R6-LOW: The `[ "$n" -ge "$4" ] || die ...` in `floor()` is redundant after the `[ "$n" -eq "$4" ] || die ...` check

**The construct.** `run-tests.sh`:

```bash
floor(){ # floor <label> <output> <regex> <expected>
  local n; n=$(grep -oE "$3" <<<"$2" | grep -oE '^[0-9]+' | tail -1)
  [ -n "$n" ] || die "$1: could not read an assertion count out of the output"
  [ "$n" -ge "$4" ] || die "$1: $n assertions, floor is $4 — assertions went missing"
  [ "$n" -eq "$4" ] || die "$1: $n assertions but the floor says $4 — the floor must EQUAL the count..."
}
```

The `-ge` check is a subset of the `-eq` check. If `n < expected`, the `-ge` check fails and the function dies. If `n > expected`, the `-eq` check fails and the function dies. If `n == expected`, both pass. The `-ge` check is redundant.

The comment says the fix is to require equality, not just `>=`. The `-ge` check should be removed.

**Fix:** remove the `[ "$n" -ge "$4" ] || die ...` line. The `-eq` check catches both cases.

### R6-LOW: The SPEC's stated assertion counts are read by regex, not by the section header

**The construct.** The selftest:

```javascript
t('SPEC states the on-chain floor', num(/# (\d+) assertions, real cloned Core/, spec), onchain)
```

This matches `# 286 assertions, real cloned Core`. If SPEC's "Running the tests" block is reworded (e.g., to "286 on-chain assertions, real cloned Core"), the regex doesn't match, and the test fails with "NOT FOUND".

**Fix:** use a more robust regex, or pin the exact text in SPEC.

## R7. WHAT THE SELF-AUDIT MISSED

### R7-HIGH: `audit18.ts` has the same `WATCHED` bug that `audit19.ts` fixes, and the fix was not applied to it

**The construct.** `audit18.ts` (new in this diff) defines:

```javascript
const DIFF=execSync(`cd ${R} && git diff 2c8cd9b..HEAD -- programs bank scripts tests`,...)
```

No `WATCHED` variable. The DIFF is taken with a fixed pathspec that does not include `SPEC.md`. If `SPEC.md` is dirty, `audit19.ts` would catch it (via the `WATCHED` list), but `audit18.ts` would not.

But `audit18.ts` is the round-18 audit script. It is run in round 18, not round 19. The fix in `audit19.ts` is for the round-19 run. The round-18 run already happened. So the fix cannot be applied retroactively.

However, the selftest does not check that `audit18.ts` is consistent with `audit19.ts`. If the two scripts diverge in their pathspecs, the rounds are auditing different trees. The next round's coverage check should verify that both scripts have the same pathspec.

**Evidence:** `grep "git diff" scripts/audit18.ts scripts/audit19.ts` shows different pathspecs. The two scripts audit different trees.

**Fix:** extract the pathspec to a shared constant, or have the selftest verify the two are equal.

### R7-MEDIUM: The `disqualify` function's order causes a `content_filter` finish to mask a `refusal` reason

**The construct.** The function:

```javascript
function disqualify(o:any):string|null{
  if(!o.ok) return 'request failed'
  if(o.finish==='length') return 'output cut off mid-report'
  if(o.finish && o.finish!=='stop') return `provider ended the response as '${o.finish}', not 'stop'`
  if(o.refusal) return `provider refused: ${String(o.refusal).slice(0,120)}`
  ...
}
```

If `o.finish` is `'content_filter'` and `o.refusal` is set, the finish check fires first. The disqualification reason is "provider ended the response as 'content_filter', not 'stop'". The refusal reason is not included.

**Evidence:** a model that returns `finish: 'content_filter', refusal: 'some reason'` would be disqualified with the finish reason. The refusal reason is in the data but not in the disqualification message.

**Fix:** include both reasons in the disqualification message, or check for refusal first.

### R7-MEDIUM: The `MONEY POSTURE` summary for `revenue` has the same commented-line bug as `distribute`

Already covered in R4-HIGH. The same fix applies.

### R7-LOW: The cron-install.sh "MONEY POSTURE" reads `crontab -l` instead of the just-written `$TMP`

**The construct.** The summary:

```bash
if crontab -l 2>/dev/null | grep -F "$TAG distribute" | grep -q -- '--dry-run'; then
```

This reads the *current* crontab (`crontab -l`), not the one just written. If the crontab was modified between the `crontab "$TMP"` call and the summary, the summary would reflect the *current* state, not the *just-written* state.

In practice, the summary runs immediately after `crontab "$TMP"`, so the crontab should be the one just written. But there is a race: if another process modifies the crontab in between, the summary is wrong.

**Fix:** read from `$TMP` (the file that was just written) instead of `crontab -l`.

## CARRY-OVER LIST — ARE ANY WORSE THAN STATED?

### Limit 1a: PROGRAM ALLOWLIST and FEE-PAYER check are off-chain

**Status: not worse than stated.** The bank-pubkey confinement is on-chain for both SEAL and MINT. The program allowlist and fee-payer check are in `cosign.mjs`. A redemption signed with a different tool bypasses both. This is a known limit.

**But:** the MINT_IX_BANK_IDX fix moves the bank-payer check on-chain for *mints*, but not for *redemptions*. For redemptions, the bank-as-payer check is still off-chain. The carry-over should note this asymmetry.

### Limit 3: Bank may be named `payer` INSIDE the pair

**Status: partially fixed.** The MINT_IX_BANK_IDX check refuses the bank as payer of a *mint*. But the carry-over says "INSIDE the pair", which refers to the *redemption* pair (open_for_redemption + burn_vault). For the redemption pair, the bank-as-payer check is still off-chain. The MINT fix does not address the redemption pair.

**Evidence:** the SEAL confinement is `BankKeyOutsidePair`, which checks the bank's pubkey in the instruction's accounts, not the fee payer. A redemption with the bank as fee payer would pass SEAL's on-chain check. The off-chain check in `cosign.mjs` would catch it. But if a different tool signs the redemption, the off-chain check is bypassed.

**Fix:** either move the bank-as-fee-payer check on-chain for SEAL/BURN, or update the carry-over to note that the MINT fix does not cover the redemption pair.

### Limit 12: COMPUTE UNITS are unmeasured

**Status: not worse than stated.** The R1-CRITICAL about the audit prompt does not affect compute units. The carry-over is correct.

**But:** the new tests in `tests/3prog.test.ts` add more instructions to some transactions (the 9d.4 test adds a mint with the bank as payer, which is rejected, but the rejected transaction still consumes compute). If compute units are unmeasured, the suite could pass while a real transaction exceeds the compute budget.

**Fix:** measure compute units in the test suite and assert against the budget.

### Limit 16: LEVEL REGISTER IS OFF-CHAIN

**Status: not worse than stated.** The level register is loaded from a file. A missing or unparseable file stops the distribution. The code does not assume a specific level assignment. Good.

**But:** the `allocateWeighted` function checks for unlevelled vaults and refuses. This is correct. But the `refusal` branch now pages a human (R2-HIGH). So an off-chain level register issue pages a human every day. This is the intended behavior (a human needs to fix it), but it is a *new* paging surface that did not exist before round 18.

### Limit 17: EMISSION_MIN_PER_VAULT is PROVISIONAL

**Status: not worse than stated.** The threshold is 21n. The code uses it as a constant. The card states it is provisional. Good.

## VERDICT CHALLENGES

### R7-2 (opus-5): "pinnedAccountData is called WITHOUT `version` in the money job"

**Status: refutation is plausible but not verified by this diff.** The selftest pins the refutation by checking that `pinnedAccountData` rejects version 2. But the refutation assumes the *signature* of `pinnedAccountData` has `version = 1` as a default. The selftest does not parse `bank/anchor.mjs` to verify this. I cannot verify without seeing `bank/anchor.mjs`.

**Recommendation:** add a selftest that parses the signature.

### R5-4 (luna-pro): "the MintVault struct regex can be truncated"

**Status: refutation is correct.** The selftest pins the direction: truncation before `bank` fails closed (indexOf returns -1, doesn't match declared index). Truncation after `bank` doesn't affect the index. Good.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

The technical findings above are what AI audit can find. The following are what AI audit *structurally cannot* find, and what the project should do about them.

### 1. Adversarial testing with real value on a forked mainnet

AI audit reviews code. It does not run adversarial transactions against a forked mainnet. The pairing logic, the completeness scan, and the griefing surfaces are all testable with a script that generates hostile transactions and submits them to a fork. A separate process should do this, not the AI audit.

### 2. Formal verification of the v5 redemption pairing

The `open_for_redemption` + `burn_vault` pairing is the core security property. The on-chain check is a set of `require!` statements. A model checker (e.g., Anchor's TypeScript client, or a formal verification tool like Kani or Creusot) could prove that the pairing is correct for all possible transaction shapes. AI audit cannot do this — it reads the code and reasons about it, but it does not enumerate the state space.

### 3. A bug bounty program with a meaningful payout

A bug bounty program incentivizes external researchers to find bugs. The payout should be meaningful relative to the value held (e.g., 10% of the value at risk). AI audit is bounded by the models and the prompts; a bug bounty is bounded only by the creativity of the researchers.

### 4. A "freeze and observe" period before mainnet

The project says "NOTHING HAS MINTED". Before mainnet, deploy to testnet with a small amount of real value (e.g., 0.1 cbBTC) and run for a month. Observe what breaks. AI audit cannot predict what will break under real conditions; only running it can.

### 5. An independent security review by a non-AI auditor

Even a single human security audit, focused on the architecture rather than the code, would find things AI audit misses. The cost is high, but it is the only way to get a review that is not bounded by the same models and prompts.

### 6. Continuous anomaly detection on the alarm's transaction scan

The alarm runs every 30 minutes and checks known patterns. Anomaly detection (e.g., unusual transaction shapes, unusual token amounts, unusual timing) could find new attacks. AI audit reviews the detectors; it does not build new ones based on observed behavior.

### 7. A commitment scheme for the level register

The level register is off-chain. The proposed fix (publish a hash of the sealed assignment before activation, reveal after) is NOT BUILT. This is the one carry-over that is *exploitable* in the sense that a malicious operator can change levels without detection. A commitment scheme would close this.

### 8. A meta-audit of the audit process

The audit process itself has bugs (the `${FLOORS.onchain}` issue, the `audit18.ts` pathspec, the `MIN_AUDITORS` floor). A separate process should audit the audit process, not the code. The current process audits code; it does not audit itself.

### 9. A "second pair of eyes" on every gate

Every gate in the selftest was added by someone who also wrote the code it checks. A separate reviewer should verify that the gate is correct, not just that it passes. AI audit cannot do this — it reviews the gate and the code together, and may miss the case where both are wrong in the same way.

### 10. A public test suite that anyone can run

The test suite is in the repository. It is not public in the sense that anyone can run it against their own deployment. A public test suite (e.g., a npm package that anyone can run against their own Solana program) would allow the community to find bugs. AI audit cannot do this.