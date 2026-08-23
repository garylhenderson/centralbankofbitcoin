I'll focus on finding real defects, with checkable evidence for each claim. Let me work through the targets.

## R1 — The self-audit's own repairs

### R1-CRITICAL-1: `supersede()` re-adds `finishedAt` to a superseded PAYING day, but the "alreadyPaid" guard reads `settledAsPayout` on rows that can also be a REFUSAL — and the guard preserves the OTHER two marks' loss. Trace carefully.

Actually the more serious thing is subtler. Look at `supersede`:

```js
const alreadyPaid = Boolean(rec?.plan) || Object.values(rec?.paid || {}).some(settledAsPayout)
if (alreadyPaid && rec?.finishedAt !== undefined) out.finishedAt = rec.finishedAt
```

The guard restores `finishedAt` only. It does NOT restore `nothingToDo` or `resolvedBy`. So on an `alreadyPaid` day, `nothingToDo` and `resolvedBy` are still deleted. That is intended for the un-reachable path. Fine. Not a live defect.

**The real R1 defect is elsewhere — the DONE_MARKS derivation gate is not actually pinned to the detector at runtime.** More below in R5.

### R1-HIGH-1: `supersede` clears `resolvedBy`, which destroys a HUMAN's resolution record on a proceeding day.

The exact construct: `for (const mark of DONE_MARKS) delete out[mark]` where `DONE_MARKS = ['finishedAt', 'nothingToDo', 'resolvedBy']`.

Consider this ordering, which the prompt explicitly asks me to trace ("refuse then pay", "resolved then pay"):

1. Day starts. Distribution refuses (unlevelled vault). Writes `refused` + `nothingToDo` + `finishedAt`.
2. Operator investigates, cannot fix the level today, and marks the row resolved by hand: writes `resolvedBy: 'gary: will assign level tomorrow, do not pay today'`. This is the documented human-answer path (`detectDistribution` treats `resolvedBy` as "a human answered this").
3. Later the same day the level file is fixed and the cron/hand-run proceeds. `main()` calls `supersede(st.days[day], ...)`.

`was = [rec.refused, rec.nothingToDo].filter(Boolean)` — both truthy, so `superseded: true`. Then `delete out.resolvedBy`.

**The human's explicit resolution note is silently deleted from the money ledger.** The `supersededWas` field records only `refused + nothingToDo`, never the `resolvedBy` string. So the audit trail of what a human decided about that day is gone, replaced by a machine note.

Evidence if I'm right: construct `supersede({ startedAt:'x', refused:'r', nothingToDo:'n', resolvedBy:'gary: manual note', finishedAt:'f' }, 'now')` and inspect `.rec` — `resolvedBy` will be absent and its text is nowhere in the output. The selftest's own arm proves this: `supersede clears EVERY suppressor the detector honours` returns `[]` for `needed.filter(k => k in out)` where `needed` includes `resolvedBy`. So the suite *asserts* the deletion is correct, i.e. it certifies the loss.

Why it matters: the whole reason `resolvedBy` suppresses `distribution_unfinished` is that a human took responsibility. Deleting it means the reasoning ("do not pay today") is erased and the record no longer shows a human was ever involved. This is a data-loss defect in the money ledger, and it is the same shape as the round-18 defect the file congratulates itself for finding (clearing a flag whose meaning was not fully understood).

Fix: `supersede` should clear only the *machine-written no-pay* marks (`refused`, `nothingToDo`, `finishedAt`) and MUST NOT touch `resolvedBy`, which is a human record, not a machine verdict. But — and this is the trap — if you leave `resolvedBy` and it suppresses `distribution_unfinished`, then a proceed-then-crash day with a stale `resolvedBy` goes dark again. The correct resolution is: the *detector* should not treat `resolvedBy` as a suppressor of `distribution_unfinished` at all when a `plan` exists; and `supersede` should preserve `resolvedBy` verbatim into `supersededResolvedBy`. The current design forces a choice between losing the human record and re-opening the fail-open hole, and it silently chose the first.

### R1-MEDIUM-1: The manifest `dirty` field can still be malformed — the trim fix addresses the wrong end.

`audit19.ts`: `dirty:dirty.split('\n').filter(Boolean)`. `git status --porcelain` lines are `XY PATH`. Each element is a full porcelain line. That is well-formed as an array of strings. But the *record* the prompt asks about (R1 bullet 4) is fine here. The subtler issue: `dirtyAfter!==dirty` comparison compares raw strings including the two-char status prefix — correct. No defect. Withdrawn.

