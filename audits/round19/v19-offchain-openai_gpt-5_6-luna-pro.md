## R1 — self-audit repairs

### HIGH — `audit19.ts` does not enforce a fixed audited tree

**Construct:** `DIFF` is captured at module initialization:

```ts
const DIFF = execSync(`cd ${R} && git diff ec7d17e..HEAD ...`).toString()
```

Later, `HEAD` and `git status` are read separately, but a dirty tree only produces:

```ts
if(dirty) console.log(' ... DIRTY — this round did not audit a fixed tree')
```

The process still exits successfully when quorum is met. It also never verifies that the later `HEAD` equals the commit used to produce `DIFF`.

**Impact:** Code can change after the prompt is constructed or while model requests are running. The models audit one snapshot while the manifest claims another. A malicious or accidental change can therefore be outside the certification receipt.

**Evidence if true:** Change a file under `programs/bank/scripts/tests` after module import but before completion. The prompt and manifest will contain different source states, while the process can still exit zero. Alternatively, alter `HEAD` or the working tree during the API calls; the manifest records only the later state.

**Fix:** Capture and verify an immutable commit before constructing the prompt:

1. Require a clean tree.
2. Resolve the exact commit SHA.
3. Generate the diff from that SHA.
4. Record the SHA and a hash of the complete prompt.
5. Re-check the SHA and tree after all model calls.
6. Exit nonzero on any mismatch, not merely print a warning.
7. Prefer auditing a temporary detached worktree or archive of the resolved commit.

### MEDIUM — `audit19.ts` counts reports as auditors using weak heuristics

**Construct:** `disqualify()` accepts any response over 600 characters unless it is truncated, obviously repetitive, or starts with a known error marker. It does not require the requested report structure, findings, severity, evidence, or coverage of the target.

**Impact:** A model can return a long refusal, generic analysis, or prompt echo and count toward the six-auditor quorum. This is particularly dangerous because the process is itself the certification.

**Evidence if true:** Supply a 601-character generic response with no finding and `finish_reason: "stop"`; it is counted as a usable auditor.

**Fix:** Require a machine-readable report envelope containing, at minimum, target coverage, finding IDs, severity, construct, impact, evidence, and fix. Validate that the response discusses the supplied commit and reject prompt echoes and reports with no actionable finding or explicit clean result.

### LOW — prompt correctness is not tested by rendering

The source does correctly use escaped `\${FLOORS.onchain}` where literal text is intended, and unescaped `${FLOORS...}` where interpolation is intended. However, `audit19.ts` never asserts the rendered prompt contains the actual floor values and does not write the rendered prompt or its hash into the manifest.

**Evidence if true:** A future escaped interpolation or accidental interpolation can pass `tsc`, while only the model-visible prompt changes.

**Fix:** Render the prompt in a test, assert that it contains the numeric floors and does not contain unintended `${...}` placeholders, and record the prompt hash.

### LOW — `isTableRow` is format-fragile

**Construct:**

```ts
const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)
```

It requires exactly `| ` at the beginning and the claim marker in a specific form. It does not parse Markdown table columns.

**Impact:** A legitimate control row formatted as `|Control|...`, with alignment padding, escaped content, or a different column layout can be invisible to the gate. The control table can drift while the gate still checks only the rows it recognizes.

**Evidence if true:** Change a real row to any valid Markdown shape not matching the expression; `tableRows()` omits it and the corresponding consistency assertions can remain green.

**Fix:** Parse the table structurally: identify the header, separator, columns, and complete row boundaries. Add mutation tests for spacing, alignment, escaped pipes, and ordinary Markdown variants.

---

## R2 — off-chain distribution repairs

### MEDIUM — refusal paging is attacker-triggerable

**Construct:** Any activated vault without a level causes `allocateWeighted()` to return `refusal: true`. The refusal path then calls the external notifier on every non-dry run:

```js
if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
process.exitCode = 1
```

The code explicitly states that an ordinary customer activation can create this condition.

**Impact:** An attacker can activate a vault without a level and cause daily distribution refusal plus an SMS/page on every run. This converts a known operational halt into a notification-amplification/alert-fatigue denial of service.

**Evidence if true:** Mint or otherwise activate one vault absent from `levels.json`, run the distributor twice on the same day, and observe two notifier invocations and two nonzero exits. Repeat on successive days to confirm persistent paging.

**Fix:** Separate emergency state from notification policy. Persist a refusal fingerprint and notify only on transition, escalation, or after a controlled rate limit. Do not allow arbitrary customer state to generate unlimited SMS notifications. The refusal should still fail closed and remain visible to the watcher.

### MEDIUM — `settledAsPayout` relies on an unauthenticated off-chain assertion

**Construct:**

```js
return paymentState(row) === 'resolved' && row?.resolvedAs === 'paid'
```

