### Findings

#### **R1. MINT's Bank-Key Confinement**
- **Issue**: The new confinement in `mint_vault` checks the instruction discriminator and program ID to exempt `mint_vault` instructions. However, it does not verify the **account positions** of the exempted instructions. This allows an attacker to craft an instruction that matches the discriminator and program ID but places the Bank's key in a different account position, potentially allowing the Bank to pay for an attacker's vault.
  - **Evidence**: The exemption logic only checks the instruction's program ID and discriminator (`IX_MINT_VAULT_DISC`). An attacker can create an instruction with the same discriminator and program ID but place the Bank's key in a different account position, bypassing the confinement.
  - **Fix**: Add a check to ensure the Bank's key only appears in the `bank` account position (`MINT_IX_BANK_IDX`).

- **Issue**: The `instructions` sysvar account is added between `revenue` and `seal_config`, potentially breaking positional bindings in MINT's account list.
  - **Evidence**: The `instructions` account is inserted at a specific position, which could cause issues if other parts of the code rely on account positions.
  - **Fix**: Verify that no other code in MINT relies on account positions and ensure the pin holds by adding a runtime check.

- **Issue**: The `seen_self` guard in the instruction walk might not be sufficient to prevent skipping instructions after the current one.
  - **Evidence**: The `while let Ok(..)` loop stops at the first `Err`, potentially skipping instructions after the current one if an error occurs.
  - **Fix**: Ensure the walk reaches all instructions by handling errors gracefully or re-evaluating the loop logic.

- **Issue**: The `IX_MINT_VAULT_DISC` constant was initially fabricated and not verified against the actual hash.
  - **Evidence**: The initial value of `IX_MINT_VAULT_DISC` was incorrect. It was later corrected to match `sha256("global:mint_vault")`.
  - **Fix**: Verify all constants in the diff against their computed values.

#### **R2. Cadence and Weight Repairs**
- **Issue**: The `holdDays` function now uses `paymentState(row) === 'paid'` instead of counting rows, but it does not handle all states correctly (e.g., ambiguous, rejected, resolved).
  - **Evidence**: The new logic assumes that only `paid` rows are relevant, but other states (like ambiguous or rejected) could reset the clock incorrectly.
  - **Fix**: Ensure `holdDays` correctly handles all possible states of `paymentState`.

- **Issue**: `holdDays` throws on invalid day keys (`YYYY-MM-DD`) and non-finite `dayDiff`, but this could create a griefing surface if the ledger is tampered with.
  - **Evidence**: An attacker could write invalid keys into the ledger, causing the function to throw and halt the distribution process.
  - **Fix**: Validate day keys and handle invalid inputs gracefully without throwing.

- **Issue**: The use of `Object.hasOwn(LEVEL_WEIGHTS, ...)` replaced a truthiness check, but other prototype-reachable strings might still be used as keys.
  - **Evidence**: Strings like `'constructor'` or `'toString'` could still be used as keys due to prototype inheritance.
  - **Fix**: Ensure all object keys are validated to prevent prototype-related issues.

- **Issue**: The `refusal: true` flag separates halts from quiet days, but it is unclear if this reaches a human for resolution.
  - **Evidence**: The `distribution_refused` finding is raised at HIGH severity, but there is no clear path to notify a human for resolution.
  - **Fix**: Ensure the notification path for `distribution_refused` is traced and reaches a human.

- **Issue**: The unlevelled-vault halt is still a halt, allowing anyone to stop payouts by activating a vault without a level.
  - **Evidence**: Activating a vault without a level causes the distribution to halt, and there is no mechanism to recover without operator intervention.
  - **Fix**: Consider removing the halt or implementing a recovery mechanism.

#### **R3. `bank-sign.sh` Base64 Hardening**
- **Issue**: The new base64 check demands length ≡ 0 mod 4 and padding only at the end, but it might still accept strings that decode to different transactions.
  - **Evidence**: Non-canonical final quanta or trailing bits could still decode to different transactions.
  - **Fix**: Ensure the check handles all edge cases, including non-canonical encodings.

