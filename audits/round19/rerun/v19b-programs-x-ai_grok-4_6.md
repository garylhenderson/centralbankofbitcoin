I'll work through R1–R7 against the actual files, not the comments, and only write a finding when I can say what on-chain or test evidence would exist if the claim is true. I'll start by rendering the audit prompt interpolations and reading the money-path writers, then the gates that claim to pin them. I'll pull the live files that decide money movement and the gates that claim to pin them, then check interpolations, flag-clearing order, and the published arithmetic independently. I'll verify the remaining R2–R6 claims against the live writers and the detector they feed, then look for one-of-N sites and under-claims. I have enough of the money path and gates to start writing; I'll pull a few remaining live snippets so each finding names a construct that actually exists. I have enough to write. I'll keep every finding tied to a construct I can point at, and I'll say what evidence would exist if the claim is true.# Round 19 audit

I treated the self-audit's repairs as untrusted, rendered interpolations rather than reading them, and re-derived the arithmetic. Several things the builder already pinned as "rejected by measurement" are in fact rejected. What follows is what is still wrong, or still understated.

---

## R1. The self-audit's own repairs

### R1-1. Template-literal / escaping defects that source-reading cannot see

**MEDIUM — `scripts/audit19.ts` still ships a backslash-escaped interpolation as literal text, in the same file that exists to stop that class.**

Exact construct. The prompt template is a JS template literal. The R1 bullet is written:

```
  - \${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT in the audit prompt: a backslash-escaped \${ renders as the placeholder, not the value
```

Rendered, every auditor is handed the characters `${FLOORS.onchain}` (and, later in the same paragraph, a second `\${` that also survives). They are not handed `286`. The surrounding sentence is *about* the previous defect, so the rendered prompt now *demonstrates* the defect it is describing.

The same file *does* interpolate correctly in the suite-count paragraph (`a ${FLOORS.onchain}-assertion suite`). That is the contrast that makes this a remaining site, not a leftover of the original bug: the repair was applied to the count line and not to the sentence that talks about the count line.

Evidence if true: write `PROMPT` to disk from `audit19.ts` (or `console.log(PROMPT.slice(...))` around the R1 bullet) and grep for the literal string `${FLOORS.onchain}`. It will be there. `tsc` will still pass.

Fix: drop the backslash. If the pedagogical sentence must show the escaped form, write it as `` '\\${FLOORS.onchain}' `` outside the interpolation, or as a concatenation, so the rendered prompt cannot contain a live-looking placeholder.

I did not find a second *silent* interpolation failure of the original shape (a floor that should have been a number and is instead the token). The other `\${` / `\$CBOB` / `\$TX` occurrences in the prompt are either the same pedagogical sentence or shell/markdown that is *meant* to survive. The FLOORS object itself is read from `run-tests.sh` and is sound.

### R1-2. `isTableRow` — one definition, but the predicate is still too narrow for the table it claims to own

**LOW — `isTableRow` is now the single definition and is used at every call site in `selftest.mjs`. The predicate itself still cannot see a well-formed row whose classification is not bolded exactly as `**ON-CHAIN.**` / `**AUTOMATIC.**` / `**PROCEDURE.**`.**

```javascript
const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)
```

That is used by `tableRows`, `tableLines`, and `controlTableBlock`'s "every `|` line must classify" check. One definition, genuinely shared. Good.

What it misses: a real control row written `| … | ON-CHAIN. The program refuses. |` (no bold, or bold only on the word, or `**ON-CHAIN**` without the following `.**`) is invisible to `tableRows` *and* is flagged by the new block check as "unclassified". That fails closed for a *new* row. It also means a legitimate tightening of the table's typography (dropping the trailing period from the bold span, or writing `**ON-CHAIN**.` with the period outside) turns every existing row into "unclassified" and reds the build. That is the right failure direction.

A real control row cannot silently fail to match *and* still pass: the block enumerator requires every `|` line under the header to match. I do not have a finding that a live row is currently unmatched — the five shipped rows all carry the bold form.

No finding beyond the residual brittleness. Not a money bug.

### R1-3. `supersede()` — clearing all three marks is correct for the crash-after-proceed case; it is not correct for every ordering the prompt named

**HIGH — `supersede` deletes `finishedAt` from a day that already completed a paying run. A same-day resume, or a `--dry-run` after a live pay, can reopen a finished day and either re-attempt transfers or page `distribution_unfinished` for a day that already paid.**

Exact construct:

```javascript
export function supersede(rec, nowIso) {
  const was = [rec?.refused, rec?.nothingToDo].filter(Boolean)
  if (!was.length) return { rec, superseded: false, wasRefusal: false, was }
  const out = { ...rec }
  out.supersededAt = nowIso
  out.supersededWas = was.join(' + ')
  const wasRefusal = Boolean(rec.refused)
  delete out.refused
  delete out.nothingToDo
  delete out.finishedAt
  return { rec: out, superseded: true, wasRefusal, was }
}
```

Called from `main()` only when `!plan.skip && !DRY`, immediately before writing `plan`. The trigger is "the record currently has `refused` or `nothingToDo`".

Orderings:

| ordering | what happens | ok? |
|---|---|---|
| quiet then pay | morning wrote `nothingToDo`+`finishedAt`; afternoon proceeds, clears all three, starts paying | yes — this is the case the function exists for |
| refuse then pay | same, plus `wasRefusal` | yes |
| pay then crash then resume, *no* leftover no-pay flag | `was` is empty, function is a no-op, `finishedAt` stays absent until the skip/finish path | yes |
| two paying runs in one day, second after a leftover `nothingToDo` | first run paid, wrote `finishedAt`, and *did not* delete a leftover `nothingToDo` if the first run itself never went through this branch (e.g. the leftover was written by a later skip path, or an operator, or a partial write). Second run sees `nothingToDo`, deletes `finishedAt`, writes a new `plan`, starts sending | **no** |
| `--dry-run` in between | dry-run does not call `supersede` (`!DRY` guard). It also does not write. Harmless. | yes |
| live pay, then a later same-day run that still sees `nothingToDo` (operator re-added it, or a skip path wrote it after a partial, or the first version of the repair left it) | `finishedAt` is deleted, detector arm `startedAt && !finishedAt && !nothingToDo && !resolvedBy` now fires, and the paying loop is entered again | **no** |

The selftest pins only the crash-after-quiet case. It also pins the inverse: "a day that never held a verdict keeps its `finishedAt`". It does **not** pin "a day that paid, still carries a leftover no-pay flag, must keep `finishedAt`".

What an accident gains: (1) `detectDistribution` pages `distribution_unfinished` on a day whose `paid` rows already have signatures; (2) worse, `main()` will load that day, see no `finishedAt`, and walk `plan.activated` again. `paymentState` is supposed to stop a resolved/paid row being re-sent — that is a different function, and it is only as good as every send site consulting it. If any send site keys on "vault is in today's `plan.activated` and has no `sig`", a resume after `supersede` re-opens those vaults.

Evidence if true: construct a ledger day `{ startedAt, finishedAt, nothingToDo: 'holding', paid: { v1: { sig: 'REAL', amount: '100' } }, plan: { activated: ['v1'], … } }`, call `supersede`, then `detectDistribution`. The selftest's own "UNFIXED shape" assertion already shows that *putting `finishedAt` back* silences the alarm; the missing assertion is that a *finished paying day* that still has `nothingToDo` must not lose `finishedAt`. Run `supersede` on that record; `finishedAt` is gone.

Fix: delete `finishedAt` only when there is no evidence the day already paid (`!rec.plan` and no `paid` row that `settledAsPayout`). Or, simpler: never delete `finishedAt` here; have the paying path overwrite it when it actually finishes, and have the *start* of a paying path set a new `startedAt` and clear `finishedAt` only if `!rec.plan`. The three-mark clear is the right idea for a *quiet* morning. It is the wrong idea for a day that already has a plan.

### R1-4. Manifest porcelain record

**LOW — the record is now well-formed as JSON. Two residual issues, neither of which misaligns a status column.**

```javascript
const dirty=execSync('cd '+R+' && git status --porcelain -- '+WATCHED).toString()
// ...
dirty:dirty.split('\n').filter(Boolean)
```

Not trimming the blob is correct: porcelain is `XY PATH`, and a leading space on ` Y` (unstaged) is load-bearing. `split('\n').filter(Boolean)` drops only the trailing empty line that `toString()` leaves. Paths with embedded newlines are quoted by porcelain (`"path\nwith\nnl"`) and survive as a single array element. Fine.

Residual: `WATCHED` is built as `[...new Set(['programs','bank','scripts','tests',...TARGETS.map(([f])=>f)])].join(' ')` and interpolated into the shell with no quoting. Today every path is a single token. A future target with a space (or a crafted `TARGETS` entry) becomes two pathspecs. Fail-closed for "is the tree dirty?" — you might miss a dirty file and *not* trip the dirty-tree gate. That is the wrong direction for a gate whose job is to refuse a moving tree.

Evidence if true: add a tracked file with a space in a watched path, dirty it, run the porcelain line; `git status --porcelain --` will not see it if the name splits.

Fix: pass the pathspec as extra arguments to `execFileSync('git', ['-C', R, 'status', '--porcelain', '--', ...watched])`. Do not go through the shell.

The `head` / `headAfter` pair is sound. The dirty-tree exit is now a real gate.

---

## R2. Round-18 off-chain repairs (`bank/distribute.mjs`)

### R2-1. Direction of the `settledAsPayout` default

**No finding. The builder's direction is correct.**

`holdDays` returns days since the last day on which some row `settledAsPayout`. A bare `resolvedBy` does *not* qualify, so the clock stays on the last real `sig`. That makes `daysSinceLastPayout` **larger**. `decideEmission` pays when `daysSinceLastPayout >= maxHoldDays` (31) *and* `smallestPer >= 1`. A larger hold crosses the ceiling sooner. The selftest pins this end-to-end: bare → 52 → `pay: true`; `resolvedAs: 'paid'` → 2 → `pay: false`.

A larger `holdDays` pays **earlier**, not later. The default that refuses to guess "paid" therefore pays people sooner. If the builder had the direction backwards the default would be backwards; they do not.

(The ceiling still does not fire at `smallestPer == 0`, at any age. That is now documented. Known, pinned, not re-reported.)

### R2-2. `paymentState` still prevents a resolved row being re-sent

**No finding on the claim as stated, with one caveat.**

`settledAsPayout` is a reader. It does not write. `paymentState` is unchanged. Every send site that already asked `paymentState(row)` before transferring still gets `'resolved'` for a `resolvedBy` row, whatever `resolvedAs` is, and will not re-send.

