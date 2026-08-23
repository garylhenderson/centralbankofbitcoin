## FINDINGS BY TARGET

### R1 — SEAL’s new on-chain confinement

**R1-1. MEDIUM — Compute units are still unmeasured, and the new full scan is more expensive than the old forward stop.**
- **Construct:** `open_for_redemption` now loops from `i = 0` over every top-level instruction and never breaks. The project still has no CU gate anywhere, only a byte-size gate.
- **Effect:** A transaction could hit the compute ceiling before the byte ceiling, especially a versioned transaction using address lookup tables where many top-level instructions fit in the same 1232-byte packet. A failed redemption does not lose funds, but it breaks a customer path and wastes a Bank signature.
- **Evidence that would exist if right:** A `ComputeBudgetInstruction`-limited redemption, or a packed versioned redemption, would return `ProgramFailedToComplete` / CU exhaustion while the same instruction count is far below the measured 1119-byte legacy ceiling. The test suite currently records no CU number.
- **Fix:** Add a CU measurement beside the existing byte measurement, pinned like `9.14a`, and fail the suite if a worst-case redemption exceeds the default limit.

**R1-2. CONFIRMED GAP, not newly closed — the Bank as fee payer remains invisible to the on-chain check.**
- **Concrete transaction:**
  ```
  feePayer = Bank
  open_for_redemption(asset, owner, Bank)
  ...sweeps...
  burn_vault(asset, owner, Bank)
  ComputeBudget.SetComputeUnitPrice(high)
  ```
  The sysvar sees no account list naming the Bank outside the pair, so `BankKeyOutsidePair` does not fire. The Bank pays the base fee and any priority fee.
- **Evidence:** Serialize such a transaction with `feePayer = Bank`; the new Rust check cannot see it. `judgeRedemptionTx` catches it only when run through the policy tool.
- **Fix:** Already accepted as a policy-only check. The new on-chain code does not change that. This is not a regression; it is the known limit, but R1’s “what does it NOT see” should remain stated in the control table.

**R1-3. No bypass found for the exemption itself.**
The exemption only covers `program_id == SEAL/BURN` plus the first 8 bytes. A forged instruction wearing those bytes is dispatched to the real program and can only succeed as a real `open_for_redemption` or `burn_vault`. Placing the Bank in a burn’s `remaining_accounts` is harmless; the burn loop ignores system-owned Bank accounts with lamports. A burn before the open does not satisfy `found` and still cannot execute successfully. No concrete bypass was found.

---

### R2 — Weighted distribution and emission cadence

**R2-1. MEDIUM — `holdDays` treats failed/skipped/ambiguous rows as if someone was actually paid.**
- **Construct:**
  ```js
  const paid = days.filter(d => Object.keys(st.days[d]?.paid || {}).length > 0)
  ```
  The `paid` object contains records for rejected transfers, skipped burned vaults, ambiguous intents, and resolved rows, not only rows with a signature.
- **Effect:** A day where every transfer was refused (`sig:null, rejected:true`) or every vault was skipped resets the cadence anchor. If the pool is below threshold but was force-eligible, the next attempt can be pushed out another month even though nobody received money.
- **Evidence that would exist if right:**
  ```js
  holdDays({ days: {
    '2026-08-01': { paid: { v1: { amount:'5', sig:null, rejected:true } } },
    '2026-08-05': { paid: {} }
  } }, '2026-08-08')
  ```
  returns `7`, counting 08-01 as a paid day. No transfer landed.
- **Fix:** Count only rows with `r.sig` (or `paymentState(row) === 'paid'`). Rejected, skipped, ambiguous, and human-resolved no-signature rows must not anchor the hold clock.

**R2-2. MEDIUM — An activated vault with no level halts every payee.**
- **Construct:** `allocateWeighted` refuses the whole distribution if any activated vault is missing from `levels.json`.
- **Effect:** Anyone who can activate a vault — deposit 21,000 sats to its cbBTC ATA — can stop all distributions if the off-chain level register has not yet assigned that vault a level. This is a cross-customer availability grief.
- **Evidence that would exist if right:** With `balances = {vaultA:'21000'}` and `levels = {}`, `allocateWeighted` returns `skip: '1 activated vault(s) carry no level: ...'`. In `main` the day is marked finished and no activated vault gets paid.
- **Fix:** Do not halt all payouts. Put unlevelled activated vaults into a declared pending/exception state, alert, and distribute to the rest — or require a level assignment before activation can be funded. “Fail closed” should not mean “one missing row freezes all customer money.”

