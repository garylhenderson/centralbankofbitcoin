# ROUND 18 — VERDICT

Two passes against the same tree: **programs** (adjudicated in `982e5ef`) and
**off-chain** (this document). Eight models requested per pass.

## THE RECEIPT, WHICH THE ROUND COULD NOT PRODUCE FOR ITSELF

| pass | requested | **real auditors** | dead |
|---|---|---|---|
| programs | 8 | **8** | — |
| off-chain | 8 | **6** | `anthropic/claude-sonnet-5` (`FETCH FAILED Unexpected end of JSON input`, 41 bytes) · `deepseek/deepseek-v4-flash-0731` (degenerate repetition loop: 4,149 lines, **163 unique**, `[reasoning only]`, zero findings) |

**The off-chain pass reported eight auditors and had six, and nothing anywhere
said so.** `audit18.ts` wrote both corpses to disk as if they were reports and
exited 0. That is the defect this project is organised around — a gate that
flatters its own margin — sitting inside the instrument that does the
certifying. Fixed below, and validated against these exact files.

## ⚠️ THE BUNDLE CONTAINED THE FIX, AND THREE AUDITORS FILED IT AS LIVE ANYWAY

The off-chain bundle was built at `982e5ef`, **after** the programs pass had
landed the round-18 CRITICAL fix. Proven, not assumed: `MINT_IX_BANK_IDX` exists
only at `982e5ef` (0 occurrences at `2c8cd9b` and `ec7d17e`) and **every
reporting model quotes it**. grok cites the new test `9d.4` by name; mistral
cites `payerTheft`.

grok, mistral and cohere each filed **CRITICAL: the Bank can be put in the payer
slot** — the exact defect whose fix was in the text they were reading and
citing. cohere's own next line recommends adding "a check to ensure the Bank's
key only appears in the `bank` account position (`MINT_IX_BANK_IDX`)" — naming
the constant that *is* the check as its own proposed fix. Self-refuting.

**Three of six off-chain CRITICALs were re-reports of a fix present in the
bundle.** That is the "wrong CRITICAL" cost the prompt warns about, and it is
why a finding is measured before it is believed.

---

## ACCEPTED AND FIXED — 14

Severities are this verdict's, after measurement, not the reporters'.

### HIGH

**1. `cron-install.sh` told the operator that installing it cannot move money.
It arms a live cbBTC sender.** (gpt-5.6-sol-pro)
Header: *"NOTHING HERE MOVES MONEY UNTIL --live IS ADDED TO THE REVENUE LINE."*
Measured: `revenue.mjs` is opt-**IN** (`--live`), but `distribute.mjs` is
opt-**OUT** (`--dry-run`), and the installed line carries no `--dry-run`. From
the next 09:07 it loads the distributor key and sends cbBTC for real. The
closing summary reinforced it (*"revenue … ADD --live WHEN YOU ARE READY"*).
A false safety claim, in the installer, about the money job. Header rewritten to
state both jobs separately; the summary now warns explicitly.

**2. A refusal paged nobody and exited 0.** (gpt-5.5-pro, cohere)
The `plan.refusal` branch wrote a field and returned clean. **Fifteen lines
below**, the SOL-floor failure calls `NOTIFY` and sets `exitCode = 1`. Two
failures of one job, one function apart, disagreeing about whether a halt is
worth waking anyone — and the silent one is the halt *any stranger can trigger*.
`alarm.mjs` was the only path to a human. Now pages and exits non-zero; a quiet
day stays quiet.

### MEDIUM

**3. The hold clock could not see a hand payment.** (gpt-5.6-sol-pro, gpt-5.5-pro)
Round 17 fixed `holdDays` to stop counting rows and ask `paymentState` — then
accepted **one of that function's five answers**. `resolvedBy` covers two
readings the code's own comment names: "I paid it by hand" and "nothing landed".
Measured: an old payout 52 days back plus a hand-paid day two days ago returned
**52, not 2**. New `settledAsPayout()`; `paymentState` deliberately unchanged, so
no resend risk is introduced. **The default does not move** — a bare `resolvedBy`
still does not reset the clock, because not resetting pays people *sooner*, and
when a guess must be made it should guess toward paying. An operator who really
paid says so with `resolvedAs: 'paid'` — a field, not parsed prose. Proven four
ways.

**4. A repaired refusal stayed recorded as an active refusal.** (gpt-5.6-sol-pro)
`st.days[day].refused` was written and **cleared by nothing**. The operator's
repair path is "add the missing level, rerun the same day" — after which
`detectDistribution` goes on raising HIGH *"the distribution REFUSED and paid
nobody — every activated vault is unpaid"* on a day whose `paid` rows carry real
signatures. The only silencer was hand-editing the money ledger. A proceeding
plan now supersedes the refusal and records that it did.

**5. The control-table gate said "in the control table" and looked at the whole
file.** (gpt-5.6-sol-pro, gpt-5.5-pro)
`specSrc.includes(n)` — a name in body prose, a footnote or an example satisfied
a test whose title claims the name is in the table. The drift this arm was built
in round 17 to stop could survive it: delete the row, leave the word in a
paragraph, stay green. **It is the round-11 defect verbatim — cardinality where
attribution was needed — committed in the gate built to end a drift class.** Now
parses the table rows only, with an arm that moves a name into prose and proves
the old check goes blind while the new one fires.