Caveat, not a new caller-conflation: I cannot see every send site in the truncated `main()` of the diff. The self-audit claimed `settledAsPayout` is the only cadence reader. In the files I have, `holdDays` is the only consumer of `settledAsPayout`, and `paymentState` remains the send-side gate. If a third reader of the same rows appears in the unshown remainder of `distribute.mjs` and asks `=== 'paid'` for cadence, that is the one-of-N this round is supposed to catch — I flag it as unchecked, not as found.

### R2-3. Refusal now pages, and `--dry-run` is not exempt

**MEDIUM — a halt any stranger can trigger now pages on every daily run, including `--dry-run`. That is a paging surface. It is also, on the live path, the correct severity.**

Exact construct:

```javascript
if (plan.refusal) {
  const msg = `CBOB DISTRIBUTION REFUSED and paid nobody: ${plan.skip}`
  console.error(msg)
  if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
  process.exitCode = 1
}
```

NOTIFY is gated on `!DRY`. The prompt said "the exit code is NOT suppressed under `--dry-run`". That is true: `process.exitCode = 1` sits outside the `!DRY` guard. Cron that treats a non-zero as a mail-the-output event will mail on every dry-run that hits an unlevelled vault.

Anyone can mint a vault, fund it to 21,000 sats, and — until `levels.json` has a row — halt the job. That halt is the recoverable failure (paying without them overpays everyone else, permanently). Paging a human on the *live* path is right: a halt that stops customer payouts should not wait for `alarm.mjs`. Paging on `--dry-run` is not: dry-run is how you discover the missing level *before* 09:07.

Evidence if true: `node bank/distribute.mjs --dry-run` against a levels file missing one activated vault; process exits 1; if cron is `MAILTO=…`, the operator gets mail. Live path also calls NOTIFY.

Fix: keep NOTIFY and exit 1 on the live path. Under `--dry-run`, print the refusal and exit 0 (or exit 1 without NOTIFY, and document that dry-run is expected to be red until levels are complete). Do not let a stranger's mint become a 09:07 page *and* a dry-run page.

I do not call this HIGH: the live page is the intended control, and the grief is "wake Gary", not "move money". Known limit 17 (unlevelled halt) is not worse than stated; this change made the halt *louder*, which is the direction the previous round asked for.

### R2-4. `census()` serialisation

**No finding.**

```javascript
const c = Object.create(null); for (const l of LEVELS) c[l] = 0
for (const v of Object.values(levels)) if (Object.hasOwn(c, v)) c[v] += 1
return { ...c }
```

The spread into `{}` restores a normal prototype. `JSON.stringify` of a null-prototype object already works; the spread makes `denominator`'s `Object.hasOwn(c ?? {}, l)` and any `for…in` consumer both safe. Ledger round-trip: `plan.census` is a plain object with keys `I…V` and integer values; `JSON.parse` gives a normal prototype; `denominator` uses `Object.hasOwn`, so a parsed census cannot pick up `Object.prototype` pollution. No consumer in the bundle required the null prototype.

### R2-5. Dust bound

**No finding on the bound. Re-derived.**

`allocateWeighted` does integer division per paid vault: `share_i = available * w_i / DEN`. Dust is `available - Σ share_i`. Each paid vault contributes a fractional part in `[0, 1)`, so `0 ≤ dust ≤ paid - 1` when `available >= DEN` in the modular sense, and more tightly `dust < paid` always, because each remainder is `< 1` sat.

When `available` is smaller than the vault count: every share floors toward 0, dust equals `available` if every share is 0, or `available - Σ floors` otherwise. If some vaults are skipped they are not in `activated`, so the comparison is against `activated.length`, not the census. `dust < activated.length` holds because there is one remainder per *paid* vault, and skipped vaults are not paid.

At the published census, `available = DEN - 1 = 6404`:
- each level's per-vault floor is `6404 * w / 6405 = w - 1` (because `6404 ≡ -1 (mod 6405)` and `w < 6405`)
- total paid = `945·1 + 525·2 + 315·3 + 210·4 + 105·5` = `945+1050+945+840+525` = `4305`
- dust = `6404 - 4305` = **2099** = `2100 - 1`

Attained. The "1,731" local maximum is smaller. The comment is now the true bound.

`dust < activated.length` is **not** the same as `dust < 2100` when some vaults are skipped: if 2,099 of 2,100 are skipped, `activated.length` is 1 and dust is 0. Still holds.

---

## R3. `scripts/bank-sign.sh` — canonical base64 round trip

### R3-1. An input it accepts that still decodes to something other than what was pasted

**MEDIUM — the round-trip uses `base64 -d` / `base64 -w0`, which is not the same decoder Node will use, and the pipeline is wrapped in `|| true` so a missing `base64 -w0` (macOS, BusyBox, some minimal images) accepts everything.**

Exact construct:

```bash
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
if [ "$CANON" != "$TX" ]; then
  echo "the transaction is not CANONICAL base64: ..." >&2
  exit 2
fi
```

Problems, in the order the prompt asked:

1. **`|| true` plus `set -euo pipefail`.** The assignment is `CANON=$(pipeline) || true`. If `base64 -w0` does not exist, the pipeline fails, `CANON` is empty (or partial), the `|| true` swallows it, and `"" != "$TX"` is true — so it *refuses*. That is fail-closed for a missing encoder. Good.

   If `base64 -d` fails and `base64 -w0` is absent, same: refuse. Good.

   If `base64 -d` *succeeds* on a non-canonical string the way GNU coreutils does (it is permissive: ignores newlines, accepts missing padding in some builds) and `base64 -w0` re-encodes canonically, inequality refuses. That is the intended path.