## R2 — Round-18 off-chain repairs

### R2 — direction of `settledAsPayout` default: CONFIRMED CORRECT.

Traced: `holdDays` computes `daysSinceLastPayout` from the last *payout* day. If a hand-paid day is NOT counted as a payout, the anchor stays at the older real payout, so `daysSinceLastPayout` is *larger*, and `decideEmission`'s ceiling (`daysSinceLastPayout >= maxHoldDays`) fires *sooner* → pays sooner. The builder has this right. No defect. (I note three prior auditors agreed; I agree independently by trace.)

### R2-HIGH-1: `settledAsPayout` treats a hand-paid day as resetting the clock, but the hand-paid row NEVER has its `paid` amount reflected — and worse, the exit-code paging change makes a griefable halt page a human every day.

The refusal branch now does:
```js
if (plan.refusal) { ... execFileSync(NOTIFY, ...); process.exitCode = 1 }
```

The known-limits list says (item 7, and the halt design) that an unlevelled vault is a halt anyone can trigger for the price of one vault + 21,000 sats. Previously that halt exited 0 and only `alarm.mjs` paged. Now **every daily cron run pages Gary via SMS** for as long as the griefed vault sits unlevelled, i.e. until an operator edits `levels.json`.

The prompt frames this as "is a griefing surface now a paging surface?" — and the answer is yes, and it's worse than the doc admits: the NOTIFY target is `notify-gary-sms.sh` (SMS), not email. `alarm.mjs` is documented as EMAIL-never-SMS. This branch pages SMS **daily at 09:07** until fixed. A griefer who activates one unlevelled vault gets a guaranteed daily SMS to the owner indefinitely, and the only remedy is a manual ledger/levels edit. That is a strictly cheaper, louder griefing amplification than before.

Evidence if right: install the cron live, activate one vault with no level, and observe one SMS per day until `levels.json` is edited — combined with the existing `alarm.mjs` CRITICAL. The doc's EXIT CODES comment claims "The PAGE is suppressed under --dry-run" but does not acknowledge that under a live cron the page fires every single day for a condition a stranger controls.

Fix: page ONCE for a refusal (dedupe against the ledger — only NOTIFY if the previous day did not already record the same `refused` reason), or route the refusal to email, not SMS. A daily SMS an attacker controls is a denial-of-attention attack on the owner.

### R2-MEDIUM-1: `census()` returns `{...c}` (a normal-prototype object) but the ledger stores `plan.census`, which came from `census()`. Serialization is fine. However `denominator(c ?? {})` uses `Object.hasOwn(c ?? {}, l)` — and on a census READ BACK from JSON, `c` is a plain object, fine. No defect on round-trip.

But note: `census` for an empty-levels day returns `{I:0,...}` spread into a normal object — good. The resume path reads `st.days[day].plan.census` from JSON and passes it around only for display. No consumer needs a null-proto. Withdrawn — the change is inert, which is acceptable.

### R2 — dust bound re-derivation: CONFIRMED CORRECT, but the SPEC/selftest coupling has a gap.

`dust = available - sum_v floor(available * w_v / den)`. Each vault's fractional loss is `< 1` sat, and there are `activated.length` paid vaults, so `dust < activated.length`. Attained at `available = den - 1` where every floor loses its full fractional part. The selftest confirms `dustAt(6404n) === 2099` and `activated-1 = 2099`. Correct.

**But**: `dust < activated.length` is claimed "ALWAYS true, including when available is smaller than the vault count." Check `available = 1n`, 2100 vaults, den 6405. Every `per_v = floor(1 * w / 6405) = 0`. So `total = 0`, `dust = 1`. `1 < 2100` ✓. But then `smallest < min` (0 < 1) so `allocateWeighted` returns a `skip`, `dust: 0n` (the `empty` object). So in the skip case dust is 0 — the bound holds trivially. The selftest arm handles `available` down to `1n`/`7n` and checks `r.dust >= activated.length` — but in those cases `r` is the skip object with `dust: 0n`. So the arm is **not actually testing the small-available case against a real allocation** — it's testing the skip path, which always returns `dust: 0n`. The claim "the tighter bound holds across a full census including small available" is technically true but the test proving it is vacuous for the interesting inputs (it just re-confirms `0 < 2100`). Minor. LOW: the assertion looks stronger than it is.

