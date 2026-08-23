I will audit the diff and the delivered files in the order specified. I am treating the author’s claims as unproven until the code and the stated evidence support them.

---

# R1. Self-audit repairs

## R1-1 — Template-literal / escaping defects (render, don’t just read)

**MEDIUM — `scripts/audit19.ts` still ships a backslash-escaped `${` in the prompt body that auditors will see as literal text**

**Construct.** In `audit19.ts` the PROMPT template contains:

```text
- \${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT in the audit prompt: a backslash-escaped \${ renders as the placeholder, not the value...
```

That is intentional documentation of the round-18 bug, and under a normal TS template it becomes the characters `${FLOORS.onchain}` in the rendered prompt (the backslash is consumed by the template lexer). That part is fine.

**What still needs a render check.** The same file correctly interpolates `${FLOORS.onchain}`, `${DIFF}`, `${BUNDLE}`. I cannot execute `tsc`/node here; the evidence that would confirm a regression is: write `PROMPT` (or the substring around “All four programs pass”) to a file from the built JS and grep for the literal string `${FLOORS` or for a wrong numeric floor. If the rendered prompt contains `${FLOORS.onchain}` instead of e.g. `286`, the escape bug has recurred. The self-audit fixed the known site; no second live `\${FLOORS...}` site appears in `audit19.ts`’s actual floor sentence.

**No separate CRITICAL on this** without a rendered artifact. Residual risk: any future prompt edit that copies the *explanation* line’s escaping pattern into a live interpolation.

---

## R1-2 — `isTableRow` hoist

**LOW — predicate is used consistently in the gate; shape is still brittle**

**Construct.**

```js
const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)
```

Used for: `tableRows` filter, `controlTableBlock` classification, `tableLines` / `tableSrc`, and the “name only in prose” tamper. One definition — good.

**What it misses.**

1. Classification must be exactly `**ON-CHAIN.**` / `**AUTOMATIC.**` / `**PROCEDURE.**` with the bold markers and a trailing period. A real row written as `**ON-CHAIN**` (no period) or `**On-chain.**` fails `isTableRow`, then fails `EVERY row in the control table block carries a classification` — fail-closed. Good.
2. The regex does not require the classification to be in the fourth column; any cell matching is enough. A malformed row that puts `**PROCEDURE.**` in the “what it catches” column still counts as classified.
3. Leading spaces before `|` fail `controlTableBlock`’s `lines[i].startsWith('|')` but also fail `isTableRow`’s `^\|`. Consistent.

**Evidence if wrong:** a SPEC row that humans treat as a control row but `block.filter(l => !isTableRow(l))` is non-empty, or the opposite — a non-row matching `isTableRow`.

**Not a money bug.** Residual documentation drift risk only.

---

## R1-3 — `supersede()` clears refused, nothingToDo, **and** finishedAt

**HIGH — clearing `finishedAt` on supersede is correct for the quiet→pay→crash path; several orderings are still wrong or untested**

**Construct.** `supersede` deletes `refused`, `nothingToDo`, and `finishedAt` only when at least one of `refused` / `nothingToDo` was set. Call site: only when `!plan.skip && !DRY` before writing `plan`.

### Ordering analysis

| Ordering | Behaviour | OK? |
|---|---|---|
| Quiet morning (`nothingToDo`+`finishedAt`) → afternoon pay proceeds | Clears all three; crash before transfers → `distribution_unfinished` | Yes — the fix |
| Refuse → fix levels → pay same day | Clears `refused`+`finishedAt`; detector stops claiming refusal forever | Yes |
| Pay starts (no prior verdict) → crash → resume | `supersede` no-ops (`was` empty); `finishedAt` untouched; resume uses `st.days[day].plan` | Yes |
| Two pay runs same day without prior skip | Second run hits `if (st.days[day].plan && !DRY)` resume path; does **not** call `supersede` again | OK |
| `--dry-run` after a quiet morning | `!DRY` guard → supersede **not** called; dry-run does not clear flags (correct) | Yes |
| `--dry-run` that would refuse | Sets `exitCode = 1` even under dry-run (see R2) | Separate issue |

**Defect A — `supersede` only runs when a prior no-pay flag exists; a completed PAY day that later “proceeds” again is not the issue. Real gap: partial pay day with `finishedAt` unset and no `nothingToDo` already alarms. Good.**