- **Issue**: The check might reject legitimate transactions with specific lengths.
  - **Evidence**: A 1232-byte transaction's base64 is 1644 characters, which is a multiple of 4 but might be rejected if the check is too strict.
  - **Fix**: Ensure the check does not reject legitimate transactions.

#### **R4. Gates Added**
- **Issue**: The new regex for `BankKeyOutside*` errors in the control table might miss some errors.
  - **Evidence**: The regex scrapes `#[msg("...")] Name,` but might not capture all error variants.
  - **Fix**: Ensure the regex is comprehensive and captures all possible error messages.

- **Issue**: The on-chain arm expects exactly two verified rows, but matching on source text might not be sound for two programs.
  - **Evidence**: Two programs might have different source text structures, making the match unsound.
  - **Fix**: Ensure the matching logic is sound for both programs.

- **Issue**: The signer-set arm matches only `fromSecretKey`, but `Keypair.fromSeed` and `Keypair.generate` are already in the scanned tree.
  - **Evidence**: These methods are already present but not matched, potentially allowing unauthorized key generation.
  - **Fix**: Update the signer-set arm to match all relevant key generation methods.

#### **R5. Comments**
- **Issue**: Comments in the diff might over-claim or under-claim functionality.
  - **Evidence**: Comments like "the Bank-pubkey confinement is on-chain now" were initially false but later corrected.
  - **Fix**: Review all comments for accuracy and ensure they reflect the actual code behavior.

#### **R6. Arithmetic**
- **Issue**: The published figures (e.g., census, weights, shares) might be incorrect.
  - **Evidence**: The figures are asserted by re-deriving them from the weights, but manual verification is needed.
  - **Fix**: Independently re-derive the figures to ensure accuracy.

### **Under-Claims**
- **Issue**: The system might be safer or stronger than documented.
  - **Evidence**: The Bank's co-signer was initially under-claimed as "PROCEDURE" but is actually mandatory and on-chain.
  - **Fix**: Review all documentation to ensure it accurately reflects the system's guarantees.

### **Verdict**
Given that no human firm will ever audit this system, the project should:
1. **Strengthen Automated Gates**: Implement more comprehensive gates to catch both over-claims and under-claims.
2. **Improve Documentation**: Ensure all documentation accurately reflects the system's guarantees and limitations.
3. **Enhance Testing**: Expand the test suite to cover edge cases and ensure all fixes are validated.
4. **Monitor Runtime Behavior**: Implement monitoring to detect and alert on unexpected behavior in production.

### **Critical Findings**
1. **MINT's Bank-Key Confinement**: The exemption logic in `mint_vault` is insufficient, allowing potential theft of Bank funds.
2. **Cadence and Weight Repairs**: The `holdDays` function does not handle all states correctly, potentially leading to incorrect payout schedules.
3. **Gates Added**: The new regex for `BankKeyOutside*` errors might miss some errors, leading to undocumented behavior.

### **High Findings**
1. **Base64 Hardening**: The new check might still accept invalid base64 strings or reject legitimate ones.
2. **Comments**: Comments might over-claim or under-claim functionality, leading to confusion.

### **Medium Findings**
1. **Arithmetic**: Published figures might be incorrect, leading to customer-facing errors.
2. **Under-Claims**: The system might be safer than documented, leading to mistrust.

### **Low Findings**
1. **Gates Added**: The signer-set arm might not match all relevant key generation methods, leading to potential security issues.

### **Fix Recommendations**
1. **MINT's Bank-Key Confinement**: Add account position checks and verify all constants.
2. **Cadence and Weight Repairs**: Handle all states in `holdDays` and ensure graceful error handling.
3. **Base64 Hardening**: Ensure the check handles all edge cases and does not reject legitimate transactions.
4. **Gates Added**: Update the regex and matching logic to be comprehensive.
5. **Comments**: Review and update all comments for accuracy.
6. **Arithmetic**: Independently verify all published figures.
7. **Under-Claims**: Review documentation to ensure it accurately reflects system guarantees.

### **Structural Improvements**
1. **Automated Gates**: Implement gates to catch both over-claims and under-claims.
2. **Documentation**: Ensure all documentation is accurate and up-to-date.
3. **Testing**: Expand the test suite to cover edge cases.
4. **Monitoring**: Implement runtime monitoring to detect unexpected behavior.