## R3 — bank-sign.sh base64 round trip

### R3-MEDIUM-1: `set -euo pipefail` + the `|| true` on the CANON pipeline hides a real failure mode, and the selftest "proves" fail-closed for the wrong reason.

```bash
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
if [ "$CANON" != "$TX" ]; then ... exit 2; fi
```

The selftest arm (b) claims: with `base64` unavailable (fake returns 127), `CANON` becomes empty, which `!= TX`, so it refuses — fail-closed. Correct for *that* failure. But consider a DIFFERENT, real environment difference the prompt names: **`base64 -w0` is a GNU coreutils flag. On BusyBox `base64` (Alpine, many containers), `-w0` is not supported** — BusyBox `base64` ignores/errors on `-w`. If it errors, CANON is empty → fail-closed (annoying but safe). If a `base64` variant instead treats `-w0` as garbage input or wraps anyway, `CANON` gets newlines and never equals `TX` → **every legitimate transaction is refused**. That's a denial-of-signing, not a security hole, but the doc claims "no new dependency" while it silently added a hard dependency on GNU `base64 -w0`.

More concerning: the selftest runs on the *build host* (GNU), so it can never catch a BusyBox regression. The gate proves the property on a machine that has the property. The Bank box may differ. Evidence: run `bank-sign.sh` under BusyBox with a legit 1644-char tx — observe refusal. MEDIUM, availability.

Fix: use `base64 -d | base64 | tr -d '\n'` (portable), or detect and pin the coreutils requirement explicitly at the top of the script with a hard check like it does for `flock` in cron-install.

### R3 — the "not in ps" correction: CONFIRMED TRUE.

The last line is `exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ...`. The base64 IS in argv, so `ps` shows it. The corrected comment now says exactly that. Accurate. No defect.

### R3-LOW-1: `case "$TX" in *=*[!=]*)` rejects padding-before-end, but the canonical round-trip already subsumes it — dead check, and one that could reject a legitimately-padded-then-concatenated... no. It's harmless and redundant now. Note only: three overlapping checks (`[!A-Za-z0-9+/=]`, `*=*[!=]*`, `%4`, round-trip) where the round-trip alone is sufficient and stricter. Redundancy is fine defensively.

## R4 — cron-install.sh money claim

### R4 — enumerate every installed job:

1. `watcher` (`alarm.mjs`) — reads chain, sends alerts. Does not move money. ✓
2. `distribute` (`distribute.mjs$DIST_DRY`) — **moves cbBTC unless `$DIST_DRY` is set**. On a fresh install `DIST_DRY=''` → **LIVE**. Header now states this. ✓ accurate.
3. `revenue` (`revenue.mjs$REV_LIVE`) — moves money only with `--live`; fresh install `REV_LIVE=''` → dormant. ✓
4. `reconcile` (`alarm.mjs --reconcile`) — read-only. ✓
5. `deadman` — `find` + SMS. No money. ✓

The header and the computed posture print are both correct. **The header claim is now true and complete.** Good — but see R4-HIGH.

### R4-HIGH-1: The `ours()` preserve reads `$CUR` captured at start, but the posture-print at the end re-runs `crontab -l` (the newly written crontab). These can disagree, and the disagreement is silent — and worse, `ours | grep -q 'distribute\.mjs --dry-run'` matches a SUBSTRING that a comment or another tagged line could carry.

`ours() { grep -F "$TAG" <<<"$CUR" | grep -v '^[[:space:]]*#'; }`. This filters to tagged, non-comment lines. Good against the round-19 finding. But `grep -q 'distribute\.mjs --dry-run'` still matches anywhere in a tagged uncommented line. Since we control the format, the reachable risk is low. Not a live defect.

The real issue: **the preserve is keyed on `--dry-run` being present on the OLD distribute line, but a first-time operator who wants dry-run has no old line.** The documented remedy — "add --dry-run to the distribute line yourself" — only survives a *subsequent* re-run. On the *first* install there is nothing to preserve, so the fresh install is LIVE, exactly as the header now warns. That's consistent. Fine.

But consider: operator does `crontab -e` and comments out the distribute line entirely to disable it. Re-run `cron-install.sh`. `ours()` filters out comment lines, so the commented distribute line is invisible → `DIST_DRY=''` → the re-run **re-installs a LIVE uncommented distribute line**, silently re-arming a job the operator deliberately disabled. This is the *exact* class the round-19 `--live` fix was about (commenting out is how you disable), applied to the money-by-default job — and it was NOT fixed for disable-by-comment, only for the flag-preserve. The grep-out-comments makes it WORSE: a disabled distribute cron is silently re-armed live on the next install.

