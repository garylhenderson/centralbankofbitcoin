# Round 19 audit — ec7d17e..HEAD

**Scope discipline up front.** I was given the diff plus four bundled files (distribute.mjs, cosign.mjs, bank-sign.sh, cron-install.sh). I could NOT see: detectors.mjs, SPEC.md, the full selftest.mjs, SEAL/BURN sources, run-tests.sh beyond its diff hunks, revenue.mjs, alarm.mjs, lock.mjs. Where a finding depends on a file I don't have, I say so and give the check that settles it. Several findings below are *directly observed in the rendered prompt I received* — that is measurement, not inference.

**No CRITICAL.** I looked for one and will defend the absence: the money-sending logic in this diff (plan fixing, intent-before-send, resume, per-vault rows) is untouched except by the supersede block, which mutates only day-level flags and cannot cause a wrong payment; the MINT positional confinement is sound (analysis under R7/verdict-challenges) and is pinned by a gate; the arithmetic is correct (R6). The worst thing here is a defeated detector, not a lost coin — HIGH, not CRITICAL.

---

## R1 — The self-audit's own repairs

### HIGH — The supersede fix clears 2 of the 3 fields a non-paying morning writes; the stale `finishedAt` suppresses `distribution_unfinished` exactly as the stale `nothingToDo` did

**Construct.** The skip branch of `distribute.mjs` writes three fields on every completed non-paying live run:

```js
st.days[day].nothingToDo = plan.skip
if (plan.refusal) st.days[day].refused = plan.skip
st.days[day].finishedAt = new Date().toISOString(); save(st)
```

The new supersede block deletes exactly two of them:

```js
delete st.days[day].refused
delete st.days[day].nothingToDo
```

`finishedAt` — written by the *same morning run, three lines above* — is never cleared, and is never re-set by the afternoon run unless it completes cleanly (`if (!failed.length && !ambiguous.length) st.days[day].finishedAt = ...`).

**What an accident gains.** The self-audit's own scenario, run correctly: a quiet morning writes `nothingToDo` **and** `finishedAt` at 09:07. An afternoon run supersedes, writes the plan, and then **crashes** mid-loop (killed, OOM — the catch-block paths page, the crash path does not). The day now carries a `finishedAt` from a run that paid nobody, a plan, and partially-paid rows. `distribution_unfinished` — the instrument built for exactly "a run started and never finished," checked hourly at :23/:53 — is suppressed by the stale `finishedAt` precisely as it was suppressed by the stale `nothingToDo`. Detection latency for a crashed partial distribution goes from ~2 hours to ~24 (the next day's run surfaces the ambiguous rows). The same holds for the refuse-then-pay ordering (the refusal morning also writes `finishedAt`) and for the SOL-floor abort after a supersede.

The self-audit's comment contains the false premise outright: *"an afternoon run that paid only PART of the vaults — leaving `finishedAt` unset"* — it was **set at 09:07**. The author simulated the sequence in his head and got the third field wrong, which is why the fix has two deletes instead of three. This is the one-of-N-sites defect recurring *inside* the fix for the one-of-two-sites version of itself.

**Evidence.** (a) The three writes and two deletes are quoted above from the bundled file. (b) That `distribution_unfinished` is `finishedAt`-gated is provable from the suite's own fixtures without detectors.mjs: the arm "HIGH when a run started and never finished" fires on `{startedAt, paid:{v1:{sig}}}` — a day whose *every* row is paid — so the condition cannot be row-based; and a normally-finished paying day (finishedAt, no nothingToDo) must be quiet or every good day would alarm; therefore `finishedAt` suppresses. (c) Decisive test: feed the detector the *real* morning shape — `{startedAt:'x', finishedAt:'2026-08-20T09:07:00Z', nothingToDo:…, paid:{v1:{sig:'abc'}, v2:{sig:null}}}` — minus and plus the morning `finishedAt`. If the arm is quiet with it and loud without it, the finding is confirmed on measurement.

