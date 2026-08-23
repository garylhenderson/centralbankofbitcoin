## R1 — self-audit repairs and rendered artifacts

### HIGH — `supersede()` leaves `resolvedBy`, preserving the detector’s fail-open suppressor

**Construct:** `bank/distribute.mjs`:

```js
const was = [rec?.refused, rec?.nothingToDo].filter(Boolean)
...
delete out.refused
delete out.nothingToDo
delete out.finishedAt
```

`detectDistribution` suppresses `distribution_unfinished` when any of these are present:

```js
startedAt && !finishedAt && !nothingToDo && !resolvedBy
```

`supersede()` never deletes `resolvedBy`.

**Impact:** A day can be manually resolved after a refusal or ambiguous transfer, then later proceed to payment. If the later run crashes after clearing the other fields but before completion, the stale `resolvedBy` still suppresses `distribution_unfinished`. Unpaid holders can therefore remain silent.

This is exactly the state transition the repair claims to close, but through the fourth suppressing field rather than the three tested fields.

**Evidence if true:** A ledger record such as:

```json
{
  "startedAt": "...",
  "resolvedBy": "operator: abandoned earlier attempt",
  "refused": "old refusal",
  "finishedAt": "old timestamp"
}
```

passed through `supersede()`, followed by a crash before a new `finishedAt`, produces no `distribution_unfinished` finding.

The existing `supersede` tests do not include `resolvedBy`.

**Fix:** Treat a proceeding plan as superseding every non-final suppressor. At minimum:

```js
delete out.resolvedBy
delete out.finishedAt
```

Alternatively, replace independent flags with an explicit state machine and make the detector derive alarm status from that state.

---

### MEDIUM — The rendered audit prompt still contains a literal floor placeholder

**Construct:** `scripts/audit19.ts` contains the escaped interpolation:

```ts
\${FLOORS.onchain}
```

inside the `PROMPT` template literal.

In a JavaScript template literal, `\${...}` renders literal text:

```text
${FLOORS.onchain}
```

rather than the numeric floor.

**Impact:** Auditors receive a prompt that claims to contain the dynamically read floor but actually contains an unresolved placeholder in the R1 text. This weakens the certification artifact and demonstrates that source-level review is insufficient.

**Evidence if true:** Render `PROMPT` or run the compiled script and inspect the resulting prompt. The output contains `${FLOORS.onchain}` literally. A test should assert that the rendered prompt contains no `${` sequences and contains `286`, `427`, `79`, and `19`.

**Fix:** Use:

```ts
${FLOORS.onchain}
```

where interpolation is intended, and add a render test:

```ts
for (const token of ['${FLOORS.', '${DIFF}', '${BUNDLE}']) {
  if (PROMPT.includes(token)) throw new Error(`unexpanded token: ${token}`)
}
```

---

### MEDIUM — `audit19.ts` checks HEAD only before and after, not the watched file contents

**Construct:**

```ts
const head = execSync('... git rev-parse HEAD').toString().trim()
const dirty = execSync('... git status --porcelain -- '+WATCHED).toString()
await Promise.all(...)
const headAfter = execSync('... git rev-parse HEAD').toString().trim()
```

A working-tree edit made while the models are reading does not change `HEAD`, and the initial `dirty` snapshot is not repeated afterward.

**Impact:** Models can audit one version while the manifest identifies a clean commit and the final process exits successfully. This is particularly serious because the round explicitly claims to certify a fixed tree.

**Evidence if true:** Modify `bank/distribute.mjs` or `SPEC.md` after the initial `dirty` check but before model completion. `headAfter === head`, the initial `dirty` was empty, and the process does not fail.

**Fix:** Hash every watched file before launching auditors and again afterward; fail if the hash set changes. Also record the exact file hashes in the manifest. A Git commit check alone is insufficient.

---

### MEDIUM — The audit roster can be replaced with duplicate model IDs

**Construct:**