Evidence: comment out the tagged distribute line, run `cron-install.sh`, observe a fresh uncommented live distribute line at 09:07. MEDIUM→HIGH because it re-arms a live cbBTC sender against an operator's expressed intent to disable it.

Fix: if a tagged distribute line exists but is commented out, either preserve the commented state or refuse and warn loudly rather than silently replacing it live.

## R5 — the gates

### R5-CRITICAL-1: `isTableRow` and the ON-CHAIN row parser can be satisfied by a row that names a Bank-pinning program in a DIFFERENT capacity, but the more dangerous gap: `controlTableBlock` finds the header by exact string `/^\| control \| what it catches \| when \|/` — a single edit to the header column names disables the whole "every row carries a classification" gate silently.

```js
const h = lines.findIndex(l => /^\| control \| what it catches \| when \|/.test(l))
if (h < 0) return null
```

If someone renames a header column (e.g. "what it catches" → "catches"), `controlTableBlock` returns `null`. Then:
```js
t('the control table header is still findable', Array.isArray(block) && block.length >= 5, true)
```
This arm DOES catch a null header (`Array.isArray(null)` is false → assertion fails). Good. So it fails closed. Withdrawn as critical.

### R5-HIGH-1: The MintVault struct regex `pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}` is non-greedy to the first `\n}`, and the selftest's own R5-4 rejection arm PROVES it can be truncated before `bank` — which is claimed to "fail closed." But the fail-closed reasoning has a hole for the exempt-slot check.

The confinement is `require!(a.pubkey != bank || n == MINT_IX_BANK_IDX)` where `MINT_IX_BANK_IDX = 4` is a hardcoded Rust constant. The *selftest* parses the struct to confirm `4` matches, and claims a regex truncation before `bank` "fails closed" because `indexOf('bank') === -1`.

But here's the actual risk the selftest does NOT cover: the selftest verifies `MINT_IX_BANK_IDX` equals the parsed index *of the account struct field order*. **The account struct field order is NOT necessarily the runtime `ix.accounts` order.** Anchor's `#[derive(Accounts)]` generates account metas in declaration order, so field order == account order — true today. But the on-chain confinement walks `ix.accounts` (the raw instruction account list as the *client* built it), NOT Anchor's deserialized accounts. The client builds the account array; Anchor then maps positional accounts to named fields. If they match, fine. The suite assumes struct order == wire order. That IS how Anchor works, so it holds — but nothing in the *suite* proves the wire order equals the struct order; it proves struct-order-index equals the constant. The binding constant `4` is validated against the struct, and the struct is what Anchor uses to interpret the wire, so a client putting the Bank at wire slot 4 gets mapped to `bank`. Consistent. I cannot construct a live break. Downgrade to LOW: the pin is against the struct, not against the actual `TransactionInstruction` account layout the tests build — but tests 9d.4 exercise the real wire layout and pass, so it's covered empirically.

### R5-HIGH-2: `codeOnly` strips only FULL comment lines (`/^\s*#/`), and the "exactly ONE exec line" gate is defeated by a trailing comment or heredoc on the exec line — the self-audit *admits* this and then does NOT fix it.

The comment literally says:
> stripping comment LINES — which leaves a TRAILING comment, or an `echo` documenting the command, able to reproduce it exactly. "First match" is the defect, not "comments". So pin that there is only one candidate.

Then it "fixes" it by asserting `(codeOnly(signSh).match(/^\s*exec .*cosign\.mjs.*$/gm) || []).length === 1`. But consider `bank-sign.sh` containing an `echo` line that mentions `cosign.mjs` mid-line — that would NOT match `/^\s*exec /` because it requires `exec` at line start. So the "exactly one" count is over `exec`-prefixed lines only. A trailing `# comment` on the real exec line is on the same line, so `codeOnly` (which only drops whole `#` lines) keeps it, and the regex `/^\s*exec .*cosign\.mjs.*$/` still matches the one exec line — count stays 1. Fine.

But `codeOnly` for **shell** is wrong in the way the prompt asks about ("what is a `#` that is not a comment?"): a `#` inside a string or after a command is not a comment, and `/^\s*#/` only catches full-line comments — so `codeOnly` UNDER-strips (keeps inline comments) rather than over-strips. Under-stripping is safe for *this* gate (it can only keep more text, and the exec-count gate is line-anchored). So no live defect in the exec gate. But `codeOnly` is also reused implicitly nowhere else, so its shell-incorrectness is inert. LOW.

