## R1 — Self-audit repairs

### HIGH — `supersede()` leaves a standalone `resolvedBy` suppressor in place when a same-day run resumes

**Exact construct**

```js
export function supersede(rec, nowIso) {
  const was = [rec?.refused, rec?.nothingToDo].filter(Boolean)
  if (!was.length) return { rec, superseded: false, wasRefusal: false, was }
  ...
  for (const mark of DONE_MARKS) delete out[mark]
}
```

`DONE_MARKS` correctly includes `resolvedBy`, but `supersede()` only reaches the deletion loop if `refused` or `nothingToDo` is truthy.

The unfinished-distribution detector is suppressed by `resolvedBy` alone:

```js
if (rec.startedAt && !rec.finishedAt && !rec.nothingToDo && !rec.resolvedBy
    && day !== opts.today)
```

**Failure sequence**

1. A prior same-day distribution starts and is abandoned or manually resolved:
   ```json
   {
     "startedAt": "...",
     "resolvedBy": "operator: abandoned the earlier run",
     "paid": {}
   }
   ```
   This is explicitly supported by the detector’s own semantics: `resolvedBy` suppresses `distribution_unfinished`.

2. There is no `plan`, `nothingToDo`, or `refused`.

3. An operator reruns distribution that same day. `main()` reaches:
   ```js
   const sup = supersede(st.days[day], new Date().toISOString())
   st.days[day] = sup.rec
   st.days[day].plan = ...
   ```
   But `supersede()` returns unchanged because `was.length === 0`.

4. The new plan is persisted and the sender begins transfers.

5. The process crashes before completion.

6. On the next detector pass, the stale pre-rerun `resolvedBy` remains and suppresses `distribution_unfinished`, despite an active plan and an unfinished payout.

This is the same fail-open class that the repair was intended to remove. The selftest derives suppressor names from the detector, but its test record always includes `refused`:

```js
const rec = { startedAt: 'x', refused: 'r',
  ...Object.fromEntries(needed.map(k => [k, 'set'])) }
```

That forces the function past its early return and therefore does not test the `resolvedBy`-only path.

**Impact**

An operator accident or recovery workflow can conceal a crashed partial distribution. Some holders may remain unpaid while the alert intended to identify that condition stays silent. The stale resolution also makes the ledger look deliberately completed when it was not.

**Evidence if correct**

Add this allocation selftest:

```js
const rec = {
  startedAt: '2026-08-22T09:07:00Z',
  resolvedBy: 'operator: prior run abandoned',
  paid: {}
}
const sup = supersede(rec, '2026-08-22T14:00:00Z')
console.log(sup)
```

It currently returns `superseded: false` and retains `resolvedBy`.

Then model a crash after the caller stores `plan`:

```js
detectDistribution({
  days: {
    '2026-08-22': {
      ...sup.rec,
      plan: { activated: ['v1'], per: { v1: '100' } }
    }
  }
}, { today: '2026-08-23' })
```

It will not produce `distribution_unfinished`.

**Fix**

Base supersession on whether a new plan is replacing any detector completion/suppression mark, not merely the two no-pay fields. Preserve the distinction in audit metadata.

For example:

```js
export function supersede(rec, nowIso) {
  const alreadyPaid =
    Boolean(rec?.plan) || Object.values(rec?.paid || {}).some(settledAsPayout)

  if (alreadyPaid) {
    return { rec, superseded: false, alreadyPaid: true, was: [] }
  }

  const marks = DONE_MARKS.filter(mark => rec?.[mark] !== undefined)
  const verdicts = [
    rec?.refused && `refused: ${rec.refused}`,
    rec?.nothingToDo && `nothingToDo: ${rec.nothingToDo}`,
    rec?.resolvedBy && `resolvedBy: ${rec.resolvedBy}`,
  ].filter(Boolean)

  if (!marks.length && !verdicts.length) {
    return { rec, superseded: false, alreadyPaid: false, was: [] }
  }

  const out = { ...rec, supersededAt: nowIso, supersededWas: verdicts.join(' + ') }
  delete out.refused
  for (const mark of DONE_MARKS) delete out[mark]
  return { rec: out, superseded: true, alreadyPaid: false, was: verdicts }
}
```

