# ROUND 5 — FINDINGS

---

## F1. CRITICAL — Supply and revenue are unbounded, and `admin` can silently become `governance` and the treasury

**Construct:** `MintConfig.minted_total` is incremented and **never read anywhere**. Its own doc comment says it exists so "a governor could [not] lift any cap by simply opening a new round" — the code does exactly nothing with it. Separately `require!(cfg.cap == 0 || cfg.minted_this_round < cfg.cap)` makes **`cap == 0` mean UNLIMITED**, not zero. And `update_wiring` lets `admin` rewrite `governance`, `treasury` and `bank`.

**Exploit (2 signatures, 3 txs):**
1. `admin` signs `update_wiring(governance = Some(admin), treasury = Some(admin_wallet_2))`. Governance is now decorative; the "one vote per vault" system has no on-chain existence.
2. `admin` (now `governance`) signs `set_round(opens_at = 0, closes_at = i64::MAX, price_lamports = 0, cap = 0)`. `closes_at > opens_at` is the only validation. The round never closes and has no cap.
3. `admin + bank` sign `mint_vault` N times. No price, no cap, no lifetime limit. 2,100 becomes 200,000.

Even without step 1, a hostile governor majority (3 wallets = 48%) does the same thing legitimately: `cap = 0` + `closes_at = i64::MAX` is a *ratified* infinite round. The claim "a hostile majority cannot express a dangerous proposal because the instruction has nowhere to put one" is false — `cap` and `closes_at` are exactly where you put it. And there is **no on-chain link between paying and receiving and no 85/15 split**: `treasury` is a bare `UncheckedAccount` that admin can point at a personal wallet; the 85% is pure off-chain trust.

**Fix:** `pub const MAX_VAULTS: u64 = 2100;` → `require!(c.minted_total < MAX_VAULTS)`. Make `cap == 0` mean *zero*. Bound `closes_at <= now + 30 days` and `opens_at >= now`. Remove `governance` and `treasury` from `update_wiring` (or require both the current governance *and* admin to sign a rotation, plus a timelock + event).

---

## F2. HIGH — "The SEAL config is canonical" is not true, and the one field that protects Bitcoin is the field never cross-checked

**Construct:** MINT and BURN read only `d[40..72]` (collection) and `d[72..104]` (bank) and compare them to *their own* copies. They then **enforce their own copies**, not SEAL's. `reserve_mints` (offset 104+) is never read. There is no 8-byte discriminator check and no version byte.

**Exploit:** SEAL's admin adds a second activation asset `M` via `update_config(reserve_mints = [cbBTC, M])` (`ReserveMintDropped` permits additions, and adding is the *intended* growth path). BURN's list is untouched — a separate instruction, a separate program, a separate ops step. A vault whose asset-signer PDA holds 1 BTC-equivalent of `M` in its canonical ATA now passes `burn_vault`: `M`'s ATA is never derived, never demanded in `remaining_accounts`, never balance-checked. Owner + Bank sign, the asset dies, `M` is stranded in an unsignable PDA forever. BURN's own header comment claims the cross-check prevents precisely this ("a trimmed reserve list… becomes a destroy-BTC path"). It does not check reserve lists at all. (This is D6, upheld.)

**Fix:** BURN must **parse the Vec at offset 104 out of the SEAL config and iterate that**, deleting its local `reserve_mints` entirely — or, minimally, `require!(seal_list == cfg.reserve_mints)`. Also verify `d[0..8] == Config::DISCRIMINATOR` and add an explicit `version: u8` as the first field of `Config` that MINT/BURN pin, so a SEAL upgrade that inserts a field fails loudly instead of comparing whatever 32 bytes now sit at 72.

---

## F3. HIGH — The provenance stamp the business depends on is never written, and `mark_opened` would destroy it if it were

**Construct:** `mint_vault` creates the Attributes plugin with `extend_from_slice(&0u32.to_le_bytes())` — an **empty attribute_list**. `mint_vault` takes only `name` and `uri`. There is nowhere to put a Notice serial or Governor standing. So the stated requirement — "charter provenance … the ONLY surviving record that a holder was a charter member, since the Proof-of-Burn token and the Notice are both destroyed" — is unimplemented. The only record is the off-chain URI content, which the issuer can rewrite.

