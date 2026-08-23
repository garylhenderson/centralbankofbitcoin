# INDEPENDENT REVIEW — ec7d17e..HEAD

Scope note that matters for calibration: `bank/distribute.mjs`'s `main()`, `bank/detectors.mjs`, `bank/cosign.mjs`, `bank/revenue.mjs`, `scripts/bank-sign.sh` (whole file) and `scripts/cron-install.sh` (whole file) were **not** in my bundle — only their diff hunks. Where a claim of mine depends on unseen code I say so and give the exact command that settles it. Where I could compute or re-derive something, I did, and I say what I got.

Two things I checked and could **not** break, stated up front so the report isn't read as uniformly negative:

- **`settledAsPayout`'s default direction is correct.** Traced: `holdDays` → `daysSinceLastPayout` → `decideEmission`'s second branch `daysSinceLastPayout >= maxHoldDays`. A larger value crosses 31 sooner. Not resetting the clock therefore pays *earlier*. The builder's reasoning and its pinned `[true,false]` assertion agree with mine.
- **The dust bound is right and the attainment argument is right.** `den = Σw_i` over the paid set, so `drop − Σ⌊drop·w_i/den⌋ = Σ frac_i < N`. At `drop = den−1`, `⌊(den−1)w_i/den⌋ = w_i−1`, so dust `= N−1 = 2099`. Attained, not merely bounded. The `errNames` claim "identical to the old scrape (16/33/21/17)" also checks out: I counted 16 SEAL / 33 MINT / 21 BURN variants by hand against the delivered sources.

Everything below is a fault.

---

# R1 — THE SELF-AUDIT'S OWN REPAIRS

## R1-1 · HIGH · `supersede` swaps the ledger record for a shallow copy, and clearing `finishedAt` can make a settled day permanently unfinished

**Construct.**
```js
const out = { ...rec }        // NEW OBJECT
...
delete out.finishedAt
return { rec: out, ... }
```
```js
const sup = supersede(st.days[day], new Date().toISOString())
st.days[day] = sup.rec
```

Two separate problems in six lines.

**(a) Object identity.** When `superseded` is true, `st.days[day]` is *replaced* by a copy. Any local binding of the day record taken earlier in `main()` — the idiom `const rec = st.days[day]` — now points at an orphan, and every subsequent write to it is silently discarded from the saved ledger. This is the money ledger. `main()` was not in my bundle so I cannot assert the alias exists; I can assert that the function was written as if it could not.

**(b) `finishedAt` is deleted on a *condition* that does not imply the day is unfinished.** `supersede` deletes `finishedAt` whenever `refused || nothingToDo` is present. It does not check whether the day also carries `paid` rows with real signatures. So the ordering *quiet morning → afternoon run proceeds → the plan pays nobody (every vault skipped at pay time, e.g. all ATAs unreadable) → no `finishedAt` re-written* leaves a day with `startedAt`, a `plan`, no `finishedAt`, no `nothingToDo` — a permanent HIGH `distribution_unfinished` whose only cure is hand-editing the money ledger. That is verbatim the failure the round-18 repair was written to remove, re-created by the round-19 repair of that repair.

**Evidence if I'm right.**
```bash
grep -n 'st\.days\[day\]' bank/distribute.mjs | head -40      # look for a captured alias
# behavioural:
#  1. force a quiet day (empty pool) -> ledger has nothingToDo + finishedAt
#  2. fund the pool, poison every vault ATA so all are skipped, re-run same day
#  3. jq '.days["<today>"] | has("finishedAt")' distributions.json   -> false
#  4. node bank/alarm.mjs  -> distribution_unfinished, forever
```

**Fix.** Mutate in place (`delete rec.refused` etc.) rather than returning a copy; and gate the `finishedAt` deletion on `!Object.keys(rec.paid ?? {}).length` — a day that already sent money is not a day whose completion mark may be revoked. Add an assertion for "supersede does not clear `finishedAt` on a day with paid rows".

## R1-2 · MEDIUM · The two new gates do not prove the claim their titles make, and the repair's stated motive is covered twice over

**Construct.** `bank/selftest.mjs`:
```js
t('...and a STALE nothingToDo would silence it — which is why the writer clears it',
  D.detectDistribution({ days: { '2026-08-20': { startedAt: 'x', nothingToDo: '...',
    paid: { v1: { sig: 'abc' }, v2: { sig: null } } } } }, { today: '2026-08-21' })
    .some(f => f.kind === 'distribution_unfinished'), false)
```

`.some(kind === 'distribution_unfinished') === false` proves that **one** finding is suppressed. The comment above it, and `distribute.mjs`'s justification, claim something much stronger: *"a half-finished day with unpaid holders goes silent."* The fixture has `v2: { sig: null }`, which is exactly what the CRITICAL `distribution_unresolved` arm exists for (`t('CRITICAL when a transfer has no signature', …)`). If `distribution_unresolved` is not itself suppressed by `nothingToDo`, then the day is **not** silent, the alarm fires at CRITICAL rather than HIGH, and the motivating scenario for deleting `finishedAt` is imaginary.

Note that the round-19 fixture for the crash case (`crashed = { plan: {...} }` with **no `paid` at all**) is a *different* scenario from the one the comment describes ("pays only PART of the vaults", which necessarily writes `sig:null` rows). The gap that actually exists is "died before writing any row"; the prose argues from a case that is already covered.

**Evidence.** Change both arms to `..., [])` / `..., ['distribution_unfinished'])` — i.e. assert the *whole* kind list. If the second arm then reads `['distribution_unresolved']`, the repair's premise is wrong.

**Fix.** Assert full kind lists, not `.some()`, in any arm whose title claims silence. Correct the justification comment to name the case that is actually open.

