I will work through R1–R7 against the diff and the bundled sources, checking claims against measurable evidence rather than the builder’s commentary.

## R1. Self-audit repairs

### R1-1 — Template-literal / escaping defects
**Finding: LOW (process hygiene), not a live money bug**

The deliberate `\$\{FLOORS.onchain}` in the R1 bullet is intentional and gated. The floors sentence uses real `${FLOORS.*}` interpolations. I do not see another escaped floor that would ship as literal text.

Evidence if wrong: render `audit19.ts` and search the output for the literal string `${FLOORS.` outside the R1 example sentence.

### R1-2 — `isTableRow` hoist
**Finding: MEDIUM — predicate is still format-fragile; under-claim risk remains**

```js
const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)
```

Issues:
1. Requires the classification to appear as `**ON-CHAIN.**` / `**AUTOMATIC.**` / `**PROCEDURE.**` with the bold markers and the trailing period inside the bold. A real row written as `**ON-CHAIN**` (no period) or `ON-CHAIN.` (no bold) is invisible to every consumer of `isTableRow`, including the “every Bank-confinement refusal is NAMED in the control table” arm.
2. The control-table block scanner (`lines[i].startsWith('|')`) is broader than `isTableRow`, which is good — non-conforming rows are caught as unclassified. But a **legitimate** stronger row that a human formats slightly differently still fails closed only if someone adds it under the header; a classification mentioned only in prose still won’t count (that part is fixed).

Evidence: add a correctly intended row with `**ON-CHAIN**` (no period) under the header → `block.filter(l => !isTableRow(l))` is non-empty and the build goes red even though the row is real. That is fail-closed for CI, but it means the gate’s notion of “row” is narrower than Markdown table reality.

The hoist itself is used in `tableRows`, `tableLines`, and the block check. One definition is shared. Predicate correctness is the residual issue.

### R1-3 — `supersede` clearing DONE_MARKS
**Finding: HIGH — `resolvedBy` on a day-level record is still a suppressor; clearing it on supersede can erase an operator resolution that was not a “no-pay verdict”**

`DONE_MARKS = ['finishedAt', 'nothingToDo', 'resolvedBy']` and supersede deletes all three whenever `refused` or `nothingToDo` is present.

Ordering problems:

1. **Quiet → pay → crash:** Cleared correctly now (finishedAt included). Good.
2. **Refuse → operator sets day-level `resolvedBy` (“level assigned, rerun”) → pay proceeds:** Supersede wipes `resolvedBy`. If the pay run then crashes mid-transfer, `distribution_unfinished` fires (intended). But the operator’s resolution note is gone; `distribution_refused` may also re-fire depending on detector order if `refused` was cleared but a partial state remains. The selftest pins suppressor clearing, not preservation of intentional resolutions that coexisted with a stale no-pay flag.
3. **Pay then crash then resume:** Resume branch never calls supersede if `plan` exists. OK.
4. **Two runs one day / dry-run between:** Dry-run does not call supersede (`if (!plan.skip && !DRY)`). A dry-run after a quiet morning leaves `nothingToDo`+`finishedAt` in place. Good for not mutating; means dry-run cannot “rehearse” the supersede path.
5. **`alreadyPaid` guard uses `settledAsPayout`:** A day with only ambiguous/`resolvedBy` without `resolvedAs:'paid'` and without `plan` will still strip `finishedAt`. That is intended for the quiet-morning case. A day that was hand-closed at day level with `resolvedBy` but no plan and no paid rows loses its finished mark if it also had `nothingToDo` — correct for unfinished detection, destructive to the resolution audit trail.

Evidence if exploitable: ledger day with `{ nothingToDo, finishedAt, resolvedBy: 'gary: …', paid: { v1: { sig: null } } }` → afternoon plan proceeds → supersede → crash → `resolvedBy` absent from saved day.

**Is clearing both (now three) correct in every ordering?** For the unfinished alarm, yes. For not losing flags the operator needed as *record*, no — `resolvedBy` is both a suppressor and the only durable “human closed this” mark. Collapsing those roles is the defect shape.