**Fix.** Add `delete st.days[day].finishedAt` to the supersede block (the end-of-run logic re-sets it on success; failure/crash paths then correctly leave it unset), and add the fixture above as an arm — the two arms added this round model the stale state *without* `finishedAt`, i.e. a state that cannot occur (see R5).

### MEDIUM — audit19.ts's rendered prompt contradicts itself about what diff it contains (the `${FLOORS}` defect class, found by rendering, still live in the same file that fixed it)

**Construct.** `scripts/audit19.ts` computes `DIFF = git diff ec7d17e..HEAD` but the prompt section header above `${DIFF}` reads, verbatim, "THE DIFF UNDER AUDIT (2c8cd9b..HEAD) — every repair round 17 made, in one place." Directly below it: "THE AUTHOR'S OWN VERDICT ON ROUND 15 — attack it / (round 17's verdict is being written; its findings are summarised above)."

**What is gained.** Every round-19 auditor is told the diff is round 17's twelve repairs when it is round 18's three commits. Mis-attribution of findings, distrust of the diff, and wasted effort are the mild outcomes; the real cost is that the certification instrument misdescribes its own subject — the exact defect (`${FLOORS.onchain}` shipping as literal text) this file was edited to fix, in the same template literal, missed because the fix was applied by *reading* the source, not rendering it. Root cause: audit19.ts was created by copy-then-edit of audit18.ts; everything the author didn't think about is stale.

**Evidence.** I received the rendered prompt. It contains both the correct range ("The complete diff ec7d17e..HEAD … is the subject of this round") and the stale header ("2c8cd9b..HEAD — every repair round 17 made"), plus the empty "ROUND 15 verdict" section. First-hand observation; no inference.

**Fix.** One variable, used twice: `const RANGE='ec7d17e..HEAD'` interpolated into both the `execSync` and the header. Delete or rewrite the verdict section. Then render the prompt and read it — the discipline R1 already demands — as a CI step, not a one-time act.

### MEDIUM — audit19.ts carries two adjacent roster comments that cannot both be true, and audit18.ts's roster comment contradicts its own model list

**Construct.** audit19.ts, comment block 1: "⚠️ SAME ROSTER AS ROUND 16 … so this one repeats round 16's; round 18 must differ," including "qwen died mid-stream … so both are dropped; deepseek-v4-pro and gemini-3.1-pro come in." Comment block 2, inches below: "NONE OF THESE EIGHT WAS USED IN ROUND 18." Round 18 repeated round 16's roster (audit18.ts says so); therefore if block 1 were true, all eight *were* used in round 18. Both blocks sit above a roster that is neither round 16's nor contains the models block 1 names. Separately, in audit18.ts the "qwen dropped / deepseek-v4-pro and gemini-3.1-pro come in" note sits directly above a list that **contains `qwen/qwen3-max`** and contains neither `deepseek-v4-pro` nor any gemini.

**What is gained.** The provenance of who audited what — the one fact the manifest exists to make non-narrative — is contradicted in the source a human reads first. An owner reading "SAME ROSTER AS ROUND 16" in the round-19 runner has no way to know which claim is real.

**Evidence.** Both comment blocks and both model lists are in this diff; the contradiction is checkable by reading them side by side.

**Fix.** Delete the stale block; better, generate roster provenance from the previous round's `MANIFEST-*.json` instead of prose.

### MEDIUM — the dirty-tree check is advisory; a round on a moving tree exits 0 at quorum

**Construct.** audit19.ts records `dirty` in the manifest and prints "⚠️ … DIRTY — this round did not audit a fixed tree," but `process.exitCode` is set only on quorum failure. The comment says "THE TREE MUST NOT MOVE UNDER THE ROUND"; the code does not enforce it, and `head`/`DIFF` are captured at start, so a mid-round commit is invisible even to the manifest.

**What is gained.** With no human firm, "recorded in a manifest nobody is required to read" is the same as "not gated." Round 18's two passes already audited two different HEADs while being reported as one round — the exact event this check exists to prevent — and the fix makes it a warning.

**Evidence.** Run audit19.ts with a dirty `programs/bank/scripts/tests` and quorum met: exit 0.

