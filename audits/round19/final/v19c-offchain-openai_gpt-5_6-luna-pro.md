## R1 — self-audit repairs and certification machinery

### HIGH — Auditor roster can be duplicated to manufacture quorum

**Construct:** `scripts/audit19.ts`

```ts
const MODELS=(process.env.MODELS||[...].join(',')).split(',')
const MIN_AUDITORS=...Math.ceil(MODELS.length*0.75)
```

`verifyRoster()` checks that every ID exists, but does not require unique IDs. An operator can set:

```bash
MODELS=x-ai/grok-4.6,x-ai/grok-4.6,x-ai/grok-4.6,x-ai/grok-4.6,...
```

The runner then sends multiple requests to the same model, counts them as independent auditors, and can produce a manifest claiming quorum.

**Gain:** The certification process can claim model diversity and quorum without receiving independent reviews. This defeats the explicit requirement that the second clean round use a different roster and undermines the entire certification result.

**Evidence if true:** `MANIFEST-*.json` contains duplicate model IDs; `requested` and `auditors` count duplicates as separate auditors; the process exits successfully despite having only one distinct model.

**Fix:** Normalize and reject duplicates before launch. Compute quorum from the number of distinct verified model IDs. Do not permit `MODELS` to replace the roster without an independently reviewed roster policy; at minimum, require a unique ordered set and record `distinctModels`.

---

### MEDIUM — The “derived” suppressor check is itself pattern-fragile

**Construct:** `bank/selftest.mjs`

```js
const needed = [...guard.matchAll(/!rec\.(\w+)/g)].map(...)
```

The test claims to derive every suppressor used by `detectDistribution`, but only recognizes the exact textual form `!rec.field`. A future detector change such as:

```js
rec.finishedAt === undefined
!(rec.finishedAt)
!Boolean(rec.finishedAt)
rec['finishedAt'] == null
```

can add a suppressor that the self-test does not discover. Existing suppressors keep `needed.length > 0` true, so the test remains green.

**Gain:** A future suppressor can again be added to the detector without being cleared by `supersede`, recreating the fail-open unfinished-day condition.

**Evidence if true:** Modify the detector’s guard to add a suppressor using any non-`!rec.X` form while retaining one existing `!rec.X`; the self-test still passes and `DONE_MARKS` remains unchanged.

**Fix:** Do not parse JavaScript with a narrow regex. Export a shared predicate or shared suppressor metadata from `detectors.mjs`, and test the writer against that executable/shared definition. If source analysis remains necessary, fail closed whenever the guard cannot be parsed completely.

---

### MEDIUM — `supersede()` preserves `finishedAt` after any payout, including partial payout

**Construct:** `bank/distribute.mjs`

```js
const alreadyPaid = Boolean(rec?.plan) ||
  Object.values(rec?.paid || {}).some(settledAsPayout)

if (alreadyPaid && rec?.finishedAt !== undefined)
  out.finishedAt = rec.finishedAt
```

A single successful payment is treated as proof that the day is finished. A day can have one successful transfer and other unpaid, ambiguous, or failed transfers.

The self-test explicitly locks in this behavior:

```js
const noPlan = {
  startedAt: 'x',
  finishedAt: 'y',
  nothingToDo: 'stale',
  paid: { v1: { sig: 'REAL', amount: '100' } }
}
```

**Gain:** If this state reaches `supersede()`, a later crash can retain an old `finishedAt` and suppress `distribution_unfinished`, hiding unpaid holders.

**Evidence if true:** A record with stale `nothingToDo`, an old `finishedAt`, one paid row, and one unresolved row is superseded; the resulting record still has `finishedAt`, and `detectDistribution()` emits no unfinished finding after a simulated crash.

**Fix:** Preserve `finishedAt` only if the persisted plan is demonstrably complete and all planned recipients are settled or intentionally skipped. A single paid row is not sufficient. The production caller currently avoids some of this state through its plan branch, but the exported repair is unsafe and the test treats the unsafe state as correct.

---

## R2 — distribution and cadence

### HIGH — A permissionless unlevelled activation is now an SMS/paging griefing vector