### R1-4 — Manifest porcelain
**Finding: LOW — well-formed JSON, but `dirty` semantics can false-positive “dirty tree”**

```js
dirty: dirty.split('\n').filter(Boolean)
```

Not trimming the blob preserves leading status spaces on each line. Good. `filter(Boolean)` only drops empty trailing newline. Record is well-formed JSON.

Residual: `WATCHED` includes full file paths *and* directory names; `git status --porcelain -- programs bank scripts tests SPEC.md …` is fine. No defect found in porcelain handling itself.

---

## R2. Round-18 off-chain repairs (`distribute.mjs`)

### R2-1 — `settledAsPayout` default direction
**Finding: none on direction — builder is correct**

Trace:
- Larger `holdDays` → more likely `daysSinceLastPayout >= MAX_HOLD_DAYS` → `decideEmission` returns `pay: true, forced: true` sooner.
- Bare `resolvedBy` does **not** reset → holdDays stays large → ceiling fires **earlier** → pays sooner.
- Selftest pins `[true, false]` for bare vs `resolvedAs:'paid'`.

Direction claim is verified. Default is not backwards.

### R2-2 — `paymentState` still blocks re-send
**Finding: none for re-send; one related gap**

Call sites:
- Transfer loop: `paymentState` / `resolved` continue — unchanged.
- `holdDays` / `supersede` use `settledAsPayout` — cadence only.
- Outstanding SOL floor uses `paymentState(row) === 'unpaid'` — resolved rows not retried.

A resolved row is still not re-sent. True for every caller examined.

### R2-3 — Refusal pages + exit 1
**Finding: MEDIUM — griefing → paging is real; documentation accepts it; dry-run exit 1 is a CI footgun**

Any stranger can mint/activate a vault without a level (or with a level missing from `levels.json`) and force:
- daily NOTIFY (if not DRY)
- `process.exitCode = 1` even under `--dry-run`

That is intentional per header. It is still a paging surface: cost to attacker ≈ one activation; cost to operator ≈ page every day until levels.json is edited. Not a theft path. Severity MEDIUM as ops/DoS-on-humans, not funds.

Evidence: activate vault, omit from levels.json, run distribute — exit 1, NOTIFY invoked when `!DRY`.

### R2-4 — `census` null-prototype + spread
**Finding: none serious**

`return { ...c }` produces a normal-prototype object for JSON serialization. `denominator` uses `Object.hasOwn`. Ledger round-trip of census is plain data. No consumer in-bundle requires a null prototype.

### R2-5 — Dust bound
**Re-derive:**

For each paid vault: `share_i = floor(available * w_i / DEN)`, remainder contribution `< 1` sat per vault in the sum sense:
`dust = available - sum(floor(...)) < activated.length` when every activated vault is paid (all get a floor share in the loop).

When `smallest < min`, allocateWeighted returns early with no per-vault dust accounting (skip) — dust bound N/A.

When `available < activated` but still `smallest >= 1`: e.g. many vaults, tiny pool — if any share is 0, `smallest < min` → skip. So paid path never includes zero shares. Bound `dust < activated.length` holds on the pay path.

At 2100 vaults, `available = 6404`, DEN=6405: dust = 2099 = activated - 1. Attained. Comment and SPEC (in bundle) agree on 2099.

**Caveat (LOW):** bound is about **paid** vaults in `r.activated` after filters; skipped mid-run burns don’t change the precomputed dust. Fine.

---

## R3. `bank-sign.sh` base64 round-trip

### R3-1 — Accept non-canonical / wrong decode
**Finding: MEDIUM — `base64 -d` without `-i` / strict mode; `|| true` masks pipeline failures; GNU-specific `-w0`**

```bash
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
```