**R2-3. LOW — The “forced at the ceiling” guarantee is false when the smallest share rounds to 0 sats.**
- **Construct:**
  ```js
  if (smallestPer < MIN_PER_VAULT) return { pay:false, forced:false, reason:'nothing to distribute' }
  ```
  runs before the `maxHoldDays` force.
- **Effect:** If `available > 0` but `available < denominator`, smallest Level I share is 0, and the distribution holds forever even at day 99. The comment says no holder waits longer than a month at zero volume; they can.
- **Evidence:** `decideEmission({ smallestPer: 0n, daysSinceLastPayout: 99 })` returns `pay:false, forced:false`.
- **Fix:** Document this lower bound explicitly, and decide what happens when the pool cannot give every activated vault at least 1 sat. Do not describe it as a universal monthly guarantee while the code refuses it.

**R2-4. Arithmetic over-distribution/dust/smallest: no defect found.**
`total <= available` is preserved by flooring. Dust is bounded by `(denominator - 1)`. `smallest` is safe because empty/no-level branches return earlier.

---

### R3 — `scripts/bank-sign.sh`

**R3-1. MEDIUM — `$0` under a symlink can execute a different `bank/cosign.mjs`.**
- **Construct:** The script does:
  ```bash
  cd "$(dirname "$0")/.."
  exec /usr/bin/env node bank/cosign.mjs ...
  ```
- **Effect:** If invoked through a symlink outside the repo, the relative path resolves against the symlink’s directory, not `/opt/cbob-vaults`. A malicious or mistaken symlink plus a sibling `bank/cosign.mjs` can make the Bank run code that does not perform the documented checks.
- **Evidence:** Create a symlink at `/tmp/x/bank-sign.sh` and a file `/tmp/bank/cosign.mjs`; the script `cd`s to `/tmp` and executes `/tmp/bank/cosign.mjs`, not the repo’s.
- **Fix:** Resolve the real script path first:
  ```bash
  SCRIPT_DIR=$(cd -- "$(dirname -- "$(readlink -f -- "$0")")" && pwd)
  cd "$SCRIPT_DIR/.."
  ```

**R3-2. LOW — The base64 check is not a canonical base64 validator.**
- **Construct:** It accepts any string over `[A-Za-z0-9+/=]` regardless of length, padding position, or non-zero trailing bits.
- **Effect:** Node’s lenient `Buffer.from(s,'base64')` can decode malformed base64 instead of refusing. That is the exact fail-open class the header says the filter exists to prevent.
- **Evidence:** Inputs like `A`, `====`, or invalid padding pass the shell case and are handed to Node. A strict decoder would reject them.
- **Fix:** Validate length mod 4, padding placement, and canonical final-quantum padding bits before invoking Node.

**R3-3. Exit-code handling:** `exec` preserves `cosign.mjs`’s exit code. No defect found there.

---

### R4 — The new gates

**R4-1. MEDIUM — The ON-CHAIN 2-of-2 gate matches source text, not semantics.**
- **Construct:**
  ```js
  return /pub bank: Signer<'info>/.test(src)
    && /require_keys_eq!\(\s*ctx\.accounts\.bank\.key\(\),/.test(src)
  ```
- **Effect:** A program whose equality check compares the Bank to itself, to `config.admin`, or to an arbitrary literal passes the gate without enforcing a 2-of-2.
- **Example passing program fragment:**
  ```rust
  require_keys_eq!(ctx.accounts.bank.key(), ctx.accounts.bank.key(), VaultError::NotTheBank)
  ```
  or
  ```rust
  require_keys_eq!(ctx.accounts.bank.key(), ctx.accounts.config.admin, VaultError::NotTheBank)
  ```
- **Evidence:** Both match the current regex; neither proves `bank == config.bank`. The gate’s own negative test only removes the first argument, not the changed RHS.
- **Fix:** Parse the second argument and require it to be the program’s own Bank config field, or pin the expected right-hand-side token per program rather than regexing fragments.

**R4-2. LOW — The signer-set and self-match gates are text-searchable and can be evaded by non-`fromSecretKey` signers or obfuscation.**
- **Construct:** The gate searches for `fromSecretKey`. A new file that signs with `nacl.sign.detached`, `solana sign-offchain-message --keypair`, or an assembled call path can sign with the Bank key without containing `fromSecretKey`.
- **Effect:** The repo gate can be bypassed by a future signer using a different signing API or runtime-constructed string. This is not an immediate exploit, but the gate’s claim “no route to a Bank signature” is stronger than the mechanism.
- **Fix:** Move these checks closer to an allowlist of known signers plus their signing APIs, or use an AST-aware/parse-aware check instead of raw regex.

