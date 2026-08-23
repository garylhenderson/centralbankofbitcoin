# Audit findings

## R1 — self-audit repairs and certification machinery

### HIGH — Dirty-tree detection is advisory, not a gate

**Construct:** `scripts/audit19.ts`

```ts
if(dirty) console.log('  ⚠️ programs/bank/scripts/tests are DIRTY...')
```

The runner records a dirty tree but still launches auditors and can exit successfully when quorum is reached. It also captures `DIFF`, `head`, and `dirty` at different times and never verifies that `HEAD` remains unchanged while the requests run.

A commit, unstaged edit, or generated-file change during the round can therefore produce a manifest claiming a round audited one tree while the prompt, checked-out files, and final repository differ.

**Impact:** Certification can be issued for a non-frozen or internally inconsistent source tree.

**Evidence if true:** Run the auditor with an unstaged change under `programs/`, `bank/`, `scripts/`, or `tests/`; the script prints a warning and can still exit zero. Modify the tree during model requests; `head` and `dirty` remain the initial values.

**Fix:** Refuse to start on a dirty tree. Record a commit hash and cryptographic hash of every prompt input. After all requests, re-run `git rev-parse HEAD`, `git status`, and file hashes; fail if anything changed. Do not use a warning for a condition explicitly described as invalidating the round.

---

### HIGH — Quorum is externally bypassable

**Construct:**

```ts
const MIN_AUDITORS=Number(process.env.MIN_AUDITORS||Math.ceil(MODELS.length*0.75))
```

An operator can run:

```sh
MIN_AUDITORS=0 npx tsx scripts/audit19.ts
```

or set a non-numeric value, producing `NaN`. In the latter case:

```ts
if(good.length<MIN_AUDITORS)
```

is false, so the round succeeds with zero usable reports. `MODELS` is also externally replaceable, allowing a one-model round with a one-model quorum.

**Impact:** The certification gate can be reduced to no auditors or an arbitrarily small roster without changing source code.

**Evidence if true:** Run with `MIN_AUDITORS=0` or `MIN_AUDITORS=x`; the script reaches the receipt and does not set failure status despite no valid quorum.

**Fix:** Hard-code minimum quorum and the approved roster in a signed configuration. Reject `MIN_AUDITORS` values outside `[ceil(0.75 * approvedRoster), approvedRoster]`; reject `NaN`, zero, and roster overrides unless they are explicitly authenticated and recorded as a different audit mode.

---

### MEDIUM — The prompt renderer is not tested as an artifact

The escaped occurrences such as:

```ts
\${FLOORS.onchain}
```

are intentional in the explanatory prose, while other expressions such as `${FLOORS.onchain}` are evaluated. This is difficult to review statically and exactly the class of defect that previously shipped.

The current runner prints only prompt length, not the rendered assertions or a hash of the rendered prompt.

**Impact:** A future escaping edit can silently turn a live value into literal text, or interpolate an unintended expression, while TypeScript still compiles.

**Evidence if true:** Compare the rendered prompt against expected anchors, for example:

```text
All four programs pass a 284-assertion suite
```

and confirm that no literal `${FLOORS...}` remains except where explicitly intended. The current source does not make that comparison a gate.

**Fix:** Render the prompt before API calls and assert exact anchors for every floor, commit range, focus section, and required architecture fact. Store the rendered prompt or its hash in the manifest. Add a test that evaluates both `FOCUS=programs` and `FOCUS=offchain`.

---

### LOW — Manifest records porcelain lines but does not structurally parse them

The change from `.trim()` to raw output is correct for preserving the two-character status prefix. However, the manifest stores each line as an opaque string:

```ts
dirty: dirty.split('\n').filter(Boolean)
```

This is well-formed JSON, but it is not a well-formed structured source-state record. Rename/copy statuses, submodule states, and quoted paths are not represented as fields.

**Impact:** Downstream tooling can misinterpret the audit scope or fail to identify which path was modified.

**Evidence if true:** Create a rename, copied file, or path requiring Git quoting and inspect `MANIFEST-*.json`; it contains raw porcelain syntax rather than normalized status/path data.

**Fix:** Parse `git status --porcelain=v1 -z` or `--porcelain=v2 -z` and store structured `{indexStatus, worktreeStatus, path, originalPath}` entries.

---

## R2 — distribution repairs

