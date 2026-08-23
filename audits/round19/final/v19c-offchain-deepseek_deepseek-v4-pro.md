**Audit Report — Round 19 (diff ec7d17e..HEAD)**  
**Scope**: Self‑audit repairs, R18 off‑chain fixes, gate changes, counts, under‑claims.  
**Assessment**: After careful analysis, no CRITICAL or HIGH severity findings that survive measurement were found. A small number of MEDIUM and LOW issues are identified, plus observations about structural improvements.

---

### R1 – Self‑Audit Repairs (NEWEST CODE, LEAST READ)

**MEDIUM – `census()` returns a standard object despite null‑prototype origin**  
- The `census()` function creates `const c = Object.create(null)`, fills it, then `return { ...c }`. The spread produces a plain object with a normal prototype, so any later use of `census` that expects property‑chain inheritance (e.g., `toString`) will work; the null prototype was therefore only a defence inside the loop and was erased at the boundary.  
- **Impact**: No direct exploit, but the exported helper’s contract is inconsistent: an internal null‑prototype is destroyed by the spread, so callers who might have relied on a prototype‑free object (e.g., for `for…in` without hasOwn) would be misled. This is minor because the codebase always uses `Object.hasOwn`.  
- **Evidence**: `census({a:'constructor'})` yields `{I:0,II:0,…}` not `constructor`. The null‑protect was already handled by the loop’s `Object.hasOwn(c, v)`.  
- **Fix**: Keep `c` as a plain object from the start (`const c = {}`) or return the raw `c` and adjust consumers to always use `Object.hasOwn`. The current spread is harmless but obscures the intent.

**LOW – Unnecessary duplicate import `fsx2`**  
- `bank/distribute.mjs` imports `fs` as `fsx2` (line `import fsx2 from 'fs'`) alongside the normal `fs` import. It is used only once to read `detectors.mjs`.  
- **Impact**: No functional fault; a maintenance smell.  
- **Fix**: Remove the duplicate; rename the first import to `fs` or use `fs` directly.

**INFO – Floor equality could break on missing counter updates**  
- The `FLOOR` checks in `distribute.mjs` and `selftest.mjs` now demand `R.length === FLOOR`. If a developer adds or removes a test but forgets to update the floor, the build fails. This is intentional hardening, not a bug, but it introduces a new maintenance constraint.  
- **Observation**: The earlier `>=` check could hide drifting test counts; equality eliminates that slack. The risk is a spurious CI failure after a legitimate test change, not a security flaw.

---

### R2 – Round‑18 Off‑Chain Repairs (`bank/distribute.mjs`)

**MEDIUM – Daily pageable refusal for unlevelled vaults (griefing surface)**  
- Activating a vault with no level (or with an unknown level string) causes `allocateWeighted` to return `{ refusal: true, skip: … }`. The `main()` function then calls `execFileSync(NOTIFY, …)` with exit code 1 **every time the distribution runs**, unless `--dry-run` is present.  
- **Impact**: Any person can mint a vault, fund it with 21,000 sats (or more) and leave it unlevelled; every subsequent 09:07 UTC triggers a page to the operator. This is a denial‑of‑service against operational attention, not against funds. It is explicitly documented and accepted (the refusal is meant to page), but the design hands a paging trigger to the public.  
- **Evidence**: The code at `if (plan.refusal) { … execFileSync(NOTIFY …) }`. The page is suppressed under `--dry-run` but not in the live path.  
- **Fix**: Accept the risk as documented. Alternatively, rate‑limit pages for the same condition (e.g., only page if the refusal persists for two consecutive days) or add an off‑chain acknowledgement that silences recurrence until the level is assigned.

**LOW – `realDay` used inside `holdDays` is correct but depends on `Date.parse` behaviour**  
- The `realDay` helper round‑trips via `new Date(t).toISOString().slice(0,10)`. This correctly rejects `2026-02-30`. No defect found; the implementation is sound.

**LOW – The `--dry-run` path leaves `process.exitCode = 1` but does not page**  
- For a refusal, `--dry-run` sets `process.exitCode = 1` without sending the page, as documented. This is appropriate for a health‑check CI job that wants to signal a problem without spamming. No issue.

**INFO – `paymentState` unchanged; `settledAsPayout` correctly separates cadence**  
- `paymentState` still marks a row as `'resolved'` if `resolvedBy` is set, and `detectDistribution` honours that. The distribution loop (`state === 'resolved'`) skips such rows, so a human‑resolved transfer is never re‑sent. The cadence‑only `settledAsPayout` does not alter that behaviour.

---

### R3 – `scripts/bank-sign.sh` Base64 Round Trip