**R4-3. LOW — The self-match arm is itself text-search defeatable.**
A future selftest that constructs the forbidden literals from fragments, `eval`, or dynamic strings would avoid the self-match scan. This is inherent to source-text gates. The current gate catches prose spelling; it cannot catch deliberate obfuscation.

---

### R5 — Comments, both directions

**R5-1. HIGH — Three comments plus the control table understate what this round’s Rust actually enforces.**

- `bank/cosign.mjs` header still says:
  > `open_for_redemption` walks the instruction sysvar forward only as far as its matching `burn_vault` and never enumerates the rest … Moving them on-chain is possible and is not done.

  False. The bank-pubkey confinement **is** on-chain now.

- `programs/cbob-vaults/src/lib.rs` header still says:
  > AND THIS FUNCTION DOES NOT BOUND WHAT ELSE IS IN THE TRANSACTION. The forward scan below stops at the matching burn; it never enumerates the rest.

  False. The function now walks from 0 and enforces `BankKeyOutsidePair` over all top-level instructions.

- `SPEC.md` still says:
  > AND THE TWO CHECKS THAT MATTER MOST ARE IN THE POLICY HALF … `open_for_redemption` walks the instruction sysvar forward only far enough to find its matching `burn_vault` … Moving those two on-chain is possible … and is not done.

  False for bank-pubkey confinement.

- `SPEC.md` control table row 2 still attributes the bank-pubkey confinement to `bank/cosign.mjs` PROCEDURE only. It does not record that SEAL now independently rejects the round-15 theft on-chain.

**Effect:** This is the inverse of the over-claiming class the repository has been trained to catch. It tells a member the system is weaker than it now is, and understates the guarantee the Bank signature buys.

**Evidence:** Grep the tree for `forward scan`, `forward only`, and “Moving them on-chain”; the Rust diff contains `BankKeyOutsidePair`. The on-chain tests 4.7 and 4.10 are now enforced by SEAL, not only by `cosign.mjs`.

**Fix:** Update all three comments and the SPEC control table. The table should reflect that the bank-pubkey confinement is ON-CHAIN and the remaining policy half is the program allowlist plus fee-payer checks.

---

### R6 — Published card arithmetic

I re-computed the figures from the weights.

- 240-vault census: `108/60/36/24/12`, denominator `732` — correct.
- 2,100-vault census: `945/525/315/210/105`, denominator `6,405` — correct.
- Per `$1,000` at 240: `2.73 / 4.10 / 5.46 / 6.83 / 8.20` — correct.
- Per `$1,000` at 2,100: `0.31 / 0.47 / 0.62 / 0.78 / 0.94` — correct.
- Shares at 2,100: `29.5 / 24.6 / 19.7 / 16.4 / 9.8`, sum `100.0%` — correct.
- Level V = 3 × Level I — correct.

No defect found in the published card arithmetic.

---

## CARRY-OVER LIST

The carry-over item that got worse is:

**Item 12 — Compute units are unmeasured.** R1’s new scan now deserializes every top-level instruction rather than stopping at the burn. It is still unmeasured. See R1-1.

The other accepted limits remain as stated; no carried item was found to be worse than its description.

---

## VERDICT CHALLENGES

The round-16 verdict’s claim that BURN needs no copy of the new confinement appears to hold. Every burn that can execute must have a preceding top-level open for the same asset/owner, and that open’s scan covers the whole transaction. I found no successful transaction containing a burn whose confinement was never checked, under the ordinary Solana execution model.

The lock rewrite was not re-broken. No new double-hold scenario was found.

---

## ANYTHING ELSE

No additional CRITICAL was identified in the diff.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

This system should stop relying on prose as evidence that a control exists. Specifically:

1. **Every comment that describes behaviour should be extracted into an assertion or deleted.** The R5 finding — three comments understating the new on-chain check — is exactly the kind of drift a human firm might have caught by reading prose. With no firm, prose is unmaintained.

2. **Semantic gates must replace source-text regexes.** R4-1 shows a two-line regex can be fooled by a one-token change. The Rust checks should be generated or verified against the actual Anchor context types, not string patterns.

3. **Add a compute-unit measurement gate now.** The system already treats the 1232-byte ceiling as a measured product bound. The new full scan makes CU a second ceiling, and it is currently invisible.

4. **Publish and commit to the level register now.** The off-chain level assignment is the highest-value word-of-Bank risk in the new money path. A commit-reveal hash must exist before activation; an unbuilt commitment should be treated by the ship gate as a missing control, not an open item.

5. **Make off-chain cadence pure functions consume only proved ledger states.** R2-1 demonstrates that the cadence clock currently counts failed and skipped rows as payments. The project should run the off-chain ledger through a replayable, versioned state machine with the same “proven in both directions” discipline already used for detectors.