1. Whitespace is stripped before this, so embedded whitespace in TX is already gone — OK.
2. `base64 -d` on GNU ignores non-alphabet after decode in some versions when not `--ignore-garbage`… actually GNU `base64 -d` fails on invalid; invalid already rejected by alphabet check.
3. **Trailing bits / non-canonical:** round-trip catches `AB==` → `AA==`. Good.
4. **`|| true`:** if `base64 -d` fails, CANON is empty → `CANON != TX` → refuse. Fail-closed. Selftest pins missing base64.
5. **`base64 -w0`:** required for long outputs. Without `-w0`, re-encode wraps at 76 cols → CANON ≠ TX → **refuses legitimate long txs** on hosts where `-w0` is missing but `base64 -d` works. Selftest only fakes missing binary entirely, not BSD `base64` lacking `-w0`.
6. **Legitimate 1644-char tx:** length % 4 == 0; alphabet OK; round-trip OK on GNU. Should pass.
7. **Locale:** alphabet class is explicit `A-Za-z0-9+/=`, not locale-dependent. OK.

**Accept that still differs?** On GNU coreutils with the alphabet+padding+length gates first, round-trip equality is strong. I do not have a remaining canonical-inequality accept on stock GNU.

**Reject legitimate?** BSD/macOS `base64` without `-w0` → yes, rejects all multi-line-wrapped re-encodes (and long single-line if wrap is default). Deploy path is Linux — LOW/MEDIUM portability.

### R3-2 — Comment about `ps`
**Finding: none — corrected comment is true**

Last line is `exec … cosign.mjs --tx "$TX"` — TX is in cosign’s argv / `ps`. Comment states that. True.

---

## R4. `cron-install.sh` money claim

Jobs installed (from heredoc):

| Job | Line | Money as installed (fresh)? |
|-----|------|------------------------------|
| watcher `alarm.mjs` | 23,53 | No |
| **distribute.mjs** | 7 9 * * * | **YES — live cbBTC** unless preserved `--dry-run` |
| **revenue.mjs** | 41 */6 | No unless preserved `--live` |
| reconcile | 19 4 | No (read-only scan) |
| deadman | 9 */2 | No (SMS only) |

Header + computed posture footer match this. **New header is true for fresh install.** Re-run preserve logic is tested in selftest.

**Residual LOW:** posture footer greps `crontab -l` after install for `--dry-run` / `--live` without requiring uncommented-only. A commented tagged line left in crontab could make the footer claim DRY-RUN while the active line is live — inverse of the old arming bug, display-only.

---

## R5. Gates in `selftest.mjs`

### R5-1 — `isTableRow`
Covered in R1-2. Misses non-bold / no-period classifications. Real control rows in SPEC today match. Sound for current SPEC; brittle to format drift.

### R5-2 — MintVault struct regex
```js
/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/
```
Non-greedy to first `\n}`. Nested braces in attributes/comments could truncate.

Selftest pins: truncate before `bank` → index -1 (fail closed); after `bank` → index still 4. **Fails closed** for the confinement constant. OK.

What could terminate early: a `}` on its own line inside a doc comment within the struct. Uncommon in Anchor account structs. Fail closed if before bank.

### R5-3 — `codeOnly` for shell
```js
src.split('\n').filter(l => !/^\s*#/.test(l))
```
- `#` in the middle of a line (e.g. `echo foo # bar`, or inside quotes) is **not** stripped — good for not eating code.
- A `#` that is not a comment: inside quotes on a full line starting with spaces+`#` is rare.
- **Does not strip `:#` bash comments after code** — those lines stay; if they contain `exec …cosign`, the “exactly ONE exec” count could false-fail. Current file OK.
- Heredocs with `#` lines: kept. OK.

### R5-4 — nothingToDo arms
They prove: unfinished fires without `nothingToDo`; with stale `nothingToDo` unfinished is suppressed. They do **not** prove the writer clears the flag (that’s distribute selftest / supersede arms). Claim in comment “which is why the writer clears it” is motivational, not proven by those two arms alone. **Partial proof — LOW documentation-of-gate gap**, not a missing clear (clear exists in supersede).

---

## R6. Counts and arithmetic

From bundled `run-tests.sh`:
- `MIN_ASSERTIONS=286`
- `DET_FLOOR=434`
- `ALLOC_FLOOR=93`
- `MAINNET_FLOOR=19`

