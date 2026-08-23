## R1 — self-audit repairs

### HIGH — `scripts/audit19.ts` permits a one-model “quorum” through `MODELS`

**Exact construct**

```ts
const MODELS=(process.env.MODELS||[ ... eight defaults ... ].join(',')).split(',')
const QUORUM_FLOOR=Math.ceil(MODELS.length*0.75)
```

The new `MIN_AUDITORS` validation only prevents lowering the quorum relative to the *selected* roster. It does not prevent an operator from replacing the roster itself with one model:

```sh
MODELS=openai/gpt-5.6-luna-pro npx tsx scripts/audit19.ts
```

That produces:

```ts
MODELS.length = 1
QUORUM_FLOOR = 1
MIN_AUDITORS = 1
```

One usable report therefore certifies a round as `1/1 real auditors`.

**Impact**

The claimed multi-model independent-review condition can be bypassed without editing the runner. A compromised CI environment, a careless operator, or an intentional “get the round through” invocation can turn the certification process into one model agreeing with itself.

This is not merely a reporting defect: this process is declared to be the certification authority.

**Evidence if true**

Run the runner with a single valid model ID and inspect the generated manifest:

```json
{
  "requested": 1,
  "auditors": 1,
  "required": 1
}
```

The process exits zero if that one report is accepted.

**Fix**

Do not derive the minimum acceptable auditor count from an environment-overridable roster.

At minimum:

1. Pin an approved roster manifest in the repository, including a minimum number of distinct providers/families.
2. Permit `MODELS` only as a selection from that manifest, not arbitrary replacement.
3. Require a non-overridable absolute floor, e.g. 6 usable reports from at least 4 independent providers.
4. Record the approved roster hash in `MANIFEST-*.json`.
5. Make “reduced roster” a hard failure, not an operator option.

---

### HIGH — the older certification runner remains capable of certifying zero auditors

**Exact construct**

`scripts/audit18.ts` remains executable and contains:

```ts
const MIN_AUDITORS=Number(process.env.MIN_AUDITORS||Math.ceil(MODELS.length*0.75))
...
if(good.length<MIN_AUDITORS){
  process.exitCode=1
}
```

As the round-19 self-audit itself describes, this permits both:

```sh
MIN_AUDITORS=0
```

and:

```sh
MIN_AUDITORS=x
```

For `NaN`, `good.length < NaN` is false. For zero, no nonnegative result is below zero.

Round 19 repaired its own runner but did not disable or harden round 18’s still-runnable certification script.

**Impact**

A user can run the historical runner, obtain a manifest and report files, and receive exit status zero with zero valid auditors. Since the project treats artifacts and process claims as certification evidence, this is an alternative certification bypass.

**Evidence if true**

Run, for example:

```sh
MIN_AUDITORS=0 MODELS=<invalid-or-refusing-model> npx tsx scripts/audit18.ts
echo $?
```

The manifest should show zero usable auditors while the process can exit zero.

**Fix**

Delete, archive outside the executable tree, or make every superseded audit runner unconditionally fail with a message that it is non-certifying. Better:

- have one maintained runner;
- make historical scripts wrappers that exit nonzero;
- ensure CI rejects any manifest not emitted by the current runner/version;
- include runner source hash and schema version in the manifest.

---

### MEDIUM — audit target snapshot is still not atomically bound to the recorded commit

**Exact construct**

In `scripts/audit19.ts`, module-scope code reads the working tree and constructs `DIFF`, `BUNDLE`, and `PROMPT` before `main()` records:

```ts
const DIFF=execSync(`cd ${R} && git diff ec7d17e..HEAD ...`).toString()
const BUNDLE = TARGETS.map(... f(path) ...).join('\n')
const PROMPT=`...${DIFF}...${BUNDLE}`
```

Later, inside `main()`:

```ts
const head=execSync('cd '+R+' && git rev-parse HEAD').toString().trim()
...
const headAfter=execSync('cd '+R+' && git rev-parse HEAD').toString().trim()
if(headAfter!==head) process.exitCode=1
```

