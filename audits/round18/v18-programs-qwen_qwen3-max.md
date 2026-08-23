**FINDINGS**

---

### **R1. THE CRITICAL'S FIX — `mint_vault`'s BANK-KEY CONFINEMENT**

#### **CRITICAL: Account-order change breaks positional binding in test suite**
- **Construct**: In `programs/cbob-vault-mint/src/lib.rs`, the `instructions` sysvar account was inserted between `revenue` and `seal_config` in the `MintVault` struct.
- **Impact**: The test suite (`tests/3prog.test.ts`) constructs instruction accounts positionally. The insertion shifts all subsequent accounts right by one index. If any test relies on hardcoded indices (e.g., for CPI or simulation), it will bind the wrong accounts, leading to false passes or crashes that mask real defects.
- **Evidence**: In `tests/3prog.test.ts`, every `mint_vault` test instruction explicitly lists accounts in order. Compare pre-diff line 175:
  ```ts
  {pubkey:REVENUE,...},{pubkey:SEAL_CFG,...}
  ```
  with post-diff line 178:
  ```ts
  {pubkey:REVENUE,...},{pubkey:SYSVAR_INSTRUCTIONS_PUBKEY,...},{pubkey:SEAL_CFG,...}
  ```
  All tests were updated—but this is fragile. A new test omitting the sysvar would bind `SEAL_CFG` to the old `SEAL_CFG` position, which is now the instructions sysvar, causing a silent misbind. The suite’s floor increase (279→284) confirms new tests were added, but does not guarantee future tests won’t drift.
- **Fix**: Replace positional account lists in tests with program-derived structs or named constants. Enforce via linter that no test uses numeric indices for account binding.

#### **HIGH: `seen_self` guard insufficient against truncated instruction list**
- **Construct**: Both `mint_vault` and `open_for_redemption` use `while let Ok(ix) = load_instruction_at_checked(i, &sysvar)` and set `seen_self` only if `i == current`.
- **Impact**: If the transaction contains malformed instructions *after* the current instruction, `load_instruction_at_checked` returns `Err` at the first malformed instruction, terminating the loop early. Instructions *between* `current` and the malformed one are checked, but those *after* the malformed one are skipped. An attacker could place a malicious instruction using the Bank key *after* a malformed instruction to bypass confinement.
- **Evidence**: Solana’s `load_instruction_at_checked` returns `InstructionError::InvalidArgument` on malformed instructions. The loop stops at the first error. If `current = 2`, and instruction 4 is malformed, instruction 5 (which may contain `SystemProgram.transfer(from=bank)`) is never checked.
- **Fix**: Iterate up to `load_current_index_checked(&sysvar)? + N` where N is a safe upper bound (e.g., 10), and handle `Err` by skipping rather than breaking. Or, pre-validate the entire instruction list length matches expectations.

#### **MEDIUM: Fabricated discriminator risk remains for other constants**
- **Construct**: The diff shows `IX_MINT_VAULT_DISC` was corrected after being fabricated. Other discriminators (`IX_OPEN_FOR_REDEMPTION_DISC`, `IX_BURN_VAULT_DISC`) are asserted in tests, but no runtime check exists.
- **Impact**: If any discriminator constant is wrong (e.g., due to copy-paste error), the confinement check will fail to recognize legitimate instructions, blocking valid transactions or allowing bypass if the exemption logic is inverted.
- **Evidence**: The suite asserts discriminators (e.g., test 3.1b3), but these are compile-time checks. A runtime assertion comparing the constant against `sha256("global:...")[..8]` would catch drift.
- **Fix**: Add a `const_assert!` or build-time script that panics if any discriminator does not match its computed hash.

#### **LOW: Fee payer exclusion remains unaddressed**
- **Construct**: Both programs exclude the fee payer from confinement because it does not appear in any instruction’s account list.
- **Impact**: An attacker can set the Bank as fee payer, draining its SOL without triggering `BankKeyOutside*` errors.
- **Evidence**: This is acknowledged as policy in comments and SPEC. No on-chain mechanism can address it. However, the off-chain judge (`judgeRedemptionTx`) does not check fee payer, per Known Limit 1a.
- **Fix**: Update `judgeRedemptionTx` to reject transactions where fee payer == Bank pubkey. Document this as an enforced control, not just policy.

---

### **R2. THE CADENCE AND WEIGHT REPAIRS (`bank/distribute.mjs`)**

#### **HIGH: `holdDays` throws on invalid ledger keys, creating griefing vector**
- **Construct**: `holdDays` now throws if any ledger day key fails `ISO_DAY.test(d)`.
- **Impact**: Any user can activate a vault, then write a malformed day key (e.g., `'not-a-date'`) to the ledger via a separate process (if writable). This halts distribution permanently until manual intervention.
- **Evidence**: The ledger is written by the same process (`distribute.mjs`), so normally only valid keys are written. But if the ledger file is externally writable (e.g., shared volume), an attacker can inject bad keys. The code assumes ledger integrity but does not enforce it.
- **Fix**: Instead of throwing, skip invalid keys and log a warning. Add a separate detector for ledger corruption.

#### **MEDIUM: Unlevelled-vault halt is unrecoverable without operator intervention**
- **Construct**: Activating a vault without assigning a level halts distribution via `refusal: true`.
- **Impact**: An attacker can mint a vault, fund it with 21,000 sats, and activate it without a level assignment (e.g., by racing the level register update). This halts payouts for all users until an operator edits `levels.json`.
- **Evidence**: The level register is off-chain (Known Limit 16). There is no on-chain commitment, so assignments can be delayed or missed.
- **Fix**: Assign a default level (e.g., Level I) to activated vaults missing a level, and emit a warning. Do not halt distribution.