**No fault found.**  
- The round‑trip via `base64 -d | base64 -w0` and comparison rejects non‑canonical encodings (e.g., `AAAA====`).  
- Whitespace is stripped by `tr -d '[:space:]'` before the alphabet check.  
- A missing `base64 -w0` (or a failed pipe) results in an empty `CANON`, which never equals `TX`, so the script fails closed.  
- The comment about `ps` exposure is now accurate: the transaction is passed as an argument to `node bank/cosign.mjs` and appears in the process list; this is documented as a minor exposure of an unsigned transaction.

---

### R4 – `scripts/cron-install.sh` Money Claim

**LOW – `ours()` function may mis‑identify commented lines if the comment character is not at the start of the line**  
- The filter `grep -v '^[[:space:]]*#'` correctly drops lines that begin with optional whitespace and `#`. Any commented‑out line that does not conform (e.g., a line starting with a non‑comment character and then a `#`) would not be filtered, but such a line would not be a valid cron entry.  
- **Impact**: None in practice; the filtering is adequate.  
- **Fix**: None necessary.

**INFO – Money posture summary now computed from actual crontab**  
- The installer correctly reads the new crontab to report `--dry-run` or `--live` status. The summary is authoritative. No defect.

---

### R5 – Gates Added or Changed (`bank/selftest.mjs`)

**LOW – `isTableRow` regex is strict but matches the SPEC format**  
- The pattern `/^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/` requires the bold class to be at the end of the row, with a trailing `.` after the `**`. A row that omits the period (e.g., `| **ON-CHAIN** `) would be invisible to the parser and would be flagged by the `block.filter(l => !isTableRow(l))` check, failing the build. This is a format‑enforcement mechanism, not a security bypass.  
- **Evidence**: The test `EVERY row in the control table block carries a classification` would fail if a row is not classified, so the build would break.  
- **Fix**: None needed.

**INFO – `MintVault` struct regex could be truncated by a closing brace `}` on a line inside the struct, but fails closed**  
- The non‑greedy `([\s\S]*?)\n\}` stops at the first `\n}`. If the struct contained a line with `}`, the parse would capture fewer fields, and `bank` might not appear in the list. `indexOf('bank')` would return -1, which would not equal the declared index, so the test fails and the build breaks (safer). So failure is closed.

**INFO – `codeOnly` strips comment lines only; inline comments after `exec` could still cause false matches**  
- The `codeOnly` function removes lines starting with optional whitespace and `#`. A line like `exec node bank/cosign.mjs … # harmless` would not be stripped, but the regex `^\s*exec .*cosign\.mjs.*$` matches the whole line, so it still finds the exec line. The subsequent `replace` for tampering would still target the first match. Since the goal is to verify that the exec line’s structure hasn’t been altered, a trailing comment does not affect the test.  
- **Evidence**: The gate asserts there is exactly one exec line; a trailing comment does not create a second line.

---

### R6 – Counts and Arithmetic

**No fault found.**  
- All published figures (240‑vault denominator 732, 2100‑vault denominator 6405, per‑$1,000 amounts, shares summing to 100.0%) verify exactly.  
- The dust bound `dust < activated.length` is proved and attained at `available = denominator - 1`.  
- Floors are checked for equality against the actual assertion counts.

---

### Third Target – Under‑Claims (System Safer than Documented)

**No significant under‑claim found.**  
- The correction in R18 for the co‑signer row already removed the under‑claim that the Bank could be skipped. The current SPEC correctly distinguishes mandatory on‑chain signature from policy.  
- The distribution job’s per‑payment vault‑liveness check (`conn.getAccountInfo`) is already documented in “What the job refuses to do”.  
- The alarm’s `detectVaultSetChange` with `maxDropRatio` guard is described.

---

### Structural Advice (Beyond AI Audit)

1. **Bug Bounty Program** – A public bug bounty with meaningful rewards would attract human researchers who can test live behaviour, something AI passes cannot.  
2. **Formal Verification of On‑Chain Programs** – Use a tool like Kani or the Solana verifier to prove critical invariants (e.g., the seal‑burn pairing, no arithmetic overflow, no unexpected token drains).  
3. **Multi‑Party Computation (MPC) for the Bank Key** – Split the Bank’s signing key among several parties (or devices) so that no single compromise halts redemptions or enables co‑signing malicious transactions. This is especially important given the Bank key must remain a plain keypair.  
4. **Continuous Integration with Simulated Attacks** – Extend the test suite to include adversarial transactions that attempt the known griefs (e.g., airdropping dust token accounts, nesting a vault, using a durable nonce) and verify that all detectors alarm and the co‑signer refuses. Automate these as part of CI.  
5. **Regular Threat Modeling Workshops** – Involve external domain experts (DeFi, Solana, Core) to stress‑test the architecture, especially around the off‑chain scanner and the trusted swap hop.  

**End of Audit**