Any operator or process able to edit the ledger can mark a row as `resolvedAs: 'paid'`, thereby moving the cadence anchor.

**Impact:** A false hand-payment annotation makes the clock appear recently paid. This can defer forced distribution for up to `MAX_HOLD_DAYS`, while the row remains permanently suppressed from retransmission because `paymentState()` returns `resolved`.

**Evidence if true:** Add a row with `resolvedBy` and `resolvedAs: 'paid'` without a transfer signature. `holdDays()` treats that day as the latest payout day, while the payment loop never sends the row.

**Fix:** Require a verifiable payment receipt: transaction signature, recipient and amount confirmation, or a separately authenticated operator resolution record. A manual “paid” resolution should not be accepted solely because a JSON field says so.

The direction argument itself is correct: a larger `daysSinceLastPayout` reaches the `>= 31` forced branch sooner, so treating an ambiguous bare resolution as unpaid pays earlier rather than later. That does not make the unauthenticated annotation safe.

### LOW — dry-run and live-run decisions are not represented as distinct verdicts

A dry run does not clear `refused` or `nothingToDo`, which is generally correct. However, it can print a plan based on current state while a subsequent live run recomputes a different plan, and the operator receives no durable indication that the dry-run result was not a committed decision.

**Evidence if true:** Run `--dry-run`, change balances or levels, then run live; the two outputs differ while the dry-run output gives no durable plan hash.

**Fix:** Add an explicit dry-run plan hash and state snapshot identifier to output. Never present dry-run output as a settled schedule.

### LOW — census serialization is presently safe, but the boundary is undocumented

`census()` returns `{ ...c }`, converting the null-prototype object into an ordinary object. JSON serialization and reloading therefore work. The current consumers shown do not require a special prototype.

The remaining issue is that `denominator()` accepts arbitrary object values and does not validate that counts are finite nonnegative integers. A corrupted ledger can produce string concatenation or `NaN`.

**Evidence if true:** Call `denominator({I: "999", II: 0, ...})` and observe string coercion; call it with `NaN` and obtain `NaN`.

**Fix:** Validate the deserialized census before using it: ordinary object, exactly the five level keys, integer counts, nonnegative values, and total consistent with the activated set.

### LOW — dust disclosure is scoped too narrowly

The `< activated.length` bound is correct only for a successful allocation where every activated vault receives a quotient. On the early-return paths (`available <= 0`, insufficient minimum, refusal), the entire available amount remains undistributed and is not represented as `dust`.

**Evidence if true:** With 2,100 activated vaults and `available = 1`, the returned object has `skip` and `dust: 0`, although one sat remains in the pool. The bound test passes because it is testing the synthetic zero rather than the retained amount.

**Fix:** Distinguish `roundingDust` from `heldBack`/`deferredAmount`, and document that the one-sat-per-paid-vault bound applies only to successful allocations.

---

## R3 — `scripts/bank-sign.sh`

### MEDIUM — portability can reject every legitimate transaction

**Construct:**

```bash
base64 -w0
```

The script assumes GNU `base64`. BSD/macOS `base64` does not universally support `-w0`.

**Impact:** On a host without the GNU option, the canonical encoding command fails and `CANON` is empty. Every nonempty legitimate transaction is rejected. This is fail-closed for funds, but can halt operations and encourage operators to bypass the sanctioned path.

**Evidence if true:** Run the script on a system whose `base64` lacks `-w`; a valid 1,644-character encoding is refused as noncanonical.

**Fix:** Use a known absolute coreutils path and assert it during installation, or use a portable alternative such as Node/Python for the decode/re-encode check. Add a test using a real 1,232-byte transaction.

The canonical round trip otherwise rejects the cited noncanonical encodings and accepts a canonical 1,644-character encoding. Whitespace is deliberately removed before comparison, so line-wrapped base64 remains legitimate.

### LOW — the transaction still appears in process listings

The corrected comment is true: the transaction is not an argv blob of `bank-sign.sh` itself. It is nevertheless passed as an argument to `node bank/cosign.mjs`, so it can appear in `ps` for the child process lifetime.

This is not a key leak because the unsigned transaction is not secret, but the documentation should say “not in the wrapper’s argv” rather than implying general process-list secrecy.

---

## R4 — `scripts/cron-install.sh`

### HIGH — an unrelated crontab line can silently arm live revenue

**Construct:**

```bash
if grep -q "revenue.mjs --live" <<<"$CUR"; then
  REV_LIVE=' --live'
fi
```

The search is unanchored and does not require the line to be the tagged CBOB revenue job. A comment, stale line, or unrelated command containing `revenue.mjs --live` causes the newly installed revenue job to receive `--live`.

**Impact:** Installing or reinstalling the crontab can activate the sweep/swap/split revenue path without an explicit operator action at installation time. This contradicts the header’s unconditional claim that revenue is installed dormant.

