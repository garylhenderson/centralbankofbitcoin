# INDEPENDENT AUDIT — ec7d17e..HEAD (round 20)

**Headline: no CRITICAL. I could not construct a theft or a fund-loss out of this diff, and I am not going to invent one.** What I did find is one fail-open of exactly the shape the diff was written to close (R1-1), one routine-path total halt of all payouts (R2-3), and a wrong customer-facing number introduced *by this diff* in two files under a claim of being asserted (R7-1). Everything else is graded honestly below.

Where I say "measured", I mean I re-derived it from the text in front of me and I state the arithmetic. Where I could not read a file, I say so instead of guessing — and that omission is itself a finding (R7-5).

---

## R1 — THE SELF-AUDIT'S OWN REPAIRS

### R1-1. HIGH — `supersede()` clears three flags. The detector has three suppressors. They are not the same three. `resolvedBy` survives.

**The construct.** `bank/distribute.mjs`:

```js
export function supersede(rec, nowIso) {
  const was = [rec?.refused, rec?.nothingToDo].filter(Boolean)
  ...
  delete out.refused
  delete out.nothingToDo
  delete out.finishedAt      // "THE THIRD MARK"
```

And its own doc comment, six lines above, quotes the arm correctly:

```
 *  `detectDistribution`'s unfinished arm is
 *      `startedAt && !finishedAt && !nothingToDo && !resolvedBy`
 *  so ANY of those three silences it.
```

The three suppressors named in the comment are `finishedAt`, `nothingToDo`, **`resolvedBy`**. `refused` is *not* a suppressor of that arm at all — it is the trigger for `distribution_refused`. So the code deletes one flag that the arm never reads and leaves one flag that the arm does read. **The comment names the correct set and the code implements a different set of the same size**, which is why this reads as fixed when it is not. This is round 18's defect and round 19's defect, third occurrence, inside the second repair for it.

**What an accident gains.** Day-level `resolvedBy` is a *sanctioned* workflow — `bank/selftest.mjs` blesses it twice:

```js
t('an UNFINISHED day can be resolved too, rather than nagging every 30 minutes forever', ...)
t('...and a refusal a human RESOLVED is settled, not re-raised', ...)
```

So the reachable ordering is: 09:07 refuses (`refused` + `nothingToDo` + `finishedAt`); the operator fixes `levels.json` **and** writes `resolvedBy: "gary: level assigned"` on the day record to silence `alarm.mjs`; re-runs distribute. `supersede` clears three flags, leaves `resolvedBy`, the plan is written, the process is SIGKILLed (OOM, reboot) before the first `done[v] = {...}`. Next day the record is `{startedAt, plan, resolvedBy, paid:{}}` → `distribution_unfinished` suppressed, `distribution_missed` silent because the day key exists, `distribution_unresolved` silent because there are no rows. **A day on which a plan was fixed and nobody was paid, with no finding, exactly as before the repair.**

**Evidence that would exist if I am right.** Run, in `bank/selftest.mjs`:

```js
D.detectDistribution({ days: { '2026-08-20': {
  startedAt:'x', resolvedBy:'gary: level assigned',
  plan:{activated:['v1','v2'],per:{v1:'100',v2:'100'},census:{},denominator:5,available:'200'},
  paid:{} } } }, { today:'2026-08-21' })
```
→ `[]`. And `supersede({refused:'x',nothingToDo:'y',finishedAt:'z',resolvedBy:'w'},'now').rec.resolvedBy` → `'w'`.

**Fix.** `delete out.resolvedBy` alongside the other three, and change the doc comment to say *why each of the four* is cleared, separating "suppressors of `distribution_unfinished`" (`finishedAt`, `nothingToDo`, `resolvedBy`) from "the prior verdict being recorded" (`refused`). Then add the arm that would have caught it: assert that after `supersede`, **no key remaining in the record appears in `detectDistribution`'s suppression predicate** — i.e. derive the list from the detector rather than typing it a third time. Concretely, export from `detectors.mjs`:

```js
export const UNFINISHED_SUPPRESSORS = ['finishedAt','nothingToDo','resolvedBy']
```
use it in the detector *and* in `supersede`, and assert `UNFINISHED_SUPPRESSORS.filter(k => k in sup.rec)` is `[]`. One fact, one place. Every previous repair here retyped the list.

---

### R1-2. MEDIUM — the money ledger's write path now depends on an undocumented aliasing property of a spread copy.

`main()` binds `const done = st.days[day].paid` **before** `supersede` replaces the record:

```js
const done = st.days[day].paid
...
const sup = supersede(st.days[day], new Date().toISOString())
st.days[day] = sup.rec
```

This works *only* because `supersede` does `{ ...rec }`, so `sup.rec.paid` is the same object `done` points at. Change `supersede` to `structuredClone(rec)` — a completely reasonable "make the pure function actually pure" edit — and every `done[v] = {...}; save(st)` writes into an orphaned object. The ledger then records that **nobody was paid on a day the transfers actually landed**, and the next run pays every activated vault a second time. `paymentState` cannot help: there are no rows.

**Evidence.** Replace the spread with a deep copy, run `distribute.mjs` against a fake cluster, and observe `distributions.json` with `plan` populated and `paid: {}` after successful sends. Nothing in the 427+79 assertions covers it, because `supersede` is tested as a pure function and `main()` is tested not at all.

**Fix.** Do not rebind: `st.days[day] = sup.rec; const done = st.days[day].paid` after the supersede (or have `supersede` mutate in place and return the flags it cleared). Then add the assertion that the writer and the reader see the same object.

---

### R1-3. MEDIUM — `scripts/audit19.ts`: the diff pathspec still cannot see `SPEC.md`, and this round's worst documentation defect is inside SPEC.

`const DIFF = git diff ec7d17e..HEAD -- programs bank scripts tests`. `SPEC.md` is bundled whole but its **change** is invisible. SPEC's `Cadence` paragraph carries a `⚠️ Round 19` note, so SPEC *was* edited this round — and that edit is where R7-1's wrong number lives. The `dirty` check was widened to include SPEC (correct); the diff was not. So the round can detect an *uncommitted* SPEC edit and cannot show a *committed* one.

**Fix.** `git diff ec7d17e..HEAD -- programs bank scripts tests SPEC.md` (or derive the pathspec from `WATCHED`, which is already computed from `TARGETS` — the two lists are one fact stored twice, which is the defect this file lectures about).