Worse, `mark_opened` builds `Plugin::Attributes` with an `attribute_list` of length **1**. Core's `UpdatePluginV1` **replaces** the plugin, it does not merge. So the moment you *do* add provenance attributes, the first `close_redemption` erases every one of them and leaves exactly `{"redemption":"opened"}`. A charter holder who redeems once loses their charter proof permanently.

Also: the stamp is a one-bit "was thawed once", so a holder who opens, takes nothing, and closes is permanently marked; and a buyer learns nothing about the balance. It is a worse signal than `getTokenAccountsByOwner`, which the buyer can just run.

**Fix:** add a `provenance: Vec<(String,String)>` argument to `mint_vault` and encode it into the create-time attribute list. Make `mark_opened` read the asset's existing Attributes plugin out of the account data, append/overwrite only the `redemption` key, and re-emit the full list. Consider stamping a counter and slot rather than a bit.

---

## F4. MEDIUM–HIGH (conditional, verify before mainnet) — `require!(d.len() == 165)` is a permanent-seal DoS for any Token-2022 reserve mint

Every ATA the ATA program creates for **Token-2022** carries the `ImmutableOwner` extension, so `d.len() > 165` always. Both `inspect_reserves` (close) and `burn_vault` then hard-fail with `ReserveHasExtensions`. Because `close_redemption` must succeed for `open_for_redemption` to be legal, **the vault becomes permanently unopenable and unburnable — the BTC is sealed forever.** ATA creation is permissionless: a stranger pays ~2039 lamports to create the T22 ATA for someone else's asset-signer PDA and bricks that vault. This fires only if a listed reserve mint is a Token-2022 mint — **confirm the cbBTC mint's owning program, and $GARY/$GIRAFFISH, before deploying.** Fix: parse the TLV and reject only balance-hiding extensions (`ConfidentialTransferAccount`, `TransferFeeAmount` with withheld > 0, `PausableAccount`), accepting `ImmutableOwner`/`MemoTransfer`; or refuse T22 mints in `initialize` and delete the T22 derivation loop.

---

## F5. MEDIUM — 1 lamport converts an unburnable vault into a permanently stained one

`require!(asset_signer.lamports() == 0)` in `burn_vault`: anyone sends 1 lamport to the (globally derivable) asset-signer PDA. Burn now reverts forever. Recovery exists — `open_for_redemption` + `ExecuteV1` system-transfer + `close_redemption` — but `close_redemption` unconditionally calls `mark_opened`, so **a stranger can force a pristine, never-redeemed vault to be stamped `redemption: opened` for 1 lamport**, destroying exactly the resale signal F3 was built for. The lamports check also proves nothing (v1's whole lesson: BTC isn't in lamports). Fix: delete the check (keep the reserve/nested checks), or allow `lamports() <= 1_000_000` and let Core reclaim.

---

## F6. LOW–MEDIUM — Cross-program rotations are non-atomic and fail-closed in three places

`update_config(bank)` on SEAL immediately halts **all minting and all burning** (`WiringDiverged`) until BURN and MINT are separately rotated by their own admins. MINT's `update_wiring` can set `collection` — which SEAL deliberately cannot — so one admin typo permanently halts minting. If SEAL is ever redeployed at a new program ID, `SEAL_PROGRAM_ID` in both MINT and BURN is stale and both revert until both are upgraded. All fail-closed, but plan the runbook.

---

## F7. LOW — Comment drift / dead code signalling incomplete surgery

SEAL still documents `burn_empty_vault` (gone), keeps `IX_CREATE_V2`, `IX_BURN_V1`, `MAX_NAME_LEN`, `invoke`, and the errors `VaultStillHoldsAVault`, `DeclarationMismatch`, `NameTooLong`; `inspect_reserves`' `require_empty` parameter is `false` at its only call site; `Config.reserve_mints`' doc claims *this* program's burn enforces it. The nested-vault guard in BURN is still **opt-in** (only `remaining_accounts` are scanned) despite being listed as fixed — an undeclared inner Core asset burns cleanly.

---

## What I tried and could NOT break

Ending a transaction thawed: `open` demands a later **top-level** `close` bound to asset *and* owner; a CPI'd `close` is invisible to `load_instruction_at_checked` and fails closed; a decoy top-level close must actually execute and re-freeze; two opens sharing one close still end frozen. Non-owner move/destroy: all three paths read the AssetV1 owner at `data[1..33]` and require the Bank. Token-account offsets (32/64, 72, 121, 129) are correct for the 165-byte layout. Payment loss on failure (atomic). `payer == treasury` self-transfer (system program rejects the duplicate borrow). Re-initialising any config (`init` + PDA + `INIT_AUTHORITY`). Delegate/close-authority survival on the canonical reserve ATAs. The CreateV2 and BurnV1 wire encodings.

