# Round 19 audit (off-chain bundle + the `ec7d17e..HEAD` diff)

Rendered the prompt: floors appear as **286 / 427 / 79 / 19**, not as `${…}`. The R1 line that still shows `${FLOORS.onchain}` is the *intentionally* escaped example. I did not find another live interpolation that survived into this prompt as a placeholder. Arithmetic below is re-derived, not copied.

---

## R1 — Self-audit repairs

### R1-1 — `supersede` clears three skip marks and leaves the fourth unfinished suppressor
**HIGH**

**Construct.** `detectDistribution`'s unfinished arm is:

```js
rec.startedAt && !rec.finishedAt && !rec.nothingToDo && !rec.resolvedBy && day !== opts.today
```

Three things silence it: `finishedAt`, `nothingToDo`, `resolvedBy`. Round 19's comment lists those three, then `supersede` deletes a *different* three: `refused`, `nothingToDo`, `finishedAt`. `resolvedBy` is untouched.

```js
const was = [rec?.refused, rec?.nothingToDo].filter(Boolean)
if (!was.length) return { rec, superseded: false, … }
delete out.refused
delete out.nothingToDo
delete out.finishedAt
// resolvedBy stays
```

**What is gained / lost.** Documented operator path for a refusal:

1. Halt writes `refused` + `nothingToDo` + `finishedAt` and pages.
2. Human closes the HIGH with day-level `resolvedBy` (detectors.mjs says this is how you stop a nag).
3. Human adds the missing level and reruns the same day (the repair `supersede` exists for).
4. `supersede` clears the skip marks, plan is written, first transfers go out, process dies.
5. Next day: leftover `resolvedBy` keeps `distribution_unfinished` dark. Holders are unpaid and the watcher is quiet.

That is the finishedAt leftover again, reached through the flag the repair treated as someone else's problem.

**Evidence if true.** In `node`:

```js
detectDistribution({
  days: { '2026-08-20': {
    startedAt: 'x',
    resolvedBy: 'gary: level assigned',
    plan: { activated: ['v1','v2'], per: { v1:'100', v2:'100' } },
    paid: { v1: { sig: 'abc' }, v2: { sig: null } },
  }}
}, { today: '2026-08-21' }).map(f => f.kind)
```

Want: `['distribution_unfinished', …]`. Got: no `distribution_unfinished`.

Same shape the new `supersede` tests already pin for leftover `finishedAt`.

**Fix.** On proceed, delete day-level `resolvedBy` (record it in `supersededWas`). A day that is about to pay is not an abandoned day. Keep row-level `resolvedBy`. Add the detector case above next to the leftover-`finishedAt` assertion.

Quiet→pay, refuse→pay, pay→crash→resume, two live runs, and `--dry-run` in between are otherwise fine: dry-run does not call `supersede`; resume skips it; a skip after a skip just rewrites the skip marks.

### R1-2 — `isTableRow` is one definition; it is the right one for this table
No defect. Hoisted predicate is used by `tableRows`, `tableLines` / BankKeyOutside attribution, and the block-classification walk. It requires `| **ON-CHAIN|AUTOMATIC|PROCEDURE.**`. A real current row matches. A row that does not is rejected by “EVERY row in the control table block carries a classification”, which is the property you actually need. It will not see a classification written without the trailing period, or in a different column; the block walk makes that fail closed.

### R1-3 — Manifest porcelain
No defect. `dirty` is no longer `.trim()`’d; `split('\n').filter(Boolean)` keeps the leading status space; `JSON.stringify` keeps the record aligned. `WATCHED` is derived from `TARGETS` plus `programs/bank/scripts/tests`, so `SPEC.md` is visible to `dirty` even though it is still absent from `git diff … -- programs bank scripts tests`.

### R1-4 — Template literals after render
No live placeholder left in the prompt body except the escaped demonstration. Floors match `scripts/run-tests.sh`.

---

## R2 — Round-18 `distribute.mjs`

### R2-1 — `settledAsPayout` default direction
**Not backwards.** Larger `holdDays` is the first input that can satisfy `daysSinceLastPayout >= MAX_HOLD_DAYS` in `decideEmission` (only after `smallestPer >= 1`). Not treating a bare `resolvedBy` as a payout leaves the clock on the last real signature → `holdDays` stays large → ceiling fires **sooner**. Treating it as paid would reset to 2 and holders would wait. The new selftest (`52` vs `2` → `[true, false]`) is the right pin. Do not flip the default.