**Construct:** `bank/distribute.mjs`

```js
if (plan.refusal) {
  ...
  if (!DRY) {
    try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {}
  }
  process.exitCode = 1
}
```

An activated vault with no level causes the entire distribution to refuse. Activation is permissionless, and the level register is off-chain. The refusal is persisted, pages the operator, and repeats on subsequent daily executions until the register is corrected.

**Gain:** An attacker can activate one vault with the required balance and force all holders to miss distributions while also generating recurring SMS pages. Repeated pages can cause alert fatigue, operator suppression, or exhaustion of the notification channel. This is not merely the already-documented payout halt; the repair converts that halt into a persistent paging surface.

`--dry-run` also exits 1, so health-check wrappers may repeatedly report failure even though no live payment was attempted.

**Evidence if true:** Create an activated vault absent from `levels.json`; run the daily job twice. Both runs send `cbob-distribute` notifications and return exit code 1, while no holders are paid.

**Fix:** Separate emergency halt detection from paging policy. Persist one incident ID/fingerprint and page once per new refusal or escalation, not once per run. Keep the nonzero exit status, but rate-limit or deduplicate notifications. Consider a controlled quarantine path for newly activated, unassigned vaults rather than allowing one vault to halt the entire system.

---

### MEDIUM — The cadence default is directionally correct but the published ceiling remains conditional

The new `settledAsPayout()` behavior is directionally correct: not resetting the clock makes `holdDays` larger, so the 31-day ceiling is reached sooner. The assertions support that.

However, the ceiling is bypassed for zero available funds:

```js
if (smallestPer < MIN_PER_VAULT)
  return { pay: false, forced: false, ... }
```

This means a holder can wait indefinitely when the pool cannot produce at least one satoshi per activated vault. The new SPEC wording appears corrected, but the code still uses `MAX_HOLD_DAYS` as a conditional ceiling rather than a universal monthly bound.

**Severity:** LOW as an already-disclosed product rule, but it must not be represented anywhere as “monthly maximum” without the liquidity qualifier.

**Evidence if true:** `decideEmission({ smallestPer: 0n, daysSinceLastPayout: 365 })` returns `pay: false`.

**Fix:** Keep the conditional wording consistently in every customer-facing document and interface. If the business requirement really is a maximum wait, define what happens to an insufficient pool rather than silently allowing unbounded delay.

---

## R3 — base64 wrapper

No demonstrated fail-open canonical-base64 bypass remains in the supplied code. The round trip rejects noncanonical trailing bits, excess padding, and truncated quanta. A legitimate 1232-byte transaction produces 1644 base64 characters and is not rejected by the length check.

There is, however, an availability portability issue:

### LOW — GNU `base64 -w0` is an undocumented platform dependency

**Construct:**

```bash
CANON=$(printf '%s' "$TX" | base64 -d ... | base64 -w0 ...) || true
```

On systems with BSD base64 or another implementation without `-w0`, the command fails and the transaction is rejected.

**Gain:** No fund theft, but the sanctioned Bank signing path becomes unavailable after migration, OS changes, or execution on a different host.

**Evidence if true:** Running the wrapper with a base64 implementation lacking `-w0` rejects every otherwise-valid transaction as noncanonical.

**Fix:** Explicitly require and verify GNU coreutils at installation time, or use a portable encoder invocation and test the exact deployed platform. Keep failure closed.

The corrected `bank-sign.sh` comment is true only in its narrowed form: the transaction is not an argument to the wrapper itself, but it **is** placed in the `cosign.mjs` process argument vector.

---

## R4 — cron installer

The installed crontab contains five jobs:

1. `alarm.mjs` watcher — does not move cbBTC.
2. `distribute.mjs` — **can move cbBTC as installed**, unless an existing tagged `--dry-run` is preserved.
3. `revenue.mjs` — cannot run the live swap as a fresh install because `--live` is omitted; an existing tagged `--live` is preserved.
4. `alarm.mjs --reconcile` — does not move cbBTC.
5. Deadman notification — does not move cbBTC.

The revised header is accurate for a fresh crontab and the new preservation logic handles both flags. No additional definite money-arm defect is established from the supplied code.

