# Round 19 audit (ec7d17e..HEAD)

No CRITICAL that I can defend with on-chain or runnable evidence. Several HIGH/MEDIUM items are the same shape this repo keeps shipping: a fix applied to one of N sites, and documentation that is *weaker* than the code.

---

## R1 — Self-audit repairs

### Template literals (rendered, not just read)

**No extra escaped-floor defect.** The prompt I received renders `286` / `434` / `93` / `19`. The only leftover `${FLOORS.onchain}` is the R1 sentence that is *about* that bug. `\$CBOB` rendered as `$CBOB`.

Evidence if I were wrong: the paragraph that starts “All four programs pass a” would still contain `${FLOORS.onchain}` or `286` would disagree with `MIN_ASSERTIONS` in `scripts/run-tests.sh`.

### `isTableRow`

One definition, used by `tableRows`, `tableLines`, the block classifier, and the “moved name” fixture. Predicate:

```js
/^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/
```

It needs a pipe, a space, then `**CLASS.**` (period *inside* bold). That matches the five live rows.

What it misses: `**ON-CHAIN**` without the period, period outside bold, or classification not preceded by `| `. Those fail **closed** — `EVERY row in the control table block carries a classification` goes red.

A real row in the current table format will match. A wrapped/multi-line markdown row would not; they do not have one.

### `supersede` / clearing flags

Clearing `refused` + every detector suppressor (`finishedAt`, `nothingToDo`, `resolvedBy`) is correct for the orderings asked:

| ordering | what happens |
|---|---|
| quiet then pay | skip wrote `nothingToDo`+`finishedAt`; pay path supersedes, then writes `plan`. Crash ⇒ unfinished fires. |
| refuse then pay | same, plus `refused` deleted so you do not get a permanent “paid nobody” HIGH on a day with signatures. |
| pay then crash then resume | `plan` exists ⇒ resume, **never** calls `supersede`. |
| two live runs one day | second is resume. |
| `--dry-run` in between | `!DRY` guard; dry-run does not write skip flags or supersede. |

`alreadyPaid` restoring `finishedAt` is not reachable from `main()` (resume / dry-run). It is the right belt for an exported function.

A day does **not** lose a flag it still needs on those paths. Skip-then-resolve-then-still-unlevelled never reaches `supersede` (still `plan.skip`).

Evidence if this were wrong: a fixture `{ nothingToDo, finishedAt }` + crash-shaped `{ plan, no finishedAt }` would stay quiet in `detectDistribution` — the selftest already asserts the opposite.

### Manifest porcelain

`dirty` is no longer `.trim()`’d. `split('\n').filter(Boolean)` keeps the leading status space. JSON array of porcelain lines is well-formed. `WATCHED` is derived from `TARGETS` plus `programs/bank/scripts/tests`, so `SPEC.md` is visible and `audits/` is not.

---

## R2 — Round-18 `distribute.mjs`

### `settledAsPayout` default direction — builder is **not** backwards

`holdDays` larger ⇒ `daysSinceLastPayout >= MAX_HOLD_DAYS` sooner ⇒ `decideEmission` pays **earlier**.

A bare `resolvedBy` does **not** reset the clock ⇒ larger `holdDays` ⇒ ceiling fires sooner. Treating a bare resolve as paid would **delay** holders. The default is the direction they claimed.

Traced: last real sig `2026-07-02`, bare resolve `2026-08-21`, today `2026-08-23` ⇒ 52 days ⇒ `smallestPer: 1n` is forced. Same row with `resolvedAs: 'paid'` ⇒ 2 days ⇒ hold. Their new assertion is the right measurement.

### `paymentState` still blocks re-send

The pay loop still `continue`s on `'resolved'` regardless of `resolvedAs`. `settledAsPayout` is only used by `holdDays` and `supersede`’s `alreadyPaid`. I did not find a third cadence reader. Detectors still roll their own `sig`/`rejected`/`resolvedBy` predicates (pre-existing split brain, not a new conflation of “paid out”).

### Refusal ⇒ NOTIFY + `exitCode = 1`

