**CRITICAL: Non-ATA token accounts defeat the 2-of-2 and permit silent drainage**

**Severity:** CRITICAL  
**Construct:** `close_redemption` only inspects ATAs via `inspect_reserves`, but `ExecuteV1` can create non-ATA token accounts during the thaw window.  
**Exploit:**  
1. Owner + Bank sign `open_for_redemption` (Bank approves thaw)  
2. Owner CPIs `ExecuteV1` to create a non-ATA token account owned by `asset_signer` and transfers all cbBTC from the ATA to this hidden account  
3. Owner signs `close_redemption` (no Bank required)  
4. `inspect_reserves` sees empty ATAs and re-seals the vault  
5. Later, Owner + Bank sign `open_for_redemption` again; Owner CPIs `ExecuteV1` to drain the hidden account  
**Result:** Bank’s co-signature is spent once, but the vault is drained in a later redemption. The 2-of-2 is nominal: the Bank cannot enforce what happens during the thaw window.  

**Fix:** The thaw window must be eliminated. Combine `open_for_redemption` and `close_redemption` into a single atomic instruction that executes a pre-authorized sweep, or require the Bank to sign the entire redemption transaction hash, not just the open. Until then, **do not hold real money in this program.**

---

**CRITICAL: `burn_empty_vault` burns non-empty vaults via non-ATA accounts**

**Severity:** CRITICAL  
**Construct:** `burn_empty_vault` only verifies declared ATAs are empty; completeness of `remaining_accounts` is unenforceable.  
**Exploit:**  
1. During thaw, Owner moves cbBTC to a non-ATA account and closes the ATA  
2. Owner + Bank sign `burn_empty_vault`, declaring only the (now-empty) ATAs  
3. Program burns the vault; non-ATA account becomes permanently unspendable  
**Result:** Customer Bitcoin is destroyed with their own signature. This is v1 C1 relocated, not fixed.  

**Fix:** Remove `burn_empty_vault`. On-chain emptiness cannot be proven without enumeration. Burning must be off-chain proven + multisig, or maintain an on-chain deposit registry that tracks every token account creation.

---

**HIGH: `close_redemption` does not require Bank signature**

**Severity:** HIGH  
**Construct:** `CloseRedemption` accounts do not include `bank: Signer`.  
**Exploit:** After Bank signs `open_for_redemption`, Owner can `close_redemption` alone, then grief the Bank by repeatedly opening/closing to waste Bank signatures. More critically, any bug in `inspect_reserves` is exploitable with only Owner authority.  

**Fix:** Add `pub bank: Signer<'info>` to `CloseRedemption` and verify against `config.bank`. The 2-of-2 must cover both halves of redemption.

---

**HIGH: Instructions-sysvar guard permits arbitrary CPIs between open/close**

**Severity:** HIGH  
**Construct:** `open_for_redemption` only verifies a matching `close_redemption` exists later in the transaction; it does not forbid intervening instructions.  
**Exploit:** Owner can insert malicious CPIs (create non-ATA accounts, approve delegates, transfer to obfuscated addresses) between open and close. The Bank’s signature approves the window, not the operations.  

**Fix:** The guard must enforce that `close_redemption` is the *next* instruction (index `current + 1`). Use `load_instruction_at_checked(current + 1, ...)` and verify it matches; abort otherwise.

---

**MEDIUM: Hardcoded Core wire format is brittle**

**Severity:** MEDIUM  
**Construct:** `IX_UPDATE_PLUGIN_V1`, `PLUGIN_PERMANENT_FREEZE_EXECUTE`, etc. are magic constants.  
**Exploit:** Metaplex Core adds a new plugin variant, shifting enum indices; CPI silently targets wrong plugin, unsealing fails or targets a different authority path.  

**Fix:** Pin Core version in CI and add a test that deserializes a live Core instruction to assert the constants match. Do not upgrade Core without a full audit.

---

**MEDIUM: `initialize` binds to compile-time `INIT_AUTHORITY` but `update_config` cannot rotate it**

**Severity:** MEDIUM  
**Construct:** `INIT_AUTHORITY` is compile-time; `update_config` cannot change `admin`.  
**Exploit:** Lost admin key permanently bricks config rotation; lost bank key halts redemptions forever with no recovery.  

**Fix:** Add admin-gated `set_admin` and `set_reserve_mints` instructions.

---

**MEDIUM: `Attributes` stamp does not prevent resale of drained vaults**

**Severity:** MEDIUM  
**Construct:** `mark_opened` stamps `redemption: opened`, but buyers must actively inspect token accounts beyond ATAs.  
**Exploit:** After non-ATA drain & re-seal, the vault appears “opened” but buyers may not check non-ATA accounts; resale fraud is viable.  

**Fix:** Stamp must include a commitment to the exact reserve balances at time of opening (e.g., hash of ATA balances). Buyers then verify balances match stamp.

---

**LOW: `read_core_asset` does not verify `owner` field is a valid pubkey**

**Severity:** LOW  
**Construct:** `read_core_asset` copies bytes without checking they represent a valid ed25519 point.  
**Exploit:** Malformed asset data could cause panics or logic bugs; Core should reject invalid owners, but defense-in-depth is missing.  

**Fix:** Use `Pubkey::try_from_slice` and handle errors.

---

**THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY**

**Eliminate the thaw window.** The Bank’s co-signature must approve the *entire redemption operation*, not just the unsealing. Merge `open_for_redemption` and `close_redemption` into one atomic instruction that sweeps to a pre-authorized destination, or require the Bank to sign the transaction hash covering all redemption instructions. Without this, the 2-of-2 is nominal and the vault can be drained via non-ATA accounts despite the Bank’s signature.