**Defect B — HIGH — `resolvedBy` on the day record is a third suppressor of `distribution_unfinished` and is never cleared by `supersede`.**

Detector:

```js
if (rec.startedAt && !rec.finishedAt && !rec.nothingToDo && !rec.resolvedBy && day !== opts.today)
```

If an operator sets `resolvedBy` on a quiet/refused day (“abandoned”), then later the same day a real plan proceeds and crashes mid-pay, `supersede` does not clear `resolvedBy`. The half-paid day stays silent forever.

Evidence: ledger day with `resolvedBy`, `plan`, some `paid` sigs and some null, no `finishedAt` → `detectDistribution` returns no `distribution_unfinished`.  
Fix: either clear day-level `resolvedBy` in `supersede` when starting a real plan, or treat `plan` + incomplete pays as unfinished regardless of `resolvedBy`.

**Defect C — MEDIUM — `supersede` requires `refused` or `nothingToDo`; a day that only has stale `finishedAt` from a prior full success path cannot happen on the same calendar day with a new plan because plan is sticky. OK.**

**Defect D — pay then crash then resume does not re-enter supersede; flags already clear. OK.**

---

## R1-4 — Manifest git porcelain

**LOW — record shape is improved; `dirty` is still a footgun for consumers**

```js
dirty: dirty.split('\n').filter(Boolean)
```

Not trimming the blob preserves the leading status character on line 1. Good.

**Residual:** `filter(Boolean)` drops empty trailing line only. Lines remain full porcelain (`XY path`). Well-formed JSON array of strings.  
If `WATCHED` path list is wrong, SPEC dirty state can still be missed — audit19 fixed pathspec to include TARGETS; good for this round’s runner, not for audit18.

---

# R2. Round-18 off-chain repairs (`distribute.mjs`)

## R2-1 — `settledAsPayout` default direction

**Claim:** bare `resolvedBy` does not reset the clock → larger `holdDays` → ceiling fires sooner → pays sooner.

Trace:

- `holdDays` ↑ → `daysSinceLastPayout` ↑  
- `decideEmission`: if `smallestPer >= 1` and `daysSinceLastPayout >= 31` → `pay: true, forced: true`  
- Larger holdDays ⇒ reaches 31 sooner ⇒ **pays earlier**

Builder direction is **correct**. Selftest pins `52` vs `2` and forced pay on the bare path. **No finding.**

---

## R2-2 — `paymentState` unchanged for re-send

Call sites in delivered `distribute.mjs`:

1. Payment loop: `paid` / `resolved` / `unpaid` / `ambiguous` — resolved still skipped.  
2. SOL floor outstanding count: `paymentState(row) === 'unpaid'` only.  
3. `settledAsPayout` → cadence only.

Detectors use their own row fields (`sig`, `rejected`, `resolvedBy`), not `paymentState()`.

**No finding** that resolved rows are re-sent.  
**Note:** `settledAsPayout` does not treat `skipped` rows as payouts (correct).

---

## R2-3 — Refusal NOTIFY + exitCode 1

**HIGH — griefing → daily pages is real; exitCode under `--dry-run` is worse**

**Construct.**

```js
if (plan.refusal) {
  ...
  if (!DRY) { try { execFileSync(NOTIFY, ...) } catch {} }
  process.exitCode = 1  // NOT gated on !DRY
}
```

**Attack / accident:** Anyone can mint/activate a vault and omit it from `levels.json` (or race activation before the operator assigns a level). Every daily run:

- pays **nobody**
- pages the human (`NOTIFY` when not dry-run)
- exits 1

Under `--dry-run`, NOTIFY is skipped but **exitCode is still 1**, so cron / wrappers that alert on non-zero exit still page. The prompt explicitly flags this.

**Is paging right?** For a true data bug, yes. For a stranger-triggered halt, you need rate-limiting, aggregation into `alarm.mjs`, or auto-assign-or-quarantine — not unconditional SMS every 09:07.

**Evidence:** activate one vault not in `levels.json`; run distribute; observe NOTIFY + exit 1; repeat daily.

**Fix:** keep HIGH in detectors (already); throttle NOTIFY; under `--dry-run` do not set exitCode 1 unless `--strict`; consider paying others while quarantining unlevelled vaults only if product allows (author rejected that — then throttling is mandatory).

---

## R2-4 — `census()` null prototype + spread

