I could not execute these programs in this review. Each finding below is a code-level claim plus the on-chain/test evidence that would show it.

---

## FINDINGS

### F1 — HIGH — `initialize` does not prevent permanent key-role collision or 15% destination self-dire

**Construct.** `programs/cbob-vault-mint/src/lib.rs` in `initialize`. It rejects `bank_treasury == Pubkey::default()` and `swap_operator == Pubkey::default()`, but it never rejects:

- `bank_treasury == config.key()` (i.e. the MINT config PDA)
- `bank_treasury == revenue` (the `["revenue"]` PDA)
- `bank_treasury == pool_ata`
- `swap_operator == guardian` when `guardian` is `Some`

These are all valid non-default pubkeys and therefore accepted.

**What an accident or wrong launch value does.**

`split_revenue` derives the bank ATA from `bank_treasury`:

```rust
let expect = |wallet| ATA(wallet, SPL_TOKEN_ID, payment_mint);
require_keys_eq!(bank_ata, expect(&cfg.bank_treasury));
```

- If `bank_treasury == config.key()`, then `bank_ata == holders_ata == pool_ata`. The first TransferChecked sends the holders’ 85% to the pool. The second sends the 15% “bank cut” to the same pool. Net result: 100% of revenue goes to the pool, the Squads receive nothing, permanently.
- If `bank_treasury == revenue`, then `bank_ata == revenue_ata`. The 15% is “transferred” from the revenue ATA to itself, so it remains in the revenue address and is split again on later calls. The 15% destination never receives its share.

**What this violates.** The design says 85/15 is fixed forever and the 15% goes to the CBOBTC Squads. One launch value silently changes that.

**Guardian / swap operator collision.**

If `swap_operator == guardian`, then the guardian key can call `sweep_sol_for_swap` and transfer royalty SOL to itself. That contradicts the “guardian can only stop” guarantee. The guardian becomes the one trusted money-moving key as well.

**Evidence if this is real.**

Run MINT `initialize` with `bank_treasury = MINT_CFG`, fund the revenue ATA, and call `split_revenue`. The bank ATA balance will be zero; the pool receives the full balance. Or initialize with `bank_treasury = revenue` and observe no third account increases. For the guardian case, initialize with `guardian == swap_operator`, then have that key call `sweep_sol_for_swap`; it will succeed and receive the SOL.

**Fix.**

After deriving `pool_ata` and `revenue`, add explicit refusals:

```rust
require_keys_neq!(bank_treasury, ctx.accounts.config.key(), MintError::WrongTreasury);
require_keys_neq!(bank_treasury, revenue, MintError::WrongTreasury);
require_keys_neq!(bank_treasury, pool_ata, MintError::WrongTreasury);
if let Some(g) = guardian {
    require_keys_neq!(swap_operator, g, MintError::WrongTreasury);
}
```

Also add explicit `guardian != swap_operator` where guardian is `Some`.

This must also be checked in `scripts/check-launch-params.mjs`.

---

### F2 — MED — A frozen VAULT cbBTC account blocks redemption, and the accepted limit understates it

**Construct.** `programs/cbob-vault-burn/src/lib.rs` in `burn_vault`. The emptiness proof requires each reserve token account amount to be exactly zero:

```rust
require!(u64::from_le_bytes(amt) == 0, BurnError::VaultNotEmpty);
```

The cbBTC reserve ATA is one of those accounts. The SPL Token program will not allow `Transfer` out of a frozen account. Therefore if the VAULT’s own canonical cbBTC ATA is frozen, the owner cannot sweep it, `burn_vault` fails, and the whole redemption reverts.

This is distinct from the handled “frozen pool” case. `retire_redeemed` has a forfeit path when the POOL is frozen, but there is no path when the VAULT’s own cbBTC account is frozen.

**What an attacker or accident gains.**

Coinbase, or someone able to influence Coinbase’s freeze process, can freeze a specific vault’s cbBTC ATA. A hostile actor can send tainted cbBTC to a vault’s public ATA in an attempt to trigger exactly this. The owner cannot redeem the cbBTC, and because `burn_vault` requires every reserve to be empty, the entire vault is stuck until the account is thawed. If the freeze is never lifted, the vault is permanently sealed, even though the owner can prove ownership.

**Evidence if this is real.**

On the local validator with the suite’s cbBTC freeze authority, freeze `vault.pda`’s canonical cbBTC ATA while it holds >0 sats, then attempt the normal redemption. The SPL transfer fails; if it were skipped for testing, `burn_vault` would reject `VaultNotEmpty`. The whole redemption fails. The current suite freezes the vault account only for `claim` deferral and freezes the pool for the stage-3c forfeit path; it does not exercise redemption of a frozen vault-owned cbBTC account.

**Why this is not fully covered by accepted limit 28.** Item 28 says a frozen vault account is skipped by claim and a frozen pool is handled by forfeit. It does not state that a frozen vault cbBTC account locks that vault’s redemption. The holder guide says Coinbase can freeze any cbBTC account including a vault, but then says “you can still open your vault” in the pool-freeze sentence; that sentence does not cover a frozen vault-owned cbBTC account.

