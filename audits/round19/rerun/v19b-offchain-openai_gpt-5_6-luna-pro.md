## R1 — self-audit repairs and certification machinery

### HIGH — `audit19.ts` validates the tree too late and only once

**Construct:** `scripts/audit19.ts` records `head` and `dirty`, then starts all model requests. It checks `headAfter` only after every request completes. The working-tree status is never checked again.

**Impact:** A commit or uncommitted edit can land after the initial snapshot, while the models continue auditing the prompt and bundle constructed from the earlier tree. If the edit is later reverted, the final `HEAD` check also passes. Reports can then be certified as describing a tree that was not stable during the round.

This is especially material because the prompt itself says the round must audit a fixed tree, and the process is the certification.

**Evidence if true:** Start the round, modify a watched file after `dirty` is captured, then revert it before model completion. The manifest reports a clean tree and the process exits successfully, despite the models having audited content that was not the final tree.

**Fix:** Create an immutable worktree or commit/archive the exact audited tree before launching models. At minimum:
- hash every bundled target before requests;
- hash them again after requests;
- fail if any hash differs;
- perform the same check immediately before writing the manifest;
- do not launch models at all if the initial tree is dirty.

### MEDIUM — dirty-tree detection does not prevent spending a supposedly invalid round

**Construct:** `audit19.ts` prints an error and sets `process.exitCode = 1` only after `await Promise.all(MODELS.map(...))`.

**Impact:** A dirty round still sends the complete audit prompt to all models and writes reports. Operators may read or archive those reports before noticing the eventual non-zero exit. This weakens the certification boundary and wastes substantial audit budget.

**Evidence if true:** Run with a modified watched file. Network requests are made and model reports are written before the process exits non-zero.

**Fix:** Abort immediately after computing `dirty`, before `verifyRoster`/model requests or, at minimum, before `Promise.all`.

### LOW — `audit19.ts` does not record the content hash of the prompt or bundle

**Construct:** The manifest records `head`, `promptChars`, and dirty paths, but not a cryptographic hash of `PROMPT`, `DIFF`, or `BUNDLE`.

**Impact:** A later reader cannot prove that the saved reports correspond to the exact bytes claimed by the manifest. `promptChars` is not a binding commitment; different prompts can have identical lengths.

**Evidence if true:** Replace text in the prompt or target bundle with another string of equal length. The manifest remains indistinguishable.

**Fix:** Record SHA-256 hashes of the full prompt, diff, target files, and the model roster. Store the exact bundle or a content-addressed archive.

### MEDIUM — `supersede()` preserves an old top-level `resolvedBy`

**Construct:** `supersede()` deletes `refused`, `nothingToDo`, and `finishedAt`, but does not delete `resolvedBy`.

**Impact:** A previously resolved day that later receives a new paying plan can retain an old top-level `resolvedBy`. `detectDistribution()` uses that field to suppress `distribution_unfinished`. If a later run crashes after the plan is installed, the stale resolution can still suppress the unfinished-day alarm.

The current quiet/refusal paths shown in the diff do not prove this ordering. The selftest’s `supersede()` fixtures also omit `resolvedBy`.

**Evidence if true:**
```js
const r = supersede({
  startedAt: '...',
  resolvedBy: 'old operator resolution',
  nothingToDo: 'quiet',
  finishedAt: '...'
}, '...')
```
Then append a plan and omit `finishedAt`; `detectDistribution()` must nevertheless raise `distribution_unfinished`, but the stale `resolvedBy` suppresses it.

**Fix:** When a non-paying verdict is superseded, clear `resolvedBy` or distinguish resolution of the old verdict from resolution of the day. Add tests for quiet→resolved→pay→crash and refusal→resolved→pay→crash.

---

## R2 — distribution repairs

### MEDIUM — a public activation can become a recurring paging denial of service

**Construct:** An activated vault with no level causes `allocateWeighted()` to return `refusal: true`. The refusal path invokes `notify-gary-sms.sh` on every non-dry run and writes `refused` for the day. `detectDistribution()` raises `distribution_refused` on every alarm pass until somebody edits the level register or adds `resolvedBy`.

**Impact:** Any party able to mint or activate a vault can intentionally or accidentally create an unlevelled activated vault and generate repeated human paging. This is not merely a payout halt: it consumes the operator’s alert channel and can train operators to suppress or ignore the alert. It can also halt all other customer distributions.

The design choice to halt rather than overpay is defensible, but the repeated external notification is a separate availability problem.

**Evidence if true:** Activate a vault absent from `levels.json`, run distribution on successive days or successive alarm passes, and observe:
- no customer is paid;
- exit status is non-zero;
- the SMS notifier is invoked each daily run;
- the same `distribution_refused` finding is emitted repeatedly.