**Evidence if true:** Put this harmless line in the existing crontab:

```cron
# documentation: revenue.mjs --live is used only during testing
```

Run `cron-install.sh`; the resulting tagged revenue line contains `--live`.

**Fix:** Parse only the existing tagged revenue entry, require an exact command structure, and preserve `--live` only after an explicit confirmation or separate installation flag. Better: make live mode opt-in through a protected configuration file or systemd credential, not substring detection in arbitrary crontab text.

The installed jobs are:

- `alarm.mjs`: no direct cbBTC transfer shown; watcher/reconciliation job.
- `distribute.mjs`: live as installed because `--dry-run` is absent; it can send cbBTC.
- `revenue.mjs`: normally dormant because `--live` is absent, but the substring bug can arm it.
- `alarm.mjs --reconcile`: no direct payout path shown.
- deadman notifier: sends an SMS, not cbBTC.

Therefore the new header is not completely true because the revenue line is not unconditionally dormant.

### MEDIUM — installer can delete unrelated tagged crontab entries

**Construct:**

```bash
grep -v "$TAG" <<<"$CUR" > "$TMP"
```

Any user crontab line containing `#cbob-vault-cron` is removed, not merely a line generated by this installer.

**Impact:** Reinstalling the CBOB crontab can delete an unrelated operator job or a manually modified CBOB line. If an operator added a safety wrapper or a `--dry-run` to a line while retaining the tag, it is silently replaced.

**Evidence if true:** Add an unrelated crontab command containing the tag, run the installer, and observe that it disappears.

**Fix:** Use exact generated-line identifiers or a managed block with explicit begin/end markers and a checksum. Preserve and reject unexpected modifications rather than overwriting them.

---

## R5 — gates and tests

### MEDIUM — the new Mint index gate does not prove runtime account binding

**Construct:** The gate derives the `bank` index from a source regex:

```ts
/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/
```

and compares it to the constant. This checks textual order, not the compiled Anchor account layout or the actual account list consumed at runtime.

**Impact:** Formatting changes, nested braces in attributes, conditional compilation, comments, or a divergence between the parsed source and the compiled artifact can make the gate report a false result. The gate may fail closed for many edits, but it does not establish that the deployed binary uses the asserted index.

**Evidence if true:** Add a multiline Rust attribute or expression containing a newline followed by `}` before the struct’s actual end. The regex terminates early. Conversely, alter generated/compiled account handling without changing the matched source shape; the gate remains green.

**Fix:** Test the actual instruction against a locally built program and assert the account names/order through Anchor-generated IDL or generated account metadata. Treat source regexes only as supplemental checks.

### LOW — `codeOnly` is not a shell parser

**Construct:**

```js
src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
```

A line beginning with `#` is not necessarily comment text when it occurs inside a quoted string, heredoc body, or other shell construct. Removing it can change the source being tested.

**Impact:** The gate can inspect a transformed shell program that is not the program executed. It may miss or misidentify the sanctioned `exec`.

**Evidence if true:** Put a multiline quoted string or heredoc containing a line beginning with `#` before the real exec line. `codeOnly()` removes the line and changes the parsed text.

**Fix:** Parse shell using a shell-aware lexer, or test behavior: invoke the wrapper with a fake `node` and assert the exact final argv. Source scraping should not be the sole control.

### LOW — stale-flag tests prove detector behavior, not writer correctness

The two new tests establish that `detectDistribution()` suppresses `distribution_unfinished` when `nothingToDo` exists. They do not prove that every path which starts a partial run clears stale `nothingToDo` before saving a plan.

**Evidence if true:** The detector tests remain green if the writer never clears the field. Only an integration test that performs quiet → partial live plan → crash/resume and inspects the ledger can detect that failure.

**Fix:** Add filesystem-backed integration tests covering quiet then pay, refuse then pay, crash after plan save, crash after intent save, dry-run between attempts, and two invocations in one day.

---

## R6 — counts and arithmetic

The visible arithmetic is correct:

- 240-vault denominator:

  `108×2 + 60×3 + 36×4 + 24×5 + 12×6 = 732`.

- 2,100-vault denominator:

  `945×2 + 525×3 + 315×4 + 210×5 + 105×6 = 6,405`.

- Per 1,000 at 240 vaults: `2.73, 4.10, 5.46, 6.83, 8.20`.
- Per 1,000 at 2,100 vaults: `0.31, 0.47, 0.62, 0.78, 0.94`.
- Shares at 2,100 vaults: `29.5%, 24.6%, 19.7%, 16.4%, 9.8%`, summing to `100.0%`.
- Level V weight is exactly three times Level I.

The visible changed floors are:

- `DET_FLOOR=403`
- `ALLOC_FLOOR=63`
- `MAINNET_FLOOR=19`
- `MIN_ASSERTIONS` is unchanged in the shown diff and cannot be independently verified from the excerpt.