**Fix.** `if (dirty) { console.error(...); process.exitCode = 1 }` — or at minimum record `failed:true` in the manifest and have the verdict writer refuse on it.

### The manifest itself — verified well-formed

`dirty.split('\n').filter(Boolean)` yields an array of porcelain lines; `JSON.stringify` escapes whatever they contain; the not-trimming fix correctly preserves the two-char status field. No defect found. (The `isTableRow` hoist is assessed under R5.)

---

## R2 — The round-18 off-chain repairs

### settledAsPayout's default direction — VERIFIED CORRECT (measurement, not endorsement of the prose)

Trace: a bare `resolvedBy` that does **not** count as a payout leaves the anchor on the older real payout → `holdDays` larger → `daysSinceLastPayout >= 31` reached sooner → `decideEmission` returns `{pay:true, forced:true}` sooner. Counting it would shrink `holdDays` and delay the forced payout. In the sub-threshold regime (the only regime where the cadence matters), not-resetting pays **earlier or the same, never later**. The builder had the direction right; the default stands. The self-test's `'2,52'` arm demonstrates exactly this.

### paymentState left unchanged — still true for every caller I can see; unverifiable beyond

The send loop (`state === 'resolved' → continue`) and the SOL-floor count (`=== 'unpaid'`) both treat resolved rows as never-re-sent, correctly. `settledAsPayout` reads `resolvedAs` without affecting sending. **But** detectors.mjs also reads these rows and is not in my bundle — the claim "no other paymentState caller conflates the same thing" cannot be checked against a file this round's off-chain auditors were not given (see Third Target).

### The refusal paging — the paging is right; the page itself is the unmonitored path

- **Is paging correct?** Yes. The halt is the round-17 ruling (paying without levels overpays permanently); a halt that pages nobody was the defect. The grief is bounded: the cron fires once daily → at most one SMS per day per standing refusal; the trigger costs a Bank-co-signed mint plus 21,000 sats (i.e., becoming a customer); the remedy is one edit to levels.json. A silent halt is strictly worse. The dry-run exit code is consistent (a refusal is a refusal; nothing is written under `--dry-run`, so no detector ever sees dry-run refusals — acceptable for a rehearsal mode).
- **MEDIUM — every "pages a human" in this diff degrades to "prints to a log" if the notify script breaks.** All NOTIFY call sites are `try { execFileSync(NOTIFY, …) } catch {}` — the catch is empty. A missing, non-executable, or failing `notify-gary-sms.sh` converts the refusal page, the SOL-floor page, and the failed/ambiguous page into stderr in a rotated log, with exit code the only residue. Given that this process *is* the certification, the paging path is the least-instrumented code in the repository. Evidence: grep `NOTIFY` in distribute.mjs — four sites, four empty catches. Fix: log the failure in the catch, and add a deadman/test-page for the notify script itself (the alarm already has one; the pager does not).
- LOW: each manual rerun of a refusing day re-pages (no per-day dedupe). Bounded; note only.

### census()/denominator() — verified

`census` builds null-proto internally and returns `{ …c }` — a **normal-prototype** object, so no consumer can observe the null proto; JSON round-trips it; `denominator`'s `Object.hasOwn` works on both plain and read-back objects; `LEVELS.map(l => c[l] || 0)` works. No consumer needed anything it doesn't get.

### The dust bound — re-derived; the claim is true

For each activated vault, `available·w_v = amt_v·den + r_v` with `0 ≤ r_v < den`. Summing over all activated: `available·den = total·den + Σr_v`, so `dust = available − total = Σ(r_v/den) < activated.length` — one strictly-sub-sat fractional part per **paid** vault, always, independent of pool size. When `available` is smaller than the vault count, every `amt_v` is 0, `smallest < min`, and the function returns the `empty` shape with `dust: 0n` — the bound holds trivially. Skipped (mid-run-burned) vaults don't affect it because `dust` is fixed at plan time over the full activated set. 2,100 vaults → max 2,099. The corrected comment is the true bound. (Pre-existing, not this diff: on a day with mid-run burns the console line reports `plan.total`/`plan.dust`, which no longer match what was actually sent or what actually remains — the per-vault ledger rows are accurate, the summary line is not. LOW.)