The new `headAfter !== head` check detects a commit made while models are reading, but not a commit landing after module-scope prompt construction and before `head` is read.

**Impact**

The manifest can name commit B while the auditors received source/diff from commit A. This is especially damaging because the runner’s stated purpose is to prove which exact tree was audited.

**Evidence if true**

Instrument the runner with a deterministic pause after `PROMPT` construction but before `git rev-parse HEAD`, then commit during that pause. The manifest’s `head` will be the new commit, `headAfter` will match it, but the prompt hash will correspond to the old tree.

**Fix**

Create a snapshot before reading any audit material:

1. Require a clean tree before prompt construction.
2. Resolve `HEAD` once.
3. Read every target by immutable object ID, e.g. `git show "$HEAD:$path"`.
4. Generate the diff by commit IDs, not from the mutable worktree.
5. Record `head`, a hash of the complete prompt, and hashes of each bundled file.
6. Refuse if current `HEAD` or worktree differs before launch or after completion.

---

### MEDIUM — refusal notifications create an attacker-triggerable repeated paging channel

**Exact construct**

`bank/distribute.mjs` now does:

```js
if (plan.refusal) {
  const msg = `CBOB DISTRIBUTION REFUSED and paid nobody: ${plan.skip}`
  console.error(msg)
  if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
  process.exitCode = 1
}
```

The stated refusal condition includes an activated vault lacking a level. The prompt itself recognizes that a stranger can trigger this by activating a qualifying vault for which `levels.json` has no entry.

**Impact**

The existing public halt/griefing surface now also becomes a recurring human-paging surface. A single unresolved vault can produce a notification on every live daily distribution run until staff intervene. Repeated alert traffic can cause alert fatigue, hide a materially different incident, and potentially incur notification-provider cost.

This is worse than merely making the halt visible. The code has no deduplication, acknowledgement state, rate limit, or escalation policy.

**Evidence if true**

Create a ledger/plan containing an activated unlevelled vault and run the live path on consecutive days, or simulate `NOTIFY`. It will invoke the notifier once per run with the same refusal class.

**Fix**

Keep a refusal visible but make notification stateful:

- fingerprint the refusal reason and affected vault set;
- notify once on first occurrence;
- resend only on state change or a bounded escalation schedule;
- record `lastNotifiedAt` and notification outcome;
- distinguish human-initiated dry runs from production failures;
- retain `process.exitCode = 1` for monitoring, but do not equate every repeated known refusal with a fresh page.

---

## R2 — distribution repairs

### LOW — the corrected dust disclosure was not applied to `SPEC.md`

**Exact construct**

`bank/distribute.mjs` now correctly says:

> `dust < activated count` — at 2,100 vaults at most 2,099 sats.

But `SPEC.md` still says:

> “at 2,100 vaults the remainder can be up to **6,404 sats** a settlement.”

That figure is a loose denominator-based upper bound, not the stated maximum under this allocator.

**Impact**

Customer-facing documentation materially overstates retained settlement dust by roughly threefold. It is not a payout theft, but it is an incorrect disclosure about how much of a distribution may remain in the pool.

**Evidence if true**

For paid vaults \(i = 1,\ldots,N\), each allocation has fractional remainder strictly below one satoshi:

\[
a_i = \left\lfloor \frac{A w_i}{D} \right\rfloor
\]

Thus:

\[
\text{dust}
= A-\sum_i a_i
= \sum_i \operatorname{frac}\left(\frac{A w_i}{D}\right)
< N
\]

For 2,100 activated/paid vaults, dust is at most 2,099 sats. The suite’s `available = 6404` case reports 2,099.

If `available < N`, every paid amount may be zero, but dust is then `available < N`; the same bound holds.

**Fix**

Replace the SPEC text with the actual bound and add a gate that searches all customer-facing schedule/disclosure text for obsolete `6,404` language. The current arithmetic gate proves allocator behavior but does not prevent stale prose elsewhere.

