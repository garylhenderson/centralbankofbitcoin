## R1 — self-audit repairs

### HIGH — `supersede()` can still silently erase the only useful unfinished-run evidence

**Construct:** `bank/distribute.mjs`:

```js
for (const mark of DONE_MARKS) delete out[mark]
```

The function removes `finishedAt`, `nothingToDo`, and `resolvedBy`, then records only the two prior no-pay values in `supersededWas`.

The preservation of `finishedAt` is conditional on:

```js
const alreadyPaid = Boolean(rec?.plan) ||
  Object.values(rec?.paid || {}).some(settledAsPayout)
```

That is not a sufficient definition of a completed day. A stale `plan` or a single signed payment does not prove that all planned transfers completed. If a day has a plan, one successful payment, an old `finishedAt`, and unresolved or missing transfers, the function preserves `finishedAt`. The detector then suppresses `distribution_unfinished`, depending on the detector’s exact predicate.

**Impact:** A partially paid day can remain classified as finished. Unpaid holders may not be retried or alerted, while the ledger appears complete.

**Evidence if true:** A ledger record such as:

```js
{
  plan: { activated: ["a", "b"], per: { a: "100", b: "100" } },
  paid: { a: { sig: "real" }, b: { sig: null } },
  finishedAt: "...",
  nothingToDo: "stale"
}
```

passed through `supersede()` retains `finishedAt`, and `detectDistribution()` emits no unfinished finding.

**Fix:** Define completion from the plan’s full obligation set, not from existence of any plan or any successful row. Preserve `finishedAt` only if every planned vault is definitively settled or explicitly skipped, and add a test for a partially paid planned day.

---

### MEDIUM — `DONE_MARKS` is still a manually maintained list despite the claimed derived invariant

**Construct:** The code says the suppressor list is not hand-kept, but defines:

```js
export const DONE_MARKS = ['finishedAt', 'nothingToDo', 'resolvedBy']
```

The self-test derives suppressors with:

```js
/!rec\.(\w+)/g
```

This only recognizes one source spelling. It will miss equivalent forms such as:

```js
!(rec.finishedAt)
rec.finishedAt === undefined
!Object.hasOwn(rec, 'finishedAt')
```

If `detectors.mjs` adds a suppressor using another expression, the test may derive an incomplete `needed` set and still pass.

**Impact:** A future detector change can reintroduce the fail-open state the repair is intended to prevent.

**Evidence if true:** Changing the detector predicate from `!rec.finishedAt` to `!(rec.finishedAt)` leaves `needed` incomplete and the suite green.

**Fix:** Export one shared detector predicate or shared suppressor definition and use it in both detection and supersession. Do not parse JavaScript with a regex as the source of truth.

---

### MEDIUM — Audit prompt rendering is tested statically, not actually rendered

**Construct:** `bank/selftest.mjs` checks source text in `audit19.ts`:

```js
const floorLine = a19.split('\n').find(...)
```

and checks whether that source line contains `${FLOORS...}`. It does not execute TypeScript or render `PROMPT`.

**Impact:** Escaping defects involving multiline interpolation, concatenation, nested template literals, or interpolated `DIFF`/`BUNDLE` content can pass the gate while producing a wrong prompt.

**Evidence if true:** A syntactically valid edit such as moving a floor interpolation to a concatenated line or escaping it in a multiline construction can make the rendered prompt wrong without changing the inspected `floorLine`.

**Fix:** Import or execute the prompt builder in a subprocess with fixed fixtures and assert against the actual rendered output. Also assert that the rendered prompt contains the expected diff and every target file.

---

### LOW — The manifest is JSON-valid but not a robust git-status record

**Construct:**

```js
dirty: dirty.split('\n').filter(Boolean)
```

This stores porcelain lines as strings rather than structured status/path records.

**Impact:** Consumers must parse status text themselves, and unusual path quoting or status formats can be misinterpreted. The record is technically valid JSON but not a stable machine-readable manifest.

**Evidence if true:** A rename, copied path, or unusual quoted filename produces a `dirty` entry that a downstream consumer cannot reliably classify.

**Fix:** Use `git status --porcelain=v1 -z` and encode `{status, path}` records, or store the exact NUL-delimited status blob separately with an explicit format version.

