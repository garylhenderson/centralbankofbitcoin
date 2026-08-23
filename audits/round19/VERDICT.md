# ROUND 19 — VERDICT

**NOT CLEAN. The freeze counter stays at zero and round 20 starts over.**

Round 19 accepted and fixed sixteen findings across three runs, every one of them
measured before it was believed. Every fix is new unaudited code, which is the
treadmill `audits/FREEZE.md` exists to leave — so this round moves the programme
no closer to the gate, and saying otherwise would be the "gate that flatters its
own margin" defect applied to the process itself.

Rounds 17 and 18 audited a moving tree and do not count. **The freeze has still
never started.** Phase 1 of `FREEZE.md` remains the next action.

---

## THE RECEIPT — three runs, and the first two could not seat a quorum

Quorum is 6 of 8. `MIN_AUDITORS` may now only ever be RAISED.

| run | HEAD | dirty | programs | off-chain |
|---|---|---|---|---|
| **A** (first) | `86a7782` | clean | **2** real (reported 3) | **4** real (reported 5) |
| **B** (re-run) | `194f236` | clean | **4** | **5** |
| **C** (final) | `2816e44` | clean at start | **8 of 8** | **7 of 8** |

Run C is the first pass in this round to seat a full roster, and it is the
evidence the three delivery fixes were real rather than plausible: every model
delivered on the programs pass, and `anthropic/claude-opus-5` spent **76,939
output tokens** on the off-chain pass — a report the old 64,000 cap would have
truncated and disqualified, exactly as it did in runs A and B. The single loss was
`minimax/minimax-m3` to a transient request failure on one pass, having delivered
on the other.

⚠️ **BOTH RUN-C PASSES STILL EXIT 1, AND THE REASON IS MINE.** The post-run
working-tree check — added THIS ROUND, in THIS COMMIT SERIES, to catch exactly
this — fired: *"THE WORKING TREE CHANGED DURING THE ROUND."* It is right. I was
editing `bank/`, `scripts/` and `SPEC.md` while run C was in flight, fixing the
findings run C was producing. The reports describe `2816e44` faithfully and the
manifests record that commit with `dirty: []` sampled at the start, so the
findings are sound for the tree the auditors read; what the flag denies is that
the round certifies the tree as it stands now. That is a true statement and the
gate should not be argued down.

**No CLEAN claim rests on any of these three runs.** Round 19's verdict is NOT
CLEAN, and that is established by findings I measured and fixed, not by an
auditor count. §3's rule against writing a verdict from a failed run exists to
stop a round being declared clean on insufficient readers; it is doing no work
here, because nothing is being declared clean.

### Run A reported three and five auditors and had two and four

`anthropic/claude-fable-5` returned HTTP 200 with `finish_reason: content_filter`,
`native_finish_reason: refusal`, content **null**: *"This request triggered
restrictions on violative cyber content and was blocked under Anthropic's Usage
Policy."* A security audit of our own code reads as offensive tooling to that
model. The text fallback then stored `JSON.stringify(j).slice(0,800)` — **exactly
800 characters, which clears the 600-character floor** — and every other arm of
`disqualify()` passed it. The manifest recorded `disqualified: null` on **both**
passes.

**That is round 18's defect verbatim, inside the function written to end it.** The
list of failure modes was an enumeration of what had been observed the previous
round, and the next round produced a mode not on the list. `disqualify()` is a
**whitelist** now: the only terminal reason a real report ends with is `stop`, and
a parseable response envelope is a corpse whatever its length. Validated against
all thirteen of run A's real artifacts — 7 corpses rejected, 6 genuine reports
passed, no false positives.

### Runs A and B lost eleven more auditors to three separate causes

Every one measured, every one now a pre-flight that throws before a token is spent:

| cause | who | fix |
|---|---|---|
| policy refusal | fable-5 (×2) | whitelist + off the roster |
| **context too small** | deepseek-v3.2 (163,840), glm-4.7 (204,800) — refused at **400** once the bundle grew to carry the files the prompt asks about | capacity pre-flight against published `context_length`; both off the roster |
| **output cap binding** | opus-5 hit `length` at **exactly 64,000** on both passes; minimax-m3 on one; gemini-3.1-pro and glm-5.3 each burned 63,996 of 64,000 on reasoning | `MAX_OUT` 64,000 → **128,000**, plus a per-model output-ceiling pre-flight |
| reasoning-only / preamble | kimi-k3 (×2), grok-4.6 (one pass) | already caught; kimi off the roster |

None of these corrupted a round — a truncated report is correctly disqualified.
They made the round **shorter**, which costs the same and was invisible until it
was counted. opus-5's run-A report had already spent 60,502 output tokens, so the
margin was one bundle-growth away from gone, and the repair that grew the bundle
is what consumed it.

---

## ACCEPTED AND FIXED — 16

Severities are this verdict's, after measurement.

### MONEY — and both halves of the installer defect ARM rather than disarm

**1. HIGH — `cron-install.sh` silently stripped a hand-added `--dry-run` and
re-armed the live cbBTC sender.** Its own header tells the operator to add exactly
that flag (*"or add --dry-run to the distribute line yourself"*), and a re-run
removed it without a word. Round 18 added preservation for the **revenue** line
after an auditor found the installer un-`--live`-ing that cron, and stopped at one
of two identical sites — the house defect, in the money installer. The asymmetry
is what makes this the worse half: failing to preserve `--live` **under**-arms and
is safe; failing to preserve `--dry-run` **arms**. Measured by replaying the
installer's own lines.

**2. HIGH — an unrelated or commented-out crontab line armed `revenue.mjs --live`.**
The preserve grepped the **whole crontab as unstructured text**. Measured: a
COMMENTED-OUT revenue line — the ordinary way an operator DISABLES a cron — a
prose note (`# note to self: never run revenue.mjs --live ...`), and another
project's line each armed the one trusted hop. Text expressing the *opposite*
intent read as consent to arm money. Now reads only our own tagged, uncommented
lines. **Gated by EXECUTING the real shell against fixtures**, not by reading it —
because every other arm in `selftest.mjs` reads the tree as TEXT and Phase 0's
worst defect was behavioural. Proven against the old logic: it goes red on both.

**3. HIGH — superseding a no-pay verdict cleared two of THREE marks, and then
three of FOUR.** `distribution_unfinished` is suppressed by `finishedAt` **or**
`nothingToDo` **or** `resolvedBy`. Round 18 fixed "one of two" to "two of two";
`finishedAt` — written by the same skip path, on the same line — was never in the
list. Measured: a quiet 09:07 writes `nothingToDo` + `finishedAt`; the afternoon
proceeds, clears the two it knows about, starts paying and dies; the next day the
stale `finishedAt` keeps a half-finished day with unpaid holders **silent**, while
the identical crash with no quiet morning correctly fires. The repair's own comment
argued from a premise its code makes false — it said such a day would be *"leaving
`finishedAt` unset"*, when `finishedAt` is not unset in that ordering, it is left
over.

**Then four run-B auditors found the FOURTH suppressor, `resolvedBy`, still
silencing it — in my repair.** Measured the same way. An enumeration written by
hand has now been wrong twice running, so it is no longer written by hand:
`selftest` parses the suppressors out of `detectDistribution`'s **own predicate**
and requires `supersede` to clear every one, with a both-ways case per suppressor.

**4. MEDIUM — `supersede` could strip `finishedAt` from a day that already paid.**
Filed as a HIGH by a fifth auditor. **Refuted on reachability** — `st.days[day].plan`
is written only on a paying day, and the caller routes any day with a plan to the
resume branch, which never calls `supersede`; `--dry-run` never reaches it either.
**Accepted structurally**: a pure exported function must not depend on a caller's
branch guard. It now keeps `finishedAt` on any day that produced a plan or has a
row that actually paid somebody, and an ambiguous row does not count as paid.