**Fix:** Separate “halt distribution” from “page once.” Persist a refusal fingerprint and notify only on first occurrence or state change, with an explicit escalation/repeat interval. Keep the non-zero exit status and the detector finding.

### LOW — the dust bound is false for the empty activated set

**Construct:** The comment claims `dust < activated.length` always. For `allocateWeighted()` with no activated vaults:
```js
return { ...empty, skip: 'no activated vaults' }
```
returns `dust: 0n` and `activated.length === 0`, so `0n < 0n` is false.

**Impact:** The published mathematical statement and any generic assertion using the strict inequality are not universally true. The issue does not cause a customer overpayment, but it undermines a claimed invariant and the selftest does not cover the zero-vault case.

**Evidence if true:**
```js
const r = allocateWeighted({}, {}, 100n)
r.dust < BigInt(r.activated.length) // false
```

**Fix:** State the bound conditionally: “if at least one vault is paid, dust is less than the number of paid vaults.” Test both the zero-vault and positive-vault cases.

### LOW — exported `denominator()` remains permissive over malformed counts

**Construct:**
```js
(Object.hasOwn(c ?? {}, l) ? c[l] : 0) * LEVEL_WEIGHTS[l]
```
checks key ownership but does not validate that `c[l]` is a finite non-negative integer.

**Impact:** An exported helper can produce string concatenation, `NaN`, or nonsensical denominators when supplied a malformed object. Production currently obtains `census()` output, so this is primarily a helper/API integrity issue, not an demonstrated direct payout theft.

**Evidence if true:**
```js
denominator({ I: '999', II: 0, III: 0, IV: 0, V: 0 })
```
does not necessarily return a number representing a denominator.

**Fix:** Validate all counts as safe non-negative integers, or make `denominator()` consume only a typed/internal census structure.

### R2 findings not supported

- The `settledAsPayout()` default is directionally correct: not treating a bare `resolvedBy` as a payout leaves `holdDays` larger, and the ceiling is reached sooner, not later.
- `paymentState()` remains unchanged, and the payment loop explicitly skips `resolved`.
- `census()` returns a normal object after spreading the null-prototype map and is JSON-serializable.
- For a positive activated set, the per-vault fractional-loss bound is valid even when a plan skips because the available balance is too small.

---

## R3 — `scripts/bank-sign.sh`

### MEDIUM — canonical Base64 validation depends on GNU `base64 -w0`

**Construct:**
```bash
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
```

**Impact:** On systems whose `base64` implementation lacks `-w0`—notably common BSD/macOS implementations—the re-encoding command fails. Because `|| true` suppresses the pipeline failure, `CANON` becomes empty and every non-empty transaction is rejected. This is a deployment availability failure in the only sanctioned signing path.

The `|| true` does not create a canonicalization bypass for non-empty valid input; it converts tool failure into blanket refusal. The risk is still real because refusal can halt all redemptions.

**Evidence if true:** Run the script on a host with a `base64` implementation that does not support `-w0`. A valid 1644-character Base64 encoding for a 1232-byte transaction is rejected as non-canonical.

**Fix:** Use a known portable implementation, e.g. invoke the repository’s pinned Node runtime for decode/re-encode, or detect and require GNU coreutils before accepting the installation. Do not silently convert a canonicalization-tool failure into a comparison against empty output.

### LOW — valid transactions can be rejected by shell argument-size limits

**Construct:** The wrapper ultimately executes:
```bash
exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ...
```

**Impact:** The current Solana transaction ceiling keeps ordinary inputs well below `ARG_MAX`, so this is not a present rejection of a legitimate 1232-byte transaction. However, the wrapper’s comment presents file/stdin input as avoiding blob problems while the actual co-signer receives the entire transaction as an argv value. On systems with unusually small argument limits or if transaction formats grow, the sanctioned path can fail before policy inspection.

**Evidence if true:** Use a sufficiently large input to make `execve` fail with `E2BIG`; no transaction is judged.

**Fix:** Pass the transaction through stdin or a temporary file to `cosign.mjs`, while retaining the wrapper’s path-resolution and argument-validation controls.

### R3 conclusions

- The round-trip rejects the listed noncanonical forms.
- A normal 1232-byte transaction produces 1644 Base64 characters and passes the length requirement.
- The corrected `ps` comment is true for the co-signer process: the Base64 transaction is in that process’s argv.

---

## R4 — cron installation

### HIGH — the installer preserves flags using an unsafe textual command test

**Construct:**
```bash
ours() { grep -F "$TAG" <<<"$CUR" | grep -v '^[[:space:]]*#'; }
if ours | grep -q 'distribute\.mjs --dry-run'; then ...
if ours | grep -q 'revenue\.mjs --live'; then ...
```

