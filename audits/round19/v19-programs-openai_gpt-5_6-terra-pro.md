## R1 — Self-audit repairs and certification runner

### HIGH — The audit runner can certify a HEAD it did not audit

**Exact construct:** `scripts/audit19.ts` (and the same pattern in `audit18.ts`):

```ts
const DIFF=execSync(`cd ${R} && git diff ec7d17e..HEAD -- programs bank scripts tests`, ...)
...
const PROMPT=`... ${DIFF} ... ${f(...)} ...`
...
const head=execSync('cd '+R+' && git rev-parse HEAD').toString().trim()
const dirty=execSync('cd '+R+' && git status --porcelain -- programs bank scripts tests').toString()
...
if(dirty) console.log('  ⚠️ programs/bank/scripts/tests are DIRTY — this round did not audit a fixed tree')
```

The prompt—including the diff and selected source files—is constructed before `main()` obtains `head` and `dirty`. A dirty tree is merely recorded and printed; it does not fail the run. There is also no post-run re-check that `HEAD`, tracked content, or untracked relevant files stayed unchanged while the model calls ran.

**Impact:** A round can produce a manifest naming one `HEAD` while the auditors read another state:

1. Build `DIFF` and `PROMPT` from revision/state A.
2. Commit, reset, or modify files to state B.
3. `head` records B.
4. Six or more reports arrive and the runner exits zero.
5. The resulting manifest appears to certify B, although B was not what the auditors received.

This is not merely a cosmetic receipt defect. This repository treats the AI-runner output as certification. A mutable working tree permits a clean-looking certification artifact for unaudited deployable code.

The current dirty-tree behavior is especially dangerous because the comments correctly identify the condition as invalid—

> “THE TREE MUST NOT MOVE UNDER THE ROUND”

—but the executable behavior does not enforce it.

**Evidence if correct:**

A reproducible test does not need model API calls:

1. Instrument the runner immediately after `PROMPT` construction but before `git rev-parse HEAD`.
2. Commit any change under `programs`, `bank`, `scripts`, or `tests`.
3. Observe that the manifest’s `head` is the new commit while `promptChars` and a hash of the captured prompt correspond to the old source.
4. Alternatively, leave an uncommitted change: the runner completes successfully above quorum and writes a manifest with a nonempty `dirty` array.

**Fix:**

- Refuse to start unless the entire repository is clean, not merely `programs bank scripts tests`.
- Resolve and record a commit hash before generating any prompt material.
- Create a detached worktree or archive from that immutable commit.
- Generate both diff and source bundle exclusively from `git show <commit>:<path>` / the detached worktree.
- Record SHA-256 hashes of the exact prompt and every bundled file in the manifest.
- Recheck `HEAD` and repository status after completion; any change must invalidate the round with nonzero exit.
- Make `dirty !== ''` a hard failure, not an informational warning.

---

### MEDIUM — The runner permits a nominal quorum made of duplicate auditors

**Exact construct:**

```ts
const MODELS=(process.env.MODELS||[ ... ].join(',')).split(',')
const MIN_AUDITORS=Number(process.env.MIN_AUDITORS||Math.ceil(MODELS.length*0.75))
...
await Promise.all(MODELS.map(m=>ask(m).then(land)))
```

`MODELS` is operator-controlled and is neither deduplicated nor checked for provider/model diversity. The manifest counts reports, not distinct models.

**Impact:** An accidental or malicious environment setting such as:

```sh
MODELS='anthropic/claude-opus-5,anthropic/claude-opus-5,anthropic/claude-opus-5,...'
```

can satisfy a six-of-eight quorum with one model invoked repeatedly. This defeats the stated independent-reader rationale. It is particularly serious in a process explicitly substituting model plurality for an independent audit firm.

**Evidence if correct:** Run with duplicated entries and inspect `MANIFEST-programs.json`: `requested`, `auditors`, and quorum succeed while `models[].model` contains duplicates.

**Fix:** Reject duplicate model IDs. Also enforce explicit diversity constraints—for example, a maximum of one report per exact model and a maximum number per provider family—and record the resulting distinct-model count separately from raw request count.

---

### MEDIUM — “Complete diff” is not complete: audit scope silently excludes important repository surfaces

**Exact construct:**

```ts
const DIFF=execSync(`cd ${R} && git diff ec7d17e..HEAD -- programs bank scripts tests`, ...)
```

The prompt says:

> “The complete diff ec7d17e..HEAD is at the end”

but the command excludes, among other things, `SPEC.md`, root configuration, dependency locks, deployment scripts outside `scripts`, CI configuration, and audit-coverage machinery itself if paths change.