**6. The audit runner could not fail, and did not.** (gpt-5.6-sol-pro, gpt-5.5-pro)
No minimum-auditor quorum, no non-zero exit, and `main().catch` only logged.
Now: a `disqualify()` that rejects failed requests, `finish_reason === 'length'`,
empty and error bodies, reasoning-only output, absurdly short reports and
degenerate repetition loops; a `MANIFEST-<focus>.json` receipt carrying HEAD,
tree-dirtiness and per-model status; and a non-zero exit below quorum.
**Validated both ways on real data: it rejects exactly tonight's two corpses and
passes all eight known-good programs reports — no false positives.**

**7. The prompt told every auditor the wrong architecture.** (gpt-5.6-sol-pro, gpt-5.5-pro)
`audit18.ts` stated *"daily **equal** payout"* — months after the allocator
became weighted by level — and quoted floors of **279/388/45** against a real
284/395/56. Auditors were handed the wrong allocation rule while auditing the
allocator that implements the right one. Floors are now **read from
`run-tests.sh`** at prompt-build time and can never disagree again; the payout
sentence describes the weighted schedule. *(Writing this found a second bug: the
first draft read the mainnet floor from a `FLOOR` constant that does not exist in
`probe-mainnet-facts.mjs`, and would have thrown at round-19 runtime. Caught by
running it.)*

### LOW