```js
const c = Object.create(null); ...
return { ...c }
```

Spread into a normal object: JSON.stringify/parse round-trip keeps `I..V` keys. `denominator` uses `Object.hasOwn`. Ledger stores `plan.census` as plain JSON.

**No finding** on prototype pollution in production path. Exported helpers are safer than before.

---

## R2-5 — Dust bound re-derivation

Per vault: `amt = available * w / den` (floor).  
`dust = available - sum(amt)`.

Each paid vault contributes a fractional truncation `< 1` sat in the sense that the sum of per-vault floors leaves remainder `< number of terms` only when all weights participate as separate floor operations — actually:

`sum_i floor(avail * w_i / den)` with `sum w_i = den` yields  
`dust = avail - sum floor(...)` and classic result: `0 <= dust < n_activated` is **not** always true for arbitrary weights, but for this structure each of `n` vaults gets `floor(avail * w_v / den)`, and  

`sum_v floor(avail * w_v / den) >= sum_levels floor(avail * W_L / den) * n_L` ...

Selftest proves at full census `dustAt(6404n) === 2099n === activated - 1`. Good for the published census.

**When `available < den` and `smallest < min`:** `allocateWeighted` returns **skip** before returning dust — no payout dust. Bound vacuously unused.

**When some vaults skipped mid-run:** dust was computed on full activated set at plan time; skipped vaults don’t change the recorded plan dust. Not a bound break.

**Is `dust < activated.length` always true whenever a plan is returned?**

For identical weights it holds. For varied weights, remainder satisfies  
`dust = avail % gcd` style bounds; worst case in selftest is attained at `avail = den - 1`.

**Edge:** if `allocateWeighted` returned a plan with `activated.length === 0`, dust path N/A.

**LOW — comment says “dust < activated count” and “at most 2,099” but the code never asserts `dust < activated.length` in production — only in selftest.** Not exploitable.

**MEDIUM if wrong arithmetic on card:** loose bound 6404 was corrected in comments; card math in selftest still uses denominator 6405 correctly.

---

# R3. `scripts/bank-sign.sh` base64 round-trip

## R3-1 — Accepts non-canonical / wrong paste?

```bash
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
if [ "$CANON" != "$TX" ]; then refuse; fi
```

**HIGH — `base64 -w0` is GNU-specific; on macOS/BSD the re-encode fails open into empty CANON**

With `set -euo pipefail`:

- Pipeline in `$(...)` : failure is masked by `|| true`.
- If `base64 -w0` is invalid, re-encode fails → `CANON` empty → `"" != "$TX"` → refuse all. **Fail closed** on macOS without GNU coreutils. Good for safety, bad for portability (operators can’t sign).

**MEDIUM — GNU `base64 -d` is permissive about newlines inside the pipeline input; TX already has whitespace stripped.** OK.

**Embedded whitespace:** stripped before checks. OK.

**Alphabet check still allows `/+` padding forms; round-trip catches non-canonical padding.** Good.

**Locale:** `tr -d '[:space:]'` depends on locale for what is space; non-ASCII spaces might survive and fail alphabet check — fail closed.

**Find input accepted that decodes differently than paste?**

Node `Buffer.from(s,'base64')` and GNU `base64 -d` can disagree on obscure inputs. Round-trip uses GNU both ways, then Node decodes again in cosign. If GNU accepts and re-encodes to same string but Node drops characters… alphabet already restricted.

**Known residual:** very long lines — ARG_MAX when passing `$TX` to node after exec. A 1644-char tx is fine; multi-tx blobs could break. Accepted limit territory (tx in argv/ps).

**Does it reject legitimate 1644-char tx?** Canonical standard encoding with `+/` and `=` should round-trip on GNU. **Evidence:** `openssl rand 1232 | base64 -w0` through the script.

**Non-canonical but Node-equivalent:** rejected — correct for the stated goal.

## R3-2 — Corrected comment about `ps`

Comment now says: not in **this** script’s argv/history; **is** in cosign argv via `exec ... --tx "$TX"`.  
Last line is exactly that exec. **Comment is true.**

---

# R4. `cron-install.sh` money claim

Jobs installed:

| Tag | Line | Money as installed (fresh)? |
|---|---|---|
| watcher | `alarm.mjs` | No |
| distribute | `distribute.mjs$DIST_DRY` | **YES** if `DIST_DRY` empty (default) — live cbBTC |
| revenue | `revenue.mjs$REV_LIVE` | No unless preserved `--live` |
| reconcile | `alarm.mjs --reconcile` | No |
| deadman | notify SMS | No SOL/cbBTC; can SMS |

Header + computed posture block match this. Preserve logic for `--dry-run` / `--live` only from tagged uncommented lines — matches selftest.

**LOW — posture grep uses `crontab -l | grep -F "$TAG distribute"` without excluding comments.** After install, lines are not commented. If operator later comments out distribute and re-runs install, `ours` won’t see `--dry-run`, re-installs live distribute — header warns. Edge case.

**MEDIUM — deadman / notify can spam; not “moves money”.** Header doesn’t claim it doesn’t notify. OK.

**Header completeness:** Does not mention that **re-install preserves live revenue**. It does say re-run neither sentence is unconditional. OK.

**No CRITICAL.** Fresh install still arms distribute — now honestly documented.

---

# R5. Gates (`selftest.mjs`)

## R5-1 — `isTableRow` — covered in R1-2

## R5-2 — MintVault struct regex

```js
/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/
```

Non-greedy to first `\n}`.

**What terminates early:** a `}` on its own line inside the struct (e.g. nested in an attribute macro or a commented block that still matches — comments aren’t stripped). Nested braces in docs rare in Anchor account structs.

**Direction (pinned in selftest):** truncate before `bank` → index `-1` → assertion fail (closed). Truncate after `bank` → index still 4.

**LOW residual:** `pub bank_something` wouldn’t match field regex `pub (\w+):` incorrectly… it would be a different field. OK.

## R5-3 — `codeOnly` for shell

```js
src.split('\n').filter(l => !/^\s*#/.test(l))
```

**`#` that is not a comment:**

- `CMD # trailing comment` — line kept; trailing comment remains; “first match” exec replace could still hit a weird echo line.
- `echo 'exec node bank/cosign.mjs ...'` — kept; they pinned **exactly one** `^\s*exec .*cosign` line.
- `$#`, `${#arr}` — not at line-start after optional space with `#` as first non-space… `$#` doesn’t match `^\s*#`.
- Heredoc bodies with `#` — kept.

**MEDIUM — lines with only leading spaces then ` #` oddities OK. Quote-protected `#` mid-line OK.**

**Gap:** `codeOnly` does not strip `###` markdown in heredocs if any. bank-sign.sh is pure shell.

## R5-4 — stale nothingToDo arms

```js
t('a half-finished day raises...') // unfinished true
t('...and a STALE nothingToDo would silence it...') // unfinished false
```

These prove the **detector** suppresses on `nothingToDo`. They do **not** prove the **writer** clears the flag. Writer proof moved to `distribute.mjs` selftest via `supersede`.  

**LOW — selftest comment overclaims (“which is why the writer clears it”) while only testing the detector.** The distribute selftest closes the gap. Split-brain documentation.

**They do not test stale `finishedAt` alone** — that is in distribute selftest. OK if both run in CI.

---

# R6. Counts and arithmetic

From diff / files:

| Floor | run-tests.sh | module FLOOR |
|---|---|---|
| on-chain | MIN_ASSERTIONS=286 | — |
| detector | DET_FLOOR=427 | selftest 427 |
| alloc | ALLOC_FLOOR=79 | distribute 79 |
| mainnet | 19 | — |

Selftest now asserts module floors equal runner floors. **Consistent in source.**

**Independent arithmetic:**

- 108·2+60·3+36·4+24·5+12·6 = 216+180+144+120+72 = **732** ✓  
- 945·2+525·3+315·4+210·5+105·6 = 1890+1575+1260+1050+630 = **6405** ✓  
- per $1000 at 240: 2000/732≈2.73, 3000/732≈4.10, 4000/732≈5.46, 5000/732≈6.83, 6000/732≈8.20 ✓  
- at 2100: 2000/6405≈0.31 … 6000/6405≈0.94 ✓  
- shares: 945·2/6405=29.508%→29.5, … sum **100.0%** ✓  
- V/I weight = 3 ✓  

**SPEC cadence prose (under-claim / over-claim):** SPEC was updated with the zero-volume qualifier in the delivered SPEC.md. Good.

**HIGH — SPEC / distribute still disagree with operational reality on “forced monthly” if cards elsewhere omit the qualifier.** Grep customer cards outside this bundle if any.