---

# ADJUDICATIONS

**D1 — REJECTED.** The auditor mis-parsed `CreateV2Args`, whose first field is `data_state: DataState`. `vec![IX_CREATE_V2, 0]` is discriminator + `DataState::AccountState`, not a stray padding byte; likewise `vec![IX_BURN_V1, 0]` is `BurnV1` + its `compression_proof: Option<...> = None`. The tail `push(1); 0u32` is `Some(vec![])` for `external_plugin_adapters`. If this were wrong, Core would fail to deserialize and *no* mint would ever succeed — contradicted by a 19/19 suite minting real assets against cloned mainnet Core.

**D2 — REJECTED, and the auditor's own parenthetical refutes them.** `spl_token::state::pack_coption_key` writes `[0,0,0,0]` to the 4-byte **tag** on `None` and leaves the 32-byte body stale — exactly as claimed. But the code reads `d[72..76]`, which *is* the tag, not the payload; the payload at `[76..108]` is never touched. `process_revoke` additionally zeroes `delegated_amount`, so `d[121..129]` is clean too. No trap exists.

**D3 — REJECTED.** Solana transactions are atomic. If `CreateV2`, the seal-config check or `OwnerWouldBrick` fails after the `system_instruction::transfer`, the entire transaction reverts and the lamports are never debited. There is no partial-state window and no refund path needed. (The ordering is still poor hygiene — put all validation before any state change — but it is not a defect.)

**D4 — REJECTED as a finding-plus-fix, premise partly right.** The proposed mechanism is invented: Core's `BurnV1` touches the asset and collection accounts, **not** the asset-signer PDA, so it cannot "sweep any remaining lamports to the payer" — dropping the check would leave the lamports exactly where they are. The griefing observation is real, and I raise it independently as F5 with the correct mechanism (recovery requires a Bank-co-signed open/close, which irreversibly stamps the asset). The right fix is a threshold or deletion of a check that proves nothing, not the stated one.

**D5 — REJECTED on the encoding, UPHELD on the missing test.** The layout is right: `CreateV2` args are `data_state, name, uri, Option<Vec<PluginAuthorityPair>>, Option<Vec<ExternalPluginAdapterInitInfo>>`, and `PluginAuthorityPair` is `{ plugin: Plugin, authority: Option<PluginAuthority> }`. `push(17)` selects the plugin variant, `push(1)` is `FreezeExecute{frozen: true}`, `push(1)` is `Some(...)`, `push(3)` is `PluginAuthority::Address`, then 32 bytes. Crucially, Borsh enums are length-determined by their variant, so a wrong encoding here does not produce a silently-unfrozen asset — it produces a deserialization failure and a reverted `CreateV2`. Vaults cannot be "born unfrozen" by a byte-layout slip. But the auditor is right that nothing asserts it: **add a test that reads the created asset's plugin registry and asserts (a) the plugin is `PermanentFreezeExecute` and not the removable `FreezeExecute`, (b) `frozen == true`, (c) the authority equals the derived seal PDA, and (d) a bare `ExecuteV1` by the owner fails.** Without (a) and (d) the seal is asserted only by construction.

**D6 — UPHELD.** See F2. BURN cross-checks `collection` and `bank` and stops. `reserve_mints` — the only list that determines which token balances must be proven zero before an asset is destroyed — is read from BURN's own account and never compared to SEAL's. A mint added to SEAL but not BURN is never derived, never required in `remaining_accounts`, never balance-checked, and the vault burns with the token inside. The BURN header comment asserting the cross-check prevents "a trimmed reserve list" is false.

---

# THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

**Make supply and revenue structurally unforgeable in MINT:** a hardcoded `MAX_VAULTS` checked against `minted_total`, `cap == 0` meaning zero, a bounded `closes_at`, and `governance`/`treasury` removed from `update_wiring`. Today one key can seize governance, zero the price, open an endless uncapped round and print vaults forever — which invalidates the 2,100 scarcity, the one-vote-per-vault franchise, and the 85% claim that every buyer is paying for.