### R5-HIGH-3: The `DONE_MARKS` ↔ detector derivation gate is circular and does not prove `supersede` matches the RUNNING detector.

```js
const detSrc = fsx2.readFileSync('/opt/cbob-vaults/bank/detectors.mjs', 'utf8')
const guard = (detSrc.match(/if \(rec\.startedAt &&([\s\S]*?)&& day !== opts\.today\)/) || [])[1] || ''
const needed = [...guard.matchAll(/!rec\.(\w+)/g)].map(m => m[1]).sort()
```

This regex extracts suppressor names from the *source text* of `detectDistribution`'s unfinished guard. If the guard's structure ever changes shape — e.g. someone rewrites it as `if (isUnfinished(rec, opts))` extracting the logic to a helper, or uses `!rec['finishedAt']` bracket syntax, or splits the condition across a differently-worded line that doesn't match `if \(rec\.startedAt &&...&& day !== opts\.today\)` — then `guard` becomes `''`, `needed` becomes `[]`, and:

```js
t('the detector still has an unfinished guard this arm can read', needed.length > 0, true)
```

This catches `needed.length === 0` → fails the build. Good, fail-closed on empty. **But** if the guard is refactored to add a suppressor via a helper or a differently-spelled term (`!rec.foo` vs `rec.foo === undefined`), the regex silently misses the new suppressor while STILL matching the old ones (`needed.length > 0` passes), and `supersede` is only checked against the old set. A new suppressor written as `&& rec.bar === undefined` would not match `/!rec\.(\w+)/`, so it would be invisible to this gate, `supersede` would not clear it, and `distribution_unfinished` goes dark again — the exact fail-open this whole apparatus exists to prevent.

Evidence: add a suppressor `&& rec.abandoned === undefined` to the detector guard and observe the suite stays green while a proceed-then-crash day with `abandoned` set goes silent. The gate only defends against `!rec.X`-spelled suppressors. MEDIUM-HIGH — the gate is not robust to the most natural refactor and cannot see the detector I can't read here (`detectors.mjs` was not bundled, so I cannot confirm the guard is even spelled the way the regex expects — if it's *not*, the gate is already returning `[]` and only the `needed.length > 0` assertion stands between it and being fully vacuous).

**This is a significant blind spot: `detectors.mjs` is the file R1 turns on, and it was NOT provided in this bundle.** I cannot verify the running detector's guard matches the regex. If it doesn't, `supersede` is unverified against the real suppressor set. The prompt itself (R1) asserts the guard is `startedAt && !finishedAt && !nothingToDo && !resolvedBy` — if the real code differs, everything above is built on sand.

### R5-MEDIUM-1: `errNames` now reads the enum body via `#\[error_code\]\s*pub enum \w+\s*\{([\s\S]*?)\n\}` — non-greedy to first `\n}`. A `#[msg("...")]` message containing `\n}`? Messages are single-line string literals, so no. But a doc comment or attribute containing `}` at line start inside the enum? Unlikely. The claim "verified identical to old scrape (16/33/21/17)" is a snapshot, not a gate. If a future variant is added with an inline `}` this truncates. Low.

## R6 — counts and arithmetic

### R6 — floors read from run-tests.sh: `MIN_ASSERTIONS=286`, `DET_FLOOR=434`, `ALLOC_FLOOR=93`, `MAINNET_FLOOR=19`. SPEC "Running the tests" says `286 ... + 434 detector, 93 allocation and 19 live-mainnet`. **Consistent.** ✓

The prompt says the four floors are 286/434/93/19. But the R6 prose in the prompt lists `census ... 6,405; the ten per-1,000-dollar figures`. Let me re-derive.