Matches distribute FLOOR 93, selftest FLOOR 434, SPEC text 286/434/93/19.

**Schedule re-derive:**
- 108·2+60·3+36·4+24·5+12·6 = 216+180+144+120+72 = **732** ✓  
- 945·2+525·3+315·4+210·5+105·6 = 1890+1575+1260+1050+630 = **6405** ✓  
- per $1000 @ 240: 1000*w/732 → 2.73, 4.10, 5.46, 6.83, 8.20 ✓  
- @ 2100: 0.31, 0.47, 0.62, 0.78, 0.94 ✓  
- shares @ 2100: 29.5+24.6+19.7+16.4+9.8 = **100.0%** ✓  

No arithmetic defect found in published figures in the bundle.

---

## R7. What the self-audit missed (one-of-N)

### R7-1 — HIGH: BURN still has **no** Bank-key confinement walk
SEAL: `BankKeyOutsidePair` on every non-open/non-burn ix.  
MINT: positional mint confinement.  
BURN: only `bank: Signer` + pin to config — **no** instruction walk.

Known limit 1a says allowlist/fee-payer are off-chain; bank-pubkey confinement was “moved on-chain.” SPEC table says confinement is on-chain for mint and redemption via SEAL’s walk, and “every burn that can execute sits in a transaction where this scan has already run.”

**Dependency:** If someone builds a tx that somehow invokes `burn_vault` without a preceding open that ran the walk… BURN requires preceding open. Open runs the walk. So theft-by-extra-ix still needs to pass SEAL’s open first, which scans the **whole** tx including after the open.

**Is BURN-only path possible?** Bare burn without open fails `NoPrecedingOpen`. OK.

**Residual:** SEAL walk exempts **any** open/burn discriminator to SEAL/BURN programs, not only “this asset.” A second burn of another vault in the same tx is exempt from bank-key-in-accounts check for the whole burn ix. Combined with known limit 4 (allowlist permits bare Core BurnV1 of a second vault) — on-chain bank confinement does not look inside exempt burn accounts for “bank only in bank slot.” If burn accounts could include bank as payer of something… BurnVault has bank as signer at a fixed index; extra remaining accounts are token accounts. Unlikely theft. **Not elevating to CRITICAL.**

### R7-2 — HIGH: MINT confinement still allows Bank as **non-payer** account in other roles inside mint; more importantly **fee payer still free**
Documented. Not new.

### R7-3 — CRITICAL candidate check: mint exemption by disc only
Is there another instruction with same 8-byte disc? Anchor disc is hash of `global:mint_vault` — only that handler. Forged data still hits mint_vault. OK.

### R7-4 — MEDIUM: `supersede` / `DONE_MARKS` scrape can desync if detector predicate is reformatted
```js
const guard = detSrc.match(/if \(rec\.startedAt &&([\s\S]*?)&& day !== opts\.today\)/)
```
If someone reorders conditions or splits the if, `needed` becomes `[]`, test `'detector still has unfinished guard'` fails (fail closed). OK.

### R7-5 — MEDIUM: one-of-N on **ON-CHAIN control table vs BURN**
Owner under-claim class: table now has SEAL+BURN for “must sign” and SEAL+MINT for confinement. BURN’s mandatory bank signature is ON-CHAIN but confinement row doesn’t name BURN’s lack of walk as a weaker dependency. Documentation accuracy, not theft.

### R7-6 — HIGH: `compute units unmeasured` got worse
MINT now walks all instructions with nested account loops on every mint. Known limit 12. Confirmed worse. Not a new logic bug but **operational CRITICAL risk** if mint txs hit CU limits mid-confinement — fail closed (tx fails), availability not theft.

### R7-7 — MEDIUM: `settledAsPayout` is not the only cadence-adjacent reader — `supersede`’s `alreadyPaid` also uses it
Self-audit claim “only site asking the cadence question” is slightly wrong: `alreadyPaid` asks “did money land” for finishedAt preservation. Same function, consistent. **No conflation bug.** Claim overstated but behavior OK.