---

### R1-4. LOW — manifest record is well-formed; two nits.

`dirty.split('\n').filter(Boolean)` on untrimmed porcelain output produces a clean array (the trailing `''` is filtered) and preserves the two-char status field. `if(dirty)` is correctly falsy on a clean tree. Two nits: (a) porcelain without `-z` splits a filename containing a newline into two bogus entries; (b) `WATCHED` is interpolated unquoted into `execSync` — harmless for these paths, but it is a shell injection sink one `TARGETS` entry away. Use `-z` and pass the pathspec as an argv array via `execFileSync`.

### R1-5. LOW — `disqualify()`'s new whitelist has a hole in the direction of *counting a corpse*.

`if(o.finish && o.finish!=='stop')` — a provider that omits `finish_reason` entirely (`undefined`) skips the whitelist and falls through to the length/repetition heuristics, which is precisely the "enumeration of last round's failures" the comment says it replaced. Make it `if(o.finish!=='stop') return ...` so a *missing* terminal reason is also disqualifying.

### R1-6. Template-literal / escaping check — rendered, not read.

I rendered the prompt I was given and compared it to `audit19.ts`. The four `\${...}`-style escapes are intentional (they describe the previous defect) and render as literal placeholders as designed. `\$CBOB`, all `\`backticks\``, and `\${FLOORS.onchain}` in the R1 bullet render correctly. The five real interpolations (`${FLOORS.*}`, `${DIFF}`, `${BUNDLE}`) all rendered with values — the header reads "286-assertion suite ... 427 ... 79 ... 19". **No new template defect found.** One structural note: nothing *tests* this. The only reason it was caught last time was a human reading the output. Add a one-line gate: `if(/\$\{[A-Za-z_]/.test(PROMPT)) throw` before spending tokens — an unrendered placeholder in the shipped prompt is mechanically detectable and currently is not detected.

---

## R2 — THE ROUND-18 OFF-CHAIN REPAIRS

### R2-1. The `settledAsPayout` default direction is CORRECT. Derivation, so nobody re-opens it.

Not resetting the clock ⇒ larger `holdDays` ⇒ larger `daysSinceLastPayout`. In `decideEmission` the only branch that reads it is `if (daysSinceLastPayout >= maxHoldDays) return { pay:true, forced:true }`. Larger crosses `31` sooner. So a bare `resolvedBy` pays **earlier**, and `resolvedAs:'paid'` (resetting) pays **later**. The default is conservative in the direction that pays holders. Confirmed independently; the pinned assertion is measuring the right thing.

### R2-2. HIGH — `resolvedAs` created a state that means "nothing landed" and is then silently never paid, with no finding.

`paymentState` returns `'resolved'` for any row with `resolvedBy`, whatever `resolvedAs` says. Consequences for a row `{sig:null, resolvedBy:'gary: nothing landed', resolvedAs:'unpaid'}`:

* the payment loop: `if (state === 'resolved') continue` → **never re-sent, ever, on any later day**;
* the fee floor: `paymentState(row)==='unpaid'` is false → not budgeted;
* `detectDistribution`: `unresolved` filter excludes it (`!r.resolvedBy`), `refused` filter excludes it → **no finding at any severity**;
* `settledAsPayout`: false → correctly not a payout day.

So the field the round-18 repair *taught the operator to write* has a value which asserts, in the operator's own words, that a holder was not paid — and the system's response is permanent silence. The `paymentState` comment says "a human who wants it retried deletes the row", but that instruction predates `resolvedAs` and is nowhere near it.

Second half of the same defect: `resolvedAs:'paid'` **only works in combination with `resolvedBy`**. `{sig:null, resolvedAs:'paid'}` alone → `paymentState` = `'ambiguous'` → `settledAsPayout` false, row reported as `distribution_unresolved` CRITICAL forever. And any typo (`'Paid'`, `'PAID'`, `'hand-paid'`) silently means "not paid". Nothing validates the field.

**Evidence.** `paymentState({sig:null,resolvedBy:'x',resolvedAs:'unpaid'})` → `'resolved'`; `detectDistribution({days:{'2026-08-20':{startedAt:'x',finishedAt:'y',paid:{v1:{sig:null,resolvedBy:'x',resolvedAs:'unpaid'}}}}},{today:'2026-08-21'})` → `[]`.

**Fix.** (a) Refuse an unrecognised `resolvedAs` at load (`'paid'|'unpaid'` only) the same way `loadLevels` refuses an unrecognised level. (b) Make `resolvedAs:'unpaid'` mean *retryable*: `paymentState` returns `'unpaid'` for it, so the next run re-sends. That is the only reading that matches the words. (c) Have `detectDistribution` raise a finding for any resolved-unpaid row that is still unpaid N days later. (d) Document in the `paymentState` comment that `resolvedAs` requires `resolvedBy`.

### R2-3. HIGH — the refusal that now pages is on the ORDINARY customer path, not on an attacker's path, and it halts every payout.

`allocateWeighted` sets `refusal: true` when any activated vault has no entry in `levels.json`. `levels.json` is a static file a human edits. A customer who funds their vault to 21,000 sats at 09:06 causes the 09:07 run to pay **nobody**, write `refused`, SMS the operator, and exit 1 — and repeat every day until a human edits the file. Round 17 accepted the halt on the argument that it is "the RECOVERABLE failure"; that argument assumed the trigger was exceptional. It is the activation path, i.e. the thing the product is for. Adding NOTIFY + `exitCode 1` in this diff converts a routine event into a page, and `alarm.mjs` raises `distribution_refused` HIGH every 30 minutes for the same condition — **two independent paging paths for one routine, permissionless trigger, with no dedupe and no rate limit.** A pager that fires on the happy path is a pager that gets muted, and the thing it is muted for is `vault_left_index`.

**Evidence.** Mint and fund a vault, do not touch `levels.json`, run `bank/distribute.mjs`: `refused` written, `sent = 0`, exit code 1, SMS sent; then `bank/alarm.mjs` returns `distribution_refused` at HIGH on every pass.