### R6 — census arithmetic:
- 240: 108/60/36/24/12 = 240 ✓. Denominator: 108·2 + 60·3 + 36·4 + 24·5 + 12·6 = 216+180+144+120+72 = **732** ✓
- 2100: 945/525/315/210/105 = 2100 ✓. Denom: 945·2+525·3+315·4+210·5+105·6 = 1890+1575+1260+1050+630 = **6405** ✓
- Per $1000 at 732: I=2000/732=2.732→2.73, II=3000/732=4.098→4.10, III=4/732·1000=5.464→5.46, IV=6.831→6.83, V=8.197→8.20 ✓
- Per $1000 at 6405: 2000/6405=.312→0.31, 3000/6405=.468→0.47, 4000/6405=.6245→0.62, 5000/6405=.7806→0.78, 6000/6405=.9368→0.94 ✓
- Shares at 2100: I=100·945·2/6405=189000/6405=29.51→29.5, II=525·3·100/6405=157500/6405=24.59→24.6, III=315·4·100/6405=126000/6405=19.67→19.7, IV=210·5·100/6405=105000/6405=16.39→16.4, V=105·6·100/6405=63000/6405=9.83→9.8. Sum: 29.5+24.6+19.7+16.4+9.8 = **100.0** ✓

All customer-facing figures check out. Level V/I = 6/2 = 3 ✓.

### R6-MEDIUM-1: The EQUALITY floor change (`-eq` instead of `-ge`) is a self-inflicted foot-gun that will make the build fail on ANY legitimate assertion addition until three files are edited in lockstep — and the `floor()` function now applies `-eq` to DET and ALLOC while `-ge` still runs first as dead code.

```bash
[ "$n" -ge "$4" ] || die "...assertions went missing"
[ "$n" -eq "$4" ] || die "...must EQUAL the count..."
```

The `-ge` line is now dead: if `-eq` holds, `-ge` held; if `-eq` fails and `n < floor`, `-ge` already died. The only case `-ge` catches that `-eq` doesn't is `n > floor` — which `-eq` then dies on anyway. So the `-ge` line is pure dead code. Harmless but confusing. LOW.

The real concern: making floors `-eq` means **the floor is no longer a floor, it is an exact latch**. The stated rationale (slack accumulates) is real, but the cost is that the suite now fails on the *safe* direction (more assertions than expected) exactly as hard as the dangerous direction (fewer). Combined with SPEC also encoding these numbers and `selftest.mjs`/`distribute.mjs` each holding their own `FLOOR`, there are now **five** places that must move together (run-tests DET_FLOOR, run-tests ALLOC_FLOOR, run-tests MIN_ASSERTIONS, selftest FLOOR, distribute FLOOR) plus three SPEC numbers. The cross-checks assert they're equal, so a mismatch is red — but the operational effect is that adding one assertion turns the whole suite red until 8 coordinated edits land. This raises the odds of the exact defect the project fears: someone under pressure deletes an assertion to get back to green rather than bumping all counters. The `-eq` latch actively incentivizes assertion deletion. MEDIUM — the "fix" changed the failure mode from silent-slack to green-pressure-toward-deletion.

## R7 — what the self-audit missed

### R7-HIGH-1 (the big one): `settledAsPayout` is NOT the only reader of the cadence question — `holdDays`'s anchor fallback silently treats a first-ever hand-paid-only ledger differently, and more importantly `paymentState`'s `resolved` state is read by BOTH `settledAsPayout` AND the payment loop, and they draw OPPOSITE conclusions from `resolvedAs`.

`settledAsPayout`: `resolved && resolvedAs==='paid'` → counts as payout (resets clock).
The payment loop: `if (state === 'resolved') continue` → skips, regardless of `resolvedAs`.

So a row with `resolvedBy` + `resolvedAs:'unpaid'` (human says "nothing landed, I could not pay"):
- payment loop: `paymentState === 'resolved'` → **skipped, never paid**.
- `settledAsPayout`: `resolvedAs !== 'paid'` → not a payout, clock not reset. ✓ consistent.

A row with `resolvedBy` + `resolvedAs:'unpaid'` means the human established the vault will NOT be paid for that day — and the loop skips it forever. That's the intended "I established nothing landed" semantics. Fine.

But consider `resolvedAs:'paid'` with NO real signature: `settledAsPayout` counts it as a payout day (resets clock, correct). The payment loop skips it (correct, already hand-paid). Consistent. So the two readers agree. The self-audit's claim survives for these two.

**However**: `detectDistribution` (the detector, unbundled) also reads these rows and, per the prompt, suppresses `distribution_unfinished` on `resolvedBy`. It does NOT know about `resolvedAs`. So a `resolvedBy` + `resolvedAs:'unpaid'` row suppresses the unfinished alarm (human answered) — fine. But does the detector's `distribution_unresolved` / `distribution_refused` arm consider `resolvedAs`? I can't see `detectors.mjs`. If `detectUnresolved` counts a `resolvedAs:'unpaid'` row as still-unpaid-and-alarming while `paymentState` calls it settled, they diverge. **Unverifiable without the file** — and that's itself the finding: `settledAsPayout` was added and its `resolvedAs` field is read in `distribute.mjs` in three places (settledAsPayout, the alreadyPaid guard, the selftest), but whether `detectors.mjs` also needs to learn `resolvedAs` was NOT checked, because `detectors.mjs` wasn't in scope. One-of-N-sites risk, unclosed. MEDIUM, needs the file.