**5. MEDIUM (customer-facing) — "no holder ever waits longer than a month EVEN AT
ZERO VOLUME" is false in precisely the case it names.** `decideEmission`'s first
branch returns before `maxHoldDays` is consulted, so at zero volume the ceiling
never fires at any age. The file's own assertion said so two hundred lines below
the claim. Corrected in `distribute.mjs` **and** SPEC — both sites — to state the
real precondition: the ceiling forces a payout only while the pool can give every
activated vault at least one satoshi.

**6. MEDIUM (customer-facing) — SPEC still published the dust figure round 18
retired.** 6,404 against a true **2,099**, about three times the truth. Round 18
corrected `distribute.mjs` and left the document a holder reads. One of two sites,
and the wrong survivor was the customer-facing one. SPEC's published figure is now
asserted against the arithmetic that produces it.

**7. MEDIUM — the on-chain sweep bound is a RATE limit, not "one capped sweep".**
SPEC read *"A compromised operator key costs one capped, cooled-down sweep rather
than the treasury"*. A cap plus a cooldown bounds the rate; exposure is the cap
times the number of cooldown windows before detection and rotation.
`MIN_SWEEP_COOLDOWN_SECS` is **one second**. The control that makes the cooldown
real is off-chain and already exists — `sweep_cooldown_too_short`, CRITICAL, every
pass — so this was a prose defect on a money claim, not a missing control. Stated
correctly now.

### THE FLOORS WERE DECORATIVE BY TWO — findable only by RUNNING the suite

**8. MEDIUM — `MIN_ASSERTIONS` said 284 against a real 286, and so did SPEC.** The
self-audit added on-chain assertions and moved `DET_FLOOR` and `ALLOC_FLOOR` but
not this one. Nothing was red, because `286 >= 284` — so two assertions could have
been deleted for free, and the gate built to stop exactly that had two assertions
of slack in it. **Round 18 could not have found this: its verdict says the on-chain
suite was not re-run.** It was run this round, four times.

The comment on `MIN_ASSERTIONS` already said *"It is the CURRENT count and it moves
with the suite"* — a claim the `-ge` did not enforce, which is this project's most
repeated defect committed inside the floor mechanism. **All four floors demand
EQUALITY now**, at every site (`floor()`, `MIN_ASSERTIONS`, and the two inner
`FLOOR` constants), and the two stored copies of each are asserted against one
another, because a fact stored twice is a fact that will disagree.

### THE GATES

**9. MEDIUM — `errNames` was blind to an Anchor variant with no `#[msg]`.** It
keyed on the attribute, so `BankKeyOutsideNothing,` — legal Rust, legal Anchor —
was invisible to `bankErrs`, and the arm asserting *"every Bank-confinement refusal
is NAMED in the control table"* passed while an unnamed Bank refusal existed.
Fail-open, in the arm built to close *"a control with no row is invisible to a
row-checker"*. Now reads the enum body; verified byte-identical to the old scrape
on all four programs (16/33/21/17) and it sees the unmessaged variant.

**10. MEDIUM — the control-table gate PENALISED TELLING THE TRUTH.** `rows.length
=== 5` and an ON-CHAIN count pinned at exactly 2. Three programs pin the Bank's
signature; the table names two. **Writing the truer, stronger third row turned the
build RED** — a gate that fails when the documentation becomes more accurate, which
is the owner's under-claim defect mechanised into the suite. Now `>=` (which still
catches a deleted row) plus an arm that FORBIDS any row claiming ON-CHAIN the Rust
does not support — the property that was actually wanted, where a cardinality of
the good cases had been asserted.

**11. MEDIUM — a NEW control row in a non-conforming format was never checked at
all.** The count protects rows that already match; it cannot protect one that never
matched. The gate now reads the **table block** — every `|` line under the header —
and requires every one to carry a classification. Measured: a non-conforming new
row fires; a correctly-formatted true row does not.

**12. LOW — the exec-scraping arm rewrites the FIRST match.** Round 18 already lost
this arm once that way, to a comment. Stripping comment *lines* leaves a trailing
comment or an `echo` able to reproduce it. There is now an assertion that exactly
one candidate exists.

### THE INSTRUMENT