### HIGH — Refusal notification turns a permissionless DoS into repeated paging

**Construct:** `bank/distribute.mjs`

```js
if (plan.refusal) {
  ...
  if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
  process.exitCode = 1
}
```

The distribution refusal can be caused by an unlevelled activated vault, which the architecture explicitly says any stranger can create. The new branch pages on every non-dry-run daily execution until an operator repairs the level register.

The refusal is already a known permissionless payout halt. This change adds an operational amplification: a stranger can repeatedly trigger human alerts.

**Impact:** Alert fatigue, paging denial of service, and eventual failure to notice a real treasury incident.

**Evidence if true:** Mint or otherwise introduce an activated vault without a level, run the installed distribution job on successive days, and observe one notification invocation per run plus exit status 1 each time.

**Fix:** Separate state transition from notification. Emit one alert on the transition into a new refusal fingerprint, suppress repeats for a bounded interval, and escalate only after persistence. Preserve nonzero exit status without paging on every run. The suppression state must be durable and must not suppress unrelated payout failures.

---

### MEDIUM — Clearing both verdict flags before execution can erase provenance

**Construct:**

```js
const priorVerdict = st.days[day].refused || st.days[day].nothingToDo
...
delete st.days[day].refused
delete st.days[day].nothingToDo
```

If both flags exist, only one is retained in `supersededWas`; the other is discarded. More importantly, both active verdicts are removed before the plan is durably completed.

If the process saves this intermediate state and then crashes before setting `finishedAt`, later detector behavior depends on the partially written plan and `paid` rows rather than the original refusal/no-pay verdict. The new self-tests cover detector behavior, but not the complete crash ordering.

**Impact:** Loss of evidence about why the day initially halted, and possible divergence between “a plan was attempted” and “the day was successfully completed.”

**Evidence if true:** Construct a ledger containing both flags, force a process termination after the clearing/save point and before `finishedAt`, then run the detector and resume path. The ledger no longer identifies both original verdicts.

**Fix:** Never delete verdict history. Add immutable `priorVerdicts: []`, then mark them superseded only after the new run has durably recorded its start. The detector should use explicit state such as `attempted`, `finishedAt`, and `unpaid`, not disappearance of a prior flag.

---

### MEDIUM — `paymentState` and cadence semantics remain coupled through duplicated interpretation

**Construct:**

```js
export function settledAsPayout(row) {
  if (paymentState(row) === 'paid') return true
  return paymentState(row) === 'resolved' && row?.resolvedAs === 'paid'
}
```

The same row is interpreted by `paymentState` for resend suppression and by `settledAsPayout` for cadence. The code deliberately preserves the “resolved means never resend” behavior, while separately deciding that only some resolved rows reset the hold clock.

That is a valid distinction only if every writer guarantees `resolvedAs`. Existing resolved rows without that field are intentionally interpreted as unpaid for cadence. A historical operator entry saying “paid by hand” but lacking the new machine-readable field will therefore cause earlier payment rather than reset the clock.

The self-tests establish the chosen semantics, but not migration behavior for existing ledger rows.

**Impact:** Historical hand settlements can be ignored by cadence and generate duplicate economic payout decisions, although the row itself will not be resent.

**Evidence if true:** Place a real historical resolved row with a hand-payment explanation but no `resolvedAs`; `paymentState` returns `resolved`, while `settledAsPayout` returns false and `holdDays` ignores the date.

**Fix:** Version the ledger schema and migrate historical resolved rows explicitly. Require `resolvedAs` on new resolved entries; reject ambiguous legacy rows or classify them through an operator-reviewed migration rather than silently guessing.

---

### LOW — The dust assertion does not prove the stated universal bound

The allocator test checks:

```js
r.dust < BigInt(r.activated.length)
```

for a small selected set of `available` values and one synthetic census. It does not test the property for all allocation paths, including zero eligible vaults, duplicate/skipped entries, or boundary amounts around every quotient transition.

The mathematical bound is valid when dust is defined as the sum of per-paid-vault floor remainders and the allocation set is fixed. The test does not independently establish that implementation invariant.

**Impact:** A future change to eligibility or skipped-vault handling could invalidate the comment while the selected examples remain green.

**Evidence if true:** Property-based testing finds an input where `dust >= activated.length`, especially after changing eligibility logic or handling zero balances.