Intentional, and the comment overstates the grief. A stranger cannot **mint** an unlevelled vault (MINT takes `bank: Signer`). They can only activate a vault the Bank already minted and failed to put in `levels.json` (anyone can push 21 000 sats into a PDA ATA). That is an ops hole becoming a daily page, not a free grief button.

`--dry-run` still exiting 1 is not a money bug. Cron does not use `--dry-run`. A CI health check will go red on an unlevelled vault; they said that is the signal.

Not filing this as a defect.

### `census` / `denominator`

`{ ...c }` is a normal-prototype object. `JSON.stringify` / `JSON.parse` through the ledger is fine. `denominator` uses `Object.hasOwn`. No consumer in this bundle needs a null prototype. `plan.census[l] || 0` still prints `0` correctly.

### Dust bound — re-derived, holds

For a produced plan every activated vault gets `floor(available * w / den)`. Dust is the sum of N fractional parts, each in `[0,1)` ⇒ `dust ≤ N-1` ⇒ `dust < activated.length`.

- Unlevelled ⇒ refusal, no plan.
- `smallest < 1` ⇒ skip, `dust = 0`.
- Unactivated vaults are not in `activated`.
- Attained at `available = 6404`, den `6405`: every level gets `w-1` ⇒ dust `2099 = 2100-1`.

The old `denominator-1 = 6404` figure is a real but loose bound. The tight one is correct. SPEC’s `**2,099**` matches (gated).

---

## R3 — `scripts/bank-sign.sh`

I did **not** find a string that passes the new gate and decodes to different bytes than pasted, given:

- whitespace stripped first
- alphabet / mid-pad / `% 4` still applied
- GNU decode → GNU `-w0` encode → string equality
- `CANON=$(...)` strips the trailing newline `base64 -w0` usually adds, which is what makes a legitimate blob compare equal
- `|| true` + empty `CANON` **refuses** (missing `base64 -w0` fails closed). Their selftest that claims this is only as good as the error-text classifier (see R5), but the mechanism is fail-closed.

Legitimate 1232-byte tx (1644 chars) is a standard padded multiple of 4. No reason for GNU round-trip to reject it on Ubuntu.

URL-safe base64 is rejected by the alphabet check (correct: Node would not treat it as the same codec).

### Comment vs last line — **LOW**

The comment says the last line is `exec node bank/cosign.mjs --tx "$TX"`. The last line is:

```bash
exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ${LIVE[@]+"${LIVE[@]}"}
```

The **claim that `$TX` is in `ps`** is true. The quoted command is not. The “not in this script’s argv / history” half is true.

Evidence: `ps` on a live `--live` run shows the base64 after `--tx`; `history` shows `bank-sign.sh file.b64`.

---

## R4 — `cron-install.sh` header

Read from the heredoc, not the header.

| job | line | moves money as installed? |
|---|---|---|
| watcher | `bank/alarm.mjs` | no |
| **distribute** | `bank/distribute.mjs$DIST_DRY` | **YES on a fresh crontab** (`DIST_DRY` empty). Only dry if a tagged uncommented `--dry-run` was preserved. |
| **revenue** | `bank/revenue.mjs$REV_LIVE` | **no** on fresh (`REV_LIVE` empty). Yes only if tagged uncommented `--live` preserved. |
| reconcile | `alarm.mjs --reconcile` | no |
| deadman | `notify-gary-sms.sh` | no (SMS only) |

The new header is true for a fresh install and for a re-run. The computed “MONEY POSTURE AS INSTALLED” block matches those two flags. `ours()` only reads tagged, non-comment lines — the three cases that used to arm `--live` from prose no longer do (and the selftest actually execs that slice).

---

## R5 — Gates

### `isTableRow` as “a row”

Sound for this table. Misses non-conforming classification (fail closed via the block scan). Does **not** miss a current control row.

Hole: a new `|` row *after* a blank line is outside `controlTableBlock` and is never classified. Their table has no blank line. Fail-open only if someone splits the table.

### MintVault regex

Non-greedy to first `\n}`. A `}` line before `pub bank` makes `indexOf('bank') === -1` ≠ `4` ⇒ suite red (fail closed). A `}` after `bank` cannot move `bank`’s index. Pinned in both directions. Not an open fail.

### `codeOnly`

