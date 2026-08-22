## FINDINGS

### HIGH — BURN can become stale relative to SEAL’s canonical reserve-mint list and then destroy a vault holding a newly added reserve asset

**Construct:** `BURN::burn_vault` iterates `cfg.reserve_mints`, where `cfg` is BURN’s independently stored `BurnConfig`. Its “canonical SEAL config” cross-check reads only:

```rust
collection[40..72]
bank[72..104]
```

It does **not** decode or compare SEAL’s `reserve_mints` vector.

**Exploit:**  
1. SEAL admin adds a new reserve mint, e.g. a future cbBTC migration mint, using `SEAL::update_config`. This is permitted because additions are allowed and only removals are prohibited.  
2. BURN’s config is not updated with that new mint. Nothing on-chain forces synchronized updates.  
3. A vault’s asset-signer PDA holds the new reserve mint in its canonical ATA.  
4. Owner and Bank submit `BURN::burn_vault`, supplying only the old BURN-config reserve ATAs.  
5. BURN verifies its stale list, sees zero PDA lamports and zero old reserves, then calls Core `BurnV1`. The vault is destroyed while the new reserve token account remains owned by the now-unsignable asset-signer PDA.

The on-chain evidence would be: SEAL config contains mint `X`; BURN config does not; a successful `VaultBurned` event exists; and the ATA for `X` remains funded under the burned asset’s signer PDA.

The Bank signature is an operational backstop, not an on-chain proof. The code comment expressly claims the cross-check prevents trimmed reserve lists; it does not.

**Fix:** Remove BURN’s independent `reserve_mints` list. Decode SEAL’s full serialized `Config` using a shared crate/versioned schema and use SEAL’s list directly. At minimum, decode and exact-compare the reserve vectors, including length and every element, before burning.

---

### HIGH — `close_redemption` overwrites the full Attributes plugin and destroys charter provenance

**Construct:** `mark_opened()` serializes:

```rust
Plugin::Attributes {
    attribute_list: [("redemption", "opened")]
}
```

with exactly one pair:

```rust
data.extend_from_slice(&1u32.to_le_bytes());
...
```

It invokes `UpdatePluginV1` on the Attributes plugin. This is a replacement update of that plugin’s data, not an append/merge operation.

Further, `MINT::mint_vault` creates the Attributes plugin with an empty list:

```rust
data.push(PLUGIN_ATTRIBUTES);
data.extend_from_slice(&0u32.to_le_bytes());
```

There is no charter Notice serial, Governor standing, Proof-of-Burn reference, or any other provenance input anywhere in the shown mint interface.

**Impact / exploit:** A charter vault either:

* is minted without the required provenance in the first place; or
* if provenance was somehow introduced into Attributes before closing, loses that provenance on the first redemption close and is left only with `redemption=opened`.

This defeats the stated rule that provenance is the only surviving charter-member record after the Proof-of-Burn token and Notice are destroyed. It also creates resale ambiguity: a later holder cannot distinguish “former charter vault with lost provenance” from an ordinary vault based on the promised on-chain record.

**Fix:** Define a fixed provenance schema at mint and pass the actual charter evidence into a dedicated mint path. Do not use the same mutable Attributes list for both immutable provenance and redemption state. Prefer a separate plugin if Core supports one with suitable authority semantics; otherwise read the existing attribute list, preserve all recognized provenance entries, and deterministically add/update only the redemption key. Tests must mint a charter vault, close redemption, and assert every provenance field remains byte-for-byte present.

---

### HIGH — Mint revenue can be redirected unilaterally by MINT admin; neither the 85/15 split nor treasury destination is enforced

**Construct:** `MINT::update_wiring` lets `config.admin` set:

```rust
treasury: Option<Pubkey>
```

without governance approval, recipient validation, split logic, timelock, or consistency check against SEAL. `mint_vault` sends 100% of the price to that mutable account:

```rust
system_instruction::transfer(payer, treasury, cfg.price_lamports)
```

The SEAL canonical-wiring comparison checks collection and bank only, not treasury.

**Exploit:** The MINT admin changes `treasury` to an attacker-controlled wallet. Every later paid mint transfers its entire price there. The claimed 85% holder flow and 15% Bank allocation have no on-chain implementation in these programs.

On-chain evidence would be an `update_wiring` transaction changing the MintConfig treasury followed by ordinary successful `VaultMinted` transactions whose payer transfers go to the replacement address.

**Fix:** Treasury changes must be governance-controlled, delayed, and evented. Encode the actual 85/15 split on-chain, or explicitly remove that economic claim and treat treasury distribution as a separately audited system. If treasury is intentionally off-chain governed, at least make it immutable after initialization or require the configured governance signer rather than MINT admin.

