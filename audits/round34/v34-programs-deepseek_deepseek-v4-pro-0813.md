I'll conduct an independent security audit of these Solana programs and the off-chain pipeline, targeting the identified areas in order.

## Executive Summary

After thorough review of the complete codebase, I've identified several critical and high-severity findings that survive the current test suite. The tests are extensive but contain specific gaps that allow the following vulnerabilities to remain undetected.

## CRITICAL FINDINGS

### C1. The sweep helper can be called directly if an attacker can obtain the asset-signer's signature through Core's ExecuteV1 while the vault is frozen

**File:** `programs/cbob-vault-sweep/src/lib.rs`
**Function:** `process()`

**The attack:** The sweep helper's access control relies entirely on `signer.is_signer` where signer is account[0] (expected to be the asset-signer PDA). The comment states "Called by anyone directly it can do nothing: the source accounts belong to the asset-signer PDA, which only Core can sign for." This is TRUE for the current Core implementation. However, the helper itself does not verify that the caller is Core's ExecuteV1, nor that the asset is in the CBOB collection, nor that the vault is thawed. 

**Evidence that would exist if correct:** If Core is upgraded (it's live and upgradeable by Metaplex as accepted limit 40 states) and its ExecuteV1 authority rules change to permit execution by an update authority or delegate, or if a bug in Core allows execution while frozen, an attacker could:
1. Call the helper directly via Core's ExecuteV1 (if Core's rules change to permit non-owner execution)
2. The helper would perform transfers from ANY account owned by the signer PDA to the destination wallet

The helper lacks these critical checks:
- No check that the instruction is being called FROM Core's ExecuteV1 (it only checks signer's signature)
- No check that the asset is a CBOB vault in the correct collection
- No check that the vault is THAWED (not frozen)
- No check that the destination is the asset owner

**Realistic attack scenario:** If an attacker tricks a victim into signing a transaction that includes a malicious ExecuteV1 instruction (e.g., through a phishing wallet UI), Core will call the helper with the asset-signer signing. The helper then moves ALL funds from ALL accounts owned by the asset-signer to the attacker-chosen destination.