This matters directly here because the prompt requires review of the CONTROL TABLE, customer-facing claims, under-claims, and ship-gate statements—yet `SPEC.md` is neither in the generated diff nor included in either focus bundle.

**Impact:** A documentation/control-table change can be omitted while the round claims the complete diff was reviewed. Conversely, a source change outside the allowlisted directories can alter build, deployment, or audit semantics without being presented to auditors.

**Evidence if correct:** Modify only `SPEC.md` or a root build/deploy file, then run the runner. The declared diff does not contain the modification; the manifest still presents the round as an audit of `ec7d17e..HEAD`.

**Fix:** Build the subject diff from the whole fixed commit range. If a focused review deliberately excludes files, call it a focused subset, enumerate excluded changed files in the manifest, and fail if excluded files are security-relevant or if a prompt asks auditors to assess omitted material.

---

### LOW — The self-audit’s stale-flag tests do not test the writer repair they claim to justify

**Exact construct:** New `bank/selftest.mjs` assertions:

```js
t('...and a STALE nothingToDo would silence it — which is why the writer clears it',
  D.detectDistribution({ days: { ... nothingToDo: ... } }, ...)
    .some(f => f.kind === 'distribution_unfinished'), false)
```

These assertions establish that the detector suppresses an unfinished-distribution finding when `nothingToDo` is present. They do **not** execute `bank/distribute.mjs`, create the quiet-then-pay sequence, or prove that the writer deletes both `nothingToDo` and `refused` before a partial payment/crash state is persisted.

**Impact:** The tests prove the danger but not the fix. A future move, conditional change, early return, or save-order regression in the writer can reintroduce the silent unfinished-day state while these new assertions remain green.

**Evidence if correct:** Remove the two `delete` operations in `distribute.mjs`; the two cited detector assertions still pass.

**Fix:** Add an integration-level test around the real distribution state transitions:

- quiet run writes `nothingToDo`;
- same-day real run proceeds;
- simulated transfer failure leaves `finishedAt` unset;
- persisted state contains neither stale no-pay flag;
- `detectDistribution` raises `distribution_unfinished`.

Repeat for `refused -> successful plan`, dry-run interleaving, and resume after a crash.

---

## R2 — `bank/distribute.mjs`

### MEDIUM — An externally triggerable payout halt is now an externally triggerable repeated pager event

**Exact construct:**

```js
if (plan.refusal) {
  const msg = `CBOB DISTRIBUTION REFUSED and paid nobody: ${plan.skip}`
  console.error(msg)
  if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
  process.exitCode = 1
}
```

The prompt itself states that an unlevelled activated vault can trigger a refusal. The new behavior notifies on every live daily run and exits nonzero. There is no persisted notification-deduplication, acknowledgement, backoff, or suppression after the initial alert.

**Impact:** The pre-existing “unknown activated vault halts payout” availability condition has become a durable paging primitive. A party capable of producing an activated vault absent from `levels.json` can force daily human notification until an operator intervenes. After the operator resolves one malicious vault, another can be used to repeat the process.

This does not directly transfer cbBTC to the attacker, but it creates an operational denial-of-service against the human responsible for restoring distributions. In a real-money system, repeated alert fatigue is a security concern: operators eventually mute the channel, ignore genuine failures, or make rushed changes to levels/ledger state.

**Evidence if correct:**

1. Construct an activated eligible vault absent from the level register.
2. Run live distribution twice on successive scheduled days, or twice with distinct day keys.
3. Observe `NOTIFY` invoked each time, `process.exitCode === 1`, and no state field preventing repeat notifications.
4. Confirm the same behavior persists until the missing level is added.

**Fix:**

- Persist a refusal fingerprint and `notifiedAt` / `lastNotifiedAt`.
- Page immediately on a new refusal or changed refusal cause.
- Escalate at a bounded cadence rather than every scheduled invocation.
- Require explicit acknowledgement/escalation state for prolonged unresolved payout halts.
- Preserve nonzero exit behavior if cron supervision relies on it, but do not make both the local notifier and supervisor independently page indefinitely.

---

### Verification: cadence direction is correct

I did not find a direction error in `settledAsPayout`.

A bare `resolvedBy` produces no cadence reset, which yields a larger `holdDays`. Under the stated 31-day ceiling, a larger hold duration reaches the forced-payout threshold earlier, not later. Therefore the conservative default—do not assume “paid” from ambiguous resolution text—does bias toward an earlier scheduled payout. The test case’s `2,52` result is consistent with that logic.

The important remaining operational requirement is that a human resolution of an actual hand payment must reliably include exactly:

```js
resolvedAs: 'paid'
```

Otherwise the system deliberately schedules another payout sooner. That is not a code contradiction, but it is a real double-payment risk if operators treat `resolvedBy` prose as sufficient evidence of hand payment.

