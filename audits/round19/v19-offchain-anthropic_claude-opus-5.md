# INDEPENDENT REVIEW — diff `ec7d17e..HEAD` (round 19)

**Scope note that is itself a finding.** The bundle I received is the `FOCUS=offchain` variant: `bank/distribute.mjs`, `bank/cosign.mjs`, `scripts/bank-sign.sh`, `scripts/cron-install.sh`, plus the diff. **`bank/selftest.mjs`, `bank/detectors.mjs`, `SPEC.md`, `bank/anchor.mjs`, `bank/alarm.mjs`, `bank/lock.mjs` and all four `lib.rs` files were not delivered.** R1, R5 and the "third target" all ask questions that cannot be answered without them. Where I could not close a claim from the delivered text I say so and give the exact one-line test that closes it. I have not filed anything as CRITICAL that I could not close, and I flag two places where I believe an earlier round's confident CRITICAL would have been wrong.

---

## R1 — THE SELF-AUDIT'S OWN REPAIRS

### R1-1. HIGH — the supersede block clears the two weak suppressors and leaves the strong one: `finishedAt`

`bank/distribute.mjs`, the round-18 self-audit fix:

```js
const priorVerdict = st.days[day].refused || st.days[day].nothingToDo
if (priorVerdict) {
  st.days[day].supersededAt = ...
  delete st.days[day].refused
  delete st.days[day].nothingToDo
}
```

Both flags are written by this branch, twenty lines below:

```js
st.days[day].nothingToDo = plan.skip
if (plan.refusal) st.days[day].refused = plan.skip
st.days[day].finishedAt = new Date().toISOString(); save(st)
```

**`finishedAt` is written by the same non-paying verdict and is not cleared by the supersede.** On the paying path it is only ever *set*, never deleted:

```js
if (!failed.length && !ambiguous.length) st.days[day].finishedAt = new Date().toISOString()
```

So the exact ordering the fix was written for — quiet-or-refused morning, repaired, rerun in the afternoon, partial payment — produces a day carrying `startedAt`, a *stale* `finishedAt` from the run that paid nobody, real signatures for some vaults, and `sig: null` for others. The self-audit's own reasoning ("`nothingToDo` outliving the verdict is fail-open") applies verbatim to `finishedAt`, which is the field the `distribution_unfinished` arm most plausibly keys on — the delivered comment on the quiet branch says so in as many words: *"A day with nothing to pay is FINISHED, not abandoned halfway. Leaving it open raised a HIGH every day."*

**One thing here is unconditional and needs no knowledge of `detectors.mjs`:** the money ledger now records `finishedAt` at 09:07:xx and `sentAt` timestamps from 15:00 on the *same day record*. The day's own audit trail says it finished before it paid. Any reconciliation that orders events by these fields is reading a lie the payer wrote (carry-over limit 11 says the ledger is written by the payer; this makes it internally inconsistent, which is worse).

**Evidence that decides the alarm half.** Run, against the real `detectors.mjs`:

```js
D.detectDistribution({days:{'2026-08-20':{startedAt:'x',finishedAt:'y',
  paid:{v1:{sig:'abc'},v2:{sig:null}}}}},{today:'2026-08-21'})
  .some(f=>f.kind==='distribution_unfinished')
```

If this is `false`, the hole is live and is identical in effect to the stale `nothingToDo` the two new selftest arms were written to demonstrate. If it is `true`, then `finishedAt` does not suppress — in which case the *quiet* branch's `nothingToDo` is the only suppressor and my finding reduces to the timestamp lie.

**Fix (correct under either answer, and cheap):** in the supersede block also `delete st.days[day].finishedAt`, record it in `supersededWas`, and delete `st.days[day].unreadableAtas` (also written by an earlier run of the same day and also never cleared). Better: make the paying path write `finishedAt` only through one helper that asserts every vault in `plan.activated` has a terminal state, and add a selftest arm for the stale-`finishedAt` shape beside the two stale-`nothingToDo` arms.

Note also that `supersededWas` records only the first truthy of the two via `||`; on a refusal both are set, so the record silently loses the fact that `nothingToDo` was present too.

### R1-2. MEDIUM — rendered-prompt defects the escaping fix did not reach

The self-audit's lesson was "render it, do not read it". I rendered it — I am reading the output — and the round's own identifiers are wrong in it:

| rendered text | reality |
|---|---|
| `THE DIFF UNDER AUDIT (2c8cd9b..HEAD) — every repair round 17 made, in one place` | the diff is `git diff ec7d17e..HEAD` and carries round 18 + the self-audit |
| `THE AUTHOR'S OWN VERDICT ON ROUND 15 — attack it` / `(round 17's verdict is being written…)` | a section header promising an artifact that is absent, two rounds stale |
| `REPORT FORMAT. Order by target: R1-R6` | the targets run to **R7** |
| `sixteen rounds of AI audit structurally cannot` vs `Fifteen rounds have produced…` in the same document | this is round 19 |
| `Everything omitted has been in at least one prompt across rounds 1-17`; `audit-coverage.sh … passes at 27 of 27` | the code under audit was written *after* round 17; the coverage claim cannot cover it |
| `EIGHT ROUNDS RUNNING` (top) vs `SEVEN ROUNDS RUNNING` (audit18.ts body, also in the diff) | one of the two is wrong |

The floor interpolation itself is now correct (I received "284-assertion", "403 off-chain detector", "63 allocation", "19 against live mainnet"), and the deliberately-escaped `\${FLOORS.onchain}` renders as the placeholder as intended. But the *reason* the floors were read from a file — "a number duplicated into a document is a number that drifts" — was applied to four numbers and to none of the six identifiers above, all of which are typed literals in the same template. That is the one-of-N-sites shape inside the fix for one-of-N-sites, in the certification instrument.

**Fix:** derive the diff-range header from the same constant that builds `DIFF`; derive the round number from one place; delete the dead verdict section or fill it; generate the "R1-Rn" line from the target count.

### R1-3. HIGH (process) — the bundle does not contain the files the questions are about

`audit19.ts`:

```ts
const FOCUS=process.env.FOCUS||'programs'
...
${FOCUS === 'programs' ? `<SEAL, MINT, BURN lib.rs>` : `<distribute.mjs, cosign.mjs, bank-sign.sh, cron-install.sh>`}
```

The prompt's targets straddle both halves and one file in neither:

* **R5 is entirely about `bank/selftest.mjs`** — `isTableRow`, the `MintVault` struct regex, `codeOnly`, the two new `nothingToDo` arms. `bank/selftest.mjs` appears in **neither** bundle. An auditor is asked "is one definition now genuinely used everywhere it should be" about a 1,700-assertion file it has not been given, from 60 lines of diff hunks.
* **R1 and R5 both hinge on `bank/detectors.mjs`** (`distribution_unfinished`, `distribution_refused`). Not in either bundle. It is also *absent from the diff*, which tells me it did not change — but its semantics are exactly what decides R1-1.
* **The "third target" is about SPEC.md's control table.** `SPEC.md` is in neither bundle **and is excluded from the diff by the pathspec** `-- programs bank scripts tests`. The round whose stated worst-defect-of-the-previous-round was a wrong row in that table never shows the table or its diff.
* On the `programs` pass (the default), R2/R3/R4 ask about `distribute.mjs`, `bank-sign.sh` and `cron-install.sh`, none of which are delivered.

**What an auditor can do with this:** produce a confident answer from the diff hunk alone, which is precisely how "a comment describing a control that does not run" survives. **Fix:** build the file list from the target list mechanically — every backticked path in `PROMPT` must resolve to a file that is either in the bundle or in `DIFF`, asserted before the first token is spent, the same way `verifyRoster()` now asserts model ids. That single check would have caught this.

### R1-4. MEDIUM — the dirty-tree gate cannot fail, and its pathspec cannot see SPEC

```js
if(dirty) console.log('  ⚠️ … DIRTY TREE — this round did not audit a fixed tree')
if(good.length<MIN_AUDITORS){ … process.exitCode=1 }
```

The comment above it says *"THE TREE MUST NOT MOVE UNDER THE ROUND"* and the code only prints. This is the same "a certification runner that cannot fail is a gate that flatters its own margin" the file's own header claims to have fixed one paragraph earlier — fixed for quorum, not for the tree. Additionally the pathspec `-- programs bank scripts tests` means an uncommitted edit to `SPEC.md`, `README`, `levels.json` or `bank/*.json` is invisible to both `DIFF` and `dirty`.

**Fix:** `if(dirty) process.exitCode=1` (or refuse before spending), and drop the pathspec from the `status` call.

### R1-5. LOW — the manifest record is well-formed; two contradictory roster comments are not

`dirty.split('\n').filter(Boolean)` on un-trimmed porcelain output yields correct array elements (` M path`, `?? path`) with the trailing empty line dropped; a clean tree gives `''` → `[]`. The comment's justification (trimming the blob eats the first line's leading status space) is correct. No defect in the record.

The declaration above `MODELS` in `audit19.ts` carries **two comment blocks that contradict each other**: the first (copy-pasted from `audit18.ts`) says "SAME ROSTER AS ROUND 16 … round 18 must differ … all eight are present in the live list of 421"; the second says "NONE OF THESE EIGHT WAS USED IN ROUND 18 … 422 models". Two documents drifting apart, in the same declaration, in the file whose job is to catch that. Delete the inherited block.

Also: `land()` writes `${TAG || 'v19-'+FOCUS}-<model>.md`. If `TAG` is set for both passes, the programs pass's report is overwritten by the off-chain pass's. Include `FOCUS` unconditionally.

---

## R2 — THE ROUND-18 OFF-CHAIN REPAIRS

### R2-1. The `settledAsPayout` default direction is CORRECT. Traced, not assumed.

The claim to check was "not resetting the clock pays people sooner". Trace:

* bare `resolvedBy` → `settledAsPayout` false → that day is not in `paid` → `anchor` stays at the *older* real payout → `dayDiff(anchor, day)` is **larger**.
* `decideEmission`: `if (daysSinceLastPayout >= maxHoldDays) return { pay: true, forced: true }`. Larger `daysSinceLastPayout` crosses 31 **earlier in wall-clock time**.
* The only other consumer of `holdDays` is `describeCadence`, which is documented as descriptive and nothing branches on it.

So larger `holdDays` ⇒ the ceiling fires sooner ⇒ pays sooner. **The default is in the direction the comment claims.** I am saying this explicitly because the prompt invited a reversal, and a "CRITICAL: the default is backwards" here would have been wrong.

### R2-2. MEDIUM — the fix depends on an operator field that exists nowhere an operator will read

`resolvedAs: 'paid'` appears in exactly two places in this diff: `settledAsPayout` and its own assertions. The human who resolves an ambiguous row is told about `resolvedBy` by `paymentState`'s comment, by `alarm.mjs`'s report, and (presumably) by the runbook. **No document in this diff was updated to tell anyone `resolvedAs` exists.** The measured defect — a hand-paid day invisible to the cadence, 52 where 2 was right — therefore persists in production, because the operator will keep writing bare `resolvedBy` and the new code path will never execute.

*Evidence:* `grep -rn resolvedAs` across the repo returns only `bank/distribute.mjs`. If SPEC/runbook/`alarm.mjs`'s resolution instructions do not name it, this fix is inert.

**Fix:** have `alarm.mjs` (or whatever prints the ambiguous-row report) emit the literal JSON fragment to paste, including `resolvedAs`, and add an assertion that the ambiguous-row report text contains `resolvedAs` — the same source-scraping technique already used on `bank-sign.sh`.

### R2-3. MEDIUM — the corrected dust disclosure states a measurement the code cannot produce

The bound is right. `per[v] = floor(available·w_v/den)` with `den = Σ_{v∈activated} w_v` exactly (unlevelled vaults are a refusal, unactivated ones are absent), so `Σ per` differs from `available` by the sum of `|activated|` fractional parts each in `[0,1)`, hence `dust ≤ |activated| − 1`. At 2,100 activated that is **2,099**, and it holds when `available < |activated|` (all `per` are 0, `dust = available`, and in fact `allocateWeighted` returns the empty plan with `dust: 0n` on that path) and is unaffected by vaults skipped later in the loop.