**13. HIGH — a dirty tree was advisory, and the prompt was built before the
receipt.** The comment said *"THE TREE MUST NOT MOVE UNDER THE ROUND"* and the code
printed a warning and exited 0 — fixed for quorum last round, not for the tree.
`DIFF` and `PROMPT` are module-scope constants evaluated before `main()` reads
`head`. Now a hard failure, and HEAD **and the working tree** are both re-checked
after the round — the second half because **the author edited these files while run
B was in flight**, so a manifest recorded a clean tree that had stopped being clean
an hour earlier.

*The first repair of the pathspec went too far and is its own lesson*: dropping it
entirely made the check cover `audits/`, which the round WRITES AS IT RUNS, so every
round would have failed itself. Caught by measuring before it shipped. The scope is
now derived from `TARGETS`.

**14. MEDIUM — the quorum was an unguarded env override.** Measured: `MIN_AUDITORS=0`
gives 0, and `MIN_AUDITORS=x` gives `NaN` — and `good.length < NaN` is **false**, so
a round with ZERO usable reports would exit 0 and write a manifest claiming quorum
was met. The override may only ever raise the bar now; `0`, `x`, a value below the
floor, above the roster, or fractional are all refused.

**15. HIGH — the prompt asked about files it did not deliver.** R5 is entirely about
`bank/selftest.mjs`; R1 turns on `bank/detectors.mjs`; the third target is SPEC's
control table — **none of the three was in either bundle**, and the last two were not
in the diff either. This cost two confident wrong findings (below). The first repair
added the three files and stopped; a run-B auditor then showed the **programs pass
still named five files it did not deliver**, with `bank/cosign.mjs` in neither bundle
nor diff. One fix, one of two passes — the house defect inside the repair for the
house defect. It is mechanical now: every path the numbered targets name must be
bundled, asserted before a token is spent, proven both ways.

**16. LOW — stale labels in the instrument.** The section header read *"THE DIFF
UNDER AUDIT (2c8cd9b..HEAD) — every repair round 17 made"* while the delivered diff
is `ec7d17e..HEAD`; an empty *"THE AUTHOR'S OWN VERDICT ON ROUND 15"* section was
carried from round 17's file; and the roster carried two comment blocks contradicting
each other about which roster it was. Found by rendering the prompt before the round,
which is the only way to see any of it.

---

## REJECTED BY MEASUREMENT, NOT BY ARGUMENT — 9

This section is as important as the accepted one. Every one is now an ASSERTION so
nobody re-litigates it and a change that quietly makes it true turns the build red.

1. **"The `settledAsPayout` default is backwards and holders wait longer."**
   Traced end to end: NOT resetting the clock makes `holdDays` **larger**, which
   crosses the 31-day ceiling **sooner**. Measured 52 vs 2, and 52 forces a payout
   where 2 holds. Three auditors independently reached the same conclusion.

2. **"`worst observed 2,099` is not attainable; the true maximum is about 1,731"**
   (opus-5, with a lattice argument). **The bound IS attained**, at
   `available = 6404 = denominator - 1`, where every level's floor lands exactly one
   short of its weight: `945·1 + 525·2 + 315·3 + 210·4 + 105·5 = 4305`, and
   `6404 − 4305 = 2099`. The figure offered as the true maximum is a local one
   (1,732). A confident, mathematically-dressed finding from the strongest report,
   refuted by four lines of arithmetic.

3. **"`pinnedAccountData` is called without `version` in the money job, under a
   comment claiming a version check — both cannot be right."** `version = 1` is a
   **default parameter**, so the omitting call gets the identical check and the
   comment is true. The auditor's own suggested evidence — *"one look at the
   signature in `bank/anchor.mjs`"* — is what refutes it, and it could not look,
   because `anchor.mjs` was in neither bundle. **A direct product of finding 15.**

4. **"The `MintVault` struct regex can be truncated and permit a stale positional
   constant."** Mechanism real, consequence absent, and the direction is the point:
   truncation **before** `bank` fails CLOSED (`indexOf` returns −1, the first-six pin
   fails); truncation **after** it cannot move `bank`'s index. Confirmed independently
   by opus-5, which filed it as "no finding".