---

### Verification: census serialization and dust bound

`census()` creates a null-prototype object internally but returns `{ ...c }`, which is an ordinary object and JSON-serializes normally. `denominator()` appropriately uses `Object.hasOwn`.

The tightened dust statement is mathematically sound assuming `allocateWeighted` pays each activated vault:

\[
p_i = \left\lfloor\frac{A w_i}{D}\right\rfloor
\]

Then total dust is:

\[
A - \sum_i p_i
 = \sum_i \operatorname{frac}\left(\frac{A w_i}{D}\right)
\]

Each paid vault contributes a fractional part in \([0,1)\), so dust is strictly less than the number of paid/activated vaults. This remains true when available sats are fewer than vaults; most individual payments may be zero, but each fractional component remains below one sat. If allocation returns a skip rather than a paid plan, the bound should not be quoted as though a payout occurred.

---

## R3 — `scripts/bank-sign.sh`

### MEDIUM — Canonical-base64 validation rejects legitimate transactions on systems with BSD `base64`

**Exact construct:**

```sh
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
```

`base64 -w0` is GNU coreutils syntax. BSD/macOS `base64` does not provide `-w`; it uses different option conventions and commonly uses `-D` rather than GNU `-d` for decoding.

The command’s failure is intentionally swallowed by `|| true`, leaving `CANON` empty. Any nonempty legitimate transaction is then rejected as “not CANONICAL base64.”

**Impact:** A legitimate signer using the sanctioned wrapper on macOS/BSD cannot co-sign any nonempty transaction, including the stated 1,232-byte transaction whose canonical base64 is 1,644 characters. Given the acknowledged lack of a usable automated override path, this can halt redemptions or push operators toward bypassing the judgment wrapper manually.

**Evidence if correct:**

On a macOS/BSD host:

```sh
TX=AA==
printf '%s' "$TX" | base64 -d | base64 -w0
```

fails due to unsupported options. Running `bank-sign.sh` with a valid canonical base64 transaction then rejects it through the empty `CANON` mismatch.

**Fix:**

- Declare and enforce GNU coreutils as an explicit prerequisite, locating `gbase64` where appropriate; or
- implement portable encoding/decoding detection before accepting a transaction; or
- avoid `-w0` by stripping only encoder-inserted newlines:

```sh
CANON=$(
  printf '%s' "$TX" |
    "$BASE64_DECODER" 2>/dev/null |
    "$BASE64_ENCODER" 2>/dev/null |
    tr -d '\n'
) || fail
```

Do not suppress the pipeline failure with `|| true`; report “required canonical-base64 implementation unavailable” distinctly. Keep the equality comparison after successful round-trip encoding.

I did not identify a nonempty, alphabet-valid, padding-valid input that survives the new GNU-coreutils round-trip equality check while decoding to different bytes. The canonical round trip closes the prior nonzero-trailing-bit and excess-padding cases.

---

## R4 — `scripts/cron-install.sh`

The supplied diff shows corrected explanatory text but not the actual generated crontab block. Therefore I cannot independently enumerate every installed job or certify the header’s absolute claim from this material alone.

The shown statement about the two named jobs is internally consistent with the described polarity:

- `revenue.mjs`: dormant if installed without `--live`.
- `distribute.mjs`: live if installed without `--dry-run`.

Before treating the header as verified, the test suite should mechanically extract each installed crontab command and assert its effective money-moving mode. Comments are not evidence of installed behavior.

---

## R5 — Changed gates

### LOW — `codeOnly()` is not a shell parser and can silently alter non-comment shell content

**Exact construct:**

```js
const codeOnly = src => src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
```

This treats every line whose first non-whitespace character is `#` as a comment. In shell syntax, that is not universally safe: here-documents can contain arbitrary data beginning with `#`; generated shell fragments and quoted multiline data can also make source-text classification materially different from shell parsing.

**Impact:** The test’s source transformation can inspect a different program from the script the shell executes. A future shell restructuring could cause the exec-line gate to pass or fail for reasons unrelated to the operative `exec`.

**Evidence if correct:** Add a here-document containing a line that starts with `#` and demonstrate that `codeOnly()` deletes it even though the shell passes it as data.

**Fix:** Do not source-scrape shell semantics with line filtering. Prefer a behavior test that invokes the wrapper with controlled inputs and verifies the exact argv observed by a stubbed `node`/`cosign.mjs`. If static checking remains necessary, use a constrained parser or assert the final command through a deliberately structured marker rather than regex replacement over source.

---

### Verification: MintVault parser fails closed in the likely drift cases

The non-greedy struct-body regex is brittle:

```js
/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/
```