Add both directions:

- `resolvedBy` without `nothingToDo`/`refused` is cleared before a new plan.
- A record with a real signature or durable plan is not reopened.
- A plan followed by a simulated crash produces `distribution_unfinished`, regardless of whether any prior completion mark existed.

---

## R2 — `bank/distribute.mjs`

No additional R2 finding is supported by the supplied code beyond the R1 failure above.

The cadence direction is as stated: a bare `resolvedBy` not counting as a payout increases `holdDays`; for a pool with `1 <= smallestPer < threshold`, a larger hold age reaches `MAX_HOLD_DAYS` sooner and therefore forces payment earlier, not later.

The dust bound is also correct for successful allocations:

\[
dust = available - \sum_i \left\lfloor\frac{available \cdot weight_i}{denominator}\right\rfloor
\]

Each paid vault contributes a fractional remainder strictly below one satoshi, so:

\[
dust < activated.length
\]

For the published 2,100-vault census, `available = 6404` produces one lost satoshi per vault except the aggregate remainder is one short of 2,100:

\[
dust = 2,099
\]

When `available` is too small to pay every activated vault at least one satoshi, `allocateWeighted()` returns a skip result with `dust = 0`; it does not violate the bound.

The refusal notification creates a deliberate pager-griefing surface: a customer can maintain an activated unlevelled vault and force a daily refusal and daily notification. This is operationally dangerous, but the supplied design deliberately treats an unresolved distribution halt as pageworthy. If that policy remains, notifications should be deduplicated/escalated by state transition rather than emitted indefinitely every day. That is a design decision, not a demonstrated code contradiction.

---

## R3 — `scripts/bank-sign.sh`

No accepted base64 bypass was identified in the shown logic.

The input is normalized by removal of POSIX whitespace intentionally, then constrained to the base64 alphabet, terminal padding, length divisible by four, and finally canonical decode/re-encode equality:

```bash
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
[ "$CANON" = "$TX" ] || exit 2
```

The `|| true` does not make a missing or failing `base64` command fail open: it makes `CANON` empty or partial, which cannot equal a nonempty valid transaction string. It fails closed, though hosts lacking GNU `base64 -w0` will reject legitimate transactions.

A 1,232-byte transaction encodes to:

\[
4 \times \lceil 1232 / 3 \rceil = 1644
\]

characters, which is accepted by this code; no fixed length ceiling is imposed.

The corrected comment is materially true: the base64 is not passed as an argument to `bank-sign.sh`, but it is passed in the `cosign.mjs` process argument vector after:

```bash
exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ...
```

---

## R4 — `scripts/cron-install.sh`

The fresh-install money posture is:

| Installed job | Invocation as installed | Can move customer money? |
|---|---|---:|
| watcher | `node bank/alarm.mjs` | No; monitoring only |
| distribution | `node bank/distribute.mjs$DIST_DRY` | **Yes by default**; fresh install has empty `DIST_DRY` |
| revenue | `node bank/revenue.mjs$REV_LIVE` | No on a fresh install; `REV_LIVE=''` |
| reconcile | `node bank/alarm.mjs --reconcile` | No; reads/reports state |
| deadman | notification shell command | No customer asset movement |

The revised header is substantially correct for a fresh crontab and expressly qualifies reruns. The script preserves `--dry-run` and `--live` only from uncommented, tagged project lines, which is the right scope.

---

## R5 — Changed gates

### MEDIUM — The “BankKeyOutside errors are in the control table” gate still searches all classified tables, not the control table block

**Exact construct**

```js
const isTableRow = l =>
  /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)

const tableLines = src => src.split('\n').filter(isTableRow).join('\n')
const tableSrc = tableLines(specSrc)

t('every Bank-confinement refusal ... is NAMED in the control table',
  bankErrs.filter(n => !tableSrc.includes(n)), [])
```

`controlTableBlock()` exists and correctly locates the intended table block, but it is not used for the `BankKeyOutside*` naming assertion. `tableSrc` includes every classified Markdown table row in the entire specification.

