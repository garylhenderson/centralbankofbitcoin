# ROUND 13 — MECHANIC-ORIENTED ADVERSARIAL REVIEW

**Posture.** I assume every claim in the source comments is false until the code forces it to be true. Where the 259-assertion suite settles a question, I defer to it and say so. Where the suite's assertion is *self-referential* — comparing a source constant to a literal rather than to the thing it is supposed to pin — I say that too, because three of the four "pairing" assertions the rewrite rests on are exactly that.

**The single most important sentence in this report:** the v5 rewrite is coherent *on-chain* and it moved the entire residual risk onto one control — "the Bank must scan with `getTokenAccountsByOwner` and DAS **before** it signs" — and that control **does not exist in this repository**. There is no co-signing service, no simulation gate, no pre-sign scan. `alarm.mjs --reconcile` is a daily *post-mortem*, it never queries DAS by owner at all, and it is not in the signing path. Every "that gap is covered by the Bank's co-signature" comment in SEAL, BURN and SPEC.md currently points at nothing.

---

# 1. MINT

What I checked: price/slippage, round window, lifetime and per-round caps, the owner+Bank signature requirement, the hand-built `CreateV2` byte stream (opcode, `DataState`, `Option<Vec<PluginAuthorityPair>>`, the two plugins, the trailing `Some(empty)` for external adapters), the seal-config cross-check offsets, the account-space arithmetic for all four configs (all four are correct — 489 bytes needed vs 745 allocated for `MintConfig`; SEAL/BURN/GOV likewise), and every offset the alarm and `revenue.mjs` read out of `MintConfig` (all consistent with Borsh layout).

## HIGH — The Attributes plugin authority is delegated to a PDA that can never use it, and the delegation is irreversible

`mint_vault` writes, for every vault:

```rust
data.push(PLUGIN_ATTRIBUTES);
... attributes ...
data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend_from_slice(seal_pda.as_ref());
```

SEAL's only Core CPI is `core_plugin_cpi`, called from exactly one place, `set_frozen`, with hardcoded data `[6, 17, frozen]`. There is no code path in SEAL — and after the v5 deletion of `mark_opened` there is no *instruction* in SEAL — that can emit `UpdatePluginV1(Attributes)` or `RevokePluginAuthorityV1`.

Consequences, in order of severity:

* **Attributes on every vault are frozen forever.** The collection's update authority (MINT's `["mint"]` PDA) cannot touch them either, because Core routes authority-managed plugin writes to the *delegated* authority once one is set. A mis-stamped `charter` serial or `notice` serial at mint is permanent.
* **Revocation requires the current authority to sign** — i.e. requires SEAL to grow an instruction it does not have. So this cannot be repaired for a vault after it is minted.
* Combined with the v5 decision to destroy the vault on redemption, a mis-stamped provenance value is both unfixable *and* unverifiable after the fact.

The author's stated reason for leaving MINT alone — "rather than making two risky changes in one session" — is defensible for the dead `ReservedAttribute` check and the stale `MAX_ATTRS` comment. It is **not** defensible here, because nothing has minted yet and this is the last moment the decision is cheap. After the first mint it is permanent for that vault.

**Fix (before any mint):** set the Attributes plugin's `init_authority` to `PluginAuthority::None` if you want provenance immutable by construction (the honest expression of the intent), or to `PluginAuthority::UpdateAuthority` if you ever want to correct a serial. Do not point it at a program that has no instruction to use it. Also drop `ATTR_REDEMPTION`/`ReservedAttribute` and the "must fit within what SEAL can preserve" comment; the real bound on attribute size is the 1232-byte transaction, and 8 × (128+128) already exceeds it, so `MAX_ATTRS`/`MAX_ATTR_STR` are dead bounds documenting a nonexistent mechanism.

## HIGH — There is no on-chain link between a paid mint and a funded vault

`mint_vault` creates an empty vault. Activation — putting cbBTC into `["mpl-core-execute", asset]`'s ATA — is a bare SPL `Transfer` from the Bank to a derived address. It:

* touches **none** of the four CBOB programs, so it appears in **no** signature scan the alarm performs (the alarm walks SEAL/MINT/BURN/GOV only, deliberately);
* emits no program event;
* creates the ATA via the ATA program, so `detectPdaTokenAccounts` can only see it if the same transaction happens to touch one of our programs — it does not.

So the assertion on which the entire SELL mechanic rests ("this vault still contains its reserve") has no auditable on-chain provenance, and the alarm cannot reconcile "vaults minted and paid for" against "vaults funded". `mint.minted_total` is watched; funded-vault count is not derived from anything.

**Fix:** add `fund_vault(amount)` to MINT (or SEAL): CPI the `TransferChecked` from the Bank's ATA into the vault PDA's reserve ATA, `require` the mint is in `seal_config.reserve_mints`, and `emit!(VaultFunded { asset, mint, amount, cumulative })`. Then activation is provable, the alarm can hold `minted_total` against funded count, and a buyer has a transaction to point at.

## MEDIUM — Asset addresses are client-chosen and reusable after a burn

`asset: Signer` in `MintVault`. The client generates the keypair. After `BurnV1`, the asset account is closed (0 lamports, 0 data, System-owned), which means `CreateV2` at the *same address* succeeds again. Whoever kept the original asset keypair can, with a Bank co-signature and an open round, re-mint a vault at a previously-burned address.

That directly falsifies two claims:

* the INVARIANT's "the vault is burned and never exists again" — the *address* comes back, with new attributes and a live `AssetV1`;
* the charter answer's "what survives is the mint transaction and DAS's burnt entry" — DAS keys by asset id, so the burnt entry is replaced by a live asset.

**Fix:** derive the asset as a MINT PDA, e.g. `["vault", minted_total.to_le_bytes()]`, and sign `CreateV2` with `invoke_signed`. Since `minted_total` only increases, no index is ever reusable, addresses become enumerable off-chain without DAS, and the client loses the ability to choose or retain an asset key.

## MEDIUM — `sol_reserve_lamports == 0` admits a rent-state wedge in `sweep_sol_for_swap`

`initialize`/`update_wiring` accept `sol_reserve_lamports == 0`. The revenue PDA is a 0-data system account, so the runtime rejects any transaction that leaves it *non-zero but below* `RENT_EXEMPT_0_BYTES` (890,880). With `keep = 0`:

* `require!(bal >= keep + amount)` permits `amount` such that `bal - amount ∈ (0, 890_880)`;
* the `system_instruction::transfer` then fails with `InsufficientFundsForRent`.

`revenue.mjs` computes `amount = balance - reserve` then clamps to `chainCap` (50 SOL). So for any balance in `(50 SOL, 50 SOL + 890_880)` the sweep is refused *every* run until more income arrives. The program's own comment ("Zero is fine — the PDA simply closes and is recreated") is only true when the sweep takes the *entire* balance, which the cap forbids above 50 SOL.

**Fix:** in the program, `require!(bal == keep + amount || bal - amount >= RENT_EXEMPT_0_BYTES)`; or simply drop the `== 0` option and mandate `sol_reserve_lamports >= RENT_EXEMPT_0_BYTES`.

## LOW — `assert_classic_spl` does not verify the account is a Mint

It checks `*acc.owner == SPL_TOKEN_ID` only. A Tokenkeg-owned account of any kind passes — including a *token account* (165 bytes) or a multisig (355 bytes). A typo'd entry then:

* can never be removed (`ReserveMintDropped`, additive-only);
* permanently consumes **two** declared-account slots in every future `burn_vault` (see §2 on the transaction ceiling), which is the scarcest resource in the whole design.

There is also no duplicate check: `[cbBTC, cbBTC]` is accepted and permanently costs a slot.

**Fix:** `require!(acc.data_len() == 82)` and reject duplicates. While you are there, read `freeze_authority` — see the freeze finding in §2, which is the reason it matters.