**Fix.** This cannot be fixed by the program while cbBTC’s freeze authority remains trusted. It must be documented in `HOLDER-GUIDE.md` and `SPEC.md` as an external freeze consequence, and the redeem page/simulation should include a frozen vault-account redemption test so the behavior is explicit. In the holder copy, say directly: “If Coinbase freezes YOUR vault’s cbBTC account, you cannot redeem until it is thawed.”

---

### F3 — LOW — `activate` ignores the token-account state and can activate a frozen cbBTC account

**Construct.** `programs/cbob-vault-mint/src/lib.rs` in `activate`:

```rust
let (amount, _) = read_token(&ctx.accounts.vault_token, &payment_mint, &signer)?;
require!(amount >= ACTIVATION_SATS, MintError::BelowActivation);
```

`read_token` returns `(amount, state)`, but `activate` drops `state`.

**What happens.** A vault whose cbBTC account is frozen can still request activation, and later join the denominator when the epoch passes. It becomes active weight that cannot receive claims and cannot be redeemed while the account remains frozen.

**Evidence.** Freeze a freshly funded vault account with exactly 21,000 sats, call `activate`; it succeeds and emits `ActivationRequested`. After the next distribution/join, the vault has weight, but `claim` skips it and `burn_vault` cannot complete.

**Fix.** In the first activation call:

```rust
let (amount, state) = read_token(&ctx.accounts.vault_token, &payment_mint, &signer)?;
require!(state == TOKEN_STATE_INITIALIZED, MintError::VaultAccountMissing);
require!(amount >= ACTIVATION_SATS, MintError::BelowActivation);
```

Use the same `TOKEN_STATE_INITIALIZED` check that `distribute` already applies to the GARY burn account.

---

## Accepted-limit status checks

1. **Item 28 is worse than stated.** As described in F2, a frozen VAULT cbBTC account blocks redemption. The accepted text handles frozen claims and frozen pool, but not frozen vault-owned cbBTC blocking `burn_vault`.
2. **Item 25 is not meaningfully worse.** Capture is permissionless; the lapse reroll already depends on total silence.
3. **Item 32 ring behavior appears to match the stated rolling window.** The first `cap` redemptions can land in a burst, but no rolling window exceeds `cap`.
4. **No DISCHARGED item appeared stale or re-opened.**
5. **Item 50 remains OPEN AND BLOCKING**, and F2 makes the unreinforced redeem path more important: until the redeem page exists, a holder with a frozen vault cbBTC account may discover the lock only by failed transaction.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

What this project should do before launch, concretely, that AI audit structurally cannot:

1. **Have a separate, non-AI launch-key and launch-values review.**
   A human or independent operator must verify every `initialize` argument in `launch/mainnet-init.json` against `DESIGN-v6.md`, especially:
   - `bank_treasury` is the CBOBTC Squads, not `MINT_CFG`, not `revenue`, not `pool_ata`
   - `guardian` and `swap_operator` are different keys
   - the charter window is 7 days
   - the redemption window is 3600
   - the voting period is 259,200
   - the exact `pob_root` is regenerated from `scripts/pob-set.json` in a clean environment

2. **Run the mainnet dress rehearsal at real scale.**
   This process is still OPEN AND BLOCKING. Nothing has run distribution against a live chain with ~2,100 vaults. That must be done with real RPCs, rate limits, failed transactions, paging, and the actual crank.

3. **Build and manually test the holder surfaces before launch.**
   `judgeRedemptionCoverage` is a pure function; the redeem page that warns a holder before signing is not built. Test it manually against:
   - a vault with a foreign token
   - a vault with a nested vault
   - a vault with a frozen owned cbBTC account
   - a vault with all three reserve assets and destination ATAs not yet created

4. **Build and test the redemption poster sender.**
   The holder guide promises public posting. `bank/redemption-poster.mjs` drafts only and has no sender. That promise must be implemented and exercised on a real account or the guide changed before declare.

5. **Publish deployment evidence.**
   After deploy, publish:
   - the sha256 of every deployed `.so`
   - the upgrade-authority removal transactions
   - the `solana program show --authority` output for all four programs showing no authority
   This cannot be verified by reading source; it is an off-chain operational fact.

6. **Do a freeze-authority threat walk with the launch team.**
   AI can read that Coinbase holds cbBTC’s freeze authority; it cannot assess Coinbase behavior, compliance triggers, or the operational plan if a vault/pool is frozen. The team should specifically game out:
   - pool frozen
   - revenue ATA frozen
   - a high-profile vault frozen
   - tainted cbBTC sprayed at many vaults

7. **Independently re-derive every launch PDA/ATA.**
   The suite derives many addresses, but a tiny off-by-one in an off-chain tool still burns a launch. Derive and print all program/config/vault/revenue/pool addresses from independent code and compare them to the deploy/init transaction output.

End of findings.