2. **Embedded whitespace.** `printf '%s' "$TX"` does not add a newline. If `$TX` itself contains newlines or spaces, GNU `base64 -d` ignores whitespace; Node's `Buffer.from(s, 'base64')` *also* ignores whitespace (and, historically, other non-alphabet bytes). The re-encode will not contain the whitespace, so `"$CANON" != "$TX"` refuses. Fail-closed. A legitimate paste with a wrapping newline is rejected — see R3-2.

3. **Locale.** `base64` is not locale-sensitive for the alphabet. Fine.

4. **`base64 -w0` availability.** On macOS, `base64` has no `-w0`; it is `-b 0` or a wrap-disable that differs by BSD revision. On those hosts the pipeline fails, `|| true` fires, `CANON` is empty, every input is refused. The sanctioned signing path does not work on a Mac. That is fail-closed for money, and it is also a denial of the only sanctioned path on the OS many operators use.

5. **The decoder is not Node's.** GNU `base64 -d` and `Buffer.from(s, 'base64')` disagree on some non-canonical inputs (Node is more permissive on leftover bits; GNU is more permissive on whitespace). The wrapper's claim is "Node would judge a DIFFERENT transaction than you pasted". The check actually proves "coreutils would re-encode this differently". Those are not the same set.

   Concrete accepted-but-different case I can name: **none that pass the equality check**, because equality is against the coreutils re-encode. If coreutils and Node accept the same canonical string, the bytes Node decodes equal the bytes coreutils decoded. Canonical standard base64 is unique for a given byte string. So: **no canonical string decodes to something other than what was pasted.** The leftover risk is a string that is canonical for coreutils and *not* what Node will decode — I do not have a specimen of standard-alphabet canonical base64 where the two decoders disagree. I will not invent one.

6. **`set -euo pipefail` inside `$(…)`.** A failing pipeline in a command substitution returns non-zero. `|| true` then forces success. Combined with `2>/dev/null`, the operator never sees *why* (`base64: invalid option -- 'w'`). They just get "not CANONICAL".

Evidence if true: on macOS or Alpine, `CANON=$(printf '%s' 'AAAA' | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true; echo "[$CANON]"` prints `[]`. Every real transaction is then refused.

Fix: do the round-trip in Node, with the same `Buffer.from(s,'base64')` / `.toString('base64')` the co-signer uses. That is the decoder that matters. Drop `|| true`. If you must stay in shell, probe `base64 -w0` vs `base64 -b 0` and fail with the actual stderr.

### R3-2. Does it reject anything legitimate?

**LOW — a real 1232-byte transaction is 1644 characters, which is `0 mod 4`, standard alphabet, one pad-free encoding. It passes. A legitimate paste that includes a trailing newline (how `cat tx.b64` often arrives if the file was edited in a normal editor) is rejected.**

