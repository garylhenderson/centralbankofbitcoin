# Round 19 Audit Report

## R1 — Self-audit repairs (newest, least read)

### R1-1 Template / escaping defects
**LOW (process hygiene, not money).**  
`audit19.ts` deliberately escapes one `${` in the R1 bullet (`\${FLOORS.onchain}`) so the *description* of the round-18 bug renders literally. The floors sentence uses real `${FLOORS.*}` interpolations. Selftest pins: exactly one escaped line, and it must be the R1 example; floor line must contain unescaped interpolations.

**Evidence if wrong:** rendered prompt would show literal `${FLOORS.onchain}` in the suite-count sentence, or extra `\${` lines. Selftest arm already fails closed on that.

**No other template-escape defect found in this diff** from source + the selftest’s own render checks. I cannot execute `tsc`/render here; the gate is the right control.

---

### R1-2 `isTableRow` hoist
**Sound for current SPEC shape.**  
Predicate: `/^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/`  
Used for: `tableRows`, `tableLines` / BankKeyOutside name check, and `controlTableBlock` “every `|` row classified”.

**Misses (fail-closed on classification, not silent pass):**
- Classification not bold, or not ending with `.**`
- Extra spaces inside `**ON-CHAIN.**`
- Value other than the three enums

**Can a real control row fail to match?** Yes if someone writes `**ON-CHAIN**` without the period, or puts the class in another column. Then `controlTableBlock` + `filter(!isTableRow)` goes red — intended.

**Residual:** ON-CHAIN verification still only scrapes `` `programs/.../lib.rs` ``; a correctly classified row that names programs only in prose still fails the ON-CHAIN arm (fail-closed).

---

### R1-3 `supersede` / clearing DONE marks — **HIGH**

**Construct:** `supersede` only runs when `was = [refused, nothingToDo].filter(Boolean)` is non-empty. It then deletes `DONE_MARKS = ['finishedAt','nothingToDo','resolvedBy']`.

**Gap the self-audit still misses:** a day can silence `distribution_unfinished` with **`resolvedBy` alone** (no `refused` / `nothingToDo`). Detector:

```text
startedAt && !finishedAt && !nothingToDo && !resolvedBy && day !== today
```

If an operator sets `resolvedBy` on a half-paid day (or a bad tool writes it), then a later **paying** plan path never calls `supersede` (early return: `if (!was.length)`), leaves `resolvedBy` in place, writes `plan`, crashes mid-transfer → **still silent** next day.

Selftest derives suppressors from the detector and checks that *when supersede runs* it clears them — it does **not** prove supersede runs whenever a plan proceeds.

**Orderings:**

| Ordering | Behavior |
|---|---|
| Quiet → pay | Clears nothingToDo + finishedAt (+ resolvedBy if present). OK if crash after. |
| Refuse → pay | Clears refused + marks. OK. |
| Pay → crash → resume | Resume branch; no supersede. OK if no stale resolvedBy. |
| Two runs one day | Second run with plan → resume. OK. |
| `--dry-run` between | Dry-run does not supersede or write plan. OK. |
| **resolvedBy-only stale + plan + crash** | **Alarm suppressed. HIGH.** |

**Also:** `alreadyPaid` restores `finishedAt` if `plan` or any `settledAsPayout` row exists. Production main() does not call supersede on plan days — structural guard is good; the resolvedBy-only path is the live hole.

**Evidence:** Ledger day with `startedAt`, `resolvedBy: '…'`, no `finishedAt`, `plan` partially `paid` with null sigs → `detectDistribution` returns `[]` for unfinished; identical without `resolvedBy` returns `distribution_unfinished`.

**Fix:** Call clearing of all detector suppressors whenever a live plan is first committed (not only when refused/nothingToDo was set). Or: `supersede` always strips DONE_MARKS when `proceedingWithPlan`, and treat bare `resolvedBy` without plan/payout as supersedable operator noise. Keep the alreadyPaid finishedAt restore.

---

### R1-4 Manifest porcelain / dirty
**LOW / OK with caveat.**  
`dirty` is not `.trim()`’d on the blob; `dirty.split('\n').filter(Boolean)` keeps leading status spaces. Good.

`WATCHED` includes TARGETS paths + `programs bank scripts tests`. Round writes under `audits/` are outside WATCHED — avoids self-dirty. HEAD + dirty-before/after gates are real exit codes.

