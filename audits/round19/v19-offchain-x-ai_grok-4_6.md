## R1 — Self-audit repairs

### HIGH — Proceeding after a no-pay verdict clears two flags and leaves the third (`finishedAt`)
**Construct.** A skip day writes three “this day is done” marks together:

```javascript
st.days[day].nothingToDo = plan.skip
if (plan.refusal) st.days[day].refused = plan.skip
st.days[day].finishedAt = new Date().toISOString()
```

A later run that actually pays deletes two of them:

```javascript
delete st.days[day].refused
delete st.days[day].nothingToDo
// finishedAt is not deleted
st.days[day].plan = { ... }
```

At end of a **partial** pay, `finishedAt` is only assigned when every transfer succeeded:

```javascript
if (!failed.length && !ambiguous.length) st.days[day].finishedAt = new Date().toISOString()
```

So it is never cleared, and not overwritten on the exact path the self-audit named as dangerous (quiet/refuse morning → afternoon pays only part of the set).

The self-audit already said the first version of this repair “cleared one of two.” This version clears two of three. `finishedAt` is the original suppressor: the skip path sets it so a quiet day will not raise `distribution_unfinished` (“Leaving it open raised a HIGH”). The new tests prove `nothingToDo` also suppresses that finding **by itself**. Either flag is enough.

**What is gained / lost.** Quiet 09:07 (volume below threshold) writes `nothingToDo` + `finishedAt`. Afternoon rerun (or a repaired refusal) writes a plan, clears `nothingToDo`/`refused`, sends some transfers, then hits a frozen ATA / confirmation timeout. Holders are unpaid, `finishedAt` is still the morning timestamp, and the unfinished alarm stays dark. Same fail-open the repair exists to close.

**Evidence that would exist if this is true.**
1. In `bank/detectors.mjs`, the `distribution_unfinished` predicate treats `finishedAt` and/or `nothingToDo` as a suppressor. If it is only `nothingToDo`, this finding is **wrong** — say so after that read.
2. Fixture: `{ startedAt, finishedAt: 'morning', paid: { v1: { sig: 'x' }, v2: { sig: null } } }` → `detectDistribution` next day returns **no** `distribution_unfinished`.
3. Live ordering: one `--dry-run` is not enough; need a real skip save, then a live proceed that leaves an ambiguous row.

**Fix.** On proceed, delete `finishedAt` with the other two (or set `finishedAt = null`). Add the fixture above to `selftest.mjs`. Do not consider the writer tested until a test calls the same mutation the money job performs.

### MEDIUM — `isTableRow` is one definition, but it is a format bet, not a row detector
**Construct.**

```javascript
const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)
```

It is hoisted and used by `tableRows`, `tableLines`, and the “name only in prose” arm. One definition, three readers — that part is real.

**What it misses.** A control row that is `**ON-CHAIN**` (period outside bold), `**ON-CHAIN**` without the trailing period, a fourth label (`OFF-CHAIN`, `HYBRID`), a wrapped row, or `|**ON-CHAIN.**|` with no space after the pipe. Those lines drop out of `tableSrc`.

**Fail direction.** Forgetting a `BankKeyOutside*` name in a *matching* row still goes red (good). A real control row that does not match the regex is **invisible** to the claim-checker — fail-open for the thing the gate exists to catch. A name that lives only on a missed row also fails the “every refusal is named in the table” arm (fail-closed noise).

**Evidence.** `grep` SPEC’s control table for `^\|` lines and print those that do **not** match `isTableRow`. If that set is non-empty, the predicate is already wrong. SPEC.md is not in this bundle, so this is unverified against the live table.

### LOW — Manifest record is well-formed; the dirty *display* still uses the raw blob
Not trimming porcelain is correct: ` XY path` keeps the leading status space; `split('\n').filter(Boolean)` only drops the trailing empty line; `JSON.stringify` preserves the space.

`dirty?'  ⚠️ DIRTY TREE'` still keys off the **raw** `execSync` string, not the filtered array. Clean tree → `''` → falsy. That is fine. A porcelain line that is only whitespace would theoretically warn without a JSON entry; GNU porcelain does not emit that.

**Evidence.** `MANIFEST-offchain.json` → `dirty` is an array of strings whose first two characters are the status field, including a leading space on ` M` / ` D` rows.

### Template / escaping (rendered, not guessed)
In the prompt I received, `${FLOORS.onchain}` in R1 is **literal text** (the documented escape). The suite line rendered as `284` / `403` / `63` / `19` — interpolation works there.

**What reading the source cannot see, and rendering does:**