---

## R3 — bank-sign.sh's canonical round trip

**No bypass found.** Reasoning: whitespace is stripped before any check, so `base64 -d` never sees any; the alphabet/padding/length pre-checks mean the only inputs reaching the round trip are alphabet-only, multiple-of-4, padding-only-at-end strings. For those, `base64 -d` either errors (→ `|| true` → `CANON` empty or partial → `!= $TX` → refuse, fail-closed under `set -euo pipefail` — the command substitution captures output regardless of status, and the `|| true` neutralizes `-e`) or decodes to bytes whose `-w0` re-encoding equals the input **only if** the input was canonical. Anything that passes equals the canonical encoding of the bytes it decodes to, and Node decodes canonical input to exactly those bytes. All five measured lookalikes (`====`, `A===`, `AB==`, `AAB=`, `AAAA====`) are refused. `printf '%s'` cannot mangle an alphabet-only string; `$()` strips only trailing newlines, which `-w0` output doesn't have (and stripping would be harmless anyway).

**Does it reject anything legitimate?** A real 1232-byte transaction is 1644 padded canonical characters — accepted. Two LOW notes:

- **LOW — environmental:** on any system whose `base64` lacks `-w0` (BSD/macOS), the second stage fails, `2>/dev/null` hides "invalid option," and **every** input — including perfect ones — is refused with the misleading "not CANONICAL base64" message. Fail-closed but misdiagnosed. Fix: probe `base64 -w0 </dev/null` once and emit a distinct error, or fall back to `base64 | tr -d '\n'`.
- **LOW — undocumented strictness:** unpadded base64 (length ≡ 2 or 3 mod 4), which Node accepts and some tools emit, is rejected by the multiple-of-4 check. Intended, but the comment doesn't say so; an operator with an unpadded paste will debug the wrong thing. One sentence fixes it.

**The corrected `ps` comment — TRUE.** The last line is `exec /usr/bin/env node bank/cosign.mjs --tx "$TX" …`, so the base64 is in the node process's argv for its lifetime; the comment now says exactly that, and the "not in *this* command's history" claim is accurate for the script itself.

---

## R4 — cron-install.sh's money claim

Enumerating the five installed lines, not the header:

1. `23,53 * * * *` alarm.mjs (watcher) — reads chain, moves nothing.
2. `7 9 * * *` **distribute.mjs — LIVE.** No `--dry-run` on the line; loads the distributor key; sends cbBTC. Header's claim is true.
3. `41 */6 * * *` revenue.mjs — dormant unless `$REV_LIVE` was preserved from an existing armed cron (see below).
4. `19 4 * * *` alarm.mjs --reconcile — reads, moves nothing.
5. `9 */2 * * *` deadman — sends an SMS, moves no money.

The new header is true for a fresh install. **LOW:** on a *reinstall* over an already-armed revenue cron, `REV_LIVE` preserves `--live`, so "revenue … installed WITHOUT it … Safe" describes only the fresh case; the body comment and the install-time "NOTE: … keeping it" disclose it, but the header block — the thing the round-18 defect taught operators to read — does not. One clause fixes it: "and stays armed on reinstall if you armed it."

---

## R5 — The gates

### The MintVault struct regex — fails CLOSED; residual risks worth writing down

`/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/` truncates at the first line beginning with `}`. Inside an Anchor struct that can only happen via a block comment or doc comment containing a line-initial `}` — none exists today. Fail direction: truncation removes *trailing* fields, so `indexOf('bank')` is either correct or −1 → the index assertion goes red, never silently green; the `slice(0,6)` assertion is a second backstop against matching a quoted struct in prose. Sound. Residual: a doc comment that quotes the struct *verbatim* through `payer` would satisfy both assertions while the real struct differed — contrived, but the cheap hardening is to require the match to be outside comment lines (the `codeOnly` trick, applied to Rust).

### codeOnly — correct for this file; the general answer is "a `#` inside a heredoc"

