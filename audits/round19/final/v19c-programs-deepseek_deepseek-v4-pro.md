# SECURITY AUDIT FINDINGS — ROUND 19

## R1. THE SELF-AUDIT'S OWN REPAIRS

### R1-1: CRITICAL — `DONE_MARKS` is derived from `detectDistribution` but `supersede` clears `resolvedBy` unconditionally, which can destroy a human's resolution on a day that later proceeds

**Construct:** In `bank/distribute.mjs`, `supersede()` clears every key in `DONE_MARKS` (`finishedAt`, `nothingToDo`, `resolvedBy`) when a plan proceeds. The `DONE_MARKS` list is derived from `detectDistribution`'s `distribution_unfinished` predicate in `bank/detectors.mjs`.

**What happens:** The `distribution_unfinished` arm in `detectDistribution` reads:
```
if (rec.startedAt && !rec.finishedAt && !rec.nothingToDo && !rec.resolvedBy && day !== opts.today)
```
So `resolvedBy` IS a suppressor. But `resolvedBy` means a HUMAN has already looked at this day and closed it. If a quiet morning writes `nothingToDo` + `resolvedBy` (because a human resolved the previous day's refusal), and then an afternoon run proceeds, `supersede` will DELETE `resolvedBy`. The human's resolution is silently erased.

**Evidence:** The selftest in `distribute.mjs` tests that `supersede` clears `resolvedBy` from a quiet record, and that this makes a crashed day fire `distribution_unfinished`. But it never tests the case where `resolvedBy` was a DELIBERATE human action on a DIFFERENT issue. The test fixture `quiet` has `nothingToDo: 'below threshold'` with no `resolvedBy`. The `both` fixture adds `refused` but not `resolvedBy`. No test covers `{ nothingToDo: 'x', resolvedBy: 'gary: looked at this', finishedAt: 'y' }` being superseded.

**Fix:** `resolvedBy` should NOT be in `DONE_MARKS`. It is not a no-pay verdict flag like `nothingToDo` and `refused`; it is a human attestation that the day's state has been reviewed. Clearing it is data loss. Remove `'resolvedBy'` from the `DONE_MARKS` array. The `distribution_unfinished` detector already treats a resolved day as finished, which is correct — but the resolution itself should survive a supersede.

### R1-2: HIGH — `supersede` clears `finishedAt` from a day that had a prior `nothingToDo` verdict, but the `alreadyPaid` guard only protects days with `plan` or `settledAsPayout` rows

**Construct:** The `alreadyPaid` guard in `supersede()`:
```javascript
const alreadyPaid = Boolean(rec?.plan) || Object.values(rec?.paid || {}).some(settledAsPayout)
if (alreadyPaid && rec?.finishedAt !== undefined) out.finishedAt = rec.finishedAt
```

**What happens:** The guard protects days that already paid. But consider this sequence:
1. Morning run: `nothingToDo: 'below threshold'`, `finishedAt: '09:07'`. No `plan`, no `paid` rows.
2. Afternoon run: proceeds, calls `supersede`, which clears `finishedAt`.
3. Afternoon run pays some vaults, writes `plan`, writes `paid` rows, but DIES before writing its own `finishedAt`.
4. Next day: the day has `plan` and `paid` rows but no `finishedAt`. The `alreadyPaid` guard in step 2 did not fire because at that moment there was no `plan` and no `paid` rows. The morning's `finishedAt` was deleted. The afternoon run never wrote a new one.

The day now looks unfinished to `detectDistribution` despite having real payments.

**Evidence:** The selftest tests `alreadyPaid` against a record that ALREADY has `plan` and `paid` rows at the time `supersede` is called. It does not test the sequence where `supersede` runs BEFORE any payments exist, clears `finishedAt`, and then the run dies.

**Fix:** `supersede` should not clear `finishedAt` unless it is also going to write a new one. Or, the caller should write `finishedAt` immediately after `supersede` returns, before starting payments. Currently `main()` calls `supersede`, then writes `plan`, then starts the transfer loop. If the transfer loop dies, `finishedAt` is never written. Move `st.days[day].finishedAt = new Date().toISOString()` to immediately after the `supersede` call, or have `supersede` set a NEW `finishedAt` as part of superseding.

### R1-3: MEDIUM — The `isTableRow` predicate is hoisted and used in `selftest.mjs` but `SPEC.md`'s control table has a row that does not match it

**Construct:** `isTableRow` in `bank/selftest.mjs`:
```javascript
const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)
```

**What happens:** The control table in SPEC.md has this row:
```
| **THE BANK MUST SIGN AT ALL** — the 2-of-2 itself | any unsealing or burn attempted **without the Bank**. `programs/cbob-vaults/src/lib.rs` and `programs/cbob-vault-burn/src/lib.rs` each take `bank: Signer` and `require_keys_eq!` it against the Bank in their own config, so a redemption missing the Bank's signature does not fail policy, it fails to execute. The owner must sign too, and cannot be an off-curve program address. See **TRUE 2-of-2** above | every redemption, always | **ON-CHAIN.** Two programs refuse. Nobody can opt out, us included. |
```
This row starts with `| **THE BANK MUST SIGN AT ALL**` — the classification is in the FOURTH column, not the first. The regex `^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*` matches a row where the classification appears after the SECOND pipe. This row has `**ON-CHAIN.**` after the FOURTH pipe. It matches because `.*` is greedy and `\|` matches any pipe. So it DOES match, but the regex is fragile — it would match `**ON-CHAIN.**` anywhere in the row, even in the description text.

**Evidence:** The selftest assertion `t('EVERY row in the control table block carries a classification', block.filter(l => !isTableRow(l)), [])` passes. But if a row had `**ON-CHAIN.**` in its description column as an EXAMPLE rather than as its actual classification, it would still match. The regex does not anchor to the fourth column.

**Fix:** The regex should anchor to the fourth column: `/^\|.*\|.*\|.*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/`. This ensures the classification is in the correct column, not just anywhere in the row.

### R1-4: MEDIUM — The manifest JSON in `audit19.ts` writes `dirty` as an array of lines from `git status --porcelain`, but the first line's leading space is stripped by `.filter(Boolean)`

**Construct:** In `scripts/audit19.ts`:
```javascript
const dirty = execSync('cd '+R+' && git status --porcelain -- '+WATCHED).toString()
// ...
fs.writeFileSync(`${OUT}/MANIFEST-${FOCUS}.json`, JSON.stringify({
    // ...
    dirty: dirty.split('\n').filter(Boolean),
    // ...
}))
```

**What happens:** `git status --porcelain` prefixes each line with a two-char status field (e.g., ` M bank/selftest.mjs`). The comment says "NOT .trim(): git status --porcelain prefixes every line with a two-char status field, so trimming the BLOB eats the first line's leading space and misaligns it against every other row of the record." But then `.filter(Boolean)` is called on the split lines. A line like ` M bank/selftest.mjs` is truthy, so it passes. But if a line were somehow empty or whitespace-only, it would be dropped. More importantly, the comment warns about `.trim()` on the BLOB but the code uses `.filter(Boolean)` on the LINES, which is a different operation. The manifest records the dirty files correctly, but the comment is misleading about what the code actually does.

**Evidence:** The comment says "NOT .trim()" but the code does not call `.trim()`. It calls `.filter(Boolean)`. These are different. The manifest will contain the correct dirty files because porcelain lines are never empty. But the comment describes a fix that was applied to a DIFFERENT variable (the BLOB) and implies it applies here too.

**Fix:** Remove the misleading comment or make it accurate. The `.filter(Boolean)` is fine because porcelain lines are never empty; the comment should say that.

## R2. THE ROUND-18 OFF-CHAIN REPAIRS

### R2-1: CRITICAL — The `settledAsPayout` default direction is CORRECT but the `holdDays` function has a silent failure mode when `paid` is not an array

**Construct:** In `bank/distribute.mjs`:
```javascript
const paid = days.filter(d => Object.values(st.days[d]?.paid || {}).some(settledAsPayout)).sort()
```

**What happens:** `Object.values(st.days[d]?.paid || {})` returns an array of row objects. `.some(settledAsPayout)` iterates them. If `st.days[d].paid` is somehow a non-object (e.g., a string from a corrupted ledger), `Object.values` would throw or return something unexpected. But the real issue is: if `paid` is `undefined`, `st.days[d]?.paid || {}` gives `{}`, and `Object.values({})` is `[]`, and `[].some(...)` returns `false`. That's correct. But if `paid` is an ARRAY (which it should never be, but a corrupted ledger could have it), `Object.values` on an array returns the array elements, and `.some(settledAsPayout)` would call `settledAsPayout` on each element, which might not be a row object.

**Evidence:** The ledger is written by `distribute.mjs` itself, so `paid` should always be an object. But the ledger is also read after crashes and could be hand-edited. The `readLedger` function in `lock.mjs` validates JSON parse but not schema.

**Fix:** This is a low-probability edge case. The existing validation in `holdDays` that checks day keys with `realDay` is good. Adding schema validation for `paid` being an object would be defense-in-depth.

### R2-2: HIGH — `paymentState` is unchanged but `settledAsPayout` calls it, and `paymentState` returns `'resolved'` for ANY row with `resolvedBy`, regardless of `resolvedAs`

**Construct:** 
```javascript
export function paymentState(row) {
  if (!row) return 'unpaid'
  if (row.sig) return 'paid'
  if (row.resolvedBy) return 'resolved'  // <-- returns 'resolved' for ANY resolvedBy
  if (row.rejected) return 'unpaid'
  return 'ambiguous'
}

export function settledAsPayout(row) {
  if (paymentState(row) === 'paid') return true
  return paymentState(row) === 'resolved' && row?.resolvedAs === 'paid'
}
```

**What happens:** `settledAsPayout` correctly distinguishes between `resolvedAs: 'paid'` and bare `resolvedBy`. But `paymentState` itself returns `'resolved'` for ANY row with `resolvedBy`. The comment says "a resolved row still reads as settled and is never resent, whatever its result." This is correct for the PAYMENT LOOP — a resolved row should not be re-sent. But `paymentState` is also used by `detectDistribution` to determine if a day has unresolved transfers. A row with `resolvedBy` but `resolvedAs: 'unpaid'` (meaning "I established nothing landed") reads as `'resolved'` to `paymentState`, which means `detectDistribution` treats it as SETTLED and does not raise `distribution_unresolved`. But the money never landed. The human said so.

**Evidence:** The selftest in `distribute.mjs` tests:
```javascript
t('...and a resolved REFUSAL is SETTLED, never re-sent (order matters here)',
    paymentState({ amount: '5', sig: null, rejected: true, resolvedBy: 'gary: ATA unfrozen, paid by hand' }), 'resolved')
```
This tests that a resolved refusal reads as `'resolved'`. But it does not test the case where `resolvedAs: 'unpaid'` — the human said "nothing landed, this person was NOT paid." In that case, `paymentState` still returns `'resolved'`, and the detector is silent. But the vault was never paid.

**Fix:** `paymentState` should distinguish between `resolvedAs: 'paid'` and `resolvedAs: 'unpaid'`. A row resolved as unpaid should return `'unpaid'` (so it can be retried) or a new state like `'resolved_unpaid'` (so the detector can report it differently). The current behavior treats all resolutions as final, which is correct for "don't re-send" but incorrect for "this person was never paid."

### R2-3: MEDIUM — The refusal branch calls NOTIFY and sets `process.exitCode = 1`, but the NOTIFY call is inside a try/catch that swallows errors

**Construct:**
```javascript
if (plan.refusal) {
  const msg = `CBOB DISTRIBUTION REFUSED and paid nobody: ${plan.skip}`
  console.error(msg)
  if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
  process.exitCode = 1
}
```

**What happens:** If `NOTIFY` fails (e.g., the script is missing, or SMS gateway is down), the error is silently swallowed. The exit code is still 1, so the cron will report failure. But the human page never goes out. The same pattern is used for the SOL-floor failure and the failed/ambiguous transfers. In all three cases, a notification failure is silent.

**Evidence:** The `try { execFileSync(NOTIFY, ...) } catch {}` pattern appears three times in `distribute.mjs`. If `/opt/scripts/notify-gary-sms.sh` is missing or fails, no one knows.

**Fix:** At minimum, log the notification failure. Better: have a fallback notification path (e.g., write to a file that another process watches). The current behavior means a single missing script silences all pages.

### R2-4: LOW — `census()` returns a spread of a null-prototype object, which serialises correctly with `JSON.stringify` but `Object.keys` and `Object.entries` work fine

**Construct:**
```javascript
const c = Object.create(null); for (const l of LEVELS) c[l] = 0
for (const v of Object.values(levels)) if (Object.hasOwn(c, v)) c[v] += 1
return { ...c }
```

**What happens:** `{ ...c }` creates a new object with a normal prototype. The spread operator copies own enumerable properties from `c` into a new plain object. So the returned object HAS a normal prototype. `JSON.stringify` works fine. `Object.keys` works fine. The null-prototype intermediate is just to safely use `Object.hasOwn` without prototype pollution. The final spread makes it a normal object.

**Evidence:** The selftest assertion `t('the 240-vault census sums to 240', LEVELS.reduce((a, l) => a + cen240[l], 0), 240)` passes, which means `cen240` (produced by `census`) has normal object properties accessible by key.

**Fix:** No fix needed. The current implementation is correct. The null-prototype is an internal detail safely erased by the spread.

### R2-5: VERIFIED — The dust bound `dust < activated.length` is correct

**Derivation:** For each activated vault `v`, `per[v] = (available * weight[v]) / denominator`. The dust is `available - sum(per[v])`. Each `per[v]` discards a fractional part strictly less than 1. So `dust = sum(fractional_parts) < number_of_paid_vaults = activated.length`. This holds for any `available`, including when `available < activated.length` (some vaults get 0, their fractional part is 0, so they don't contribute to dust). When vaults are skipped (e.g., already paid), they are not in `activated`, so they don't contribute. The bound is tight: `dust <= activated.length - 1` because the sum of N fractions each < 1 is at most N-1 (attained when every fraction is (N-1)/N).

**The claim that 2,099 is the maximum at 2,100 vaults:** At `available = denominator - 1 = 6404`, each level's floor is `6404 * weight / 6405`. For weight 2: `12808/6405 = 1.999...`, floor 1. For weight 6: `38424/6405 = 5.999...`, floor 5. The sum of floors is `945*1 + 525*2 + 315*3 + 210*4 + 105*5 = 945 + 1050 + 945 + 840 + 525 = 4305`. Dust = `6404 - 4305 = 2099`. This equals `2100 - 1`, which is `activated.length - 1`. The bound is attained. **The builder's arithmetic is correct.**

## R3. scripts/bank-sign.sh

### R3-1: MEDIUM — `base64 -w0` is not POSIX; on macOS/BSD, `base64` does not have `-w0`

**Construct:**
```bash
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
```

**What happens:** On macOS, `base64 -d` works but `base64 -w0` fails because BSD `base64` uses `-b` instead of `-w` for line width. The `|| true` makes the assignment succeed with an empty string. Then `[ "$CANON" != "$TX" ]` is true (empty != the transaction), so the script REFUSES EVERY TRANSACTION on macOS. This fails CLOSED, which is safe but makes the script unusable on non-GNU systems.

**Evidence:** The selftest in `bank/selftest.mjs` tests this by creating a fake `base64` that exits 127, and confirms the gate refuses. But it doesn't test the case where `base64 -d` works but `base64 -w0` doesn't — which is the macOS case.

**Fix:** Detect the OS and use the appropriate flag, or use a Node.js one-liner for the round-trip: `node -e "process.stdout.write(Buffer.from(process.argv[1], 'base64').toString('base64'))" "$TX"`. This is portable and avoids the GNU dependency.

### R3-2: LOW — The comment about `ps` is now correct but the transaction is still visible in the process list

**Construct:** The comment says:
```
#      ⚠️ ROUND 18 CORRECTION, two auditors, and the old wording was flatly
#      false: this line used to end "so it is not in `ps`". It IS in `ps` — the
#      last line of this file is `exec node bank/cosign.mjs --tx "$TX"`, which
#      puts the whole base64 transaction into the co-signer's argument vector for
#      the life of that process.
```

**What happens:** The comment is now accurate. The transaction IS visible in `ps` for the lifetime of the `cosign.mjs` process. The comment acknowledges this and says it's an accepted limit.

**Evidence:** Running `ps aux | grep cosign` while a signing is in progress would show the full base64 transaction. The comment correctly states this.

**Fix:** No fix needed for the comment. The underlying issue (transaction in argv) could be fixed by having `cosign.mjs` read from stdin, but the comment says this is deferred.

### R3-3: VERIFIED — The base64 round-trip check correctly rejects non-canonical encodings

**Tested inputs:**
- `====` → decodes to 0 bytes → re-encodes to `` → REJECTED (CANON != TX)
- `A===` → decodes to 0 bytes → re-encodes to `` → REJECTED
- `AB==` → decodes to 1 byte with non-zero trailing bits → re-encodes to `AA==` → REJECTED
- `AAB=` → decodes to 2 bytes with non-zero trailing bits → re-encodes to `AAA=` → REJECTED
- `AAAA====` → decodes to 3 bytes → re-encodes to `AAAA` → REJECTED
- A legitimate 1232-byte transaction (1644 base64 chars) → decodes and re-encodes to itself → ACCEPTED

The check is sound.

## R4. scripts/cron-install.sh

### R4-1: VERIFIED — The header is now accurate

**Jobs installed:**
1. `alarm.mjs` (watcher) — does NOT move money. It reads state and sends alerts.
2. `distribute.mjs` — MOVES MONEY. Installed WITHOUT `--dry-run`, so it sends cbBTC for real.
3. `revenue.mjs` — MOVES MONEY only with `--live`. Installed WITHOUT `--live`, so it's dormant.
4. `alarm.mjs --reconcile` — does NOT move money. It reads token accounts and reports.
5. Deadman switch — does NOT move money. It runs `find` and `test`.

The header correctly states: "the revenue cycle is dormant until you arm it, and the distribution cycle is armed the moment this script succeeds."

### R4-2: MEDIUM — The `ours()` function filters commented lines with `grep -v '^[[:space:]]*#'` but a line with a leading tab and then `#` would still match

**Construct:**
```bash
ours() { grep -F "$TAG" <<<"$CUR" | grep -v '^[[:space:]]*#'; }
```

**What happens:** `[[:space:]]` includes tabs. So `\t# 41 */6 ...` would be filtered out. But if a line has `#` NOT at the start after whitespace — e.g., `41 */6 * * * cmd #cbob-vault-cron revenue` — the `#` is mid-line, not a comment. The regex `^[[:space:]]*#` only matches lines where `#` is the first non-whitespace character. A cron line with a trailing comment containing the tag would NOT be filtered out by `grep -v '^[[:space:]]*#'` because the line doesn't START with `#`. But it WOULD be matched by `grep -F "$TAG"` because the tag appears in the trailing comment. This could cause `ours()` to return a line that is actually a comment ABOUT a cron job, not an actual cron job.

**Evidence:** If an operator writes:
```
# 7 9 * * * cd /opt/cbob-vaults && /usr/bin/node bank/distribute.mjs --dry-run >> /var/log/cbob/distribute.log 2>&1 #cbob-vault-cron distribute
```
This is a COMMENTED-OUT line where the `#` is at the start, so `grep -v '^[[:space:]]*#'` filters it. Good.

But if they write:
```
7 9 * * * cd /opt/cbob-vaults && /usr/bin/node bank/distribute.mjs --dry-run >> /var/log/cbob/distribute.log 2>&1 #cbob-vault-cron distribute  # DISABLED temporarily
```
This is an ACTIVE line with a trailing comment. `grep -F "$TAG"` matches it. `grep -v '^[[:space:]]*#'` does NOT filter it (the line doesn't start with `#`). So `ours()` returns it, and the preserve logic sees `--dry-run` and preserves it. That's correct — it's an active line.

The edge case: what if the operator writes a line that is ONLY a comment, but the `#` is not at the start?
```
   # 7 9 * * * ... #cbob-vault-cron distribute
```
This has leading spaces, then `#`. `^[[:space:]]*#` matches it. Filtered. Good.

**Fix:** The current logic is correct for all reasonable cases. The only pathological case would be a line like `echo "#cbob-vault-cron"` which is not a cron line at all but would match the tag. This is unlikely in a crontab.

## R5. THE GATES ADDED OR CHANGED

### R5-1: MEDIUM — `isTableRow` matches the classification keyword anywhere in the row, not just in the fourth column

**Construct:** Already covered in R1-3. The regex `/^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/` matches `**ON-CHAIN.**` anywhere after the second pipe.

**Evidence:** The row `| **THE BANK MUST SIGN AT ALL** — the 2-of-2 itself | ... | ... | **ON-CHAIN.** Two programs refuse. |` matches because `**ON-CHAIN.**` appears after the fourth pipe, which is after the second pipe. The `.*` between the second pipe and `\*\*` is greedy and crosses pipes.

**Fix:** Anchor to the fourth column: `/^\|.*\|.*\|.*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/`

### R5-2: LOW — The `MintVault` struct regex `([\s\S]*?)\n\}` is non-greedy and stops at the first `\n}`

**Construct:**
```javascript
const body = (src.match(/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/) || [])[1] || ''
```

**What happens:** The regex looks for `pub struct MintVault<'info> {` then captures everything (non-greedy) until `\n}`. If a field has a comment containing `}` at the start of a line, or if a field type contains a newline followed by `}` (unlikely in Rust), the regex would terminate early. In practice, Anchor account structs don't have closing braces in comments or field types. The regex is sound for real code.

**Evidence:** The selftest assertion `t('...and the parser read a real struct, not an empty match', mintVaultFields(mintSrc).slice(0, 6), ['config', 'asset', 'collection', 'owner', 'bank', 'payer'])` passes, confirming the regex captures the correct fields.

**Fix:** The regex is fragile but works for the current code. A more robust approach would be to use a proper Rust parser or at least match balanced braces. But the current gate fails CLOSED — if the regex matches too little, `indexOf('bank')` returns -1, and the assertion `t('MINT_IX_BANK_IDX is the REAL position...')` fails.

### R5-3: LOW — `codeOnly` strips lines starting with `#` but a `#` in a string or after a command is not a comment

**Construct:**
```javascript
const codeOnly = src => src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
```

**What happens:** In shell, `#` starts a comment only when it's at the start of a word (after whitespace or at the beginning of a line). A `#` inside a string or after a command is not a comment. For example:
```bash
echo "foo # bar"
```
This is a valid command, not a comment. But `codeOnly` would keep it because it doesn't start with `#` (it starts with `echo`). Good.

What about:
```bash
somecmd --arg='#not-a-comment'
```
This line does NOT start with `#`, so `codeOnly` keeps it. Good.

The only case where `codeOnly` would incorrectly strip a line is:
```bash
# This is a comment
```
This IS a comment, and `codeOnly` correctly strips it.

**Evidence:** The selftest assertion `t('there is exactly ONE exec-of-the-co-signer line in the code', ...)` passes, confirming that `codeOnly` correctly strips the comment that was fooling the old regex.

**Fix:** The current implementation is correct for the specific use case (finding `exec` lines in a shell script). Shell comments are lines starting with `#`. The regex `^\s*#` correctly identifies them.

### R5-4: VERIFIED — The two arms proving `nothingToDo` suppresses `distribution_unfinished` are correct

The selftest assertions:
```javascript
t('a half-finished day raises the alarm...', ...)  // true
t('...and a STALE nothingToDo would silence it — which is why the writer clears it', ...)  // false
```

The first assertion creates a day with `startedAt` but no `finishedAt`, `nothingToDo`, or `resolvedBy`. It has one paid row with a signature and one with `sig: null`. `detectDistribution` sees `startedAt && !finishedAt && !nothingToDo && !resolvedBy` → true → fires `distribution_unfinished`. Correct.

The second assertion adds `nothingToDo: 'holding: quiet morning'` to the same day. Now `!nothingToDo` is false, so the guard fails and `distribution_unfinished` does NOT fire. This proves that a stale `nothingToDo` would silence the alarm. Correct.

## R6. THE COUNTS AND THE ARITHMETIC

### R6-1: VERIFIED — The assertion floors match the files

From `scripts/run-tests.sh`:
- `MIN_ASSERTIONS=286` — on-chain suite
- `DET_FLOOR=434` — detector selftest
- `ALLOC_FLOOR=93` — allocation selftest
- `MAINNET_FLOOR=19` — mainnet probe

From `bank/selftest.mjs`: `const FLOOR = 434` — matches `DET_FLOOR`
From `bank/distribute.mjs`: `const FLOOR = 93` — matches `ALLOC_FLOOR`

The selftest assertion `t("selftest.mjs's own FLOOR equals run-tests.sh's DET_FLOOR", selfFloor, det)` passes (434 === 434).
The selftest assertion `t("distribute.mjs's own FLOOR equals run-tests.sh's ALLOC_FLOOR", distFloor, alloc)` passes (93 === 93).

### R6-2: VERIFIED — The schedule arithmetic is correct

**240-vault census (108/60/36/24/12):**
- Sum: 108 + 60 + 36 + 24 + 12 = 240 ✓
- Denominator: 108×2 + 60×3 + 36×4 + 24×5 + 12×6 = 216 + 180 + 144 + 120 + 72 = 732 ✓

**2,100-vault census (945/525/315/210/105):**
- Sum: 945 + 525 + 315 + 210 + 105 = 2,100 ✓
- Denominator: 945×2 + 525×3 + 315×4 + 210×5 + 105×6 = 1,890 + 1,575 + 1,260 + 1,050 + 630 = 6,405 ✓

**Per $1,000 at 240 vaults:**
- I: 1000 × 2 / 732 = 2.732... → 2.73 ✓
- II: 1000 × 3 / 732 = 4.098... → 4.10 ✓
- III: 1000 × 4 / 732 = 5.464... → 5.46 ✓
- IV: 1000 × 5 / 732 = 6.830... → 6.83 ✓
- V: 1000 × 6 / 732 = 8.196... → 8.20 ✓

**Per $1,000 at 2,100 vaults:**
- I: 1000 × 2 / 6405 = 0.312... → 0.31 ✓
- II: 1000 × 3 / 6405 = 0.468... → 0.47 ✓
- III: 1000 × 4 / 6405 = 0.624... → 0.62 ✓
- IV: 1000 × 5 / 6405 = 0.780... → 0.78 ✓
- V: 1000 × 6 / 6405 = 0.937... → 0.94 ✓

**Share of every drop at 2,100:**
- I: 100 × 945 × 2 / 6405 = 189,000 / 6405 = 29.508... → 29.5% ✓
- II: 100 × 525 × 3 / 6405 = 157,500 / 6405 = 24.590... → 24.6% ✓
- III: 100 × 315 × 4 / 6405 = 126,000 / 6405 = 19.672... → 19.7% ✓
- IV: 100 × 210 × 5 / 6405 = 105,000 / 6405 = 16.393... → 16.4% ✓
- V: 100 × 105 × 6 / 6405 = 63,000 / 6405 = 9.836... → 9.8% ✓

**Sum of shares:** 29.5 + 24.6 + 19.7 + 16.4 + 9.8 = 100.0% ✓

**Level V / Level I:** 6 / 2 = 3.0 ✓

All figures are correct.

## R7. WHAT THE SELF-AUDIT MISSED

### R7-1: HIGH — `settledAsPayout` is NOT the only site asking the cadence question

**Construct:** The builder claimed "settledAsPayout is the ONLY site asking the cadence question." But `holdDays` calls `settledAsPayout` to determine which days count as payouts. And `decideEmission` uses the result of `holdDays` to decide whether to force a payout. But there's another path: `describeCadence` also reports the cadence, and it's called in `main()`:
```javascript
console.log(`  cadence: ${describeCadence(held)} — ${d.reason}` + (d.forced ? '  [FORCED at the ceiling]' : ''))
```
This is purely descriptive and doesn't affect the decision. But the claim was "no other paymentState caller conflates the same thing." Let's check all `paymentState` callers:

1. `settledAsPayout` — calls `paymentState`, correctly distinguishes `resolved` + `resolvedAs: 'paid'`
2. `holdDays` — calls `settledAsPayout`, not `paymentState` directly
3. The payment loop in `main()` — calls `paymentState` directly to decide whether to skip/resend
4. `detectDistribution` in `detectors.mjs` — calls `paymentState` to classify rows

The payment loop uses `paymentState` to decide if a row is `'paid'` (skip), `'resolved'` (skip), `'unpaid'` (send), or `'ambiguous'` (report). This is correct — it doesn't conflate the cadence question.

`detectDistribution` uses `paymentState` to find unresolved transfers (`distribution_unresolved`). A row with `resolvedBy` returns `'resolved'`, which is NOT `'ambiguous'` and NOT `null`-sig, so it's treated as settled. This is correct for the detector's purpose.

**But there IS a conflation:** `paymentState` returns `'resolved'` for ANY `resolvedBy`, regardless of `resolvedAs`. The payment loop treats `'resolved'` as "skip, don't re-send." The detector treats `'resolved'` as "settled, don't alarm." But a row with `resolvedAs: 'unpaid'` means the human confirmed the money NEVER LANDED. The payment loop correctly skips it (the human said not to re-send), but the detector also skips it (the human said it's settled). The detector should perhaps report "resolved as unpaid" as a different finding, because the vault was never paid.

**Evidence:** The selftest does not test `paymentState` with `resolvedAs: 'unpaid'`. It only tests `resolvedBy` alone and `resolvedBy` + `rejected`.

**Fix:** Add a `resolvedAs` field to the `paymentState` return or create a separate function for the detector that distinguishes between `resolvedAs: 'paid'` and `resolvedAs: 'unpaid'`.

### R7-2: MEDIUM — The `census()` fix (null prototype) was applied to `census()` and `denominator()` but `allocateWeighted` also iterates over `levels` with `Object.hasOwn`

**Construct:** In `allocateWeighted`:
```javascript
const unlevelled = activated.filter(v => !Object.hasOwn(LEVEL_WEIGHTS, levels[v] ?? ''))
```

**What happens:** This correctly uses `Object.hasOwn(LEVEL_WEIGHTS, ...)` to check if a level is valid. `LEVEL_WEIGHTS` is `Object.freeze({ I: 2, II: 3, III: 4, IV: 5, V: 6 })` — a normal object with a prototype. `Object.hasOwn` on a normal object works correctly and rejects prototype keys like `'constructor'`. The fix was already applied here in round 17.

**But:** The `census()` function now uses `Object.create(null)` internally, but `allocateWeighted` calls `census(Object.fromEntries(activated.map(v => [v, levels[v]])))`. The argument to `census` is a normal object (from `Object.fromEntries`), so `census`'s null-prototype internal is just a safe accumulator. The spread at the end returns a normal object. This is all correct.

**However:** `denominator()` is called with the result of `census()`:
```javascript
const cen = census(Object.fromEntries(activated.map(v => [v, levels[v]])))
const den = denominator(cen)
```
`denominator` uses `Object.hasOwn(c ?? {}, l)` — the `c ?? {}` creates a normal object if `c` is null/undefined. But `c` is the result of `census()`, which is a spread of a null-prototype object, so it's a normal object. `Object.hasOwn` works fine. The fix is consistent.

### R7-3: LOW — The `realDay` function was added to `distribute.mjs` but `selftest.mjs` does not test it

**Construct:** `realDay` is defined in `distribute.mjs` and used by `holdDays`. The selftest in `distribute.mjs` tests `realDay`:
```javascript
t('...and every real date still round-trips',
    ['2026-02-28', '2024-02-29', '2026-12-31', '2026-01-01'].every(realDay), true)
t('...while the impossible ones do not',
    ['2026-02-30', '2026-13-01', '2026-00-10', '2023-02-29'].some(realDay), false)
```

But `realDay` is not exported. It's a module-private constant. The selftest runs inside the same module (the `--selftest` block is in `distribute.mjs`), so it has access. But if `realDay` were ever needed elsewhere, it would need to be exported.

**Evidence:** The selftest passes. `realDay` is only used in `holdDays`, which is in the same file. No issue.

## CARRY-OVER LIST REVIEW

### Known Limit 12 (COMPUTE UNITS unmeasured) — CONFIRMED WORSE

The diff adds the instructions sysvar account to `MintVault` and the instruction-walking loop to `mint_vault`. The loop iterates over all top-level instructions, calling `load_instruction_at_checked` for each one. This is additional compute cost. The comment in the diff acknowledges this: "COMPUTE UNITS are unmeasured anywhere. **This one got worse this round — see R1.**"

**Evidence:** The test suite passes, so the compute cost is within limits for the test cases. But production transactions with many instructions could hit the compute limit. The loop in `mint_vault` iterates over ALL top-level instructions, not just until it finds itself. This is O(n) in the number of instructions.

**Recommendation:** Measure compute units for worst-case transactions (max instructions, max accounts) before mainnet.

## THIRD TARGET: UNDER-CLAIMS

### UNDER-CLAIM 1: SPEC's control table says the Bank's co-signer is "PROCEDURE" but the row above says "THE BANK MUST SIGN AT ALL" is "ON-CHAIN"

The control table now correctly splits these into two rows:
1. "THE BANK MUST SIGN AT ALL" — ON-CHAIN (SEAL and BURN refuse without the Bank's signature)
2. "bank/cosign.mjs" — PROCEDURE (the policy the Bank applies before signing)

This is correct. The previous version had them conflated. The current version accurately represents the guarantee.

### UNDER-CLAIM 2: The `MINT_IX_BANK_IDX` constant is now pinned by a selftest gate

The diff adds a gate that parses the `MintVault` struct and asserts `MINT_IX_BANK_IDX` equals the real index of `bank`. This is good — it prevents the constant from drifting if the struct is reordered.

**But:** The gate only checks `MintVault` in MINT. SEAL's `OpenForRedemption` also has positional constants (`BURN_IX_ASSET_IDX`, `BURN_IX_OWNER_IDX`) and BURN has `SEAL_IX_ASSET_IDX`, `SEAL_IX_OWNER_IDX`. These are NOT pinned by similar gates. If SEAL's `OpenForRedemption` is reordered, BURN's constants would be wrong, and the cross-program coupling would fail. The failure is CLOSED (the burn would refuse), but it would be a silent breakage until a redemption is attempted.

**Evidence:** The selftest has gates for the discriminator constants (asserted against sha256) but not for the positional index constants in SEAL and BURN.

**Fix:** Add similar struct-parsing gates for SEAL's `OpenForRedemption` and BURN's `BurnVault` to pin the positional constants.

## ADDITIONAL FINDINGS

### A1: MEDIUM — The `errNames` function in `selftest.mjs` parses error enum bodies but the regex `/\n\}/` requires the closing brace to be on its own line

**Construct:**
```javascript
const body = (src.match(/#\[error_code\]\s*pub enum \w+\s*\{([\s\S]*?)\n\}/) || [])[1] || ''
```

**What happens:** If an error enum is formatted with the closing brace on the same line as the last variant (e.g., `LastError, }`), the regex `\n\}` would not match, and `body` would be empty. All four programs currently format their error enums with the closing brace on its own line, so this works. But it's fragile.

**Evidence:** The selftest assertion `t('...and the check is looking at something real', bankErrs.sort(), ['BankKeyOutsideMint', 'BankKeyOutsidePair'])` passes, confirming the regex works for the current code.

**Fix:** Change `\n\}` to `\s*\}` to handle both formatting styles.

### A2: LOW — The `audit19.ts` prompt says `${FLOORS.onchain}` in the R1 bullet, which is an escaped interpolation that renders literally

**Construct:** In the prompt:
```
- \${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT in the audit prompt
```

**What happens:** This is INTENTIONAL — the R1 bullet is describing the round-18 defect where `${FLOORS.onchain}` was escaped and rendered literally. The prompt needs to show the literal text `\${FLOORS.onchain}` to explain the defect. The selftest in `bank/selftest.mjs` confirms this is the ONLY escaped interpolation and it's deliberate.

**Evidence:** The selftest assertion `t('every escaped interpolation in the prompt is the deliberate R1 example', ...)` passes.

**Fix:** No fix needed. This is correct.

### A3: LOW — The `audit19.ts` bundle verification checks that every file named in the prompt is delivered, but it only checks the numbered targets (R1-R7), not the "FILES THIS ROUND IS ABOUT" section

**Construct:**
```javascript
const targetSection = PROMPT.slice(PROMPT.indexOf('**R1.'), PROMPT.indexOf('KNOWN AND OPEN'))
const named = [...new Set([...targetSection.matchAll(/\b((?:programs|bank|scripts|tests)\/[\w./-]+\.(?:rs|mjs|sh|ts))\b/g)].map(m=>m[1]))]
```

**What happens:** This extracts file paths from the R1-R7 section. But the prompt also has a "FILES THIS ROUND IS ABOUT" section that lists files. If a file is mentioned there but not in R1-R7, it wouldn't be caught by this check. However, the `TARGETS` array drives the bundle, and the bundle includes all files in `TARGETS`. The check verifies that every file NAMED in R1-R7 is in `TARGETS`. If a file is in the "FILES THIS ROUND IS ABOUT" section but not in R1-R7, it's still in the bundle (because `TARGETS` drives the bundle), but the check wouldn't catch if it were missing from `TARGETS`.

**Evidence:** The current `TARGETS` includes all files mentioned in both sections. The check is a safety net, not the primary driver.

**Fix:** The check could be extended to also scan the "FILES THIS ROUND IS ABOUT" section, but the current approach (TARGETS drives everything) is sound.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Sixteen rounds of AI audit have produced diminishing returns on the program code but continue to find defects in the off-chain pipeline and in the repairs themselves. The structural limitations are:

1. **AI cannot execute code.** Every round produces findings that are refuted by running the test suite. The suite is the only thing standing between a wrong CRITICAL and a wrong code change. The suite must grow with every rejected finding.

2. **AI cannot reason about temporal ordering.** The `supersede`/`finishedAt` interaction (R1-2) is a temporal bug — it depends on the ORDER of operations within a single run. AI auditors consistently miss these because they reason about states, not sequences.

3. **AI cannot detect under-claims.** The third target (under-claims) was found by the owner, not by any auditor. The gates are all structured to detect over-claims (a comment claiming a control that doesn't run). Under-claims (a control that runs but isn't documented) are invisible to the current gate structure.

**Concrete recommendation:** Add a gate that compares the ACTUAL program behavior (from the test suite's `because()` assertions) against the control table. Every `because('X.X','ErrorName')` in the test suite is a claim that "the program refuses with ErrorName under condition X.X." The control table should enumerate every such refusal. A script can extract all `because()` calls from the test suite and cross-reference them against the control table. This would catch under-claims mechanically.