### R2-2 — `paymentState` still blocks re-send
Still true in every caller in this bundle. The pay loop continues on `'resolved'` regardless of `resolvedAs`. `settledAsPayout` is only used from `holdDays`. `detectDistribution` does not call either; it has its own row predicate (see R7).

### R2-3 — Refusal now pages
Not a new theft. The halt already existed; anyone who can activate an unlevelled vault already stops every payout. Paging that halt is the correct half of “a quiet day stays quiet; a REFUSAL pages.” Cost to grief-page is a mint + 21 000 sats, and the operator’s fix is one `levels.json` line. Exit code 1 under `--dry-run` is also right: a dry-run of a halt should not look clean.

Do not “fix” this by swallowing the page.

### R2-4 — `census` / `denominator` serialise
No defect. `return { ...c }` copies the null-prototype bag onto a normal object. `JSON.stringify` / `JSON.parse` round-trip. `denominator` uses `Object.hasOwn`. Nothing in this bundle required `Object.prototype` on that object.

### R2-5 — Dust bound
Re-derived: `dust = Σ_v (available · w_v mod den) / den`. Each remainder `< den`, so `dust ≤ N·(den−1)/den < N`, hence `dust ≤ N−1` on any paying run. Attained at `available = den−1` (6 404 → 2 099). Early-outs (`available` too small, unlevelled, empty activated set) return `dust = 0` against the full `activated` list, so `0 < N` holds whenever `N > 0`. Mid-run burns do not change `plan.dust`; those sats simply never leave the distributor and sit in the next drop.

The empty-set edge `0n < 0n` is false if anyone applies the inequality to `skip: 'no activated vaults'`. Not a money path.

### R2-6 — SPEC still publishes the number this repair retired
**MEDIUM**

**Construct.** `allocateWeighted`'s comment and the 79-assertion suite now say the disclosure figure is 2 099. `SPEC.md` still says:

> at 2,100 vaults the remainder can be up to **6,404** sats a settlement.

**Gain.** A holder reading the spec (the document that claims to be written FROM the implementation) is told the pool withholds ~3× what a settlement can actually retain. By this repo’s own rule — “a disclosure figure has to be the one that is TRUE, not merely one that holds” — SPEC is wrong. Same one-of-N as the comment fix.

**Evidence.** `grep -n '6,404\|6404' SPEC.md bank/distribute.mjs`. Suite assertion `dustAt(6404n) === 2099`.

**Fix.** Change SPEC to 2 099 and extend the SPEC-number gate (R6) to this figure.

---

## R3 — `scripts/bank-sign.sh`

No input found that passes alphabet + padding + `% 4` + GNU round-trip and still decodes to different bytes than pasted. Whitespace is stripped first; the pipe keeps NULs *between* `base64 -d` and `base64 -w0`; `$(…)` only sees ASCII. A 1 232-byte tx is 1 644 canonical characters and is accepted.

`base64 -w0` is a GNU coreutils flag. This host is Ubuntu; the script will fail **closed** (refuse everything) on a `base64` that rejects `-w0` or wraps at 76. That is operational, not a silent wrong-tx.

The corrected comment is true: this script’s argv is the filename; after `exec /usr/bin/env node bank/cosign.mjs --tx "$TX" …` the bytes are in `ps` for the life of the co-signer.

---

## R4 — `scripts/cron-install.sh` header

**The new header is true of the lines it installs.** Five tagged jobs:

| job | line as installed (fresh) | moves money? |
|---|---|---|
| watcher | `bank/alarm.mjs` | no |
| distribute | `bank/distribute.mjs` with `$DIST_DRY` empty | **yes — live cbBTC from next 09:07** |
| revenue | `bank/revenue.mjs` with `$REV_LIVE` empty | no (`--live` opt-in) |
| reconcile | `bank/alarm.mjs --reconcile` | no |
| deadman | `notify-gary-sms.sh` on stale/missing state | no |

Re-run: `ours()` keeps `--dry-run` / `--live` only from tagged, uncommented lines; the footer greps the crontab just written. A commented-out distribute line is *not* a preserve — a re-run puts a **live** distribute back. That matches “installing this arms a live sender,” not a hidden lie.

---

## R5 — Gates

### R5-1 — `isTableRow`
Sound for the table that exists. See R1-2. It will not match a classification that is not `**WORD.**` in some column; the block walk then fails the build. A real current row cannot miss it without also failing that walk.

