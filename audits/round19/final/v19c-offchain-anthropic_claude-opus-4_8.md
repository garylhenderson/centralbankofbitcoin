I'll audit these in order, focusing on what evidence would exist if each finding is real. I've read the diff and the bundled files.

# R1 — THE SELF-AUDIT'S OWN REPAIRS

## R1-CRITICAL-1: `supersede` clears `resolvedBy`, which destroys the "a resolved refusal is never re-raised" guarantee across days

**The construct.** `DONE_MARKS = ['finishedAt', 'nothingToDo', 'resolvedBy']`, and `supersede` does `for (const mark of DONE_MARKS) delete out[mark]`.

The self-audit's own reasoning for adding `resolvedBy` to the cleared set is: "with `resolvedBy` present the superseded-then-crashed day is silent." So it now deletes `resolvedBy` from the record whenever a plan proceeds on a day that previously carried `refused` or `nothingToDo`.

**Why this is wrong.** `resolvedBy` is not only a suppressor of `distribution_unfinished`. It is the field a human writes to close *any* nagging finding, and `detectDistribution` reads it in **five** distinct places:

```js
const unresolved = rows.filter(([, r]) => !r.sig && !r.skipped && !r.rejected && !r.resolvedBy)
const refused    = rows.filter(([, r]) => r.rejected && !r.resolvedBy)
if (rec.unreadableAtas?.length && !rec.resolvedBy) ...
if (rec.refused && !rec.resolvedBy) ...
if (rec.startedAt && !rec.finishedAt && !rec.nothingToDo && !rec.resolvedBy && day !== opts.today) ...
```

Note the third and fourth cases: `distribution_vault_unreadable` and the *day-level* `refused` finding are suppressed by `rec.resolvedBy` (the day-level field, not a row field).

**The scenario.** Consider a day that:
1. Morning: refuses (unlevelled vault). Writes `refused` + `nothingToDo` + `finishedAt`. Also, an operator sees a `distribution_vault_unreadable` finding from the same day's `unreadableAtas` and writes `resolvedBy: 'gary: dust ATA, ignored'` at the day level to silence it.
2. Afternoon: operator adds the missing level and reruns. Plan proceeds. `supersede` runs and **deletes `resolvedBy`**.

Now the day's `unreadableAtas` is still present (supersede does not touch it), but the `resolvedBy` that closed it is gone. On the next detector pass, `distribution_vault_unreadable` **re-fires at HIGH** for a condition a human already adjudicated. The operator's resolution has been silently erased by a function whose comment insists it only removes "no-pay flags."

**Evidence that would exist if I'm right.** Construct a record:
```js
supersede({ startedAt:'x', finishedAt:'y', nothingToDo:'q', refused:'r',
            resolvedBy:'gary: dust ATA ignored',
            unreadableAtas:[{vault:'v', state:'malformed'}] }, 'now')
```
The returned `rec` will have `resolvedBy` absent. Then `detectDistribution({days:{'2026-08-20': thatRec}}, {today:'2026-08-21'})` will contain a `distribution_vault_unreadable` finding that was silent before the supersede. **None of the round-19 selftest arms test this**: every `supersede` test uses records with no `unreadableAtas` and no day-level `resolvedBy` combined with `unreadableAtas`. The suite proves `supersede` clears the three marks; it never checks what *else* reads `resolvedBy`.

**Why the enumeration-from-the-detector arm does not catch it.** The arm parses only the `distribution_unfinished` guard:
```js
const guard = (detSrc.match(/if \(rec\.startedAt &&([\s\S]*?)&& day !== opts\.today\)/) || [])[1] || ''
const needed = [...guard.matchAll(/!rec\.(\w+)/g)].map(m => m[1]).sort()
```
This extracts `finishedAt, nothingToDo, resolvedBy` from *one* arm. It then asserts `supersede` clears exactly those. But `resolvedBy` appearing in that one guard is a **coincidence** — its presence there does not mean it is safe to delete, because it appears in *four other* readers with different meanings. The gate proved "supersede clears the unfinished-suppressors," and from that the builder concluded "supersede is correct." That inference is invalid: clearing a field that also carries an operator's manual resolution of an *unrelated* finding is a regression the gate was structurally unable to see, because the gate only looked at one of five readers.

**Severity: HIGH.** It re-raises a resolved finding (paging noise / lost operator intent), not a money-loss. But it is exactly the shape the round claims to have eliminated — "one fact, one reader" applied to a field with five readers — and the fix (adding `resolvedBy` to `DONE_MARKS`) was applied without checking the other four sites. This is R7's "one-of-N-sites inside a one-of-N fix" recurring.

**The fix.** Do not clear `resolvedBy` blindly. The unfinished-alarm needs it cleared only because a *stale* resolution should not vouch for a *new* crash. But the day-level `resolvedBy` that closes `distribution_vault_unreadable` or the day-level `refused` is a different concern. Either (a) give the unfinished-alarm its own dedicated suppressor field distinct from `resolvedBy`, so supersede clears that and leaves `resolvedBy`; or (b) have supersede preserve `resolvedBy` when `unreadableAtas` is present and unresolved otherwise. The clean answer is (a): stop overloading one field across five readers, which is the very defect the project keeps naming.

---

## R1-MEDIUM-2: the manifest's `dirty` array can still be malformed — the "stopped trimming porcelain" fix addresses the wrong axis

**The construct.** In `audit19.ts`:
```js
const dirty=execSync('cd '+R+' && git status --porcelain -- '+WATCHED).toString()
...
dirty:dirty.split('\n').filter(Boolean),
```

The self-audit's claim (R1 bullet 4) is that the manifest record is now well-formed because it stopped trimming. Check the actual record it writes.

