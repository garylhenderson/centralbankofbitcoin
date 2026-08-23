# Security Audit Report — ec7d17e..HEAD (Rounds 18–19 repairs + self-audit)

I am treating the author’s work as unproven. Findings below are ordered by target. Claims that contradict measured suite behaviour are marked as such or omitted.

---

## R1. Self-audit repairs (highest priority)

### R1-1 — Template-literal / escaping defects that source-reading cannot see

**MEDIUM — `scripts/audit19.ts` prompt still ships a backslash-escaped floor interpolation in the R1 bullet text**

**Construct.** In the PROMPT template of `audit19.ts`, the R1 bullet is written as:

```text
- \${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT ...
```

That is intentional *documentation of the prior bug*, but the same file correctly interpolates `${FLOORS.onchain}` only in the suite-count paragraph. The defect class is “escaped `${` survives tsc and ships as literal text.”

**What to verify by rendering, not reading.** After `tsc`/run, dump the actual `PROMPT` string (or the first ~2k chars written beside the manifest) and grep for the literal characters `${FLOORS` and for bare `FLOORS.onchain` without a substituted integer. Evidence if still broken: auditors receive the characters `${FLOORS.onchain}` or `\${FLOORS.onchain}` instead of e.g. `286`.

**Other sites in this diff.** The live floor interpolations in the suite-count line use unescaped `${FLOORS.onchain}` etc. and should render. The R1 bullet’s escaped form is the only deliberate leftover; it is not a second live bug unless a copy-paste reintroduced `\${` on a *live* interpolation. I cannot execute the runner here — **render before the next round**.

**Fix.** Keep the historical note in plain prose (“the floor integer had shipped as literal text”) without an escaped `${...}` sequence inside the template at all.

---

### R1-2 — `isTableRow` hoist

**LOW — predicate is used consistently; shape is still brittle**

**Construct.**

```js
const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)
```

Used for `tableRows`, `tableLines` / `tableSrc`, and `controlTableBlock`’s “every row classified” check.

**Soundness.**
- Requires bold `**ON-CHAIN.**` / `**AUTOMATIC.**` / `**PROCEDURE.**` with a literal period inside the bold span.
- A real control row that uses `**ON-CHAIN**` without the period, or puts the class in a different column order, fails `isTableRow` and is caught by `EVERY row in the control table block carries a classification` — fail-closed for classification.
- Misses: multi-line cells, leading spaces before `|`, or a classification word not in the three-value set. Those become “unclassified row” failures, not silent passes.

**One definition everywhere?** Within `selftest.mjs` C5, yes. No second copy remains in the diff hunks.

**Not a defect** relative to the stated goal. Residual risk is documentation format lock-in only.

---

### R1-3 — `supersede()` clears `refused`, `nothingToDo`, **and** `finishedAt`

**HIGH — clearing `finishedAt` on proceed is correct for the quiet→pay→crash path; several orderings still lose or mute signal**

**Construct.** `supersede` deletes `refused`, `nothingToDo`, and `finishedAt` whenever either no-pay flag is present. Called only when `!plan.skip && !DRY` before writing `plan`.

**Ordering analysis.**

| Ordering | Behaviour | OK? |
|---|---|---|
| Quiet morning (`nothingToDo`+`finishedAt`) → afternoon pay proceeds | Clears all three; crash mid-pay → `distribution_unfinished` | Yes — this is the fix |
| Refuse → repair levels → pay same day | Clears `refused` + `finishedAt`; pay can complete | Yes |
| Pay starts → crash → resume same day | `supersede` no-ops if no no-pay flags; `finishedAt` already absent | Yes |
| Two successful pays one day | Second run: day already has `plan`/`paid`; depends on main() re-entry guards (not shown as changed) | Need main() path — not newly broken by supersede |
| `--dry-run` between quiet and live | `supersede` only when `!DRY` — dry-run does **not** clear flags | Correct (dry must not mutate money-ledger verdict marks) |
| Live proceed after quiet, then **second** crash after partial `finishedAt` written by a later skip path | See below | **Problem** |