### R7-8 — HIGH: distribution refusal + exit 1 under dry-run breaks “health check = success”
Documented as intended. Still causes false-red monitors. Ops.

### R7-9 — MEDIUM: `import fs from 'fs'` and `import fsx2 from 'fs'` duplicate — noise only.

### R7-10 — **CRITICAL (conditional): payer theft fix test vs remaining mint sites**
Diff shows payer moved to alice on multiple mints; 9d.4 tests bank-as-payer rejected. Confinement code looks correct.

Double-check MINT account indices:
0 config, 1 asset, 2 collection, 3 owner, 4 bank, 5 payer → `MINT_IX_BANK_IDX = 4`. Matches. Good.

### R7-11 — **HIGH: SEAL open/burn exemption does not positional-check Bank inside open/burn**
For open/burn ix, SEAL does not verify bank appears only in the bank signer slot. Customer could place `config.bank` as an extra account meta on a burn/open (if the program allows extra accounts) or as payer on open (`OpenForRedemption` has separate payer).

**OpenForRedemption:** `bank` and `payer` are distinct. If `payer = bank`, Bank pays tx fees for the open — SEAL job2 skips account checks on is_open/is_burn. **Bank SOL drain as fee payer on the open itself** is still possible on-chain; fee-payer arm is policy in cosign only.

This is **worse than stated in known limit 1a** if operators sign without cosign: not only outer fee payer, but **Bank as instruction payer on open/burn/mint** (mint now blocked for bank-as-payer by positional check; open/burn not).

Evidence: craft open_for_redemption with accounts[bank]=Bank, accounts[payer]=Bank; SEAL confinement loop sees is_open and does not scan. Tx can still require Bank signature once. Bank pays lamports for Core CPI payer fees.

**Fix:** On is_open/is_burn, require bank pubkey only at the known bank index (mirror MINT). Same for BURN’s account list.

---

## Third target — under-claims (safer than docs)

1. **MINT bank confinement is stronger than older SPEC prose** that only discussed redemption — table updated; good.
2. **`supersede` + detector-derived DONE_MARKS** is stronger unfinished detection than SPEC may describe.
3. **BURN+SEAL bank signer** is mandatory — table fixed after owner catch.
4. **Still under-claimed:** SEAL does not publish that open/burn paths still allow Bank as **payer** inside the exempt pair; cosign fee-payer check is the real control and is PROCEDURE. Customer-facing “Bank’s key is confined” over-claims relative to fee/payer roles inside the pair (known limit 3 says payer inside pair exempt — that is an **over-claim of safety** if read as “Bank cannot pay,” which is accurate as limit).

Under-claim to flag: **`realDay` / ledger key validation** makes cadence safer than any card text that only mentions MAX_HOLD_DAYS.

---

## Carry-over limits — worse than stated?

| # | Assessment |
|---|------------|
| 1a | **Slightly worse:** on-chain confinement omits positional bank check inside open/burn; Bank-as-payer on open still drains Bank SOL without cosign. |
| 12 | **Worse:** MINT full ix walk + per-account loops; still unmeasured. |
| 16 | Unchanged — levels still off-chain. |
| 17 | Unchanged — 21 sats provisional. |

---

## Additional findings

### HIGH — `allocateWeighted` dust bound vs skipped vaults in comment
Comment says `dust < activated count`. Code’s `activated` is all activated with levels, all receive `per[v]` (possibly 0 only if skipped by min check on smallest). OK.

### MEDIUM — Refusal path sets `nothingToDo` AND `refused` AND `finishedAt`
Detector unfinished suppressed; `distribution_refused` should fire. Selftest covers. OK.

### LOW — FLOOR equality in distribute.mjs indentation broken in diff
```js
const FLOOR = 93
// comment
if (R.length !== FLOOR) {
```
Works, style only.

### MEDIUM — `cron-install` `ours | grep -q 'distribute\.mjs --dry-run'`
Flag must appear in that order adjacent. `--dry-run` before script name wouldn’t preserve. Edge case.

---

# Findings summary (ordered)