**Fix:** Add property-based tests over random balances, levels, and available amounts, asserting:
- `total + dust == available` when all available funds are allocatable;
- `0 <= dust < paidCount`;
- every paid amount equals the specified floor;
- skipped vaults are excluded consistently from both denominator and dust bound.

---

## R3 — `bank-sign.sh`

### MEDIUM — Canonicalization depends on non-portable coreutils flags

**Construct:**

```sh
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
```

`-w0` is GNU `base64` syntax and is not available on common BSD/macOS installations. Because the command is inside a pipeline and the result is followed by `|| true`, failure is converted into an empty `CANON`; every otherwise-valid transaction is then rejected as non-canonical.

**Impact:** The sanctioned signing path can reject all legitimate transactions on a supported-but-non-GNU host, including the stated 1644-character encoding of a 1232-byte transaction.

**Evidence if true:** Run on a host whose `base64` lacks `-w0`; a valid transaction fails with the canonical-base64 error.

**Fix:** Pin and verify the required coreutils dependency, or use a portable implementation. For example, use Node to decode and re-encode, or detect `base64 --help` capability before signing and fail with a precise installation error. Add a test using the maximum 1232-byte transaction.

---

### LOW — The round-trip check is not a complete command-line portability contract

The hardening correctly rejects noncanonical padding and trailing bits on GNU coreutils, but the script assumes compatible semantics for both `base64 -d` and `base64 -w0`. Different implementations vary in whether they accept ignored whitespace, malformed padding, and partial input.

**Evidence if true:** Run the same test corpus (`====`, `AB==`, `AAB=`, embedded newline, trailing garbage, 1644-character valid input) against the actual deployment images and compare accept/reject results.

**Fix:** Make the decoder/encoder implementation part of the deployment artifact and test it in the exact production image rather than relying on the host command.

---

## R4 — cron installation

### HIGH — Installation still arms a live money-moving job by default

The revised header is honest, but the crontab behavior described in the diff remains dangerous:

- `revenue.mjs` is installed without `--live`, so that job is dormant.
- `distribute.mjs` is installed without `--dry-run`, so it can load the distribution key and send cbBTC.

The header is therefore more accurate than before, but the installation script still converts a routine “install cron” operation into activation of a live customer payout sender.

**Impact:** An operator can believe they are installing monitoring/automation and unintentionally authorize real cbBTC transfers at the next scheduled run.

**Evidence if true:** Run the script in a disposable environment, inspect the generated crontab, and invoke the exact `distribute.mjs` line with a funded test ledger. It executes the send path without a `--live` or equivalent explicit arming token.

**Fix:** Make both jobs opt-in. Install distribution with `--dry-run` by default, and require an explicit `--live-distribute` installer argument plus a confirmation and persisted activation marker. The crontab should not become money-moving merely because the installer succeeded.

---

## R5 — selftest gates

### HIGH — The certification suite still trusts source regexes for Rust account semantics

**Construct:**

```ts
const body = (src.match(/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/) || [])[1] || ''
return [...body.matchAll(/^\s*pub (\w+):/gm)].map(m => m[1])
```

The parser stops at the first line consisting of a closing brace. It is not a Rust parser. A comment, macro argument, nested inline type, or future formatting construct containing a line-level `}` can truncate the body. The fallback is an empty list, but the test compares the parsed result to the declared constant and can then fail closed only if this arm actually runs and fails the suite.

More importantly, the parser checks only field names, not the actual Anchor-generated account order, account attributes, or whether the handler’s positional assumptions match the serialized instruction construction.

**Impact:** A future account-layout change can either produce a false failure or, if the test is weakened around the parser, permit a stale positional constant.

**Evidence if true:** Add a brace-containing comment or legal Rust construct before the end of `MintVault`; the extracted field list changes. Compare the parser’s output to `anchor expand` or the actual generated IDL/account order.

**Fix:** Use the compiler/Anchor IDL as the source of truth, or parse Rust with a real syntax parser. Better still, eliminate the positional security constant by validating the account at the actual semantic position and add an integration test that proves the Bank-as-payer instruction is rejected on the deployed binary.

---

### MEDIUM — `isTableRow` silently excludes valid Markdown table rows

**Construct:**

```ts
const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)
```