**Fix (owner decision, two acceptable answers).**
1. *Preferred:* make an activated vault with no register entry receive the **minimum** level (I, weight 2) and record that assignment durably in `levels.json` as the assignment. Nobody is overpaid (2 is the floor), no holder is blocked, the halt disappears, and the odds promise is preserved for every vault the register *does* cover. This conflicts with "assigned by fate" only if the register is meant to be written before activation — which is exactly what limit 16's commitment scheme would establish, so build them together.
2. *If the halt is kept:* rate-limit the page to once per (day, cause), and add a pre-flight — `alarm.mjs` should raise `levels_register_incomplete` at HIGH **the pass an unlevelled activated vault appears**, hours before 09:07, so the halt is prevented rather than reported.

Either way: `--dry-run` must not set `process.exitCode = 1`. A dry run's job is to report, and a non-zero exit from the installed cron line (which may legitimately carry `--dry-run`) is noise a human learns to ignore.

### R2-4. `census()`/`denominator()` round-trip: no defect found.

`census` returns `{ ...Object.create(null) }`, i.e. a normal-prototype object; `JSON.stringify` works, the ledger round-trip works, `plan.census[l] || 0` and the resume path (`census: st.days[day].plan.census`) both work. `denominator(c ?? {})` tolerates `undefined`. I found no consumer that needed a null prototype or was broken by getting a normal one. The one remaining asymmetry: `denominator` guards its input, `census` does not guard against `levels` being an array or `null` (`Object.values(null)` throws) — `loadLevels` already refuses those, so this is belt-and-braces only.

### R2-5. Dust bound: re-derived, the corrected figure is right; the WORD "retains" is not.

`per[v] = floor(a·w_v/D)`, so `Σper = Σ(a·w_v/D − f_v) = a − Σf_v` with `f_v ∈ [0,1)`. Hence `dust = Σf_v < N` where `N = activated.length`, and being an integer, `dust ≤ N−1`. Attained at `a = D−1`: `floor((D−1)w/D) = w−1` for every `0<w<D`, so `Σper = D−N` and `dust = N−1 = 2099`. **`dust < activated.length` is unconditionally true on every path that returns a real `dust`** — the `available <= 0`, `smallest < min`, empty and refusal paths all return `dust: 0n`. It holds when `available < N` (then most `per` are 0, `f_v = a·w/D < 1`, and `dust = a < N` trivially).

But: a settlement *retains* `dust` **plus** the share of every vault the payment loop skipped (`skipped:'vault is no longer a live Core asset'`) or left ambiguous. Those can each be arbitrarily large. The corrected comment says the old text "overstated what a settlement RETAINS by about threefold" — `dust` is not what a settlement retains. **The corrected sentence is now an under-claim about retention in a document whose whole point is not to under-claim.** Fix: say "the allocator's rounding remainder is `< activated count`; a settlement additionally retains the share of any vault it skipped".

---

## R3 — `scripts/bank-sign.sh`

### R3-1. MEDIUM — the canonicality check is GNU-coreutils-only, the comment says "no new dependency", and on a non-GNU host it refuses EVERY legitimate transaction.

```sh
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
if [ "$CANON" != "$TX" ]; then ... exit 2; fi
```

`base64 -w0` is a GNU extension. On macOS/BSD `-w` is not a valid option → both stderr streams are discarded → `CANON=''` → **every input is refused as "not CANONICAL base64"**. `base64 -D` vs `-d` differs on older BSD too. The comment claims "No new dependency"; it added two. The `2>/dev/null || true` pair converts a *missing tool* into a *rejected transaction* with a message that blames the operator's paste.

This is availability, not safety — the failure is closed. But the file is documented as the one sanctioned path to a Bank signature, so on the wrong host that path is *shut* and the operator's only recourse is to sign by hand, which is the thing the whole file exists to prevent.

**Evidence.** On any non-GNU `base64`, `./scripts/bank-sign.sh tx.b64` on a valid 1644-char transaction exits 2.

**Fix.** Assert the tooling once, up front, with a message that names the real problem:
```sh
printf 'AA==' | base64 -d >/dev/null 2>&1 && printf 'a' | base64 -w0 >/dev/null 2>&1 \
  || { echo "this script needs GNU coreutils base64 (-d and -w0); install coreutils" >&2; exit 2; }
```

### R3-2. Does it accept an input that decodes to something other than what was pasted? No — I could not break it.

Whitespace is stripped first, so the round trip and Node see the identical string. The alphabet filter guarantees no character that Node's decoder would silently drop. Length%4 and "no `=` before the end" are subsumed by the round trip. Since `TX` is byte-identical to the canonical re-encode of its own decode, GNU's decode and Node's decode agree. `$( )` stripping any trailing newline from `base64 -w0` is harmless. `set -euo pipefail` + `|| true` around the substitution fails closed (partial/empty `CANON` ≠ `TX`). `[:space:]` is locale-sensitive but no base64 character is whitespace in any locale. **I have no counterexample.**

### R3-3. Does it reject anything legitimate? Only via R3-1.

1232 bytes → 410 full triplets (1640 chars) + one padded quantum = 1644 chars, canonical, accepted. Wrapped pastes are repaired before the check. No false rejection found on a GNU host.

### R3-4. MEDIUM — the newest control in the wrapper is the only one in the file with no gate, in the round that invented the technique to gate it.

`bank/selftest.mjs` gained a harness that **executes** a slice of `cron-install.sh` against fixtures, with a comment explaining that text-reading arms are structurally blind to behaviour. That technique was not applied to the base64 check one file over. `grep -c base64 bank/selftest.mjs` → 0. So the five measured accept-cases (`====`, `A===`, `AB==`, `AAB=`, `AAAA====`) and the 1644-char accept-case exist only in a comment.

**Fix.** Extract the check into a function or run the script directly with fixtures, in the same style as the `resolve()` harness: assert all five malformed strings exit 2, and that a real 1644-char canonical string exits 0 up to the `cd` (use a stub `node` on PATH).

### R3-5. LOW — the corrected `ps` comment is substantively true but does not quote the line it quotes.