**Defect A — resume after supersede can still be silenced if a later skip path re-stamps `finishedAt` without clearing plan.**  
If afternoon run supersedes, writes `plan`, pays some vaults, dies; a subsequent run that takes the `plan.skip` branch does:

```js
if (plan.refusal) st.days[day].refused = plan.skip
st.days[day].finishedAt = ...; save(st)
```

That re-applies `finishedAt` (and possibly `nothingToDo` on the quiet branch) **on top of an existing `plan` and partial `paid`**, which is exactly the unfinished shape. Detector unfinished arm is `startedAt && !finishedAt && !nothingToDo && !resolvedBy` — re-stamped `finishedAt` suppresses it again.

**Evidence if true:** ledger day with `plan.activated.length > 0`, some `paid` rows with `sig: null`, and `finishedAt` set; `detectDistribution` returns no `distribution_unfinished`. Suite arms prove supersede in isolation and stale `nothingToDo`, **not** “skip path after partial plan.”

**Fix.** Skip/finish paths must not set `finishedAt` / `nothingToDo` when `plan` already exists with unpaid activated vaults; or unfinished detection must treat “plan present ∧ unpaid activated” as unfinished regardless of `finishedAt`.

**Defect B — `was` only records `refused` and `nothingToDo`, not the cleared `finishedAt`.** Minor forensics gap (LOW).

**Defect C — dry-run refusal still sets `process.exitCode = 1` (see R2).** Related, not supersede-specific.

---

### R1-4 — Manifest git porcelain no longer trimmed

**LOW — well-formed JSON; trailing empty line handling is fine**

**Construct.**

```js
dirty: dirty.split('\n').filter(Boolean)
```

Porcelain lines are `XY path` (two status chars + space + path). Not trimming the blob preserves a leading space on paths that have one in the index side; `filter(Boolean)` only drops the final empty split. Record is valid JSON.

**Residual.** Paths with embedded newlines are extremely rare; not introduced here. `WATCHED` joins TARGETS paths with spaces into a single `git status --porcelain --` argv string — paths with spaces would break; none of the watched paths have spaces.

**No HIGH/CRITICAL on manifest shape.**

---

### R1-5 — Known limit 12 (CU) “got worse”

Accepted limit. MINT’s full-transaction walk on every mint increases CU; still unmeasured. **Worsening is real but already listed — not re-filed as new**, except to note mint is the hot path (up to 2,100 activations). If CU reverts honest mints, that is a liveness failure. Evidence: mainnet/local simulate `mint_vault` CU before/after confinement.

---

## R2. Round-18 off-chain repairs (`distribute.mjs`)

### R2-1 — `settledAsPayout` default direction

**No defect — direction is correct (pinned by suite).**

Trace:
- Larger `holdDays` → more likely `daysSinceLastPayout >= MAX_HOLD_DAYS` with `smallestPer >= 1` → `forced: true` / `pay: true` **sooner**.
- Bare `resolvedBy` does **not** reset → holdDays stays large → ceiling fires earlier → pays sooner.
- `resolvedAs: 'paid'` resets → smaller holdDays → may hold longer.

Builder’s default matches “guess in the direction that pays people.” Suite pins `2,52` and emission `[true,false]`.

---

### R2-2 — `paymentState` unchanged for re-send

**No defect found in diff for payment send path.**  
`settledAsPayout` is only used in `holdDays`. `paymentState === 'resolved'` still settles for detectors / re-send avoidance. Second reader does not broaden re-send.

**R7 check:** confirm no other cadence clock uses `paymentState(row) === 'paid'` only — see R7.

---

### R2-3 — Refusal NOTIFY + `exitCode = 1`

**HIGH — griefing → paging surface; exit code not suppressed under `--dry-run`**

**Construct.**

```js
if (plan.refusal) {
  const msg = `CBOB DISTRIBUTION REFUSED...`
  if (!DRY) { try { execFileSync(NOTIFY, ...) } catch {} }
  process.exitCode = 1  // unconditional
}
```

**Attack / accident.** Anyone can mint/activate a vault and omit it from `levels.json` (or race activation after levels snapshot). Each daily run: HIGH + NOTIFY (live) + exit 1. Under cron, exit 1 may page a second channel (deadman/monitoring). `--dry-run` still sets exit 1 → CI or operator dry-runs become red/noise without sending NOTIFY.