For bank-sign.sh (no heredocs, no multi-line strings), `^\s*#` is exactly the comment set; `${VAR#pat}` expansions are mid-line and untouched. The general predicate is wrong for any shell with a heredoc — a heredoc body line starting with `#` is data. bank-sign.sh has none; if codeOnly is ever reused on cron-install.sh, it will strip lines out of the CRON heredoc. Fix: a comment noting the heredoc limitation at the definition.

### The two nothingToDo arms — they prove the motivation, not the fix, and their fixture is a state that cannot occur

The arms prove the detector fires on a half-finished day and is suppressed by `nothingToDo`. They do not execute the supersede block, which has **zero** test coverage anywhere. Worse, the fixture omits `finishedAt` — but a real quiet morning *always writes it* — so the arms model a stale state the writer never produces, and pass precisely because the fixture is missing the third field the fix forgot. This is not a decoration complaint; it is the reason the incomplete fix looked sufficient. Fix: the arm from R1 (real morning shape), plus one end-to-end sequence test driving the supersede block itself.

### isTableRow — used at every site visible in the diff; the predicate hardcodes three verdicts and fails OPEN for C5

Visible uses: `tableRows`, `tableLines`, the moved-out-of-table arm — one definition, three consumers, plus `rows` downstream of `tableRows`. What I cannot confirm: whether the "a row this parser cannot read is not a row that passes" guard (referenced in the diff context, implementation not shown) uses `isTableRow` or a second pattern — if the latter, two definitions coexist and the hoist is incomplete. The predicate itself: `/^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/` — a fourth verdict value, a missing period, or a formatting change silently drops the row. Direction of failure is asymmetric and worth stating: for the BankKeyOutside* arm a dropped row fails **closed** (the error name is then absent → red); for C5's fourth-column check a dropped row fails **OPEN** (an unparseable row is simply never verified). Fix: derive the verdict alternation from one constant shared with the guard, and make C5 treat "table-shaped line that isTableRow rejects" as a failure, not as a non-row.

**LOW:** `tableSrc.includes(n)` is a substring test — a hypothetical `BankKeyOutsideMintV2` row would satisfy `BankKeyOutsideMint`. Match on the cell, not the substring.

---

## R6 — The counts and the arithmetic, independently

**Floors.** From the diff: `DET_FLOOR 395→403`, `ALLOC_FLOOR 54→63`, `MAINNET_FLOOR=19` unchanged. Cross-checks: selftest.mjs's internal `FLOOR 395→403` = +8 new arms (2 nothingToDo, 1 exec both-ways, 4 MINT_IX_BANK_IDX, 1 moved-out-of-table) ✓; distribute's `FLOOR 54→63` = +9 (6 settledAsPayout, 2 round-trip dates, net +1 dust) ✓. `MIN_ASSERTIONS` is not in the diff and I cannot verify 284 from what I was given; note that 9d.4 adds one on-chain assertion, so if the floor wasn't bumped the suite count is now ≥285 — and note the general nit: the prompt quotes *floors* as *counts*, which is the same loose-bound shape the dust comment just condemned. Quote the actual count or say "at least."

**Arithmetic — all verified from the weights:**
- 108+60+36+24+12 = 240; 108·2+60·3+36·4+24·5+12·6 = 216+180+144+120+72 = **732** ✓
- 945+525+315+210+105 = 2100; 1890+1575+1260+1050+630 = **6405** ✓
- per-$1,000 @240: 2000/732=2.732→**2.73**; 3000/732=4.098→**4.10**; 4000/732=5.464→**5.46**; 5000/732=6.831→**6.83**; 6000/732=8.197→**8.20** ✓
- per-$1,000 @2100: 0.312→**0.31**; 0.468→**0.47**; 0.625→**0.62**; 0.781→**0.78**; 0.937→**0.94** ✓
- shares @2100: 189000/6405=29.51→**29.5**; 157500/6405=24.59→**24.6**; 126000/6405=19.67→**19.7**; 105000/6405=16.39→**16.4**; 63000/6405=9.84→**9.8**; Σ(cen·w)=6405 exactly, so the sum is exactly **100.0** ✓
- Level V = 6/2 = exactly **3×** Level I ✓