The comment says the last line is `exec node bank/cosign.mjs --tx "$TX"`. It is `exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ${LIVE[@]+"${LIVE[@]}"}`. The claim (the base64 transaction is in the co-signer's argv and therefore in `ps`) is correct — argv appears for both `env` and `node`. Make the quote verbatim, since the file's own gates scrape that exact line and a future reader will diff the two.

---

## R4 — `scripts/cron-install.sh`

### R4-1. Every installed job, enumerated. The header's two-job claim is complete but two of its statements are not verifiable from this bundle.

| line | job | can it move money as installed? |
|---|---|---|
| `23,53 * * * *` | `alarm.mjs` | No. Reads chain, writes `state.json`, notifies. |
| `7 9 * * *` | `distribute.mjs$DIST_DRY` | **Yes**, unless `--dry-run` was preserved. Verified in source: every send is behind `if (DRY) { console.log('would send'); continue }` and every `save` behind `!DRY`. |
| `41 */6 * * *` | `revenue.mjs$REV_LIVE` | Claimed no without `--live`. **I cannot verify this: `bank/revenue.mjs` is not in the bundle.** |
| `19 4 * * *` | `alarm.mjs --reconcile` | No. |
| `9 */2 * * *` | deadman: `test`/`find` + `notify-gary-sms.sh` | No. |

`crontab -l \| grep -cF '$TAG'` = 5 ✓. So the header's enumeration (two money jobs) is right and the count check is right. Two caveats: the header's "distribute … loads the distributor key and sends cbBTC for real" is conditional on `keys/distributor.json` existing (`fs.statSync` throws otherwise), on `levels.json` existing, on `config.treasury == distributor`, and on the cadence gate — i.e. it is *scarier* than reality, which is the correct direction for a warning. And **nothing gates the revenue claim**: the selftest asserts `$REV_LIVE` is interpolated, not that `revenue.mjs` without `--live` is inert. That is the one claim in the new header a reader must take on trust, and it is the claim about the trusted hop.

### R4-2. MEDIUM — `ours()` reads OUR LINES, not OUR LINE. A note after the tag on any tagged line arms `--live` on the trusted hop.

```sh
ours() { grep -F "$TAG" <<<"$CUR" | grep -v '^[[:space:]]*#'; }
if ours | grep -q 'revenue\.mjs --live'; then REV_LIVE=' --live'; fi
```

`ours` returns **all five** tagged, uncommented lines and the flag test is applied to the union. And `$TAG` is itself `#cbob-vault-cron`, i.e. a **shell comment** — that is how the tag survives. So any text an operator appends *after the tag* is a functioning trailing comment on a tagged, non-`#`-prefixed line. Therefore:

```
41 */6 * * * cd /opt/cbob-vaults && node bank/revenue.mjs >> log 2>&1 #cbob-vault-cron revenue  DO NOT run revenue.mjs --live yet
```

arms `--live`. So does the same note appended to the *watcher* line. This is the identical defect the block was written to close — text expressing the opposite intent read as consent to arm money — reached through a trailing comment instead of a leading one. The selftest's own comment, twenty lines away in `bank/selftest.mjs`, states the general lesson ("stripping comment LINES … leaves a TRAILING comment"); it was applied to the exec-line arm and not here.

**Evidence.** Add the fixture above to the existing `resolve()` harness: it returns `' --live|'`.

**Fix.** Scope to the line *and* to the command portion:
```sh
ours() { grep -F "$TAG" <<<"$CUR" | grep -v '^[[:space:]]*#'; }
cmd_of() { sed "s/${TAG}.*//"; }                 # everything before the tag
if ours | grep -F "$TAG revenue" | cmd_of | grep -q -- '--live'; then ...
```
Note the *reporting* block at the bottom already does this correctly (`grep -F "$TAG distribute"`), so the file contains both the right and the wrong scoping.

### R4-3. MEDIUM — the preservation covers two flags out of N operator edits, and the header does not say the rest are discarded.

`grep -v "$TAG"` deletes every tagged line and the heredoc rewrites them from the template. Preserved: `--live` on revenue, `--dry-run` on distribute. **Silently reverted:** a changed schedule (an operator moving distribute off 09:07 to avoid overlap with something else), a `MAILTO=`/env prefix, an added `nice`/`ionice`, a redirected log path, an added flag we invent later. The new header says the two flags "are both PRESERVED"; it does not say a re-run destroys every other deliberate edit. That is the same class as the `--dry-run` defect: a re-run silently discarding operator intent about a money job.

**Fix.** Before writing, diff each removed tagged line against the line about to replace it and print/refuse on any difference other than the two known flags:
```sh
echo "$CUR" | grep -F "$TAG" | while read -r l; do
  grep -qxF "$l" "$TMP" || echo "REPLACING: $l"; done
```
An installer that rewrites a money crontab should show what it is discarding.

---

## R5 — THE GATES

### R5-1. `isTableRow` — sound enough today, brittle for one character, and it is a document-wide grep.

`/^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/` requires: pipe, **space**, at least one earlier column, and the classification bolded **with the period inside the bold**. Table shapes it misses: `|**BOLD** | ... | **ON-CHAIN.** ...|` (no space after the leading pipe), a leading-space-indented row (legal Markdown), a classification written `**ON-CHAIN**.` (period outside the bold), or a classification in the *first* column. All of those fail **closed** now that `EVERY row in the control table block carries a classification` exists — a real control row in a slightly different format turns the build red rather than passing unchecked. That is the right direction.

The residual issue: `tableRows(specSrc)` and `tableLines(specSrc)` scan the **whole document**, not `controlTableBlock`. SPEC's legend table one screen above uses `| **ON-CHAIN** | a program refuses…` and escapes ingestion only because the period is outside the bold. Any future table using `**PROCEDURE.**` is silently treated as a control row and checked against cron. **Fix:** feed `tableRows` the block, not the file — `controlTableBlock` already exists.

### R5-2. MEDIUM — the `MintVault` arm proves *declaration order*, and `MINT_IX_BANK_IDX` needs *account order*. The two diverge silently the day someone uses a composite `Accounts` struct.

`mintVaultFields` counts `^\s*pub (\w+):` lines. Anchor flattens a nested `#[derive(Accounts)]` field into several runtime accounts while contributing **one** `pub` line. Insert `pub common: CommonCtx<'info>,` (2 accounts) before `bank`, and the parse says `bank` is at 5 while the runtime index is 6. The gate then *demands* `MINT_IX_BANK_IDX = 5` — and once someone obliges, the confinement exempts the wrong slot and the suite is green. The gate would be actively steering the constant wrong.

The regex-truncation question the diff already answered is answered correctly (before `bank` → `-1` → red; after `bank` → index unchanged), so that part is fine.

**Fix.** Pin the constant against the **built instruction**, not the source text. `tests/3prog.test.ts` already constructs the exact `keys` array; add one line there:
```ts
rec('3.1b4','MINT_IX_BANK_IDX is the real account index of bank','MATCH',
    keys[MINT_IX_BANK_IDX].pubkey.equals(bank.publicKey)?'MATCH':'MISMATCH')
```
with `MINT_IX_BANK_IDX` scraped from the Rust. That is the property the confinement rests on; the struct parse is a proxy for it.

### R5-3. `codeOnly` for shell — correct for this file, and the "exactly one candidate" mitigation holds, but the two arms use different regexes.

A `#` that is not a comment: a shebang (stripped, harmless here); a line inside a heredoc body (`cron-install.sh` has such lines — `codeOnly` is only applied to `bank-sign.sh`, which has none); `${#var}` or a `case` pattern beginning with `#` at line start (neither occurs). So `codeOnly(signSh)` is correct **today**, and correctness depends on a property of one file that nothing asserts.

The count arm uses `/^\s*exec .*cosign\.mjs.*$/gm` (anchored); the tamper uses `/exec .*cosign\.mjs.*$/m` (**unanchored**, so it can match mid-line). So "there is exactly ONE candidate" is proven for a pattern the tamper does not use. If a mid-line `exec … cosign.mjs` ever appears earlier in the file, the tamper lands there, the strict regex still matches the real line, and the assertion goes red — fail-closed, but with a message that sends the reader hunting for the wrong thing. **Fix:** use one anchored regex for both, defined once.

### R5-4. MEDIUM — the two new `nothingToDo` arms do not prove what their comment claims.

```js
t('a half-finished day raises the alarm...', detect({... startedAt:'x', paid:{v1:{sig:'abc'}, v2:{sig:null}} ...})
   .some(f=>f.kind==='distribution_unfinished'), true)
t('...and a STALE nothingToDo would silence it', detect({... nothingToDo:'holding: quiet morning', paid:{v1:{sig:'abc'},v2:{sig:null}} ...})
   .some(f=>f.kind==='distribution_unfinished'), false)
```

The comment above them says the consequence is "a half-finished day with unpaid holders goes **silent**". For **this fixture it does not**: `v2:{sig:null}` with no `skipped`/`rejected`/`resolvedBy` raises `distribution_unresolved` at **CRITICAL** regardless of `nothingToDo`. So the arms prove "`distribution_unfinished` is suppressed" and the comment asserts "the day goes dark", which is false of the case chosen. The genuinely silent case is a crash with **zero rows written** — which is exactly the fixture `distribute.mjs`'s own new arms use (`crashed = {plan:{…}}`, no `paid`). One file got the fixture right and the other got the narrative right.

**Fix.** Change the selftest fixture to `paid: {}` (matching the real silent case) and assert the *full* finding list is `[]`, not just `.some(unfinished)`. A `.some()` on one kind cannot support a claim about silence.

### R5-5. LOW — `errNames` still has a fail-open, in the arm rewritten this round to close a fail-open.

The variant regex `^\s*(?:#\[msg\("[^"]*"\)\]\s*)?(\w+),\s*$` drops a variant whose message contains an escaped double quote (`[^"]*` terminates early), and drops any variant with an explicit discriminant (`Foo = 5,`). A dropped `BankKeyOutside*` variant is invisible to `bankErrs`, and "every Bank-confinement refusal is NAMED in the control table" passes over a refusal that is not named — the exact fail-open the round-19 note says it fixed, reached through the message body instead of the attribute. The enum-body regex `[\s\S]*?\n\}` also truncates at the first line-initial `}` inside the enum (none today).

**Fix.** Strip `#[...]` attributes first (a small balanced-bracket scan or a line filter), then take identifiers, and assert the variant **count** against a hand-maintained expected number per program (the comment already claims 16/33/21/17 — turn that claim into four assertions and the whole class closes).

### R5-6. MEDIUM — the equality floors are the defect the same commit diagnosed and fixed elsewhere.

This diff contains, in one commit:

* `rows.length === 5` → `rows.length >= 5`, with the reasoning: *"AN EXACT COUNT PENALISES TELLING THE TRUTH… a gate that fails when the documentation becomes MORE ACCURATE"*; and
* three `<` floors → `!==` equality, with the reasoning *"a `<` check accumulates slack"*.

Both reasonings are correct in isolation and the second fix has the property the first fix was removed for: the cheapest way to keep the build green after a repair is now **not to add an assertion**, because adding one turns four files red (`run-tests.sh`, the file's own `FLOOR`, and up to three numbers in SPEC). In a project whose ship gate requires a failing gate for every accepted finding, a per-assertion tax on adding gates is a bad incentive.

**Fix.** Keep `>=` for the "did it stop early" property and get the anti-slack property without the tax: **stop storing the count twice.** `run-tests.sh` should read the floor out of the file it is gating (`grep -oP 'const FLOOR = \K\d+' bank/selftest.mjs`), and the file's `FLOOR` should be checked as `R.length >= FLOOR` plus a separate, non-fatal `SLACK` report (`echo "slack: $((n-floor))"`) that a pre-commit hook turns into an error only when it is a *commit* that leaves slack. The diff already added an arm asserting the two copies agree — that arm is an admission that the fact is stored twice; delete one copy instead.

---

## R6 — COUNTS AND ARITHMETIC, INDEPENDENTLY

**Floors, verified against the files in this bundle:** `MIN_ASSERTIONS=286`, `DET_FLOOR=427`, `ALLOC_FLOOR=79`, `MAINNET_FLOOR=19` (`scripts/run-tests.sh`); `const FLOOR = 427` (`bank/selftest.mjs`); `const FLOOR = 79` (`bank/distribute.mjs`). The prompt header's 286/427/79/19 match. SPEC's gated block matches (`# 286 assertions, real cloned Core`, `(+ 427 detector, 79 allocation and 19 live-mainnet`). ✓

**Schedule, re-derived from the weights only:**
- 108+60+36+24+12 = 240 ✓; 108·2+60·3+36·4+24·5+12·6 = 216+180+144+120+72 = **732** ✓
- 945+525+315+210+105 = 2100 ✓; 1890+1575+1260+1050+630 = **6405** ✓
- per $1,000 @732: 2.7322/4.0984/5.4645/6.8306/8.1967 → **2.73 4.10 5.46 6.83 8.20** ✓
- per $1,000 @6405: 0.31226/0.46838/0.62451/0.78064/0.93677 → **0.31 0.47 0.62 0.78 0.94** ✓
- shares @6405: 189000/157500/126000/105000/63000 over 6405 = 29.508/24.590/19.672/16.393/9.836 → **29.5 24.6 19.7 16.4 9.8**, exact sum **100.0%**, and the *rounded* five also sum to 100.0 ✓
- V/I = 6/2 = **3** ✓

All ten card figures and both denominators reproduce. **No arithmetic error in the schedule.**

### R6-1. MEDIUM — SPEC carries three assertion counts that no gate reads, all stale, beside a comment claiming four numbers are gated.

| SPEC text | says | real |
|---|---|---|
| `node bank/distribute.mjs --selftest   # 63 allocation assertions` | 63 | **79** |
| "Every detector is proven in BOTH directions by `bank/selftest.mjs` (69 assertions)" | 69 | **427** |
| SHIP GATE table: "The 270-assertion suite runs against real mainnet Core" | 270 | **286** |

The gate reads exactly three numbers (`# N assertions, real cloned Core`, `(+ N detector`, `N allocation and \d+ live-mainnet`) and SPEC's own warning says **"THESE FOUR NUMBERS MOVE WITH THE FLOORS"** — `MAINNET_FLOOR` is matched by the regex but never captured or asserted, so three are gated, not four. So the document that is the single source of truth about what runs states the allocation count as both 63 and 79, one gated, and understates its own detector suite by 6×.

**Evidence.** `grep -n '63 allocation\|69 assertions\|270-assertion' SPEC.md`.

**Fix.** Gate all four (including mainnet), and gate *every* occurrence of each number rather than one blessed phrasing: scan SPEC for `\b(\d{2,4})\s+(?:allocation|detector|assertions?)\b` and require every hit to be one of the four floors. Better: generate that block.

### R6-2. LOW — the equality gate's own justification does not survive its arithmetic.

`run-tests.sh` says "the on-chain suite really produced 286 while MIN_ASSERTIONS said 284 … Two assertions could then have been deleted for free". This diff itself adds exactly two on-chain assertions (`rec('9d.4',…)` and `because('9d.4',…)`). So the 284→286 gap is consistent with *this diff's own additions* having landed one commit before the floor was moved, not with a floor that "sat two under its real count for a whole round". Not a code defect, but the change was justified by a measurement whose provenance is ambiguous — and now that the gate demands equality, `MIN_ASSERTIONS=286` must be the output of an actual run, not an inference. **Ask for the run artifact** (`scripts/run-tests.sh` tail) alongside this commit; with an equality gate, an unverified count means the build is red or green by luck.

---

## R7 — WHAT THE SELF-AUDIT MISSED

### R7-1. HIGH — the round-19 disclosure of the payout floor is wrong by 2×, in two files, under a claim of being asserted. The system is TWICE as good as its own new documentation says.

New in `bank/distribute.mjs` (`MAX_HOLD_DAYS`):

> *"At the published 2,100-vault census that floor is a denominator's worth — **6,405 sats**. Asserted in BOTH directions in `bank/selftest.mjs`."*

New in `SPEC.md` (Cadence):

> *"Below one satoshi per vault — a denominator's worth, **6,405 sats** at the 2,100-vault census — `decideEmission` returns 'nothing to distribute'."*

Three separate errors in that clause.

**(a) The number is wrong.** The gate is `smallestPer >= MIN_PER_VAULT (1)`, and `smallestPer = floor(available · w_min / D) = floor(available·2/6405)`. That is ≥ 1 iff `available ≥ ⌈6405/2⌉ = **3,203**`. Check: at 3,202 → `6404/6405` → 0 → no pay, unbounded wait. At 3,203 → `6406/6405` → 1 → the 31-day ceiling **fires**. So the true floor is **3,203 sats**, and the published figure overstates the pool a holder must wait for by 2.0×.

**(b) "One satoshi per vault" is a third, different number.** At 2,100 vaults, "one sat per vault" is 2,100 sats — at which a Level I vault receives `floor(2100·2/6405) = 0` and nothing is forced. So the clause equates 2,100, 3,203 and 6,405 as the same quantity.

**(c) The assertion it cites does not exist.** `bank/selftest.mjs` contains no arm on the emission floor at all. The nearest arms are in `bank/distribute.mjs`'s selftest and they are stated in terms of `smallestPer` (`0n` never fires, `1n` fires at the ceiling) — they never touch a pool size, a denominator or 6,405. So the sentence names a control, in a file, that does not run there. **Ninth-plus round of that class, committed in the paragraph written to correct an over-claim.**

**Why this is the third target's shape.** It is an **under-claim**: the correction was written to stop over-promising ("no holder ever waits longer than a month even at zero volume"), and it over-corrected into telling holders the ceiling is dead below 6,405 when it is live from 3,203. Nothing in this repository is instrumented to catch a disclosure that makes the product look worse than it is.

**Evidence.** In `bank/distribute.mjs --selftest`:
```js
allocateWeighted(bals2100, levels2100, 3202n).skip !== null   // → true  (no pay)
allocateWeighted(bals2100, levels2100, 3203n).skip            // → null  (pays)
decideEmission({smallestPer: allocateWeighted(bals2100,levels2100,3203n).per['v0'],
                daysSinceLastPayout: 31}).forced               // → true
```
and `grep -c '6,405\|6405' bank/selftest.mjs` → 0.

**Fix.** Publish the derived quantity, do not type it: `EMISSION_FLOOR_SATS = ceil(denominator / min(LEVEL_WEIGHTS))`, print it in the settlement line, quote it in SPEC from one place, and assert both sides (`floor-1` holds, `floor` fires) in the file the comment names. Then re-read the sentence: it is the only figure on the customer card that tells a holder how long they may wait.

### R7-2. MEDIUM — the claim "`paymentState` is the ONE authority" is false. `detectDistribution` hand-rolls a fourth copy, in another file, with a *different* definition.

`bank/detectors.mjs`:
```js
const unresolved = rows.filter(([, r]) => !r.sig && !r.skipped && !r.rejected && !r.resolvedBy)
const refused    = rows.filter(([, r]) => r.rejected && !r.resolvedBy)
```
This is the predicate round 17 removed from `holdDays` with the reasoning *"`paymentState` is the ONE authority on what 'paid' means… This function re-derived that fact with a poorer copy."* The re-derivation is still live one file over, and the two definitions **disagree**: `paymentState` does not know about `skipped` at all (a `{sig:null, skipped:'burned'}` row reads `'ambiguous'`), while `detectDistribution` does; and `detectDistribution` does not know about `resolvedAs`, which R2-2 shows matters. So `skipped` is handled ad hoc at three sites (payment loop, fee floor, detector) and `resolvedAs` at one.

**Evidence.** `grep -n paymentState bank/detectors.mjs` → nothing. `paymentState({sig:null,skipped:'x'})` → `'ambiguous'`, not `'skipped'`.

**Fix.** Move `paymentState` into a shared pure module (`bank/rows.mjs` — it cannot live in `distribute.mjs`, which imports web3 at module scope) and have `detectDistribution` call it; make `skipped` a returned state and `resolvedAs` part of the answer. Then add the gate: every file that reads `.sig`, `.rejected`, `.skipped` or `.resolvedBy` off a payment row must import that function — a source scan in the same style as the existing `judgeDasEnvelope` discovery arm, which found a third DAS reader nobody knew about.

### R7-3. MEDIUM — known limit 3 is now FALSE for MINT, and SPEC's control-table row still describes the pre-round-18 confinement. Under-claim, third-target shape.

Limit 3 as carried into this round: *"The Bank may still be named `payer` INSIDE the pair itself; the confinement exempts both approved instructions entirely."* After this diff, MINT's exemption is **positional**, not whole-instruction:
```rust
for (n, a) in ix.accounts.iter().enumerate() {
    require!(a.pubkey != bank || n == MINT_IX_BANK_IDX, MintError::BankKeyOutsideMint);
}
```
Test 9d.4 measures it: the Bank named as `payer` of a real mint is **REJECTED**. So the exemption no longer covers "the whole instruction" for mints. SPEC's row still says only *"`programs/cbob-vault-mint/src/lib.rs` refuses `BankKeyOutsideMint` **outside** a `mint_vault`"*, and `bank/cosign.mjs`'s header repeats the same phrasing. A buyer or an operator reading either one is told the Bank may be the payer of a mint — which is the exact theft round 18 measured, and which the programs now refuse. Same defect as the co-signer row the owner caught: the table describes a weaker control than the one that ships, and no gate can see it (the gate only checks that the row's *classification* matches the Rust, never that the row's *description* is as strong as the Rust).

**Fix.** Rewrite the row to say "…refuses `BankKeyOutsideMint` unless the instruction is a `mint_vault` **and** the Bank's key appears only in the `bank` slot — so the Bank cannot be the `payer` of a mint (measured, 9d.4)". Update `cosign.mjs`'s header and the carried limit 3 to scope it to SEAL/BURN. And note the direction: for the pair, naming the Bank as BURN's `payer` *credits* the Bank (rent refund), so limit 3's residue is benign; say that too rather than leaving it as an undifferentiated limit.

### R7-4. MEDIUM — mints have an on-chain account-list confinement and NO fee-payer control of any kind. Limit 1a is worse than stated for the busier path.

Limit 1a says the fee-payer check "is off-chain, in `judgeRedemptionTx`". `judgeRedemptionTx` judges **redemptions**. For a mint there is no off-chain judge, no `bank-sign.sh`-equivalent, and nothing in `bank/` that inspects a `mint_vault` before the Bank signs it (`grep -rn mint_vault bank/` → nothing). The fee payer appears in no instruction's account list, so the new on-chain walk cannot see it, and a priority fee is unbounded. The Bank must sign every mint, so this is not reachable without the Bank's cooperation — but the Bank's mint-signing *policy* is the one signing path that does not exist yet, while the tree has an elaborate one for the rarer path. Round 17's own argument for calling MINT the CRITICAL ("a redemption happens once at exit; a mint happens at every activation") applies unchanged to the half that was left open.

**Fix.** Before any mint is co-signed: add `judgeMintTx(ixs, {mintProgram, bank, mintDisc, bankIdx, feePayer, allowedPrograms})` mirroring `judgeRedemptionTx`, and a `scripts/bank-sign-mint.sh` that is the only invoker. Until then, state plainly in SPEC that **the Bank has no published policy for signing a mint** — right now that is a gap the control table does not mention at all.

### R7-5. MEDIUM — the "ONE list drives both the bundle and the check" fix delivers the files the targets NAME, not the files those targets DEPEND on. Same defect, one level up.

`TARGETS` (offchain) = `distribute.mjs`, `cosign.mjs`, `bank-sign.sh`, `cron-install.sh`, `selftest.mjs`, `detectors.mjs`, `SPEC.md`. R5 asks me to audit `selftest.mjs`, which asserts against **`bank/anchor.mjs`** (the new `pinnedAccountData` arms), **`bank/lock.mjs`** (≈40 arms), **`bank/spl.mjs`**, **`bank/alarm.mjs`** (source-scraped: `if (s.err) continue`) and **`bank/revenue.mjs`** (the signer-set arm). None was delivered. R4 asks whether the header's money claim is "true, completely" — the revenue half is unverifiable for the same reason (R4-1). The two findings this round pinned as refuted were refuted by `anchor.mjs`, which is *still* not in the bundle.

**Evidence.** The bundle I received contains six files; `bank/selftest.mjs` imports five modules, four of which are absent.

**Fix.** Compute the bundle as the transitive closure: for each target, add every local `import`/`readFileSync('/opt/cbob-vaults/…')` path it references, then assert the closure is delivered — the same `throw before spending tokens` treatment the current check gets. `selftest.mjs`'s own source-scraping arms name their files as string literals; harvest those.

### R7-6. Other fixes checked for one-of-N. Results.

| fix in this diff | all sites? |
|---|---|
| `Object.hasOwn` (`census`, `denominator`, `allocateWeighted`, `loadLevels`) | **Yes** — four sites, all covered. |
| equality floors (`floor()`, `MIN_ASSERTIONS`, selftest `FLOOR`, distribute `FLOOR`) | Yes; but see R5-6 and R6-1 (SPEC's *un*gated copies were not fixed). |
| `isTableRow` hoisted | Yes, one definition, three call sites (`tableRows`, `tableLines`, block check). Correctness caveat in R5-1. |
| `realDay` round-trip | **Yes** and correct. `Date.parse('2026-02-30T00:00:00Z')` succeeds and rolls to March 2 (MakeDay permits day-of-month overflow); the round trip catches it; `2026-13-01` and `2026-00-10` are NaN at parse; `2024-02-29` survives. Only writer of day keys is `today()`, so no griefing surface. |
| `--live`/`--dry-run` preservation | **No** — under-scoped (R4-2) and covers two of N edits (R4-3). |
| supersede's flag clearing | **No** — R1-1. |
| dust bound corrected | **No** — `SPEC.md` still says 6,404 (below). |

### R7-7. MEDIUM — the dust correction reached one of two documents. SPEC still publishes the number the diff says must not be quoted.

`bank/distribute.mjs` now says the "up to 6,404" figure is "a real upper bound but a loose one… overstated by about threefold. A disclosure figure has to be the one that is TRUE." `SPEC.md`, under **The dust carries; it is never split**, still reads:

> *"at 2,100 vaults the remainder can be up to **6,404 sats** a settlement."*

Two documents, one number, one corrected — in a commit whose stated subject is that this repository's signature defect is a fix reaching one of N sites. No gate compares them.

**Evidence.** `grep -n '6,404' SPEC.md bank/distribute.mjs`.

**Fix.** Derive the customer-facing dust bound (`activated − 1`) in code and gate SPEC against it, the same way the assertion floors are gated. Then correct the wording per R2-5 (rounding remainder, not "what a settlement retains").

---

## CARRY-OVER LIST — where it is worse or better than stated

- **Limit 3 — BETTER than stated for MINT.** See R7-3. Now positionally confined; measured by 9d.4.
- **Limit 1a — WORSE than stated.** See R7-4. There is no fee-payer control of any kind on the mint path, on-chain or off, and no mint-signing tool.
- **Limit 12 (compute units) — WORSE again.** MINT's confinement went from a per-instruction membership test to `O(instructions × accounts)` inside `mint_vault`. Still unmeasured. It can only DoS the caller's own mint, so the exposure is availability of one transaction — but "unmeasured" is now unmeasured over a nested loop on a hostile-length input, and the byte ceiling table in SPEC has no CU column.
- **Limit 11 (the payer writes the ledger) — unchanged, and R1-2 makes it sharper.** A single aliasing edit can make the payer's ledger say "nobody was paid" on a day it paid everyone; the only cross-check is a ledger the payer wrote.
- **Limit 17 (`EMISSION_MIN_PER_VAULT` provisional)** — still 21 and still unratified, and R7-1 shows the *derived* consequence of it (the wait floor) is now published, wrongly, on a card.
- **Limit 18 (nothing assumed about the open questions)** — I found no code that assumes a randomness source or an upgrade ladder. One near-miss to flag: R2-3's recommended default-to-Level-I fix **would** assume something about level assignment, so if you take it, take it together with the commitment scheme (limit 16), not before.
- **Limit 6/7 (flock silence)** — unchanged, and it interacts with R1-1: an aborted `flock -n` run writes nothing, so it is not a source of the silent half-day, but it is indistinguishable in the log from the SIGKILL that is.

---

## VERDICT CHALLENGES — the two findings this diff pinned as refuted

- **`pinnedAccountData` without `version`** — the rejection is correct in mechanism (`version = 1` is a default parameter, so the omitting call in `distribute.mjs` gets the identical check) and the new assertions test the right thing. But note the reason the wrong finding was written: `bank/anchor.mjs` was not in the bundle, and **it is still not in the bundle** (R7-5). Pinning the answer does not remove the cause.
- **The dust lattice ("true maximum ≈ 1,731")** — the rejection is correct. I independently derived `dust = Σf_v ≤ N−1` and confirmed attainment at `available = D−1`, where `floor((D−1)w/D) = w−1` for every level, giving `dust = 2,099` at the 2,100 census. The offered 1,731 is a local maximum.
- **The `settledAsPayout` direction** — the rejection is correct; derivation in R2-1.

---

## OTHER

- **LOW — the day key is a wall clock with no monotonicity check.** The double-payment guard is `st.days[today()]`. A forward clock jump writes a future day key; when the clock is corrected, the earlier real date has no rows and the run pays everyone again. Bounded in practice by the pool being empty after the first payout, and by the cadence gate, but the header's claim "one distribution per UTC day" rests on NTP. Cheap fix: in `holdDays` (which already validates key *shape*), also refuse when `max(dayKeys) > day`.
- **LOW — the round-18 comment refuted by the round-19 comment is still in place.** `distribute.mjs`'s supersede call site still carries the paragraph arguing from "leaving `finishedAt` unset because some transfers failed" — which the `supersede` doc twenty lines up calls false. A reader at the call site meets the wrong premise first. Delete it, keep one account.
- **LOW — cosmetic-but-load-bearing indentation.** `distribute.mjs`'s new `if (R.length !== FLOOR) {` sits at column 0 inside a block, and `bank/selftest.mjs` matches its neighbour with `/^  const FLOOR = (\d+)$/m` (exactly two spaces, nothing trailing). It matches today; a formatter run makes `distFloor` the string `'NOT FOUND'` and turns the arm red — fail-closed, but the gate is now indentation-sensitive. Match on `/^\s*const FLOOR = (\d+)\s*$/m`.
- **LOW — the new bash harness executes repository text.** `selftest.mjs` slices `cron-install.sh` between two string markers and runs it. Correct technique, and it means anything a future edit places between those markers is executed by the test suite with the tester's privileges. Bound it: assert the slice contains no `$(`, no backtick, and no `>` redirection before running it.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Not repeating the SHIP GATE. Six things sixteen rounds of AI review structurally cannot do, in the order I would do them.

**1. Execute the money job, and execute it while killing it.** Every accepted defect in `distribute.mjs` across rounds 17, 18, 19 and this one (R1-1 included) is a **crash-ordering** defect. No amount of reading finds those; the diff proves it by having invented a bash-executing harness for one six-line block and then not applying it to the base64 check next door. Build a localnet harness: a fake 8-decimal mint standing in for cbBTC, five vaults