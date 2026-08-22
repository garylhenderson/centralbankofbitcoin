An independent security audit of the CBOB Vaults system (Round 16) has been conducted. The primary focus was on the unaudited repairs from Round 15 and Round 16, the co-signer's new refusals, the rewritten lock restore path, and the new assertions.

Here are the findings, ordered by target.

### R2. `bank/lock.mjs`'s RESTORE

**FINDING 1: HIGH — The lock's restore path DESTROYS the true holder's lock on failure.**
* **Construct:** In `bank/lock.mjs`, the `catch` block for a failed `fs.renameSync(stolen, file)` explicitly calls `fs.unlinkSync(stolen)`.
* **Gain:** If the restore fails (e.g., due to OS-level issues, permissions, or directory state), the code deletes `stolen`, which contains the **TRUE HOLDER'S lock**. The error message claims *"A copy may remain at `${stolen}`"*, but the code just deleted it. This leaves the true holder running without a lock, allowing a third runner to start and double-pay. The error handling destroys the exact state it is trying to preserve.
* **Evidence:** The code reads `try { fs.unlinkSync(stolen) } catch { /* nothing to clean */ }` strictly inside the `catch (e)` block of the restore logic.
* **Fix:** Remove the `fs.unlinkSync(stolen)` line from the `catch` block so the lock actually remains on disk for manual resolution, matching the error message's promise.

### R4. ROUND 16'S OWN REPAIRS

**FINDING 2: HIGH — The regex asserting `if (s.err) continue` matches commented-out code, defeating the gate.**
* **Construct:** In `bank/selftest.mjs`, the assertion `t('alarm.mjs still skips FAILED transactions before decoding them', /if \(s\.err\) continue/.test(alarmSrc), true)` uses an unanchored regex.
* **Gain:** The author explicitly warned that a developer might remove this guard to *"see attempted attacks too"*, which would silently open a laundering route for bare Core burns. If a developer makes this change by commenting out the line (e.g., `// if (s.err) continue`), the regex will **still match the commented line**. The test will pass, the gate will stay green, and the laundering route will be silently opened.
* **Evidence:** Run `/if \(s\.err\) continue/.test('// if (s.err) continue')` in any Node.js environment; it returns `true`.
* **Fix:** Anchor the regex to ensure it is not preceded by a comment marker, e.g., `/^\s*if \(s\.err\) continue/m`.

### R6. THE GATES THEMSELVES

**FINDING 3: MEDIUM — `judgeCronTemplate` regex can be bypassed by inline comments.**
* **Construct:** In `bank/detectors.mjs`, `judgeCronTemplate` checks `if (!/\bflock\b|\$FLOCK\b/.test(line)) bad.push(line.trim())`.
* **Gain:** If a cron line is written without the `$FLOCK` prefix but includes a trailing comment like `# flock`, the regex will match the comment and the assertion will pass. This leaves the cron job without OS-level exclusion while the test suite reports that all money jobs are wrapped in `flock`.
* **Evidence:** `D.judgeCronTemplate('7 9 * * * cd $R && /usr/bin/node bank/distribute.mjs >> x.log 2>&1 # flock').length` returns `0` (passes).
* **Fix:** Strip comments from the line before testing the regex (e.g., `line.split('#')[0]`), or anchor the regex to the command portion of the line.

---

### EVALUATION OF OTHER TARGETS

**R1. THE CO-SIGNER'S NEW REFUSALS**
* **Arm 1 is complete.** The Bank's pubkey confinement is secure. Address Lookup Tables (ALTs) are blocked because `Transaction.from` fails closed on versioned (v0) transactions. Nested CPIs cannot use the Bank because Solana requires any account used in a CPI to be passed to the top-level instruction, which Arm 1 strictly limits to the two approved instructions.
* **The allowlist is safe.** The permitted programs only allow the customer to spend their own funds, close their own accounts, or self-grief. None of these actions can rob the Bank or bypass the burn constraints.
* **`classifyPdaTokenAccount` is correct.** The 165-byte check accurately discriminates against Token-2022 accounts with extensions, forcing a visible block over an invisible loss.
* **DAS scan fails closed correctly.** The shape checks (`!Array.isArray(items)`) and pagination limits are robust.

**R3. THE ACK ALLOWLIST**
* **The set is correct.** `vault_owns_itself`, `nested_vault`, and `unredeemable_owner` are the only findings that nag forever because they are based on the full DAS list (live + burnt) which never shrinks. Other findings like `vault_burned` are removed from the baseline by `trustCurrent` and only fire once, so they do not need to be ackable.
* **The refusal path is safe.** It modifies the detail string and keeps the severity without throwing, so it cannot be abused to crash the alarm.

**R5. THE COMMENTS**
* No new drifts were found. The headers correctly point to the control table in `SPEC.md` and honestly state the limitations of the mitigations.

**THE CARRY-OVER LIST**
* The items remain accurate as stated. The most critical operational risk is that **nothing is wired to the co-signer**. Until a service or client forces redemptions through `bank/cosign.mjs`, it remains a tool rather than an active control.

**VERDICT CHALLENGES**
* The author's rejections from Round 15 are sound. A signature on a reverting transaction (e.g., a foreign asset or non-owner) buys an attacker nothing because no state changes occur. Failing closed on legacy-only parsing is the correct trade-off for a signer. Declare-everything bricking a vault is a stated griefing surface with a human escape, which is defensible. Anchor's `Signer` constraints are the correct on-chain control for owner and bank signatures.

---

### WHAT AI STRUCTURALLY CANNOT DO

Given that no human firm will ever see this, the project must address the operational and social realities that static analysis and AI reasoning structurally cannot verify:

1. **Operational Discipline:** AI cannot verify that the swap operator wallet *actually* holds nothing but the cycle's own funds. If the operator uses that wallet for other purposes, the blank-cheque signature on the Jupiter swap becomes a massive liability.
2. **Key Management:** AI cannot verify the physical and operational security of the Bank keypair. Since it must remain a plain keypair (not a multisig) to sign top-level instructions, its exposure is the single highest point of failure in the system.
3. **Governance Apathy:** AI cannot verify that DAO members will actually monitor the timelocks and understand the proposals they vote on. If the community ignores the Bank alarm's CRITICAL warnings about armed rotations, the timelock is just a delay, not a defense.