`/^\s*#/` is correct for “full-line comment” in this file. A `#` that is not a comment (`echo "a # b"`, `$#`, trailing `# note`) does not start the line and is kept. They also pinned “exactly one `^\s*exec .*cosign.mjs` in code,” which is the actual first-match bug.

A heredoc line starting with `#` would be stripped; `bank-sign.sh` has none.

### Stale `nothingToDo` arms

They prove the **detector**: unfinished fires without the flag and is silent with it. They do **not** prove the writer clears it. That proof is in `distribute.mjs --selftest` on `supersede`. The comment “which is why the writer clears it” over-claims what those two `t()` calls do. Gate gap, not a money bug.

---

## R6 — Floors and card arithmetic

`scripts/run-tests.sh`: `MIN_ASSERTIONS=286`, `DET_FLOOR=434`, `ALLOC_FLOOR=93`, `MAINNET_FLOOR=19`.

`bank/selftest.mjs` `FLOOR = 434`. `bank/distribute.mjs` `FLOOR = 93`. SPEC’s “Running the tests” block matches those four.

Independent re-derive (weights 2/3/4/5/6):

- 108+60+36+24+12 = 240; `108·2+60·3+36·4+24·5+12·6` = **732**
- 945+525+315+210+105 = 2100; `945·2+525·3+315·4+210·5+105·6` = **6405**
- per $1 000 @ 240: **2.73 / 4.10 / 5.46 / 6.83 / 8.20**
- per $1 000 @ 2100: **0.31 / 0.47 / 0.62 / 0.78 / 0.94**
- shares @ 2100: **29.5 / 24.6 / 19.7 / 16.4 / 9.8** (exact mass 100%; displayed sum 100.0)

Card figures are not wrong.

### HIGH-adjacent documentation miss (same class as the floor drift they just fixed)

SPEC still says:

- `node bank/distribute.mjs --selftest   # 63 allocation assertions`
- `bank/selftest.mjs (69 assertions)` in the alarm section

The new gate only regexes `# (\d+) assertions, real cloned Core`, `(+ (\d+) detector`, and `(\d+) allocation and \d+ live-mainnet`. **One of N sites.** A reader of the command list is taught the floors are decorative — the exact failure they wrote the gate to stop.

Evidence: those two strings are in `SPEC.md` today; `ALLOC_FLOOR` is 93; `DET_FLOOR` is 434.

Fix: one source for every published count, or extend the SPEC scrape to every `\d+ assertion` mention.

---

## R7 — Self-audit claim, and one-of-N inside the fixes

**Cadence claim:** `settledAsPayout` is the only site asking “did money land?” for the hold clock. `paymentState` callers still use it only as “do not re-send.” That claim holds in this bundle.

**Fixes not applied to every site of the same shape:**

1. **`realDay` was not applied to `judgeAck`.** `until` is only `/^\d{4}-\d{2}-\d{2}$/` then `Date.parse`. `2026-02-30` rolls to March 2 and is accepted. Selftest uses `2026-13-45` (invalid) and never `2026-02-30`. Same bug they just removed from `holdDays`, one file over.  
   Evidence: `node -e` `Date.parse('2026-02-30T23:59:59Z')` is finite; `judgeAck({why:'x',until:'2026-02-30'}).ok === true`.  
   Impact: LOW (ack lasts until March 2, not a payout).  
   Fix: share `realDay`.

2. **SPEC assertion counts** — above.

3. **They loosened `rows.length === 5` to `>= 5` so a third Bank-pin row would not fail the build, then did not add that row.** The comment in `selftest.mjs` says the quiet part out loud: “Three programs pin the Bank’s signature; the table names two.” That is R7 and the third target at once.

`holdDays` still says “`paymentState` is the ONE authority on what paid means” while the code under it calls `settledAsPayout`. Comment drift, LOW.

---

## Third target — safer than the docs (owner’s shape)

### HIGH — Control table understates two on-chain Bank guarantees

**Construct.** SPEC’s control table is defined as the one place that states what runs.

Row 1 (“THE BANK MUST SIGN AT ALL”) is only unsealing/burn, SEAL + BURN.  
Row 2 (“KEY IS CONFINED”) says MINT “refuses `BankKeyOutsideMint` **outside a `mint_vault`**.”