```ts
const MODELS=(process.env.MODELS || [...]).split(',')
```

`verifyRoster()` verifies that IDs exist, but does not reject duplicates. `MIN_AUDITORS` is calculated from the requested list length.

**Impact:** An operator can set:

```bash
MODELS=x-ai/grok-4.6,x-ai/grok-4.6,...
```

and obtain nominal quorum from repeated calls to one model. This is not independent review, despite the manifest reporting multiple auditors.

**Evidence if true:** Run with eight copies of one valid model ID. `verifyRoster()` passes and the manifest reports eight requested models and potentially eight usable auditors.

**Fix:** Require unique IDs, use an immutable approved roster stored in the repository, and reject arbitrary `MODELS` replacement. If overrides are retained for testing, mark the run non-certifying.

---

## R2 — off-chain distribution repairs

### HIGH — Refusal notification creates an externally triggerable paging DoS

**Construct:**

```js
if (plan.refusal) {
  ...
  if (!DRY) {
    try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {}
  }
  process.exitCode = 1
}
```

An activated vault with no level causes a global refusal. Activation and funding are not exclusively controlled by the distributor.

**Impact:** A stranger can create or activate an unlevelled vault, halt all daily distribution, and cause the notification path to run on every subsequent daily invocation until operators edit the level register. If `NOTIFY` pages a human or incurs per-message cost, the attacker converts a distribution griefing surface into a repeated paging surface.

The intentional global halt may be defensible for fund-accounting correctness, but unconditional paging is not automatically justified.

**Evidence if true:** Activate one vault without a `levels.json` entry, run the job repeatedly, and observe one notification invocation per refusal. `--dry-run` exits with status 1 but suppresses the notification, so dry-run and live mode have different operational behavior.

**Fix:** Separate “distribution refused” from “page immediately.” Deduplicate notifications by refusal fingerprint and time window; page on first occurrence and escalation, not every run. Preserve a nonzero exit code in all modes if desired, but make paging rate-limited and authenticated.

---

### MEDIUM — The cadence default is directionally correct, but the product promise remains unbounded below one satoshi per vault

The self-audit correctly establishes that a larger `holdDays` reaches the 31-day ceiling earlier. A bare `resolvedBy` therefore causes an earlier payout, not a later one.

However, `decideEmission()` returns `pay: false` before consulting `MAX_HOLD_DAYS` when `smallestPer < EMISSION_MIN_PER_VAULT`. At zero or insufficient pool balance, holders can wait indefinitely.

This is partly documented, so it is not a new implementation defect if the documentation is updated consistently. It remains a customer-facing economic risk: “monthly” is false below the threshold.

**Evidence if true:** The existing measured case:

```js
decideEmission({ smallestPer: 0n, daysSinceLastPayout: 365 })
```

returns `{ pay: false, forced: false }`.

**Fix:** Either explicitly remove the monthly guarantee from all customer-facing material, or define a minimum forced payout policy. Do not describe the ceiling as unconditional.

---

### LOW — `census()` is safe for JSON round trips, but the test does not verify ledger compatibility

The implementation:

```js
const c = Object.create(null)
...
return { ...c }
```

returns an ordinary object, so JSON serialization and deserialization are safe. `denominator()` correctly uses `Object.hasOwn`.

I found no demonstrated consumer requiring the original prototype. The missing test is not itself a loss-of-funds finding, but this should be asserted directly because the change was made specifically around serialization and prototype behavior.

---

### LOW — Dust bound is valid only when `activated` means “all paid candidates”

For each paid vault, integer division leaves less than one satoshi of fractional remainder, so:

```text
dust < number of paid vaults
```

If `allocateWeighted()` returns `activated` as the complete eligible set, then `dust < activated.length` is valid even when `available` is small. If `activated` excludes skipped candidates while the dust calculation still includes their weight or allocation basis, the assertion would be wrong.