**Impact:** The installer does not parse cron commands. It searches any uncommented tagged line for a substring. A tagged line containing prose or a different command with the same substring can preserve a dangerous mode. More importantly, the filtering and preservation rules are not tied to the exact job identity, path, schedule, or command structure.

An operator or compromised local account able to alter the user’s crontab can cause the installer to preserve `--live` or `--dry-run` based on a decoy line. The risk is mainly accidental/operational, but this script is responsible for arming the money jobs.

**Evidence if true:**
```text
* * * * * echo distribute.mjs --dry-run #cbob-vault-cron decoy
```
causes `DIST_DRY=' --dry-run'`, even though the actual distribute command is not dry-run. Similar decoys can preserve `--live`.

**Fix:** Parse only the exact tagged CBOB job records, or generate a structured configuration and render it. At minimum require the expected schedule, repository path, executable, job tag, and command token boundaries before preserving a flag.

### MEDIUM — preservation checks can fail nondeterministically under `pipefail`

**Construct:** `ours | grep -q ...` is executed under `set -euo pipefail`. If `grep -q` exits after finding a match while `ours` is still writing multiple tagged lines, the upstream `grep` may receive SIGPIPE. The pipeline can then return non-zero and the installer can fail to preserve a valid flag or abort in a context not covered by the fixture.

**Impact:** A re-run can unexpectedly remove a previously deliberate `--dry-run`, rearming live distribution, or fail to preserve `--live`. Whether this occurs depends on buffering and the number/size of tagged lines.

**Evidence if true:** Populate the crontab with enough matching tagged lines to force the upstream `grep` to write after the downstream `grep -q` exits, then run the extracted block repeatedly and observe intermittent non-zero pipeline status or flag loss.

**Fix:** Avoid `grep -q` in a `pipefail` pipeline, e.g. materialize `ours` into a variable/file first, or use a single `awk` command that selects the exact record and returns a stable status.

### R4 enumeration

The installed lines are:

- `alarm.mjs`: does not itself move cbBTC.
- `distribute.mjs`: **live by default as installed**, because no `--dry-run` is present on a fresh crontab.
- `revenue.mjs`: dormant on a fresh crontab, because `--live` is absent.
- `alarm.mjs --reconcile`: does not send customer cbBTC.
- deadman notification: sends an SMS notification, not funds.

Therefore the new header is accurate for a fresh crontab, but its safety depends on the preservation logic above.

---

## R5 — selftest gates

### MEDIUM — `controlTableBlock()` misses valid indented Markdown rows

**Construct:**
```js
for (let i = h + 2; i < lines.length && lines[i].startsWith('|'); i++)
  out.push(lines[i])
```

**Impact:** A table row preceded by spaces is not included. The block terminates at that line, and later rows are invisible to:
- classification checks;
- Bank error-name attribution;
- ON-CHAIN verification;
- row/file consistency checks.

The existing `rows.length >= 5` assertion still passes because the original five rows were collected before the indented row. This is a fail-open gate in the exact mechanism intended to prevent documentation drift.

**Evidence if true:** Insert:
```text
  | **NEW CONTROL** | ... | **PROCEDURE.** ... |
```
inside the table. `controlTableBlock()` stops before it, the count remains five, and the test suite can remain green.

**Fix:** Normalize leading whitespace before table parsing, or use a Markdown parser. Also require that the table block continues through all physically adjacent table rows and explicitly reject malformed/indented rows rather than silently ending the block.

### MEDIUM — `isTableRow()` is a format detector, not a semantic row detector

**Construct:**
```js
/^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/
```

**Impact:** It misses rows with:
- leading indentation;
- no space after the opening pipe;
- escaped or differently spaced classification text;
- a classification in a later column layout.

Some formatting variants are valid Markdown. If a real control row takes one of those forms, the gate does not inspect it. The new block check only catches this if the row is reached by `controlTableBlock()`, which the indentation case defeats.

**Evidence if true:** Add a syntactically valid table row with leading spaces or `|**CONTROL**|...`; it is not recognized as classified and can be omitted from subsequent checks.

**Fix:** Parse table structure rather than relying on one exact presentation regex. If a canonical format is mandatory, validate the entire table and fail explicitly on every noncanonical row.

### LOW — the MintVault parser is not structurally sound, even though the tested truncation fails closed

**Construct:**
```js
src.match(/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/)
```

**Impact:** A line-level `}` inside an attribute, macro input, or future struct-related syntax can terminate the match early. The current tested case before `bank` fails closed, and a truncation after `bank` cannot change the already-read bank index. That limits the immediate exploitability, but the gate can still certify an incomplete struct if the truncation occurs after `bank` while fields relevant to account ordering or future logic are omitted.

**Evidence if true:** Add a multiline attribute or macro fragment containing a standalone closing brace before later fields. The parser returns only the prefix while the test may still see `bank` at index 4.