---

### LOW — the documented direct allocation-test count remains stale

**Exact construct**

In `SPEC.md`:

```text
node bank/distribute.mjs --selftest   # 63 allocation assertions, both directions
```

The runner and allocator now require 79:

```sh
ALLOC_FLOOR=79
```

and:

```js
const FLOOR = 79
```

**Impact**

The project says counts move with the floors and uses counts as evidence that tests did not stop early. A stale direct-command count undermines that claim and misleads an operator who runs the command named in the documentation.

**Evidence if true**

```sh
node bank/distribute.mjs --selftest
```

should report `79/79 allocation assertions as predicted`, while the documented command still says 63.

**Fix**

Update the direct command documentation and add it to the existing count parser. The current gate checks the “Running the tests” summary figures but misses stale counts in other operational command descriptions.

---

### LOW — the documented detector-test count is also stale

**Exact construct**

`SPEC.md` says:

> “Every detector is proven in BOTH directions by `bank/selftest.mjs` (**69 assertions**).”

The actual enforced floor is:

```js
const FLOOR = 427
```

**Impact**

This is another stale measurement in a document that explicitly presents assertion counts as confidence evidence. It makes the documentation internally inconsistent: the test-running section correctly says 427 detector assertions while the operational-description section says 69.

**Evidence if true**

```sh
node bank/selftest.mjs
```

reports 427 assertions.

**Fix**

Update the prose and extend the count gate to find every assertion-count claim associated with `selftest.mjs`, not only one expected regex location.

---

## R3 — `scripts/bank-sign.sh`

### LOW — canonicalization depends on GNU-specific `base64 -w0` and can halt legitimate signing on a non-GNU host

**Exact construct**

```sh
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
```

`-w0` is GNU coreutils syntax. It is not supported by the BSD/macOS `base64` implementation.

The `|| true` masks the actual command failure. The script then sees an empty or incomplete `CANON` and emits a misleading “not CANONICAL base64” refusal.

**Impact**

A legitimate 1,644-character base64 legacy transaction can be rejected on a machine where the script otherwise appears usable. This is a signing-availability issue, not a transaction-substitution bypass.

The intended deployment may currently be Ubuntu/coreutils, but the script neither enforces nor verifies that prerequisite.

**Evidence if true**

On a BSD/macOS host:

```sh
printf 'AAAA' | base64 -w0
```

fails because `-w0` is unsupported. Passing any valid transaction to the wrapper then fails the canonical comparison.

**Fix**

Either:

- explicitly require GNU coreutils at startup and verify `base64 -w0` works before processing a transaction; or
- use a portable canonical encoder with known behavior, such as Node’s `Buffer.from(bytes).toString('base64')`, while retaining strict pre-Node validation; or
- invoke `base64` via a pinned GNU coreutils path in the deployment image.

Do not suppress the pipeline failure with `|| true`; distinguish “base64 tool unavailable/failed” from “input is noncanonical.”

I did not identify an accepted noncanonical alphabet/padding input that survives the decode/re-encode equality check on GNU coreutils. The round trip closes the previously demonstrated `====`, `A===`, `AB==`, `AAB=`, and `AAAA====` cases.

---

## R4 — cron installer money claim

No additional money-moving cron job was identified beyond the two named jobs:

| Installed job | Can move customer/project funds as installed? |
|---|---|
| `bank/alarm.mjs` | No; monitoring only. |
| `bank/distribute.mjs$DIST_DRY` | Yes by default on a fresh install; no if a tagged active prior line preserved `--dry-run`. |
| `bank/revenue.mjs$REV_LIVE` | No on a fresh install; yes if a tagged active prior line preserved `--live`. |
| `bank/alarm.mjs --reconcile` | No; reads/reconciles state. |
| deadman `notify-gary-sms.sh` | No cbBTC/SOL movement, though it may incur notification-provider cost. |

The revised header’s conditional re-run qualification is materially necessary and matches the generated lines.