## R1-3 · LOW · The manifest record is well-formed; the *pathspecs* now disagree, and that is how this round's worst documentation defect escaped

`git status --porcelain` emits `XY path`; `.split('\n').filter(Boolean)` yields a clean array of strings with the two-char status intact. The record is fine.

But `WATCHED` now includes `SPEC.md` while `DIFF` is still `git diff ec7d17e..HEAD -- programs bank scripts tests`. So SPEC.md is checked for cleanliness and **excluded from the diff every auditor reads**. That is the exact mechanism behind R6-1 below: SPEC's dust figure and `distribute.mjs`'s dust figure now contradict each other, and no auditor could see the SPEC side change because the diff cannot show it.

**Fix.** One list: `const PATHS = WATCHED`, used for both `git diff` and `git status`.

## R1-4 · MEDIUM · Rendered, the prompt still carries four hardcoded numbers sitting beside the ones that were fixed

I rendered what I was given and read it. The FLOORS interpolate correctly (`286` / `427` / `79` / `19`) and the deliberately-escaped `${FLOORS.onchain}` renders as the placeholder as intended. No unescaped `${` or stray backtick survives.

What survives instead:

| in the rendered prompt | reality |
|---|---|
| "`scripts/audit-coverage.sh` gates that and passes at **27 of 27** files" | this diff **adds two files to `scripts/`** (`audit18.ts`, `audit19.ts`). Either the count moved or audit files are excluded — the prompt asserts a gate result it does not read. |
| "Everything omitted has been in at least one prompt across **rounds 1-17**" | round 19. |
| "sixteen rounds of AI audit structurally cannot" | nineteen. |
| "REPORT FORMAT. Order by target: **R1-R6**" | there are seven targets; R7 is unordered. |

These sit two paragraphs from the block that says *"a number duplicated into a document is a number that drifts — this repository's most repeated defect, committed inside the instrument that certifies it."* The FLOORS were fixed; the four numbers next to them were not. **SHIP GATE item 1 depends on `audit-coverage.sh` exiting 0**, and this diff adds two files that have never been in a prompt.

**Evidence.** `./scripts/audit-coverage.sh; echo $?` and read the printed count.

**Fix.** Read the coverage figure from the script's own output (`grab()`), or delete the number. Derive the round number from the file name.

---

# R2 — THE ROUND-18 OFF-CHAIN REPAIRS

## R2-1 · HIGH · A resumed day recomputes the plan from the *reduced* balance and overwrites the published census — two vaults at the same level get different amounts

**Construct.** Inside `if (!plan.skip && !DRY)`, unconditionally:
```js
st.days[day].plan = { activated: plan.activated,
  per: ..., census: plan.census, denominator: plan.denominator, available: String(available) }
```
`plan` was derived from `available`, the *current* cbBTC balance. SPEC promises both "one distribution per UTC day" **and** "every transfer recorded before the next begins, so a crash resumes instead of redoing".

Resume path: morning run pays vaults 1..K and dies. Afternoon run reads `available`, which is now smaller by the K transfers already sent. It computes `per_i = available_now · w_i / den` for the remaining vaults, and **overwrites `st.days[day].plan`** — including `census`, `denominator` and `available`.

Consequences, in order of severity:
1. Two Level I vaults settled on the same day receive different numbers. SPEC: *"same level always means the same number, and that is the whole product."* This is the one invariant the allocator exists to hold, and it is broken by the resume path rather than by the allocator.
2. The **published** census/denominator/available for that settlement is the afternoon's, so a holder who checks their share against the published figures gets a wrong answer if they were paid in the morning.
3. `alarm.mjs` reconciles the day against a `plan` that was rewritten after the fact — "distribution reconciles against a ledger the payer wrote" (known limit 11) is worse than stated, because the payer now rewrites the *decision* as well as the record.

**Evidence.** `node bank/distribute.mjs` on a funded devnet ledger, `kill -9` after ~5 transfers, re-run the same day, then:
```bash
jq '.days["<today>"].plan.available' distributions.json     # smaller than the morning's balance
jq '.days["<today>"].paid | to_entries | map(.value.amount)' distributions.json
# two vaults you know are both Level I will differ
```
If instead the day is skipped wholesale on the second run, then "a crash resumes" is false and SPEC over-claims — either way one of the two documented properties does not hold.

**Fix.** Write the plan **once**: `if (!st.days[day].plan) st.days[day].plan = {...}`, and on resume pay from `st.days[day].plan.per` rather than recomputing. Assert it: a fixture ledger with a partial `paid` map must produce identical `per` values on the second pass.

## R2-2 · HIGH · SPEC still publishes 6,404 sats of dust; `distribute.mjs` now calls that figure "overstated by about threefold"

**Construct.** `SPEC.md`, "The dust carries; it is never split":
> "at 2,100 vaults the remainder can be up to **6,404** sats a settlement."

`bank/distribute.mjs`, same round:
> "This comment used to say 'up to (denominator − 1) … up to 6,404' … it **overstated what a settlement retains by about threefold**. A disclosure figure has to be the one that is TRUE."

The two live documents now disagree about a customer-facing number, and the disagreement was created by the commit that fixed one of them. SPEC.md **was** edited this round (the `MAX_HOLD_DAYS` qualifier, the equality-floor note, the 286/427/79 counts), so this is one-of-N-sites inside the fix for a one-of-N-sites round. No gate can see it: the SPEC gates check three assertion counts and the control table's fourth column, nothing else.