---

## R2 — distribution pipeline

### HIGH — A public activation can become a recurring paging denial of service

**Construct:** `allocateWeighted()` returns:

```js
{ refusal: true, skip: ... }
```

for an activated vault with no level. `main()` then:

```js
execFileSync(NOTIFY, [msg, 'cbob-distribute'])
process.exitCode = 1
```

Any customer can create or acquire an activated vault that is absent from `levels.json`, assuming the Bank signs the mint. Every daily run then pages the operator until the off-chain register is edited.

The design intentionally halts payouts rather than silently excluding the vault, but the repair converts the same customer-triggerable condition into an operator paging event.

**Impact:** A customer can repeatedly interrupt daily distribution operations and train operators to ignore or suppress genuine alerts. This is a real griefing-to-paging escalation, not merely a cosmetic exit-code change.

**Evidence if true:** Mint one activated vault with no level, run the distributor on successive days, and observe an SMS/notification invocation and exit code 1 on each run.

**Fix:** Separate safety halt from paging policy. Persist one deduplicated refusal incident keyed by `{day, reason, asset}`; page once or escalate through rate-limited alerting. Keep the nonzero exit status, but do not send a fresh human page on every scheduled retry.

---

### HIGH — `supersede()` preserves `finishedAt` for partially completed plans

This is the operational form of the R1 issue and directly affects customer payouts.

**Construct:** The function treats either `rec.plan` or one `settledAsPayout()` row as evidence that the day is already paid:

```js
const alreadyPaid = Boolean(rec?.plan) ||
  Object.values(rec?.paid || {}).some(settledAsPayout)
```

A plan is written before transfers begin. Therefore, the presence of `plan` says only that the plan was prepared, not that the day completed.

**Impact:** If a refusion/no-pay record is followed by a plan, one transfer succeeds, and the process crashes, a subsequent supersession can preserve `finishedAt`. This suppresses the unfinished detector and can leave remaining obligations unresolved.

**Evidence if true:** Run a fixture with a plan for two vaults, one signed payment, one absent/ambiguous payment, and a stale `nothingToDo`. Verify that `finishedAt` survives and the detector remains quiet.

**Fix:** Replace `alreadyPaid` with an explicit `isComplete(plan, paid)` predicate requiring every planned item to be paid or deliberately skipped. A plan alone must never preserve completion.

---

### MEDIUM — `paymentState()` and `settledAsPayout()` deliberately interpret the same row differently, but no schema prevents contradictory states

**Construct:** `paymentState()` considers any `sig` truthy as paid and any `resolvedBy` as resolved. `settledAsPayout()` additionally accepts:

```js
row.resolvedAs === 'paid'
```

There is no validation rejecting contradictory rows such as:

```js
{ sig: "real", resolvedAs: "unpaid" }
{ sig: null, resolvedBy: "...", resolvedAs: "paid", rejected: true }
```

**Impact:** Different callers can classify the same row as paid, resolved, or retriable depending on which helper they call. A manually edited ledger can alter cadence without changing resend behavior.

**Evidence if true:** Put contradictory rows into the ledger and compare `paymentState`, `settledAsPayout`, `supersede`, and the payment loop. Their decisions differ.

**Fix:** Define and validate a finite row state machine. Reject contradictory combinations on load; make cadence and resend decisions consume the same validated state object.

---

### MEDIUM — `census()` returns a normal object again, reintroducing prototype-key ambiguity for consumers

**Construct:**

```js
const c = Object.create(null)
...
return { ...c }
```

The internal count is safe, but the returned object has `Object.prototype`. The stated reason for the change is serialization compatibility, yet no consumer-side validation ensures that deserialized census values are own numeric properties.

**Impact:** A forged or corrupted ledger census containing `constructor`, `toString`, or nonnumeric values can be interpreted differently by consumers. `denominator()` is protected against inherited properties but not against own properties with malicious values or wrong types.

**Evidence if true:** Deserialize:

```js
{ "I": 1, "constructor": "x" }
```

and pass it through consumers. JSON serialization succeeds, but arithmetic or reporting may concatenate or produce `NaN`.