#### **LOW: `Object.hasOwn` fix incomplete for non-string levels**
- **Construct**: `!Object.hasOwn(LEVEL_WEIGHTS, levels[v] ?? '')` guards against prototype pollution.
- **Impact**: If `levels[v]` is `null` or `undefined`, it becomes `''`, which is not a valid level. But if `levels[v]` is a non-string (e.g., number), `Object.hasOwn` returns `false`, causing a skip.
- **Evidence**: `LEVEL_WEIGHTS` keys are strings (e.g., `'I'`). A numeric level `1` would be rejected even if intended.
- **Fix**: Coerce `levels[v]` to string before checking: `!Object.hasOwn(LEVEL_WEIGHTS, String(levels[v]))`.

---

### **R3. `scripts/bank-sign.sh`'s BASE64 HARDENING**

#### **MEDIUM: Non-canonical base64 quanta not rejected**
- **Construct**: The script checks for `=` padding only at the end and length ≡ 0 mod 4, but does not validate that trailing bits in the final quantum are zero.
- **Impact**: A transaction ending with `AA==` decodes to 1 byte (0x00). But `AB==` decodes to 1 byte (0x00) as well, because the last 6 bits of `B` (0x01) are discarded. Both are accepted, but represent different original data if the sender intended `AB` to mean something else.
- **Evidence**: Base64 decoding ignores excess bits in the final quantum. The script’s checks ensure length and padding correctness but not semantic equivalence to the pasted string.
- **Fix**: After decoding, re-encode and compare to original. If they differ, reject.

#### **LOW: Legitimate transactions rejected if length not multiple of 4**
- **Construct**: The script requires `${#TX} % 4 == 0`.
- **Impact**: A 1232-byte transaction encodes to 1644 base64 chars (1644 % 4 = 0), so it’s accepted. But if a tool outputs base64 without padding (e.g., `AAAA` instead of `AAAA==` for 2 bytes), it would be rejected even though `Buffer.from` accepts it.
- **Evidence**: Node.js `Buffer.from(tx, 'base64')` accepts unpadded base64. The script is stricter than necessary.
- **Fix**: Normalize padding before length check: add `=` until length % 4 == 0, then validate.

---

### **R4. THE GATES ADDED THIS ROUND**

#### **MEDIUM: Regex for error names misses multi-line messages**
- **Construct**: The regex `/#\[msg\("[^"]*"\)\]\s*(\w+),/g` in `bank/selftest.mjs` assumes the error name is on the same line as the `#[msg]`.
- **Impact**: If formatted as:
  ```rust
  #[msg("...")]
  BankKeyOutsideMint,
  ```
  the regex fails to capture `BankKeyOutsideMint`.
- **Evidence**: Rust allows newlines between attributes and identifiers. The current codebase doesn’t use this style, but future diffs might.
- **Fix**: Use a multi-line regex or parse Rust AST properly.

#### **LOW: Signer-set arm ignores alternative Keypair constructors**
- **Construct**: The gate matches only `fromSecretKey`, but `Keypair.fromSeed` and `Keypair.generate` exist in the codebase.
- **Impact**: These are used in tests, not production signing paths. No exploit, but untidy.
- **Evidence**: Round 17 noted this; it’s not fixed. But since `bank-sign.sh` is the only production signer, risk is low.
- **Fix**: Either remove the gate or expand it to cover all Keypair methods.

---

### **R5. THE COMMENTS**

#### **MEDIUM: Under-claim in `distribute.mjs` header**
- **Construct**: The header now correctly states payment is by weight, but SPEC’s prose (not in diff) may still claim equal-per-vault.
- **Impact**: Customers may expect equal payouts, leading to disputes.
- **Evidence**: The diff fixes `distribute.mjs` and `cron-install.sh`, but SPEC.md is not included. Known that documents drift.
- **Fix**: Add a gate that checks SPEC.md prose against `LEVEL_WEIGHTS`.

---

### **R6. THE ARITHMETIC**

#### **VERIFIED CORRECT**: 
Re-derived schedule figures:
- Levels I-V weights: 2,3,4,5,6 → sum=20.
- Census 108/60/36/24/12 → total weight = 108*2 + 60*3 + 36*4 + 24*5 + 12*6 = 216+180+144+120+72 = 732.
- 945/525/315/210/105 → 945*2=1890, 525*3=1575, 315*4=1260, 210*5=1050, 105*6=630 → sum=6405.
- Per-$1,000: (2/20)*1000=100, etc. → 100+150+200+250+300=1000.
All correct.

---

### **THIRD TARGET: UNDER-CLAIMED GUARANTEES**

#### **MEDIUM: Bank signature mandatory for all redemptions and mints**
- **Construct**: SPEC’s control table understates that the Bank signature is *mandatory* for `mint_vault`, `open_for_redemption`, and `burn_vault`—not just policy.
- **Impact**: Customers may believe the Bank can be bypassed, underestimating security.
- **Evidence**: All three programs require `bank: Signer` pinned to config. The on-chain confinement enforces this strictly.
- **Fix**: Update SPEC to state: “Bank co-signature is enforced on-chain for all value movements.”

---

### **VERDICT CHALLENGE: WHAT SIXTEEN ROUNDS OF AI CANNOT DO**

**Concrete Action**: Implement **on-chain invariant logging**.

- **Problem**: AI audits cannot observe runtime behavior at scale. They reason about code, not emergent system states (e.g., ledger corruption, level assignment gaps).
- **Solution**: Add a `log_invariant` instruction to each program that emits critical state hashes (e.g., config hash, level assignment root) to a public log. Off-chain, continuously verify these logs against expected state.
- **Why AI Can’t Do This**: It requires designing a new observability layer, not just analyzing existing code. AI finds faults in what is; it cannot mandate what should be instrumented.

--- 

**END OF REPORT**