The arithmetic self-tests still have a weakness: they test rounded card values and one altered weight, but do not test every published input/output pair or the exact customer-facing card file. The card itself should be parsed and compared against independently generated values.

---

## Carry-over and accepted-limit challenges

### HIGH — distribution still trusts an off-chain ledger for payment state

This is listed as accepted, but its consequence is broader than the description suggests. A compromised or accidentally corrupted ledger can mark recipients as paid, resolved, skipped, or ambiguous. The on-chain token balances are not reconciled against the ledger before permanently suppressing a row.

**Evidence if true:** Change a ledger row to `{sig: "invented"}` or `resolvedBy` and observe that the loop permanently skips the recipient without checking whether the destination received the amount.

**Fix:** Treat the ledger as an intent log, not proof of payment. Verify every claimed signature against the chain, bind it to recipient, mint, source, and amount, and distinguish “operator resolution” from cryptographically verified settlement.

### MEDIUM — coverage refusals remain an operational denial of redemption

The code correctly documents that anyone can dust an asset-signer PDA-owned account and cause the co-signer to refuse. The listed accepted limitation is exploitable as a customer-facing availability attack, not merely an informational nuisance.

**Evidence if true:** Create a token account owned by the vault PDA, deposit a minimal amount, submit an otherwise valid redemption, and observe `stage: 'coverage'` refusal.

**Fix:** Provide a governed emergency procedure with explicit human authorization, chain verification, and audit logging. Do not describe “sign by hand” as an available recovery path unless the procedure is actually implemented and tested.

### MEDIUM — durable nonce rejection is incomplete as a general freshness guarantee

The code rejects `SystemProgram::AdvanceNonceAccount` when the first four data bytes match `[4,0,0,0]`. It does not establish a general transaction freshness bound for ordinary transactions; a partially signed transaction can still be held until its recent blockhash expires, and operational tooling may re-sign or reconstruct it.

**Evidence if true:** Hold a clean transaction through blockhash expiry and observe whether the tool signs stale material or whether the signer rejects it only after inspecting other state. Test nonce instructions in non-first positions and malformed System instructions.

**Fix:** Enforce an explicit recent-blockhash age at signing time and reject all nonce-account instructions, not only one exact byte prefix at one position.

---

## Stronger-than-documented guarantees

The most important confirmed under-claim is in the Bank documentation: SEAL and BURN require the configured Bank as an on-chain signer, so redemption cannot bypass the Bank’s signature even though the Bank’s *policy tool* can be bypassed. That correction is now present.

A further under-claim remains in the distribution header:

> “A row with an intent but no SIGNATURE is neither paid nor unpaid…”

That is not universally true after the repair. Rows with `rejected: true` are classified as `unpaid` and are retried. Rows with `resolvedAs: 'paid'` are classified by `settledAsPayout()` as a payout for cadence while `paymentState()` remains `resolved` and the transfer loop skips them. The comment should describe the complete state machine, not only ambiguous intent rows.

---

## Verdict

The on-chain payer-slot repair appears materially narrower than the prior exemption, and the arithmetic shown is correct. However, the certification machinery is not yet reliable enough to certify the system:

1. `audit19.ts` can audit one tree and report another.
2. The cron installer can accidentally activate live revenue through an unrelated crontab string.
3. Refusal notifications can be amplified indefinitely by a customer-triggerable condition.
4. Manual ledger resolutions can alter payout cadence and suppress payment without cryptographic evidence.
5. The source-scraping gates are still not substitutes for runtime/integration tests.

These should be fixed before treating the round as a clean certification.

## Given that no human firm will ever see this

The project should stop treating model quorum plus source assertions as equivalent to independent assurance. Concretely:

- Require two independently implemented certification pipelines: one source/static pipeline and one black-box validator/integration pipeline.
- Make the certification artifact immutable: commit SHA, dirty-tree rejection, prompt hash, model receipts, test logs, binary hashes, and deployment addresses must be signed and content-addressed.
- Require adversarial mutation testing that changes account order, instruction discriminators, ledger states, cron contents, and RPC responses; certification must fail unless the mutation is detected.
- Add a small, separately maintained reference implementation for payout allocation and payment-state transitions, then compare production output against it.
- Run a scheduled production-like canary with nonvaluable assets and deliberately injected RPC/indexer failures.
- Put payout and redemption operations behind a multisignature operational approval workflow that is independent of the repository’s own scripts.
- Establish a formal incident/recovery exercise: poisoned ATA, missing level, ambiguous transfer, stale ledger, live-cron activation, and compromised operator key must each have a tested, time-bounded recovery path.
- Do not permit the builder who writes the repair to be the sole authority deciding that the repair is certified. If no human firm is available, use a separate repository, separate maintainers, and independently generated tests as the minimum substitute.