`git status --porcelain` on a filename containing a space or special character **quotes and C-escapes the path** (e.g. `"bank/a b.mjs"`), and with a rename produces `R  old -> new`. More importantly: the `WATCHED` list is built from `TARGETS`, which includes `SPEC.md`. `SPEC.md` is at repo root, not under `programs bank scripts tests`. The porcelain output is fine there.

The real issue is narrower and correct: `dirty.split('\n').filter(Boolean)` is well-formed as JSON. So **the R1-bullet-4 claim holds** — the record *is* well-formed JSON. I cannot manufacture a malformation here. **This is not a finding; I'm recording that I checked it and it stands.** (Stating this because the prompt asks me to say what evidence would exist — here the evidence would be a non-array or invalid JSON in the manifest, and there is none.)

---

## R1-LOW-3: the escaped-interpolation gate only inspects `audit19.ts`, not what was actually sent

**The construct.** The selftest arm reads `scripts/audit19.ts` and checks that every `\${` line is the deliberate R1 example. But the *rendered* `PROMPT` is what the auditor sees, and it is constructed at module scope with template literals. The gate reads the **source** and asserts about escapes in source — it does not render `PROMPT` and grep the output.

The R1 prompt bullet explicitly says: "Render it, do not read it." The gate does the opposite of what the bullet demands. A future escaping bug that manifests only after interpolation (e.g. a `${...}` inside a value that itself contains a backslash) would be invisible to a source-reading gate.

**Evidence if I'm right.** Add a second `\${SOMETHING}` in a line not matching `/HAD SHIPPED AS LITERAL TEXT/` and the gate fires — good. But add a template value that renders to a literal `${FLOORS.x}` through nested interpolation, and the source has no `\${`, so the gate passes while the rendered prompt ships a placeholder. The gate cannot catch the exact defect it was written for (a literal placeholder in the *output*) unless it renders.

**Severity: LOW.** The specific round-18 defect is caught; the *class* is not. The fix is one line: `const rendered = PROMPT; t('no literal ${ survives rendering', /\$\{[A-Za-z]/.test(rendered.replace(<the deliberate example line>,'')), false)`. Note `audit19.ts` cannot easily import its own `PROMPT` because building it has side effects (the `throw` pre-flights), so this needs care — which is itself evidence the gate took the easy path.

---

# R2 — ROUND-18 OFF-CHAIN REPAIRS (distribute.mjs)

## R2-OK: the `settledAsPayout` direction is correct

The prompt demands I verify the direction. Traced:

- Larger `holdDays` → `daysSinceLastPayout` larger → `decideEmission`'s ceiling branch `daysSinceLastPayout >= maxHoldDays` fires **sooner** (at a lower true elapsed time relative to the last *real* payout).
- A bare `resolvedBy` does **not** reset (returns `holdDays=52`), an explicit `resolvedAs:'paid'` resets (returns `2`).
- With `52`, `decideEmission({smallestPer:1n, daysSinceLastPayout:52}).pay === true` (forced at ceiling). With `2`, `.pay === false`.

So not resetting → pays sooner. **The default is correct.** The builder had it right; the three-auditor pin is sound. No finding.

## R2-HIGH-4: `settledAsPayout` and `paymentState` disagree about `resolvedAs`, and the disagreement is a latent double-pay footgun

**The construct.** `paymentState` returns `'resolved'` for *any* row with `resolvedBy`, regardless of `resolvedAs`. The payment loop skips `state === 'resolved'`. Good — a resolved row is never re-sent.

`settledAsPayout` returns `true` only for `resolvedBy` + `resolvedAs:'paid'`. It returns `false` for `resolvedBy` + `resolvedAs:'unpaid'` and for bare `resolvedBy`.

Now consider the cadence anchor. `holdDays` uses `settledAsPayout` to find the last paying day. A row `{sig:null, resolvedBy:'gary: nothing landed', resolvedAs:'unpaid'}` is `paymentState==='resolved'` (settled, never resent — correct) **and** `settledAsPayout===false` (not a payout — correct). These are consistent.

But here is the gap the prompt asks about ("Is that still true for every caller now that a second function reads the same rows?"): the payment loop and `holdDays` agree on the *set* of rows, but `settledAsPayout` introduces a **new field the operator must set correctly** (`resolvedAs`) whose absence silently means "not paid." If an operator resolves an ambiguous transfer by hand-paying it but forgets `resolvedAs:'paid'` (writes only `resolvedBy:'gary: paid it'`), then:
- The row is never re-sent (good, `paymentState==='resolved'`).
- But `holdDays` treats that day as **not a payout**, so the clock keeps running from an older real payout, and the ceiling can force a *full distribution* sooner than warranted — paying everyone again including the vault that was already hand-paid via the `paid` map's other rows.

The builder's own defense ("guess in the direction that pays people") is fine for the *cadence*. But the interaction with the money loop is: a forced ceiling distribution recomputes `outstanding = plan.activated.filter(v => paymentState(row)==='unpaid')`. A hand-paid-but-unannotated row is `'resolved'`, so `outstanding` excludes it — it is not re-sent. **So no double-pay of that vault.** Good.

Re-checking: the double-pay path is closed because the money loop keys on `paymentState`, not `settledAsPayout`. **So this is not a double-pay.** It is a *cadence over-eagerness*: a forgotten `resolvedAs:'paid'` causes an earlier-than-intended forced settlement of the *pool*, which is the safe direction the builder chose. 

**Downgrade to LOW.** The real residue: `resolvedAs` is a new, silent, operator-remembered field, and nothing warns when a `resolvedBy` row lacks `resolvedAs`. An operator who hand-pays and annotates `resolvedBy` only will see the clock not reset, with no message explaining why. That is an operability trap, not a money bug. Fix: when a row has `resolvedBy` but no `resolvedAs`, log a one-line note in the distribution output that the clock was not reset because the result was unstated.