- R1 says the subject is `ec7d17e..HEAD`. The heading over the pasted diff still says `2c8cd9b..HEAD — every repair round 17 made`. `DIFF` is computed from `ec7d17e..HEAD`. The prompt contradicts itself about what is under audit.
- `THE AUTHOR'S OWN VERDICT ON ROUND 15` / “round 17’s verdict is being written” is leftover `audit18.ts` prose.
- `audit19.ts` still carries “SAME ROSTER AS ROUND 16” above a list that the next comment says was **not** used in round 18.

**Evidence.** This prompt body, as rendered. `grep` the written prompt file for `2c8cd9b` and `\${`.

Not CRITICAL: the actual diff is still inlined. It is the same class as shipping a floor as the characters `$` `{` `FLOORS.onchain` `}` — a certification instrument that describes the wrong object.

---

## R2 — Round-18 `distribute.mjs`

### Direction of `settledAsPayout` — builder is **not** backwards
`decideEmission`: pay if `smallestPer >= 21`; else pay if `daysSinceLastPayout >= 31`; else hold.

Larger `holdDays` → ceiling fires sooner → holders are paid **earlier**. A bare `resolvedBy` does not reset the clock → `holdDays` stays large (test: `2,52`) → force-pay sooner. Treating an unknown resolution as paid would reset to ~2 and make people wait up to 29 more days. The default matches the stated policy.

No finding.

### `paymentState` still blocks re-send
Send loop: `paid` / `resolved` / `skipped` continue; only `unpaid` is sent. SOL budget uses `paymentState(row) === 'unpaid'`. `settledAsPayout` is cadence-only. Inside this file the “never re-send a resolved row” claim holds.

**Not proven globally.** `detectors.mjs` / `alarm.mjs` are not in the bundle (R7).

### Refusal → NOTIFY + `exitCode = 1` is not the bug
A halt that stops every holder’s payout **should** page. `--dry-run` still sets `exitCode = 1` (not the notify). That is a check-mode signal, not a paging surface.

The comment “any stranger can trigger” is **stronger than the chain**. `mint_vault` requires `bank: Signer`. A stranger cannot mint. They can only fund a vault the Bank already signed that is missing from `levels.json`. That is an operator gap after a Bank-signed mint, not a permissionless grief. Over-claim, not a new halt.

No money finding. The stranger wording is LOW documentation.

### `census` serialise
`return { ...c }` is a normal-prototype object. `JSON.stringify` / `parse` round-trips `I..V`. `denominator` uses `Object.hasOwn`. No consumer in this file needed a null prototype. No finding.

### Dust bound — re-derived, holds on paying plans
`dust = available - Σ floor(available * w_i / den) = Σ {available * w_i / den}`. Each fractional part is in `[0,1)`, so for `n >= 1` paying vaults, `dust ≤ n-1`.

- Unactivated vaults are not in `activated`. Bound is vs the paid set.
- `available < n` with `minPerVault = 1` → `smallest < 1` → skip, `dust = 0`.
- Mid-run burns happen **after** allocation; they do not change the division dust.
- `n = 0` returns `dust = 0`; `0 < 0` is false, but that path never pays.

Card figure “2,099 at 2,100 vaults” is the right bound. `6,405` is the denominator, not the dust. No finding.

### MEDIUM — The two new selftest arms do **not** prove the writer
They prove: partial day → unfinished; same day plus `nothingToDo` → quiet. That is the **detector** half (why a stale flag is dangerous). They never run the proceed mutation, and they never mention `finishedAt`. A gate named “which is why the writer clears it” that does not touch the writer is the 173-pinning shape: the name claims a fix, the body tests something else.

**Evidence.** `bank/selftest.mjs` around those two `t(...)` calls: no import of the proceed path, no `finishedAt` in the fixtures.

---

## R3 — `scripts/bank-sign.sh`

Round-trip via GNU `base64 -d | base64 -w0` rejects `====`, `A===`, `AB==`, `AAB=`, `AAAA====` as claimed. Whitespace is stripped first. Empty is refused. `|| true` + empty `CANON` is fail-closed.

I did **not** find a string this host would accept that Node then decodes to different bytes, given alphabet + padding-at-end + `len % 4 == 0` + GNU canonical equality. A 1232-byte tx is 1644 characters, one `=`, and is a normal GNU encode.

Residual (fail-closed, not theft):
- `base64 -w0` is GNU coreutils. Without it, `CANON` is empty/wrapped and **every** real tx is refused.
- `$(...)` strips trailing newlines; `-w0` output has none, so comparison is fine.
- `set -euo pipefail` + failing decode → `CANON="" || true` → refuse.

**Legitimate reject:** only if this script is run off Ubuntu without GNU `-w0`. This box is ubuntu; cron already assumes that.

