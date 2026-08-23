An independent security audit of the provided diff and files has been conducted. The findings are ordered by the requested targets.

### R1. THE SELF-AUDIT'S OWN REPAIRS

**CRITICAL: The prompt text injects the WRONG DIFF, auditing round 18's repairs instead of round 17's.**
- **The Construct:** In `scripts/audit19.ts`, the header claims to audit `2c8cd9b..HEAD` (round 17's repairs), but the `DIFF` variable is generated using `ec7d17e..HEAD` (round 18's repairs). The prompt then injects `${DIFF}` directly into the text.
- **The Gain:** The models are told they are auditing round 17's repairs, but they are actually reading round 18's repairs. This is a template-literal defect that causes the audit to completely miss the intended target code, rendering the certification invalid.
- **The Evidence:** Run `scripts/audit19.ts` and read the generated prompt. The header will say `THE DIFF UNDER AUDIT (2c8cd9b..HEAD)` but the actual diff content will be from `ec7d17e..HEAD`.
- **The Fix:** Change the `DIFF` generation in `scripts/audit19.ts` to match the intended target: `const DIFF=execSync('cd '+R+' && git diff 2c8cd9b..HEAD -- programs bank scripts tests', {maxBuffer:64*1024*1024}).toString()`.

**MEDIUM: `isTableRow` misses valid control table rows with leading spaces.**
- **The Construct:** In `bank/selftest.mjs`, `isTableRow` is defined as `const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)`.
- **The Gain:** Markdown tables allow leading spaces before the first `|`. If a control table row is indented, the `^\|` anchor will fail to match it, causing the gate to silently ignore that row.
- **The Evidence:** Add a space before a valid control table row in `SPEC.md`. The `isTableRow` filter will drop it, and the assertion will fail or pass incorrectly.
- **The Fix:** Allow optional leading whitespace: `const isTableRow = l => /^\s*\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)`.

**LOW: `codeOnly` strips valid shell code inside multi-line strings or here-docs.**
- **The Construct:** In `bank/selftest.mjs`, `codeOnly` is defined as `src => src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')`.
- **The Gain:** While it works for the current `scripts/bank-sign.sh`, if a shell script ever uses a here-doc or a multi-line string containing a line that starts with `#`, `codeOnly` will strip it, corrupting the source text before the regex check.
- **The Evidence:** Add `echo "\n# not a comment\n"` to `bank-sign.sh`. `codeOnly` will remove the middle line.
- **The Fix:** This is acceptable for the current file, but a true shell parser would be needed to safely strip comments without breaking strings.

### R2. THE ROUND-18 OFF-CHAIN REPAIRS

**HIGH: A stranger can page a human on every daily run (Griefing Surface).**
- **The Construct:** In `bank/distribute.mjs`, the refusal branch calls `NOTIFY` and sets `process.exitCode = 1` if `plan.refusal` is true.
- **The Gain:** Anyone can mint a vault and fund it with 21,000 sats. Since levels are assigned off-chain, the new vault will have no level, triggering the `plan.refusal` halt. This will page a human operator every single day until the operator manually updates `levels.json`. A griefing surface has become a paging surface.
- **The Evidence:** Mint a vault, fund it, and run `distribute.mjs`. It will halt, call `NOTIFY`, and exit with 1.
- **The Fix:** The halt is correct (to prevent overpaying others), but the notification should be rate-limited or the unlevelled vault should be automatically skipped/flagged rather than halting the entire distribution.

**LOW: `holdDays` direction is correct, paying holders sooner.**
- **The Construct:** `settledAsPayout` returns `false` for a bare `resolvedBy`.
- **The Gain:** By returning `false`, the day is not counted as a payout day. This makes the `anchor` earlier, resulting in a LARGER `holdDays`. A larger `holdDays` hits the 31-day ceiling sooner, forcing a payout earlier. The builder's logic is verified and correct.

### R3. scripts/bank-sign.sh — THE CANONICAL BASE64 ROUND TRIP

**CRITICAL: The canonical check rejects ALL legitimate transactions on macOS.**
- **The Construct:** `CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true`
- **The Gain:** The `-w0` flag is specific to GNU `base64` (coreutils). On macOS (BSD `base64`), `-w0` is an invalid option. The command fails, the pipeline exits with 1, and `CANON` becomes empty. The script then compares `"" != "$TX"` and rejects every valid transaction. An operator on a Mac cannot sign anything.
- **The Evidence:** Run `echo "AAAA" | base64 -w0` on a Mac. It will error with `illegal option -- w`.
- **The Fix:** Use a cross-platform way to strip newlines, or detect the OS. For example: `base64 -d | base64 | tr -d '\n\r'`.