### R5-2 — MintVault regex
Non-greedy `([\s\S]*?)\n}` dies at the first newline-brace. A `}` in a doc line before `bank` makes `indexOf('bank') === -1` vs declared `4` — fail **closed**. A brace after `bank` cannot change `bank`’s index. Adding a field *before* `bank` without an early brace moves the index and goes red. The injected-brace pins in selftest are the right ones. I would not call this open.

### R5-3 — `codeOnly`
Correct for this file. In shell, `#` is not a comment inside quotes, in `$#` / `${#TX}`, or after code on the same line. `^\s*#` only drops full-line comments. Trailing `# exec …` would still be a candidate; they now pin “exactly one `exec …cosign.mjs` line” so a second candidate is red. A quoted `#` at column 0 does not occur here.

### R5-4 — The two `nothingToDo` arms
They prove the **detector**: unfinished fires; a leftover `nothingToDo` suppresses it. They do **not** prove the writer clears the flag. That proof is in `distribute.mjs`’s `supersede` block, and it is real. The comment on the selftest arms over-claims. Not a money bug.

---

## R6 — Counts and card arithmetic

Floors in `scripts/run-tests.sh`: `MIN_ASSERTIONS=286`, `DET_FLOOR=427`, `ALLOC_FLOOR=79`, `MAINNET_FLOOR=19`. `bank/selftest.mjs` `FLOOR = 427`. `bank/distribute.mjs` `FLOOR = 79`. The “Running the tests” block in SPEC matches those four. The prompt interpolation matches.

Independent re-derive:

- 108+60+36+24+12 = 240; `108·2+60·3+36·4+24·5+12·6` = 216+180+144+120+72 = **732**
- 945+525+315+210+105 = 2100; `945·2+525·3+315·4+210·5+105·6` = 1890+1575+1260+1050+630 = **6 405**
- per $1 000 @ 240: 2000/732, 3000/732, … → **2.73, 4.10, 5.46, 6.83, 8.20**
- per $1 000 @ 2 100: 2000/6405, … → **0.31, 0.47, 0.62, 0.78, 0.94**
- shares @ 2 100: 189000/6405, 157500/6405, 126000/6405, 105000/6405, 63000/6405 → **29.5, 24.6, 19.7, 16.4, 9.8**; rounded sum **100.0**. V/I = 6/2 = 3.

Card figures in the allocator selftest are right. SPEC’s *other* copies of the suite sizes are not (R7).

---

## R7 — One-of-N inside the fixes

### R7-1 — `settledAsPayout` is the only cadence reader
In the delivered files, yes. `holdDays` is the only clock. `paymentState` callers (pay loop, SOL-floor `outstanding` filter, selftest) still treat `resolved` as settled and do not re-send. I did not find a second site that asks `paymentState(row) === 'paid'` for cadence.

### R7-2 — `judgeAck` still accepts date-shaped impossibles
**MEDIUM**

**Construct.** `holdDays` now requires a round-trip (`realDay`). `judgeAck` still does:

```js
/^\d{4}-\d{2}-\d{2}$/.test(entry.until)
const expiry = Date.parse(`${entry.until}T23:59:59Z`)
if (!Number.isFinite(expiry)) …
```

`2026-02-30` is finite (rolls to 2 March). The selftest only refuses `2026-13-45`, which V8 already makes `NaN`. The assertion named “unreal date” does not cover the case they just called a certified bug one file over.

**Gain.** An ack typed `2026-02-30` expires on a different day than the operator wrote. Not a theft; same class they just spent a round killing.

**Evidence.** `judgeAck({ why: 'x', until: '2026-02-30' }).ok` is `true`. `realDay('2026-02-30')` is `false`.

**Fix.** One `realDay` (or the same round-trip) for every `YYYY-MM-DD` in the tree; point the ack test at `2026-02-30`.

### R7-3 — SPEC assertion counts gated in one block, left stale in two others
**MEDIUM**

The new gate checks the “Running the tests” paragraph. SPEC still says:

- `bank/selftest.mjs` **(69 assertions)** — floor is **427**
- `node bank/distribute.mjs --selftest` **# 63 allocation assertions** — floor is **79**

This is the exact sentence they already wrote about stale counts teaching the reader that floors are decorative — applied to one of three sites.

**Evidence.** Those two strings are still in `SPEC.md`. The gate regexes do not see them.

**Fix.** Kill the extra numbers, or make the gate extract every integer that claims to be a suite size.

---

## Carry-over list

Nothing listed as a limit looked newly exploitable from this bundle, except:

- **#12 CU** is still unmeasured and MINT’s per-account walk made the mint path heavier. Still not shown to strand honest mints; an attacker padding *their* mint only burns their own tx. Do not re-file as a finding; do measure before mainnet.
- **#3** (“Bank may be `payer` inside the pair”) is still true of open/burn. It is **no longer** true of `mint_vault`. Anyone generalising #3 to “Bank as payer is always exempt” is now wrong — the product is stronger than that sentence. See under-claims.
- **#17** `EMISSION_MIN_PER_VAULT = 21` is still provisional and still the live constant. No accidental ratification in code.

---

## Third target — under-claims (safer than the docs)

### U-1 — Control table still understates who must co-sign a mint
**MEDIUM** (same shape the owner caught)

Three programs take `bank: Signer` and `require_keys_eq!` it. Row 1 names SEAL + BURN for unsealing/burn. Row 2 names MINT only for *confinement* (`BankKeyOutsideMint`). There is no ON-CHAIN row that says **you cannot `mint_vault` without the Bank**.

The selftest was deliberately relaxed to `>= 5` and even includes a fixture titled “a TRUE extra ON-CHAIN row … does NOT break the build” — then nobody added the row. The gate now *allows* the truer table and does not *require* it.

A buyer reading only the table can still think the Bank is a redemption party and that minting is just a sale. It is not: every activation is a 2-of-2.

**Evidence.** Table text vs `programs/cbob-vault-mint/src/lib.rs` `pub bank: Signer` + `require_keys_eq!`. `bankErrs` is only scraped from SEAL and MINT *confinement* errors, so a missing “mint refuses without the Bank” row cannot turn the suite red.

**Fix.** One ON-CHAIN row for MINT’s required Bank signature (or widen row 1 to all three programs). Assert the table names every program for which `onChainBankPin` is true — not merely that named programs are honest.

### U-2 — Known-limit #3 understates MINT
Limit 3 still reads as a general “confinement exempts approved instructions entirely.” MINT no longer exempts the instruction: Bank may appear only at index 4. Safer than the limit list says. Tighten #3 to “inside the open/burn pair only.”

---

## Verdict challenges / other

No new CRITICAL theft in this diff. The mint payer-slot fix is positional, pinned to a parsed `MintVault`, and 9d.4 refuses the exact theft. I did not find a second instruction that wears `IX_MINT_VAULT_DISC` and still spends the Bank as payer.

I did not find a canonical-base64 string this wrapper accepts that GNU then hands Node as different bytes.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Do not add another comment-scraper. Sixteen rounds are already better at reading comments than at running the ops path those comments describe.

Do these, concretely:

1. **One process, writer then detector, on disk.** A fixture that is not a unit test of `supersede` *or* of `detectDistribution`, but: write a quiet morning into a temp ledger, set `resolvedBy`, run the proceed path until after the first `save` of a `sig: null` intent, kill it, run `detectDistribution` on the file. That is the only test that would have gone red on R1-1. The current suite still cannot see an ordering bug that lives *between* two pure functions.

2. **One date function, grep-enforced.** `realDay` exists. `judgeAck`, any new `until`, any ledger key, any cron parser must call it. A selftest that `grep`s `Date.parse(` in `bank/` and fails unless the next token is a `realDay`-validated string. You will otherwise keep fixing `2026-02-30` in whichever file the last round named.

3. **One number table, generated.** Census, denominator, per-$1 000, shares, dust max, assertion floors — emit a `bank/card.json` from the weights and floors, and have SPEC / the prompt / the selftest all read it. The 6 404 / 69 / 63 leftovers are what you get when humans update the suite block and not the paragraphs.

4. **Run `bank-sign.sh` on a real serialized tx on this box**, not a regex over its source. The GNU `-w0` + `$(…)` trailing-newline dance is correct *here* and invisible to every gate that only reads text. One `./scripts/bank-sign.sh /tmp/real.b64` in `run-tests.sh` (inspect-only) closes a class Phase 0 already paid for.

5. **Stop letting the builder write the next prompt.** The last eight worst defects lived in the previous repair; the self-audit then missed `resolvedBy` in the function it wrote to clear suppressors. Commission the next roster against a prompt authored from the MANIFEST + `git diff` by a model that did not author the diff. That is the cheapest substitute for a firm that will never exist.

6. **Measure compute units on the mint walk and the redemption pair** before the first live mint. Limit 12 is now the only unmeasured ceiling that can turn an honest Bank-signed mint into a mysterious fail, and nobody in this process can see it from source.