but a premature `\n}` inside a future complex attribute/body structure would normally truncate the parsed field list. The immediately following assertion requiring the first six parsed fields to equal:

```js
['config', 'asset', 'collection', 'owner', 'bank', 'payer']
```

causes that common truncation mode to fail the test rather than silently bless a wrong index. I do not treat this as an exploitable open failure from the current construct.

The parser should still be replaced with an AST-level Rust check or a generated interface/account-order artifact, because the test is security-critical and source-regex parsing is not a stable interface contract.

---

## R6 — Counts and arithmetic

The changed floors match the visible enforcing locations:

| Suite | Enforced floor |
|---|---:|
| Detector/selftest | `403` |
| Allocation/distribution selftest | `63` |
| Mainnet | `19` |

The prompt’s claimed on-chain floor of `284` is not contradicted by the supplied `run-tests.sh` excerpt; its `MIN_ASSERTIONS` declaration was not included in the excerpt, so I cannot independently verify that number from the material provided.

Independent weighted census derivations:

\[
108(2)+60(3)+36(4)+24(5)+12(6)=216+180+144+120+72=732
\]

\[
945(2)+525(3)+315(4)+210(5)+105(6)
=1890+1575+1260+1050+630=6405
\]

For the 2,100-vault census, level shares are:

| Level | Weight total | Share of 6,405 |
|---|---:|---:|
| I | 1,890 | 29.5082% |
| II | 1,575 | 24.5902% |
| III | 1,260 | 19.6721% |
| IV | 1,050 | 16.3934% |
| V | 630 | 9.8361% |
| Total | 6,405 | 100.0000% |

I cannot verify “the ten per-$1,000 figures” because the customer-facing card containing those ten figures was not supplied.

---

## Carry-over limits that are worse in practice

The acknowledged unlevelled-vault halt has become materially more disruptive because the new refusal notifier converts it into recurring human paging. The earlier limitation was payout availability; it now also affects monitoring availability and operator attention. This should be documented as an explicit pager-abuse consequence, not merely as a halt.

---

## Verdict challenges

1. **Do not call a runner-generated manifest a certification unless it binds an immutable source snapshot.** The present manifest records observations about a mutable repository; it does not prove what was audited.

2. **Do not count reports as independent readers merely because they came from separate HTTP requests.** Exact-model uniqueness, provider diversity, fixed source identity, and completion criteria must be enforced, not narrated.

3. **Do not claim a complete-diff review while excluding `SPEC.md`.** The owner’s recent highest-value finding was precisely a documentation under-claim. Omitting the document that makes the promise repeats the blind spot procedurally.

4. **The cron money claim needs an executable assertion.** The installed crontab commands—not the header—must be parsed and tested for whether they can transfer value.

---

## Given that no human firm will ever see this, what should this project do that sixteen rounds of AI audit structurally cannot?

1. **Eliminate certification-by-prose and replace it with reproducible, independently executable evidence.** Publish a signed release bundle containing:
   - deployed program hashes;
   - exact source commit;
   - deterministic build container digest;
   - test logs;
   - validator ledger/test fixtures;
   - audit prompt hashes;
   - model outputs and manifests;
   - a one-command verifier that rebuilds and checks all hashes without access to internal paths or API keys.

2. **Use economic blast-radius controls instead of assuming review completeness.** Before real scale:
   - cap cbBTC held per vault and total system TVL;
   - cap daily distribution and swap exposure;
   - impose withdrawal/mint rate limits;
   - use time-delayed, publicly observable upgrades;
   - maintain an emergency pause that cannot block customer redemptions;
   - increase caps only after sustained production observation.

3. **Run adversarial live-fire exercises with funded but non-customer canary vaults.** Test real signing, cron, monitoring, recovery, payout refusal, stale-ledger recovery, and redemption under operational failure. A local validator does not test a real scheduler, a real notifier, a real signer host, real permissions, or real operator behavior.

4. **Make monitoring externally observable and independently reconstructible.** Publish immutable daily commitments for revenue balances, distributions, level assignments, unresolved transfers, and alert states. Customers should be able to detect discrepancies without trusting the payer’s locally written ledger.

5. **Create a paid public vulnerability process.** AI rounds repeatedly find variants of prior bugs, but they do not create accountable adversarial incentives. A bounded public bug bounty, scoped testnet challenge, and published remediation SLA are not substitutes for an audit firm, but they introduce independent threat models and real incentives to break the system.

6. **Test the deployed binaries, not only source-derived localnet artifacts.** Deploy the exact release candidates to a public test environment under production-like authorities and execute end-to-end redemption and distribution transactions against those binaries. Preserve the transaction signatures and program-data hashes as release evidence.