**Fix:** Parse Rust with a syntax-aware parser, or derive the account index from Anchor IDL/build artifacts rather than source regex. At minimum assert the full expected account list and the closing boundary, not only the first six names.

### R5 conclusions

- `codeOnly()` correctly preserves a shell line beginning with a quote or command containing `#`; a `#` is a comment only when it begins a shell comment token, not when embedded in a word or quoted string. It is still not a shell parser and should not be treated as one.
- The stale-`nothingToDo` detector tests prove detector behavior, not the complete writer state machine. They do not cover the stale `resolvedBy` case described under R1.

---

## R6 — counts and arithmetic

The supplied figures are arithmetically correct:

- 240-vault census:
  - `108×2 + 60×3 + 36×4 + 24×5 + 12×6 = 732`.
- 2,100-vault census:
  - `945×2 + 525×3 + 315×4 + 210×5 + 105×6 = 6,405`.
- Per 1,000 at denominator 732:
  - `2.73, 4.10, 5.46, 6.83, 8.20`.
- Per 1,000 at denominator 6,405:
  - `0.31, 0.47, 0.62, 0.78, 0.94`.
- Level shares:
  - `29.5%, 24.6%, 19.7%, 16.4%, 9.8%`;
  - these sum to `100.0%`.
- The quoted floors are internally aligned in the shown diff:
  - on-chain `286`;
  - detector `427`;
  - allocation `79`;
  - live-mainnet `19`.

The floor-equality repair is materially better than a lower-bound check, but it remains dependent on the output parser finding the intended count line. A future assertion message that matches the count regex could still interfere with the extracted value. The stronger design is to have each test process emit a machine-readable JSON result containing the count and pass/fail status.

---

## Carry-over and accepted limits

I do not re-file the listed measured facts as new findings. The following remain consequential, however:

1. The foreign-Core-asset nesting gap is still exploitable if a foreign Core asset can be transferred into a vault PDA. The documentation correctly labels it open; it should not be treated as covered by `detectNestedVaults`.
2. The Bank’s off-chain policy remains bypassable by anyone holding the Bank key. The on-chain signature requirement is real, but the repository does not enforce use of `cosign.mjs`.
3. The distribution ledger remains payer-authored. The newly added checks improve consistency but do not establish an independent payment record.
4. The `resolvedBy` field remains a high-risk overloaded control: it suppresses multiple detector branches, while `resolvedAs` now separately affects cadence. These should be split into typed, per-condition resolution records rather than shared free-form flags.

---

## Verdict challenges

### The documentation’s under-claim is corrected for the Bank signature

The table now accurately distinguishes:
- the Bank signature as an on-chain mandatory condition; and
- the co-signer policy as a procedure.

I found no additional equally severe under-claim in the supplied diff, but the documentation still uses “the one sanctioned path” language alongside an explicit admission that the key holder can sign elsewhere. That is acceptable only if every operational document consistently calls it policy rather than enforcement.

### The cron money claim is substantially true but operationally incomplete

The new header correctly says:
- fresh revenue cron: dormant;
- fresh distribution cron: live;
- alarm/reconcile/deadman: not cbBTC senders.

It should additionally say that a rerun preserves operator flags only through heuristic text matching, which is not a secure configuration boundary.

---

## What this project should do that sixteen AI rounds structurally cannot

1. **Run an adversarial integration exercise against a disposable but production-identical host.** Include real cron installation, reboot, logrotate, missing utilities, user changes, corrupted ledgers, concurrent jobs, and a mocked notifier. The current tests mostly exercise pure functions and source text, not the installed operational system.

2. **Have two independent parties control the signing and deployment keys.** One party must not be able to alter code, alter the level register, alter the distribution ledger, and operate the payer or Bank key without an externally visible second-party approval.

3. **Commission a protocol-specific review of Metaplex Core upgrade and plugin semantics.** The local clone proves current behavior; it cannot prove that a future Core upgrade preserves the assumptions on which customer funds depend.

4. **Create an immutable audit artifact before every certification round.** Store the exact commit/tree archive, prompt, target bundle, model roster, model responses, hashes, and test logs in append-only storage. Do not rely on mutable working-tree paths or a later `HEAD` check.

5. **Run destructive fault-injection tests continuously on a staging deployment.** Specifically inject:
   - PDA-owned token accounts and Core assets;
   - stale and conflicting ledger flags;
   - crashes after every write and every transfer;
   - malformed DAS pages and valid-but-incomplete pages;
   - notifier failure;
   - cron reruns with adversarial crontab content;
   - a level-register activation race.

6. **Define a human incident protocol for the cases the code intentionally cannot decide.** “Resolve on chain” is not sufficient. The protocol must state who verifies an ambiguous transfer, who can authorize a retry, how a refusal is deduplicated, and how customer balances are reconciled independently of the payer’s ledger.