### R7-HIGH-2: The `alreadyPaid` guard in `supersede` reads `settledAsPayout`, but `settledAsPayout` calls `paymentState` which for a `resolvedBy` row returns `'resolved'` — so a day whose only rows are human-resolved refusals (`resolvedBy` present, no `resolvedAs`) has `settledAsPayout` → false, `alreadyPaid` → false, and `supersede` deletes `finishedAt`. That's the intended path. But if `plan` exists (`Boolean(rec.plan)`), `alreadyPaid` is true regardless of payment reality. A day that produced a plan but paid NOBODY (every transfer failed, no `sig`) still has `rec.plan` set → `alreadyPaid: true` → keeps `finishedAt`. But such a day would not have `finishedAt` set (the paying path only sets `finishedAt` if `!failed.length && !ambiguous.length`). So `rec.finishedAt !== undefined` is false → guard doesn't fire → marks cleared normally. Consistent by luck of the finishedAt discipline. Fragile but not currently broken. LOW.

## Third target — under-claims (SAFER than documented)

### UNDER-CLAIM-1 (MEDIUM): SPEC's control table row for the co-signer still reads **PROCEDURE** and describes it as skippable — but the *coverage* refusal (`judgeRedemptionCoverage`, the Token-2022-extensions and undeclared-holding refusal) is a REAL protection that the "PROCEDURE, skippable" framing understates, because the on-chain BURN independently refuses the same undeclared/extension-bearing holdings (`ReserveHasExtensions`, `VaultNotEmpty`). A customer reading "PROCEDURE, skippable" concludes the extension/undeclared protection is bypassable by signing with another tool — but for the RESERVE mints and any declared T22-extension account, BURN itself reverts on-chain regardless of the co-signer. The co-signer's coverage check is belt over an on-chain brace for the *reserve* subset; the table presents it as pure procedure. The guarantee is stronger than stated for reserve holdings. Nothing catches this because the gate only checks the ON-CHAIN/AUTOMATIC/PROCEDURE label mechanics, not whether a PROCEDURE row *understates* an on-chain backstop.

### UNDER-CLAIM-2 (LOW): `sweep_sol_for_swap` requires `amount > 0` AND the operator signature AND cooldown AND cap AND reserve — the alarm doc and known-limit #10 describe the trusted hop as "one trusted hop" implying broad exposure, but the on-chain bounds make a compromised operator's per-window theft `min(cap, balance - reserve)`, and the SPEC now (correctly, this round) rewrote "one sweep" to "cap × windows". That's an accurate correction, not an under-claim. Withdrawn.

## Carry-over list — is anything worse than stated?

- **Limit 7 (wedged-but-alive holder = permanent silent skip under `flock -n`)**: Combined with R2-HIGH-1's daily SMS on refusal, a griefer now has *two* amplifiers. Not worse for limit 7 itself.
- **Limit 12 (compute units unmeasured)**: The prompt says "got worse this round — see R1." The MINT confinement now walks *every top-level instruction* and, for each mint instruction, iterates *every account* (`for (n,a) in ix.accounts.iter()`). For a transaction with several mints and many accounts this is O(instructions × accounts) of sysvar loads (`load_instruction_at_checked` deserializes each instruction). At MAX and with multi-mint transactions this compute is genuinely unmeasured and could push a legitimate multi-mint transaction over the CU limit → mint fails. **Worse than stated**: the confinement's nested loop adds CU cost proportional to total account count across all instructions, and nothing measures it. If a batch-mint (several activations in one tx, which the design explicitly permits) hits the CU ceiling, activations fail with an opaque error. MEDIUM — file it as: limit 12 now has a concrete, reachable trigger (multi-mint batch), not just a general absence.

## Summary of findings worth acting on