The supplied test covers low balances but does not independently establish that `activated.length` is exactly the set used by the allocation sum in every skip path. Add a property-based invariant tying the dust sum to the exact list of terms included in `total`.

---

## R3 — `bank-sign.sh`

### MEDIUM — Canonical round-trip depends on GNU `base64 -w0`

**Construct:**

```sh
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
```

**Impact:** On systems whose `base64` lacks `-w0`, the second command fails, `CANON` becomes empty, and every legitimate transaction is rejected. The script therefore has an undeclared platform dependency.

This is not a bypass on GNU coreutils, but it can disable all redemptions on a differently provisioned signing host.

**Evidence if true:** Run on BSD/macOS or a minimal image where `base64 -w0` is unsupported. A valid 1644-character encoding is rejected as noncanonical.

**Fix:** Pin and verify GNU coreutils, or use a portable implementation such as:

```sh
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 | tr -d '\n')
```

and test the actual signing image.

The round trip rejects the listed noncanonical encodings and accepts a normal 1232-byte transaction on GNU coreutils. I found no demonstrated accepted noncanonical input under those assumptions.

---

## R4 — cron installation

### HIGH — The installed distribution job is live by default

The header is now accurate for the lines shown:

```cron
7 9 * * * ... bank/distribute.mjs$DIST_DRY ...
41 */6 * * * ... bank/revenue.mjs$REV_LIVE ...
```

On a fresh crontab:

- `alarm.mjs`: cannot move money.
- `distribute.mjs`: live, because `$DIST_DRY` is empty.
- `revenue.mjs`: dormant, because `$REV_LIVE` is empty.
- `alarm.mjs --reconcile`: cannot move money.
- deadman shell notification: cannot move money.

This is not merely documentation. Installing the script arms a real cbBTC sender at the next scheduled run. The computed summary helps, but it occurs after `crontab` has already been written.

**Impact:** An operator who believes “installing the monitor” is safe can install a live payout job. A malformed or stale ledger, bad level register, or operational mistake can then trigger real transfers.

**Evidence if true:** Run the installer with an empty crontab and inspect the resulting crontab. The distribute line contains no `--dry-run`.

**Fix:** Make distribution opt-in for installation, matching revenue:

```cron
... bank/distribute.mjs --dry-run ...
```

Require an explicit `--live-distribute` installer option to remove it. At minimum, refuse installation unless the operator confirms the computed posture before writing the crontab.

---

### MEDIUM — Cron preservation recognizes flags by substring rather than parsing the project command

**Construct:**

```sh
if ours | grep -q 'revenue\.mjs --live'; then ...
if ours | grep -q 'distribute\.mjs --dry-run'; then ...
```

**Impact:** A tagged, uncommented project line containing those textual sequences in an argument, shell variable, or later command can preserve a flag that is not actually an argument to the intended Node process. Conversely, shell quoting or an alternate executable arrangement can make a legitimate operator choice invisible and silently change posture.

**Evidence if true:** A tagged line such as:

```cron
... node bank/distribute.mjs --note 'distribute.mjs --dry-run' ...
```

matches the preservation test despite not passing `--dry-run` to the distributor.

**Fix:** Parse only the command segment, or generate and preserve a structured configuration rather than grepping arbitrary cron text. The installer should also validate the final command with `sh -n` and explicit token checks.

---

## R5 — self-test gates

### HIGH — `codeOnly()` and the exec regex do not model shell syntax

**Construct:**

```js
const codeOnly = src => src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
...
/^\s*exec .*cosign\.mjs.*$/gm
```

The regex only finds an `exec` at the beginning of a physical line. Shell permits executable commands after separators and compound constructs:

```sh
condition && exec node bank/cosign.mjs ...
if ok; then exec node bank/cosign.mjs ...; fi
{ exec node bank/cosign.mjs ...; }
```

`#` is also only a comment when it begins an unquoted comment position. It is data inside quotes, parameter expansions, and some shell contexts.