### CRITICAL
None proven as customer-btc theft in this diff. The mint payer-slot fix is directionally correct and tested (9d.4).

### HIGH
1. **SEAL (and BURN) exempt open/burn from positional Bank-key checks** — Bank can still be `payer` on open/burn; confinement claim is weaker than MINT’s fix; without cosign, Bank SOL drain remains via pair-internal payer/fee roles.  
   **Evidence:** read `open_for_redemption` loop: `if !is_open && !is_burn` only.  
   **Fix:** positional allowlist for bank on open/burn like `MINT_IX_BANK_IDX`.

2. **`supersede` deletes day-level `resolvedBy`** whenever any no-pay mark exists — destroys operator resolution audit trail; couples “suppress unfinished” with “erase human closure.”  
   **Evidence:** `DONE_MARKS` includes `resolvedBy`; delete loop.  
   **Fix:** clear only flags that mean no-pay (`nothingToDo`, `refused`, stale `finishedAt`); treat `resolvedBy` separately or re-write after supersede.

3. **CU still unmeasured with heavier MINT walk** — availability risk at scale (2100 mints / multi-mint txs).  
   **Fix:** measure CU on worst-case mint tx; set compute budget in clients.

### MEDIUM
4. Refusal → page every day + exit 1 on dry-run: griefing/paging surface (accepted in comments; still real).  
5. `isTableRow` format brittleness.  
6. `bank-sign.sh` GNU `base64 -w0` portability.  
7. Cron posture footer can read commented lines.  
8. nothingToDo selftest arms don’t prove the writer.

### LOW
9. Duplicate `fs` import.  
10. Manifest/watch path complexity.  
11. Deliberate template escape false-positive magnet for auditors (gated).

---

## R1 direction checks (explicit answers)

| Question | Answer |
|----------|--------|
| Other template escapes? | Only deliberate R1 example found |
| isTableRow everywhere? | Yes for table gates; predicate strict |
| Clear both/three always safe? | Unfinished: yes. Resolution record: no |
| Manifest well-formed? | Yes |
| settledAsPayout direction? | Larger hold → earlier force pay; default correct |
| paymentState re-send? | Still blocked |
| Refusal paging? | Real grief→page; intentional |
| census serialize? | Yes via spread |
| dust &lt; activated always on pay path? | Yes |
| bank-sign accept wrong decode? | Not on GNU with round-trip |
| Reject legitimate? | Non-GNU base64 -w0 |
| ps comment true? | Yes |
| cron header true? | Yes for five jobs as tabled |
| Floors match files? | 286/434/93/19 |
| Arithmetic? | 732/6405/shares OK |
| settledAsPayout only cadence site? | Also `alreadyPaid`; consistent |

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Concrete actions sixteen AI rounds will not replace:

1. **Mainnet shadow mode before real BTC:** run `distribute.mjs` with real keys against a **dust-only** distributor ATA and a copy of levels.json for N days; require alarm+ledger invariants with no manual ledger edits. AI never runs your cron under production load or dual-lock contention for 24h.

2. **Measure compute units and end-to-end redemption size on mainnet-cloned validator for the exact cosign-allowlisted tx shape** after the MINT walk; gate deploy on CU headroom. AI repeatedly misses CU.

3. **External key ceremony:** Bank key on an air-gapped machine; only `bank-sign.sh` path; one forced failure drill (wrong fee payer, bank-as-payer open) with screenshots. Custody is not in the repo.

4. **Invariant fuzzer on `supersede` × `detectDistribution` × ledger orderings** (quiet/refuse/resolve/pay/crash/dry-run permutations) as a generated suite, not hand-picked cases — this round’s defects keep appearing in ordering holes.

5. **Publish the level-assignment commitment** (hash-before-activate) before the first paid mint; without it “fate” is unverifiable and AI cannot make it true by reading code.

6. **Stop shipping money-path changes and audit-runner changes in the same freeze window** — `audit19.ts` complexity is now a second product; split so certification tooling cannot invalidate the tree mid-round (you already gate dirty tree; keep tooling on a different repo or tag).