5. **"`isTableRow` silently excludes valid Markdown rows, so a real control row
   escapes the gate."** For an EXISTING row this is false — the cardinality pin fires
   (measured: a leading space or a dropped period takes the count to 4). The *new*-row
   case was real and is accepted as finding 11. Three auditors filed the wrong half.

6. **"`|| true` means a missing `base64 -w0` accepts everything."** Measured with a
   broken `base64` on PATH: it **REFUSES** a legitimate transaction. `CANON` becomes
   empty, which can never equal `TX`. An availability problem on a non-GNU host, and
   it fails CLOSED.

7. **"A legitimate paste with a trailing newline is rejected."** `tr -d '[:space:]'`
   strips it. Measured: trailing-newline and wrapped multi-line pastes both pass the
   base64 gate, as do real transactions at 64/512/1000/**1232** bytes.

8. **"The prompt ships a literal `${FLOORS.onchain}`"** (filed three times across two
   runs, once as a CRITICAL). The single escaped interpolation is the R1 bullet that
   *describes* the round-18 defect and must render literally. Every floor that states
   a number interpolates: measured on the rendered artifact as `286`/`436`/`95`/`19`.
   Pinned because it is a **recurring false positive** — the prompt teaches auditors
   to hunt this shape — and an assertion is cheaper than adjudicating it every round.

9. **"`detectors.mjs` keeps a second, disagreeing copy of paid-ness, so a hand-paid
   day reads as 'paid nobody'."** Measured: a hand-paid row has `resolvedBy`, which
   excludes it from both `unresolved` and `refused`, and the "paid nobody" HIGH keys
   on the day-level `rec.refused`, not on rows. No disagreement occurs.

Also refuted: **"governance can set `max_sweep_lamports` to 1"** — accurate on
mechanism, but `MIN_ADMIN_SWEEP_LAMPORTS` is *admin's* floor by name, going below it
is deliberately routed to governance, and the same signature pair can already
redirect the treasury outright; and **"the Bank can never be in a multisig is
documented nowhere"** — SPEC states it in bold, with the reason; the auditor did not
have SPEC (finding 15 again).

---

## CARRIED — not fixed, deliberately

**A. THE UNLEVELLED-VAULT HALT. STILL GARY'S DECISION, AND THE COUNT KEEPS RISING.**
Round 18 recorded ten of fourteen. Round 19 adds **five more** across its runs
(luna-pro, terra-pro, grok-4.6, minimax-m3, opus-5), calling it a customer-triggerable
payout DoS or paging channel. Anyone who funds a vault to 21,000 sats before its
`levels.json` entry exists stops every payout until an operator edits a file. The
standing argument — halting is recoverable, excluding permanently overpays everyone
else — is sound about those two options and silent about the third two auditors
supplied: reserve unknown vaults at maximum weight and carry the remainder. **It
changes who gets paid, so it is a product decision and not an audit repair.**

One calibration in the Bank's favour, from opus-5, and it is an **under-claim** in the
accepted-limits list: `allocateWeighted` refuses the entire distribution when any
activated vault has no level, so the Bank **cannot quietly pay everyone else while
dropping a holder**. The honest limit is narrower and stronger than written — the Bank
can mis-*assign* a level, but it cannot *omit* a holder without halting everyone. The
halt IS the control that makes the off-chain register honest.

**B. A poisoned ATA silently removes one holder while a whole-payout halt pages.**
(opus-5.) The `poisoned` branch persists to `unreadableAtas` and prints a warning but
does not NOTIFY; the refusal branch does. *"The paging rule is inverted with respect
to targetability."* Accurate — and `detectDistribution` does raise
`distribution_vault_unreadable` at HIGH within 30 minutes, so the holder is not lost
silently. Whether the money job should *also* page directly is a tuning decision, and
adding a page to a per-vault condition risks the "a finding that fires forever gets
scrolled past" defect this repository names repeatedly. **Carried with the measurement.**

**C. Compute units, still unmeasured, and now worse.** Both Bank-signature paths
deserialize every top-level instruction, and the MINT confinement adds an
O(instructions × accounts) `Pubkey` comparison **executed by every `mint_vault`**,
with nothing bounding what an attacker may pad into the transaction. Five auditors
across rounds 18 and 19 argue it should block a release. It remains carried limit 17
and is **must-be-measured, not accepted** — it must not be quietly demoted.

**D. The MINT confinement forecloses ever putting the Bank key in a multisig.** SPEC
already forbids it for the redemption pairing; opus-5 showed the confinement now
forecloses it on the **mint** path too, by a different mechanism. A real extension of
a documented constraint. Not fixed — it is a `programs/` question and a deliberate
design consequence.

---

## WHAT THIS ROUND COST ME

**I introduced five defects of my own, and the process caught all five.**

1. **The dirty-tree pathspec.** Dropping it entirely made the check cover `audits/`,
   which the round writes as it runs — every future round would have failed itself.
   Caught by measuring my own fix before shipping it.
2. **The "search that finds its own searcher", a sixth time.** A test fixture I wrote
   spelled out a co-signer invocation as a literal, which put one INSIDE
   `selftest.mjs`; three tree-scanning arms immediately reported this file as a second
   invoker and a second signer. `FREEZE.md` records five instances of exactly this from
   Phase 0. **The gates caught it.** The literal is assembled from parts now.
   My both-ways fixture for that same arm was also wrong — the regex anchors at line
   start, so the `echo` I used as the negative case could never have matched.
3. **The fourth suppressor.** My repair for "two of three" cleared three of four. Four
   auditors found it. The list is derived from the detector's own predicate now.

4. **Two strictnesses for one question, in one file, in one change.** The posture
   print I added greps `"$TAG distribute"`; the preserve I added three lines above
   greps `$TAG` and then a substring. An auditor caught it. `ours` takes the job
   name now, with cross-arm cases proving a tagged watcher line quoting the flag
   cannot arm revenue.
5. **Clearing `resolvedBy` destroyed a human's resolution note.** Two auditors,
   independently. Removing its power to suppress the alarm was right; deleting the
   record was not. It is preserved as `supersededResolvedBy` now — supersede the
   history, never delete it, which is what a third auditor said about the verdicts.

**And a sixth, in my measuring rather than my code:** a probe injected a brace into
`MintVault` using `String.replace`, which silently hit an earlier occurrence outside
the struct and returned a reassuring "gate is blind in both directions". Re-scoped, it
gave the opposite and correct answer. That is `ROUND19.md` §5.4 — *check your own
instrument before believing an alarming answer* — except mine returned a **comforting**
one, which is the harder direction to catch.

**Cost:** three runs of two passes each; run A and run B failed quorum and are not
verdict-bearing. Roughly $45–75 across the three, plus four full runs of the on-chain
suite. The wasted portion is runs A and B's model spend, and it bought the three
delivery defects that made them fail — which nothing else would have found, because
they are only visible when you count.

**Counts, every floor moved to EQUAL its real count:**
**286 on-chain · 436 detector · 95 allocation · 19 mainnet.**

The on-chain suite was **run**, four times, against real cloned mainnet Core — the
half round 18 explicitly could not run and flagged as outstanding. It is the only
reason finding 8 exists.

---

## THE GATE

**Not clean. The counter does not start.** Sixteen findings survived measurement and
were fixed; every fix is new unaudited code. Rounds 17 and 18 ran against a moving
tree, and `FREEZE.md`'s Phases 1–4 are all still ⬜ with the log reading `pre-freeze`.

**Phase 1 — WRITE DOWN THE ACCEPTED LIMITS — is still the next action**, and it now
has four more items to absorb (B, C, D above, plus the under-claim calibration on
limit 16).

**What this round is genuinely worth:** the instrument that does the certifying could
not count its own readers, could not refuse a moving tree, could have its quorum
switched off by an environment variable, and asked auditors about files it did not
give them. A round run through it was not measuring what it claimed to measure. That
is now fixed and proven in both directions — which does not advance the counter, and
is the precondition for the counter meaning anything.

⚠️ **Round 20 must use a DIFFERENT roster from round 19's**, listed at the top of
`scripts/audit19.ts`.
