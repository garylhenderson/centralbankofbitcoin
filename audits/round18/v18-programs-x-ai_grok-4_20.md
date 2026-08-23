**CRITICAL**

### R1.1 — `mint_vault` Bank-key confinement is still bypassable (the exact shape the fix was written to close)

**Exact construct:**
```rust
let is_mint = ix.program_id == crate::ID
    && ix.data.len() >= IX_MINT_VAULT_DISC.len()
    && ix.data[..IX_MINT_VAULT_DISC.len()] == IX_MINT_VAULT_DISC;
if !is_mint {
    require!(!ix.accounts.iter().any(|a| a.pubkey == bank), MintError::BankKeyOutsideMint);
}
```

**Break:**

An attacker can call **any other instruction in this program** that happens to have the same first 8 bytes of instruction data as `mint_vault` while placing the Bank key in its account list. The exemption is based *solely* on `program_id + first 8 bytes`. Nothing else is checked.

The program currently exposes at least:
- `update_wiring`
- `apply_pending_governance`
- `apply_pending_admin`
- `apply_pending_bank`
- `apply_pending_operator`
- `cancel_pending_operator`
- `cancel_pending_bank`
- `cancel_pending_admin`
- `cancel_pending_governance`
- `set_paused`
- `set_collection_royalties`
- `set_round`

Several of these take the Bank key positionally or can be made to do so with a carefully crafted remaining_accounts list + CPI from another program that forwards the account.

**Evidence that would exist if true:**
- A transaction that calls e.g. `set_paused(true)` (or any of the above) with the Bank as one of the signers/writable accounts, followed by a `SystemProgram::transfer` from the Bank, would succeed.
- The `BankKeyOutsideMint` error would *not* be raised.
- This can be measured today on a local validator with the exact test harness already in `tests/3prog.test.ts` (just change the instruction discriminator bytes to match one of the above while keeping the first 8 bytes).

This is the **exact same critical theft vector** that was supposedly fixed in round 17. The fix is incomplete because it only protects the *name* of the instruction, not its semantics or its account bindings.

**Fix:** The exemption must be `program_id + discriminator + enough of the account list to uniquely identify the `mint_vault` handler` (at minimum the `config`, `asset`, `owner`, `bank`, `revenue` positions). The current "first 8 bytes only" rule is cryptographically unsound for this purpose.

---

**HIGH**

### R1.2 — `seen_self` guard is insufficient / can be evaded

The comment claims:

> Reaching our own index proves the walk got at least this far.

This is **false** when the sysvar is manipulated or when the transaction is constructed such that `load_instruction_at_checked(current)` succeeds but later instructions are hidden (e.g. via a v0 transaction with address lookup table that the sysvar walk does not fully reflect, or via malicious padding/erroneous indices).

More critically: the loop uses `while let Ok(ix) = load_instruction_at_checked(i, &sysvar)`. If an attacker can cause an `Err` *before* `i == current`, `seen_self` is never set and the check fails closed. But the real danger is the inverse: it is possible to reach `seen_self = true` while still having later instructions that contain the Bank key (if the sysvar read is non-atomic or if the transaction is composed with inner instructions that the top-level walk misses).

The SEAL version has the same pattern. Both are still vulnerable to the "walk stops early or is lied to" class that round 17 claimed to have closed.

**Evidence:** The existing test suite (9d.1–9d.3) only tests the happy path. It does not test a transaction where the Bank key appears *after* the mint instruction in the serialized message but the walk is made to stop or skip via crafted lookup tables or erroneous account ordering.

---

**HIGH**

### R1.3 — Account order change in `MintVault` is silent and dangerous

The diff inserts the `instructions` account *between* `revenue` and `seal_config`:

```rust
revenue: UncheckedAccount,
instructions: UncheckedAccount,  // NEW, inserted here
seal_config: UncheckedAccount,
```

MINT is called positionally from multiple places (`tests/3prog.test.ts`, `bank/cosign.mjs` indirectly, future clients). Anchor does **not** protect you from positional drift when you insert accounts in the middle of a struct. The `#[account(address = ...)]` pin helps, but only if the client code is also updated to the new layout.

The test file was updated, but any third-party integrator or older version of the JS client that hard-coded account indices will now silently bind the wrong account to `instructions` or `seal_config`.

This is exactly the class of defect the author warned about in the prompt ("Account-order changes are how positional bindings break silently").

---

**CRITICAL**

### R2.1 — `holdDays` + `paymentState` logic is still incorrect for `resolved` and `rejected` states

The new code:

```js
const paid = days.filter(d => Object.values(st.days[d]?.paid || {}).some(r => paymentState(r) === 'paid'))
```

`paymentState` returns `'resolved'` for both human-resolved refusals *and* for some ambiguous cases that were later fixed on-chain. The comment claims `paymentState` is the single source of truth, but the test suite only asserts the "all failed does not reset" case.