### R4. scripts/cron-install.sh — THE MONEY CLAIM

**HIGH: The header claim is false; `distribute.mjs` is armed immediately.**
- **The Construct:** The header says `distribute is LIVE FROM THE NEXT 09:07. It is gated by --dry-run, not by --live, and the installed line does not carry it.`
- **The Gain:** The script installs `distribute.mjs` WITHOUT `--dry-run`. Since `distribute.mjs` is opt-out, installing the crontab immediately arms a live cbBTC sender. The new header correctly states this, but the script still installs it live by default, which contradicts the safety principle of not moving money unattended immediately after installation.
- **The Evidence:** Run `scripts/cron-install.sh` and check the crontab. The `distribute.mjs` line will not have `--dry-run`.
- **The Fix:** Add `--dry-run` to the installed `distribute.mjs` cron line by default, requiring the operator to manually remove it when they are ready to go live.

### R5. THE GATES ADDED OR CHANGED

**MEDIUM: `BankKeyOutside*` regex misses errors not formatted exactly.**
- **The Construct:** `const errNames = src => [...src.matchAll(/#\[msg\("[^"]*"\)\]\s*(\w+),/g)].map(m => m[1])`
- **The Gain:** If an error enum variant has a comment between the `#[msg(...)]` macro and the variant name, or if it spans multiple lines, the regex will miss it.
- **The Evidence:** Add `// comment` between `#[msg("...")]` and `BankKeyOutsideMint,`. The regex will fail to capture it.
- **The Fix:** Update the regex to allow optional comments or newlines: `/#\[msg\("[^"]*"\)\]\s*(?:\/\/[^\n]*\n\s*)*(\w+),/g`.

### R6. THE COUNTS AND THE ARITHMETIC

**Verified:**
- Census: 108 + 60 + 36 + 24 + 12 = 240 (Launch). 945 + 525 + 315 + 210 + 105 = 2,100 (Scale).
- Denominator (Scale): (945 * 2) + (525 * 3) + (315 * 4) + (210 * 5) + (105 * 6) = 1890 + 1575 + 1260 + 1050 + 630 = 6,405.
- The arithmetic is correct.

### R7. WHAT THE SELF-AUDIT MISSED

**MEDIUM: `paymentState` conflation fix was NOT applied to all sites.**
- **The Construct:** The builder claims `settledAsPayout` is the ONLY site asking the cadence question.
- **The Gain:** In `bank/distribute.mjs`, the `holdDays` function was updated to use `settledAsPayout`, but if there are other scripts (like `alarm.mjs` or `revenue.mjs`) that read the ledger to determine if a payout occurred, they might still be using `paymentState(row) === 'paid'` directly, missing hand-paid resolutions.
- **The Evidence:** Grep for `paymentState` across the off-chain pipeline to ensure no other file is manually checking for `'paid'` when it should be using `settledAsPayout`.

### THIRD TARGET: UNDER-CLAIMS (SAFER/STRONGER THAN DOCUMENTED)

**MEDIUM: The `mint_vault` Bank-key confinement is stronger than documented.**
- **The Construct:** The documentation states that the Bank co-signs the transaction, but the new `BankKeyOutsideMint` confinement strictly enforces that the Bank's key CANNOT appear anywhere else in the transaction except in the `bank` slot of a `mint_vault` instruction.
- **The Gain:** The documentation under-claims the security. It implies the Bank just signs the transaction, but the on-chain program actively introspects the entire transaction to ensure the Bank's signature isn't being abused to drain the Bank's SOL float.
- **The Evidence:** Read the SPEC.md control table. It likely still describes the Bank's co-signature as a simple 2-of-2, without mentioning the strict positional transaction introspection that prevents signature reuse.
- **The Fix:** Update the control table to explicitly state that `mint_vault` and `open_for_redemption` perform full transaction introspection to confine the Bank's key.

### GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

What should this project do that sixteen rounds of AI audit structurally cannot?
1. **Fuzz Testing for Transaction Introspection:** AI models read code statically. The transaction introspection loops (`load_instruction_at_checked`) are highly susceptible to edge cases (e.g., CPIs, Address Lookup Tables, versioned transactions). You must run a dedicated fuzzer that generates malformed, nested, and versioned transactions to ensure the introspection cannot be bypassed or crashed.
2. **Cross-Platform Environment Testing:** As seen with the `base64 -w0` bug, AI models assume a standard