---

### MEDIUM — The stated approximately-2,100 lifetime supply is not enforced; `minted_total` is accounting only

**Construct:** `set_round` always resets:

```rust
c.minted_this_round = 0;
```

and accepts arbitrary `cap` and `price_lamports`, including `cap = 0` meaning unlimited and `price_lamports = 0`. `minted_total` is incremented but never checked.

**Exploit:** A ratified governance authority can repeatedly create new rounds, including unlimited, zero-price rounds. It cannot complete `mint_vault` without the configured Bank signature, so governance alone cannot mint. But the program does not enforce the advertised lifetime supply or a fee floor: Bank approval is the only remaining control.

The evidence would be `minted_total > 2100`, a sequence of `RoundSet` events resetting per-round caps, and valid zero-price `VaultMinted` events.

**Fix:** Add a hard lifetime max, e.g. `require!(minted_total < MAX_LIFETIME_SUPPLY)`, and decide explicitly whether `cap = 0` and `price = 0` are valid governance outcomes. If free charter mints are intended, use a bounded dedicated charter allocation rather than unrestricted free rounds.

---

## WHAT I TRIED AND COULD NOT BREAK

* I did not find a committed transaction path that leaves a vault thawed: a failed or absent terminal close rolls back the preceding unfreeze.
* I did not find a path allowing an owner alone to execute assets from a normally minted, frozen vault; `open_for_redemption` requires both owner and configured Bank.
* I did not find a way to spoof the current SEAL config merely by passing arbitrary account bytes: the account must be the PDA derived under the fixed SEAL program ID and owned by that program. The raw fixed-offset decoding is brittle across SEAL upgrades, but is not presently caller-forgeable.
* I did not treat non-ATA account enumeration as an on-chain solvable issue; the stated Bank/off-chain scanner responsibility remains necessary.

## DISPUTED CLAIMS

**D1 — REJECTED.** The extra zero is not, by itself, evidence of malformed Borsh. The observed working validator mints and burns directly refute “every call reverts.” In this wire format, the bytes following the instruction discriminator include serialized option/state fields; `[IX_CREATE_V2, 0]` and `[IX_BURN_V1, 0]` cannot be condemned solely because a reviewer expected the payload to begin immediately with a string or another field. A claim of universal non-functionality requires a failing transaction reproduction against the stated Core deployment, not a generic Borsh assertion.

**D2 — REJECTED.** The code reads the four-byte little-endian `COption<Pubkey>` discriminant at `[72..76]`, not a one-byte tag and not the stale 32-byte delegate payload. It separately checks `delegated_amount` at `[121..129]` and the close-authority discriminant at `[129..133]`. A revoked SPL-token delegate has a `None` discriminant and zero delegated amount; stale bytes in the unused payload do not affect these checks.

**D3 — REJECTED.** The transfer does occur before the Core CPI, but Solana instruction execution is atomic at the transaction level. Any later failed require, failed Core CPI, or failed account check rolls back the prior system transfer. There is no successful state in which this instruction charges the payer and then reverts before creating the asset.

**D4 — REJECTED.** Sending lamports to the asset-signer PDA can block the optional burn until the lamports are swept during an owner-and-Bank-authorized opening, so it is a nuisance/grief condition. But dropping the check is not the correct fix: Core BurnV1 is not shown receiving the asset-signer account or a destination for its unrelated native balance, so it cannot be assumed to sweep those lamports. Burning while the signer PDA retains native value risks stranding that value. Retain the check and provide an explicit authorized sweep workflow before burn.

**D5 — REJECTED.** The asserted encoding omits the option discriminant in `PluginAuthorityPair`. The relevant bytes are: plugin variant `17`; PermanentFreezeExecute data `1` for frozen; then `1` for `Some(authority)`; then authority variant `3` for `Address`; then the 32-byte seal PDA. The Attributes pair follows the same `Some(Address(...))` structure. Thus the shown bytes encode a frozen plugin delegated to the derived SEAL PDA, rather than an authority-less or unfrozen plugin. A post-mint frozen-state assertion is still worthwhile, but lack of that assertion does not make this encoding wrong.

**D6 — UPHELD.** This is the first finding above. BURN retains its own list, and the supposed canonical SEAL comparison checks only collection and bank. A SEAL-added reserve mint absent from BURN’s stale list is neither derived nor required nor checked by BURN. A successful burn can therefore strand that reserve in a token account owned by the destroyed vault signer PDA.

## THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

Eliminate BURN’s independent reserve-mint configuration and make every burn validate the complete, current SEAL reserve list from a shared, versioned schema. As written, a normal future reserve-mint addition can recreate the exact class of irreversible value-destruction failure this architecture claims to have removed.