---

# R7. What the self-audit missed (one-of-N)

## R7-1 — CRITICAL/HIGH — BURN program Bank confinement not in `bankErrs` / control table scrape scope

```js
const bankErrs = ['programs/cbob-vaults/src/lib.rs', 'programs/cbob-vault-mint/src/lib.rs']
```

BURN takes `bank: Signer` + `require_keys_eq!` but is **not** in the BankKeyOutside* scrape. If BURN later adds `BankKeyOutsideBurn` or SEAL-style walk, the gate won’t require a table row.

More important **under-claim (third target):** control table ON-CHAIN row names SEAL + BURN for “must sign”, and a separate row for key confinement names SEAL + MINT only. **BURN does not walk instructions to confine the Bank key** (known limit 1a/3 style). Table is accurate if BURN has no walk.  

**Under-claim already fixed partially** for signature mandatory. Remaining under-claim: MINT confinement is ON-CHAIN; fee payer still policy — documented.

## R7-2 — HIGH — `supersede` is one-of-three suppressors; `resolvedBy` not cleared (R1-3-B)

Self-audit claimed clearing both flags; then found finishedAt; **still missed day-level `resolvedBy`.**

## R7-3 — HIGH — Refusal paging is one site; SOL-floor and ambiguous paths notify, but unlevelled halt is infinitely repeatable by strangers

## R7-4 — MEDIUM — `codeOnly` / exec gate: one-of-N comment shapes (trailing `#`) mitigated by uniqueness assert only for exec lines

## R7-5 — MEDIUM — Floor equality fixed in run-tests, selftest, distribute; **SPEC numbers** gated; **audit prompt floors** read from run-tests — good. **audit18.ts** still historical.

## R7-6 — `settledAsPayout` only cadence reader — claim holds in distribute.mjs. Detectors don’t use paymentState for cadence. **OK.**

## R7-7 — CRITICAL class check: mint payer confinement

MINT now requires bank only at `MINT_IX_BANK_IDX` (4). Tests 9d.4.  
**Break attempts:** fake mint discriminator on another program — not exempt (`is_mint` needs program id + disc). Second mint_vault in tx — each checked. Bank as remaining account — refused.  

**Residual:** Bank as fee payer still invisible on-chain (known).  
**Account order:** instructions sysvar inserted; bank index pinned by gate. OK.

## R7-8 — COMPUTE UNITS still unmeasured (known 12) — mint walk makes mint txs heavier; still open; **worse with introspection** as noted.

---

# Third target — under-claims (safer than docs)

## U1 — HIGH (documentation) — Control table / SPEC understate MINT’s on-chain Bank confinement relative to “PROCEDURE” mental model

Cosign header and SPEC now say MINT refuses `BankKeyOutsideMint`. Good repair.

**Still understated:** BURN+SEAL signature requirement is ON-CHAIN; table row “THE BANK MUST SIGN” lists SEAL and BURN, not MINT — **MINT also requires bank signer** for mint_vault. A reader may think only redemption is 2-of-2. Mint is Bank-cosigned too.

Evidence: `MintVault` has `bank: Signer` + config pin.  
Fix: add explicit control row “MINT REFUSES WITHOUT BANK”.

## U2 — MEDIUM — `decideEmission` / MAX_HOLD_DAYS card

Corrected in distribute + SPEC. Search for any remaining “even at zero volume” without qualifier outside these files.

## U3 — LOW — bank-sign “PROCEDURE” is correct for policy; signature still mandatory — dual nature is now documented. OK if table stays split.

---

# Carry-over limits — worse than stated?

| # | Verdict |
|---|---|
| 1a allowlist/fee-payer off-chain | Unchanged; fee-payer still free on-chain |
| 3 Bank as payer inside pair | MINT no longer allows bank as mint payer — **stronger than limit 3’s spirit for mint**; limit 3 text is about redemption pair. Update limit text so nobody thinks mint payer still open |
| 12 CU unmeasured | **Worse:** mint_vault now walks all top-level ixs |
| 17 EMISSION_MIN provisional | Unchanged |
| Unlevelled halt | **Worse operationally:** now pages every day (R2-3) |

---

# Additional findings

## A1 — MEDIUM — `process.exitCode = 1` on refusal during dry-run

Already R2-3.