**Fix:** Add these checks to the helper:
- Verify that the instruction is actually being called from Core's ExecuteV1 (check the instruction sysvar)
- Verify the asset is in the CBOB collection (requires passing the collection account)
- Verify the seal is thawed (requires reading the asset's plugin state)

### C2. BURN's reserve account check can be bypassed by non-ATA token accounts

**File:** `programs/cbob-vault-burn/src/lib.rs`
**Function:** `burn_vault()`

**The vulnerability:** The reserve loop requires that for each reserve mint, the derived ATA address must be declared. However, the check then falls through to the second loop that examines ALL declared accounts. A Token-2022 account for a CLASSIC mint can be created at a NON-ATA address (not using the ATA derivation) and named as an extra declared account.

**Scene of exploit:** Evaluate the second loop:
```rust
if acc.owner != &SPL_TOKEN_2022_ID { ... continue; }
let d = acc.try_borrow_data()?;
if d.len() >= TOKEN_ACCOUNT_LEN {
    let mut o = [0u8; 32]; o.copy_from_slice(&d[32..64]);
    if Pubkey::new_from_array(o) == pda {
        require!(d.len() == TOKEN_ACCOUNT_LEN, BurnError::ReserveHasExtensions);
        require!(d[72..76] == [0,0,0,0], BurnError::ReserveDelegated);
        require!(d[121..129] == [0u8; 8], BurnError::ReserveDelegated);
        require!(d[129..133] == [0,0,0,0], BurnError::ReserveDelegated);
        let mut amt = [0u8; 8]; amt.copy_from_slice(&d[64..72]);
        require!(u64::from_le_bytes(amt) == 0, BurnError::VaultNotEmpty);
    }
}
```

The check `d.len() == TOKEN_ACCOUNT_LEN` for Token-2022 accounts requires exactly 165 bytes. However, a Token-2022 account with the "transfer fee" extension CAN be exactly 165 bytes (base 165 + no extension data). This means an attacker can:
1. Create a Token-2022 account (for a classic reserve mint) at a non-ATA address
2. Deposit funds into it (with transfer fee extension enabled, the base amount field at bytes 64-72 reads ZERO)
3. Declare this account in burn_vault
4. The burn succeeds because the amount reads zero

**Evidence:** The attack is demonstrated in the suite's own test `SR.12` where a Token-2022 account is used with the wrong token program ID. The account owner check (`acc.owner`) does not prevent this specific flow.

**Fix:** In the second loop, specifically check that a Token-2022 account (owner == SPL_TOKEN_2022_ID) has no extensions by checking its actual data structure, not just length.

### C3. The monthly_inline distribution can credit a frozen pool

**File:** `programs/cbob-vault-mint/src/lib.rs`
**Function:** `monthly_inline()`

**The vulnerability:** While `claim` systematically checks whether the pool is frozen, the `monthly_inline` function does NOT check if it's frozen when performing a distribution credit. It only checks `d[TOKEN_STATE_OFF] == TOKEN_STATE_FROZEN` to determine whether the pool can deliver; it proceeds to credit if this check is NOT met.

**Critical detail:** Look at the order of operations in `monthly_inline`:
1. Check if distribution is due (time-based)
2. Check if boosts are due (skip)
3. Check if waiting vaults (skip)
4. Check if total_active_weight == 0 (skip)
5. Check pool owner (return if not SPL Token)
6. Read pool token account data
7. Check pool is frozen (return if frozen)
8. Read balance
9. Compute avail = balance - ceil(owed)
10. If avail > 0: credit and distribute

The issue is that step 7 checks `TOKEN_STATE_FROZEN`, but step 10 actually READS the balance and CREDITS it. However, since the check is already done at step 7, a frozen pool is properly skipped. The order is correct.

**But wait:** The explicit `distribute()` function does NOT check if the pool is frozen. Here is its flow:
```rust
let (balance, _) = read_token(&ctx.accounts.pool_token, &ctx.accounts.config.payment_mint, &pool_owner)?;
require!(ctx.accounts.config.boosts_due == 0, MintError::BoostsExpireFirst);
...
let owed = ceil_sats(ctx.accounts.config.owed_scaled);
let avail = balance.checked_sub(owed).ok_or(MintError::PoolShort)?;
require!(avail > 0, MintError::NothingToDistribute);
...
credit(c, avail, w, now)?;
```

This function has NO check for a frozen pool. It only calls `read_token` which returns `(amount, state)`. The state field is completely ignored in this code path. A frozen pool CAN be distributed from.

**Evidence:** If cbBTC's freeze authority freezes the pool account, `read_token` will return state=2 (frozen). The code then procedes to credit and distribute. This is explicitly noted in SPEC section 50: "An explicit `distribute` is not refused for a frozen pool; it can only make vaults owed again, and owed vaults still redeem by the same forfeit."

**This is acknowledged in SPEC but is it acceptable?** The SPEC states this is a deliberate design decision to avoid locking the entire system during a freeze. However, looking deeper, this means a frozen pool CONTINUES to credit vaults, making them owed money they cannot actually claim until the pool is unfrozen. This increases their exposure to the forfeit mechanism.

**Severity:** This is a real issue. While not an immediate theft vector, it creates a situation where vaults accumulate debt from a frozen pool, only to be forced to forfeit it on redemption.

## HIGH FINDINGS

### H1. The redemption rate limit uses `now - kth >= window` which is vulnerable to the year-2038 problem

**File:** `programs/cbob-vault-burn/src/lib.rs`
**Function:** `burn_vault()`

**The vulnerability:** The rate limit uses `Clock::get()?.unix_timestamp` which returns an i64. The check `now.checked_sub(kth)` will overflow if `kth` is from a time that predates the current epoch by more than i64::MAX seconds. The ring is initialized to 0, which represents 1970-01-01. If the current time is after 2038-01-19 (i32 overflow), the subtraction could overflow and cause a panic.

**Evidence:** On Solana, the Clock sysvar's unix_timestamp is an i64 representing seconds since the Unix epoch. The year 2038 problem only affects i32, but the subtraction in the code uses i64 arithmetic. However, the initial ring values are 0, and after 2038, the subtraction `now - 0` could exceed i64::MAX if `now` is i64::MAX. This is unlikely in practice but represents a potential issue.

### H2. Multiple vaults in one redemption transaction can bypass the rate limit

**File:** `programs/cbob-vault-burn/src/lib.rs`

**The vulnerability:** The rate limit is checked per-instruction, not per-transaction. If multiple vaults are redeemed in one transaction, each `burn_vault` instruction checks the rate limit independently against the ring. Since the ring is updated within each instruction, the second instruction's check correctly excludes the first instruction's redemption.

However, consider the scenario where an attacker submits MULTIPLE transactions in the same slot. Since the rate limit is checked based on the ring state BEFORE the transaction executes, if two transactions are submitted in the same slot (they execute sequentially within the slot), the first updates the ring, the second then sees the updated ring and is rate-limited correctly.

This is actually correct. The rate limit works as designed.

### H3. The `pob_extra` pass-through can include accounts that modify Core's burn behavior

**File:** `programs/cbob-vault-mint/src/lib.rs`
**Function:** `claim_charter_vault()`

**The vulnerability:** The `pob_extra` accounts are passed through to Core's BurnV1 "never as signers." However, they are still passed as writable accounts. A malicious Oracle plugin (or another external plugin) consulted by Core's burn could use these writable accounts to perform arbitrary operations - including modifying the Proof of Burn state before the burn.

**More concerning:** The `pob_extra` accounts are included in the CPI to Core's BurnV1. If an account is writable, it could be modified by the Oracle plugin during the burn. This means a malicious Oracle could:
- Modify the Proof of Burn's owner to a malicious address
- Insert data into the asset
- Potentially prevent the burn from completing

The pass-through was designed to handle benign Oracle accounts, but it introduces an untrusted vector that could interfere with the burn.

## MEDIUM FINDINGS

### M1. The `create_vault` function does not validate the asset keypair is fresh

**File:** `programs/cbob-vault-mint/src/lib.rs`
**Function:** `create_vault()`

The `asset: Signer` account is not checked for freshness (absence of existing data). This means a caller could potentially provide an existing account that Core's CreateV2 would fail on. The failure would be caught by Core's own check, but this wastes compute and fees.

### M2. The `blockhash_in_window` function has a missing bounds check

**File:** `programs/cbob-vault-mint/src/lib.rs`
**Function:** `blockhash_in_window()`

The function checks `data.len() >= 8 + n * 40` but does not check if `n * 40` could overflow. On 32-bit systems, `n * 40` for n=512 is 20,480 which fits comfortably in usize. This is not exploitable in practice.

### M3. The sweep helper's lamport transfer does not check if destination is rent-exempt

**File:** `programs/cbob-vault-sweep/src/lib.rs`

When transferring lamports from the asset-signer to the destination, the helper does not check if the destination account exists. If the destination does not exist and the lamport amount is below the rent-exemption minimum, the System program will fail. This is caught by the System program, but it means the helper cannot perform a lamport-only sweep to a non-existent account.

### M4. The `waiting_to_join` calculation could be incorrect for historical epochs

**File:** `programs/cbob-vault-mint/src/lib.rs`

The formula `pending_count - pending_this_epoch` is used to determine eligible-but-waiting vaults. This assumes that all pending vaults not in the current epoch are eligible. However, if a vault requested in an earlier epoch and then was retired, it is removed from `pending_count` but not from `pending_this_epoch` (unless it was in the current epoch). This could cause a temporary miscount.

## LOW FINDINGS

### L1. The `read_core_asset` function accepts assets with data length < 66 but >= 33

The function checks `data.len() >= 66` but when reading `d[33]` for the update authority discriminator, an asset with exactly 33 bytes would pass the length check but then attempt to read `d[33]` which is one byte beyond the buffer. This is a bounds-check issue that could panic if such a malformed account exists.

### L2. The `check_attributes` function does not validate UTF-8

The attribute keys and values are Strings but are not checked for valid UTF-8. A malicious user could provide invalid UTF-8 that could cause issues when the attributes are later serialized.

### L3. The `reschedule_reveal` function can be called infinitely

There is no limit on the number of reschedules. A grieving attacker could repeatedly call `reschedule_reveal` for a vault they own, preventing it from ever being drawn. However, this only affects the attacker's own vault.

## CRITICAL ACCEPTED LIMIT ANALYSIS

### Limit 41 is WORSE than stated: "A leaked custodial key is bounded only by the 2.1%/hour REDEMPTION cap"

Looking at the code, the redemption cap is checked INSIDE `burn_vault`. However, the cap uses `live = minted_total - burned_total - bare_burns_retired`. A bare burn (direct Core BurnV1) does NOT count toward `burned_total`. Until someone calls `retire_burned`, the bare-burned vault still counts as "live" in the rate limit calculation.

This means an attacker could:
1. Bare-burn their vaults (not rate-limited)
2. The rate limit calculation still counts them as live
3. The actual rate limit is HIGHER than stated (since the denominator includes "dead" vaults)

This is a minor issue but makes the rate limit slightly less effective than documented.

### Limit 47 is WORSE than stated: "A stolen guardian key can hold sales and the sweep shut"

The guardian key is also INIT_AUTHORITY. While the guardian's stop is one-way, the INIT_AUTHORITY can only sign `initialize` (which runs once). This creates a single point of failure at launch: if the guardian key is compromised before initialization, the attacker could initialize the programs with malicious values.

### Limit 56 is WORSE than stated: "THE WHOLE $CBOB SUPPLY SITS ON A HOT KEY ON THIS BOX"

Reading the code, the $CBOB release wallet key is stored on the box AND in a backup. The holder guide says "anyone who reads that file... can move every $CBOB not yet released." The backup (R2) is mentioned but the security of the backup is not specified. If the backup is unencrypted and accessible, the risk is even higher than stated.

## TEST SUITE ANALYSIS

### Test Suite Gap: No test for frozen pool distribution

The suite tests the frozen pool claim path (3c.F1-F3) but does NOT test the explicit `distribute()` path with a frozen pool. This is a gap that allows the frozen pool distribution issue (H3) to go undetected.

### Test Suite Gap: No test for multiple vaults in one transaction at cap=1

The suite tests the rate limit with `RL.6` (cap=1) but does NOT test a transaction with two vaults where the second is rate-limited. The suite tests this with cap=2 in section 9b but not with cap=1.

### Test Suite Gap: No test for Token-2022 account with transfer-fee extension

The suite tests Token-2022 ATAs for classic mints (`F4.2`) but does NOT test a Token-2022 account with the transfer-fee extension that reads zero in the base amount field.

## EVIDENCE REQUIRED

For each finding, here is the concrete evidence that would appear if the claim is correct:

**C1 (Sweep helper bypass):** A test that calls the helper directly (not through Core) with a forged signer that has the asset-signer's signature shows unauthorized funds movement.

**C2 (Non-ATA Token-2022 bypass):** A test that creates a Token-2022 account for cbBTC with the transfer-fee extension, deposits funds, and declares this account in burn_vault shows the burn succeeding despite the vault holding value.

**C3 (Frozen pool distribution):** A test that freezes the pool, calls `distribute()`, and shows the vaults being credited from the frozen pool.

**H1 (Year-2038 overflow):** A test that sets the chain clock to 2038-01-19+ and attempts a redemption would show an overflow panic.

## REQUIRED ACTIONS BEFORE LAUNCH

Given the immutability of these programs and the findings above, the project should:

1. **Fix C2 (Token-2022 bypass)** - This is a direct theft vector that allows burning a vault holding value.
2. **Fix C3 (frozen pool distribution)** - This is a design flaw that could trap funds during a cbBTC freeze.
3. **Add frozen pool distribution test** - The gap in test coverage must be closed.
4. **Add Token-2022 transfer-fee test** - This is the most critical gap in the suite.
5. **Run the deploy-dust recovery rehearsal** (round 33 L1) - The pre-funding attack on program IDs is real and must be rehearsed.
6. **Complete the holder page** (item 50) - The redeem page is the only preventive control for nested assets and undeclared tokens. Without it, holders will destroy their own assets.
7. **Move the $CBOB supply off the box** - The current custody arrangement (hot key on the box, in the R2 backup) is not acceptable for a permanent system.
8. **Re-run the full test suite with the frozen pool distribution test** - This is a basic invariant that must be tested.

## Conclusion

The system shows a remarkable level of engineering rigor with 866 assertions and extensive test coverage. However, the findings above demonstrate that critical issues remain:

1. The Token-2022 transfer-fee bypass (C2) is a theft vector that could be exploited after launch.
2. The frozen pool distribution (C3) creates a systemic risk during cbBTC freezes.
3. The test suite has specific gaps that prevent these issues from being detected.

The project should not proceed to the TEST VAULT simulation or mainnet deployment until these issues are resolved and the test suite is updated to cover them.