---

## R5 — gates

### LOW — `codeOnly()` is not a shell parser, but this specific gate fails closed rather than silently accepting a bad wrapper

**Exact construct**

```js
const codeOnly = src => src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
```

A leading `#` is not universally “a comment” in shell lexical contexts: it can appear within quotes, heredocs, parameter expansions, or data. Conversely, an inline shell comment is not removed.

The later tamper uses an unanchored replacement:

```js
codeOnly(signSh).replace(/exec .*cosign\.mjs.*$/m, ...)
```

so an earlier quoted or echoed `exec ... cosign.mjs` could become the replacement target instead of the real execution line.

**Impact**

For the currently asserted property, this produces a false test failure rather than a false pass: the real anchored execution line remains and the test expecting `false` gets `true`. That is fail-closed. It is still fragile and encourages future loosening of the test when a harmless shell string breaks it.

**Evidence if true**

Add a non-comment executable line before the real `exec`, such as an `echo` containing the command-shaped text. The unanchored replacement targets the earlier text while the anchored real-exec assertion continues to match.

**Fix**

Avoid source-rewrite proof for shell semantics. Parse only the final executable line structurally, or execute the wrapper in a controlled harness with a fake `node` and assert its exact argv. That tests the property actually needed: the wrapper forwards only `--tx "$TX"` and optional recognized `--live`.

---

## R6 — arithmetic and floors

The supplied values are internally consistent where independently derivable:

- \(108·2 + 60·3 + 36·4 + 24·5 + 12·6 = 732\).
- \(945·2 + 525·3 + 315·4 + 210·5 + 105·6 = 6{,}405\).
- Level shares are proportional to \(2:3:4:5:6\), totaling 20 weight units:
  - I: 10.0%
  - II: 15.0%
  - III: 20.0%
  - IV: 25.0%
  - V: 30.0%
  - Total: 100.0%.
- A level-V vault’s per-vault allocation is exactly \(6/2 = 3\) times level I’s before integer flooring; same-level allocations remain equal.

The stale `63` and `69` assertions above show that floor synchronization was repaired only for selected documentation locations, not all published count claims.

---

## Carry-over / accepted-limit challenges

### MEDIUM — documentation still overstates the sweep attack surface by calling an operator-signed instruction “permissionless”

**Exact construct**

`Mint` currently requires:

```rust
pub swap_operator: Signer<'info>,
...
require_keys_eq!(ctx.accounts.swap_operator.key(), cfg.swap_operator, ...)
```

But `SPEC.md` still says in multiple places that `sweep_sol_for_swap` is “permissionless,” including the revenue table and surrounding discussion.

**Impact**

This is the inverse documentation defect requested in the review: the implementation is stronger than the documentation says. A stranger cannot consume the sweep cooldown or initiate a sweep merely by submitting the instruction; the configured operator must sign.

The under-claim makes the system appear less protected against sweep-griefing than it is and leaves customer/operator threat modeling inaccurate.

**Evidence if true**

Submit `sweep_sol_for_swap` without the configured `swap_operator` signature. Anchor account validation rejects it before any SOL transfer.

**Fix**

Replace every “permissionless” description of `sweep_sol_for_swap` with “operator-signed, destination-pinned, capped and cooldown-limited.” Add a cross-file documentation gate for this specific authorization property, because the stale claim appears in more than one section.

---

### MEDIUM — `SPEC.md` says rotating `swap_operator` requires governance, but the program permits admin to arm it alone

**Exact construct**

`SPEC.md` says `update_wiring(...)` entries including `swap_operator` “additionally require the governance signature.”

The code computes:

```rust
let needs_governance = treasury.is_some() || bank_treasury.is_some()
    || split_bps.is_some()
    || sol_reserve_lamports.is_some()
    || governance_timelock_secs.is_some()
    || ...
```

`swap_operator.is_some()` is absent. Admin alone may arm a replacement operator, subject to the configured timelock:

```rust
if let Some(x) = swap_operator {
    c.pending_operator = x;
    c.pending_operator_at = now.checked_add(c.governance_timelock_secs)?;
}
```

**Impact**

The documentation overstates the authorization requirement on the address that receives swept SOL. The timelock is meaningful, but it is not a governance signature. Operators and holders may make incorrect assumptions about who can initiate an operator rotation.

**Evidence if true**

Invoke `update_wiring` as the current admin with only `swap_operator: Some(new_key)` and no governance signer. It should arm the pending operator rather than return `TreasuryNeedsGovernance`.

**Fix**

Correct the spec and event/operational documentation to state:

- admin may arm an operator rotation;
- the value is publicly timelocked;
- any party may apply it after the delay;
- governance does not co-sign this action.

Then add a test matching the documented authorization matrix against actual `needs_governance` logic.

---

## Verdict challenges

1. **Do not treat the new quorum validation as a complete repair.** It blocks `MIN_AUDITORS=0` only in `audit19.ts`; it does not prevent `MODELS` from shrinking the required quorum, and it leaves `audit18.ts` runnable with the original bypass.

2. **Do not treat “the manifest no longer trims porcelain” as proof of immutable audit provenance.** The JSON record is well-formed, but the source bundle is still constructed before the recorded commit is captured.

3. **Do not repeat the incorrect cadence-direction finding.** The code’s reasoning is correct: leaving a bare `resolvedBy` as non-payout makes `holdDays` larger; a larger `holdDays` reaches the 31-day forced-emission condition sooner, not later, provided `smallestPer >= 1`. At zero/insufficient pool volume, the earlier `smallestPer < threshold` branch prevents forcing altogether.

4. **Do not describe the dust bound as `denominator - 1` in customer-facing material.** It remains a mathematical upper bound but is not the tight product disclosure bound for this allocator.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

The project needs controls that do not depend on another language model correctly reading a repository snapshot.

1. **Build a deterministic adversarial transaction laboratory.**  
   Generate and execute malformed and adversarial Solana transactions against a local validator automatically: duplicated metas, reordered accounts, extra instructions, CPI wrappers, account aliases, malformed instruction-sysvar conditions where constructible, multiple redemptions, and maximum-size messages. Persist every minimized counterexample as a regression test. AI can suggest cases; an execution fuzzer can discover cases neither prompt author nor model enumerated.

2. **Make release provenance independently reproducible.**  
   A separate machine/service should rebuild the exact deployed artifacts from a commit hash, verify program IDs, ELF hashes, upgrade authorities, Core hash, cron template hash, and runner hash, then publish an append-only signed attestation. It must read Git objects by hash, never a mutable worktree. This addresses source/release substitution, not merely source correctness.

3. **Use real-money staged exposure with hard on-chain limits.**  
   Before unrestricted deposits, deploy with a small immutable aggregate exposure cap, a low per-vault cap, and a defined observation period. Raise caps only through a delayed, publicly visible governance action after actual end-to-end cycles: mint, revenue, swap return, split, distribution, redemption, crash recovery, and reconciliation. Tests on cloned Core are necessary but do not establish production operational behavior.

4. **Continuously reconcile against independent data sources.**  
   The distribution payer’s ledger must not be the authoritative accounting source. Produce an independently generated daily statement from RPC/indexer data and compare: revenue-PDA balances, split transfers, distributor transfers, recipient balances, and expected weighted allocations. Store signed snapshots outside the payer host. The comparison must remain meaningful if the payer machine, its JSON ledger, and its notification configuration are all compromised together.

5. **Exercise incident response as software, not prose.**  
   Regularly perform controlled failure drills: unavailable DAS, malformed ledger, failed notification, stuck flock holder, missing key, denied token transfer, cron reinstallation, and swap-return mismatch. Measure whether a human receives the correct alert, whether further money movement stops where intended, and whether recovery avoids duplicate payment. This finds the behavioral failures that source-reading gates systematically miss.