## R2-MEDIUM-5: `census` returns `{...c}` (a normal prototype) but `denominator` guards with `Object.hasOwn(c ?? {}, l)` — the null-proto defense is discarded before it reaches its reader

**The construct.**
```js
export function census(levels) {
  const c = Object.create(null); ...
  return { ...c }   // spread into a NORMAL object
}
export function denominator(c) {
  return LEVELS.reduce((s, l) => s + (Object.hasOwn(c ?? {}, l) ? c[l] : 0) * LEVEL_WEIGHTS[l], 0)
}
```

`census` builds a null-prototype object and then **spreads it into a normal-prototype object** (`{...c}`). So the value that leaves `census` has `Object.prototype` back on its chain. The self-audit comment claims null-proto protects against `census({a:'constructor'})` concatenating onto a function — but that protection is *internal to census* (the `Object.hasOwn(c, v)` loop guard is what protects it, not the prototype). The returned object is normal-prototype.

Now the prompt's question: "Does the census still serialise into the ledger and back? Is there a consumer that needed a normal prototype?" — The `{...c}` spread was presumably added *because* a null-proto object breaks `JSON.stringify`? No: `JSON.stringify(Object.create(null))` works fine and produces `{}`. And `console.log` of a null-proto object prints `[Object: null prototype] { I: 0, ... }`, which is ugly in the census line `LEVELS.map(l => ...plan.census[l]...)` but reads fine by key.

So `{...c}` is defensive theater that **removes** the one property (null prototype) the comment claims to value, and adds nothing. Worse: `denominator` reads `c[l]` after an `Object.hasOwn` guard, but since the census now has a normal prototype, a census object that was hand-constructed or came back from a ledger round-trip as a normal object with a level named `constructor` would... still be guarded by `Object.hasOwn`. So `denominator` is safe.

**Where it actually bites:** the census line in `main()`:
```js
console.log(`  census ${LEVELS.map(l => `${l}:${plan.census[l] || 0}`).join(' ')}...`)
```
This reads only `LEVELS`, so it's fine. And the ledger stores `st.days[day].census = plan.census`, JSON round-trips fine.

**Downgrade to LOW.** The finding is real but harmless: `{...c}` defeats the stated null-proto rationale and is a comment that misdescribes its own code (the null prototype does *not* survive to any consumer). Since `denominator` uses `Object.hasOwn` regardless, nothing breaks. But the comment is false about the mechanism protecting the export, which is exactly the class of defect this project claims to hunt. Fix: either return the null-proto object (`return c`) and keep the guards, or drop the null-proto pretense and document that `Object.hasOwn` is the whole defense.

## R2-OK: dust bound `dust < activated.length`

Re-derived. For each activated vault, `per[v] = floor(available * w_v / den)`. Total = Σ floor(...). Each floor loses a fraction < 1 sat. There are `activated.length` terms, each losing < 1. So `dust = available - total < activated.length` **when total ≤ available**, which holds because Σ floor(x_i) ≤ Σ x_i = available·Σw_v/den = available (since den = Σw_v over activated). 

But wait — `available * w_v / den` summed over activated = available * (Σ w_v)/den = available * den/den = available exactly (rational). Sum of floors ≤ that, and strictly, the shortfall per term is in [0,1), summing to < activated.length. **The bound holds.** 

The edge the prompt raises: "when available is smaller than the vault count, and when some vaults are skipped." If `available < den`, some `per[v]` are 0, but `smallest < min` triggers a skip (`skip: only ${available} for a denominator of ${den}`), so no distribution happens and dust is not published. The bound is on the *paid* case only, and the selftest's census sweep (`avail` down to `1n, 7n`) confirms `r.dust < r.activated.length` — but for tiny `avail` the allocation *skips*, so `r.dust` would be `0n` (the `empty` object's dust). Checking the selftest: it asserts `if (r.dust >= BigInt(r.activated.length)) return 'BOUND BROKEN'` — and a skipped allocation returns `dust: 0n`, `activated: [945+...]`, so `0 >= 2100` is false, passes trivially. So the sweep doesn't actually stress the bound at tiny `avail` (it just returns the empty allocation). **No finding — the bound is true — but the selftest's tiny-avail cases prove nothing** because they hit the skip path. Minor test-quality note, not a defect in the code.

---

# R3 — bank-sign.sh base64 round trip

## R3-MEDIUM-6: the round-trip check depends on `base64 -w0`, and a busybox/BSD `base64` that ignores `-w0` produces a *wrapped* CANON that never equals the stripped TX — rejecting legitimate transactions on non-GNU hosts

**The construct.**
```sh
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
if [ "$CANON" != "$TX" ]; then ... exit 2; fi
```

The selftest arm proves that a *missing* `base64` fails closed (CANON empty → refuse). Good. But it does not test a `base64` that **exists but does not understand `-w0`**. BusyBox `base64` and BSD/macOS `base64` do not accept `-w0`:
- BusyBox `base64 -w0`: errors, `2>/dev/null` swallows it, CANON empty → refuses everything. Fails closed. Fine.
- BSD `base64` (macOS): `-w` is not a flag; `base64 -w0` errors → CANON empty → refuse. Fails closed. Fine.

Actually both fail closed because the second `base64` errors. So a real 1644-char transaction is *refused* on any non-GNU host. The selftest arm's own comment admits this: "a host without GNU base64 refuses every transaction... fails CLOSED, not open." 

**But the header and SPEC advertise `scripts/bank-sign.sh tx.b64 --live` as THE ONE SANCTIONED PATH.** On a non-GNU host, the one sanctioned path refuses *every* redemption, and the failure message is "not CANONICAL base64" — which tells the operator their transaction is malformed when it is not. This is a correctness-of-diagnosis defect: the operator will re-paste, re-export, and burn time chasing a phantom encoding problem, when the actual problem is the host's coreutils. Given that "a human can sign by hand" is explicitly rhetorical (accepted limit #2), a host that refuses everything with a misleading message is a real operational hazard for a redemption — the one thing this whole system exists to permit.

