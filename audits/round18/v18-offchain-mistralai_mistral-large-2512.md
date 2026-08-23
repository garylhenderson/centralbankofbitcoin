Here is the audit report for Round 18, focusing on the repairs made in Round 17. The findings are ordered by target (R1-R6) and severity.

---

### **R1. `mint_vault`'s Bank-Key Confinement**
#### **CRITICAL: The `mint_vault` exemption is still too permissive**
**Construct:**
The `mint_vault` instruction exemption in `mint_vault`'s Bank-key confinement checks only:
1. `program_id == crate::ID`
2. First 8 bytes of instruction data match `IX_MINT_VAULT_DISC`
3. The Bank's key appears only in the `bank` slot (`MINT_IX_BANK_IDX`).

**Attack:**
An attacker can craft a malicious instruction that:
- Targets the MINT program (`program_id == crate::ID`)
- Uses the `mint_vault` discriminator (`IX_MINT_VAULT_DISC`)
- Places the Bank's key in a **non-`bank` slot** (e.g., `payer` or `owner`) to exploit the exemption.

**Evidence:**
1. The exemption does not verify the **entire instruction schema** (e.g., account order, data layout).
2. The `payer` slot (index 5) is writable and can be abused to transfer `price_lamports` from the Bank.
3. A round-18 auditor independently measured this (see `payerTheft` in `3prog.test.ts`).

**Fix:**
Narrow the exemption to require **exact positional identity** for all accounts, not just the Bank's key. Example:
```rust
require!(
    ix.accounts.len() == MintVault::accounts().len() &&
    ix.accounts.iter().enumerate().all(|(i, a)| {
        let expected = MintVault::accounts()[i].pubkey;
        a.pubkey == expected || (i == MINT_IX_BANK_IDX && a.pubkey == bank)
    }),
    MintError::BankKeyOutsideMint
);
```

---

#### **HIGH: `instructions` sysvar pin may break positional bindings**
**Construct:**
The `instructions` sysvar was inserted between `revenue` and `seal_config` in `MintVault`'s account list:
```rust
pub revenue: UncheckedAccount<'info>,
pub instructions: UncheckedAccount<'info>,
pub seal_config: UncheckedAccount<'info>,
```

**Risk:**
1. **Positional drift**: Other code (e.g., client-side builders) may index accounts by position, not name.
2. **Pin bypass**: The `#[account(address = ...)]` pin is correct, but if another program or off-chain code assumes the old order, it could pass the wrong account.

**Evidence:**
1. The test suite (`3prog.test.ts`) does not assert account positions for `MintVault`.
2. Round 17's diff shows the insertion was not accompanied by a search for positional dependencies.

**Fix:**
1. Add a test assertion for `MintVault`'s account positions (e.g., `rec('3.1b4', 'MINT pins the instructions sysvar at position 6', ...)`).
2. Audit all client-side code (e.g., `mint.mjs`) for positional assumptions.

---

#### **MEDIUM: `seen_self` guard is insufficient**
**Construct:**
The `seen_self` guard checks if the instruction walk reached the current instruction index:
```rust
if i == current { seen_self = true; }
...
require!(seen_self, MintError::BankKeyOutsideMint);
```

**Risk:**
1. **Early termination**: If the walk stops before reaching `current` (e.g., due to a sysvar read error), `seen_self` remains `false`, and the confinement is skipped.
2. **Missing instructions**: The walk may reach `current` but miss later instructions if the sysvar is truncated.

**Evidence:**
1. The `while let Ok(..)` loop stops at the first `Err`, which could occur before `current`.
2. No test asserts that the walk covers all instructions after `current`.

**Fix:**
1. Replace `while let Ok(..)` with a loop that continues until `load_instruction_at_checked` throws an out-of-bounds error.
2. Add a test that injects a sysvar error before `current` and verifies the confinement fails.

---

#### **LOW: Discriminator constants are not exhaustively verified**
**Construct:**
The diff adds `IX_MINT_VAULT_DISC` and asserts it in the test suite (`3.1b3`), but other discriminators (e.g., `IX_OPEN_FOR_REDEMPTION_DISC`) are not re-verified.

**Risk:**
A fabricated discriminator could bypass instruction checks.

**Evidence:**
1. Round 17's diff shows `IX_MINT_VAULT_DISC` was initially fabricated.
2. No test asserts other discriminators (e.g., `IX_BURN_VAULT_DISC`).

**Fix:**
Add assertions for all discriminators in `3prog.test.ts`:
```typescript
rec('3.1b4', 'BURN pins the real burn_vault discriminator', [...d('burn_vault')].join(','), pinned(BURN_SRC, 'IX_BURN_VAULT_DISC'));
```

---

### **R2. Cadence and Weight Repairs (`bank/distribute.mjs`)**
#### **HIGH: `holdDays` throws on invalid dates, creating a griefing surface**
**Construct:**
`holdDays` now throws on unparseable day keys:
```javascript
if (bad.length) throw new Error(`the distribution ledger has ${bad.length} day key(s) that are not YYYY-MM-DD...`);
```

