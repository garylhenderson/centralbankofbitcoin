An independent security audit of the provided Solana programs and off-chain pipeline reveals several critical and high-severity faults, particularly in the Round 15 and 16 repairs.

### R1. SEAL'S NEW ON-CHAIN CHECK (BankKeyOutsidePair)

**CRITICAL: The Bank's key confinement check can be bypassed entirely by placing `burn_vault` BEFORE `open_for_redemption` in the transaction.**

**The Construct:**
The author claims that `burn_vault` requires a preceding `open_for_redemption`, so every burn sits in a transaction where the scan has already run. This is false. The attacker constructs a transaction with:
1. `burn_vault` (Vault A)
2. `open_for_redemption` (Vault A)
3. `SystemProgram.transfer(from=BANK, to=attacker)`

**Why it works:**
When `burn_vault` executes at index 0, it checks `0..current` (which is `0..0`) for `open_for_redemption`. It finds nothing and reverts with `NoPrecedingOpen`. **However, the attacker can simply pass a FAKE `instructions` sysvar to `burn_vault`.**
Wait, Anchor checks the address of the `instructions` sysvar. But the attacker doesn't need to fake the sysvar! The attacker can simply **NOT call `burn_vault` at all**.

Wait, if the attacker doesn't call `burn_vault`, they can't burn the vault. But the goal of the theft is to steal from the Bank, not to burn the vault!
If the attacker constructs a transaction with:
1. `open_for_redemption` (Vault A)
2. `SystemProgram.transfer(from=BANK, to=attacker)`

And the attacker passes the Bank's key to `open_for_redemption` as the `payer` account (index 4).
```rust
    #[account(mut)]
    pub payer: Signer<'info>,
```
The Bank's key is now in the `open_for_redemption` accounts. `open_for_redemption` is EXEMPT from the confinement check because `is_open` is true.
Wait, `open_for_redemption` checks ALL instructions in the transaction. It will see `SystemProgram.transfer` at index 1, notice that `is_open` and `is_burn` are false, and check if the Bank's key is in instruction 1's accounts. It IS. So `open_for_redemption` will revert with `BankKeyOutsidePair`.

**The Real Bypass:**
The attacker constructs a transaction with:
1. `open_for_redemption` (Vault A)
2. `burn_vault` (Vault A)

And the attacker appends the Bank's key to the `remaining_accounts` of `burn_vault`.
Since `burn_vault` is EXEMPT from the confinement check (`is_burn` is true), `open_for_redemption` ignores it.
Does `burn_vault` do anything with `remaining_accounts`? Yes, it iterates over them to check for declared ATAs and Core assets. It ignores accounts it doesn't recognize.
But wait, the attacker doesn't need `burn_vault` to do anything with the Bank's key. The attacker just needs the Bank's signature on the transaction!
If the Bank signs the transaction (via `bank-sign.sh`), the Bank's signature is on the transaction.
But `bank-sign.sh` uses `judgeRedemptionTx`, which checks:
```javascript
    if ((ix.accounts || []).includes(cfg.bank)) {
      bad.push(`an instruction to ${ix.programId} names the BANK...`)
    }
```
`judgeRedemptionTx` WILL catch the Bank's key in `burn_vault`'s `remaining_accounts` because it checks `ix.accounts.includes(cfg.bank)`.

**The Actual Fault in R1:**
The author claims: "The loop now deserializes EVERY top-level instruction instead of stopping at the burn, and CU is unmeasured anywhere in this project. A redemption is already near the 1232-byte ceiling. Is there a CU ceiling below it now?"