**Fix:** Serialize a schema-validated array or fixed five-field structure. Validate each level as an own integer in `[0, ...]` before denominator calculation.

---

### MEDIUM — The dust bound is true only for the allocation result, not necessarily for the customer-facing retained pool

The mathematical claim `dust < activated.length` is valid when every activated vault receives a computed floor and dust is `available - total`. However, the implementation returns `dust: 0n` on skip paths, including when `available` is below the minimum threshold, while the actual pool retains the entire available balance.

**Impact:** The documentation can be read as saying retained balance is always under one satoshi per activated vault. During threshold skips, the retained amount can be arbitrarily larger.

**Evidence if true:** With 2,100 activated vaults and `available = 20,000`, `allocateWeighted()` returns `skip` and `dust = 0`, while 20,000 sats remain undistributed.

**Fix:** Distinguish `allocationDust` from `heldPool`. Document the bound only for a settlement that actually allocates, and expose the held balance explicitly.

---

## R3 — `bank-sign.sh`

### LOW — The canonical round trip is GNU/coreutils dependent and the script does not preflight the dependency

**Construct:**

```sh
base64 -d
base64 -w0
```

The script silently depends on GNU `base64`, especially `-w0`.

**Impact:** On a host with BSD base64 or another implementation, legitimate transactions are refused. This is fail-closed rather than a theft, but the sanctioned signing path can become unavailable exactly when a redemption is needed.

**Evidence if true:** Run on macOS/BSD base64 or a minimal container: `base64 -w0` fails, `CANON` becomes empty, and every transaction is refused.

**Fix:** Preflight and require a known implementation, or use a portable Node/Python helper with explicit canonical validation. Add a test for the actual supported host matrix.

The 1232-byte transaction case is legitimate: 1232 bytes encode to 1644 base64 characters, which is divisible by four and should pass.

The corrected comment is accurate only because it says “of this script”; the transaction is still visible in the `cosign.mjs` process argument vector.

---

## R4 — cron installation

### MEDIUM — The header’s first-line money claim is false on reruns

**Construct:** The file begins:

```text
INSTALLING THIS ARMS A LIVE cbBTC SENDER
```

but later preserves an existing tagged `--dry-run` distribution line. Therefore, rerunning the installer can produce a dry-run distribution job and no live cbBTC sender.

**Impact:** Operators can read the headline as proof that live distribution is armed, while the actual installed job is dry-run. The inverse operational mistake is also possible if a stale or malformed tagged line causes a flag to be preserved unexpectedly.

**Evidence if true:** Install a tagged distribute line containing `--dry-run`, rerun the installer, and inspect `crontab -l`: the job does not move money despite the unqualified header.

**Fix:** Make the header conditional and state that the script preserves existing posture. Better, require an explicit installation mode such as `--live-distribute` or `--dry-run-distribute`; do not infer money posture from prior crontab text.

---

### MEDIUM — Flag preservation trusts any uncommented tagged line, not the canonical job identity

**Construct:**

```sh
ours() { grep -F "$TAG" <<<"$CUR" | grep -v '^[[:space:]]*#'; }
if ours | grep -q 'revenue\.mjs --live'; then ...
```

Any uncommented line containing the tag and the matching text qualifies. It need not be the project’s actual revenue cron line, use `/opt/cbob-vaults`, or have the expected schedule.

**Impact:** A malformed operator line, another command, or a manually added line can arm `--live` or preserve `--dry-run` in the newly generated canonical job.

**Evidence if true:**

```cron
@reboot echo revenue.mjs --live #cbob-vault-cron
```

causes the generated revenue cron to receive `--live`.

**Fix:** Parse and match the complete canonical job identity: schedule, repository path, executable, script, tag, and job suffix. Preserve flags only from exactly one matching line.

---

## R5 — self-test gates

### HIGH — The ON-CHAIN documentation gate does not bind the claim to the named instruction

**Construct:** `onChainBankPin()` returns true if a file contains, anywhere:

```js
/pub bank: Signer<'info>/
```

and anywhere:

```js
/require_keys_eq!\(\s*ctx\.accounts\.bank\.key\(\),/
```

It does not prove that the named control’s instruction contains both checks.