No defect in the published figures.

---

## R7 — What the self-audit missed (the sweep)

1. **`finishedAt`** — the one-of-three-fields recurrence; see R1 HIGH. This is the round's worst defect.
2. **`realDay` is module-private.** The date-validation fix was applied to `holdDays`'s two filters and nowhere else. detectors.mjs and alarm.mjs read the *same ledger day keys*; if either parses them with bare `Date.parse`, the rollover defect (`2026-02-30` → March 2, finite, confident) lives there. Export `realDay` and sweep every day-key reader. Unverifiable from this bundle — which is itself part of the problem (see Third Target).
3. **The base64 canonical fix is one-of-two-sites.** The round trip lives only in the wrapper. `cosign.mjs` still does `Transaction.from(Buffer.from(b64,'base64'))` — the silently-truncating decoder the wrapper exists to guard. Any direct invocation of cosign.mjs (the header says "DO NOT RUN THIS DIRECTLY" — procedure, not enforcement) gets the fail-open decode. This makes known limit 1a worse than stated: a non-wrapper caller loses not two protections but three (allowlist, fee-payer, canonicality).
4. **Copy-then-edit as the defect generator.** audit19.ts's stale headers, stale verdict section, stale "see R1" pointer in known-limit 12 (R1 this round is the self-audit repairs, not compute units), and contradictory roster comment are all unedited remnants of audit18.ts. Every one is the ${FLOORS} class: invisible in source, obvious when rendered.

**The "settledAsPayout is the ONLY site" claim:** true within distribute.mjs — `holdDays` is the only cadence consumer, and the send loop and SOL-floor count use `paymentState` correctly for their (different) questions. The claim's extension to "no other paymentState caller conflates the same thing" is unverifiable against detectors.mjs and alarm.mjs, which read the same rows and were not in the sweep's evidence.

---

## Third target — under-claims and their inverse

### MEDIUM — cosign.mjs's header: "THE BANK-PUBKEY CONFINEMENT IS ON-CHAIN NOW, IN BOTH PROGRAMS THAT TAKE THE BANK'S SIGNATURE" — there are three, and the third has no walk