**Impact:** A second real invocation can be added without being counted, allowing the gate to continue reporting exactly one invocation.

**Evidence if true:** Add this line to the script:

```sh
true && exec node bank/cosign.mjs --tx "$TX" ...
```

The shell executes it, but the anchored regex does not count it.

**Fix:** Do not use a regex as an authorization gate for shell. Parse with a shell parser, or make the wrapper the only executable entry point and enforce that through filesystem permissions and a behavioral test. At minimum, detect `exec` tokens after shell separators and reject ambiguous syntax.

---

### MEDIUM — `onChainBankPin()` can pair unrelated source constructs

**Construct:**

```js
return /pub bank: Signer<'info>/.test(src)
  && /require_keys_eq!\(\s*ctx\.accounts\.bank\.key\(\),/.test(src)
```

These expressions search the entire Rust file independently. They do not establish that the `bank` signer belongs to the instruction containing the equality check, nor that the equality check compares against the configured Bank rather than another context.

**Impact:** A file can satisfy the documentation gate with unrelated signer and equality occurrences while the documented control is absent from the relevant instruction.

**Evidence if true:** Move the `bank` field into one accounts struct and the equality check into an unrelated handler or test helper in the same file. The gate remains green.

**Fix:** Parse the Rust AST or inspect a specific handler and its `Context` type. A source-text gate should at least bind the account struct, instruction function, and equality expression structurally.

---

### MEDIUM — The control-table parser misses valid Markdown table shapes

**Construct:**

```js
const isTableRow = l =>
  /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)
```

It requires:

- no indentation,
- exactly a space after the first `|`,
- the classification to appear in a specific bold format,
- a literal period immediately before `**`.

`controlTableBlock()` likewise requires:

```js
lines[i].startsWith('|')
```

**Impact:** A real control row using indentation, different spacing, or valid Markdown formatting can be omitted from validation. The count and classification checks then operate on a subset of the table.

**Evidence if true:** Add a valid row such as:

```text
  | **NEW CONTROL** | ... | **PROCEDURE.** ... |
```

or:

```text
|**NEW CONTROL**|...|**PROCEDURE.** ...|
```

The block parser or `isTableRow()` does not treat it as a classified row.

**Fix:** Parse the table block by structure, normalize whitespace, and require exactly four cells with a classification cell matching a strict normalized value. Do not use the number of rows as the primary completeness property.

---

## R6 — counts and arithmetic

The supplied figures are arithmetically consistent:

- `108/60/36/24/12` gives  
  `108×2 + 60×3 + 36×4 + 24×5 + 12×6 = 732`.
- `945/525/315/210/105` gives  
  `945×2 + 525×3 + 315×4 + 210×5 + 105×6 = 6,405`.
- The weighted shares are approximately:
  - I: 29.51%
  - II: 24.59%
  - III: 19.67%
  - IV: 16.39%
  - V: 9.84%
- These sum to 100.00% after displayed rounding.

The stated assertion floors are internally intended to be:

- on-chain: 286
- detector: 427
- allocation: 79
- live mainnet: 19

However, the repository contains these values in multiple locations. The new equality checks reduce drift but do not eliminate the duplication. A future edit can update the runner and self-test constants together while still omitting assertions from the actual suite if the manually selected constants are changed in the same commit.

**Recommendation:** Emit machine-readable assertion counts from each test process and have the runner compare those counts to the manifest and SPEC. Do not maintain test counts as source constants.

---

## Carry-over and accepted-limit review

### HIGH — The “on-chain cap” does not bound the operator’s total exposure to one cycle

The code enforces a maximum per sweep and a cooldown:

```rust
amount <= cfg.max_sweep_lamports
now >= last_sweep_at + cooldown
```

But the operator can repeatedly sweep the entire balance over many cooldown periods, and the revenue address can accumulate substantially more than one cycle’s worth before a compromised operator key is detected. This is a rate limit, not a total exposure bound.