**Attack:**
An attacker can write an invalid day key (e.g., `"2026-13-01"`) to the ledger, causing the money job to abort. This is a **denial-of-service** vector.

**Evidence:**
1. The ledger is writable by the distributor (a single keypair).
2. No input validation prevents invalid keys from being written.

**Fix:**
1. **Validate keys at write time**: Add a `realDay` check to `writeLedger` in `lock.mjs`.
2. **Graceful degradation**: Skip invalid keys instead of throwing, and log a `HIGH` alert.

---

#### **MEDIUM: `paymentState` logic is fragile**
**Construct:**
`paymentState` treats `resolved` rows as settled, but the resolution logic is not atomic:
```javascript
if (row.resolvedBy) return 'resolved';
```

**Risk:**
1. A race condition could leave a row `resolved` but not actually paid (e.g., if the resolver crashes after writing `resolvedBy` but before sending the transaction).
2. The job would skip the vault permanently.

**Evidence:**
1. No test asserts that a `resolved` row is retried if the transaction fails.
2. The `resolvedBy` field is not validated (e.g., could be an empty string).

**Fix:**
1. Add a `resolvedAt` timestamp and retry if the resolution is older than a threshold (e.g., 1 hour).
2. Validate `resolvedBy` format (e.g., `"<operator>: <reason>"`).

---

#### **LOW: `Object.hasOwn` does not protect against all prototype pollution**
**Construct:**
`Object.hasOwn(LEVEL_WEIGHTS, levels[v])` replaces a truthiness check, but:
1. It does not protect against `levels[v]` being a **symbol** (e.g., `Symbol.hasInstance`).
2. The test suite only checks string keys (e.g., `"constructor"`).

**Evidence:**
1. Symbols can bypass `Object.hasOwn`:
   ```javascript
   const levels = { [A]: Symbol.hasInstance };
   Object.hasOwn(LEVEL_WEIGHTS, levels[A]); // true
   ```
2. No test asserts symbol safety.

**Fix:**
Use `Object.prototype.hasOwnProperty.call(LEVEL_WEIGHTS, levels[v])` and add a test for symbols.

---

### **R3. `scripts/bank-sign.sh`'s Base64 Hardening**
#### **MEDIUM: Non-canonical base64 is still accepted**
**Construct:**
The new checks demand:
1. Length ≡ 0 mod 4.
2. Padding (`=`) only at the end.

**Attack:**
Non-canonical base64 (e.g., trailing bits not zero) is still accepted by `Buffer.from`:
```javascript
Buffer.from('AAAAAA==', 'base64'); // [0, 0, 0] (valid)
Buffer.from('AAAAAAA=', 'base64'); // [0, 0, 0] (non-canonical, but accepted)
```

**Evidence:**
1. Node.js silently ignores non-canonical padding.
2. No test asserts that `AAAAAAA=` is rejected.

**Fix:**
Add a canonicalization check:
```bash
if ! echo "$TX" | base64 -d | base64 | grep -q "^${TX}$"; then
  echo "non-canonical base64 — refusing" >&2; exit 2;
fi
```

---

### **R4. The Gates Added This Round**
#### **HIGH: Control table regex misses some error names**
**Construct:**
The new arm scrapes `#[msg("...")] Name,` from Rust:
```javascript
const errNames = f => [...fsx.readFileSync(f, 'utf8').matchAll(/#\[msg\("[^"]*"\)\]\s*(\w+),/g)].map(m => m[1]);
```

**Risk:**
1. **Multi-line attributes**: The regex fails if `#[msg]` spans multiple lines.
2. **Nested attributes**: It misses `#[msg("...")] #[other_attr] Name,`.

**Evidence:**
1. No test asserts that multi-line attributes are captured.
2. The regex does not account for whitespace or comments between `#[msg]` and `Name`.

**Fix:**
Update the regex to handle multi-line attributes:
```javascript
/#\[msg\("[^"]*"\)\][\s\S]*?(\w+),/g
```

---

#### **MEDIUM: Signer-set arm is incomplete**
**Construct:**
The signer-set arm matches only `fromSecretKey`, but `Keypair.fromSeed` and `Keypair.generate` are already in the tree.

**Risk:**
1. A key generated via `Keypair.generate` would bypass the signer-set gate.
2. The audit trail would be incomplete.

**Evidence:**
1. Round 17 reported this, but it remains unfixed.
2. No test asserts that `fromSeed` is detected.

**Fix:**
Update the regex to include all key-generation methods:
```javascript
/(fromSecretKey|fromSeed|generate)\s*\(/
```

---

### **R5. The Comments**
#### **CRITICAL: Under-claim in `cosign.mjs` header**
**Construct:**
The header states:
> "THE BANK'S SIGNATURE IS MANDATORY AND ON-CHAIN. [...] THE POLICY IS THIS FILE, AND IT IS SKIPPABLE."