SEAL (`open_for_redemption`), MINT (`mint_vault`), and BURN (`burn_vault`) each take `bank: Signer` pinned to their own config — the architecture section of this very prompt says so, and BURN's own account list (`BURN_FIXED_ACCOUNTS`) includes `bank`. Only SEAL and MINT walk the instructions sysvar. BURN is covered **transitively**: `burn_vault` refuses unless `open_for_redemption` appeared earlier in the same transaction, and open's walk covers every instruction in it. That transitivity holds today and is airtight — but it is a *dependency on the pairing invariant*, and the sentence as written claims a confinement in BURN that does not exist. If the pairing is ever relaxed (a standalone burn path, a burn-without-open variant), BURN has no confinement of its own and the Bank's signature on a burn could accompany a theft, with this header still assuring the reader it cannot. This is the over-claim direction of the owner's find, sitting in the file whose entire header was rewritten this round to be precise about exactly this distinction. Fix: state it exactly — "SEAL and MINT walk; BURN is covered because burn_vault cannot appear without open_for_redemption in the same transaction" — and add a selftest arm asserting that dependency (BURN's source requires the preceding open), so the transitivity cannot silently break.

**Under-claim candidates for the owner to read in SPEC (I could not — it is not in my bundle):** (a) distribute.mjs's treasury pin — the distributor key must equal `config.treasury`, read from the chain; (b) the `minted_total` cross-check — distribution refuses a vault list that disagrees with the chain's own count; (c) the signing-key mode checks (0o077 refusal) at three sites. Each is a real, running control; if the control table carries no row — or says PROCEDURE — that is the owner's shape of find, and no gate looks for it.

### MEDIUM — the round asked to hunt under-claims was not shipped the document the under-claims live in

The off-chain focus bundles distribute/cosign/bank-sign/cron-install. It does **not** bundle SPEC.md (the control table — the subject of the third target), detectors.mjs (the behavior R5's new arms assert), selftest.mjs (the gates R5 asks about), or the MintVault struct (R5, programs-only). `audit-coverage.sh` measures coverage *across rounds 1–17* — but every file this round's questions depend on changed *after* round 17, so cross-round coverage does not cover them. Fix: mechanically parse each R-item for file paths and assert those files are in that pass's bundle.

---

## Carry-over list — worse than stated, or not

- **1a — WORSE than stated.** A caller other than bank-sign.sh loses three protections, not two: program allowlist, fee-payer check, *and* base64 canonicality (R7 item 3). Amend the limit's text.
- **12 — the pointer is stale.** "This one got worse this round — see R1" refers to round 18's R1; this round's R1 is the self-audit's repairs. Nothing in this diff measures compute units either.
- **11 — marginally worse.** The supersede block gives the ledger's writer a new authority (deleting verdict flags) that the detector trusts; the mitigation is `supersededAt`/`supersededWas`, which no detector reads.
- **17 — an observation for Gary, not a defect:** at the 31-day ceiling a dust pool forces 1-sat payouts whose transfer fees (5,000 lamports each) rival or exceed their value. Intended by "whatever it holds," but the ratification of `EMISSION_MIN_PER_VAULT` should decide whether the *forced* floor is also 21 sats.
- 2, 3, 4, 5, 6, 7, 8, 9, 10, 13–16, 18: unchanged by this diff; nothing here makes any of them exploitable that was not already.

---

## Verdict challenges

- **Self-audit repair 1 (${FLOORS}):** the floors now interpolate — verified in the prompt I received (284/403/63/19 all rendered). But the same template literal still ships two stale headers and an empty verdict section (R1 MEDIUM). The fix worked; the class survived it.
- **Self-audit repair 2 (isTableRow hoist):** genuinely one definition at every visible site; predicate risks as in R5.
- **Self-audit repair 3 (clear both flags):** incomplete — the headline HIGH. The self-audit's own prose ("leaving finishedAt unset") contains the error.
- **Self-audit repair 4 (manifest):** correct and well-formed.
- **"settledAsPayout is the only site":** true in distribute.mjs; unproven for the files not in evidence.
- **The MINT fix itself:** I attacked it and it held. The exemption requires `program_id == MINT` **and** the mint_vault discriminator, so an exempted instruction *is* a real mint_vault invocation; within it the Bank's key is confined to index 4, which Anchor binds to the config-pinned `bank: Signer`; appended extra accounts carrying the Bank's key are caught by the enumerate loop (index ≠ 4); batch mints (two mint_vaults, bank at 4 in each) pass legitimately; a mint beside a redemption pair is now impossible (each program's walk refuses the other's bank slot), which is fine — they never legitimately co-occur. The one thing I could not verify from the diff is that the walk *continues past* `current` (the loop body isn't shown); the round-18 prompt claims it does, and the suite's 9d.1 (bank in a *later* instruction?) — if 9d.1 places the theft instruction after the mint, that is the evidence; confirm it does.

---

## Anything else

- **LOW:** `disqualify()` doesn't handle `finish_reason === 'content_filter'` — a filtered, partial report counts as an auditor. One line.
- **LOW:** the "moved out of the table" arm silently *requires* `BankKeyOutsideMint` to also appear in SPEC prose (otherwise the "old check: blind" half returns 1, not 0) — the test enshrines the round-11 defect shape (name-in-prose) as a precondition. If someone cleans the prose, this arm breaks confusingly.
- **LOW:** dual copies of 403 (selftest.mjs internal FLOOR and run-tests.sh DET_FLOOR) are the duplicated-number shape, but benign here because both are minima and the higher governs.

---

## Given that no human firm will ever see this

What sixteen rounds of AI audit structurally cannot do, and what to build instead:

1. **A ledger state-machine fuzzer with the detectors as oracle.** Every serious defect in this round — `finishedAt`, and before it `nothingToDo`, and before that the row-counting cadence