One residual robustness issue remains:

### LOW — Flag preservation is still substring-based rather than command-based

**Construct:**

```bash
if ours | grep -q 'revenue\.mjs --live'; then ...
if ours | grep -q 'distribute\.mjs --dry-run'; then ...
```

Any uncommented, tagged line containing those substrings can influence the generated canonical job, including an `echo`, wrapper command, or unrelated command placed on a line carrying the tag.

**Gain:** A user or local attacker able to edit the crontab can cause the installer to arm or disarm a money job on its next run. An attacker who can already edit the user’s crontab has broader control, so this is primarily a correctness and accidental-arming issue.

**Evidence if true:** Add a tagged line containing `echo revenue.mjs --live`; rerunning the installer produces a live revenue cron even though no revenue command was live.

**Fix:** Parse only the exact canonical command portion: expected schedule, repository path, executable, script path, and tag. Preserve flags only from a line whose command identity matches the corresponding CBOB job.

---

## R5 — selftest gates

### MEDIUM — `codeOnly()` does not implement shell comment semantics

**Construct:**

```js
const codeOnly = src =>
  src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
```

A shell `#` begins a comment only when it occurs outside quotes and after suitable shell token boundaries. The helper removes only full-line comments. It does not distinguish:

- a trailing comment,
- a `#` inside a quoted string,
- a here-document body,
- shell syntax whose contents are not executable source.

The current anchored candidate regex reduces some false positives, but this is not a reliable proof that exactly one executable `exec` line exists.

**Gain:** Future edits can make the gate either fail closed on harmless prose or fail to identify an invocation embedded in shell constructs. The gate does not prove the property it claims.

**Evidence if true:** Add a heredoc line beginning with `exec node bank/cosign.mjs ...` or an executable line whose text is generated through shell syntax; the source scraper produces a result unrelated to actual execution.

**Fix:** Test behavior, not source text. Execute the wrapper in a disposable environment with a stub `cosign.mjs`, or parse shell with a real shell-aware parser. At minimum, explicitly reject heredocs and require the exact command structure.

---

### MEDIUM — Struct regex validation is only fail-closed for some malformed edits

**Construct:**

```js
/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/
```

A brace in an attribute, macro argument, comment, or nested syntactic construct can terminate the match early. The current tests show that truncation before `bank` produces `-1`, which fails closed, and truncation after `bank` does not change the index. They do not establish that all realistic Rust/Anchor formatting changes are handled.

**Gain:** A parser false positive or false negative can make the positional constant gate certify a changed account layout without proving the index.

**Evidence if true:** Introduce a brace-bearing attribute/comment before a reordered field and observe the parser return a field list that omits later fields while the test still passes.

**Fix:** Derive the account index from Anchor-generated metadata/IDL or compile-time test data. If source parsing remains, use a Rust parser rather than a non-greedy regex and fail if the struct cannot be parsed unambiguously.

The current `isTableRow` definition is used consistently by `tableRows`, `tableLines`, and the control-table checks. Its main limitation is format rigidity: a valid Markdown row with different spacing or formatting is treated as an unclassified row, which fails closed rather than opening the gate.

---

## R6 — counts and arithmetic

The supplied arithmetic is correct:

- 240-vault denominator:

  `108×2 + 60×3 + 36×4 + 24×5 + 12×6 = 732`

- 2,100-vault denominator:

  `945×2 + 525×3 + 315×4 + 210×5 + 105×6 = 6,405`

- Per-1000 figures:

  - 240 vaults: `2.73, 4.10, 5.46, 6.83, 8.20`
  - 2,100 vaults: `0.31, 0.47, 0.62, 0.78, 0.94`

- Shares at 2,100 vaults:

  `29.5%, 24.6%, 19.7%, 16.4%, 9.8%`, summing to `100.0%`.

The dust bound is also correct for the allocator as written. Each paid vault contributes one fractional remainder strictly below one satoshi, so:

```text
dust < number of paid/activated vaults
```

When `available` is below the payment floor, the allocator returns a skip with zero dust. When vaults are skipped or unlevelled, it also returns before distributing, so the bound is not violated.