**Well-formed:** JSON with `dirty: string[]`. Empty clean tree → `[]`. Fine.

---

### R1-5 Compute units (known limit 12 — **worse as claimed**)
MINT now walks **all** top-level ix account metas on every `mint_vault` for bank confinement. Still **unmeasured**. Not a new logic bug; CU headroom for mint + Core Create is unknown. Do not ship mainnet mint path without a CU measurement on the fattest mint tx.

---

## R2 — Round-18 off-chain (`distribute.mjs`)

### R2-1 `settledAsPayout` default direction — **verified correct**
Larger `holdDays` → sooner `daysSinceLastPayout >= MAX_HOLD_DAYS` → **pays earlier**.  
Bare `resolvedBy` does **not** reset → holdDays stays large → ceiling sooner.  
`resolvedAs: 'paid'` resets → can delay forced pay. Builder direction is right; suite pins `52` vs `2` and emission true/false.

### R2-2 `paymentState` unchanged for re-send
Payment loop still: `paid` / `resolved` → continue; only `unpaid` sends. `settledAsPayout` is only for cadence + supersede alreadyPaid. **No second sender path conflates resolved with unpaid.** Claim holds for callers in this tree.

### R2-3 Refusal → NOTIFY + exit 1 — **MEDIUM (ops / grief → page)**
Any stranger: mint/activate vault, omit level (or poison register) → daily refusal → SMS + exit 1. Documented intentional.  
**Not suppressed under `--dry-run` for exit code** (page is). CI health checks on dry-run go red on grief — also documented.

**Risk:** page fatigue → real failures ignored (same class as forever-CRITICAL).  
**Fix (product):** rate-limit pages per reason; auto-open ticket; still exit 1. Optional: quarantine unlevelled vaults after N days without halting *all* pay (owner previously rejected silent drop — keep halt, fix paging).

### R2-4 `census` null-prototype + spread
`return { ...c }` → normal object; JSON round-trip fine. `denominator` uses `Object.hasOwn`. No consumer needs Object.prototype on census keys. **OK.**

### R2-5 Dust bound — **re-derived OK; comment slightly loose**
Per vault: `floor(available * w / den)`; dust = sum of fractional parts &lt; 1 each → **dust ≤ activated−1** when all activated are paid (strict `< activated.length`).

Attained at full 2100 census, `available = 6404`: dust **2099**. Suite + SPEC gate agree.

When `available` small: `allocateWeighted` skips before return if `smallest < min` — no dust path. When some vaults skipped mid-run, dust was computed on full activated plan — bound still on plan size, not “successfully paid” count. **dust < activated.length remains true on the allocator output.**

---

## R3 — `bank-sign.sh` base64 round-trip

### R3-1 Accept non-canonical that still “works”?
Round-trip via `base64 -d | base64 -w0` is the right check for GNU coreutils. Selftest: missing `base64` → refuse (fail closed); newline/wrap stripped by `tr -d '[:space:]'` then compared to canon **without** spaces — good.

**Residual MEDIUM (environment):**  
`CANON=$(... | base64 -w0 2>/dev/null) || true`  
- Non-GNU `base64` without `-w0`: CANON empty or error → refuse all (availability, closed).  
- **Locale / line discipline:** unlikely after space strip.  
- **Very long TX:** ARG_MAX on `exec node ... --tx "$TX"` — accepted limit (tx in ps/argv); not introduced by round-trip.  
- **Embedded whitespace inside alphabet:** stripped — paste with spaces OK; cannot smuggle non-b64.

I do **not** have a GNU-accepted string that decodes to different bytes than re-encode under this pipeline; the old `====` / `AB==` class is rejected.

### R3-2 Legitimate 1644-char (1232-byte) tx
Length % 4 == 0; standard base64 of random 1232 bytes is canonical → should pass. No evidence of false reject for normal txs.

### R3-3 Comment “not in ps”
Corrected comment is **true**: not in *this* script’s argv as file path workflow; **is** in cosign argv after exec. Accurate.

---

## R4 — `cron-install.sh` money claim

Jobs installed (tagged):

| Job | As fresh install | Moves money? |
|---|---|---|
| `alarm.mjs` watcher | no flags | No |
| `distribute.mjs$DIST_DRY` | DIST_DRY empty | **YES — live cbBTC** |
| `revenue.mjs$REV_LIVE` | REV_LIVE empty | No (needs `--live`) |
| `alarm.mjs --reconcile` | | No |
| deadman notify | | No (SMS only) |