**Second half, and it is the one that matters more.** `r.dust < activated.length` is a statement about the *allocator's* residual. It is **not** what the settlement retains. A vault that is skipped at pay time — SPEC: *"refuses to create a token account for a vault PDA … so it is skipped and reported"* — keeps its whole share in the pool, and that share is `drop·w/den`, not a fraction of a satoshi. So the retained amount is `dust + Σ(skipped shares)` and is unbounded by `N`. The corrected comment says "at most 2,099 sats, and that is the number to quote" — quoting it as *what a settlement retains* is a new wrong disclosure replacing an old loose one.

**Evidence.** `grep -n '6,404' SPEC.md`. And: run `allocateWeighted`, then simulate one skipped Level V vault and compare the ledger's actual retained balance against `r.dust`.

**Fix.** One derivation, one place. Compute the number in `distribute.mjs`, print it, and generate that SPEC sentence from it. State the retention as `dust + skipped shares` and report the skipped total explicitly in the settlement record.

## R2-3 · MEDIUM · The forced payout floor is 1 sat/vault while the normal floor is 21, so a forced settlement can cost more in fees than it distributes

`decideEmission({ smallestPer: 1n, daysSinceLastPayout: 31 }).forced === true` — pinned by a new assertion. At `smallestPer = 1`, `drop = den/2 ≈ 3,202` sats at the 2,100-vault census. That is ~$3 at $100k/BTC, distributed across up to 2,100 SPL transfers. At 5,000 lamports per signature that is 10.5M lamports ≈ 0.0105 SOL ≈ $2 of the distributor's SOL — assuming one transfer per transaction. The forced branch has no *pool-level* floor at all, only a per-vault one of 1.