This recognizes only rows with exactly:
- no leading whitespace,
- `| `,
- a first-cell pattern compatible with greedy `.*`,
- another `| `,
- and the control classification immediately formatted as `**... .**`.

It misses otherwise valid rows with alignment spaces, escaped pipes, different Markdown spacing, or a classification column containing formatting changes. A row missed by the parser disappears from `tableRows`, so the consistency checks may never inspect it.

**Impact:** Documentation drift can be reintroduced by formatting a control row rather than deleting it.

**Evidence if true:** Change a real control row to `|  name | **ON-CHAIN.** ...` or add a leading space; `isTableRow` returns false and the gate continues.

**Fix:** Parse the SPEC table structurally, validate the expected header and exact row count, and fail if any line in the table region cannot be parsed. Do not define table membership solely by the value of one cell.

---

### MEDIUM — The `nothingToDo` tests prove detector suppression, not writer correctness

The new tests show that a manually supplied stale `nothingToDo` suppresses `distribution_unfinished`. They do not prove that:
- every path that begins a payout clears it;
- a dry run cannot clear it;
- a crash cannot leave it stale after partial payout;
- two same-day runs preserve the correct state;
- `refused` and `nothingToDo` are both cleared when both are present.

**Impact:** The exact failure mode is documented and tested in the detector, while the state transition that prevents it is largely untested.

**Evidence if true:** Inject failures between verdict clearing, plan persistence, transfer persistence, and `finishedAt`; inspect whether a half-finished day becomes silent.

**Fix:** Add end-to-end fault-injection tests around every save boundary and process termination point. Assert detector output after each intermediate ledger state.

---

### LOW — Shell comment stripping is intentionally incomplete

**Construct:**

```ts
const codeOnly = src => src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
```

For shell, a `#` is not a comment when it occurs inside a word or quoted string, for example:

```sh
echo "# not a comment"
TX='abc#def'
```

The current filter removes only lines whose first non-whitespace character is `#`, which is appropriate for ordinary full-line comments, but it is not a shell parser. It can still misclassify multiline constructs, here-documents, or lines where the executable content is preceded by shell syntax.

**Impact:** The source gate can be fooled by shell syntax that places relevant text in a non-leading position or spans lines.

**Fix:** Test the actual executable AST/behavior, or use a shell parser. At minimum, extract the final `exec` command using a parser-aware implementation and add here-doc, quoted-`#`, and continuation-line cases.

---

## R6 — counts and arithmetic

### MEDIUM — The floor mechanism checks minimum assertion count, not assertion identity or coverage

**Construct:** `scripts/run-tests.sh`, `bank/distribute.mjs`, and `bank/selftest.mjs`

The suite floors are read dynamically, which prevents stale numbers in the prompt. It does not prevent a test author from deleting meaningful assertions and adding trivial assertions until the count reaches the floor.

The same issue applies to the off-chain detector floor: a numerical count is not a coverage guarantee.

**Evidence if true:** Replace a substantive test with multiple constant-true tests; the floor remains satisfied and the runner exits zero.

**Fix:** Assign stable IDs to assertions, maintain an expected manifest of IDs and categories, and fail on deletions or category shrinkage. Require mutation testing for security-critical checks and record changed assertion IDs in the round receipt.

### Arithmetic verification

The two weighted denominators are correct:

- `108×2 + 60×3 + 36×4 + 24×5 + 12×6 = 732`
- `945×2 + 525×3 + 315×4 + 210×5 + 105×6 = 6,405`

The level shares for either proportionally scaled census are:

- Level I: `216 / 732 = 29.508...%` → **29.5%**
- Level II: `180 / 732 = 24.590...%` → **24.6%**
- Level III: `144 / 732 = 19.672...%` → **19.7%**
- Level IV: `120 / 732 = 16.393...%` → **16.4%**
- Level V: `72 / 732 = 9.836...%` → **9.8%**

Rounded to one decimal place they sum to **100.0%**.

The supplied material does not include the ten customer-facing “per $1,000” figures, so those cannot be independently verified here without the relevant card/source values. They should not be certified solely because a test reproduces them.

---

# Carry-over and newly exposed adjacent issues

### MEDIUM — Governance can bypass the stated minimum sweep cap

**Construct:** `update_wiring`

```rust
let needs_governance =
    ...
    || max_sweep_lamports.map_or(false, |x|
         x > c.max_sweep_lamports || x < MIN_ADMIN_SWEEP_LAMPORTS);
```