## A2 — MEDIUM — `CANON=... || true` hides decode errors that aren’t non-canonical (e.g. binary nonsense already caught by alphabet). OK.

## A3 — LOW — `supersede` records `was.join(' + ')` — if messages contain ` + `, ambiguous. Cosmetic.

## A4 — HIGH — Resume path + superseded quiet day

After supersede clears `finishedAt` and writes `plan`, if the process crashes **after** `save(st)` with plan but **before** any transfer, next run resumes plan. Good.  
If crash **during** supersede save after delete finishedAt but before plan write — incomplete write depends on `writeLedger` atomicity (assumed OK via lock.mjs).

## A5 — MEDIUM — `detectDistribution` unfinished arm still suppressed by `nothingToDo` even when `plan` exists and pays are partial

If supersede failed to clear (bug/old binary), silence returns. Writer fix is the real fix; detector could treat `plan && unpaid rows` as unfinished regardless of nothingToDo — defense in depth missing.

```js
// stronger detector (not implemented):
// if (rec.plan && hasUnpaid(rec) && !rec.finishedAt) fire unfinished
```

**Evidence:** inject ledger with both `plan` and `nothingToDo` and partial paid → currently quiet.  
**Fix:** detector should prefer plan/pay reality over stale flags.

---

# Verdict challenges on builder claims

1. **“settledAsPayout is the ONLY cadence site”** — True in distribute.mjs.  
2. **“clearing both refused and nothingToDo is enough”** — **False** until finishedAt (fixed) and **still false** for `resolvedBy`.  
3. **“dust < activated always”** — True for returned plans in tested census; skip paths don’t return dust.  
4. **“default bare resolvedBy pays sooner”** — **True.**  
5. **Cron header** — **True** for fresh install regarding distribute live / revenue dormant.

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Concrete actions sixteen AI rounds will not replace:

1. **Mainnet shadow mode with real money path disabled but real DAS/ledger:** run `distribute.mjs --dry-run` against production inventory for N days; diff planned payouts to an independently written spreadsheet from `minted_total` + levels hash; require two-person sign-off on first live day.  
2. **CU measurement on the exact redemption and mint transactions** (mainnet-beta simulation with max reserve set), gate in CI with a hard ceiling — AI will keep missing CU until a number fails a test.  
3. **Fault injection on the distributor box:** kill -9 mid-loop, corrupt one ATA, activate unlevelled vault, re-run cron-install with commented revenue — automated chaos suite, not prompt review.  
4. **External receiver of pages:** a second pager duty that only receives `distribution_refused` / `distribution_unfinished` and pages if **count > threshold**, so AI-added NOTIFY cannot become a griefing amp without ops design.  
5. **Publish the level assignment commitment** (open item 16) before activation — no amount of detector review makes “fate” verifiable.  
6. **One real redemption and one real mint on mainnet with dust amounts** through `bank-sign.sh`, then verify confinement logs and explorer account lists — ends class of “serialized tx shape” mistakes.  
7. **Stop shipping audit runners that are the subject of the audit in the same commit as money-path fixes** without a separate freeze; the runner has repeatedly certified false quorums.

---

## Summary table (severity)

| ID | Sev | Issue |
|---|---|---|
| R1-3-B / R7-2 | **HIGH** | `supersede` never clears day-level `resolvedBy`; unfinished pay can stay silent |
| R2-3 / R7-3 | **HIGH** | Stranger-triggerable refusal pages daily; exit 1 even under `--dry-run` |
| A5 | **MEDIUM** | Detector trusts stale `nothingToDo` over `plan`+partial pays |
| R3-1 | **HIGH**→portable **MEDIUM** | `base64 -w0` GNU-only; fail-closed off GNU |
| U1 | **HIGH** (doc) | MINT bank-signer 2-of-2 under-documented in control table |
| Limit 3 text | **MEDIUM** | Stale vs mint payer confinement fix |
| R5-4 claim | **LOW** | Selftest arms prove detector only |
| R1-2 | **LOW** | `isTableRow` column-agnostic |
| CU / known 12 | **OPEN worse** | Mint ix walk unmeasured |

I am **not** certifying this tree safe for customer cbBTC. The highest-impact unfixed defects in *this* diff are: incomplete supersede suppressors (`resolvedBy`), griefable daily paging/halt, and detector fail-open when flags and plan disagree.