**What the code actually does.** `mint_vault` takes `bank: Signer` and `require_keys_eq!` (or the ON-CHAIN gate would already be red). Every mint is 2-of-2. After round 18, a `mint_vault` is **not** fully exempt: the Bank may appear only at index `MINT_IX_BANK_IDX` (4). Payer (5), owner (3), remaining accounts — all refused. That is the CRITICAL they just closed.

**What an accident gains.** A reader (or a future editor) treats `mint_vault` as a blanket exemption — the exact hole 9d.4 exists to reject. The table also tells a buyer the Bank is mandatory for redemption only, not issuance.

**Evidence.** Diff hunk on `programs/cbob-vault-mint/src/lib.rs` (`require!(a.pubkey != bank || n == MINT_IX_BANK_IDX)`). Table text in `SPEC.md` as bundled. `onChainBankPin` succeeding for MINT in a green 434-assert run.

**Fix.**  
- Row 1 (or a new ON-CHAIN row): MINT refuses a mint without the Bank. The suite already allows `>= 5` rows.  
- Row 2: Bank may appear in `mint_vault` **only** in the `bank` slot (index 4), not “anywhere in a mint.”

No gate can see this. Every existing gate checks “claim too strong,” not “claim too weak.”

---

## Carry-over list

Nothing listed as a limit looks newly exploitable beyond what is already written.

- **12 (CU)** is still unmeasured. The mint walk + per-account loop makes a mint more expensive. Still availability, still not a theft. Do not treat “unmeasured” as “will fail”; do not treat it as fine either.
- **1a / 3**: fee payer still invisible to both walks. Bank as mint fee-payer can still burn Bank SOL on priority fees. Unchanged.
- **16**: level register still the Bank’s word. Code has not accidentally added a VRF or a commitment.
- **17**: `EMISSION_MIN_PER_VAULT = 21` still provisional.
- **18**: no accidental upgrade-cost or FOMC gate in this diff.

The “any stranger triggers a halt” sentence is **weaker** than written (mint needs the Bank). Not worse.

---

## Verdict challenges

I am not confirming the self-audit. The four repairs (escape, hoist, clear-both → clear-all-suppressors, porcelain) look like they do what they say, **and** the same commit left the owner’s under-claim class live on the control table and left SPEC counts wrong in the lines the new gate does not read. That is not a clean repair round.

---

## Other

**LOW** — skip path sets `refused` and `nothingToDo` to the **same** `plan.skip` string, so `supersededWas` becomes `"msg + msg"`. The selftest uses two different strings and never sees this.

**LOW** — `bank-sign.sh` selftest `run()` treats any non-matching error as `past-the-gate`. A crash in `cosign` after a **correct** refuse that used different wording would also read as pass. Current refuse strings match. Brittle.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Sixteen rounds of the same process will keep catching over-claims and one-of-N copies that look like the last finding. They will keep missing:

1. **Under-claims.** Add a gate that fails when Rust enforces a Bank pin (or a confinement stronger than “whole ix exempt”) that the control table does not state. The suite already parses both sides; it only errors in one direction. Invert it.

2. **Run the money job against a hostile ledger, not fixtures.** `supersede`, `holdDays`, and `paymentState` are proven as pure functions. They are not proven as a day that a human edited, a cron re-ran, and `alarm.mjs` read. One recorded integration: write a real `distributions.json`, kill the process mid-loop, run alarm, resume, assert the page that must fire and the transfer that must not.

3. **Measure CU on the actual mint and redemption envelopes** (limit 12). A number, on the suite, for the worst-case account list you already serialize in 9.14. AI will not produce that number by reading source.

4. **Stop certifying documentation with regexes that match one sentence.** SPEC still has `63` and `69` next to a gate that only knows three patterns. Either generate the “Running the tests” block from `run-tests.sh`, or delete the handwritten numbers.

5. **Do not let the next roster re-read this prompt’s own self-refutation list and call that coverage.** Change who reads, and give them the rendered prompt plus a checkout they can execute. A model that cannot run `node bank/distribute.mjs --selftest` and `bash scripts/bank-sign.sh` will keep filing the two findings you already pinned as false.