**Impact**

A future edit can remove `BankKeyOutsideMint` or `BankKeyOutsidePair` from the actual control table, leave or add the name in another classified Markdown table elsewhere in `SPEC.md`, and keep this gate green. The customer-facing control table would then omit an on-chain refusal that the gate claims it requires.

This does not bypass the on-chain confinement itself. It defeats the documentation/control-attribution gate intended to prevent precisely that documentation drift.

**Evidence if correct**

Construct a synthetic `SPEC.md` input that:

1. Removes `BankKeyOutsideMint` from the real control-table row.
2. Adds elsewhere:

```md
| historical note | `BankKeyOutsideMint` appeared in round 18 | archive | **PROCEDURE.** historical text |
```

`tableLines()` includes the historical row. Therefore:

```js
bankErrs.filter(n => !tableLines(modifiedSpec).includes(n))
```

returns no missing error name despite the actual control table no longer containing it.

**Fix**

Restrict all control-table assertions to the block returned by `controlTableBlock()`:

```js
const controlRows = src => {
  const block = controlTableBlock(src)
  if (!Array.isArray(block)) return []
  return block.filter(isTableRow)
}

const controlTableSrc = controlRows(specSrc).join('\n')

t('every Bank-confinement refusal ... is NAMED in the control table',
  bankErrs.filter(n => !controlTableSrc.includes(n)), [])
```

Add a negative test that moves a Bank error name out of the control table and into a different correctly classified table. The assertion must fail.

---

### LOW — `codeOnly()` is not a shell parser, but its present use is narrow

**Exact construct**

```js
const codeOnly = src =>
  src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
```

A line beginning with `#` is not necessarily a shell comment if it occurs inside an open quoted string, a here-document body, or another multiline syntactic context. Thus `codeOnly()` is not generally correct shell parsing.

**Impact**

This is currently a gate-quality weakness, not an identified live signing bypass. The current `bank-sign.sh` has no relevant multiline construct enclosing an executable `exec` line. A future source-layout change could make the gate inspect a transformed program that differs from shell execution semantics.

**Evidence if correct**

A shell fixture such as:

```bash
cat <<'EOF'
# exec node bank/cosign.mjs --tx "$TX"
EOF
```

contains data, not a shell comment. `codeOnly()` removes it anyway.

**Fix**

Do not attempt to parse shell with a line-prefix regular expression. For this exact property, avoid source rewriting entirely:

- extract only literal executable `exec` lines using a constrained AST-capable shell parser, or
- test the wrapper behaviorally using a fake `node` executable and controlled arguments, and
- retain the textual assertion only as a supplementary regression check.

---

## R6 — Counts and arithmetic

### LOW — `SPEC.md` still publishes obsolete direct-selftest counts

**Exact constructs**

In `SPEC.md`:

```md
node bank/distribute.mjs --selftest   # 63 allocation assertions, both directions
```

and:

```md
Every detector is proven in BOTH directions by `bank/selftest.mjs`
(69 assertions).
```

The current enforced floors are:

```bash
MIN_ASSERTIONS=286
DET_FLOOR=434
ALLOC_FLOOR=93
MAINNET_FLOOR=19
```

`bank/distribute.mjs` itself requires:

```js
const FLOOR = 93
```

and `bank/selftest.mjs` requires:

```js
const FLOOR = 434
```

**Impact**

The published operational instructions materially understate the amount of off-chain test coverage and contradict the source-enforced counts. This is a documentation-integrity defect. It also undermines the claim that numbers shown to operators are mechanically maintained.

**Evidence if correct**

Run:

```bash
node bank/distribute.mjs --selftest
node bank/selftest.mjs
```

The expected output totals are 93 and 434, respectively. The script’s own equality checks fail if either differs.

**Fix**

Update the two direct-command comments in `SPEC.md` to 93 and 434, respectively. Extend the existing selftest’s SPEC-count parser to cover these direct invocation lines, not just the aggregate `run-tests.sh` summary.

**Arithmetic re-derivation**

The published schedule arithmetic is internally consistent:

- 240-vault denominator:

\[
108(2)+60(3)+36(4)+24(5)+12(6)=216+180+144+120+72=732
\]

- 2,100-vault denominator:

\[
945(2)+525(3)+315(4)+210(5)+105(6)
=1890+1575+1260+1050+630=6405
\]

- Per-$1,000 figures:

| Level | 240 vaults | 2,100 vaults |
|---|---:|---:|
| I | 2.73 | 0.31 |
| II | 4.10 | 0.47 |
| III | 5.46 | 0.62 |
| IV | 6.83 | 0.78 |
| V | 8.20 | 0.94 |

- Level shares at 2,100 vaults:

\[
29.5\% + 24.6\% + 19.7\% + 16.4\% + 9.8\% = 100.0\%
\]

The displayed rounding is consistent with the underlying exact sum.

---

## Carry-over list

No additional accepted-limit item was shown to be worse than stated from the supplied files.

The known compute-unit limitation remains materially important. The new MINT instruction-sysvar traversal iterates every top-level instruction and every account meta of every mint-shaped instruction. It increases unmeasured transaction cost on a path containing a mandatory Bank signer. That is not a newly discovered limit; it is an additional reason not to treat the existing byte-size measurement as proof that all valid redemptions or mints fit compute budgets.

---

## Verdict challenges: underclaims and documentation direction

The most concrete remaining documentation defect is the stale 63/69 assertion-count language above. It understates current test coverage rather than overstating it, but it still contradicts the mechanically enforced test floor and tells an operator the wrong thing.

The control table’s stated distinction between mandatory Bank signature and skippable Bank policy is materially clearer than the prior ambiguous formulation. No additional underclaim of that same mandatory-signature guarantee was established from the supplied material.

---

## Anything else

The test that claims every distribution suppressor is cleared proves only a conditional subset:

```js
const rec = { startedAt: 'x', refused: 'r', ... }
const out = supersede(rec, 'now').rec
```

It proves deletion after entry into `supersede()`’s clearing branch. It does not prove that every state carrying a detector suppressor reaches that branch. This is the direct testing defect behind the R1 HIGH finding and should be corrected together with the code.

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

The project needs controls that do not depend on another model reading more source text.

1. **Run adversarial operational drills against a disposable deployment.**  
   Do not only execute unit assertions. Rehearse real failure sequences: kill the distributor after plan persistence, after the first transfer, after notification failure, after a manual `resolvedBy`, and during a same-day rerun. Assert ledger state, chain balances, detector output, notification behavior, and the next day’s resume behavior from artifacts.

2. **Create an independently operated release environment.**  
   The machine that edits source, runs AI audits, holds deployment credentials, and approves production artifacts must not be one trust domain. A separate CI/release host should build from an immutable commit, produce hashes and deployment artifacts, and refuse locally modified source. The audit runner’s own self-described fixed-tree checks are not independence when the same operator controls the source, runner, manifests, and interpretation.

3. **Require reproducible builds and independent binary verification before every upgrade.**  
   Build each deployable program from the release commit in two independent environments, compare hashes, decode upgrade authority and program IDs from chain, and archive all inputs. The local test suite verifies behavior; it does not establish that the deployed ELF equals the reviewed source.

4. **Use custody controls that make policy deviations observable outside this repository.**  
   The Bank policy is explicitly procedural. Put the Bank key behind a signing system that emits append-only, externally retained signing records; requires an out-of-band transaction digest approval; and can be disabled independently of the application host. Otherwise the assertion that the sanctioned path is singular is only a property of this tree, not of the actual signer.

5. **Commission independent economic and incident-response testing, even if no audit firm exists.**  
   Have a party with no source-edit access attempt operator workflows: malformed ledger recovery, pager flooding, cron reruns, key rotation, restoration from backups, and emergency halt/restart. The relevant question is not whether source assertions pass; it is whether operators can avoid losing or misdirecting cbBTC under pressure.

6. **Maintain an immutable production evidence log.**  
   Send distribution plans, payouts, signatures, balances, alert state transitions, cron posture, release hashes, and configuration snapshots to storage controlled separately from the payer host. A ledger written by the payer cannot be the sole authoritative reconstruction after compromise.