**Comment about `ps`:** true. Last line is `exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ...`. `$TX` is in that process’s argv. The comment still says `exec node bank/cosign.mjs --tx "$TX"` — same exposure, wrong argv[0] chain. LOW nit. The claim “it IS in `ps`” is correct.

---

## R4 — `scripts/cron-install.sh`

Jobs the heredoc installs:

| tag | line | money as installed? |
|---|---|---|
| watcher | `bank/alarm.mjs` | No (monitor) |
| **distribute** | `bank/distribute.mjs` **without** `--dry-run` | **Yes. Live cbBTC from next 09:07.** |
| revenue | `bank/revenue.mjs` + `$REV_LIVE` | No on a fresh install; **yes if** an existing line had `--live` (preserved) |
| reconcile | `bank/alarm.mjs --reconcile` | No (state snapshot) |
| deadman | `notify-gary-sms.sh` | No (SMS) |

Default header is true: revenue is opt-in and omitted; distribute is opt-out and armed.

### LOW — Post-install summary can say revenue is dormant when it is not
If `grep -q "revenue.mjs --live"` hits, the script keeps `--live` and prints `NOTE: ... keeping it`, then **unconditionally**:

```
echo "  revenue     ... DORMANT: add --live when ready."
echo "      revenue is the only job this script leaves dormant."
```

**Evidence.** Re-run `cron-install.sh` against a crontab that already has `--live`; the installed line has `--live` and the footer still says DORMANT.

**Fix.** Branch those echoes on `REV_LIVE`.

---

## R5 — Gates

**`isTableRow`:** see R1. Sound only if every control row still uses `| **ON-CHAIN.**` / `AUTOMATIC` / `PROCEDURE` with the period inside the bold.

**MintVault regex** `\{([\s\S]*?)\n\}`: first newline-brace wins. A `}`-only line in a comment/attribute would truncate the body. `indexOf('bank')` then becomes `-1` ≠ `4` → assertion red. **Fail-closed.** The pin of the first six fields `config, asset, collection, owner, bank, payer` makes an empty match fail. Acceptable.

**`codeOnly`:** `filter(l => !/^\s*#/.test(l))` is not a shell parser. `#` is not a comment inside quotes, in `$#` / `${#var}`, or mid-token (`foo#bar`). For this file the `exec` line does not start with `#`, and the confusing line does. Adequate for the gate’s job. A future `exec` that is `VAR=foo; # ...` on the same line would be kept (mid-line `#` is not stripped) — still OK.

**nothingToDo arms:** prove the detector suppressor, not the writer, and not `finishedAt`. They do not prove what the comment claims (R2).

---

## R6 — Counts and arithmetic

`run-tests.sh` in this diff: `DET_FLOOR=403`, `ALLOC_FLOOR=63`, `MAINNET_FLOOR=19`. `selftest.mjs` `FLOOR = 403`. `distribute.mjs` `FLOOR = 63`. Rendered prompt: 284 / 403 / 63 / 19. `MIN_ASSERTIONS` is not in the hunk; 284 is whatever `grab` read.

Independent re-derive (weights 2/3/4/5/6):

- 108+60+36+24+12 = 240; `108·2+60·3+36·4+24·5+12·6` = 216+180+144+120+72 = **732**
- 945+525+315+210+105 = 2100; `945·2+525·3+315·4+210·5+105·6` = 1890+1575+1260+1050+630 = **6405** (not 6404)
- per $1,000 @ 240: 1000·w/732 → **2.73, 4.10, 5.46, 6.83, 8.20**
- per $1,000 @ 2100: 1000·w/6405 → **0.31, 0.47, 0.62, 0.78, 0.94**
- shares @ 2100: 100·n·w/6405 → **29.5, 24.6, 19.7, 16.4, 9.8**; exact sum 640500/6405 = **100**. Rounded sum 100.0

No card-arithmetic defect.

---

## R7 — One-of-N inside the fix for one-of-N

| Fix | Applied everywhere of that shape? |
|---|---|
| Clear no-pay flags on proceed | **No.** `refused` + `nothingToDo` only. `finishedAt` is the third mark written on the same skip path (R1). |
| `settledAsPayout` vs `paymentState` | In `distribute.mjs`, yes. Cadence uses `settledAsPayout`; send/budget still use `paymentState`. **Cannot confirm** `detectors.mjs` / `alarm.mjs`. |
| `Object.hasOwn` | `census`, `denominator`, `allocateWeighted`, `loadLevels` in this file. |
| `realDay` | Only `holdDays`. Exported `dayDiff` still `Date.parse`s and will roll `2026-02-30`. Money path goes through `holdDays` first. |
| NOTIFY + nonzero exit on halt | Refusal now matches SOL-floor and failed/ambiguous. |
| `isTableRow` hoisted | Inside `selftest.mjs` only. |
| Prompt floors read from disk | Yes for the four floors. Diff **heading** still hardcoded to the wrong commit (R1). |
| GNU base64 round-trip | One site. |
| Cron money header | File comment fixed; footer still lies when `--live` is preserved (R4). |
| Bank-as-payer tests | `3prog.test.ts` sites in the diff moved `payer` to `alice`; 9d.4 added. Not a second test file in this diff. |