Header + computed posture at end match. Preserve of `--dry-run` / `--live` only from **ours()** tagged uncommented lines — selftest executes real shell logic. **Header is true** for fresh and re-run if you read the printed posture.

**LOW:** Posture grep uses `crontab -l | grep TAG distribute | grep --dry-run` — if two distribute tags existed, any dry-run would mark dry; installer de-dupes by TAG so OK.

---

## R5 — Gates (`selftest.mjs`)

### R5-1 `isTableRow` — see R1-2. Sound; non-conforming rows fail closed via block scan.

### R5-2 MintVault struct regex
Non-greedy to first `\n}`. Inner `}` on its own line truncates.  
Selftest pins: truncate before `bank` → index −1 (fail closed); after `bank` → index still 4.  
**OK for consequence on MINT_IX_BANK_IDX.** Nested docs rarely put bare `}` lines mid-struct; if they do before bank, build fails closed.

### R5-3 `codeOnly` for shell
Strips lines matching `^\s*#`.  
**`#` not a comment:** `CMD #trailing` keeps code before `#` — OK.  
`echo " # not comment"` — full line kept (no lead `#`) — OK.  
Heredoc bodies with `#` — kept.  
**Still weak:** trailing comment on the **exec** line could make “first match” tamper theory messy; they added “exactly one exec line” pin. Good enough.

### R5-4 nothingToDo arms
Prove detector: unfinished fires; unfinished+nothingToDo silent.  
**Do not prove the writer** clears on plan — that is distribute selftest / supersede arms. Split is OK if both exist; writer gap is R1-3 (resolvedBy).

### R5-5 DONE_MARKS scrape
Parses `!rec.(\w+)` from detector guard. Fragile if predicate reformatted (e.g. `!(rec.finishedAt)`) — would desync; prefer shared exported list from detectors. **LOW.**

---

## R6 — Counts and arithmetic

From bundled `run-tests.sh` / floors:

| Floor | Value |
|---|---|
| MIN_ASSERTIONS | **286** |
| DET_FLOOR | **434** |
| ALLOC_FLOOR | **93** |
| MAINNET_FLOOR | **19** |

Matches distribute `FLOOR = 93`, selftest `FLOOR = 434`. Equality enforced.

**Schedule (independent):**
- 108·2+60·3+36·4+24·5+12·6 = 216+180+144+120+72 = **732**
- 945·2+525·3+315·4+210·5+105·6 = 1890+1575+1260+1050+630 = **6405**
- per $1000 @ 240: 2000/732… → **2.73, 4.10, 5.46, 6.83, 8.20**
- @ 2100: **0.31, 0.47, 0.62, 0.78, 0.94**
- shares %: **29.5, 24.6, 19.7, 16.4, 9.8** sum **100.0**
- V/I weight = 3

**No arithmetic defect found** in published figures in this bundle.

---

## R7 — What self-audit missed (one-of-N)

1. **HIGH — plan path does not clear suppressors unless refused/nothingToDo** (R1-3). Same class as “clear two of three marks,” third time.  
2. **`bankErrs` only SEAL + MINT** — BURN has bank signer but no `BankKeyOutside*`; OK. If BURN adds confinement error later, scrape list is two paths — watch it.  
3. **`settledAsPayout` only site for cadence** — holdDays only; payment loop uses paymentState. **Claim OK.**  
4. **cron preserve** — both flags now; selftest both ways. OK in diff.  
5. **MINT payer tests** updated + 9d.4 — OK.  
6. **SPEC dust 2099** gated in distribute selftest — OK if SPEC on disk matches (gate reads SPEC).  
7. **Under-claim (third target):** Control table now has strong ON-CHAIN rows for bank must sign + key confinement. **BURN’s bank pin is covered under “must sign” row naming burn lib.rs** — good.  
   Still easy under-claim: cosign header says bank-pubkey confinement on-chain in SEAL and MINT; **fee payer / allowlist still off-chain only** — documented in known limits.  
   **Possible under-claim:** MINT confinement is stronger than “mint_vault exemption” prose in older comments; error message was fixed.  
8. **`import fs` + `import fsx2 from 'fs'`** in distribute — noise, not security.

---

## On-chain (diff) — MINT bank confinement

**Construct:** On `is_mint`, require bank pubkey only at `MINT_IX_BANK_IDX` (4); else any bank key → error.