But the comment asserts more than a bound:

> *"Measured across the 2,100-vault census: worst observed 2,099, never near 6,404."*

That is not attainable. With only five distinct weights, `dust = Σ_l n_l·r_l/den` where `r_l = (available·w_l) mod den`, and the five residues are linked (`r_4 ≡ 2r_2`, `r_6 ≡ 3r_2`, `r_5 ≡ r_2+r_3`). Maximising over that lattice at `den = 6405`: choosing `available ≡ 3202 (mod 6405)` gives residues `6404, 3201, 6403, 3200, 6402`, i.e.

`945(6404/6405) + 525(3201/6405) + 315(6403/6405) + 210(3200/6405) + 105(6402/6405) ≈ 1731`.

So the achievable worst case is around **1,731**, not 2,099. And the seven `available` values the new assertion loops over produce far less than either — for `available = 1_000_000` the floors sum to 999,180, so `dust = 820`.

The corrected comment repeats the sin of the one it replaced ("a disclosure figure has to be the one that is TRUE, not merely one that holds") one register up: 2,099 is a true *bound*, "worst observed 2,099" is a fabricated *measurement*. **Fix:** either print `worst` from the new loop and quote that, or quote 2,099 as a bound and stop using the word "measured". The assertion should also assert the maximum, not just the bound — its final `return worst < 2100n` is a tautology given the in-loop `>= activated.length` guard already returned.

### R2-4. MEDIUM — the published dust is not the amount that carries

`console.log('… dust ${plan.dust} carried to the next drop')` and `st.days[day].census/denominator` are the holder-checkable figures. But the amounts of vaults that were **skipped** (burned mid-run), **failed**, or left **ambiguous** also stay in the distributor and also carry, and are not in `dust`. On a day with one frozen ATA the true carry is `dust + per[v]`, and `per[v]` at 2,100 vaults dwarfs the ≤2,099-sat dust. A holder reconciling "denominator, my weight, the drop" against the distributor balance cannot make it add up.

**Fix:** report `carried = available − Σ(actually sent)` as a separate, computed field, and keep `dust` as the arithmetic remainder.

### R2-5. MEDIUM — the NOTIFY fix reached the refusal branch and not the two branches that deny an individual holder

The self-audit's argument for paging on refusal was "two failures of the same job, one function apart, disagreeing about whether a halt is worth waking anyone." Apply it to the same file:

* `poisoned` (an ATA that exists but is not a readable token account): `console.error` + `st.days[day].unreadableAtas`, **no NOTIFY**, `balances[v] = '0'` → the vault falls below 21,000 → it is **not in `activated` at all** → it is not in the census, not in the denominator, everyone else is paid slightly more, and the day still records `finishedAt` and exits 0. Anyone can put a 1-lamport, 0-data account at any vault's derived ATA address; the cost is one lamport plus rent per victim and it needs nobody's cooperation.
* `missing` (no cbBTC account): `console.log` only, by design ("never created").

So a stranger can silently and cheaply remove specific holders from the payout, indefinitely, with no page — while a stranger removing *all* holders (the unlevelled-vault halt) now pages. The paging rule is inverted with respect to targetability: the loud failure is the one that is loud anyway.

**Fix:** page (and set `exitCode`) on any *newly appearing* entry in `unreadableAtas`, and assert in the suite that a poisoned ATA reaches the notification path — the same "persisted, not printed" argument that got applied to the ledger in round 12 stops one step short of the human.

### R2-6. LOW — the refusal page and the `--dry-run` exit code

`process.exitCode = 1` on refusal is not suppressed under `--dry-run` while `NOTIFY` is. That is defensible (dry-run should report the halt) but it means `distribute.mjs --dry-run` — the command the new cron header tells an operator to think in terms of — exits non-zero on a griefed day, which any wrapper will read as a job failure. Document it in the usage block.

On the substantive question: paging once per daily run for a halt that blocks *every* holder's payment is right. The griefing surface (mint + fund one vault) already existed; what changed is that the operator now learns about it within a day instead of never. Keep it.

### R2-7. `census`/`denominator` — no defect, stated so it is not re-filed

`census` returns `{ ...Object.create(null) }`, i.e. a **normal-prototype** object, so `JSON.stringify` → ledger → `JSON.parse` → `plan.census[l]` and `denominator(c)` all behave as before; the null prototype only guards the accumulation loop, which was the actual bug. `denominator`'s `Object.hasOwn(c ?? {}, l) ? c[l] : 0` loses the old `|| 0` coercion, but JSON cannot carry `undefined` and `census` only writes numbers, so `NaN` is not reachable from any real ledger. No consumer in the delivered code needs a prototype. **No finding.** (Also: neither exported-helper hardening is reachable in production, as the comment itself says; that is a correctness-in-isolation change, not a security fix, and the comment is honest about it.)

---

## R3 — `scripts/bank-sign.sh`

### R3-1. The round trip closes the canonicality hole. I could not find an accepted non-canonical input.

By the time `CANON` is computed, whitespace is stripped (`tr -d '[:space:]'`, so any non-alphabet byte that survives fails the `case` filter), `=` before the end is rejected, and length ≡ 0 mod 4. The `base64 -d | base64 -w0` equality then rejects `====`, `A===`, `AB==`, `AAB=`, `AAAA====` — all five listed cases decode to bytes that re-encode differently. GNU `base64 -d` ignores newlines, which are already gone. A 1,232-byte transaction is `410` full quanta + one 2-byte quantum = **1,644 characters ending in a single `=`**, `1644 % 4 == 0`, canonical, and round-trips — **no legitimate rejection.** `printf` is a bash builtin so there is no `ARG_MAX` limit on a long paste, and `$(…)` stripping trailing newlines makes GNU `base64`'s terminating newline harmless.

### R3-2. MEDIUM — `|| true` collapses "the tool is missing or non-GNU" into "your transaction is corrupt"

```sh
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
if [ "$CANON" != "$TX" ]; then echo "the transaction is not CANONICAL base64 …"; exit 2; fi
```