**Evidence.** Run `bank-sign.sh` with a legitimate 512-byte-payload base64 on a host whose `base64` is BusyBox. Expected: `exit 2`, "not CANONICAL base64". That is a false refusal of a valid transaction with a wrong reason.

**Severity: MEDIUM** (availability of the exit path, misleading message), not HIGH because it fails closed (no wrong signature). **Fix:** detect GNU base64 at the top (`base64 --version 2>/dev/null | grep -q GNU`) and if absent, either use `base64 | tr -d '\n'` (portable wrap-stripping) or emit an explicit "this host lacks GNU base64; sign on a Linux host" message rather than "not CANONICAL."

## R3-OK: the corrected `ps` comment

The comment now says the transaction IS in `ps` via `exec node bank/cosign.mjs --tx "$TX"`. Verified: the last line is `exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ${LIVE[@]+"${LIVE[@]}"}`. The corrected comment is **true**. No finding.

## R3-LOW-7: `set -euo pipefail` + `|| true` on the CANON pipeline masks a *decode* failure as a *canonicalization* mismatch

The pipeline `base64 -d | base64 -w0` under `pipefail` with `|| true`: if `base64 -d` fails (genuinely invalid base64 that slipped past the alphabet/padding checks — e.g. a length-valid, alphabet-valid, but structurally impossible string), the pipe still runs the second stage on empty input, CANON becomes empty, and the message is "not CANONICAL" — accurate enough. Not a defect. Noting I checked it. No finding.

---

# R4 — cron-install.sh money claim

## R4-OK with one gap: the header is true, but the *preservation* introduces a new arming path the header does not mention

**Enumerating every installed job:**
1. `watcher` (alarm.mjs) — reads only, no money.
2. `distribute` (distribute.mjs`$DIST_DRY`) — **moves money as installed** unless `$DIST_DRY` is `' --dry-run'`. On a fresh crontab `$DIST_DRY=''` → LIVE. Header says so. ✓
3. `revenue` (revenue.mjs`$REV_LIVE`) — moves money only if `$REV_LIVE=' --live'`. Fresh → dormant. Header says so. ✓
4. `reconcile` — reads only.
5. `deadman` — notify only.

The header is **complete and true for a fresh install.** ✓

**The gap the header omits.** `ours()` preserves `--live` on revenue and `--dry-run` on distribute *from existing tagged uncommented lines*. So on a re-run, the money posture depends on the *prior* crontab. The header's fresh-install statement is correct, and the printed "MONEY POSTURE AS INSTALLED" computes from the actual written lines. **This is well-handled.** No finding on the money claim itself.

## R4-MEDIUM-8: `ours()` uses `grep -F "$TAG"` then `grep -v '^[[:space:]]*#'` — a tagged line that is *indented* and commented with leading whitespace is correctly excluded, BUT a line commented mid-way (`  23 * * * cmd # disabled #cbob-vault-cron revenue`) is NOT excluded and can still arm

**The construct.**
```sh
ours() { grep -F "$TAG" <<<"$CUR" | grep -v '^[[:space:]]*#'; }
```

This excludes lines whose *first non-space char* is `#`. But cron does not require `#` at column zero to comment — actually cron **does** require the comment to be a full-line comment (crontab treats a line starting with `#`, ignoring leading whitespace, as a comment). A line like:
```
41 */6 * * * cd /x && node bank/revenue.mjs --live  # temporarily off  #cbob-vault-cron revenue
```
is **not** a comment to cron — it is a live cron entry with a trailing `# temporarily off` that the shell inside the entry may or may not treat as a comment. `ours()` does not exclude it (first non-space is `4`), so `REV_LIVE=' --live'` is set, and the entry is preserved and re-installed as live.

Is that wrong? The operator *intended* it live (it's a live cron line to cron). So preserving `--live` is arguably correct. The dangerous case the selftest tests is the *fully* commented-out line (`# 41 ...`), which `ours()` correctly drops. 

**Where it actually bites:** the selftest arm proves the fully-commented and prose-note cases don't arm. It does **not** test a tagged line that is *partially* structured such that `grep -F "$TAG"` matches but the intent is ambiguous. This is thin, but the real residue is: `ours()` reads `--live`/`--dry-run` as a *substring* via `grep -q 'revenue\.mjs --live'`. A line `node bank/revenue.mjs --liveness-check` would match `revenue\.mjs --live` (no word boundary / no end anchor). The regex `'revenue\.mjs --live'` matches `revenue.mjs --live` as a prefix of `--liveness`.

**Evidence.** `resolve('41 */6 * * * cd /opt/cbob-vaults && node bank/revenue.mjs --liveness ... #cbob-vault-cron revenue')` would set `REV_LIVE=' --live'` because `grep -q 'revenue\.mjs --live'` matches the prefix of `--liveness`. There is no such flag today, so this is a latent trap, not a live exploit.

**Severity: LOW.** No current flag collides. But the substring match with no boundary is fragile: any future flag beginning `--live...` on revenue or `--dry-run...` on distribute would be mis-parsed. Fix: anchor with a boundary — `grep -qE 'revenue\.mjs --live($| )'`.

---

# R5 — the gates in selftest.mjs

## R5-HIGH-9: `isTableRow` requires the classification token immediately after `| **`, but the control-table block check (`controlTableBlock`) requires *every* `|`-line to be a row — a legitimately wrapped table cell or a separator variant fails the block check, turning true documentation red

**The construct.**
```js
const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)
...
t('EVERY row in the control table block carries a classification', block.filter(l => !isTableRow(l)), [])
```
where `controlTableBlock` collects every line under the header row+separator that `startsWith('|')`.

Now look at the actual SPEC control table. The header separator line is:
```
|---|---|---|---|
```
`controlTableBlock` starts at `h + 2` (skipping header and separator), so the separator is excluded. Good. But each *data* row in the real table is a single physical line (markdown tables are one-line-per-row). So today every collected line matches `isTableRow`. Fine.

**The fragility.** `isTableRow`'s regex is `^\| .*\| \*\*(...)\.\*\*`. It requires the classification to be the content of *some* cell that begins with `**ON-CHAIN.**` etc. But it anchors on `\| \*\*` — a pipe, a space, then `**`. If a future editor writes the classification cell without the leading space after the pipe (`|**ON-CHAIN.**` — which the selftest's *own* injected "bad" row does: `'|**NEW CONTROL**|...'`), it will not match. That is intentional for catching malformed rows. But it also means a **correctly-intended** row formatted as `| **ON-CHAIN.** ...` with the classification in the *first* cell rather than the last would... actually match, because `.*` is greedy across cells. 