**8. Non-canonical base64 was accepted while the comment demanded canonical.**
(six auditors) Measured — all of these pass the alphabet, padding and length
checks and decode to bytes that re-encode differently: `====`, `A===`, `AB==`,
`AAB=`, `AAAA====`. **The same failure the round-17 comment directly above was
written to close** — paste one thing, decode another — reached through trailing
bits instead of truncation. A replacement check inheriting the defect of the
check it replaced, one line below the comment describing it. Now a decode →
re-encode → compare round trip, no new dependency, still before Node. Proven both
ways: five bypasses refused, round 17's two still refused, and real transactions
at 64/512/1000/**1232** bytes still accepted.

**9. `THE TRANSACTION IS NEVER AN ARGV BLOB … not in `ps`` is false.**
(gpt-5.6-sol-pro, gpt-5.5-pro) The last line is `exec node bank/cosign.mjs --tx
"$TX"`. The transaction is in the co-signer's argv for the life of the process.
An unsigned transaction is not a secret and this is not a key leak — **the claim
was the defect**. Removing it for real means teaching `cosign.mjs` to read stdin:
new surface inside the judgement file immediately before a freeze, so it is
written down as a limit instead. Comment corrected.

**10. `MINT_IX_BANK_IDX` was pinned by nothing.** (gpt-5.5-pro)
One integer stands between the Bank and a stranger spending it, and no test, gate
or assertion looked at it — while the *discriminator beside it* is pinned to its
sha256 derivation, because its first draft was fabricated. Reorder `MintVault`
and the confinement either refuses every honest mint or exempts the wrong slot,
green either way. Now parsed from the struct and asserted, with a reordering arm
that proves it fires.

**11. `BankKeyOutsideMint`'s message described one of its three emit sites.**
(gpt-5.5-pro) Since the exemption narrowed to positional identity the same error
fires when the instruction *is* a `mint_vault` but the Bank sits outside the
`bank` slot — exactly what test `9d.4` rejects. An operator refused for naming
the Bank as payer of a real mint was told "it is not a mint_vault". Rewritten.
*(Message text only; every test asserts this error by NAME, and `cargo check`
passes.)*

**12. `Object.hasOwn` reached one of three sites.** (gpt-5.5-pro)
Round 17 fixed a prototype-reachable level in `allocateWeighted` and stopped.
Measured on shipped code: `census({a:'constructor'})` produced a `constructor`
key valued `"function Object() { [native code] }1"` — `c[v] += 1` concatenating
onto a function — and `denominator(Object.create({I:999}))` returned **1998**,
read off the prototype. Not reachable in production, and **one-of-N-sites is this
repository's signature defect and is what round 18's own CRITICAL was.** Both
helpers fixed.

**13. The published dust bound overstated what a settlement retains by ~3×.**
(gpt-5.6-sol-pro) The comment claimed *"up to (denominator − 1) … up to 6,404"*.
Integer division leaves one fractional part per **paid vault**, each under a sat,
so the true bound is `dust < activated count` — at most **2,099**. Measured
across the full 2,100-vault census: worst observed **2,099**, never near 6,404.
The assertion asserted the loose bound and so could never have caught it. Both
corrected; a new arm asserts the tight bound across the real census.

**14. `audit18.ts` never created its output directory.** (gpt-5.5-pro)
A missing `OUT` threw into a catch that only logged. Fixed alongside 6.

---

## CARRIED — NOT FIXED, DELIBERATELY

**A. THE UNLEVELLED-VAULT HALT. This now needs Gary, not another round.**
**Six of six** off-chain auditors called it a public payout DoS, on top of **four
of eight** in the programs pass. Anyone who mints a vault and funds it to 21,000
sats before its `levels.json` entry exists stops **every** payout until an
operator edits a file. The author's standing argument is that halting is the
recoverable failure and excluding the vault would permanently overpay everyone
else. That argument is sound about *those two options* and does not address the
third, which two auditors supplied independently: **reserve for unknown vaults at
maximum weight and carry the remainder**, which underpays temporarily instead of
either overpaying permanently or halting. **When ten of fourteen independent
readers call a design wrong, the argument needs re-examination, not defence** —
but changing who gets paid is a product decision, not an audit repair.

**B. Bank-as-fee-payer on the MINT path.** (gpt-5.5-pro) The fee payer appears in
no instruction's account list, so no on-chain walk can see it; `judgeRedemptionTx`
is the only judge and there is no `judgeMintTx`. A mint transaction with
`feePayer = bank` drains Bank SOL via priority fees without tripping the
confinement. Accurate, and **already the accepted limit 1a — extended to mint.**
On-chain cannot fix it; only custody policy can, which Phase 0 established does
not live in this repository. **Goes on the Phase 1 list.**

**C. Compute units, now materially worse.** Both Bank-signature paths deserialize
every top-level instruction before their main work. Limit 12 was an undifferentiated
omission; four auditors argue it is now a release-blocking measurement. Agreed —
**promote it on the Phase 1 list**; the byte ceiling (1,232) is measured and the
CU ceiling is not.

**D. NEW LIMIT: the unsigned transaction is visible in `ps`** (finding 9's
mechanism, as opposed to its claim).

---

## REJECTED BY MEASUREMENT, NOT BY ARGUMENT — 6

1. **The `mint_vault` payer-slot theft is still live** (grok CRITICAL, mistral
   CRITICAL, cohere CRITICAL). The fix was in the bundle they read and cited. See
   the bundle section above.
2. **`seen_self` is insufficient — a malformed instruction mid-walk skips the
   rest** (grok, qwen, mistral, cohere). Refuted by gpt-5.6-sol-pro and correct:
   the instructions sysvar is **runtime-constructed and contiguous**; an attacker
   cannot insert a malformed hole into it, and the only `Err` is the end of the
   list. The before-current case already fails closed via `seen_self` itself.
3. **Invalid ledger day keys are a griefing surface** (grok, qwen, mistral,
   cohere). Measured: every `st.days[...]` write uses `day`, from `today()`. No
   customer path writes day keys. Anyone who can write that file already owns the
   money job. Both gpt models reached the same conclusion by asking who holds the
   write — the question the prompt asked. **Already asserted** (`an unparseable
   ledger day key is refused, not computed on`).
4. **The dust calculation is arithmetically wrong / floating-point error**
   (mistral HIGH). It is BigInt end to end; the worked example is wrong. The real
   dust defect was the *documented bound* — see accepted 13.
5. **Symbol keys bypass `Object.hasOwn`** (mistral). `Object.hasOwn(LEVEL_WEIGHTS,
   Symbol.hasInstance)` is `false`. The example does not do what it claims.
6. **`cosign.mjs` under-claims: "THE POLICY IS THIS FILE, AND IT IS SKIPPABLE"**
   (mistral CRITICAL). Already found by Gary and fixed in Phase 0 — the control
   table has carried three values with the ON-CHAIN one checked against the Rust
   since `128d61d`. Stale re-report.

---

## WHAT THIS ROUND COST ME, AND ONE THING THE SUITE CAUGHT

**A comment I wrote broke a source-scraping gate, and the gate was right to go
red.** Finding 9's correction quotes the exec line to explain the `ps` exposure —
and the assertion proving a `"$@"` pass-through would be caught works by
`replace()`ing the **first** `exec …cosign.mjs…` match in the file. That was now
my comment, so the tamper landed on prose, the real line survived, and the arm
could no longer prove what it claims. **A gate that reads source cannot tell code
from prose describing that code unless it is told to.** Hardened to strip
comments first, plus an arm asserting the real line is still there to be caught.

Counts, every floor moved to equal its real count:
**284 on-chain · 401 detector · 63 allocation · 19 mainnet.**

⚠️ **The on-chain suite was NOT re-run** (it needs a validator and a deploy). The
only `programs/` change is a `#[msg]` string; every test asserts that error by
NAME (`because('9d.1','BankKeyOutsideMint')`), and `cargo check -p
cbob-vault-mint` passes. It must still be run before the freeze.

## THE GATE

**Not clean. The counter does not start.** Round 18 accepted fourteen findings
across its two passes and both passes changed `programs/`, `bank/` and
`scripts/`. Rounds 17 and 18 ran against a *moving* tree; the freeze in
`audits/FREEZE.md` has never begun (Phases 1-4 all ⬜, log reads `pre-freeze`).
Every fix in this verdict is new unaudited code, which is the treadmill FREEZE.md
exists to leave. **Phase 1 is the next action, and it now has four more limits to
absorb.**