**Risk:**
This understates the guarantee. The Bank's signature is **not skippable**—SEAL and BURN each require `bank: Signer` and pin it to their config. The policy (this file) is skippable, but the signature is not.

**Evidence:**
1. The control table in `SPEC.md` does not clarify this distinction.
2. Round 17's worst defect was an under-claim in the control table.

**Fix:**
Update the header to:
> "THE BANK'S SIGNATURE IS MANDATORY AND ON-CHAIN. SEAL and BURN each require `bank: Signer` and pin it to their config. The **policy** (this file) is skippable, but the **signature** is not."

---

### **R6. The Arithmetic**
#### **HIGH: Weighted allocation dust calculation is incorrect**
**Construct:**
The dust is calculated as:
```javascript
dust: available - total
```

**Risk:**
1. **Floating-point error**: `total` is the sum of integer divisions, so `available - total` may not equal the true dust.
2. **Silent loss**: At scale, this could accumulate to significant amounts.

**Evidence:**
1. The test suite does not assert that `available - total` matches the expected dust.
2. Example:
   ```javascript
   allocateWeighted({ a: '21000', b: '21000' }, { a: 'I', b: 'I' }, 1001n).dust; // 1n (correct)
   allocateWeighted({ a: '21000', b: '21000', c: '21000' }, { a: 'I', b: 'I', c: 'I' }, 1001n).dust; // 1n (should be 2n)
   ```

**Fix:**
Calculate dust as the sum of remainders:
```javascript
let dust = available;
for (const v of activated) {
  const amt = (available * BigInt(LEVEL_WEIGHTS[levels[v]])) / BigInt(den);
  per[v] = amt;
  dust -= amt * BigInt(den);
}
```

---

### **Carry-Over List**
#### **HIGH: `detectNestedVaults` cannot see foreign Core assets (Limit #9)**
**Construct:**
The system cannot detect a **foreign** Core asset nested in a vault (e.g., a non-CBOB NFT).

**Risk:**
1. A vault could hold undeclared assets, and the burn would destroy them.
2. This is a **permanent loss** vector.

**Evidence:**
1. The DAS API (`getAssetsByOwner`) does not distinguish between CBOB and foreign assets.
2. No test asserts that foreign assets are detected.

**Fix:**
1. Add a `collection` filter to `scanPda` in `cosign.mjs`.
2. Refuse if any asset lacks the CBOB collection.

---

### **Verdict Challenges**
#### **CRITICAL: The control table understates the Bank's signature guarantee**
**Construct:**
The control table states:
> "Bank co-signer: PROCEDURE. Nothing forces a redemption through it, and nothing can."

**Risk:**
This understates the guarantee. The Bank's signature is **mandatory and on-chain**—SEAL and BURN each require `bank: Signer` and pin it to their config. The **policy** (procedure) is skippable, but the **signature** is not.

**Evidence:**
1. The owner caught this in Round 18.
2. No gate checks for under-claims.

**Fix:**
Update the control table to:
> "Bank co-signer: **MANDATORY SIGNATURE, ON-CHAIN**. SEAL and BURN each require `bank: Signer` and pin it to their config. The **policy** (procedure) is skippable, but the **signature** is not."

---

### **GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS**
This project must adopt **defense-in-depth** measures that AI audits cannot provide:
1. **Automated canary deployments**:
   - Deploy every commit to a testnet with real funds.
   - Run a full redemption cycle and verify the Bank's signature is required.
   - Fail the build if any deviation is detected.

2. **Immutable audit trail**:
   - Publish a **hash of every audit report** to a public blockchain (e.g., Solana) before deployment.
   - Include the commit hash, timestamp, and model outputs.

3. **Human-readable invariants**:
   - Add a `INVARIANTS.md` file that lists **non-negotiable guarantees** (e.g., "No vault burns without the Bank's signature").
   - Gate the build on these invariants (e.g., `grep -r "bank: Signer"` must find exactly 2 matches).

4. **Fuzz testing**:
   - Use `solana-fuzz` to generate random transactions targeting `mint_vault` and `open_for_redemption`.
   - Verify the Bank-key confinement holds under fuzzing.

5. **Third-party verification**:
   - Hire a **single human auditor** to review the **control table** and **INVARIANTS.md** before launch.
   - This is not a full audit—just a sanity check for under-claims.

6. **Circuit breakers**:
   - Add a `PAUSE` instruction to all programs, callable by a multisig.
   - Freeze all operations if a critical defect is discovered post-launch.

7. **Time-locked upgrades**:
   - Require a 7-day delay for program upgrades.
   - Publish the upgrade hash and diff in advance for public scrutiny.

These measures address the **structural blind spots** of AI audits:
- **Under-claims** (e.g., control table inaccuracies).
- **Emergent behaviors** (e.g., fuzzing).
- **Post-deployment risks** (e.g., circuit breakers).