**Impact:** Removing the Bank check from `open_for_redemption` while leaving a similar check in another instruction can leave the documentation gate green. The gate certifies file-level coincidence, not the documented control.

**Evidence if true:** Move the `require_keys_eq!` call into an unrelated instruction while deleting it from the redemption handler. `onChainBankPin()` still returns true.

**Fix:** Parse the named Anchor instruction or use explicit source markers generated from the Rust AST. At minimum, check that the `bank: Signer` field and equality check occur within the same handler/account context.

---

### MEDIUM — `isTableRow()` misses valid Markdown table shapes

**Construct:**

```js
/^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/
```

It requires a leading pipe followed by exactly one space and a classification in a particular formatting position. `controlTableBlock()` separately requires:

```js
lines[i].startsWith('|')
```

A real row with indentation, no space after a pipe, or a blank/intervening formatting line is not included in the checked block.

**Impact:** A malformed or differently formatted control row can be omitted from `rows`, while the count of recognized rows remains at least five. The gate then certifies only the subset it understands.

**Evidence if true:** Add:

```markdown
 | **NEW CONTROL** | ... | **PROCEDURE.** ...
```

or a row with a formatting variation. The block terminates or `isTableRow()` rejects it, and the existing recognized-row count can remain unchanged.

**Fix:** Parse the table structurally, identify the header and all contiguous data rows, and require every data row to have exactly four cells and one recognized classification.

---

### MEDIUM — `errNames()` still misses legal Rust/Anchor error variants

**Construct:**

```js
/^\s*(?:#\[msg\("[^"]*"\)\]\s*)?(\w+),\s*$/gm
```

It does not handle attributes between `#[msg]` and the variant, multiline attributes, explicit discriminants, or struct-like variants. The enclosing enum-body regex is also not a Rust parser.

**Impact:** A new `BankKeyOutside*` variant can be emitted by the program but remain invisible to the documentation gate.

**Evidence if true:** Add a legal variant with another attribute or a multiline `#[msg]`; the program compiles, but `errNames()` omits it.

**Fix:** Generate the error-variant list from the compiled IDL/build artifact, or use a Rust parser. Do not use regex as the authoritative inventory of emitted errors.

---

### MEDIUM — `codeOnly()` is not a shell parser

**Construct:**

```js
src.split('\n').filter(l => !/^\s*#/.test(l))
```

A `#` is not a comment inside quotes, command substitutions, heredocs, or escaped contexts. Conversely, the function removes lines that may be data in a heredoc rather than shell comments.

**Impact:** The gate can both false-positive and false-negative when source text appears in shell data. It cannot prove that exactly one executable `exec` line exists.

**Evidence if true:** Add a quoted heredoc or a command containing an embedded `#` and an exec-like line. The text scraper reports a result different from shell execution.

**Fix:** Test behavior by executing a fixture or parse shell with a real shell AST. Do not rely on line-level comment stripping for a security gate.

---

## R6 — counts and arithmetic

The published arithmetic is internally correct:

- `108·2 + 60·3 + 36·4 + 24·5 + 12·6 = 732`
- `945·2 + 525·3 + 315·4 + 210·5 + 105·6 = 6,405`
- Level V weight is `6 / 2 = 3×` Level I.
- The displayed per-$1,000 figures and rounded percentages are consistent with those denominators.
- The five 2,100-vault shares sum to 100.0% after rounding.

The floors quoted in `run-tests.sh` are `286`, `434`, `93`, and `19`, matching the stated current counts in the supplied files.

No arithmetic finding is warranted from the supplied diff. The problem is that the suite requires manually maintained equality constants, which remains structurally fragile.

---

## Carry-over and broader findings

### HIGH — The advertised “85/15 enforced” split is not actually fixed at 85/15

**Construct:** `MintConfig.split_bps` is mutable through `update_wiring()`:

```rust
if let Some(x) = split_bps {
    require!(x <= 10_000 && x % 100 == 0, MintError::BadSplit);
    c.split_bps = x;
}
```

`split_revenue()` uses the live value:

```rust
let bank_cut = total * (10000 - cfg.split_bps) / 10000;
```

The allowed range includes `0`, `10,000`, and every whole-percent value. A governance signer can therefore change the payout from 85/15 to 0/100, 100/0, or another ratio.

