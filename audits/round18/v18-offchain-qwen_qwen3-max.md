## R1. THE CRITICAL'S FIX — `mint_vault`'s BANK-KEY CONFINEMENT

### Finding 1: Positional Account Binding Breakage (CRITICAL)
**Construct**: In `programs/cbob-vault-mint/src/lib.rs`, the `instructions` sysvar account was inserted between `revenue` and `seal_config` in the `MintVault` struct. The test suite constructs transactions using positional account lists that assume specific indices.

**Evidence**: In `tests/3prog.test.ts`, multiple transaction constructions were updated to insert `SYSVAR_INSTRUCTIONS_PUBKEY` at position 7, but one site (the "BRICK" test) missed adding `alice` as a signer after changing the payer from `bank` to `alice`. This caused test 5.2 to fail with "Missing signature" instead of reaching the program logic. This demonstrates that account order changes break transaction construction when signers are not properly maintained.

**Impact**: If any production code or external integrations construct `mint_vault` transactions by position rather than by name, they will either fail to serialize (if missing required signers) or silently bind accounts incorrectly, potentially leading to security vulnerabilities.

**Fix**: Ensure all transaction construction sites properly handle the new account ordering. Add explicit tests that verify account positions match expected indices. Consider using named account binding instead of positional where possible.

### Finding 2: Incomplete Instruction Walk Guard (HIGH)
**Construct**: Both SEAL and MINT programs use `seen_self` to ensure their instruction walk reached their own index, but this doesn't guarantee all instructions AFTER the current one were checked.

**Evidence**: The `while let Ok(ix) = load_instruction_at_checked(i, &sysvar)` loop stops at the first error. If there's a malformed instruction after the current program's instruction, the walk terminates early and instructions beyond that point remain unchecked.

**Impact**: An attacker could craft a transaction with a valid `mint_vault` or `open_for_redemption` instruction followed by a malformed instruction and then a malicious instruction using the Bank's key. The confinement check would terminate at the malformed instruction and never see the malicious one.

**Fix**: The walk should continue through all instructions regardless of errors, treating malformed instructions as potential security risks. Alternatively, validate that the total instruction count matches expectations.

### Finding 3: Compute Unit Regression (MEDIUM)
**Construct**: The new instruction walking logic in both MINT and SEAL programs significantly increases compute unit consumption, especially in transactions with many instructions.

**Evidence**: As noted in the known limits (item 12), "COMPUTE UNITS are unmeasured anywhere. **This one got worse this round — see R1.**" The loops now iterate through every instruction in the transaction, checking each account.

**Impact**: Large transactions may exceed compute limits and fail, potentially causing denial of service or unexpected transaction failures during high-load periods.

**Fix**: Measure and document compute unit usage for typical transaction sizes. Consider optimizing the walk by breaking early when possible without compromising security.

## R2. THE CADENCE AND WEIGHT REPAIRS

### Finding 4: Griefing Surface in Date Validation (HIGH)
**Construct**: The `holdDays` function now throws on invalid date keys in the ledger, and anyone who can write to the distribution ledger can trigger this.

**Evidence**: The code throws `new Error(`the distribution ledger has ${bad.length} day key(s) that are not YYYY-MM-DD...`)` when encountering invalid date keys. The question "who can write a key into that ledger?" is explicitly raised in the audit prompt.

**Impact**: If an attacker can write arbitrary keys to the distribution ledger (e.g., through compromised credentials or insufficient access controls), they can cause the distribution job to fail permanently by inserting an invalid date key like `'2026-02-30'`.

**Fix**: Instead of throwing, log the invalid keys and skip them while continuing processing with valid dates. Ensure ledger write access is properly restricted.

### Finding 5: Unlevelled Vault Halt Remains Problematic (MEDIUM)
**Construct**: The system still halts all payouts when an activated vault has no assigned level, requiring manual intervention.

**Evidence**: The comment states "Anyone can mint a vault, fund it with 21,000 sats and stop every payout until an operator edits `levels.json`."

**Impact**: While the argument that halting is recoverable (vs. permanent overpayment) has merit, this creates a single point of failure that can be triggered by any user. At scale, this could require frequent manual intervention.

**Fix**: Consider implementing a default level assignment for unlevelled vaults (e.g., Level I) with clear documentation, or create an automated process to assign levels to newly activated vaults.

## R3. `scripts/bank-sign.sh`'s BASE64 HARDENING

### Finding 6: Non-Canonical Base64 Still Accepted (MEDIUM)
**Construct**: The script validates base64 length and padding placement but doesn't check for non-canonical encoding in the final quantum.

**Evidence**: Base64 allows trailing bits in the final quantum to be non-zero, which are ignored during decoding. For example, `'AAAA'` and `'AAAB'` both decode to the same 2-byte sequence `[0, 0]` because the final 6 bits of `'B'` (value 1) represent only 2 significant bits in a 2-byte sequence.

**Impact**: An attacker could provide a transaction that appears different in base64 form but decodes to the same binary transaction, potentially bypassing visual inspection or logging mechanisms.