The genuine problem: the `controlTableBlock` gate demands every `|`-line be a classified row. But markdown permits a table to be immediately followed by another `|`-prefixed construct (a second table, or a continuation). The loop `for (i=h+2; lines[i].startsWith('|'); i++)` will vacuum up *any* adjacent pipe-line. If someone adds a second, unrelated table right after the control table with no blank line, its rows get pulled into `block` and fail `isTableRow`, turning the build red for a change that is correct. Conversely, a blank line ends the block — so a control row separated by a blank line from the header (a stylistic table) would be silently dropped from `block` and go unchecked.

**Evidence if I'm right.** Insert a blank line in the middle of the control table: `controlTableBlock` stops at the blank, and rows after it are never checked by the "EVERY row carries a classification" gate — a genuinely malformed row *after* the blank would pass. This is the same "a row this parser cannot see is not a row that passes — it is a row that is never checked" failure the arm was written to fix, reintroduced via block-termination-on-blank-line.

**Severity: MEDIUM.** It requires an editor to insert a blank line inside the table, which markdown would then render as two tables — visible on inspection. But the gate's *claim* is "EVERY row in the control table block carries a classification," and that claim is only true for the contiguous block; a split table defeats it silently. Fix: define the block by the header and the trailing blank line explicitly, and assert the block is contiguous (no blank line until the table ends), or scan all `|`-lines between the header and the next blank-then-nonpipe boundary and require the count matches a computed expectation.

## R5-MEDIUM-10: the MintVault struct regex `[\s\S]*?\n\}` is non-greedy to the first newline-brace — a doc comment or attribute containing `\n}` inside the struct truncates it, and the refutation arm only tests injected braces, not real Anchor constructs

**The construct.**
```js
const body = (src.match(/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/) || [])[1] || ''
return [...body.matchAll(/^\s*pub (\w+):/gm)].map(m => m[1])
```

The prompt asks: "What inside an Anchor account struct could terminate it early, and would that fail closed or open?"

`\n\}` matches a newline followed by `}` at the start-of-content. Inside a `#[account(...)]` constraint, Anchor commonly has multi-line constraints:
```rust
#[account(
    init,
    ...
)]
```
That closes with `)]` not `\n}`. But a `seeds = [...]` constraint or a nested closure could contain `\n}`? Unlikely in account structs. More plausibly: a **doc comment** with an example containing `}` at line start, e.g.
```rust
/// like this:
/// }
pub bank: Signer<'info>,
```
`\n}` would match the doc-comment's `}` line **before** reaching `bank`, truncating the body early. Then `.indexOf('bank')` returns `-1` (bank is after the truncation) → `declaredBankIdx` comparison fails → the assertion `mintVaultFields(mintSrc).indexOf('bank') === declaredBankIdx` is `-1 === 4` → **false → build red.**

The self-audit's own R5-4 refutation arm (`── findings REJECTED by measurement`) claims: "truncation before `bank` fails CLOSED, and truncation after it cannot move `bank`'s index." Verified: `injectAt('    pub collection:')` → indexOf bank = -1 (closed), `injectAt('    pub revenue:')` → indexOf bank = 4 (unchanged). So the *direction* claim is right.

**But the refutation is incomplete.** It tests injecting a *bare* `}\n` at a field boundary. It does **not** test a `}` that appears with leading whitespace (`    }` — a nested brace), which the regex `\n\}` would *not* match (it requires `}` at column 0 after the newline). So a real Rust nested brace `    }` does not truncate — meaning the regex is *more* robust than the refutation gives it credit for, in one direction. The residual risk is only a *column-0* `}` inside the struct body, which in idiomatic Rust only appears at struct end. So the mechanism is real but the reachable surface is near-empty.

**Severity: LOW.** Fails closed (red build) if it triggers, which is the safe direction, and the trigger requires a column-0 `}` inside the struct — non-idiomatic. Not exploitable, worth hardening: anchor the struct-end brace with a preceding check that no earlier column-0 `}` exists, or match to the *balanced* brace.

## R5-LOW-11: `codeOnly` strips only full-line comments — a heredoc or a `#` inside a single-quoted string is mis-stripped, and the arm's own scope is shell where `#` is context-dependent

**The construct.**
```js
const codeOnly = src => src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
```
The prompt asks: "What is a `#` that is not a comment?" In shell:
- `#` inside a single- or double-quoted string is not a comment (`echo "foo#bar"`).
- `#` in `${VAR#pattern}` (prefix removal) is not a comment.
- `#` as `$#` (arg count) is not a comment.

`codeOnly` only strips lines whose **first non-space char** is `#`. It does not strip mid-line `#`. So a line `echo "exec node bank/cosign.mjs # example"` is **kept** by `codeOnly` (first char is `e`), and the exec-count regex `/^\s*exec .*cosign\.mjs.*$/gm` would... not match it (line starts with `echo`, not `exec`). So the count stays correct.