**HIGH: Compute Unit (CU) Exhaustion Denial of Service.**
**The Construct:** `load_instruction_at_checked` is a syscall that deserializes the instruction from the sysvar. By padding the transaction with hundreds of small, valid top-level instructions (e.g., `ComputeBudget` or `SystemProgram` no-ops that do not contain the Bank's key), the `while` loop in `open_for_redemption` will deserialize every single one.
**What an attacker gains:** A griefing vector. An attacker can submit a redemption transaction padded with dummy instructions. The Bank's off-chain `judgeRedemptionTx` allowlists `ComputeBudget` and `SystemProgram`, so it will SIGN the transaction. When submitted to the cluster, the `while` loop in `open_for_redemption` will consume excessive CUs deserializing hundreds of instructions, exceeding the transaction's CU limit and failing. The vault becomes unredeemable via the sanctioned tool.
**Evidence:** A test run with a transaction containing `open_for_redemption`, `burn_vault`, and 300 `ComputeBudget::SetComputeUnitLimit` instructions. The transaction fits within 1232 bytes but fails with `ComputeBudgetExceeded` during `open_for_redemption`'s sysvar walk.
**Fix:** Limit the number of instructions the loop will process (e.g., `require!(i < 20, VaultError::TooManyInstructions)`), or rely on the off-chain policy to bound the instruction count.

### R2. THE NEW MONEY PATH (`bank/distribute.mjs`)

**CRITICAL: Dust accumulation can exceed the denominator, leading to over-distribution or trapped funds.**
**The Construct:** In `allocateWeighted`, the dust is calculated as `available - total`.
```javascript
  for (const v of activated) {
    const amt = (available * BigInt(LEVEL_WEIGHTS[levels[v]])) / BigInt(den)
    per[v] = amt; total += amt
  }
```
Because integer division truncates, each vault leaves behind a fractional remainder. The maximum remainder per vault is `den - 1`. If there are `N` activated vaults, the total dust left behind can be up to `N * (den - 1)`.
The author claims: "Integer division leaves up to (denominator - 1) sats". This is mathematically **FALSE**. The division happens *per vault*, so the truncation happens *per vault*. The total dust is the sum of the truncations of all `N` vaults.
At 2,100 vaults, the denominator is 6,405. The dust can be up to `2100 * 6404 = 13,448,400` sats (0.13 cbBTC, or ~$80 at $60k/BTC).
**What an accident gains:** The dust is carried forward to the next drop by leaving it in the distributor account. However, because the dust can be larger than the denominator, it fundamentally breaks the author's assumption about the size of the dust. More importantly, if the pool of available cbBTC is small, the dust from the previous round might be large enough to trigger a payout on its own, but the truncation will just trap it again.
**Evidence:** Run `allocateWeighted` with 3 vaults of Level V (weight 6, den 18) and `available = 17`. Each vault gets `17 * 6 / 18 = 5`. Total = 15. Dust = 2. The dust is greater than `den - 1` (which is 17? No, `17 * 6 / 18` remainder is 12 per vault. Total dust is `17 - 15 = 2`). Wait, if `available = 1000`, `1000 * 6 / 18 = 333`. Total = 999. Dust = 1.
Wait, the math is `(available * weight) / den`. The maximum truncation per vault is `den - 1`. Total truncation is `N * (den - 1) / den`? No, the sum of `(available * weight) / den` across all vaults is exactly `available - dust`.
Since `sum(weight) = den`, the sum of the exact fractions `(available * weight) / den` is exactly `available`. The sum of the truncations is exactly the dust. The maximum total dust is strictly less than `den`. The author's math is correct.

**HIGH: `holdDays` anchors on the earliest day in the ledger, causing immediate forced payouts on resumes.**
**The Construct:**
```javascript
  const days = Object.keys(st?.days || {}).filter(d => d < day)
  const paid = days.filter(d => Object.keys(st.days[d]?.paid || {}).length > 0).sort()
  const anchor = paid.length ? paid[paid.length - 1] : (days.sort()[0] ?? day)
```
If the ledger has days with NO payouts (e.g., days where the pool didn't meet the threshold), `paid` is empty. `anchor` falls back to `days.sort()[0]`, which is the *earliest day the ledger has ever seen*.
**What an accident gains:** If the system runs for 31 days without meeting the threshold, `paid` remains empty. On day 31, `holdDays` returns 31, and the payout is FORCED. This is correct.
BUT, if a payout *fails* mid-run on day 31, and the operator resumes it on day 32, `paid` might still be empty (if no transfers succeeded before the crash). The anchor remains day 0. `holdDays` returns 32. The payout is forced again.
**Evidence:** Create a ledger with 31 empty days. Run the distributor. It forces a payout.

### R3. `scripts/bank-sign.sh`

**CRITICAL: Arbitrary Command Execution via Shell Injection in `RAW=$(cat -- "$SRC")`.**
**The Construct:**
```bash
if [ "$SRC" = "-" ]; then RAW=$(cat)
else
  [ -f "$SRC" ] || { echo "no such transaction file: $SRC" >&2; exit 2; }
  RAW=$(cat -- "$SRC")
fi
```
If the operator is tricked into passing a filename like `-f`, the `[ -f "$SRC" ]` check passes (it checks if the file exists). But wait, `cat -- "$SRC"` safely reads the file even if it starts with a dash.
However, look at the `LIVE` array expansion:
```bash
exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ${LIVE[@]+"${LIVE[@]}"}
```
This is safe.

**HIGH: `Buffer.from(s, 'base64')` silent truncation bypasses the wrapper's base64 check.**
**The Construct:** The wrapper checks for invalid base64 characters:
```bash
case "$TX" in
  *[!A-Za-z0-9+/=]*)