The floors quoted in the diff are internally intended to be:

- on-chain: 286
- detector: 434
- allocation: 93
- mainnet: 19

The equality checks are preferable to the previous lower-bound checks. They still rely on duplicated constants in multiple files, but `bank/selftest.mjs` now checks the off-chain copies against `run-tests.sh`.

---

## Carry-over and other findings

### HIGH — The `splitByOther` attribution window can falsely close a cycle

**Construct:** `bank/detectors.mjs`

```js
const afterMs = Date.parse(c.returnedAt || c.startedAt)
const hit = pool.find(e =>
  !used.has(splitSig(e)) &&
  splitTime(e) * 1000 >= afterMs - 60_000
)
```

A split up to 60 seconds **before** the cycle’s recorded return is accepted as evidence for that cycle. The comment says the anchor must be at or after the return, but the implementation deliberately permits a negative one-minute tolerance.

**Gain:** A legitimate split belonging to another cycle can be attributed to a `splitByOther` cycle. The ledger can therefore suppress an unsplit-revenue alarm without proving that the split occurred after that cycle’s cbBTC return.

**Evidence if true:** Use:

- cycle return at `12:00:30`,
- unclaimed on-chain split at `12:00:00`,
- `splitByOther: true`,
- no other candidate split.

The detector accepts the cycle because `12:00:00 >= 11:59:30`.

**Fix:** Require strict ordering, or document and justify a tolerance based on measured timestamp uncertainty. If tolerance is necessary, bind the split additionally to amount, return transaction, or a monotonic chain position. Add a regression test for a split immediately before `returnedAt`.

---

### MEDIUM — `detectNestedVaults` and other detectors remain dependent on DAS truth without an authenticated completeness proof

This is partly documented, but the consequence is stronger than the wording in places: a plausible but incomplete DAS answer can produce a clean nested-vault result while the distribution and reconciliation jobs continue. The code checks response shape and page length, but does not independently authenticate that DAS returned the complete collection/owner set.

This is not a new protocol impossibility and should not be described as solved by the shared envelope parser.

**Evidence if true:** Return a syntactically valid short page that omits an inner asset but does not trigger the current page-size/counter checks; the post-hoc detector reports no nested asset.

**Fix:** Retain the current fail-closed checks, but add an independently chain-derived completeness anchor where possible, and make the operational response to index disagreement a hard stop for all money-moving paths.

---

## Verdict challenges

No additional demonstrated arithmetic error or base64 fail-open bypass was established from the supplied diff. The strongest surviving defects are in the certification process itself and in the attribution/paging behavior:

1. duplicate model IDs can manufacture auditor quorum;
2. `splitByOther` accepts evidence before the cycle’s return;
3. unlevelled activation creates a recurring notification/availability attack;
4. the exported supersession repair treats partial payment as completion;
5. source-scraping gates remain weaker than the executable properties they claim to prove.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

The project needs an independent release authority that is not allowed to modify the code, tests, prompts, roster, or verdict during a certification round. Specifically:

- Put the certification runner, target tree, model roster, prompts, test outputs, manifests, and hashes in a separate append-only environment.
- Require two independent operators to approve the exact commit and exact rendered prompt before model requests begin.
- Run the validator tests and off-chain tests from a hermetic container with pinned binaries, RPC fixtures, coreutils, Node dependencies, and network policy.
- Store raw model responses and provider metadata immutably; do not let the same process that requests reports decide whether they count.
- Require independent recomputation of quorum from distinct model IDs and independent review of the manifest.
- Add property-based and state-machine tests for ledger transitions, especially quiet→pay, refuse→pay, partial-pay→resume, crash→resume, and dry-run interleavings.
- Use executable integration tests for cron installation and Bank signing rather than relying primarily on regular expressions over shell, Markdown, Rust, or JavaScript source.
- Establish a two-person emergency procedure for any Bank signature, operator-key rotation, level-register change, or customer-data migration, with immutable logs and a tested rollback/stop mechanism.
- Do not certify mainnet merely because all assertions are green: require a separately generated artifact proving that the tests were executed against the exact committed source and exact deployed program hashes.