**Is paging right?** Halting is the recoverable failure (correct product choice). **Paging every day until levels.json is edited is correct for live.** What is wrong:
1. No rate-limit / de-dupe across days (same refusal text pages forever).
2. Dry-run should not fail the process the same way if the purpose is plan inspection.
3. Combined with unlevelled-vault as stranger-triggerable halt (known product tension), this is now a **pager DoS** with clear on-chain cost (one activation).

**Evidence:** activate vault without level; run distribute; observe NOTIFY + exit 1; repeat next day.

**Fix.** NOTIFY on transition (new refusal or changed set of unlevelled vaults), not every identical rerun; suppress `exitCode` under `DRY` or use a distinct code; optional `--force-levels-skip` is a product decision (out of scope unless owner wants it).

---

### R2-4 — `census()` null-prototype + spread

**LOW — JSON serialisation OK; consumers of prototype methods on census object break**

```js
return { ...c }  // ordinary object, own keys I..V
```

JSON.stringify/parse round-trip fine. `denominator` uses `Object.hasOwn`.  
If any consumer did `census.toString` via Object.prototype before, still works after spread. **No production break identified.** Exported purity fix is sound.

---

### R2-5 — Dust bound re-derive

**Claim:** dust &lt; activated.length (max 2,099 at 2,100 vaults).

**Integer identity.** For each paid vault, `share_i = floor(drop * w_i / DEN)`.  
Sum of floors ≤ drop, dust = drop − sum ≥ 0.  
Per-vault fractional part &lt; 1, but dust is **one** remainder for the whole drop, not the sum of per-vault remainders in the naive sense — actually:

`dust = drop - Σ floor(drop * w_i / DEN)`.  
With Σ w_i = DEN, this equals the sum of fractional parts in modular arithmetic and satisfies:

`0 ≤ dust ≤ DEN - 1` (loose) and, when every activated vault is paid with positive weight contribution pattern used here, **dust ≤ (#paid vaults − 1)** is attained at `available = DEN - 1` → dust = 2099 for N=2100 — **suite measures this**.

**When is `dust < activated.length` false?**
- If `activated.length === 0`, allocate should skip earlier; dust comparison vacuous.
- If some vaults skipped **before** `activated` is built, bound is on paid set — code uses `r.activated.length`. OK if skipped vaults are not in `activated`.
- If `available < activated.length` but still distributes: each share may be 0 for light weights; dust can be `available` when all floors are 0 → dust = available. Then `dust < activated.length` holds when `available < activated.length`. When `available >= activated.length` and all floors 0 (impossible if any weight and available ≥ DEN? floors 0 when `available * w < DEN` for all). Worst case all-zero floors: dust = available, need available &lt; N. **If available ≥ N and all shares floor to 0** (possible when available &lt; DEN / max_w * something): e.g. N large, available = N = 2100, DEN = 6405, each floor(2100*w/6405) = 0 for w≤6 → dust = 2100 ≱ 2100. **`dust < activated.length` is FALSE** (dust === N).

**MEDIUM — tighter bound comment/assertion is not always true**

Suite checks `r.dust < BigInt(r.activated.length)` on selected avail values including `1n, 7n` but the full-census loop returns `worst < 2100n` (i.e. ≤ 2099) and breaks if `dust >= activated.length`. For `available = 2100n` with all floors 0, bound breaks.

**Evidence:** run `allocateWeighted` at full census with `available = 2100n` (or any `available < 6405` where every per-vault floor is 0). If dust ≥ 2100, comment and test are overstated.

**Fix.** State dust ≤ min(available, DEN-1, f(activated)) honestly; or `dust <= available && (shares all zero || dust < activated.length)`; pin the all-zero-share case in selftest.

Note: production `decideEmission` holds while `smallestPer < MIN` (21), so all-zero share drops often do not pay — **disclosure bound can still be wrong** even if live pay path rarely hits it.

---

## R3. `scripts/bank-sign.sh` base64 round-trip

### R3-1 — Inputs accepted that are not what was pasted

**HIGH — whitespace / line-breaks; `base64 -w0` portability; `|| true` masks decode failure**

**Construct.**

```bash
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
if [ "$CANON" != "$TX" ]; then refuse; fi
```

**Issues.**

1. **`|| true` forces success.** If `base64 -d` fails, pipeline may yield empty CANON; inequality refuses — OK fail-closed for hard fail. If decode “succeeds” with GNU base64 ignoring newlines **inside** the string depending on flags:  
   - Alphabet check is on `$TX` as read (tr −d whitespace only if script does that earlier — need full script). Diff shows length % 4 on `$TX` after read. If read strips newlines, OK; if operator file is wrapped standard base64 **with** newlines, length % 4 may fail or alphabet fail.

2. **`base64 -w0` is GNU-specific.** On macOS/BSD, `base64 -w0` errors → CANON empty → **every** legitimate TX refused (availability bug). Production path is Linux (`/opt/...`) — OK on the Bank box; **breaks documented portable use**.

3. **Non-canonical decode that round-trips under coreutils but not under Node.** Node `Buffer.from(s,'base64')` is permissive (ignores invalid, accepts missing padding in some versions). Round-trip with coreutils rejects many Node-accepting strings — good.  
   **Opposite:** strings coreutils accepts and re-encodes equal to input, but Node decodes differently — uncommon if both RFC-compliant; residual risk LOW on Linux GNU.

4. **Embedded whitespace inside `$TX` after validation.** If alphabet check forbids whitespace, OK. If not in diff hunk, whitespace can make `CANON != TX` (refuse) or be stripped only on one side.

5. **Very long inputs:** ARG_MAX on `exec node ... --tx "$TX"` — accepted limit (tx in ps); 1644 chars fine.

**Legitimate 1644-char TX:** length % 4 == 0 (1644/4=411). Should pass round-trip if canonical.

### R3-2 — Corrected `ps` comment

**Comment is now true:** TX is not in *this* script’s argv as a user paste file path workflow, but **is** in cosign’s argv after exec. Comment states that. **OK.**

### R3-3 — `set -euo pipefail` + `|| true`

The assignment’s `|| true` defeats pipefail for the check pipeline — intentional. Empty CANON ≠ TX → refuse. **OK** unless both empty (empty TX should fail earlier).

**Fix.** Drop `|| true`; use explicit statuses; `base64 -w0` with fallback `base64 | tr -d '\n'`; reject whitespace in TX explicitly; test 1644-char fixture in CI.

---

## R4. `cron-install.sh` money claim

**Jobs installed (from diff):**

| Job | Line pattern | Money as installed (fresh crontab)? |
|---|---|---|
| alarm watcher | `bank/alarm.mjs` | No |
| **distribute** | `bank/distribute.mjs$DIST_DRY` | **YES live cbBTC** if `DIST_DRY` empty (default fresh) |
| **revenue** | `bank/revenue.mjs$REV_LIVE` | No unless preserved `--live` |
| reconcile | `alarm.mjs --reconcile` | No (read/report) |
| deadman SMS | notify if state stale | No (alert only) |

**Header truth.** Fresh install: distribute armed, revenue dormant — **header matches**. Re-run preserves tagged uncommented `--dry-run` / `--live` — **header matches**. Posture echo reads live crontab — **good**.

**MEDIUM — posture grep can still misread**

```bash
crontab -l | grep -F "$TAG distribute" | grep -q -- '--dry-run'
```

Does not use `ours()` (uncommented filter). A **commented** tagged line containing `--dry-run` alongside an active live distribute line: `grep -q --dry-run` may true → print DRY-RUN while live line pays. Inverse: comment says `--live` on revenue while active line dormant.

**Evidence:** crontab with active distribute without dry-run + commented line with dry-run; installer summary claims DRY-RUN.

**Fix.** Posture detection must use same `ours` filter as preserve (uncommented + tag).

**LOW — alarm/reconcile not discussed as money** — correct (they do not send cbBTC). Header “both money jobs” is complete for cbBTC movement.

---

## R5. Gates (`selftest.mjs`)

### R5-1 — `isTableRow` — covered in R1-2. Sound enough; fail-closed on format drift.

### R5-2 — MintVault struct regex

```js
/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/
```

Non-greedy to first `\n}`. Nested `}` in inline attrs unlikely in Anchor account structs. Doc comments with `}` on their own line could truncate.

**Direction (measured in suite):** truncate before `bank` → index −1 → fail closed; after `bank` → index unchanged. **Stale constant with truncate-after still matches** — cannot move bank index. **OK for stated purpose.**

**LOW residual:** `#[account(...)]` multi-line with `}` — if present, early terminate; fail closed if before bank.

### R5-3 — `codeOnly` for shell

```js
src.split('\n').filter(l => !/^\s*#/.test(l))
```

**Not a comment:** `#'` inside quotes, `echo " # "`, `CMD # trailing` — trailing comments on code lines are **kept** (line does not start with `#`).  
`#` in heredocs kept.  
**Risk:** `echo 'exec node bank/cosign.mjs ...'` counts as second exec if line-anchored match — suite pins exactly one `^\s*exec .*cosign` line. Good.

**LOW:** `codeOnly` is not a shell parser; acceptable with the “exactly one exec” pin.

### R5-4 — Stale nothingToDo arms

```js
// half-finished without nothingToDo → unfinished true
// half-finished WITH nothingToDo → unfinished false
```

These prove the **detector** suppresses on stale flag. They do **not** prove the **writer** clears the flag (that is in distribute selftest via `supersede`). Comment says “which is why the writer clears it” — writer proof is elsewhere. **Arms prove what they claim about the detector only.** Incomplete as sole justification but not false.

**Gap:** no arm for stale **`finishedAt`** alone with partial plan (R1-3). **MEDIUM gap in gates.**

---

## R6. Counts and arithmetic

**Floors (from diff):**  
`MIN_ASSERTIONS=286`, `DET_FLOOR=427`, `ALLOC_FLOOR=79`, `MAINNET_FLOOR=19`.  
selftest `FLOOR=427`, distribute `FLOOR=79`. Cross-check arms added. **I cannot re-count 427 assertions without running the file** — equality gates will fail the build if wrong.

**Independent re-derive:**

| Census | Weights | Denominator |
|---|---|---|
| 108,60,36,24,12 | 2,3,4,5,6 | 108·2+60·3+36·4+24·5+12·6 = 216+180+144+120+72 = **732** |
| 945,525,315,210,105 | same | 1890+1575+1260+1050+630 = **6405** |

**Shares of total weight (full activation same odds):**  
I: 2/Σp_i w_i … With probabilities 0.45…0.05, mean weight = 0.45·2+0.25·3+0.15·4+0.10·5+0.05·6 = 0.9+0.75+0.6+0.5+0.3 = **3.05**.  
Share I = 2/3.05 ≈ 65.5738% of equal-per-vault? **Per-vault share of drop** = w_i / DEN × drop; **level share of pool** = n_i w_i / DEN:
- I: 945·2/6405 = 1890/6405 ≈ 29.5082%
- II: 1575/6405 ≈ 24.5902%
- III: 1260/6405 ≈ 19.6721%
- IV: 1050/6405 ≈ 16.3934%
- V: 630/6405 ≈ 9.8362%  
Sum = 100%.

**Per $1000 (1000 USD of drop → sats depends on btc price — card is usually per 1000 units of pool in sats or $).** Without the card’s unit assumptions, ten figures cannot be recomputed from weights alone. **If the card uses pure weight fractions of $1000:**  
Level I vault: 1000 × 2/6405 ≈ **$0.3123**; V: 1000 × 6/6405 ≈ **$0.9368**; etc. Author’s selftest claims they match — **verify against SPEC card numbers in repo** (not fully quoted in bundle). No contradiction found in weight math itself.

**SPEC dust line still says “up to 6,404 sats”** in the provided SPEC.md (“at 2,100 vaults the remainder can be up to 6,404”) while distribute comment says 2,099. **MEDIUM — customer-facing / SPEC arithmetic drift (under/over claim).**

---

## R7. What the self-audit missed (one-of-N)

### R7-1 — Cadence question only at `settledAsPayout`?

Within the diff, `holdDays` is the cadence clock and uses `settledAsPayout`. **Cannot assert no other file** without full-tree grep of `holdDays`/`paymentState`/`daysSinceLastPayout`. **Action:** `rg "paymentState|holdDays|settledAsPayout|daysSinceLastPayout" bank/` — any second clock must use `settledAsPayout`.

### R7-2 — One-of-N still present in this diff

| Fix shape | Applied everywhere? |
|---|---|
| Clear no-pay flags | `finishedAt` added in supersede — **skip path can still stamp finishedAt on partial plan** (R1-3) |
| Preserve cron money flags | `--live` and `--dry-run` preserve added — **posture echo still greps comments** (R4) |
| Floor equality | run-tests, selftest, distribute — **SPEC dust 6404 vs 2099 not equalized** |
| Bank confinement positional mint | MINT only; SEAL pair exemption still whole-ix (by design) |
| errNames without msg | Fixed scrape — **bankErrs only SEAL+MINT**, not BURN (BURN has no BankKeyOutside*) |
| Refusal notify | distribute only |

### R7-3 — `supersede` not called when `DRY` but live flags remain

Intentional. OK.

### R7-4 — Compute / mint walk

Every mint walks all top-level ixs — CU limit unmeasured (known #12).

---

## Third target — under-claims (safer than docs)

### U1 — **HIGH (documentation) — SPEC dust / MAX_HOLD still partially wrong**

SPEC distribution section (bundle) still:
- Dust “up to 6,404” (loose bound) after code moved to 2,099 narrative.
- Cadence text was fixed with round-19 qualifier in one place; ensure **card** matches “unbounded below 1 sat/vault”.

Under-claim of risk (unbounded wait) was fixed in distribute comments; **over-claim of dust size** remains in SPEC — opposite direction of owner’s finding but same “docs ≠ code” class.

### U2 — **MINT Bank signature is mandatory on-chain; control table**

Table includes MINT confinement row and SEAL/BURN 2-of-2. **BURN/SEAL bank signer under-claim was fixed.**  

**Possible remaining under-claim:** table says co-signer policy is PROCEDURE for allowlist — correct. On-chain confinement is stronger than older prose — OK if table row present.

### U3 — **`onChainBankPin` only checks `bank: Signer` + `require_keys_eq!`**

Does not verify MINT’s instruction walk. Table ON-CHAIN row for confinement names programs and errors — mechanical check is still “has bank signer pin”, not “has BankKeyOutside walk”. **Under-claim of what the gate verifies** (gate weaker than table narrative for confinement row). **MEDIUM.**

Evidence: replace walk with `true` but leave Signer+eq → ON-CHAIN arm still green.

### U4 — Distribute refuses unlevelled vaults (halts) — stronger than “weight 0”

Documented. OK.

---

## Programs (mint confinement) — residual attack surface

### P1 — **CRITICAL residual? Exemption is disc+program only; positional bank check on all mint_vault ixs**

Current logic: any top-level `mint_vault` may include bank only at index 4. Attacker mint with bank as payer → refused (9d.4). Good.

**Still open (known 1a/3):** fee payer; bank as non-account fee payer; CPI-shaped instructions not top-level; duplicate bank at index 4 and also in another non-mint ix → non-mint path refuses.  

**Inner instruction theft:** confinement is top-level only (same as SEAL). Known.

**Is there mint-shaped ix that is not mint_vault handler?** Same disc+program → dispatched as mint_vault. OK.

**Account index vs Anchor:** optional accounts / remaining_accounts do not shift fixed struct indices in the ix account list as built by clients. If a client inserts an account before `bank`, index 4 is wrong and honest mint fails closed; attacker cannot move bank to payer without failing require. OK.

**No new CRITICAL on the payer-slot fix itself** given 9d.4 — residual is CU and fee payer (known).

### P2 — **seen_self does not prove walk continued past current**

If `load_instruction_at_checked` fails **after** current, later ixs are unchecked. Fail-open on **suffix**. Same as SEAL. Sysvar normally returns all; Err is abnormal. **LOW/accepted** unless Err can be forced — typically not by attacker.

---

## Carry-over list — worse than stated?

| # | Assessment |
|---|---|
| 1a allowlist/fee payer off-chain | Unchanged; mint now on-chain confined — **1a less bad for mint pubkey, still true for fee payer** |
| 4 bare BurnV1 second vault | Unchanged |
| 12 CU unmeasured | **Worse** (mint walk) — already flagged |
| 16 level register | Unchanged; distribute halt+page increases operational severity of bad levels.json |
| 17 EMISSION_MIN provisional | Unchanged |

**Exploitability of halt+page (related to unlevelled vault):** stranger pages operator daily — **worsens operational security**, not theft of cbBTC.

---

## Additional findings

### A1 — **MEDIUM — `process.exitCode = 1` on refusal without `process.exit`**

Depends on whether main can continue after return; if function returns to code that resets exitCode or runs other jobs, paging semantics differ. Usually OK for cron one-shot.

### A2 — **LOW — NOTIFY swallows errors `catch {}`**

Failed page + exit 1 may still alert via cron email on stderr — OK. Silent NOTIFY failure possible.

### A3 — **MEDIUM — audit19 `disqualify` whitelist `finish === 'stop'` only**

Some providers use `end_turn` / null finish with full content — could over-disqualify real auditors (process risk, not funds).

### A4 — **SPEC vs code: “nothing longer than monthly even at zero volume”**

Fixed in distribute; SPEC cadence paragraph in bundle includes qualifier. Good if shipped together.

---

# Severity summary

| ID | Sev | Title |
|---|---|---|
| R1-3 / R5-4 gap | **HIGH** | Partial plan + later skip/`finishedAt` can re-silence `distribution_unfinished` |
| R2-3 | **HIGH** | Stranger-triggerable refusal pages every day; dry-run sets exit 1 |
| R3-1 | **HIGH** | `base64 -w0` + `|| true` portability / robustness of canonical check |
| R4 posture | **MEDIUM** | Money posture summary greps commented lines |
| R2-5 | **MEDIUM** | `dust < N` false when all shares floor to 0 and available ≥ N |
| U1 | **MEDIUM** | SPEC still quotes 6,404 dust bound |
| U3 | **MEDIUM** | ON-CHAIN gate does not verify confinement walk |
| R1-1 | **MEDIUM** | Render-verify audit prompt interpolations |
| R2-3 product | **MEDIUM** | Pager DoS via unlevelled activation |
| others | LOW | isTableRow brittleness, manifest, codeOnly, NOTIFY swallow |

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Sixteen rounds of AI audit cannot replace the following **concrete** actions (beyond SPEC’s ship gate):

1. **Run the money path on mainnet-fork/devnet with chaos scripts:** quiet→pay→kill -9→resume; refuse→fix levels→pay; cron-install twice with commented `--live`/`--dry-run`; unlevelled vault under real NOTIFY sink (or mock). AI does not execute these orderings.
2. **Measure CU** for worst-case `mint_vault` and full redemption (open+3 sweeps+burn) on the deployment cluster version; fail the build above a hard cap. Limit 12 is now a mint-liveness risk.
3. **Single human operator drill:** install cron from zero, read only the script’s posture lines (not this audit), and write down whether they believe distribute is live — if wrong, header/posture still fails UX safety.
4. **External key ceremony review** (not code audit): Bank key on air-gapped or hardware path; prove no second signer on the signing host with OS tools (`auditd`/hash of tree), because repo gates cannot see out-of-tree signers.
5. **Freeze and re-run allocation card generation from code into the public card in CI** (weights → census → ten figures → PDF/markdown diff). Customer-facing arithmetic errors are cheaper to catch with a renderer than with another LLM round.
6. **Page de-duplication state** tested by firing the same refusal 48h and asserting one ticket — AI will keep missing pager-DoS economics.

I am not certifying this tree. The payer-slot mint fix and supersede(finishedAt) direction are necessary; the unfinished re-silence path, dust bound edge case, cron posture grep, and refusal paging are the highest-impact defects in *this* diff that still look real under the “evidence on ledger / cron / one command” standard.