I cannot see whether transfers are batched (`main()` wasn't delivered), so I am not claiming net loss; I am claiming the ceiling can fire on a pool where the economics are within 2× of the fees and nothing measures it.

**Evidence.** `grep -c 'sendAndConfirmTransaction' bank/distribute.mjs` and count instructions per transaction; then compute `drop` at `smallestPer = MIN_PER_VAULT − 1` against `activated.length × fee`.

**Fix.** Give `forced` a pool floor: force only when `drop ≥ K × activated.length × expected_fee_in_sats`. It is one comparison and it belongs next to `EMISSION_MIN_PER_VAULT`, which is itself still unratified (known limit 17).

## R2-4 · MEDIUM · `denominator` lost totality in the commit whose stated standard was "correct in isolation is the only property an exported helper has"

**Construct.**
```js
// before: (c[l] || 0)
return LEVELS.reduce((s, l) => s + (Object.hasOwn(c ?? {}, l) ? c[l] : 0) * LEVEL_WEIGHTS[l], 0)
```

`denominator({ I: undefined })` → `undefined * 2` → **NaN**, where the old code returned 0. An own property whose value is `undefined` is a normal outcome of `JSON.parse` on a hand-repaired ledger, of a spread from a partially-built census, and of `{ ...c, I: someOptional }`. A NaN denominator propagates: `drop * w / NaN` → NaN → `BigInt(NaN)` throws inside the money path.

`census()` never produces it — but the whole justification for touching `census`/`denominator` was that they are exported and must be right in isolation.

**Evidence.** `node -e "import('./bank/distribute.mjs').then(m=>console.log(m.denominator({I:undefined})))"` → `NaN`.

**Fix.** `(Object.hasOwn(c ?? {}, l) ? Number(c[l]) || 0 : 0)`. Assert `denominator({I: undefined}) === 0` and `denominator({I: 'x'}) === 0`.

The census *does* still serialise: `{ ...c }` on a null-prototype object produces an ordinary `Object.prototype` literal, so `JSON.stringify` and the reverse both work, and `Object.hasOwn` reads a parsed census correctly. No consumer needing a prototype is reachable from what I can see.

## R2-5 · MEDIUM · "A quiet day stays quiet; a REFUSAL pages" is false in the configuration the installer's own header recommends

Three separate reasons the new refusal path reaches nobody:

1. **`process.exitCode = 1` is decorative under cron.** The installed line is `... node bank/distribute.mjs$DIST_DRY >> $LOGDIR/distribute.log 2>&1`. cron mails on *output*, not on exit status, and all output is redirected. Worse, the command is wrapped in `flock -n`, so the shell's exit status is flock's. Nothing observes the 1.
2. **Under `--dry-run` there is no NOTIFY at all** (`if (!DRY) { execFileSync(NOTIFY, ...) }`) — and `--dry-run` is exactly what the header instructs the operator to add.
3. **Under `--dry-run` no ledger flag is written either**, so `detectDistribution`'s `distribution_refused` (the HIGH that reaches `alarm.mjs`) never fires. A dry-run day whose plan was *refused* is indistinguishable from a dry-run day that was fine.

So the two failure modes "one function apart" that the comment set out to harmonise are still asymmetric, in the opposite direction: the SOL-floor failure pages, and the refusal pages only when live.

**Evidence.** `node bank/distribute.mjs --dry-run` with one activated vault absent from `levels.json`; `echo $?` → 1; `jq '.days' distributions.json` → unchanged; no notify invocation in the log.

**Fix.** Send NOTIFY on refusal regardless of `--dry-run` (a refusal is a fact about the data, not about whether money moved), and write a `refusedDryRun` marker so the alarm can see it. Also check `NOTIFY`'s value: SPEC says the alarm alerts *"by EMAIL (never SMS)"*, and the deadman cron uses `/opt/scripts/notify-gary-sms.sh`. `grep -n 'NOTIFY *=' bank/distribute.mjs` — if it is the SMS script, a self-inflicted register gap now SMSes, contrary to SPEC.

## R2-6 · MEDIUM · The griefing premise behind the paging decision is wrong, and the correct fix removes the halt entirely

The refusal comment says: *"a HALT that **any stranger** can trigger by activating a vault we have no level for."* That premise is false, and the direction of the error matters.

**No stranger can obtain a vault.** `mint_vault` takes `bank: Signer` and `require_keys_eq!(ctx.accounts.bank.key(), cfg.bank)`. Every vault that exists was co-signed by the Bank. So the set of vaults is exactly the set the Bank agreed to, and an activated vault with no level is **our register being incomplete**, not an attack. The narrowest true statement is: *a member who bought a vault can activate it at 03:00, and the 09:07 run then refuses to pay **every other holder** until an operator edits `levels.json`.*

That reframing has a concrete consequence: **the level can be assigned at mint, where the Bank already signs**, which makes "an activated vault carrying no level" unreachable and deletes the halt, the paging surface and the griefing argument together. Today the register is written at *activation*, which nobody in our process is notified of.

**Evidence.** `grep -rn 'levels.json' bank/` — nothing writes it. Any activated-vault-without-level incident is therefore a manual-process failure by construction.

**Fix.** Assign and record the level in the same operation that produces the Bank's mint signature. Keep the refusal as a belt-and-braces halt, but it should then be a genuine "this cannot happen" rather than a scheduled outage waiting for a member to fund their vault.

---

# R3 — `scripts/bank-sign.sh`

## R3-1 · MEDIUM · The canonical round trip is sound, and `base64 -w0` makes the ONE sanctioned path unusable outside GNU coreutils — which pushes the operator to an unjudged tool

The check itself is correct and I could not defeat it. `printf '%s' "$TX" | base64 -d | base64 -w0` compared for equality proves the input **is** the canonical encoding of its own decoding, which is exactly the needed property. `printf '%s'` passes `$TX` as an argument so a `%` in it is inert. Command substitution strips trailing newlines on both sides, so `-w0`'s trailing-newline behaviour is irrelevant. Embedded whitespace, if it slips past the alphabet filter, survives decode-ignore and vanishes on re-encode → mismatch → refused. 1644 characters round-trip exactly. `set -euo pipefail` does not fire, because `|| true` is applied to the assignment and therefore rescues the pipeline's status under `pipefail`. All five listed lookalikes (`====`, `A===`, `AB==`, `AAB=`, `AAAA====`) are refused.

The defect is portability. `base64 -w` is a **GNU coreutils extension**. On macOS (BSD `base64`) and on BusyBox, `base64 -w0` errors out; `CANON` becomes empty; `"" != "$TX"`; the script refuses **every legitimate transaction**. It fails closed, which is the right direction — and the consequence is that the operator is now blocked on the only sanctioned path and will reach for `node -e "…partialSign…"`, which gets neither the program allowlist nor the fee-payer check (known limit 1a). A safety check whose failure mode is "the operator uses the unjudged path" is a net negative.

**Evidence.** On macOS: `printf 'AAAA' | base64 -w0` → `base64: invalid option -- w`. Then `./scripts/bank-sign.sh tx.b64` → "not CANONICAL base64" on a perfectly canonical file.

**Fix.** Detect it and say so, rather than conflating an environment failure with a malformed transaction:
```sh
if ! printf '' | base64 -w0 >/dev/null 2>&1; then
  echo "this script needs GNU coreutils base64 (-w0). Refusing to judge a transaction I cannot canonicalise." >&2; exit 3; fi
```
Then use `tr -d '\n'` on the re-encode so BSD works too. Distinguish exit 3 (cannot check) from exit 2 (checked and refused).

## R3-2 · LOW · The empty string passes the canonical arm

`TX=""` → length 0 (`0 % 4 == 0` passes), decode → empty, re-encode → empty, `"" == ""` → accepted. Whether this reaches `cosign.mjs` depends on an emptiness check I could not see. `grep -n 'if \[ -z "\$TX" \]' scripts/bank-sign.sh` — if absent, add it, and add the assertion.

## R3-3 · LOW · The corrected `ps` comment is *nearly* true and understates the exposure in one place

The comment now says the last line is `exec node bank/cosign.mjs --tx "$TX"`. The real line — per the selftest's own regex — is `exec … cosign.mjs --tx "$TX" ${LIVE[@]+"${LIVE[@]}"}`, so the quoted line is not the line. More substantively: argv also lands in `/proc/<pid>/cmdline` (readable by same-uid processes and by root) and in any `execve` auditing (auditd, eBPF, container runtime logs), where it *is* durably recorded — which is a different exposure from `ps`, and the "not in shell history" claim covers only the wrapper's own invocation, not the co-signer's. The conclusion ("minor, not a key leak") stands; the enumeration doesn't.

**Fix.** One sentence. Or teach `cosign.mjs` to read stdin — the comment declines this as "new surface immediately before a freeze", which is a defensible call, but it should then be in the accepted-limits list rather than only in a comment.

---

# R4 — `scripts/cron-install.sh`

## R4-1 · HIGH · Commenting out the distribute cron — the ordinary way to disable it — silently **re-arms the live cbBTC sender** on the next install. The file names this asymmetry and then implements the symmetric rule.

**Construct.**
```sh
ours() { grep -F "$TAG" <<<"$CUR" | grep -v '^[[:space:]]*#'; }
DIST_DRY=''
if ours | grep -q 'distribute\.mjs --dry-run'; then DIST_DRY=' --dry-run'; fi
...
grep -v "$TAG" <<<"$CUR" > "$TMP" || true
7 9 * * * ... bank/distribute.mjs$DIST_DRY ... $TAG distribute
```

The `--live` preserve was correctly narrowed to *uncommented* tagged lines: a commented-out line expresses the intent "off", and reading it as consent to arm the trusted hop was the round-19 defect. **The `--dry-run` preserve inherited that rule**, and for `--dry-run` the safe direction is exactly inverted. The diff's own comment says so:

> "Note the asymmetry that makes this the worse half — failing to preserve `--live` under-arms and is safe; failing to preserve `--dry-run` **ARMS**."

And then both branches call the same `ours`.

**The path.** Operator installs; distribute goes live at 09:07; operator gets nervous and disables it the ordinary way — comments the line out. Weeks later the runbook says re-run `cron-install.sh` (after a deploy, a log rotation, a box rebuild). `grep -v "$TAG"` **deletes the commented line** (it contains the tag), `ours` **skips it** (it is commented), `DIST_DRY=''`, and the installer writes a live cbBTC sender. The operator's explicit, recorded intent has been inverted and the record of it destroyed in the same command.

**The gate has three negative fixtures for revenue and zero for distribute:**
```
'a COMMENTED-OUT tagged revenue line does not arm --live'      → asserted
'a prose note mentioning the flag does not arm --live'          → asserted
"another project's line does not arm --live"                    → asserted
'our own tagged --dry-run distribute line IS preserved'         → asserted
<a COMMENTED-OUT tagged --dry-run distribute line>              → MISSING
```
The suite pins the safe half in three ways and does not test the unsafe half at all.

**Mitigation that exists:** the posture print at the end says "LIVE FROM THE NEXT 09:07". That is why this is HIGH and not CRITICAL — the arming is *reported*, on stdout, at the end of an installer nobody re-reads.

**Evidence.**
```bash
crontab -l > /tmp/bak
# install, then disable by commenting:
crontab -l | sed 's|^\(7 9 .*distribute\)|# \1|' | crontab -
./scripts/cron-install.sh
crontab -l | grep distribute            # no leading '#', no --dry-run  => ARMED
```

**Fix.** Put the asymmetry in the code, not the comment:
```sh
# a tagged distribute line that is COMMENTED OUT, or carries --dry-run, is consent to stay dry
if grep -F "$TAG distribute" <<<"$CUR" | grep -qE '(^[[:space:]]*#|--dry-run)'; then
  DIST_DRY=' --dry-run'; echo "NOTE: the existing distribute cron was disabled or dry; keeping --dry-run."
fi
```
Better still: make arming the live sender require an explicit `--arm-distribute` flag, so no re-run of the installer can ever arm money. Add the three missing negative fixtures (commented tagged line; commented tagged line with `--dry-run`; a tagged distribute line deleted entirely).

## R4-2 · Job-by-job enumeration of the header's claim

| installed line | can it move money as installed? |
|---|---|
| `23,53 * * * * … bank/alarm.mjs` | No. Read-only + notifications. |
| `7 9 * * * … bank/distribute.mjs$DIST_DRY` | **YES, from the next 09:07**, unless a preserved `--dry-run` survives — see R4-1 for when it doesn't. |
| `41 */6 * * * … bank/revenue.mjs$REV_LIVE` | Only with a preserved `--live`. Dormant on a fresh crontab. |
| `19 4 * * * … bank/alarm.mjs --reconcile` | No. |
| `9 */2 * * * { [ ! -f $ALARM_STATE ] \|\| … } && notify-gary-sms.sh` | No. |

The header's two-job statement is **complete** for the set of jobs. Two caveats:

## R4-3 · MEDIUM · The header's "revenue.mjs … installed WITHOUT it … **Safe**" is a behavioural claim about a file that no gate checks and that this round did not deliver

The selftest asserts only that `$REV_LIVE` is interpolated into the line. Nothing anywhere asserts that `revenue.mjs` without `--live` moves nothing — no sweep, no Jupiter call, no return transfer. This repository has shipped a comment asserting an absent control in nine of nineteen rounds; asserting the *absence* of an action is the same shape. `bank/revenue.mjs` was in neither the diff nor the bundle.

**Evidence / fix.** Run `node bank/revenue.mjs` on a funded devnet revenue PDA and diff the balance and the ledger. Then add the gate: `judgeMoneyGuard(revenueSrc)` asserting every send site is downstream of a `LIVE` check, in both directions, the same shape as `oneSign()` for `cosign.mjs`.

---

# R5 — THE GATES

## R5-1 · MEDIUM · `isTableRow` is a sound *row shape* but the wrong *scope*, and the block-scoping fix was applied to one of two arms

`isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)` requires `|` + **space**, which correctly excludes the markdown separator row and is why `controlTableBlock` can start at `h+2`. As a predicate it is fine.

The scope is not. Both `tableRows(specSrc)` and `tableLines(specSrc)` filter the **whole file**:

```js
const tableLines = src => src.split('\n').filter(isTableRow).join('\n')
const tableSrc = tableLines(specSrc)
t('every Bank-confinement refusal … is NAMED in the control table',
  bankErrs.filter(n => !tableSrc.includes(n)), [])
```

So "in the control table" still means "in any line anywhere in SPEC.md that happens to match the row shape". SPEC contains five other tables. None carries `**ON-CHAIN.**`/`**AUTOMATIC.**`/`**PROCEDURE.**` today, so this is latent rather than live — but the fix for exactly this (`controlTableBlock`) was **computed in the same block and not used here**. `block` is available three lines earlier.

Same for `rows.length >= 5`: a stray matching line elsewhere in SPEC inflates `rows`, so a genuinely deleted control row can be masked.

**Evidence.** Append to the end of SPEC.md a line `| **NOT A CONTROL** | x | y | **ON-CHAIN.** nothing |` and observe `rows.length` become 6 and the ON-CHAIN arm parse a row that is not in the table.

**Fix.** `const rowsOf = src => (controlTableBlock(src) ?? []).filter(isTableRow)` and use it for `tableRows`, `tableLines` and the count.

## R5-2 · The `MintVault` struct regex is sound, and the confinement's index is right

`/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/` truncates at the first line-initial `}`. Inside an Anchor account struct, only the closing brace is at column 0 — doc comments are `///`, attributes end `)]`, fields are indented. `/^\s*pub (\w+):/gm` cannot match inside a `///` line. I confirmed field order against the Rust and against `tests/3prog.test.ts`'s key arrays: `config, asset, collection, owner, bank, payer, revenue, instructions, seal_config, mint_authority, mpl_core, system_program` — `bank` at 4, `payer` at 5. The two truncation directions are pinned in the rejected-findings block and both are correct (before `bank` → `-1`, fails closed; after → index unchanged). No finding here.

## R5-3 · LOW · `codeOnly` is adequate for shell, and its comment overstates the residual risk

`!/^\s*#/` drops only lines whose first non-space char is `#`. What that misses in shell: `#` inside a heredoc body, `#` inside a multi-line quoted string, and the shebang. All three are harmless to an arm that counts `/^\s*exec .*cosign\.mjs.*$/gm`.

The comment claims the residue is "a TRAILING comment, or an `echo` documenting the command, able to reproduce it exactly." A trailing comment on the exec line would make the count **2** — red, fail-closed. An `echo` **cannot** reproduce it: the regex is anchored at line start on `exec`, so `echo "exec node bank/cosign.mjs …"` does not match. The comment overstates what the gate cannot see, which is the mirror of the defect class this repository tracks.

The genuinely uncovered case is a line beginning at column 0 with `exec … cosign.mjs` *inside* a heredoc or quoted block. That would inflate the count → red. Fail-closed.

## R5-4 · LOW · `errNames`'s enum-body regex fails open on a multi-line `#[msg]`

```js
const body = (src.match(/#\[error_code\]\s*pub enum \w+\s*\{([\s\S]*?)\n\}/) || [])[1] || ''
[...body.matchAll(/^\s*(?:#\[msg\("[^"]*"\)\]\s*)?(\w+),\s*$/gm)]
```
Verified correct on the delivered sources (16 / 33 / 21, counted by hand; MINT's new multi-line `//` comment block inside the enum matches nothing because no comment line is `\s*\w+,\s*$`). Two residual holes:

- A variant written as
  ```rust
  #[msg("a very long message that\
         wraps")]
  SomeError,
  ```
  or with the attribute on its own line above the variant across a blank line — the `\s*` handles the latter, but `[^"]*` cannot span a line containing `"`. A wrapped message with an inner quote drops the variant → **fail-open** in the arm built to close "a control with no row is invisible to a row-checker".
- A future comment line ending in `word,` is read as a variant name. Fail-closed if it starts with `BankKeyOutside`, harmless otherwise.

**Fix.** Strip `//` lines from `body` first, then match `^\s*(\w+),\s*$` after stripping *all* `#[...]` attributes with a multi-line-tolerant pass. Add a negative fixture with a wrapped `#[msg]`.

## R5-5 · LOW · Near-miss on the self-match rule, in the floor-drift arm

`t('...and a drifted copy is caught', num(/^const FLOOR = (\d+)$/m, 'const FLOOR = 999') === det, false)` puts the literal `const FLOOR = 999` inside `bank/selftest.mjs`, which is itself read by `num(/^const FLOOR = (\d+)$/m, readFileSync('bank/selftest.mjs'))` three lines above. It survives only because that occurrence is not at column 0. Reindent the assertion to column 0 — or wrap the line — and the floor gate reads 999 and goes red for the wrong reason. This is the "search that finds its own searcher" pattern FREEZE.md records six times.

**Fix.** Build the fixture from parts, as every other arm in that file does: `['const FLOOR', '= 999'].join(' ')`.

---

# R6 — COUNTS AND ARITHMETIC

## R6-1 · HIGH · SPEC carries at least four stale counts, and the gate written to stop exactly that covers three regexes

Verified against the files:

| lives in `run-tests.sh` / the suite | SPEC says | gated? |
|---|---|---|
| `MIN_ASSERTIONS=286` | "286 assertions, real cloned Core" ✓ | yes |
| `DET_FLOOR=427`, selftest `FLOOR = 427` | "(+ 427 detector" ✓ | yes |
| `ALLOC_FLOOR=79`, distribute `FLOOR = 79` | "79 allocation and 19 live-mainnet" ✓ | yes |
| `MAINNET_FLOOR=19` | ✓ | yes |
| **427** | *"Every detector is proven in BOTH directions by `bank/selftest.mjs` (**69** assertions)"* | **no** |
| **79** | *"`node bank/distribute.mjs --selftest` # **63** allocation assertions"* | **no** |
| **286** | *"The **270**-assertion suite runs against real mainnet Core"* (THE SHIP GATE table) | **no** |
| round 19 | *"**Thirteen** AI audit rounds"*, *"Thirteen rounds, thirteen with a real finding"*, *"v10 spec"*, *"Forty auditor-passes"* | **no** |

Plus a duplicated path: `` `audits/round6/VERDICT.md`, `audits/round6/VERDICT.md` through `audits/round10/VERDICT.md` ``.

SPEC's own note beside the gated block says: *"a stale count here is how a reader learns the floors are decorative too."* Three of six-plus sites are gated. That is the project's signature defect, in the document that defines the project's signature defect.

**Fix.** Gate every count by shape, not by name: extract each `(\d+) (assertion|allocation|detector)` in SPEC and require each to equal the corresponding floor; or generate SPEC's numeric spans from the code.

## R6-2 · Arithmetic, re-derived independently

- **240 census.** 108·2 + 60·3 + 36·4 + 24·5 + 12·6 = 216+180+144+120+72 = **732** ✓. Counts sum to 240 ✓ and match 45/25/15/10/5% ✓.
- **2,100 census.** 945·2 + 525·3 + 315·4 + 210·5 + 105·6 = 1890+1575+1260+1050+630 = **6,405** ✓. Counts sum to 2,100 ✓.
- **Five shares.** 1890/6405 = 29.51%, 1575 = 24.59%, 1260 = 19.67%, 1050 = 16.39%, 630 = 9.83%. Sum = **100.00%** ✓. Census-independent (the level proportions are identical at 240 and 2,100), which is worth a sentence on the card — a holder who checks one census against the other will find the same five percentages and should not read that as an error.
- **Per-$1,000, ten figures.** 240: 2.73224 / 4.09836 / 5.46448 / 6.83060 / 8.19672. 2,100: 0.31226 / 0.46838 / 0.62451 / 0.78064 / 0.93677. Both reconstitute $1,000.00 when weighted by the census ✓.
- **"A Level V vault receives exactly three times a Level One."** 6/2 = 3 ✓.
- **Dust.** 2,099, attained at `available = 6,404` ✓ (derivation at the top).

No arithmetic error found. The customer-facing error is R2-2, the 6,404 in SPEC.

## R6-3 · MEDIUM · The floors were changed from `-ge` to `-eq` in the same commit that removed an exact count elsewhere *because exact counts penalise telling the truth*

Same diff, two directions:

> `t('the control table has at least its five classified rows', rows.length >= 5)` — *"THIS WAS `rows.length === 5`, AND AN EXACT COUNT PENALISES TELLING THE TRUTH… a gate that fails when the documentation becomes MORE ACCURATE."*

> `[ "$n" -eq "$4" ] || die` in `floor()`, plus `MIN_ASSERTIONS`, plus `selftest FLOOR`, plus `distribute FLOOR` — four exact counts introduced.

Adding one good assertion now turns the build red until three files and SPEC are edited in the same commit — and under the FREEZE, any such commit **resets clean-round counters 2 and 3 to zero**. That is a standing incentive not to add assertions during a freeze, which is precisely when they are most needed.

Second, smaller: `floor()` extracts the **pass** count (`grep -oE '^[0-9]+'` on `PASSED/TOTAL`), so `-eq` now reports a *failing* assertion as `"assertions went missing"`. Wrong diagnosis on the most likely failure.

**Fix.** Keep `-ge` for the floor (its actual job: stopped early) and add a **separate** ratchet check that the floor is not more than N below the observed count, so slack cannot accumulate without failing the build. And extract the run count, not the pass count. Also: the `-ge` line in `floor()` is now dead code under the `-eq` line — delete one.

---

# R7 — WHAT THE SELF-AUDIT MISSED

## R7-1 · CRITICAL · There is no sanctioned path, no judge and no policy artifact for the Bank's signature on a `mint_vault` — and the repository's own gates now *forbid* building one

This is the finding I would most want checked.

**The facts, each individually gated by the suite:**

1. `mint_vault` takes `bank: Signer` pinned to `cfg.bank`. **Every one of the 2,100 activations requires a Bank signature.** SPEC even assigns the Bank two duties at mint ("refuse to co-sign a mint while a proposal's voting window is open"; "refuse a charter-priced mint not backed by a burned Proof of Burn").
2. `bank/selftest.mjs` asserts **exactly three signers exist**, and exactly one reads the Bank key: `bank/cosign.mjs -> BANK`.
3. `bank/cosign.mjs` judges with `judgeRedemptionTx`, which requires an `open_for_redemption` **and** a matching `burn_vault`, and refuses any instruction to a program outside `[CORE, TOKEN, TOKEN22, ATA, SYSTEM]`. **MINT's program id is not on that allowlist**, and a mint-only transaction has no open and no burn. Three independent reasons it refuses.
4. SPEC: *"There is no other command, and producing a Bank signature any other way is out of policy."*

Put together: **the mint flow — the flow the entire business runs on — has no signing path, and the gates make adding one a build failure.** A fourth signer, or `cosign.mjs` learning to read a mint, turns `t('exactly THREE signers exist…')` and `t('cosign.mjs has ONE partialSign…')` red. So the mint co-signer will be written either (a) outside this repository entirely, where none of the five sanctioned-path gates reach it, or (b) by editing the gates, which is the moment nobody is watching.

**And the on-chain confinement cannot cover what that tool will be signing.** MINT's comment says: *"The FEE PAYER is still invisible here … and stays a policy matter; see SPEC's control table."* The control table's only policy row is `bank/cosign.mjs`, which is a **redemption** tool. The pointer points at nothing.

**The fee-payer gap is unbounded, not "one transaction fee".** `ComputeBudget` instructions carry **zero accounts**, so no instruction-account walk can see them, and there is no allowlist on a mint. A customer-composed mint:

```
[ ComputeBudget.SetComputeUnitLimit(1_400_000),
  ComputeBudget.SetComputeUnitPrice(<huge>),
  mint_vault(bank=BANK@4, payer=attacker@5, owner=attacker) ]     fee payer = BANK
```

passes the on-chain confinement in full — the Bank is at index 4, which is the one legal slot — and the priority fee is `CU_limit × price / 10^6` lamports, drawn from the fee payer. That is the Bank's whole SOL balance in one signed transaction. The Bank must be writable to be the fee payer; `bank: Signer<'info>` carries no `#[account(mut)]`, and Anchor's `Signer` does not assert non-writability, so this serialises.

Whether the customer composes the mint transaction is the crux, and it is **undecided in the repository** — there is no mint client, no mint judge, and no statement either way. For redemptions SPEC says plainly *"the customer composes the transaction"*; if mints work the same way (the natural design, since the buyer must sign as `owner` and pay as `payer`), the drain is live the day minting opens.

**Evidence if I'm right.**
```bash
grep -rn 'mint_vault' bank/ scripts/                     # no signer, no judge
node bank/cosign.mjs --tx <base64 of a mint_vault tx>    # refused: no open/burn, program not allowlisted
# and on a validator, with the Bank funded:
#   build the three-instruction message above, fee payer = BANK, sign with bank+attacker+asset
#   -> lands; BANK's lamports fall by the priority fee
```
The last one is a suite assertion this project does not have: **there is no test anywhere that puts the Bank's key on a mint transaction it did not compose.** Test 9d.4 covers the Bank as `payer` (an *account*); nothing covers the Bank as *fee payer*, because the harness sets the fee payer implicitly.

**Fix, in order.**
1. Extend `bank/cosign.mjs` into `judgeMintTx`: exactly one `mint_vault` to MINT, `bank` at index `MINT_IX_BANK_IDX`, the Bank not the fee payer, **no `ComputeBudget` instruction unless its price is bounded**, and the two SPEC duties (open-proposal check, Proof-of-Burn check) enforced against a live read. Prove both directions.
2. Amend the signer-set gate so the mint judge is an *expected* Bank reader rather than a build failure — deliberately, in the same commit, with the reason written down.
3. Add a control-table row for it, which the ON-CHAIN/AUTOMATIC/PROCEDURE gate will then check.
4. Cap the Bank's SOL float on the box to the day's expected fees, so the unbounded case is bounded by custody even if the judge is bypassed. That is the only control that survives "signed with another tool".
5. Add the negative suite assertion: a mint transaction whose **fee payer** is the Bank must be refused by the tool (it cannot be refused on-chain, and the code comment should say that instead of pointing at a table row that does not exist).

## R7-2 · MEDIUM · MINT's exemption was narrowed to positional identity; SEAL's was not. One-of-N inside the fix for the one-of-N round.

`mint_vault` now enforces `a.pubkey != bank || n == MINT_IX_BANK_IDX`. `open_for_redemption`, written by the same hand, still exempts the open/burn pair **entirely**:

```rust
if !is_open && !is_burn {
    require!(!ix.accounts.iter().any(|a| a.pubkey == bank), VaultError::BankKeyOutsidePair);
}
```

So inside the pair the Bank may still occupy any slot — known limit 3 — but the *reason the fix was applied to MINT and not SEAL* is nowhere, and the round-17 advice ("narrow it to positional identity") was cited in MINT's comment as advice "accepted and not acted on, and this is what it cost" while the identical advice for SEAL remains unacted-on in the same commit.

**Honest bound on impact.** I looked for a value-extracting instantiation and did not find one: `open_for_redemption`'s `payer` funds a `UpdatePluginV1` that toggles a bool with no size change (≈0 lamports); `burn_vault`'s `payer` *receives* the asset's rent; `owner` at index 2 must genuinely own the asset; `collection`, `config`, `seal`, `asset_signer` are all pinned. So today the exposure is ≈0 — **and it is ≈0 because of Metaplex Core's current rent behaviour, which is the fifth program we do not control** (SPEC: "METAPLEX CORE IS THE FIFTH PROGRAM AND WE DO NOT CONTROL IT"). A Core release that charges the payer for a plugin update makes the Bank fund it, silently.

**Fix.** Four lines and two constants: `SEAL_IX_BANK_IDX = 3`, `BURN_IX_BANK_IDX = 3`, and inside the exempt branch require the Bank at that index only. Pin both constants the same way `MINT_IX_BANK_IDX` now is — by parsing the struct. The gate already exists; it just needs two more calls.

## R7-3 · MEDIUM · `paymentState`'s callers: the sweep found the reader it was looking for and not the one that matters

The claim is that `settledAsPayout` is the only site asking the cadence question. From what was delivered, that holds for the *cadence*. What the sweep did not ask is whether any caller conflates **"settled"** with **"already sent, do not send again"** — which is the property `paymentState` was deliberately left alone to preserve.

`main()` must, on a same-day resume, decide per vault whether to send. If it uses `paymentState(row) !== 'unpaid'`, then a row marked `rejected: true` with **no** `resolvedBy` reads as… I cannot tell from the bundle (the suite pins `'resolved'` only when `resolvedBy` is present; `{rejected:true}` alone is presumably `'rejected'`). If `'rejected'` is treated as settled, a transfer the cluster **refused** is never retried and the holder is silently unpaid until a human resolves it — which is retryable by definition, and `detectDistribution` raises `distribution_refused` for exactly that reason. If it is treated as unpaid, it is retried — correct, but then it interacts with R2-1's plan rewrite.

**Evidence.** `grep -n 'paymentState' bank/distribute.mjs` and read every call site; assert, in the suite, `settledAsPayout` vs `shouldSend` vs `paymentState` on all five states in a 3×5 table. Today only `settledAsPayout` has that table.

## R7-4 · Under-claims: places the system is stronger than its documentation (third target)

**(a) SPEC's control-table row 2 understates MINT's confinement.** It reads:

> "`programs/cbob-vault-mint/src/lib.rs` refuses `BankKeyOutsideMint` **outside a `mint_vault`**."

Since round 18 it also refuses the Bank *inside* a `mint_vault` anywhere but the `bank` slot — which is the fix for a CRITICAL and the strongest thing the row could say. The Rust error message was corrected in this very diff for exactly this reason 