**Fix**: After decoding, re-encode the binary data back to base64 and compare with the original input (after whitespace removal). Only accept if they match exactly.

## R4. THE GATES ADDED THIS ROUND

### Finding 7: Incomplete Error Name Regex (MEDIUM)
**Construct**: The regex `/#\[msg\("[^"]*"\)\]\s*(\w+),/g` used to extract error names may miss certain formatting variations.

**Evidence**: Rust allows various whitespace patterns and formatting around attributes. The regex assumes a comma immediately after the error name, but there could be whitespace or other characters.

**Impact**: If an error name isn't properly extracted, the gate won't verify it's documented in SPEC.md, potentially allowing undocumented errors to exist.

**Fix**: Use a more robust parser or expand the regex to handle common formatting variations: `/#\[msg\([^)]*\)\]\s*(\w+)\s*,?/g`

### Finding 8: Untidy Signer Creation Not Exploitable (LOW)
**Construct**: The signer-set arm only matches `fromSecretKey`, but `Keypair.fromSeed` and `Keypair.generate` exist in the codebase.

**Evidence**: These alternative keypair creation methods are present but used only in test contexts, not in production signing paths.

**Impact**: This is untidy but not exploitable since the actual Bank signing key is loaded securely via `fromSecretKey` in production.

**Fix**: Clean up test code to use consistent keypair creation methods, or update the gate to recognize all secure key loading patterns.

## R5. THE COMMENTS

### Finding 9: Under-Claiming in Documentation (MEDIUM)
**Construct**: Multiple comments were updated to reflect new on-chain confinement, but some may still understate guarantees.

**Evidence**: The diff shows extensive comment updates acknowledging the new on-chain confinement, demonstrating awareness of the under-claiming issue.

**Impact**: While major under-claims were fixed, subtle ones may remain, potentially misleading users about security guarantees.

**Fix**: Conduct a systematic review of all security-related comments against actual implementation, specifically looking for understated guarantees.

## R6. THE ARITHMETIC

### Finding 10: Arithmetic Verified Correct (NO FINDING)
**Construct**: The schedule figures and weight calculations.

**Evidence**: The self-test assertions verify all published figures:
- Census 108/60/36/24/12 → denominator 732 ✓
- Census 945/525/315/210/105 → denominator 6,405 ✓  
- Level V receives exactly 3x Level I (6/2 = 3) ✓
- Per-$1,000 figures match card ✓
- Shares sum to 100.0% ✓

**Impact**: None - arithmetic is correct.

## Carry-Over List Verification

### Finding 11: Known Limit #12 Confirmed Worse (MEDIUM)
**Construct**: Compute units are unmeasured and got worse this round due to instruction walking.

**Evidence**: Both MINT and SEAL programs now iterate through all transaction instructions, significantly increasing compute usage. No measurements or limits are documented.

**Impact**: Transactions may fail unexpectedly due to compute limits, especially during network congestion or with complex transactions.

**Fix**: Measure compute unit usage across typical transaction patterns and document safe limits.

## Verdict Challenges

### Finding 12: System Stronger Than Documented (MEDIUM)
**Construct**: The on-chain Bank key confinement provides stronger guarantees than previously documented.

**Evidence**: Multiple documents (SEAL header, cosign.mjs, SPEC prose, control table, distribute.mjs header) previously claimed the confinement was off-chain only, but it's now implemented on-chain in both MINT and SEAL programs.

**Impact**: While this strengthens security, the documentation mismatch could lead to incorrect threat modeling or compliance issues.

**Fix**: Ensure all documentation accurately reflects the current on-chain confinement implementation.

## What This Project Should Do That AI Audit Cannot

**Implement Continuous On-Chain Monitoring with Automated Response**

Sixteen rounds of AI audit cannot replace real-time monitoring of actual on-chain behavior. The project should:

1. **Deploy Sentinel Programs**: Create dedicated monitoring programs that watch for anomalous patterns (unusual Bank key usage, unexpected instruction combinations, distribution failures) and automatically freeze affected operations.

2. **Implement Circuit Breakers**: Build automatic circuit breakers that halt distributions or minting when predefined safety thresholds are exceeded (e.g., more than X% of vaults unlevelled, distribution amounts deviating significantly from expected).

3. **Create Verification Oracles**: Establish on-chain verification that critical off-chain processes (like level assignment) have occurred correctly, using commitment schemes and Merkle proofs rather than trusting centralized claims.

4. **Automated Incident Response**: Develop automated response protocols that can contain threats faster than human operators (e.g., automatically revoking compromised authority keys, freezing suspicious vaults).

5. **Formal Verification of Critical Paths**: Apply formal verification tools to the most critical security boundaries (Bank key confinement, redemption pairing) to mathematically prove their correctness under all conditions.

The fundamental limitation of AI auditing is that it analyzes static code and hypothetical scenarios, but cannot observe or respond to actual runtime behavior. Real money requires real-time protection that adapts to actual attacks, not just anticipated ones.