| Sev | ID | Defect |
|---|---|---|
| HIGH | R1-HIGH-1 | `supersede` deletes a human's `resolvedBy` note from the money ledger on a proceeding day; the suite certifies the deletion as correct. |
| HIGH | R2-HIGH-1 | Refusal branch pages **SMS daily** on a stranger-triggerable halt (unlevelled vault) until manual fix — griefing amplified from silent to daily page. |
| HIGH/MED | R5-HIGH-3 | `DONE_MARKS` derivation regex only sees `!rec.X`-spelled suppressors; a naturally-refactored detector guard silently escapes it → fail-open re-opens. Unverifiable because `detectors.mjs` was not bundled. |
| MED | R4 (disable-by-comment) | Commenting out the tagged distribute cron to disable it is silently re-armed LIVE on the next `cron-install.sh` run. |
| MED | R3-MEDIUM-1 | `base64 -w0` is a hard GNU dependency; on BusyBox the canonical round-trip may refuse every legitimate transaction, and the selftest (GNU host) can never catch it. |
| MED | R6-MEDIUM-1 | `-eq` floor latch fails equally on the safe direction; five+ coupled counters incentivize assertion deletion under green-pressure. |
| MED | Limit-12-worse | The per-account nested loop in the MINT confinement makes CU cost of a permitted multi-mint batch unmeasured and potentially fatal. |
| MED | R7-HIGH-1 | Whether `detectors.mjs` needs to learn `resolvedAs` was not checked (file out of scope) — the one-of-N-sites risk for the `settledAsPayout` change is unclosed. |
| LOW | R2-MEDIUM-1 | The small-`available` dust-bound assertion is vacuous (tests the skip path returning `dust:0`). |
| LOW | R6/dead-code | `-ge` line in `floor()` is now dead. |

## Verdict challenges

The builder's self-audit is genuinely strong on the items it examined, and I confirm the two directional claims it flags as "REJECTED by measurement" (settledAsPayout direction; dust bound 2099) are correct. But the self-audit's structural weakness is exactly what R7 warns about: **it verified `supersede` against the suppressor list but never asked what deleting `resolvedBy` costs a human's record** (R1-HIGH-1), and it **could not verify the cross-file consistency with `detectors.mjs`** because that file is not in the bundle — so the central R1 claim (the `distribution_unfinished` guard is `!finishedAt && !nothingToDo && !resolvedBy`) is *asserted in the prompt* and *not shown in code I can read*. If the real guard differs, R5-HIGH-3 and R7-HIGH-1 are live, not hypothetical.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS — what sixteen rounds of AI audit structurally cannot do

Concrete, non-repeating the SHIP GATE:

1. **The bundle self-refuted this round and the guard is inside the thing under audit.** `audit19.ts` throws if a target file is missing — but I was handed `detectors.mjs` as a *dependency of R1's central claim* and it is neither in the bundle nor the diff, yet the `TARGETS` self-check passed because R1's prose doesn't spell `bank/detectors.mjs` as a `dir/file.ext` token in the target *section* the regex scans. **The gate that ensures "we deliver what we ask about" has a hole exactly where the most load-bearing unverifiable claim lives.** No AI round can close this because the auditor cannot know what it wasn't given. Fix: the prompt must carry a machine-generated manifest of *every file any assertion in the diff reads at runtime* (grep `readFileSync('/opt/...')` across the diff), and bundle all of them. Right now `supersede`'s correctness rests on a file no auditor in this round could see.

2. **Every "measured, refuted" claim is the builder's word about its own measurement.** The suite is run by the same party that wrote it, on a box no auditor touches. Sixteen rounds cannot fix that the auditors never execute anything. Concrete: publish the *raw test-run transcript* (stdout of `run-tests.sh` and the two selftests, with the validator's genesis hash and the Core sha256) as a signed artifact alongside each round, so a claim like "measured 286" is checkable against a log, not a sentence. The MANIFEST does this for auditor delivery; nothing does it for the assertions themselves.

3. **The money-moving default (distribute opt-OUT) plus daily SMS on a stranger-triggerable halt plus flock-n silent-skip is an operational threat model no code audit reproduces, because it only manifests on a live box with a real crontab and a real attacker over days.** Put the *operational* invariants under an integration harness that runs the real crontab against a local validator for simulated calendar days with an adversary activating unlevelled vaults — the one thing no static round and no unit selftest exercises.

4. **The `-eq` floor latch will, statistically, eventually cause an assertion deletion to get back to green.** Instrument the git history: a gate that fails the build if the assertion count ever *decreases* commit-over-commit, independent of the floor. That converts "don't delete assertions" from culture into mechanism.