---

# 2. UNBREAK (open_for_redemption + burn_vault)

I attacked this hardest, as instructed. First, the direct answers.

### (a) Can a vault be thawed and NOT burned?

**On-chain: no, and I could not construct one.** Reasoning I am willing to stand behind:

* Every top-level instruction in a Solana transaction executes in order and any failure reverts the whole transaction. There is no "present but skipped" and no "failed but survived". So a matched-but-failing burn takes the thaw with it.
* `load_current_index_checked` returns the *top-level* index even under CPI. A wrapper `W` that CPIs `open_for_redemption` reports `W`'s index; the forward scan then requires a genuine top-level `burn_vault`. That burn's own backward scan sees `W` at the earlier index, `program_id != SEAL_PROGRAM_ID`, and refuses (`NoPrecedingOpen`). Symmetrically, a CPI-hidden burn is invisible to the open's forward scan. **(d) is true in both directions.**
* Durable nonce: `AdvanceNonceAccount` must be instruction 0, which merely shifts every index by one. The pairing is index-relative, so it still holds. **No exploit.**
* ALT: the instructions sysvar is built from the *sanitized* message with resolved keys, so `ix.accounts[i].pubkey` is the resolved address. No substitution of the asset/owner binding.
* Transfer-in-the-middle: `open(A, alice)` → `TransferV1(A → bob)` → `burn(A, alice)` fails at `require_keys_eq!(asset_owner, owner)`. Reverts.
* Two redemptions sharing a transaction: both halves bind asset **and** owner, both scans are per-instruction, so A's open cannot be satisfied by B's burn (tested 3.9/3.10/9.0, and those three tests reject for the *right* reason via `because()`).

**Off-chain: yes, and this is where the real exposure is.** See the two findings on the Bank's signature below. The thaw always pairs with a burn — but *which* burn, over *which* accounts, and *when*, are not fixed at the moment the Bank signs.

### (b) Can a burn be paired to a different vault's thaw? Is index 0 / index 2 complete?

No, and the binding is complete *for what it needs to be*. Note precisely why: SEAL's forward check is not load-bearing for correctness. All substantive validation (asset owner == signer, collection, emptiness, config wiring) lives in `burn_vault` itself and is re-derived from the accounts BURN receives. SEAL's check only answers "is a burn of this asset by this owner going to happen in this transaction". So even if a future BURN reorder made SEAL's index-2 read land on a caller-chosen account, SEAL's binding would degrade to *redundant*, not *wrong*.

The mirror is not symmetric, and that is worth knowing: BURN's backward check reads only `program_id`, discriminator, index 0 and index 2 of the open. It does **not** verify that the open used the correct `bank`, `config`, or `seal` PDA. It does not need to — SEAL's handler did — but that means BURN's check is a *liveness* condition satisfiable by any successfully executed SEAL open with the right asset and owner. Fine today; brittle if SEAL ever gains a second instruction whose name hashes near `open_for_redemption` (it cannot — sha256 — but the point is that BURN is trusting an 8-byte name hash and two positions, nothing else).

### (c) Does the hardcoded coupling fail closed?

**Yes, in every case I could construct — and the failure is not benign, which the author's framing understates.**

* BURN renames `burn_vault` → SEAL's disc match fails → `NoTerminalBurn` → **all redemption halts**.
* BURN inserts an account before index 2 → SEAL's owner read lands elsewhere → no match → **all redemption halts**.
* SEAL renames or reorders → BURN's `NoPrecedingOpen` → **all redemption halts**.
* Core changes `AssetV1`'s prefix → `data[0] != 1` or `data[33] != 2` or a garbage owner → both programs refuse → **all redemption halts**.

"Halt" here means: every customer's Bitcoin is sealed, and the only exit is a **program upgrade** of SEAL and/or BURN through a Squads multisig ceremony. There is no admin override, no config-stored discriminator, no versioned pairing.