1644 / 4 = 411. No padding required (1232 = 3*410 + 2, wait: 1232 mod 3 = 2, so the encoding is 1644 chars with `==` padding? 1232 = 3*410 + 2, output length = 4*411 = 1644, last quantum is 2 bytes → two pad chars. 1644 includes them. Fine.

`TX=$(tr -d '\n\r' <<<"$RAW")` (or equivalent — the file's earlier lines, not in the hunk) is what I need to know. The hunk does not show the read. If `RAW` is stripped of newlines before the check, a trailing newline is fine. If it is not, every `tx.b64` saved by `echo "$b64" > tx.b64` fails the round-trip.

I cannot see the read in the hunk. The comment says the file is read before `cd`. I am not filing a definite reject-legitimate without that line. Flagged as unchecked: confirm `TX` is whitespace-stripped *before* the round-trip. If it is, no finding. If it is not, this is HIGH — the sanctioned path rejects a normal file.

### R3-3. Is the corrected comment now true?

**No finding on the comment.** It now says the transaction is not in *this script's* argv / history, and that it **is** in `ps` for the life of `exec node bank/cosign.mjs --tx "$TX"`. That matches the last line. The "accepted limit" note (teaching `cosign.mjs` to read stdin) is honest.

---

## R4. `scripts/cron-install.sh` — the money claim

**MEDIUM — the new header is true of the two money jobs on a fresh install, and false as a complete statement of "what this script installs". One installed job can move money that the header never mentions; the posture print only talks about distribute and revenue.**

Jobs the script actually writes (from the crontab here-doc):

| line | job | as installed, can it move money? |
|---|---|---|
| `23,53 * * * *` | `bank/alarm.mjs` | No. Watcher. |
| `7 9 * * *` | `bank/distribute.mjs$DIST_DRY` | **Yes, unless** a previous tagged uncommented `--dry-run` was preserved. Fresh install: **LIVE cbBTC sender from next 09:07.** Header says this. |
| `41 */6 * * *` | `bank/revenue.mjs$REV_LIVE` | **No** on a fresh install (`$REV_LIVE` empty). **Yes** if a previous tagged `--live` was preserved. Header says this. |
| `19 4 * * *` | `bank/alarm.mjs --reconcile` | No. State scan. |
| `9 */2 * * *` | deadman `notify-gary-sms.sh` | No. SMS only. |

The header's two sentences about revenue (opt-in) and distribute (opt-out, armed on install) are true for a fresh crontab. The re-run paragraph is true: `ours()` keeps `--live` / `--dry-run` only from tagged, uncommented lines. The selftest executes that logic against fixtures and pins both directions.

What the header still understates:

1. **The posture print is the "authority" only if `crontab -l` is the file just written.** It greps the *installed* crontab, not `$TMP`. If `crontab "$TMP"` failed, or if another crontab was installed in the same second, the print can disagree with what this run wrote. Unlikely, but the comment claims the print is the authority.

2. **`ours | grep -q 'distribute\.mjs --dry-run'` does not require the flag to be attached to *our* distribute invocation's option list in a robust way.** It requires the tagged uncommented line to contain that string. A tagged comment-in-the-command like `distribute.mjs # was --dry-run` would not match (safe). A tagged line `distribute.mjs --dry-run-please-no` would match and preserve. Pedantic.

3. **Under-claim of the same shape the owner caught:** installing this also arms `alarm.mjs` at 23/53, which can NOTIFY, and the deadman, which can SMS. Neither moves Bitcoin. The header's scare line is only about cbBTC, and that is fair. I am not inflating this.

The header is **completely true of money movement** for the jobs it names. It is not a complete inventory. Completeness was the question. Finding is the inventory gap plus the "print is the authority" claim pointing at `crontab -l` rather than `$TMP`.

Fix: enumerate all five lines in the header, one clause each. Compute the posture from `$TMP` before installing, then install, then print.

---

## R5. The gates (`bank/selftest.mjs`)

### R5-1. `isTableRow` as a definition of a row

Covered under R1-2. Sound enough for the table that exists. The new block check means a non-conforming row cannot hide. A real control row that uses a different bolding fails closed.

### R5-2. MintVault struct-body regex

**No finding on consequence. Mechanism is real and fails closed, which the new arms pin.**

```javascript
const body = (src.match(/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/) || [])[1] || ''
```

What can terminate it early: a `}` on its own line inside the struct. Anchor account structs do not contain nested brace-blocks on their own line in normal form; they can contain `///` comments, `#[account(…)]` attributes, and `pub name: Type,`. A `#[account(constraint = foo)]` is not a newline-brace. A doc comment containing `}` on its own line would truncate.

Truncation **before** `bank` → `indexOf('bank') === -1` ≠ `4` → assertion red. Fail closed.
Truncation **after** `bank` → index of `bank` unchanged. The confinement still points at the real slot.
An empty match → `slice(0,6)` fails the "parser read a real struct" arm.

Pinned. I will not re-litigate it.

### R5-3. `codeOnly` for shell

**LOW — `codeOnly` treats every line whose first non-space character is `#` as a comment. That is correct for Bourne comments. A `#` that is not a comment: inside single quotes, inside double quotes, in the middle of a word (`$#`, `${#TX}`, `$#`), or after a command (`echo foo # bar` — this one *is* a comment, and stripping the whole line would drop the command).**

```javascript
const codeOnly = src => src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
```

It only drops lines that are *entirely* a comment (optional leading space, then `#`). Trailing comments stay. `echo exec node bank/cosign.mjs --tx "$TX"` stays, and is a second match for `/^\s*exec .*cosign\.mjs.*$/gm` only if the line *starts* with `exec`. The new "exactly ONE exec-of-the-co-signer line" arm is what stops a trailing-comment or echo from becoming the first `replace` target.

A `#` that is not a comment and sits at column 0 does not occur in this file. `codeOnly` is correct for the use it has. Residual: a here-doc line that begins with `#` is dropped; `bank-sign.sh` does not have one in the exec region.

No money finding.

### R5-4. Do the two new `nothingToDo` arms prove what they claim?

**MEDIUM — they prove the detector's suppress behaviour. They do not prove the writer clears the flag. The comment says they are "why the writer clears it".**

```javascript
t('a half-finished day raises the alarm...',
  D.detectDistribution({ days: { '2026-08-20': { startedAt: 'x',
    paid: { v1: { sig: 'abc' }, v2: { sig: null } } } } }, { today: '2026-08-21' })
    .some(f => f.kind === 'distribution_unfinished'), true)
t('...and a STALE nothingToDo would silence it — which is why the writer clears it',
  D.detectDistribution({ days: { '2026-08-20': { startedAt: 'x', nothingToDo: 'holding: quiet morning',
    paid: { v1: { sig: 'abc' }, v2: { sig: null } } } } }, { today: '2026-08-21' })
    .some(f => f.kind === 'distribution_unfinished'), false)
```

Arm 1: unfinished ⇒ alarm. True of the detector.
Arm 2: unfinished + `nothingToDo` ⇒ silent. True of the detector. This is a proof that the flag is dangerous, not a proof that `distribute.mjs` clears it.

The writer is now tested in `distribute.mjs --selftest` via `supersede()`, which is the right place. These two arms would stay green if `supersede` were deleted. The comment over-claims.

The later `supersede` block in `distribute.mjs --selftest` *does* prove the writer. So the gap is the selftest comment, not a missing test. Downgraded: the arms do not prove what *their own comment* claims; the property is proven elsewhere.

---

## R6. Counts and arithmetic

### Floors, verified against the files in the bundle

| name | `run-tests.sh` | `selftest.mjs` / `distribute.mjs` / SPEC |
|---|---|---|
| `MIN_ASSERTIONS` | 286 | SPEC: `# 286 assertions, real cloned Core` |
| `DET_FLOOR` | 427 | `selftest.mjs` `const FLOOR = 427`; SPEC: `+ 427 detector` |
| `ALLOC_FLOOR` | 79 | `distribute.mjs` `const FLOOR = 79`; SPEC: `79 allocation` |
| `MAINNET_FLOOR` | 19 | SPEC: `19 live-mainnet` |

The new equality checks (`!==` / `-eq`) mean a drifted copy is red. The selftest now compares its own `FLOOR` to `DET_FLOOR` and distribute's to `ALLOC_FLOOR`. I cannot independently count 427 / 79 / 286 assertions without executing the suites; I can say the *stored* numbers agree with each other. A claim that the suites actually emit those counts is a claim about a measured run, and the prompt says those runs exist and sit behind floors. I am not contradicting a measured run.

### Schedule figures, re-derived

Weights: I=2, II=3, III=4, IV=5, V=6.

**240-vault census** 108/60/36/24/12:

```
108·2 + 60·3 + 36·4 + 24·5 + 12·6
= 216 + 180 + 144 + 120 + 72
= 732
```

**2,100-vault census** 945/525/315/210/105 (exactly 8.75 × the 240 census):

```
945·2 + 525·3 + 315·4 + 210·5 + 105·6
= 1890 + 1575 + 1260 + 1050 + 630
= 6405
```

**Five shares of the drop** (share = weight / 732 at the 240 census, or equivalently / 6405 at 2100 — same ratios):

| level | weight | share of drop | ×1000 (per $1,000) |
|---|---|---|---|
| I | 2 | 2/732 = 0.273224% | $2.7322 |
| II | 3 | 3/732 = 0.409836% | $4.0984 |
| III | 4 | 4/732 = 0.546448% | $5.4645 |
| IV | 5 | 5/732 = 0.683060% | $6.8306 |
| V | 6 | 6/732 = 0.819672% | $8.1967 |

Per-vault shares sum across the census:

```
108·2 + 60·3 + 36·4 + 24·5 + 12·6 = 732
732/732 = 100.0%
```

The **ten** per-$1,000 figures are these five, plus the same five at the 2,100 census. At 2,100 the per-vault fraction is `w/6405`:

| level | w/6405 | per $1,000 |
|---|---|---|
| I | 2/6405 = 0.0312256% | $0.3123 |
| II | 3/6405 = 0.0468384% | $0.4684 |
| III | 4/6405 = 0.0624512% | $0.6245 |
| IV | 5/6405 = 0.0780640% | $0.7806 |
| V | 6/6405 = 0.0936768% | $0.9368 |

I do not have the card text in this bundle, so I cannot certify the *displayed* rounding. The fractions above are exact. If the card prints `$2.73` / `$0.31` those are the correct two-decimal roundings. If it still prints the old equal-per-vault `$4.17` (1000/240) that would be CRITICAL — I have no evidence it does.

**SPEC still contains the old dust sentence.** In the SPEC excerpt:

> Integer satoshis do not divide evenly, and at 2,100 vaults the remainder can be up to 6,404 sats a settlement.

That is the *loose* bound `distribute.mjs` just stopped quoting. The code comment now says 2,099. SPEC was not in the diff pathspec (`git diff … -- programs bank scripts tests`). This is the one-of-N the self-audit was supposed to sweep, applied to a disclosure figure.

**MEDIUM — SPEC's customer-facing dust figure is still the threefold-loose bound the repair exists to stop quoting.**

Evidence if true: `grep -n '6,404' SPEC.md` hits. The card, if it copies SPEC, still overstates retained dust.

Fix: change SPEC to the attained bound (2,099, `activated-1`), in the same commit that changed the comment. Add `6,404` to the "stale number in SPEC" selftest.

---

## R7. What the self-audit missed (one-of-N inside the fix)

### R7-1. `settledAsPayout` is not the only cadence-shaped question, and SPEC still states the false ceiling

**MEDIUM — SPEC's cadence paragraph still says "no holder ever waits longer than a month" without the qualifier that `distribute.mjs` just spent a page adding.**

SPEC (bundled):

> anything that never clears it is forced out at `MAX_HOLD_DAYS` (31), so no holder ever waits longer than a month **while the pool can give every activated vault at least one satoshi**.

Wait — the bundled SPEC *does* contain the qualifier, with a "Round 19" note. The dust sentence was not updated; the ceiling sentence was. One-of-two disclosure sentences, again. Dust is the remaining site (R6).

### R7-2. `finishedAt` was the third mark; `resolvedBy` is a fourth suppressor that `supersede` does not touch

`detectDistribution`'s unfinished arm is `startedAt && !finishedAt && !nothingToDo && !resolvedBy`. `supersede` clears three of the four silencers. A day that a human marked `resolvedBy: 'abandoned'` and that later proceeds will keep `resolvedBy`, and a subsequent crash will stay silent.

That may be intended (a human closed the day). It is not documented on `supersede`. If a proceed-after-resolve is a real operator path ("I resolved the refusal, now pay"), the leftover `resolvedBy` is the same fail-open the repair exists to close.

**MEDIUM — `supersede` does not clear `resolvedBy`, the fourth suppressor of `distribution_unfinished`.**

Evidence if true: `supersede({ resolvedBy: 'gary', nothingToDo: 'x', finishedAt: 'y' })` then crash-with-plan; `detectDistribution` returns `[]` because `resolvedBy` remains.

Fix: clear `resolvedBy` on proceed, or record it under `supersededWas` and delete it, same as the other two verdicts. A human close of a *paying* day should be a new `resolvedBy` written after the crash, not a leftover.

### R7-3. `errNames` still only scrapes two of four programs for `BankKeyOutside*`

```javascript
const bankErrs = ['programs/cbob-vaults/src/lib.rs', 'programs/cbob-vault-mint/src/lib.rs']
  .flatMap(errNames).filter(n => /^BankKeyOutside/.test(n))
```

BURN does not emit `BankKeyOutside*`. If it ever does, this arm will not see it. The comment says "verified identical to the old scrape on all four programs (16/33/21/17)" — they counted variants, then filtered two files. One-of-N in the gate that exists to stop unnamed Bank refusals.

**LOW.** Fail-open only if BURN or GOV grows a `BankKeyOutside*` variant. Not live today.

### R7-4. SEAL's confinement still exempts the entire open/burn instruction, including `payer`

Known limit 3 says this is accepted: "The Bank may still be named `payer` INSIDE the pair itself; the confinement exempts both approved instructions entirely." MINT was narrowed to positional identity; SEAL/BURN were not. That is one-of-two-sites on the *repair*, and it is listed as accepted.

Is it worse than stated? On a redemption, `payer` pays Core fees / plugin updates, not `price_lamports`. Naming the Bank as payer of an open/burn spends the Bank's SOL on fees, not on buying a stranger a vault. Bound is the Bank's SOL float, same as the original theft, smaller per transaction. **Not worse than stated.** Do not re-report.

### R7-5. `audit18.ts` is still in the tree with the original escaped-floor defect and a roster that invents nothing new but is not the runner

Not a runtime path for this round (`audit19.ts` is). No finding.

---

## Carry-over list — worse than stated, or actually exploitable

**12. COMPUTE UNITS unmeasured. The prompt says this got worse this round.** MINT now walks every top-level instruction and, on each mint, iterates every account. A transaction that packs many mints (legal: several mints may share a transaction) does O(instructions × accounts) `require!` work on top of Core `CreateV2`. Still unmeasured. Not newly exploitable as a theft; newly more plausible as a mint that fails `ComputationalBudgetExceeded` after the Bank has already signed. That is a liveness / fee-payer problem, not a funds-loss. I agree it is worse. I do not have a CU number. Do not upgrade this to CRITICAL without a measurement.

**1a / 3.** Unchanged. MINT's positional check closed the *mint-as-payer* theft; the fee payer is still invisible on-chain. Not worse.

**16. Level register off-chain.** Unchanged. Code has not accidentally assumed a VRF or a $CBOB ladder. `LEVEL_WEIGHTS` and `levels.json` are still a file the operator writes.

**17. `EMISSION_MIN_PER_VAULT` provisional.** Unchanged. The new comment correctly says the 31-day ceiling does not apply below 1 sat/vault.

I do not see an accepted limit that is actually an exploit beyond what is written.

---

## Third target — under-claims (safer than the docs say)

### U1. **HIGH as documentation — MINT also refuses to execute without the Bank, and the control table's first ON-CHAIN row still names only SEAL and BURN.**

Exact construct. SPEC control table, first row:

> `programs/cbob-vaults/src/lib.rs` and `programs/cbob-vault-burn/src/lib.rs` each take `bank: Signer` and `require_keys_eq!`

`mint_vault` does the same (`pub bank: Signer<'info>` + `require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, MintError::NotTheBank)`). A vault cannot be *created* without the Bank either. The table's second row names MINT for *confinement*, not for the 2-of-2 itself.

This is the owner's defect, one site over. The customer is buying "nothing in this system moves without the Bank" and the table says that about unsealing and burning. Minting is the busier path (the round-17 CRITICAL's own argument). The gate was changed to `rows.length >= 5` specifically so that adding the third ON-CHAIN row would not fail the build — and then the row was not added.

Evidence if true: `onChainBankPin('programs/cbob-vault-mint/src/lib.rs')` is true (the function checks exactly those two tokens). The first table row's program list does not include that path. A buyer who reads only the first row thinks a mint can happen without the Bank.

Fix: name MINT in the first row, or add the extra ON-CHAIN row the selftest already fixtures as "does NOT break the build".

### U2. **MEDIUM — `supersede` records *both* prior verdicts; the header comments in `main()` still talk as if only one flag mattered.**

Minor. The code is stronger than the leftover comments in the first version of the repair (some of which remain above the call). Not customer-facing.

### U3. **No under-claim on the 31-day ceiling in `distribute.mjs`.** That comment was corrected in this diff, in the direction of *less* promise. SPEC's dust figure is the remaining over-claim (R6), not an under-claim.

---

## Other findings

### O1. **HIGH — `MINT_IX_BANK_IDX = 4` is correct today, and the walk applies it to *every* `mint_vault` in the transaction, including siblings. A sibling mint that lists accounts in a different physical order (same logical accounts, different `AccountMeta` order) is refused. That is fail-closed. The opposite — a crafted instruction that is *not* a mint but starts with `IX_MINT_VAULT_DISC` and puts the Bank at index 4 — is dispatched to `mint_vault` and fails there.** I cannot break the positional check with the exemption as written. No theft finding. CU cost of the walk is the live residue (carry-over 12).

### O2. **LOW — `census` / `denominator` still treat a missing level key as 0 via `Object.hasOwn ? c[l] : 0`.** A truncated ledger census that dropped `V` silently under-weights Level V in any *reader* of the stored census. The paying path recomputes from `levels` live; the stored census is disclosure. A holder checking their share against a truncated published census would think the denominator is smaller and their share larger. The writer always emits all five keys (`for (const l of LEVELS) c[l] = 0`). Only a hand-edit or a partial write produces the gap. Acceptable.

### O3. **The `|| true` on the base64 pipeline (R3-1) and the unquoted `WATCHED` interpolation (R1-4) are the two remaining "gate that cannot fail" shapes in this diff.** Neither currently lets money move. Both are the class this project is organised around.

---

## Verdict challenges

I am not challenging the pinned rejections:

- `pinnedAccountData` default `version = 1` — the omitting call is checked. I looked at the selftest, not at `anchor.mjs`, and the assertion is behavioural. Stand.
- MintVault regex truncation fails closed. Stand.
- `settledAsPayout` default pays sooner. Stand.
- Dust 2,099 is attained. Stand.
- `2026-02-30` is now refused. Stand.

I *am* challenging the self-audit claim that "clearing both [flags] is the repair" and that `finishedAt` being added makes the ordering complete. It does not: `resolvedBy` remains, and `finishedAt` is now deleted from days that already paid (R1-3, R7-2).

I am challenging the claim that the cron header is a complete money statement (R4).

I am challenging the claim that SPEC and the code now agree on disclosure figures (R6 dust).

---

## Findings summary

| id | sev | one line |
|---|---|---|
| R1-3 | **HIGH** | `supersede` deletes `finishedAt` on any day that still carries a no-pay flag, including a day that already paid |
| U1 | **HIGH** (docs) | control table's 2-of-2 row still omits MINT, the busier Bank-signed path |
| R1-1 | MEDIUM | `audit19.ts` still renders `${FLOORS.onchain}` as literal text in the R1 bullet |
| R2-3 | MEDIUM | refusal exit code 1 is not suppressed under `--dry-run`; paging surface on the halt anyone can trigger |
| R3-1 | MEDIUM | base64 round-trip is coreutils, not Node; `\|\| true` + missing `-w0` either refuses every tx or hides the reason |
| R4 | MEDIUM | header true of the two named money jobs; posture print reads `crontab -l` not `$TMP`; five jobs installed, two discussed |
| R6 | MEDIUM | SPEC still quotes 6,404 sats of dust; code now quotes 2,099 |
| R7-2 | MEDIUM | `resolvedBy` is a fourth unfinished-suppressor `supersede` does not clear |
| R5-4 | MEDIUM | the two detector arms do not prove the writer; comment says they do |
| R1-4 | LOW | dirty-tree pathspec is unquoted shell |
| R3-2 | LOW / unchecked | trailing newline on a legitimate `tx.b64` may fail the round-trip; confirm strip-before-check |
| R7-3 | LOW | `BankKeyOutside*` scrape still lists two of four programs |
| R1-2 / R5-3 | LOW | predicate / `codeOnly` brittleness, fail-closed |

No new on-chain theft. The mint payer-slot fix holds for the struct that exists. The money-path defects in this round are ledger-state and documentation, not a second spender.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Sixteen rounds of AI audit cannot do four things that are now the whole remaining risk, and SPEC's ship gate already names coverage, freeze, two clean rosters, and "rejected ⇒ assertion". Do these instead.

1. **Run the money jobs against a fixture ledger, not against prose.** `supersede`, `holdDays`, `decideEmission`, and the send loop have never been driven as one process with a real `distributions.json` through the orderings the prompt itself listed (quiet then pay then crash; pay then leftover flag then resume; dry-run between). A 20-line driver that writes those ledgers, execs `node bank/distribute.mjs` with the RPC stubbed, and diffs the ledger after, would have caught R1-3 in one run. AI will keep reasoning about flags. A ledger fixture will not.

2. **Render every audit prompt to a file and `diff` it against a golden.** The escaped-`${` class is invisible to `tsc` and to readers of source. `audit19.ts` still contains one. `node -e 'import("./scripts/audit19.ts")'` cannot run as written, but a `render-prompt.mjs` that prints `PROMPT` and fails if it matches `/\$\{FLOORS\.|\\\$\{/` is a one-hour gate. No model will reliably "render, do not read" when the instruction is inside the thing being rendered.

3. **Put one human on the disclosure card and the crontab, for one hour, before first activation.** The most expensive defects left are a wrong number on a card (SPEC still says 6,404) and a crontab that sends live cbBTC at 09:07 the morning after `./scripts/cron-install.sh`. AI has now described that crontab correctly twice and the header was still wrong once. A human who will receive the 09:07 page should read the five installed lines and the card figures. That is not an audit firm. It is the operator.

4. **Measure compute units on the real mint and the real redemption, once, on the cloned-Core validator.** Limit 12 is now the only unmeasured ceiling that can fail a Bank-signed transaction after the signature exists. One `simulateTransaction` per fixture (1/2/3 reserve mints; 1/N mints in one tx) writes a number the next round can pin. AI will not produce that number by reading Rust.

5. **Stop using the builder as a reviewer of the builder's last diff.** The self-audit found four real defects and then shipped a `supersede` that re-opens the same fail-open through a third flag, plus an audit prompt that re-commits the interpolation bug it exists to prevent. Independence here is a different process, not a longer comment. The ledger fixture in (1) and the render gate in (2) are that process. They do not get tired of the flag names.