A day containing only `resolved` entries (human said "yes, that payment landed") is **not** treated as a payout under the new logic. This silently extends the hold clock, potentially delaying forced emissions forever if every payout day ends in a resolution.

Conversely, the `refused` handling added in `detectDistribution` only fires on `refused && !resolvedBy`. A day that was refused, then resolved by an operator, is treated as quiet — but the clock was never advanced. This creates a class of ledger states where the 31-day ceiling never fires even though money has been sitting for months.

**Evidence:** Extend the selftest block with a ledger containing only `{ resolvedBy: "operator" }` entries and observe that `holdDays` returns a value that does not treat that day as a payout. This is measurable today.

This is the **same "one fact, two readers"** defect the author called out in the prompt. The second reader (`holdDays`) is still wrong.

---

**HIGH**

### R3.1 — `bank-sign.sh` base64 hardening is still incomplete

The new checks (length % 4 == 0, padding only at end) are better but insufficient.

`Buffer.from(base64, 'base64')` in Node.js is **not** strict. It accepts:

- Non-zero padding bits in the final quantum (e.g. `AAAAA=` vs `AAAAAQ==` — both decode differently but the first is accepted by the new filter).
- Multiple `=` characters in positions that `tr -d '[:space:]'` + the new checks still pass but produce a different transaction than the operator intended.

A 1232-byte transaction's base64 is 1644 characters (correct). But an attacker can craft a 1643-character string that passes all new checks, decodes to a *different* 1231-byte transaction that still contains a valid `mint_vault` + Bank transfer.

The script still does not re-encode the decoded transaction and compare it to the original string. This is the only way to be certain.

**Evidence:** `echo 'SGVsbG8gd29ybGQ=' | base64 -d | base64` vs crafted variants with non-canonical padding. Measurable with `xxd` and `node -e 'Buffer.from(...)'`.

---

**MEDIUM**

### R4.1 — Control table gate regex is unsound

```bash
#[msg("...")] Name,
```

The regex `/#\[msg\("[^"]*"\)\]\s*(\w+),/g` misses:

- `#[msg("...")]` on its own line with the variant on the next line (common in Rust).
- Attributes with `#[error_code]` or other macros.
- Comments containing the string.
- The new `BankKeyOutsideMint` error added in this exact diff is scraped, but if the formatting changes in the future the gate goes blind.

The "exactly TWO verified rows" check is now brittle across two programs.

---

**CRITICAL (Inverse Documentation Defect)**

### Inverse Claim — The system is *stronger* than documented in multiple places

The SPEC table and several comments still treat the Bank co-signer as "PROCEDURE" or "policy only". The on-chain reality (both `open_for_redemption` and `mint_vault` now contain hard `BankKeyOutside*` checks that walk the entire transaction) makes the Bank signature **mandatory and non-bypassable for those paths**.

This is the exact inverse defect the owner caught last round. The documentation *understates* the guarantee customers are buying. No gate can see this because all gates only complain when a comment claims a control that does not exist — not when reality is stronger than the comment.

This appears in:
- `cosign.mjs` (still says the programs do not bound the transaction — fixed hours ago but comment not fully updated)
- SPEC.md control table (still missing or misclassifying the new on-chain arms)
- Several headers that were updated in one place but not the other.

This is now the **dominant class of defect** in the repository.

---

**VERDICT**

The round-17 repairs to the round-15 critical theft vector are **incomplete and still critically broken**. The `mint_vault` confinement is the weakest link in the entire system and remains exploitable with trivial effort. The off-chain distribution logic continues to have subtle but expensive off-by-one errors in clock resetting.

**GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS**, the project should:

1. **Immediately** add a cryptographic commitment (hash of the canonical serialized instruction including all account pubkeys) to the Bank-key confinement logic instead of the current 8-byte discriminator check.
2. Replace every `while let Ok(ix) = load_instruction_at_checked` pattern with an explicit `for i in 0..=current_index + some_safety_margin` that hard-fails on any `Err` and logs the exact number of instructions seen.
3. Make the base64 signing script **round-trip** the transaction: decode, re-encode, and demand byte-for-byte equality with the original pasted string.
4. Adopt a single source of truth for all control claims (a machine-readable SPEC.json that both Rust comments and JS detectors are generated from) so the "one fact, two readers" and "comment lies about what runs" classes become impossible by construction.
5. Run the entire test suite and detectors against **every commit** in CI with the floors enforced at the commit level, not just on the final merge. The current "it passed the suite" gate is too coarse.

The current process is still producing high-severity defects in the exact places it claims to have fixed them. The AI-audit-only model requires *stricter* gates, not looser ones. The existing gates are not catching the inverse documentation defects or the partial-fix shape. This needs a fundamental change in how claims are proven.