`-w0` is GNU coreutils. On BSD/macOS `base64` there is no `-w`, stderr is discarded, `CANON` is empty, and **every legitimate transaction is refused with a message blaming the operator's paste.** That is fail-closed, which is right, but the diagnosis is wrong and unfixable from the message — and this file goes to some length elsewhere to assert its tools exist (`cron-install.sh` does exactly this for `flock`: `[ -x "$FLOCK" ] || exit 1`). One-of-two-sites again.

**Fix:** before the check, `printf 'AAAA' | base64 -d | base64 -w0` and compare to `AAAA`; if it does not hold, exit with "this script needs GNU coreutils base64" rather than accusing the transaction. That is a two-line self-test of the checker, and it is the kind of thing that would have caught the round-17 alphabet filter earlier.

### R3-3. LOW (under-claim, the requested inverse shape) — the file says it contains no judgement, and it now does

Header: *"This file holds no key, reads no key, and **contains no judgement**."* It now contains a fail-closed canonicality judgement that refuses transactions before Node sees them, plus an argument allowlist that refuses unknown words, plus a read-before-`cd` ordering that a round measured as fail-open. Those are controls. The corrected `ps` paragraph is accurate (the transaction *is* in `cosign.mjs`'s argv via `exec … --tx "$TX"`, and an unsigned transaction is not a secret), but the "no judgement" sentence is now the *understatement* in the file — the same direction as the control-table row the owner caught. Change it to "holds no key and makes no judgement **about the transaction's contents**; it does judge its encoding, and refuses."

---

## R4 — `scripts/cron-install.sh`

### R4-1. HIGH — re-running the installer silently strips a hand-added `--dry-run` and re-arms the live sender, which is exactly what the new header tells the operator to do

The new header's remediation advice:

> *"If that is not what you want, do not install, **or add --dry-run to the distribute line yourself**."*

The installer:

```sh
REV_LIVE=''
if grep -q "revenue.mjs --live" <<<"$CUR"; then REV_LIVE=' --live'; fi
grep -v "$TAG" <<<"$CUR" > "$TMP"          # every tagged line, including distribute, is deleted
cat >> "$TMP" <<CRON
...
7 9 * * * … /usr/bin/node bank/distribute.mjs >> $LOGDIR/distribute.log … $TAG distribute
```

An operator's hand-added `--dry-run` lives on a tagged line, so it is stripped, and the heredoc re-adds the **live** line. The file already documents this exact failure for the other job — *"AND IT USED TO SILENTLY UN-`--live` THE REVENUE CRON … The revenue line is now preserved if it already exists"* — and the preservation was implemented for one of the two money jobs. So the fix for the wrong-money-claim header hands the operator a mitigation that the next `cron-install.sh` run destroys, in the direction of moving real cbBTC.

*Evidence:* install; `crontab -e` to add `--dry-run` to the distribute line; re-run `scripts/cron-install.sh`; `crontab -l | grep distribute` no longer contains `--dry-run`, and no message says it was removed (contrast the `NOTE: the existing revenue cron is --live; keeping it.` printed for the other job).

**Fix:** mirror `REV_LIVE` with `DIST_DRY`, print the same NOTE, and add a selftest arm asserting both preservations — the gate that already scrapes this file for the exec line can scrape for both.

### R4-2. MEDIUM — the header enumerates two of five installed jobs, and its one strong claim is conditionally false

Every line the script installs, and whether it can move money as installed:

| line | schedule | moves money as installed? |
|---|---|---|
| `alarm.mjs` (watcher) | `23,53 * * * *` | **unverifiable from this bundle.** `bank/alarm.mjs` was not delivered. The header's "two money jobs" framing asserts it cannot; nothing in the delivered text proves it. It also has `--reconcile` reading chain state and an SMS path. |
| `distribute.mjs` | `7 9 * * *` | **yes** — no `--dry-run`. |
| `revenue.mjs$REV_LIVE` | `41 */6 * * *` | not as installed (no `--live`); **yes** if an operator ever adds it, and the installer now preserves that permanently. |
| `alarm.mjs --reconcile` | `19 4 * * *` | same unverifiable status as the watcher. |
| deadman | `9 */2 * * *` | no — `test`/`find`/`notify-gary-sms.sh` only. |

Two further defects in the corrected header:

* *"From the next 09:07 this job loads the distributor key and sends cbBTC to holders for real."* On a fresh install this is **false in a way that matters**: `loadLevels()` throws if `bank/levels.json` is absent, and `fs.statSync(KEYFILE)` throws if the distributor key is absent — both before any transfer — so the real behaviour is *"from the next 09:07 this job will either pay holders or SMS you every morning."* The header replaced one wrong money claim with an over-confident one; the honest statement includes the paging.
* The header stops at two jobs while the `echo` block lists five. The defect just fixed was precisely *"it describes one of the two money jobs and the operator reads it as describing the file."* Enumerating two of five reproduces the shape one level up.

**Fix:** make the header a table over all five installed lines with an explicit "moves money: yes/no/only with `--live`" column, and add a selftest arm that counts the heredoc's `$TAG` lines and requires each to appear in that table — the technique already used against the control table.

---

## R5 — THE GATES

### R5-1. MEDIUM — `isTableRow` is a definition of "row-shaped line", not of "control-table row"

```js
const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)
```

* **What it misses (fail-closed, acceptable):** `|Name|…` without the space after the leading pipe; a tab; `**ON-CHAIN**.` with the period outside the bold; a lower-case or differently-worded verdict; a row wrapped across lines. Any of these makes a real control row invisible, which turns the `BankKeyOutside*` arm and the `length === 2` arm red. Fail-closed, but it means the table's *formatting* is now load-bearing on a build gate with no error message saying so.
* **What it lets through (fail-open, the actual defect):** it is not anchored to the control table. **Any** line anywhere in SPEC.md that starts `| ` and contains `| **PROCEDURE.**` counts — a second table, a changelog table, an example table inside prose demonstrating what a row looks like. So the repaired arm still cannot distinguish "named in the control table" from "named in any table-shaped line in the document", and the arm written to *prove* the repair (`'…a name that lives ONLY in prose no longer counts as a table row'`) cannot see the difference, because it moves the name from a matched row into unmatched prose — the one case both versions agree on.
* `tableSrc.includes(n)` is a substring test, so `BankKeyOutsideMintSomething` in the table satisfies a search for `BankKeyOutsideMint`. Cardinality where attribution was needed, again.

**Fix:** anchor by slicing SPEC between the control table's heading and the next heading (`## `), run `isTableRow` inside that slice only, assert the matched row count equals a pinned integer, and match names with a word boundary against the *cell*, not the line.

### R5-2. MEDIUM/HIGH — `rows.filter(...).length === 2` counts successes instead of forbidding failures, and it penalises strengthening the documentation

```js
t('...two of which are ON-CHAIN and both verified against the Rust',
  rows.filter(r => r.endsWith('claims ON-CHAIN, source says ON-CHAIN')).length, 2)
```

Two separate problems, and the second is the exact inverse-direction defect this round was told to hunt:

1. **Fail-open.** A *third* row that claims ON-CHAIN while the Rust says otherwise produces a different suffix; the count of matching rows is still 2 and the assertion passes. The property wanted is universal — *no row claims ON-CHAIN unless the source agrees* — and what is asserted is a cardinality of the good cases. This is the round-11 defect the sibling arm was just repaired for, still standing one assertion away. (If a neighbouring arm asserts zero mismatches, that arm is not in the diff and should be; please check.)
2. **It locks in an under-claim.** The delivered `cosign.mjs` header states that **SEAL and BURN each** take `bank: Signer` pinned to config, and this diff shows **MINT** taking `bank: Signer` pinned to config as well (three programs). Meanwhile `bankErrs` scans only SEAL and MINT, and this arm hard-pins the ON-CHAIN row count at **exactly 2**. If someone writes the *true, stronger* statement into the table — a third ON-CHAIN row for the third program that mandates the Bank's signature — **the build goes red.** A gate that fails when the documentation becomes more accurate is a gate that enforces the under-claim. That is the shape the owner caught by reading, now mechanised.

**Fix:** assert `>= 2`, plus a separate `rows.filter(r => /claims ON-CHAIN, source says (?!ON-CHAIN)/.test(r))` equals `[]`, plus a pinned *total* row count so a deleted row is still caught.

### R5-3. MEDIUM — the `#[msg(...)]` scrape cannot see an Anchor error variant without a message

```js
[...src.matchAll(/#\[msg\("[^"]*"\)\]\s*(\w+),/g)].map(m => m[1])
```

An `#[error_code]` enum variant with **no** `#[msg]` attribute is legal Rust and legal Anchor (it gets a default message). Such a variant is invisible to `errNames`, so `bankErrs` never contains it, so the "every Bank-confinement refusal the programs can emit is NAMED in the control table" arm passes while a `BankKeyOutside*` error exists that no row mentions. Fail-open, in the arm built specifically to close "a control with no row was invisible to a row-checker". This was asked about verbatim in round 18's prompt ("**Is the new arm's regex sound?** … What does it miss?") and was not changed.

*Evidence:* add `BankKeyOutsideNothing,` with no `#[msg]` to `MintError`; the suite stays green.

**Fix:** scrape the enum body between `pub enum MintError {` and its closing brace and take every `^\s*(?:#\[msg\(…\)\]\s*)?(\w+),` — i.e. every variant — then filter by name.

### R5-4. LOW — the `MintVault` struct regex is adequate; the failure modes are closed

`/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/` is non-greedy to the first newline-then-brace. Inside an Anchor account struct, a `}` at column 0 essentially cannot occur — `#[account(...)]` attributes close with `)]`, constraint struct literals close with `})]`, and doc comments are line-oriented. If the regex *did* stop early or fail entirely, `body` is `''`, `fields` is `[]`, `indexOf('bank')` is `-1`, and the assertion fails **red**; if `MINT_IX_BANK_IDX` is renamed, `declaredBankIdx` is `NaN` → `JSON.stringify(NaN) === 'null'` ≠ `4` → also red. The `slice(0,6)` arm pins that a real struct was parsed, and the reorder arm proves the check bites. **Fail-closed throughout — no finding.** Two residual notes: nothing pins the *total* field count (a field appended after `system_program` is unnoticed, which is harmless for this constant), and the arm proves the constant matches Anchor's binding order, which is the right property, because Anchor binds `bank` to positional slot 4 regardless of what the caller intended.

### R5-5. LOW — `codeOnly` is right about whole-line comments and blind to trailing ones

`!/^\s*#/.test(l)` strips full-line comments and the shebang. A `#` that is **not** a comment: a trailing comment on a code line (not stripped — so an `echo` or a variable assignment mentioning `exec … cosign.mjs …` after a `#` would still fool the tamper regex, which rewrites the *first* match); `${#TX}` (never at line start after optional whitespace, so unaffected); a here-doc body line beginning with `#`, which is data rather than a comment (none in `bank-sign.sh`, but `cron-install.sh`'s `CRON` heredoc is exactly that shape, so do not reuse `codeOnly` there). The arm works today and will break again the first time someone documents the command in an `echo`.

**Fix:** stop relying on "first match". Assert `codeOnly(signSh).match(/exec .*cosign\.mjs.*/g).length === 1` and then tamper that one match.

### R5-6. MEDIUM — the two new `nothingToDo` arms prove the hazard, not the repair

They assert (a) a half-finished day raises `distribution_unfinished` and (b) adding `nothingToDo` silences it. Neither touches `bank/distribute.mjs`. **Nothing anywhere exercises the supersede block** — the clearing lives inside `main()` behind an RPC connection, a keyfile, a levels file and a DAS fetch, so it has no test at all. The assertion name says "which is why the writer clears it" and the writer's clearing is unproven; and neither arm covers `finishedAt`, which is finding **R1-1**.

**Fix:** factor the supersede into a pure function `supersede(dayRecord) -> dayRecord` and assert, in both directions, that a record carrying `{refused, nothingToDo, finishedAt, unreadableAtas}` comes back with all four gone and `supersededWas` naming both flags.

---

## R6 — THE COUNTS AND THE ARITHMETIC, RE-DERIVED

**Every published figure checks out.**

* Odds × 240 → 108/60/36/24/12, sum **240** ✓. Denominator `108·2+60·3+36·4+24·5+12·6 = 216+180+144+120+72 = ` **732** ✓.
* Odds × 2,100 → 945/525/315/210/105, sum **2,100** ✓. Denominator `1890+1575+1260+1050+630 = ` **6,405** ✓.
* Per \$1,000 at 240: `2.7322, 4.0984, 5.4645, 6.8306, 8.1967` → **2.73 / 4.10 / 5.46 / 6.83 / 8.20** ✓.
* Per \$1,000 at 2,100: `0.31225, 0.46838, 0.62451, 0.78064, 0.93677` → **0.31 / 0.47 / 0.62 / 0.78 / 0.94** ✓.
* Shares at 2,100: `1890/6405 = 29.508`, `24.590`, `19.672`, `16.393`, `9.836` → **29.5 / 24.6 / 19.7 / 16.4 / 9.8** ✓; exact sum 100.0 ✓ **and** the rounded five also sum to exactly 100.0 (a non-obvious property worth keeping an assertion on) ✓.
* `LEVEL_WEIGHTS.V / LEVEL_WEIGHTS.I = 3` ✓.

**Floor consistency also checks out.** `selftest.mjs` 395 → 403 against exactly 8 new `t(` calls in the diff (2 `nothingToDo`, 1 real-exec-line, 4 in C4b, 1 prose-only). `distribute.mjs` 54 → 63 against +1 (dust bound: one arm replaced by two), +2 (`realDay` round-trip arms), +6 (five `settledAsPayout` arms + one `holdDays` arm) = +9. Both deltas are exact. The prompt's rendered floors (284/403/63/19) match `run-tests.sh`.

### R6-1. MEDIUM — the floors are still duplicated, and the reading fix picked one copy of two

`run-tests.sh` holds `DET_FLOOR=403` / `ALLOC_FLOOR=63`; `bank/selftest.mjs` holds `const FLOOR = 403` and `bank/distribute.mjs` holds `const FLOOR = 63`. Two authorities per number. `audit19.ts` now reads *one* of them. So the failure mode the reading fix was written to end is intact: bump one copy and not the other, and the audit prompt advertises a number the suite does not enforce (or vice versa), with the weaker floor governing. Note also the comment in `selftest.mjs`: *"SPEC documents running this file DIRECTLY, which bypasses the runner's floor entirely"* — which is precisely why the in-file copy exists, and precisely why it must not be a second literal.

**Fix:** have each `.mjs` read its floor out of `scripts/run-tests.sh` (they already read source text for a dozen other gates), or add one arm asserting `FLOOR === grab(RT, /^DET_FLOOR=(\d+)/m)`.

### R6-2. LOW — the card arms hardcode the denominator they are supposed to derive

```js
LEVELS.map(l => (1000 * LEVEL_WEIGHTS[l] / 732).toFixed(2))
```

The comment claims the figures are "checked from the WEIGHTS so a weight change turns this red". The weights are read from the constant; **732 and 6405 are literals**, i.e. a third and fourth copy of the denominator in the same file that exports `denominator()`. A weight change does turn other arms red, so this is not a hole — it is the signature defect in the gate over the customer-facing card. Use `denominator(cen240)` / `denominator(cen2100)` as the divisors. Same for the `(1000 * 7 / 732)` arm, which as written proves an arithmetic fact rather than that the card gate fails.

---

## R7 — WHAT THE SELF-AUDIT MISSED (one-of-N sweep over every fix in the diff)

| fix in this diff | sites of the same shape | applied to all? |
|---|---|---|
| clear the stale no-pay verdict | `refused`, `nothingToDo`, **`finishedAt`**, **`unreadableAtas`** | **No — R1-1** |
| page on a non-paying outcome | refusal ✓, SOL floor ✓, failed/ambiguous ✓, **poisoned ATA ✗**, **missing ATA ✗** | **No — R2-5** |
| preserve an operator's hand-edited cron flag | `revenue --live` ✓, **`distribute --dry-run` ✗** | **No — R4-1** |
| assert the external tool exists | `flock` ✓ (`cron-install.sh`), **`base64 -w0` ✗** (`bank-sign.sh`) | **No — R3-2** |
| read a number instead of typing it | four floors ✓, **diff range / round number / R-count / "rounds 1-17" ✗** | **No — R1-2** |
| `Object.hasOwn` instead of truthiness | `allocateWeighted` ✓, `census` ✓, `denominator` ✓, `loadLevels` ✓ | **Yes** |
| round-trip date validation | `holdDays` keys ✓; `today()` is generated | **Yes** (but see below) |
| strip comments before scraping source | the two exec arms ✓, `errNames` (Rust) ✗, `tableRows` (markdown, n/a) | **Partly — R5-3** |

### R7-1. MEDIUM — the claim that `settledAsPayout` is the only site asking the cadence question is not checkable from this bundle, and one likely third site exists

`paymentState`'s callers in the delivered file are consistent: `holdDays` (via `settledAsPayout`, cadence), the `outstanding` fee-floor count (`!row?.skipped && paymentState(row) === 'unpaid'` — "what will the loop send"), and the loop itself (skips `paid`/`resolved`/`skipped`/`ambiguous`, sends `unpaid`). The fee floor and the loop use one predicate for one question, correctly.

But `detectors.mjs` raises a HIGH whose text is *"the distribution REFUSED and paid nobody — every activated vault is unpaid"*, which means it computes paid-ness over the same rows. **`bank/detectors.mjs` was not delivered**, so the sweep's conclusion cannot be confirmed. If that arm has its own idea of "paid" (e.g. `row.sig` only), then a day settled entirely by hand payments (`resolvedAs: 'paid'`) reads as "paid nobody" to the watcher while reading as a payout day to the cadence — a third copy of the fact, disagreeing with the second, which is the exact defect the second was created to fix.

*Evidence:* `grep -n "sig\b\|paymentState\|resolvedBy" bank/detectors.mjs`. If `paymentState` is not imported there, the sweep was incomplete.

### R7-2. MEDIUM — `pinnedAccountData` is called without `version` in the money job, under a comment claiming a version check

`bank/distribute.mjs`:

```js
// OWNER, DISCRIMINATOR AND VERSION BEFORE ANY OFFSET. Same class as the alarm's,
// in the job that decides who is paid how much.
pinnedAccountData(cfgAcc, { program: MINT_PROG, struct: 'MintConfig', what: 'the MINT config' })
```

`bank/cosign.mjs`, same helper, same paragraph of justification:

```js
pinnedAccountData(acc, { program: SEAL, struct: 'Config', version: 1, what: 'the SEAL config' })
```

One passes `version`, the other does not, and the one that does not is the one that then reads **three raw offsets** — `subarray(41,73)` collection, `subarray(137,169)` treasury, `readBigUInt64LE(205)` minted-total — and divides real cbBTC by results derived from them. Either `version` is required for the check to run (in which case the comment above the call asserts a control that does not run, in the money path, which is this project's #1 tracked defect class) or the helper derives it (in which case `cosign.mjs`'s explicit `version: 1` is noise and one of the two calls is wrong). Both cannot be right.

*Evidence:* one look at `pinnedAccountData`'s signature in `bank/anchor.mjs`.

### R7-3. MEDIUM — the confinement forecloses ever putting the Bank key in a multisig

`mint_vault`'s new walk, and SEAL's identical one, run over **top-level** instructions from the instructions sysvar and reject any top-level instruction that is not the exempt one if the Bank's key appears in its account list.

A Squads (or any smart-wallet) execution wraps our instruction as a **CPI**: the top-level instruction belongs to the wallet program, and its account list must contain **every** account the inner instruction touches — including the Bank. That top-level instruction is not a `mint_vault` (wrong program id, wrong discriminator), so the `else` branch fires: `require!(!ix.accounts.iter().any(|a| a.pubkey == bank))` → `BankKeyOutsideMint`. The same reasoning kills a Squads-signed redemption in SEAL, on top of the top-level-pairing requirement which already forbids it.

So the Bank key — the key that gates every redemption and every mint, sits on one host at `bank/keys/bank.json`, and whose custody carry-over limit 1b explicitly calls "an ops property of the machine" — **can never be moved to a multisig**, which is the single most obvious hardening available for it. That is a design consequence of this diff and it is documented nowhere. Note the asymmetry: `INIT_AUTHORITY` *is* a Squads vault that "signs by CPI" (measured fact 8), so the project already knows this pattern and has now structurally excluded it for the Bank.

*Evidence:* on localnet, execute a `mint_vault` through a Squads-style wrapper program whose instruction lists the bank as a signer; expect `BankKeyOutsideMint`. Cheaper: reason from `ix.accounts` of the outer instruction, which must be a superset of the inner one's.

**Fix (do not rush this):** either accept and **document** it as a hard constraint ("the Bank must be a single keypair; custody hardening is HSM/host, not multisig"), or exempt a pinned wallet-program id from the `else` branch — which is new surface and should not be done in a freeze. The important thing this round is that the constraint be *written down*, because it silently deletes a mitigation an operator will otherwise plan on.

### R7-4. LOW — the Bank can no longer be the owner of a vault

The walk rejects the Bank's key at **any** index other than 4, including index 3, `owner`. So `mint_vault(owner = bank)` — the Bank minting a vault to itself, e.g. a treasury or canary vault — now returns `BankKeyOutsideMint`. That may well be intended; it is not stated anywhere, and the new error message ("appears somewhere this instruction does not authorise") will not tell the operator which slot offended. Add the offending index to the message or add a distinct error.

### R7-5. LOW — the new error message's third emit site is unverified

The comment claims three emit sites, the third being "when the walk did not reach our own index" (`seen_self`). The `seen_self` require is not in this diff. If it emits a *different* error, the message's own comment over-claims; if it emits `BankKeyOutsideMint`, then the message is wrong for that case, because the Bank's key may appear nowhere at all when it fires. Check `grep -n seen_self programs/cbob-vault-mint/src/lib.rs`.

---

## THE CARRY-OVER LIST — where it is worse than stated

* **#12 (compute units unmeasured).** Worse than "got worse this round". The new confinement is an O(top-level instructions × accounts per instruction) `Pubkey` comparison loop **executed by every `mint_vault`**, on top of a sysvar walk that deserialises every instruction in the transaction. Nothing bounds the number of top-level instructions or accounts an attacker may add to a transaction that also contains a legitimate mint. If the loop can be driven past the CU limit, the *honest* mint fails — a cheap denial of activation, not a theft. Nobody has measured it. One `solana logs`-style CU reading from an existing 9d test, plus one adversarial case with a transaction padded to the account limit, would settle it. This is the only place in the diff where an attacker chooses the work our program does.
* **#11 (distribution reconciles against a ledger the payer wrote).** Worse: after R1-1 the ledger the payer writes can contain a `finishedAt` that precedes its own `sentAt` values. A reconciliation over a self-inconsistent record is not a reconciliation.
* **#2 (a coverage refusal has no override).** Unchanged, but note that `bank-sign.sh` now has a *second* unoverridable refusal (canonicality) whose message can fire for a reason that has nothing to do with the transaction (R3-2). "A human can sign by hand" is doing more work than before.
* **#1a/1b, #3, #4, #5** — unchanged by this diff as far as I can tell; the MINT confinement does not touch `judgeRedemptionTx`.
* **#16 (off-chain level register)** is *understated* — see below.
* **#18** — nothing in this diff assumes a randomness source, a cost ladder or an upgrade-timing rule. `settledAsPayout`, `realDay` and the supersede block are all independent of them. Clean.

---

## THE INVERSE DIRECTION — where the system is STRONGER than its own documentation

The owner's find was an under-claim no gate could see. Five more of that shape:

1. **`scripts/bank-sign.sh`: "contains no judgement."** It now contains a fail-closed encoding judgement and an argument allowlist. (R3-3)
2. **The control-table gate hard-pins TWO ON-CHAIN rows while three programs pin the Bank's signature** to config. Writing the true, stronger table turns the build red. This is an under-claim that has been *mechanised*. (R5-2)
3. **`mint_vault` is now uncallable via CPI at all** whenever the Bank must sign — a much stronger statement than the code comment's "the Bank's key may appear in a mint ONLY in the `bank` slot", and it has a real cost (R7-3) that is invisible precisely because it is never claimed.
4. **Carry-over #16 understates the level register.** It says "assigned by fate, cannot be appealed" is the Bank's word. In fact `allocateWeighted` *refuses the entire distribution* if any activated vault carries no level, so the Bank cannot quietly pay everyone else while dropping a holder — it must first write *some* level for that holder into a file, which is at least an artifact. The honest limit is narrower and stronger than the one written down: the Bank can mis-*assign* a level, but it cannot *omit* a holder without halting everyone.
5. **`distribute.mjs`'s "THREE THINGS IT REFUSES TO DO."** It also refuses: a partial vault list, a list that disagrees with `minted_total`, a duplicate-id page, a distributor key that is not `config.treasury`, an absent or unparseable level register, an absent or unreadable distributor ATA, a vault burned after the plan was fixed, and an activated vault with no level. Eight-plus, advertised as three, in the header a reader uses to decide what the job guarantees.

---

## ANYTHING ELSE

### X-1. MEDIUM (customer-facing) — "no holder ever waits longer than a month even at zero volume" is disproved by this file's own assertion

`MAX_HOLD_DAYS`:

> *"At this point the pool goes out whatever it holds, **so no holder ever waits longer than a month even at zero volume**."*

Two hundred lines below, in the same file:

```js
t('nothing at all is never "forced" into a zero payout',
  decideEmission({ smallestPer: 0n, daysSinceLastPayout: 99 }).pay, false)
```

And the ceiling is unreachable long before zero. `allocateWeighted` returns `skip: 'only X for a denominator of Y'` whenever the smallest share would be below `MIN_PER_VAULT`, and that skip is evaluated **before** the cadence gate (`if (!plan.skip) { … decideEmission … }`). So with `available < denominator` — under **6,405 sats** at the published 2,100-vault census, about 0.000064 BTC — no payout can ever occur, `daysSinceLastPayout` grows without bound, `describeCadence` keeps printing "monthly", the day is recorded as `nothingToDo` + `finishedAt`, nothing pages, and the ceiling never fires. The comment is a promise; the code and the suite both contradict it.

**Fix:** correct the comment to state the precondition (`the ceiling forces a payout only while the pool can give every activated vault at least one satoshi`), and add an assertion in both directions so the claim is gated rather than written. Consider whether an indefinite hold should stay silent — it is currently indistinguishable in the ledger from a healthy quiet day.

### X-2. LOW — the resumed day publishes a blank total and zero dust

On the resume path `plan` is rebuilt from the ledger without `total` or `dust`, so the run's only settlement line prints `String(plan.total ?? '')` → empty and `plan.dust ?? 0n` → `0`. Every crash-resumed day therefore publishes "dust 0 carried" regardless of the truth, and the day's headline figure is blank. Recompute both from the stored `per` and `available`.

### X-3. LOW — `--dry-run` recomputes a plan for a day that already has one

`if (st.days[day].plan && !DRY)` means a dry run *ignores* the durable plan and re-allocates against the current balance. So the diagnostic command an operator reaches for shows a different distribution from the one the resume will actually execute — on exactly the day (a half-finished one) where they most need to see the real plan. Have `--dry-run` print the stored plan when one exists and label it.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Six things sixteen rounds of prompt-and-report structurally cannot do, none of them in SPEC's SHIP GATE:

1. **Make the audit bundle self-verifying.** Every backticked path in the prompt must resolve to a file present in the bundle or in `DIFF`, asserted before a token is spent — exactly as `verifyRoster()` now asserts model ids. This round asked seven questions about three files nobody was given (R1-3). A model cannot notice it is missing a file it was never told exists; a `Set` difference can. Same check for numbers: every integer in the prompt should come from `grab()` or be forbidden.
2. **Run the ledger state machine, do not reason about it.** Build a deterministic harness that drives `distribute.mjs` against a fake `Connection` and a temp ledger, with an injectable fault at every `await`: `kill -9` between `save(st)` and `sendAndConfirmTransaction`, a frozen ATA, a poisoned ATA, a burn mid-loop, a second runner, a quiet-then-pay ordering, a refuse-then-pay ordering, two runs and a `--dry-run` in one day. Then assert **invariants over the resulting ledger**, not outputs: `finishedAt ⇒ every plan vault terminal`; `finishedAt ≥ max(sentAt)`; `¬(refused ∧ ∃ sig)`; `Σ per == total`; `available − Σ sent == reported carry`; no day both `nothingToDo` and paying. Finding R1-1 is a one-line consequence of invariant #1 and #2 and would have been impossible to ship. Sixteen rounds of reading found the *hazard* twice and the *field* never; a state-space walk finds fields.
3. **Differentially test the allocator against a from-scratch reimplementation** in another language, written from the published card only, and fuzz `(census, available)` across millions of cases comparing per-vault outputs, dust, and the actual attainable worst-case dust. That kills R2-3 (the fabricated 2,099) permanently and would give you the real figure to publish.
4. **Bound the loss in code, not in review.** A signed policy file the payer must read: maximum sats per day, maximum per vault, maximum vaults per run, and a manual arm token with an expiry. Nothing sixteen rounds of review produced can bound a loss; a cap can, and it is the only control that works against the defect class that has appeared in eight consecutive rounds (a fresh bug in the previous round's repair). Pair it with a canary phase: the first N distributions go to team-owned vaults at 1 sat, reconciled from a **second machine** running the independent implementation from (3) against chain data, not against the payer's ledger — which is the only way to retire carry-over #11.
5. **Measure compute units once, adversarially.** One number per instruction on the existing localnet, plus one padded-transaction case per introspecting instruction, recorded in a file with a floor like every other number here. Carry-over #12 is the only limit on the list that an attacker chooses the size of, and it just got a loop added to it.
6. **Drill the human.** Hand `bank/distributions.json` with an ambiguous row, a poisoned ATA and a superseded refusal to someone who has not read the code, with only the runbook, and time them resolving it. That is the one test that would have caught R2-2 (`resolvedAs` documented nowhere), R4-1 (the header's advice being destroyed by the installer) and R3-2 (a canonicality error that blames the operator for a missing tool) — three defects in this diff whose common property is that they are only visible from the operator's chair, and no model has ever sat in it.