The genuine risk: a line beginning with whitespace then `#` that is actually a *continuation of a quoted heredoc* containing the word `exec ... cosign.mjs`. `bank-sign.sh` has no heredoc. So today: safe.

**Where the arm is thin.** `codeOnly` is applied to `signSh` (bank-sign.sh). That file's only `exec ...cosign.mjs` line is real code, and the round-18 comment about it starts with `#` → stripped. So the count = 1. Correct. But the arm's robustness claim ("comments are stripped first") is overstated: it strips *full-line* comments only. A trailing comment on the real exec line (`exec ... cosign.mjs --tx "$TX"  # note`) would keep the line (good) and the regex `.*cosign\.mjs.*$` matches it (good, count 1). A *second* documentary `echo '... cosign.mjs ...'` line beginning with `echo` is kept and does not match `^\s*exec`. So the count stays 1. **The arm is actually robust for this file.** No finding — recording that the `#`-context concern does not bite here because the regex additionally anchors on `exec`.

## R5-MEDIUM-12: the stale-`nothingToDo` arms prove the *detector* suppresses, but claim to justify the *writer* clearing — the two selftest arms in the diff do not connect writer to detector for the crash-then-quiet ordering

**The construct.** The two arms added to `selftest.mjs` (round-18 self-audit block):
```js
t('a half-finished day raises the alarm...', D.detectDistribution({... paid:{v1:{sig:'abc'},v2:{sig:null}}}...))
t('...and a STALE nothingToDo would silence it...', D.detectDistribution({... nothingToDo:'...', paid:{...}}...))
```

These prove: (1) a half-finished day with no `nothingToDo` fires `distribution_unfinished`; (2) the same day *with* `nothingToDo` does not fire. That is a fact about `detectDistribution`. It correctly demonstrates *why* a stale `nothingToDo` is dangerous.

But the comment claims "`distribute.mjs` now clears BOTH no-pay flags when a plan proceeds; these two arms are why it has to." The arms do **not** test that `distribute.mjs`/`supersede` actually clears them — that is the *round-19* block's job (`supersede` arms). So these two arms alone prove a hazard exists, not that it is closed. Taken together with the round-19 `supersede` arms, the closure *is* tested. So no gap — but note the two arms use `paid: {v1:{sig:'abc'}, v2:{sig:null}}`, i.e. a `sig:null` row that is *ambiguous*. This will ALSO fire `distribution_unresolved` (CRITICAL) because `!r.sig && !r.skipped && !r.rejected && !r.resolvedBy` is true for v2. The arm only checks `.some(f => f.kind === 'distribution_unfinished')`, so the co-occurring CRITICAL is invisible to the assertion, which is fine for what it tests.

No finding beyond noting the arms prove half the story; the other half is in the round-19 block. **This holds.**

---

# R6 — counts and arithmetic

## R6-OK: floors read from run-tests.sh

Verified against the file: `MIN_ASSERTIONS=286`, `DET_FLOOR=434`, `ALLOC_FLOOR=93`, `MAINNET_FLOOR=19`. The `audit19.ts` `grab()` reads exactly these regexes. The equality-not-floor change (`-eq`) is present in both `run-tests.sh` (twice) and both selftest files. **Consistent.**

## R6-OK: census and shares

- 108+60+36+24+12 = 240 ✓; denominator 108·2+60·3+36·4+24·5+12·6 = 216+180+144+120+72 = 732 ✓
- 945+525+315+210+105 = 2100 ✓; 945·2+525·3+315·4+210·5+105·6 = 1890+1575+1260+1050+630 = 6405 ✓
- Shares at 2100: I 1890/6405=29.51%→29.5; II 1575/6405=24.59→24.6; III 1260/6405=19.67→19.7; IV 1050/6405=16.39→16.4; V 630/6405=9.84→9.8. Sum 29.5+24.6+19.7+16.4+9.8 = 100.0 ✓
- Per $1000 at 2100: I 2000/6405=0.3123→0.31; V 6000/6405=0.9368→0.94 ✓
- Per $1000 at 732: I 2000/732=2.732→2.73; V 6000/732=8.196→8.20 ✓
- Dust bound: `dustAt(6404n)` — for each level `n_l * (6404 * w_l / 6405)`. `6404*2/6405 = 12808/6405 = 1` (floor), so level I contributes 945·1=945; `6404*3/6405=19212/6405=2` →525·2=1050; `6404*4/6405=25616/6405=3`→315·3=945; `6404*5/6405=32020/6405=4`→210·4=840; `6404*6/6405=38424/6405=5`→105·5=525. Total=945+1050+945+840+525=4305. Dust=6404-4305=2099 ✓. And 2100-1=2099 ✓.

**All customer-facing figures check out.** No finding.

## R6-LOW-13: SPEC's "Running the tests" prose still contains stale internal counts (`178/93/14`, `270/355/17`, `69 assertions`, `63 allocation assertions`) that the gate does not check

**The construct.** SPEC.md's tests block:
```
node bank/distribute.mjs --selftest   # 63 allocation assertions, both directions
```
and the alarm section: "Every detector is proven in BOTH directions by `bank/selftest.mjs` (69 assertions)."

The real allocation floor is **93** (ALLOC_FLOOR / distribute.mjs FLOOR), not 63. The real detector floor is **434**, not 69. The `SPEC states the ... floor` gates only check the specific regexes `/# (\d+) assertions, real cloned Core/` (286), `/\(\+ (\d+) detector/` (434), `/(\d+) allocation and \d+ live-mainnet/` (93). Those three specific strings in the top block are correct (286/434/93). But the **other** count strings in SPEC — `# 63 allocation assertions` and `(69 assertions)` — are stale and **unchecked**.