The intent appears to be:
- admin can tighten within the safe operating range;
- governance is required for values below `MIN_ADMIN_SWEEP_LAMPORTS`.

But after governance is supplied, the actual update only requires:

```rust
require!(x > 0 && x <= MAX_SWEEP_LAMPORTS, ...)
```

Thus governance can set `max_sweep_lamports` to `1`, despite the initialization floor and the stated `MIN_ADMIN_SWEEP_LAMPORTS = 1 SOL`.

**Impact:** A governance-authorized configuration can reduce every sweep to a negligible amount and effectively wedge or severely delay revenue conversion. This is at least a consistency defect and potentially a governance-induced availability attack.

**Evidence if true:** Submit `update_wiring(max_sweep_lamports=1, governance=correct signer)`; the transaction succeeds.

**Fix:** Enforce the minimum unconditionally, or explicitly define a separate governance emergency range and document/test the resulting liveness behavior. Do not use a “requires governance” predicate as a substitute for the bound itself.

---

### LOW — Rotation application functions expose a misleading shared error model

`apply_pending_admin`, `apply_pending_bank`, and `apply_pending_operator` all use `NoPendingGovernance` / `GovernanceTimelockActive` even for non-governance rotations. This is not a fund-loss issue, but it makes operational automation and alert classification unreliable.

**Fix:** Define rotation-specific errors or a generic typed pending-rotation error.

---

# Documentation under-claims and over-claims

The revised SEAL/BURN prose correctly distinguishes:
- the on-chain mandatory Bank signature;
- the off-chain policy scanner;
- the fee-payer and allowlist limitations.

However, the BURN documentation still says the Bank “must SCAN THE PDA BEFORE IT SIGNS,” while the on-chain program only requires the signature and performs no scanner operation. The scanner is in `bank/cosign.mjs`, is human-invoked, and can be bypassed by another signing tool. The text later qualifies this, but the opening operational claim is still stronger than the actual mandatory control.

This should be rewritten as:

> BURN requires the Bank signature on-chain. The sanctioned human signing tool additionally scans the transaction and PDA state, but that scan is policy, not an on-chain guarantee.

That distinction matters because a reader may infer that every valid burn was scanner-approved.

---

# Overall verdict

The on-chain Bank-key confinement appears materially stronger than the previous version, and the supplied code does not establish a new direct customer-fund theft comparable to the earlier mint payer flaw. The remaining high-risk issues are operational and certification-related:

1. The audit runner can certify a dirty or changing tree.
2. Its quorum can be bypassed through environment variables.
3. A permissionless payout refusal now creates a repeated paging vector.
4. Cron installation still arms live cbBTC distribution by default.
5. The sweep-cap minimum is not enforced once governance supplies its signature.
6. The test additions validate assertion counts and isolated detector behavior more strongly than they validate crash-safe ledger state transitions.

# What to do when no human firm will ever see this

This project should stop treating model agreement and assertion floors as certification evidence by themselves. It needs independent, reproducible controls that the same author cannot silently weaken:

- Build release artifacts in a hermetic container from a signed commit, with reproducible hashes for all four programs and the exact deployed `.so` files.
- Require a separate release key or multisig to approve the commit hash, binary hashes, configuration accounts, and audit manifest together.
- Run differential transaction-fuzzing against both the local validator and a second Solana implementation/version, especially for composed top-level transactions containing arbitrary instructions before, between, and after project instructions.
- Add state-machine fault injection for every ledger save boundary, process termination point, duplicate run, dry run, refusal, partial payout, and notification failure.
- Use mutation testing on the security gates: mutate account indices, discriminators, table parsers, verdict clearing, and quorum checks, and require each mutation to fail a test.
- Make deployment impossible unless an independent environment verifies the live program IDs, upgrade authorities, config accounts, reserve list, Bank, treasury, operator, and cron command lines against the approved manifest.
- Perform a staged release with capped funds and a withdrawal/redeemption drill using real deployed binaries before allowing customer balances.
- Maintain an incident procedure that can pause minting, disable sweeping, rotate the operator, and preserve immutable evidence without editing the money ledger.
- Have at least two people who did not author the code perform the key ceremony and deployment verification, even if they are not an audit firm. AI cannot independently attest that the operator has not changed the tree or configuration while it is auditing it.