**Attack (payer = bank):** Rejected (9d.4). Good.

**Residual:**
- Exemption is still disc + program id — not full account layout. Stranger cannot put bank in other slots of a real mint. Alternate ix with same disc to same program is still mint_vault.  
- **Bank as fee payer** still invisible on-chain (known 1a).  
- **Account order:** instructions sysvar inserted earlier; idx 4 = bank pinned by selftest parse.  
- **seen_self:** not fully re-audited in this off-chain-heavy bundle; programs pass should keep pressure on walk-after-current.

**No new CRITICAL theft path found** in the narrowed mint exemption from this reading.

---

## Carry-over / known limits — worse?

| # | Note |
|---|---|
| 12 CU | **Worse:** mint walk added; still unmeasured. |
| 1a | Unchanged; mint path now has on-chain bank confine; redemption allowlist still off-chain. |
| 17 EMISSION_MIN | Still provisional — live risk if unset. |
| Grief halt | Now pages (R2-3) — limit became noisier, not safer. |

---

## Third target — under-claims

1. **Fixed in spirit:** Bank signature mandatory ON-CHAIN called out; co-signer policy PROCEDURE.  
2. **Still under-sold if anything:** Daily distribute is a **live money cron by default** — header fixed; runbooks outside repo may still say “cron is safe.”  
3. **Ceiling at zero volume** — comments fixed; customer cards must not say “max wait 31 days always.” SPEC cadence section in bundle includes the qualifier — good.  
4. **No finding** that code is safer than SPEC on burn pairing beyond what’s already claimed.

---

## Verdict challenges

Self-audit claims supersede clears every suppressor the detector honors: **true only when supersede runs**. Incomplete for “plan proceeds.”

Dust 2099 attained: **agree.**

settledAsPayout direction: **agree with builder.**

---

# Findings summary

| Sev | ID | Issue |
|---|---|---|
| **HIGH** | H1 | Plan commit does not clear `resolvedBy`/`finishedAt` unless prior refused/nothingToDo → unfinished day can stay silent |
| **MEDIUM** | M1 | Unlevelled-vault halt pages every day (grief → SMS fatigue) |
| **MEDIUM** | M2 | bank-sign / cosign still put full tx on argv (accepted; comment OK) |
| **LOW** | L1 | DONE_MARKS scraped by regex from detectors source |
| **LOW** | L2 | CU still unmeasured; mint walk increased cost |
| **LOW** | L3 | Duplicate `fs` import in distribute |

**No CRITICAL** money-theft path identified in this diff beyond what 9d.4 closed, given measured suite claims.

---

## H1 fix (concrete)

```js
// When committing a live plan, always:
for (const mark of DONE_MARKS) delete st.days[day][mark]
// then set plan; do not gate on refused/nothingToDo.
// Optionally record supersededWas if any mark was present.
// Keep alreadyPaid → restore finishedAt if re-entering wrongly.
```

Align detector and writer on one exported `DISTRIBUTION_DONE_MARKS` from `detectors.mjs`.

---

## GIVEN NO HUMAN FIRM WILL EVER SEE THIS

Sixteen AI rounds cannot replace:

1. **Mainnet shadow, no value:** run distribute `--dry-run` against real DAS + real treasury ATA for 30+ days; diff planned vs countersigned amounts; page on divergence.  
2. **CU + size budgets in CI:** measure compute units and tx bytes for mint (with confinement walk) and max redemption (3 mints + ATA creates path); fail build if &gt; 80% of limits.  
3. **Fault injection on the money host:** kill -9 mid-distribute; inject `resolvedBy` without payout; assert alarm fires within one pass (automate H1).  
4. **Key ceremony + custody drill:** Bank key only on offline/sign machine; cosign stdin so tx leaves argv; one human checklist before first `--live` revenue.  
5. **External differential:** one-shot hire a *single* independent engineer (not a “firm process”) to read only `distribute.mjs` + `detectors` unfinished arm + cron — the under-claim/suppressor class is where models keep looping.  
6. **Stop shipping self-audits as certification:** self-audit findings must be re-proven by a clean roster that never saw the builder’s narrative, with MANIFEST quorum mandatory (you started this; do not count self-audit as a clean round).

I am not confirming the system safe to hold customer cbBTC. H1 should be fixed and regression-tested before treating distribution unfinished detection as closed.