**Evidence.** Grep SPEC.md: `node bank/distribute.mjs --selftest   # 63 allocation assertions` (real: 93) and `(69 assertions)` in the alarm section (real: 434). The gate at "SPEC's stated assertion counts equal the real floors" reads only the summary block, not these prose repetitions. This is precisely the "a documented count that is visibly wrong teaches the reader that the floors beside it are decorative" hazard the gate's own comment names — surviving in two other spots in the same file.

**Severity: LOW** (documentation drift, no money), but it is the exact defect class the project claims to have mechanized away, sitting one section below the gate that mechanizes it. Fix: either add gates for these two strings or delete the redundant counts.

---

# R7 — WHAT THE SELF-AUDIT MISSED

## R7-1: The `resolvedBy` clearing (R1-CRITICAL-1 above) IS the one-of-N-sites recurrence

The builder swept and declared `settledAsPayout` the only cadence-question site. That specific claim is true. But the *general* R7 question — "for EVERY fix, was it applied to all sites of its own shape" — catches the `DONE_MARKS` fix: adding `resolvedBy` to the cleared set is a change to a field with **five** readers, and only one reader (the unfinished-alarm) was considered. That is the finding at R1-CRITICAL-1. **The self-audit's enumeration-from-the-detector arm gave false confidence** because it enumerated suppressors of *one* finding and treated clearing them as globally safe.

## R7-MEDIUM-14: `paymentState` order — a `resolvedAs:'unpaid'` row is `'resolved'` (settled, never resent) but represents money that never landed; nothing forces a human to ever pay it

**The construct.** `paymentState` returns `'resolved'` for any `resolvedBy` row. The money loop skips `'resolved'`. So a row `{sig:null, resolvedBy:'gary: established nothing landed', resolvedAs:'unpaid'}` is **permanently skipped** — never resent. That is *intended* (the comment: "a human who wants it retried deletes the row"). 

But now `settledAsPayout` returns `false` for it (correct — nothing landed). And `holdDays` does not count it. So the vault genuinely was **not paid**, and the system's only record that it is owed is a row that reads as "settled." No detector fires on a `resolved` + `resolvedAs:'unpaid'` row — `detectDistribution`'s `unresolved` filter excludes `r.resolvedBy`. So a legitimately-unpaid vault, resolved-as-unpaid by a human who meant "I confirmed it failed, someone needs to pay it," becomes invisible to every alarm and every retry.

**Evidence.** `detectDistribution({days:{d:{startedAt:'x',finishedAt:'y',paid:{v1:{sig:null,resolvedBy:'gary: nothing landed',resolvedAs:'unpaid'}}}}}, {today:'t'})` returns `[]`. The vault v1 is owed and nothing will ever pay or flag it.

**Severity: MEDIUM.** It is a documented-ish behavior ("delete the row to retry"), but `resolvedAs:'unpaid'` is a *new* affordance introduced this round that has no corresponding "this vault is owed and unpaid" detector, and the semantics ("resolved" = settled) actively hide it. The builder added `resolvedAs` for the cadence question and did not consider that `resolvedAs:'unpaid'` creates a settled-but-unpaid state with no watcher. Fix: a `resolvedAs:'unpaid'` row should be surfaced by a detector as "resolved as unpaid — this vault is owed and will not be retried automatically," or the semantics of `resolvedAs:'unpaid'` should require deleting the row instead of annotating it.

---

# THIRD TARGET — under-claims (SAFER than documented)

## UC-LOW-15: SPEC says the alarm emails on "(69 assertions)" — understating the detector coverage by ~6.3x

Covered at R6-LOW-13. This is an under-claim in the direction the prompt asks for: the pipeline is *far* better instrumented (434 detector assertions) than the doc says (69). Harmless, but it is the requested inverse-defect: documentation understating a real guarantee.

## UC-16: MAX_HOLD_DAYS ceiling — the corrected comment now UNDER-claims by omitting that the ceiling *does* protect small-but-nonzero pools

The round-19 correction to `MAX_HOLD_DAYS` is careful and correct: it says the ceiling fires only "while the pool can give every activated vault at least one satoshi." That is accurate. Not a defect — recording that I checked the under-claim direction and the correction is neither over- nor under-stated.

---

# CARRY-OVER LIST — worse than stated?

- **Item 12 (compute units unmeasured):** Confirmed worse, as the prompt flags. The R1 fix added per-instruction introspection to MINT's `mint_vault` (a loop over every top-level instruction, `while let Ok` walk). Every additional mint at every activation now runs an unmeasured CU-consuming introspection loop. SPEC itself says "Compute units are NOT measured anywhere. A second, unexamined ceiling that may sit below the byte ceiling." With the instruction-walk added to the busiest path (mint), this is now a live risk on the *common* path, not just redemption. **Not re-filing as new** (it's item 12), but confirming: worse than stated, and now on the activation hot path.

- **Item 4 (allowlist permits a second BurnV1 beside a redemption):** Still open, unchanged. Not worse.

- **Item 11 (distribution reconciles against a ledger the payer wrote):** The `supersede` / `resolvedAs` machinery *increases* the surface of operator-writable fields the reconcile trusts (`resolvedAs`, `supersededWas`, `resolvedBy`). Marginally worse in principle, but within the accepted limit. Noting, not re-filing.

---

# VERDICT CHALLENGES

The suite's self-described guarantees to challenge:

1. **"supersede clears EVERY suppressor the detector honours."** True for the *unfinished* arm only. The gate parses one guard and generalizes. As R1-CRITICAL-1 shows, `resolvedBy` is honored by four *other* readers with different meanings, and clearing it damages them. The verdict "one fact, one reader" is contradicted by the fix itself: `resolvedBy` is one field with five readers.