**Impact:** The customer-facing claim that the split is an enforced 85/15 rule is false. Depending on governance compromise or intended governance action, holders can receive nothing or a different share.

**Evidence if true:** Set `split_bps = 0` or `10_000`, call `split_revenue`, and observe the holder/bank transfer amounts change accordingly.

**Fix:** If 85/15 is a product invariant, remove `split_bps` from mutable configuration and use a compile-time constant or only permit exactly `8_500`. If variable governance-controlled splits are intended, correct every document and detector to describe a governance-controlled split rather than an enforced 85/15 promise.

---

### HIGH — The Bank signer key still has no mandatory custody enforcement

This is documented as a limit, but it is worse operationally than the wording suggests.

**Construct:** The repository gates the sanctioned path, yet a holder of `bank.json` can use `web3.js`, `solana`, or another process to sign directly. The on-chain programs enforce only that the configured public key signed; they do not enforce the inspection policy.

**Impact:** A compromised or malicious Bank key can approve a transaction that bypasses `judgeRedemptionTx`, including an otherwise policy-refused transaction. The on-chain confinement limits direct Bank-key drains in the covered programs, but it does not enforce the allowlist, fee-payer rule, durable-nonce policy, or PDA-ownership coverage.

**Evidence if true:** Produce a valid transaction with the correct Bank signature using a tool other than `bank-sign.sh`; it executes if the on-chain constraints pass.

**Fix:** Move the Bank secret into an external signer/HSM or multisig design that enforces transaction policy before signing. Repository grep gates are not custody controls.

---

## Verdict challenge — stronger guarantees that are still understated

The documentation now correctly says the Bank’s signature is mandatory, but several places still blur the stronger on-chain guarantee with the weaker off-chain policy:

- `bank/cosign.mjs` describes the on-chain confinement as “belt-and-braces,” even though SEAL and MINT now refuse covered misuse without the tool.
- The control table says the co-signer is procedure, but the row and surrounding prose remain easy to read as saying the Bank itself is optional.
- The MINT documentation says the Bank may appear only in the bank slot, but the code also requires the complete instruction walk to reach its own current index. That fail-closed property should be stated as an on-chain guarantee, not left in comments around the implementation.

This is primarily a documentation/customer-expectation defect. The fix is to state separately:

1. Bank signature required on-chain.
2. Bank-key confinement required on-chain for SEAL and MINT.
3. Policy inspection, allowlist, fee payer, and completeness scan are off-chain and skippable by anyone holding the key.

---

## What to do because no human firm will ever see this

1. **Require an independent execution authority for every release.** The person or process writing the fix must not be able to approve the same commit. Use protected branches, signed release tags, and a second organization-controlled approval key.

2. **Make the test harness consume generated artifacts, not source regexes.** Generate Anchor instruction/account/error inventories, cron job manifests, and prompt target manifests during the build. Security properties should compare machine-readable artifacts, not search comments and Rust text.

3. **Run differential tests against a real frozen deployment.** For every money-moving instruction, replay adversarial transactions against the exact release binary and pinned Core binary, then compare balances, account ownership, and emitted events before and after.

4. **Use property-based and state-machine testing for the ledger.** Generate crashes at every write/send boundary, contradictory rows, retries, refusals, manual resolutions, same-day reruns, and partial plans. Assert that no state both suppresses unfinished detection and contains unresolved obligations.

5. **Put the Bank and swap operator behind hardware or policy-enforcing signers.** Software conventions, filename scans, and “sanctioned paths” cannot constrain a private key holder.

6. **Create a permanent red-team corpus of previously accepted false findings and real defects.** Each release must run every old exploit transaction, not merely the assertions that replaced it. A source-level test can remain green while the behavioral exploit returns through a different instruction or account ordering.

7. **Have an operator perform a controlled mainnet rehearsal with zero-value assets and real cron installation.** Verify the actual crontab, notification behavior, lock behavior, key permissions, restart behavior, and rollback procedure on the production host—not in a local validator or source fixture.

8. **Require a signed release receipt containing hashes of all four program binaries, Core, scripts, configuration, prompt bundle, and test outputs.** The receipt must be generated after the final tree is frozen and independently verified before deployment.