The self-audit claim “`settledAsPayout` is the only cadence reader” is **true in the sender**. It is not evidenced for the rest of `bank/`.

### LOW — `holdDays` test still named “last day that actually PAID” uses `{ x: 1 }`
`paymentState(1)` is `ambiguous`; `settledAsPayout` is false. The test returns 7 because it falls back to the earliest day key, which happens to be `2026-08-01`. After the semantic change this assertion would stay green if `holdDays` ignored real signatures and only used the fallback. Same family as the assertion that expected `173`.

---

## Carry-over / known limits

Nothing here makes 1a–18 **exploitable beyond what is written**, with two calibrations:

- **#12 CU unmeasured.** Still true. MINT’s per-account loop on every top-level ix is extra CU; that is what “got worse this round” already says. Not re-filed.
- **#16 / unlevelled halt.** Not stranger-permissionless: mint still needs the Bank. Funding a Bank-minted, unregistered vault is the trigger. Paging is the right response to a halt, not a new grief primitive.
- **#3 Bank as payer inside the pair** is unchanged. Mint is **narrower** than that limit now (positional identity). Do not read #3 as applying to `mint_vault` anymore.

---

## Under-claims (owner’s shape)

The gates still only catch claims that are too strong. Places this system is **stronger** than nearby prose:

1. **`mint_vault` is not a blanket exemption.** Bank may appear only at index 4; Bank-as-payer on a real mint is `BankKeyOutsideMint` (9d.4). `cosign.mjs` still describes this as “MINT’s `mint_vault` refuses `BankKeyOutsideMint`” — true of the error enum, silent on the payer-slot guarantee a customer actually bought. SPEC is not in the bundle; if the table still says “instruction is a mint_vault,” it understates the same way the co-signer row did.
2. **A resolved row cannot be re-sent** even when it does not reset the hold clock. Two questions, two functions. Easy to document as one.
3. **Canonical base64** is stronger than the alphabet / padding / length comments that still sit above the new check (those comments say they “demand CANONICAL encoding” before the round-trip that actually does).

---

## Verdict challenges

Round 17’s “verdict” in this prompt is a stub. The live process defects that matter:

- This prompt’s subject line and its `git diff` range disagree (`2c8cd9b` vs `ec7d17e`).
- Off-chain focus **omits `detectors.mjs`**, the only reader of `nothingToDo`, while R2/R5/R7 ask about that reader. The bundle cannot support the claim it asks us to check.
- Quorum is `ceil(0.75 * 8) = 6`. A round that repeats “we had six and called it eight” now **exits 0** at six. MANIFEST records the truth; the process still certifies a short bench unless a human reads it.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Sixteen rounds keep missing the **inverse** of the scraped gates (under-claim) and the **Nth flag** of a state machine the last repair just touched. AI will not stop doing that if the next prompt is another comment-regex.

Do these, which this process structurally will not:

1. **One executable ordering test that is not a comment.** Write a ledger: morning skip (`nothingToDo` + `finishedAt`), afternoon plan + one `sig` and one `sig: null`. Run `detectDistribution`. Fail the build if it is quiet. That is the last three rounds’ worst class, and it is not in `selftest.mjs` today.
2. **Put `detectors.mjs` and SPEC.md in every off-chain bundle.** This pass was asked to certify a suppressor and an under-claim table neither of which was in the files. A focused bundle that omits the reader is how a stale `finishedAt` survives.
3. **Render the prompt to disk and diff it against a checklist before `fetch`:** no leftover commit hash in headings, no literal `${...}` that should have interpolated, `git diff <range>` in the script equals the heading, FOCUS files include every reader named in R-items. That is a 20-line script, not an auditor.
4. **Owner reads the control table vs the two confinement loops once.** That is how the last worst defect was found. No gate in this repo looks for “the code is stricter than the sentence.” Budget one hour of human attention there; do not add a ninth regex.
5. **Stop treating `MANIFEST-*.json` as optional.** If `auditors < requested`, do not write a verdict. 75% quorum plus a footer that says “eight models” is the same flatter the runner was just convicted of.