2. **"the floor must EQUAL the count."** This equality change is good, but note it makes the *build* red on any assertion added without moving all copies — including `SPEC.md`'s summary block *and* the two unchecked prose counts (63, 69). So the "equal" discipline is not actually enforced across all count-copies; two live in unchecked prose (R6-LOW-13). The verdict that counts "can never disagree again" is false for the two prose copies.

3. **"a source auditing itself is the weakest review arrangement."** The self-audit correctly found four defects but its enumeration-from-source gates gave it false confidence on `resolvedBy` (R1-CRITICAL-1) and on `resolvedAs:'unpaid'` (R7-MEDIUM-14) — both are new fields/behaviors the self-audit introduced and then tested only against the hazard it was thinking about, not against the other readers. This is direct evidence for the prompt's own thesis.

---

# SUMMARY OF FINDINGS

| ID | Sev | One line |
|---|---|---|
| R1-CRITICAL-1 | **HIGH** | `supersede` clears `resolvedBy`, re-raising `distribution_vault_unreadable` / day-level `refused` a human already resolved; `resolvedBy` has 5 readers, only 1 was considered |
| R7-MEDIUM-14 | MEDIUM | `resolvedAs:'unpaid'` creates a settled-but-owed state no detector surfaces and no retry touches |
| R3-MEDIUM-6 | MEDIUM | non-GNU `base64 -w0` makes the ONE sanctioned redemption path refuse every valid tx with a misleading "not CANONICAL" message |
| R5-HIGH-9 | MEDIUM | `controlTableBlock` terminates on a blank line, so a control row after an in-table blank is never checked — the "row never checked" defect reintroduced |
| R2-LOW-4 | LOW | forgotten `resolvedAs:'paid'` silently doesn't reset clock, no operator warning |
| R2-LOW-5 | LOW | `census` `{...c}` discards the null prototype the comment claims protects the export |
| R3-LOW-7/R4-LOW-8 | LOW | `--live`/`--dry-run` substring match has no boundary; `--liveness`-style flags would mis-arm |
| R5-MEDIUM-10 | LOW | MintVault regex truncatable by column-0 `}` in struct (fails closed; near-empty surface) |
| R5-LOW-11 | LOW | `codeOnly` strips only full-line `#` comments (robust for this file, fragile as a general claim) |
| R6-LOW-13 | LOW | SPEC prose still states `63 allocation` / `69 detector` assertions (real: 93/434), unchecked by the count gate |
| Item 12 | (carry) | MINT's new per-instruction introspection loop puts unmeasured CU risk on the activation hot path |

I did not find a defect in the vault mechanics, the 2-of-2, the emptiness proof, the `mint_vault` bank-slot confinement (the C4b gate genuinely pins `MINT_IX_BANK_IDX`), or the arithmetic. The confinement fix and the base64 round-trip are sound in the GNU case. The highest-value finding is **R1-CRITICAL-1**: the `resolvedBy` clearing is the project's signature defect (a fix touching one of N readers) recurring inside the very code written to close that class, and it is invisible to the gate because the gate enumerated suppressors of one finding and treated deletion as globally safe.

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Sixteen rounds of AI audit have converged on a specific structural blind spot, and it is visible in this very round: **every gate here checks one predicate against one source, and the project's recurring defect is a fact with N readers where a fix touches one.** The gates cannot see this because each gate *is itself* a one-reader construct. Concretely, beyond SPEC's SHIP GATE:

1. **Build a field-reader cross-reference and gate on it.** For every field written to `distributions.json` / `revenue-ledger.json` (`resolvedBy`, `resolvedAs`, `refused`, `nothingToDo`, `finishedAt`, `skipped`, `sig`, `unreadableAtas`), mechanically enumerate every function that *reads* it (grep `rec.X`, `row.X`, `r.X`, `\.X`) and assert the count matches a declared expectation. Then any fix that adds or removes a reader of a field forces you to re-declare — which is exactly the review R1-CRITICAL-1 needed and no gate provided. The project already does this for the Bank-key reader and the DAS envelope; it does *not* do it for ledger fields, which is where this round's worst defect lives.

2. **Property-based / fuzz the pure functions instead of pinning examples.** `supersede`, `holdDays`, `paymentState`, `settledAsPayout`, `detectDistribution` are pure. Generate random ledger records (random subsets of the 8 fields, random orderings, two-runs-a-day, dry-run-between) and assert *invariants* that survive composition: "a day that ever paid never loses `finishedAt`," "a human-resolved finding never re-fires after any sequence of runs," "a vault that is owed is either retryable or surfaced." Example-based tests pin the case the author imagined; the author's imagination is the thing under audit. A fuzzer over these five functions would have hit the `resolvedBy`-plus-`unreadableAtas` state in seconds.

3. **Run the full daily/redemption sequence end-to-end against the fixtures, not the functions in isolation.** Every gate reads *text* or calls *one function*. The two defects that mattered most across recent rounds (the `cd`-before-read path bug; this round's cross-field `resolvedBy` clearing) are only visible when the *sequence of operations over shared state* runs. Add a harness that drives `main()`'s branches (skip / pay / crash-resume / supersede) over an in-memory ledger with the RPC/keyfile stubbed, and asserts the *detector output* after each step. That is the only way to catch a writer that damages a reader in a different file.

4. **Track a fix-to-reader ratio as a shipped metric.** The project *knows* its signature defect is "one of N sites." Make that measurable: for each commit, count the readers of every symbol the commit touches, and require the commit message or a manifest to affirm each was reviewed. It is bureaucratic, but it converts the tacit knowledge ("we keep doing this") into a gate the next round cannot pass without confronting.

Reference in **Bold**: file names and identifiers verified against the bundled source. I have not run the suite; every claim above names the record or the function call that would confirm it, per the calibration instruction.