This is partly acknowledged, but the documentation’s phrase “one capped, cooled-down sweep rather than the treasury” can be read as a total-loss bound. The actual bound is:

```text
maximum loss before detection ≈ balance available × number of permitted cooldown windows
```

**Evidence if true:** Fund revenue with multiple cap-sized amounts over multiple cooldowns using the compromised operator key. Each transfer is valid and the total exceeds one cap.

**Fix:** State the exposure bound precisely, or enforce a cycle identifier / accounting window with a cumulative maximum. The alarm should also detect repeated sweeps to the operator without a corresponding return, not merely individual unreconciled cycles.

---

### MEDIUM — Off-chain detection remains dependent on the payer-controlled ledger

The known limit says distribution reconciles against a ledger the payer wrote. The new tests prove malformed ledger handling, but they do not make the ledger authoritative. A payer who controls both the transfer process and the ledger can write plausible signatures, amounts, and completion markers.

The chain scans can establish some facts, but the distribution detector still cannot independently prove that every intended holder received the recorded amount unless it reconstructs the full expected allocation from on-chain balances and transaction results.

This is not new if intentionally accepted, but it is worse than “reconciles” suggests.

**Fix:** Generate the expected plan from a signed, immutable census snapshot; verify every transfer signature and destination/amount against chain state; make completion a derived fact rather than a payer-written boolean.

---

## Verdict challenge: under-claims and over-claims

The documentation now correctly states that:

- the Bank signature is mandatory on-chain;
- the Bank’s policy scan is procedural;
- bank-key confinement is on-chain in SEAL and MINT;
- the revenue job is opt-in while distribution is opt-out.

The remaining under-claim is in the control model around the Bank’s signature: the table describes the two programs as enforcing the Bank requirement, but it does not clearly distinguish that the same Bank key is independently pinned in three program configurations and that MINT additionally validates its SEAL wiring before minting. That is a stronger cross-program wiring guarantee than a casual reading of the table conveys.

More importantly, some language still overstates the sweep bound and the “monthly” cadence as discussed above. The documentation should use exact operational limits rather than qualitative claims.

---

## What this project should do given that no human firm will ever see it

Sixteen rounds of AI audit cannot provide independent custody, deployment, or operational accountability. The project should add controls outside the model-review loop:

1. **Independent release authority:** require two unrelated humans or organizations to approve the exact commit hash, deployed program hashes, Core hash, and configuration snapshot before launch.
2. **Reproducible deployment:** build artifacts in a clean, isolated environment; publish source, toolchain versions, binaries, hashes, and deployment transactions.
3. **Behavioral canary deployment:** deploy to a separate validator or testnet with the production binaries and exercise every money-moving instruction before mainnet activation.
4. **Key separation:** keep the Bank, distributor, swap operator, and upgrade authorities under separate custody domains. No single host should contain all signing keys.
5. **Spend limits outside Solana:** use an HSM or policy signer for the swap operator and distributor with daily and per-transaction limits independent of program configuration.
6. **Immutable audit artifacts:** record rendered prompts, exact bundles, file hashes, model IDs, raw responses, disqualification decisions, test logs, and deployed hashes in append-only storage.
7. **Adversarial fuzzing:** fuzz the Rust instruction-sysvar walks, Anchor account layouts, shell wrapper, cron parser, ledger transitions, and JSON/prototype boundaries. The current tests are mostly hand-selected examples.
8. **State-machine testing:** model distribution and revenue processing as explicit state machines and run crash/restart/interleaving tests, especially every ordering involving `refused`, `nothingToDo`, `resolvedBy`, and `finishedAt`.
9. **Operational fire drills:** deliberately simulate a missing level, poisoned ATA, crashed transfer, failed notification, compromised operator key, and stale lock. Measure time to halt, detect, recover, and resume without double payment.
10. **No live money until independent sign-off:** the current AI process should be treated as evidence generation, not as the sole authorization to place customer funds at risk.